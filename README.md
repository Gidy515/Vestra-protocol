# Vestra — implementation chunk 1

Stock-paired community-token launches with voluntary commitments and funded,
lock-weighted quote-asset rewards. This archive supplies the on-chain custody and
reward core, a client helper, and tests. It is NOT the complete launchpad.

## Target toolchain

- Anchor CLI and Rust crates: **1.1.2**.
- Rust: **1.95.0**; Solana CLI: **3.1.8** (the user's installed versions).
- Node: **22.x**.
- TypeScript client: `@anchor-lang/core`, not the pre-1.0 package.
- Anchor 1.x CPI contexts take a program ID, not a program AccountInfo.

## Run on your machine

Extract to a NEW directory. Do not run `anchor init` over these files.

```bash
cd ~/Downloads/vestra
bash scripts/setup.sh
npm run typecheck
npm run test:model
cargo test -p vestra --lib
npm run test:local
```

`setup.sh` creates only the program keypair if absent, then runs `anchor keys sync`
to update the placeholder program ID. It does not replace your wallet.
`test:local` builds with `demo-clock` and uses `anchor test --validator legacy`.
It creates and funds mock tokens locally. No stock token and no Meteora program
are used in the stage-one chain test. It takes approximately two minutes.

For a normal 24-hour-epoch build after local tests:

```bash
anchor build
```

Do NOT deploy the demo-clock binary. Do not change cluster to mainnet for these
tests. The balance you supplied does not establish the configured cluster.
Inspect it with `solana config get`; local tests are explicitly localhost.

## Included behavior

- Launch-specific immutable collector, quote mint, treasury, and 75/25 split.
- Revoked mint/freeze authority required for the COMMUNITY base mint.
- Principal and quote rewards kept in separate program-controlled accounts.
- Multiple immutable lock positions per user using user-supplied nonces.
- 7/30/90 epoch locks with 1x/1.5x/2x integer weights.
- Next-boundary eligibility; expiry schedules remove weight automatically when
  epochs are settled, even if users do not withdraw.
- Authorized collector deposits actual quote tokens; no unfunded reward entries.
- Permissionless sequential epoch settlement and treasury payment.
- Historical claims work after withdrawal. Zero-reward claims still advance the
  position cursor, allowing eventual closure and rent recovery.
- Early/repeated withdrawal and repeated/out-of-order claims rejected.
- Withdrawals use the clock directly, so keeper downtime cannot block matured
  principal. Claims need finalized epochs, so anyone can catch up settlement.
- Empty-epoch holder allocations carry forward; rounding dust is recycled only
  after every eligible position has claimed that epoch.

## Explicit stage-one boundaries

1. **No Meteora CPI/fee provenance verification yet.** `fund_epoch` accepts real
   tokens from the configured collector. A collector can deposit other funds.
   Do not describe these deposits as verified trading fees. Next chunk must bind
   the registry to actual DBC configs/pools and prove pre/post-migration claims.
2. **Legacy SPL Token only.** Token-2022 mints are rejected by account ownership
   checks. A real stock quote must be verified to use this compatible token
   program; otherwise add and test a deliberately restricted Token-2022 path.
3. **No mint/issuer/geographic certification.** Registration records mints; it
   does not approve a stock issuer or user's eligibility.
4. Platform treasury ownership is fixed at registration. There are no mutable
   fee settings or admin sweep of principal/rewards in this program.
5. Program upgrade authority still exists if deployed upgradeably. Immutable
   account settings do not remove that broader authority.
6. A permissionless registry does not authenticate a creator. Launch identity
   includes both base mint and authority; the UI must verify official launches.

## Reward policy users must see

Eligibility begins at the NEXT boundary. A 7-day lock unlocks seven days after
that boundary, so wall-clock commitment is 7 to nearly 8 days. Funds received
in an epoch reward its eligible weight, regardless of when fees originally
accrued externally. New locks do not share receipts in their joining epoch.

Delayed fee collection can benefit later eligible lockers; this MVP uses a
**collection-epoch policy**, not an earnings-time attribution promise. The keeper
should collect frequently, and collection lag should be displayed. Any future
earnings-time attribution requires a new verified integration/accounting design.

At finalization:

```
locker allocation = floor(epoch receipts * 7500 / 10000)
platform allocation = receipts - locker allocation
epoch rewards = locker allocation + prior carry (if eligible weight > 0)
position claim = floor(epoch rewards * position weight / total epoch weight)
```

All values are raw token units. The platform receives the rounding remainder of
the fee split. Position-share dust remains backed and returns to carry when all
eligible weight has claimed. Unclaimed rewards are never swept or redistributed.
Carry has no expiry; it can stay indefinitely if the launch has no future locks.
Unsolicited direct transfers to vaults are not credited as distributable receipts
and cannot currently be recovered. Use `fund_epoch`, not a direct transfer.

## Accounts and client

See `docs/ACCOUNTING.md` and `scripts/client.ts` for PDAs and eligibility rules.
The client uses runtime IDL account names until the local build generates types.
`tests/chain.test.ts` exercises real SPL-token transfers on the local validator.
`tests/accounting.test.mjs` is an independent economic reference model, not a
substitute for the chain suite. Rust unit tests exercise program arithmetic.

## Next complete chunk

DBC creation/trading harness; canonical pool/config validation; claimed-receipt
ingestion; DAMM v2 migration/fee ownership proof; keeper; stock-mint preflight.
Do not add the frontend until that path works end to end.

## Verification

The generated archive's `docs/VERIFICATION.md` records checks actually performed.

## Meteora integration

See [docs/METEORA.md](docs/METEORA.md) for the complete local DBC launch → trading → fee funding → DAMM v2 graduation → continued reward workflow. Start with its verification commands, then run the cloned-program validator and `npm run meteora -- demo`. Real stock quotes and production deployment remain outside this local harness.

## Frontend

The Vestra React frontend is in `app/`. See [docs/FRONTEND.md](docs/FRONTEND.md) for installation and the browser acceptance workflow. Keep the local validator running, start `npm run app:service`, then `npm run app:dev` and open http://127.0.0.1:5173. User transactions are signed in the browser; collector keys remain in the localhost service.

## Devnet demo

See [docs/DEVNET.md](docs/DEVNET.md) for the isolated devnet deployment, mock-asset launch, real Meteora fee collection, graduation, and browser acceptance workflow. The `devnet-demo` build uses 60-second epochs; production builds still use daily epochs.
