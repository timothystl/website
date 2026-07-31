// Timothy Lutheran Church — Newsletter Admin Worker
// Purpose: Serves admin.timothystl.org — newsletter, news, sermons, youth pages, gym rentals, voter pages
// Deploy: Cloudflare Worker + D1 (tlc-newsletter-db) + KV (RSVP_STORE)
// Dependencies: Brevo API (email sending), TinyMCE CDN (WYSIWYG), Google Calendar API (gym bookings)
// Last modified: 2026-03-27


import { TINYMCE_API_KEY, TINYMCE_HEAD, DB_INIT_NEWSLETTERS, DB_INIT_EVENTS, DB_INIT_NEWS_ITEMS, DB_INIT_YOUTH_PAGES, DB_INIT_MINISTRY_POSTS, DB_INIT_VOTERS_PAGE, DB_INIT_SERMON_SERIES, DB_INIT_PAGE_CONTENT, DB_INIT_NOTICES, DB_INIT_STAFF_MEMBERS, DB_INIT_SITE_SETTINGS, DB_INIT_GYM_GROUPS, DB_INIT_GYM_BOOKINGS, DB_INIT_GYM_RECURRENCES, DB_INIT_GYM_BLOCKED, DB_INIT_GYM_INVOICES, DB_INIT_SERMON_NOTES, DB_INIT_SUBSCRIBERS, DB_INIT_USERS, DB_INIT_SESSIONS, DB_INIT_AUDIT_LOG, DB_INIT_PASSWORD_RESETS, DB_INIT_MINISTRY_MEDIA, DB_INIT_MINISTRY_REVISIONS, DB_INIT_MINISTRY_SECTIONS, DB_INIT_PAGES, DB_INIT_PAGE_REDIRECTS, DB_INIT_PAGE_REVISIONS, THEMES, CONTENT_TYPES, MINISTRY_SLUGS, INITIAL_STAFF, INITIAL_SETTINGS, parseServiceTimes } from './admin/db.js';

// Static pages that can carry self-serve notices (matches the SPA's page ids in public/index.html)
const STATIC_PAGES = [
  { slug: 'home',       label: 'Home' },
  { slug: 'about',      label: 'About' },
  { slug: 'worship',    label: 'Worship' },
  { slug: 'education',  label: 'Christian Education' },
  { slug: 'sermons',    label: 'Sermons' },
  { slug: 'ministries', label: 'Ministries' },
  { slug: 'contact',    label: 'Contact' },
  { slug: 'prayer',     label: 'Prayer Request' },
  { slug: 'give',       label: 'Give' },
  { slug: 'news',       label: 'News & Events' },
  { slug: 'calendar',   label: 'Calendar' },
];
import { html, sidebarShell, loginPage, setupPage, forgotPasswordPage, resetPasswordPage, permissionCheckboxes, formatDate, escapeHtml, tinymceEditorSection, tinymcePostSection, tinymceSermonSection, tinymceYouthSection, tinymcePageSection, tinymcePastorSection, tinymceNoteSection } from './admin/helpers.js';
import { hashPassword, verifyPassword, createSession, getSession, deleteSession, sessionCookieHeader, clearSessionCookieHeader, logAudit, hasPermission, ALL_PERMISSIONS, PERMISSIONS } from './admin/auth.js';
import { sendBrevoNewsletter, sendTransactionalEmail, buildEmailHtml, buildWebHtml, cancelBrevoCampaign } from './admin/email.js';
import { handleGymRoutes, sweepExpiredItems, extractImageKeys } from './admin/gym.js';
import { migrateLegacyPage, starterBlocks, sanitizeBlocks, sanitizeBlock, parseBlocks, newBlock,
         renderPage, renderBlock, BLOCK_DEFS, BLOCK_TYPE_KEYS, GROUPS, BG, INK, SIZES, SPLITS, TONES,
         STAMP_PRESETS, safeUrl, esc as escBlock, editorPhoneCss, blocksClientConfig, makeBlockId,
         TEMPLATES, templateOf, wrapTemplate, BLOCK_CSS } from './admin/blocks.js';
import PAYROLL_HTML from './admin/payroll.html';
import MINISTRY_EDITOR_HTML from './admin/ministry-editor.html';
import { PAGE_SEEDS } from './admin/page-seeds.js';
import { SITE_PAGES } from './admin/site-pages.js';
import { orderPages, filterPages, pageStatus } from './admin/pages.js';

// Allowlist of site_settings keys readable via the public /api/settings/{key}
// endpoint. Everything else returns 404 — keeps internal config (gym admin
// email, Brevo keys, etc.) from leaking to anyone who can guess a key name.
const PUBLIC_SETTINGS_KEYS = new Set(['zoom_url', 'councilfiles_url', 'give_url']);

// Real Tithe.ly fund IDs, parsed by hand out of Tithe.ly-generated links (one link per
// fund, `?...&fundId=<this value>&amount=...`) — Tithe.ly has no fund-listing API of its
// own to pull these from automatically. Applied as a one-time backfill by name (see the
// SCHEMA GATE block below) — only fills a `give_funds` row whose ID is still blank, so a
// value already entered through the Giving tab is never clobbered. Append new entries here
// as more are parsed; each addition needs a SCHEMA_VERSION bump so the backfill re-runs.
const GIVE_FUND_TITHELY_ID_SEED = {
  'General Fund': '7851d336-7349-489b-8e6b-5dfc822278cc',
};

// JSON responses for the ministry page editor's API. Admin-only and never
// cached — a stale draft served from a cache would silently undo an edit.
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });
}

// Ministry slugs are used in URLs and DB lookups; keep them to the shape the
// rest of the site already assumes.
function cleanSlug(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
}

// The page editor is a full-viewport screen served as a static shell, so it
// gets its own headers: never cached (a stale draft would silently undo an
// edit), never indexed, and no frame-ancestors.
const EDITOR_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tiny.cloud; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.tiny.cloud; " +
    "font-src https://fonts.gstatic.com https://cdn.tiny.cloud; img-src 'self' data: blob: https:; " +
    "connect-src 'self' https://cdn.tiny.cloud; frame-src 'self' https://www.youtube-nocookie.com https://docs.google.com https://calendar.google.com; " +
    "frame-ancestors 'none'; base-uri 'none'",
};

// What the editor's topbar should say about a site page. Derived from the row,
// never from the session's change log — that is what kept the topbar and the
// All pages list agreeing with each other.
function pageEditorStatus(row) {
  if (row.publish_at) return 'scheduled';
  if (row.status === 'draft') return 'draft';
  const draft = JSON.stringify(sanitizeBlocks(parseBlocks(row.blocks)));
  const live = JSON.stringify(sanitizeBlocks(parseBlocks(row.published_blocks)));
  return draft === live ? 'live' : 'draft';
}

// The parts of the page editor's API that do not care which table the page
// lives in: the media library, saved sections, a fresh block of a given type,
// and the stateless renderer. The ministry editor and the site editor mount
// them under their own prefix and share one implementation, so a fix to either
// lands in both. Returns null when `path` is none of them.
async function sharedEditorApi(path, method, request, env, ctx, currentUser, P) {
  if (!path.startsWith(P + '/')) return null;
  const rest = path.slice(P.length);            // '/media', '/sections/12/delete', …
  const sectionId = (suffix) => {
    const m = rest.match(new RegExp('^/sections/(\\d+)' + suffix + '$'));
    return m ? Number(m[1]) : null;
  };
    // ── MEDIA LIBRARY ───────────────────────────────────────────────────
    // Photos land in the same R2 bucket as every other admin upload (via
    // /api/upload-image); a "video" row is just a YouTube URL. Both are
    // catalogued here so staff pick from a library instead of pasting URLs.
    if (path === P + '/media' && method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT id, filename, kind, url, thumb_url, alt, meta FROM ministry_media ORDER BY id DESC LIMIT 200'
      ).all();
      return jsonResponse({ media: rows.results || [] });
    }

    if (path === P + '/media' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const kind = body.kind === 'video' ? 'video' : 'photo';
      const url = safeUrl(body.url);
      if (!url) return jsonResponse({ error: 'That link does not look like a URL.' }, 400);
      const alt = String(body.alt || '').trim().slice(0, 200);
      // A church site should not ship inaccessible images. Videos carry their
      // own title on YouTube, so the requirement is photos only.
      if (kind === 'photo' && !alt) return jsonResponse({ error: 'Please describe the photo before adding it.' }, 400);
      const thumbUrl = safeUrl(body.thumb_url).slice(0, 600);
      const filename = String(body.filename || url.split('/').pop() || 'upload').slice(0, 160);
      const meta = String(body.meta || '').slice(0, 80);
      const res = await env.DB.prepare(
        'INSERT INTO ministry_media (filename, kind, url, thumb_url, alt, meta, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(filename, kind, url, thumbUrl, alt, meta, currentUser?.username || '', new Date().toISOString()).run();
      return jsonResponse({ ok: true, item: { id: res.meta?.last_row_id || 0, filename, kind, url, thumb_url: thumbUrl, alt, meta } });
    }

    // ── SAVED SECTIONS ──────────────────────────────────────────────────
    if (path === P + '/sections' && method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT id, name, blocks, created_by FROM ministry_saved_sections ORDER BY name COLLATE NOCASE'
      ).all();
      return jsonResponse({
        sections: (rows.results || []).map((r) => ({
          id: r.id, name: r.name, created_by: r.created_by, count: parseBlocks(r.blocks).length,
        })),
      });
    }

    if (path === P + '/sections' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || '').trim().slice(0, 60);
      const blocks = sanitizeBlocks(body.blocks);
      if (!name) return jsonResponse({ error: 'Give the section a name.' }, 400);
      if (!blocks.length) return jsonResponse({ error: 'There is nothing to save.' }, 400);
      const res = await env.DB.prepare(
        'INSERT INTO ministry_saved_sections (name, blocks, created_by, created_at) VALUES (?, ?, ?, ?)'
      ).bind(name, JSON.stringify(blocks), currentUser?.username || 'staff', new Date().toISOString()).run();
      return jsonResponse({ ok: true, section: { id: res.meta?.last_row_id || 0, name, count: blocks.length } });
    }

    // The blocks of one section, with fresh ids so dropping the same section
    // onto a page twice cannot collide with itself.
    if (sectionId('') !== null && method === 'GET') {
      const id = sectionId('');
      const row = await env.DB.prepare('SELECT blocks FROM ministry_saved_sections WHERE id = ?').bind(id).first();
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      const blocks = sanitizeBlocks(parseBlocks(row.blocks)).map((b) => Object.assign({}, b, { id: makeBlockId() }));
      return jsonResponse({ blocks });
    }

    if (sectionId('/delete') !== null && method === 'POST') {
      const id = sectionId('/delete');
      await env.DB.prepare('DELETE FROM ministry_saved_sections WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true });
    }

    // A fresh block of a given type, straight from the server's own defaults,
    // so the editor never has to keep its own copy of them.
    if (path === P + '/new-block' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const block = newBlock(String(body.type || ''));
      if (!block) return jsonResponse({ error: 'Unknown block type' }, 400);
      return jsonResponse({ block });
    }

    // Stateless render — the editor's single source of block markup. It
    // stores nothing; the only reads are the self-filling blocks' data
    // bundle, so what staff arrange on the canvas is what visitors get.
    if (path === P + '/render' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const blocks = sanitizeBlocks(body.blocks);
      const slug = cleanSlug(body.slug);
      return jsonResponse({
        html: renderPage(blocks, { editing: true, slug, withCss: true, data: await pageData(env, ctx) }),
        blocks,
      });
    }


  return null;
}

// ── PAGE DATA CONTEXT ────────────────────────────────────────────────────────
// Self-filling blocks (sermon, news, staff, service times, map) read from here
// and never from the block itself, so a page cannot show stale copies of data
// that lives elsewhere in the admin.
//
// One query bundle per page render, memoised for the life of the request: a
// page with a Sermon block and a Staff block costs the same queries as a page
// with ten of each. Keyed on the request's own ExecutionContext, not on `env` —
// `env` is shared by every request in an isolate, so caching against it would
// serve yesterday's sermon until Cloudflare happened to recycle the isolate.
const PAGE_DATA_CACHE = new WeakMap();

async function pageData(env, reqKey) {
  if (reqKey && PAGE_DATA_CACHE.has(reqKey)) return PAGE_DATA_CACHE.get(reqKey);
  const p = (async () => {
    const q = async (sql, ...binds) => {
      try { return (await env.DB.prepare(sql).bind(...binds).all()).results || []; } catch (_) { return []; }
    };
    const [settingRows, sermonRow, news, staff] = await Promise.all([
      q("SELECT key, value FROM site_settings WHERE key LIKE 'church_%'"),
      env.DB.prepare(
        'SELECT n.title, n.date, n.scripture, n.youtube_url, n.audio_url, s.title AS series ' +
        'FROM sermon_notes n LEFT JOIN sermon_series s ON s.id = n.series_id ' +
        'ORDER BY COALESCE(n.date, \'\') DESC, n.id DESC LIMIT 1'
      ).first().catch(() => null),
      q("SELECT title, summary, publish_date AS date FROM news_items WHERE (expire_date IS NULL OR expire_date >= date('now')) ORDER BY pinned DESC, publish_date DESC, id DESC LIMIT 6"),
      q('SELECT name, title, email, photo_url FROM staff_members ORDER BY display_order ASC, id ASC LIMIT 12'),
    ]);
    const s = {};
    for (const r of settingRows) s[r.key.replace(/^church_/, '')] = r.value;
    return {
      settings: { address_line: s.address_line || '', address_city: s.address_city || '', phone: s.phone || '', email: s.email || '' },
      services: parseServiceTimes(s.service_times),
      sermon: sermonRow || null,
      news, staff,
    };
  })();
  if (reqKey) PAGE_DATA_CACHE.set(reqKey, p);
  return p;
}

// CSRF defense: only these POST paths are reachable from outside the admin
// origin (the public site at timothystl.org POSTs to them). Every other
// state-changing request must originate from admin.timothystl.org itself.
const ADMIN_ORIGIN = 'https://admin.timothystl.org';
const PUBLIC_CROSS_ORIGIN_POSTS = new Set(['/api/contact', '/api/prayer', '/api/subscribe']);

// Real ChMS fund names — read-only, cross-Worker call — shown as suggestions in the
// Giving tab's Funds card so staff can pick a real fund name instead of retyping one from
// memory. ChMS's own `funds` table has no Tithe.ly linkage (only a Breeze giving-sync ID),
// so this only helps get the *name* right; the Tithe.ly fundId still has to be pasted in by
// hand per fund. Same X-Intake-Key auth pattern already used for the contact/prayer intake
// calls in site-worker.js. Best-effort: any failure (key not yet configured on this Worker,
// network error, ChMS down) just means no suggestions are shown — never breaks the page.
async function getChmsFundSuggestions(env) {
  const key = env.CHMS_INTAKE_API_KEY || '';
  if (!key) return [];
  try {
    const res = await fetch('https://serve.timothystl.org/api/intake/funds', {
      headers: { 'X-Intake-Key': key }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.funds) ? data.funds : [];
  } catch (_) { return []; }
}

// Shared by the immediate-send and schedule-send routes: loads a saved
// newsletter's content and renders it to the same email HTML both paths send.
async function buildNewsletterEmailPayload(env, id) {
  const row = await env.DB.prepare(
    'SELECT subject, pastor_note, wol_content, lasm_content, secondary_note, published_at, format, cta_url, cta_label, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes, news_item_ids FROM newsletters WHERE id = ?'
  ).bind(id).first();
  if (!row) return null;

  const eventsRows = await env.DB.prepare(
    'SELECT event_date, event_name, event_time, event_desc FROM events WHERE newsletter_id = ? ORDER BY sort_order'
  ).bind(id).all();

  // Re-fetch the newsletter's selected news items (title + summary/body/image) so the
  // Featured/More-from-Timothy sections aren't silently empty when sending/resending.
  const selectedNewsIds = (row.news_item_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  let selectedNewsItems = [];
  if (selectedNewsIds.length > 0) {
    const placeholders = selectedNewsIds.map(() => '?').join(',');
    const newsRows = await env.DB.prepare(
      `SELECT id, title, summary, body, image_url FROM news_items WHERE id IN (${placeholders})`
    ).bind(...selectedNewsIds).all();
    const newsMap = Object.fromEntries(newsRows.results.map(r => [String(r.id), r]));
    selectedNewsItems = selectedNewsIds.map(nid => newsMap[nid]).filter(Boolean);
  }

  const emailHtml = buildEmailHtml(row.subject, row.pastor_note, eventsRows.results, row.wol_content || '', row.lasm_content || '', row.published_at, selectedNewsItems, row.secondary_note || '', id, row.format || 'weekly', row.cta_url || '', row.cta_label || '', row.tertiary_note || '', row.tertiary_cta_label || '', row.tertiary_cta_url || '', JSON.parse(row.bible_classes || '[]'));
  return { row, emailHtml };
}

// Reject anything that isn't an http(s) URL — guards Link Card saves against
// javascript:/data: payloads that would otherwise render as a clickable,
// script-executing link on links.timothystl.org.
function isSafeCardUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// Staff photo crop position is written straight into a CSS object-position
// value on the public site — restrict it to "NN% NN%" so it can't carry
// anything else through.
function isSafeObjectPosition(value) {
  return typeof value === 'string' && /^\d{1,3}% \d{1,3}%$/.test(value);
}

// Clamps the staff photo zoom (a CSS transform: scale() factor) to a sane
// range regardless of what's submitted — 1x (no zoom) to 2.5x.
function safeZoomFactor(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2.5, Math.max(1, n));
}

// Allowlists for file uploads. Extensions are derived from MIME type —
// never from the client-supplied filename — so the stored file always
// matches what it actually is.
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg',  'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
  ['image/gif',  'gif'],
]);
const ALLOWED_DOC_TYPES = new Map([
  ['application/pdf', 'pdf'],
]);

