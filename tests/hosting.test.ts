import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publicOrigin, allowedPublicRequest, metadataMessage, verifyMetadata, reservePublicFunding } from '../scripts/hosting-policy';
test('public API requires exact host and same-origin mutations', () => {
  const origin = publicOrigin('https://vestra.example.com')!;
  assert.equal(allowedPublicRequest(origin, origin.host, undefined, 'GET'), true);
  assert.equal(allowedPublicRequest(origin, origin.host, origin.origin, 'POST'), true);
  assert.equal(allowedPublicRequest(origin, 'evil.example', origin.origin, 'POST'), false);
  assert.equal(allowedPublicRequest(origin, origin.host, undefined, 'POST'), false);
  assert.equal(allowedPublicRequest(origin, origin.host, 'https://evil.example', 'POST'), false);
  assert.equal(allowedPublicRequest(origin, 'tunnel.trycloudflare.com', origin.origin, 'POST', 'tunnel.trycloudflare.com'), true);
  assert.equal(allowedPublicRequest(origin, 'tunnel.trycloudflare.com', 'https://evil.example', 'POST', 'tunnel.trycloudflare.com'), false);
  assert.equal(allowedPublicRequest(origin, origin.host, origin.origin, 'POST', 'tunnel.trycloudflare.com'), false);
  assert.throws(() => publicOrigin('http://vestra.example.com'));
  assert.throws(() => publicOrigin('https://vestra.example.com/api'));
});
test('metadata signature binds creator, network, launch and full display contents', () => {
  const keys = generateKeyPairSync('ed25519');
  const owner = keys.publicKey.export({format:'der', type:'spki'}).subarray(-32);
  const message = metadataMessage('devnet', 'launch', 'Name', 'NAME', '✦');
  const signature = sign(null, Buffer.from(message), keys.privateKey).toString('hex');
  assert.equal(verifyMetadata(owner, message, signature), true);
  assert.equal(verifyMetadata(owner, metadataMessage('other', 'launch', 'Name', 'NAME', '✦'), signature), false);
  assert.equal(verifyMetadata(owner, message + 'changed', signature), false);
  assert.equal(verifyMetadata(owner, message, 'bad'), false);
});
test('funding reservations persist and enforce wallet and total limits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vestra-faucet-'));
  try {
    const file = path.join(dir, 'ledger.json');
    for (let i=0; i<3; i++) reservePublicFunding(file, 'wallet1', 4);
    assert.equal(reservePublicFunding(file, 'wallet1', 4), false);
    reservePublicFunding(file, 'wallet2', 4);
    assert.equal(reservePublicFunding(file, 'wallet3', 4), false);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).total, 4);
  } finally { fs.rmSync(dir, {recursive: true}); }
});
