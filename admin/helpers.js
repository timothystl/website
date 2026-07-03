// ── HELPERS, TINYMCE, TOPBAR, LOGIN ─────────────────────────
// Extracted from tlc-admin-worker.js

import { TINYMCE_API_KEY, TINYMCE_HEAD } from './db.js';
import { PERMISSIONS, hasPermission } from './auth.js';

export const VERSION = 'v1.76.41';


export function html(body, title = 'TLC Admin', extraHead = '') {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
${extraHead}
<style>
:root{--steel:#0A3C5C;--amber:#D4922A;--sage:#6B8F71;--warm:#FAF7F0;--linen:#F2EDE2;--mist:#EDF5F8;--border:#E8E0D0;--charcoal:#3D3530;--gray:#7A6E60;--white:#fff;--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;--serif:Georgia,'Times New Roman',serif;}
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
.tab-nav{background:var(--linen);border-bottom:2px solid var(--border);overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:thin;}
.tab-nav-inner{max-width:860px;margin:0 auto;padding:0 28px;display:flex;flex-wrap:nowrap;width:max-content;min-width:100%;}
.tab{font-family:var(--sans);font-size:13px;font-weight:700;color:var(--gray);padding:12px 20px;text-decoration:none;border-bottom:3px solid transparent;margin-bottom:-2px;display:inline-block;white-space:nowrap;flex-shrink:0;transition:color .15s;}
.tab:hover{color:var(--steel);}
.tab-active{color:var(--steel);border-bottom-color:var(--amber);}
.tab-external{color:var(--gray);font-weight:600;border-left:1px solid var(--border);margin-left:8px;padding-left:24px;}
.tab-external:hover{color:var(--steel);}
.nav-toggle{display:none;background:transparent;border:0;padding:8px;margin-right:-8px;cursor:pointer;color:white;}
.nav-toggle svg{display:block;width:24px;height:24px;}
@media (max-width:720px){
  .topbar{padding:0 16px;}
  .topbar-links{display:none;}
  .nav-toggle{display:inline-flex;align-items:center;}
  .tab-nav{display:none;overflow:visible;border-bottom:2px solid var(--border);}
  .tab-nav.is-open{display:block;}
  .tab-nav-inner{display:block;width:auto;min-width:0;padding:6px 0;}
  .tab{display:block;padding:12px 20px;border-bottom:1px solid var(--border);border-left:3px solid transparent;margin-bottom:0;}
  .tab:last-child{border-bottom:none;}
  .tab-active{border-left-color:var(--amber);background:rgba(212,146,42,.08);}
  .tab-external{border-left:3px solid transparent;margin-left:0;padding-left:20px;}
}
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
.badge-pending{background:#FFF0E6;color:#7A3D00;}
.badge-approved{background:#e8f5e9;color:#1a3d1f;}
.nl-section-head{font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gray);padding:10px 0 6px;border-top:2px solid var(--border);margin-top:4px;}
.nl-section-head:first-child{border-top:none;margin-top:0;}
.perm-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-top:10px;}
.perm-row{display:flex;align-items:center;gap:8px;}
.perm-row input[type=checkbox]{width:auto;margin:0;}
.perm-row label{font-family:var(--sans);font-size:13px;font-weight:600;color:var(--charcoal);letter-spacing:0;text-transform:none;cursor:pointer;margin:0;}
.user-row{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.user-row:last-child{border-bottom:none;}
.user-name{font-family:var(--serif);font-size:16px;color:var(--steel);flex:1;}
.user-meta{font-family:var(--sans);font-size:11px;color:var(--gray);}
.audit-row{display:grid;grid-template-columns:140px 80px 90px 1fr auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);font-family:var(--sans);font-size:13px;}
.audit-row:last-child{border-bottom:none;}
.audit-who{color:var(--steel);font-weight:700;}
.audit-action{text-transform:capitalize;}
.audit-entity{color:var(--gray);}
.pending-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#D4922A;margin-left:6px;vertical-align:middle;}
</style>
</head>
<body>${body}</body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=10',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.tiny.cloud 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.tiny.cloud; font-src https://cdn.tiny.cloud; img-src 'self' data: blob: https:; connect-src 'self' https://cdn.tiny.cloud; frame-src 'self' https://cdn.tiny.cloud;"
    }
  });
}

