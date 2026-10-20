# Vercel frontend + managed Render API and keeper

This replaces the laptop tunnel. Judges can use the deployed frontend while your
laptop is off. The Solana program remains on devnet. No VPS administration or
custom domain is required. Vercel and Render supply HTTPS addresses.

## Cost and scope

Render's listed base service price is $7/month for the small paid web service.
A 1 GB persistent disk adds $0.25/month. Budget roughly $7.25/month before usage
overages/taxes; check the dashboard total before creating the paid resource.
Free web services sleep and do not support persistent disks, so do not choose Free
for this workflow. Render bills service compute separately from workspace plans;
a free Hobby workspace is sufficient, with a paid web service inside it.

This is a devnet demo, not production security certification. Keep only test assets
in the operator wallet. It runs one API/keeper process and one persistent disk.
No database, separate worker or paid custom domain is needed.

## 1. Apply and test locally

Use `vestra-managed-hosting.patch` after the product, keeper batching, presentation UI,
and network-resilience changes. Do not apply the older Render, VPS or tunnel patches. If you already applied one,
inspect your diff before changing branches or applying another patch.

```bash
npm run typecheck
node --import tsx --test tests/hosting.test.ts tests/render.test.ts
node --test tests/vercel.test.mjs
npm run test:network
npm run test:frontend
npm run app:build
```

Keep the existing `.vestra/devnet/` state and target IDL. Export the private bootstrap:

```bash
export ANCHOR_WALLET="$HOME/.config/solana/vestra-devnet.json"
node --import tsx scripts/render-state.ts export
```

This writes `.vestra/render-bootstrap.json` with the existing collector, devnet
operator, launch manifest, IDL and optional catalog/funding ledger. It excludes
program deployment/upgrade keypairs. It refuses to overwrite an existing export.
**Do not commit, paste into chat, or upload this file to Vercel.** Later, copy its
contents only into the Render service's Secret Files editor.

Commit only public code/config:

```bash
git add .gitignore app/src/chain.ts app/src/wallet.ts scripts/frontend-server.ts scripts/network.ts \
  scripts/hosting-policy.ts scripts/render-bootstrap.ts scripts/render-state.ts scripts/configure-vercel.mjs \
  tests/hosting.test.ts tests/render.test.ts tests/vercel.test.mjs \
  render.yaml vercel.json docs/RENDER.md
git diff --cached --check
git commit -m "Add managed Render keeper and Vercel deployment"
git push -u origin feat/managed-hosting
```

Do not share key material in deployment screenshots or logs.

## 2. Create the Vercel frontend

Import Gidy515/Vestra-protocol on Vercel. Use branch `feat/managed-hosting` for the initial
deployment (or merge and use main). Root Directory: **repository root**, not app.
Select Node 22.x. vercel.json provides install/build/output settings:

- Install: `npm ci && npm --prefix app ci`
- Build: `npm run app:build`
- Output: `app/dist`

The first deployment has a placeholder backend destination. The frontend build
can deploy, but API-dependent screens will fail until step 4. Keep its stable
project URL, e.g. https://vestra-demo.vercel.app. No wallet keys or private RPC
credentials belong in Vercel variables. Make the intended deployment public if
Deployment Protection would otherwise block judges.

## 3. Create the paid Render backend

Sign in at https://dashboard.render.com with GitHub and choose **New > Web Service**.
Connect Gidy515/Vestra-protocol, select the branch containing this patch, and set:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Root Directory | Leave empty (repo root) |
| Build command | `npm ci --include=dev` |
| Start command | `node --import tsx scripts/render-state.ts start` |
| Instance | Small paid $7/month instance (0.5c-512mb / 512 MB) |
| Health check | `/healthz` |
| Instances | 1; no autoscaling |

In Advanced settings, add a **persistent disk**:

- Mount path: `/var/data`
- Size: `1 GB`

Add environment variables:

| Variable | Value |
| --- | --- |
| NODE_VERSION | 22.20.0 |
| VESTRA_CLUSTER | devnet |
| VESTRA_STATE_DIR | /var/data/vestra |
| ANCHOR_PROVIDER_URL | https://api.devnet.solana.com, or a private devnet RPC |
| VESTRA_PUBLIC_ORIGIN | Your exact stable https://...vercel.app origin |
| VESTRA_FAUCET_LIMIT | 30 |

Do not manually set PORT; Render supplies it. Render also supplies
RENDER_EXTERNAL_URL, used to validate the API hostname. You can explicitly override
it with VESTRA_BACKEND_ORIGIN if needed. The browser RPC defaults to public Solana
devnet; server RPC credentials are not copied into it.

