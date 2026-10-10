# Verification — original checks and Vestra rename

The following checks passed on the original implementation on 9 October 2026, BEFORE the branding rename, using Rust 1.95.0 and Node 24.19.0. Renamed Rust targets have not been rebuilt in this environment:

| Check | Result |
| --- | --- |
| `cargo test -p vestra --lib` | PASS: 5 tests |
| Same Rust tests with `--features demo-clock` | PASS: 5 tests |
| Rust tests with `--features idl-build` and program-path env | PASS: 14 tests including generated IDL tests |
| `npm run typecheck` | PASS |
| `npm run test:model` | PASS: 6 independent accounting scenarios |
| `cargo fmt --all --check` | PASS |
| `bash -n scripts/setup.sh scripts/test-local.sh` | PASS |

NOT executed here:

- Solana SBF binary build (`anchor build`).
- Local validator SPL-token/Anchor integration suite (`npm run test:local`).
- Node 22 execution (the user's environment; Node 24 was available here).
- Any live DBC/DAMM v2 integration or real stock-mint compatibility test.

The host Rust compilation is not proof that the SBF binary fits stack/compute
limits or that all account constraints behave correctly at runtime. Execute the
included local suite before connecting real funds. The IDL-feature tests compile
the generated IDL; no deployable binary is included in this archive.

Dependencies are pinned by Cargo.lock and package-lock.json. No private keys,
node_modules, or compilation artifacts are included.

## Vestra rename — 10 October 2026

Updated project/program directory, Cargo package and library/module, Anchor mapping,
TypeScript class, error enum, environment flag, generated-IDL path, program-keypair
path, npm package/lock metadata, scripts, and documentation. Economic behavior,
PDA seed prefixes, and placeholder program address are preserved. Setup generates
a new Vestra program keypair in a fresh extraction; it does not migrate deployed
accounts. Reuse an existing deployment key only deliberately, before keys sync.

Rename checks: no previous-brand references; JSON/TOML parse and shell syntax checks.
Rust/IDL/SBF and validator checks must be rerun locally for the renamed program.

Renamed-bundle TypeScript checking PASS; all 6 accounting-model tests PASS.