// ── TOPBAR WITH TABS ─────────────────────────────────────────
// pendingCount: number of newsletters awaiting approval (shown as dot on News tab)
export function topbarHtml(activeTab, user, extraLinks = '', pendingCount = 0) {
  const hp = (p) => hasPermission(user, p);
  const newsActive = activeTab === 'news' || activeTab === 'newsletter';
  const showNewsTab = hp('news_edit') || hp('newsletter_edit') || hp('newsletter_approve');
  const pendingDot = pendingCount > 0 && hp('newsletter_approve') ? `<span class="pending-dot" title="${pendingCount} newsletter(s) awaiting approval"></span>` : '';
  return `<div class="topbar">
  <div>
    <div class="topbar-brand">Timothy Lutheran · Admin <span style="font-size:10px;font-weight:400;opacity:.5;margin-left:6px;">${VERSION}</span></div>
    <div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:1px;">${user ? user.username : ''}</div>
  </div>
  <div class="topbar-links">
    ${extraLinks}
    <a href="/logout">Sign out</a>
  </div>
  <button type="button" class="nav-toggle" id="nav-toggle" aria-label="Open navigation" aria-expanded="false" aria-controls="tab-nav-scroll">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
  </button>
</div>
<nav class="tab-nav" id="tab-nav-scroll">
  <div class="tab-nav-inner">
    ${showNewsTab        ? `<a href="/newsitems" class="tab${newsActive ? ' tab-active' : ''}">News &amp; Events${pendingDot}</a>` : ''}
    ${hp('news_edit')       ? `<a href="/christian-education" class="tab${activeTab === 'christian-education' ? ' tab-active' : ''}">Christian Ed</a>` : ''}
    ${hp('ministries_edit') ? `<a href="/ministries" class="tab${activeTab === 'ministries' ? ' tab-active' : ''}">Ministries</a>` : ''}
    ${hp('sermons_edit')    ? `<a href="/sermons" class="tab${activeTab === 'sermons' ? ' tab-active' : ''}">Sermons</a>` : ''}
    ${hp('pages_edit')      ? `<a href="/pages" class="tab${activeTab === 'pages' ? ' tab-active' : ''}">Pages</a>` : ''}
    ${hp('staff_edit')      ? `<a href="/staff" class="tab${activeTab === 'staff' ? ' tab-active' : ''}">Staff</a>` : ''}
    ${hp('links_edit')      ? `<a href="/link-cards" class="tab${activeTab === 'link-cards' ? ' tab-active' : ''}">Links</a>` : ''}
    ${hp('settings_manage') ? `<a href="/settings" class="tab${activeTab === 'settings' ? ' tab-active' : ''}">Settings</a>` : ''}
    ${hp('settings_manage') ? `<a href="/subscribers" class="tab${activeTab === 'subscribers' ? ' tab-active' : ''}">Subscribers</a>` : ''}
    ${hp('gym_manage')      ? `<a href="/gym-rentals" class="tab${activeTab === 'gym' ? ' tab-active' : ''}">Gym Rentals</a>` : ''}
    ${hp('settings_manage') ? `<a href="/payroll" class="tab${activeTab === 'payroll' ? ' tab-active' : ''}">Payroll</a>` : ''}
    ${hp('users_manage')    ? `<a href="/users" class="tab${activeTab === 'users' ? ' tab-active' : ''}">Users</a>` : ''}
    ${hp('audit_view')      ? `<a href="/audit-log" class="tab${activeTab === 'audit' ? ' tab-active' : ''}">Audit Log</a>` : ''}
    <a href="https://volunteer.timothystl.org/scheduler" target="_blank" class="tab tab-external">Scheduler ↗</a>
    <a href="https://volunteer.timothystl.org/admin" target="_blank" class="tab tab-external">Volunteer Admin ↗</a>
  </div>
</nav>
<script>(function(){
var n=document.getElementById('tab-nav-scroll');
if(n){var a=n.querySelector('.tab-active');if(a){var l=a.offsetLeft-(n.clientWidth-a.offsetWidth)/2;n.scrollLeft=Math.max(0,l);}}
var btn=document.getElementById('nav-toggle');
if(btn&&n){btn.addEventListener('click',function(){var open=n.classList.toggle('is-open');btn.setAttribute('aria-expanded',open?'true':'false');});}
})();</script>`;
}

