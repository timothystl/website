# Website Admin naming cutover

Renames the three legacy Website Admin resources to the `timothy-website-*` standard
([naming standard](https://github.com/timothystl/digital-architecture/blob/main/architecture/12-environments-naming-and-cutover.md)).
`admin.timothystl.org` and every binding name (`DB`, `IMAGES`, `CONNECT_WORKER`) stay the same.

| Resource | Now | Target | Method |
|---|---|---|---|
| Worker | `tlc-newsletter-admin` | `timothy-website-admin` | In-place rename in the Cloudflare dashboard (same script, routes, secrets, cron) |
| D1 database | `tlc-newsletter-db` | `timothy-website-db` | New database, copy, repoint |
| R2 bucket | `tlc-news-images` | `timothy-website-images` | New bucket, copy, repoint |

## Order

1. **Copy data (repeatable, changes nothing live).** Dispatch `migrate-d1-database.yml` and
   `migrate-images-r2.yml` from main with the exact main SHA. Each creates its destination if
   missing, copies, and reconciles (schema, row counts, integrity, foreign keys, numeric totals,
   AUTOINCREMENT state for D1; object count, size, and ETag for R2). The D1 summary prints the
   new database id. If a token cannot create a resource, create it in the dashboard and re-run.
   The R2 key pair (`R2_RECOVERY_*`) must be able to read the old bucket and write the new one.
2. **Cutover PR.** One PR changes `wrangler.toml` to the new Worker name, database name/id, and
   bucket name, and Connect's `wrangler.finance*.jsonc` change `PAYROLL_SERVICE` to the new
   Worker name. Re-run both copy workflows immediately before merging to catch up on recent writes.
3. **Rename the Worker in the dashboard first** (Worker Settings → General → Name), then merge.
   Merging first would make `wrangler deploy` create a new, empty Worker with no routes or
   secrets under the new name. Cloudflare's rename changes the script name, but service bindings
   from other Workers resolve by name, so Finance's payroll relay is unavailable from the rename
   until Finance is redeployed with the new name; dispatch that deploy right after the merge.
4. **Verify:** admin login, a page save, an image upload and display, the newsletter list,
   payroll relay from Finance (read-only), and the scheduled promote-pages cron.
5. **Retire the old database and bucket** only after a retention window and a final reconciliation.
   Both stay untouched until then; they are the rollback path (repoint `wrangler.toml` and redeploy).

## Rollback

Code rollback is a redeploy of the previous commit. Data written to the new database or bucket
after cutover is not in the old ones, so roll back only within the first minutes, or copy
forward first.
