// ── CONSTANTS & INITIAL DATA ─────────────────────────────────
// Extracted from tlc-admin-worker.js

// TinyMCE rich-text editor — loaded only on the screens that carry an editor.
//
// Self-hosted out of admin/vendor/tinymce/ (served by the /assets/tinymce/
// route in tlc-admin-worker.js), not cdn.tiny.cloud. The cloud build is
// metered: Tiny counts an "editor load" per editor and bills overage past the
// monthly limit, and this admin spends them fast — the page editor creates one
// inline editor per rich field, and a page carries tens of them. Self-hosting
// is free (TinyMCE 7 is GPL v2+), needs no account or API key, and is what the
// ChMS app next door has done since its v1.64.0.
//
// The version query string is TinyMCE's own, not the app's: this file changes
// only when TinyMCE is upgraded, so it can be cached immutably across deploys.
//
// ⚠ The version is in the PATH as well as the query, and that is load-bearing.
// TinyMCE fetches its own theme, model, icons, skin and plugins from `base_url`
// WITHOUT the query string, and the /assets/tinymce/ route serves everything
// `immutable` for a year. With an unversioned base_url an upgrade would bust
// tinymce.min.js and leave every browser running a year-old theme and model
// against the new core — a broken editor that no reload fixes. Versioning the
// path means an upgrade changes every URL at once.
export const TINYMCE_VERSION = '7.9.3';
export const TINYMCE_BASE = `/assets/tinymce/${TINYMCE_VERSION}`;

// ⚠ NOTHING IS INITIALIZED AT PAGE LOAD, and self-hosting is not a reason to go
// back to that. Metering is gone, but the work is not: the newsletter composer
// carries nine rich fields and the page editor creates one per rich field —
// fourteen on /ministries — and REBUILDS THEM ALL on every add, delete,
// reorder, alignment click and undo. That is what put 614 editor loads through
// the old cloud account in two days, and as an eager `tinymce.init` it is still
// fourteen editors torn down and rebuilt every time somebody nudges a block.
//
// So `_onTinymce(fn)` fetches the library on FIRST DEMAND and queues callers
// until it lands. An editor is created only when somebody puts the caret in a
// field — see RICH_FIELD_JS in admin/helpers.js and openRichField in
// admin/ministry-editor.html, the only two places that call `tinymce.init`.
//
// ⚠ It must stay tolerant of the script never arriving. Every caller re-checks
// `window.tinymce` inside the callback, because on an `onerror` the queue is
// drained anyway and the field falls back to a plain textarea that still types
// and still saves. A rich field that eats what was written is far worse than
// one with no toolbar — and that failure got MORE likely with self-hosting, not
// less, since /assets/tinymce/ proxies raw.githubusercontent.com.
export const TINYMCE_HEAD = `<script>
window._tinyQ = [];
window._onTinymce = function (fn) {
  if (window.tinymce || window._tinyFailed) { fn(); return; }
  window._tinyQ.push(fn);
  if (window._tinyLoading) return;
  window._tinyLoading = true;
  var s = document.createElement('script');
  s.src = '${TINYMCE_BASE}/tinymce.min.js';
  s.onload = function () { var q = window._tinyQ; window._tinyQ = []; q.forEach(function (f) { f(); }); };
  s.onerror = function () { window._tinyFailed = true; var q = window._tinyQ; window._tinyQ = []; q.forEach(function (f) { f(); }); };
  document.head.appendChild(s);
};
<\/script>`;

// ⚠ EVERY PLUGIN NAMED IN AN INIT CONFIG MUST EXIST IN admin/vendor/tinymce/.
// This is the union of what the two configs ask for — the classic fields use
// image/link/lists/table/code, the page editor's inline fields the narrower
// lists/link/autolink — and `admin/tinymce-assets.test.mjs` checks both configs
// against this list and this list against the folder, so neither drifts alone.
// `blockquote` sat in the classic list for months and is not a TinyMCE plugin
// at all; against the cloud it was a silent 404, and it is exactly the kind of
// thing that only a test notices.
export const TINYMCE_PLUGINS = ['image', 'link', 'lists', 'table', 'code', 'autolink'];

// ── DB INIT ─────────────────────────────────────────────────
export const DB_INIT_NEWSLETTERS = `CREATE TABLE IF NOT EXISTS newsletters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  pastor_note TEXT,
  ministry_content TEXT,
  ministry_type TEXT DEFAULT 'text',
  events TEXT,
  published_at TEXT NOT NULL,
  beehiiv_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

// ── EVENT INTAKE ──────────────────────────────────────────────
// The office's own checklist over everything with a date on it — see
// admin/intake.js for the types, the fixed checklists and the merge rules.
// One row per real-world booking, keyed on `source_key` in the SAME id space
// admin/calendar.js's own g:/n:/b: ids already use, so a row here can be
// matched straight to a normalized Google/News/gym event with no second
// lookup. `source_key` is NULL only for a `local` row (source_kind='local',
// entered here with nowhere else to defer to) — its own `id` is its identity.
//
// ⚠ THIS IS PURELY INTERNAL BOOKKEEPING. Nothing in this table gates what
// appears on the public calendar; a Google event with every checklist item
// still open renders on /calendar exactly as it always has. The one
// exception is a `local` row's own title_/event_date_/event_time columns,
// which ARE read onto the public calendar (see readLocalIntakeEvents() in
// admin/calendar.js) — because a `local` row is the only one with no other
// path to the calendar at all.
export const DB_INIT_EVENT_INTAKE = `CREATE TABLE IF NOT EXISTS event_intake (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind   TEXT NOT NULL,           -- 'gcal' | 'news' | 'gym' | 'local'
  source_key    TEXT UNIQUE,             -- 'g:<id>' | 'n:<id>' | 'b:<id>'; NULL for 'local'
  event_type    TEXT,                    -- 'worship' | 'education' | 'rental' | 'news' | NULL
  room          TEXT,
  extra_json    TEXT,
  checks_json   TEXT,
  -- The row's own record of when it happens, refreshed on every sync for
  -- EVERY source kind (not only 'local') — purely so a cheap DB-only query
  -- (the sidebar badge) can bound itself to "upcoming, roughly" without
  -- re-fetching Google on every page load. The live screen never trusts this
  -- column; it always recomputes from the real source. See badgeCounts() in
  -- tlc-admin-worker.js.
  event_date    TEXT,
  -- Only ever set for source_kind='local' — a room booking with no Google
  -- event and no News post behind it, typed in directly.
  local_title      TEXT,
  local_event_date TEXT,
  local_end_date   TEXT,
  local_event_time TEXT,
  local_end_time   TEXT,
  published_at  TEXT,
  published_by  TEXT,
  updated_at    TEXT DEFAULT (datetime('now')),
  updated_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
)`;

export const DB_INIT_EVENTS = `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  newsletter_id INTEGER,
  event_date TEXT,
  event_name TEXT,
  event_time TEXT,
  event_desc TEXT,
  sort_order INTEGER DEFAULT 0
)`;

export const DB_INIT_NEWS_ITEMS = `CREATE TABLE IF NOT EXISTS news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT,
  image_url TEXT,
  publish_date TEXT,
  expire_date TEXT,
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`;

export const DB_INIT_YOUTH_PAGES = `CREATE TABLE IF NOT EXISTS youth_pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  has_posts INTEGER DEFAULT 0,
  updated_at TEXT
)`;

export const DB_INIT_MINISTRY_POSTS = `CREATE TABLE IF NOT EXISTS ministry_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ministry_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  post_date TEXT,
  body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

