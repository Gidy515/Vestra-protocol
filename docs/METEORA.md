# Meteora integration — local demo

This chunk connects the existing Vestra lock/reward core to real DBC and DAMM v2 instructions. It uses Meteora DBC SDK 1.5.13 and cp-amm SDK 1.5.1, pinned in package-lock.json. The CLI only accepts a localhost RPC. The quote asset is a clearly labelled, freely minted mock stock token; it is not an actual stock or a claim on a company.

## Run

Install dependencies and verify the core first (the original test script starts its own validator):

```bash
npm ci
npm run typecheck
npm run test:meteora
npm run test:model
cargo test -p vestra --lib
npm run test:local
```

Stop any existing local validator before starting the Meteora harness. In terminal A:

```bash
npm run meteora:validator
```

The first start clones DBC, DAMM v2, Metaplex, and the customizable DAMM v2 migration config from mainnet. It does not submit transactions to mainnet. Mainnet RPC rate limiting can interrupt cloning; retry or change the read-only clone RPC in start-validator.ts. The validator uses .vestra/ledger and funds the wallet locally.

In terminal B, build and deploy the local-only clock variant:

```bash
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
anchor build -- --features demo-clock
solana program deploy --url http://127.0.0.1:8899 --program-id target/deploy/vestra-keypair.json target/deploy/vestra.so
npm run meteora -- demo
```

Use the existing deploy keypair from the core build; do not regenerate it. The demo asserts 10-second epochs before it trades. It creates a mock-stock-quoted DBC launch, buys tokens, locks a position, collects partner fees, completes the curve with partial-fill buys, graduates to DAMM v2, buys again, collects position fees, and claims a finalized reward. It asserts funding before and after migration, positive locker payouts, and preservation of permanently locked LP liquidity. It prints confirmed transaction signatures. A successful run ends with `PASS: DBC fees → graduation → DAMM fees → locker rewards`.

The automated demo requires a fresh manifest. If it stops, use the individual commands below to inspect/resume the same launch. Do not rerun `demo` on it. After a ledger reset, move the old .vestra directory aside and start a fresh validator; the manifest is tied to its genesis hash.

```bash
npm run meteora -- status
npm run meteora -- init                 # resumable initialization
npm run meteora -- buy 1                # quote units
npm run meteora -- sell 100             # community token units
npm run meteora -- lock 100 1 0         # amount, unique nonce, tier
npm run meteora -- collect
npm run meteora -- graduate             # requires reached threshold
npm run meteora -- claim 1              # position nonce
npm run meteora -- keeper               # finalize epochs and collect every 5s
```

Tier 0/1/2 corresponds to 7/30/90 epochs and 1x/1.5x/2x weights. Production epochs are one day; demo epochs are ten seconds. The demo build must never be deployed as the production contract.

## Revenue and custody

DBC configuration fields used are `feeClaimer` (dedicated collector key), `creatorTradingFeePercentage: 20`, and `collectFeeMode: QuoteToken`. The static trading fee is 100 bps. The partner receives the remainder of distributable trading fees after Meteora protocol fees and the creator allocation. Vestra splits actual partner receipts 75% to eligible lockers and 25% to treasury; those percentages are not percentages of gross trade volume.

Graduation uses `migrationOption: MET_DAMM_V2`, customizable migration fees, quote-only migrated fees, and permanently locked liquidity: 80% partner, 20% creator. Continued reward funding comes from the partner-owned DAMM position. The collector never collects the creator-owned position. LP ownership distributions do not promise an identical effective share of gross fees across both venues.

Each fee claim and Vestra `fund_collected_balance` instruction execute in one transaction. The new instruction reads the collector's quote balance after the preceding claim and transfers that full balance into the current epoch reward vault. If either instruction fails, the entire transaction rolls back. Empty receipts reject with ZeroAmount. The CLI requires the dedicated fee ATA to be empty before collection to avoid silently including unrelated balances. It never converts base fees into quote; configured fees are quote only.

This preserves the existing signed collector trust model. The program verifies collector authorization, mint, vault, and epoch; it does not verify Meteora fee provenance. A collector can withhold collection or submit other quote tokens through fund_epoch. The CLI validates the canonical pool, config, account owners, fee policy and configured collector, but these are off-chain checks. Do not describe this release as permissionless fee collection or trustless provenance verification.

## Scope and verification

Implemented: launch/config creation; quote-aware DBC partial-fill trading; manual DAMM v2 graduation; post-graduation trading; atomic DBC and DAMM fee receipt funding; epoch keeper; locker claim commands; and an executable lifecycle assertion harness.

Verified in the implementation environment: TypeScript typecheck, 5 native Rust tests, 6 accounting-model tests, and 3 SDK configuration/amount tests. The added atomic-receipt validator test and full Meteora lifecycle harness still require execution on a Solana validator. Native Rust tests do not validate SBF stack limits. Treat validator success as the next acceptance gate before a demo deployment.

Excluded: real tokenized-stock eligibility/transfer checks, Token-2022 quote tokens, WSOL unwrap handling, production keeper hosting, multi-launch UI, and audited mainnet deployment. Collector keyfiles and manifests are under ignored .vestra/ and must not be committed.

Primary API references: https://github.com/MeteoraAg/dynamic-bonding-curve-sdk and https://github.com/MeteoraAg/damm-v2-sdk . The pinned installed SDK types and official DBC program source were used to verify fee fields, mint-authority revocation, migration signers, and position ownership.
