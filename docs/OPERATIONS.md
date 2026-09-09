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
