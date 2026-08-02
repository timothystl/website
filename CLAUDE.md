# Timothy Lutheran Church Website — Project Context

This file captures the full project context so any Claude session can be resumed immediately.

---

## Project Overview

The Timothy Lutheran Church website (timothystl.org) is live on Cloudflare Workers. DNS cutover is complete as of April 2026. The site replaced the previous Tithely/Breeze-hosted site.

**Repo:** `timothystl/website`
**Primary branch for development:** `main` (deploys to timothystl.org, admin.timothystl.org, and all subdomain workers)

> **Note:** Admin portal changes (`tlc-admin-worker.js`) should be committed and pushed to `main` — the test site does not run the admin worker. Always target `main` for admin work.
>
> **PR workflow:** When working in a cloud session (feature branch required by session config), create the PR using the GitHub MCP tool and immediately merge it — do not leave it as a draft for the user to merge. Always paste the PR URL in the chat so it's visible.

---

## Architecture

### Live Workers (Production)
| Worker | Domain | File |
|--------|--------|------|
| timothystl-site | timothystl.org | `public/index.html` (SPA) |
| tlc-newsletter-admin | admin.timothystl.org | `tlc-admin-worker.js` |
| tlc-links | links.timothystl.org | `tlc-links-worker.js` |
| tlc-chms | serve.timothystl.org **and** chms.timothystl.org | `tlc-volunteer-worker.js` (separate repo, not in this one) |

Note: this same CHMS worker answers on multiple hostnames. `serve.timothystl.org`
(renamed 2026-07-20 from `volunteer.timothystl.org` as a full cutover — the old
hostname's Cloudflare route was renamed in place rather than kept as a second
route, so `volunteer.timothystl.org` no longer resolves at all; both this
repo's own links and its server-to-server API calls were updated to the new
hostname in the same pass) is used for the public `/volunteer` redirect and
for API calls this repo makes to it (`/api/intake/connect-card`,
`/api/intake/prayer` from the contact/prayer forms). `chms.timothystl.org` is
the admin app hostname — the admin sidebar's external link (labeled "Timothy
ChMS", changed 2026-07-20 from separate "Scheduler"/"Volunteer Admin" links)
points staff there.

### Databases (Cloudflare D1)
- `tlc-newsletter-db` — tables: `newsletters`, `events`, `news_items`, `youth_pages`, `ministry_posts`, `sermon_series`, `sermon_notes`, `notices`, `staff_members`, `bible_classes`, `link_cards`, `gym_*`, `users`, `sessions`, `audit_log`, `redirects` (`category`='giving' rows are vendor/market payment links, managed under the Giving tab), `give_amount_tiers` (admin-editable amount chips + per-tier Tithe.ly links for give.timothystl.org), and more — see the `DB_INIT_*` constants in `admin/db.js` for the full current schema
- `tlc-volunteer-db` — tables: `serve_events`, `serve_roles`, `signups`, `signup_slots`
- `RSVP_STORE` — Cloudflare KV namespace

### External data stores outside D1/KV
- **Supabase** (project ref `dahdstopsumxnqvdclmy`) — backs the MDO preschool's separate staff time-clock app and the admin Payroll tab's own `church_staff` tables. See "Payroll & Supabase" under Admin Portal Plan below. Not used for anything else on the site.

### Auth
- Admin password: stored in Cloudflare Worker secret — do not commit here

---

## Tech Stack

- **Frontend:** Vanilla JS + HTML/CSS, single-page SPA (`public/index.html`)
- **Backend:** Cloudflare Workers + D1 (SQLite) + KV
- **CI/CD:** GitHub Actions (`.github/workflows/deploy.yml`)
- **Newsletter:** Brevo email sending + website archive (Beehiiv removed)
- **Calendar:** Google Calendar RSS embed at `/calendar`
- **Giving:** Tithely (`give.tithe.ly`) — displayed on site and in emails. Breeze is still used internally for people management and automated giving (some members have recurring giving set up via their bank to Breeze). Tithely and Breeze are the same company so this coexistence is not an issue. Do not prompt to "cancel Breeze."
- **Volunteer signups:** Separate worker, branded "Serve" at serve.timothystl.org (already complete; renamed 2026-07-20 from volunteer.timothystl.org)

---

## Current Site Pages (SPA page IDs in `public/index.html`)

| Page ID | URL/Nav | Status |
|---------|---------|--------|
| page-home | / | Exists |
| page-about | /about | Exists, content updated |
| page-worship | /worship | Exists |
| page-sermons | /sermons | Exists |
| page-ministries | /ministries | Exists |
| page-wol | /wol | Exists (partner landing page → wordoflifeschool.net) |
| page-events | /events | Exists |
| page-contact | /contact | Exists |
| page-prayer | /prayer | Exists |
| page-news | /news | Exists — fetches live from admin API + newsletter archive, with the Google Calendar embedded below the posts (2026-08-01) |
| page-values | /about/values | Exists (2026-08-01) — the four core values and the partner ministry paired to each, from `/api/values`. Nested under About via `NESTED_PATHS` in `public/index.html` |
| page-404 | (any unknown path) | Exists — shown for unrecognized URLs |

---

## Full Planned URL Structure

### Static Pages (developer changes only)
```
/               Home — service times above fold, "New Here?", quick links
/about          Staff with photos, values, vision, mission, beliefs
/worship        Services, livestream, what to expect
/sermons        YouTube embeds
/ministries     All ministry cards hub
/contact        Address → Maps, phone → call, email, map
/prayer         Prayer request form
/give           → redirect to Tithely giving (give.tithe.ly)
/news           News & events feed (brief cards, auto-expire)
/calendar       Google Calendar embed
```

### Ministry Landing Pages (flyer-friendly short URLs, static)
```
/christmasmarket  Admin-managed: dates, photos, Google Form link for vendors
/foodpantry       Food Pantry info, hours, how to donate/volunteer
/music            Music Ministry
/stephen          Stephen Ministry
/bees             Urban Beekeepers
/wol              Brief landing page → wordoflifeschool.net
/mdo              → redirect to mdo.timothystl.org
```

### Youth Director Manages (dynamic, via admin portal)
```
/youth            Youth & Family main
/sundayschool     Sunday School communications to parents
/confirmation     Confirmation program
/vbs              VBS
/egghunt          Egg Hunt
/family           Family Ministry
```

### Utility Redirects (in Cloudflare Worker routing table)
```
/volunteer      → not currently a live redirect — see note below
/councilfiles   → Google Drive folder
/zoom           → Zoom meeting URL
/voters         → Special page: Zoom link + downloadable reports (admin-managed)
/give           → Tithely giving URL
/mdo            → mdo.timothystl.org
```

---

## Admin Portal Plan (`admin.timothystl.org`)

Extend current `tlc-admin-worker.js` with new tabs:

