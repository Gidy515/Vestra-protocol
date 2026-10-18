# Vestra devnet demo

This chunk connects the existing frontend, collector and CLI to Solana devnet. It uses **mock mSTOCK**, not an issuer-backed stock. Fees are real transfers of these test tokens from Meteora DBC and DAMM v2. The collector remains a trusted signer. The browser and service remain hosted on your laptop; this is a network deployment, not public website hosting.

## Network and accounts

- `VESTRA_CLUSTER=devnet` requires an HTTPS RPC and the exact devnet genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Mainnet is rejected before transactions.
- Devnet state, generated keys, metadata: `.vestra/devnet/`. Existing localnet state remains in `.vestra/`.
- Use a separate operator wallet. The operator pays deployment, keeper and test-funding costs; generated collector keys remain on disk.
- SDK versions remain pinned to the tested integration versions. `devnet:check` verifies executable programs and decodes the DAMM config with that SDK.
- Public browser RPC defaults to `https://api.devnet.solana.com`. Server RPC may use a private devnet provider through `ANCHOR_PROVIDER_URL`; it is not copied into bootstrap. `VESTRA_BROWSER_RPC` must be a public HTTPS endpoint supporting browser requests with no embedded credentials. It is necessarily visible to the browser.
- Devnet uses the existing Vestra program ID and program keypair. If it is already deployed, the operator must hold its upgrade authority. Do not replace the program keypair or run `anchor keys sync` casually.

## Build mode

`demo-clock`: localnet only, 10-second epochs.

`devnet-demo`: public test demo, 60-second epochs. Lock tiers are **7 / 30 / 90 minutes**, at weights **1 / 1.5 / 2**. Eligibility starts at the next epoch, adding up to one minute before the lock interval. Withdrawal is determined by the on-chain timestamp. This feature is not suitable for production.

Default build: 86,400-second epochs, 7 / 30 / 90 days. Both demo features together fail compilation. Frontend reads the interval from the launch instead of assuming daily epochs. `devnet:init` checks for 60-second intervals after registration.

## 1. Dedicated wallet and funding

Stop the local frontend service and Vite process; they share the same ports with this demo. The local validator can be stopped and restarted later with its existing ledger. Do not delete that ledger or existing manifests.

```bash
cd ~/Downloads/vestra
mkdir -p "$HOME/.config/solana"
solana-keygen new --no-bip39-passphrase \
  --outfile "$HOME/.config/solana/vestra-devnet.json"
```

Run wallet generation only once. It must not overwrite an existing wallet. Keep the resulting recovery information private.

In **each terminal running devnet commands**, set:

```bash
export VESTRA_CLUSTER=devnet
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET="$HOME/.config/solana/vestra-devnet.json"
```

Fund this address with **test SOL**. Program deployment needs several SOL for account rent and temporary deployment buffers, in addition to transaction costs. Aim for 8–10 test SOL if available; the actual requirement depends on the built program size. Public faucets are rate-limited; use the official Solana faucet if the CLI is throttled. Never fund it with mainnet SOL.

```bash
solana address --keypair "$ANCHOR_WALLET"
solana airdrop 2 --url "$ANCHOR_PROVIDER_URL" --keypair "$ANCHOR_WALLET"
solana balance --url "$ANCHOR_PROVIDER_URL" --keypair "$ANCHOR_WALLET"
```

## 2. Checks and deployment

```bash
npm ci
npm --prefix app ci
npm run typecheck
npm run test:network
npm run test:frontend
npm run test:meteora
npm run test:model
npm run app:build
npm run devnet:deploy
```

Deployment script validates RPC identity and dependencies, tests the Rust devnet build, builds with `devnet-demo`, verifies the generated program keypair, and deploys using the explicit operator wallet. The program ID must be `8AXvPZN7mSM2twASsL9QqKqLqQBnJLGjDKBmzZktnx7K`.

A successful build is not evidence of a successful deployment. Save the deployment signature and use Solana Explorer with `cluster=devnet`.

## 3. Choose automated or browser-first acceptance

### Automated full lifecycle (fresh devnet manifest only)

```bash
npm run devnet:meteora -- demo
```

This creates the mock quote, shared config and initial launch, buys and locks tokens, waits for eligibility, verifies DBC fee funding, reaches the threshold, migrates, trades on DAMM, verifies continued quote fee funding and unchanged locked liquidity, claims positive rewards, waits for the 7-minute lock to expire, withdraws, and reconciles the vaults. Allow roughly 8–10 minutes or more with RPC delays. The demo prints progress while running. Do not run another collector simultaneously during this test.