// Media library backing the ministry page editor's photo/video picker. Photos
// live in R2 (same bucket as every other admin upload); a "video" row is just a
// YouTube URL plus a cached thumbnail, so both kinds fit one table.
export const DB_INIT_MINISTRY_MEDIA = `CREATE TABLE IF NOT EXISTS ministry_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'photo',
  url TEXT NOT NULL,
  thumb_url TEXT,
  alt TEXT,
  meta TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

// One snapshot per publish, so a page can be rolled back. Restoring loads the
// snapshot into the *draft* — never straight to live — so staff review first.
export const DB_INIT_MINISTRY_REVISIONS = `CREATE TABLE IF NOT EXISTS ministry_page_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  blocks TEXT NOT NULL,
  published_at TEXT,
  published_by TEXT
)`;

// Reusable block groups. The office saves a bit they use on several ministry
// pages ("Contact the office") once and drops it in from the palette after.
export const DB_INIT_MINISTRY_SECTIONS = `CREATE TABLE IF NOT EXISTS ministry_saved_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  blocks TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

// ── THE MDO SAVED SECTION ────────────────────────────────────────────────────
// The Mother's Day Out strip, as a section the office can drop onto any page
// from the palette's Saved group. It is the homepage band word for word —
// eyebrow, headline, the paragraph, and the one button out to mdo.timothystl.org
// — because MDO is the church's most-repeated ask and retyping it on every page
// is how three pages end up describing the same preschool three ways.
//
// Two blocks rather than one: a callout carries the words, a button bar carries
// the link. That is what the homepage strip is, and it means the office can
// keep the copy and re-point the button, or the reverse, without either one
// being welded to the other.
//
// ⚠ MDO is a SEPARATE SITE (mdo.timothystl.org), so the button is an absolute
// address and always opens there. It is not a page in this admin and must not
// be turned into one.
export const MDO_SECTION_SEED = {
  name: "Mother's Day Out",
  blocks: [
    {
      type: 'callout',
      eyebrow: "Mother's Day Out",
      title: 'Now enrolling — join our community',
      body: '<p>Over twenty years of experienced, caring childcare for children from birth through preschool. Right here in Lindenwood Park.</p>',
      spaceAbove: 24, spaceBelow: 8,
    },
    {
      type: 'buttons',
      spaceAbove: 0, spaceBelow: 24,
      items: [{ title: 'Learn about MDO', url: 'https://mdo.timothystl.org' }],
    },
  ],
};

export const DB_INIT_VOTERS_PAGE = `CREATE TABLE IF NOT EXISTS voters_page (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_info TEXT,
  zoom_link TEXT,
  files_json TEXT DEFAULT '[]',
  updated_at TEXT
)`;

export const DB_INIT_SERMON_SERIES = `CREATE TABLE IF NOT EXISTS sermon_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  date_range TEXT,
  playlist_url TEXT,
  active INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`;

export const DB_INIT_PAGE_CONTENT = `CREATE TABLE IF NOT EXISTS page_content (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value TEXT,
  published INTEGER DEFAULT 1,
  updated_at TEXT
)`;

// Self-serve notices — any number of banners per static page, added by staff
// without a developer wiring a new slot. Replaces the old one-row-per-key
// page_content system for static-page banners (page_content is retained only
// for the ministry-page "community-concert" block, which lives on a
// dynamic ministry page, not a static one).
export const DB_INIT_NOTICES = `CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_slug TEXT NOT NULL,
  label TEXT NOT NULL,
  body TEXT,
  published INTEGER DEFAULT 1,
  position INTEGER DEFAULT 0,
  updated_at TEXT
)`;

export const DB_INIT_STAFF_MEMBERS = `CREATE TABLE IF NOT EXISTS staff_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  photo_url TEXT,
  bio TEXT,
  display_order INTEGER DEFAULT 0
)`;

export const DB_INIT_SITE_SETTINGS = `CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  label TEXT,
  hint TEXT
)`;

// Everything that comes through the public contact / prayer / subscribe forms,
// with the spam score that decided its fate. `status='held'` is the review
// queue at /filtered — nothing the filter catches is ever thrown away, it just
// waits there for a human. 'delivered' rows are the rate-limit ledger and are
// pruned after 30 days (see pruneSubmissions in admin/forms.js), so this table
// never turns into a second, unguarded copy of everyone's prayer requests.
export const DB_INIT_FORM_SUBMISSIONS = `CREATE TABLE IF NOT EXISTS form_submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  name        TEXT,
  email       TEXT,
  message     TEXT,
  ip          TEXT,
  user_agent  TEXT,
  score       INTEGER NOT NULL DEFAULT 0,
  reasons     TEXT,
  status      TEXT NOT NULL DEFAULT 'held',
  created_at  TEXT DEFAULT (datetime('now')),
  released_at TEXT,
  released_by TEXT
)`;

// ── CHRISTMAS MARKET VENDOR APPLICATIONS ─────────────────────
// One row per application, replacing the Google Form + spreadsheet the market
// ran on through 2024. The first block is what the vendor typed; the second is
// what the coordinator keeps — the columns Marla maintained by hand, which is
// the half a Google Form never had anywhere to put.
//
// ⚠ MONEY IS INTEGER CENTS HERE, not REAL. `gym_invoices` stores floats and
// that is exactly what AC-5 / GY-7 in the July 2026 review are about: a
// subtotal summed from unrounded floats can disagree with the rows printed
// above it. That is a defect being carried, not a convention to copy.
//
// ⚠ `amount_paid_cents` is NULLABLE and NULL means "nobody has checked yet",
// which is a different fact from "they paid nothing". A default of 0 would put
// every fresh application on the reconciled side of the ledger.
//
// ⚠ There is no `paid` boolean. `payment_status` has four states because the
// market really has four — a fee waived for Timothy MDO or the Word of Life
// 8th grade is not "unpaid", and a vendor who dropped out is not either.
export const DB_INIT_MARKET_VENDORS = `CREATE TABLE IF NOT EXISTS market_vendors (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_names   TEXT NOT NULL,
  business_name       TEXT,
  website_or_social   TEXT,
  returning_vendor    TEXT,
  email               TEXT NOT NULL,
  phone               TEXT,
  street              TEXT,
  city                TEXT,
  state               TEXT,
  zip                 TEXT,
  product_description TEXT,
  sells_food          INTEGER NOT NULL DEFAULT 0,
  appliances_power    TEXT,
  special_requests    TEXT,
  tables              INTEGER NOT NULL DEFAULT 1,
  photos              TEXT,
  signature_name      TEXT,
  amount_due_cents    INTEGER NOT NULL DEFAULT 0,
  table_number        TEXT,
  payment_status      TEXT NOT NULL DEFAULT 'unpaid',
  amount_paid_cents   INTEGER,
  staff_notes         TEXT,
  created_at          TEXT DEFAULT (datetime('now'))
)`;