| Tab | Who Uses It | Status |
|-----|-------------|--------|
| Newsletter | Pastor/office | **DONE** — format picker, Brevo email, draft/published split · **on the shared pattern** at `/newsletters` (2026-08-01), with a live preview built by the real email builder and sent issues locked server-side; see "Phase 5" below |
| News & Events | Pastor/office | **DONE** — DB wired, API live at /api/news · **on the shared pattern**. Split from Newsletter in v3.0.0: `/newsitems` is News only, the newsletter list stays at `/` |
| Ministries | Office staff | **DONE** — ministry page content management, now including the block-based **page editor** at `/ministries/editor/:slug` (see "Ministry Page Editor" below); also covers Youth Pages (TinyMCE editor, youth_pages DB table) and the Voters Assembly special page (Zoom link + file upload), both folded in as cards rather than separate tabs |
| Sermons | Pastor/office | **DONE** — sermon series + standalone sermon notes, powers /sermons · **on the shared pattern**, series with their sermons indented beneath |
| Christian Ed | Pastor/office | **DONE** — Bible class schedule (`bible_classes` table), powers /education · **on the shared pattern** |
| Notices | Office staff — requires `notices_edit` | **DONE** — self-serve banner notices per static page (renamed from "Pages"; the permission was `pages_edit` before v3.0.0) · **on the shared pattern** |
| Links | Office staff | **DONE** — manages link cards shown at links.timothystl.org (`link_cards` table) |
| Staff | Office staff | **DONE** — staff directory (photos, bios, emails) shown on /about |
| Gym Rentals | Office staff (Dinger) | **DONE** (v3.2.0) — full rental management at /gym-rentals, queue rebuilt to the design; see "Gym and Payroll, to the mockups" below |
| Users | Admins | **DONE** — user accounts + per-tab permission checkboxes |
| Subscribers | Office staff | **DONE** — newsletter subscriber list |
| Redirects | Office staff | **DONE** — admin-managed URL redirects at `/redirects`, all four kinds in one list (hand-made, automatic 301s from renames, derived short links, giving) · **on the shared pattern** with a drawer |
| Settings | Office staff — requires `settings_manage` | **DONE** (v3.1.0) — the `site_settings` keys the rest of the site reads, each with what reads it; anything with a screen of its own links there rather than duplicating the field |
| Giving | Office staff — requires `giving_manage` permission | **DONE** (2026-07-27) — base Tithe.ly link, give.timothystl.org's amount tiers + per-tier links, and vendor/market one-off payment links (Tithe.ly or Square); see below |
| Payroll | Office staff (Dinger) — requires `payroll_manage` permission | **DONE** (v3.2.0) — combined biweekly payroll (church staff + MDO preschool staff), rebuilt onto the shared shell with the design's period picker, Enter & approve / Report and three report layouts; see "Gym and Payroll, to the mockups" and "Payroll & Supabase" below |
| Audit Log | Admins | **DONE** — change history + rollback, requires `audit_view` |
| Media | Office staff (`pages_edit`) or a ministry leader (`ministries_edit`) | **DONE** (2026-08-01) — the photo/video library with alt text, size and usage; see "Phase 9" below |
| Menu | Office staff — requires `pages_edit` | **DONE** (2026-08-01) — the header and footer as a drag-and-drop tree with a live preview (`menu_items` table); see "Phase 4 — the Menu" below |
| Partners | Office staff — requires `pages_edit` | **DONE** (2026-08-01) — one partner ministry per core value (`partners` table), feeding the dashboard's values report and the public /about/values page |
| Pages | Office staff (`pages_edit`) or a ministry leader for their own pages (`pages_edit_own`) | **DONE** (2026-07-31) — every page on the public site, with the block editor at `/pages/:id/edit`; see "Site Editor" below. Both permissions were renamed in v3.0.0 (from `site_pages` / `site_pages_own`) |
| Filtered Mail | Office staff — requires `settings_manage` | **DONE** (2026-07-31) — review queue for public-form submissions held as spam; see "Form Spam Screening" below |
| Connect | External link in sidebar footer | **DONE** — single link out to `connect.timothystl.org` (renamed 2026-07-22 from `chms.timothystl.org`, itself changed 2026-07-20 from two separate "Scheduler"/"Volunteer Admin" links; see the chms repo's own CLAUDE.md) |

### Giving Tab (added 2026-07-27)
Consolidates everything related to giving/payment links, previously either hardcoded in
code (`give-landing.js` in this repo) or scattered under Redirects:
- **Base Tithe.ly Link** — the `give_url` site setting (unchanged storage, just moved its
  edit field here from the old "Built-in Redirects" card) — expected to hold `formId` +
  `locationId` + `fundId` but **not** `amount`. Correction 2026-07-27: Tithe.ly *does*
  support prefilling the gift amount, confirmed against a real generated link
  (`...&amount=2500` for a $25 gift — amount is in **cents**) — this supersedes the earlier
  assumption (based on generic help-doc search results, not a real link) that a distinct
  pre-made link was needed per amount/frequency. `give-landing.js`'s `withAmount()` appends
  `&amount=<cents>` to this base link for whichever amount is selected or typed (including a
  custom "other amount"), computed on the fly — no per-tier link management needed for the
  normal case.
- **Amount Tiers** (`give_amount_tiers` D1 table) — the chip amounts on
  `give.timothystl.org`, each with a Default flag for which chip is pre-selected on page
  load, and an optional `url` override (blank in the normal case — the link is auto-built
  from the base link + amount above; only set if a specific tier should go somewhere else
  entirely, e.g. a different fund). One link concept per tier, not a Monthly/One-time pair —
  Tithe.ly has no way to prefill a link as specifically recurring vs. one-time, so the
  frequency toggle originally built into the page was removed (2026-07-27); the giver picks
  frequency on Tithe.ly's own page. `site-worker.js` fetches active tiers from
  `GET /api/give-amounts` (same fetch-and-cache pattern as the existing `/api/redirects`)
  when rendering the giving page; a hardcoded fallback in `give-landing.js` is used only if
  `admin.timothystl.org` is unreachable. The page also has two static (non-admin-editable)
  content sections, each amount also auto-linked via the same `withAmount()` mechanism: a
  "What Your Generosity Makes Possible" ministry ladder and a "Bigger Commitments. Bigger
  Impact." leadership-giving section ($5,000–$18,000/year) — both are real copy from Andrew,
  hardcoded in `give-landing.js` rather than data-driven, since they're narrative content
  rather than simple amount/link pairs. Layout restructured 2026-07-27: the page opens with
  a full-width navy hero banner ("Your Gift Continues His Work"), then a two-column row —
  the ministry ladder on the left (own card per row, each with a direct "Give $X →" button
  linking through `withAmount()`, same as the leadership tiers below it) and the amount-chip
  giving widget on the right (photo panel removed). Ministry-ladder amounts are weekly
  ($15/$30/$50/$75/$100/$175/$300, each tied to a concrete outcome — devotional resources,
  altar flowers, NYG, tuition aid, Word of Life tuition, music ministry, MDO care) — distinct
  from the separately admin-editable amount-chip tiers above.
- **Funds** (`give_funds` D1 table, added 2026-07-27) — a "Give to" dropdown on
  give.timothystl.org's main widget (hidden entirely if only one fund exists). Each fund
  has its own Tithe.ly `fundId`, entered by hand — ChMS's own `funds` table has no Tithe.ly
  linkage at all (only a `breeze_id`, for its own Breeze giving-sync), so even a live
  cross-app fetch can't supply the Tithe.ly ID, only the fund *name*. The "Add new fund"
  form on this tab does that name lookup for real (added 2026-07-27): a new
  `getChmsFundSuggestions(env)` calls `GET https://serve.timothystl.org/api/intake/funds`
  (chms repo's read-only `/api/intake/funds` endpoint, same `X-Intake-Key`/
  `CHMS_INTAKE_API_KEY` auth as the existing contact/prayer intake calls) and renders each
  active ChMS fund name as a click-to-fill suggestion chip above the name field — clicking
  one just fills the text input, nothing is auto-created. Fund names already present in
  `give_funds` are shown dimmed rather than hidden, since the same name legitimately existing
  in both apps isn't an error. Best-effort only: if `CHMS_INTAKE_API_KEY` isn't yet set on
  this Worker, or ChMS is unreachable, the suggestions row is simply omitted — the manual
  "type the name yourself" path is unaffected. **Requires a manual step outside this repo**:
  `CHMS_INTAKE_API_KEY` must be set as a secret on this Worker
  (`wrangler secret put CHMS_INTAKE_API_KEY --name tlc-newsletter-admin`, using the exact
  same value already configured on the chms repo's Worker) — it isn't there today, since this
  Worker never called out to ChMS before this feature. A blank `tithely_fund_id` means "use
  whatever fund is already in the Base Tithe.ly Link" (the normal setup for a plain "General
  Fund" row). Switching funds client-side recomputes every amount's link (chips + custom
  "other amount") to use the
  selected fund's ID instead — the ministry-ladder and leadership-giving sections are
  unaffected by the selector and always use the default fund, since those are separate,
  narratively-specific asks rather than a generic amount+fund combo.
- **Vendor / Market Links** — one-off payment links (e.g. a Christmas Market vendor
  deposit) — same underlying `redirects` table/`category='giving'` rows as before, just
  relocated here. URL-agnostic: works for a Tithe.ly custom link or a Square Checkout link
  (the Christmas Market runs on its own separate Square account, not Tithe.ly) with no code
  difference between the two. Gym rental invoices already auto-generate and email their own
  Tithe.ly pay link on confirmation — nothing to add here for those.

Gated by a dedicated **`giving_manage`** permission (`admin/auth.js`), separate from
`settings_manage` — mirrors how Payroll got its own `payroll_manage` instead of riding on
Settings, so giving-link management can be granted independently of plain redirects or
Subscribers (PII) access.

### Form Spam Screening (added 2026-07-31)

The public contact / prayer / newsletter forms had one defence — a hidden
honeypot field — and the forms POST cross-origin to
`admin.timothystl.org/api/contact`, so a bot never has to load the site at all
and the honeypot never gets a chance. Marketing pitches were arriving in the
office inbox as "Contact Form — …" a few times a month.

**The governing constraint: a real prayer request must never be lost.** Nothing
is rejected. A submission that scores past the threshold is *held* — stored in
full and listed at `/filtered` — and the sender is told it went through (a bot
that learns which of its messages were caught learns how to get past the
filter). Everything below the threshold is delivered as before, with
`[likely spam]` prefixed to the subject when it scored high enough to be worth
a glance.

- **`admin/spam.js`** is pure and unit-tested — the scoring rules, and the
  signed form token. `admin/forms.js` is the part that touches D1, Turnstile
  and Brevo: `screenSubmission()`, the ChMS hand-off, and the Filtered Mail
  page.
- **Three independent signals**, so no single one has to be right: a signed
  token issued by `GET /api/form-config` when the page loads (a bot POSTing
  straight at the API has none, and a submit faster than ~2.5s reads as
  machine-quick); content scoring against real spam vocabulary; and a
  per-address flood limit computed from the `form_submissions` table.
- **A missing token is a *signal*, never a rejection.** Same for a Turnstile
  outage or an unreadable signing key — all of them cost a visitor points, not
  their message. A clean prayer request with no token at all still goes
  through. This is why the thresholds look low: they are only ever additive.
- **`admin/spam.test.mjs` is scored against real mail** — every "legitimate"
  case in it is an actual submission from the site (a food-pantry ask, a
  cancer prayer request, a giving question) and every spam case is a pitch that
  really arrived. A rule change that holds one of those real messages is wrong,
  and the test says so. `admin/forms.test.mjs` covers the wiring end-to-end
  against real SQLite (`node:sqlite` behind a D1-shaped shim) with `fetch`
  stubbed. Run: `node admin/spam.test.mjs`, `node admin/forms.test.mjs`.
- **The donated-piano scam has its own rule** (added 2026-07-31 at Andrew's
  request — it arrives constantly, by email as well as through the form). It is
  scored in two halves on purpose: the item being given away is nearly
  worthless as a signal, because a member really might offer the church a
  piano. What holds it is the shape a parishioner would never use — written
  about a named third party *plus* a redirect to an outside address, the stock
  "passionate music enthusiast" sentiment, a late-relative framing, or the
  you-only-pay-the-delivery ask. A member relaying somebody else's offer lands
  at `suspect`: delivered, tagged, never held. Both sides are in the test file.
- **`matchGroup` scores each distinct reason once, not each regex.** Several
  patterns often describe one tell; charging for both doubles a signal the
  visitor only gave once. Add a pattern with an existing reason string and it
  widens coverage without inflating the score — that is the intended way to
  extend a group.
- **Retention:** `delivered` rows exist only for the flood limit and are pruned
  after 30 days; `released` after 90; `held` never — it waits for a human. The
  table must not become a second, unguarded archive of everyone's prayer
  requests.
- **Held mail is invisible by design**, so the Dashboard's "Needs your
  attention" entry is what makes holding safe rather than silently lossy. Don't
  remove it without replacing the signal.
- **Turnstile is optional and inert until configured** — the site key is saved
  from the Filtered Mail tab, and `TURNSTILE_SECRET_KEY` must be set on the
  Worker (`wrangler secret put TURNSTILE_SECRET_KEY --name tlc-newsletter-admin`).
  With only one half in place nothing changes on the site.
- Confirmation auto-replies are now suppressed for suspect submissions — the
  address is attacker-supplied, so replying to it turned the form into a way to
  mail someone else's inbox (part of AW-5 in the July 2026 review).

### Ministry Page Editor (added 2026-07-30)

Ministry pages are an ordered list of typed **blocks** rather than one TinyMCE box,
edited in a full-viewport drag-and-drop editor at `/ministries/editor/:slug`. Built
from the design handoff in `design_handoff_ministry_page_editor/`. The pastor's
stated constraint — *it must not be possible to break the page* — is why every
layout control is a constrained choice (an 8px spacing step, a palette colour, an
S/M/L size) and never a free-form pixel or hex value.

**`admin/blocks.js` is the single renderer.** It owns the block schema, the
guardrails, the sanitiser, and the HTML template for all 19 block types. The public
site and the editor canvas both render through `renderPage()`, so the WYSIWYG
preview cannot drift from the live page. If you add a block type, add it there and
it appears in both places at once. Do **not** add a second copy of a template
anywhere — that is the one thing this design exists to prevent.

- **Storage** — `youth_pages` gains `blocks` (JSON draft), `published_blocks` (JSON
  live), `page_status` (`live`/`draft`/`scheduled`/`hidden`), `publish_at`,
  `change_log`. Plus `ministry_media` (photo/video library) and
  `ministry_page_revisions` (one snapshot per publish). The legacy `content` /
  `hero_image_url` / `cta_*` / `vid_*` columns are deliberately kept — they are the
  rollback path, and `hero_image_url` still drives the page banner, which is *not*
  a block (blocks render into the content region below it, via `blocks_html` on
  `GET /api/ministry/:slug`).
- **Guardrails are enforced server-side**, in `sanitizeBlock()`, not just in the
  client: spacing snaps to 8px steps capped at 96, colours must come from the two
  palettes and an unreadable ink/background pair is corrected on write, unknown
  block types are dropped, rich text goes through an allowlist sanitiser. A stale
  tab cannot write `spaceAbove: 900`.
- **The editor does not re-render to restyle.** Every inspector knob is emitted as
  a CSS custom property on the block wrapper, so the editor patches the DOM node
  directly. Only structural changes (add/delete/duplicate/reorder/undo/reset) ask
  the Worker to re-render, through the stateless `POST /ministries/api/render`.
  `styleVars()` in `admin/ministry-editor.html` must stay byte-identical to
  `wrapperVars()` in `admin/blocks.js`; `test/editor-edit.test.mjs` asserts exactly
  that, so drift is caught rather than shipped.
- **Scheduling** needs the cron trigger in `wrangler.toml` (`*/15 * * * *` →
  `promoteScheduledPages()`). Removing that trigger silently breaks "publish later".
- **Whole-page blocks (2026-07-30)** — a page whose blocks *lead with a hero*
  is rendered entirely from blocks: `tlcMaybeTakeOver()` in `public/index.html`
  hides every hardcoded section in that page div and drops the blocks in at full
  width (`.tlcb-page--full`). Any other page keeps its hardcoded sections and
  blocks fill only the content region, as before. That one signal — first block
  is a hero — is the whole switch; there is no separate flag to fall out of sync.
  `tools/extract-page-seeds.mjs` converted each hardcoded ministry page into
  blocks (`admin/page-seeds.js`, generated — do not hand-edit); the Worker seeds
  those into each page's **draft** only, so the live page is unchanged until
  staff open the editor and press Publish.
- **Takeover is decided in one place.** Ministry pages are loaded by three
  different functions (`loadMinistryPage`, `loadYouthPage`, `loadMinistryCta`).
  `tlcMaybeTakeOver()` runs before all of them; the legacy loader only runs if it
  returns false. Adding a fourth loader without routing it through there would
  silently leave that page un-takeover-able.
- **Rollout** — start with Music Ministry, let the office use it, then publish the
  rest page by page. Once a page has been published from the editor its hardcoded
  markup in `public/index.html` is dead and can be deleted.
- **Images** are resized in the *browser* before upload (1600px + a 400px
  thumbnail, WebP where available) — see `shrink()` in `admin/ministry-editor.html`.
  No Cloudflare Images dependency. Animated GIFs are passed through untouched and
  PNGs are left alone when WebP is unavailable, so transparency is never
  flattened.
- **Saved sections** (`ministry_saved_sections`) let the office keep a block, or a
  whole page, as a reusable named section and drop it in from the palette's
  "Saved" group. Inserted copies get fresh block ids and no live link back.

**Tests** — `node admin/blocks.test.mjs` (renderer, guardrails, sanitising,
migration, layouts, the generated site-page seeds) and `node admin/pages.test.mjs`
(what counts as a draft, list order, filters, addresses, renaming), plus browser
suites in `test/` driven by Playwright against `test/editor-server.mjs`, a local
stand-in for the Worker: `editor` (shell), `editor-edit` (inspector + typing),
`editor-dnd` (reordering), `editor-media`, `editor-resize`, `editor-sections`,
`editor-publish`, `site-editor` (the pages rail, the Page tab, self-filling
blocks, paste), `site-roles` (roles, locked blocks, undo),
`public-page` (the live site), `whole-page` (takeover + the generated seeds),
`site-pages` (generated nav, published pages, fallback) and `ministries-list`.
Run any with `node <path>`. Chromium is at `/opt/pw-browsers/chromium`.

### The v3.0.0 Admin Overhaul (added 2026-08-01) — Phases 0–2 of 9

Built from the design handoff in `design_handoff_admin_overhaul/`. Andrew's own
summary of the old admin was **"nothing matches"** — every screen had grown its
own table, its own filters, its own idea of what a status looked like. The fix
is not new features: it is **one pattern, applied to every section**, so that
learning one screen teaches all of them.

**All nine phases are built**, plus a mockup-match pass (v3.1.0) and the Gym /
Payroll rebuild (v3.2.0). `design_handoff_admin_overhaul/IMPLEMENTATION-PHASES.md`
was the build order.

- **`admin/ui.js` is the pattern, once.** `renderListSection()` takes a config
  and emits the whole thing: title, one action, purpose line, search + filter
  pills + count, table, and one `◆` note stating the rule the section enforces.
  `renderDrawer()` does the same for the edit panel. **If you find yourself
  hand-rolling a table in a route handler, that is the bug** — adding a section
  means writing a config. `LIST_SECTION_JS` is included once by `sidebarShell()`
  and discovers sections, so a new one needs no script of its own.
- **Five status tones and only five** (`TONES` in `admin/ui.js`): green live,
  amber needs attention, red broken, grey deliberately off, blue-grey automatic.
  An unrecognised tone clamps to grey rather than rendering unstyled.
- **The count label is scoped to the filter, not the table.** "3 of 8 shown"
  where 8 is what the *active filter* can reach. "5 of 12" when only 5 can ever
  be shown teaches a volunteer that seven rows are hiding somewhere.
  `test/list-section.test.mjs` pins this down in a real browser.
- **A row that needs attention grows a warning row beneath it**, with its own
  action label — never a modal, never a silent failure. An untagged ministry, a
  notice with no body, a news post with no expiry date.
- **`admin/values.js` is the one place the four values live.** Stored keys are
  `acceptance` / `worship` / `education` / `outreach`; the short names (Welcome,
  Receive, Grow, Go) are display only, so renaming a label never touches the
  database. `normalizeValue()` guards every write path.
- **Dashboard ships both layouts** behind a toggle — "Needs you" (the default,
  a worklist you clear) and "Overview" (stat tiles). `badgeCounts()` computes
  the sidebar badges and the worklist from **one** query set, so a badge saying
  3 beside a worklist showing 2 is impossible.
- **The dashboard has no payroll task.** The spec asks for "payroll period
  closing within 3 days"; payroll lives in Supabase and the Worker holds no
  server-side Supabase credentials (the `/sb` proxy only forwards browser
  calls), so it cannot be computed here. Deliberately omitted, not forgotten.

#### ⚠ Permissions were renamed — and the migration must never run twice

The names now match the sections they open. Two of them **swapped meaning**:

| Old key | New key | Opens |
|---|---|---|
| `pages_edit` (meant Notices) | `notices_edit` | Notices, Voters |
| `site_pages` | `pages_edit` | Pages + the site editor |
| `site_pages_own` | `pages_edit_own` | A ministry leader's own pages |

`migratePermissionKeys()` in `admin/auth.js` is **deliberately not idempotent
and cannot be made so** — a row holding the new `pages_edit` is indistinguishable
from one holding the old. A second pass demotes every site editor to
notices-only. It is therefore gated on `PERM_RENAME_MARKER` (`perm_rename_v3` in
`_schema_version`), which is **independent of `SCHEMA_VERSION`** because that
re-runs on every bump. `admin/auth.test.mjs` asserts the non-idempotence on
purpose; `test/admin-redesign.test.mjs` proves a forced `SCHEMA_VERSION` bump
does not demote anyone. Do not "fix" the non-idempotence without checking the
marker is still there.

The handoff called these "the 14 real permission names" but its list has no key
for Notices and none for the ministry-leader role. Following it literally would
have ungated Notices and deleted a role the site editor enforces server-side, so
there are **16** keys: the spec's 14 with the spec's meanings, plus those two.

#### Sections converted so far

Every list section now reads from `admin/sections.js` (see below). Gym Rentals,
Payroll and the Giving link table keep their bespoke screens on purpose.

- **The sidebar is the design's five groups** — Website, Email, Money &
  Building, People & Access, Setup, with Dashboard above them unlabelled —
  and the page-producing sections nested under Pages. Badges only show to
  somebody who can act on them.
- **Newsletter and News & Events are now separate sections.** `/newsitems` is
  News only; the newsletter list stays at `/`. The newsletter approval/send
  redirects were repointed from `/newsitems?msg=…` to `/?msg=…` so they land
  where the issue actually lives.
- **Ministries separates "In menu" from "Status"** — the distinction the old
  admin conflated. `youth_pages.in_menu` takes a ministry out of the header
  while the page stays live at its address.
- **Partners** (`partners` table) is one record per value, with `UNIQUE(value)`
  so the one-per-value rule is the database's job. A value with no partner shows
  as a gap rather than quietly showing three. Seeded with `INSERT OR IGNORE`, so
  editing a partner is never undone by a deploy.
- **Sermons needed no schema change** — `sermon_notes` already had
  `youtube_url` and `audio_url`, and the site's sermon block already branches on
  them (it renders a text-only card with no play affordance when neither is set).
  The handoff's "the sermon library does NOT exist yet — build it" was stale.
- **Christian Ed's add form moved** to `/christian-education/new` so the section
  reads like every other one: a list, and one action that opens a form.

#### Public site

- **`/about/values`** — a new page, a child of About in the address bar and the
  mobile nav. `NESTED_PATHS` / `tlcPathFor()` in `public/index.html` is the one
  place a nested address is described, so the router, `showPage()` and the
  canonical/OG tags cannot drift.
- **`/about`'s value cards read from `/api/values`**, falling back to the
  hardcoded markup if the admin is unreachable — a visitor must never see a page
  that looks like the church has no values.
- **The calendar is embedded on `/news`** below the posts (lazily — the iframe
  gets its `src` only when the page opens). **`/calendar` stays live as its own
  page** (Andrew's call — it is bookmarked and printed on flyers), so unlike the
  handoff there is no `/calendar` → `/news` redirect. `/events` routes to `/news`.

#### Where the handoff was stale or wrong

It was written against v1.91.0, before the site editor (v2.0.0) and Filtered
Mail shipped. Beyond the sermon library and the permission list above: it marks
`pages` as a NEW table (it exists), and it proposes a **`menu_items` table** for
the Menu editor — rejected, because the public nav is already generated from
`pages` (`in_menu` / `parent_id` / `sort` / `menu_label`) and a second table
would be a second source of truth for the same nav. When Phase 4 is built, the
Menu screen persists to `pages`. It also gives Word of Life's site as
`wordoflifestl.org`; the real one, already linked from `/wol`, is
`wordoflifeschool.net`, and that is what is seeded.

#### Phase 3 — short links, clashes, redirects (2026-08-01)

- **A short link is derived, not typed.** `shortLinkFor()` in `admin/pages.js`
  takes the last segment of the address, so `/beliefs` works as well as
  `/about/beliefs` — the difference between an address you can say from the
  pulpit and one you have to spell out. Because it is derived, it cannot drift
  when a page is renamed. `pages.short_link` overrides it and exists for
  exactly one reason: resolving a clash.
- **A clash is flagged, never guessed.** Two pages both deriving `/sermons`
  both get a `LINK CLASH` pill and a warning row naming the other page, and
  **neither** short link is published. Silently giving it to whichever page
  sorted first would mean an address announced on Sunday quietly reaching the
  wrong page — the kind of thing nobody notices until somebody complains. A
  short link that collides with another page's *real* address is refused for
  the same reason: the real address wins.
- **Rename 301s beat short links.** `/api/pages` merges both into one
  `redirects` map, with `page_redirects` applied **last** so it wins. An old
  address is a promise already made — it is in bulletins and in Google —
  whereas a short link is a convenience the office can change in a click.
  Getting this order backwards silently breaks the very inbound links
  `page_redirects` exists to protect. Covered by a test that asserts the
  precedence directly.
- **The Redirects screen shows all four kinds in one list** — hand-made,
  automatic (from renames), derived short links, and giving — because somebody
  asking "where does /zoom go" should not have to know which table it lives in.
  Short links are shown even though they are stored nowhere; hiding them would
  make the list a half-truth.
- **Automatic 301s on rename were already built** (`pageRename()` +
  `page_redirects`, from the site editor). Phase 3 did not need to add them.
- **Ministries answer on both addresses** — `/music` and `/ministries/music`,
  resolved in `public/index.html`'s router, canonicalising to the short one.
  An unknown ministry still 404s.

#### Phase 4 — the Menu (2026-08-01)

**The earlier decision to extend `pages` was reversed, on new information.**
The navigation carries things `pages` cannot express: outside sites (Word of
Life, MDO, the volunteer site) have no page row at all, and one page appears
in *both* menus — Give is a button in the header and a plain link in the
footer. A page row has one `sort`, one `parent_id` and one `in_menu`, so
"appears twice, in different places, under different labels" has nowhere to
live.

`menu_items` is therefore a **join table, not a second source of truth**:

| Table | Answers |
|---|---|
| `pages` | what a page *is*, and where it lives. One row per page. |
| `menu_items` | what the *navigation looks like*. One row per appearance. |

- **A menu item never records a page's address.** A `page` item stores
  `page_id` and nothing else; the label falls back to the page's own and the
  address is always read from `pages`. Renaming a page moves every menu item
  pointing at it, with nothing to update by hand. `admin/menu.test.mjs` and
  `test/admin-redesign.test.mjs` both assert this directly — it is the
  property that makes the join table safe.
- **Depth, not a parent pointer.** An item at depth 1 belongs to the nearest
  preceding depth-0 item, which is exactly what "drop onto an item's name to
  nest" expresses. Reordering is a list operation, so a child cannot be
  orphaned by moving its parent — it holds no reference to lose. A leading
  item is clamped to depth 0 (nothing above it to nest under).
- **Broken items are flagged, never dropped.** An item pointing at a deleted
  or draft page stays in the admin list, marked, with the reason. Silently
  removing it would hide the mistake until a visitor mentioned the gap.
  `publicMenu()` filters broken and hidden items so the *site* never shows
  them — the admin and the site deliberately differ here.
- **Removing an item never touches the page.** It reappears in the "Live pages
  not in the menu" panel. Nothing is lost by tidying the menu.
- **Orphans are not an error.** A thank-you page or a one-off landing page is
  meant to be reachable only by link, so the panel says so rather than nagging.
- **Reordering posts the whole resulting order**, and the server renumbers from
  scratch in steps of 10. A diff would let a dropped row leave two items
  claiming one position; a test asserts every position is unique afterwards.
- **Seeded from the nav as it stands** (`MENU_SEED` in `admin/db.js`), with
  explicit ids and `INSERT OR IGNORE`, so the first person to open the screen
  sees the live site rather than an empty list — and rearranging it survives
  deploys.
- **`buildNav()` reads `menu` from `/api/pages`** and falls back to the
  page-derived nav, which itself falls back to the hardcoded markup. A visitor
  must never be shown a church website with no navigation.

Run: `node admin/menu.test.mjs`.

#### Phase 5 — the newsletter composer (2026-08-01)

Most of the composer already existed: the format picker, subject, date, six
TinyMCE fields (pastor, secondary, WOL, LASM, tertiary, quick body), the news
and Bible-class pickers, editable event rows and both CTAs. The handoff's
"restore the full editor" was largely already true. What this phase added is
the part that was missing and the part that was unsafe.

- **`admin/newsletter.js` holds the rules**, pure and tested: what counts as
  sent, what a sent issue still allows, block defaults, audience, and the
  subject/preheader guidance.
- **A sent issue is read-only, enforced server-side.** `/publish` checks
  `canEdit()` *before reading anything from the form*, so a stale tab or a
  crafted POST cannot get partway in. Around 600 people already have a copy;
  the archive on the website has to keep saying what was actually sent.
  `isSent()` is deliberately generous — `status`, `sent_at`, `beehiiv_id` or
  `brevo_campaign_id` — because an issue that reached anybody is locked
  whichever field recorded it. A test tampers with a sent issue by direct POST
  and asserts the subject and body are untouched.
- **The list offers "Duplicate as draft" instead of Edit** on a sent row, so
  what is possible is visible before anyone clicks into a locked screen.
- **Blocks: absent means everything ON.** An issue written before `blocks`
  existed has none stored, and defaulting to off would silently ship an empty
  newsletter. The same trap sits in the save path: the new-newsletter form
  renders no switches, so an empty `block_seen` stores **NULL**, not an
  all-false object. `block_seen` records which switches the form actually
  showed — a checkbox posts nothing when off, so without it an unrendered
  switch would read as "off".
- **The pastor's note is locked on** in both directions — `parseBlocks` and
  `serializeBlocks` — so a direct write cannot switch it off.
- **The preview is built by `buildEmailHtml`, the function the send path
  uses.** `POST /newsletter/preview` takes the live form values and returns the
  real email. A separately-written preview would drift, and nobody would find
  out until an issue had gone out. Switched-off blocks are absent from the
  preview too, so it cannot flatter what will actually send.
- **Sends record `sent_at` and `sent_count`**, so "Sent July 24 to 609
  subscribers" is a fact rather than an estimate. (The handoff writes
  "24 July"; every other date in this admin reads American, and so do its
  readers.)
- **The newsletter list is addressed `/newsletters`.** `/` redirects to the
  dashboard, so the list — which is the unmatched fall-through — needed a real
  address; every `?msg=` redirect now points there.
- **`approvalState()` is honest about the two-person rule.** With only one
  approver it says the step is a formality, and approving your own submission
  is flagged as weaker rather than silently allowed. Still waiting on Andrew's
  second `newsletter_approve` account.

Not built: the `extras` JSON ("+ Add another note"), `include_sermon` /
`include_bulletin` as content (their switches exist and are stored, but the
email builder does not yet render a This Sunday or bulletin section).

Run: `node admin/newsletter.test.mjs`.

#### Phase 6 — Staff, Users, Subscribers (2026-08-01)

Three more sections onto the shared pattern. Little new behaviour — the value
is that these are now the same screen as the other nine.

- **Staff** — Person / Email / Order / Photo. The per-person photo crop the
  handoff asks for (`photo_position`, `photo_zoom`) **already existed**, and is
  already read everywhere a staff photo appears; only the note explaining it is
  new. Somebody with no photo gets a warning row, because the About page falls
  back to initials and nobody notices.
- **Users** — User / Access / Last login / Status. Access reads "Full access"
  or "Custom access (N of 16)". `permissionCheckboxes()` now prints each
  permission key in monospace beside its plain-language name, so this screen
  and the routes that gate on it use the same word — which is the point of
  having renamed them all in v3.0.0. Presets sit above and only ever tick
  boxes: they grant nothing the list does not then show. A user with no email
  gets a warning row, since without one a forgotten password cannot be reset.
- **Subscribers** — Person / Source / Joined / Status, merging the Brevo list
  and the local signup table on the address so nobody appears twice. Somebody
  who signed up on the website but has not reached Brevo is surfaced as its
  own filter rather than being invisible. When Brevo cannot be read the screen
  still shows the website signups instead of going blank.

Run: the section is covered by `test/admin-redesign.test.mjs`.

#### Phase 7 (part) — Gym Rentals, both layouts (2026-08-01)

Andrew's answer to §8.3 was "ship both with a toggle", so `/gym-rentals` now
has **Queue** and **Calendar** views.

- **The queue view is the screen that already existed**, untouched. It carries
  the bulk confirm/release/delete, the per-org accordions, the invoice
  generation and the Google Calendar push — the parts with real money and real
  bookings behind them. Rewriting that to fit a list config would have risked a
  lot to gain consistency on the one screen where consistency matters least,
  because only one person uses it.
- **The calendar view is read-only, deliberately.** It is built from the
  bookings already fetched for the queue, so switching costs no extra queries,
  and it says on its face that confirming, releasing and invoicing happen in
  the Queue view. Two places to confirm a hold would be two places to get it
  wrong.
- Holds are amber, confirmed bookings green, blocked dates greyed with their
  reason. Month navigation preserves the view.

#### Phase 7 (part) — Giving: Gift vs Payment (2026-08-01)

`redirects.give_kind` tags every giving link **gift** or **payment**. A Gift is
receipted as a donation on somebody's year-end statement; a Payment — gym rent,
a registration fee, a vendor invoice — is not.

**It defaults to `payment`, on both the column and the write path, and that is
deliberate.** Every row that exists today is a vendor or market link, and the
two mistakes are not equal: wrongly receipting a non-donation as tax-deductible
is the more serious error, so a gift has to be chosen on purpose.

**Not built, and not from lack of time:** the handoff's "two page surfaces with
a keep-in-step switch" would mean converting `give.timothystl.org` — currently
rendered by the hardcoded `give-landing.js` — into a page in the block editor.
That is the church's donation page; it should be a deliberate change with
someone watching it, not something folded into the end of a redesign pass. The
amount tiers, funds and base link it reads are already admin-editable, which is
most of what that section was for.

#### Phase 9 — Media, audit rollback, ⌘K (2026-08-01)

**Media** reuses `ministry_media` rather than adding the handoff's `media`
table — it already is the media library, with `alt` on it, and a second table
would be a second place to look for the same photo. What was added is `bytes`,
recorded by the editor after it resizes, so the screen can flag anything over
1MB without re-reading every object out of R2.

- **"Used nowhere" is answered by searching every page's blocks for the
  filename** — crude, but honest: a photo is used if its address appears in
  something that renders. Both the draft and the published copy count, because
  a picture in an unpublished draft is still wanted and calling it unused
  would invite somebody to delete it out from under their own half-finished
  page.
- **Alt text is edited in place**, not in a drawer. It is the field the screen
  exists to fix.

**Audit log.** `admin/audit.js` turns a stored before/after pair into
something readable, and the diff is the row's sub-line because "what changed"
is why anybody opens the screen. Timestamps are filtered out of the diff —
they change on every save and bury the field that actually changed. A row that
cannot be rolled back shows **why** instead of a dead button.

- **⚠ `audit_log.user_id` was `NOT NULL` while `logAudit` binds null for
  anything the system did on its own** (a scheduled page going live, a hold
  lapsing). The INSERT threw, `logAudit` swallowed it, and those entries were
  simply missing — the exact ones somebody later goes looking for. This was
  AC-6 in the July 2026 review. The column is now nullable; SQLite cannot drop
  NOT NULL in place, so the table is rebuilt and the history copied across.
- **Rolling back does not erase anything.** The original entry stays and the
  rollback is recorded as its own entry, so the log always says everything
  that happened including the undoing. That already worked; the screen now
  says so.

**⌘K** is `GET /api/search` over eleven sections, returning "Section · row".
**Results are permission-scoped server-side** — searching is not a way around
a gate, and a test asserts somebody without `staff_edit` gets no staff rows.
Under two characters returns nothing rather than the whole database. The
palette lives in `sidebarShell()`, so it is on every screen.

Run: `node admin/audit.test.mjs`.

#### The mockup-match pass (v3.1.0, 2026-08-01)

The first nine phases were built having looked at six of the twenty-six
mockups, writing every screen's wording from the README's prose. Andrew's
verdict — *"the editors don't look like the design mockups I gave you, the
organization of tabs isn't the same"* — was right, and this pass is the fix.

- **`admin/sections.js` is the design's own `SECTIONS` config, lifted verbatim**
  from `Admin Sections Prototype.dc.html`. Every screen's title, purpose line,
  action label, search placeholder, filter set, column layout and `◆` note is
  read from it. **If you are typing one of those strings into a route handler,
  that is the bug.** `admin/sections.test.mjs` pins the values that had
  drifted, so the same mistake cannot be made twice quietly.
- **The IA is the design's `NAV`** — Website · Email · Money & Building ·
  People & Access · Setup, Dashboard above them with no heading, and
  Ministries/Partners/News/Sermons/Christian Ed nested under Pages (the
  design's `CHILD_OF`). The old three-group arrangement was mine.
- **Redirects and Settings are two sections, not one.** `/settings` used to
  render the redirects screen; it is now the Settings list — the `site_settings`
  keys the rest of the site reads, each with what reads it. Redirects moved to
  `/redirects` with a drawer for adding and editing. **`/settings/update` now
  allowlists the keys it will write** — it previously accepted any key in the
  body, which was AW-11 in the July 2026 review.
- **A setting with a screen of its own links to that screen** rather than
  offering a second field writing the same key. Church details go to
  `/pages/details`, giving to `/giving`, the gym ones to `/gym-rentals`. Two
  forms writing one key is two places to disagree about what it means.
- **Giving's Funds and Amount Tiers are two panels side by side**, each row a
  grip, a name, a state and one action, with the fields in a drawer — eight
  funds is eight rows rather than forty inputs. `panelList()` in `admin/ui.js`
  is that shape, once. Reordering posts the whole resulting order and the
  server renumbers from scratch, same contract as the menu.
- **⚠ A toggle posts a hidden `0` ahead of its checkbox**, so
  `form.get(name) !== null` is *always* true and reads as on. The giving and
  redirect handlers had exactly that shape; they now check
  `form.getAll(name).includes('1')`. A test asserts an unticked Default really
  stores 0 — without it, editing any fund would have silently made it the
  default.
- **The newsletter editor is two columns** — the form, and a sticky live
  preview with an inbox strip above it that mirrors the subject and preview
  text as you type. The body redraws on a pause, through `POST
  /newsletter/preview`, which is the same `buildEmailHtml` the send path uses.
  Format is two small pills (Weekly / Special edition), not the two large
  cards.
- **The newsletter list gained its `Sends` column** — how many an issue went
  to, or for one not yet sent, how many it would go to today.
- **The audit log folds the action into the Change cell** ("Published · Page ·
  Home") instead of carrying a pill column of its own. On a screen where every
  row is an action, a column of them is a column of noise.
- **Subscribers filters by source** (Website / Added by office / Bounced) and
  its action is **Import CSV** — a real import, additive only, that adds to
  both the local table and Brevo and never removes or overwrites anybody.
  `parseSubscriberCsv()` in `admin/newsletter.js` reads whatever columns it can
  find rather than demanding a layout, and *counts* unusable rows instead of
  dropping them quietly. A bounce and an unsubscribe are shown apart, and a
  bounce is only ever reported when Brevo actually says so — every blacklisted
  address is not a bounce, and guessing would send the office chasing people
  who simply opted out.
- **A status column has a 126px floor** (`minmax` in `renderListSection`'s
  grid, from the design's own `grid()`): a pill that wraps reads as two broken
  words rather than one status.

Filtered Mail is not in the design's IA at all — it shipped after the handoff —
and sits under Email, which is where somebody would look for held mail.

Gym Rentals and Payroll were left bespoke in this pass and rebuilt in the next
one — see "Gym and Payroll, to the mockups" below.

**One question is still open**, and it is the only place the handoff
contradicts itself: the mockups render a row's warning row **above** the row it
refers to (visible in `pages.png` and `media.png`), while README §3 says it
"grows a warning row beneath it". Warnings currently render beneath. Settle it
before changing them.

#### Gym and Payroll, to the mockups (v3.2.0, 2026-08-01)

The two screens the mockup-match pass deliberately skipped. Andrew asked for
both: *"i want the gym and payroll to move to what i mocked up for you"*.

**Gym Rentals** now leads with the design's queue — one list, `Group ·
Requested · Conflicts · Status`, with `Approve` and `Open` on every row.

- **One list, not three cards.** Recurring requests awaiting review, holds
  ticking down, and confirmed bookings were three separate cards, so "what
  needs me?" had three places to look. Recurring requests sort first because
  they are the only rows where nothing happens at all until somebody acts — a
  hold at least expires on its own.
- **`Conflicts` is computed, not decorative.** A hold on a blocked date, or one
  overlapping something already confirmed, says so in the column *and* grows a
  warning row spelling out that approving it would double-book the gym. On the
  calendar the same booking takes the conflict tone rather than its own —
  being blue and correct-looking is how a double-booking survives to Sunday.
- **⚠ The bulk tools were NOT replaced by the queue.** Confirming a whole group
  at one price, releasing several holds, deleting a run of confirmed dates —
  those carry the invoice generation and the Google Calendar push, and one
  person's whole job runs through them. They moved *below* the queue under a
  "By organisation" heading, untouched. Deleting a working invoice flow because
  a mockup does not draw it would be the wrong reading of "match the mockups".
- The calendar view gained the design's four-tone legend (Confirmed · Hold ·
  Conflict · Blocked) and `‹ ›` month arrows. It stays read-only on purpose.

**Payroll (Phase 8)** is now a fragment served inside `sidebarShell()`.

- **PY-3 is fixed.** It was a standalone document — its own fonts, its own
  navy, no sidebar, and a Sign Out button as the only way back. It now has the
  same chrome, sidebar and ⌘K palette as every other screen, and inherits every
  future accessibility and mobile fix.
- **The Supabase SDK is gone.** Running under the shared shell means running
  under the admin CSP, which allows no third-party script host, and widening
  the CSP for every screen to suit one page would be the wrong trade. Only
  eleven PostgREST queries were ever made, so `sbQuery()` is that subset with
  the SDK's shape — `sb.from(t).select().eq()` still reads the same.
- **The design's Status column is real, not a label.** It reads `Needs hours`
  → `Ready` → `Approved`, and Approved is a stored fact — see "Approving a
  payroll period" below. It was left out of the first build because nothing
  wrote it, and a green APPROVED beside a row nobody had looked at would have
  been a lie.
- **There is no "Import from childcare app" button**, because there is no
  import step — MDO hours are read live every time the period changes. A button
  labelled Import would imply a staleness that does not exist. The row says
  what is true and offers the one real action: read again.
- **⚠ Still no rate field for MDO staff, deliberately.** Church rates are typed
  in here; MDO rates are read from the MDO app. The screen says so in as many
  words. See "Where a pay rate comes from" below — do not add one.

Five review items were fixed while rebuilding, because the code was being
rewritten anyway and leaving them would have meant touching payroll twice:

| Label | What was wrong |
|---|---|
| PY-1 | Names interpolated into inline `onclick` — `O'Brien` broke Edit, and a crafted name ran script. Everything is delegated off data attributes now. |
| PY-2 | The 403(b) base was `hours × rate` in the line items and `(hours + PTO) × rate` in the gross, so a person's card did not add up to their own Gross Pay. `baseEarnings()` is computed once and used by both. |
| PY-5 | CSV cells starting `= + - @` are formulas to a spreadsheet. Prefixed now. |
| PY-6 | Money was summed unrounded and rounded at the end, so a printed subtotal could disagree with the rows above it. Every gross rounds to cents *before* it is added. |
| PY-9 | A failed MDO query was swallowed by `|| []`, so a payroll run quietly came out short. It now says the report is incomplete, in the entry view, in the report, and in the CSV. |

`admin/helpers.js` also gained `X-Robots-Tag: noindex, nofollow` on every admin
page — `/payroll` carried it itself, and folding it into the shell would
otherwise have quietly dropped it.

#### Approving a payroll period, and emailing it (2026-08-01)

Andrew, after seeing the rebuilt screen: *"a simple approve of the whole thing
at once, not line by line"* and *"we can have an email report button to. i have
to email it to the bookkeeper"*.

**Approval is per period.** `payroll_periods` (`period_start` PK, `approved_at`,
`approved_by`) — one row per approved run. The mockup draws *both* a per-row
Approve and a period one; only the period one was wanted, so the per-row table
built first (`payroll_reviews`) was dropped the same day, before it held
anything.

- **The row is the fact.** Present means somebody has signed the run off, absent
  means not; taking it back deletes the row rather than flipping a boolean, so
  approved can never be half-set by a failed write. If the approval cannot be
  read at all, the period shows unapproved — that asks for a second look at
  something already looked at, rather than claiming a sign-off that never
  happened.
- **The Status column follows the period**: `Needs hours` → `Ready` →
  `Approved`. Approving is one decision about one run.
- **Approving with somebody's hours missing asks rather than refuses**, and
  *names them* — the office may know that person genuinely worked none. The
  period badge still leads with `N still need hours`, because that outranks
  everything else.
- **`Email report`** posts the *figures* to `POST /payroll/email`; the Worker
  builds the email and escapes every field. Posting rendered HTML would let a
  staff name become markup in something that lands in an outside inbox, and
  would let the emailed report drift from the screen's own. Recipient is the
  `payroll_bookkeeper_email` setting; with none set it refuses and says which
  setting to fill in. Whether the run was approved is on the face of the email,
  because that is the difference between "here are the figures" and "these are
  final" — as is an incomplete run whose MDO half could not be read.
- **⚠ `sendTransactionalEmail` returns `{error}`, it does not throw.** A bare
  try/catch around it reports success on every failure. The route checks the
  return value.

#### The gym calendar is clickable (2026-08-01)

Andrew: *"make the calendar clickable on the dates"*. A day opens the booking
form with that date already filled in (`/gym-rentals/bookings/new?dt=…`, which
already accepted the parameter). A booking chip inside the day links to its
group instead — "what is this?" and "book this day" are two different
questions, so they are two different clicks rather than one ambiguous one. A
blocked date and a date already past are not links, because they cannot be
booked and should not pretend otherwise.

#### The Foundations pass (v3.4.0, 2026-08-01)

The fourth mockup drop added what the first three had not: `screens/` — one
reference file per screen — and **`screens/00-foundations.html`**, an exact
spec for the shell. *"If a screen you are building does not look like its
reference file, the shell is where to look first."* It was right, and this pass
is the shell.

**Tokens are the spec's, verbatim**, in `PALETTE` and `TONES` (`admin/ui.js`)
and `VALUES` (`admin/values.js`). What had drifted:

| | was | now |
|---|---|---|
| Sidebar | `#12243D`, a darker navy of mine | `#1D3557` |
| Active nav row | gold left-bar + tint | **raised** `#27496E` + a hairline inset |
| Card surfaces | reused the page background | `#FFFDF9`, one step brighter |
| Status tones | four approximations | Good `#EDF0E4`/`#3F5424` · Waiting `#FAF0DC`/`#7A5B18` · Problem `#F7E4DE`/`#8C3A28` · Neutral `#EFE7D9`/`#6A6858` |
| The four values | tint/ink invented | the spec's tint / ink / **solid** triples |
| Filter chips | 999px pills | radius 8, on = 2px `#1E2D4A` on `#E7EEF7` |
| Primary button | navy with white text | `#1E2D4A` with `#F5E4C0` text |

- **A value chip keeps its own colours in both states** — selected only adds
  the 2px `solid` border. Recolouring it would read as a *different value*
  rather than the same one, chosen. That is why `solid` exists as a third
  colour per value.
- **A child nav row's marker is an elbow**, not a circle: 7×7 with left and
  bottom hairlines, radius `0 0 0 3px`. It draws the relationship instead of
  asserting it with indentation alone.
- **⚠ A toggle's state word is not optional.** A switch alone says only that a
  setting exists, and which way is on is a convention nobody agreed to. Every
  drawer toggle carries `Showing`/`Hidden` (or the section's own pair), and
  `TOGGLE_WORD_JS` keeps it following the switch — a word rendered once
  server-side would confidently say "Showing" about something now hidden.
- **Four options or fewer is chips, not a select** (`kind: 'chips'`). A select
  hides three of four choices behind a click.
- **Read-only is a sand fill, never greyed text.** Grey text reads as broken.
- **Toasts** (`TOAST_CSS` / `TOAST_JS`) — bottom centre, navy on cream, 2.2s.
  The rule that makes them worth having is the copy: *state the consequence,
  not the event*. "Saved · written to the audit log", not "Saved". A redirect
  carrying `?toast=` raises one and then strips it from the address bar, so a
  refresh does not replay a message about something already done.
- **Two empty states, not one.** A fruitless search quotes back what was typed
  and says "Try fewer words, or clear the filters"; an empty section says "Use
  the button above to add the first one". They call for different actions.
  ⚠ `.tlc-empty` carries an explicit `display`, which beats the UA's
  `[hidden]{display:none}` — hiding it has to be restated in CSS or the empty
  state sits under a full table forever. A browser test caught exactly that.

**Where the spec contradicts itself, the screenshot wins.** Its drawer prose
says "primary save on the left, destructive delete on the right";
`drawer-user-permissions.png` shows Delete left, Cancel + Save right. The
screenshot is what got built.

**Where the spec is followed in outcome but not mechanism**: it says
"permissions hide whole groups, not individual rows". Taken literally, a
bookkeeper holding only `payroll_manage` would see Giving and Gym Rentals
beside Payroll and get 403s from both. Items are hidden individually and a
group with nothing left in it is not rendered — which produces the outcome the
spec describes ("a ministry leader sees Website only") without ever showing a
link somebody cannot open.

#### The editor's rails fold away (2026-08-01)

Andrew: *"i want the 2 sidebars to be able to collapse left so that there is
more screen space to edit the page we are working on."*

Both left rails collapse to a 26px spine — the pages rail already did, the
block outline did not. `setRail()` in `admin/ministry-editor.html` drives both,
and the choice is kept in `localStorage`: somebody on a laptop collapses them
once, not on every page they open. Absent means open, so a first visit shows
everything rather than a page flanked by two mystery spines.

They collapse **independently** on purpose — the outline is what you want while
restructuring, the page list while moving between pages, and both at once is
rare.

⚠ The block rail's toggle is wired **outside** the `if (el.edPagesList)` guard.
It was inside at first, which meant it silently did nothing on ministry pages,
where there is no page list at all. `test/editor.test.mjs` drives a ministry
page and asserts the collapse, the width the canvas gets back, and that the
choice survives a reload.

**Still to do from the editor spec** (`screens/22-page-editor.html`), none of it
started: the device switcher (Desktop · Tablet · Phone as *real widths*, not a
zoom), the info-card slot on banner blocks, the starter picker on New page, and
the block library's full grouping. Recorded here so the next pass has the list.

#### The per-screen pass, part one (v3.5.0, 2026-08-01)

`screens/01-…` through `screens/21-…` each carry a written spec under the
reference render: how the screen is built, its columns and widths, its filter
chips *in order*, its drawer fields *in order* with the helper text under each,
the rules the build must honour, and a "get this wrong and it shows" list.
`admin/sections.js` already had the titles, filters and columns. This pass is
the rest.

What changed:

- **The four values are chips, not a select** (`valueChips()` in `admin/ui.js`),
  on Ministries, Partners, News and Christian Ed. Four options is four chips —
  a select hides three of them behind a click. Each keeps its own colour when
  selected; only the 2px `solid` border is added.
- **A person is a round 52px avatar; a file is a 64×48 rectangle.** They were
  the same 30px circle. A square crop of a landscape photo tells you less than
  the photo does, and Media's whole job is showing you the photo.
- **Staff's Photo column reads `Set` / `No photo yet`**, the spec's words.
- **Redirects says `Redirecting`, not `Live`** — every other screen's "Live"
  means "on the website", and a redirect is not a page.
- **A ticked permission sits on `#F2F7FA` with a blue checkbox.** Scanning what
  somebody can reach should not mean reading twenty checkboxes one at a time.

**Still to do, and the list is the point.** Working from the per-screen specs,
these are the gaps I have not closed:

| Screen | What is missing |
|---|---|
| 02 Pages | ~~`Links out` and `Clash` status pills; the drawer reached by a `Details` action~~ — **done v3.9.0**, below |
| 10 Taps | ~~*taps this month* on each card — needs tap counting built first~~ — **done v3.10.0**, below |
| 16 Gym | ~~"Calendar first" as the genuine default layout~~ — **done v3.9.0**, below |
| 22 Editor | ~~the info-card slot on banner blocks, and the starter picker on New page~~ — **done v3.9.0**, below |

**Nothing is left on this list.** The Taps count was the last one, and it needed
counting to exist at all — see "The taps are counted" below.

#### The Pages screen, to its spec (v3.9.0, 2026-08-01)

- **A page can now stand in for another site.** `pages.external_url` — /mdo is
  in the menu and in the sitemap, but what it does is send the visitor to
  mdo.timothystl.org. Held **on the page** rather than as a loose `redirects`
  row so a menu item can point at it by page id: renaming it, moving it, or
  re-pointing it needs nothing else changed.
  - **"Links out" is checked before every other state**, so an outbound page
    never reads `Draft edits`. It has no content, so it can have no draft — and
    a Draft-edits pill would send staff to an editor with nothing in it. The row
    offers no "Open editor" for the same reason.
  - **Only `http(s)` is stored.** A `javascript:` address here would be a link
    the office clicks from inside their own admin session, so anything else is
    dropped rather than half-honoured. `outboundUrl()` is the one gate, used by
    the pill, the row, the API and the menu alike.
  - **`/api/pages` resolves one hop.** The outbound map is applied to every
    other entry after merging, so a short link or a retired address pointing at
    `/mdo` reaches the outside site directly instead of bouncing twice. Its
    published blocks, if it still has any, are **not** rendered — that would be
    a flash of a page about to redirect out from under the reader.
- **The pill vocabulary is the design's**: `Live` (was "Published") ·
  `Draft edits` · `Not in menu` · `Links out` · `Link clash`. Each `PILLS` entry
  now carries its own **tone**; the list used to pick a tone by comparing the
  label string, so renaming a pill silently recoloured it.
- **A clashing short link is shown in the problem ink** rather than the ordinary
  link blue — it is the thing on that row that is not working.
- **The short-link screen is gone; it is a field in the Details drawer.** One
  place a page's name, address and short link are edited rather than two that
  can disagree. `/pages/:id/link` 302s to `/pages/:id/details`, which the
  Redirects screen still links to by name.
- **`/pages/:id/details` is a real address**, so the drawer survives a refresh
  and a warning row can link straight to it. `/pages/details` — church details,
  two segments — is a different screen and does not match that shape.
- **The row opens the editor; `Details` opens the drawer.** Content lives in the
  page editor, always: the drawer has no body field, and the spec's own
  "get this wrong and it shows" is exactly that.
- **An address can be typed.** `slugPath()` cleans a typed path a segment at a
  time — `slugify()` collapses everything non-alphanumeric, which would turn
  `/about/beliefs` into `/about-beliefs`. `pageRename()` takes it as an optional
  fourth argument and still derives from the title when nothing is typed, so the
  editor's own call is unchanged. Renaming writes the 301s, children included.
- A ministry leader (`pages_edit_own`) gets the same drawer **read-only** — they
  edit their pages' words, not the site's shape — and the POST refuses them
  rather than relying on a hidden button.

#### Gym calendar-first, and the editor's last two pieces (v3.9.0, 2026-08-01)

**Gym Rentals now opens on the month.** The design's two variants were built as
two *separate* screens, with Queue as the default; the spec's default is
Calendar first, and its calendar layout is the month **plus** two panels, not
the month alone.

- **`/gym-rentals` is Calendar first**; `?view=queue` is the other weighting.
  The month is what somebody wants to see before deciding anything; the queue is
  what they act on once they have.
- **Two panels under the month** — *Requests to review* (amber, recurring
  requests first, then holds, each with Approve and Release) and *Invoices*
  (Paid / Unpaid pills, the amount, and the rate it billed at). They are **not**
  a second copy of the queue: the queue is every booking, these are only the
  rows where somebody has to do something.
- **Approving from the panel is not approving blind.** A hold that would
  double-book carries its conflict in the sub-line *and* in the confirm text.
  The panel exists so somebody can act without reading the whole list, which is
  exactly why it cannot hide the one thing that would stop them.
- Month arrows keep whichever layout you are in, rather than always landing on
  the calendar.
- **⚠ The "By organisation" bulk tools are on BOTH layouts now.** They used to
  be hidden in the calendar view, which was harmless while Queue was the
  default and a regression the moment Calendar became it — they carry the
  invoice generation, the price-setting and the Google Calendar push, so
  hiding them on the view everybody lands on would be dropping them in
  everything but name.

**The info card** (`22-page-editor.html` §"The info card") is a **slot on a
banner, not a block** — available on Welcome banner, Page banner and Callout
box, off by default, `Off · Right · Left`.

- **A floating block would mean asking the office to position it**, and refusing
  to ask that is the whole point of this editor. When the card is on, the
  banner becomes two columns and the *text* narrows; the card can never overlap
  the words and is never dragged. A browser test measures the two rectangles
  and asserts they do not intersect.
- **"Card shows" is a short list, not a blank canvas**: Service times · Address
  & directions · Contact · A short list of links · Free text. The first three
  read the church-details record — the same keys the map block and the sidebar
  read — so changing the phone number once changes every card on the site.
  Free text is the only option that asks anybody to type anything.
- **A block without the slot cannot be given a card**, whatever arrives:
  `sanitizeBlock` gates `card` on `def.infoCard`, so a stale tab, a crafted
  POST, or a block type losing the slot all end up with `off` rather than a
  card rendered somewhere unintended.
- **The card's links are their own array** (`cardLinks`). A welcome banner
  already uses `links` for its buttons, and one array doing two jobs is how a
  button ends up inside the card.
- The gold eyebrow is edited **on the page**, like every other text.

**Starters.** `+ New page` now opens a picker — Homepage · Simple text page ·
Ministry page · Sign-up page — instead of creating an untitled page outright.
An empty page is the hardest thing to start from; the office's first question
is always "what goes on it?", and a starter answers it with a page to edit down.
A new page still begins as a **draft**, out of the menu. `starterBlocks(title)`
keeps its old meaning (the ministry starter) so every existing caller is
unchanged; the second argument picks another.

#### Newsletter fields and the editor palette (v3.6.0, 2026-08-01)

**Two of the four "editor spec" items turned out to be already built**, and
saying so is more useful than building them twice:

- **The device switcher exists and is real widths, not a zoom** — `WIDTHS` in
  `admin/ministry-editor.html` is `{desktop: 900, tablet: 620, phone: 390}` and
  `fitPaper()` sets `style.width`. It also scales *down* when the canvas is
  narrower than the chosen width, which is a fit-to-viewport fallback rather
  than the mechanism; with the rails now collapsible it fires less often.
- **The block library was already grouped.** What was wrong is that it led with
  Content; the design leads with **Structure**, because that is what an empty
  page needs first. Groups are now the design's four, in its order:
  `Structure · Content · Dates · Sign up`.

⚠ **The palette's opening tab was the string `'Content'`, written in the editor
state.** Reordering `GROUPS` left the palette opening on the *second* group.
It resolves from the config now (`groups[0].name`), and `test/editor.test.mjs`
already asserted against `GROUPS[0]` — so the test was right and the editor was
wrong, which is the way round you want it.

`admin/blocks.test.mjs` now also asserts every block type appears in **exactly
one** group. A type defined but listed nowhere can be rendered by the engine
and never inserted by a human — the kind of gap nobody notices until somebody
asks for that block.

#### ⚠ AC-3 is fixed: the rich-text field could be escaped from

The newsletter spec asks for "a real toolbar on every rich field, not just the
first". Every field already had one. What the fields did **not** have was safe
escaping, and looking at seven near-identical builders to check that is what
found it.

Saved content is interpolated into an inline `<script>`. All seven builders
escaped backslash, backtick and `$` — and none escaped `</script>`. **The HTML
parser ends a script block at the first `</script` regardless of JavaScript
string context**, so somebody with content-edit rights could save a post
containing it, break out of the init block, and run script in the session of
any admin who later opened that screen. That was AC-3 in the July 2026 review,
open since.

`tinymceField()` in `admin/helpers.js` is now the **one** builder — which is
also AC-10, the reason AC-3 survived: any escaping fix had to be made seven
times. `jsString()` splits the closing tag so the parser never sees it, and
`admin/ui.test.mjs` asserts it directly.

The submit handler that waits for in-flight image uploads and strips leftover
`blob:` images went into the shared builder rather than being lost — it lived
only in the pastor's-note copy but was wired to the whole form, so folding the
builders together without it would have quietly shipped broken images in a
sent newsletter.

#### Per-screen, part two (v3.7.0, 2026-08-01)

- **Sermons' media pill is the design's three words** — `YouTube` / `Audio` /
  `Text only`. It said `No recording` in amber, which dressed a perfectly
  normal state up as a fault: a sermon with no recording is a good text card on
  the site, and adding a link later upgrades it with no other edit. `Text only`
  is neutral-toned for that reason.
- **A pinned news post carries its marker before the title.** The rows already
  sorted pinned-first; the marker's job is to explain why a row is at the top,
  not to help you find it, so it is small and sits where reading starts. The
  old "Pinned to top" sub-line under the *date* answered a question nobody was
  asking there.
- **The newspaper emoji is gone.** "No emoji anywhere in the admin chrome" —
  the fallback icon is a typographic glyph like every other one.
- **The audit log has its read-only drawer.** `renderDrawer({ readOnly: true })`
  is a real option now rather than a regex stripping the save button: no save,
  no delete, and Cancel reads `Close`. Fields use `.tlc-static`, which is a
  **sand fill** — the spec's "never grey out text to signal read-only", because
  grey text reads as broken and a filled field reads as a fact.

#### ⚠ The NFC taps did not answer (fixed v3.7.0, 2026-08-01)

Found while adding the last piece of the Taps screen. The premise of the whole
feature — the design states it as a rule — is:

> The physical tag only ever holds its short address: `/tap1 … /tap4`.
> Re-pointing happens here; nothing is reprogrammed.

**That only holds if the short address resolves, and it did not.** `taps` is
its own table; `/api/redirects`, which `site-worker.js` fetches and caches to
resolve short links, read only the `redirects` table. So the admin let
somebody re-point a tap and the tap 404'd — a tag printed and stuck to a pew
rack would have gone nowhere.

`/api/redirects` now merges both, with a hand-made redirect at the same path
winning so the office can override one without touching the Taps screen. A tap
switched off stops resolving rather than sending people somewhere stale.
`test/admin-redesign.test.mjs` covers all four cases.

**"Taps this month" was not on the cards until v3.10.0** — see below. The
`taps` table had a `scans` column that *nothing had ever written*, and counting
needed the resolution to happen somewhere that could record it.

#### Every edit screen is the redesign now (v3.11.0, 2026-08-01)

Andrew, after clicking Edit on a link card: *"the next page goes to the old
style, this also happened on the news and events when editing a post. and
classes."*

**The list screens were converted and the forms behind them were not.** Every
"+ New" and "Edit" dropped staff out of the redesign and into the previous
admin, mid-task — which reads as two different programs rather than as one.

- **`renderFormSection()` in `admin/ui.js` is the edit form, once** — the same
  field vocabulary as `renderDrawer`, laid out as a page because these forms
  keep their own addresses (a warning row, a redirect after saving and a
  bookmark all point at them). **A form is a config, exactly like a list is.**
- **Converted to configs:** link cards, news posts, Bible classes, sermon
  series, sermons. Each had a New and an Edit that were the same fields written
  twice; they are one builder apiece now.
- **The long tail is restyled, not rewritten.** Ministries, notices, staff,
  users, menu, partners, voters and the giving screens carry things the field
  vocabulary cannot express — three video slots, a banner picker, an event
  repeater. Their own classes are restyled **scoped to `.tlc-wrap`**, so
  changing the wrapper inherits the redesign with the fields and the POST
  handler untouched. Anything still on the old shell keeps the old look rather
  than getting half of each.
- **⚠ Converting a checkbox to a toggle changes how it must be read.** A toggle
  posts a hidden `0` ahead of its checkbox, so `form.get(name)` returns the `0`
  whether or not it is ticked. Christian Ed's `active`, news `pinned` and the
  sermon series `active` all had to move to `getAll(name).includes('1')` in the
  same commit as the form. Getting this wrong silently saves every class as
  paused.
- **⚠ A news post could never be tagged with a value.** The column has existed
  since v3.0.0 and the list filters on it, but no form ever set one — so the
  filter could never match anything. Found while rewriting the form. Same shape
  as the tap counter: a column nothing wrote to.

**Sermons' two actions moved beside the primary button.** They were in the
topbar, which put "add a series" further from the list it adds to than the sign
out link. `renderListSection` takes `altActions` now — quiet siblings, so the
one blue button still leads.

**The arrows are gone.** 90 of them, across the admin and the emails: `Save →`,
`View page →`, `Publish →`. Arrows that are genuinely a separator — `Settings →
Bookkeeper email`, `hold → confirmed`, the audit log's before/after — are left,
because those are sentences rather than decoration.

#### A fourth and fifth newsletter note (v3.11.0, 2026-08-01)

The pastor's note, a secondary and a tertiary were the three free-form blocks
an issue could carry. `newsletters.extra_notes` adds more.

- **JSON, not more columns.** How many notes an issue carries is a property of
  the issue, not of the schema — a week needing three extras should not need a
  migration. `parseExtras` / `extrasFromForm` / `serializeExtras` in
  `admin/newsletter.js`, pure and tested.
- **A note with no body is not a note**, dropped at parse rather than at render,
  so a slot somebody opened and thought better of never reaches the email, the
  preview or the archive. Blank slots collapse, so filling the third box
  without the second leaves no hole.
- **All the slots are rendered and the unused ones hidden**; "+ Add another
  note" reveals the next. Creating a TinyMCE instance on click would be a second
  way for a rich field to exist, and that is how one ends up behaving
  differently from the rest.
- **A heading is escaped.** It is typed by staff and lands in six hundred
  inboxes. `email.js` gained a local `esc` for short plain-text fields — a step
  toward AC-2, not the whole sweep.

#### The taps are counted (v3.10.0, 2026-08-01)

`admin/taps.js` holds the rules, pure and tested; the counting itself is split
across the two Workers because that is where the two halves of the problem are.

- **A tap resolves in `site-worker.js`, which cannot reach D1.** So it tells the
  admin Worker — `POST /api/tap-hit` — and **does not wait for the answer**. The
  302 is returned first and the beacon rides on `ctx.waitUntil`.
- **⚠ Nothing about counting may sit in the visitor's path.** A tag is stuck to
  a pew rack; the number is a nice-to-have. That is why this is a beacon rather
  than a second redirect hop through the admin: the cached list is what keeps a
  tag working through an admin outage, and a count is not worth trading that
  for. `/api/tap-hit` always answers 200 for the same reason — a malformed body
  or an unknown id must never come back as something that looks like the tap
  itself failing. `test/site-taps.test.mjs` asserts the tag still resolves with
  the counting endpoint throwing, and with no `ExecutionContext` at all.
- **The filter is about machines, not malice.** A crawler walking /tap1…/tap4 or
  a browser prefetching a link is what would actually make this number a lie —
  not somebody attacking a church's tap counter. So `countsAsTap()` drops
  prefetches (`Sec-Purpose` / `Purpose` / `X-Moz`), known bots, and requests
  with no user-agent, and there is **no shared secret to configure**: a feature
  that silently does nothing until somebody sets a Worker secret is a feature
  that silently does nothing. The copy in `site-worker.js` must stay in step
  with the tested one in `admin/taps.js`.
- **Only a tap that resolved is counted**, so a mistyped `/tap9` or a
  switched-off tag never shows up as usage. Ids are validated against the rows
  that exist — the id *is* the printed address, not a sequence to extend.
- **`tap_hits` is one row per tap per day.** `taps.scans` is the lifetime total
  and cannot answer "this month"; one row per hit would answer everything and
  grow without bound for a number nobody will slice that finely. Four taps ×
  365 days is 1,460 rows a year and the write is a single upsert. Buckets older
  than 400 days are pruned **when somebody opens the screen** — often enough for
  four rows a day, and it cannot quietly stop the way a cron trigger can.
- **⚠ A tap that has never been counted says "Not counted yet", not "0".** This
  is the same trap that kept the number off the card in the first place,
  surviving the fix by one deploy: counting starts when this ships, so the next
  morning every tap would have read "0 taps this month" — indistinguishable from
  "the tags are broken", and worth somebody checking four tags that are fine.
  Once there is a lifetime total, a real zero is worth reporting as zero.

Run: `node admin/taps.test.mjs`, `node test/site-taps.test.mjs`.

#### A card can be a sign-up form (v4.1.0, 2026-08-02)

Andrew: *"on the taps we had before a form option for one of the cards. can you
add that in"*. The newsletter sign-up card **was** on the links page — but it
was hardcoded in `tlc-links-worker.js`, below the loop that renders the
admin-managed cards. So it showed on every tap whatever the office did, its
words could not be edited, and there was no way to add a second one or to take
it off a tap where it did not belong.

`link_cards.kind` is `link` (the default, and what every existing row already
was) or `signup`.

- **The kind decides whether there is an address, so it is asked first.** A
  sign-up card is a form the visitor fills in on the page — it has nowhere to
  go. The URL field is therefore **not** marked `required`: a browser refusing
  to submit would read as the screen being broken. The rule lives in the POST
  handler, which skips the address check for a sign-up card and still refuses
  an unsafe one on a link card. Both directions are tested — relaxing it for
  the kind that has no address is not the same as removing it.
- **The seed runs once, behind `SIGNUP_CARD_MARKER`**, exactly like the v3.0.0
  permission rename and for the same reason: the schema block re-runs on every
  `SCHEMA_VERSION` bump, and a seed in there would bring back a card the office
  had deleted on purpose. A test deletes it and asserts it stays gone.
- **The sign-up markup moved into `renderSignupCard()`** and the page's script
  is delegated off `.signup-card`. It used to be wired to fixed ids, which was
  fine while the block appeared exactly once and would have worked on the first
  card and silently done nothing on a second. The header is a `div`, so Enter
  and Space are wired by hand — without that it is reachable by Tab and does
  nothing.
- **The fallback carries the form too.** `FALLBACK_CARDS_HTML` is what a
  visitor sees when the admin API is unreachable, and a page that quietly drops
  its sign-up form during an outage is worse than one that shows a stale copy.
- The list's address column reads `Sign-up form` rather than sitting empty —
  a blank cell reads as a card somebody forgot to finish.

⚠ **Only the newsletter sign-up exists as a form kind.** Connect card and
prayer request are real forms elsewhere on the site but they post to ChMS with
their own screening; adding them here would be a second, unscreened way in. If
they are ever wanted, they go through `screenSubmission()` like the rest.

#### Half blocks flow, they do not sit in rows (v4.10.0, 2026-08-02)

Andrew, with a screenshot: *"if a half block width colum goes long lets make
the others match it to fill in teh space... the current series could go up to
fill that in next to the map block and under news"*.

A 450px map beside a 150px news list, then **300px of nothing** before the next
block. That hole is what the spec's own rule produced — *"a third consecutive
Half starts a new row"* — because a two-cell grid puts blocks in fixed rows and
the next block starts below **both**.

- **A run of consecutive halves is now one two-column flow**, and the browser
  balances it by height, so whatever comes next fills the shorter side. In the
  screenshot's case, Current series moves up beside the map and under News.
- **⚠ `column-count`, not a grid.** A grid cannot do this: rows are rows. Real
  columns balance. `break-inside:avoid` is what stops a card being sliced
  through the middle at the column boundary.
- **A full-width block ends the run**, so the halves after it start a new one.
  That is the only way to force a break, and it is the one the office already
  understands.
- **This is a deliberate departure from the spec.** The rule it replaces is the
  cause of the defect. Recorded here so the side-by-side pass reads it as a
  decision.
- The editor rail brackets the **whole run** now rather than pairs, walked the
  same way the renderer walks it — the rail must never draw a grouping the page
  does not honour.

⚠ **A tall block still decides the layout.** Two halves whose content differs
wildly in length will not look like a tidy two-up; they will look like a tall
thing beside a short thing with the next block tucked under it. That is the
point, but it means reordering blocks changes the shape of the page more than
it used to.

#### The renter portal follows the brand, and the calendar stops saying it twice (v4.9.0, 2026-08-02)

Tasks 17b and 18. The portal keeping its own `:root` was right and still is — a
renter must never get the admin sidebar, the context bar or the ⌘K chip. But
*"not an admin screen"* had been read as *"not styled"*, and those are different
things.

- **It wears the public site's moss masthead now** — logo, "from our
  Neighborhood to the Nations", the gold rule — so it reads as
  `timothystl.org/worship` rather than as nothing in particular. The three
  stacked boxes (brand, title, rate strip) are one block: what this is, whose it
  is, what it costs.
- **The insurance notice moved to the confirm step.** It was the first thing on
  the page: an obligation that comes *after* booking, put above the calendar, so
  a renter had to take in a compliance requirement before finding out whether
  their date was even free.
- **The calendar encoded availability twice, in colour only** — a red numeral
  *and* a red dot. Red numerals read as errors, the dot was redundant, and
  colour alone fails for anyone who cannot separate the two hues. Available days
  are a navy numeral in an outlined cell that raises on hover; unavailable days
  are the numeral alone in grey, no cell, not clickable. **Absence of affordance
  is the signal**, so the legend is gone too.
- **⚠ The client repainted every dot green or red in two places**, which would
  have undone that redraw the first time anybody pressed Clear. Both aligned.
  The hour-slot buttons *inside* a day still use red for a taken hour — a
  different control, not covered by this.
- **"Request this booking", not "Submit".** The office prices and approves it,
  and saying so is the difference between a renter expecting a booking and
  expecting an invoice.

**⚠ Two items of Task 18 are deliberately NOT done.** The per-row ✕ on the
request basket, and a phone-first redraw at 390px. Both are a genuine redesign
of a flow with real money and real bookings behind it — the same call as the
giving page in Phase 7: a deliberate change with somebody watching, not folded
into the end of a pass. `FIXES.md` says exactly what is missing.

#### ⚠ `node --check` does not catch a broken module (v4.9.0, 2026-08-02)

Hit three times in one session, and the third time proved the CI step was not
doing its job. **`node --check` parses these files as CommonJS scripts.** Most
of the CSS and client-side JS in this repo lives inside template literals, and a
stray backtick in one — a comment quoting `flex:1`, or a UI label — terminates
the literal and breaks the *module* while still parsing fine as a script.
Verified: `--check` passed on a `gym.js` that could not be imported at all.

CI now imports every `admin/*.js` for real, as ESM, right after the syntax
check. Those modules are declarations and config objects at the top level, so
importing them runs nothing.

The rule for these files: **describe a label in a comment; do not quote one, and
never use a backtick.**

#### Forms have a width again, and three rulings land (v4.8.0, 2026-08-02)

Andrew: *"there should be a max width, 1900px is too wide"*. That is FIXES
Task 19's general rule, and he is describing the exact symptom it names.

- **The cap is on the field column and nothing else.** 640 single column, 920
  for a form that needs the room. The heading, the purpose line and any table
  or list stay full width — a form is hard to read wide, a table is hard to
  read narrow, and they are different problems. Task 2 dropped
  `.wrap{max-width:860px}` because that narrow column was a symptom of the
  missing sidebar; right for lists, wrong for forms.
- **`wide` meant `max-width:none`** — the 1900px this rule exists to stop. It
  is 920 now, the spec's own second number. Its two callers (the sermon note
  and the news post) are single-column forms carrying a rich-text body, which
  is what wants the width, not a second column.
- **The ~29 hand-written forms are reached without touching a route**, because
  they are all `.tlc-wrap > .card > .form-group`. ⚠ `:not(:has(table))` is
  load-bearing: a few cards hold both fields and a table — the gym invoice view
  is one — and squeezing those to 640 would fix the form by breaking the table
  beside it.
- The button row stays uncapped on purpose: it is `display:flex` with no
  `justify-content`, so its buttons already begin at the left edge of the field
  column, which is where the spec wants them.
- **Measured, not asserted as strings.** `test/shell-layout.test.mjs` drives
  1900px and checks all five outcomes, because at 1280px a capped form and an
  uncapped one are not obviously different — which is how this went unnoticed.

**Warning rows moved above their row** (Ruling 1 — the last ruling not in the
code). The eye should hit the problem before the thing with the problem. The
seam moved from `border-top` to `border-bottom`, since above its row the seam
belongs on the *bottom* edge; `border-top` joined the band to the row above,
which is a different row. The ▲ is problem red now rather than the same amber
as the text — it was the least visible thing in the band. ⚠ The old test only
asserted the class existed, which is how the README's "grows a warning row
beneath it" survived against the screenshots for four releases; it now pins the
band as the **first child** of the row wrapper.

**Connect is gone from the context bar** and every `↗` on a link with it (Task
12b/c). ⚠ **One `↗` is left, deliberately** — `tlc-admin-worker.js:5482`, the
Pages list's leading row marker and the sibling of `⌂` for the homepage. It is
not a link, so no link text makes it redundant; strip it and an outbound page
is the only row with no marker. If that is wrong, `⌂` goes with it.

**Task 12a needed no change.** `setRail()` only collapses on an explicit `'0'`
in `localStorage`, so absent means open and a first visit shows both rails. The
walkthrough was reading a persisted choice, not a default.

#### The design handoff is in the repo now (v4.7.0, 2026-08-02)

`design_handoff_admin_overhaul/` is **committed**. This file has referenced it
by path since v3.0.0 — `FIXES.md`, `screens/00-foundations.html`, the
screenshots — and none of it was ever in the repo, so every session read
confident references to files it could not open. That is not a small tax: a
whole session went by unable to answer "what were those open questions?"
because the answers were in a file only Andrew had.

7.3MB, most of it `screens/`. Worth it once.

⚠ **The handoff's own `REDESIGN-STATUS.md` is replaced by a pointer.** The live
inventory is `admin/REDESIGN-STATUS.md`, which is what Task 0 names as its
deliverable. Two copies of a status table are two answers to "is this done
yet", and the archived one was already stale on arrival.

#### The shell is two flex columns, and the sidebar stopped overlapping itself (v4.7.0, 2026-08-02)

Andrew: *"sidebar has strange overlapping and duplication it seems"*, with a
screenshot of the footer painted across the middle of the nav.

- **`.sidebar-groups` had `flex:1;min-height:0` and no `overflow-y`**, while
  `.sidebar` carried `overflow-y:auto`. Every declaration was fine alone.
  Together the group list was squashed to the leftover flex height and its
  twenty-odd rows painted straight out of the box, so the footer landed on top
  of Filtered Mail with the groups continuing underneath. The nesting has to be
  **sidebar clips, list scrolls, footer pinned below** — and `margin-top:auto`
  comes off the footer in the same change, because the list is `flex:1` and
  already eats the free space. Two mechanisms for one job disagree exactly when
  the content overflows, which is when it shows.
- **⚠ The hamburger had been invisible since v4.6.0.**
  `.sidebar-toggle{display:none}` was declared *below* the `max-width:900px`
  block at identical specificity, so source order decided and it won at every
  width. A media query does not outrank anything; it only narrows when a rule
  applies. **That is three consecutive releases shipping an admin with no
  mobile navigation, by a different mechanism each time** — off-canvas with no
  handler, handler with no markup, and now a button styled out of existence.
  All three passed a CSS grep.
- **So `test/shell-layout.test.mjs` measures instead of matching.** It asks
  `elementFromPoint` what is painted over the footer and it *clicks* the
  hamburger. Verified against the bug: the original CSS was reintroduced and the
  suite fails. The load-bearing assertion is "the sidebar itself does not
  scroll" — the paint check stayed green under the new shell, and the file says
  so rather than implying the overlap check is what protects this.
- **The flex shell is Task 2 item 2**, which was never done: it was a fixed rail
  plus a matching body padding, so the width was written twice. `--tlc-rail`
  once now, in the shell's only `:root`, and `.tlc-main` takes what is left.
  `min-width:0` is not decoration — without it a wide table refuses to shrink
  and pushes the column off screen. Below 900px the rail goes `position:fixed`,
  **not `sticky`**: a sticky element keeps its place in the flex row, so the
  content would hold a 228px gap for a rail that is off-canvas.

⚠ **CSS comments in `admin/helpers.js` live inside a JS template literal and
ship to the browser.** A backtick in one terminates the literal. A comment
quoting a UI label verbatim puts a second copy of that string into every admin
page — which is how the assertion that the sign-out link appears exactly once
began failing on a CSS-only change. Describe a label in these comments; do not
quote one.

#### A value is not a status (v4.7.0, 2026-08-02)

Andrew: *"pick the colors you want that are all different, it doesnt matter"*.

Acceptance's tint was `#EDF0E4` — byte-identical to the `good` status tone — and
Outreach's was `#FAF0DC`, the `warn` tone. On Ministries those columns are
adjacent, so one pale green chip meant "this page is live" and the chip beside
it meant "tagged Acceptance". Each palette was internally correct; only together
were they wrong, which is why `admin/values.test.mjs` lives in neither file and
reads both.

- **The fix is a rule, not four replacement hexes**, because a rule survives
  somebody adding a sixth status tone: **a status tone is pale and low-chroma, a
  value tint is saturated.** Status is a state a row passes through; a value is
  what the row *is*.
- Hues are the church's own — moss, navy, teal, plum — spaced so no two tints
  are within 20 on any channel. The suite asserts the chroma rule, the
  separation, non-collision with the tones *and* with the selected-chip fill,
  4.5:1 ink-on-tint, and 3:1 for the `solid` border.
- ⚠ This deviates from the fix list's governing rule (*"do not invent values"*).
  Andrew overrode it explicitly. Flagged here so the designer's side-by-side
  pass reads it as a decision rather than a drift.

#### Task 15's five routes, answered (v4.7.0, 2026-08-02)

Andrew: *"do whatever you need here to make it future proof."* Each was checked
against the code, and **two of the five have false premises** — see
`admin/REDESIGN-STATUS.md` for the table. In short: there is no user drawer
(`renderDrawer` is never called on `/users`), and `/pages/details` is the church
details record, not a duplicate of the page drawer at `/pages/:id/details`. Both
questions describe a record editable two ways, which is the defect the task
exists to find, and neither is real. `/youth` and `/youth/` are 302s rather than
screens, which moves the count to **38 pattern / 29 converted / 7 n/a**.

Still genuinely open from that task: `/ministries/:slug/posts` wants a
`sections.js` entry, and `/notices/add` should fold into `/notices/edit/`.

#### The renter portal moved off the admin origin (v4.6.0, 2026-08-02)

Andrew, looking at a portal link: *"why is it going to the admin.timothystl.org
domain, i think that exposes the admin portal"*. He was right, and the reason is
stronger than exposure.

The gym booking portal is the one page in this Worker that **renders
renter-supplied content and is handed to people outside the church**. Served on
the admin origin it was same-origin with the admin — and same-origin is the
whole boundary: the admin CSP allows `'unsafe-inline'`, and the Origin gate
cannot tell a portal script from an admin one. So an injection in the portal
(GY-2 was exactly that, escaped in v3.8.0) could `fetch('/users/new', …)` with a
signed-in admin's session and be accepted. On the public site origin, the worst
a portal bug can do happens where nobody is signed in to anything.

- **`gym_portal_origin` is a setting, and blank is the safe default.** Code
  deploys before somebody adds a Cloudflare route, and redirecting to a host
  that is not serving yet would send every renter to the homepage — with a
  **200**, because the site is a single-page app, so it would not even look
  like an error. Until it is set, everything behaves as it did.
- **Two manual steps, in this order** — **both done 2026-08-02, the portal is
  live on `timothystl.org`**: add the Cloudflare route
  `timothystl.org/gym/*` → `tlc-newsletter-admin` (more specific than
  `timothystl.org/*`, so it wins over the site worker), *then* set the setting
  on the Gym rental settings screen. Routes are **not** in `wrangler.toml` and
  must not be added there — Wrangler would take over route management for this
  Worker and could drop `admin.timothystl.org`. Verified against production:
  the admin path 301s, `timothystl.org/gym/*` serves the portal rather than the
  SPA homepage, the iCal feed 301s with it, a portal POST passes the CSRF gate,
  and an admin POST carrying the portal's Origin is still refused.
- **⚠ The CSRF gate had to learn about it.** A portal form posts from the
  portal's origin, so the admin's `Origin === ADMIN_ORIGIN` check would have
  403'd the entire booking flow the moment the portal moved — a hold, a
  release, a confirmation, all of it, reading as "the portal is broken" with
  nothing to go on. The portal origin is accepted **for portal paths only**; a
  test asserts an admin POST from it is still refused.
- **⚠ The iCal feed moves with it.** `/gym/cal/:token.ics` is subscribed inside
  people's calendar apps; without the 301 their calendar would simply stop
  updating, with no error anywhere.
- **The copyable link is built from the setting, not `url.origin`.** Otherwise
  every group created from the admin keeps handing out the admin domain and the
  move is undone one group at a time.

#### The slide-over is back, with its handler this time (v4.6.0, 2026-08-02)

Andrew's call on the open ruling: *"write the handler"*. Task 2 item 3 allows a
slide-over below 900px; the definition of done's grep forbade the strings. The
grep was aimed at the *desktop* hamburger, which is what the design rejected —
so below 900px it slides over again, and above it the sidebar is simply on
screen.

**⚠ The CSS and `SIDEBAR_JS` cannot ship apart.** The v4.0.0 pass deleted the
handler and kept the CSS, which is how the admin ended up with no navigation at
all on a phone. Both suites now assert the markup *and* the handler, not just
the CSS. Escape closes it, the backdrop closes it, following a link closes it,
and widening past 900px resets `aria-expanded` so the button never lies to a
screen reader.

#### The fix list, read line by line (v4.5.0, 2026-08-02)

A fourth pass over `FIXES.md`, checking every sub-item rather than every task.
Five things had been marked done at the task level while a line inside them was
never carried out.

- **⚠ `.tlcb-card` was declared twice, with the same selector.** The banner
  info card (v3.9.0) took the class the **card-grid block's tiles** already
  used, and the later rule wins — so every tile in a card grid rendered as a
  big white 18-radius panel with the info card's drop shadow. Both are
  qualified now (`.tlcb-cards .tlcb-card` and `aside.tlcb-card`) so neither can
  catch the other. This is why one renderer is worth having and why two rules
  for one class is worth grepping for.
- **`.filter-pill` was still the pre-redesign 999px navy pill.** Task 1 rules
  that out in as many words and gives the replacement values; the primitive had
  simply been missed while everything around it was converted. A filled navy
  chip reads as the primary action on the screen, and a filter is not that.
- **The alert stripe was still there.** Task 1 asks for the 3px left accent
  gone: it is a fifth way of saying "important" on a surface that already
  carries a tone, and it made an alert read as a different kind of object from
  every other card. Alerts are card geometry and the four tones now.
- **Gym document titles were still Title Case** — the `<h1>`s had been
  converted and the `<title>`s had not, so the browser tab and every bookmark
  still read "Gym Rental Settings". The renter portal's own title is left
  alone; it is not an admin screen.
- **The `sections.test.mjs` cases Tasks 4 and 7 both asked for did not exist.**
  Both say to add them in as many words. The point of a case there is that the
  strings live in the config — a route typing its own title is exactly what
  that file exists to catch. Filtered Mail's columns and widths are pinned to
  the fix list's own values, since it is the one screen with no spec file.

#### The last two fix-list items (v4.4.0, 2026-08-02)

**The payroll period lock exists now, and it is server-side.** Task 5 asks to
"confirm the period lock is enforced server-side, not by hiding the button".
There was no lock at all — approving recorded a row in `payroll_periods` and
nothing stopped the hours changing underneath it, so the signature was on
nothing.

- **`payrollPeriodLocked()` guards the `/sb` proxy**, scoped to
  `church_staff_period_entries`. A stale tab, a second window and a crafted
  POST all arrive at that line; the greyed inputs on the screen are a courtesy
  so nobody types a figure that is going to be refused.
- **Rates are deliberately NOT locked.** They live on `church_staff` and are
  not period-scoped, so locking them would stop the office fixing a rate for a
  run they have not done yet. Nor is `payroll_periods` itself — taking the
  approval back has to stay possible or the lock is a trap. Both are tested.
- **⚠ It fails CLOSED.** An unreadable period, an unreachable Supabase or an
  unparseable body all refuse. A refusal costs a retry and says so on screen;
  the other way round silently rewrites figures somebody has signed.
- It reuses the caller's own `apikey`/`Authorization` — this Worker holds no
  Supabase credentials of its own. Same credentials, same authority, one extra
  read.
- **⚠ `duplex: 'half'` on the proxied request.** The fetch spec requires it for
  a stream body; Workers ignores it, Node enforces it. Without it the proxy
  threw the instant a test drove a POST through — which is how it went
  untested until this needed covering.

**The radii sweep only ever looked at one file.** Task 1 names 8 / 9 / 11–12 /
999 as the legal set. `admin/ui.test.mjs` checked `helpers.js` alone, so
`admin/ui.js` — the design system every redesigned screen is built from —
drifted to 5, 6, 7, 10, 13 and 14 without a word. A rule enforced on one of two
files is not enforced; both are checked now, and the gym's own admin calendar
block was swept too. 3px survives on marks under 12px square (a legend swatch,
and the nav elbow Foundations itself specifies as `0 0 0 3px`) — they are
marks, not components, and rounding them to 8 would make them circles.

#### The sidebar folds, and the slide-over is really gone (v4.3.0, 2026-08-02)

Andrew: *"on the pages sidebar, the sub levels are always open, can those go
minimized when not open?"*

- **What is under Pages folds away unless you are in it.** Five rows
  permanently under Pages pushed the four groups below them down the sidebar
  and read as one flat list of ten — the opposite of what nesting them was for.
- **⚠ Which way it starts is decided server-side.** `inPages` in
  `sidebarShell()` renders the panel open or `hidden`; `SIDEBAR_JS` only ever
  responds to a click. A sidebar that redraws itself after paint is one whose
  rows move under the pointer, and clicking the nav is the first thing anybody
  does on a page.
- **The remembered choice is an override of where you are, never the reverse.**
  `data-here` marks a panel the server opened because the active screen is
  inside it, and that always wins — the rows you are using cannot be the ones
  folded away.
- **The caret is a button beside the link, not the row.** Pages is a screen
  somebody wants to open; making the row double as a toggle would put one of
  the two things you can want from it out of reach.

**The Email group is "Communication" again** — Andrew's call, 2026-08-02. It
holds the newsletter, the subscriber list and held mail, which is more than the
word Email covers; the other four keep the design's names. `GROUPS` in
`admin/helpers.js` is the one place a group is named. It was typed twice — the
sidebar heading and the context bar's trail — so a rename could reach one and
not the other, leaving the nav and the breadcrumb disagreeing about where you
are. ⚠ The names are stored **raw** and escaped at both render sites: the trail
already ran its copy through `escapeHtml` while the sidebar had `&amp;` typed
into the markup, so one constant holding the entity would print
`Money &amp;amp; Building` in the bar. A test asserts it does not.

**And the slide-over is deleted.** `FIXES.md`'s definition of done asks that
`util-bar|sidebar-toggle|sidebar-backdrop|translateX(-100%)` return nothing —
the design considered the hamburger and rejected it. The v4.0.0 pass removed
the *handler* and left the *markup*, so below 900px the sidebar sat off-canvas
with a hamburger that did nothing: **the admin had no navigation at all on a
phone.** Restoring the button would have been fixing the symptom of a pattern
the design had already thrown out. Below 900px the sidebar is now
`position:static` above the content, scrolled past like anything else — visible,
which is the whole point, without stealing 228px of a 390px screen. Both test
suites assert all four strings are absent.

#### Each tap serves its own cards (v4.2.0, 2026-08-02)

`link_cards.tap` had existed since v3.x and the admin let you move a card
between taps — but the public API never returned the column and the links
worker served the same page at every address, so "Move to /tap2" changed
nothing a visitor could see. Andrew: *"yes wire up the taps so each one shows
its own cards"*.

- **The address is the only configuration.** `tapForRequest()` in
  `tlc-links-worker.js` matches the request's host and path against each tap's
  `destination` — the field the office already fills in on the Re-point form.
  Nothing is set twice, so re-pointing a tap moves its cards with it and the
  two Workers cannot drift. Trailing slashes and case are ignored: these are
  addresses printed on cards and said out loud.
- **A card with no tap shows behind all of them**, which is what every card
  was before taps existed — so nothing had to be reassigned for this to be
  correct on the day it shipped.
- **An unclaimed address falls back to the root tap**, not to an empty page. A
  mistyped or forwarded URL should still be the church's links.
- **`/api/link-cards` returns `taps` alongside `cards`.** One response, one
  cache entry, filtered per-request in the links worker — so every tap's page
  shares the same cached subrequest.
- **When the admin cannot be read, every built-in card is served.** A tap
  showing the wrong set for a minute beats one that comes up empty in
  somebody's hand.
- **⚠ Tap 3 lands on `give.timothystl.org`, a different Worker.** Cards
  assigned to it can never appear anywhere. The Taps screen says so on that
  tap's own card, and names how many cards are going unseen — assigning one and
  seeing nothing happen otherwise reads as the admin being broken.
  `LINKS_HOST_RE` in `tlc-admin-worker.js` is the one place that address is
  described.

Run: `node test/links-page.test.mjs` (also in CI).

#### Payroll: a salaried person has no PTO column (v4.2.0, 2026-08-02)

Andrew: *"on payroll salaried staff should not have a pto column"*. PTO is an
hourly idea — a salaried person is paid the same whether or not they take the
day off, so hours "used" against them cost nothing, and a number in that column
adding into the period's PTO total says the run was affected by something that
never touched it. The Hours column already read `n/a` for a salaried person;
PTO now does the same, through one predicate (`takesPto`).

- **The entry screen drops the input entirely for a salaried church person.**
  With no inputs on the row, `doHoursSave` is never triggered for them, so
  anything already stored is left alone rather than overwritten with zero. That
  is deliberate: switching somebody back to hourly restores what was there.
- **`reportGroups` zeroes it at the source**, so a group's PTO total is right
  whatever a salaried person may still have stored against them.
- **The CSV and the emailed report read `n/a`, not `0.00`.** A zero in a
  spreadsheet reads as "took none", which is a different claim from "the column
  does not apply" — so the email payload carries `salaried` rather than letting
  the Worker infer it from the numbers.

#### Four security fixes from the July review (v3.8.0, 2026-08-01)

**VS-2 — the Worship Schedule Builder was public.** `public/scheduler.html`
was served by the site worker to anybody who typed
`timothystl.org/scheduler.html`: the whole staff tool, no login. Andrew's call
was *"lock scheduler behind login"*, so the file moved to `admin/` and is
served at `admin.timothystl.org/scheduler`, below the session gate.

The old address 302s to the new one. That redirect is not decoration:
`wrangler-site.toml` sets `not_found_handling = "single-page-application"`, so
a missing path returns `index.html` with a **200** rather than a 404 — without
the redirect, the old address would quietly answer with the homepage and look
like it still worked.

⚠ **It is also dead code.** The only endpoint it talks to,
`/admin/api/scheduler/data`, does not exist anywhere in this repo, so it can
neither load nor save. It was locked rather than deleted because that is what
was asked, and because the schedules it once held may still be wanted. Staff
are pointed at `connect.timothystl.org` for real scheduling.

**AW-1 — stack traces to strangers.** The top-level catch returned `e.stack`
to every caller. Its comment said "admin portal is staff-only", but the same
handler wraps the login page and the public `/api/contact`, `/api/prayer` and
`/api/subscribe` endpoints. It now returns a short reference and logs the
detail; a test asserts the message never reaches the response body.

**AC-1 — `Secure` on the session cookie.** Added to the clearing header too:
a browser will not overwrite a Secure cookie with a non-Secure one, so signing
out has to match or the cookie survives the sign-out.

**GY-2 — renter notes in the office's session.** `notes` is typed by a renter
in the public booking portal and was interpolated unescaped into the recurring-
review page and two staff emails. All three escape now.

`group.name` / `contact` / `email` are still interpolated unescaped in the gym
portal's own markup. Those are **office-entered** — `gym_groups` is writable
only through `/gym-rentals/groups/update/`, behind `gym_manage` — so it is
defence-in-depth against a typo, not an attack path, and a mass edit across a
hundred call sites was the riskier change. Left deliberately, noted here.

#### The handoff's own open questions (§8), as answered

Andrew answered these on 2026-08-01. They gate later phases, so they are
recorded here rather than left in the handoff.

1. **Pay rates** — church staff rates are entered by hand and saved; MDO pay
   comes from the MDO app. See "Where a pay rate comes from" under Payroll &
   Supabase below. **No code change needed — the current design already does
   this.**
2. **A second `newsletter_approve` holder** — Andrew is creating the account.
   Phase 5's two-person send depends on it, and the permission key is
   unchanged by the v3.0.0 rename, so the account can be made from the Users
   tab today. Until a second person holds it, the approval step has only one
   possible approver and is effectively a formality.
3. **Gym Rentals layout** — answered 2026-08-01: **both, behind a toggle**.
   See "Phase 7 (part)" above.
4. **Dashboard layouts** — answered by shipping: both, behind a toggle.
5. **CFNA / Concordia newsletter blocks** — still open, and it only matters
   once Phase 5 starts.

#### Tests

`node admin/ui.test.mjs` (renderers, count scoping, tone clamping, toggles
posting a 0), `node admin/auth.test.mjs` (the rename, and its non-idempotence),
`node test/list-section.test.mjs` (the shared pattern in a browser), and
`node --experimental-loader ./test/html-loader.mjs test/admin-redesign.test.mjs`
— which boots the **real Worker** against `node:sqlite` behind a D1 shim and
requests every redesigned screen, once seeded and once against empty tables.
`test/html-loader.mjs` is what makes the Worker importable in Node at all (it
uses Wrangler's `import … from './x.html'` text-module syntax).

`test/ministries-list.test.mjs` was deleted — it lifted the old bespoke
Ministries table out of the Worker source. `test/list-section.test.mjs` replaces
it and covers all twenty sections instead of one. The shared pattern has **no
sort control**; each section states its own order.

### Site Editor (added 2026-07-31)

The block editor extended from ministry pages to **every page on the site**,
built from the design handoff in `design_handoff_site_editor/`. Same block
engine, same single renderer (`admin/blocks.js`), same guardrails — what is new
is that a page is now a database row rather than hardcoded markup, and the
navigation is generated from those rows.

- **`pages`** (id, title, menu_label, slug, parent_id, sort, template, status,
  in_menu, locked, seo_description, blocks, published_blocks, publish_at,
  change_log, updated_at/by), plus **`page_redirects`** (renaming a page 301s
  the old address — named that way because `redirects` already holds the
  admin's own short links) and **`page_revisions`** (one row per publish).
- **Page layouts** — `home` / `standard` / `section` / `sidebar`, in
  `TEMPLATES` in `admin/blocks.js`. `wrapTemplate()` owns the wrapper and
  nothing else, so switching layout can never drop a block. `section` appends
  the automatic child-page list; `sidebar` fills its aside from site settings.
- **Self-filling blocks** (sermon, news, staff, service times, map) read from
  `ctx.data`, never from the block. `pageData()` in `tlc-admin-worker.js` is one
  query bundle per request, keyed on the request's `ExecutionContext` — *not* on
  `env`, which is shared across an isolate and would serve stale data.
- **`admin/site-pages.js` is generated** by `tools/extract-pages.mjs` (which
  also regenerates `admin/page-seeds.js`, and takes `--dry-run`). Do not
  hand-edit it. Block ids are derived from the page, so re-running produces a
  diff only when the content actually changed.
- **Seeds land in the draft, never in `published_blocks`.** A page with nothing
  published renders its hardcoded markup in `public/index.html` exactly as
  before. That fallback is what makes the conversion page-by-page and what keeps
  the site working when the admin is unreachable — both covered by tests.
- **`GET /api/pages`** returns the menu, the rendered HTML of every published
  page, and the rename redirects, with the stylesheet shipped once. The public
  nav is built from it (`buildNav()` in `public/index.html`); the hardcoded nav
  in the markup is the fallback.
- **`admin/pages.js`** holds the page-tree rules as pure functions —
  draft-vs-live, list order, filters, `slugify`/`uniqueSlug`/`pageRename`. A
  page reads as a draft when `blocks ≠ published_blocks` **or** `status='draft'`;
  never from a session's change log, or the list and the editor topbar disagree.
- **One editor, two mounts.** `admin/ministry-editor.html` serves both
  `/ministries/editor/:slug` and `/pages/:id/edit`; it works out from its own
  address which API to talk to (`/ministries/api` vs `/pages/api`). The routes
  that do not care which table the page lives in — media, saved sections,
  new-block, render — are one implementation in `sharedEditorApi()`.
- **Two roles.** `site_pages` is office staff — every page, the menu, the
  church details. `site_pages_own` is a ministry leader: they see only the
  pages whose `pages.owner_username` is theirs, can edit the content, and
  cannot rename, move, create or delete. Enforced in the route, not the UI.
- **Locked blocks** (`locked` on the block) are the site's design rather than
  the page's content: marked `🔒` in the rail, and a `site_pages_own` save that
  drops one is refused server-side. The office sets the flag from the Block tab.
- **Church details** live in `site_settings` under `church_*`, edited at
  `/pages/details`. The map block, the service-times block, the `sidebar`
  layout and the public footer all read that one record.
- **Every stored image is under 1MB.** `shrink()` walks down quality, then the
  dimension, until it fits; the media POST checks the R2 object independently.
- Below **1240px** the open pages rail must float *over* the canvas. As a flex
  column the four columns exceed the viewport and the inspector is pushed
  off-screen with no way to reach it.

### News & Events Data Model
```sql
CREATE TABLE news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,           -- short text shown on card
  body TEXT,              -- full content shown on "Read More"
  image_url TEXT,
  publish_date TEXT,
  expire_date TEXT,       -- auto-hide after this date (default: 90 days out)
  pinned INTEGER DEFAULT 0
);
```

### Youth Pages Data Model
```sql
CREATE TABLE youth_pages (
  slug TEXT PRIMARY KEY,  -- 'youth', 'sundayschool', 'vbs', etc.
  title TEXT NOT NULL,
  content TEXT,           -- HTML from WYSIWYG editor
  updated_at TEXT
);
```

### Gym Rentals Data Model
```sql
CREATE TABLE gym_groups (id, name, contact, email, phone, notes, access_token, max_active_holds, active);
CREATE TABLE gym_bookings (id, group_id, booking_date, start_time, end_time, notes, status, hold_expires_at, recurrence_id, created_by, created_at);
  -- status: 'hold' | 'confirmed' | 'released' | 'expired' | 'cancelled'
CREATE TABLE gym_invoices (id, group_id, booking_id, booking_ids TEXT, invoice_date, period_start, period_end, total_hours, rate, total_amount, notes, status, recurrence_id, created_at);
  -- booking_ids: JSON array of booking IDs for multi-date invoices (booking_id = NULL when set)
CREATE TABLE gym_recurrences (id, group_id, day_of_week, start_time, end_time, start_date, end_date, notes, status, created_at);
CREATE TABLE gym_blocked_dates (id, date, reason);
```

**Gym Rental Flow:**
- Groups get a private portal link (`/gym/book/:token`) — no login needed
- Renters select dates on a 6-month calendar and submit a hold request (holds only — no self-confirm)
- Admin reviews holds at `/gym-rentals`, confirms or releases individually or in bulk
- On confirmation: booking pushed to Google Calendar + one invoice per group emailed (Tithely pay link included)
- Multi-date requests produce one combined invoice listing all dates as line items

**Gym Admin Features (as of May 2026):**
- Dashboard grouped by org with checkboxes for bulk Confirm / Release / Delete
- "Confirm All" confirms all pending holds, grouped by org (one invoice per group)
- "Confirm Selected" / "Release Selected" — act on checked holds without page reload
- "Delete Selected" — bulk delete confirmed bookings
- Invoice view shows all dates when a multi-booking invoice
- Resend email re-sends the correct single/multi-booking invoice
- iCal feed at `/gym/cal/:token.ics` (admin-set token) for calendar subscriptions
- Blocked dates, recurring requests, group management all in the admin tab
- Rate configured under the Gym Rentals tab (`gym_rate_per_hour`) — moved out of the old Settings tab (now "Redirects")
- Google Calendar integration via service account (secrets: `GCAL_SERVICE_ACCOUNT_EMAIL`, `GCAL_PRIVATE_KEY`, setting: `gcal_calendar_id`)

### Payroll & Supabase (added June 2026 — was previously undocumented here)

The church's Mother's Day Out (MDO) preschool runs a separate staff time-clock
app ("myMDO") backed by its own **Supabase** project (project ref
`dahdstopsumxnqvdclmy`), with tables `staff`, `staff_hours`,
`staff_clock_events`, `staff_pto_entries`. This is a data store independent of
this repo's D1/KV — Supabase is otherwise not used anywhere else on the site.

The admin **Payroll** tab (`admin/payroll.html`, served at `/payroll`) combines
that MDO clock/PTO data (read-only) with three tables of its own — also in
the same Supabase project, not D1 — `church_staff`,
`church_staff_period_entries` (name, pay type, hourly rate or salary, housing
allowance, HSA, 403(b), mileage, PTO) and `payroll_periods` (who signed a run
off, and when) — to produce one combined biweekly payroll report (MDO + church
staff) with CSV export.

`tlc-admin-worker.js` exposes a `/sb/*` reverse proxy so the browser-side
Supabase client (`admin/payroll.html`) can reach Supabase through the admin
worker's own origin without a CORS round-trip. The proxy requires a valid
admin session (`payroll_manage` permission) before forwarding anything to
Supabase — added as a security fix in July 2026 after a review found the
proxy was originally unauthenticated (relying on the Supabase anon key alone,
which was visible in page source). Access is gated by the **`payroll_manage`**
permission (separate from `settings_manage`, which used to be the tab's only
gate) so payroll can be restricted to office staff without granting full
settings access.

#### Where a pay rate comes from (confirmed by Andrew, 2026-08-01)

Two sources, and they must not be conflated. This answers open question §8.1 in
`design_handoff_admin_overhaul/` — **the invented rates in that handoff were
only ever in the prototype. There are no hardcoded rates anywhere in this
repo, and none should ever be added.**

| Who | Rate lives in | How it gets there |
|---|---|---|
| Church staff | `church_staff` (Supabase) — `pay_type`, `hourly_rate`, `base_salary_biweekly` | **Typed in by hand** in the Payroll tab's staff form and saved |
| MDO staff | the MDO app's own `staff` table — `pay_type`, `hourly_rate`, `salary_biweekly` | **Pulled from myMDO**, read-only, alongside `staff_hours` |

`loadMdoData()` in `admin/payroll.html` already reads MDO rates from the MDO
app, and the staff form already saves church rates. **The current design is
correct as built** — this note exists so a future phase does not "helpfully"
add a rate field for MDO staff (which would create a second, silently
diverging source of truth for what someone is paid) or try to import church
rates from anywhere.

Phase 8 (v3.2.0) rebuilt the Payroll *screens* onto the shared shell. It did
not move this data and did not change where a rate comes from — there is still
deliberately no rate field for an MDO person, and the screen now says so in as
many words.

### Access Control
- Staff admin password: full access (all tabs) — permissions are granted per-account, per-tab via the Users tab's checkboxes (see `PERMISSIONS` in `admin/auth.js`)
- **v3.0.0 renamed three keys** — `pages_edit`→`notices_edit`, `site_pages`→`pages_edit`, `site_pages_own`→`pages_edit_own`. See "The v3.0.0 Admin Overhaul" above; the migration must never run twice.
- Youth content editing now lives under the **Ministries** tab (`ministries_edit` permission), not a separate "Youth Pages" tab
- **Payroll** requires the dedicated `payroll_manage` permission — not bundled into `settings_manage` (see "Payroll & Supabase" above)
- **Giving** requires the dedicated `giving_manage` permission — not bundled into `settings_manage` (see "Giving Tab" above)
- Youth director password: scope to `ministries_edit` only (separate password so it can be changed independently of office staff accounts)

---

## Design System

### Colors (CSS Variables) — matches volunteer page color system
- Primary: Navy `#1E2D4A` (--steel)
- Accent: Gold `#C9973A` (--amber)
- Teal `#2E7EA6` (--mid/--teal) — links, Beekeepers, Christmas Market
- Moss `#4A5E3A` (--sage) — nav header, Stephen Ministry (Acceptance)
- Slate `#3A4E5C` (--slate) — Food Pantry (Outreach)
- Plum `#8A6A8A` (--plum-light) — LWML (General Interest)
- Backgrounds: Cream `#F7F3EC`, Warm White `#FBF8F3`, Linen `#EDE9E0`
- Text: `#1A1A2A` primary, `#4A4860` secondary

### Typography
- Headings/quotes: Lora (serif)
- Body/UI: Source Sans 3 (sans-serif)

### Social Media Handles
- Facebook: `facebook.com/timothystl`
- Instagram: `instagram.com/timothystl`
- YouTube: `youtube.com/timothystl`

---

## Church Content

### Identity
- **Full name:** Timothy Lutheran Church
- **Address:** 6704 Fyler Ave, St. Louis, MO 63139 *(use this everywhere — there is NO 4666 Fyler / 63116 anywhere)*
- **Location:** Lindenwood Park, South City St. Louis
- **Denomination:** LCMS (mention once, quietly — not a focal point)

### Vision
> Planted Here. Sent Everywhere.
> Planted in culturally diverse St. Louis. Sent to the world as a congregation alive to the Gospel that breaks every wall — as we welcome every person, bear bold witness to the saving grace of God through Jesus, from our neighborhood to the nations.

### Mission
> Gathered Around Grace. Sent in Love.
> Timothy Lutheran Church is a congregation alive to the Gospel of Jesus Christ. Gathered in worship around the Word and Sacraments of the risen Lord, we accept every person as one for whom Christ died. Growing in faith through Christian education and honest community, we go — from our neighborhood to the nations — bearing the tangible love of God to all.

### Core Values
1. **Worship** — Gathering as God's people, celebrating His grace, receiving His gifts of Word and Sacrament.
2. **Acceptance** — Intentionally welcoming and loving all people as Jesus does.
3. **Christian Education** — Equipping people for a lifelong journey with Christ.
4. **Outreach** — Sharing the love of Jesus with those who don't yet know Him.

### Mission Field
- **Lindenwood Park** — the neighborhood where God has planted us, our front door to the city of St. Louis.
- **Word of Life School** — families formed together through Lutheran education, community, and care.
- **Timothy's Mother's Day Out** — young families in their most open and searching season of life.

### Staff Emails
| Name | Email |
|------|-------|
| Dinger | dinger@timothystl.org |
| Pastor Matt | pastormatt@timothystl.org |
| DCE | dce@timothystl.org |
| Jinah | jinah@timothystl.org |
| Pastor Rall | pastorrall@timothystl.org |
| Pastor Vo | (no email — contact via office) |
| Office | office@timothystl.org |
| Noah | noah@timothystl.org |

### Partner / Related Sites
- MDO: `mdo.timothystl.org`
- Word of Life School: `wordoflifeschool.net`
- Ascension (partner): `ascensionstl.com`

---

## SEO Strategy

### Target Keywords
- Lutheran church St. Louis MO
- LCMS church St. Louis
- Lutheran church Lindenwood Park
- church near me St. Louis
- Mother's Day Out St. Louis
- Lutheran preschool St. Louis
- Sunday school St. Louis / VBS St. Louis
- food pantry St. Louis
- Christmas market St. Louis

### Schema.org Markup (Church type)
Include on homepage with address, phone, hours, and `sameAs` links to all social profiles.

### Open Graph / Twitter Cards
Set per-page. Homepage is highest priority. Can be added incrementally — not required all at once.

---

## Build Phases

| Phase | What | Status |
|-------|------|--------|
| 1 | test.timothystl.org setup | **DONE** — deploys from `claude/**` branches |
| 2 | Admin portal: News & Events tab | **DONE** — tab exists, DB wired, API live at /api/news |
| 3 | Admin portal: Youth Pages tab (WYSIWYG, for youth director) | **DONE** — TinyMCE editor, DB wired, youth_pages table live |
| 4 | Wire /news and /youth/* on main site | **DONE** — /news fetches /api/news + newsletter archive; /youth/* loads dynamically from admin API |
| 5 | Ministry landing pages with photos | **DONE** — /music /stephen /foodpantry /bees /christmasmarket built with real photos. Admin Ministries tab live. |
| 6 | Static page audit: migrate from Tithely/Breeze | **DONE** — site is live, DNS cutover complete April 2026 |
| 7 | SEO: Schema.org, OG tags, meta descriptions | **DONE** — completed April 2026 |
| 8 | Design reference / staff manual | **DONE** — /manual documents header photos, button editing, Christmas Market, color reference |
| 9 | DNS cutover | **DONE** — April 2026. Breeze retained for internal people/giving management (same company as Tithely). |

---

## Pending / Deferred Items

### Still Needs to Be Built
- **`/volunteer` short-URL redirect does not actually exist** — confirmed live 2026-07-20 while chasing the 2026-07-20 volunteer→serve rebrand: the Redirects tab in `admin.timothystl.org` has no `/volunteer` entry at all. This table's earlier documentation of `/volunteer → volunteer.timothystl.org` as an existing "Utility Redirect" was aspirational/planned, not a live row — `site-worker.js` has no hardcoded fallback either (confirmed by grep), so `timothystl.org/volunteer` simply falls through to the normal 404 page today, not to a dead external host. Nothing broke as part of the volunteer.timothystl.org→serve.timothystl.org cutover (see the chms repo's own CLAUDE.md). If a short link is wanted, an admin can add one via the Redirects tab: path `/volunteer` (or `/serve`), target `https://serve.timothystl.org` — optional, not a fix for anything broken.
- ~~**links.timothystl.org "Volunteer" card still points at the old host**~~ — **not true, checked 2026-08-01.** Andrew looked and the live card already reads `serve.timothystl.org`; the seed constant says the same. This entry was written as a prediction about a row nobody had looked at, and it stayed on the list long enough to waste his time. Nothing to do.
- **`/confirmation`, `/sundayschool`, `/vbs`, `/egghunt`, `/family`** — Youth sub-pages. Admin portal has the youth_pages table, but these slugs need content entered by the youth director.
- **Christmas Market annual content** — Page structure is built. Needs dates, description, photos, and Google Form link for vendors entered via the admin Ministries tab each year.
- **Ministry page editor rollout** — every ministry page now has a full-page block draft waiting in the editor (banner and all sections). The office reviews each one and presses Publish; until then the live page renders from its hardcoded markup exactly as before. Once a page is published from the editor, its hardcoded section markup in `public/index.html` is dead and can be deleted.
- **Music page video strip** — the three fallback video cards on `/music` were not converted (they need real YouTube URLs). Add Video blocks in the editor, or drop them.
- **Sermons page** — YouTube embed page exists; confirm it's pulling the correct channel or that it's manually maintained.

### Pinned / Low Priority
- **manual.html** — Keep this updated whenever new features, pages, or admin tabs are added. It is the staff reference guide at `/manual` and should always reflect the current state of the site and admin portal.
- **[B1] Gym booking race condition** — `admin/gym.js` checks for a booking-slot conflict with a `SELECT` and then does a separate `INSERT`, with no transaction or unique constraint on `(booking_date, start_time, end_time)`. Two concurrent hold requests for the same slot could both pass the check and double-book. Needs a design decision (D1 batch/transaction vs. a unique index + handling the constraint-violation error) rather than a quick fix. Flagged in the July 2026 code review; not yet fixed. Very low urgency in practice — two people booking the exact same slot at the exact same instant is rare; keep on the list to think about, no rush.
- **[B2] Newsletter Format 3** — Single-event announcement (date, time, location, RSVP). Skipped for now, add if needed.
- **[B3] R2 image uploads (card thumbnail)** — Body editors (TinyMCE) across News, Youth Pages, Pages, and Posts all have R2 upload fully wired via `tlcUploadHandler` — drag/drop or paste images and they upload automatically. The only remaining URL-only field is the News item card thumbnail (`image_url` text input). A file-picker button for that field could be added if needed.
- **[B4] KV-gate startup migrations** — ~130 D1 queries run on every admin request (no-ops after first deploy). Gate behind a KV schema-version key to reduce to 1 KV read per cold start. Low urgency.
- **[B5] Session idle timeout** — Admin sessions expire after 7 days fixed. Could add idle timeout (~24h) via a `last_activity` column on the sessions table.
- **[B6] EXIF metadata in uploaded images** — Staff photos uploaded via admin may contain GPS/device EXIF data. Consider documenting that staff should strip EXIF before uploading, or add Cloudflare Images processing.
- **[B7] Social preview image** *(future work — social media polish, not a near-term task)* — `og:image` currently uses the logo, which is fine for now. A proper 1200×630 photo of the church/congregation would improve click-through when the site is shared on Facebook/Twitter, whenever this gets picked up. When it does, consider making the image swappable via an admin setting (e.g. under Redirects) instead of a one-off hardcoded edit to `public/index.html`'s head section.
- **[B8] Mobile touch targets** — do a tap-through on a real phone to verify button/link sizes feel comfortable, especially on ministry and youth sub-pages added since launch.

---

## CRITICAL: The Deployed File is `public/index.html`

Both `wrangler-site.toml` (production) and `wrangler-test-site.toml` (test) deploy from `./public/`.
The actual SPA is **`public/index.html`**. All HTML edits go there.

`timothystl-site.html` in the repo root no longer exists — it was deleted.

---

## Versioning: `vMAJOR.MINOR.PATCH`

The admin worker version (`admin/helpers.js`) follows semver:

- **PATCH** is auto-bumped on every successful deploy to `main`. Don't touch it by hand.
- **MINOR** is manual — bump it (and reset PATCH to 0) when shipping a meaningful new feature.
- **MAJOR** is manual — bump it (and reset MINOR and PATCH to 0) for a release worth marketing internally to staff (UI overhaul, new permission model, etc.).

To cut a minor or major release, edit `admin/helpers.js` in the same PR as the feature; the CI bump will pick up from there.

*(A July 2026 review found a few merged features — the gym rental portal redesign, Christian Ed tab, Links tab — that shipped without a MINOR bump. No retroactive fix, just a reminder to actually do this in the same PR as the feature, not after.)*

---

## CRITICAL: Bump `SCHEMA_VERSION` when admin DB migrations change

The admin worker (`tlc-admin-worker.js`) has a startup migration block
(`CREATE TABLE` / `ALTER TABLE` / `INSERT OR IGNORE` / `CREATE INDEX`)
gated behind a `_schema_version` row. On stable schemas this block is
skipped after the first post-deploy request, which is what keeps admin
POSTs under 1s instead of 5–10s.

**If you add, change, or remove ANY statement in that block — bump the
`SCHEMA_VERSION` constant** (just above the block, near the top of the
`_fetch` handler). Without bumping it, the new migration never runs on
the live DB. The format is a date plus a counter, e.g. `2026-05-20-1`.

---

## Session State (as of 2026-05-19)

### What's live on timothystl.org:
- **DNS cutover complete** — site is live at timothystl.org
- Nav: About → Worship → MDO (external) → Word of Life → Ministries → News & Events → Contact → Give
- **Color system:** Navy #1E2D4A, Gold #C9973A, Moss #4A5E3A, Teal #2E7EA6, Slate #3A4E5C, Plum #8A6A8A. Background texture added.
- **Nav header:** Moss green (--sage), logo in white circle
- **Logo:** `logo.png`, `logo-bw.png`, `logo-teal.png` in `/public/images/`
- About page: vision/mission text, Mission Field section, staff photos in `/public/images/staff/`
- News page (`/news`): fetches live from admin API + newsletter archive
- Ministry landing pages: /music /stephen /foodpantry /bees /christmasmarket — built with real photos
- Youth pages: /youth and sub-pages load dynamically from admin API
- Calendar (`/calendar`): Google Calendar iframe embed
- Zoom redirect (`/zoom`): admin-managed URL via Settings tab
- Council files redirect (`/councilfiles`): admin-managed URL via Settings tab
- Give page (`/give`): points to Tithely — `give.tithe.ly`
- Voters page (`/voters`): admin-managed Zoom link + downloadable council file uploads
- 404 page: unknown URLs show a friendly 404 with nav buttons (not a silent home redirect)
- URL routing: pushState — direct URLs like /about work on reload
- Staff manual: `/manual` — documents header photos, button editing, Christmas Market, color reference
- Newsletter: Weekly / Quick Announcement formats, draft/published split, Brevo email, website archive
- Gym Rental Scheduler: full system at `/gym-rentals` — groups, bookings, holds, invoices, GCal, iCal, recurring requests

### What's next:
- Youth director content entry for /confirmation, /sundayschool, /vbs, /egghunt, /family
- Christmas Market content update each year (via admin Ministries tab)

### SEO — completed April 2026
- Schema.org JSON-LD (Church type) with address, phone, hours, social links
- Per-page title + description + OG + Twitter tags (updated dynamically via `updatePageMeta()`)
- `robots.txt` — disallows /manual and /voters, points to sitemap
- `sitemap.xml` — 25 pages submitted to Google Search Console April 24 2026
- Canonical URLs use `timothystl.org` (no www) consistently
- www → apex 301 redirect in `site-worker.js`
- noindex on /manual, /voters, /404

---

## CRITICAL: `wrangler-site.toml` needs `run_worker_first = true`

Found 2026-07-27 while adding `give.timothystl.org`: without `run_worker_first = true`
under `[assets]`, Cloudflare serves a matching static asset directly at the edge and
**never invokes `site-worker.js`'s fetch handler at all** for that request. Since `/`
conventionally maps straight to `public/index.html` as a literal asset match, this means
`give.timothystl.org/` (and any other hostname bound to this Worker) was silently served
the plain homepage instead of running the Worker's own hostname-branching logic — no
error, no log, it just quietly returns the wrong page. This almost certainly also meant
the documented `www` → apex redirect above was never actually firing for the bare root
path either (subtler to notice, since the *content* still looked right, just from the
wrong canonical hostname). Fixed by setting `run_worker_first = true` in
`wrangler-site.toml`, which forces the Worker script to run first for every request; it
still calls `env.ASSETS.fetch(request)` itself when it wants to fall through to a static
asset, so normal site behavior is unchanged — only now every request, including `/`, on
every hostname actually reaches the Worker's own logic first. **If a future hostname
check or redirect in `site-worker.js` seems to silently not fire in production despite
looking correct in code, check this setting first** — a local Node harness calling
`worker.fetch()` directly (as used to "verify" changes to this file) cannot catch this
class of bug, since it bypasses Cloudflare's edge asset-routing behavior entirely.

---

## Decisions Made (Do Not Re-litigate)

- Cloudflare Workers (not Netlify, Vercel, etc.) — already deployed and working
- No WordPress — too complex for this owner and the youth director
- Custom admin portal over Netlify CMS / Decap CMS — matches existing pattern in the repo
- D1 for dynamic content — already in use, keep consistent
- Cloudflare R2 for image uploads — planned for youth pages and news items
- `/newsevents` removed (use `/news`)
- LCMS mentioned once, quietly, on About page — not emphasized elsewhere
- WOL gets its own landing page (not a direct external redirect) — good for SEO and branding
- Christmas Market = Option B (admin-managed, not static)
- News and newsletter are separate systems (site news ≠ Beehiiv emails) — kept decoupled intentionally

---

## Pre-Redesign Hardening Review — 2026-07-12

Full code review of the **volunteer scheduler** (`public/scheduler.html`) and the
**admin sections** (`tlc-admin-worker.js`, `admin/gym.js`, `admin/payroll.html`,
and the core modules `admin/auth.js` / `db.js` / `email.js` / `helpers.js`), done
ahead of the planned redesign. Every item has a stable label so it can be
referenced directly (e.g. "fix VS-1, GY-2"). Ranked within each subsystem by
severity. **This is a catalog for review — nothing here has been changed yet.**

**Label prefixes:** `VS-` volunteer scheduler · `AW-` admin worker · `AC-` admin
core modules · `GY-` gym module · `PY-` payroll.

### 🔴 Must-fix before redesign (Critical / High across all areas)

| Label | Severity | Area | Issue |
|-------|----------|------|-------|
| VS-1 | Critical | Scheduler | Special-service rows crash Export CSV, Stats, Auto-Fill & Remove-Person (missing `type` guard) |
| VS-2 | ~~Critical~~ **FIXED v3.8.0** | Scheduler | `scheduler.html` was served unauthenticated at `timothystl.org/scheduler.html` — now `admin.timothystl.org/scheduler`, behind the session |
| GY-1 | Critical | Gym | [B1] Booking double-book race: SELECT-then-INSERT, no unique constraint/transaction |
| GY-2 | ~~Critical~~ **FIXED v3.8.0** | Gym | Stored XSS via renter-controlled `notes` — escaped in the review page and both emails |
| AW-1 | ~~High~~ **FIXED v3.8.0** | Admin worker | Unhandled exceptions leaked full stack traces to unauthenticated clients — now a reference, with the detail in the log |
| AW-2 | High | Admin worker | Stored XSS in admin UI via unescaped DB content → cross-privilege escalation (low-perm editor → admin) |
| AC-1 | ~~High~~ **FIXED v3.8.0** | Core | Session cookie missing `Secure` flag — added, on both the set and clear headers |
| AC-2 | High | Core | Email templates interpolate titles/subjects/URLs into broadcast HTML with **no** escaping (`email.js`) |
| AC-3 | ~~High~~ **FIXED v3.6.0** | Core | `</script>` in saved editor content breaks out of the inline TinyMCE init block (`helpers.js`) — one builder now, `jsString()` splits the tag |
| AC-4 | High | Core | No UNIQUE constraint on `gym_bookings(booking_date,start_time,end_time)` — schema half of GY-1 |
| VS-3 | High | Scheduler | Breeze/Resend/Worker **secrets stored plaintext** in localStorage AND synced to D1 in plaintext |
| VS-4 | High | Scheduler | RSVP tokens generated with `Math.random()` — guessable; sole authenticator for `/rsvp` |
| VS-5 | High | Scheduler | localStorage is the working store; D1 sync is last-write-wins → multi-device data loss |
| VS-6 | High | Scheduler | Stats double-count confirmed slots after a month is regenerated (inflated serve counts) |
| VS-7 | High | Scheduler | Side panels/modals: no Escape, no focus trap/return, no dialog ARIA |
| GY-3 | High | Gym | Recurring monthly invoice re-bills every run (dedup is a no-op) — duplicate charges |
| GY-4 | High | Gym | Batch hold endpoint bypasses rate-limit and `max_active_holds` (calendar DoS) |
| GY-5 | High | Gym | Renter self-confirm endpoints still routed despite "holds only" policy (bypasses office review) |
| GY-6 | High | Gym | `/hold` classic path skips day/hour business-rule validation (book outside allowed hours) |
| PY-1 | High | Payroll | Staff name not JS-escaped in inline `onclick` → breaks legit names (`O'Brien`) + script injection |
| PY-2 | High | Payroll | 403(b) base mismatch — stub line items don't reconcile to displayed Gross Pay |
| PY-3 | High | Payroll | Payroll page ignores shared admin shell — divergent design, no nav (dead-end page) |

**Cross-cutting themes** (fix systematically, not one-off): consistent output
escaping — AW-2, AC-2, AC-3, GY-2, VS-8, PY-1 all share one root cause (a shared
`escapeHtml` exists in `helpers.js` but is used in only ~one place). CSV formula
injection — VS-13, PY-5. Money stored as float instead of integer cents — AC-5,
GY-7, PY-6. Modal/keyboard accessibility — VS-7, VS-12, PY-7, PY-8, GY-12.
**Schema changes require a `SCHEMA_VERSION` bump** — AC-4/GY-1, AC-5, AC-6, AC-7.

> Reconciliation note: the admin worker already has a good CSRF `Origin`/`Referer`
> gate with a tight public-POST allowlist, so the CSRF items raised against the
> gym/core forms (GY / AC-15) are defense-in-depth, not open holes. SQL is
> parameterized throughout (no injection found), gym portal tokens use
> `crypto.randomUUID()`, and portal queries are correctly scoped by `group_id`.

### Volunteer Scheduler — `public/scheduler.html`

- **VS-1** (Critical, correctness) — Special rows `{type:'special', …}` have no `.assignments`; CSV (~2189), Stats (~4028), Auto-Fill (~3923), deletePerson (~1506) iterate blindly and throw `TypeError`. Add `if (row.type !== 'sunday') return;` like the other iterators do.
- **VS-2** (Critical, security) — `site-worker.js` falls through to `env.ASSETS.fetch`, so the whole Worship Schedule Builder is public at `/scheduler.html` with no auth gate. Decide whether it should be gated or is dead/legacy (admin sidebar points staff to `chms.timothystl.org` instead).
- **VS-3** (High, security) — `ws_breeze_settings` holds `apiKey`/`resendKey`/`workerSecret` in cleartext localStorage; `buildDataSnapshot()` (~3708) POSTs them to D1 in plaintext. Exclude secrets from the snapshot or move Breeze/Resend calls server-side.
- **VS-4** (High, security) — RSVP tokens (~2566) use `Math.random()`; use `crypto.getRandomValues()` (16+ bytes hex).
- **VS-5** (High, data) — 1.5s debounced last-write-wins D1 sync (~3759), pull overwrites local wholesale (~3736); two devices clobber each other; `beforeunload` only warns on schedule dirty, not people/settings/confirmations. Add version/updated-at check + flush on unload, or single authoritative store.
- **VS-6** (High, correctness) — `renderStatsTab` (~4025) sums history + current, but Generate archives current to history every run → confirmed slots counted N times. De-dupe by dateISO.
- **VS-7** (High, a11y) — Eight side panels: no Escape handler, no focus trap/return, no `role="dialog"`/`aria-modal`.
- **VS-8** (Medium, security) — `showAlert` (872) uses `innerHTML`; special-service success path interpolates raw `name` → XSS. `esc(name)` first.
- **VS-9** (Medium, data) — deletePerson (1501) only nulls current month; id lingers in other months, history, confirmations, last_served, rsvp_tokens → "⚠ name" ghosts. Sweep all stores.
- **VS-10** (Medium, correctness) — Clicking a `needs_changes` confirmation pill (2144) hits `cycle['needs_changes']===undefined` → status silently reverts. Add it to the cycle map.
- **VS-11** (Medium, data) — Manual Add Person (1309) has no duplicate detection (only approveSignup does). Warn on matching name/email.
- **VS-12** (Medium, a11y) — Sortable `<th>` (1430), Sunday expand rows (2123), event cards (4526) are click-only, non-focusable. Make them buttons with `aria-expanded`.
- **VS-13** (Medium, security) — CSV export (2188) not guarded against `= + - @` formula-injection prefixes.
- **VS-14** (Medium, UX) — Generate Month (1573) silently wipes/overwrites a completed schedule unless override flags exist. Confirm before regenerating a non-empty month.
- **VS-15** (Medium, maint) — Dead Breeze-sync tab (`initBreezeTab` 3242, never called; empty `#tab-breeze` 493) and orphan functions (`getSundays`, `getOrdinal`, `exportIcal`). Delete or restore.
- **VS-16** (Low, correctness) — `archiveCurrentSchedule` builds `endDate` at local midnight then `toISOString()` — off-by-one for UTC+ viewers.
- **VS-17** (Low, robustness) — Empty catches (migrate 1010) and fire-and-forget claim POSTs (`.catch(()=>{})` 4381/4464/4606) hide failures; a dismissed sign-up can reappear.
- **VS-18** (Low, perf) — `buildCell` (1955) re-parses several localStorage blobs + rescans people per cell. Hoist into `renderTable`.
- **VS-19** (Low, UI) — Collapsed thead renders 4 `th` (1806) vs body `colspan=9` (1852) — brittle grid.
- **VS-20** (Low, data) — No email-format validation on the person email field (1312).
- **VS-21** (Low, UI) — "Volunteer Sign-Up Page" button (438) links to `/`, not the sign-up page.

### Admin Worker — `tlc-admin-worker.js`

- **AW-1** (High, security) — Top-level catch (116-125) returns `e.stack` to every route incl. unauthenticated ones. Return generic 500; log detail server-side only.
- **AW-2** (High, security) — Many DB strings interpolated without `escapeHtml` (news picker 1727, newsletter subject 4712/4738, sermon title incl. in `value="…"` 1464/1554/1665, bible class 2142). With `unsafe-inline` CSP this is a cross-privilege escalation path. Escape all output; attribute-safe escape for `value=`.
- **AW-3** (Medium, security) — `/api/newsletter/:id` (688) has no status filter; drafts/pending readable by sequential ID. Add `AND status='published'` + public columns only.
- **AW-4** (Medium, security) — `/api/voters` (936) and `/docs/*` (538) are unauthenticated though the Voters page is "members-only." Gate behind session/token if truly private.
- **AW-5** (Medium, security) — `/api/contact` & `/api/prayer` (782-901): honeypot only, no rate limit; confirmation email to attacker-supplied address = email bomb/reflector. Add IP/time rate limiting + turnstile.
- **AW-6** (Medium, security) — `/api/contact` (838) & `/api/prayer` (899) return `{error: e.message}` to unauthenticated callers (subscribe is generic — inconsistent). Generic error.
- **AW-7** (Medium, security) — `/sb/*` proxy (141) correctly enforces `payroll_manage`, but forwards any `/sb/` path → authenticated open relay to whole Supabase project. Add a table/path allowlist; confirm RLS on all exposed tables.
- **AW-8** (Medium, security) — `/api/upload-image` & `/api/upload-doc` (1279) require a session but no specific permission — any account can host permanent public files on the domain. Gate behind a content-edit permission.
- **AW-9** (Low, security) — Login (1086) skips PBKDF2 for unknown users → timing enumeration. Run a dummy hash.
- **AW-10** (Low, security) — Login rate limit (1071) is IP-only (defeated by rotation); add per-username counter.
- **AW-11** (Low, security) — `/settings/update` (4370) writes any key in the body, not just the 3 the form exposes. Allowlist keys.
- **AW-12** (Low, correctness) — Migration block swallows each error in `try/catch` then writes the version marker unconditionally (534) → partial migration marked "current," never retries. Track failures before stamping.
- **AW-13** (Low, correctness) — No 404 fallthrough (4636): unknown authenticated paths render the newsletter dashboard. Add explicit 404.
- **AW-14** (Low, security) — Password reset (987) doesn't invalidate prior tokens and stores them plaintext. Invalidate on new request; hash tokens.
- **AW-15** (Low, design) — Inconsistent error shapes/status codes (plain text vs JSON, 400 vs 302). Standardize a JSON error envelope.
- **AW-16** (Low, design) — Monolithic ~4,600-line `_fetch` if-chain with scattered inline permission gates — the single biggest risk to the redesign. Extract a route table + centralized `requirePermission(path)` map.
- **AW-17** (Low, perf) — Per-request `_schema_version` D1 read on all hot paths incl. `/images/*` (= backlog [B4]). Cache per-isolate or via KV.
- **AW-18** (Low, security) — No `frame-ancestors`/`X-Frame-Options` on admin pages. Add `frame-ancestors 'none'`.

### Admin Core Modules — `admin/auth.js` · `db.js` · `email.js` · `helpers.js`

- **AC-1** (High, security) — Session cookie (`auth.js` 109/113) sets `HttpOnly; SameSite=Strict` but not `Secure`. Append `; Secure`.
- **AC-2** (High, security) — `email.js` drops subjects/titles/event names/CTA URLs into broadcast HTML with no escaping; `escapeHtml` exists in `helpers.js` but isn't imported here. Wrap all short plain-text fields.
- **AC-3** (High, security) — `helpers.js` TinyMCE section builders (398/431 and 5 clones) escape backtick/`$` but not `</script>`, which the HTML parser honors regardless of JS-string context. Also neutralize the closing-tag sequence.
- **AC-4** (High, correctness) — `db.js` `DB_INIT_GYM_BOOKINGS` (133) has no unique index → root of GY-1. Add a partial unique index over active statuses; bump `SCHEMA_VERSION`.
- **AC-5** (Medium, correctness) — `gym_invoices` money columns are `REAL` (db.js 175). Store integer cents. (Schema change → version bump.)
- **AC-6** (Medium, correctness) — `audit_log.user_id` is `NOT NULL` (db.js 231) but `logAudit` binds null for system actions (auth.js 134); the INSERT throws and is silently swallowed → those actions vanish from the audit trail. Make nullable or use a sentinel.
- **AC-7** (Medium, perf) — Missing indexes on hot columns: `news_items(publish_date,expire_date,pinned)`, `gym_bookings(group_id,booking_date,status)`, `audit_log(created_at,entity_type)`, `sessions(user_id)`.
- **AC-8** (Medium, security) — CSP (helpers.js 181) allows `'unsafe-inline'` + `'unsafe-eval'`, defeating it as an XSS backstop. Move to nonce-based inline scripts.
- **AC-9** (Medium, correctness) — Email footers (email.js 124/307) hardcode the stale Breeze give URL; a managed `give_url` setting exists. Thread it in.
- **AC-10** (Medium, maint) — ~~~500 lines of 6 near-identical TinyMCE builders — any escaping fix (AC-3) must be applied 6×.~~ **FIXED v3.6.0**: one `tinymceField()` builder; the seven call sites are one line each.
- **AC-11** (Medium, design/security) — Christian Ed tab gated by unrelated `news_edit` (helpers.js 204); no `christian_ed` permission exists. Granting News editing silently grants Bible-class management. Add a dedicated permission.
- **AC-12** (Medium, security) — PBKDF2 at 100k iterations (auth.js 24/36); OWASP guidance ~600k. Iteration count is embedded in the hash so it's upgradeable on next login.
- **AC-13** (Low, design) — `settings_manage` bundles Subscribers (PII) + Redirects. Split if finer control wanted.
- **AC-14** (Low, maint) — Dead `sessions.permissions` column (db.js 224) — written at login but `getSession` reads from `users`. Drop or document.
- **AC-15** (Low, security) — No CSRF token defense-in-depth beyond SameSite (mitigated by the worker's Origin gate — see reconciliation note). Add tokens if the cookie policy ever relaxes.
- **AC-16** (Low, security) — `resetPasswordPage` (helpers.js 305) only escapes `"`. Use `escapeHtml`.
- **AC-17** (Low, security) — `timingSafeEqual` (auth.js 45) short-circuits on length mismatch (fine for fixed-length hex; noted for completeness).
- **AC-18** (Low, security) — TinyMCE API key hardcoded (db.js 5) — domain-restricted public key; move to env for rotation.
- **AC-19** (Low, design) — No `FOREIGN KEY` declarations on relational columns → orphaned children on parent delete. Add FKs where cascade/restrict matters, or document app-level integrity.
- **AC-20** (Low, maint) — `VERSION` string (helpers.js 7) labeled "minor bump" but sits in the PATCH position — reconcile with the semver convention.

### Gym Module — `admin/gym.js`

- **GY-1** (Critical, correctness) — [B1] double-book race (1220/1258/1484/3437). Add partial unique index (see AC-4) + handle constraint error as "slot taken."
- **GY-2** (Critical, security) — Renter `notes` rendered unescaped in recurring-review page (4453) and admin emails (1532/1542/1705) → stored XSS in office admin's authenticated session. Escape `notes` (and defensively `group.*`) everywhere.
- **GY-3** (High, correctness) — Recurring monthly invoice dedup (4572) queries `booking_id` but recurrence invoices are inserted without it → re-bills every run. Store `booking_ids` and filter against it.
- **GY-4** (High, security/DoS) — Batch `/request-slots` (1459) enforces neither rate-limit nor `max_active_holds` (unlike single `/hold`). Enforce both + a per-request slot ceiling.
- **GY-5** (High, security/design) — Public `/confirm` (1245) & `/confirm-slots` (1554) let a renter self-confirm + self-invoice despite "holds only." Remove or gate behind admin.
- **GY-6** (High, correctness) — `/hold` (1099) validates only end>start/conflict/blocked, never `getValidHoursForDow` (batch path does). Validate hours.
- **GY-7** (Medium, data) — Money stored as float (88/3593/3599) → drift between stored total and emailed/paid amount. Integer cents; derive pay-link from the stored rounded value.
- **GY-8** (Medium, security) — `/gym/cal/:token.ics` (1720) uses one global token and returns every group's confirmed bookings incl. `notes`. Per-group tokens or strip notes.
- **GY-9** (Medium, correctness) — `merge-holds` (2519) re-points `booking_id` but ignores multi-date invoices' `booking_ids` JSON → merged dates silently drop from invoice view/resend.
- **GY-10** (Medium, correctness) — `sweepExpiredHolds` runs only on `/gym-rentals` load (1762); expired holds keep blocking slots + counting against the cap until staff open the dashboard. Sweep in the portal handler / cron, or ignore expired holds in conflict checks.
- **GY-11** (Medium, maint) — `gym_hold_hours` setting (2076) is dead; expiry hardcoded `48*3600000` in two places (1225/1471). Read the setting or remove it.
- **GY-12** (Medium, a11y) — Blocked-date calendar cells are `<span>` with click handlers (2721/2787) — not focusable; availability is color-only (707). Use `<button>` + aria; pair color with text.
- **GY-13** (Medium, correctness/UX) — `edit-amount` (4300) writes `rate = parseFloat(...||'0')` → blank stores `0` (`$0.00/hr`); guard only checks `total_amount`. Validate rate, keep existing on blank.
- **GY-14** (Low, correctness) — iCal events (1732) use floating time, no `TZID`/`VTIMEZONE` → shifted times for out-of-TZ subscribers.
- **GY-15** (Low, correctness) — Custom rate `$0` coerced to default (`||null`, 2193/2312) → can't comp a group to $0. Use explicit empty-string checks.
- **GY-16** (Low, maint) — Six confirm handlers (1245/1554/3840/3889/3922/3987) re-implement ~40 lines of confirm→invoice→email→GCal each, already diverging (where GY-3/GY-10 hide). Extract one helper.
- **GY-17** (Low, maint) — `handleGymRoutes` is one ~4,100-line function; the calendar is rendered 3× (portal/new-booking/blocked) and time helpers re-declared server + client (drift risk). Split modules; share one renderer.
- **GY-18** (Low, UX) — `test-gcal` (2346) writes a real event to the production calendar on every GET and is linked from the dashboard. Gate behind an explicit POST.

### Payroll — `admin/payroll.html`

- **PY-1** (High, security/correctness) — `esc()` (1596) doesn't escape single quotes; names land in single-quoted inline `onclick` (913). `O'Brien` breaks Edit/Remove; a crafted name executes JS. Use event delegation + `data-id`.
- **PY-2** (High, correctness) — 403(b) shown in `renderStaffBlock` (1493) is computed on `hours*rate` but `calcGross` (1579) uses `(hours+ptoUsed)*rate` → stub line items don't reconcile to Gross. Compute `base` once and pass everywhere.
- **PY-3** (High, design/UX) — Whole page is bespoke (Nunito/navy, own login CSS, no sidebar, only a Sign Out button) vs the shared `sidebarShell`/`html()` — a dead-end that won't inherit shell a11y/mobile fixes. Fold into the shared shell during the redesign.
- **PY-4** (Medium, security) — Supabase anon JWT hardcoded in page source (779). `/sb` gate is the real control (defense-in-depth), but inject the key server-side / document rotation.
- **PY-5** (Medium, security) — CSV `q()` (1229) quote-doubles but doesn't neutralize `= + - @` (the 403(b) column even emits leading `-`). Prefix risky cells.
- **PY-6** (Medium, correctness) — Float money; rows rounded for display while subtotals sum unrounded values (1304) → printed subtotal a cent off. Round each gross to cents before summing, or integer cents.
- **PY-7** (Medium, a11y) — `#staffModal` (691) has no `role="dialog"`/`aria-modal`, no focus move/trap/restore, no Escape.
- **PY-8** (Medium, a11y) — Modal `<label>`s lack `for`; hours-grid captions are `<div>` not labels → three identical unlabeled spinboxes per row. Pair `for`/`id`; add `aria-label`.
- **PY-9** (Medium, UX/correctness) — `onPeriodChange` (1059) awaits several fetches with no feedback; `loadMdoData` (1093) uses `|| []` and never checks the Supabase `error` field → a failed MDO query silently under-reports staff on a payroll run. Add loading state + error banner.
- **PY-10** (Medium, responsive) — `.form-row`/`.form-row-3` (539) don't collapse on mobile; the 640px block only touches the hours row/table. Collapse to one column under ~560px.
- **PY-11** (Medium, correctness) — Period dates parsed as local midnight but formatted via `toISOString()` (UTC) (824) — latent off-by-one. Format from local components consistently.
- **PY-12** (Low, UX) — Save/remove errors use `alert()` (1039) inconsistent with admin `.alert` banners; `confirm()` gets HTML-entity-escaped name (`Smith &amp; Jones`).
- **PY-13** (Low, UX) — Dead `#loginScreen` CSS (44) with no matching DOM; on 401 `showDashboard()` still runs and shows a raw "Network error." Remove dead CSS; redirect to `/login` on 401.
- **PY-14** (Low, a11y) — "✓ Saved" flash (663) and error rows carry no `aria-live`. Add `role="status"` / `role="alert"`.
- **PY-15** (Low, a11y) — Data-table `<th>` lack `scope="col"`; muted `#7A6E5A` at ~11px approaches/fails 4.5:1 contrast.
- **PY-16** (Low, correctness) — Clock shifts <10 min silently dropped (1121); hours inputs wire both `oninput`+`onchange` → redundant save on blur.

