#!/usr/bin/env bash
set -euo pipefail

# ── R2 backup/restore verification drill ─────────────────────────────────────
# Modeled on chms's scripts/verify-d1-recovery.sh (export -> disposable restore -> reconcile ->
# delete), adapted for R2: Cloudflare's object-level R2 operations (list/get/put/copy/delete) are
# only exposed through R2's S3-compatible API, not the plain Cloudflare REST API a Wrangler/D1
# token uses -- see https://developers.cloudflare.com/r2/api/s3/api/ and
# https://developers.cloudflare.com/r2/api/tokens/. So this script needs its OWN R2-scoped
# S3 access-key-id/secret-access-key pair (Object Read & Write), separate from
# CLOUDFLARE_D1_API_TOKEN, plus the account id the S3 endpoint is keyed to. Bucket CREATE/DELETE
# still goes through Wrangler (CLOUDFLARE_API_TOKEN), matching the D1 script's own preference for
# Wrangler wherever it can do the job.
#
# Unlike the D1 drill, this is a v1: it verifies key-set and size completeness after a real
# server-side copy (S3 CopyObject -- no bytes cross this machine), not a byte-for-byte content
# hash. Treat a clean run as "every object present with the right size," not yet "byte-identical
# content" -- widen it with a content hash comparison (HeadObject's ETag is not reliably
# byte-identical across a copy for multipart-uploaded originals) before leaning on this alone.

source_bucket="${SOURCE_BUCKET:?SOURCE_BUCKET is required}"
account_id="${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
endpoint="https://${account_id}.r2.cloudflarestorage.com"
restore_bucket="tlc-r2-recovery-$(date -u +%Y%m%d%H%M%S)-$$"
temp_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/timothy-r2-recovery.XXXXXX")"
result_file="${RESULT_FILE:-/tmp/timothy-r2-recovery-result.json}"
restore_created=0

# R2 quirk (community-documented, not yet in Cloudflare's primary docs): recent AWS CLI/SDK
# versions default to sending CRC32/CRC64NVME trailer checksums R2 does not implement, which can
# surface as a checksum-algorithm error or a stray "aws-chunked" Content-Encoding on the object.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

chmod 700 "$temp_dir"

wrangler() {
  WRANGLER_LOG_PATH="$temp_dir/wrangler.log" command wrangler "$@"
}

aws_r2() {
  aws --endpoint-url "$endpoint" --region auto "$@"
}

cleanup() {
  if [[ "$restore_created" == "1" ]]; then
    # Best-effort: empty the disposable bucket before deleting it (a non-empty bucket delete
    # fails), then delete the bucket itself. Never touches the source bucket.
    keys_file="$temp_dir/restore-keys-for-cleanup.txt"
    if [[ -s "$keys_file" ]]; then
      while IFS= read -r key; do
        [[ -n "$key" ]] && aws_r2 s3api delete-object --bucket "$restore_bucket" --key "$key" >/dev/null 2>&1 || true
      done < "$keys_file"
    fi
    wrangler r2 bucket delete "$restore_bucket" >/dev/null 2>&1 || true
  fi
  rm -rf "$temp_dir"
}
trap cleanup EXIT

list_objects() {
  # Paginates ListObjectsV2 (max 1000 keys/page) into one flat "key\tsize" manifest, sorted for
  # a stable diff against the other bucket's listing.
  local bucket="$1"
  local out="$2"
  local token=""
  : > "$out.raw"
  while :; do
    if [[ -z "$token" ]]; then
      aws_r2 s3api list-objects-v2 --bucket "$bucket" --max-items 1000 > "$temp_dir/page.json"
    else
      aws_r2 s3api list-objects-v2 --bucket "$bucket" --max-items 1000 --starting-token "$token" > "$temp_dir/page.json"
    fi
    jq -r '.Contents // [] | .[] | [.Key, (.Size|tostring)] | @tsv' "$temp_dir/page.json" >> "$out.raw"
    token="$(jq -r '.NextToken // empty' "$temp_dir/page.json")"
    [[ -z "$token" ]] && break
  done
  sort "$out.raw" > "$out"
  rm -f "$out.raw"
}

echo "[1/6] Verifying the source R2 bucket is reachable"
aws_r2 s3api head-bucket --bucket "$source_bucket"

echo "[2/6] Listing every object in the source bucket"
list_objects "$source_bucket" "$temp_dir/source-manifest.tsv"
source_count="$(wc -l < "$temp_dir/source-manifest.tsv" | tr -d ' ')"
cut -f1 "$temp_dir/source-manifest.tsv" > "$temp_dir/source-keys.txt"
test "$source_count" -gt 0

echo "[3/6] Creating the disposable bucket"
wrangler r2 bucket create "$restore_bucket" >/dev/null
restore_created=1

echo "[4/6] Server-side copying every object into the disposable bucket ($source_count objects)"
while IFS=$'\t' read -r key size; do
  aws_r2 s3api copy-object --bucket "$restore_bucket" --key "$key" \
    --copy-source "$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]+"/"+sys.argv[2]))' "$source_bucket" "$key")" >/dev/null
done < "$temp_dir/source-manifest.tsv"

echo "[5/6] Reconciling key set and object sizes"
list_objects "$restore_bucket" "$temp_dir/restore-manifest.tsv"
cut -f1 "$temp_dir/restore-manifest.tsv" > "$temp_dir/restore-keys.txt"
cp "$temp_dir/restore-keys.txt" "$temp_dir/restore-keys-for-cleanup.txt"
restore_count="$(wc -l < "$temp_dir/restore-manifest.tsv" | tr -d ' ')"

if ! cmp -s "$temp_dir/source-manifest.tsv" "$temp_dir/restore-manifest.tsv"; then
  echo "Key/size reconciliation mismatch:"
  diff "$temp_dir/source-manifest.tsv" "$temp_dir/restore-manifest.tsv" || true
  exit 31
fi
manifest_sha="$(sha256sum "$temp_dir/source-manifest.tsv" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$temp_dir/source-manifest.tsv" | awk '{print $1}')"

echo "[6/6] Deleting every object in the disposable bucket, then the bucket itself"
while IFS= read -r key; do
  [[ -n "$key" ]] && aws_r2 s3api delete-object --bucket "$restore_bucket" --key "$key" >/dev/null
done < "$temp_dir/restore-keys.txt"
wrangler r2 bucket delete "$restore_bucket" >/dev/null
restore_created=0

jq -n \
  --arg completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg source_bucket "$source_bucket" \
  --argjson objects_matched "$source_count" \
  --argjson restore_objects "$restore_count" \
  --arg manifest_control_sha256 "$manifest_sha" \
  --arg disposable_bucket "$restore_bucket" \
  '{completed_at:$completed_at,source_bucket:$source_bucket,objects_matched:$objects_matched,restore_objects_matched:$restore_objects,manifest_control_sha256:$manifest_control_sha256,verification_kind:"key_set_and_size_only_not_byte_content",disposable_bucket:$disposable_bucket,disposable_bucket_deleted:true,object_bytes_never_left_r2:true}' > "$result_file"

cat "$result_file"
