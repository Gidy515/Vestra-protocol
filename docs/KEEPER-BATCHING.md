# Keeper batching and blockhash confirmation

This patch targets the product-update branch after the wallet-module and stock
connectivity fixes. No on-chain program instructions, account layouts, authorities,
epoch durations or balances are changed. No program redeployment is required.

## Changes

- Catch-up combines up to four consecutive epoch settlements into one transaction.
  Any missing schedule is created in that same transaction immediately before the
  corresponding settlement. Existing schedules, including lock starts/ends, are
  never recreated. Each finalize instruction retains the deployed program's
  original sequential checks, carry accounting, expiry/weight changes and fee split.
- The service still spends at most eight epochs per launch per pass, then proceeds
  to other launches. A full eight-epoch pass now uses two catch-up transactions
  instead of up to sixteen separate create/finalize transactions. Confirmation
  latency, RPC rate limits and epoch-account rent still affect completion time.
- The runtime send helper passes Anchor 1.1.2 the exact blockhash and last-valid
  block height used to sign, enabling blockheight-based confirmation instead of its
  default signature-only 30-second timeout path. A subsequent client error triggers
  a status lookup of that same signature. Only confirmed/finalized success counts
  as recovery; missing, processed or failed status is not reported as success.
- Batches are atomic: a failed instruction rolls back the whole transaction. New
  passes read current chain state. No history is skipped and no balance is reset.

## Verification

Offline tests cover instruction order, pre-existing schedules, maximum transaction
packet size including compute budget, and conservative confirmation-status recovery.
Existing product, frontend and accounting tests and typechecks should still pass.

A new chain test funds a current epoch, creates a position starting in the next
epoch, settles four epochs in a single transaction, and verifies cursor advancement,
weight propagation, platform payment, reward vault movement and conservation.
The development environment does not have the Solana/Anchor tools or deployed keys
needed to execute this chain test; run it locally before calling batching fully
verified. It uses the isolated LOCAL validator and demo-clock build:

```bash
npm run typecheck
node --import tsx --test tests/keeper.test.ts tests/product.test.ts
npm run test:frontend
npm run test:model
npm run app:build
VESTRA_CLUSTER=localnet ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
  ANCHOR_WALLET="$HOME/.config/solana/id.json" npm run test:local
```

The added chain test waits for boundaries and can add roughly 40–50 seconds to the
suite. Do not run a second local validator on port 8899 at the same time. The test
script may rebuild the local binary with demo-clock; do not redeploy that binary
to devnet. This patch only needs the already-deployed program.

After tests pass, stop the existing devnet service and restart exactly one instance
with explicit devnet exports. Observe epochs advance, then inspect the updated
transaction signature logs on devnet. A large backlog will still take time and
new epoch accounts still require rent. Keep test SOL available in the operator.
Once caught up, run `npm run devnet:meteora -- audit` and verify reconciliation.
If any send remains ambiguous, inspect that exact signature before manual action;
do not run another collector concurrently or delete the manifest/keys.
