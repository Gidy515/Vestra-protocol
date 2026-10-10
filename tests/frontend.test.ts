import { test } from "node:test";
import assert from "node:assert/strict";
import { rewardForEpoch, claimWindow } from "../app/src/rewards";
import { allowedLocalRequest } from "../scripts/frontend-policy";
test("reward display retains integer precision, floors dust, excludes open and empty epochs", () => {
  assert.equal(rewardForEpoch("1500000", "1000000", "2500000", true), 600000n);
  assert.equal(
    rewardForEpoch("18446744073709551615", "1", "3", true),
    6148914691236517205n,
  );
  assert.equal(rewardForEpoch("1", "1", "3", true), 0n);
  assert.equal(rewardForEpoch("100", "1", "1", false), 0n);
  assert.equal(rewardForEpoch("100", "1", "0", true), 0n);
});
test("claim window stops at expiry, excludes the current epoch and resumes bounded prompts", () => {
  assert.deepEqual(claimWindow(7, 100, 9), [7, 8]);
  assert.deepEqual(claimWindow(7, 8, 90), [7]);
  assert.deepEqual(claimWindow(9, 8, 90), []);
  assert.equal(claimWindow(0, 100, 90).length, 10);
  assert.equal(claimWindow(10, 100, 90)[0], 10);
});
test("collector API rejects foreign origins, rebound hostnames, and unauthenticated mutations", () => {
  assert.equal(
    allowedLocalRequest(
      "127.0.0.1:5173",
      "http://127.0.0.1:5173",
      "POST",
      "secret",
      "secret",
    ),
    true,
  );
  assert.equal(
    allowedLocalRequest(
      "localhost:8787",
      undefined,
      "GET",
      undefined,
      "secret",
    ),
    true,
  );
  assert.equal(
    allowedLocalRequest(
      "attacker.example:8787",
      undefined,
      "GET",
      undefined,
      "secret",
    ),
    false,
  );
  assert.equal(
    allowedLocalRequest(
      "localhost:8787",
      "https://attacker.example",
      "POST",
      "secret",
      "secret",
    ),
    false,
  );
  assert.equal(
    allowedLocalRequest(
      "localhost:8787",
      undefined,
      "POST",
      undefined,
      "secret",
    ),
    false,
  );
});
