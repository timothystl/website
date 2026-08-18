# Handoff — Christmas Market as an event: split vendor page, site-wide jump bar, five-tab admin

**Repo:** `timothystl/website` (branch `main`)
**Design reference:** `Christmas Market — Event Section.dc.html` in this bundle — options **1b** (public) and **1c** (admin) are the approved ones. 1a and 1d are context only; 1d's Events section is **out of scope here** and comes next.

The mock is a Design Component prototype: its markup and inline values are the source of truth for layout and copy, **not** its runtime. Implement with the repo's existing `var(--*)` tokens and classes from `public/styles.css` — never the literal hex written in the mock.

---

## 0. Non-negotiables

Read these before writing anything.

1. **Public addresses do not change.** `/christmasmarket` and `/christmasmarket/vendors` are published and printed. The split adds exactly one new address: `/christmasmarket/vendors/apply`.
2. **The price math is `market-price.js` and nothing else.** Do not re-derive it, do not round differently, do not copy the arithmetic into a block or a page. `priceBreakdown()` returns integer cents; 1/2/3 tables are **$31.20 / $62.10 / $93.00**. The `$92.99` in `design_handoff_market_vendor_signup/README.md` is wrong and that file's own successor comment in `market-price.js` explains why — truncating leaves the church a penny short of the $90 the gross-up exists to protect.
3. **No payment address in the browser, ever.** The amount and the pay URL stay resolved server-side at submit, per `marketPayUrl()`. The split page must not change this.
4. **Permissions stay exactly as they are.** `market_manage` for the vendor list, the applications toggle and the CSV; `settings_manage` for the seven `market_*` figures; `giving_manage` for the fund, the provider and the Square links. Three permissions can reach the screen, each panel checks its own — that reasoning is already written above the gate in `admin/market.js` and must survive the tab refactor.
5. **No new copy in code.** Every sentence that ends up on a public page belongs in a block record. If you find yourself typing prose into `public/index.html`, stop.

---

## 1. Phase 1 — publish the vendor page's blocks (do this first, alone)

This is the fix for "I can't edit the language." `admin/market-page-seed.js` already contains the whole page as blocks, but it seeds the **draft only**: `published_blocks` is empty, so `/christmasmarket/vendors` still renders the hardcoded markup in `public/index.html`.