If interrupted, the persisted manifest and accounts remain. Resume with the individual commands below; do not rerun `demo` against an existing manifest.

### Browser-first setup

```bash
npm run devnet:init
npm run devnet:meteora -- audit
```

`init` resumes partially created accounts. It does not recreate your localnet launch. New launch creation, trades and user locks are signed by the connected wallet; collector funding is signed by the service.

## 4. Service and frontend

Terminal C, with the devnet exports above:

```bash
npm run devnet:service
```

Terminal D:

```bash
cd ~/Downloads/vestra
npm run app:dev
```

Open http://127.0.0.1:5173/. Confirm **Devnet** and **DEVNET DEMO** appear. Connect Phantom or Solflare with Devnet enabled in wallet settings. The tab-session local wallet is disabled on devnet.

**Get demo funds** sends 0.02 test SOL and 100 mSTOCK from the operator, up to three requests per address per service run. This local service is not a public faucet or hardened public backend. Limits reset on restart. The quote distribution and SOL payment are separate transactions; if one fails, inspect the signatures before retrying.

Browser acceptance:

1. Buy tokens and lock a small amount. The 30- or 90-minute tier leaves time for debugging; the 7-minute tier allows a faster withdrawal check.
2. Confirm the lock card under My locks. Wait until its start epoch, at most about 60 seconds after locking.
3. Trade again while eligible. Wait for the collector and the next epoch boundary. Devnet keeper polls every 15 seconds. Rewards require **finalization**, not just fee collection.
4. Claim positive rewards. Zero-value finalized epochs may show Settle epochs; claim batches process up to ten epochs per click.
5. After the on-chain unlock time, withdraw principal. Historical unclaimed rewards remain claimable.
6. Create a second launch, verify discovery, trade both directions, and confirm the creator can collect their separate fee allocation.
7. Reach the 100 mSTOCK quote-reserve threshold, graduate, trade again, and verify collected funding increases. A 100 mSTOCK input alone is insufficient to net 100 into reserves after fees; get additional test quote if needed. Partial-fill swaps avoid overshooting the curve.
8. Open a confirmed transaction's Explorer link and verify its devnet logs.

Service discovers shared-config launches, serializes collection, caches discovery briefly, and polls less frequently on devnet to reduce RPC load. RPC rate limits can still require a dedicated devnet provider. Browser locks request a keeper run and wait briefly when behind; if the backlog is too large they fail before the deposit and can be retried once the keeper catches up.

## Recovery and evidence

```bash
npm run devnet:meteora -- status
npm run devnet:meteora -- collect
npm run devnet:meteora -- buy 1
npm run devnet:meteora -- sell 1
npm run devnet:meteora -- graduate
npm run devnet:meteora -- claim 0
npm run devnet:meteora -- withdraw 0
npm run devnet:meteora -- audit
```

CLI positions belong to the operator wallet, not a different browser wallet. `claim` and `withdraw` take the CLI position nonce. New CLI locks use `lock BASE_AMOUNT NONCE TIER`; choose an unused nonce.

`audit` verifies:

- Reward-vault quote + cumulative platform payments + cumulative locker payments = funded quote.
- Principal-vault base balance = outstanding locked principal.

Unexpected direct vault donations make these exact checks fail and require investigation. They must not be silently classified as fee receipts.

Migration authority underfunding: the localnet bootstrap transfer is disabled on devnet. The shared authority must already have enough rent float; contact Meteora if it does not. Actual required rent is checked by the programs during simulation.

If the program was deployed with daily epochs by mistake, rebuild and redeploy with `devnet-demo`. Existing launches retain their originally stored interval; create a fresh launch/config with separately archived devnet state rather than assuming an upgrade changes old launch durations.

For a deployment timeout, inspect the signature on Explorer/CLI before retrying. Do not regenerate keys or delete state to resolve an ambiguous transaction.

To return to localnet: stop the devnet service, unset `VESTRA_CLUSTER`, `ANCHOR_PROVIDER_URL`, `ANCHOR_WALLET`, and `VESTRA_BROWSER_RPC`; start the existing local validator and normal service. If rebuilding the local program, use `demo-clock` explicitly and deploy to localhost. Do not deploy the latest devnet binary to localnet and assume it still uses 10-second epochs.

## Verification scope

The patch is typechecked, built and covered by offline tests. Meteora devnet dependency existence and migration-config decoding were checked read-only. Actual Vestra devnet deployment and the full lifecycle require the user's funded wallet and installed Anchor/Solana toolchain. Public hosting and real tokenized-stock issuer support are separate work.
