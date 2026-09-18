# Timothy Church Website — Agent Instructions

This is the only AI startup instruction file for this repository. Claude reads it through
`CLAUDE.md`; Codex reads it directly. Do not preload or survey other Markdown files. Open a
reference document only when the current task specifically requires it, and treat dated
status claims as historical until verified against code, tests, GitHub, and live behavior.

## Product boundary

This repository owns the public church website and Website Admin: pages, navigation,
newsletters, calendar, public forms, Christmas Market, gym rentals, public giving links,
and the existing payroll surface. It does not own Connect people/giving records or myMDO.
Payroll remains here until a separately approved Finance migration is built and reconciled.

Production is three Cloudflare Workers:

- `timothystl-site` from `site-worker.js` and `public/`;
- `tlc-newsletter-admin` from `website-admin-worker.js`, using D1
  `tlc-newsletter-db`, R2 `tlc-news-images`, and service binding
  `CONNECT_WORKER`; and
- `tlc-links` from `tlc-links-worker.js`.

## Non-negotiable rules

- Current code, automated tests, deployed configuration, and observed live behavior outrank
  prose documentation.
- Preserve unrelated user work. Do not reset, rebase, or rewrite shared history casually.
- Search for callers, routes, tests, and live dependencies before deleting code or data paths.

Automatic merging of Claude's branches and pull requests is back on once npm test and the built-scripts check pass. Merging to main never deploys by itself — deployment stays the separate, manual, explicitly-approved step below.
Claude Code may dispatch production deployments through .github/workflows/deploy.yml without asking first, supplying the exact approved main commit SHA being released and a real release reason for the audit trail.
Preserve unrelated concurrent work. Do not reset, rebase, force-push, or overwrite shared history. Use a branch or disposable worktree.
Use Node 22. Run npm test and node .github/scripts/check-built-scripts.js before merge. Add focused tests for the changed path and verify regression tests are non-vacuous.
Current code and live evidence outrank documentation. Search callers and tests before removing routes, schema, configuration keys, or compatibility paths.

## Public-page architecture

- Published page blocks are authoritative. The Site Worker edge-renders the initial page body;
  client navigation uses the same published-block rendering path.
- `/api/pages?chrome=1` supplies global chrome without every page body.
  `/api/pages?id=<pageId>` supplies one client-fetched body when edge rendering did not.
- The website block-editor cleanup known as Phases A–D is complete for the verified published
  pages. Recheck live publishing state before relying on old page counts.
- Newsletter `ministry_content` and `ministry_type` may be write-only. Decide whether to render
  or retire them; do not silently remove them.

## Editor rule

TinyMCE is self-hosted from the vendored files under `admin/vendor/tinymce/`. The cloud
subscription has lapsed. Do not add a TinyMCE Cloud API key, cloud script, paid editor load,
or CDN dependency. After editor or vendor-asset changes, run the TinyMCE asset tests and the
self-hosted browser boot test.

## Validation

Use Node 22. Before proposing a merge, mirror the applicable GitHub checks:

```bash
for f in admin/*.js; do node --check "$f"; done
for f in admin/*.test.mjs; do node "$f"; done
node --experimental-loader ./test/html-loader.mjs test/admin-redesign.test.mjs
node test/site-taps.test.mjs
node test/site-edge-render.test.mjs
node test/site-404.test.mjs
node test/site-admin-timeout.test.mjs
node test/links-page.test.mjs
node test/give-page.test.mjs
```

Run the focused Playwright suite for the surface changed. `test/public-page.test.mjs` is the
required browser gate for edge/client page ownership. Use `test/tinymce-selfhost.test.mjs`
after TinyMCE changes. A test claim must be non-vacuous: confirm it exercises the intended
path and would fail on the regression.

## Timothy Digital overhaul checkpoint

Andrew retired the old preparation-gate/implementation-phase ceremony on September 9, 2026. The
current plan is a plain task list in the private `digital-architecture` repository's
`architecture/11-overhaul-readiness-and-execution-plan.md` — read it before starting overhaul work
here. In short: Finance becomes its own application (out of `chms`); shared staff login across
Website/Connect/Finance/myMDO; code normalized and legacy-named resources renamed to match current
scope; real developer documentation; and better observability. None of these are gated behind each
other. Website D1 and R2 recovery tooling exists; both workflows succeeded September 11, 2026.
See docs/OPERATIONS.md for evidence. A restore drill does not itself prove retained backup custody.
The CONNECT_WORKER service target is now timothy-connect; its September 15 deployment succeeded.

## Documentation discipline

`CLAUDE.md` only imports this file. Other Markdown files are historical evidence, plans,
handoffs, manuals, security backlogs, or legal notices—not startup instructions and not
parallel sources of truth. Preserve third-party licenses. Put durable rules here, decisions
in a concise ADR when needed, tasks in the issue tracker, and implementation history in Git.
Keep this file below 200 lines and update the checkpoint when overhaul status materially changes.
