#!/bin/sh
# Runs the SMTP dialogue harness against src/lib/email.ts.
#
#   sh scripts/smtp-harness/run.sh              # working tree
#   sh scripts/smtp-harness/run.sh origin/main  # any git revision
#
# Requires `npm install` (esbuild is a devDependency). Nothing is written to
# the repo: the bundle goes to a temp dir and is removed on exit.
set -e

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
HARNESS="$ROOT/scripts/smtp-harness"
REV=${1:-}

ESBUILD="$ROOT/node_modules/.bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "esbuild not found - run 'npm install' first." >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -n "$REV" ]; then
  git -C "$ROOT" show "$REV:src/lib/email.ts" > "$TMP/email.ts"
  echo "# bundling src/lib/email.ts at $REV"
else
  cp "$ROOT/src/lib/email.ts" "$TMP/email.ts"
  echo "# bundling src/lib/email.ts from the working tree"
fi

"$ESBUILD" "$TMP/email.ts" \
  --bundle --format=esm --platform=node \
  --alias:cloudflare:sockets="$HARNESS/stub-sockets.mjs" \
  --outfile="$TMP/mailer-bundle.mjs" >/dev/null

MAILER_BUNDLE="$TMP/mailer-bundle.mjs" node "$HARNESS/run-matrix.mjs"
