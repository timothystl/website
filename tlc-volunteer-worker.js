// Timothy Lutheran Church — Volunteer Sign-Up Worker
// Deploy to: volunteer.timothystl.org
// Admin at: volunteer.timothystl.org/admin

const ADMIN_PASSWORD = '6704fyler';

// ── DATABASE SCHEMA ──────────────────────────────────────────
const DB_INIT = [
  `CREATE TABLE IF NOT EXISTS serve_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '',
    hidden INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS serve_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    slots INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    role_id INTEGER,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`
];

// ── AUTH ─────────────────────────────────────────────────────
function isAuthed(req) {
  return (req.headers.get('cookie') || '').includes('vol_auth=ok');
}

function authCookieHeader() {
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  return `vol_auth=ok; Path=/; Expires=${exp}; HttpOnly; SameSite=Strict`;
}

// ── UTILITIES ─────────────────────────────────────────────────
function redirect(url) {
  return new Response('', { status: 302, headers: { Location: url } });
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  } catch { return d; }
}

// ── CSS ───────────────────────────────────────────────────────
const CSS = `
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
.page-title{font-family:var(--serif);font-size:32px;color:var(--steel);margin-bottom:8px;}
.page-sub{font-family:var(--sans);font-size:15px;color:var(--gray);margin-bottom:32px;line-height:1.7;}
.card{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:28px;margin-bottom:16px;}
.card-title{font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border);}
.form-group{margin-bottom:18px;}
label{display:block;font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:6px;}
input[type=text],input[type=password],input[type=date],input[type=email],input[type=tel],textarea,select{width:100%;background:var(--white);border:1px solid var(--border);border-radius:6px;padding:10px 14px;font-family:var(--sans);font-size:14px;color:var(--charcoal);outline:none;transition:border-color .2s,box-shadow .2s;}
input:focus,textarea:focus,select:focus{border-color:var(--amber);box-shadow:0 0 0 3px rgba(212,146,42,.12);}
textarea{min-height:80px;resize:vertical;line-height:1.65;}
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
.alert{padding:14px 18px;border-radius:8px;font-family:var(--sans);font-size:14px;margin-bottom:20px;}
.alert-success{background:#e8f5e9;border-left:3px solid var(--sage);color:#1a3d1f;}
.alert-error{background:#fce8e8;border-left:3px solid #B85C3A;color:#7a1f1f;}
.alert-info{background:var(--mist);border-left:3px solid var(--steel);color:var(--steel);}
.tag{font-family:var(--sans);font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--mist);color:var(--steel);}
.tag-hidden{background:#fce8e8;color:#B85C3A;}
.tag-visible{background:#e8f5e9;color:#1a3d1f;}
/* Public event cards */
.event-card{background:var(--white);border:1px solid var(--border);border-radius:14px;margin-bottom:16px;overflow:hidden;transition:box-shadow .2s;}
.event-card:hover{box-shadow:0 4px 20px rgba(10,60,92,.08);}
.event-card-header{padding:24px 28px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
.event-name{font-family:var(--serif);font-size:20px;color:var(--steel);margin-bottom:4px;}
.event-date-label{font-family:var(--sans);font-size:12px;font-weight:700;color:var(--amber);letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px;}
.event-desc{font-family:var(--sans);font-size:14px;color:var(--gray);margin-top:6px;line-height:1.6;}
.event-expand-btn{flex-shrink:0;background:var(--steel);color:white;border:none;border-radius:6px;padding:10px 20px;font-family:var(--sans);font-size:13px;font-weight:700;cursor:pointer;transition:background .2s;margin-top:4px;}
.event-expand-btn:hover{background:#2A5470;}
.event-detail{display:none;border-top:2px solid var(--border);padding:28px 28px 32px;}
.event-detail.open{display:block;}
/* Back button — prominent */
.back-btn{display:inline-flex;align-items:center;gap:10px;background:var(--white);color:var(--steel);border:2px solid var(--steel);font-family:var(--sans);font-size:15px;font-weight:700;padding:12px 26px;border-radius:8px;cursor:pointer;text-decoration:none;transition:background .2s,color .2s;}
.back-btn:hover{background:var(--steel);color:white;}
.back-btn-wrap{margin-bottom:24px;}
.back-btn-bottom{margin-top:28px;padding-top:24px;border-top:1px solid var(--border);}
.section-label{font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-bottom:12px;margin-top:24px;padding-bottom:6px;border-bottom:1px solid var(--border);}
.role-option{background:var(--linen);border:2px solid transparent;border-radius:10px;padding:16px 18px;margin-bottom:10px;cursor:pointer;transition:border-color .15s,background .15s;}
.role-option:has(input:checked){border-color:var(--steel);background:var(--mist);}
.role-option label{display:flex;align-items:flex-start;gap:12px;cursor:pointer;letter-spacing:0;text-transform:none;font-size:14px;font-weight:400;color:var(--charcoal);}
.role-option input[type=radio]{width:18px;height:18px;margin-top:2px;flex-shrink:0;accent-color:var(--steel);}
.role-name-text{font-weight:700;font-size:15px;color:var(--steel);display:block;margin-bottom:3px;}
.role-desc-text{font-size:13px;color:var(--gray);display:block;line-height:1.5;}
/* Admin table */
table.data-table{width:100%;border-collapse:collapse;font-size:13px;}
table.data-table th{font-family:var(--sans);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gray);padding:10px 14px;border-bottom:2px solid var(--border);text-align:left;}
table.data-table td{padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:middle;}
table.data-table tr:last-child td{border-bottom:none;}
/* Login */
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--steel);}
.login-card{background:white;border-radius:20px;padding:40px;width:100%;max-width:360px;text-align:center;}
.login-title{font-family:var(--serif);font-size:24px;color:var(--steel);margin-bottom:4px;}
.login-sub{font-family:var(--sans);font-size:13px;color:var(--gray);margin-bottom:28px;}
.login-card .form-group{text-align:left;}
/* Print */
@media print {
  .topbar,.btn,.btn-row,.no-print{display:none!important;}
  body{background:white;}
  .wrap{padding:0;max-width:100%;}
  table.data-table{font-size:11px;}
  table.data-table th,table.data-table td{padding:6px 8px;}
  .card{border:none;padding:0;margin:0;}
  h2{margin-bottom:8px;}
}
`;

