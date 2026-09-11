#!/usr/bin/env bash
set -euo pipefail

# Modeled directly on chms's scripts/verify-d1-recovery.sh (that repo's own
# tested drill — see its AGENTS.md: "CHMS's own backup/restore is real and
# tested"). The verification logic below is schema-agnostic (row counts,
# schema/integrity checks, and a generic monetary-column-name scan), so it is
# carried over essentially unchanged; only the database name/id, the
# disposable-database prefix, and the wrangler invocation (this repo has no
# package.json, so wrangler is installed globally by the workflow rather than
# run through `npx`) are specific to this repo.

source_db="${SOURCE_DB:-tlc-newsletter-db}"
source_db_id="${SOURCE_DB_ID:?SOURCE_DB_ID is required}"
restore_db="tlc-newsletter-recovery-$(date -u +%Y%m%d%H%M%S)-$$"
temp_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/timothy-d1-recovery.XXXXXX")"
export_file="$temp_dir/tlc-newsletter-db.sql"
import_file="$temp_dir/tlc-newsletter-db-import.sql"
rewrite_metadata="$temp_dir/rewrite-metadata.json"
snapshot_db="$temp_dir/source-snapshot.sqlite"
result_file="${RESULT_FILE:-/tmp/timothy-d1-recovery-result.json}"
restore_created=0

chmod 700 "$temp_dir"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# No package.json here (unlike chms), so wrangler is installed globally by
# the workflow before this script runs — invoked directly, not via `npx`.
wrangler() {
  WRANGLER_LOG_PATH="$temp_dir/wrangler.log" command wrangler "$@"
}

cleanup() {
  if [[ "$restore_created" == "1" ]]; then
    wrangler d1 delete "$restore_db" --skip-confirmation >/dev/null 2>&1 || true
  fi
  python3 - "$temp_dir" <<'PY'
import shutil, sys
shutil.rmtree(sys.argv[1], ignore_errors=True)
PY
}
trap cleanup EXIT

run_query() {
  local database="$1"
  local sql="$2"
  local output="$3"
  local error_output="${output}.stderr"
  if ! wrangler d1 execute "$database" --remote --json --command "$sql" > "$output" 2> "$error_output"; then
    echo "D1 aggregate query failed:"
    tail -n 20 "$error_output"
    jq -c 'if type == "array" then [.[] | {success,error}] else {error:(.error // .errors // .message // null)} end' "$output" 2>/dev/null || true
    return 1
  fi
  jq -e 'type == "array" and all(.[]; .success == true)' "$output" >/dev/null
}

local_query() {
  local database="$1"
  local sql="$2"
  local output="$3"
  python3 - "$database" "$sql" "$output" <<'PY'
import json, sqlite3, sys
database, sql, output = sys.argv[1:]
db=sqlite3.connect(database)
db.row_factory=sqlite3.Row
rows=[dict(row) for row in db.execute(sql).fetchall()]
db.close()
with open(output,'w') as f:
    json.dump([{'success':True,'results':rows}],f,separators=(',',':'))
PY
}

canonical_results() {
  jq -cS '[.[].results[]] | sort_by(tostring)' "$1"
}

batched_query() {
  local mode="$1"
  local database="$2"
  local statements_file="$3"
  local output="$4"
  local rows_file="${output}.rows"
  local batch_file="${output}.batch"
  local batch_sql=""
  local batch_count=0
  echo '[]' > "$rows_file"

  flush_batch() {
    if [[ "$batch_count" == "0" ]]; then return; fi
    if [[ "$mode" == "local" ]]; then
      local_query "$database" "${batch_sql};" "$batch_file"
    else
      run_query "$database" "${batch_sql};" "$batch_file"
    fi
    python3 - "$rows_file" "$batch_file" <<'PY'
import json, sys
rows=json.load(open(sys.argv[1]))
for result in json.load(open(sys.argv[2])):
    rows.extend(result.get('results',[]))
with open(sys.argv[1],'w') as f:
    json.dump(rows,f,separators=(',',':'))
PY
    batch_sql=""
    batch_count=0
  }

  while IFS= read -r statement; do
    if [[ -n "$batch_sql" ]]; then batch_sql+=" UNION ALL "; fi
    batch_sql+="$statement"
    batch_count=$((batch_count + 1))
    if [[ "$batch_count" == "5" ]]; then flush_batch; fi
  done < "$statements_file"
  flush_batch

  python3 - "$rows_file" "$output" <<'PY'
import json, sys
rows=json.load(open(sys.argv[1]))
with open(sys.argv[2],'w') as f:
    json.dump([{'success':True,'results':rows}],f,separators=(',',':'))
PY
}

