# Timothy Digital Overhaul — Start Here

> **Canonical entry point for review.** Read this file before reviewing or continuing the
> website overhaul. It tells a new Claude or Codex session where the authoritative detail
> lives, what is complete, what remains open, and which older material is stale.
>
> **Last reconciled:** 2026-09-07  
> **Repository:** `timothystl/website`  
> **Development branch:** `main`

## Scope

This document covers the website's block-editor and public-page rendering overhaul recorded
as Phases A–D on 2026-09-07. It does not replace the broader project history in
`CLAUDE.md`, and it does not describe the separate `chms`, `childcare-portal`, or
`other` repositories. Those repositories have their own project instructions.

The goal of Phases A–D was to finish the transition from duplicated hardcoded page bodies
and competing client-side takeover paths to one authoritative published-block rendering
path.

## Source-of-truth order

When sources disagree, use this order:

1. **Current code, tests, database state, and live behavior** — verify rather than assume.
2. **This file** — current review entry point and status map.
3. **The four dated Phase A–D sections in `CLAUDE.md`** — detailed implementation record,
   reasoning, files, tests, and non-vacuous verification.
4. **The warning and Phase A–D index at the top of
   `admin/BLOCK-EDITOR-ROLLOUT.md`**.
5. **The remainder of `admin/BLOCK-EDITOR-ROLLOUT.md`** — historical planning detail only.
   Its old page counts and publishing status are known to be stale.

Documentation claims such as "verified," "fixed," "published," or "safe" are leads for a
review, not proof. Recheck them against the current code and live state when the review
depends on them.

## Current status

| Phase | Status | Result |
|---|---|---|
| A | **Complete — 2026-09-07** | An edge-rendered page body is authoritative immediately and no longer waits on `/api/pages`. |
| B | **Complete — 2026-09-07** | Global chrome loading and single-page body loading are separated with lean views of one cached bundle. |
| C | **Complete for pages confirmed published — 2026-09-07** | Obsolete hardcoded fallback bodies were deleted after production publishing state was checked. |
| D | **Complete — 2026-09-07** | The dead public ministry/news takeover chains were removed, leaving one page-rendering path. |

During Phase D, the live `/api/pages` check showed all 29 rows in the `pages` table with
real, non-empty `published_blocks`, including confirmation, Sunday school, VBS, egg hunt,
and family. That was true when Phase D was performed. **Recheck the live API before relying
on the count in a later review.**

## Required reading

Read these sections of `CLAUDE.md` in full, in this order:

1. **"An edge-rendered page's own body no longer waits on `/api/pages` to work
   (2026-09-07)"** — Phase A.
2. **"`loadSitePages()` stopped hauling down every page's body to get the chrome
   (Phase B, 2026-09-07)"** — Phase B.
3. **"The hardcoded fallback bodies are gone for every page confirmed published
   (Phase C, 2026-09-07)"** — Phase C.
4. **"The takeover mechanism is simplified — the old ministry-page chain is deleted
   (Phase D, 2026-09-07)"** — Phase D.

Then read the warning and phase index at the top of
`admin/BLOCK-EDITOR-ROLLOUT.md`. Do not use that file's older unpublished-page count or
status tables without checking `/api/pages` first.

## What each phase changed

### Phase A — trust the edge-rendered body

When `site-worker.js` has already injected published blocks and marked a page
`data-tlcb-edge="1"`, `tlcMaybeTakeOverSitePage()` now accepts that body immediately.
Calendar mounting and feed hydration use the live DOM and do not depend on a second
`/api/pages` request succeeding.

The chrome request still runs because navigation, footer, redirects, appearance, and block
CSS still depend on global site data.

### Phase B — separate chrome from body data

The existing `/api/pages` route gained two lean views over the same cached bundle:

- `?chrome=1` returns global site data without all rendered page bodies.
- `?id=<pageId>` returns only the requested page's rendered body.

`loadSitePages()` uses the chrome view. `loadPageBody(id)` is the remaining client-side
body fetch for a page the edge did not render. The ordinary unparameterized route remains
available for existing callers, including the Site Worker.

### Phase C — remove obsolete hardcoded bodies

Hardcoded bodies were removed only after each page's production publishing state was
checked. The accepted tradeoff is deliberate: a published page may be blank during a real
admin/content outage instead of displaying stale hardcoded content.

Some markup remains because it is an active mount point rather than fallback content,
including notices and certain sermon, music, and Christmas Market dynamic sections.
`404` and `privacy` have no `pages` row and remain hardcoded.

Phase C recorded that `/contact` temporarily kept its hardcoded form while corrected
published content and caches were verified. A later review must inspect the current
`public/index.html` and live page before deciding whether that exception still exists or
is still necessary.

### Phase D — remove dead public takeover chains

`showPage()` now dispatches through `tlcMaybeTakeOverSitePage(id)` as the one public
page-body rendering path. The retired public paths included:

