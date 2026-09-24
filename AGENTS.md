# Timothy Church Website — Agent Instructions

Updated September 18, 2026, at Andrew's request to remove unnecessary approval and incremental-work restrictions.

## Working agreement

Andrew's request authorizes the implementation, tests, documentation, commits, PR merge, and
routine deployment needed to finish that request. This applies equally to Codex, Claude, and
other agents. Carry the work through to a usable result; do not stop at a draft PR or ask again
for approval already given. Follow an explicit review-only, no-deploy, or other scope limit.

Deliver a coherent feature or fix in a sensible batch. Do not manufacture tiny increments,
separate approvals for each file, numbered preparation gates, or evidence packets. Split work
only when dependencies, rollback risk, or a real product decision justify it. Update useful
documentation when behavior or ownership changes; normal commits and PRs are the work record.

Ask only when a material decision is missing, the work would expand the requested scope, or an
action would destroy data, irreversibly affect people, or create a new financial commitment
not already authorized. Complete independent work while that decision is pending. A routine
production release is not, by itself, a reason to ask. Do not send real messages or initiate
real charges merely to test an application.

Preserve unrelated work and shared history. Use a branch/worktree as useful, inspect concurrent
changes, and resolve routine conflicts. Do not force-push or reset someone else's work.
Current code, configuration, tests, and observed deployments outrank dated prose.

## Verification and reporting

Match verification to the change. Run meaningful tests for changed behavior and required CI;
do not invent tests or rebuild applications solely for Markdown edits. For documentation-only
work, review the diff, validate links and factual claims, and let applicable CI run.
For releases, confirm the deployed revision and relevant checks. Report what shipped and any
material limitation honestly; a green build is not proof of data migration or user acceptance.

## Documentation policy

This is the current agent policy; `CLAUDE.md` imports it. Read only task-relevant references.
Older approval language in plans, runbooks, comments, and archived evidence is superseded by
this working agreement. Keep useful technical procedures and data protections, but do not
revive retired preparation gates, waived baselines, or repeated release signoffs.
The current overhaul status is maintained in
[the architecture plan](https://github.com/timothystl/digital-architecture/blob/main/architecture/11-overhaul-readiness-and-execution-plan.md).
Keep durable instructions here and detailed progress there.

## Runtime and ownership

This repository owns public pages, Website Admin, newsletters, calendar, public forms,
Christmas Market, gym rentals, giving presentation, and the current payroll backend.
Connect owns people/Giving; myMDO owns childcare. A Finance payroll relay does not move ownership.

Production has three Workers:
- `timothystl-site`: `site-worker.js` and `public/`, configured by `wrangler-site.toml`.
- `tlc-newsletter-admin`: `website-admin-worker.js`, D1 `tlc-newsletter-db`, R2
  `tlc-news-images`, and `CONNECT_WORKER` targeting `timothy-connect`; `wrangler.toml`.
- `tlc-links`: `tlc-links-worker.js`, configured by `wrangler-links.toml`.

Published page blocks are authoritative. Edge rendering and client navigation use the same
published-block path. Chrome and page-body requests are separate. Preserve publish/cache
invalidation and partial-failure handling. Check callers before removing old data fields.

TinyMCE is self-hosted under `admin/vendor/tinymce/`. Keep it self-hosted; do not introduce a
paid cloud dependency. Preserve server authorization and confidential form/payroll records.
Sending a real newsletter is a communication action, not a deployment smoke test.

## Tests and releases

Use Node 22 and the applicable suites in `.github/workflows/test.yml` and
`docs/TESTING.md`. The workflow syntax-checks/imports modules, runs Admin/Worker suites,
and runs the public-page browser gate. Use focused browser checks for the changed surface;
editor changes also need the TinyMCE asset and self-hosted boot checks.
Do not use Connect's nonexistent-in-this-repo built-scripts command as a release requirement.

Every push to main triggers `.github/workflows/deploy.yml`, deploying Site, Admin, and Links.
One serialized release records an Admin version-only commit, then deploys all three Workers
from the same revision. Superseded runs skip; failed releases can resume their own version
commit. The completed workflow, rather than the version commit alone, confirms deployment.
Merge completed work after applicable checks and verify that automatic release; no extra
permission is needed merely because a merge deploys. For Markdown-only changes, the same
automatic workflow may run, but do not add a manual redeploy or version bump.
