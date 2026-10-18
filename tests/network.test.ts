import { test } from 'node:test';
import assert from 'node:assert/strict';
import { network, assertGenesis, DEVNET_GENESIS, MAINNET_GENESIS } from '../scripts/network';
test('network selection preserves local state and separates devnet keys', () => {
  const local = network({}); const dev = network({ VESTRA_CLUSTER: 'devnet' });
  assert.equal(local.cluster, 'localnet');
  assert.equal(dev.rpc, 'https://api.devnet.solana.com');
  assert.equal(dev.stateDir, local.stateDir + '/devnet');
  assert.throws(() => network({ VESTRA_CLUSTER: 'mainnet' }));
  assert.throws(() => network({ ANCHOR_PROVIDER_URL: 'https://api.mainnet-beta.solana.com' }));
  assert.throws(() => network({ VESTRA_CLUSTER: 'devnet', ANCHOR_PROVIDER_URL: 'http://localhost:8899' }));
});
test('cluster identity rejects mainnet and mismatched devnet before sending', () => {
  assertGenesis('devnet', DEVNET_GENESIS);
  assertGenesis('localnet', 'local-genesis');
  assert.throws(() => assertGenesis('devnet', MAINNET_GENESIS));
  assert.throws(() => assertGenesis('devnet', 'local-genesis'));
  assert.throws(() => assertGenesis('localnet', DEVNET_GENESIS));
  assert.throws(() => assertGenesis('localnet', MAINNET_GENESIS));
});
test('server RPC credentials are not copied into browser bootstrap', () => {
  const n = network({ VESTRA_CLUSTER: 'devnet', ANCHOR_PROVIDER_URL: 'https://rpc.example/?api-key=private' });
  assert.equal(n.browserRpc, 'https://api.devnet.solana.com');
  assert.throws(() => network({ VESTRA_CLUSTER: 'devnet', VESTRA_BROWSER_RPC: 'https://user:secret@rpc.example/' }));
  assert.throws(() => network({ VESTRA_CLUSTER: 'devnet', VESTRA_BROWSER_RPC: 'https://rpc.example/?api-key=secret' }));
});
