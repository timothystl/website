#!/usr/bin/env bash
set -euo pipefail
git fetch --quiet origin main
release_sha="$(git rev-parse HEAD)"
if [ "$release_sha" != "$(git rev-parse origin/main)" ]; then
  echo 'Superseded release: a newer reviewed main commit will deploy.'
  echo 'deploy=false' >> "$GITHUB_OUTPUT"
  exit 0
fi
RELEASE_SHA="$release_sha" node --input-type=module <<'JS'
import fs from 'node:fs';
const path = 'admin/helpers.js';
const source = fs.readFileSync(path, 'utf8');
const suffix = '-g' + process.env.RELEASE_SHA.slice(0, 12);
const next = source.replace(/export const VERSION = '([^']+)'/, (_, current) =>
  `export const VERSION = '${current.replace(/-g[a-f0-9]{12}$/, '')}${suffix}'`);
if (!next.includes(suffix)) throw new Error('Admin version not found');
fs.writeFileSync(path, next);
JS
echo 'deploy=true' >> "$GITHUB_OUTPUT"
echo "sha=$release_sha" >> "$GITHUB_OUTPUT"
