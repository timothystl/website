# Architecture

Production has three Cloudflare Workers:

- `timothystl-site` (`site-worker.js` plus `public/`) serves the public site and giving landing.
- `tlc-newsletter-admin` (`tlc-admin-worker.js`) serves Website Admin, binds D1
  `tlc-newsletter-db`, R2 `tlc-news-images`, and service binding `VOLUNTEER_WORKER` to `tlc-chms`,
  and runs scheduled-page promotion every 15 minutes.
- `tlc-links` (`tlc-links-worker.js`) serves the utility links surface.

Published page blocks are authoritative. The Site Worker edge-renders initial page bodies; client
navigation uses the same published-block model. `/api/pages?chrome=1` returns global chrome and
`/api/pages?id=<pageId>` returns one page body when needed.

Website Admin forwards bounded contact/prayer and Market operations to Connect. Failed forward
copies use a durable outbox and the recovery procedure in `CHMS_FORWARD_RECOVERY.md`. The public
Site Worker has no direct Connect binding.

## Routing style — one thing to know before reading `tlc-admin-worker.js`

Unlike `chms`'s per-domain handler-function dispatch, `tlc-admin-worker.js` (~13,600 lines) is a
single flat request handler: routes are matched inline as `if (path === '...' && method === '...')`
blocks in one long chain, in the same file, with the actual logic factored out into the `admin/*.js`
modules it imports from at the top. There is no central route table or permission-gate array to
scan first — the permission check for each route is a `hasPermission(user, '...')` call written
directly at that route's own `if` block. When tracing a route, search for its exact path string in
`tlc-admin-worker.js` first, then follow the import to the module that actually does the work.

## Module map (`admin/*.js`)

Most of these were extracted out of what used to be one enormous `tlc-admin-worker.js`; several
headers still say "Extracted from tlc-admin-worker.js" for that reason. Every module here has a
substantial header comment explaining *why* it works the way it does — read the file itself for
that; this table is only for finding the right one.

| File | Owns |
|---|---|
| `auth.js` | Sessions, password hashing, the `PERMISSIONS` map (one checkbox per capability — see below), audit logging. |
| `db.js` | D1 constants and initial/seed data. |
| `helpers.js` | Shared HTML shell, self-hosted TinyMCE wiring, login/setup/password-reset pages, the admin service worker. |
| `ui.js` | The one shared "list section" UI pattern every admin screen (Pages, Events, Market, etc.) is built from. |
| `pages.js` / `blocks.js` | Page-tree logic and the single shared block renderer every ministry page is built from — both pure functions over plain rows, no D1/Request. |
| `page-seeds.js` / `site-pages.js` | **Generated** by `tools/extract-pages.mjs` — do not hand-edit. |
| `menu.js` | Navigation — `menu_items` as a join table over `pages`, kept separate on purpose. |
| `sections.js` | Section/column/filter config lifted from the design handoff prototype. |
| `appearance.js` | Site chrome: header bar and the newsletter band above the footer. |
| `newsletter.js` | The weekly ~600-recipient newsletter — the one action in this admin that can't be taken back, so its send/approval rules live here. |
| `calendar.js` | The Church Calendar feed: merges two Google Calendars with News & Events into one de-duplicated shape. |
| `events.js` | The generalized Events system the Christmas Market grew into. |
| `intake.js` / `intake-page.js` | Event Intake — the office's own triage queue over every Google booking, News post, and confirmed gym rental. |
| `market.js` / `market-page-seed.js` / `market-vendors-apply-seed.js` | The Christmas Market vendor application (replaced a Google Form + spreadsheet). |
| `square.js` | Square checkout links per vendor, and the webhook that confirms payment. |
| `gym.js` | Gym rental booking and its route handler (large — 5,300+ lines). |
| `forms.js` | Public contact/prayer/subscribe intake: screening, storage, the Filtered Mail review page. |
| `spam.js` | Pure spam-screening functions for the public forms — no D1, no fetch. |
| `exif.js` | Strips EXIF (including GPS) from staff-uploaded photos. |
| `email.js` | Transactional and Brevo newsletter email sending. |
| `webpush.js` | Web Push (VAPID/RFC 8291), built directly on WebCrypto — no `web-push` npm package (it needs Node's `crypto`, which Workers doesn't have). |
| `sermons-feed.js` | The latest worship service video. |
| `values.js` | The four core values, shared across several public/admin surfaces. |
| `links.js` | Validates/resolves every URL field used by the block editor. |
| `taps.js` | NFC tap counting for the four physical tags. |
| `audit.js` | The audit log — diffs, not before/after blobs, are the useful part of an entry. |
| `payroll-contract-auth.js` | Lets Finance's separate app reach this Worker's payroll relay **as a real, specific admin**, not as an anonymous trusted server — see "Cross-product contracts" below. |
| `payroll-report.js` | Builds the emailed payroll report (CSV + PDF) from the exact same figures the payroll screen and its own CSV/print already use — "one report shape, N destinations." |
| `pdf.js` | A minimal dependency-free PDF writer (Workers has no headless browser to render one). |
| `give-landing-seed.js` / `redesign-seeds.js` / `native-form-page-seed.js` / `school-calendar-seed.js` | Hand-authored page/block seeds for surfaces the generic extractor has no model for (a live spam-screened form, a hand-tuned redesign page, etc). |
| `when.js` | Church-local (Central time) date/day-part helpers — the Worker itself always runs in UTC. |