// The list sorts unpaid-first and then by arrival, and the badge counts unpaid.
// Both are the whole table on a market with seventy vendors, but the index is
// what keeps the badge — which is computed on every admin request — from being
// a scan once the second and third years' rows are sitting in there too.
export const DB_INIT_MARKET_VENDORS_INDEX =
  `CREATE INDEX IF NOT EXISTS idx_market_vendors_status ON market_vendors (payment_status, created_at)`;

// ── EVENTS, GENERALIZED FROM THE CHRISTMAS MARKET ────────────────────────────
// The Christmas Market was the first event this admin ran end to end —
// registration, payment, volunteers, photos, its own pages. `site_events` is
// that shape made general, so a second event (VBS, the Egg Hunt, a concert)
// needs a row, not a deploy.
//
// ⚠ NAMED `site_events`, NOT `events`. `events` already exists (DB_INIT_EVENTS
// above) and means something else entirely — one row per date/time printed
// inside a single newsletter issue, keyed to `newsletter_id`. Reusing that name
// here would have silently unioned two unrelated tables the moment a migration
// ran; `site_events` reads alongside `site_settings` and `site_appearance`,
// which is the same "site-wide record" register this belongs in.
//
// Every column here is either read verbatim by a capability flag (has_*) or
// falls back to a sane default when the flag is off — a raffle-free sign-up
// page has no business carrying a fee_amount, and nothing reads one unless
// has_payment is set.
export const DB_INIT_SITE_EVENTS = `CREATE TABLE IF NOT EXISTS site_events (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft',
  date_label              TEXT,
  hours_label             TEXT,
  coordinator_email       TEXT,
  -- The permission key that gates this event's Registrations/Volunteers/Photos
  -- tabs — 'market_manage' for the migrated Christmas Market, verbatim; a
  -- freshly generated 'event_<id>_manage' for every event created afterward.
  -- See admin/events.js's eventCoordinatorPermissionKey().
  coordinator_permission  TEXT NOT NULL DEFAULT '',
  has_registration        INTEGER NOT NULL DEFAULT 0,
  has_payment             INTEGER NOT NULL DEFAULT 0,
  has_volunteers          INTEGER NOT NULL DEFAULT 0,
  has_photos              INTEGER NOT NULL DEFAULT 0,
  -- Money, in the same shape market-price.js has always taken: dollars in
  -- (fee_amount, fee_fixed), a percentage (fee_percent), cents out.
  fee_amount              REAL,
  fee_percent             REAL,
  fee_fixed               REAL,
  max_qty                 INTEGER,
  fund_id                 TEXT,
  payment_provider        TEXT NOT NULL DEFAULT 'tithely',
  square_links            TEXT,
  registration_open       INTEGER NOT NULL DEFAULT 1,
  registration_cap        INTEGER,
  waitlist_enabled        INTEGER NOT NULL DEFAULT 0,
  -- Passed to GET /api/signups/<slug>/summary on Serve. NULL means this event
  -- has no roster there yet — the Volunteers tab says so rather than guessing.
  volunteer_slug          TEXT,
  photo_folder            TEXT,
  page_landing_id         TEXT,
  page_registration_id    TEXT,
  -- 'market' for the one event whose public form is the bespoke three-step
  -- marketapp block rather than the generic event_fields-driven one. Every
  -- event created from here on is NULL — see admin/events.js.
  legacy_kind             TEXT,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  archived_at             TEXT,
  created_at              TEXT DEFAULT (datetime('now')),
  updated_at              TEXT,
  updated_by              TEXT
)`;

// One field per row so a coordinator can add, remove, reorder or reword what
// a registration asks for with no developer — the same reasoning the market's
// own nine agreement clauses were given as an item list rather than a fixed
// form. `sensitive` is the whole reason this is a separate table rather than
// a JSON blob on `site_events`: a field has to be flagged sensitive (medical
// notes, an allergy, a pickup name) BEFORE the first registration is ever
// read back, or there is no reliable line between "shown to the coordinator
// only" and "shown wherever a registration's other fields are shown".
export const DB_INIT_SITE_EVENT_FIELDS = `CREATE TABLE IF NOT EXISTS site_event_fields (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT NOT NULL,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'text',
  options      TEXT,
  required     INTEGER NOT NULL DEFAULT 0,
  sensitive    INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  placeholder  TEXT,
  hint         TEXT
)`;
export const DB_INIT_SITE_EVENT_FIELDS_INDEX =
  `CREATE INDEX IF NOT EXISTS idx_site_event_fields_event ON site_event_fields (event_id, sort_order)`;

// One row per participant/family/vendor who has signed up for an event.
//
// ⚠ `fields_json` HOLDS EVERY NON-SENSITIVE FIELD, `sensitive_json` HOLDS
// EVERY SENSITIVE ONE, AND THAT SPLIT IS THE WHOLE POINT OF TWO COLUMNS
// RATHER THAN ONE. A CSV export, a search index, or a generic "show this
// registration" view can read `fields_json` and never even touch
// `sensitive_json` — the allergy a parent typed in cannot leak into a
// screen or an export that was never built with it in mind, because it is
// not in the column that screen reads.
//
// `qty`/`payment_status`/`amount_due_cents`/`amount_paid_cents`/
// `table_number`/`staff_notes` are the Christmas Market's own vendor columns,
// generalized — a vendor's table count is a registration's `qty`, a table
// number is a `table_number` any event can use for a seat/spot assignment.
export const DB_INIT_SITE_EVENT_REGISTRATIONS = `CREATE TABLE IF NOT EXISTS site_event_registrations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id           TEXT NOT NULL,
  qty                INTEGER NOT NULL DEFAULT 1,
  payment_status     TEXT NOT NULL DEFAULT 'unpaid',
  amount_due_cents   INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents  INTEGER,
  waitlisted         INTEGER NOT NULL DEFAULT 0,
  contact_name       TEXT,
  contact_email      TEXT,
  contact_phone      TEXT,
  table_number       TEXT,
  fields_json        TEXT NOT NULL DEFAULT '{}',
  sensitive_json      TEXT,
  staff_notes        TEXT,
  created_at         TEXT DEFAULT (datetime('now'))
)`;
export const DB_INIT_SITE_EVENT_REGISTRATIONS_INDEX =
  `CREATE INDEX IF NOT EXISTS idx_site_event_registrations_event ON site_event_registrations (event_id, payment_status, created_at)`;

