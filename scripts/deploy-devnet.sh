#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export VESTRA_CLUSTER=devnet
export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-https://api.devnet.solana.com}"
: "${ANCHOR_WALLET:?Set ANCHOR_WALLET to a dedicated devnet keypair}"
npm run devnet:check
cargo test -p vestra --lib --features devnet-demo
anchor build -- --features devnet-demo
# Re-check the generated program keypair and both RPC identities before deploying.
npm run devnet:check
solana program deploy \
  --url "$ANCHOR_PROVIDER_URL" \
  --keypair "$ANCHOR_WALLET" \
  --upgrade-authority "$ANCHOR_WALLET" \
  --program-id target/deploy/vestra-keypair.json \
  target/deploy/vestra.so
