// ── HELPERS, TINYMCE, TOPBAR, LOGIN ─────────────────────────
// Extracted from tlc-admin-worker.js

import { TINYMCE_API_KEY, TINYMCE_HEAD } from './db.js';
import { PERMISSIONS, PERMISSION_PRESETS, hasPermission } from './auth.js';
import { ADMIN_UI_CSS, LIST_SECTION_JS, MENU_CSS, PRESET_CSS, GYM_CAL_CSS, PANEL_LIST_CSS, NEWSLETTER_CSS, PANEL_LIST_JS, TOGGLE_WORD_JS, TOAST_CSS, TOAST_JS, CMDK_CSS, CMDK_JS, CMDK_HTML } from './ui.js';

export const VERSION = 'v3.12.0'; // minor: one palette, and eight of the eleven design fix-list tasks


export function html(body, title = 'TLC Admin', extraHead = '') {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="manifest" href="/site.webmanifest">
<link rel="icon" href="https://timothystl.org/favicon.ico" sizes="any">
<link rel="icon" href="https://timothystl.org/images/favicon-32x32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="https://timothystl.org/apple-touch-icon.png" sizes="180x180">
<meta name="theme-color" content="#12243D">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet">
${extraHead}
<style>
/* ── ONE PALETTE ──────────────────────────────────────────────────────────
   These names are the pre-redesign ones and are kept, because ~150 call sites
   across the worker and the gym module use them. What changed is what they
   point at: the Foundations values, so anything not explicitly restyled still
   comes out in the right scheme and the right typefaces rather than the old
   teal-and-orange one.

   The new --tlc-* tokens live in ADMIN_UI_CSS below. These are the bridge —
   not a second palette. */
:root{--steel:#1E2D4A;--amber:#C9973A;--sage:#4A5E3A;--warm:#FAF7F1;--linen:#F4EFE5;--mist:#E7EEF7;--border:#E7DFD1;--charcoal:#1A1A2A;--gray:#6A6858;--white:#fff;--sans:'Source Sans 3',Arial,sans-serif;--serif:'Lora',Georgia,serif;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:var(--sans);background:var(--warm);color:var(--charcoal);min-height:100vh;}
/* Full width under the header — a table constrained to 860px in a 1600px
   window was a symptom of the sidebar, not a choice. */
.wrap{max-width:none;margin-left:0;padding:20px 26px;}
.wrap-wide{max-width:none;margin-left:0;padding:20px 26px;}
.page-title{font:500 25px/1.15 var(--serif);color:#1E2D4A;margin-bottom:4px;}
.page-sub{font:400 13.5px/1.5 var(--sans);color:#6A6858;margin-bottom:24px;max-width:56em;text-wrap:pretty;}
.card{background:#FFFDF9;border:1px solid #E7DFD1;border-radius:12px;padding:18px 20px;margin-bottom:16px;}
.card-title{font:600 10.5px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:#8A8271;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #EFE7D9;}
.form-group{margin-bottom:18px;}
label{display:block;font:600 10.5px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:#8A8271;margin-bottom:6px;}
input[type=text],input[type=password],input[type=date],input[type=time],input[type=email],input[type=url],input[type=number],textarea,select{width:100%;background:#fff;border:1px solid #E7DFD1;border-radius:8px;padding:9px 11px;font-family:var(--sans);font-size:13.5px;color:var(--charcoal);outline:none;transition:border-color .15s,box-shadow .15s;}
input:focus,textarea:focus,select:focus{border-color:#2E7EA6;box-shadow:0 0 0 3px rgba(46,126,166,.15);}
textarea{min-height:100px;resize:vertical;line-height:1.65;}
.btn{display:inline-flex;align-items:center;gap:8px;font:600 13.5px/1 var(--sans);padding:10px 17px;border-radius:8px;border:1px solid transparent;cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s;}

.btn-primary{background:#1E2D4A;color:#F5E4C0;border-color:#1E2D4A;}
.btn-primary:hover{background:#2A3E62;border-color:#2A3E62;}
.btn-secondary{background:#FAF7F1;color:#1E2D4A;border-color:#E7DFD1;}
.btn-secondary:hover{border-color:#2E7EA6;}
.btn-sage{background:#FAF7F1;color:#1E2D4A;border-color:#E7DFD1;}
.btn-sage:hover{border-color:#2E7EA6;}
.btn-danger{background:transparent;color:#9A3B2E;border-color:transparent;}
.btn-danger:hover{background:#F7E4DE;}
.btn-sm{font-size:12.5px;padding:7px 13px;}
.btn-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;}
.event-block{background:#FAF7F1;border:1px solid #E7DFD1;border-radius:12px;padding:18px;margin-bottom:12px;position:relative;}
.event-block .event-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.event-block .remove-event{position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;color:var(--gray);font-size:18px;line-height:1;}
.event-block .remove-event:hover{color:#B85C3A;}
.add-event-btn{background:#FAF7F1;border:1px dashed #E7DFD1;border-radius:8px;padding:12px;width:100%;text-align:center;cursor:pointer;font:600 13px var(--sans);color:#2E7EA6;transition:background .15s,border-color .15s;}
.add-event-btn:hover{background:#F4EFE5;border-color:#2E7EA6;}
.alert{padding:13px 16px;border-radius:12px;border:1px solid;font:400 13.5px/1.55 var(--sans);margin-bottom:18px;}
.alert-success{background:#EDF0E4;border-color:#D8E0C6;color:#3F5424;}
.alert-error{background:#F7E4DE;border-color:#E4C8C8;color:#8C3A28;}
.alert-info{background:#E7EEF7;border-color:#D3DEEC;color:#1E2D4A;}
.newsletter-row{display:flex;align-items:center;gap:16px;padding:14px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.newsletter-row:last-child{border-bottom:none;}
.newsletter-date{font-family:var(--sans);font-size:11px;font-weight:700;color:var(--gray);min-width:100px;}
.newsletter-subject{font:500 16px/1.3 var(--serif);color:#1E2D4A;flex:1;}
.newsletter-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
.radio-row{display:flex;gap:16px;margin-top:6px;}
.radio-row label{font-family:var(--sans);font-size:13px;font-weight:600;color:var(--charcoal);letter-spacing:0;text-transform:none;display:flex;align-items:center;gap:6px;cursor:pointer;}
.radio-row input[type=radio]{width:auto;}
.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1E2D4A;}
.login-card{background:#FFFDF9;border-radius:12px;padding:36px 34px;width:100%;max-width:380px;text-align:center;box-shadow:0 18px 44px rgba(11,22,44,.28);}
.login-title{font:500 25px/1.2 var(--serif);color:#1E2D4A;margin-bottom:4px;}
.login-sub{font:400 13.5px/1.5 var(--sans);color:#6A6858;margin-bottom:26px;}
.login-card .form-group{text-align:left;}
.divider{border:none;border-top:1px solid var(--border);margin:24px 0;}
.tag{font:600 11px/1.6 var(--sans);padding:3px 10px;border-radius:999px;background:#EFE7D9;color:#6A6858;}
.preview-box{background:#F4EFE5;border:1px solid #E7DFD1;border-radius:12px;padding:20px;margin-top:16px;font-size:13px;color:var(--gray);font-style:italic;}
.ni-row{display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.ni-row:last-child{border-bottom:none;}
.ni-title{font:500 16px/1.3 var(--serif);color:#1E2D4A;flex:1;min-width:160px;}
.ni-meta{font-family:var(--sans);font-size:11px;color:var(--gray);white-space:nowrap;}
.ni-actions{display:flex;gap:8px;flex-shrink:0;}
.badge{font:600 11px/1.6 var(--sans);padding:3px 10px;border-radius:999px;white-space:nowrap;}
.badge-active{background:#EDF0E4;color:#3F5424;}
.badge-expired{background:#F7E4DE;color:#8C3A28;}
.badge-upcoming{background:#EFE7D9;color:#6A6858;}
.badge-pinned{background:#FAF0DC;color:#7A5B18;}
.checkbox-row{display:flex;align-items:center;gap:8px;margin-top:6px;}
.checkbox-row input[type=checkbox]{width:auto;}
.checkbox-row span{font-family:var(--sans);font-size:13px;font-weight:600;color:var(--charcoal);cursor:pointer;}
.format-picker{display:flex;gap:14px;margin-bottom:24px;flex-wrap:wrap;}
.format-card{flex:1;min-width:180px;border:1px solid #E7DFD1;border-radius:12px;padding:20px 18px;text-align:left;background:white;cursor:pointer;transition:border-color .18s,background .18s;}
.format-card:hover{border-color:#2E7EA6;background:#FAF7F1;}
.format-card.active{border:2px solid #1E2D4A;background:#E7EEF7;}
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
.pending-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#C9973A;margin-left:6px;vertical-align:middle;}

/* ── HEADER NAVIGATION ─────────────────────────────────────
   Spec: screens/00b-header-nav.html. This REPLACES the sidebar — there is no
   hamburger, no off-canvas state and no white util bar for sign-out. */
.tlc-nav{position:sticky;top:0;z-index:100;font-family:var(--tlc-sans);}
.tlc-nav-bar{display:flex;align-items:center;gap:14px;padding:0 18px;height:58px;background:#1E2D4A;color:#EDF2F7;}
.tlc-nav-brand{flex:none;display:flex;align-items:center;gap:10px;padding-right:16px;border-right:1px solid rgba(237,242,247,.18);text-decoration:none;}
.tlc-nav-mark{width:26px;height:26px;border-radius:8px;background:#C9973A;color:#1E2D4A;font:600 13px/26px var(--tlc-sans);text-align:center;flex:none;}
.tlc-nav-brand-text{display:flex;flex-direction:column;gap:1px;}
.tlc-nav-brand-name{font:600 13.5px/1.1 var(--tlc-sans);color:#FAF7F1;white-space:nowrap;}
.tlc-nav-brand-sub{font:700 9.5px/1 var(--tlc-sans);letter-spacing:.16em;text-transform:uppercase;color:#C9973A;white-space:nowrap;}
.tlc-nav-version{font-weight:400;letter-spacing:0;text-transform:none;color:#6B7F99;}
/* The group strip is the flexible child, so it is the one that runs short
   first — and it scrolls rather than wrapping, truncating, or hiding behind a
   "More". A chip cut mid-word is the failure this spec exists to prevent. */
.tlc-nav-groups{flex:1;min-width:0;display:flex;align-items:center;gap:3px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-ms-overflow-style:none;}
.tlc-nav-groups::-webkit-scrollbar{display:none;}
.tlc-nav-chip{flex:none;display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:9px;font:500 13.5px/1 var(--tlc-sans);color:#C6D0DC;text-decoration:none;white-space:nowrap;}
.tlc-nav-chip:hover{color:#FFFFFF;}
.tlc-nav-chip.is-on{font-weight:600;color:#FFFFFF;background:#27496E;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);}
.tlc-nav-dot{flex:none;width:7px;height:7px;border-radius:50%;background:#5A7191;}
.tlc-nav-chip.is-on .tlc-nav-dot{background:#E0A82E;}
.tlc-nav-badge{flex:none;padding:1px 7px;border-radius:999px;background:rgba(201,151,58,.22);color:#E8C070;font:700 10.5px/1.6 var(--tlc-sans);}
/* Never wraps — "Sign out" cannot break onto a second line inside a 58px bar. */
.tlc-nav-right{flex:none;display:flex;align-items:center;gap:10px;white-space:nowrap;}
.tlc-nav-right a{font:600 12.5px/1 var(--tlc-sans);color:#AFC0D2;text-decoration:none;white-space:nowrap;}
.tlc-nav-right a:hover{color:#FFFFFF;}
.tlc-nav-k{padding:7px 11px;border:1px solid rgba(196,206,223,.35);border-radius:8px;background:transparent;font:500 12.5px/1 var(--tlc-sans);color:#AFC0D2;cursor:pointer;white-space:nowrap;}
.tlc-nav-k:hover{color:#FFFFFF;border-color:rgba(196,206,223,.6);}
.tlc-nav-rule{width:1px;height:20px;background:rgba(237,242,247,.18);}
.tlc-nav-user{font:500 12.5px/1 var(--tlc-sans);color:#8598B0;white-space:nowrap;}
.tlc-nav-out{color:#C9973A !important;}
/* Row two — the sections of the selected group. The gold underline is the whole
   active treatment: no pill, no fill. */
.tlc-nav-sub{display:flex;align-items:center;gap:2px;padding:0 18px;height:44px;background:#FFFDF9;border-bottom:1px solid #E7DFD1;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;}
.tlc-nav-sub::-webkit-scrollbar{display:none;}
.tlc-nav-tab{flex:none;display:flex;align-items:center;gap:6px;padding:0 13px;height:44px;font:500 13.5px/44px var(--tlc-sans);color:#6A6858;text-decoration:none;white-space:nowrap;}
.tlc-nav-tab:hover{color:#1E2D4A;}
.tlc-nav-tab.is-on{font-weight:600;color:#1E2D4A;box-shadow:inset 0 -2px 0 #C9973A;}
.tlc-nav-tabbadge{padding:1px 7px;border-radius:999px;background:#FAF0DC;color:#7A5B18;font:700 10.5px/1.6 var(--tlc-sans);}
/* The per-screen back-links that used to live in the util bar. */
.tlc-nav-back{padding:16px 26px 0;display:flex;gap:16px;flex-wrap:wrap;}
.tlc-nav-back a{font:600 13px/1 var(--tlc-sans);color:#2E7EA6;text-decoration:none;}
.tlc-nav-back a:hover{text-decoration:underline;}
/* Below 820px — a phone held sideways, the only place six chips genuinely
   cannot be reached by a short swipe — the labels drop and the chips become
   their dots. The ACTIVE chip keeps its label, so you can always see where you
   are. The label survives as the title attribute. */
@media (max-width:820px){
  .tlc-nav-chip{padding:8px 0;width:30px;justify-content:center;}
  .tlc-nav-chip .tlc-nav-chip-label{display:none;}
  .tlc-nav-chip.is-on{width:auto;padding:8px 13px;}
  .tlc-nav-chip.is-on .tlc-nav-chip-label{display:inline;}
  .tlc-nav-bar{gap:10px;padding:0 12px;}
  .tlc-nav-brand{padding-right:12px;}
  .tlc-nav-brand-text{display:none;}
  .tlc-nav-right a:not(.tlc-nav-out){display:none;}
  .tlc-nav-back{padding:14px 16px 0;}
}
@media (max-width:880px){
  .wrap{padding:20px 16px;}
  .wrap-wide{padding:20px 16px;}
}
/* ── DASHBOARD ─────────────────────────────────────────────── */
.dash-header{font-family:var(--serif);font-size:24px;color:var(--steel);}
.dash-sub{font-family:var(--sans);font-size:13px;color:var(--gray);margin-top:2px;}
.dash-avatar{width:40px;height:40px;border-radius:50%;background:var(--mist);color:var(--steel);display:flex;align-items:center;justify-content:center;font-family:var(--sans);font-weight:700;font-size:14px;flex-shrink:0;}
.stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:20px 0;}
@media (max-width:880px){.stat-row{grid-template-columns:repeat(2,1fr);}}
.stat-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:18px 20px;}
.stat-label{font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gray);}
.stat-num{font-family:var(--serif);font-size:30px;margin-top:4px;line-height:1;}
.stat-note{font-family:var(--sans);font-size:12px;color:var(--gray);margin-top:6px;}
.dash-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:20px;align-items:start;}
@media (max-width:960px){.dash-grid{grid-template-columns:1fr;}}
.attn-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);}
.attn-row:last-child{border-bottom:none;}
.attn-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.attn-title{font-family:var(--serif);font-size:14px;color:var(--charcoal);flex:1;}
.attn-meta{font-family:var(--sans);font-size:11px;color:var(--gray);display:block;margin-top:2px;}
.activity-row{padding:10px 0;border-bottom:1px solid var(--border);font-family:var(--sans);font-size:13px;color:var(--charcoal);}
.activity-row:last-child{border-bottom:none;}
.activity-time{display:block;font-size:11px;color:var(--gray);margin-top:2px;}
.icon-tile{width:44px;height:44px;border-radius:12px;background:var(--mist);color:var(--steel);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}
.badge-expiring{background:#FFF3D6;color:#7A4F00;}
.count-pill{font-family:var(--sans);font-size:12px;color:var(--gray);}
.filter-pill{font-family:var(--sans);font-size:12px;font-weight:700;color:var(--gray);background:var(--linen);border:1px solid var(--border);border-radius:999px;padding:6px 14px;cursor:pointer;}
.filter-pill.active{background:var(--steel);color:#fff;border-color:var(--steel);}
${ADMIN_UI_CSS}
${MENU_CSS}
${PRESET_CSS}
${GYM_CAL_CSS}
${PANEL_LIST_CSS}
${NEWSLETTER_CSS}
${TOAST_CSS}
${CMDK_CSS}
</style>
</head>
<body>${body}
<script>
function toggleSchedule(id){var row=document.getElementById('sched-row-'+id);if(row)row.style.display=row.style.display==='none'?'':'none';}
// Converts the datetime-local field to an ISO instant using the browser's own
// timezone before submit — the Worker runs in UTC, so it can't reliably turn
// a bare "2026-07-20T09:00" string back into the office's actual local time.
function prepSchedule(form){
  var input = form.querySelector('input[type=datetime-local]');
  var hidden = form.querySelector('input[name=scheduled_at]');
  if (!input || !input.value) return false;
  var d = new Date(input.value);
  if (isNaN(d.getTime()) || d.getTime() <= Date.now()) { alert('Pick a valid date/time in the future.'); return false; }
  hidden.value = d.toISOString();
  return confirm('Schedule this newsletter to send via Brevo?');
}
${LIST_SECTION_JS}
${PANEL_LIST_JS}
${TOGGLE_WORD_JS}
${TOAST_JS}
${CMDK_JS}
</script>
</body>
</html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=10',
      // The whole admin is behind a session, so a crawler cannot reach these
      // anyway — but /payroll used to carry this header itself and folding it
      // into the shared shell would otherwise have quietly dropped it.
      'X-Robots-Tag': 'noindex, nofollow',
      // fonts.googleapis.com serves the Lora / Source Sans 3 stylesheet and
      // fonts.gstatic.com the font files themselves — the redesign's type
      // system needs both, and a blocked font silently falls back to Georgia.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.tiny.cloud 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.tiny.cloud https://fonts.googleapis.com; font-src 'self' https://cdn.tiny.cloud https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://cdn.tiny.cloud; frame-src 'self' https://cdn.tiny.cloud;"
    }
  });
}

// ── SIDEBAR SHELL ─────────────────────────────────────────────
// Left sidebar navigation (grouped by task area) + a slim utility bar for
// per-page back-links / external-view links + sign out. Replaces the old
// horizontal topbarHtml() tab strip.
// pendingCount: number of newsletters awaiting approval (shown as a dot on the News & Events item)
// badges: counts of things needing a human — the same numbers the Dashboard
// shows, so the sidebar and the worklist can never disagree. Pass
// { gym, pages, newsletter }; a bare number is read as the newsletter count so
// the pre-redesign call sites keep working.
// ── HEADER NAVIGATION ────────────────────────────────────────
// Spec: screens/00b-header-nav.html, which supersedes Foundations' sidebar.
//
// This REPLACES the navy sidebar rather than sitting on top of it. In the build
// the sidebar had become `position:fixed; translateX(-100%)` behind a hamburger
// in a white util bar — off-canvas on every screen, with all the correct
// styling underneath invisible until somebody found the toggle. The editors
// already wore a bar; extending it to the rest means one piece of chrome across
// the whole product and gives the content area back the 228px.
//
// The permission logic, group order, group membership and badge rules are the
// sidebar's, unchanged. Only the geometry moved.
//
// Two rows:
//   1. 58px navy — brand, group chips, and the right cluster (⌘K, View site,
//      username, Sign out). Never scrolls away. Identical on every screen.
//   2. 44px parchment — the sections of the SELECTED group only. Hidden
//      entirely when that group has one section, so Dashboard shows no row two.
export function headerNav(activeTab, user, extraLinks = '', badges = {}) {
  const hp = (p) => hasPermission(user, p);
  const b = typeof badges === 'number' ? { newsletter: badges } : (badges || {});

  // A badge is only shown to somebody who can act on it. Telling a ministry
  // leader that three gym requests are waiting is noise they cannot clear.
  const at = (n, canSee) => (n > 0 && canSee) ? n : 0;

  // One declaration per section: the tab, where it goes, who may see it, and
  // what number rides on it. The chips, the tabs and the group badges are all
  // derived from this, so a section cannot appear in one and not the other.
  const GROUPS = [
    { key: 'dash', label: 'Dashboard', items: [
      { tab: 'dashboard', label: 'Dashboard', href: '/dashboard', can: true },
    ] },
    { key: 'web', label: 'Website', items: [
      { tab: 'pages', label: 'Pages', href: '/pages', can: hp('pages_edit') || hp('pages_edit_own'),
        badge: at(b.pages, hp('pages_edit') || hp('pages_edit_own')),
        title: `${b.pages} page(s) with unpublished edits` },
      // Ministries, Partners, News, Sermons and Christian Ed are ordinary tabs
      // after Pages now. The sidebar drew the parent/child relationship with an
      // elbow; here adjacency is enough, and the spec says so outright.
      { tab: 'ministries', label: 'Ministries', href: '/ministries', can: hp('ministries_edit') },
      { tab: 'partners', label: 'Partners', href: '/partners', can: hp('pages_edit') },
      { tab: 'news', label: 'News &amp; Events', href: '/newsitems', can: hp('news_edit') },
      { tab: 'sermons', label: 'Sermons', href: '/sermons', can: hp('sermons_edit') },
      { tab: 'christian-education', label: 'Christian Ed', href: '/christian-education', can: hp('news_edit') },
      { tab: 'menu', label: 'Menu', href: '/menu', can: hp('pages_edit') },
      { tab: 'notices', label: 'Notices', href: '/notices', can: hp('notices_edit') },
      { tab: 'link-cards', label: 'NFC Taps', href: '/link-cards', can: hp('links_edit') },
      { tab: 'redirects', label: 'Redirects', href: '/redirects', can: hp('settings_manage') },
    ] },
    { key: 'email', label: 'Email', items: [
      { tab: 'newsletter', label: 'Newsletter', href: '/newsletters', can: hp('newsletter_edit') || hp('newsletter_approve'),
        badge: at(b.newsletter, hp('newsletter_approve')),
        title: `${b.newsletter} newsletter(s) awaiting approval` },
      { tab: 'subscribers', label: 'Subscribers', href: '/subscribers', can: hp('settings_manage') },
      // Not in the design's nav — it shipped after the handoff. It is mail held
      // back from the office inbox, so this is where somebody looks for it.
      { tab: 'filtered', label: 'Filtered Mail', href: '/filtered', can: hp('settings_manage') },
    ] },
    { key: 'money', label: 'Money &amp; Building', items: [
      { tab: 'giving', label: 'Giving', href: '/giving', can: hp('giving_manage') },
      { tab: 'gym', label: 'Gym Rentals', href: '/gym-rentals', can: hp('gym_manage'),
        badge: at(b.gym, hp('gym_manage')), title: `${b.gym} gym request(s) waiting for review` },
      { tab: 'payroll', label: 'Payroll', href: '/payroll', can: hp('payroll_manage') },
    ] },
    { key: 'people', label: 'People &amp; Access', items: [
      { tab: 'staff', label: 'Staff', href: '/staff', can: hp('staff_edit') },
      { tab: 'users', label: 'Users', href: '/users', can: hp('users_manage') },
      { tab: 'audit', label: 'Audit Log', href: '/audit-log', can: hp('audit_view') },
    ] },
    { key: 'setup', label: 'Setup', items: [
      { tab: 'media', label: 'Media', href: '/media', can: hp('pages_edit') || hp('ministries_edit') },
      { tab: 'settings', label: 'Settings', href: '/settings', can: hp('settings_manage') },
    ] },
  ];

  // A group the user has no permission for is not rendered at all — permissions
  // hide whole groups, exactly as before.
  const visible = GROUPS
    .map((g) => Object.assign({}, g, { items: g.items.filter((i) => i.can) }))
    .filter((g) => g.items.length);

  const active = visible.find((g) => g.items.some((i) => i.tab === activeTab)) || visible[0];
  const sections = active ? active.items : [];

  const groupBadge = (g) => g.items.reduce((n, i) => n + (i.badge || 0), 0);

  const chips = visible.map((g) => {
    const on = active && g.key === active.key;
    const n = groupBadge(g);
    // A chip is a link to the group's first section, not a menu that opens.
    return `<a class="tlc-nav-chip${on ? ' is-on' : ''}" href="${g.items[0].href}" title="${g.label.replace(/&amp;/g, '&')}">`
      + `<span class="tlc-nav-dot" aria-hidden="true"></span>`
      + `<span class="tlc-nav-chip-label">${g.label}</span>`
      + (n ? `<span class="tlc-nav-badge">${n}</span>` : '')
      + `</a>`;
  }).join('');

  const tabs = sections.map((i) => {
    const on = i.tab === activeTab;
    return `<a class="tlc-nav-tab${on ? ' is-on' : ''}" href="${i.href}"${on ? ' aria-current="page"' : ''}>${i.label}`
      + (i.badge ? `<span class="tlc-nav-tabbadge" title="${escapeHtml(i.title || '')}">${i.badge}</span>` : '')
      + `</a>`;
  }).join('');

  return `<header class="tlc-nav">
  <div class="tlc-nav-bar">
    <a class="tlc-nav-brand" href="/dashboard">
      <span class="tlc-nav-mark" aria-hidden="true">T</span>
      <span class="tlc-nav-brand-text">
        <span class="tlc-nav-brand-name">Timothy Lutheran</span>
        <span class="tlc-nav-brand-sub">Admin <span class="tlc-nav-version">${VERSION}</span></span>
      </span>
    </a>
    <nav class="tlc-nav-groups" id="tlc-nav-groups" aria-label="Sections">${chips}</nav>
    <div class="tlc-nav-right">
      <button type="button" class="tlc-nav-k" id="tlc-k-open">⌘K</button>
      <a href="https://timothystl.org" target="_blank" rel="noopener">View site ↗</a>
      <a href="https://connect.timothystl.org" target="_blank" rel="noopener">Connect ↗</a>
      <span class="tlc-nav-rule" aria-hidden="true"></span>
      <span class="tlc-nav-user">${user ? escapeHtml(user.username) : ''}</span>
      <a class="tlc-nav-out" href="/logout">Sign out</a>
    </div>
  </div>
  ${sections.length > 1 ? `<nav class="tlc-nav-sub" id="tlc-nav-sub" aria-label="${(active && active.label.replace(/&amp;/g, '&')) || ''}">${tabs}</nav>` : ''}
</header>
${extraLinks ? `<div class="tlc-nav-back">${extraLinks}</div>` : ''}
${CMDK_HTML}
<script>(function(){
  // Selecting a group scrolls it into view — on a narrow window the active chip
  // can otherwise be off the end of a strip that gives no sign it scrolls.
  for (var id of ['tlc-nav-groups','tlc-nav-sub']) {
    var el = document.getElementById(id); if (!el) continue;
    var on = el.querySelector('.is-on'); if (!on) continue;
    var off = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
    if (el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, off);
  }
})();</script>`;
}

// ── LOGIN PAGE ───────────────────────────────────────────────
export function loginPage(error = '', success = '') {
  return html(`
<div class="login-wrap">
  <div class="login-card">
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;">Timothy Lutheran Church</div>
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
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;">Timothy Lutheran Church</div>
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
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;">Timothy Lutheran Church</div>
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
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;">Timothy Lutheran Church</div>
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
      <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px;">Create admin account</button>
    </form>
  </div>
</div>`, 'TLC Admin — Setup');
}

// ── PERMISSION CHECKBOXES ─────────────────────────────────────
// The checkboxes are the truth; the presets above them are shortcuts that tick
// a set of them. Each row prints its permission key in monospace so this screen
// and the code that gates on it are using the same word — which is the point of
// having renamed them all in v3.0.0.
export function permissionCheckboxes(selectedPerms = []) {
  const selected = Array.isArray(selectedPerms) ? selectedPerms : JSON.parse(selectedPerms || '[]');
  const presets = Object.entries(PERMISSION_PRESETS).map(([name, keys]) =>
    `<button type="button" class="tlc-preset" data-perms="${escapeHtml(JSON.stringify(keys))}">${escapeHtml(name)}</button>`
  ).join('');
  const rows = Object.entries(PERMISSIONS).map(([key, label]) =>
    `<label class="tlc-perm">
      <input type="checkbox" id="perm_${key}" name="perm_${key}" value="1"${selected.includes(key) ? ' checked' : ''}>
      <span class="tlc-perm-name">${escapeHtml(label)}</span>
      <code class="tlc-perm-key">${escapeHtml(key)}</code>
    </label>`
  ).join('');
  return `<div class="tlc-presets" id="perm-presets">${presets}</div>
<div class="tlc-perms" id="perm-list">${rows}</div>
<script>(function(){
  var wrap = document.getElementById('perm-presets');
  var list = document.getElementById('perm-list');
  if (!wrap || !list) return;
  wrap.addEventListener('click', function (e) {
    var btn = e.target.closest('.tlc-preset');
    if (!btn) return;
    var want;
    try { want = JSON.parse(btn.getAttribute('data-perms')); } catch (_) { return; }
    // A preset sets the boxes and nothing else — it grants nothing the list
    // does not then show, which is what keeps the checkboxes the truth.
    list.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      cb.checked = want.indexOf(cb.id.replace(/^perm_/, '')) > -1;
    });
  });
})();<\/script>`;
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

// ── ONE RICH-TEXT FIELD BUILDER ──────────────────────────────
// There used to be seven near-identical copies of this, ~500 lines of them.
// That was AC-10 in the July 2026 review, and the reason it mattered is
// AC-3, which sat unfixed underneath it: the content is interpolated into an
// inline <script>, and every copy escaped backslash, backtick and $ — but not
// `</script>`.
//
// ⚠ The HTML parser ends a script block at the first `</script` REGARDLESS of
// JavaScript string context. Somebody with content-edit rights could save a
// post containing it, break out of the init block, and run script in the
// session of any admin who later opened that screen. Escaping it in one place
// is the whole point of there being one place.
function jsString(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    // Split the closing tag so the parser never sees it. The string still
    // reads as "</script>" once JavaScript joins it back up.
    .replace(/<\/(script)/gi, '<\\/$1');
}

// Every rich-text field in the admin comes from here. The toolbar is the same
// on all of them — the design's own note is "painted on all of them, not just
// the first", because a field that looks like a plain textarea gets typed into
// like one.
const TINY_TOOLBAR = 'undo redo | blocks | bold italic underline | alignleft aligncenter alignright | bullist numlist | link image | table | code';

export function tinymceField({ id, name, value = '', minHeight = 200, label = '', labelNote = '', wrap = true }) {
  const field = `<textarea id="${escapeHtml(id)}" name="${escapeHtml(name)}"></textarea>`;
  const head = label
    ? `<label>${escapeHtml(label)}${labelNote ? ` <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">${escapeHtml(labelNote)}</span>` : ''}</label>`
    : '';
  const body = wrap ? `<div class="form-group">\n  ${head}\n  ${field}\n</div>` : field;
  return `${body}
<script>
_onTinymce(function(){
tinymce.init({
  selector: '#${id}',
  plugins: 'image link lists blockquote table code',
  toolbar: '${TINY_TOOLBAR}',
  menubar: false,
  min_height: ${Number(minHeight) || 200},
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
    var initial = \`${jsString(value)}\`;
    if (initial.trim()) { editor.setContent(initial); editor.save(); }
  }
});

// Submitting has to wait for images still uploading, or a pasted photo goes
// out as a blob: reference that resolves to nothing in an inbox. Wired once
// per page however many editors are on it — the flag is on window, not on the
// field, because the handler is on the form.
if (!window._tlcSubmitWired) {
  window._tlcSubmitWired = true;
  var f = document.querySelector('form');
  if (f) f.addEventListener('submit', function(e) {
    if (window._tlcSubmitting) return;
    var eds = window.tinymce ? tinymce.editors : [];
    if (!eds.length) return;
    e.preventDefault();
    window._tlcSubmitting = true;
    var form = e.target;
    var submitter = e.submitter;
    // A submit button's own name/value is lost when the form is submitted
    // programmatically, and several screens branch on it (Publish vs Save as
    // draft), so it is carried across by hand.
    if (submitter && submitter.name) {
      var hid = document.createElement('input');
      hid.type = 'hidden';
      hid.name = submitter.name;
      hid.value = submitter.value;
      form.appendChild(hid);
    }
    var done = function() {
      eds.forEach(function(ed) { ed.save(); });
      // Strip any blob: image that failed to upload — it would render as a
      // broken icon in the sent email.
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
});
<\/script>`;
}

// The seven call sites, each now one line. Kept as named functions rather than
// inlined so the routes do not have to know the id and name of every field.
export const tinymceEditorSection = (v = '') => tinymceField({ id: 'body-editor', name: 'body', value: v, minHeight: 260, label: 'Full text', labelNote: '— optional, shown when reader clicks "Read more"' });
export const tinymcePostSection = (v = '') => tinymceField({ id: 'post-editor', name: 'body', value: v, minHeight: 260, label: 'Post content' });
export const tinymceSermonSection = (v = '') => tinymceField({ id: 'sermon-editor', name: 'outline', value: v, minHeight: 260, label: 'Notes / outline' });
export const tinymceYouthSection = (v = '') => tinymceField({ id: 'youth-editor', name: 'content', value: v, minHeight: 320, label: 'Page content' });
export const tinymcePageSection = (v = '') => tinymceField({ id: 'page-editor', name: 'content', value: v, minHeight: 320, label: 'Block content' });
export const tinymcePastorSection = (v = '') => tinymceField({ id: 'pastor-editor', name: 'pastor_note', value: v, minHeight: 200, label: 'Your message this week' });
export const tinymceNoteSection = (id, name, v = '', minHeight = 140) => tinymceField({ id, name, value: v, minHeight, wrap: false });
