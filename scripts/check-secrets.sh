#!/usr/bin/env bash
set -euo pipefail

version="${GITLEAKS_VERSION:-8.30.1}"
repo_root="$(git rev-parse --show-toplevel)"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform="darwin_arm64" ;;
  Darwin-x86_64) platform="darwin_x64" ;;
  Linux-x86_64) platform="linux_x64" ;;
  Linux-aarch64 | Linux-arm64) platform="linux_arm64" ;;
  *)
    echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2
    exit 2
    ;;
esac

archive="gitleaks_${version}_${platform}.tar.gz"
url="https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}"

curl -fsSL "$url" -o "$tmp_dir/$archive"
tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"
"$tmp_dir/gitleaks" detect --source "$repo_root" --no-banner --redact
