# Product update: logos, wallet persistence, keeper progress and stock directory

Targets the working devnet + wallet batching version. It does not require a program
upgrade or changing existing launch keys. Hosting patches were paused; if one has
already been applied, run git apply --check and inspect conflicts before proceeding.

## Implemented changes

- The launch dialog accepts PNG/JPEG/WebP files up to 5 MB, crops to a square and
  converts them to a 128px PNG. The API validates size/dimensions/PNG header and
  stores the raster image with launch metadata. Launch cards, detail and positions
  display the image. Existing glyph icons continue to work.
- Logos are currently **Vestra catalogue metadata** stored in the service's state
  directory, not permanent IPFS/Arweave uploads. This does not claim that Phantom
  or explorers will display the uploaded logo: that requires public token metadata
  hosting and an on-chain metadata URI. Existing pool creation still uses an empty
  URI. Keep catalogue backups; the hosted service must persist its state.
- Wallet choice is retained in localStorage. After refresh the app requests a
  trusted-only injected connection, and never signs transactions automatically.
  Locked wallets, removed permissions or missing extensions require reconnecting.
  Explicit disconnect clears the saved choice; disconnect/account-change listeners
  update the displayed address. The local test wallet remains localnet-only.
- The keeper processes a bounded catch-up batch per launch, continues with other
  launches, and automatically returns on later timer passes. Backlogs are normal
  progress, separate from RPC/funding failures. No epoch accounting is skipped.
- User-facing interface wording now says Get test tokens, Devnet, Localnet and
  local test wallet. Existing mSTOCK is still labelled a test asset. Feature names
  such as devnet-demo are build options, not user-facing protocol branding.

## What the keeper warning meant

The deployed devnet launch has 60-second epochs. If the service is off for a day,
there can be roughly 1,440 epochs to finalize. The old helper stopped after 200 and
reported an error, and the server could stop before processing other launches.
The update uses smaller batches and distinguishes backlog from failures. Every
finalization still needs on-chain work, RPC calls, transaction fees and potentially
new epoch account rent. Large backlogs may take substantial time and require more
test SOL. No claim of instant catch-up is made. New locks require the current epoch;
previously finalized rewards remain claimable and principal withdrawal still uses
its original expiry. Do not delete state to clear a backlog.

## Stocks: implemented page, explicit integration blocker

The new Stocks navigation opens a dark, searchable market table inspired by the
provided Sunrise screenshot. The server adapter uses the **official xStocks v2
public asset and indicative-price endpoints**, with caching, timeouts and bounded
upstream concurrency. Source timestamps, stale data and provider failures are
visible. No hardcoded stock prices or fake chart/volume/market-cap values exist.
The endpoints used do not provide those 24h fields, so they remain blank.

This is **Solana mainnet reference data**, not devnet liquidity or token balances.
It is not passed to the trading router and cannot authorize quote mint selection.
Only up to 24 Solana listings from the first provider page are displayed. This is
not advertised as a complete stock catalogue or a fully verified market-data feed.
The live API request returned HTTP 403 from the build environment; real access must
be tested from the service host. If access fails there too, arrange provider access
or choose another documented API rather than inventing a response.

The requested issuer stock-pair dropdown is **not completed**. No compatible public
issuer devnet mint list/faucet was verified. xStocks' official developer docs specify
Token-2022 with Scaled UI on Solana, while Vestra's tested quote path accepts legacy
SPL Token and one configured quote mint. A ticker or market API alone cannot supply
an SPL balance for DBC swaps. A provider's development REST server is not evidence
of its assets existing on Solana devnet.

Next integration requires verified devnet mint addresses and funding access,
Token-2022/extension compatibility (or genuinely compatible issuer SPL assets),
quote decimals and one DBC configuration per quote, discovery/collector routing
across quotes, and per-asset balances and rewards. Do not relabel mSTOCK as an
issuer's stock, point devnet trades at mainnet mints, or aggregate unrelated quote
assets as if they were one balance. Independently issued stock test tokens are a
possible testing route only if explicitly labelled and approved as that approach.

Sources checked:
- https://docs.xstocks.fi/developers
- https://docs.xstocks.fi/apis/openapi
- https://docs.xstocks.fi/apis/openapi/assets/list_public_assets
- https://docs.xstocks.fi/apis/openapi/assets/get_public_assets_price_data_by_symbol

## Validation

```bash
npm run typecheck
node --import tsx --test tests/product.test.ts
npm run test:frontend
node --import tsx --test tests/meteora/offline.test.ts
npm run test:model
npm run app:build
```

Manual checks on the user's devnet environment remain:
1. Restart the existing devnet service and Vite. Do not initialize another launch.
2. Connect wallet once, refresh, confirm restoration. Disconnect, refresh and ensure
   it stays disconnected. Check account changes and locked wallet behavior too.
3. Create a token with a local image. Refresh and check the launch logo persists.
   Try an unsupported/oversized file and check validation.
4. Confirm Get test tokens and network wording. No user-facing Demo labels remain.
5. Keep service running and watch epoch counts decrease. Actual RPC/funding errors
   must still appear. Confirm locking once caught up, claims and withdrawals.
6. Open Stocks, check source labels and search. If HTTP 403 persists, keep the error
   visible; do not consider the provider integration verified.
