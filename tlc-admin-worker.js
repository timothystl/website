// Timothy Lutheran Church — Newsletter Admin Worker
// Deploy to: admin.timothystl.org
// Cloudflare Worker + D1 Database

const ADMIN_PASSWORD = '6704fyler';

// TinyMCE rich-text editor — loaded only on news item form pages
const TINYMCE_API_KEY = '5wrsrinqxeqvej5slykwic6rgpfb0v8wvj0f21fgk1r4nhs0';
const TINYMCE_HEAD = `<script src="https://cdn.tiny.cloud/1/${TINYMCE_API_KEY}/tinymce/7/tinymce.min.js" referrerpolicy="origin"><\/script>`;

// ── DB INIT ─────────────────────────────────────────────────
const DB_INIT_NEWSLETTERS = `CREATE TABLE IF NOT EXISTS newsletters (
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

const DB_INIT_EVENTS = `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  newsletter_id INTEGER,
  event_date TEXT,
  event_name TEXT,
  event_time TEXT,
  event_desc TEXT,
  sort_order INTEGER DEFAULT 0
)`;

const DB_INIT_NEWS_ITEMS = `CREATE TABLE IF NOT EXISTS news_items (
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

const DB_INIT_YOUTH_PAGES = `CREATE TABLE IF NOT EXISTS youth_pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  has_posts INTEGER DEFAULT 0,
  updated_at TEXT
)`;

const DB_INIT_MINISTRY_POSTS = `CREATE TABLE IF NOT EXISTS ministry_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ministry_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  post_date TEXT,
  body TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

const DB_INIT_VOTERS_PAGE = `CREATE TABLE IF NOT EXISTS voters_page (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_info TEXT,
  zoom_link TEXT,
  files_json TEXT DEFAULT '[]',
  updated_at TEXT
)`;

const DB_INIT_SERMON_SERIES = `CREATE TABLE IF NOT EXISTS sermon_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  date_range TEXT,
  playlist_url TEXT,
  active INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`;

const DB_INIT_PAGE_CONTENT = `CREATE TABLE IF NOT EXISTS page_content (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  value TEXT,
  published INTEGER DEFAULT 1,
  updated_at TEXT
)`;

const DB_INIT_STAFF_MEMBERS = `CREATE TABLE IF NOT EXISTS staff_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  photo_url TEXT,
  bio TEXT,
  display_order INTEGER DEFAULT 0
)`;

const DB_INIT_SITE_SETTINGS = `CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  label TEXT,
  hint TEXT
)`;

// ── GYM RENTAL DB TABLES ─────────────────────────────────────
const DB_INIT_GYM_GROUPS = `CREATE TABLE IF NOT EXISTS gym_groups (
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

const DB_INIT_GYM_BOOKINGS = `CREATE TABLE IF NOT EXISTS gym_bookings (
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

const DB_INIT_GYM_RECURRENCES = `CREATE TABLE IF NOT EXISTS gym_recurrences (
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

const DB_INIT_GYM_BLOCKED = `CREATE TABLE IF NOT EXISTS gym_blocked_dates (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  date    TEXT NOT NULL UNIQUE,
  reason  TEXT
)`;

const DB_INIT_GYM_INVOICES = `CREATE TABLE IF NOT EXISTS gym_invoices (
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

const DB_INIT_SERMON_NOTES = `CREATE TABLE IF NOT EXISTS sermon_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER,
  date TEXT,
  title TEXT NOT NULL,
  scripture TEXT,
  outline TEXT,
  youtube_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

const THEMES = ['Acceptance', 'Christian Education', 'Outreach', 'Worship'];
const CONTENT_TYPES = ['Testimonial / Quote', 'Story', 'Explainer', 'Event Promo', 'Factoid / Trivia'];

const MINISTRY_SLUGS = [
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

const INITIAL_STAFF = [
  { name: 'Andrew Dinger',  title: 'Lead Pastor',                          email: 'dinger@timothystl.org',    photo_url: '/images/staff/dinger.jpg',    bio: `Andrew Dinger has spent his life following the gospel into unexpected places — from social work in Washington, D.C. working among the homeless and ex-offenders community, to teaching English in Taiwan with LCMS World Mission. He served 12 years in parish ministry in NJ, serving in broad areas from District service to leadership of the FAITH Center for the Arts. He came to Timothy Lutheran in 2018.\n\nAndrew holds a Master's in Philanthropic Studies from IUPUI and has a deep interest in the intersection of the church and civil society — how the body of Christ shows up not just on Sunday mornings, but in neighborhoods, schools, and the margins of public life. He's an unashamed lover of the lost, a student of Scripture, and a preacher who believes the gospel is still, as Paul said, "the power of God for salvation to everyone who believes."\n\nHe and his wife are raising three boys and are grateful to call St. Louis home.`, display_order: 10 },
  { name: 'Matt Gerzevske', title: 'Assistant Pastor',                      email: 'pastormatt@timothystl.org', photo_url: '/images/staff/matt.jpg',      bio: '', display_order: 20 },
  { name: 'Mark Thompson',  title: 'Director of Christian Education',       email: 'dce@timothystl.org',        photo_url: '/images/staff/thompson.png',  bio: '', display_order: 30 },
  { name: 'Dr. Jinah Knapp',title: 'Music Director',                        email: 'jinah@timothystl.org',      photo_url: '/images/staff/jinah.jpg',     bio: `Dr. Jinah Yoo Knapp grew up in Seoul, South Korea, where she studied at the prestigious Seoul Arts High School. She completed studies in church music and organ at Yonsei University, and received the doctorate in organ from the University of Iowa.\n\nJinah served as professor of organ, organ literature, and the history of church music at Keimyung University and later at Yonsei University. As a competitor, she won honors at the Albert Schweitzer Organ Competition, the John D. Rodland Church Music Competition, and the St. Moritz (Switzerland) International Organ Competition. She has performed widely in Korea and the USA, and regularly performs in Germany.\n\nFrom an early age, Jinah served as a church musician, directing ensembles and choirs. She has served as organist and directed ensembles in Iowa and South Korea.`, display_order: 40 },
  { name: 'Ron Rall',       title: 'Pastor Emeritus',                       email: 'pastorrall@timothystl.org', photo_url: '/images/staff/rall.png',      bio: '', display_order: 50 },
  { name: 'Chau Vo',        title: 'Pastor to the Vietnamese Community',    email: '',                          photo_url: '/images/staff/chauvo.jpg',    bio: '', display_order: 60 },
  { name: 'James Vo',       title: 'Office Assistant',                      email: 'office@timothystl.org',     photo_url: '',                            bio: '', display_order: 70 },
  { name: 'Noah',           title: 'Comfort Dog',                           email: 'noah@timothystl.org',       photo_url: '/images/staff/noah.jpg',      bio: '', display_order: 80 },
];

const INITIAL_SETTINGS = [
  { key: 'zoom_url',          value: 'https://us02web.zoom.us/j/3147818673',                                                                   label: 'Zoom meeting URL',      hint: 'Used for the /zoom redirect. Update when the Zoom link changes.' },
  { key: 'councilfiles_url',  value: 'https://drive.google.com/drive/folders/1pgqJ32H3HS7SNYnnf7rOswC5c87IAzA4?usp=drive_link',              label: 'Council files URL',     hint: 'Used for the /councilfiles redirect. Update when the Google Drive folder changes.' },
  { key: 'give_url',          value: 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8',                                    label: 'Online giving URL',        hint: 'Used for the Give link in emails and invoices. Update when the giving platform changes.' },
  { key: 'gym_rate_per_hour', value: '25.00',                   label: 'Gym rental rate (per hour, $)',  hint: 'Hourly rate charged for gym rentals. Shown to groups when they confirm a booking.' },
  { key: 'gym_hold_hours',    value: '48',                      label: 'Gym hold duration (hours)',      hint: 'How many hours a tentative hold lasts before auto-expiring. Default: 48.' },
  { key: 'gcal_calendar_id',  value: '',                        label: 'Google Calendar ID (gym rentals)', hint: 'Calendar ID that confirmed gym bookings are automatically added to. Format: xxxxx@group.calendar.google.com or your Gmail address for a personal calendar. Also requires GCAL_SERVICE_ACCOUNT_EMAIL and GCAL_PRIVATE_KEY set as Cloudflare Worker secrets.' },
  { key: 'gym_admin_email',   value: 'office@timothystl.org',  label: 'Gym booking notification email', hint: 'Email notified when a group places a hold, confirms a booking, or submits a recurring request.' },
];

// ── IMAGE HELPERS ───────────────────────────────────────────
function extractImageKeys(body, origin) {
  if (!body) return [];
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '/images/([^"\'\\s<>]+)', 'g');
  const keys = [];
  let m;
  while ((m = re.exec(body)) !== null) keys.push(m[1]);
  return keys;
}

async function sweepExpiredItems(env, origin) {
  const today = new Date().toISOString().split('T')[0];
  try {
    const expired = await env.DB.prepare(
      "SELECT id, body FROM news_items WHERE expire_date IS NOT NULL AND expire_date < ?"
    ).bind(today).all();
    for (const item of expired.results) {
      for (const key of extractImageKeys(item.body || '', origin)) {
        try { await env.IMAGES.delete(key); } catch (_) {}
      }
      await env.DB.prepare('DELETE FROM news_items WHERE id = ?').bind(item.id).run();
    }
  } catch (_) {}
}

async function sweepExpiredHolds(env) {
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      "UPDATE gym_bookings SET status = 'expired' WHERE status = 'hold' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?"
    ).bind(now).run();
  } catch (_) {}
}

function fmtBookingDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmt12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m === 0 ? '00' : m.toString().padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function timeOptions(selected = '') {
  const slots = [];
  for (let h = 6; h < 24; h++) {
    for (const m of [0, 30]) {
      const val = `${h.toString().padStart(2,'0')}:${m === 0 ? '00' : '30'}`;
      slots.push(`<option value="${val}"${selected === val ? ' selected' : ''}>${fmt12h(val)}</option>`);
    }
  }
  return slots.join('');
}

function calcHours(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

function buildGymInvoiceEmailHtml(inv, group, booking) {
  const invNum = `GYM-${inv.id.toString().padStart(4,'0')}`;
  const hours  = parseFloat(inv.total_hours  || 0);
  const rate   = parseFloat(inv.rate         || 0);
  const total  = parseFloat(inv.total_amount || 0);
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F7F3EC;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;background:#F7F3EC;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #EDE9E0;">
<tr><td style="background:#1E2D4A;padding:28px 36px;text-align:center;">
  <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#C9973A;margin-bottom:6px;">Timothy Lutheran Church</div>
  <div style="font-family:Georgia,serif;font-size:22px;color:white;margin-bottom:4px;">Gym Rental Invoice</div>
  <div style="font-size:13px;color:rgba(255,255,255,.6);">#${invNum}</div>
</td></tr>
<tr><td style="padding:36px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
    <tr>
      <td style="vertical-align:top;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;">Billed To</div>
        <div style="font-size:15px;font-weight:700;color:#1E2D4A;">${group.name}</div>
        ${group.contact ? `<div style="font-size:13px;color:#4A4860;margin-top:3px;">${group.contact}</div>` : ''}
        ${group.email   ? `<div style="font-size:13px;color:#4A4860;">${group.email}</div>` : ''}
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;">Invoice Date</div>
        <div style="font-size:14px;color:#1A1A2A;">${formatDate(inv.invoice_date)}</div>
        <div style="font-size:12px;font-weight:700;margin-top:4px;color:${inv.status==='paid'?'#1a3d1f':'#7a1f1f'};">${inv.status==='paid'?'✓ PAID':'UNPAID'}</div>
      </td>
    </tr>
  </table>
  <hr style="border:none;border-top:1px solid #EDE9E0;margin:0 0 24px;">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C9973A;margin-bottom:16px;">Rental Details</div>
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Date</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#1A1A2A;text-align:right;">${formatDate(booking.booking_date)}</td></tr>
    <tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Time</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#1A1A2A;text-align:right;">${fmt12h(booking.start_time)} \u2013 ${fmt12h(booking.end_time)}</td></tr>
    <tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Duration</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#1A1A2A;text-align:right;">${hours} hr${hours !== 1 ? 's' : ''}</td></tr>
    <tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Rate</td><td style="padding:10px 0;font-size:14px;color:#1A1A2A;text-align:right;">$${rate.toFixed(2)}/hr</td></tr>
    <tr><td style="padding:20px 0 0;font-size:18px;font-weight:700;color:#1E2D4A;">Amount Due</td><td style="padding:20px 0 0;font-size:24px;font-weight:700;color:#1E2D4A;text-align:right;">$${total.toFixed(2)}</td></tr>
  </table>
  <hr style="border:none;border-top:1px solid #EDE9E0;margin:24px 0;">
  <div style="background:#F7F3EC;border-radius:8px;padding:18px 20px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C9973A;margin-bottom:10px;">Payment</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr><td align="center">
        <a href="https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8&locationId=fe6ddef2-d6d2-4c85-adfd-f19eac997d38&fundId=51451abb-a7e4-435a-8fc3-cb061b0ab1d7" style="display:inline-block;background:#00DB72;color:white;font-weight:700;font-size:16px;padding:14px 48px;border-radius:6px;text-decoration:none;letter-spacing:.01em;">Pay Online →</a>
      </td></tr>
    </table>
    <div style="font-size:13px;color:#7A6E60;text-align:center;margin-bottom:16px;">— or —</div>
    <div style="font-size:14px;color:#4A4860;line-height:1.75;">Make your check payable to <strong>Timothy Lutheran Church</strong> and bring it to the church office or mail to:<br><br>Timothy Lutheran Church<br>4666 Fyler Ave, St. Louis, MO 63116</div>
    <div style="font-size:13px;color:#7A6E60;margin-top:12px;">Questions? <a href="mailto:office@timothystl.org" style="color:#2E7EA6;">office@timothystl.org</a></div>
  </div>
</td></tr>
<tr><td style="background:#F7F3EC;padding:20px 36px;text-align:center;font-size:12px;color:#7A6E60;">
  Timothy Lutheran Church · 4666 Fyler Ave, St. Louis, MO 63116
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── GOOGLE CALENDAR INTEGRATION ──────────────────────────────
// Requires Worker secrets: GCAL_SERVICE_ACCOUNT_EMAIL, GCAL_PRIVATE_KEY
// The service account must be granted "Make changes to events" on the target calendar.
async function getGCalAccessToken(env) {
  const email  = (env.GCAL_SERVICE_ACCOUNT_EMAIL || '').trim();
  const rawKey = env.GCAL_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  try {
    const now  = Math.floor(Date.now() / 1000);
    const b64u = obj => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const hdr  = b64u({ alg:'RS256', typ:'JWT' });
    const pay  = b64u({ iss: email, scope:'https://www.googleapis.com/auth/calendar.events', aud:'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const sigInput = `${hdr}.${pay}`;
    const pem  = rawKey.replace(/\\n/g,'\n').replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
    const keyBuf = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    const key  = await crypto.subtle.importKey('pkcs8', keyBuf.buffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
    const sig  = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput));
    const jwt  = `${sigInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
    const res  = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    return (await res.json()).access_token || null;
  } catch (_) { return null; }
}

async function addGymBookingToGCal(env, { booking_date, start_time, end_time, group_name, notes }) {
  try {
    const calId = (await env.DB.prepare("SELECT value FROM site_settings WHERE key='gcal_calendar_id'").first())?.value;
    if (!calId) return;
    const token = await getGCalAccessToken(env);
    if (!token) return;
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary:  `Gym Rental — ${group_name}`,
        description: notes || '',
        location: 'Timothy Lutheran Church, 4666 Fyler Ave, St. Louis, MO 63116',
        start: { dateTime: `${booking_date}T${start_time}:00`, timeZone: 'America/Chicago' },
        end:   { dateTime: `${booking_date}T${end_time}:00`,   timeZone: 'America/Chicago' },
      }),
    });
  } catch (_) {} // never block booking flow
}

// ── GROUP BOOKING PORTAL ─────────────────────────────────────
function portalHtml(body, title = 'Gym Rental Portal') {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;600;700;800&family=Lora:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
:root{--steel:#1E2D4A;--amber:#C9973A;--sage:#4A5E3A;--warm:#FAF7F0;--linen:#F2EDE2;--mist:#EDF5F8;--border:#E8E0D0;--charcoal:#1A1A2A;--gray:#6B7280;--white:#fff;--sans:'Source Sans 3',Arial,sans-serif;--serif:'Lora',Georgia,serif;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:var(--sans);background:var(--warm);color:var(--charcoal);min-height:100vh;}
.portal-header{background:var(--steel);border-bottom:3px solid var(--amber);padding:18px 24px;text-align:center;}
.portal-brand{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;}
.portal-title{font-family:var(--serif);font-size:20px;color:white;}
.portal-group{font-size:13px;color:rgba(255,255,255,.65);margin-top:4px;}
.wrap{max-width:820px;margin:0 auto;padding:32px 20px;}
.card{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:24px;margin-bottom:20px;}
.card-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border);}
.form-group{margin-bottom:18px;}
label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:6px;}
input[type=date],input[type=text],input[type=email],textarea,select{width:100%;background:var(--white);border:1px solid var(--border);border-radius:6px;padding:10px 14px;font-family:var(--sans);font-size:14px;color:var(--charcoal);outline:none;transition:border-color .2s;}
input:focus,select:focus{border-color:var(--amber);box-shadow:0 0 0 3px rgba(201,151,58,.12);}
.btn{display:inline-flex;align-items:center;gap:8px;font-family:var(--sans);font-size:14px;font-weight:700;padding:11px 24px;border-radius:6px;border:none;cursor:pointer;text-decoration:none;transition:background .2s;line-height:1;}
.btn-primary{background:var(--steel);color:white;}
.btn-primary:hover{background:#2a4068;}
.btn-amber{background:var(--amber);color:var(--steel);}
.btn-amber:hover{background:#b8872a;}
.btn-sage{background:var(--sage);color:white;}
.btn-sage:hover{background:#3a4e2a;}
.btn-danger{background:#B85C3A;color:white;}
.btn-danger:hover{background:#9a4a2e;}
.btn-sm{font-size:12px;padding:7px 14px;}
.btn-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;}
.alert{padding:14px 18px;border-radius:8px;font-size:14px;margin-bottom:20px;line-height:1.5;}
.alert-success{background:#e8f5e9;border-left:3px solid #4A5E3A;color:#1a3d1f;}
.alert-error{background:#fce8e8;border-left:3px solid #B85C3A;color:#7a1f1f;}
.alert-info{background:var(--mist);border-left:3px solid var(--steel);color:var(--steel);}
.badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;}
.badge-confirmed{background:#e8f5e9;color:#1a3d1f;}
.badge-hold{background:#FFF3D6;color:#7A4F00;}
.badge-expired{background:#fce8e8;color:#7a1f1f;}
.booking-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.booking-row:last-child{border-bottom:none;}
.booking-date{font-size:13px;font-weight:700;color:var(--steel);min-width:100px;}
.booking-time{font-size:13px;color:var(--gray);}
/* Selection calendar */
.scal-wrap{position:relative;}
.scal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px;}
.scal-nav-btn{background:var(--mist);border:1px solid var(--border);cursor:pointer;padding:6px 16px;border-radius:6px;font-size:18px;line-height:1;color:var(--steel);font-weight:700;transition:background .15s;flex-shrink:0;}
.scal-nav-btn:hover{background:var(--border);}
.scal-nav-btn:disabled{opacity:.35;cursor:default;}
.scal-nav-label{font-family:var(--serif);font-size:18px;color:var(--steel);font-weight:700;text-align:center;flex:1;}
.scal-month{display:none;}
.scal-month.active{display:block;}
.scal-table{width:100%;border-collapse:collapse;table-layout:fixed;}
.scal-table th{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gray);padding:7px 0;text-align:center;}
.scal-table td{padding:3px;vertical-align:top;}
.scal-cell{border-radius:8px;overflow:visible;border:2px solid transparent;position:relative;}
.scal-num{font-size:12px;font-weight:700;text-align:center;padding:4px 0;line-height:1.3;color:var(--steel);}
.scal-cell.scal-past .scal-num,.scal-cell.scal-blocked .scal-num{color:#CBD5E1;}
.scal-slots{display:flex;flex-direction:column;gap:2px;padding:2px;}
.scal-slot{height:18px;display:flex;align-items:center;padding:0 4px;width:100%;box-sizing:border-box;border:none;cursor:default;transition:filter .1s;border-radius:3px;position:relative;font-size:9px;font-weight:700;color:white;overflow:hidden;white-space:nowrap;letter-spacing:.01em;}
.scal-slot.open{background:#5A9E6F;cursor:pointer;}
.scal-slot.open:hover{filter:brightness(1.12);}
.scal-slot.taken{background:#D17070;}
.scal-slot.na{background:#E8EDF3;color:transparent;}
.scal-slot.selected{background:var(--amber) !important;cursor:pointer;}
.scal-cell.has-selection{border-color:var(--amber);}
.scal-slot[data-label]:hover::after{content:attr(data-label);position:absolute;bottom:calc(100% + 5px);left:50%;transform:translateX(-50%);background:#1E2D4A;color:white;font-size:11px;white-space:nowrap;padding:3px 8px;border-radius:4px;pointer-events:none;z-index:300;font-family:var(--sans);font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,.25);}
/* Legend */
.scal-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--gray);margin-top:14px;}
.scal-legend span{display:flex;align-items:center;gap:6px;}
.legend-swatch{width:24px;height:10px;border-radius:2px;flex-shrink:0;}
/* Pattern selector */
.pattern-card{background:var(--mist);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-top:16px;}
.pattern-card-title{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:12px;}
.pattern-fields{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;}
.pattern-fields .form-group{margin-bottom:0;flex:1;min-width:130px;}
/* Request bar */
.req-bar{position:sticky;bottom:0;left:0;right:0;background:var(--steel);color:white;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:3px solid var(--amber);z-index:100;}
.req-bar-count{font-size:15px;font-weight:700;}
.req-bar-detail{font-size:12px;opacity:.75;margin-top:2px;}
/* Agreement card */
.agree-card{border:2px solid var(--steel);border-radius:10px;padding:18px 20px;margin-bottom:18px;background:var(--mist);}
.agree-card .total{font-size:22px;font-weight:700;color:var(--steel);margin-bottom:10px;}
.agree-check{display:flex;align-items:flex-start;gap:10px;font-size:14px;color:var(--charcoal);line-height:1.5;cursor:pointer;}
.agree-check input{width:auto;margin-top:2px;flex-shrink:0;}
</style>
</head>
<body>${body}</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// GYM_SLOTS: all possible rentable hour slots (8 AM–9 PM), each [startHour, label]
const GYM_SLOTS = [
  [8,'8–9 AM'],[9,'9–10 AM'],[10,'10–11 AM'],[11,'11 AM–12 PM'],
  [12,'12–1 PM'],[13,'1–2 PM'],[14,'2–3 PM'],[15,'3–4 PM'],
  [16,'4–5 PM'],[17,'5–6 PM'],[18,'6–7 PM'],[19,'7–8 PM'],[20,'8–9 PM']
];

// Valid start hours per day of week: 0=Sun, 6=Sat, 1-5=weekday
function getValidHoursForDow(dow) {
  if (dow === 6) return new Set([8,9,10,11,12,13,14,15,16,17,18,19]); // Sat: 8am–8pm
  if (dow === 0) return new Set([13,14,15,16,17,18,19]);               // Sun: 1pm–8pm
  return new Set([17,18,19,20]);                                        // Mon–Fri: 5–9pm
}

// Build a slotMap from a booking results array: date -> bool[] indexed by GYM_SLOTS
function buildSlotMap(bookings) {
  const map = new Map();
  for (const b of bookings) {
    const [sh, sm] = b.start_time.split(':').map(Number);
    const [eh, em] = b.end_time.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins   = eh * 60 + em;
    if (!map.has(b.booking_date)) map.set(b.booking_date, Array(GYM_SLOTS.length).fill(false));
    const slots = map.get(b.booking_date);
    GYM_SLOTS.forEach(([h], i) => {
      if (startMins < (h + 1) * 60 && endMins > h * 60) slots[i] = true;
    });
  }
  return map;
}

function buildMonthCalendar(year, month, slotMap, blockedDates, token) {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  let out = `<div class="cal-month">
<div class="cal-month-name">${MONTH_NAMES[month]} ${year}</div>
<table class="cal-table">
<tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr>
<tr>`;

  for (let i = 0; i < startDow; i++) out += '<td></td>';
  let dow = startDow;

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const mm = (month + 1).toString().padStart(2, '0');
    const dd = d.toString().padStart(2, '0');
    const ds = `${year}-${mm}-${dd}`;
    const isPast    = ds < today;
    const isBlocked = blockedDates.has(ds);
    const dowForDay = new Date(ds + 'T12:00:00').getDay();
    const validH    = getValidHoursForDow(dowForDay);
    const slots     = slotMap.get(ds) || Array(GYM_SLOTS.length).fill(false);
    const validTaken = GYM_SLOTS.map(([h], i) => validH.has(h) ? slots[i] : null).filter(s => s !== null);
    const allTaken  = validTaken.length > 0 && validTaken.every(s => s);

    let cell;
    if (isPast || isBlocked) {
      const naPips = GYM_SLOTS.map(([h]) => validH.has(h) ? `<span class="slot-pip slot-na"></span>` : '').join('');
      cell = `<span class="cal-day-cell ${isPast ? 'cal-past' : 'cal-blocked'}">
  <span class="cal-num">${d}</span>
  <div class="slot-pips">${naPips}</div>
</span>`;
    } else {
      const pips = GYM_SLOTS.map(([h, label], i) =>
        validH.has(h) ? `<span class="slot-pip ${slots[i] ? 'slot-taken' : 'slot-open'}" title="${label}"></span>` : ''
      ).join('');
      cell = `<a href="/gym/book/${token}/day?dt=${ds}" class="cal-day-cell${allTaken ? ' cal-full' : ''}">
  <span class="cal-num">${d}</span>
  <div class="slot-pips">${pips}</div>
</a>`;
    }

    out += `<td>${cell}</td>`;
    dow++;
    if (dow === 7 && d < lastDay.getDate()) { out += '</tr><tr>'; dow = 0; }
  }
  while (dow > 0 && dow < 7) { out += '<td></td>'; dow++; }
  out += '</tr></table></div>';
  return out;
}

// Builds the TinyMCE rich-text editor section for the body field
function tlcUploadHandler(blobInfo) {
  return new Promise(function(resolve, reject) {
    var fd = new FormData();
    fd.append('file', blobInfo.blob(), blobInfo.filename());
    fetch('/api/upload-image', { method: 'POST', body: fd })
      .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
      .then(function(d) { d && d.location ? resolve(d.location) : reject('Bad response'); })
      .catch(function(err) { reject('Upload failed: ' + err); });
  });
}

function tinymceEditorSection(existingBody = '') {
  const safe = (existingBody || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Full text <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, shown when reader clicks "Read more"</span></label>
  <textarea id="body-editor" name="body"></textarea>
</div>
<script>
tinymce.init({
  selector: '#body-editor',
  plugins: 'image link lists blockquote table code',
  toolbar: 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code',
  menubar: false,
  min_height: 320,
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  image_advtab: false,
  image_caption: false,
  object_resizing: true,
  resize_img_proportional: true,
  automatic_uploads: true,
  images_upload_handler: ${tlcUploadHandler},
  paste_data_images: true,
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
  },
  init_instance_callback: function(editor) {
    var initialBody = \`${safe}\`;
    if (initialBody.trim()) editor.setContent(initialBody);
  }
});
document.querySelector('form').addEventListener('submit', function(e) {
  e.preventDefault();
  var form = this;
  var ed = tinymce.get('body-editor');
  if (!ed) { form.submit(); return; }
  ed.uploadImages().then(function() { ed.save(); form.submit(); });
});
<\/script>`;
}

// ── HELPERS ─────────────────────────────────────────────────
function authCookie(req) {
  const cookie = req.headers.get('cookie') || '';
  return cookie.includes('tlc_auth=authenticated');
}

function setCookieHeader() {
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  return `tlc_auth=authenticated; Path=/; Expires=${exp}; HttpOnly; SameSite=Strict`;
}


function html(body, title = 'TLC Admin', extraHead = '') {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;600;700;800&family=Lora:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
${extraHead}
<style>
:root{--steel:#0A3C5C;--amber:#D4922A;--sage:#6B8F71;--warm:#FAF7F0;--linen:#F2EDE2;--mist:#EDF5F8;--border:#E8E0D0;--charcoal:#3D3530;--gray:#7A6E60;--white:#fff;--sans:'Source Sans 3',Arial,sans-serif;--serif:'Lora',Georgia,serif;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:var(--sans);background:var(--warm);color:var(--charcoal);min-height:100vh;}
.topbar{background:var(--steel);border-bottom:3px solid var(--amber);padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between;}
.topbar-brand{font-family:var(--sans);font-size:14px;font-weight:800;color:white;}
.topbar-sub{font-family:var(--sans);font-size:11px;color:var(--amber);}
.topbar-links{display:flex;gap:16px;}
.topbar-links a{font-family:var(--sans);font-size:12px;font-weight:700;color:rgba(255,255,255,.7);text-decoration:none;}
.topbar-links a:hover{color:white;}
.wrap{max-width:860px;margin:0 auto;padding:40px 28px;}
.page-title{font-family:var(--serif);font-size:28px;color:var(--steel);margin-bottom:4px;}
.page-sub{font-family:var(--sans);font-size:14px;color:var(--gray);margin-bottom:32px;}
.card{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:28px;margin-bottom:20px;}
.card-title{font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border);}
.form-group{margin-bottom:18px;}
label{display:block;font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:6px;}
input[type=text],input[type=password],input[type=date],input[type=time],input[type=email],textarea,select{width:100%;background:var(--white);border:1px solid var(--border);border-radius:6px;padding:10px 14px;font-family:var(--sans);font-size:14px;color:var(--charcoal);outline:none;transition:border-color .2s,box-shadow .2s;}
input:focus,textarea:focus,select:focus{border-color:var(--amber);box-shadow:0 0 0 3px rgba(212,146,42,.12);}
textarea{min-height:100px;resize:vertical;line-height:1.65;}
.btn{display:inline-flex;align-items:center;gap:8px;font-family:var(--sans);font-size:14px;font-weight:700;padding:11px 24px;border-radius:6px;border:none;cursor:pointer;text-decoration:none;transition:background .2s,transform .15s;line-height:1;}
.btn:hover{transform:translateY(-1px);}
.btn-primary{background:var(--steel);color:white;}
.btn-primary:hover{background:#2A5470;}
.btn-secondary{background:var(--amber);color:var(--steel);}
.btn-secondary:hover{background:#C07D1E;color:white;}
.btn-sage{background:var(--sage);color:white;}
.btn-sage:hover{background:#5a7860;}
.btn-danger{background:#B85C3A;color:white;}
.btn-danger:hover{background:#9a4a2e;}
.btn-sm{font-size:12px;padding:7px 14px;}
.btn-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;}
.event-block{background:var(--linen);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:12px;position:relative;}
.event-block .event-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.event-block .remove-event{position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;color:var(--gray);font-size:18px;line-height:1;}
.event-block .remove-event:hover{color:#B85C3A;}
.add-event-btn{background:var(--mist);border:1px dashed var(--border);border-radius:8px;padding:14px;width:100%;text-align:center;cursor:pointer;font-family:var(--sans);font-size:13px;font-weight:700;color:var(--sage);transition:background .2s;}
.add-event-btn:hover{background:var(--linen);}
.alert{padding:14px 18px;border-radius:8px;font-family:var(--sans);font-size:14px;margin-bottom:20px;}
.alert-success{background:#e8f5e9;border-left:3px solid var(--sage);color:#1a3d1f;}
.alert-error{background:#fce8e8;border-left:3px solid #B85C3A;color:#7a1f1f;}
.alert-info{background:var(--mist);border-left:3px solid var(--steel);color:var(--steel);}
.newsletter-row{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.newsletter-row:last-child{border-bottom:none;}
.newsletter-date{font-family:var(--sans);font-size:11px;font-weight:700;color:var(--gray);min-width:100px;}
.newsletter-subject{font-family:var(--serif);font-size:16px;color:var(--steel);flex:1;}
.newsletter-actions{display:flex;gap:8px;}
.radio-row{display:flex;gap:16px;margin-top:6px;}
.radio-row label{font-family:var(--sans);font-size:13px;font-weight:600;color:var(--charcoal);letter-spacing:0;text-transform:none;display:flex;align-items:center;gap:6px;cursor:pointer;}
.radio-row input[type=radio]{width:auto;}
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--steel);}
.login-card{background:white;border-radius:20px;padding:40px;width:100%;max-width:360px;text-align:center;}
.login-title{font-family:var(--serif);font-size:24px;color:var(--steel);margin-bottom:4px;}
.login-sub{font-family:var(--sans);font-size:13px;color:var(--gray);margin-bottom:28px;}
.login-card .form-group{text-align:left;}
.divider{border:none;border-top:1px solid var(--border);margin:24px 0;}
.tag{font-family:var(--sans);font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--mist);color:var(--steel);}
.preview-box{background:var(--linen);border:1px solid var(--border);border-radius:10px;padding:20px;margin-top:16px;font-size:13px;color:var(--gray);font-style:italic;}
.tab-nav{background:var(--linen);border-bottom:2px solid var(--border);}
.tab-nav-inner{max-width:860px;margin:0 auto;padding:0 28px;display:flex;}
.tab{font-family:var(--sans);font-size:13px;font-weight:700;color:var(--gray);padding:12px 20px;text-decoration:none;border-bottom:3px solid transparent;margin-bottom:-2px;display:inline-block;transition:color .15s;}
.tab:hover{color:var(--steel);}
.tab-active{color:var(--steel);border-bottom-color:var(--amber);}
.tab-external{color:var(--gray);font-weight:600;border-left:1px solid var(--border);margin-left:8px;padding-left:24px;}
.tab-external:hover{color:var(--steel);}
.ni-row{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.ni-row:last-child{border-bottom:none;}
.ni-title{font-family:var(--serif);font-size:16px;color:var(--steel);flex:1;min-width:160px;}
.ni-meta{font-family:var(--sans);font-size:11px;color:var(--gray);white-space:nowrap;}
.ni-actions{display:flex;gap:8px;flex-shrink:0;}
.badge{font-family:var(--sans);font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;}
.badge-active{background:#e8f5e9;color:#1a3d1f;}
.badge-expired{background:#fce8e8;color:#7a1f1f;}
.badge-upcoming{background:var(--mist);color:var(--steel);}
.badge-pinned{background:#FFF3D6;color:#7A4F00;}
.checkbox-row{display:flex;align-items:center;gap:8px;margin-top:6px;}
.checkbox-row input[type=checkbox]{width:auto;}
.checkbox-row span{font-family:var(--sans);font-size:13px;font-weight:600;color:var(--charcoal);cursor:pointer;}
.format-picker{display:flex;gap:14px;margin-bottom:24px;flex-wrap:wrap;}
.format-card{flex:1;min-width:180px;border:2px solid var(--border);border-radius:12px;padding:20px 18px;text-align:left;background:white;cursor:pointer;transition:border-color .18s,background .18s;}
.format-card:hover{border-color:var(--steel);background:var(--mist);}
.format-card.active{border-color:var(--steel);background:var(--mist);}
.format-card-icon{font-size:26px;margin-bottom:8px;}
.format-card-name{font-family:var(--sans);font-size:14px;font-weight:700;color:var(--steel);}
.format-card-desc{font-family:var(--sans);font-size:12px;color:var(--gray);margin-top:4px;line-height:1.5;}
.badge-draft{background:#FFF3D6;color:#7A4F00;}
.badge-published{background:#e8f5e9;color:#1a3d1f;}
.nl-section-head{font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gray);padding:10px 0 6px;border-top:2px solid var(--border);margin-top:4px;}
.nl-section-head:first-child{border-top:none;margin-top:0;}
</style>
</head>
<body>${body}</body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.tiny.cloud 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.tiny.cloud; font-src https://fonts.gstatic.com https://cdn.tiny.cloud; img-src 'self' data: blob: https:; connect-src 'self' https://cdn.tiny.cloud; frame-src 'self' https://cdn.tiny.cloud;"
    }
  });
}

// TinyMCE editor for ministry post body field
function tinymcePostSection(existingBody = '') {
  const safe = (existingBody || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Post content</label>
  <textarea id="post-editor" name="body"></textarea>
</div>
<script>
tinymce.init({
  selector: '#post-editor',
  plugins: 'image link lists blockquote table code',
  toolbar: 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code',
  menubar: false,
  min_height: 400,
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  image_advtab: false,
  automatic_uploads: true,
  images_upload_handler: ${tlcUploadHandler},
  paste_data_images: true,
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) editor.setContent(initial);
  }
});
document.querySelector('form').addEventListener('submit', function(e) {
  e.preventDefault();
  var form = this;
  var ed = tinymce.get('post-editor');
  if (!ed) { form.submit(); return; }
  ed.uploadImages().then(function() { ed.save(); form.submit(); });
});
<\/script>`;
}

// TinyMCE editor for sermon notes / outline field
function tinymceSermonSection(existingOutline = '') {
  const safe = (existingOutline || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Notes / outline</label>
  <textarea id="sermon-editor" name="outline"></textarea>
</div>
<script>
tinymce.init({
  selector: '#sermon-editor',
  plugins: 'link lists blockquote code',
  toolbar: 'undo redo | blocks | bold italic underline | bullist numlist | link | code',
  menubar: false,
  min_height: 300,
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) editor.setContent(initial);
  }
});
document.querySelector('form').addEventListener('submit', function(e) {
  e.preventDefault();
  var form = this;
  var ed = tinymce.get('sermon-editor');
  if (!ed) { form.submit(); return; }
  ed.save(); form.submit();
});
<\/script>`;
}

// TinyMCE editor for youth page content field
function tinymceYouthSection(existingContent = '') {
  const safe = (existingContent || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Page content</label>
  <textarea id="youth-editor" name="content"></textarea>
</div>
<script>
tinymce.init({
  selector: '#youth-editor',
  plugins: 'image link lists blockquote table code',
  toolbar: 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code',
  menubar: false,
  min_height: 400,
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  image_advtab: false,
  automatic_uploads: true,
  images_upload_handler: ${tlcUploadHandler},
  paste_data_images: true,
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) editor.setContent(initial);
  }
});
document.querySelector('form').addEventListener('submit', function(e) {
  e.preventDefault();
  var form = this;
  var ed = tinymce.get('youth-editor');
  if (!ed) { form.submit(); return; }
  ed.uploadImages().then(function() { ed.save(); form.submit(); });
});
<\/script>`;
}

// TinyMCE editor for page content blocks (no image upload)
function tinymcePageSection(existingContent = '') {
  const safe = (existingContent || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Block content</label>
  <textarea id="page-editor" name="content"></textarea>
</div>
<script>
tinymce.init({
  selector: '#page-editor',
  plugins: 'link lists blockquote code',
  toolbar: 'undo redo | blocks | bold italic underline | bullist numlist | link | code',
  menubar: false,
  min_height: 300,
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) editor.setContent(initial);
  }
});
document.querySelector('form').addEventListener('submit', function(e) {
  e.preventDefault();
  var form = this;
  var ed = tinymce.get('page-editor');
  if (!ed) { form.submit(); return; }
  ed.save(); form.submit();
});
<\/script>`;
}

// ── TOPBAR WITH TABS ─────────────────────────────────────────
function topbarHtml(activeTab, extraLinks = '') {
  return `<div class="topbar">
  <div>
    <div class="topbar-brand">Timothy Lutheran · Admin</div>
  </div>
  <div class="topbar-links">
    ${extraLinks}
    <a href="/logout">Sign out</a>
  </div>
</div>
<nav class="tab-nav">
  <div class="tab-nav-inner">
    <a href="/newsitems" class="tab${activeTab === 'news' ? ' tab-active' : ''}">News &amp; Events</a>
    <a href="/ministries" class="tab${activeTab === 'ministries' ? ' tab-active' : ''}">Ministries</a>
    <a href="/sermons" class="tab${activeTab === 'sermons' ? ' tab-active' : ''}">Sermons</a>
    <a href="/pages" class="tab${activeTab === 'pages' ? ' tab-active' : ''}">Pages</a>
    <a href="/staff" class="tab${activeTab === 'staff' ? ' tab-active' : ''}">Staff</a>
    <a href="/settings" class="tab${activeTab === 'settings' ? ' tab-active' : ''}">Settings</a>
    <a href="/gym-rentals" class="tab${activeTab === 'gym' ? ' tab-active' : ''}">Gym Rentals</a>
    <a href="https://volunteer.timothystl.org/scheduler" target="_blank" class="tab tab-external">Scheduler ↗</a>
    <a href="https://volunteer.timothystl.org/admin" target="_blank" class="tab tab-external">Volunteer Admin ↗</a>
  </div>
</nav>`;
}

// ── LOGIN PAGE ───────────────────────────────────────────────
function loginPage(error = '') {
  return html(`
<div class="login-wrap">
  <div class="login-card">
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:8px;">Timothy Lutheran Church</div>
    <div class="login-title">Newsletter Admin</div>
    <div class="login-sub">Sign in to manage news &amp; events</div>
    ${error ? `<div class="alert alert-error">${error}</div>` : ''}
    <form method="POST" action="/login">
      <div class="form-group">
        <label>Password</label>
        <input type="password" name="password" autofocus placeholder="Enter admin password">
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px;">Sign in</button>
    </form>
  </div>
</div>`, 'TLC Admin — Sign In');
}

// ── FORMAT DATE ──────────────────────────────────────────────
function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ── BREVO EMAIL SEND ─────────────────────────────────────────
async function sendBrevoNewsletter(env, { subject, htmlContent, listIds }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { error: 'BREVO_API_KEY secret not configured' };

  const createResp = await fetch('https://api.brevo.com/v3/emailCampaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      name: `TLC Newsletter — ${subject}`,
      subject,
      sender: { name: 'Timothy Lutheran Church', email: env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org' },
      replyTo: env.BREVO_REPLY_TO || env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org',
      htmlContent,
      recipients: { listIds }
    })
  });
  if (!createResp.ok) return { error: `Brevo create error: ${await createResp.text()}` };
  const { id } = await createResp.json();

  const sendResp = await fetch(`https://api.brevo.com/v3/emailCampaigns/${id}/sendNow`, {
    method: 'POST',
    headers: { 'api-key': apiKey }
  });
  if (!sendResp.ok) return { error: `Brevo send error: ${await sendResp.text()}` };
  return { success: true, campaignId: id };
}

// ── BREVO TRANSACTIONAL EMAIL ─────────────────────────────────
async function sendTransactionalEmail(env, { subject, htmlContent, toEmails }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { error: 'BREVO_API_KEY not configured' };
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender: { name: 'Timothy Lutheran Church', email: env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org' },
      replyTo: { email: env.BREVO_REPLY_TO || env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org' },
      to: toEmails.map(e => ({ email: e })),
      subject,
      htmlContent
    })
  });
  if (!resp.ok) return { error: `Brevo error: ${await resp.text()}` };
  return { success: true };
}

// ── BUILD BEEHIIV HTML ───────────────────────────────────────
function buildEmailHtml(subject, pastorNote, events, ministryContent, ministryType, publishedAt, newsItems = []) {
  const dateStr = formatDate(publishedAt);
  let eventsHtml = '';
  if (events && events.length) {
    eventsHtml = `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="padding-bottom:12px;font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;">Upcoming Events</td></tr>
  ${events.map(e => `
  <tr>
    <td style="padding:12px 0;border-top:1px solid #E8E0D0;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="60" style="vertical-align:top;">
            <div style="background:#0A3C5C;color:white;border-radius:6px;padding:6px 8px;text-align:center;width:48px;">
              <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.65;">${e.event_date ? new Date(e.event_date+'T12:00:00').toLocaleDateString('en-US',{month:'short'}) : ''}</div>
              <div style="font-family:'Lora',Georgia,serif;font-size:20px;line-height:1.1;">${e.event_date ? new Date(e.event_date+'T12:00:00').getDate() : ''}</div>
            </div>
          </td>
          <td style="padding-left:14px;vertical-align:top;">
            <div style="font-family:'Lora',Georgia,serif;font-size:15px;color:#0A3C5C;margin-bottom:3px;">${e.event_name || ''}</div>
            <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:12px;color:#7A6E60;">${e.event_time || ''}${e.event_desc ? ' · ' + e.event_desc : ''}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`).join('')}
</table>`;
  }

  let ministryHtml = '';
  if (ministryContent) {
    if (ministryType === 'image') {
      ministryHtml = `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="padding-bottom:12px;font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6B8F71;">From Our Ministries</td></tr>
  <tr><td><img src="${ministryContent}" style="max-width:100%;border-radius:10px;" alt="Ministry update"></td></tr>
</table>`;
    } else {
      ministryHtml = `
<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="padding-bottom:12px;font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6B8F71;">From Our Ministries</td></tr>
  <tr><td style="background:#EEF5EF;border-left:3px solid #6B8F71;border-radius:0 8px 8px 0;padding:14px 16px;font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;color:#3D3530;line-height:1.7;">${ministryContent.replace(/\n/g,'<br>')}</td></tr>
</table>`;
    }
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF7F0;font-family:'Source Sans 3',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F0;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <!-- HEADER -->
      <tr><td style="background:#0A3C5C;border-bottom:3px solid #D4922A;padding:20px 28px;border-radius:14px 14px 0 0;">
        <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;font-weight:800;color:white;">Timothy Lutheran Church</div>
        <div style="font-family:'Lora',Georgia,serif;font-size:11px;font-style:italic;color:#D4922A;margin-top:2px;">from our Neighborhood to the Nations</div>
      </td></tr>
      <!-- BODY -->
      <tr><td style="background:white;padding:32px 28px;border-radius:0 0 14px 14px;border:1px solid #E8E0D0;border-top:none;">
        <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:8px;">${dateStr}</div>
        <div style="font-family:'Lora',Georgia,serif;font-size:22px;color:#0A3C5C;margin-bottom:20px;">${subject}</div>
        ${pastorNote ? `
        <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:15px;color:#3D3530;line-height:1.8;margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #E8E0D0;">${pastorNote}</div>` : ''}
        ${newsItems.length ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
          <tr><td style="padding-bottom:12px;font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;">News &amp; Updates</td></tr>
          ${newsItems.map(item => `
          <tr><td style="padding:14px 0;border-top:1px solid #E8E0D0;">
            <div style="font-family:'Lora',Georgia,serif;font-size:16px;color:#0A3C5C;margin-bottom:6px;">${item.title}</div>
            ${item.summary ? `<div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;color:#3D3530;line-height:1.7;margin-bottom:8px;">${item.summary}</div>` : ''}
            <a href="https://timothystl.org/news" style="font-family:'Source Sans 3',Arial,sans-serif;font-size:12px;font-weight:700;color:#D4922A;text-decoration:none;">Read more →</a>
          </td></tr>`).join('')}
        </table>` : ''}
        ${eventsHtml}
        ${ministryHtml}
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #E8E0D0;text-align:center;">
          <a href="https://timothystl.org" style="display:inline-block;background:#0A3C5C;color:white;font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none;margin-right:10px;">Visit our website</a>
          <a href="https://timothystl.breezechms.com/give/online" style="display:inline-block;background:#D4922A;color:#0A3C5C;font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none;">Give online</a>
        </div>
        <div style="margin-top:24px;text-align:center;font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;color:#7A6E60;line-height:1.8;">
          6704 Fyler Ave · St. Louis, MO 63139<br>
          Sunday worship · 8:00 &amp; 10:45 am
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// TinyMCE editor for pastor's note
function tinymcePastorSection(existingBody = '') {
  const safe = (existingBody || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `
<div class="form-group">
  <label>Your message this week</label>
  <textarea id="pastor-editor" name="pastor_note"></textarea>
</div>
<script>
tinymce.init({
  selector: '#pastor-editor',
  plugins: 'image link lists blockquote table code',
  toolbar: 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code',
  menubar: false,
  min_height: 200,
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  image_advtab: false,
  image_caption: false,
  object_resizing: true,
  resize_img_proportional: true,
  automatic_uploads: true,
  images_upload_handler: ${tlcUploadHandler},
  paste_data_images: true,
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
  },
  init_instance_callback: function(editor) {
    var initialBody = \`${safe}\`;
    if (initialBody.trim()) editor.setContent(initialBody);
  }
});
document.querySelector('form').addEventListener('submit', function(e) {
  e.preventDefault();
  var form = this;
  var ed = tinymce.get('pastor-editor');
  if (!ed) { form.submit(); return; }
  ed.uploadImages().then(function() { ed.save(); form.submit(); });
});
<\/script>`;
}

// ── BUILD WEB HTML (for archive) ─────────────────────────────
function buildWebHtml(subject, pastorNote, events, ministryContent, ministryType, publishedAt) {
  return JSON.stringify({ subject, pastorNote, events, ministryContent, ministryType, publishedAt });
}

// ── MAIN HANDLER ─────────────────────────────────────────────
export default {
  async fetch(request, env) {
    try {
      return await this._fetch(request, env);
    } catch (e) {
      return new Response(`Worker error: ${e.message}\n\nStack: ${e.stack}`, {
        status: 500, headers: { 'Content-Type': 'text/plain' }
      });
    }
  },

  async _fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Init DB
    try { await env.DB.prepare(DB_INIT_NEWSLETTERS).run(); } catch (e) {}
    try { await env.DB.prepare(DB_INIT_EVENTS).run(); } catch (e) {}
    try { await env.DB.prepare(DB_INIT_NEWS_ITEMS).run(); } catch (e) {}
    try { await env.DB.prepare(DB_INIT_YOUTH_PAGES).run(); } catch (e) {}
    try { await env.DB.prepare(DB_INIT_MINISTRY_POSTS).run(); } catch (e) {}
    // Migrate: add has_posts column if it doesn't exist yet
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN has_posts INTEGER DEFAULT 0').run(); } catch (_) {}
    // Migrate: add event_date to news_items for sorting by event date independent of publish date
    try { await env.DB.prepare('ALTER TABLE news_items ADD COLUMN event_date TEXT').run(); } catch (_) {}
    // Migrate: add pinned to ministry_posts
    try { await env.DB.prepare('ALTER TABLE ministry_posts ADD COLUMN pinned INTEGER DEFAULT 0').run(); } catch (_) {}
    // Migrate: add event_date and expire_date to ministry_posts
    try { await env.DB.prepare('ALTER TABLE ministry_posts ADD COLUMN event_date TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE ministry_posts ADD COLUMN expire_date TEXT').run(); } catch (_) {}
    // Migrate: add content classification fields to news_items
    try { await env.DB.prepare('ALTER TABLE news_items ADD COLUMN theme TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE news_items ADD COLUMN content_type TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE news_items ADD COLUMN channels TEXT').run(); } catch (_) {}
    // Migrate: add status, format, and CTA fields to newsletters
    try { await env.DB.prepare("ALTER TABLE newsletters ADD COLUMN status TEXT DEFAULT 'published'").run(); } catch (_) {}
    try { await env.DB.prepare("ALTER TABLE newsletters ADD COLUMN format TEXT DEFAULT 'weekly'").run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN cta_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN cta_label TEXT').run(); } catch (_) {}
    // Pre-populate ministry page slugs so they're always editable
    for (const p of MINISTRY_SLUGS) {
      try {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO youth_pages (slug, title, content, has_posts, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(p.slug, p.title, '', p.has_posts, '').run();
      } catch (_) {}
    }
    // Ensure youth always has has_posts=1 (unconditional — handles NULL from ALTER TABLE)
    try { await env.DB.prepare("UPDATE youth_pages SET has_posts = 1 WHERE slug = 'youth'").run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_VOTERS_PAGE).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_SERMON_SERIES).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_SERMON_NOTES).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_PAGE_CONTENT).run(); } catch (_) {}
    // Migrate: add CTA fields to ministry pages (youth_pages)
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN cta_label TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN cta_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN cta_label_2 TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN cta_url_2 TEXT').run(); } catch (_) {}
    // Migrate: add published flag to page_content
    try { await env.DB.prepare('ALTER TABLE page_content ADD COLUMN published INTEGER DEFAULT 1').run(); } catch (_) {}
    // New tables
    try { await env.DB.prepare(DB_INIT_STAFF_MEMBERS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_SITE_SETTINGS).run(); } catch (_) {}
    // Gym rental tables
    try { await env.DB.prepare(DB_INIT_GYM_GROUPS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_GYM_BOOKINGS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_GYM_RECURRENCES).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_GYM_BLOCKED).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_GYM_INVOICES).run(); } catch (_) {}
    // Pre-populate staff members (only if table is empty)
    try {
      const staffCount = await env.DB.prepare('SELECT COUNT(*) as n FROM staff_members').first();
      if (!staffCount || staffCount.n === 0) {
        for (const s of INITIAL_STAFF) {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO staff_members (name, title, email, photo_url, bio, display_order) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(s.name, s.title, s.email, s.photo_url, s.bio, s.display_order).run();
        }
      }
    } catch (_) {}
    // Pre-populate site settings
    for (const s of INITIAL_SETTINGS) {
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO site_settings (key, value, label, hint) VALUES (?, ?, ?, ?)').bind(s.key, s.value, s.label, s.hint).run();
      } catch (_) {}
    }
    // Pre-populate editable page content blocks
    const PAGE_BLOCKS = [
      { key: 'home-notice',       label: 'Home page notice',        hint: 'Shown on the home page as a banner. Leave blank to hide.' },
      { key: 'worship-notice',    label: 'Worship notice',          hint: 'Shown on the Worship page (e.g. special service times, holiday changes). Leave blank to hide.' },
      { key: 'about-notice',      label: 'About page notice',       hint: 'Shown on the About page. Leave blank to hide.' },
      { key: 'seasonal-lent',         label: 'Lent / Midweek worship',        hint: 'Shown on the Worship page during Lent. Toggle on/off without losing content.' },
      { key: 'seasonal-easter',        label: 'Holy Week &amp; Easter',            hint: 'Shown on the Worship page for Holy Week and Easter services. Toggle on/off without losing content.' },
      { key: 'seasonal-thanksgiving',  label: 'Thanksgiving worship',          hint: 'Shown on the Worship page around Thanksgiving. Toggle on/off without losing content.' },
      { key: 'seasonal-advent',        label: 'Advent worship',                hint: 'Shown on the Worship page during Advent. Toggle on/off without losing content.' },
      { key: 'seasonal-christmas',     label: 'Christmas services',            hint: 'Shown on the Worship page for Christmas Eve / Christmas Day services. Toggle on/off without losing content.' },
      { key: 'community-concert',      label: 'Community Concert announcement', hint: 'Shown on the Music Ministry page. Edit with performer name, date, and details. Toggle off between concerts.' },
    ];
    for (const b of PAGE_BLOCKS) {
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO page_content (key, label, value, published, updated_at) VALUES (?, ?, ?, ?, ?)').bind(b.key, b.label, '', 0, '').run();
      } catch (_) {}
    }
    // Remove legacy page content keys that have been replaced or retired
    for (const oldKey of ['seasonal-worship', 'staff-intro']) {
      try { await env.DB.prepare('DELETE FROM page_content WHERE key = ?').bind(oldKey).run(); } catch (_) {}
    }
    // Remove legacy site_settings keys no longer shown in UI
    for (const oldKey of ['give_embed_code', 'gym_ical_token']) {
      try { await env.DB.prepare('DELETE FROM site_settings WHERE key = ?').bind(oldKey).run(); } catch (_) {}
    }
    // Migrate give_url from Breeze to Tithely
    try {
      await env.DB.prepare("UPDATE site_settings SET value = ? WHERE key = 'give_url' AND value LIKE '%breezechms%'")
        .bind('https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8').run();
    } catch (_) {}

    // ── PUBLIC: serve uploaded docs from R2 ──
    if (path.startsWith('/docs/') && method === 'GET') {
      const key = 'docs-' + path.slice('/docs/'.length);
      const obj = await env.IMAGES.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('Cache-Control', 'public, max-age=3600');
      return new Response(obj.body, { headers });
    }

    // ── PUBLIC: serve uploaded images from R2 ──
    if (path.startsWith('/images/') && method === 'GET') {
      const key = path.slice('/images/'.length);
      const obj = await env.IMAGES.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(obj.body, { headers });
    }

    // ── PUBLIC: news items API ──
    if (path === '/api/news' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const today = new Date().toISOString().split('T')[0];
      const rows = await env.DB.prepare(
        `SELECT id, title, summary, body, image_url, publish_date, event_date, expire_date, pinned, theme, content_type, channels
         FROM news_items
         WHERE publish_date <= ? AND (expire_date IS NULL OR expire_date >= ?)
           AND (channels IS NULL OR channels LIKE '%web%')
         ORDER BY pinned DESC, COALESCE(event_date, publish_date) ASC
         LIMIT ?`
      ).bind(today, today, limit).all();
      return new Response(JSON.stringify(rows.results), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: youth page content API (legacy — keep for compat) ──
    if (path.startsWith('/api/youth/') && method === 'GET') {
      const slug = path.slice('/api/youth/'.length);
      const row = await env.DB.prepare('SELECT slug, title, content, updated_at FROM youth_pages WHERE slug = ?').bind(slug).first();
      if (!row) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(row), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: ministry content API ──
    if (path.startsWith('/api/ministry/') && method === 'GET') {
      const rest = path.slice('/api/ministry/'.length);
      const parts = rest.split('/');
      const slug = parts[0];
      if (parts[1] === 'posts') {
        const today2 = new Date().toISOString().split('T')[0];
        const rows = await env.DB.prepare(
          'SELECT id, ministry_slug, title, post_date, event_date, expire_date, pinned, body, created_at FROM ministry_posts WHERE ministry_slug = ? AND (expire_date IS NULL OR expire_date >= ?) ORDER BY pinned DESC, COALESCE(event_date, post_date) ASC, id ASC'
        ).bind(slug, today2).all();
        const fixUrl = s => s ? s.replace(/src="\/images\//g, 'src="https://admin.timothystl.org/images/') : s;
        const fixed = rows.results.map(r => ({ ...r, body: fixUrl(r.body) }));
        return new Response(JSON.stringify(fixed), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const row = await env.DB.prepare('SELECT slug, title, content, has_posts, cta_label, cta_url, cta_label_2, cta_url_2, updated_at FROM youth_pages WHERE slug = ?').bind(slug).first();
      if (!row) return new Response('Not found', { status: 404 });
      const fixUrl = s => s ? s.replace(/src="\/images\//g, 'src="https://admin.timothystl.org/images/') : s;
      return new Response(JSON.stringify({ ...row, content: fixUrl(row.content) }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: page content blocks API ──
    if (path.startsWith('/api/page-content/') && method === 'GET') {
      const key = path.slice('/api/page-content/'.length);
      const row = await env.DB.prepare('SELECT key, label, value, published FROM page_content WHERE key = ?').bind(key).first();
      if (!row) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(row), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: staff API ──
    if (path === '/api/staff' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT id, name, title, email, photo_url, bio, display_order FROM staff_members ORDER BY display_order, id').all();
      return new Response(JSON.stringify(rows.results), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: site settings API ──
    if (path.startsWith('/api/settings/') && method === 'GET') {
      const key = path.slice('/api/settings/'.length);
      const row = await env.DB.prepare('SELECT key, value FROM site_settings WHERE key = ?').bind(key).first();
      if (!row) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(row), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: newsletter archive API ──
    if (path === '/api/newsletters' && method === 'GET') {
      const rows = await env.DB.prepare(
        "SELECT id, subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, created_at FROM newsletters WHERE (status IS NULL OR status = 'published') ORDER BY published_at DESC"
      ).all();
      const newsletters = [];
      for (const row of rows.results) {
        const evts = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY event_date, sort_order').bind(row.id).all();
        newsletters.push({ ...row, events: evts.results });
      }
      return new Response(JSON.stringify(newsletters), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: single newsletter ──
    if (path.startsWith('/api/newsletter/') && method === 'GET') {
      const id = path.split('/').pop();
      const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(id).first();
      if (!row) return new Response('Not found', { status: 404 });
      const evts = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY event_date, sort_order').bind(id).all();
      return new Response(JSON.stringify({ ...row, events: evts.results }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: newsletter archive page ──
    if (path === '/news' && method === 'GET') {
      const rows = await env.DB.prepare(
        "SELECT id, subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, events FROM newsletters WHERE (status IS NULL OR status = 'published') ORDER BY published_at DESC"
      ).all();
      const newsletters = [];
      for (const row of rows.results) {
        const evts = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY event_date, sort_order').bind(row.id).all();
        newsletters.push({ ...row, events: evts.results });
      }

      const listHtml = newsletters.length === 0
        ? `<p style="text-align:center;padding:48px 0;color:#7A6E60;font-family:'Source Sans 3',Arial,sans-serif;">No newsletters yet — check back soon.</p>`
        : newsletters.map(n => {
            const dateStr = formatDate(n.published_at);
            const eventsHtml = n.events && n.events.length
              ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;">${n.events.map(e =>
                  `<span style="font-family:'Source Sans 3',Arial,sans-serif;font-size:12px;background:#EDF5F8;color:#0A3C5C;padding:3px 10px;border-radius:999px;">${e.event_date ? new Date(e.event_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' · ' : ''}${e.event_name}</span>`
                ).join('')}</div>`
              : '';
            return `
<div style="padding:24px 0;border-bottom:1px solid #E8E0D0;">
  <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:6px;">${dateStr}</div>
  <div style="font-family:'Lora',Georgia,serif;font-size:20px;color:#0A3C5C;margin-bottom:8px;">${n.subject}</div>
  ${n.pastor_note ? `<div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;color:#3D3530;line-height:1.75;">${n.pastor_note.replace(/\n/g,'<br>').substring(0,240)}${n.pastor_note.length > 240 ? '…' : ''}</div>` : ''}
  ${eventsHtml}
</div>`;
          }).join('');

      return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>News &amp; Updates — Timothy Lutheran Church</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;600;700;800&family=Lora:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Source Sans 3',Arial,sans-serif;background:#FAF7F0;color:#3D3530;min-height:100vh;}
.topbar{background:#0A3C5C;border-bottom:3px solid #D4922A;padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between;}
.topbar-brand{font-size:14px;font-weight:800;color:white;}
.topbar-sub{font-size:11px;color:#D4922A;font-style:italic;font-family:'Lora',Georgia,serif;}
.topbar-links a{font-size:13px;font-weight:600;color:rgba(255,255,255,.75);text-decoration:none;margin-left:20px;}
.topbar-links a:hover{color:white;}
.wrap{max-width:720px;margin:0 auto;padding:48px 28px;}
h1{font-family:'Lora',Georgia,serif;font-size:32px;color:#0A3C5C;margin-bottom:6px;}
.sub{font-size:14px;color:#7A6E60;margin-bottom:36px;}
</style>
</head>
<body>
<div class="topbar">
  <div>
    <div class="topbar-brand">Timothy Lutheran Church</div>
    <div class="topbar-sub">from our Neighborhood to the Nations</div>
  </div>
  <div class="topbar-links">
    <a href="https://timothystl.org">← Back to site</a>
  </div>
</div>
<div class="wrap">
  <h1>News &amp; Updates</h1>
  <p class="sub">Weekly newsletters from Pastor and the Timothy Lutheran family.</p>
  ${listHtml}
</div>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── PUBLIC: contact form submission ──
    if (path === '/api/contact' && method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
      if (request.method === 'OPTIONS') return new Response('', { headers: corsHeaders });
      try {
        const form = await request.formData();
        const name = (form.get('name') || '').trim();
        const email = (form.get('email') || '').trim();
        const message = (form.get('message') || '').trim();
        // Honeypot — bots fill this hidden field, humans never see it
        if (form.get('website')) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        if (!name || !message) return new Response(JSON.stringify({ error: 'Name and message are required' }), { status: 400, headers: corsHeaders });
        const html = `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email || '(not provided)'}</p><p><strong>Message:</strong></p><p style="white-space:pre-wrap">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`;
        const result = await sendTransactionalEmail(env, {
          subject: `Contact Form — ${name}`,
          htmlContent: html,
          toEmails: ['dinger@timothystl.org', 'office@timothystl.org']
        });
        if (result.error) return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders });
        // Confirmation email to user
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await sendTransactionalEmail(env, {
            subject: 'We received your message — Timothy Lutheran Church',
            htmlContent: `<p>Hi ${name},</p><p>Thank you for reaching out to Timothy Lutheran Church. We received your message and will be in touch soon.</p><p>If you need immediate assistance, please call us at (314) 839-0563 or email <a href="mailto:office@timothystl.org">office@timothystl.org</a>.</p><p>Grace and peace,<br>The team at Timothy Lutheran Church</p>`,
            toEmails: [email]
          });
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ── PUBLIC: prayer form submission ──
    if (path === '/api/prayer' && method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
      if (request.method === 'OPTIONS') return new Response('', { headers: corsHeaders });
      try {
        const form = await request.formData();
        const name = (form.get('name') || '').trim();
        const email = (form.get('email') || '').trim();
        const message = (form.get('message') || '').trim();
        // Honeypot — bots fill this hidden field, humans never see it
        if (form.get('website')) return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        if (!message) return new Response(JSON.stringify({ error: 'Prayer request is required' }), { status: 400, headers: corsHeaders });
        const htmlContent = `<p><strong>Name:</strong> ${name || '(anonymous)'}</p><p><strong>Email:</strong> ${email || '(not provided)'}</p><p><strong>Prayer request:</strong></p><p style="white-space:pre-wrap">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`;
        const result = await sendTransactionalEmail(env, {
          subject: `Prayer Request — ${name || 'Anonymous'}`,
          htmlContent,
          toEmails: ['dinger@timothystl.org', 'office@timothystl.org']
        });
        if (result.error) return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders });
        // Confirmation email to user
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await sendTransactionalEmail(env, {
            subject: "We're praying for you — Timothy Lutheran Church",
            htmlContent: `<p>Hi ${name || 'friend'},</p><p>Thank you for sharing your prayer request with us. Our pastoral staff has received it and will be praying for you.</p><p>If you'd like to speak with someone, please reach out to our office at <a href="mailto:office@timothystl.org">office@timothystl.org</a> or call (314) 839-0563.</p><p>Grace and peace,<br>The pastoral staff at Timothy Lutheran Church</p>`,
            toEmails: [email]
          });
        }
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ── PUBLIC: voters page data ──
    if (path === '/api/voters' && method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM voters_page WHERE id = 1').first();
      const data = row || { meeting_info: '', zoom_link: '', files_json: '[]' };
      let files = [];
      try { files = JSON.parse(data.files_json || '[]'); } catch(_) {}
      return new Response(JSON.stringify({ meeting_info: data.meeting_info || '', zoom_link: data.zoom_link || '', files }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── PUBLIC: sermon series API ──
    if (path === '/api/sermon-series' && method === 'GET') {
      const series = await env.DB.prepare('SELECT * FROM sermon_series ORDER BY active DESC, sort_order ASC, id DESC').all();
      const result = [];
      for (const s of series.results) {
        const notes = await env.DB.prepare('SELECT * FROM sermon_notes WHERE series_id = ? ORDER BY date DESC, id DESC').bind(s.id).all();
        result.push({ ...s, notes: notes.results });
      }
      // Also get standalone notes (no series)
      const standalone = await env.DB.prepare("SELECT * FROM sermon_notes WHERE series_id IS NULL OR series_id = 0 ORDER BY date DESC, id DESC LIMIT 20").all();
      return new Response(JSON.stringify({ series: result, standalone: standalone.results }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── GROUP BOOKING PORTAL (/gym/book/:token/*) ───────────────
    if (path.startsWith('/gym/book/')) {
      const parts  = path.split('/').filter(Boolean); // ['gym','book',TOKEN,...]
      const token  = parts[2] || '';
      const sub    = parts[3] || '';     // 'new'|'hold'|'confirm'|'history'|'confirm-hold'|'release-hold'
      const subId  = parts[4] || '';     // booking id for confirm-hold / release-hold

      // Token validation — runs for every portal request
      const group = token ? await env.DB.prepare('SELECT * FROM gym_groups WHERE access_token = ?').bind(token).first() : null;
      if (!group || !group.active) {
        return portalHtml(`
<div class="portal-header"><div class="portal-brand">Timothy Lutheran Church</div><div class="portal-title">Gym Rental Portal</div></div>
<div class="wrap" style="max-width:500px;text-align:center;padding-top:60px;">
  <div style="font-size:48px;margin-bottom:16px;">🔒</div>
  <div style="font-family:var(--serif);font-size:22px;color:var(--steel);margin-bottom:12px;">Link not found</div>
  <div style="font-size:15px;color:var(--gray);line-height:1.6;">This booking link is invalid or no longer active. Please contact the church office to request a new link.</div>
  <div style="margin-top:24px;font-size:13px;color:var(--gray);">office@timothystl.org</div>
</div>`, 'Booking Portal');
      }

      // Helper: portal header for this group
      const portalHeader = `<div class="portal-header">
  <div class="portal-brand">Timothy Lutheran Church</div>
  <div class="portal-title">Gym Rental Portal</div>
  <div class="portal-group">Welcome, ${group.name}</div>
</div>`;

      const portalNav = (active) => `<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
  <a href="/gym/book/${token}" class="btn btn-sm ${active==='cal'?'btn-primary':'btn-sage'}" style="text-decoration:none;">📅 Select Dates</a>
  <a href="/gym/book/${token}/history" class="btn btn-sm ${active==='hist'?'btn-primary':'btn-sage'}" style="text-decoration:none;">My Bookings</a>
</div>`;

      const portalMsg = url.searchParams.get('msg');
      const _pc = parseInt(url.searchParams.get('created') || '0', 10);
      const _ps = parseInt(url.searchParams.get('skipped') || '0', 10);
      const portalAlert = (portalMsg || '').startsWith('confirmed') && _pc > 0 ? `<div class="alert alert-success">✓ ${_pc} booking${_pc===1?'':'s'} confirmed! Invoices have been emailed to you.${_ps > 0 ? ` (${_ps} slot${_ps===1?'':'s'} were already taken and skipped.)` : ''}</div>`
        : (portalMsg || '').startsWith('holds') ? `<div class="alert alert-success">✓ ${_pc} hold${_pc===1?'':'s'} placed! They expire in 48 hours — confirm them below to lock in your booking.${_ps > 0 ? ` (${_ps} slot${_ps===1?'':'s'} were already taken and skipped.)` : ''}</div>`
        : portalMsg === 'nohold' ? `<div class="alert alert-error">No slots could be booked — they may have been taken or blocked. Please choose different times.</div>`
        : portalMsg === 'hold' ? `<div class="alert alert-success">✓ Hold placed! It expires in 48 hours. Confirm it below to lock in your booking.</div>`
        : portalMsg === 'confirmed' ? `<div class="alert alert-success">✓ Booking confirmed. You'll receive an invoice by email.</div>`
        : portalMsg === 'released' ? `<div class="alert alert-success">✓ Hold released.</div>`
        : portalMsg === 'converted' ? `<div class="alert alert-success">✓ Hold confirmed. Invoice emailed to you.</div>`
        : portalMsg === 'recurring' ? `<div class="alert alert-success">✓ Recurring request submitted! The church office will review it and follow up with you.</div>`
        : portalMsg === 'err' ? `<div class="alert alert-error">Please check the payment agreement box.</div>`
        : portalMsg === 'ratelimit' ? `<div class="alert alert-error">Too many holds at once. Please contact the office if you need to book more than 20 slots.</div>`
        : '';

      // ── SELECTION CALENDAR ────────────────────────────────────
      if (!sub || sub === '') {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const sixMonOut = new Date(today.getFullYear(), today.getMonth() + 6, 28).toISOString().split('T')[0];

        const [bookings, blocked] = await Promise.all([
          env.DB.prepare("SELECT booking_date, start_time, end_time FROM gym_bookings WHERE status IN ('confirmed','hold') AND booking_date >= ? AND booking_date <= ?").bind(todayStr, sixMonOut).all(),
          env.DB.prepare('SELECT date FROM gym_blocked_dates WHERE date >= ? AND date <= ?').bind(todayStr, sixMonOut).all(),
        ]);
        const slotMap      = buildSlotMap(bookings.results);
        const blockedSet   = new Set(blocked.results.map(b => b.date));

        // Build 6-month interactive selection calendar (month navigator)
        const MNAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const NUM_MONTHS = 6;
        let calHtml = '<div class="scal-wrap">';
        calHtml += `<div class="scal-nav">
  <button class="scal-nav-btn" id="scal-prev" onclick="navMonth(-1)" disabled>&#8249;</button>
  <div class="scal-nav-label" id="scal-nav-label"></div>
  <button class="scal-nav-btn" id="scal-next" onclick="navMonth(1)">&#8250;</button>
</div>`;
        for (let mi = 0; mi < NUM_MONTHS; mi++) {
          const d = new Date(today.getFullYear(), today.getMonth() + mi, 1);
          const yr = d.getFullYear(), mo = d.getMonth();
          const lastDay = new Date(yr, mo + 1, 0).getDate();
          const startDow = d.getDay();
          calHtml += `<div class="scal-month${mi === 0 ? ' active' : ''}" id="scal-month-${mi}" data-label="${MNAMES[mo]} ${yr}">
<table class="scal-table"><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr><tr>`;
          for (let s = 0; s < startDow; s++) calHtml += '<td></td>';
          let dow = startDow;
          for (let day = 1; day <= lastDay; day++) {
            const mm = (mo + 1).toString().padStart(2, '0');
            const dd = day.toString().padStart(2, '0');
            const ds = `${yr}-${mm}-${dd}`;
            const isPast = ds < todayStr;
            const isBlocked = blockedSet.has(ds);
            const dowForDate = new Date(ds + 'T12:00:00').getDay();
            const validHours = getValidHoursForDow(dowForDate);
            const slots = slotMap.get(ds) || Array(GYM_SLOTS.length).fill(false);
            let numCls = 'scal-cell';
            if (isPast) numCls += ' scal-past';
            else if (isBlocked) numCls += ' scal-blocked';
            const slotDivs = GYM_SLOTS.map(([h, label], i) => {
              if (isPast || isBlocked || !validHours.has(h)) return `<span class="scal-slot na"></span>`;
              if (slots[i]) return `<span class="scal-slot taken" data-label="${label} \u2014 Booked">${label}</span>`;
              const st = `${h.toString().padStart(2,'0')}:00`;
              const et = `${(h+1).toString().padStart(2,'0')}:00`;
              return `<span class="scal-slot open" data-date="${ds}" data-st="${st}" data-et="${et}" data-label="${label}">${label}</span>`;
            }).join('');
            calHtml += `<td><div class="${numCls}" id="cell-${ds}"><div class="scal-num">${day}</div><div class="scal-slots">${slotDivs}</div></div></td>`;
            dow++;
            if (dow === 7 && day < lastDay) { calHtml += '</tr><tr>'; dow = 0; }
          }
          while (dow > 0 && dow < 7) { calHtml += '<td></td>'; dow++; }
          calHtml += '</tr></table></div>';
        }
        calHtml += '</div>';

        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first();
        const rate = parseFloat(rateRow?.value || '25').toFixed(2);

        return portalHtml(`
${portalHeader}
<div class="wrap" style="padding-bottom:100px;">
  ${portalAlert}
  ${portalNav('cal')}
  <div class="card">
    <div class="card-title" style="margin-bottom:6px;">Select Your Dates &amp; Times</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">Tap any green slot to select it. Tap again to deselect. You can pick slots across multiple dates.</div>
    ${calHtml}
    <div class="scal-legend">
      <span><span class="legend-swatch" style="background:#5A9E6F;"></span> Available (tap to select)</span>
      <span><span class="legend-swatch" style="background:var(--amber);"></span> Selected</span>
      <span><span class="legend-swatch" style="background:#D17070;"></span> Already booked</span>
      <span><span class="legend-swatch" style="background:#E8EDF3;"></span> Unavailable</span>
    </div>
    <div style="font-size:12px;color:var(--gray);margin-top:10px;">Each slot = 1 hour ($${rate}/hr). &nbsp;Mon–Fri: 5–9 PM &nbsp;·&nbsp; Sat: 8 AM–8 PM &nbsp;·&nbsp; Sun: 1–8 PM</div>

    <!-- Pattern selector -->
    <div class="pattern-card">
      <div class="pattern-card-title">Quick-select by pattern</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:12px;">e.g. "Every Monday at 5–6 PM from March 1 to May 5"</div>
      <div class="pattern-fields">
        <div class="form-group">
          <label>Day of week</label>
          <select id="pat-dow">
            <option value="0">Sundays</option>
            <option value="1">Mondays</option>
            <option value="2">Tuesdays</option>
            <option value="3">Wednesdays</option>
            <option value="4">Thursdays</option>
            <option value="5">Fridays</option>
            <option value="6">Saturdays</option>
          </select>
        </div>
        <div class="form-group">
          <label>Time slot</label>
          <select id="pat-time">
            <option value="08:00">8–9 AM</option>
            <option value="09:00">9–10 AM</option>
            <option value="10:00">10–11 AM</option>
            <option value="11:00">11 AM–12 PM</option>
            <option value="12:00">12–1 PM</option>
            <option value="13:00">1–2 PM</option>
            <option value="14:00">2–3 PM</option>
            <option value="15:00">3–4 PM</option>
            <option value="16:00">4–5 PM</option>
            <option value="17:00">5–6 PM</option>
            <option value="18:00">6–7 PM</option>
            <option value="19:00">7–8 PM</option>
            <option value="20:00">8–9 PM</option>
          </select>
        </div>
        <div class="form-group">
          <label>From</label>
          <input type="date" id="pat-start" style="font-size:13px;padding:7px 10px;">
        </div>
        <div class="form-group">
          <label>To</label>
          <input type="date" id="pat-end" style="font-size:13px;padding:7px 10px;">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" onclick="patternSelect(true)">Select all matching</button>
          <button type="button" class="btn btn-secondary btn-sm" style="background:var(--linen);color:var(--steel);" onclick="patternSelect(false)">Deselect matching</button>
        </div>
      </div>
      <div id="pat-result" style="font-size:12px;color:var(--gray);margin-top:10px;"></div>
    </div>

  </div>

  <!-- Request form — shown after slots selected -->
  <div id="req-form-wrap" style="display:none;">
    <div class="card">
      <div class="card-title">Your Request</div>
      <div id="sel-summary-list" style="font-size:13px;color:var(--charcoal);margin-bottom:16px;line-height:1.8;"></div>
      <form method="POST" action="/gym/book/${token}/request-slots" id="req-form">
        <div id="slot-inputs"></div>
        <div class="form-group">
          <label>Notes <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional — activity type, etc.)</span></label>
          <textarea name="notes" rows="2" placeholder="e.g. Basketball practice"></textarea>
        </div>
        <div class="agree-card">
          <div style="background:#FFF8EC;border:1px solid #E8C87A;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#5A4200;">
            <strong>Proof of insurance required:</strong> Please submit a certificate of insurance naming Timothy Lutheran Church as an additional insured to <a href="mailto:dinger@timothystl.org" style="color:#2E7EA6;">dinger@timothystl.org</a> before your rental date.
          </div>
          <label class="agree-check">
            <input type="checkbox" name="agree" id="agree-box" required>
            <span>I agree to pay the rental fee ($${rate}/hr) to Timothy Lutheran Church upon confirmation of my booking.</span>
          </label>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
          <div>
            <button type="submit" formaction="/gym/book/${token}/request-slots" class="btn btn-amber">Place 48-hr Holds →</button>
            <div style="font-size:11px;color:var(--gray);margin-top:5px;">Reserve slots for 48 hrs — no invoice yet.<br>Confirm each hold to lock in and generate an invoice.</div>
          </div>
          <div>
            <button type="submit" formaction="/gym/book/${token}/confirm-slots" class="btn btn-primary">Book &amp; Confirm Now →</button>
            <div style="font-size:11px;color:var(--gray);margin-top:5px;">Immediately confirms all selected slots.<br>Invoices will be emailed for each booking.</div>
          </div>
          <button type="button" class="btn btn-secondary" style="background:var(--linen);color:var(--steel);align-self:center;" onclick="clearAll()">Clear</button>
        </div>
      </form>
    </div>
  </div>

</div>

<!-- Sticky request bar -->
<div class="req-bar" id="req-bar" style="display:none;">
  <div>
    <div class="req-bar-count" id="req-bar-count">0 slots selected</div>
    <div class="req-bar-detail" id="req-bar-detail"></div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-amber" onclick="scrollToForm()">Review &amp; Place Holds →</button>
  </div>
</div>

<script>
const selected = new Map(); // key "DATE|ST|ET" -> {date, st, et}
const SLOT_LABELS = {'08:00':'8–9 AM','09:00':'9–10 AM','10:00':'10–11 AM','11:00':'11 AM–12 PM','12:00':'12–1 PM','13:00':'1–2 PM','14:00':'2–3 PM','15:00':'3–4 PM','16:00':'4–5 PM','17:00':'5–6 PM','18:00':'6–7 PM','19:00':'7–8 PM','20:00':'8–9 PM'};
let curMonth = 0;
const NUM_MONTHS = 6;

// Month navigation
function navMonth(dir) {
  const next = curMonth + dir;
  if (next < 0 || next >= NUM_MONTHS) return;
  document.getElementById('scal-month-' + curMonth).classList.remove('active');
  curMonth = next;
  document.getElementById('scal-month-' + curMonth).classList.add('active');
  updateNav();
}
function updateNav() {
  document.getElementById('scal-prev').disabled = curMonth === 0;
  document.getElementById('scal-next').disabled = curMonth === NUM_MONTHS - 1;
  document.getElementById('scal-nav-label').textContent =
    document.getElementById('scal-month-' + curMonth).dataset.label;
}
updateNav();

// Slot click handler
function toggleSlot(el, doSelect) {
  const {date, st, et} = el.dataset;
  const key = date + '|' + st + '|' + et;
  const shouldSelect = (doSelect === undefined) ? !selected.has(key) : doSelect;
  if (shouldSelect) {
    selected.set(key, {date, st, et});
    el.classList.add('selected');
  } else {
    selected.delete(key);
    el.classList.remove('selected');
  }
  const anyInCell = [...selected.keys()].some(k => k.startsWith(date + '|'));
  const cell = document.getElementById('cell-' + date);
  if (cell) cell.classList.toggle('has-selection', anyInCell);
}

document.querySelectorAll('.scal-slot.open').forEach(el => {
  el.addEventListener('click', function() { toggleSlot(this); update(); });
});

function update() {
  const n = selected.size;
  const bar = document.getElementById('req-bar');
  bar.style.display = n > 0 ? '' : 'none';
  document.getElementById('req-bar-count').textContent = n + ' slot' + (n===1?'':'s') + ' selected';

  const byDate = {};
  selected.forEach(({date, st}) => {
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(SLOT_LABELS[st] || st);
  });
  const dates = Object.keys(byDate).sort();
  document.getElementById('req-bar-detail').textContent = dates.length <= 3
    ? dates.map(d => new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})).join(', ')
    : dates.length + ' dates';

  const inp = document.getElementById('slot-inputs');
  inp.innerHTML = '';
  selected.forEach((_, key) => {
    const h = document.createElement('input');
    h.type='hidden'; h.name='slots'; h.value=key;
    inp.appendChild(h);
  });

  const summaryHtml = dates.map(d => {
    const dn = new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    return '<strong>' + dn + '</strong>: ' + byDate[d].join(', ');
  }).join('<br>');
  document.getElementById('sel-summary-list').innerHTML = summaryHtml || '';
}

function scrollToForm() {
  document.getElementById('req-form-wrap').style.display = '';
  document.getElementById('req-form-wrap').scrollIntoView({behavior:'smooth', block:'start'});
}

function clearAll() {
  selected.clear();
  document.querySelectorAll('.scal-slot.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.scal-cell.has-selection').forEach(el => el.classList.remove('has-selection'));
  document.getElementById('req-form-wrap').style.display = 'none';
  update();
}

// Pattern selector
(function initPatternDates() {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  document.getElementById('pat-start').value = fmt(today);
  const end = new Date(today); end.setMonth(end.getMonth() + 1);
  document.getElementById('pat-end').value = fmt(end);
})();

function patternSelect(doSelect) {
  const dow   = parseInt(document.getElementById('pat-dow').value, 10);
  const time  = document.getElementById('pat-time').value;
  const start = document.getElementById('pat-start').value;
  const end   = document.getElementById('pat-end').value;
  if (!start || !end || start > end) {
    document.getElementById('pat-result').textContent = 'Please set a valid date range.';
    return;
  }
  const slots = document.querySelectorAll('.scal-slot.open[data-st="' + time + '"]');
  let matched = 0;
  slots.forEach(el => {
    const date = el.dataset.date;
    if (date < start || date > end) return;
    const d = new Date(date + 'T12:00:00');
    if (d.getDay() !== dow) return;
    toggleSlot(el, doSelect);
    matched++;
    // If slot is now visible in a different month, navigate to show first match
  });
  update();
  const DOW_NAMES = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
  const action = doSelect ? 'Selected' : 'Deselected';
  document.getElementById('pat-result').textContent = matched > 0
    ? action + ' ' + matched + ' slot' + (matched===1?'':'s') + ' \u2014 ' + DOW_NAMES[dow] + ' at ' + (SLOT_LABELS[time]||time) + ' between ' + new Date(start+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' and ' + new Date(end+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) + '.'
    : 'No available slots matched in that range.';
}
</script>
`, `${group.name} — Gym Rental`);
      }

      // ── NEW BOOKING FORM ──────────────────────────────────────
      if (sub === 'new' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const selDate  = url.searchParams.get('dt') || '';
        const selStart = url.searchParams.get('st') || '';
        const selEnd   = url.searchParams.get('et') || '';
        const errParam = url.searchParams.get('err');
        const errAlert = errParam === 'conflict'  ? `<div class="alert alert-error">That time slot overlaps an existing booking. Please choose a different time.</div>`
          : errParam === 'blocked'   ? `<div class="alert alert-error">That date is not available. Please choose a different date.</div>`
          : errParam === 'invalid'   ? `<div class="alert alert-error">End time must be after start time.</div>`
          : errParam === 'cap'       ? `<div class="alert alert-error">You've reached your hold limit. Please confirm or release an existing hold before placing a new one.</div>`
          : errParam === 'ratelimit' ? `<div class="alert alert-error">Too many requests. Please wait a bit before submitting again.</div>`
          : errParam === 'agree'     ? `<div class="alert alert-error">Please check the payment agreement box to confirm a booking.</div>`
          : '';

        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_rate_per_hour'").first();
        const rate = parseFloat(rateRow?.value || '25').toFixed(2);

        return portalHtml(`
${portalHeader}
<div class="wrap">
  ${errAlert}
  ${portalNav('new')}
  <div class="card">
    <div class="card-title">Request a Booking</div>
    <form method="POST" id="booking-form">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="form-group">
          <label>Date *</label>
          <input type="date" name="booking_date" required min="${today}" value="${selDate}" id="f-date">
        </div>
        <div class="form-group">
          <label>Start time *</label>
          <select name="start_time" required id="f-start" onchange="calcTotal()">
            <option value="">—</option>
            ${timeOptions(selStart)}
          </select>
        </div>
        <div class="form-group">
          <label>End time *</label>
          <select name="end_time" required id="f-end" onchange="calcTotal()">
            <option value="">—</option>
            ${timeOptions(selEnd)}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, e.g. "Basketball practice"</span></label>
        <textarea name="notes" placeholder="Brief description of your use…" rows="2"></textarea>
      </div>
      <div class="agree-card">
        <div style="background:#FFF8EC;border:1px solid #E8C87A;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#5A4200;">
          <strong>Proof of insurance required:</strong> Please submit a certificate of insurance naming Timothy Lutheran Church as an additional insured to <a href="mailto:dinger@timothystl.org" style="color:#2E7EA6;">dinger@timothystl.org</a> before your rental date.
        </div>
        <div class="total" id="total-display" style="display:none;">Estimated total: <span id="total-amt"></span></div>
        <div style="font-size:13px;color:var(--gray);margin-bottom:14px;">Rate: $${rate}/hr &nbsp;·&nbsp; Invoice emailed on confirmation &nbsp;·&nbsp; Payment by check or online</div>
        <label class="agree-check">
          <input type="checkbox" name="agree" id="agree-box">
          <span>I agree to pay the rental fee to Timothy Lutheran Church upon confirmation of this booking.</span>
        </label>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
        <div>
          <button type="submit" formaction="/gym/book/${token}/confirm" class="btn btn-primary">Book &amp; Confirm Now →</button>
          <div style="font-size:11px;color:var(--gray);margin-top:5px;">Immediately confirms the booking.<br>Invoice will be emailed to you.</div>
        </div>
        <div>
          <button type="submit" formaction="/gym/book/${token}/hold" class="btn btn-amber">Place 48-hr Hold</button>
          <div style="font-size:11px;color:var(--gray);margin-top:5px;">Reserves the slot for 48 hours.<br>No payment needed yet — confirm later to lock in.</div>
        </div>
      </div>
    </form>
  </div>
</div>
<script>
var rate = ${rate};
function calcTotal() {
  var s = document.getElementById('f-start').value;
  var e = document.getElementById('f-end').value;
  if (!s || !e || e <= s) { document.getElementById('total-display').style.display = 'none'; return; }
  var sh = parseInt(s.split(':')[0]), sm = parseInt(s.split(':')[1]);
  var eh = parseInt(e.split(':')[0]), em = parseInt(e.split(':')[1]);
  var hrs = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
  if (hrs <= 0) { document.getElementById('total-display').style.display = 'none'; return; }
  document.getElementById('total-amt').textContent = '$' + (hrs * rate).toFixed(2) + ' (' + hrs + ' hr' + (hrs !== 1 ? 's' : '') + ')';
  document.getElementById('total-display').style.display = 'block';
}
</script>`, `Book — ${group.name}`);
      }

      // ── SHARED: validate form fields ───────────────────────────
      async function validateBookingForm() {
        const form = await request.formData();
        return {
          booking_date: form.get('booking_date') || '',
          start_time:   form.get('start_time')   || '',
          end_time:     form.get('end_time')     || '',
          notes:        form.get('notes')        || '',
          agree:        form.get('agree')        || '',
        };
      }

      const backToForm = (err, fields = {}) => new Response('', { status: 302, headers: {
        Location: `/gym/book/${token}/new?err=${err}&dt=${fields.booking_date||''}&st=${encodeURIComponent(fields.start_time||'')}&et=${encodeURIComponent(fields.end_time||'')}` }});

      // ── PLACE HOLD ─────────────────────────────────────────────
      if (sub === 'hold' && method === 'POST') {
        const fields = await validateBookingForm();
        if (!fields.booking_date || !fields.start_time || !fields.end_time) return backToForm('invalid', fields);
        if (fields.end_time <= fields.start_time) return backToForm('invalid', fields);

        // Rate limiting (max 5 booking actions per 24hrs per group)
        const recent = await env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE group_id = ? AND created_at > datetime('now','-24 hours')").bind(group.id).first();
        if (recent.n >= 5) return backToForm('ratelimit', fields);

        // Hold cap
        const holdCount = await env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE group_id = ? AND status = 'hold'").bind(group.id).first();
        if (holdCount.n >= (group.max_active_holds || 3)) return backToForm('cap', fields);

        // Blocked date
        const blocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date = ?').bind(fields.booking_date).first();
        if (blocked) return backToForm('blocked', fields);

        // Conflict check
        const conflict = await env.DB.prepare(`SELECT id FROM gym_bookings WHERE booking_date = ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`).bind(fields.booking_date, fields.end_time, fields.start_time).first();
        if (conflict) return backToForm('conflict', fields);

        // Create hold
        const holdExpiresAt = new Date(Date.now() + 48 * 3600000).toISOString();
        await env.DB.prepare(`INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, hold_expires_at, created_by) VALUES (?, ?, ?, ?, ?, 'hold', ?, 'group')`
        ).bind(group.id, fields.booking_date, fields.start_time, fields.end_time, fields.notes, holdExpiresAt).run();

        // Notify admin
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
        if (adminEmailRow?.value) {
          try {
            await sendTransactionalEmail(env, {
              subject: `Gym hold placed \u2014 ${group.name} \u2014 ${formatDate(fields.booking_date)}`,
              htmlContent: `<p><strong>${group.name}</strong> placed a 48-hour hold:</p><p>Date: ${formatDate(fields.booking_date)}<br>Time: ${fmt12h(fields.start_time)} \u2013 ${fmt12h(fields.end_time)}</p><p>Visit <a href="https://admin.timothystl.org/gym-rentals">admin.timothystl.org/gym-rentals</a> to review.</p>`,
              toEmails: [adminEmailRow.value],
            });
          } catch (_) {}
        }

        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=hold` } });
      }

      // ── CONFIRM BOOKING ────────────────────────────────────────
      if (sub === 'confirm' && method === 'POST') {
        const fields = await validateBookingForm();
        if (!fields.booking_date || !fields.start_time || !fields.end_time) return backToForm('invalid', fields);
        if (fields.end_time <= fields.start_time) return backToForm('invalid', fields);
        if (!fields.agree) return backToForm('agree', fields);

        // Rate limiting
        const recent = await env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE group_id = ? AND created_at > datetime('now','-24 hours')").bind(group.id).first();
        if (recent.n >= 5) return backToForm('ratelimit', fields);

        // Blocked date + conflict
        const blocked  = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date = ?').bind(fields.booking_date).first();
        if (blocked) return backToForm('blocked', fields);
        const conflict = await env.DB.prepare(`SELECT id FROM gym_bookings WHERE booking_date = ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`).bind(fields.booking_date, fields.end_time, fields.start_time).first();
        if (conflict) return backToForm('conflict', fields);

        // Create confirmed booking
        const bRes = await env.DB.prepare(`INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, created_by) VALUES (?, ?, ?, ?, ?, 'confirmed', 'group')`
        ).bind(group.id, fields.booking_date, fields.start_time, fields.end_time, fields.notes).run();
        const bookingId = bRes.meta.last_row_id;

        // Invoice
        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_rate_per_hour'").first();
        const rate    = parseFloat(rateRow?.value || '25');
        const hours   = calcHours(fields.start_time, fields.end_time);
        const total   = Math.round(hours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];
        const iRes = await env.DB.prepare(`INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(group.id, bookingId, invoiceDate, fields.booking_date, fields.booking_date, hours, rate, total).run();
        const invoiceId = iRes.meta.last_row_id;

        // Email invoice
        const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id = ?').bind(invoiceId).first();
        const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, fields);
        const subject   = `Gym Rental Invoice \u2014 ${group.name} \u2014 ${formatDate(fields.booking_date)}`;
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
        const toEmails = [];
        if (adminEmailRow?.value) toEmails.push(adminEmailRow.value);
        if (group.email) toEmails.push(group.email);
        try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
        await addGymBookingToGCal(env, { ...fields, group_name: group.name });

        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=confirmed` } });
      }

      // ── CONVERT HOLD → CONFIRMED ──────────────────────────────
      if (sub === 'confirm-hold' && method === 'POST' && subId) {
        const bid = parseInt(subId, 10);
        const booking = await env.DB.prepare("SELECT * FROM gym_bookings WHERE id = ? AND group_id = ? AND status = 'hold'").bind(bid, group.id).first();
        if (!booking) return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/history` } });

        const form = await request.formData();
        if (!form.get('agree')) return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/history?err=agree` } });

        await env.DB.prepare("UPDATE gym_bookings SET status='confirmed', hold_expires_at=NULL WHERE id=?").bind(bid).run();

        // Invoice
        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_rate_per_hour'").first();
        const rate    = parseFloat(rateRow?.value || '25');
        const hours   = calcHours(booking.start_time, booking.end_time);
        const total   = Math.round(hours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];
        const iRes = await env.DB.prepare(`INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(group.id, bid, invoiceDate, booking.booking_date, booking.booking_date, hours, rate, total).run();
        const invoiceId = iRes.meta.last_row_id;

        const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id = ?').bind(invoiceId).first();
        const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, booking);
        const subject   = `Gym Rental Invoice \u2014 ${group.name} \u2014 ${formatDate(booking.booking_date)}`;
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
        const toEmails = [];
        if (adminEmailRow?.value) toEmails.push(adminEmailRow.value);
        if (group.email) toEmails.push(group.email);
        try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
        await addGymBookingToGCal(env, { ...booking, group_name: group.name });

        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=converted` } });
      }

      // ── RELEASE OWN HOLD ──────────────────────────────────────
      if (sub === 'release-hold' && method === 'POST' && subId) {
        const bid = parseInt(subId, 10);
        await env.DB.prepare("UPDATE gym_bookings SET status='released' WHERE id=? AND group_id=? AND status='hold'").bind(bid, group.id).run();
        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=released` } });
      }

      // ── BOOKING HISTORY ───────────────────────────────────────
      if (sub === 'history' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const [upcoming, past] = await Promise.all([
          env.DB.prepare("SELECT * FROM gym_bookings WHERE group_id = ? AND booking_date >= ? AND status IN ('confirmed','hold') ORDER BY booking_date, start_time").bind(group.id, today).all(),
          env.DB.prepare("SELECT * FROM gym_bookings WHERE group_id = ? AND booking_date < ? ORDER BY booking_date DESC LIMIT 20").bind(group.id, today).all(),
        ]);
        const histErr = url.searchParams.get('err') === 'agree' ? `<div class="alert alert-error">Please check the payment agreement box to confirm your hold.</div>` : '';

        const upHtml = upcoming.results.length === 0
          ? `<div style="padding:24px;text-align:center;color:var(--gray);font-size:14px;">No upcoming bookings.</div>`
          : upcoming.results.map(b => {
              const isHold = b.status === 'hold';
              const exp = b.hold_expires_at ? new Date(b.hold_expires_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
              return `
<div class="booking-row">
  <div style="flex:1;">
    <div class="booking-date">${fmtBookingDate(b.booking_date)}</div>
    <div class="booking-time">${fmt12h(b.start_time)} \u2013 ${fmt12h(b.end_time)}</div>
    ${isHold ? `<div style="font-size:11px;color:#7A4F00;margin-top:2px;">Hold expires ${exp}</div>` : ''}
  </div>
  <span class="badge ${isHold ? 'badge-hold' : 'badge-confirmed'}">${isHold ? 'Hold' : 'Confirmed'}</span>
  ${isHold ? `
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <form method="POST" action="/gym/book/${token}/confirm-hold/${b.id}">
      <input type="hidden" name="agree" value="on">
      <button type="submit" class="btn btn-sm btn-primary" onclick="return confirm('Confirm this booking? An invoice will be emailed to you.')">Confirm</button>
    </form>
    <form method="POST" action="/gym/book/${token}/release-hold/${b.id}" onsubmit="return confirm('Release this hold?')">
      <button type="submit" class="btn btn-sm btn-danger">Release</button>
    </form>
  </div>` : ''}
</div>`;
            }).join('');

        const pastHtml = past.results.length === 0
          ? `<div style="padding:16px;text-align:center;color:var(--gray);font-size:13px;">No past bookings.</div>`
          : past.results.map(b => `
<div class="booking-row">
  <div style="flex:1;">
    <div class="booking-date" style="color:var(--gray);">${fmtBookingDate(b.booking_date)}</div>
    <div class="booking-time">${fmt12h(b.start_time)} \u2013 ${fmt12h(b.end_time)}</div>
  </div>
  <span class="badge" style="background:var(--linen);color:var(--gray);">${b.status}</span>
</div>`).join('');

        return portalHtml(`
${portalHeader}
<div class="wrap">
  ${histErr}
  ${portalAlert}
  ${portalNav('hist')}
  <div class="card">
    <div class="card-title">Upcoming Bookings</div>
    ${upHtml}
  </div>
  <div class="card">
    <div class="card-title">Past Bookings</div>
    ${pastHtml}
  </div>
</div>`, `My Bookings — ${group.name}`);
      }

      // ── BATCH SLOT REQUEST ────────────────────────────────────
      if (sub === 'request-slots' && method === 'POST') {
        const form   = await request.formData();
        const slots  = form.getAll('slots');   // each "DATE|ST|ET"
        const notes  = form.get('notes') || '';
        const agree  = form.get('agree');
        const today  = new Date().toISOString().split('T')[0];

        if (!agree || !slots.length)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=agree` } });

        // Rate limit: max 20 new holds per submission, 8 per 24h per group
        if (slots.length > 20)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=ratelimit` } });
        const recentCount = await env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE group_id=? AND created_at > datetime('now','-24 hours')").bind(group.id).first();
        if ((recentCount?.n || 0) + slots.length > 20)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=ratelimit` } });

        const holdExpires = new Date(Date.now() + 48 * 3600000).toISOString().replace('T',' ').slice(0,19);
        let created = 0, skipped = 0;
        for (const slot of slots) {
          const [date, st, et] = slot.split('|');
          if (!date || !st || !et || date < today) { skipped++; continue; }
          const slotDow  = new Date(date + 'T12:00:00').getDay();
          const validH   = getValidHoursForDow(slotDow);
          if (!validH.has(parseInt(st.split(':')[0], 10))) { skipped++; continue; }
          const isBlocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date=?').bind(date).first();
          if (isBlocked) { skipped++; continue; }
          const conflict = await env.DB.prepare("SELECT id FROM gym_bookings WHERE booking_date=? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?").bind(date, et, st).first();
          if (conflict) { skipped++; continue; }
          try {
            await env.DB.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, hold_expires_at, created_by) VALUES (?, ?, ?, ?, ?, 'hold', ?, 'group')")
              .bind(group.id, date, st, et, notes, holdExpires).run();
            created++;
          } catch (_) { skipped++; }
        }

        // Notify admin
        if (created > 0) {
          const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
          const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
          try {
            await sendTransactionalEmail(env, {
              subject: `${created} hold(s) placed — ${group.name}`,
              htmlContent: `<p><strong>${group.name}</strong> placed ${created} hold(s) via the booking portal.</p><p>${skipped > 0 ? `(${skipped} slot(s) skipped due to conflicts.)` : ''}</p><p>Notes: ${notes || '—'}</p><p><a href="https://admin.timothystl.org/gym-rentals">Review at admin.timothystl.org/gym-rentals</a></p>`,
              toEmails: [adminEmail],
            });
          } catch (_) {}
        }

        const msg = created > 0 ? `holds${created}` : 'nohold';
        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/history?msg=${msg}&created=${created}&skipped=${skipped}` } });
      }

      // ── BATCH DIRECT CONFIRM ─────────────────────────────────
      if (sub === 'confirm-slots' && method === 'POST') {
        const form   = await request.formData();
        const slots  = form.getAll('slots');
        const notes  = form.get('notes') || '';
        const agree  = form.get('agree');
        const today  = new Date().toISOString().split('T')[0];

        if (!agree || !slots.length)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=agree` } });

        if (slots.length > 20)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=ratelimit` } });

        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first();
        const rate    = parseFloat(rateRow?.value || '25');
        const invoiceDate = new Date().toISOString().split('T')[0];
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';

        let created = 0, skipped = 0;
        for (const slot of slots) {
          const [date, st, et] = slot.split('|');
          if (!date || !st || !et || date < today) { skipped++; continue; }
          const slotDow = new Date(date + 'T12:00:00').getDay();
          const validH  = getValidHoursForDow(slotDow);
          if (!validH.has(parseInt(st.split(':')[0], 10))) { skipped++; continue; }
          const isBlocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date=?').bind(date).first();
          if (isBlocked) { skipped++; continue; }
          const conflict = await env.DB.prepare("SELECT id FROM gym_bookings WHERE booking_date=? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?").bind(date, et, st).first();
          if (conflict) { skipped++; continue; }
          try {
            const bRes = await env.DB.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, created_by) VALUES (?, ?, ?, ?, ?, 'confirmed', 'group')")
              .bind(group.id, date, st, et, notes).run();
            const bid   = bRes.meta.last_row_id;
            const hours = calcHours(st, et);
            const total = Math.round(hours * rate * 100) / 100;
            const iRes  = await env.DB.prepare(
              `INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
            ).bind(group.id, bid, invoiceDate, date, date, hours, rate, total).run();
            const invoiceId = iRes.meta.last_row_id;
            const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
            const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, { booking_date: date, start_time: st, end_time: et });
            const subject = `Gym Rental Confirmed — ${group.name} — ${formatDate(date)}`;
            const toEmails = [adminEmail];
            if (group.contact_email) toEmails.push(group.contact_email);
            try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
            await addGymBookingToGCal(env, { booking_date: date, start_time: st, end_time: et, group_name: group.name, notes });
            created++;
          } catch (_) { skipped++; }
        }

        const msg = created > 0 ? `confirmed${created}` : 'nohold';
        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/history?msg=${msg}&created=${created}&skipped=${skipped}` } });
      }

      // ── RECURRING REQUEST FORM ────────────────────────────────
      if (sub === 'recurring' && method === 'GET') {
        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const dowOpts = DOW_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
        const timeOpts5to9 = ['17:00','18:00','19:00','20:00','21:00'].map(t => `<option value="${t}">${fmt12h(t)}</option>`).join('');
        const today = new Date().toISOString().split('T')[0];
        const errParam = url.searchParams.get('err');
        const errAlert = errParam === 'invalid' ? `<div class="alert alert-error">Please fill in all required fields and ensure end time is after start time.</div>`
          : errParam === 'dates' ? `<div class="alert alert-error">Start date must be today or later, and end date must be after start date.</div>`
          : '';
        return portalHtml(`
${portalHeader}
<div class="wrap">
  ${portalNav('rec')}
  <div class="card">
    <div class="card-title" style="margin-bottom:4px;">Recurring Rental Request</div>
    <div style="font-size:14px;color:var(--gray);margin-bottom:20px;line-height:1.6;">Request the same time slot every week for a season. The church office will review your request and confirm the dates.</div>
    ${errAlert}
    <form method="POST" action="/gym/book/${token}/recurring">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group" style="grid-column:1/-1;">
          <label>Day of the week</label>
          <select name="day_of_week" required>${dowOpts}</select>
        </div>
        <div class="form-group">
          <label>Start time</label>
          <select name="start_time" required>${timeOpts5to9}</select>
        </div>
        <div class="form-group">
          <label>End time</label>
          <select name="end_time" required>${timeOpts5to9}</select>
        </div>
        <div class="form-group">
          <label>First date</label>
          <input type="date" name="start_date" required min="${today}">
        </div>
        <div class="form-group">
          <label>Last date</label>
          <input type="date" name="end_date" required min="${today}">
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label>Notes <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional — activity type, special needs, etc.)</span></label>
          <textarea name="notes" rows="3" placeholder="e.g. Basketball practice for youth group"></textarea>
        </div>
      </div>
      <div style="margin-top:8px;padding:14px 16px;background:var(--mist);border-radius:8px;font-size:13px;color:var(--steel);line-height:1.6;">
        Rental rate is $${(await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first())?.value||'25'}/hr. You will receive a monthly invoice once your request is approved.
      </div>
      <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
        <button type="submit" class="btn btn-primary">Submit Request →</button>
        <a href="/gym/book/${token}" class="btn btn-secondary" style="text-decoration:none;background:var(--linen);color:var(--steel);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'Recurring Request');
      }

      if (sub === 'recurring' && method === 'POST') {
        const form    = await request.formData();
        const dow     = parseInt(form.get('day_of_week') || '1', 10);
        const st      = form.get('start_time') || '';
        const et      = form.get('end_time')   || '';
        const sd      = form.get('start_date') || '';
        const ed      = form.get('end_date')   || '';
        const notes   = form.get('notes') || '';
        const today   = new Date().toISOString().split('T')[0];

        if (!st || !et || !sd || !ed || et <= st)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/recurring?err=invalid` } });
        if (sd < today || ed <= sd)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/recurring?err=dates` } });

        await env.DB.prepare(
          `INSERT INTO gym_recurrences (group_id, day_of_week, start_time, end_time, start_date, end_date, status, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?, 'group')`
        ).bind(group.id, dow, st, et, sd, ed, notes).run();

        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
        try {
          await sendTransactionalEmail(env, {
            subject: `Recurring rental request — ${group.name}`,
            htmlContent: `<p><strong>${group.name}</strong> submitted a recurring rental request:</p>
<ul>
  <li><strong>Day:</strong> ${DOW_NAMES[dow]}s</li>
  <li><strong>Time:</strong> ${fmt12h(st)} – ${fmt12h(et)}</li>
  <li><strong>Date range:</strong> ${formatDate(sd)} – ${formatDate(ed)}</li>
  ${notes ? `<li><strong>Notes:</strong> ${notes}</li>` : ''}
</ul>
<p><a href="https://admin.timothystl.org/gym-rentals">Review at admin.timothystl.org/gym-rentals</a></p>`,
            toEmails: [adminEmail],
          });
        } catch (_) {}

        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=recurring` } });
      }

      // Fallback: redirect to calendar
      return new Response('', { status: 302, headers: { Location: `/gym/book/${token}` } });
    } // end /gym/book

    // ── GYM ICAL FEED (public, token-protected) ──────────────────
    if (path.startsWith('/gym/cal/') && path.endsWith('.ics')) {
      const feedToken = path.slice('/gym/cal/'.length, -'.ics'.length);
      const tokenRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_ical_token'").first();
      const validToken = tokenRow?.value || '';
      if (!feedToken || feedToken !== validToken) {
        return new Response('Not found', { status: 404 });
      }
      const bookings = await env.DB.prepare(
        `SELECT b.*, g.name as group_name FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id WHERE b.status = 'confirmed' ORDER BY b.booking_date, b.start_time`
      ).all();
      const now = new Date();
      const stamp = now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
      const toIcalDt = (dateStr, timeStr) => {
        const [y,m,d] = dateStr.split('-');
        const [h,min] = timeStr.split(':');
        return `${y}${m}${d}T${h}${min}00`;
      };
      const events = bookings.results.map(b => [
        'BEGIN:VEVENT',
        `UID:gym-booking-${b.id}@timothystl.org`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${toIcalDt(b.booking_date, b.start_time)}`,
        `DTEND:${toIcalDt(b.booking_date, b.end_time)}`,
        `SUMMARY:${(b.group_name || 'Rental').replace(/[,;\\]/g,' ')} — ${fmt12h(b.start_time)}–${fmt12h(b.end_time)}`,
        b.notes ? `DESCRIPTION:${b.notes.replace(/\n/g,'\\n').replace(/[,;\\]/g,' ')}` : '',
        'LOCATION:Timothy Lutheran Church Gym',
        'END:VEVENT',
      ].filter(Boolean).join('\r\n')).join('\r\n');
      const ical = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Timothy Lutheran Church//Gym Rentals//EN',
        'X-WR-CALNAME:TLC Gym Rentals',
        'X-WR-TIMEZONE:America/Chicago',
        'CALSCALE:GREGORIAN',
        events,
        'END:VCALENDAR',
      ].join('\r\n');
      return new Response(ical, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="gym-rentals.ics"' } });
    }

    // ── LOGIN ──
    if (path === '/login' && method === 'POST') {
      const form = await request.formData();
      const pw = form.get('password');
      if (pw === ADMIN_PASSWORD) {
        return new Response('', {
          status: 302,
          headers: { Location: '/', 'Set-Cookie': setCookieHeader() }
        });
      }
      return loginPage('Incorrect password. Please try again.');
    }

    if (!authCookie(request)) {
      if (path === '/login') return loginPage();
      return loginPage();
    }

    // ── LOGOUT ──
    if (path === '/logout') {
      return new Response('', {
        status: 302,
        headers: { Location: '/login', 'Set-Cookie': 'tlc_auth=; Path=/; Max-Age=0' }
      });
    }

    // ── IMAGE UPLOAD TO R2 ──
    if (path === '/api/upload-image' && method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') {
        return new Response(JSON.stringify({ error: 'No file' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (file.size > 2097152) {
        return new Response(JSON.stringify({ error: 'File too large (max 2MB)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      const ext = (file.name || 'image').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const key = `news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await env.IMAGES.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || 'image/jpeg' }
      });
      const url = `${new URL(request.url).origin}/images/${key}`;
      return new Response(JSON.stringify({ url, location: url }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── UPLOAD VOTER DOCUMENT TO R2 ──
    if (path === '/api/upload-doc' && method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return new Response(JSON.stringify({ error: 'No file' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      if (file.size > 10485760) return new Response(JSON.stringify({ error: 'File too large (max 10MB)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const safeName = (file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `docs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
      await env.IMAGES.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream', contentDisposition: `attachment; filename="${safeName}"` }
      });
      const docUrl = `${new URL(request.url).origin}/docs/${key.slice('docs-'.length)}`;
      return new Response(JSON.stringify({ url: docUrl, key, name: safeName }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── VOTERS PAGE ADMIN ──
    if (path === '/voters' && method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM voters_page WHERE id = 1').first();
      const meeting_info = row ? (row.meeting_info || '') : '';
      const zoom_link = row ? (row.zoom_link || '') : '';
      let files = [];
      try { files = JSON.parse(row ? (row.files_json || '[]') : '[]'); } catch(_) {}
      const alertHtml = url.searchParams.get('saved') ? `<div class="alert alert-success">Saved!</div>` : '';
      const filesHtml = files.length === 0
        ? `<div style="font-size:13px;color:var(--gray);padding:8px 0;">No files uploaded yet.</div>`
        : files.map((f, i) => `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="flex:1;font-size:14px;color:var(--charcoal);">📄 <a href="${f.url}" target="_blank" style="color:var(--steel);">${f.name}</a></div>
            <form method="POST" action="/voters-delete-file" onsubmit="return confirm('Remove this file?')">
              <input type="hidden" name="index" value="${i}">
              <button type="submit" class="btn btn-sm btn-danger">Remove</button>
            </form>
          </div>`).join('');
      return html(`
${topbarHtml('voters')}
<div class="wrap">
  <div class="page-title">Voters Page</div>
  <div class="page-sub">Manage the members-only voters page content at timothystl.org/voters</div>
  ${alertHtml}
  <form method="POST" action="/voters">
    <div class="card">
      <div class="card-title">Meeting Info</div>
      <div class="form-group">
        <label>Date, time &amp; description</label>
        <textarea name="meeting_info" style="min-height:120px;" placeholder="Example: Annual Voters Meeting — Sunday, June 15 at noon in the Fellowship Hall">${meeting_info}</textarea>
        <div style="font-size:12px;color:var(--gray);margin-top:6px;">Plain text shown at the top of the voters page. Include date, time, location, agenda items, etc.</div>
      </div>
      <div class="form-group">
        <label>Zoom link</label>
        <input type="text" name="zoom_link" value="${zoom_link}" placeholder="https://us02web.zoom.us/j/...">
        <div style="font-size:12px;color:var(--gray);margin-top:6px;">Leave blank if not meeting via Zoom.</div>
      </div>
      <button type="submit" class="btn btn-primary">Save changes</button>
    </div>
  </form>
  <div class="card" style="margin-top:20px;">
    <div class="card-title">Downloadable Files</div>
    ${filesHtml}
    <div style="margin-top:16px;">
      <div style="font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:8px;">Upload a new file (PDF, Word, Excel — max 10MB)</div>
      <form id="upload-form" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <input type="file" id="doc-file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" style="font-size:14px;flex:1;min-width:200px;">
        <button type="submit" class="btn btn-secondary" id="upload-btn">Upload file</button>
      </form>
      <div id="upload-status" style="font-size:13px;margin-top:8px;"></div>
    </div>
  </div>
</div>
<script>
document.getElementById('upload-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const file = document.getElementById('doc-file').files[0];
  if (!file) { document.getElementById('upload-status').textContent = 'Please choose a file.'; return; }
  document.getElementById('upload-btn').textContent = 'Uploading…';
  document.getElementById('upload-btn').disabled = true;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch('/api/upload-doc', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok || d.error) { document.getElementById('upload-status').textContent = 'Error: ' + (d.error || r.status); }
    else {
      // Save the file reference to voters page
      const saveForm = new FormData();
      saveForm.append('add_file_name', d.name);
      saveForm.append('add_file_url', d.url);
      saveForm.append('add_file_key', d.key);
      await fetch('/voters-add-file', { method: 'POST', body: saveForm });
      window.location.reload();
    }
  } catch(err) { document.getElementById('upload-status').textContent = 'Upload failed.'; }
  document.getElementById('upload-btn').textContent = 'Upload file';
  document.getElementById('upload-btn').disabled = false;
});
</script>`, 'Voters Page Admin');
    }

    if (path === '/voters' && method === 'POST') {
      const form = await request.formData();
      const meeting_info = form.get('meeting_info') || '';
      const zoom_link = form.get('zoom_link') || '';
      const existing = await env.DB.prepare('SELECT files_json FROM voters_page WHERE id = 1').first();
      const files_json = existing ? (existing.files_json || '[]') : '[]';
      const now = new Date().toISOString();
      await env.DB.prepare('INSERT OR REPLACE INTO voters_page (id, meeting_info, zoom_link, files_json, updated_at) VALUES (1, ?, ?, ?, ?)')
        .bind(meeting_info, zoom_link, files_json, now).run();
      return new Response('', { status: 302, headers: { Location: '/voters?saved=1' } });
    }

    if (path === '/voters-add-file' && method === 'POST') {
      const form = await request.formData();
      const name = form.get('add_file_name') || 'document';
      const fileUrl = form.get('add_file_url') || '';
      const key = form.get('add_file_key') || '';
      const existing = await env.DB.prepare('SELECT * FROM voters_page WHERE id = 1').first();
      let files = [];
      try { files = JSON.parse(existing ? (existing.files_json || '[]') : '[]'); } catch(_) {}
      files.push({ name, url: fileUrl, key, uploaded_at: new Date().toISOString() });
      const now = new Date().toISOString();
      await env.DB.prepare('INSERT OR REPLACE INTO voters_page (id, meeting_info, zoom_link, files_json, updated_at) VALUES (1, ?, ?, ?, ?)')
        .bind(existing ? (existing.meeting_info || '') : '', existing ? (existing.zoom_link || '') : '', JSON.stringify(files), now).run();
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (path === '/voters-delete-file' && method === 'POST') {
      const form = await request.formData();
      const idx = parseInt(form.get('index') || '-1', 10);
      const existing = await env.DB.prepare('SELECT * FROM voters_page WHERE id = 1').first();
      let files = [];
      try { files = JSON.parse(existing ? (existing.files_json || '[]') : '[]'); } catch(_) {}
      if (idx >= 0 && idx < files.length) {
        const removed = files.splice(idx, 1)[0];
        if (removed && removed.key) {
          try { await env.IMAGES.delete(removed.key); } catch(_) {}
        }
      }
      const now = new Date().toISOString();
      await env.DB.prepare('INSERT OR REPLACE INTO voters_page (id, meeting_info, zoom_link, files_json, updated_at) VALUES (1, ?, ?, ?, ?)')
        .bind(existing ? (existing.meeting_info || '') : '', existing ? (existing.zoom_link || '') : '', JSON.stringify(files), now).run();
      return new Response('', { status: 302, headers: { Location: '/voters' } });
    }

    // ── SERMONS ADMIN ──
    if (path === '/sermons' && method === 'GET') {
      const alertHtml = url.searchParams.get('saved') ? `<div class="alert alert-success">Saved!</div>` : '';
      const series = await env.DB.prepare('SELECT * FROM sermon_series ORDER BY active DESC, sort_order ASC, id DESC').all();
      const seriesHtml = series.results.length === 0
        ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No series yet. Add your first one below.</div>`
        : series.results.map(s => `
<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
  <div style="flex:1;min-width:160px;">
    ${s.active ? `<span class="badge badge-active" style="margin-bottom:4px;">Active</span><br>` : ''}
    <div style="font-family:var(--serif);font-size:17px;color:var(--steel);">${s.title}</div>
    ${s.date_range ? `<div style="font-size:12px;color:var(--gray);">${s.date_range}</div>` : ''}
  </div>
  <div style="display:flex;gap:8px;flex-shrink:0;">
    <a href="/sermons/edit-series/${s.id}" class="btn btn-sm btn-secondary">Edit</a>
    <a href="/sermons/notes/${s.id}" class="btn btn-sm" style="background:var(--mist);color:var(--steel);border:1px solid var(--border);">Notes (${s.id})</a>
    <form method="POST" action="/sermons/delete-series/${s.id}" style="display:contents;" onsubmit="return confirm('Delete this series and all its notes?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('');
      return html(`
${topbarHtml('sermons', `<a href="https://timothystl.org/sermons" target="_blank">View page →</a>`)}
<div class="wrap">
  <div class="page-title">Sermon Series &amp; Notes</div>
  <div class="page-sub">Manage the current series and weekly sermon notes shown on timothystl.org/sermons</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:24px;">
    <a href="/sermons/new-series" class="btn btn-primary">+ Add series</a>
    <a href="/sermons/new-note" class="btn btn-secondary">+ Add note (no series)</a>
  </div>
  <div class="card">
    <div class="card-title">Sermon series</div>
    ${seriesHtml}
  </div>
</div>`, 'Sermons Admin');
    }

    if (path === '/sermons/new-series' && method === 'GET') {
      return html(`
${topbarHtml('sermons', `<a href="/sermons">← Back</a>`)}
<div class="wrap">
  <div class="page-title">New Sermon Series</div>
  <form method="POST" action="/sermons/new-series">
    <div class="card">
      <div class="form-group"><label>Series title</label><input type="text" name="title" required placeholder="e.g. The Shepherd's Way"></div>
      <div class="form-group"><label>Description</label><textarea name="description" placeholder="Brief description shown on the sermons page..."></textarea></div>
      <div class="form-group"><label>Date range</label><input type="text" name="date_range" placeholder="e.g. Lent 2025 · March–April"></div>
      <div class="form-group"><label>YouTube playlist URL</label><input type="text" name="playlist_url" placeholder="https://www.youtube.com/playlist?list=..."></div>
      <div class="checkbox-row"><input type="checkbox" name="active" value="1" id="active"><label for="active" style="display:inline;text-transform:none;letter-spacing:0;font-size:14px;">Mark as active (current series)</label></div>
      <div class="btn-row" style="margin-top:20px;"><button type="submit" class="btn btn-primary">Create series</button><a href="/sermons" class="btn" style="background:var(--linen);color:var(--charcoal);">Cancel</a></div>
    </div>
  </form>
</div>`, 'New Series');
    }

    if (path === '/sermons/new-series' && method === 'POST') {
      const form = await request.formData();
      const title = (form.get('title') || '').trim();
      if (!title) return new Response('', { status: 302, headers: { Location: '/sermons' } });
      const active = form.get('active') === '1' ? 1 : 0;
      if (active) await env.DB.prepare('UPDATE sermon_series SET active = 0').run();
      await env.DB.prepare('INSERT INTO sermon_series (title, description, date_range, playlist_url, active) VALUES (?, ?, ?, ?, ?)')
        .bind(title, form.get('description') || '', form.get('date_range') || '', form.get('playlist_url') || '', active).run();
      return new Response('', { status: 302, headers: { Location: '/sermons?saved=1' } });
    }

    if (path.startsWith('/sermons/edit-series/') && method === 'GET') {
      const id = path.split('/').pop();
      const s = await env.DB.prepare('SELECT * FROM sermon_series WHERE id = ?').bind(id).first();
      if (!s) return new Response('Not found', { status: 404 });
      return html(`
${topbarHtml('sermons', `<a href="/sermons">← Back</a>`)}
<div class="wrap">
  <div class="page-title">Edit Series</div>
  <form method="POST" action="/sermons/edit-series/${id}">
    <div class="card">
      <div class="form-group"><label>Series title</label><input type="text" name="title" required value="${s.title}"></div>
      <div class="form-group"><label>Description</label><textarea name="description">${s.description || ''}</textarea></div>
      <div class="form-group"><label>Date range</label><input type="text" name="date_range" value="${s.date_range || ''}"></div>
      <div class="form-group"><label>YouTube playlist URL</label><input type="text" name="playlist_url" value="${s.playlist_url || ''}"></div>
      <div class="checkbox-row"><input type="checkbox" name="active" value="1" id="active" ${s.active ? 'checked' : ''}><label for="active" style="display:inline;text-transform:none;letter-spacing:0;font-size:14px;">Mark as active (current series)</label></div>
      <div class="btn-row" style="margin-top:20px;"><button type="submit" class="btn btn-primary">Save changes</button><a href="/sermons/notes/${id}" class="btn btn-secondary">Manage notes</a><a href="/sermons" class="btn" style="background:var(--linen);color:var(--charcoal);">Cancel</a></div>
    </div>
  </form>
</div>`, 'Edit Series');
    }

    if (path.startsWith('/sermons/edit-series/') && method === 'POST') {
      const id = path.split('/').pop();
      const form = await request.formData();
      const title = (form.get('title') || '').trim();
      const active = form.get('active') === '1' ? 1 : 0;
      if (active) await env.DB.prepare('UPDATE sermon_series SET active = 0').run();
      await env.DB.prepare('UPDATE sermon_series SET title=?, description=?, date_range=?, playlist_url=?, active=? WHERE id=?')
        .bind(title, form.get('description') || '', form.get('date_range') || '', form.get('playlist_url') || '', active, id).run();
      return new Response('', { status: 302, headers: { Location: '/sermons?saved=1' } });
    }

    if (path.startsWith('/sermons/delete-series/') && method === 'POST') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM sermon_notes WHERE series_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM sermon_series WHERE id = ?').bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/sermons' } });
    }

    if (path.startsWith('/sermons/notes/') && method === 'GET') {
      const seriesId = path.split('/').pop();
      const s = await env.DB.prepare('SELECT * FROM sermon_series WHERE id = ?').bind(seriesId).first();
      if (!s) return new Response('Not found', { status: 404 });
      const notes = await env.DB.prepare('SELECT * FROM sermon_notes WHERE series_id = ? ORDER BY date DESC, id DESC').bind(seriesId).all();
      const notesHtml = notes.results.length === 0
        ? `<div style="text-align:center;padding:24px;color:var(--gray);font-size:14px;">No notes for this series yet.</div>`
        : notes.results.map(n => `
<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
  <div style="flex:1;">
    ${n.date ? `<div style="font-size:11px;font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:.06em;">${n.date}</div>` : ''}
    <div style="font-family:var(--serif);font-size:16px;color:var(--steel);">${n.title}</div>
    ${n.scripture ? `<div style="font-size:12px;color:var(--gray);">${n.scripture}</div>` : ''}
  </div>
  <div style="display:flex;gap:8px;">
    <a href="/sermons/edit-note/${n.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/sermons/delete-note/${n.id}" style="display:contents;" onsubmit="return confirm('Delete this note?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('');
      return html(`
${topbarHtml('sermons', `<a href="/sermons">← All series</a>`)}
<div class="wrap">
  <div class="page-title">${s.title}</div>
  <div class="page-sub">${s.date_range || 'Sermon notes for this series'}</div>
  <div class="btn-row" style="margin-bottom:20px;">
    <a href="/sermons/new-note?series_id=${seriesId}" class="btn btn-primary">+ Add note</a>
    <a href="/sermons/edit-series/${seriesId}" class="btn btn-secondary">Edit series</a>
  </div>
  <div class="card"><div class="card-title">Sermon notes</div>${notesHtml}</div>
</div>`, 'Sermon Notes');
    }

    if (path === '/sermons/new-note' && method === 'GET') {
      const seriesId = url.searchParams.get('series_id') || '';
      const allSeries = await env.DB.prepare('SELECT id, title FROM sermon_series ORDER BY active DESC, id DESC').all();
      const seriesOptions = allSeries.results.map(s => `<option value="${s.id}" ${s.id == seriesId ? 'selected' : ''}>${s.title}</option>`).join('');
      return html(`
${topbarHtml('sermons', `<a href="/sermons">← Back</a>`)}
<div class="wrap">
  <div class="page-title">Add Sermon Note</div>
  <form method="POST" action="/sermons/new-note">
    <input type="hidden" name="series_id" value="${seriesId}">
    <div class="card">
      <div class="form-group"><label>Series (optional)</label><select name="series_id"><option value="">— Standalone note —</option>${seriesOptions}</select></div>
      <div class="form-group"><label>Date</label><input type="date" name="date"></div>
      <div class="form-group"><label>Sermon title</label><input type="text" name="title" required placeholder="e.g. You prepare a table before me"></div>
      <div class="form-group"><label>Scripture reference</label><input type="text" name="scripture" placeholder="e.g. Psalm 23:5"></div>
      ${tinymceSermonSection()}
      <div class="form-group"><label>YouTube link (optional)</label><input type="text" name="youtube_url" placeholder="Link to this specific service recording"></div>
      <div class="btn-row" style="margin-top:20px;"><button type="submit" class="btn btn-primary">Add note</button><a href="/sermons" class="btn" style="background:var(--linen);color:var(--charcoal);">Cancel</a></div>
    </div>
  </form>
</div>`, 'Add Sermon Note', TINYMCE_HEAD);
    }

    if (path === '/sermons/new-note' && method === 'POST') {
      const form = await request.formData();
      const title = (form.get('title') || '').trim();
      if (!title) return new Response('', { status: 302, headers: { Location: '/sermons' } });
      const seriesId = form.get('series_id') || null;
      await env.DB.prepare('INSERT INTO sermon_notes (series_id, date, title, scripture, outline, youtube_url) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(seriesId || null, form.get('date') || null, title, form.get('scripture') || '', form.get('outline') || '', form.get('youtube_url') || '').run();
      const redir = seriesId ? `/sermons/notes/${seriesId}` : '/sermons';
      return new Response('', { status: 302, headers: { Location: redir + '?saved=1' } });
    }

    if (path.startsWith('/sermons/edit-note/') && method === 'GET') {
      const id = path.split('/').pop();
      const n = await env.DB.prepare('SELECT * FROM sermon_notes WHERE id = ?').bind(id).first();
      if (!n) return new Response('Not found', { status: 404 });
      const allSeries = await env.DB.prepare('SELECT id, title FROM sermon_series ORDER BY active DESC, id DESC').all();
      const seriesOptions = allSeries.results.map(s => `<option value="${s.id}" ${s.id == n.series_id ? 'selected' : ''}>${s.title}</option>`).join('');
      return html(`
${topbarHtml('sermons', `<a href="/sermons">← Back</a>`)}
<div class="wrap">
  <div class="page-title">Edit Sermon Note</div>
  <form method="POST" action="/sermons/edit-note/${id}">
    <div class="card">
      <div class="form-group"><label>Series (optional)</label><select name="series_id"><option value="">— Standalone note —</option>${seriesOptions}</select></div>
      <div class="form-group"><label>Date</label><input type="date" name="date" value="${n.date || ''}"></div>
      <div class="form-group"><label>Sermon title</label><input type="text" name="title" required value="${n.title}"></div>
      <div class="form-group"><label>Scripture reference</label><input type="text" name="scripture" value="${n.scripture || ''}"></div>
      ${tinymceSermonSection(n.outline)}
      <div class="form-group"><label>YouTube link (optional)</label><input type="text" name="youtube_url" value="${n.youtube_url || ''}"></div>
      <div class="btn-row" style="margin-top:20px;">
        <button type="submit" class="btn btn-primary">Save changes</button>
        <a href="/sermons" class="btn" style="background:var(--linen);color:var(--charcoal);">Cancel</a>
        <form method="POST" action="/sermons/delete-note/${id}" style="margin:0;" onsubmit="return confirm('Delete this sermon note?')">
          <button type="submit" class="btn btn-danger">Delete note</button>
        </form>
      </div>
    </div>
  </form>
</div>`, 'Edit Note', TINYMCE_HEAD);
    }

    if (path.startsWith('/sermons/edit-note/') && method === 'POST') {
      const id = path.split('/').pop();
      const form = await request.formData();
      const title = (form.get('title') || '').trim();
      const seriesId = form.get('series_id') || null;
      await env.DB.prepare('UPDATE sermon_notes SET series_id=?, date=?, title=?, scripture=?, outline=?, youtube_url=? WHERE id=?')
        .bind(seriesId || null, form.get('date') || null, title, form.get('scripture') || '', form.get('outline') || '', form.get('youtube_url') || '', id).run();
      const redir = seriesId ? `/sermons/notes/${seriesId}` : '/sermons';
      return new Response('', { status: 302, headers: { Location: redir + '?saved=1' } });
    }

    if (path.startsWith('/sermons/delete-note/') && method === 'POST') {
      const id = path.split('/').pop();
      const n = await env.DB.prepare('SELECT series_id FROM sermon_notes WHERE id = ?').bind(id).first();
      await env.DB.prepare('DELETE FROM sermon_notes WHERE id = ?').bind(id).run();
      const redir = n && n.series_id ? `/sermons/notes/${n.series_id}` : '/sermons';
      return new Response('', { status: 302, headers: { Location: redir } });
    }

    // ── NEW NEWSLETTER FORM ──
    if (path === '/new' && method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      // Fetch recent news items available for email inclusion
      const emailItems = await env.DB.prepare(
        `SELECT id, title, summary, publish_date FROM news_items
         WHERE publish_date <= ? AND (expire_date IS NULL OR expire_date >= ?)
           AND (channels IS NULL OR channels LIKE '%email%')
         ORDER BY COALESCE(event_date, publish_date) DESC LIMIT 20`
      ).bind(today, today).all();
      const newsPickerHtml = emailItems.results.length === 0
        ? `<div style="font-size:13px;color:var(--gray);padding:10px 0;">No news items available. Add items in the News &amp; Events tab first.</div>`
        : emailItems.results.map(item => `
          <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" name="news_item_ids" value="${item.id}" style="margin-top:3px;flex-shrink:0;">
            <div>
              <div style="font-size:14px;font-weight:600;color:var(--charcoal);">${item.title}</div>
              ${item.summary ? `<div style="font-size:12px;color:var(--gray);margin-top:2px;">${item.summary.substring(0, 100)}${item.summary.length > 100 ? '…' : ''}</div>` : ''}
              <div style="font-size:11px;color:var(--gray);margin-top:2px;">${item.publish_date}</div>
            </div>
          </label>`).join('');
      return html(`
${topbarHtml('news', `<a href="/newsitems">← News &amp; Events</a>`)}
<div class="wrap">
  <div class="page-title">New newsletter</div>
  <div class="page-sub">Write your update, add events, and publish to the website.</div>

  <form method="POST" action="/publish" enctype="multipart/form-data">
  <input type="hidden" name="format" id="format-input" value="weekly">

  <div class="card">
    <div class="card-title">What are you writing?</div>
    <div class="format-picker">
      <button type="button" class="format-card active" id="fmt-weekly" onclick="pickFormat('weekly')">
        <div class="format-card-icon">📰</div>
        <div class="format-card-name">Weekly Newsletter</div>
        <div class="format-card-desc">Pastor's note, events, ministry content — your regular weekly update.</div>
      </button>
      <button type="button" class="format-card" id="fmt-quick" onclick="pickFormat('quick')">
        <div class="format-card-icon">⚡</div>
        <div class="format-card-name">Quick Announcement</div>
        <div class="format-card-desc">Short message + optional button. Snow days, funerals, schedule changes.</div>
      </button>
    </div>
  </div>

    <div class="card">
      <div class="card-title">Header</div>
      <div class="form-group">
        <label>Subject line <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="subject" required placeholder="e.g. This week at Timothy — March 23">
      </div>
      <div class="form-group" id="date-field">
        <label>Date</label>
        <input type="date" name="published_at" value="${today}">
      </div>
    </div>

    <!-- WEEKLY FIELDS -->
    <div id="weekly-fields">
      <div class="card">
        <div class="card-title">Pastor's note</div>
        ${tinymcePastorSection()}
      </div>

      <div class="card">
        <div class="card-title">News &amp; Events <span class="tag">Pick from your posts</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Check items to include in this newsletter. They appear as brief cards with a "Read more" link to the website.</div>
        ${newsPickerHtml}
      </div>

      <div class="card">
        <div class="card-title">Upcoming events</div>
        <div id="events-container"></div>
        <button type="button" class="add-event-btn" onclick="addEvent()">+ Add an event</button>
      </div>

      <div class="card">
        <div class="card-title">From our ministries <span class="tag">Optional</span></div>
        <div class="form-group">
          <label>Content type</label>
          <div class="radio-row">
            <label><input type="radio" name="ministry_type" value="text" checked onchange="toggleMinistry(this)"> Text or link</label>
            <label><input type="radio" name="ministry_type" value="image" onchange="toggleMinistry(this)"> Image</label>
            <label><input type="radio" name="ministry_type" value="none" onchange="toggleMinistry(this)"> None this week</label>
          </div>
        </div>
        <div id="ministry-text" class="form-group">
          <label>Text, link, or paste content</label>
          <textarea name="ministry_content" style="min-height:100px;" placeholder="Paste text from Word of Life, MDO, LWML, or any ministry. Or paste a URL and we'll note it."></textarea>
        </div>
        <div id="ministry-image" class="form-group" style="display:none;">
          <label>Upload image</label>
          <input type="file" name="ministry_image" accept="image/*" style="border:none;padding:0;background:none;">
          <div style="margin-top:6px;font-size:12px;color:var(--gray);">Or paste an image URL:</div>
          <input type="text" name="ministry_image_url" placeholder="https://..." style="margin-top:6px;">
        </div>
      </div>
    </div>

    <!-- QUICK ANNOUNCEMENT FIELDS -->
    <div id="quick-fields" style="display:none;">
      <div class="card">
        <div class="card-title">Message</div>
        <div class="form-group">
          <label>Your announcement <span style="color:#B85C3A;">*</span></label>
          <textarea name="quick_body" style="min-height:140px;" placeholder="Type your announcement here. Keep it short and clear."></textarea>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Button <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">Add a link button — e.g. "Sign Up", "Read More", "RSVP".</div>
        <div class="form-group">
          <label>Button label</label>
          <input type="text" name="cta_label" placeholder="e.g. Sign Up, Read More, RSVP">
        </div>
        <div class="form-group">
          <label>Button link (URL)</label>
          <input type="url" name="cta_url" placeholder="https://...">
        </div>
      </div>
    </div>

    <div class="card" style="border-color:var(--amber);">
      <div class="card-title">Send email</div>
      <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-bottom:12px;">Choose who gets this in their inbox. You can always save as draft without sending.</div>
      <div class="radio-row">
        <label><input type="radio" name="email_send" value="none" checked> Don't send email</label>
        <label><input type="radio" name="email_send" value="test"> Test list only <span style="font-weight:400;font-size:11px;color:var(--gray);">(Your first list)</span></label>
        <label><input type="radio" name="email_send" value="all"> All subscribers</label>
      </div>
    </div>

    <div class="card" style="background:var(--mist);border-color:var(--ice);">
      <div class="card-title" style="color:var(--sage);">What happens when you publish</div>
      <div style="font-family:var(--sans);font-size:13px;color:var(--charcoal);line-height:1.8;">
        <strong>1.</strong> The newsletter is saved to your website archive at timothystl.org/news<br>
        <strong>2.</strong> It goes live immediately on timothystl.org/news<br>
        <strong>3.</strong> If you selected an email list above, it is sent via Brevo
      </div>
    </div>

    <div class="btn-row" style="margin-top:8px;">
      <button type="submit" name="action" value="publish" class="btn btn-primary">Publish →</button>
      <button type="submit" name="action" value="draft" class="btn btn-secondary">Save as draft</button>
      <a href="/" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>

  </form>
</div>

<script>
let eventCount = 0;
function addEvent() {
  const c = document.getElementById('events-container');
  const id = ++eventCount;
  const div = document.createElement('div');
  div.className = 'event-block';
  div.id = 'event-'+id;
  div.innerHTML = \`
    <button type="button" class="remove-event" onclick="removeEvent(\${id})">×</button>
    <div class="event-grid">
      <div class="form-group" style="margin:0;">
        <label>Date</label>
        <input type="date" name="event_date_\${id}">
      </div>
      <div class="form-group" style="margin:0;">
        <label>Time</label>
        <input type="text" name="event_time_\${id}" placeholder="e.g. 6:30 pm">
      </div>
    </div>
    <div class="form-group" style="margin-top:12px;margin-bottom:0;">
      <label>Event name</label>
      <input type="text" name="event_name_\${id}" placeholder="e.g. Wednesday Lenten Service">
    </div>
    <div class="form-group" style="margin-top:12px;margin-bottom:0;">
      <label>Short description <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">(optional)</span></label>
      <input type="text" name="event_desc_\${id}" placeholder="One line — location, special note, etc.">
    </div>
    <input type="hidden" name="event_ids" value="\${id}">
  \`;
  c.appendChild(div);
}
function removeEvent(id) {
  document.getElementById('event-'+id).remove();
}
function toggleMinistry(radio) {
  document.getElementById('ministry-text').style.display = radio.value === 'text' ? 'block' : 'none';
  document.getElementById('ministry-image').style.display = radio.value === 'image' ? 'block' : 'none';
}
function pickFormat(fmt) {
  document.getElementById('format-input').value = fmt;
  document.getElementById('fmt-weekly').classList.toggle('active', fmt === 'weekly');
  document.getElementById('fmt-quick').classList.toggle('active', fmt === 'quick');
  document.getElementById('weekly-fields').style.display = fmt === 'weekly' ? '' : 'none';
  document.getElementById('quick-fields').style.display = fmt === 'quick' ? '' : 'none';
}
// Add one event by default for weekly
addEvent();
</script>`, 'New Newsletter', TINYMCE_HEAD);
    }

    // ── PUBLISH / SAVE ──
    if (path === '/publish' && method === 'POST') {
      const form = await request.formData();
      const subject = form.get('subject') || '';
      const publishedAt = form.get('published_at') || new Date().toISOString().split('T')[0];
      const action = form.get('action') || 'publish';
      const fmt = form.get('format') || 'weekly';
      const editId = form.get('newsletter_id') || null; // present when editing an existing newsletter
      const status = action === 'publish' ? 'published' : 'draft';

      // Weekly-specific fields
      const pastorNote = form.get('pastor_note') || '';
      const ministryType = form.get('ministry_type') || 'none';
      let ministryContent = '';
      if (ministryType === 'text') {
        ministryContent = form.get('ministry_content') || '';
      } else if (ministryType === 'image') {
        ministryContent = form.get('ministry_image_url') || '';
      }

      // Quick-announcement-specific fields
      const quickBody = form.get('quick_body') || '';
      const ctaUrl = form.get('cta_url') || '';
      const ctaLabel = form.get('cta_label') || '';

      // Combine for storage: quick announcements store message in pastor_note
      const savedNote = fmt === 'quick' ? quickBody : pastorNote;

      // Collect events (weekly only)
      const eventIds = form.getAll('event_ids');
      const events = [];
      if (fmt === 'weekly') {
        for (const id of eventIds) {
          const name = form.get(`event_name_${id}`);
          if (!name) continue;
          events.push({
            event_date: form.get(`event_date_${id}`) || '',
            event_name: name,
            event_time: form.get(`event_time_${id}`) || '',
            event_desc: form.get(`event_desc_${id}`) || '',
            sort_order: events.length
          });
        }
      }

      // Fetch selected news items (weekly only)
      const selectedNewsIds = fmt === 'weekly' ? form.getAll('news_item_ids') : [];
      let selectedNewsItems = [];
      if (selectedNewsIds.length > 0) {
        const placeholders = selectedNewsIds.map(() => '?').join(',');
        const newsRows = await env.DB.prepare(
          `SELECT id, title, summary FROM news_items WHERE id IN (${placeholders})`
        ).bind(...selectedNewsIds).all();
        const newsMap = Object.fromEntries(newsRows.results.map(r => [r.id, r]));
        selectedNewsItems = selectedNewsIds.map(id => newsMap[id]).filter(Boolean);
      }

      let newsletterId;
      if (editId) {
        // Update existing newsletter
        await env.DB.prepare(
          'UPDATE newsletters SET subject=?, pastor_note=?, ministry_content=?, ministry_type=?, published_at=?, format=?, cta_url=?, cta_label=?, status=? WHERE id=?'
        ).bind(subject, savedNote, ministryContent, ministryType === 'none' ? 'text' : ministryType, publishedAt, fmt, ctaUrl, ctaLabel, status, editId).run();
        newsletterId = parseInt(editId, 10);
        // Replace events
        await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(newsletterId).run();
      } else {
        // Insert new newsletter
        const result = await env.DB.prepare(
          'INSERT INTO newsletters (subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(subject, savedNote, ministryContent, ministryType === 'none' ? 'text' : ministryType, publishedAt, fmt, ctaUrl, ctaLabel, status).run();
        newsletterId = result.meta.last_row_id;
      }

      // Save events
      for (const e of events) {
        await env.DB.prepare(
          'INSERT INTO events (newsletter_id, event_date, event_name, event_time, event_desc, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(newsletterId, e.event_date, e.event_name, e.event_time, e.event_desc, e.sort_order).run();
      }

      // Send via Brevo if requested (only when publishing, not drafting)
      const emailSend = form.get('email_send') || 'none';
      let emailSuffix = '';
      if (action === 'publish' && emailSend !== 'none') {
        const listId = emailSend === 'test' ? 2 : parseInt(env.BREVO_LIST_ID || '0', 10);
        if (listId) {
          const emailHtml = buildEmailHtml(subject, savedNote, events, ministryContent, ministryType, publishedAt, selectedNewsItems);
          const result = await sendBrevoNewsletter(env, { subject, htmlContent: emailHtml, listIds: [listId] });
          emailSuffix = result.success
            ? `&emailed=${emailSend}`
            : `&emailerr=${encodeURIComponent(result.error)}`;
        }
      }

      return new Response('', {
        status: 302,
        headers: { Location: `/newsitems?msg=${encodeURIComponent(action === 'publish' ? 'published' : 'draft')}&subject=${encodeURIComponent(subject)}${emailSuffix}` }
      });
    }

    // ── EDIT EXISTING NEWSLETTER (GET) ──
    if (path.startsWith('/edit/') && method === 'GET') {
      const editId = path.split('/').pop();
      const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(editId).first();
      if (!row) return new Response('Not found', { status: 404 });
      const eventsRows = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY sort_order').bind(editId).all();
      const fmt = row.format || 'weekly';

      // Build prefilled events JS
      const eventsJs = eventsRows.results.map((e, i) => `
        (function(){
          const id = ++eventCount;
          const div = document.createElement('div');
          div.className = 'event-block'; div.id = 'event-'+id;
          div.innerHTML = \`<button type="button" class="remove-event" onclick="removeEvent(\${id})">×</button>
            <div class="event-grid">
              <div class="form-group" style="margin:0;"><label>Date</label><input type="date" name="event_date_\${id}" value="${e.event_date||''}"></div>
              <div class="form-group" style="margin:0;"><label>Time</label><input type="text" name="event_time_\${id}" value="${(e.event_time||'').replace(/"/g,'&quot;')}" placeholder="e.g. 6:30 pm"></div>
            </div>
            <div class="form-group" style="margin-top:12px;margin-bottom:0;"><label>Event name</label><input type="text" name="event_name_\${id}" value="${(e.event_name||'').replace(/"/g,'&quot;')}"></div>
            <div class="form-group" style="margin-top:12px;margin-bottom:0;"><label>Short description</label><input type="text" name="event_desc_\${id}" value="${(e.event_desc||'').replace(/"/g,'&quot;')}"></div>
            <input type="hidden" name="event_ids" value="\${id}">\`;
          document.getElementById('events-container').appendChild(div);
        })();
      `).join('');

      const bodyVal = (fmt === 'quick' ? row.pastor_note : '') || '';
      const pastorNoteVal = (fmt === 'weekly' ? row.pastor_note : '') || '';
      const ministryChecked = (t) => (row.ministry_type || 'text') === t ? ' checked' : '';

      return html(`
${topbarHtml('news', `<a href="/newsitems">← News &amp; Events</a>`)}
<div class="wrap">
  <div class="page-title">Edit newsletter</div>
  <div class="page-sub" style="color:var(--amber);font-weight:700;">You are editing a ${row.status === 'draft' ? 'draft' : 'published'} newsletter. Changes will go live immediately when you publish.</div>

  <form method="POST" action="/publish" enctype="multipart/form-data">
  <input type="hidden" name="newsletter_id" value="${editId}">
  <input type="hidden" name="format" id="format-input" value="${fmt}">

  <div class="card">
    <div class="card-title">Format</div>
    <div class="format-picker">
      <button type="button" class="format-card${fmt==='weekly'?' active':''}" id="fmt-weekly" onclick="pickFormat('weekly')">
        <div class="format-card-icon">📰</div>
        <div class="format-card-name">Weekly Newsletter</div>
        <div class="format-card-desc">Pastor's note, events, ministry content.</div>
      </button>
      <button type="button" class="format-card${fmt==='quick'?' active':''}" id="fmt-quick" onclick="pickFormat('quick')">
        <div class="format-card-icon">⚡</div>
        <div class="format-card-name">Quick Announcement</div>
        <div class="format-card-desc">Short message + optional button.</div>
      </button>
    </div>
  </div>

    <div class="card">
      <div class="card-title">Header</div>
      <div class="form-group">
        <label>Subject line <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="subject" required value="${(row.subject||'').replace(/"/g,'&quot;')}">
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="date" name="published_at" value="${row.published_at||''}">
      </div>
    </div>

    <div id="weekly-fields" style="display:${fmt==='weekly'?'':'none'}">
      <div class="card">
        <div class="card-title">Pastor's note</div>
        <div class="form-group">
          <textarea name="pastor_note" style="min-height:180px;">${pastorNoteVal.replace(/</g,'&lt;')}</textarea>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Upcoming events</div>
        <div id="events-container"></div>
        <button type="button" class="add-event-btn" onclick="addEvent()">+ Add an event</button>
      </div>
      <div class="card">
        <div class="card-title">From our ministries <span class="tag">Optional</span></div>
        <div class="form-group">
          <label>Content type</label>
          <div class="radio-row">
            <label><input type="radio" name="ministry_type" value="text"${ministryChecked('text')} onchange="toggleMinistry(this)"> Text or link</label>
            <label><input type="radio" name="ministry_type" value="image"${ministryChecked('image')} onchange="toggleMinistry(this)"> Image</label>
            <label><input type="radio" name="ministry_type" value="none"${ministryChecked('none')} onchange="toggleMinistry(this)"> None this week</label>
          </div>
        </div>
        <div id="ministry-text" class="form-group" style="display:${(row.ministry_type||'text')==='text'?'block':'none'}">
          <textarea name="ministry_content" style="min-height:100px;">${(row.ministry_content||'').replace(/</g,'&lt;')}</textarea>
        </div>
        <div id="ministry-image" class="form-group" style="display:${row.ministry_type==='image'?'block':'none'}">
          <input type="text" name="ministry_image_url" value="${(row.ministry_content||'').replace(/"/g,'&quot;')}" placeholder="https://...">
        </div>
      </div>
    </div>

    <div id="quick-fields" style="display:${fmt==='quick'?'':'none'}">
      <div class="card">
        <div class="card-title">Message</div>
        <div class="form-group">
          <textarea name="quick_body" style="min-height:140px;">${bodyVal.replace(/</g,'&lt;')}</textarea>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Button <span class="tag">Optional</span></div>
        <div class="form-group">
          <label>Button label</label>
          <input type="text" name="cta_label" value="${(row.cta_label||'').replace(/"/g,'&quot;')}" placeholder="e.g. Sign Up">
        </div>
        <div class="form-group">
          <label>Button link (URL)</label>
          <input type="url" name="cta_url" value="${(row.cta_url||'').replace(/"/g,'&quot;')}" placeholder="https://...">
        </div>
      </div>
    </div>

    <div class="card" style="border-color:var(--amber);">
      <div class="card-title">Send email</div>
      <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-bottom:12px;">Choose who gets this in their inbox. You can save without sending.</div>
      <div class="radio-row">
        <label><input type="radio" name="email_send" value="none" checked> Don't send email</label>
        <label><input type="radio" name="email_send" value="test"> Test list only</label>
        <label><input type="radio" name="email_send" value="all"> All subscribers</label>
      </div>
    </div>

    <div class="btn-row" style="margin-top:8px;">
      <button type="submit" name="action" value="publish" class="btn btn-primary">Publish →</button>
      <button type="submit" name="action" value="draft" class="btn btn-secondary">Save as draft</button>
      <a href="/" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>

  </form>
</div>
<script>
let eventCount = 0;
function addEvent() {
  const c = document.getElementById('events-container');
  const id = ++eventCount;
  const div = document.createElement('div');
  div.className = 'event-block'; div.id = 'event-'+id;
  div.innerHTML = \`<button type="button" class="remove-event" onclick="removeEvent(\${id})">×</button>
    <div class="event-grid">
      <div class="form-group" style="margin:0;"><label>Date</label><input type="date" name="event_date_\${id}"></div>
      <div class="form-group" style="margin:0;"><label>Time</label><input type="text" name="event_time_\${id}" placeholder="e.g. 6:30 pm"></div>
    </div>
    <div class="form-group" style="margin-top:12px;margin-bottom:0;"><label>Event name</label><input type="text" name="event_name_\${id}" placeholder="e.g. Wednesday Lenten Service"></div>
    <div class="form-group" style="margin-top:12px;margin-bottom:0;"><label>Short description</label><input type="text" name="event_desc_\${id}" placeholder="One line"></div>
    <input type="hidden" name="event_ids" value="\${id}">\`;
  c.appendChild(div);
}
function removeEvent(id) { document.getElementById('event-'+id).remove(); }
function toggleMinistry(radio) {
  document.getElementById('ministry-text').style.display = radio.value === 'text' ? 'block' : 'none';
  document.getElementById('ministry-image').style.display = radio.value === 'image' ? 'block' : 'none';
}
function pickFormat(fmt) {
  document.getElementById('format-input').value = fmt;
  document.getElementById('fmt-weekly').classList.toggle('active', fmt === 'weekly');
  document.getElementById('fmt-quick').classList.toggle('active', fmt === 'quick');
  document.getElementById('weekly-fields').style.display = fmt === 'weekly' ? '' : 'none';
  document.getElementById('quick-fields').style.display = fmt === 'quick' ? '' : 'none';
}
${eventsJs}
</script>`, 'Edit Newsletter');
    }

    // ── SEND EMAIL (for saved newsletters) ──
    if (path.startsWith('/send-email/') && method === 'POST') {
      const id = path.split('/').pop();
      const form = await request.formData();
      const listType = form.get('list_type') || 'test';
      const listId = listType === 'test' ? 2 : parseInt(env.BREVO_LIST_ID || '0', 10);

      const row = await env.DB.prepare(
        'SELECT subject, pastor_note, ministry_content, ministry_type, published_at FROM newsletters WHERE id = ?'
      ).bind(id).first();
      if (!row) return new Response('Not found', { status: 404 });

      const eventsRows = await env.DB.prepare(
        'SELECT event_date, event_name, event_time, event_desc FROM events WHERE newsletter_id = ? ORDER BY sort_order'
      ).bind(id).all();

      const emailHtml = buildEmailHtml(row.subject, row.pastor_note, eventsRows.results, row.ministry_content, row.ministry_type, row.published_at);
      const result = await sendBrevoNewsletter(env, { subject: row.subject, htmlContent: emailHtml, listIds: [listId] });

      const suffix = result.success
        ? `&emailed=${listType}`
        : `&emailerr=${encodeURIComponent(result.error)}`;
      return new Response('', {
        status: 302,
        headers: { Location: `/newsitems?msg=emailed&subject=${encodeURIComponent(row.subject)}${suffix}` }
      });
    }

    // ── DELETE ──
    if (path.startsWith('/delete/') && method === 'POST') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/newsitems' } });
    }

    // ── NEWS & EVENTS: COMBINED LIST (Newsletter + News Posts) ──
    if (path === '/newsitems' && method === 'GET') {
      await sweepExpiredItems(env, new URL(request.url).origin);
      const [itemsRes, nlRes] = await Promise.all([
        env.DB.prepare('SELECT * FROM news_items ORDER BY pinned DESC, COALESCE(event_date, publish_date) ASC').all(),
        env.DB.prepare("SELECT id, subject, published_at, format, status, created_at FROM newsletters ORDER BY CASE WHEN status = 'draft' THEN 0 ELSE 1 END, published_at DESC").all(),
      ]);
      const today = new Date().toISOString().split('T')[0];
      const msgParam = url.searchParams.get('msg');
      const subjectParam = decodeURIComponent(url.searchParams.get('subject') || '');
      const emailedParam = url.searchParams.get('emailed');
      const emailErrParam = url.searchParams.get('emailerr');
      let alertHtml = '';
      if (msgParam === 'saved') alertHtml = `<div class="alert alert-success">✓ News item saved.</div>`;
      if (msgParam === 'deleted') alertHtml = `<div class="alert alert-info">Item deleted.</div>`;
      if (msgParam === 'published') {
        const siteNewsUrl = 'https://timothystl.org/news';
        const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(siteNewsUrl)}`;
        const tweetText = subjectParam
          ? `📖 ${subjectParam} — read our latest update at ${siteNewsUrl}`
          : `Our latest update from Timothy Lutheran Church: ${siteNewsUrl}`;
        const twitterShareUrl = `https://x.com/intent/post?text=${encodeURIComponent(tweetText)}`;
        const bskyText = subjectParam
          ? `📖 ${subjectParam}\n\nOur weekly update from Timothy Lutheran Church:\n${siteNewsUrl}`
          : `Our latest update from Timothy Lutheran Church:\n${siteNewsUrl}`;
        const bskyShareUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(bskyText)}`;
        const igCaption = subjectParam
          ? `📖 ${subjectParam}\n\nOur weekly update is live — read it at timothystl.org/news\n\n@timothystl\n#TimothyLutheran #LindenwoordPark #StLouis #church`
          : `Our latest newsletter is live at timothystl.org/news\n\n@timothystl\n#TimothyLutheran #LindenwoordPark #StLouis #church`;
        const igCaptionJs = igCaption.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
        alertHtml = `
<div class="alert alert-success" style="margin-bottom:0;border-radius:10px 10px 0 0;">
  ✓ Newsletter published to website archive.${emailedParam === 'test' ? ' Email sent to test list.' : emailedParam === 'all' ? ' Email sent to all subscribers.' : ''}${emailErrParam ? ` ⚠️ Email error: ${emailErrParam}` : ''}
</div>
<div style="background:#f0f7f0;border:1px solid #b8d4b8;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;margin-bottom:20px;">
  <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#2a4d2a;margin-bottom:14px;">📣 Share to social media</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
    <a href="${fbShareUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13px;font-weight:700;background:#1877F2;color:white;padding:9px 18px;border-radius:6px;text-decoration:none;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg>
      Share on Facebook
    </a>
    <a href="${twitterShareUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13px;font-weight:700;background:#000;color:white;padding:9px 18px;border-radius:6px;text-decoration:none;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      Post on X
    </a>
    <a href="${bskyShareUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13px;font-weight:700;background:#0085ff;color:white;padding:9px 18px;border-radius:6px;text-decoration:none;">
      <svg width="16" height="14" viewBox="0 0 360 320" fill="white"><path d="M180 142c-16.3-31.1-60.7-89.4-102-120C38 0 0 5 0 72c0 29 15.6 121.3 26.2 144C85.4 342 153.9 310.4 180 310.4c26 0 94.6 31.6 153.8-94.4C344.4 193.3 360 101 360 72c0-67-38-72-78-50C240.7 52.6 196.3 110.9 180 142z"/></svg>
      Post on Bluesky
    </a>
    <a href="https://www.instagram.com" target="_blank" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13px;font-weight:700;background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);color:white;padding:9px 18px;border-radius:6px;text-decoration:none;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
      Open Instagram
    </a>
  </div>
  <div style="font-family:var(--sans);font-size:12px;font-weight:600;color:var(--gray);margin-bottom:6px;">Caption for Instagram — copy and paste:</div>
  <div id="ig-cap" style="font-family:var(--sans);font-size:13px;background:white;border:1px solid #ccd4cc;border-radius:6px;padding:12px 14px;line-height:1.8;white-space:pre-wrap;color:var(--charcoal);">${igCaption.replace(/</g,'&lt;')}</div>
  <button onclick="navigator.clipboard.writeText(\`${igCaptionJs}\`).then(()=>{this.textContent='✓ Copied!';this.style.background='#e8f5e9';setTimeout(()=>{this.textContent='Copy caption';this.style.background='';},2000)})" style="margin-top:8px;font-family:var(--sans);font-size:12px;font-weight:700;background:white;border:1px solid #aab8aa;border-radius:6px;padding:6px 16px;cursor:pointer;transition:background .2s;">Copy caption</button>
</div>`;
      } else if (msgParam === 'draft') {
        alertHtml = `<div class="alert alert-info">Draft saved. Use "Send test" or "Send to all" below to email it when ready.</div>`;
      } else if (msgParam === 'emailed') {
        const sentTo = emailedParam === 'test' ? 'test list' : 'all subscribers';
        alertHtml = emailErrParam
          ? `<div class="alert alert-error">Email failed: ${emailErrParam}</div>`
          : `<div class="alert alert-success">✓ "${subjectParam}" sent to ${sentTo}.</div>`;
      }

      // ── News items HTML ──
      const listHtml = itemsRes.results.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--gray);font-size:14px;">No news items yet. Add your first announcement.</div>`
        : itemsRes.results.map(item => {
            let status = 'active';
            if (item.publish_date && item.publish_date > today) status = 'upcoming';
            else if (item.expire_date && item.expire_date < today) status = 'expired';
            return `<div class="ni-row">
  ${item.pinned ? `<span class="badge badge-pinned">Pinned</span>` : ''}
  <span class="badge badge-${status}">${status}</span>
  <div class="ni-title">${item.title}</div>
  <div class="ni-meta">${item.event_date ? 'Event: ' + item.event_date + ' · ' : ''}Published: ${item.publish_date || ''}${item.expire_date ? ' → ' + item.expire_date : ''}</div>
  <div class="ni-actions">
    <a href="/newsitems/edit/${item.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/newsitems/delete/${item.id}" onsubmit="return confirm('Delete this item?')" style="margin:0;">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`;
          }).join('');

      // ── Newsletter HTML ──
      const nRows = nlRes.results;
      const drafts = nRows.filter(r => r.status === 'draft');
      const published = nRows.filter(r => r.status !== 'draft');
      const fmtLabel = (r) => r.format === 'quick'
        ? `<span class="badge" style="background:#e8f0fe;color:#1a3060;margin-left:8px;">⚡ Quick</span>`
        : '';
      const draftSectionHtml = drafts.length === 0 ? '' : `<div style="margin-bottom:16px;border:1px solid var(--amber);border-radius:8px;overflow:hidden;">
  <div style="background:#FFF8EC;padding:8px 16px;border-bottom:1px solid var(--amber);">
    <span style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#A07010;">Drafts — ${drafts.length}</span>
  </div>
  ${drafts.map(r => `<div class="newsletter-row">
  <div class="newsletter-date">${r.published_at || r.created_at || ''}</div>
  <div class="newsletter-subject">${r.subject}${fmtLabel(r)}</div>
  <div class="newsletter-actions">
    <a href="/edit/${r.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Send to test list?')">
      <input type="hidden" name="list_type" value="test">
      <button type="submit" class="btn btn-sm" style="background:var(--mist);color:var(--steel);border:1px solid var(--border);">Send test</button>
    </form>
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Send to ALL subscribers? This cannot be undone.')">
      <input type="hidden" name="list_type" value="all">
      <button type="submit" class="btn btn-sm btn-primary">Send to all</button>
    </form>
    <form method="POST" action="/delete/${r.id}" style="display:contents;" onsubmit="return confirm('Delete this draft?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('')}
</div>`;
      const publishedHtml = published.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--gray);font-family:var(--sans);font-size:14px;">No newsletters published yet.</div>`
        : published.map(r => `<div class="newsletter-row">
  <div class="newsletter-date">${r.published_at || ''}</div>
  <div class="newsletter-subject">${r.subject}${fmtLabel(r)}</div>
  <div class="newsletter-actions">
    <a href="/edit/${r.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/delete/${r.id}" style="display:contents;" onsubmit="return confirm('Delete this newsletter?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('');

      return html(`
${topbarHtml('news', `<a href="https://timothystl.org/news" target="_blank">View site →</a>`)}
<style>details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }</style>
<div class="wrap">
  <div class="page-title">News &amp; Events</div>
  <div class="page-sub">Manage newsletters and website announcements.</div>
  ${alertHtml}
  <details open style="margin-bottom:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
    <summary style="cursor:pointer;display:flex;align-items:center;padding:14px 20px;background:var(--steel);color:white;font-family:var(--sans);font-size:14px;font-weight:700;letter-spacing:.04em;">
      Newsletter
    </summary>
    <div style="padding:20px;">
      <div class="btn-row" style="margin-bottom:20px;">
        <a href="/new" class="btn btn-primary">+ Write newsletter</a>
      </div>
      ${draftSectionHtml}
      <div class="card" style="margin-bottom:0;">
        <div class="card-title">Past newsletters</div>
        ${publishedHtml}
      </div>
    </div>
  </details>
  <details open style="margin-bottom:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
    <summary style="cursor:pointer;display:flex;align-items:center;padding:14px 20px;background:var(--steel);color:white;font-family:var(--sans);font-size:14px;font-weight:700;letter-spacing:.04em;">
      News Posts
    </summary>
    <div style="padding:20px;">
      <div class="btn-row" style="margin-bottom:20px;">
        <a href="/newsitems/new" class="btn btn-primary">+ Add news item</a>
      </div>
      <div class="card" style="margin-bottom:0;">
        <div class="card-title">All items</div>
        ${listHtml}
      </div>
      <div style="margin-top:16px;padding:14px 18px;background:var(--mist);border-radius:8px;border-left:3px solid var(--steel);">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);margin-bottom:5px;">How it works</div>
        <div style="font-size:13px;color:var(--charcoal);line-height:1.9;">
          Items appear on the homepage and /news page automatically.<br>
          <strong>Pinned</strong> items always show first. Items auto-hide after their expire date.
        </div>
      </div>
    </div>
  </details>
</div>`, 'TLC Admin — News & Events');
    }

    // ── NEWS ITEMS: NEW FORM ──
    if (path === '/newsitems/new' && method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      const expire = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      return html(`
${topbarHtml('news', `<a href="/newsitems">← Back</a>`)}
<div class="wrap">
  <div class="page-title">New news item</div>
  <div class="page-sub">This will appear on the website homepage and news page immediately.</div>
  <form method="POST" action="/newsitems/create">
    <div class="card">
      <div class="card-title">Content</div>
      <div class="form-group">
        <label>Title <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="title" required placeholder="e.g. Easter services — April 20">
      </div>
      <div class="form-group">
        <label>Summary <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— shown on cards (2–3 sentences)</span></label>
        <textarea name="summary" style="min-height:80px;" placeholder="Short description shown on the homepage and news page cards."></textarea>
      </div>
      ${tinymceEditorSection()}
      <div class="form-group">
        <label>Header image URL <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, shown on the card thumbnail</span></label>
        <input type="text" name="image_url" placeholder="https://... (or leave blank — images can also be dropped into the body above)">
      </div>
    </div>
    <div class="card">
      <div class="card-title">Classification</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div class="form-group" style="margin:0;">
          <label>Theme <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional</span></label>
          <select name="theme" style="width:100%;font-family:var(--sans);font-size:14px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;">
            <option value="">— none —</option>
            ${THEMES.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label>Content type <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional</span></label>
          <select name="content_type" style="width:100%;font-family:var(--sans);font-size:14px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;">
            <option value="">— none —</option>
            ${CONTENT_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group" style="margin:0;">
        <label>Channels <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— where should this appear?</span></label>
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:6px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" name="ch_web" value="1" checked> Website</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" name="ch_email" value="1" checked> Email newsletter</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" name="ch_bulletin" value="1"> Bulletin</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" name="ch_social" value="1"> Social media</label>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Scheduling</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Publish date</label>
          <input type="date" name="publish_date" value="${today}">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Event date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, sorts by this date</span></label>
          <input type="date" name="event_date">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Expire date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— auto-hides after this date</span></label>
          <input type="date" name="expire_date" value="${expire}">
        </div>
      </div>
      <div class="form-group" style="margin-top:18px;margin-bottom:0;">
        <label>Pin to top</label>
        <div class="checkbox-row">
          <input type="checkbox" name="pinned" id="pinned" value="1">
          <span onclick="document.getElementById('pinned').click()">Show this item first, above all other news</span>
        </div>
      </div>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Save &amp; publish →</button>
      <a href="/newsitems" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, 'TLC Admin — New News Item', TINYMCE_HEAD);
    }

    // ── NEWS ITEMS: CREATE (POST) ──
    if (path === '/newsitems/create' && method === 'POST') {
      const form = await request.formData();
      const title = form.get('title') || '';
      const summary = form.get('summary') || '';
      const body = form.get('body') || '';
      const image_url = form.get('image_url') || '';
      const publish_date = form.get('publish_date') || new Date().toISOString().split('T')[0];
      const event_date = form.get('event_date') || '';
      const expire_date = form.get('expire_date') || '';
      const pinned = form.get('pinned') === '1' ? 1 : 0;
      const theme = form.get('theme') || '';
      const content_type = form.get('content_type') || '';
      const channels = [
        form.get('ch_web') === '1' && 'web',
        form.get('ch_email') === '1' && 'email',
        form.get('ch_bulletin') === '1' && 'bulletin',
        form.get('ch_social') === '1' && 'social',
      ].filter(Boolean).join(',') || 'web';
      await env.DB.prepare(
        'INSERT INTO news_items (title, summary, body, image_url, publish_date, event_date, expire_date, pinned, theme, content_type, channels) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(title, summary, body, image_url, publish_date, event_date || null, expire_date || null, pinned, theme || null, content_type || null, channels).run();
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=saved' } });
    }

    // ── NEWS ITEMS: EDIT FORM ──
    if (path.startsWith('/newsitems/edit/') && method === 'GET') {
      const id = path.split('/').pop();
      const item = await env.DB.prepare('SELECT * FROM news_items WHERE id = ?').bind(id).first();
      if (!item) return new Response('Not found', { status: 404 });
      const v = (val) => (val || '').replace(/"/g, '&quot;');
      return html(`
${topbarHtml('news', `<a href="/newsitems">← Back</a>`)}
<div class="wrap">
  <div class="page-title">Edit news item</div>
  <div class="page-sub">Changes go live immediately when you save.</div>
  <form method="POST" action="/newsitems/update/${item.id}">
    <div class="card">
      <div class="card-title">Content</div>
      <div class="form-group">
        <label>Title <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="title" required value="${v(item.title)}">
      </div>
      <div class="form-group">
        <label>Summary <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— shown on cards (2–3 sentences)</span></label>
        <textarea name="summary" style="min-height:80px;">${item.summary || ''}</textarea>
      </div>
      ${tinymceEditorSection(item.body || '')}
      <div class="form-group">
        <label>Header image URL <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, shown on the card thumbnail</span></label>
        <input type="text" name="image_url" value="${v(item.image_url)}" placeholder="https://... (or leave blank — images can also be dropped into the body above)">
      </div>
    </div>
    <div class="card">
      <div class="card-title">Classification</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div class="form-group" style="margin:0;">
          <label>Theme <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional</span></label>
          <select name="theme" style="width:100%;font-family:var(--sans);font-size:14px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;">
            <option value="">— none —</option>
            ${THEMES.map(t => `<option value="${t}"${item.theme === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label>Content type <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional</option></span></label>
          <select name="content_type" style="width:100%;font-family:var(--sans);font-size:14px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;">
            <option value="">— none —</option>
            ${CONTENT_TYPES.map(t => `<option value="${t}"${item.content_type === t ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group" style="margin:0;">
        <label>Channels <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— where should this appear?</span></label>
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:6px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" name="ch_web" value="1"${(item.channels == null || item.channels.includes('web')) ? ' checked' : ''}> Website</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" name="ch_email" value="1"${(item.channels || '').includes('email') ? ' checked' : ''}> Email newsletter</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" name="ch_bulletin" value="1"${(item.channels || '').includes('bulletin') ? ' checked' : ''}> Bulletin</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:400;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" name="ch_social" value="1"${(item.channels || '').includes('social') ? ' checked' : ''}> Social media</label>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Scheduling</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Publish date</label>
          <input type="date" name="publish_date" value="${item.publish_date || ''}">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Event date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, sorts by this date</span></label>
          <input type="date" name="event_date" value="${item.event_date || ''}">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Expire date</label>
          <input type="date" name="expire_date" value="${item.expire_date || ''}">
        </div>
      </div>
      <div class="form-group" style="margin-top:18px;margin-bottom:0;">
        <label>Pin to top</label>
        <div class="checkbox-row">
          <input type="checkbox" name="pinned" id="pinned" value="1"${item.pinned ? ' checked' : ''}>
          <span onclick="document.getElementById('pinned').click()">Show this item first, above all other news</span>
        </div>
      </div>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Save changes →</button>
      <a href="/newsitems" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, 'TLC Admin — Edit News Item', TINYMCE_HEAD);
    }

    // ── NEWS ITEMS: UPDATE (POST) ──
    if (path.startsWith('/newsitems/update/') && method === 'POST') {
      const id = path.split('/').pop();
      const form = await request.formData();
      const title = form.get('title') || '';
      const summary = form.get('summary') || '';
      const body = form.get('body') || '';
      const image_url = form.get('image_url') || '';
      const publish_date = form.get('publish_date') || '';
      const event_date = form.get('event_date') || '';
      const expire_date = form.get('expire_date') || '';
      const pinned = form.get('pinned') === '1' ? 1 : 0;
      const theme = form.get('theme') || '';
      const content_type = form.get('content_type') || '';
      const channels = [
        form.get('ch_web') === '1' && 'web',
        form.get('ch_email') === '1' && 'email',
        form.get('ch_bulletin') === '1' && 'bulletin',
        form.get('ch_social') === '1' && 'social',
      ].filter(Boolean).join(',') || 'web';
      await env.DB.prepare(
        'UPDATE news_items SET title=?, summary=?, body=?, image_url=?, publish_date=?, event_date=?, expire_date=?, pinned=?, theme=?, content_type=?, channels=? WHERE id=?'
      ).bind(title, summary, body, image_url, publish_date, event_date || null, expire_date || null, pinned, theme || null, content_type || null, channels, id).run();
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=saved' } });
    }

    // ── NEWS ITEMS: DELETE ──
    if (path.startsWith('/newsitems/delete/') && method === 'POST') {
      const id = path.split('/').pop();
      const origin = new URL(request.url).origin;
      const item = await env.DB.prepare('SELECT body FROM news_items WHERE id = ?').bind(id).first();
      if (item) {
        for (const key of extractImageKeys(item.body || '', origin)) {
          try { await env.IMAGES.delete(key); } catch (_) {}
        }
      }
      await env.DB.prepare('DELETE FROM news_items WHERE id = ?').bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=deleted' } });
    }

    // ════════════════════════════════════════════════════════
    // ── MINISTRIES ──────────────────────────────────────────
    // ════════════════════════════════════════════════════════

    // Compat: redirect old /youth/* admin URLs to /ministries/*
    if (path === '/youth' && method === 'GET') {
      return new Response('', { status: 302, headers: { Location: '/ministries' } });
    }
    if (path.startsWith('/youth/') && method === 'GET') {
      return new Response('', { status: 302, headers: { Location: '/ministries' + path.slice('/youth'.length) } });
    }

    if (path.startsWith('/ministries')) {
      const CORE_SLUGS = ['youth','sundayschool','confirmation','vbs','egghunt','family','music','stephen','foodpantry','bees','christmasmarket'];

      // ── Ministry list ──
      if (path === '/ministries' && method === 'GET') {
        const pages = await env.DB.prepare('SELECT slug, title, has_posts, updated_at FROM youth_pages ORDER BY rowid').all();
        const msg = url.searchParams.get('msg');
        let alertHtml = '';
        if (msg === 'saved')       alertHtml = `<div class="alert alert-success">✓ Page saved and published.</div>`;
        if (msg === 'created')     alertHtml = `<div class="alert alert-success">✓ Ministry page created.</div>`;
        if (msg === 'deleted')     alertHtml = `<div class="alert alert-info">Ministry page deleted.</div>`;
        if (msg === 'postsaved')   alertHtml = `<div class="alert alert-success">✓ Post saved.</div>`;
        if (msg === 'postdeleted') alertHtml = `<div class="alert alert-info">Post deleted.</div>`;

        let countMap = {};
        try {
          const countRows = await env.DB.prepare(
            'SELECT ministry_slug, COUNT(*) as cnt FROM ministry_posts GROUP BY ministry_slug'
          ).all();
          for (const r of countRows.results) countMap[r.ministry_slug] = r.cnt;
        } catch (_) {}

        const listHtml = pages.results.map(p => {
          const postCount = countMap[p.slug] || 0;
          return `<div class="ni-row">
  <div class="ni-title">${p.title}</div>
  <div class="ni-meta">${p.updated_at ? 'Updated ' + p.updated_at.split('T')[0] : 'Not yet edited'}</div>
  <div class="ni-actions">
    ${p.has_posts ? `<a href="/ministries/${p.slug}/posts" class="btn btn-sm btn-sage">Posts${postCount > 0 ? ' (' + postCount + ')' : ''}</a>` : ''}
    <a href="/ministries/edit/${p.slug}" class="btn btn-sm btn-secondary">Edit</a>
    ${!CORE_SLUGS.includes(p.slug) ? `<form method="POST" action="/ministries/delete/${p.slug}" onsubmit="return confirm('Delete this ministry page?')" style="margin:0;"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form>` : ''}
  </div>
</div>`;
        }).join('');

        return html(`
${topbarHtml('ministries')}
<div class="wrap">
  <div class="page-title">Ministries</div>
  <div class="page-sub">Edit ministry pages and manage posts. Changes appear on the website immediately.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/ministries/add" class="btn btn-primary">+ Add ministry page</a>
    <a href="/voters" class="btn btn-secondary">Voters Page →</a>
  </div>
  <div class="card">
    ${listHtml}
  </div>
</div>`, 'Ministries Admin');
      }

      // ── Add ministry form (GET) ──
      if (path === '/ministries/add' && method === 'GET') {
        return html(`
${topbarHtml('ministries', `<a href="/ministries">← All ministries</a>`)}
<div class="wrap">
  <div class="page-title">New ministry page</div>
  <div class="page-sub">Create a new ministry landing page.</div>
  <form method="POST" action="/ministries/create">
    <div class="card">
      <div class="form-group">
        <label>Slug <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="slug" required placeholder="e.g. outreach (becomes the URL: /outreach)">
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">Lowercase letters, numbers, and hyphens only. Cannot be changed after creation.</div>
      </div>
      <div class="form-group">
        <label>Page title <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="title" required placeholder="e.g. Outreach Ministry">
      </div>
      <div class="form-group">
        <label>Enable posts <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— allows adding time-stamped posts (events, recaps, announcements)</span></label>
        <div class="checkbox-row">
          <input type="checkbox" name="has_posts" id="has_posts" value="1">
          <span onclick="document.getElementById('has_posts').click()">This ministry needs a posts feed</span>
        </div>
      </div>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Create ministry →</button>
      <a href="/ministries" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, 'New Ministry');
      }

      // ── Create ministry (POST) ──
      if (path === '/ministries/create' && method === 'POST') {
        const form = await request.formData();
        const slug = (form.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
        const title = form.get('title') || '';
        const has_posts = form.get('has_posts') === '1' ? 1 : 0;
        if (!slug || !title) return new Response('', { status: 302, headers: { Location: '/ministries/add' } });
        await env.DB.prepare(
          'INSERT OR IGNORE INTO youth_pages (slug, title, content, has_posts, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(slug, title, '', has_posts, '').run();
        return new Response('', { status: 302, headers: { Location: '/ministries?msg=created' } });
      }

      // ── Edit ministry page (GET) ──
      if (path.startsWith('/ministries/edit/') && method === 'GET') {
        const slug = path.slice('/ministries/edit/'.length);
        const page = await env.DB.prepare('SELECT * FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!page) return new Response('Not found', { status: 404 });
        return html(`
${topbarHtml('ministries', `<a href="/ministries">← All ministries</a>`)}
<div class="wrap">
  <div class="page-title">${page.title}</div>
  <div class="page-sub">Edit this page and click Save &amp; Publish when done.</div>
  <div class="card">
    <form method="POST" action="/ministries/update/${slug}">
      <div class="form-group">
        <label>Page title</label>
        <input type="text" name="title" value="${(page.title || '').replace(/"/g, '&quot;')}" required>
      </div>
      ${tinymceYouthSection(page.content || '')}
      <div class="card" style="margin-top:24px;background:var(--mist);border:1px solid var(--ice);">
        <div class="card-title">CTA Buttons <span class="tag">Optional</span></div>
        <div class="card-sub">Add up to two call-to-action buttons at the bottom of this page. When any button is set here, it <strong>replaces</strong> the default button bar. Leave both rows blank to keep the default buttons.</div>
        <div style="margin-top:16px;">
          <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:8px;">Primary button (navy/gold)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="form-group" style="margin:0;">
              <label>Button label</label>
              <input type="text" name="cta_label" value="${(page.cta_label || '').replace(/"/g, '&quot;')}" placeholder="e.g. Sign up to volunteer →">
            </div>
            <div class="form-group" style="margin:0;">
              <label>Button URL</label>
              <input type="text" name="cta_url" value="${(page.cta_url || '').replace(/"/g, '&quot;')}" placeholder="https://...">
            </div>
          </div>
        </div>
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);">
          <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:8px;">Secondary button (outline/ghost)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
            <div class="form-group" style="margin:0;">
              <label>Button label</label>
              <input type="text" name="cta_label_2" value="${(page.cta_label_2 || '').replace(/"/g, '&quot;')}" placeholder="e.g. Email the office">
            </div>
            <div class="form-group" style="margin:0;">
              <label>Button URL</label>
              <input type="text" name="cta_url_2" value="${(page.cta_url_2 || '').replace(/"/g, '&quot;')}" placeholder="https://... or mailto:...">
            </div>
          </div>
        </div>
      </div>
      <div class="btn-row" style="margin-top:24px;">
        <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save &amp; Publish →</button>
        <a href="/ministries" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, `Edit — ${page.title}`, TINYMCE_HEAD);
      }

      // ── Save ministry page (POST) ──
      if (path.startsWith('/ministries/update/') && method === 'POST') {
        const slug = path.slice('/ministries/update/'.length);
        const form = await request.formData();
        const title = form.get('title') || '';
        const content = form.get('content') || '';
        const ctaLabel = form.get('cta_label') || '';
        const ctaUrl = form.get('cta_url') || '';
        const ctaLabel2 = form.get('cta_label_2') || '';
        const ctaUrl2 = form.get('cta_url_2') || '';
        const now = new Date().toISOString();
        await env.DB.prepare(
          'UPDATE youth_pages SET title = ?, content = ?, cta_label = ?, cta_url = ?, cta_label_2 = ?, cta_url_2 = ?, updated_at = ? WHERE slug = ?'
        ).bind(title, content, ctaLabel, ctaUrl, ctaLabel2, ctaUrl2, now, slug).run();
        return new Response('', { status: 302, headers: { Location: '/ministries?msg=saved' } });
      }

      // ── Delete ministry page (POST) — non-core only ──
      if (path.startsWith('/ministries/delete/') && method === 'POST') {
        const slug = path.slice('/ministries/delete/'.length);
        if (CORE_SLUGS.includes(slug)) {
          return new Response('Cannot delete a built-in ministry page.', { status: 403 });
        }
        await env.DB.prepare('DELETE FROM ministry_posts WHERE ministry_slug = ?').bind(slug).run();
        await env.DB.prepare('DELETE FROM youth_pages WHERE slug = ?').bind(slug).run();
        return new Response('', { status: 302, headers: { Location: '/ministries?msg=deleted' } });
      }

      // ── Posts list ──
      if (path.match(/^\/ministries\/[^/]+\/posts$/) && method === 'GET') {
        const slug = path.split('/')[2];
        const page = await env.DB.prepare('SELECT title FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!page) return new Response('Not found', { status: 404 });
        const posts = await env.DB.prepare(
          'SELECT id, title, post_date, event_date, expire_date, pinned, created_at FROM ministry_posts WHERE ministry_slug = ? ORDER BY pinned DESC, COALESCE(event_date, post_date) ASC, id ASC'
        ).bind(slug).all();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'postsaved' ? `<div class="alert alert-success">✓ Post saved.</div>`
          : msg === 'postdeleted' ? `<div class="alert alert-info">Post deleted.</div>` : '';
        const today = new Date().toISOString().split('T')[0];
        const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        const listHtml = posts.results.length === 0
          ? `<div style="text-align:center;padding:40px;color:var(--gray);font-size:14px;">No posts yet. Add your first one.</div>`
          : posts.results.map(p => {
              const sortDate = p.event_date || p.post_date;
              const upcoming = sortDate && sortDate >= today;
              const expired = p.expire_date && p.expire_date < today;
              const editUrl = '/ministries/' + slug + '/posts/edit/' + p.id;
              const deleteUrl = '/ministries/' + slug + '/posts/delete/' + p.id;
              let badge = '';
              if (p.pinned) badge += '<span class="badge badge-pinned">Pinned</span>';
              if (expired) badge += '<span class="badge badge-expired">Expired</span>';
              else if (sortDate) badge += '<span class="badge badge-' + (upcoming ? 'upcoming' : 'active') + '">' + (upcoming ? 'Upcoming' : 'Past') + '</span>';
              const metaParts = [];
              if (p.event_date) metaParts.push('Event: ' + p.event_date);
              else if (p.post_date) metaParts.push('Posted: ' + p.post_date);
              if (p.expire_date) metaParts.push('Expires: ' + p.expire_date);
              return '<div class="ni-row">' +
                badge +
                '<div class="ni-title">' + esc(p.title) + '</div>' +
                '<div class="ni-meta">' + metaParts.join(' · ') + '</div>' +
                '<div class="ni-actions">' +
                '<a href="' + editUrl + '" class="btn btn-sm btn-secondary">Edit</a>' +
                '<form method="POST" action="' + deleteUrl + '" onsubmit="return confirm(\'Delete this post?\')" style="margin:0;">' +
                '<button type="submit" class="btn btn-sm btn-danger">Delete</button>' +
                '</form></div></div>';
            }).join('');

        return html(`
${topbarHtml('ministries', `<a href="/ministries">← All ministries</a>`)}
<div class="wrap">
  <div class="page-title">${page.title} — Posts</div>
  <div class="page-sub">Upcoming posts show at top. Past posts roll down automatically by date.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/ministries/${slug}/posts/new" class="btn btn-primary">+ New post</a>
  </div>
  <div class="card">
    ${listHtml}
  </div>
  <div style="margin-top:20px;padding-top:20px;border-top:1px solid var(--border);">
    <a href="/ministries/edit/${slug}" style="font-family:var(--sans);font-size:13px;color:var(--gray);text-decoration:none;">⚙ Edit the ${page.title} page description →</a>
  </div>
</div>`, `${page.title} Posts`);
      }

      // ── New post form (GET) ──
      if (path.match(/^\/ministries\/[^/]+\/posts\/new$/) && method === 'GET') {
        const slug = path.split('/')[2];
        const page = await env.DB.prepare('SELECT title FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!page) return new Response('Not found', { status: 404 });
        const today = new Date().toISOString().split('T')[0];
        return html(`
${topbarHtml('ministries', `<a href="/ministries/${slug}/posts">← Posts</a>`)}
<div class="wrap">
  <div class="page-title">New post — ${page.title}</div>
  <form method="POST" action="/ministries/${slug}/posts/create">
    <div class="card">
      <div class="form-group">
        <label>Title <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="title" required placeholder="e.g. Summer Servant Event 2026">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Publish date</label>
          <input type="date" name="post_date" value="${today}">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Event date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional</span></label>
          <input type="date" name="event_date">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Expire date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— auto-hides</span></label>
          <input type="date" name="expire_date">
        </div>
      </div>
      <div class="form-group" style="margin-top:14px;">
        <label>Pin to top</label>
        <div class="checkbox-row">
          <input type="checkbox" name="pinned" id="pinned_post" value="1">
          <span onclick="document.getElementById('pinned_post').click()">Show this post above all others</span>
        </div>
      </div>
      ${tinymcePostSection()}
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save &amp; Publish →</button>
      <a href="/ministries/${slug}/posts" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, `New Post — ${page.title}`, TINYMCE_HEAD);
      }

      // ── Create post (POST) ──
      if (path.match(/^\/ministries\/[^/]+\/posts\/create$/) && method === 'POST') {
        const slug = path.split('/')[2];
        const form = await request.formData();
        const title = form.get('title') || '';
        const post_date = form.get('post_date') || new Date().toISOString().split('T')[0];
        const event_date = form.get('event_date') || null;
        const expire_date = form.get('expire_date') || null;
        const body = form.get('body') || '';
        const pinned = form.get('pinned') === '1' ? 1 : 0;
        await env.DB.prepare(
          'INSERT INTO ministry_posts (ministry_slug, title, post_date, event_date, expire_date, body, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(slug, title, post_date, event_date, expire_date, body, pinned).run();
        return new Response('', { status: 302, headers: { Location: `/ministries/${slug}/posts?msg=postsaved` } });
      }

      // ── Edit post form (GET) ──
      if (path.match(/^\/ministries\/[^/]+\/posts\/edit\/[^/]+$/) && method === 'GET') {
        const parts = path.split('/');
        const slug = parts[2];
        const id = parts[5];
        const page = await env.DB.prepare('SELECT title FROM youth_pages WHERE slug = ?').bind(slug).first();
        const post = await env.DB.prepare('SELECT * FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).first();
        if (!post || !page) return new Response('Not found', { status: 404 });
        return html(`
${topbarHtml('ministries', `<a href="/ministries/${slug}/posts">← Posts</a>`)}
<div class="wrap">
  <div class="page-title">Edit post — ${page.title}</div>
  <form method="POST" action="/ministries/${slug}/posts/update/${id}">
    <div class="card">
      <div class="form-group">
        <label>Title <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="title" required value="${(post.title || '').replace(/"/g, '&quot;')}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Publish date</label>
          <input type="date" name="post_date" value="${post.post_date || ''}">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Event date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional</span></label>
          <input type="date" name="event_date" value="${post.event_date || ''}">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Expire date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— auto-hides</span></label>
          <input type="date" name="expire_date" value="${post.expire_date || ''}">
        </div>
      </div>
      <div class="form-group" style="margin-top:14px;">
        <label>Pin to top</label>
        <div class="checkbox-row">
          <input type="checkbox" name="pinned" id="pinned_post" value="1"${post.pinned ? ' checked' : ''}>
          <span onclick="document.getElementById('pinned_post').click()">Show this post above all others</span>
        </div>
      </div>
      ${tinymcePostSection(post.body || '')}
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save changes →</button>
      <a href="/ministries/${slug}/posts" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, `Edit Post — ${page.title}`, TINYMCE_HEAD);
      }

      // ── Update post (POST) ──
      if (path.match(/^\/ministries\/[^/]+\/posts\/update\/[^/]+$/) && method === 'POST') {
        const parts = path.split('/');
        const slug = parts[2];
        const id = parts[5];
        const form = await request.formData();
        const title = form.get('title') || '';
        const post_date = form.get('post_date') || '';
        const event_date = form.get('event_date') || null;
        const expire_date = form.get('expire_date') || null;
        const body = form.get('body') || '';
        const pinned = form.get('pinned') === '1' ? 1 : 0;
        await env.DB.prepare(
          'UPDATE ministry_posts SET title = ?, post_date = ?, event_date = ?, expire_date = ?, body = ?, pinned = ? WHERE id = ? AND ministry_slug = ?'
        ).bind(title, post_date, event_date, expire_date, body, pinned, id, slug).run();
        return new Response('', { status: 302, headers: { Location: `/ministries/${slug}/posts?msg=postsaved` } });
      }

      // ── Delete post (POST) ──
      if (path.match(/^\/ministries\/[^/]+\/posts\/delete\/[^/]+$/) && method === 'POST') {
        const parts = path.split('/');
        const slug = parts[2];
        const id = parts[5];
        await env.DB.prepare('DELETE FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).run();
        return new Response('', { status: 302, headers: { Location: `/ministries/${slug}/posts?msg=postdeleted` } });
      }

    } // end if (path.startsWith('/ministries'))

    // ── PAGES TAB ──
    if (path.startsWith('/pages')) {
      // List all editable page blocks
      if (path === '/pages' && method === 'GET') {
        const blocks = await env.DB.prepare('SELECT key, label, value, published, updated_at FROM page_content ORDER BY rowid').all();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Page block saved.</div>` : '';
        const rows = blocks.results.map(b => {
          const isEmpty = !b.value || !b.value.trim();
          const isHidden = b.published === 0;
          const updated = b.updated_at ? new Date(b.updated_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : '—';
          let statusHtml;
          if (isEmpty) statusHtml = '<em style="color:var(--text-muted);">Not set — block hidden on site</em>';
          else if (isHidden) statusHtml = '<span style="color:#8a6a00;">⏸ Hidden (content saved)</span>';
          else statusHtml = '<span style="color:#2a5c2a;">✓ Published</span>';
          return `<tr>
            <td><strong>${b.label}</strong><br><span style="font-size:12px;color:var(--gray);">${b.key}</span></td>
            <td style="font-size:13px;color:var(--gray);">${statusHtml}</td>
            <td style="font-size:12px;color:var(--gray);">${updated}</td>
            <td><a href="/pages/edit/${b.key}" class="btn btn-sm btn-secondary">Edit</a></td>
          </tr>`;
        }).join('');
        return html(`
${topbarHtml('pages')}
<div class="wrap">
  <div class="page-title">Pages</div>
  <div class="page-sub">Edit content blocks that appear on specific pages of the website. Leave a block blank to hide it.</div>
  ${alertHtml}
  <div class="card" style="padding:0;overflow:hidden;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:var(--linen);border-bottom:1px solid var(--border);">
        <th style="padding:12px 16px;text-align:left;font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">Block</th>
        <th style="padding:12px 16px;text-align:left;font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">Status</th>
        <th style="padding:12px 16px;text-align:left;font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">Updated</th>
        <th style="padding:12px 16px;"></th>
      </tr></thead>
      <tbody style="font-family:var(--sans);">
        ${rows}
      </tbody>
    </table>
  </div>
</div>`, 'Pages');
      }

      // Edit a page block
      if (path.startsWith('/pages/edit/') && method === 'GET') {
        const key = path.slice('/pages/edit/'.length);
        const block = await env.DB.prepare('SELECT * FROM page_content WHERE key = ?').bind(key).first();
        if (!block) return new Response('Not found', { status: 404 });
        const HINT_MAP = {
          'home-notice':           'Appears on the home page as a highlighted notice box. Leave blank to hide.',
          'worship-notice':        'Appears on the Worship page (e.g. special service times, holiday changes). Leave blank to hide.',
          'about-notice':          'Appears on the About page. Leave blank to hide.',
          'seasonal-lent':         'Shown on the Worship page during Lent / midweek services. Toggle published on/off without losing your content.',
          'seasonal-easter':       'Shown on the Worship page for Holy Week and Easter services. Toggle published on/off without losing your content.',
          'seasonal-thanksgiving': 'Shown on the Worship page around Thanksgiving. Toggle published on/off without losing your content.',
          'seasonal-advent':       'Shown on the Worship page during Advent. Toggle published on/off without losing your content.',
          'seasonal-christmas':    'Shown on the Worship page for Christmas Eve and Christmas Day services. Toggle published on/off without losing your content.',
          'community-concert':     'Shown on the Music Ministry page. Enter the performer name, date, time, and any details. Toggle off between concerts.',
        };
        const hint = HINT_MAP[key] || 'Appears on the site when content is set. Leave blank to hide.';
        const isSeasonal = key.startsWith('seasonal-') || key === 'community-concert';
        const publishedChecked = (block.published === 1 || block.published === null) ? 'checked' : '';
        const publishToggleHtml = isSeasonal ? `
        <div class="card" style="margin-bottom:24px;background:var(--mist);border:1px solid var(--ice);">
          <div class="card-title">Visibility</div>
          <label style="display:flex;align-items:center;gap:12px;font-family:var(--sans);font-size:14px;cursor:pointer;">
            <input type="checkbox" name="published" value="1" ${publishedChecked} style="width:18px;height:18px;cursor:pointer;">
            Show this block on the website
          </label>
          <div style="font-size:12px;color:var(--gray);margin-top:8px;">Uncheck to hide without losing your content — useful between seasons or concerts.</div>
        </div>` : '';
        return html(`
${topbarHtml('pages', `<a href="/pages">← All pages</a>`)}
<div class="wrap">
  <div class="page-title">${block.label}</div>
  <div class="page-sub">${hint}</div>
  <div class="card">
    <form method="POST" action="/pages/update/${key}">
      ${publishToggleHtml}
      ${tinymcePageSection(block.value || '')}
      <div class="btn-row" style="margin-top:24px;">
        <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save &amp; Publish →</button>
        ${!isSeasonal ? `<a href="/pages/update/${key}?clear=1" class="btn btn-sm" style="background:#fce8e8;color:#7a1f1f;border:1px solid #e8b4b4;" onclick="return confirm('Clear this block and hide it from the site?')">Clear &amp; hide</a>` : ''}
        <a href="/pages" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, `Edit — ${block.label}`, TINYMCE_HEAD);
      }

      // Clear a page block (GET with ?clear=1)
      if (path.startsWith('/pages/update/') && method === 'GET' && url.searchParams.get('clear') === '1') {
        const key = path.slice('/pages/update/'.length);
        const now = new Date().toISOString();
        await env.DB.prepare('UPDATE page_content SET value = ?, updated_at = ? WHERE key = ?').bind('', now, key).run();
        return new Response('', { status: 302, headers: { Location: '/pages?msg=saved' } });
      }

      // Save a page block
      if (path.startsWith('/pages/update/') && method === 'POST') {
        const key = path.slice('/pages/update/'.length);
        const form = await request.formData();
        const value = form.get('content') || '';
        const published = form.has('published') ? 1 : 0;
        const now = new Date().toISOString();
        // Only save published flag for blocks that have the toggle (seasonal and concert blocks)
        if (key.startsWith('seasonal-') || key === 'community-concert') {
          await env.DB.prepare('UPDATE page_content SET value = ?, published = ?, updated_at = ? WHERE key = ?').bind(value, published, now, key).run();
        } else {
          await env.DB.prepare('UPDATE page_content SET value = ?, published = 1, updated_at = ? WHERE key = ?').bind(value, now, key).run();
        }
        return new Response('', { status: 302, headers: { Location: '/pages?msg=saved' } });
      }
    } // end pages tab

    // ── STAFF TAB ──────────────────────────────────────────────
    if (path.startsWith('/staff')) {
      const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

      // Staff list
      if (path === '/staff' && method === 'GET') {
        const members = await env.DB.prepare('SELECT * FROM staff_members ORDER BY display_order, id').all();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Staff member saved.</div>`
          : msg === 'deleted' ? `<div class="alert alert-info">Staff member removed.</div>` : '';
        const rows = members.results.map(m => `
          <div class="ni-row" style="align-items:center;">
            <div style="font-size:28px;width:44px;height:44px;border-radius:50%;background:var(--mist);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
              ${m.photo_url ? `<img src="${esc(m.photo_url)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">` : ''}
              <span style="font-family:var(--serif);font-size:14px;color:var(--steel);">${esc(m.name).split(' ').map(w=>w[0]).join('').slice(0,2)}</span>
            </div>
            <div style="flex:1;">
              <div class="ni-title">${esc(m.name)}</div>
              <div class="ni-meta">${esc(m.title || '')}${m.email ? ' · ' + esc(m.email) : ''} · Order: ${m.display_order}</div>
            </div>
            <div class="ni-actions">
              <a href="/staff/edit/${m.id}" class="btn btn-sm btn-secondary">Edit</a>
              <form method="POST" action="/staff/delete/${m.id}" onsubmit="return confirm('Remove ${esc(m.name)} from staff?')" style="margin:0;">
                <button type="submit" class="btn btn-sm btn-danger">Remove</button>
              </form>
            </div>
          </div>`).join('');
        return html(`
${topbarHtml('staff')}
<div class="wrap">
  <div class="page-title">Staff &amp; Leadership</div>
  <div class="page-sub">Manage the staff cards shown on the About page. Drag to reorder by updating the Order number.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/staff/new" class="btn btn-primary">+ Add staff member</a>
  </div>
  <div class="card" style="padding:0;overflow:hidden;">
    ${members.results.length === 0 ? '<div style="padding:40px;text-align:center;color:var(--gray);">No staff members yet.</div>' : rows}
  </div>
</div>`, 'Staff');
      }

      // New staff form
      if (path === '/staff/new' && method === 'GET') {
        const nextOrder = 10;
        return html(`
${topbarHtml('staff', `<a href="/staff">← All staff</a>`)}
<div class="wrap">
  <div class="page-title">Add Staff Member</div>
  <div class="card">
    <form method="POST" action="/staff/create">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group"><label>Name <span style="color:#B85C3A;">*</span></label><input type="text" name="name" required></div>
        <div class="form-group"><label>Title / Role <span style="color:#B85C3A;">*</span></label><input type="text" name="title" required placeholder="e.g. Lead Pastor"></div>
        <div class="form-group"><label>Email</label><input type="email" name="email" placeholder="name@timothystl.org"></div>
        <div class="form-group"><label>Photo URL</label><input type="text" name="photo_url" placeholder="/images/staff/name.jpg"></div>
        <div class="form-group"><label>Display order <span style="font-size:11px;color:var(--gray);">(lower = first)</span></label><input type="number" name="display_order" value="80" min="0" step="10"></div>
      </div>
      <div class="form-group"><label>Bio <span style="font-size:11px;color:var(--gray);">(optional)</span></label><textarea name="bio" rows="6" placeholder="Short biography..." style="width:100%;font-family:var(--sans);font-size:14px;padding:10px;border:1px solid var(--border);border-radius:var(--r-sm);resize:vertical;"></textarea></div>
      <div class="btn-row" style="margin-top:16px;">
        <button type="submit" class="btn btn-primary">Save →</button>
        <a href="/staff" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'New Staff Member');
      }

      // Create staff member
      if (path === '/staff/create' && method === 'POST') {
        const form = await request.formData();
        const name = form.get('name') || '';
        if (!name.trim()) return new Response('', { status: 302, headers: { Location: '/staff' } });
        await env.DB.prepare(
          'INSERT INTO staff_members (name, title, email, photo_url, bio, display_order) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(name, form.get('title')||'', form.get('email')||'', form.get('photo_url')||'', form.get('bio')||'', parseInt(form.get('display_order')||'80')).run();
        return new Response('', { status: 302, headers: { Location: '/staff?msg=saved' } });
      }

      // Edit staff form
      if (path.match(/^\/staff\/edit\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        const m = await env.DB.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first();
        if (!m) return new Response('Not found', { status: 404 });
        return html(`
${topbarHtml('staff', `<a href="/staff">← All staff</a>`)}
<div class="wrap">
  <div class="page-title">Edit — ${esc(m.name)}</div>
  <div class="card">
    <form method="POST" action="/staff/update/${m.id}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group"><label>Name <span style="color:#B85C3A;">*</span></label><input type="text" name="name" value="${esc(m.name)}" required></div>
        <div class="form-group"><label>Title / Role</label><input type="text" name="title" value="${esc(m.title||'')}"></div>
        <div class="form-group"><label>Email</label><input type="email" name="email" value="${esc(m.email||'')}"></div>
        <div class="form-group"><label>Photo URL</label><input type="text" name="photo_url" value="${esc(m.photo_url||'')}" placeholder="/images/staff/name.jpg"></div>
        <div class="form-group"><label>Display order <span style="font-size:11px;color:var(--gray);">(lower = first)</span></label><input type="number" name="display_order" value="${m.display_order||0}" min="0" step="10"></div>
      </div>
      <div class="form-group"><label>Bio</label><textarea name="bio" rows="8" style="width:100%;font-family:var(--sans);font-size:14px;padding:10px;border:1px solid var(--border);border-radius:var(--r-sm);resize:vertical;">${esc(m.bio||'')}</textarea></div>
      <div class="btn-row" style="margin-top:16px;">
        <button type="submit" class="btn btn-primary">Save →</button>
        <a href="/staff" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, `Edit — ${m.name}`);
      }

      // Update staff member
      if (path.match(/^\/staff\/update\/\d+$/) && method === 'POST') {
        const id = path.split('/').pop();
        const form = await request.formData();
        await env.DB.prepare(
          'UPDATE staff_members SET name=?, title=?, email=?, photo_url=?, bio=?, display_order=? WHERE id=?'
        ).bind(form.get('name')||'', form.get('title')||'', form.get('email')||'', form.get('photo_url')||'', form.get('bio')||'', parseInt(form.get('display_order')||'0'), id).run();
        return new Response('', { status: 302, headers: { Location: '/staff?msg=saved' } });
      }

      // Delete staff member
      if (path.match(/^\/staff\/delete\/\d+$/) && method === 'POST') {
        const id = path.split('/').pop();
        await env.DB.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
        return new Response('', { status: 302, headers: { Location: '/staff?msg=deleted' } });
      }
    } // end staff tab

    // ── SETTINGS TAB ───────────────────────────────────────────
    // ── GYM RENTALS ─────────────────────────────────────────────
    if (path.startsWith('/gym-rentals')) {
      await sweepExpiredHolds(env);

      const gymMsg = url.searchParams.get('msg');
      const gymAlertN = parseInt(url.searchParams.get('n') || '0', 10);
      const gymAlert = gymMsg === 'saved'           ? `<div class="alert alert-success">✓ Saved.</div>`
        : gymMsg === 'created'       ? `<div class="alert alert-success">✓ Group created.</div>`
        : gymMsg === 'deleted'       ? `<div class="alert alert-success">✓ Deleted.</div>`
        : gymMsg === 'confirmed-all' ? `<div class="alert alert-success">✓ ${gymAlertN} hold${gymAlertN===1?'':'s'} confirmed — invoices sent.</div>`
        : '';

      // ── DASHBOARD ──────────────────────────────────────────────
      if (path === '/gym-rentals' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const fmtShort = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

        const [holdsRes, pendingRes, confirmedRes, rateRow] = await Promise.all([
          env.DB.prepare(`SELECT b.*, g.name as group_name, r.day_of_week as rec_dow, r.start_date as rec_start, r.end_date as rec_end FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id LEFT JOIN gym_recurrences r ON r.id = b.recurrence_id WHERE b.status = 'hold' ORDER BY b.group_id, b.hold_expires_at`).all(),
          env.DB.prepare(`SELECT r.*, g.name as group_name FROM gym_recurrences r LEFT JOIN gym_groups g ON g.id = r.group_id WHERE r.status = 'pending_review' ORDER BY r.created_at`).all(),
          env.DB.prepare(`SELECT b.*, g.name as group_name, r.day_of_week as rec_dow, r.start_date as rec_start, r.end_date as rec_end FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id LEFT JOIN gym_recurrences r ON r.id = b.recurrence_id WHERE b.status = 'confirmed' AND b.booking_date >= ? ORDER BY b.group_id, b.recurrence_id, b.booking_date`).bind(today).all(),
          env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first(),
        ]);

        // De-duplicate recurring bookings — show one row per recurrence_id
        const buildItems = (rows) => {
          const seen = new Set();
          const items = [];
          for (const b of rows) {
            if (b.recurrence_id) {
              if (seen.has(b.recurrence_id)) continue;
              seen.add(b.recurrence_id);
              items.push({ ...b, isRecurring: true });
            } else {
              items.push({ ...b, isRecurring: false });
            }
          }
          return items;
        };

        // Render a single booking line
        const bookingLine = (b, holdButtons = false, deleteButton = false) => {
          const timeRange = `${fmt12h(b.start_time)}–${fmt12h(b.end_time)}`;
          const deleteAction = b.isRecurring
            ? `/gym-rentals/bookings/delete-recurring/${b.recurrence_id}`
            : `/gym-rentals/bookings/delete/${b.id}`;
          const deleteConfirm = b.isRecurring
            ? `Delete all future bookings in this recurring series?`
            : `Delete this confirmed booking on ${fmtShort(b.booking_date)}?`;
          const actions = holdButtons ? `<div style="display:flex;gap:5px;flex-shrink:0;">
    <form method="POST" action="/gym-rentals/bookings/confirm-admin/${b.id}" style="display:contents;" onsubmit="return confirm('Confirm this hold and generate an invoice?')"><button type="submit" class="btn btn-sm btn-primary">Confirm</button></form>
    <form method="POST" action="/gym-rentals/bookings/release/${b.id}" style="display:contents;" onsubmit="return confirm('Release this hold?')"><button type="submit" class="btn btn-sm btn-danger">Release</button></form>
  </div>` : deleteButton ? `<form method="POST" action="${deleteAction}" style="display:contents;" onsubmit="return confirm('${deleteConfirm}')"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form>` : '';
          if (b.isRecurring) {
            const label = `${DOW_FULL[b.rec_dow]}s, ${fmtShort(b.rec_start)} – ${fmtShort(b.rec_end)}`;
            return `<div style="display:flex;align-items:center;gap:12px;padding:9px 18px;border-bottom:1px solid var(--border);">
  <div style="flex:1;font-family:var(--sans);font-size:13px;font-weight:600;color:var(--charcoal);">${label}</div>
  <div style="font-family:var(--sans);font-size:13px;color:var(--steel);">${timeRange}</div>
  <span class="badge" style="background:#e8f0fe;color:#1a3060;font-size:10px;">Recurring</span>
  ${actions}
</div>`;
          } else {
            const exp = holdButtons && b.hold_expires_at
              ? ` <span style="color:#7A4F00;font-size:11px;">exp ${new Date(b.hold_expires_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span>`
              : '';
            return `<div style="display:flex;align-items:center;gap:12px;padding:9px 18px;border-bottom:1px solid var(--border);">
  <div style="font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);min-width:110px;">${fmtBookingDate(b.booking_date)}</div>
  <div style="flex:1;font-family:var(--sans);font-size:13px;color:var(--charcoal);">${timeRange}${exp}</div>
  ${actions}
</div>`;
          }
        };

        // Render an org accordion
        const orgAccordion = (orgName, items, holdButtons, deleteButton = false) => `
<details open style="margin-bottom:8px;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
  <summary style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:11px 18px;background:var(--mist);font-family:var(--sans);font-size:14px;font-weight:700;color:var(--charcoal);list-style:none;-webkit-appearance:none;">
    <span>${orgName}</span>
    <span style="font-size:12px;font-weight:400;color:var(--gray);">${items.length} booking${items.length !== 1 ? 's' : ''}</span>
  </summary>
  ${items.map(b => bookingLine(b, holdButtons, deleteButton)).join('')}
</details>`;

        // Build holds HTML (grouped by org)
        const holdItems = buildItems(holdsRes.results);
        let holdsHtml = `<div style="text-align:center;padding:24px;color:var(--gray);font-size:14px;">No pending holds.</div>`;
        if (holdItems.length > 0) {
          const groups = {}, order = [];
          for (const b of holdItems) {
            const n = b.group_name || '— Unassigned —';
            if (!groups[n]) { groups[n] = []; order.push(n); }
            groups[n].push(b);
          }
          holdsHtml = order.map(n => orgAccordion(n, groups[n], true)).join('');
        }

        // Pending recurring requests (awaiting review)
        const pendingRecHtml = pendingRes.results.length === 0 ? '' : `
<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
  <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gray);margin-bottom:8px;">Recurring requests — awaiting review</div>
  ${pendingRes.results.map(r => `<div style="display:flex;align-items:center;gap:12px;padding:9px 14px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:var(--linen);">
  <div style="flex:1;font-family:var(--sans);font-size:13px;">
    <span style="font-weight:700;color:var(--charcoal);">${r.group_name || '—'}</span>
    <span style="color:var(--gray);margin:0 5px;">·</span>
    <span style="color:var(--charcoal);">${DOW_FULL[r.day_of_week]}s, ${fmtShort(r.start_date)} – ${fmtShort(r.end_date)}</span>
    <span style="color:var(--gray);margin:0 5px;">·</span>
    <span style="color:var(--steel);">${fmt12h(r.start_time)}–${fmt12h(r.end_time)}</span>
  </div>
  <a href="/gym-rentals/recurring/review/${r.id}" class="btn btn-sm btn-primary">Review</a>
</div>`).join('')}
</div>`;

        // Build confirmed HTML (grouped by org)
        const confirmedItems = buildItems(confirmedRes.results);
        let confirmedHtml = `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No upcoming confirmed bookings.</div>`;
        if (confirmedItems.length > 0) {
          const groups = {}, order = [];
          for (const b of confirmedItems) {
            const n = b.group_name || '— Unassigned —';
            if (!groups[n]) { groups[n] = []; order.push(n); }
            groups[n].push(b);
          }
          confirmedHtml = order.map(n => orgAccordion(n, groups[n], false, true)).join('');
        }

        const confirmAllBtn = holdsRes.results.length > 1
          ? `<form method="POST" action="/gym-rentals/bookings/confirm-all-holds" onsubmit="return confirm('Confirm all ${holdsRes.results.length} holds and generate invoices?')" style="display:inline;"><button type="submit" class="btn btn-sm btn-primary">Confirm All (${holdsRes.results.length})</button></form>`
          : '';

        return html(`
${topbarHtml('gym')}
<style>details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }</style>
<div class="wrap">
  <div class="page-title">Gym Rentals</div>
  <div class="page-sub">Manage rental groups, bookings, and schedules.</div>
  ${gymAlert}
  <div class="btn-row" style="margin-bottom:16px;">
    <a href="/gym-rentals/bookings/new" class="btn btn-primary">+ New Booking</a>
    <a href="/gym-rentals/groups" class="btn btn-secondary">Manage Groups</a>
    <a href="/gym-rentals/blocked" class="btn btn-sage">Blocked Dates</a>
    <a href="/gym-rentals/invoices" class="btn btn-secondary">Invoices</a>
    <a href="/gym-rentals/test-gcal" class="btn btn-secondary" style="margin-left:auto;">Test GCal →</a>
  </div>
  <div style="background:var(--mist);border:1px solid var(--border);border-radius:10px;padding:12px 18px;margin-bottom:24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
    <div style="font-size:14px;color:var(--charcoal);">Rental rate: <strong>$${rateRow?.value || '25.00'}/hr</strong></div>
    <a href="/settings" style="font-size:13px;color:var(--teal,#2E7EA6);text-decoration:none;border-bottom:1px solid currentColor;">Change rate →</a>
    <div style="margin-left:auto;font-size:12px;color:var(--gray);">Mon–Fri 5–9 PM &nbsp;·&nbsp; Sat 8 AM–8 PM &nbsp;·&nbsp; Sun 1–8 PM</div>
  </div>
  <div class="card">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span>Pending Holds</span>
      ${confirmAllBtn}
    </div>
    ${holdsHtml}
    ${pendingRecHtml}
  </div>
  <div class="card" style="margin-top:16px;">
    <div class="card-title">Confirmed Bookings</div>
    ${confirmedHtml}
  </div>
</div>`, 'Gym Rentals');
      }

      // ── GROUPS LIST ──────────────────────────────────────────
      if (path === '/gym-rentals/groups' && method === 'GET') {
        const groups = await env.DB.prepare('SELECT * FROM gym_groups ORDER BY name').all();
        const groupsHtml = groups.results.length === 0
          ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No groups yet. Add your first rental group.</div>`
          : groups.results.map(g => `
<div class="ni-row">
  <div style="flex:1;">
    <div style="font-family:var(--serif);font-size:16px;color:var(--steel);">${g.name}</div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-top:3px;">${[g.contact,g.email,g.phone].filter(Boolean).join(' · ')}</div>
  </div>
  <div class="ni-meta">Max ${g.max_active_holds||3} holds</div>
  <span class="badge ${g.active ? 'badge-active' : 'badge-expired'}">${g.active ? 'Active' : 'Inactive'}</span>
  <div class="ni-actions">
    <a href="/gym-rentals/groups/edit/${g.id}" class="btn btn-sm btn-secondary">Edit</a>
  </div>
</div>`).join('');
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">Rental Groups</div>
  <div class="page-sub">Each group gets a private booking link. Share it with them — no login required.</div>
  ${gymAlert}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/gym-rentals/groups/new" class="btn btn-primary">+ Add Group</a>
  </div>
  <div class="card">${groupsHtml}</div>
</div>`, 'Rental Groups');
      }

      // ── NEW GROUP FORM ───────────────────────────────────────
      if (path === '/gym-rentals/groups/new' && method === 'GET') {
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals/groups">← Groups</a>`)}
<div class="wrap">
  <div class="page-title">Add Rental Group</div>
  <div class="page-sub">After saving, you'll see their private booking link to share.</div>
  <div class="card">
    <form method="POST" action="/gym-rentals/groups/create">
      <div class="form-group">
        <label>Group name *</label>
        <input type="text" name="name" required placeholder="e.g. St. Francis Basketball League">
      </div>
      <div class="form-group">
        <label>Contact person</label>
        <input type="text" name="contact" placeholder="John Smith">
      </div>
      <div class="form-group">
        <label>Contact email *</label>
        <input type="email" name="email" required placeholder="contact@example.com">
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input type="text" name="phone" placeholder="314-555-0100">
      </div>
      <div class="form-group">
        <label>Max simultaneous holds <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— prevents a group from holding too many dates at once (default: 3)</span></label>
        <input type="number" name="max_active_holds" value="3" min="1" max="20">
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— internal only, not shown to group</span></label>
        <textarea name="notes" placeholder="Internal notes about this group…"></textarea>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Save &amp; Get Link →</button>
        <a href="/gym-rentals/groups" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'Add Group');
      }

      // ── CREATE GROUP ─────────────────────────────────────────
      if (path === '/gym-rentals/groups/create' && method === 'POST') {
        const form = await request.formData();
        const token = crypto.randomUUID().replace(/-/g, '');
        await env.DB.prepare(
          'INSERT INTO gym_groups (name, contact, email, phone, notes, access_token, max_active_holds) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          form.get('name')||'', form.get('contact')||'', form.get('email')||'',
          form.get('phone')||'', form.get('notes')||'', token,
          parseInt(form.get('max_active_holds')||'3', 10)
        ).run();
        const row = await env.DB.prepare('SELECT id FROM gym_groups WHERE access_token = ?').bind(token).first();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/groups/edit/${row.id}?msg=created` } });
      }

      // ── EDIT GROUP ───────────────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/edit/') && method === 'GET') {
        const gid = parseInt(path.split('/').pop(), 10);
        const g = await env.DB.prepare('SELECT * FROM gym_groups WHERE id = ?').bind(gid).first();
        if (!g) return new Response('Not found', { status: 404 });
        const portalLink = `${url.origin}/gym/book/${g.access_token}`;
        const em = url.searchParams.get('msg');
        const editAlert = em === 'created' ? `<div class="alert alert-success">✓ Group created! Share the booking link below with the group.</div>`
          : em === 'saved' ? `<div class="alert alert-success">✓ Changes saved.</div>`
          : em === 'regen' ? `<div class="alert alert-success">✓ New token generated. Old link no longer works — share the new one.</div>`
          : '';
        const esc = v => (v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals/groups">← Groups</a>`)}
<div class="wrap">
  <div class="page-title">${g.name}</div>
  <div class="page-sub">Edit group details and manage their booking link.</div>
  ${editAlert}
  <div class="card" style="background:var(--mist);border-color:var(--steel);">
    <div class="card-title">📋 Private Booking Link</div>
    <div style="font-family:var(--sans);font-size:13px;color:var(--charcoal);margin-bottom:12px;">Share this link with the group. The token in the URL is their key — no login needed.</div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <input type="text" id="portal-link" value="${portalLink}" readonly style="font-family:monospace;font-size:12px;background:white;flex:1;min-width:200px;">
      <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('portal-link').value).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)})" class="btn btn-secondary btn-sm">Copy</button>
    </div>
    <div style="margin-top:14px;">
      <form method="POST" action="/gym-rentals/groups/regen-token/${g.id}" onsubmit="return confirm('This invalidates their current link. They will need the new URL to book. Continue?')">
        <button type="submit" class="btn btn-sm btn-danger">Regenerate token (old link stops working)</button>
      </form>
    </div>
  </div>
  <div class="card">
    <form method="POST" action="/gym-rentals/groups/update/${g.id}">
      <div class="form-group">
        <label>Group name *</label>
        <input type="text" name="name" required value="${esc(g.name)}">
      </div>
      <div class="form-group">
        <label>Contact person</label>
        <input type="text" name="contact" value="${esc(g.contact)}">
      </div>
      <div class="form-group">
        <label>Contact email</label>
        <input type="email" name="email" value="${esc(g.email)}">
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input type="text" name="phone" value="${esc(g.phone)}">
      </div>
      <div class="form-group">
        <label>Max simultaneous holds</label>
        <input type="number" name="max_active_holds" value="${g.max_active_holds||3}" min="1" max="20">
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— internal only</span></label>
        <textarea name="notes">${(g.notes||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Save changes →</button>
      </div>
    </form>
    <hr style="border:none;border-top:1px solid var(--border);margin:24px 0;">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <form method="POST" action="/gym-rentals/groups/toggle/${g.id}" style="display:inline;">
        <button type="submit" class="btn ${g.active ? 'btn-danger' : 'btn-sage'}">${g.active ? 'Deactivate group (disables portal access)' : 'Reactivate group'}</button>
      </form>
      <form method="POST" action="/gym-rentals/groups/delete/${g.id}" style="display:inline;" onsubmit="return confirm('Permanently delete ${g.name.replace(/'/g,"\\'")} and all their bookings and invoices? This cannot be undone.')">
        <button type="submit" class="btn btn-danger">Delete group permanently</button>
      </form>
    </div>
  </div>
</div>`, `Edit — ${g.name}`);
      }

      // ── UPDATE GROUP ─────────────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/update/') && method === 'POST') {
        const gid = parseInt(path.split('/').pop(), 10);
        const form = await request.formData();
        await env.DB.prepare('UPDATE gym_groups SET name=?,contact=?,email=?,phone=?,notes=?,max_active_holds=? WHERE id=?')
          .bind(form.get('name')||'', form.get('contact')||'', form.get('email')||'', form.get('phone')||'', form.get('notes')||'', parseInt(form.get('max_active_holds')||'3',10), gid).run();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/groups/edit/${gid}?msg=saved` } });
      }

      // ── TOGGLE GROUP ACTIVE ───────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/toggle/') && method === 'POST') {
        const gid = parseInt(path.split('/').pop(), 10);
        const g = await env.DB.prepare('SELECT active FROM gym_groups WHERE id=?').bind(gid).first();
        if (g) await env.DB.prepare('UPDATE gym_groups SET active=? WHERE id=?').bind(g.active ? 0 : 1, gid).run();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/groups/edit/${gid}?msg=saved` } });
      }

      // ── REGENERATE TOKEN ──────────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/regen-token/') && method === 'POST') {
        const gid = parseInt(path.split('/').pop(), 10);
        const token = crypto.randomUUID().replace(/-/g, '');
        await env.DB.prepare('UPDATE gym_groups SET access_token=? WHERE id=?').bind(token, gid).run();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/groups/edit/${gid}?msg=regen` } });
      }

      // ── DELETE GROUP ──────────────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/delete/') && method === 'POST') {
        const gid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare('DELETE FROM gym_invoices WHERE group_id=?').bind(gid).run();
        await env.DB.prepare('DELETE FROM gym_bookings WHERE group_id=?').bind(gid).run();
        await env.DB.prepare('DELETE FROM gym_recurrences WHERE group_id=?').bind(gid).run();
        await env.DB.prepare('DELETE FROM gym_groups WHERE id=?').bind(gid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/groups?msg=deleted' } });
      }

      // ── GCAL TEST ────────────────────────────────────────────
      if (path === '/gym-rentals/test-gcal' && method === 'GET') {
        const steps = [];
        // Step 1: check secrets
        const rawEmail = env.GCAL_SERVICE_ACCOUNT_EMAIL || '';
        const hasEmail = !!rawEmail;
        const cleanEmail = rawEmail.trim();
        const emailOk = hasEmail && cleanEmail === rawEmail && cleanEmail.endsWith('.gserviceaccount.com');
        steps.push({ ok: emailOk, label: 'GCAL_SERVICE_ACCOUNT_EMAIL secret', detail: hasEmail ? `"${cleanEmail}" (${rawEmail.length} chars${rawEmail !== cleanEmail ? ' — WARNING: has leading/trailing whitespace' : ''})` : 'NOT SET' });
        const hasKey = !!env.GCAL_PRIVATE_KEY;
        const keyHasHeader = hasKey && (env.GCAL_PRIVATE_KEY.includes('BEGIN PRIVATE KEY') || env.GCAL_PRIVATE_KEY.includes('BEGIN RSA PRIVATE KEY'));
        steps.push({ ok: hasKey && keyHasHeader, label: 'GCAL_PRIVATE_KEY secret', detail: hasKey ? `(${env.GCAL_PRIVATE_KEY.length} chars${keyHasHeader ? ', header found ✓' : ' — WARNING: missing -----BEGIN PRIVATE KEY----- header'})` : 'NOT SET' });
        // Step 2: calendar ID in settings
        const calRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gcal_calendar_id'").first();
        const calId  = calRow?.value || '';
        steps.push({ ok: !!calId, label: 'Google Calendar ID (in Settings tab)', detail: calId || 'EMPTY — set this in Settings before continuing' });
        // Step 3: JWT build + sign
        let token = null, jwtError = '';
        if (hasEmail && hasKey) {
          try {
            const now  = Math.floor(Date.now() / 1000);
            const b64u = obj => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
            const hdr  = b64u({ alg:'RS256', typ:'JWT' });
            const pay  = b64u({ iss: env.GCAL_SERVICE_ACCOUNT_EMAIL, scope:'https://www.googleapis.com/auth/calendar.events', aud:'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
            const sigInput = `${hdr}.${pay}`;
            const pem  = env.GCAL_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
            const keyBuf = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
            const key  = await crypto.subtle.importKey('pkcs8', keyBuf.buffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
            const sig  = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput));
            const jwt  = `${sigInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
            steps.push({ ok: true, label: 'JWT built and signed (crypto.subtle)', detail: 'Key parsed and signed successfully' });
            // Step 4: exchange JWT for token
            const tokenRes  = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' },
              body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
            });
            const tokenBody = await tokenRes.json();
            token = tokenBody.access_token || null;
            steps.push({ ok: !!token, label: 'OAuth access token from Google', detail: token ? '(received)' : `FAILED (${tokenRes.status}): ${tokenBody.error || ''} — ${tokenBody.error_description || JSON.stringify(tokenBody)}` });
          } catch (e) {
            steps.push({ ok: false, label: 'JWT built and signed (crypto.subtle)', detail: `ERROR: ${e.message}` });
          }
        }
        // Step 4: create test event
        let eventCreated = false, eventError = '';
        if (token && calId) {
          const today = new Date().toISOString().split('T')[0];
          const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              summary: 'TLC Admin — GCal Test Event (safe to delete)',
              description: 'Created by the admin test page. You can delete this.',
              start: { dateTime: `${today}T10:00:00`, timeZone: 'America/Chicago' },
              end:   { dateTime: `${today}T11:00:00`, timeZone: 'America/Chicago' },
            }),
          });
          if (res.ok) {
            eventCreated = true;
          } else {
            const body = await res.json().catch(() => ({}));
            eventError = body?.error?.message || `HTTP ${res.status}`;
          }
          steps.push({ ok: eventCreated, label: 'Create test event on calendar', detail: eventCreated ? 'Event created — check your calendar' : `FAILED: ${eventError}` });
        }
        const stepsHtml = steps.map(s => `
<div style="display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid var(--border);">
  <span style="font-size:18px;flex-shrink:0;">${s.ok ? '✅' : '❌'}</span>
  <div>
    <div style="font-family:var(--sans);font-size:14px;font-weight:700;color:var(--charcoal);">${s.label}</div>
    <div style="font-family:var(--sans);font-size:13px;color:${s.ok ? 'var(--gray)' : '#B85C3A'};margin-top:2px;">${s.detail}</div>
  </div>
</div>`).join('');
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals">← Gym Rentals</a>`)}
<div class="wrap">
  <div class="page-title">Google Calendar — Connection Test</div>
  <div class="page-sub">Checks secrets, access token, and creates a test event on your calendar.</div>
  <div class="card">${stepsHtml}</div>
  ${eventCreated ? `<div class="alert alert-success">✓ Everything is working. A test event was added to your calendar — check it and delete it.</div>` : ''}
  <div style="margin-top:8px;"><a href="/gym-rentals/test-gcal" class="btn btn-secondary">Run test again</a></div>
</div>`, 'GCal Test');
      }

      // ── BLOCKED DATES CALENDAR ───────────────────────────────
      if (path === '/gym-rentals/blocked' && method === 'GET') {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const sixMonthsOut = new Date(today.getFullYear(), today.getMonth() + 6, 1).toISOString().split('T')[0];

        const [blocked, bookings] = await Promise.all([
          env.DB.prepare('SELECT date FROM gym_blocked_dates WHERE date >= ?').bind(todayStr).all(),
          env.DB.prepare("SELECT DISTINCT booking_date FROM gym_bookings WHERE status IN ('confirmed','hold') AND booking_date >= ?").bind(todayStr).all(),
        ]);
        const blockedSet = new Set(blocked.results.map(b => b.date));
        const bookingSet = new Set(bookings.results.map(b => b.booking_date));

        // Build 3-month admin block calendar
        const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        let calHtml = '<div class="cal-grid">';
        for (let i = 0; i < 3; i++) {
          const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
          const yr = d.getFullYear(), mo = d.getMonth();
          const lastDay = new Date(yr, mo + 1, 0);
          const startDow = d.getDay();
          calHtml += `<div class="cal-month"><div class="cal-month-name">${MONTHS[mo]} ${yr}</div>
<table class="cal-table"><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr><tr>`;
          for (let s = 0; s < startDow; s++) calHtml += '<td></td>';
          let dow = startDow;
          for (let day = 1; day <= lastDay.getDate(); day++) {
            const mm = (mo + 1).toString().padStart(2, '0');
            const dd = day.toString().padStart(2, '0');
            const ds = `${yr}-${mm}-${dd}`;
            const isPast = ds < todayStr;
            const isBlocked = blockedSet.has(ds);
            const hasBooking = bookingSet.has(ds);
            let cls = 'bcal-day';
            if (isPast) cls += ' bcal-past';
            else if (isBlocked) cls += ' bcal-blocked';
            else if (hasBooking) cls += ' bcal-has-booking';
            const dot = hasBooking && !isBlocked ? `<span class="bcal-dot"></span>` : '';
            const attrs = isPast ? '' : `data-date="${ds}" data-blocked="${isBlocked ? '1' : '0'}"`;
            calHtml += `<td><span class="${cls}" ${attrs}>${day}${dot}</span></td>`;
            dow++;
            if (dow === 7 && day < lastDay.getDate()) { calHtml += '</tr><tr>'; dow = 0; }
          }
          while (dow > 0 && dow < 7) { calHtml += '<td></td>'; dow++; }
          calHtml += '</tr></table></div>';
        }
        calHtml += '</div>';

        return html(`
${topbarHtml('gym', `<a href="/gym-rentals">← Dashboard</a>`)}
<style>
.bcal-day{display:block;width:34px;height:34px;line-height:34px;border-radius:50%;margin:0 auto;font-size:13px;font-weight:600;text-align:center;position:relative;cursor:pointer;color:var(--steel);}
.bcal-past{color:#CBD5E1;cursor:default;}
.bcal-blocked{background:#fce8e8;color:#7a1f1f;cursor:pointer;}
.bcal-blocked.bcal-pending-unblock{background:transparent;color:#CBD5E1;text-decoration:line-through;}
.bcal-has-booking{color:var(--steel);}
.bcal-selected{background:var(--amber);color:white;}
.bcal-dot{display:block;width:5px;height:5px;border-radius:50%;background:var(--amber);position:absolute;bottom:2px;left:50%;transform:translateX(-50%);}
.bcal-selected .bcal-dot{background:white;}
.bcal-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--gray);margin-top:12px;}
.bcal-legend span{display:flex;align-items:center;gap:6px;}
</style>
<div class="wrap">
  <div class="page-title">Blocked Dates</div>
  <div class="page-sub">Click dates to select them, then save. Already-blocked dates (red) can be clicked to unblock.</div>
  ${gymAlert}
  <div class="card">
    <div class="card-title">Select dates to block or unblock</div>
    ${calHtml}
    <div class="bcal-legend" style="margin-bottom:16px;">
      <span><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#fce8e8;border:1px solid #e8a0a0;"></span> Currently blocked</span>
      <span><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--amber);"></span> Selected to block</span>
      <span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--amber);vertical-align:middle;margin:0 4px;"></span> Has booking (still blockable)</span>
    </div>
    <form id="block-form" method="POST" action="/gym-rentals/blocked/batch">
      <div id="block-inputs"></div>
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:4px;">
        <div class="form-group" style="flex:1;min-width:200px;margin-bottom:0;">
          <label>Reason for new blocked dates (optional)</label>
          <input type="text" name="reason" placeholder="e.g. Church event, Holiday">
        </div>
        <button type="submit" class="btn btn-primary" style="flex-shrink:0;" id="save-btn">Save changes</button>
        <a href="/gym-rentals/blocked" class="btn btn-secondary" style="flex-shrink:0;text-decoration:none;">Reset</a>
      </div>
      <div id="selection-summary" style="font-size:13px;color:var(--gray);margin-top:10px;"></div>
    </form>
  </div>
</div>
<script>
const toBlock = new Set();
const toUnblock = new Set();

document.querySelectorAll('.bcal-day[data-date]').forEach(el => {
  el.addEventListener('click', function() {
    const date = this.dataset.date;
    const wasBlocked = this.dataset.blocked === '1';
    if (wasBlocked) {
      if (toUnblock.has(date)) {
        toUnblock.delete(date);
        this.classList.remove('bcal-pending-unblock');
      } else {
        toUnblock.add(date);
        this.classList.add('bcal-pending-unblock');
      }
    } else {
      if (toBlock.has(date)) {
        toBlock.delete(date);
        this.classList.remove('bcal-selected');
      } else {
        toBlock.add(date);
        this.classList.add('bcal-selected');
      }
    }
    updateSummary();
  });
});

function updateSummary() {
  const inp = document.getElementById('block-inputs');
  inp.innerHTML = '';
  toBlock.forEach(d => {
    const h = document.createElement('input');
    h.type = 'hidden'; h.name = 'to_block'; h.value = d;
    inp.appendChild(h);
  });
  toUnblock.forEach(d => {
    const h = document.createElement('input');
    h.type = 'hidden'; h.name = 'to_unblock'; h.value = d;
    inp.appendChild(h);
  });
  const parts = [];
  if (toBlock.size) parts.push(toBlock.size + ' date(s) to block');
  if (toUnblock.size) parts.push(toUnblock.size + ' date(s) to unblock');
  document.getElementById('selection-summary').textContent = parts.length ? parts.join(' · ') : 'No changes selected.';
  document.getElementById('save-btn').disabled = !parts.length;
}
updateSummary();
</script>
`, 'Blocked Dates');
      }

      if (path === '/gym-rentals/blocked/batch' && method === 'POST') {
        const form = await request.formData();
        const reason = form.get('reason') || '';
        const toBlock   = form.getAll('to_block');
        const toUnblock = form.getAll('to_unblock');
        for (const d of toBlock) {
          try { await env.DB.prepare('INSERT OR REPLACE INTO gym_blocked_dates (date, reason) VALUES (?, ?)').bind(d, reason).run(); } catch (_) {}
        }
        for (const d of toUnblock) {
          try { await env.DB.prepare('DELETE FROM gym_blocked_dates WHERE date = ?').bind(d).run(); } catch (_) {}
        }
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/blocked?msg=saved' } });
      }

      // Keep single-date add/delete for backward compatibility
      if (path === '/gym-rentals/blocked/add' && method === 'POST') {
        const form = await request.formData();
        const bdate = form.get('date');
        if (bdate) {
          try { await env.DB.prepare('INSERT OR REPLACE INTO gym_blocked_dates (date, reason) VALUES (?, ?)').bind(bdate, form.get('reason')||'').run(); } catch (_) {}
        }
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/blocked?msg=saved' } });
      }

      if (path.startsWith('/gym-rentals/blocked/delete/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare('DELETE FROM gym_blocked_dates WHERE id=?').bind(bid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/blocked?msg=deleted' } });
      }

      // ── RELEASE HOLD (admin action from dashboard) ────────────
      if (path.startsWith('/gym-rentals/bookings/release/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare("UPDATE gym_bookings SET status='released' WHERE id=? AND status='hold'").bind(bid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals?msg=saved' } });
      }

      // ── DELETE CONFIRMED BOOKING ──────────────────────────────
      if (path.startsWith('/gym-rentals/bookings/delete/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare("DELETE FROM gym_bookings WHERE id=? AND status='confirmed'").bind(bid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals?msg=deleted' } });
      }

      // ── DELETE RECURRING CONFIRMED BOOKINGS ───────────────────
      if (path.startsWith('/gym-rentals/bookings/delete-recurring/') && method === 'POST') {
        const rid = parseInt(path.split('/').pop(), 10);
        const today = new Date().toISOString().split('T')[0];
        await env.DB.prepare("DELETE FROM gym_bookings WHERE recurrence_id=? AND status='confirmed' AND booking_date >= ?").bind(rid, today).run();
        await env.DB.prepare("UPDATE gym_recurrences SET status='cancelled' WHERE id=?").bind(rid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals?msg=deleted' } });
      }

      // ── NEW BOOKING FORM ──────────────────────────────────────
      if (path === '/gym-rentals/bookings/new' && method === 'GET') {
        const groups = await env.DB.prepare('SELECT id, name FROM gym_groups WHERE active = 1 ORDER BY name').all();
        const today = new Date().toISOString().split('T')[0];
        const selGroup = url.searchParams.get('grp') || '';
        const selDate  = url.searchParams.get('dt')  || '';
        const selStart = url.searchParams.get('st')  || '';
        const selEnd   = url.searchParams.get('et')  || '';
        const selNotes = url.searchParams.get('notes') || '';
        const errParam = url.searchParams.get('err');
        const errAlert = errParam === 'conflict' ? `<div class="alert alert-error">That time slot overlaps with an existing booking or hold. Choose a different date or time.</div>`
          : errParam === 'blocked' ? `<div class="alert alert-error">That date is blocked (gym unavailable). Choose a different date.</div>`
          : errParam === 'invalid' ? `<div class="alert alert-error">End time must be after start time.</div>`
          : errParam === 'nogroup' ? `<div class="alert alert-error">No active groups found. Add a group first.</div>`
          : '';
        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_rate_per_hour'").first();
        const rate = rateRow ? parseFloat(rateRow.value || '0').toFixed(2) : '0.00';
        const groupOptions = groups.results.map(g =>
          `<option value="${g.id}"${selGroup == g.id ? ' selected' : ''}>${g.name}</option>`).join('');
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">New Booking</div>
  <div class="page-sub">Admin-created bookings are confirmed immediately and generate an invoice emailed to the group.</div>
  ${errAlert}
  <div class="card">
    <form method="POST" action="/gym-rentals/bookings/create">
      <div class="form-group">
        <label>Group *</label>
        <select name="group_id" required>
          <option value="">— select group —</option>
          ${groupOptions}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="form-group">
          <label>Date *</label>
          <input type="date" name="booking_date" required min="${today}" value="${selDate}">
        </div>
        <div class="form-group">
          <label>Start time *</label>
          <select name="start_time" required>
            <option value="">—</option>
            ${timeOptions(selStart)}
          </select>
        </div>
        <div class="form-group">
          <label>End time *</label>
          <select name="end_time" required>
            <option value="">—</option>
            ${timeOptions(selEnd)}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— included on the invoice</span></label>
        <textarea name="notes" placeholder="e.g. Basketball practice, weekly session">${selNotes.replace(/</g,'&lt;')}</textarea>
      </div>
      <div style="background:var(--mist);border-radius:8px;padding:14px 16px;margin-bottom:18px;font-family:var(--sans);font-size:13px;color:var(--charcoal);">
        Current rate: <strong>$${rate}/hr</strong> — Invoice will be generated and emailed to the group automatically.
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Create Booking &amp; Send Invoice →</button>
        <a href="/gym-rentals" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'New Booking');
      }

      // ── CREATE BOOKING ────────────────────────────────────────
      if (path === '/gym-rentals/bookings/create' && method === 'POST') {
        const form = await request.formData();
        const group_id     = parseInt(form.get('group_id') || '0', 10);
        const booking_date = form.get('booking_date') || '';
        const start_time   = form.get('start_time')   || '';
        const end_time     = form.get('end_time')     || '';
        const notes        = form.get('notes')        || '';
        const back = (err) => new Response('', { status: 302, headers: { Location: `/gym-rentals/bookings/new?err=${err}&grp=${group_id}&dt=${booking_date}&st=${encodeURIComponent(start_time)}&et=${encodeURIComponent(end_time)}` } });

        if (!group_id || !booking_date || !start_time || !end_time) return back('invalid');
        if (end_time <= start_time) return back('invalid');

        const blocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date = ?').bind(booking_date).first();
        if (blocked) return back('blocked');

        const conflict = await env.DB.prepare(
          `SELECT id FROM gym_bookings WHERE booking_date = ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`
        ).bind(booking_date, end_time, start_time).first();
        if (conflict) return back('conflict');

        // Create booking
        const bRes = await env.DB.prepare(
          `INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, created_by) VALUES (?, ?, ?, ?, ?, 'confirmed', 'admin')`
        ).bind(group_id, booking_date, start_time, end_time, notes).run();
        const bookingId = bRes.meta.last_row_id;

        // Fetch rate and calculate invoice
        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_rate_per_hour'").first();
        const rate  = parseFloat(rateRow?.value || '25');
        const hours = calcHours(start_time, end_time);
        const total = Math.round(hours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];

        const iRes = await env.DB.prepare(
          `INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(group_id, bookingId, invoiceDate, booking_date, booking_date, hours, rate, total).run();
        const invoiceId = iRes.meta.last_row_id;

        // Fetch records for email
        const inv     = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id = ?').bind(invoiceId).first();
        const group   = await env.DB.prepare('SELECT * FROM gym_groups WHERE id = ?').bind(group_id).first();
        const booking = { booking_date, start_time, end_time, notes };

        const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, booking);
        const subject   = `Gym Rental Invoice \u2014 ${group.name} \u2014 ${formatDate(booking_date)}`;
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
        const toEmails = [adminEmail];
        if (group.email) toEmails.push(group.email);
        try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
        await addGymBookingToGCal(env, { booking_date, start_time, end_time, group_name: group.name, notes });

        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${invoiceId}?msg=created` } });
      }

      // ── ALL BOOKINGS LIST ─────────────────────────────────────
      if (path === '/gym-rentals/bookings' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const [upcoming, past] = await Promise.all([
          env.DB.prepare(`SELECT b.*, g.name as group_name FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id WHERE b.booking_date >= ? AND b.status IN ('confirmed','hold') ORDER BY b.booking_date, b.start_time`).bind(today).all(),
          env.DB.prepare(`SELECT b.*, g.name as group_name FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id WHERE b.booking_date < ? ORDER BY b.booking_date DESC LIMIT 30`).bind(today).all(),
        ]);
        const statusBadge = s => s === 'confirmed' ? `<span class="badge badge-active">Confirmed</span>`
          : s === 'hold'      ? `<span class="badge" style="background:#FFF3D6;color:#7A4F00;">Hold</span>`
          : s === 'cancelled' ? `<span class="badge badge-expired">Cancelled</span>`
          : s === 'released'  ? `<span class="badge badge-expired">Released</span>`
          : s === 'expired'   ? `<span class="badge badge-expired">Expired</span>`
          : `<span class="badge">${s}</span>`;
        const bRow = (b, actions = true) => `
<div class="ni-row">
  <div style="font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);min-width:100px;">${fmtBookingDate(b.booking_date)}</div>
  <div style="font-family:var(--serif);font-size:15px;color:var(--charcoal);flex:1;">${b.group_name||'—'}</div>
  <div class="ni-meta">${fmt12h(b.start_time)} \u2013 ${fmt12h(b.end_time)}</div>
  ${statusBadge(b.status)}
  ${actions && (b.status === 'confirmed' || b.status === 'hold') ? `<div class="ni-actions" style="display:flex;gap:6px;flex-wrap:wrap;">
    ${b.status === 'hold' ? `<form method="POST" action="/gym-rentals/bookings/confirm-admin/${b.id}" style="display:contents;" onsubmit="return confirm('Confirm this hold and generate an invoice?')"><button type="submit" class="btn btn-sm btn-primary">Confirm</button></form>` : ''}
    <form method="POST" action="/gym-rentals/bookings/cancel/${b.id}" style="display:contents;" onsubmit="return confirm('Cancel this booking? The group will be notified.')">
      <button type="submit" class="btn btn-sm btn-danger">Cancel</button>
    </form>
  </div>` : ''}
</div>`;
        const groupByOrg = (rows, showActions) => {
          const groups = {};
          const order = [];
          for (const b of rows) {
            const name = b.group_name || '— Unassigned —';
            if (!groups[name]) { groups[name] = []; order.push(name); }
            groups[name].push(b);
          }
          return order.map(name => `
<details open style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
  <summary style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:11px 16px;background:var(--mist);font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);list-style:none;-webkit-appearance:none;">
    <span>${name}</span>
    <span style="font-size:12px;font-weight:400;color:var(--gray);">${groups[name].length} booking${groups[name].length !== 1 ? 's' : ''}</span>
  </summary>
  ${groups[name].map(b => bRow(b, showActions)).join('')}
</details>`).join('');
        };
        const upHtml = upcoming.results.length === 0
          ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No upcoming bookings.</div>`
          : groupByOrg(upcoming.results, true);
        const pastHtml = past.results.length === 0
          ? `<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">No past bookings on record.</div>`
          : groupByOrg(past.results, false);
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">All Bookings</div>
  <div class="page-sub">Upcoming and past gym rentals.</div>
  ${gymAlert}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/gym-rentals/bookings/new" class="btn btn-primary">+ New Booking</a>
  </div>
  <div class="card">
    <div class="card-title">Upcoming</div>
    ${upHtml}
  </div>
  <div class="card">
    <div class="card-title">Recent Past (last 30)</div>
    ${pastHtml}
  </div>
</div>`, 'All Bookings');
      }

      // ── ADMIN CONFIRM HOLD ────────────────────────────────────
      if (path.startsWith('/gym-rentals/bookings/confirm-admin/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        const booking = await env.DB.prepare('SELECT * FROM gym_bookings WHERE id=? AND status=\'hold\'').bind(bid).first();
        if (!booking) return new Response('', { status: 302, headers: { Location: '/gym-rentals/bookings?msg=saved' } });
        await env.DB.prepare("UPDATE gym_bookings SET status='confirmed', hold_expires_at=NULL WHERE id=?").bind(bid).run();
        // Generate invoice
        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first();
        const rate  = parseFloat(rateRow?.value || '25');
        const hours = calcHours(booking.start_time, booking.end_time);
        const total = Math.round(hours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];
        const iRes = await env.DB.prepare(
          `INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(booking.group_id, bid, invoiceDate, booking.booking_date, booking.booking_date, hours, rate, total).run();
        const invoiceId = iRes.meta.last_row_id;
        const inv   = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
        const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(booking.group_id).first();
        if (group) {
          const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, booking);
          const subject = `Gym Rental Confirmed — ${group.name} — ${formatDate(booking.booking_date)}`;
          const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
          const toEmails = [adminEmailRow?.value || 'office@timothystl.org'];
          if (group.contact_email) toEmails.push(group.contact_email);
          try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
          await addGymBookingToGCal(env, { ...booking, group_name: group.name });
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${invoiceId}?msg=created` } });
      }

      // ── CONFIRM ALL HOLDS ─────────────────────────────────────
      if (path === '/gym-rentals/bookings/confirm-all-holds' && method === 'POST') {
        const allHolds = await env.DB.prepare("SELECT * FROM gym_bookings WHERE status='hold'").all();
        const rateRow  = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first();
        const rate     = parseFloat(rateRow?.value || '25');
        const invoiceDate = new Date().toISOString().split('T')[0];
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
        let confirmed = 0;
        for (const booking of allHolds.results) {
          await env.DB.prepare("UPDATE gym_bookings SET status='confirmed', hold_expires_at=NULL WHERE id=?").bind(booking.id).run();
          const hours = calcHours(booking.start_time, booking.end_time);
          const total = Math.round(hours * rate * 100) / 100;
          const iRes = await env.DB.prepare(
            `INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
          ).bind(booking.group_id, booking.id, invoiceDate, booking.booking_date, booking.booking_date, hours, rate, total).run();
          const invoiceId = iRes.meta.last_row_id;
          const inv   = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
          const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(booking.group_id).first();
          if (group) {
            const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, booking);
            const subject = `Gym Rental Confirmed — ${group.name} — ${formatDate(booking.booking_date)}`;
            const toEmails = [adminEmail];
            if (group.contact_email) toEmails.push(group.contact_email);
            try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
            await addGymBookingToGCal(env, { ...booking, group_name: group.name });
          }
          confirmed++;
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals?msg=confirmed-all&n=${confirmed}` } });
      }

      // ── CANCEL BOOKING ────────────────────────────────────────
      if (path.startsWith('/gym-rentals/bookings/cancel/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        const booking = await env.DB.prepare('SELECT * FROM gym_bookings WHERE id=?').bind(bid).first();
        await env.DB.prepare("UPDATE gym_bookings SET status='cancelled' WHERE id=?").bind(bid).run();
        // Notify group
        if (booking) {
          const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(booking.group_id).first();
          if (group?.contact_email) {
            try {
              await sendTransactionalEmail(env, {
                subject: `Gym rental cancelled — ${formatDate(booking.booking_date)}`,
                htmlContent: `<p>Hi ${group.name},</p><p>Your gym rental booking has been cancelled by the church office:</p><ul><li><strong>Date:</strong> ${formatDate(booking.booking_date)}</li><li><strong>Time:</strong> ${fmt12h(booking.start_time)} – ${fmt12h(booking.end_time)}</li></ul><p>If you have questions, please contact <a href="mailto:office@timothystl.org">office@timothystl.org</a>.</p>`,
                toEmails: [group.contact_email],
              });
            } catch (_) {}
          }
        }
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/bookings?msg=saved' } });
      }

      // ── INVOICES LIST ─────────────────────────────────────────
      if (path === '/gym-rentals/invoices' && method === 'GET') {
        const invoices = await env.DB.prepare(
          `SELECT i.*, g.name as group_name FROM gym_invoices i LEFT JOIN gym_groups g ON g.id = i.group_id ORDER BY i.created_at DESC LIMIT 100`
        ).all();
        const invRowHtml = invoices.results.length === 0
          ? `<div style="text-align:center;padding:40px;color:var(--gray);font-size:14px;">No invoices yet. Invoices are generated automatically when a booking is created.</div>`
          : invoices.results.map(inv => {
              const invNum = `GYM-${inv.id.toString().padStart(4,'0')}`;
              return `
<div class="ni-row">
  <div style="font-family:var(--sans);font-size:12px;font-weight:700;color:var(--gray);min-width:72px;">${invNum}</div>
  <div style="flex:1;">
    <div style="font-family:var(--serif);font-size:15px;color:var(--steel);">${inv.group_name||'—'}</div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);">${formatDate(inv.invoice_date)}</div>
  </div>
  <div style="font-family:var(--sans);font-size:16px;font-weight:700;color:var(--charcoal);">$${parseFloat(inv.total_amount||0).toFixed(2)}</div>
  <span class="badge ${inv.status==='paid'?'badge-active':'badge-pinned'}">${inv.status==='paid'?'Paid':'Unpaid'}</span>
  <div class="ni-actions">
    <a href="/gym-rentals/invoices/view/${inv.id}" class="btn btn-sm btn-secondary">View</a>
    <form method="POST" action="/gym-rentals/invoices/toggle-paid/${inv.id}" style="display:contents;">
      <button type="submit" class="btn btn-sm ${inv.status==='paid'?'btn-danger':'btn-sage'}">${inv.status==='paid'?'Mark Unpaid':'Mark Paid'}</button>
    </form>
    <form method="POST" action="/gym-rentals/invoices/delete/${inv.id}" style="display:contents;" onsubmit="return confirm('Delete invoice ${invNum}? This cannot be undone.')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`; }).join('');
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">Invoices</div>
  <div class="page-sub">Invoice history and payment tracking.</div>
  ${gymAlert}
  <div class="card">${invRowHtml}</div>
</div>`, 'Invoices');
      }

      // ── INVOICE VIEW / PRINT ──────────────────────────────────
      if (path.startsWith('/gym-rentals/invoices/view/') && method === 'GET') {
        const iid = parseInt(path.split('/').pop(), 10);
        const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id = ?').bind(iid).first();
        if (!inv) return new Response('Not found', { status: 404 });
        const group   = await env.DB.prepare('SELECT * FROM gym_groups WHERE id = ?').bind(inv.group_id).first();
        const booking = inv.booking_id ? await env.DB.prepare('SELECT * FROM gym_bookings WHERE id = ?').bind(inv.booking_id).first() : null;
        const invNum  = `GYM-${iid.toString().padStart(4,'0')}`;
        const hours   = parseFloat(inv.total_hours  || 0);
        const rate    = parseFloat(inv.rate         || 0);
        const total   = parseFloat(inv.total_amount || 0);
        const vm = url.searchParams.get('msg');
        const viewAlert = vm === 'created' ? `<div class="alert alert-success">✓ Booking confirmed. Invoice emailed to ${group?.email ? group.email : 'you and the group'}.</div>`
          : vm === 'saved'   ? `<div class="alert alert-success">✓ Saved.</div>`
          : '';
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals/invoices">← Invoices</a>`)}
<div class="wrap">
  <div class="page-title">Invoice ${invNum}</div>
  <div class="page-sub">${group?.name||'—'}</div>
  ${viewAlert}
  <div class="btn-row" style="margin-bottom:24px;">
    <button type="button" onclick="window.print()" class="btn btn-secondary">Print / Save PDF</button>
    <form method="POST" action="/gym-rentals/invoices/email/${iid}" style="display:contents;">
      <button type="submit" class="btn btn-sage">Resend Email</button>
    </form>
    <form method="POST" action="/gym-rentals/invoices/toggle-paid/${iid}" style="display:contents;">
      <button type="submit" class="btn ${inv.status==='paid'?'btn-danger':'btn-primary'}">${inv.status==='paid'?'Mark Unpaid':'Mark as Paid'}</button>
    </form>
  </div>
  <div class="card" style="max-width:640px;margin:0 auto;" id="invoice-print">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:28px;">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;">Timothy Lutheran Church</div>
        <div style="font-family:var(--serif);font-size:22px;color:var(--steel);">Gym Rental Invoice</div>
        <div style="font-size:13px;color:var(--gray);margin-top:4px;">#${invNum}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;color:var(--gray);">Invoice date</div>
        <div style="font-size:15px;font-weight:700;color:var(--charcoal);">${formatDate(inv.invoice_date)}</div>
        <div style="margin-top:8px;font-size:12px;font-weight:700;padding:3px 12px;border-radius:999px;display:inline-block;${inv.status==='paid'?'background:#e8f5e9;color:#1a3d1f;':'background:#FFF3D6;color:#7A4F00;'}">${inv.status==='paid'?'PAID':'UNPAID'}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px;">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:8px;">Billed To</div>
        <div style="font-size:16px;font-weight:700;color:var(--steel);">${group?.name||'—'}</div>
        ${group?.contact ? `<div style="font-size:13px;color:var(--gray);margin-top:3px;">${group.contact}</div>` : ''}
        ${group?.email   ? `<div style="font-size:13px;color:var(--gray);">${group.email}</div>` : ''}
        ${group?.phone   ? `<div style="font-size:13px;color:var(--gray);">${group.phone}</div>` : ''}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:8px;">From</div>
        <div style="font-size:14px;font-weight:700;color:var(--steel);">Timothy Lutheran Church</div>
        <div style="font-size:13px;color:var(--gray);margin-top:3px;">4666 Fyler Ave, St. Louis, MO 63116</div>
        <div style="font-size:13px;color:var(--gray);">office@timothystl.org</div>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin-bottom:24px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:16px;">Rental Details</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Date</td><td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right;">${booking ? formatDate(booking.booking_date) : formatDate(inv.period_start)}</td></tr>
      <tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Time</td><td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right;">${booking ? `${fmt12h(booking.start_time)} \u2013 ${fmt12h(booking.end_time)}` : '\u2014'}</td></tr>
      <tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Duration</td><td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right;">${hours} hr${hours !== 1 ? 's' : ''}</td></tr>
      <tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Rate</td><td style="padding:10px 0;font-size:14px;text-align:right;">$${rate.toFixed(2)}/hr</td></tr>
      <tr><td style="padding:20px 0 0;font-size:18px;font-weight:700;color:var(--steel);">Amount Due</td><td style="padding:20px 0 0;font-size:24px;font-weight:700;color:var(--steel);text-align:right;">$${total.toFixed(2)}</td></tr>
    </table>
    <hr style="border:none;border-top:1px solid var(--border);margin:24px 0;">
    <div style="background:var(--linen);border-radius:8px;padding:16px 20px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:8px;">Payment</div>
      <div style="font-size:14px;color:var(--charcoal);line-height:1.75;">Please make check payable to <strong>Timothy Lutheran Church</strong> and bring to the office or mail to 4666 Fyler Ave, St. Louis, MO 63116.</div>
    </div>
  </div>
</div>
<style>@media print{.topbar,.tab-nav,.btn-row{display:none!important;}.wrap{padding:0!important;max-width:none!important;}#invoice-print{border:none!important;box-shadow:none!important;}}</style>`, `Invoice ${invNum}`);
      }

      // ── TOGGLE INVOICE PAID / UNPAID ──────────────────────────
      if (path.startsWith('/gym-rentals/invoices/toggle-paid/') && method === 'POST') {
        const iid = parseInt(path.split('/').pop(), 10);
        const inv = await env.DB.prepare('SELECT status FROM gym_invoices WHERE id=?').bind(iid).first();
        if (inv) await env.DB.prepare('UPDATE gym_invoices SET status=? WHERE id=?').bind(inv.status==='paid'?'unpaid':'paid', iid).run();
        const ref = request.headers.get('Referer') || '';
        return new Response('', { status: 302, headers: { Location: ref.includes('/view/') ? `/gym-rentals/invoices/view/${iid}?msg=saved` : `/gym-rentals/invoices?msg=saved` } });
      }

      // ── DELETE INVOICE ────────────────────────────────────────
      if (path.startsWith('/gym-rentals/invoices/delete/') && method === 'POST') {
        const iid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare('DELETE FROM gym_invoices WHERE id=?').bind(iid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/invoices?msg=deleted' } });
      }

      // ── RESEND INVOICE EMAIL ──────────────────────────────────
      if (path.startsWith('/gym-rentals/invoices/email/') && method === 'POST') {
        const iid = parseInt(path.split('/').pop(), 10);
        const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(iid).first();
        if (inv) {
          const group   = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(inv.group_id).first();
          const booking = inv.booking_id ? await env.DB.prepare('SELECT * FROM gym_bookings WHERE id=?').bind(inv.booking_id).first() : { booking_date: inv.period_start, start_time: '', end_time: '' };
          const emailHtml = buildGymInvoiceEmailHtml(inv, group, booking);
          const subject   = `Gym Rental Invoice \u2014 ${group?.name||'Group'} \u2014 ${formatDate(inv.invoice_date)}`;
          const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
          const toEmails = [];
          if (adminEmailRow?.value) toEmails.push(adminEmailRow.value);
          if (group?.email) toEmails.push(group.email);
          if (toEmails.length) try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${iid}?msg=saved` } });
      }

      // ── RECURRING LIST ────────────────────────────────────────
      if (path === '/gym-rentals/recurring' && method === 'GET') {
        const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const recs = await env.DB.prepare(
          `SELECT r.*, g.name as group_name FROM gym_recurrences r LEFT JOIN gym_groups g ON g.id = r.group_id ORDER BY r.created_at DESC`
        ).all();
        const statusBadge = s => s === 'approved' ? `<span class="badge badge-confirmed">Approved</span>`
          : s === 'rejected' ? `<span class="badge badge-expired">Rejected</span>`
          : `<span class="badge badge-upcoming">Pending</span>`;
        const recsHtml = recs.results.length === 0
          ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No recurring requests yet.</div>`
          : recs.results.map(r => `
<div class="ni-row">
  <div style="font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);min-width:80px;">${DOW_NAMES[r.day_of_week]}s</div>
  <div style="font-family:var(--serif);font-size:15px;color:var(--charcoal);flex:1;">${r.group_name||'—'}</div>
  <div class="ni-meta">${fmt12h(r.start_time)} – ${fmt12h(r.end_time)}</div>
  <div class="ni-meta">${formatDate(r.start_date)} – ${formatDate(r.end_date)}</div>
  ${statusBadge(r.status)}
  <div class="ni-actions">
    <a href="/gym-rentals/recurring/review/${r.id}" class="btn btn-sm btn-secondary">View</a>
  </div>
</div>`).join('');
        return html(`
${topbarHtml('gym', `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">Recurring Requests</div>
  <div class="page-sub">All recurring rental requests from groups.</div>
  ${gymAlert}
  <div class="card">
    ${recsHtml}
  </div>
</div>`, 'Recurring Requests');
      }

      // ── RECURRING REVIEW / APPROVE / REJECT ───────────────────
      if (path.startsWith('/gym-rentals/recurring/review/') && method === 'GET') {
        const rid = parseInt(path.split('/').pop(), 10);
        const rec = await env.DB.prepare(
          `SELECT r.*, g.name as group_name, g.contact_email FROM gym_recurrences r LEFT JOIN gym_groups g ON g.id = r.group_id WHERE r.id = ?`
        ).bind(rid).first();
        if (!rec) return new Response('Not found', { status: 404 });

        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first();
        const rate = parseFloat(rateRow?.value || '25');
        const hours = calcHours(rec.start_time, rec.end_time);

        // Generate all dates in range matching day_of_week
        const dates = [];
        const cur = new Date(rec.start_date + 'T12:00:00');
        const endD = new Date(rec.end_date + 'T12:00:00');
        while (cur <= endD) {
          if (cur.getDay() === rec.day_of_week) dates.push(cur.toISOString().split('T')[0]);
          cur.setDate(cur.getDate() + 1);
        }

        // Check conflicts and blocked for each date
        const [blockedRows, conflictRows] = await Promise.all([
          env.DB.prepare('SELECT date FROM gym_blocked_dates').all(),
          env.DB.prepare(`SELECT booking_date FROM gym_bookings WHERE booking_date >= ? AND booking_date <= ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`).bind(rec.start_date, rec.end_date, rec.end_time, rec.start_time).all(),
        ]);
        const blockedSet  = new Set(blockedRows.results.map(b => b.date));
        const conflictSet = new Set(conflictRows.results.map(b => b.booking_date));

        let okCount = 0;
        const dateRowsHtml = dates.map(d => {
          const isBlocked  = blockedSet.has(d);
          const isConflict = conflictSet.has(d);
          const skip = isBlocked || isConflict;
          if (!skip) okCount++;
          const badge = isBlocked  ? `<span class="badge badge-expired">Blocked</span>`
            : isConflict ? `<span class="badge" style="background:#FFF3D6;color:#7A4F00;">Conflict</span>`
            : `<span class="badge badge-confirmed">OK</span>`;
          return `<div class="ni-row" style="${skip ? 'opacity:.5;' : ''}">
  <div style="font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);min-width:160px;">${fmtBookingDate(d)}</div>
  <div style="font-size:13px;color:var(--gray);">${fmt12h(rec.start_time)} – ${fmt12h(rec.end_time)}</div>
  ${badge}
</div>`;
        }).join('');

        const isPending = rec.status === 'pending_review';
        const _rmsg = url.searchParams.get('msg');
        const msgAlert = _rmsg === 'approved' ? `<div class="alert alert-success">✓ Approved — ${okCount} bookings created.</div>`
          : _rmsg === 'rejected'  ? `<div class="alert alert-error">Request rejected.</div>`
          : _rmsg === 'noinvoice' ? `<div class="alert alert-info">All sessions in that month are already invoiced.</div>`
          : '';

        return html(`
${topbarHtml('gym', `<a href="/gym-rentals/recurring">← Recurring</a>`)}
<div class="wrap">
  <div class="page-title">Recurring Request</div>
  ${msgAlert}
  <div class="card">
    <div class="card-title">Request Details</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;font-size:14px;">
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Group</div><div style="font-weight:600;">${rec.group_name||'—'}</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Day</div><div style="font-weight:600;">${DOW_NAMES[rec.day_of_week]}s</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Time</div><div style="font-weight:600;">${fmt12h(rec.start_time)} – ${fmt12h(rec.end_time)}</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Date Range</div><div style="font-weight:600;">${formatDate(rec.start_date)} – ${formatDate(rec.end_date)}</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Rate</div><div style="font-weight:600;">$${(hours * rate).toFixed(2)}/session (${hours}h × $${rate}/hr)</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Status</div><div style="font-weight:600;">${rec.status}</div></div>
      ${rec.notes ? `<div style="grid-column:1/-1;"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Notes</div><div>${rec.notes}</div></div>` : ''}
    </div>
    ${isPending ? `
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border);">
      <div style="font-size:14px;color:var(--charcoal);margin-bottom:16px;"><strong>${okCount}</strong> of ${dates.length} dates will be booked (${dates.length - okCount} skipped due to conflicts or blocked dates).</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <form method="POST" action="/gym-rentals/recurring/approve/${rec.id}">
          <button type="submit" class="btn btn-primary" onclick="return confirm('Approve and create ${okCount} bookings?')">Approve (${okCount} bookings)</button>
        </form>
        <form method="POST" action="/gym-rentals/recurring/reject/${rec.id}" onsubmit="return confirm('Reject this request?')">
          <button type="submit" class="btn btn-danger">Reject</button>
        </form>
      </div>
    </div>` : ''}
  </div>
  <div class="card">
    <div class="card-title">Dates (${dates.length} total)</div>
    ${dateRowsHtml || `<div style="padding:20px;text-align:center;color:var(--gray);">No dates in range.</div>`}
  </div>
  ${rec.status === 'approved' ? (() => {
    // Build month selector for invoicing
    const monthSet = new Set(dates.map(d => d.slice(0,7)));
    const months = [...monthSet].sort();
    const monthOpts = months.map(m => {
      const [y, mo] = m.split('-');
      const label = new Date(`${m}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'});
      return `<option value="${m}">${label}</option>`;
    }).join('');
    return `<div class="card">
    <div class="card-title">Generate Monthly Invoice</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">Creates one invoice covering all sessions in the selected month. Only sessions not already invoiced will be included.</div>
    <form method="POST" action="/gym-rentals/recurring/invoice/${rec.id}" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
      <div class="form-group" style="flex:0 0 200px;margin-bottom:0;">
        <label>Month</label>
        <select name="month" required>${monthOpts}</select>
      </div>
      <button type="submit" class="btn btn-primary" style="flex-shrink:0;">Generate Invoice →</button>
    </form>
  </div>`;
  })() : ''}
</div>`, 'Review Recurring Request');
      }

      if (path.startsWith('/gym-rentals/recurring/approve/') && method === 'POST') {
        const rid = parseInt(path.split('/').pop(), 10);
        const rec = await env.DB.prepare('SELECT * FROM gym_recurrences WHERE id = ?').bind(rid).first();
        if (!rec || rec.status !== 'pending_review') return new Response('', { status: 302, headers: { Location: '/gym-rentals/recurring' } });

        const dates = [];
        const cur = new Date(rec.start_date + 'T12:00:00');
        const endD = new Date(rec.end_date + 'T12:00:00');
        while (cur <= endD) {
          if (cur.getDay() === rec.day_of_week) dates.push(cur.toISOString().split('T')[0]);
          cur.setDate(cur.getDate() + 1);
        }

        const [blockedRows, conflictRows] = await Promise.all([
          env.DB.prepare('SELECT date FROM gym_blocked_dates').all(),
          env.DB.prepare(`SELECT booking_date FROM gym_bookings WHERE booking_date >= ? AND booking_date <= ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`).bind(rec.start_date, rec.end_date, rec.end_time, rec.start_time).all(),
        ]);
        const blockedSet  = new Set(blockedRows.results.map(b => b.date));
        const conflictSet = new Set(conflictRows.results.map(b => b.booking_date));

        const recGroup = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(rec.group_id).first();
        let created = 0;
        for (const d of dates) {
          if (blockedSet.has(d) || conflictSet.has(d)) continue;
          try {
            await env.DB.prepare(
              `INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, created_by, recurrence_id) VALUES (?, ?, ?, ?, ?, 'confirmed', 'admin', ?)`
            ).bind(rec.group_id, d, rec.start_time, rec.end_time, rec.notes||'', rec.id).run();
            await addGymBookingToGCal(env, { booking_date: d, start_time: rec.start_time, end_time: rec.end_time, group_name: recGroup?.name || '', notes: rec.notes||'' });
            created++;
          } catch (_) {}
        }
        await env.DB.prepare("UPDATE gym_recurrences SET status='approved' WHERE id=?").bind(rid).run();

        // Notify group
        const group = recGroup;
        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        if (group?.contact_email) {
          try {
            await sendTransactionalEmail(env, {
              subject: `Recurring rental approved — ${DOW_NAMES[rec.day_of_week]}s ${fmt12h(rec.start_time)}–${fmt12h(rec.end_time)}`,
              htmlContent: `<p>Hi ${group.name},</p>
<p>Your recurring gym rental request has been approved. We've created <strong>${created} bookings</strong>:</p>
<ul>
  <li><strong>Day:</strong> ${DOW_NAMES[rec.day_of_week]}s</li>
  <li><strong>Time:</strong> ${fmt12h(rec.start_time)} – ${fmt12h(rec.end_time)}</li>
  <li><strong>Date range:</strong> ${formatDate(rec.start_date)} – ${formatDate(rec.end_date)}</li>
</ul>
<p>You can view your bookings at your portal link. Invoices will be sent monthly. Questions? Reply to this email or contact <a href="mailto:office@timothystl.org">office@timothystl.org</a>.</p>`,
              toEmails: [group.contact_email],
            });
          } catch (_) {}
        }

        return new Response('', { status: 302, headers: { Location: `/gym-rentals/recurring/review/${rid}?msg=approved` } });
      }

      if (path.startsWith('/gym-rentals/recurring/reject/') && method === 'POST') {
        const rid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare("UPDATE gym_recurrences SET status='rejected' WHERE id=?").bind(rid).run();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/recurring/review/${rid}?msg=rejected` } });
      }

      // ── RECURRING MONTHLY INVOICE ─────────────────────────────
      if (path.startsWith('/gym-rentals/recurring/invoice/') && method === 'POST') {
        const rid   = parseInt(path.split('/').pop(), 10);
        const form  = await request.formData();
        const month = form.get('month') || ''; // "YYYY-MM"
        if (!month) return new Response('', { status: 302, headers: { Location: `/gym-rentals/recurring/review/${rid}` } });

        const rec = await env.DB.prepare('SELECT * FROM gym_recurrences WHERE id=? AND status=\'approved\'').bind(rid).first();
        if (!rec) return new Response('', { status: 302, headers: { Location: '/gym-rentals/recurring' } });

        // Find all confirmed bookings for this recurrence in the selected month, not yet invoiced
        const periodStart = `${month}-01`;
        const periodEnd   = `${month}-31`;
        const alreadyInvoiced = await env.DB.prepare(
          'SELECT booking_id FROM gym_invoices WHERE recurrence_id=? AND period_start >= ? AND period_start <= ?'
        ).bind(rid, periodStart, periodEnd).all();
        const invoicedIds = new Set(alreadyInvoiced.results.map(r => r.booking_id));

        const sessions = await env.DB.prepare(
          `SELECT * FROM gym_bookings WHERE recurrence_id=? AND status='confirmed' AND booking_date >= ? AND booking_date <= ? ORDER BY booking_date`
        ).bind(rid, periodStart, periodEnd).all();

        const newSessions = sessions.results.filter(b => !invoicedIds.has(b.id));
        if (newSessions.length === 0)
          return new Response('', { status: 302, headers: { Location: `/gym-rentals/recurring/review/${rid}?msg=noinvoice` } });

        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first();
        const rate = parseFloat(rateRow?.value || '25');
        const hours = calcHours(rec.start_time, rec.end_time);
        const totalHours  = hours * newSessions.length;
        const totalAmount = Math.round(totalHours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];

        const iRes = await env.DB.prepare(
          `INSERT INTO gym_invoices (group_id, recurrence_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(rec.group_id, rid, invoiceDate, newSessions[0].booking_date, newSessions[newSessions.length-1].booking_date, totalHours, rate, totalAmount,
          `${newSessions.length} sessions — ${new Date(`${month}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}`
        ).run();
        const invoiceId = iRes.meta.last_row_id;

        // Mark each session's booking_id on the invoice (link first session; others via recurrence_id)
        const inv   = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
        const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(rec.group_id).first();
        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        if (group) {
          const sessionList = newSessions.map(b => `<li>${formatDate(b.booking_date)} — ${fmt12h(b.start_time)}–${fmt12h(b.end_time)}</li>`).join('');
          const emailHtml = `<h2 style="font-family:Georgia,serif;color:#1E2D4A;">Gym Rental Invoice — ${new Date(`${month}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2>
<p>Hi ${group.name},</p>
<p>Your monthly gym rental invoice is attached for ${new Date(`${month}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}.</p>
<ul>${sessionList}</ul>
<p><strong>Total: $${totalAmount.toFixed(2)}</strong> (${totalHours}h × $${rate}/hr)</p>
<p>Please remit payment to Timothy Lutheran Church. Questions? <a href="mailto:office@timothystl.org">office@timothystl.org</a></p>`;
          const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
          const toEmails = [adminEmailRow?.value || 'office@timothystl.org'];
          if (group.contact_email) toEmails.push(group.contact_email);
          try {
            await sendTransactionalEmail(env, {
              subject: `Gym Rental Invoice — ${group.name} — ${new Date(`${month}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}`,
              htmlContent: emailHtml,
              toEmails,
            });
          } catch (_) {}
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${invoiceId}?msg=created` } });
      }

      // Fallback: redirect to dashboard
      return new Response('', { status: 302, headers: { Location: '/gym-rentals' } });
    } // end /gym-rentals

    if (path.startsWith('/settings')) {
      // Show settings form
      if (path === '/settings' && method === 'GET') {
        const settings = await env.DB.prepare('SELECT key, value, label, hint FROM site_settings ORDER BY rowid').all();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Settings saved.</div>` : '';
        const fields = settings.results.map(s => `
          <div class="form-group" style="border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:20px;">
            <label>${(s.label||s.key).replace(/&/g,'&amp;')}</label>
            ${s.hint ? `<div style="font-size:12px;color:var(--gray);margin-bottom:8px;">${s.hint.replace(/&/g,'&amp;')}</div>` : ''}
            <input type="text" name="${s.key.replace(/"/g,'&quot;')}" value="${(s.value||'').replace(/"/g,'&quot;').replace(/&/g,'&amp;')}" style="font-family:var(--mono,monospace);font-size:13px;">
          </div>`).join('');
        return html(`
${topbarHtml('settings')}
<div class="wrap">
  <div class="page-title">Site Settings</div>
  <div class="page-sub">Update redirect URLs and other site-wide settings. Changes take effect immediately.</div>
  ${alertHtml}
  <div class="card">
    <form method="POST" action="/settings/update">
      ${fields}
      <div class="btn-row">
        <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save settings →</button>
      </div>
    </form>
  </div>
</div>`, 'Site Settings');
      }

      // Save settings
      if (path === '/settings/update' && method === 'POST') {
        const form = await request.formData();
        const settings = await env.DB.prepare('SELECT key FROM site_settings').all();
        for (const s of settings.results) {
          const val = form.get(s.key);
          if (val !== null) {
            await env.DB.prepare('UPDATE site_settings SET value = ? WHERE key = ?').bind(val, s.key).run();
          }
        }
        return new Response('', { status: 302, headers: { Location: '/settings?msg=saved' } });
      }
    } // end settings tab

    // Redirect old newsletter root to combined page
    if (path === '/') {
      return new Response('', { status: 302, headers: { Location: '/newsitems' } });
    }

    // ── DASHBOARD ──
    const newsletters = await env.DB.prepare(
      "SELECT id, subject, published_at, format, status, created_at FROM newsletters ORDER BY CASE WHEN status = 'draft' THEN 0 ELSE 1 END, published_at DESC"
    ).all();

    const msgParam = url.searchParams.get('msg');
    const subjectParam = decodeURIComponent(url.searchParams.get('subject') || '');
    let alertHtml = '';
    const emailedParam = url.searchParams.get('emailed');
    const emailErrParam = url.searchParams.get('emailerr');
    if (msgParam === 'published') {
      const siteNewsUrl = 'https://timothystl.org/news';
      const fbShareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(siteNewsUrl)}`;
      const tweetText = subjectParam
        ? `📖 ${subjectParam} — read our latest update at ${siteNewsUrl}`
        : `Our latest update from Timothy Lutheran Church: ${siteNewsUrl}`;
      const twitterShareUrl = `https://x.com/intent/post?text=${encodeURIComponent(tweetText)}`;
      const bskyText = subjectParam
        ? `📖 ${subjectParam}\n\nOur weekly update from Timothy Lutheran Church:\n${siteNewsUrl}`
        : `Our latest update from Timothy Lutheran Church:\n${siteNewsUrl}`;
      const bskyShareUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(bskyText)}`;
      const igCaption = subjectParam
        ? `📖 ${subjectParam}\n\nOur weekly update is live — read it at timothystl.org/news\n\n@timothystl\n#TimothyLutheran #LindenwoordPark #StLouis #church`
        : `Our latest newsletter is live at timothystl.org/news\n\n@timothystl\n#TimothyLutheran #LindenwoordPark #StLouis #church`;
      const igCaptionJs = igCaption.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
      alertHtml = `
<div class="alert alert-success" style="margin-bottom:0;border-radius:10px 10px 0 0;">
  ✓ Newsletter published to website archive.${emailedParam === 'test' ? ' Email sent to test list.' : emailedParam === 'all' ? ' Email sent to all subscribers.' : ''}${emailErrParam ? ` ⚠️ Email error: ${emailErrParam}` : ''}
</div>
<div style="background:#f0f7f0;border:1px solid #b8d4b8;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;margin-bottom:20px;">
  <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#2a4d2a;margin-bottom:14px;">📣 Share to social media</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
    <a href="${fbShareUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13px;font-weight:700;background:#1877F2;color:white;padding:9px 18px;border-radius:6px;text-decoration:none;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/></svg>
      Share on Facebook
    </a>
    <a href="${twitterShareUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13px;font-weight:700;background:#000;color:white;padding:9px 18px;border-radius:6px;text-decoration:none;">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      Post on X
    </a>
    <a href="${bskyShareUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13px;font-weight:700;background:#0085ff;color:white;padding:9px 18px;border-radius:6px;text-decoration:none;">
      <svg width="16" height="14" viewBox="0 0 360 320" fill="white"><path d="M180 142c-16.3-31.1-60.7-89.4-102-120C38 0 0 5 0 72c0 29 15.6 121.3 26.2 144C85.4 342 153.9 310.4 180 310.4c26 0 94.6 31.6 153.8-94.4C344.4 193.3 360 101 360 72c0-67-38-72-78-50C240.7 52.6 196.3 110.9 180 142z"/></svg>
      Post on Bluesky
    </a>
    <a href="https://www.instagram.com" target="_blank" style="display:inline-flex;align-items:center;gap:7px;font-family:var(--sans);font-size:13px;font-weight:700;background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);color:white;padding:9px 18px;border-radius:6px;text-decoration:none;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
      Open Instagram
    </a>
  </div>
  <div style="font-family:var(--sans);font-size:12px;font-weight:600;color:var(--gray);margin-bottom:6px;">Caption for Instagram — copy and paste:</div>
  <div id="ig-cap" style="font-family:var(--sans);font-size:13px;background:white;border:1px solid #ccd4cc;border-radius:6px;padding:12px 14px;line-height:1.8;white-space:pre-wrap;color:var(--charcoal);">${igCaption.replace(/</g,'&lt;')}</div>
  <button onclick="navigator.clipboard.writeText(\`${igCaptionJs}\`).then(()=>{this.textContent='✓ Copied!';this.style.background='#e8f5e9';setTimeout(()=>{this.textContent='Copy caption';this.style.background='';},2000)})" style="margin-top:8px;font-family:var(--sans);font-size:12px;font-weight:700;background:white;border:1px solid #aab8aa;border-radius:6px;padding:6px 16px;cursor:pointer;transition:background .2s;">Copy caption</button>
</div>`;
    } else if (msgParam === 'draft') {
      alertHtml = `<div class="alert alert-info">Draft saved. Use "Send test" or "Send to all" below to email it when ready.</div>`;
    } else if (msgParam === 'emailed') {
      const sentTo = emailedParam === 'test' ? 'test list' : 'all subscribers';
      alertHtml = emailErrParam
        ? `<div class="alert alert-error">Email failed: ${emailErrParam}</div>`
        : `<div class="alert alert-success">✓ "${subjectParam}" sent to ${sentTo}.</div>`;
    }

    const rows = newsletters.results;
    const drafts = rows.filter(r => r.status === 'draft');
    const published = rows.filter(r => r.status !== 'draft');

    const fmtLabel = (r) => r.format === 'quick'
      ? `<span class="badge" style="background:#e8f0fe;color:#1a3060;margin-left:8px;">⚡ Quick</span>`
      : '';

    const draftRowHtml = drafts.length === 0 ? '' : `
<div class="card" style="border-color:var(--amber);">
  <div class="card-title">Drafts <span class="badge badge-draft" style="vertical-align:middle;margin-left:8px;">${drafts.length} draft${drafts.length !== 1 ? 's' : ''}</span></div>
  ${drafts.map(r => `
<div class="newsletter-row">
  <div class="newsletter-date">${r.published_at || r.created_at || ''}</div>
  <div class="newsletter-subject">${r.subject}${fmtLabel(r)}</div>
  <div class="newsletter-actions">
    <a href="/edit/${r.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Send to test list?')">
      <input type="hidden" name="list_type" value="test">
      <button type="submit" class="btn btn-sm" style="background:var(--mist);color:var(--steel);border:1px solid var(--border);">Send test</button>
    </form>
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Send to ALL subscribers? This cannot be undone.')">
      <input type="hidden" name="list_type" value="all">
      <button type="submit" class="btn btn-sm btn-primary">Send to all</button>
    </form>
    <form method="POST" action="/delete/${r.id}" style="display:contents;" onsubmit="return confirm('Delete this draft?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('')}
</div>`;

    const publishedRowHtml = published.length === 0
      ? `<div style="text-align:center;padding:40px;color:var(--gray);font-family:var(--sans);font-size:14px;">No newsletters published yet.</div>`
      : published.map(r => `
<div class="newsletter-row">
  <div class="newsletter-date">${r.published_at || ''}</div>
  <div class="newsletter-subject">${r.subject}${fmtLabel(r)}</div>
  <div class="newsletter-actions">
    <a href="/edit/${r.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/delete/${r.id}" style="display:contents;" onsubmit="return confirm('Delete this newsletter?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('');

    return html(`
${topbarHtml('newsletter', `<a href="https://timothystl.org/news" target="_blank">View archive →</a>`)}
<div class="wrap">
  <div class="page-title">Newsletters</div>
  <div class="page-sub">Write your weekly update and publish to the website.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/new" class="btn btn-primary">+ Write newsletter</a>
  </div>
  ${draftRowHtml}
  <div class="card">
    <div class="card-title">Past newsletters</div>
    ${publishedRowHtml}
  </div>
  <div style="margin-top:24px;padding:16px 20px;background:var(--mist);border-radius:10px;border-left:3px solid var(--steel);">
    <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);margin-bottom:8px;">Your workflow</div>
    <div style="font-family:var(--sans);font-size:13px;color:var(--charcoal);line-height:1.9;">
      <strong>1.</strong> Click "Write newsletter" — pick Weekly or Quick Announcement<br>
      <strong>2.</strong> Fill in your content, add events if needed<br>
      <strong>3.</strong> Hit Publish — it goes live on timothystl.org/news immediately
    </div>
  </div>
</div>`, 'TLC Newsletter Admin');
  }
};

