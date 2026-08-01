// ── CONSTANTS & INITIAL DATA ─────────────────────────────────
// Extracted from tlc-admin-worker.js

// TinyMCE rich-text editor — loaded only on news item form pages
export const TINYMCE_API_KEY = '5wrsrinqxeqvej5slykwic6rgpfb0v8wvj0f21fgk1r4nhs0';
export const TINYMCE_HEAD = `<script>window._tinyQ=[];function _onTinymce(fn){if(window.tinymce){fn();}else{window._tinyQ.push(fn);}}<\/script><script async src="https://cdn.tiny.cloud/1/${TINYMCE_API_KEY}/tinymce/7/tinymce.min.js" referrerpolicy="origin" onload="window._tinyQ.forEach(function(fn){fn();});window._tinyQ=[]"><\/script>`;

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

export const DB_INIT_AUDIT_LOG = `CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
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
  { key: 'give_url',          value: 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8',                                    label: 'Online giving URL',        hint: 'Used for the Give link in emails and invoices. Update when the giving platform changes.' },
  { key: 'gym_rate_per_hour', value: '25.00',                   label: 'Gym rental rate (per hour, $)',  hint: 'Hourly rate charged for gym rentals. Shown to groups when they confirm a booking.' },
  { key: 'gym_hold_hours',    value: '48',                      label: 'Gym hold duration (hours)',      hint: 'How many hours a tentative hold lasts before auto-expiring. Default: 48.' },
  { key: 'gcal_calendar_id',  value: '',                        label: 'Google Calendar ID (gym rentals)', hint: 'Calendar ID that confirmed gym bookings are automatically added to. Format: xxxxx@group.calendar.google.com or your Gmail address for a personal calendar. Also requires GCAL_SERVICE_ACCOUNT_EMAIL and GCAL_PRIVATE_KEY set as Cloudflare Worker secrets.' },
  { key: 'gym_admin_email',   value: 'dinger@timothystl.org',  label: 'Gym booking notification email', hint: 'Email notified when a group places a hold, confirms a booking, or submits a recurring request.' },
  { key: 'gym_payment_link',  value: 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8&locationId=fe6ddef2-d6d2-4c85-adfd-f19eac997d38&fundId=51451abb-a7e4-435a-8fc3-cb061b0ab1d7', label: 'Gym rental payment link', hint: 'Tithely (or other) URL shown on invoices and confirmation pages for online payment. Update if the payment form changes.' },
  // Church details — the one record every page reads. The map block, the
  // service-times block, the sidebar layout and the footer all pull from here,
  // so a phone number changes in one place and no deploy is needed.
  { key: 'church_address_line', value: '6704 Fyler Ave',            label: 'Street address',  hint: 'Shown on the map block, contact page, and page sidebars.' },
  { key: 'church_address_city', value: 'St. Louis, MO 63139',       label: 'City, state, ZIP', hint: 'The second line of the address.' },
  { key: 'church_phone',        value: '(314) 781-8673',            label: 'Church phone',    hint: 'Shown wherever the site lists a phone number.' },
  { key: 'church_email',        value: 'office@timothystl.org',     label: 'Church email',    hint: 'The public contact address for the church office.' },
  { key: 'church_service_times', label: 'Service times', hint: 'One line per service: Day | Time | Note. Shown by the Service times block and page sidebars.',
    value: 'Sunday | 8:00 am | Traditional\nSunday | 9:30 am | Vietnamese worship · Hội Thánh Việt\nSunday | 10:45 am | Contemporary' },
];

// ── PARTNERS ─────────────────────────────────────────────────
// One partner ministry per core value. The pairing is the point: the Dashboard
// cards, the public /values page and the About page all show a value alongside
// the ministry that carries it into the world.
//
// `value` is UNIQUE so the one-per-value rule is the database's job, not a
// convention somebody has to remember. A value with no partner is a real state
// — the values page says so plainly rather than quietly showing three.
export const DB_INIT_PARTNERS = `CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT,
  value TEXT NOT NULL UNIQUE,
  blurb TEXT,
  site_url TEXT,
  also_note TEXT,
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
    blurb: 'Neighbours in Lindenwood Park cared for close to home — rides, visits, and company for seniors in the streets around the church.',
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
    blurb: 'Welcoming refugees and immigrants to St. Louis with food, English, health care, and the Gospel — from our neighbourhood to the nations.',
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

// Service times are stored as one editable text box rather than a table of
// their own: three lines that staff can retype without learning a new screen.
export function parseServiceTimes(value) {
  return String(value || '').split('\n').map((line) => {
    const [day, time, note] = line.split('|').map((s) => s.trim());
    return { day: day || '', time: time || '', note: note || '' };
  }).filter((r) => r.day || r.time);
}
