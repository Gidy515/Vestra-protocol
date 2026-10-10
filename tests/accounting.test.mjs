import { test } from 'node:test';
import assert from 'node:assert/strict';

// Independent reference model. These tests validate the economic specification;
// they DO NOT replace executing the Anchor program on a validator.
class Model {
  current = 0;
  epochs = new Map();
  positions = [];
  carry = 0n;
  vault = 0n;
  received = 0n;
  platform = 0n;
  paid = 0n;
  epoch(i) {
    if (!this.epochs.has(i)) this.epochs.set(i, { starts: 0n, ends: 0n, weight: 0n, receipts: 0n, rewards: 0n, paid: 0n, claimedWeight: 0n, finalized: false });
    return this.epochs.get(i);
  }
  lock(amount, days, multiplier) {
    const p = { weight: amount * multiplier / 10_000n, start: this.current + 1, end: this.current + 1 + days, next: this.current + 1 };
    this.epoch(p.start).starts += p.weight;
    this.epoch(p.end).ends += p.weight;
    this.positions.push(p);
    return p;
  }
  fund(amount) {
    this.epoch(this.current).receipts += amount;
    this.received += amount;
    this.vault += amount;
  }
  advance() {
    const e = this.epoch(this.current);
    const holder = e.receipts * 7_500n / 10_000n;
    const platform = e.receipts - holder;
    this.platform += platform;
    this.vault -= platform;
    if (e.weight === 0n) this.carry += holder;
    else { e.rewards = holder + this.carry; this.carry = 0n; }
    e.finalized = true;
    const next = this.epoch(++this.current);
    next.weight = e.weight - next.ends + next.starts;
    assert.ok(next.weight >= 0n);
    this.reconcile();
  }
  claim(p, i) {
    const e = this.epoch(i);
    assert.ok(e.finalized && i === p.next && i >= p.start && i < p.end);
    const reward = e.rewards * p.weight / e.weight;
    e.paid += reward;
    e.claimedWeight += p.weight;
    p.next++;
    this.paid += reward;
    this.vault -= reward;
    if (e.claimedWeight === e.weight) this.carry += e.rewards - e.paid;
    assert.ok(e.paid <= e.rewards && e.claimedWeight <= e.weight);
    this.reconcile();
    return reward;
  }
  reconcile() { assert.equal(this.received, this.platform + this.paid + this.vault); }
}

test('new locks start next epoch and do not dilute an already active epoch', () => {
  const m = new Model();
  const a = m.lock(1_000n, 7, 10_000n);
  m.advance();
  m.fund(1_000n);
  const b = m.lock(1_000n, 7, 10_000n);
  m.advance();
  assert.equal(m.claim(a, 1), 750n);
  assert.throws(() => m.claim(b, 1));
  assert.equal(m.epoch(2).weight, 2_000n);
});

test('zero eligible weight preserves holder money; carry is never charged twice', () => {
  const m = new Model();
  m.fund(100n);
  m.advance();
  assert.equal(m.carry, 75n);
  const p = m.lock(1n, 7, 10_000n);
  m.advance();
  m.advance();
  assert.equal(m.claim(p, 2), 75n);
  assert.equal(m.platform, 25n);
});

test('weighted allocation, duplicate prevention, and rounding dust recycling', () => {
  const m = new Model();
  const a = m.lock(1n, 7, 10_000n);
  const b = m.lock(2n, 7, 10_000n);
  m.advance(); m.fund(7n); m.advance();
  assert.equal(m.claim(a, 1), 1n);
  assert.throws(() => m.claim(a, 1));
  assert.equal(m.claim(b, 1), 3n);
  assert.equal(m.carry, 1n);
  assert.equal(m.platform, 2n);
});

test('expiry removes weight even if owner never submits withdrawal', () => {
  const m = new Model();
  const a = m.lock(1_000n, 7, 10_000n);
  const b = m.lock(1_000n, 30, 15_000n);
  for (let i = 0; i < 8; i++) m.advance();
  assert.equal(m.epoch(8).weight, 1_500n);
  m.fund(100n); m.advance();
  for (let i = 1; i < 8; i++) m.claim(a, i);
  assert.throws(() => m.claim(a, 8));
  for (let i = 1; i < 8; i++) m.claim(b, i);
  assert.equal(m.claim(b, 8), 75n);
});

test('late receipts go to collection epoch, not a finalized historical epoch', () => {
  const m = new Model();
  const a = m.lock(10n, 7, 10_000n);
  m.advance(); m.advance(); m.fund(100n); m.advance();
  assert.equal(m.claim(a, 1), 0n);
  assert.equal(m.claim(a, 2), 75n);
});

test('randomized overlapping positions conserve all deposited quote assets', () => {
  let seed = 123456;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const m = new Model();
  for (let day = 0; day < 130; day++) {
    if (day < 35) {
      const tier = random() % 3;
      m.lock(BigInt(random() % 1_000_000 + 1), [7, 30, 90][tier], [10_000n, 15_000n, 20_000n][tier]);
    }
    m.fund(BigInt(random() % 1_000_000));
    m.advance();
    for (const p of m.positions) {
      while (p.next < m.current && p.next < p.end && random() % 3 !== 0) m.claim(p, p.next);
    }
  }
  for (const p of m.positions) while (p.next < p.end) m.claim(p, p.next);
  m.reconcile();
  assert.ok(m.vault >= m.carry);
});
