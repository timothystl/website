# Operations

`.github/workflows/deploy.yml` runs on every push to `main` and deploys the Site, Admin, and Links
Workers. After all three succeed, the version job may increment the Admin patch version, redeploy
Admin, and push a `[skip ci]` version commit. This behavior is intentional current release policy.

Use a normal branch, complete applicable checks, and merge finished work under
[AGENTS.md](../AGENTS.md). A requested routine release does not need another approval because
main auto-deploys. Record the released revision and verify workflow completion. Roll back the affected Worker to a known-good deployment or redeploy a
reviewed commit, then perform bounded public/login/API checks. Application rollback does not undo
D1/R2 state.

The production resources are defined in `wrangler-site.toml`, `wrangler.toml`, and
`wrangler-links.toml`. Inspect with Wrangler dry runs before configuration changes. Never print
secret values or private form/payroll/renter/vendor records.

Website-to-Connect replay status and manual retry use [the dedicated runbook](CHMS_FORWARD_RECOVERY.md).

## Recovery and integration checkpoint — September 15, 2026

The [D1 recovery workflow](https://github.com/timothystl/website/actions/runs/34658846953)
and [R2 recovery workflow](https://github.com/timothystl/website/actions/runs/34659001060)
both completed successfully September 11. Tooling lives in `scripts/verify-d1-recovery.sh`,
`scripts/verify-r2-recovery.sh` and their matching workflows. These are completed recovery
exercises, not proof of a retained backup's current custody or freshness.

The `CONNECT_WORKER` service binding now targets `timothy-connect`; the
[September 15 release](https://github.com/timothystl/website/actions/runs/35017196124)
succeeded. Contact/prayer forwarding and Market volunteer integration depend on this target.
Website still hosts the payroll backend consumed by new Finance's authenticated relay.
Shared staff login and payroll ownership migration are not completed by that relay.

## Overhaul checkpoint — September 18, 2026

Published-block rendering cleanup and domain route extraction are complete. Payroll remains
here; a Finance relay does not transfer its backend. Shared staff login remains unfinished.
The latest reviewed production workflow succeeded at `7348eaa5d`, followed by its version commit.
Stax public mockup relocation #610 and Connect #1037 merged and deployed during this review;
the mockup is Website-owned while Connect retains its backend. This is not a live-provider cutover.
See the [current overhaul plan](https://github.com/timothystl/digital-architecture/blob/main/architecture/11-overhaul-readiness-and-execution-plan.md).
