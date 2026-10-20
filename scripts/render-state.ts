import { initializeRenderState } from './render-bootstrap';
import fs from 'node:fs';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { DEVNET_GENESIS } from './network';

const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
function key(value: number[]) { return Keypair.fromSecretKey(Uint8Array.from(value)); }
const mode = process.argv[2];
if (mode === 'export') {
  const state = path.resolve('.vestra/devnet');
  const manifest = read(path.join(state, 'launch.json'));
  const operatorFile = process.env.ANCHOR_WALLET;
  if (!operatorFile) throw new Error('Set ANCHOR_WALLET to the devnet operator');
  if (manifest.genesis !== DEVNET_GENESIS) throw new Error('Expected devnet state');
  const collector = read(manifest.collectorKey), operator = read(operatorFile);
  if (key(collector).publicKey.toBase58() !== manifest.collector) throw new Error('Collector mismatch');
  key(operator);
  const idl = read('target/idl/vestra.json');
  if (idl.address !== manifest.program) throw new Error('IDL program mismatch');
  const optional = (name: string) => fs.existsSync(path.join(state, name)) ? read(path.join(state, name)) : undefined;
  const bundle = {manifest, collector, operator, idl, catalog: optional('catalog.json'), faucet: optional('faucet-ledger.json')};
  const file = path.resolve('.vestra/render-bootstrap.json');
  const serialized = JSON.stringify(bundle);
  if (Buffer.byteLength(serialized) > 900_000) throw new Error('Bootstrap is too large for this secret-file workflow');
  fs.writeFileSync(file, serialized, {mode: 0o600, flag: 'wx'});
  console.log('Prepared private .vestra/render-bootstrap.json. Upload only as a Render Secret File named vestra-bootstrap.json. Never commit or paste it into chat.');
} else if (mode === 'start') {
  if (process.env.VESTRA_CLUSTER !== 'devnet') throw new Error('Managed demo requires devnet');
  const directory = process.env.VESTRA_STATE_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error('Set an absolute VESTRA_STATE_DIR on a persistent disk');
  if (process.env.RENDER === 'true') {
    const mounted = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.split(' ')[4] === '/var/data');
    if (!directory.startsWith('/var/data/') || !mounted) throw new Error('Render persistent disk must be mounted at /var/data');
  }
  const bundle = read('/etc/secrets/vestra-bootstrap.json');
  const operatorFile = initializeRenderState(bundle, directory);
  process.env.ANCHOR_WALLET = operatorFile;
  fs.mkdirSync('target/idl', {recursive:true});
  fs.writeFileSync('target/idl/vestra.json', JSON.stringify(bundle.idl), {mode:0o600});
  // Keys and manifest are ready before the service imports its network/runtime.
  void import('./frontend-server').catch(error => {console.error(error); process.exitCode = 1;});
} else throw new Error('Usage: node --import tsx scripts/render-state.ts export|start');