- `tlcMaybeTakeOver()`
- `tlcApplyBlocks()`
- `tlcOwnsWholePage()`
- `loadMinistryPage()`
- `loadYouthPage()`
- `loadMinistryCta()`
- `loadLegacyNewsPage()`
- `loadNewsItems()`
- `loadNewsletters()`

Do not infer that every similarly named helper is dead. Phase D deliberately retained live
feed hydration, newsletter-detail overlays, Christmas Market posts, and the
`tlcMaybeTakeOverSitePage` / `tlcTakeOverPage` / `loadPageBody` /
`loadSitePages` path.

## Open items — do not silently clean these up

### 1. A second staff-facing ministry content system still exists

The public read side of the old `youth_pages` system was retired, but its admin write side
remains reachable:

- `/ministries/edit/:slug` renders TinyMCE and writes `youth_pages.content`.
- `/ministries/editor/:slug` is a second block-editor mount writing
  `youth_pages.blocks` and `youth_pages.published_blocks`.

Nothing on the public site now reads those fields into the displayed page. These screens may
still be used by staff, so retiring, redirecting, migrating, or repointing them requires an
explicit product decision and Andrew's approval.

A review should determine:

- whether staff still use either route;
- whether any current values must be migrated into the `pages` table;
- whether both routes should redirect to `/pages/:id/edit`;
- what permissions, revisions, links, and tests would be affected.

Do not delete these routes merely because the public read path is dead.

### 2. Newsletter `ministry_content` / `ministry_type` may be write-only

Phase D found that the newsletter composer still stores these fields, while neither the sent
email nor the current newsletter-archive block renders them. The last known public rendering
was in the legacy news loader already made unreachable by Phase C and removed in Phase D.

Whether to restore this content somewhere or retire the fields is a product decision, not
automatic dead-code cleanup.

### 3. Reverify the Contact exception

Phase C deliberately retained the hardcoded `/contact` body while corrected published
content and caches were being confirmed. Check the present code, live API response, and live
form behavior before classifying or removing anything.

## Primary implementation surfaces

Start with these files when checking Phase A–D claims:

- `public/index.html` — SPA routing, page divs, client takeover, loaders, and mount points.
- `site-worker.js` — edge rendering and published-page injection.
- `tlc-admin-worker.js` — `/api/pages`, cache behavior, and admin routes.
- `admin/blocks.js` — block rendering and public block behavior.
- `admin/site-pages.js` — page definitions and seed content.
- `admin/page-seeds.js` — ministry page seeds.
- `admin/ministry-editor.html` — shared editor surface and legacy ministry mount.
- `admin/BLOCK-EDITOR-ROLLOUT.md` — historical rollout detail with a current warning.

Relevant tests named in the phase records include:

- `test/site-edge-render.test.mjs`
- `test/site-pages.test.mjs`
- `test/whole-page.test.mjs`
- `test/public-page.test.mjs`
- `test/public-calendar.test.mjs`
- `test/public-phone.test.mjs`
- `test/site-404.test.mjs`
- `admin/admin-redesign.test.mjs`
- `admin/escaping.test.mjs`

Use the commands and environment notes recorded in each dated `CLAUDE.md` section. Some
Playwright suites have documented environment instability; distinguish an infrastructure
crash from a product failure with focused reruns and code-path inspection.

## Review protocol for Claude or Codex

Before reviewing or changing overhaul work:

1. Confirm the repository, branch, working tree, and recent commits.
2. Read this file and the four required `CLAUDE.md` sections.
3. Read the warning at the top of `admin/BLOCK-EDITOR-ROLLOUT.md`.
4. Turn each Phase A–D claim into a concrete checklist tied to code and tests.
5. Recheck production-dependent claims, especially published-page status.
6. Verify that tests are non-vacuous: confirm they exercise the intended path and would fail
   if the behavior regressed.
7. Search for remaining callers before classifying a function, route, field, or mount point as
   dead.
8. Separate findings into:
   - confirmed regression;
   - documentation drift;
   - open product decision;
   - historical note that is now stale;
   - verified current behavior.
9. Do not modify or delete staff-facing content paths without explicit authorization.
10. Report evidence by file, symbol or route, test, and observed behavior.

## Copy-and-paste review prompt

> Work from the root of `timothystl/website`. Read `DIGITAL-OVERHAUL.md` first and
> follow its source-of-truth order and review protocol. Then read the four Phase A–D sections
> it names in `CLAUDE.md` and the warning at the top of
> `admin/BLOCK-EDITOR-ROLLOUT.md`. Build a verification checklist before reviewing.
> Treat documentation claims as unproven until checked against current code, tests, and live
> state. Preserve the unresolved staff-facing ministry editors and newsletter-field question
> as product decisions unless I explicitly authorize a change. Report discrepancies with
> concrete evidence; do not begin unrelated cleanup.
