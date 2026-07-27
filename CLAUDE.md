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
| page-news | /news | Exists — fetches live from admin API + newsletter archive |
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
| Newsletter | Pastor/office | **DONE** — format picker, Brevo email, draft/published split |
| News & Events | Pastor/office | **DONE** — DB wired, API live at /api/news |
| Ministries | Office staff | **DONE** — ministry page content management; also now covers Youth Pages (TinyMCE editor, youth_pages DB table) and the Voters Assembly special page (Zoom link + file upload), both folded in as cards rather than separate tabs |
| Sermons | Pastor/office | **DONE** — sermon series + standalone sermon notes, powers /sermons |
| Christian Ed | Pastor/office | **DONE** — Bible class schedule (`bible_classes` table), powers /education |
| Notices | Office staff | **DONE** — self-serve banner notices per static page (renamed from "Pages") |
| Links | Office staff | **DONE** — manages link cards shown at links.timothystl.org (`link_cards` table) |
| Staff | Office staff | **DONE** — staff directory (photos, bios, emails) shown on /about |
| Gym Rentals | Office staff (Dinger) | **DONE** — full rental management at /gym-rentals |
| Users | Admins | **DONE** — user accounts + per-tab permission checkboxes |
| Subscribers | Office staff | **DONE** — newsletter subscriber list |
| Redirects | Office staff | **DONE** — admin-managed URL redirects + Zoom/council-files links (renamed from "Settings"; gym rate config lives under Gym Rentals, giving-related links moved to the new Giving tab) |
| Giving | Office staff — requires `giving_manage` permission | **DONE** (2026-07-27) — base Tithe.ly link, give.timothystl.org's amount tiers + per-tier links, and vendor/market one-off payment links (Tithe.ly or Square); see below |
| Payroll | Office staff (Dinger) — requires `payroll_manage` permission | **DONE** — combined biweekly payroll (church staff + MDO preschool staff); see "Payroll & Supabase" below |
| Audit Log | Admins | **DONE** — change history + rollback, requires `audit_view` |
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
that MDO clock/PTO data (read-only) with two new tables of its own — also in
the same Supabase project, not D1 — `church_staff` and
`church_staff_period_entries` (name, pay type, hourly rate or salary, housing
allowance, HSA, 403(b), mileage, PTO) — to produce one combined biweekly
payroll report (MDO + church staff) with CSV export.

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

### Access Control
- Staff admin password: full access (all tabs) — permissions are granted per-account, per-tab via the Users tab's checkboxes (see `PERMISSIONS` in `admin/auth.js`)
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
- **links.timothystl.org "Volunteer" card still points at the old host** — the live `link_cards` D1 row (managed via the Links tab) was seeded long before this rebrand and still has `https://volunteer.timothystl.org` as its URL; the code-level seed constant was updated but that only affects a table that's empty on first run, not an already-populated one. Needs a manual edit via the Links tab: update the URL to `https://serve.timothystl.org` (and optionally rename the title to "Serve").
- **`/confirmation`, `/sundayschool`, `/vbs`, `/egghunt`, `/family`** — Youth sub-pages. Admin portal has the youth_pages table, but these slugs need content entered by the youth director.
- **Christmas Market annual content** — Page structure is built. Needs dates, description, photos, and Google Form link for vendors entered via the admin Ministries tab each year.
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
| VS-2 | Critical | Scheduler | `scheduler.html` is served **unauthenticated** at `timothystl.org/scheduler.html` — anyone can open the staff tool |
| GY-1 | Critical | Gym | [B1] Booking double-book race: SELECT-then-INSERT, no unique constraint/transaction |
| GY-2 | Critical | Gym | Stored XSS via renter-controlled `notes` rendered unescaped in admin review page + staff emails |
| AW-1 | High | Admin worker | Unhandled exceptions leak full stack traces to **unauthenticated** clients |
| AW-2 | High | Admin worker | Stored XSS in admin UI via unescaped DB content → cross-privilege escalation (low-perm editor → admin) |
| AC-1 | High | Core | Session cookie missing `Secure` flag (`auth.js`) |
| AC-2 | High | Core | Email templates interpolate titles/subjects/URLs into broadcast HTML with **no** escaping (`email.js`) |
| AC-3 | High | Core | `</script>` in saved editor content breaks out of the inline TinyMCE init block (`helpers.js`) |
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
- **AC-10** (Medium, maint) — ~500 lines of 6 near-identical TinyMCE builders (helpers.js 397-865) — any escaping fix (AC-3) must be applied 6×. Extract one parameterized builder.
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

