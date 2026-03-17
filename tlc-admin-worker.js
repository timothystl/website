// Timothy Lutheran Church — Newsletter Admin Worker
// Deploy to: admin.timothystl.org
// Cloudflare Worker + D1 Database

const ADMIN_PASSWORD = '6704fyler';
const BEEHIIV_API_KEY = 'jBgc1cHvSXJlyoskPkyf8Ujz7r6VzCO4CaA1t4BaaRsiR9nLR4WmjHQpMK9Ri0N8';
const BEEHIIV_PUB_ID = '7c76e5d5-1225-4d04-ae5c-023c2d2d7a40';

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

// ── HELPERS ─────────────────────────────────────────────────
function authCookie(req) {
  const cookie = req.headers.get('cookie') || '';
  return cookie.includes('tlc_auth=authenticated');
}

function setCookieHeader() {
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  return `tlc_auth=authenticated; Path=/; Expires=${exp}; HttpOnly; SameSite=Strict`;
}

function html(body, title = 'TLC Admin') {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;600;700;800&family=Lora:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
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
</style>
</head>
<body>${body}</body>
</html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
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

// ── BUILD BEEHIIV HTML ───────────────────────────────────────
function buildEmailHtml(subject, pastorNote, events, ministryContent, ministryType, publishedAt) {
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
        <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:15px;color:#3D3530;line-height:1.8;margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #E8E0D0;">${pastorNote.replace(/\n/g,'<br>')}</div>` : ''}
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
    try { await env.DB.exec(DB_INIT_NEWSLETTERS); } catch (e) {}
    try { await env.DB.exec(DB_INIT_EVENTS); } catch (e) {}

    // ── PUBLIC: newsletter archive API ──
    if (path === '/api/newsletters' && method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT id, subject, pastor_note, ministry_content, ministry_type, published_at, created_at FROM newsletters ORDER BY published_at DESC'
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

    // ── NEW NEWSLETTER FORM ──
    if (path === '/new' && method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      return html(`
<div class="topbar">
  <div>
    <div class="topbar-brand">Timothy Lutheran · Newsletter Admin</div>
  </div>
  <div class="topbar-links">
    <a href="/">← All newsletters</a>
    <a href="/logout">Sign out</a>
  </div>
</div>
<div class="wrap">
  <div class="page-title">New newsletter</div>
  <div class="page-sub">Write your update, add events, and publish to the website and Beehiiv.</div>

  <form method="POST" action="/publish" enctype="multipart/form-data">

    <div class="card">
      <div class="card-title">Header</div>
      <div class="form-group">
        <label>Subject line <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="subject" required placeholder="e.g. This week at Timothy — March 23">
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="date" name="published_at" value="${today}">
      </div>
    </div>

    <div class="card">
      <div class="card-title">Pastor's note</div>
      <div class="form-group">
        <label>Your message this week</label>
        <textarea name="pastor_note" style="min-height:140px;" placeholder="A few sentences from you — what's on your heart, what God is doing, what you want the congregation to know. Write like you'd say it from the pulpit on Sunday morning."></textarea>
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

    <div class="card" style="background:var(--mist);border-color:var(--ice);">
      <div class="card-title" style="color:var(--sage);">What happens when you publish</div>
      <div style="font-family:var(--sans);font-size:13px;color:var(--charcoal);line-height:1.8;">
        <strong>1.</strong> The newsletter is saved to your website archive at timothystl.org/news<br>
        <strong>2.</strong> A draft is created in Beehiiv, ready for you to review and send<br>
        <strong>3.</strong> Go to beehiiv.com, find the draft, review it, and hit Send
      </div>
    </div>

    <div class="btn-row" style="margin-top:8px;">
      <button type="submit" name="action" value="publish" class="btn btn-primary">Publish newsletter →</button>
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
// Add one event by default
addEvent();
</script>`, 'New Newsletter');
    }

    // ── PUBLISH ──
    if (path === '/publish' && method === 'POST') {
      const form = await request.formData();
      const subject = form.get('subject') || '';
      const pastorNote = form.get('pastor_note') || '';
      const publishedAt = form.get('published_at') || new Date().toISOString().split('T')[0];
      const action = form.get('action') || 'publish';
      const ministryType = form.get('ministry_type') || 'none';
      let ministryContent = '';
      if (ministryType === 'text') {
        ministryContent = form.get('ministry_content') || '';
      } else if (ministryType === 'image') {
        ministryContent = form.get('ministry_image_url') || '';
      }

      // Collect events
      const eventIds = form.getAll('event_ids');
      const events = [];
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

      // Save newsletter
      const result = await env.DB.prepare(
        'INSERT INTO newsletters (subject, pastor_note, ministry_content, ministry_type, published_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(subject, pastorNote, ministryContent, ministryType === 'none' ? 'text' : ministryType, publishedAt).run();

      const newsletterId = result.meta.last_row_id;

      // Save events
      for (const e of events) {
        await env.DB.prepare(
          'INSERT INTO events (newsletter_id, event_date, event_name, event_time, event_desc, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(newsletterId, e.event_date, e.event_name, e.event_time, e.event_desc, e.sort_order).run();
      }

      let beehiivStatus = '';
      let beehiivUrl = '';

      // Push to Beehiiv if publishing
      if (action === 'publish') {
        try {
          const emailHtml = buildEmailHtml(subject, pastorNote, events, ministryContent, ministryType, publishedAt);
          const beehiivRes = await fetch(`https://api.beehiiv.com/v2/publications/${BEEHIIV_PUB_ID}/posts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${BEEHIIV_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              subject: subject,
              content: { free: { email: emailHtml, web: `<h1>${subject}</h1><p>${pastorNote || ''}</p>` } },
              status: 'draft',
              send_at: null
            })
          });
          const beehiivData = await beehiivRes.json();
          if (beehiivData.data && beehiivData.data.id) {
            await env.DB.prepare('UPDATE newsletters SET beehiiv_id = ? WHERE id = ?').bind(beehiivData.data.id, newsletterId).run();
            beehiivStatus = 'success';
            beehiivUrl = `https://app.beehiiv.com/posts/${beehiivData.data.id}`;
          } else {
            beehiivStatus = 'failed';
          }
        } catch (e) {
          beehiivStatus = 'failed';
        }
      }

      const successMsg = action === 'publish'
        ? beehiivStatus === 'success'
          ? `<div class="alert alert-success">✓ Published to website archive. <strong><a href="${beehiivUrl}" target="_blank" style="color:#1a3d1f;">Open Beehiiv draft →</a></strong> Review and send when ready.</div>`
          : `<div class="alert alert-success">✓ Saved to website archive. <span style="color:#7a1f1f;">Note: Beehiiv draft creation failed — log in to beehiiv.com and create the email manually.</span></div>`
        : `<div class="alert alert-info">Draft saved. Not yet published to the website or Beehiiv.</div>`;

      return new Response('', {
        status: 302,
        headers: { Location: `/?msg=${encodeURIComponent(action === 'publish' ? 'published' : 'draft')}&beehiiv=${beehiivStatus}&url=${encodeURIComponent(beehiivUrl)}` }
      });
    }

    // ── DELETE ──
    if (path.startsWith('/delete/') && method === 'POST') {
      const id = path.split('/').pop();
      await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/' } });
    }

    // ── DASHBOARD ──
    const newsletters = await env.DB.prepare(
      'SELECT id, subject, published_at, beehiiv_id, created_at FROM newsletters ORDER BY published_at DESC'
    ).all();

    const msgParam = url.searchParams.get('msg');
    const beehiivParam = url.searchParams.get('beehiiv');
    const beehiivUrlParam = url.searchParams.get('url') || '';
    let alertHtml = '';
    if (msgParam === 'published') {
      alertHtml = beehiivParam === 'success'
        ? `<div class="alert alert-success">✓ Newsletter published to website archive. <strong><a href="${decodeURIComponent(beehiivUrlParam)}" target="_blank" style="color:#1a3d1f;">Open Beehiiv draft →</a></strong> Review and hit Send when ready.</div>`
        : `<div class="alert alert-success">✓ Newsletter saved to website archive. Log in to <a href="https://app.beehiiv.com" target="_blank">Beehiiv</a> to send the email manually.</div>`;
    } else if (msgParam === 'draft') {
      alertHtml = `<div class="alert alert-info">Draft saved. Publish when ready.</div>`;
    }

    const rows = newsletters.results;
    const listHtml = rows.length === 0
      ? `<div style="text-align:center;padding:40px;color:var(--gray);font-family:var(--sans);font-size:14px;">No newsletters yet. Write your first one.</div>`
      : rows.map(r => `
<div class="newsletter-row">
  <div class="newsletter-date">${r.published_at}</div>
  <div class="newsletter-subject">${r.subject}</div>
  <div style="display:flex;gap:6px;align-items:center;">
    ${r.beehiiv_id ? `<span class="tag" style="background:#e8f5e9;color:#1a3d1f;">Beehiiv ✓</span>` : ''}
  </div>
  <div class="newsletter-actions">
    <form method="POST" action="/delete/${r.id}" onsubmit="return confirm('Delete this newsletter?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('');

    return html(`
<div class="topbar">
  <div>
    <div class="topbar-brand">Timothy Lutheran · Newsletter Admin</div>
  </div>
  <div class="topbar-links">
    <a href="https://timothystl.org/news" target="_blank">View archive →</a>
    <a href="https://app.beehiiv.com" target="_blank">Beehiiv →</a>
    <a href="/logout">Sign out</a>
  </div>
</div>
<div class="wrap">
  <div class="page-title">Newsletters</div>
  <div class="page-sub">Write your weekly update, publish to the website, and send via Beehiiv.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/new" class="btn btn-primary">+ Write this week's newsletter</a>
  </div>
  <div class="card">
    <div class="card-title">Past newsletters</div>
    ${listHtml}
  </div>
  <div style="margin-top:24px;padding:16px 20px;background:var(--mist);border-radius:10px;border-left:3px solid var(--steel);">
    <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);margin-bottom:8px;">Your workflow</div>
    <div style="font-family:var(--sans);font-size:13px;color:var(--charcoal);line-height:1.9;">
      <strong>1.</strong> Click "Write this week's newsletter" above<br>
      <strong>2.</strong> Type your pastor's note, add events, paste ministry content<br>
      <strong>3.</strong> Hit Publish — it saves to your website and creates a Beehiiv draft<br>
      <strong>4.</strong> Click "Open Beehiiv draft", review, and hit Send
    </div>
  </div>
</div>`, 'TLC Newsletter Admin');
  }
};

