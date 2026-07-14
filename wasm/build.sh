#!/usr/bin/env bash
# Build the Rust heat kernel to wasm and copy the artifact into the source tree.
#
# The built `.wasm` is COMMITTED (src/game/engine/heat.wasm) so the Cloudflare
# static build — which runs only `astro build` with no Rust toolchain — bundles
# it as-is. Re-run this whenever wasm/heat/src changes, then commit the updated
# artifact.
#
# Requires: rustup target add wasm32-unknown-unknown
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
crate="$here/heat"
out="$crate/target/wasm32-unknown-unknown/release/heat.wasm"
dest="$here/../src/game/engine/heat.wasm"

echo "› building heat kernel (release, wasm32)…"
cargo build --release --target wasm32-unknown-unknown --manifest-path "$crate/Cargo.toml"

# Shrink further if wasm-opt (binaryen) is available; harmless to skip.
if command -v wasm-opt >/dev/null 2>&1; then
  echo "› wasm-opt -O3…"
  wasm-opt -O3 "$out" -o "$out"
else
  echo "› wasm-opt not found — shipping rustc output as-is"
fi

cp "$out" "$dest"
echo "› copied → $dest ($(wc -c < "$dest") bytes)"

echo "› golden parity test…"
node "$here/test/golden.mjs"
