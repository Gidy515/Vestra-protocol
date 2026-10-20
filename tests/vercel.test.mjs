import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vercelConfig } from '../scripts/configure-vercel.mjs';
test('Vercel build uses repo root and rewrites only API requests', () => {
  const config = vercelConfig('https://demo-test.onrender.com');
  assert.equal(config.outputDirectory, 'app/dist');
  assert.equal(config.installCommand, 'npm ci && npm --prefix app ci');
  assert.deepEqual(config.rewrites, [{source:'/api/:path*', destination:'https://demo-test.onrender.com/api/:path*'}]);
  for (const value of ['http://demo-test.onrender.com','https://demo-test.onrender.com/path','https://user:password@demo-test.onrender.com','https://demo-test.onrender.com?token=secret','https://evil.example'])
    assert.throws(() => vercelConfig(value));
});