// ── LOGIN PAGE ───────────────────────────────────────────────
export function loginPage(error = '', success = '') {
  return html(`
<div class="login-wrap">
  <div class="login-card">
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:8px;">Timothy Lutheran Church</div>
    <div class="login-title">Admin Portal</div>
    <div class="login-sub">Sign in to manage the website</div>
    ${success ? `<div class="alert alert-success">${success}</div>` : ''}
    ${error ? `<div class="alert alert-error">${error}</div>` : ''}
    <form method="POST" action="/login">
      <div class="form-group">
        <label>Username</label>
        <input type="text" name="username" autofocus autocomplete="username" placeholder="Username">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" name="password" autocomplete="current-password" placeholder="Password">
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px;">Sign in</button>
    </form>
    <div style="margin-top:18px;text-align:center;">
      <a href="/forgot-password" style="font-size:13px;color:var(--gray);text-decoration:none;">Forgot your password?</a>
    </div>
  </div>
</div>`, 'TLC Admin — Sign In');
}

// ── FORGOT PASSWORD PAGE ──────────────────────────────────────
export function forgotPasswordPage(msg = '', error = '') {
  return html(`
<div class="login-wrap">
  <div class="login-card">
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:8px;">Timothy Lutheran Church</div>
    <div class="login-title">Reset Password</div>
    <div class="login-sub">Enter your email and we'll send you a reset link.</div>
    ${error ? `<div class="alert alert-error">${error}</div>` : ''}
    ${msg ? `<div class="alert alert-success">${msg}</div>` : `
    <form method="POST" action="/forgot-password">
      <div class="form-group" style="text-align:left;">
        <label>Email address</label>
        <input type="email" name="email" autofocus autocomplete="email" placeholder="your@email.com">
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px;">Send reset link</button>
    </form>`}
    <div style="margin-top:18px;text-align:center;">
      <a href="/login" style="font-size:13px;color:var(--gray);text-decoration:none;">Back to sign in</a>
    </div>
  </div>
</div>`, 'TLC Admin — Reset Password');
}

// ── RESET PASSWORD PAGE ───────────────────────────────────────
export function resetPasswordPage(token, error = '') {
  const safeToken = (token || '').replace(/"/g, '&quot;');
  return html(`
<div class="login-wrap">
  <div class="login-card">
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:8px;">Timothy Lutheran Church</div>
    <div class="login-title">Set New Password</div>
    <div class="login-sub">Choose a new password for your account.</div>
    ${error ? `<div class="alert alert-error">${error}</div>` : ''}
    <form method="POST" action="/reset-password">
      <input type="hidden" name="token" value="${safeToken}">
      <div class="form-group" style="text-align:left;">
        <label>New password</label>
        <input type="password" name="password" autofocus autocomplete="new-password" placeholder="Min 8 characters">
      </div>
      <div class="form-group" style="text-align:left;">
        <label>Confirm new password</label>
        <input type="password" name="password2" autocomplete="new-password">
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px;">Set new password</button>
    </form>
  </div>
</div>`, 'TLC Admin — Set New Password');
}

// ── SETUP PAGE (first-run only) ───────────────────────────────
export function setupPage(error = '') {
  return html(`
<div class="login-wrap">
  <div class="login-card" style="max-width:420px;">
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:8px;">Timothy Lutheran Church</div>
    <div class="login-title">Admin Setup</div>
    <div class="login-sub">Create your admin account to get started. This screen only appears once.</div>
    ${error ? `<div class="alert alert-error">${error}</div>` : ''}
    <form method="POST" action="/setup">
      <div class="form-group" style="text-align:left;">
        <label>Username</label>
        <input type="text" name="username" autofocus autocomplete="off" placeholder="e.g. admin">
      </div>
      <div class="form-group" style="text-align:left;">
        <label>Password</label>
        <input type="password" name="password" autocomplete="new-password" placeholder="Choose a strong password">
      </div>
      <div class="form-group" style="text-align:left;">
        <label>Confirm password</label>
        <input type="password" name="password2" autocomplete="new-password" placeholder="Repeat password">
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px;">Create admin account →</button>
    </form>
  </div>
</div>`, 'TLC Admin — Setup');
}

// ── PERMISSION CHECKBOXES ─────────────────────────────────────
export function permissionCheckboxes(selectedPerms = []) {
  const selected = Array.isArray(selectedPerms) ? selectedPerms : JSON.parse(selectedPerms || '[]');
  return `<div class="perm-grid">${Object.entries(PERMISSIONS).map(([key, label]) =>
    `<div class="perm-row">
      <input type="checkbox" id="perm_${key}" name="perm_${key}" value="1"${selected.includes(key) ? ' checked' : ''}>
      <label for="perm_${key}">${label}</label>
    </div>`
  ).join('')}</div>`;
}

// ── ESCAPE HTML ──────────────────────────────────────────────
// Prevents XSS when user-controlled strings are rendered in template literals.
export function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── FORMAT DATE ──────────────────────────────────────────────
export function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// Builds the TinyMCE rich-text editor section for the body field
function tlcUploadHandler(blobInfo) {
  return new Promise(function(resolve, reject) {
    var fd = new FormData();
    fd.append('file', blobInfo.blob(), blobInfo.filename());
    fetch('/api/upload-image', { method: 'POST', body: fd })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, d: d }; }); })
      .then(function(res) {
        if (!res.ok) { reject(res.d && res.d.error ? res.d.error : 'Upload failed'); return; }
        res.d && res.d.location ? resolve(res.d.location) : reject('Bad response');
      })
      .catch(function(err) { reject('Upload failed: ' + err); });
  });
}

