// ── HELPERS, TINYMCE, TOPBAR, LOGIN ─────────────────────────
// Extracted from tlc-admin-worker.js

import { TINYMCE_API_KEY, TINYMCE_HEAD } from './db.js';

// ── HELPERS ─────────────────────────────────────────────────
export function authCookie(req) {
  const cookie = req.headers.get('cookie') || '';
  return cookie.includes('tlc_auth=authenticated');
}

export function setCookieHeader() {
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  return `tlc_auth=authenticated; Path=/; Expires=${exp}; HttpOnly; SameSite=Strict`;
}


export function html(body, title = 'TLC Admin', extraHead = '') {
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

// ── TOPBAR WITH TABS ─────────────────────────────────────────
export function topbarHtml(activeTab, extraLinks = '') {
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
export function loginPage(error = '') {
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
      .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
      .then(function(d) { d && d.location ? resolve(d.location) : reject('Bad response'); })
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

// TinyMCE editor for ministry post body field
export function tinymcePostSection(existingBody = '') {
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
export function tinymceSermonSection(existingOutline = '') {
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
export function tinymceYouthSection(existingContent = '') {
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
export function tinymcePageSection(existingContent = '') {
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

// TinyMCE editor for pastor's note
export function tinymcePastorSection(existingBody = '') {
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
