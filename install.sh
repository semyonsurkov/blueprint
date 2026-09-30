#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="$HOME/.local/bin"

mkdir -p "$bin_dir"
ln -sfn "$repo/bin/blueprint" "$bin_dir/blueprint"
echo "blueprint -> $repo/bin/blueprint"