export function tinymceEditorSection(existingBody = '') {
  const safe = (existingBody || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Full text <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, shown when reader clicks "Read more"</span></label>
  <textarea id="body-editor" name="body"></textarea>
</div>
<script>
_onTinymce(function(){
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
  content_style: 'img { margin: 8px; max-width: 100%; height: auto; }',
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
    editor.on('NodeChange', function() {
      editor.dom.select('img').forEach(function(img) {
        if (!img.style.margin) { img.style.margin = '8px'; img.style.maxWidth = '100%'; img.style.height = 'auto'; }
      });
    });
  },
  init_instance_callback: function(editor) {
    var initialBody = \`${safe}\`;
    if (initialBody.trim()) editor.setContent(initialBody);
  }

});
});
if (!window._tlcSubmitWired) {
  window._tlcSubmitWired = true;
  document.querySelector('form').addEventListener('submit', function(e) {
    if (window._tlcSubmitting) return;
    var eds = window.tinymce ? tinymce.editors : [];
    if (!eds.length) return;
    e.preventDefault();
    window._tlcSubmitting = true;
    var form = e.target;
    var submitter = e.submitter;
    if (submitter && submitter.name) {
      var hid = document.createElement('input');
      hid.type = 'hidden';
      hid.name = submitter.name;
      hid.value = submitter.value;
      form.appendChild(hid);
    }
    var done = function() {
      eds.forEach(function(ed) { ed.save(); });
      // Strip any remaining blob: image references that failed to upload —
      // they'd render as broken icons in the sent email.
      form.querySelectorAll('textarea').forEach(function(t) {
        if (t.value && t.value.indexOf('blob:') !== -1) {
          t.value = t.value.replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');
        }
      });
      form.submit();
    };
    Promise.all(eds.map(function(ed) { return ed.uploadImages(); })).then(done, done);
  });
}
<\/script>`;
}

// TinyMCE editor for ministry post body field
export function tinymcePostSection(existingBody = '') {
  const safe = (existingBody || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Post content</label>
  <textarea id="post-editor" name="body"></textarea>
</div>
<script>
_onTinymce(function(){
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
  content_style: 'img { margin: 8px; max-width: 100%; height: auto; }',
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
    editor.on('NodeChange', function() {
      editor.dom.select('img').forEach(function(img) {
        if (!img.style.margin) { img.style.margin = '8px'; img.style.maxWidth = '100%'; img.style.height = 'auto'; }
      });
    });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) editor.setContent(initial);
  }
});
});
if (!window._tlcSubmitWired) {
  window._tlcSubmitWired = true;
  document.querySelector('form').addEventListener('submit', function(e) {
    if (window._tlcSubmitting) return;
    var eds = window.tinymce ? tinymce.editors : [];
    if (!eds.length) return;
    e.preventDefault();
    window._tlcSubmitting = true;
    var form = e.target;
    var submitter = e.submitter;
    if (submitter && submitter.name) {
      var hid = document.createElement('input');
      hid.type = 'hidden';
      hid.name = submitter.name;
      hid.value = submitter.value;
      form.appendChild(hid);
    }
    var done = function() {
      eds.forEach(function(ed) { ed.save(); });
      // Strip any remaining blob: image references that failed to upload —
      // they'd render as broken icons in the sent email.
      form.querySelectorAll('textarea').forEach(function(t) {
        if (t.value && t.value.indexOf('blob:') !== -1) {
          t.value = t.value.replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');
        }
      });
      form.submit();
    };
    Promise.all(eds.map(function(ed) { return ed.uploadImages(); })).then(done, done);
  });
}
<\/script>`;
}

// TinyMCE editor for sermon notes / outline field
export function tinymceSermonSection(existingOutline = '') {
  const safe = (existingOutline || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Notes / outline</label>
  <textarea id="sermon-editor" name="outline"></textarea>
</div>
<script>
_onTinymce(function(){
tinymce.init({
  selector: '#sermon-editor',
  plugins: 'image link lists blockquote table code',
  toolbar: 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code',
  menubar: false,
  min_height: 300,
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  image_advtab: false,
  automatic_uploads: true,
  images_upload_handler: ${tlcUploadHandler},
  paste_data_images: true,
  content_style: 'img { margin: 8px; max-width: 100%; height: auto; }',
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
    editor.on('NodeChange', function() {
      editor.dom.select('img').forEach(function(img) {
        if (!img.style.margin) { img.style.margin = '8px'; img.style.maxWidth = '100%'; img.style.height = 'auto'; }
      });
    });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) editor.setContent(initial);
  }
});
});
if (!window._tlcSubmitWired) {
  window._tlcSubmitWired = true;
  document.querySelector('form').addEventListener('submit', function(e) {
    if (window._tlcSubmitting) return;
    var eds = window.tinymce ? tinymce.editors : [];
    if (!eds.length) return;
    e.preventDefault();
    window._tlcSubmitting = true;
    var form = e.target;
    var submitter = e.submitter;
    if (submitter && submitter.name) {
      var hid = document.createElement('input');
      hid.type = 'hidden';
      hid.name = submitter.name;
      hid.value = submitter.value;
      form.appendChild(hid);
    }
    var done = function() {
      eds.forEach(function(ed) { ed.save(); });
      // Strip any remaining blob: image references that failed to upload —
      // they'd render as broken icons in the sent email.
      form.querySelectorAll('textarea').forEach(function(t) {
        if (t.value && t.value.indexOf('blob:') !== -1) {
          t.value = t.value.replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');
        }
      });
      form.submit();
    };
    Promise.all(eds.map(function(ed) { return ed.uploadImages(); })).then(done, done);
  });
}
<\/script>`;
}