// The eleven `market_*` figures the Christmas Market used to keep in
// `site_settings`, kept here ONLY as the fallback a one-time migration reads
// when a fresh install has never seeded them at all (INITIAL_SETTINGS below
// no longer carries them — see the note there). Not read anywhere else.
export const MARKET_LEGACY_SETTINGS_DEFAULTS = {
  market_table_fee: '30',
  market_fee_percent: '2.9',
  market_fee_fixed: '0.30',
  market_max_tables: '3',
  market_fund_id: '',
  market_coordinator_email: 'tlc.christmasmarket@gmail.com',
  market_date_label: 'Saturday, Dec 5',
  market_hours_label: '11:00 am – 6:00 pm',
  market_applications_open: '1',
  market_payment_provider: 'tithely',
  market_square_links: '{}',
};
export const MARKET_LEGACY_SETTINGS_KEYS = Object.keys(MARKET_LEGACY_SETTINGS_DEFAULTS);

// One row per browser/device a staff member has said yes to notifications on
// — not per user, since the same person can enable it on a desktop and a
// phone and both should ring. `endpoint` (the push service URL the browser
// handed back) is the natural unique key: it already IS the address a
// message is sent to, and a second subscribe from the same browser (e.g.
// after clearing cookies) reuses it rather than double-sending.
export const DB_INIT_PUSH_SUBSCRIPTIONS = `CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
)`;

// A period's "ready to approve" push has to fire exactly once, ever — not
// once per browser. Payroll hours live in Supabase, which this Worker holds
// no server-side credentials for, so admin/payroll.html (which already
// computes readiness to draw the status pill) is the one that notices and
// asks for the push — and since two different staff members' browsers could
// each notice the same period turning ready around the same time, the INSERT
// here (not a client-side flag) is what makes only the first one actually
// send it.
export const DB_INIT_PAYROLL_READY_NOTIFIED = `CREATE TABLE IF NOT EXISTS payroll_ready_notified (
  period_start TEXT PRIMARY KEY,
  notified_at  TEXT DEFAULT (datetime('now'))
)`;

// One row per push notification actually SENT, whatever triggered it — held
// mail, a delivered contact/prayer message, a gym request, payroll turning
// ready, a market application, an event sign-up, a newsletter awaiting
// approval, the ChMS/scheduler relay, or an office broadcast. Every one of
// those already funnels through the single pushToAllSubscribers() chokepoint
// in admin/webpush.js, which is what lets this be logged in ONE place rather
// than at each of the dozen call sites — a call site that forgot to log would
// otherwise be a notification nobody could ever trace back to what it was
// about. Written best-effort from inside that function: a logging failure
// must never turn into a lost push, so it is wrapped the same way every write
// in that path already is.
export const DB_INIT_PUSH_LOG = `CREATE TABLE IF NOT EXISTS push_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  audience   TEXT NOT NULL,
  tag        TEXT,
  title      TEXT NOT NULL,
  body       TEXT,
  url        TEXT,
  sent       INTEGER NOT NULL,
  gone       INTEGER NOT NULL,
  total      INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`;

// ── GYM RENTAL DB TABLES ─────────────────────────────────────
export const DB_INIT_GYM_GROUPS = `CREATE TABLE IF NOT EXISTS gym_groups (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  contact          TEXT,
  email            TEXT,
  phone            TEXT,
  notes            TEXT,
  access_token     TEXT UNIQUE,
  max_active_holds INTEGER DEFAULT 3,
  active           INTEGER DEFAULT 1,
  created_at       TEXT DEFAULT (datetime('now'))
)`;

// ── THE CALENDAR'S CATEGORIES ────────────────────────────────
// One row per category the public calendar knows about. Seeded from
// DEFAULT_CATEGORIES in admin/calendar.js so the day this screen appears
// nothing on the site moves.
//
// ⚠ THE COLOR IS A PALETTE KEY, NOT A HEX. A category's color is the ink of
// the time and the tint behind it on every chip; a free hex is one paste away
// from a month nobody can read. See CALENDAR_PALETTE.
//
// ⚠ `color_id` IS UNIQUE where it is set, because two categories claiming
// Blueberry is a question with no answer. Enforced by the index below rather
// than by the form alone, so a stale tab cannot get past it.
export const DB_INIT_CALENDAR_CATEGORIES = `CREATE TABLE IF NOT EXISTS calendar_categories (
  key         TEXT PRIMARY KEY,
  name        TEXT,
  color_id    TEXT,
  palette     TEXT,
  sort_order  INTEGER DEFAULT 0,
  active      INTEGER DEFAULT 1,
  updated_at  TEXT
)`;
export const DB_INIT_CALENDAR_CATEGORIES_COLOR = `CREATE UNIQUE INDEX IF NOT EXISTS idx_calcat_color
  ON calendar_categories (color_id) WHERE color_id IS NOT NULL AND color_id <> ''`;

export const DB_INIT_GYM_BOOKINGS = `CREATE TABLE IF NOT EXISTS gym_bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id         INTEGER NOT NULL,
  booking_date     TEXT NOT NULL,
  start_time       TEXT NOT NULL,
  end_time         TEXT NOT NULL,
  recurrence_id    INTEGER,
  status           TEXT DEFAULT 'confirmed',
  hold_expires_at  TEXT,
  notes            TEXT,
  created_by       TEXT DEFAULT 'admin',
  created_at       TEXT DEFAULT (datetime('now'))
)`;

// ── [B1] THE SLOT LOCK ───────────────────────────────────────
// The booking flow checks for a clash with a SELECT and then INSERTs, with
// nothing between them: two people submitting the same slot at the same moment
// both pass the check and the gym is double-booked. Andrew's rule is simply
// "once it is booked it should be locked out", so the database enforces it —
// the only place that can, because it is the one thing both requests share.
//
// ⚠ PARTIAL, on the active statuses only. A released or expired booking is
// history and must not reserve the slot forever — the whole point of releasing
// a hold is that somebody else can take it.
//
// ⚠ This catches an EXACT duplicate slot, which is the race that actually
// happens (two people clicking the same button). It cannot express *overlap* —
// 1–3pm against 2–4pm — because a unique index compares values, not ranges.
// The SELECT check in admin/gym.js still does that, and still has the race it
// always had for partial overlaps. This narrows the hole to the common case
// rather than closing it completely, and saying so here is the point.
export const DB_INIT_GYM_BOOKING_SLOT_INDEX = `CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_bookings_slot
  ON gym_bookings(booking_date, start_time, end_time)
  WHERE status IN ('confirmed','hold')`;

