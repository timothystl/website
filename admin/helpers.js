// ── HELPERS, TINYMCE, TOPBAR, LOGIN ─────────────────────────
// Extracted from tlc-admin-worker.js

import { TINYMCE_API_KEY, TINYMCE_HEAD } from './db.js';
import { PERMISSIONS, PERMISSION_PRESETS, hasPermission } from './auth.js';
import { ADMIN_UI_CSS, LIST_SECTION_JS, MENU_CSS, PRESET_CSS, GYM_CAL_CSS, PANEL_LIST_CSS, NEWSLETTER_CSS, PANEL_LIST_JS, SIDEBAR_JS, TOGGLE_WORD_JS, TOAST_CSS, TOAST_JS, CMDK_CSS, CMDK_JS, CMDK_HTML } from './ui.js';

export const VERSION = 'v4.3.1'; // minor: the sidebar folds under Pages, and the dead slide-over is gone


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

/* ── THE SHELL: SIDEBAR + CONTEXT BAR ──────────────────────
   Spec: screens/00b-header-nav.html (revised).

   ⚠ The sidebar STAYS. Twenty-one sections in five groups is more than a
   horizontal bar can hold honestly, and a list you read top to bottom beats
   chips you have to scroll. What the build got wrong was never the sidebar —
   it was hiding it behind a hamburger. So there is no off-canvas transform,
   no .is-open, no backdrop and no toggle: it is simply on screen, and the
   content sits BESIDE it rather than under it.

   Above the content, a slim context bar — the one good idea from the editor's
   top bar, kept and cut down. It reports; it does not navigate. */
body{padding-left:228px;}
.sidebar{position:fixed;top:0;left:0;width:228px;height:100vh;background:var(--steel);
  display:flex;flex-direction:column;overflow-y:auto;z-index:100;}