1. Diff the seeded draft against the live page and reconcile the copy so the published result is **visually identical to today** apart from what Phase 2 and 3 add. The current hardcoded copy is the authority where the two differ (it carries Andrew's own wording for the nine clauses; the seed reads those from `BLOCK_DEFS.marketapp.defaultItems`, which is correct — leave that indirection intact).
2. Publish. Then **delete** the hardcoded `#page-marketvendors` markup from `public/index.html`, along with the `data-mkt-*` fallback spans it carried. Keep `tlcMarketInit()` and the `.mkt-*` CSS — the `marketapp` block renderer needs both.
3. Keep the `mkt-closed` state behaviour: switched off, the page still explains the market and still shows the coordinator's address, and takes no money.

**Acceptance:** editing the hero headline in the Pages editor changes the live page, and no market prose remains in `public/index.html`.

---

## 2. Phase 2 — the split vendor page (option 1b)

Two pages, both block-rendered.

### Page A — `/christmasmarket/vendors` (page id `marketvendors`, unchanged)

Same blocks as Phase 1, minus the application block, plus:

- **Hero** — copy per the mock: primary button becomes **"Start the application →"** pointing at `/christmasmarket/vendors/apply`; secondary stays an in-page anchor.
- **Jump links** block (Phase 3) directly under the hero.
- A closing **CTA block** on `--steel`: "Ready? The application takes about five minutes." → the apply page.
- The application block is **removed from this page**, not hidden.

### Page B — `/christmasmarket/vendors/apply` (new page id `marketvendorsapply`)

Blocks, in order:

1. **Banner** — `--sage` background, eyebrow "Vendor application" in `--honey`, serif 24px "Timothy Christmas Market", and a ghost "← Rules & details" link back to page A.
2. **Facts band** — `--white` bg, `1px solid var(--border)` bottom, four label/value pairs: market day, hours, table fee + max, coordinator email. **Every value is read live** from `marketConfigFromRows()` — none of it typed into the block. Label style: 10px/700/`.1em` uppercase `--text-muted`; value 15px/800 `--steel` (coordinator email in `--mid`).
3. **`marketapp`** — the existing three-step block, unchanged.

Wiring, all three of which must agree or the edge-render injection looks for blocks at the wrong path:

- `NESTED_PATHS` in `public/index.html` → `marketvendorsapply: '/christmasmarket/vendors/apply'`
- `pathForPageId()` in `site-worker.js` (the mirror of `tlcPathFor()`)
- `parent_id: 'marketvendors'`, `in_menu: 0`, `template: 'standard'`, its own `seo_description`

Also: `301` nothing, but do add `/christmasmarket/vendors/apply` to `public/sitemap.xml`, and leave `robots.txt` alone.

**Router note:** `showPage()` currently calls `tlcMarketInit()` for `marketvendors`. That call moves to `marketvendorsapply`. Keep the "declared before the router runs" ordering comment — the symptom of getting it wrong is table buttons that never appear.

**Acceptance:** a first-time visitor can read everything on page A without meeting a form; the apply page holds no prose that isn't a live setting; both pages quote the same date, hours and fee, and changing the setting changes both.

---

## 3. Phase 3 — the jump bar, as a block available to **every** page

This is a general site capability, not a market feature. Build it once as a block type.

### Block definition — `BLOCK_DEFS.jumplinks` in `admin/blocks.js`

| Field | Editor | Default | Notes |
| --- | --- | --- | --- |
| `label` | text | `Jump to` | The micro-label at the left. Blank hides it. |
| `mode` | enum `auto` \| `manual` | `auto` | `auto` derives links from the page's own sections; `manual` uses `items`. |
| `items` | list of `{ title, url }` | `[]` | Only read in `manual` mode. A `url` of `#block-id` targets a section on the page; an absolute URL is allowed (that is how the market links out to the volunteer sign-up). |
| `sticky` | boolean | `true` | Sticks to the top of the viewport as the reader scrolls past it. |
| `cta` | `{ title, url }` | empty | Optional right-aligned filled button — "Apply for a table". Omitted when blank. |
| `include` | multi-select of the page's blocks | all eyebrow/heading blocks | `auto` mode only: which sections appear. |

`autoNote` for the editor: *"The links are built from the sections on this page. Add, remove or reorder a section and this bar follows — there is nothing here to keep in step by hand."*

### Anchor ids — the part that makes `auto` possible

Every block already has a stable `id`. The renderer must emit it as the section's DOM id (`id="mv-rules"`), which most block renderers do not do today. Add it **for all block types**, not just the ones the market uses — that is what makes this block work on any page. Where a block has an explicit `anchor` field, that wins over the id.

Link text in `auto` mode is the block's `title`, falling back to its `eyebrow`. A block with neither is skipped.

### Rendering

Server-rendered markup, no client-side derivation (the bar must be in the HTML the crawler and the no-JS reader get). One new class block in `public/styles.css`, scoped `.jump-*`, using existing tokens only:

```
.jump-bar        background: var(--white); border-top: 3px solid var(--amber);
                 border-bottom: 1px solid var(--border); box-shadow: var(--shadow);
.jump-bar--stuck position: sticky; top: 0; z-index: 5;   /* below .nav */
.jump-inner      max-width:1080px; margin:0 auto; padding:12px 28px;
                 display:flex; align-items:center; gap:10px; flex-wrap:wrap;
.jump-label      font:700 10px/1 var(--font-ui); letter-spacing:.12em;
                 text-transform:uppercase; color: var(--text-muted);
.jump-link       font:700 12.5px var(--font-ui); color: var(--steel);
                 background:#fff; border:1px solid var(--border);
                 border-radius:999px; padding:9px 16px; min-height:44px;
.jump-cta        margin-left:auto; background: var(--amber);
                 border-color: var(--amber); font-weight:800;
```

Details that are easy to get wrong:

- **`scroll-margin-top`** on every anchorable section, equal to the sticky nav height plus the bar's own height, or every jump lands with the heading hidden under the chrome. Do not use `scrollIntoView` in JS — this is CSS.
- **`aria-current`** on the link whose section is in view is optional; if you add it, drive it from `IntersectionObserver` and degrade to nothing without JS.
- **Mobile (620px):** the row scrolls horizontally rather than wrapping to three lines — `overflow-x:auto; flex-wrap:nowrap;` with `-webkit-overflow-scrolling:touch`, and the CTA stays pinned outside the scroller. Every chip keeps its 44px minimum.
- **Print:** `display:none`.
- **Sticky + the site nav:** `.nav` is already sticky. Test them together at 900px and 620px; if they fight, the bar sits below the nav, never over it.
- **One per page.** If two `jumplinks` blocks exist, render the first and warn in the editor.

### Where to put it (this release)

- `/christmasmarket/vendors` (page A) — auto mode, CTA "Apply for a table" → the apply page
- `/christmasmarket` — auto mode, CTA "Apply for a table" → `/christmasmarket/vendors`; one manual item linking `serve.timothystl.org/christmasmarket`

Available in the palette for every other page from day one; do not add it to any other page's records in this release.

---

## 4. Phase 4 — the admin event screen (option 1c)

`/market` becomes one screen with five tabs. **This is a re-arrangement, not a rewrite** — the vendor list, its drawer, the four payment states, the CSV export, the applications toggle, the seven settings, the fund and the Square links are all working code and should move intact.

### Tabs

Tab state in the query string (`/market?tab=copy`) so a link into a tab works and a save can return to the tab it was made on. Server-rendered per tab — do not ship all five panels and hide four.

| Tab | Contains | Permission |
| --- | --- | --- |
| **Vendors** (default) | the four count tiles, the applications toggle, the list, the drawer, CSV | `market_manage` |
| **Page & copy** | the two page cards (`/christmasmarket`, `/christmasmarket/vendors`) with Edit / View, the unpublished-edits banner with **Compare & publish**, and the drag-to-reorder section list for the vendor page | `pages_edit` |
| **Money & dates** | the seven `market_*` fields (left panel) and the fund / provider / Square links (right panel) | fields `settings_manage`; payment `giving_manage` |
| **Volunteers** | read-only counts **and roster** pulled from ChMS, + link out to `serve.timothystl.org/christmasmarket` | `market_manage` |
| **Photos** | the event's photo folder, drop targets, offered to both pages' gallery blocks | `ministries_edit` or `pages_edit` |

A tab the reader cannot see is **not rendered as a disabled tab** — it is absent, and the bare-header case in `admin/market.js` already handles a reader with no `market_manage`. Keep that.

### Notes per tab

- **Page & copy** — the section list is `panelList()` with its existing reorder POST; reordering writes the blocks' `sort`. "Compare & publish" reuses the Pages editor's own publish path; do not build a second one. The row for the application block carries the amber note that fee, dates, open/closed and the nine clauses live there.
- **Money & dates** — same forms and routes as today (`/market/settings`, `/market/fund`, `/market/payment`), just rendered under a tab. Keep the live "a vendor will be asked $31.20 / $93" line, computed with `priceBreakdown()`. Keep the stale-bookmark behaviour from `/settings?edit=market_table_fee`.
- **Volunteers** — the source is `timothystl/chms` (the `tlc-chms` worker, which also serves `serve.timothystl.org`); signups live in its D1 and its API is `src/api-admin.js`. Follow the existing precedent for cross-app reads — the website admin already queries ChMS for member data for newsletter sync — rather than inventing a new transport, and **never** scrape or iframe the public volunteer page.

  Add one read endpoint on the ChMS side, scoped to a signup slug: `GET /api/signups/christmasmarket/summary` →

  ```
  {
    open: true,
    signedUp: 34,
    openShifts: 9,
    roles: [
      { name: 'Parking', shifts: [
        { label: '8:30–11:00 am', needed: 4, filled: 2,
          people: [{ name: 'Ray Stoltz', email: 'ray@…' }, …] },
        { label: '11:00 am–2:30 pm', needed: 4, filled: 4, people: […] }
      ]},
      …
    ]
  }
  ```

  **The tab must answer "who is signed up for what role, on which shift" without leaving the screen.** Render it as a role-by-role breakdown, not a flat list of names:

  - Four count tiles across the top: signed up, shifts still open, roles, sign-up page open/closed.
  - Then one `panel()` per **role** (Setup, Parking, Church booth, Bake table, Teardown, Greeters), its header carrying the role name and a filled/needed count.
  - Inside each role, one row per **shift**: the shift label, a `filled / needed` figure, a `statusPill()` — `good` when full, `warn` when short — and the names of the people on it (each name a `mailto:` link). A shift with nobody on it says so in the empty state rather than rendering an empty row.
  - Sort roles by most-short-handed first, so what needs attention is at the top; shifts within a role stay in time order.
  - One "Manage shifts in Serve ↗" button per role header, deep-linked to that role where the Serve URL allows it.

  Everything on this tab is **read-only**.

  Scope guards: this is a read, so it needs no write auth on the ChMS side, but it does return names and emails — gate the panel on `market_manage` like the vendor list, and do not include phone numbers or addresses. If the endpoint is not ready when the rest of this lands, ship the tab with the link-out and a "counts coming" state rather than blocking the release.**Write-back (assigning or cancelling a shift from the website admin) is out of scope — see §8. Single sign-on is not wanted at all; the two systems keep their own logins.** The point of this tab is that the volunteer data shows up here, on the event's own screen, so nobody has to go looking for it.
- **Photos** — uploads land in Media under `images/events/christmasmarket/`. The tab lists that folder and offers each image to the gallery blocks on both pages. No new storage.

### Sidebar

Rename the sidebar group that currently holds Christmas Market from **Money & Building** to **Events**, and move Gym Rentals into it; Giving and Payroll stay in Money & Building. `GROUPS` in `admin/helpers.js` gets an `events` key. The unpaid-application badge stays on the Christmas Market row.

---

## 5. Files this touches

| File | Why |
| --- | --- |
| `admin/market-page-seed.js` | reconcile + publish; drop the application block from page A |
| `admin/market-vendors-apply-seed.js` *(new)* | page B's blocks |
| `admin/blocks.js` | `BLOCK_DEFS.jumplinks` + renderer; emit block `id` as a DOM id for **all** block types; banner/facts-band blocks for page B |
| `admin/market.js` | tabs, `?tab=`, per-tab permission gating; routes unchanged |
| `admin/helpers.js` | `GROUPS.events`, sidebar move |
| `admin/pages.js` / `admin/site-pages.js` | register page B; the section-reorder + publish paths the Page & copy tab reuses |
| `public/index.html` | delete `#page-marketvendors` markup; `NESTED_PATHS`; move the `tlcMarketInit()` router call |
| `site-worker.js` | `pathForPageId()` for page B |
| `public/styles.css` | `.jump-*`, `scroll-margin-top` on anchorable sections |
| `public/sitemap.xml` | page B |
| `market-price.js` | **not touched** |

## 6. Tests

- `admin/blocks.test.mjs` — `jumplinks` in both modes: auto derives from sections, manual honours `items`, absolute URLs allowed, a block with no title/eyebrow is skipped, two blocks warn, empty `cta` renders no button.
- `admin/market.test.mjs` — unchanged price assertions must still pass; add: page B's facts band renders from settings and contains no typed figures.
- Permission tests: `settings_manage`-only and `giving_manage`-only readers see their panel and **no** vendor rows; `market_manage`-only sees no payment panel.
- `test/public-phone.test.mjs` — jump chips are ≥44px at 390px and the bar scrolls rather than wrapping.

## 7. Acceptance checklist

- [ ] Every word on both market pages is editable in the Pages editor; none is in `public/index.html`.
- [ ] Sections on the vendor page can be added, removed and reordered, and the jump bar follows without a second edit.
- [ ] `/christmasmarket` and `/christmasmarket/vendors` still resolve; `/christmasmarket/vendors/apply` is new and reachable from page A.
- [ ] Date, hours, fee, max tables and coordinator appear on both pages from one setting each.
- [ ] 1/2/3 tables quote $31.20 / $62.10 / $93.00 on the page, in the admin, and in the vendor email.
- [ ] A jump-bar link lands with the section heading clear of the sticky nav.
- [ ] The five admin tabs each render their panel, deep-link via `?tab=`, and return to their own tab after a save.
- [ ] The Volunteers tab shows, per role and per shift, how many are needed, how many are filled, and the name of every person signed up — without leaving the screen.
- [ ] A coordinator with only `market_manage` sees the vendor list and no financial account details.

## 8. Out of scope (next handoff)

The generalized **Events** section — one event record (name, slug, dates, open/closed, optional fee, coordinator, volunteer link, photo folder) with the market as instance one, and "New event" for VBS, the Egg Hunt and concerts. Phase 4's tab shape is deliberately the template for it; do not generalize early.

Also deferred, deliberately: **volunteer write-back** — assigning, moving or cancelling a shift from the website admin. Two systems writing the same shifts needs a conflict story first. Reading the data in (§4) is in scope; managing it from here is not.

**Not wanted, do not build:** single sign-on across the website admin and ChMS. Andrew's call — the two systems keep their own logins. What he wants is the volunteer *data* feeding into the event screen, which §4 covers.
