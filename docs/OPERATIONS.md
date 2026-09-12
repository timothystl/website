# Operations

`.github/workflows/deploy.yml` runs on every push to `main` and deploys the Site, Admin, and Links
Workers. After all three succeed, the version job may increment the Admin patch version, redeploy
Admin, and push a `[skip ci]` version commit. This behavior is intentional current release policy.

Because `main` is production, use an ordinary review branch, require green checks, and obtain
explicit release approval before merge. Capture the intended commit and current/prior Cloudflare
deployments before release. Roll back the affected Worker to a known-good deployment or redeploy a
reviewed commit, then perform bounded public/login/API checks. Application rollback does not undo
D1/R2 state.

The production resources are defined in `wrangler-site.toml`, `wrangler.toml`, and
`wrangler-links.toml`. Inspect with Wrangler dry runs before configuration changes. Never print
secret values or private form/payroll/renter/vendor records.

Website-to-Connect replay status and manual retry use [the dedicated runbook](CHMS_FORWARD_RECOVERY.md).

## Backup and restore verification

`.github/workflows/verify-d1-recovery.yml` and `verify-r2-recovery.yml` are manual-only
(`workflow_dispatch`, requiring an approved `main` commit SHA and a reason, gated to the
`production` environment) drills that export/copy production data, restore it into a disposable
D1 database or R2 bucket, reconcile it against the source, then delete the disposable copy —
ported from `chms`'s own tested drill (`scripts/verify-d1-recovery.sh` there). Neither prints or
retains sensitive row values or file contents.

- `scripts/verify-d1-recovery.sh` covers `tlc-newsletter-db`: schema, integrity, foreign keys,
  every table's row count, and (if this schema's column names match the same monetary-keyword
  heuristic chms's Finance data does) numeric control totals.
- `scripts/verify-r2-recovery.sh` covers `tlc-news-images` — genuinely new tooling, since chms
  has no R2 backup precedent to port. It is a v1: object-level R2 operations only exist through
  R2's S3-compatible API (not the plain Cloudflare API token used elsewhere in this repo), so it
  needs its own R2-scoped S3 credentials as a separate secret. It verifies key-set and size
  completeness after a real server-side copy, not yet byte-for-byte content — treat a clean run
  as "every object present at the right size," and widen it with a content-hash comparison
  before relying on it alone for a real incident.

Both are committed but have never been dispatched. Before the first real run: create the
`CLOUDFLARE_D1_API_TOKEN`, `CLOUDFLARE_R2_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
and `R2_ACCOUNT_ID` repository secrets referenced in the two workflow files (none exist yet), and
treat that first dispatch as validating the tooling itself, not only the data — this exact
sequence has not been proven against `tlc-newsletter-db`/`tlc-news-images` yet, unlike chms's
drill, which has passed for real. Both need Andrew's explicit approval to dispatch.