Add a **Secret File** named `vestra-bootstrap.json`. Paste the local export's JSON
contents in its value editor. The script reads `/etc/secrets/vestra-bootstrap.json`.
Do not add the bundle under Environment Variables, commit it, or put it into logs.

Review the service + disk price before confirming creation. `render.yaml` is a
reference configuration for the same topology; use either the manual setup above
or a Blueprint, not both (which would create duplicate services).

The startup script checks devnet identities, creates persistent key/manifest files
once, remaps the collector path, restores the IDL into the runtime filesystem and
starts the existing service. Restarts preserve catalog and faucet reservations.
It refuses mismatched persistent identities and a missing `/var/data` mount.
If a first import is interrupted, inspect the persistent files before retrying;
do not delete established state to suppress errors.

No Anchor, Rust, local validator or new program deployment is required on Render.

## 4. Connect Vercel to the actual Render URL

Copy the service's actual HTTPS .onrender.com URL. On your laptop:

```bash
node scripts/configure-vercel.mjs https://YOUR-SERVICE.onrender.com
git add vercel.json
git commit -m "Point frontend API at Render service"
git push
```

Vercel must redeploy the branch containing the updated rewrite. A dashboard env
change alone does not update this committed URL. Requests to /api are proxied,
so the browser sees one origin. Backend mutations require that exact Vercel Origin;
alternate preview deployment URLs will not be accepted automatically.

After the managed keeper is running, stop any laptop collector service and tunnel.
Never operate both keepers simultaneously. Shared-disk horizontal replicas are not
supported by the current single-process collector and faucet ledger.

## 5. Acceptance with laptop service stopped

```bash
curl https://YOUR-SERVICE.onrender.com/healthz
curl https://YOUR-PROJECT.vercel.app/api/health
```

Then use the Vercel site: connect Devnet wallet, get mock funds, buy, lock, trade
once eligible, claim after finalization, withdraw after expiry. Also create a
launch and approve its creator metadata message. Check the keeper timestamp
advances. Restart the Render service and verify launches, collector identity and
funding limits persist. Finally switch off the laptop and test from a phone or
another computer. Only that establishes the requested independent operation.

Healthz checks process liveness, not chain health. Watch Render logs and keeper
lastRun; inspect RPC errors before calling the deployment healthy. A dedicated
server devnet RPC can help if the public endpoint rate-limits. No availability
claim is made before this live acceptance.

## Funding and operation

The operator needs devnet SOL for collection/finalization/ATA rent and test token
minting fees. Test-token requests mint 100 mSTOCK each without a per-wallet claim
cap; they do not consume a finite operator mSTOCK balance. Mint authority must
still be the operator. Keep only devnet assets in this wallet.

SOL is handled separately: only wallets below 0.01 SOL receive a 0.02 SOL top-up.
Hosted SOL top-ups have a persistent budget of three per wallet and 30 globally
by default (0.6 SOL total, excluding transaction fees and account rent). Once the
budget is exhausted, token requests still work; users must obtain devnet SOL
elsewhere. VESTRA_FAUCET_LIMIT=0 disables SOL top-ups, not token minting.
Reservations survive restarts and ambiguous transfers consume the reservation.
Only one faucet operation runs at a time. This is a finite test SOL budget, not
identity verification or production abuse protection. A bootstrap session is
publicly obtainable; it is a request guard, not user authentication. Creator
metadata requires a cryptographic wallet signature.

Unlimited launch creation can increase collector workload and transaction costs;
this is a bounded devnet demo, not a production abuse-control design. Keep a private
backup of the original state and keys. Do not remove the persistent disk while
updating code. Check Render's disk backup options separately.

References (verify current prices at checkout):
- https://render.com/pricing
- https://render.com/docs/free
- https://render.com/docs/disks
- https://render.com/docs/web-services
- https://render.com/docs/configure-environment-variables
- https://vercel.com/docs/routing/rewrites

## Existing limitation

Hosting keeps the keeper active, but does not fix the historical epoch backlog
algorithm. Clear the current backlog before judge access and monitor keeper
lastRun. A dedicated backend devnet RPC is recommended; the browser's public RPC
can still rate-limit independently. The new network-resilience code is retained.

## Operational handoff

Before creating the Render service, stop the laptop keeper after exporting the
latest catalog. Do not create additional launches or update catalog entries during
the handoff. Never leave two fee collectors running against the same launch.
To roll back, stop Render first, then restart the laptop service. Do not run the
launch demo initializer or recreate state during deployment.
