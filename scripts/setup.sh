#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v anchor >/dev/null
command -v solana-keygen >/dev/null
command -v node >/dev/null
mkdir -p target/deploy
# Generate only a NEW PROGRAM keypair; never replace your wallet or existing program key.
if [ ! -f target/deploy/vestra-keypair.json ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile target/deploy/vestra-keypair.json
fi
anchor keys sync
npm ci
printf '\nSetup complete. Local tests: npm run test:local\n'