export const DB_INIT_GYM_RECURRENCES = `CREATE TABLE IF NOT EXISTS gym_recurrences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER NOT NULL,
  day_of_week  INTEGER NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  status       TEXT DEFAULT 'pending_review',
  notes        TEXT,
  created_by   TEXT DEFAULT 'admin',
  created_at   TEXT DEFAULT (datetime('now'))
)`;

export const DB_INIT_GYM_BLOCKED = `CREATE TABLE IF NOT EXISTS gym_blocked_dates (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  date    TEXT NOT NULL UNIQUE,
  reason  TEXT
)`;

export const DB_INIT_GYM_INVOICES = `CREATE TABLE IF NOT EXISTS gym_invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL,
  recurrence_id INTEGER,
  booking_id    INTEGER,
  invoice_date  TEXT NOT NULL,
  period_start  TEXT,
  period_end    TEXT,
  total_hours   REAL,
  rate          REAL,
  total_amount  REAL,
  notes         TEXT,
  status        TEXT DEFAULT 'unpaid',
  created_at    TEXT DEFAULT (datetime('now'))
)`;

export const DB_INIT_SERMON_NOTES = `CREATE TABLE IF NOT EXISTS sermon_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER,
  date TEXT,
  title TEXT NOT NULL,
  scripture TEXT,
  outline TEXT,
  youtube_url TEXT,
  audio_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

export const DB_INIT_SUBSCRIBERS = `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT DEFAULT 'website',
  subscribed_at TEXT DEFAULT (datetime('now'))
)`;

export const DB_INIT_USERS = `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_login TEXT,
  active INTEGER NOT NULL DEFAULT 1
)`;

export const DB_INIT_PASSWORD_RESETS = `CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)`;

export const DB_INIT_SESSIONS = `CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  permissions TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

// user_id is nullable on purpose: logAudit binds null for anything the system
// did on its own — a scheduled page going live, a hold lapsing — and those are
// exactly the entries somebody later wants to find. It was NOT NULL until
// 2026-08-01, which meant every such INSERT threw and was silently swallowed.
export const DB_INIT_AUDIT_LOG = `CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  entity_label TEXT,
  before_state TEXT,
  after_state TEXT,
  created_at TEXT NOT NULL
)`;

// ── SITE PAGES ───────────────────────────────────────────────────────────────
// Every page on the site is a row here. `blocks` is the working draft, and
// `published_blocks` is what visitors see; a page whose `published_blocks` is
// NULL still renders from its hardcoded markup in public/index.html, which is
// what makes converting the site page by page safe.
export const DB_INIT_PAGES = `CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  menu_label TEXT,
  slug TEXT NOT NULL UNIQUE,
  parent_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  template TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'published',
  in_menu INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  seo_description TEXT,
  owner_username TEXT,
  external_url TEXT,
  aside_top INTEGER NOT NULL DEFAULT 0,
  blocks TEXT,
  published_blocks TEXT,
  publish_at TEXT,
  change_log TEXT,
  updated_at TEXT,
  updated_by TEXT
)`;

// Renaming a page regenerates its address; the old one is kept here and 301s to
// the new one, so a volunteer renaming "VBS" cannot break an inbound link. Named
// page_redirects because `redirects` already holds the admin's own short links.
export const DB_INIT_PAGE_REDIRECTS = `CREATE TABLE IF NOT EXISTS page_redirects (
  from_slug TEXT PRIMARY KEY,
  to_slug TEXT NOT NULL,
  created_at TEXT
)`;

export const DB_INIT_PAGE_REVISIONS = `CREATE TABLE IF NOT EXISTS page_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL,
  blocks TEXT,
  note TEXT,
  created_at TEXT,
  created_by TEXT
)`;

export const THEMES = ['Acceptance', 'Christian Education', 'Outreach', 'Worship'];
export const CONTENT_TYPES = ['Testimonial / Quote', 'Story', 'Explainer', 'Event Promo', 'Factoid / Trivia'];

export const MINISTRY_SLUGS = [
  { slug: 'youth',          title: 'Youth',                  has_posts: 1 },
  { slug: 'sundayschool',   title: 'Sunday School',          has_posts: 0 },
  { slug: 'confirmation',   title: 'Confirmation',           has_posts: 0 },
  { slug: 'vbs',            title: 'Vacation Bible School',  has_posts: 0 },
  { slug: 'egghunt',        title: 'Egg Hunt',               has_posts: 0 },
  { slug: 'family',         title: 'Family Ministry',        has_posts: 0 },
  { slug: 'music',          title: 'Music Ministry',         has_posts: 0 },
  { slug: 'stephen',        title: 'Stephen Ministry',       has_posts: 0 },
  { slug: 'foodpantry',     title: 'Food Pantry',            has_posts: 0 },
  { slug: 'bees',           title: 'Urban Beekeepers',       has_posts: 0 },
  { slug: 'christmasmarket',title: 'Christmas Market',       has_posts: 1 },
];

export const INITIAL_STAFF = [
  { name: 'Andrew Dinger',  title: 'Lead Pastor',                          email: 'dinger@timothystl.org',    photo_url: '/images/staff/dinger.webp',    bio: `Andrew Dinger has spent his life following the gospel into unexpected places — from social work in Washington, D.C. working among the homeless and ex-offenders community, to teaching English in Taiwan with LCMS World Mission. He served 12 years in parish ministry in NJ, serving in broad areas from District service to leadership of the FAITH Center for the Arts. He came to Timothy Lutheran in 2018.\n\nAndrew holds a Master's in Philanthropic Studies from IUPUI and has a deep interest in the intersection of the church and civil society — how the body of Christ shows up not just on Sunday mornings, but in neighborhoods, schools, and the margins of public life. He's an unashamed lover of the lost, a student of Scripture, and a preacher who believes the gospel is still, as Paul said, "the power of God for salvation to everyone who believes."\n\nHe and his wife are raising three boys and are grateful to call St. Louis home.`, display_order: 10 },
  { name: 'Matt Gerzevske', title: 'Assistant Pastor',                      email: 'pastormatt@timothystl.org', photo_url: '/images/staff/matt.webp',      bio: '', display_order: 20 },
  { name: 'Mark Thompson',  title: 'Director of Christian Education',       email: 'dce@timothystl.org',        photo_url: '/images/staff/thompson.webp',  bio: '', display_order: 30 },
  { name: 'Dr. Jinah Knapp',title: 'Music Director',                        email: 'jinah@timothystl.org',      photo_url: '/images/staff/jinah.webp',     bio: `Dr. Jinah Yoo Knapp grew up in Seoul, South Korea, where she studied at the prestigious Seoul Arts High School. She completed studies in church music and organ at Yonsei University, and received the doctorate in organ from the University of Iowa.\n\nJinah served as professor of organ, organ literature, and the history of church music at Keimyung University and later at Yonsei University. As a competitor, she won honors at the Albert Schweitzer Organ Competition, the John D. Rodland Church Music Competition, and the St. Moritz (Switzerland) International Organ Competition. She has performed widely in Korea and the USA, and regularly performs in Germany.\n\nFrom an early age, Jinah served as a church musician, directing ensembles and choirs. She has served as organist and directed ensembles in Iowa and South Korea.`, display_order: 40 },
  { name: 'Ron Rall',       title: 'Pastor Emeritus',                       email: 'pastorrall@timothystl.org', photo_url: '/images/staff/rall.webp',      bio: '', display_order: 50 },
  { name: 'Chau Vo',        title: 'Pastor to the Vietnamese Community',    email: '',                          photo_url: '',                            bio: '', display_order: 60 },
  { name: 'James Vo',       title: 'Office Assistant',                      email: 'office@timothystl.org',     photo_url: '',                            bio: '', display_order: 70 },
  { name: 'Noah',           title: 'Comfort Dog',                           email: 'noah@timothystl.org',       photo_url: '/images/staff/noah.webp',      bio: '', display_order: 80 },
];