echo "[1/7] Verifying the production D1 identity"
source_info="$temp_dir/source-info.json"
wrangler d1 info "$source_db" --json > "$source_info"
jq -e --arg expected "$source_db_id" '
  (if type == "array" then .[0] else . end)
  | (.uuid // .id) == $expected
' "$source_info" >/dev/null

echo "[2/7] Exporting production D1 to protected temporary storage"
wrangler d1 export "$source_db" --remote --output="$export_file" --skip-confirmation >/dev/null
chmod 600 "$export_file"
export_sha="$(sha256_file "$export_file")"
export_bytes="$(wc -c < "$export_file" | tr -d ' ')"

python3 - "$export_file" "$snapshot_db" <<'PY'
from pathlib import Path
import sqlite3, sys
source, database = sys.argv[1:]
db=sqlite3.connect(database)
db.executescript(Path(source).read_text(errors='strict'))
db.close()
PY

python3 scripts/prepare-d1-import.py "$export_file" "$import_file" "$rewrite_metadata"
rewritten_statements="$(jq '.rewritten_statements | length' "$rewrite_metadata")"
rewritten_cells="$(jq '.rewritten_cells | length' "$rewrite_metadata")"
max_statement_after="$(jq '.max_statement_after' "$rewrite_metadata")"

echo "[3/7] Creating and loading the disposable D1 restore"
wrangler d1 create "$restore_db" --location=wnam >/dev/null
restore_created=1
wrangler d1 execute "$restore_db" --remote --file="$import_file" --yes >/dev/null

if [[ "$rewritten_cells" -gt 0 ]]; then
  cell_index=0
  while [[ "$cell_index" -lt "$rewritten_cells" ]]; do
    table="$(jq -r ".rewritten_cells[$cell_index].table" "$rewrite_metadata")"
    column="$(jq -r ".rewritten_cells[$cell_index].column" "$rewrite_metadata")"
    where_sql="$(jq -r ".rewritten_cells[$cell_index].where_sql" "$rewrite_metadata")"
    expected_characters="$(jq -r ".rewritten_cells[$cell_index].characters" "$rewrite_metadata")"
    expected_bytes="$(jq -r ".rewritten_cells[$cell_index].bytes" "$rewrite_metadata")"
    [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
    [[ "$column" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
    length_sql="SELECT length(\"${column}\") AS characters, length(CAST(\"${column}\" AS BLOB)) AS bytes FROM \"${table}\" WHERE ${where_sql};"
    run_query "$restore_db" "$length_sql" "$temp_dir/rewrite-length-${cell_index}.json"
    jq -e --argjson characters "$expected_characters" --argjson bytes "$expected_bytes" '[.[].results[]] == [{"characters":$characters,"bytes":$bytes}]' "$temp_dir/rewrite-length-${cell_index}.json" >/dev/null
    cell_index=$((cell_index + 1))
  done
fi

echo "[4/7] Comparing schema, indexes, triggers, and integrity"
schema_sql="SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND sql IS NOT NULL ORDER BY type, name;"
local_query "$snapshot_db" "$schema_sql" "$temp_dir/source-schema.json"
run_query "$restore_db" "$schema_sql" "$temp_dir/restore-schema.json"
canonical_results "$temp_dir/source-schema.json" > "$temp_dir/source-schema.canonical"
canonical_results "$temp_dir/restore-schema.json" > "$temp_dir/restore-schema.canonical"
cmp -s "$temp_dir/source-schema.canonical" "$temp_dir/restore-schema.canonical"
schema_objects="$(jq 'length' "$temp_dir/source-schema.canonical")"
schema_sha="$(sha256_file "$temp_dir/source-schema.canonical")"

local_query "$snapshot_db" "PRAGMA quick_check;" "$temp_dir/source-integrity.json"
run_query "$restore_db" "PRAGMA quick_check;" "$temp_dir/restore-integrity.json"
jq -e '[.[].results[] | to_entries[].value] == ["ok"]' "$temp_dir/source-integrity.json" >/dev/null
jq -e '[.[].results[] | to_entries[].value] == ["ok"]' "$temp_dir/restore-integrity.json" >/dev/null

local_query "$snapshot_db" "PRAGMA foreign_key_check;" "$temp_dir/source-fk.json"
run_query "$restore_db" "PRAGMA foreign_key_check;" "$temp_dir/restore-fk.json"
jq -e '[.[].results[]] | length == 0' "$temp_dir/source-fk.json" >/dev/null
jq -e '[.[].results[]] | length == 0' "$temp_dir/restore-fk.json" >/dev/null

echo "[5/7] Reconciling every user-table row count"
table_sql="SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;"
local_query "$snapshot_db" "$table_sql" "$temp_dir/tables.json"
jq -r '.[].results[].name' "$temp_dir/tables.json" > "$temp_dir/tables.txt"
table_count="$(wc -l < "$temp_dir/tables.txt" | tr -d ' ')"
test "$table_count" -gt 0

: > "$temp_dir/row-statements.txt"
while IFS= read -r table; do
  [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
  statement="SELECT '${table}' AS table_name, COUNT(*) AS row_count FROM \"${table}\""
  echo "$statement" >> "$temp_dir/row-statements.txt"
done < "$temp_dir/tables.txt"

batched_query local "$snapshot_db" "$temp_dir/row-statements.txt" "$temp_dir/source-rows.json"
echo "      Export-snapshot row controls calculated"
batched_query remote "$restore_db" "$temp_dir/row-statements.txt" "$temp_dir/restore-rows.json"
echo "      Disposable-restore row controls calculated"
canonical_results "$temp_dir/source-rows.json" > "$temp_dir/source-rows.canonical"
canonical_results "$temp_dir/restore-rows.json" > "$temp_dir/restore-rows.canonical"
if ! cmp -s "$temp_dir/source-rows.canonical" "$temp_dir/restore-rows.canonical"; then
  python3 - "$temp_dir/source-rows.canonical" "$temp_dir/restore-rows.canonical" <<'PY'
import json, sys
source={r['table_name']:r['row_count'] for r in json.load(open(sys.argv[1]))}
restore={r['table_name']:r['row_count'] for r in json.load(open(sys.argv[2]))}
names=sorted(k for k in source.keys() | restore.keys() if source.get(k) != restore.get(k))
print('Row-count reconciliation mismatch in tables:', ', '.join(names))
PY
  exit 31
fi
row_sha="$(sha256_file "$temp_dir/source-rows.canonical")"

echo "[6/7] Reconciling numeric financial control totals"
column_sql="SELECT m.name AS table_name, p.name AS column_name, COALESCE(p.type, '') AS column_type FROM sqlite_schema AS m JOIN pragma_table_info(m.name) AS p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' ORDER BY m.name, p.cid;"
local_query "$snapshot_db" "$column_sql" "$temp_dir/columns.json"

: > "$temp_dir/monetary-statements.txt"
monetary_controls=0
while IFS=$'\t' read -r table column column_type; do
  [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
  [[ "$column" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
  lower_column="$(printf '%s' "$column" | tr '[:upper:]' '[:lower:]')"
  lower_type="$(printf '%s' "$column_type" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower_column" =~ (amount|total|balance|fee|cost|budget|pledge|gift|donation|income|expense|tuition|payment|salary|compensation|revenue|principal|interest|allocation|forecast|reserve|price) ]] &&
     [[ "$lower_type" =~ (int|real|num|dec|double|float) ]]; then
    statement="SELECT '${table}' AS table_name, '${column}' AS column_name, COUNT(\"${column}\") AS populated_rows, printf('%.17g', COALESCE(SUM(CAST(\"${column}\" AS REAL)), 0)) AS control_total FROM \"${table}\""
    echo "$statement" >> "$temp_dir/monetary-statements.txt"
    monetary_controls=$((monetary_controls + 1))
  fi
done < <(jq -r '.[].results[] | [.table_name, .column_name, .column_type] | @tsv' "$temp_dir/columns.json")

if [[ "$monetary_controls" -gt 0 ]]; then
  batched_query local "$snapshot_db" "$temp_dir/monetary-statements.txt" "$temp_dir/source-money.json"
  batched_query remote "$restore_db" "$temp_dir/monetary-statements.txt" "$temp_dir/restore-money.json"
  canonical_results "$temp_dir/source-money.json" > "$temp_dir/source-money.canonical"
  canonical_results "$temp_dir/restore-money.json" > "$temp_dir/restore-money.canonical"
  cmp -s "$temp_dir/source-money.canonical" "$temp_dir/restore-money.canonical"
  monetary_sha="$(sha256_file "$temp_dir/source-money.canonical")"
else
  # Unlike tlc-volunteer-db (chms), this database's numeric columns are not
  # guaranteed to include anything matching the money-shaped name/type scan
  # (this repo's few payment-adjacent numbers — gym invoice totals, market
  # vendor fees, event fees — live in separate tables that may or may not be
  # present or populated at drill time). A zero match is reported rather than
  # treated as a hard failure, but it is never silent: it is written into the
  # summary below so a run that quietly stopped finding financial columns is
  # visible, not just "green."
  echo "      No monetary-shaped columns found — reporting zero controls rather than failing"
  monetary_sha="none"
fi

echo "[7/7] Deleting the disposable D1 and plaintext export"
wrangler d1 delete "$restore_db" --skip-confirmation >/dev/null
restore_created=0
wrangler d1 list --json > "$temp_dir/databases.json"
jq -e --arg name "$restore_db" 'all(.[]; .name != $name)' "$temp_dir/databases.json" >/dev/null
python3 - "$export_file" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
if p.exists(): p.unlink()
PY
test ! -e "$export_file"

jq -n \
  --arg completed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg source_db "$source_db" \
  --arg source_db_id "$source_db_id" \
  --arg restore_db "$restore_db" \
  --arg export_sha256 "$export_sha" \
  --argjson export_bytes "$export_bytes" \
  --argjson schema_objects "$schema_objects" \
  --arg schema_control_sha256 "$schema_sha" \
  --argjson tables "$table_count" \
  --arg row_control_sha256 "$row_sha" \
  --argjson monetary_controls "$monetary_controls" \
  --arg monetary_control_sha256 "$monetary_sha" \
  --argjson rewritten_statements "$rewritten_statements" \
  --argjson rewritten_cells "$rewritten_cells" \
  --argjson max_statement_after "$max_statement_after" \
  '{completed_at:$completed_at,source_db:$source_db,source_db_id_verified:$source_db_id,export_bytes:$export_bytes,export_sha256:$export_sha256,oversized_export_statements_rewritten:$rewritten_statements,large_cells_length_verified:$rewritten_cells,max_import_statement_bytes:$max_statement_after,schema_objects_matched:$schema_objects,schema_control_sha256:$schema_control_sha256,foreign_key_violations:0,integrity_check:"ok",tables_matched:$tables,row_control_sha256:$row_control_sha256,monetary_controls_matched:$monetary_controls,monetary_control_sha256:$monetary_control_sha256,disposable_database:$restore_db,disposable_database_deleted:true,plaintext_export_deleted:true,sensitive_values_logged:false}' > "$result_file"

cat "$result_file"
