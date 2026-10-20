import test from 'node:test';
import assert from 'node:assert/strict';
import { rpcTransport } from '../app/src/rpc-transport';
import { friendlyError } from '../app/src/network-errors';
test('429 reads retry with delay; transaction submission is never retried', async () => {
  let calls = 0;
  const waits: number[] = [];
  const request = rpcTransport((async () => ++calls < 3 ? new Response('', {status:429}) : new Response('{}')) as typeof fetch, async ms => { waits.push(ms); });
  assert.equal((await request('https://rpc.invalid', {body:JSON.stringify({method:'getSlot'})})).status,200);
  assert.equal(calls,3); assert.ok(waits.includes(2000)); assert.ok(waits.includes(4000));
  let sends = 0;
  const write = rpcTransport((async () => { sends++; return new Response('',{status:429}); }) as typeof fetch, async () => {});
  assert.equal((await write('https://rpc.invalid',{body:JSON.stringify({method:'sendTransaction'})})).status,429);
  assert.equal(sends,1);
});
test('RPC requests run sequentially and a failure does not block the queue', async () => {
  let active=0, maximum=0, calls=0;
  const request=rpcTransport((async () => { active++; maximum=Math.max(maximum,active); await Promise.resolve(); active--; if (++calls===1) throw new Error('offline'); return new Response('{}'); }) as typeof fetch,async()=>{});
  const results=await Promise.allSettled([request('https://rpc.invalid'),request('https://rpc.invalid')]);
  assert.equal(maximum,1); assert.equal(results[0].status,'rejected'); assert.equal(results[1].status,'fulfilled');
});
test('network, sync and uncertain confirmation messages remain distinct',()=>{
  assert.match(friendlyError(new Error('429 Connection rate limits exceeded')),/Network is busy/);
  assert.match(friendlyError(new Error('Keeper is catching up. Retry after the next refresh.')),/Rewards are syncing/);
  assert.match(friendlyError(new Error('Transaction was not confirmed in 30.00 seconds')),/Check its signature/);
  assert.equal(friendlyError(new Error('Specific constraint failed')),'Specific constraint failed');
});