`admin/vendor/tinymce/` is the self-hosted editor — see "Editor constraint" below.

## Permission model

Unlike Connect's role presets, Website Admin is **per-user checkbox permissions**: `PERMISSIONS`
in `admin/auth.js` is a flat map of capability keys (`payroll_manage`, `giving_manage`,
`pages_edit`, `market_manage`, etc.) to plain-language labels, and `hasPermission(user, key)` is
called individually at each gated route. There is no role hierarchy to reason about — a user
simply holds some subset of these keys — but it also means **there is no single list to scan** for
what a route requires; check that route's own `if` block. Some keys are deliberately narrow rather
than folded into a broader one (`market_manage` instead of sharing `giving_manage`; `intake_manage`
instead of sharing `news_edit`/`gym_manage`) specifically so a volunteer or ministry leader can be
granted exactly one capability's worth of access to sensitive data (home addresses, phone numbers,
renter/payment detail) and nothing more.

## Cross-product contracts

Two real integration points reach outside this repo, both worth knowing before touching either:

1. **Website → Connect (`chms`), the forward outbox.** Contact/prayer form submissions and Market
   operations get forwarded to Connect via the `VOLUNTEER_WORKER` service binding
   (`forwardToChms`/`retryChmsForwards` in `admin/forms.js`). A failed forward is retried through a
   durable outbox rather than lost — see `docs/CHMS_FORWARD_RECOVERY.md` for the recovery
   procedure. The public Site Worker has no direct Connect binding at all; only Website Admin does.
2. **Finance (`chms`'s `apps/finance/*`) → Website, the payroll relay.** Finance runs its own
   separate app and has no payroll data of its own — every payroll figure it shows is relayed live
   from this repo's existing payroll system (`admin/payroll.html`'s screen, its `/sb/*` Supabase
   proxy, and `/payroll/email`) and never stored in Finance. Finance authenticates each relayed
   call with a shared `X-Contract-Key` (proving the call came from Finance's Worker) *plus* a
   forwarded `Cf-Access-Jwt-Assertion` (proving which real admin is acting — this Worker
   independently re-verifies that JWT against Cloudflare Access's own published keys, it does not
   trust whatever Finance forwards). `admin/payroll-contract-auth.js`'s
   `resolvePayrollContractCaller` is the one place that resolves "who is this contract call really
   from," reused by both the `/sb/*` RPC relay and `/payroll/email`. `admin/payroll-report.js`
   builds the CSV/PDF from the exact same report-shaped object the live screen and its own
   CSV/print export already use, so the three can never silently disagree.

## Editor constraint

TinyMCE is self-hosted from `admin/vendor/tinymce/`; the cloud subscription has lapsed. Never add
a TinyMCE Cloud API key, cloud script, paid editor load, or CDN dependency. After any editor or
vendor-asset change, run the TinyMCE asset tests and the self-hosted browser boot test
(`test/tinymce-selfhost.test.mjs`).
