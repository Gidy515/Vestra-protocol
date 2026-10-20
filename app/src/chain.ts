import { rpcTransport } from "./rpc-transport";
import type { Wallet } from "./wallet";
export type { Wallet } from "./wallet";
export { localWallet, injectedWallet } from "./wallet";
import { AnchorProvider, BN, Program, type Idl } from "@anchor-lang/core";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  ComputeBudgetProgram,
  type Signer,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import {
  DynamicBondingCurveClient,
  SwapMode,
  deriveDbcPoolAddress,
  deriveDammV2PoolAddress,
  deriveDbcPoolAuthority,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { rewardForEpoch, claimWindow, claimBatches } from "./rewards";
import { rawAmount } from "../../scripts/meteora/config";

export type Bootstrap = {
  cluster: "localnet" | "devnet";
  session: string;
  genesis: string;
  program: string;
  quote: string;
  quoteDecimals: number;
  config: string;
  collector: string;
  treasury: string;
  dammConfig: string;
  idl: Idl;
  rpc: string;
  mockQuote: boolean;
  hosted?: boolean;
};
export type Launch = {
  name: string;
  symbol: string;
  avatar: string;
  address: string;
  base: string;
  pool: string;
  dammPool: string;
  creator: string;
  authority: string;
  quote: string;
  config: string;
  treasury: string;
  collector: string;
  dammConfig: string;
  migrated: boolean;
  reserve: string;
  threshold: string;
  funded: string;
  platformPaid: string;
  lockerPaid: string;
  locked: string;
  currentEpoch: number;
  epochSeconds: number;
  origin: number;
  sqrtPrice: string;
  supply: string;
};
export type Position = {
  address: string;
  nonce: string;
  amount: string;
  weight: string;
  start: number;
  end: number;
  next: number;
  withdrawn: boolean;
  reward: string;
  unlockAt: number;
};
export const pk = (s: string) => new PublicKey(s),
  bn = (v: number | string | bigint) => new BN(v.toString());
export function units(
  value: string | bigint,
  decimals = 6,
  maxFraction = 6,
): string {
  const n = BigInt(value),
    scale = 10n ** BigInt(decimals),
    whole = n / scale,
    fraction = (n % scale)
      .toString()
      .padStart(decimals, "0")
      .slice(0, maxFraction)
      .replace(/0+$/, "");
  return `${whole}${fraction ? "." + fraction : ""}`;
}
export function price(l: Launch) {
  return (Number(l.sqrtPrice) / 2 ** 64) ** 2;
}
export function progress(l: Launch) {
  return Math.max(
    0,
    Math.min(100, (Number(l.reserve) / Number(l.threshold)) * 100),
  );
}
export async function api<T>(
  path: string,
  boot?: Bootstrap,
  data?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers:
      data === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-Vestra-Session": boot!.session,
          },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error("Vestra service is unavailable. Keep the backend running and retry shortly."); }
  if (!response.ok)
    throw new Error(result.error || "Vestra service request failed");
  return result;
}
export class Chain {
  connection: Connection;
  provider: AnchorProvider;
  program: Program;
  dbc: DynamicBondingCurveClient;
  amm: CpAmm;
  constructor(
    readonly boot: Bootstrap,
    readonly wallet: Wallet,
    readonly confirmed: (sig: string) => void,
  ) {
    if (boot.cluster === "devnet") {
      if (boot.genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" || new URL(boot.rpc).protocol !== "https:")
        throw new Error("Invalid devnet configuration");
    } else if (boot.cluster !== "localnet" || !["127.0.0.1", "localhost"].includes(new URL(boot.rpc).hostname))
      throw new Error("Invalid localnet configuration");
    this.connection = new Connection(boot.rpc, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: rpcTransport() });
    this.provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });
    this.program = new Program(boot.idl, this.provider);
    this.dbc = new DynamicBondingCurveClient(this.connection, "confirmed");
    this.amm = new CpAmm(this.connection);
  }
  pda(...seeds: Buffer[]) {
    return PublicKey.findProgramAddressSync(seeds, this.program.programId)[0];
  }
  u64(n: number | bigint) {
    let value = BigInt(n);
    if (value < 0n || value > 0xffffffffffffffffn)
      throw new RangeError("Value must fit in an unsigned 64-bit integer");
    const b = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
      b[i] = Number(value & 0xffn);
      value >>= 8n;
    }
    return b;
  }
  launch(base: PublicKey, authority: PublicKey) {
    return this.pda(
      Buffer.from("launch"),
      base.toBuffer(),
      authority.toBuffer(),
    );
  }
  epoch(l: PublicKey, n: number) {
    return this.pda(Buffer.from("epoch"), l.toBuffer(), this.u64(n));
  }
  vault(kind: "principal" | "rewards", l: PublicKey) {
    return this.pda(Buffer.from(kind), l.toBuffer());
  }
  position(l: PublicKey, nonce: bigint) {
    return this.pda(
      Buffer.from("position"),
      l.toBuffer(),
      this.wallet.publicKey.toBuffer(),
      this.u64(nonce),
    );
  }
  async state(l: Launch): Promise<any> {
    return (this.program.account as any).launch.fetch(pk(l.address));
  }
  async time() {
    const slot = await this.connection.getSlot();
    const time = await this.connection.getBlockTime(slot);
    if (time === null) throw new Error("Chain time unavailable");
    return time;
  }
  async send(tx: Transaction, signers: Signer[] = []) {
    if ((await this.connection.getGenesisHash()) !== this.boot.genesis)
      throw new Error(
        "Validator changed. Reload the app after restarting its service.",
      );
    if (
      !tx.instructions.some((ix) =>
        ix.programId.equals(ComputeBudgetProgram.programId),
      )
    )
      tx.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      );
    const signature = await this.provider.sendAndConfirm(tx, signers);
    this.confirmed(signature);
    return signature;
  }
  async balances(l: Launch) {
    const balance = async (m: string) => {
      try {
        return (
          await this.connection.getTokenAccountBalance(
            getAssociatedTokenAddressSync(pk(m), this.wallet.publicKey),
          )
        ).value.amount;
      } catch (e) {
        const a = await this.connection.getAccountInfo(
          getAssociatedTokenAddressSync(pk(m), this.wallet.publicKey),
        );
        if (!a) return "0";
        throw e;
      }
    };
    return {
      base: await balance(l.base),
      quote: await balance(l.quote),
      sol: await this.connection.getBalance(this.wallet.publicKey),
    };
  }
  async quote(l: Launch, buy: boolean, input: string, slippageBps: number) {
    if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500)
      throw new Error("Slippage must be 0.1–5%");
    const amount = bn(rawAmount(input, 6));
    if (l.migrated) {
      const pool = await this.amm.fetchPoolState(pk(l.dammPool));
      const q = this.amm.getQuote({
        inAmount: amount,
        inputTokenMint: pk(buy ? l.quote : l.base),
        slippage: slippageBps / 100,
        poolState: pool,
        currentTime: await this.time(),
        currentSlot: await this.connection.getSlot(),
        tokenADecimal: 6,
        tokenBDecimal: 6,
      });
      return {
        out: q.swapOutAmount.toString(),
        min: q.minSwapOutAmount,
        amount,
        pool,
        venue: "DAMM v2",
        partial: false,
      };
    }
    const pool = await this.dbc.state.getPool(pk(l.pool)),
      config = await this.dbc.state.getPoolConfig(pk(l.config));
    if (!pool || !config) throw new Error("Curve unavailable");
    if (pool.poolState.isMigrated)
      throw new Error("Pool just graduated. Refresh before trading.");
    if (pool.poolState.quoteReserve.gte(config.migrationQuoteThreshold))
      throw new Error("Curve complete. Graduate this launch before trading.");
    const q = this.dbc.pool.swapQuote2({
      swapMode: SwapMode.PartialFill,
      virtualPool: pool,
      config,
      swapBaseForQuote: !buy,
      amountIn: amount,
      slippageBps,
      hasReferral: false,
      eligibleForFirstSwapWithMinFee: false,
      currentPoint: bn(await this.time()),
    });
    if (!q.minimumAmountOut) throw new Error("Quote unavailable");
    return {
      out: q.outputAmount.toString(),
      min: q.minimumAmountOut,
      amount,
      pool: null,
      venue: "DBC",
      partial: true,
    };
  }
  async trade(l: Launch, buy: boolean, input: string, slippageBps: number) {
    const q = await this.quote(l, buy, input, slippageBps); // always obtain a fresh quote at submission
    if (q.pool) {
      const s = q.pool;
      return this.send(
        await this.amm.swap({
          payer: this.wallet.publicKey,
          pool: pk(l.dammPool),
          inputTokenMint: pk(buy ? l.quote : l.base),
          outputTokenMint: pk(buy ? l.base : l.quote),
          amountIn: q.amount,
          minimumAmountOut: q.min,
          tokenAMint: s.tokenAMint,
          tokenBMint: s.tokenBMint,
          tokenAVault: s.tokenAVault,
          tokenBVault: s.tokenBVault,
          tokenAProgram: TOKEN_PROGRAM_ID,
          tokenBProgram: TOKEN_PROGRAM_ID,
          referralTokenAccount: null,
        }),
      );
    }
    return this.send(
      await this.dbc.pool.swap2({
        swapMode: SwapMode.PartialFill,
        owner: this.wallet.publicKey,
        pool: pk(l.pool),
        amountIn: q.amount,
        minimumAmountOut: q.min,
        swapBaseForQuote: !buy,
        referralTokenAccount: null,
      }),
    );
  }
  async lock(l: Launch, input: string, tier: number) {
    if (![0, 1, 2].includes(tier)) throw new Error("Invalid lock duration");
    let s = await this.state(l);
    if (await this.time() >= s.origin.toNumber() + (s.currentEpoch.toNumber() + 1) * s.epochSeconds.toNumber()) {
      await api("keeper", this.boot, {});
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        s = await this.state(l);
        if (await this.time() < s.origin.toNumber() + (s.currentEpoch.toNumber() + 1) * s.epochSeconds.toNumber()) break;
      }
    }
    const index = s.currentEpoch.toNumber(),
      start = index + 1,
      end = start + [7, 30, 90][tier];
    if (
      (await this.time()) >=
      s.origin.toNumber() + (index + 1) * s.epochSeconds.toNumber()
    )
      throw new Error("Keeper is catching up. Retry after the next refresh.");
    const address = pk(l.address);
    const tx = new Transaction();
    const indices = [start, end];
    const schedules = await this.connection.getMultipleAccountsInfo(
      indices.map(index => this.epoch(address, index)),
    );
    for (let i = 0; i < indices.length; i++) {
      if (schedules[i]) continue;
      tx.add(await this.program.methods.createEpoch(bn(indices[i]))
        .accountsStrict({
          payer: this.wallet.publicKey,
          launch: address,
          epoch: this.epoch(address, indices[i]),
          systemProgram: SystemProgram.programId,
        }).instruction());
    }
    const nonce = BigInt(
      "0x" +
        Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join(""),
    );
    return this.send(
      tx.add(
        await this.program.methods
          .lockTokens(bn(nonce), bn(rawAmount(input, 6)), tier)
          .accountsStrict({
            owner: this.wallet.publicKey,
            launch: address,
            baseMint: pk(l.base),
            source: getAssociatedTokenAddressSync(
              pk(l.base),
              this.wallet.publicKey,
            ),
            principalVault: this.vault("principal", address),
            position: this.position(address, nonce),
            startEpoch: this.epoch(address, start),
            endEpoch: this.epoch(address, end),
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      ),
    );
  }
  private epochCache = new Map<string, any>();
  private positionRows: { at: number; value: Promise<any[]> } | null = null;
  async positions(l: Launch): Promise<Position[]> {
    if (!this.positionRows || Date.now() - this.positionRows.at > 2000) {
      const value = (this.program.account as any).lockPosition.all();
      this.positionRows = { at: Date.now(), value };
      value.catch(() => { if (this.positionRows?.value === value) this.positionRows = null; });
    }
    const rows = await this.positionRows.value,
      state = await this.state(l),
      list: Position[] = [];
    for (const { publicKey, account: p } of rows) {
      if (
        !p.owner.equals(this.wallet.publicKey) ||
        !p.launch.equals(pk(l.address))
      )
        continue;
      let reward = 0n;
      const end = Math.min(
        state.currentEpoch.toNumber(),
        p.endEpoch.toNumber(),
      );
      const missing: number[] = [];
      for (let i = p.nextClaimEpoch.toNumber(); i < end; i++)
        if (!this.epochCache.has(`${l.address}:${i}`)) missing.push(i);
      for (let offset = 0; offset < missing.length; offset += 50) {
        const indices = missing.slice(offset, offset + 50);
        const epochs = await (this.program.account as any).epoch.fetchMultiple(indices.map(i => this.epoch(pk(l.address), i)));
        epochs.forEach((epoch: any, index: number) => {
          if (epoch?.finalized) this.epochCache.set(`${l.address}:${indices[index]}`, epoch);
        });
      }
      for (let i = p.nextClaimEpoch.toNumber(); i < end; i++) {
        const e = this.epochCache.get(`${l.address}:${i}`);
        if (!e) throw new Error("Reward epoch data is unavailable. Please retry shortly.");
        reward += rewardForEpoch(
          e.rewards.toString(),
          p.weight.toString(),
          e.totalWeight.toString(),
          e.finalized,
        );
      }
      list.push({
        address: publicKey.toBase58(),
        nonce: p.nonce.toString(),
        amount: p.amount.toString(),
        weight: p.weight.toString(),
        start: p.startEpoch.toNumber(),
        end: p.endEpoch.toNumber(),
        next: p.nextClaimEpoch.toNumber(),
        withdrawn: p.withdrawn,
        reward: reward.toString(),
        unlockAt:
          state.origin.toNumber() +
          p.endEpoch.toNumber() * state.epochSeconds.toNumber(),
      });
    }
    return list.sort((a, b) => b.start - a.start);
  }
  async claim(l: Launch, p: Position) {
    const owner = this.wallet.publicKey,
      launch = pk(l.address),
      destination = getAssociatedTokenAddressSync(pk(l.quote), owner);
    const state = await this.state(l);
    const indices = claimWindow(p.next, state.currentEpoch.toNumber(), p.end);
    // Confirm batches in order: every instruction advances the same claim cursor.
    // A failed or rejected batch rolls back; a refresh resumes from chain state.
    for (const batch of claimBatches(indices)) {
      const tx = new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          owner, destination, owner, pk(l.quote),
        ),
      );
      for (const index of batch) {
        tx.add(await this.program.methods.claimEpoch().accountsStrict({
          owner,
          launch,
          quoteMint: pk(l.quote),
          position: pk(p.address),
          epoch: this.epoch(launch, index),
          rewardVault: this.vault("rewards", launch),
          destination,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).instruction());
      }
      await this.send(tx);
    }
  }
  async withdraw(l: Launch, p: Position) {
    const owner = this.wallet.publicKey,
      launch = pk(l.address),
      destination = getAssociatedTokenAddressSync(pk(l.base), owner);
    return this.send(
      new Transaction().add(
        createAssociatedTokenAccountIdempotentInstruction(
          owner,
          destination,
          owner,
          pk(l.base),
        ),
        await this.program.methods
          .withdrawUnlocked()
          .accountsStrict({
            owner,
            launch,
            baseMint: pk(l.base),
            position: pk(p.address),
            principalVault: this.vault("principal", launch),
            destination,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ),
    );
  }
  async graduate(l: Launch) {
    const pool = await this.dbc.state.getPool(pk(l.pool)),
      config = await this.dbc.state.getPoolConfig(pk(l.config));
    if (
      !pool ||
      !config ||
      pool.poolState.quoteReserve.lt(config.migrationQuoteThreshold)
    )
      throw new Error("Curve threshold not reached");
    const m = await this.dbc.migration.migrateToDammV2({
      payer: this.wallet.publicKey,
      pool: pk(l.pool),
      dammConfig: pk(l.dammConfig),
    });
    const authority = deriveDbcPoolAuthority(),
      balance = await this.connection.getBalance(authority);
    if (this.boot.cluster === "devnet" && balance < 50_000_000)
      throw new Error("Meteora devnet migration authority is underfunded; contact the operator");
    if (this.boot.cluster === "localnet" && balance < 1_000_000_000)
      m.transaction.instructions.unshift(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: authority,
          lamports: 1_000_000_000 - balance,
        }),
      );
    return this.send(m.transaction, [
      m.firstPositionNftKeypair,
      m.secondPositionNftKeypair,
    ]);
  }
  async creatorFees(l: Launch) {
    const owner = this.wallet.publicKey;
    if (!owner.equals(pk(l.creator)))
      throw new Error("Connect the launch creator wallet");
    let collected = false;
    const fees = await this.dbc.state.getPoolFeeMetrics(pk(l.pool));
    if (!fees.current.creatorQuoteFee.isZero()) {
      await this.send(
        await this.dbc.creator.claimCreatorTradingFee({
          creator: owner,
          payer: owner,
          pool: pk(l.pool),
          maxBaseAmount: bn(0),
          maxQuoteAmount: bn("18446744073709551615"),
          receiver: owner,
        }),
      );
      collected = true;
    }
    if (l.migrated) {
      const state = await this.amm.fetchPoolState(pk(l.dammPool));
      for (const p of await this.amm.getUserPositionByPool(
        pk(l.dammPool),
        owner,
      )) {
        await this.send(
          await this.amm.claimPositionFee({
            owner,
            position: p.position,
            positionNftAccount: p.positionNftAccount,
            pool: pk(l.dammPool),
            tokenAMint: state.tokenAMint,
            tokenBMint: state.tokenBMint,
            tokenAVault: state.tokenAVault,
            tokenBVault: state.tokenBVault,
            tokenAProgram: TOKEN_PROGRAM_ID,
            tokenBProgram: TOKEN_PROGRAM_ID,
            receiver: owner,
            feePayer: owner,
          }),
        );
        collected = true;
      }
    }
    if (!collected) throw new Error("No creator fees available yet");
  }
  async create(
    name: string,
    symbol: string,
    avatar: string,
    onStep: (s: string) => void,
  ) {
    const saved = sessionStorage.getItem("vestra-launch-draft");
    const draft = saved
      ? JSON.parse(saved)
      : {
          name,
          symbol,
          avatar,
          key: Array.from(Keypair.generate().secretKey),
          owner: this.wallet.publicKey.toBase58(),
          config: this.boot.config,
          genesis: this.boot.genesis,
        };
    if (
      draft.owner !== this.wallet.publicKey.toBase58() ||
      draft.genesis !== this.boot.genesis ||
      draft.config !== this.boot.config
    )
      throw new Error(
        "Unfinished launch belongs to another wallet or validator. Discard it in the launch dialog.",
      );
    sessionStorage.setItem("vestra-launch-draft", JSON.stringify(draft));
    const key = Keypair.fromSecretKey(Uint8Array.from(draft.key)),
      base = key.publicKey,
      owner = this.wallet.publicKey;
    const pool = deriveDbcPoolAddress(
        pk(this.boot.quote),
        base,
        pk(this.boot.config),
      ),
      launch = this.launch(base, owner);
    onStep("Creating DBC pool…");
    if (!(await this.connection.getAccountInfo(pool)))
      await this.send(
        await this.dbc.creator.createPool({
          name: draft.name,
          symbol: draft.symbol,
          uri: "",
          payer: owner,
          poolCreator: owner,
          config: pk(this.boot.config),
          baseMint: base,
        }),
        [key],
      );
    onStep("Registering lock and reward vaults…");
    if (!(await this.connection.getAccountInfo(launch)))
      await this.send(
        new Transaction().add(
          await this.program.methods
            .registerLaunch()
            .accountsStrict({
              authority: owner,
              collector: pk(this.boot.collector),
              baseMint: base,
              quoteMint: pk(this.boot.quote),
              treasury: pk(this.boot.treasury),
              launch,
              epoch: this.epoch(launch, 0),
              principalVault: this.vault("principal", launch),
              rewardVault: this.vault("rewards", launch),
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .instruction(),
        ),
      );
    onStep("Saving launch metadata…");
    let signature: string | undefined;
    if (this.boot.hosted) {
      if (!this.wallet.signMessage) throw new Error("This wallet must support message signing to name the launch");
      const message = JSON.stringify({purpose: "Vestra launch metadata v1", genesis: this.boot.genesis, launch: launch.toBase58(), name: draft.name, symbol: draft.symbol, avatar: draft.avatar});
      onStep("Approve the launch name in your wallet…");
      signature = Array.from(await this.wallet.signMessage(new TextEncoder().encode(message)), n => n.toString(16).padStart(2, "0")).join("");
    }
    await api("catalog", this.boot, {
      signature,
      launch: launch.toBase58(),
      name: draft.name,
      symbol: draft.symbol,
      avatar: draft.avatar,
    });
    sessionStorage.removeItem("vestra-launch-draft");
    return launch.toBase58();
  }
}
