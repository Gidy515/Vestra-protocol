import fs from 'node:fs';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { DEVNET_GENESIS } from './network';
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const key = (value: number[]) => Keypair.fromSecretKey(Uint8Array.from(value));
export function initializeRenderState(bundle: any, directory: string): string {
  const m = bundle.manifest;
  if (m.genesis !== DEVNET_GENESIS || bundle.idl.address !== m.program || key(bundle.collector).publicKey.toBase58() !== m.collector)
    throw new Error('Bootstrap identity mismatch');
  key(bundle.operator);
  fs.mkdirSync(path.join(directory, 'keys'), {recursive:true, mode:0o700});
  const manifestFile = path.join(directory, 'launch.json');
  const collectorFile = path.join(directory, 'keys/collector.json');
  const operatorFile = path.join(directory, 'keys/operator.json');
  if (fs.existsSync(manifestFile)) {
    const existing = read(manifestFile);
    if (existing.launch !== m.launch || existing.genesis !== m.genesis || existing.collector !== m.collector)
      throw new Error('Persistent deployment differs from bootstrap; refusing overwrite');
    if (key(read(collectorFile)).publicKey.toBase58() !== m.collector || key(read(operatorFile)).publicKey.toBase58() !== key(bundle.operator).publicKey.toBase58())
      throw new Error('Persistent key identity mismatch');
  } else {
    const writeNew = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value), {mode:0o600, flag:'wx'});
    writeNew(collectorFile, bundle.collector);
    writeNew(operatorFile, bundle.operator);
    if (bundle.catalog) writeNew(path.join(directory, 'catalog.json'), bundle.catalog);
    if (bundle.faucet) writeNew(path.join(directory, 'faucet-ledger.json'), bundle.faucet);
    writeNew(manifestFile, {...m, collectorKey:collectorFile});
  }
  return operatorFile;
}