.sidebar-brand{padding:20px 20px 18px;border-bottom:1px solid rgba(255,255,255,.12);margin-bottom:8px;flex-shrink:0;}
.sidebar-brand-name{font-family:var(--sans);font-size:14px;font-weight:800;color:#fff;}
.sidebar-brand-sub{font-family:var(--sans);font-size:11px;color:var(--amber);font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-top:2px;}
.sidebar-user{padding:0 20px 8px;font-family:var(--sans);font-size:11px;color:rgba(255,255,255,.55);}
.sidebar-group{padding:8px 0 12px;}
.sidebar-group-label{font-family:var(--sans);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.4);padding:4px 20px 6px 23px;}
.sidebar-item{display:flex;align-items:center;gap:10px;padding:9px 20px 9px 23px;color:rgba(255,255,255,.78);font-size:13px;font-weight:600;text-decoration:none;}
.sidebar-item:hover{color:#fff;background:rgba(255,255,255,.06);}
.sidebar-dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.35);flex-shrink:0;}
.sidebar-groups{flex:1;min-height:0;}
.sidebar-footer{margin-top:auto;padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;gap:8px;flex-shrink:0;}
.sidebar-footer a{font-family:var(--sans);color:rgba(255,255,255,.6);font-size:12px;font-weight:600;text-decoration:none;}
.sidebar-footer a:hover{color:#fff;}

/* ── THE CONTEXT BAR ───────────────────────────────────────
   46px, the same navy as the sidebar so the two read as one shell, and it sits
   above the CONTENT COLUMN only — it starts where the sidebar ends.

   ⚠ It is not navigation. No tabs, no chips, no menus, and the crumbs are not
   links. Its whole job is to say where you are and to keep the two things you
   reach for from any screen one click away. */
.tlc-ctx{display:flex;align-items:center;gap:14px;height:46px;padding:0 26px;background:#1E2D4A;
  color:#EDF2F7;position:sticky;top:0;z-index:90;}
.tlc-ctx-trail{flex:1;min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden;}
.tlc-ctx-group{font:500 12.5px/1 var(--tlc-sans);color:#8598B0;white-space:nowrap;}
.tlc-ctx-sep{font:400 12.5px/1 var(--tlc-sans);color:#4E6180;}
.tlc-ctx-section{font:600 13.5px/1 var(--tlc-sans);color:#FFFFFF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tlc-ctx-wait{flex:none;padding:1px 9px;border-radius:999px;background:rgba(201,151,58,.22);color:#E8C070;
  font:700 10.5px/1.7 var(--tlc-sans);white-space:nowrap;}
.tlc-ctx-right{flex:none;display:flex;align-items:center;gap:12px;white-space:nowrap;}
.tlc-ctx-right a{font:600 12.5px/1 var(--tlc-sans);color:#AFC0D2;text-decoration:none;white-space:nowrap;}
.tlc-ctx-right a:hover{color:#FFFFFF;}
.tlc-ctx-k{padding:6px 11px;border:1px solid rgba(196,206,223,.35);border-radius:8px;background:transparent;
  font:500 12.5px/1 var(--tlc-sans);color:#AFC0D2;cursor:pointer;white-space:nowrap;}
.tlc-ctx-k:hover{color:#FFFFFF;border-color:rgba(196,206,223,.6);}
/* The per-screen back-links. They go in the content area, above the h1 — not
   in the context bar, which reports rather than navigates. */
.tlc-nav-back{padding:16px 26px 0;display:flex;gap:16px;flex-wrap:wrap;}
.tlc-nav-back a{font:600 13px/1 var(--tlc-sans);color:#2E7EA6;text-decoration:none;}
.tlc-nav-back a:hover{text-decoration:underline;}

/* The ONLY responsive rule for the sidebar: below 900px a phone cannot spare
   228px BESIDE the content, so the sidebar stops being fixed and sits above it
   instead — scrolled past like anything else on the page.

   ⚠ It is never hidden. There was a slide-over here, off-canvas behind a
   hamburger; the fix list asks for exactly that to be gone, and the hamburger
   had no handler wired to it anyway, so on a phone the admin had NO navigation
   at all. Restoring the button would have been fixing the symptom of a
   pattern the design had already rejected. */
@media (max-width:900px){
  body{padding-left:0;}
  .sidebar{position:static;width:100%;height:auto;}
  .sidebar-groups{display:flex;flex-wrap:wrap;gap:0 10px;}
  .sidebar-group{flex:1 1 150px;}
  .tlc-ctx{padding:0 16px;}
  .wrap,.wrap-wide{padding:20px 16px;}
  .tlc-nav-back{padding:14px 16px 0;}
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
/* ── THE SIDEBAR ───────────────────────────────────────────────
   Straight from the Foundations spec, down to the numbers: 228px, its own
   scroll, identical on every screen — only the active row changes. The active
   row is RAISED (a lighter navy plus a hairline inset), not recoloured with a
   gold bar; that was mine. */
.sidebar{background:var(--tlc-sidebar);width:228px;font-family:var(--tlc-sans);}
.sidebar-brand{padding:16px 18px 14px;border-bottom:1px solid rgba(237,242,247,.12);margin-bottom:0;}
.sidebar-brand-name{font:600 16px/1.2 var(--tlc-sans);color:#FAF7F1;}
.sidebar-brand-sub{font:700 11.5px/1 var(--tlc-sans);color:var(--tlc-gold);letter-spacing:.16em;text-transform:uppercase;margin-top:5px;}
.sidebar-version{font:400 11px/1 var(--tlc-sans);color:#6B7F99;text-transform:none;letter-spacing:0;margin-left:6px;}
.sidebar-user{padding:10px 18px;font-size:12.5px;color:#8598B0;border-bottom:1px solid rgba(237,242,247,.12);}
.sidebar-group{padding:8px 0 4px;}
.sidebar-group-label{font:700 10.5px/1 var(--tlc-sans);letter-spacing:.14em;text-transform:uppercase;color:var(--tlc-gold-label);padding:8px 18px 8px 20px;}
.sidebar-item{display:flex;align-items:center;gap:11px;margin:1px 8px;padding:9px 12px;border-radius:9px;color:var(--tlc-nav-label);font:500 13.5px/1.35 var(--tlc-sans);text-decoration:none;}
.sidebar-item:hover{color:#fff;background:rgba(255,255,255,.06);}
.sidebar-label{flex:1;min-width:0;}
.sidebar-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--tlc-nav-dot);}
/* A child row's marker is an elbow, not a circle — it draws the relationship
   rather than asserting it with indentation alone. */
.sidebar-tick{flex:none;width:7px;height:7px;border-radius:0 0 0 3px;border-left:1px solid var(--tlc-nav-dot);border-bottom:1px solid var(--tlc-nav-dot);background:transparent;font-size:0;line-height:0;}
.sidebar-item-child{padding-left:26px;}
/* Folded away unless you are inside it. The [hidden] rule is restated because
   this element carries a display of its own, which would otherwise win. */
.sidebar-children{display:block;}
.sidebar-children[hidden]{display:none;}
/* The caret is a hit area inside the row, not the row. It stays quiet until
   the row is hovered or it has focus — it is a second action on a row whose
   first action is the one people want. */
.sidebar-caret{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:20px;margin:-4px -4px -4px 0;padding:0;border:0;border-radius:8px;background:transparent;color:var(--tlc-nav-dot);font:400 15px/1 var(--tlc-sans);cursor:pointer;transition:transform .15s,background .15s,color .15s;}
.sidebar-caret span{display:block;transition:transform .15s;}
.sidebar-caret[aria-expanded="true"] span{transform:rotate(90deg);}
.sidebar-item:hover .sidebar-caret,.sidebar-caret:focus-visible{color:#fff;background:rgba(255,255,255,.12);}
.sidebar-caret:focus-visible{outline:2px solid var(--tlc-gold-bright);outline-offset:1px;}
.sidebar-item-active .sidebar-caret{color:#fff;}
.sidebar-item-active{background:var(--tlc-nav-raised);color:#FFFFFF;font-weight:600;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);}
.sidebar-item-active .sidebar-dot{background:var(--tlc-gold-bright);}
.sidebar-item-active .sidebar-tick{border-color:var(--tlc-gold-bright);}
.sidebar-badge{flex:none;padding:1px 7px;border-radius:999px;background:rgba(201,151,58,.22);color:#E8C070;font:700 10.5px/1.6 var(--tlc-sans);}
.sidebar-footer{border-top:1px solid rgba(237,242,247,.12);}
.sidebar-footer a{font-size:11.5px;color:#8397AF;}
.sidebar-footer a:last-child{font-size:12.5px;color:var(--tlc-gold);}
.sidebar-signout{color:var(--tlc-gold) !important;}
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
${SIDEBAR_JS}
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

// A group is named in TWO places — the sidebar heading and the context bar's
// trail — so the name lives here rather than being typed at each. Otherwise
// they can say different things about the same group, which is exactly the
// drift the trail exists to prevent.
//
// "Communication" rather than the mockups' "Email" is Andrew's call
// (2026-08-02): the group holds the newsletter, the subscriber list and held
// mail, which is more than the word Email covers. The other four are the
// design's own.
//
// ⚠ Stored RAW, escaped at both render sites. The trail already ran the name
// through escapeHtml while the sidebar had `&amp;` typed into its markup — one
// constant holding the entity would have printed "Money &amp;amp; Building"
// in the context bar.
export const GROUPS = {
  website: 'Website',
  email: 'Communication',
  money: 'Money & Building',
  people: 'People & Access',
  setup: 'Setup',
};

// ── SIDEBAR SHELL ─────────────────────────────────────────────
// Left sidebar navigation (grouped by task area) + a slim utility bar for
// per-page back-links / external-view links + sign out. Replaces the old
// horizontal topbarHtml() tab strip.
// pendingCount: number of newsletters awaiting approval (shown as a dot on the News & Events item)
// badges: counts of things needing a human — the same numbers the Dashboard
// shows, so the sidebar and the worklist can never disagree. Pass
// { gym, pages, newsletter }; a bare number is read as the newsletter count so
// the pre-redesign call sites keep working.
export function sidebarShell(activeTab, user, extraLinks = '', badges = {}) {
  const hp = (p) => hasPermission(user, p);
  const b = typeof badges === 'number' ? { newsletter: badges } : (badges || {});

  // A badge is only shown to somebody who can act on it. Telling a ministry
  // leader that three gym requests are waiting is noise they cannot clear.
  const badge = (n, canSee, title) => (n > 0 && canSee)
    ? `<span class="sidebar-badge" title="${escapeHtml(title)}">${n}</span>` : '';

  const navItem = (href, label, active, extra = '', depth = 0) =>
    `<a href="${href}" class="sidebar-item${active ? ' sidebar-item-active' : ''}${depth ? ' sidebar-item-child' : ''}">`
    + (depth ? `<span class="sidebar-tick" aria-hidden="true">└</span>` : `<span class="sidebar-dot"></span>`)
    + `<span class="sidebar-label">${label}</span>${extra}</a>`;

  // The disclosure control for a row that has children. It is a BUTTON beside
  // the link, not the row itself: the row is a real destination — Pages is a
  // screen somebody wants to open — and making it double as a toggle would
  // mean one of the two things you can want from it is unreachable.
  const navCaret = (id, open) =>
    `<button type="button" class="sidebar-caret" data-children="${id}" aria-expanded="${open}"`
    + ` aria-controls="${id}" title="Show or hide what is under this"><span aria-hidden="true">›</span></button>`;

  // ── THE FIVE GROUPS ──
  // Order, grouping and nesting are the design's `NAV` and `CHILD_OF`, kept in
  // that order deliberately: it groups by *what you came here to do* — put
  // something on the website, send an email, deal with money, manage people,
  // set the place up — rather than by which table the data lives in. Ministries,
  // Partners, News, Sermons and Christian Ed nest under Pages because that is
  // what they produce; they are separate only because different people own them.
  const showNews = hp('news_edit');
  const pagesChildren = [
    hp('ministries_edit') ? navItem('/ministries', 'Ministries', activeTab === 'ministries', '', 1) : '',
    hp('pages_edit')      ? navItem('/partners', 'Partners', activeTab === 'partners', '', 1) : '',
    showNews              ? navItem('/newsitems', 'News &amp; Events', activeTab === 'news', '', 1) : '',
    hp('sermons_edit')    ? navItem('/sermons', 'Sermons', activeTab === 'sermons', '', 1) : '',
    hp('news_edit')       ? navItem('/christian-education', 'Christian Ed', activeTab === 'christian-education', '', 1) : '',
  ].filter(Boolean).join('');

  // Open when you are somewhere inside it, folded away otherwise. Five rows
  // permanently under Pages pushed everything below them down the sidebar and
  // read as one flat list of ten, which is the opposite of what nesting them
  // was for. The state is decided server-side so the sidebar is never drawn
  // in the wrong shape and then corrected — a nav that moves after paint is
  // a nav you cannot click confidently.
  const PAGES_CHILD_TABS = ['ministries', 'partners', 'news', 'sermons', 'christian-education'];
  const inPages = activeTab === 'pages' || PAGES_CHILD_TABS.includes(activeTab);

  const canPages = hp('pages_edit') || hp('pages_edit_own');
  const websiteItems = [
    canPages ? navItem('/pages', 'Pages', activeTab === 'pages',
      badge(b.pages, canPages, `${b.pages} page(s) with unpublished edits`)
      + (pagesChildren ? navCaret('sidebar-under-pages', inPages) : '')) : '',
    // ⚠ `hidden` is restated in CSS. `.sidebar-children` needs a display of
    // its own, and an explicit display beats the UA's `[hidden]{display:none}`
    // — the same trap that once left an empty state sitting under a full
    // table. Without the restatement this panel never closes.
    pagesChildren ? `<div class="sidebar-children" id="sidebar-under-pages"${inPages ? ' data-here' : ' hidden'}>${pagesChildren}</div>` : '',
    hp('pages_edit')      ? navItem('/menu', 'Menu', activeTab === 'menu') : '',
    hp('notices_edit')    ? navItem('/notices', 'Notices', activeTab === 'notices') : '',
    hp('links_edit')      ? navItem('/link-cards', 'NFC Taps', activeTab === 'link-cards') : '',
    hp('settings_manage') ? navItem('/redirects', 'Redirects', activeTab === 'redirects') : '',
  ].filter(Boolean).join('');

  // ── EMAIL ──
  // Filtered Mail is not in the design's nav — it shipped after the handoff was
  // written. It is mail held back from the office inbox, so this is where
  // somebody would look for it.
  const canDraft = hp('newsletter_edit') || hp('newsletter_approve');
  const emailItems = [
    canDraft ? navItem('/newsletters', 'Newsletter', activeTab === 'newsletter', badge(b.newsletter, hp('newsletter_approve'), `${b.newsletter} newsletter(s) awaiting approval`)) : '',
    hp('settings_manage') ? navItem('/subscribers', 'Subscribers', activeTab === 'subscribers') : '',
    hp('settings_manage') ? navItem('/filtered', 'Filtered Mail', activeTab === 'filtered') : '',
  ].filter(Boolean).join('');

  // ── MONEY & BUILDING ──
  const moneyItems = [
    hp('giving_manage')   ? navItem('/giving', 'Giving', activeTab === 'giving') : '',
    hp('gym_manage')      ? navItem('/gym-rentals', 'Gym Rentals', activeTab === 'gym', badge(b.gym, hp('gym_manage'), `${b.gym} gym request(s) waiting for review`)) : '',
    hp('payroll_manage')  ? navItem('/payroll', 'Payroll', activeTab === 'payroll') : '',
  ].filter(Boolean).join('');

  // ── PEOPLE & ACCESS ──
  const peopleItems = [
    hp('staff_edit')      ? navItem('/staff', 'Staff', activeTab === 'staff') : '',
    hp('users_manage')    ? navItem('/users', 'Users', activeTab === 'users') : '',
    hp('audit_view')      ? navItem('/audit-log', 'Audit Log', activeTab === 'audit') : '',
  ].filter(Boolean).join('');

  // ── SETUP ──
  const setupItems = [
    (hp('pages_edit') || hp('ministries_edit')) ? navItem('/media', 'Media', activeTab === 'media') : '',
    hp('settings_manage') ? navItem('/settings', 'Settings', activeTab === 'settings') : '',
  ].filter(Boolean).join('');

  return `<aside class="sidebar" id="sidebar">
  <div class="sidebar-brand">
    <div class="sidebar-brand-name">Timothy Lutheran</div>
    <div class="sidebar-brand-sub">Admin <span class="sidebar-version">${VERSION}</span></div>
  </div>
  <div class="sidebar-user">${user ? escapeHtml(user.username) : ''}</div>
  <div class="sidebar-groups">
  <div class="sidebar-group">
    ${navItem('/dashboard', 'Dashboard', activeTab === 'dashboard')}
  </div>
  ${websiteItems ? `<div class="sidebar-group"><div class="sidebar-group-label">${escapeHtml(GROUPS.website)}</div>${websiteItems}</div>` : ''}
  ${emailItems ? `<div class="sidebar-group"><div class="sidebar-group-label">${escapeHtml(GROUPS.email)}</div>${emailItems}</div>` : ''}
  ${moneyItems ? `<div class="sidebar-group"><div class="sidebar-group-label">${escapeHtml(GROUPS.money)}</div>${moneyItems}</div>` : ''}
  ${peopleItems ? `<div class="sidebar-group"><div class="sidebar-group-label">${escapeHtml(GROUPS.people)}</div>${peopleItems}</div>` : ''}
  ${setupItems ? `<div class="sidebar-group"><div class="sidebar-group-label">${escapeHtml(GROUPS.setup)}</div>${setupItems}</div>` : ''}
  </div>
  <div class="sidebar-footer">
    <a href="#" id="tlc-k-open">⌘K searches every section</a>
    <a href="/logout" class="sidebar-signout">Sign out</a>
  </div>
</aside>
${CMDK_HTML}
${contextBar(activeTab, b)}
${extraLinks ? `<div class="tlc-nav-back">${extraLinks}</div>` : ''}`;
}

// ── THE CONTEXT BAR ──────────────────────────────────────────
// Spec: screens/00b-header-nav.html. 46px, the same navy as the sidebar so the
// two read as one shell, above the CONTENT COLUMN only.
//
// ⚠ It reports; it does not navigate. No tabs, no chips, no menus, and the
// crumbs are not links — the spec's "get this wrong and it shows" leads with
// putting section tabs or group chips in here. Sign out is NOT duplicated: it
// lives in the sidebar foot, and having it in both would be two answers to one
// question.
export function contextBar(activeTab, badges = {}) {
  const t = TRAIL[activeTab] || { group: 'Admin', section: 'Admin' };
  const waiting = t.waits ? Number(badges[t.waits] || 0) : 0;
  return `<div class="tlc-ctx">
    <div class="tlc-ctx-trail">
      <span class="tlc-ctx-group">${escapeHtml(t.group)}</span>
      <span class="tlc-ctx-sep" aria-hidden="true">/</span>
      <span class="tlc-ctx-section">${escapeHtml(t.section)}</span>
      ${waiting ? `<span class="tlc-ctx-wait">${waiting} waiting</span>` : ''}
    </div>
    <div class="tlc-ctx-right">
      <button type="button" class="tlc-ctx-k" id="tlc-k-open-2">⌘K</button>
      <a href="https://timothystl.org" target="_blank" rel="noopener">View site ↗</a>
      <a href="https://connect.timothystl.org" target="_blank" rel="noopener">Connect ↗</a>
    </div>
  </div>`;
}

// Where each screen sits, for the trail. `waits` names the badge whose count
// becomes the amber "N waiting" pill beside the section — the same numbers the
// sidebar badges and the dashboard worklist read, so they cannot disagree.
//
// Dashboard's group reads "Admin", as the spec says: it belongs to no group.
const TRAIL = {
  dashboard: { group: 'Admin', section: 'Dashboard' },
  pages: { group: GROUPS.website, section: 'Pages', waits: 'pages' },
  ministries: { group: GROUPS.website, section: 'Ministry pages' },
  partners: { group: GROUPS.website, section: 'Partner ministries' },
  news: { group: GROUPS.website, section: 'News & Events' },
  sermons: { group: GROUPS.website, section: 'Sermons' },
  'christian-education': { group: GROUPS.website, section: 'Christian Education' },
  menu: { group: GROUPS.website, section: 'Menu' },
  notices: { group: GROUPS.website, section: 'Notices' },
  'link-cards': { group: GROUPS.website, section: 'Taps & links' },
  redirects: { group: GROUPS.website, section: 'Redirects' },
  newsletter: { group: GROUPS.email, section: 'Newsletter', waits: 'newsletter' },
  subscribers: { group: GROUPS.email, section: 'Subscribers' },
  filtered: { group: GROUPS.email, section: 'Filtered mail' },
  giving: { group: GROUPS.money, section: 'Giving' },
  gym: { group: GROUPS.money, section: 'Gym rentals', waits: 'gym' },
  payroll: { group: GROUPS.money, section: 'Payroll' },
  staff: { group: GROUPS.people, section: 'Staff directory' },
  users: { group: GROUPS.people, section: 'Users' },
  audit: { group: GROUPS.people, section: 'Audit log' },
  media: { group: GROUPS.setup, section: 'Media' },
  settings: { group: GROUPS.setup, section: 'Settings' },
  voters: { group: GROUPS.website, section: 'Voters page' },
  scheduler: { group: 'Admin', section: 'Schedule builder' },
};


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