// Wires the news-item "Header image" file input to /api/upload-image and
// fills the hidden image_url field with the resulting R2 URL. Replaces the
// old plain text input, which let staff paste a browser-local blob: URL
// (dead for every other visitor) into a field with no upload path.
function newsImageUploadScript(existingUrl = '') {
  const safeUrl = (existingUrl || '').replace(/"/g, '&quot;');
  return `<script>
(function() {
  var hidden = document.getElementById('image_url_val');
  var preview = document.getElementById('image-url-preview');
  var existing = "${safeUrl}";
  if (existing && existing.indexOf('blob:') !== 0) {
    hidden.value = existing;
    preview.innerHTML = '<img src="' + existing + '" style="width:100%;border-radius:6px;">';
    preview.style.display = '';
  }
  document.getElementById('image_url_file').addEventListener('change', async function() {
    var file = this.files[0];
    if (!file) return;
    var status = document.getElementById('image-url-status');
    status.textContent = 'Uploading…';
    var fd = new FormData();
    fd.append('file', file);
    try {
      var r = await fetch('/api/upload-image', { method: 'POST', body: fd });
      var j = await r.json();
      if (j.url) {
        hidden.value = j.url;
        preview.innerHTML = '<img src="' + j.url + '" style="width:100%;border-radius:6px;">';
        preview.style.display = '';
        status.textContent = '✓ Uploaded';
        status.style.color = 'var(--sage)';
      } else {
        status.textContent = j.error || 'Upload failed';
        status.style.color = '#B85C3A';
      }
    } catch (e) {
      status.textContent = 'Upload failed — try again';
      status.style.color = '#B85C3A';
    }
  });
})();
<\/script>`;
}

// Legacy staff photos are stored as a path relative to the main site
// (e.g. "/images/staff/thompson.webp", served from public/images/staff/ on
// timothystl.org) rather than an absolute R2 URL. That resolves fine on the
// public About page, but rendered inside the admin dashboard the same
// relative path resolves against admin.timothystl.org instead — where it
// 404s — so the preview silently fell back to initials-only. Point
// root-relative paths at the main site explicitly for any admin preview.
function staffPhotoSrc(url) {
  if (!url) return '';
  return url.startsWith('/') ? `https://timothystl.org${url}` : url;
}

// Renders the Staff form's photo field: a hidden photo_url input driven by
// a file picker wired to /api/upload-image, a circular preview, and sliders
// to recenter the crop (stored as photo_position, an object-position CSS
// value like "50% 30%", since a straight center-crop of a portrait photo
// often cuts off the top of someone's head) and to zoom in (stored as
// photo_zoom, a CSS transform: scale() factor). Replaces the old plain-text
// "Photo URL" input, which required staff to already have the file hosted
// somewhere else.
function staffPhotoFieldHtml(existingUrl = '', existingPosition = '50% 50%', existingZoom = 1) {
  const safeUrl = escapeHtml(existingUrl || '');
  const pos = (existingPosition || '50% 50%').split(' ');
  const posX = parseInt(pos[0]) || 50;
  const posY = parseInt(pos[1]) || 50;
  const zoom = parseFloat(existingZoom) || 1;
  const zoomPct = Math.round(zoom * 100);
  return `<div class="form-group">
        <label>Photo</label>
        <input type="hidden" name="photo_url" id="photo_url_val" value="${safeUrl}">
        <input type="hidden" name="photo_position" id="photo_position_val" value="${escapeHtml(existingPosition || '50% 50%')}">
        <input type="hidden" name="photo_zoom" id="photo_zoom_val" value="${zoom}">
        <div id="staff-photo-preview" style="${existingUrl ? '' : 'display:none;'}margin-bottom:8px;width:100px;height:100px;border-radius:50%;overflow:hidden;">
          ${existingUrl ? `<img src="${escapeHtml(staffPhotoSrc(existingUrl))}" style="width:100%;height:100%;object-fit:cover;object-position:${posX}% ${posY}%;transform:scale(${zoom});">` : ''}
        </div>
        <input type="file" id="photo_url_file" accept="image/jpeg,image/png,image/webp" style="font-size:13px;">
        <div id="staff-photo-status" style="font-size:12px;color:var(--gray);margin-top:4px;"></div>
        <div id="staff-photo-reposition" style="${existingUrl ? '' : 'display:none;'}margin-top:10px;">
          <label style="font-size:11px;font-weight:600;color:var(--gray);">Recenter &amp; zoom photo</label>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <span style="font-size:11px;color:var(--gray);width:14px;">↔</span>
            <input type="range" id="photo_pos_x" min="0" max="100" value="${posX}" style="flex:1;">
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <span style="font-size:11px;color:var(--gray);width:14px;">↕</span>
            <input type="range" id="photo_pos_y" min="0" max="100" value="${posY}" style="flex:1;">
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <span style="font-size:11px;color:var(--gray);width:14px;">🔍</span>
            <input type="range" id="photo_zoom_slider" min="100" max="250" value="${zoomPct}" style="flex:1;">
          </div>
        </div>
      </div>`;
}

function staffPhotoUploadScript() {
  return `<script>
(function() {
  function applyPosition() {
    var x = document.getElementById('photo_pos_x').value;
    var y = document.getElementById('photo_pos_y').value;
    var zoom = document.getElementById('photo_zoom_slider').value / 100;
    document.getElementById('photo_position_val').value = x + '% ' + y + '%';
    document.getElementById('photo_zoom_val').value = zoom;
    var img = document.querySelector('#staff-photo-preview img');
    if (img) {
      img.style.objectPosition = x + '% ' + y + '%';
      img.style.transform = 'scale(' + zoom + ')';
    }
  }
  document.getElementById('photo_pos_x').addEventListener('input', applyPosition);
  document.getElementById('photo_pos_y').addEventListener('input', applyPosition);
  document.getElementById('photo_zoom_slider').addEventListener('input', applyPosition);

  // Resize + re-encode to WebP client-side before upload, matching how the
  // existing staff headshots were hand-converted to .webp for file size.
  // Falls back to the original file untouched if the browser can't encode
  // WebP via canvas (older Safari) or the image fails to decode.
  function compressToWebp(file) {
    return new Promise(function(resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var maxDim = 800;
        var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var h = Math.max(1, Math.round(img.naturalHeight * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) {
          if (blob && blob.type === 'image/webp' && blob.size > 0) {
            resolve(new File([blob], 'photo.webp', { type: 'image/webp' }));
          } else {
            resolve(file);
          }
        }, 'image/webp', 0.85);
      };
      img.onerror = function() { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  document.getElementById('photo_url_file').addEventListener('change', async function() {
    var rawFile = this.files[0];
    if (!rawFile) return;
    var status = document.getElementById('staff-photo-status');
    status.textContent = 'Uploading…';
    var file = await compressToWebp(rawFile);
    var fd = new FormData();
    fd.append('file', file);
    try {
      var r = await fetch('/api/upload-image', { method: 'POST', body: fd });
      var j = await r.json();
      if (j.url) {
        document.getElementById('photo_url_val').value = j.url;
        var prev = document.getElementById('staff-photo-preview');
        prev.innerHTML = '<img src="' + j.url + '" style="width:100%;height:100%;object-fit:cover;">';
        prev.style.display = '';
        document.getElementById('photo_pos_x').value = 50;
        document.getElementById('photo_pos_y').value = 50;
        document.getElementById('photo_position_val').value = '50% 50%';
        document.getElementById('photo_zoom_slider').value = 100;
        document.getElementById('photo_zoom_val').value = 1;
        document.getElementById('staff-photo-reposition').style.display = '';
        status.textContent = '✓ Uploaded';
        status.style.color = 'var(--sage)';
      } else {
        status.textContent = j.error || 'Upload failed';
        status.style.color = '#B85C3A';
      }
    } catch (e) {
      status.textContent = 'Upload failed — try again';
      status.style.color = '#B85C3A';
    }
  });
})();
<\/script>`;
}

// ── MAIN HANDLER ─────────────────────────────────────────────
// Promotes ministry pages whose scheduled publish time has come. Run from the
// cron trigger in wrangler.toml, and again whenever staff open the Ministries
// list so the admin never shows a page as "scheduled" after its moment passed.
async function promoteScheduledPages(env) {
  const nowIso = new Date().toISOString();
  let promoted = 0;
  try {
    const due = await env.DB.prepare(
      "SELECT slug, title, blocks FROM youth_pages WHERE page_status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= ?"
    ).bind(nowIso).all();
    for (const row of due.results || []) {
      const json = JSON.stringify(sanitizeBlocks(parseBlocks(row.blocks)));
      await env.DB.prepare(
        "UPDATE youth_pages SET published_blocks = ?, page_status = 'live', publish_at = NULL, change_log = '[]', updated_at = ? WHERE slug = ?"
      ).bind(json, nowIso, row.slug).run();
      await env.DB.prepare('INSERT INTO ministry_page_revisions (slug, blocks, published_at, published_by) VALUES (?, ?, ?, ?)')
        .bind(row.slug, json, nowIso, 'scheduled').run();
      promoted += 1;
    }
  } catch (e) {
    console.error('Scheduled ministry publish failed:', e && e.message);
  }
  // Site pages schedule the same way. Kept in one function so removing the cron
  // trigger cannot break "publish later" for one kind of page but not the other.
  try {
    const due = await env.DB.prepare(
      'SELECT id, title, blocks FROM pages WHERE publish_at IS NOT NULL AND publish_at <= ?'
    ).bind(nowIso).all();
    for (const row of due.results || []) {
      const json = JSON.stringify(sanitizeBlocks(parseBlocks(row.blocks)));
      await env.DB.prepare(
        "UPDATE pages SET published_blocks = ?, status = 'published', publish_at = NULL, change_log = '[]', updated_at = ? WHERE id = ?"
      ).bind(json, nowIso, row.id).run();
      await env.DB.prepare('INSERT INTO page_revisions (page_id, blocks, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
        .bind(row.id, json, 'Published on schedule', nowIso, 'scheduled').run();
      promoted += 1;
    }
  } catch (e) {
    console.error('Scheduled site page publish failed:', e && e.message);
  }
  return promoted;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(promoteScheduledPages(env));
  },

  async fetch(request, env, ctx) {
    try {
      return await this._fetch(request, env, ctx);
    } catch (e) {
      const detail = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
      console.error('Admin worker error:', detail);
      // Admin portal is staff-only — surface the underlying error so it can
      // actually be debugged without digging through Cloudflare tail logs.
      return new Response(
        'Something went wrong. Please try again or contact the site administrator.\n\n' +
        '--- Error detail (share this with the developer) ---\n' + detail,
        { status: 500, headers: { 'Content-Type': 'text/plain' } }
      );
    }
  },

  async _fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ── Supabase proxy for /payroll page — runs before the schema gate ──
    // Placed ahead of the ~140-query schema-migration block below (so it isn't
    // stalled by that), but it still requires a valid admin session of its own
    // — getSession() is a single indexed lookup, not part of that gate, so
    // authenticating here costs nothing extra. Fails closed (no session/error
    // => 401) rather than trusting the Supabase anon key alone as the boundary.
    const MDO_SUPABASE_URL = 'https://dahdstopsumxnqvdclmy.supabase.co';
    if (path.startsWith('/sb/')) {
      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': ADMIN_ORIGIN,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'apikey, Authorization, Content-Type, Prefer, X-Client-Info',
          'Access-Control-Max-Age': '86400',
        }});
      }
      const sbUser = await getSession(env.DB, request).catch(() => null);
      if (!sbUser || !hasPermission(sbUser, 'payroll_manage')) {
        return new Response(JSON.stringify({ error: 'Not authenticated.', code: 'UNAUTHENTICATED' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ADMIN_ORIGIN },
        });
      }
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = request.headers.get('Origin') || '';
        const referer = request.headers.get('Referer') || '';
        const originOk = origin === ADMIN_ORIGIN || (!origin && referer.startsWith(ADMIN_ORIGIN + '/'));
        if (!originOk) {
          return new Response('Cross-origin request blocked.', { status: 403 });
        }
        const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
        if (contentLength > 25 * 1024 * 1024) {
          return new Response('Request too large.', { status: 413 });
        }
      }
      const targetUrl = MDO_SUPABASE_URL + path.slice(3) + url.search;
      // Build a fresh header set rather than forwarding request.headers verbatim —
      // the incoming Cookie (admin session token) has no business reaching Supabase.
      const outHeaders = new Headers();
      for (const h of ['apikey', 'authorization', 'content-type', 'prefer', 'x-client-info']) {
        const v = request.headers.get(h);
        if (v) outHeaders.set(h, v);
      }
      const proxyReq = new Request(targetUrl, {
        method, headers: outHeaders,
        body: ['GET', 'HEAD'].includes(method) ? undefined : request.body,
      });
      let supabaseRes;
      try {
        supabaseRes = await Promise.race([
          fetch(proxyReq),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Supabase proxy timeout')), 20000)),
        ]);
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message, code: 'PROXY_ERROR' }), {
          status: 504,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ADMIN_ORIGIN },
        });
      }
      const resHeaders = new Headers(supabaseRes.headers);
      resHeaders.set('Access-Control-Allow-Origin', ADMIN_ORIGIN);
      resHeaders.set('Cache-Control', 'no-store');
      return new Response(supabaseRes.body, { status: supabaseRes.status, headers: resHeaders });
    }

    // Web app manifest — lets Chrome/Edge offer "Install admin.timothystl.org"
    // as a standalone app. Served early since it needs no DB/auth. Icons point
    // at the main site (this worker has no static asset binding of its own).
    if (path === '/site.webmanifest') {
      return new Response(JSON.stringify({
        name: 'Timothy Lutheran Admin',
        short_name: 'TLC Admin',
        icons: [
          { src: 'https://timothystl.org/images/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'https://timothystl.org/images/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
        theme_color: '#0A3C5C',
        background_color: '#FAF7F0',
        display: 'standalone',
        start_url: '/',
      }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } });
    }

    // Reject obviously oversized requests up front. 25MB is a generous ceiling
    // for image/PDF uploads; text-only forms are well under 1MB. Without this,
    // a single malicious POST could push tens of MB into D1 / R2 / memory.
    if (method !== 'GET' && method !== 'HEAD') {
      const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
      if (contentLength > 25 * 1024 * 1024) {
        return new Response('Request too large.', { status: 413 });
      }
    }

    // CSRF defense: state-changing requests must originate from the admin
    // itself (Origin header set by the browser). The three /api/* form
    // endpoints below are intentionally cross-origin (called from
    // timothystl.org), so they're allowed through.
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !PUBLIC_CROSS_ORIGIN_POSTS.has(path)) {
      const origin = request.headers.get('Origin') || '';
      const referer = request.headers.get('Referer') || '';
      const ok = origin === ADMIN_ORIGIN
        || (!origin && referer.startsWith(ADMIN_ORIGIN + '/'));
      if (!ok) {
        return new Response('Cross-origin request blocked.', { status: 403 });
      }
    }

    // ── SCHEMA GATE ──
    // The block below runs ~140 idempotent CREATE/ALTER/INSERT statements.
    // On a stable schema each one is a no-op, but they're still ~140 D1
    // subrequests per admin request — that's where the 5–10s "slow but
    // works" latency comes from. Gate the whole block behind a single
    // SELECT against _schema_version. Bump SCHEMA_VERSION any time the
    // migrations below change so the next request after deploy re-runs
    // them and rewrites the marker.
    const SCHEMA_VERSION = '2026-07-31-2'; // bumped: pages / page_redirects / page_revisions, seeded from admin/site-pages.js
    let schemaOk = false;
    try {
      const row = await env.DB.prepare("SELECT value FROM _schema_version WHERE key='version'").first();
      if (row?.value === SCHEMA_VERSION) schemaOk = true;
    } catch (_) { /* _schema_version table may not exist yet */ }

    if (!schemaOk) {
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
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN wol_content TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN lasm_content TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN secondary_note TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN news_item_ids TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS redirects (path TEXT PRIMARY KEY, url TEXT NOT NULL, label TEXT)').run(); } catch (_) {}
    // Giving Links (vendor/renter one-off Tithe.ly links): reuses this same table rather
    // than a new one — a redirect is a redirect. `category` distinguishes them in the admin
    // UI so they don't get lost in the general-purpose redirect list; `active` lets office
    // staff retire an old one-off link without losing the audit trail of what it was.
    try { await env.DB.prepare("ALTER TABLE redirects ADD COLUMN category TEXT NOT NULL DEFAULT 'general'").run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE redirects ADD COLUMN active INTEGER NOT NULL DEFAULT 1').run(); } catch (_) {}
    // Giving tab: admin-editable amount tiers for give.timothystl.org (added 2026-07-27,
    // replacing the amounts/links that were previously hardcoded in the website repo's
    // give-landing.js). Blank url means "fall back to the base give_url setting" — same
    // fallback semantics the hardcoded version always had.
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS give_amount_tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount INTEGER NOT NULL,
        monthly_url TEXT NOT NULL DEFAULT '',
        once_url TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      )`).run();
    } catch (_) {}
    // Collapsed the original monthly_url/once_url split into a single url column — Tithe.ly
    // has no way to generate a link that prefills specifically as recurring vs one-time, so
    // the distinction never did anything real. Left the two old columns in place (unused)
    // rather than DROP COLUMN, since D1/SQLite's DROP COLUMN support is inconsistent; any
    // link an admin had already entered under monthly_url carries forward automatically.
    try { await env.DB.prepare("ALTER TABLE give_amount_tiers ADD COLUMN url TEXT NOT NULL DEFAULT ''").run(); } catch (_) {}
    try { await env.DB.prepare("UPDATE give_amount_tiers SET url = monthly_url WHERE url = '' AND monthly_url != ''").run(); } catch (_) {}
    // Seed once from the ladder amounts Andrew provided 2026-07-27 — idempotent via a
    // row-count guard so re-running this on every request doesn't duplicate seed rows. Only
    // affects a fresh/never-seeded database; does not touch an already-seeded live table
    // (edit tiers via the Giving tab itself for that).
    try {
      const tierCount = await env.DB.prepare('SELECT COUNT(*) as c FROM give_amount_tiers').first();
      if (!tierCount || tierCount.c === 0) {
        const seedTiers = [30, 50, 75, 90, 150, 250];
        for (let i = 0; i < seedTiers.length; i++) {
          await env.DB.prepare('INSERT INTO give_amount_tiers (amount, is_default, sort_order) VALUES (?, ?, ?)')
            .bind(seedTiers[i], seedTiers[i] === 50 ? 1 : 0, i).run();
        }
      }
    } catch (_) {}
    // Giving tab: fund selector for give.timothystl.org (added 2026-07-27). Self-contained
    // in this repo — ChMS's own `funds` table has no Tithe.ly linkage of its own (only a
    // Breeze fund ID, for its own giving-sync dedup), so every fund here needs its Tithe.ly
    // ID hand-parsed from a real Tithe.ly-generated link and pasted in regardless of source.
    // Blank tithely_fund_id means "use whatever fundId is already in the base Tithe.ly
    // Link" — lets a plain "General Fund" row exist without duplicating the GUID that's
    // already in the give_url setting.
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS give_funds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tithely_fund_id TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      )`).run();
    } catch (_) {}
    try {
      const fundCount = await env.DB.prepare('SELECT COUNT(*) as c FROM give_funds').first();
      if (!fundCount || fundCount.c === 0) {
        await env.DB.prepare('INSERT INTO give_funds (name, tithely_fund_id, is_default, sort_order) VALUES (?, ?, ?, ?)')
          .bind('General Fund', GIVE_FUND_TITHELY_ID_SEED['General Fund'] || '', 1, 0).run();
      }
    } catch (_) {}
    // Backfill real Tithe.ly fund IDs as Andrew parses them out of Tithe.ly-generated links
    // (GIVE_FUND_TITHELY_ID_SEED below) — only fills a row whose ID is still blank, so it
    // never overwrites a value already entered by hand through the Giving tab itself. Safe
    // to re-run on every deploy; each entry is a no-op once its row has a real ID.
    try {
      for (const [name, tithelyFundId] of Object.entries(GIVE_FUND_TITHELY_ID_SEED)) {
        await env.DB.prepare("UPDATE give_funds SET tithely_fund_id = ? WHERE name = ? AND tithely_fund_id = ''")
          .bind(tithelyFundId, name).run();
      }
    } catch (_) {}
    // Seed a /links redirect now that the stale static public/links/index.html
    // (dead routes, old Breeze giving URL) has been removed — timothystl.org/links
    // should point to the real links.timothystl.org landing page.
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO redirects (path, url, label) VALUES ('links', 'https://links.timothystl.org', 'Links / Social Landing Page')`
      ).run();
    } catch (_) {}
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
    try { await env.DB.prepare(DB_INIT_SUBSCRIBERS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_PAGE_CONTENT).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_NOTICES).run(); } catch (_) {}
    // One-time backfill: migrate legacy static-page page_content banners into the
    // new self-serve notices table, then leave page_content alone (still used by
    // the Music ministry page's "community-concert" block).
    try {
      const legacyCount = await env.DB.prepare("SELECT COUNT(*) as c FROM notices").first();
      if (!legacyCount || legacyCount.c === 0) {
        const LEGACY_MAP = [
          { key: 'home-notice',           slug: 'home' },
          { key: 'worship-notice',        slug: 'worship' },
          { key: 'about-notice',          slug: 'about' },
          { key: 'seasonal-lent',         slug: 'worship' },
          { key: 'seasonal-easter',       slug: 'worship' },
          { key: 'seasonal-advent',       slug: 'worship' },
          { key: 'seasonal-christmas',    slug: 'worship' },
          { key: 'seasonal-thanksgiving', slug: 'worship' },
          { key: 'education-schedule',    slug: 'education' },
        ];
        let pos = 0;
        for (const m of LEGACY_MAP) {
          const row = await env.DB.prepare('SELECT label, value, published, updated_at FROM page_content WHERE key = ?').bind(m.key).first();
          if (row && row.value && row.value.trim()) {
            await env.DB.prepare(
              'INSERT INTO notices (page_slug, label, body, published, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
            ).bind(m.slug, row.label, row.value, row.published === null ? 1 : row.published, pos++, row.updated_at || new Date().toISOString()).run();
          }
        }
      }
    } catch (_) {}
    // Migrate: add CTA fields to ministry pages (youth_pages)
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN cta_label TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN cta_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN cta_label_2 TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN cta_url_2 TEXT').run(); } catch (_) {}
    // Migrate: add published flag to page_content
    try { await env.DB.prepare('ALTER TABLE page_content ADD COLUMN published INTEGER DEFAULT 1').run(); } catch (_) {}
    // Migrate: add tertiary_note to newsletters
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN tertiary_note TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN tertiary_cta_label TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN tertiary_cta_url TEXT').run(); } catch (_) {}
    // Migrate: add bible_classes to newsletters
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN bible_classes TEXT').run(); } catch (_) {}
    // Bible class templates (superseded by bible_classes, kept for foreign-key safety)
    try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS bible_class_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT NOT NULL, leader TEXT, location TEXT, sort_order INTEGER DEFAULT 0)').run(); } catch (_) {}
    // Full bible_classes table for Christian Education tab + website
    try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS bible_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      label TEXT,
      description TEXT,
      leader TEXT,
      location TEXT,
      schedule TEXT,
      accent TEXT DEFAULT 'mid',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    )`).run(); } catch (_) {}
    // Migrate any existing bible_class_templates rows into bible_classes (preserves IDs for newsletter template_id refs)
    try { await env.DB.prepare(`INSERT OR IGNORE INTO bible_classes (id, title, leader, location, active, sort_order)
      SELECT id, topic, leader, location, 1, sort_order FROM bible_class_templates`).run(); } catch (_) {}
    // Pre-populate with the 7 class offerings from the static education page (only if table is empty)
    try {
      const bcCount = await env.DB.prepare('SELECT COUNT(*) as n FROM bible_classes').first();
      if (!bcCount || bcCount.n === 0) {
        const INITIAL_CLASSES = [
          { title: 'Adult Bible Class', label: 'Sunday Morning', description: 'An in-depth look at Scripture and living the Christian life in today\'s world. We rotate through different biblical studies and theological topics — from deep dives into a single book of Scripture to thematic explorations of faith and culture. All are welcome, no prior Bible knowledge required.', leader: '', location: '', schedule: 'Sunday · 9:30 AM', accent: 'mid', sort_order: 1 },
          { title: 'Bible Study & Sing-Along', label: 'Wednesday Morning', description: 'Gather for study, discussion, and community — then close the morning with a sing-along at 11:00 AM, singing hymns and contemporary songs together before heading into your day.', leader: '', location: '', schedule: 'Wednesday · 10:00 AM · Sing-along at 11:00 AM', accent: 'teal', sort_order: 2 },
          { title: "Men's Bible Class", label: '1st & 3rd Saturdays', description: 'Men of all ages are invited for coffee, Scripture, and brotherhood. No registration needed — just show up.', leader: '', location: 'Panera Bread on Chippewa', schedule: '1st & 3rd Saturdays · 8:00 AM', accent: 'steel', sort_order: 3 },
          { title: 'Middle & High School Bible Class', label: 'Sunday Morning · Grades 7–12', description: 'High school students dive deep into Scripture — exploring God\'s Word together, asking hard questions, and discovering what faith means in daily life.', leader: '', location: '', schedule: 'Sunday · 9:30 AM', accent: 'sage', sort_order: 4 },
          { title: 'Sunday School', label: 'Sunday · Children through 6th Grade', description: 'Kids hear God\'s Word, build friendships, and grow in faith through age-appropriate teaching. We close each week with a parent-child time (10:00–10:15 AM) — parents join to hear their child review the lesson, sing together, and pray.', leader: '', location: '', schedule: 'Sunday · 9:30–10:15 AM (includes parent-child closing)', accent: 'sage', sort_order: 5 },
          { title: 'Confirmation', label: 'Grades 7–8 · School Year', description: 'A two-year journey through the Lutheran catechism, preparing young people to make a mature public confession of faith and receive Holy Communion.', leader: '', location: '', schedule: 'Sundays during the school year · 12:30–1:30 PM', accent: 'amber', sort_order: 6 },
          { title: 'Adult Instruction', label: 'New to Timothy?', description: 'Interested in joining Timothy or learning more about the Lutheran faith? Our pastors offer adult instruction covering Scripture, the Apostles\' Creed, and what we believe. Classes are by arrangement — contact Pastor Dinger to get started.', leader: 'Pastor Dinger', location: '', schedule: 'By arrangement · dinger@timothystl.org', accent: 'plum', sort_order: 7 },
        ];
        for (const c of INITIAL_CLASSES) {
          await env.DB.prepare('INSERT INTO bible_classes (title, label, description, leader, location, schedule, accent, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)').bind(c.title, c.label, c.description, c.leader, c.location, c.schedule, c.accent, c.sort_order).run();
        }
      }
    } catch (_) {}
    // Link tree cards
    try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS link_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      url TEXT NOT NULL,
      icon_emoji TEXT DEFAULT '🔗',
      icon_color TEXT DEFAULT 'sky',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    )`).run(); } catch (_) {}
    // Pre-populate link cards from the current static links page (only if table is empty)
    try {
      const lcCount = await env.DB.prepare('SELECT COUNT(*) as n FROM link_cards').first();
      if (!lcCount || lcCount.n === 0) {
        const INITIAL_LINKS = [
          { title: 'Get Connected',  description: "We'd love to know you — say hello",          url: 'https://timothystl.org/contact',  icon_emoji: '👋', icon_color: 'sage',  sort_order: 1 },
          { title: 'Prayer Request', description: "Share what's on your heart — we carry it with you", url: 'https://timothystl.org/prayer',  icon_emoji: '🙏', icon_color: 'mist',  sort_order: 2 },
          { title: 'Give',           description: 'Support the ministry of Timothy',             url: 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8', icon_emoji: '💛', icon_color: 'amber', sort_order: 3 },
          { title: 'Serve',          description: 'Find your place to serve',                    url: 'https://serve.timothystl.org',  icon_emoji: '🙌', icon_color: 'sage',  sort_order: 4 },
          { title: 'News & Events',  description: "What's coming up at Timothy",                 url: 'https://timothystl.org/news',       icon_emoji: '📰', icon_color: 'sky',   sort_order: 5 },
          { title: 'Sermon Notes',   description: 'Take today\'s message home with you',         url: 'https://timothystl.org/sermons',    icon_emoji: '📖', icon_color: 'sky',   sort_order: 6 },
        ];
        for (const lc of INITIAL_LINKS) {
          await env.DB.prepare('INSERT INTO link_cards (title, description, url, icon_emoji, icon_color, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)')
            .bind(lc.title, lc.description, lc.url, lc.icon_emoji, lc.icon_color, lc.sort_order).run();
        }
      }
    } catch (_) {}
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
      { key: 'education-schedule',     label: 'Christian Education schedule &amp; topics', hint: 'Shown on the Learn / Christian Education page. Add current class topics, semester schedule, or special events. Leave blank to hide.' },
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
    // Migrate staff photos from .jpg/.png to .webp (files converted in 18905d0)
    try {
      await env.DB.prepare("UPDATE staff_members SET photo_url = REPLACE(REPLACE(photo_url, '.jpg', '.webp'), '.png', '.webp') WHERE photo_url LIKE '%.jpg' OR photo_url LIKE '%.png'").run();
    } catch (_) {}
    // Fix missing photo for Chau Vo (chauvo.jpg never existed)
    try { await env.DB.prepare("UPDATE staff_members SET photo_url = '' WHERE name = 'Chau Vo' AND photo_url LIKE '%chauvo%'").run(); } catch (_) {}
    // Migrate give_url from Breeze to Tithely
    try {
      await env.DB.prepare("UPDATE site_settings SET value = ? WHERE key = 'give_url' AND value LIKE '%breezechms%'")
        .bind('https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8').run();
    } catch (_) {}
    // Migrate gym_admin_email from old default to dinger@
    try {
      await env.DB.prepare("UPDATE site_settings SET value = 'dinger@timothystl.org' WHERE key = 'gym_admin_email' AND value = 'office@timothystl.org'").run();
    } catch (_) {}
    // Auth tables
    try { await env.DB.prepare(DB_INIT_USERS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_SESSIONS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_AUDIT_LOG).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_PASSWORD_RESETS).run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE users ADD COLUMN email TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN hero_image_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN ministry_image_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN vid_1_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN vid_1_title TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN vid_2_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN vid_2_title TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN vid_3_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN vid_3_title TEXT').run(); } catch (_) {}
    // Migrate: newsletter approval workflow
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN approval_status TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN approved_by_username TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE gym_invoices ADD COLUMN booking_ids TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE gym_groups ADD COLUMN rate REAL').run(); } catch (_) {}
    try { await env.DB.prepare("ALTER TABLE gym_invoices ADD COLUMN rate_type TEXT DEFAULT 'hourly'").run(); } catch (_) {}
    try { await env.DB.prepare("ALTER TABLE gym_groups ADD COLUMN rate_type TEXT DEFAULT 'hourly'").run(); } catch (_) {}
    try { await env.DB.prepare("ALTER TABLE staff_members ADD COLUMN photo_position TEXT DEFAULT '50% 50%'").run(); } catch (_) {}
    try { await env.DB.prepare("ALTER TABLE staff_members ADD COLUMN photo_zoom REAL DEFAULT 1").run(); } catch (_) {}
    // Migrate: grant users_manage + audit_view to existing full-admin accounts that predate those permissions
    try {
      await env.DB.prepare(
        `UPDATE users SET permissions = '["newsletter_edit","newsletter_approve","news_edit","ministries_edit","sermons_edit","pages_edit","staff_edit","settings_manage","gym_manage","users_manage","audit_view"]'
         WHERE permissions LIKE '%"gym_manage"%' AND permissions NOT LIKE '%"users_manage"%'`
      ).run();
    } catch (_) {}
    // Migrate: grant links_edit to existing full-admin accounts
    try {
      await env.DB.prepare(
        `UPDATE users SET permissions = '["newsletter_edit","newsletter_approve","news_edit","ministries_edit","sermons_edit","pages_edit","staff_edit","settings_manage","gym_manage","users_manage","audit_view","links_edit"]'
         WHERE permissions LIKE '%"audit_view"%' AND permissions NOT LIKE '%"links_edit"%'`
      ).run();
    } catch (_) {}
    // Migrate: grant the new payroll_manage permission to accounts that could
    // already reach /payroll under the old (settings_manage-gated) sidebar link,
    // so this permission split doesn't lock anyone out who had access before.
    try {
      await env.DB.prepare(
        `UPDATE users SET permissions = REPLACE(permissions, '[', '["payroll_manage",')
         WHERE permissions LIKE '%"settings_manage"%' AND permissions NOT LIKE '%"payroll_manage"%'`
      ).run();
    } catch (_) {}
    // Same precedent as payroll_manage above: grant giving_manage to accounts that could
    // already manage the old Redirects-tab "Giving Links" section under settings_manage,
    // so splitting it into its own permission doesn't lock anyone out who had access before.
    try {
      await env.DB.prepare(
        `UPDATE users SET permissions = REPLACE(permissions, '[', '["giving_manage",')
         WHERE permissions LIKE '%"settings_manage"%' AND permissions NOT LIKE '%"giving_manage"%'`
      ).run();
    } catch (_) {}
    // Migrate: scheduled send (Brevo campaign scheduling)
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN scheduled_send_at TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN scheduled_list_type TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN brevo_campaign_id TEXT').run(); } catch (_) {}
    // ── Ministry page blocks (block-based page editor) ──
    // The legacy content/hero/video/CTA columns stay exactly where they are —
    // they are the rollback path until every page has been published from the
    // new editor at least once.
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN blocks TEXT').run(); } catch (_) {}            // JSON working draft
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN published_blocks TEXT').run(); } catch (_) {}   // JSON the public site renders
    try { await env.DB.prepare("ALTER TABLE youth_pages ADD COLUMN page_status TEXT DEFAULT 'live'").run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN publish_at TEXT').run(); } catch (_) {}         // ISO8601 or NULL
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN change_log TEXT').run(); } catch (_) {}         // JSON, survives a reload
    // Sermons are series → sermons with no recording attached yet. The column
    // exists now so the Sermon block can branch on it: with media it renders a
    // play card, without one a text card. When recordings start, every Sermon
    // block on the site upgrades itself with no edit.
    try { await env.DB.prepare('ALTER TABLE sermon_notes ADD COLUMN audio_url TEXT').run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_MINISTRY_MEDIA).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_MINISTRY_REVISIONS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_MINISTRY_SECTIONS).run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ministry_revisions_slug ON ministry_page_revisions(slug, published_at DESC)').run(); } catch (_) {}
    // One-time backfill: wrap each page's legacy content into blocks so the
    // editor opens on the real page rather than an empty canvas, and the
    // public site keeps rendering exactly what it rendered before. Only pages
    // that have never been converted are touched.
    try {
      const legacyPages = await env.DB.prepare(
        'SELECT slug, title, content, has_posts, cta_label, cta_url, cta_label_2, cta_url_2, hero_image_url, ministry_image_url, ' +
        'vid_1_url, vid_1_title, vid_2_url, vid_2_title, vid_3_url, vid_3_title FROM youth_pages WHERE blocks IS NULL'
      ).all();
      for (const lp of legacyPages.results || []) {
        const migrated = JSON.stringify(migrateLegacyPage(lp));
        await env.DB.prepare(
          "UPDATE youth_pages SET blocks = ?, published_blocks = ?, page_status = COALESCE(page_status, 'live') WHERE slug = ? AND blocks IS NULL"
        ).bind(migrated, migrated, lp.slug).run();
      }
    } catch (_) {}

    // ── Whole-page blocks ──
    // Each ministry page's hardcoded sections, converted to blocks by
    // tools/extract-page-seeds.mjs, are seeded into the DRAFT so staff can take
    // the whole page over in the editor instead of only the region near the
    // bottom. Written to `blocks` only — never `published_blocks` — so the live
    // page keeps rendering exactly as it does today until someone opens the
    // editor, looks it over and presses Publish. Skipped for any page whose
    // draft already leads with a hero, i.e. one that has already been taken over.
    try {
      for (const [seedSlug, seedBlocks] of Object.entries(PAGE_SEEDS)) {
        const row = await env.DB.prepare('SELECT slug, blocks, published_blocks FROM youth_pages WHERE slug = ?').bind(seedSlug).first();
        if (!row) continue;
        const draft = sanitizeBlocks(parseBlocks(row.blocks));
        if (draft.some((b) => b.type === 'hero')) continue;      // already taken over
        const published = sanitizeBlocks(parseBlocks(row.published_blocks));
        if (published.some((b) => b.type === 'hero')) continue;
        // The page's existing admin-managed content still belongs to it: keep
        // those blocks after the converted ones rather than dropping them.
        const combined = sanitizeBlocks(sanitizeBlocks(seedBlocks).concat(draft));
        await env.DB.prepare("UPDATE youth_pages SET blocks = ?, page_status = 'draft' WHERE slug = ?")
          .bind(JSON.stringify(combined), seedSlug).run();
      }
    } catch (e) { console.error('Page seed failed:', e && e.message); }

    // ── Site pages ──
    // Every page on the site becomes a row. Seeded from admin/site-pages.js,
    // generated by tools/extract-pages.mjs out of the hardcoded markup that
    // renders the site today. `published_blocks` is deliberately left NULL:
    // until someone opens a page in the editor and presses Publish, the public
    // site keeps rendering its hardcoded version, so this migration cannot
    // change what a visitor sees.
    //
    // Only pages that do not exist yet are inserted. A page staff have already
    // touched is never overwritten, so re-running this is safe.
    try {
      await env.DB.prepare(DB_INIT_PAGES).run();
      await env.DB.prepare(DB_INIT_PAGE_REDIRECTS).run();
      await env.DB.prepare(DB_INIT_PAGE_REVISIONS).run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_pages_menu ON pages(parent_id, sort)').run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_page_revisions_page ON page_revisions(page_id, created_at DESC)').run();
      const now = new Date().toISOString();
      for (const p of SITE_PAGES) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO pages (id, title, menu_label, slug, parent_id, sort, template, status, in_menu, seo_description, blocks, updated_at, updated_by) ' +
          "VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, 'migration')"
        ).bind(p.id, p.title, p.menu_label || '', p.slug, p.parent_id, p.sort, p.template, p.in_menu,
               p.seo_description || '', JSON.stringify(sanitizeBlocks(p.blocks)), now).run();
      }
    } catch (e) { console.error('Site page seed failed:', e && e.message); }

    // Performance indexes
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_news_items_publish_date ON news_items(publish_date)').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ministry_posts_slug ON ministry_posts(ministry_slug)').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_events_newsletter_id ON events(newsletter_id)').run(); } catch (_) {}

    // Mark schema as current so subsequent requests skip the whole block.
    try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run(); } catch (_) {}
    try { await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES ('version', ?)").bind(SCHEMA_VERSION).run(); } catch (_) {}
    } // end if (!schemaOk)

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

    // ── PUBLIC: site pages API ──
    // One call gives the public site its navigation and, for any page that has
    // been published from the editor, the finished HTML for that page. Pages
    // with no published blocks are simply absent from `rendered`, and the site
    // falls back to its own hardcoded markup — that fallback is what lets the
    // site be converted one page at a time.
    if (path === '/api/pages' && method === 'GET') {
      const publicPage = (r) => ({
        id: r.id, title: r.title, label: r.menu_label || r.title, slug: r.slug,
        parent: r.parent_id || null, in_menu: !!r.in_menu, template: r.template,
        seo_description: r.seo_description || '',
      });
      const rows = await env.DB.prepare(
        "SELECT id, title, menu_label, slug, parent_id, sort, template, in_menu, seo_description, published_blocks " +
        "FROM pages WHERE status = 'published' ORDER BY sort ASC, title ASC"
      ).all().catch(() => ({ results: [] }));
      const list = rows.results || [];
      const fixUrl = (s) => s ? s.replace(/src="\/images\//g, 'src="https://admin.timothystl.org/images/') : s;
      const data = await pageData(env, ctx);
      const rendered = {};
      for (const r of list) {
        const blocks = sanitizeBlocks(parseBlocks(r.published_blocks));
        if (!blocks.length) continue;
        const children = list.filter((c) => c.parent_id === r.id).map(publicPage);
        // The stylesheet ships once for the whole response, not once per page.
        rendered[r.id] = fixUrl(renderPage(blocks, { slug: r.id, template: r.template, data, children, withCss: false }));
      }
      const redirects = await env.DB.prepare('SELECT from_slug, to_slug FROM page_redirects').all().catch(() => ({ results: [] }));
      return new Response(JSON.stringify({
        pages: list.map(publicPage),
        rendered,
        css: Object.keys(rendered).length ? BLOCK_CSS : '',
        redirects: (redirects.results || []).reduce((acc, r) => (acc[r.from_slug] = r.to_slug, acc), {}),
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' }
      });
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
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: youth page content API (legacy — keep for compat) ──
    if (path.startsWith('/api/youth/') && method === 'GET') {
      const slug = path.slice('/api/youth/'.length);
      const row = await env.DB.prepare('SELECT slug, title, content, updated_at FROM youth_pages WHERE slug = ?').bind(slug).first();
      if (!row) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(row), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
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
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
        });
      }
      const row = await env.DB.prepare('SELECT slug, title, content, has_posts, cta_label, cta_url, cta_label_2, cta_url_2, hero_image_url, ministry_image_url, vid_1_url, vid_1_title, vid_2_url, vid_2_title, vid_3_url, vid_3_title, updated_at, published_blocks, page_status FROM youth_pages WHERE slug = ?').bind(slug).first();
      if (!row) return new Response('Not found', { status: 404 });
      const fixUrl = s => s ? s.replace(/src="\/images\//g, 'src="https://admin.timothystl.org/images/') : s;
      // Block-rendered pages: hand the public site finished HTML from the very
      // same templates the editor canvas draws, so what staff saw is what
      // visitors get. Pages still on the legacy renderer send no blocks_html
      // and the site falls back to `content` exactly as before.
      const pubBlocks = row.page_status === 'hidden' ? [] : parseBlocks(row.published_blocks);
      const blocksHtml = pubBlocks.length
        ? fixUrl(renderPage(sanitizeBlocks(pubBlocks), { slug, data: await pageData(env, ctx) }))
        : '';
      const { published_blocks, ...publicRow } = row;
      return new Response(JSON.stringify({ ...publicRow, content: fixUrl(row.content), blocks_html: blocksHtml }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: page content blocks API ──
    if (path.startsWith('/api/page-content/') && method === 'GET') {
      const key = path.slice('/api/page-content/'.length);
      const row = await env.DB.prepare('SELECT key, label, value, published FROM page_content WHERE key = ?').bind(key).first();
      if (!row) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(row), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: self-serve notices API — one or more banners per static page ──
    if (path.startsWith('/api/notices/') && method === 'GET') {
      const slug = path.slice('/api/notices/'.length);
      const rows = await env.DB.prepare(
        'SELECT id, label, body FROM notices WHERE page_slug = ? AND published = 1 AND body IS NOT NULL AND trim(body) != \'\' ORDER BY position ASC, id ASC'
      ).bind(slug).all();
      return new Response(JSON.stringify({ notices: rows.results }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: staff API ──
    if (path === '/api/staff' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT id, name, title, email, photo_url, photo_position, photo_zoom, bio, display_order FROM staff_members ORDER BY display_order, id').all();
      return new Response(JSON.stringify(rows.results), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: site settings API ──
    // Only a small allowlist of keys is exposed publicly. Internal config
    // (gym rates, calendar IDs, admin emails) and any future *_key/*_secret
    // values must NEVER be readable without auth.
    if (path.startsWith('/api/settings/') && method === 'GET') {
      const key = path.slice('/api/settings/'.length);
      if (!PUBLIC_SETTINGS_KEYS.has(key)) return new Response('Not found', { status: 404 });
      const row = await env.DB.prepare('SELECT key, value FROM site_settings WHERE key = ?').bind(key).first();
      if (!row) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(row), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: bible classes API ──
    if (path === '/api/bible-classes' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT id, title, label, description, leader, location, schedule, accent FROM bible_classes WHERE active = 1 ORDER BY sort_order, id').all();
      return new Response(JSON.stringify({ classes: rows.results || [] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: link cards API ──
    if (path === '/api/link-cards' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT id, title, description, url, icon_emoji, icon_color FROM link_cards WHERE active = 1 ORDER BY sort_order, id').all();
      return new Response(JSON.stringify({ cards: rows.results || [] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }
      });
    }

    // ── PUBLIC: newsletter archive API ──
    if (path === '/api/newsletters' && method === 'GET') {
      const [rows, allEvts] = await Promise.all([
        env.DB.prepare("SELECT id, subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, created_at FROM newsletters WHERE (status IS NULL OR status = 'published') ORDER BY published_at DESC").all(),
        env.DB.prepare('SELECT * FROM events ORDER BY event_date, sort_order').all()
      ]);
      const evtsByNewsletter = {};
      for (const e of allEvts.results) {
        if (!evtsByNewsletter[e.newsletter_id]) evtsByNewsletter[e.newsletter_id] = [];
        evtsByNewsletter[e.newsletter_id].push(e);
      }
      const newsletters = rows.results.map(row => ({ ...row, events: evtsByNewsletter[row.id] || [] }));
      return new Response(JSON.stringify(newsletters), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: single newsletter ──
    if (path.startsWith('/api/newsletter/') && method === 'GET') {
      const id = path.split('/').pop();
      const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(id).first();
      if (!row) return new Response('Not found', { status: 404 });
      const evts = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY event_date, sort_order').bind(id).all();

      // Resolve the newsletter's featured news items so the website can render
      // the same Featured / More-from-Timothy sections shown in the email.
      const newsIds = (row.news_item_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      let newsItems = [];
      if (newsIds.length > 0) {
        const placeholders = newsIds.map(() => '?').join(',');
        const newsRows = await env.DB.prepare(
          `SELECT id, title, summary, image_url FROM news_items WHERE id IN (${placeholders})`
        ).bind(...newsIds).all();
        const newsMap = Object.fromEntries(newsRows.results.map(r => [String(r.id), r]));
        newsItems = newsIds.map(nid => newsMap[nid]).filter(Boolean);
      }
      let bibleClasses = [];
      try { bibleClasses = JSON.parse(row.bible_classes || '[]'); } catch (_) {}

      return new Response(JSON.stringify({ ...row, events: evts.results, news_items: newsItems, bible_classes: bibleClasses }), {
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
        const html = `<p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${email ? escapeHtml(email) : '(not provided)'}</p><p><strong>Message:</strong></p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
        const result = await sendTransactionalEmail(env, {
          subject: `Contact Form — ${name}`,
          htmlContent: html,
          toEmails: ['dinger@timothystl.org'],
          replyTo: email ? { email, name } : undefined
        });
        if (result.error) return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders });
        // Confirmation email to user
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await sendTransactionalEmail(env, {
            subject: 'We received your message — Timothy Lutheran Church',
            htmlContent: `<p>Hi ${escapeHtml(name)},</p><p>Thank you for reaching out to Timothy Lutheran Church. We received your message and will be in touch soon.</p><p>If you need immediate assistance, please call us at (314) 781-8673 or email <a href="mailto:dinger@timothystl.org">dinger@timothystl.org</a>.</p><p>Grace and peace,<br>The team at Timothy Lutheran Church</p>`,
            toEmails: [email]
          });
        }
        ctx.waitUntil((async () => {
          try {
            const intakeReq = new Request('https://serve.timothystl.org/api/intake/connect-card', {
              method: 'POST',
              headers: {
                'X-Intake-Key': env.CHMS_INTAKE_API_KEY || '',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                name: name,
                email: email,
                message: message,
                source: 'website-contact',
              })
            });
            const chmsRes = env.VOLUNTEER_WORKER
              ? await env.VOLUNTEER_WORKER.fetch(intakeReq)
              : await fetch(intakeReq);
            if (!chmsRes.ok) {
              const body = await chmsRes.text().catch(() => '');
              console.error(`ChMS intake forward failed (contact): HTTP ${chmsRes.status} — ${body}`);
            }
          } catch (e) {
            console.error('ChMS intake forward failed (contact):', e?.message);
          }
        })());
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
        const htmlContent = `<p><strong>Name:</strong> ${name ? escapeHtml(name) : '(anonymous)'}</p><p><strong>Email:</strong> ${email ? escapeHtml(email) : '(not provided)'}</p><p><strong>Prayer request:</strong></p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
        const result = await sendTransactionalEmail(env, {
          subject: `Prayer Request — ${name || 'Anonymous'}`,
          htmlContent,
          toEmails: ['dinger@timothystl.org'],
          replyTo: email ? { email, name } : undefined
        });
        if (result.error) return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders });
        // Confirmation email to user
        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await sendTransactionalEmail(env, {
            subject: "We're praying for you — Timothy Lutheran Church",
            htmlContent: `<p>Hi ${name ? escapeHtml(name) : 'friend'},</p><p>Thank you for sharing your prayer request with us. Our pastoral staff has received it and will be praying for you.</p><p>If you'd like to speak with someone, please reach out to our office at <a href="mailto:dinger@timothystl.org">dinger@timothystl.org</a> or call (314) 781-8673.</p><p>Grace and peace,<br>The pastoral staff at Timothy Lutheran Church</p>`,
            toEmails: [email]
          });
        }
        ctx.waitUntil((async () => {
          try {
            const intakeReq = new Request('https://serve.timothystl.org/api/intake/prayer', {
              method: 'POST',
              headers: {
                'X-Intake-Key': env.CHMS_INTAKE_API_KEY || '',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                name: name,
                email: email,
                message: message,
                source: 'website-prayer',
                is_urgent: 0,
              })
            });
            const chmsRes = env.VOLUNTEER_WORKER
              ? await env.VOLUNTEER_WORKER.fetch(intakeReq)
              : await fetch(intakeReq);
            if (!chmsRes.ok) {
              const body = await chmsRes.text().catch(() => '');
              console.error(`ChMS intake forward failed (prayer): HTTP ${chmsRes.status} — ${body}`);
            }
          } catch (e) {
            console.error('ChMS intake forward failed (prayer):', e?.message);
          }
        })());
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ── PUBLIC: newsletter subscribe API ──
    if (path === '/api/subscribe' && method === 'POST') {
      const corsH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      try {
        const form = await request.formData();
        if (form.get('website')) return new Response(JSON.stringify({ success: true }), { headers: corsH }); // honeypot
        const email = (form.get('email') || '').trim().toLowerCase();
        const name = (form.get('name') || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), { status: 400, headers: corsH });
        }
        // Add to Brevo contacts list
        const listId = parseInt(env.BREVO_LIST_ID || '2');
        const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, attributes: { FIRSTNAME: name }, listIds: [listId], updateEnabled: true })
        });
        if (!brevoRes.ok && brevoRes.status !== 204) {
          const err = await brevoRes.json().catch(() => ({}));
          // Status 400 with code "duplicate_parameter" means already on list — treat as success
          if (!(err.code === 'duplicate_parameter' || brevoRes.status === 400)) {
            throw new Error(err.message || 'Email service error');
          }
        }
        // Log to D1 (ignore duplicate emails)
        await env.DB.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email, name) VALUES (?, ?)').bind(email, name || null).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsH });
      } catch(e) {
        return new Response(JSON.stringify({ error: 'Something went wrong. Please try again or contact us directly.' }), { status: 500, headers: corsH });
      }
    }

    // ── PUBLIC: voters page data ──
    if (path === '/api/voters' && method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM voters_page WHERE id = 1').first();
      const data = row || { meeting_info: '', zoom_link: '', files_json: '[]' };
      let files = [];
      try { files = JSON.parse(data.files_json || '[]'); } catch(_) {}
      return new Response(JSON.stringify({ meeting_info: data.meeting_info || '', zoom_link: data.zoom_link || '', files }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' }
      });
    }

    // ── PUBLIC: custom redirects API ── only active rows resolve for visitors
    if (path === '/api/redirects' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT path, url, label FROM redirects WHERE active != 0 ORDER BY path').all();
      return new Response(JSON.stringify({ redirects: rows.results }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: give.timothystl.org amount tiers ── consumed by the website repo's
    // site-worker.js when rendering the giving landing page (same fetch-and-cache pattern
    // as /api/redirects above). The base Tithe.ly link is fetched separately via the
    // existing /api/settings/give_url endpoint below — not duplicated here.
    if (path === '/api/give-amounts' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT amount, url, is_default FROM give_amount_tiers WHERE active != 0 ORDER BY sort_order').all();
      const tiers = rows.results.map(r => ({
        amount: r.amount,
        url: r.url || '',
        isDefault: !!r.is_default,
      }));
      return new Response(JSON.stringify({ tiers }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: give.timothystl.org fund selector ── same fetch-and-cache pattern.
    if (path === '/api/give-funds' && method === 'GET') {
      const rows = await env.DB.prepare('SELECT id, name, tithely_fund_id, is_default FROM give_funds WHERE active != 0 ORDER BY sort_order').all();
      const funds = rows.results.map(r => ({
        id: r.id,
        name: r.name,
        tithelyFundId: r.tithely_fund_id || '',
        isDefault: !!r.is_default,
      }));
      return new Response(JSON.stringify({ funds }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: sermon series API ──
    if (path === '/api/sermon-series' && method === 'GET') {
      const [seriesRows, notesRows] = await Promise.all([
        env.DB.prepare('SELECT * FROM sermon_series ORDER BY active DESC, sort_order ASC, id DESC').all(),
        env.DB.prepare("SELECT * FROM sermon_notes WHERE (date IS NULL OR date >= date('now', '-1 year')) ORDER BY date DESC, id DESC").all()
      ]);
      const notesBySeries = {};
      const standalone = [];
      for (const n of notesRows.results) {
        if (n.series_id) {
          if (!notesBySeries[n.series_id]) notesBySeries[n.series_id] = [];
          notesBySeries[n.series_id].push(n);
        } else {
          if (standalone.length < 20) standalone.push(n);
        }
      }
      const result = seriesRows.results.map(s => ({ ...s, notes: notesBySeries[s.id] || [] }));
      return new Response(JSON.stringify({ series: result, standalone }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC GYM ROUTES (no auth) ────────────────────────────
    // Group booking portal (/gym/book/:token/*) and iCal feeds (/gym/cal/*.ics)
    if (path.startsWith('/gym/book/') || path.startsWith('/gym/cal/')) {
      const r = await handleGymRoutes(path, method, url, request, env, null, ctx);
      if (r) return r;
    }

    // ── FORGOT / RESET PASSWORD ────────────────────────────────
    if (path === '/forgot-password') {
      if (method === 'GET') return forgotPasswordPage();
      if (method === 'POST') {
        const form = await request.formData();
        const email = (form.get('email') || '').trim().toLowerCase();
        if (email) {
          const user = await env.DB.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND active = 1').bind(email).first().catch(() => null);
          if (user) {
            const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
            await env.DB.prepare('INSERT INTO password_resets (token, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)')
              .bind(token, user.id, expiresAt, new Date().toISOString()).run();
            const origin = new URL(request.url).origin;
            const resetLink = `${origin}/reset-password?token=${token}`;
            await sendTransactionalEmail(env, {
              subject: 'Reset your TLC Admin password',
              toEmails: [email],
              htmlContent: `<p>Hi,</p><p>Someone requested a password reset for your Timothy Lutheran Church admin account. Click the link below to set a new password. This link expires in 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can ignore this email — your password has not been changed.</p><p>Grace and peace,<br>Timothy Lutheran Church</p>`
            });
          }
        }
        // Always show the same message to avoid revealing whether an email is on file
        return forgotPasswordPage('If that email is on file, you\'ll receive a reset link shortly. Check your spam folder if it doesn\'t arrive within a few minutes.');
      }
    }

    if (path === '/reset-password') {
      const token = url.searchParams.get('token') || '';
      if (method === 'GET') {
        if (!token) return new Response('', { status: 302, headers: { Location: '/forgot-password' } });
        const row = await env.DB.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').bind(token).first().catch(() => null);
        if (!row || new Date(row.expires_at) < new Date()) {
          return forgotPasswordPage('', 'That reset link has expired or already been used. Request a new one below.');
        }
        return resetPasswordPage(token);
      }
      if (method === 'POST') {
        const form = await request.formData();
        const formToken = (form.get('token') || '').trim();
        const password = form.get('password') || '';
        const password2 = form.get('password2') || '';
        if (!formToken) return new Response('', { status: 302, headers: { Location: '/forgot-password' } });
        const row = await env.DB.prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0').bind(formToken).first().catch(() => null);
        if (!row || new Date(row.expires_at) < new Date()) {
          return forgotPasswordPage('', 'That reset link has expired or already been used. Request a new one below.');
        }
        if (!password || password.length < 8) return resetPasswordPage(formToken, 'Password must be at least 8 characters.');
        if (password !== password2) return resetPasswordPage(formToken, 'Passwords do not match.');
        const hash = await hashPassword(password);
        await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, row.user_id).run();
        await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').bind(formToken).run();
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id).run();
        return loginPage('', 'Password updated. Please sign in with your new password.');
      }
    }

    // ── SETUP (first-run, no users exist yet) ──
    if (path === '/setup') {
      const userCount = await env.DB.prepare('SELECT COUNT(*) as n FROM users').first().catch(() => ({ n: 0 }));
      if (userCount && userCount.n > 0) return new Response('', { status: 302, headers: { Location: '/login' } });
      if (method === 'GET') return setupPage();
      if (method === 'POST') {
        const form = await request.formData();
        const username = (form.get('username') || '').trim();
        const password = form.get('password') || '';
        const password2 = form.get('password2') || '';
        if (!username || !password) return setupPage('Username and password are required.');
        if (password !== password2) return setupPage('Passwords do not match.');
        if (password.length < 8) return setupPage('Password must be at least 8 characters.');
        const hash = await hashPassword(password);
        // Re-check inside the critical section to guard against two parallel
        // /setup POSTs both passing the initial count check.
        const recheck = await env.DB.prepare('SELECT COUNT(*) as n FROM users').first().catch(() => ({ n: 1 }));
        if (recheck && recheck.n > 0) return new Response('', { status: 302, headers: { Location: '/login' } });
        try {
          await env.DB.prepare(
            'INSERT INTO users (username, password_hash, permissions, created_at, active) VALUES (?, ?, ?, ?, 1)'
          ).bind(username, hash, JSON.stringify(ALL_PERMISSIONS), new Date().toISOString()).run();
        } catch (_) {
          // UNIQUE(username) constraint — another request beat us. Fall through to login.
        }
        return new Response('', { status: 302, headers: { Location: '/login' } });
      }
    }

    // ── LOGIN ──
    if (path === '/login' && method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || '';
      // Rate limit: block after 10 failures from the same IP in 15 minutes.
      // Reuses audit_log rows written on each failure — no extra table needed.
      if (ip) {
        const recent = await env.DB.prepare(
          `SELECT COUNT(*) as n FROM audit_log WHERE action = 'login_failed' AND entity_label = ? AND created_at > datetime('now', '-15 minutes')`
        ).bind(ip).first().catch(() => ({ n: 0 }));
        if ((recent?.n || 0) >= 10) {
          return loginPage('Too many failed attempts. Please wait 15 minutes before trying again.');
        }
      }
      const form = await request.formData();
      const username = (form.get('username') || '').trim();
      const password = form.get('password') || '';
      const user = username
        ? await env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1').bind(username).first().catch(() => null)
        : null;
      if (user && await verifyPassword(password, user.password_hash)) {
        const token = await createSession(env.DB, user);
        return new Response('', {
          status: 302,
          headers: { Location: '/', 'Set-Cookie': sessionCookieHeader(token) }
        });
      }
      await logAudit(env.DB, { id: null, username: username || '(empty)' }, 'login_failed', 'auth', '', ip, null, null);
      return loginPage('Incorrect username or password.');
    }

    const setupCheck = await env.DB.prepare('SELECT COUNT(*) as n FROM users').first().catch(() => ({ n: 1 }));
    if (!setupCheck || setupCheck.n === 0) {
      return new Response('', { status: 302, headers: { Location: '/setup' } });
    }
    const currentUser = await getSession(env.DB, request);
    if (!currentUser) {
      if (path === '/login') return loginPage();
      return loginPage();
    }

    // ── DASHBOARD (new post-login landing page) ──
    if (path === '/dashboard' && method === 'GET') {
      const canNews = hasPermission(currentUser, 'news_edit');
      const canDraft = hasPermission(currentUser, 'newsletter_edit') || hasPermission(currentUser, 'newsletter_approve');
      const canApprove = hasPermission(currentUser, 'newsletter_approve');
      const canGym = hasPermission(currentUser, 'gym_manage');
      const canMinistries = hasPermission(currentUser, 'ministries_edit');

      const [draftRow, pendingRow, gymHoldRow, liveNewsRow] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) as n FROM newsletters WHERE status='draft'").first(),
        env.DB.prepare("SELECT COUNT(*) as n FROM newsletters WHERE approval_status='pending'").first(),
        canGym ? env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE status='hold'").first() : Promise.resolve({ n: 0 }),
        env.DB.prepare("SELECT COUNT(*) as n FROM news_items WHERE expire_date IS NULL OR expire_date >= date('now')").first(),
      ]);

      const statCards = [];
      if (canDraft) statCards.push({ label: 'Drafts waiting', num: draftRow.n, color: 'var(--amber)', note: draftRow.n === 1 ? '1 newsletter in progress' : `${draftRow.n} newsletters in progress` });
      if (canApprove) statCards.push({ label: 'Pending approval', num: pendingRow.n, color: '#B85C3A', note: pendingRow.n > 0 ? 'Waiting on your review' : 'All caught up' });
      if (canGym) statCards.push({ label: 'Gym holds', num: gymHoldRow.n, color: 'var(--steel)', note: gymHoldRow.n > 0 ? 'Need confirm or release' : 'No pending holds' });
      if (canNews) statCards.push({ label: 'Live news items', num: liveNewsRow.n, color: 'var(--sage)', note: 'Currently on the site' });

      // ── "Needs your attention" ──
      const attn = [];
      if (canApprove) {
        const pendingNl = await env.DB.prepare("SELECT id, subject, created_at FROM newsletters WHERE approval_status='pending' ORDER BY created_at ASC").all();
        for (const r of pendingNl.results) {
          const ageMs = Date.now() - new Date(r.created_at || 0).getTime();
          const recent = ageMs < 2 * 24 * 60 * 60 * 1000;
          attn.push({ dot: recent ? 'var(--amber)' : 'var(--gray)', title: `&ldquo;${escapeHtml(r.subject)}&rdquo; newsletter`, meta: 'Awaiting approval', action: 'Review', href: `/edit/${r.id}` });
        }
      }
      if (canGym) {
        const holds = await env.DB.prepare(
          `SELECT gb.group_id, gg.name as group_name, COUNT(*) as n, MIN(gb.hold_expires_at) as soonest
           FROM gym_bookings gb LEFT JOIN gym_groups gg ON gg.id = gb.group_id
           WHERE gb.status='hold' GROUP BY gb.group_id ORDER BY soonest ASC`
        ).all();
        for (const g of holds.results) {
          const expiringSoon = g.soonest && (new Date(g.soonest).getTime() - Date.now()) < 48 * 60 * 60 * 1000;
          attn.push({
            dot: expiringSoon ? '#B85C3A' : 'var(--steel)',
            title: `${g.n} gym hold${g.n !== 1 ? 's' : ''} from ${escapeHtml(g.group_name || 'Unassigned')}`,
            meta: expiringSoon ? 'Hold expiring soon' : 'Awaiting confirmation',
            action: 'Confirm', href: '/gym-rentals',
          });
        }
      }
      if (canNews) {
        const soonExpire = await env.DB.prepare(
          "SELECT id, title, expire_date FROM news_items WHERE expire_date IS NOT NULL AND expire_date >= date('now') AND expire_date <= date('now','+3 days') ORDER BY expire_date ASC"
        ).all();
        for (const it of soonExpire.results) {
          attn.push({ dot: '#B85C3A', title: `&ldquo;${escapeHtml(it.title)}&rdquo; news item`, meta: `Expires ${it.expire_date}`, action: 'Extend', href: `/newsitems/edit/${it.id}` });
        }
      }
      if (canMinistries) {
        const slugLabels = { confirmation: 'Confirmation', sundayschool: 'Sunday School', vbs: 'VBS', egghunt: 'Egg Hunt', family: 'Family Ministry' };
        const slugs = Object.keys(slugLabels);
        const placeholders = slugs.map(() => '?').join(',');
        const yp = await env.DB.prepare(`SELECT slug, content FROM youth_pages WHERE slug IN (${placeholders})`).bind(...slugs).all();
        const haveContent = new Set(yp.results.filter(r => r.content && r.content.trim()).map(r => r.slug));
        for (const slug of slugs) {
          if (!haveContent.has(slug)) attn.push({ dot: 'var(--gray)', title: `${slugLabels[slug]} page still empty`, meta: 'Youth page needs content', action: 'Nudge', href: '/ministries' });
        }
      }
      const attnCapped = attn.slice(0, 6);

      const attnHtml = attnCapped.length === 0
        ? `<div style="text-align:center;padding:32px;color:var(--gray);font-family:var(--sans);font-size:14px;">You&rsquo;re all caught up. 🎉</div>`
        : attnCapped.map(a => `<div class="attn-row">
  <span class="attn-dot" style="background:${a.dot};"></span>
  <div class="attn-title">${a.title}<span class="attn-meta">${a.meta}</span></div>
  <a href="${a.href}" class="btn btn-sm" style="background:var(--mist);color:var(--steel);">${a.action}</a>
</div>`).join('');

      // ── Quick add ──
      const quickAdd = [
        canNews ? `<a href="/newsitems/new" class="btn btn-primary" style="width:100%;justify-content:center;">+ News item</a>` : '',
        canDraft ? `<a href="/new" class="btn" style="width:100%;justify-content:center;background:var(--mist);color:var(--steel);">+ Newsletter draft</a>` : '',
        canGym ? `<a href="/gym-rentals" class="btn" style="width:100%;justify-content:center;background:var(--mist);color:var(--steel);">+ Gym booking</a>` : '',
      ].filter(Boolean).join('');

      // ── Recent activity (audit log) ──
      const activityRes = await env.DB.prepare('SELECT username, action, entity_type, entity_label, created_at FROM audit_log ORDER BY created_at DESC LIMIT 6').all();
      const timeAgo = (iso) => {
        if (!iso) return '';
        const diffMs = Date.now() - new Date(iso).getTime();
        const mins = Math.round(diffMs / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
        const days = Math.round(hrs / 24);
        return `${days} day${days !== 1 ? 's' : ''} ago`;
      };
      const activityHtml = activityRes.results.length === 0
        ? `<div style="text-align:center;padding:20px;color:var(--gray);font-family:var(--sans);font-size:13px;">No activity yet.</div>`
        : activityRes.results.map(a => `<div class="activity-row"><strong>${escapeHtml(a.username || 'Someone')}</strong> ${escapeHtml(a.action)}d a ${escapeHtml((a.entity_type || '').replace(/_/g, ' '))}${a.entity_label ? `: &ldquo;${escapeHtml(a.entity_label)}&rdquo;` : ''}<span class="activity-time">${timeAgo(a.created_at)}</span></div>`).join('');

      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const initials = (currentUser.username || '?').slice(0, 2).toUpperCase();

      const statCardsHtml = statCards.map(s => `<div class="stat-card">
  <div class="stat-label">${s.label}</div>
  <div class="stat-num" style="color:${s.color};">${s.num}</div>
  <div class="stat-note">${s.note}</div>
</div>`).join('');

      return html(`
${sidebarShell('dashboard', currentUser)}
<div class="wrap-wide">
  <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px;">
    <div>
      <div class="dash-header">${greeting}, ${escapeHtml(currentUser.username)}</div>
      <div class="dash-sub">${today} — here&rsquo;s what needs attention</div>
    </div>
    <div class="dash-avatar">${initials}</div>
  </div>
  ${statCards.length ? `<div class="stat-row">${statCardsHtml}</div>` : ''}
  <div class="dash-grid">
    <div class="card" style="margin-bottom:0;">
      <div class="card-title">Needs your attention</div>
      ${attnHtml}
    </div>
    <div>
      ${quickAdd ? `<div class="card">
        <div class="card-title">Quick add</div>
        <div style="display:flex;flex-direction:column;gap:10px;">${quickAdd}</div>
      </div>` : ''}
      <div class="card" style="margin-bottom:0;">
        <div class="card-title">Recent activity</div>
        ${activityHtml}
      </div>
    </div>
  </div>
</div>`, 'Dashboard — TLC Admin');
    }

    // ── PAYROLL PAGE (auth-gated, no secondary login needed) ──
    if (path === '/payroll' && method === 'GET') {
      if (!hasPermission(currentUser, 'payroll_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      return new Response(PAYROLL_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' }
      });
    }

    // ── GYM ADMIN ROUTES (auth + gym_manage) ───────────────────
    if (path.startsWith('/gym-rentals')) {
      if (!hasPermission(currentUser, 'gym_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      const r = await handleGymRoutes(path, method, url, request, env, currentUser, ctx);
      if (r) return r;
    }

    // ── LOGOUT ──
    if (path === '/logout') {
      await deleteSession(env.DB, request);
      return new Response('', {
        status: 302,
        headers: { Location: '/login', 'Set-Cookie': clearSessionCookieHeader() }
      });
    }

    // ── IMAGE UPLOAD TO R2 ──
    if (path === '/api/upload-image' && method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') {
        return new Response(JSON.stringify({ error: 'No file' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      // 8MB — raised from an earlier 2MB cap that was routinely tripped by
      // straight-off-the-phone photos (a modern phone camera photo is
      // commonly 3-6MB), which showed up as an unexplained "Upload failed."
      if (file.size > 8388608) {
        return new Response(JSON.stringify({ error: 'File too large (max 8MB)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      const mimeType = (file.type || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        return new Response(JSON.stringify({ error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      const ext = ALLOWED_IMAGE_TYPES.get(mimeType);
      const key = `news-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await env.IMAGES.put(key, file.stream(), { httpMetadata: { contentType: mimeType } });
      const url = `${new URL(request.url).origin}/images/${key}`;
      return new Response(JSON.stringify({ url, location: url }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── UPLOAD VOTER DOCUMENT TO R2 ──
    if (path === '/api/upload-doc' && method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return new Response(JSON.stringify({ error: 'No file' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      if (file.size > 10485760) return new Response(JSON.stringify({ error: 'File too large (max 10MB)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const docMime = (file.type || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_DOC_TYPES.has(docMime)) {
        return new Response(JSON.stringify({ error: 'Invalid file type. Only PDF documents are allowed.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      const safeName = (file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `docs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`;
      await env.IMAGES.put(key, file.stream(), {
        httpMetadata: { contentType: docMime, contentDisposition: `attachment; filename="${safeName}"` }
      });
      const docUrl = `${new URL(request.url).origin}/docs/${key.slice('docs-'.length)}`;
      return new Response(JSON.stringify({ url: docUrl, key, name: safeName }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── VOTERS PAGE ADMIN ──
    if ((path === '/voters' || path === '/voters-add-file' || path === '/voters-delete-file') && !hasPermission(currentUser, 'pages_edit')) {
      return new Response('Access denied.', { status: 403 });
    }
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
${sidebarShell('voters', currentUser)}
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
    if (path.startsWith('/sermons') && !hasPermission(currentUser, 'sermons_edit')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path === '/sermons' && method === 'GET') {
      const alertHtml = url.searchParams.get('saved') ? `<div class="alert alert-success">Saved!</div>` : '';
      const series = await env.DB.prepare('SELECT * FROM sermon_series ORDER BY active DESC, sort_order ASC, id DESC').all();
      const standaloneNotes = await env.DB.prepare('SELECT * FROM sermon_notes WHERE series_id IS NULL OR series_id = 0 ORDER BY date DESC, id DESC').all();
      const noteCounts = await env.DB.prepare('SELECT series_id, COUNT(*) as cnt FROM sermon_notes WHERE series_id IS NOT NULL GROUP BY series_id').all();
      const noteCountMap = Object.fromEntries(noteCounts.results.map(r => [r.series_id, r.cnt]));

      const seriesHtml = series.results.length === 0
        ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No series yet. Add your first one below.</div>`
        : series.results.map(s => `
<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
  <div style="flex:1;min-width:160px;">
    ${s.active ? `<span class="badge badge-active" style="margin-bottom:4px;">Active</span><br>` : ''}
    <div style="font-family:var(--serif);font-size:17px;color:var(--steel);">${s.title}</div>
    ${s.date_range ? `<div style="font-size:12px;color:var(--gray);">${s.date_range}</div>` : ''}
  </div>
  <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;">
    <a href="/sermons/new-note?series_id=${s.id}" class="btn btn-sm btn-primary">+ Add sermon</a>
    <a href="/sermons/edit-series/${s.id}" class="btn btn-sm btn-secondary">Edit</a>
    <a href="/sermons/notes/${s.id}" class="btn btn-sm" style="background:var(--mist);color:var(--steel);border:1px solid var(--border);">Sermons (${noteCountMap[s.id] || 0})</a>
    <form method="POST" action="/sermons/delete-series/${s.id}" style="display:contents;" onsubmit="return confirm('Delete this series and all its sermons?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('');

      const standaloneHtml = standaloneNotes.results.length === 0
        ? `<div style="text-align:center;padding:24px;color:var(--gray);font-size:14px;">No standalone sermons.</div>`
        : standaloneNotes.results.map(n => `
<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
  <div style="flex:1;min-width:160px;">
    <div style="font-family:var(--serif);font-size:15px;color:var(--steel);">${n.title || '(untitled)'}</div>
    ${n.date ? `<div style="font-size:12px;color:var(--gray);">${n.date}</div>` : ''}
  </div>
  <div style="display:flex;gap:8px;flex-shrink:0;">
    <a href="/sermons/edit-note/${n.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/sermons/delete-note/${n.id}" style="display:contents;" onsubmit="return confirm('Delete this sermon?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('');

      return html(`
${sidebarShell('sermons', currentUser, `<a href="https://timothystl.org/sermons" target="_blank">View page →</a>`)}
<div class="wrap">
  <div class="page-title">Sermon Series</div>
  <div class="page-sub">Manage the current series and individual sermons shown on timothystl.org/sermons</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:24px;">
    <a href="/sermons/new-series" class="btn btn-primary">+ Add series</a>
    <a href="/sermons/new-note" class="btn btn-secondary">+ Add standalone sermon</a>
  </div>
  <div class="card">
    <div class="card-title">Sermon series</div>
    ${seriesHtml}
  </div>
  <div class="card" style="margin-top:20px;">
    <div class="card-title">Standalone sermons <span class="tag">${standaloneNotes.results.length} total</span></div>
    <div style="font-size:12px;color:var(--gray);margin-bottom:12px;">Sermons not attached to any series. These appear on the public sermons page.</div>
    ${standaloneHtml}
  </div>
</div>`, 'Sermons Admin');
    }

    if (path === '/sermons/new-series' && method === 'GET') {
      return html(`
${sidebarShell('sermons', currentUser, `<a href="/sermons">← Back</a>`)}
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
${sidebarShell('sermons', currentUser, `<a href="/sermons">← Back</a>`)}
<div class="wrap">
  <div class="page-title">Edit Series</div>
  <form method="POST" action="/sermons/edit-series/${id}">
    <div class="card">
      <div class="form-group"><label>Series title</label><input type="text" name="title" required value="${s.title}"></div>
      <div class="form-group"><label>Description</label><textarea name="description">${s.description || ''}</textarea></div>
      <div class="form-group"><label>Date range</label><input type="text" name="date_range" value="${s.date_range || ''}"></div>
      <div class="form-group"><label>YouTube playlist URL</label><input type="text" name="playlist_url" value="${s.playlist_url || ''}"></div>
      <div class="checkbox-row"><input type="checkbox" name="active" value="1" id="active" ${s.active ? 'checked' : ''}><label for="active" style="display:inline;text-transform:none;letter-spacing:0;font-size:14px;">Mark as active (current series)</label></div>
      <div class="btn-row" style="margin-top:20px;"><button type="submit" class="btn btn-primary">Save changes</button><a href="/sermons/notes/${id}" class="btn btn-secondary">Manage sermons</a><a href="/sermons" class="btn" style="background:var(--linen);color:var(--charcoal);">Cancel</a></div>
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
        ? `<div style="text-align:center;padding:24px;color:var(--gray);font-size:14px;">No sermons in this series yet.</div>`
        : notes.results.map(n => `
<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
  <div style="flex:1;">
    ${n.date ? `<div style="font-size:11px;font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:.06em;">${n.date}</div>` : ''}
    <div style="font-family:var(--serif);font-size:16px;color:var(--steel);">${n.title}</div>
    ${n.scripture ? `<div style="font-size:12px;color:var(--gray);">${n.scripture}</div>` : ''}
  </div>
  <div style="display:flex;gap:8px;">
    <a href="/sermons/edit-note/${n.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/sermons/delete-note/${n.id}" style="display:contents;" onsubmit="return confirm('Delete this sermon?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`).join('');
      return html(`
${sidebarShell('sermons', currentUser, `<a href="/sermons">← All series</a>`)}
<div class="wrap">
  <div class="page-title">${s.title}</div>
  <div class="page-sub">${s.date_range || 'Sermons in this series'}</div>
  <div class="btn-row" style="margin-bottom:20px;">
    <a href="/sermons/new-note?series_id=${seriesId}" class="btn btn-primary">+ Add sermon</a>
    <a href="/sermons/edit-series/${seriesId}" class="btn btn-secondary">Edit series</a>
  </div>
  <div class="card"><div class="card-title">Sermons in this series</div>${notesHtml}</div>
</div>`, 'Sermon Series');
    }

    if (path === '/sermons/new-note' && method === 'GET') {
      const seriesId = url.searchParams.get('series_id') || '';
      const allSeries = await env.DB.prepare('SELECT id, title FROM sermon_series ORDER BY active DESC, id DESC').all();
      const seriesOptions = allSeries.results.map(s => `<option value="${s.id}" ${s.id == seriesId ? 'selected' : ''}>${s.title}</option>`).join('');
      return html(`
${sidebarShell('sermons', currentUser, `<a href="${seriesId ? '/sermons/notes/' + seriesId : '/sermons'}">← Back</a>`)}
<div class="wrap">
  <div class="page-title">Add Sermon</div>
  <form method="POST" action="/sermons/new-note">
    <input type="hidden" name="series_id" value="${seriesId}">
    <div class="card">
      <div class="form-group"><label>Series (optional)</label><select name="series_id"><option value="">— Standalone sermon —</option>${seriesOptions}</select></div>
      <div class="form-group"><label>Date</label><input type="date" name="date"></div>
      <div class="form-group"><label>Sermon title</label><input type="text" name="title" required placeholder="e.g. You prepare a table before me"></div>
      <div class="form-group"><label>Scripture reference</label><input type="text" name="scripture" placeholder="e.g. Psalm 23:5"></div>
      ${tinymceSermonSection()}
      <div class="form-group"><label>YouTube link (optional)</label><input type="text" name="youtube_url" placeholder="Link to this specific service recording"></div>
      <div class="btn-row" style="margin-top:20px;"><button type="submit" class="btn btn-primary">Add sermon</button><a href="${seriesId ? '/sermons/notes/' + seriesId : '/sermons'}" class="btn" style="background:var(--linen);color:var(--charcoal);">Cancel</a></div>
    </div>
  </form>
</div>`, 'Add Sermon', TINYMCE_HEAD);
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
${sidebarShell('sermons', currentUser, `<a href="${n.series_id ? '/sermons/notes/' + n.series_id : '/sermons'}">← Back</a>`)}
<div class="wrap">
  <div class="page-title">Edit Sermon</div>
  <form method="POST" action="/sermons/edit-note/${id}">
    <div class="card">
      <div class="form-group"><label>Series (optional)</label><select name="series_id"><option value="">— Standalone sermon —</option>${seriesOptions}</select></div>
      <div class="form-group"><label>Date</label><input type="date" name="date" value="${n.date || ''}"></div>
      <div class="form-group"><label>Sermon title</label><input type="text" name="title" required value="${n.title}"></div>
      <div class="form-group"><label>Scripture reference</label><input type="text" name="scripture" value="${n.scripture || ''}"></div>
      ${tinymceSermonSection(n.outline)}
      <div class="form-group"><label>YouTube link (optional)</label><input type="text" name="youtube_url" value="${n.youtube_url || ''}"></div>
      <div class="btn-row" style="margin-top:20px;">
        <button type="submit" class="btn btn-primary">Save changes</button>
        <a href="${n.series_id ? '/sermons/notes/' + n.series_id : '/sermons'}" class="btn" style="background:var(--linen);color:var(--charcoal);">Cancel</a>
        <form method="POST" action="/sermons/delete-note/${id}" style="margin:0;" onsubmit="return confirm('Delete this sermon?')">
          <button type="submit" class="btn btn-danger">Delete sermon</button>
        </form>
      </div>
    </div>
  </form>
</div>`, 'Edit Sermon', TINYMCE_HEAD);
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

    // ── NEWSLETTER + NEWS PERMISSION GUARD ──
    // Routes under /new, /publish, /edit/, /delete/, /send-email/, /newsitems require news or newsletter permission
    const isNewsletterRoute = ['/new', '/publish'].includes(path) || path.startsWith('/edit/') || path.startsWith('/send-email/') || path.startsWith('/delete/') || path.startsWith('/newsletter/duplicate/');
    const isNewsItemRoute = path === '/newsitems' || path.startsWith('/newsitems/');
    if (isNewsletterRoute && !hasPermission(currentUser, 'newsletter_edit') && !hasPermission(currentUser, 'newsletter_approve')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (isNewsItemRoute && !hasPermission(currentUser, 'news_edit')) {
      return new Response('Access denied.', { status: 403 });
    }

    // ── NEW NEWSLETTER FORM ──
    if (path === '/new' && method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      // Fetch recent news items available for email inclusion
      const emailItems = await env.DB.prepare(
        `SELECT id, title, summary, publish_date FROM news_items
         WHERE publish_date <= ? AND (expire_date IS NULL OR expire_date >= ?)
           AND (channels IS NULL OR channels LIKE '%email%')
         ORDER BY COALESCE(event_date, publish_date) ASC LIMIT 20`
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
      const bibleClassTemplatesRows = await env.DB.prepare('SELECT * FROM bible_classes WHERE active = 1 ORDER BY sort_order, id').all();
      const bibleClassTemplates = bibleClassTemplatesRows.results || [];
      const tplCheckboxesHtml = bibleClassTemplates.length ? bibleClassTemplates.map(t => `
        <div id="tpl-row-${t.id}">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 0;border-bottom:1px solid var(--border);">
            <input type="checkbox" id="tpl-cb-${t.id}" onchange="toggleTpl(this, ${t.id})">
            <span style="font-size:14px;color:var(--charcoal);"><strong>${t.title}</strong>${t.leader ? ` · <span style="font-weight:400;">${t.leader}</span>` : ''}${t.location ? ` · <span style="font-weight:400;color:var(--gray);">${t.location}</span>` : ''}</span>
          </label>
          <div id="tpl-date-row-${t.id}" style="display:none;padding:8px 0 4px 26px;">
            <label style="font-size:11px;color:var(--gray);display:block;margin-bottom:4px;">Date for this session</label>
            <input type="date" id="tpl-date-${t.id}" oninput="syncTplDate(${t.id})" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;">
            <input type="hidden" name="class_ids" id="tpl-cid-${t.id}" value="t${t.id}" disabled>
            <input type="hidden" name="class_date_t${t.id}" id="tpl-cdate-${t.id}" disabled>
            <input type="hidden" name="class_topic_t${t.id}" value="${t.title.replace(/"/g,'&quot;')}" id="tpl-ctopic-${t.id}" disabled>
            <input type="hidden" name="class_leader_t${t.id}" value="${(t.leader||'').replace(/"/g,'&quot;')}" id="tpl-cleader-${t.id}" disabled>
            <input type="hidden" name="class_location_t${t.id}" value="${(t.location||'').replace(/"/g,'&quot;')}" id="tpl-clocation-${t.id}" disabled>
          </div>
        </div>`).join('') : '';
      return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">← News &amp; Events</a>`)}
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
        <div class="card-title">Secondary note <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A second free-form text block that appears in the email below the pastor's note. Leave blank to omit.</div>
        <div class="form-group">
          ${tinymceNoteSection('secondary-editor', 'secondary_note', '', 140)}
        </div>
      </div>

      <div class="card">
        <div class="card-title">News &amp; Events <span class="tag">Pick from your posts</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Check items to include. The <strong>first checked item</strong> appears as the featured story, the <strong>second</strong> as secondary news, and the rest as compact cards — all with a "Read more" link. Long text is automatically trimmed.</div>
        ${newsPickerHtml}
      </div>

      <div class="card">
        <div class="card-title">Upcoming events</div>
        <div id="events-container"></div>
        <button type="button" class="add-event-btn" onclick="addEvent()">+ Add an event</button>
      </div>

      <div class="card">
        <div class="card-title">Bible Classes <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">Check classes meeting this week. Each checked class will appear at the bottom of the email with a link to the full calendar.</div>
        ${tplCheckboxesHtml}
        <div id="classes-container" style="${bibleClassTemplates.length ? 'margin-top:12px;' : ''}"></div>
        <button type="button" class="add-event-btn" onclick="addBibleClass()" style="margin-top:${bibleClassTemplates.length ? '6' : '0'}px;">${bibleClassTemplates.length ? '+ Add one-time class' : '+ Add a class'}</button>
      </div>

      <div class="card">
        <div class="card-title">Word of Life &amp; LASM <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">These appear side by side in the email — left half Word of Life, right half LASM. Leave either blank to omit it.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="form-group" style="margin:0;">
            <label>Word of Life</label>
            ${tinymceNoteSection('wol-editor', 'wol_content', '', 120)}
          </div>
          <div class="form-group" style="margin:0;">
            <label>LASM</label>
            ${tinymceNoteSection('lasm-editor', 'lasm_content', '', 120)}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Tertiary note / CTA <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A full-width block below Word of Life &amp; LASM. Use it for a call-to-action, an announcement, a sign-up link, or anything else that doesn't fit the pastor's note. Leave blank to omit.</div>
        <div class="form-group">
          ${tinymceNoteSection('tertiary-editor', 'tertiary_note', '', 140)}
        </div>
        <div style="display:flex;gap:12px;margin-top:8px;">
          <div class="form-group" style="flex:1;margin:0;">
            <label>Button label <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
            <input type="text" name="tertiary_cta_label" placeholder="e.g. Sign Up, RSVP, Learn More">
          </div>
          <div class="form-group" style="flex:1;margin:0;">
            <label>Button link (URL) <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
            <input type="url" name="tertiary_cta_url" placeholder="https://...">
          </div>
        </div>
      </div>
    </div>

    <!-- QUICK ANNOUNCEMENT FIELDS -->
    <div id="quick-fields" style="display:none;">
      <div class="card">
        <div class="card-title">Message</div>
        <div class="form-group">
          <label>Your announcement <span style="color:#B85C3A;">*</span></label>
          ${tinymceNoteSection('quick-editor', 'quick_body', '', 140)}
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
      <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-bottom:12px;"><strong>Publish</strong> sends to the selected list and goes live on the website. <strong>Save as draft</strong> saves without sending anything.</div>
      <div class="radio-row">
        <label><input type="radio" name="email_send" value="test" checked> Test list only</label>
        <label><input type="radio" name="email_send" value="all"> All subscribers</label>
        <label><input type="radio" name="email_send" value="none"> Website only (no email)</label>
      </div>
      <div style="margin-top:14px;padding:12px 14px;background:var(--mist);border-radius:8px;border:1px solid var(--ice);font-family:var(--sans);font-size:12px;color:var(--charcoal);line-height:1.7;">
        📊 <strong>Email is sent via Brevo.</strong> To see open rates, clicks, and delivery stats after sending, log in at <a href="https://app.brevo.com" target="_blank" style="color:var(--mid);font-weight:700;">app.brevo.com</a> → Campaigns.
      </div>
    </div>

    <div class="btn-row" style="margin-top:8px;">
      ${hasPermission(currentUser, 'newsletter_approve') ? `<button type="submit" name="action" value="publish" class="btn btn-primary">Publish →</button>` : ''}
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
let classCount = 0;
function addBibleClass(date, topic, location, leader) {
  const c = document.getElementById('classes-container');
  const id = ++classCount;
  const div = document.createElement('div');
  div.className = 'event-block';
  div.id = 'class-'+id;
  div.innerHTML = \`<button type="button" class="remove-event" onclick="removeBibleClass(\${id})">×</button>
    <div class="event-grid">
      <div class="form-group" style="margin:0;"><label>Date</label><input type="date" name="class_date_\${id}" value="\${date||''}"></div>
      <div class="form-group" style="margin:0;"><label>Topic</label><input type="text" name="class_topic_\${id}" placeholder="e.g. The Sermon on the Mount" value="\${topic||''}"></div>
    </div>
    <div class="event-grid" style="margin-top:12px;">
      <div class="form-group" style="margin:0;"><label>Location</label><input type="text" name="class_location_\${id}" placeholder="e.g. Fellowship Hall" value="\${location||''}"></div>
      <div class="form-group" style="margin:0;"><label>Leader</label><input type="text" name="class_leader_\${id}" placeholder="e.g. Pastor Matt" value="\${leader||''}"></div>
    </div>
    <input type="hidden" name="class_ids" value="\${id}">\`;
  c.appendChild(div);
}
function removeBibleClass(id) { document.getElementById('class-'+id).remove(); }
function toggleTpl(cb, tplId) {
  const row = document.getElementById('tpl-date-row-'+tplId);
  const ids = ['tpl-cid-'+tplId, 'tpl-cdate-'+tplId, 'tpl-ctopic-'+tplId, 'tpl-cleader-'+tplId, 'tpl-clocation-'+tplId];
  row.style.display = cb.checked ? '' : 'none';
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !cb.checked; });
}
function syncTplDate(tplId) {
  const v = document.getElementById('tpl-date-'+tplId)?.value || '';
  const h = document.getElementById('tpl-cdate-'+tplId);
  if (h) h.value = v;
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
      const emailSend = form.get('email_send') || 'none';
      // Test sends stay as drafts — only 'all' or 'none' (website-only) publishes to the archive
      const status = (action === 'publish' && emailSend !== 'test') ? 'published' : 'draft';

      // Strip <img src="blob:..."> tags — these are temporary in-browser URLs
      // that render as broken icons in email if the upload didn't finish.
      const stripBlobImgs = s => (s || '').replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');

      // Weekly-specific fields
      const pastorNote = stripBlobImgs(form.get('pastor_note') || '');
      const secondaryNote = fmt === 'weekly' ? stripBlobImgs(form.get('secondary_note') || '') : '';
      const wolContent = fmt === 'weekly' ? stripBlobImgs(form.get('wol_content') || '') : '';
      const lasmContent = fmt === 'weekly' ? stripBlobImgs(form.get('lasm_content') || '') : '';
      const tertiaryNote = fmt === 'weekly' ? stripBlobImgs(form.get('tertiary_note') || '') : '';
      const tertiaryCtaLabel = fmt === 'weekly' ? form.get('tertiary_cta_label') || '' : '';
      const tertiaryCtaUrl = fmt === 'weekly' ? form.get('tertiary_cta_url') || '' : '';
      // Legacy fields kept for DB compat but no longer used in the form
      const ministryContent = '';
      const ministryType = 'text';

      // Quick-announcement-specific fields
      const quickBody = stripBlobImgs(form.get('quick_body') || '');
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

      // Collect bible classes (weekly only)
      const classIds = form.getAll('class_ids');
      const bibleClasses = [];
      if (fmt === 'weekly') {
        for (const id of classIds) {
          const topic = form.get(`class_topic_${id}`);
          if (!topic) continue;
          const entry = {
            date: form.get(`class_date_${id}`) || '',
            topic,
            location: form.get(`class_location_${id}`) || '',
            leader: form.get(`class_leader_${id}`) || '',
          };
          if (String(id).startsWith('t')) entry.template_id = parseInt(id.slice(1));
          bibleClasses.push(entry);
        }
      }
      const bibleClassesJson = bibleClasses.length ? JSON.stringify(bibleClasses) : null;

      // Fetch selected news items (weekly only)
      const selectedNewsIds = fmt === 'weekly' ? form.getAll('news_item_ids') : [];
      let selectedNewsItems = [];
      if (selectedNewsIds.length > 0) {
        const placeholders = selectedNewsIds.map(() => '?').join(',');
        const newsRows = await env.DB.prepare(
          `SELECT id, title, summary, body, image_url FROM news_items WHERE id IN (${placeholders})`
        ).bind(...selectedNewsIds).all();
        const newsMap = Object.fromEntries(newsRows.results.map(r => [r.id, r]));
        selectedNewsItems = selectedNewsIds.map(id => newsMap[id]).filter(Boolean);
      }

      const newsIdsStr = selectedNewsIds.join(',');
      let newsletterId;
      if (editId) {
        // Update existing newsletter
        await env.DB.prepare(
          'UPDATE newsletters SET subject=?, pastor_note=?, ministry_content=?, ministry_type=?, published_at=?, format=?, cta_url=?, cta_label=?, status=?, wol_content=?, lasm_content=?, secondary_note=?, news_item_ids=?, tertiary_note=?, tertiary_cta_label=?, tertiary_cta_url=?, bible_classes=? WHERE id=?'
        ).bind(subject, savedNote, ministryContent, ministryType, publishedAt, fmt, ctaUrl, ctaLabel, status, wolContent, lasmContent, secondaryNote, newsIdsStr, tertiaryNote, tertiaryCtaLabel, tertiaryCtaUrl, bibleClassesJson, editId).run();
        newsletterId = parseInt(editId, 10);
        // Replace events
        await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(newsletterId).run();
      } else {
        // Insert new newsletter
        const result = await env.DB.prepare(
          'INSERT INTO newsletters (subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, status, wol_content, lasm_content, secondary_note, news_item_ids, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(subject, savedNote, ministryContent, ministryType, publishedAt, fmt, ctaUrl, ctaLabel, status, wolContent, lasmContent, secondaryNote, newsIdsStr, tertiaryNote, tertiaryCtaLabel, tertiaryCtaUrl, bibleClassesJson).run();
        newsletterId = result.meta.last_row_id;
      }

      // Save events
      for (const e of events) {
        await env.DB.prepare(
          'INSERT INTO events (newsletter_id, event_date, event_name, event_time, event_desc, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(newsletterId, e.event_date, e.event_name, e.event_time, e.event_desc, e.sort_order).run();
      }

      // Approval workflow: editors without newsletter_approve submit for approval
      if (action === 'publish' && !hasPermission(currentUser, 'newsletter_approve')) {
        await env.DB.prepare("UPDATE newsletters SET status = 'draft', approval_status = 'pending' WHERE id = ?").bind(newsletterId).run();
        return new Response('', {
          status: 302,
          headers: { Location: `/newsitems?msg=submitted&subject=${encodeURIComponent(subject)}` }
        });
      }

      // Send via Brevo if requested (only when publishing with newsletter_approve permission)
      let emailSuffix = '';
      if (action === 'publish' && emailSend !== 'none' && hasPermission(currentUser, 'newsletter_approve')) {
        const listId = emailSend === 'test' ? parseInt(env.BREVO_TEST_LIST_ID || '2', 10) : parseInt(env.BREVO_LIST_ID || '0', 10);
        if (!listId && emailSend === 'all') {
          emailSuffix = `&emailerr=${encodeURIComponent('BREVO_LIST_ID secret is not configured. Set it in Cloudflare Workers → Settings → Variables & Secrets.')}`;
        } else if (listId) {
          const emailHtml = buildEmailHtml(subject, savedNote, events, wolContent, lasmContent, publishedAt, selectedNewsItems, secondaryNote, newsletterId, fmt, ctaUrl, ctaLabel, tertiaryNote, tertiaryCtaLabel, tertiaryCtaUrl, bibleClasses);
          const result = await sendBrevoNewsletter(env, { subject, htmlContent: emailHtml, listIds: [listId] });
          emailSuffix = result.success
            ? `&emailed=${emailSend}`
            : `&emailerr=${encodeURIComponent(result.error)}`;
        }
      }

      if (action === 'publish' && emailSend !== 'test') {
        await env.DB.prepare("UPDATE newsletters SET approval_status = 'approved', approved_by_username = ? WHERE id = ?").bind(currentUser.username, newsletterId).run();
      } else {
        // Saving as draft (or test send) clears any prior approval state
        await env.DB.prepare("UPDATE newsletters SET approval_status = NULL, approved_by_username = NULL WHERE id = ?").bind(newsletterId).run();
      }

      const redirectMsg = (action === 'publish' && emailSend !== 'test') ? 'published' : 'draft';
      return new Response('', {
        status: 302,
        headers: { Location: `/newsitems?msg=${encodeURIComponent(redirectMsg)}&subject=${encodeURIComponent(subject)}${emailSuffix}` }
      });
    }

    // ── BIBLE CLASS TEMPLATE CRUD ──
    // ── CHRISTIAN EDUCATION: BIBLE CLASSES CRUD ──
    const isCeRoute = path === '/christian-education' || path.startsWith('/christian-education/');
    if (isCeRoute && !hasPermission(currentUser, 'news_edit')) return new Response('Access denied.', { status: 403 });

    if (path === '/christian-education' && method === 'GET') {
      const ceRows = await env.DB.prepare('SELECT * FROM bible_classes ORDER BY sort_order, id').all();
      const ceMsg = url.searchParams.get('msg');
      const ceAlert = ceMsg === 'saved' ? `<div class="alert alert-success">✓ Class saved.</div>`
        : ceMsg === 'deleted' ? `<div class="alert alert-info">Class removed.</div>`
        : ceMsg === 'error' ? `<div class="alert alert-error">Title is required.</div>` : '';
      const ACCENT_OPTS = [['mid','Navy'],['teal','Teal'],['steel','Steel'],['sage','Moss'],['amber','Gold'],['plum','Plum']];
      const classListHtml = ceRows.results.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--gray);font-size:14px;">No classes yet. Add your first class below.</div>`
        : ceRows.results.map(c => `<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid var(--border);">
          <div style="flex:1;">
            <div style="font-family:var(--sans);font-size:14px;font-weight:700;color:var(--charcoal);">${c.title}${!c.active ? ' <span style="font-size:11px;font-weight:400;color:var(--gray);">(hidden)</span>' : ''}</div>
            ${c.label ? `<div style="font-size:12px;color:var(--gray);">${c.label}${c.schedule ? ' · ' + c.schedule : ''}</div>` : (c.schedule ? `<div style="font-size:12px;color:var(--gray);">${c.schedule}</div>` : '')}
          </div>
          <div style="display:flex;gap:8px;">
            <a href="/christian-education/edit/${c.id}" class="btn btn-sm btn-secondary">Edit</a>
            <form method="POST" action="/christian-education/toggle/${c.id}" style="margin:0;">
              <button type="submit" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">${c.active ? 'Hide' : 'Show'}</button>
            </form>
            <form method="POST" action="/christian-education/delete/${c.id}" onsubmit="return confirm('Delete this class?')" style="margin:0;">
              <button type="submit" class="btn btn-sm btn-danger">Delete</button>
            </form>
          </div>
        </div>`).join('');
      return html(`
${sidebarShell('christian-education', currentUser, `<a href="https://timothystl.org/education" target="_blank">View page →</a>`)}
<div class="wrap">
  <div class="page-title">Christian Education</div>
  <div class="page-sub">Manage Bible classes shown on the <strong>/education</strong> page and available in the newsletter editor.</div>
  ${ceAlert}
  <div class="card">
    <div class="card-title">Classes</div>
    <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">Active classes appear on the website and in the newsletter editor. Drag-to-reorder is not yet supported — use the sort order field on the edit form instead.</div>
    ${classListHtml}
  </div>
  <div class="card" style="margin-top:16px;">
    <div class="card-title">Add a class</div>
    <form method="POST" action="/christian-education/create">
      <div class="form-group">
        <label>Title <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="title" required placeholder="e.g. Men's Bible Study">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Eyebrow label <span style="font-weight:400;color:var(--gray);">(small text above title)</span></label>
          <input type="text" name="label" placeholder="e.g. Saturday Mornings">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Schedule</label>
          <input type="text" name="schedule" placeholder="e.g. Saturdays · 8:00 AM">
        </div>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea name="description" rows="3" placeholder="Brief description shown on the website..."></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Leader</label>
          <input type="text" name="leader" placeholder="e.g. Pastor Matt">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Location</label>
          <input type="text" name="location" placeholder="e.g. Fellowship Hall">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Accent color</label>
          <select name="accent">${ACCENT_OPTS.map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
      </div>
      <div style="margin-top:16px;">
        <button type="submit" class="btn btn-primary">Add class</button>
      </div>
    </form>
  </div>
</div>`, 'Christian Education');
    }

    if (path === '/christian-education/create' && method === 'POST') {
      const ceForm = await request.formData();
      const title = (ceForm.get('title') || '').trim();
      if (!title) return new Response('', { status: 302, headers: { Location: '/christian-education?msg=error' } });
      await env.DB.prepare('INSERT INTO bible_classes (title, label, description, leader, location, schedule, accent, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM bible_classes))')
        .bind(title, (ceForm.get('label')||'').trim()||null, (ceForm.get('description')||'').trim()||null, (ceForm.get('leader')||'').trim()||null, (ceForm.get('location')||'').trim()||null, (ceForm.get('schedule')||'').trim()||null, ceForm.get('accent')||'mid').run();
      return new Response('', { status: 302, headers: { Location: '/christian-education?msg=saved' } });
    }

    if (path.startsWith('/christian-education/edit/') && method === 'GET') {
      const ceId = path.split('/').pop();
      const ceRow = await env.DB.prepare('SELECT * FROM bible_classes WHERE id = ?').bind(ceId).first();
      if (!ceRow) return new Response('Not found', { status: 404 });
      const ACCENT_OPTS = [['mid','Navy'],['teal','Teal'],['steel','Steel'],['sage','Moss'],['amber','Gold'],['plum','Plum']];
      return html(`
${sidebarShell('christian-education', currentUser, `<a href="/christian-education">← All classes</a>`)}
<div class="wrap">
  <div class="page-title">Edit class</div>
  <form method="POST" action="/christian-education/update/${ceId}">
    <div class="card">
      <div class="form-group">
        <label>Title <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="title" required value="${ceRow.title.replace(/"/g,'&quot;')}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Eyebrow label <span style="font-weight:400;color:var(--gray);">(small text above title)</span></label>
          <input type="text" name="label" value="${(ceRow.label||'').replace(/"/g,'&quot;')}" placeholder="e.g. Sunday Morning">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Schedule</label>
          <input type="text" name="schedule" value="${(ceRow.schedule||'').replace(/"/g,'&quot;')}" placeholder="e.g. Sundays · 9:30 AM">
        </div>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea name="description" rows="4">${ceRow.description||''}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Leader</label>
          <input type="text" name="leader" value="${(ceRow.leader||'').replace(/"/g,'&quot;')}" placeholder="e.g. Pastor Matt">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Location</label>
          <input type="text" name="location" value="${(ceRow.location||'').replace(/"/g,'&quot;')}" placeholder="e.g. Fellowship Hall">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Accent color</label>
          <select name="accent">${ACCENT_OPTS.map(([v,l]) => `<option value="${v}"${ceRow.accent===v?' selected':''}>${l}</option>`).join('')}</select>
        </div>
        <div class="form-group" style="margin:0;">
          <label>Sort order</label>
          <input type="number" name="sort_order" value="${ceRow.sort_order||0}" min="0" style="width:80px;">
        </div>
      </div>
      <div class="checkbox-row" style="margin-top:14px;">
        <input type="checkbox" name="active" id="ce-active" value="1"${ceRow.active ? ' checked' : ''}>
        <label for="ce-active">Active (shown on website and in newsletter editor)</label>
      </div>
      <div style="margin-top:20px;display:flex;gap:10px;">
        <button type="submit" class="btn btn-primary">Save changes</button>
        <a href="/christian-education" class="btn btn-secondary">Cancel</a>
      </div>
    </div>
  </form>
</div>`, 'Edit Class');
    }

    if (path.startsWith('/christian-education/update/') && method === 'POST') {
      const ceId = path.split('/').pop();
      const ceForm = await request.formData();
      const title = (ceForm.get('title') || '').trim();
      if (!title) return new Response('', { status: 302, headers: { Location: `/christian-education/edit/${ceId}?msg=error` } });
      await env.DB.prepare('UPDATE bible_classes SET title=?, label=?, description=?, leader=?, location=?, schedule=?, accent=?, active=?, sort_order=? WHERE id=?')
        .bind(title, (ceForm.get('label')||'').trim()||null, (ceForm.get('description')||'').trim()||null, (ceForm.get('leader')||'').trim()||null, (ceForm.get('location')||'').trim()||null, (ceForm.get('schedule')||'').trim()||null, ceForm.get('accent')||'mid', ceForm.get('active') === '1' ? 1 : 0, parseInt(ceForm.get('sort_order')||'0'), ceId).run();
      return new Response('', { status: 302, headers: { Location: '/christian-education?msg=saved' } });
    }

    if (path.startsWith('/christian-education/toggle/') && method === 'POST') {
      const ceId = path.split('/').pop();
      await env.DB.prepare('UPDATE bible_classes SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(ceId).run();
      return new Response('', { status: 302, headers: { Location: '/christian-education' } });
    }

    if (path.startsWith('/christian-education/delete/') && method === 'POST') {
      const ceId = path.split('/').pop();
      await env.DB.prepare('DELETE FROM bible_classes WHERE id = ?').bind(ceId).run();
      return new Response('', { status: 302, headers: { Location: '/christian-education?msg=deleted' } });
    }

    // ── NEWSLETTER APPROVE / REJECT (requires newsletter_approve) ──
    if (path.startsWith('/newsletter/approve/') && method === 'POST') {
      if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
      const id = path.split('/').pop();
      await env.DB.prepare("UPDATE newsletters SET status = 'published', approval_status = 'approved', approved_by_username = ? WHERE id = ?").bind(currentUser.username, id).run();
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=approved' } });
    }

    if (path.startsWith('/newsletter/reject/') && method === 'POST') {
      if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
      const id = path.split('/').pop();
      await env.DB.prepare("UPDATE newsletters SET status = 'draft', approval_status = NULL, approved_by_username = NULL WHERE id = ?").bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=rejected' } });
    }

    // ── EDIT EXISTING NEWSLETTER (GET) ──
    if (path.startsWith('/edit/') && method === 'GET') {
      const editId = path.split('/').pop();
      const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(editId).first();
      if (!row) return new Response('Not found', { status: 404 });
      const eventsRows = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY sort_order').bind(editId).all();
      const fmt = row.format || 'weekly';
      const today2 = new Date().toISOString().split('T')[0];
      const savedNewsIds = (row.news_item_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      const editEmailItems = await env.DB.prepare(
        `SELECT id, title, summary, publish_date FROM news_items
         WHERE publish_date <= ? AND (expire_date IS NULL OR expire_date >= ?)
           AND (channels IS NULL OR channels LIKE '%email%')
         ORDER BY COALESCE(event_date, publish_date) ASC LIMIT 20`
      ).bind(today2, today2).all();
      const editNewsPickerHtml = editEmailItems.results.length === 0
        ? `<div style="font-size:13px;color:var(--gray);padding:10px 0;">No news items available. Add items in the News &amp; Events tab first.</div>`
        : editEmailItems.results.map(item => `
          <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;">
            <input type="checkbox" name="news_item_ids" value="${item.id}"${savedNewsIds.includes(String(item.id)) ? ' checked' : ''} style="margin-top:3px;flex-shrink:0;">
            <div>
              <div style="font-size:14px;font-weight:600;color:var(--charcoal);">${item.title}</div>
              ${item.summary ? `<div style="font-size:12px;color:var(--gray);margin-top:2px;">${item.summary.substring(0, 100)}${item.summary.length > 100 ? '…' : ''}</div>` : ''}
              <div style="font-size:11px;color:var(--gray);margin-top:2px;">${item.publish_date}</div>
            </div>
          </label>`).join('');

      const editBibleClassTemplatesRows = await env.DB.prepare('SELECT * FROM bible_classes WHERE active = 1 ORDER BY sort_order, id').all();
      const editBibleClassTemplates = editBibleClassTemplatesRows.results || [];
      const editTplCheckboxesHtml = editBibleClassTemplates.length ? editBibleClassTemplates.map(t => `
        <div id="tpl-row-${t.id}">
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 0;border-bottom:1px solid var(--border);">
            <input type="checkbox" id="tpl-cb-${t.id}" onchange="toggleTpl(this, ${t.id})">
            <span style="font-size:14px;color:var(--charcoal);"><strong>${t.title}</strong>${t.leader ? ` · <span style="font-weight:400;">${t.leader}</span>` : ''}${t.location ? ` · <span style="font-weight:400;color:var(--gray);">${t.location}</span>` : ''}</span>
          </label>
          <div id="tpl-date-row-${t.id}" style="display:none;padding:8px 0 4px 26px;">
            <label style="font-size:11px;color:var(--gray);display:block;margin-bottom:4px;">Date for this session</label>
            <input type="date" id="tpl-date-${t.id}" oninput="syncTplDate(${t.id})" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;">
            <input type="hidden" name="class_ids" id="tpl-cid-${t.id}" value="t${t.id}" disabled>
            <input type="hidden" name="class_date_t${t.id}" id="tpl-cdate-${t.id}" disabled>
            <input type="hidden" name="class_topic_t${t.id}" value="${t.title.replace(/"/g,'&quot;')}" id="tpl-ctopic-${t.id}" disabled>
            <input type="hidden" name="class_leader_t${t.id}" value="${(t.leader||'').replace(/"/g,'&quot;')}" id="tpl-cleader-${t.id}" disabled>
            <input type="hidden" name="class_location_t${t.id}" value="${(t.location||'').replace(/"/g,'&quot;')}" id="tpl-clocation-${t.id}" disabled>
          </div>
        </div>`).join('') : '';

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

      const existingClasses = JSON.parse(row.bible_classes || '[]');
      const classesJs = existingClasses.map(c => c.template_id ? `
        (function(){
          const cb = document.getElementById('tpl-cb-${c.template_id}');
          if (cb) { cb.checked = true; toggleTpl(cb, ${c.template_id}); }
          const di = document.getElementById('tpl-date-${c.template_id}');
          if (di) { di.value = ${JSON.stringify(c.date||'')}; syncTplDate(${c.template_id}); }
        })();` : `
        (function(){
          addBibleClass(${JSON.stringify(c.date||'')}, ${JSON.stringify(c.topic||'')}, ${JSON.stringify(c.location||'')}, ${JSON.stringify(c.leader||'')});
        })();`).join('');

      const bodyVal = (fmt === 'quick' ? row.pastor_note : '') || '';
      const pastorNoteVal = (fmt === 'weekly' ? row.pastor_note : '') || '';
      const ministryChecked = (t) => (row.ministry_type || 'text') === t ? ' checked' : '';

      const copiedNotice = url.searchParams.get('copied') === '1'
        ? `<div class="alert alert-success">✓ Duplicated as a new draft. Update the subject, date, and content, then publish when ready.</div>`
        : '';
      return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">← News &amp; Events</a>`)}
<div class="wrap">
  <div class="page-title">Edit newsletter</div>
  ${copiedNotice}
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
        ${tinymcePastorSection(pastorNoteVal)}
      </div>
      <div class="card">
        <div class="card-title">Secondary note <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A second free-form text block that appears in the email below the pastor's note. Leave blank to omit.</div>
        <div class="form-group">
          ${tinymceNoteSection('secondary-editor', 'secondary_note', row.secondary_note || '', 140)}
        </div>
      </div>
      <div class="card">
        <div class="card-title">News &amp; Events <span class="tag">Pick from your posts</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Check items to include. The <strong>first checked item</strong> appears as the featured story, the <strong>second</strong> as secondary news, and the rest as compact cards — all with a "Read more" link. Long text is automatically trimmed.</div>
        ${editNewsPickerHtml}
      </div>
      <div class="card">
        <div class="card-title">Upcoming events</div>
        <div id="events-container"></div>
        <button type="button" class="add-event-btn" onclick="addEvent()">+ Add an event</button>
      </div>
      <div class="card">
        <div class="card-title">Bible Classes <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">Check classes meeting this week. Each checked class will appear at the bottom of the email with a link to the full calendar.</div>
        ${editTplCheckboxesHtml}
        <div id="classes-container" style="${editBibleClassTemplates.length ? 'margin-top:12px;' : ''}"></div>
        <button type="button" class="add-event-btn" onclick="addBibleClass()" style="margin-top:${editBibleClassTemplates.length ? '6' : '0'}px;">${editBibleClassTemplates.length ? '+ Add one-time class' : '+ Add a class'}</button>
      </div>
      <div class="card">
        <div class="card-title">Word of Life &amp; LASM <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">These appear side by side in the email — left half Word of Life, right half LASM. Leave either blank to omit it.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="form-group" style="margin:0;">
            <label>Word of Life</label>
            ${tinymceNoteSection('wol-editor', 'wol_content', row.wol_content || '', 120)}
          </div>
          <div class="form-group" style="margin:0;">
            <label>LASM</label>
            ${tinymceNoteSection('lasm-editor', 'lasm_content', row.lasm_content || '', 120)}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Tertiary note / CTA <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A full-width block below Word of Life &amp; LASM. Use it for a call-to-action, an announcement, or a sign-up link. Leave blank to omit.</div>
        <div class="form-group">
          ${tinymceNoteSection('tertiary-editor', 'tertiary_note', row.tertiary_note || '', 140)}
        </div>
        <div style="display:flex;gap:12px;margin-top:8px;">
          <div class="form-group" style="flex:1;margin:0;">
            <label>Button label <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
            <input type="text" name="tertiary_cta_label" value="${(row.tertiary_cta_label||'').replace(/"/g,'&quot;')}" placeholder="e.g. Sign Up, RSVP, Learn More">
          </div>
          <div class="form-group" style="flex:1;margin:0;">
            <label>Button link (URL) <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
            <input type="url" name="tertiary_cta_url" value="${(row.tertiary_cta_url||'').replace(/"/g,'&quot;')}" placeholder="https://...">
          </div>
        </div>
      </div>
    </div>

    <div id="quick-fields" style="display:${fmt==='quick'?'':'none'}">
      <div class="card">
        <div class="card-title">Message</div>
        <div class="form-group">
          ${tinymceNoteSection('quick-editor', 'quick_body', bodyVal, 140)}
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

    ${hasPermission(currentUser, 'newsletter_approve') ? `
    <div class="card" style="border-color:var(--amber);">
      <div class="card-title">Send email</div>
      <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-bottom:12px;"><strong>Publish</strong> sends to the selected list and goes live on the website. <strong>Save as draft</strong> saves without sending anything.</div>
      <div class="radio-row">
        <label><input type="radio" name="email_send" value="test" checked> Test list only</label>
        <label><input type="radio" name="email_send" value="all"> All subscribers</label>
        <label><input type="radio" name="email_send" value="none"> Website only (no email)</label>
      </div>
      <div style="margin-top:14px;padding:12px 14px;background:var(--mist);border-radius:8px;border:1px solid var(--ice);font-family:var(--sans);font-size:12px;color:var(--charcoal);line-height:1.7;">
        📊 <strong>Email is sent via Brevo.</strong> To see open rates, clicks, and delivery stats after sending, log in at <a href="https://app.brevo.com" target="_blank" style="color:var(--mid);font-weight:700;">app.brevo.com</a> → Campaigns.
      </div>
    </div>` : ''}

    <div class="btn-row" style="margin-top:8px;">
      ${hasPermission(currentUser, 'newsletter_approve') ? `<button type="submit" name="action" value="publish" class="btn btn-primary">Publish →</button>` : ''}
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
let classCount = 0;
function addBibleClass(date, topic, location, leader) {
  const c = document.getElementById('classes-container');
  const id = ++classCount;
  const div = document.createElement('div');
  div.className = 'event-block'; div.id = 'class-'+id;
  div.innerHTML = \`<button type="button" class="remove-event" onclick="removeBibleClass(\${id})">×</button>
    <div class="event-grid">
      <div class="form-group" style="margin:0;"><label>Date</label><input type="date" name="class_date_\${id}" value="\${date||''}"></div>
      <div class="form-group" style="margin:0;"><label>Topic</label><input type="text" name="class_topic_\${id}" placeholder="e.g. The Sermon on the Mount" value="\${topic||''}"></div>
    </div>
    <div class="event-grid" style="margin-top:12px;">
      <div class="form-group" style="margin:0;"><label>Location</label><input type="text" name="class_location_\${id}" placeholder="e.g. Fellowship Hall" value="\${location||''}"></div>
      <div class="form-group" style="margin:0;"><label>Leader</label><input type="text" name="class_leader_\${id}" placeholder="e.g. Pastor Matt" value="\${leader||''}"></div>
    </div>
    <input type="hidden" name="class_ids" value="\${id}">\`;
  c.appendChild(div);
}
function removeBibleClass(id) { document.getElementById('class-'+id).remove(); }
function toggleTpl(cb, tplId) {
  const row = document.getElementById('tpl-date-row-'+tplId);
  const ids = ['tpl-cid-'+tplId, 'tpl-cdate-'+tplId, 'tpl-ctopic-'+tplId, 'tpl-cleader-'+tplId, 'tpl-clocation-'+tplId];
  row.style.display = cb.checked ? '' : 'none';
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !cb.checked; });
}
function syncTplDate(tplId) {
  const v = document.getElementById('tpl-date-'+tplId)?.value || '';
  const h = document.getElementById('tpl-cdate-'+tplId);
  if (h) h.value = v;
}
function pickFormat(fmt) {
  document.getElementById('format-input').value = fmt;
  document.getElementById('fmt-weekly').classList.toggle('active', fmt === 'weekly');
  document.getElementById('fmt-quick').classList.toggle('active', fmt === 'quick');
  document.getElementById('weekly-fields').style.display = fmt === 'weekly' ? '' : 'none';
  document.getElementById('quick-fields').style.display = fmt === 'quick' ? '' : 'none';
}
${eventsJs}
${classesJs}
</script>`, 'Edit Newsletter', TINYMCE_HEAD);
    }

    // ── SEND EMAIL (for saved newsletters) ──
    if (path.startsWith('/send-email/') && method === 'POST') {
      if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
      const id = path.split('/').pop();
      const form = await request.formData();
      const listType = form.get('list_type') || 'test';
      const listId = listType === 'test' ? parseInt(env.BREVO_TEST_LIST_ID || '2', 10) : parseInt(env.BREVO_LIST_ID || '0', 10);

      if (!listId && listType === 'all') {
        return new Response('', {
          status: 302,
          headers: { Location: `/newsitems?msg=emailed&emailerr=${encodeURIComponent('BREVO_LIST_ID secret is not configured. Set it in Cloudflare Workers → Settings → Variables & Secrets.')}` }
        });
      }

      const payload = await buildNewsletterEmailPayload(env, id);
      if (!payload) return new Response('Not found', { status: 404 });
      const { row, emailHtml } = payload;
      const result = await sendBrevoNewsletter(env, { subject: row.subject, htmlContent: emailHtml, listIds: [listId] });

      // Sending to all = publish the newsletter so it appears on the website
      if (listType === 'all' && result.success) {
        await env.DB.prepare(
          "UPDATE newsletters SET status = 'published', approval_status = 'approved', approved_by_username = ?, published_at = COALESCE(published_at, ?) WHERE id = ?"
        ).bind(currentUser.username, new Date().toISOString().split('T')[0], id).run();
      }

      const suffix = result.success
        ? `&emailed=${listType}`
        : `&emailerr=${encodeURIComponent(result.error)}`;
      return new Response('', {
        status: 302,
        headers: { Location: `/newsitems?msg=emailed&subject=${encodeURIComponent(row.subject)}${suffix}` }
      });
    }

    // ── SCHEDULE SEND (Brevo scheduledAt — send-to-all only) ──
    if (path.startsWith('/schedule-email/') && method === 'POST') {
      if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
      const id = path.split('/').pop();
      const form = await request.formData();
      const listType = form.get('list_type') || 'all';
      const listId = listType === 'test' ? parseInt(env.BREVO_TEST_LIST_ID || '2', 10) : parseInt(env.BREVO_LIST_ID || '0', 10);
      // Submitted by prepSchedule() in helpers.js as a browser-computed ISO
      // instant — the Worker itself runs in UTC and can't turn a bare
      // "2026-07-20T09:00" string back into the office's actual local time.
      const scheduledAtSubmitted = form.get('scheduled_at') || '';

      if (!listId) {
        return new Response('', {
          status: 302,
          headers: { Location: `/newsitems?msg=emailed&emailerr=${encodeURIComponent('BREVO_LIST_ID secret is not configured. Set it in Cloudflare Workers → Settings → Variables & Secrets.')}` }
        });
      }
      const scheduledDate = scheduledAtSubmitted ? new Date(scheduledAtSubmitted) : null;
      if (!scheduledDate || isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        return new Response('', {
          status: 302,
          headers: { Location: `/newsitems?msg=emailed&emailerr=${encodeURIComponent('Pick a valid date/time in the future to schedule this send.')}` }
        });
      }
      const scheduledAtIso = scheduledDate.toISOString();

      const payload = await buildNewsletterEmailPayload(env, id);
      if (!payload) return new Response('Not found', { status: 404 });
      const { row, emailHtml } = payload;
      const result = await sendBrevoNewsletter(env, { subject: row.subject, htmlContent: emailHtml, listIds: [listId], scheduledAt: scheduledAtIso });

      if (result.success) {
        await env.DB.prepare(
          'UPDATE newsletters SET scheduled_send_at = ?, scheduled_list_type = ?, brevo_campaign_id = ? WHERE id = ?'
        ).bind(scheduledAtIso, listType, String(result.campaignId), id).run();

        // There's no Brevo→worker callback for "campaign actually sent", and no
        // Workers Cron in this project to poll for it — publish now (like an
        // immediate send-to-all does) so the archive link the email points back
        // to (buildEmailHtml's /news/{id} "Read the full letter" link) is live
        // by the time Brevo delivers it, rather than 404ing until someone
        // happens to revisit this page after the scheduled time.
        if (listType === 'all') {
          await env.DB.prepare(
            "UPDATE newsletters SET status = 'published', approval_status = 'approved', approved_by_username = ?, published_at = COALESCE(published_at, ?) WHERE id = ?"
          ).bind(currentUser.username, new Date().toISOString().split('T')[0], id).run();
        }
      }

      const suffix = result.success
        ? `&scheduled=1`
        : `&emailerr=${encodeURIComponent(result.error)}`;
      return new Response('', {
        status: 302,
        headers: { Location: `/newsitems?msg=emailed&subject=${encodeURIComponent(row.subject)}${suffix}` }
      });
    }

    // ── CANCEL SCHEDULED SEND ──
    if (path.startsWith('/newsletter/cancel-schedule/') && method === 'POST') {
      if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
      const id = path.split('/').pop();
      const row = await env.DB.prepare('SELECT brevo_campaign_id FROM newsletters WHERE id = ?').bind(id).first();
      if (!row) return new Response('Not found', { status: 404 });

      if (row.brevo_campaign_id) {
        const result = await cancelBrevoCampaign(env, row.brevo_campaign_id);
        if (!result.success) {
          return new Response('', {
            status: 302,
            headers: { Location: `/newsitems?msg=emailed&emailerr=${encodeURIComponent(result.error)}` }
          });
        }
      }
      await env.DB.prepare(
        'UPDATE newsletters SET scheduled_send_at = NULL, scheduled_list_type = NULL, brevo_campaign_id = NULL WHERE id = ?'
      ).bind(id).run();
      return new Response('', { status: 302, headers: { Location: `/newsitems?msg=emailed&scheduled=cancelled` } });
    }

    // ── DELETE ──
    if (path.startsWith('/delete/') && method === 'POST') {
      const id = path.split('/').pop();
      const toDelete = await env.DB.prepare('SELECT status FROM newsletters WHERE id = ?').bind(id).first();
      if (toDelete && toDelete.status !== 'draft' && !hasPermission(currentUser, 'newsletter_approve')) {
        return new Response('Access denied. Only admins can delete published newsletters.', { status: 403 });
      }
      await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(id).run();
      await env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/newsitems' } });
    }

    // ── DUPLICATE ──
    if (path.startsWith('/newsletter/duplicate/') && method === 'POST') {
      const id = path.split('/').pop();
      const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(id).first();
      if (!row) return new Response('Not found', { status: 404 });
      const eventsRows = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY sort_order').bind(id).all();
      const copyPublishedAt = row.published_at || new Date().toISOString().split('T')[0];
      const result = await env.DB.prepare(
        'INSERT INTO newsletters (subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, status, wol_content, lasm_content, secondary_note, news_item_ids, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        `Copy of ${row.subject}`, row.pastor_note, row.ministry_content, row.ministry_type, copyPublishedAt, row.format,
        row.cta_url, row.cta_label, 'draft', row.wol_content, row.lasm_content, row.secondary_note,
        row.news_item_ids, row.tertiary_note, row.tertiary_cta_label, row.tertiary_cta_url, row.bible_classes
      ).run();
      const newId = result.meta.last_row_id;
      for (const e of eventsRows.results) {
        await env.DB.prepare(
          'INSERT INTO events (newsletter_id, event_date, event_name, event_time, event_desc, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(newId, e.event_date, e.event_name, e.event_time, e.event_desc, e.sort_order).run();
      }
      return new Response('', { status: 302, headers: { Location: `/edit/${newId}?copied=1` } });
    }

    // ── NEWS & EVENTS: COMBINED LIST (Newsletter + News Posts) ──
    if (path === '/newsitems' && method === 'GET') {
      await sweepExpiredItems(env, new URL(request.url).origin);
      const [itemsRes, nlRes] = await Promise.all([
        env.DB.prepare('SELECT * FROM news_items ORDER BY pinned DESC, COALESCE(event_date, publish_date) ASC').all(),
        env.DB.prepare("SELECT id, subject, published_at, format, status, approval_status, created_at, scheduled_send_at, scheduled_list_type FROM newsletters ORDER BY CASE WHEN status = 'draft' THEN 0 ELSE 1 END, published_at DESC").all(),
      ]);
      const today = new Date().toISOString().split('T')[0];
      const msgParam = url.searchParams.get('msg');
      const subjectParam = decodeURIComponent(url.searchParams.get('subject') || '');
      const emailedParam = url.searchParams.get('emailed');
      const emailErrParam = url.searchParams.get('emailerr');
      const scheduledParam = url.searchParams.get('scheduled');
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
      } else if (msgParam === 'submitted') {
        alertHtml = `<div class="alert alert-info">Newsletter submitted for approval. An approver will review it before it goes live.</div>`;
      } else if (msgParam === 'approved') {
        alertHtml = `<div class="alert alert-success">✓ Newsletter approved and published.</div>`;
      } else if (msgParam === 'rejected') {
        alertHtml = `<div class="alert alert-info">Newsletter returned to draft for revisions.</div>`;
      } else if (msgParam === 'draft') {
        alertHtml = emailedParam === 'test'
          ? `<div class="alert alert-success">✓ Test email sent to test list. Newsletter saved as draft — not yet published to the website.</div>`
          : `<div class="alert alert-info">Draft saved.</div>`;
      } else if (msgParam === 'emailed') {
        const sentTo = emailedParam === 'test' ? 'test list' : 'all subscribers';
        alertHtml = emailErrParam
          ? `<div class="alert alert-error">Email failed: ${emailErrParam}</div>`
          : scheduledParam === '1'
            ? `<div class="alert alert-success">✓ "${subjectParam}" scheduled with Brevo.</div>`
            : scheduledParam === 'cancelled'
              ? `<div class="alert alert-info">Scheduled send cancelled.</div>`
              : `<div class="alert alert-success">✓ "${subjectParam}" sent to ${sentTo}.</div>`;
      }

      // ── News items HTML ──
      const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const statusLabel = { active: 'Live', upcoming: 'Upcoming', expired: 'Expired', expiring: 'Expiring soon' };
      const themeIcon = { 'Christmas Market': '🎄', 'Beekeepers': '🐝', 'Music': '🎵', 'Stephen Ministry': '🤝', 'Food Pantry': '🥫' };
      let liveCount = 0, upcomingCount = 0, expiredCount = 0;
      const listHtml = itemsRes.results.length === 0
        ? `<div style="text-align:center;padding:40px;color:var(--gray);font-size:14px;">No news items yet. Add your first announcement.</div>`
        : itemsRes.results.map(item => {
            let status = 'active';
            if (item.publish_date && item.publish_date > today) status = 'upcoming';
            else if (item.expire_date && item.expire_date < today) status = 'expired';
            else if (item.expire_date && item.expire_date <= soon) status = 'expiring';
            if (status === 'active' || status === 'expiring') liveCount++;
            else if (status === 'upcoming') upcomingCount++;
            else if (status === 'expired') expiredCount++;
            const icon = themeIcon[item.theme] || '📰';
            return `<div class="ni-row" data-status="${status}" data-pinned="${item.pinned ? 1 : 0}">
  <div class="icon-tile">${icon}</div>
  ${item.pinned ? `<span class="badge badge-pinned">Pinned</span>` : ''}
  <span class="badge badge-${status}">${statusLabel[status]}</span>
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
      const countsSummary = `${liveCount} live · ${upcomingCount} upcoming · ${expiredCount} expired`;

      // ── Newsletter HTML ──
      const nRows = nlRes.results;
      const canApprove = hasPermission(currentUser, 'newsletter_approve');
      const pending = nRows.filter(r => r.status === 'draft' && r.approval_status === 'pending');
      const drafts = nRows.filter(r => r.status === 'draft' && r.approval_status !== 'pending');
      const published = nRows.filter(r => r.status !== 'draft');
      const fmtLabel = (r) => r.format === 'quick'
        ? `<span class="badge" style="background:#e8f0fe;color:#1a3060;margin-left:8px;">⚡ Quick</span>`
        : '';
      // A scheduled_send_at in the past just means Brevo already sent it — treat only
      // future timestamps as "still pending" for the badge/cancel-button logic below.
      const isPendingSchedule = (r) => r.scheduled_send_at && new Date(r.scheduled_send_at).getTime() > Date.now();
      // Rendered server-side (Workers run in UTC) — pin the display to the
      // church's own timezone so the badge matches what staff actually picked.
      const scheduleBadge = (r) => isPendingSchedule(r)
        ? `<span class="badge" style="background:#e6f0ff;color:#1a3c6e;margin-left:8px;">⏰ Scheduled for ${new Date(r.scheduled_send_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' })} CT${r.scheduled_list_type === 'test' ? ' (test list)' : ''}</span>`
        : '';
      const scheduleControls = (r) => {
        if (!canApprove) return '';
        if (isPendingSchedule(r)) {
          return `<form method="POST" action="/newsletter/cancel-schedule/${r.id}" style="display:contents;" onsubmit="return confirm('Cancel the scheduled send?')">
      <button type="submit" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel schedule</button>
    </form>`;
        }
        return `<button type="button" class="btn btn-sm" style="background:var(--mist);color:var(--steel);border:1px solid var(--border);" onclick="toggleSchedule(${r.id})">Schedule send</button>
    <div id="sched-row-${r.id}" style="display:none;flex-basis:100%;margin-top:10px;">
      <form method="POST" action="/schedule-email/${r.id}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;" onsubmit="return prepSchedule(this)">
        <input type="datetime-local" required style="font-family:var(--sans);font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
        <input type="hidden" name="scheduled_at">
        <button type="submit" class="btn btn-sm btn-primary">Confirm schedule</button>
        <button type="button" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);" onclick="toggleSchedule(${r.id})">Cancel</button>
      </form>
    </div>`;
      };
      const pendingSectionHtml = (pending.length === 0 || !canApprove) ? '' : `<div style="margin-bottom:16px;border:2px solid #D4922A;border-radius:8px;overflow:hidden;">
  <div style="background:#FFF3D6;padding:8px 16px;border-bottom:1px solid #D4922A;">
    <span style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7A4F00;">⏳ Awaiting Approval — ${pending.length}</span>
  </div>
  ${pending.map(r => `<div class="newsletter-row">
  <div class="newsletter-date">${r.published_at || r.created_at || ''}</div>
  <div class="newsletter-subject">${r.subject}${fmtLabel(r)} <span class="badge badge-pending">Pending</span></div>
  <div class="newsletter-actions">
    <a href="/edit/${r.id}" class="btn btn-sm btn-secondary">Preview</a>
    <form method="POST" action="/newsletter/approve/${r.id}" style="display:contents;" onsubmit="return confirm('Approve and publish this newsletter?')">
      <button type="submit" class="btn btn-sm btn-sage">Approve</button>
    </form>
    <form method="POST" action="/newsletter/reject/${r.id}" style="display:contents;" onsubmit="return confirm('Return this newsletter to draft?')">
      <button type="submit" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Return to draft</button>
    </form>
  </div>
</div>`).join('')}
</div>`;
      const draftSectionHtml = drafts.length === 0 ? '' : `<div style="margin-bottom:16px;border:1px solid var(--amber);border-radius:8px;overflow:hidden;">
  <div style="background:#FFF8EC;padding:8px 16px;border-bottom:1px solid var(--amber);">
    <span style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#A07010;">Drafts — ${drafts.length}</span>
  </div>
  ${drafts.map(r => `<div class="newsletter-row">
  <div class="newsletter-date">${r.published_at || r.created_at || ''}</div>
  <div class="newsletter-subject">${r.subject}${fmtLabel(r)}${scheduleBadge(r)}</div>
  <div class="newsletter-actions">
    <a href="/edit/${r.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/newsletter/duplicate/${r.id}" style="display:contents;">
      <button type="submit" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Copy</button>
    </form>
    ${canApprove ? `<form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Send to test list?')">
      <input type="hidden" name="list_type" value="test">
      <button type="submit" class="btn btn-sm" style="background:var(--mist);color:var(--steel);border:1px solid var(--border);">Send test</button>
    </form>
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Send to ALL subscribers? This cannot be undone.')">
      <input type="hidden" name="list_type" value="all">
      <button type="submit" class="btn btn-sm btn-primary">Send to all</button>
    </form>
    ${scheduleControls(r)}` : ''}
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
  <div class="newsletter-subject">${r.subject}${fmtLabel(r)}${scheduleBadge(r)}</div>
  <div class="newsletter-actions">
    <a href="/edit/${r.id}" class="btn btn-sm btn-secondary">Edit</a>
    <form method="POST" action="/newsletter/duplicate/${r.id}" style="display:contents;">
      <button type="submit" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Copy</button>
    </form>
    ${hasPermission(currentUser, 'newsletter_approve') ? `
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Resend to test list?')">
      <input type="hidden" name="list_type" value="test">
      <button type="submit" class="btn btn-sm" style="background:var(--mist);color:var(--steel);border:1px solid var(--border);">Resend test</button>
    </form>
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Resend to ALL subscribers? This will send again to everyone.')">
      <input type="hidden" name="list_type" value="all">
      <button type="submit" class="btn btn-sm btn-primary">Resend to all</button>
    </form>
    ${scheduleControls(r)}` : ''}
    ${hasPermission(currentUser, 'newsletter_approve') ? `<form method="POST" action="/delete/${r.id}" style="display:contents;" onsubmit="return confirm('Delete this newsletter?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>` : ''}
  </div>
</div>`).join('');

      return html(`
${sidebarShell('news', currentUser, `<a href="https://timothystl.org/news" target="_blank">View site →</a>`, pending.length)}
<style>details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }</style>
<div class="wrap">
  <div class="page-title">News &amp; Events</div>
  <div class="page-sub">Manage newsletters and website announcements. <span class="count-pill">${countsSummary}</span></div>
  ${alertHtml}
  <details open style="margin-bottom:16px;border:1px solid var(--border);border-radius:10px;overflow:hidden;">
    <summary style="cursor:pointer;display:flex;align-items:center;padding:14px 20px;background:var(--steel);color:white;font-family:var(--sans);font-size:14px;font-weight:700;letter-spacing:.04em;">
      Newsletter
    </summary>
    <div style="padding:20px;">
      <div class="btn-row" style="margin-bottom:20px;">
        <a href="/new" class="btn btn-primary">+ Write newsletter</a>
      </div>
      ${pendingSectionHtml}
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
      <div class="btn-row" style="margin-bottom:16px;">
        <a href="/newsitems/new" class="btn btn-primary">+ Add news item</a>
      </div>
      <div class="btn-row" style="margin-bottom:20px;" id="ni-filters">
        <button type="button" class="filter-pill active" data-filter="all">All</button>
        <button type="button" class="filter-pill" data-filter="live">Live</button>
        <button type="button" class="filter-pill" data-filter="upcoming">Upcoming</button>
        <button type="button" class="filter-pill" data-filter="pinned">Pinned</button>
      </div>
      <div class="card" style="margin-bottom:0;">
        <div class="card-title">All items</div>
        <div id="ni-list">${listHtml}</div>
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
</div>
<script>(function(){
var wrap=document.getElementById('ni-filters');
if(!wrap)return;
wrap.addEventListener('click',function(e){
  var btn=e.target.closest('.filter-pill');
  if(!btn)return;
  wrap.querySelectorAll('.filter-pill').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  var f=btn.dataset.filter;
  document.querySelectorAll('#ni-list .ni-row').forEach(function(row){
    var show = f==='all'
      || (f==='live' && row.dataset.status==='active')
      || (f==='upcoming' && row.dataset.status==='upcoming')
      || (f==='pinned' && row.dataset.pinned==='1');
    row.style.display = show ? '' : 'none';
  });
});
})();</script>`, 'TLC Admin — News & Events');
    }

    // ── NEWS ITEMS: NEW FORM ──
    if (path === '/newsitems/new' && method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      const expire = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">← Back</a>`)}
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
        <label>Header image <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, shown on the card thumbnail</span></label>
        <input type="hidden" name="image_url" id="image_url_val" value="">
        <input type="file" id="image_url_file" accept="image/*">
        <div id="image-url-status" style="font-size:12px;color:var(--gray);margin-top:6px;"></div>
        <div id="image-url-preview" style="display:none;margin-top:8px;max-width:240px;"></div>
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
</div>
${newsImageUploadScript()}`, 'TLC Admin — New News Item', TINYMCE_HEAD);
    }

    // ── NEWS ITEMS: CREATE (POST) ──
    if (path === '/newsitems/create' && method === 'POST') {
      const form = await request.formData();
      const title = form.get('title') || '';
      const summary = form.get('summary') || '';
      const body = form.get('body') || '';
      // blob: URLs are only valid in the browser tab that created them — dead
      // for every other visitor. Drop rather than store one if it slips through.
      const image_url = (form.get('image_url') || '').trim().startsWith('blob:') ? '' : (form.get('image_url') || '');
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
      const newItemResult = await env.DB.prepare(
        'INSERT INTO news_items (title, summary, body, image_url, publish_date, event_date, expire_date, pinned, theme, content_type, channels) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(title, summary, body, image_url, publish_date, event_date || null, expire_date || null, pinned, theme || null, content_type || null, channels).run();
      await logAudit(env.DB, currentUser, 'create', 'news_item', newItemResult.meta.last_row_id, title, null, { title, summary, publish_date, expire_date, pinned });
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=saved' } });
    }

    // ── NEWS ITEMS: EDIT FORM ──
    if (path.startsWith('/newsitems/edit/') && method === 'GET') {
      const id = path.split('/').pop();
      const item = await env.DB.prepare('SELECT * FROM news_items WHERE id = ?').bind(id).first();
      if (!item) return new Response('Not found', { status: 404 });
      const v = (val) => (val || '').replace(/"/g, '&quot;');
      return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">← Back</a>`)}
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
        <label>Header image <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, shown on the card thumbnail</span></label>
        <input type="hidden" name="image_url" id="image_url_val" value="">
        <input type="file" id="image_url_file" accept="image/*">
        <div id="image-url-status" style="font-size:12px;color:var(--gray);margin-top:6px;"></div>
        <div id="image-url-preview" style="display:none;margin-top:8px;max-width:240px;"></div>
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
</div>
${newsImageUploadScript(item.image_url || '')}`, 'TLC Admin — Edit News Item', TINYMCE_HEAD);
    }

    // ── NEWS ITEMS: UPDATE (POST) ──
    if (path.startsWith('/newsitems/update/') && method === 'POST') {
      const id = path.split('/').pop();
      const form = await request.formData();
      const title = form.get('title') || '';
      const summary = form.get('summary') || '';
      const body = form.get('body') || '';
      // blob: URLs are only valid in the browser tab that created them — dead
      // for every other visitor. Drop rather than store one if it slips through.
      const image_url = (form.get('image_url') || '').trim().startsWith('blob:') ? '' : (form.get('image_url') || '');
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
      const beforeItem = await env.DB.prepare('SELECT title, summary, body, image_url, publish_date, event_date, expire_date, pinned FROM news_items WHERE id = ?').bind(id).first();
      await env.DB.prepare(
        'UPDATE news_items SET title=?, summary=?, body=?, image_url=?, publish_date=?, event_date=?, expire_date=?, pinned=?, theme=?, content_type=?, channels=? WHERE id=?'
      ).bind(title, summary, body, image_url, publish_date, event_date || null, expire_date || null, pinned, theme || null, content_type || null, channels, id).run();
      await logAudit(env.DB, currentUser, 'update', 'news_item', id, title, beforeItem, { title, summary, publish_date, expire_date, pinned });
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=saved' } });
    }

    // ── NEWS ITEMS: DELETE ──
    if (path.startsWith('/newsitems/delete/') && method === 'POST') {
      const id = path.split('/').pop();
      const origin = new URL(request.url).origin;
      const item = await env.DB.prepare('SELECT title, body FROM news_items WHERE id = ?').bind(id).first();
      if (item) {
        for (const key of extractImageKeys(item.body || '', origin)) {
          try { await env.IMAGES.delete(key); } catch (_) {}
        }
      }
      await env.DB.prepare('DELETE FROM news_items WHERE id = ?').bind(id).run();
      await logAudit(env.DB, currentUser, 'delete', 'news_item', id, item ? item.title : id, item, null);
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=deleted' } });
    }

    // ════════════════════════════════════════════════════════
    // ── SITE PAGES ──────────────────────────────────────────
    // ════════════════════════════════════════════════════════
    // Every page on the public site, in menu order. Server-rendered — filters
    // are query parameters rather than client-side hiding, so a bookmarked
    // "?filter=drafts" is a real address and the list cannot disagree with the
    // database.

    if (path === '/pages' || path.startsWith('/pages/')) {
      if (!hasPermission(currentUser, 'site_pages')) return new Response('Access denied.', { status: 403 });

      // ── All pages ──
      if (path === '/pages' && method === 'GET') {
        // Anything whose scheduled time has passed goes live before the list is
        // drawn, so staff never see a page still labelled "scheduled" after the
        // moment it was meant to publish.
        await promoteScheduledPages(env);
        const filter = url.searchParams.get('filter') || 'all';
        const rows = await env.DB.prepare(
          'SELECT id, title, menu_label, slug, parent_id, sort, template, status, in_menu, blocks, published_blocks, publish_at, updated_at, updated_by FROM pages ORDER BY sort ASC, title ASC'
        ).all().catch(() => ({ results: [] }));
        const all = rows.results || [];

        const ordered = orderPages(all);
        const shown = filterPages(ordered, filter);
        const draftCount = ordered.filter((p) => p.hasDraftEdits).length;
        const parentName = (id) => {
          const p = ordered.find((x) => x.id === id);
          return p ? (p.menu_label || p.title) : '';
        };
        const edited = (p) => {
          if (!p.updated_at) return 'Not yet edited';
          const d = new Date(p.updated_at);
          const when = isNaN(d) ? p.updated_at : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          return when + (p.updated_by ? ' · ' + p.updated_by : '');
        };

        const rowsHtml = shown.map((p) => {
          const s = pageStatus(p);
          return `<tr>
  <td>
    <div style="font-weight:600;color:var(--steel);${p.parent_id ? 'padding-left:22px;' : ''}">
      <a href="/pages/${escapeHtml(p.id)}/edit" style="color:inherit;text-decoration:none;">${escapeHtml(p.menu_label || p.title)}</a>
      ${p.slug === '/' ? '<span style="margin-left:8px;display:inline-block;padding:2px 7px;border-radius:4px;background:var(--linen);color:var(--gray);font-size:10px;font-weight:700;letter-spacing:.08em;">HOME</span>' : ''}
    </div>
    <div style="font-size:12px;color:var(--gray);${p.parent_id ? 'padding-left:22px;' : ''}">${p.blockCount} block${p.blockCount === 1 ? '' : 's'}${p.neverPublished ? ' · never published' : ''}</div>
  </td>
  <td style="font-size:13px;color:var(--gray);white-space:nowrap;">${escapeHtml(p.slug)}</td>
  <td style="font-size:13px;color:var(--gray);white-space:nowrap;">${p.in_menu ? (p.parent_id ? 'Under ' + escapeHtml(parentName(p.parent_id)) : 'Top level') : '—'}</td>
  <td><span style="display:inline-block;padding:3px 9px;border-radius:999px;font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${s.bg};color:${s.fg};">${escapeHtml(s.label)}</span></td>
  <td style="font-size:13px;color:var(--gray);white-space:nowrap;">${escapeHtml(edited(p))}</td>
  <td style="text-align:right;white-space:nowrap;">
    <a href="/pages/${escapeHtml(p.id)}/edit" class="btn btn-sm btn-primary">Edit page →</a>
  </td>
</tr>`;
        }).join('');

        const tab = (key, label) => `<a href="/pages${key === 'all' ? '' : '?filter=' + key}" class="btn btn-sm"${filter === key
          ? ' style="background:var(--steel);color:#fff;border:1px solid var(--steel);"'
          : ' style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);"'}>${label}</a>`;

        return html(`
${sidebarShell('pages', currentUser)}
<div class="wrap wrap-wide">
  <div class="page-title">All pages</div>
  <div class="page-sub">${all.length} page${all.length === 1 ? '' : 's'}${draftCount ? ' · ' + draftCount + ' with unpublished changes' : ''}. Open one to lay it out — drag blocks into the order you want, edit the words on the page itself, then publish.</div>
  <div class="btn-row" style="margin-bottom:20px;justify-content:space-between;">
    <span style="display:flex;gap:8px;">${tab('all', 'All')}${tab('published', 'Published')}${tab('drafts', 'Drafts')}</span>
    <form method="POST" action="/pages/new" style="margin:0;"><button type="submit" class="btn btn-primary">+ New page</button></form>
  </div>
  <div class="card">
    <table style="width:100%;border-collapse:collapse;font-family:var(--sans);">
      <thead><tr style="text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gray);">
        <th scope="col" style="padding:6px 0;">Page</th><th scope="col">Address</th><th scope="col">In menu</th>
        <th scope="col">Status</th><th scope="col">Last edited</th><th scope="col"></th>
      </tr></thead>
      <tbody id="pBody">${rowsHtml}</tbody>
    </table>
    ${shown.length ? '' : `<div style="padding:28px;text-align:center;color:var(--gray);font-size:14px;">No pages ${filter === 'drafts' ? 'have unpublished changes' : 'to show'}.</div>`}
  </div>
</div>
<style>
#pBody tr{border-top:1px solid var(--border);}
#pBody td{padding:12px 8px 12px 0;vertical-align:middle;}
</style>`, 'Pages — TLC Admin');
      }

      // ── New page ──
      // Creates a draft and drops staff straight into the editor with the Page
      // tab open, rather than asking them to fill in a form first.
      if (path === '/pages/new' && method === 'POST') {
        const now = new Date().toISOString();
        let id = 'page-' + Math.random().toString(36).slice(2, 8);
        for (let i = 0; i < 5; i++) {
          const clash = await env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(id).first();
          if (!clash) break;
          id = 'page-' + Math.random().toString(36).slice(2, 8);
        }
        const blocks = sanitizeBlocks(starterBlocks('New page'));
        await env.DB.prepare(
          "INSERT INTO pages (id, title, menu_label, slug, parent_id, sort, template, status, in_menu, seo_description, blocks, updated_at, updated_by) " +
          "VALUES (?, 'New page', '', ?, NULL, 999, 'standard', 'draft', 0, '', ?, ?, ?)"
        ).bind(id, '/' + id, JSON.stringify(blocks), now, currentUser?.username || '').run();
        await logAudit(env.DB, currentUser, 'create', 'page', id, 'New page', null, { title: 'New page', slug: '/' + id });
        return new Response('', { status: 302, headers: { Location: `/pages/${id}/edit?tab=page` } });
      }

      // ── The editor screen ──
      // Same shell as the ministry editor; it works out from its own address
      // which API to talk to. Nothing about a page is baked into the HTML.
      if (path.match(/^\/pages\/[^/]+\/edit$/) && method === 'GET') {
        const id = decodeURIComponent(path.split('/')[2]);
        const exists = await env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(id).first();
        if (!exists) return new Response('', { status: 302, headers: { Location: '/pages' } });
        return new Response(MINISTRY_EDITOR_HTML
          .replace('/*TLCB_EDITOR_CSS*/', editorPhoneCss())
          .replace('<!--TLCB_TINYMCE-->', TINYMCE_HEAD), { headers: EDITOR_HEADERS });
      }

      // ── The editor's API ──
      if (path.startsWith('/pages/api/')) {
        const shared = await sharedEditorApi(path, method, request, env, ctx, currentUser, '/pages/api');
        if (shared) return shared;

        const rest = path.slice('/pages/api'.length);
        const pageMatch = rest.match(/^\/page\/([^/]+)(\/[a-z]+)?$/);
        const pageId = pageMatch ? decodeURIComponent(pageMatch[1]) : '';
        const action = pageMatch ? (pageMatch[2] || '') : '';
        if (!pageId) return jsonResponse({ error: 'Not found' }, 404);

        const COLS = 'id, title, menu_label, slug, parent_id, sort, template, status, in_menu, locked, seo_description, ' +
          'blocks, published_blocks, publish_at, change_log, updated_at, updated_by';
        const row = await env.DB.prepare(`SELECT ${COLS} FROM pages WHERE id = ?`).bind(pageId).first();
        if (!row) return jsonResponse({ error: 'Not found' }, 404);

        // Everything the editor needs in one round trip, including the list of
        // every page for the far-left rail.
        if (!action && method === 'GET') {
          const blocks = sanitizeBlocks(parseBlocks(row.blocks));
          const [media, siblings] = await Promise.all([
            env.DB.prepare('SELECT id, filename, kind, url, thumb_url, alt, meta FROM ministry_media ORDER BY id DESC LIMIT 200')
              .all().catch(() => ({ results: [] })),
            env.DB.prepare('SELECT id, title, menu_label, slug, parent_id, sort, status, in_menu, blocks, published_blocks, publish_at FROM pages ORDER BY sort ASC, title ASC')
              .all().catch(() => ({ results: [] })),
          ]);
          const children = orderPages(siblings.results || []).filter((c) => c.parent_id === row.id);
          return jsonResponse({
            page: {
              slug: row.id, path: row.slug, title: row.title, status: pageEditorStatus(row),
              template: row.template, publish_at: row.publish_at || null, updated_at: row.updated_at || '',
              blocks, changes: parseBlocks(row.change_log),
              published_count: sanitizeBlocks(parseBlocks(row.published_blocks)).length,
            },
            pages: orderPages(siblings.results || []).map((p) => ({
              id: p.id, title: p.menu_label || p.title, slug: p.slug, parent_id: p.parent_id,
              in_menu: !!p.in_menu, hasDraftEdits: p.hasDraftEdits,
            })),
            config: blocksClientConfig(),
            media: media.results || [],
            html: renderPage(blocks, {
              editing: true, slug: row.id, template: row.template, withCss: true,
              data: await pageData(env, ctx), children,
            }),
          });
        }

        // Autosaved working draft. Sanitised on the way in — client-side
        // clamping is a courtesy, this is the control.
        if (action === '/draft' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const blocks = sanitizeBlocks(body.blocks);
          const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0, 24).map((c) => String(c).slice(0, 160));
          const nowIso = new Date().toISOString();
          await env.DB.prepare('UPDATE pages SET blocks = ?, change_log = ?, updated_at = ?, updated_by = ? WHERE id = ?')
            .bind(JSON.stringify(blocks), JSON.stringify(changes), nowIso, currentUser?.username || '', pageId).run();
          const after = Object.assign({}, row, { blocks: JSON.stringify(blocks) });
          return jsonResponse({ ok: true, saved_at: nowIso, status: pageEditorStatus(after), blocks });
        }

        // Publish: the draft becomes what the public site renders, and a
        // snapshot goes into the revision log so it can be rolled back.
        if (action === '/publish' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const blocks = sanitizeBlocks(body.blocks && body.blocks.length ? body.blocks : parseBlocks(row.blocks));
          const json = JSON.stringify(blocks);
          const nowIso = new Date().toISOString();
          await env.DB.prepare(
            "UPDATE pages SET blocks = ?, published_blocks = ?, status = 'published', publish_at = NULL, change_log = '[]', updated_at = ?, updated_by = ? WHERE id = ?"
          ).bind(json, json, nowIso, currentUser?.username || '', pageId).run();
          await env.DB.prepare('INSERT INTO page_revisions (page_id, blocks, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
            .bind(pageId, json, 'Published', nowIso, currentUser?.username || 'staff').run();
          await logAudit(env.DB, currentUser, 'publish', 'page', pageId, row.title, null, { blocks: blocks.length });
          return jsonResponse({ ok: true, status: 'live', saved_at: nowIso, url: 'https://timothystl.org' + row.slug });
        }

        // Schedule: the cron handler promotes the draft when it comes due.
        if (action === '/schedule' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          if (!body.publish_at) {
            await env.DB.prepare('UPDATE pages SET publish_at = NULL WHERE id = ?').bind(pageId).run();
            const after = Object.assign({}, row, { publish_at: null });
            return jsonResponse({ ok: true, status: pageEditorStatus(after), publish_at: null });
          }
          const when = new Date(body.publish_at);
          if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) {
            return jsonResponse({ error: 'Pick a date and time in the future.' }, 400);
          }
          await env.DB.prepare('UPDATE pages SET publish_at = ? WHERE id = ?').bind(when.toISOString(), pageId).run();
          return jsonResponse({ ok: true, status: 'scheduled', publish_at: when.toISOString() });
        }

        if (action === '/revisions' && method === 'GET') {
          const rows = await env.DB.prepare(
            'SELECT id, created_at, created_by, blocks FROM page_revisions WHERE page_id = ? ORDER BY id DESC LIMIT 20'
          ).bind(pageId).all().catch(() => ({ results: [] }));
          return jsonResponse({
            revisions: (rows.results || []).map((r) => ({
              id: r.id, published_at: r.created_at, published_by: r.created_by, count: parseBlocks(r.blocks).length,
            })),
          });
        }

        // Restore loads a snapshot into the DRAFT, never straight to live, so
        // staff look at what they are about to bring back before publishing it.
        if (action === '/restore' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const rev = await env.DB.prepare('SELECT blocks FROM page_revisions WHERE id = ? AND page_id = ?')
            .bind(Number(body.id) || 0, pageId).first();
          if (!rev) return jsonResponse({ error: 'Not found' }, 404);
          const blocks = sanitizeBlocks(parseBlocks(rev.blocks));
          await env.DB.prepare('UPDATE pages SET blocks = ?, updated_at = ? WHERE id = ?')
            .bind(JSON.stringify(blocks), new Date().toISOString(), pageId).run();
          return jsonResponse({
            ok: true, blocks,
            html: renderPage(blocks, { editing: true, slug: row.id, template: row.template, withCss: true, data: await pageData(env, ctx) }),
          });
        }

        return jsonResponse({ error: 'Not found' }, 404);
      }
    }

    // ════════════════════════════════════════════════════════
    // ── MINISTRIES ──────────────────────────────────────────
    // ════════════════════════════════════════════════════════

    if ((path.startsWith('/ministries') || path === '/youth' || path.startsWith('/youth/')) && !hasPermission(currentUser, 'ministries_edit')) {
      return new Response('Access denied.', { status: 403 });
    }

    // Compat: redirect old /youth/* admin URLs to /ministries/*
    if (path === '/youth' && method === 'GET') {
      return new Response('', { status: 302, headers: { Location: '/ministries' } });
    }
    if (path.startsWith('/youth/') && method === 'GET') {
      return new Response('', { status: 302, headers: { Location: '/ministries' + path.slice('/youth'.length) } });
    }

    if (path.startsWith('/ministries')) {
      const CORE_SLUGS = ['youth','sundayschool','confirmation','vbs','egghunt','family','music','stephen','foodpantry','bees','christmasmarket'];

      // ── BLOCK PAGE EDITOR ────────────────────────────────────────────────
      // Full-viewport editor screen. Served as a static shell (same pattern as
      // the payroll page); everything it needs arrives over the JSON API below.
      if (path.startsWith('/ministries/editor/') && method === 'GET') {
        const slug = decodeURIComponent(path.slice('/ministries/editor/'.length));
        const exists = await env.DB.prepare('SELECT slug FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!exists) return new Response('', { status: 302, headers: { Location: '/ministries' } });
        const editorHtml = MINISTRY_EDITOR_HTML
          .replace('/*TLCB_EDITOR_CSS*/', editorPhoneCss())
          .replace('<!--TLCB_TINYMCE-->', TINYMCE_HEAD);
        return new Response(editorHtml, { headers: EDITOR_HEADERS });
      }

      // Everything the editor needs in one round trip.
      if (path.startsWith('/ministries/api/page/') && method === 'GET') {
        const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length));
        const row = await env.DB.prepare(
          'SELECT slug, title, blocks, published_blocks, page_status, publish_at, change_log, updated_at FROM youth_pages WHERE slug = ?'
        ).bind(slug).first();
        if (!row) return jsonResponse({ error: 'Not found' }, 404);
        const blocks = sanitizeBlocks(parseBlocks(row.blocks));
        const media = await env.DB.prepare(
          'SELECT id, filename, kind, url, thumb_url, alt, meta FROM ministry_media ORDER BY id DESC LIMIT 200'
        ).all().catch(() => ({ results: [] }));
        return jsonResponse({
          page: {
            slug: row.slug, title: row.title, status: row.page_status || 'live',
            publish_at: row.publish_at || null, updated_at: row.updated_at || '',
            blocks, changes: parseBlocks(row.change_log),
            published_count: sanitizeBlocks(parseBlocks(row.published_blocks)).length,
          },
          config: blocksClientConfig(),
          media: media.results || [],
          html: renderPage(blocks, { editing: true, slug, withCss: true, data: await pageData(env, ctx) }),
        });
      }

      // Autosaved working draft. Sanitised on the way in — client-side clamping
      // is a courtesy, this is the control.
      if (path.startsWith('/ministries/api/page/') && path.endsWith('/draft') && method === 'POST') {
        const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/draft'.length)));
        const row = await env.DB.prepare('SELECT slug, page_status, published_blocks FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!row) return jsonResponse({ error: 'Not found' }, 404);
        const body = await request.json().catch(() => ({}));
        const blocks = sanitizeBlocks(body.blocks);
        const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0, 24).map((c) => String(c).slice(0, 160));
        const published = JSON.stringify(sanitizeBlocks(parseBlocks(row.published_blocks)));
        const draft = JSON.stringify(blocks);
        // A page only leaves "live" once the draft actually differs from what
        // is published — otherwise an idle autosave would flag a false draft.
        let status = row.page_status || 'live';
        if (status !== 'scheduled') status = draft === published ? 'live' : 'draft';
        const nowIso = new Date().toISOString();
        await env.DB.prepare('UPDATE youth_pages SET blocks = ?, change_log = ?, page_status = ?, updated_at = ? WHERE slug = ?')
          .bind(draft, JSON.stringify(changes), status, nowIso, slug).run();
        return jsonResponse({ ok: true, saved_at: nowIso, status, blocks });
      }

      // Publish: the draft becomes what the public site renders, and a snapshot
      // goes into the revision log so it can be rolled back.
      if (path.startsWith('/ministries/api/page/') && path.endsWith('/publish') && method === 'POST') {
        const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/publish'.length)));
        const row = await env.DB.prepare('SELECT slug, title, blocks FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!row) return jsonResponse({ error: 'Not found' }, 404);
        const body = await request.json().catch(() => ({}));
        const blocks = sanitizeBlocks(body.blocks && body.blocks.length ? body.blocks : parseBlocks(row.blocks));
        const json = JSON.stringify(blocks);
        const nowIso = new Date().toISOString();
        await env.DB.prepare(
          "UPDATE youth_pages SET blocks = ?, published_blocks = ?, page_status = 'live', publish_at = NULL, change_log = '[]', updated_at = ? WHERE slug = ?"
        ).bind(json, json, nowIso, slug).run();
        await env.DB.prepare('INSERT INTO ministry_page_revisions (slug, blocks, published_at, published_by) VALUES (?, ?, ?, ?)')
          .bind(slug, json, nowIso, currentUser?.username || 'staff').run();
        await logAudit(env.DB, currentUser, 'publish', 'ministry_page', slug, row.title || slug, null, { blocks: blocks.length });
        return jsonResponse({ ok: true, status: 'live', saved_at: nowIso, url: 'https://timothystl.org/' + slug });
      }

      // Schedule: the draft is promoted by the cron handler when it comes due.
      if (path.startsWith('/ministries/api/page/') && path.endsWith('/schedule') && method === 'POST') {
        const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/schedule'.length)));
        const row = await env.DB.prepare('SELECT slug, blocks, published_blocks FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!row) return jsonResponse({ error: 'Not found' }, 404);
        const body = await request.json().catch(() => ({}));
        if (!body.publish_at) {
          const back = JSON.stringify(sanitizeBlocks(parseBlocks(row.blocks))) === JSON.stringify(sanitizeBlocks(parseBlocks(row.published_blocks))) ? 'live' : 'draft';
          await env.DB.prepare('UPDATE youth_pages SET publish_at = NULL, page_status = ? WHERE slug = ?').bind(back, slug).run();
          return jsonResponse({ ok: true, status: back, publish_at: null });
        }
        const when = new Date(body.publish_at);
        if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) {
          return jsonResponse({ error: 'Pick a date and time in the future.' }, 400);
        }
        await env.DB.prepare("UPDATE youth_pages SET publish_at = ?, page_status = 'scheduled' WHERE slug = ?").bind(when.toISOString(), slug).run();
        return jsonResponse({ ok: true, status: 'scheduled', publish_at: when.toISOString() });
      }

      if (path.startsWith('/ministries/api/page/') && path.endsWith('/revisions') && method === 'GET') {
        const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/revisions'.length)));
        const rows = await env.DB.prepare(
          'SELECT id, published_at, published_by, blocks FROM ministry_page_revisions WHERE slug = ? ORDER BY id DESC LIMIT 20'
        ).bind(slug).all();
        return jsonResponse({
          revisions: (rows.results || []).map((r) => ({
            id: r.id, published_at: r.published_at, published_by: r.published_by, count: parseBlocks(r.blocks).length,
          })),
        });
      }

      // Restore loads a snapshot into the DRAFT, never straight to live, so
      // staff look at what they are about to bring back before publishing it.
      if (path.startsWith('/ministries/api/page/') && path.endsWith('/restore') && method === 'POST') {
        const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/restore'.length)));
        const body = await request.json().catch(() => ({}));
        const rev = await env.DB.prepare('SELECT blocks FROM ministry_page_revisions WHERE id = ? AND slug = ?')
          .bind(Number(body.id) || 0, slug).first();
        if (!rev) return jsonResponse({ error: 'Not found' }, 404);
        const blocks = sanitizeBlocks(parseBlocks(rev.blocks));
        await env.DB.prepare("UPDATE youth_pages SET blocks = ?, page_status = 'draft', updated_at = ? WHERE slug = ?")
          .bind(JSON.stringify(blocks), new Date().toISOString(), slug).run();
        return jsonResponse({ ok: true, blocks, html: renderPage(blocks, { editing: true, slug, withCss: true, data: await pageData(env, ctx) }) });
      }

      const sharedMinistry = await sharedEditorApi(path, method, request, env, ctx, currentUser, '/ministries/api');
      if (sharedMinistry) return sharedMinistry;

      // ── Ministry list ──
      if (path === '/ministries' && method === 'GET') {
        // Anything whose scheduled time has passed goes live before the list is
        // drawn, so staff never see a page still labelled "scheduled" after the
        // moment it was meant to publish.
        await promoteScheduledPages(env);
        const pages = await env.DB.prepare(
          'SELECT slug, title, has_posts, updated_at, blocks, published_blocks, page_status, publish_at FROM youth_pages ORDER BY rowid'
        ).all();
        const msg = url.searchParams.get('msg');
        let alertHtml = '';
        if (msg === 'saved')       alertHtml = `<div class="alert alert-success">✓ Page saved and published.</div>`;
        if (msg === 'created')     alertHtml = `<div class="alert alert-success">✓ Ministry page created — open the editor to lay it out.</div>`;
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

        const PILL = {
          draft:     { label: 'Draft',     bg: '#F5E4C0', fg: '#7A5A12' },
          live:      { label: 'Live',      bg: '#DCE6D6', fg: '#3B4C2E' },
          scheduled: { label: 'Scheduled', bg: '#E4EEF4', fg: '#1E5C7A' },
          hidden:    { label: 'Hidden',    bg: '#EDE9E0', fg: '#6A6858' },
        };

        const rows = pages.results.map((p) => {
          const draftCount = sanitizeBlocks(parseBlocks(p.blocks)).length;
          const status = PILL[p.page_status] ? p.page_status : 'live';
          const pill = PILL[status];
          const when = status === 'scheduled' && p.publish_at
            ? new Date(p.publish_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            : (p.updated_at ? p.updated_at.split('T')[0] : 'Not yet edited');
          const postCount = countMap[p.slug] || 0;
          return `<tr class="mrow" data-name="${escapeHtml((p.title + ' ' + p.slug).toLowerCase())}" data-status="${status}" data-updated="${escapeHtml(p.updated_at || '')}">
  <td>
    <div style="font-weight:600;color:var(--steel);">${escapeHtml(p.title)}</div>
    <div style="font-size:12px;color:var(--gray);">/${escapeHtml(p.slug)} · ${draftCount} block${draftCount === 1 ? '' : 's'}${postCount ? ' · ' + postCount + ' post' + (postCount === 1 ? '' : 's') : ''}</div>
  </td>
  <td><span style="display:inline-block;padding:3px 9px;border-radius:999px;font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${pill.bg};color:${pill.fg};">${pill.label}</span></td>
  <td style="font-size:13px;color:var(--gray);white-space:nowrap;">${escapeHtml(when)}</td>
  <td style="text-align:right;white-space:nowrap;">
    ${p.has_posts ? `<a href="/ministries/${escapeHtml(p.slug)}/posts" class="btn btn-sm btn-sage">Posts${postCount > 0 ? ' (' + postCount + ')' : ''}</a>` : ''}
    <a href="/ministries/edit/${escapeHtml(p.slug)}" class="btn btn-sm btn-secondary">Banner &amp; settings</a>
    <a href="/ministries/editor/${escapeHtml(p.slug)}" class="btn btn-sm btn-primary">Edit page →</a>
    ${!CORE_SLUGS.includes(p.slug) ? `<form method="POST" action="/ministries/delete/${escapeHtml(p.slug)}" onsubmit="return confirm('Delete this ministry page?')" style="display:inline;margin:0;"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form>` : ''}
  </td>
</tr>`;
        }).join('');

        return html(`
${sidebarShell('ministries', currentUser)}
<div class="wrap wrap-wide">
  <div class="page-title">Ministries</div>
  <div class="page-sub">${pages.results.length} pages. Open one to rearrange it — drag blocks into the order you want, edit the words on the page itself, then publish.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:20px;">
    <a href="/ministries/add" class="btn btn-primary">+ New ministry page</a>
    <a href="/manual#ministry-editor" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">How the page editor works</a>
  </div>
  <div class="card">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
      <input id="mSearch" type="search" placeholder="Search pages…" style="flex:1;min-width:200px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-family:var(--sans);font-size:14px;">
      <select id="mStatus" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-family:var(--sans);font-size:14px;">
        <option value="">All statuses</option>
        <option value="live">Live</option>
        <option value="draft">Draft</option>
        <option value="scheduled">Scheduled</option>
        <option value="hidden">Hidden</option>
      </select>
      <select id="mSort" style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-family:var(--sans);font-size:14px;">
        <option value="recent">Sort: recently updated</option>
        <option value="name">Sort: name</option>
      </select>
    </div>
    <table style="width:100%;border-collapse:collapse;font-family:var(--sans);">
      <thead><tr style="text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gray);">
        <th scope="col" style="padding:6px 0;">Page</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"></th>
      </tr></thead>
      <tbody id="mBody">${rows}</tbody>
    </table>
    <div id="mNone" style="display:none;padding:28px;text-align:center;color:var(--gray);font-size:14px;">No pages match that.</div>
  </div>
  <div class="card" style="margin-top:20px;">
    <div class="card-title">Voters Assembly page</div>
    <div class="card-sub" style="font-size:13px;color:var(--gray);">Zoom link &amp; council report downloads · /voters</div>
    <div class="btn-row" style="margin-top:12px;"><a href="/voters" class="btn btn-sm btn-secondary">Edit</a></div>
  </div>
</div>
<style>
#mBody tr{border-top:1px solid var(--border);}
#mBody td{padding:12px 8px 12px 0;vertical-align:middle;}
</style>
<script>
(function(){
  var body = document.getElementById('mBody');
  var all = Array.prototype.slice.call(body.querySelectorAll('tr'));
  function apply(){
    var q = document.getElementById('mSearch').value.trim().toLowerCase();
    var st = document.getElementById('mStatus').value;
    var sort = document.getElementById('mSort').value;
    var shown = 0;
    all.forEach(function(tr){
      var hit = (!q || tr.dataset.name.indexOf(q) > -1) && (!st || tr.dataset.status === st);
      tr.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    document.getElementById('mNone').style.display = shown ? 'none' : '';
    var sorted = all.slice().sort(function(a,b){
      if (sort === 'name') return a.dataset.name.localeCompare(b.dataset.name);
      return (b.dataset.updated || '').localeCompare(a.dataset.updated || '');
    });
    sorted.forEach(function(tr){ body.appendChild(tr); });
  }
  ['mSearch','mStatus','mSort'].forEach(function(id){
    document.getElementById(id).addEventListener('input', apply);
    document.getElementById(id).addEventListener('change', apply);
  });
  apply();
})();
</script>`, 'Ministries Admin');
      }

      // ── Add ministry form (GET) ──
      if (path === '/ministries/add' && method === 'GET') {
        return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries">← All ministries</a>`)}
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
        // A new page starts from three sensible blocks rather than a blank
        // canvas — an empty page is intimidating, three blocks are not — and
        // opens straight into the editor.
        const starter = JSON.stringify(starterBlocks(title));
        await env.DB.prepare(
          "INSERT OR IGNORE INTO youth_pages (slug, title, content, has_posts, updated_at, blocks, published_blocks, page_status, change_log) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', '[]')"
        ).bind(slug, title, '', has_posts, new Date().toISOString(), starter, '[]').run();
        await logAudit(env.DB, currentUser, 'create', 'ministry_page', slug, title, null, { blocks: parseBlocks(starter).length });
        return new Response('', { status: 302, headers: { Location: '/ministries/editor/' + encodeURIComponent(slug) } });
      }

      // ── Edit ministry page (GET) ──
      if (path.startsWith('/ministries/edit/') && method === 'GET') {
        const slug = path.slice('/ministries/edit/'.length);
        const page = await env.DB.prepare('SELECT * FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!page) return new Response('Not found', { status: 404 });
        const videoSectionHtml = slug === 'music' ? `
<div class="card" style="margin-top:24px;">
  <div class="card-title">Video highlights <span class="tag">Music page only</span></div>
  <div class="card-sub" style="font-size:13px;color:var(--gray);margin-bottom:16px;">Paste YouTube video URLs for up to 3 highlight clips shown on the Music page. Use the full URL (e.g. https://youtu.be/ABC123 or https://www.youtube.com/watch?v=ABC123).</div>
  ${[1,2,3].map(i => `
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border);">
    <div class="form-group" style="margin:0;">
      <label>Video ${i} — YouTube URL</label>
      <input type="text" name="vid_${i}_url" value="${escapeHtml(page['vid_' + i + '_url'] || '')}" placeholder="https://youtu.be/...">
    </div>
    <div class="form-group" style="margin:0;">
      <label>Label</label>
      <input type="text" name="vid_${i}_title" value="${escapeHtml(page['vid_' + i + '_title'] || '')}" placeholder="e.g. Handbell Choir">
    </div>
  </div>`).join('')}
</div>` : '';
        return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries">← All ministries</a>`)}
<div class="wrap">
  <div class="page-title">${page.title}</div>
  <div class="page-sub">Banner image, buttons and video slots for this page.</div>
  <div class="alert alert-info" style="margin-bottom:20px;">
    <strong>The words and layout of this page are edited in the page editor.</strong>
    Open <a href="/ministries/editor/${escapeHtml(slug)}">${escapeHtml(page.title)} in the page editor</a> to write copy and arrange blocks.
    This screen keeps the page banner and a few older settings. The body text below is only used on pages that have not been laid out in blocks yet.
  </div>
  <div class="card">
    <form method="POST" action="/ministries/update/${slug}">
      <div class="form-group">
        <label>Page title</label>
        <input type="text" name="title" value="${(page.title || '').replace(/"/g, '&quot;')}" required>
      </div>
      ${tinymceYouthSection(page.content || '')}
      <div class="card" style="margin-top:24px;">
  <div class="card-title">Ministry Images</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
    <div class="form-group" style="margin:0;">
      <label>Hero banner image <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— shown at top of page (1200×500px ideal)</span></label>
      <input type="hidden" name="hero_image_url" id="hero_image_url_val" value="${escapeHtml(page.hero_image_url || '')}">
      <div id="hero-img-preview" style="${page.hero_image_url ? '' : 'display:none;'}margin-bottom:8px;">
        ${page.hero_image_url ? `<img src="${escapeHtml(page.hero_image_url)}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;">` : ''}
      </div>
      <input type="file" id="hero_image_file" accept="image/jpeg,image/png,image/webp" style="font-size:13px;">
      <div id="hero-upload-status" style="font-size:12px;color:var(--gray);margin-top:4px;"></div>
      ${page.hero_image_url ? `<button type="button" onclick="document.getElementById('hero_image_url_val').value='';document.getElementById('hero-img-preview').style.display='none';this.style.display='none';" class="btn btn-sm btn-danger" style="margin-top:8px;font-size:11px;padding:5px 12px;">Remove image</button>` : ''}
    </div>
    <div class="form-group" style="margin:0;">
      <label>Ministry photo <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— shown in the content area (800×600px ideal)</span></label>
      <input type="hidden" name="ministry_image_url" id="ministry_image_url_val" value="${escapeHtml(page.ministry_image_url || '')}">
      <div id="ministry-img-preview" style="${page.ministry_image_url ? '' : 'display:none;'}margin-bottom:8px;">
        ${page.ministry_image_url ? `<img src="${escapeHtml(page.ministry_image_url)}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;">` : ''}
      </div>
      <input type="file" id="ministry_image_file" accept="image/jpeg,image/png,image/webp" style="font-size:13px;">
      <div id="ministry-upload-status" style="font-size:12px;color:var(--gray);margin-top:4px;"></div>
      ${page.ministry_image_url ? `<button type="button" onclick="document.getElementById('ministry_image_url_val').value='';document.getElementById('ministry-img-preview').style.display='none';this.style.display='none';" class="btn btn-sm btn-danger" style="margin-top:8px;font-size:11px;padding:5px 12px;">Remove image</button>` : ''}
    </div>
  </div>
</div>
      ${videoSectionHtml}
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
<script>
(function() {
  function wireUpload(fileInputId, hiddenId, previewId, statusId) {
    document.getElementById(fileInputId).addEventListener('change', async function() {
      var file = this.files[0];
      if (!file) return;
      var status = document.getElementById(statusId);
      status.textContent = 'Uploading…';
      var fd = new FormData();
      fd.append('file', file);
      try {
        var r = await fetch('/api/upload-image', { method: 'POST', body: fd });
        var j = await r.json();
        if (j.url) {
          document.getElementById(hiddenId).value = j.url;
          var prev = document.getElementById(previewId);
          prev.innerHTML = '<img src="' + j.url + '" style="width:100%;height:120px;object-fit:cover;border-radius:6px;">';
          prev.style.display = '';
          status.textContent = '✓ Uploaded';
          status.style.color = 'var(--sage)';
        } else {
          status.textContent = j.error || 'Upload failed';
          status.style.color = '#B85C3A';
        }
      } catch(e) {
        status.textContent = 'Upload failed — try again';
        status.style.color = '#B85C3A';
      }
    });
  }
  wireUpload('hero_image_file', 'hero_image_url_val', 'hero-img-preview', 'hero-upload-status');
  wireUpload('ministry_image_file', 'ministry_image_url_val', 'ministry-img-preview', 'ministry-upload-status');
})();
</script>
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
        const heroImageUrl = form.get('hero_image_url') || '';
        const ministryImageUrl = form.get('ministry_image_url') || '';
        const vid1Url = form.get('vid_1_url') || '';
        const vid1Title = form.get('vid_1_title') || '';
        const vid2Url = form.get('vid_2_url') || '';
        const vid2Title = form.get('vid_2_title') || '';
        const vid3Url = form.get('vid_3_url') || '';
        const vid3Title = form.get('vid_3_title') || '';
        const now = new Date().toISOString();
        const beforePage = await env.DB.prepare('SELECT title, content, cta_label, cta_url FROM youth_pages WHERE slug = ?').bind(slug).first();
        await env.DB.prepare(
          'UPDATE youth_pages SET title = ?, content = ?, cta_label = ?, cta_url = ?, cta_label_2 = ?, cta_url_2 = ?, hero_image_url = ?, ministry_image_url = ?, vid_1_url = ?, vid_1_title = ?, vid_2_url = ?, vid_2_title = ?, vid_3_url = ?, vid_3_title = ?, updated_at = ? WHERE slug = ?'
        ).bind(title, content, ctaLabel, ctaUrl, ctaLabel2, ctaUrl2, heroImageUrl, ministryImageUrl, vid1Url, vid1Title, vid2Url, vid2Title, vid3Url, vid3Title, now, slug).run();
        await logAudit(env.DB, currentUser, 'update', 'ministry_page', slug, title, beforePage, { title, content: content.substring(0, 200), ctaLabel, ctaUrl });
        return new Response('', { status: 302, headers: { Location: '/ministries?msg=saved' } });
      }

      // ── Delete ministry page (POST) — non-core only ──
      if (path.startsWith('/ministries/delete/') && method === 'POST') {
        const slug = path.slice('/ministries/delete/'.length);
        if (CORE_SLUGS.includes(slug)) {
          return new Response('Cannot delete a built-in ministry page.', { status: 403 });
        }
        const delPage = await env.DB.prepare('SELECT title FROM youth_pages WHERE slug = ?').bind(slug).first();
        await env.DB.prepare('DELETE FROM ministry_posts WHERE ministry_slug = ?').bind(slug).run();
        await env.DB.prepare('DELETE FROM youth_pages WHERE slug = ?').bind(slug).run();
        await logAudit(env.DB, currentUser, 'delete', 'ministry_page', slug, delPage ? delPage.title : slug, delPage, null);
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
${sidebarShell('ministries', currentUser, `<a href="/ministries">← All ministries</a>`)}
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
${sidebarShell('ministries', currentUser, `<a href="/ministries/${slug}/posts">← Posts</a>`)}
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
        const newPostResult = await env.DB.prepare(
          'INSERT INTO ministry_posts (ministry_slug, title, post_date, event_date, expire_date, body, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(slug, title, post_date, event_date, expire_date, body, pinned).run();
        await logAudit(env.DB, currentUser, 'create', 'ministry_post', newPostResult.meta.last_row_id, title, null, { title, post_date, event_date, expire_date, ministry_slug: slug });
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
${sidebarShell('ministries', currentUser, `<a href="/ministries/${slug}/posts">← Posts</a>`)}
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
        const beforePost = await env.DB.prepare('SELECT title, post_date, event_date, expire_date, body, pinned FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).first();
        await env.DB.prepare(
          'UPDATE ministry_posts SET title = ?, post_date = ?, event_date = ?, expire_date = ?, body = ?, pinned = ? WHERE id = ? AND ministry_slug = ?'
        ).bind(title, post_date, event_date, expire_date, body, pinned, id, slug).run();
        await logAudit(env.DB, currentUser, 'update', 'ministry_post', id, title, beforePost ? { ...beforePost, body: (beforePost.body || '').substring(0, 200) } : null, { title, post_date, event_date, expire_date, pinned });
        return new Response('', { status: 302, headers: { Location: `/ministries/${slug}/posts?msg=postsaved` } });
      }

      // ── Delete post (POST) ──
      if (path.match(/^\/ministries\/[^/]+\/posts\/delete\/[^/]+$/) && method === 'POST') {
        const parts = path.split('/');
        const slug = parts[2];
        const id = parts[5];
        const delPost = await env.DB.prepare('SELECT title FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).first();
        await env.DB.prepare('DELETE FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).run();
        await logAudit(env.DB, currentUser, 'delete', 'ministry_post', id, delPost ? delPost.title : id, delPost, null);
        return new Response('', { status: 302, headers: { Location: `/ministries/${slug}/posts?msg=postdeleted` } });
      }

    } // end if (path.startsWith('/ministries'))

    // ── NOTICES TAB (formerly "Pages") ──
    // Self-serve: any number of notices can be added to any static page, no developer needed.
    // Compat: old bookmarked /pages admin URLs redirect to /notices.
    if (path === '/pages' && method === 'GET') {
      return new Response('', { status: 302, headers: { Location: '/notices' } });
    }
    if (path.startsWith('/pages/') && method === 'GET') {
      return new Response('', { status: 302, headers: { Location: '/notices' + path.slice('/pages'.length) } });
    }
    if (path.startsWith('/notices') && !hasPermission(currentUser, 'pages_edit')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path.startsWith('/notices')) {
      const pageLabel = slug => (STATIC_PAGES.find(p => p.slug === slug) || {}).label || slug;
      const pageOptionsHtml = selected => STATIC_PAGES.map(p =>
        `<option value="${p.slug}" ${p.slug === selected ? 'selected' : ''}>${p.label}</option>`).join('');

      // ── List, grouped by static page ──
      if (path === '/notices' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT id, page_slug, label, body, published, updated_at FROM notices ORDER BY page_slug, position, id').all();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Notice saved.</div>`
          : msg === 'created' ? `<div class="alert alert-success">✓ Notice added.</div>`
          : msg === 'deleted' ? `<div class="alert alert-info">Notice deleted.</div>` : '';

        const byPage = {};
        rows.results.forEach(r => { (byPage[r.page_slug] = byPage[r.page_slug] || []).push(r); });

        const rowHtml = n => {
          const isEmpty = !n.body || !n.body.trim();
          const isHidden = n.published === 0;
          const updated = n.updated_at ? new Date(n.updated_at).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : '—';
          let statusHtml;
          if (isEmpty) statusHtml = '<em style="color:var(--gray);">Empty — hidden on site</em>';
          else if (isHidden) statusHtml = '<span style="color:#8a6a00;">⏸ Hidden (content saved)</span>';
          else statusHtml = '<span style="color:#2a5c2a;">✓ Published</span>';
          return `<tr>
            <td><strong>${escapeHtml(n.label)}</strong></td>
            <td style="font-size:13px;color:var(--gray);">${statusHtml}</td>
            <td style="font-size:12px;color:var(--gray);">${updated}</td>
            <td style="text-align:right;white-space:nowrap;">
              <a href="/notices/edit/${n.id}" class="btn btn-sm btn-secondary">Edit</a>
              <form method="POST" action="/notices/delete/${n.id}" onsubmit="return confirm('Delete this notice?')" style="display:inline;margin:0;"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form>
            </td>
          </tr>`;
        };

        const groupsHtml = STATIC_PAGES.map(p => {
          const pageRows = byPage[p.slug] || [];
          return `<div style="margin-bottom:28px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
    <div style="font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">${p.label}</div>
    <a href="/notices/add?page=${p.slug}" style="font-family:var(--sans);font-size:12px;font-weight:700;color:var(--steel);text-decoration:none;">+ Add notice</a>
  </div>
  ${pageRows.length ? `<div class="card" style="padding:0;overflow:hidden;">
    <table style="width:100%;border-collapse:collapse;">
      <tbody style="font-family:var(--sans);">
        ${pageRows.map(rowHtml).join('')}
      </tbody>
    </table>
  </div>` : `<div style="font-size:13px;color:var(--gray);font-style:italic;padding:2px 2px 0;">No notices on this page yet.</div>`}
</div>`;
        }).join('');

        return html(`
${sidebarShell('notices', currentUser)}
<div class="wrap">
  <div class="page-title">Notices</div>
  <div class="page-sub">Banners and announcements shown on the website's static pages. Add as many as you need to any page — no developer required.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/notices/add" class="btn btn-primary">+ Add notice</a>
  </div>
  ${groupsHtml}
</div>`, 'Notices');
      }

      // ── Add notice (GET) ──
      if (path === '/notices/add' && method === 'GET') {
        const preselect = url.searchParams.get('page') || STATIC_PAGES[0].slug;
        return html(`
${sidebarShell('notices', currentUser, `<a href="/notices">← All notices</a>`)}
<div class="wrap">
  <div class="page-title">New notice</div>
  <div class="page-sub">Choose which page it appears on and write the content. It publishes immediately.</div>
  <div class="card">
    <form method="POST" action="/notices/create">
      <div class="form-group">
        <label>Page <span style="color:#B85C3A;">*</span></label>
        <select name="page_slug">${pageOptionsHtml(preselect)}</select>
      </div>
      <div class="form-group">
        <label>Internal label <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— for your reference in this list, not shown on the site</span></label>
        <input type="text" name="label" required placeholder="e.g. Lent midweek services">
      </div>
      ${tinymcePageSection('')}
      <div class="btn-row" style="margin-top:24px;">
        <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save &amp; Publish →</button>
        <a href="/notices" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'New Notice', TINYMCE_HEAD);
      }

      // ── Create notice (POST) ──
      if (path === '/notices/create' && method === 'POST') {
        const form = await request.formData();
        const pageSlug = form.get('page_slug') || STATIC_PAGES[0].slug;
        const label = form.get('label') || 'Untitled notice';
        const body = form.get('content') || '';
        const now = new Date().toISOString();
        const maxPos = await env.DB.prepare('SELECT COALESCE(MAX(position), -1) as m FROM notices WHERE page_slug = ?').bind(pageSlug).first();
        await env.DB.prepare(
          'INSERT INTO notices (page_slug, label, body, published, position, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
        ).bind(pageSlug, label, body, (maxPos ? maxPos.m : -1) + 1, now).run();
        await logAudit(env.DB, currentUser, 'create', 'notice', pageSlug, label, null, { pageSlug, label });
        return new Response('', { status: 302, headers: { Location: '/notices?msg=created' } });
      }

      // ── Edit notice (GET) ──
      if (path.startsWith('/notices/edit/') && method === 'GET') {
        const id = path.slice('/notices/edit/'.length);
        const n = await env.DB.prepare('SELECT * FROM notices WHERE id = ?').bind(id).first();
        if (!n) return new Response('Not found', { status: 404 });
        const publishedChecked = n.published === 1 ? 'checked' : '';
        return html(`
${sidebarShell('notices', currentUser, `<a href="/notices">← All notices</a>`)}
<div class="wrap">
  <div class="page-title">${escapeHtml(n.label)}</div>
  <div class="page-sub">Shown on the ${pageLabel(n.page_slug)} page.</div>
  <div class="card">
    <form method="POST" action="/notices/update/${n.id}">
      <div class="form-group">
        <label>Page</label>
        <select name="page_slug">${pageOptionsHtml(n.page_slug)}</select>
      </div>
      <div class="form-group">
        <label>Internal label</label>
        <input type="text" name="label" value="${escapeHtml(n.label)}" required>
      </div>
      <div class="card" style="margin-bottom:24px;background:var(--mist);border:1px solid var(--ice);">
        <div class="card-title">Visibility</div>
        <label style="display:flex;align-items:center;gap:12px;font-family:var(--sans);font-size:14px;cursor:pointer;">
          <input type="checkbox" name="published" value="1" ${publishedChecked} style="width:18px;height:18px;cursor:pointer;">
          Show this notice on the website
        </label>
        <div style="font-size:12px;color:var(--gray);margin-top:8px;">Uncheck to hide without deleting it — useful between seasons or events.</div>
      </div>
      ${tinymcePageSection(n.body || '')}
      <div class="btn-row" style="margin-top:24px;">
        <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save &amp; Publish →</button>
        <a href="/notices" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, `Edit — ${n.label}`, TINYMCE_HEAD);
      }

      // ── Save notice (POST) ──
      if (path.startsWith('/notices/update/') && method === 'POST') {
        const id = path.slice('/notices/update/'.length);
        const form = await request.formData();
        const pageSlug = form.get('page_slug') || STATIC_PAGES[0].slug;
        const label = form.get('label') || 'Untitled notice';
        const body = form.get('content') || '';
        const published = form.has('published') ? 1 : 0;
        const now = new Date().toISOString();
        const before = await env.DB.prepare('SELECT page_slug, label, body FROM notices WHERE id = ?').bind(id).first();
        await env.DB.prepare(
          'UPDATE notices SET page_slug = ?, label = ?, body = ?, published = ?, updated_at = ? WHERE id = ?'
        ).bind(pageSlug, label, body, published, now, id).run();
        await logAudit(env.DB, currentUser, 'update', 'notice', id, label, before, { pageSlug, label });
        return new Response('', { status: 302, headers: { Location: '/notices?msg=saved' } });
      }

      // ── Delete notice (POST) ──
      if (path.startsWith('/notices/delete/') && method === 'POST') {
        const id = path.slice('/notices/delete/'.length);
        const del = await env.DB.prepare('SELECT label FROM notices WHERE id = ?').bind(id).first();
        await env.DB.prepare('DELETE FROM notices WHERE id = ?').bind(id).run();
        await logAudit(env.DB, currentUser, 'delete', 'notice', id, del ? del.label : id, del, null);
        return new Response('', { status: 302, headers: { Location: '/notices?msg=deleted' } });
      }
    } // end notices tab

    // ── STAFF TAB ──────────────────────────────────────────────
    if (path.startsWith('/staff') && !hasPermission(currentUser, 'staff_edit')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path.startsWith('/staff')) {
      const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

      // Staff list
      if (path === '/staff' && method === 'GET') {
        const members = await env.DB.prepare('SELECT * FROM staff_members ORDER BY display_order, id').all();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Staff member saved.</div>`
          : msg === 'deleted' ? `<div class="alert alert-info">Staff member removed.</div>` : '';
        const rows = members.results.map((m, i) => `
          <div class="ni-row" style="align-items:center;">
            <div style="display:flex;flex-direction:column;gap:2px;">
              <button type="button" onclick="staffMove(${m.id},'up')" ${i === 0 ? 'disabled' : ''} class="btn btn-sm" style="padding:2px 8px;line-height:1;${i === 0 ? 'opacity:.3;' : ''}" title="Move up">▲</button>
              <button type="button" onclick="staffMove(${m.id},'down')" ${i === members.results.length - 1 ? 'disabled' : ''} class="btn btn-sm" style="padding:2px 8px;line-height:1;${i === members.results.length - 1 ? 'opacity:.3;' : ''}" title="Move down">▼</button>
            </div>
            <div style="position:relative;font-size:28px;width:44px;height:44px;border-radius:50%;background:var(--mist);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
              <span style="font-family:var(--serif);font-size:14px;color:var(--steel);">${esc(m.name).split(' ').map(w=>w[0]).join('').slice(0,2)}</span>
              ${m.photo_url ? `<img src="${esc(staffPhotoSrc(m.photo_url))}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${esc(isSafeObjectPosition(m.photo_position) ? m.photo_position : '50% 50%')};transform:scale(${safeZoomFactor(m.photo_zoom)});" onerror="this.style.display='none'">` : ''}
            </div>
            <div style="flex:1;">
              <div class="ni-title">${esc(m.name)}</div>
              <div class="ni-meta">${esc(m.title || '')}${m.email ? ' · ' + esc(m.email) : ''}</div>
            </div>
            <div class="ni-actions">
              <a href="/staff/edit/${m.id}" class="btn btn-sm btn-secondary">Edit</a>
              <form method="POST" action="/staff/delete/${m.id}" onsubmit="return confirm('Remove ${esc(m.name)} from staff?')" style="margin:0;">
                <button type="submit" class="btn btn-sm btn-danger">Remove</button>
              </form>
            </div>
          </div>`).join('');
        return html(`
${sidebarShell('staff', currentUser)}
<div class="wrap">
  <div class="page-title">Staff &amp; Leadership</div>
  <div class="page-sub">Manage the staff cards shown on the About page. Use the ▲/▼ buttons to reorder.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/staff/new" class="btn btn-primary">+ Add staff member</a>
  </div>
  <div class="card" style="padding:0;overflow:hidden;">
    ${members.results.length === 0 ? '<div style="padding:40px;text-align:center;color:var(--gray);">No staff members yet.</div>' : rows}
  </div>
</div>
<script>
function staffMove(id, direction) {
  var f = document.createElement('form');
  f.method = 'POST';
  f.action = '/staff/move/' + id;
  var i = document.createElement('input');
  i.type = 'hidden'; i.name = 'direction'; i.value = direction;
  f.appendChild(i);
  document.body.appendChild(f);
  f.submit();
}
</script>`, 'Staff');
      }

      // New staff form
      if (path === '/staff/new' && method === 'GET') {
        const nextOrder = 10;
        return html(`
${sidebarShell('staff', currentUser, `<a href="/staff">← All staff</a>`)}
<div class="wrap">
  <div class="page-title">Add Staff Member</div>
  <div class="card">
    <form method="POST" action="/staff/create">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group"><label>Name <span style="color:#B85C3A;">*</span></label><input type="text" name="name" required></div>
        <div class="form-group"><label>Title / Role <span style="color:#B85C3A;">*</span></label><input type="text" name="title" required placeholder="e.g. Lead Pastor"></div>
        <div class="form-group"><label>Email</label><input type="email" name="email" placeholder="name@timothystl.org"></div>
        ${staffPhotoFieldHtml('')}
      </div>
      <div class="form-group"><label>Bio <span style="font-size:11px;color:var(--gray);">(optional)</span></label><textarea name="bio" rows="6" placeholder="Short biography..." style="width:100%;font-family:var(--sans);font-size:14px;padding:10px;border:1px solid var(--border);border-radius:var(--r-sm);resize:vertical;"></textarea></div>
      <div class="btn-row" style="margin-top:16px;">
        <button type="submit" class="btn btn-primary">Save →</button>
        <a href="/staff" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>
${staffPhotoUploadScript()}`, 'New Staff Member');
      }

      // Create staff member
      if (path === '/staff/create' && method === 'POST') {
        const form = await request.formData();
        const name = form.get('name') || '';
        if (!name.trim()) return new Response('', { status: 302, headers: { Location: '/staff' } });
        // New members always go to the end of the list — ordering from here
        // on is done with the Move up/down buttons on the staff list, not by
        // hand-picking a number.
        const maxOrder = await env.DB.prepare('SELECT MAX(display_order) as n FROM staff_members').first();
        const nextOrder = (maxOrder && maxOrder.n != null ? maxOrder.n : 0) + 10;
        const photoPosition = isSafeObjectPosition(form.get('photo_position')) ? form.get('photo_position') : '50% 50%';
        const photoZoom = safeZoomFactor(form.get('photo_zoom'));
        await env.DB.prepare(
          'INSERT INTO staff_members (name, title, email, photo_url, photo_position, photo_zoom, bio, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(name, form.get('title')||'', form.get('email')||'', form.get('photo_url')||'', photoPosition, photoZoom, form.get('bio')||'', nextOrder).run();
        return new Response('', { status: 302, headers: { Location: '/staff?msg=saved' } });
      }

      // Edit staff form
      if (path.match(/^\/staff\/edit\/\d+$/) && method === 'GET') {
        const id = path.split('/').pop();
        const m = await env.DB.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first();
        if (!m) return new Response('Not found', { status: 404 });
        return html(`
${sidebarShell('staff', currentUser, `<a href="/staff">← All staff</a>`)}
<div class="wrap">
  <div class="page-title">Edit — ${esc(m.name)}</div>
  <div class="card">
    <form method="POST" action="/staff/update/${m.id}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group"><label>Name <span style="color:#B85C3A;">*</span></label><input type="text" name="name" value="${esc(m.name)}" required></div>
        <div class="form-group"><label>Title / Role</label><input type="text" name="title" value="${esc(m.title||'')}"></div>
        <div class="form-group"><label>Email</label><input type="email" name="email" value="${esc(m.email||'')}"></div>
        ${staffPhotoFieldHtml(m.photo_url||'', m.photo_position||'50% 50%', m.photo_zoom||1)}
      </div>
      <div class="form-group"><label>Bio</label><textarea name="bio" rows="8" style="width:100%;font-family:var(--sans);font-size:14px;padding:10px;border:1px solid var(--border);border-radius:var(--r-sm);resize:vertical;">${esc(m.bio||'')}</textarea></div>
      <div class="btn-row" style="margin-top:16px;">
        <button type="submit" class="btn btn-primary">Save →</button>
        <a href="/staff" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>
${staffPhotoUploadScript()}`, `Edit — ${m.name}`);
      }

      // Update staff member
      if (path.match(/^\/staff\/update\/\d+$/) && method === 'POST') {
        const id = path.split('/').pop();
        const form = await request.formData();
        const photoPosition = isSafeObjectPosition(form.get('photo_position')) ? form.get('photo_position') : '50% 50%';
        const photoZoom = safeZoomFactor(form.get('photo_zoom'));
        await env.DB.prepare(
          'UPDATE staff_members SET name=?, title=?, email=?, photo_url=?, photo_position=?, photo_zoom=?, bio=? WHERE id=?'
        ).bind(form.get('name')||'', form.get('title')||'', form.get('email')||'', form.get('photo_url')||'', photoPosition, photoZoom, form.get('bio')||'', id).run();
        return new Response('', { status: 302, headers: { Location: '/staff?msg=saved' } });
      }

      // Delete staff member
      if (path.match(/^\/staff\/delete\/\d+$/) && method === 'POST') {
        const id = path.split('/').pop();
        await env.DB.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
        return new Response('', { status: 302, headers: { Location: '/staff?msg=deleted' } });
      }

      // Move staff member up/down in the list. Swaps position in the ordered
      // array, then renumbers everyone 10/20/30/... from scratch — rather
      // than swapping raw display_order values — so a pre-existing tie
      // (e.g. two members both left at the old form's "80" default) can't
      // make the buttons a silent no-op; every click produces a fresh,
      // unique ordering.
      if (path.match(/^\/staff\/move\/\d+$/) && method === 'POST') {
        const id = parseInt(path.split('/').pop());
        const form = await request.formData();
        const direction = form.get('direction');
        const all = (await env.DB.prepare('SELECT id FROM staff_members ORDER BY display_order, id').all()).results;
        const idx = all.findIndex(m => m.id === id);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx !== -1 && swapIdx >= 0 && swapIdx < all.length) {
          const reordered = all.slice();
          [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
          await env.DB.batch(reordered.map((m, i) =>
            env.DB.prepare('UPDATE staff_members SET display_order=? WHERE id=?').bind((i + 1) * 10, m.id)
          ));
        }
        return new Response('', { status: 302, headers: { Location: '/staff' } });
      }
    } // end staff tab

    // ── LINK CARDS TAB ─────────────────────────────────────────
    if (path.startsWith('/link-cards') && !hasPermission(currentUser, 'links_edit')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path.startsWith('/link-cards')) {
      const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const COLOR_OPTIONS = ['amber','sage','sky','mist'];
      const COLOR_LABELS = { amber: 'Amber (gold)', sage: 'Sage (green)', sky: 'Sky (blue)', mist: 'Mist (light blue)' };

      // List
      if (path === '/link-cards' && method === 'GET') {
        const msg = url.searchParams.get('msg');
        let alertHtml = '';
        if (msg === 'saved')   alertHtml = `<div class="alert alert-success">✓ Card saved.</div>`;
        if (msg === 'deleted') alertHtml = `<div class="alert alert-info">Card deleted.</div>`;
        const rows = await env.DB.prepare('SELECT * FROM link_cards ORDER BY sort_order, id').all();
        const cards = rows.results || [];
        const tableRows = cards.map(c => `
          <div class="ni-row">
            <div style="font-size:22px;min-width:36px;text-align:center;">${esc(c.icon_emoji||'🔗')}</div>
            <div class="ni-title">${esc(c.title)}${c.description ? `<div style="font-size:12px;color:var(--gray);margin-top:2px;">${esc(c.description)}</div>` : ''}</div>
            <div style="font-size:12px;color:var(--gray);font-family:var(--sans);flex:1;word-break:break-all;">${esc(c.url)}</div>
            <div style="font-family:var(--sans);font-size:12px;color:var(--gray);min-width:50px;">#${c.sort_order}</div>
            <form method="POST" action="/link-cards/toggle/${c.id}" style="margin:0;">
              <button class="btn btn-sm ${c.active ? 'btn-sage' : 'btn-secondary'}" type="submit">${c.active ? 'Active' : 'Hidden'}</button>
            </form>
            <div style="display:flex;gap:8px;">
              <a href="/link-cards/edit/${c.id}" class="btn btn-sm btn-primary">Edit</a>
              <form method="POST" action="/link-cards/delete/${c.id}" onsubmit="return confirm('Delete this card?')" style="margin:0;">
                <button class="btn btn-sm btn-danger" type="submit">Delete</button>
              </form>
            </div>
          </div>`).join('');
        return html(sidebarShell('link-cards', currentUser) + `
          <div class="wrap">
            <div class="page-title">Link Tree</div>
            <div class="page-sub">Cards shown on <a href="https://links.timothystl.org" target="_blank" style="color:var(--amber);">links.timothystl.org</a>. Set the Sort # to control order (lower = first).</div>
            ${alertHtml}
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <div class="card-title" style="margin:0;border:none;padding:0;">Cards (${cards.length})</div>
                <a href="/link-cards/new" class="btn btn-primary btn-sm">+ Add card</a>
              </div>
              ${cards.length ? tableRows : '<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No cards yet. <a href="/link-cards/new">Add one →</a></div>'}
            </div>
          </div>`, 'Link Tree — TLC Admin');
      }

      // Form helper (new & edit)
      const cardFormHtml = (c = {}) => {
        const isNew = !c.id;
        const action = isNew ? '/link-cards/create' : `/link-cards/update/${c.id}`;
        const colorOpts = COLOR_OPTIONS.map(v => `<option value="${v}" ${(c.icon_color||'sky')===v?'selected':''}>${COLOR_LABELS[v]}</option>`).join('');
        return `<form method="POST" action="${action}">
          <div class="card">
            <div class="card-title">${isNew ? 'New Card' : 'Edit Card'}</div>
            <div class="form-group">
              <label>Title <span style="color:#B85C3A;">*</span></label>
              <input type="text" name="title" value="${esc(c.title||'')}" required placeholder="e.g. Get Connected">
            </div>
            <div class="form-group">
              <label>Description <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
              <input type="text" name="description" value="${esc(c.description||'')}" placeholder="One-line tagline shown under the title">
            </div>
            <div class="form-group">
              <label>URL <span style="color:#B85C3A;">*</span></label>
              <input type="url" name="url" value="${esc(c.url||'')}" required placeholder="https://...">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
              <div class="form-group" style="margin:0;">
                <label>Icon emoji</label>
                <input type="text" name="icon_emoji" value="${esc(c.icon_emoji||'🔗')}" placeholder="🔗" maxlength="4" style="font-size:22px;">
              </div>
              <div class="form-group" style="margin:0;">
                <label>Icon color</label>
                <select name="icon_color">${colorOpts}</select>
              </div>
              <div class="form-group" style="margin:0;">
                <label>Sort order</label>
                <input type="number" name="sort_order" value="${c.sort_order||0}" min="0" step="1">
              </div>
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit">${isNew ? 'Add card' : 'Save changes'}</button>
            <a href="/link-cards" class="btn btn-secondary">Cancel</a>
          </div>
        </form>`;
      };

      // New form
      if (path === '/link-cards/new' && method === 'GET') {
        return html(sidebarShell('link-cards', currentUser) + `<div class="wrap">${cardFormHtml()}</div>`, 'New Card — TLC Admin');
      }

      // Create
      if (path === '/link-cards/create' && method === 'POST') {
        const fd = await request.formData();
        const title = (fd.get('title')||'').trim();
        const cardUrl = (fd.get('url')||'').trim();
        if (!title || !isSafeCardUrl(cardUrl)) return new Response('', { status: 302, headers: { Location: '/link-cards/new' } });
        await env.DB.prepare('INSERT INTO link_cards (title, description, url, icon_emoji, icon_color, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)')
          .bind(title, (fd.get('description')||'').trim(), cardUrl, (fd.get('icon_emoji')||'🔗').trim(), (fd.get('icon_color')||'sky'), parseInt(fd.get('sort_order')||'0',10)).run();
        return new Response('', { status: 302, headers: { Location: '/link-cards?msg=saved' } });
      }

      // Edit form
      const editMatch = path.match(/^\/link-cards\/edit\/(\d+)$/);
      if (editMatch && method === 'GET') {
        const c = await env.DB.prepare('SELECT * FROM link_cards WHERE id = ?').bind(parseInt(editMatch[1],10)).first();
        if (!c) return new Response('Not found', { status: 404 });
        return html(sidebarShell('link-cards', currentUser) + `<div class="wrap">${cardFormHtml(c)}</div>`, 'Edit Card — TLC Admin');
      }

      // Update
      const updateMatch = path.match(/^\/link-cards\/update\/(\d+)$/);
      if (updateMatch && method === 'POST') {
        const fd = await request.formData();
        const title = (fd.get('title')||'').trim();
        const cardUrl = (fd.get('url')||'').trim();
        if (!title || !isSafeCardUrl(cardUrl)) return new Response('', { status: 302, headers: { Location: `/link-cards/edit/${updateMatch[1]}` } });
        await env.DB.prepare('UPDATE link_cards SET title=?, description=?, url=?, icon_emoji=?, icon_color=?, sort_order=? WHERE id=?')
          .bind(title, (fd.get('description')||'').trim(), cardUrl, (fd.get('icon_emoji')||'🔗').trim(), (fd.get('icon_color')||'sky'), parseInt(fd.get('sort_order')||'0',10), parseInt(updateMatch[1],10)).run();
        return new Response('', { status: 302, headers: { Location: '/link-cards?msg=saved' } });
      }

      // Toggle active
      const toggleMatch = path.match(/^\/link-cards\/toggle\/(\d+)$/);
      if (toggleMatch && method === 'POST') {
        await env.DB.prepare('UPDATE link_cards SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(parseInt(toggleMatch[1],10)).run();
        return new Response('', { status: 302, headers: { Location: '/link-cards' } });
      }

      // Delete
      const deleteMatch = path.match(/^\/link-cards\/delete\/(\d+)$/);
      if (deleteMatch && method === 'POST') {
        await env.DB.prepare('DELETE FROM link_cards WHERE id = ?').bind(parseInt(deleteMatch[1],10)).run();
        return new Response('', { status: 302, headers: { Location: '/link-cards?msg=deleted' } });
      }
    } // end link-cards tab

    // ── REDIRECTS TAB ────────────────────────────────────────────

    // ── CUSTOM REDIRECTS (add/edit/delete, inside Redirects page) ──
    // Shared with the Giving tab's vendor/market links (category='giving' rows in the same
    // table) — gate the outer path first with an OR of both permissions (we don't know the
    // category yet), then check the *specific* required permission per-category below.
    if ((path === '/redirects/add' || path === '/redirects/update' || path.startsWith('/redirects/delete/'))
        && !hasPermission(currentUser, 'settings_manage') && !hasPermission(currentUser, 'giving_manage')) {
      return new Response('Access denied.', { status: 403 });
    }
    if ((path === '/settings' || path === '/settings/update') && !hasPermission(currentUser, 'settings_manage')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path === '/redirects/add' && method === 'POST') {
      const form = await request.formData();
      const rPath = (form.get('path') || '').trim().replace(/^\/+/, '').toLowerCase();
      const rUrl  = (form.get('url')  || '').trim();
      const rLabel= (form.get('label')|| '').trim();
      const rCategory = (form.get('category') || 'general').trim() === 'giving' ? 'giving' : 'general';
      const rActive = form.get('active') !== null ? 1 : 0;
      const redirectBackTo = rCategory === 'giving' ? '/giving' : '/settings';
      if (!hasPermission(currentUser, rCategory === 'giving' ? 'giving_manage' : 'settings_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      if (!rPath || !rUrl) return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-error' } });
      let parsedProtocol = '';
      try { parsedProtocol = new URL(rUrl).protocol; } catch (_) {}
      if (parsedProtocol !== 'http:' && parsedProtocol !== 'https:') {
        return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-error' } });
      }
      await env.DB.prepare('INSERT OR REPLACE INTO redirects (path, url, label, category, active) VALUES (?, ?, ?, ?, ?)').bind(rPath, rUrl, rLabel, rCategory, rActive).run();
      return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-added' } });
    }
    if (path === '/redirects/update' && method === 'POST') {
      const form = await request.formData();
      const originalPath = (form.get('original_path') || '').trim().replace(/^\/+/, '').toLowerCase();
      const rPath = (form.get('path') || '').trim().replace(/^\/+/, '').toLowerCase();
      const rUrl  = (form.get('url')  || '').trim();
      const rLabel= (form.get('label')|| '').trim();
      const rCategory = (form.get('category') || 'general').trim() === 'giving' ? 'giving' : 'general';
      const rActive = form.get('active') !== null ? 1 : 0;
      const redirectBackTo = rCategory === 'giving' ? '/giving' : '/settings';
      if (!hasPermission(currentUser, rCategory === 'giving' ? 'giving_manage' : 'settings_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      if (!rPath || !rUrl) return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-error' } });
      let parsedProtocol = '';
      try { parsedProtocol = new URL(rUrl).protocol; } catch (_) {}
      if (parsedProtocol !== 'http:' && parsedProtocol !== 'https:') {
        return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-error' } });
      }
      if (rPath !== originalPath) {
        await env.DB.prepare('DELETE FROM redirects WHERE path = ?').bind(originalPath).run();
      }
      await env.DB.prepare('INSERT OR REPLACE INTO redirects (path, url, label, category, active) VALUES (?, ?, ?, ?, ?)').bind(rPath, rUrl, rLabel, rCategory, rActive).run();
      return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-updated' } });
    }
    if (path.startsWith('/redirects/delete/') && method === 'POST') {
      const rPath = path.slice('/redirects/delete/'.length);
      const existing = await env.DB.prepare('SELECT category FROM redirects WHERE path = ?').bind(rPath).first();
      const existingCategory = existing?.category === 'giving' ? 'giving' : 'general';
      const redirectBackTo = existingCategory === 'giving' ? '/giving' : '/settings';
      if (!hasPermission(currentUser, existingCategory === 'giving' ? 'giving_manage' : 'settings_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      await env.DB.prepare('DELETE FROM redirects WHERE path = ?').bind(rPath).run();
      return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-deleted' } });
    }

    // ── SUBSCRIBERS ADMIN ──
    if ((path === '/subscribers' || path === '/subscribers/delete') && !hasPermission(currentUser, 'settings_manage')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path === '/subscribers' && method === 'GET') {
      // Fetch Brevo contacts from the newsletter list
      let brevoContacts = [];
      let brevoTotal = null;
      let brevoError = null;
      const listId = env.BREVO_LIST_ID;
      if (!env.BREVO_API_KEY) {
        brevoError = 'BREVO_API_KEY secret not configured.';
      } else if (!listId) {
        brevoError = 'BREVO_LIST_ID secret not configured.';
      } else {
        try {
          let offset = 0;
          const limit = 500;
          while (true) {
            const resp = await fetch(`https://api.brevo.com/v3/contacts/lists/${listId}/contacts?limit=${limit}&offset=${offset}`, {
              headers: { 'api-key': env.BREVO_API_KEY, 'Accept': 'application/json' }
            });
            if (!resp.ok) { brevoError = `Brevo API error: ${resp.status}`; break; }
            const data = await resp.json();
            brevoContacts = brevoContacts.concat(data.contacts || []);
            brevoTotal = data.count;
            if (brevoContacts.length >= data.count) break;
            offset += limit;
          }
        } catch (e) {
          brevoError = `Failed to fetch from Brevo: ${e.message}`;
        }
      }

      // Local website signups
      const localTotal = await env.DB.prepare('SELECT COUNT(*) as cnt FROM newsletter_subscribers').first();
      const localRecent = await env.DB.prepare('SELECT email, name, subscribed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC LIMIT 50').all();

      const brevoRowsHtml = brevoError
        ? `<div style="padding:16px;color:#B85C3A;font-size:14px;">⚠ ${brevoError} <a href="https://app.brevo.com" target="_blank" style="color:var(--steel);">Open Brevo ↗</a></div>`
        : brevoContacts.length === 0
          ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No contacts found in this Brevo list.</div>`
          : brevoContacts.map(c => {
              const name = [c.attributes?.FIRSTNAME, c.attributes?.LASTNAME].filter(Boolean).join(' ');
              return `
<div style="display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
  <div style="flex:1;min-width:200px;">
    <div style="font-size:14px;color:var(--charcoal);">${c.email}</div>
    ${name ? `<div style="font-size:12px;color:var(--gray);">${name}</div>` : ''}
  </div>
  <div style="font-size:11px;padding:2px 8px;border-radius:20px;background:${c.emailBlacklisted ? '#f5e6e6' : '#e6f5ea'};color:${c.emailBlacklisted ? '#B85C3A' : '#2E7A4A'};flex-shrink:0;">${c.emailBlacklisted ? 'unsubscribed' : 'active'}</div>
</div>`;
            }).join('');

      const localRowsHtml = localRecent.results.length === 0
        ? `<div style="text-align:center;padding:24px;color:var(--gray);font-size:14px;">No website signups yet.</div>`
        : localRecent.results.map(s => `
<div style="display:flex;align-items:center;gap:16px;padding:10px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
  <div style="flex:1;min-width:200px;">
    <div style="font-size:14px;color:var(--charcoal);">${s.email}</div>
    ${s.name ? `<div style="font-size:12px;color:var(--gray);">${s.name}</div>` : ''}
  </div>
  <div style="font-size:12px;color:var(--gray);flex-shrink:0;">${s.subscribed_at ? s.subscribed_at.slice(0,10) : ''}</div>
</div>`).join('');

      return html(`
${sidebarShell('subscribers', currentUser)}
<div class="wrap">
  <div class="page-title">Newsletter Subscribers</div>
  <div class="page-sub">All subscribers from your Brevo list. Manage full list at <a href="https://app.brevo.com" target="_blank" style="color:var(--steel);">app.brevo.com ↗</a></div>
  <div class="card" style="margin-bottom:20px;display:flex;gap:32px;flex-wrap:wrap;">
    <div>
      <div style="font-family:var(--serif);font-size:36px;color:var(--steel);font-weight:700;">${brevoTotal !== null ? brevoTotal : '—'}</div>
      <div style="font-size:13px;color:var(--gray);margin-top:4px;">Total in Brevo list</div>
    </div>
    <div>
      <div style="font-family:var(--serif);font-size:36px;color:var(--steel);font-weight:700;">${localTotal ? localTotal.cnt : 0}</div>
      <div style="font-size:13px;color:var(--gray);margin-top:4px;">Signed up via website</div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">All Brevo subscribers</div>
    ${brevoRowsHtml}
  </div>
  <div class="card">
    <div class="card-title">Website signups (recent 50)</div>
    <div style="font-size:12px;color:var(--gray);margin-bottom:12px;">These are automatically added to Brevo when they sign up.</div>
    ${localRowsHtml}
  </div>
</div>`, 'Subscribers');
    }

    if (path.startsWith('/settings')) {
      // Show settings form
      if (path === '/settings' && method === 'GET') {
        const REDIRECT_KEYS = ['zoom_url', 'councilfiles_url'];
        const settings = await env.DB.prepare(`SELECT key, value, label, hint FROM site_settings WHERE key IN (${REDIRECT_KEYS.map(() => '?').join(',')}) ORDER BY rowid`).bind(...REDIRECT_KEYS).all();
        const customRedirects = await env.DB.prepare("SELECT path, url, label, category, active FROM redirects WHERE category != 'giving' ORDER BY path").all();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Settings saved.</div>`
          : msg === 'redirect-added'   ? `<div class="alert alert-success">✓ Redirect added.</div>`
          : msg === 'redirect-updated' ? `<div class="alert alert-success">✓ Redirect updated.</div>`
          : msg === 'redirect-deleted' ? `<div class="alert alert-info">Redirect deleted.</div>`
          : msg === 'redirect-error'   ? `<div class="alert alert-error">Path and URL are both required.</div>` : '';

        const renderField = s => `
          <div class="form-group" style="border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:20px;">
            <label>${(s.label||s.key).replace(/&/g,'&amp;')}</label>
            ${s.hint ? `<div style="font-size:12px;color:var(--gray);margin-bottom:8px;">${s.hint.replace(/&/g,'&amp;')}</div>` : ''}
            <input type="text" name="${s.key.replace(/"/g,'&quot;')}" value="${(s.value||'').replace(/"/g,'&quot;').replace(/&/g,'&amp;')}" style="font-family:var(--mono,monospace);font-size:13px;">
          </div>`;
        const redirectFields = settings.results.map(renderField).join('');

        // Hidden category=general + active=1 preserve existing behavior exactly — this
        // section never had an active toggle before and shouldn't get one now.
        const customRowsHtml = customRedirects.results.length === 0
          ? `<div style="font-size:13px;color:var(--gray);padding:12px 0;">No custom redirects yet.</div>`
          : customRedirects.results.map(r => `
            <form method="POST" action="/redirects/update" style="display:grid;grid-template-columns:1fr 2fr 1fr auto auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
              <input type="hidden" name="original_path" value="${r.path.replace(/"/g,'&quot;')}">
              <input type="hidden" name="category" value="general">
              <input type="hidden" name="active" value="1">
              <input type="text" name="path" value="${r.path.replace(/"/g,'&quot;')}" style="font-family:var(--mono,monospace);font-size:13px;">
              <input type="url" name="url" value="${(r.url||'').replace(/"/g,'&quot;')}" style="font-size:13px;">
              <input type="text" name="label" value="${(r.label||'').replace(/"/g,'&quot;')}" placeholder="Label" style="font-size:13px;">
              <button type="submit" class="btn btn-sm btn-secondary">Save</button>
              <button type="submit" formaction="/redirects/delete/${encodeURIComponent(r.path)}" formnovalidate class="btn btn-sm btn-danger" onclick="return confirm('Delete /${r.path.replace(/'/g,"\\'")}?')">Delete</button>
            </form>`).join('');

        return html(`
${sidebarShell('settings', currentUser)}
<div class="wrap">
  <div class="page-title">Redirects</div>
  <div class="page-sub">Manage short links and redirect URLs used across the site. Changes take effect immediately.</div>
  ${alertHtml}
  <form method="POST" action="/settings/update">
    <div class="card">
      <div class="card-title">Built-in Redirects</div>
      <div style="font-size:13px;color:var(--gray);margin-bottom:18px;">These are the URLs that short links on the site point to (<code>/zoom</code>, <code>/councilfiles</code>). Edit here — no code change required. (The <code>/give</code> link and giving page now live under the <a href="/giving" style="color:var(--steel);">Giving</a> tab.)</div>
      ${redirectFields}
      <div class="btn-row" style="margin-top:4px;">
        <button type="submit" class="btn btn-primary">Save redirect URLs →</button>
      </div>
    </div>
  </form>

  <div class="card" style="margin-top:20px;">
    <div class="card-title">Custom Redirects</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">Add short links that redirect visitors to any URL. Example: <code>/mdo</code> → <code>https://mdo.timothystl.org</code>. Works when someone types the URL directly in the browser. Edit the fields below and click Save, or Delete to remove.</div>
    ${customRowsHtml}
    <form method="POST" action="/redirects/add" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sage);margin-bottom:12px;">Add new redirect</div>
      <div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:12px;align-items:end;">
        <div class="form-group" style="margin:0;">
          <label>Path (no slash)</label>
          <input type="text" name="path" placeholder="e.g. mdo" style="font-family:var(--mono,monospace);">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Destination URL</label>
          <input type="url" name="url" placeholder="https://...">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Label (optional)</label>
          <input type="text" name="label" placeholder="e.g. Mother's Day Out">
        </div>
      </div>
      <div class="btn-row" style="margin-top:12px;">
        <button type="submit" class="btn btn-primary">Add redirect →</button>
      </div>
    </form>
  </div>
</div>`, 'Redirects');
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
    } // end redirects tab

    // ── GIVING TAB ───────────────────────────────────────────────
    // Consolidates: the base Tithe.ly link (give_url, moved out of Redirects), the
    // give.timothystl.org amount tiers, and the vendor/market one-off links (relocated
    // from Redirects' old "Giving Links" card — same underlying redirects table,
    // category='giving'). Dedicated giving_manage permission, separate from
    // settings_manage, per Andrew's 2026-07-27 decision.
    if (path.startsWith('/giving') && !hasPermission(currentUser, 'giving_manage')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path.startsWith('/giving-tiers/') && !hasPermission(currentUser, 'giving_manage')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path.startsWith('/giving-funds/') && !hasPermission(currentUser, 'giving_manage')) {
      return new Response('Access denied.', { status: 403 });
    }

    if (path === '/giving/base-url' && method === 'POST') {
      const form = await request.formData();
      const val = (form.get('give_url') || '').trim();
      let parsedProtocol = '';
      try { parsedProtocol = new URL(val).protocol; } catch (_) {}
      if (parsedProtocol !== 'http:' && parsedProtocol !== 'https:') {
        return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-error' } });
      }
      await env.DB.prepare("UPDATE site_settings SET value = ? WHERE key = 'give_url'").bind(val).run();
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-saved' } });
    }

    if (path === '/giving-tiers/add' && method === 'POST') {
      const form = await request.formData();
      const amount = parseInt(form.get('amount'), 10);
      const tierUrl = (form.get('url') || '').trim();
      const isDefault = form.get('is_default') !== null ? 1 : 0;
      const active = form.get('active') !== null ? 1 : 0;
      if (!amount || amount < 1) return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-error' } });
      if (tierUrl) {
        let proto = '';
        try { proto = new URL(tierUrl).protocol; } catch (_) {}
        if (proto !== 'http:' && proto !== 'https:') return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-error' } });
      }
      if (isDefault) await env.DB.prepare('UPDATE give_amount_tiers SET is_default = 0').run();
      const maxSort = await env.DB.prepare('SELECT MAX(sort_order) as m FROM give_amount_tiers').first();
      const sortOrder = (maxSort?.m ?? -1) + 1;
      await env.DB.prepare('INSERT INTO give_amount_tiers (amount, url, is_default, active, sort_order) VALUES (?, ?, ?, ?, ?)')
        .bind(amount, tierUrl, isDefault, active, sortOrder).run();
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-added' } });
    }
    if (path === '/giving-tiers/update' && method === 'POST') {
      const form = await request.formData();
      const id = parseInt(form.get('id'), 10);
      const amount = parseInt(form.get('amount'), 10);
      const tierUrl = (form.get('url') || '').trim();
      const isDefault = form.get('is_default') !== null ? 1 : 0;
      const active = form.get('active') !== null ? 1 : 0;
      if (!id || !amount || amount < 1) return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-error' } });
      if (tierUrl) {
        let proto = '';
        try { proto = new URL(tierUrl).protocol; } catch (_) {}
        if (proto !== 'http:' && proto !== 'https:') return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-error' } });
      }
      if (isDefault) await env.DB.prepare('UPDATE give_amount_tiers SET is_default = 0 WHERE id != ?').bind(id).run();
      await env.DB.prepare('UPDATE give_amount_tiers SET amount = ?, url = ?, is_default = ?, active = ? WHERE id = ?')
        .bind(amount, tierUrl, isDefault, active, id).run();
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-updated' } });
    }
    if (path.startsWith('/giving-tiers/delete/') && method === 'POST') {
      const id = parseInt(path.slice('/giving-tiers/delete/'.length), 10);
      await env.DB.prepare('DELETE FROM give_amount_tiers WHERE id = ?').bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-deleted' } });
    }

    if (path === '/giving-funds/add' && method === 'POST') {
      const form = await request.formData();
      const name = (form.get('name') || '').trim();
      const tithelyFundId = (form.get('tithely_fund_id') || '').trim();
      const isDefault = form.get('is_default') !== null ? 1 : 0;
      const active = form.get('active') !== null ? 1 : 0;
      if (!name) return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-error' } });
      if (isDefault) await env.DB.prepare('UPDATE give_funds SET is_default = 0').run();
      const maxSort = await env.DB.prepare('SELECT MAX(sort_order) as m FROM give_funds').first();
      const sortOrder = (maxSort?.m ?? -1) + 1;
      await env.DB.prepare('INSERT INTO give_funds (name, tithely_fund_id, is_default, active, sort_order) VALUES (?, ?, ?, ?, ?)')
        .bind(name, tithelyFundId, isDefault, active, sortOrder).run();
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-added' } });
    }
    if (path === '/giving-funds/update' && method === 'POST') {
      const form = await request.formData();
      const id = parseInt(form.get('id'), 10);
      const name = (form.get('name') || '').trim();
      const tithelyFundId = (form.get('tithely_fund_id') || '').trim();
      const isDefault = form.get('is_default') !== null ? 1 : 0;
      const active = form.get('active') !== null ? 1 : 0;
      if (!id || !name) return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-error' } });
      if (isDefault) await env.DB.prepare('UPDATE give_funds SET is_default = 0 WHERE id != ?').bind(id).run();
      await env.DB.prepare('UPDATE give_funds SET name = ?, tithely_fund_id = ?, is_default = ?, active = ? WHERE id = ?')
        .bind(name, tithelyFundId, isDefault, active, id).run();
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-updated' } });
    }
    if (path.startsWith('/giving-funds/delete/') && method === 'POST') {
      const id = parseInt(path.slice('/giving-funds/delete/'.length), 10);
      await env.DB.prepare('DELETE FROM give_funds WHERE id = ?').bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-deleted' } });
    }

    if (path === '/giving' && method === 'GET') {
      const baseUrlRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'give_url'").first();
      const tiers = await env.DB.prepare('SELECT * FROM give_amount_tiers ORDER BY sort_order').all();
      const funds = await env.DB.prepare('SELECT * FROM give_funds ORDER BY sort_order').all();
      const givingLinks = await env.DB.prepare("SELECT path, url, label, category, active FROM redirects WHERE category = 'giving' ORDER BY path").all();
      const chmsFunds = await getChmsFundSuggestions(env);
      const existingFundNames = new Set(funds.results.map(f => (f.name || '').trim().toLowerCase()));
      const chmsSuggestionsHtml = chmsFunds.length === 0 ? '' : `
        <div style="font-size:12px;color:var(--gray);margin:14px 0 6px;">
          Real fund names from ChMS — click one to use it below:
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          ${chmsFunds.map(f => `<button type="button" class="btn btn-sm" style="background:var(--mist);color:var(--steel);${existingFundNames.has((f.name||'').trim().toLowerCase()) ? 'opacity:.45;' : ''}" data-fund-name="${escapeHtml(f.name || '')}" onclick="document.querySelector('form[action=\\'/giving-funds/add\\'] input[name=name]').value=this.dataset.fundName">${escapeHtml(f.name || '')}</button>`).join('')}
        </div>`;
      const msg = url.searchParams.get('msg');
      const alertHtml = msg === 'giving-saved'   ? `<div class="alert alert-success">✓ Saved.</div>`
        : msg === 'giving-added'   ? `<div class="alert alert-success">✓ Added.</div>`
        : msg === 'giving-updated' ? `<div class="alert alert-success">✓ Updated.</div>`
        : msg === 'giving-deleted' ? `<div class="alert alert-info">Deleted.</div>`
        : msg === 'redirect-added'   ? `<div class="alert alert-success">✓ Link added.</div>`
        : msg === 'redirect-updated' ? `<div class="alert alert-success">✓ Link updated.</div>`
        : msg === 'redirect-deleted' ? `<div class="alert alert-info">Link deleted.</div>`
        : msg === 'giving-error' || msg === 'redirect-error' ? `<div class="alert alert-error">Check the fields — a valid amount and any URLs entered must be http(s) links.</div>` : '';

      const tierRowsHtml = tiers.results.length === 0
        ? `<div style="font-size:13px;color:var(--gray);padding:12px 0;">No amount tiers yet — the give.timothystl.org page falls back to the base Tithe.ly link below for every amount.</div>`
        : tiers.results.map(t => `
          <form method="POST" action="/giving-tiers/update" style="display:grid;grid-template-columns:.7fr 2.4fr auto auto auto auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
            <input type="hidden" name="id" value="${t.id}">
            <div style="display:flex;align-items:center;gap:4px;">
              <span style="font-family:var(--mono,monospace);font-size:13px;color:var(--gray);">$</span>
              <input type="number" name="amount" min="1" value="${t.amount}" style="font-family:var(--mono,monospace);font-size:13px;">
            </div>
            <input type="url" name="url" value="${(t.url||'').replace(/"/g,'&quot;')}" placeholder="Override link (blank = auto-built from base link)" style="font-size:12px;">
            <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);white-space:nowrap;">
              <input type="checkbox" name="is_default" value="1" ${t.is_default ? 'checked' : ''}> Default
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);white-space:nowrap;">
              <input type="checkbox" name="active" value="1" ${t.active ? 'checked' : ''}> Active
            </label>
            <button type="submit" class="btn btn-sm btn-secondary">Save</button>
            <button type="submit" formaction="/giving-tiers/delete/${t.id}" formnovalidate class="btn btn-sm btn-danger" onclick="return confirm('Delete the \\$${t.amount} tier?')">Delete</button>
          </form>`).join('');

      const fundRowsHtml = funds.results.length === 0
        ? `<div style="font-size:13px;color:var(--gray);padding:12px 0;">No funds yet — the give.timothystl.org page has no fund selector until at least one fund exists.</div>`
        : funds.results.map(f => `
          <form method="POST" action="/giving-funds/update" style="display:grid;grid-template-columns:1.4fr 1.6fr auto auto auto auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
            <input type="hidden" name="id" value="${f.id}">
            <input type="text" name="name" value="${(f.name||'').replace(/"/g,'&quot;')}" style="font-size:13px;">
            <input type="text" name="tithely_fund_id" value="${(f.tithely_fund_id||'').replace(/"/g,'&quot;')}" placeholder="Tithe.ly fundId (blank = base link's own fund)" style="font-family:var(--mono,monospace);font-size:12px;">
            <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);white-space:nowrap;">
              <input type="checkbox" name="is_default" value="1" ${f.is_default ? 'checked' : ''}> Default
            </label>
            <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--gray);white-space:nowrap;">
              <input type="checkbox" name="active" value="1" ${f.active ? 'checked' : ''}> Active
            </label>
            <button type="submit" class="btn btn-sm btn-secondary">Save</button>
            <button type="submit" formaction="/giving-funds/delete/${f.id}" formnovalidate class="btn btn-sm btn-danger" onclick="return confirm('Delete the ${(f.name||'').replace(/'/g,"\\'")} fund?')">Delete</button>
          </form>`).join('');

      const givingRowsHtml = givingLinks.results.length === 0
        ? `<div style="font-size:13px;color:var(--gray);padding:12px 0;">No vendor/market links yet.</div>`
        : givingLinks.results.map(r => `
          <form method="POST" action="/redirects/update" style="display:grid;grid-template-columns:1fr 2fr 1.3fr auto auto auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
            <input type="hidden" name="original_path" value="${r.path.replace(/"/g,'&quot;')}">
            <input type="hidden" name="category" value="giving">
            <input type="text" name="path" value="${r.path.replace(/"/g,'&quot;')}" style="font-family:var(--mono,monospace);font-size:13px;">
            <input type="url" name="url" value="${(r.url||'').replace(/"/g,'&quot;')}" style="font-size:13px;">
            <input type="text" name="label" value="${(r.label||'').replace(/"/g,'&quot;')}" placeholder="e.g. Smith Catering — Fall Festival deposit" style="font-size:13px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray);white-space:nowrap;">
              <input type="checkbox" name="active" value="1" ${r.active ? 'checked' : ''}> Active
            </label>
            <button type="submit" class="btn btn-sm btn-secondary">Save</button>
            <button type="submit" formaction="/redirects/delete/${encodeURIComponent(r.path)}" formnovalidate class="btn btn-sm btn-danger" onclick="return confirm('Delete /${r.path.replace(/'/g,"\\'")}?')">Delete</button>
          </form>`).join('');

      return html(`
${sidebarShell('giving', currentUser)}
<div class="wrap">
  <div class="page-title">Giving</div>
  <div class="page-sub">The base Tithe.ly link, the amount tiers shown on give.timothystl.org, and one-off vendor/market payment links.</div>
  ${alertHtml}

  <form method="POST" action="/giving/base-url">
    <div class="card">
      <div class="card-title">Base Tithe.ly Link</div>
      <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">The give.timothystl.org page and the main site's /give page both build off this link — it should include <code>formId</code>, <code>locationId</code>, and <code>fundId</code> but <strong>not</strong> an <code>amount</code> (the page appends the right amount automatically, in cents, for whichever tier is selected — confirmed against a real Tithe.ly link: <code>...&amount=2500</code> for a $25 gift). Get this from a link Tithe.ly generates for General Fund giving, then strip off the trailing <code>&amp;amount=...</code> before pasting it here.</div>
      <div class="form-group">
        <label>Tithe.ly giving form URL (no amount param)</label>
        <input type="url" name="give_url" value="${(baseUrlRow?.value||'').replace(/"/g,'&quot;')}" style="font-family:var(--mono,monospace);font-size:13px;">
      </div>
      <div class="btn-row" style="margin-top:4px;">
        <button type="submit" class="btn btn-primary">Save →</button>
      </div>
    </div>
  </form>

  <div class="card" style="margin-top:20px;">
    <div class="card-title">Amount Tiers</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">The chip amounts shown on give.timothystl.org. Each one automatically gets a Tithe.ly link built from the Base Tithe.ly Link above with the right amount appended — <strong>you don't need to generate or paste a link per tier.</strong> The optional link field below is only for the rare case where a specific tier should go somewhere else entirely (a different fund, a different form) — leave it blank for the normal case.</div>
    ${tierRowsHtml}
    <form method="POST" action="/giving-tiers/add" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sage);margin-bottom:12px;">Add new tier</div>
      <div style="display:grid;grid-template-columns:.7fr 2.4fr auto auto;gap:12px;align-items:end;">
        <div class="form-group" style="margin:0;">
          <label>Amount ($)</label>
          <input type="number" name="amount" min="1" placeholder="e.g. 100" style="font-family:var(--mono,monospace);">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Override link (optional)</label>
          <input type="url" name="url" placeholder="Leave blank — usually not needed">
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--charcoal);white-space:nowrap;padding-bottom:10px;">
          <input type="checkbox" name="is_default"> Default
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--charcoal);white-space:nowrap;padding-bottom:10px;">
          <input type="checkbox" name="active" value="1" checked> Active
        </label>
      </div>
      <div class="btn-row" style="margin-top:12px;">
        <button type="submit" class="btn btn-primary">Add tier →</button>
      </div>
    </form>
  </div>

  <div class="card" style="margin-top:20px;">
    <div class="card-title">Funds</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">The fund selector shown on give.timothystl.org. Each fund needs its own Tithe.ly <code>fundId</code> — get this the same way as the base link (generate a link for that fund from Tithe.ly's dashboard and copy the <code>fundId</code> value out of the URL). Leave the fund ID blank for a fund that should use whichever fund is already in the Base Tithe.ly Link above (typically your "General Fund" row). Exactly one fund should be Default — that's what's selected when the page first loads.</div>
    ${fundRowsHtml}
    <form method="POST" action="/giving-funds/add" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sage);margin-bottom:12px;">Add new fund</div>
      ${chmsSuggestionsHtml}
      <div style="display:grid;grid-template-columns:1.4fr 1.6fr auto auto;gap:12px;align-items:end;">
        <div class="form-group" style="margin:0;">
          <label>Fund name</label>
          <input type="text" name="name" placeholder="e.g. Building Fund">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Tithe.ly fund ID (optional)</label>
          <input type="text" name="tithely_fund_id" placeholder="Blank = same fund as base link" style="font-family:var(--mono,monospace);">
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--charcoal);white-space:nowrap;padding-bottom:10px;">
          <input type="checkbox" name="is_default"> Default
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--charcoal);white-space:nowrap;padding-bottom:10px;">
          <input type="checkbox" name="active" value="1" checked> Active
        </label>
      </div>
      <div class="btn-row" style="margin-top:12px;">
        <button type="submit" class="btn btn-primary">Add fund →</button>
      </div>
    </form>
  </div>

  <div class="card" style="margin-top:20px;">
    <div class="card-title">Vendor / Market Links</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">One-off payment links — a Christmas Market vendor deposit, a rental, anything one-time. Paste in a prefilled link from either <strong>Tithe.ly</strong> (dashboard → Giving Form → Create Custom Link) or <strong>Square</strong> (Square's own Checkout link tool) — any http(s) link works. Give it a short slug and a label, then share <code>timothystl.org/&lt;slug&gt;</code>. Uncheck Active to retire an old one without deleting the record. (Gym rental invoices already email their own Tithe.ly pay link automatically — nothing to add here for those.)</div>
    ${givingRowsHtml}
    <form method="POST" action="/redirects/add" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <input type="hidden" name="category" value="giving">
      <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sage);margin-bottom:12px;">Add new link</div>
      <div style="display:grid;grid-template-columns:1fr 2fr 1.3fr auto;gap:12px;align-items:end;">
        <div class="form-group" style="margin:0;">
          <label>Slug (no slash)</label>
          <input type="text" name="path" placeholder="e.g. smith-catering" style="font-family:var(--mono,monospace);">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Payment link (Tithe.ly or Square)</label>
          <input type="url" name="url" placeholder="https://...">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Label</label>
          <input type="text" name="label" placeholder="e.g. Smith Catering — Fall Festival deposit">
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--charcoal);white-space:nowrap;padding-bottom:10px;">
          <input type="checkbox" name="active" value="1" checked> Active
        </label>
      </div>
      <div class="btn-row" style="margin-top:12px;">
        <button type="submit" class="btn btn-primary">Add link →</button>
      </div>
    </form>
  </div>
</div>`, 'Giving');
    }

    // ── USER MANAGEMENT ────────────────────────────────────────
    if (path.startsWith('/users') && !hasPermission(currentUser, 'users_manage')) {
      return new Response('Access denied.', { status: 403 });
    }

    if (path === '/users' && method === 'GET') {
      const users = await env.DB.prepare('SELECT id, username, email, permissions, last_login, active, created_at FROM users ORDER BY created_at').all();
      const msg = url.searchParams.get('msg');
      const alertHtml = msg === 'created' ? `<div class="alert alert-success">✓ User created.</div>`
        : msg === 'updated' ? `<div class="alert alert-success">✓ User updated.</div>`
        : msg === 'deleted' ? `<div class="alert alert-info">User deleted.</div>` : '';
      const deriveRoleLabel = (perms) => {
        if (perms.length === 0) return 'No access';
        if (perms.length === ALL_PERMISSIONS.length && ALL_PERMISSIONS.every(p => perms.includes(p))) return 'Full access';
        if (perms.length === 1) return `${PERMISSIONS[perms[0]] || perms[0]} only`;
        return `Custom access (${perms.length} of ${ALL_PERMISSIONS.length})`;
      };
      const listHtml = users.results.map(u => {
        let perms = [];
        try { perms = JSON.parse(u.permissions || '[]'); } catch(_) {}
        const permLabels = perms.map(p => (PERMISSIONS[p] || p)).join(', ') || 'None';
        const initials = (u.username || '?').slice(0, 2).toUpperCase();
        return `<div class="user-row">
  <div class="dash-avatar" style="width:36px;height:36px;font-size:12px;">${escapeHtml(initials)}</div>
  <div style="flex:1;min-width:160px;">
    <div class="user-name">${escapeHtml(u.username)}${!u.active ? ' <span class="badge badge-expired">Inactive</span>' : ''}</div>
    <div class="user-meta">${u.email ? escapeHtml(u.email) : '<span style="color:#B85C3A;font-size:12px;">No email — can\'t reset password</span>'}</div>
  </div>
  <span class="badge badge-upcoming" title="${escapeHtml(permLabels)}">${escapeHtml(deriveRoleLabel(perms))}</span>
  <div class="user-meta">${u.last_login ? 'Last login: ' + u.last_login.split('T')[0] : 'Never logged in'}</div>
  <div class="ni-actions">
    <a href="/users/edit/${u.id}" class="btn btn-sm btn-secondary">Edit access</a>
    ${u.id !== currentUser.id ? `<form method="POST" action="/users/delete/${u.id}" style="display:contents;" onsubmit="return confirm('Delete this user? This cannot be undone.')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>` : ''}
  </div>
</div>`;
      }).join('') || '<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No users yet.</div>';
      return html(`
${sidebarShell('users', currentUser)}
<div class="wrap">
  <div class="page-title">User Management</div>
  <div class="page-sub">Manage admin portal accounts and permissions.</div>
  ${alertHtml}
  <div class="btn-row" style="margin-bottom:24px;">
    <a href="/users/new" class="btn btn-primary">+ Invite user</a>
  </div>
  <div class="card">${listHtml}</div>
</div>`, 'Users');
    }

    if (path === '/users/new' && method === 'GET') {
      return html(`
${sidebarShell('users', currentUser)}
<div class="wrap">
  <div class="page-title">New user</div>
  <form method="POST" action="/users/new">
    <div class="card">
      <div class="form-group"><label>Username <span style="color:#B85C3A;">*</span></label><input type="text" name="username" required autocomplete="off"></div>
      <div class="form-group"><label>Email <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— used for password reset</span></label><input type="email" name="email" autocomplete="email" placeholder="user@timothystl.org"></div>
      <div class="form-group"><label>Password <span style="color:#B85C3A;">*</span></label><input type="password" name="password" autocomplete="new-password" placeholder="Min 8 characters"></div>
      <div class="form-group"><label>Confirm password</label><input type="password" name="password2" autocomplete="new-password"></div>
      <div class="form-group"><label>Permissions</label>${permissionCheckboxes([])}</div>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Create user →</button>
      <a href="/users" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, 'New User');
    }

    if (path === '/users/new' && method === 'POST') {
      if (!hasPermission(currentUser, 'users_manage')) return new Response('Access denied.', { status: 403 });
      const form = await request.formData();
      const username = (form.get('username') || '').trim();
      const email = (form.get('email') || '').trim().toLowerCase() || null;
      const password = form.get('password') || '';
      const password2 = form.get('password2') || '';
      if (!username || !password) return new Response('Username and password required.', { status: 400 });
      if (password !== password2) return new Response('Passwords do not match.', { status: 400 });
      if (password.length < 8) return new Response('Password must be at least 8 characters.', { status: 400 });
      const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
      if (existing) return new Response('Username already taken.', { status: 400 });
      const perms = Object.keys(PERMISSIONS).filter(k => form.get('perm_' + k) === '1');
      const hash = await hashPassword(password);
      await env.DB.prepare('INSERT INTO users (username, password_hash, permissions, created_at, active, email) VALUES (?, ?, ?, ?, 1, ?)')
        .bind(username, hash, JSON.stringify(perms), new Date().toISOString(), email).run();
      return new Response('', { status: 302, headers: { Location: '/users?msg=created' } });
    }

    if (path.startsWith('/users/edit/') && method === 'GET') {
      const uid = path.split('/').pop();
      const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
      if (!u) return new Response('Not found', { status: 404 });
      let selectedPerms = [];
      try { selectedPerms = JSON.parse(u.permissions || '[]'); } catch(_) {}
      return html(`
${sidebarShell('users', currentUser)}
<div class="wrap">
  <div class="page-title">Edit user: ${escapeHtml(u.username)}</div>
  <form method="POST" action="/users/edit/${u.id}">
    <div class="card">
      <div class="form-group"><label>Username</label><input type="text" name="username" value="${(u.username || '').replace(/"/g,'&quot;')}" required autocomplete="off"></div>
      <div class="form-group"><label>Email <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— used for password reset</span></label><input type="email" name="email" value="${(u.email || '').replace(/"/g,'&quot;')}" autocomplete="email" placeholder="user@timothystl.org"></div>
      <div class="form-group">
        <label>New password <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— leave blank to keep current</span></label>
        <input type="password" name="password" autocomplete="new-password" placeholder="Leave blank to keep current password">
      </div>
      <div class="form-group"><label>Confirm new password</label><input type="password" name="password2" autocomplete="new-password"></div>
      <div class="form-group"><label>Permissions</label>${permissionCheckboxes(selectedPerms)}</div>
      <div class="form-group">
        <label>Status</label>
        <div class="radio-row">
          <label><input type="radio" name="active" value="1"${u.active ? ' checked' : ''}> Active</label>
          <label><input type="radio" name="active" value="0"${!u.active ? ' checked' : ''}> Inactive</label>
        </div>
      </div>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Save changes →</button>
      <a href="/users" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, `Edit User`);
    }

    if (path.startsWith('/users/edit/') && method === 'POST') {
      if (!hasPermission(currentUser, 'users_manage')) return new Response('Access denied.', { status: 403 });
      const uid = path.split('/').pop();
      const form = await request.formData();
      const username = (form.get('username') || '').trim();
      const email = (form.get('email') || '').trim().toLowerCase() || null;
      const password = form.get('password') || '';
      const password2 = form.get('password2') || '';
      const active = form.get('active') === '1' ? 1 : 0;
      const perms = Object.keys(PERMISSIONS).filter(k => form.get('perm_' + k) === '1');
      if (!username) return new Response('Username required.', { status: 400 });
      if (password && password !== password2) return new Response('Passwords do not match.', { status: 400 });
      if (password && password.length < 8) return new Response('Password must be at least 8 characters.', { status: 400 });
      // Fetch existing user to detect permission or password changes
      const existingUser = await env.DB.prepare('SELECT permissions, active FROM users WHERE id = ?').bind(uid).first();
      const oldPerms = existingUser ? existingUser.permissions : '[]';
      const newPermsJson = JSON.stringify(perms);
      const permsChanged = oldPerms !== newPermsJson;
      const passwordChanged = !!password;
      const deactivated = existingUser && existingUser.active && !active;
      if (password) {
        const hash = await hashPassword(password);
        await env.DB.prepare('UPDATE users SET username = ?, email = ?, password_hash = ?, permissions = ?, active = ? WHERE id = ?')
          .bind(username, email, hash, newPermsJson, active, uid).run();
      } else {
        await env.DB.prepare('UPDATE users SET username = ?, email = ?, permissions = ?, active = ? WHERE id = ?')
          .bind(username, email, newPermsJson, active, uid).run();
      }
      // Invalidate sessions only when something relevant changed
      if (deactivated || passwordChanged || permsChanged) {
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run();
      }
      return new Response('', { status: 302, headers: { Location: '/users?msg=updated' } });
    }

    if (path.startsWith('/users/delete/') && method === 'POST') {
      if (!hasPermission(currentUser, 'users_manage')) return new Response('Access denied.', { status: 403 });
      const uid = path.split('/').pop();
      if (parseInt(uid, 10) === currentUser.id) return new Response('Cannot delete your own account.', { status: 400 });
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run();
      await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid).run();
      return new Response('', { status: 302, headers: { Location: '/users?msg=deleted' } });
    }

    // ── AUDIT LOG ──────────────────────────────────────────────
    if (path.startsWith('/audit-log') || path.startsWith('/rollback/')) {
      if (!hasPermission(currentUser, 'audit_view')) return new Response('Access denied.', { status: 403 });
    }

    if (path === '/audit-log' && method === 'GET') {
      const pageNum = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = 50;
      const offset = (pageNum - 1) * limit;
      const [rows, total] = await Promise.all([
        env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(limit, offset).all(),
        env.DB.prepare('SELECT COUNT(*) as n FROM audit_log').first()
      ]);
      const totalPages = Math.ceil((total ? total.n : 0) / limit);
      const canRollback = (row) => (row.entity_type === 'news_item' || row.entity_type === 'ministry_page' || row.entity_type === 'ministry_post') && row.action === 'update' && row.before_state;
      const listHtml = rows.results.length === 0
        ? '<div style="text-align:center;padding:40px;color:var(--gray);font-size:14px;">No audit log entries yet.</div>'
        : rows.results.map(row => {
            let before = null;
            try { before = JSON.parse(row.before_state || 'null'); } catch(_) {}
            return `<div class="audit-row">
  <div class="audit-who" style="font-size:12px;">${row.created_at ? escapeHtml(row.created_at.replace('T',' ').slice(0,16)) : ''}<br><span style="color:var(--amber);">${escapeHtml(row.username)}</span></div>
  <div class="audit-action"><span class="badge ${row.action === 'delete' ? 'badge-expired' : row.action === 'create' ? 'badge-active' : 'badge-upcoming'}">${escapeHtml(row.action)}</span></div>
  <div class="audit-entity" style="font-size:12px;">${escapeHtml(row.entity_type)}<br>${escapeHtml(row.entity_id)}</div>
  <div style="font-size:13px;color:var(--charcoal);">${escapeHtml(row.entity_label || '')}</div>
  <div>${canRollback(row) ? `<form method="POST" action="/rollback/${row.id}" onsubmit="return confirm('Restore this item to its previous state?')" style="display:inline;">
    <button type="submit" class="btn btn-sm btn-danger">Rollback</button>
  </form>` : ''}</div>
</div>`;
          }).join('');
      const pagination = totalPages > 1 ? `<div style="display:flex;gap:8px;justify-content:center;padding:24px 0;">${
        Array.from({length:totalPages},(_,i)=>i+1).map(p=>`<a href="/audit-log?page=${p}" class="btn btn-sm ${p===pageNum?'btn-primary':''}" style="${p===pageNum?'':'background:var(--linen);color:var(--charcoal);border:1px solid var(--border);'}">${p}</a>`).join('')
      }</div>` : '';
      return html(`
${sidebarShell('audit', currentUser)}
<div class="wrap">
  <div class="page-title">Audit Log</div>
  <div class="page-sub">A record of all content changes made by admin users.</div>
  <div class="card">
    <div style="display:grid;grid-template-columns:140px 80px 90px 1fr auto;gap:12px;padding:0 0 10px;border-bottom:2px solid var(--border);font-family:var(--sans);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gray);">
      <div>When / Who</div><div>Action</div><div>Type / ID</div><div>Item</div><div></div>
    </div>
    ${listHtml}
  </div>
  ${pagination}
</div>`, 'Audit Log');
    }

    if (path.startsWith('/rollback/') && method === 'POST') {
      if (!hasPermission(currentUser, 'audit_view')) return new Response('Access denied.', { status: 403 });
      const logId = path.split('/').pop();
      const entry = await env.DB.prepare('SELECT * FROM audit_log WHERE id = ?').bind(logId).first();
      if (!entry || !entry.before_state) return new Response('Cannot rollback: no previous state recorded.', { status: 400 });
      let before = null;
      try { before = JSON.parse(entry.before_state); } catch(_) { return new Response('Invalid state data.', { status: 400 }); }
      if (entry.entity_type === 'news_item') {
        await env.DB.prepare(
          'UPDATE news_items SET title=?, summary=?, body=?, image_url=?, publish_date=?, event_date=?, expire_date=?, pinned=? WHERE id=?'
        ).bind(before.title, before.summary, before.body, before.image_url, before.publish_date, before.event_date, before.expire_date, before.pinned, entry.entity_id).run();
        await logAudit(env.DB, currentUser, 'rollback', 'news_item', entry.entity_id, entry.entity_label, null, before);
        return new Response('', { status: 302, headers: { Location: '/audit-log?msg=rolledback' } });
      } else if (entry.entity_type === 'ministry_page') {
        await env.DB.prepare(
          'UPDATE youth_pages SET title=?, content=?, cta_label=?, cta_url=? WHERE slug=?'
        ).bind(before.title, before.content, before.cta_label, before.cta_url, entry.entity_id).run();
        await logAudit(env.DB, currentUser, 'rollback', 'ministry_page', entry.entity_id, entry.entity_label, null, before);
        return new Response('', { status: 302, headers: { Location: '/audit-log?msg=rolledback' } });
      } else if (entry.entity_type === 'ministry_post') {
        await env.DB.prepare(
          'UPDATE ministry_posts SET title=?, post_date=?, event_date=?, expire_date=?, body=?, pinned=? WHERE id=?'
        ).bind(before.title, before.post_date, before.event_date, before.expire_date, before.body, before.pinned, entry.entity_id).run();
        await logAudit(env.DB, currentUser, 'rollback', 'ministry_post', entry.entity_id, entry.entity_label, null, before);
        return new Response('', { status: 302, headers: { Location: '/audit-log?msg=rolledback' } });
      }
      return new Response('Rollback not supported for this entity type.', { status: 400 });
    }

    // Redirect root to the dashboard landing page
    if (path === '/') {
      return new Response('', { status: 302, headers: { Location: '/dashboard' } });
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
    <form method="POST" action="/newsletter/duplicate/${r.id}" style="display:contents;">
      <button type="submit" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Copy</button>
    </form>
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
    <form method="POST" action="/newsletter/duplicate/${r.id}" style="display:contents;">
      <button type="submit" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Copy</button>
    </form>
    ${hasPermission(currentUser, 'newsletter_approve') ? `
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Resend to test list?')">
      <input type="hidden" name="list_type" value="test">
      <button type="submit" class="btn btn-sm" style="background:var(--mist);color:var(--steel);border:1px solid var(--border);">Resend test</button>
    </form>
    <form method="POST" action="/send-email/${r.id}" style="display:contents;" onsubmit="return confirm('Resend to ALL subscribers? This will send again to everyone.')">
      <input type="hidden" name="list_type" value="all">
      <button type="submit" class="btn btn-sm btn-primary">Resend to all</button>
    </form>` : ''}
    ${hasPermission(currentUser, 'newsletter_approve') ? `<form method="POST" action="/delete/${r.id}" style="display:contents;" onsubmit="return confirm('Delete this newsletter?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>` : ''}
  </div>
</div>`).join('');

    return html(`
${sidebarShell('newsletter', currentUser, `<a href="https://timothystl.org/news" target="_blank">View archive →</a>`)}
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
