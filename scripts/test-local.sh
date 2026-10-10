#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Local testing ONLY. Anchor.toml fixes the cluster to Localnet.
if [ "${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}" != "http://127.0.0.1:8899" ]; then
  printf 'Unset ANCHOR_PROVIDER_URL: this script runs only against localhost.\n' >&2
  exit 1
fi
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
export VESTRA_DEMO_CLOCK=1
anchor test --validator legacy -- --features demo-clock
