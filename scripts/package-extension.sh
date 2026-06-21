#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

version="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
artifact_dir="$repo_root/artifacts"
zip_path="$artifact_dir/lishu-${version}.zip"
unpacked_dir="$artifact_dir/lishu-${version}-unpacked"

rm -rf "$artifact_dir"
mkdir -p "$artifact_dir"

pnpm build
mkdir -p "$unpacked_dir"
cp -R dist/. "$unpacked_dir/"
(
  cd "$unpacked_dir"
  zip -qr "$zip_path" .
)

echo "Packaged $zip_path"
echo "Unpacked extension folder $unpacked_dir"
