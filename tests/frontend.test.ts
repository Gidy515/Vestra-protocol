import { test } from "node:test";
import assert from "node:assert/strict";
import { rewardForEpoch, claimWindow, claimBatches } from "../app/src/rewards";
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

test("claim batches preserve cursor order, cap approvals and resume after a partial success", () => {
  assert.deepEqual(claimBatches([]), []);
  assert.deepEqual(claimBatches(claimWindow(7, 10, 9)), [[7, 8]]);
  assert.deepEqual(claimBatches(claimWindow(0, 100, 90)), [[0,1,2,3,4], [5,6,7,8,9]]);
  assert.deepEqual(claimBatches(claimWindow(5, 10, 90)), [[5,6,7,8,9]]);
});

test("five claim instructions plus ATA and compute budget fit a legacy transaction", async () => {
  const { Transaction, TransactionInstruction, PublicKey, Keypair, ComputeBudgetProgram } = await import("@solana/web3.js");
  const { createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
  const owner = Keypair.generate().publicKey;
  const accounts = Array.from({length: 6}, () => Keypair.generate().publicKey);
  const programId = Keypair.generate().publicKey;
  const tx = new Transaction({feePayer: owner, recentBlockhash: PublicKey.default.toBase58()});
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({units: 600_000}));
  tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, accounts[4], owner, accounts[1]));
  for (let i = 0; i < 5; i++) {
    tx.add(new TransactionInstruction({programId, data: Buffer.alloc(8), keys: [
      {pubkey: owner, isSigner: true, isWritable: true},
      ...accounts.slice(0, 3).map(pubkey => ({pubkey, isSigner: false, isWritable: true})),
      {pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true},
      ...accounts.slice(3, 5).map(pubkey => ({pubkey, isSigner: false, isWritable: true})),
      {pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false},
    ]}));
  }
  assert.ok(tx.serialize({requireAllSignatures: false, verifySignatures: false}).length <= 1232);
});
