import * as anchor from '@anchor-lang/core';
import {
  Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram, Signer,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getMint, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { VestraClient, loadProgram } from '../client';

export const STATE_FILE = path.resolve('.vestra/launch.json');
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
  const file = path.resolve('.vestra/keys', name + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) return { key: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')))), file };
  const key = Keypair.generate();
  fs.writeFileSync(file, JSON.stringify(Array.from(key.secretKey)), { mode: 0o600, flag: 'wx' });
  return { key, file };
}
export function context() {
  const rpc = process.env.ANCHOR_PROVIDER_URL || 'http://127.0.0.1:8899';
  const url = new URL(rpc);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    // This harness intentionally only spends local validator funds.
    throw new Error('Meteora harness supports localhost only. Real-asset deployment needs a separate reviewed configuration.');
  }
  const walletPath = (process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json')).replace(/^~\//, os.homedir() + '/');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf8'))));
  const connection = new Connection(rpc, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: 'confirmed' });
  const program = loadProgram(provider);
  const client = new VestraClient(program);
  return { connection, payer, provider, program, client };
}
export type Runtime = ReturnType<typeof context>;
export async function load(c: Runtime): Promise<Manifest> {
  const m: Manifest = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (m.version !== 1 || m.genesis !== await c.connection.getGenesisHash()) throw new Error('Manifest belongs to another validator. Use a new .vestra directory after ledger reset.');
  if (m.authority !== c.payer.publicKey.toBase58() || m.program !== c.program.programId.toBase58()) throw new Error('Wallet/program differs from manifest');
  return m;
}
export async function send(c: Runtime, tx: Transaction, signers: Signer[] = []): Promise<string> {
  const alreadyBudget = tx.instructions.some(ix => ix.programId.equals(ComputeBudgetProgram.programId));
  if (!alreadyBudget) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  const signature = await c.provider.sendAndConfirm(tx, signers);
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
  return (await getOrCreateAssociatedTokenAccount(c.connection, c.payer, mint, owner)).address;
}
export async function chainTime(c: Runtime): Promise<number> {
  const slot = await c.connection.getSlot('confirmed');
  const time = await c.connection.getBlockTime(slot);
  if (time === null) throw new Error('RPC did not return chain time');
  return time;
}
export async function catchUp(c: Runtime, m: Manifest): Promise<number> {
  const launch = pk(m.launch);
  for (let attempts = 0; attempts < 200; attempts++) {
    const s = await c.client.launchState(launch);
    const index = s.currentEpoch.toNumber();
    if (await chainTime(c) < s.origin.toNumber() + (index + 1) * s.epochSeconds.toNumber()) return index;
    await c.client.ensureEpoch(launch, index + 1, c.payer.publicKey);
    await send(c, new Transaction().add(await c.client.finalizeIx(launch, index, pk(m.quote), pk(m.treasury))));
  }
  throw new Error('Catch-up limit reached; rerun keeper to continue');
}
