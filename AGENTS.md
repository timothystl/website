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
- `tlc-newsletter-admin` from `tlc-admin-worker.js`, using D1
  `tlc-newsletter-db`, R2 `tlc-news-images`, and service binding
  `VOLUNTEER_WORKER`; and
- `tlc-links` from `tlc-links-worker.js`.

## Non-negotiable rules

- Current code, automated tests, deployed configuration, and observed live behavior outrank
  prose documentation.
- Never expose credentials or personal, giving, payroll, renter, vendor, or payment data.
- Do not change production, migrations, authentication, data ownership, DNS, Worker bindings,
  or payment behavior without Andrew's explicit approval for that operation.
- A push or merge to `main` automatically deploys all three production Workers. Treat merging
  as a production release. Work on a branch, require green PR checks, and obtain explicit
  release approval before merge.
- Preserve unrelated user work. Do not reset, rebase, or rewrite shared history casually.
- Search for callers, routes, tests, and live dependencies before deleting code or data paths.
- Documentation statements such as “done,” “safe,” or “deployed” are leads, not proof.

## Public-page architecture

- Published page blocks are authoritative. The Site Worker edge-renders the initial page body;
  client navigation uses the same published-block rendering path.
- `/api/pages?chrome=1` supplies global chrome without every page body.
  `/api/pages?id=<pageId>` supplies one client-fetched body when edge rendering did not.
- The website block-editor cleanup known as Phases A–D is complete for the verified published
  pages. Recheck live publishing state before relying on old page counts.
- Do not delete or repoint the remaining staff-facing `/ministries/edit/:slug` and
  `/ministries/editor/:slug` routes without a product decision. Their public read path is gone,
  but staff usage and possible content migration remain unresolved.
- Newsletter `ministry_content` and `ministry_type` may be write-only. Decide whether to render
  or retire them; do not silently remove them.
- Reverify the Contact page's published form and live behavior before removing any fallback.

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

- Target products are Church Website, Connect, Finance, and myMDO.
- Preparation 1 is closed by Andrew's acceptance of the remaining stabilization uncertainty.
- Preparation 2's seven-day baseline is waived and closed.
- The CHMS retained-backup packet and Preparations 4–5 are closed with explicit owner decisions;
  broader Website/myMDO recovery limitations remain recorded rather than called passed tests.
- Preparation 6 documentation reset is underway; current path dispositions are recorded in the
  private architecture repository. Finance extraction remains blocked until
  Preparation 6 is signed off and Preparation 7 gives the formal go/no-go.
- No repository rename, shared-auth rollout, payroll move, or Finance data extraction is
  authorized by this checkpoint.

## Documentation discipline

`CLAUDE.md` only imports this file. Other Markdown files are historical evidence, plans,
handoffs, manuals, security backlogs, or legal notices—not startup instructions and not
parallel sources of truth. Preserve third-party licenses. Put durable rules here, decisions
in a concise ADR when needed, tasks in the issue tracker, and implementation history in Git.
Keep this file below 200 lines and update the checkpoint when overhaul status materially changes.
