#!/usr/bin/env bash
# Portable equivalent of New-CleanArchive.ps1: builds a zip with no secrets, dependencies, uploads or build output.
# Refuses to run if any real .env file exists, so a secret can never be shared by accident.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$root/../openvio-clean.zip}"
found="$(find "$root" \( -name node_modules -o -name .next -o -name .git \) -prune -o -type f \( -name '.env' -o -name '.env.*' \) ! -name '*.example' -print)"
if [ -n "$found" ]; then
  echo "Archive refused: remove real environment file(s) first:" >&2
  echo "$found" >&2
  exit 1
fi
rm -f "$out"
cd "$root/.."
zip -qr "$out" "$(basename "$root")" \
  -x '*/node_modules/*' '*/.next/*' '*/.git/*' '*/uploads/*' '*/.npm-cache/*' '*/coverage/*' \
     '*/test-results/*' '*/playwright-report/*' '*/dist/*' '*/certs/*' '*.tsbuildinfo'
echo "Created clean archive: $out"