function htmlPage(body, title = 'Serve at Timothy Lutheran') {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;600;700;800&family=Lora:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet"><style>${CSS}</style></head><body>${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// ── ADMIN LAYOUT ──────────────────────────────────────────────
function adminWrap(content) {
  return `
<div class="topbar">
  <div>
    <div class="topbar-brand">Timothy Lutheran · Volunteer Admin</div>
  </div>
  <div class="topbar-links no-print">
    <a href="/" target="_blank">View sign-up page ↗</a>
    <a href="/admin/logout">Sign out</a>
  </div>
</div>
<div class="wrap">${content}</div>`;
}

// ── FORM PARTIALS ─────────────────────────────────────────────
function eventForm(ev = null) {
  return `
<div class="card">
  <div class="card-title">Event details</div>
  <div class="form-group">
    <label>Event name <span style="color:#B85C3A;">*</span></label>
    <input type="text" name="name" required placeholder="e.g. Easter Sunday Setup" value="${esc(ev?.name || '')}">
  </div>
  <div class="form-group">
    <label>Description</label>
    <textarea name="description" placeholder="Describe this opportunity — what volunteers will do, what to expect, time commitment, etc.">${esc(ev?.description || '')}</textarea>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
    <div class="form-group">
      <label>Event date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">(optional)</span></label>
      <input type="date" name="event_date" value="${esc(ev?.event_date || '')}">
    </div>
    <div class="form-group">
      <label>Sort order <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">(lower = first)</span></label>
      <input type="text" name="sort_order" placeholder="0" value="${esc(String(ev?.sort_order ?? 0))}">
    </div>
  </div>
  <div class="form-group" style="margin-bottom:0;">
    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;letter-spacing:0;text-transform:none;font-size:14px;font-weight:600;color:var(--charcoal);">
      <input type="checkbox" name="hidden" value="1" style="width:auto;" ${ev?.hidden ? 'checked' : ''}>
      Hide this event from the public sign-up page
    </label>
  </div>
</div>`;
}

function roleForm(role = null) {
  return `
<div class="card">
  <div class="card-title">Role details</div>
  <div class="form-group">
    <label>Role name <span style="color:#B85C3A;">*</span></label>
    <input type="text" name="name" required placeholder="e.g. Setup crew, Greeter, Parking attendant" value="${esc(role?.name || '')}">
  </div>
  <div class="form-group">
    <label>Description</label>
    <textarea name="description" placeholder="What does this role involve? Any special requirements or when to arrive?">${esc(role?.description || '')}</textarea>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
    <div class="form-group" style="margin-bottom:0;">
      <label>Slots available <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">(0 = unlimited)</span></label>
      <input type="text" name="slots" placeholder="0" value="${esc(String(role?.slots ?? 0))}">
    </div>
    <div class="form-group" style="margin-bottom:0;">
      <label>Sort order</label>
      <input type="text" name="sort_order" placeholder="0" value="${esc(String(role?.sort_order ?? 0))}">
    </div>
  </div>
</div>`;
}

// ── LOGIN PAGE ────────────────────────────────────────────────
function loginPage(error = '') {
  return htmlPage(`
<div class="login-wrap">
  <div class="login-card">
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:8px;">Timothy Lutheran Church</div>
    <div class="login-title">Volunteer Admin</div>
    <div class="login-sub">Sign in to manage volunteer events</div>
    ${error ? `<div class="alert alert-error" style="text-align:left;">${esc(error)}</div>` : ''}
    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label>Password</label>
        <input type="password" name="password" autofocus placeholder="Enter admin password">
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px;">Sign in</button>
    </form>
  </div>
</div>`, 'Volunteer Admin — Sign In');
}

// ── MAIN EXPORT ───────────────────────────────────────────────
export default {
  async fetch(request, env) {
    try {
      for (const sql of DB_INIT) {
        try { await env.DB.prepare(sql).run(); } catch {}
      }
      return await this._route(request, env);
    } catch (e) {
      return new Response(`Error: ${e.message}\n${e.stack}`, {
        status: 500, headers: { 'Content-Type': 'text/plain' }
      });
    }
  },

  async _route(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const method = request.method;

    // ── PUBLIC: event listing ──────────────────────────────────
    if (path === '/' && method === 'GET') {
      const events = await env.DB.prepare(
        'SELECT * FROM serve_events WHERE hidden=0 ORDER BY sort_order, event_date, id'
      ).all();

      const successParam = url.searchParams.get('success');

      let eventsHtml = '';
      for (const ev of events.results) {
        const roles = await env.DB.prepare(
          'SELECT * FROM serve_roles WHERE event_id=? ORDER BY sort_order, id'
        ).bind(ev.id).all();

        const rolesHtml = roles.results.length
          ? roles.results.map(r => `
<div class="role-option">
  <label>
    <input type="radio" name="role_id" value="${r.id}">
    <div>
      <span class="role-name-text">${esc(r.name)}</span>
      ${r.description ? `<span class="role-desc-text">${esc(r.description)}</span>` : ''}
    </div>
  </label>
</div>`).join('')
          : `<p style="font-size:14px;color:var(--gray);padding:4px 0 12px;">No specific roles listed — just let us know you'd like to help!</p>`;

        const dateLabel = ev.event_date
          ? `<div class="event-date-label">${esc(formatDate(ev.event_date))}</div>`
          : '';

        eventsHtml += `
<div class="event-card" id="card-${ev.id}">
  <div class="event-card-header">
    <div style="flex:1;">
      ${dateLabel}
      <div class="event-name">${esc(ev.name)}</div>
      ${ev.description ? `<div class="event-desc">${esc(ev.description)}</div>` : ''}
    </div>
    <button class="event-expand-btn" type="button" onclick="openEvent(${ev.id})">Sign up →</button>
  </div>
  <div class="event-detail" id="detail-${ev.id}">
    <!-- Back button — top -->
    <div class="back-btn-wrap">
      <button type="button" class="back-btn" onclick="closeEvent(${ev.id})">
        ← Back to all ways to serve
      </button>
    </div>

    <div style="font-family:var(--serif);font-size:18px;color:var(--steel);margin-bottom:20px;">
      Signing up for: <strong>${esc(ev.name)}</strong>
    </div>

    <form method="POST" action="/signup">
      <input type="hidden" name="event_id" value="${ev.id}">

      <div class="section-label">Your contact info</div>
      <div class="form-group">
        <label>Your name <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="name" required placeholder="First and last name">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" placeholder="your@email.com">
        </div>
        <div class="form-group">
          <label>Phone</label>
          <input type="tel" name="phone" placeholder="(314) 555-0000">
        </div>
      </div>

      <div class="section-label" style="margin-top:20px;">How would you like to help?</div>
      ${rolesHtml}

      <div class="form-group" style="margin-top:16px;">
        <label>Anything else? <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">(optional)</span></label>
        <textarea name="notes" placeholder="Questions, availability, anything you'd like us to know…"></textarea>
      </div>

      <div class="btn-row" style="margin-top:20px;">
        <button type="submit" class="btn btn-primary">Submit sign-up →</button>
      </div>
    </form>

    <!-- Back button — bottom -->
    <div class="back-btn-bottom">
      <button type="button" class="back-btn" onclick="closeEvent(${ev.id})">
        ← Back to all ways to serve
      </button>
    </div>
  </div>
</div>`;
      }

      if (!eventsHtml) {
        eventsHtml = `<div style="text-align:center;padding:60px 20px;color:var(--gray);font-size:15px;">No opportunities posted yet — check back soon!</div>`;
      }

      return htmlPage(`
<div class="topbar">
  <div>
    <div class="topbar-brand">Timothy Lutheran Church</div>
    <div class="topbar-sub">Ways to Serve</div>
  </div>
</div>
<div class="wrap">
  ${successParam === '1' ? `<div class="alert alert-success">✓ Thank you! We received your sign-up and will be in touch soon.</div>` : ''}
  <div class="page-title">Ways to Serve</div>
  <div class="page-sub">Find an opportunity to get involved. Expand any event below to sign up — it only takes a minute.</div>
  ${eventsHtml}
</div>
<script>
function openEvent(id) {
  // Close any open event first
  document.querySelectorAll('.event-detail.open').forEach(d => d.classList.remove('open'));
  const detail = document.getElementById('detail-' + id);
  detail.classList.add('open');
  const card = document.getElementById('card-' + id);
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  history.pushState({ event: id }, '', '#event-' + id);
}
function closeEvent(id) {
  document.getElementById('detail-' + id).classList.remove('open');
  history.pushState(null, '', window.location.pathname + window.location.search);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
// Browser back/forward
window.addEventListener('popstate', (e) => {
  document.querySelectorAll('.event-detail').forEach(d => d.classList.remove('open'));
  if (e.state && e.state.event) {
    const detail = document.getElementById('detail-' + e.state.event);
    if (detail) detail.classList.add('open');
  }
});
// Open from URL hash on load
const hash = window.location.hash;
if (hash && hash.startsWith('#event-')) {
  const id = hash.replace('#event-', '');
  const detail = document.getElementById('detail-' + id);
  if (detail) {
    detail.classList.add('open');
    setTimeout(() => document.getElementById('card-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }
}
</script>`, 'Ways to Serve — Timothy Lutheran');
    }

    // ── PUBLIC: submit sign-up ─────────────────────────────────
    if (path === '/signup' && method === 'POST') {
      const form = await request.formData();
      const eventId = parseInt(form.get('event_id') || '0');
      const name = (form.get('name') || '').trim();
      if (!name || !eventId) return redirect('/');

      await env.DB.prepare(
        'INSERT INTO signups (event_id, role_id, name, email, phone, notes) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        eventId,
        form.get('role_id') ? parseInt(form.get('role_id')) : null,
        name,
        (form.get('email') || '').trim(),
        (form.get('phone') || '').trim(),
        (form.get('notes') || '').trim()
      ).run();

      return redirect('/?success=1');
    }

    // ── ADMIN AUTH ─────────────────────────────────────────────
    if (path === '/admin/login' && method === 'POST') {
      const form = await request.formData();
      if (form.get('password') === ADMIN_PASSWORD) {
        return new Response('', {
          status: 302,
          headers: { Location: '/admin', 'Set-Cookie': authCookieHeader() }
        });
      }
      return loginPage('Incorrect password. Try again.');
    }

    if (path === '/admin/login') return loginPage();

    if (path === '/admin/logout') {
      return new Response('', {
        status: 302,
        headers: { Location: '/admin/login', 'Set-Cookie': 'vol_auth=; Path=/; Max-Age=0' }
      });
    }

    // All /admin/* routes require auth
    if (path.startsWith('/admin') && !isAuthed(request)) {
      return redirect('/admin/login');
    }

    // ── ADMIN: dashboard ───────────────────────────────────────
    if (path === '/admin' && method === 'GET') {
      const events = await env.DB.prepare(
        'SELECT * FROM serve_events ORDER BY sort_order, event_date, id'
      ).all();

      let rows = '';
      for (const ev of events.results) {
        const roleCount = (await env.DB.prepare('SELECT COUNT(*) as c FROM serve_roles WHERE event_id=?').bind(ev.id).first()).c;
        const signupCount = (await env.DB.prepare('SELECT COUNT(*) as c FROM signups WHERE event_id=?').bind(ev.id).first()).c;
        rows += `
<tr>
  <td>
    <div style="font-family:var(--serif);font-size:15px;color:var(--steel);">${esc(ev.name)}</div>
    ${ev.event_date ? `<div style="font-size:12px;color:var(--gray);margin-top:2px;">${esc(formatDate(ev.event_date))}</div>` : ''}
    ${ev.description ? `<div style="font-size:12px;color:var(--gray);margin-top:3px;max-width:320px;">${esc(ev.description.substring(0, 90))}${ev.description.length > 90 ? '…' : ''}</div>` : ''}
  </td>
  <td><span class="tag ${ev.hidden ? 'tag-hidden' : 'tag-visible'}">${ev.hidden ? 'Hidden' : 'Visible'}</span></td>
  <td>${roleCount}</td>
  <td>${signupCount}</td>
  <td>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <a href="/admin/events/${ev.id}" class="btn btn-sm btn-primary">Manage</a>
      <form method="POST" action="/admin/events/${ev.id}/toggle" style="display:inline;">
        <button class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);" type="submit">${ev.hidden ? 'Show' : 'Hide'}</button>
      </form>
      <form method="POST" action="/admin/events/${ev.id}/delete" onsubmit="return confirm('Delete this event and all its sign-ups?')" style="display:inline;">
        <button class="btn btn-sm btn-danger" type="submit">Delete</button>
      </form>
    </div>
  </td>
</tr>`;
      }

      return htmlPage(adminWrap(`
<div class="page-title">Volunteer Events</div>
<div class="page-sub">Manage sign-up opportunities, roles, and volunteer lists.</div>
<div class="btn-row no-print" style="margin-bottom:24px;">
  <a href="/admin/events/new" class="btn btn-primary">+ Add event</a>
  <a href="/admin/signups" class="btn btn-secondary">View all sign-ups</a>
</div>
<div class="card" style="padding:0;overflow:hidden;">
  <table class="data-table">
    <thead><tr>
      <th>Event</th><th>Status</th><th>Roles</th><th>Sign-ups</th><th>Actions</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--gray);">No events yet. Add one above.</td></tr>'}</tbody>
  </table>
</div>`), 'Volunteer Admin — Timothy Lutheran');
    }

    // ── ADMIN: event detail (manage roles + signups) ───────────
    if (path.match(/^\/admin\/events\/\d+$/) && method === 'GET') {
      const id = path.split('/').pop();
      const ev = await env.DB.prepare('SELECT * FROM serve_events WHERE id=?').bind(id).first();
      if (!ev) return redirect('/admin');

      const roles = await env.DB.prepare(
        'SELECT * FROM serve_roles WHERE event_id=? ORDER BY sort_order, id'
      ).bind(id).all();

      const sups = await env.DB.prepare(`
        SELECT s.*, r.name as role_name FROM signups s
        LEFT JOIN serve_roles r ON s.role_id = r.id
        WHERE s.event_id=? ORDER BY s.created_at DESC
      `).bind(id).all();

      const rolesHtml = roles.results.length
        ? roles.results.map(r => `
<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);">
  <div>
    <div style="font-weight:700;font-size:14px;color:var(--steel);">${esc(r.name)}</div>
    ${r.description ? `<div style="font-size:13px;color:var(--gray);margin-top:3px;line-height:1.5;">${esc(r.description)}</div>` : ''}
    ${r.slots > 0 ? `<div style="font-size:11px;color:var(--amber);font-weight:700;margin-top:3px;">${r.slots} slot${r.slots !== 1 ? 's' : ''}</div>` : ''}
  </div>
  <div style="display:flex;gap:6px;flex-shrink:0;">
    <a href="/admin/events/${id}/roles/${r.id}/edit" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Edit</a>
    <form method="POST" action="/admin/events/${id}/roles/${r.id}/delete" onsubmit="return confirm('Delete this role?')" style="display:inline;">
      <button class="btn btn-sm btn-danger" type="submit">Delete</button>
    </form>
  </div>
</div>`).join('')
        : '<p style="color:var(--gray);font-size:14px;padding:16px 0;">No roles yet. Add one below.</p>';

      const tableRows = sups.results.map(s => `
<tr>
  <td><strong>${esc(s.name)}</strong></td>
  <td>${esc(s.email)}</td>
  <td>${esc(s.phone)}</td>
  <td>${esc(s.role_name || '—')}</td>
  <td style="max-width:200px;">${esc(s.notes || '—')}</td>
  <td style="white-space:nowrap;color:var(--gray);font-size:12px;">${s.created_at ? s.created_at.substring(0, 10) : ''}</td>
</tr>`).join('');

      const signupsHtml = sups.results.length
        ? `<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Notes</th><th>Date</th></tr></thead><tbody>${tableRows}</tbody></table>`
        : '<p style="color:var(--gray);font-size:14px;padding:16px 0;">No sign-ups yet.</p>';

      return htmlPage(adminWrap(`
<div style="margin-bottom:20px;" class="no-print">
  <a href="/admin" style="font-size:13px;color:var(--steel);font-weight:700;text-decoration:none;">← All events</a>
</div>
<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:8px;">
  <div>
    <div class="page-title">${esc(ev.name)}</div>
    ${ev.event_date ? `<div style="font-size:13px;color:var(--amber);font-weight:700;margin-top:4px;">${esc(formatDate(ev.event_date))}</div>` : ''}
    <span class="tag ${ev.hidden ? 'tag-hidden' : 'tag-visible'}" style="margin-top:8px;display:inline-block;">${ev.hidden ? 'Hidden from public' : 'Visible to public'}</span>
  </div>
  <div class="btn-row no-print" style="margin-top:0;">
    <a href="/admin/events/${ev.id}/edit" class="btn btn-secondary">Edit event</a>
    <form method="POST" action="/admin/events/${ev.id}/toggle" style="display:inline;">
      <button class="btn" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);" type="submit">${ev.hidden ? 'Make visible' : 'Hide event'}</button>
    </form>
  </div>
</div>
${ev.description ? `<p style="color:var(--gray);font-size:14px;margin-bottom:28px;line-height:1.7;max-width:640px;">${esc(ev.description)}</p>` : ''}

<div class="card">
  <div class="card-title">Roles</div>
  ${rolesHtml}
  <div style="margin-top:16px;" class="no-print">
    <a href="/admin/events/${id}/roles/new" class="btn btn-sm btn-primary">+ Add role</a>
  </div>
</div>

<div class="card">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border);">
    <div class="card-title" style="margin:0;padding:0;border:none;">Sign-ups (${sups.results.length})</div>
    <div class="btn-row no-print" style="margin:0;">
      <a href="/admin/events/${id}/signups/export.csv" class="btn btn-sm btn-sage">Export CSV</a>
      <button onclick="window.print()" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Print</button>
    </div>
  </div>
  ${signupsHtml}
</div>`), `${esc(ev.name)} — Volunteer Admin`);
    }

    // ── ADMIN: new event form ──────────────────────────────────
    if (path === '/admin/events/new' && method === 'GET') {
      return htmlPage(adminWrap(`
<div style="margin-bottom:20px;" class="no-print">
  <a href="/admin" style="font-size:13px;color:var(--steel);font-weight:700;text-decoration:none;">← All events</a>
</div>
<div class="page-title">New Event</div>
<div class="page-sub">Add a volunteer opportunity to the sign-up page.</div>
<form method="POST" action="/admin/events">
  ${eventForm()}
  <div class="btn-row">
    <button type="submit" class="btn btn-primary">Create event →</button>
    <a href="/admin" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
  </div>
</form>`), 'New Event — Volunteer Admin');
    }

    // ── ADMIN: create event ────────────────────────────────────
    if (path === '/admin/events' && method === 'POST') {
      const form = await request.formData();
      await env.DB.prepare(
        'INSERT INTO serve_events (name, description, event_date, hidden, sort_order) VALUES (?, ?, ?, ?, ?)'
      ).bind(
        (form.get('name') || '').trim(),
        (form.get('description') || '').trim(),
        (form.get('event_date') || '').trim(),
        form.get('hidden') === '1' ? 1 : 0,
        parseInt(form.get('sort_order') || '0') || 0
      ).run();
      return redirect('/admin');
    }

    // ── ADMIN: edit event form ─────────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/edit$/) && method === 'GET') {
      const id = path.split('/')[3];
      const ev = await env.DB.prepare('SELECT * FROM serve_events WHERE id=?').bind(id).first();
      if (!ev) return redirect('/admin');
      return htmlPage(adminWrap(`
<div style="margin-bottom:20px;" class="no-print">
  <a href="/admin/events/${id}" style="font-size:13px;color:var(--steel);font-weight:700;text-decoration:none;">← Back to event</a>
</div>
<div class="page-title">Edit Event</div>
<form method="POST" action="/admin/events/${id}/update" style="margin-top:24px;">
  ${eventForm(ev)}
  <div class="btn-row">
    <button type="submit" class="btn btn-primary">Save changes →</button>
    <a href="/admin/events/${id}" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
  </div>
</form>`), 'Edit Event — Volunteer Admin');
    }

    // ── ADMIN: update event ────────────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/update$/) && method === 'POST') {
      const id = path.split('/')[3];
      const form = await request.formData();
      await env.DB.prepare(
        'UPDATE serve_events SET name=?, description=?, event_date=?, hidden=?, sort_order=? WHERE id=?'
      ).bind(
        (form.get('name') || '').trim(),
        (form.get('description') || '').trim(),
        (form.get('event_date') || '').trim(),
        form.get('hidden') === '1' ? 1 : 0,
        parseInt(form.get('sort_order') || '0') || 0,
        id
      ).run();
      return redirect(`/admin/events/${id}`);
    }

    // ── ADMIN: toggle event visibility ─────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/toggle$/) && method === 'POST') {
      const id = path.split('/')[3];
      await env.DB.prepare('UPDATE serve_events SET hidden = 1 - hidden WHERE id=?').bind(id).run();
      const ref = request.headers.get('referer') || '/admin';
      return redirect(ref);
    }

    // ── ADMIN: delete event ────────────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/delete$/) && method === 'POST') {
      const id = path.split('/')[3];
      await env.DB.prepare('DELETE FROM signups WHERE event_id=?').bind(id).run();
      await env.DB.prepare('DELETE FROM serve_roles WHERE event_id=?').bind(id).run();
      await env.DB.prepare('DELETE FROM serve_events WHERE id=?').bind(id).run();
      return redirect('/admin');
    }

    // ── ADMIN: new role form ───────────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/roles\/new$/) && method === 'GET') {
      const id = path.split('/')[3];
      const ev = await env.DB.prepare('SELECT name FROM serve_events WHERE id=?').bind(id).first();
      if (!ev) return redirect('/admin');
      return htmlPage(adminWrap(`
<div style="margin-bottom:20px;" class="no-print">
  <a href="/admin/events/${id}" style="font-size:13px;color:var(--steel);font-weight:700;text-decoration:none;">← Back to ${esc(ev.name)}</a>
</div>
<div class="page-title">New Role</div>
<div class="page-sub">Add a specific role people can sign up for.</div>
<form method="POST" action="/admin/events/${id}/roles">
  ${roleForm()}
  <div class="btn-row">
    <button type="submit" class="btn btn-primary">Add role →</button>
    <a href="/admin/events/${id}" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
  </div>
</form>`), 'New Role — Volunteer Admin');
    }

    // ── ADMIN: create role ─────────────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/roles$/) && method === 'POST') {
      const id = path.split('/')[3];
      const form = await request.formData();
      await env.DB.prepare(
        'INSERT INTO serve_roles (event_id, name, description, slots, sort_order) VALUES (?, ?, ?, ?, ?)'
      ).bind(
        id,
        (form.get('name') || '').trim(),
        (form.get('description') || '').trim(),
        parseInt(form.get('slots') || '0') || 0,
        parseInt(form.get('sort_order') || '0') || 0
      ).run();
      return redirect(`/admin/events/${id}`);
    }

    // ── ADMIN: edit role form ──────────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/roles\/\d+\/edit$/) && method === 'GET') {
      const parts = path.split('/');
      const eid = parts[3]; const rid = parts[5];
      const role = await env.DB.prepare('SELECT * FROM serve_roles WHERE id=? AND event_id=?').bind(rid, eid).first();
      if (!role) return redirect(`/admin/events/${eid}`);
      const ev = await env.DB.prepare('SELECT name FROM serve_events WHERE id=?').bind(eid).first();
      return htmlPage(adminWrap(`
<div style="margin-bottom:20px;" class="no-print">
  <a href="/admin/events/${eid}" style="font-size:13px;color:var(--steel);font-weight:700;text-decoration:none;">← Back to ${esc(ev?.name || 'event')}</a>
</div>
<div class="page-title">Edit Role</div>
<form method="POST" action="/admin/events/${eid}/roles/${rid}/update" style="margin-top:24px;">
  ${roleForm(role)}
  <div class="btn-row">
    <button type="submit" class="btn btn-primary">Save changes →</button>
    <a href="/admin/events/${eid}" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
  </div>
</form>`), 'Edit Role — Volunteer Admin');
    }

    // ── ADMIN: update role ─────────────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/roles\/\d+\/update$/) && method === 'POST') {
      const parts = path.split('/');
      const eid = parts[3]; const rid = parts[5];
      const form = await request.formData();
      await env.DB.prepare(
        'UPDATE serve_roles SET name=?, description=?, slots=?, sort_order=? WHERE id=? AND event_id=?'
      ).bind(
        (form.get('name') || '').trim(),
        (form.get('description') || '').trim(),
        parseInt(form.get('slots') || '0') || 0,
        parseInt(form.get('sort_order') || '0') || 0,
        rid, eid
      ).run();
      return redirect(`/admin/events/${eid}`);
    }

    // ── ADMIN: delete role ─────────────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/roles\/\d+\/delete$/) && method === 'POST') {
      const parts = path.split('/');
      const eid = parts[3]; const rid = parts[5];
      await env.DB.prepare('DELETE FROM serve_roles WHERE id=? AND event_id=?').bind(rid, eid).run();
      return redirect(`/admin/events/${eid}`);
    }

    // ── ADMIN: all sign-ups ────────────────────────────────────
    if (path === '/admin/signups' && method === 'GET') {
      const eventId = url.searchParams.get('event');
      let sups;

      if (eventId) {
        sups = await env.DB.prepare(`
          SELECT s.*, e.name as event_name, r.name as role_name
          FROM signups s
          LEFT JOIN serve_events e ON s.event_id = e.id
          LEFT JOIN serve_roles r ON s.role_id = r.id
          WHERE s.event_id=? ORDER BY s.created_at DESC
        `).bind(eventId).all();
      } else {
        sups = await env.DB.prepare(`
          SELECT s.*, e.name as event_name, r.name as role_name
          FROM signups s
          LEFT JOIN serve_events e ON s.event_id = e.id
          LEFT JOIN serve_roles r ON s.role_id = r.id
          ORDER BY s.created_at DESC
        `).all();
      }

      const allEvents = await env.DB.prepare('SELECT id, name FROM serve_events ORDER BY name').all();

      const filterHtml = `
<form method="GET" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;" class="no-print">
  <select name="event" style="width:auto;min-width:220px;" onchange="this.form.submit()">
    <option value="">All events</option>
    ${allEvents.results.map(e => `<option value="${e.id}" ${eventId == e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
  </select>
  <button type="submit" class="btn btn-sm btn-primary">Filter</button>
  ${eventId ? `<a href="/admin/signups" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Clear</a>` : ''}
</form>`;

      const rows = sups.results;
      const tableRows = rows.map(s => `
<tr>
  <td><strong>${esc(s.name)}</strong></td>
  <td>${esc(s.email)}</td>
  <td>${esc(s.phone)}</td>
  <td>${esc(s.event_name || '—')}</td>
  <td>${esc(s.role_name || '—')}</td>
  <td style="max-width:180px;">${esc(s.notes || '—')}</td>
  <td style="white-space:nowrap;color:var(--gray);font-size:12px;">${s.created_at ? s.created_at.substring(0, 10) : ''}</td>
</tr>`).join('');

      const tableHtml = rows.length
        ? `<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Event</th><th>Role</th><th>Notes</th><th>Date</th></tr></thead><tbody>${tableRows}</tbody></table>`
        : '<p style="color:var(--gray);font-size:14px;padding:40px 0;text-align:center;">No sign-ups yet.</p>';

      const exportUrl = `/admin/signups/export.csv${eventId ? `?event=${eventId}` : ''}`;

      return htmlPage(adminWrap(`
<div style="margin-bottom:20px;" class="no-print">
  <a href="/admin" style="font-size:13px;color:var(--steel);font-weight:700;text-decoration:none;">← All events</a>
</div>
<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:8px;">
  <div class="page-title">All Sign-ups (${rows.length})</div>
  <div class="btn-row no-print" style="margin:0;">
    <a href="${exportUrl}" class="btn btn-sage">Export CSV</a>
    <button onclick="window.print()" class="btn" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Print</button>
  </div>
</div>
${filterHtml}
<div class="card" style="padding:0;overflow:hidden;margin-top:16px;">
  ${tableHtml}
</div>`), 'Sign-ups — Volunteer Admin');
    }

    // ── ADMIN: export CSV ──────────────────────────────────────
    if (path === '/admin/signups/export.csv' && method === 'GET') {
      const eventId = url.searchParams.get('event');
      let rows;

      if (eventId) {
        const q = await env.DB.prepare(`
          SELECT s.name, s.email, s.phone, e.name as event_name, r.name as role_name, s.notes, s.created_at
          FROM signups s
          LEFT JOIN serve_events e ON s.event_id = e.id
          LEFT JOIN serve_roles r ON s.role_id = r.id
          WHERE s.event_id=? ORDER BY s.created_at DESC
        `).bind(eventId).all();
        rows = q.results;
      } else {
        const q = await env.DB.prepare(`
          SELECT s.name, s.email, s.phone, e.name as event_name, r.name as role_name, s.notes, s.created_at
          FROM signups s
          LEFT JOIN serve_events e ON s.event_id = e.id
          LEFT JOIN serve_roles r ON s.role_id = r.id
          ORDER BY event_name, s.created_at DESC
        `).all();
        rows = q.results;
      }

      const lines = ['Name,Email,Phone,Event,Role,Notes,Date'];
      for (const r of rows) {
        lines.push(
          [r.name, r.email, r.phone, r.event_name || '', r.role_name || '', r.notes || '', r.created_at || '']
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
      }

      const filename = `volunteers-${new Date().toISOString().substring(0, 10)}.csv`;
      return new Response(lines.join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    }

    // ── ADMIN: per-event CSV export ────────────────────────────
    if (path.match(/^\/admin\/events\/\d+\/signups\/export\.csv$/) && method === 'GET') {
      const id = path.split('/')[3];
      const ev = await env.DB.prepare('SELECT name FROM serve_events WHERE id=?').bind(id).first();
      const q = await env.DB.prepare(`
        SELECT s.name, s.email, s.phone, r.name as role_name, s.notes, s.created_at
        FROM signups s
        LEFT JOIN serve_roles r ON s.role_id = r.id
        WHERE s.event_id=? ORDER BY s.created_at DESC
      `).bind(id).all();

      const lines = ['Name,Email,Phone,Role,Notes,Date'];
      for (const r of q.results) {
        lines.push(
          [r.name, r.email, r.phone, r.role_name || '', r.notes || '', r.created_at || '']
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
      }

      const safeName = (ev?.name || 'event').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      const filename = `volunteers-${safeName}-${new Date().toISOString().substring(0, 10)}.csv`;
      return new Response(lines.join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};
