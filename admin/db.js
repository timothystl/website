// ── CONSTANTS & INITIAL DATA ─────────────────────────────────
// Extracted from tlc-admin-worker.js

export const ADMIN_PASSWORD = '6704fyler';

// TinyMCE rich-text editor — loaded only on news item form pages
export const TINYMCE_API_KEY = '5wrsrinqxeqvej5slykwic6rgpfb0v8wvj0f21fgk1r4nhs0';
export const TINYMCE_HEAD = `<script src="https://cdn.tiny.cloud/1/${TINYMCE_API_KEY}/tinymce/7/tinymce.min.js" referrerpolicy="origin"><\/script>`;

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
  created_at TEXT DEFAULT (datetime('now'))
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
  { key: 'gym_admin_email',   value: 'office@timothystl.org',  label: 'Gym booking notification email', hint: 'Email notified when a group places a hold, confirms a booking, or submits a recurring request.' },
];