export const INITIAL_SETTINGS = [
  { key: 'zoom_url',          value: 'https://us02web.zoom.us/j/3147818673',                                                                   label: 'Zoom meeting URL',      hint: 'Used for the /zoom redirect. Update when the Zoom link changes.' },
  { key: 'councilfiles_url',  value: 'https://drive.google.com/drive/folders/1pgqJ32H3HS7SNYnnf7rOswC5c87IAzA4?usp=drive_link',              label: 'Council files URL',     hint: 'Used for the /councilfiles redirect. Update when the Google Drive folder changes.' },
  // The weekly worship service on /sermons. A handle is what somebody would
  // paste; the Worker resolves it to a channel ID once and writes the ID back
  // here, because the Atom feed is keyed on the ID and there is no public way
  // to convert one to the other. See admin/sermons-feed.js.
  { key: 'social_image_url', value: '', label: 'Social preview image',
    hint: 'The picture shown when somebody shares a link to the site. Leave blank to use the church logo. A photograph at 1200x630 works best.' },
  { key: 'sermon_youtube_channel', value: '@TimothySTL', label: 'Worship service channel',
    hint: 'The YouTube channel the weekly service is posted to. A handle or a channel ID; the site works out the rest.' },
  { key: 'sermon_title_filter', value: '', label: 'Only show videos titled',
    hint: 'Leave blank to show the newest video. Fill it in (e.g. "worship") if the channel also carries concerts or other recordings that should not appear as the service.' },
  { key: 'give_url',          value: 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8',                                    label: 'Online giving URL',        hint: 'Used for the Give link in emails and invoices. Update when the giving platform changes.' },
  // ── THE CHRISTMAS MARKET'S ELEVEN FIGURES MOVED OFF THIS LIST ──
  // They used to seed here as plain site_settings rows; they are columns on
  // the market's own `site_events` row now (see admin/events.js and the
  // one-time EVENTS_MARKET_MIGRATION_MARKER migration in
  // tlc-admin-worker.js), which is what makes them ONE record instead of a
  // site_settings row plus an events row saying the same thing twice.
  // ⚠ DO NOT ADD THEM BACK HERE. `INSERT OR IGNORE` re-seeding a key the
  // migration has already deleted would silently resurrect it on every
  // future SCHEMA_VERSION bump, forever — site_settings would fill back up
  // with figures nothing reads.
  { key: 'gym_rate_per_hour', value: '25.00',                   label: 'Gym rental rate (per hour, $)',  hint: 'Hourly rate charged for gym rentals. Shown to groups when they confirm a booking.' },
  { key: 'gym_hold_hours',    value: '48',                      label: 'Gym hold duration (hours)',      hint: 'How many hours a tentative hold lasts before auto-expiring. Default: 48.' },
  { key: 'gcal_calendar_id',  value: '',                        label: 'Google Calendar ID (gym rentals)', hint: 'Calendar ID that confirmed gym bookings are automatically added to. Format: xxxxx@group.calendar.google.com or your Gmail address for a personal calendar. Also requires GCAL_SERVICE_ACCOUNT_EMAIL and GCAL_PRIVATE_KEY set as Cloudflare Worker secrets.' },
  // ⚠ THE PUBLIC CALENDAR'S OWN CALENDARS, and a different thing entirely from
  // gcal_calendar_id above — that one is the single calendar gym bookings are
  // WRITTEN to. This is the list the site's /calendar page READS. The two ids
  // seeded here are the ones that were hardcoded in the old Google embed URL,
  // so the page shows exactly what it always showed with nothing typed in.
  { key: 'calendar_google_ids', value: 'calendar@timothystl.org, c_7f6d3db77b48c01af48592e21b2743d22fdf2b221d9d3c4e0c02680b73b89041@group.calendar.google.com', label: 'Calendars shown on /calendar', hint: 'Which Google calendars the church calendar page reads, comma separated. Reading them needs either the GCAL_SERVICE_ACCOUNT_EMAIL / GCAL_PRIVATE_KEY service account granted "See all event details" on each one, or a GCAL_API_KEY secret if the calendars are public.' },
  { key: 'gym_admin_email',   value: 'dinger@timothystl.org',  label: 'Gym booking notification email', hint: 'Email notified when a group places a hold, confirms a booking, or submits a recurring request.' },
  // ⚠ Blank means "serve the renter portal on the admin host", which is what it
  // has always done — and that is the safe default, because the Cloudflare route
  // has to exist before anything is sent to the public host. Filling this in is
  // the second half of a two-step change; see "The renter portal moved off the
  // admin origin" in CLAUDE.md.
  { key: 'gym_portal_origin', value: '',                        label: 'Gym renter portal address', hint: 'Where renters reach their booking portal. Leave blank until the Cloudflare route timothystl.org/gym/* -> tlc-newsletter-admin exists; then set it to https://timothystl.org. Renter pages then stop being served on this admin domain, and old links redirect there.' },
  { key: 'gym_payment_link',  value: 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8&locationId=fe6ddef2-d6d2-4c85-adfd-f19eac997d38&fundId=51451abb-a7e4-435a-8fc3-cb061b0ab1d7', label: 'Gym rental payment link', hint: 'Tithely (or other) URL shown on invoices and confirmation pages for online payment. Update if the payment form changes.' },
  // Church details — the one record every page reads. The map block, the
  // service-times block, the sidebar layout and the footer all pull from here,
  // so a phone number changes in one place and no deploy is needed.
  { key: 'church_name',         value: 'Timothy Lutheran Church',  label: 'Church name',     hint: 'Shown wherever the church names itself — the map block, invoices, the footer.' },
  { key: 'church_address_line', value: '6704 Fyler Ave',            label: 'Street address',  hint: 'Shown on the map block, contact page, and page sidebars.' },
  { key: 'church_address_city', value: 'St. Louis, MO 63139',       label: 'City, state, ZIP', hint: 'The second line of the address.' },
  { key: 'church_address_near', value: 'Corner of Fyler & Ivanhoe',  label: 'Landmark',        hint: 'How somebody finds it from the road — shown under the address on the welcome card. Leave blank to omit.' },
  { key: 'church_phone',        value: '(314) 781-8673',            label: 'Church phone',    hint: 'Shown wherever the site lists a phone number.' },
  { key: 'church_email',        value: 'office@timothystl.org',     label: 'Church email',    hint: 'The public contact address for the church office.' },
  // The three social accounts. They belong on this record and not in a screen
  // of their own for the same reason the phone number does: they are how
  // somebody reaches the church, and the Contact block, the footer and any
  // future page that lists them should all read one copy. Seeded with the real
  // handles, so the Contact block is right the first time somebody drops it on
  // a page rather than showing three empty rows.
  //
  // ⚠ Blank means "we are not on it" and the block omits that row entirely —
  // an icon linking nowhere is worse than no icon. That is also why there is no
  // fourth row for a network the church does not use.
  { key: 'church_facebook',     value: 'https://facebook.com/timothystl',  label: 'Facebook',  hint: 'Full address of the church page. Leave blank to leave Facebook off the site.' },
  { key: 'church_instagram',    value: 'https://instagram.com/timothystl', label: 'Instagram', hint: 'Full address of the church account. Leave blank to leave Instagram off the site.' },
  { key: 'church_youtube',      value: 'https://youtube.com/timothystl',   label: 'YouTube',   hint: 'Full address of the church channel. Leave blank to leave YouTube off the site.' },
  { key: 'church_service_times', label: 'Service times', hint: 'One line per service: Day | Time | Note. Shown by the Service times block and page sidebars.',
    // Two Sunday services, and no label on either. The welcome card groups by
    // label, so both blank means they read as one line — "8:00 & 10:45 am" —
    // which is what Andrew asked for on 2 Aug: no "English worship", and the
    // 9:30 Vietnamese service dropped.
    //
    // ⚠ Giving one of them a label and not the other splits that line again.
    // That is the mechanism working, not a bug: two services described
    // differently ARE two lines. If both need the same wording, type it twice.
    value: 'Sunday | 8:00 am | \nSunday | 10:45 am | ' },
];

// ── PARTNERS ─────────────────────────────────────────────────
// One partner ministry per core value. The pairing is the point: the Dashboard
// cards, the public /values page and the About page all show a value alongside
// the ministry that carries it into the world.
//
// `value` is UNIQUE so the one-per-value rule is the database's job, not a
// convention somebody has to remember. A value with no partner is a real state
// — the values page says so plainly rather than quietly showing three.
// One row per core value, `key` matching admin/values.js's VALUES exactly —
// the same UNIQUE-by-key rule Partners follows below, for the same reason:
// there is exactly one of each, and a second row for 'acceptance' is not a
// second acceptance, it is a bug.
//
// ⚠ ONLY THE WORDS AND THE PHOTO LIVE HERE. The design tokens — the field
// gradient, its bright accent, whether the card takes light or dark ink, the
// chip tint/ink/solid — stay in admin/values.js, a fixed palette rather than
// a picker, the same rule the Appearance screen's bar color follows: a free
// hex on these four cards is one paste away from an unreadable card, and
// nothing here asked for that control. A NULL/empty column means "use the
// hardcoded default from admin/values.js", not "blank" — nothing on the site
// changes until an office account fills a field in.
export const DB_INIT_CORE_VALUES = `CREATE TABLE IF NOT EXISTS core_values (
  key TEXT PRIMARY KEY,
  short TEXT,
  name TEXT,
  blurb TEXT,
  tag TEXT,
  why TEXT,
  photo_url TEXT,
  updated_at TEXT,
  updated_by TEXT
)`;

export const DB_INIT_PARTNERS = `CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT,
  value TEXT NOT NULL UNIQUE,
  blurb TEXT,
  site_url TEXT,
  also_note TEXT,
  logo_url TEXT,
  sort_order INTEGER DEFAULT 0
)`;

// Seeded with INSERT OR IGNORE, so editing a partner in the admin is never
// undone by a later deploy. Explicit ids keep the seed stable across re-runs.
//
// NOTE ON THE WORD OF LIFE ADDRESS: the design handoff lists wordoflifestl.org.
// The school's real site — the one this repo already links to from /wol and
// from the newsletter — is wordoflifeschool.net, so that is what is seeded
// here. If the handoff's address turns out to be a new domain, change it in
// the admin rather than here.
export const PARTNER_SEED = [
  {
    id: 1, name: 'Lindenwood Area Senior Ministry', short_name: 'LASM', value: 'acceptance',
    blurb: 'Neighbors in Lindenwood Park cared for close to home — rides, visits, and company for seniors in the streets around the church.',
    site_url: 'https://lasmstl.org', also_note: null, sort_order: 10,
  },
  {
    id: 2, name: 'Concordia Seminary St. Louis', short_name: 'Concordia Seminary', value: 'worship',
    blurb: 'Pastors formed for the whole church a few miles from our door, and vicars and field workers who serve among us while they train.',
    site_url: 'https://csl.edu', also_note: null, sort_order: 20,
  },
  {
    id: 3, name: 'Word of Life Lutheran School', short_name: 'Word of Life', value: 'education',
    blurb: 'Families formed together through Lutheran education, community, and care — a partner school, not a separate world.',
    site_url: 'https://wordoflifeschool.net', also_note: null, sort_order: 30,
  },
  {
    id: 4, name: 'Christian Friends of New Americans', short_name: 'CFNA', value: 'outreach',
    blurb: 'Welcoming refugees and immigrants to St. Louis with food, English, health care, and the Gospel — from our neighborhood to the nations.',
    site_url: 'https://cfna-stl.org',
    also_note: 'Pastor Rall and Mary Ann, missionaries to Papua New Guinea',
    sort_order: 40,
  },
];

// ── THE NAVIGATION ───────────────────────────────────────────
// One row per *appearance* in a menu, not one per page — see the note at the
// top of admin/menu.js for why this is a join table and not more columns on
// `pages`. A `page` item stores only page_id: the address is always read from
// `pages`, so renaming a page moves every menu item pointing at it for free.
export const DB_INIT_MENU_ITEMS = `CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu TEXT NOT NULL DEFAULT 'header',
  label TEXT,
  kind TEXT NOT NULL DEFAULT 'page',
  page_id TEXT,
  target TEXT,
  style TEXT NOT NULL DEFAULT 'link',
  depth INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
)`;

// Seeded from the navigation as it stands in public/index.html today, so the
// first time anyone opens the Menu screen it already describes the live site
// rather than an empty list they have to rebuild from memory.
//
// Seeded with INSERT OR IGNORE against an explicit id, so rearranging the menu
// in the admin is never undone by a later deploy.
export const MENU_SEED = [
  // Header — the bar as it is today. Labels differ from page titles where the
  // bar needs to be shorter ("Learn" for Christian Education).
  { id: 1,  menu: 'header', label: 'About',          kind: 'page', page_id: 'about',       sort_order: 10 },
  { id: 2,  menu: 'header', label: 'Worship',        kind: 'page', page_id: 'worship',     sort_order: 20 },
  { id: 3,  menu: 'header', label: 'Learn',          kind: 'page', page_id: 'education',   sort_order: 30 },
  { id: 4,  menu: 'header', label: 'Sermons',        kind: 'page', page_id: 'sermons',     sort_order: 40 },
  { id: 5,  menu: 'header', label: 'Ministries',     kind: 'page', page_id: 'ministries',  sort_order: 50 },
  { id: 6,  menu: 'header', label: 'News & Events',  kind: 'page', page_id: 'news',        sort_order: 60 },
  { id: 7,  menu: 'header', label: 'Calendar',       kind: 'page', page_id: 'calendar',    sort_order: 70 },
  { id: 8,  menu: 'header', label: 'Contact',        kind: 'page', page_id: 'contact',     sort_order: 80 },
  // The one button. A second would stop the first standing out.
  { id: 9,  menu: 'header', label: 'Give',           kind: 'page', page_id: 'give',        sort_order: 90, style: 'button' },

  // Footer — pages, then the partner sites the footer has always linked out to.
  { id: 20, menu: 'footer', label: 'About',          kind: 'page', page_id: 'about',       sort_order: 10 },
  { id: 21, menu: 'footer', label: 'Worship',        kind: 'page', page_id: 'worship',     sort_order: 20 },
  { id: 22, menu: 'footer', label: 'Sermons',        kind: 'page', page_id: 'sermons',     sort_order: 30 },
  { id: 23, menu: 'footer', label: 'Ministries',     kind: 'page', page_id: 'ministries',  sort_order: 40 },
  { id: 24, menu: 'footer', label: 'News & Events',  kind: 'page', page_id: 'news',        sort_order: 50 },
  { id: 25, menu: 'footer', label: 'Contact',        kind: 'page', page_id: 'contact',     sort_order: 60 },
  { id: 26, menu: 'footer', label: 'Prayer Request', kind: 'page', page_id: 'prayer',      sort_order: 70 },
  { id: 27, menu: 'footer', label: 'Give',           kind: 'page', page_id: 'give',        sort_order: 80 },
  { id: 28, menu: 'footer', label: 'Word of Life School', kind: 'external', target: 'https://wordoflifeschool.net', sort_order: 90 },
  { id: 29, menu: 'footer', label: "Mother's Day Out",    kind: 'external', target: 'https://mdo.timothystl.org',   sort_order: 100 },
  { id: 30, menu: 'footer', label: 'Volunteer Sign-up',   kind: 'external', target: 'https://serve.timothystl.org', sort_order: 110 },
];

// ── FOOTER COLUMNS ───────────────────────────────────────────
// The header is one bar; the footer is headed groups. "Which group is this
// link under" is a fact with nowhere to live in an ordered list, so it lives
// here and `menu_items.column_id` points at it. See the long note in
// admin/menu.js.
//
// `source` says where a column's links come from. 'partners' is filled on the
// site from the partner ministries — those are not menu items and never were,
// so the alternative to a source flag was faking rows for them or pretending
// the column does not exist.
export const DB_INIT_FOOTER_COLUMNS = `CREATE TABLE IF NOT EXISTS footer_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  heading TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'menu',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
)`;

// The four headings the footer has today, with explicit ids for the same
// reason MENU_SEED uses them: INSERT OR IGNORE against a fixed id means
// renaming or reordering a column survives every later deploy.
export const FOOTER_COLUMN_SEED = [
  { id: 1, heading: 'Visit',    source: 'menu',     sort_order: 10 },
  { id: 2, heading: 'Connect',  source: 'menu',     sort_order: 20 },
  { id: 3, heading: 'Programs', source: 'menu',     sort_order: 30 },
  { id: 4, heading: 'Partners', source: 'partners', sort_order: 40 },
];

// Which seeded footer item starts in which column. Applied only where
// column_id IS NULL, so it fills in an existing install once and never moves
// a link the office has since put somewhere else.
export const FOOTER_ITEM_COLUMNS = {
  21: 1, 22: 1, 24: 1,             // Worship, Sermons, News & Events
  20: 2, 23: 2, 25: 2, 26: 2, 27: 2, // About, Ministries, Contact, Prayer, Give
  28: 3, 29: 3, 30: 3,             // Word of Life, Mother's Day Out, Volunteer
};

// ── NFC TAPS ─────────────────────────────────────────────────
// The four physical tags, seeded from §5.10 of the design handoff. The ids are
// fixed because they ARE the addresses: tap 1 is /tap1. Names and placements
// are working labels the office can rename at any time — nothing depends on
// them.
export const TAP_SEED = [
  { id: 1, name: 'Link tree',    placement: 'Narthex table · handout cards', destination: 'https://links.timothystl.org' },
  { id: 2, name: 'Welcome card', placement: 'Pew racks · visitor cards',     destination: 'https://links.timothystl.org/welcome' },
  { id: 3, name: 'Giving plate', placement: 'Offering plates · two tags',    destination: 'https://give.timothystl.org' },
  { id: 4, name: 'School & MDO', placement: 'School entry · MDO front desk', destination: 'https://links.timothystl.org/school' },
];

// ── LINK CARD KINDS ──────────────────────────────────────────
// A card either opens a link or is a form the visitor fills in on the page.
// `link` is the default and is what every card was before this existed.
export const CARD_KINDS = [
  { value: 'link',   label: 'Opens a link',        note: 'Tapping the card sends them to the address below.' },
  { value: 'signup', label: 'Newsletter sign-up',  note: 'The card opens a name and email form on the page. Nothing to link to.' },
];
export const isFormCard = (kind) => String(kind || 'link') === 'signup';

// The newsletter sign-up card was hardcoded into tlc-links-worker.js, which
// meant it showed on every tap and the office could not touch a word of it.
// It is seeded as a real row so it is editable like any other card — once,
// behind SIGNUP_CARD_MARKER, because a seed that ran on every schema bump
// would resurrect a card somebody had deliberately deleted.
export const SIGNUP_CARD_SEED = {
  title: 'Get the Newsletter',
  description: 'Weekly news & a word from Pastor Dinger',
  icon_emoji: '✉️',
  icon_color: 'amber',
  sort_order: 90,
};

// Service times are stored as one editable text box rather than a table of
// their own: three lines that staff can retype without learning a new screen.
export function parseServiceTimes(value) {
  return String(value || '').split('\n').map((line) => {
    const [day, time, note] = line.split('|').map((s) => s.trim());
    return { day: day || '', time: time || '', note: note || '' };
  }).filter((r) => r.day || r.time);
}