// TinyMCE editor for youth page content field
export function tinymceYouthSection(existingContent = '') {
  const safe = (existingContent || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Page content</label>
  <textarea id="youth-editor" name="content"></textarea>
</div>
<script>
_onTinymce(function(){
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
  content_style: 'img { margin: 8px; max-width: 100%; height: auto; }',
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
    editor.on('NodeChange', function() {
      editor.dom.select('img').forEach(function(img) {
        if (!img.style.margin) { img.style.margin = '8px'; img.style.maxWidth = '100%'; img.style.height = 'auto'; }
      });
    });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) editor.setContent(initial);
  }
});
});
if (!window._tlcSubmitWired) {
  window._tlcSubmitWired = true;
  document.querySelector('form').addEventListener('submit', function(e) {
    if (window._tlcSubmitting) return;
    var eds = window.tinymce ? tinymce.editors : [];
    if (!eds.length) return;
    e.preventDefault();
    window._tlcSubmitting = true;
    var form = e.target;
    var submitter = e.submitter;
    if (submitter && submitter.name) {
      var hid = document.createElement('input');
      hid.type = 'hidden';
      hid.name = submitter.name;
      hid.value = submitter.value;
      form.appendChild(hid);
    }
    var done = function() {
      eds.forEach(function(ed) { ed.save(); });
      // Strip any remaining blob: image references that failed to upload —
      // they'd render as broken icons in the sent email.
      form.querySelectorAll('textarea').forEach(function(t) {
        if (t.value && t.value.indexOf('blob:') !== -1) {
          t.value = t.value.replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');
        }
      });
      form.submit();
    };
    Promise.all(eds.map(function(ed) { return ed.uploadImages(); })).then(done, done);
  });
}
<\/script>`;
}

// TinyMCE editor for page content blocks
export function tinymcePageSection(existingContent = '') {
  const safe = (existingContent || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<div class="form-group">
  <label>Block content</label>
  <textarea id="page-editor" name="content"></textarea>
</div>
<script>
_onTinymce(function(){
tinymce.init({
  selector: '#page-editor',
  plugins: 'image link lists blockquote table code',
  toolbar: 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code',
  menubar: false,
  min_height: 300,
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  image_advtab: false,
  automatic_uploads: true,
  images_upload_handler: ${tlcUploadHandler},
  paste_data_images: true,
  content_style: 'img { margin: 8px; max-width: 100%; height: auto; }',
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
    editor.on('NodeChange', function() {
      editor.dom.select('img').forEach(function(img) {
        if (!img.style.margin) { img.style.margin = '8px'; img.style.maxWidth = '100%'; img.style.height = 'auto'; }
      });
    });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) editor.setContent(initial);
  }
});
});
if (!window._tlcSubmitWired) {
  window._tlcSubmitWired = true;
  document.querySelector('form').addEventListener('submit', function(e) {
    if (window._tlcSubmitting) return;
    var eds = window.tinymce ? tinymce.editors : [];
    if (!eds.length) return;
    e.preventDefault();
    window._tlcSubmitting = true;
    var form = e.target;
    var submitter = e.submitter;
    if (submitter && submitter.name) {
      var hid = document.createElement('input');
      hid.type = 'hidden';
      hid.name = submitter.name;
      hid.value = submitter.value;
      form.appendChild(hid);
    }
    var done = function() {
      eds.forEach(function(ed) { ed.save(); });
      // Strip any remaining blob: image references that failed to upload —
      // they'd render as broken icons in the sent email.
      form.querySelectorAll('textarea').forEach(function(t) {
        if (t.value && t.value.indexOf('blob:') !== -1) {
          t.value = t.value.replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');
        }
      });
      form.submit();
    };
    Promise.all(eds.map(function(ed) { return ed.uploadImages(); })).then(done, done);
  });
}
<\/script>`;
}

