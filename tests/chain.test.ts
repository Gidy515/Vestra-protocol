import { test } from "node:test";
import assert from "node:assert/strict";
import * as anchor from "@anchor-lang/core";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
  AuthorityType, createMint, getAccount, getOrCreateAssociatedTokenAccount,
  mintTo, setAuthority, TOKEN_PROGRAM_ID, createAccount, createMintToInstruction,
} from "@solana/spl-token";
import { bn, VestraClient, loadProgram } from "../scripts/client";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("custody, authorized funding, weighted rewards, expiry, and reconciliation", { timeout: 240_000 }, async t => {
  if (process.env.VESTRA_DEMO_CLOCK !== "1") {
    throw new Error("Use npm run test:local; this test requires the LOCAL demo-clock build.");
  }
  const provider = anchor.AnchorProvider.env();
  assert.match(provider.connection.rpcEndpoint, /^http:\/\/(127\.0\.0\.1|localhost):8899\/?$/);
  anchor.setProvider(provider);
  const program = loadProgram(provider);
  const client = new VestraClient(program);
  const payer = (provider.wallet as anchor.Wallet).payer;
  const connection = provider.connection;
  const outsider = Keypair.generate();
  await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: outsider.publicKey, lamports: 500_000_000,
  })));

  const base = await createMint(connection, payer, payer.publicKey, null, 6);
  const quote = await createMint(connection, payer, payer.publicKey, null, 6);
  const baseAccount = await getOrCreateAssociatedTokenAccount(connection, payer, base, payer.publicKey);
  const quoteAccount = await getOrCreateAssociatedTokenAccount(connection, payer, quote, payer.publicKey);
  const treasury = await getOrCreateAssociatedTokenAccount(connection, payer, quote, outsider.publicKey);
  const outsiderQuote = treasury.address;
  await mintTo(connection, payer, base, baseAccount.address, payer, 100_000_000);
  await mintTo(connection, payer, quote, quoteAccount.address, payer, 100_000_000);
  await mintTo(connection, payer, quote, outsiderQuote, payer, 1_000_000);
  const launch = client.launch(base, payer.publicKey);

  const registerIx = () => program.methods.registerLaunch().accountsStrict({
    authority: payer.publicKey, collector: payer.publicKey, baseMint: base, quoteMint: quote,
    treasury: treasury.address, launch, epoch: client.epoch(launch, 0),
    principalVault: client.principal(launch), rewardVault: client.rewards(launch),
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  }).instruction();
  const register = async () => provider.sendAndConfirm(new Transaction().add(await registerIx()));
  await t.test("rejects community mint with retained mint authority", async () => {
    await assert.rejects(register(), /MutableBaseMint/);
  });
  await setAuthority(connection, payer, base, payer, AuthorityType.MintTokens, null);
  // Prepare schedules atomically with registration to avoid wasting the short
  // test epoch on several account-creation confirmations.
  const registerTx = new Transaction().add(await registerIx());
  for (const index of [1, 8, 31]) {
    registerTx.add(await program.methods.createEpoch(bn(index)).accountsStrict({
      payer: payer.publicKey, launch, epoch: client.epoch(launch, index),
      systemProgram: SystemProgram.programId,
    }).instruction());
  }
  await provider.sendAndConfirm(registerTx);
  const state = await client.launchState(launch);
  assert.equal(state.epochSeconds.toNumber(), 10, "Refusing to wait through production-day epochs");

  async function advanceTo(index: number): Promise<void> {
    let current = (await client.launchState(launch)).currentEpoch.toNumber();
    while (current < index) {
      await client.ensureEpoch(launch, current + 1, payer.publicKey);
      const boundary = state.origin.toNumber() + (current + 1) * 10;
      for (;;) {
        const slot = await connection.getSlot("confirmed");
        const now = await connection.getBlockTime(slot);
        if (now !== null && now >= boundary) break;
        await sleep(500);
      }
      const ix = await client.finalizeIx(launch, current, quote, treasury.address);
      try {
        await provider.sendAndConfirm(new Transaction().add(ix));
        current++;
      } catch (error) {
        if (!String(error).includes("EpochOpen")) throw error;
        await sleep(500);
      }
    }
  }

  async function lockIx(nonce: number, amount: number, tier: number, start: number, end: number) {
    await client.ensureEpoch(launch, start, payer.publicKey);
    await client.ensureEpoch(launch, end, payer.publicKey);
    return program.methods.lockTokens(bn(nonce), bn(amount), tier).accountsStrict({
      owner: payer.publicKey, launch, baseMint: base, source: baseAccount.address,
      principalVault: client.principal(launch), position: client.position(launch, payer.publicKey, nonce),
      startEpoch: client.epoch(launch, start), endEpoch: client.epoch(launch, end),
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction();
  }
  const lock = async (nonce: number, amount: number, tier: number, start: number, end: number) =>
    provider.sendAndConfirm(new Transaction().add(await lockIx(nonce, amount, tier, start, end)));
  await client.ensureEpoch(launch, 1, payer.publicKey);
  await client.ensureEpoch(launch, 8, payer.publicKey);
  await client.ensureEpoch(launch, 31, payer.publicKey);
  await t.test("rejects zero amount and invalid tier", async () => {
    await assert.rejects(lock(99, 0, 0, 1, 8), /ZeroAmount/);
    await assert.rejects(lock(99, 1_000_000, 3, 1, 8), /InvalidTier/);
  });
  await provider.sendAndConfirm(new Transaction().add(
    await lockIx(0, 1_000_000, 0, 1, 8),
    await lockIx(1, 1_000_000, 1, 1, 31),
  ));
  const short = client.position(launch, payer.publicKey, 0);
  const long = client.position(launch, payer.publicKey, 1);
  const withdraw = (position = short, owner = payer.publicKey, signers: Keypair[] = []) => program.methods.withdrawUnlocked().accountsStrict({
    owner, launch, baseMint: base, position, principalVault: client.principal(launch),
    destination: baseAccount.address, tokenProgram: TOKEN_PROGRAM_ID,
  }).signers(signers).rpc();

  await t.test("principal is escrowed and cannot be withdrawn early", async () => {
    assert.equal((await getAccount(connection, client.principal(launch))).amount, 2_000_000n);
    await assert.rejects(withdraw(), /Locked/);
  });
  const fund = (index: number, amount: number, collector = payer.publicKey, source = quoteAccount.address, signers: Keypair[] = []) => program.methods.fundEpoch(bn(amount)).accountsStrict({
    collector, launch, quoteMint: quote, source, rewardVault: client.rewards(launch),
    epoch: client.epoch(launch, index), tokenProgram: TOKEN_PROGRAM_ID,
  }).signers(signers).rpc();

  await t.test("only configured collector can fund receipts", async () => {
    await assert.rejects(fund(0, 1_000_000, outsider.publicKey, outsiderQuote, [outsider]), /ConstraintHasOne/);
  });
  await fund(0, 1_000_000);
  await advanceTo(1);
  await t.test("empty eligible epoch carries locker allocation forward", async () => {
    const s = await client.launchState(launch);
    assert.equal(s.carry.toString(), "750000");
    assert.equal((await client.epochState(launch, 1)).totalWeight.toString(), "2500000");
  });
  await t.test("atomic receipt ingestion reads tokens credited by preceding instruction", async () => {
    const source = await createAccount(connection, payer, quote, payer.publicKey, Keypair.generate());
    const deposit = await program.methods.fundCollectedBalance().accountsStrict({
      collector: payer.publicKey, launch, quoteMint: quote, source,
      rewardVault: client.rewards(launch), epoch: client.epoch(launch, 1), tokenProgram: TOKEN_PROGRAM_ID,
    }).instruction();
    await provider.sendAndConfirm(new Transaction().add(
      createMintToInstruction(quote, source, payer.publicKey, 1_000_000), deposit,
    ));
    assert.equal((await getAccount(connection, source)).amount, 0n);
    assert.equal((await client.epochState(launch, 1)).receipts.toString(), "1000000");
    await assert.rejects(provider.sendAndConfirm(new Transaction().add(deposit)), /ZeroAmount/);
  });
  const claim = async (position: typeof short, index: number) => provider.sendAndConfirm(new Transaction().add(
    await client.claimIx(launch, position, payer.publicKey, quote, quoteAccount.address, index),
  ));
  await t.test("unfinalized epoch cannot be claimed", async () => {
    await assert.rejects(claim(short, 1), /NotFinalized/);
  });
  await advanceTo(2);
  await t.test("1x and 1.5x positions share funded rewards exactly", async () => {
    const before = (await getAccount(connection, quoteAccount.address)).amount;
    await claim(short, 1);
    assert.equal((await getAccount(connection, quoteAccount.address)).amount - before, 600_000n);
    await claim(long, 1);
    assert.equal((await getAccount(connection, quoteAccount.address)).amount - before, 1_500_000n);
    await assert.rejects(claim(short, 1), /WrongEpoch/);
    const s = await client.launchState(launch);
    assert.equal(s.totalPlatformPaid.toString(), "500000");
    assert.equal(s.totalLockerPaid.toString(), "1500000");
  });
  await t.test("another signer cannot withdraw this owner's position", async () => {
    await assert.rejects(
      withdraw(short, outsider.publicKey, [outsider]),
      error => error instanceof anchor.AnchorError
        && error.error.errorCode.code === "ConstraintSeeds"
        && error.error.origin === "position",
    );
  });

  await advanceTo(8);
  await t.test("expired weight is removed and principal can be withdrawn once", async () => {
    assert.equal((await client.epochState(launch, 8)).totalWeight.toString(), "1500000");
    await withdraw();
    assert.equal((await getAccount(connection, client.principal(launch))).amount, 1_000_000n);
    await assert.rejects(withdraw(), /AlreadyWithdrawn/);
  });
  await t.test("historical claims survive withdrawal; closing requires all claims", async () => {
    const close = () => program.methods.closePosition().accountsStrict({ owner: payer.publicKey, position: short }).rpc();
    await assert.rejects(close(), /ClaimsRemaining/);
    for (let i = 2; i < 8; i++) await claim(short, i);
    await assert.rejects(claim(short, 8), /NotFinalized|WrongEpoch/);
    await close();
    assert.equal(await connection.getAccountInfo(short), null);
  });
  await t.test("quote funding reconciles with platform, holder, and escrow balances", async () => {
    const s = await client.launchState(launch);
    const vault = (await getAccount(connection, client.rewards(launch))).amount;
    assert.equal(BigInt(s.totalReceived.toString()), BigInt(s.totalPlatformPaid.toString()) + BigInt(s.totalLockerPaid.toString()) + vault);
  });
});
