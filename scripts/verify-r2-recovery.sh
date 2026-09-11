#!/usr/bin/env bash
set -euo pipefail

# ⚠ UNLIKE verify-d1-recovery.sh, THIS SCRIPT HAS NO TESTED PRECEDENT TO COPY.
# chms's own backup/restore tooling (which this repo's D1 drill is a direct
# port of) covers only D1 -- there is no R2 equivalent anywhere yet, in any
# Timothy Digital repo. This is a first build, following the same shape (a
# real restore into a disposable resource, verified, then torn down) using
# Cloudflare's own documented approach for scripting R2 object contents: the
# S3-compatible API. It has not been run against live R2 -- run it once by
# hand (workflow_dispatch) and read the summary before trusting it the way
# the D1 drill can already be trusted.
#
# Two separate Cloudflare credential types are involved, and that split is
# not incidental: bucket LIFECYCLE (create/delete a bucket) goes through
# wrangler's own R2 commands and the ordinary CLOUDFLARE_API_TOKEN this repo
# already uses everywhere else (see deploy.yml's own
# `wrangler r2 bucket create tlc-news-images`). Object-level work (list,
# copy, delete-inside-a-bucket) is NOT exposed by Cloudflare's REST API at
# all for R2 -- Cloudflare's own docs are explicit that object operations are
# S3-protocol-only -- so that half needs a second, R2-specific credential
# pair (an R2 API token's Access Key ID/Secret Access Key, from the
# Cloudflare dashboard's R2 > "Manage R2 API Tokens", scoped read+write to
# this bucket only) and the account id, for the S3 endpoint URL. See this
# repo's AGENTS.md and the PR this shipped in for the full setup list.

source_bucket="${SOURCE_BUCKET:-tlc-news-images}"
account_id="${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
restore_bucket="tlc-news-images-recovery-$(date -u +%Y%m%d%H%M%S)-$$"
temp_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/timothy-r2-recovery.XXXXXX")"
result_file="${RESULT_FILE:-/tmp/timothy-r2-recovery-result.json}"
restore_created=0
endpoint_url="https://${account_id}.r2.cloudflarestorage.com"

chmod 700 "$temp_dir"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Bucket lifecycle only -- create/delete/list buckets. Cloudflare's own API,
# via wrangler, same CLOUDFLARE_API_TOKEN as the rest of this repo.
wrangler() {
  WRANGLER_LOG_PATH="$temp_dir/wrangler.log" command wrangler "$@"
}

# Object-level work -- list/copy/delete objects inside a bucket. R2's
# S3-compatible endpoint, the separate R2-scoped access key pair. Region is
# meaningless to R2 but the AWS CLI requires one to be set.
s3() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION=auto \
  aws s3 --endpoint-url "$endpoint_url" "$@"
}

cleanup() {
  if [[ "$restore_created" == "1" ]]; then
    s3 rm "s3://${restore_bucket}" --recursive >/dev/null 2>&1 || true
    wrangler r2 bucket delete "$restore_bucket" >/dev/null 2>&1 || true
  fi
  rm -rf "$temp_dir"
}
trap cleanup EXIT

# A manifest of key + etag + size, sorted, so two buckets can be compared by
# content identity without downloading a single object. ETag is the object's
# MD5 for a plain upload; R2 (like S3) uses a different, non-MD5 composite
# ETag for anything uploaded multipart, which this still catches correctly as
# a MISMATCH if a copy changed how the object was stored -- it does not
# silently treat "same bytes, different upload shape" as identical, which is
# the honest answer: this drill proves the disposable copy is byte-identical
# by construction (a copy, not a re-upload), not that it verified content
# hashes indifferent to upload method.
manifest() {
  local bucket="$1"
  local output="$2"
  s3api_list "$bucket" | \
    python3 -c "
import json, sys
rows = json.load(sys.stdin)
out = sorted([{'key': o['Key'], 'etag': o['ETag'].strip('\"'), 'size': o['Size']} for o in rows], key=lambda r: r['key'])
json.dump(out, sys.stdout, separators=(',', ':'), sort_keys=True)
" > "$output"
}

