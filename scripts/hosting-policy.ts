import fs from 'node:fs';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';

export function publicOrigin(value?: string): URL | undefined {
  if (!value) return;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('VESTRA_PUBLIC_ORIGIN must be an HTTPS origin without a path or credentials');
  return url;
}
export function allowedPublicRequest(url: URL, host: string, origin: string | undefined, method: string, apiHost = url.host): boolean {
  return host === apiHost && (method === 'GET' || method === 'HEAD'
    ? !origin || origin === url.origin
    : method === 'POST' && origin === url.origin);
}
export function metadataMessage(genesis: string, launch: string, name: string, symbol: string, avatar: string): string {
  return JSON.stringify({ purpose: 'Vestra launch metadata v1', genesis, launch, name, symbol, avatar });
}
export function verifyMetadata(owner: Uint8Array, message: string, signature: unknown): boolean {
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/.test(signature)) return false;
  const key = createPublicKey({key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(owner)]), format: 'der', type: 'spki'});
  return verify(null, Buffer.from(message), key, Buffer.from(signature, 'hex'));
}
/** Reserve before any transfer. Ambiguous/failed transfers consume the reservation. */
export function reservePublicFunding(file: string, wallet: string, limit: number): boolean {
  const state: {total: number; wallets: Record<string, number>} = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8')) : {total: 0, wallets: {}};
  if (!Number.isSafeInteger(state.total) || state.total < 0 || !state.wallets)
    throw new Error('Invalid faucet ledger');
  if (state.total >= limit) return false;
  if ((state.wallets[wallet] || 0) >= 3) return false;
  state.total++;
  state.wallets[wallet] = (state.wallets[wallet] || 0) + 1;
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  fs.writeFileSync(file + '.tmp', JSON.stringify(state), {mode: 0o600});
  fs.renameSync(file + '.tmp', file);
  return true;
}
