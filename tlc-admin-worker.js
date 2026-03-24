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
  { key: 'give_url',          value: 'https://timothystl.breezechms.com/give/online',                                                          label: 'Online giving URL',     hint: 'Used for the Give button and /give page. Update when the giving platform changes.' },
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
    <a href="/" class="tab${activeTab === 'newsletter' ? ' tab-active' : ''}">Newsletter</a>
    <a href="/newsitems" class="tab${activeTab === 'news' ? ' tab-active' : ''}">News &amp; Events</a>
    <a href="/ministries" class="tab${activeTab === 'ministries' ? ' tab-active' : ''}">Ministries</a>
    <a href="/sermons" class="tab${activeTab === 'sermons' ? ' tab-active' : ''}">Sermons</a>
    <a href="/pages" class="tab${activeTab === 'pages' ? ' tab-active' : ''}">Pages</a>
    <a href="/staff" class="tab${activeTab === 'staff' ? ' tab-active' : ''}">Staff</a>
    <a href="/settings" class="tab${activeTab === 'settings' ? ' tab-active' : ''}">Settings</a>
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
      { key: 'seasonal-worship',  label: 'Seasonal worship block',  hint: 'Rich content section on the Worship page for midweek, Lenten, Advent, or other seasonal services. Toggle on/off without losing content.' },
      { key: 'staff-intro',       label: 'Staff section intro',      hint: 'Optional intro paragraph shown above the staff grid on the About page. Leave blank to hide.' },
    ];
    for (const b of PAGE_BLOCKS) {
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO page_content (key, label, value, published, updated_at) VALUES (?, ?, ?, ?, ?)').bind(b.key, b.label, '', 0, '').run();
      } catch (_) {}
    }

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
${topbarHtml('newsletter', `<a href="/">← All newsletters</a>`)}
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
        headers: { Location: `/?msg=${encodeURIComponent(action === 'publish' ? 'published' : 'draft')}&subject=${encodeURIComponent(subject)}${emailSuffix}` }
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
${topbarHtml('newsletter', `<a href="/">← All newsletters</a>`)}
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
        headers: { Location: `/?msg=emailed&subject=${encodeURIComponent(row.subject)}${suffix}` }
      });
    }

    // ── DELETE ──
    if (path.startsWith('/delete/') && method === 'POST') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/' } });
    }

    // ── NEWS ITEMS: LIST ──
    if (path === '/newsitems' && method === 'GET') {
      await sweepExpiredItems(env, new URL(request.url).origin);
      const items = await env.DB.prepare(
        'SELECT * FROM news_items ORDER BY pinned DESC, COALESCE(event_date, publish_date) ASC'
      ).all();
      const today = new Date().toISOString().split('T')[0];
      const msgParam = url.searchParams.get('msg');
      let alertHtml = '';
      if (msgParam === 'saved') alertHtml = `<div class="alert alert-success">✓ News item saved.</div>`;
      if (msgParam === 'deleted') alertHtml = `<div class="alert alert-info">Item deleted.</div>`;

      const listHtml = items.results.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--gray);font-size:14px;">No news items yet. Add your first announcement.</div>`
        : items.results.map(item => {
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

      return html(`
${topbarHtml('news', `<a href="https://timothystl.org/news" target="_blank">View site →</a>`)}
<div class="wrap">
  <div class="page-title">News &amp; Events</div>
  <div class="page-sub">Manage announcements shown on the website homepage and news page.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/newsitems/new" class="btn btn-primary">+ Add news item</a>
  </div>
  <div class="card">
    <div class="card-title">All items</div>
    ${listHtml}
  </div>
  <div style="margin-top:20px;padding:16px 20px;background:var(--mist);border-radius:10px;border-left:3px solid var(--steel);">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);margin-bottom:6px;">How it works</div>
    <div style="font-size:13px;color:var(--charcoal);line-height:1.9;">
      Items appear on the homepage and /news page automatically.<br>
      <strong>Pinned</strong> items always show first. Items auto-hide after their expire date.
    </div>
  </div>
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
          'home-notice':      'Appears on the home page as a highlighted notice box. Leave blank to hide.',
          'worship-notice':   'Appears on the Worship page (e.g. special service times, holiday changes). Leave blank to hide.',
          'about-notice':     'Appears on the About page. Leave blank to hide.',
          'seasonal-worship': 'Rich content section on the Worship page — use for Lenten midweek, Advent series, special seasonal services, etc. Toggle published on/off without losing your content.',
          'staff-intro':      'Optional intro paragraph shown above the staff grid on the About page. Leave blank to hide.',
        };
        const hint = HINT_MAP[key] || 'Appears on the site when content is set. Leave blank to hide.';
        const isSeasonal = key === 'seasonal-worship';
        const publishedChecked = (block.published === 1 || block.published === null) ? 'checked' : '';
        const publishToggleHtml = isSeasonal ? `
        <div class="card" style="margin-bottom:24px;background:var(--mist);border:1px solid var(--ice);">
          <div class="card-title">Visibility</div>
          <label style="display:flex;align-items:center;gap:12px;font-family:var(--sans);font-size:14px;cursor:pointer;">
            <input type="checkbox" name="published" value="1" ${publishedChecked} style="width:18px;height:18px;cursor:pointer;">
            Show this block on the Worship page
          </label>
          <div style="font-size:12px;color:var(--gray);margin-top:8px;">Uncheck to hide the block without losing your content — useful when the seasonal series ends.</div>
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
        // Only save published flag for blocks that have the toggle (seasonal-worship)
        if (key === 'seasonal-worship') {
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