// Simple TinyMCE editor for short text notes
export function tinymceNoteSection(id, name, existingContent = '', minHeight = 140) {
  const safe = (existingContent || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<textarea id="${id}" name="${name}"></textarea>
<script>
_onTinymce(function(){
tinymce.init({
  selector: '#${id}',
  plugins: 'image link lists blockquote table code',
  toolbar: 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code',
  menubar: false,
  min_height: ${minHeight},
  skin: 'oxide',
  content_css: 'default',
  convert_urls: false,
  image_advtab: false,
  automatic_uploads: true,
  images_upload_handler: ${tlcUploadHandler},
  paste_data_images: true,
  content_style: 'img { margin: 8px; max-width: 100%; height: auto; }',
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
    editor.on('NodeChange', function() {
      editor.dom.select('img').forEach(function(img) {
        if (!img.style.margin) { img.style.margin = '8px'; img.style.maxWidth = '100%'; img.style.height = 'auto'; }
      });
    });
  },
  init_instance_callback: function(editor) {
    var initial = \`${safe}\`;
    if (initial.trim()) { editor.setContent(initial); editor.save(); }
  }
});
});
<\/script>`;
}

// TinyMCE editor for pastor's note
export function tinymcePastorSection(existingBody = '') {
  const safe = (existingBody || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `
<div class="form-group">
  <label>Your message this week</label>
  <textarea id="pastor-editor" name="pastor_note"></textarea>
</div>
<script>
_onTinymce(function(){
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
  content_style: 'img { margin: 8px; max-width: 100%; height: auto; }',
  setup: function(editor) {
    editor.on('change input', function() { editor.save(); });
    editor.on('NodeChange', function() {
      editor.dom.select('img').forEach(function(img) {
        if (!img.style.margin) { img.style.margin = '8px'; img.style.maxWidth = '100%'; img.style.height = 'auto'; }
      });
    });
  },
  init_instance_callback: function(editor) {
    var initialBody = \`${safe}\`;
    if (initialBody.trim()) editor.setContent(initialBody);
  }
});
});
if (!window._tlcSubmitWired) {
  window._tlcSubmitWired = true;
  document.querySelector('form').addEventListener('submit', function(e) {
    if (window._tlcSubmitting) return;
    var eds = window.tinymce ? tinymce.editors : [];
    if (!eds.length) return;
    e.preventDefault();
    window._tlcSubmitting = true;
    var form = e.target;
    var submitter = e.submitter;
    if (submitter && submitter.name) {
      var hid = document.createElement('input');
      hid.type = 'hidden';
      hid.name = submitter.name;
      hid.value = submitter.value;
      form.appendChild(hid);
    }
    var done = function() {
      eds.forEach(function(ed) { ed.save(); });
      // Strip any remaining blob: image references that failed to upload —
      // they'd render as broken icons in the sent email.
      form.querySelectorAll('textarea').forEach(function(t) {
        if (t.value && t.value.indexOf('blob:') !== -1) {
          t.value = t.value.replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');
        }
      });
      form.submit();
    };
    Promise.all(eds.map(function(ed) { return ed.uploadImages(); })).then(done, done);
  });
}
<\/script>`;
}
