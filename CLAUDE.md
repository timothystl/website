# Timothy Lutheran Church Website — Project Context

This file captures the full project context so any Claude session can be resumed immediately.

> **⚠ American English, in everything a human reads** — screen labels, button text, purpose
> lines, `◆` notes, toasts, code comments, this file, and `public/manual.html`. The full rule,
> the four things that look British and must **not** be "corrected", and the grep that checks it
> are under **Design System → ⚠ American spellings everywhere**. The same rule now holds in the
> `chms`, `childcare-portal` and `other` repos, each with its own exceptions table.

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
- `tlc-newsletter-db` — tables: `newsletters`, `events`, `news_items`, `youth_pages`, `ministry_posts`, `sermon_series`, `sermon_notes`, `notices`, `staff_members`, `bible_classes`, `link_cards`, `gym_*`, `market_vendors`, `users`, `sessions`, `audit_log`, `redirects` (`category`='giving' rows are vendor/market payment links, managed under the Giving tab), `give_amount_tiers` (admin-editable amount chips + per-tier Tithe.ly links for give.timothystl.org), and more — see the `DB_INIT_*` constants in `admin/db.js` for the full current schema
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
- **Calendar:** the site's own month at `/calendar`, drawn from a merged Google Calendar + News & Events feed (`admin/calendar.js`, `/api/calendar`). No longer a Google embed — see "The calendar is ours now" below
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
| page-marketvendors | /christmasmarket/vendors | Exists — the market's rules, details, photographs and FAQ. **Rendered entirely from blocks and published** (v5.22.0); the hardcoded markup is deleted, so this page must stay published |
| page-marketvendorsapply | /christmasmarket/vendors/apply | Exists (v5.22.0) — the vendor application and nothing else. `admin/market-vendors-apply-seed.js`; `tlcMarketInit()` runs here |
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
/christmasmarket  Admin-managed: dates, photos; links to the vendor application
/christmasmarket/vendors  Rules, details, photographs, FAQ
/christmasmarket/vendors/apply  The application — three steps, takes card payment
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
| Christmas Market | Coordinator, office, bookkeeper — five tabs, each on its own permission | **DONE** (v5.22.0) — the whole event section: Vendors · Page & copy · Money & dates · Volunteers · Photos. The vendor list that replaces the 2024 spreadsheet: who applied, what they sell, table numbers, and a payment state the coordinator keeps by hand because the website cannot see whether a card cleared. Fed by the public application at `/christmasmarket/vendors`; see "The Christmas Market takes its own vendor applications" below |
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

### The two giving pages have separate jobs (settled 2026-08-03)

There are two giving pages and they had drifted into being rival versions of each
other. They are now split by job, and this is the rule to keep:

- **`give.timothystl.org`** (`give-landing.js`) is the **transaction**. Amount
  chips, fund selector, custom amount, the ministry ladder and the leadership
  tiers — everything that ends in a card being typed in. It resolves `give_url`
  from the Giving tab *at request time*. It closes with a short "Other ways to
  give" strip that names the six offline paths and links to `/give`; the strip
  deliberately carries no descriptions, because two descriptions of an IRA QCD
  in two files is one of them going stale.
- **`timothystl.org/give`** is where somebody decides **how** to give: the
  theology, then the offering plate, bank bill pay, Thrivent Charitable, an IRA
  qualified charitable distribution, a Donor Advised Fund, planned giving, and
  the time-and-talent link to `serve.timothystl.org`. Its "Give Online" button
  **hands off to `give.timothystl.org`** — it is a plain `<a class="btn">` with
  no Tithe.ly address in it at all.

**The Tithe.ly link has exactly one owner: the Giving tab.** Nothing else may
hold a copy — not `public/index.html`, and above all not a *block*, whose URL is
frozen the moment a page is published. `admin/blocks.test.mjs` asserts that no
seeded page contains `give.tithe.ly`, for every page rather than just `/give`;
that assertion was per-page precisely because `/ccs` was the one that got missed.

The **CCS appeal is the single exception** and worth understanding before adding
another. It asks for a *specific fund*, and there is no way to tell
`give.timothystl.org` "start on the CCS fund" from a link — so those two buttons
are `[data-give-link]` and get rewritten in the browser by `loadGiveLinks()` in
`public/index.html` from the same `give_url`. `data-give-fund` **replaces** the
base link's `fundId` rather than appending a second one. The `href` in the markup
is the offline fallback and stays real. `loadGiveLinks()` now runs on `/ccs`
only — `/give` costs no cross-origin call.

⚠ `buttonsIn()` in `tools/extract-pages.mjs` has two passes, and a give button
matches *both* (`class="btn"` and `data-give-link`). The class pass skips
`data-give-link` for that reason. Remove that guard and `/ccs` seeds its button
twice, once with a hardcoded Tithe.ly URL.

### The admin is a PWA, with web push (added 2026-08-04)

`admin.timothystl.org` is installable — "Add to Home Screen" / "Install
admin.timothystl.org" now actually does something, on desktop Chrome/Edge and
on Android and iOS. Two pieces:

- **The manifest already existed** (`/site.webmanifest`, served from
  `tlc-admin-worker.js`) but nothing registered a service worker, and Chrome's
  installability check wants one. `admin/helpers.js` now exports
  `SERVICE_WORKER_JS`, served at `/sw.js` (root scope, so it covers the whole
  origin — a worker registered at `/gym-rentals/sw.js` would only ever control
  `/gym-rentals/*`). **It deliberately does not cache the shell or intercept
  `fetch`.** Everything this admin shows — a gym hold queue, a payroll period,
  held mail — is only useful as fresh as the last request; serving a cached
  copy while offline would let staff act on numbers that are already wrong.
  Its only two jobs are the ones a PWA actually needs a worker registered for:
  installability, and being addressable for a `push` event. iOS ignores the
  manifest for "Add to Home Screen" and reads `apple-mobile-web-app-*` meta
  tags instead, so those are in `html()` too.
- **The "Notifications" toggle** lives in the sidebar footer, hidden until the
  client-side `PUSH_JS` (`admin/helpers.js`) confirms the browser actually has
  `PushManager` — nobody on an unsupported browser sees a control that would
  just fail. Clicking it subscribes via the browser's own Push API and POSTs
  the subscription to `POST /api/push/subscribe`, stored in
  `push_subscriptions` (`admin/db.js`) keyed on `endpoint`, not on the user —
  the same person subscribing from a desktop and a phone should get both
  rung, not just the second one they registered.

**Sending a push means implementing RFC 8291 (aes128gcm) and RFC 8292 (VAPID)
by hand**, in `admin/webpush.js` — Cloudflare Workers has no room for the
`web-push` npm package, which shells out to Node APIs Workers doesn't have.
The derivation (HKDF info strings, the `salt‖rs‖idlen‖keyid` header layout,
per-record nonce math) is copied from the actual `web-push`/`http_ece`
reference implementation rather than reconstructed from memory, specifically
*because* a single wrong byte in an HKDF info string produces a push that
silently never decrypts on the device — there is no error message, no failed
request, nothing to grep for. **`admin/webpush.test.mjs` is the check that
matters**: it encrypts a payload with our code, then decrypts the raw bytes
back with an independent implementation built on Node's `crypto` module
(different primitives, same spec) and asserts the plaintext round-trips —
proof the header layout and key derivation agree with themselves, which is
what a live device would also need to be true. Run: `node admin/webpush.js`
is not runnable directly (it's WebCrypto, browser/Workers-only); run
`node admin/webpush.test.mjs`.

- **Four triggers exist today** (the first two shipped alongside the
  infrastructure; the second two followed once Andrew confirmed which events
  he actually wanted a phone to buzz for, 2026-08-04):
  - **Held mail.** `screenSubmission()` (see "Form Spam Screening" below)
    already makes a held contact/prayer submission invisible by design — the
    point of that design is that the Dashboard's "Needs your attention"
    worklist is what keeps it from being *silently* invisible. A push is the
    same idea for whoever isn't staring at the dashboard.
  - **Every delivered contact/prayer message, too** — not just held ones.
    Andrew's call: he wants to know the moment somebody reaches out through
    the site, not only when the spam filter caught something.
  - **A new gym hold or recurring request.** Three separate submission paths
    in `admin/gym.js` (`/hold`, the multi-slot `/request-slots`, and
    `/recurring`) each already emailed `gym_admin_email` on a new request; the
    push rides alongside that, same event.
  - **A payroll period turning "ready to approve."** This one is different in
    kind from the other three: the Worker holds no server-side Supabase
    credentials (see "Payroll & Supabase" below), so it cannot notice this on
    its own the way it notices a form POST or a gym booking INSERT.
    `admin/payroll.html` already computes readiness client-side to draw the
    status pill (`renderPeriodState()`) — that screen is what asks the Worker
    to push, via `POST /api/push/payroll-ready`. Because *any* staff member's
    browser might be the one to notice a period turn ready, the dedup can't
    live client-side (two people opening Payroll the same day would both
    fire it) — `payroll_ready_notified` (`admin/db.js`) is a one-row-per-period
    table where the INSERT itself is the lock: whichever request's INSERT
    lands sends the push, and every other one silently no-ops.
  All four call `pushToAllSubscribers(env, {...})` inside `ctx.waitUntil()` —
  never `await`ed, because a push failure (no one subscribed yet, a dead
  endpoint) must never turn into a real visitor's submission failing or a
  staff action being refused. A subscription the push service reports as
  gone (404/410) is deleted on the spot rather than retried forever.
- **Requires a manual step outside this repo, like Turnstile and the ChMS
  intake key before it**: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` must be
  set as Worker secrets (`wrangler secret put VAPID_PUBLIC_KEY --name
  tlc-newsletter-admin`, same for the private key) — until both are set,
  `/api/push/vapid-public-key` answers 501 and the sidebar's toggle would
  subscribe browsers to nothing. **Done 2026-08-04** — Andrew set both by
  hand from the generated keypair.
- **A fifth and sixth trigger arrived from `connect.timothystl.org` (2026-08-04)**,
  via the cross-app relay below — not new triggers built in this repo. New
  `POST /api/push/notify` (`tlc-admin-worker.js`, placed above the CSRF Origin
  gate alongside `/api/push/vapid-public-key`, and in `PUBLIC_CROSS_ORIGIN_POSTS`
  for the same reason `/api/tap-hit` is — a server-to-server `fetch()` carries no
  `Origin`/`Referer`) accepts `{title, body, tag, url}`, checks the caller against
  a new `ADMIN_PUSH_API_KEY` shared secret in an `X-Push-Key` header (same
  pattern as `CHMS_INTAKE_API_KEY`/`X-Intake-Key`, just the other direction —
  ChMS is the caller here, not this repo), and calls the same
  `pushToAllSubscribers(env, {...})` inside `ctx.waitUntil()` the other four
  triggers use. **One push-sending implementation, one `push_subscriptions`
  table** — ChMS does not have its own copy of `admin/webpush.js`. See the
  chms repo's own CLAUDE.md for what it sends and when (a new volunteer
  sign-up, a volunteer confirming/declining an RSVP).
- **Requires a manual step outside this repo, same shape as `CHMS_INTAKE_API_KEY`
  and the VAPID keys**: `ADMIN_PUSH_API_KEY` must be set as a secret on this
  Worker (`wrangler secret put ADMIN_PUSH_API_KEY --name tlc-newsletter-admin`)
  **and** the identical value set as a secret on the chms repo's Worker
  (`wrangler secret put ADMIN_PUSH_API_KEY --name tlc-chms`) — until both sides
  have the same value, `/api/push/notify` answers 503 (key unset here) or 401
  (mismatched). Not done as part of this change — flagged for an admin.
- **Not wired up here, deliberately**: the rest of the Worship Schedule Builder
  and volunteer sign-up surface still lives on `connect.timothystl.org`, a
  separate repo. Everything below this line is the original prompt that led to
  the relay above — kept for context, not because it's still outstanding.
- The payroll email report (`POST /payroll/email`) now also always CC's
  `dinger@timothystl.org` alongside the `payroll_bookkeeper_email` setting —
  Andrew asked for his own copy of every report, deduped against the
  bookkeeper's address in case they're ever the same.

### Cross-repo follow-up: scheduler and volunteer sign-up notifications (noted 2026-08-04)

Andrew wants push notifications for two more events, and both now live on
`connect.timothystl.org` rather than in this repo: the Worship Schedule
Builder (distinct from the dead `/scheduler` in *this* repo — see "Four
security fixes from the July review" above, VS-2) and volunteer sign-ups.
That backend is a separate codebase this session was never given access to.

**Prompt for a future session, with both repos attached:**

> Add web push notifications for two events on connect.timothystl.org (the
> ChMS/scheduler repo) to ring the same devices that admin.timothystl.org's
> push notifications already reach: (1) a new volunteer sign-up, and (2) a
> scheduler notification — check that repo's own CLAUDE.md and code for what
> "scheduler notification" concretely means there before assuming an event
> shape. This repo (timothystl/website) already has the full Web Push
> infrastructure built — `admin/webpush.js` (hand-rolled RFC 8291/8292,
> verified by an independent round-trip test in `admin/webpush.test.mjs`),
> a `push_subscriptions` table, and `pushToAllSubscribers(env, payload)` — do
> not rebuild this in the other repo. Instead, have connect.timothystl.org
> call an endpoint on admin.timothystl.org (e.g. a new authenticated
> `POST /api/push/notify` accepting a title/body/tag/url, gated by a shared
> secret the way the ChMS intake key already works for contact/prayer
> forwarding — see `CHMS_INTAKE_API_KEY` in the Giving Tab section) so there
> is exactly one push-sending implementation and one `push_subscriptions`
> table, not two drifting copies. Read "The admin is a PWA, with web push"
> section of this repo's CLAUDE.md first for the full design and its
> constraints (never `await`ed, dedup considerations, VAPID key handling).

### The chrome is editable, and drafted first (v4.23.0, 2026-08-05)

Dinger, with two screenshots side by side — the Menu screen's preview bar, and
the live site: *"i want to be able to edit the appearance of the menu and
publish it to go live."*

**Two separate problems, and the first one is the interesting one.**

- **The preview was lying.** It was admin navy with a hardcoded `T` in a gold
  square and the literal words "Timothy Lutheran", beside a real header that is
  moss green with a round photographic logo and a strapline under the name. It
  was built from the real menu ITEMS — the honest half — but drew them into a
  bar that exists nowhere. Staff were being shown a picture of a header the
  site does not have and asked to arrange it. `renderHeaderPreview()` in
  `admin/appearance.js` is now the one renderer, used by the Menu screen and
  the Appearance screen alike. **A preview that can disagree with the site is
  worse than no preview, because it is believed.**
- **The menu was already live** — every write went straight through, reaching
  the site inside the 120s `/api/pages` cache. So "publish it to go live" was
  describing a gap that was really a *trust* gap, not a plumbing one.

**`admin/appearance.js` is the record**: bar color, bottom rule, Give button,
logo (with upload) and its shape, church name, tagline — plus the newsletter
band's color, wording and whether it appears at all.

- **Drafted, then published.** Two `site_settings` rows,
  `site_appearance_draft` and `site_appearance`, the same split a page has
  between `blocks` and `published_blocks`. Everything else the Menu screen
  writes is live on save and for reordering a link that is right; somebody
  trying a color or cropping a logo is *experimenting*, and an experiment
  that is instantly on the front of the church website is not one. **Only
  Publish writes the live row, and it copies the draft across whole rather
  than taking fields from the request** — so a crafted POST can only ever
  publish what is already on the screen. `pageData()` reads the published key
  and only that.
- **The screen names what differs** ("Bar color, Logo") and shows both bars
  when something is pending. "You have unpublished changes" tells somebody
  that something is waiting without telling them what, which is the half that
  would let them decide.
- **⚠ Colors are a palette, not a picker, and gold is excluded from the bar.**
  The nav links, the tagline and the brand name are all white and none is
  editable, so a free hex field is one paste away from an unreadable header on
  every page at once. White on gold is 2.6:1, so `bar: false` keeps it off the
  bar and the newsletter band while leaving it available for the rule (no
  text) and the Give button (how the site already looks). **Enforced in
  `sanitizeAppearance()`, not by which chips get drawn** — a stale tab is
  exactly how the unreadable header would otherwise be saved.
- **⚠ Known and deliberately not fixed: the Give button is white on gold**,
  2.6:1, below the 4.5:1 a label needs. That is the site as it already is, and
  recoloring the most-clicked button on the church website should be somebody's
  decision, not a side effect. Picking a darker Give color on the new screen
  fixes it today with no code change — which is part of why the choice exists.
- **The public CSS is `var(--nav-bar, var(--sage))` throughout**, so the
  fallback IS the site as it always looked. If the admin is unreachable, or
  nobody ever opens the screen, nothing changes.
- **⚠ The newsletter band is chrome, not a homepage block.** It sits OUTSIDE
  every page div and renders on all 28 of them. It had been recorded here as
  "the homepage newsletter signup block", and that description is what would
  send somebody looking for it in the page editor, where it will never be —
  converting the homepage to blocks would not have reached it. Its color,
  wording and on/off switch are on the Appearance screen, and the markup says
  so.
- The `photo` field kind in `admin/ui.js` renders a file input and **nothing
  ever listened to it** — the uploader is wired on this screen rather than
  left as a control that looks live and does nothing.

Run: `node admin/appearance.test.mjs`, plus three groups in
`test/admin-redesign.test.mjs`.

### The footer is columns now (v4.23.0, 2026-08-05)

The footer's headings and which links sit under each were hardcoded; the Menu
screen managed only a flat list (`MAX_DEPTH.footer = 0`), which cannot express
"which column is this under".

- **`footer_columns` is its own table and `menu_items.column_id` points at
  it.** Inferring the grouping from position would mean a link silently
  changing column the moment somebody reordered the one above it.
- **A column's `source` is where its links come from** — `menu`, or
  `partners`, which the site fills from the partner ministries, one per core
  value. Those were never menu items, so the alternative to a source flag was
  faking eleven rows or pretending the column does not exist.
- **⚠ Deleting a column never deletes the links in it.** They fall out into a
  "Not in a column" band, still on the site. Losing somebody's footer links
  because they tidied a heading is exactly the silent damage this screen must
  not be able to do.
- **A stranded link is shown, not dropped.** It has to appear somewhere, so
  `publicFooter()` puts it under the first column and the admin says in as
  many words that that is where it went — visible rather than mysterious.
- **A column is another drop target, not a special case.** `save()` in the
  Menu screen's drag script walks every `[data-menu]` container and records
  `data-column`, so dragging a link between columns and reordering inside one
  are the same gesture and the same posted order.
- An empty `menu` column is left off the site — a heading over nothing reads
  as a fault — while an empty `partners` column is kept, because the site
  fills it a moment later.

Run: `node admin/menu.test.mjs`, plus two groups in
`test/admin-redesign.test.mjs`.

### The calendar is ours now (v5.29.0, 2026-08-19)

Built from `design_handoff_church_calendar/`, boards 1b (the month) and 2a (the
print sheet), with 1c's list as the phone layout it asks for. It closes the
"custom-rendered calendar" item that had been sitting on the pending list since
2026-08-17 with three options and no decision.

**⚠ THE CAP WAS NEVER OURS TO RAISE, WHICH IS WHY TWO EARLIER FIXES DID NOTHING.**
v5.5.0 made the iframe taller. v5.15.0 found the real bug — Google lays the month
out to the `height` in the URL, not to the box — and put a height in the address.
Both were correct and neither fixed the report, because **Google's month view
caps how many events a day cell shows before folding the rest into "N more",
independent of height**. A Sunday with two services, Bible class and Sunday
School showed two of them and a link. There is no parameter for it; the only way
past it is to stop asking Google to draw the month.

So the site draws it. `/calendar` and the strip at the bottom of `/news` are the
same renderer over the same feed, and **a week row simply grows to whatever its
busiest day holds** — the assertion `test/public-calendar.test.mjs` is built
around is seven events on one Sunday and seven chips.

**And the feed being ours is the second half, not a side effect.** Events were
already recorded in two places and always had been: Google holds the room-and-time
bookings, and a News & Events record holds anything with a description, a photo
or a sign-up. Google imports from nothing, so nobody could merge them there.
`admin/calendar.js` merges them here — which is the whole reason the Subscribe
button is worth having, since subscribing to the Google calendar directly gets
you half the events.

- **⚠ EVERY TIME IN THE PAYLOAD IS A CHURCH WALL CLOCK CARRYING NO TIMEZONE** —
  `2026-08-16T08:00:00`, no `Z` and no offset, deliberately. The Worker asks
  Google for Chicago times and keeps the digits as text; the browser SLICES them
  and never hands one to `new Date()`. A church calendar says 8:00 am and means
  8:00 in St. Louis to every reader — converting would tell somebody in Denver
  the service is at 7. Do not "fix" this into instants; that is the bug, not the
  omission. The one genuine instant in the file is the `.ics` `DTSTAMP`, which is
  UTC because it really is a moment.
- **⚠ AN ALL-DAY EVENT'S END IS MADE INCLUSIVE AT THE BOUNDARY.** Google reports
  a one-day all-day event as 08-16 → 08-17, and carried through as-is every
  all-day event sits on one day too many — a Mon–Fri VBS running into Saturday.
  `normalizeGoogleEvent()` fixes it once, which is why nothing downstream — not
  the grid, not the list, not the print sheet — has to know about it. The `.ics`
  writer puts the exclusive day back, because that is what `DTEND` means.
- **⚠ `singleEvents=true` IS LOAD-BEARING AND MUST NOT BE REMOVED.** Without it a
  weekly service comes back as one event carrying an `RRULE` and every Sunday but
  the first vanishes. Expanding recurrence ourselves is a project; asking Google
  to do it is a query parameter — and it is the reason the public `.ics` feed was
  rejected as a data source, since that carries the `RRULE` unexpanded.
- **⚠ A GOOGLE EVENT HAS NO CATEGORY FIELD, SO THE COLOR IS THE CATEGORY.** Ten
  of Google's eleven event colors map to a category; the site then draws its own
  palette from the key rather than Google's hues, so ten categories still read as
  one calendar. **Nothing is ever dropped for having the wrong color** — Flamingo,
  and the far commoner case of nobody touching the picker at all, land on a
  neutral "Other" rather than falling out of the feed. A church event silently
  missing from the church calendar is the worst failure this feature has, and it
  is the one the office is most likely to cause by accident. The office-facing
  copy of the table is in `public/manual.html`; change one, change both.
- **⚠ THE NEWS RECORD WINS THE WORDS AND GOOGLE WINS THE CLOCK.** The de-dupe
  collapses the same title on the same day, and the handoff says the News record
  wins because it has the richer copy — true, but taken literally it turns a 9:30
  service into a shapeless all-day chip, because a News record has no time column
  at all. The merged entry keeps the News description and Google's start, and its
  source reads `both` rather than picking a winner. **Two entries from the SAME
  source are never merged**: Google legitimately holds one title twice when a room
  is booked back to back, and collapsing those would delete a real booking.
- **⚠ THE PRINT SHEET IGNORES THE FILTERS ON SCREEN, AND IT IS THE ONE PLACE A CAP
  IS RIGHT.** Somebody printing the month for the narthex wants the month; a sheet
  quietly missing every category but one, because of a pill clicked five minutes
  ago, is wrong in a way nobody can see by looking at it. Its cells are a fixed
  112px with `overflow:hidden` because the sheet has to stay one page — a
  different promise from the screen's, which is why the screen has no cap at all.
  The whole page around it carries `data-noprint` (and the nav, hero, footer and
  newsletter band are hidden by selector), or the sheet lands on page two.
- **⚠ ONE PRINT SHEET IN THE DOCUMENT.** The `/news` mount is `compact` and draws
  none; `/calendar` owns it. Two would print two pages, the second a month nobody
  asked for.
- **⚠ NEVER A SEVEN-COLUMN GRID ON A PHONE.** 390px over seven days is about 50px
  each, which does not fit a date and a word — the same reasoning that had the old
  embed switching to Google's `AGENDA` view under 700px. Under 900px the renderer
  draws board 1c's week-grouped list instead, and it is chosen **in the renderer**;
  the CSS rule that also hides the grid is a second belt for a resize caught
  between the two. Unlike the iframe, re-rendering on resize costs nothing here —
  the old one deliberately did not follow a resize because reloading the embed
  lost the month somebody had navigated to.
- **A category with nothing in it this month gets no pill.** All eleven would be
  nine controls whose only possible outcome is the empty state, which is the
  dead-control rule this repo already holds everything else to. The currently
  selected one is kept even when the new month has none of it, so a filter can
  never become impossible to clear.
- **Everything degrades to something honest.** No credentials → the News & Events
  entries alone, and a line saying which half is missing with a link straight to
  Google Calendar. One calendar of two failing → the one that answered is kept and
  the page still says a calendar is missing. The whole feed failing → the link out,
  never an empty grid. A failed month is dropped from the client's cache rather
  than kept, so coming back to it tries again instead of showing the same failure
  forever. The route itself never 500s, because to the browser an error page is
  indistinguishable from the network being down.
- **`getGCalAccessToken()` is exported from `admin/gym.js` with a scope
  parameter** rather than copied. The default is the write scope the gym has
  always asked for, so its behavior is byte-identical; the reader asks for
  `calendar.readonly`. A second copy of JWT signing is a second place for a wrong
  byte to produce a token that silently never authenticates.
- **Two credential paths, and either works**: the gym's service account (each
  calendar shared with it as "See all event details"), or a plain `GCAL_API_KEY`,
  which reads a public calendar with nothing shared with anybody — which is what
  these two already are.
- **`calendar_google_ids` is a setting**, seeded with the two ids that were
  hardcoded in the old embed URL, so adding the school's calendar is a field
  rather than a deploy. ⚠ It is a different thing from `gcal_calendar_id`, which
  is the single calendar gym bookings are WRITTEN to.
- **⚠ The Calendar BLOCK is still a Google embed, deliberately**, and that is the
  one inconsistency worth knowing about rather than discovering: its URL field
  takes a Google Form and other embeds as well as a calendar, so it cannot simply
  become the church calendar — which means a page built in the editor with a
  Calendar block still gets Google's cap. `tlcCalSrc()` in `public/index.html` is
  gone with the embeds it served, so `calendarSrc()` in `admin/blocks.js` is the
  last implementation standing and its mirror test in `admin/blocks.test.mjs` now
  asserts exactly that.

**⚠ NOTHING HERE WAS VERIFIED AGAINST A LIVE GOOGLE, AND THAT IS THE ONE THING TO
CHECK FIRST.** `www.googleapis.com` and `calendar.google.com` are both unreachable
from this sandbox — the same wall the v5.15.0 note ran into. Every Google-facing
path is tested against stubs shaped like the documented API, so the request
parameters, the parsing and the failure behavior are pinned, but no real
`items[]` has ever been through this code. **Open `/calendar` with credentials set
and confirm a Sunday's services are all there, then check one all-day event
spanning several days lands on exactly those days.** If the events are there but
every one is gray, the color-to-category mapping is right and the office simply
has not colored anything yet.

**Requires two manual steps outside this repo, the same shape as the Square,
VAPID and ChMS keys before it** — until one of them is done the page shows News &
Events entries only and says so:

1. Either share both calendars with the existing service account
   (`GCAL_SERVICE_ACCOUNT_EMAIL`) as **See all event details** in each calendar's
   Google settings, **or** set an API key:
   `wrangler secret put GCAL_API_KEY --name tlc-newsletter-admin`.
2. Nothing else. `calendar_google_ids` is seeded with the two ids already in use.

Run: `node admin/calendar.test.mjs` (26 — the merge, the de-dupe, the exclusive-end
trap, the wall clock, the category fallbacks and the `.ics` writer, each verified
non-vacuous by injecting the bug it guards) and, in a browser,
`NODE_PATH=$(npm root -g) node test/public-calendar.test.mjs` (55 — the uncapped
Sunday, the filters, the phone list, the print sheet and both fallbacks; also
verified against injected regressions).

### The Christmas Market generalized into `/events`, and a new event can adopt a page instead of getting a second one (v5.27.0, 2026-08-18)

Built from `design_handoff_events/`, the follow-on to the market handoff below —
turns the market's own five-tab screen into a general shape any number of
events share: `site_events` / `site_event_fields` / `site_event_registrations`,
seeded from the market's own row so nothing about the market moved. `admin/events.js`
is the whole thing — `/events` (a list, `renderListSection`), `/events/new` (six
questions plus four capability toggles that decide which tabs an event gets),
`/events/:id` (Registrations · Page & copy · Money & dates · Volunteers · Photos,
present only per capability, every mutating route re-checking that ONE event's
own permission). `market-price.js` was never touched; `admin/market.js` now reads
and writes through `admin/events.js`'s generic functions via an adapter, so its
own screen, CSV export and public application are byte-for-byte unchanged.
`⚠ THIS FILE HAD NO ENTRY FOR ANY OF IT` until this pass wrote one — the section
below stayed the record of the market's own build; this is the record of the
system it became part of. See PR #467 for the six-phase breakdown.

**⚠ Creating a new event always minted a brand-new page, even for an event whose
page already exists.** Reported directly: *"if there is a page connected to it
already how do we fix that like VBS. so there arent two pages"* — VBS is a real
`pages` row already (`admin/site-pages.js`'s youth-family seed, `/vbs`), and
`createEvent()` had no way to know that. `pageSlugify('Vacation Bible School')`
would have landed on `/vacation-bible-school` (or, worse, on a `uniqueSlug()`
collision fallback like `/vbs-2` if a title happened to slugify to `vbs`) — a
second live address for the same event, with the real `/vbs` sitting there
unconnected.

- **"Its page" is a new question on `/events/new`**, a `choice` field (per this
  repo's own ≤4-options-is-chips rule — the candidate list is every unlocked,
  non-outbound page not already claimed by another live event, easily more than
  four) offered ABOVE "Or start a new page from," which only fires when "Its
  page" is left on "Create a new page." Picking an existing page skips page
  creation entirely: `addRegistrationBlockToPage()` — one function, shared with
  the Page & copy route below so both paths behave identically — appends a
  `registration` block to the page's DRAFT `blocks` only, never `published_blocks`,
  the same draft-only rule every other write in this admin follows. Everything
  already on the page — words, photos, layout — is untouched; a page that takes
  no registration is still linked with no block added at all.
- **`/events/:id/connect-page` and `/events/:id/disconnect-page`** on the Page &
  copy tab retrofit this for an event created before the picker existed, or one
  whose auto-created page was the mistake in the first place — connecting never
  deletes the stray page (an office person can delete it from the Pages screen
  once they've confirmed it's really unwanted; this file deliberately does not
  duplicate that screen's own delete guardrails — locked pages, orphaned
  children, redirect cleanup — here), and disconnecting never deletes the real
  one. Gated on `canEvent || canPages`, the same pair the tab's own visibility
  already checks.
- **The candidate list excludes `locked` pages and outbound (`external_url`)
  ones** — a redirect page like `/mdo` has no blocks to add a form to, and a
  locked page belongs to the site's own chrome, not to any one event.
- Verified against the real seeded `/vbs` row, not a stand-in for it — the test
  boots the actual Worker, confirms `/vbs` is already present before the event
  exists, and asserts the page count doesn't move.

Run: `node --experimental-loader ./test/html-loader.mjs test/events-admin.test.mjs`
(140 assertions).

### A Square payment reconciles itself, and a vendor can pay by check (2026-08-18)

Dinger: *"i made a payment through the site for a vendor, but it does not
record it in the system that a payment is made. is there a way to connect
back from square that a payment was made?"* — then, choosing the exact-match
design over a best-effort amount/time guess: *"will it apply the fees to the
transaction like it does now? And what about those that will pay by check? i
dont see an option for that."*

**Reconciliation was never built for any provider — that was deliberate, and
is why `amount_paid_cents` reads NULL rather than a number until a human
looks.** Tithe.ly and Square both take the vendor's card without telling this
Worker anything back. Square is the one of the two with a webhook worth
building against, so it is the one that gets it; Tithe.ly is unchanged.

- **⚠ THE STATIC PER-TABLE-COUNT LINKS CARRY NOTHING TO MATCH ON.** The
  office's own pasted Square Payment Links (`settings.squareLinks`, one per
  table count) cannot say *which vendor* paid — twelve different one-table
  vendors produce the same amount on the same link. So matching by amount and
  rough timing was the fallback design, and it was rejected for exactly the
  reason it exists: it can be wrong, silently, the one time two vendors buy
  the same table count the same afternoon.
- **The fix is a payment link per application, not per table count.**
  `admin/square.js`'s `createSquarePaymentLink()` calls Square's Checkout
  Links API (`POST /v2/online-checkout/payment-links`, `quick_pay`) once, at
  the moment `/api/market/apply` saves the row, and the resulting `order_id`
  — read directly off that same creation response, never a later lookup —
  is stored on `site_event_registrations.square_order_id`
  (`updateRegistration(env, id, { square_order_id })`, admin/events.js's own
  generic column-patcher — no new write path needed). A `payment.updated`
  webhook later matches on that id alone. Exact, not probable.
- **⚠ The office's static per-table links are NOT removed — they are the
  fallback, unchanged.** `marketPayUrl()` still exists exactly as it did;
  dynamic creation is attempted first when the market is on Square, and any
  failure (Square down, `SQUARE_ACCESS_TOKEN`/`SQUARE_LOCATION_ID` not yet
  set, a bad request) falls back to it silently — the same shape every other
  integration on this site degrades by (Turnstile, the ChMS intake key,
  VAPID). A vendor must never be unable to pay because Square's API had a bad
  minute.
- **⚠ The fee math does not change, and could not have — it was never
  Square's job.** `priceBreakdown()` (`market-price.js`) still computes the
  grossed-up total; Square is only ever handed the finished number
  (`quick_pay.price_money.amount`) to charge. Automating *reconciliation* is
  a separate question from computing *the amount*, and this feature only
  touches the first.
- The idempotency key is derived from the registration's own row id
  (`market-vendor-${id}`), not random, so a retried request cannot create a
  second link for one application.
- **Sandbox and Production are different HOSTS in Square's API, not just
  different tokens** — `connect.squareupsandbox.com` vs `connect.squareup.com`.
  `SQUARE_ENVIRONMENT` (a Worker secret, defaults to production) is the switch.

**Pay by check or cash is a real third option in the form now, not a line of
fine print pointing at an email address that created no record.** Before
this, a vendor who could not or would not pay online had exactly one path —
email the coordinator — and that path never touched
`site_event_registrations` at all. If the coordinator forgot, or was slow,
that vendor simply did not exist to the system. The same failure this repo's
own rule about the Google Form (2024) warns against, self-inflicted a second
time on the very form that replaced it.

- **A step-3 chip pair, "Pay online now" / "Pay by check or cash,"** stores
  `payment_method` on `sanitizeApplication()`'s `value` (`card` default,
  matching every application that already existed before this shipped) and
  rides through to `fields_json` via `marketFieldsFromValue()` — there is no
  dedicated column, because the whole point of the generic
  `site_event_registrations.fields_json` blob is that a field like this needs
  no schema change to exist.
- **⚠ `marketInsertArgs(value, price, photos)` is where the flat-fee rule
  actually lives**: `amount_due_cents` is `price.subtotalCents` for a check
  application, `price.totalCents` for a card one. `subtotalCents` is exactly
  `tables × tableFee` — the same figure `priceBreakdown()` was already
  computing for the "1 table × $X" display line — so **no new pricing
  function** was needed, only the right field of the one that already
  exists.
- **⚠ `payment_status` stays `'unpaid'` for a check application. It does NOT
  get its own enum value.** Every filter, every CSV column and every existing
  test keys off the four-state `PAYMENT_STATES` (admin/events.js); adding a
  fifth state for "owes money, paying by check" would be the exact kind of
  state nobody remembered to teach every reader about. `paymentLabel(row)` in
  `admin/market.js` is purely presentational — it overrides the *displayed*
  label to "Awaiting check" when `payment_method==='check' &&
  payment_status==='unpaid'`, and nothing else reads it. The coordinator's
  list, the CSV export and the vendor-edit drawer all render through it now;
  the FILTER pills still key on the real `paymentState()` value, never the
  relabel.
- **`marketRowFromRegistration(reg)` reads `payment_method` back out of
  `fields_json`, defaulting to `'card'`** — a registration saved before this
  shipped has no such key at all, and reads exactly as every application
  before this feature did.
- The application is saved before there is anything to redirect to — same
  rule as every card application, restated for the path that has no payment
  step at all. A check vendor never leaves the page mid-application; there is
  no page to send them to.
- The confirmation emails (`coordinatorEmailHtml`/`vendorEmailHtml`,
  `admin/market.js`) branch on `payment_method`, both to the vendor (asks
  them to bring a check made out to Timothy Lutheran Church, or exact cash,
  for the flat fee — no processing-fee line, since there is none to explain)
  and to the coordinator (says the same, so nobody re-derives the amount from
  the wrong total).

**Requires a manual step outside this repo, the same shape as the ChMS
intake key and the VAPID push keys before it**: none of this does anything
until Square secrets are set on the Worker. In the Square Developer
Dashboard, create an Application, then take its **Access Token** (there are
separate Sandbox and Production tokens — use Sandbox first), its **Location
ID**, and — from the application's Webhooks page, after adding a
subscription pointed at `https://admin.timothystl.org/api/square/webhook`
for the `payment.updated` event — the **Webhook Signature Key** Square
generates for that subscription. Then:

```
wrangler secret put SQUARE_ACCESS_TOKEN --name tlc-newsletter-admin
wrangler secret put SQUARE_LOCATION_ID --name tlc-newsletter-admin
wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY --name tlc-newsletter-admin
wrangler secret put SQUARE_ENVIRONMENT --name tlc-newsletter-admin   # "sandbox" while testing; omit or set to anything else for production
```

Until all three of the first are set, every application silently falls back
to the static link — nothing breaks, nothing charges the wrong amount, the
reconciliation simply does not happen yet. The market also has to actually
be switched to Square (`/market?tab=money` → Payment → provider) — on
Tithe.ly, this whole feature is inert by design; Tithe.ly already resolves
its amount at request time with no reconciliation gap to close.

**⚠ The webhook header name and Square's API version date were not verified
against a live Square account — this sandbox has no outbound access to
Square's API at all.** `admin/square.js` reads the signature from
`x-square-hmacsha256-signature` and sends `Square-Version: 2025-01-23`; both
are recorded here as what should be true rather than what was confirmed.
**Before relying on this in production, use Square's own Sandbox dashboard
("Send test event" on the webhook subscription) to fire a real
`payment.updated` event at `/api/square/webhook` and confirm it returns 200
and marks the right row paid.** If the header name is wrong, every event
will 401 and nothing will silently look successful — see
`verifySquareSignature()` in `admin/square.js`.

Run: `node admin/square.test.mjs` (16 — the signature check is verified
against an independent HMAC computed with Node's own `crypto` module, the
same shape as `admin/webpush.test.mjs`), `node admin/market.test.mjs` (206,
`paymentLabel`, `marketRowFromRegistration`/`marketInsertArgs` field
round-trips, and the CSV/email wording), `node admin/blocks.test.mjs`
(3131, the chip markup and the fee row it hides), and six new groups in
`test/admin-redesign.test.mjs` covering the flat-fee check total against the
grossed-up card default, the Square link's `order_id` being captured from
the creation response rather than a later lookup, the silent fallback to the
static link when Square is unreachable or unconfigured, and the webhook
itself — matching by order id alone, being idempotent against a redelivered
event (one audit-log entry, not two), rejecting a bad signature, and
ignoring (200, untouched) a payment that is not one of ours.

### The Christmas Market is an event section (v5.23.0, 2026-08-18)

Built from `design_handoff_market_event/`, committed whole like the other
handoffs. Options 1b (the public split) and 1c (five admin tabs) were the
approved ones. Four phases, four commits.

**Phase 1 — the vendor page is published, and the hardcoded copy is gone.**
`admin/market-page-seed.js` had been sitting as a draft since v5.18.0 while
`public/index.html` rendered the real page. Both existed, so both could drift.
The seed was reconciled against the live markup (the hardcoded copy was
authoritative), a marker-gated migration writes `published_blocks`, and the
~350 lines of `#page-marketvendors` markup and its `data-mkt-*` fallback spans
are **deleted**.
- **⚠ `canReseed()` refuses anything already published**, so once Phase 1 runs,
  the ordinary seed loop can never correct this page again. `MARKET_PUBLISH_MARKER`
  carries a **version** value for exactly that: bump `MARKET_PUBLISH_VERSION` and
  the block re-runs, guarded only on `updated_by === 'migration'` so it still
  never touches a page a person has edited.
- **⚠ THIS PAGE MUST STAY PUBLISHED.** There is no hardcoded fallback behind it
  any more. Two assertions in `test/admin-redesign.test.mjs` that pinned it as
  an unpublished draft were inverted, which is the diff that looks like a
  regression and is not.
- **`tlcMarketInit()` and the `.mkt-*` CSS were kept**, on Andrew's instruction,
  though the handoff's claim that the `marketapp` block needs them is **false** —
  the block ships its own delegated `MARKET_APP_SCRIPT` behind
  `window.__tlcMktAppWired` and uses `.tlcb-mktapp-*` classes throughout. The
  comment above `tlcMarketInit()` says so, and says not to wire it back up.

**Phase 2 — two pages: the pitch, then the form.**
`/christmasmarket/vendors` keeps the rules, the details, the photographs and
the FAQ; `/christmasmarket/vendors/apply` (`marketvendorsapply`,
`admin/market-vendors-apply-seed.js`) is a moss banner, a facts band and the
application, and nothing else.
- **⚠ The `marketapp` block was REMOVED from page A, not hidden.** A hidden
  block is one somebody finds later and switches on, and then the market takes
  money at two addresses.
- **`marketfacts` is a new block type** and it is the reason the split is safe:
  the day, the hours, the fee and the coordinator appear on both pages and are
  **read from the settings on both**, so there is no typed copy to go stale in
  December. It falls back to `MARKET_DEFAULTS` field by field, the same rule the
  application block already carries — a genuinely empty `data.market` must print
  the figures a visitor would really be charged, never "undefined".
- **⚠ Four places have to agree about a nested address**, and they do:
  `NESTED_PATHS` in `public/index.html`, `NESTED_PATHS` in `site-worker.js`, the
  router's own case, and the page record's `slug`. The mirror test in
  `test/site-edge-render.test.mjs` covers the first two.
- **`tlcMarketInit()`'s router call moved to `marketvendorsapply`**, keeping the
  v5.8.0 ordering rule: the script has to be declared ABOVE the router, or a
  direct visit hits a hoisted-but-undefined `tlcMarketCfg`.
- Added to `public/sitemap.xml`. No 301 — nothing moved, one address was added.

**Phase 3 — `jumplinks`, and every block carries its own id.** See the commit
and the test group; the load-bearing parts are that auto mode derives the chips
from the page so there is nothing typed to fall out of step, that
`.jump-bar--stuck{top:67px}` rather than the handoff's 0 (the nav is sticky at
`z-index:100` and 67px tall, so a bar at 0 slides underneath it), and that the
CSS is in `BLOCK_CSS` rather than `public/styles.css` as §5 says — **the editor
canvas never loads the site stylesheet**, so a bar styled there would be
invisible in the one place somebody is arranging it.
- **⚠ `blockDomId()` gives every block an `id` now**, and is the one place both
  halves are decided. A hand-typed Jump-to name still wins and is used **bare** —
  see the entry above, where the `jump-` prefix turned out to be a bug: the box
  on screen said one thing and the page answered to another. The fallback is the
  block's own id. `renderPage` passes `siblings` down, which is what
  auto mode reads — **a block rendered with no siblings genuinely renders no
  chips**, and that is why several test loops pass `siblings` explicitly.
- **⚠ One bar per page.** Two sticky bars stack and the second's links land
  under the first. The first renders; the rest render nothing on the page and
  say why in the editor.
- `INSERT_BLOCKS` in `tools/extract-pages.mjs` is how `/christmasmarket` got
  its bar: navigation over the content, which the extractor cannot find in the
  markup because it is not content. Only that one page this release.

**Phase 4 — `/market` is five tabs.** Vendors · Page & copy · Money & dates ·
Volunteers · Photos, switched by `?tab=`.
- **⚠ A tab a reader cannot use is ABSENT, not disabled**, and the default is
  the **first tab that reader can open** rather than a hardcoded Vendors —
  otherwise the office person holding only `pages_edit` lands on an empty screen
  and concludes the tab is broken. Asking for a tab by name that you cannot see
  lands you on one you can.
- **⚠ Only the active tab is BUILT.** Rendering all five and hiding four would
  read seventy vendors' home addresses, every page's blocks and the volunteer
  roster on every view — and put that PII in the markup of a tab somebody opened
  to fix a photograph's description.
- **Two more permissions reach the page**: `pages_edit` (Page & copy) and
  `ministries_edit` or `pages_edit` (Photos), joining `market_manage`,
  `settings_manage` and `giving_manage`. **Every mutating route still checks its
  own** — `pages_edit` alone still gets a 403 from `/market/export.csv` and from
  `/market/settings`.
- **⚠ Page & copy does NOT reorder blocks**, and that is a deliberate departure
  from the handoff's drag-to-reorder section list. Blocks are arranged in the
  page editor, where the canvas shows the result; a second surface writing the
  same `blocks` column is the two-forms-one-key trap. The list here is a
  read-only table of contents beside a real link into the editor, plus a plain
  statement of whether what a visitor sees is what is in the draft.
- **⚠ Photos has NO uploader.** One upload path (`/api/upload-image`, from the
  editor's own picker) and one `ministry_media` row per photograph is what makes
  "used nowhere" and the size warnings on the Media screen true. What this tab
  adds is the one thing the library cannot do: show only the market's
  photographs and let a missing description be fixed without hunting.
- **Volunteers is a read-only GET of `serve.timothystl.org`** — no single
  sign-on, no write-back, and a **4-second timeout**, because an admin screen
  must not sit waiting on another application. Roles sort most short-handed
  first (sorted by name it is a list; sorted by what is missing it is a
  worklist). ⚠ A reply whose shape this screen cannot read is treated as no
  reply — a proxy answering 200 would otherwise draw four tiles of zeros and
  present them as the roster. An unreachable Serve degrades to the button that
  always works. **The endpoint is being built in the sibling `chms` repo; until
  it exists this tab shows its honest empty state, which is the intended
  behavior and not a defect.**
- **The sidebar has a sixth group, `Events`** (`GROUPS` in `admin/helpers.js`),
  holding Christmas Market and Gym Rentals — the two screens that are a thing
  the church PUTS ON, a date and a room and people turning up. Giving and
  Payroll stay under Money & Building, being the church's own money rather than
  an event's. ⚠ The market's sidebar ROW is gated on any of the five permissions
  now, or the page writer would have no way to reach the pages they own; the
  unpaid-application badge still needs `market_manage`.

**Run:** `node admin/blocks.test.mjs`, `node admin/market.test.mjs` (the price
assertions are untouched — `market-price.js` was never edited),
`node --experimental-loader ./test/html-loader.mjs test/admin-redesign.test.mjs`
(the five-tab group signs in as five different presets), `node
test/market-vendor.test.mjs` (rewritten against the block-rendered apply page),
`node test/site-edge-render.test.mjs`, and `node test/public-phone.test.mjs`,
which measures the jump bar at 390px. Every new group was verified
non-vacuous by injecting the regression it guards.
### Two more bugs in the jump-to-name feature, one of them site-wide (v5.22.0, 2026-08-17)

Two follow-up reports, both real, both traced to the ground.

**"In button fields to go to websites the typing doesn't work. I will type
and it will go crazy."** The debounced round trip that saves a free-text
field (`url`, `contactEmail`, `photoAlt`, `cardBody`, item fields, and now
`anchorId`) rebuilds the whole inspector panel and refocuses the field it
came from — but a plain `.focus()` on a freshly built `<input>` puts the
caret at position 0, not wherever it was. Pause mid-address for the 700ms
debounce to land — which typing a URL naturally invites, more than a short
field like an email address does — and the next keystrokes land at the
START of what's already there instead of the end: `"https://www."` +
`"timothystl.org"` became `"timothystl.orghttps://www."`. Fixed in
`renderInspector()` (`admin/ministry-editor.html`): the caret's
`selectionStart`/`selectionEnd` are captured before the rebuild and restored,
clamped to the new value's length, after focus is put back. Every field on
this debounced path shares the one fix, not a `url`-only patch.

**"i created a #application jump to, created a button that would go there,
and when i publish it and click on that button it takes me to the home
page."** Two separate bugs stacked here, and only fixing the first would
still have left the button broken:

- **The target block's own `id` didn't match what the screen promised.**
  `id="jump-<name>"` was chosen for namespace safety when this shipped, but
  the inspector's own note — and everything said about this feature —
  promised "link to `#<exactly this>`," with no mention of a hidden prefix.
  A button linking to `#application` was never going to find an element
  whose real id was `jump-application`. Fixed by dropping the prefix
  (`admin/blocks.js`): the id is now the bare, sanitized name, so what's
  shown on screen IS the address, not a value close to it.
- **⚠ Even with a matching id, the click still went to the homepage — a
  site-wide bug this feature was simply the first thing to actually
  exercise.** Clicking a plain same-page `<a href="#name">` makes the
  browser push a fresh history entry for the new hash, and Chrome fires a
  `popstate` event for that — not just `hashchange` — the same event
  Back/Forward fires, and with `e.state` null, exactly like the "nothing
  left in history" case. The site's own `popstate` handler
  (`public/index.html`) read a null state as "go home," which is right for
  a real Back-past-everything but wrong for a same-page jump, and it had
  been wrong for **every** bare `#fragment` link on the site since the SPA
  router was written — nothing had ever surfaced it, because every other
  internal link calls `event.preventDefault()` before the browser can even
  begin that sequence, and this feature's whole reason to exist is a link
  that does *not* do that. Fixed by having the handler fall back to
  `location.pathname` instead of a hardcoded `'home'` when `e.state` is
  null, and — critically — doing **nothing** if that resolves to the page
  already showing, rather than calling `showPage()` again: a same-page call
  would `scrollTo(0,0)` and undo the very jump the click was for.

Verified end to end against the real click sequence, not reasoned about:
BOTH the old id-mismatch shape and a correctly-matching id were driven
through a real browser with the *old* popstate handler first — both
bounced to home identically, which is what proved the id mismatch was never
the whole story. Only after both fixes landed together did the button
actually scroll to its target and stay on the page.

Run: the caret-restoration assertions in `node test/editor-edit.test.mjs`,
and the `a jump-to-name button actually jumps, instead of bouncing to home`
group in `node test/public-page.test.mjs` — driven against the real
`public/index.html` and a real popstate sequence, not a stand-in.

**And it still wasn't the whole story (v5.24.0, 2026-08-17).** Dinger, after
the fix above: *"still going to home page. also refresh isnt reloading the
page."* Right on both counts, and the reason the first fix's own test passed
is exactly why it missed this: it used `/give`, a page whose id and address
are the same string. The page Dinger was actually testing on — the Christmas
Market vendor application — is `id: 'marketvendors'` at address
`/christmasmarket/vendors`, a `NESTED_PATHS` entry precisely *because* the
two differ.

- **The popstate fix's own fallback re-derived the page id from
  `location.pathname`** with a plain `document.getElementById('page-' +
  path)` lookup — so on `/give` it happened to find `page-give` and looked
  correct, and on `/christmasmarket/vendors` it looked for
  `page-christmasmarket/vendors`, found nothing, and fell back to `'home'`,
  identically to the bug it was meant to fix. **The fix was never "resolve
  the right id" — it only needed to answer "did the path change at all,"**
  which a `#fragment` click never does. `lastKnownPath`, set to
  `location.pathname` everywhere `showPage()` itself sets the address bar,
  turns the popstate handler's question into a plain string comparison: an
  unchanged path can only mean this is the in-page jump case, whatever the
  page's id happens to be. No path-resolution logic to keep in step with
  `NESTED_PATHS` at all, in either direction.
- **"Refresh isn't reloading the page" was real too, and separate: a full
  load or reload with a jump-to-name fragment still in the address bar
  always landed at the top.** `showPage()` unconditionally called
  `window.scrollTo(0,0)`; a fragment was never consulted at all. Fixed with
  `tlcScrollToHash()`, tried once synchronously and — because the block
  content a fragment might target is almost always still loading at that
  point, arriving only once the `/api/pages` fetch resolves — tried again
  after that promise chain settles.
- **⚠ THE RETRY HAS TO BE HANDED THE HASH, NOT READ IT FRESH.** By the time
  the retry runs, `showPage()`'s own `history.replaceState` — built from
  `tlcPathFor(id)`, which never carries a fragment — has already erased it
  from the address bar. `location.hash` at retry time reads empty every
  time, which is exactly the moment this needs to still know what was
  asked for. `showPage()` captures `hash = location.hash` in its own first
  line, before anything can touch the address bar, and both the immediate
  attempt and the retry are handed that same captured value.

**Verified against the real gap, not the one already fixed**: the browser
test now visits `/christmasmarket/vendors` — the real nested address — not
`/marketvendors`, and a version of this fix that only had the `lastKnownPath`
half (no captured-hash retry) still fails the reload assertion; a version
with only the retry half still fails the click assertion. Both are needed.

Run: the same `a jump-to-name button actually jumps, instead of bouncing to
home` group, rewritten in `node test/public-page.test.mjs` against the
nested address, with a `page.reload()` case added.

### A block can be given a jump-to name (v5.20.0, 2026-08-17)

Dinger: "how do i add a button on the page that will quick link it to further
down the page." There was no way — `safeUrl()` had always accepted a leading
`#` on any URL field (a button's link, a card's link, a link typed into a
paragraph), but nothing on a page ever carried an `id` for one to land on, so
typing `#anything` into a link was a dead end that looked like it should work.

**Jump-to name** is a new field on every block's inspector, right below
Spacing — deliberately not gated behind a `def` flag the way most per-type
fields are, the same as `width`/`spaceAbove` above it: any block can be the
destination of a jump, not just the ones a particular type declares.

- `cleanAnchorId()` in `admin/blocks.js` collapses whatever is typed to
  letters, digits and hyphens — the same shape `slugify()` gives a page
  address, right down to reading `&` as "and" — so a name typed here and a
  name typed as a page title produce the same kind of slug. Sanitized on the
  way in like every other field; nothing but that character set can ever
  reach the page.
- **⚠ The box shows the SANITIZED value, not what was typed, and that is
  deliberate rather than a rough edge.** `anchorId` goes through the same
  debounced `rerender()` round trip `url`/`contactEmail`/`photoAlt` already
  use — 700ms after typing stops, the server's cleaned value comes back and
  replaces what's in the box. Once it settles, what's in the box IS what a
  button's link field needs typed into it: `#` plus exactly that. No second,
  client-side slug preview to keep in sync with the server's — the real
  round trip already tells the truth a beat later.
- **The `id` itself is prefixed** (`id="jump-<name>"`, not the bare name) —
  a block's own id is one more thing sharing the page's ID namespace with
  the SPA's own `id="page-<id>"` divs, the router's anchors, and whatever
  else. A collision there is a much stranger bug than a slightly longer
  fragment.
- **⚠ `.tlcb` picked up `scroll-margin-top:88px`, on every block, not only
  named ones.** The site's nav is `position:sticky`, 64px tall plus its 3px
  rule — without this, jumping to a block tucks its top edge, headline and
  all, behind the bar. Universal because any block can end up on the
  receiving end of a fragment link, the same reasoning `anchorId` itself
  is universal.
- **No collision detection.** Two blocks on one page sharing a name is a
  typo, not a case worth a warning UI for — the browser resolves duplicate
  ids to whichever comes first in the DOM, which is a page authoring mistake
  and not the kind of silent damage this editor's guardrails exist to catch.
  Left for the office to simply not reuse a name, same as it already relies
  on nobody typing the same page title twice.
- **The dead-link checker needed no change.** `linkKind()` in `admin/links.js`
  already special-cased anything starting with `#` as `kind: 'anchor'`,
  passing it through with no warning — it could never validate whether the
  anchor existed, so it simply didn't try. That stays true; a `#name` still
  isn't checked against the blocks that actually carry it, only accepted as
  a shape of address the sanitizer will not strip.

Run: the `A block can be given a jump-to name` group in
`node admin/blocks.test.mjs`.

**And the field pointing AT a jump-to name had no way to say so (v5.21.0,
2026-08-17).** Told how to set a Jump-to name, Dinger came back with: *"in the
button I want to have jump to it only is allowing for full website url or
page names."* Nothing was actually refusing `#name` — `linkField()` has
always been a free-text box, and `safeUrl()` has always accepted a leading
`#` — but the box gave no reason to believe that. Its placeholder is
`https://…` (or similar, per type), which reads as documentation of what the
field takes rather than an example, and the "Pick a page on this site…"
picker beside it is a real menu with real items in it, none of which is ever
a jump-to name — it cannot list one, because a name lives on a block, not in
`linkTargets()`. Between a placeholder that only shows a URL and a picker
that only shows pages, `#name` had no visible home anywhere on the screen.

- **A standing line under the box, not a smarter placeholder.** A
  placeholder disappears the instant somebody starts typing, and it would
  have needed rewriting in every one of the half-dozen `itemPlaceholders`
  that give a `url` field its own wording ("Where it goes", "A handout to
  download (optional)", "Link (optional)" …) — some of which are not really
  navigational, and forcing "or #name" into all of them would be true of a
  few and noise on the rest. One line added to `linkField()` itself reaches
  every `url` field on any block, whichever placeholder it carries, and is
  visible before anyone types a character.
- **⚠ Not the `.ed-linkwarn` line right below it.** That element is styled in
  the "Problem" ink (`#8C3A28`) and is empty until something is actually
  wrong — using it to state a normal, always-true fact would either put a
  brick-red sentence under every link field on the site, or require
  overloading its color logic for a state that isn't a problem at all. The
  new line is a plain `.ed-note`, the same neutral gray every other helper
  sentence in this inspector already uses.

Run: the new assertion in the `a card grid has picture fields, not address
boxes` group of `test/editor-media.test.mjs`.

### Every Christmas Market setting moved onto the Christmas Market screen (v5.19.0, 2026-08-17)

Dinger, after being pointed at "Most tables one vendor may take" tucked into
the generic Settings screen with nothing on the Christmas Market screen
linking to it: *"that section seems locked in"* — then, once shown it was
just hard to find: *"if all christmas market settings ... can move to the
christmas market tab that would be helpful."*

**All nine `market_*` settings were three-way scattered on purpose, and that
purpose still had to survive the move.** The date/hours/fee/table-limit/
coordinator-email seven needed `settings_manage` (an office/pastor decision);
the Tithe.ly fund and the Square-vs-Tithe.ly choice needed `giving_manage`
(the church's payment-account internals); the vendor list and the
applications toggle needed `market_manage` — and the whole point of
`market_manage` being its own permission, since v5.8.0, is that Marla the
coordinator can hold it **alone** and never see the other two. Gating the
consolidated screen on `market_manage` the way the vendor list always was
would have quietly taken settings/payment editing away from **two real
presets that already have it** — 'Office staff' holds `settings_manage`
without `market_manage`, 'Bookkeeper' holds `giving_manage` without it.

- **`/market` is reachable by any of the three permissions now, not just
  `market_manage`.** Each *panel* — and each *mutating route* — still checks
  its own: `/market/export.csv`, `/market/update`, `/market/delete` and
  `/market/applications` all require `market_manage` specifically, whoever
  else can open the page. A test signs in as each of the three presets and
  asserts what they do and do not see — including that `settings_manage`
  alone gets a 403 from the CSV export, which is seventy vendors' home
  addresses and phone numbers.
- **Two new routes, `/market/settings` and `/market/fund` +
  `/market/payment`, replace `/settings/update`'s old market keys and
  `/giving/market-fund` / `/giving/market-payment` outright** — not
  alongside them. The seven settings came out of `/settings/update`'s
  `SETTABLE` allowlist entirely; posting one there now 302s to
  `settings-error`, the same refusal an unknown key gets. Two routes writing
  one key is the exact "two forms disagree about what a key means" trap this
  repo has warned about since the Foundations pass — the fix is one route,
  not a second one that happens to agree with the first today.
- **The seven Settings rows stay listed, but as pointers.** `give_url`'s own
  pattern — `href: '/market'` instead of the generic `/settings?edit=<key>`
  drawer — because someone searching Settings for "market" should still find
  something, even though the field opens somewhere else now. `market_fund_id`
  and `market_payment_provider` joined that list too, for the same
  searchability, though they were never on Settings before.
- **`admin/ui.js`'s `renderField()` is exported now.** `renderFormSection()`
  wants to own the whole page — its own `<h1>`, its own cancel link — which
  is wrong for a form that has to sit as a PANEL beside the vendor list
  rather than as its own address. Exporting the one field-builder both
  already share means the new panels use the same field vocabulary
  (`number`, `chips`, the plain-text default) instead of hand-rolled markup
  that would drift from it.
- **⚠ `>Payment<` and `Market settings` are both bad test markers, and the
  first attempt at this used them.** The vendor list's own fourth column is
  literally labeled "Payment" (`admin/sections.js`'s market columns), and the
  no-`market_manage` bare header's own purpose line says "Christmas Market
  settings and payment" — so an *absence* check against either string passes
  or fails for the wrong reason depending on who is looking. The tests key on
  a field unique to each panel instead — "Tithe.ly fund ID" for Payment,
  "Most tables one vendor may take" for Market settings.
- **The coordinator's toggle (`market_applications_open`) did not move, and
  is not on the Settings allowlist either** — same rule as before this
  release, restated because it would have been easy to fold it into the new
  `/market/settings` route while everything else was moving. It already has
  its own route and its own reason to stay `market_manage`-only: whether the
  market is taking money today is the one decision that belongs to whoever
  runs the event, not to whoever manages the office's settings generally.
- `public/manual.html`'s annual checklist rewritten to match — "Admin →
  Christmas Market" for all of it now, not "Admin → Settings, search for
  market" plus a separate trip to the Giving tab.

Run: the `the vendor list is gated on its own permission`, `the Christmas
Market fund ID is set from the Christmas Market screen` and `the other seven
market settings moved to the Christmas Market screen too` groups in
`test/admin-redesign.test.mjs`.

### /christmasmarket/vendors is on the block editor now, with its own application block (v5.18.0, 2026-08-17)

Dinger, after the copy correction above landed: *"and how do i edit this page
in the future? can you add to the pages? or make it subset of
christmasmarket"* — offered three ways to get there (a quick admin-editable
text field for just the rules copy, folding it under the Christmas Market
tab as a sub-screen, or the full Pages editor with a custom block built for
the application), and picked the full editor.

**The page was never a candidate for the generic extractor**, which is what
turned every other page on the site into blocks. `tools/extract-pages.mjs`'s
own `PAGES` list — the map of every SPA page id to its address, written when
the extractor shipped — was never updated to include `marketvendors`, because
the page did not exist yet: it was built directly in `public/index.html` in
v5.6.0/v5.8.0, after that list had already been settled. Even if it had been
in the list, the extractor could not have produced anything useful from it —
this is the same shape of problem `give.timothystl.org` is, a live
three-step form with a running total, not prose to lift.

**So this is `admin/give-landing-seed.js`'s pattern a second time**:
`admin/market-page-seed.js` is a hand-authored block list, inserted into
`ALL_SEEDED_PAGES` in `tlc-admin-worker.js` alongside the generated
`SITE_PAGES`. It lands in the **draft only** — `published_blocks` stays NULL,
so `/christmasmarket/vendors` keeps rendering the hardcoded markup in
`public/index.html`, `tlcMarketInit()` and all, until somebody opens the
editor, reads the draft against the live page and presses Publish.

**⚠ UNLIKE give-landing, this page is not excluded from `/api/pages`.**
give.timothystl.org only has a `pages` row so it can borrow the editor,
publishing and revisions machinery — it is a different hostname's page and
would make a third giving surface if the SPA ever served it too. This page
*is* an ordinary SPA page; visitors reach it at its own address inside
`timothystl.org`, so it goes through the same `/api/pages` list, the same
`children`/menu resolution and the same edge-render injection every other
converted page does. A test asserts both directions — the seed is a normal
member of `api.pages`, and `give-landing` is still the one page that is not.

**A new block type, `marketapp` — "Market application" — because the payment
widget cannot be prose, and it needs the same guarantee `giving` and
`amounts` already carry.**

- **⚠ NO url FIELD, AND IT CANNOT HAVE ONE.** Same rule as the two
  giving-page blocks, for the same reason: what a vendor is charged and where
  the payment goes both come from `priceBreakdown()`/`marketConfigFromRows()`
  (`market-price.js`, `admin/market.js`) at the instant they submit, resolved
  through the Giving tab's base link exactly as the market's Square/Tithe.ly
  payment link already was before this — never stored on the block, because a
  block's value is frozen the moment the page is published and a stored
  address would go on charging to the old form after the office changed it.
  `sanitizeBlock` gates `url` on the type declaring one; this type simply
  never does, so a crafted POST carrying an address is dropped regardless.
- **The pure pricing math moved to `market-price.js`, a new top-level leaf
  file with no `admin/`-internal imports — mirroring `give-link.js` beside
  it, and for the identical reason.** `admin/blocks.js` needed the same
  `priceBreakdown()`/`money()`/`MARKET_PRICING_JS` that `admin/market.js`
  already exported, but `admin/helpers.js` imports FROM `admin/blocks.js`
  (for `sanitizeRich`), so `admin/blocks.js` importing `admin/market.js` —
  which imports `admin/helpers.js` — would complete a circular import. Node
  tolerates that in simple cases; Cloudflare Workers' module loader is not
  guaranteed to, so the cycle is avoided outright. `admin/market.js`
  re-exports everything from `market-price.js` so every existing caller,
  including its own test file, is unchanged.
- **What IS editable: the intro above the form, and the vendor agreement's
  nine clauses — as an item list, the same shape the FAQ block already
  uses.** A clause can be added, removed, reordered or reworded without a
  developer. Everything else — the fields, the pricing math, the payment
  hand-off — is fixed, because it is the one thing on this page that
  actually takes money and it has already been tested end to end (PR #438).
- **⚠ A clause with no words is dropped, ON THE PUBLIC PAGE ONLY.** In the
  editor every item stays, even a freshly-added blank one — that empty box is
  the only thing there is to click into and type, the same reason a block
  that renders nothing still renders something while somebody is arranging
  it. The array index a clause's `itemField` writes back to is the same
  either way: nothing is filtered while editing, and public rendering never
  reads that index at all.
- **⚠ Every numeric field the block reads directly falls back to
  `MARKET_DEFAULTS`, not just the ones `priceBreakdown()` touches
  internally.** The facts line and the fee-percent label read `market.X`
  straight, and the first version of this did that with no fallback of its
  own — so a genuinely empty `data.market` (the admin unreachable, the query
  failed) rendered the literal word "undefined" into the page instead of the
  $30/2.9%/30¢ a visitor would actually be charged. Caught by a test that
  renders the block against an empty market object.
- **The nine clauses are not retyped in the page seed.** `AGREEMENT_ITEMS` in
  `admin/market-page-seed.js` is a cloned copy of
  `BLOCK_DEFS.marketapp.defaultItems` — the same array a brand-new block
  starts with when dragged onto any other page — so there is exactly one
  place Andrew's legal wording lives rather than two copies that could drift.
  A test asserts the seed's clauses are byte-identical to the block's own
  defaults.
- **⚠ Nowhere in the surrounding page's editorial prose — the vendor-detail
  cards, the rules tiles, the FAQ — is the table fee typed in dollars or the
  coordinator named by hand.** Both are already live settings the
  `marketapp` block itself reads (`market_table_fee`,
  `market_coordinator_email`) and both change with the market: the fee by a
  processor change, the coordinator by whoever volunteers next. Writing
  either into ordinary prose blocks would create a second copy that goes
  stale the day the setting changes — the exact failure this whole editor
  exists to prevent. A test greps the seed's non-application blocks for a
  dollar sign and for the name "Marla" and expects neither.
- **`marketvendors` joined `site-worker.js`'s `NESTED_PATHS`, mirroring
  `public/index.html`'s `tlcPathFor()`.** Missed on the first pass: the two
  copies have to agree on a nested page's address or the edge-render
  injection looks for this page's blocks at the wrong path
  (`/marketvendors` instead of `/christmasmarket/vendors`) and never finds
  them — purely additive, so nothing breaks, but the flash-prevention this
  repo built in v5.6.0 would silently not apply to this one page. The mirror
  test in `test/site-edge-render.test.mjs` now checks this id too.
- **`SCHEMA_VERSION` bumped.** Adding a page to `ALL_SEEDED_PAGES` is a
  migration-block change like any other — without the bump, the new
  `INSERT OR IGNORE` for this page never runs against a database that has
  already seen the previous schema version.

Run: three new groups in `admin/blocks.test.mjs` (the block's own
sanitizing/rendering rules, the closed-and-blank-clause behavior, and the
seed itself), two new groups in `test/admin-redesign.test.mjs` (seeded as a
draft and left unpublished; once published, reads live settings and a later
setting change still reaches the already-published page), and the widened
`marketvendors` case in `test/site-edge-render.test.mjs`.

### The hero photo gets a shading and position control, and a rich field actually closes (v5.17.0, 2026-08-17)

Dinger, in one message: the Hero banner's photo "is too dim… It looks like the
image is overlaid with a color," with no way to move it — "right now it is
like it is maxed and centered"; a text field's floating formatting toolbar
stayed on screen after clicking away from it; and whether ministry-card
photos, which read as left-justified, could be centered.

**The dark wash over a hero photo was never a mistake — it just had no
control.** `.tlcb-hero::before`'s gradient exists so white headline text
stays readable over an arbitrary photograph, the same job Photo banner's own
veil does — and Photo banner has had a "Photo shading" choice (Light / Medium
/ Heavy) since the redesign. The hero never got one; its top stop was a
single hardcoded `.82`, between Photo banner's own Medium (`.72`) and Heavy
(`.88`), which is why it read dark even to somebody who had never touched the
block. **Photo shading** is a `choices` entry now, reusing the same `VEILS`
table Photo banner reads, and the default moved to Medium — so an untouched
hero reads lighter than before with no edit required, and Light or Heavy are
there for a photograph that needs it.

- **Photo position** (Top / Center / Bottom) is the second half, and it is a
  genuinely new control — the hero had no crop point at all, so a photo whose
  subject sat high or low in frame was always cropped to its exact center.
  `IMG_POSITIONS`, beside `VEILS`, maps each choice to a plain
  `object-position`-shaped CSS value (`center top` / `center center` /
  `center bottom`) written into `--tlcb-hero-pos` alongside the existing
  `--tlcb-hero-img`.
- **Both are `choices`, the same generic mechanism `photobanner` already
  uses** — declaring them on `BLOCK_DEFS.hero` is what produces the
  sanitizer's validation and default, the inspector's chip row, and the
  patch-handling, with nothing hand-wired three times over. A bad stored
  value for either clamps to its default rather than reaching a style
  attribute unchecked.
- **⚠ Neither does anything without a photo, and the inspector note says so
  in as many words.** A hero with no photo renders the flat ink-navy field
  the redesign ships everywhere a photograph is missing (v5.0.0); shading and
  cropping a field with nothing in it would be a control that looks live and
  changes nothing, which is worse than not offering it.
- **⚠ `wrapperVars()` in `admin/blocks.js` and `styleVars()` in
  `admin/ministry-editor.html` have to stay in step, as always** — and
  writing this surfaced that `styleVars()`'s hero branch had never emitted
  `--tlcb-hero-veil` at all, only `--tlcb-hero-img`, a gap that predates this
  work. Fixed in the same pass: without it, the editor canvas would show a
  hero with no veil at all — full-strength color straight off the photo —
  while the published page (rendered server-side, where the bug did not
  exist) showed the real, veiled result. Nobody would have noticed from the
  canvas alone, because a too-bright preview does not read as wrong the way a
  too-dark one does.
- **Regenerated `admin/page-seeds.js` and `admin/site-pages.js`** via
  `node tools/extract-pages.mjs` — adding a `choices` field to a block's
  `defaults` means every already-generated hero block seed needs it too, or
  the "seeds are already sanitized" test fails on every hero-carrying page.
  Purely additive: `"veil": "medium", "imgPos": "center"` on each one: no page
  changed how it renders.

**The rich-field toolbar staying open was a TinyMCE internals gap, not a
missed handler.** `openRichField()` in `admin/ministry-editor.html` tore a
field's editor down on `ed.on('blur', …)` — and, measured directly against
the real vendored library (a stub cannot reproduce this; it lives entirely
inside TinyMCE 7's own focus tracking), **that event never fires at all in
this embedding**: inline mode, more than one editor alive on the same canvas
at once. Nothing ever told an opened editor its turn was over, so its
floating toolbar sat on screen for the rest of the session — one more added
per field anybody clicked into.

- **⚠ The fix is a native `focusout` listener on the editor's own element,
  not a different TinyMCE event.** Confirmed the other direction too: native
  `blur`/`focusout` fire reliably in every case tried, including moving focus
  straight from one inline editor into a second one on the same canvas — the
  exact case where TinyMCE's own tracking stays silent.
- **⚠ Not every `focusout` means leaving.** Opening the Link dialog moves
  focus into `.tox-dialog`'s own address field, outside the contenteditable —
  which fires a `focusout` too. Tearing the editor down there would delete it
  out from under a dialog that still references it, so the handler checks
  whether focus landed inside `.tox-dialog` or `.tox-tinymce-inline` first
  and does nothing if so. A toolbar button needs no such guard: TinyMCE
  already keeps its own buttons from taking focus, so clicking Bold never
  fires `focusout` in the first place — verified directly rather than assumed.
- **Deferred one macrotask** before checking where focus landed, because a
  dialog's own focus trap can settle a beat after the dialog itself appears —
  checking synchronously would sometimes catch focus mid-transition and tear
  the editor down anyway.

**The card images were not left-justified by a bug.** `cardgrid`'s Alignment
control (Left / Center / Right, on the inspector like every alignable block)
already centers a card's photo along with its heading and body when set to
Center — verified by rendering a centered card grid and reading the actual
markup, which carries `tlcb-cg--center` exactly as designed. Nothing to fix;
the answer was pointing at the existing control rather than writing one.

Run: the `hero photo can be shaded lighter and repositioned` group in
`node admin/blocks.test.mjs`, and `test/editor-richfield-close.test.mjs`
(Chromium, driven against the real vendored TinyMCE rather than a stub, which
is the only way this bug reproduces at all).

### The Give button gets a color and its own words, and the four values are office-editable (v5.16.0, 2026-08-17)

Dinger, in one message: he still could not recolor a Give button, and the
Give block always said "Give" when a market fee or a registration needed
"Pay" instead; the four core values had no admin screen at all, text or
photos.

**The Give block's button was never a `.tlcb-btn`.** Its CTA has always been
`.tlcb-chip.tlcb-chip--go` — the class the v5.12.0 legibility fix gave it its
own gold fill under — and `BTN_TYPES` (the set the "Button color" control is
offered on) is *derived from what a type's markup actually contains*, so a
type whose button never carried the marker class was never offered the
control at all. `give` is in `BTN_TYPES` now; the marker class is added
first in the attribute (the same convention every other multi-class button
on the site already follows, and what the derivation test's substring match
depends on), and `.tlcb-give .tlcb-chip--go`'s three colors now read the same
`--tlcb-btn-*` variables every other button does, with the original gold as
the fallback — an untouched Give block repaints by not one pixel.

- **A typed `buttonText` replaces the computed wording outright**, the same
  override shape `contactEmail` already uses: blank means "Give now" / "Give
  to [fund]" as before, and it is editable by clicking the button itself in
  the canvas — the editing-mode span is never inside an anchor, so unlike the
  card grid's link label there is no nested-anchor problem to route around.
- **The fund picker's own note had to stop assuming the wording.** It used to
  say "The button reads 'Give to X'" unconditionally; that becomes a lie the
  moment somebody types over it, so the note now reads whatever the button
  will actually say.

**The four core values had no admin screen, and the record itself had no
photo field.** `admin/values.js`'s `VALUES` is hardcoded — the field
gradient, the chip tint/ink/solid, the order — and stays that way, on
purpose: a free hex on these four cards is one paste away from an unreadable
card, and no one asked to repaint the palette, only the words.

- **`core_values`** is a new table, one row per key, seeded blank by the
  migration. `mergedValues(rows)` in `admin/values.js` layers whatever is
  filled in onto the hardcoded record; a missing row and a row that exists
  but is entirely NULL have to render identically, since that is the actual
  shape the seed produces — the day the migration runs, nothing on the site
  moves.
- **Only the words and a photo are editable** — `short`, `name`, `blurb`
  (the official one-sentence statement), `tag` (a warmer card-display
  version, falling back to `blurb` when blank), `why`, and `photo_url`.
  Everything else — the gradient, the accent, the chip colors, the six "ways
  in," the order itself — passes through untouched.
- **A photo REPLACES the field, never adds to it** — the identical mechanism
  Hero's `--tlcb-hero-img`/`--tlcb-hero-veil` already uses, reused rather
  than invented twice. ⚠ The veil is a **fixed** dark wash, not a translucent
  version of each value's own hue: deriving one from four different brand
  colors is a second design decision nobody asked for, and a flat dark veil
  reads under any of the four regardless of what the photo itself contains.
  ⚠ A photographed card takes light ink unconditionally — Outreach's
  `darkInk:true` exists for its light gold *flat* field, and is exactly wrong
  once a dark veil sits over whatever the photo is.
- **`/values`** is nested under Pages beside Partners, gated on the same
  `pages_edit` permission. Unlike every other list screen there is no add
  action and no delete — the four rows always exist, one per key, so the
  screen's only actions are Edit and, once a value has been touched, Reset.
- **A blank field is stored as NULL, not `''`.** They mean different things
  to `mergedValues()` — NULL is "still the default," an empty string would
  read as "customized to nothing" — and to a human looking at the row later,
  where NULL is legible as "never touched."
- **Joins the `/api/pages` cache chokepoint**, the same reasoning Partners'
  logo already established: editing a value changes what a published page's
  self-filling Core values block renders without any page itself being
  touched.
- **The photo picker is the Staff photo field's shape, simplified** — upload,
  preview, remove — with no crop/zoom sliders, since a landscape card field
  has no face to recenter the way a circular headshot does.

Run: `node admin/values.test.mjs` (mergedValues), the photo/veil group in
`node admin/blocks.test.mjs`, and the Give button and Values groups in
`test/admin-redesign.test.mjs`.

### The sidebar aside gets its own spacing control (v5.15.2, 2026-08-17)

Dinger, on a `sidebar`/`sectionside` page whose first content block carried
its own space above it: the content column started lower than the aside
beside it, and there was no way to fix that except taking the spacing back
off the block. The reply at the time — *"that isn't adjustable today, it'd
need a spacing control on the aside itself, which doesn't exist"* — got a
*"yes i want one."*

- **A page-level number, not a block property.** The aside is chrome the
  `sidebar`/`sectionside` layouts wrap around a page's blocks — it is not a
  block itself, so it cannot carry a `spaceAbove`. `pages.aside_top` is the
  new column, `0` by default, so every existing page keeps rendering flush,
  exactly as before this shipped.
- **Same 8px step and 0–96 cap a block's own spacing already carries**
  (`snapSpace()`), not a new range invented for this. The whole point is
  compensating for what a single block's `spaceAbove` can introduce, so
  anything past that ceiling could never be lining up with real content.
- **Shown only on the two layouts that have an aside at all** — `standard`
  and `home` pages never render the control, rather than showing it disabled.
- **`pageLayoutContext()` carries it now, alongside `template` and
  `children`** — the same function the "redraw keeps the page's layout" fix
  (v5.9.1) built, and for the identical reason: the stateless `/render`
  endpoint only ever gets a slug and blocks from the browser, so anything the
  canvas needs to draw correctly has to come from the database on every one
  of the render paths, not just first paint and a template switch.
  `pageLayoutContext()` already existed to answer exactly this question for
  one field; this is the same fix shape for a second one, not a new
  mechanism.
- **⚠ `rerender` now fires on this too, not only a template change.** A
  settings save that only moves the aside's spacing still changes what the
  canvas looks like, so the stateless render has to run again — the same
  reasoning that made a template switch redraw in the first place.
- **Zero is genuinely absent, not stored-and-styled-at-zero.** `sidebarAside()`
  only emits a `style="margin-top:…"` attribute when the value is non-zero, so
  an untouched page's aside markup is byte-identical to what it always was.

Run: the `sidebar can be pushed down` group in `test/admin-redesign.test.mjs`.

### The nine market settings had nowhere to be set (v5.14.0, 2026-08-16)

Dinger, after the vendor application shipped: *"i set the market fund id in
the giving tab. confirm where vendor signups go"* — except there was no fund
ID field in the Giving tab, or anywhere else. Checked, not assumed: none of
the nine `market_*` settings were reachable from any screen. `admin/market.js`
seeds them and reads them, and its own "Fees & dates" quick-link pointed at
`/settings?edit=market_table_fee` — but `market_table_fee` was never added to
the Settings screen's `SETTINGS_VIEW`/`SETTABLE`, so that link led nowhere a
form could save to. The manual and this file both described the workflow
("Admin → Settings, and search for market") for a screen that had never
actually been built.

- **The Tithe.ly fund ID is on the Giving tab now** (`/giving/market-fund`),
  beside the Base Tithe.ly Link and the Funds panel — it takes knowing
  Tithe.ly's own account internals, the same reasoning that keeps `give_url`
  off the generic Settings screen too. It **replaces** the base link's fund
  rather than appending a second, same as every other fund override on the
  site; blank means market payments use whatever fund the base link already
  carries.
- **The other seven — day, hours, table fee, max tables, the two card-fee
  numbers, coordinator email — are on the Settings screen**, under a new
  **Christmas Market** filter chip. None of them has a dedicated `href`; they
  use the generic `/settings?edit=<key>` editor the same way `zoom_url` and
  `social_image_url` do, because there is no reason yet to build a bespoke
  screen for seven plain fields.
- **⚠ `market_applications_open` is deliberately NOT in Settings' `SETTABLE`.**
  It already has its own toggle and its own route on the Christmas Market
  screen (`POST /market/applications`, gated `market_manage`). Adding it here
  too would be two forms writing one key — the exact anti-pattern this file
  warns about for `site_appearance` and `church_name` — and the two could
  disagree about what "off" means.
- **This does reopen a permission question worth naming.** The Christmas
  Market screen's whole design point was that Marla, holding only
  `market_manage`, can run the coordinator's list without touching anything
  else. These seven settings need `settings_manage` instead, so she cannot
  change the table fee or the market day herself — only somebody with full
  access (Andrew, in practice) can. That is consistent with how the annual
  checklist in `public/manual.html` was already written (an office/pastor
  task, not a coordinator one), so it was left as is rather than building a
  second settings surface on `/market` to avoid a permission mismatch that
  was already there in the design, just never reachable.

Run: the market groups in `test/admin-redesign.test.mjs`, and
`node admin/sections.test.mjs`.

### The Christmas Market takes its own vendor applications (v5.8.0, 2026-08-16)

Built from `design_handoff_market_vendor_signup/`, committed whole for the same
reason the other two handoffs are. It replaces the Google Form + spreadsheet the
market ran on through 2024 (`Weihnachtsmarkt Registration`, 68 vendors, ~69
tables) with `/christmasmarket/vendors` and an admin screen.

**⚠ THE HANDOFF'S THIRD PRICE IS WRONG, AND THIS DELIBERATELY DISAGREES WITH
IT.** A vendor pays a grossed-up amount so the church nets the whole table fee:
`total = round((tables × 30 + 0.30) / (1 − 0.029))`. README.md gives the
results as **$31.20 / $62.10 / $92.99**. The first two are exactly what that
formula produces; the third is the formula **truncated**, where the other two
happened to need no rounding at all. Follow it and the church nets **$89.99** on
a three-table vendor — a penny short of the $90 the gross-up exists to protect.
$31.20 is the anchor worth trusting: it is what a one-table vendor really paid
in 2024, which is how the 2.9% + 30¢ rate was identified. Three tables is
**$93.00**. `admin/market.test.mjs` asserts the *property* — that the market
nets the full fee at every table count, computed against what a processor
actually keeps — rather than pinning three literals, because a literal goes
green forever the moment somebody copies the wrong one in.

- **⚠ THE APPLICATION IS SAVED BEFORE ANYBODY IS SENT TO PAY.** A maker who
  fills in five minutes of form and then closes the card page — the phone rang,
  they wanted to check with somebody — has to still exist on the coordinator's
  list, marked unpaid, so she can chase them. **The Google Form lost them
  completely**, and that is the single thing this build is for. Every failure
  past the INSERT is best-effort: no giving link set, Brevo down, push refused
  — the vendor is told their application is in and how to pay instead, never
  that something broke. The one failure they ARE told about is the INSERT
  itself, because sending somebody to pay for a table nobody has a record of is
  worse than asking them to try again.
- **⚠ THE AMOUNT IS COMPUTED SERVER-SIDE AND A POSTED ONE IS NEVER READ.** The
  page shows a running total so the vendor knows what they are agreeing to;
  what is charged and what is recorded both come from `priceBreakdown()` on the
  Worker. A test posts `tables=40, amount_due_cents=1, total=0.01` and asserts
  three tables at $93.00 is what lands in the table.
- **⚠ NO PAYMENT ADDRESS IS EVER ON THE PAGE OR IN `/api/market-config`.** The
  Tithe.ly link has exactly one owner — the Giving tab — and `marketPayUrl()`
  builds it from `give_url` at request time through `withAmountAndFund()` in
  `give-link.js`, so the market's fund **replaces** the base link's rather than
  appending a second. Same rule as every give button: a stored address goes on
  charging to the old form after the office changes the link, and the page
  still looks perfect.
- **⚠ The arithmetic exists twice and a test runs both.** `MARKET_PRICING_JS`
  is the browser's copy, because the total has to move the instant somebody
  picks a second table and a round trip cannot do that. `market.test.mjs`
  evaluates that string and runs it against the exported functions over five
  fee configurations × eleven inputs — the same thing `give-link.js` and
  `admin/links.js` do, and for the same reason: that is what makes a mirror
  safe rather than a second chance to be wrong.
- **⚠ `clampTables` keeps the minus sign in its strip.** Without it `-4` reads
  as **four** — the sign is discarded and the absolute value clamps to the
  maximum — so posting a negative quietly buys the largest booth the market
  sells. Caught by the test, not by reading it.
- **Money is integer cents, end to end.** `gym_invoices` stores floats and that
  is precisely what AC-5 / GY-7 in the July 2026 review are about. A defect
  being carried is not a convention to copy.
- **⚠ `amount_paid_cents` is NULLABLE and NULL means "nobody has checked yet"**,
  which is a different fact from "they paid nothing". A default of 0 would put
  every fresh application on the reconciled side of the ledger.
- **There are four payment states because the market has four.** Timothy MDO,
  the Word of Life 8th grade and the youth group take tables at no charge —
  recording those as unpaid leaves three rows on a chase list forever — and a
  vendor who dropped out is not unpaid either. **⚠ `waived` is toned `auto`,
  not `good`:** it is a decision the office made, not money that arrived, and
  the same green as Paid would make a reconciliation read balanced when it is
  short by three fees.
- **Only five fields are required**, and a test pins that. Every extra required
  field is a maker who gives up halfway and emails Marla instead — which is the
  workflow this page exists to replace. No business name, no address and no
  appliance list is a perfectly good application.
- **⚠ Photos ride inside the application POST; there is no public upload
  endpoint.** `/api/upload-image` is behind the session gate, and a public
  sibling would let anyone host arbitrary files on the church's domain forever
  with no application attached. They are read only *after* the fields pass and
  the screener runs, so a bot cannot make the Worker buffer 40MB for nothing,
  and **nothing in that path throws** — a file too large, the wrong type, or
  one R2 refuses is simply not among those stored. The design is explicit that
  photos must never block a submission. They go through the same EXIF strip as
  every other upload (B6), which matters more here than anywhere: these come
  off a maker's phone and the GPS in them is their home address.
- **A held application gets no payment link.** `screenSubmission()` scores it
  like every other public form and a held one is stored and answered with
  success — a bot that learns which of its submissions were caught learns how
  to get past the filter. The difference is that taking money for a table
  nobody has read the application for would be the worse mistake by far.
- **`market_manage` is its own permission**, with a `Market coordinator` preset
  that grants it and nothing else. Marla is a volunteer who runs one event a
  year, and the list holds seventy people's home addresses and phone numbers;
  she should be able to have exactly that. A test asserts somebody holding it
  alone sees no Payroll and no Subscribers.
- **⚠ THE CLIENT SCRIPT HAS TO SIT ABOVE THE ROUTER IN `public/index.html`.**
  The router runs at parse time and calls `showPage()` synchronously, which
  calls `tlcMarketInit()` — and `var tlcMarketCfg` declared after it is hoisted
  but **undefined**. The symptom is a vendor page whose table buttons never
  appear, **on a direct visit only**: arriving from a link works, because by
  then the whole script has run. Found by the browser suite; it would have
  shipped otherwise, because every hand-check goes through the link.
- **⚠ The arrows are gone.** The mocks put one on the end of five links —
  "Apply for a table →", "Submit and pay $31.20 →". The repo rule wins, as it
  did when the v5.0.0 designer asked; `admin/link-style.test.mjs` runs in CI
  and `admin/market.js` is in its file list.
- **Nine `market_*` settings**, so the annual update is not a code edit. The old
  `/christmasmarket` markup carried an "UPDATE ANNUALLY — paste in the Google
  Form URL" comment over a hardcoded mailto; that comment and the mailto are
  both gone. **⚠ Only two numbers move if the church changes processors** —
  the percentage and the fixed charge.
- **Applications default to OPEN.** A market page that ships switched off looks
  broken to whoever opens it first, and the only way in is a link from
  `/christmasmarket` — nobody stumbles onto it out of season. Switched off, the
  page keeps every word explaining the market and loses only the form.
- **⚠ The vendor agreement is drafted, not approved.** The handoff says so and
  the markup says so: it was written for the design, not supplied by the
  church, and a vendor types their name under it. It wants Andrew's reading
  before the first market runs on it.

**Still open, and deliberately:** two of the three "past markets" photographs
— `christmas-mkt.webp` is the only real one the repo has.

Run: `node admin/market.test.mjs` (176), `node test/market-vendor.test.mjs`
(Chromium, 58 — it stubs the admin and one group makes the stub **fail**,
because an unreachable admin is a state a real visitor hits and the page has to
keep quoting a working price through it), and the five market groups in
`test/admin-redesign.test.mjs`.

### A redraw threw away the page's layout (v5.9.1, 2026-08-16)

Dinger: *"the section with sidebar doesnt seem to display a sidebar."*

**The layout was right on first paint and right when he chose it, and wrong
from the next click onwards.** Three render paths in the editor pass the page's
`template`: the GET that loads it, the settings POST that switches layout, and
the two restore routes. The fourth — the stateless `POST /pages/api/render`,
which is what runs on **every structural change** (add, delete, duplicate,
reorder, undo, reset) — took the blocks and the slug and nothing else.

**⚠ AND A MISSING TEMPLATE IS NOT "USE THE DEFAULT".** `renderPage()` reads it
as *this is a ministry page* and returns a bare `<div class="tlcb-page">` with
no wrapper at all — so the redraw lost the aside, the section child list and
even the `tlcb-page--standard` class. A reload brought it back, which is
exactly what made it read as the sidebar not displaying rather than as an
editor fault: the thing was visibly there a moment ago.

- **`pageLayoutContext(env, P, id)` reads both from the database**, and neither
  can come from the request: the template is a stored property of the page, and
  the child list is derived from the page tree rather than typed anywhere. It
  returns `{}` for the ministries mount, which is how "a ministry page has no
  layout of its own" is said in one place instead of at four call sites.
- **⚠ Every child, not only the ones the signed-in person may open.** The aside
  and the section list are what a *visitor* will see; the editor's rail is
  scoped by ownership and is a different question, which is why the GET already
  queried them separately.
- **⚠ `test/editor-server.mjs` SHARED THE BUG**, which is why no browser suite
  caught it in the months this was live. The stand-in's own `/render` dropped
  the template too, and it passed `children` on no path at all. It has
  `layoutFor()` now, mirroring the Worker — a harness that reproduces the
  defect can only ever agree with it.

Run: the `redraws a sidebar page WITH its sidebar` group in
`test/admin-redesign.test.mjs` (through the real Worker) and `the layout
survives a structural change` in `node test/site-editor.test.mjs` (Chromium).
Both verified against the bug; the browser one seeds a page already on
`sectionside` rather than driving the layout dropdown, so what it exercises is
the redraw and not the Page tab.

### The iframe got taller and the calendar did not (v5.15.0, 2026-08-17)

Dinger, with a screenshot of August: *"the calendar is still not showing the
full days."* Every Wednesday read **10am Bible Class** and then **4 more**,
with visible empty space underneath.

**⚠ GOOGLE LAYS THE MONTH GRID OUT TO THE `height` IN THE URL, NOT TO THE BOX
IT IS PUT IN.** v5.5.0 raised the iframe's CSS height from 600 to 800 and
stopped there, so what got taller was the white space around a grid that
stayed exactly the same size. That is the empty area under "4 more" in the
screenshot, and it is why the earlier fix read as having done nothing.

The address had no `height` parameter at all. It does now, on both paths, and
the two copies — `tlcCalSrc()` in `public/index.html` for the hardcoded pages
and `calendarSrc()` in `admin/blocks.js` for the block — are checked against
each other by a test that reads the browser copy out of the page and runs both
over the same inputs, the same arrangement `give-link.js` and `admin/links.js`
already live under.

- **⚠ Only a Google Calendar address.** The same field takes a Google Form and
  other embeds, and appending a height to one of those invents a parameter it
  never asked for.
- **⚠ AND THE BLOCK'S OWN CONTROL WAS DEAD.** "How tall" — Short / Medium /
  Tall — has been on the Calendar block's inspector since it shipped, stored on
  every save, and **read by nothing**: the renderer hardcoded `520px`. Somebody
  choosing Tall watched nothing happen, which is worse than not offering the
  choice, because they believe it worked and stop looking.
- **⚠ 520 was also SHORTER than the 800 the hardcoded page already used**, so
  publishing `/calendar` or `/news` from the editor made the calendar smaller
  than the page it replaced. That is the second reason this looked unfixed.
- **The scale is re-based** — 520 / 800 / 1100 rather than 420 / 560 / 700.
  Since the control was never read, no stored value has ever meant anything and
  re-pointing it breaks nothing; honoring the old numbers would have shipped a
  regression.

**⚠ Not verified against the real calendar, and the reason is worth recording:
`calendar.google.com` is blocked by the sandbox proxy (403), so the height at
which Google stops folding a day into "N more" could not be measured here.**
The missing URL parameter is certain from reading the code; the number 1100 is
a judgement. If a busy Wednesday still collapses, the next move is to raise it
rather than to look for a different cause.

Run: the `the calendar is as tall as it says it is` group in
`node admin/blocks.test.mjs`, verified against the bug — restoring the
hardcoded height fails five assertions.

### A banner had no formatting at all (v5.15.0, 2026-08-17)

Dinger, with the hero's sentence selected and no toolbar: *"in the hero i can't
change the text parameters like is it a paragraph, heading, etc."*

Twenty-one block types carry `richBody`. **The three banners carried none**, so
their subtitle was a plain contenteditable — no toolbar, and nothing on the
screen to say why this field differed from the one in the block below it.

- **The subtitle is rich now on Hero, Photo banner and Welcome banner.** The
  eyebrow and the title stay plain, as every block's title does.
- **⚠ A SENTENCE GETS A SENTENCE'S ALLOWLIST.** `sanitizeLineRich` keeps
  emphasis, links and footnote marks and drops headings, lists and rules — a
  heading inside a banner subtitle is a second block's worth of structure
  inside a banner. Same shape as `sanitizeCardRich`, and a separate set for the
  same reason: widening the page editor's allowlist later must not quietly
  widen this one.
- **⚠ The toolbar is narrowed to match**, keyed off `data-rich-line`. Offering
  a Heading control whose result is silently discarded on save is worse than
  not offering it — that is the dead-control rule again, one section above.
- **⚠ The three renders had to stop escaping.** `esc(b.subtitle)` on a field
  that now holds markup renders the tags as words. Same trap the v4.32.0 pass
  hit on three hand-rolled `esc(b.body)` branches.
- **⚠ `fieldIsRich()` is one test with three callers.** The expression was
  written out in `commitField` and again in the Enter guard; adding the
  subtitle to one and not the other would have saved it as `textContent`,
  throwing away the bold somebody had just applied while the canvas went on
  showing it until the next redraw.
- **What is NOT offered, deliberately: choosing whether the subtitle is a
  paragraph or a heading.** A banner's three fields are fixed roles — eyebrow,
  title, sentence — and which one you type into *is* that choice. Letting the
  subtitle become a heading puts two headings in one banner.

### Phase 1 of the editor-tools plan (v5.13.0, 2026-08-17)

Dinger picked from a shortlist and added his own. What shipped in this pass:
three universal controls, four text formats, and two block types. Redo, the
photo viewer and the Give-button fix are their own entries below.

**Shading — a wash across a block's field.**
- **⚠ AN OVERLAY, NOT COLOR ARITHMETIC.** A white-to-black gradient over
  whatever the surface already is. That produces the handoff's "6–10% of value
  across the field, never a hue jump" and it is hue-safe **by construction** —
  an overlay with no hue in it cannot introduce one. It needs to know nothing
  about the color underneath, so it works on all ten palette entries, layers
  over the four authored gradients rather than replacing them, and will work on
  any entry added later.
- **⚠ Unlike shadow, the banners are NOT excluded.** A wash across a tall
  full-bleed band is where it earns its place.

**Appear — None / Fade in / Rise in.**
- **CSS only, via `animation-timeline: view()`.** No JavaScript, no observer.
- **⚠ GATED POSITIVELY AND TWICE, AND THE NESTING ORDER IS THE SAFETY.** The
  initial `opacity:0` exists only inside `@supports` **and** inside
  `prefers-reduced-motion: no-preference`. Firefox has no `animation-timeline`
  today and gets a normal page; put that initial state outside either gate and
  it gets a permanently invisible block instead. Both failure directions land
  on *visible, unanimated*.
- **⚠ The class is not emitted in the editor at all.** A block that fades itself
  in every time it scrolls past is one nobody can work on. The inspector note
  says so rather than leaving somebody to wonder.
- The three banners are excluded: the first thing on a page fading in is a page
  that looks like it failed to load.

**Button color.**
- **⚠ THE FILL AND THE INK ARE ONE CHOICE, NEVER TWO.** Offering them
  separately is exactly what produces white on gold at 2.6:1 — which the site's
  own header Give button still does, and which is recorded here as known. Pair
  them and an unreadable button is not expressible, so there is no warning to
  write and nothing for anybody to click past. A test computes the ratio of
  every pairing.
- **⚠ `default` stores nothing and emits nothing**, so `.tlcb-btn` falls through
  to the literals it has always carried. A deploy must not repaint the
  most-clicked control on a church website.
- **⚠ THE TYPE SET IS DERIVED FROM WHAT THE RENDERER EMITS**, not hand-listed:
  the test renders every type and asserts `BTN_TYPES` is exactly the set whose
  markup contains a `.tlcb-btn`. It caught the new Member portal block within
  the same commit, which is the whole point of writing it that way.
- The ghost variant keeps its transparent fill and follows only the chosen ink,
  because it is the quiet button beside a loud one and taking the fill would
  collapse the distinction it exists for.

**Four text formats**, and three of them needed no sanitizer work: `hr`, `sup`,
`sub` and `blockquote` have been in `RICH_TAGS` since the allowlist was written
and only ever lacked a way to type them.
- **Lead paragraph is the exception** — a `<p>` carrying a class, which the tag
  list alone cannot express. **⚠ `RICH_CLASSES` allowlists the VALUE, not just
  the attribute**: an arbitrary class would let saved content borrow any rule in
  our stylesheet, and `style` is not allowed at all and must not be — a free
  style attribute is arbitrary CSS running in another admin's authenticated
  session, which is what AW-2 is about. One unrecognized class drops the whole
  attribute and keeps the words.
- **Text color and highlight were deliberately deferred** — Dinger's call.

**Two new block types.**
- **Lessons.** For confirmation, and the requirement is narrower than it sounds:
  *"the youth director wants to post everything even though no one will look at
  it, so if he is compelled to, have a good way to organize it so it's not just
  one long page of text."* So the folding **is** the feature. `<details>`, the
  same choice the FAQ, the sermon library and the newsletter archive make.
  Closed on the page, open in the editor — somebody arranging a lesson cannot
  type into a body they cannot see. A lesson with no handout address gets no
  Handout link, the dead-link rule again.
- **Member portal.** A way into `connect.timothystl.org` that says what is
  behind the sign-in. This was already possible with a button block; a link in
  a row of buttons just says nothing about what it opens.

**And the fund dropdown says where its list comes from.** It was reported as a
fixed short list, which is what it looked like — the funds have been editable on
the Giving screen since 2026-07-27 and nothing on this screen said so. It links
there now, in both the populated and the empty state.

Run: `node admin/blocks.test.mjs` (2828), plus the editor and public browser
suites.

### The Give button had no fill of its own (v5.12.0, 2026-08-16)

Dinger, with a screenshot of a navy Give block: *"the background of the box
blends into the give button"*. It did, and on every other field too.

**⚠ `.tlcb-chip` WAS DECLARED TWICE, 385 LINES APART, FOR TWO DIFFERENT
COMPONENTS** — the Give block's button, and the Coming-up strip's pill added
with the rest of the 1b language in v5.0.0. One class name, equal specificity,
so source order decided and the later one won. The button lost its gold to the
strip's `chip-bg` background and kept its near-black ink:

| Field | The button's fill was | Contrast |
|---|---|---|
| Ink navy | `rgba(245,240,230,.08)` | about 1.3:1 |
| Navy | `rgba(0,0,0,.04)` | 1.16:1 |
| Parchment | `rgba(0,0,0,.04)` | 1.16:1 |

**This is the same defect as the two `.tlcb-card` declarations fixed in
v4.5.0**, which is why that entry says two rules for one class name is worth
grepping for. Both selectors are qualified now — `.tlcb-give .tlcb-chip` and
`.tlcb-chip-row .tlcb-chip` — so neither can reach the other's markup.

- **⚠ THE TEST ASSERTS THE ALPHA BEFORE THE CONTRAST, and the first version of
  it would have passed on the bug.** `getComputedStyle` returns
  `rgba(245,240,230,.08)`; a luminance helper that reads the first three
  numbers and drops the fourth scores that near-transparent wash as opaque
  cream — about 14:1 against a near-black label. A translucent fill has no
  contrast that can be asserted at all, because what it composites over is a
  gradient. So the button must be opaque, and only then is the ratio computed.
- **It measures the property, not the hex.** Any future rule that repaints the
  button fails it, not only a reintroduced duplicate of this one class name.
- **The strip's own pill is asserted too** — the half that would go unnoticed
  if somebody fixed this by deleting a rule rather than scoping it.

Run: the Give-button group in `node test/public-page.test.mjs`, verified
against the bug (five assertions fail, naming all three fields).

### Redo (v5.12.0, 2026-08-16)

Undo has been there since the editor shipped and there was no way back.

- **`S.future` is the second stack**, and **⚠ `pushHistory()` clearing it is the
  whole correctness of this.** Step back three times, type something, press
  Redo: without that line you get a page assembled from a branch that was
  abandoned, which reads as the editor inventing content out of nothing.
- **⚠ Neither `undo()` nor `redo()` may go through `pushHistory()`.** Stepping
  along the history is not a new edit; routing them through it would make Undo
  destroy the thing Redo exists to reach.
- **Both clear the selection**, because the block that was selected may not
  exist in the state being restored.
- **`Cmd/Ctrl+Shift+Z`.** The undo handler has always tested for the *absence*
  of shift, so the shifted key was already reserved rather than needing to be
  taken from something.
- **Disabled, not hidden.** An empty redo stack is the normal state, and a
  control that vanishes and reappears is one the eye has to re-find.
- **Nothing resets either stack, and nothing needs to**: switching pages in the
  rail is a full navigation (`location.href`), so both start empty.

Run: the `redo` group in `node test/editor-edit.test.mjs`, verified against the
bug — removing the branch-clear fails exactly one assertion, the one that says
a new edit abandons the redo branch.

### A block's own script ran on one path out of two (v5.11.0, 2026-08-16)

Found while scoping a photo viewer, which wanted to ship the same way. Not
reported by anybody — it is the kind of fault that never generates a complaint,
because the person checking it always checks it the way that works.

**⚠ A `<script>` INSERTED WITH `innerHTML` NEVER EXECUTES.** That is the HTML
spec, not a browser quirk. And two blocks ship their browser half inside their
own markup on purpose — `COUNTDOWN_SCRIPT` and `GIVING_WIDGET_SCRIPT` in
`admin/blocks.js` — so that a block works wherever it is rendered rather than
only on a page whose shell remembered to load a script. That reasoning is
sound; it just had a hole under it.

| Path | What happens | The script |
|---|---|---|
| Edge (v5.6.0) | `site-worker.js` prepends the markup as the document is served | the parser sees it, it runs |
| Client | `tlcTakeOverPage()` sets `host.innerHTML` | **silently dropped** |

So a countdown on a photo banner ticked on a direct visit to its page and sat
frozen on an em dash forever if the same page was reached from anywhere else on
the site. **The direct visit is the one anybody testing would try**, because
checking a page means loading that page.

- **`tlcRunBlockScripts()` re-parents a copy of each one**, which is what makes
  the browser treat it as a new script and run it. Every block script is
  already guarded by its own `window.__tlc*` flag, so one the edge has already
  run is a no-op here rather than a second interval.
- **⚠ Verified in a real browser before it was fixed, and the test reproduces
  it with the real symptom** — the countdown reading `—`. Both paths were driven
  against the actual `public/index.html`: the script tag was present in the DOM
  on both and only ever ran on one.
- **⚠ Anything new that ships a script inside block markup depends on this.**
  The photo viewer below is the first thing built on top of it, and reverting
  this fix fails its tests too, which is the honest signal that they are one
  mechanism rather than two.

### A photograph opens (v5.11.0, 2026-08-16)

Gallery thumbnails were dead ends — a small picture of the Christmas Market
with nothing to click. `LIGHTBOX_SCRIPT` ships inside the gallery block, the
same arrangement the countdown uses and for the same reason.

- **⚠ It reads the gallery out of the DOM** rather than being handed a list of
  photographs. There is then exactly one description of what is in a gallery —
  the markup the visitor is already looking at — so the viewer cannot come to
  disagree with the grid behind it, and changing a gallery's photos needs
  nothing regenerated.
- **⚠ A real `<button>` on the public page, a plain `<img>` in the editor** —
  the same split the card grid makes with its anchor, and for the same reason:
  on the canvas a click has to select the block, and a button would swallow it.
  It is a button rather than an image with a click handler because a handler on
  an image is not reachable by keyboard **at all** — the exact fault the
  accessibility pass found on the header logo.
- **⚠ Focus returns to the thumbnail it was opened from.** Without that a
  keyboard visitor is dropped at the top of the document every time they close
  a photograph, and has to tab all the way back down to reach the next one. A
  test asserts it, verified by removing the line.
- **Tab is trapped inside the viewer.** A modal that lets focus wander onto the
  page behind it is one a screen reader user cannot tell they are still in.
- **Clicking the backdrop closes; clicking the photograph does not** — reaching
  for the picture should not dismiss it.
- **⚠ The fade is gated POSITIVELY**, inside
  `@media (prefers-reduced-motion: no-preference)`, rather than being granted
  and then taken away by an override further down. This repo has shipped a
  correct rule defeated by a later declaration at equal specificity four
  separate times; a rule that is never granted cannot lose that argument.
- **⚠ `--font-ui`, not `--tlcb-ui`.** The viewer is appended to the body so it
  cannot be clipped by anything the page does with overflow — which also puts
  it outside `.tlcb-page`, where no `--tlcb-*` property reaches. Writing the
  family out as a literal instead pins the caption to one typeface while the
  rest of the site follows the Appearance setting; `admin/blocks.test.mjs`
  catches exactly that, and did.
- **An empty gallery ships no script**, and neither does the editor.
- **⚠ Still open: the tile and the opened photo are the same file.** The grid
  scales a full-size image into a 4:3 thumbnail, and opening it large is free
  only because it was already paying that cost. The crop-and-thumbnail work is
  the next phase; this makes the need more visible, it does not meet it.

Run: `node test/public-page.test.mjs` (Chromium, 58).

### The staff grid was showing three of eight (v5.9.1, 2026-08-16)

Dinger, straight after: *"we are still not showing all staff members in the
staff layout cards."*

**⚠ `sanitizeBlock` GIVES EVERY BLOCK A `count`, WHETHER OR NOT ITS TYPE HAS A
CONTROL FOR ONE** — clamped to 1..6, defaulting to 3. The staff block sliced by
it. So the church's eight staff could never render more than six and rendered
three, while the hardcoded `/about` that block replaces has always shown
everybody, from an unlimited `/api/staff`. Publishing the page lost five people.

- **A staff grid is the DIRECTORY, not a feed.** "The three most recent people"
  is not a thing anybody wants on an About page, so the answer is not a bigger
  clamp — it is no slice and `autoCount: false`, the same as Service times.
  Who appears and in what order is decided on the Staff screen, which is where
  somebody would go to change it.
- **The second cap was the query.** `pageData()` read `LIMIT 12`, invisible
  behind the smaller one; with the slice gone it becomes the only thing that
  can cut somebody off the page. 60 now — still bounded, because this is
  rendered into every `/api/pages` response, just bounded well above the real
  number.
- **⚠ The old test asserted the bug**: `eq(people.length, newBlock('staff').count)`.
  It now renders **seven** people — deliberately more than the 1..6 the clamp
  allows — so a reintroduced slice cannot pass by coincidence.

**And the crop it left open is fixed too (v5.10.1)** — see below.

### A face was framed twice, differently (v5.10.1, 2026-08-16)

The item the section above left open, on Dinger's say-so. The Staff screen has
a picker that drags a face into place and zooms in; the block ignored it, so a
portrait framed in the admin came out framed differently on the published page,
with nothing on the page to explain why.

**⚠ THE ROOT CAUSE WAS THE QUERY, NOT THE RENDERER.** `pageData()` selected
`name, title, email, photo_url` and stopped. So the block had no crop to honor
even once it wanted to, and fixing only the markup would have rendered every
face at the default framing while looking correct in the diff.

- **An `<img>`, not a `background-image`.** `object-position` plus a
  `transform: scale()` is the exact mechanism the picker writes and every other
  staff photo on the site reads. A background can be positioned but not zoomed
  the same way, so a background would have meant approximating a framing
  somebody chose by eye. `.tlcb-person-p` clips (`overflow:hidden`) or a zoomed
  face spills over the name beside it.
- **⚠ `isSafeObjectPosition` and `safeZoomFactor` moved to `admin/blocks.js`
  and the Worker imports them.** They were defined in `tlc-admin-worker.js`,
  and a crop is exactly what two copies come to disagree about — one accepting
  a value the other rejects means the admin's own preview and the live page
  frame the same face differently. Do not add a local copy back.
- **Neither value is trusted**: both go straight into a style attribute, so a
  position that is not exactly `NN% NN%` falls back to center and the zoom
  clamps to the 1–2.5 the slider offers. A face uncropped is a cosmetic miss; a
  value carried through is not.
- **No photo means no `<img>`**, rather than an image element aimed at nothing
  drawing a browser's broken-image mark on the church's About page.

Run: the staff group in `node admin/blocks.test.mjs`, and the crop assertions
in the staff group of `test/admin-redesign.test.mjs`. Verified in both
directions — dropping the two columns from `pageData()` fails the end-to-end
pair, and dropping the style attribute fails the renderer's four.

### /sermons had no block that could show a sermon (v5.7.0, 2026-08-16)

Dinger, with the page published: *"for the sermon page, it is not loading the
sermons that we have."* Twelve entries in the admin, an active series, and a
live page showing a banner and a **Watch on YouTube** button.

**⚠ THE CONVERTED PAGE WAS `hero, buttons` AND NOTHING ELSE, AND THE EXTRACTOR
WAS RIGHT TO PRODUCE IT.** `/sermons`' hardcoded markup is an *empty container*
that `loadSermons()` fills from the API at runtime. There was no content to
lift, so nothing was lifted.

That is harmless while a page is unpublished and it is the whole content of the
page the moment somebody publishes it — because `tlcMaybeTakeOverSitePage()`
hides every hardcoded section, including the one `loadSermons()` fills. The
loader still runs and still fills it; the visitor just never sees it. **The page
looked converted and had lost its reason to exist.**

- **`sermonlist` — "Sermon library"** is the block that was missing. The
  existing `sermon` block is the homepage's *latest* card; nothing could list
  what the church has actually preached. Self-filling from `ctx.data`, so a
  sermon added next week appears with nobody editing a page.
- **`pageData()` now carries the library**, series with their sermons nested,
  assembled in the Worker — `admin/blocks.js` is shared with the editor and the
  tests and must not know how those two tables relate. ⚠ Bounded (24 series,
  120 sermons): this is rendered into every `/api/pages` response, and a church
  that keeps preaching would otherwise grow that payload forever.
- **⚠ A sermon with no series is still a sermon.** The admin has a button for
  exactly those, so they get an "Other sermons" group rather than being dropped.
- **⚠ No recording, no link.** Most of this library is text only today, and a
  "Watch" that goes nowhere is the dead-link rule broken again.
- `<details>`, the same choice the newsletter archive made: no JavaScript, a
  keyboard and screen-reader control for free, identical in the editor canvas
  and on the live page. The active series opens; the rest fold away.
- **⚠ `LIVE_BLOCKS` in `tools/extract-pages.mjs` is the general fix.** A page
  whose content is filled at runtime gets the self-filling block appended. Not
  invented content — that would freeze a live list, which is the reason the
  extractor left these alone in the first place.

**⚠ A SEED DOES NOT REACH A PUBLISHED PAGE.** `canReseed()` skips anything
anybody has touched, so this does not repair `/sermons` on the live site. The
office adds **Sermon library** from the Content group and presses Publish —
one action, on their own page.

**⚠ `/education` WAS THE SAME SHAPE — now fixed, see below.**

### The editor on a phone (v5.9.0, 2026-08-16)

Dinger asked whether it could be done at all. It mostly already was.

**⚠ EVERY DRAG IN THIS EDITOR ALREADY HAS A TAP EQUIVALENT, AND NOBODY BUILT
THEM FOR TOUCH.** They are keyboard equivalents — a palette chip **adds** on
click, a block moves by the arrows in its toolbar, a row moves by the arrows
beside it (v5.1.0, written because "drag on its own is a keyboard dead end"), a
picture is chosen from the library. Touch inherits all of it. HTML5
drag-and-drop does not fire on touch, and it did not need to.

So the blocker was never the gestures. **It was that the breakpoints stopped at
1100px** and 224 + 266 + canvas + 318 does not go into 390. The editor is a
full-viewport takeover rather than `sidebarShell`, so it also inherited none of
the admin's own mobile work from v4.6.0.

- **One surface at a time, and a bar along the bottom** — Pages · Blocks · Page
  · Settings. One class on the root; nothing moves in the DOM, so a resize back
  to a desk restores the four columns with nothing lost and nothing rebuilt.
- **⚠ THE PAPER IS THE PHONE.** Fixed at 390 inside a ~370px canvas,
  `fitPaper()` would scale it to about 0.8 — and **`zoom` and caret hit-testing
  disagree in some engines**, so text lands where it was not tapped. Fluid width
  and no zoom means 1:1, and the canvas is rendering at the real device width,
  which is also what the visitor gets.
- **⚠ A collapsed rail is switched off, not honored.** The collapse exists to
  give the canvas room and there is no canvas beside it here; a stored "shut"
  from a desk session would make Blocks a blank 26px spine. The stored choice is
  left alone for when they are back at that desk.
- **Picking a block in the outline moves to the page.** On a desktop the canvas
  is already beside you and this does nothing; on a phone, being left looking at
  the list reads as nothing having happened.
- **The tip is rewritten on a narrow screen**, because its four instructions are
  four things that are not true here — and it is the first thing anybody reads.
- 44px on everything aimed at, which is the rule `public-phone.test.mjs` has
  held the public site to and which had never been applied to the editor.

**⚠ THE FIRST ATTEMPT SHIPPED THE BAR INVISIBLE**, by declaring
`.ed-mtabs{display:none}` *after* the media query that turns it on. A media
query outranks nothing — at equal specificity source order decides. That is the
same cascade defect the post-redesign review catalogued four separate times, it
is easy to write, and it is invisible until something measures it.

**Not done, and deliberately: touch drag.** Replacing HTML5 DnD with pointer
events would touch four separate drag systems, and the arrows make it a
convenience rather than a capability. The keyboard work already paid for the
phone.

Run: `node test/editor-phone.test.mjs` (32, Chromium at 390px with `hasTouch` —
every path driven by `tap()`, and there is no drag anywhere in the file).

### And /education is the page the menu calls "Learn" (v5.8.0, 2026-08-16)

Dinger: *"For education isn't it supposed to be learn? If not build the block
for it."* He is right, and it is one page: id `education`, title *Christian
Education*, **menu label `Learn`**, address `/education`. Worth writing down,
because a search for "Learn" finds nothing and the warning above named the page
by an address the menu never shows.

`classes` — **"Bible classes"** — is the block, the same shape as the sermon
library and for the same reason: the page's class cards are a
`bible-classes-grid` that `loadBibleClasses()` fills from the API at runtime, so
the extractor lifts the page's prose and nothing else, and publishing would hide
the grid that loader fills.

- **Self-filling from `ctx.data.classes`**, the same rows in the same order with
  the same `active = 1` filter `/api/bible-classes` uses — so the converted page
  shows exactly what the old one showed, and pausing a class on the Christian Ed
  screen still removes it.
- **⚠ The accent is a KEY, resolved in the renderer.** The Christian Ed screen
  stores `teal` or `sage`, never a hex, so a class cannot introduce a color the
  site does not use and a stored value never reaches a style attribute
  unchecked. An unknown key falls back rather than being written out.
- Leader, description and location are all optional on that screen, so a sparse
  class renders rather than leaving holes.

**⚠ Still true, and it is the general rule now: a seed does not reach a
published page.** Both `/sermons` and `/education` need the office to add the
block and press Publish. `LIVE_BLOCKS` in `tools/extract-pages.mjs` has an entry
for each; **any third page whose content arrives from the API needs one too**,
and the symptom is always the same — the page looks right unpublished and empties
on publish.

### The auto-bump stops overwriting a version somebody chose (v5.7.0, 2026-08-16)

Dinger: *"fix the version bump conflict so it stops happening."*

The patch bump in `.github/workflows/deploy.yml` fired unconditionally, and the
conflict was the smaller of its two costs:

1. **It overwrote the release the moment it shipped.** Merge a PR cutting
   v5.5.0 and the bump made it v5.5.1 within the minute — so the minor number a
   release was cut under was never the number anyone read.
2. **Every feature PR conflicted.** The bump lands on main, the branch already
   changed the same line, and the next merge stops for a hand resolution that
   always goes the same way.

If the newest commit on main already set `VERSION`, a person set it and the job
leaves it alone — the deploy jobs above have already shipped that number, so the
live worker is correct and there is nothing to do. First-parent diff, so it
reads the same under squash merges (what this repo takes) or true merges.

⚠ The auto-bump still works for everything else: a merge that does not touch the
version still gets its patch. Verified against real history — the three merges
that set a version are skipped, a synthetic merge that does not is bumped.

**⚠ AND IT NEEDED `fetch-depth: 0`, WHICH THE FIRST ATTEMPT MISSED.**
`actions/checkout` fetches **depth 1**, so `origin/main^` does not exist in the
runner — and the guard asks for exactly that. Its first condition
short-circuited, the guard never fired, and the bump landed anyway. It happened
on the very merge that added the guard: **v5.7.0 → v5.7.1**.

The lesson is about *where* it was verified. The shell was proven correct in a
full clone, which is the one thing CI is not. Reproduced afterwards by cloning
this repo at `--depth 1` and at `--depth 2` and running the guard against both:
the first bumps, the second skips. **A workflow that reads git history has to be
tested against a shallow clone, because that is what it will get.**

### And so does the chrome (v5.10.0, 2026-08-16)

Dinger, with every page published and the block markup already arriving at the
edge: *"I have published all pages and still the echo version of pages loads
first."*

**Right again, and the earlier fix was half of one.** Measured against the live
site rather than reasoned about:

| | |
|---|---|
| `public/styles.css` paints the bar | `var(--sage)` — moss |
| the stored appearance says | `#3A4E5C` — slate |

So every page painted a **moss header** and snapped to **slate** when
`/api/pages` returned. The logo is a custom upload, so it swapped too, and the
newsletter band is slate as well. v5.6.0 put the page BODY into the first paint
and left the chrome to `applyAppearance()` — which runs after a cross-origin
fetch, which is the thing that fix existed to remove.

`appearanceStyle()` in `site-worker.js` writes the same custom properties
`applyAppearance()` sets into a `<style>` in the head as the document is served,
and the same pass rewrites the logo's `src`, the brand name, the tagline and the
band's background.

- **⚠ The properties are the ones `applyAppearance()` sets, exactly.** If the
  edge set one name and the client set another, the flash would simply move
  rather than go away. The client still runs and still sets all of it — it just
  has nothing left to change, because both read one record.
- **⚠ NOT gated on the page having blocks.** The chrome is on all 28 pages and
  flashed on all 28; an unconverted page needs this as much as a converted one.
  This is a separate branch from the block injection for that reason.
- **⚠ Additive, like the blocks.** No record, or a field absent from one, writes
  nothing and the stylesheet's own fallbacks apply exactly as today.
- Values are clamped on the way out — a color into a stylesheet, a scale into
  every `calc()` on the site. They come from a fixed list in
  `admin/appearance.js` rather than from anything a visitor types, but the
  characters that could close a declaration are dropped rather than reasoned
  about, and a non-numeric scale is dropped rather than emitted.
- **⚠ A blank logo is a real choice** — the church name on its own — so it hides
  the image rather than leaving the markup's `/logo.png` in place.

**The general lesson, and it is the same one twice:** the first fix removed the
round trip for the half of the page somebody had complained about, and left the
other half on the old path. When the symptom is "it changes after it loads", the
question is *everything* that changes after it loads, not the part that was
mentioned.

Run: `node test/site-edge-render.test.mjs` (65). Verified against the bug —
reverting the chrome branch fails eleven assertions naming what goes missing.

### The page arrives already rendered (v5.6.0, 2026-08-16)

Dinger: *"the old pages and content are always loading first and then current
content and layout display even on hard refresh"* — and, when told to finish
publishing, *"i have publsihed many of the pages, only 5 show not published yet.
and i still see it."*

**He was right, and the advice he was given first was wrong.** Publishing more
pages could never have fixed this, and the code says so plainly:

- `public/index.html` ships the **hardcoded markup for all 28 pages**. That is
  what paints, on every load, because it is in the document.
- Only afterwards does `tlcMaybeTakeOverSitePage()` fetch `/api/pages` **from
  another origin**, hide the hardcoded sections and drop the published blocks
  in.

So publishing changes *what replaces* the markup. It cannot change *that the
markup is painted first*, because the replacement waits on a cross-origin round
trip. **A hard refresh makes it worse**, not better — nothing is cached, so the
trip is at its longest. Twenty published pages behaved exactly as the code
predicts.

**The blocks are now put into the HTML as it is served.** `site-worker.js`
already runs on every request and already rewrites the document with
HTMLRewriter for `og:image`; the same door, for a related reason — that one
because crawlers do not run the page's JavaScript, this one because the
visitor's eyes do not wait for it.

- **⚠ PURELY ADDITIVE.** Admin unreachable, page not published, a path that
  resolves to nothing — all inject nothing, and the page then renders its
  hardcoded markup and waits for the client exactly as before. The fallback is
  not a second code path bolted on; it is what happens when this does nothing.
- **⚠ THE CLIENT MUST NOT DO IT AGAIN.** The edge sets `data-tlcb-edge` on the
  page div and `tlcMaybeTakeOverSitePage()` skips the *injection* while still
  hydrating the feeds — the edge ships the block markup, not the posts inside
  it. Without the guard: every block twice, one copy under the other. The test
  was verified against exactly that.
- **⚠ `pathForPageId()` IS A MIRROR OF `tlcPathFor()` AND HAS TO STAY ONE.** The
  SPA routes by page **id** and its divs are `id="page-<id>"`; the address is
  derived from the id, **not** from `pages.slug`. Using the slug at the edge
  would let the worker inject into a page the router does not agree it is
  showing. There is no module both files can import, so this is the same
  arrangement `styleVars()`/`wrapperVars()` live under: two copies, and a test
  that reads both and asserts they agree.
- **⚠ Content added with `prepend()` is NOT re-parsed by HTMLRewriter**, which
  is the whole reason `#page-<id> > *` can be used to hide the hardcoded
  sections — the selector matches only the original children, never the block
  markup just placed in front of them.
- **Hidden, never removed**, exactly as `tlcTakeOverPage()` does it: they are
  the fallback, and a page re-rendered client-side later expects them present.
  An existing `style` attribute is appended to rather than replaced.
- **One rewriter pass**, shared with the social image — two `.transform()` calls
  would be two passes over 220KB. `rewriteSocialImage()` is gone, folded in.
- **One page per request, not all 28.** The payload is keyed by id; only the one
  matching the request path is injected.

**Still true and worth knowing:** this removes the flash, it does not finish the
conversion. A page with nothing published still renders its hardcoded markup —
correctly, and now without a second version arriving on top of it.

Run: `node test/site-edge-render.test.mjs` (42 — it drives `rewriteDocument`
through a recording stand-in, because HTMLRewriter is a Workers API and does not
exist in Node; what is worth pinning is which selectors are asked for and what
is done to the elements, not Cloudflare's parser) and the `the edge already
rendered the page` group in `node test/public-page.test.mjs`.

### Dinger's ten (v5.5.0, 2026-08-16)

A list, answered one clarifying question at a time and then built. What follows
is what each turned out to be, because several were not what the item said.

**1. Text size is a multiplier, and there is one of them.** *"15 and 17pt is
too small"*, and all three roles, body copy first. `TEXT_SIZES` in
`admin/appearance.js`, beside the typeface selector and for the same reason: a
site whose text size is decided a block at a time reads like several sites.
- **⚠ A MULTIPLIER, NOT A SET OF SIZES.** Every size on the site was chosen in
  proportion to the others; a control that replaced them would flatten that.
- **⚠ Headings take a gentler curve than body copy.** A hero at 64px times the
  body's 1.22 is 78px, which pushes the first paragraph off the screen. Two
  numbers, `--tlc-text-scale` and `--tlc-head-scale`.
- **⚠ Normal is exactly 1 on both, and the stylesheet declares 1.** Same rule
  the typeface default carries: what `public/styles.css` says is what renders
  before the appearance fetch lands and forever if the admin is unreachable. If
  they disagreed, every page would visibly resize on every load.
- **All 75 `font-size` declarations in `public/styles.css` go through one of
  the two**, including the three `clamp()`s — scaling a clamp means scaling all
  three arguments or the curve changes shape. A test asserts none is missed, so
  the control is whole rather than reaching the rules somebody remembered.
- Blocks scale from the page wrapper: `wrapperVars` emits `calc(17px *
  var(--tlcb-scale, 1))` and `pageFontVars` writes the scale, because
  `wrapperVars` cannot see the appearance record and a block that stored its own
  copy would keep the old size. `styleVars()` in the editor mirrors it exactly.
- **⚠ Still open: the 228 inline `font-size` values in `public/index.html`.**
  Those are on the unconverted hardcoded pages and do not follow the setting.
  They retire as pages are published from the editor — the same schedule
  `--serif`/`--sans` are on.

**2. The calendar was squished, and height was only half of it.** `/calendar`
and the `/news` embed, one helper (`tlcLoadCalendar`) so they cannot drift.
600px gave six week-rows under 90px each — one event and a "+2 more" on any busy
week, so the thing the calendar exists to show was the thing it hid. Now 800px.
- **⚠ A MONTH GRID IS THE WRONG VIEW ON A PHONE AT ANY HEIGHT.** Seven columns
  across 390px is about 50px a day. Under 700px it loads Google's AGENDA view.
- Decided once, when the frame gets its address — deliberately not on resize,
  because reloading the embed under somebody who has navigated to March is
  worse than a laptop window dragged narrow keeping the grid.

**3. Contact details is a block now.** The info card could already show an
address, but only as a slot on a banner, so a plain page had no way to say "here
is how you reach us" without somebody typing it into a text block, where it goes
stale. It reads the church-details record, so it joins the sermon block and the
staff grid as self-filling. `church_facebook` / `church_instagram` /
`church_youtube` join that record — the details screen is data-driven, so they
appeared on it with no route change.
- **⚠ A blank account is left off entirely.** An icon linking nowhere is worse
  than no icon, which is also why there is no row for a network the church does
  not use.
- **⚠ `tel:` carries digits only.** A href with brackets and a space is one some
  dialers refuse, and the failure is a phone that does nothing.

**4. And it can write to somebody other than the office.** `contactEmail` on the
block. **⚠ Blank is the normal case and means "read the record"** — that is what
keeps change-it-once-everywhere-follows working for every block nobody
overrode, and the inspector says plainly that a typed address will not follow.
It is a plain address, never a URL: **the colon and slash are excluded, because
without them `mailto:x@y.z` passes and the render emits `mailto:mailto:x@y.z`**,
a link that silently opens nothing.

**5. Edge: None · Soft · Lifted · Lined.** Four, not the three asked for —
"lined" may have been "lifted" mistyped, and both are useful; Lined is a
hairline, which is what actually separates a block on a pale field.
- **⚠ None adds no class and no declaration**, so an untouched page renders the
  CSS it always did, and it is **not even stored**: putting the default in the
  base sanitize object adds the key to all 25 generated seeds, which the seed
  suite catches immediately (it asserts each seed is already sanitized).
- **⚠ An exclusion list, not a per-type flag** — deliberately unlike
  `ALIGNABLE_TYPES`. Alignment is a real question per type; "can this be set
  apart from the page" is not. Spacer has no surface; the three banners run edge
  to edge, where a shadow draws a box around the browser window.

**6. A Give button can land on a named fund** — the CCS appeal generalized,
which until now was two buttons hand-wired in `public/index.html` and rewritten
in the browser. **⚠ The block stores the fund's ID and nothing else.** A block's
URL is frozen the moment it is published, so a stored Tithe.ly address would go
on charging to the old form after the office changed the base link, and the page
would still look perfect. `withFund()` joins `withAmountAndFund()` in
`give-link.js` — one definition — and **replaces** the base `fundId` rather than
appending a second. Every failure (fund deleted, no Tithe.ly id, base link
unset, admin unreachable) ends in a button that still takes a gift.

**7. The whole card is the link.** Only "Learn more" was clickable, so a click
anywhere else on a card that visibly lifts did nothing.
- **⚠ An `<a>` on the public page, a `<div>` in the editor.** The heading and
  body inside are contenteditable, and clicking into them inside an anchor
  navigates instead of putting the caret there.
- **⚠ Never a nested anchor** — the label becomes a span.
- **⚠ A card with no address loses the hover lift too.** Rising under the
  pointer is a promise that clicking does something. It also stops emitting
  `href="#"`, which is the dead link this repo's own rule is about.

**8. The pages beneath a section, in the aside.** A fifth layout,
`sectionside`. **⚠ CHOOSING THE LAYOUT IS THE PER-PAGE SWITCH** — *"can be
automatic if the subpage view is turned on for that group, not every one might
need it"*. A page-level flag would have meant a column, a control on the Page
tab, and a second thing to keep in step with the layout it only makes sense
alongside. **⚠ It must not also append `section`'s list below the content** —
that is the same list twice on one page, and a test pins it.

**9. The tile look, twice.** Meeting times gains Service times' `tiles` layout
(`rows` stays the default, so every existing block is unchanged), and **Info
tiles** is the new type: the same `.tlcb-tile` rules with the words typed on the
page. A separate type rather than a source switch on Service times, because the
two hold different things and a switch would silently discard one shape.
- **⚠ `tileAlt()` is which tile is gold, in one place.** A block has one
  background and this layout needs two, so the alternate carries its colors
  inline. That was written inside the Service times branch; three copies is
  three chances for one to drift into a different gold.
- `.tlcb-tiles-n` is `auto-fit`, not the pair grid — three groups in a
  two-column grid is a lone tile on a second row.

**10. The hero was the one banner whose words did not line up with the page.**
Its block padding is zeroed so the field runs edge to edge — right — and nothing
put the content back on the content column, so the title sat 28px from the glass
while every heading below it began at `(100% - 1100px)/2`. Photo banner never
had this: it is not excluded, so it inherits the same inset. The hero now takes
the **identical expression**, not a nudge that happens to agree today.

Run: `node admin/blocks.test.mjs` (2493), `node admin/appearance.test.mjs`
(106), the integration suite, and the browser suites.

### A card's picture is dropped on, not typed into (v5.4.0, 2026-08-16)

Dinger, with the `/ministries` card grid open and Card 1's image field showing
`/images/ministries/food-pantry-thu…`: *"here can we make it a drag and drop for
the card images?"*

**A card's picture was the one image on the site with no way to put an image
there.** The block's own photo had a thumbnail and the library behind it; a
card's had a text box, so adding a photo to a card meant uploading it somewhere
else first and copying the address across by hand.

- **⚠ `itemUrlFields` COULD NOT ANSWER "IS THIS A PICTURE?"** — it only ever
  meant "put this through `safeUrl`". A card's `img` and a card's `url` both sat
  in it, so the editor could not tell an address a visitor is **sent** to from
  one an `<img>` is **pointed at**. Getting them the wrong way round offers to
  point a photograph at `/worship`, and warns that a perfectly good picture is a
  dead link. `itemImageFields` is the second, narrower declaration —
  `['img']` on Card grid, `['meta']` on Partner logos — and `isImageField()` is
  its `isLinkField()`. A new type with a picture gets the right control for
  free; one with a link never gets it by accident.
- **A gallery declares nothing**, because `gallery: true` already says every
  item is a photograph. A second list would be a second way to say it.
- **The address box stays under the thumbnail.** Not every picture on the site
  is one of ours — a partner's logo is often hosted by the partner — and
  deleting the one way to type an address to make a gesture prettier is a
  capability lost.
- **⚠ ON `dragover` THE FILE LIST IS EMPTY.** Every browser withholds the files
  until the drop lands, so a handler asking `dataTransfer.files` whether this is
  a file drag says no every time and the field never lights up. `types` is the
  one thing readable the whole way through.
- **⚠ The alt text is BORROWED, never invented.** The library refuses a photo
  with no description and is right to. For a card grid the heading *is* the alt
  the page renders (`alt="the card's heading"`), so the drop takes that — one
  copy, nothing to fall out of step. A card with no heading yet is told to name
  it first, rather than being handed the server's 400.
- **The photo joins the library on the way past.** One that exists only on one
  card cannot be reused and cannot be seen by the Media screen, which is where
  "used nowhere" and the size warnings live.
- **⚠ A file dropped ANYWHERE ELSE is swallowed.** Without that, missing a 44px
  thumbnail by half an inch makes the browser navigate to the JPEG — the editor
  replaced by a photograph. The cursor still says no outside a real field, so
  the invitation is not extended to the whole window just because the whole
  window has to listen.
- The handlers are delegated off the inspector panel, which is rebuilt on every
  change — the same trap the row grips are wired around.
- The block's own photo control got the same drop target, so the gesture is one
  gesture. It keeps its own description box, because there is no heading to
  borrow from.

**⚠ Two bugs found on the way past, both older than this work and both
invisible.**

- **`test/editor-server.mjs` never injected `LINKS_JS`.** The Worker does; the
  harness did not. So `renderInspector()` threw `ReferenceError:
  tlcPickerGroups is not defined` for **every block type with a link field** —
  Card grid, Button bar, Link tiles, Partners — and the panel read "Nothing
  selected" beside a plainly selected block. No browser test had ever opened
  one of those inspectors, which is why the next one went unnoticed for months.
- **⚠ REORDERING A CARD OVERWROTE ANOTHER CARD'S HEADING.** A canvas field
  identifies its item **by index**, and a structural change moves the index out
  from under it. `patch()` reorders the array, `renderInspector()` pulls focus
  into the panel, and the `focusout` that fires lands on a canvas the Worker
  has **not redrawn yet** — the redraw is a round trip. So `commitField()` ran
  with the old node's `data-item="1"` against a list where item 1 was now
  something else, and wrote one card's words over another's. **Silently: the
  canvas came back correct a moment later and only the SAVED DRAFT was wrong.**
  `S.canvasStale` is set from a structural patch until `setCanvas()` lands, and
  `commitField` refuses to write from a screen that describes the blocks as
  they were. Nothing genuine is dropped — a person's own edit is already
  committed by the `focusout` the control's own `mousedown` fires, before the
  patch. ⚠ It is cleared in `doRerender`'s **catch** as well: leaving it set
  would silently stop every text edit on the page from saving, which is a worse
  failure than the one that just happened and looks like nothing at all.

Run: `node test/editor-media.test.mjs` (Chromium — it fires real `DragEvent`s
with a real `DataTransfer`; ⚠ a `DragEvent` with no `clientY` reads as 0, which
is above the panel rather than above the row, and lands a dragged card back
where it started). Both reversions were verified: dropping the guard fails the
reorder group with the real symptom, two headings reading the same words.
Also `node admin/blocks.test.mjs`.

### The redesign, rebuilt from the FULL handoff (v5.3.0, 2026-08-14)

Dinger, after publishing: *"still doesnt look right… i had a different design
that wasnt just fonts, it was cards and shadow over lay effects"*, then *"here
is teh file to follow"*.

**The first bundle was half the specification.** The second contains four files
it did not: `CLAUDE_CODE_BRIEF.md` (a phased build plan written for the
implementing agent, with a Phase 0 verification list), `Handoff.dc.html` (the
illustrated spec — per-page block stacks, the gradients, the editor flows),
`KICKOFF_PROMPT.md`, and `Site Prototype - 1b.dc.html` (eight working pages),
plus 26 screenshots and a revised README. **The whole bundle is committed now**
— the same argument that put `design_handoff_admin_overhaul/` in the repo, and
for a sharper reason: a session reading half a handoff builds half a design and
cannot tell.

**⚠ THE ONE SENTENCE THAT EXPLAINS EVERY REPORT** is in §04:

> *"Flat navy and flat sand are a large part of why the old pages read as dead.
> Every large field in this language now carries a shallow gradient — 6–10% of
> value across the field, never a hue jump."*

The first pass shipped **flat fills**. Every "it still doesn't look right"
traces to that one line.

- **The three authored gradients are in verbatim** — Paper, Ink navy, Gold — on
  the `BG` entries. `c` stays the flat color because the ink-readability
  guardrail and the inspector swatches need a color rather than an image;
  `grad` is what is painted. ⚠ The four older surfaces stay flat: they are the
  site as it stands on every unconverted page.
- **The hero glow**, which the first pass did not build at all. The handoff:
  *"This is what stops the heroes reading gray."* ⚠ It paints **over** the
  veil — under it, the layer whose whole job is to stop the field reading gray
  is itself grayed — and unlike the veil it is drawn **with or without a
  photograph**, because the photo-less banner is the state the site ships in
  and is the one that most needs the warmth.
- **The info card was flattened three ways** and is fixed: a gradient rather
  than flat white, `0 20px 50px rgba(16,27,46,.40)` rather than a flat box, and
  a **fading** gold rule — 2px dissolving to nothing — rather than a 1px
  divider. It sits on the Home banner and is the most looked-at element here.

**Six block types the first pass missed**, now built: `highlight`, `cta`,
`signup`, `values`, plus `servicetimes` tiles and the extended `newsfeed`.

- **⚠ I argued against `cta` and `signup` and was wrong.** The reasoning was
  that the Button bar already carries an eyebrow, heading and rich description,
  so on a gold field it *is* a CTA. True of the markup, false of the job: a
  Button bar is a row of choices that grew a heading; a CTA is one ask that
  ends in a button. Asking somebody to reach for "Button bar" when they mean
  "ask the congregation to do something" is the indirection this editor exists
  to remove.
- **⚠ The Standout card and the Service times tiles are ONE set of rules.** The
  handoff calls the first "the service-times tile made general", so they share
  `.tlcb-tile` by construction. Service times' tile layout alternates ink navy
  and gold, and the second tile carries its colors inline because a block has
  one background and that layout needs two.
- **⚠ `big` is set only on the type that has it**, like `source`. A key on all
  36 types is a key in all 25 generated seeds for a field 35 can never render —
  which is what the first attempt did, and 25 suites failed.

**The core values are the record that already existed.** The brief predicted it
"almost certainly missing"; it was half right. `admin/values.js` is already the
one place the four live and `partners` already carries one ministry per value —
what was missing was the field gradient, the bright accent, the tagline, the
six ways in, and the why-this-order sentence. Extended there rather than as a
parallel table.

- **⚠ THE ORDER IS FIXED AND THERE IS NO REORDER CONTROL.** The order *is* the
  content: an arc from being let in to pointing out of the door, and each
  value's "why this one is here" only reads in sequence. The block has no item
  list, so there is nothing to drag out of order.
- **⚠ The four hues are the single departure from navy and gold** in the whole
  language, allowed on the value card field and its rule and nowhere else.
- **⚠ The contrast budget is honored as authored**: a field is measured at the
  end that HURTS, white ink is near-opaque rather than translucent, and the
  partner panel sits on a **dark** wash — a white one lightens the surface the
  white text sits on. A test asserts it is never white.

**`/about/values` is a block page now**, reversing `admin/BLOCK-EDITOR-ROLLOUT.md`.
That file's reason was that converting it "would freeze a list that currently
updates itself" — true while the only way to put the values on a page was to
type them into a card grid. The Core values block reads `ctx.data` at render
time, exactly as the hardcoded page reads the API, so nothing freezes.

**Phase 0, as the brief asks, before any code.** The canvas **already** scales
with `zoom: min(1, avail/w)` — the brief's biggest worry was a non-issue,
though widths are 900/620/390 rather than the spec's 1080/820/420. `.tlcb-pair`,
`SPACE_STEP` 8 and `SPACE_MAX` 96 all as assumed; `ctx` is one `pageData()` at
all eight call sites; ministry logos present; newsletter archive and partners
real records.

**Still open:** the photographs, and the interactive value selector/panel on
Our Values (the block draws the four cards; the handoff's selector is a
separate interaction).

Run: `node admin/blocks.test.mjs` (2240), `node admin/values.test.mjs`, the
integration suite.

### The redesign could not reach the pages it was written for (v5.2.0, 2026-08-13)

Dinger, on `/news` a day after the redesign shipped: *"it doesnt look like you
implemented the design changes"*, then *"the full newsletters are all still
showing"*, then *"i had a different design that wasnt just fonts, it was cards
and shadow over lay effects"*.

**Three reports, one cause, and the cause was the release itself.**

The four authored drafts (`admin/redesign-seeds.js`) arrive through the seed
loop, which is gated on `canReseed()`: untouched by a person **and** never
published. That guard is right — it is what stops a deploy throwing away
somebody's work. But **the pages most likely to have been edited are exactly
the four the redesign targeted.** `/news` had been rebuilt by hand and showed
"8 edits", so its new draft was silently skipped, and the page looked untouched
by the entire release.

That one fact explains all three:

| Reported | Why |
|---|---|
| The layout is unchanged | The block stack never arrived |
| No cards, no overlay effects | The banner veil, the photo cards, the hover zoom and the lift shadow live in the **block types**. Only the typeface reached him, because it is the one part of the language that rides on the stylesheet rather than on a block. |
| Full newsletters still showing | `loadNewsletters()` in `public/index.html` prints every letter's whole `pastor_note`. The month-folding from v4.35.0 is in the `newsletterarchive` **block** — so that fix has never been able to reach anybody either. Same Publish. |

**⚠ THE LESSON IS ABOUT SHIPPING, NOT ABOUT THE GUARD.** A seed that can only
land on an untouched page is fine for a converter improvement, which is what
`canReseed()` was written for. It is the wrong delivery mechanism for a
**designed** layout, because the pages worth redesigning are the pages people
have been editing. Do not weaken `canReseed()`; give the thing a door.

**`POST /pages/api/page/:id/use-redesign`**, and a "Use the redesigned layout"
button on the editor's Page tab, shown only where `REDESIGN_BLOCKS` has an
entry (`hasRedesign`, sent by the Worker rather than worked out in the browser,
so the button cannot exist and then refuse).

- **⚠ It snapshots to `page_revisions` FIRST.** That table normally holds one
  entry per **publish**, and a page that has never been published has none — so
  on `/news` the current draft was the only copy of work somebody did by hand.
  This is the one place a revision is written for something other than a
  publish, and that is exactly why.
- **⚠ The DRAFT only.** `published_blocks` never moves; the live page is what
  it was until somebody presses Publish. Same rule every seed follows.
- **⚠ THE ROUTE REGEX WAS `([^/]+)(\/[a-z]+)?`.** No hyphen, so
  `/use-redesign` never matched and the button returned "Not found" with the
  handler sitting right there looking correct. Widened to `[a-z-]`. A test
  pins it, verified by reverting the single character.
- A page with no authored layout is refused with a message rather than writing
  nothing and reporting success.

Run: the `hand-edited page` group in `test/admin-redesign.test.mjs`.

### A dead link is checked now, not just a safe one (v5.2.0, 2026-08-13)

Every URL field in the block editor was a plain text box. `safeUrl()` decides
whether a value is **safe** — no `javascript:`, no quote that breaks out of an
attribute — and that is *all* it decides. It has no opinion about whether the
address exists, so `/abuot` saved perfectly cleanly, rendered as an ordinary
link, and sent the visitor to the page-not-found screen.

That is this repo's own rule broken by omission: **a dead link is worse than a
missing one, because it looks like it works.** It was written down when
`/give`'s "Speak with a pastor" button came out of the extractor pointing at
`#`; the fix there was one call site. `admin/links.js` is the general case.

- **⚠ THREE SOURCES OF "SOMETHING IS THERE", NOT ONE.** `linkTargets()` in the
  Worker reads page slugs, their **derived short links** (`shortLinkFor`), and
  **active redirects**. A check that knew only about slugs would flag `/music`
  and `/zoom` — which are the addresses the church prints on flyers and says
  from the pulpit. Warning about the two most-used kinds of link on the site is
  how a warning stops being read.
- **⚠ NOT scoped to what the signed-in person may EDIT.** The rail's page list
  is filtered by ownership; a ministry leader who can only open their own page
  still needs to link to `/worship`. Different question, different query.
- **⚠ IT WARNS, IT NEVER REFUSES.** A page somebody is about to create is a
  legitimate reason to type an address that answers nothing today. Refusing
  would be wrong often enough that the office would learn to work around it.
- **⚠ Only `url`, and only when the list is not photos.** A gallery's and a
  slideshow's `url` is an IMAGE address, as are a card grid's `img` and a
  partner's `meta`; an embed URL (calendar, Google Form) is not somewhere a
  visitor is sent either. `isLinkField()` is the one rule, so a new type with a
  link field gets this free and one with an image field does not get it by
  accident.
- **The picker offers each destination once.** `/music` and `/ministries/music`
  are the same place, and it offers the **short** one — the address the church
  uses, and the one that survives a page moving under a different parent.
- **`LINKS_JS` ships the browser copy** from the same file, the way
  `give-link.js` ships its arithmetic: the warning has to appear while somebody
  is still typing, and re-rendering the inspector to get it would steal the
  focus out of the box. **The test evaluates that string and runs the same
  sixteen cases against both implementations**, so they cannot drift.
- ⚠ The template literal ate the regex escapes on the first attempt —
  `/^https?:\/\//i` became `/^https?:////i` inside the string. Caught by the
  mirror test, which is what it is for: a broken picker in somebody's editor
  looks like a field that has simply stopped working.

Run: `node admin/links.test.mjs` (156).

### A block's own rows can be reordered at last (v5.1.0, 2026-08-13)

Dinger, on the drag-and-drop inventory: *"What other drag and drop type page
select elements are we missing?"* — and then, on the answer, *"Or could be
added not in the design file."*

**Ten block types carry an ordered list inside them** — Card grid, Button bar,
Columns, FAQ, Photo gallery, Meeting times, Link tiles, Welcome banner slides,
Partner logos, Amount ladder — and the inspector offered exactly two actions on
them: `item-add` and `item-del`. **There was no way to reorder a row at all.**
Moving the seventh card in a grid to the top meant deleting and retyping all
seven.

**The redesign made that concrete.** `/ministries` seeds **nine** cards, and
that grid's `feature` switch draws **the first card** dark — deliberately the
first rather than a chosen one, so reordering the grid moves it and there is no
second setting to forget. Which meant *which ministry the page leads with* was
decided by the order they were typed in, and could not be changed.

- **A grip AND a pair of arrows.** The grip is the idiom the rest of this admin
  already uses — `panelList`, the menu tree, the block rail. The arrows are what
  keep it reachable without a mouse: drag on its own is a keyboard dead end,
  which is exactly the finding the accessibility pass made about list rows. They
  are also better in a 322px panel that may hold twenty-four rows.
- **⚠ THE GRIP CARRIES `draggable`, NEVER THE ROW.** The row contains text
  inputs, and a draggable ancestor stops the mouse selecting text inside them —
  you drag the whole card instead of highlighting a word. A test asserts the row
  itself is not draggable, which is the half that looks redundant and is not.
- **⚠ The drag handlers are delegated off the inspector panel**, which is
  rebuilt on every change. Handlers bound to the rows themselves would be thrown
  away by the first reorder, so the second drag would silently do nothing —
  the same trap the gym renter's basket hit in v4.11.0.
- **⚠ `S.rowDrag` is its own field, not a share of `S.dragId`.** That one moves a
  whole block between positions, pages and half-width pairs; this moves an index
  inside one array. Sharing a field would let a half-finished row drag be
  completed as a block drop.
- **⚠ Dropping below a row is index+1, decremented when moving downward.** The
  classic splice off-by-one: without it a row dragged downward lands one short
  of where it was aimed, every time.
- **The ends are disabled, not inert.** A control that looks live and does
  nothing is worse than one that is visibly unavailable.
- **One row draws neither control**, because there is no reordering to offer.
- The card's own links got the same treatment from the same helper, so the two
  lists cannot come to behave differently.

**Still not reorderable, and worth knowing:** three list screens — Christian Ed
classes, Link cards and Staff — still order by a typed "Order" number while
Partners and Giving next door use drag handles. Same job, two controls,
depending which screen you are on. Not fixed here; it is a `sort_order` column
and a `panelList` away.

**Two that look missing and are not:** the pages rail does not drag, because
nav order is owned by the Menu screen and a second place deciding it is the
defect this avoids; and blocks do not drag between the halves of a pair,
because a pair is not a container — it is what two adjacent half-width blocks
*do*, and dragging "into" one would invent the nesting the rail deliberately
has none of.

Run: the `rows can be reordered` group in `node test/editor-edit.test.mjs`.

### The site redesign, and the one setting that carries it (v5.0.0, 2026-08-13)

Andrew's brief, verbatim: *"it just feels dead, and so do all the pages on the
site — the editor is helpful, it just all lacks energy."* The designer's answer
is `design_handoff_news_redesign/` — three directions for `/news`, of which
**1b was chosen**, then extended to Home, Worship and Ministries as a site
language rather than one page's treatment.

Dinger answered the seven open questions before any of it was built, and two of
those answers are load-bearing:

| | |
|---|---|
| Scope | All four pages |
| Arrows | **No** — the repo rule wins |
| A banner with no photo | Renders navy |
| Header and footer | Move to the new language too |
| Publishing | Unchanged — seeds land in the draft |
| Fonts | Add both, **and add a font selector** |
| Block types | **"one look one unified type"** |

**⚠ THE TYPEFACE IS THE LEVER, AND THERE IS EXACTLY ONE OF THEM.** The first
attempt made the new language opt-in per block — pick one of the redesign's
backgrounds and that block speaks the new language. *"One look, one unified
type"* rules that out: it is precisely the mechanism by which a site ends up
reading like two sites, one block at a time, with nobody able to see it
happening. So the lever is a single setting on **Menu → Appearance**, and it
moves every page, the chrome, and every block in the page editor at once.

- **Three roles, not two.** `--font-heading` / `--font-body` / `--font-ui`, the
  three properties `public/styles.css` has always declared. Both pairs use
  their families differently: classically Lora sets headings and Source Sans
  does everything else; in the redesign **Bricolage sets headings AND the UI** —
  buttons, eyebrows, small-caps meta — and Newsreader carries the reading copy.
  ⚠ Collapse that to a heading/body pair and every button on the site is set in
  a reading serif. It is still legible, so nothing looks broken; it is just the
  wrong design, quietly, everywhere. A test pins it.
- **⚠ `public/styles.css` HAS TO AGREE WITH `DEFAULTS.typeface`.** What is
  written there is what renders before the appearance fetch returns and forever
  if the admin is unreachable. If the two disagree, every page paints one pair
  and visibly reflows to the other **on every single load, on all 28 pages**.
  `admin/appearance.test.mjs` asserts they match; verified by flipping the
  default, which fails it.
- **⚠ `--serif` and `--sans` are deliberately NOT re-pointed.** Dozens of inline
  styles in `public/index.html` still name them directly on pages not yet
  converted, and those do not follow the selector. They retire when the last
  page is converted, not before.
- **Both pairs are loaded in the head**, not just the selected one — the setting
  is fetched at runtime, so nothing at parse time knows which is in force, and
  the classic pair is needed regardless for the call sites above.
- `pageFontVars()` writes the pair onto the page wrapper every render path
  emits, so the public page, the editor canvas and `/api/ministry/:slug` follow
  from one line rather than three places remembering to. The header preview does
  the same — it was drawing the site's header in the **admin's** fonts, which is
  the exact class of lie that preview exists to end, moved from color to type.

**The geometry went on the shared primitives**, for the same reason: pills on
`.tlcb-btn`, display weight and negative tracking on `.tlcb-head`, the wide
tracking on `.tlcb-eyebrow`, light reading copy on `.tlcb-prose`, the design's
radii. Nineteen rules, and *which* nineteen is the whole decision — a parallel
family of 1b block types would have guaranteed the patchwork.

- **⚠ Motion is gated on `prefers-reduced-motion`.** The mocks did not do this
  and the handoff says to add it. Not a taste preference: motion somebody did
  not ask for causes real nausea with a vestibular disorder, on a church website
  people open when they are looking for help. A test asserts the gate stops each
  of the three movements, because a note in a handoff is not a mechanism.

**Four new block types, not the handoff's six.** Its `cta` and `signup` are the
**Button bar** and the **Newsletter** block already here — the Button bar has
carried an eyebrow, a heading and a rich description above its buttons since
v4.32.0, which is exactly what its `cta` draws. Put either on the Gold or Ink
navy background and it is the mock. The four that earn their place are shapes
nothing here could make: `photobanner`, `quote`, `chips`, `letter`.

- **⚠ THE NO-PHOTO BANNER IS THE ONE THAT SHIPS.** There are no usable
  photographs in the repo — the handoff says the design needs about eight and
  that every picture in the mocks is an empty drop target. So a flat ink-navy
  field is what goes live, and it has to read as deliberate: **the veil is drawn
  only over an actual photograph**, because a dark gradient over navy is
  precisely what a picture that failed to load looks like.
- **⚠ The countdown emits an INSTANT, not a date.** It is arithmetic against
  `Date.now()` in a browser that may be anywhere; a bare date tells somebody
  outside Central the wrong start time. `churchInstant()` in `admin/when.js` is
  the one place a wall clock becomes a moment — it iterates twice so the two DST
  changeover weekends resolve, where a hardcoded offset is wrong for half the
  year.
- **⚠ The Coming-up strip renders NOTHING when nothing is coming up.** It is a
  one-line aside between two real sections, and a strip announcing its own
  emptiness is worse than the gap. Which surfaced a real bug: **`renderBlock`
  emitted its wrapper even when the block rendered nothing**, so an empty strip
  was an invisible colored band that still pushed the page down — and on a light
  surface nobody could see what was making the gap. A block that renders nothing
  now renders nothing, except in the editor, where a block you cannot select is
  one you cannot delete.

**`choices` and `switches` are declared on the type**, and `sanitizeBlock` and
the inspector read the **same two arrays**. That is the whole reason they are
declarations rather than a dozen more lines in the sanitizer and a dozen more
if-branches in the editor: a control cannot appear on the screen without being
guarded on the way in, and a guarded field cannot go missing from the screen. A
test walks every type and asserts both directions. ⚠ A switch's `def` decides
which way an **absent** value falls, so a switch that is on by default stays on
for a block saved before it existed rather than silently losing a feature.

**`BG` and `INK` gained the redesign's surfaces, APPEND ONLY** — `bg` is stored
as an index, so inserting an entry silently repaints every page on the site. A
1b entry carries its own heading ink, eyebrow, link and hairline, because in
this language those move with the background; splitting them would let somebody
assemble a gold eyebrow on a gold field. ⚠ **Ink navy `#101B2E` is not Navy
`#1E2D4A`** — Navy is the site's `--steel`, on every unconverted page, and a bar
in one against a page in the other reads as a mistake rather than two shades.

**The four page drafts live in `admin/redesign-seeds.js`**, hand-authored,
because `admin/site-pages.js` is generated out of the very markup they replace.
It overrides **the blocks and only the blocks** — title, address, menu placement
and layout stay generated. ⚠ They land in the **draft**: `published_blocks` stays
NULL and `canReseed()` skips any page anybody has touched, so the live site
renders its hardcoded markup until somebody opens each page and presses Publish.
On these four that is not a formality.

- Home carries **no** email sign-up block, though the design's does: that band
  is site-wide chrome on all 28 pages, so a block would sit above a second copy
  of itself.
- ⚠ The seed test asks whether anything is **silently dropped**. A seed is
  written by hand and read by a sanitizer whose job is to be unforgiving — an
  unknown type vanishes, a bad value clamps, both invisibly. It walks every
  field of every block and asserts it is stored as written, plus no trailing
  arrows (a seed is exactly where one gets pasted from a mock, because it reads
  as content rather than code, and the arrow grep reads **source** — a label
  built from a seed at render time is not source).

**The bar color default moved to ink navy**, with a caveat: a default only
decides what an **unset** field is. The Appearance screen has existed since
v4.23.0, so if a record has already been saved the stored moss wins and the bar
does not move until somebody picks ink navy on the screen. That is one click,
and it is the right way round — the color of the church's header is theirs, not
a deploy's.

**Still open, and deliberately:** the photographs. Nothing else in this work is
waiting on anything.

Run: `node admin/blocks.test.mjs` (2032), `node admin/appearance.test.mjs` (82),
`node admin/when.test.mjs`, the integration suite, and in a browser
`node test/editor-edit.test.mjs` and `node test/public-phone.test.mjs`.

### The newsletter archive folds away by month (v4.35.0, 2026-08-13)

Dinger, in the `/news` page editor: *"there are news articles after all of what
i can edit. i dont wnat every news article displaying there should be the most
recent one open and then you cna do a list but by pages or by month all
collapsed only week title for whole news letter"*.

**This is the "weekly newsletter display wants adjustments" item from
2026-08-05, which sat on the pending list for a week with no specifics.** It has
them now.

The Newsletter archive block printed a preview for the newest `count` issues
and then **one title row per issue for everything else it had** — up to the
`LIMIT 12` in `pageData()`. On a weekly letter that is a column of
near-identical lines that only ever grows, and it sits below the blocks
somebody is trying to edit.

- **The newest letter is open; everything older folds into its month, closed.**
  A month is the unit somebody remembers a letter by, and it turns a year into
  twelve rows instead of fifty-two.
- **`<details>`, not a script.** It opens with no JavaScript at all, it is a
  keyboard and screen-reader control for free, and it behaves identically in the
  editor canvas and on the live page. Verified in Chromium: the summary is a tab
  stop and the caret really does rotate (`rotate(45deg)` → `rotate(-135deg)`).
- **⚠ The group key is the raw `YYYY-MM` off the stored string, never a month
  read back out of a `Date`.** Constructing a date and asking for its month puts
  a letter published on the 1st into the previous month for anybody behind UTC —
  correct in St. Louis, wrong in the Worker that renders it. The *label* still
  goes through `fmtNewsDate`'s noon anchoring for the same reason. A test pins
  the 1st-of-the-month case specifically.
- **The default `count` is 1**, down from 2, which is what "the most recent one
  open" asks for. ⚠ `defaults` only reaches blocks created from now on —
  an existing archive block keeps its stored count, and the office changes it
  on the inspector's own count control. `sanitizeBlock` clamps it to 1–6, so
  "none open" is not reachable and does not need to be.
- **A month's rows drop their own border.** They are already fenced by the
  month's, and two borders reads as a box in a box.

He offered "by pages or by month" — month, because it needs no pagination state
in a static render and because a weekly letter is four or five to a month, which
is a sensible thing to open.

Run: the newsletter-archive group in `node admin/blocks.test.mjs`.

### A username is changed on its own screen too (v4.34.0, 2026-08-13)

Dinger: *"when i try to change a person access it is forcing a name change and
then hitting error"* — with a screenshot of `/users/edit/4`, headed **katig**,
whose Username box read **`admin`**.

**v4.26.0 fixed half of this and the half it left is the half that broke.** It
removed the password field, correctly, because a manager fills a form's
username box whenever it fills a password box beside it. The username box
stayed, marked `readonly`. **⚠ `readonly` stops the browser's own autofill and
does not stop an extension** — 1Password and LastPass fill readonly inputs — so
a manager still wrote `admin` into katig's name box, and Save posted it.

`users.username` is `UNIQUE`, so the UPDATE threw, the top-level catch turned it
into "Something went wrong · Reference: …", and the office was told nothing
except that access could not be saved.

- **The field is not on the access form at all now**, which is the same fix as
  the password and for the same reason: *removing the field removes the thing
  being filled.* Do not put either one back on that screen.
- **`/users/edit/:id/username` is where a name changes**, matched **before** the
  two `/users/edit/` handlers — they read the id off the last path segment and
  would otherwise take the word *username* for an account id. Exactly the
  ordering note the password screen already carries.
- **The POST stopped reading `username` at all**, so the rule holds against a
  stale tab or a crafted POST and not merely against the markup. That matters
  more here than in most places: the thing writing the field was never a person.
- **⚠ A name already in use is CHECKED, not left to the UNIQUE constraint.** An
  unhandled constraint error reaches the top-level catch and shows a reference
  number, which tells somebody renaming an account nothing about the name being
  taken. That error page *was* the reported bug.
- **Renaming updates `sessions.username` rather than deleting the rows.**
  Changing what somebody is called must not sign them out; changing what they
  can *reach* still does.

⚠ This can rewrite an account's identity as a side effect of an unrelated save,
so it is a candidate for whatever left the Pages screen owner-scoped — see the
section below. Not proven, and worth checking a suspect account's permissions
against what its holder should have rather than assuming.

`LOCKED_FIELD_JS` / `.tlc-lockrow` (`admin/ui.js`) now have no markup using
them. Left in place deliberately — the mechanism is sound for a field that is
genuinely only guarding against a slip, which is not what this was.

Run: the users group in `test/admin-redesign.test.mjs`. It posts a rival
username at the access form and asserts a 302 with the name unchanged —
**verified against the bug**, where it fails with the real symptom, a 500.

### An empty list must say why it is empty (v4.33.0, 2026-08-13)

Dinger, with a screenshot of the Pages screen: *"i no longer see the pages here
to edit"* — and then *"edit giving pages is also broken"*. The table read **"No
pages to show. Use the button above to add the first one."** beside a sidebar
badge reading **"24 waiting"**.

**The screen was contradicting itself and only one half was true.** The badge
comes from `badgeCounts()`, which selects `status`/`blocks`/`published_blocks`
only; the list selects fourteen more columns. So the badge counted 24 pages
while the list showed none, and the list's own words said the site had no pages
at all.

**⚠ THE DEFECT IS `.catch(() => ({ results: [] }))`.** It turned any database
error into an empty array, which `renderListSection` then rendered as its empty
state — a sentence about a site with no pages, under a button offering to
create the first one. That is the dead-link rule again: *a wrong answer that
looks like a working answer is worse than no answer.* Somebody reading it goes
looking for missing content, not a missing column, and on the Giving screen the
same swallow said "The giving page has no amount ladders on it" beside a link
inviting them to add one — which would have given the church's donation page a
**second** set of giving amounts.

**Three ways this screen can be empty, and they want three different actions**,
so it now names which one it is:

| | What the screen says |
|---|---|
| The read failed | The query was refused; the pages are still there; here is the error to hand on |
| `pages_edit_own` with nothing assigned | N pages exist but none are yours — names the permission, and where an admin turns it back on |
| Genuinely empty | The original wording |

- **⚠ `emptyHelp` is why the second line is now overridable.** It was hardcoded
  to "Use the button above to add the first one" for every section — wrong
  wherever the reader cannot use that button. An owner-scoped account is
  refused by `/pages/new`, and no button fixes a database fault. Telling
  somebody to press a control that will refuse them is worse than saying
  nothing. The client-side filter script reads it from `data-empty`, so the
  override survives a search being typed and cleared.
- **⚠ Both `pages_edit` and `pages_edit_own` reach this screen, and only one
  of them shows anything.** `owns()` filters every row away for the second, and
  the badge is scoped to *either*. An account that loses `pages_edit` while
  keeping `pages_edit_own` therefore lands in exactly the state above — which
  is what the `migratePermissionKeys()` double-run would produce on a
  full-access account (it holds both, and a second pass rewrites `pages_edit`
  to `notices_edit` while leaving `pages_edit_own` alone). See the v3.0.0
  section for why that migration must never run twice.
- **`pages.owner_username` moved to the ALTER list.** It was inside the bigger
  `try` that seeds the page rows, sitting after three CREATEs and before a loop
  of INSERTs, so anything above it throwing skipped the column and the outer
  catch only logged "Site page seed failed". Every query except the ones naming
  that column keeps working, which is a fault that hides for months and
  surfaces as one screen mysteriously empty. **Every `ALTER TABLE pages` now
  lives in one list, one per line, each with its own catch.** `SCHEMA_VERSION`
  bumped so a live table missing the column actually gets it.
- **`.alert-warn` was used before it was defined**, so it drew the `.alert`
  border with no fill and no ink — a box that reads as plain when it is meant
  to read as wanting attention. Defined from the Foundations Waiting tone.

Run: two groups in `test/admin-redesign.test.mjs`. The failing-read one
**drops the column** rather than stubbing an error, so it reproduces the real
shape: the badge keeps counting while the list cannot be read.

### A button bar is a call to action, and a logo lives on the partner (v4.32.0, 2026-08-07)

Dinger, in the block editor: *"i don't see a CTA button, a place to set partner
logos and then select that. in the button bar i need it to be able to have a
heading, description and then the button. right now it is just a button."* And,
separately: *"in a rich text box can i create on line that is a Heading and
larger bold font and then the text under it"*.

**Three findings, and two of them were controls that were missing rather than
broken.**

- **The rich field had no headings control at all.** `h2`, `h3` and `h4` have
  always been in `sanitizeRich`'s allowlist, always in the inline editor's
  `valid_elements`, and always styled in `BLOCK_CSS` — the toolbar was
  `bold italic underline | bullist numlist | link` and simply never offered
  them. So the answer was one config line, not a feature. ⚠ The **classic**
  admin forms (news, sermons, the newsletter) already had `blocks` in
  `TINY_TOOLBAR`; only the block editor's inline instance was short. The three
  names are the site's own hierarchy (`Text` / `Heading` / `Subheading` /
  `Small heading`) and **H1 is deliberately not offered** — a block already
  draws the page's heading, so an H1 inside a rich field is a second page title
  halfway down the page.
- **The Button bar is a call to action now** — optional eyebrow, heading and
  rich description above the row. ⚠ **The head is conditional and that is the
  whole safety property**: `renderHead`/`renderBody` always emit their element
  so the editor has something to click into, so a Button bar already on a page
  would have grown a blank line above its buttons. The public render returns
  the bare row unless something has actually been written, and the defaults are
  empty strings, so every existing block is byte-identical.
- **`renderBody` takes a placeholder now** rather than always saying "Write
  something here…", so the Button bar's description can ask for what it wants.

**The partner logos were the interesting one, because the missing thing was not
a field — it was an owner.** The block stored each logo as a typed image URL in
its own `items`, which meant the same partner's logo had to be typed into every
page showing it, and none of those copies were the one the values page or the
footer's Partners column read. There was nowhere to *set* a partner's logo at
all.

- **`partners.logo_url` is the record**, uploaded on the Partners screen through
  the same `/api/upload-image` path as every other image, and put through
  `safeUrl` on the way in — our own script wrote the hidden field, but the value
  still arrives in a POST.
- **The block reads it.** `pageData()` carries the partner list, so Partner
  logos joins the sermon block and the staff grid as self-filling. A logo
  uploaded once appears everywhere it is shown.
- **⚠ `manual` IS THE FALLBACK IN `sanitizeBlock`, and `record` is the default
  only in `defaults`.** A block saved before this existed carries typed items
  and no `source`; reading that as `record` would have replaced somebody's
  hand-built logo row with the four partner ministries the moment this
  deployed. The new default reaches only a block somebody creates now.
- **The hand-typed list stays**, because not every logo on the site is a partner
  ministry — a sponsor or a one-off event supporter has no business being a row
  in `partners`. Switching to the record **hides** that list rather than
  deleting it, so switching back brings it back exactly as it was.
- **Empty `partnerIds` means all of them**, so a partner added later appears
  with nobody editing the page. ⚠ That makes unticking one of an untouched
  block write out every *other* partner, not an empty list — otherwise the
  first untick would read as "show them all" and appear to do nothing. Ticking
  the last one back collapses to empty again.
- **Both keys are set only on a type that has the choice**, unlike `card`, which
  every block carries. A type with no source has no `source` field — which also
  keeps this change out of the generated page seeds for the twenty-odd types it
  means nothing to.
- **⚠ `/partners` joined the `/api/pages` cache chokepoint.** Uploading a logo
  changes what a published page renders without any page being touched, so
  without that the new logo would sit behind the edge copy until it aged out.
- A partner with no logo renders as its name — what the block already did — and
  the inspector says how many are in that state with somewhere to go and fix it.

⚠ A test caught itself: `includes('tlcb-head')` is always true, because every
block's wrapper carries a `--tlcb-head` custom property in its style attribute.
The assertions match `class="tlcb-head"`.

Run: `node admin/blocks.test.mjs` (two new groups), plus `node test/editor.test.mjs`
and `node test/editor-edit.test.mjs`.

### The payroll exports are the bookkeeper's format again (v4.30.0, 2026-08-07)

Dinger, with the July 6 PDF and CSV attached: *"read these file exports that is
how it used to be for payroll exports then this last edits you altered it. it
needs to return to these formats"*.

**The v3.2.0 rebuild moved the payroll SCREEN onto the shared shell and took
the printed report with it.** The old page had a separate print-only table
(`#printTable`, `pt-*` classes) that never appeared on screen; the rebuild
dropped it, so Print started printing whichever of the three report layouts
happened to be selected. The CSV went the same way — one generic
`Person · Paid as · Hours/salary · PTO used · Gross` table per group, church
staff first.

**What that generic table actually costs:** an MDO person is an hourly rate
and hours; a church person is a base plus **Housing, Ins Opt-Out, HSA, Mileage
and 403(b)**. Five columns of real money the bookkeeper keys in by hand
vanished into a single "Gross" figure. Two shapes for one payroll run is also
work somebody does by hand every fortnight, because the CSV is reconciled
against the printed page.

- **`exportReport()` in `admin/payroll.html` is the one builder**, and the
  printed report, the CSV **and** the bookkeeper's email are all rendered from
  it. They were written out three times, which is how they drifted apart.
- **⚠ MDO comes first there and church second — deliberately NOT the order of
  `reportGroups()`**, which drives the on-screen layouts. Do not tidy the two
  into agreement.
- **⚠ `#tlcPayPrint` is a separate print-only rendering, not a print
  stylesheet over the screen.** That is the whole defect: the bookkeeper's
  copy has one shape and must not change with a layout tab. A test asserts
  that switching to Totals only leaves the print markup byte-identical.
- **⚠ `break-inside:avoid` goes on a ROW, never on `.pt-section`.** A section
  is two dozen people; told not to break, a church table that does not fit in
  what is left of the page moves to a second sheet whole, and the one-page
  report becomes two with most of page one blank. Found by rendering the real
  July 6 figures to PDF and comparing, not by reading the CSS.
- **⚠ The PY-5 formula guard is for text somebody TYPED, not for our own
  figures.** The 403(b) is written as a negative, so a blanket guard turns
  `-136.00` into the text `'-136.00` and the bookkeeper's column stops
  summing. `csvText()` for names, `csvNum()` for figures this file formatted.
- **The July 6 file does not add up to itself, and the restored export does.**
  Its MDO rows sum to `16348.78` beside a printed subtotal of `16348.79` —
  that is PY-6 (summing unrounded floats), and the same run's *PDF* prints one
  of the rows as `$670.43` where its CSV says `$670.42`. Every other line
  reproduces byte-for-byte; the subtotal and total are one cent different
  because they now equal the rows above them. **Do not "fix" this backwards.**
- The stray `Pay Period` heading at the top of the old PDF was the period
  card's own `<h2>` leaking through a print rule that hid only the row beneath
  it. Not reproduced.
- **The emailed report was rebuilt to the same two tables** — same report, same
  recipient, so it must not be a third shape. The page still posts figures and
  the Worker still builds and escapes the markup.

Run: `node test/payroll.test.mjs` (Chromium, stubbed Supabase) — it captures
the Blob the Export button produces and pins the header rows, an hourly row, a
salaried row, the subtotal padding widths and the total row, plus the printed
report's columns and its independence from the layout tabs. Also two groups in
`test/admin-redesign.test.mjs` for the email.

### Anything can be left, centered or right (v4.28.0, 2026-08-06)

Dinger, with a **Button bar** selected — one button, hard left, no control to
move it: *"for this selected block, and all blocks i want alignment of left,
center and right and that should work for buttons too."*

**Alignment was left/center on ten types.** The reason written here for
excluding the other twenty-one was that centering a grid's cells and centering
the grid itself are different problems, each needing their own CSS. That is
true, and it is a description of what the CSS has to do — not a reason to
withhold the control. `align: true` is on 31 of the 32 defs now; **Spacer is
the one genuine exclusion**, having no content to align.

- **`ALIGNABLE_TYPES` is still derived from the def flag**, not a second list.
  It was `CENTER_ALIGNABLE_TYPES`; the name stopped being true the moment
  right existed.
- **⚠ Left is the ABSENCE of a class.** An untouched page renders from exactly
  the CSS it always did, rather than from a new rule that happens to agree
  with it. Only `center` and `right` add one.
- **`text-align` does the bulk, and it inherits** — one declaration reaches
  every heading, eyebrow and paragraph in the subtree without naming them.
  Everything after it is only what inheritance cannot do: the three button and
  notice rows (`justify-content` is not inherited), the flex columns whose own
  `align-items` beats any amount of text-align, and the max-width elements
  that need their side margins moved.
- **Three type-specific rules were deleted, not lost** — Callout and Hero's
  band-text, Hero's subtitle margins, the Notice bar's row. Each is now the
  generic rule doing that job for every type at once. Two rules for one job is
  two places to disagree.
- **Card grid gave up its own duplicate Alignment chips** and joined the
  shared control, gaining right with everything else. It keeps its own inner
  `tlcb-cg--*` classes, which reach *inside* a card where the generic rules
  deliberately do not.
- **⚠ The amount ladder still aligns its intro only.** Its rows are an amount
  on the left and a Give button on the right, and moving that text is not what
  "center this section" means to anybody looking at it. It is now a **reset on
  the row** rather than a list of the five elements to align — the older note
  here argued the opposite, on the grounds that a rule existing only to undo
  the rule above it goes wrong when a sixth element is added. That inverted
  once alignment became general: anything added inside a row now inherits the
  row's left and anything added to the intro inherits the block's alignment,
  with no list to keep in step either way.
- **⚠ A backtick in a CSS comment broke the module** while writing this — the
  exact trap recorded under "node --check does not catch a broken module".
  Describe a class in these comments; do not quote one.

Run: `node admin/blocks.test.mjs`.

### A ladder row is edited on the Giving screen (v4.28.0, 2026-08-06)

Dinger, on the read-only ladder panel v4.27.0 added: *"here you now just are
showing what the amounts are but no way to EDIT them"* — and, with a
screenshot of the Funds / Amount tiers panels, *"use this as a template for
the edit design"*.

**The read-only panel was my call and it was overruled.** The reasoning was
that each row carries its own sentence about what that gift pays for, so a
second form here would be two places that disagree about what $5,000 a year
buys. The correct reading of the overrule is not "he wants a duplicate": it is
that **a screen called Giving, which already edits every other amount on the
page, cannot be the one place these amounts are merely displayed.**

The duplication worry is answered by where the words are *stored* rather than
by refusing the control. There is still exactly one copy of a ladder row — the
`amounts` block on the giving page — and these routes are a second **door**
onto it, not a second record. There is no ladder table and there must not be
one.

- **The panels are `panelList()`**, the same shape as Funds and Amount tiers:
  grip to reorder, name, what the button asks for, Edit into a drawer, and
  `+ Add amount`.
- **A row has no id of its own**, being an item inside a block's JSON, so it
  is addressed as `?row=<blockId>:<index>` and `:new` appends.
- **⚠ Every route writes `blocks` and never `published_blocks`.** Editing here
  is exactly as live as editing in the page editor — which is to say not at
  all until somebody publishes. A side screen must not be able to change the
  giving page without passing through the one step that exists to make that
  deliberate. The toast says where it went rather than just "Saved".
- **Rich text survives an edit that leaves the words alone.** The description
  is rich on the page and a plain textarea here; the save keeps the stored
  markup when the plain text is unchanged, so fixing an amount never quietly
  flattens emphasis somebody added in the editor.
- **An unknown block id writes nothing at all.** A stale tab or a hand-typed
  address gets the screen back, not a page of blocks written from a request
  describing something no longer there.
- **Reorder posts the whole resulting order**, same contract as the menu, and
  anything the post did not mention is appended rather than dropped.

Run: two groups in `test/admin-redesign.test.mjs`.

### The admin knows what day it is here (v4.31.0, 2026-08-07)

Dinger, with a screenshot of the dashboard reading **"Friday morning"**: *"it
thinks that it is friday morning. but where i am it is thursday evening can we
fix this"*.

**The Worker runs in UTC and the church is in St. Louis.** Every evening from
about 7pm those two disagree about the date — 8pm Thursday in St. Louis is 1am
Friday in UTC. The greeting was `new Date().getHours()` and
`toLocaleDateString()` with no timezone, so it read the Worker's day.

**The greeting was the harmless one.** The same `new Date().toISOString().split('T')[0]`
— the UTC date — was how forty-odd other places asked what today was:

- **A news post written on Thursday evening was DATED FRIDAY.** The form's
  default `publish_date` was the UTC date.
- **`/api/news` published and expired posts five hours early on the public
  site**, since it filters `publish_date <= today` and `expire_date >= today`.
- **The expiry sweep deleted a post, and its image out of R2, a day sooner**
  than the office had asked for.
- **The gym portal grayed out today's date** and refused a booking for it, and
  invoices generated in the evening were dated tomorrow.
- **A tap counted after 7pm on the last day of a month** went into the next
  month's total, which is the only number that screen reports.

`admin/when.js` is the one answer now — `churchDate()`, `churchDatePlus()`,
`churchHour()`, `partOfDay()`, `churchFormat()` — and every one of those call
sites goes through it.

- **⚠ `Intl` does the DST arithmetic and that is the point.** Central is UTC-5
  in summer and UTC-6 in winter; a hardcoded offset is wrong for half the year,
  and the changeover is not a date to keep in the code.
- **⚠ `churchDatePlus` is calendar arithmetic, NOT `Date.now() + n * 864e5`.**
  Across a DST boundary a day is 23 or 25 hours, so the millisecond version
  lands an hour out — and an hour is enough to cross midnight and report the
  wrong **day**. The test pins the case that actually differs (11:30pm the
  night before spring forward, +90 days, which is the news form's expiry
  default); at other times of day both approaches agree, and a case where they
  agree would prove nothing.
- **⚠ `hour12: false` renders midnight as "24"** in some engines, which would
  have made the greeting say "evening" at half past midnight. `churchHour`
  folds 24 to 0.
- **⚠ This is for dates somebody READS OR PICKS, never for timestamps.**
  `created_at`, `sent_at` and the audit log are instants, and an instant belongs
  in UTC. `new Date().toISOString()` is still right in those places and was left
  alone.
- **⚠ The suite was passing because it shared the bug.** `test/admin-redesign.test.mjs`
  seeded `publish_date` with the UTC date and asserted the post was visible; the
  moment `/api/news` started telling the truth, that row was correctly a
  tomorrow post and the assertion failed. It seeds in church time now. A test
  that makes the same wrong assumption as the code cannot catch the code.

Run: `node admin/when.test.mjs`, plus `node admin/taps.test.mjs` and the
`/api/news` group in `test/admin-redesign.test.mjs`.

### A rich field costs nothing until it is opened (v4.29.0, 2026-08-07)

Dinger forwarded Tiny's automated notice: *"You are receiving this automated
email notice because you have reached 50% of your TinyMCE Editor Load limits for
the current month"*, with the reminder that going over is an overage charge.

**The bill is not per page view. An editor load is one instance finishing its
init and dispatching `init`** — Tiny's own words — so a screen with nine rich
fields spent nine of them the moment it opened, whether or not anybody typed.
Nothing here was doing anything unreasonable-looking; the arithmetic was simply
invisible.

Two places were doing almost all of the spending, and the second is the one that
explains reaching half a month's allowance in a week:

| | fields | spent per | notes |
|---|---|---|---|
| Newsletter composer | 9 (pastor, secondary, WOL, LASM, tertiary, quick, 3 extras) | 9 per open | most weeks two or three get written in |
| Block editor | 1 per rich field on the page — `/ministries` has **14** | 14 per **re-render** | and `setCanvas()` runs again on every add, delete, duplicate, reorder, undo and reset |

The block editor tore every editor down and built them all again on each
structural change. An afternoon of arranging one page was several hundred loads
on its own.

**So nothing initializes at page load any more, anywhere.** `_onTinymce()`
(`TINYMCE_HEAD`, `admin/db.js`) fetches the library on first demand and queues
callers; an editor is created only when somebody puts the caret in a field. A
screen nobody edits now costs nothing at all — it does not even fetch the
~500KB.

- **⚠ This reverses the newsletter composer's own stated reasoning** — *"all of
  them are rendered so TinyMCE can initialize each one at load … creating an
  editor instance on click would be a second way for a rich field to exist, and
  that is how one of them ends up behaving differently from the rest."* The
  worry was right and the answer is not to init everything: click-to-open is now
  the **only** way a rich field exists, for all of them, through the one
  `tinymceField()` builder. There is still exactly one kind of rich field.
- **⚠ The stored value lives in the TEXTAREA now, not in an init callback that
  called `setContent`.** That is what lets an unopened field round-trip its
  content untouched — and it closes a real hole that was there all along: with
  the value arriving only from the script, a blocked CDN meant opening a post
  and pressing Save wrote an **empty body** back over it. `test/rich-field.test.mjs`
  drives that case (`?dead`, no TinyMCE at all) and was verified against the old
  markup, where four assertions fail.
- **A closed field shows its content, at the height the editor would be.** A
  placeholder would make every screen look emptier than it is, and a box that
  grows on click makes the page jump. The preview is `sanitizeRich`'d — the
  block editor's own allowlist — because it is admin-authored HTML rendered
  inside another admin's authenticated session. **Preview only: what is stored
  and what is submitted are byte-identical.** Tables are among what that
  allowlist drops, so a body containing one previews without it and edits fine.
- **⚠ `.tlc-rich-view *{pointer-events:none}` is load-bearing.** The preview is
  real markup, so without it, opening a field whose content starts with a link
  navigates away from the form instead of editing it.
- **⚠ `jsString()` is gone, and its absence is the point.** AC-3 was that saved
  content interpolated into an inline `<script>` could break out at the first
  `</script`; v3.6.0 fixed it by splitting the tag in one builder. Saved content
  no longer reaches a script **at all** — HTML-escaped into the textarea,
  allowlist-sanitized into the preview — so the class of bug is closed by
  construction rather than by remembering one more escape. Do not reintroduce a
  path that interpolates stored content into a `<script>`.
- **The per-field inline `<script>` is gone with it.** The activation is
  `RICH_FIELD_JS`, once, inside `ADMIN_SHELL_JS` — so it is served from
  `/assets/admin.js`, `immutable`, instead of ~1.5KB repeated nine times in the
  newsletter page body.
- **The submit handler now attaches to the form the field is in.** It used to
  take `document.querySelector('form')`, the page's *first* form, which is the
  right one only by luck. Same behavior otherwise: it waits on in-flight image
  uploads, strips leftover `blob:` images, and carries the submit button's own
  name across the programmatic submit (Publish vs Save as draft turns on it).
- **In the block editor a field opens on `focusin`**, which is also its `select`
  gesture, so there is no new interaction to learn. Plain `contenteditable` and
  the canvas's own `focusout` → `commitField` already did the typing and the
  saving; TinyMCE only ever added the floating toolbar, and that is still all it
  adds — it just arrives when asked for.
- **⚠ The caret is saved across that init and put back.** A brand-new inline
  editor has no bookmark to restore, so `ed.focus()` sends the caret to the
  start of the field — click into the middle of a paragraph, start typing at the
  beginning of it. The range is cloned before init and `setRng` after, inside a
  try: inline mode edits the element in place so it is normally still valid, and
  if it is not the caret simply stays where focus left it. This did not arise
  before because every field was initialized long before anybody clicked one.

**⚠ The meter is gone — see "It is self-hosted now" below — and none of this
became unnecessary.** Metering was what made it urgent, not what made it wrong:
without the lazy opening the page editor still builds and destroys fourteen
editors every time somebody nudges a block on /ministries. Free is not a reason
to do that.

Run: `node test/rich-field.test.mjs` (Chromium; **it stubs TinyMCE and never
loads the real library**), plus the rich-text group in `node admin/ui.test.mjs`.

### It is self-hosted now, and where the 614 went (v4.30.0, 2026-08-07)

Dinger, on the lazy-loading change: *"What is the problem? We are showing 614
loads in 2 days. What changed? Before we were doing only 100 a month"* — and
then *"Self host it. We don't need the paid functions."*

**Where they went.** Not a leak, and nothing on the public site — `timothystl.org`
is an approved domain on the Tiny account, which invites that theory, but nothing
public, no worker and no email ever loaded TinyMCE. It was the **page editor**,
being used. One editor per rich field on the page, rebuilt on every structural
change, and `/ministries` renders **14** rich fields, `/worship` and `/give` 9
each. 614 over two days is about 45 re-renders of a 14-field page — an afternoon
of arranging one page, twice.

Two things made it much worse than it had been:

- **v4.28.0 put the Alignment control on 31 of 32 block types**, up from 11.
  Alignment is a `'rerender'` patch, so the most-clicked new control on the
  screen costs the whole page's worth of editor loads per click. Eighteen
  inspector actions are `'rerender'`; alignment is now on nearly every block.
- **`richBody` went from 4 block types to 10** (2026-08-03), and the card-grid
  extraction gave pages many more rich *items*. The same page grew more fields
  to rebuild.

So "before we were doing only 100 a month" is exactly right: before, the only
TinyMCE in the admin was the classic forms — open a news post, spend one. Nobody
was living in the page editor yet.

**⚠ Tiny's dashboard shows the count and nothing else** — no per-page, per-day or
per-referrer breakdown, so the account cannot tell you this. The arithmetic above
came from reading the code and rendering the seeded pages in editing mode; that
is the way to answer it again.

**The self-hosting itself shipped separately, in #417**, while this branch was
open — `admin/vendor/tinymce/` (TinyMCE 7.9.3, GPLv2+) served by the
`/assets/tinymce/` route in `tlc-admin-worker.js`, which proxies
`raw.githubusercontent.com` rather than carrying 1.4MB in the Worker bundle.
Same-origin to the browser, so no CSP allowance was needed. That mechanism is
the one in the tree; a second, parallel attempt on this branch (vendoring into
`public/` and serving from the site worker) was dropped rather than kept
alongside it. What this branch adds on top:

- **⚠ THE VERSION IS IN THE PATH NOW** — `/assets/tinymce/7.9.3/…`, and the
  route strips and checks that segment. It was `?v=` on the entry script only,
  and that does not reach the rest: TinyMCE fetches its theme, model, icons,
  skin and every plugin from `base_url` **with no query string**, and the route
  serves everything `immutable` for a year. An upgrade would have busted
  `tinymce.min.js` and left every browser running a year-old theme and model
  against a new core — a broken editor that no reload fixes and no deploy
  clears. Versioning the path changes every URL at once.
- **⚠ Nothing initializes at page load** (see the section above). Metering is
  gone but the work is not: without this, the page editor still builds and
  destroys fourteen editors every time somebody nudges a block.
- **⚠ The blank-on-save hole got MORE likely, not less.** The stored value used
  to arrive only via `init_instance_callback` → `setContent`, with the textarea
  left empty — so if TinyMCE failed to load, opening a post and pressing Save
  wrote an empty body over it. Self-hosting puts `raw.githubusercontent.com` in
  that path at request time, which is a weaker dependency than a commercial CDN,
  not a stronger one. The value lives in the textarea now.
- **`notices.txt`** ships beside `license.md`. GPL: the notices travel with the
  code we redistribute.
- **`blockquote` was already dropped in #417** — it sat in the classic plugin
  list for months and is not a TinyMCE plugin at all, just a core format.
  `TINYMCE_PLUGINS` in `admin/db.js` is now the one list, and the test checks
  both init configs against it and it against the folder, so neither drifts
  alone.
- **`promotion: false` is NOT set, deliberately.** The community build is
  supposed to paint an "Upgrade" button into the chrome; checked in a real
  browser with `menubar: false`, it draws none. The browser suite asserts that
  rather than configuring around it, so if a future version starts drawing one
  the test says so.
- **⚠ `license_key: 'gpl'` is required** and is not a key you obtain — it is a
  literal string acknowledging the GPL. Without it TinyMCE 7 renders an invalid
  license notice over the editor.
- **⚠ THE PAID PLAN IS CANCELLED (2026-08-07)**, so there is no longer an
  account to fall back to. `cdn.tiny.cloud` is not a slower or costlier option
  now; it is a broken one. `test/tinymce-selfhost.test.mjs` boots the real
  library and asserts **no request leaves the origin during a full boot** —
  which is the check worth having, because a residual call would show up as a
  license notice over somebody's editor rather than as anything in a log.

Run: `node admin/tinymce-assets.test.mjs` (**in CI** — every file present, no
config naming a plugin we did not vendor, the version in the path and in both
`base_url`s, the license acknowledged, the folder still trimmed) and
`node test/tinymce-selfhost.test.mjs` (Chromium, **loads the real library** —
which now costs nothing — and asserts every `/assets/tinymce/` response is 200
**and** JavaScript or CSS rather than an error page, every configured plugin
drew its toolbar button, content round-trips through a save, and the inline
config boots. Verified by deleting `theme.min.js`, which fails it with the
genuine symptom, `SyntaxError: Unexpected token '<'`).

### A year is asked for a month at a time (v4.27.0, 2026-08-06)

Dinger, on the Giving screen: *"i can only edit the weekly giving tiers and not
the larger commitment amounts, i woudl liek those to be able to enter lets say
$5000/year and then the give button woudl read 416 per month. no one is goign
to click to do a one time gift of 5000"* — and, separately, *"i woudl like to
put a heading to these list of giving tiers"*.

**The commitment and the transaction are two different numbers, and only one of
them belongs on a button.** A leadership row says $5,000 a year — something
somebody decides once and keeps — and its button was handing Tithe.ly a single
$5,000 charge, which is not a thing anybody presses.

- **The period a row is written in decides what its button asks for.**
  `giftForPeriod()` in `give-link.js`, beside the link arithmetic and shared by
  `admin/blocks.js` and `give-landing.js`, so the published page and the
  hardcoded fallback cannot come to different answers about what somebody is
  being asked to pay. `/year` asks for a twelfth; `week`, `month` and everything
  else ask for exactly what the row says, because those are already figures
  somebody puts through a card in one go.
- **⚠ The label and the LINK both change.** A button reading $416 that charges
  $5,000 would be the worst thing this page could do, so `test/give-page.test.mjs`
  asserts `amount=41600` and the absence of `amount=500000`, not just the words.
- **The monthly figure rounds DOWN to a whole dollar** ($416 × 12 = $4,992). A
  button must never ask for more than the number printed on the row beside it,
  and it is the figure Dinger wrote himself. Under $12 a year there is no
  whole-dollar month, so the row asks for itself rather than for $0.
- **⚠ Tithe.ly cannot be told from a link that a gift repeats** — that is why
  the frequency toggle came off this page in July. So the ladder says, in as
  many words, to choose Monthly on the form. Rendered **only when a monthly
  button exists**, so a purely weekly ladder carries no instruction about a
  screen it never reaches.
- **A ladder can carry a heading over the rows themselves**, stored in the
  block's existing `subtitle` (already sanitized for every type, so no schema
  change) and edited inline in the canvas. The block heading above it is an
  argument — "Every gift accomplishes great things in His Kingdom" — with
  several paragraphs under it; by the time the eye reached the cards nothing
  said what the list of them was. Empty on every existing page, so nothing
  gains a heading it did not ask for, and shown as a placeholder in the editor,
  because a field nobody can see is a field nobody uses.

**The Giving screen now shows the ladders — and does not offer to edit them.**
Each row carries its own sentence about what that gift pays for, so it belongs
on the page with the words it explains; a second form here would be two places
that disagree about what $5,000 a year buys. What was really wrong is that this
screen said *nothing* about them, so "the amounts live on the Giving screen"
read as a complete statement and the larger commitments looked unchangeable.
The panel lists every ladder row, states **what each button will actually ask
for**, and links to the editor.

- **⚠ It also says when the live page is not the draft.** `give-landing` is
  seeded unpublished on purpose, so editing in the editor changes nothing a
  visitor sees until Publish. Without that line the whole feature reads as
  "my edit did not work". The warning disappears once the page is published.

Run: `node test/give-page.test.mjs`, plus two groups in
`test/admin-redesign.test.mjs`.

### give.timothystl.org is a block-editor page (v4.24.0, 2026-08-05)

Andrew: *"we have been trying to convert give.timothystl.org to blocks. That
page computes every Tithe.ly link at request time — extracting that into text
blocks would produce a page that looks identical and takes no money. The things
i want to be able to edit are the layout, the descriptions of what each thing
does, and the amounts / period, and the heading for each section"* — plus the
header, the footer, and *"at least a button that links back to the homepage"*.

**His diagnosis was exactly right, and it is the whole design constraint.** The
answer is that the two new block types **have no URL field at all**. They store
the amount and the words; every href is computed at render time from
`ctx.data.give`, which `pageData()` fills from the Giving screen. There is
nowhere to put a payment address even by accident — which is what makes
publishing this page safe, because **a block's URL is frozen the moment it is
published**, so a stored Tithe.ly link would go on charging to the old form
after the office changed the base link and **the page would still look
perfect**.

| Type | What it is | What is editable |
|---|---|---|
| `giving` — Giving widget | The transaction: chips, fund dropdown, custom amount, the button | Heading, tagline, trust line, alignment, spacing, where it sits on the page |
| `amounts` — Amount ladder | A heading over "$X /period — what it does" rows, each with its own Give button | Eyebrow, heading, intro; every row's amount, period and description; theme colors; alignment |

- **One type for both ladders.** The ministry ladder and the leadership tiers
  are the same shape and differ only in color, which is already a block-level
  choice. Two near-identical types would drift apart the first time somebody
  improved one of them.
- **⚠ `give-link.js` is the ONE definition of how an amount becomes a link.**
  It existed three times inside `give-landing.js` alone — server-side, and
  again as a client-side mirror — and a fourth copy was one block type away.
  `admin/blocks.js` and `give-landing.js` both import it now. Three copies of
  an arithmetic rule about somebody's money is three chances for one to be
  wrong in a way nobody notices, because a wrong link still looks like a
  working link. The rule: the base link holds formId + locationId + fundId and
  no amount; `&amount=<cents>` — **cents** — is appended per gift; a fund
  override **replaces** the base `fundId` rather than appending a second one.
- **⚠ The fallback falls back in three steps, and the last one still takes a
  gift.** Published blocks → the hardcoded body with the admin's *real* amounts
  → the hardcoded body with the constants compiled into `give-landing.js`. Step
  two is the one worth understanding: an unpublished page is a normal state,
  not a failed fetch, and dropping straight to hardcoded amounts there would
  quietly undo the office's own Amount Tiers. `give-landing.js` is therefore
  **not dead code once the page is published** — it is what runs during an
  admin outage, on the page that takes the money.
- **A row with no numeric amount gets no button**, rather than one pointing at
  `$NaN`. "Any amount" is a legitimate row to write. A dead link is worse than
  a missing one because it looks like it works.
- **⚠ `sanitizeBlock` now gates `url` on the definition**, the way `card`
  already was. It used to store a posted URL for *every* block type whether or
  not that type had a URL field. Nothing rendered it, so nothing was broken —
  but "the renderer happens not to read it" is a much weaker guarantee than "it
  was never stored", and it is one new render branch away from failing. All
  five types that read `b.url` declare `url:true`, so nothing lost a link.
- **The page row is excluded from `/api/pages`.** It is a `pages` row so it
  gets the editor, publishing, revisions and permissions for free, but it is
  not a page of this site: left in, the SPA would serve the donation page at
  `/give-landing` too and there would be three giving surfaces where the
  settled rule says two.
- **The chrome reads the site's own records.** The masthead takes its logo,
  name, tagline, bar color and rule from `site_appearance` (Menu →
  Appearance); the footer reads the church details. Both were hardcoded here.
  ⚠ This page used to have **no way back into the site, by design** — "someone
  lands here from a bulletin/QR/text link, sees one thing, and gives". Andrew
  reversed that; the masthead is a link home and there is a named
  `Back to timothystl.org` beside it. Recorded because the original reasoning
  was sound and was traded away deliberately, not forgotten.
- **⚠ A real bug found on the way past.** The `give.timothystl.org` branch in
  `site-worker.js` answered **every** path on that hostname with the giving
  page — so `/logo.png` and `/images/favicon-32x32.png`, both referenced by
  this very page, were served an HTML document instead of an image. Silently:
  no error, no log, just a church logo that has never appeared on the giving
  page. Asset paths fall through to the static assets now.
- **⚠ A phone shows the button before the case for pressing it.** #400 fixed
  this in the hardcoded page — stacking the two columns in source order buries
  the Give button under the whole ministry ladder. The block version stacks the
  same way, so `phoneRules()` pulls the widget above the ladder
  (`.tlcb-pair > .tlcb--giving{order:-1}`). Scoped to the giving widget, which
  only ever appears on that one page, rather than reversing pairs generally.
  Without it, publishing would have quietly undone #400.
- **The Giving screen stopped lying.** Its panel claimed the two giving pages
  were one set of blocks shown in two places, and carried a switch offering to
  keep them in step. Neither was true — they have separate jobs, and the switch
  wrote `give_keep_in_step`, which nothing ever read. Both are gone. ⚠ The test
  that had pinned those strings down was asserting a *lie was displayed*, which
  makes correcting it look like a regression; it now asserts the opposite.
- **Nothing is live yet, on purpose.** The seed lands in the draft and
  `published_blocks` stays empty, so give.timothystl.org renders exactly what
  it rendered yesterday. Open `/pages/give-landing/edit`, read the draft
  against the live page, press Publish — then watch one real gift go through
  before touching anything else.

Run: `node test/give-page.test.mjs` (in CI). It asks the only question worth
asking about this page — does it still **take money** — rather than whether it
renders: $25 becomes `amount=2500`, a fund override leaves exactly one
`fundId`, neither block will store a Tithe.ly address even when one is posted
at it, and the page still transacts unpublished, with the admin unreachable,
and with the admin returning nonsense.

### /give is on the block editor, and the rest is scoped (2026-08-05)

**Every page has had a block draft since the site editor shipped and not one
had ever been published**, so the whole editor sat behind a Publish nobody had
pressed. `/give` is the first published, by a one-time marker-gated migration
— guarded by `canReseed()` so it never lands on a page somebody has touched.

The draft was read against the live page first: the six offline giving paths
come across as a card grid, and both buttons keep their real destinations
(`give.timothystl.org`, `serve.timothystl.org`). Neither carries a Tithe.ly
address, which is the one thing a published block must never hold.

**⚠ Found while checking that draft, and fixed before publishing: an in-site
link in `public/index.html` is `href="#" onclick="showPage('contact')"`.** The
extractor read the href alone, so `/give`'s "Speak with a pastor" came out as a
link to `#` — which sanitizes perfectly cleanly, because `#` is a valid URL, and
would have reached the live giving page as a link that goes nowhere. **A dead
link is worse than a missing one: it looks like it works.** `hrefOf()` in
`tools/extract-pages.mjs` now reads the onclick first and resolves it to the
page's own address, and `admin/blocks.test.mjs` asserts no seed anywhere
carries a `#` url — the same shape of rule as the no-Tithe.ly-link assertion
beside it, and for the same reason: it has to hold for every page, not just the
one where it was noticed. ⚠ There are **two** card-building passes in
`cardRun()` and both read a href; fixing one and not the other is exactly how
this survived the first attempt at the fix.

**`admin/BLOCK-EDITOR-ROLLOUT.md` is the full scope** — all 28 SPA pages, the
three that deliberately are not block pages (`404`, `values`, `voters`), the
other surfaces, and what converting `give.timothystl.org` would actually take.
Read it before starting any of that work.

### A password is changed on its own screen (v4.26.0, 2026-08-06)

Dinger: *"when i am trying to edit users it is autofilling in from password
manager software the username and passwords and so changing it. fix that so i
dont have to reset user name and password everytime that i want to edit user
access."*

**The cause is a browser rule, not a bug in this code: a password manager fills
a form's username box whenever it fills a password box beside it.** The access
screen at `/users/edit/:id` carried both, so opening it to tick one permission
and pressing Save wrote back whatever the manager had put there — a different
username, and a password hash for a password nobody chose.

- **The fix is that the form no longer HAS a password field.** Every
  `autocomplete="new-password"` / `="off"` hint was already on those inputs and
  every one of them was ignored — they are advisory, and managers routinely
  override them. Removing the field removes the thing being filled, and it
  removes the trigger for the username fill in the same move. **Do not put a
  password field back on that screen**; that is the whole defect.
- **`/users/edit/:id/password` is where a password changes**, and nowhere else.
  ⚠ It has to be matched **before** the two `/users/edit/` handlers, which read
  the id off the last path segment and would otherwise take the word *password*
  for an account id and 404. Both are exact regex matches now rather than
  `startsWith`.
- **The POST stopped reading a password at all**, so the rule holds against a
  stale tab or a crafted POST and not just against the markup. A test posts a
  password at the access form and asserts the stored hash is byte-identical
  afterwards.
- **The username is `readonly` until somebody presses Change.** Belt and
  braces — with no password field a manager has little reason to fill it — but
  it is also the honest shape: editing what somebody can *reach* should never
  quietly rewrite *who they are*. `LOCKED_FIELD_JS` (`admin/ui.js`) is the
  delegated handler, and the button removes itself once used, because a control
  that has done its one job reads as one still waiting to be pressed.
- The email field's `autocomplete="email"` was dropped for the same reason: it
  is somebody *else's* address, so the browser's own address book is the wrong
  source for it.
- Setting a password still signs that person out everywhere, exactly as the old
  combined form did. Saving *access* no longer does, because it no longer
  changes a password — sessions are still dropped on a permission change or a
  deactivation.

Covered by a group in `test/admin-redesign.test.mjs`.

### The backlog pass (v4.24.0, 2026-08-05)

Andrew went through the pending list and picked. What follows is what each one
turned out to be, because in three cases the item on the list was not the
problem.

**The font variables were never defined.** `--tlcb-serif` and `--tlcb-sans`
were used in seven `BLOCK_CSS` rules and declared **nowhere**, so the card-grid
heading, eyebrow, link and intro and the map card's three text rules rendered
in the browser's default font on every public page carrying one of those
blocks. A `var()` that cannot resolve fails silently — nothing errors, nothing
looks obviously broken — which is why it survived being noted in passing.
Defined once on `.tlcb-page` (the wrapper every render path emits), and the ten
rules that wrote the Lora stack out literally now use the variable.
`admin/blocks.test.mjs` asserts the **general** rule: every `var(--tlcb-*)` is
defined or carries a fallback.

**[B1] the gym slot is locked by the database.** Andrew: *"once it is booked it
should be locked out"*. A partial unique index over the active statuses, so the
race cannot happen rather than being narrowly avoided.
- **Partial on purpose** — a released or expired booking must not reserve the
  slot forever, or releasing a hold would stop meaning anything.
- **⚠ It catches an exact duplicate slot, not an overlap.** 1–3pm against
  2–4pm is a range comparison and a unique index compares values. The SELECT
  check still does that and still has its old race for partial overlaps. This
  narrows the hole to the case that actually happens (two people clicking the
  same button); it does not close it.
- **⚠ If the index cannot be created, the live table already holds two active
  bookings for one slot.** That is logged loudly rather than swallowed — which
  of the two is real is a question for whoever took them.

**[B4] was already fixed, and the measurement says so.** The item claimed ~130
D1 queries per admin request. Measured against the real Worker: a cold isolate
pays **411** statements once, a warm request pays **0** — the `MARKERS_SEEN`
work did it. There is nothing left to gate behind KV. Item closed by
measurement, not by building anything.

**[B6] EXIF is stripped server-side.** There *was* a client-side re-encode that
strips metadata as a side effect of drawing to a canvas — wired to the staff
photo picker **only**. The news header image, both rich-text editors and the
logo picker all posted the file exactly as it came off the phone, and that
re-encoder falls back to the untouched original whenever the canvas cannot
produce a WebP. `admin/exif.js` cuts the metadata out at `/api/upload-image`,
which every path goes through.
- **Byte-level, not a decode.** Workers has no image library and needs none:
  in JPEG, PNG and WebP the metadata sits in its own self-delimiting chunk.
  JPEG keeps APP0 and APP14 (JFIF density, Adobe color transform) and stops at
  SOS, because past that a `0xFF` is image data. WebP rewrites the RIFF size
  and honors the pad byte that is not counted in a chunk's own size.
- **⚠ Every path fails OPEN.** Anything unrecognized, truncated or malformed
  comes back untouched. Losing a photo to a parser that misread it is worse
  than the metadata, and nobody would find out until it was already on a page.
- The fixtures are **real files with real GPS**, so the test greps the raw
  bytes rather than trusting our own parser, and checks the image still decodes
  at the same size with the scan data byte-for-byte unchanged.

**[B5] a session now also has to have been used recently.** Seven days was
right for somebody who uses this weekly, but on its own it meant a session left
open on a shared machine stayed usable for a week of doing nothing — on an
admin that mails the congregation, reads prayer requests and approves payroll.
Both limits apply now: seven days since sign-in, 24 hours since the last
request. **⚠ A missing `last_activity` is treated as active** — the column
arrives by migration, so failing closed would have signed out the whole office
on deploy.

**[B7] the social preview image is a setting.** ⚠ `og:image` is read by
crawlers out of the HTML **as served** — Facebook and Bluesky do not run the
page's JavaScript — so this is the one thing on the site that cannot be swapped
client-side the way the header and footer now are. `site-worker.js` rewrites it
with `HTMLRewriter`, streaming, defaulting to the logo so nothing changes until
somebody sets `social_image_url`. A real 1200×630 photograph is still wanted;
this is the field to put it in.

**[B8] the tap-through is a test, not an afternoon.** The item asked for "a tap
through on a real phone". A person doing that tells you about the day they did
it; `test/public-phone.test.mjs` measures at 390px on every change. It found
**footer links 14px tall**, a 36×42 hamburger, drawer links at 43px, six
buttons between 31 and 40px, and the newsletter fields at 40px. None of it
looked wrong on a desktop.
- Padding and minimum heights only — **no type sizes changed**, so nothing
  reflows.
- **⚠ The footer is the one place 44px is the wrong answer**: eighteen links at
  44px is a footer taller than the phone. 36px is a real target without turning
  the footer into its own page, and the test asserts 30px there rather than 44.

**The Media screen's usage scan is inverted.** It was O(media × pages) — every
file substring-searching every page's block JSON. Each page is read once into a
filename map; a file is then one lookup. It is also **more accurate**: the
substring test called `logo.png` used whenever a page mentioned
`church-logo.png`, and a false "in use" is the worse direction because it hides
a file that could be cleaned up forever.

**The gym iCal feed is bounded** to a year back, where it returned every
confirmed booking ever taken — to a calendar app that re-fetches it constantly.
And the **seven indexes AC-7 named** in the July review now exist.

**Four images were serving a 72px card from a full-size photo** — 488KB between
them, to be drawn 72 pixels tall. Thumbnails at 240px (2× the block grid's
120px cap), originals untouched for the full-width uses. 488KB → 84KB.
**⚠ The first pass produced a 128-byte `ss-logo`**: `mdo` and `ss-logo` are
RGBA and converting to RGB flattened their transparency into a solid block. The
source mode is preserved now.

**`/sermons` shows this week's service.** Andrew: *"youtube.com/timothystl is
the general worship service displayed each week. I don't know how we can make
it pull the most current one every time."* YouTube's per-channel Atom feed,
which needs **no API key** — and so no secret to set, rotate, or notice had
expired, on a feature whose point is that nobody touches it weekly.
- ⚠ The feed is keyed on the channel **ID**, not the handle, and nothing public
  converts one to the other. The Worker scrapes the channel page once and
  **writes the ID back into the setting**, so the scrape runs about once in the
  life of the site rather than on every cache miss.
- **⚠ `parseFeed` deliberately does not re-sort on `published`.** That is the
  upload time, and a stream scheduled days ahead carries the date it was
  scheduled — sorting on it reliably picks the wrong service. The test proves
  it with a concert that has the latest date of the three.
- `sermon_title_filter` exists because "newest video" is one concert away from
  being wrong. Blank by default.
- Everything fails to "no embed": the section stays hidden and the page is
  exactly what it was, Watch-on-YouTube button and all.

**⚠ `/api/latest-sermon` was written below the session gate at first**, so
every request 302'd to the login page. It is a public endpoint and belongs with
`/api/news`. The integration test caught it; a unit test never would have.

**The "Kept in step" switch is deleted.** It was labeled *"edit either one and
the other follows"* and nothing implemented that; it wrote `give_keep_in_step`,
which nothing read. The panel beside it said the two giving pages were "One set
of blocks · two places it appears", and they are not. **A control that claims a
behavior the code does not have is worse than no control** — somebody flips
it, believes it worked, and stops checking.

Run: `node admin/exif.test.mjs`, `node admin/sermons-feed.test.mjs`,
`node test/public-phone.test.mjs`.

### Form Spam Screening (added 2026-07-31)

The public contact / prayer / newsletter forms had one defense — a hidden
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
layout control is a constrained choice (an 8px spacing step, a palette color, an
S/M/L size) and never a free-form pixel or hex value.

**`admin/blocks.js` is the single renderer.** It owns the block schema, the
guardrails, the sanitizer, and the HTML template for all 19 block types. The public
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
  client: spacing snaps to 8px steps capped at 96, colors must come from the two
  palettes and an unreadable ink/background pair is corrected on write, unknown
  block types are dropped, rich text goes through an allowlist sanitizer. A stale
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

**Tests** — `node admin/blocks.test.mjs` (renderer, guardrails, sanitizing,
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

### Align + bold/italic, seven block types (added 2026-08-03)

Andrew asked whether the **Give** block ("Support this ministry" — the
$25/$100/Give now card) could be centered, bolded, italicized. It couldn't —
alignment only existed on Card grid, and bold/italic only on Text,
Photo+photo, Callout, and item bodies inside Columns/Card grid/FAQ. Give had
neither.

- **`align: true` on a `BLOCK_DEFS` entry is the one flag that opts a type
  in**, same idiom as `richBody`/`photo`/`url` — `CENTER_ALIGNABLE_TYPES` in
  `admin/blocks.js` is *derived* from that flag, not a second list to keep in
  step. Seven types have it now: Give, Text, Text+photo, Callout, Notice bar,
  Signup form, Newsletter — all a flex column of heading + prose + (for four
  of them) a row of buttons, close enough in shape that one shared mechanism
  covers all seven. Card grid keeps its own separate, older centering
  mechanism (`tlcb-cg--center`), untouched.
- **One class does the centering, not seven copies of cardgrid's pattern.**
  `renderBlock()` appends `tlcb--center` to the block's own universal wrapper
  when `align:true` in the def and `b.align === 'center'` — CSS keyed off
  `.tlcb--center.tlcb--<type>` picks it up from there, relying on
  `text-align`'s natural inheritance for the plain-prose part of each type
  and adding only what doesn't inherit: `.tlcb-inline`'s `justify-content`
  for the four with a button row, `align-items` for Callout's flex column
  (which sets `align-items:flex-start` on its own, so text-align alone would
  center the words but leave the boxes hugging the left edge). Notice bar is
  the one real outlier — a horizontal row, not a heading+prose stack — so
  "centered" there means centering the row itself
  (`.tlcb-alert{justify-content:center}`), not text-align.
- **Bold/italic is the `richBody` flag, added to the same four types that
  didn't have it** (Give, Notice bar, Signup form, Newsletter — Text,
  Photo+photo, Callout already did). Nothing else needed wiring by hand: the
  inline TinyMCE toolbar, the `sanitizeRich()` allowlist, and the client
  config all read `def.richBody` already. Three render branches (Give,
  Notice bar) that hand-rolled `esc(b.body)` instead of the shared
  `renderBody()`/`field(...,rich)` helper had to be switched over — otherwise
  the sanitized HTML would have rendered double-escaped as literal tags.
  Titles stay plain everywhere, including these seven — no block type
  anywhere has a rich-text heading, so giving Give a rich title would be
  inventing a new pattern rather than extending the one that exists.
- **Font-family and per-character font color were explicitly left out.** A
  background/text-color pair already exists for every block ("Theme
  colors"), so that part of the ask was already covered. A font-family
  toggle has a real precedent to build from if it's ever wanted — the SIZES
  (S/M/L) control's full path from definition through to a CSS variable
  (`blocks.js:39-43` → `wrapperVars()`/`styleVars()` → the inspector chips)
  — but it's a genuinely new mechanism, not an extension of one already
  there, so it's its own future piece of work.
- **Pre-existing, unrelated bug found while researching this, not touched:**
  seven CSS rules already reference `var(--tlcb-serif)`/`var(--tlcb-sans)`
  (Card grid's heading/eyebrow/link/intro, the Map card's three text rules)
  but those two custom properties are never defined anywhere, so those
  specific declarations currently fall back to the browser default font
  rather than Lora/Source Sans 3. Flagged here so a future font-family pass
  doesn't have to rediscover it.

Covered by a new `admin/blocks.test.mjs` group: all seven types get the
class when centered and none of the other twenty-one do; each type's body
keeps real markup instead of getting escaped; the inspector's client config
(`blocksClientConfig()`) reports `align:true` for the seven and `false` for
Card grid, whose Alignment chip is a separate, untouched branch.

### The public news feed sorts newest-first (added 2026-08-03)

`/api/news` already sorted by `COALESCE(event_date, publish_date)` — the
actual bug was the direction. It was ascending (soonest-upcoming-first,
calendar-style), so a freshly published post with a future `event_date` sat
at the *bottom* of its own feed instead of leading it. The admin's own News
& Events list sorts the identical expression descending; `/api/news` now
matches it (`tlc-admin-worker.js`, `ORDER BY pinned DESC, COALESCE(event_date,
publish_date) DESC, id DESC`).

Found in the same pass, fixed alongside it since it's the same page: the
`/news` page's date label read `item.event_date || ''` with no fallback, so
a pure announcement with no `event_date` showed no date at all — the home
page's own news card already had the right fallback
(`item.event_date || item.publish_date`); `/news` now matches.

**Not touched, flagged only:** the newsletter composer's two "which news
items to embed" pickers (`tlc-admin-worker.js`, the create- and
edit-newsletter routes) sort the same expression ascending too — same bug
shape, a different screen nobody asked about.

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
  amber needs attention, red broken, gray deliberately off, blue-gray automatic.
  An unrecognized tone clamps to gray rather than rendering unstyled.
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
  Building, People & Access, Setup, with Dashboard above them unlabeled —
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

Three more sections onto the shared pattern. Little new behavior — the value
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
- Holds are amber, confirmed bookings green, blocked dates grayed with their
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

~~**One question is still open**~~ — **SETTLED v4.8.0.** The handoff
contradicted itself: the mockups render a row's warning row **above** the row
it refers to (visible in `pages.png` and `media.png`), while README §3 said it
"grows a warning row beneath it". The screenshot won. `renderListSection` emits
the warning band **before** `<div class="tlc-row">` (`admin/ui.js:233`), the
seam moved from `border-top` to `border-bottom`, and a test pins the band as
the FIRST child of the row wrapper. Nothing here is outstanding; the paragraph
is kept because it is where somebody would look for the answer.

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
  "By organization" heading, untouched. Deleting a working invoice flow because
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
  labeled Import would imply a staleness that does not exist. The row says
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

- **A value chip keeps its own colors in both states** — selected only adds
  the 2px `solid` border. Recoloring it would read as a *different value*
  rather than the same one, chosen. That is why `solid` exists as a third
  color per value.
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
- **Read-only is a sand fill, never grayed text.** Gray text reads as broken.
- **Toasts** (`TOAST_CSS` / `TOAST_JS`) — bottom center, navy on cream, 2.2s.
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
the rules the build must honor, and a "get this wrong and it shows" list.
`admin/sections.js` already had the titles, filters and columns. This pass is
the rest.

What changed:

- **The four values are chips, not a select** (`valueChips()` in `admin/ui.js`),
  on Ministries, Partners, News and Christian Ed. Four options is four chips —
  a select hides three of them behind a click. Each keeps its own color when
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
    dropped rather than half-honored. `outboundUrl()` is the one gate, used by
    the pill, the row, the API and the menu alike.
  - **`/api/pages` resolves one hop.** The outbound map is applied to every
    other entry after merging, so a short link or a retired address pointing at
    `/mdo` reaches the outside site directly instead of bouncing twice. Its
    published blocks, if it still has any, are **not** rendered — that would be
    a flash of a page about to redirect out from under the reader.
- **The pill vocabulary is the design's**: `Live` (was "Published") ·
  `Draft edits` · `Not in menu` · `Links out` · `Link clash`. Each `PILLS` entry
  now carries its own **tone**; the list used to pick a tone by comparing the
  label string, so renaming a pill silently recolored it.
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
- **⚠ The "By organization" bulk tools are on BOTH layouts now.** They used to
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

**⚠ Superseded v4.29.0** — `jsString()` no longer exists, and neither does the
inline `<script>` it was protecting. Saved content is HTML-escaped into the
field's textarea and allowlist-sanitized into its closed-state preview, so there
is nothing left for it to break out of. See "A rich field costs nothing until it
is opened" above; the test group in `admin/ui.test.mjs` now pins that stronger
property instead.

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
  **sand fill** — the spec's "never gray out text to signal read-only", because
  gray text reads as broken and a filled field reads as a fact.

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

#### The post-redesign review (v4.14.0–v4.15.0, 2026-08-02)

Andrew: *"Now after this massive redesign effort do a thorough code review.
Look for any problems with UI and speed issues of loading."* Three scouts read
the whole surface; everything below was **verified by reading or measuring**,
not pattern-matched. Fixed in two PRs (#378, #379).

**The recurring defect was cascade order** — a rule correct on its own,
defeated by a later declaration at equal specificity. Four separate bugs had
that one shape:

- **The login/forgot/reset/setup pages collapsed to a 380px navy strip** —
  the flex-shell `body{display:flex}` made `.login-wrap` the only flex item
  with no width. `flex:1` now, and `test/shell-layout.test.mjs` *measures*
  the login page (verified failing against the bug).
- **The `.sidebar*` selectors were declared twice**, 150 lines apart, with
  different values — merged into the shell block, desktop defaults still
  ahead of the 900px media query, computed values pinned in a browser.
- **The renter basket's 390px pass shipped defeated**: its 44px/28px rules
  sat in the head stylesheet, and the body stylesheet's desktop sizes came
  later and won at every width. The phone rules live at the END of the body
  stylesheet now, and `gym-portal` re-runs its tap scan with the basket ON
  SCREEN — the original scan ran before the basket existed, which is how it
  shipped green.
- **The request bar carried `display:none` AND `display:flex` in one style
  attribute** (flex won; an empty "0 slots" bar flashed on load) and its
  `.req-bar` class rules — the 30vh cap included — targeted markup that
  never had the class.

**Half blocks, correct in every mode** (the `column-count` layout is new
enough that nothing had caught up with it):

- `phoneRules()` spoke `grid-template-columns` at a pair that is CSS
  *columns* — a silent no-op, halves rendered ~165px wide on a phone.
  `column-count:1` now, one shared text, so the editor's Phone tab fixed too.
- Pair members are grandchildren, so `.tlcb-page--full > .tlcb` centering
  never reached them; the wrapper carries the padding now.
- The info card stacks inside a half column; the editor's drop indicator no
  longer throws `NotFoundError` mid-drag over a pair (walk to the page's own
  child first); spacing steppers on a half block re-render, because the pair
  wrapper the SERVER writes is what the page renders and a style-mode patch
  never reached it.
- The v4.12.0 arrow sweep took `Stamp → Upcoming` — a separator its own rule
  allows — and `editor-edit` knew, but browser suites are not in CI. Restored.

**Loading** (the wins are structural, not micro):

- **Five serial `_schema_version` SELECTs ran before routing on every
  request** — ×7 API calls ≈ 35 wasted D1 round-trips per homepage load. One
  read now, and none once the binding is seen current: `MARKERS_SEEN` is a
  WeakMap **keyed on `env.DB`** (a module flag would carry "migrated" onto
  the test harness's fresh databases), set ONLY when no gate ran work, so a
  swallowed marker write is re-verified. A deploy starts fresh isolates, so
  a SCHEMA_VERSION bump is never masked. The first-run `/setup` COUNT is
  memoized the same way. The redesign test counts statements off the shim's
  log: exactly 1 on a warm request, 0 after.
- **`/api/pages` sits behind `caches.default`** — it was five queries plus a
  render of every published page, per request, `max-age=120` notwithstanding.
  One chokepoint busts it: any POST under `/pages` or `/menu`.
- **`/api/ministry/:slug` renders `withCss:false`** — the 23KB stylesheet
  every response carried and the client's first move was to regex away.
  `tlcEnsureBlockCss()` awaits the one copy `/api/pages` ships before any
  block markup is injected; the strip lines stay for the five-minute cached-
  response transition after a deploy.
- **`site-worker.js`**: asset paths skip the redirect lookup (it was a
  cross-worker subrequest in front of every image on a cold isolate);
  redirect cache 60s → 300s; and static assets carry Cache-Control at last —
  day + week-SWR for images/fonts, an hour for css/js, `no-cache` for HTML
  so a publish is visible on the next load. There was **no** Cache-Control
  on anything before.
- **Badges vanished on every edit screen** — `badgeCounts` was passed on the
  25 list screens only. One memoized promise per request now
  (`pageBadges()`), passed at every `sidebarShell` call site including the
  17 gym screens and `/filtered` (which take it as a parameter). Dashboard
  Overview tiles are counted only when Overview actually renders.
- **The homepage fetched `/api/sermon-series` twice** (home card + sermons
  page, no shared memo) and `loadChristmasMarketPosts()` ran at boot for a
  page nobody opened. `fetchSermonSeries()` is one shared promise;
  `loadSermons`/`loadChristmasMarketPosts` run on navigation (the router
  routes a direct URL through `showPage`, so deep links still load).
  `/api/form-config` is `private, max-age=60` — **private on purpose**: the
  edge must never share one visitor's signed token with the next, nor hand a
  bot a pre-aged timestamp that defeats the too-quick-to-be-human signal.
- `.tlc-chip` was **two components** declared 260 lines apart — the value
  pill (now `.tlc-vpill`) had a phantom pointer cursor, the choice chip a
  999px radius. ▲/◆ marks are `aria-hidden`; the dead
  `.tlc-row-wrap[data-href=""]` selector (wrong element, wrong state — the
  attribute is absent, not empty) is `.tlc-row:not([data-href])`.
- **The shell's ~89KB of CSS/JS is externalised now (2026-08-03)** — item 2
  from the report-only list below, once Andrew signed off on it. It used to
  be inlined into every admin `<style>`/`<script>` on a `private, max-age=10`
  response, so the same ~89KB was re-sent and re-parsed on every click.
  `ADMIN_SHELL_CSS`/`ADMIN_SHELL_JS` in `admin/helpers.js` hold it now;
  `/assets/admin.css` and `/assets/admin.js` (routed in
  `tlc-admin-worker.js`, ahead of the schema gate — a static string needs no
  D1 read at all) serve it `public, max-age=31536000, immutable`, cache-busted
  by the `?v=VERSION` query string `html()` already appends every deploy. The
  CSP's existing `'self'` already covered same-origin requests, so nothing
  there needed to change. ⚠ Several tests asserted this content by searching
  the *page* body for CSS/JS substrings — `test/admin-redesign.test.mjs` and
  `test/shell-layout.test.mjs` now fetch the two asset routes and check
  there instead; a stub server that serves only `html()`'s literal output
  (the shape `shell-layout` used) has to answer `/assets/admin.css` and
  `/assets/admin.js` itself or every rectangle it measures is unstyled.

**Reported, not fixed — Andrew's call, in rough order of payoff:**

1. **A build/minify step for `public/index.html`.** Declined 2026-08-03, not
   just deferred: `public/index.html` is 221KB (36KB brotli), ~95KB of it
   inline JS re-downloaded with every HTML fetch, and minifying it would cut
   that roughly in half — but only via an automated step in the deploy
   pipeline, since the file changes constantly and a one-off hand-pass would
   drift the moment anybody next edited it. That reverses the deliberate
   no-toolchain stance the site has kept since launch, and the real risk is
   not cosmetic: this repo has already been bitten twice by naive text
   transforms silently breaking a template literal at a stray backtick (see
   "node --check does not catch a broken module" and the AC-3 fix above) —
   the exact failure mode a text-based minifier invites, on the one file with
   no test suite driving a real browser against every code path. Externalising
   the *admin's* CSS/JS (item 2, done the same day) captured the safer half of
   this win — a plain file move, no minifier, no build step — without that
   risk. If minification is wanted later, it needs its own decision alongside
   picking a minifier and wiring it into `.github/workflows/deploy.yml`, not a
   default to reach for.
2. ~~**Externalising the admin's CSS/JS** — ~89KB unminified is inlined into
   every admin screen at `private, max-age=10`, so it is re-parsed on nearly
   every click. A cacheable `/assets/admin.css` fixes it and costs a
   versioning scheme.~~ **Done 2026-08-03** — see "The shell's ~89KB of
   CSS/JS is externalised now" above.
3. ~~**The heavy admin handlers**, each needing its own design: `/media` scans
   every page's block JSON per media row; `/subscribers` pages Brevo serially
   in the render path; `/newsitems` runs its expiry sweep inline (R2 delete +
   DELETE per expired row); `/api/search` fires up to 10 LIKE scans per
   keystroke with no debounce; `/audit-log` renders one anchor per 50-row
   page with no retention.~~ **All five are done** — four on 2026-08-03 per
   Andrew's "go with making it faster", and `/media` earlier still (see the
   corrected sub-item below, which was already stale when it was written):
   - **`/newsitems`** no longer `await`s the sweep before rendering —
     `ctx.waitUntil(sweepExpiredItems(...))` now, so an R2 delete plus a D1
     DELETE per expired row (almost always zero rows) no longer blocks every
     single visit to the screen. The row's `state` already reads 'expired'
     off `expire_date` regardless of whether the sweep has run yet, so
     deferring it costs nothing but the row surviving one extra page load
     before it is actually removed.
   - **`/subscribers`** fetches its first Brevo page alone (the only one that
     can be serial — it's where `count` comes from), then every remaining
     page together via `Promise.all` instead of one round trip at a time. A
     failed page no longer costs the pages that succeeded. Covered by a new
     test group in `test/admin-redesign.test.mjs` asserting concurrent
     fetching and partial-failure tolerance.
   - **`/api/search`** ran its up-to-ten permission-gated LIKE queries one
     `await` at a time in a `for` loop; they don't depend on each other, so
     they now run together via `Promise.all`, with `active`'s array order
     (not resolution order) still deciding section order in the results.
     ⚠ **The "no debounce" half of this item is closed too** — the palette
     waits 160ms after the last keystroke before asking (`admin/ui.js:1421`),
     so a typed word is one request rather than one per letter. All that is
     left in that path is that a slow earlier response can still overwrite a
     newer one — FX-34.
   - **`/audit-log`**'s pager rendered one `<a>` per page — harmless at 3
     pages, hundreds of links at 300, which is exactly the shape a table
     with **no retention** (a deliberate choice — it is the accountability
     record, not ephemeral data, so auto-deleting it was never on the table)
     grows into. `paginationWindow()` in `admin/ui.js` is a pure function —
     first, last, and a couple either side of where you are, with a gap
     collapsed to `…` — capping the pager at a constant handful of links
     regardless of total pages. `admin/ui.test.mjs` covers it directly.
   - ~~**`/media`'s per-media-row scan of every page's block JSON is still
     open.**~~ **ALREADY DONE — this line was stale the day it was written.**
     The scan was inverted in the v4.24.0 backlog pass (see "The Media
     screen's usage scan is inverted" above) and the code says so at
     `tlc-admin-worker.js:4580`: each page is read ONCE into a filename map
     and a media row is then one lookup — O(pages + media), not
     O(media × pages). No inverted index or FTS5 was needed, because matching
     whole filenames instead of substrings removed the reason for one, and it
     is more accurate besides (`logo.png` no longer reads as "in use" because
     a page mentions `church-logo.png`). ⚠ What IS still open is a different
     thing: the screen fetches `SELECT * FROM ministry_media` with no `LIMIT`,
     plus every page's draft AND published blocks, on every load — FX-32.
4. ~~**~1.55MB of `IMG_*.jpg` in `public/images` referenced nowhere**~~ —
   **done 2026-08-03**, with Andrew's sign-off. All ten (~1.6MB) confirmed
   unreferenced anywhere in the repo — `public/index.html`, every admin
   route, every generated page seed — and deleted. `food-pantry.webp`/
   `Bees.webp` (~175KB each, still serving as both thumbnails and full-width)
   and the missing `width`/`height` attributes (CLS exposure) were not part
   of this ask and are still open.
5. ~~**Nine Google Font faces** — likely half unused.~~ **Checked 2026-08-03**:
   `public/index.html` only ever sets `font-weight` to 400, 600, 700 or 800
   (plus italic at 400) — verified against every style rule and inline style
   in the file, not just a sample. Lora 500 and Source Sans 3 300 were loaded
   but never used anywhere; the font `<link>` now requests only the four
   weights each family actually needs (7 faces, down from 9). The admin's
   separate font links (`admin/helpers.js`, `admin/gym.js`,
   `admin/ministry-editor.html`, `admin/scheduler.html`) were not touched —
   this pass was scoped to the public site, which is what the 221KB /
   9-face figure in the review referred to.
6. **`:has()` fallback** for the form-width cap (Firefox ESR / Safari <15.4
   get the 1900px forms back) — depends on what the office actually runs.
   **Scope check 2026-08-03**: this cap only ever applied to the ~29
   hand-written *admin* forms (`.tlc-wrap .card:has(.form-group)` in
   `admin/ui.js`) — things like the "add a news post" or "edit a staff
   bio" screens. It was never on the public website. It also does not
   reach the ministry/page block editor at all — that screen has never
   used the capped form wrapper, already renders at full width with its
   own Desktop/Tablet/Phone size switcher, and needs no change here.
7. **A dedicated a11y pass**: list rows are mouse-only, the public site has
   no `:focus-visible` styles. **The public-site half is done 2026-08-03** —
   `public/styles.css` gained a global, on-brand (amber) `:focus-visible`
   ring for links, buttons, and form fields, visible only to keyboard
   navigation (a mouse click never triggers `:focus-visible`, so nothing
   changes for a mouse/touch visitor). Found and fixed the same day: the
   header logo was a `<div onclick>`, not reachable by keyboard at all —
   every other nav link was already a real `<button>`; the logo now is too.
   **Still open**: the admin's list rows are still mouse-only — a keyboard
   user cannot open a row without a pointer. That is a bigger, separate piece
   of work (every `renderListSection()` row across ~25 screens) and was not
   part of this pass.

**Looked at and left alone**: the `:has` choice-chip concern was wrong (the
input is visible; only a decorative tint is at stake); `calcTotal`'s two
signatures live in different documents; `aspect-ratio`/`inset` fallbacks
would target ~2020 browsers; the pair's trailing margin has no clean multicol
fix; the drop-target's Y-only math inside a two-column flow is an
interaction-design question, recorded, with the crash itself fixed.

#### The card grids extract now (v4.13.0, 2026-08-02)

Andrew: *"can you try again to look at what is currently on every page and try
to put that in the editor that we have built."*

All 25 pages already extracted — that part shipped with the site editor. What
had not was **fidelity**: the extractor predated the card grid block, so it had
nowhere to put a run of cards and flattened them into a paragraph. `/ministries`
came out as `hero, text, text, text, buttons` for a page that is really nine
cards and four partners.

- **`cardRun()` recognizes a grid**, and the drafts now carry `cardgrid` blocks
  on `/ministries` (9 + 4), `/worship` (the four plan-your-visit cards) and
  `/youthfamily` (6) — with each card's image, heading, body and link intact.
- **⚠ THE CONTAINER HAS TO SAY IT IS A GRID.** The first version took any two
  sibling divs carrying an `<h3>`, and that swept up `/give`, whose two `<h3>`
  panels are stacked full-width boxes. *Two headings near each other* is not a
  grid; *these are laid out as a grid* is, and the markup already says so with
  a `-grid` class or an inline `display:grid`.
- **`/education` correctly extracts nothing.** Its three class cards are
  `bible-classes-grid`, filled live from the Christian Ed tab — there is no
  hardcoded content to lift, and inventing some would freeze a live list.
- The counts are the markup's, not the handoff's: `/ministries` genuinely has
  **nine** cards and seven images, where the spec said eight.

**Nothing on the live site changed.** Seeds land in the *draft*; a page with
nothing published still renders its hardcoded markup. The office opens a page,
looks at it, and presses Publish — page by page, which is what makes the
conversion reversible.

#### The arrows are gone, and this time there is a test (v4.12.0, 2026-08-02)

Andrew: *"Again go through and remove the arrows at end of links. I don't like
that style choice and it keeps coming back in."*

He is right that it keeps coming back, and the reason is that it was a
convention nobody checked. They were swept in v3.11.0 (90 of them), the `↗`
went in Task 12c — and they returned the same night: `Learn more →` in the card
grid's defaults, `Open in Google Maps →` on the map card, both mine.

**110 removed**, across `public/index.html`, the manual, the give page, the
block defaults, the editor and the generated seeds.

- **The rule is mechanical, which is why it can be tested.** An arrow at the
  END of a link's text is decoration — the text already says where it goes. An
  arrow BETWEEN two words is a sentence: `admin → Notices → Home`,
  `hold → confirmed`, `'Draft edits' → 'draft-edits'`. Those stay.
- **⚠ The quote case allows no whitespace.** `'Learn more →'` ends a label;
  `'Draft edits' → 'draft-edits'` is a separator whose next character is also a
  quote, with a space between. Allowing whitespace there flags the separator —
  and the fix somebody reaches for is deleting the rule rather than the arrow.
- **`admin/scheduler.html` is exempt**, and named as exempt: its one arrow is a
  next-month *button* whose entire label is the glyph. That is an icon, not
  decoration trailing a link.

`admin/link-style.test.mjs` runs in CI with the other admin suites. It also
asserts the rule still *catches* real decoration and still *passes* a
separator, so a green run means something and nobody weakens it by accident.

#### The renter's basket, and the phone it is opened on (v4.11.0, 2026-08-02)

Task 18 items 4 and 5 — the two left deliberately unfinished, now done.

**The basket** is one row per date in date order, each removable whole, with
every time inside it removable on its own.

- **Removing ONE time must leave the rest of that date alone.** Before this,
  the only correction available was Clear — and "start again" is not a
  correction when a request spans five dates.
- **Adjacent hours print as one range, a gap prints as two** (the spec's own
  rule): `1–3 PM` against `1–2 PM, 3–4 PM`. Those are different bookings. The
  range recomputes when a time is dropped, so it cannot go stale.
- **⚠ The removal handlers are delegated, not bound per button.** The basket
  re-renders on every change, so handlers attached to its buttons would be
  thrown away the moment somebody used one — the second ✕ would silently do
  nothing.

**The phone is the real device.** A renter opens this from an email, on a
phone, so 390px is where it was measured rather than a responsive afterthought.

- **Twelve tap targets were under 44px**, and the tightest was the one that
  matters most: the 7-column month grid, whose day cells were 38×40. A missed
  tap on a calendar is not a small annoyance — it books the wrong day, or
  nothing, and the renter tries again somewhere else.
- The `td` padding comes down at the same time so seven 44px cells still fit
  390px without sideways scroll. **That trade is the whole reason this needs
  designing at width rather than scaled down from desktop.**

`test/gym-portal.test.mjs` boots the real Worker and drives it in Chromium at
390px. Verified against the bug: breaking the per-time removal fails two
assertions. Run it after any change to the portal.

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
  does not honor.

⚠ **A tall block still decides the layout.** Two halves whose content differs
wildly in length will not look like a tidy two-up; they will look like a tall
thing beside a short thing with the next block tucked under it. That is the
point, but it means reordering blocks changes the shape of the page more than
it used to.

**⚠ Superseded 2026-08-05 — back to rows of two, now with stretch instead of
balance.** Dinger: a run of four halves was reading top-to-bottom in the left
column before starting the right one, not left-right-left-right as dropped —
`column-count` balances by height, it does not preserve row order. He also
wanted two blocks in a row to line up rather than leave a gap under the
shorter one. Both together are what this section's `column-count` fix was
trying to avoid *without* asking for anything from the office — but stretch
does the same job on purpose: `.tlcb-pair` is `display:grid` again (pairs of
exactly two, third starts a new row, matching the ORIGINAL spec this section
departed from) with `align-items:stretch`, so the shorter block's box grows to
match the row instead of leaving the 300px hole the screenshot above was about.
The editor rail brackets **pairs** again, not the whole run — `runEdges()` in
`admin/ministry-editor.html` walks pairs of two from the start of each
half-run, and the CSS gained an `ed-row--run-top`/`ed-row--run-bottom` pair
only (no `-mid`, since a row is never more than two). The phone override moved
from `column-count:1!important` back to `grid-template-columns:1fr!important`
— `admin/blocks.test.mjs`'s "half-width blocks" group pins all of this, including
that three consecutive halves now render as **two** `.tlcb-pair` wrappers (a
full row plus a lone one), not one.

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
- **The calendar encoded availability twice, in color only** — a red numeral
  *and* a red dot. Red numerals read as errors, the dot was redundant, and
  color alone fails for anyone who cannot separate the two hues. Available days
  are a navy numeral in an outlined cell that raises on hover; unavailable days
  are the numeral alone in gray, no cell, not clickable. **Absence of affordance
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
  POST all arrive at that line; the grayed inputs on the screen are a courtesy
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
defense-in-depth against a typo, not an attack path, and a mass edit across a
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
- **Improving the converter needs a `SCHEMA_VERSION` bump to reach anything.**
  The seed loop is `INSERT OR IGNORE`, so a better conversion never arrives at
  a page that is already a row. The re-seed pass after it refreshes a page's
  draft only when `canReseed()` says so — still stamped `updated_by='migration'`
  and never published. A page anyone has edited or put live keeps what it has.
- **A section that mixes a grid with panels is walked child by child.**
  `recognize()` reads a whole section as one shape, which on `/give` sees only
  the card grid and throws away the panels either side — and those panels hold
  the IRA, DAF and planned-giving copy. `mixedSection()` handles that shape and
  runs first; card detection still goes through `cardRun()`, so there is one
  idea of what a card is. `GRID_OPEN` also accepts `two-col`, the site's own
  name for a two-column grid, and `cardRun()` has a second pass for cards that
  head themselves with a serif-styled `<div>` rather than an `<h3>`.
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
- **Every give button reads one link.** The Tithe.ly base link lives only in the
  Giving tab (`give_url`). `loadGiveLinks()` in `public/index.html` rewrites
  every `[data-give-link]` from it; the href in the markup is the offline
  fallback, and `data-give-fund` overrides the fund (the CCS appeal) by
  *replacing* it rather than appending a second `fundId`. The `/give` seed's
  online-giving button points at **give.timothystl.org** on purpose: a block's
  URL is fixed once published, and that page resolves `give_url` at request
  time, so no block ever carries a copy of the Tithe.ly link.
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

#### Payroll reads and writes through thirteen RPC functions now, not the tables directly (2026-08-18)

Dinger: *"the connection to the childcare app in reading payroll is now
broken"*, then *"even more troubling is that church staff are lost too, not
just a failure to read from the childcare app"*. Both were the same cause.

**A real, legitimate security fix on the Supabase side broke this proxy, and
nothing here had ever accounted for that possibility.** Two Supabase
migrations on 2026-08-12 (`close_to_public_policy_leaks`,
`policy_scoping_stage2_admin_only_tables`) closed a genuine hole — the
public `anon` key this page has always used could read **and rewrite**
every church and MDO staff member's payroll data — by moving
`church_staff`, `church_staff_period_entries`, `payroll_periods` and
`staff_pto_entries` from `anon`-writable to `authenticated`-only, gated by
`admin_role()`. Correct for a real signed-in Supabase Auth session. But
nothing on this side ever *has* one — the `/sb/` proxy authenticates the
admin session on **its own** side (`payroll_manage`, checked against this
Worker's own `sessions`/`users` tables) and then forwards to Supabase using
only the plain anon key, exactly as this file's own "SUPABASE, WITHOUT THE
SDK" comment always said. `anon` lost its grants; the proxy had no other
credential to offer; every read and write on the page started answering
`401`/`permission denied for table …`, indistinguishable at first glance
from an expired admin session (the misleading message the first report
described) until the real Supabase error text was surfaced.

**The fix reopens exactly what this page needs, and nothing else — anon
still holds no direct grant on any of the four tables.** Supabase migration
`payroll_proxy_rpc` (project `dahdstopsumxnqvdclmy`) adds thirteen narrow
`SECURITY DEFINER` Postgres functions — `payroll_get_staff`,
`payroll_get_period_entries`, `payroll_get_prior_pto`,
`payroll_get_period_approval`, `payroll_get_mdo_staff`,
`payroll_get_mdo_hours`, `payroll_get_mdo_clock_events`,
`payroll_get_mdo_pto`, `payroll_approve_period`, `payroll_unapprove_period`,
`payroll_save_hours`, `payroll_save_staff`, `payroll_deactivate_staff` — each
one doing exactly the query the client used to run directly, each gated by
a shared secret checked against a `private.payroll_proxy_secrets` table
(schema `private` is never exposed to PostgREST at all, so there is nowhere
for the secret to leak through the API even by accident). `anon` is granted
`EXECUTE` on these thirteen functions and nothing broader — the same shape
this repo already uses for `CHMS_INTAKE_API_KEY`/`ADMIN_PUSH_API_KEY`.

- **The secret is held only by this Worker, never by the browser.**
  `admin/payroll.html` calls `/sb/rest/v1/rpc/<fn>` with the real params and
  no secret at all; `tlc-admin-worker.js`'s `/sb/` proxy buffers the small
  JSON body, injects `env.PAYROLL_PROXY_SECRET`, and forwards. A stray view
  of the page source shows the same `SB_KEY` anon JWT this proxy has always
  shipped client-side (PY-4, still open, still separate) — but never the
  new shared secret, which is exactly the property `CHMS_INTAKE_API_KEY`
  and `ADMIN_PUSH_API_KEY` already have and this one now shares.
- **THE PERIOD LOCK is enforced twice, not once.** The Worker's own
  `payrollPeriodLocked()` check still runs before forwarding a
  `payroll_save_hours` call — it now reads through the
  `payroll_get_period_approval` RPC instead of a direct `payroll_periods`
  REST call, which would 401 the same way everything else did. But
  `payroll_save_hours` itself also refuses the write server-side if the
  period is already approved, so a caller that somehow reached Supabase by
  a different path still can't slip an edit past a signed-off run — belt
  and suspenders, not either/or, matching how the lock was already
  documented ("enforced HERE, not by hiding the button").
- **Verified against the live project, not just reasoned about**: every one
  of the thirteen functions was called directly with the real secret and
  real data (7 real church-staff rows came back), a wrong secret was
  confirmed to raise `28000 invalid secret`, a hold-then-approve-then-save
  sequence confirmed the lock actually refuses the second write, and
  `anon`'s table grants were re-queried after the migration to confirm they
  are still exactly zero on all four tables. `node test/payroll.test.mjs`
  (93/93) — its stub server was rewritten to answer the RPC shape instead
  of raw REST table paths, and verified non-vacuous by breaking the RPC
  dispatch, which fails 8 assertions with the real symptom.
- **⚠ `anon` still keeps a few pre-existing grants outside this fix's
  scope** — `SELECT`/`INSERT`/`UPDATE` on `staff_clock_events` (almost
  certainly the childcare kiosk clock-in flow, which has no login of its
  own) and a bare `TRIGGER` grant on `staff`/`staff_hours` that does
  nothing useful. Left untouched — revoking them wasn't what broke, and
  isn't part of what this fix was asked to repair.

**Requires a manual step outside this repo, the same shape as
`CHMS_INTAKE_API_KEY`/`ADMIN_PUSH_API_KEY` before it**: `PAYROLL_PROXY_SECRET`
must be set as a secret on this Worker —

```
wrangler secret put PAYROLL_PROXY_SECRET --name tlc-newsletter-admin
```

— using this exact value, which is already the one stored in Supabase's
`private.payroll_proxy_secrets` table:

```
504f65d01386d7e87a9f0278567f8b54cc8a21173da001ec9f7a6f255c5dc1fb
```

Until it is set, every `payroll_*` RPC call forwards an empty `p_secret`
and every one of the thirteen functions refuses it — the Payroll page will
read and write nothing, with the real Supabase error now visible instead of
a misleading "session expired." This is the one step this session could not
perform itself.

#### The emailed report carries a real CSV and PDF now, not just an HTML table (2026-08-18)

Dinger: the email report should send a PDF matching the print option, and a
CSV. It sent neither before this — `/payroll/email` built one HTML email
with the figures in inline tables and nothing attached.

**No PDF library exists anywhere in this repo, and Cloudflare Workers has
no headless browser to render one with** — so `admin/pdf.js` is a small,
dependency-free PDF writer, the same shape as `admin/exif.js` reading image
bytes by hand instead of pulling in a package. It lays out plain monospace
text (Courier, one of the 14 standard PDF fonts — nothing to embed) rather
than trying to reproduce the HTML email's styled tables, because alignment
is what a bookkeeper's reconciliation copy actually needs, not typography.

- **⚠ Text is ASCII-only, by construction, not by accident.** A simple
  (non-embedded) PDF font reads single-byte character codes through
  WinAnsiEncoding; a Unicode codepoint written into a content stream
  literally is not a rendering quirk, it is a corrupt file. `asciiSafe()`
  substitutes the punctuation this codebase actually emits (em dash, curly
  quotes, the minus sign in `−$136.00`) and drops anything else to `?`
  rather than risk it. A name with a genuinely non-Latin character survives
  in the CSV (real UTF-8, via `TextEncoder`) but degrades in the PDF — a
  real gap, recorded rather than hidden, and the one a future session would
  need to fix with an embedded CID font if it ever matters.
- **`admin/payroll-report.js` builds the CSV and the PDF's lines from the
  identical `body` the HTML email already read** — `mdo.rows` /
  `church.rows` / both subtotals / the total, the exact shape
  `exportReport()` on the page already posts. Three renderings of one set
  of figures, not three separate ideas of what "the report" is; the CSV
  columns and the PDF's own money/hours/dash formatting are copied
  verbatim from the client's `exportReport()`/`renderPrintTable()`, down to
  the CSV-formula-injection guard (PY-5) and the 403(b) keeping its minus
  sign through that guard.
- **⚠ `sendTransactionalEmail()` now takes an `attachments` array
  (`[{name, content}]`, content already base64)** — a thin pass-through to
  Brevo's own `attachment` field, not a function that knows how to build a
  file. The route base64-encodes through `TextEncoder`, not a bare `btoa()`
  on the raw string, so a CSV with a real accented name in it round-trips
  correctly — `btoa()` alone throws on anything outside Latin-1.
- **A failed attachment build never blocks the email.** The body still goes
  out — see below, it no longer carries the figures itself, but a build
  failure is logged rather than swallowed, and the send still completes
  (the bookkeeper gets a report with nothing attached rather than nothing
  at all).
- **Verified structurally, not just "the file exists".** A hand-rolled PDF
  needs its own xref table pointing at exact byte offsets for every
  object, and `admin/payroll-report.test.mjs` walks that table by hand and
  confirms every offset lands on the `N 0 obj` it claims to — the same
  check style `admin/exif.test.mjs` uses (search the real bytes, don't
  trust the writer's own logic to have been right). Verified non-vacuous:
  a corrupted offset is deliberately injected and the check is confirmed
  to fail on it. Also covers a 90-row roster spanning multiple pages and a
  name carrying accented/curly characters, both checked for a still-valid
  PDF. No PDF-parsing library was available in this environment to also
  confirm the file opens in a real reader (Acrobat/Preview/browser) — the
  xref-integrity check is what stands in for that here.

Run: `node admin/payroll-report.test.mjs` (27), plus the existing
`node test/payroll.test.mjs` (93, unchanged — the client screen itself was
not touched, only the Worker route it already posts to).

#### The email body is one line now; the tables live only in the attachments (2026-08-19)

Dinger, once the CSV/PDF attachments above were confirmed working live:
just make the body say a line about the payroll for the period being
attached, rather than repeating the figures in an inline table too.

**The MDO/church tables in `emailHtml` are deleted, not hidden.** They were
the third copy of the same figures the CSV and PDF already carry — the
body now says the period and that the CSV/PDF are attached, plus whether
the run was signed off (kept, since that's still worth knowing before
opening either file) and the incomplete-MDO warning when it applies.

- **⚠ A staff name never reaches the email body at all now.** It used to
  be there, escaped, inside the deleted table; the body has nowhere left
  for one to land. It still reaches the CSV and PDF attachments, which
  have their own established escaping (`admin/payroll-report.test.mjs`'s
  CSV formula-injection guard, the PDF's own ASCII-safety in `admin/pdf.js`)
  — nothing new needed here, the concern just moved with the data.
- The total gross figure is also gone from the body, for the same
  reason — it's the first line of both attachments, and repeating it a
  third place is exactly the "second copy that can quietly disagree"
  pattern this file warns about elsewhere.

Run: the rewritten `payroll emails its report to the bookkeeper` group in
`test/admin-redesign.test.mjs`, verified non-vacuous — corrupting the
one-line "is attached" wording fails it.

### Access Control
- Staff admin password: full access (all tabs) — permissions are granted per-account, per-tab via the Users tab's checkboxes (see `PERMISSIONS` in `admin/auth.js`)
- **v3.0.0 renamed three keys** — `pages_edit`→`notices_edit`, `site_pages`→`pages_edit`, `site_pages_own`→`pages_edit_own`. See "The v3.0.0 Admin Overhaul" above; the migration must never run twice.
- Youth content editing now lives under the **Ministries** tab (`ministries_edit` permission), not a separate "Youth Pages" tab
- **Payroll** requires the dedicated `payroll_manage` permission — not bundled into `settings_manage` (see "Payroll & Supabase" above)
- **Giving** requires the dedicated `giving_manage` permission — not bundled into `settings_manage` (see "Giving Tab" above)
- **Christmas Market** requires the dedicated `market_manage` permission, with a `Market coordinator` preset that grants it and nothing else — the coordinator is a volunteer running one event a year, and the list holds seventy people's home addresses
- Youth director password: scope to `ministries_edit` only (separate password so it can be changed independently of office staff accounts)

---

## Design System

### ⚠ American spellings everywhere (settled 2026-08-11)

Dinger: *"in the admin side of this british spellings have crept in like
neighbourhood and colour. look all through and remove those."* He was right —
401 of them, across the admin screens, the block editor, the Worker, the staff
manual and this file. All swept.

**The rule is American English, in everything a human reads: screen labels,
button text, purpose lines, `◆` notes, toasts, code comments, this file, and
`public/manual.html`.** That is not a style preference — this is a church in
St. Louis writing to its own office staff and congregation, and "colour" on an
admin screen reads as a typo to every one of them.

The ones that had actually crept in: `colour` · `neighbourhood` · `centre` /
`centred` · `behaviour` · `organisation` · `grey` / `greyed` · `licence` ·
`labelled` · `honoured` · `sanitise` · `normalise` · `initialise` ·
`recognise` · `serialise` · `summarise` · `optimise` · `synchronise` ·
`capitalise`, plus their prefixed forms (`unrecognised`, `recoloured`,
`sanitisation`) and the identifiers built on them (`colourOf`,
`COLOUR_FIELDS`). American: color, neighborhood, center, behavior,
organization, gray, license, labeled, honored, sanitize, normalize,
initialize, recognize, and so on — `-ize` / `-or` / `-er`.

**⚠ Four things that look British and must NOT be "corrected":**

| Leave alone | Why |
|---|---|
| `aria-labelledby` | An HTML attribute name. Renaming it silently unlabels the drawer and the block rail for a screen reader, with nothing to see in a browser. |
| `'cancelled'` | A stored `gym_bookings.status` value. Changing the spelling in code without a migration orphans every cancelled booking in the live table. |
| `/licen[cs]e/i` in `test/tinymce-selfhost.test.mjs` | Deliberately matches both, because it is grepping TinyMCE's *own* console output for a licence complaint, not ours. |
| `admin/vendor/tinymce/**` and every `design_handoff_*/` | Third-party code and archived designer deliverables. Neither is ours to rewrite, and editing the vendored library breaks the checksum the asset test relies on. ⚠ This was written as `design_handoff_admin_overhaul/` alone, which meant the documented grep started failing the moment a second handoff was committed — `design_handoff_news_redesign/` has ten hits in it, none of them ours. Widened to the prefix so the check stays runnable. |

Also unchanged: `fulfilled` (a Promise term, and standard American anyway) and
`enrolling`, which is spelled the same either way.

**How to check.** A word-boundary grep over the tracked files, minus the two
excluded trees:

```
git ls-files | grep -vE '^(admin/vendor|design_handoff_[a-z_]+)/|^CLAUDE\.md$' \
  | xargs grep -rniE '\w*(colour|neighbour|centre|centred|behaviour|organis[eai]|recognis|initialis|sanitis|normalis|serialis|summaris|optimis|licenc|labelled|grey|honour)\w*' \
  | grep -vE 'labelledby|licen\[cs\]e'
```

It should return nothing. Worth running before opening a PR that adds a screen.

⚠ **`CLAUDE.md` is excluded from its own check, and that is not laziness** —
the section you are reading spells every one of those words out in order to
name them, so leaving it in guarantees ten hits on a clean tree. A check that
always fails is a check nobody runs.

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
- ~~**A custom-rendered calendar, reading the church's own feed**~~ — **done v5.29.0, 2026-08-19.** Option (3), the one the note called a real project: `/calendar` and the `/news` strip are drawn by the site from `/api/calendar`, a merged Google + News & Events feed, and there is no per-day cap at all. See "The calendar is ours now" above for the design, the color-to-category rule and the two manual steps it still wants. ⚠ The note's own caveat still stands and now matters more, not less: **`calendar.google.com` and `www.googleapis.com` are unreachable from this sandbox**, so every Google-facing path is verified against stubs and against the API's documented shape, never against a live answer. The first person with real credentials should open `/calendar` and check that a Sunday's services are all there.
- **24 of the 25 page drafts are still unpublished** — not a code gap. Every page has had a block draft since the site editor shipped; `/give` is the first published. The rest need somebody to compare each draft against the live page, fix what the extractor flattened, and press Publish. Sequencing, known extractor gaps and the three pages that deliberately are not block pages are all in `admin/BLOCK-EDITOR-ROLLOUT.md`.

- ~~**Weekly newsletter display wants adjustments**~~ — **done v4.35.0, 2026-08-13.** It was the archive, not the composer: the newest letter is open and everything older folds away under its month, closed. See "The newsletter archive folds away by month" above. *(Original note:)* flagged 2026-08-05, Andrew's own words, no specifics given yet.
- **`/volunteer` short-URL redirect does not actually exist** — confirmed live 2026-07-20 while chasing the 2026-07-20 volunteer→serve rebrand: the Redirects tab in `admin.timothystl.org` has no `/volunteer` entry at all. This table's earlier documentation of `/volunteer → volunteer.timothystl.org` as an existing "Utility Redirect" was aspirational/planned, not a live row — `site-worker.js` has no hardcoded fallback either (confirmed by grep), so `timothystl.org/volunteer` simply falls through to the normal 404 page today, not to a dead external host. Nothing broke as part of the volunteer.timothystl.org→serve.timothystl.org cutover (see the chms repo's own CLAUDE.md). If a short link is wanted, an admin can add one via the Redirects tab: path `/volunteer` (or `/serve`), target `https://serve.timothystl.org` — optional, not a fix for anything broken.
- ~~**links.timothystl.org "Volunteer" card still points at the old host**~~ — **not true, checked 2026-08-01.** Andrew looked and the live card already reads `serve.timothystl.org`; the seed constant says the same. This entry was written as a prediction about a row nobody had looked at, and it stayed on the list long enough to waste his time. Nothing to do.
- **`/confirmation`, `/sundayschool`, `/vbs`, `/egghunt`, `/family`** — Youth sub-pages. Admin portal has the youth_pages table, but these slugs need content entered by the youth director.
- **Christmas Market annual content** — Page structure is built, and as of v5.6.0 the annual update is **not a code edit**: the date, the hours, the table fee and whether applications are open at all are `market_*` settings, and the vendor application is `/christmasmarket/vendors` rather than a Google Form link somebody pastes in each autumn. What is still wanted each year is the description and this year's photos (admin Ministries tab), plus two market photographs for the vendor page — see "The Christmas Market takes its own vendor applications" above. The checklist in `public/manual.html` was rewritten to match.
- **Ministry page editor rollout** — every ministry page now has a full-page block draft waiting in the editor (banner and all sections). The office reviews each one and presses Publish; until then the live page renders from its hardcoded markup exactly as before. Once a page is published from the editor, its hardcoded section markup in `public/index.html` is dead and can be deleted.
- **Music page video strip** — the three fallback video cards on `/music` were not converted (they need real YouTube URLs). Add Video blocks in the editor, or drop them.
- ~~**Sermons page**~~ — **done v4.24.0, 2026-08-05.** Andrew: the channel is `youtube.com/timothystl`, one general worship service a week, and *"I dont knwo how we can make it pull the most current one every time"*. It does now — `/sermons` embeds the newest video from the channel's own Atom feed, no API key, nothing to post weekly. `sermon_youtube_channel` and `sermon_title_filter` are the two settings. See "The backlog pass" above.
- ~~**Homepage newsletter signup block is hardcoded**~~ — **done v4.23.0, 2026-08-05**, and the premise was wrong in a way worth recording: it is **not** on the homepage. It sits outside every page div and renders on all 28 pages, so converting the homepage to blocks would never have reached it. It is site-wide chrome, and its color, wording and on/off switch are now on the Appearance screen beside the header. See "The chrome is editable, and drafted first" above.
- ~~**Confirm the Menu screen actually publishes live**~~ — **answered 2026-08-05.** It was already live: every menu write goes straight through and the `/api/pages` edge copy is busted by the chokepoint on any POST under `/pages` or `/menu`, so a change reaches the site inside the 120s window. What made it *look* unpublished was the preview bar, which drew a header the site does not have — fixed in v4.23.0. Menu items stay instant; only the new appearance record is drafted and published.
- ~~**No logo image upload for the top nav bar, and header color scheme isn't admin-editable**~~ — **done v4.23.0, 2026-08-05.** Logo upload (R2, with shape), church name, tagline, bar color, bottom rule and Give button, all under Menu → Appearance. Note the "T" badge in the old Menu preview was never the site's logo — it was invented by that preview, which is why the header looked unchangeable. Both open questions were answered: **scope** is the header and the newsletter band only, not the site-wide palette (`--steel`/`--amber` still belong to the stylesheet); **publish** is a real draft/live split, `site_appearance_draft` vs `site_appearance`, exactly like `blocks`/`published_blocks`.

- **The photographs.** The redesign depends on about eight and the repo has
  none — every banner ships as a flat ink-navy field until they exist. What is
  wanted, from the handoff: a Sunday morning wide (Home), the sanctuary
  mid-service (Worship), hands at work (Ministries), the coming event (/news),
  a sermon still, the music photo, and one per feed card. Dropping one in is a
  click in the editor and changes nothing else.
- **The four redesign drafts are unpublished**, like every other page's. Open
  `/pages/news/edit`, read the draft against the live page, press Publish — then
  Worship, then Ministries, then Home last, which is the most bespoke markup and
  the most visitors. See "The site redesign" above.

- **The site-wide palette is still not admin-editable, deliberately.** The Appearance screen changes the header and the newsletter band; `--steel`/`--amber`/`--sage` in `public/styles.css` color every button, card, heading and section on the site. Exposing those would be a theme editor, and a bad pick there is not one unreadable bar but an unreadable site. If it is ever wanted it needs its own design — starting from which of the ~20 variables are genuinely independent choices rather than shades of each other.

### From the Post-Redesign Review — Andrew's Call (2026-08-02)

The full review (three scouts + a synthesis pass, everything verified by reading or measuring rather than pattern-matched) is recorded above under "The post-redesign review (v4.14.0–v4.15.0)". Everything it found that was safe to fix outright shipped in PRs #378–#379. Of the seven report-only items, two parallel sessions worked the list independently the same day (2026-08-03) — PRs #382–#385 on one side, this PR on the other — and between them all seven now have an answer:

1. ~~**A build/minify step.**~~ **Declined, not deferred** — a text-based minifier is exactly the failure mode this repo has already been bitten by twice (a stray backtick silently breaking a template literal), and only an automated build step keeps that from drifting, which reverses the deliberate no-toolchain stance. See "Pending / Deferred Items".
2. ~~**Externalise the admin's CSS/JS.**~~ **Done** — `ADMIN_SHELL_CSS`/`ADMIN_SHELL_JS` (`admin/helpers.js`) now serve at `/assets/admin.css` and `/assets/admin.js`, `public, max-age=31536000, immutable`, cache-busted by `?v=${VERSION}`. No longer inlined into every response.
3. ~~**The heavy admin handlers**~~ — **all five named in the original item now addressed**: `/newsitems`' expiry sweep backgrounded via `ctx.waitUntil`; `/subscribers` and `/api/search` both parallelize what used to be serial round trips (`Promise.all` over independent offsets/sources); `/audit-log`'s pager is windowed (`paginationWindow()`) instead of one anchor per 50-row page. `/media`'s O(media × pages) substring scan is the one left alone on purpose — a real fix needs a maintained usage index updated on page save, not a parallelise, and at the site's actual scale (`pages`/`youth_pages` each dozens of rows) it isn't a felt problem today. Two more from the fuller handler catalog were never part of this seven-item list and are still untouched: `/gym-rentals`'s three unbounded `gym_bookings` scans with joins, and `/pages`'s O(n²) parentName lookup.
4. ~~**~1.55MB of `IMG_*.jpg` in `public/images` referenced nowhere. No `width`/`height` attributes anywhere on the site (CLS exposure).**~~ **Both done.** All 10 unreferenced files confirmed and deleted. Of the 17 `<img>` tags on the public site, 13 have one fixed intrinsic size (logo, ministry-card thumbnails, partner logos, three full-width ministry photos) and now carry `width`/`height` read straight from the file, so the browser reserves their space before the image loads. The other 4 render admin-uploaded content (news item, ministry update, staff photo, music-ministry photo) with no fixed aspect ratio — a real fix needs width/height stored at upload time, not a markup sweep, so those stay open. Resizing the double-duty `food-pantry.webp`/`Bees.webp` (each serving both a 72px thumbnail and a full-width image from the same 170KB+ file) is also still open — no image-processing tool exists anywhere in this repo or in the sandbox that made this pass; it needs a machine with real image tooling, not just repo access.
5. ~~**Nine Google Font faces loaded**~~ — **done, with a correction.** One weight really was unused (Lora 500 — confirmed against every `var(--serif)` rule including `BLOCK_CSS`, which ships to the public site via `/api/pages` but is edited in `admin/blocks.js`) and was dropped, 9 → 8. A first pass at this also dropped Source Sans 3 weight 300, on the assumption it was unused too — it isn't: `.hero-sub`, `.welcome-body`, `.mdo-desc`, `.page-hero p` (`styles.css`) and `.tlcb-hero-sub`/`.tlcb-slide-sub` (`blocks.js`) all set `font-weight:300`, and dropping it from the font link would have silently swapped every one of those to a synthetic or 400-weight render. Restored on merge.
6. **A `:has()` fallback** for the Task 19 form-width cap — still open. Firefox ESR and Safari <15.4 get the old uncapped-width forms back rather than anything broken; a real fallback needs a plain-class marker added across ~29 hand-written admin form routes (the rule matches on DOM shape, which older CSS can't express at all) for browsers nobody's confirmed the office runs. Scoped to the admin's hand-written forms only — never the public site, and doesn't touch the block editor.
7. **A dedicated accessibility pass** — **both halves now done.** `:focus-visible` styling on the public site (nav, buttons, form fields — `public/styles.css`) and admin list rows are real tab stops now too: `renderListSection()`'s `.tlc-row` carries `tabindex="0" role="link"` whenever it has somewhere to go, `LIST_SECTION_JS` answers Enter the same way it answers a click, and `.tlc-row:focus-visible` gets an outline (there was previously only a `cursor:pointer` hint, no focus styling at all). This mattered beyond cosmetics: most rows have a fallback `<a class="tlc-edit">Edit</a>` a keyboard user could reach instead, but not every row does — gym bookings render a plain `<span>—</span>` for confirmed/past bookings, so that row was a genuine keyboard dead end before this. `test/list-section.test.mjs` covers it with a row that has no separate link.

### Pinned / Low Priority
- **manual.html** — Keep this updated whenever new features, pages, or admin tabs are added. It is the staff reference guide at `/manual` and should always reflect the current state of the site and admin portal.
- ~~**[B1] Gym booking race condition**~~ — **done v4.24.0**, Andrew's rule: *"once it is booked it should be locked out"*. A partial unique index over the active statuses. ⚠ It catches an exact duplicate slot, not a partial overlap — see "The backlog pass" above for why and what is still open. *(Original note kept.)* **[B1] Gym booking race condition** — `admin/gym.js` checks for a booking-slot conflict with a `SELECT` and then does a separate `INSERT`, with no transaction or unique constraint on `(booking_date, start_time, end_time)`. Two concurrent hold requests for the same slot could both pass the check and double-book. Needs a design decision (D1 batch/transaction vs. a unique index + handling the constraint-violation error) rather than a quick fix. Flagged in the July 2026 code review; not yet fixed. Very low urgency in practice — two people booking the exact same slot at the exact same instant is rare; keep on the list to think about, no rush.
- **[B2] Newsletter Format 3** — Single-event announcement (date, time, location, RSVP). Skipped for now, add if needed.
- **[B3] R2 image uploads (card thumbnail)** — Body editors (TinyMCE) across News, Youth Pages, Pages, and Posts all have R2 upload fully wired via `tlcUploadHandler` — drag/drop or paste images and they upload automatically. The only remaining URL-only field is the News item card thumbnail (`image_url` text input). A file-picker button for that field could be added if needed.
- ~~**[B4] KV-gate startup migrations**~~ — **closed by measurement 2026-08-05, nothing built.** The premise was already false: measured against the real Worker, a cold isolate pays 411 statements once and a **warm request pays 0** — the `MARKERS_SEEN` work did it. There is nothing left for a KV gate to save.
- ~~**[B5] Session idle timeout**~~ — **done v4.24.0.** Both limits apply now: seven days since sign-in, 24 hours since the last request. ⚠ A missing `last_activity` is treated as active, so the migration does not sign out the whole office on deploy.
- ~~**[B6] EXIF metadata in uploaded images**~~ — **done v4.24.0**, and neither of the suggested ways: `admin/exif.js` cuts the metadata out byte-level at `/api/upload-image`, so it covers every uploader rather than depending on which button somebody clicked or on a Cloudflare Images subscription. Fails open on anything it cannot parse.
- **[B7] Social preview image** — **the mechanism shipped v4.24.0; the photograph has not.** `social_image_url` is a setting and `site-worker.js` rewrites the tags with HTMLRewriter, so swapping it is one field. ⚠ It had to be server-side: crawlers read `og:image` out of the HTML as served and do not run the page's JavaScript. What is still wanted is a real 1200×630 photo of the church or congregation — until one exists the logo is still what gets shared. *(Original note:)* `og:image` currently uses the logo, which is fine for now. A proper 1200×630 photo of the church/congregation would improve click-through when the site is shared on Facebook/Twitter, whenever this gets picked up. When it does, consider making the image swappable via an admin setting (e.g. under Redirects) instead of a one-off hardcoded edit to `public/index.html`'s head section.
- ~~**[B8] Mobile touch targets**~~ — **done v4.24.0, as a test rather than an afternoon.** `test/public-phone.test.mjs` measures at 390px on every change. It found footer links **14px** tall, a 36px hamburger and six buttons under 44px. Fixed with padding and minimum heights only — no type sizes changed. ⚠ The footer is held to 36px, not 44: eighteen links at 44px is a footer taller than the phone.

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

## Session State (as of 2026-08-02)

This section used to restate the site's status in full; it drifted for months (last update 2026-05-19, before the entire v3.0.0–v4.15.0 admin overhaul) and nobody caught it because it was a second copy of information kept accurately elsewhere. Following the same rule this file states explicitly under "The design handoff is in the repo now" — *"two copies of a status table are two answers to 'is this done yet'"* — it now points rather than repeats:

- **Every admin tab's status** is the "Admin Portal Plan" table near the top of this file — kept current all session, every row DONE.
- **The live inventory of every admin screen** against the v3.0.0 mockups is `admin/REDESIGN-STATUS.md` — see "The design handoff is in the repo now" below for why that file, not this one, is the source of truth for per-screen fidelity.
- **The public site's colors, typography and socials** are under "Design System" below.
- **The admin worker version** is `VERSION` in `admin/helpers.js`, currently `v4.24.0` — see "Versioning" below for what bumps mean.

### What's actually next
- Youth director content entry for `/confirmation`, `/sundayschool`, `/vbs`, `/egghunt`, `/family` — the `youth_pages` rows exist, waiting on real content.
- Christmas Market content update each year — now three settings and a switch rather than a code change; see the checklist in `public/manual.html`.
- The seven report-only items from the 2026-08-02 review, under "Pending / Deferred Items" below — all seven are Andrew's call, none urgent.
- Everything else still listed under "Pending / Deferred Items" below.

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
| GY-1 | ~~Critical~~ **PARTLY FIXED v4.24.0** | Gym | [B1] Booking double-book race. A partial UNIQUE index over the active statuses now closes the exact-duplicate slot at the database. ⚠ A partial OVERLAP (1–3pm against 2–4pm) is a range comparison, which an index cannot express, and still races — see FX-24. |
| GY-2 | ~~Critical~~ **FIXED v3.8.0** | Gym | Stored XSS via renter-controlled `notes` — escaped in the review page and both emails |
| AW-1 | ~~High~~ **FIXED v3.8.0** | Admin worker | Unhandled exceptions leaked full stack traces to unauthenticated clients — now a reference, with the detail in the log |
| AW-2 | High | Admin worker | Stored XSS in admin UI via unescaped DB content → cross-privilege escalation (low-perm editor → admin) |
| AC-1 | ~~High~~ **FIXED v3.8.0** | Core | Session cookie missing `Secure` flag — added, on both the set and clear headers |
| AC-2 | High | Core | Email templates interpolate titles/subjects/URLs into broadcast HTML with **no** escaping (`email.js`) |
| AC-3 | ~~High~~ **FIXED v3.6.0** | Core | `</script>` in saved editor content breaks out of the inline TinyMCE init block (`helpers.js`) — one builder now; v4.29.0 removed the inline script entirely, so there is nothing to break out of |
| AC-4 | ~~High~~ **FIXED v4.24.0** | Core | `DB_INIT_GYM_BOOKING_SLOT_INDEX` (`admin/db.js:536`) is a partial UNIQUE over `('confirmed','hold')`. Schema half of GY-1, closed. |
| VS-3 | High | Scheduler | Breeze/Resend/Worker **secrets stored plaintext** in localStorage AND synced to D1 in plaintext |
| VS-4 | High | Scheduler | RSVP tokens generated with `Math.random()` — guessable; sole authenticator for `/rsvp` |
| VS-5 | High | Scheduler | localStorage is the working store; D1 sync is last-write-wins → multi-device data loss |
| VS-6 | High | Scheduler | Stats double-count confirmed slots after a month is regenerated (inflated serve counts) |
| VS-7 | High | Scheduler | Side panels/modals: no Escape, no focus trap/return, no dialog ARIA |
| GY-3 | High | Gym | Recurring monthly invoice re-bills every run (dedup is a no-op) — duplicate charges |
| GY-4 | High | Gym | Batch hold endpoint bypasses rate-limit and `max_active_holds` (calendar DoS) |
| GY-5 | High | Gym | Renter self-confirm endpoints still routed despite "holds only" policy (bypasses office review) |
| GY-6 | High | Gym | `/hold` classic path skips day/hour business-rule validation (book outside allowed hours) |
| PY-1 | ~~High~~ **FIXED v3.2.0** | Payroll | Staff name not JS-escaped in inline `onclick` → broke legit names (`O'Brien`) + script injection — delegated off `data-id` now |
| PY-2 | ~~High~~ **FIXED v3.2.0** | Payroll | 403(b) base mismatch — stub line items didn't reconcile to displayed Gross Pay — `baseEarnings()` computed once, used everywhere |
| PY-3 | ~~High~~ **FIXED v3.2.0** | Payroll | Payroll page ignored the shared admin shell (divergent design, no nav) — folded into `sidebarShell` |

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
- **VS-2** ~~(Critical, security)~~ **FIXED v3.8.0** — `site-worker.js` fell through to `env.ASSETS.fetch`, so the whole Worship Schedule Builder was public at `/scheduler.html` with no auth gate. Moved to `admin.timothystl.org/scheduler`, behind the session; the old address 302s there. It is also dead code — the endpoint it talks to does not exist in this repo — locked rather than deleted since the schedules it once held may still be wanted; see "Four security fixes from the July review" above.
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

- **AW-1** ~~(High, security)~~ **FIXED v3.8.0** — top-level catch (116-125) returned `e.stack` to every route incl. unauthenticated ones. Now returns a short reference and logs the detail server-side only; see "Four security fixes from the July review" above.
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

- **AC-1** ~~(High, security)~~ **FIXED v3.8.0** — session cookie (`auth.js` 109/113) set `HttpOnly; SameSite=Strict` but not `Secure`. Appended on both the set and clear headers, so sign-out can't leave a non-Secure cookie a browser refuses to overwrite.
- **AC-2** (High, security) — `email.js` drops subjects/titles/event names/CTA URLs into broadcast HTML with no escaping; `escapeHtml` exists in `helpers.js` but isn't imported here. Wrap all short plain-text fields.
- **AC-3** ~~(High, security)~~ **FIXED v3.6.0** — `helpers.js`'s six near-identical TinyMCE section builders escaped backtick/`$` but not `</script>`, which the HTML parser honors regardless of JS-string context — a saved post could break out of the inline init block and run script in an admin's session. One builder now (`tinymceField()`), and `jsString()` split the closing tag so the parser never saw it; see "AC-3 is fixed" above. ⚠ v4.29.0 went further and removed the inline script — saved content never reaches a `<script>` at all now.
- **AC-4** ~~(High, correctness)~~ **FIXED v4.24.0** — `DB_INIT_GYM_BOOKING_SLOT_INDEX` (`admin/db.js:536`) is a partial UNIQUE index over `('confirmed','hold')`, created in the schema block. Two people clicking the same slot can no longer both win it. ⚠ It catches an exact duplicate, not a partial overlap — see FX-24.
- **AC-5** (Medium, correctness) — `gym_invoices` money columns are `REAL` (db.js 175). Store integer cents. (Schema change → version bump.)
- **AC-6** ~~(Medium, correctness)~~ **FIXED (Phase 9, v3.x)** — `DB_INIT_AUDIT_LOG` (`admin/db.js:627`) declares `user_id INTEGER` with no NOT NULL, and the table was rebuilt with the history copied across. A scheduled page going live and a hold lapsing are recorded again.
- **AC-7** ~~(Medium, perf)~~ **FIXED v4.24.0** — all seven named indexes exist (`tlc-admin-worker.js:2326-2332`), plus five more elsewhere in the block. ⚠ Two of them duplicate earlier ones and are pure write cost — see FX-33.
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

- **GY-1** ~~(Critical, correctness)~~ **PARTLY FIXED v4.24.0** — the partial unique index landed (see AC-4) and a constraint violation is caught as a skipped slot. ⚠ Still open for a partial overlap, which no index can express: see FX-24.
- **GY-2** ~~(Critical, security)~~ **FIXED v3.8.0** — renter `notes` rendered unescaped in the recurring-review page (4453) and admin emails (1532/1542/1705) — stored XSS running in the office's authenticated session. Escaped in all three now; `group.name`/`contact`/`email` are left unescaped deliberately since that field is office-entered behind `gym_manage`, not renter-supplied — see "Four security fixes from the July review" above.
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

- **PY-1** ~~(High, security/correctness)~~ **FIXED v3.2.0** — `esc()` (1596) didn't escape single quotes; names landed in single-quoted inline `onclick` (913). `O'Brien` broke Edit/Remove; a crafted name could run JS. Now event-delegated off `data-id`, listed above under "Gym and Payroll, to the mockups".
- **PY-2** ~~(High, correctness)~~ **FIXED v3.2.0** — 403(b) shown in `renderStaffBlock` (1493) was computed on `hours*rate` but `calcGross` (1579) used `(hours+ptoUsed)*rate` → stub line items didn't reconcile to Gross. `baseEarnings()` is computed once now and used everywhere.
- **PY-3** ~~(High, design/UX)~~ **FIXED v3.2.0** — the whole page was bespoke (Nunito/navy, own login CSS, no sidebar, only a Sign Out button) vs the shared `sidebarShell`/`html()` — a dead-end that inherited none of the shell's a11y/mobile fixes. Folded into the shared shell; see "PY-3 is fixed" under "Gym and Payroll, to the mockups" above.
- **PY-4** (Medium, security) — Supabase anon JWT hardcoded in page source (779). `/sb` gate is the real control (defense-in-depth), but inject the key server-side / document rotation. Still open.
- **PY-5** ~~(Medium, security)~~ **FIXED v3.2.0** — CSV `q()` (1229) quote-doubled but didn't neutralize `= + - @` (the 403(b) column even emitted a leading `-`). Risky cells are prefixed now.
- **PY-6** ~~(Medium, correctness)~~ **FIXED v3.2.0** — float money; rows rounded for display while subtotals summed unrounded values (1304) → a printed subtotal could be a cent off. Every gross rounds to cents before it is summed now.
- **PY-7** ~~(Medium, a11y)~~ **FIXED** — it is a real dialog now: `admin/payroll.html:253` is `role="dialog" aria-modal="true" aria-labelledby=…`, and `:1359` closes it on Escape with focus moved in and restored.
- **PY-8** ~~(Medium, a11y)~~ **FIXED** — the drawer's fields are labeled and the hours inputs carry their own `aria-label`, in the same pass as PY-7 (see the comment at `admin/payroll.html:1340`). ⚠ PY-14 (`aria-live` on the saved/error flash) and PY-15 (`scope="col"`, muted contrast) are NOT covered by that pass and are still open — see FX-36.
- **PY-9** ~~(Medium, UX/correctness)~~ **FIXED v3.2.0** — `onPeriodChange` (1059) awaited several fetches with no feedback; `loadMdoData` (1093) used `|| []` and never checked the Supabase `error` field → a failed MDO query could silently under-report staff on a payroll run. It now says the report is incomplete, in the entry view, the report, and the CSV.
- **PY-10** (Medium, responsive) — `.form-row`/`.form-row-3` (539) don't collapse on mobile; the 640px block only touches the hours row/table. Collapse to one column under ~560px.
- **PY-11** ~~(Medium, correctness)~~ **FIXED** — period dates are formatted from local components, and the reason is written into the code at `admin/payroll.html:454`. The one remaining `toISOString()` (`:805`) stamps an approval instant, which belongs in UTC.
- **PY-12** ~~(Low, UX)~~ **FIXED** — there are zero `alert(` calls left in `admin/payroll.html`; errors render through the shared banner.
- **PY-13** (Low, UX) — Dead `#loginScreen` CSS (44) with no matching DOM; on 401 `showDashboard()` still runs and shows a raw "Network error." Remove dead CSS; redirect to `/login` on 401.
- **PY-14** (Low, a11y) — "✓ Saved" flash (663) and error rows carry no `aria-live`. Add `role="status"` / `role="alert"`.
- **PY-15** (Low, a11y) — Data-table `<th>` lack `scope="col"`; muted `#7A6E5A` at ~11px approaches/fails 4.5:1 contrast.
- **PY-16** (Low, correctness) — Clock shifts <10 min silently dropped (1121); hours inputs wire both `oninput`+`onchange` → redundant save on blur.


---

## Code Review — 2026-08-19 (v5.28.4)

A full read of the request path, the public API surface, the two public
Workers, the shared UI layer and the design tokens, asked for as *"security or
loading speed issues, design consistency, and areas where we have flagged
issues but those issues are resolved."* **Nothing here was changed** — this is
a catalog, in the same shape as the July 2026 review above.

Labels are stable so they can be referenced directly (*"fix SEC-3, PERF-2"*).
New prefixes rather than more `AW-`/`AC-` numbers, because several findings
cross files that did not exist when those were written:

`SEC-` security · `PERF-` loading speed · `DSN-` design consistency ·
`DOC-` this file disagreeing with the code.

**How it was checked.** Every item below was read in the source or measured,
not pattern-matched. Byte sizes come from running the modules; the test
results are from actually running the suites (see "What the suites say" at the
end). Where something could not be verified from this sandbox it says so.

---

### First: what this file listed as open, and is not

The ask was explicitly for this. Each of these is fixed in the code and read as
outstanding somewhere above. **All of them have now been struck through and
marked closed in place** — this table is the index of what moved, so a reader
who remembers one of these as open can see when and why it changed.

⚠ Closed **in the documentation only**. Not one line of behavior was changed by
this pass; each was verified against the code as it already stands, at the line
reference given.

| Label / note | Where it says otherwise | What the code actually does now |
|---|---|---|
| **AC-6** — `audit_log.user_id NOT NULL` swallowed system entries | Marked fixed in the Phase 9 section, still listed unqualified in the July table | `DB_INIT_AUDIT_LOG` (`admin/db.js:627`) has `user_id INTEGER` with no NOT NULL. Genuinely closed. |
| **AC-7** — missing indexes | Listed as a cross-cutting theme to fix | All seven exist (`tlc-admin-worker.js:2326-2332`), plus five more. Closed — see DSN-6 for the duplicates it left behind. |
| **AC-4 / GY-1** — no unique constraint on a gym slot | The July table, and "[B1] … not yet fixed" under Pinned / Low Priority | `DB_INIT_GYM_BOOKING_SLOT_INDEX` (`admin/db.js:536`) is a partial UNIQUE over `('confirmed','hold')`. Exact-duplicate slots are closed at the database; partial overlaps are not, and the v4.24.0 note says so. The **Pinned / Low Priority** entry still reads as if nothing was done. |
| **PY-7 / PY-8** — payroll modal has no dialog role, no Escape, no focus move | Both marked "Still open" in the July table | `admin/payroll.html:253` is `role="dialog" aria-modal="true" aria-labelledby=…`, and `:1359` closes it on Escape with focus moved in and restored. Closed. |
| **PY-11 / PY-12** — UTC off-by-one on period dates; `alert()` for errors | Listed open | The date formatting is corrected and commented at `admin/payroll.html:454`; there are **zero** `alert(` calls left in the file. Closed. |
| **`/media`'s usage scan** | *"still open … not a job a normal B-tree index can do"* under item 3 of Andrew's Call | It was inverted in the v4.24.0 backlog pass and the code says so at `tlc-admin-worker.js:4580`. One pass over the pages builds a filename map; a media row is one lookup. **This file states both — done in one section, open in another.** |
| **⌘K fires a query per keystroke with no debounce** | Same item 3 | `admin/ui.js:1421` debounces at 160ms, and the server side runs its ten scans through `Promise.all`. Closed (see SEC-14 for the one thing left). |
| **"Warning row above or below?" — the one question still open** | End of the mockup-match pass (v3.1.0) | Settled in v4.8.0 and shipped: `renderListSection` emits `${warnHtml}` **before** `<div class="tlc-row"` (`admin/ui.js:233`). The v3.1.0 paragraph is stale. |
| **AC-3** — `</script>` breakout in the rich field | Marked fixed, then superseded | Correct twice over: `jsString()` is gone and no stored content reaches a `<script>` at all. Worth keeping the superseded note; it is the only one in this file that reads clearly. |
| **B4** — KV-gate the startup migrations | Closed by measurement | Still true: `MARKERS_SEEN` means a warm request reads `_schema_version` zero times. See PERF-7 for what the *cold* path now costs, which has roughly doubled since that measurement. |

---

### Security

#### SEC-1 (High) — the classic rich-text fields are stored raw and rendered raw on the public site

`sanitizeRich()` exists, is a real allowlist, and is applied to **every** block
in the page editor. It is applied to **none** of the classic TinyMCE fields.

- The newsletter save path (`tlc-admin-worker.js:6742-6748`) runs exactly one
  transform over `pastor_note`, `secondary_note`, `wol_content`, `lasm_content`:
  `stripBlobImgs`, a regex that removes `<img src="blob:…">` and nothing else.
- News `body` (`:7920`, `:7963`), sermon notes, youth pages and ministry posts
  are stored with no transform at all — `form.get('body') || ''`.
- `grep sanitizeRich tlc-admin-worker.js` returns **nothing**.

Downstream, `public/index.html` renders those fields into `innerHTML`
deliberately, because they are meant to carry markup: `loadNewsletters()` at
`:2180` (`n.pastor_note`), `loadNewsletterDetail()` at `:2214`/`:2229`
(`secondary_note`, `wol_content`, `tertiary_note`), and the news renderers at
`:2060`/`:2140` (`item.body`).

So an account holding only `newsletter_edit` or `news_edit` — the narrowest
content permissions there are — can put script into a field that then executes
**on timothystl.org**, and in any admin session that opens the newsletter's
live preview. That is AW-2's cross-privilege escalation, with a concrete path,
and it is the single largest item in this review.

⚠ **The admin's own closed-state preview is safe** (`tinymceField()`,
`admin/helpers.js:1155`, runs `sanitizeRich`) — which is exactly what makes
this easy to miss: the place a developer looks is the one place that is
guarded. What is *stored* is unguarded, and storage is what the public site
reads.

⚠ The fix is not "escape it" — these fields legitimately hold markup. It is to
put the same `sanitizeRich()` on the write path that the block editor already
uses, and to accept that a body already in the database was never filtered.

#### SEC-2 (High) — `admin/email.js` escapes one field out of about a dozen

The July review raised this as AC-2 and the v3.11.0 pass added a local `esc()`
"as a step toward AC-2, not the whole sweep." The step is still one step:
`grep -c 'esc(' admin/email.js` finds it used **once**, on `n.title`.

Unescaped in `buildEmailHtml`, all staff-typed, all into ~600 inboxes and into
the archive the website reads:

| Field | Line | Context |
|---|---|---|
| `subject` | 218, 378 | element text |
| `e.event_name` / `e.event_time` / `e.event_desc` | 255-256 | element text |
| `mainNews.title` / `secondaryNews.title` / `item.title` | 278, 287, 337 | element text |
| `ctaUrl` / `tertiaryCtaUrl` | 193, 309 | **inside `href="…"`** |
| `ctaLabel` / `tertiaryCtaLabel` | 193, 309 | element text |

The two `href` cases are the ones that matter beyond mail clients: a typed URL
containing a double quote closes the attribute. The same values are served by
`/api/newsletter/:id` and interpolated into `innerHTML` by
`loadNewsletterDetail()` — `n.tertiary_cta_url` lands in an `href` at
`public/index.html:2231` with no escaping either.

⚠ The public renderer is **inconsistent with itself**, which is the useful
signal: `escText()` is applied to `mainNews.title` and `item.summary` in the
same function that interpolates `n.subject`, `e.event_name`, `c.topic`,
`c.leader` and `c.location` raw. Somebody escaped the fields they were looking
at.

⚠ `escText()` (`public/index.html:1979`) escapes `& < >` and **not quotes**, so
it is not safe for attribute context even where it is used. Fine for the text
nodes it currently guards; not a general-purpose helper.

#### SEC-3 (High) — the renter portal has no security headers at all

`portalHtml()` (`admin/gym.js:305-433`) returns `{ 'Content-Type': 'text/html;
charset=utf-8' }` and nothing else. No CSP, no `X-Frame-Options` /
`frame-ancestors`, no `X-Robots-Tag`, no `Cache-Control`, no `Referrer-Policy`.

This is the one page in this Worker that renders renter-supplied content and is
handed to people outside the church, and it is authenticated by a **bearer
token in the URL** (`/gym/book/:token`). Three consequences:

- **The token leaks by Referer.** The invoice view renders a Tithe.ly pay
  button as `<a href="${_payLink}" target="_blank">` with **no `rel="noopener
  noreferrer"`** (`admin/gym.js:577`). Clicking it hands
  `https://timothystl.org/gym/book/<token>` to Tithe.ly in the `Referer`
  header, and gives the opened page a live `window.opener`.
- **The token can be indexed.** `public/robots.txt` disallows `/manual`,
  `/voters` and `/how-to-give`; `/gym/` is not listed, and the page carries no
  `X-Robots-Tag`. A token URL pasted into anything crawlable becomes a search
  result.
- **The page is cacheable and framable.** No `Cache-Control` on a page showing
  one renter's booking history; no frame guard on a page with real POST
  actions.

The v4.6.0 move to the public origin was the right call and it closed the
same-origin-with-the-admin problem. It did not give the page headers of its
own.

#### SEC-4 (High) — the renter can still confirm their own bookings (GY-5, unchanged)

Three portal routes reachable with only the group token:
`sub === 'confirm'` (`admin/gym.js:1483`), `sub === 'confirm-hold'` (`:1533`),
`sub === 'confirm-slots'` (`:1801`). Each writes `status='confirmed'`,
generates an invoice, emails it and pushes the booking to Google Calendar —
bypassing the "holds only, the office reviews" policy the whole queue screen is
built around. The UI does not offer them; the routes answer.

#### SEC-5 (High) — `/request-slots` has neither a rate limit nor a hold cap (GY-4, unchanged)

`admin/gym.js:1702`. The single-slot `/hold` and `/confirm` paths both check
`max_active_holds` and a 5-per-24-hours limit. The batch path — the one the
portal calendar actually posts to — checks neither, and puts no ceiling on
`slots.length`.

⚠ **It is also a latency bug, not only an abuse one.** The validation loop runs
**two sequential D1 queries per submitted slot** (`:1725` blocked-date, `:1726`
conflict), awaited one at a time. A renter selecting a month of hourly slots
costs several hundred serial round-trips inside one request.

#### SEC-6 (Medium-High) — every push notification goes to every subscriber, whatever their permissions

`pushToAllSubscribers()` (`admin/webpush.js:167`) reads the whole
`push_subscriptions` table and sends to all of it. There is no permission
filter anywhere in the path.

`/api/push/subscribe` is gated on *having a session* and nothing more, so any
account can subscribe a device. What then arrives on that device:

- `New prayer request from <name>` with **the first 150 characters of the
  prayer request** (`tlc-admin-worker.js:3407`).
- `New message from <name>` with the first 150 characters of the contact
  message (`:3348`).
- `Christmas Market vendor application` — business name and amount.
- Gym holds, held mail, payroll readiness.

So the Market coordinator preset, which exists precisely so a volunteer sees
*only* the vendor list, receives prayer-request content on her phone the moment
she taps Notifications. So does the Bookkeeper. The push channel is the one
surface in this admin that does not participate in the permission model at all,
and the permission model is otherwise the most carefully argued thing in the
codebase.

`/api/push/unsubscribe` also deletes by `endpoint` with no ownership check —
any signed-in account can silence anybody's device given its endpoint.

#### SEC-7 (Medium) — `/api/newsletter/:id` serves unpublished drafts, and every column (AW-3, unchanged)

`tlc-admin-worker.js:3191`: `SELECT * FROM newsletters WHERE id = ?`, no status
filter, response is `{...row}`. The list endpoint two routes above it filters
`status='published'` correctly, so the leak is only reachable by guessing a
sequential id — which is the whole surface, since ids are sequential. A draft
under approval, and every internal column on it (`brevo_campaign_id`,
`approval_status`, `sent_count`), is public.

#### SEC-8 (Medium) — uploads need a session and no permission (AW-8, unchanged)

`/api/upload-image` (`:5895`) and `/api/upload-doc` (`:5936`) check nothing but
`currentUser`. Any account — Market coordinator, Bookkeeper, a ministry leader
scoped to one page — can host arbitrary images and PDFs on
`admin.timothystl.org` permanently. Nothing ever deletes an R2 object either;
the Media screen's own delete message says so in as many words.

#### SEC-9 (Medium) — login still enumerates usernames by timing, and rate-limits only by IP (AW-9 / AW-10, unchanged)

`tlc-admin-worker.js:4085`: when the username does not exist, `user` is null and
`verifyPassword` is never called, so the request skips 100,000 PBKDF2
iterations. That is tens of milliseconds — trivially measurable, and the
difference between "this account exists" and "it does not."

The rate limit (`:4073`) counts `audit_log` rows by IP only. Two side effects
worth knowing:

- Every failed login writes a permanent row into the accountability table,
  which has **no retention by design**. A distributed attempt grows it without
  bound and buries real entries.
- Per-username lockout does not exist, so credential-stuffing across rotating
  IPs is unthrottled.

#### SEC-10 (Medium) — password reset: plaintext tokens, no invalidation, no rate limit (AW-14, unchanged)

`tlc-admin-worker.js:3986-4040`. The token is 32 random bytes (good) stored as
plaintext in `password_resets` (bad — a read of that table is a working reset
for every pending request). Requesting a second reset does not invalidate the
first. `/forgot-password` has no rate limit, so it is an unmetered way to send
mail from the church's Brevo account to a known staff address and to write a
row per request.

Correct and worth keeping: the response is identical whether or not the address
exists, and every session is dropped on a successful reset.

#### SEC-11 (Medium) — the public forms are a metered email and push amplifier (AW-5, partly open)

The reflector half is fixed — a `suspect` submission gets no auto-reply, on
contact, prayer, market and event registration alike. What is not fixed:

- There is **no hard rate limit**. `recentFromIp` is a *scoring signal*
  (`admin/spam.js:227-230`): 8 submissions in an hour adds 6 points, which is
  exactly `HOLD_SCORE`. So the first eight from one address are delivered —
  each sending an office email, a confirmation email, a push to every staff
  phone and a ChMS forward — and everything after is *held*.
- **A held row is never pruned.** `delivered` is pruned at 30 days and
  `released` at 90; `held` waits for a human, by design. A bot that keeps going
  writes rows into D1 forever and rings every phone with "Filtered Mail" each
  time.
- From rotating addresses none of it applies at all.

Turnstile would answer this, and it is built, optional and **inert** —
`TURNSTILE_SECRET_KEY` has never been set (see the Form Spam Screening section
above). That is the highest-value unfinished configuration step on the site.

#### SEC-12 (Medium) — the event capacity check is the gym double-book race, in new code

`/api/events/register` reads
`SELECT COALESCE(SUM(qty),0) … WHERE event_id = ? AND payment_status != 'dropped' AND waitlisted = 0`,
calls `capacityDecision()`, then INSERTs — with nothing between the read and
the write. Two concurrent sign-ups for the last place both pass. It is
GY-1/AC-4 exactly, in a table that has no unique constraint that could express
the rule anyway (a cap is a sum, not a duplicate).

Low consequence today — no capped event is live — and worth writing down before
one is, because the shape is already known here and the fix is not a partial
index this time.

#### SEC-13 (Medium) — the admin shell can be framed (AW-18, unchanged)

`html()` (`admin/helpers.js:668`) sets a CSP with no `frame-ancestors`, and no
`X-Frame-Options` header. `frame-ancestors` does **not** inherit from
`default-src`, so every admin screen except the block editor (which sets its
own, correctly, at `tlc-admin-worker.js:235`) is frameable. With
`script-src 'unsafe-inline' 'unsafe-eval'` also still in place (AC-8), the CSP
is currently doing very little work on those pages.

#### SEC-14 (Low) — the payroll secret fingerprint is still in the response

`tlc-admin-worker.js:1386-1399` widens a Supabase 403 with
`` `${sv.length} chars, starts "${sv.slice(0,6)}", ends "${sv.slice(-6)}"` ``.
The reasoning at the time is sound and written down: a Worker secret is
write-only and the mismatch was otherwise undiagnosable. The mismatch is
resolved — `PAYROLL_PROXY_SECRET` is set and verified against the live project.
Twelve of sixty-four hex characters is not a practical break, but it is a
deliberate secret disclosure whose reason has expired.

#### SEC-15 (Low) — assorted, each a line

- **`/sb/*` is still an authenticated open relay** (AW-7). Any path under `/sb/`
  reaches Supabase with the caller's key. Much reduced now that `anon` holds no
  table grants, but the path allowlist the July review asked for was never
  added.
- **`/api/voters` and `/docs/*` are public** (AW-4). `robots.txt` disallows
  `/voters` on the *site*, which is not an access control, and the API and the
  PDFs themselves are on the admin origin and unlisted.
- **The Supabase anon JWT is committed** (`admin/payroll.html:313`, PY-4) with
  an `exp` in 2087. Public by design, but it is a credential in the repository
  with no rotation path written down.
- **The Square webhook and `/api/push/notify` read their whole body before the
  25MB size gate.** Both routes sit above the `content-length` check at
  `:1526` by necessity, so `request.text()` / `request.json()` runs first. The
  check itself is also a no-op for a chunked request, where the header is
  absent and `parseInt('' || '0')` is 0.
- **`safeUrl()` accepts `//evil.com`** (`admin/blocks.js:1301` treats any
  leading `/` as site-relative). A protocol-relative URL in a button block
  looks internal and is not.
- **`escText()` and the four hand-rolled partial escapes in `admin/gym.js`**
  (`:2889` escapes `& <`, `:4165` escapes `<`, `:4171` escapes `"`) each do
  enough for their own context and none is `escapeHtml`. `escapeHtml` exists,
  is imported there already, and is used 31 times in the same file.
- **The iCal feed is one global token over every group's bookings and notes**
  (GY-8, `admin/gym.js:1975`), compared with `!==` rather than in constant
  time, and its events carry no `TZID`/`VTIMEZONE` (GY-14).
- **`/api/market/apply`'s comment claims photos are read only after screening
  so "a bot cannot make this Worker buffer 40MB."** `await request.formData()`
  on the line above has already buffered every file. The claim is false; the
  25MB gate is what actually bounds it.

---

### Loading speed

#### PERF-1 (High) — 85KB of unminified CSS ships on every page load, twice

`BLOCK_CSS` is **85,033 bytes**, comment blocks and all. On a published page it
travels two ways on the same load:

1. The edge injects it inline into the HTML (`site-worker.js:600`, `blockCss =
   pageData.css`), and that HTML is served `no-cache`.
2. The client then calls `loadSitePages()` anyway — `tlcMaybeTakeOverSitePage`
   awaits it unconditionally at `public/index.html:3019`, even when
   `data-tlcb-edge` says the edge already rendered — and that JSON carries the
   same 85KB string again, because `buildNav`/`fillFooter`/`applyAppearance`
   need the rest of the payload.

The admin's own ~89KB of CSS/JS was moved to `/assets/admin.css` and
`/assets/admin.js`, `immutable`, cache-busted by `?v=VERSION` — the right fix,
already built, already understood in this repo. The public site's block
stylesheet never got it. It is a fixed string that changes only on deploy.

#### PERF-2 (High) — `/api/pages` sends every published page's HTML to render one

The response is `{ details, pages, menu, rendered, css, redirects }`, where
`rendered` is the full block markup of **every** published page
(`tlc-admin-worker.js:2866-2879`). A visitor who opens `/give` downloads
`/worship`, `/ministries`, `/news` and the rest.

Today that is cheap because most of the 28 pages are still unpublished drafts.
The whole plan recorded in `admin/BLOCK-EDITOR-ROLLOUT.md` is to publish them
all, and the payload grows monotonically as that happens. It is worth deciding
the shape now — per-page endpoints, or `rendered` keyed and fetched on demand —
rather than after the last Publish makes it a regression nobody can attribute.

#### PERF-3 (High) — the cache chokepoint misses most of what changes `/api/pages`

`tlc-admin-worker.js:1570` busts the edge copy on a POST under `/pages`,
`/menu`, `/partners` or `/values`, and its comment says it covers "any POST
that could change what /api/pages says."

It does not. `pageData()` — which every self-filling block reads — is also fed
by rows written from screens under **none** of those prefixes:

| Screen | Blocks it changes |
|---|---|
| `/staff/*` | Staff grid |
| `/giving*`, `/giving-tiers/*`, `/giving-funds/*` | Giving widget, Amount ladder |
| `/christian-education/*` | Bible classes |
| `/sermons*` | Sermon library, the homepage sermon card |
| `/newsitems*` | News feed, News highlights |
| `/market/settings`, `/market/fund` | Market facts, Market application |
| `/events/*` | Registration |

Each of those edits sits behind the edge copy for up to 120s, **plus** up to
300s in `site-worker.js`'s own per-isolate `pagesCache` — so up to about seven
minutes before a staff change is visible. That is precisely the shape of
complaint this repo keeps receiving ("I published it and still see the old
one"), and the invariant the comment claims is what would prevent it.

#### PERF-4 (Medium) — a publish can be invisible to a returning visitor

`site-worker.js` composes the HTML from `env.ASSETS.fetch(request)` and copies
its headers through `withAssetCaching()`. That includes the **ETag of the
static `index.html`**, which does not change when a page is published. HTML is
served `no-cache`, which means *revalidate*, not *do not store* — so a
returning browser sends `If-None-Match`, the asset is unchanged, and a 304 is
returned with the visitor's cached copy of the *previously composed* page,
carrying the old injected blocks.

⚠ **Not verified end to end from here** — it depends on exactly what
`env.ASSETS` returns for a conditional request and whether `isHtmlResponse()`
(`site-worker.js:390`, which tests only `content-type`) is even reached. It is
worth an actual check with `curl -H 'If-None-Match: …'` against production
before anything is changed. If it holds, the fix is to drop or weaken the ETag
on any response the rewriter has touched.

#### PERF-5 (Medium) — two newsletter archives, one of them an unbounded N+1

`/news` on the admin origin (`tlc-admin-worker.js:3216`) selects every published
newsletter with no `LIMIT`, then runs **one events query per row** in a `for`
loop. `/api/newsletters` twenty lines above solves the identical problem with
one query plus a group-by in JS — the fix exists in the file, and was not
applied to its neighbor. At a weekly letter this grows by 52 queries a year, on
a page with no cache header.

`/api/newsletters` itself also has no `LIMIT` and returns each letter's full
`pastor_note`. The v4.35.0 month-folding that makes this bearable lives in the
`newsletterarchive` *block*, so it does not apply to either of these.

#### PERF-6 (Medium) — the gym dashboard scans all history to count hours

`admin/gym.js:2043-2044` select `start_time, end_time` for **every** hold and
**every** confirmed booking ever taken, with no date bound, to compute two
totals. `:2041` joins all future confirmed bookings across three tables. They
run inside a `Promise.all` so the latency is not serial, but the rows are
unbounded and the table only grows.

#### PERF-7 (Medium) — the migration block is now ~400 serial statements in the request path

The schema block holds **192** direct `env.DB.prepare(...).run()` calls plus
several seed loops (`PARTNER_SEED`, `SITE_PAGES`, `MENU_SEED`,
`FOOTER_COLUMN_SEED`, the market pages), each awaited one at a time. The 411
figure recorded in the v4.24.0 note has grown.

Warm requests pay nothing — `MARKERS_SEEN` works, and that is genuinely solved.
But after a `SCHEMA_VERSION` bump **every isolate in every colo** that starts
before the marker is written runs the whole block before serving anything,
including a public `/api/pages` or an `/images/*` request. That is the "5–10s
slow but works" window, and it is longer than it was.

⚠ **AW-12 is the sharper version of this and is unchanged.** Every statement is
wrapped in `try { } catch (_) {}`, and the version marker is then written
unconditionally at `:2412`. A statement that fails is marked current and never
retried. This repo has already lost a column to exactly that
(`pages.owner_username`, v4.33.0, which showed up months later as one screen
mysteriously empty). The lesson was recorded; the mechanism that produced it
was not changed.

#### PERF-8 (Low) — the SPA is 267KB of HTML with 139KB of inline JS

`public/index.html` is 267,154 bytes, 64,213 gzipped, of which 139,530 bytes are
inline `<script>` across five blocks. Because it is inline it cannot be cached
separately from the HTML, and the HTML is `no-cache` and rewritten per request.

The "no build step" decision recorded under Pending / Deferred Items is sound
and this is not an argument to reverse it. But *extracting* the five script
blocks to `/app.js` is a file move, not a minifier — the same change the admin
already made — and it would move 139KB from the per-navigation path to a
cacheable one.

#### PERF-9 (Low) — assorted

- **The `/media` screen** reads `SELECT * FROM ministry_media` with no `LIMIT`
  and every page's draft **and** published blocks on each load. The scan is
  O(n) now (fixed — see the table above); the fetch is not bounded.
- **`/pages` is still O(n²)** — `parentName()` (`:8085`) does
  `ordered.find(...)` per row. ~900 comparisons at current size; a `Map` is one
  line.
- **The ⌘K search has no stale-response guard.** A slow earlier request can
  overwrite the results of a newer one (`admin/ui.js:1400-1406`).
- **`compatibility_date = "2024-01-01"`** on both `wrangler.toml` and
  `wrangler-site.toml`, eighteen months stale, pinning old runtime behavior for
  no stated reason.

---

### Correctness found while reading (not asked for, worth having)

#### COR-1 — the two "one shared rule" news queries do not agree

The comment above `NEWS_ORDER_SQL` (`tlc-admin-worker.js:2944`) says
"`NEWS_ORDER_SQL`/`NEWS_WHERE_SQL` below encode once so every consumer (this
route, `pageData()`'s self-filling blocks) agrees."

**`NEWS_WHERE_SQL` does not exist.** Only the ORDER BY was ever extracted. The
two WHERE clauses were written separately and have diverged:

| | `/api/news` (`:3016`) | `pageData()` (`:547`) |
|---|---|---|
| Date basis | `churchDate()` — church time | `date('now')` — **UTC** |
| `publish_date <= today` | yes | **absent** |
| `channels LIKE '%web%'` | yes | **absent** |
| Limit | 20 | 30 |

So a **post scheduled for a future date is already live on any block-rendered
page**, as is one the office marked email-only. And the v4.31.0 church-time pass
fixed `/api/news` and missed this one, so the two disagree for five to six hours
every evening about what has expired.

Five more UTC `date('now')` comparisons survive the same pass:
`tlc-admin-worker.js:4279`, `:4411`, `:4414`, and
`admin/gym.js:2045` — the last being
`strftime('%Y-%m', booking_date) = strftime('%Y-%m','now')`, which rolls the
"bookings this month" counter over at 7pm on the last evening of the month.

#### COR-2 — a British spelling has crept back in, and the documented grep over-matches

The rule and its grep are in **Design System → ⚠ American spellings
everywhere**. Running it as written today returns two lines:

- `test/admin-redesign.test.mjs:3493` — `behaviour`, a real regression, in a
  comment, which the rule explicitly covers.
- `admin/ministry-editor.html:1323` — `Optimistic`, a **false positive**: the
  pattern `optimis` matches the correctly-spelled American word. Worth
  tightening to `optimis[ae]` so the check keeps being run rather than being
  learned as noisy.

---

### Design consistency

#### DSN-1 — the design tokens are mostly decorative

`admin/ui.js` defines `PALETTE` (23 named colors) and `TONES` (five status
tones) and is described throughout this file as the place a color is decided.
In that same file:

- `PALETTE.` is referenced **8** times.
- `TONES.` is referenced **3** times.
- There are **60 distinct hardcoded six-digit hex values.**

The tokens are real and correct; the CSS beside them does not read from them,
so changing a token moves almost nothing. The drift is already visible:
`.tlc-warn` is `#FBF1DC` (`:903`) while `TONES.warn.bg` is `#FAF0DC` (`:65`) —
two ambers for one meaning, one of which was typed.

#### DSN-2 — emoji are still in the admin chrome

v3.7.0 recorded the rule as settled: *"The newspaper emoji is gone. 'No emoji
anywhere in the admin chrome' — the fallback icon is a typographic glyph like
every other one."* Still present in rendered admin UI:

| Where | Line |
|---|---|
| Dashboard task-card glyphs 🏀 📄 🛡️ 📰 | `tlc-admin-worker.js:4231, 4245, 4269, 4283` |
| "Nothing is waiting on you. 🎉" | `:4306` |
| ⌘K's search icon 🔍 | `:984` |
| The voters file list 📄 | `:5968` |
| The Brevo note 📊, twice | `:6597, :7376` |
| The share-text helper 📖 / 📣 | `:11847, :11863` |
| The gym portal's 🔒 and 📅 | `admin/gym.js:552, 567` |

📰 is the exact glyph the note says was removed. (The link-card `icon_emoji`
column is *content*, not chrome, and is correctly out of scope.)

#### DSN-3 — the sitemap is hand-maintained against a database-driven site

`public/sitemap.xml` is a static file listing 28 URLs. Pages have been rows in
the `pages` table since the site editor shipped, with `slug`, `status`,
`in_menu`, derived short links and rename 301s all managed in the admin. A page
created in the admin never enters the sitemap; a renamed one leaves a stale
entry that the merged redirect map will bounce. `/api/pages` already computes
everything a generated sitemap needs.

It also currently advertises `/youth`, `/sundayschool`, `/confirmation`,
`/vbs`, `/egghunt` and `/family` — the six pages this file records as still
awaiting content from the youth director.

#### DSN-4 — the rich-text story is two stories

There are two rich-text pipelines with different guarantees, different
allowlists and different failure modes: the block editor's (`sanitizeRich`,
`sanitizeCardRich`, `sanitizeLineRich`, enforced server-side on write) and the
classic forms' (nothing — SEC-1). They look identical on screen, because
`tinymceField()` builds both. That is the deepest consistency problem in the
admin, and it is a security finding as well as a design one.

#### DSN-5 — money is integer cents in the new code and floats in the old

`site_event_registrations` uses `amount_due_cents` / `amount_paid_cents`
(`admin/db.js:429-430`) and the market's pricing is integer throughout —
correct, and argued for explicitly in the v5.8.0 notes. `gym_invoices` still
declares `total_hours REAL, rate REAL, total_amount REAL` (`:568-570`). That is
AC-5/GY-7, and the v5.8.0 note already says "a defect being carried is not a
convention to copy." The two halves of the same admin now bill in two number
systems.

#### DSN-6 — small things

- **Duplicate indexes.** `idx_audit_created` and `idx_audit_log_created` both
  cover `audit_log(created_at…)`; `idx_news_items_publish_date` is a prefix of
  `idx_news_items_dates`. Two of the four are pure write cost.
- **`sections.js` ships a hardcoded weekday.** `dashboard.title` is
  `'Thursday morning'` (`admin/sections.js:19`). The screen builds its own
  greeting from `churchFormat()`/`partOfDay()` (`tlc-admin-worker.js:4471`) so
  nothing renders it — but it is a config value that would be wrong six days
  in seven if anything ever read it.
- **`/events/new` types its own title and purpose** (`admin/events.js:503-504`)
  where the list beside it reads `sectionCfg('events')`. Small, and exactly the
  drift `admin/sections.js` was created to stop.
- **Dead OPTIONS branches.** `/api/contact`, `/api/prayer`, `/api/market/apply`
  and `/api/events/register` each begin with
  `if (request.method === 'OPTIONS')` *inside* a block already guarded by
  `method === 'POST'`. Harmless — these are multipart posts and need no
  preflight — but it reads as CORS handling that is not there.

---

### What the suites say

Run on 2026-08-19 at `59bb645`:

- **All 23 `admin/*.test.mjs` suites pass.**
- `test/site-taps`, `test/site-edge-render`, `test/links-page`,
  `test/give-page`, `test/events-admin` — all pass.
- **`test/admin-redesign.test.mjs` fails: 1078 passed, 1 failed.**

The failure is `the request to Serve carries the shared X-Intake-Key —
expected "test-intake-key", got undefined`, in the Christmas Market five-tab
group. It is fallout from `e71a0af`, whose commit message begins **`wip:`** —
the volunteers fetch was changed to build a `Request` object and hand it to
`env.VOLUNTEER_WORKER.fetch(req)` (`admin/market.js:907-912`), so the suite's
stub, which reads headers off the `init` argument, sees none.

⚠ **This suite runs in CI on every pull request and every push to main**
(`.github/workflows/test.yml`), so the tree is red as it stands. The fix is
almost certainly the test rather than the code — the header is on the `Request`
— but it should be settled rather than left, because a suite that is known to
have one failure stops being read for the second one.

⚠ Also worth noting: `e71a0af` is a `wip:` commit merged into the trunk, and
the long comment it added at `admin/market.js:886` is a live debugging
narrative rather than a settled explanation. The `volError` branch below it
(`:919-928`) still captures and displays Serve's raw response body and
`cf-ray` — a diagnostic added for a specific investigation, on a screen the
market coordinator uses.

---

### If only three things are done

1. **SEC-1** — put `sanitizeRich()` on the classic rich-text write paths. It is
   one call in half a dozen route handlers, the function already exists and is
   already tested, and it closes the only path in this codebase from a
   low-privilege admin account to script running on the public website.
2. **Set `TURNSTILE_SECRET_KEY`** (SEC-11). No code to write. The screening,
   the site-key field and the widget are all built and have been inert since
   2026-07-31; it is the difference between a scoring heuristic and an actual
   gate on the forms that reach six hundred inboxes and every staff phone.
3. **PERF-1 + PERF-3** — serve `BLOCK_CSS` from a cacheable
   `/assets/blocks.css` the way the admin's own CSS already is, and widen the
   cache chokepoint to the seven prefixes that actually change `/api/pages`.
   One is 85KB off every page load; the other is the "I published it and still
   see the old one" complaint, which this file records three separate times
   under three different causes.

---

## Remediation plan — the fixes proposed by the 2026-08-19 review

Every finding above, turned into a piece of work with a **stable code** and a
**phase**. The code (`FX-nn`) never changes; the phase can be re-cut without
renumbering anything, which is the whole reason they are two different things.

**Phases are ordered by "what has to be true before the next one is worth
doing," not by severity.** Phase 1 is the set that needs no design decision and
no conversation — patches and one piece of configuration. Phase 5 and 6 need
Dinger's or Andrew's call on a policy, or a design of their own.

⚠ **Nothing in this plan has been done.** It is a plan. The one exception is
FX-01, which was applied in the same pull request that recorded this review,
because CI cannot report on any of the others until it is green.

| Phase | What it is | Codes |
|---|---|---|
| **0** | Green CI and honest docs — the floor everything else stands on | FX-01 … FX-03 |
| **1** | Close the exposures. Small, self-contained, no decisions | FX-04 … FX-12 |
| **2** | The escaping sweep — one theme, done once, properly | FX-13 … FX-16 |
| **3** | Loading speed — the wins that need no new design | FX-17 … FX-23 |
| **4** | Correctness the office would feel | FX-24 … FX-28 |
| **5** | Policy calls — needs a decision before code | FX-29 … FX-31 |
| **6** | Consistency and hygiene | FX-32 … FX-38 |
| **7** | Structural — each one its own project | FX-39 … FX-43 |

---

### Phase 0 — green CI and honest docs

**FX-01 · Fix the `X-Intake-Key` test stub** — *done in the review PR.*
`test/admin-redesign.test.mjs:3728` read the header off `init.headers`, but
`e71a0af` moved the Serve call onto a real `Request` handed to the
`VOLUNTEER_WORKER` binding, so `init` carries only the abort signal. The header
was always being sent. The stub now reads whichever argument carries it, and
still fails if the header is dropped from `admin/market.js` — verified in both
directions. Nothing else in CI can be trusted until this is green, because a
suite with one known failure stops being read for the second one.

**FX-02 · Retire the `wip:` volunteers diagnostic.** `e71a0af` is a `wip:`
commit on the trunk. The `volError` branch it left (`admin/market.js:919-928`)
still renders Serve's raw response body and `cf-ray` onto the coordinator's
screen — a live debugging aid for an investigation that is over. Decide whether
the service binding actually fixed the 404, then cut the diagnostic back to the
honest empty state the tab was designed around, and rewrite the comment above
it as a conclusion rather than a running narrative.

**FX-03 · Tighten the American-spelling grep, and fix the one real hit.**
`behaviour` is back at `test/admin-redesign.test.mjs:3493`. Separately, the
grep documented under **Design System** matches `optimis`, which flags the
correctly-spelled *optimistic* — a check that cries wolf is a check nobody
runs. Narrow it to `optimis[ae]` and re-run.

---

### Phase 1 — close the exposures

These are the ones where the shape of the fix is not in question.

**FX-04 · Sanitize the classic rich-text fields on write.** (`SEC-1`, the
largest item in the review.) `sanitizeRich()` already exists, is a real
allowlist and is already tested. Put it on the write path for `pastor_note`,
`secondary_note`, `wol_content`, `lasm_content`, `tertiary_note`, the extra
notes, news `body`, sermon notes, youth page content and ministry posts. Today
they get `stripBlobImgs` (`tlc-admin-worker.js:6742`) or nothing at all, and
`public/index.html` renders them into `innerHTML` by design.
⚠ Two things to hold in mind: the *stored* value is what the public site reads,
so the admin's already-sanitized closed-state preview is not the control; and
rows written before this exists were never filtered, so a one-time pass over
the existing bodies belongs in the same change.

**FX-05 · Set `TURNSTILE_SECRET_KEY`.** No code. The screening, the site-key
field and the widget have been built and inert since 2026-07-31. It is the
difference between a scoring heuristic and an actual gate on the forms that
reach six hundred inboxes and every staff phone. Highest value per unit of
effort on the whole list.

**FX-06 · Give the renter portal security headers.** `portalHtml()`
(`admin/gym.js:305`) returns a content type and nothing else. It needs a CSP,
`frame-ancestors 'none'`, `X-Robots-Tag: noindex`, `Cache-Control: no-store`
and `Referrer-Policy: no-referrer` — the last because the page is authenticated
by a **token in the URL** and the Tithe.ly pay button is `target="_blank"` with
no `rel="noopener noreferrer"` (`:577`), which hands that token to Tithe.ly in
the `Referer`. Add `Disallow: /gym/` to `public/robots.txt` in the same change.

**FX-07 · Filter `/api/newsletter/:id`.** (`AW-3`.) `tlc-admin-worker.js:3191`
is `SELECT *` with no status filter and returns `{...row}`. Add
`AND (status IS NULL OR status = 'published')` — the list endpoint twenty lines
above already does — and return a named column list rather than the whole row.

**FX-08 · Gate the uploads.** (`AW-8`.) `/api/upload-image` (`:5895`) and
`/api/upload-doc` (`:5936`) check only that a session exists. Require a
content-editing permission. While in there: nothing ever deletes an R2 object,
which the Media screen's own delete message admits.

**FX-09 · Remove the payroll secret fingerprint.** (`SEC-14`.)
`tlc-admin-worker.js:1386-1399` returns the length and the first and last six
characters of `PAYROLL_PROXY_SECRET` on a Supabase 403. The reasoning was good
and is recorded; the mismatch it existed to diagnose is resolved.

**FX-10 · `frame-ancestors` on the admin shell.** (`AW-18`.)
`admin/helpers.js:668` has no frame guard and no `X-Frame-Options`, and
`frame-ancestors` does **not** inherit from `default-src`. The block editor
already sets its own correctly (`tlc-admin-worker.js:235`) — copy that.
Consider dropping `'unsafe-eval'` at the same time and seeing what breaks.

**FX-11 · Allowlist the `/sb/*` paths.** (`AW-7`.) The proxy forwards any path
under `/sb/` to Supabase with the caller's key. Much reduced now that `anon`
holds no table grants, but the allowlist the July review asked for was never
added, and it is a short list: thirteen RPC names.

**FX-12 · Decide whether `/api/voters` and `/docs/*` are public.** (`AW-4`.)
`robots.txt` disallows `/voters` on the site, which is not an access control.
The API and the PDFs are unlisted addresses on the admin origin. Either gate
them or write down that they are deliberately public.

---

### Phase 2 — the escaping sweep

One theme. Doing it in pieces is how it stayed open for a year.

**FX-13 · Escape `admin/email.js`.** (`SEC-2`/`AC-2`.) `esc()` is used **once**,
on `n.title`. Unescaped: `subject` (218, 378), `e.event_name` / `e.event_time` /
`e.event_desc` (255-256), `mainNews.title` / `secondaryNews.title` /
`item.title` (278, 287, 337), and `ctaUrl` / `ctaLabel` /
`tertiaryCtaUrl` / `tertiaryCtaLabel` (193, 309). The two URL cases sit **inside
`href="…"`**, so a typed double quote closes the attribute.

**FX-14 · Escape the public newsletter renderer.** `public/index.html`'s
`loadNewsletters()` and `loadNewsletterDetail()` apply `escText()` to some
fields and not their neighbors — `n.subject`, `e.event_name`, `e.event_time`,
`e.event_desc`, `c.topic`, `c.leader`, `c.location` and `n.tertiary_cta_url`
(into an `href`, `:2231`) all go in raw. ⚠ Note the rich bodies are *meant* to
carry markup; those are FX-04's problem, not this one.

**FX-15 · Make `escText()` attribute-safe, or stop using it near attributes.**
`public/index.html:1979` escapes `& < >` and not quotes.

**FX-16 · Replace the hand-rolled partial escapes in `admin/gym.js`.** `:2889`
escapes `& <`, `:4165` escapes `<`, `:4171` escapes `"`. Each does enough for
its own context and none is `escapeHtml` — which is imported into that file and
used 31 times already. Include the one genuine miss: `:1775`, where the
renter's own `notes` reach the office's HTML email unescaped while the renter's
copy of the same string two lines below is escaped. That is the fourth site of
`GY-2`, missed when the other three were fixed.

---

### Phase 3 — loading speed

**FX-17 · Serve the block stylesheet as a cacheable asset.** (`PERF-1`.)
`BLOCK_CSS` is **85,033 bytes** of unminified, comment-carrying CSS. On a
published page it ships **twice**: inline at the edge (`site-worker.js:600`,
into HTML served `no-cache`) and again inside the `/api/pages` JSON. The admin's
own ~89KB went to `/assets/admin.css`, `immutable`, cache-busted by
`?v=VERSION`. Do the same, and stop sending `css` in the JSON.

**FX-18 · Stop the client re-fetching what the edge already delivered.**
`tlcMaybeTakeOverSitePage()` awaits `loadSitePages()` unconditionally
(`public/index.html:3019`) even when `data-tlcb-edge` says the markup is
already there — because `buildNav`/`fillFooter`/`applyAppearance` need the rest
of the payload. Split the chrome from the rendered pages so the second fetch is
small, or have the edge inline the chrome record it already reads.

**FX-19 · Widen the `/api/pages` cache chokepoint.** (`PERF-3`.)
`tlc-admin-worker.js:1570` busts on `/pages`, `/menu`, `/partners`, `/values`
and its comment claims it covers "any POST that could change what /api/pages
says." It misses `/staff/*`, `/giving*`, `/christian-education/*`, `/sermons*`,
`/newsitems*`, `/market/settings`, `/market/fund` and `/events/*` — all of
which feed `pageData()`. Up to 120s of edge cache plus up to 300s of
`site-worker.js`'s own isolate cache is about seven minutes before a staff edit
shows. **This is the "I published it and still see the old one" complaint,
which this file records three times under three different causes.**

**FX-20 · Check the ETag on rewritten HTML.** (`PERF-4`.) `site-worker.js`
copies `env.ASSETS`'s headers — including the ETag of the *unrewritten*
`index.html` — onto a body it has composed per page. If a conditional request
can win against that, a publish is invisible to a returning visitor until
`index.html` itself changes. ⚠ **Not verified from this sandbox.** Confirm with
`curl -H 'If-None-Match: …'` against production first; if it holds, drop or
weaken the ETag on anything the rewriter touched.

**FX-21 · Fix the `/news` archive N+1 and bound the newsletter endpoints.**
(`PERF-5`.) `tlc-admin-worker.js:3216` selects every published newsletter with
no `LIMIT`, then runs one events query per row in a `for` loop. The fix is
twenty lines above it: `/api/newsletters` does the same job with one query and
a group-by. Add a `LIMIT` to both, and note that neither carries the v4.35.0
month-folding, which lives in the `newsletterarchive` *block*.

**FX-22 · Bound the gym dashboard scans.** (`PERF-6`.) `admin/gym.js:2043-2044`
read `start_time, end_time` for **every** hold and **every** confirmed booking
ever taken, with no date bound, to produce two totals.

**FX-23 · Batch `/request-slots`' validation.** (`SEC-5`, speed half.) The loop
at `admin/gym.js:1725-1726` runs two sequential D1 queries **per submitted
slot**. A month of hourly selections is several hundred serial round-trips
inside one request. One query for the blocked dates in range and one for the
conflicting bookings in range would replace all of it.

---

### Phase 4 — correctness the office would feel

**FX-24 · Write `NEWS_WHERE_SQL` and actually share it.** (`COR-1`, the sharpest
correctness bug found.) The comment at `tlc-admin-worker.js:2944` says
`NEWS_ORDER_SQL`/`NEWS_WHERE_SQL` "encode once so every consumer agrees."
**`NEWS_WHERE_SQL` does not exist.** The two queries diverged:

| | `/api/news` (`:3016`) | `pageData()` (`:547`) |
|---|---|---|
| Date basis | `churchDate()` | `date('now')` — **UTC** |
| `publish_date <= today` | yes | **absent** |
| `channels LIKE '%web%'` | yes | **absent** |

So **a post scheduled for a future date is already live on any block-rendered
page**, as is one the office marked email-only.

**FX-25 · Finish the church-time pass.** Five UTC `date('now')` comparisons
survived v4.31.0: `tlc-admin-worker.js:547`, `:548`, `:4279`, `:4411`, `:4414`,
plus `admin/gym.js:2045` —
`strftime('%Y-%m', booking_date) = strftime('%Y-%m','now')`, which rolls the
"bookings this month" counter over at 7pm on the last evening of the month.
⚠ The rule from `admin/when.js` still holds: church time for a date somebody
reads or picks, UTC for an instant.

**FX-26 · Close the event capacity race.** (`SEC-12`.) `/api/events/register`
reads `SUM(qty)`, decides, then INSERTs, with nothing in between — GY-1's shape
in new code. No capped event is live yet, which is exactly why now is the
cheapest time. ⚠ A partial unique index cannot express this one: a cap is a
sum, not a duplicate.

**FX-27 · Close the remaining gym slot overlap.** (`GY-1` residue.) The partial
unique index catches an exact duplicate slot; 1–3pm against 2–4pm is a range
comparison and still races through the SELECT-then-INSERT.

**FX-28 · Make AW-12 impossible.** (`PERF-7`.) Every statement in the ~400-call
migration block is wrapped in `try { } catch (_) {}` and the version marker is
then written **unconditionally** (`tlc-admin-worker.js:2412`). A statement that
fails is marked current and never retried. This repo has already lost a column
to exactly that — `pages.owner_username`, v4.33.0, which surfaced months later
as one screen mysteriously empty. Track failures and refuse to stamp the marker
when any occurred.

---

### Phase 5 — policy calls, decide before coding

**FX-29 · Scope push notifications by permission.** (`SEC-6`.)
`pushToAllSubscribers()` (`admin/webpush.js:167`) reads the whole table and
sends to all of it. Any account with a session can subscribe. So the Market
coordinator preset — which exists precisely so a volunteer sees only the vendor
list — receives **prayer-request content** (150 characters, per
`tlc-admin-worker.js:3407`) and contact-message bodies on her phone. The push
channel is the one surface here that does not participate in the permission
model, and that model is the most carefully argued thing in the codebase.
⚠ Also add an ownership check to `/api/push/unsubscribe`, which today deletes
any endpoint given to it.
**The decision:** which permission gates which trigger, and whether a push
should carry message content at all or only "something arrived."

**FX-30 · Decide the fate of the renter self-confirm routes.** (`SEC-4`/`GY-5`.)
`admin/gym.js:1483`, `:1533` and `:1801` let a renter holding only the group
token confirm their own booking, generate an invoice, email it and push to
Google Calendar — around the office review the whole queue screen exists for.
The UI does not offer them; the routes answer. **The decision is Dinger's:**
is self-confirm a feature that lost its buttons, or a policy that lost its
enforcement?

**FX-31 · Rate-limit the public forms, and cap held-row growth.** (`SEC-11`.)
`recentFromIp` is a scoring signal, not a limit: the first eight submissions an
hour from one address are delivered — each an office email, a confirmation
email, a push to every phone and a ChMS forward — and everything after is
*held* and **never pruned**. From rotating addresses none of it applies. FX-05
answers most of this; what needs deciding is the hard ceiling and what happens
to a held row that is a year old, given that "held mail waits for a human" is
a deliberate rule.

---

### Phase 6 — consistency and hygiene

**FX-32 · Bound the Media screen's reads.** `SELECT * FROM ministry_media` with
no `LIMIT`, plus every page's draft and published blocks, on every load. ⚠ The
*scan* is already O(n) and correct — do not "fix" that again.

**FX-33 · Drop the duplicate indexes.** `idx_audit_created` and
`idx_audit_log_created` both cover `audit_log(created_at…)`;
`idx_news_items_publish_date` is a prefix of `idx_news_items_dates`. Two of the
four are pure write cost.

**FX-34 · Guard the ⌘K search against out-of-order responses.**
`admin/ui.js:1400-1406` — a slow earlier request can overwrite a newer one. The
debounce is already there.

**FX-35 · `parentName()` is O(n²).** `tlc-admin-worker.js:8085` does
`ordered.find(...)` per row. A `Map` is one line. Trivial today; free to fix.

**FX-36 · Finish the payroll accessibility pass.** PY-7 and PY-8 are closed;
**PY-14** (no `aria-live` on the saved/error flash) and **PY-15** (`<th>`
without `scope="col"`, muted `#7A6E5A` at ~11px near the contrast floor) were
not part of it.

**FX-37 · Take the emoji back out of the admin chrome.** (`DSN-2`.) v3.7.0
recorded the rule as settled and 📰 is still at `tlc-admin-worker.js:4283`,
along with 🏀 📄 🛡️ (`:4231`, `:4245`, `:4269`), 🎉 (`:4306`), 🔍 (`:984`),
📄 (`:5968`), 📊 (`:6597`, `:7376`), 📖 📣 (`:11847`, `:11863`) and 🔒 📅
(`admin/gym.js:552`, `:567`). ⚠ The link-card `icon_emoji` column is *content*
on the links page, not chrome — leave it.

**FX-38 · Small consistency debts.** `sections.js:19` ships
`title: 'Thursday morning'`, a hardcoded weekday nothing currently renders;
`/events/new` types its own title and purpose (`admin/events.js:503-504`) where
the list beside it reads `sectionCfg`; four public POST routes begin with a
dead `if (request.method === 'OPTIONS')` inside a block already guarded on
`POST`; `compatibility_date` is `2024-01-01` on both Workers.

---

### Phase 7 — structural, each its own project

**FX-39 · Reshape the `/api/pages` payload.** (`PERF-2`.) `rendered` carries the
full block markup of **every** published page, so a visitor opening `/give`
downloads `/worship`, `/ministries` and the rest. It is cheap today only
because most of the 28 pages are still unpublished drafts — and the whole plan
in `admin/BLOCK-EDITOR-ROLLOUT.md` is to publish them. Decide the shape *before*
the last Publish turns it into a regression nobody can attribute.

**FX-40 · Move the migrations out of the request path.** (`PERF-7`.) 192 direct
statements plus several seed loops, all awaited serially. Warm requests pay
nothing — `MARKERS_SEEN` genuinely works — but after a `SCHEMA_VERSION` bump
every fresh isolate in every colo runs the whole block before serving anything,
including a public `/api/pages` or an `/images/*`.

**FX-41 · Extract the SPA's inline JavaScript.** (`PERF-8`.)
`public/index.html` is 267,154 bytes (64,213 gzipped), of which **139,530** are
inline `<script>` across five blocks — uncacheable separately from HTML that is
`no-cache` and rewritten per request. ⚠ This is a **file move, not a
minifier**: the "no build step" decision under *Pending / Deferred Items* is
sound and this does not reverse it. It is the same change the admin already
made.

**FX-42 · Make the design tokens load-bearing.** (`DSN-1`.) `admin/ui.js`
references `PALETTE.` **8** times and `TONES.` **3**, against **60 distinct
hardcoded hex values** in the same file. The drift is already visible:
`.tlc-warn` is `#FBF1DC` (`:903`) while `TONES.warn.bg` is `#FAF0DC` (`:65`) —
two ambers for one meaning, one of them typed.

**FX-43 · Generate the sitemap.** (`DSN-3`.) `public/sitemap.xml` is a static
28-URL file, while pages have been rows in the `pages` table since the site
editor shipped, with slugs, statuses, derived short links and rename 301s all
managed in the admin. A page created in the admin never enters it; a renamed
one leaves a stale entry. `/api/pages` already computes everything a generated
sitemap needs. ⚠ It currently advertises the six youth pages this file records
as still awaiting content.

---

### If only three things happen

**FX-04**, **FX-05**, and **FX-17 + FX-19** — in that order. The first closes
the only path from a low-privilege admin account to script running on the
church's public website. The second is a Worker secret and no code at all. The
third takes 85KB off every page load and ends the complaint this file has now
explained three separate times.
