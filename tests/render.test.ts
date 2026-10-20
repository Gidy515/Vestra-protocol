import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Keypair } from '@solana/web3.js';
import { DEVNET_GENESIS, network } from '../scripts/network';
test('managed state directory is selected explicitly without changing the default', () => {
  assert.equal(network({VESTRA_CLUSTER:'devnet', VESTRA_STATE_DIR:'/var/data/vestra'}).stateDir, '/var/data/vestra');
  assert.equal(network({VESTRA_CLUSTER:'devnet'}).stateDir, path.resolve('.vestra/devnet'));
});
test('Render export preserves identities and IDL, excludes deployment buffer and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vestra-render-'));
  const loader = path.resolve('node_modules/tsx/dist/loader.mjs');
  const script = path.resolve('scripts/render-state.ts');
  try {
    const state = path.join(temp, '.vestra/devnet');
    fs.mkdirSync(state, {recursive:true});
    fs.mkdirSync(path.join(temp, 'target/idl'), {recursive:true});
    const collector = Keypair.generate(), operator = Keypair.generate();
    const collectorFile = path.join(temp, 'collector.json'), operatorFile = path.join(temp, 'operator.json');
    fs.writeFileSync(collectorFile, JSON.stringify(Array.from(collector.secretKey)));
    fs.writeFileSync(operatorFile, JSON.stringify(Array.from(operator.secretKey)));
    const program = Keypair.generate().publicKey.toBase58();
    fs.writeFileSync(path.join(temp, 'target/idl/vestra.json'), JSON.stringify({address:program}));
    fs.writeFileSync(path.join(state, 'launch.json'), JSON.stringify({genesis:DEVNET_GENESIS, program, collector:collector.publicKey.toBase58(), collectorKey:collectorFile}));
    fs.writeFileSync(path.join(state, 'deploy-buffer.json'), 'do not export');
    const args = ['--import', loader, script, 'export'];
    const options = {cwd:temp, env:{...process.env, ANCHOR_WALLET:operatorFile}, stdio:'pipe' as const};
    execFileSync(process.execPath, args, options);
    const file = path.join(temp, '.vestra/render-bootstrap.json');
    const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(bundle.manifest.collector, collector.publicKey.toBase58());
    assert.deepEqual(bundle.operator, Array.from(operator.secretKey));
    assert.deepEqual(bundle.collector, Array.from(collector.secretKey));
    assert.equal(bundle.idl.address, program);
    assert.equal(fs.readFileSync(file, 'utf8').includes('do not export'), false);
    assert.equal(fs.statSync(file).mode & 0o077, 0);
    assert.throws(() => execFileSync(process.execPath, args, options));
  } finally {fs.rmSync(temp, {recursive:true});}
});
test('managed restart preserves mutable state and rejects changed collector identity', async () => {
  const { initializeRenderState } = await import('../scripts/render-bootstrap');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vestra-render-start-'));
  try {
    const collector = Keypair.generate(), operator = Keypair.generate();
    const program = Keypair.generate().publicKey.toBase58();
    const bundle = {
      manifest: {genesis:DEVNET_GENESIS, program, collector:collector.publicKey.toBase58(), launch:'existing-launch'},
      idl:{address:program}, collector:Array.from(collector.secretKey), operator:Array.from(operator.secretKey),
      faucet:{total:1,wallets:{one:1}}, catalog:{launch:{name:'Original'}},
    };
    const operatorFile = initializeRenderState(bundle, temp);
    assert.equal(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(operatorFile,'utf8')))).publicKey.toBase58(),operator.publicKey.toBase58());
    const manifest = JSON.parse(fs.readFileSync(path.join(temp,'launch.json'),'utf8'));
    assert.equal(manifest.collectorKey,path.join(temp,'keys/collector.json'));
    fs.writeFileSync(path.join(temp,'faucet-ledger.json'),JSON.stringify({total:7,wallets:{}}));
    fs.writeFileSync(path.join(temp,'catalog.json'),JSON.stringify({name:'Changed'}));
    initializeRenderState(bundle,temp);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'faucet-ledger.json'),'utf8')).total,7);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp,'catalog.json'),'utf8')).name,'Changed');
    assert.throws(() => initializeRenderState({...bundle,collector:Array.from(Keypair.generate().secretKey)},temp), /identity/);
  } finally {fs.rmSync(temp,{recursive:true});}
});
