import { EpochBacklogError, pendingEpochs } from '../epoch-catchup';
import { EPOCHS_PER_TRANSACTION } from '../epoch-batch';
import { recoverConfirmation } from '../confirmation';
import * as anchor from '@anchor-lang/core';
import {
  Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram, Signer,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getMint, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VestraClient, loadProgram } from '../client';

import { network, assertGenesis } from '../network';
export const NETWORK = network();
export const STATE_DIR = NETWORK.stateDir;
export const STATE_FILE = path.join(STATE_DIR, 'launch.json');
export type Manifest = {
  version: 1; genesis: string; program: string; authority: string;
  creator: string; quote: string; quoteDecimals: number; mockQuote: boolean;
  config: string; base: string; dbcPool: string; launch: string;
  collector: string; collectorKey: string; treasury: string;
  dammConfig: string; dammPool?: string; registered?: boolean;
};
export const pk = (value: string) => new PublicKey(value);
export const bn = (value: bigint | number | string) => new anchor.BN(value.toString());
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export function save(m: Manifest): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const temp = STATE_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(m, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, STATE_FILE);
}
export function keyFile(name: string): { key: Keypair; file: string } {
  const file = path.join(STATE_DIR, 'keys', name + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) return { key: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')))), file };
  const key = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(key.secretKey)), { mode: 0o600, flag: 'wx' });
  return { key, file };
}
export function context() {
  const rpc = NETWORK.rpc;
  if (NETWORK.cluster === 'devnet' && !process.env.ANCHOR_WALLET)
    throw new Error('Set ANCHOR_WALLET to your dedicated devnet keypair');
  const walletPath = (process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json')).replace(/^~\//, os.homedir() + '/');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf8'))));
  const connection = new Connection(rpc, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: 'confirmed' });
  const program = loadProgram(provider);
  const client = new VestraClient(program);
  return { connection, payer, provider, program, client };
}
export type Runtime = ReturnType<typeof context>;
export async function verifyNetwork(c: Runtime): Promise<void> {
  assertGenesis(NETWORK.cluster, await c.connection.getGenesisHash());
}
export async function load(c: Runtime): Promise<Manifest> {
  await verifyNetwork(c);
  const m: Manifest = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (m.version !== 1 || m.genesis !== await c.connection.getGenesisHash()) throw new Error('Manifest belongs to another validator. Use a new .vestra directory after ledger reset.');
  if (m.authority !== c.payer.publicKey.toBase58() || m.program !== c.program.programId.toBase58()) throw new Error('Wallet/program differs from manifest');
  return m;
}
export async function send(c: Runtime, tx: Transaction, signers: Signer[] = []): Promise<string> {
  await verifyNetwork(c);
  const alreadyBudget = tx.instructions.some(ix => ix.programId.equals(ComputeBudgetProgram.programId));
  if (!alreadyBudget) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  // Anchor 1.1.2 otherwise uses signature-only confirmation (30-second timeout).
  // Bind confirmation to the exact blockhash/expiry used to sign this transaction.
  const blockhash = await c.connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash.blockhash;
  let signature: string;
  try {
    signature = await c.provider.sendAndConfirm(tx, signers, {
      ...c.provider.opts, commitment: 'confirmed', preflightCommitment: 'confirmed',
      blockhash, maxRetries: 3,
    });
  } catch (error) {
    const reported = (error as {signature?: unknown})?.signature;
    const candidate = typeof reported === 'string' ? reported
      : tx.signature ? anchor.utils.bytes.bs58.encode(tx.signature) : undefined;
    if (!candidate || !await recoverConfirmation(candidate, async sig =>
      (await c.connection.getSignatureStatuses([sig], {searchTransactionHistory:true})).value[0])) throw error;
    signature = candidate;
    console.log('Recovered confirmed transaction after RPC error:', signature);
  }
  console.log('Confirmed:', signature);
  return signature;
}
export async function preflightMint(c: Runtime, mint: PublicKey) {
  if (mint.equals(NATIVE_MINT)) throw new Error('This receipt path requires an ordinary SPL quote mint; native SOL unwrap is not supported.');
  const account = await c.connection.getAccountInfo(mint);
  if (!account || !account.owner.equals(TOKEN_PROGRAM_ID)) throw new Error('Quote mint must use legacy SPL Token. Token-2022 is not supported by this core.');
  return getMint(c.connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
}
export async function ata(c: Runtime, mint: PublicKey, owner: PublicKey) {
  await verifyNetwork(c);
  return (await getOrCreateAssociatedTokenAccount(c.connection, c.payer, mint, owner)).address;
}
export async function chainTime(c: Runtime): Promise<number> {
  const slot = await c.connection.getSlot('confirmed');
  const time = await c.connection.getBlockTime(slot);
  if (time === null) throw new Error('RPC did not return chain time');
  return time;
}
export async function catchUp(c: Runtime, m: Manifest, budget = 200): Promise<number> {
  const launch = pk(m.launch);
  let processed = 0;
  while (processed < budget) {
    const s = await c.client.launchState(launch);
    const index = s.currentEpoch.toNumber();
    const remaining = pendingEpochs(s.origin.toNumber(), s.epochSeconds.toNumber(), index, await chainTime(c));
    if (!remaining) return index;
    const count = Math.min(remaining, EPOCHS_PER_TRANSACTION, budget - processed);
    const tx = await c.client.epochBatch(launch, index, count, c.payer.publicKey, pk(m.quote), pk(m.treasury));
    await send(c, tx);
    processed += count;
  }
  const s = await c.client.launchState(launch);
  const index = s.currentEpoch.toNumber();
  const remaining = pendingEpochs(s.origin.toNumber(), s.epochSeconds.toNumber(), index, await chainTime(c));
  if (remaining) throw new EpochBacklogError(remaining);
  return index;
}
