#!/usr/bin/env bash
set -euo pipefail
# Called while holding the workflow-wide production lock. Never rebase a release
# onto a moving main: all three Workers must use this one checkout.
git fetch --quiet origin main
# A rerun after a failed Worker deployment can resume its version-only child.
# It must never pick up application changes that arrived on main afterward.
if [ "$(git rev-parse origin/main^)" = "$(git rev-parse HEAD)" ] &&
   [ "$(git log -1 --format=%s origin/main)" = "Record production release version [skip ci]" ] &&
   [ "$(git diff --name-only HEAD origin/main)" = 'admin/helpers.js' ]; then
  changes=$(git diff --unified=0 HEAD origin/main -- admin/helpers.js | grep -E '^[+-]' | grep -vE '^(---|\+\+\+)')
  if [ "$(printf '%s\n' "$changes" | wc -l | tr -d ' ')" = '2' ] &&
     ! printf '%s\n' "$changes" | grep -qvE "^[+-]export const VERSION = 'v[0-9.]+'.*"; then
    git checkout --quiet --detach origin/main
    echo 'deploy=true' >> "$GITHUB_OUTPUT"
    echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
    exit 0
  fi
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo 'Superseded release: a newer main commit will deploy.'
  echo 'deploy=false' >> "$GITHUB_OUTPUT"
  exit 0
fi
if ! git diff HEAD^ HEAD -- admin/helpers.js | grep -q '^+export const VERSION = '; then
  node --input-type=module <<'JS'
import fs from 'node:fs';
const path = 'admin/helpers.js';
const source = fs.readFileSync(path, 'utf8');
const next = source.replace(/export const VERSION = 'v(\d+)\.(\d+)(?:\.(\d+))?'/, (_, major, minor, patch) => `export const VERSION = 'v${major}.${minor}.${Number(patch || 0) + 1}'`);
if (next === source) throw new Error('Admin version not found');
fs.writeFileSync(path, next);
JS
  git config user.name 'github-actions[bot]'
  git config user.email 'github-actions[bot]@users.noreply.github.com'
  git add admin/helpers.js
  git commit --quiet -m 'Record production release version [skip ci]'
  if ! git push --quiet origin HEAD:main; then
    git fetch --quiet origin main
    if [ "$(git rev-parse HEAD^)" != "$(git rev-parse origin/main)" ]; then
      echo 'Main advanced; defer to its release without deploying this revision.'
      echo 'deploy=false' >> "$GITHUB_OUTPUT"
      exit 0
    fi
    echo '::error::Could not record release version.'
    exit 1
  fi
fi
echo 'deploy=true' >> "$GITHUB_OUTPUT"
echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
