# Operations

## Releases

`.github/workflows/deploy.yml` runs on every push to `main` and deploys the Site, Admin, and Links
Workers from one recorded checkout. One serialized job records an Admin version-only commit
(`admin/helpers.js` `VERSION`, `[skip ci]`), then deploys all three Workers. The workflow shares one
concurrency lock, never cancels a release in progress, and skips a stale queued run before any
production write (`.github/scripts/prepare-release.sh`; `admin/release-order.test.mjs`).

- The completed workflow run, not the version commit, confirms deployment. The version commit records
  an intended release.
- If a deployment fails, rerun it while its version-only child is still the current `main`, or release
  newer `main`. Cloudflare does not deploy three Workers atomically, so a failure can leave them on
  different revisions until the rerun.
- The commit SHA identifies a deployed build exactly; see [VERSIONING.md](VERSIONING.md).

Use a normal branch, complete the applicable checks ([TESTING.md](TESTING.md)), and merge finished work
under [AGENTS.md](../AGENTS.md). A requested routine release needs no further approval. To roll back,
redeploy the affected Worker to a known-good deployment or a reviewed commit, then check the public
site, login, and an API route. Application rollback does not undo D1 or R2 state.

The production resources are defined in `wrangler-site.toml`, `wrangler.toml`, and
`wrangler-links.toml`. Inspect with Wrangler dry runs before configuration changes. Never print secret
values or private form, payroll, renter, or vendor records. Names, purposes, and rotation locations
for every Worker secret, variable, binding, and GitHub Actions secret are in [SECRETS.md](SECRETS.md);
the Cloudflare token audit and rotation map is
[CLOUDFLARE_TOKENS.md](https://github.com/timothystl/Connect/blob/main/docs/CLOUDFLARE_TOKENS.md).

## Integrations

- `CONNECT_WORKER` targets `timothy-connect`. Contact/prayer forwarding and the Market volunteer
  integration depend on that name. The binding resolves by name, so renaming Connect's Worker
  requires updating `wrangler.toml` here. Failed forwards and manual retry:
  [CHMS_FORWARD_RECOVERY.md](CHMS_FORWARD_RECOVERY.md).
- Website hosts the payroll backend that Finance (`timothystl/finance`, Worker `timothy-finance-app`)
  reaches through its `PAYROLL_SERVICE` binding to `timothy-website-admin`. The relay does not move
  payroll ownership; shared staff login and the payroll migration are unfinished
  ([DATA-OWNERSHIP.md](DATA-OWNERSHIP.md)). Renaming this Worker requires redeploying Finance.
- The Stax public giving mockup (`give-stax-mockup.js`) is Website-owned; Connect keeps the giving
  backend. It is not a live-provider cutover.

## Recovery

Tooling is `scripts/verify-d1-recovery.sh` and `scripts/verify-r2-recovery.sh` with the matching
`verify-d1-recovery.yml` and `verify-r2-recovery.yml` workflows (dispatched manually with an exact
`main` SHA and a reason). Completed drills show the procedure works; they are not proof of a retained
backup's current custody or freshness.

## Resource names

The Admin Worker, D1 database, and R2 bucket were renamed to `timothy-website-admin`,
`timothy-website-db`, and `timothy-website-images` on September 28, 2026, and the public Worker and
links Worker to `timothy-website` and `timothy-links` the same day; hostnames and binding names did not
change. The old database and bucket remain untouched as the rollback path until retired after a
retention window. See [NAMING-CUTOVER.md](NAMING-CUTOVER.md).

## Newsletter

Website Admin reads two Brevo list numbers from Cloudflare (Workers, `timothy-website-admin`, Settings,
Variables and Secrets): `BREVO_LIST_ID` is the full weekly list (4) and `BREVO_TEST_LIST_ID` is the test
list (2). There is no built-in fallback for either. A missing setting shows an error (newsletter sends)
or fails the signup with a logged message, rather than using another list. Set `BREVO_TEST_LIST_ID`
to 2 before sending a test issue. `admin/brevo-list-config.test.mjs` guards against a hardcoded fallback.
Never send a real newsletter to test a deployment.

Each issue has one durable schedule lock (`schedule_operation`, [ADR 0003](adr/0003-newsletter-lock-gym-overlap-and-release-order.md)).
If a Worker is forcibly terminated mid-operation the lock intentionally stays set. An operator must
inspect that issue's saved campaign in Brevo, verify no request is still in flight, reconcile the
campaign state, and only then clear `schedule_operation`. Do not add automatic expiry. A lost
draft-creation response can leave an unscheduled orphan draft, but it cannot send.
