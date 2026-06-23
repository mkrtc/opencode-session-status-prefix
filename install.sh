#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to run the installer." >&2
  exit 1
fi

tmpfile="$(mktemp)"
trap 'rm -f "$tmpfile"' EXIT

curl -fsSL "https://raw.githubusercontent.com/mkrtc/opencode-session-status-prefix/main/install.mjs" -o "$tmpfile"
node "$tmpfile" "$@"