s3api_list() {
  local bucket="$1"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  AWS_DEFAULT_REGION=auto \
  aws s3api list-objects-v2 --endpoint-url "$endpoint_url" --bucket "$bucket" --output json \
    | jq -c '.Contents // []'
}

echo "[1/6] Verifying the source bucket is reachable"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto \
  aws s3api head-bucket --endpoint-url "$endpoint_url" --bucket "$source_bucket"

echo "[2/6] Listing the source bucket"
manifest "$source_bucket" "$temp_dir/source-manifest.json"
source_objects="$(jq 'length' "$temp_dir/source-manifest.json")"
source_bytes="$(jq '[.[].size] | add // 0' "$temp_dir/source-manifest.json")"
source_manifest_sha="$(sha256_file "$temp_dir/source-manifest.json")"

echo "[3/6] Creating the disposable R2 bucket and copying every object into it"
wrangler r2 bucket create "$restore_bucket" >/dev/null
restore_created=1
if [[ "$source_objects" -gt 0 ]]; then
  s3 sync "s3://${source_bucket}" "s3://${restore_bucket}" --only-show-errors
fi

echo "[4/6] Reconciling the restored copy against the source manifest"
manifest "$restore_bucket" "$temp_dir/restore-manifest.json"
restore_objects="$(jq 'length' "$temp_dir/restore-manifest.json")"
if ! cmp -s "$temp_dir/source-manifest.json" "$temp_dir/restore-manifest.json"; then
  python3 - "$temp_dir/source-manifest.json" "$temp_dir/restore-manifest.json" <<'PY'
import json, sys
source = {r['key']: r for r in json.load(open(sys.argv[1]))}
restore = {r['key']: r for r in json.load(open(sys.argv[2]))}
only_source = sorted(source.keys() - restore.keys())
only_restore = sorted(restore.keys() - source.keys())
changed = sorted(k for k in source.keys() & restore.keys() if source[k] != restore[k])
if only_source: print('Present in source only:', ', '.join(only_source[:20]))
if only_restore: print('Present in restored copy only:', ', '.join(only_restore[:20]))
if changed: print('ETag/size mismatch:', ', '.join(changed[:20]))
PY
  exit 31
fi
restore_manifest_sha="$(sha256_file "$temp_dir/restore-manifest.json")"

echo "[5/6] Deleting the disposable bucket's objects and the bucket itself"
if [[ "$restore_objects" -gt 0 ]]; then
  s3 rm "s3://${restore_bucket}" --recursive --only-show-errors >/dev/null
fi
wrangler r2 bucket delete "$restore_bucket" >/dev/null
restore_created=0

echo "[6/6] Confirming the disposable bucket is gone"
wrangler r2 bucket list --json > "$temp_dir/buckets.json" 2>/dev/null || wrangler r2 bucket list > "$temp_dir/buckets.txt"
if [[ -f "$temp_dir/buckets.json" ]]; then
  jq -e --arg name "$restore_bucket" '[.[] // .buckets[]? // empty] | all(.name != $name)' "$temp_dir/buckets.json" >/dev/null 2>&1 || \
    ! grep -q "$restore_bucket" "$temp_dir/buckets.json"
else
  ! grep -q "$restore_bucket" "$temp_dir/buckets.txt"
fi

jq -n \
  --arg completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg source_bucket "$source_bucket" \
  --argjson source_objects "$source_objects" \
  --argjson source_bytes "$source_bytes" \
  --arg source_manifest_sha256 "$source_manifest_sha" \
  --argjson restore_objects "$restore_objects" \
  --arg restore_manifest_sha256 "$restore_manifest_sha" \
  --arg restore_bucket "$restore_bucket" \
  '{completed_at:$completed_at,source_bucket:$source_bucket,source_objects:$source_objects,source_bytes:$source_bytes,source_manifest_sha256:$source_manifest_sha256,restore_objects_matched:$restore_objects,restore_manifest_sha256:$restore_manifest_sha256,disposable_bucket:$restore_bucket,disposable_bucket_deleted:true,object_keys_logged:false}' > "$result_file"

cat "$result_file"
