# Vestra frontend chunk

React + TypeScript + Vite frontend, using the approved midnight/lavender/mint identity. The layout follows the reference site's compact navigation, launch banner, category filters and token discovery, while using Vestra branding and the project's actual lock/reward model. There is no fake volume, APY or historical candle feed. Fonts are bundled locally.

## Install and run

Apply the frontend patch on `feat/frontend` based on main commit `6a0d06f`.

```bash
npm ci
npm --prefix app ci
npm run typecheck
npm run test:frontend
npm run app:build
```

Keep the existing Meteora validator running. This frontend reuses the deployed program and `.vestra/launch.json` from the tested integration. Do not reset the validator or rerun the fresh-only CLI demo.

In another terminal, from the repository root:

```bash
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
npm run app:service
```

The service reads the existing target/idl/vestra.json and private collector key on disk. It binds to 127.0.0.1:8787 and finalizes elapsed epochs and atomically collects partner fees every five seconds. Old demo launches can require many catch-up transactions; let the service finish. Errors appear in both its terminal and the UI.

In a third terminal:

```bash
npm run app:dev
```

Open **http://127.0.0.1:5173** on the same computer. Vite proxies `/api` to the local service. This is an operational local frontend, not a hosted mainnet app. Its production build is for build verification; static hosting alone cannot replace the local collector service and validator.

## Browser acceptance workflow

1. Confirm the existing graduated launch appears, with the funded fees from your CLI run.
2. Connect → Local demo wallet. It generates a separate browser wallet; it does not import your CLI wallet. Reloading the tab retains its key in sessionStorage, but you must reconnect. Closing the tab can lose access, so only use local assets.
3. Click Get demo funds. The localhost service airdrops 2 local SOL and transfers 100 mSTOCK from the CLI wallet. It allows three requests per wallet per service process. The CLI wallet needs sufficient mock quote balance.
4. Open the existing token, buy 1 mSTOCK worth, and check the resulting token balance. Sell a small amount to verify the reverse path. Quotes are obtained again before submission, with 1% default slippage.
5. Lock a small amount in the 70s demo tier. This is 7 epochs, starting next epoch, so the actual wait can exceed 70s by up to one epoch. Production labels are 7/30/90 days; demo labels are 70/300/900 seconds.
6. After eligibility begins, trade again. Let the keeper collect fees and finalize the receiving epoch. Verify funded receipts increase and positive claimable mSTOCK appears. Claim rewards and check balance/position updates.
7. After the unlock timestamp, withdraw principal. Confirm its token balance returns. Remaining historical claims survive withdrawal.
8. Launch token → enter a name, ticker and icon. Approve DBC creation and Vestra registration. Both transactions are independently confirmed; an interrupted launch is saved as a session draft and the next attempt resumes it. The shared DBC config is the same tested 1% fee / 100 mSTOCK graduation configuration.
9. For the new launch, request more demo funds if needed, buy enough to complete the curve, then click Graduate to DAMM v2. The UI includes the local pool-authority rent funding fix. Trade after graduation and verify continued fee funding.
10. Creator wallets can claim their own DBC fees and graduated position fees using Claim creator fees. Those fees are separate from the platform's partner receipts.

Phantom and Solflare injected extensions are supported for signing, but the wallet must accept local-validator transactions. Network prompts vary by extension. The local demo wallet is the recommended acceptance path for this localhost harness. Browser wallet flows have not yet been verified against a running validator in the implementation environment.

## Features and boundaries

- Responsive discovery grid; search by name/ticker/mint; curve/graduated categories; newest/fees/locked sorting.
- On-chain funded fees, paid rewards, locked supply and graduation state.
- Token detail, live session price samples (not historical market data), buy/sell quotes and slippage.
- Duration-weighted locks, wallet positions, exact integer reward estimates, bounded claims, principal withdrawal.
- Permissionless graduation and creator royalty claims.
- Resumable browser launch creation using the existing shared config, with local display metadata stored in ignored `.vestra/catalog.json`.
- Locally generated demo wallet plus explicit mock-asset faucet.
- Notifications and confirmed transaction signatures; duplicate action guard; accessible labels, modal keyboard navigation, reduced-motion styling.

The browser only receives public addresses, program IDL and a localhost request token. `.vestra` paths, collector keys and CLI wallet keys are never returned by API endpoints or bundled in the app. Wallet transactions are signed by the connected browser wallet. The local service only signs collection, finalization and explicit mock-faucet transactions; it does not accept arbitrary transaction payloads.

The service rejects foreign Host/Origin headers and requires a per-process session header on POST requests. It is a development service, not a production authentication system. Display metadata is local and is not an authenticated issuer directory. The launch config, mock quote mint, collector and treasury are fixed to the existing integration setup.

Real tokenized stocks, mainnet hosting, production keeper infrastructure, issuer eligibility checks, Token-2022/WSOL quote support, a historical indexer and an audited production deployment remain outside this chunk. Rewards come only from funded receipts. The collector trust assumption remains as documented in METEORA.md.

## Verification

Passed during implementation: root TypeScript check, frontend TypeScript check, production Vite build, and three tests covering integer reward estimates, claim cursor bounds and localhost API restrictions. The browser transaction lifecycle and visual browser QA remain to be run on your local validator. This chunk does not change the Rust program.

## Brand assets

`app/public/brand/vestra-mark.svg` is a compact vector interpretation for navigation and favicons. `vestra-mark-original.png` preserves the approved generated mark. UI tokens are in app/src/style.css; Space Grotesk and Inter are installed via Fontsource. Change UI colors in the CSS variables rather than scattering replacements.
