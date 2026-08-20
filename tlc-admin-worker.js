// Timothy Lutheran Church — Newsletter Admin Worker
// Purpose: Serves admin.timothystl.org — newsletter, news, sermons, youth pages, gym rentals, voter pages
// Deploy: Cloudflare Worker + D1 (tlc-newsletter-db) + KV (RSVP_STORE)
// Dependencies: Brevo API (email sending), TinyMCE CDN (WYSIWYG), Google Calendar API (gym bookings)
// Last modified: 2026-03-27


import { TINYMCE_HEAD, TINYMCE_VERSION, DB_INIT_NEWSLETTERS, DB_INIT_EVENTS, DB_INIT_NEWS_ITEMS, DB_INIT_YOUTH_PAGES, DB_INIT_MINISTRY_POSTS, DB_INIT_VOTERS_PAGE, DB_INIT_SERMON_SERIES, DB_INIT_PAGE_CONTENT, DB_INIT_NOTICES, DB_INIT_STAFF_MEMBERS, DB_INIT_SITE_SETTINGS, DB_INIT_GYM_GROUPS, DB_INIT_GYM_BOOKINGS, DB_INIT_GYM_BOOKING_SLOT_INDEX, DB_INIT_GYM_RECURRENCES, DB_INIT_GYM_BLOCKED, DB_INIT_GYM_INVOICES, DB_INIT_SERMON_NOTES, DB_INIT_SUBSCRIBERS, DB_INIT_USERS, DB_INIT_SESSIONS, DB_INIT_AUDIT_LOG, DB_INIT_PASSWORD_RESETS, DB_INIT_MINISTRY_MEDIA, DB_INIT_MINISTRY_REVISIONS, DB_INIT_MINISTRY_SECTIONS, DB_INIT_PAGES, DB_INIT_PAGE_REDIRECTS, DB_INIT_PAGE_REVISIONS, DB_INIT_FORM_SUBMISSIONS, DB_INIT_PARTNERS, PARTNER_SEED, DB_INIT_MENU_ITEMS, MENU_SEED, DB_INIT_FOOTER_COLUMNS, FOOTER_COLUMN_SEED, FOOTER_ITEM_COLUMNS, TAP_SEED, CARD_KINDS, isFormCard, SIGNUP_CARD_SEED, MDO_SECTION_SEED, THEMES, CONTENT_TYPES, MINISTRY_SLUGS, INITIAL_STAFF, INITIAL_SETTINGS, parseServiceTimes, DB_INIT_PUSH_SUBSCRIPTIONS, DB_INIT_PAYROLL_READY_NOTIFIED, DB_INIT_MARKET_VENDORS, DB_INIT_MARKET_VENDORS_INDEX, DB_INIT_CORE_VALUES,
         DB_INIT_CALENDAR_CATEGORIES, DB_INIT_CALENDAR_CATEGORIES_COLOR,
         DB_INIT_SITE_EVENTS, DB_INIT_SITE_EVENT_FIELDS, DB_INIT_SITE_EVENT_FIELDS_INDEX,
         DB_INIT_SITE_EVENT_REGISTRATIONS, DB_INIT_SITE_EVENT_REGISTRATIONS_INDEX,
         MARKET_LEGACY_SETTINGS_DEFAULTS, MARKET_LEGACY_SETTINGS_KEYS } from './admin/db.js';
import { pushToAllSubscribers, pushToPublicSubscribers } from './admin/webpush.js';

// Static pages that can carry self-serve notices (matches the SPA's page ids in public/index.html)
// The one address the link cards are shown at. A tap pointing anywhere else
// is a working tag with no cards behind it — see the Taps screen.
const LINKS_HOST_RE = /^https?:\/\/links\.timothystl\.org(\/|$)/i;

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
import { churchDate, churchDatePlus, partOfDay, churchFormat } from './admin/when.js';
import { VERSION, html, sidebarShell, loginPage, setupPage, forgotPasswordPage, resetPasswordPage, permissionCheckboxes, formatDate, escapeHtml, tinymceEditorSection, tinymcePostSection, tinymceSermonSection, tinymceYouthSection, tinymcePageSection, tinymcePastorSection, tinymceNoteSection, ADMIN_SHELL_CSS, ADMIN_SHELL_JS, SERVICE_WORKER_JS } from './admin/helpers.js';
import { renderListSection, renderDrawer, renderFormSection, primaryCell, statusPill, valueChip, valueChips, panel, countLabel, pluralise,
         rowActions, toggleCell, panelList, paginationWindow } from './admin/ui.js';
import { SECTIONS, section as sectionCfg, columnsOf, filtersOf } from './admin/sections.js';
import { dayKey, pruneBefore, countInMonth, tapCountLabel, everCounted, validTapId } from './admin/taps.js';
import { VALUES, valueByKey, normalizeValue, mergedValues, VALUE_TEXT_FIELDS } from './admin/values.js';
import { hashPassword, verifyPassword, createSession, getSession, deleteSession, sessionCookieHeader, clearSessionCookieHeader, logAudit, hasPermission, ALL_PERMISSIONS, PERMISSIONS, PERMISSION_PRESETS, migratePermissionKeys } from './admin/auth.js';
import { sendBrevoNewsletter, sendTransactionalEmail, buildEmailHtml, buildWebHtml, cancelBrevoCampaign, getBrevoListCount } from './admin/email.js';
import { buildPayrollCsv, buildPayrollPdfLines } from './admin/payroll-report.js';
import { buildMonospacePdf } from './admin/pdf.js';
import { handleGymRoutes, sweepExpiredItems, extractImageKeys, getGCalAccessToken } from './admin/gym.js';
import { buildCalendarFeed, buildIcs, parseCalendarIds, monthRange, shiftMonth,
         mergedCategories, activeCategories, CALENDAR_PALETTE, GOOGLE_COLORS, googleColorName,
         DEFAULT_CATEGORIES, NEUTRAL_CATEGORY } from './admin/calendar.js';
import { migrateLegacyPage, starterBlocks, sanitizeBlocks, sanitizeBlock, parseBlocks, newBlock,
         renderPage, renderBlock, BLOCK_DEFS, BLOCK_TYPE_KEYS, GROUPS, BG, INK, SIZES, SPLITS, TONES,
         STAMP_PRESETS, safeUrl, esc as escBlock, editorPhoneCss, blocksClientConfig, makeBlockId,
         TEMPLATES, templateOf, wrapTemplate, BLOCK_CSS, BLOCK_CSS_RAW, blockCssLink, cleanText,
         isSafeObjectPosition, safeZoomFactor, snapSpace, sanitizeClassicRich,
         STARTERS, starterOf } from './admin/blocks.js';
import PAYROLL_HTML from './admin/payroll.html';
import SCHEDULER_HTML from './admin/scheduler.html';
import MINISTRY_EDITOR_HTML from './admin/ministry-editor.html';
import { PAGE_SEEDS } from './admin/page-seeds.js';
import { SITE_PAGES } from './admin/site-pages.js';
// Whether an address on this site actually answers, and the picker's own list.
import { LINKS_JS } from './admin/links.js';
// The four pages the redesign was authored for. Hand-written, because
// site-pages.js is generated out of the markup these replace — see the note at
// the top of that file.
import { REDESIGN_BLOCKS } from './admin/redesign-seeds.js';
import { GIVE_LANDING_PAGE, GIVE_LANDING_PAGE_ID } from './admin/give-landing-seed.js';
// /christmasmarket/vendors, same shape as give-landing-seed.js and for the
// same reason — a live payment application the generic extractor never had a
// chance to convert, because it never had a tools/extract-pages.mjs PAGES
// entry in the first place. UNLIKE give-landing, this page is an ordinary SPA
// page and is not excluded anywhere below — see admin/market-page-seed.js.
import { MARKET_VENDORS_PAGE } from './admin/market-page-seed.js';
import { MARKET_APPLY_PAGE } from './admin/market-vendors-apply-seed.js';
import { giftForPeriod, giveButtonLabel, parseAmount as parseGiveAmount, fmtAmount as fmtGiveAmount,
         GIVE_PERIOD_JS } from './give-link.js';

// /news has no hardcoded markup for tools/extract-pages.mjs to lift — its
// content (the news list, the newsletter archive, the calendar) was always
// fetched live by JS into empty containers, so the extractor found nothing
// to convert and the page never got a `pages` row at all. Hand-authored
// here rather than in admin/site-pages.js, which is generated and would
// have this dropped the next time the extractor runs.
//
// ⚠ ITS BLOCKS NOW COME FROM admin/redesign-seeds.js, along with Home,
// Worship and Ministries. This record keeps only what /news IS — its title,
// address and menu placement — because the extractor cannot produce a page
// row for it at all: /news never had hardcoded markup to lift, its content
// having always been fetched live by JS into empty containers.
const NEWS_PAGE_SEED = {
  id: 'news', title: 'News & Events', menu_label: '', slug: '/news', parent_id: null, sort: 70,
  template: 'standard', in_menu: 0,
  seo_description: 'Announcements, upcoming events, and weekly newsletters from Timothy Lutheran Church.',
  blocks: REDESIGN_BLOCKS.news,
};
// /about/values, like /news, has no hardcoded markup for the extractor to lift
// — it is a live view of the values record — so it needs a page row authored
// here. See the note in admin/redesign-seeds.js on why it is a block page now
// when admin/BLOCK-EDITOR-ROLLOUT.md said it should not be.
const VALUES_PAGE_SEED = {
  id: 'values', title: 'Our Values', menu_label: '', slug: '/about/values',
  parent_id: 'about', sort: 20, template: 'standard', in_menu: 0,
  seo_description: 'Welcome, Receive, Grow, Go — the four core values of Timothy Lutheran Church, and the partner ministries paired to each.',
  blocks: REDESIGN_BLOCKS.values,
};

import { orderPages, filterPages, pageStatus, slugify, uniqueSlug, pageRename,
         withShortLinks, shortLinkFor, shortLinkRoutes, outboundUrl, canReseed } from './admin/pages.js';
import { MENUS, menuTree, publicMenu, orphanPages, menuWarnings, renumber,
         normalizeMenu, normalizeKind, normalizeStyle, normalizeDepth,
         COLUMN_SOURCES, normalizeSource, footerColumns, publicFooter, renumberColumns } from './admin/menu.js';
import { diffSummary, auditGroup, canRollback as auditCanRollback, rollbackNote, actionTone } from './admin/audit.js';
import { BLOCKS as NL_BLOCKS, parseBlocks as parseNlBlocks, serializeBlocks as serializeNlBlocks,
         blockOn, normalizeAudience, subjectAdvice, preheaderAdvice,
         isSent as isNewsletterSent, canEdit as canEditNewsletter, approvalState,
         issueStatus, sendSummary, parseSubscriberCsv,
         parseExtras, extrasFromForm, serializeExtras, MAX_EXTRA_NOTES } from './admin/newsletter.js';
import { screenSubmission, formConfig, forwardToChms, officeEmailHtml, officeSubject,
         handleFilteredRoutes, heldCount, OFFICE_EMAIL } from './admin/forms.js';
import { stripImageMetadata } from './admin/exif.js';
import { handleMarketRoutes, marketSettings, marketConfig, marketPayUrl, priceBreakdown, money as marketMoney,
         sanitizeApplication, screenableText, coordinatorEmailHtml, vendorEmailHtml, marketInsertArgs } from './admin/market.js';
import { getEvent, listEvents, eventFeeConfig, insertRegistration, updateRegistration, eventCoordinatorPermissions,
         eventCoordinatorPermissionKey, slugifyEventId, handleEventsRoutes, eventFields,
         sanitizeRegistration, registrationScreenableText, splitRegistrationFields, capacityDecision } from './admin/events.js';
import { createSquarePaymentLink, verifySquareSignature } from './admin/square.js';
import { normalizeChannelInput, channelPageUrl, channelIdFrom, feedUrl,
         parseFeed, pickLatest, isChannelId } from './admin/sermons-feed.js';
import { PALETTE as CHROME_PALETTE, BAR_KEYS, DEFAULTS as CHROME_DEFAULTS,
         parseAppearance, appearanceFromForm, sanitizeAppearance, publicAppearance,
         isDirty as chromeDirty, changedFields as chromeChanged, FIELD_LABELS as CHROME_LABELS,
         renderHeaderPreview, renderNewsletterPreview, TYPEFACES, TEXT_SIZES } from './admin/appearance.js';

// The market's own pages, published from their seeds by the one-time marker
// below rather than left as drafts — see MARKET_PUBLISH_MARKER.
const MARKET_SEEDED_PAGES = [MARKET_VENDORS_PAGE, MARKET_APPLY_PAGE];

// ── THE CHROME RECORD, DRAFT AND LIVE ────────────────────────
// Two settings rows, the same split a page has between `blocks` and
// `published_blocks`. The draft is what the admin screen draws; the published
// row is the only thing /api/pages ever sends to a visitor.
const CHROME_DRAFT_KEY = 'site_appearance_draft';
const CHROME_LIVE_KEY = 'site_appearance';

async function readChrome(env, key) {
  const row = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first().catch(() => null);
  return parseAppearance(row && row.value);
}

// Both rows at once, because every screen that shows one wants to say how it
// differs from the other.
async function readChromePair(env) {
  const [draft, live] = await Promise.all([readChrome(env, CHROME_DRAFT_KEY), readChrome(env, CHROME_LIVE_KEY)]);
  return { draft, live, dirty: chromeDirty(draft, live) };
}

async function writeChrome(env, key, value) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO site_settings (key, value, label, hint) VALUES (?, ?, ?, ?)'
  ).bind(
    key, JSON.stringify(sanitizeAppearance(value)),
    key === CHROME_LIVE_KEY ? 'Header and newsletter band (live)' : 'Header and newsletter band (draft)',
    key === CHROME_LIVE_KEY ? 'What visitors see. Written only by Publish on the Appearance screen.'
      : 'What the Appearance screen shows. Never reaches the site until it is published.'
  ).run();
}

// Allowlist of site_settings keys readable via the public /api/settings/{key}
// endpoint. Everything else returns 404 — keeps internal config (gym admin
// email, Brevo keys, etc.) from leaking to anyone who can guess a key name.
const PUBLIC_SETTINGS_KEYS = new Set(['zoom_url', 'councilfiles_url', 'give_url', 'social_image_url']);

// /api/pages is the public site's one bundle — nav, church details, every
// published page's HTML — rebuilt from five queries and a full render on
// every request. It goes behind the edge cache; any POST that could change
// what it says busts it (see the chokepoint in _fetch), and the response's
// own max-age=120 is the safety net for anything the chokepoint misses.
// `caches` does not exist in the Node test harness, so every touch is gated.
// Which palette swatch each shipped category is seeded with. Kept beside the
// seed rather than on DEFAULT_CATEGORIES, because the seed list carries the
// literal colors the site shipped with and this is only how they map onto the
// editable palette.
const CAL_SEED_PALETTE = {
  worship: 'navy', learn: 'teal', ministry: 'moss', facility: 'stone', youth: 'amber',
  wol: 'slate', mdo: 'sand', music: 'plum', meetings: 'steel', special: 'gold', other: 'gray',
};

const PAGES_CACHE_URL = 'https://admin.timothystl.org/api/pages';

// Per-binding: a database that has at least one user account. The first-run
// /setup redirect needs a COUNT until then; after that the count can only
// grow, so it is not asked again. Keyed the same way as MARKERS_SEEN below.
const SETUP_DONE = new WeakMap();
const edgeCache = () => (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
function bustPagesCache(ctx) {
  const c = edgeCache();
  if (!c) return;
  try { ctx.waitUntil(c.delete(new Request(PAGES_CACHE_URL))); } catch (_) {}
}

// Per-DATABASE memo: the schema version and all four one-time seed markers
// have been read and found current, so later requests against the same
// binding skip even the single _schema_version read. Keyed on env.DB rather
// than held in a bare module variable, because the test harness hands the
// same worker module a fresh database per group — a module flag would carry
// "already migrated" across to an empty database and nothing would have
// tables. In production the binding is one object per isolate, so this is
// exactly the per-isolate memo it looks like. Set ONLY when every gate was
// already satisfied — a request that ran any migration or seed leaves it
// unset, so the next request re-reads and verifies the markers actually
// landed. A deploy starts fresh isolates, so a SCHEMA_VERSION bump is never
// masked by this.
const MARKERS_SEEN = new WeakMap();

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

// The thirteen payroll RPC functions the /sb/ proxy will forward to Supabase,
// and the only thing it will forward. See the gate in _fetch for why this is a
// list rather than a prefix, and admin/escaping.test.mjs's sibling assertion
// that it matches what admin/payroll.html actually calls.
export const PAYROLL_RPC_FNS = [
  'payroll_get_staff',
  'payroll_get_period_entries',
  'payroll_get_prior_pto',
  'payroll_get_period_approval',
  'payroll_get_mdo_staff',
  'payroll_get_mdo_hours',
  'payroll_get_mdo_clock_events',
  'payroll_get_mdo_pto',
  'payroll_approve_period',
  'payroll_unapprove_period',
  'payroll_save_hours',
  'payroll_save_staff',
  'payroll_deactivate_staff',
];
const PAYROLL_RPC_PATHS = new Set(PAYROLL_RPC_FNS.map((f) => '/sb/rest/v1/rpc/' + f));

// The page editor is a full-viewport screen served as a static shell, so it
// gets its own headers: never cached (a stale draft would silently undo an
// edit), never indexed, and no frame-ancestors.
const EDITOR_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob: https:; " +
    "connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com https://docs.google.com https://calendar.google.com; " +
    "frame-ancestors 'none'; base-uri 'none'",
};

// The fields the editor's Page tab edits. Kept apart from the block draft: page
// settings are not part of what Publish promotes, so folding them into the draft
// would leave a page permanently reading "Draft edits" for having been renamed.
function pageSettings(row) {
  return {
    title: row.title, slug: row.slug, parent_id: row.parent_id || null,
    in_menu: row.in_menu ? 1 : 0, template: templateOf(row.template).key,
    seo_description: row.seo_description || '', locked: row.locked ? 1 : 0,
    owner_username: row.owner_username || '',
    // Only meaningful on the two layouts with an aside; sent for every page
    // regardless so a template switch never needs a second round trip to
    // discover a value already sitting on the row.
    aside_top: snapSpace(row.aside_top || 0),
  };
}

// Accounts that could be handed a page of their own — anyone who holds either
// website-pages permission.
async function pageEditors(env) {
  try {
    const rows = await env.DB.prepare('SELECT username, permissions FROM users WHERE active = 1 ORDER BY username').all();
    return (rows.results || [])
      .filter((u) => { try { return JSON.parse(u.permissions || '[]').some((p) => p === 'pages_edit' || p === 'pages_edit_own'); } catch { return false; } })
      .map((u) => u.username);
  } catch (_) { return []; }
}

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

// A page carries its images on every view, so one straight-off-the-phone photo
// is a page nobody on a phone waits for. Returns a message when an image in our
// own bucket is over the limit, or '' when it is fine — an image hosted
// somewhere else is not ours to measure.
const MEDIA_MAX_BYTES = 1048576;
async function oversizeImage(env, url, request) {
  try {
    const origin = new URL(request.url).origin;
    if (!url.startsWith(origin + '/images/')) return '';
    const obj = await env.IMAGES.head(url.slice((origin + '/images/').length));
    if (!obj || obj.size <= MEDIA_MAX_BYTES) return '';
    return `That photo is ${(obj.size / 1048576).toFixed(1)}MB. Photos have to be under 1MB so pages stay quick on a phone — try a smaller one.`;
  } catch (_) {
    return '';
  }
}

// The parts of the page editor's API that do not care which table the page
// lives in: the media library, saved sections, a fresh block of a given type,
// and the stateless renderer. The ministry editor and the site editor mount
// them under their own prefix and share one implementation, so a fix to either
// lands in both. Returns null when `path` is none of them.
// ── THE LAYOUT HAS TO COME BACK WITH EVERY REDRAW ────────────────────────────
// A page's template decides what goes AROUND its blocks — whether there is a
// sidebar at all, and whether the pages beneath this one are listed. Neither
// can come from the request: the template is a stored property of the page, and
// the child list is derived from the page tree rather than typed anywhere.
//
// ⚠ THIS IS THE BUG IT EXISTS FOR. The stateless /render below took only the
// blocks and the slug, so every redraw rendered the page as `standard` — and
// `standard` has no aside. The canvas was right on first paint (the GET passes
// both) and right the moment somebody switched layout (the settings POST passes
// both), so a page with a sidebar showed one until the first structural change
// — an added block, a delete, a reorder, an undo — and then silently lost it
// for the rest of the session. Reloading brought it back, which is exactly what
// made it read as "the sidebar doesn't display" rather than as an editor fault.
//
// Ministry pages have no layout of their own, so this reads nothing for them.
async function pageLayoutContext(env, P, id) {
  if (P !== '/pages/api' || !id) return {};
  const row = await env.DB.prepare('SELECT id, template, aside_top FROM pages WHERE id = ?')
    .bind(id).first().catch(() => null);
  if (!row) return {};
  // Every child, not only the ones this person may open — the aside and the
  // section list are what a VISITOR will see, and the editor's own GET scopes
  // its rail separately for exactly that reason.
  const kids = await env.DB.prepare(
    'SELECT id, title, menu_label, slug, parent_id, sort, status, in_menu, seo_description ' +
    'FROM pages WHERE parent_id = ? ORDER BY sort ASC, title ASC'
  ).bind(row.id).all().catch(() => ({ results: [] }));
  return { template: row.template, asideTop: row.aside_top || 0, children: kids.results || [] };
}

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
    // catalogd here so staff pick from a library instead of pasting URLs.
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
      // Every stored image stays under a megabyte. The browser resizes before
      // uploading, but that is a courtesy — this is the control, and it is the
      // only place that sees what actually landed in the bucket.
      if (kind === 'photo') {
        const tooBig = await oversizeImage(env, url, request);
        if (tooBig) return jsonResponse({ error: tooBig }, 400);
      }
      const thumbUrl = safeUrl(body.thumb_url).slice(0, 600);
      const filename = String(body.filename || url.split('/').pop() || 'upload').slice(0, 160);
      const meta = String(body.meta || '').slice(0, 80);
      const bytes = Math.max(0, parseInt(body.bytes, 10) || 0);
      const res = await env.DB.prepare(
        'INSERT INTO ministry_media (filename, kind, url, thumb_url, alt, meta, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(filename, kind, url, thumbUrl, alt, meta, bytes, currentUser?.username || '', new Date().toISOString()).run();
      return jsonResponse({ ok: true, item: { id: res.meta?.last_row_id || 0, filename, kind, url, thumb_url: thumbUrl, alt, meta, bytes } });
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

    // Stateless render — the editor's single source of block markup. It writes
    // nothing; the only reads are the self-filling blocks' data bundle and the
    // page's own layout, so what staff arrange on the canvas is what visitors
    // get.
    if (path === P + '/render' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const blocks = sanitizeBlocks(body.blocks);
      const slug = cleanSlug(body.slug);
      return jsonResponse({
        html: renderPage(blocks, Object.assign({
          editing: true, slug, withCss: true, data: await pageData(env, ctx),
        }, await pageLayoutContext(env, P, slug))),
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

// ── BADGE / WORKLIST COUNTS ──────────────────────────────────
// The sidebar badges and the Dashboard's "Needs you" list are the same three
// numbers, computed here once so they can never disagree — a badge saying 3
// beside a worklist showing 2 teaches a volunteer to distrust both.
//
// Each count is scoped to the permission that could act on it, and every query
// is defensive: a missing table on a fresh database must not take the whole
// sidebar down.
async function badgeCounts(env, user) {
  const n = async (sql) => {
    try { return (await env.DB.prepare(sql).first())?.n || 0; } catch (_) { return 0; }
  };
  const canGym = hasPermission(user, 'gym_manage');
  const canPages = hasPermission(user, 'pages_edit') || hasPermission(user, 'pages_edit_own');
  const canApprove = hasPermission(user, 'newsletter_approve');
  const canMarket = hasPermission(user, 'market_manage');
  const [gym, pages, newsletter, market, eventPerms] = await Promise.all([
    canGym ? n("SELECT COUNT(*) AS n FROM gym_bookings WHERE status='hold'") : 0,
    // A page counts as needing attention when its draft differs from what is
    // live, or when it has never been published at all. Same rule as the Pages
    // list's own Draft pill (admin/pages.js), so the two always agree.
    canPages ? n("SELECT COUNT(*) AS n FROM pages WHERE status='draft' OR COALESCE(blocks,'') <> COALESCE(published_blocks,'')") : 0,
    canApprove ? n("SELECT COUNT(*) AS n FROM newsletters WHERE approval_status='pending'") : 0,
    // A vendor who applied and never finished at the card page. The old Google
    // Form could not show this at all — an abandoned submission left no row
    // anywhere — so it is the one number this screen exists to surface.
    canMarket ? n("SELECT COUNT(*) AS n FROM site_event_registrations WHERE event_id='christmasmarket' AND payment_status='unpaid'") : 0,
    // Every event's own coordinator key, so the sidebar can show the Events
    // row to a coordinator holding one of them without also holding
    // events_manage — see the eventItems row in sidebarShell().
    eventCoordinatorPermissions(env).catch(() => ({})),
  ]);
  return { gym, pages, newsletter, market, eventPerms };
}

// One sort rule, shared by /api/news and pageData()'s self-filling news
// blocks: pinned first, then an event (has event_date) before a plain
// announcement, events soonest-first, announcements newest-published-first.
// CASE WHEN … ASC picks which group comes first; the two date columns each
// keep their own direction, which a single ORDER BY column cannot do.
const NEWS_ORDER_SQL = `ORDER BY pinned DESC,
  CASE WHEN event_date IS NOT NULL THEN 0 ELSE 1 END ASC,
  event_date ASC, publish_date DESC, id DESC`;

// An uploaded image is stored as a root-relative /images/… path, which only
// resolves on this Worker's own origin. Every rendered page is consumed
// somewhere else — timothystl.org for /api/pages, give.timothystl.org for the
// giving page — so the path is made absolute on the way out. One definition,
// because a page rendered for one hostname and not the other would show broken
// images on exactly one surface, which is the kind of thing nobody notices
// until a visitor mentions it.
const fixImageUrls = (s) => (s ? s.replace(/src="\/images\//g, 'src="https://admin.timothystl.org/images/') : s);

// ── FX-04, THE LEGACY HALF ───────────────────────────────────────────────────
// Sanitizing on write protects everything saved from now on. It does nothing
// for the rows already in the table, which were stored exactly as posted for as
// long as these forms have existed — and those are the ones the public site is
// rendering into `innerHTML` today.
//
// So the public read paths sanitize on the way out too. That is belt and
// braces for a new row and the ONLY protection for an old one.
//
// ⚠ DELIBERATELY NOT A ONE-TIME MIGRATION OVER THE STORED BODIES. A pass like
// that cannot be undone, and the one thing worse than unsanitized markup in the
// archive is a script that rewrites six years of newsletters and gets it wrong
// on a body nobody thought to check. Cleaning on the way out is reversible by
// deleting one line; the stored bytes stay exactly as they were, so if this
// profile turns out to eat something real, the content is still there.
const richOut = (v) => (v ? sanitizeClassicRich(v) : v);

async function pageData(env, reqKey) {
  if (reqKey && PAGE_DATA_CACHE.has(reqKey)) return PAGE_DATA_CACHE.get(reqKey);
  const p = (async () => {
    const q = async (sql, ...binds) => {
      try { return (await env.DB.prepare(sql).bind(...binds).all()).results || []; } catch (_) { return []; }
    };
    const [settingRows, chromeRow, sermonRow, sermonSeries, sermonNotes, bibleClasses, news, staff, newsletters,
           giveTiers, giveFunds, giveUrlRow, partners, coreValueRows, marketEventRow, allEventRows, allEventFieldRows] = await Promise.all([
      q("SELECT key, value FROM site_settings WHERE key LIKE 'church_%'"),
      // ⚠ The PUBLISHED row only. The draft exists so that somebody can try a
      // color without it being on the front of the church website, and
      // reading the wrong key here would undo that in one line.
      env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(CHROME_LIVE_KEY).first().catch(() => null),
      env.DB.prepare(
        'SELECT n.title, n.date, n.scripture, n.youtube_url, n.audio_url, s.title AS series ' +
        'FROM sermon_notes n LEFT JOIN sermon_series s ON s.id = n.series_id ' +
        'ORDER BY COALESCE(n.date, \'\') DESC, n.id DESC LIMIT 1'
      ).first().catch(() => null),
      // The library itself, for the Sermon library block on /sermons. The row
      // above is the single newest sermon and always has been — it is what the
      // homepage's "Latest sermon" card shows, and it is the reason /sermons
      // had nothing to render from: there was no block that could list what the
      // church has actually preached.
      // ⚠ Bounded. This is rendered into every /api/pages response, and a
      // church that keeps preaching would otherwise grow that payload forever.
      q('SELECT id, title, date_range, description, active, sort_order FROM sermon_series ORDER BY active DESC, sort_order ASC, id DESC LIMIT 24'),
      q('SELECT id, series_id, title, date, scripture, youtube_url, audio_url ' +
        'FROM sermon_notes ORDER BY COALESCE(date, \'\') DESC, id DESC LIMIT 120'),
      // The Bible classes, for the Bible classes block on /education (the page
      // the menu calls "Learn"). Same rows, same order and the same active
      // filter as /api/bible-classes, which is what the hardcoded page fetches
      // at runtime — so the converted page shows exactly what the old one did.
      q('SELECT id, title, label, description, leader, location, schedule, accent ' +
        'FROM bible_classes WHERE active = 1 ORDER BY sort_order, id LIMIT 40'),
      // Full fields, not just title+date — the "News feed" block (unlike the
      // older "News highlights" block, which only ever needed a title and a
      // date) shows the same expandable image/summary/body cards the /news
      // page used to hand-roll. Both blocks read this one list.
      q(`SELECT id, title, summary, body, image_url, publish_date, event_date, pinned FROM news_items
         WHERE (expire_date IS NULL OR expire_date >= date('now'))
           AND (event_date IS NULL OR event_date >= date('now'))
         ${NEWS_ORDER_SQL} LIMIT 30`),
      // ⚠ The Staff grid block shows EVERY row this returns, so this limit is
      // the only thing that can cut somebody off the About page. It was 12,
      // which a church that hires two more people would quietly cross with
      // nothing to see but a missing face. Still bounded — it is rendered into
      // every /api/pages response — just bounded well above the real number.
      // ⚠ photo_position and photo_zoom are the per-person crop somebody set by
      // eye on the Staff screen. They were not selected here, so the Staff grid
      // block had no crop to honor even once it wanted to — a face framed in the
      // admin came out framed differently on the published page.
      q('SELECT name, title, email, photo_url, photo_position, photo_zoom ' +
        'FROM staff_members ORDER BY display_order ASC, id ASC LIMIT 60'),
      // Same "published" filter /api/newsletters itself uses (status IS NULL
      // counts too — issues sent before the status column existed).
      q(`SELECT id, subject, published_at, pastor_note FROM newsletters
         WHERE (status IS NULL OR status = 'published') ORDER BY published_at DESC, id DESC LIMIT 12`),
      // The giving page's three moving parts. They are read here, with
      // everything else a block might need, so the Giving widget and the
      // Amount ladder can be SELF-FILLING blocks — the one property that
      // makes putting the donation page in the block editor safe at all. A
      // block that stored the Tithe.ly link would freeze it at publish time
      // and go on charging to the old form after the office changed it.
      q('SELECT amount, url, is_default FROM give_amount_tiers WHERE active != 0 ORDER BY sort_order'),
      q('SELECT id, name, tithely_fund_id, is_default FROM give_funds WHERE active != 0 ORDER BY sort_order'),
      env.DB.prepare("SELECT value FROM site_settings WHERE key = 'give_url'").first().catch(() => null),
      // The partner ministries, so the Partner logos block can be self-filling
      // the way the staff grid and the sermon block already are. A logo changed
      // on the Partners screen lands on every page showing it at once, and
      // nobody retypes a partner's name into a page for it to go stale there.
      q('SELECT id, name, short_name, value, blurb, site_url, logo_url FROM partners ORDER BY sort_order, id'),
      // The office-editable words and photo for each of the four values — see
      // the note on core_values in admin/db.js for why only these columns and
      // not the design tokens.
      q('SELECT key, short, name, blurb, tag, why, photo_url FROM core_values'),
      // The Christmas Market's own event row, for the self-filling application
      // block — see admin/market.js and admin/events.js's eventFeeConfig().
      // Batched here with everything else rather than a second round trip per
      // page render, the same reasoning as give above.
      env.DB.prepare("SELECT * FROM site_events WHERE id = 'christmasmarket'").first().catch(() => null),
      // Every event (the market included, so the `registration` block's
      // event picker can name it even though it never actually uses it),
      // for the generic `registration` block — see admin/events.js. A
      // handful of rows at most; unbounded, unlike the news/staff/sermon
      // lists above, on purpose — there is no reasonable number of events a
      // church runs that would make this worth capping.
      q('SELECT * FROM site_events ORDER BY sort_order, id'),
      q('SELECT * FROM site_event_fields ORDER BY event_id, sort_order, id'),
    ]);
    const s = {};
    for (const r of settingRows) s[r.key.replace(/^church_/, '')] = r.value;
    return {
      settings: { address_line: s.address_line || '', address_city: s.address_city || '', phone: s.phone || '', email: s.email || '' },
      services: parseServiceTimes(s.service_times),
      // Resolved to real colors by publicAppearance, so public/index.html
      // never carries a copy of the palette and cannot drift from it.
      appearance: publicAppearance(parseAppearance(chromeRow && chromeRow.value)),
      sermon: sermonRow || null,
      // Series with their own sermons nested, assembled here rather than in the
      // renderer: admin/blocks.js is shared with the editor and the tests, and
      // it must never know how these two tables relate.
      sermonSeries: (sermonSeries || []).map((se) => ({
        id: se.id, title: se.title, dates: se.date_range || '',
        description: se.description || '', active: !!se.active,
        sermons: (sermonNotes || []).filter((n) => n.series_id === se.id),
      })),
      // ⚠ A sermon with no series is still a sermon. The admin calls these
      // "standalone" and offers a button for them, so a page that quietly
      // dropped them would be hiding content somebody deliberately added.
      sermonLoose: (sermonNotes || []).filter((n) => !n.series_id),
      classes: bibleClasses || [],
      // FX-04: the `newsfeed` block emits `n.body` as markup, server-side, into
      // every published page in /api/pages. Same legacy problem as /api/news,
      // same answer — see richOut above.
      news: (news || []).map((r) => ({ ...r, body: richOut(r.body) })),
      staff, newsletters,
      // The four core values, composed here so the block is self-filling: the
      // words come from admin/values.js, office-edited words layered on top
      // from the core_values table (mergedValues — blank column means "still
      // the hardcoded default"), the partner ministry from the `partners`
      // table. ⚠ VALUES order is the arc — Welcome, Receive, Grow, Go — and
      // is never sorted.
      values: mergedValues(coreValueRows).map((v) => {
        const p = partners.find((x) => x.value === v.key);
        return {
          key: v.key, short: v.short, name: v.name, blurb: v.blurb,
          tag: v.tag || v.blurb, why: v.why || '',
          field: v.field || '', light: v.light || v.solid, darkInk: !!v.darkInk,
          ways: v.ways || [],
          // A photo replaces the flat gradient field with a photograph under a
          // fixed dark veil — see renderBlock's 'values' branch. Never the
          // reverse: the veil exists only when there is a photo to keep
          // legible, so an untouched value renders byte-identical to before.
          photoUrl: v.photo_url || '',
          partner: p ? { name: p.name, body: p.blurb || '' } : null,
        };
      }),
      partners: partners.map((p) => ({
        id: p.id, name: p.name, shortName: p.short_name || '',
        url: p.site_url || '', logo: p.logo_url || '',
      })),
      // Same shape /api/give-amounts and /api/give-funds already publish, so
      // the blocks and the hardcoded fallback page read identical objects.
      give: {
        baseUrl: (giveUrlRow && giveUrlRow.value) || '',
        tiers: giveTiers.map((r) => ({ amount: r.amount, url: r.url || '', isDefault: !!r.is_default })),
        funds: giveFunds.map((r) => ({ id: r.id, name: r.name, tithelyFundId: r.tithely_fund_id || '', isDefault: !!r.is_default })),
      },
      // The market application block reads this — see admin/market.js and the
      // 'marketapp' branch in renderBlock(). No payment address is in it: the
      // fund and the base link are resolved from `give` above, at the moment
      // an application is actually submitted, never stored in a block.
      market: eventFeeConfig(marketEventRow, (giveUrlRow && giveUrlRow.value) || ''),
      // Every event, shaped for the generic `registration` block — see
      // admin/events.js and the 'registration' branch in renderBlock().
      // Keyed by event id so a block's own `eventId` field is a direct
      // lookup. The market is included (its `hasRegistration` reads true on
      // the row, but it never actually gets a `registration` block — it
      // keeps `marketapp` — so this only matters for the event picker
      // listing it by name).
      eventsById: Object.fromEntries((allEventRows || []).map((ev) => [ev.id, {
        id: ev.id, name: ev.name,
        hasRegistration: !!Number(ev.has_registration), hasPayment: !!Number(ev.has_payment),
        registrationOpen: !!Number(ev.registration_open ?? 1),
        dateLabel: ev.date_label || '', coordinatorEmail: ev.coordinator_email || '',
        feeConfig: Number(ev.has_payment) ? eventFeeConfig(ev, (giveUrlRow && giveUrlRow.value) || '') : null,
      }])),
      eventFieldsById: (allEventRows || []).reduce((acc, ev) => {
        acc[ev.id] = (allEventFieldRows || []).filter((f) => f.event_id === ev.id).map((f) => ({
          key: f.key, label: f.label, kind: f.kind, required: !!Number(f.required),
          placeholder: f.placeholder || '', hint: f.hint || '',
          options: (() => { try { const o = JSON.parse(f.options || '[]'); return Array.isArray(o) ? o : []; } catch (_) { return []; } })(),
        }));
        return acc;
      }, {}),
    };
  })();
  if (reqKey) PAGE_DATA_CACHE.set(reqKey, p);
  return p;
}

// ── THE PAYROLL PERIOD LOCK ──────────────────────────────────
// Returns the refusal message when a period has been signed off, or '' when
// the write may go through. Approval is a row in `payroll_periods`: present
// means somebody put their name to those figures.
//
// ⚠ It FAILS CLOSED — an unreadable period, an unreachable Supabase, or a
// body we cannot parse all refuse. A refusal costs a retry and says so on the
// screen; the other way round quietly rewrites figures somebody has already
// signed. That asymmetry is the whole reason the lock exists.
//
// It reuses the caller's own `apikey`/`Authorization`, because this Worker
// holds no Supabase credentials of its own — see "Payroll & Supabase" in
// CLAUDE.md. Same credentials, same authority, one extra read.
//
// ⚠ Reads through the `payroll_get_period_approval` RPC, not a direct
// `payroll_periods` REST call — since the 2026-08-12 Supabase migration
// closed `anon`'s table grants, a direct read here would 401 exactly the
// same way the browser's own reads did. See "the payroll_* RPC functions"
// below; the shared secret comes from this Worker's own env, never the
// browser.
async function payrollPeriodLocked(baseUrl, period, headers, secret) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(period || ''))) {
    return 'That save could not be checked against the period’s approval, so it was not written. Reload the page and try again.';
  }
  const check = new Headers();
  for (const h of ['apikey', 'authorization']) {
    const v = headers.get(h);
    if (v) check.set(h, v);
  }
  check.set('content-type', 'application/json');
  try {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/payroll_get_period_approval`, {
      method: 'POST',
      headers: check,
      body: JSON.stringify({ p_period_start: period, p_secret: secret || '' }),
    });
    if (!res.ok) return 'The period’s approval could not be read, so nothing was saved. Try again in a moment.';
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) {
      return 'This pay period has been approved, so its hours are locked. Take back the approval first if something needs changing.';
    }
    return '';
  } catch (_) {
    return 'The period’s approval could not be read, so nothing was saved. Try again in a moment.';
  }
}

// CSRF defense: only these POST paths are reachable from outside the admin
// origin (the public site at timothystl.org POSTs to them). Every other
// state-changing request must originate from admin.timothystl.org itself.
const ADMIN_ORIGIN = 'https://admin.timothystl.org';

// ── THE RENTER PORTAL'S OWN ORIGIN ───────────────────────────
// The gym booking portal is the one page in this Worker that renders
// renter-supplied content and is handed to people outside the church. Served
// on the admin origin it was same-origin with the admin — and same-origin is
// the whole security boundary here: the CSP allows 'unsafe-inline', and the
// Origin gate below cannot tell a portal script from an admin one, so an
// injection in the portal could act with a signed-in admin's session. Moving
// it to the public site origin means the worst a portal bug can do is happen
// on a page where nobody is signed in to anything.
//
// ⚠ Read from `gym_portal_origin`, and BLANK IS THE SAFE DEFAULT: the
// Cloudflare route (timothystl.org/gym/* → tlc-newsletter-admin) has to exist
// before anything is sent there, and code deploys before somebody adds a
// route. Until it is set, everything behaves exactly as it did.
const PORTAL_PATHS = ['/gym/book/', '/gym/cal/'];
const isPortalPath = (p) => PORTAL_PATHS.some((prefix) => p.startsWith(prefix));

async function portalOrigin(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_portal_origin'").first();
    const raw = String(row?.value || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    const u = new URL(raw);
    // Anything but http(s) here would be a link the office hands to renters,
    // so it is dropped rather than half-honored.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch (_) { return ''; }
}
// `/api/tap-hit` is called server-to-server by site-worker.js when it resolves
// one of the /tapN short addresses, so it has no Origin to check against.
const PUBLIC_CROSS_ORIGIN_POSTS = new Set(['/api/contact', '/api/prayer', '/api/subscribe', '/api/tap-hit', '/api/push/notify', '/api/push/subscribe-public', '/api/push/unsubscribe-public', '/api/market/apply', '/api/events/register']);

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
    'SELECT subject, pastor_note, wol_content, lasm_content, secondary_note, published_at, format, cta_url, cta_label, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes, news_item_ids, extra_notes FROM newsletters WHERE id = ?'
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

  const emailHtml = buildEmailHtml(row.subject, row.pastor_note, eventsRows.results, row.wol_content || '', row.lasm_content || '', row.published_at, selectedNewsItems, row.secondary_note || '', id, row.format || 'weekly', row.cta_url || '', row.cta_label || '', row.tertiary_note || '', row.tertiary_cta_label || '', row.tertiary_cta_url || '', JSON.parse(row.bible_classes || '[]'), parseExtras(row.extra_notes));
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

// ⚠ The staff photo crop guards used to be defined here as well as in the
// renderer, and a crop is exactly the kind of thing two copies come to disagree
// about — one accepting a value the other rejects means the admin's preview and
// the published page frame the same face differently. They live in
// admin/blocks.js now and are imported above; do not add a local copy back.

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

// ── SAMPLE PHOTOS ON A VENDOR APPLICATION ────────────────────
// Up to five, from a public form, stored straight to R2 alongside every other
// uploaded image.
//
// ⚠ THERE IS NO PUBLIC UPLOAD ENDPOINT, AND THAT IS THE DESIGN. /api/upload-image
// is behind the session gate; opening a public sibling would be a way for
// anyone on the internet to host arbitrary files on the church's domain
// forever, with no application attached. The files ride along inside the
// application POST instead, so a photo can only be stored by somebody who also
// filled in a screened, saved application.
//
// ⚠ NOTHING HERE THROWS. Photos are optional and encouraged, and the design is
// explicit that they must never block a submission — so a file that is too
// large, the wrong type, or that R2 refuses is simply not among the ones
// returned. A maker whose phone produced a 12MB HEIC still gets their table.
const MARKET_MAX_PHOTOS = 5;
const MARKET_MAX_PHOTO_BYTES = 8 * 1024 * 1024;
async function storeMarketPhotos(env, request, form) {
  const urls = [];
  let files = [];
  try { files = form.getAll('photos').filter((f) => f && typeof f !== 'string' && f.size > 0); } catch (_) { return urls; }
  for (const file of files.slice(0, MARKET_MAX_PHOTOS)) {
    try {
      if (file.size > MARKET_MAX_PHOTO_BYTES) continue;
      const mime = (file.type || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(mime)) continue;
      const key = `market-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ALLOWED_IMAGE_TYPES.get(mime)}`;
      // Same EXIF strip every other upload goes through (B6). It matters more
      // here than anywhere else on the site: these come off a maker's phone,
      // in their kitchen or workshop, and the GPS in them is their home
      // address — which would then sit on a public URL forever.
      const clean = stripImageMetadata(new Uint8Array(await file.arrayBuffer()));
      await env.IMAGES.put(key, clean, { httpMetadata: { contentType: mime } });
      urls.push(`${new URL(request.url).origin}/images/${key}`);
    } catch (e) {
      console.error('Market photo upload skipped:', e?.message);
    }
  }
  return urls;
}

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

// A value's photo, on the Values edit form. Deliberately simpler than the
// staff picture picker just above — a landscape card field has no face to
// recenter, so this is upload + preview + remove, nothing to drag.
function valuePhotoFieldHtml(existingUrl = '') {
  const safe = escapeHtml(existingUrl || '');
  return `<div class="form-group">
        <label>Photo</label>
        <input type="hidden" name="photo_url" id="value_photo_url_val" value="${safe}">
        <div id="value-photo-preview" style="${existingUrl ? '' : 'display:none;'}margin-bottom:8px;width:220px;height:130px;border-radius:10px;overflow:hidden;background:#EDF2F6;">
          ${existingUrl ? `<img src="${safe}" style="width:100%;height:100%;object-fit:cover;">` : ''}
        </div>
        <input type="file" id="value_photo_file" accept="image/jpeg,image/png,image/webp" style="font-size:13px;">
        <div id="value-photo-status" style="font-size:12px;color:var(--gray);margin-top:4px;"></div>
        <button type="button" id="value-photo-remove" style="${existingUrl ? '' : 'display:none;'}margin-top:6px;font-size:12px;background:none;border:none;color:#B85C3A;cursor:pointer;padding:0;">Remove photo</button>
      </div>
      ${valuePhotoUploadScript()}`;
}

function valuePhotoUploadScript() {
  return `<script>
(function() {
  function compressToWebp(file) {
    return new Promise(function(resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        // A card field is drawn wide, not a headshot — 1600px keeps it sharp
        // full-bleed on a desktop without shipping an untouched phone photo.
        var maxDim = 1600;
        var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        var w = Math.max(1, Math.round(img.naturalWidth * scale));
        var h = Math.max(1, Math.round(img.naturalHeight * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) {
          if (blob && blob.type === 'image/webp' && blob.size > 0) {
            resolve(new File([blob], 'value-photo.webp', { type: 'image/webp' }));
          } else {
            resolve(file);
          }
        }, 'image/webp', 0.85);
      };
      img.onerror = function() { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  document.getElementById('value_photo_file').addEventListener('change', async function() {
    var rawFile = this.files[0];
    if (!rawFile) return;
    var status = document.getElementById('value-photo-status');
    status.textContent = 'Uploading…';
    var file = await compressToWebp(rawFile);
    var fd = new FormData();
    fd.append('file', file);
    try {
      var r = await fetch('/api/upload-image', { method: 'POST', body: fd });
      var j = await r.json();
      if (j.url) {
        document.getElementById('value_photo_url_val').value = j.url;
        var prev = document.getElementById('value-photo-preview');
        prev.innerHTML = '<img src="' + j.url + '" style="width:100%;height:100%;object-fit:cover;">';
        prev.style.display = '';
        document.getElementById('value-photo-remove').style.display = '';
        status.textContent = 'Uploaded';
        status.style.color = '';
      } else {
        status.textContent = j.error || 'Upload failed';
        status.style.color = '#B85C3A';
      }
    } catch (e) {
      status.textContent = 'Upload failed — try again';
      status.style.color = '#B85C3A';
    }
  });

  document.getElementById('value-photo-remove').addEventListener('click', function() {
    document.getElementById('value_photo_url_val').value = '';
    document.getElementById('value-photo-preview').style.display = 'none';
    document.getElementById('value-photo-preview').innerHTML = '';
    document.getElementById('value_photo_file').value = '';
    document.getElementById('value-photo-status').textContent = '';
    this.style.display = 'none';
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
      // AW-1: this used to return the full stack to EVERY caller. The comment
      // said "admin portal is staff-only", but this handler also wraps the
      // login page and the public POST endpoints — /api/contact, /api/prayer,
      // /api/subscribe — which anyone on the internet can reach. A stack trace
      // names files, line numbers and often the shape of a query.
      //
      // The detail still exists; it goes to the log, where the person who
      // needs it can get at it and a stranger cannot.
      console.error('Admin worker error:', detail);
      const ref = crypto.randomUUID().slice(0, 8);
      console.error('Admin worker error ref:', ref);
      return new Response(
        'Something went wrong. Please try again, or send this reference to the site administrator.\n\n'
        + 'Reference: ' + ref + '\n',
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
      // ── WHAT THIS PROXY WILL FORWARD, AND NOTHING ELSE ──
      // It used to forward any path under /sb/ to Supabase with the caller's
      // key — an authenticated open relay onto the whole project (AW-7 in the
      // July 2026 review). Much reduced once the 2026-08-12 migration left
      // `anon` with no direct grant on any payroll table, but "the credential
      // happens not to be able to do much" is a weaker guarantee than "the
      // request was never forwarded", and it is one Supabase grant away from
      // failing.
      //
      // ⚠ THE LIST IS EXACTLY WHAT admin/payroll.html CALLS — the thirteen
      // payroll_* RPC functions, no more. A test reads the page and asserts
      // the two sets are identical in both directions, so adding a fourteenth
      // call without adding it here fails rather than 403ing in front of
      // somebody running payroll.
      //
      // ⚠ POST ONLY. PostgREST executes an RPC on GET too, so allowing the
      // method would put a payroll write one address bar away from a CSRF —
      // the Origin gate below only runs on non-GET.
      if (!(method === 'POST' && PAYROLL_RPC_PATHS.has(path))) {
        return new Response(JSON.stringify({ error: 'Not available.', code: 'PROXY_PATH_REFUSED' }), {
          status: 403,
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

      // ── the payroll_* RPC functions, and the shared secret that gates them ──
      // The 2026-08-12 Supabase migration (closing a real hole — the public
      // anon key could read and rewrite everyone's payroll) revoked `anon`'s
      // direct grants on church_staff, church_staff_period_entries,
      // payroll_periods and staff_pto_entries, with no replacement for the
      // one thing that legitimately needs anon-key access to them: this
      // proxy. `admin/payroll.html` now calls thirteen narrow
      // `SECURITY DEFINER` Postgres functions instead of those tables
      // directly (`payroll_get_staff`, `payroll_save_hours`, etc.) — same
      // shape as CHMS_INTAKE_API_KEY/ADMIN_PUSH_API_KEY: a shared secret
      // held only on this Worker's side, injected into the RPC body here,
      // never sent to or held by the browser. `anon` still has zero direct
      // grant on any of the four tables; only EXECUTE on these functions.
      let forwardBody = ['GET', 'HEAD'].includes(method) ? undefined : request.body;
      const isPayrollRpc = method === 'POST' && /^\/sb\/rest\/v1\/rpc\/payroll_/.test(path);
      let periodForLock = '';
      if (isPayrollRpc) {
        // Buffered rather than streamed — every payroll RPC call carries one
        // small JSON object of named params, and every one needs the secret
        // added before it leaves this Worker.
        const raw = await request.text();
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsed.p_secret = env.PAYROLL_PROXY_SECRET || '';
        }
        forwardBody = JSON.stringify(parsed);
        if (path === '/sb/rest/v1/rpc/payroll_save_hours') {
          periodForLock = String((parsed && parsed.p_period_start) || '');
        }
      }

      // ── THE PERIOD LOCK ──
      // Approving a payroll run is somebody signing off a set of figures. If
      // the hours can still change afterwards, the signature is on nothing.
      // The fix list is explicit that this is enforced HERE and not by hiding
      // the button — the screen grays the inputs as a courtesy, but a stale
      // tab, a second window, or a crafted POST all arrive at this line.
      // (The RPC function itself refuses the same write a second time, so a
      // caller that reaches Supabase by some other path still can't slip an
      // edit past an approval — belt and suspenders, not either/or.)
      //
      // Scoped to the period's own entries. Rates live on `church_staff` and
      // are not period-scoped, so locking those would stop the office fixing
      // a rate for a period they have not run yet.
      if (path === '/sb/rest/v1/rpc/payroll_save_hours') {
        // ⚠ Fails CLOSED. If we cannot tell whether the run was signed off, a
        // refusal costs a retry and says so; the other way round silently
        // rewrites approved figures. The message names the way out.
        const locked = await payrollPeriodLocked(MDO_SUPABASE_URL, periodForLock, outHeaders, env.PAYROLL_PROXY_SECRET || '');
        if (locked) {
          return new Response(JSON.stringify({ message: locked }), {
            status: 409,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ADMIN_ORIGIN },
          });
        }
      }

      // `duplex: 'half'` is required by the fetch spec whenever the body is a
      // stream. Workers does not enforce it and ignores the option; Node does
      // enforce it, and without it this proxy throws the moment a test drives
      // a POST through it — which is how it went untested until the period
      // lock needed covering.
      const proxyReq = new Request(targetUrl, {
        method, headers: outHeaders, body: forwardBody,
        ...(forwardBody && typeof forwardBody !== 'string' ? { duplex: 'half' } : {}),
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

      if (isPayrollRpc && supabaseRes.status === 403) {
        const bodyText = await supabaseRes.text();
        // ── FX-09: THE FINGERPRINT IS GONE ─────────────────────────────────
        // This used to widen an "invalid secret" 403 with the LENGTH and the
        // first and last six characters of PAYROLL_PROXY_SECRET. The reasoning
        // was sound at the time and is worth keeping written down: a Worker
        // secret is write-only from every tool that can reach this repo, so
        // when the two sides disagreed there was no other way to see which.
        //
        // That mismatch is resolved — the secret is set and was verified
        // against the live project — so what is left is a deliberate partial
        // disclosure of a secret with no remaining reason. Twelve of
        // sixty-four hex characters is not a practical break; it is simply not
        // something to leave in a response body once the question it answered
        // has been answered. What survives is the half that still helps and
        // reveals nothing: whether this Worker holds the secret AT ALL.
        if (/invalid secret/i.test(bodyText) && !env.PAYROLL_PROXY_SECRET) {
          return new Response(JSON.stringify({
            message: 'PAYROLL_PROXY_SECRET is not set on this Worker — see the Payroll section of CLAUDE.md for the wrangler command that sets it.',
          }), { status: supabaseRes.status, headers: resHeaders });
        }
        return new Response(bodyText, { status: supabaseRes.status, headers: resHeaders });
      }
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
        theme_color: '#1E2D4A',
        background_color: '#FAF7F1',
        display: 'standalone',
        start_url: '/',
      }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } });
    }

    // The service worker script. Must be served from the root so its default
    // scope covers the whole admin origin, not just one subpath — and served
    // early like the manifest and /assets/*, since it's a static string that
    // needs no D1 read. A short cache (unlike the immutable /assets/* files):
    // the browser already re-checks a registered SW's URL on every navigation
    // and treats a byte-for-byte-identical response as "nothing changed", so
    // there's no install-storm risk from staying short — and a long cache here
    // would mean a bug fix in this file taking up to a year to reach a device
    // that already installed the old one.
    if (path === '/sw.js' && method === 'GET') {
      return new Response(SERVICE_WORKER_JS, { headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Service-Worker-Allowed': '/',
      }});
    }

    // The VAPID public key the browser needs as `applicationServerKey` when
    // subscribing. Public by design — it's not a secret, only the matching
    // private key (which never leaves the Worker) can actually sign a push.
    //
    // ⚠ ACCESS-CONTROL-ALLOW-ORIGIN, ADDED WHEN THE PUBLIC PUSH TOGGLE ON
    // timothystl.org STARTED FETCHING THIS CROSS-ORIGIN. The admin's own PWA
    // has never needed it — that fetch is same-origin. Without it, a browser
    // still makes the request but refuses to hand the JS the response body,
    // which is a silently broken "Get browser alerts" button rather than a
    // visible error anywhere.
    if (path === '/api/push/vapid-public-key' && method === 'GET') {
      // Both branches, not just the happy one — a browser refuses to let the
      // caller read the response body of either without the header, and this
      // is the one case a public visitor is likely to actually hit before the
      // office finishes the VAPID setup.
      if (!env.VAPID_PUBLIC_KEY) return new Response('Push notifications are not configured.', { status: 501, headers: { 'Access-Control-Allow-Origin': '*' } });
      return new Response(env.VAPID_PUBLIC_KEY, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
    }

    // Cross-app push relay: a shared-secret-authenticated way for OTHER Workers
    // (today, connect.timothystl.org — the ChMS/scheduler repo) to ring the same
    // admin devices this repo's own four triggers already reach, without a
    // second push_subscriptions table or a second RFC 8291/8292 implementation.
    // Not a session route — the caller is a server, not a signed-in browser —
    // so it's gated by ADMIN_PUSH_API_KEY (same shared-secret pattern as
    // CHMS_INTAKE_API_KEY/X-Intake-Key, just the other direction) instead of a
    // cookie. It has to sit above the CSRF Origin gate for the same reason
    // /api/tap-hit does: a Worker-to-Worker fetch carries no Origin/Referer.
    if (path === '/api/push/notify' && method === 'POST') {
      if (!env.ADMIN_PUSH_API_KEY) return new Response(JSON.stringify({ error: 'Push relay not configured' }), { status: 503 });
      const key = request.headers.get('X-Push-Key') || '';
      if (key !== env.ADMIN_PUSH_API_KEY) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      let body;
      try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }
      const title = String(body?.title || '').slice(0, 200);
      const text = String(body?.body || '').slice(0, 500);
      if (!title || !text) return new Response(JSON.stringify({ error: 'title and body are required' }), { status: 400 });
      const payload = { title, body: text, tag: String(body?.tag || 'connect-notify').slice(0, 100) };
      if (body?.url) payload.url = String(body.url).slice(0, 500);
      ctx.waitUntil(pushToAllSubscribers(env, payload));
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Square's payment.updated webhook — the other half of the per-application
    // Checkout Link created in /api/market/apply, above. It has to sit above
    // the CSRF Origin gate for the same reason /api/push/notify does: Square's
    // server carries no Origin/Referer, so the gate would refuse it outright.
    //
    // ⚠ NOT `PUBLIC_CROSS_ORIGIN_POSTS` — that set is for a BROWSER's
    // cross-origin POST, which still carries an Origin header the gate checks
    // against ADMIN_ORIGIN/the gym portal's own origin. A server-to-server
    // callback is a different trust model entirely: it is authenticated by
    // Square's own HMAC signature (verifySquareSignature, admin/square.js),
    // not by which page happened to be open in a browser.
    if (path === '/api/square/webhook' && method === 'POST') {
      const rawBody = await request.text();
      const signature = request.headers.get('x-square-hmacsha256-signature') || '';
      const verified = await verifySquareSignature(env, ADMIN_ORIGIN + '/api/square/webhook', rawBody, signature);
      if (!verified) {
        console.error('Square webhook: signature did not verify');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
      let event;
      try { event = JSON.parse(rawBody); } catch { return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); }

      const payment = event?.type === 'payment.updated' ? event?.data?.object?.payment : null;
      const orderId = payment?.order_id || '';
      // ⚠ Anything other than a COMPLETED payment for a known order is
      // answered 200 and quietly ignored — that is not an error, it is a
      // payment that failed, or one that is not ours, or a Square event type
      // this route has no reason to act on. Square retries on anything but a
      // 2xx, and retrying an event this route was never going to act on
      // would just be Square hammering an endpoint for no reason.
      if (payment && payment.status === 'COMPLETED' && orderId) {
        const reg = await env.DB.prepare(
          'SELECT id, event_id, payment_status, amount_due_cents, contact_name FROM site_event_registrations WHERE square_order_id = ?'
        ).bind(orderId).first().catch(() => null);
        // ⚠ IDEMPOTENT ON PURPOSE. Square can and does redeliver the same
        // event; a registration already marked paid is left alone rather
        // than re-logged to the audit trail on every redelivery.
        if (reg && reg.payment_status !== 'paid') {
          const amountPaidCents = Number(payment?.amount_money?.amount);
          await updateRegistration(env, reg.id, {
            payment_status: 'paid',
            amount_paid_cents: Number.isFinite(amountPaidCents) ? amountPaidCents : reg.amount_due_cents,
          });
          await logAudit(env.DB, { username: 'square-webhook' }, 'update', 'market_vendor', String(reg.id), reg.contact_name,
            { payment_status: reg.payment_status }, { payment_status: 'paid' });
        }
      }
      // Square only cares about the status code — always 200 past the
      // signature check, whether or not anything matched, so a payment that
      // is not one of ours never looks like a failure worth retrying.
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
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
      // ⚠ A renter portal form posts from the PORTAL's origin, not the
      // admin's. Without this the whole booking flow 403s the moment the
      // portal moves — a hold request, a release, a confirmation, all of it,
      // and it would read as "the portal is broken" with nothing to go on.
      // The property that matters is kept: a request must come from the page
      // it belongs to. The portal origin is accepted for portal paths only.
      const allowed = [ADMIN_ORIGIN];
      if (isPortalPath(path)) {
        const po = await portalOrigin(env);
        if (po) allowed.push(po);
      }
      const ok = allowed.includes(origin)
        || (!origin && allowed.some((a) => referer.startsWith(a + '/')));
      if (!ok) {
        return new Response('Cross-origin request blocked.', { status: 403 });
      }
    }

    // One chokepoint, not a call in every handler: any POST that could change
    // what /api/pages says — a page, the menu, the church details — busts the
    // edge copy. Over-busting (a draft save, a refused POST) costs one
    // rebuild; a missed bust would cost a stale public site, and the route
    // list under these prefixes keeps growing.
    // `/partners` joined the list once a Partner logos block started reading
    // that record: uploading a logo changes what a published page renders
    // without any page itself being touched, so without this the new logo
    // would sit behind the edge copy until it aged out on its own. `/values`
    // is the identical case — editing a value's wording or photo changes the
    // self-filling Core values block on every page carrying one.
    //
    // ── FX-19: THE LIST WAS SHORTER THAN THE CLAIM ABOVE IT ────────────────
    // The comment said "any POST that could change what /api/pages says" and
    // the list was four prefixes. `pageData()` is fed by a great deal more than
    // that, and every one of those rows is rendered INTO the payload by a
    // self-filling block — so editing a staff member, a giving amount, a Bible
    // class, a sermon, a news post or a market setting changed what a published
    // page renders while the edge went on serving the copy from before.
    //
    // ⚠ The staleness was not the 120s of the response's own max-age. It was
    // that PLUS up to 300s in site-worker.js's own per-isolate `pagesCache` —
    // about seven minutes, which is long enough to read as "my edit did not
    // save" and go round again.
    //
    // Over-busting costs one rebuild of a cached response. Under-busting costs
    // a public site that disagrees with the admin, so when in doubt the prefix
    // goes in the list.
    const PAGE_DATA_PREFIXES = [
      '/pages', '/menu', '/partners', '/values',   // the page tree and the chrome
      '/staff',                                    // → the Staff grid block
      '/giving',                                   // → Giving widget, Amount ladder
      '/christian-education',                      // → Bible classes block
      '/sermons',                                  // → Sermon library, the homepage card
      '/newsitems',                                // → News feed, News highlights
      '/market',                                   // → Market facts, Market application
      '/events',                                   // → Registration block
    ];
    if (method === 'POST' && PAGE_DATA_PREFIXES.some((pre) => path.startsWith(pre))) {
      bustPagesCache(ctx);
    }

    // ── PUBLIC: the shared admin shell CSS/JS, externalised ──
    // This used to be inlined into every admin page's <style>/<script> — a
    // response cached `private, max-age=10`, so the browser re-fetched and
    // re-parsed the whole thing on every click. It is a fixed string that
    // only changes on deploy, so it is served on its own, cached for a year,
    // and busted by the `?v=VERSION` query string html() already appends.
    // Placed here, ahead of the schema gate, same as the /sb/ proxy above —
    // a static string needs no D1 access at all.
    if (path === '/assets/admin.css' && method === 'GET') {
      return new Response(ADMIN_SHELL_CSS, { headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Robots-Tag': 'noindex, nofollow',
      }});
    }
    // ── FX-17: THE BLOCK STYLESHEET, ON THE PUBLIC PATH ──
    // 85KB that used to travel inline on every published page and again inside
    // the /api/pages JSON. Same treatment the admin's own CSS already gets, with
    // one difference: this one is fetched CROSS-ORIGIN, by timothystl.org, so it
    // needs the CORS header the others do not.
    if (path === '/assets/blocks.css' && method === 'GET') {
      return new Response(BLOCK_CSS_RAW, { headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-Robots-Tag': 'noindex, nofollow',
      }});
    }
    if (path === '/assets/admin.js' && method === 'GET') {
      return new Response(ADMIN_SHELL_JS, { headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Robots-Tag': 'noindex, nofollow',
      }});
    }

    // ── PUBLIC: self-hosted TinyMCE ──
    // The editor used to come from cdn.tiny.cloud against an account API key.
    // That build is metered per "editor load" and bills overage past the
    // monthly limit, so the files are served out of this repo instead — free
    // (GPL v2+), no key, no cap. See TINYMCE_HEAD in admin/db.js.
    //
    // Same shape as the ChMS app's own /admin/vendor/tinymce/ route: proxied
    // from this public repo rather than inlined as string constants the way
    // admin.css/admin.js above are, because 1.4 MB of editor across sixteen
    // files is not something to carry in the Worker bundle. Same-origin to the
    // browser either way, so the CSP needs no third-party allowance.
    // Placed here with the other static assets, ahead of the schema gate — it
    // needs no D1 access at all.
    //
    // ⚠ The VERSION is in the path (/assets/tinymce/7.9.3/...), and it has to
    // be. TinyMCE fetches its own theme/model/icons/skin/plugins from base_url
    // WITHOUT any query string, and everything here is served `immutable` for a
    // year — so with an unversioned path an upgrade would bust tinymce.min.js
    // via ?v= and leave every browser running a year-old theme against the new
    // core. A versioned path changes every URL at once. The version segment is
    // stripped before the upstream lookup, since the repo holds one copy.
    if (path.startsWith('/assets/tinymce/') && method === 'GET') {
      let rel = path.slice('/assets/tinymce/'.length);
      const versioned = /^(\d+\.\d+\.\d+)\/(.*)$/.exec(rel);
      if (versioned) {
        if (versioned[1] !== TINYMCE_VERSION) return new Response('Not found', { status: 404 });
        rel = versioned[2];
      }
      // Allowlist the shape, not the filenames: TinyMCE fetches its own
      // theme/model/icons/skin/plugin paths by convention, so they can't be
      // enumerated here — but this must not become a general proxy for the
      // repo either.
      if (rel.includes('..') || !/^[\w./-]+\.(js|css)$/.test(rel)) {
        return new Response('Not found', { status: 404 });
      }
      const upstream = await fetch(
        'https://raw.githubusercontent.com/timothystl/website/main/admin/vendor/tinymce/' + rel,
        { cf: { cacheEverything: true, cacheTtl: 86400 } },
      );
      if (!upstream.ok) return new Response('Not found', { status: 404 });
      return new Response(upstream.body, { headers: {
        'Content-Type': rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Robots-Tag': 'noindex, nofollow',
      }});
    }

    // ── SCHEMA GATE ──
    // The block below runs ~140 idempotent CREATE/ALTER/INSERT statements.
    // On a stable schema each one is a no-op, but they're still ~140 D1
    // subrequests per admin request — that's where the 5–10s "slow but
    // works" latency comes from. Gate the whole block behind ONE read of
    // _schema_version. Bump SCHEMA_VERSION any time the migrations below
    // change so the next request after deploy re-runs them and rewrites
    // the marker.
    //
    // ⚠ ONE read for all five markers, and none at all once this binding has
    // been seen current. The version gate and the four one-time seeds below
    // each did their own serial SELECT — five D1 round-trips ahead of routing
    // on EVERY request, including /images/* and every public API call the
    // homepage makes. The whole table is a handful of rows, so it is read
    // once into a Map; see MARKERS_SEEN above for why the memo is keyed on
    // env.DB and only ever set when no work ran.
    const SCHEMA_VERSION = '2026-08-19-6'; // bumped: push_subscriptions.audience, so a broadcast can reach the congregation without also ringing every staff device
    const markersOk = MARKERS_SEEN.get(env.DB) === SCHEMA_VERSION;
    const markers = new Map();
    if (!markersOk) {
      try {
        const rows = await env.DB.prepare('SELECT key, value FROM _schema_version').all();
        for (const r of (rows.results || [])) markers.set(r.key, r.value);
      } catch (_) { /* _schema_version table may not exist yet */ }
    }
    const schemaOk = markersOk || markers.get('version') === SCHEMA_VERSION;

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
    // Gift vs Payment (phase 7). A Gift is receipted as a donation at year end;
    // a Payment — gym rent, a registration fee, a vendor invoice — is not.
    // Defaults to 'payment' because every row that exists today is a vendor or
    // market link, and because the two mistakes are not equal: wrongly
    // receipting a non-donation as tax-deductible is the more serious one.
    try { await env.DB.prepare("ALTER TABLE redirects ADD COLUMN give_kind TEXT NOT NULL DEFAULT 'payment'").run(); } catch (_) {}
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
    // ── NFC TAPS ──
    // Four physical tags, each holding nothing but its own short address
    // (/tap1…/tap4). Everything a visitor sees is the cards behind it, so
    // re-pointing a tap here changes where a tag handed out a year ago lands —
    // without anybody reprogramming the tag.
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS taps (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        placement TEXT DEFAULT '',
        destination TEXT NOT NULL,
        scans INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      )`).run();
    } catch (_) {}
    // One row per tap per day. `taps.scans` is the lifetime total and cannot
    // answer "this month", which is the only question the screen asks; one row
    // per hit would answer everything and grow without bound for a number
    // nobody will slice that finely. See admin/taps.js.
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS tap_hits (
        tap_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tap_id, day)
      )`).run();
    } catch (_) {}
    // The tap a card belongs to. NULL means "shows on every tap", which is the
    // right default for the cards that existed before taps did — they were all
    // on the one link page.
    try { await env.DB.prepare('ALTER TABLE link_cards ADD COLUMN tap INTEGER').run(); } catch (_) {}
    // What a card does: open a link, or be a form the visitor fills in here.
    // Defaulting to 'link' is what every existing row already was.
    try { await env.DB.prepare("ALTER TABLE link_cards ADD COLUMN kind TEXT DEFAULT 'link'").run(); } catch (_) {}
    for (const t of TAP_SEED) {
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO taps (id, name, placement, destination, active) VALUES (?, ?, ?, ?, 1)')
          .bind(t.id, t.name, t.placement, t.destination).run();
      } catch (_) {}
    }

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
    try { await env.DB.prepare(DB_INIT_CALENDAR_CATEGORIES).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_CALENDAR_CATEGORIES_COLOR).run(); } catch (_) {}
    // Seeded from the shipped list, INSERT OR IGNORE, so editing a category is
    // never undone by a deploy and the table matches the site on day one.
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      const c = DEFAULT_CATEGORIES[i];
      try {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO calendar_categories (key, name, color_id, palette, sort_order, active) VALUES (?,?,?,?,?,1)'
        ).bind(c.key, c.name, c.colorId || null, CAL_SEED_PALETTE[c.key] || 'gray', i).run();
      } catch (_) {}
    }
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
    // Media (phase 9): the size actually stored, so the Media screen can flag
    // anything over 1MB without re-reading every object out of R2.
    try { await env.DB.prepare('ALTER TABLE ministry_media ADD COLUMN bytes INTEGER DEFAULT 0').run(); } catch (_) {}
    // audit_log.user_id was NOT NULL while logAudit binds null for anything the
    // system did on its own (a scheduled publish, a lapsed hold). The INSERT
    // threw, logAudit swallowed it, and those actions were simply missing from
    // the log — which matters most now that the log is something you can roll
    // back from. SQLite cannot drop NOT NULL in place, so the table is rebuilt.
    try {
      const info = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_log'").first();
      if (info && /user_id\s+INTEGER\s+NOT NULL/i.test(info.sql || '')) {
        await env.DB.prepare('ALTER TABLE audit_log RENAME TO audit_log_old').run();
        await env.DB.prepare(DB_INIT_AUDIT_LOG).run();
        await env.DB.prepare('INSERT INTO audit_log (id, user_id, username, action, entity_type, entity_id, entity_label, before_state, after_state, created_at) SELECT id, user_id, username, action, entity_type, entity_id, entity_label, before_state, after_state, created_at FROM audit_log_old').run();
        await env.DB.prepare('DROP TABLE audit_log_old').run();
      }
    } catch (_) { /* leave the old table in place rather than lose the history */ }
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)').run(); } catch (_) {}
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
      // ⚠ status stays 'published' here, same as every extracted page —
      // NOT 'draft'. The menu_items seed already points a header AND footer
      // entry at page_id 'news' (it has for as long as the Menu editor has
      // existed), and publicMenu() in admin/menu.js drops a menu item to a
      // non-published page as broken, which would have taken "News & Events"
      // out of the live site's navigation entirely the moment this migration
      // ran. What actually keeps this page from rendering from blocks before
      // anyone presses Publish is `published_blocks` staying NULL below —
      // the same mechanism every other seeded page already relies on.
      // GIVE_LANDING_PAGE is give.timothystl.org, which has never been part of
      // the SPA and so was never reachable by the extractor. It rides the same
      // seed-and-refresh path as every other page, which means the same
      // guarantee: the blocks land in the DRAFT and `published_blocks` stays
      // empty, so the live donation page is untouched until somebody presses
      // Publish. See admin/give-landing-seed.js.
      // ⚠ The authored blocks replace the EXTRACTED ones for these pages, and
      // only the blocks. A page's title, address, menu placement and layout
      // stay generated — those are facts about the site's structure that the
      // extractor gets right and that nobody should maintain twice. Only the
      // content is the part a designer wrote.
      //
      // Everything below still lands in the DRAFT: `published_blocks` stays
      // NULL, so the live site renders its hardcoded markup until somebody
      // opens each page, reads the draft against the page it replaces, and
      // presses Publish. On these four in particular that is not a formality —
      // they are the most visited pages on the site, the language is new, and
      // there are no photographs yet.
      const ALL_SEEDED_PAGES = [...SITE_PAGES, NEWS_PAGE_SEED, VALUES_PAGE_SEED, GIVE_LANDING_PAGE, ...MARKET_SEEDED_PAGES]
        .map((p) => (REDESIGN_BLOCKS[p.id] ? { ...p, blocks: REDESIGN_BLOCKS[p.id] } : p));
      for (const p of ALL_SEEDED_PAGES) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO pages (id, title, menu_label, slug, parent_id, sort, template, status, in_menu, seo_description, blocks, updated_at, updated_by) ' +
          "VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, 'migration')"
        ).bind(p.id, p.title, p.menu_label || '', p.slug, p.parent_id, p.sort, p.template, p.in_menu,
               p.seo_description || '', JSON.stringify(sanitizeBlocks(p.blocks)), now).run();
      }

      // Improving the converter produces a better draft for a page that is
      // already a row, and INSERT OR IGNORE above would never deliver it. So
      // refresh the draft — but only for pages nobody has touched: still
      // stamped 'migration' and never published. A page someone has edited or
      // put live keeps exactly what it has.
      for (const p of ALL_SEEDED_PAGES) {
        const row = await env.DB.prepare('SELECT id, updated_by, published_blocks FROM pages WHERE id = ?').bind(p.id).first();
        if (!canReseed(row)) continue;
        await env.DB.prepare("UPDATE pages SET blocks = ?, updated_at = ?, updated_by = 'migration' WHERE id = ?")
          .bind(JSON.stringify(sanitizeBlocks(p.blocks)), now, p.id).run();
      }
    } catch (e) { console.error('Site page seed failed:', e && e.message); }

    // Public form intake + spam screening (see admin/forms.js)
    try { await env.DB.prepare(DB_INIT_FORM_SUBMISSIONS).run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_form_submissions_status ON form_submissions(status, created_at DESC)').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_form_submissions_ip ON form_submissions(ip, created_at)').run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_PUSH_SUBSCRIPTIONS).run(); } catch (_) {}
    // Two audiences in one table: `staff` (the default, every existing row and
    // every one of the six triggers that were already here) and `public` (the
    // congregation, added so a broadcast can reach them without also ringing
    // every staff phone — see "Push Alert" in CLAUDE.md and the comment on
    // pushToAllSubscribers in admin/webpush.js). SQLite backfills a non-null
    // DEFAULT onto every existing row when a column is added, so this alone —
    // no UPDATE needed — is what makes every subscription already on file a
    // staff one, exactly as it always behaved.
    try { await env.DB.prepare("ALTER TABLE push_subscriptions ADD COLUMN audience TEXT NOT NULL DEFAULT 'staff'").run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_push_subscriptions_audience ON push_subscriptions(audience)').run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_PAYROLL_READY_NOTIFIED).run(); } catch (_) {}

    // Performance indexes
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_news_items_publish_date ON news_items(publish_date)').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_ministry_posts_slug ON ministry_posts(ministry_slug)').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_events_newsletter_id ON events(newsletter_id)').run(); } catch (_) {}

    // ── v3.0.0 OVERHAUL ──
    // Core-value tagging. One nullable column per table that carries a value,
    // holding 'acceptance' | 'worship' | 'education' | 'outreach'. Nullable on
    // purpose: an untagged row is a normal state, and back-filling guesses
    // would put words in the church's mouth.
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN value TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE news_items ADD COLUMN value TEXT').run(); } catch (_) {}
    // ⚠ WHAT A POST IS ON THE CALENDAR, said outright rather than guessed from
    // the value tag. The four values only ever reached three of the calendar's
    // categories, so a post could never be marked as a meeting or a rehearsal —
    // it silently became "Special events". Blank still means "work it out from
    // the value tag", so nothing already written changes.
    try { await env.DB.prepare('ALTER TABLE news_items ADD COLUMN calendar_category TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE bible_classes ADD COLUMN value TEXT').run(); } catch (_) {}
    // Menu visibility, separate from published state. Taking a ministry out of
    // the header must not unpublish it — the page stays live at its address,
    // it just stops being listed. The old admin conflated the two.
    try { await env.DB.prepare('ALTER TABLE youth_pages ADD COLUMN in_menu INTEGER DEFAULT 1').run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_PARTNERS).run(); } catch (_) {}
    // The partner's logo, uploaded on the Partners screen. It lives on the
    // RECORD rather than in whichever block happens to show it: the same
    // partner appears in the footer's Partners column, on the values page and
    // in any Partner logos block, and a logo typed into one of those is a logo
    // the other two never get. Nullable — a partner with no logo falls back to
    // its name, which is what the block already did.
    try { await env.DB.prepare('ALTER TABLE partners ADD COLUMN logo_url TEXT').run(); } catch (_) {}
    // Short links (phase 3). Nullable on purpose: the link is derived from the
    // last segment of the address so it cannot drift when a page is renamed.
    // This column is only ever set by hand, and only to resolve a clash.
    try { await env.DB.prepare('ALTER TABLE pages ADD COLUMN short_link TEXT').run(); } catch (_) {}
    // ⚠ Every `ALTER TABLE pages` lives HERE, one per line, each with its own
    // catch — never inside the bigger `try` that seeds the page rows. In that
    // block an ALTER sits after three CREATEs and before a loop of INSERTs, so
    // anything above it throwing skips the column silently and the outer catch
    // just logs "Site page seed failed". The table then works for every query
    // except the ones naming that column, which is a fault that hides for
    // months and surfaces as one screen mysteriously empty.
    //
    // owner_username was in that block; this is the same statement, moved.
    // It is a no-op on any database that already has the column.
    try { await env.DB.prepare('ALTER TABLE pages ADD COLUMN owner_username TEXT').run(); } catch (_) {}
    // A page that stands in for somewhere else — /mdo is in the menu and in the
    // sitemap but sends the visitor to mdo.timothystl.org. Held on the page
    // rather than as a loose redirect so the menu can point at it by page id
    // and a rename needs nothing else changed.
    try { await env.DB.prepare('ALTER TABLE pages ADD COLUMN external_url TEXT').run(); } catch (_) {}
    // How far the sidebar/sectionside aside starts below the top of the two
    // columns — 0..96 in 8px steps, the same range a block's own spaceAbove
    // carries, so the aside can be pushed down to line up with a content
    // column whose first block has spacing of its own. NOT NULL DEFAULT 0: an
    // existing page reads as "flush", which is what every one of them already
    // renders as today.
    try { await env.DB.prepare('ALTER TABLE pages ADD COLUMN aside_top INTEGER NOT NULL DEFAULT 0').run(); } catch (_) {}
    // The four core values' office-editable words and photo — see the note on
    // core_values in admin/db.js for why the design tokens are not columns
    // here. Seeded EMPTY, deliberately: every column is NULL until an office
    // account fills one in, and mergedValues() reads a NULL column as "use
    // the hardcoded default", so this migration changes nothing about how the
    // site looks the day it runs.
    try { await env.DB.prepare(DB_INIT_CORE_VALUES).run(); } catch (_) {}
    try {
      for (const v of VALUES) {
        await env.DB.prepare('INSERT OR IGNORE INTO core_values (key) VALUES (?)').bind(v.key).run();
      }
    } catch (_) {}
    // The navigation (phase 4). One row per appearance in a menu — see the note
    // at the top of admin/menu.js for why this is a join table rather than more
    // columns on `pages`. Seeded from the nav as it stands today, with explicit
    // ids and INSERT OR IGNORE, so rearranging it in the admin survives deploys.
    // Newsletter composer (phase 5). All nullable — an issue written before
    // these existed must still open and still send exactly as it did.
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN preheader TEXT').run(); } catch (_) {}
    try { await env.DB.prepare("ALTER TABLE newsletters ADD COLUMN audience TEXT DEFAULT 'everyone'").run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN blocks TEXT').run(); } catch (_) {}
    // A fourth and fifth free-form note. JSON rather than more columns, because
    // how many notes an issue carries is a property of the issue — a week
    // needing three extras should not need a migration. See admin/newsletter.js.
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN extra_notes TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN sent_at TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('ALTER TABLE newsletters ADD COLUMN sent_count INTEGER').run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_MENU_ITEMS).run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items(menu, sort_order)').run(); } catch (_) {}
    for (const m of MENU_SEED) {
      try {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO menu_items (id, menu, label, kind, page_id, target, style, depth, sort_order, visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
        ).bind(m.id, m.menu, m.label || null, m.kind, m.page_id || null, m.target || null, m.style || 'link', m.depth || 0, m.sort_order).run();
      } catch (_) {}
    }
    // ── [AC-7] INDEXES ON THE COLUMNS THAT ARE ACTUALLY FILTERED ──
    // Named in the July 2026 review and never added. Every one of these backs a
    // WHERE or ORDER BY that runs on a screen somebody opens daily; without
    // them each is a full table scan, which is invisible at today's row counts
    // and is exactly the kind of thing that degrades quietly as they grow.
    for (const ix of [
      'CREATE INDEX IF NOT EXISTS idx_gym_bookings_status_date ON gym_bookings(status, booking_date)',
      'CREATE INDEX IF NOT EXISTS idx_gym_bookings_group_date ON gym_bookings(group_id, booking_date)',
      'CREATE INDEX IF NOT EXISTS idx_gym_invoices_group ON gym_invoices(group_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_news_items_dates ON news_items(publish_date, expire_date, pinned)',
      'CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at, entity_type)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions(created_at)',
    ]) {
      try { await env.DB.prepare(ix).run(); } catch (_) {}
    }

    // [B5] When a session was last used, for the idle timeout in admin/auth.js.
    try { await env.DB.prepare('ALTER TABLE sessions ADD COLUMN last_activity TEXT').run(); } catch (_) {}

    // ── [B1] THE GYM SLOT LOCK ──
    // ⚠ If this throws it is almost always because the live table ALREADY
    // holds two active bookings for one slot — exactly the thing the index
    // exists to prevent, sitting there from before it existed. It cannot be
    // fixed automatically (which of the two is the real booking is a question
    // for whoever took them), so it is logged loudly rather than swallowed:
    // carrying on silently would leave the gym unprotected with nobody aware.
    try {
      await env.DB.prepare(DB_INIT_GYM_BOOKING_SLOT_INDEX).run();
    } catch (e) {
      console.error('gym slot lock NOT created — resolve duplicate active bookings first:', e && e.message);
    }

    // ── FOOTER COLUMNS ──
    // The footer's headings and which link sits under each. See the note at
    // the top of admin/menu.js for why this is a table and not a position
    // convention inside the flat list.
    try { await env.DB.prepare('ALTER TABLE menu_items ADD COLUMN column_id INTEGER').run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_FOOTER_COLUMNS).run(); } catch (_) {}
    for (const c of FOOTER_COLUMN_SEED) {
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO footer_columns (id, heading, source, sort_order, visible) VALUES (?, ?, ?, ?, 1)')
          .bind(c.id, c.heading, c.source, c.sort_order).run();
      } catch (_) {}
    }
    // ⚠ Only where nothing is set. An install that already has a footer needs
    // its links put into columns once; a link the office has since moved must
    // never be dragged back by a later deploy.
    for (const [itemId, columnId] of Object.entries(FOOTER_ITEM_COLUMNS)) {
      try {
        await env.DB.prepare('UPDATE menu_items SET column_id = ? WHERE id = ? AND column_id IS NULL AND menu = ?')
          .bind(columnId, Number(itemId), 'footer').run();
      } catch (_) {}
    }

    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_news_items_value ON news_items(value)').run(); } catch (_) {}

    // The Christmas Market vendor list, replacing the Google Form the market
    // ran on. See admin/market.js for the money, and admin/db.js for why this
    // table stores integer cents rather than the float the gym invoices use.
    try { await env.DB.prepare(DB_INIT_MARKET_VENDORS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_MARKET_VENDORS_INDEX).run(); } catch (_) {}

    // ── EVENTS, GENERALIZED FROM THE CHRISTMAS MARKET ──
    // See admin/events.js and admin/db.js for the full design. The tables are
    // created here, in the repeatable block, so a fresh install has them
    // immediately; the market's OWN row is seeded and its eleven legacy
    // site_settings keys are retired by the one-time migration below, which
    // must run only once.
    try { await env.DB.prepare(DB_INIT_SITE_EVENTS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_SITE_EVENT_FIELDS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_SITE_EVENT_FIELDS_INDEX).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_SITE_EVENT_REGISTRATIONS).run(); } catch (_) {}
    try { await env.DB.prepare(DB_INIT_SITE_EVENT_REGISTRATIONS_INDEX).run(); } catch (_) {}

    // Square reconciles a payment to the exact application that created its
    // checkout link — see admin/square.js and the /api/market/apply and
    // /api/square/webhook routes below. NULL for every row created before
    // this, for anything paid by check/cash, and for anything on Tithe.ly.
    try { await env.DB.prepare('ALTER TABLE site_event_registrations ADD COLUMN square_order_id TEXT').run(); } catch (_) {}
    try { await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_site_event_registrations_square_order ON site_event_registrations (square_order_id)').run(); } catch (_) {}

    for (const p of PARTNER_SEED) {
      try {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO partners (id, name, short_name, value, blurb, site_url, also_note, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(p.id, p.name, p.short_name, p.value, p.blurb, p.site_url, p.also_note, p.sort_order).run();
      } catch (_) {}
    }

    // Mark schema as current so subsequent requests skip the whole block.
    try { await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run(); } catch (_) {}
    try { await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES ('version', ?)").bind(SCHEMA_VERSION).run(); } catch (_) {}
    } // end if (!schemaOk)

    // ── ONE-TIME PERMISSION RENAME (v3.0.0) ──
    // Deliberately outside the schema block above. That block re-runs on every
    // SCHEMA_VERSION bump, and this migration must run exactly once, ever:
    // `pages_edit` means the notice banners going in and the site editor coming
    // out, so a second pass would silently demote every site editor to
    // notices-only. See migratePermissionKeys() in admin/auth.js.
    const PERM_RENAME_MARKER = 'perm_rename_v3';
    const permsRenamed = markersOk || markers.get(PERM_RENAME_MARKER) === 'done';
    if (!permsRenamed) {
      try {
        const users = await env.DB.prepare('SELECT id, permissions FROM users').all();
        for (const u of (users.results || [])) {
          let current = [];
          try { current = JSON.parse(u.permissions || '[]'); } catch (_) { current = []; }
          const next = migratePermissionKeys(current);
          if (JSON.stringify(next) !== JSON.stringify(current)) {
            await env.DB.prepare('UPDATE users SET permissions = ? WHERE id = ?').bind(JSON.stringify(next), u.id).run();
          }
        }
        // Only stamp the marker once every row has been rewritten. If the loop
        // throws part-way the marker stays unset and the next request retries —
        // a half-migrated user table is the one outcome worth a second attempt.
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, 'done')").bind(PERM_RENAME_MARKER).run();
      } catch (_) { /* retried on the next request */ }
    }

    // ── ONE-TIME NEWSLETTER SIGN-UP CARD (2026-08-02) ──
    // Outside the schema block for the same reason as the rename above: that
    // block re-runs on every SCHEMA_VERSION bump, and this must run exactly
    // once. The sign-up form used to be hardcoded into the links page, so
    // there is no row for it and no way to edit its words; seeding one makes
    // it an ordinary card. Re-seeding on a later bump would bring back a card
    // the office had deleted on purpose.
    const SIGNUP_CARD_MARKER = 'signup_card_v1';
    const signupCardSeeded = markersOk || markers.get(SIGNUP_CARD_MARKER) === 'done';
    if (!signupCardSeeded) {
      try {
        const s = SIGNUP_CARD_SEED;
        await env.DB.prepare("INSERT INTO link_cards (title, description, url, icon_emoji, icon_color, sort_order, kind, active) VALUES (?, ?, '', ?, ?, ?, 'signup', 1)")
          .bind(s.title, s.description, s.icon_emoji, s.icon_color, s.sort_order).run();
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, 'done')").bind(SIGNUP_CARD_MARKER).run();
      } catch (_) { /* retried on the next request */ }
    }

    // ── ONE-TIME: PUT /give ON THE BLOCK EDITOR (2026-08-05) ──
    // Every page on the site has had a block draft waiting since the site
    // editor shipped; none of them was ever published, so the whole editor
    // sits behind a Publish nobody has pressed and /give still renders the
    // hardcoded markup in public/index.html. Andrew asked for this one to go
    // live, so it is published here rather than left as a click to remember.
    //
    // ⚠ Two guards, and both matter:
    //   canReseed() — publish ONLY a page nobody has touched and that has
    //     never been published. If the office has edited /give since, what
    //     they typed is what they meant, and this does nothing.
    //   the marker — the schema block re-runs on every SCHEMA_VERSION bump,
    //     so without one this would re-publish /give over any later edit,
    //     every deploy. Same reasoning as the sign-up card above.
    //
    // The draft was read against the live page before this shipped: the six
    // offline giving paths come across as a card grid, and both buttons keep
    // their real destinations — give.timothystl.org and serve.timothystl.org.
    // Neither carries a Tithe.ly address, which is the one thing a published
    // block must never hold, because a block's URL is frozen at publish time.
    const GIVE_PUBLISH_MARKER = 'give_page_published_v1';
    const givePublished = markersOk || markers.get(GIVE_PUBLISH_MARKER) === 'done';
    if (!givePublished) {
      try {
        const row = await env.DB.prepare('SELECT id, blocks, published_blocks, updated_by, status FROM pages WHERE id = ?')
          .bind('give').first().catch(() => null);
        if (row && canReseed(row) && row.blocks) {
          await env.DB.prepare("UPDATE pages SET published_blocks = blocks, status = 'published', updated_at = datetime('now') WHERE id = ?")
            .bind('give').run();
        }
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, 'done')").bind(GIVE_PUBLISH_MARKER).run();
      } catch (_) { /* retried on the next request */ }
    }

    // ── ONE-TIME: THE MARKET PAGES ARE PUBLISHED FROM THEIR SEEDS (2026-08-18) ──
    // /christmasmarket/vendors used to render the hardcoded markup in
    // public/index.html while its block draft sat unpublished; that markup is
    // deleted, so the seed has to be the live page rather than a draft waiting
    // for somebody to press Publish.
    //
    // ⚠ IT WRITES THE SEED BOTH SIDES, DRAFT AND LIVE, and that is what makes
    // it usable more than once. `canReseed()` refuses a page that has ever
    // been published, which is right for the generic re-seed loop above — but
    // it also means a page published by an earlier version of this marker
    // could never receive a corrected seed. So the guard here is the OTHER
    // half of canReseed() on its own: `updated_by = 'migration'`, i.e. nobody
    // has opened this page in the editor and saved it. The moment a person
    // touches it, what they typed is what they meant and this stops reaching
    // it entirely.
    //
    // ⚠ The marker's VALUE is bumped whenever the seed changes, not a second
    // marker added — one row, one question: which version of these pages has
    // been published.
    const MARKET_PUBLISH_MARKER = 'market_pages_published';
    const MARKET_PUBLISH_VERSION = 'v3';
    const marketPublished = markersOk || markers.get(MARKET_PUBLISH_MARKER) === MARKET_PUBLISH_VERSION;
    if (!marketPublished) {
      try {
        for (const page of MARKET_SEEDED_PAGES) {
          const row = await env.DB.prepare('SELECT id, updated_by FROM pages WHERE id = ?').bind(page.id).first().catch(() => null);
          if (!row || (row.updated_by || '') !== 'migration') continue;
          const blocks = JSON.stringify(sanitizeBlocks(page.blocks));
          await env.DB.prepare(
            "UPDATE pages SET blocks = ?, published_blocks = ?, status = 'published', updated_at = datetime('now'), updated_by = 'migration' WHERE id = ?"
          ).bind(blocks, blocks, page.id).run();
        }
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare('INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, ?)')
          .bind(MARKET_PUBLISH_MARKER, MARKET_PUBLISH_VERSION).run();
      } catch (_) { /* retried on the next request */ }
    }

    // ── ONE-TIME: THE VENDOR PAGE'S LIVE CONTENT WAS NEVER THE SEED (2026-08-18) ──
    // Reported after v5.23.0 shipped: "the jump to bars didnt get added". Checked
    // against production, not assumed — the live /christmasmarket/vendors page
    // renders a hero titled "Bring your goods to the Christmas Market" with a
    // single "Vendor Application" button pointed at "#vendor", on a block whose
    // id is a random generated one (b + base36 timestamp), not any of the fixed
    // ids market-page-seed.js has ever used. That exact wording does not exist in
    // ANY commit in this repo's history, hardcoded page or seed — it was built by
    // hand, directly in the live editor, at some point after Phase 1's first
    // publish. That is why MARKET_PUBLISH_MARKER (v1/v2/v3, above) has never once
    // reached this page: its `updated_by = 'migration'` guard is doing exactly
    // its job, refusing to overwrite what somebody typed. The problem is that
    // what was typed predates the whole event-section commission and is not a
    // deliberate choice about the redesign — it is what was there before the
    // redesign existed, and Andrew (who asked for this build in the first place,
    // and is now the one reporting it missing) wants the current seed live.
    //
    // ⚠ THIS BYPASSES THE updated_by GUARD, ON PURPOSE, ONCE. It is not a
    // relaxation of canReseed() — a second person's edit made AFTER this runs is
    // still respected forever, because this stamps updated_by = 'migration' back
    // on the way out, the same as the original Phase 1 publish did.
    // ⚠ Snapshotted to page_revisions FIRST, the same rule /use-redesign follows
    // for a page with real prior work on it — nothing here is actually lost, it
    // is one click away in the revision history if the wording mattered.
    const MARKET_VENDORS_FORCE_MARKER = 'market_vendors_force_republish_v1';
    const marketVendorsForced = markersOk || markers.get(MARKET_VENDORS_FORCE_MARKER) === 'done';
    if (!marketVendorsForced) {
      try {
        const row = await env.DB.prepare('SELECT id, blocks, published_blocks FROM pages WHERE id = ?')
          .bind(MARKET_VENDORS_PAGE.id).first().catch(() => null);
        if (row) {
          const priorPublished = sanitizeBlocks(parseBlocks(row.published_blocks));
          const blocks = JSON.stringify(sanitizeBlocks(MARKET_VENDORS_PAGE.blocks));
          // ⚠ Skipped when the live page already matches the seed — a healthy
          // install (this migration having already run, or the ordinary
          // MARKET_PUBLISH_MARKER path having correctly published it) must not
          // grow a page_revisions row and rewrite the same bytes on every deploy.
          if (JSON.stringify(priorPublished) !== blocks) {
            if (priorPublished.length) {
              await env.DB.prepare(
                'INSERT INTO page_revisions (page_id, blocks, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)'
              ).bind(MARKET_VENDORS_PAGE.id, JSON.stringify(priorPublished),
                     'Before the vendor-page redesign was force-applied over pre-existing hand-edited content',
                     new Date().toISOString(), 'migration').run().catch(() => {});
            }
            await env.DB.prepare(
              "UPDATE pages SET blocks = ?, published_blocks = ?, status = 'published', updated_at = datetime('now'), updated_by = 'migration' WHERE id = ?"
            ).bind(blocks, blocks, MARKET_VENDORS_PAGE.id).run();
          }
        }
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, 'done')").bind(MARKET_VENDORS_FORCE_MARKER).run();
      } catch (_) { /* retried on the next request */ }
    }

    // ── ONE-TIME: /christmasmarket'S JUMP BAR, ADDED WITHOUT TOUCHING ANYTHING
    // ELSE (2026-08-18) ──
    // /christmasmarket is one of the pages tools/extract-pages.mjs generates,
    // and INSERT_BLOCKS added a jumplinks block to its generated seed in Phase 3.
    // But the generic re-seed loop above (ALL_SEEDED_PAGES) is gated on
    // canReseed(), which refuses any page already published — and this one was,
    // long before Phase 3 shipped — so the regenerated seed, jump bar included,
    // has been sitting in admin/site-pages.js the whole time with no path to
    // reach either the draft or the live page. Confirmed against production:
    // no jump bar, and the SEED ITSELF was never written to `blocks` either, so
    // there was nothing in the editor for the office to review and Publish.
    //
    // ⚠ THIS DOES NOT REGENERATE THE PAGE FROM THE SEED. Overwriting the whole
    // page would throw away anything Andrew has typed here since it was first
    // published — the date, this year's photos, a rewritten sentence — and the
    // whole point of the annual Christmas Market workflow (see CLAUDE.md) is
    // that those edits are expected and must survive. This only SPLICES ONE
    // BLOCK into whatever is already there, at the same position the extractor
    // would have put it (index 1, straight under the banner), on both `blocks`
    // and `published_blocks` independently, and touches nothing else — not the
    // other blocks, not `updated_by`, not `updated_at` on a person's own name.
    // Idempotent by construction: it only ever runs once, behind its own marker.
    const CHRISTMASMARKET_JUMPBAR_MARKER = 'christmasmarket_jumpbar_v1';
    const christmasmarketJumpbarAdded = markersOk || markers.get(CHRISTMASMARKET_JUMPBAR_MARKER) === 'done';
    if (!christmasmarketJumpbarAdded) {
      try {
        const jumpBlock = sanitizeBlock(Object.assign(newBlock('jumplinks'), {
          id: 'cm-jump-ins', title: 'Jump to', mode: 'auto', sticky: true,
          url: '/christmasmarket/vendors', buttonText: 'Apply for a table',
          items: [{ title: 'Volunteer at the market', url: 'https://serve.timothystl.org/christmasmarket' }],
        }));
        const row = await env.DB.prepare('SELECT id, blocks, published_blocks FROM pages WHERE id = ?')
          .bind('christmasmarket').first().catch(() => null);
        if (row) {
          const splice = (col) => {
            const list = sanitizeBlocks(parseBlocks(col));
            if (!list.length || list.some((b) => b && b.type === 'jumplinks')) return null;
            list.splice(Math.min(1, list.length), 0, jumpBlock);
            return JSON.stringify(list);
          };
          const newBlocksCol = splice(row.blocks);
          const newPublishedCol = row.published_blocks == null ? null : splice(row.published_blocks);
          if (newBlocksCol != null || newPublishedCol != null) {
            await env.DB.prepare('UPDATE pages SET blocks = COALESCE(?, blocks), published_blocks = COALESCE(?, published_blocks), updated_at = datetime(\'now\') WHERE id = ?')
              .bind(newBlocksCol, newPublishedCol, 'christmasmarket').run();
          }
        }
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, 'done')").bind(CHRISTMASMARKET_JUMPBAR_MARKER).run();
      } catch (_) { /* retried on the next request */ }
    }

    // ── ONE-TIME: THE CHRISTMAS MARKET BECOMES ONE EVENT ROW (2026-08-18) ──
    // The eleven `market_*` site_settings keys become the market's own
    // `site_events` row, and every `market_vendors` row becomes a
    // `site_event_registrations` row — one record instead of a site_settings
    // row and an events row saying the same thing twice. Outside the
    // repeatable schema block above for the same reason the market-publish
    // step above it is: this reads and TRANSFORMS existing data, and must run
    // exactly once, ever, not on every SCHEMA_VERSION bump.
    //
    // ⚠ ORDER MATTERS. The 'christmasmarket' row is seeded FIRST — reading
    // whatever is in site_settings today, falling back to
    // MARKET_LEGACY_SETTINGS_DEFAULTS for a fresh install that never had
    // those keys seeded at all (INITIAL_SETTINGS no longer carries them) —
    // and only once that row exists are the market_vendors rows migrated and
    // the eleven legacy keys deleted. A crash between the two steps leaves
    // the legacy keys in place, which is harmless: the marker is unset, so
    // the whole thing retries on the next request, INSERT OR IGNORE-safe on
    // the events row and re-checking each vendor row's presence before
    // re-inserting it.
    const EVENTS_MARKET_MIGRATION_MARKER = 'events_market_migration_v1';
    const eventsMarketMigrated = markersOk || markers.get(EVENTS_MARKET_MIGRATION_MARKER) === 'done';
    if (!eventsMarketMigrated) {
      try {
        const legacyRows = await env.DB.prepare(
          `SELECT key, value FROM site_settings WHERE key IN (${MARKET_LEGACY_SETTINGS_KEYS.map(() => '?').join(',')})`
        ).bind(...MARKET_LEGACY_SETTINGS_KEYS).all().catch(() => ({ results: [] }));
        const legacy = { ...MARKET_LEGACY_SETTINGS_DEFAULTS };
        for (const r of (legacyRows.results || [])) {
          if (r.value != null && String(r.value).trim() !== '') legacy[r.key] = r.value;
        }

        await env.DB.prepare(
          `INSERT OR IGNORE INTO site_events
             (id, name, status, date_label, hours_label, coordinator_email, coordinator_permission,
              has_registration, has_payment, has_volunteers, has_photos,
              fee_amount, fee_percent, fee_fixed, max_qty, fund_id, payment_provider, square_links,
              registration_open, volunteer_slug, photo_folder, page_landing_id, page_registration_id,
              legacy_kind, sort_order, created_at, updated_at, updated_by)
           VALUES ('christmasmarket','Christmas Market','live',?,?,?, 'market_manage',
                   1,1,1,1, ?,?,?,?, ?, ?, ?,
                   ?, 'christmasmarket', 'images/events/christmasmarket/', 'christmasmarket', 'marketvendorsapply',
                   'market', 0, datetime('now'), datetime('now'), 'migration')`
        ).bind(
          legacy.market_date_label, legacy.market_hours_label, legacy.market_coordinator_email,
          Number(legacy.market_table_fee), Number(legacy.market_fee_percent), Number(legacy.market_fee_fixed),
          Math.max(1, Math.floor(Number(legacy.market_max_tables) || 3)), legacy.market_fund_id,
          legacy.market_payment_provider, legacy.market_square_links,
          legacy.market_applications_open === '0' ? 0 : 1
        ).run();

        // Vendors: only if this event has none yet, so a retry after a
        // partial run — or a re-run with the marker somehow cleared — can
        // never duplicate a vendor already carried across.
        const already = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM site_event_registrations WHERE event_id = 'christmasmarket'"
        ).first().catch(() => ({ n: 0 }));
        if (!already || !already.n) {
          const vendors = await env.DB.prepare('SELECT * FROM market_vendors ORDER BY id').all().catch(() => ({ results: [] }));
          for (const v of (vendors.results || [])) {
            let photos = [];
            try { const p = JSON.parse(v.photos || '[]'); if (Array.isArray(p)) photos = p; } catch (_) {}
            const fields = {
              business_name: v.business_name || '', website_or_social: v.website_or_social || '',
              returning_vendor: v.returning_vendor || '', street: v.street || '', city: v.city || '',
              state: v.state || '', zip: v.zip || '', product_description: v.product_description || '',
              sells_food: v.sells_food ? 1 : 0, appliances_power: v.appliances_power || '',
              special_requests: v.special_requests || '', signature_name: v.signature_name || '',
            };
            if (photos.length) fields.photos = photos;
            await env.DB.prepare(
              `INSERT INTO site_event_registrations
                 (id, event_id, qty, payment_status, amount_due_cents, amount_paid_cents, waitlisted,
                  contact_name, contact_email, contact_phone, table_number, fields_json, staff_notes, created_at)
               VALUES (?,'christmasmarket',?,?,?,?,0,?,?,?,?,?,?,?)`
            ).bind(
              v.id, v.tables || 1, v.payment_status || 'unpaid', v.amount_due_cents || 0,
              v.amount_paid_cents == null ? null : v.amount_paid_cents,
              v.participant_names || '', v.email || '', v.phone || null, v.table_number || null,
              JSON.stringify(fields), v.staff_notes || null, v.created_at
            ).run();
          }
        }

        // The eleven legacy keys are deleted, never left "just in case" —
        // leaving them would mean two places to look for the same figure,
        // which is the exact duplication this migration exists to end.
        for (const key of MARKET_LEGACY_SETTINGS_KEYS) {
          await env.DB.prepare('DELETE FROM site_settings WHERE key = ?').bind(key).run();
        }

        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, 'done')")
          .bind(EVENTS_MARKET_MIGRATION_MARKER).run();
      } catch (_) { /* retried on the next request */ }
    }

    // ── THE SERVICE LABELS THE SITE ACTUALLY USES ────────────────────────
    // The seed said "Traditional" and "Contemporary"; /worship and the
    // homepage have always said "English worship" for both. That is not just
    // wording — the welcome card groups services BY LABEL, so two different
    // labels can never collapse onto one line, and 8:00 and 10:45 sat apart
    // when the card they reproduce has always shown "8:00 & 10:45 am".
    //
    // ⚠ It rewrites the setting ONLY IF IT IS STILL EXACTLY THE OLD SEED.
    // This is an office-editable field: if anybody has touched it, whatever
    // they typed is what they meant, and correcting a stale default is not a
    // license to overwrite somebody's edit. Gated on its own marker like the
    // permission rename and the sign-up card, so a later SCHEMA_VERSION bump
    // cannot run it a second time and undo a rename made after this shipped.
    const SERVICE_LABEL_MARKER = 'service_labels_v2';
    const serviceLabelsFixed = markersOk || markers.get(SERVICE_LABEL_MARKER) === 'done';
    if (!serviceLabelsFixed) {
      try {
        // Two Sunday services and no labels — Andrew's call on 2 Aug: the 9:30
        // Vietnamese service is off the site, and neither remaining service is
        // described as "English worship" any more.
        const FIXED = 'Sunday | 8:00 am | \nSunday | 10:45 am | ';
        // ⚠ BOTH PRIOR DEFAULTS, because v1 of this correction shipped hours
        // earlier and a database may hold either. Matching only the older one
        // would leave anyone who took the v1 deploy stuck with three services.
        const PRIOR = [
          'Sunday | 8:00 am | Traditional\nSunday | 9:30 am | Vietnamese worship · Hội Thánh Việt\nSunday | 10:45 am | Contemporary',
          'Sunday | 8:00 am | English worship\nSunday | 9:30 am | Vietnamese worship · Hội Thánh Việt\nSunday | 10:45 am | English worship',
        ];
        for (const stale of PRIOR) {
          await env.DB.prepare("UPDATE site_settings SET value = ? WHERE key = 'church_service_times' AND value = ?")
            .bind(FIXED, stale).run();
        }
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, 'done')").bind(SERVICE_LABEL_MARKER).run();
      } catch (_) { /* retried on the next request */ }
    }

    // ── THE MDO SAVED SECTION ────────────────────────────────────────────
    // Seeded once, behind its own marker, exactly like the sign-up card and
    // for the same reason: the schema block re-runs on every SCHEMA_VERSION
    // bump, and a seed sitting in there would bring back a section the office
    // had deleted on purpose — or worse, silently restore the original words
    // over an edit somebody made to them.
    //
    // It goes through sanitizeBlocks so the stored JSON is the same shape the
    // editor writes. A section saved by hand and a section seeded here must be
    // indistinguishable once stored, or the seeded one behaves oddly on first
    // insert and nobody knows why.
    const MDO_SECTION_MARKER = 'mdo_section_v1';
    const mdoSectionSeeded = markersOk || markers.get(MDO_SECTION_MARKER) === 'done';
    if (!mdoSectionSeeded) {
      try {
        const blocks = sanitizeBlocks(MDO_SECTION_SEED.blocks);
        if (blocks.length) {
          await env.DB.prepare(DB_INIT_MINISTRY_SECTIONS).run();
          await env.DB.prepare(
            'INSERT INTO ministry_saved_sections (name, blocks, created_by, created_at) VALUES (?, ?, ?, ?)'
          ).bind(MDO_SECTION_SEED.name, JSON.stringify(blocks), 'system', new Date().toISOString()).run();
        }
        await env.DB.prepare('CREATE TABLE IF NOT EXISTS _schema_version (key TEXT PRIMARY KEY, value TEXT)').run();
        await env.DB.prepare("INSERT OR REPLACE INTO _schema_version (key, value) VALUES (?, 'done')").bind(MDO_SECTION_MARKER).run();
      } catch (_) { /* retried on the next request */ }
    }

    // Every gate above was satisfied before this request touched anything, so
    // nothing ran and nothing needs verifying — this binding can stop reading
    // _schema_version altogether. Deliberately NOT set when any work ran: the
    // marker writes above are each inside a try that swallows, so the next
    // request must re-read to see whether they actually landed.
    if (schemaOk && permsRenamed && signupCardSeeded && serviceLabelsFixed && mdoSectionSeeded) {
      MARKERS_SEEN.set(env.DB, SCHEMA_VERSION);
    }

    // ── PUBLIC: serve uploaded docs from R2 ──
    // ⚠ THIS IS THE VOTERS ASSEMBLY'S COUNCIL REPORTS, AND IT IS PUBLIC.
    // Nothing on timothystl.org has a member login, so the /voters page fetches
    // /api/voters and links here with no credential of any kind — see the
    // note on that endpoint below, and FX-12 in CLAUDE.md, which is a decision
    // for the church rather than a bug in this code.
    //
    // What IS closed here is the crawler half: public/robots.txt keeps Google
    // off timothystl.org/voters, but that file says nothing about
    // admin.timothystl.org, so the PDFs themselves were indexable the moment
    // one of these addresses appeared anywhere crawlable. An unlisted address
    // is not an access control; an unlisted address in a search result is not
    // even unlisted.
    if (path.startsWith('/docs/') && method === 'GET') {
      const key = 'docs-' + path.slice('/docs/'.length);
      const obj = await env.IMAGES.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('Cache-Control', 'public, max-age=3600');
      headers.set('X-Robots-Tag', 'noindex, nofollow');
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
      // Served from the edge once built — the whole payload is the same for
      // every visitor, and rebuilding it means five queries plus rendering
      // every published page. Posts under /pages and /menu bust it.
      {
        const c = edgeCache();
        if (c) {
          const hit = await c.match(new Request(PAGES_CACHE_URL)).catch(() => null);
          if (hit) return hit;
        }
      }
      const publicPage = (r) => ({
        id: r.id, title: r.title, label: r.menu_label || r.title, slug: r.slug,
        parent: r.parent_id || null, in_menu: !!r.in_menu, template: r.template,
        seo_description: r.seo_description || '',
      });
      const rows = await env.DB.prepare(
        "SELECT id, title, menu_label, slug, parent_id, sort, template, status, in_menu, short_link, external_url, seo_description, aside_top, published_blocks " +
        "FROM pages WHERE status = 'published' ORDER BY sort ASC, title ASC"
      ).all().catch(() => ({ results: [] }));
      // ⚠ give.timothystl.org is a page row so that it gets the editor, the
      // publish flow, revisions and permissions for free — but it is NOT a
      // page of this site. Left in, the SPA would serve the donation page at
      // /give-landing as well, and there would be three giving surfaces where
      // the settled rule says two, each with its own job. It is also why its
      // slug can never collide with a real one: nothing here ever offers it.
      const list = (rows.results || []).filter((r) => r.id !== GIVE_LANDING_PAGE_ID);
      const fixUrl = fixImageUrls;
      const data = await pageData(env, ctx);
      const rendered = {};
      // ⚠ NEVER RENDERED FROM BLOCKS, WHATEVER IS PUBLISHED FOR THEM. Contact
      // and Prayer POST to a screened, Turnstile-checked endpoint
      // (/api/contact, /api/prayer) — real behavior no block on this site can
      // express, the same reason give.timothystl.org is kept off the block
      // editor entirely. Unlike give-landing these are still ordinary pages
      // (they belong in `list`, in the menu, at their own address, and their
      // Page tab — hero text, an eyebrow, whatever else — is still editable
      // and still publishable); it is only the entry in `rendered` that is
      // withheld, which is what makes the client and the edge injector both
      // fall back to the hardcoded native form with no change on either side.
      // Found live: both pages had been published with a "Signup form" block
      // (a Google Form embed with no URL set) standing in for the real form —
      // two spans styled to look like a field and a button, neither wired to
      // anything. A dead form is worse than a missing one; this makes it
      // structurally impossible for either page to ship one again.
      const NATIVE_FORM_ONLY_PAGE_IDS = new Set(['contact', 'prayer']);
      for (const r of list) {
        if (NATIVE_FORM_ONLY_PAGE_IDS.has(r.id)) continue;
        // A page that links out has no content of its own. Rendering blocks it
        // may still be carrying from before would give the visitor a flash of a
        // page that is about to redirect out from under them.
        if (outboundUrl(r)) continue;
        const blocks = sanitizeBlocks(parseBlocks(r.published_blocks));
        if (!blocks.length) continue;
        const children = list.filter((c) => c.parent_id === r.id).map(publicPage);
        // The stylesheet ships once for the whole response, not once per page.
        rendered[r.id] = fixUrl(renderPage(blocks, { slug: r.id, template: r.template, data, children, asideTop: r.aside_top || 0, withCss: false }));
      }
      const redirects = await env.DB.prepare('SELECT from_slug, to_slug FROM page_redirects').all().catch(() => ({ results: [] }));
      // The navigation, resolved server-side so the site never has to work out
      // what a menu item points at. Broken and switched-off items are already
      // filtered out by publicMenu() — the admin shows them flagged, the site
      // must not show them at all.
      const menuRows = await env.DB.prepare('SELECT * FROM menu_items ORDER BY menu, sort_order, id').all().catch(() => ({ results: [] }));
      const colRows = await env.DB.prepare('SELECT * FROM footer_columns ORDER BY sort_order, id').all().catch(() => ({ results: [] }));
      const menuPages = new Map(list.map((p) => [p.id, p]));
      const strip = (i) => ({ label: i.label, href: i.href, style: i.style, kind: i.kind,
        children: (i.children || []).map((c) => ({ label: c.label, href: c.href, kind: c.kind })) });
      const pagesRes = new Response(JSON.stringify({
        // The church details, so the footer reads the same record the map
        // block and the sidebar do. Staff change a phone number once.
        details: { settings: data.settings, services: data.services, appearance: data.appearance },
        pages: list.map(publicPage),
        menu: {
          header: publicMenu(menuRows.results || [], menuPages, 'header').map(strip),
          footer: publicMenu(menuRows.results || [], menuPages, 'footer').map(strip),
          // The footer's real shape: headed columns. `footer` above stays as
          // it was — the mobile drawer repeats the footer's outside links from
          // it, and it is the fallback for a site whose columns have somehow
          // gone missing.
          footerColumns: publicFooter(colRows.results || [], menuRows.results || [], menuPages),
        },
        rendered,
        // FX-17: a <link> at the versioned, immutable asset route rather than
        // 85KB of bytes. Carries the same id="tlcb-css" the inline tag did, which
        // is what the client's own "is it already here?" check reads.
        css: Object.keys(rendered).length ? blockCssLink(VERSION) : '',
        // Two kinds of alternate address, deliberately merged into one map so
        // the router resolves both the same way and neither can be forgotten:
        // the short links derived from each page's last address segment, and
        // the 301s written when a page was renamed. A clashing short link
        // publishes nothing at all — see shortLinkRoutes().
        //
        // Order matters: rename 301s are applied LAST so they win. An old
        // address is a promise already made to the world — it is in bulletins
        // and in Google — whereas a short link is a convenience the office can
        // change in a click. Letting a short link shadow a retired address
        // would silently break exactly the inbound links page_redirects exists
        // to protect.
        // A page that links out is the third kind. Its own address maps to the
        // outside site, and then every entry is resolved through that map once,
        // so a short link or a retired address pointing at /mdo sends the
        // visitor to mdo.timothystl.org directly rather than to an address that
        // would only redirect again on the next load.
        redirects: (() => {
          const outbound = list.reduce((acc, r) => { const u = outboundUrl(r); if (u) acc[r.slug] = u; return acc; }, {});
          const merged = Object.assign(
            shortLinkRoutes(list),
            outbound,
            (redirects.results || []).reduce((acc, r) => (acc[r.from_slug] = r.to_slug, acc), {})
          );
          for (const k of Object.keys(merged)) if (outbound[merged[k]]) merged[k] = outbound[merged[k]];
          return merged;
        })(),
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' }
      });
      {
        const c = edgeCache();
        if (c) { try { ctx.waitUntil(c.put(new Request(PAGES_CACHE_URL), pagesRes.clone())); } catch (_) {} }
      }
      return pagesRes;
    }

    // ── PUBLIC: news items API ──
    // ⚠ Two different kinds of row, two different sort rules, in ONE list —
    // that is what NEWS_ORDER_SQL/NEWS_WHERE_SQL below encode once so every
    // consumer (this route, pageData()'s self-filling blocks) agrees:
    //   - An EVENT (has event_date) is a date on the calendar. It sorts
    //     soonest-first, and once that date has passed it drops off the list
    //     entirely — expire_date does not keep a past event alive.
    //   - A plain ANNOUNCEMENT (no event_date) sorts newest-published-first,
    //     same as before, and is only ever hidden by its own expire_date.
    // ── PUBLIC: THIS WEEK'S WORSHIP SERVICE ──
    // The /sermons page used to be a link out to the channel. This is what
    // makes it show the current service without anybody posting a link each
    // week: YouTube's per-channel Atom feed, which needs no API key and so
    // needs no secret to set, rotate, or notice had expired.
    //
    // Cached at the edge for 30 minutes. A new service appears within half an
    // hour of being posted, which is the right trade for a page nobody is
    // watching change — and it means a burst of Sunday traffic costs one
    // fetch of somebody else's server rather than thousands.
    if (path === '/api/latest-sermon' && method === 'GET') {
      const cache = edgeCache();
      const cacheKey = new Request('https://admin.timothystl.org/api/latest-sermon');
      if (cache) {
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
      }

      // Everything here fails to `{video:null}` rather than to an error. The
      // page treats that as "no embed" and shows the link out it always had,
      // so a YouTube outage costs the embed and nothing else.
      const answer = async () => {
        const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'sermon_youtube_channel'")
          .first().catch(() => null);
        const parsed = normalizeChannelInput(row && row.value);
        if (parsed.kind === 'none') return { video: null, reason: 'no channel set' };

        let channelId = parsed.kind === 'id' ? parsed.value : '';
        if (!channelId) {
          // ⚠ A scrape of the channel page, because there is no public way to
          // turn a handle into a channel ID. It is written back to the setting
          // once it succeeds, so this runs about once in the life of the site
          // rather than every time the cache expires — and if YouTube ever
          // changes the markup, the ID that was already found keeps working.
          const page = await fetch(channelPageUrl(parsed.value), {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TimothyLutheranBot/1.0)' },
          }).catch(() => null);
          if (!page || !page.ok) return { video: null, reason: 'channel page unreachable' };
          channelId = channelIdFrom(await page.text());
          if (!isChannelId(channelId)) return { video: null, reason: 'channel id not found' };
          await env.DB.prepare("UPDATE site_settings SET value = ? WHERE key = 'sermon_youtube_channel'")
            .bind(channelId).run().catch(() => {});
        }

        const res = await fetch(feedUrl(channelId)).catch(() => null);
        if (!res || !res.ok) return { video: null, reason: 'feed unreachable' };
        const filterRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'sermon_title_filter'")
          .first().catch(() => null);
        const video = pickLatest(parseFeed(await res.text()), filterRow && filterRow.value);
        return { video: video || null, reason: video ? '' : 'nothing matched' };
      };

      let payload;
      try { payload = await answer(); } catch (_) { payload = { video: null, reason: 'error' }; }
      const out = new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
                   'Cache-Control': 'public, max-age=1800' },
      });
      if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, out.clone()));
      return out;
    }

    // ── PUBLIC: THE CHURCH CALENDAR ───────────────────────────
    // The merged month feed the site's own calendar renders from, replacing
    // the Google embed and its per-cell "N more" cap. See admin/calendar.js
    // for the merge rule, the color-to-category table and why every time in
    // the payload is a bare church wall clock.
    //
    // ⚠ ONE MONTH PER REQUEST, keyed by ?month=YYYY-MM. Serving the whole year
    // would make the payload grow forever and the edge cache useless; a month
    // is what the grid draws and what somebody navigates by.
    if ((path === '/api/calendar' || path === '/api/calendar.ics') && method === 'GET') {
      const wantsIcs = path === '/api/calendar.ics';
      const now = churchDate();
      const asked = String(url.searchParams.get('month') || '').trim();
      const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : now.slice(0, 7);
      // Subscribing to one month would leave somebody's calendar app empty next
      // month, so the .ics is deliberately a WINDOW rather than the month on
      // screen: back to the start of last month and on for a year.
      const [y, m] = ym.split('-').map(Number);
      const win = monthRange(y, m);
      const from = wantsIcs ? monthRange(...shiftMonth(y, m, -1)).from : win.from;
      const to   = wantsIcs ? monthRange(...shiftMonth(y, m, 12)).to   : win.to;

      // ⚠ The categories are read, never assumed. An unreadable table falls
      // back to the shipped list rather than to nothing, so a visitor never
      // meets a calendar with no palette at all.
      //
      // ⚠ AND THEY ARE READ BEFORE THE CACHE IS CONSULTED, on purpose. The
      // month is cached for ten minutes, which is right for events — but an
      // office person who has just renamed a category and gone to look at the
      // calendar would otherwise see the old name and conclude the screen does
      // not work. Their fingerprint is part of the cache key, so an edit
      // changes the key and the next request rebuilds; the stale entries age
      // out on their own. It costs one indexed read on a cache hit.
      const catRows = await env.DB.prepare(
        'SELECT key, name, color_id, palette, sort_order, active, updated_at FROM calendar_categories'
      ).all().catch(() => ({ results: [] }));
      const cats = mergedCategories(catRows.results || []);
      const catStamp = (catRows.results || [])
        .map((r) => `${r.key}:${r.updated_at || ''}:${r.active}`).sort().join('|');
      let catV = 0;
      for (let i = 0; i < catStamp.length; i++) catV = ((catV * 31) + catStamp.charCodeAt(i)) | 0;

      const cache = edgeCache();
      const cacheKey = new Request(`https://admin.timothystl.org/api/calendar${wantsIcs ? '.ics' : ''}?from=${from}&to=${to}&v=${catV >>> 0}`);
      if (cache) {
        const hit = await cache.match(cacheKey).catch(() => null);
        if (hit) return hit;
      }

      const idRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'calendar_google_ids'")
        .first().catch(() => null);
      let feed;
      try {
        feed = await buildCalendarFeed(env, {
          from, to, getToken: getGCalAccessToken, cats,
          calendarIds: parseCalendarIds(idRow && idRow.value),
        });
      } catch (_) {
        // ⚠ Never a 500 on this route. The page's own fallback is a link out to
        // Google Calendar, and it can only offer that if it gets an answer it
        // can read — an error page reads to the client as a network failure.
        feed = { from, to, events: [], categories: activeCategories(cats), sources: { google: false, news: false, building: false, googleReason: 'error' } };
      }

      const out = wantsIcs
        ? new Response(buildIcs(feed.events, { cats }), {
            headers: { 'Content-Type': 'text/calendar; charset=utf-8',
                       'Content-Disposition': 'inline; filename="timothy-lutheran.ics"',
                       'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=600' },
          })
        : new Response(JSON.stringify(feed), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
                       'Cache-Control': 'public, max-age=600' },
          });
      if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, out.clone()));
      return out;
    }

    if (path === '/api/news' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const today = churchDate();
      const rows = await env.DB.prepare(
        `SELECT id, title, summary, body, image_url, publish_date, event_date, expire_date, pinned, theme, content_type, channels
         FROM news_items
         WHERE publish_date <= ? AND (expire_date IS NULL OR expire_date >= ?)
           AND (event_date IS NULL OR event_date >= ?)
           AND (channels IS NULL OR channels LIKE '%web%')
         ${NEWS_ORDER_SQL}
         LIMIT ?`
      ).bind(today, today, today, limit).all();
      // FX-04: `body` is the one field here the SPA renders as markup.
      const newsOut = (rows.results || []).map((r) => ({ ...r, body: richOut(r.body) }));
      return new Response(JSON.stringify(newsOut), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: the four values and their partner ministries ──
    // Returns all four values in the church's own order, each with whichever
    // partner is paired to it and how many ministries carry it. A value with
    // no partner comes back with `partner: null` rather than being omitted, so
    // the values page can say so plainly instead of quietly showing three.
    if (path === '/api/values' && method === 'GET') {
      const q = async (sql) => { try { return (await env.DB.prepare(sql).all()).results || []; } catch (_) { return []; } };
      const [partners, counts, coreValueRows] = await Promise.all([
        q('SELECT name, short_name, value, blurb, site_url, also_note, sort_order FROM partners'),
        q("SELECT value, slug, title FROM youth_pages WHERE value IS NOT NULL AND value <> '' AND COALESCE(in_menu,1) = 1"),
        q('SELECT key, short, name, blurb, tag, why, photo_url FROM core_values'),
      ]);
      const byValue = Object.fromEntries(partners.map((p) => [p.value, p]));
      const payload = mergedValues(coreValueRows).map((v) => ({
        key: v.key,
        short: v.short,
        name: v.name,
        blurb: v.blurb,
        tag: v.tag || v.blurb,
        why: v.why || '',
        photoUrl: v.photo_url || '',
        ink: v.ink,
        tint: v.tint,
        partner: byValue[v.key] || null,
        ministries: counts.filter((m) => m.value === v.key).map((m) => ({ slug: m.slug, title: m.title })),
      }));
      return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=600' }
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
        const today2 = churchDate();
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
      // withCss:false — the 23KB block stylesheet used to ride inside every
      // one of these responses, and the client's first move was to regex it
      // back out because /api/pages had already shipped the one copy the page
      // uses. The client now awaits that copy before injecting this markup.
      const blocksHtml = pubBlocks.length
        ? fixUrl(renderPage(sanitizeBlocks(pubBlocks), { slug, data: await pageData(env, ctx), withCss: false }))
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
      // The taps ride along so the links page can work out which one it is
      // being viewed as — from the address the office typed into "Lands on",
      // so there is nothing to keep in step between the two workers.
      const [rows, tapRows] = await Promise.all([
        env.DB.prepare("SELECT id, title, description, url, icon_emoji, icon_color, COALESCE(kind, 'link') AS kind, tap FROM link_cards WHERE active = 1 ORDER BY sort_order, id").all(),
        env.DB.prepare('SELECT id, destination FROM taps WHERE active = 1 ORDER BY id').all().catch(() => ({ results: [] })),
      ]);
      return new Response(JSON.stringify({ cards: rows.results || [], taps: tapRows.results || [] }), {
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
      // FX-04: pastor_note and a text ministry_content are rendered as markup
      // by loadNewsletters(). ministry_type 'image' is a bare URL, not markup.
      const newsletters = rows.results.map(row => ({
        ...row,
        pastor_note: richOut(row.pastor_note),
        ministry_content: row.ministry_type === 'image' ? row.ministry_content : richOut(row.ministry_content),
        events: evtsByNewsletter[row.id] || [],
      }));
      return new Response(JSON.stringify(newsletters), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: single newsletter ──
    if (path.startsWith('/api/newsletter/') && method === 'GET') {
      const id = path.split('/').pop();
      // ── FX-07: PUBLISHED ONLY, AND NAMED COLUMNS ────────────────────────
      // This was `SELECT *` with no status filter, answering `{...row}`. The
      // list endpoint twenty lines above filters correctly, so the only way in
      // was a guessed id — which is the whole surface, because ids are
      // sequential. A draft under approval, and every internal column on it
      // (brevo_campaign_id, approval_status, sent_count), was public.
      //
      // ⚠ Named columns rather than `SELECT *`: a column added later is
      // private until somebody decides otherwise, which is the right default
      // for a table carrying send state and approval history. This list is
      // exactly what loadNewsletters()/loadNewsletterDetail() in
      // public/index.html read, plus the id they link by.
      const row = await env.DB.prepare(
        `SELECT id, subject, pastor_note, secondary_note, wol_content, lasm_content,
                tertiary_note, tertiary_cta_label, tertiary_cta_url,
                ministry_content, ministry_type, published_at, format,
                cta_url, cta_label, bible_classes, news_item_ids
           FROM newsletters
          WHERE id = ? AND (status IS NULL OR status = 'published')`
      ).bind(id).first();
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

      // FX-04: every rich field this endpoint hands the SPA, which drops all
      // five straight into `innerHTML` in loadNewsletterDetail().
      const clean = { ...row };
      for (const k of ['pastor_note', 'secondary_note', 'wol_content', 'lasm_content', 'tertiary_note']) {
        clean[k] = richOut(clean[k]);
      }
      if (clean.ministry_type !== 'image') clean.ministry_content = richOut(clean.ministry_content);
      return new Response(JSON.stringify({ ...clean, events: evts.results, news_items: newsItems, bible_classes: bibleClasses }), {
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
        ? `<p style="text-align:center;padding:48px 0;color:#6A6858;font-family:'Source Sans 3',Arial,sans-serif;">No newsletters yet — check back soon.</p>`
        : newsletters.map(n => {
            const dateStr = formatDate(n.published_at);
            const eventsHtml = n.events && n.events.length
              ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;">${n.events.map(e =>
                  `<span style="font-family:'Source Sans 3',Arial,sans-serif;font-size:12px;background:#E7EEF7;color:#1E2D4A;padding:3px 10px;border-radius:999px;">${e.event_date ? new Date(e.event_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' · ' : ''}${e.event_name}</span>`
                ).join('')}</div>`
              : '';
            return `
<div style="padding:24px 0;border-bottom:1px solid #E7DFD1;">
  <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#C9973A;margin-bottom:6px;">${dateStr}</div>
  <div style="font-family:'Lora',Georgia,serif;font-size:20px;color:#1E2D4A;margin-bottom:8px;">${n.subject}</div>
  ${n.pastor_note ? `<div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;color:#1A1A2A;line-height:1.75;">${n.pastor_note.replace(/\n/g,'<br>').substring(0,240)}${n.pastor_note.length > 240 ? '…' : ''}</div>` : ''}
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
body{font-family:'Source Sans 3',Arial,sans-serif;background:#FAF7F1;color:#1A1A2A;min-height:100vh;}
.topbar{background:#1E2D4A;border-bottom:3px solid #C9973A;padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between;}
.topbar-brand{font-size:14px;font-weight:800;color:white;}
.topbar-sub{font-size:11px;color:#C9973A;font-style:italic;font-family:'Lora',Georgia,serif;}
.topbar-links a{font-size:13px;font-weight:600;color:rgba(255,255,255,.75);text-decoration:none;margin-left:20px;}
.topbar-links a:hover{color:white;}
.wrap{max-width:720px;margin:0 auto;padding:48px 28px;}
h1{font-family:'Lora',Georgia,serif;font-size:32px;color:#1E2D4A;margin-bottom:6px;}
.sub{font-size:14px;color:#6A6858;margin-bottom:36px;}
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
<div class="tlc-wrap">
  <h1>News &amp; Updates</h1>
  <p class="sub">Weekly newsletters from Pastor and the Timothy Lutheran family.</p>
  ${listHtml}
</div>
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // ── PUBLIC: what the website's forms need before they can be submitted ──
    // A signed token proving the browser actually loaded the form, plus the
    // Turnstile site key if one has been configured. Never cached — the token
    // carries its issue time, and a cached one would read as stale to everyone.
    if (path === '/api/form-config' && method === 'GET') {
      // `private`, deliberately, not `public`: a browser may keep its token
      // for a minute (a visitor moving contact → prayer no longer pays a
      // guaranteed round trip), but the edge must never hand one visitor's
      // token to the next — and a bot that fetches its own token must get a
      // fresh timestamp, or the too-quick-to-be-human signal reads a stale
      // issue time and scores the bot as patient.
      return new Response(JSON.stringify(await formConfig(env)), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'private, max-age=60',
        }
      });
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
        if (!name || !message) return new Response(JSON.stringify({ error: 'Name and message are required' }), { status: 400, headers: corsHeaders });

        // Spam screening. A held message is stored for review at /filtered and
        // the sender is told it went through — a bot learning which of its
        // messages were caught is how it learns to get past the filter. The
        // few real messages this catches are one click from being released.
        const screen = await screenSubmission(env, request, {
          kind: 'contact', name, email, message,
          honeypot: form.get('website'),
          token: form.get('form_token'),
          turnstileToken: form.get('cf-turnstile-response'),
        });
        if (screen.held) {
          // Held mail is invisible by design (see admin/forms.js) — a push is
          // what keeps that from also being silent. Never awaited: a push
          // failure (no subscribers yet, a dead endpoint) must never turn
          // into a real visitor's submission failing.
          ctx.waitUntil(pushToAllSubscribers(env, {
            title: 'Filtered Mail', body: 'A contact form message was held for review.',
            tag: 'held-mail', url: '/filtered',
          }));
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        const result = await sendTransactionalEmail(env, {
          subject: officeSubject('contact', name, screen.suspect),
          htmlContent: officeEmailHtml('contact', { name, email, message }),
          toEmails: [OFFICE_EMAIL],
          replyTo: email ? { email, name } : undefined
        });
        if (result.error) return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders });
        // A delivered message already reaches the office inbox — this push is
        // just a faster way to notice it than checking email, same reasoning
        // as every other trigger here (see admin/webpush.js callers).
        ctx.waitUntil(pushToAllSubscribers(env, {
          title: 'New message from ' + (name || 'the website'), body: message.slice(0, 150),
          tag: 'contact-message', url: '/dashboard',
        }));
        // Confirmation email to the sender. Skipped for anything that scored as
        // suspect: the address is attacker-supplied, so auto-replying to it
        // turns this form into a way to mail someone else's inbox.
        if (!screen.suspect && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await sendTransactionalEmail(env, {
            subject: 'We received your message — Timothy Lutheran Church',
            htmlContent: `<p>Hi ${escapeHtml(name)},</p><p>Thank you for reaching out to Timothy Lutheran Church. We received your message and will be in touch soon.</p><p>If you need immediate assistance, please call us at (314) 781-8673 or email <a href="mailto:dinger@timothystl.org">dinger@timothystl.org</a>.</p><p>Grace and peace,<br>The team at Timothy Lutheran Church</p>`,
            toEmails: [email]
          });
        }
        forwardToChms(env, ctx, 'contact', { name, email, message });
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch(e) {
        console.error('Contact form failed:', e?.message);
        return new Response(JSON.stringify({ error: 'Something went wrong. Please try again or call the church office.' }), { status: 500, headers: corsHeaders });
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
        if (!message) return new Response(JSON.stringify({ error: 'Prayer request is required' }), { status: 400, headers: corsHeaders });

        // Same screening as the contact form. The threshold in admin/spam.js is
        // deliberately conservative here: holding a real prayer request for a
        // few hours costs far more than letting a pitch through.
        const screen = await screenSubmission(env, request, {
          kind: 'prayer', name, email, message,
          honeypot: form.get('website'),
          token: form.get('form_token'),
          turnstileToken: form.get('cf-turnstile-response'),
        });
        if (screen.held) {
          ctx.waitUntil(pushToAllSubscribers(env, {
            title: 'Filtered Mail', body: 'A prayer request was held for review.',
            tag: 'held-mail', url: '/filtered',
          }));
          return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        const result = await sendTransactionalEmail(env, {
          subject: officeSubject('prayer', name, screen.suspect),
          htmlContent: officeEmailHtml('prayer', { name, email, message }),
          toEmails: [OFFICE_EMAIL],
          replyTo: email ? { email, name } : undefined
        });
        if (result.error) return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders });
        ctx.waitUntil(pushToAllSubscribers(env, {
          title: 'New prayer request from ' + (name || 'the website'), body: message.slice(0, 150),
          tag: 'prayer-message', url: '/dashboard',
        }));
        // Confirmation email to the sender — suppressed for suspect messages,
        // see the note on the contact route above.
        if (!screen.suspect && email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          await sendTransactionalEmail(env, {
            subject: "We're praying for you — Timothy Lutheran Church",
            htmlContent: `<p>Hi ${name ? escapeHtml(name) : 'friend'},</p><p>Thank you for sharing your prayer request with us. Our pastoral staff has received it and will be praying for you.</p><p>If you'd like to speak with someone, please reach out to our office at <a href="mailto:dinger@timothystl.org">dinger@timothystl.org</a> or call (314) 781-8673.</p><p>Grace and peace,<br>The pastoral staff at Timothy Lutheran Church</p>`,
            toEmails: [email]
          });
        }
        forwardToChms(env, ctx, 'prayer', { name, email, message });
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      } catch(e) {
        console.error('Prayer form failed:', e?.message);
        return new Response(JSON.stringify({ error: 'Something went wrong. Please try again or call the church office.' }), { status: 500, headers: corsHeaders });
      }
    }

    // ── PUBLIC: newsletter subscribe API ──
    if (path === '/api/subscribe' && method === 'POST') {
      const corsH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      try {
        const form = await request.formData();
        const email = (form.get('email') || '').trim().toLowerCase();
        const name = (form.get('name') || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return new Response(JSON.stringify({ error: 'Please enter a valid email address.' }), { status: 400, headers: corsH });
        }
        // Screened like the other forms — mostly for the flood limit, since a
        // scripted signup run is how a mailing list fills up with dead
        // addresses. A held signup waits at /filtered and can be released.
        const screen = await screenSubmission(env, request, {
          kind: 'subscribe', name, email, message: '',
          honeypot: form.get('website'),
          token: form.get('form_token'),
          turnstileToken: form.get('cf-turnstile-response'),
        });
        if (screen.held) return new Response(JSON.stringify({ success: true }), { headers: corsH });
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

    // ── PUBLIC: a visitor's own browser opts into the congregation's audience ──
    // The mirror of /api/push/subscribe above, for the OTHER audience — see
    // "Push Alert" in CLAUDE.md and the comment on pushToAllSubscribers in
    // admin/webpush.js. That route requires a signed-in session because it is
    // a staff member's own device; this one has no session to require, because
    // the person subscribing has never signed into anything. `user_id` stays
    // NULL and `audience` is 'public' — nothing here can reach a staff device,
    // whatever is posted, because pushToAllSubscribers only ever reads ONE
    // audience per call and every staff trigger still calls it with none
    // (defaulting to 'staff').
    //
    // ⚠ NOT screenSubmission() — that scores a name/email/message shape this
    // payload does not have. The real risk here is not content, it is a
    // scripted flood of junk rows; validating the three fields are shaped like
    // what a real PushManager.subscribe() hands back (an https endpoint, two
    // short base64url keys) is what a scripted POST with no browser behind it
    // cannot fake cheaply, and is proportionate to what an abused row actually
    // costs — a wasted D1 row nobody reads, not a real notification to anybody
    // real, since a fabricated endpoint just fails to deliver.
    if (path === '/api/push/subscribe-public' && (method === 'POST' || method === 'OPTIONS')) {
      const corsH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      // ⚠ THE FIRST GENUINELY LIVE OPTIONS BRANCH IN THIS FILE'S SET OF PUBLIC
      // CROSS-ORIGIN POSTS. Every earlier one (/api/contact, /api/prayer,
      // /api/subscribe, /api/market/apply) posts FormData, which the CORS spec
      // treats as a "simple request" needing no preflight — their own OPTIONS
      // checks, where they have one, do nothing a real browser ever triggers.
      // This route posts JSON, which is NOT simple: the browser sends a real
      // OPTIONS preflight first and refuses the POST unless this answers it
      // with the right Allow-Methods/Allow-Headers, whatever this route's own
      // POST logic would have returned.
      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          ...corsH,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }});
      }
      try {
        const sub = await request.json();
        const endpoint = String(sub?.endpoint || '');
        const p256dh = String(sub?.keys?.p256dh || '');
        const auth = String(sub?.keys?.auth || '');
        const b64u = /^[A-Za-z0-9_-]+$/;
        if (!/^https:\/\//.test(endpoint) || endpoint.length > 1024
          || !b64u.test(p256dh) || p256dh.length > 256
          || !b64u.test(auth) || auth.length > 256) {
          return new Response(JSON.stringify({ error: 'Invalid subscription' }), { status: 400, headers: corsH });
        }
        await env.DB.prepare(
          `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, audience) VALUES (NULL, ?, ?, ?, 'public')
           ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, audience = 'public', user_id = NULL`
        ).bind(endpoint, p256dh, auth).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsH });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Could not save subscription' }), { status: 500, headers: corsH });
      }
    }
    if (path === '/api/push/unsubscribe-public' && (method === 'POST' || method === 'OPTIONS')) {
      const corsH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          ...corsH,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }});
      }
      try {
        const { endpoint } = await request.json();
        // Same boundary the staff unsubscribe route already relies on: the
        // endpoint is a bearer value only the subscribing browser holds, handed
        // back by its own pushManager.getSubscription() — not a guessable id.
        if (endpoint) await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND audience = 'public'").bind(endpoint).run();
        return new Response(JSON.stringify({ success: true }), { headers: corsH });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Could not remove subscription' }), { status: 500, headers: corsH });
      }
    }

    // ── PUBLIC: what the Christmas Market vendor page needs to quote a price ──
    // The page ships with the same defaults hardcoded, so an unreachable admin
    // shows a working page at the right price and only the submit button stops
    // working. The giving link is deliberately NOT in this response — the
    // amount and the address are settled server-side on submit, so a browser
    // never holds a payment URL it could edit before it is used.
    if (path === '/api/market-config' && method === 'GET') {
      return new Response(JSON.stringify(await marketConfig(env)), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          // Short, but long enough that a vendor moving around the page is not
          // paying for it repeatedly. Closing applications reaches the site
          // within the minute.
          'Cache-Control': 'public, max-age=60',
        }
      });
    }

    // ── PUBLIC: a Christmas Market vendor application ──
    //
    // ⚠ THE APPLICATION IS SAVED BEFORE THE VENDOR IS SENT TO PAY, and that
    // ordering is the whole point. A maker who fills in five minutes of form
    // and then closes the card page — because the phone rang, because they
    // wanted to check with somebody — has to still exist on the coordinator's
    // list, marked unpaid, so she can chase them. The Google Form this
    // replaces lost them completely.
    //
    // ⚠ THE AMOUNT IS COMPUTED HERE AND NOWHERE ELSE. The page shows a running
    // total so the vendor knows what they are agreeing to, but what is charged
    // and what is recorded both come from priceBreakdown() on this side of the
    // request. A posted total is never read.
    if (path === '/api/market/apply' && method === 'POST') {
      const corsH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      if (request.method === 'OPTIONS') return new Response('', { headers: corsH });
      try {
        const form = await request.formData();
        const settings = await marketSettings(env);
        if (!settings.open) {
          return new Response(JSON.stringify({
            error: `Vendor applications are closed right now. Please email ${settings.coordinatorEmail} — Marla can tell you when they reopen.`
          }), { status: 403, headers: corsH });
        }

        const fields = {};
        for (const k of ['participant_names', 'business_name', 'website_or_social', 'returning_vendor',
          'email', 'phone', 'street', 'city', 'state', 'zip', 'product_description', 'sells_food',
          'appliances_power', 'special_requests', 'tables', 'signature_name', 'payment_method']) {
          fields[k] = form.get(k);
        }
        const { ok: valid, errors, value } = sanitizeApplication(fields, settings);
        if (!valid) return new Response(JSON.stringify({ error: errors[0], errors }), { status: 400, headers: corsH });

        // Screened like every other public form. ⚠ A held application is
        // stored and answered with success, exactly as a held prayer request
        // is — a bot that learns which of its submissions were caught learns
        // how to get past the filter. The difference here is that a held one
        // is NOT given a payment link: taking money for a table nobody has
        // read the application for would be the worse mistake by far.
        const screen = await screenSubmission(env, request, {
          kind: 'market-vendor',
          name: value.participant_names,
          email: value.email,
          message: screenableText(value),
          honeypot: form.get('website'),
          token: form.get('form_token'),
          turnstileToken: form.get('cf-turnstile-response'),
        });

        const price = priceBreakdown(value.tables, settings);

        // Photos — optional, never a reason to fail. They are read only after
        // the fields have passed and the screener has run, so a bot cannot
        // make this Worker buffer 40MB by posting files with no application
        // behind them.
        const photos = screen.held ? [] : await storeMarketPhotos(env, request, form);

        let id = null;
        try {
          id = await insertRegistration(env, marketInsertArgs(value, price, photos));
        } catch (e) {
          // ⚠ The one failure a vendor must be told about. Everything else here
          // fails quietly on purpose, but if the row did not save then the
          // coordinator will never know they applied — sending them to a
          // payment page at that point takes money for a table nobody has a
          // record of.
          console.error('Market application insert failed:', e?.message);
          return new Response(JSON.stringify({
            error: `We could not save your application. Please try again, or email ${settings.coordinatorEmail} and Marla will take it by hand.`
          }), { status: 500, headers: corsH });
        }

        if (screen.held) {
          ctx.waitUntil(pushToAllSubscribers(env, {
            title: 'Filtered Mail', body: 'A Christmas Market vendor application was held for review.',
            tag: 'held-mail', url: '/filtered',
          }));
          // It is on the coordinator's list, unpaid, with no payment link —
          // and the sender is told it arrived, because it did.
          return new Response(JSON.stringify({ success: true, held: true }), { headers: corsH });
        }

        // ⚠ A CHECK/CASH APPLICATION OWES THE FLAT FEE, NEVER THE GROSSED-UP
        // ONE — see the comment on marketInsertArgs() in admin/market.js for
        // why. This is the SAME figure that function already computed and
        // stored; recomputed here rather than read back off the row so the
        // emails and the JSON response don't need a second database round
        // trip for a number already in scope.
        const amountDueCents = value.payment_method === 'check' ? price.subtotalCents : price.totalCents;

        // ── THE PAYMENT ADDRESS ────────────────────────────────────────────
        // Check/cash gets no link at all — there is nothing to redirect to,
        // and the coordinator marks it paid by hand once the check or cash
        // actually arrives.
        //
        // A card application on Square gets a link created for THIS
        // APPLICATION ALONE via Square's own API — see admin/square.js —
        // rather than the office's static per-table-count link, so that the
        // /api/square/webhook route below can later match a completed
        // payment to this exact row by order id, not by amount and rough
        // timing (two one-table vendors paying the same afternoon would be
        // indistinguishable by amount alone). The id round-trips as Square's
        // idempotency key, so a retried request cannot create a second link.
        //
        // ⚠ Square being down, not yet configured, or refusing the request
        // all fall back to the SAME static link this page has always used —
        // silently, the same shape every other integration on this site
        // degrades by (Turnstile, the ChMS intake key, VAPID). A vendor must
        // never be unable to pay because Square's API had a bad minute.
        let payUrl = '';
        if (value.payment_method !== 'check') {
          if (settings.paymentProvider === 'square') {
            try {
              const link = await createSquarePaymentLink(env, {
                idempotencyKey: `market-vendor-${id}`,
                amountCents: amountDueCents,
                name: `Christmas Market — ${value.tables} table${value.tables === 1 ? '' : 's'}`,
                redirectUrl: 'https://timothystl.org/christmasmarket/vendors',
              });
              payUrl = link.url;
              // Awaited, unlike the emails below — a webhook arriving before
              // this landed would find no match at all, and Square's own
              // redirect can in principle send a fast-moving vendor back to
              // the church's site before this request has even answered.
              await updateRegistration(env, id, { square_order_id: link.orderId });
            } catch (e) {
              console.error('Square payment link creation failed, falling back to the static link:', e?.message);
              payUrl = marketPayUrl(settings, amountDueCents, value.tables);
            }
          } else {
            payUrl = marketPayUrl(settings, amountDueCents, value.tables);
          }
        }

        // Both emails are best-effort and neither is awaited into the vendor's
        // answer. The application is already saved; a Brevo outage must not
        // read to a maker as "your application failed".
        ctx.waitUntil((async () => {
          await sendTransactionalEmail(env, {
            subject: `${screen.suspect ? '[likely spam] ' : ''}Christmas Market vendor — ${value.business_name || value.participant_names}`,
            htmlContent: coordinatorEmailHtml(value, { totalCents: amountDueCents, photos, suspect: screen.suspect }),
            toEmails: [settings.coordinatorEmail],
            replyTo: { email: value.email, name: value.participant_names },
          });
          // Suppressed for a suspect application, same rule as the contact and
          // prayer forms: the address is supplied by whoever submitted it, so
          // auto-replying to it turns this form into a way to mail somebody
          // else's inbox (AW-5).
          if (!screen.suspect) {
            await sendTransactionalEmail(env, {
              subject: 'Your Christmas Market table — Timothy Lutheran Church',
              htmlContent: vendorEmailHtml(value, { totalCents: amountDueCents, payUrl, settings }),
              toEmails: [value.email],
            });
          }
        })());

        ctx.waitUntil(pushToAllSubscribers(env, {
          title: 'Christmas Market vendor application',
          body: `${value.business_name || value.participant_names} — ${value.tables} table${value.tables === 1 ? '' : 's'}, ${marketMoney(amountDueCents)}`,
          tag: 'market-vendor', url: '/market',
        }));

        return new Response(JSON.stringify({
          success: true, id, payUrl, total: marketMoney(amountDueCents), totalCents: amountDueCents,
          checkPay: value.payment_method === 'check',
        }), { headers: corsH });
      } catch (e) {
        console.error('Market application failed:', e?.message);
        return new Response(JSON.stringify({ error: 'Something went wrong. Please try again or email the market coordinator.' }), { status: 500, headers: corsH });
      }
    }

    // ── PUBLIC: generic event registration ── the same shape /api/market/apply
    // is, generalized: which event, which fields, whether it takes money and
    // whether it has a cap all come from the site_events/site_event_fields
    // rows rather than being hardcoded, so a second event needs no route of
    // its own. A FIXED path, not /api/events/:slug/register — the CSRF
    // Origin gate's PUBLIC_CROSS_ORIGIN_POSTS is an exact-match set and
    // cannot match a dynamic segment, and the market's own single fixed
    // endpoint is the precedent this follows rather than widening that gate.
    if (path === '/api/events/register' && method === 'POST') {
      const corsH = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      if (request.method === 'OPTIONS') return new Response('', { headers: corsH });
      try {
        const fd = await request.formData();
        const eventId = String(fd.get('event_id') || '').trim();
        const ev = eventId ? await getEvent(env, eventId) : null;
        if (!ev || !Number(ev.has_registration)) {
          return new Response(JSON.stringify({ error: 'This form is not accepting sign-ups.' }), { status: 404, headers: corsH });
        }
        if (!Number(ev.registration_open ?? 1)) {
          return new Response(JSON.stringify({
            error: `Sign-ups are closed right now.${ev.coordinator_email ? ` Please email ${ev.coordinator_email}.` : ''}`
          }), { status: 403, headers: corsH });
        }

        const fields = await eventFields(env, eventId);
        const giveRow = Number(ev.has_payment)
          ? await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'give_url'").first().catch(() => null)
          : null;
        const cfg = eventFeeConfig(ev, (giveRow && giveRow.value) || '');

        // sanitizeRegistration reads `field_<key>` off a plain object, not a
        // FormData — marshaled here rather than in events.js, which stays
        // pure and DB-free.
        const formObj = { qty: fd.get('qty') };
        for (const f of fields) formObj[`field_${f.key}`] = fd.get(`field_${f.key}`);
        const { ok: valid, errors, value } = sanitizeRegistration(formObj, fields, cfg);
        if (!valid) return new Response(JSON.stringify({ error: errors[0], errors }), { status: 400, headers: corsH });

        const screen = await screenSubmission(env, request, {
          kind: `event-${eventId}`,
          name: value.contact_name,
          email: value.contact_email,
          message: registrationScreenableText(value, fields),
          honeypot: fd.get('website'),
          token: fd.get('form_token'),
          turnstileToken: fd.get('cf-turnstile-response'),
        });

        // A held submission is stored and answered with success, same rule
        // as every other public form — and, same as the market, given no
        // capacity/waitlist decision and no payment link, since a bot that
        // learns which of its submissions were caught learns how to get
        // past the filter, and taking a spot or money for one nobody has
        // reviewed would be the worse mistake either way.
        let waitlisted = false;
        if (!screen.held && ev.registration_cap) {
          const cur = await env.DB.prepare(
            "SELECT COALESCE(SUM(qty),0) AS n FROM site_event_registrations WHERE event_id = ? AND payment_status != 'dropped' AND waitlisted = 0"
          ).bind(eventId).first().catch(() => ({ n: 0 }));
          const decision = capacityDecision(ev, (cur && cur.n) || 0, value.qty || 1);
          if (decision.refused) {
            return new Response(JSON.stringify({
              error: `This is full.${ev.coordinator_email ? ` Please email ${ev.coordinator_email} to ask about a waitlist.` : ''}`
            }), { status: 409, headers: corsH });
          }
          waitlisted = decision.waitlisted;
        }

        const price = Number(ev.has_payment) ? priceBreakdown(value.qty || 1, cfg) : null;
        const { nonSensitive, sensitive } = splitRegistrationFields(value, fields);

        let id = null;
        try {
          id = await insertRegistration(env, {
            event_id: eventId,
            qty: value.qty || 1,
            payment_status: 'unpaid',
            amount_due_cents: price ? price.totalCents : 0,
            waitlisted,
            contact_name: value.contact_name,
            contact_email: value.contact_email,
            contact_phone: value.contact_phone,
            fields: nonSensitive,
            sensitive,
          });
        } catch (e) {
          console.error('Event registration insert failed:', e?.message);
          return new Response(JSON.stringify({
            error: `We could not save that. Please try again${ev.coordinator_email ? `, or email ${ev.coordinator_email}` : ''}.`
          }), { status: 500, headers: corsH });
        }

        if (screen.held) {
          ctx.waitUntil(pushToAllSubscribers(env, {
            title: 'Filtered Mail', body: `A ${ev.name || eventId} sign-up was held for review.`,
            tag: 'held-mail', url: '/filtered',
          }));
          return new Response(JSON.stringify({ success: true, held: true }), { headers: corsH });
        }

        // ⚠ NEVER STORED — recomputed at request time from the fee config,
        // same reasoning as the market's own marketPayUrl(), which this
        // reuses verbatim: eventFeeConfig() already shapes an event row into
        // exactly the object it expects.
        const payUrl = price ? marketPayUrl(cfg, price.totalCents, value.qty || 1) : '';
        const allValues = { ...nonSensitive, ...sensitive };

        // Both emails are best-effort and neither is awaited into the
        // registrant's answer — the row is already saved.
        if (ev.coordinator_email) {
          ctx.waitUntil((async () => {
            const rows = fields.map((f) => `<p style="margin:0 0 6px"><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(String(allValues[f.key] == null ? '' : allValues[f.key]))}</p>`).join('');
            await sendTransactionalEmail(env, {
              subject: `${screen.suspect ? '[likely spam] ' : ''}${ev.name || 'Event'} sign-up — ${value.contact_name || value.contact_email || 'new'}`,
              htmlContent: `${screen.suspect ? '<p style="margin:0 0 12px;padding:10px 12px;background:#FAF0DC;border-left:3px solid #C9973A;"><strong>The spam filter scored this one as doubtful.</strong> It is almost certainly real — this note is just so you read it twice.</p>' : ''}${rows}${waitlisted ? '<p style="margin:12px 0 0;"><strong>Waitlisted</strong> — capacity was already reached.</p>' : ''}`,
              toEmails: [ev.coordinator_email],
              replyTo: value.contact_email ? { email: value.contact_email, name: value.contact_name || '' } : undefined,
            });
            // Suppressed for a suspect submission, same rule as the contact
            // and prayer forms (AW-5) — the address is attacker-supplied.
            if (!screen.suspect && value.contact_email) {
              await sendTransactionalEmail(env, {
                subject: `${ev.name || 'Event'} — you're signed up`,
                htmlContent: `<p>Thanks for signing up${value.contact_name ? `, ${escapeHtml(value.contact_name)}` : ''}!</p>${waitlisted ? '<p>Capacity is full right now, so you are on the waitlist — we will reach out if a spot opens.</p>' : ''}${payUrl ? `<p><a href="${escapeHtml(payUrl)}">Pay online</a></p>` : ''}`,
                toEmails: [value.contact_email],
              });
            }
          })());
        }

        ctx.waitUntil(pushToAllSubscribers(env, {
          title: `${ev.name || 'Event'} sign-up`,
          body: `${value.contact_name || value.contact_email || 'Someone'}${waitlisted ? ' (waitlisted)' : ''}`,
          tag: `event-${eventId}`, url: '/events',
        }));

        return new Response(JSON.stringify({
          success: true, id, waitlisted,
          payUrl: payUrl || undefined,
          total: price ? marketMoney(price.totalCents) : undefined,
          totalCents: price ? price.totalCents : undefined,
        }), { headers: corsH });
      } catch (e) {
        console.error('Event registration failed:', e?.message);
        return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), { status: 500, headers: corsH });
      }
    }

    // ── PUBLIC: voters page data ──
    // ⚠ DELIBERATELY PUBLIC, AND NOT BECAUSE NOBODY LOOKED. The /voters page in
    // public/index.html fetches this with no credential, and there is no member
    // login anywhere on timothystl.org to gate it against — so "gate it" is a
    // sign-in feature, not a header. Whether a Zoom link and a set of council
    // reports should be behind one is the congregation's call; FX-12 in
    // CLAUDE.md is where that decision belongs. Recorded here so the next
    // reader knows it was weighed rather than missed.
    if (path === '/api/voters' && method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM voters_page WHERE id = 1').first();
      const data = row || { meeting_info: '', zoom_link: '', files_json: '[]' };
      let files = [];
      try { files = JSON.parse(data.files_json || '[]'); } catch(_) {}
      return new Response(JSON.stringify({ meeting_info: data.meeting_info || '', zoom_link: data.zoom_link || '', files }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60',
          // robots.txt covers timothystl.org/voters and says nothing about this
          // origin, so without this the meeting's Zoom link is a crawlable JSON
          // document. Keeping it out of an index is worth doing whichever way
          // the sign-in question above is answered.
          'X-Robots-Tag': 'noindex, nofollow',
        }
      });
    }

    // ── PUBLIC: custom redirects API ── only active rows resolve for visitors
    if (path === '/api/redirects' && method === 'GET') {
      // ⚠ The four NFC taps are in their own table and are served from here
      // too. They were not, which meant /tap1 … /tap4 — the addresses actually
      // printed on the physical tags — resolved to nothing: the admin let
      // somebody re-point a tap, and the tap 404'd. The whole premise of the
      // feature is "the tag only ever holds its short address, so re-pointing
      // is a click"; that only holds if the short address answers.
      //
      // A hand-made redirect at the same path wins, so the office can always
      // override one without touching the taps screen.
      const [rows, taps] = await Promise.all([
        env.DB.prepare('SELECT path, url, label FROM redirects WHERE active != 0 ORDER BY path').all(),
        env.DB.prepare('SELECT id, name, destination FROM taps WHERE active != 0 ORDER BY id').all().catch(() => ({ results: [] })),
      ]);
      const byPath = new Map();
      for (const t of (taps.results || [])) {
        if (t.destination) byPath.set(`tap${t.id}`, { path: `tap${t.id}`, url: t.destination, label: t.name || `Tap ${t.id}` });
      }
      for (const r of (rows.results || [])) byPath.set(r.path, r);
      return new Response(JSON.stringify({ redirects: [...byPath.values()] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' }
      });
    }

    // ── PUBLIC: a tap was used ───────────────────────────────────────────────
    // Recorded here because this is the only place that can write to D1 — the
    // resolution itself happens in site-worker.js from a cached list, which is
    // exactly why the count did not exist until now.
    //
    // ⚠ Best-effort by design. The site worker sends this with waitUntil and
    // never waits for it, and this route always answers 200. A tap that fails
    // to be counted is a missing number; a tap that fails to *resolve* is a
    // physical tag on a pew rack that goes nowhere. The second one must never
    // be able to happen because of the first, so nothing about counting is
    // allowed to sit in the visitor's path or to report an error into it.
    if (path === '/api/tap-hit' && method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const known = await env.DB.prepare('SELECT id FROM taps').all().catch(() => ({ results: [] }));
        const id = validTapId(body && body.tap, (known.results || []).map((r) => r.id));
        // Not a tag that exists. Dropped rather than creating a bucket for a
        // tap nobody has — the ids are the printed addresses, not a sequence.
        if (id) {
          const now = new Date();
          await env.DB.prepare(
            'INSERT INTO tap_hits (tap_id, day, hits) VALUES (?, ?, 1) ' +
            'ON CONFLICT(tap_id, day) DO UPDATE SET hits = hits + 1'
          ).bind(id, dayKey(now)).run();
          // The lifetime figure lives on the tap row, so "has this ever been
          // counted?" needs no scan of the buckets.
          await env.DB.prepare('UPDATE taps SET scans = COALESCE(scans, 0) + 1 WHERE id = ?').bind(id).run();
        }
      } catch (_) {}
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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

    // ── PUBLIC: give.timothystl.org, as a page ───────────────────────────────
    // One request for everything site-worker.js needs to build that hostname:
    // the published blocks if there are any, the editable chrome, the church
    // details for the footer, and the amounts/funds/base link.
    //
    // ⚠ The amounts, funds and base link are returned WHETHER OR NOT the page
    // has been published, because they are what the hardcoded fallback in
    // give-landing.js needs. The fallback is not decoration — this is the page
    // that takes the money, and it has to keep taking it when a block render
    // is unavailable. Returning them here is what lets site-worker.js drop
    // from "blocks" to "fallback" without a second round trip on the slow
    // path.
    //
    // `html` empty means "not published yet", which is a normal state and the
    // one every deploy starts in. It is not an error and site-worker.js must
    // not treat it as one.
    if (path === '/api/give-page' && method === 'GET') {
      const data = await pageData(env, ctx);
      const row = await env.DB.prepare('SELECT template, published_blocks FROM pages WHERE id = ?')
        .bind(GIVE_LANDING_PAGE_ID).first().catch(() => null);
      const blocks = sanitizeBlocks(parseBlocks(row && row.published_blocks));
      const rendered = blocks.length
        ? fixImageUrls(renderPage(blocks, { slug: GIVE_LANDING_PAGE_ID, template: (row && row.template) || 'standard', data, withCss: false }))
        : '';
      return new Response(JSON.stringify({
        html: rendered,
        css: rendered ? BLOCK_CSS : '',
        appearance: data.appearance,
        details: data.settings,
        baseUrl: data.give.baseUrl,
        tiers: data.give.tiers,
        funds: data.give.funds,
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' },
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
    if (isPortalPath(path)) {
      const po = await portalOrigin(env);
      // Once the portal has a public address, the admin domain stops serving
      // renter content and sends anybody holding an old link to the new one.
      // 301 rather than 302 because the address really has moved — and the
      // iCal feed matters most here: it is subscribed inside people's calendar
      // apps, so without this their calendar would simply stop updating with
      // no error anywhere.
      if (po && url.origin === ADMIN_ORIGIN) {
        return new Response('', { status: 301, headers: { Location: po + path + url.search } });
      }
      const r = await handleGymRoutes(path, method, url, request, env, null, ctx, po);
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

    // First-run only: once a user exists this database can never go back to
    // zero from the admin (the last account cannot delete itself), so the
    // COUNT is remembered per binding instead of being paid on every screen.
    if (!SETUP_DONE.get(env.DB)) {
      const setupCheck = await env.DB.prepare('SELECT COUNT(*) as n FROM users').first().catch(() => ({ n: 1 }));
      if (!setupCheck || setupCheck.n === 0) {
        return new Response('', { status: 302, headers: { Location: '/setup' } });
      }
      SETUP_DONE.set(env.DB, true);
    }
    const currentUser = await getSession(env.DB, request);
    if (!currentUser) {
      if (path === '/login') return loginPage();
      return loginPage();
    }

    // The sidebar badges, once per request. Screens used to call badgeCounts
    // themselves — the dashboard paid for it twice, and two dozen edit
    // screens (and every gym screen) passed nothing at all, so the badges
    // visibly vanished the moment somebody clicked into an edit form and
    // reappeared on the way back. One memoized promise, handed to every
    // sidebarShell call.
    let _badgesPromise = null;
    const pageBadges = () => (_badgesPromise ||= badgeCounts(env, currentUser));

    // ── EVERY ADDRESS ON THIS SITE THAT ANSWERS ──────────────────────────────
    // Feeds the block editor's link picker and its dead-link check. Memoized
    // per request, the same way the badges are, because both editor mounts ask
    // for it and it is two reads.
    //
    // ⚠ THREE SOURCES, NOT ONE. A check that knew only about page slugs would
    // flag /music and /zoom — the short link and the redirect — and those are
    // exactly the addresses the church prints on flyers and says from the
    // pulpit. Warning about the two most-used kinds of link on the site is how
    // a warning stops being read.
    //
    // ⚠ NOT scoped to what the signed-in person may EDIT. A ministry leader
    // who can only edit their own page still needs to link to /worship, and
    // the rail's `openable` list is filtered by ownership. Different question,
    // different query.
    let _targetsPromise = null;
    const linkTargets = () => (_targetsPromise ||= (async () => {
      const out = [];
      try {
        const rows = (await env.DB.prepare(
          "SELECT id, title, menu_label, slug, short_link, status FROM pages WHERE status = 'published'"
        ).all()).results || [];
        for (const r of rows) {
          const label = r.menu_label || r.title || r.slug;
          out.push({ url: r.slug, label, kind: 'page' });
          const short = shortLinkFor(r);
          // Only when it is genuinely a different address — shortLinkFor
          // returns the last segment, which for a top-level page IS the slug.
          if (short && short !== r.slug) out.push({ url: short, label, kind: 'short' });
        }
      } catch (_) { /* an unreadable page list means no picker, never a failed render */ }
      try {
        const rows = (await env.DB.prepare(
          'SELECT path, label FROM redirects WHERE active != 0'
        ).all()).results || [];
        for (const r of rows) out.push({ url: r.path, label: r.label || r.path, kind: 'redirect' });
      } catch (_) {}
      return out;
    })());

    // ── PUSH NOTIFICATIONS: subscribe / unsubscribe ──
    // Any signed-in account may opt its own browser in — this is a personal
    // "ring this device" preference, not a permission, and it carries no
    // content of its own (see the push payloads below, which are all just
    // "something is waiting, go look"). One row per browser, not per user:
    // the same person subscribing from a desktop and a phone should get both.
    if (path === '/api/push/subscribe' && method === 'POST') {
      try {
        const sub = await request.json();
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
          return new Response(JSON.stringify({ error: 'Invalid subscription' }), { status: 400 });
        }
        await env.DB.prepare(
          `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
        ).bind(currentUser.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth).run();
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Could not save subscription' }), { status: 500 });
      }
    }
    if (path === '/api/push/unsubscribe' && method === 'POST') {
      try {
        const { endpoint } = await request.json();
        if (endpoint) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Could not remove subscription' }), { status: 500 });
      }
    }

    // ── DASHBOARD (new post-login landing page) ──
    if (path === '/dashboard' && method === 'GET') {
      // Two layouts behind one toggle. "Needs you" is the daily home screen —
      // a worklist you clear, not a wall of numbers. "Overview" is the tiles
      // for anyone who wants the shape of the week at a glance.
      const view = url.searchParams.get('view') === 'overview' ? 'overview' : 'needs';
      const canNews = hasPermission(currentUser, 'news_edit');
      const canDraft = hasPermission(currentUser, 'newsletter_edit') || hasPermission(currentUser, 'newsletter_approve');
      const canApprove = hasPermission(currentUser, 'newsletter_approve');
      const canGym = hasPermission(currentUser, 'gym_manage');
      const canPages = hasPermission(currentUser, 'pages_edit') || hasPermission(currentUser, 'pages_edit_own');
      const canMinistries = hasPermission(currentUser, 'ministries_edit');

      const badges = await pageBadges();
      const q = async (sql, ...binds) => {
        try { return (await env.DB.prepare(sql).bind(...binds).all()).results || []; } catch (_) { return []; }
      };
      const one = async (sql, ...binds) => {
        try { return await env.DB.prepare(sql).bind(...binds).first(); } catch (_) { return null; }
      };

      // ── "Needs you": the worklist ────────────────────────────
      // Each entry is a glyph, what needs doing, the specifics, and one button
      // that deep-links to the screen where it gets done. Anything that cannot
      // name a specific next action does not belong here.
      const tasks = [];

      if (canGym && badges.gym > 0) {
        const groups = await q(
          `SELECT gg.name AS name, COUNT(*) AS n
             FROM gym_bookings gb LEFT JOIN gym_groups gg ON gg.id = gb.group_id
            WHERE gb.status='hold' GROUP BY gb.group_id ORDER BY MIN(gb.hold_expires_at) ASC LIMIT 4`
        );
        tasks.push({
          glyph: '🏀',
          title: `${pluralise(badges.gym, 'gym request', 'gym requests')} waiting for review`,
          detail: groups.map((g) => escapeHtml(g.name || 'Unassigned group')).join(' · ') || 'Holds lapse after 48 hours if nobody confirms them.',
          action: 'Review', href: '/gym-rentals',
        });
      }

      if (canPages && badges.pages > 0) {
        const drafts = await q(
          `SELECT title, updated_by, updated_at FROM pages
            WHERE status='draft' OR COALESCE(blocks,'') <> COALESCE(published_blocks,'')
            ORDER BY COALESCE(updated_at,'') DESC LIMIT 4`
        );
        tasks.push({
          glyph: '📄',
          title: `${pluralise(badges.pages, 'page has', 'pages have')} unpublished edits`,
          detail: drafts.map((d) => `${escapeHtml(d.title)}${d.updated_by ? ` (${escapeHtml(d.updated_by)})` : ''}`).join(' · '),
          action: 'Open', href: '/pages?filter=draft',
        });
      }

      if (canApprove && badges.newsletter > 0) {
        const pending = await q("SELECT id, subject FROM newsletters WHERE approval_status='pending' ORDER BY created_at ASC LIMIT 3");
        tasks.push({
          glyph: '✉️',
          title: `${pluralise(badges.newsletter, 'newsletter is', 'newsletters are')} awaiting approval`,
          detail: pending.map((p) => `“${escapeHtml(p.subject || 'Untitled')}”`).join(' · '),
          action: 'Review', href: pending.length === 1 ? `/edit/${pending[0].id}` : '/',
        });
      }

      // Held mail is invisible by design — the sender is told it went through —
      // so this row is the only way anyone learns a real prayer request was
      // caught. Removing it makes holding silently lossy.
      if (hasPermission(currentUser, 'settings_manage')) {
        const held = await heldCount(env);
        if (held > 0) {
          tasks.push({
            glyph: '🛡️',
            title: `${pluralise(held, 'website message', 'website messages')} held as spam`,
            detail: 'Release anything that turns out to be a real person writing in.',
            action: 'Review', href: '/filtered',
          });
        }
      }

      if (canNews) {
        const soon = await q(
          "SELECT id, title, expire_date FROM news_items WHERE expire_date IS NOT NULL AND expire_date >= date('now') AND expire_date <= date('now','+3 days') ORDER BY expire_date ASC LIMIT 4"
        );
        if (soon.length) {
          tasks.push({
            glyph: '📰',
            title: `${pluralise(soon.length, 'news post', 'news posts')} about to expire`,
            detail: soon.map((s) => `“${escapeHtml(s.title)}” on ${escapeHtml(s.expire_date)}`).join(' · '),
            action: 'Extend', href: soon.length === 1 ? `/newsitems/edit/${soon[0].id}` : '/newsitems?filter=live',
          });
        }
      }

      if (canMinistries) {
        const emptyPages = await q(
          "SELECT slug, title FROM youth_pages WHERE COALESCE(TRIM(content),'') = '' AND COALESCE(TRIM(blocks),'') = '' ORDER BY slug LIMIT 5"
        );
        if (emptyPages.length) {
          tasks.push({
            glyph: '✏️',
            title: `${pluralise(emptyPages.length, 'ministry page is', 'ministry pages are')} still empty`,
            detail: emptyPages.map((p) => escapeHtml(p.title || p.slug)).join(' · '),
            action: 'Fill in', href: '/ministries',
          });
        }
      }

      const tasksHtml = tasks.length === 0
        ? `<div class="tlc-task-clear">Nothing is waiting on you. 🎉</div>`
        : tasks.map((t) => `<div class="tlc-task">
    <span class="tlc-task-glyph" aria-hidden="true">${t.glyph}</span>
    <span class="tlc-task-text">
      <span class="tlc-task-title">${t.title}</span>
      ${t.detail ? `<span class="tlc-task-detail">${t.detail}</span>` : ''}
    </span>
    <a class="tlc-task-btn" href="${t.href}">${t.action}</a>
  </div>`).join('');

      // ── Our Four Values ──────────────────────────────────────
      // The only screen in the admin that reports on the church's own stated
      // priorities rather than on content mechanics: how many ministries carry
      // each value, what has been posted under it lately, and which partner
      // ministry is paired to it.
      const [ministryCounts, recentPosts, partnerRows] = await Promise.all([
        q("SELECT value, COUNT(*) AS n FROM youth_pages WHERE value IS NOT NULL AND value <> '' GROUP BY value"),
        q(`SELECT yp.value AS value, COUNT(*) AS n
             FROM ministry_posts mp JOIN youth_pages yp ON yp.slug = mp.ministry_slug
            WHERE COALESCE(mp.post_date, mp.created_at) >= date('now','-30 days')
            GROUP BY yp.value`),
        q('SELECT name, short_name, value, site_url, also_note FROM partners'),
      ]);
      const mCount = Object.fromEntries(ministryCounts.map((r) => [r.value, r.n]));
      const pCount = Object.fromEntries(recentPosts.map((r) => [r.value, r.n]));
      const partnerByValue = Object.fromEntries(partnerRows.map((r) => [r.value, r]));

      const valuesHtml = VALUES.map((v) => {
        const ministries = mCount[v.key] || 0;
        const posts = pCount[v.key] || 0;
        const partner = partnerByValue[v.key];
        return `<div class="tlc-value-card" style="background:${v.tint};">
    <div class="tlc-value-top" style="background:${v.ink};">
      <span class="tlc-value-short">${escapeHtml(v.short)}</span>
      <span class="tlc-value-name">${escapeHtml(v.name)}</span>
    </div>
    <div class="tlc-value-body">
      <span class="tlc-value-stat">${pluralise(ministries, 'ministry', 'ministries')} · ${pluralise(posts, 'recent post', 'recent posts')}</span>
      <span class="tlc-value-partner">${partner
        ? `Partner · <b>${escapeHtml(partner.name)}</b>`
        : 'No partner ministry paired to this value yet.'}</span>
      ${posts === 0 ? `<span class="tlc-value-quiet">Nothing new posted under this value in a month.</span>` : ''}
    </div>
  </div>`;
      }).join('');

      // ── This Sunday ──────────────────────────────────────────
      // Read from the one church-details record every page reads, so the
      // dashboard cannot drift from the footer and the contact page.
      const svcRow = await one("SELECT value FROM site_settings WHERE key='church_service_times'");
      const services = parseServiceTimes(svcRow?.value || '');
      const nextSermon = await one(
        `SELECT n.title, n.date, n.scripture, n.youtube_url, n.audio_url, s.title AS series
           FROM sermon_notes n LEFT JOIN sermon_series s ON s.id = n.series_id
          ORDER BY COALESCE(n.date,'') DESC, n.id DESC LIMIT 1`
      );
      const sundayHtml = services.length
        ? services.map((s) => `<div class="tlc-sunday">
      <span class="tlc-sunday-time">${escapeHtml(s.time)}</span>
      <span class="tlc-sunday-what">${escapeHtml(s.day)}${s.note ? `<span class="tlc-sunday-note">${escapeHtml(s.note)}</span>` : ''}</span>
    </div>`).join('')
        : `<div class="tlc-task-clear" style="padding:20px;">No service times set yet.</div>`;
      const sermonLine = nextSermon
        ? `<div class="tlc-sunday" style="border-bottom:0;padding-top:12px;">
      <span class="tlc-sunday-time">Sermon</span>
      <span class="tlc-sunday-what">${escapeHtml(nextSermon.title || 'Untitled')}
        <span class="tlc-sunday-note">${[nextSermon.series, nextSermon.scripture].filter(Boolean).map(escapeHtml).join(' · ') || 'No series or reading recorded'}${(nextSermon.youtube_url || nextSermon.audio_url) ? '' : ' · no recording attached'}</span>
      </span>
    </div>`
        : '';

      // ── Last 24 hours ────────────────────────────────────────
      const tail = await q(
        "SELECT username, action, entity_type, entity_label, created_at FROM audit_log WHERE created_at >= datetime('now','-1 day') ORDER BY created_at DESC LIMIT 8"
      );
      const timeAgo = (iso) => {
        if (!iso) return '';
        const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return pluralise(mins, 'minute') + ' ago';
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return pluralise(hrs, 'hour') + ' ago';
        return pluralise(Math.round(hrs / 24), 'day') + ' ago';
      };
      const tailHtml = tail.length === 0
        ? `<div class="tlc-task-clear" style="padding:20px;">Nothing changed in the last day.</div>`
        : tail.map((a) => `<div class="tlc-tail">
      <b>${escapeHtml(a.username || 'Someone')}</b> ${escapeHtml(a.action)}d a ${escapeHtml((a.entity_type || '').replace(/_/g, ' '))}${a.entity_label ? ` — “${escapeHtml(a.entity_label)}”` : ''}
      <span class="tlc-tail-when">${timeAgo(a.created_at)}</span>
    </div>`).join('');

      // The real audience is the Brevo list, not the local signup table —
      // that table only holds website-form signups and badly undercounts an
      // audience also built from Breeze imports/manual adds. Falls back to
      // the local count (rather than showing nothing) if Brevo can't be reached.
      const subscriberCount = async () => {
        const n = await getBrevoListCount(env, parseInt(env.BREVO_LIST_ID || '0', 10));
        return n != null ? { n } : one('SELECT COUNT(*) AS n FROM newsletter_subscribers');
      };

      // ── "Overview": the same week as four numbers ────────────
      // Counted only when the Overview layout is the one being rendered.
      // "Needs you" is the default screen everybody lands on, and it was
      // paying four COUNT queries for tiles it never drew.
      const [liveNews, liveMinistries, subscribers, upcomingBookings] = view === 'overview' ? await Promise.all([
        canNews ? one("SELECT COUNT(*) AS n FROM news_items WHERE expire_date IS NULL OR expire_date >= date('now')") : null,
        one("SELECT COUNT(*) AS n FROM youth_pages"),
        hasPermission(currentUser, 'settings_manage') ? subscriberCount() : null,
        canGym ? one("SELECT COUNT(*) AS n FROM gym_bookings WHERE status='confirmed' AND booking_date >= date('now')") : null,
      ]) : [null, null, null, null];
      const tiles = [
        liveNews ? { label: 'Live on the site', num: liveNews.n, note: 'News posts not yet expired' } : null,
        liveMinistries ? { label: 'Ministry pages', num: liveMinistries.n, note: 'Each one owned by somebody' } : null,
        subscribers ? { label: 'Subscribers', num: subscribers.n, note: 'Receiving the newsletter' } : null,
        upcomingBookings ? { label: 'Gym bookings', num: upcomingBookings.n, note: 'Confirmed, still to come' } : null,
      ].filter(Boolean);
      const tilesHtml = tiles.length
        ? `<div class="tlc-tiles">${tiles.map((t) => `<div class="tlc-tile">
      <span class="tlc-tile-label">${escapeHtml(t.label)}</span>
      <span class="tlc-tile-num">${t.num}</span>
      <span class="tlc-tile-note">${escapeHtml(t.note)}</span>
    </div>`).join('')}</div>`
        : '';
      const jumpHtml = [
        canNews ? '<a href="/newsitems/new">+ News post</a>' : '',
        canDraft ? '<a href="/new">+ Newsletter</a>' : '',
        hasPermission(currentUser, 'notices_edit') ? '<a href="/notices/add">+ Notice</a>' : '',
        canGym ? '<a href="/gym-rentals">Gym rentals</a>' : '',
        canPages ? '<a href="/pages">All pages</a>' : '',
      ].filter(Boolean).join('');

      // ⚠ In church time, not the Worker's UTC. This greeting is what surfaced
      // the whole bug: it read "Friday morning" on a Thursday evening, because
      // 8pm in St. Louis is already 1am the next day in UTC. See admin/when.js.
      const weekday = churchFormat({ weekday: 'long' });
      const longDate = churchFormat({ weekday: 'long', day: 'numeric', month: 'long' });

      const needsBody = `
  ${panel(`Needs you${tasks.length ? ` · ${tasks.length}` : ''}`, tasksHtml, { right: escapeHtml(longDate), pad: false })}
  <div class="tlc-eyebrow">
    <span class="tlc-eyebrow-label">Our four values</span>
    <span class="tlc-eyebrow-note">From our neighborhood to the nations</span>
  </div>
  <div class="tlc-values">${valuesHtml}</div>
  <div style="height:18px;"></div>
  <div class="tlc-dash-grid">
    ${panel('This Sunday', sundayHtml + sermonLine, { pad: true })}
    ${panel('Last 24 hours', tailHtml, { right: `<a href="/audit-log" style="color:var(--tlc-blue);text-decoration:none;">Full log</a>` })}
  </div>`;

      const overviewBody = `
  ${tilesHtml}
  <div class="tlc-dash-grid">
    ${panel(`Needs you${tasks.length ? ` · ${tasks.length}` : ''}`, tasksHtml, { pad: false })}
    <div class="tlc-stack">
      ${jumpHtml ? panel('Jump to', `<div class="tlc-jump">${jumpHtml}</div>`) : ''}
      ${panel('Last 24 hours', tailHtml, { right: `<a href="/audit-log" style="color:var(--tlc-blue);text-decoration:none;">Full log</a>` })}
    </div>
  </div>`;

      return html(`
${sidebarShell('dashboard', currentUser, '', badges)}
<div class="tlc-dash">
  <div class="tlc-dash-head">
    <div>
      <h1 class="tlc-dash-greeting">${escapeHtml(weekday)} ${escapeHtml(partOfDay())}</h1>
      <p class="tlc-dash-sub">What needs you today, what happens Sunday, and what changed since yesterday.</p>
    </div>
    <nav class="tlc-seg" aria-label="Dashboard view">
      <a href="/dashboard" class="${view === 'needs' ? 'is-on' : ''}">Needs you</a>
      <a href="/dashboard?view=overview" class="${view === 'overview' ? 'is-on' : ''}">Overview</a>
    </nav>
  </div>
  ${view === 'overview' ? overviewBody : needsBody}
</div>`, 'Dashboard — TLC Admin');
    }

    // ── ⌘K — one search over every section ─────────────────────
    // Returns "Section · row" results, permission-scoped, so somebody who
    // cannot open Payroll never sees a payroll row in their results. Searching
    // is not a way around a permission gate.
    if (path === '/api/search' && method === 'GET') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      if (q.length < 2) return jsonResponse({ results: [] });
      const like = `%${q}%`;
      const hp = (p) => hasPermission(currentUser, p);
      const grab = async (sql, ...binds) => {
        try { return (await env.DB.prepare(sql).bind(...binds).all()).results || []; } catch (_) { return []; }
      };

      const sources = [
        { on: hp('pages_edit') || hp('pages_edit_own'), section: 'Pages',
          sql: 'SELECT id, title, slug FROM pages WHERE LOWER(title) LIKE ? OR LOWER(slug) LIKE ? LIMIT 5',
          map: (r) => ({ label: r.title, meta: r.slug, href: `/pages/${encodeURIComponent(r.id)}/edit` }) },
        { on: hp('ministries_edit'), section: 'Ministries',
          sql: 'SELECT slug, title FROM youth_pages WHERE LOWER(title) LIKE ? OR LOWER(slug) LIKE ? LIMIT 5',
          map: (r) => ({ label: r.title || r.slug, meta: `/${r.slug}`, href: `/ministries/editor/${encodeURIComponent(r.slug)}` }) },
        { on: hp('news_edit'), section: 'News & Events',
          sql: 'SELECT id, title, publish_date FROM news_items WHERE LOWER(title) LIKE ? OR LOWER(COALESCE(summary,\'\')) LIKE ? ORDER BY publish_date DESC LIMIT 5',
          map: (r) => ({ label: r.title, meta: r.publish_date || '', href: `/newsitems/edit/${r.id}` }) },
        { on: hp('newsletter_edit') || hp('newsletter_approve'), section: 'Newsletter',
          sql: 'SELECT id, subject, published_at FROM newsletters WHERE LOWER(subject) LIKE ? OR LOWER(COALESCE(preheader,\'\')) LIKE ? ORDER BY published_at DESC LIMIT 5',
          map: (r) => ({ label: r.subject || 'Untitled', meta: r.published_at || '', href: `/edit/${r.id}` }) },
        { on: hp('sermons_edit'), section: 'Sermons',
          sql: 'SELECT id, title, date FROM sermon_notes WHERE LOWER(COALESCE(title,\'\')) LIKE ? OR LOWER(COALESCE(scripture,\'\')) LIKE ? ORDER BY date DESC LIMIT 5',
          map: (r) => ({ label: r.title || 'Untitled', meta: r.date || '', href: `/sermons/edit-note/${r.id}` }) },
        { on: hp('staff_edit'), section: 'Staff',
          sql: 'SELECT id, name, title FROM staff_members WHERE LOWER(name) LIKE ? OR LOWER(COALESCE(title,\'\')) LIKE ? LIMIT 5',
          map: (r) => ({ label: r.name, meta: r.title || '', href: `/staff/edit/${r.id}` }) },
        { on: hp('notices_edit'), section: 'Notices',
          sql: 'SELECT id, label, page_slug FROM notices WHERE LOWER(label) LIKE ? OR LOWER(page_slug) LIKE ? LIMIT 5',
          map: (r) => ({ label: r.label, meta: `on ${r.page_slug}`, href: `/notices/edit/${r.id}` }) },
        { on: hp('news_edit'), section: 'Christian Ed',
          sql: 'SELECT id, title, schedule FROM bible_classes WHERE LOWER(title) LIKE ? OR LOWER(COALESCE(leader,\'\')) LIKE ? LIMIT 5',
          map: (r) => ({ label: r.title, meta: r.schedule || '', href: `/christian-education/edit/${r.id}` }) },
        { on: hp('gym_manage'), section: 'Gym Rentals',
          sql: 'SELECT id, name, email FROM gym_groups WHERE LOWER(name) LIKE ? OR LOWER(COALESCE(email,\'\')) LIKE ? LIMIT 5',
          map: (r) => ({ label: r.name, meta: r.email || '', href: '/gym-rentals/groups' }) },
        { on: hp('users_manage'), section: 'Users',
          sql: 'SELECT id, username, email FROM users WHERE LOWER(username) LIKE ? OR LOWER(COALESCE(email,\'\')) LIKE ? LIMIT 5',
          map: (r) => ({ label: r.username, meta: r.email || '', href: `/users/edit/${r.id}` }) },
        { on: hp('settings_manage'), section: 'Redirects',
          sql: 'SELECT path, url, label FROM redirects WHERE LOWER(path) LIKE ? OR LOWER(COALESCE(label,\'\')) LIKE ? LIMIT 5',
          map: (r) => ({ label: `/${r.path}`, meta: r.label || r.url, href: `/redirects/edit/${encodeURIComponent(r.path)}` }) },
      ];

      // Every permission-gated source ran one at a time — up to ten serial
      // D1 round-trips for one keystroke. They don't depend on each other, so
      // run them together; `active`'s order is what decides section order in
      // the results, not resolution order, so the palette groups the same way
      // it always did.
      const active = sources.filter((s) => s.on);
      const perSource = await Promise.all(active.map((s) => grab(s.sql, like, like)));
      const results = [];
      active.forEach((s, i) => {
        for (const r of perSource[i]) {
          results.push(Object.assign({ section: s.section }, s.map(r)));
        }
      });
      return jsonResponse({ results: results.slice(0, 40) });
    }
    // ── MEDIA ──────────────────────────────────────────────────
    // The library behind every page editor's photo picker. This screen exists
    // for the two things that actually go wrong: a file that slipped past the
    // 1MB target, and a photo with no alt text. Everything else about a photo
    // is managed where it is used.
    if (path === '/media' || path.startsWith('/media/')) {
      if (!hasPermission(currentUser, 'pages_edit') && !hasPermission(currentUser, 'ministries_edit')) {
        return new Response('Access denied.', { status: 403 });
      }

      if (path === '/media' && method === 'GET') {
        const [mediaRes, pagesRes, ministryRes] = await Promise.all([
          env.DB.prepare('SELECT * FROM ministry_media ORDER BY created_at DESC, id DESC').all().catch(() => ({ results: [] })),
          env.DB.prepare('SELECT id, title, menu_label, blocks, published_blocks FROM pages').all().catch(() => ({ results: [] })),
          env.DB.prepare('SELECT slug, title, blocks, published_blocks, hero_image_url FROM youth_pages').all().catch(() => ({ results: [] })),
        ]);
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'alt' ? `<div class="alert alert-success">✓ Alt text saved.</div>`
          : msg === 'deleted' ? `<div class="alert alert-info">Removed from the library. The file itself is still in storage, so anything already using it keeps working.</div>` : '';

        // "Used nowhere" is answered by searching every page's blocks for the
        // URL. Crude, but it is the honest answer — a photo is used if its
        // address appears in something that renders. Both the draft and the
        // published copy count: a picture in an unpublished draft is still
        // wanted, and telling somebody it is unused would invite them to delete
        // it out from under their own half-finished page.
        const haystacks = [];
        for (const p of (pagesRes.results || [])) {
          haystacks.push({ label: p.menu_label || p.title, text: `${p.blocks || ''}${p.published_blocks || ''}` });
        }
        for (const m of (ministryRes.results || [])) {
          haystacks.push({ label: m.title || m.slug, text: `${m.blocks || ''}${m.published_blocks || ''}${m.hero_image_url || ''}` });
        }
        // ⚠ Inverted, because the obvious way round is O(media × pages): every
        // media row scanning every page's block JSON with a substring search.
        // Each page is read ONCE here, its filenames pulled out into a map, and
        // a media row then costs one lookup. With dozens of pages and hundreds
        // of files that is the difference between thousands of scans over large
        // JSON blobs and one pass.
        //
        // It also happens to be more accurate. The old substring test said
        // `logo.png` was in use if a page mentioned `church-logo.png`, because
        // one filename contains the other. Matching whole filenames cannot make
        // that mistake — and a false "in use" is the worse direction here, since
        // it hides a file that could be cleaned up forever.
        const usageIndex = new Map();
        const FILENAME = /[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{2,5}/g;
        for (const h of haystacks) {
          for (const name of new Set(h.text.match(FILENAME) || [])) {
            if (!usageIndex.has(name)) usageIndex.set(name, []);
            usageIndex.get(name).push(h.label);
          }
        }
        const usedBy = (u) => {
          if (!u) return [];
          // The stored URL and the one written into a block can differ by
          // origin, so match on the filename tail rather than the whole thing.
          const tail = String(u).split('/').pop();
          if (!tail) return [];
          return usageIndex.get(tail) || [];
        };

        const OVER = 1024 * 1024;
        const prettyBytes = (n) => {
          if (!n) return 'Unknown';
          if (n < 1024) return `${n} B`;
          if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
          return `${(n / 1024 / 1024).toFixed(1)} MB`;
        };

        const listRows = (mediaRes.results || []).map((m) => {
          const uses = usedBy(m.url);
          const over = (m.bytes || 0) > OVER;
          const noAlt = m.kind === 'photo' && !String(m.alt || '').trim();
          const thumb = m.thumb_url || m.url;
          return {
            filter: [
              m.kind === 'photo' ? 'photos' : 'files',
              over ? 'over-1-mb' : '',
              noAlt ? 'needs-alt-text' : '',
              uses.length ? '' : 'unused',
            ].filter(Boolean),
            search: `${m.filename} ${m.alt || ''} ${uses.join(' ')}`.toLowerCase(),
            cells: [
              primaryCell(m.filename, uses.length ? `On ${uses.slice(0, 3).join(', ')}` : 'Used nowhere', {
                icon: m.kind === 'photo' ? `<img src="${escapeHtml(thumb)}" alt="">` : '▶', iconClass: 'file',
              }),
              // Missing alt text reads as a pill, not an empty box — the design
              // makes the gap look like something wrong rather than something
              // merely blank.
              noAlt ? statusPill('warn', 'No alt text yet') : escapeHtml(m.alt || ''),
              over ? `<strong style="color:#8A4A4A;">${prettyBytes(m.bytes)}</strong>` : escapeHtml(prettyBytes(m.bytes)),
            ],
            actions: rowActions(
              { label: 'Edit', href: `/media/edit/${m.id}` },
              [
                { label: 'Open the file', href: m.url },
                uses.length ? { label: `Used on ${uses[0]}`, href: '/pages' } : null,
              ]
            ),
            warn: over
              ? `${prettyBytes(m.bytes)} — over the 1MB target, so this page will be slow on a phone. Re-upload it and the editor will resize it on the way in.`
              : (noAlt ? 'No alt text, so anyone using a screen reader is told nothing about this picture.' : ''),
            warnCta: over ? { label: 'Re-upload', href: '/pages' } : null,
          };
        });

        return html(`
${sidebarShell('media', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'media',
    title: sectionCfg('media').title,
    purpose: sectionCfg('media').purpose,
    action: { label: sectionCfg('media').action, href: '/media/upload' },
    search: sectionCfg('media').search,
    filters: filtersOf('media'),
    columns: columnsOf('media'),
    rows: listRows,
    noun: 'file',
    empty: 'Nothing in the library yet.',
    note: sectionCfg('media').note,
  })}
</div>`, 'Media');
      }

      if (path.startsWith('/media/alt/') && method === 'POST') {
        const id = path.slice('/media/alt/'.length);
        const form = await request.formData();
        const before = await env.DB.prepare('SELECT filename, alt FROM ministry_media WHERE id = ?').bind(id).first();
        const alt = String(form.get('alt') || '').slice(0, 300);
        await env.DB.prepare('UPDATE ministry_media SET alt = ? WHERE id = ?').bind(alt, id).run();
        await logAudit(env.DB, currentUser, 'update', 'media', id, before?.filename || '', before, { alt });
        return new Response('', { status: 302, headers: { Location: '/media?msg=alt' } });
      }
    }
    // ── MENU ───────────────────────────────────────────────────
    // The second genuinely bespoke screen: a tree with drag-and-drop and a live
    // preview of the real header. Gated on pages_edit — whoever owns the site's
    // structure owns its navigation.
    if (path === '/menu' || path.startsWith('/menu/')) {
      if (!hasPermission(currentUser, 'pages_edit')) {
        return new Response('Access denied.', { status: 403 });
      }

      const loadMenu = async () => {
        const [items, pages] = await Promise.all([
          env.DB.prepare('SELECT * FROM menu_items ORDER BY menu, sort_order, id').all().catch(() => ({ results: [] })),
          env.DB.prepare('SELECT id, title, menu_label, slug, status FROM pages ORDER BY title').all().catch(() => ({ results: [] })),
        ]);
        const list = items.results || [];
        const pageRows = pages.results || [];
        return { list, pageRows, byId: new Map(pageRows.map((p) => [p.id, p])) };
      };


      // ── FOOTER COLUMNS ───────────────────────────────────────
      // A column is a heading and an order. Which links sit under it is the
      // links' business (menu_items.column_id), so nothing here ever writes
      // a list of items — a column and its contents cannot fall out of step
      // because only one of them records the relationship.
      if (path === '/menu/columns/new' || path.startsWith('/menu/columns/')) {
        const idPart = path.slice('/menu/columns/'.length);

        if (path === '/menu/columns/save' && method === 'POST') {
          const form = await request.formData();
          const id = parseInt(form.get('id'), 10);
          const heading = String(form.get('heading') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
          const source = normalizeSource(form.get('source'));
          // ⚠ A toggle posts a hidden 0 ahead of its checkbox, so form.get()
          // is the 0 either way and always reads as on.
          const visible = form.getAll('visible').includes('1') ? 1 : 0;
          if (!heading) return new Response('', { status: 302, headers: { Location: '/menu?msg=saved' } });
          if (Number.isFinite(id)) {
            const before = await env.DB.prepare('SELECT * FROM footer_columns WHERE id = ?').bind(id).first().catch(() => null);
            await env.DB.prepare('UPDATE footer_columns SET heading = ?, source = ?, visible = ? WHERE id = ?')
              .bind(heading, source, visible, id).run();
            await logAudit(env.DB, currentUser, 'update', 'footer_column', String(id), heading, before, { heading, source, visible });
          } else {
            const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM footer_columns').first().catch(() => ({ m: 0 }));
            await env.DB.prepare('INSERT INTO footer_columns (heading, source, sort_order, visible) VALUES (?, ?, ?, ?)')
              .bind(heading, source, ((max && max.m) || 0) + 10, visible).run();
            await logAudit(env.DB, currentUser, 'create', 'footer_column', heading, heading, null, { heading, source });
          }
          return new Response('', { status: 302, headers: { Location: '/menu?msg=saved' } });
        }

        // Deleting a column never deletes a link. The links fall out of any
        // column and show up in the "Not in a column" band, still on the site
        // — losing somebody's footer links because they tidied a heading is
        // exactly the silent damage this screen should not be able to do.
        if (path.startsWith('/menu/columns/delete/') && method === 'POST') {
          const id = parseInt(path.slice('/menu/columns/delete/'.length), 10);
          if (Number.isFinite(id)) {
            const before = await env.DB.prepare('SELECT * FROM footer_columns WHERE id = ?').bind(id).first().catch(() => null);
            await env.DB.prepare('UPDATE menu_items SET column_id = NULL WHERE column_id = ?').bind(id).run().catch(() => {});
            await env.DB.prepare('DELETE FROM footer_columns WHERE id = ?').bind(id).run();
            await logAudit(env.DB, currentUser, 'delete', 'footer_column', String(id), before ? before.heading : '', before, null);
          }
          return new Response('', { status: 302, headers: { Location: '/menu?msg=column-deleted' } });
        }

        if (method === 'GET') {
          const editing = idPart === 'new' ? null
            : await env.DB.prepare('SELECT * FROM footer_columns WHERE id = ?').bind(parseInt(idPart, 10)).first().catch(() => null);
          if (idPart !== 'new' && !editing) return new Response('', { status: 302, headers: { Location: '/menu' } });
          const inUse = editing
            ? await env.DB.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE column_id = ?').bind(editing.id).first().catch(() => ({ n: 0 }))
            : { n: 0 };
          return html(`
${sidebarShell('menu', currentUser, `<a href="/menu">← Menu</a>`, await pageBadges())}
<div class="tlc-wrap">
${renderFormSection({
  title: editing ? `The ${editing.heading} column` : 'A new footer column',
  purpose: 'A heading in the footer, and a place to drag links into. Which links sit under it is set by dragging them on the Menu screen.',
  action: '/menu/columns/save',
  cancelHref: '/menu',
  saveLabel: editing ? 'Save column' : 'Add column',
  deleteAction: editing ? `/menu/columns/delete/${editing.id}` : '',
  deleteLabel: 'Delete column',
  deleteConfirm: inUse.n
    ? `Delete the ${editing.heading} column? The ${inUse.n} link(s) in it stay on the site and move to "Not in a column" so you can put them somewhere else.`
    : 'Delete this column?',
  note: 'Deleting a column never deletes the links in it. They come out into "Not in a column" and keep showing on the site.',
  fields: [
    ...(editing ? [{ kind: 'html', html: `<input type="hidden" name="id" value="${editing.id}">` }] : []),
    { name: 'heading', label: 'Heading', value: editing ? editing.heading : '', required: true,
      hint: 'The word above the links. Short — it sits in a narrow column.' },
    { kind: 'chips', name: 'source', label: 'What is in it', value: editing ? editing.source : 'menu',
      options: [{ value: 'menu', label: 'Links I choose' }, { value: 'partners', label: 'Partner ministries' }] },
    { kind: 'html', html: '<p class="tlc-hint" style="margin-top:-10px;">A partner column fills itself from the partner ministries — one per core value — so there is nothing to drag into it.</p>' },
    { kind: 'toggle', name: 'visible', label: 'Column shown', value: editing ? !!editing.visible : true, on: 'Showing', off: 'Hidden' },
  ],
})}
</div>`, editing ? editing.heading : 'New footer column');
        }
      }

      // ── APPEARANCE ───────────────────────────────────────────
      // The header bar and the newsletter band. Everything else the Menu
      // screen writes is live the moment it is saved; this is the one part
      // that is drafted first, because somebody trying a color or cropping a
      // logo is experimenting, and an experiment that is instantly on the
      // front of the church website is not one. See admin/appearance.js.
      const chromeItems = (list, byId) =>
        menuTree(list, byId, 'header').filter((i) => i.visible && !i.broken).map((i) => ({ label: i.label, style: i.style }));

      if (path === '/menu/appearance' && method === 'GET') {
        const [{ list, byId }, chrome] = await Promise.all([loadMenu(), readChromePair(env)]);
        const items = chromeItems(list, byId);
        const msg = url.searchParams.get('msg');
        const a = chrome.draft;

        const swatches = (name, value, keys) => ({
          kind: 'swatch', name, value,
          options: CHROME_PALETTE.filter((c) => keys.includes(c.key))
            .map((c) => ({ value: c.key, label: c.label, color: c.value })),
        });

        // What differs, named. "You have unpublished changes" tells somebody
        // that something is waiting without telling them what, which is the
        // half of the message that would actually let them decide.
        const changed = chromeChanged(chrome.draft, chrome.live);
        const changedList = changed.map((k) => CHROME_LABELS[k]).filter(Boolean).join(', ');

        const alertHtml = msg === 'published' ? `<div class="alert alert-success">✓ Published — this is on the site now. It reaches visitors within about two minutes.</div>`
          : msg === 'saved' ? `<div class="alert alert-info">Draft saved. Nothing has reached the site yet — press Publish when it looks right.</div>`
          : msg === 'discarded' ? `<div class="alert alert-info">Draft thrown away. The screen is back to what is on the site.</div>` : '';

        // When there is something unpublished, the two bars are shown one
        // above the other rather than the draft alone. "Is this different from
        // what people are seeing?" is the question somebody actually has, and
        // a single bar cannot answer it.
        const previews = chrome.dirty
          ? `${panel('On the site now', renderHeaderPreview(chrome.live, items) + renderNewsletterPreview(chrome.live), { right: 'What visitors see' })}
             ${panel('Your draft', renderHeaderPreview(chrome.draft, items) + renderNewsletterPreview(chrome.draft), { right: 'Not published' })}`
          : panel('The site', renderHeaderPreview(chrome.draft, items, { note: 'This is what visitors see.' }) + renderNewsletterPreview(chrome.draft), { right: 'Published' });

        const publishBar = chrome.dirty
          ? `<div class="alert alert-warn" style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
               <span>Not published yet${changedList ? ` — ${escapeHtml(changedList)}` : ''}. Visitors still see the bar above.</span>
               <span style="display:flex;gap:8px;">
                 <form method="POST" action="/menu/appearance/discard" style="margin:0;" onsubmit="return confirm('Throw away the draft and go back to what is on the site?')"><button type="submit" class="tlc-btn-quiet">Discard draft</button></form>
                 <form method="POST" action="/menu/appearance/publish" style="margin:0;"><button type="submit" class="tlc-btn-primary">Publish to the site</button></form>
               </span>
             </div>`
          : `<div class="alert alert-info">Everything on this screen is on the site. Changes you make below are saved as a draft first.</div>`;

        return html(`
${sidebarShell('menu', currentUser, `<a href="/menu">← Menu</a>`, await pageBadges())}
<div class="tlc-wrap">
${renderFormSection({
  title: 'Appearance',
  purpose: 'The header bar and the newsletter band — the two parts of the site that are on every page. Changes are saved as a draft and only reach visitors when you press Publish.',
  action: '/menu/appearance/save',
  cancelHref: '/menu',
  cancelLabel: 'Back to Menu',
  saveLabel: 'Save draft',
  extraHead: alertHtml + publishBar + previews,
  note: 'Colors come from the church palette rather than a color picker: the words in the bar are white and cannot be changed, so a pale color here would be a header nobody can read — on every page at once.',
  fields: [
    // ⚠ Sits ABOVE the header fields, and not because it is the most-used
    // control — it is the widest-reaching one, and putting it under a heading
    // that says "The header" would tell somebody it only changes the bar.
    { kind: 'html', html: '<div class="tlc-field"><span class="tlc-label">The whole site</span></div>' },
    { kind: 'chips', name: 'typeface', label: 'Typeface', value: a.typeface,
      options: TYPEFACES.map((t) => ({ value: t.key, label: t.label })) },
    { kind: 'html', html: '<p class="tlc-hint" style="margin-top:-10px;">'
      + escapeHtml(TYPEFACES.map((t) => t.label + ' — ' + t.note).join('  ')) + '</p>' },
    { kind: 'chips', name: 'textSize', label: 'Text size', value: a.textSize,
      options: TEXT_SIZES.map((t) => ({ value: t.key, label: t.label })) },
    { kind: 'html', html: '<p class="tlc-hint" style="margin-top:-10px;">'
      + escapeHtml(TEXT_SIZES.map((t) => t.label + ' — ' + t.note).join('  ')) + '</p>' },
    { kind: 'html', html: '<p class="tlc-hint" style="margin-top:-4px;">Text size multiplies every size on the site rather than replacing them, so the proportions stay as they were designed. Headings move less than body copy on purpose \u2014 a hero title scaled as hard as a paragraph pushes the first line of the page off the screen.</p>' },
    { kind: 'html', html: '<p class="tlc-hint" style="margin-top:-4px;">This is the one setting here that is not just the header. It changes every heading and every paragraph on every page, and every block in the page editor — there is deliberately no way to set a font on one page or one block, because that is how a site ends up reading like two sites. Like everything else on this screen it is a draft until you publish.</p>' },

    { kind: 'html', html: '<div class="tlc-field" style="margin-top:26px;"><span class="tlc-label">The header</span></div>' },
    { kind: 'photo', name: 'logo_url', label: 'Logo', value: a.logo_url,
      hint: 'Shown at 44 pixels. A square picture crops best. Leave it empty to show the church name on its own.' },
    { kind: 'chips', name: 'logo_shape', label: 'Logo shape', value: a.logo_shape,
      options: [{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }] },
    { name: 'brand_name', label: 'Church name', value: a.brand_name,
      hint: 'The words beside the logo. This is also the link back to the homepage.' },
    { name: 'tagline', label: 'Tagline', value: a.tagline,
      hint: 'The small gold line under the name.' },
    { kind: 'toggle', name: 'show_tagline', label: 'Tagline shown', value: a.show_tagline, on: 'Showing', off: 'Hidden' },
    swatches('bar', a.bar, BAR_KEYS),
    { kind: 'html', html: '<p class="tlc-hint" style="margin-top:-10px;">The bar color. Gold is not offered here — white text on gold cannot be read.</p>' },
    swatches('rule', a.rule, CHROME_PALETTE.map((c) => c.key)),
    { kind: 'html', html: '<p class="tlc-hint" style="margin-top:-10px;">The line along the bottom of the bar.</p>' },
    swatches('cta', a.cta, CHROME_PALETTE.map((c) => c.key)),
    { kind: 'html', html: '<p class="tlc-hint" style="margin-top:-10px;">The Give button.</p>' },

    { kind: 'html', html: '<div class="tlc-field" style="margin-top:26px;"><span class="tlc-label">The newsletter band</span><p class="tlc-hint">The sign-up strip above the footer. It is on every page of the site, not just the homepage — which is why it is edited here and not in the page editor.</p></div>' },
    { kind: 'toggle', name: 'nl_show', label: 'Newsletter band', value: a.nl_show, on: 'On every page', off: 'Off everywhere' },
    swatches('nl_bg', a.nl_bg, BAR_KEYS),
    { name: 'nl_eyebrow', label: 'Small line above the heading', value: a.nl_eyebrow },
    { name: 'nl_heading', label: 'Heading', value: a.nl_heading },
    { kind: 'textarea', name: 'nl_body', label: 'Wording', value: a.nl_body, rows: 3 },
    { name: 'nl_button', label: 'Button label', value: a.nl_button },
  ],
})}
</div>
<script>
// The logo file picker. The photo field kind in admin/ui.js has never had an
// uploader of its own — it renders the file input and nothing listens to it —
// so it is wired here rather than left as a control that looks live and does
// nothing. (No backticks in this comment: it lives inside a template literal,
// and one would end the string. See the note in CLAUDE.md.)
(function(){
  var input = document.querySelector('.tlc-photo-input');
  if (!input) return;
  input.addEventListener('change', async function(){
    var f = input.files && input.files[0];
    if (!f) return;
    var hidden = document.querySelector('input[type=hidden][name="' + input.dataset.target + '"]');
    var img = document.querySelector('.tlc-photo-preview');
    var wrap = input.closest('.tlc-photo');
    if (wrap) wrap.setAttribute('data-busy', '1');
    try {
      var fd = new FormData(); fd.append('file', f, f.name);
      var r = await fetch('/api/upload-image', { method: 'POST', body: fd });
      var d = await r.json();
      if (!r.ok || !d.location) throw new Error((d && d.error) || 'Upload failed');
      if (hidden) hidden.value = d.location;
      if (img) { img.src = d.location; }
      else if (wrap) { wrap.insertAdjacentHTML('afterbegin', '<img src="' + d.location + '" alt="" class="tlc-photo-preview">'); var e = wrap.querySelector('.tlc-photo-empty'); if (e) e.remove(); }
      if (window.tlcToast) window.tlcToast('Logo uploaded · save the draft to keep it');
    } catch (err) {
      alert('That image could not be uploaded. ' + (err && err.message ? err.message : ''));
    } finally { if (wrap) wrap.removeAttribute('data-busy'); }
  });
})();
</script>`, 'Appearance');
      }

      if (path === '/menu/appearance/save' && method === 'POST') {
        const form = await request.formData();
        const next = appearanceFromForm(form);
        const before = await readChrome(env, CHROME_DRAFT_KEY);
        await writeChrome(env, CHROME_DRAFT_KEY, next);
        await logAudit(env.DB, currentUser, 'update', 'appearance', 'draft', 'Header and newsletter band (draft)', before, next);
        return new Response('', { status: 302, headers: { Location: '/menu/appearance?msg=saved' } });
      }

      // Publishing is the ONLY thing that writes the live row. It copies the
      // draft across whole rather than taking fields from the request, so a
      // crafted POST can only ever publish what is already on the screen —
      // there is no way to publish something nobody has looked at.
      if (path === '/menu/appearance/publish' && method === 'POST') {
        const { draft, live } = await readChromePair(env);
        await writeChrome(env, CHROME_LIVE_KEY, draft);
        await logAudit(env.DB, currentUser, 'publish', 'appearance', 'live', 'Header and newsletter band', live, draft);
        return new Response('', { status: 302, headers: { Location: '/menu/appearance?msg=published' } });
      }

      // The other direction: throw the draft away and go back to the site.
      if (path === '/menu/appearance/discard' && method === 'POST') {
        const { draft, live } = await readChromePair(env);
        await writeChrome(env, CHROME_DRAFT_KEY, live);
        await logAudit(env.DB, currentUser, 'update', 'appearance', 'draft', 'Header and newsletter band (draft discarded)', draft, live);
        return new Response('', { status: 302, headers: { Location: '/menu/appearance?msg=discarded' } });
      }

      if (path === '/menu' && method === 'GET') {
        const { list, pageRows, byId } = await loadMenu();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Menu saved.</div>`
          : msg === 'added' ? `<div class="alert alert-success">✓ Added to the menu.</div>`
          : msg === 'removed' ? `<div class="alert alert-info">Removed from the menu. The page itself is untouched and still live.</div>` : '';

        const header = menuTree(list, byId, 'header');
        const footer = menuTree(list, byId, 'footer');
        const orphans = orphanPages(pageRows, list);
        const warnings = menuWarnings(list, byId);

        // ⚠ The preview used to be admin navy with a hardcoded "T" badge and
        // the literal words "Timothy Lutheran", beside a real site that is moss
        // green with a round photographic logo and a strapline. It was built
        // from the real menu ITEMS — which was the honest half — but drew them
        // into a bar that does not exist anywhere. Staff were being shown a
        // picture of a header the site does not have and asked to arrange it.
        //
        // It now draws the published appearance record through the same
        // renderer the Appearance screen uses. A preview that can disagree
        // with the site is worse than no preview, because it is believed.
        const liveChrome = await readChrome(env, CHROME_LIVE_KEY);
        const previewItems = header.filter((i) => i.visible && !i.broken)
          .map((i) => ({ label: i.label, style: i.style }));

        const itemHtml = (i) => `<div class="tlc-mi${i.depth ? ' is-child' : ''}${i.broken ? ' tlc-mi-broken' : ''}" draggable="true" data-id="${i.id}" data-depth="${i.depth}">
    <span class="tlc-mi-grip" aria-hidden="true">⠿</span>
    <span class="tlc-mi-body">
      <span class="tlc-mi-label">${escapeHtml(i.label)}</span>
      <span class="tlc-mi-sub">${i.href ? escapeHtml(i.href) : 'No destination'}</span>
    </span>
    <span class="tlc-mi-kind">${escapeHtml(i.kind === 'page' ? 'Page' : i.kind === 'external' ? 'Link' : 'Short')}</span>
    ${i.style === 'button' ? '<span class="tlc-mi-kind" style="background:#FBF1DC;color:#7A5B18;">Button</span>' : ''}
    <form method="POST" action="/menu/remove/${i.id}" style="margin:0;" onsubmit="return confirm('Take this out of the menu? The page stays live at its address.')">
      <button type="submit" class="tlc-mi-x" title="Remove from the menu" aria-label="Remove ${escapeHtml(i.label)} from the menu">✕</button>
    </form>
  </div>${i.broken ? `<div class="tlc-mi-warn">▲ ${escapeHtml(i.brokenReason)}</div>` : ''}`;

        const listHtml = (tree, menu) => tree.length === 0
          ? `<div class="tlc-menu-empty">Nothing in the ${menu} yet — add a page from the panel on the right.</div>`
          : tree.map((i) => itemHtml(i) + i.children.map(itemHtml).join('')).join('');

        const orphanHtml = orphans.length === 0
          ? `<div class="tlc-menu-empty">Every live page is in a menu.</div>`
          : orphans.map((p) => `<div class="tlc-orphan">
    <span class="tlc-orphan-body">
      <span class="tlc-mi-label">${escapeHtml(p.menu_label || p.title)}</span>
      <span class="tlc-mi-sub">${escapeHtml(p.slug)} · live, never added to a menu</span>
    </span>
    <form method="POST" action="/menu/add" style="margin:0;display:flex;gap:6px;">
      <input type="hidden" name="page_id" value="${escapeHtml(p.id)}">
      <button type="submit" name="menu" value="header" class="tlc-orphan-btn">Header</button>
      <button type="submit" name="menu" value="footer" class="tlc-orphan-btn">Footer</button>
    </form>
  </div>`).join('');

        // ── THE FOOTER, AS COLUMNS ──
        // One drop target per column. An unassigned link is shown in its own
        // band rather than quietly folded into a column: the site does put it
        // under the first heading (it has to appear somewhere), and the band
        // is what makes that visible instead of mysterious.
        const colRows = await env.DB.prepare('SELECT * FROM footer_columns ORDER BY sort_order, id').all().catch(() => ({ results: [] }));
        const { columns: fcols, orphans: fspare } = footerColumns(colRows.results || [], list, byId);
        const firstMenuCol = fcols.find((c) => c.source === 'menu' && c.visible);

        const columnHtml = fcols.map((c) => `<div class="tlc-fcol">
    <div class="tlc-fcol-head">
      <span class="tlc-fcol-name">${escapeHtml(c.heading || 'Untitled column')}${c.visible ? '' : ' <span class="tlc-mi-kind">Hidden</span>'}</span>
      <a class="tlc-edit" href="/menu/columns/${c.id}">Edit</a>
    </div>
    ${c.source === 'partners'
      ? `<div class="tlc-menu-hint" style="padding:10px 14px;">Filled automatically from the partner ministries — one per core value. Edit them under <a href="/partners" style="color:var(--tlc-blue);">Partners</a>.</div>`
      : `<div data-menu="footer" data-column="${c.id}" class="tlc-fcol-list">${c.items.length ? c.items.map(itemHtml).join('') : '<div class="tlc-menu-empty">Drag a link here.</div>'}</div>`}
  </div>`).join('');

        const footerPanelHtml = `<div class="tlc-fcols">${columnHtml}</div>
    ${fspare.length ? `<div class="tlc-fcol tlc-fcol--spare">
      <div class="tlc-fcol-head"><span class="tlc-fcol-name">Not in a column</span></div>
      <div class="tlc-mi-warn">▲ ${fspare.length === 1 ? 'This link is' : `These ${fspare.length} links are`} showing on the site under ${escapeHtml(firstMenuCol ? firstMenuCol.heading : 'the first column')}, because every link has to appear somewhere. Drag ${fspare.length === 1 ? 'it' : 'them'} into the column ${fspare.length === 1 ? 'it belongs' : 'they belong'} in.</div>
      <div data-menu="footer" class="tlc-fcol-list">${fspare.map(itemHtml).join('')}</div>
    </div>` : ''}
    <div class="tlc-menu-hint">Drag a link by its ⠿ handle to move it within a column or into another one. The footer does not nest — a column heading is the only level there is.
      <a href="/menu/columns/new" style="color:var(--tlc-blue);font-weight:600;">Add a column</a></div>`;

        return html(`
${sidebarShell('menu', currentUser, `<a href="https://timothystl.org" target="_blank">View site</a>`, await pageBadges())}
<div class="tlc-menu-wrap">
  <div class="tlc-section-head" style="margin-bottom:14px;">
    <div class="tlc-section-headings">
      <h1 class="tlc-title">Menu</h1>
      <p class="tlc-purpose">The order and shape of the header and footer. An item can point at a page, an outside site, or a short link — and the label in the bar can be shorter than the page name.</p>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex:none;">
      <a class="tlc-btn-quiet" href="/menu/appearance">Appearance</a>
      <a class="tlc-action" href="/menu/new">+ Add item</a>
    </div>
  </div>
  ${alertHtml}
  ${warnings.length ? `<div class="alert alert-error" style="margin:0 0 14px;">${warnings.map(escapeHtml).join('<br>')}</div>` : ''}

  ${renderHeaderPreview(liveChrome, previewItems, { note: 'This is the site — top level only. Colors, the logo and the wording are on the Appearance screen.' })}

  <div class="tlc-menu-cols">
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${panel('Header menu', `<div id="menu-header" data-menu="header">${listHtml(header, 'header')}</div>
        <div class="tlc-menu-hint">Drag a row by its ⠿ handle to reorder it. Drop it <strong>onto another item’s name</strong> to nest it underneath. Two levels is the limit — a third is a menu nobody can use on a phone.</div>`,
        { right: 'Drag to reorder · drop onto an item to nest', pad: false })}
      ${panel('Footer columns', footerPanelHtml, { right: 'Drag a link between columns', pad: false })}
    </div>
    <div>
      ${panel('Live pages not in the menu', orphanHtml + `<div class="tlc-menu-hint">Nothing here is broken. These pages are live and reachable by their address — they are simply not listed in a menu, which is right for a thank-you page or a one-off landing page.</div>`, { pad: false })}
    </div>
  </div>
</div>
<form id="menu-order-form" method="POST" action="/menu/reorder" style="display:none;">
  <input type="hidden" name="order" id="menu-order-input">
</form>
<script>(function(){
  // Reordering posts the whole resulting order rather than a diff: the server
  // renumbers from scratch, so a dropped row can never leave the list in a
  // state where two items claim the same position.
  var dragged = null;
  function rows(list){ return Array.prototype.slice.call(list.querySelectorAll('.tlc-mi')); }
  function save(){
    var out = [];
    // Every drop target, not two fixed ids: the footer is one list per column
    // now, so a column is simply another container. Dragging a link from one
    // column to another is then the same gesture as reordering within one,
    // and it records where it landed.
    Array.prototype.forEach.call(document.querySelectorAll('[data-menu]'), function(list){
      var col = list.dataset.column ? parseInt(list.dataset.column, 10) : null;
      rows(list).forEach(function(r){
        out.push({ id: parseInt(r.dataset.id,10), menu: list.dataset.menu,
                   depth: parseInt(r.dataset.depth,10) || 0, column: col });
      });
    });
    document.getElementById('menu-order-input').value = JSON.stringify(out);
    document.getElementById('menu-order-form').submit();
  }
  function wire(list){
    list.addEventListener('dragstart', function(e){
      var row = e.target.closest('.tlc-mi'); if (!row) return;
      dragged = row; row.classList.add('is-drag');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', row.dataset.id); } catch(_){}
    });
    list.addEventListener('dragend', function(){
      if (dragged) dragged.classList.remove('is-drag');
      rows(document).forEach(function(r){ r.classList.remove('is-over','is-nest'); });
      dragged = null;
    });
    list.addEventListener('dragover', function(e){
      if (!dragged) return;
      e.preventDefault();
      var row = e.target.closest('.tlc-mi');
      rows(document).forEach(function(r){ r.classList.remove('is-over','is-nest'); });
      if (!row || row === dragged) return;
      // Dropping onto the NAME nests; dropping anywhere else on the row
      // reorders. Nesting is header-only and never onto another child.
      var onName = !!e.target.closest('.tlc-mi-label');
      var canNest = list.dataset.menu === 'header' && onName && row.dataset.depth === '0';
      row.classList.add(canNest ? 'is-nest' : 'is-over');
    });
    list.addEventListener('drop', function(e){
      if (!dragged) return;
      e.preventDefault();
      var row = e.target.closest('.tlc-mi');
      var onName = !!e.target.closest('.tlc-mi-label');
      var canNest = list.dataset.menu === 'header' && onName && row && row.dataset.depth === '0';
      if (row && row !== dragged) {
        if (canNest) {
          dragged.dataset.depth = '1';
          row.parentNode.insertBefore(dragged, row.nextSibling);
        } else {
          dragged.dataset.depth = list.dataset.menu === 'header' ? dragged.dataset.depth : '0';
          row.parentNode.insertBefore(dragged, row);
        }
      } else if (!row) {
        list.appendChild(dragged);
      }
      save();
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-menu]'), wire);
})();</script>`, 'Menu');
      }

      // ── Reorder (POST) ──
      if (path === '/menu/reorder' && method === 'POST') {
        const form = await request.formData();
        let order = [];
        try { order = JSON.parse(form.get('order') || '[]'); } catch (_) { order = []; }
        // Which column a footer row landed in travels with the drag, so
        // moving a link between columns and reordering within one are the
        // same posted order rather than two mechanisms that can disagree.
        const columnOf = new Map(order.map((o) => [o.id, Number.isFinite(Number(o.column)) && o.column != null ? Number(o.column) : null]));
        for (const menu of MENUS) {
          const inMenu = order.filter((o) => normalizeMenu(o.menu) === menu);
          for (const row of renumber(inMenu, menu)) {
            await env.DB.prepare('UPDATE menu_items SET menu = ?, sort_order = ?, depth = ?, column_id = ? WHERE id = ?')
              .bind(row.menu, row.sort_order, row.depth, menu === 'footer' ? (columnOf.get(row.id) ?? null) : null, row.id).run().catch(() => {});
          }
        }
        await logAudit(env.DB, currentUser, 'update', 'menu', 'order', 'Menu order', null, { count: order.length });
        return new Response('', { status: 302, headers: { Location: '/menu?msg=saved' } });
      }

      // ── Add a live page to a menu (POST) ──
      if (path === '/menu/add' && method === 'POST') {
        const form = await request.formData();
        const pageId = String(form.get('page_id') || '');
        const menu = normalizeMenu(form.get('menu'));
        const page = await env.DB.prepare('SELECT id, title, menu_label FROM pages WHERE id = ?').bind(pageId).first();
        if (!page) return new Response('', { status: 302, headers: { Location: '/menu' } });
        const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM menu_items WHERE menu = ?').bind(menu).first();
        await env.DB.prepare(
          "INSERT INTO menu_items (menu, label, kind, page_id, style, depth, sort_order, visible) VALUES (?, ?, 'page', ?, 'link', 0, ?, 1)"
        ).bind(menu, page.menu_label || page.title, pageId, ((max && max.m) || 0) + 10).run();
        await logAudit(env.DB, currentUser, 'create', 'menu_item', pageId, page.title, null, { menu });
        return new Response('', { status: 302, headers: { Location: '/menu?msg=added' } });
      }

      // ── Remove an item (POST) ──
      // The page is untouched — it stays live at its address and reappears in
      // the orphan panel. Nothing is ever lost by tidying the menu.
      if (path.startsWith('/menu/remove/') && method === 'POST') {
        const id = path.slice('/menu/remove/'.length);
        const before = await env.DB.prepare('SELECT * FROM menu_items WHERE id = ?').bind(id).first();
        await env.DB.prepare('DELETE FROM menu_items WHERE id = ?').bind(id).run();
        if (before) await logAudit(env.DB, currentUser, 'delete', 'menu_item', String(id), before.label || '', before, null);
        return new Response('', { status: 302, headers: { Location: '/menu?msg=removed' } });
      }

      // ── New item (GET form) ──
      if (path === '/menu/new' && method === 'GET') {
        const { pageRows } = await loadMenu();
        return html(`
${sidebarShell('menu', currentUser, `<a href="/menu">← Menu</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Add a menu item</div>
  <div class="page-sub">A menu item can point at one of your pages, at an outside site, or at a short link.</div>
  <div class="card">
    <form method="POST" action="/menu/create">
      <div class="form-group">
        <label>Which menu</label>
        <select name="menu"><option value="header">Header</option><option value="footer">Footer</option></select>
      </div>
      <div class="form-group">
        <label>Label <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— what appears in the bar; can be shorter than the page name</span></label>
        <input type="text" name="label" placeholder="e.g. Visit">
      </div>
      <div class="form-group">
        <label>Point at a page</label>
        <select name="page_id">
          <option value="">— Not a page —</option>
          ${pageRows.filter((p) => p.status === 'published').map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.menu_label || p.title)} (${escapeHtml(p.slug)})</option>`).join('')}
        </select>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">The address is always read from the page, so renaming it moves this item too. Leave blank if you are linking somewhere else.</div>
      </div>
      <div class="form-group">
        <label>…or a web address</label>
        <input type="text" name="target" placeholder="https://wordoflifeschool.net, or /zoom">
      </div>
      <div class="form-group">
        <div class="checkbox-row">
          <input type="checkbox" name="style" value="button" id="mi-btn">
          <span><label for="mi-btn" style="display:inline;text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;">Show as a button</label></span>
        </div>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">One item should be a button — Give is it. A second stops the first standing out.</div>
      </div>
      <div class="btn-row" style="margin-top:20px;">
        <button type="submit" class="btn btn-primary">Add to menu</button>
        <a href="/menu" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'Add a menu item');
      }

      if (path === '/menu/create' && method === 'POST') {
        const form = await request.formData();
        const menu = normalizeMenu(form.get('menu'));
        const pageId = String(form.get('page_id') || '').trim();
        const target = String(form.get('target') || '').trim();
        const label = String(form.get('label') || '').trim();
        if (!pageId && !target) return new Response('', { status: 302, headers: { Location: '/menu/new' } });
        const kind = pageId ? 'page' : (target.startsWith('/') ? 'short' : 'external');
        const style = normalizeStyle(form.get('style'));
        const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM menu_items WHERE menu = ?').bind(menu).first();
        await env.DB.prepare(
          'INSERT INTO menu_items (menu, label, kind, page_id, target, style, depth, sort_order, visible) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1)'
        ).bind(menu, label || null, kind, pageId || null, pageId ? null : target, style, ((max && max.m) || 0) + 10).run();
        await logAudit(env.DB, currentUser, 'create', 'menu_item', pageId || target, label, null, { menu, kind });
        return new Response('', { status: 302, headers: { Location: '/menu?msg=added' } });
      }
    }
    // ── PARTNERS ───────────────────────────────────────────────
    // Four partner ministries, one per core value. The pairing is what the
    // dashboard's values report and the public /values page both read.
    if (path === '/partners' || path.startsWith('/partners/')) {
      if (!hasPermission(currentUser, 'pages_edit')) {
        return new Response('Access denied.', { status: 403 });
      }

      // Reordering posts the whole resulting order, same contract as the
      // Menu and Giving's funds/tiers panels: the server renumbers from
      // scratch in steps of 10 so a dropped row cannot leave two partners
      // claiming one position. This is what the public footer's new
      // Partners column sorts by (see /api/values' sort_order).
      if (path === '/partners/reorder' && method === 'POST') {
        const form = await request.formData();
        let ids = [];
        try { ids = JSON.parse(form.get('order') || '[]'); } catch (_) {}
        for (let i = 0; i < ids.length; i++) {
          await env.DB.prepare('UPDATE partners SET sort_order = ? WHERE id = ?').bind((i + 1) * 10, parseInt(ids[i], 10)).run();
        }
        return new Response('', { status: 302, headers: { Location: '/partners?msg=saved' } });
      }

      if (path === '/partners' && method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM partners ORDER BY sort_order, id').all();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Partner saved.</div>`
          : msg === 'deleted' ? `<div class="alert alert-info">Partner removed.</div>`
          : msg === 'taken' ? `<div class="alert alert-error">Another partner already carries that value. Each value has exactly one partner.</div>` : '';

        const byValue = Object.fromEntries(rows.results.map((r) => [r.value, r]));

        // One row per value, not one per record — so a value with no partner
        // is visible as a gap rather than silently absent. The values page
        // makes the same promise, and this is where it gets kept.
        const listRows = VALUES.map((v) => {
          const p = byValue[v.key];
          if (!p) {
            return {
              href: `/partners/new?value=${v.key}`,
              filter: 'missing',
              search: `${v.short} ${v.name}`.toLowerCase(),
              cells: [
                primaryCell(`No partner for ${v.short}`, 'Nothing is paired to this value yet'),
                valueChip(v.key),
                '—',
              ],
              actions: `<a class="tlc-edit" href="/partners/new?value=${v.key}">Add one</a>`,
              warn: `The values page will say this value has no partner rather than quietly showing three.`,
              warnCta: { label: 'Add a partner', href: `/partners/new?value=${v.key}` },
            };
          }
          const host = (p.site_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
          return {
            href: `/partners/edit/${p.id}`,
            filter: 'paired',
            search: `${p.name} ${p.short_name || ''} ${v.short} ${v.name} ${host}`.toLowerCase(),
            cells: [
              // The logo state rides on the sub-line rather than taking a
              // column of its own — the columns are the design's, in
              // sections.js, and "no logo yet" is a note about a record, not a
              // status the section filters on.
              primaryCell(p.name, p.logo_url ? (p.blurb || 'Logo set') : [p.blurb, 'No logo yet'].filter(Boolean).join(' · ')),
              valueChip(p.value),
              host ? `<a href="${escapeHtml(p.site_url)}" target="_blank" rel="noopener">${escapeHtml(host)}</a>` : '—',
            ],
            warn: p.also_note ? `Also on this record: ${p.also_note}` : '',
          };
        });

        // The order here is what the public footer's Partners column follows
        // (sort_order, read by /api/values). Reordering only means something
        // once there are at least two partners to put in an order.
        const orderPanelHtml = rows.results.length > 1 ? panelList({
          id: 'partners-order',
          reorderAction: '/partners/reorder',
          rows: rows.results.map((p) => {
            const v = VALUES.find((x) => x.key === p.value);
            return {
              id: p.id,
              name: p.name,
              sub: v ? v.name : p.value,
              action: `<a class="tlc-edit" href="/partners/edit/${p.id}">Edit</a>`,
            };
          }),
        }) : '';

        return html(`
${sidebarShell('partners', currentUser, `<a href="https://timothystl.org/about/values" target="_blank">View values page</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'partners',
    title: sectionCfg('partners').title,
    purpose: sectionCfg('partners').purpose,
    action: { label: sectionCfg('partners').action, href: '/partners/new' },
    search: sectionCfg('partners').search,
    filters: filtersOf('partners'),
    columns: columnsOf('partners'),
    rows: listRows,
    noun: 'partner',
    empty: 'No partners yet.',
    note: sectionCfg('partners').note,
  })}
  ${orderPanelHtml ? `<div class="card" style="margin-top:20px;">
    <h3 style="margin:0 0 4px;">Footer order</h3>
    <p class="page-sub" style="margin:0 0 12px;">Drag to set the order these appear in the site footer's Partners column.</p>
    ${orderPanelHtml}
  </div>` : ''}
</div>`, 'Partners');
      }

      // ── New / edit form ──
      const isNew = path === '/partners/new';
      if ((isNew || path.startsWith('/partners/edit/')) && method === 'GET') {
        const id = isNew ? null : path.slice('/partners/edit/'.length);
        const p = isNew ? null : await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(id).first();
        if (!isNew && !p) return new Response('Not found', { status: 404 });
        const preset = normalizeValue(url.searchParams.get('value'));
        return html(`
${sidebarShell('partners', currentUser, `<a href="/partners">← All partners</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">${isNew ? 'Add a partner' : escapeHtml(p.name)}</div>
  <div class="page-sub">Shown on the values page and in the dashboard's values report, paired to one core value.</div>
  <div class="card">
    <form method="POST" action="${isNew ? '/partners/create' : `/partners/update/${p.id}`}">
      <div class="form-group">
        <label>Name <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="name" required value="${escapeHtml(p?.name || '')}" placeholder="e.g. Christian Friends of New Americans">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Short name <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— used where space is tight</span></label>
          <input type="text" name="short_name" value="${escapeHtml(p?.short_name || '')}" placeholder="e.g. CFNA">
        </div>
        <div class="form-group" style="margin:0;">
          <label>Core value <span style="color:#B85C3A;">*</span></label>
          ${valueChips('value', p?.value || preset, { allowNone: false })}
        </div>
      </div>
      <div class="form-group">
        <label>Blurb</label>
        <textarea name="blurb" rows="3" placeholder="A sentence or two about what they do.">${escapeHtml(p?.blurb || '')}</textarea>
      </div>
      <div class="form-group">
        <label>Their website</label>
        <input type="text" name="site_url" value="${escapeHtml(p?.site_url || '')}" placeholder="https://example.org">
      </div>
      <div class="form-group">
        <label>Logo <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— shown by the Partner logos block on any page</span></label>
        <input type="hidden" name="logo_url" id="partner_logo_val" value="${escapeHtml(p?.logo_url || '')}">
        <div id="partner-logo-preview" style="${p?.logo_url ? '' : 'display:none;'}margin-bottom:8px;background:var(--linen);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
          ${p?.logo_url ? `<img src="${escapeHtml(p.logo_url)}" alt="" style="max-height:64px;max-width:220px;">` : ''}
        </div>
        <input type="file" id="partner_logo_file" accept="image/*">
        <div id="partner-logo-status" class="tlc-hint" style="margin-top:6px;">A transparent PNG or an SVG-style wordmark reads best. Leave it empty and the block shows the partner's name instead.</div>
      </div>
      <div class="form-group">
        <label>Also on this record <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— a person or project named alongside the partner</span></label>
        <input type="text" name="also_note" value="${escapeHtml(p?.also_note || '')}" placeholder="e.g. Pastor Rall and Mary Ann, missionaries to Papua New Guinea">
      </div>
      <div class="btn-row" style="margin-top:20px;">
        <button type="submit" class="btn btn-primary">${isNew ? 'Add partner' : 'Save changes'}</button>
        <a href="/partners" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
        ${isNew ? '' : `<form method="POST" action="/partners/delete/${p.id}" style="display:inline;margin:0;" onsubmit="return confirm('Remove this partner? The value will show as unpaired until another is added.')"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form>`}
      </div>
    </form>
  </div>
</div>
<script>
// The logo picker. Uploads on change and fills the hidden field, so the form
// posts an R2 address rather than a file — same shape as the news header image
// and the header logo on the Appearance screen. (No backticks in this comment:
// it lives inside a template literal and one would end the string.)
(function(){
  var input = document.getElementById('partner_logo_file');
  if (!input) return;
  input.addEventListener('change', async function(){
    var f = input.files && input.files[0];
    if (!f) return;
    var hidden = document.getElementById('partner_logo_val');
    var box = document.getElementById('partner-logo-preview');
    var status = document.getElementById('partner-logo-status');
    status.textContent = 'Uploading...';
    try {
      var fd = new FormData(); fd.append('file', f, f.name);
      var r = await fetch('/api/upload-image', { method: 'POST', body: fd });
      var d = await r.json();
      if (!r.ok || !d.url) throw new Error((d && d.error) || 'Upload failed');
      hidden.value = d.url;
      box.innerHTML = '<img src="' + d.url + '" alt="" style="max-height:64px;max-width:220px;">';
      box.style.display = '';
      status.textContent = 'Uploaded - save the partner to keep it.';
    } catch (err) {
      status.textContent = 'That image could not be uploaded. ' + (err && err.message ? err.message : '');
    }
  });
})();
</script>`, isNew ? 'Add a partner' : 'Edit partner');
      }

      if ((path === '/partners/create' || path.startsWith('/partners/update/')) && method === 'POST') {
        const form = await request.formData();
        const name = (form.get('name') || '').trim();
        const value = normalizeValue(form.get('value'));
        if (!name || !value) return new Response('', { status: 302, headers: { Location: '/partners?msg=taken' } });
        const fields = [
          name,
          (form.get('short_name') || '').trim() || null,
          value,
          (form.get('blurb') || '').trim() || null,
          (form.get('site_url') || '').trim() || null,
          (form.get('also_note') || '').trim() || null,
          // Whatever the uploader put in the hidden field, through the same
          // safeUrl gate every other stored address goes through — the value
          // arrives in a POST, so "our own script wrote it" is not a guarantee.
          safeUrl((form.get('logo_url') || '').trim()) || null,
        ];
        try {
          if (path === '/partners/create') {
            await env.DB.prepare(
              'INSERT INTO partners (name, short_name, value, blurb, site_url, also_note, logo_url, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order),0)+10 FROM partners))'
            ).bind(...fields).run();
            await logAudit(env.DB, currentUser, 'create', 'partner', value, name, null, { name, value });
          } else {
            const id = path.slice('/partners/update/'.length);
            const before = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(id).first();
            await env.DB.prepare(
              'UPDATE partners SET name = ?, short_name = ?, value = ?, blurb = ?, site_url = ?, also_note = ?, logo_url = ? WHERE id = ?'
            ).bind(...fields, id).run();
            await logAudit(env.DB, currentUser, 'update', 'partner', value, name, before, { name, value });
          }
        } catch (_) {
          // UNIQUE(value) — the one-per-value rule, refused by the database
          // rather than silently overwriting whoever was already there.
          return new Response('', { status: 302, headers: { Location: '/partners?msg=taken' } });
        }
        return new Response('', { status: 302, headers: { Location: '/partners?msg=saved' } });
      }

      if (path.startsWith('/partners/delete/') && method === 'POST') {
        const id = path.slice('/partners/delete/'.length);
        const before = await env.DB.prepare('SELECT * FROM partners WHERE id = ?').bind(id).first();
        await env.DB.prepare('DELETE FROM partners WHERE id = ?').bind(id).run();
        if (before) await logAudit(env.DB, currentUser, 'delete', 'partner', before.value, before.name, before, null);
        return new Response('', { status: 302, headers: { Location: '/partners?msg=deleted' } });
      }
    }

    // ── VALUES ─────────────────────────────────────────────────
    // The four core values' office-editable words and photo. Unlike Partners,
    // there is nothing here to add or delete — the four rows are seeded once
    // by the schema migration and always exist, one per key in admin/values.js.
    // ── THE CALENDAR'S CATEGORIES ──────────────────────────────
    // What the public calendar sorts events into, and which Google color feeds
    // each one. Gated on pages_edit: this is what the church's own website
    // shows, not an account or a payment setting.
    if (path === '/calendar-categories' || path.startsWith('/calendar-categories/')) {
      if (!hasPermission(currentUser, 'pages_edit')) {
        return new Response('Access denied.', { status: 403 });
      }
      const readCats = async () => {
        const r = await env.DB.prepare(
          'SELECT key, name, color_id, palette, sort_order, active FROM calendar_categories'
        ).all().catch(() => ({ results: [] }));
        return mergedCategories(r.results || []);
      };

      if (path === '/calendar-categories' && method === 'GET') {
        const cats = await readCats();
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Category saved. The calendar picks it up within a few minutes.</div>`
          : msg === 'added' ? `<div class="alert alert-success">✓ Category added. Give it a Google color so events can land in it.</div>`
          : msg === 'taken' ? `<div class="alert alert-error">Another category already uses that Google color. Two categories cannot share one.</div>`
          : msg === 'locked' ? `<div class="alert alert-warn">Other cannot be retired — it is where an event nobody colored ends up.</div>`
          : msg === 'badkey' ? `<div class="alert alert-error">That name needs at least one letter or number in it.</div>` : '';

        const editKey = url.searchParams.get('edit') || '';
        const editing = cats.find((c) => c.key === editKey) || null;
        const adding = editKey === ':new';

        const listRows = cats.map((c) => {
          const retired = c.active === false;
          const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${escapeHtml(c.color)};margin-right:7px;vertical-align:middle"></span>`;
          return {
            href: `/calendar-categories?edit=${encodeURIComponent(c.key)}`,
            filter: retired ? 'retired' : (c.colorId ? 'in-use' : 'no-color-yet'),
            search: `${c.name} ${c.google} ${c.key}`.toLowerCase(),
            cells: [
              primaryCell(c.name, c.key === NEUTRAL_CATEGORY ? 'Where an uncolored event lands' : c.key),
              c.colorId ? escapeHtml(c.google || ('Color ' + c.colorId))
                : c.key === NEUTRAL_CATEGORY
                  // ⚠ For Other, having no color is the whole job — it is
                  // where an event nobody colored lands. An amber "no color
                  // yet" pill here would read as a fault on the one row that
                  // is working exactly as designed.
                  ? `<span class="tlc-primary-sub">Any color no category claims</span>`
                  : statusPill('warn', 'No color yet'),
              `${swatch}${escapeHtml((CALENDAR_PALETTE.find((x) => x.color === c.color) || {}).name || 'Custom')}`,
              retired ? statusPill('plain', 'Retired') : statusPill('good', 'In use'),
            ],
            // ⚠ A category with no Google color can never receive an event —
            // it is a control that looks live and does nothing, which is the
            // one thing this admin says out loud rather than leaving to be
            // discovered.
            warn: (!retired && !c.colorId && c.key !== NEUTRAL_CATEGORY)
              ? `Nothing can land in “${c.name}” until it is given a Google color — events are filed by the color whoever enters them picks.`
              : '',
            warnCta: (!retired && !c.colorId && c.key !== NEUTRAL_CATEGORY)
              ? { label: 'Choose a color', href: `/calendar-categories?edit=${encodeURIComponent(c.key)}` }
              : null,
          };
        });

        const usedColors = new Set(cats.filter((c) => c.colorId && c.key !== (editing || {}).key).map((c) => String(c.colorId)));
        const colorOptions = [{ value: '', label: '— no color yet —' }].concat(
          GOOGLE_COLORS.map((g) => ({ value: g.id, label: g.name + (usedColors.has(g.id) ? ' (already used)' : '') }))
        );
        // ⚠ THE KEY RIDES IN THE ACTION URL, not in a hidden field — the
        // drawer's field vocabulary has no hidden kind, deliberately: every
        // control it offers is one somebody can see and reason about.
        const drawer = (editing || adding) ? renderDrawer({
          key: 'calcat',
          title: adding ? 'Add a category' : `Edit ${editing.name}`,
          sub: adding ? 'A new category needs a Google color before anything can land in it.' : `Filed under ${editing.key}`,
          action: adding ? '/calendar-categories/add' : `/calendar-categories/save/${encodeURIComponent(editing.key)}`,
          cancelHref: '/calendar-categories',
          fields: [
            { kind: 'text', name: 'name', label: 'Name', value: adding ? '' : editing.name, required: true,
              hint: 'What the filter pill and the printed key call it.' },
            { kind: 'choice', name: 'color_id', label: 'Google color', value: adding ? '' : (editing.colorId || ''),
              options: colorOptions,
              hint: 'The color whoever enters the event picks in Google. Each color can feed only one category.' },
            { kind: 'choice', name: 'palette', label: 'Shown as', value: adding ? 'gray' : (editing.palette || ''),
              options: CALENDAR_PALETTE.map((x) => ({ value: x.key, label: x.name })),
              hint: 'How it looks on the site — the color of the time and the tint behind it. A fixed set, so a category can never be made unreadable.' },
            ...(adding || editing.key === NEUTRAL_CATEGORY ? [] : [{ kind: 'toggle', name: 'active', label: 'Status',
              value: editing.active !== false, on: 'In use', off: 'Retired',
              hint: 'A retired category keeps its events — they fall back to Other — but stops being offered as a filter.' }]),
          ],
        }) : '';

        return html(`
${sidebarShell('calcats', currentUser, `<a href="https://timothystl.org/calendar" target="_blank">View the calendar</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'calcats',
    title: sectionCfg('calcats').title,
    purpose: sectionCfg('calcats').purpose,
    search: sectionCfg('calcats').search,
    action: { label: sectionCfg('calcats').action, href: '/calendar-categories?edit=%3Anew' },
    filters: filtersOf('calcats'),
    columns: columnsOf('calcats'),
    rows: listRows,
    noun: 'category',
    nounPlural: 'categories',
    note: sectionCfg('calcats').note,
  })}
</div>
${drawer}`, 'Calendar categories');
      }

      if (path.startsWith('/calendar-categories/save/') && method === 'POST') {
        const form = await request.formData();
        const key = decodeURIComponent(path.slice('/calendar-categories/save/'.length));
        const cats = await readCats();
        const cat = cats.find((c) => c.key === key);
        if (!cat) return new Response('', { status: 302, headers: { Location: '/calendar-categories' } });

        const colorId = String(form.get('color_id') || '').trim();
        // ⚠ CHECKED HERE, NOT LEFT TO THE UNIQUE INDEX. A constraint error
        // reaches the top-level catch and shows a reference number, which
        // tells somebody re-pointing a color nothing about what went wrong.
        if (colorId && cats.some((c) => c.key !== key && String(c.colorId) === colorId)) {
          return new Response('', { status: 302, headers: { Location: '/calendar-categories?msg=taken' } });
        }
        // ⚠ The neutral category is forced on however the form arrives.
        const active = key === NEUTRAL_CATEGORY ? 1 : (form.getAll('active').includes('1') ? 1 : 0);
        const name = String(form.get('name') || '').trim() || cat.name;
        const palette = CALENDAR_PALETTE.some((x) => x.key === form.get('palette')) ? String(form.get('palette')) : (cat.palette || 'gray');

        await env.DB.prepare(
          `INSERT INTO calendar_categories (key, name, color_id, palette, sort_order, active, updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(key) DO UPDATE SET name=excluded.name, color_id=excluded.color_id,
             palette=excluded.palette, active=excluded.active, updated_at=excluded.updated_at`
        ).bind(key, name, colorId || null, palette, cat.sort_order || 0, active, new Date().toISOString()).run();
        await logAudit(env.DB, currentUser, 'update', 'calendar-category', key, name,
          { name: cat.name, color: cat.google, active: cat.active }, { name, color: googleColorName(colorId), active: !!active });
        bustPagesCache(ctx);
        return new Response('', { status: 302, headers: { Location: '/calendar-categories?msg=saved' } });
      }

      if (path === '/calendar-categories/add' && method === 'POST') {
        const form = await request.formData();
        const name = String(form.get('name') || '').trim();
        // ⚠ NOT slugify() — that builds a PAGE address and returns a leading
        // slash, which would make the stored key "/fellowship" and quietly
        // never match anything. A category key is an identifier, not a path.
        const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
        if (!key) return new Response('', { status: 302, headers: { Location: '/calendar-categories?msg=badkey' } });
        const cats = await readCats();
        if (cats.some((c) => c.key === key)) {
          return new Response('', { status: 302, headers: { Location: `/calendar-categories?edit=${encodeURIComponent(key)}` } });
        }
        const colorId = String(form.get('color_id') || '').trim();
        if (colorId && cats.some((c) => String(c.colorId) === colorId)) {
          return new Response('', { status: 302, headers: { Location: '/calendar-categories?msg=taken' } });
        }
        const palette = CALENDAR_PALETTE.some((x) => x.key === form.get('palette')) ? String(form.get('palette')) : 'gray';
        await env.DB.prepare(
          'INSERT OR IGNORE INTO calendar_categories (key, name, color_id, palette, sort_order, active, updated_at) VALUES (?,?,?,?,?,1,?)'
        ).bind(key, name, colorId || null, palette, cats.length, new Date().toISOString()).run();
        await logAudit(env.DB, currentUser, 'create', 'calendar-category', key, name, null, { name, color: googleColorName(colorId) });
        bustPagesCache(ctx);
        return new Response('', { status: 302, headers: { Location: '/calendar-categories?msg=added' } });
      }
    }

    if (path === '/values' || path.startsWith('/values/')) {
      if (!hasPermission(currentUser, 'pages_edit')) {
        return new Response('Access denied.', { status: 403 });
      }

      if (path === '/values' && method === 'GET') {
        const rows = (await env.DB.prepare('SELECT * FROM core_values').all()).results || [];
        const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Value saved.</div>`
          : msg === 'reset' ? `<div class="alert alert-info">Back to the default wording.</div>` : '';

        // One row per value, in the church's own order — the arc, never
        // sorted, same rule the block itself follows.
        const listRows = VALUES.map((v) => {
          const row = byKey[v.key] || {};
          const customized = VALUE_TEXT_FIELDS.some((f) => row[f]);
          const hasPhoto = !!row.photo_url;
          return {
            href: `/values/edit/${v.key}`,
            filter: customized ? 'customized' : 'default-wording',
            search: `${v.short} ${v.name}`.toLowerCase(),
            cells: [
              primaryCell(row.name || v.name, `${row.short || v.short} · ${v.key}`),
              customized ? statusPill('good', 'Customized') : statusPill('auto', 'Default wording'),
              hasPhoto ? statusPill('good', 'Photo set') : statusPill('auto', 'Using color field'),
            ],
          };
        });

        return html(`
${sidebarShell('values', currentUser, `<a href="https://timothystl.org/about/values" target="_blank">View values page</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'values',
    title: sectionCfg('values').title,
    purpose: sectionCfg('values').purpose,
    search: sectionCfg('values').search,
    filters: filtersOf('values'),
    columns: columnsOf('values'),
    rows: listRows,
    noun: 'value',
    note: sectionCfg('values').note,
  })}
</div>`, 'Values');
      }

      if (path.startsWith('/values/edit/') && method === 'GET') {
        const key = path.slice('/values/edit/'.length);
        const v = valueByKey(key);
        if (!v) return new Response('Not found', { status: 404 });
        const row = (await env.DB.prepare('SELECT * FROM core_values WHERE key = ?').bind(key).first()) || {};
        const hasOverride = VALUE_TEXT_FIELDS.some((f) => row[f]) || row.photo_url;
        return html(`
${sidebarShell('values', currentUser, `<a href="/values">← All values</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">${escapeHtml(v.name)}</div>
  <div class="page-sub">One of the church's four core values — ${escapeHtml(v.key)} is fixed and cannot be renamed as a key, since it is what the rest of the site tags ministries, posts and classes with.</div>
  <div class="card">
    <form method="POST" action="/values/update/${escapeHtml(v.key)}">
      <div class="form-group">
        <label>Short word <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="short" required maxlength="24" value="${escapeHtml(row.short || v.short)}" placeholder="${escapeHtml(v.short)}">
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">The word on the card itself — "${escapeHtml(v.short)}" by default.</div>
      </div>
      <div class="form-group">
        <label>Full name <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="name" required maxlength="60" value="${escapeHtml(row.name || v.name)}" placeholder="${escapeHtml(v.name)}">
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">The church's own name for it — this is what tags a ministry, a post, or a class as this value.</div>
      </div>
      <div class="form-group">
        <label>Official statement</label>
        <textarea name="blurb" rows="2" maxlength="300" placeholder="${escapeHtml(v.blurb)}">${escapeHtml(row.blurb || '')}</textarea>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">The one-sentence value as the church states it. Shown on /about when the card tagline below is blank.</div>
      </div>
      <div class="form-group">
        <label>Card tagline</label>
        <textarea name="tag" rows="2" maxlength="300" placeholder="${escapeHtml(v.tag || v.blurb)}">${escapeHtml(row.tag || '')}</textarea>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">A warmer, second-person version for the card on the values page. Leave blank to show the official statement instead.</div>
      </div>
      <div class="form-group">
        <label>Why this is here</label>
        <textarea name="why" rows="3" maxlength="500" placeholder="${escapeHtml(v.why || '')}">${escapeHtml(row.why || '')}</textarea>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">One sentence on why this value sits where it does in the order. Not shown on the site yet, but carried through for when it is.</div>
      </div>
      ${valuePhotoFieldHtml(row.photo_url || '')}
      <div class="page-sub" style="margin:16px 0 0;">A photo replaces the color field behind the word and tagline, under the same dark veil every photo banner on the site uses so the text stays readable. Leave it blank to keep the color field.</div>
      <div style="margin-top:20px;display:flex;gap:10px;align-items:center;">
        <button type="submit" class="btn btn-primary">Save</button>
        ${hasOverride ? `<button type="submit" formaction="/values/reset/${escapeHtml(v.key)}" formnovalidate onclick="return confirm('Reset ${escapeHtml(v.name)} back to its default wording and remove its photo?')" class="btn" style="background:#F7E4DE;color:#8C3A28;">Reset to default</button>` : ''}
      </div>
    </form>
  </div>
</div>`, escapeHtml(v.name));
      }

      if (path.startsWith('/values/update/') && method === 'POST') {
        const key = path.slice('/values/update/'.length);
        const v = valueByKey(key);
        if (!v) return new Response('Not found', { status: 404 });
        const form = await request.formData();
        const before = await env.DB.prepare('SELECT * FROM core_values WHERE key = ?').bind(key).first();

        // A blank field is not an edit — it is asking for the default back —
        // so it is stored as NULL rather than as an empty string that would
        // otherwise read identically to mergedValues() but mean something
        // different to a human looking at the row.
        const short = cleanText(form.get('short'), 24).trim() || null;
        const name = cleanText(form.get('name'), 60).trim() || null;
        const blurb = cleanText(form.get('blurb'), 300).trim() || null;
        const tag = cleanText(form.get('tag'), 300).trim() || null;
        const why = cleanText(form.get('why'), 500).trim() || null;
        // The file itself already went to /api/upload-image client-side, the
        // same flow the Staff photo field uses — this form only ever carries
        // back the URL that came from it, in a hidden field.
        const photoUrl = safeUrl(form.get('photo_url') || '').slice(0, 600) || null;

        await env.DB.prepare(
          'UPDATE core_values SET short = ?, name = ?, blurb = ?, tag = ?, why = ?, photo_url = ?, updated_at = ?, updated_by = ? WHERE key = ?'
        ).bind(short, name, blurb, tag, why, photoUrl, new Date().toISOString(), currentUser?.username || '', key).run();
        await logAudit(env.DB, currentUser, 'update', 'core_value', key, name || v.name, before, { short, name, blurb, tag, why, photo_url: photoUrl });
        return new Response('', { status: 302, headers: { Location: '/values?msg=saved' } });
      }

      if (path.startsWith('/values/reset/') && method === 'POST') {
        const key = path.slice('/values/reset/'.length);
        const v = valueByKey(key);
        if (!v) return new Response('Not found', { status: 404 });
        const before = await env.DB.prepare('SELECT * FROM core_values WHERE key = ?').bind(key).first();
        await env.DB.prepare(
          'UPDATE core_values SET short = NULL, name = NULL, blurb = NULL, tag = NULL, why = NULL, photo_url = NULL, updated_at = ?, updated_by = ? WHERE key = ?'
        ).bind(new Date().toISOString(), currentUser?.username || '', key).run();
        await logAudit(env.DB, currentUser, 'update', 'core_value', key, v.name, before, { reset: true });
        return new Response('', { status: 302, headers: { Location: '/values?msg=reset' } });
      }
    }

    // ── PAYROLL PAGE (auth-gated, no secondary login needed) ──
    // ── WORSHIP SCHEDULE BUILDER (legacy) ──────────────────────
    // VS-2: this lived in public/ and was served by the site worker to anybody
    // who typed timothystl.org/scheduler.html — the whole staff scheduling
    // tool, wide open. It is behind the admin session now.
    //
    // It is also dead: the only endpoint it talks to, /admin/api/scheduler/data,
    // does not exist anywhere in this repo, so it can neither load nor save.
    // Kept rather than deleted because Andrew asked for it locked, not removed,
    // and because the schedules it used to hold may still be wanted. Staff are
    // pointed at connect.timothystl.org for real scheduling.
    if (path === '/scheduler' && method === 'GET') {
      return new Response(SCHEDULER_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Robots-Tag': 'noindex, nofollow',
          'Cache-Control': 'private, no-store',
        },
      });
    }

    if (path === '/payroll' && method === 'GET') {
      if (!hasPermission(currentUser, 'payroll_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      // Phase 8: payroll is a fragment now, served inside the shared shell, so
      // it has the sidebar, the ⌘K palette and every accessibility and mobile
      // fix the rest of the admin gets. It used to be a standalone document
      // whose only way back out was a Sign Out button (PY-3).
      return html(`
${sidebarShell('payroll', currentUser, '', await pageBadges())}
${PAYROLL_HTML}`, 'Payroll');
    }

    // A period's hours live in Supabase, which this Worker holds no server-side
    // credentials for (see "The dashboard has no payroll task" in CLAUDE.md) —
    // so it cannot notice "all hours are in" on its own the way it notices a
    // held submission or a gym request. admin/payroll.html already computes
    // that client-side (it's what turns the status pill to "Ready to approve"),
    // so it's the one that asks for the push, once per period per page load —
    // renderPeriodState() in admin/payroll.html is the caller.
    if (path === '/api/push/payroll-ready' && method === 'POST') {
      if (!hasPermission(currentUser, 'payroll_manage')) {
        return new Response(JSON.stringify({ error: 'Access denied.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      let body;
      try { body = await request.json(); } catch (_) { body = {}; }
      const periodStart = String(body?.periodStart || '').slice(0, 20);
      const label = String(body?.periodLabel || 'the current period').slice(0, 80);
      if (periodStart) {
        // The INSERT is the dedup: two different staff members' browsers can
        // each notice the same period turning ready, but only the one whose
        // INSERT actually lands (doesn't collide on the PRIMARY KEY) sends
        // the push. A period that was already notified is a silent no-op.
        let firstToNotice = false;
        try {
          await env.DB.prepare('INSERT INTO payroll_ready_notified (period_start) VALUES (?)').bind(periodStart).run();
          firstToNotice = true;
        } catch (_) { /* already notified — not an error */ }
        if (firstToNotice) {
          ctx.waitUntil(pushToAllSubscribers(env, {
            title: 'Payroll ready to approve', body: `${label} — all hours are in.`,
            tag: 'payroll-ready', url: '/payroll',
          }));
        }
      }
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Email the gross-pay report to the bookkeeper. The page posts the figures
    // rather than rendered HTML, and the table is built here with everything
    // escaped — a staff name must not be able to become markup in something
    // that lands in an outside inbox.
    if (path === '/payroll/email' && method === 'POST') {
      if (!hasPermission(currentUser, 'payroll_manage')) {
        return new Response(JSON.stringify({ error: 'Access denied.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      const to = (await env.DB.prepare("SELECT value FROM site_settings WHERE key='payroll_bookkeeper_email'").first().catch(() => null))?.value || '';
      if (!to.trim()) {
        return new Response(JSON.stringify({ error: 'No bookkeeper address is set. Add one under Settings → Bookkeeper email.' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
      let body;
      try { body = await request.json(); } catch (_) {
        return new Response(JSON.stringify({ error: 'Could not read the report.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      // A period already emailed today asks before sending again, rather
      // than silently piling a second copy into the bookkeeper's inbox — the
      // exact "keep spamming" complaint the toast fix above was found while
      // chasing. This is a real question, not an error: `already_sent` is a
      // 200 the client reads specially, and `force:true` on a resend skips
      // the check entirely rather than needing a second distinct route.
      if (body.periodStart && !body.force) {
        const prior = await env.DB.prepare(
          `SELECT created_at, after_state FROM audit_log
           WHERE entity_type='payroll' AND entity_id=? AND action='email'
           ORDER BY created_at DESC LIMIT 1`
        ).bind(String(body.periodStart)).first().catch(() => null);
        if (prior) {
          const sinceMs = Date.now() - new Date(prior.created_at).getTime();
          if (sinceMs >= 0 && sinceMs < 12 * 60 * 60 * 1000) {
            let priorTo = '';
            try { priorTo = JSON.parse(prior.after_state || '{}').to || ''; } catch (_) { /* ignore */ }
            return new Response(JSON.stringify({
              already_sent: true,
              last_sent_at: prior.created_at,
              last_sent_to: priorTo,
            }), { headers: { 'Content-Type': 'application/json' } });
          }
        }
      }

      const mdoRows = Array.isArray(body.mdo?.rows) ? body.mdo.rows : [];
      const churchRows = Array.isArray(body.church?.rows) ? body.church.rows : [];
      if (!mdoRows.length && !churchRows.length) {
        return new Response(JSON.stringify({ error: 'There is nothing to send.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const label = String(body.periodLabel || '').slice(0, 80);
      // The figures live in the attached CSV and PDF now, not a table in the
      // body — the body just says the period and that they're attached.
      // Whether the run was signed off still stays in the body itself,
      // because that's the difference between "here are the figures" and
      // "these are final", and it's worth knowing before opening either file.
      const stateLine = body.approved
        ? `Approved${body.approvedBy ? ' by ' + escapeHtml(String(body.approvedBy).slice(0, 60)) : ''}.`
        : `Not yet approved — these figures may still change.`;
      const warn = body.incomplete
        ? `<p style="margin:10px 0 0;font:400 13px/1.5 Arial,sans-serif;color:#8A4A4A;"><strong>Incomplete:</strong> the childcare app could not be reached, so no MDO staff are in this report.</p>`
        : '';

      const emailHtml = `<div style="max-width:520px;margin:0 auto;padding:22px;background:#FBF8F3;font-family:Arial,sans-serif;">
        <h1 style="margin:0 0 10px;font:600 20px/1.3 Georgia,serif;color:#1E2D4A;">Timothy Lutheran — payroll</h1>
        <p style="margin:0;font:400 14px/1.6 Arial,sans-serif;color:#3A3A4A;">Payroll for ${escapeHtml(label)} is attached (CSV and PDF).</p>
        <p style="margin:6px 0 0;font:400 13px/1.5 Arial,sans-serif;color:${body.approved ? '#3B4C2E' : '#7A5B18'};">${stateLine}</p>
        ${warn}
        <p style="margin:18px 0 0;font:400 12px/1.5 Arial,sans-serif;color:#8A8271;">Sent from the Timothy Lutheran admin by ${escapeHtml(currentUser?.username || 'the office')}.</p>
      </div>`;

      // sendTransactionalEmail RETURNS {error}, it does not throw — a bare
      // try/catch here would report success on every failure.
      // Andrew's own address always rides along with the bookkeeper's — he
      // asked for a copy of every report he sends, not just the bookkeeper's
      // copy. Deduped in case it's ever also the configured bookkeeper address.
      const recipients = Array.from(new Set(
        [...to.split(','), 'dinger@timothystl.org'].map((x) => x.trim().toLowerCase()).filter(Boolean)
      ));

      // The CSV and PDF attachments are built from the same posted figures
      // the HTML table above already read — one report, three shapes, never
      // a fourth copy that could quietly disagree with what's on screen.
      // Brevo's attachment field wants base64; bytesToBase64 goes through
      // TextEncoder so a name with a real accented character round-trips
      // correctly in the CSV (the PDF's own text is ASCII-only by
      // construction — see admin/pdf.js — so the same helper is exact for
      // both, not just close enough).
      function bytesToBase64(bytes) {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
      }
      const toBase64 = (str) => bytesToBase64(new TextEncoder().encode(str));
      let attachments = [];
      try {
        const safeName = label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || String(body.periodStart || 'period');
        attachments = [
          { name: `payroll-${safeName}.csv`, content: toBase64(buildPayrollCsv(body)) },
          { name: `payroll-${safeName}.pdf`, content: toBase64(buildMonospacePdf(buildPayrollPdfLines(body))) },
        ];
      } catch (e) {
        // A malformed attachment must not silently swallow the whole
        // report — the bookkeeper still gets the HTML table in the body
        // either way, and the reference is logged for the office to chase.
        console.error('payroll report attachment build failed:', e.message);
        attachments = [];
      }

      let sent;
      try {
        sent = await sendTransactionalEmail(env, {
          toEmails: recipients,
          subject: `Payroll — ${label}`,
          htmlContent: emailHtml,
          attachments,
        });
      } catch (e) {
        sent = { error: e.message };
      }
      if (!sent || sent.error) {
        return new Response(JSON.stringify({ error: 'It could not be sent: ' + (sent?.error || 'unknown error') }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        });
      }
      await logAudit(env.DB, currentUser, 'email', 'payroll', String(body.periodStart || ''), `Payroll ${label}`, null, { to: recipients.join(', '), total: body.total });
      return new Response(JSON.stringify({ ok: true, to: recipients.join(', ') }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── GYM ADMIN ROUTES (auth + gym_manage) ───────────────────
    if (path.startsWith('/gym-rentals')) {
      if (!hasPermission(currentUser, 'gym_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      const r = await handleGymRoutes(path, method, url, request, env, currentUser, ctx, await portalOrigin(env), await pageBadges());
      if (r) return r;
    }

    // ── CHRISTMAS MARKET VENDORS (auth + market_manage) ────────
    // The coordinator's list — what the 2024 spreadsheet was for. Unchanged
    // and unmoved: the market keeps its own screen, its own permission, and
    // its own three-step application — see admin/events.js's header comment
    // on why the market's own form was not rebuilt onto site_event_fields.
    {
      const r = await handleMarketRoutes(request, env, path, method, currentUser, url,
        path === '/market' ? await pageBadges() : {});
      if (r) return r;
    }

    // ── EVENTS, GENERALIZED (auth; each screen checks its own permission) ──
    // A second event onward — VBS, the Egg Hunt, a concert — is a row here,
    // not a deploy. Each event's own permission gate lives inside
    // handleEventsRoutes itself, the same shape handleMarketRoutes already
    // is, because /events/:id has to check a DIFFERENT permission per row
    // (market_manage for the market, event_<id>_manage for everything else).
    {
      const r = await handleEventsRoutes(request, env, path, method, currentUser, url,
        (path === '/events' || path.startsWith('/events/')) ? await pageBadges() : {});
      if (r) return r;
    }

    // ── FILTERED MAIL (auth + settings_manage) ─────────────────
    // The review queue for anything the public forms held as spam.
    {
      // This delegation runs for every authenticated request and returns null
      // off its paths — badges are only worth three COUNTs when the screen
      // that shows them is actually the one being served.
      const r = await handleFilteredRoutes(request, env, path, method, currentUser, ctx,
        path.startsWith('/filtered') ? await pageBadges() : {});
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
    // ── FX-08: AN UPLOAD NEEDS SOMETHING TO PUT THE FILE ON ────────────────
    // Both uploaders checked that a session existed and nothing else, so ANY
    // account could host arbitrary images and PDFs on admin.timothystl.org,
    // permanently — nothing ever deletes an R2 object, as the Media screen's
    // own delete message admits. That included a Market coordinator holding
    // `market_manage` alone and a Bookkeeper holding the money permissions,
    // neither of whom has a screen that uploads anything.
    //
    // ⚠ A SET, NOT ONE PERMISSION, and derived from where the uploader is
    // actually wired rather than from what sounds tidy: the classic TinyMCE
    // handler (every rich field — newsletter, news, sermons, ministries,
    // notices), the block editor's picker, the news header image, the staff
    // photo picker, the Appearance logo, the Partners logo, and the gym's own
    // rich editor. Anything not on this list has no screen that can reach
    // these routes, so gating it costs nothing and closes the hole.
    const UPLOAD_IMAGE_PERMS = ['newsletter_edit', 'news_edit', 'ministries_edit',
      'sermons_edit', 'pages_edit', 'pages_edit_own', 'notices_edit', 'staff_edit',
      'gym_manage'];
    // The voter-document uploader is on one screen only, behind one permission.
    const UPLOAD_DOC_PERMS = ['notices_edit'];
    const canAny = (perms) => perms.some((k) => hasPermission(currentUser, k));

    if (path === '/api/upload-image' && method === 'POST') {
      if (!canAny(UPLOAD_IMAGE_PERMS)) {
        return new Response(JSON.stringify({ error: 'Your account cannot upload images.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
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
      // ── [B6] STRIP THE METADATA BEFORE IT IS STORED ──
      // A photo off a phone carries EXIF, and EXIF routinely carries GPS. Every
      // file that lands here is then served publicly from this domain forever,
      // so somebody's home address can end up in a staff portrait with nobody
      // involved aware it is there.
      //
      // It happens HERE rather than in the browser because only one of the
      // uploaders re-encodes (the staff photo picker) — the news header image,
      // the rich-text editors and the logo picker all post the file exactly as
      // it came off the phone, and they all come through this route. A privacy
      // guarantee that depends on which button somebody clicked is not one.
      //
      // Reading the body into memory is a real cost that streaming avoided, but
      // it is bounded by the 8MB cap above and the metadata cannot be found
      // without it. stripImageMetadata fails open: anything it cannot parse
      // with confidence comes back untouched rather than mangled.
      const clean = stripImageMetadata(new Uint8Array(await file.arrayBuffer()));
      await env.IMAGES.put(key, clean, { httpMetadata: { contentType: mimeType } });
      const url = `${new URL(request.url).origin}/images/${key}`;
      return new Response(JSON.stringify({ url, location: url }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── UPLOAD VOTER DOCUMENT TO R2 ──
    if (path === '/api/upload-doc' && method === 'POST') {
      if (!canAny(UPLOAD_DOC_PERMS)) {
        return new Response(JSON.stringify({ error: 'Your account cannot upload documents.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
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
    if ((path === '/voters' || path === '/voters-add-file' || path === '/voters-delete-file') && !hasPermission(currentUser, 'notices_edit')) {
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
${sidebarShell('voters', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Voters page</div>
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
      const alertHtml = url.searchParams.get('saved') ? `<div class="alert alert-success">✓ Saved.</div>` : '';
      const [series, notes] = await Promise.all([
        env.DB.prepare('SELECT * FROM sermon_series ORDER BY active DESC, sort_order ASC, id DESC').all(),
        env.DB.prepare('SELECT * FROM sermon_notes ORDER BY COALESCE(date, \'\') DESC, id DESC').all(),
      ]);
      const bySeries = {};
      const standalone = [];
      for (const n of notes.results) {
        if (n.series_id) (bySeries[n.series_id] = bySeries[n.series_id] || []).push(n);
        else standalone.push(n);
      }

      // The library has no recordings attached yet, and the site is built to
      // cope: a sermon with a link gets a play thumbnail, one without gets a
      // text-only card. Nothing here needs a setting — the row reports which
      // state each sermon is in so it is obvious what is missing.
      // The design's three words: YouTube / Audio / Text only. "Text only" is
      // deliberately not a warning — a sermon with no recording is a perfectly
      // good text card on the site, and adding a link later upgrades it with
      // no other edit. Calling it "No recording" in amber made a normal state
      // look like a fault.
      const mediaCell = (n) => {
        const kinds = [];
        if (n.youtube_url) kinds.push('YouTube');
        if (n.audio_url) kinds.push('Audio');
        return kinds.length ? statusPill('good', kinds.join(' + ')) : statusPill('plain', 'Text only');
      };

      const rows = [];
      for (const s of series.results) {
        const kids = bySeries[s.id] || [];
        const withMedia = kids.filter((n) => n.youtube_url || n.audio_url).length;
        rows.push({
          href: `/sermons/edit-series/${s.id}`,
          filter: ['series', s.active ? 'active-series' : ''].filter(Boolean),
          search: `${s.title} ${s.date_range || ''}`.toLowerCase(),
          cells: [
            primaryCell(s.title, s.date_range || pluralise(kids.length, 'sermon')),
            escapeHtml(s.date_range || '—'),
            '',
            s.active ? statusPill('good', 'Active series') : (s.playlist_url ? statusPill('plain', 'Playlist') : statusPill('plain', pluralise(kids.length, 'sermon'))),
          ],
          actions: `<a class="tlc-edit" href="/sermons/new-note?series_id=${s.id}">+ Sermon</a><a class="tlc-edit" href="/sermons/edit-series/${s.id}">Edit</a>`,
        });
        for (const n of kids) {
          rows.push({
            child: true,
            href: `/sermons/edit-note/${n.id}`,
            filter: (n.youtube_url || n.audio_url) ? [] : ['missing-media'],
            search: `${n.title || ''} ${n.scripture || ''} ${s.title}`.toLowerCase(),
            cells: [
              primaryCell(n.title || '(untitled)', s.title),
              escapeHtml(n.date || '—'),
              escapeHtml(n.scripture || '—'),
              mediaCell(n),
            ],
          });
        }
      }
      for (const n of standalone) {
        rows.push({
          href: `/sermons/edit-note/${n.id}`,
          filter: (n.youtube_url || n.audio_url) ? [] : ['missing-media'],
          search: `${n.title || ''} ${n.scripture || ''}`.toLowerCase(),
          cells: [
            primaryCell(n.title || '(untitled)', 'Not part of a series'),
            escapeHtml(n.date || '—'),
            escapeHtml(n.scripture || '—'),
            mediaCell(n),
          ],
        });
      }

      return html(`
${sidebarShell('sermons', currentUser, `<a href="https://timothystl.org/sermons" target="_blank">View page</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'sermons',
    title: sectionCfg('sermons').title,
    purpose: sectionCfg('sermons').purpose,
    action: { label: sectionCfg('sermons').action, href: '/sermons/new-series' },
    // Beside the primary button rather than up in the topbar. A sermon with no
    // series is a real thing to add, and putting it next to the sign-out link
    // made it look like part of the chrome rather than part of this screen.
    altActions: [{ label: '+ Standalone sermon', href: '/sermons/new-note' }],
    search: sectionCfg('sermons').search,
    filters: filtersOf('sermons'),
    columns: columnsOf('sermons'),
    rows,
    noun: 'entry', nounPlural: 'entries',
    empty: 'No series or sermons yet.',
    note: sectionCfg('sermons').note,
  })}
</div>`, 'Sermons Admin');
    }

    // ── SERMONS: THE TWO FORMS, ONCE EACH ──
    // Series and sermons each had a New and an Edit that were the same fields
    // twice, on the old chrome. One builder apiece, through the shared renderer.
    const seriesFormHtml = (r = null) => renderFormSection({
      title: r ? (r.title || 'Edit series') : 'New series',
      purpose: r
        ? 'The series and its date range, as they read on the sermons page.'
        : 'A run of sermons under one heading. Add the sermons themselves once it exists.',
      action: r ? `/sermons/edit-series/${r.id}` : '/sermons/new-series',
      cancelHref: '/sermons',
      saveLabel: r ? 'Save changes' : 'Create series',
      deleteAction: r ? `/sermons/delete-series/${r.id}` : '',
      deleteConfirm: r ? `Delete “${r.title}” and every sermon in it? This cannot be undone.` : '',
      deleteLabel: 'Delete series',
      fields: [
        { name: 'title', label: 'Series title', value: r ? r.title : '', required: true, placeholder: 'The Shepherd’s Way' },
        { kind: 'textarea', name: 'description', label: 'Description', rows: 3, value: r ? (r.description || '') : '',
          placeholder: 'What the series is about.' },
        { name: 'date_range', label: 'Date range', value: r ? (r.date_range || '') : '', placeholder: 'Lent 2026 · March–April',
          hint: 'Free text — it is read, not sorted on.' },
        { name: 'playlist_url', type: 'url', label: 'YouTube playlist', value: r ? (r.playlist_url || '') : '',
          placeholder: 'https://www.youtube.com/playlist?list=…', hint: 'Optional.' },
        { kind: 'toggle', name: 'active', label: 'The current series', value: r ? !!r.active : false,
          on: 'Current', off: 'Past series',
          hint: 'One series at a time is the current one. Turning this on turns it off everywhere else.' },
      ],
    });

    const noteFormHtml = (n, seriesRows, presetSeries = '') => {
      const isNew = !n;
      const back = (n && n.series_id) || presetSeries ? `/sermons/notes/${(n && n.series_id) || presetSeries}` : '/sermons';
      return renderFormSection({
        title: isNew ? 'New sermon' : n.title || 'Edit sermon',
        purpose: 'A sermon with no recording is a good text card on the site. Adding a link later upgrades it with no other edit.',
        action: isNew ? '/sermons/new-note' : `/sermons/edit-note/${n.id}`,
        cancelHref: back,
        saveLabel: isNew ? 'Add sermon' : 'Save changes',
        deleteAction: isNew ? '' : `/sermons/delete-note/${n.id}`,
        deleteConfirm: `Delete “${(n && n.title) || 'this sermon'}”?`,
        deleteLabel: 'Delete sermon',
        wide: true,
        fields: [
          { kind: 'choice', name: 'series_id', label: 'Series',
            value: String((n && n.series_id) || presetSeries || ''),
            options: [{ value: '', label: '— Standalone sermon —' }]
              .concat(seriesRows.map((x) => ({ value: String(x.id), label: x.title }))),
            hint: 'A standalone sermon stands on its own on the sermons page.' },
          { kind: 'date', name: 'date', label: 'Date', value: n ? (n.date || '') : '' },
          { name: 'title', label: 'Sermon title', value: n ? n.title : '', required: true, placeholder: 'You prepare a table before me' },
          { name: 'scripture', label: 'Scripture', value: n ? (n.scripture || '') : '', placeholder: 'Psalm 23:5' },
          { kind: 'html', html: tinymceSermonSection(n ? n.outline : '') },
          { name: 'youtube_url', type: 'url', label: 'YouTube link', value: n ? (n.youtube_url || '') : '',
            placeholder: 'https://…', hint: 'Optional. With one, the card gains a play button.' },
        ],
      });
    };

    if (path === '/sermons/new-series' && method === 'GET') {
      return html(`
${sidebarShell('sermons', currentUser, `<a href="/sermons">All sermons</a>`, await pageBadges())}
<div class="tlc-wrap">${seriesFormHtml()}</div>`, 'New series — TLC Admin');
    }

    if (path === '/sermons/new-series' && method === 'POST') {
      const form = await request.formData();
      const title = (form.get('title') || '').trim();
      if (!title) return new Response('', { status: 302, headers: { Location: '/sermons' } });
      const active = form.getAll('active').includes('1') ? 1 : 0;
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
${sidebarShell('sermons', currentUser, `<a href="/sermons/notes/${id}">Sermons in this series</a>`, await pageBadges())}
<div class="tlc-wrap">${seriesFormHtml(s)}</div>`, 'Edit series — TLC Admin');
    }

    if (path.startsWith('/sermons/edit-series/') && method === 'POST') {
      const id = path.split('/').pop();
      const form = await request.formData();
      const title = (form.get('title') || '').trim();
      const active = form.getAll('active').includes('1') ? 1 : 0;
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
${sidebarShell('sermons', currentUser, `<a href="/sermons">← All series</a>`, await pageBadges())}
<div class="tlc-wrap">
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
      return html(`
${sidebarShell('sermons', currentUser, `<a href="${seriesId ? '/sermons/notes/' + seriesId : '/sermons'}">All sermons</a>`, await pageBadges())}
<div class="tlc-wrap">${noteFormHtml(null, allSeries.results, seriesId)}</div>`, 'New sermon — TLC Admin', TINYMCE_HEAD);
    }

    if (path === '/sermons/new-note' && method === 'POST') {
      const form = await request.formData();
      const title = (form.get('title') || '').trim();
      if (!title) return new Response('', { status: 302, headers: { Location: '/sermons' } });
      const seriesId = form.get('series_id') || null;
      await env.DB.prepare('INSERT INTO sermon_notes (series_id, date, title, scripture, outline, youtube_url) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(seriesId || null, form.get('date') || null, title, form.get('scripture') || '',
              sanitizeClassicRich(form.get('outline') || ''), form.get('youtube_url') || '').run();   // FX-04
      const redir = seriesId ? `/sermons/notes/${seriesId}` : '/sermons';
      return new Response('', { status: 302, headers: { Location: redir + '?saved=1' } });
    }

    if (path.startsWith('/sermons/edit-note/') && method === 'GET') {
      const id = path.split('/').pop();
      const n = await env.DB.prepare('SELECT * FROM sermon_notes WHERE id = ?').bind(id).first();
      if (!n) return new Response('Not found', { status: 404 });
      const allSeries = await env.DB.prepare('SELECT id, title FROM sermon_series ORDER BY active DESC, id DESC').all();
      return html(`
${sidebarShell('sermons', currentUser, `<a href="${n.series_id ? '/sermons/notes/' + n.series_id : '/sermons'}">All sermons</a>`, await pageBadges())}
<div class="tlc-wrap">${noteFormHtml(n, allSeries.results)}</div>`, 'Edit sermon — TLC Admin', TINYMCE_HEAD);
    }

    if (path.startsWith('/sermons/edit-note/') && method === 'POST') {
      const id = path.split('/').pop();
      const form = await request.formData();
      const title = (form.get('title') || '').trim();
      const seriesId = form.get('series_id') || null;
      await env.DB.prepare('UPDATE sermon_notes SET series_id=?, date=?, title=?, scripture=?, outline=?, youtube_url=? WHERE id=?')
        .bind(seriesId || null, form.get('date') || null, title, form.get('scripture') || '',
              sanitizeClassicRich(form.get('outline') || ''), form.get('youtube_url') || '', id).run();   // FX-04
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
    const isNewsletterRoute = ['/new', '/publish', '/newsletter/preview'].includes(path) || path.startsWith('/edit/') || path.startsWith('/send-email/') || path.startsWith('/delete/') || path.startsWith('/newsletter/duplicate/');
    const isNewsItemRoute = path === '/newsitems' || path.startsWith('/newsitems/');
    if (isNewsletterRoute && !hasPermission(currentUser, 'newsletter_edit') && !hasPermission(currentUser, 'newsletter_approve')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (isNewsItemRoute && !hasPermission(currentUser, 'news_edit')) {
      return new Response('Access denied.', { status: 403 });
    }

    // ── NEW NEWSLETTER FORM ──
    // The extra note slots. All of them are rendered so TinyMCE can initialize
    // each one at load; the unused ones are simply hidden, and "+ Add another
    // note" reveals the next. Creating an editor instance on click would be a
    // second way for a rich field to exist, and that is how one of them ends up
    // behaving differently from the rest.
    const extraNoteFields = (list) => {
      const rows = [];
      for (let i = 0; i < MAX_EXTRA_NOTES; i++) {
        const n = list[i] || { title: '', body: '' };
        const shown = i < Math.max(list.length, 1);
        rows.push(`<div class="tlc-extra-note" data-extra="${i}"${shown ? '' : ' hidden'}>
          <div class="form-group">
            <label>Heading <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
            <input type="text" name="extra_title_${i}" value="${escapeHtml(n.title || '')}" placeholder="e.g. Thank you">
          </div>
          <div class="form-group">
            ${tinymceNoteSection(`extra-editor-${i}`, `extra_note_${i}`, n.body || '', 140)}
          </div>
        </div>`);
      }
      return rows.join('');
    };
    const extraNotesScript = `<script>
    (function(){
      var btn = document.getElementById('add-extra-note');
      if (!btn) return;
      var slots = Array.prototype.slice.call(document.querySelectorAll('.tlc-extra-note'));
      function sync(){
        var next = slots.filter(function(s){ return s.hasAttribute('hidden'); })[0];
        btn.style.display = next ? '' : 'none';
      }
      btn.addEventListener('click', function(){
        var next = slots.filter(function(s){ return s.hasAttribute('hidden'); })[0];
        if (next) next.removeAttribute('hidden');
        sync();
      });
      sync();
    })();
    </script>`;

    if (path === '/new' && method === 'GET') {
      const today = churchDate();
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
${sidebarShell('news', currentUser, `<a href="/newsitems">← News &amp; Events</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">New newsletter</div>
  <div class="page-sub">Write your update, add events, and publish to the website.</div>

  <form method="POST" action="/publish" enctype="multipart/form-data">
  <input type="hidden" name="format" id="format-input" value="weekly">

  <div class="card">
    <div class="card-title">What are you writing?</div>
    <div class="tlc-fmt" style="flex-direction:row;">
      <button type="button" class="tlc-fmt-pill is-on" id="fmt-weekly" onclick="pickFormat('weekly')">Weekly</button>
      <button type="button" class="tlc-fmt-pill" id="fmt-quick" onclick="pickFormat('quick')">Special edition</button>
    </div>
    <div style="font-size:12.5px;color:var(--gray);margin-top:8px;">Weekly carries the pastor's note, events and ministry content. A special edition is a short message with an optional button — snow days, funerals, schedule changes.</div>
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
      <div class="card">
        <div class="card-title">More notes <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A fourth and fifth block, below everything else — a thank-you, a correction, a one-off appeal. Each appears only if you write something in it.</div>
        ${extraNoteFields([])}
        <button type="button" class="add-event-btn" id="add-extra-note">+ Add another note</button>
        ${extraNotesScript}
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
        <label><input type="radio" name="email_send" value="test" checked> Test list</label>
        <label><input type="radio" name="email_send" value="all"> Members</label>
        <label><input type="radio" name="email_send" value="none"> Website only (no email)</label>
      </div>
      <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-top:6px;">These are the two lists in Brevo &mdash; the test list and the member list. This is the only place the audience is chosen.</div>
      <div style="margin-top:14px;padding:12px 14px;background:var(--mist);border-radius:8px;border:1px solid var(--ice);font-family:var(--sans);font-size:12px;color:var(--charcoal);line-height:1.7;">
        📊 <strong>Email is sent via Brevo.</strong> To see open rates, clicks, and delivery stats after sending, log in at <a href="https://app.brevo.com" target="_blank" style="color:var(--mid);font-weight:700;">app.brevo.com</a> → Campaigns.
      </div>
    </div>

    <div class="btn-row" style="margin-top:8px;">
      ${hasPermission(currentUser, 'newsletter_approve') ? `<button type="submit" name="action" value="publish" class="btn btn-primary">Publish</button>` : ''}
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
  document.getElementById('fmt-weekly').classList.toggle('is-on', fmt === 'weekly');
  document.getElementById('fmt-quick').classList.toggle('is-on', fmt === 'quick');
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
      // ── THE LOCK ──
      // A sent issue is read-only, enforced here rather than only in the UI.
      // Once ~600 people have a copy in their inbox, the archived copy on the
      // website has to keep saying what was actually sent — editing it would
      // make the archive a lie. Checked before anything is read from the form
      // so a crafted POST cannot get partway in.
      {
        const lockId = form.get('newsletter_id');
        if (lockId) {
          const existing = await env.DB.prepare(
            'SELECT status, approval_status, sent_at, beehiiv_id, brevo_campaign_id FROM newsletters WHERE id = ?'
          ).bind(lockId).first();
          const verdict = canEditNewsletter(existing);
          if (!verdict.ok) {
            return new Response('', { status: 302, headers: { Location: `/edit/${lockId}?msg=locked` } });
          }
        }
      }
      const subject = form.get('subject') || '';
      const publishedAt = form.get('published_at') || churchDate();
      const action = form.get('action') || 'publish';
      const fmt = form.get('format') || 'weekly';
      const editId = form.get('newsletter_id') || null; // present when editing an existing newsletter
      const emailSend = form.get('email_send') || 'none';
      // Test sends stay as drafts — only 'all' or 'none' (website-only) publishes to the archive
      const status = (action === 'publish' && emailSend !== 'test') ? 'published' : 'draft';

      const preheader = form.get('preheader') || '';
      // `audience` no longer has a control on the form — the Send email card picks the real
      // Brevo list, and the three-way "Who gets it" select named lists that do not exist. The
      // column stays and keeps whatever an older issue recorded, rather than every save
      // silently rewriting it to the default; nothing reads it today either way.
      let audience = normalizeAudience(form.get('audience'));
      if (!form.has('audience') && editId) {
        const prior = await env.DB.prepare('SELECT audience FROM newsletters WHERE id = ?').bind(editId).first().catch(() => null);
        if (prior && prior.audience) audience = normalizeAudience(prior.audience);
      }
      // Only the switches the form actually rendered are considered. A checkbox
      // posts nothing when off, so `block_seen` records which ones were on the
      // page — without it, a form that never showed a switch would read as
      // "off" and silently drop that section from the issue.
      // A form that rendered no switches at all (the new-newsletter form) must
      // store NULL, not an all-false object — null means "defaults, everything
      // on", whereas all-false would silently ship an empty issue.
      const seenBlocks = form.getAll('block_seen');
      const blocksJson = seenBlocks.length
        ? serializeNlBlocks(Object.fromEntries(seenBlocks.map((k) => [k, form.get('block_' + k) === '1'])))
        : null;

      // Strip <img src="blob:..."> tags — these are temporary in-browser URLs
      // that render as broken icons in email if the upload didn't finish.
      const stripBlobImgs = s => (s || '').replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');
      // ── FX-04: EVERY RICH FIELD ON THIS FORM GOES THROUGH HERE ──────────
      // These fields are stored as markup on purpose and rendered as markup on
      // purpose — into six hundred inboxes by admin/email.js, and into
      // `innerHTML` on timothystl.org by loadNewsletters()/loadNewsletterDetail().
      // Until this line they were stored exactly as posted, so an account
      // holding only `newsletter_edit` could put script on the public site.
      //
      // ⚠ sanitizeClassicRich, NOT sanitizeRich. The classic toolbar has a
      // table button and writes its own image styles; the page editor's
      // allowlist would delete both. See the note on CLASSIC_PROFILE in
      // admin/blocks.js.
      const cleanRich = s => sanitizeClassicRich(stripBlobImgs(s));

      // Weekly-specific fields
      const pastorNote = cleanRich(form.get('pastor_note') || '');
      const secondaryNote = fmt === 'weekly' ? cleanRich(form.get('secondary_note') || '') : '';
      const wolContent = fmt === 'weekly' ? cleanRich(form.get('wol_content') || '') : '';
      const lasmContent = fmt === 'weekly' ? cleanRich(form.get('lasm_content') || '') : '';
      const tertiaryNote = fmt === 'weekly' ? cleanRich(form.get('tertiary_note') || '') : '';
      // Blank slots collapse, so filling the third box without the second
      // does not leave a hole in the email.
      const extraNotesJson = fmt === 'weekly'
        ? serializeExtras(extrasFromForm(form).map((n) => ({ title: n.title, body: cleanRich(n.body) })))
        : '[]';
      const tertiaryCtaLabel = fmt === 'weekly' ? form.get('tertiary_cta_label') || '' : '';
      const tertiaryCtaUrl = fmt === 'weekly' ? form.get('tertiary_cta_url') || '' : '';
      // Legacy fields kept for DB compat but no longer used in the form
      const ministryContent = '';
      const ministryType = 'text';

      // Quick-announcement-specific fields
      const quickBody = cleanRich(form.get('quick_body') || '');
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
          'UPDATE newsletters SET subject=?, pastor_note=?, ministry_content=?, ministry_type=?, published_at=?, format=?, cta_url=?, cta_label=?, status=?, wol_content=?, lasm_content=?, secondary_note=?, news_item_ids=?, tertiary_note=?, tertiary_cta_label=?, tertiary_cta_url=?, bible_classes=?, preheader=?, audience=?, blocks=?, extra_notes=? WHERE id=?'
        ).bind(subject, savedNote, ministryContent, ministryType, publishedAt, fmt, ctaUrl, ctaLabel, status, wolContent, lasmContent, secondaryNote, newsIdsStr, tertiaryNote, tertiaryCtaLabel, tertiaryCtaUrl, bibleClassesJson, preheader, audience, blocksJson, extraNotesJson, editId).run();
        newsletterId = parseInt(editId, 10);
        // Replace events
        await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(newsletterId).run();
      } else {
        // Insert new newsletter
        const result = await env.DB.prepare(
          'INSERT INTO newsletters (subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, status, wol_content, lasm_content, secondary_note, news_item_ids, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes, preheader, audience, blocks, extra_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(subject, savedNote, ministryContent, ministryType, publishedAt, fmt, ctaUrl, ctaLabel, status, wolContent, lasmContent, secondaryNote, newsIdsStr, tertiaryNote, tertiaryCtaLabel, tertiaryCtaUrl, bibleClassesJson, preheader, audience, blocksJson, extraNotesJson).run();
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
        // This is what makes the approval queue worth having — without it,
        // "awaiting approval" is a tag nobody notices until they happen to
        // open the newsletter list. Never awaited, same reasoning as every
        // other push trigger here: a push failure must never turn into a
        // failure to submit.
        ctx.waitUntil(pushToAllSubscribers(env, {
          title: 'Newsletter awaiting approval',
          body: `${currentUser.username} submitted "${subject}" for approval.`,
          tag: 'newsletter-approval', url: `/edit/${newsletterId}`,
        }));
        return new Response('', {
          status: 302,
          headers: { Location: `/newsletters?msg=submitted&subject=${encodeURIComponent(subject)}` }
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
          // sent_at/sent_count are what isSent() and the list's "Sent" pill
          // read — without this the email genuinely goes out but the row
          // keeps reading Draft, same as the dedicated /send-email/:id route.
          // The count is the real Brevo list size, not the local signup
          // table — that table only holds website-form signups and badly
          // undercounts an audience also built from Breeze imports/manual adds.
          if (emailSend === 'all' && result.success) {
            const recipients = await getBrevoListCount(env, listId);
            await env.DB.prepare(
              "UPDATE newsletters SET sent_at = COALESCE(sent_at, ?), sent_count = COALESCE(sent_count, ?) WHERE id = ?"
            ).bind(new Date().toISOString(), recipients, newsletterId).run();
          }
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
        headers: { Location: `/newsletters?msg=${encodeURIComponent(redirectMsg)}&subject=${encodeURIComponent(subject)}${emailSuffix}` }
      });
    }

    // ── BIBLE CLASS TEMPLATE CRUD ──
    // ── CHRISTIAN EDUCATION: BIBLE CLASSES CRUD ──
    const isCeRoute = path === '/christian-education' || path.startsWith('/christian-education/');
    if (isCeRoute && !hasPermission(currentUser, 'news_edit')) return new Response('Access denied.', { status: 403 });

    // The add form lives on its own address rather than under the list, so
    // this section reads the same as every other one: a list, and one action
    // that opens a form.
    // ── CHRISTIAN ED: THE FORM, ONCE ──
    // Add and Edit were two copies of the same fields on the old chrome. One
    // builder, through the shared renderer.
    const ceFormHtml = (c = null) => {
      const isNew = !c;
      const ACCENT_OPTS = [['mid', 'Navy'], ['teal', 'Teal'], ['steel', 'Steel'], ['sage', 'Moss'], ['amber', 'Gold'], ['plum', 'Plum']];
      return renderFormSection({
        title: isNew ? 'New class' : c.title || 'Edit class',
        purpose: isNew
          ? 'It appears on /education and in the newsletter’s class picker as soon as you save.'
          : 'Changes reach /education and the newsletter picker as soon as you save.',
        action: isNew ? '/christian-education/create' : `/christian-education/update/${c.id}`,
        cancelHref: '/christian-education',
        saveLabel: isNew ? 'Add class' : 'Save changes',
        deleteAction: isNew ? '' : `/christian-education/delete/${c.id}`,
        deleteConfirm: `Delete “${(c && c.title) || 'this class'}”? It disappears from /education.`,
        fields: [
          { name: 'title', label: 'Class title', value: c ? c.title : '', required: true, placeholder: 'Men’s Bible Study' },
          { name: 'label', label: 'Eyebrow', value: c ? (c.label || '') : '', placeholder: 'Saturday mornings',
            hint: 'The small line above the title on the website.' },
          { name: 'schedule', label: 'Schedule', value: c ? (c.schedule || '') : '', placeholder: 'Saturdays · 8:00 AM' },
          { kind: 'textarea', name: 'description', label: 'Description', rows: 3, value: c ? (c.description || '') : '',
            placeholder: 'What the class is, and who it is for.' },
          { name: 'leader', label: 'Leader', value: c ? (c.leader || '') : '', placeholder: 'Pastor Matt' },
          { name: 'location', label: 'Location', value: c ? (c.location || '') : '', placeholder: 'Fellowship Hall' },
          { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">Core value</label>${valueChips('value', c ? c.value : null)}<p class="tlc-hint">Which of the four this class serves.</p></div>` },
          { kind: 'choice', name: 'accent', label: 'Accent color', value: c ? (c.accent || 'mid') : 'mid',
            options: ACCENT_OPTS.map(([v, l]) => ({ value: v, label: l })) },
          { kind: 'number', name: 'sort_order', label: 'Order', value: c ? (c.sort_order || 0) : 0, min: 0, step: 1,
            hint: 'Lower numbers come first on the education page.' },
          { kind: 'toggle', name: 'active', label: 'Running', value: c ? !!c.active : true,
            on: 'Running', off: 'Paused',
            hint: 'Paused takes it off the website and out of the newsletter picker without deleting it.' },
        ],
      });
    };

    if ((path === '/christian-education' || path === '/christian-education/new') && method === 'GET') {

      if (path === '/christian-education/new') {
        return html(`
${sidebarShell('christian-education', currentUser, `<a href="/christian-education">All classes</a>`, await pageBadges())}
<div class="tlc-wrap">${ceFormHtml()}</div>`, 'New class — TLC Admin');
      }

      const ceRows = await env.DB.prepare('SELECT * FROM bible_classes ORDER BY sort_order, id').all();
      const ceMsg = url.searchParams.get('msg');
      const ceAlert = ceMsg === 'saved' ? `<div class="alert alert-success">✓ Class saved.</div>`
        : ceMsg === 'deleted' ? `<div class="alert alert-info">Class removed.</div>`
        : ceMsg === 'error' ? `<div class="alert alert-error">Title is required.</div>` : '';

      const rows = ceRows.results.map((c) => ({
        href: `/christian-education/edit/${c.id}`,
        filter: [c.active ? 'running' : 'paused', c.value || ''].filter(Boolean),
        search: `${c.title} ${c.label || ''} ${c.schedule || ''} ${c.leader || ''}`.toLowerCase(),
        cells: [
          `<div class="tlc-primary"><span class="tlc-primary-text">
            <span class="tlc-primary-title">${escapeHtml(c.title)}${c.value ? ` ${valueChip(c.value)}` : ''}</span>
            <span class="tlc-primary-sub">${escapeHtml([c.label, c.location].filter(Boolean).join(' · '))}</span>
          </span></div>`,
          escapeHtml(c.schedule || '—'),
          escapeHtml(c.leader || '—'),
          c.active ? statusPill('good', 'Running') : statusPill('plain', 'Paused'),
        ],
        actions: `<form method="POST" action="/christian-education/toggle/${c.id}" style="display:inline;margin:0;"><button type="submit" class="tlc-edit" style="background:none;border:0;cursor:pointer;font:inherit;color:inherit;">${c.active ? 'Pause' : 'Resume'}</button></form><a class="tlc-edit" href="/christian-education/edit/${c.id}">Edit</a>`,
      }));

      return html(`
${sidebarShell('christian-education', currentUser, `<a href="https://timothystl.org/education" target="_blank">View page</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${ceAlert ? `<div class="tlc-section" style="padding-bottom:0;">${ceAlert}</div>` : ''}
  ${renderListSection({
    key: 'christian-ed',
    title: sectionCfg('ed').title,
    purpose: sectionCfg('ed').purpose,
    action: { label: sectionCfg('ed').action, href: '/christian-education/new' },
    search: sectionCfg('ed').search,
    columns: columnsOf('ed'),
    filters: filtersOf('ed'),
    valueChips: sectionCfg('ed').valueChips,
    rows,
    noun: 'class', nounPlural: 'classes',
    empty: 'No classes yet.',
    note: 'Pausing a class keeps it in this list but takes it off the website — the right move for something that breaks for the summer and comes back.',
  })}
</div>`, 'Christian Education');
    }

    if (path === '/christian-education/create' && method === 'POST') {
      const ceForm = await request.formData();
      const title = (ceForm.get('title') || '').trim();
      if (!title) return new Response('', { status: 302, headers: { Location: '/christian-education?msg=error' } });
      // ⚠ A toggle posts a hidden `0` ahead of its checkbox, so `get()` returns
      // the 0 whether or not the box is ticked. `getAll(...).includes('1')` is
      // the only reading that is true when the switch is actually on.
      const ceActive = ceForm.getAll('active').includes('1') ? 1 : 0;
      const ceSort = parseInt(ceForm.get('sort_order') || '0', 10) || 0;
      await env.DB.prepare('INSERT INTO bible_classes (title, label, description, leader, location, schedule, accent, value, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(title, (ceForm.get('label')||'').trim()||null, (ceForm.get('description')||'').trim()||null, (ceForm.get('leader')||'').trim()||null, (ceForm.get('location')||'').trim()||null, (ceForm.get('schedule')||'').trim()||null, ceForm.get('accent')||'mid', normalizeValue(ceForm.get('value')), ceActive, ceSort).run();
      return new Response('', { status: 302, headers: { Location: '/christian-education?msg=saved' } });
    }

    if (path.startsWith('/christian-education/edit/') && method === 'GET') {
      const ceId = path.split('/').pop();
      const ceRow = await env.DB.prepare('SELECT * FROM bible_classes WHERE id = ?').bind(ceId).first();
      if (!ceRow) return new Response('Not found', { status: 404 });
      return html(`
${sidebarShell('christian-education', currentUser, `<a href="/christian-education">All classes</a>`, await pageBadges())}
<div class="tlc-wrap">${ceFormHtml(ceRow)}</div>`, 'Edit class — TLC Admin');
    }

    if (path.startsWith('/christian-education/update/') && method === 'POST') {
      const ceId = path.split('/').pop();
      const ceForm = await request.formData();
      const title = (ceForm.get('title') || '').trim();
      if (!title) return new Response('', { status: 302, headers: { Location: `/christian-education/edit/${ceId}?msg=error` } });
      await env.DB.prepare('UPDATE bible_classes SET title=?, label=?, description=?, leader=?, location=?, schedule=?, accent=?, value=?, active=?, sort_order=? WHERE id=?')
        .bind(title, (ceForm.get('label')||'').trim()||null, (ceForm.get('description')||'').trim()||null, (ceForm.get('leader')||'').trim()||null, (ceForm.get('location')||'').trim()||null, (ceForm.get('schedule')||'').trim()||null, ceForm.get('accent')||'mid', normalizeValue(ceForm.get('value')), ceForm.getAll('active').includes('1') ? 1 : 0, parseInt(ceForm.get('sort_order')||'0', 10) || 0, ceId).run();
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
    // Sent is permanent: neither of these has anywhere in the UI that offers
    // them on an already-sent issue, but with no server-side check that was
    // only ever a matter of the right stale tab or a stray click away —
    // Reject in particular would have reset a genuinely sent issue back to
    // draft with no warning. canEditNewsletter() is the one check the main
    // save path already trusts for this.
    if (path.startsWith('/newsletter/approve/') && method === 'POST') {
      if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
      const id = path.split('/').pop();
      const existing = await env.DB.prepare(
        'SELECT status, approval_status, sent_at, beehiiv_id, brevo_campaign_id FROM newsletters WHERE id = ?'
      ).bind(id).first();
      if (!canEditNewsletter(existing).ok) {
        return new Response('', { status: 302, headers: { Location: '/newsletters?msg=locked' } });
      }
      await env.DB.prepare("UPDATE newsletters SET status = 'published', approval_status = 'approved', approved_by_username = ? WHERE id = ?").bind(currentUser.username, id).run();
      return new Response('', { status: 302, headers: { Location: '/newsletters?msg=approved' } });
    }

    if (path.startsWith('/newsletter/reject/') && method === 'POST') {
      if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
      const id = path.split('/').pop();
      const existing = await env.DB.prepare(
        'SELECT status, approval_status, sent_at, beehiiv_id, brevo_campaign_id FROM newsletters WHERE id = ?'
      ).bind(id).first();
      if (!canEditNewsletter(existing).ok) {
        return new Response('', { status: 302, headers: { Location: '/newsletters?msg=locked' } });
      }
      await env.DB.prepare("UPDATE newsletters SET status = 'draft', approval_status = NULL, approved_by_username = NULL WHERE id = ?").bind(id).run();
      return new Response('', { status: 302, headers: { Location: '/newsletters?msg=rejected' } });
    }

    // ── EDIT EXISTING NEWSLETTER (GET) ──
    if (path.startsWith('/edit/') && method === 'GET') {
      const editId = path.split('/').pop();
      const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(editId).first();
      if (!row) return new Response('Not found', { status: 404 });
      const eventsRows = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY sort_order').bind(editId).all();
      const fmt = row.format || 'weekly';
      const today2 = churchDate();
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
      const nlLocked = !canEditNewsletter(row).ok;
      const nlBlocks = parseNlBlocks(row.blocks);
      // ── Schedule send ──
      // A pending schedule is worth stating outright: Brevo already holds a campaign, and
      // scheduling again REPLACES nothing — it creates a second one — so somebody needs to
      // see that one is already booked before they book another.
      const schedAt = row.scheduled_send_at ? new Date(row.scheduled_send_at) : null;
      const schedPending = schedAt && !isNaN(schedAt.getTime()) && schedAt.getTime() > Date.now();
      const scheduledNote = schedPending
        ? `<div class="alert alert-info" style="margin-bottom:10px;">Already scheduled with Brevo for <strong>${escapeHtml(schedAt.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Chicago' }))}</strong> (${escapeHtml(row.scheduled_list_type === 'test' ? 'test list' : 'members')}). Scheduling again adds a second campaign rather than moving this one &mdash; cancel the first in <a href="https://app.brevo.com" target="_blank">Brevo</a> if that is not what you want.</div>`
        : '';
      // Default the picker to the issue's own publish date at 9am, which is when this
      // newsletter actually goes out — a blank datetime field is a small chore every time.
      // Falls forward to tomorrow if that date has already passed, so the field never opens
      // on a time Brevo will reject.
      const schedBase = new Date(`${row.published_at || churchDate()}T09:00:00`);
      if (isNaN(schedBase.getTime()) || schedBase.getTime() <= Date.now()) {
        schedBase.setTime(Date.now() + 24 * 60 * 60 * 1000);
        schedBase.setHours(9, 0, 0, 0);
      }
      const pad2 = (n) => String(n).padStart(2, '0');
      const defaultScheduleAt = `${schedBase.getFullYear()}-${pad2(schedBase.getMonth() + 1)}-${pad2(schedBase.getDate())}T${pad2(schedBase.getHours())}:${pad2(schedBase.getMinutes())}`;
      const subjAdvice = subjectAdvice(row.subject || '');
      const preAdvice = preheaderAdvice(row.preheader || '');
      const lockedMsg = url.searchParams.get('msg') === 'locked'
        ? `<div class="alert alert-error">That issue has already been sent, so it cannot be changed. Duplicate it as a draft to work from a copy.</div>` : '';

      // Every block gets a switch except the pastor's note, which is locked on:
      // an issue without it is not a newsletter. Switching one off hides it from
      // the email AND from the form, so a light week is a few clicks rather than
      // deleting content you will want back next week — the words stay put.
      const blockSwitches = NL_BLOCKS.map((b) => `<label class="tlc-toggle" style="padding:7px 0;">
    <input type="checkbox" name="block_${b.key}" value="1"${nlBlocks[b.key] ? ' checked' : ''}${b.locked || nlLocked ? ' disabled' : ''}${b.locked ? '' : ' data-nlblock="1"'}>
    <span class="tlc-toggle-track"><span class="tlc-toggle-knob"></span></span>
    <span class="tlc-toggle-label">${escapeHtml(b.label)}${b.locked ? ' <span style="color:var(--tlc-muted);font-size:11.5px;">— always in</span>' : ''}</span>
  </label>${b.locked ? '' : `<input type="hidden" name="block_seen" value="${b.key}">`}`).join('');

      // Editing an issue is one screen with two halves: what you are writing on
      // the left, and what it will look like on the right, kept live. The
      // preview is built by the same function the send path uses, so the two
      // cannot drift — the whole reason it is worth the width.
      // Whether a second person could approve this. With only one holder of
      // newsletter_approve the step is a formality, and approvalState() says so
      // rather than implying a review that cannot happen.
      const approvers = await env.DB.prepare("SELECT permissions FROM users WHERE active = 1").all().catch(() => ({ results: [] }));
      const approverCount = (approvers.results || []).filter((u) => {
        try { const p = JSON.parse(u.permissions || '[]'); return p === 'all' || (Array.isArray(p) && p.includes('newsletter_approve')); }
        catch (_) { return false; }
      }).length;
      const nlState = approvalState(row, currentUser, approverCount > 1);
      const nlStatus = issueStatus(row);
      const nlSendLine = nlLocked
        ? sendSummary(row)
        : [nlState.state === 'pending' ? 'Awaiting approval' : null,
           row.published_at ? `sends ${new Date(row.published_at + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : 'no date set yet',
          ].filter(Boolean).join(' · ');

      return html(`
${sidebarShell('newsletter', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  <div class="tlc-section" style="padding-bottom:0;">
    <h1 class="tlc-title">${escapeHtml(sectionCfg('newsletter').title)}</h1>
    <p class="tlc-purpose">${escapeHtml(sectionCfg('newsletter').purpose)}</p>
    <div class="tlc-nl-crumb">
      <a class="tlc-tap-btn" href="/newsletters">← All issues</a>
      ${statusPill(nlStatus.tone, nlStatus.label)}
    </div>
    <p class="tlc-nl-when">${escapeHtml(nlSendLine)}</p>
    ${copiedNotice}
    ${lockedMsg}
    ${nlLocked
      ? `<div class="alert alert-info"><strong>${escapeHtml(sendSummary(row))}.</strong> A sent issue is read-only — the archive on the website has to keep saying what was actually sent. To work from a copy, duplicate it as a draft.
          <form method="POST" action="/newsletter/duplicate/${editId}" style="margin-top:10px;"><button type="submit" class="btn btn-sm btn-primary">Duplicate as draft</button></form></div>`
      : ''}
  </div>

  <div class="tlc-nl-cols">
  <div class="tlc-nl-form">
  <form method="POST" action="/publish" enctype="multipart/form-data" id="nl-form">
  <input type="hidden" name="newsletter_id" value="${editId}">
  <input type="hidden" name="format" id="format-input" value="${fmt}">

    <div class="card">
      <div class="card-title">Subject line</div>
      <div class="form-group">
        <input type="text" name="subject" required value="${(row.subject||'').replace(/"/g,'&quot;')}" ${nlLocked ? 'readonly' : ''}>
        <div style="font-size:12px;color:${subjAdvice.tone === 'warn' ? '#8a6a00' : 'var(--gray)'};margin-top:4px;">${escapeHtml(subjAdvice.text)}</div>
      </div>
      <div class="card-title" style="margin-top:18px;">Preview text</div>
      <div class="form-group">
        <input type="text" name="preheader" value="${escapeHtml(row.preheader || '')}" ${nlLocked ? 'readonly' : ''} placeholder="e.g. Advent begins Sunday, plus the Christmas Market dates">
        <div style="font-size:12px;color:${preAdvice.tone === 'warn' ? '#8a6a00' : 'var(--gray)'};margin-top:4px;">${escapeHtml(preAdvice.text)} — this is the gray line after the subject in an inbox.</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>
          <div class="card-title">Format</div>
          <div class="tlc-fmt">
            <button type="button" class="tlc-fmt-pill${fmt==='weekly'?' is-on':''}" id="fmt-weekly" onclick="pickFormat('weekly')"${nlLocked ? ' disabled' : ''}>Weekly</button>
            <button type="button" class="tlc-fmt-pill${fmt==='quick'?' is-on':''}" id="fmt-quick" onclick="pickFormat('quick')"${nlLocked ? ' disabled' : ''}>Special edition</button>
          </div>
        </div>
        <div>
          <div class="card-title">Publish date</div>
          <div class="form-group" style="margin:0;">
            <input type="date" name="published_at" value="${row.published_at||''}" ${nlLocked ? 'readonly' : ''}>
          </div>
        </div>
      </div>
    </div>

  <div class="card" style="background:var(--tlc-parchment);">
    <div class="card-title">What goes in this issue</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:10px;">Switch a section off and it disappears from the email — the words stay saved for next week.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 18px;">${blockSwitches}</div>
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
      <div class="card">
        <div class="card-title">More notes <span class="tag">Optional</span></div>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A fourth and fifth block, below everything else — a thank-you, a correction, a one-off appeal. Each appears only if you write something in it.</div>
        ${extraNoteFields(parseExtras(row.extra_notes))}
        <button type="button" class="add-event-btn" id="add-extra-note">+ Add another note</button>
        ${extraNotesScript}
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
        <label><input type="radio" name="email_send" value="test" checked> Test list</label>
        <label><input type="radio" name="email_send" value="all"> Members</label>
        <label><input type="radio" name="email_send" value="none"> Website only (no email)</label>
      </div>
      <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-top:6px;">These are the two lists in Brevo &mdash; the test list and the member list. This is the only place the audience is chosen.</div>
      <div style="margin-top:14px;padding:12px 14px;background:var(--mist);border-radius:8px;border:1px solid var(--ice);font-family:var(--sans);font-size:12px;color:var(--charcoal);line-height:1.7;">
        📊 <strong>Email is sent via Brevo.</strong> To see open rates, clicks, and delivery stats after sending, log in at <a href="https://app.brevo.com" target="_blank" style="color:var(--mid);font-weight:700;">app.brevo.com</a> → Campaigns.
      </div>
    </div>` : ''}

    <div class="btn-row" style="margin-top:8px;">
      ${hasPermission(currentUser, 'newsletter_approve') ? `<button type="submit" name="action" value="publish" class="btn btn-primary">Publish</button>` : ''}
      <button type="submit" name="action" value="draft" class="btn btn-secondary">Save as draft</button>
      <a href="/newsletters" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>

  </form>

    ${hasPermission(currentUser, 'newsletter_approve') ? `
    <!-- Schedule send. Sits OUTSIDE #nl-form on purpose: a form inside a form is invalid
         HTML and the browser drops the inner one, so this has to be its own form even
         though it reads as part of the button row above it.
         ⚠ It posts the issue AS ALREADY SAVED. Brevo builds the campaign from the stored
         row at this moment, so anything typed but not saved is not in the scheduled email —
         hence the reminder in the copy rather than a silent surprise next Sunday. -->
    <div class="card" style="margin-top:14px;">
      <div class="card-title">Schedule send <span class="tag">Optional</span></div>
      <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-bottom:10px;">
        Hand the issue to Brevo now and have it go out at a set date and time. Save your changes first &mdash; Brevo builds the email from the saved issue, not from what is on screen.
      </div>
      ${scheduledNote}
      <button type="button" class="btn btn-secondary" onclick="toggleSchedule(${row.id})">${row.scheduled_send_at ? 'Reschedule&hellip;' : 'Schedule send&hellip;'}</button>
      <div id="sched-row-${row.id}" style="display:none;margin-top:12px;">
        <form method="POST" action="/schedule-email/${row.id}" onsubmit="return prepSchedule(this)">
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
            <div class="form-group" style="margin:0;">
              <label>Date and time</label>
              <input type="datetime-local" name="scheduled_at_local" value="${defaultScheduleAt}" required>
            </div>
            <div class="form-group" style="margin:0;">
              <label>Send to</label>
              <select name="list_type">
                <option value="all">Members</option>
                <option value="test">Test list</option>
              </select>
            </div>
            <button type="submit" class="btn btn-primary">Schedule</button>
          </div>
          <!-- prepSchedule() fills this with a real ISO instant computed in the browser's own
               timezone: the Worker runs in UTC and cannot turn "2026-08-09T09:00" back into
               the office's local time. -->
          <input type="hidden" name="scheduled_at">
        </form>
      </div>
    </div>` : ''}
  </div>

  <aside class="tlc-nl-preview">
    <div class="tlc-nl-preview-head">
      <span class="tlc-panel-title">Live preview</span>
      <button type="button" class="tlc-tap-btn" id="nl-preview-btn">Refresh</button>
    </div>
    <div class="tlc-nl-inbox">
      <span class="tlc-nl-inbox-subj" id="nl-inbox-subj">${escapeHtml(row.subject || 'Untitled issue')}</span>
      <span class="tlc-nl-inbox-pre" id="nl-inbox-pre">${escapeHtml(row.preheader || 'No preview text yet')}</span>
    </div>
    <iframe id="nl-preview" title="Email preview" class="tlc-nl-frame"></iframe>
    <p class="tlc-note" style="margin:10px 0 0;"><span class="tlc-note-mark">◆</span><span>Built by the same code that sends the email, so what you see here and what lands in an inbox cannot drift apart. A section switched off is missing from this preview too.</span></p>
  </aside>
  </div>
</div>
<script>(function(){
  // The inbox strip above the frame mirrors the two fields as you type — those
  // are the only part of an email most people ever read, and waiting for a
  // round trip to see them would be the wrong trade.
  var form = document.getElementById('nl-form');
  var subj = form && form.querySelector('input[name=subject]');
  var pre = form && form.querySelector('input[name=preheader]');
  if (subj) subj.addEventListener('input', function(){
    document.getElementById('nl-inbox-subj').textContent = subj.value || 'Untitled issue';
  });
  if (pre) pre.addEventListener('input', function(){
    document.getElementById('nl-inbox-pre').textContent = pre.value || 'No preview text yet';
  });

  var btn = document.getElementById('nl-preview-btn');
  var frame = document.getElementById('nl-preview');
  if (!btn || !frame || !form) return;
  function refresh(){
    // TinyMCE keeps its content in an iframe until asked, so a preview taken
    // straight from the textareas would show the last saved text rather than
    // what is on screen.
    if (window.tinymce && tinymce.triggerSave) { try { tinymce.triggerSave(); } catch(e){} }
    btn.textContent = 'Updating…'; btn.disabled = true;
    fetch('/newsletter/preview', { method: 'POST', body: new FormData(form) })
      .then(function(r){ return r.text(); })
      .then(function(html){ frame.srcdoc = html; })
      .catch(function(){ frame.srcdoc = '<p style="font-family:sans-serif;padding:20px;color:#8A4A4A;">Could not build the preview just now.</p>'; })
      .finally(function(){ btn.textContent = 'Refresh'; btn.disabled = false; });
  }
  btn.addEventListener('click', refresh);
  // Typing anywhere in the form redraws the body, but only once you pause —
  // a request per keystroke would make the preview slower, not more live.
  var t = null;
  form.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(refresh, 900); });
  form.addEventListener('change', function(){ clearTimeout(t); t = setTimeout(refresh, 300); });
  refresh();
})();</script>
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
  document.getElementById('fmt-weekly').classList.toggle('is-on', fmt === 'weekly');
  document.getElementById('fmt-quick').classList.toggle('is-on', fmt === 'quick');
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
          headers: { Location: `/newsletters?msg=emailed&emailerr=${encodeURIComponent('BREVO_LIST_ID secret is not configured. Set it in Cloudflare Workers → Settings → Variables & Secrets.')}` }
        });
      }

      const payload = await buildNewsletterEmailPayload(env, id);
      if (!payload) return new Response('Not found', { status: 404 });
      const { row, emailHtml } = payload;
      const result = await sendBrevoNewsletter(env, { subject: row.subject, htmlContent: emailHtml, listIds: [listId] });

      // Sending to all = publish the newsletter so it appears on the website,
      // and record what actually went out. sent_at is what locks the issue from
      // then on, and sent_count is what the list shows instead of guessing —
      // "Sent 24 July to 609 subscribers" is a fact, not an estimate. The count
      // comes from the real Brevo list, not the local signup table — that table
      // only holds website-form signups and badly undercounts an audience also
      // built from Breeze imports/manual adds.
      if (listType === 'all' && result.success) {
        const recipients = await getBrevoListCount(env, listId);
        await env.DB.prepare(
          "UPDATE newsletters SET status = 'published', approval_status = 'approved', approved_by_username = ?, published_at = COALESCE(published_at, ?), sent_at = COALESCE(sent_at, ?), sent_count = COALESCE(sent_count, ?) WHERE id = ?"
        ).bind(currentUser.username, churchDate(), new Date().toISOString(), recipients, id).run();
      }

      const suffix = result.success
        ? `&emailed=${listType}`
        : `&emailerr=${encodeURIComponent(result.error)}`;
      return new Response('', {
        status: 302,
        headers: { Location: `/newsletters?msg=emailed&subject=${encodeURIComponent(row.subject)}${suffix}` }
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
          headers: { Location: `/newsletters?msg=emailed&emailerr=${encodeURIComponent('BREVO_LIST_ID secret is not configured. Set it in Cloudflare Workers → Settings → Variables & Secrets.')}` }
        });
      }
      const scheduledDate = scheduledAtSubmitted ? new Date(scheduledAtSubmitted) : null;
      if (!scheduledDate || isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        return new Response('', {
          status: 302,
          headers: { Location: `/newsletters?msg=emailed&emailerr=${encodeURIComponent('Pick a valid date/time in the future to schedule this send.')}` }
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
          ).bind(currentUser.username, churchDate(), id).run();
        }
      }

      const suffix = result.success
        ? `&scheduled=1`
        : `&emailerr=${encodeURIComponent(result.error)}`;
      return new Response('', {
        status: 302,
        headers: { Location: `/newsletters?msg=emailed&subject=${encodeURIComponent(row.subject)}${suffix}` }
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
            headers: { Location: `/newsletters?msg=emailed&emailerr=${encodeURIComponent(result.error)}` }
          });
        }
      }
      await env.DB.prepare(
        'UPDATE newsletters SET scheduled_send_at = NULL, scheduled_list_type = NULL, brevo_campaign_id = NULL WHERE id = ?'
      ).bind(id).run();
      return new Response('', { status: 302, headers: { Location: `/newsletters?msg=emailed&scheduled=cancelled` } });
    }

    // ── LIVE EMAIL PREVIEW ──
    // Rendered by buildEmailHtml — the exact function the send path uses — from
    // the values currently in the form. That is the whole point: a preview
    // written separately would drift from the email, and nobody would find out
    // until an issue had already gone to ~600 people.
    if (path === '/newsletter/preview' && method === 'POST') {
      if (!hasPermission(currentUser, 'newsletter_edit') && !hasPermission(currentUser, 'newsletter_approve')) {
        return new Response('Access denied.', { status: 403 });
      }
      const f = await request.formData();
      const fmt = f.get('format') || 'weekly';
      const on = (key) => f.get('block_' + key) === '1';

      // Events come from the form as they are being edited, so the preview
      // shows unsaved changes rather than what is in the database.
      const evIds = f.getAll('event_ids');
      const events = on('events') ? evIds.map((eid) => ({
        event_date: f.get(`event_date_${eid}`) || '',
        event_name: f.get(`event_name_${eid}`) || '',
        event_time: f.get(`event_time_${eid}`) || '',
        event_desc: f.get(`event_desc_${eid}`) || '',
      })).filter((e) => e.event_name || e.event_date) : [];

      let newsItems = [];
      const newsIds = on('news') ? f.getAll('news_item_ids').filter(Boolean) : [];
      if (newsIds.length) {
        try {
          const ph = newsIds.map(() => '?').join(',');
          const nr = await env.DB.prepare(`SELECT id, title, summary, body, image_url FROM news_items WHERE id IN (${ph})`).bind(...newsIds).all();
          const map = Object.fromEntries((nr.results || []).map((r) => [String(r.id), r]));
          newsItems = newsIds.map((n) => map[n]).filter(Boolean);
        } catch (_) { newsItems = []; }
      }

      let classes = [];
      if (on('classes')) { try { classes = JSON.parse(f.get('bible_classes_json') || '[]'); } catch (_) { classes = []; } }

      const emailHtml = buildEmailHtml(
        f.get('subject') || '(no subject yet)',
        f.get('pastor_note') || f.get('quick_body') || '',
        events,
        on('wol') ? (f.get('wol_content') || '') : '',
        on('lasm') ? (f.get('lasm_content') || '') : '',
        f.get('published_at') || churchDate(),
        newsItems,
        on('secondary') ? (f.get('secondary_note') || '') : '',
        f.get('newsletter_id') || null,
        fmt,
        on('cta') ? (f.get('cta_url') || '') : '',
        on('cta') ? (f.get('cta_label') || '') : '',
        on('tertiary') ? (f.get('tertiary_note') || '') : '',
        on('tertiary') ? (f.get('tertiary_cta_label') || '') : '',
        on('tertiary') ? (f.get('tertiary_cta_url') || '') : '',
        classes,
        extrasFromForm(f)
      );
      return new Response(emailHtml, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
      });
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
      // Back to the newsletter list, which is where the issue lived — News &
      // Events is a different section now.
      return new Response('', { status: 302, headers: { Location: '/newsletters?msg=deleted' } });
    }

    // ── DUPLICATE ──
    if (path.startsWith('/newsletter/duplicate/') && method === 'POST') {
      const id = path.split('/').pop();
      const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(id).first();
      if (!row) return new Response('Not found', { status: 404 });
      const eventsRows = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY sort_order').bind(id).all();
      const copyPublishedAt = row.published_at || churchDate();
      const result = await env.DB.prepare(
        'INSERT INTO newsletters (subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, status, wol_content, lasm_content, secondary_note, news_item_ids, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes, extra_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        `Copy of ${row.subject}`, row.pastor_note, row.ministry_content, row.ministry_type, copyPublishedAt, row.format,
        row.cta_url, row.cta_label, 'draft', row.wol_content, row.lasm_content, row.secondary_note,
        row.news_item_ids, row.tertiary_note, row.tertiary_cta_label, row.tertiary_cta_url, row.bible_classes,
        // A copy carries the extra notes too — the whole point of duplicating a
        // sent issue is to start from what actually went out.
        row.extra_notes || '[]'
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
      // Backgrounded, not awaited: an R2 delete plus a D1 DELETE per expired
      // row was blocking every single visit to this screen on work that is a
      // no-op almost every time. An item's own `state` already reads
      // 'expired' straight off its `expire_date` regardless of whether this
      // sweep has run yet, so deferring it costs nothing but one extra
      // "Expired" pill showing for the one visit before the row is actually
      // removed — the same screen already shows that state on purpose.
      ctx.waitUntil(sweepExpiredItems(env, new URL(request.url).origin));
      const itemsRes = await env.DB.prepare(
        'SELECT * FROM news_items ORDER BY pinned DESC, COALESCE(event_date, publish_date) DESC, id DESC'
      ).all();
      const today = churchDate();
      const soon = churchDatePlus(3);
      const msgParam = url.searchParams.get('msg');
      const alertHtml = msgParam === 'saved' ? `<div class="alert alert-success">✓ News post saved.</div>`
        : msgParam === 'deleted' ? `<div class="alert alert-info">Post deleted.</div>` : '';

      const listRows = itemsRes.results.map((item) => {
        let state = 'live';
        if (item.publish_date && item.publish_date > today) state = 'scheduled';
        else if (item.expire_date && item.expire_date < today) state = 'expired';
        const expiringSoon = state === 'live' && item.expire_date && item.expire_date <= soon;

        const status = state === 'scheduled' ? statusPill('auto', 'Scheduled')
          : state === 'expired' ? statusPill('plain', 'Expired')
          : expiringSoon ? statusPill('warn', 'Expiring')
          : statusPill('good', 'Live');

        // The expire date is the field that matters on this screen: a post
        // carrying one disappears on its own, which is the whole reason the
        // site does not go stale. A post without one never leaves, so it is
        // called out rather than left blank.
        const expires = item.expire_date
          ? escapeHtml(item.expire_date)
          : `<span style="color:#7A5B18;">Never</span>`;

        return {
          href: `/newsitems/edit/${item.id}`,
          filter: [state, item.value || ''].filter(Boolean),
          search: `${item.title} ${item.summary || ''} ${valueByKey(item.value)?.short || ''}`.toLowerCase(),
          cells: [
            // The pin marker sits BEFORE the title, where the eye starts —
            // the rows are already sorted pinned-first, so the marker's job is
            // to explain why this row is up here, not to be found. No emoji in
            // the admin chrome; the fallback is a typographic glyph like every
            // other icon in the pattern.
            `<div class="tlc-primary">
              <span class="tlc-primary-icon tlc-primary-icon--file">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : '▤'}</span>
              <span class="tlc-primary-text">
                <span class="tlc-primary-title">${item.pinned ? '<span class="tlc-pin" title="Pinned to the top" aria-label="Pinned">▲</span>' : ''}${escapeHtml(item.title)}${item.value ? ` ${valueChip(item.value)}` : ''}</span>
                <span class="tlc-primary-sub">${escapeHtml((item.summary || '').slice(0, 80))}</span>
              </span></div>`,
            escapeHtml(item.publish_date || '—'),
            expires,
            status,
          ],
          warn: !item.expire_date
            ? 'No expiry date, so this post stays on the site until somebody removes it by hand.'
            : '',
          warnCta: !item.expire_date ? { label: 'Set one', href: `/newsitems/edit/${item.id}` } : null,
        };
      });

      return html(`
${sidebarShell('news', currentUser, `<a href="https://timothystl.org/news" target="_blank">View site</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'news',
    title: sectionCfg('news').title,
    purpose: sectionCfg('news').purpose,
    action: { label: sectionCfg('news').action, href: '/newsitems/new' },
    search: sectionCfg('news').search,
    filters: filtersOf('news'),
    valueChips: sectionCfg('news').valueChips,
    columns: columnsOf('news'),
    rows: listRows,
    noun: 'post',
    empty: 'No news posts yet.',
    note: sectionCfg('news').note,
  })}
</div>`, 'TLC Admin — News & Events');
    }

    // ── NEWS ITEMS: NEW FORM ──
    // ── NEWS ITEMS: THE FORM, ONCE ──
    // New and Edit were two near-identical copies of the same 90 lines, on the
    // old chrome. One builder now, through the shared form renderer, so a post
    // opened from the redesigned list stays in the redesign.
    // The live category list, for the picker below. Read once per render
    // rather than per field, and falling back to the shipped list so the form
    // still offers something sensible if the table cannot be read.
    const newsCalCats = activeCategories(mergedCategories(
      ((await env.DB.prepare('SELECT key, name, color_id, palette, sort_order, active FROM calendar_categories')
        .all().catch(() => ({ results: [] }))).results) || []
    ));
    const newsFormHtml = (item = null) => {
      const isNew = !item;
      const today = churchDate();
      const in90 = churchDatePlus(90);
      const ch = item ? (item.channels == null ? 'web' : item.channels) : 'web,email';
      const on = (k) => (item ? ch.includes(k) : (k === 'web' || k === 'email'));
      const box = (name, label, checked) =>
        `<label class="tlc-choice"><input type="checkbox" name="${name}" value="1"${checked ? ' checked' : ''}><span>${label}</span></label>`;
      return renderFormSection({
        title: isNew ? 'New post' : item.title || 'Edit post',
        purpose: isNew
          ? 'Announcements and dated events. A post with an expire date drops off the site on its own.'
          : 'Changes reach the website as soon as you save.',
        action: isNew ? '/newsitems/create' : `/newsitems/update/${item.id}`,
        cancelHref: '/newsitems',
        saveLabel: isNew ? 'Save and publish' : 'Save changes',
        deleteAction: isNew ? '' : `/newsitems/delete/${item.id}`,
        deleteConfirm: `Delete “${(item && item.title) || 'this post'}”? It disappears from the website.`,
        wide: true,
        note: 'Expiry is what keeps the site honest — a post with an expire date disappears without anyone remembering to delete it.',
        fields: [
          { name: 'title', label: 'Title', value: item ? item.title : '', required: true, placeholder: 'Easter services — April 20' },
          { kind: 'textarea', name: 'summary', label: 'Summary', rows: 3, value: item ? (item.summary || '') : '',
            placeholder: 'Two or three sentences.', hint: 'What shows on the card, before anybody clicks through.' },
          // ⚠ The value column has existed since v3.0.0 and the list filters on
          // it, but no form ever set one — so every post was untagged and the
          // filter could never match. Same shape of bug as the tap counter.
          { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">Value</label>${valueChips('value', item ? item.value : null)}<p class="tlc-hint">Which of the four this post serves. Used by the filters and the values report.</p></div>` },
          // ⚠ Only offered on a post that HAS an event date, because only
          // those reach the calendar at all. Offering it on an announcement
          // would be a control that looks live and does nothing.
          { kind: 'choice', name: 'calendar_category', label: 'On the calendar, this is',
            value: item ? (item.calendar_category || '') : '',
            options: [{ value: '', label: '— work it out from the value above —' }]
              .concat(newsCalCats.map((c) => ({ value: c.key, label: c.name }))),
            hint: 'Only used when the post has an event date. Sets which category it files under on the church calendar — the same list a Google event\u2019s color chooses from. Change the list under Pages \u2192 Calendar.' },
          { kind: 'html', html: tinymceEditorSection(item ? (item.body || '') : '') },
          { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">Header image</label>
            <input type="hidden" name="image_url" id="image_url_val" value="">
            <input type="file" id="image_url_file" accept="image/*">
            <div id="image-url-status" class="tlc-hint"></div>
            <div id="image-url-preview" style="display:none;margin-top:8px;max-width:240px;"></div>
            <p class="tlc-hint">Optional. Shown as the card thumbnail.</p></div>` },
          { kind: 'choice', name: 'theme', label: 'Theme', value: item ? (item.theme || '') : '',
            options: [{ value: '', label: '— none —' }].concat(THEMES.map((t) => ({ value: t, label: t }))) },
          { kind: 'choice', name: 'content_type', label: 'Content type', value: item ? (item.content_type || '') : '',
            options: [{ value: '', label: '— none —' }].concat(CONTENT_TYPES.map((t) => ({ value: t, label: t }))) },
          { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">Where it appears</label>
            <div class="tlc-choices">${box('ch_web', 'Website', on('web'))}${box('ch_email', 'Email newsletter', on('email'))}${box('ch_bulletin', 'Bulletin', on('bulletin'))}${box('ch_social', 'Social media', on('social'))}</div>
            <p class="tlc-hint">The weekly email pulls from the posts ticked for it, rather than asking you to retype them.</p></div>` },
          { kind: 'date', name: 'publish_date', label: 'Publish date', value: item ? (item.publish_date || '') : today },
          { kind: 'date', name: 'event_date', label: 'Event date', value: item ? (item.event_date || '') : '',
            hint: 'Optional. A post with one sorts by the event rather than by when it was written.' },
          { kind: 'date', name: 'expire_date', label: 'Expire date', value: item ? (item.expire_date || '') : in90,
            hint: 'The post hides itself after this date. Clear it only for something genuinely permanent.' },
          { kind: 'toggle', name: 'pinned', label: 'Pin to the top', value: item ? !!item.pinned : false,
            on: 'Pinned', off: 'In date order',
            hint: 'A pinned post sits above the rest until you unpin it.' },
        ],
      });
    };

    if (path === '/newsitems/new' && method === 'GET') {
      return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">All posts</a>`, await pageBadges())}
<div class="tlc-wrap">${newsFormHtml()}</div>
${newsImageUploadScript()}`, 'New post — TLC Admin', TINYMCE_HEAD);
    }

    // ── NEWS ITEMS: CREATE (POST) ──
    if (path === '/newsitems/create' && method === 'POST') {
      const form = await request.formData();
      const title = form.get('title') || '';
      const summary = form.get('summary') || '';
      const body = sanitizeClassicRich(form.get('body') || '');   // FX-04
      // blob: URLs are only valid in the browser tab that created them — dead
      // for every other visitor. Drop rather than store one if it slips through.
      const image_url = (form.get('image_url') || '').trim().startsWith('blob:') ? '' : (form.get('image_url') || '');
      const publish_date = form.get('publish_date') || churchDate();
      const event_date = form.get('event_date') || '';
      const expire_date = form.get('expire_date') || '';
      // A toggle posts a hidden 0 ahead of its checkbox, so get() always sees
      // the 0. getAll() is the only reading that is true when it is really on.
      const pinned = form.getAll('pinned').includes('1') ? 1 : 0;
      const theme = form.get('theme') || '';
      const content_type = form.get('content_type') || '';
      const channels = [
        form.get('ch_web') === '1' && 'web',
        form.get('ch_email') === '1' && 'email',
        form.get('ch_bulletin') === '1' && 'bulletin',
        form.get('ch_social') === '1' && 'social',
      ].filter(Boolean).join(',') || 'web';
      const newItemResult = await env.DB.prepare(
        'INSERT INTO news_items (title, summary, body, image_url, publish_date, event_date, expire_date, pinned, theme, content_type, channels, value, calendar_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(title, summary, body, image_url, publish_date, event_date || null, expire_date || null, pinned, theme || null, content_type || null, channels, normalizeValue(form.get('value')) || null, String(form.get('calendar_category') || '').trim() || null).run();
      await logAudit(env.DB, currentUser, 'create', 'news_item', newItemResult.meta.last_row_id, title, null, { title, summary, publish_date, expire_date, pinned });
      return new Response('', { status: 302, headers: { Location: '/newsitems?msg=saved' } });
    }

    // ── NEWS ITEMS: EDIT FORM ──
    // ── NEWS ITEMS: EDIT FORM ──
    if (path.startsWith('/newsitems/edit/') && method === 'GET') {
      const id = path.split('/').pop();
      const item = await env.DB.prepare('SELECT * FROM news_items WHERE id = ?').bind(id).first();
      if (!item) return new Response('Not found', { status: 404 });
      return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">All posts</a>`, await pageBadges())}
<div class="tlc-wrap">${newsFormHtml(item)}</div>
${newsImageUploadScript(item.image_url || '')}`, 'Edit post — TLC Admin', TINYMCE_HEAD);
    }

    // ── NEWS ITEMS: UPDATE (POST) ──
    if (path.startsWith('/newsitems/update/') && method === 'POST') {
      const id = path.split('/').pop();
      const form = await request.formData();
      const title = form.get('title') || '';
      const summary = form.get('summary') || '';
      const body = sanitizeClassicRich(form.get('body') || '');   // FX-04
      // blob: URLs are only valid in the browser tab that created them — dead
      // for every other visitor. Drop rather than store one if it slips through.
      const image_url = (form.get('image_url') || '').trim().startsWith('blob:') ? '' : (form.get('image_url') || '');
      const publish_date = form.get('publish_date') || '';
      const event_date = form.get('event_date') || '';
      const expire_date = form.get('expire_date') || '';
      // A toggle posts a hidden 0 ahead of its checkbox, so get() always sees
      // the 0. getAll() is the only reading that is true when it is really on.
      const pinned = form.getAll('pinned').includes('1') ? 1 : 0;
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
        'UPDATE news_items SET title=?, summary=?, body=?, image_url=?, publish_date=?, event_date=?, expire_date=?, pinned=?, theme=?, content_type=?, channels=?, value=?, calendar_category=? WHERE id=?'
      ).bind(title, summary, body, image_url, publish_date, event_date || null, expire_date || null, pinned, theme || null, content_type || null, channels, normalizeValue(form.get('value')) || null, String(form.get('calendar_category') || '').trim() || null, id).run();
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
      // Two roles. Office staff hold `pages_edit` and can do everything. A
      // ministry leader holds `pages_edit_own` and can edit the pages assigned
      // to them — the words and the blocks — but cannot rename the site's
      // structure, move things around the menu, create pages, delete them, or
      // touch the church details. Enforced here, not in the UI: hiding a
      // control is a courtesy, this is the control.
      const fullAccess = hasPermission(currentUser, 'pages_edit');
      const ownOnly = !fullAccess && hasPermission(currentUser, 'pages_edit_own');
      if (!fullAccess && !ownOnly) return new Response('Access denied.', { status: 403 });
      const owns = (row) => fullAccess || (row && row.owner_username && row.owner_username === currentUser?.username);
      const denied = () => new Response('Access denied.', { status: 403 });
      if (ownOnly && (path === '/pages/new' || path === '/pages/details')) return denied();

      // ── All pages ──
      // `/pages/:id/details` renders the same list with that page's drawer open,
      // so the drawer is a real address: it survives a refresh and can be linked
      // to from a warning row. `/pages/details` (church details, two segments)
      // is a different screen and does not match this shape.
      const detailsMatch = path.match(/^\/pages\/([^/]+)\/details$/);
      const newPage = path === '/pages/new' && method === 'GET';
      if ((path === '/pages' || detailsMatch || newPage) && method === 'GET') {
        // Anything whose scheduled time has passed goes live before the list is
        // drawn, so staff never see a page still labeled "scheduled" after the
        // moment it was meant to publish.
        await promoteScheduledPages(env);
        const filter = url.searchParams.get('filter') || 'all';
        const msg = url.searchParams.get('msg');
        const alertHtml = msg === 'linksaved' ? `<div class="alert alert-success">✓ Short link saved.</div>`
          : msg === 'linkcleared' ? `<div class="alert alert-info">Short link reset — it now follows the page address again.</div>` : '';
        // ⚠ A FAILED READ MUST NOT RENDER AS AN EMPTY LIST. This used to be
        // `.catch(() => ({ results: [] }))`, which turned any database error —
        // a column the live table has not got, a table that did not migrate —
        // into "No pages to show. Use the button above to add the first one."
        // That is the worst possible answer: it is indistinguishable from a
        // genuinely empty site, so it reads as *the pages are gone* and sends
        // somebody hunting for missing content instead of a missing column.
        // Same rule as the dead-link one — a wrong answer that looks like a
        // working answer is worse than no answer.
        let readError = '';
        const rows = await env.DB.prepare(
          'SELECT id, title, menu_label, slug, parent_id, sort, template, status, in_menu, owner_username, short_link, external_url, blocks, published_blocks, publish_at, updated_at, updated_by FROM pages ORDER BY sort ASC, title ASC'
        ).all().catch((e) => { readError = (e && e.message) || String(e); return { results: [] }; });
        if (readError) console.error('Pages list read failed:', readError);
        const everyPage = rows.results || [];
        const all = everyPage.filter(owns);

        const ordered = orderPages(all);
        // Clashes are computed over EVERY page, not just the filtered view — a
        // ministry leader filtering to their own drafts must still be told that
        // their short link collides with a page they cannot see.
        const linked = withShortLinks(orderPages(everyPage));
        const linkById = Object.fromEntries(linked.map((p) => [p.id, p]));
        const shown = filterPages(ordered, filter);

        // ── Why is this list empty? ──
        // There are three reasons an empty Pages screen can happen and they
        // want three different actions, so the screen names which one it is
        // rather than showing the same blank table for all of them.
        //
        // The third is the one that caused a real support round-trip: an
        // account holding `pages_edit_own` but not `pages_edit` sees every
        // page filtered away by `owns`, while the sidebar badge — which is
        // scoped to either permission — still counts them. So the sidebar
        // says "24 waiting" beside a list that says there is nothing here,
        // and there is nothing on screen to explain the contradiction.
        const hiddenByOwnership = ownOnly && everyPage.length > 0 && all.length === 0;
        const problemHtml = readError
          ? `<div class="alert alert-error"><strong>The page list could not be read.</strong> The database refused the query, so this table is empty because of a fault and not because the site has no pages. Nothing has been lost and nothing has been changed — the pages are still there and the public site is unaffected. Tell whoever maintains the site, and give them this: <code>${escapeHtml(readError)}</code></div>`
          : hiddenByOwnership
            ? `<div class="alert alert-warn"><strong>${everyPage.length} ${everyPage.length === 1 ? 'page exists' : 'pages exist'}, but none are assigned to you.</strong> Your account can edit only the pages it owns (the <code>pages_edit_own</code> permission) rather than every page (<code>pages_edit</code>). If you used to see them all here, that permission has been turned off — an admin can turn it back on under People &amp; Access → Users.</div>`
            : '';

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

        const listRows = shown.map((p) => {
          const s = pageStatus(p);
          const link = linkById[p.id] || { shortLink: null, shortLinkClash: null };
          const clash = link.shortLinkClash;
          const out = outboundUrl(p);

          // A clash replaces the status pill rather than sitting beside it.
          // Two pills on one row makes a volunteer choose which to believe.
          const statusCell = clash ? statusPill('bad', 'Link clash') : statusPill(s.tone, s.label);

          const sub = out
            // An outbound page has no blocks and no edit history worth showing —
            // where it sends people is the only thing about it worth reading.
            ? [p.parent_id ? 'Under ' + parentName(p.parent_id) : 'Top level', 'Links out to ' + out.replace(/^https?:\/\//, '')].join(' · ')
            : [
              p.parent_id ? 'Under ' + parentName(p.parent_id) : 'Top level',
              pluralise(p.blockCount, 'block'),
              p.neverPublished ? 'never published' : edited(p),
              p.owner_username ? 'assigned to ' + p.owner_username : '',
            ].filter(Boolean).join(' · ');

          return {
            // The row opens the editor; the drawer is reached by the row's own
            // "Details" action. Content lives in the editor, always — which is
            // also why an outbound page, having none, opens its details instead.
            href: out ? `/pages/${encodeURIComponent(p.id)}/details` : `/pages/${encodeURIComponent(p.id)}/edit`,
            filter: [
              out ? 'live' : (p.hasDraftEdits || p.status === 'draft' ? 'draft-edits' : 'live'),
              p.in_menu ? '' : 'not-in-menu',
            ].filter(Boolean),
            search: `${p.title} ${p.menu_label || ''} ${p.slug} ${link.shortLink || ''} ${out}`.toLowerCase(),
            cells: [
              // ⚠ The one ↗ left in the admin, and deliberately. Task 12c
              // strips the glyph from "View site", "View live" and "every
              // other outbound LINK" — there the text already says where it
              // goes, so the arrow is noise. This is not a link: it is the
              // row's leading marker, the sibling of ⌂ for the homepage, and
              // it says what KIND of page this is. Strip it and an outbound
              // page is the only row in the list with no marker at all.
              // If the side-by-side pass disagrees, ⌂ has to go with it.
              primaryCell(p.menu_label || p.title, sub, { icon: p.slug === '/' ? '⌂' : (out ? '' : '') }),
              escapeHtml(p.slug),
              link.shortLink
                // A clashing short link is shown in the problem ink, because it
                // is the thing on the row that is not working.
                ? `<a href="/pages/${encodeURIComponent(p.id)}/details" style="color:${clash ? '#8A3A28' : 'var(--tlc-blue)'};text-decoration:none;">${escapeHtml(link.shortLink)}</a>`
                : '<span style="color:var(--tlc-muted);">—</span>',
              statusCell,
            ],
            actions: `<a class="tlc-edit" href="/pages/${encodeURIComponent(p.id)}/details">Details</a>${out ? '' : `<a class="tlc-edit" href="/pages/${encodeURIComponent(p.id)}/edit">Open editor</a>`}`,
            warn: clash
              ? (clash.reason === 'address'
                  ? `${clash.link} is the real address of the ${clash.withTitle} page — this short link would shadow it, so it is switched off.`
                  : `${clash.link} is already taken by the ${clash.withTitle} page — give one of them a different short link.`)
              : '',
            warnCta: clash ? { label: 'Fix short link', href: `/pages/${encodeURIComponent(p.id)}/details` } : null,
          };
        });

        // ── The Details drawer ──
        // Name, address and short link — never content. Content lives in the
        // page editor, always; putting a body field here would give the office
        // two places to write the same page and no way to tell which one won.
        const detailsId = detailsMatch ? decodeURIComponent(detailsMatch[1]) : '';
        const detailsPage = detailsId ? ordered.find((p) => p.id === detailsId) : null;
        const detailsLink = detailsPage ? (linkById[detailsPage.id] || {}) : null;
        const detailsDerived = detailsPage ? shortLinkFor(Object.assign({}, detailsPage, { short_link: null })) : null;
        const detailsClash = detailsLink ? detailsLink.shortLinkClash : null;

        return html(`
${sidebarShell('pages', currentUser, `<a href="/pages/details">Church details</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml || problemHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}${problemHtml}</div>` : ''}
  ${renderListSection({
    key: 'pages',
    title: sectionCfg('pages').title,
    purpose: sectionCfg('pages').purpose,
    action: { label: sectionCfg('pages').action, href: '/pages/new' },
    search: sectionCfg('pages').search,
    filters: filtersOf('pages'),
    columns: columnsOf('pages'),
    rows: listRows,
    noun: 'page',
    empty: readError ? 'The page list could not be read.'
      : hiddenByOwnership ? 'No pages are assigned to you.'
      : 'No pages to show.',
    // Never "use the button above" when the button is not the answer: a failed
    // read is not fixed by adding a page, and an owner-scoped account is
    // refused by /pages/new anyway.
    emptyHelp: readError ? 'See the message above — this is a fault, not an empty site.'
      : hiddenByOwnership ? 'See the message above.'
      : ownOnly ? 'Pages are assigned to you by the office.'
      : 'Use the button above to add the first one.',
    note: sectionCfg('pages').note,
  })}
  ${newPage ? renderDrawer({
    key: 'page-new',
    title: 'New page',
    sub: 'Pick what it starts as. Every starter is a working page you edit down, and every new page begins as a draft — nothing reaches the site until you press Publish.',
    action: '/pages/new',
    cancelHref: '/pages',
    saveLabel: 'Create and open the editor',
    fields: [
      { name: 'title', label: 'Page name', value: '', required: true, placeholder: 'Plan a Visit',
        hint: 'The address is generated from this, and can be changed afterwards.' },
      // Four options is four chips. A select would hide three of them behind a
      // click, on the one decision this screen exists to ask.
      { kind: 'chips', name: 'starter', label: 'Starts as', value: STARTERS[0].key,
        options: STARTERS.map((s) => ({ value: s.key, label: s.label })),
        hint: STARTERS.map((s) => `${s.label} — ${s.note}`).join(' · ') },
    ],
  }) : ''}
  ${detailsPage ? renderDrawer({
    key: 'page-details',
    title: detailsPage.menu_label || detailsPage.title,
    sub: 'Where this page lives and what it is called. Its words and pictures are in the page editor.',
    action: `/pages/${encodeURIComponent(detailsPage.id)}/details`,
    cancelHref: '/pages',
    saveLabel: 'Save changes',
    // A ministry leader may edit their pages' content but not the site's
    // structure — so they get the same drawer with nothing to submit, rather
    // than a hidden button they could post around.
    readOnly: ownOnly,
    fields: [
      ...(detailsClash ? [{ kind: 'html', html: `<div class="alert alert-error" style="margin:0 0 14px;"><strong>${escapeHtml(detailsClash.link)} is already taken.</strong> ${detailsClash.reason === 'address'
        ? `It is the real address of the ${escapeHtml(detailsClash.withTitle)} page, so this short link is switched off — the real page keeps the address.`
        : `The ${escapeHtml(detailsClash.withTitle)} page wants it too, so neither short link works until one of them is changed. Nothing is guessed.`}</div>` }] : []),
      { name: 'title', label: 'Page name', value: detailsPage.title || '', required: true },
      { name: 'slug', label: 'Address', value: detailsPage.slug || '', required: true,
        hint: 'Renaming writes a 301 from the old address automatically, so anything already linking here keeps working.' },
      { name: 'short_link', label: 'Short link', value: detailsPage.short_link || '',
        placeholder: (detailsDerived || '').replace(/^\/+/, ''),
        hint: `Generated from the last part of the address${detailsDerived ? ` — which gives ${detailsDerived}` : ''}. Both work. Clear it to switch off.` },
      { name: 'external_url', type: 'url', label: 'Links out to', value: outboundUrl(detailsPage), placeholder: 'https://…',
        hint: 'Leave blank for a normal page. With an address here the page has no content of its own — visitors are sent straight to that site.' },
      { kind: 'static', label: 'Content',
        html: outboundUrl(detailsPage)
          ? '<span style="color:var(--tlc-muted);">This page sends visitors to another site, so there is nothing to edit here.</span>'
          : `<a href="/pages/${encodeURIComponent(detailsPage.id)}/edit" style="color:var(--tlc-blue);font-weight:600;text-decoration:none;">Open in page editor</a>` },
    ],
  }) : ''}
</div>`, 'Pages — TLC Admin');
      }

      // ── Short link ──
      // Was its own small screen; it is a field in the Details drawer now, so
      // there is one place a page's name, address and short link are edited
      // rather than two that can disagree. The old address is kept because the
      // Redirects screen links to it by name.
      if (path.startsWith('/pages/') && path.endsWith('/link') && method === 'GET') {
        const id = path.slice('/pages/'.length, -('/link'.length));
        return new Response('', { status: 302, headers: { Location: `/pages/${id}/details` } });
      }

      // ── Details (POST) ──
      // Name, address, short link and where the page links out to. Content is
      // not here and never will be — see the drawer above.
      if (detailsMatch && method === 'POST') {
        const id = decodeURIComponent(detailsMatch[1]);
        // A ministry leader edits their pages' words, not the site's shape.
        if (ownOnly) return denied();
        const all = await env.DB.prepare(
          'SELECT id, title, menu_label, slug, parent_id, status, short_link, external_url FROM pages'
        ).all().catch(() => ({ results: [] }));
        const page = (all.results || []).find((p) => p.id === id);
        if (!page) return new Response('Not found', { status: 404 });
        if (!owns(page)) return denied();
        const form = await request.formData();

        const title = String(form.get('title') || '').trim().slice(0, 200) || page.title;
        // Normalized the same way shortLinkFor() reads it, so what is stored and
        // what is displayed cannot disagree. Anything that is not a plain
        // address segment is dropped rather than stored and quietly ignored.
        const short = String(form.get('short_link') || '').trim().replace(/^\/+|\/+$/g, '')
          .toLowerCase().replace(/[^a-z0-9\-\/]+/g, '-').replace(/^-+|-+$/g, '');
        // Only http(s) is stored. Anything else — a `javascript:` address most
        // of all — would become a link the office clicks from inside their own
        // session, so it is dropped rather than half-honored.
        const extRaw = String(form.get('external_url') || '').trim().slice(0, 500);
        const ext = /^https?:\/\/\S+$/i.test(extRaw) ? extRaw : '';

        // The address. Changing it writes a 301 from the old one, which is what
        // makes renaming safe: an address already in a bulletin keeps working.
        const wantSlug = String(form.get('slug') || '').trim();
        let slug = page.slug;
        if (wantSlug && wantSlug !== page.slug) {
          const renamed = pageRename(page, title, all.results || [], wantSlug);
          slug = renamed.slug;
          const now = new Date().toISOString();
          for (const r of renamed.redirects) {
            await env.DB.prepare(
              'INSERT OR REPLACE INTO page_redirects (from_slug, to_slug, created_at) VALUES (?, ?, ?)'
            ).bind(r.from, r.to, now).run().catch(() => {});
            // A child moves with its parent, so its own address changes too.
            if (r.id) await env.DB.prepare('UPDATE pages SET slug = ? WHERE id = ?').bind(r.to, r.id).run().catch(() => {});
          }
        }

        await env.DB.prepare('UPDATE pages SET title = ?, slug = ?, short_link = ?, external_url = ? WHERE id = ?')
          .bind(title, slug, short || null, ext || null, id).run();
        await logAudit(env.DB, currentUser, 'update', 'page', id, title,
          { title: page.title, slug: page.slug, short_link: page.short_link, external_url: page.external_url },
          { title, slug, short_link: short || null, external_url: ext || null });
        return new Response('', { status: 302, headers: { Location: '/pages?toast=' + encodeURIComponent('Saved · the site picks this up within a couple of minutes') } });
      }

      // ── Church details ──
      // The one record the map block, the service-times block, the sidebar
      // layout and the footer all read. Staff fix a phone number here once and
      // every page follows — which is the whole reason these are not in a
      // config file needing a deploy.
      if (path === '/pages/details' && method === 'GET') {
        const rows = await env.DB.prepare(
          "SELECT key, value, label, hint FROM site_settings WHERE key LIKE 'church_%' ORDER BY rowid"
        ).all().catch(() => ({ results: [] }));
        const saved = url.searchParams.get('msg') === 'saved';
        const field = (r) => {
          const multiline = r.key === 'church_service_times';
          return `<div class="form-group">
  <label for="f-${escapeHtml(r.key)}">${escapeHtml(r.label || r.key)}</label>
  ${multiline
    ? `<textarea id="f-${escapeHtml(r.key)}" name="${escapeHtml(r.key)}" rows="4" style="font-family:var(--sans);">${escapeHtml(r.value || '')}</textarea>`
    : `<input type="text" id="f-${escapeHtml(r.key)}" name="${escapeHtml(r.key)}" value="${escapeHtml(r.value || '')}">`}
  <div style="font-size:12px;color:var(--gray);margin-top:4px;">${escapeHtml(r.hint || '')}</div>
</div>`;
        };
        return html(`
${sidebarShell('pages', currentUser, `<a href="/pages">← All pages</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Church details</div>
  <div class="page-sub">The address, phone number, email and service times the whole site reads. Change them here once and every page that shows them follows — no need to edit each page.</div>
  ${saved ? `<div class="alert alert-success">✓ Saved. Every page that shows these will pick them up within a couple of minutes.</div>` : ''}
  <form method="POST" action="/pages/details">
    <div class="card">
      ${(rows.results || []).map(field).join('') || '<div style="color:var(--gray);font-size:14px;">Nothing to edit yet.</div>'}
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Save</button>
      <a href="/pages" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, 'Church details — TLC Admin');
      }

      if (path === '/pages/details' && method === 'POST') {
        const form = await request.formData();
        const rows = await env.DB.prepare("SELECT key FROM site_settings WHERE key LIKE 'church_%'")
          .all().catch(() => ({ results: [] }));
        // Only the keys the form actually exposes are writable, so a crafted
        // POST cannot reach the rest of site_settings through this screen.
        for (const r of rows.results || []) {
          const v = form.get(r.key);
          if (v === null) continue;
          await env.DB.prepare('UPDATE site_settings SET value = ? WHERE key = ?').bind(String(v).slice(0, 500), r.key).run();
        }
        await logAudit(env.DB, currentUser, 'update', 'settings', 'church_details', 'Church details');
        return new Response('', { status: 302, headers: { Location: '/pages/details?msg=saved' } });
      }

      // ── New page ──
      // Creates a draft from the chosen starter and drops staff straight into
      // the editor with the Page tab open. A starter rather than an empty page
      // because an empty page is the hardest thing to start from — the first
      // question is always "what goes on it?", and a working set of blocks
      // answers that with something to edit down.
      if (path === '/pages/new' && method === 'POST') {
        const now = new Date().toISOString();
        const form = await request.formData();
        const title = String(form.get('title') || '').trim().slice(0, 200) || 'New page';
        const starter = starterOf(String(form.get('starter') || ''));
        let id = 'page-' + Math.random().toString(36).slice(2, 8);
        for (let i = 0; i < 5; i++) {
          const clash = await env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(id).first();
          if (!clash) break;
          id = 'page-' + Math.random().toString(36).slice(2, 8);
        }
        const taken = await env.DB.prepare('SELECT slug FROM pages').all().catch(() => ({ results: [] }));
        const slug = uniqueSlug(slugify(title), new Set((taken.results || []).map((p) => p.slug)));
        const blocks = sanitizeBlocks(starterBlocks(title, starter.key));
        // status 'draft' and out of the menu: a new page is never live by
        // accident, whatever it was started from.
        await env.DB.prepare(
          "INSERT INTO pages (id, title, menu_label, slug, parent_id, sort, template, status, in_menu, seo_description, blocks, updated_at, updated_by) " +
          "VALUES (?, ?, '', ?, NULL, 999, 'standard', 'draft', 0, '', ?, ?, ?)"
        ).bind(id, title, slug, JSON.stringify(blocks), now, currentUser?.username || '').run();
        await logAudit(env.DB, currentUser, 'create', 'page', id, title, null, { title, slug, starter: starter.key });
        return new Response('', { status: 302, headers: { Location: `/pages/${id}/edit?tab=page` } });
      }

      // ── The editor screen ──
      // Same shell as the ministry editor; it works out from its own address
      // which API to talk to. Nothing about a page is baked into the HTML.
      if (path.match(/^\/pages\/[^/]+\/edit$/) && method === 'GET') {
        const id = decodeURIComponent(path.split('/')[2]);
        const exists = await env.DB.prepare('SELECT id, owner_username FROM pages WHERE id = ?').bind(id).first();
        if (!exists) return new Response('', { status: 302, headers: { Location: '/pages' } });
        if (!owns(exists)) return denied();
        return new Response(MINISTRY_EDITOR_HTML
          .replace('/*TLCB_EDITOR_CSS*/', editorPhoneCss())
          .replace('/*TLCB_LINKS_JS*/', LINKS_JS)
          .replace('<!--TLCB_TINYMCE-->', TINYMCE_HEAD), { headers: EDITOR_HEADERS });
      }

      // ── The editor's API ──
      if (path.startsWith('/pages/api/')) {
        const shared = await sharedEditorApi(path, method, request, env, ctx, currentUser, '/pages/api');
        if (shared) return shared;

        const rest = path.slice('/pages/api'.length);
        // ⚠ [a-z-] not [a-z]: the action segment may carry a hyphen
        // (/use-redesign). Without it that route silently never matches and
        // the button comes back "Not found" — with nothing in the code looking
        // wrong, because the handler is right there.
        const pageMatch = rest.match(/^\/page\/([^/]+)(\/[a-z-]+)?$/);
        const pageId = pageMatch ? decodeURIComponent(pageMatch[1]) : '';
        const action = pageMatch ? (pageMatch[2] || '') : '';
        if (!pageId) return jsonResponse({ error: 'Not found' }, 404);

        const COLS = 'id, title, menu_label, slug, parent_id, sort, template, status, in_menu, locked, seo_description, ' +
          'owner_username, aside_top, blocks, published_blocks, publish_at, change_log, updated_at, updated_by';
        const row = await env.DB.prepare(`SELECT ${COLS} FROM pages WHERE id = ?`).bind(pageId).first();
        if (!row) return jsonResponse({ error: 'Not found' }, 404);
        if (!owns(row)) return jsonResponse({ error: 'This page is not yours to edit.' }, 403);
        // A ministry leader edits the page; they do not restructure the site.
        if (ownOnly && (action === '/settings' || action === '/delete')) {
          return jsonResponse({ error: 'Only the office can rename, move or delete a page.' }, 403);
        }

        // Everything the editor needs in one round trip, including the list of
        // every page for the far-left rail.
        if (!action && method === 'GET') {
          const blocks = sanitizeBlocks(parseBlocks(row.blocks));
          const [media, siblings] = await Promise.all([
            env.DB.prepare('SELECT id, filename, kind, url, thumb_url, alt, meta FROM ministry_media ORDER BY id DESC LIMIT 200')
              .all().catch(() => ({ results: [] })),
            env.DB.prepare('SELECT id, title, menu_label, slug, parent_id, sort, status, in_menu, owner_username, blocks, published_blocks, publish_at FROM pages ORDER BY sort ASC, title ASC')
              .all().catch(() => ({ results: [] })),
          ]);
          // The section-landing child list is what visitors will see, so it is
          // every child; the rail is what this person may open, so it is not.
          const children = orderPages(siblings.results || []).filter((c) => c.parent_id === row.id);
          const openable = (siblings.results || []).filter(owns);
          return jsonResponse({
            page: {
              slug: row.id, path: row.slug, title: row.title, status: pageEditorStatus(row),
              template: row.template, publish_at: row.publish_at || null, updated_at: row.updated_at || '',
              blocks, changes: parseBlocks(row.change_log),
              published_count: sanitizeBlocks(parseBlocks(row.published_blocks)).length,
              settings: pageSettings(row),
            },
            pages: orderPages(openable).map((p) => ({
              id: p.id, title: p.menu_label || p.title, slug: p.slug, parent_id: p.parent_id,
              in_menu: !!p.in_menu, hasDraftEdits: p.hasDraftEdits,
            })),
            role: fullAccess ? 'office' : 'own',
            // Who a page can be handed to. Only the office assigns owners, so
            // only the office is sent the list.
            editors: fullAccess ? await pageEditors(env) : [],
            config: blocksClientConfig(await pageData(env, ctx)),
            // Every address on the site that answers, for the link picker and
            // its dead-link check. Deliberately NOT the `pages` list above:
            // that one is scoped to what this person may open.
            linkTargets: await linkTargets(),
            // Whether a designer-authored layout exists for THIS page. Sent
            // rather than worked out in the browser, so the editor never draws
            // a button that would come back "there is no redesigned layout".
            hasRedesign: !!REDESIGN_BLOCKS[row.id],
            media: media.results || [],
            html: renderPage(blocks, {
              editing: true, slug: row.id, template: row.template, withCss: true,
              data: await pageData(env, ctx), children, asideTop: row.aside_top || 0,
            }),
          });
        }

        // Page settings: name, address, menu placement, layout, search summary.
        // Renaming regenerates the address and writes a redirect from the old
        // one, so the one thing a well-meaning volunteer can break — an inbound
        // link — is handled rather than left to be remembered.
        if (action === '/settings' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const all = (await env.DB.prepare('SELECT id, title, menu_label, slug, parent_id, sort, in_menu FROM pages')
            .all().catch(() => ({ results: [] }))).results || [];
          const before = pageSettings(row);

          const title = cleanText(body.title, 80) || row.title;
          // Only a real rename regenerates the address, so retyping the same
          // name — or editing anything else — never moves the page.
          let slug = row.slug;
          let redirects = [];
          if (typeof body.slug === 'string' && body.slug.trim() && body.slug.trim() !== row.slug && row.slug !== '/') {
            // An address typed by hand is still cleaned and made unique.
            const taken = new Set(all.filter((p) => p.id !== row.id).map((p) => p.slug));
            slug = uniqueSlug(slugify(body.slug.replace(/^\/+/, ''), (all.find((p) => p.id === (body.parent_id ?? row.parent_id)) || {}).slug || ''), taken);
            if (slug !== row.slug) redirects.push({ from: row.slug, to: slug });
          } else if (title !== row.title) {
            const r = pageRename(Object.assign({}, row, { parent_id: body.parent_id === undefined ? row.parent_id : body.parent_id }), title, all);
            slug = r.slug;
            redirects = r.redirects;
          }

          // Menu depth is two levels: a page with children of its own cannot be
          // filed under another page, and nothing can be its own parent.
          let parentId = body.parent_id === undefined ? row.parent_id : (body.parent_id || null);
          if (parentId === row.id) parentId = row.parent_id;
          const parent = parentId ? all.find((p) => p.id === parentId) : null;
          if (parentId && (!parent || parent.parent_id)) parentId = null;
          if (parentId && all.some((p) => p.parent_id === row.id)) parentId = null;

          const owner = body.owner_username === undefined ? (row.owner_username || '') : cleanText(body.owner_username, 60);
          const template = body.template === undefined ? row.template : templateOf(body.template).key;
          const inMenu = body.in_menu === undefined ? row.in_menu : (body.in_menu ? 1 : 0);
          const seo = cleanText(body.seo_description, 300);
          // Only meaningful on sidebar/sectionside, but stored regardless of the
          // template in force at the moment — switching layout must not lose a
          // value chosen under the other one.
          const asideTop = body.aside_top === undefined ? (row.aside_top || 0) : snapSpace(body.aside_top);
          const nowIso = new Date().toISOString();

          await env.DB.prepare(
            'UPDATE pages SET title = ?, slug = ?, parent_id = ?, template = ?, in_menu = ?, seo_description = ?, owner_username = ?, aside_top = ?, updated_at = ?, updated_by = ? WHERE id = ?'
          ).bind(title, slug, parentId, template, inMenu, seo, owner || null, asideTop, nowIso, currentUser?.username || '', pageId).run();

          for (const r of redirects) {
            if (r.id) await env.DB.prepare('UPDATE pages SET slug = ? WHERE id = ?').bind(r.to, r.id).run();
            // A redirect that would now point at a page's own address is not a
            // redirect, it is a loop.
            if (r.from === r.to) continue;
            await env.DB.prepare('INSERT OR REPLACE INTO page_redirects (from_slug, to_slug, created_at) VALUES (?, ?, ?)')
              .bind(r.from, r.to, nowIso).run();
            // An address that used to redirect *to* this page now has to follow
            // it, or the older link dead-ends one hop short.
            await env.DB.prepare('UPDATE page_redirects SET to_slug = ? WHERE to_slug = ?').bind(r.to, r.from).run();
          }

          const after = await env.DB.prepare(`SELECT ${COLS} FROM pages WHERE id = ?`).bind(pageId).first();
          const siblings = (await env.DB.prepare('SELECT id, title, menu_label, slug, parent_id, sort, status, in_menu, blocks, published_blocks, publish_at FROM pages ORDER BY sort ASC, title ASC')
            .all().catch(() => ({ results: [] }))).results || [];
          await logAudit(env.DB, currentUser, 'update', 'page', pageId, title, before, pageSettings(after));

          // The layout and the aside's own spacing are the only two settings
          // that change what the canvas looks like; a rename does not, and
          // redrawing on every keystroke would fight the caret.
          const rerender = after.template !== row.template || after.aside_top !== row.aside_top;
          const blocks = sanitizeBlocks(parseBlocks(after.blocks));
          return jsonResponse({
            ok: true,
            page: pageSettings(after),
            pages: orderPages(siblings).map((p) => ({
              id: p.id, title: p.menu_label || p.title, slug: p.slug, parent_id: p.parent_id,
              in_menu: !!p.in_menu, hasDraftEdits: p.hasDraftEdits,
            })),
            redirected: redirects.length > 0,
            rerender,
            html: rerender ? renderPage(blocks, {
              editing: true, slug: after.id, template: after.template, withCss: true,
              asideTop: after.aside_top || 0,
              data: await pageData(env, ctx),
              children: orderPages(siblings).filter((c) => c.parent_id === after.id),
            }) : '',
          });
        }

        if (action === '/delete' && method === 'POST') {
          if (row.locked) return jsonResponse({ error: 'This page is part of the site structure and cannot be deleted.' }, 400);
          // Children would be stranded with no parent and no menu entry, so
          // they come up a level rather than disappearing with it.
          await env.DB.prepare('UPDATE pages SET parent_id = NULL WHERE parent_id = ?').bind(pageId).run();
          await env.DB.prepare('DELETE FROM pages WHERE id = ?').bind(pageId).run();
          await env.DB.prepare('DELETE FROM page_redirects WHERE to_slug = ?').bind(row.slug).run();
          await logAudit(env.DB, currentUser, 'delete', 'page', pageId, row.title, pageSettings(row), null);
          return jsonResponse({ ok: true });
        }

        // Autosaved working draft. Sanitized on the way in — client-side
        // clamping is a courtesy, this is the control.
        if (action === '/draft' && method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const blocks = sanitizeBlocks(body.blocks);
          // Locked blocks belong to the site's design rather than to the page.
          // A ministry leader can edit around one but cannot remove it, so a
          // save that drops one is refused rather than quietly accepted.
          if (ownOnly) {
            const kept = new Set(blocks.map((b) => b.id));
            const lost = sanitizeBlocks(parseBlocks(row.blocks)).filter((b) => b.locked && !kept.has(b.id));
            if (lost.length) return jsonResponse({ error: 'That part of the page is set by the church office and cannot be removed.' }, 403);
          }
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
            html: renderPage(blocks, Object.assign({
              editing: true, slug: row.id, withCss: true, data: await pageData(env, ctx),
            }, await pageLayoutContext(env, '/pages/api', row.id))),
          });
        }

        // ── PUT THE REDESIGNED LAYOUT ON THIS PAGE ────────────────────────
        // The four redesigned drafts (admin/redesign-seeds.js) reach a page
        // through the seed loop, and that loop is gated on canReseed() — a
        // page has to be untouched by a person AND never published. That guard
        // is right: it is what stops a deploy throwing away somebody's work.
        //
        // ⚠ But it meant the redesign could not reach the four pages it was
        // written for, because those are exactly the pages most likely to have
        // been edited. /news had been rebuilt by hand and showed "8 edits", so
        // the new draft was silently skipped and the page looked untouched by
        // the whole release. The answer is not to weaken the guard — it is to
        // let somebody ASK for it, deliberately, while looking at the page.
        if (action === '/use-redesign' && method === 'POST') {
          const fresh = REDESIGN_BLOCKS[pageId];
          if (!fresh) return jsonResponse({ error: 'There is no redesigned layout for this page.' }, 400);

          // ⚠ Snapshot FIRST. page_revisions normally holds one entry per
          // publish, and a page that has never been published has none — so
          // for /news the current draft is the only copy of work somebody did
          // by hand, and replacing it without a snapshot destroys it. This is
          // the one place a revision is written for something other than a
          // publish, and that is exactly why.
          const current = sanitizeBlocks(parseBlocks(row.blocks));
          if (current.length) {
            await env.DB.prepare(
              'INSERT INTO page_revisions (page_id, blocks, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)'
            ).bind(pageId, JSON.stringify(current), 'Before the redesigned layout was applied',
                   new Date().toISOString(), currentUser.username).run().catch(() => {});
          }

          const blocks = sanitizeBlocks(fresh);
          // The DRAFT only. published_blocks is untouched, so the live page is
          // exactly what it was until somebody presses Publish — the same rule
          // every seed in this repo follows.
          await env.DB.prepare('UPDATE pages SET blocks = ?, updated_at = ?, updated_by = ? WHERE id = ?')
            .bind(JSON.stringify(blocks), new Date().toISOString(), currentUser.username, pageId).run();
          await logAudit(env.DB, currentUser, 'update', 'page', pageId, row.title || pageId,
            { blocks: current.length + ' blocks' },
            { blocks: blocks.length + ' blocks', layout: 'the redesigned layout' });
          return jsonResponse({
            ok: true, blocks,
            html: renderPage(blocks, Object.assign({
              editing: true, slug: row.id, withCss: true, data: await pageData(env, ctx),
            }, await pageLayoutContext(env, '/pages/api', row.id))),
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
          // The link picker's rules, from the same file the Worker checks
          // links with — one definition, two runtimes. See admin/links.js.
          .replace('/*TLCB_LINKS_JS*/', LINKS_JS)
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
          config: blocksClientConfig(await pageData(env, ctx)),
          linkTargets: await linkTargets(),
          media: media.results || [],
          html: renderPage(blocks, { editing: true, slug, withCss: true, data: await pageData(env, ctx) }),
        });
      }

      // Autosaved working draft. Sanitized on the way in — client-side clamping
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
        // drawn, so staff never see a page still labeled "scheduled" after the
        // moment it was meant to publish.
        await promoteScheduledPages(env);
        const pages = await env.DB.prepare(
          'SELECT slug, title, has_posts, updated_at, blocks, published_blocks, page_status, publish_at, value, in_menu FROM youth_pages ORDER BY rowid'
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

        const TONE = { draft: 'warn', live: 'good', scheduled: 'auto', hidden: 'plain' };
        const LABEL = { draft: 'Draft edits', live: 'Live', scheduled: 'Scheduled', hidden: 'Hidden' };

        const listRows = pages.results.map((p) => {
          const draftCount = sanitizeBlocks(parseBlocks(p.blocks)).length;
          const status = LABEL[p.page_status] ? p.page_status : 'live';
          const postCount = countMap[p.slug] || 0;
          const inMenu = p.in_menu === null || p.in_menu === undefined ? 1 : p.in_menu;
          const v = valueByKey(p.value);

          return {
            href: `/ministries/editor/${encodeURIComponent(p.slug)}`,
            filter: [
              status === 'draft' ? 'draft-edits' : '',
              postCount ? 'with-posts' : '',
              inMenu ? '' : 'not-in-menu',
              p.value || '',
            ].filter(Boolean),
            search: `${p.title} ${p.slug} ${v?.short || ''} ${v?.name || ''}`.toLowerCase(),
            cells: [
              // The value chip sits beside the name, as in the design — it is a
              // property of the ministry, not a column of its own.
              `<div class="tlc-primary"><span class="tlc-primary-text">
                <span class="tlc-primary-title">${escapeHtml(p.title)}${v ? ` ${valueChip(p.value)}` : ''}</span>
                <span class="tlc-primary-sub">/ministries/${escapeHtml(p.slug)}${postCount ? ` · ${pluralise(postCount, 'post')}` : ''}</span>
              </span></div>`,
              `<a href="/${escapeHtml(p.slug)}" target="_blank" rel="noopener" style="color:var(--tlc-blue);text-decoration:none;">/${escapeHtml(p.slug)}</a>`,
              toggleCell(`/ministries/toggle-menu/${encodeURIComponent(p.slug)}`, !!inMenu, `${p.title} in the menu`),
              statusPill(TONE[status], LABEL[status]),
            ],
            actions: rowActions(
              { label: 'Open editor', href: `/ministries/editor/${encodeURIComponent(p.slug)}` },
              [
                { label: 'Details', href: `/ministries/edit/${encodeURIComponent(p.slug)}` },
                p.has_posts ? { label: 'Posts', href: `/ministries/${encodeURIComponent(p.slug)}/posts` } : null,
                { label: 'View live', href: `https://timothystl.org/${encodeURIComponent(p.slug)}` },
                !CORE_SLUGS.includes(p.slug)
                  ? { label: 'Delete', action: `/ministries/delete/${encodeURIComponent(p.slug)}`, confirm: 'Delete this ministry page?', danger: true }
                  : null,
              ]
            ),
            warn: !p.value ? 'No core value on this ministry, so it is missing from the values report on the dashboard.' : '',
            warnCta: !p.value ? { label: 'Tag it', href: `/ministries/edit/${encodeURIComponent(p.slug)}` } : null,
          };
        });

        const cfg = sectionCfg('ministries');
        return html(`
${sidebarShell('ministries', currentUser, `<a href="/voters">Voters Assembly page</a> <a href="/manual#ministry-editor">How the editor works</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'ministries',
    title: cfg.title,
    purpose: cfg.purpose,
    action: { label: cfg.action, href: '/ministries/add' },
    search: cfg.search,
    filters: filtersOf('ministries'),
    valueChips: sectionCfg('ministries').valueChips,
    columns: columnsOf('ministries'),
    rows: listRows,
    noun: 'ministry', nounPlural: 'ministries',
    empty: 'No ministry pages yet.',
    note: cfg.note,
  })}
</div>`, 'Ministries Admin');
      }

      // ── Add ministry form (GET) ──
      if (path === '/ministries/add' && method === 'GET') {
        return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries">← All ministries</a>`, await pageBadges())}
<div class="tlc-wrap">
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
      <button type="submit" class="btn btn-primary">Create ministry</button>
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
${sidebarShell('ministries', currentUser, `<a href="/ministries">← All ministries</a>`, await pageBadges())}
<div class="tlc-wrap">
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
      <div class="form-group">
        <label>Core value <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— which of the church's four values this ministry carries</span></label>
        ${valueChips('value', page.value)}
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">Used by the values report on the dashboard and by the public values page. Leave blank if it genuinely does not belong to one.</div>
      </div>
      <div class="form-group">
        <input type="hidden" name="in_menu" value="0">
        <div class="checkbox-row">
          <input type="checkbox" name="in_menu" value="1" id="in_menu" ${(page.in_menu === null || page.in_menu === undefined || page.in_menu) ? 'checked' : ''}>
          <span><label for="in_menu" style="display:inline;text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;">List this ministry in the website menu</label></span>
        </div>
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">Unticking this only removes it from the menu. The page stays live at /${escapeHtml(slug)} and every link to it keeps working.</div>
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
              <input type="text" name="cta_label" value="${(page.cta_label || '').replace(/"/g, '&quot;')}" placeholder="e.g. Sign up to volunteer">
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
        <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save &amp; Publish</button>
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
        const content = sanitizeClassicRich(form.get('content') || '');   // FX-04
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
        // normalizeValue() is the guard on the write path: a stale tab or a
        // hand-rolled POST cannot put 'Grow' in the column where every reader
        // expects 'education'.
        const value = normalizeValue(form.get('value'));
        const inMenu = form.get('in_menu') === '1' ? 1 : 0;
        const now = new Date().toISOString();
        const beforePage = await env.DB.prepare('SELECT title, content, cta_label, cta_url, value, in_menu FROM youth_pages WHERE slug = ?').bind(slug).first();
        await env.DB.prepare(
          'UPDATE youth_pages SET title = ?, content = ?, cta_label = ?, cta_url = ?, cta_label_2 = ?, cta_url_2 = ?, hero_image_url = ?, ministry_image_url = ?, vid_1_url = ?, vid_1_title = ?, vid_2_url = ?, vid_2_title = ?, vid_3_url = ?, vid_3_title = ?, value = ?, in_menu = ?, updated_at = ? WHERE slug = ?'
        ).bind(title, content, ctaLabel, ctaUrl, ctaLabel2, ctaUrl2, heroImageUrl, ministryImageUrl, vid1Url, vid1Title, vid2Url, vid2Title, vid3Url, vid3Title, value, inMenu, now, slug).run();
        await logAudit(env.DB, currentUser, 'update', 'ministry_page', slug, title, beforePage, { title, content: content.substring(0, 200), ctaLabel, ctaUrl, value, in_menu: inMenu });
        return new Response('', { status: 302, headers: { Location: '/ministries?msg=saved' } });
      }

      // Taking a ministry out of the menu leaves the page live at its address —
      // it just stops being listed. Posted from the switch in the list, so
      // there is no Save step for something that reads as instant.
      if (path.startsWith('/ministries/toggle-menu/') && method === 'POST') {
        const slug = decodeURIComponent(path.slice('/ministries/toggle-menu/'.length));
        const form = await request.formData();
        const next = form.get('value') === '1' ? 1 : 0;
        const before = await env.DB.prepare('SELECT title, in_menu FROM youth_pages WHERE slug = ?').bind(slug).first();
        await env.DB.prepare('UPDATE youth_pages SET in_menu = ? WHERE slug = ?').bind(next, slug).run();
        await logAudit(env.DB, currentUser, 'update', 'ministry_page', slug, before?.title || slug,
          { in_menu: before?.in_menu }, { in_menu: next });
        return new Response('', { status: 302, headers: { Location: '/ministries' } });
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
        const today = churchDate();
        const base = `/ministries/${encodeURIComponent(slug)}/posts`;

        // Task 15 #1. This was the last hand-rolled table in the admin — its own
        // .ni-row markup, its own badges, its own empty state. It is a config
        // now, so it inherits search, the filter pills, the scoped count label,
        // the two empty states and the warning rows from the shared pattern.
        const rows = posts.results.map((p) => {
          const when = p.event_date || p.post_date;
          const upcoming = when && when >= today;
          const expired = p.expire_date && p.expire_date < today;
          // Expired outranks everything: a post the site is no longer showing
          // should not read "Upcoming" because its event date has not passed.
          const status = expired ? statusPill('plain', 'Expired')
            : upcoming ? statusPill('good', 'Upcoming')
            : statusPill('auto', 'Past');
          return {
            href: `${base}/edit/${p.id}`,
            filter: [
              expired ? 'expired' : (upcoming ? 'upcoming' : 'past'),
              p.pinned ? 'pinned' : '',
            ].filter(Boolean),
            search: `${p.title} ${when || ''}`.toLowerCase(),
            cells: [
              // The pin marker leads the title, as on News: its job is to
              // explain why a row is at the top, not to help you find it.
              primaryCell((p.pinned ? '⌖ ' : '') + p.title, p.event_date ? 'Event' : 'Posted'),
              escapeHtml(when || '—'),
              escapeHtml(p.expire_date || 'Never'),
              status,
            ],
            // A post with no expiry never comes down on its own, which is the
            // one way a ministry page goes stale without anybody noticing.
            warn: p.expire_date ? '' : 'This post has no expiry date, so it stays on the page until somebody deletes it by hand.',
            warnCta: p.expire_date ? null : { label: 'Set one', href: `${base}/edit/${p.id}` },
          };
        });

        const section = renderListSection({
          key: 'ministryPosts',
          ...SECTIONS.ministryPosts,
          title: `${page.title} — posts`,
          action: { label: SECTIONS.ministryPosts.action, href: `${base}/new` },
          filters: filtersOf('ministryPosts'),
          columns: columnsOf('ministryPosts'),
          rows,
          noun: 'post', nounPlural: 'posts',
          empty: 'No posts on this page yet.',
        });

        return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries">← All ministries</a> <a href="/ministries/edit/${encodeURIComponent(slug)}">Edit the ${escapeHtml(page.title)} page</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${msg === 'postsaved' ? `<div class="alert alert-success">Post saved — it is on the ${escapeHtml(page.title)} page now.</div>` : ''}
  ${msg === 'postdeleted' ? `<div class="alert alert-info">Post deleted.</div>` : ''}
  ${section}
</div>`, `${page.title} posts`);
      }

      // ── New post form (GET) ──
      if (path.match(/^\/ministries\/[^/]+\/posts\/new$/) && method === 'GET') {
        const slug = path.split('/')[2];
        const page = await env.DB.prepare('SELECT title FROM youth_pages WHERE slug = ?').bind(slug).first();
        if (!page) return new Response('Not found', { status: 404 });
        const today = churchDate();
        return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries/${slug}/posts">← Posts</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">New post — ${page.title}</div>
  <div class="page-sub">A dated update on this ministry's own page — a recap, a photo, a change of plan. It appears above the page's standing content.</div>
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
      <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save &amp; Publish</button>
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
        const post_date = form.get('post_date') || churchDate();
        const event_date = form.get('event_date') || null;
        const expire_date = form.get('expire_date') || null;
        const body = sanitizeClassicRich(form.get('body') || '');   // FX-04
        // A toggle posts a hidden 0 ahead of its checkbox, so get() always sees
      // the 0. getAll() is the only reading that is true when it is really on.
      const pinned = form.getAll('pinned').includes('1') ? 1 : 0;
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
${sidebarShell('ministries', currentUser, `<a href="/ministries/${slug}/posts">← Posts</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Edit post — ${page.title}</div>
  <div class="page-sub">Changes reach the ministry page as soon as you save.</div>
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
      <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save changes</button>
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
        const body = sanitizeClassicRich(form.get('body') || '');   // FX-04
        // A toggle posts a hidden 0 ahead of its checkbox, so get() always sees
      // the 0. getAll() is the only reading that is true when it is really on.
      const pinned = form.getAll('pinned').includes('1') ? 1 : 0;
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
    if (path.startsWith('/notices') && !hasPermission(currentUser, 'notices_edit')) {
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

        // Position is per page, so a notice's rank only means anything next to
        // the others on the same page. Numbering them 1..n as displayed beats
        // showing the raw column, which is zero-based and gappy after deletes.
        const rankByPage = {};
        const list = rows.results.map((n) => {
          rankByPage[n.page_slug] = (rankByPage[n.page_slug] || 0) + 1;
          return { ...n, rank: rankByPage[n.page_slug] };
        });

        const listRows = list.map((n) => {
          const isEmpty = !n.body || !n.body.trim();
          const isHidden = n.published === 0;
          const updated = n.updated_at
            ? new Date(n.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Never edited';
          // A notice with no content is the failure this section actually sees:
          // somebody made the row, meant to come back, and the banner has been
          // silently absent ever since. It gets a warning row, not just a pill.
          const status = isEmpty ? statusPill('warn', 'Empty')
            : isHidden ? statusPill('plain', 'Hidden')
            : statusPill('good', 'Live');
          return {
            href: `/notices/edit/${n.id}`,
            filter: isHidden || isEmpty ? 'hidden' : 'showing',
            search: `${n.label} ${pageLabel(n.page_slug)}`.toLowerCase(),
            cells: [
              primaryCell(n.label, `Last edited ${updated}`),
              escapeHtml(pageLabel(n.page_slug)),
              `${n.rank}`,
              status,
            ],
            warn: isEmpty ? 'Nothing has been written in this notice, so no banner appears on the page.' : '',
            warnCta: isEmpty ? { label: 'Write it', href: `/notices/edit/${n.id}` } : null,
          };
        });

        return html(`
${sidebarShell('notices', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'notices',
    title: sectionCfg('notices').title,
    purpose: sectionCfg('notices').purpose,
    action: { label: sectionCfg('notices').action, href: '/notices/add' },
    search: sectionCfg('notices').search,
    filters: filtersOf('notices'),
    columns: columnsOf('notices'),
    rows: listRows,
    noun: 'notice',
    empty: 'No notices on any page yet.',
    note: sectionCfg('notices').note,
  })}
</div>`, 'Notices');
      }

      // ── Add notice (GET) ──
      // Task 15 #2. Add and edit are ONE FORM IN TWO STATES, and they used to
      // be built twice — which is how `add` ended up with no Visibility control
      // at all while `edit` had one, and how the two could drift again on the
      // next change. One builder now; the only differences are the ones that
      // are genuinely different: where it posts, and whether there is anything
      // to delete yet.
      //
      // Both addresses are kept. /notices/add is on the sidebar, on the list's
      // action button and in people's bookmarks; folding the CODE together is
      // the point, not renaming the door.
      const noticeForm = (n, isNew, badges) => `
${sidebarShell('notices', currentUser, `<a href="/notices">← All notices</a>`, badges)}
<div class="tlc-wrap">
  <div class="page-title">${isNew ? 'New notice' : escapeHtml(n.label)}</div>
  <div class="page-sub">${isNew
    ? 'Choose which page it appears on and write the content.'
    : `Shown on the ${pageLabel(n.page_slug)} page.`}</div>
  <div class="card">
    <form method="POST" action="${isNew ? '/notices/create' : `/notices/update/${n.id}`}">
      <div class="form-group">
        <label>Page${isNew ? ' <span style="color:#8C3A28;">*</span>' : ''}</label>
        <select name="page_slug">${pageOptionsHtml(n.page_slug)}</select>
      </div>
      <div class="form-group">
        <label>Internal label${isNew ? ' <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— for your reference in this list, not shown on the site</span>' : ''}</label>
        <input type="text" name="label" value="${escapeHtml(n.label || '')}" required${isNew ? ' placeholder="e.g. Lent midweek services"' : ''}>
      </div>
      <div class="card" style="margin-bottom:24px;background:var(--mist);border:1px solid var(--ice);">
        <div class="card-title">Visibility</div>
        <label style="display:flex;align-items:center;gap:12px;font-family:var(--sans);font-size:14px;cursor:pointer;">
          <input type="checkbox" name="published" value="1"${n.published === 1 ? ' checked' : ''} style="width:18px;height:18px;cursor:pointer;">
          Show this notice on the website
        </label>
        <div style="font-size:12px;color:var(--gray);margin-top:8px;">Uncheck to hide without deleting it — useful between seasons or events.</div>
      </div>
      ${tinymcePageSection(n.body || '')}
      <div class="btn-row" style="margin-top:24px;">
        <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save</button>
        <a href="/notices" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`;

      if (path === '/notices/add' && method === 'GET') {
        // A new notice arrives with the Visibility box already ticked, so the
        // old "publishes immediately" behavior is what happens if you change
        // nothing — but writing one ahead of a season and leaving it hidden is
        // now possible, which it simply was not before.
        return html(noticeForm({
          page_slug: url.searchParams.get('page') || STATIC_PAGES[0].slug,
          label: '', body: '', published: 1,
        }, true, await pageBadges()), 'New notice', TINYMCE_HEAD);
      }

      // ── Create notice (POST) ──
      if (path === '/notices/create' && method === 'POST') {
        const form = await request.formData();
        const pageSlug = form.get('page_slug') || STATIC_PAGES[0].slug;
        const label = form.get('label') || 'Untitled notice';
        const body = sanitizeClassicRich(form.get('content') || '');   // FX-04
        // ⚠ This was a hardcoded 1 while the add form showed no control. It
        // shows one now, ticked by default, so it has to be read — otherwise
        // unticking it would look like it worked and publish anyway.
        const published = form.has('published') ? 1 : 0;
        const now = new Date().toISOString();
        const maxPos = await env.DB.prepare('SELECT COALESCE(MAX(position), -1) as m FROM notices WHERE page_slug = ?').bind(pageSlug).first();
        await env.DB.prepare(
          'INSERT INTO notices (page_slug, label, body, published, position, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(pageSlug, label, body, published, (maxPos ? maxPos.m : -1) + 1, now).run();
        await logAudit(env.DB, currentUser, 'create', 'notice', pageSlug, label, null, { pageSlug, label });
        return new Response('', { status: 302, headers: { Location: '/notices?msg=created' } });
      }

      // ── Edit notice (GET) ──
      if (path.startsWith('/notices/edit/') && method === 'GET') {
        const id = path.slice('/notices/edit/'.length);
        const n = await env.DB.prepare('SELECT * FROM notices WHERE id = ?').bind(id).first();
        if (!n) return new Response('Not found', { status: 404 });
        return html(noticeForm(n, false, await pageBadges()), `Edit — ${n.label}`, TINYMCE_HEAD);
      }

      // ── Save notice (POST) ──
      if (path.startsWith('/notices/update/') && method === 'POST') {
        const id = path.slice('/notices/update/'.length);
        const form = await request.formData();
        const pageSlug = form.get('page_slug') || STATIC_PAGES[0].slug;
        const label = form.get('label') || 'Untitled notice';
        const body = sanitizeClassicRich(form.get('content') || '');   // FX-04
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

    // ── PUSH ALERT ─────────────────────────────────────────────
    // Andrew's answer to the review's own question about who a push should
    // reach (SEC-6/FX-29): not scoping the six existing staff triggers by
    // permission, but a second, genuinely different audience — "all push
    // notifications should go to admin, and then notifications from admin can
    // go out to all users." The six triggers already here (held mail, a new
    // contact/prayer message, a gym request, payroll turning ready, the
    // cross-app relay) are UNCHANGED — every one of them still calls
    // pushToAllSubscribers with no audience argument, which still means
    // 'staff', exactly as before this shipped. This is the one new door: a
    // human composing a message on purpose, for the OTHER audience.
    //
    // Gated on notices_edit rather than a new permission — this is a Notice
    // that rings a phone instead of sitting in a banner, and whoever can put
    // "Worship is canceled" on the website already has every reason to be
    // the one who can also push it.
    if (path.startsWith('/notify') && !hasPermission(currentUser, 'notices_edit')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path.startsWith('/notify')) {
      if (path === '/notify' && method === 'GET') {
        const { count } = await env.DB.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE audience = 'public'").first();
        const configured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
        const toast = url.searchParams.get('toast');
        return html(`
${sidebarShell('notify', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Push Alert</div>
  <div class="page-sub">A message that rings a phone, for whoever has turned on browser alerts on the website — not the office's own devices, which already ring on their own for held mail, a new message, a gym request and a payroll period turning ready. This is the one door onto the other audience.</div>
  ${!configured ? `<div class="alert alert-warn">Push notifications are not configured on this Worker yet — see the "admin is a PWA, with web push" section of CLAUDE.md for the VAPID keys this needs. Sending will do nothing until they are set.</div>` : ''}
  <div class="card">
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">
      <strong>${count}</strong> ${count === 1 ? 'person has' : 'people have'} turned on browser alerts on the website.
      ${count === 0 ? ' Nobody will receive this yet.' : ''}
    </div>
    <form method="POST" action="/notify/send">
      <div class="form-group">
        <label>Title</label>
        <input type="text" name="title" maxlength="200" required placeholder="e.g. Worship is canceled today">
      </div>
      <div class="form-group">
        <label>Message</label>
        <textarea name="body" maxlength="500" rows="3" required placeholder="A sentence or two — this is a notification, not the notice itself."></textarea>
      </div>
      <div class="form-group">
        <label>Link <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— where tapping it goes, optional</span></label>
        <input type="text" name="url" placeholder="/news" maxlength="200">
        <div style="font-size:12px;color:var(--gray);margin-top:4px;">A page on this site, starting with /. Left blank, it opens the homepage.</div>
      </div>
      <button type="submit" class="btn btn-primary">Send to ${count} ${count === 1 ? 'person' : 'people'}</button>
    </form>
  </div>
</div>`, 'Push Alert');
      }

      if (path === '/notify/send' && method === 'POST') {
        const form = await request.formData();
        const title = (form.get('title') || '').toString().trim().slice(0, 200);
        const body = (form.get('body') || '').toString().trim().slice(0, 500);
        // ⚠ A site-relative path only — never a general URL. `safeUrl()`
        // (admin/blocks.js) accepts a leading "//" as site-relative when it is
        // actually protocol-relative to an outside host (SEC-15); rather than
        // reuse that gap here, this field only ever accepts a single leading
        // slash, so there is nothing to get wrong about where it points.
        let notifyUrl = (form.get('url') || '').toString().trim().slice(0, 200);
        if (!/^\/(?!\/)/.test(notifyUrl)) notifyUrl = '';
        if (!title || !body) {
          return new Response('', { status: 302, headers: { Location: '/notify?toast=' + encodeURIComponent('A title and a message are both required.') } });
        }
        const payload = { title, body, tag: 'push-alert' };
        if (notifyUrl) payload.url = notifyUrl;
        // ⚠ AWAITED, NOT ctx.waitUntil. Every other caller of pushToAllSubscribers
        // fires it alongside an action that already succeeded on its own (a
        // submission was stored, a hold was taken) — the push there is a
        // courtesy that must never be allowed to block or fail that action.
        // Here the push IS the action. The office is looking at this screen to
        // find out it went out; a fire-and-forget confirmation would be a
        // confirmation of nothing.
        const result = await pushToPublicSubscribers(env, payload);
        await logAudit(env.DB, currentUser, 'push', 'push_alert', 'public', title, null, { title, body, url: notifyUrl || null, sent: result.sent, total: result.total });
        const goneNote = result.gone > 0 ? ` ${result.gone} had stopped listening and ${result.gone === 1 ? 'was' : 'were'} removed.` : '';
        return new Response('', {
          status: 302,
          headers: { Location: '/notify?toast=' + encodeURIComponent(`Sent to ${result.sent} of ${result.total}.${goneNote}`) },
        });
      }
    } // end push alert

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
        const list = members.results;

        const listRows = list.map((m, i) => {
          const initials = esc(m.name).split(' ').map((w) => w[0]).join('').slice(0, 2);
          const avatar = m.photo_url
            ? `<img src="${esc(staffPhotoSrc(m.photo_url))}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:${esc(isSafeObjectPosition(m.photo_position) ? m.photo_position : '50% 50%')};transform:scale(${safeZoomFactor(m.photo_zoom)});">`
            : `<span style="font-family:var(--tlc-serif);font-size:12px;">${initials}</span>`;
          return {
            href: `/staff/edit/${m.id}`,
            filter: m.photo_url ? 'on-the-website' : 'hidden',
            search: `${m.name} ${m.title || ''} ${m.email || ''}`.toLowerCase(),
            cells: [
              primaryCell(m.name, m.title || 'No role given', { icon: avatar, iconClass: 'person' }),
              m.email ? escapeHtml(m.email) : '<span style="color:var(--tlc-muted);">—</span>',
              `${m.display_order ?? 0}`,
              m.photo_url ? statusPill('good', 'Set') : statusPill('warn', 'No photo yet'),
            ],
            // Reordering stays a pair of buttons rather than drag-and-drop:
            // this list is short, and the order it produces is the order on the
            // About page, so being able to nudge one person is the whole need.
            actions: `<button type="button" class="tlc-edit" style="background:none;border:0;cursor:pointer;font:inherit;${i === 0 ? 'opacity:.3;' : ''}" ${i === 0 ? 'disabled' : ''} onclick="staffMove(${m.id},'up')" title="Move up">▲</button>`
              + `<button type="button" class="tlc-edit" style="background:none;border:0;cursor:pointer;font:inherit;${i === list.length - 1 ? 'opacity:.3;' : ''}" ${i === list.length - 1 ? 'disabled' : ''} onclick="staffMove(${m.id},'down')" title="Move down">▼</button>`
              + `<a class="tlc-edit" href="/staff/edit/${m.id}">Edit</a>`,
            warn: m.photo_url ? '' : 'No photo, so this person shows as initials on the About page.',
            warnCta: m.photo_url ? null : { label: 'Add one', href: `/staff/edit/${m.id}` },
          };
        });

        return html(`
${sidebarShell('staff', currentUser, `<a href="https://timothystl.org/about" target="_blank">View About page</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'staff',
    title: sectionCfg('staff').title,
    purpose: sectionCfg('staff').purpose,
    action: { label: sectionCfg('staff').action, href: '/staff/new' },
    search: sectionCfg('staff').search,
    filters: filtersOf('staff'),
    columns: columnsOf('staff'),
    rows: listRows,
    noun: 'person', nounPlural: 'people',
    empty: 'No staff members yet.',
    note: sectionCfg('staff').note,
  })}
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
${sidebarShell('staff', currentUser, `<a href="/staff">← All staff</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Add a person</div>
  <div class="page-sub">One record per person. Every page that shows staff reads from here — add someone once and the whole site follows.</div>
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
        <button type="submit" class="btn btn-primary">Save</button>
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
${sidebarShell('staff', currentUser, `<a href="/staff">← All staff</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">${esc(m.name)}</div>
  <div class="page-sub">The photo crop set here is reused everywhere this person appears, so a head is never cut off on one page and not another.</div>
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
        <button type="submit" class="btn btn-primary">Save</button>
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
        if (msg === 'updated')  alertHtml = `<div class="alert alert-success">✓ Tap updated. The physical tag is unchanged — it already only holds its short address.</div>`;

        const nowForTaps = new Date();
        // Old buckets are cleared here rather than on a schedule: this runs
        // whenever somebody opens the screen, which is often enough for a table
        // gaining four rows a day, and it cannot quietly stop the way a cron
        // trigger can. It is also never in a visitor's path.
        await env.DB.prepare('DELETE FROM tap_hits WHERE day < ?')
          .bind(pruneBefore(nowForTaps)).run().catch(() => {});
        const [cardRows, tapRows, hitRows] = await Promise.all([
          env.DB.prepare('SELECT * FROM link_cards ORDER BY sort_order, id').all().catch(() => ({ results: [] })),
          env.DB.prepare('SELECT * FROM taps ORDER BY id').all().catch(() => ({ results: [] })),
          // Only this month's buckets — the card asks one question and this is
          // the whole answer to it.
          env.DB.prepare('SELECT tap_id, day, hits FROM tap_hits WHERE day >= ?')
            .bind(nowForTaps.toISOString().slice(0, 7) + '-01').all().catch(() => ({ results: [] })),
        ]);
        const cards = cardRows.results || [];
        const taps = tapRows.results || [];
        const hits = hitRows.results || [];
        // The whole mechanic of this screen: the tag holds nothing but /tapN.
        // Editing it here changes where a tag handed out a year ago lands,
        // with nobody touching the tag.
        const tapPanel = taps.length === 0 ? '' : `<div class="tlc-taps">${taps.map((t) => {
          const count = cards.filter((c) => c.tap === t.id).length;
          // Cards are shown by the Link Tree page, which only exists at one
          // address. A tap landing anywhere else — the giving page, say — is a
          // perfectly good tag, but assigning cards to it does nothing, and
          // that is worth saying here rather than leaving to be discovered.
          const showsCards = LINKS_HOST_RE.test(String(t.destination || ''));
          return `<div class="tlc-tap">
    <div class="tlc-tap-head">
      <span class="tlc-tap-n">/tap${t.id}</span>
      ${t.active ? statusPill('good', 'Live') : statusPill('plain', 'Off')}
    </div>
    <span class="tlc-tap-name">${escapeHtml(t.name)}</span>
    <span class="tlc-tap-where">${escapeHtml(t.placement || 'Placement not recorded')}</span>
    <span class="tlc-tap-dest">Lands on ${escapeHtml(String(t.destination || '').replace(/^https?:\/\//, ''))}</span>
    <span class="tlc-tap-taps">${escapeHtml(tapCountLabel({
      month: countInMonth(hits, t.id, nowForTaps),
      everCounted: everCounted(t),
    }))}</span>
    <span class="tlc-tap-count">${pluralise(count, 'card')}</span>
    ${showsCards ? '' : `<span class="tlc-tap-warn">This tap lands somewhere other than the Link Tree, so it shows no cards${count ? ` — the ${pluralise(count, 'card')} here ${count === 1 ? 'is' : 'are'} not visible to anybody` : ''}. Point it at links.timothystl.org to use cards.</span>`}
    <div class="tlc-tap-actions">
      <a class="tlc-tap-btn" href="/link-cards/tap/${t.id}">Edit</a>
    </div>
  </div>`;
        }).join('')}</div>`;

        const listRows = cards
          .map((c) => ({
            href: `/link-cards/edit/${c.id}`,
            filter: c.active ? 'showing' : 'hidden',
            search: `${c.title} ${c.description || ''} ${c.url} ${isFormCard(c.kind) ? 'form signup newsletter' : ''}`.toLowerCase(),
            cells: [
              primaryCell(c.title, c.description || '', { icon: escapeHtml(c.icon_emoji || '🔗') }),
              // A sign-up card has no address. Saying so beats an empty cell,
              // which reads as a card somebody forgot to finish.
              isFormCard(c.kind)
                ? statusPill('plain', 'Sign-up form')
                : `<span title="${escapeHtml(c.url)}">${escapeHtml(String(c.url).replace(/^https?:\/\//, '').slice(0, 46))}</span>`,
              `${c.sort_order ?? 0}`,
              c.active ? statusPill('good', 'Showing') : statusPill('plain', 'Hidden'),
            ],
            actions: rowActions(
              { label: 'Edit', href: `/link-cards/edit/${c.id}` },
              [
                { label: c.active ? 'Hide' : 'Show', action: `/link-cards/toggle/${c.id}` },
                ...taps.map((t) => (c.tap === t.id ? null : {
                  label: `Move to /tap${t.id}`,
                  action: `/link-cards/move/${c.id}`,
                  fields: { tap: String(t.id) },
                })),
                c.tap ? { label: 'Show on every tap', action: `/link-cards/move/${c.id}`, fields: { tap: '' } } : null,
                { label: 'Delete', action: `/link-cards/delete/${c.id}`, confirm: 'Delete this card?', danger: true },
              ]
            ),
          }));

        const cfg = sectionCfg('links');
        return html(`
${sidebarShell('link-cards', currentUser, `<a href="https://links.timothystl.org" target="_blank">View link page</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  <div class="tlc-section" style="padding-bottom:0;">
    <div class="tlc-section-head">
      <div class="tlc-section-headings">
        <h1 class="tlc-title">${escapeHtml(cfg.title)}</h1>
        <p class="tlc-purpose">${escapeHtml(cfg.purpose)}</p>
      </div>
    </div>
    ${tapPanel}
  </div>
  ${renderListSection({
    key: 'links',
    title: 'Link Tree',
    purpose: 'Every card that can appear on links.timothystl.org. A card shows for every tap that lands there unless you move it to one tap only, below.',
    action: { label: cfg.action, href: '/link-cards/new' },
    search: cfg.search,
    filters: filtersOf('links'),
    columns: columnsOf('links'),
    rows: listRows,
    noun: 'card',
    empty: 'No link cards yet.',
    note: cfg.note,
  })}
</div>`, 'Taps & links — TLC Admin');
      }

      // Edit a tap (GET form)
      if (path.startsWith('/link-cards/tap/') && method === 'GET') {
        const id = parseInt(path.slice('/link-cards/tap/'.length), 10);
        const t = await env.DB.prepare('SELECT * FROM taps WHERE id = ?').bind(id).first();
        if (!t) return new Response('Not found', { status: 404 });
        return html(`
${sidebarShell('link-cards', currentUser, `<a href="/link-cards">← Taps &amp; links</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Edit /tap${t.id}</div>
  <div class="page-sub">${escapeHtml(t.name)} — ${escapeHtml(t.placement || 'placement not recorded')}</div>
  <div class="alert alert-info">The physical tag holds nothing but <code>/tap${t.id}</code>. Changing where that lands is this form — the tag itself is never reprogrammed, so anything already handed out keeps working.</div>
  <div class="card">
    <form method="POST" action="/link-cards/tap/${t.id}">
      <div class="form-group">
        <label>Name <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— for your reference here</span></label>
        <input type="text" name="name" value="${escapeHtml(t.name)}" required>
      </div>
      <div class="form-group">
        <label>Where the tag lives</label>
        <input type="text" name="placement" value="${escapeHtml(t.placement || '')}" placeholder="e.g. Narthex table · handout cards">
      </div>
      <div class="form-group">
        <label>Lands on <span style="color:#B85C3A;">*</span></label>
        <input type="text" name="destination" value="${escapeHtml(t.destination || '')}" required placeholder="https://links.timothystl.org">
        <p class="tlc-hint" style="margin-top:6px;">This is also how the Link Tree page knows which tap it is: an address under links.timothystl.org shows this tap's cards, plus every card set to show on all taps. Point it anywhere else and the tag still works — it just carries no cards.</p>
      </div>
      <div class="form-group">
        <input type="hidden" name="active" value="0">
        <div class="checkbox-row">
          <input type="checkbox" name="active" value="1" id="tap-active" ${t.active ? 'checked' : ''}>
          <span><label for="tap-active" style="display:inline;text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;">This tap is in use</label></span>
        </div>
      </div>
      <div class="btn-row" style="margin-top:20px;">
        <button type="submit" class="btn btn-primary">Save</button>
        <a href="/link-cards" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'Edit tap');
      }

      if (path.startsWith('/link-cards/tap/') && method === 'POST') {
        const id = parseInt(path.slice('/link-cards/tap/'.length), 10);
        const form = await request.formData();
        const before = await env.DB.prepare('SELECT * FROM taps WHERE id = ?').bind(id).first();
        // ⚠ The checkbox posts behind a hidden `active=0`, so an unchecked
        // box still submits a value for that name. form.get() returns only
        // the FIRST value for a repeated name — always that hidden 0,
        // whatever the box was set to — so the box could never actually save
        // as on. getAll(...).includes('1') is the fix used everywhere else a
        // toggle shares its name with a hidden fallback.
        const active = form.getAll('active').includes('1') ? 1 : 0;
        await env.DB.prepare('UPDATE taps SET name = ?, placement = ?, destination = ?, active = ? WHERE id = ?')
          .bind(String(form.get('name') || '').slice(0, 80), String(form.get('placement') || '').slice(0, 120),
                String(form.get('destination') || '').slice(0, 400), active, id).run();
        await logAudit(env.DB, currentUser, 'update', 'tap', String(id), before?.name || `tap${id}`, before,
          { destination: form.get('destination') });
        return new Response('', { status: 302, headers: { Location: '/link-cards?msg=updated' } });
      }

      // Move a card between taps
      if (path.startsWith('/link-cards/move/') && method === 'POST') {
        const id = parseInt(path.slice('/link-cards/move/'.length), 10);
        const form = await request.formData();
        const raw = String(form.get('tap') || '').trim();
        const tap = raw ? parseInt(raw, 10) : null;
        await env.DB.prepare('UPDATE link_cards SET tap = ? WHERE id = ?').bind(tap, id).run();
        return new Response('', { status: 302, headers: { Location: '/link-cards?msg=saved' } });
      }

      // Form helper (new & edit) — one config through the shared renderer, so
      // this reads as the same admin as the list it was opened from. The design
      // puts "Which tap" on this form, which is what makes moving a card
      // between tags a matter of picking one rather than retyping the card.
      const cardFormHtml = (c = {}, taps = []) => {
        const isNew = !c.id;
        return renderFormSection({
          title: isNew ? 'New card' : c.title || 'Edit card',
          purpose: isNew
            ? 'A card is what somebody sees after tapping a tag. The tag itself is unchanged by anything on this form.'
            : 'Shown on the taps this card belongs to. Changing it here changes what every tag pointing at it shows.',
          action: isNew ? '/link-cards/create' : `/link-cards/update/${c.id}`,
          cancelHref: '/link-cards',
          saveLabel: isNew ? 'Add card' : 'Save changes',
          deleteAction: isNew ? '' : `/link-cards/delete/${c.id}`,
          deleteConfirm: `Delete “${c.title || 'this card'}”? Anybody tapping the tag stops seeing it.`,
          fields: [
            { name: 'title', label: 'Card title', value: c.title || '', required: true, placeholder: 'Get Connected' },
            { name: 'description', label: 'Description', value: c.description || '', placeholder: 'One line under the title',
              hint: 'Optional. It is the line somebody reads to decide whether to tap.' },
            // Two options, so chips rather than a select — and the choice comes
            // before the address, because it decides whether there is one.
            { kind: 'chips', name: 'kind', label: 'What the card does', value: isFormCard(c.kind) ? 'signup' : 'link',
              options: CARD_KINDS.map((k) => ({ value: k.value, label: k.label })),
              hint: CARD_KINDS.map((k) => `${k.label}: ${k.note}`).join(' '),
            },
            // Not `required`: a sign-up card has nowhere to go, and a browser
            // refusing to submit the form would read as the screen being
            // broken. The POST handler is where the rule actually lives.
            { name: 'url', type: 'url', label: 'Goes to', value: c.url || '', placeholder: 'https://…',
              hint: 'Only for a card that opens a link. Leave it blank on a sign-up card.' },
            ...(taps.length ? [{
              kind: 'chips', name: 'tap', label: 'Which tap', value: c.tap == null ? '' : String(c.tap),
              options: [{ value: '', label: 'Every tap' }].concat(taps.map((t) => ({ value: String(t.id), label: `/tap${t.id} · ${t.name}` }))),
              hint: 'Move a card between taps without retyping it. “Every tap” shows it behind all four.',
            }] : []),
            { name: 'icon_emoji', label: 'Icon', value: c.icon_emoji || '🔗', placeholder: '🔗' },
            { kind: 'choice', name: 'icon_color', label: 'Icon color', value: c.icon_color || 'sky',
              options: COLOR_OPTIONS.map((v) => ({ value: v, label: COLOR_LABELS[v] })) },
            { kind: 'number', name: 'sort_order', label: 'Order', value: c.sort_order || 0, min: 0, step: 1,
              hint: 'Lower numbers come first.' },
          ],
        });
      };
      const tapsForForm = async () => (await env.DB.prepare('SELECT id, name FROM taps ORDER BY id')
        .all().catch(() => ({ results: [] }))).results || [];

      // New form
      if (path === '/link-cards/new' && method === 'GET') {
        return html(sidebarShell('link-cards', currentUser, '', await pageBadges())
          + `<div class="tlc-wrap">${cardFormHtml({}, await tapsForForm())}</div>`, 'New card — TLC Admin');
      }

      // Create
      if (path === '/link-cards/create' && method === 'POST') {
        const fd = await request.formData();
        const title = (fd.get('title')||'').trim();
        // A sign-up card is a form on the page, so it has no address at all —
        // the URL check applies only to a card that opens a link.
        const newKind = isFormCard(fd.get('kind')) ? 'signup' : 'link';
        const cardUrl = newKind === 'signup' ? '' : (fd.get('url')||'').trim();
        if (!title || (newKind === 'link' && !isSafeCardUrl(cardUrl))) return new Response('', { status: 302, headers: { Location: '/link-cards/new' } });
        // Blank means "every tap", which is a real answer and not a missing one.
        const newTap = String(fd.get('tap') || '').trim();
        await env.DB.prepare('INSERT INTO link_cards (title, description, url, icon_emoji, icon_color, sort_order, tap, kind, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)')
          .bind(title, (fd.get('description')||'').trim(), cardUrl, (fd.get('icon_emoji')||'🔗').trim(), (fd.get('icon_color')||'sky'), parseInt(fd.get('sort_order')||'0',10), newTap ? parseInt(newTap, 10) : null, newKind).run();
        return new Response('', { status: 302, headers: { Location: '/link-cards?msg=saved' } });
      }

      // Edit form
      const editMatch = path.match(/^\/link-cards\/edit\/(\d+)$/);
      if (editMatch && method === 'GET') {
        const c = await env.DB.prepare('SELECT * FROM link_cards WHERE id = ?').bind(parseInt(editMatch[1],10)).first();
        if (!c) return new Response('Not found', { status: 404 });
        return html(sidebarShell('link-cards', currentUser, '', await pageBadges())
          + `<div class="tlc-wrap">${cardFormHtml(c, await tapsForForm())}</div>`, 'Edit card — TLC Admin');
      }

      // Update
      const updateMatch = path.match(/^\/link-cards\/update\/(\d+)$/);
      if (updateMatch && method === 'POST') {
        const fd = await request.formData();
        const title = (fd.get('title')||'').trim();
        const upKind = isFormCard(fd.get('kind')) ? 'signup' : 'link';
        const cardUrl = upKind === 'signup' ? '' : (fd.get('url')||'').trim();
        if (!title || (upKind === 'link' && !isSafeCardUrl(cardUrl))) return new Response('', { status: 302, headers: { Location: `/link-cards/edit/${updateMatch[1]}` } });
        const upTap = String(fd.get('tap') || '').trim();
        await env.DB.prepare('UPDATE link_cards SET title=?, description=?, url=?, icon_emoji=?, icon_color=?, sort_order=?, tap=?, kind=? WHERE id=?')
          .bind(title, (fd.get('description')||'').trim(), cardUrl, (fd.get('icon_emoji')||'🔗').trim(), (fd.get('icon_color')||'sky'), parseInt(fd.get('sort_order')||'0',10), upTap ? parseInt(upTap, 10) : null, upKind, parseInt(updateMatch[1],10)).run();
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
    if ((path.startsWith('/settings') || path.startsWith('/redirects')) && !hasPermission(currentUser, 'settings_manage')
        && !(path.startsWith('/redirects/') && hasPermission(currentUser, 'giving_manage'))) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path === '/redirects/add' && method === 'POST') {
      const form = await request.formData();
      const rPath = (form.get('path') || '').trim().replace(/^\/+/, '').toLowerCase();
      const rUrl  = (form.get('url')  || '').trim();
      const rLabel= (form.get('label')|| '').trim();
      const rCategory = (form.get('category') || 'general').trim() === 'giving' ? 'giving' : 'general';
      // A toggle posts a hidden 0 ahead of the checkbox, so get() always returns
      // something; a 1 being present is what "on" means. A bare checkbox (the
      // vendor-link form in Giving) still posts only '1' when ticked.
      const rActive = form.getAll('active').includes('1') ? 1 : 0;
      // Anything but an explicit 'gift' is a payment. Defaulting the other way
      // would let a typo put a non-donation on somebody's tax statement.
      const rGiveKind = form.get('give_kind') === 'gift' ? 'gift' : 'payment';
      const redirectBackTo = rCategory === 'giving' ? '/giving' : '/redirects';
      if (!hasPermission(currentUser, rCategory === 'giving' ? 'giving_manage' : 'settings_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      if (!rPath || !rUrl) return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-error' } });
      let parsedProtocol = '';
      try { parsedProtocol = new URL(rUrl).protocol; } catch (_) {}
      if (parsedProtocol !== 'http:' && parsedProtocol !== 'https:') {
        return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-error' } });
      }
      await env.DB.prepare('INSERT OR REPLACE INTO redirects (path, url, label, category, active, give_kind) VALUES (?, ?, ?, ?, ?, ?)').bind(rPath, rUrl, rLabel, rCategory, rActive, rGiveKind).run();
      return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-added' } });
    }
    if (path === '/redirects/update' && method === 'POST') {
      const form = await request.formData();
      const originalPath = (form.get('original_path') || '').trim().replace(/^\/+/, '').toLowerCase();
      const rPath = (form.get('path') || '').trim().replace(/^\/+/, '').toLowerCase();
      const rUrl  = (form.get('url')  || '').trim();
      const rLabel= (form.get('label')|| '').trim();
      const rCategory = (form.get('category') || 'general').trim() === 'giving' ? 'giving' : 'general';
      // A toggle posts a hidden 0 ahead of the checkbox, so get() always returns
      // something; a 1 being present is what "on" means. A bare checkbox (the
      // vendor-link form in Giving) still posts only '1' when ticked.
      const rActive = form.getAll('active').includes('1') ? 1 : 0;
      // Anything but an explicit 'gift' is a payment. Defaulting the other way
      // would let a typo put a non-donation on somebody's tax statement.
      const rGiveKind = form.get('give_kind') === 'gift' ? 'gift' : 'payment';
      const redirectBackTo = rCategory === 'giving' ? '/giving' : '/redirects';
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
      await env.DB.prepare('INSERT OR REPLACE INTO redirects (path, url, label, category, active, give_kind) VALUES (?, ?, ?, ?, ?, ?)').bind(rPath, rUrl, rLabel, rCategory, rActive, rGiveKind).run();
      return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-updated' } });
    }
    if (path.startsWith('/redirects/delete/') && method === 'POST') {
      const rPath = path.slice('/redirects/delete/'.length);
      const existing = await env.DB.prepare('SELECT category FROM redirects WHERE path = ?').bind(rPath).first();
      const existingCategory = existing?.category === 'giving' ? 'giving' : 'general';
      const redirectBackTo = existingCategory === 'giving' ? '/giving' : '/redirects';
      if (!hasPermission(currentUser, existingCategory === 'giving' ? 'giving_manage' : 'settings_manage')) {
        return new Response('Access denied.', { status: 403 });
      }
      await env.DB.prepare('DELETE FROM redirects WHERE path = ?').bind(rPath).run();
      return new Response('', { status: 302, headers: { Location: redirectBackTo + '?msg=redirect-deleted' } });
    }

    // ── SUBSCRIBERS ADMIN ──
    if (path.startsWith('/subscribers') && !hasPermission(currentUser, 'settings_manage')) {
      return new Response('Access denied.', { status: 403 });
    }
    if (path === '/subscribers/import' && method === 'POST') {
      // Import is additive and never removes anybody. A row already on the list
      // is left alone rather than overwritten — the office pasting last year's
      // export must not reset somebody's name or resurrect an unsubscribe.
      const form = await request.formData();
      const raw = String(form.get('csv') || '');
      const parsed = parseSubscriberCsv(raw);
      if (!parsed.rows.length) {
        return Response.redirect(new URL(`/subscribers?msg=${encodeURIComponent(parsed.skipped ? 'No usable rows — every line was missing an email address.' : 'Nothing to import.')}`, request.url), 302);
      }
      let added = 0, already = 0;
      const now = new Date().toISOString();
      for (const r of parsed.rows) {
        const existing = await env.DB.prepare('SELECT email FROM newsletter_subscribers WHERE lower(email) = ?').bind(r.email.toLowerCase()).first().catch(() => null);
        if (existing) { already++; continue; }
        await env.DB.prepare('INSERT INTO newsletter_subscribers (email, name, subscribed_at) VALUES (?, ?, ?)')
          .bind(r.email, r.name || null, now).run().catch(() => {});
        added++;
      }
      // Push to Brevo too, so an imported address actually receives the email.
      // Brevo failing is reported but does not undo the local rows — they are
      // the record of who asked to be on the list.
      let brevoNote = '';
      if (env.BREVO_API_KEY && env.BREVO_LIST_ID) {
        for (const r of parsed.rows) {
          try {
            await fetch('https://api.brevo.com/v3/contacts', {
              method: 'POST',
              headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: r.email,
                attributes: r.name ? { FIRSTNAME: r.name.split(' ')[0], LASTNAME: r.name.split(' ').slice(1).join(' ') } : undefined,
                listIds: [Number(env.BREVO_LIST_ID)],
                updateEnabled: true,
              }),
            });
          } catch (_) { brevoNote = ' Brevo could not be reached, so these are on the website list only.'; }
        }
      } else {
        brevoNote = ' Brevo is not configured, so these are on the website list only.';
      }
      await logAudit(env.DB, currentUser, 'import', 'subscribers', 'import', 'Subscriber import', null, { added, already, skipped: parsed.skipped });
      const msg = `Imported ${pluralise(added, 'new subscriber')}${already ? `, ${already} already on the list` : ''}${parsed.skipped ? `, ${parsed.skipped} skipped with no email address` : ''}.${brevoNote}`;
      return Response.redirect(new URL(`/subscribers?msg=${encodeURIComponent(msg)}`, request.url), 302);
    }
    if ((path === '/subscribers' || path === '/subscribers/import') && method === 'GET') {
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
          const limit = 500;
          const fetchPage = (offset) => fetch(`https://api.brevo.com/v3/contacts/lists/${listId}/contacts?limit=${limit}&offset=${offset}`, {
            headers: { 'api-key': env.BREVO_API_KEY, 'Accept': 'application/json' }
          });
          // The first page is the one request that has to go alone — it is
          // the only way to learn `count`. Every page after that is an offset
          // this response already told us, so none of them depend on each
          // other; fetching them one at a time (the old shape) turned a list
          // of any real size into that many serial round trips inside the
          // render path.
          const first = await fetchPage(0);
          if (!first.ok) {
            brevoError = `Brevo API error: ${first.status}`;
          } else {
            const firstData = await first.json();
            brevoContacts = firstData.contacts || [];
            brevoTotal = firstData.count;
            const offsets = [];
            for (let offset = limit; offset < (brevoTotal || 0); offset += limit) offsets.push(offset);
            if (offsets.length) {
              const pages = await Promise.all(offsets.map(fetchPage));
              for (const resp of pages) {
                // One failed page still leaves the rest usable — same spirit
                // as the old loop breaking with whatever it already had.
                if (!resp.ok) { brevoError = brevoError || `Brevo API error: ${resp.status}`; continue; }
                const data = await resp.json();
                brevoContacts = brevoContacts.concat(data.contacts || []);
              }
            }
          }
        } catch (e) {
          brevoError = `Failed to fetch from Brevo: ${e.message}`;
        }
      }

      // Local website signups
      const localTotal = await env.DB.prepare('SELECT COUNT(*) as cnt FROM newsletter_subscribers').first();
      const localRecent = await env.DB.prepare('SELECT email, name, subscribed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC LIMIT 50').all();

      // One list, both sources. Brevo is the record of who actually receives the
      // email; the local table is who signed up on the website. A person can be
      // in both, so they are merged on the address rather than shown twice.
      const bySource = new Map();
      for (const s of localRecent.results) {
        bySource.set(String(s.email || '').toLowerCase(), { joined: s.subscribed_at, name: s.name });
      }
      // A bounce and an unsubscribe are different facts and the design asks for
      // them apart. Brevo's contact record only ever tells us `emailBlacklisted`
      // — true for both — so a bounce is only reported when the account keeps a
      // marker attribute for it. Without one the Bounced filter reaches nothing,
      // which is honest; guessing that every blacklisted address bounced would
      // tell the office to chase people who simply opted out.
      const bounced = (c) => {
        const a = c.attributes || {};
        return !!(a.HARD_BOUNCE || a.HARDBOUNCE || a.BOUNCED || a.BOUNCE);
      };
      const listRows = brevoContacts.map((c) => {
        const email = String(c.email || '');
        const local = bySource.get(email.toLowerCase());
        const name = [c.attributes?.FIRSTNAME, c.attributes?.LASTNAME].filter(Boolean).join(' ') || local?.name || '';
        const isBounced = bounced(c);
        const unsub = !isBounced && !!c.emailBlacklisted;
        bySource.delete(email.toLowerCase());
        // Two filters have to reach the same row — where they came from, and
        // whether the address still works — so the row carries both.
        const filters = [local ? 'website' : 'added-by-office'];
        if (isBounced) filters.push('bounced');
        return {
          filter: filters,
          search: `${email} ${name}`.toLowerCase(),
          cells: [
            primaryCell(name || email, name ? email : 'No name on file'),
            local ? 'Website signup' : 'Added by office',
            escapeHtml((local?.joined || '').slice(0, 10) || '—'),
            isBounced ? statusPill('bad', 'Bounced')
              : unsub ? statusPill('plain', 'Unsubscribed')
                : statusPill('good', 'Subscribed'),
          ],
          actions: '',
          ...(isBounced ? { warn: 'Mail to this address is bouncing, so this person is not receiving the newsletter. Correct the address in Brevo or ask them for a new one.', warnAction: { label: 'Open in Brevo', href: `https://app.brevo.com/contact/index` } } : {}),
        };
      });
      // Anyone who signed up on the website but has not reached Brevo yet. They
      // are a website signup like any other — the gap is stated on the row
      // rather than hidden behind a filter of its own.
      for (const [email, s] of bySource) {
        listRows.push({
          filter: 'website',
          search: `${email} ${s.name || ''}`.toLowerCase(),
          cells: [
            primaryCell(s.name || email, s.name ? email : 'No name on file'),
            'Website signup',
            escapeHtml((s.joined || '').slice(0, 10) || '—'),
            statusPill('warn', 'Not in Brevo'),
          ],
          actions: '',
          warn: 'Signed up on the website but not showing in the Brevo list yet, so they are not receiving the email.',
        });
      }

      const subMsg = url.searchParams.get('msg');
      const errorBanner = (brevoError
        ? `<div class="alert alert-error">⚠ ${escapeHtml(brevoError)} <a href="https://app.brevo.com" target="_blank" style="color:var(--steel);">Open Brevo</a><br><span style="font-size:13px;">The website signups below are still accurate; only the Brevo side could not be read.</span></div>`
        : '') + (subMsg ? `<div class="alert alert-success">✓ ${escapeHtml(subMsg)}</div>` : '');

      return html(`
${sidebarShell('subscribers', currentUser, `<a href="https://app.brevo.com" target="_blank">Open Brevo</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${errorBanner ? `<div class="tlc-section" style="padding-bottom:0;">${errorBanner}</div>` : ''}
  ${renderListSection({
    key: 'subscribers',
    title: sectionCfg('subscribers').title,
    purpose: `${sectionCfg('subscribers').purpose}${brevoTotal !== null ? ` ${pluralise(brevoTotal, 'person', 'people')} in the Brevo list.` : ''}`,
    action: { label: sectionCfg('subscribers').action, href: '/subscribers/import' },
    search: sectionCfg('subscribers').search,
    filters: filtersOf('subscribers'),
    columns: columnsOf('subscribers'),
    rows: listRows,
    noun: 'subscriber',
    empty: 'No subscribers yet.',
    note: sectionCfg('subscribers').note,
  })}
  ${path === '/subscribers/import' ? renderDrawer({
    key: 'subscriber-import',
    title: 'Import subscribers',
    sub: 'Paste a list exported from Brevo, Breeze, or a spreadsheet.',
    action: '/subscribers/import',
    cancelHref: '/subscribers',
    saveLabel: 'Import',
    fields: [
      { kind: 'textarea', name: 'csv', label: 'Rows', rows: 12, required: true,
        placeholder: 'email,name\njane@example.com,Jane Smith\n…',
        hint: 'One person per line. Any column with "email" in its heading is used as the address, and a name is taken from name, or first and last. A heading row is optional.' },
      { kind: 'static', label: 'What this does',
        html: '<p style="margin:0;">Adds anybody not already on the list, here and in Brevo. Nobody is removed and nobody already on the list is changed — so re-importing the same file is safe.</p>' },
    ],
  }) : ''}
</div>`, 'Subscribers');
    }

    // ── REDIRECTS ────────────────────────────────────────────────
    // Four kinds of address answer on this site and they live in three
    // different places: hand-made rows in `redirects`, the 301s `page_redirects`
    // writes when a page is renamed, short links derived from a page's address
    // and stored nowhere at all, and the giving/vendor links managed under
    // Giving. Somebody asking "where does /zoom go" should not have to know
    // which of those it is, so all four are one list and the Kind column says
    // which. The filters are the design's four: a short link is filed under
    // Automatic because nobody typed it, and a giving link under Hand-made
    // because somebody did.
    if ((path === '/redirects' || path === '/redirects/new' || path.startsWith('/redirects/edit/')) && method === 'GET') {
      const [customRedirects, givingRedirects, autoRedirects, pageRows] = await Promise.all([
        env.DB.prepare("SELECT path, url, label, category, active FROM redirects WHERE category != 'giving' ORDER BY path").all().catch(() => ({ results: [] })),
        env.DB.prepare("SELECT path, url, label, active FROM redirects WHERE category = 'giving' ORDER BY path").all().catch(() => ({ results: [] })),
        env.DB.prepare('SELECT from_slug, to_slug, created_at FROM page_redirects ORDER BY from_slug').all().catch(() => ({ results: [] })),
        env.DB.prepare("SELECT id, title, menu_label, slug, parent_id, status, short_link FROM pages WHERE status = 'published'").all().catch(() => ({ results: [] })),
      ]);
      const msg = url.searchParams.get('msg');
      const alertHtml = msg === 'redirect-added'   ? `<div class="alert alert-success">✓ Redirect added.</div>`
        : msg === 'redirect-updated' ? `<div class="alert alert-success">✓ Redirect updated.</div>`
        : msg === 'redirect-deleted' ? `<div class="alert alert-info">Redirect deleted.</div>`
        : msg === 'redirect-error'   ? `<div class="alert alert-error">A redirect needs both a path and a full destination URL starting http:// or https://.</div>` : '';

      const short = (u, n = 46) => {
        const s = String(u || '').replace(/^https?:\/\//, '');
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
      };

      const listRows = [];

      for (const r of (customRedirects.results || [])) {
        listRows.push({
          href: `/redirects/edit/${encodeURIComponent(r.path)}`,
          filter: r.active ? 'hand-made' : 'off',
          search: `${r.path} ${r.url} ${r.label || ''}`.toLowerCase(),
          cells: [
            primaryCell('/' + String(r.path).replace(/^\/+/, ''), r.label || 'No label'),
            `<span title="${escapeHtml(r.url)}">${escapeHtml(short(r.url))}</span>`,
            'Hand-made',
            r.active ? statusPill('good', 'Redirecting') : statusPill('plain', 'Off'),
          ],
          actions: rowActions(
            { label: 'Edit', href: `/redirects/edit/${encodeURIComponent(r.path)}` },
            [{ label: 'Delete', action: `/redirects/delete/${encodeURIComponent(r.path)}`, danger: true,
               confirm: `Delete /${r.path}? Anybody who has that address written down will get a 404.` }],
          ),
        });
      }

      for (const r of (givingRedirects.results || [])) {
        listRows.push({
          href: '/giving',
          filter: r.active ? 'hand-made' : 'off',
          search: `${r.path} ${r.url} ${r.label || ''} giving`.toLowerCase(),
          cells: [
            primaryCell('/' + String(r.path).replace(/^\/+/, ''), r.label || 'Giving or payment link'),
            `<span title="${escapeHtml(r.url)}">${escapeHtml(short(r.url))}</span>`,
            'Giving',
            r.active ? statusPill('good', 'Redirecting') : statusPill('plain', 'Off'),
          ],
          actions: `<a class="tlc-edit" href="/giving">Manage in Giving</a>`,
        });
      }

      // Written automatically when a page address changed. These are the rows
      // that keep old bulletins and Google results working, which is why the
      // section note tells staff to leave them alone.
      for (const r of (autoRedirects.results || [])) {
        listRows.push({
          filter: 'automatic',
          search: `${r.from_slug} ${r.to_slug}`.toLowerCase(),
          cells: [
            primaryCell(r.from_slug, 'Old address, kept working'),
            escapeHtml(r.to_slug),
            'Automatic',
            statusPill('auto', '301'),
          ],
          actions: '<span style="color:var(--tlc-muted);font-size:12.5px;">Leave it</span>',
        });
      }

      // Short links are not stored anywhere — they are derived from each page's
      // address — but they are addresses that answer on the site, so hiding them
      // here would make this list a half-truth.
      for (const p of withShortLinks(pageRows.results || [])) {
        if (!p.shortLink || p.shortLink === p.slug) continue;
        listRows.push({
          href: `/pages/${encodeURIComponent(p.id)}/link`,
          filter: p.shortLinkClash ? ['automatic', 'off'] : 'automatic',
          search: `${p.shortLink} ${p.slug} ${p.title}`.toLowerCase(),
          cells: [
            primaryCell(p.shortLink, `Short link for ${p.menu_label || p.title}`),
            escapeHtml(p.slug),
            'Short link',
            p.shortLinkClash ? statusPill('bad', 'Link clash') : statusPill('good', 'Redirecting'),
          ],
          actions: `<a class="tlc-edit" href="/pages/${encodeURIComponent(p.id)}/link">Change</a>`,
          warn: p.shortLinkClash ? `${p.shortLinkClash.link} is also wanted by ${p.shortLinkClash.withTitle}, so this short link is switched off.` : '',
          warnCta: p.shortLinkClash ? { label: 'Fix short link', href: `/pages/${encodeURIComponent(p.id)}/link` } : null,
        });
      }

      // The drawer, for adding one or editing a hand-made row. Automatic 301s
      // and short links are not editable here on purpose — they are derived from
      // a page, and the place to change them is that page.
      const editPath = path.startsWith('/redirects/edit/') ? decodeURIComponent(path.slice('/redirects/edit/'.length)) : '';
      const editing = editPath
        ? await env.DB.prepare("SELECT path, url, label, active FROM redirects WHERE path = ? AND category != 'giving'").bind(editPath).first().catch(() => null)
        : null;
      const showDrawer = path === '/redirects/new' || !!editing;

      return html(`
${sidebarShell('redirects', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'redirects',
    title: sectionCfg('redirects').title,
    purpose: sectionCfg('redirects').purpose,
    action: { label: sectionCfg('redirects').action, href: '/redirects/new' },
    search: sectionCfg('redirects').search,
    filters: filtersOf('redirects'),
    columns: columnsOf('redirects'),
    rows: listRows,
    noun: 'redirect',
    empty: 'No redirects yet.',
    note: sectionCfg('redirects').note,
  })}
  ${showDrawer ? renderDrawer({
    key: 'redirect',
    title: editing ? `Edit /${editing.path}` : 'New redirect',
    sub: 'A short address on timothystl.org that sends visitors somewhere else.',
    action: editing ? '/redirects/update' : '/redirects/add',
    cancelHref: '/redirects',
    saveLabel: editing ? 'Save changes' : 'Add redirect',
    deleteAction: editing ? `/redirects/delete/${encodeURIComponent(editing.path)}` : '',
    deleteConfirm: editing ? `Delete /${editing.path}? Anybody who has that address written down will get a 404.` : '',
    fields: [
      ...(editing ? [{ kind: 'html', html: `<input type="hidden" name="original_path" value="${escapeHtml(editing.path)}">` }] : []),
      { kind: 'html', html: `<input type="hidden" name="category" value="general">` },
      { name: 'path', label: 'Short address', value: editing?.path || '', required: true, placeholder: 'zoom',
        hint: 'Without the slash. Entering "zoom" makes timothystl.org/zoom work.' },
      { name: 'url', type: 'url', label: 'Goes to', value: editing?.url || '', required: true, placeholder: 'https://…',
        hint: 'The full address including https://.' },
      { name: 'label', label: 'Label', value: editing?.label || '', placeholder: 'What this is for',
        hint: 'Only shown here, so the next person knows why it exists.' },
      { kind: 'toggle', name: 'active', label: 'Live on the site', value: editing ? !!editing.active : true,
        hint: 'Switched off, the address stops working and falls through to the 404 page. Nothing is deleted.' },
    ],
  }) : ''}
</div>`, 'Redirects');
    }

    // ── SETTINGS ─────────────────────────────────────────────────
    // The handful of `site_settings` rows the rest of the site reads. Every one
    // is listed with what reads it, because the reason this screen is dangerous
    // is that a value looks harmless until you know four other things depend on
    // it. Anything not in this table is theme-owned and lives in code.
    if (path === '/settings' && method === 'GET') {
      const SETTINGS_VIEW = [
        { key: 'church_name', label: 'Church name', group: 'church-details', used: 'Map blocks · invoices', href: '/pages/details' },
        { key: 'church_address_line', label: 'Church address', group: 'church-details', used: 'Map blocks · footer · invoices', href: '/pages/details' },
        { key: 'church_address_city', label: 'City, state and ZIP', group: 'church-details', used: 'Map blocks · footer · invoices', href: '/pages/details' },
        { key: 'church_address_near', label: 'Landmark', group: 'church-details', used: 'Welcome card on the homepage', href: '/pages/details' },
        { key: 'church_phone', label: 'Office phone', group: 'church-details', used: 'Contact page · footer', href: '/pages/details' },
        { key: 'church_email', label: 'Office email', group: 'church-details', used: 'Contact page · footer', href: '/pages/details' },
        { key: 'church_service_times', label: 'Service times', group: 'church-details', used: 'Service-times blocks · sidebar layout', href: '/pages/details' },
        // Two rows for one idea, because there really are two rows and hiding
        // the draft would make this screen a half-truth about what is stored.
        // Both link to the screen that owns them rather than offering a field
        // here: a JSON blob is not something to hand-edit, and two forms
        // writing one key is two places to disagree about what it means.
        { key: 'site_appearance', label: 'Header and newsletter band', group: 'church-details', used: 'Every page — the top bar and the sign-up strip', href: '/menu/appearance' },
        { key: 'site_appearance_draft', label: 'Header appearance (draft)', group: 'church-details', used: 'The Appearance screen only — never sent to visitors', href: '/menu/appearance' },
        { key: 'give_url', label: 'Online giving link', group: 'links', used: 'Give blocks · newsletter · gym invoices', href: '/giving' },
        { key: 'social_image_url', label: 'Social preview image', group: 'church-details', used: 'The picture shown when a link to the site is shared' },
        { key: 'sermon_youtube_channel', label: 'Worship service channel', group: 'links', used: 'This week’s service on /sermons' },
        { key: 'sermon_title_filter', label: 'Only show services titled', group: 'links', used: 'Which video on that channel counts as the service' },
        { key: 'zoom_url', label: 'Zoom meeting link', group: 'links', used: 'The /zoom short link' },
        { key: 'councilfiles_url', label: 'Council files link', group: 'links', used: 'The /councilfiles short link' },
        { key: 'gym_rate_per_hour', label: 'Gym rate per hour', group: 'gym-rentals', used: 'Gym invoices · booking portal', href: '/gym-rentals' },
        { key: 'gym_hold_hours', label: 'Gym hold duration', group: 'gym-rentals', used: 'Booking portal · hold expiry', href: '/gym-rentals' },
        { key: 'gym_payment_link', label: 'Gym payment link', group: 'gym-rentals', used: 'Invoices · confirmation emails', href: '/gym-rentals' },
        { key: 'gcal_calendar_id', label: 'Gym calendar ID', group: 'gym-rentals', used: 'Confirmed bookings → Google Calendar', href: '/gym-rentals' },
        { key: 'calendar_google_ids', label: 'Calendars shown on /calendar', group: 'links', used: 'The church calendar page and its subscribe feed' },
        { key: 'gym_admin_email', label: 'Gym booking notifications', group: 'notifications', used: 'Holds, confirmations, recurring requests', href: '/gym-rentals' },
        // All seven — plus the fund ID and payment provider, which never
        // appeared on this list at all — moved to the Christmas Market
        // screen (v5.19.0), so somebody who searches Settings for "market"
        // still finds them, but "Edit" now opens the one screen that has the
        // whole event on it rather than a drawer here. See /market in
        // admin/market.js: the panel a given account sees there still
        // depends on holding settings_manage or giving_manage, exactly as
        // editing here always did — moving the field did not widen who can
        // change it.
        //
        // ⚠ `movedAway: true` because these eight are no longer site_settings
        // rows AT ALL (2026-08-18) — they are columns on the market's own
        // `site_events` row. Reading `byKey.get(s.key)` for one of these
        // would always find nothing and print "Not set" beside a warning
        // that the vendor page is running on a hardcoded fallback, which
        // would be false: the real value is set, just on the Christmas
        // Market screen instead of here.
        { key: 'market_date_label', label: 'Christmas Market day', group: 'christmas-market', used: 'The vendor application page', href: '/market', movedAway: true },
        { key: 'market_hours_label', label: 'Christmas Market hours', group: 'christmas-market', used: 'The vendor application page', href: '/market', movedAway: true },
        { key: 'market_table_fee', label: 'Christmas Market table fee ($)', group: 'christmas-market', used: 'Every price on the vendor page', href: '/market', movedAway: true },
        { key: 'market_max_tables', label: 'Most tables one vendor may take', group: 'christmas-market', used: 'The vendor application page', href: '/market', movedAway: true },
        { key: 'market_fee_percent', label: 'Card processing fee (%)', group: 'christmas-market', used: 'What a vendor is charged, alongside the fixed charge below', href: '/market', movedAway: true },
        { key: 'market_fee_fixed', label: 'Card processing fee (fixed, $)', group: 'christmas-market', used: 'What a vendor is charged, alongside the percentage above', href: '/market', movedAway: true },
        { key: 'market_coordinator_email', label: 'Christmas Market coordinator email', group: 'christmas-market', used: 'Where an application is sent, and the fallback address on the page', href: '/market', movedAway: true },
        { key: 'market_fund_id', label: 'Christmas Market fund', group: 'christmas-market', used: 'Which fund a Tithe.ly market payment lands in', href: '/market', movedAway: true },
        { key: 'market_payment_provider', label: 'Christmas Market payment provider', group: 'christmas-market', used: "Tithe.ly or the market's own Square account", href: '/market', movedAway: true },
        { key: 'turnstile_site_key', label: 'Spam check site key', group: 'notifications', used: 'Contact, prayer and signup forms', href: '/filtered' },
        { key: 'payroll_bookkeeper_email', label: 'Bookkeeper email', group: 'notifications', used: 'Where Payroll’s Email report sends to' },
      ];
      const stored = await env.DB.prepare('SELECT key, value, label, hint FROM site_settings').all().catch(() => ({ results: [] }));
      const byKey = new Map((stored.results || []).map((r) => [r.key, r]));
      const msg = url.searchParams.get('msg');
      const alertHtml = msg === 'saved' ? `<div class="alert alert-success">✓ Setting saved.</div>`
        : msg === 'settings-error' ? `<div class="alert alert-error">That is not a setting this screen manages.</div>` : '';

      const editKey = path === '/settings' ? (url.searchParams.get('edit') || '') : '';
      const editRow = SETTINGS_VIEW.find((s) => s.key === editKey) || null;

      const listRows = SETTINGS_VIEW.map((s) => {
        const row = byKey.get(s.key);
        const value = String(row?.value || '').trim();
        // Where a setting has a screen of its own — church details, giving, the
        // gym — that screen is the place to change it. Sending somebody there
        // rather than duplicating the field is what stops two forms writing the
        // same key and disagreeing about what it means.
        const editHref = s.href || `/settings?edit=${encodeURIComponent(s.key)}`;
        return {
          href: editHref,
          filter: s.group,
          search: `${s.label} ${s.key} ${value}`.toLowerCase(),
          cells: [
            primaryCell(s.label, s.used),
            s.movedAway
              ? `<span style="color:var(--tlc-muted);">Set on the Christmas Market screen</span>`
              : (value
                ? `<code style="font-size:12.5px;word-break:break-all;">${escapeHtml(value.length > 70 ? value.slice(0, 69) + '…' : value)}</code>`
                : `<span style="color:var(--tlc-muted);">Not set</span>`),
          ],
          actions: rowActions({ label: s.href ? 'Open' : 'Edit', href: editHref }),
          warn: (s.movedAway || value) ? '' : `Nothing is set, so ${s.used.split(' · ')[0].toLowerCase()} falls back to whatever is hardcoded.`,
          warnCta: { label: s.href ? 'Open' : 'Set it', href: editHref },
        };
      });

      return html(`
${sidebarShell('settings', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'settings',
    title: sectionCfg('settings').title,
    purpose: sectionCfg('settings').purpose,
    search: sectionCfg('settings').search,
    filters: filtersOf('settings'),
    columns: columnsOf('settings'),
    rows: listRows,
    noun: 'setting',
    empty: 'No settings yet.',
    note: sectionCfg('settings').note,
  })}
  ${editRow ? renderDrawer({
    key: 'setting',
    title: editRow.label,
    sub: `Read by: ${editRow.used}`,
    action: '/settings/update',
    cancelHref: '/settings',
    fields: [
      { kind: 'html', html: `<input type="hidden" name="key" value="${escapeHtml(editRow.key)}">` },
      { name: 'value', label: editRow.label, value: byKey.get(editRow.key)?.value || '',
        hint: byKey.get(editRow.key)?.hint || '' },
      { kind: 'static', label: 'Stored as', html: `<code>${escapeHtml(editRow.key)}</code>` },
    ],
  }) : ''}
</div>`, 'Settings');
    }

    // Save one setting. Only the keys this screen lists can be written — the
    // form used to accept any key in the body, so a crafted POST could set
    // something no form ever showed (AW-11).
    if (path === '/settings/update' && method === 'POST') {
      // ⚠ None of the market_* keys are here any more (v5.19.0) — all nine
      // moved to POST /market/settings, /market/fund and /market/payment in
      // admin/market.js, each gated on the specific permission that field
      // needs (settings_manage or giving_manage) rather than this screen's
      // blanket settings_manage gate. Two routes writing the same seven keys
      // is exactly the "two forms disagree about what a key means" trap this
      // allowlist exists to prevent — see market_applications_open below for
      // the identical reasoning, one release earlier.
      const SETTABLE = new Set(['church_address_line', 'church_address_city', 'church_phone', 'church_email',
        'church_service_times', 'give_url', 'zoom_url', 'councilfiles_url', 'gym_rate_per_hour', 'gym_hold_hours',
        'gym_payment_link', 'gcal_calendar_id', 'gym_admin_email', 'turnstile_site_key', 'calendar_google_ids',
        'payroll_bookkeeper_email']);
      const form = await request.formData();
      const key = String(form.get('key') || '');
      if (!SETTABLE.has(key)) {
        return new Response('', { status: 302, headers: { Location: '/settings?msg=settings-error' } });
      }
      const value = String(form.get('value') ?? '');
      const before = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first().catch(() => null);
      await env.DB.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
      await logAudit(env.DB, currentUser, 'update', 'settings', key, key, { value: before?.value ?? null }, { value });
      return new Response('', { status: 302, headers: { Location: '/settings?msg=saved' } });
    }

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

    // ⚠ The Christmas Market fund and payment-provider forms used to live
    // here (POST /giving/market-fund, /giving/market-payment). Both moved to
    // /market/fund and /market/payment (admin/market.js) — same fields, same
    // giving_manage gate, just addressed under /market now, alongside every
    // other market setting. This route intentionally does not exist anymore.

    if (path === '/giving-tiers/add' && method === 'POST') {
      const form = await request.formData();
      const amount = parseInt(form.get('amount'), 10);
      const tierUrl = (form.get('url') || '').trim();
      // A toggle posts a hidden 0 first so "off" is distinguishable from "the form
      // never showed this field". That means get() always returns something —
      // the last value is the answer, so the check is for a 1 being present.
      const on = (n) => (form.getAll(n).includes('1') ? 1 : 0);
      const isDefault = on('is_default');
      const active = on('active');
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
      // A toggle posts a hidden 0 first so "off" is distinguishable from "the form
      // never showed this field". That means get() always returns something —
      // the last value is the answer, so the check is for a 1 being present.
      const on = (n) => (form.getAll(n).includes('1') ? 1 : 0);
      const isDefault = on('is_default');
      const active = on('active');
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
      // A toggle posts a hidden 0 first so "off" is distinguishable from "the form
      // never showed this field". That means get() always returns something —
      // the last value is the answer, so the check is for a 1 being present.
      const on = (n) => (form.getAll(n).includes('1') ? 1 : 0);
      const isDefault = on('is_default');
      const active = on('active');
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
      // A toggle posts a hidden 0 first so "off" is distinguishable from "the form
      // never showed this field". That means get() always returns something —
      // the last value is the answer, so the check is for a 1 being present.
      const on = (n) => (form.getAll(n).includes('1') ? 1 : 0);
      const isDefault = on('is_default');
      const active = on('active');
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
    // Dragging a fund or an amount posts the whole resulting order, and the
    // server renumbers from scratch in steps of 10 — a diff would let a dropped
    // row leave two of them claiming one position.
    if ((path === '/giving-funds/reorder' || path === '/giving-tiers/reorder') && method === 'POST') {
      const table = path === '/giving-funds/reorder' ? 'give_funds' : 'give_amount_tiers';
      const form = await request.formData();
      let ids = [];
      try { ids = JSON.parse(form.get('order') || '[]'); } catch (_) {}
      for (let i = 0; i < ids.length; i++) {
        await env.DB.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind((i + 1) * 10, parseInt(ids[i], 10)).run();
      }
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-saved' } });
    }
    // The row's switch. Showing or hiding one is the change made most often, so
    // it is one click on the list rather than a trip through the drawer.
    if (path.startsWith('/giving-funds/toggle/') && method === 'POST') {
      const id = parseInt(path.slice('/giving-funds/toggle/'.length), 10);
      const form = await request.formData();
      await env.DB.prepare('UPDATE give_funds SET active = ? WHERE id = ?').bind(form.get('value') === '1' ? 1 : 0, id).run();
      return new Response('', { status: 302, headers: { Location: '/giving?msg=giving-updated' } });
    }

    // ── LADDER ROWS ───────────────────────────────────────────────────────
    // A ladder row is an item inside an `amounts` block on the giving page, so
    // every one of these routes is read-modify-write of that page's draft
    // block JSON. There is no ladder table and there must not be one: the row
    // and the sentence explaining it are the same record, and the page is
    // where that record lives. These routes are a second DOOR onto it, not a
    // second copy of it.
    //
    // ⚠ They write `blocks` (the draft) and never `published_blocks`. Editing
    // here is exactly as live as editing in the page editor — which is to say
    // not at all until somebody publishes — and quietly writing the live copy
    // from a side screen would mean the giving page could change without ever
    // passing through the one step that exists to make that deliberate.
    if (path.startsWith('/giving-ladder/') && method === 'POST') {
      const form = await request.formData();
      const pageRow = await env.DB.prepare('SELECT blocks FROM pages WHERE id = ?')
        .bind(GIVE_LANDING_PAGE_ID).first().catch(() => null);
      const blocks = sanitizeBlocks(parseBlocks(pageRow && pageRow.blocks));
      const blockId = path.startsWith('/giving-ladder/delete/')
        ? decodeURIComponent(path.split('/')[3] || '')
        : (url.searchParams.get('block') || form.get('block') || '');
      const target = blocks.find((b) => b.id === blockId && b.type === 'amounts');
      // A block that is not there is a stale tab or a hand-typed address, and
      // the honest answer is the screen again rather than a page of blocks
      // written from a request that was describing something else.
      if (!target) return new Response('', { status: 302, headers: { Location: '/giving?msg=ladder-missing' } });
      target.items = Array.isArray(target.items) ? target.items : [];

      if (path === '/giving-ladder/reorder') {
        let order = [];
        try { order = JSON.parse(form.get('order') || '[]'); } catch (_) {}
        // The posted order is the whole resulting list, same contract as the
        // menu and the fund panels: a diff would let a dropped row leave two
        // items claiming one position. Anything the post did not mention is
        // appended rather than dropped — losing a row to a half-delivered
        // reorder is not a trade worth making.
        const seen = new Set();
        const next = [];
        for (const raw of order) {
          const i = parseInt(raw, 10);
          if (Number.isInteger(i) && i >= 0 && i < target.items.length && !seen.has(i)) { seen.add(i); next.push(target.items[i]); }
        }
        target.items.forEach((it, i) => { if (!seen.has(i)) next.push(it); });
        target.items = next;
      } else if (path === '/giving-ladder/add' || path === '/giving-ladder/update') {
        const idx = parseInt(form.get('index') || '', 10);
        const existing = path === '/giving-ladder/update' && Number.isInteger(idx) ? target.items[idx] : null;
        if (path === '/giving-ladder/update' && !existing) {
          return new Response('', { status: 302, headers: { Location: '/giving?msg=ladder-missing' } });
        }
        const period = String(form.get('period') || '').replace(/^\/+/, '').trim();
        const words = String(form.get('body') || '').replace(/\s+/g, ' ').trim();
        // Keep the stored markup when the words have not changed, so editing
        // an amount here never silently flattens emphasis somebody added in
        // the page editor. Only a real edit to the text replaces it.
        const priorPlain = String(existing?.body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const body = existing && words === priorPlain ? existing.body : (words ? '<p>' + escapeHtml(words) + '</p>' : '');
        // Store digits when it IS a number, so the page's own formatter owns
        // the $ and the commas and there is one place that decides how an
        // amount looks. Words are stored as typed — "Any amount" is a
        // legitimate row, and normalizing it would erase it.
        const typedAmount = String(form.get('amount') || '').trim();
        const parsedAmount = parseGiveAmount(typedAmount);
        const item = { ...(existing || {}), amount: parsedAmount == null ? typedAmount : String(parsedAmount), period, body };
        if (existing) target.items[idx] = item; else target.items.push(item);
      } else if (path.startsWith('/giving-ladder/delete/')) {
        const i = parseInt(path.split('/')[4] || '', 10);
        if (Number.isInteger(i) && i >= 0 && i < target.items.length) target.items.splice(i, 1);
      }

      const json = JSON.stringify(sanitizeBlocks(blocks));
      await env.DB.prepare('UPDATE pages SET blocks = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .bind(json, new Date().toISOString(), currentUser?.username || '', GIVE_LANDING_PAGE_ID).run();
      await logAudit(env.DB, currentUser, 'update', 'page', GIVE_LANDING_PAGE_ID, 'Giving page amounts', null, { ladder: blockId });
      return new Response('', { status: 302, headers: { Location: '/giving?msg=ladder-saved' } });
    }

    if (path === '/giving' && method === 'GET') {
      const baseUrlRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'give_url'").first();
      const tiers = await env.DB.prepare('SELECT * FROM give_amount_tiers ORDER BY sort_order').all();
      const funds = await env.DB.prepare('SELECT * FROM give_funds ORDER BY sort_order').all();
      const givingLinks = await env.DB.prepare("SELECT path, url, label, category, active, give_kind FROM redirects WHERE category = 'giving' ORDER BY path").all();
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
        // Says where it went, not just that it happened. A ladder edit lands
        // in the giving page's draft, and somebody who reads this as "done"
        // and goes to check the live page will find it unchanged.
        : msg === 'ladder-saved'   ? `<div class="alert alert-success">✓ Saved to the giving page's draft. Publish the page for it to reach givers.</div>`
        : msg === 'ladder-missing' ? `<div class="alert alert-info">That ladder is no longer on the giving page — nothing was changed.</div>`
        : msg === 'redirect-added'   ? `<div class="alert alert-success">✓ Link added.</div>`
        : msg === 'redirect-updated' ? `<div class="alert alert-success">✓ Link updated.</div>`
        : msg === 'redirect-deleted' ? `<div class="alert alert-info">Link deleted.</div>`
        : msg === 'giving-error' || msg === 'redirect-error' ? `<div class="alert alert-error">Check the fields — a valid amount and any URLs entered must be http(s) links.</div>` : '';

      // Funds and Amount Tiers sit side by side, because they are the two
      // halves of one question — what somebody can give to, and how much —
      // and reading them together is the only way to see what the page
      // actually offers. Each row is a grip, a name, a state and one action;
      // the fields live in a drawer rather than in the row, so a list of eight
      // funds does not become a wall of forty inputs.
      const defaultFund = funds.results.find((f) => f.is_default);
      const fundListHtml = panelList({
        id: 'give-funds',
        reorderAction: '/giving-funds/reorder',
        empty: 'No funds yet — the giving page shows no fund selector until at least one exists.',
        rows: funds.results.map((f) => ({
          id: f.id,
          name: f.name || 'Untitled fund',
          sub: f.is_default ? 'Default when nobody chooses'
            : (f.tithely_fund_id ? 'Restricted' : 'Uses the fund in the base link'),
          state: toggleCell(`/giving-funds/toggle/${f.id}`, !!f.active, `Show the ${f.name || 'untitled'} fund`),
          editHref: `/giving?fund=${f.id}`,
        })),
      });

      const defaultTier = tiers.results.find((t) => t.is_default);
      const tierListHtml = panelList({
        id: 'give-tiers',
        reorderAction: '/giving-tiers/reorder',
        empty: 'No amounts yet — the giving page falls back to the base Tithe.ly link for every gift.',
        rows: tiers.results.map((t) => ({
          id: t.id,
          name: `$${t.amount}`,
          mid: t.is_default ? 'Default' : (t.url ? 'Own link' : '—'),
          state: t.active ? statusPill('good', 'Showing') : statusPill('plain', 'Hidden'),
          action: `<a class="tlc-edit" href="/giving?tier=${t.id}">Edit</a>`,
        })),
      });

      // Exactly one of each should be the default. Nought or two is a real
      // fault on the live page — with none, nothing is preselected; with two,
      // which one wins depends on row order — so it is said here rather than
      // left for somebody to notice on their phone.
      const defaultWarning = (label, list, href) => {
        const n = list.filter((r) => r.is_default && r.active).length;
        if (n === 1) return '';
        return `<p class="tlc-note" style="margin:10px 0 0;"><span class="tlc-note-mark">▲</span><span>${
          n === 0
            ? `No ${label} is marked Default, so the giving page preselects nothing.`
            : `${n} ${label}s are marked Default. Only one can win, and which one depends on the order above.`
        } <a href="${href}" style="color:var(--tlc-blue);">Fix it</a></span></p>`;
      };

      // ── THE LADDERS ────────────────────────────────────────────────────────
      // Dinger, 2026-08-06: "on the giving settings page, i can only edit the
      // weekly giving tiers and not the larger commitment amounts" — then,
      // looking at the panel built in answer to it: "here you now just are
      // showing what the amounts are but no way to EDIT them."
      //
      // ⚠ The first answer was to SHOW the ladders read-only and link to the
      // page editor, on the reasoning that each row carries its own sentence
      // about what that gift pays for, so a second form here would be two
      // places that disagree about what $5,000 a year buys. He overruled it,
      // and the correct reading of that is not "he wants a duplicate": it is
      // that a screen called Giving, which already edits every other amount on
      // the page, cannot be the one place these amounts are merely displayed.
      //
      // So they are edited here — and the duplication worry is answered by
      // where the words are STORED rather than by refusing the control. There
      // is still exactly one copy of a ladder row: the block on the page.
      // These panels read and write that same block, so this screen and the
      // page editor are two doors into one record, not two records.
      // ⚠ Same rule as the Pages list: a failed read must not render as "there
      // are no ladders". That sentence sends somebody to the page editor to
      // add a block that is already there, and if they do, they get a second
      // copy of the church's giving amounts.
      let ladderReadError = '';
      const givePageRow = await env.DB.prepare('SELECT blocks, published_blocks FROM pages WHERE id = ?')
        .bind(GIVE_LANDING_PAGE_ID).first()
        .catch((e) => { ladderReadError = (e && e.message) || String(e); return null; });
      if (ladderReadError) console.error('Giving ladder read failed:', ladderReadError);
      const ladderBlocks = sanitizeBlocks(parseBlocks(givePageRow && givePageRow.blocks))
        .filter((b) => b.type === 'amounts');
      const givePagePublished = sanitizeBlocks(parseBlocks(givePageRow && givePageRow.published_blocks)).length > 0;
      const plainText = (s) => escapeHtml(String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
      const ladderTitle = (b) => b.subtitle || b.title || b.eyebrow || 'Amount ladder';
      const ladderHtml = ladderReadError
        ? `<div class="alert alert-error"><strong>The giving page could not be read.</strong> The amounts below are missing because of a fault, not because the page has none — do not add an Amount ladder block to replace them, or the page will end up with two. Tell whoever maintains the site, and give them this: <code>${escapeHtml(ladderReadError)}</code></div>`
        : ladderBlocks.length === 0
        ? `<div style="font-size:13px;color:var(--gray);padding:12px 0;">The giving page has no amount ladders on it. Add an <strong>Amount ladder</strong> block in <a href="/giving/page" style="color:var(--tlc-blue);">the page editor</a>.</div>`
        : ladderBlocks.map((b) => panel(ladderTitle(b),
            panelList({
              id: 'ladder-' + b.id,
              reorderAction: '/giving-ladder/reorder?block=' + encodeURIComponent(b.id),
              empty: 'No amounts on this ladder yet.',
              rows: (b.items || []).map((it, i) => {
                const amt = parseGiveAmount(it.amount);
                const gift = giftForPeriod(it.amount, it.period);
                const period = String(it.period || '').replace(/^\/+/, '');
                return {
                  id: String(i),
                  nameHtml: `${amt == null ? plainText(it.amount) : '$' + escapeHtml(fmtGiveAmount(amt))}${
                    period ? `<span style="font-weight:400;color:var(--tlc-muted);">/${escapeHtml(period)}</span>` : ''}`,
                  sub: String(it.body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
                  // What the BUTTON asks for, which for a /year row is not the
                  // number printed beside it. This column is the whole reason
                  // somebody would open this screen rather than the editor.
                  mid: gift ? giveButtonLabel(gift) : 'No button — not a number',
                  action: `<a class="tlc-edit" href="/giving?row=${encodeURIComponent(b.id)}:${i}">Edit</a>`,
                };
              }),
            }),
            { right: `<a class="tlc-edit" href="/giving?row=${encodeURIComponent(b.id)}:new">+ Add amount</a>`, pad: false }
          )).join('');

      const editFund = url.searchParams.get('fund');
      const editTier = url.searchParams.get('tier');
      // "?row=<blockId>:<index>" — a ladder row is identified by the block it
      // lives on and its position in it, because it has no id of its own: it
      // is an item inside a block's JSON, not a database row. `:new` appends.
      const editRow = url.searchParams.get('row');
      const rowBlockId = editRow ? editRow.slice(0, editRow.lastIndexOf(':')) : '';
      const rowIdxRaw = editRow ? editRow.slice(editRow.lastIndexOf(':') + 1) : '';
      const rowIndex = /^\d+$/.test(rowIdxRaw) ? Number(rowIdxRaw) : -1;
      const rowBlock = editRow ? ladderBlocks.find((b) => b.id === rowBlockId) : null;
      const rowRec = rowBlock && rowIndex >= 0 ? (rowBlock.items || [])[rowIndex] : null;
      // The description is rich text on the page and a plain textarea here.
      // Stripping the markup to edit it and re-wrapping it on save would throw
      // away any emphasis somebody had added in the editor, so the textarea
      // shows the words and the SAVE keeps the original markup when the words
      // are unchanged — see /giving-ladder/update.
      const plainRowBody = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      // Digits for editing. A stored "$5,000" is shown as 5000; a row written
      // in words ("Any amount") is left exactly as it is, since stripping it
      // to nothing would delete somebody's copy on the way into the form.
      const plainRowAmount = (v) => (parseGiveAmount(v) == null ? String(v == null ? '' : v) : String(parseGiveAmount(v)));
      const fundRec = editFund && editFund !== 'new' ? funds.results.find((f) => String(f.id) === editFund) : null;
      const tierRec = editTier && editTier !== 'new' ? tiers.results.find((t) => String(t.id) === editTier) : null;
      const givingRowsHtml = givingLinks.results.length === 0
        ? `<div style="font-size:13px;color:var(--gray);padding:12px 0;">No vendor/market links yet.</div>`
        : givingLinks.results.map(r => `
          <form method="POST" action="/redirects/update" style="display:grid;grid-template-columns:1fr 2fr 1.3fr auto auto auto auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
            <input type="hidden" name="original_path" value="${r.path.replace(/"/g,'&quot;')}">
            <input type="hidden" name="category" value="giving">
            <input type="text" name="path" value="${r.path.replace(/"/g,'&quot;')}" style="font-family:var(--mono,monospace);font-size:13px;">
            <input type="url" name="url" value="${(r.url||'').replace(/"/g,'&quot;')}" style="font-size:13px;">
            <input type="text" name="label" value="${(r.label||'').replace(/"/g,'&quot;')}" placeholder="e.g. Smith Catering — Fall Festival deposit" style="font-size:13px;">
            <select name="give_kind" style="font-size:12px;padding:6px 8px;">
              <option value="payment"${(r.give_kind || 'payment') === 'payment' ? ' selected' : ''}>Payment</option>
              <option value="gift"${r.give_kind === 'gift' ? ' selected' : ''}>Gift</option>
            </select>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray);white-space:nowrap;">
              <input type="checkbox" name="active" value="1" ${r.active ? 'checked' : ''}> Active
            </label>
            <button type="submit" class="btn btn-sm btn-secondary">Save</button>
            <button type="submit" formaction="/redirects/delete/${encodeURIComponent(r.path)}" formnovalidate class="btn btn-sm btn-danger" onclick="return confirm('Delete /${r.path.replace(/'/g,"\\'")}?')">Delete</button>
          </form>`).join('');

      return html(`
${sidebarShell('giving', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  <h1 class="tlc-title">${escapeHtml(sectionCfg('giving').title)}</h1>
  <p class="tlc-purpose" style="margin:6px 0 18px;">${escapeHtml(sectionCfg('giving').purpose)}</p>

  <!-- ⚠ Both this branch and #400 arrived at the same finding independently:
       this panel claimed the two giving pages were one set of blocks shown in
       two places, and carried a switch offering to keep them in step. Neither
       was true, and the switch wrote a setting nothing in the codebase ever
       read. #400 corrected the claim while give.timothystl.org was still
       rendered from code; that page is a block-editor page as of v4.25.0, so
       its half is corrected again here. Both are now editable in the same
       editor — what stays true, and is the point of the panel, is that they
       are separate pages doing separate jobs.

       This comment deliberately paraphrases the removed wording rather than
       quoting it — an HTML comment ships to the browser, so a quoted label
       puts a second copy of that string on the page and defeats the test
       asserting it is gone. That is not hypothetical: it happened while
       writing this. -->
  <div class="tlc-panel" style="margin-bottom:18px;">
    <div class="tlc-panel-head">
      <span class="tlc-panel-title">The two giving pages</span>
      <span class="tlc-panel-right">Separate pages · separate jobs</span>
    </div>
    <div class="tlc-panel-body">
      <div class="tlc-give-surfaces">
        <div class="tlc-give-surface">
          <span class="tlc-give-badge">The transaction</span>
          <span class="tlc-give-addr">give.timothystl.org</span>
          <p class="tlc-give-note">The transaction: amounts, funds, and the button. One job. This is the address on the plate cards, the NFC tap, and anything printed. Its amounts, funds and Tithe.ly link are edited on this screen; the wording and layout around them are a block page.</p>
          <div class="tlc-give-btns">
            <a class="tlc-action" href="/giving/page">Edit this page</a>
            <a class="tlc-tap-btn" href="https://give.timothystl.org" target="_blank" rel="noopener">View live</a>
          </div>
        </div>
        <div class="tlc-give-surface">
          <span class="tlc-give-badge">How to give</span>
          <span class="tlc-give-addr">timothystl.org/give</span>
          <p class="tlc-give-note">Where somebody decides <em>how</em> to give — the offering plate, bank bill pay, Thrivent, an IRA distribution, planned giving. Its Give Online button hands off to the page on the left.</p>
          <div class="tlc-give-btns">
            <a class="tlc-action" href="/pages/give/edit">Edit this page</a>
            <a class="tlc-tap-btn" href="https://timothystl.org/give" target="_blank" rel="noopener">View live</a>
          </div>
        </div>
      </div>
      <div class="tlc-give-sync">
        <span>These two are edited separately, and deliberately: one is the transaction, the other is the explanation. Neither stores a copy of the Tithe.ly link — both read it at the moment somebody loads them — so changing an amount, a fund or the link below changes it on <strong>both</strong>.</span>
      </div>
    </div>
  </div>

  <p class="tlc-note" style="margin:0 0 18px;"><span class="tlc-note-mark">◆</span><span>Every link below is tagged <strong>Gift</strong> or <strong>Payment</strong>. A Gift is receipted as a donation on somebody&rsquo;s year-end statement; a Payment — gym rent, a registration fee, a vendor invoice — is not. Getting that wrong puts a non-donation on a tax document, which is why new links default to Payment.</span></p>
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
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </div>
  </form>

  <p class="tlc-note" style="margin:16px 0 0;"><span class="tlc-note-mark">◆</span><span>The Christmas Market's own fund and payment method — Tithe.ly or its own Square account — moved to the <a href="/market" style="color:var(--tlc-blue);">Christmas Market screen</a>, alongside the market's date, fee and coordinator email. It still needs the same <code>giving_manage</code> permission as everything else on this page; it just no longer lives on this page.</span></p>

  <div class="tlc-give-cols" style="margin-top:20px;">
    ${panel('Funds', fundListHtml + defaultWarning('fund', funds.results, '/giving?fund=' + (defaultFund?.id || (funds.results[0]?.id ?? 'new'))), {
      right: '<a class="tlc-edit" href="/giving?fund=new">+ Add fund</a>', pad: false })}
    ${panel('Amount tiers', tierListHtml + defaultWarning('amount', tiers.results, '/giving?tier=' + (defaultTier?.id || (tiers.results[0]?.id ?? 'new'))), {
      right: '<a class="tlc-edit" href="/giving?tier=new">+ Add amount</a>', pad: false })}
  </div>

  <p class="tlc-note" style="margin:14px 0 0;"><span class="tlc-note-mark">◆</span><span>Every amount builds its own Tithe.ly link from the base link above, with the amount appended in cents. You never need to make a link per amount — the override field in the drawer is only for an amount that should go somewhere else entirely, such as a different fund.</span></p>

  <div class="card" style="margin-top:20px;">
    <div class="card-title">Amount ladders on the giving page</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:8px;">The <strong>$X a week</strong> and <strong>$X a year</strong> rows — the ministry ladder and the larger commitments. Edit an amount, its period or the sentence beside it here, or drag a row to reorder it. The right-hand column is <strong>what that row's button will actually ask for</strong>, which for a yearly commitment is a month of it. These are rows on the giving page rather than settings of their own, so the same rows are also editable in <a href="/giving/page" style="color:var(--tlc-blue);">the page editor</a> — one record, two doors onto it.</div>
    ${ladderHtml}
    <div style="font-size:13px;color:var(--gray);margin-top:14px;line-height:1.6;">
      <strong>A year is asked for a month at a time.</strong> A row written as <code>/year</code> gets a button for a twelfth of it — $5,000 a year becomes <strong>Give $416/month</strong> — because nobody presses a button for a single $5,000 charge. Write the period as <code>week</code> or <code>month</code> and the button asks for exactly what the row says. Tithe.ly cannot be told from a link that a gift repeats, so the page tells the giver to choose Monthly on the form.
    </div>
    ${givePagePublished ? '' : `<p class="tlc-note" style="margin:14px 0 0;"><span class="tlc-note-mark">▲</span><span><strong>give.timothystl.org is still showing the built-in version of this page.</strong> Changes made in the editor are saved as a draft and will not appear to anybody until you open it and press <strong>Publish</strong>. <a href="/giving/page" style="color:var(--tlc-blue);">Open the editor</a></span></p>`}
  </div>

  <div class="card" style="margin-top:20px;">
    <div class="card-title">Giving &amp; payment links</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">One-off payment links — a Christmas Market vendor deposit, a rental, anything one-time. Paste in a prefilled link from either <strong>Tithe.ly</strong> (dashboard → Giving Form → Create Custom Link) or <strong>Square</strong> (Square's own Checkout link tool) — any http(s) link works. Give it a short slug and a label, then share <code>timothystl.org/&lt;slug&gt;</code>. Uncheck Active to retire an old one without deleting the record. (Gym rental invoices already email their own Tithe.ly pay link automatically — nothing to add here for those.)</div>
    ${givingRowsHtml}
    <form method="POST" action="/redirects/add" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
      <input type="hidden" name="category" value="giving">
      <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sage);margin-bottom:12px;">Add new link</div>
      <div style="display:grid;grid-template-columns:1fr 2fr 1.3fr 1.2fr auto;gap:12px;align-items:end;">
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
        <div class="form-group" style="margin:0;">
          <label>Gift or payment</label>
          <select name="give_kind">
            <option value="payment">Payment — not receipted</option>
            <option value="gift">Gift — receipted as a donation</option>
          </select>
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--charcoal);white-space:nowrap;padding-bottom:10px;">
          <input type="checkbox" name="active" value="1" checked> Active
        </label>
      </div>
      <div style="margin-top:10px;font-size:13px;line-height:1.6;color:var(--gray);">
        <strong>Gift</strong> money is receipted as a donation on somebody's year-end giving statement.
        <strong>Payment</strong> money — gym rent, a registration fee, a vendor invoice — is not.
        Tagging a payment as a gift would put a non-donation on a tax statement, so this defaults to Payment and has to be changed on purpose.
      </div>
      <div class="btn-row" style="margin-top:12px;">
        <button type="submit" class="btn btn-primary">Add link</button>
      </div>
    </form>
  </div>
  ${editRow ? renderDrawer({
    key: 'give-ladder-row',
    title: rowRec ? (parseGiveAmount(rowRec.amount) == null ? String(rowRec.amount || 'Amount') : '$' + fmtGiveAmount(parseGiveAmount(rowRec.amount))) : 'New amount',
    sub: rowBlock ? `A row on the ${ladderTitle(rowBlock)} ladder, on the giving page.` : 'A row on a giving-page ladder.',
    action: rowRec ? '/giving-ladder/update' : '/giving-ladder/add',
    cancelHref: '/giving',
    saveLabel: rowRec ? 'Save changes' : 'Add amount',
    deleteAction: rowRec ? `/giving-ladder/delete/${encodeURIComponent(rowBlockId)}/${rowIndex}` : '',
    deleteConfirm: rowRec ? 'Delete this row from the ladder? The words explaining what it pays for go with it.' : '',
    fields: [
      { kind: 'html', html: `<input type="hidden" name="block" value="${escapeHtml(rowBlockId)}">` +
        (rowRec ? `<input type="hidden" name="index" value="${rowIndex}">` : '') },
      // ⚠ Shown as digits whatever is stored. Some rows on the live draft were
      // seeded by an older version that stored the formatted string ("$5,000"),
      // and putting that straight into a field whose hint says "digits only"
      // is a screen arguing with itself. The save normalizes too, so editing
      // any row quietly cleans it up.
      { name: 'amount', label: 'Amount', value: rowRec ? plainRowAmount(rowRec.amount) : '', required: true, placeholder: '5000',
        hint: 'Digits only — the $ and the commas are added for you. Words are allowed (“Any amount”), and a row that is not a number simply gets no Give button rather than one pointing at nothing.' },
      // ⚠ These chips used to be labeled "Given every", and that wording is
      // what made this drawer confusing: "given every month" reads as how the
      // giver PAYS, so picking Month on a $5,000 row looks like it should
      // produce the $416/month button when it would really ask for $5,000 a
      // month. The field has always meant "the amount above is per ___" — the
      // unit the row is written in, and what the page prints beside it. It now
      // says so, and the line underneath states the outcome outright so the
      // meaning never has to be inferred from a label at all.
      { kind: 'chips', name: 'period', label: 'The amount above is per', value: String(rowRec?.period || 'week').replace(/^\/+/, ''),
        options: [
          { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' }, { value: '', label: 'One gift' },
        ] },
      // The calculation, done for you and updated as you type. A leadership
      // row promises one number and its button asks for another, and working
      // that out in your head is exactly what somebody should not have to do
      // on the screen that sets what a giver is charged.
      { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">On the page</label>
        <div class="tlc-static" id="ladder-preview" aria-live="polite">&mdash;</div>
        <p class="tlc-hint">A yearly commitment is asked for a month at a time, because nobody presses a one-off $5,000. Every other period asks for exactly what is typed above.</p></div>` },
      { kind: 'textarea', name: 'body', label: 'What this gift pays for', value: plainRowBody(rowRec?.body), rows: 3,
        placeholder: 'Sends a youth to the National Youth Gathering.',
        hint: 'The sentence printed beside the amount. This is why a ladder row is not a setting — it is the words that make the number mean something.' },
    ],
  }) : (editFund || editTier) ? renderDrawer(editFund ? {
    key: 'give-fund',
    title: fundRec ? fundRec.name || 'Untitled fund' : 'New fund',
    sub: 'A fund is one of the choices in the "Give to" dropdown on the giving page.',
    action: fundRec ? '/giving-funds/update' : '/giving-funds/add',
    cancelHref: '/giving',
    saveLabel: fundRec ? 'Save changes' : 'Add fund',
    deleteAction: fundRec ? `/giving-funds/delete/${fundRec.id}` : '',
    deleteConfirm: fundRec ? `Delete the ${fundRec.name || 'untitled'} fund? Anybody mid-gift on the page will simply see one fewer choice.` : '',
    fields: [
      ...(fundRec ? [{ kind: 'html', html: `<input type="hidden" name="id" value="${fundRec.id}">` }] : []),
      { name: 'name', label: 'Fund name', value: fundRec?.name || '', required: true, placeholder: 'Building Fund' },
      ...(chmsSuggestionsHtml && !fundRec ? [{ kind: 'html', html: chmsSuggestionsHtml }] : []),
      { name: 'tithely_fund_id', label: 'Tithe.ly fund ID', value: fundRec?.tithely_fund_id || '',
        placeholder: 'Leave blank to use the base link’s own fund',
        hint: 'Generate a link for this fund in Tithe.ly and copy the fundId out of the URL. Blank means whatever fund is already in the base link — which is the normal setup for a plain General Fund row.' },
      { kind: 'toggle', name: 'is_default', label: 'Selected by default', value: !!fundRec?.is_default,
        hint: 'Exactly one fund should be the default — it is what the page has chosen before anybody touches it.' },
      { kind: 'toggle', name: 'active', label: 'Offered on the giving page', value: fundRec ? !!fundRec.active : true },
    ],
  } : {
    key: 'give-tier',
    title: tierRec ? `$${tierRec.amount}` : 'New amount',
    sub: 'One of the amount buttons on the giving page.',
    action: tierRec ? '/giving-tiers/update' : '/giving-tiers/add',
    cancelHref: '/giving',
    saveLabel: tierRec ? 'Save changes' : 'Add amount',
    deleteAction: tierRec ? `/giving-tiers/delete/${tierRec.id}` : '',
    deleteConfirm: tierRec ? `Delete the $${tierRec.amount} button? Givers can still type any amount they like.` : '',
    fields: [
      ...(tierRec ? [{ kind: 'html', html: `<input type="hidden" name="id" value="${tierRec.id}">` }] : []),
      { kind: 'number', name: 'amount', label: 'Amount ($)', value: tierRec?.amount ?? '', min: 1 },
      { name: 'url', type: 'url', label: 'Override link', value: tierRec?.url || '',
        placeholder: 'Leave blank — this is usually not needed',
        hint: 'Blank is right almost always: the link is built from the base link with this amount appended. Fill it in only if this one amount should go somewhere else entirely.' },
      { kind: 'toggle', name: 'is_default', label: 'Preselected', value: !!tierRec?.is_default,
        hint: 'Exactly one amount should be preselected when the page loads.' },
      { kind: 'toggle', name: 'active', label: 'Showing on the giving page', value: tierRec ? !!tierRec.active : true },
    ],
  }) : ''}
${editRow ? `<script>
${GIVE_PERIOD_JS}
(function(){
  var form = document.getElementById('drawer-give-ladder-row') || document;
  var amt = form.querySelector('input[name=amount]');
  var out = document.getElementById('ladder-preview');
  if (!amt || !out) return;
  function periodNow(){
    var r = form.querySelector('input[name=period]:checked');
    return r ? r.value : '';
  }
  function draw(){
    var v = amt.value, p = periodNow();
    var n = tlcParseAmount(v);
    // The row exactly as the page will print it, then what the button will
    // ask for. Both, because the whole confusion this replaces is that those
    // are two different numbers on a yearly row.
    var reads = (n == null ? (v || '—') : '$' + tlcFmtAmount(n)) + (p ? '/' + p : '');
    var gift = tlcGiftForPeriod(v, p);
    out.textContent = gift
      ? 'Reads ' + reads + ' \\u2014 button: ' + tlcGiveButtonLabel(gift)
      : 'Reads ' + reads + ' \\u2014 no button, because that is not an amount';
  }
  amt.addEventListener('input', draw);
  form.addEventListener('change', function(e){ if (e.target.name === 'period') draw(); });
  draw();
})();
</script>` : ''}
</div>`, 'Giving');
    }

    // ── "EDIT THIS PAGE" OPENS THE EDITOR NOW ────────────────────────────
    // It used to render a card explaining that the giving page was not a
    // block-editor page and listing where its parts really lived. It is one
    // now, so this redirects into the editor rather than describing it.
    //
    // A redirect rather than a direct link from the panel, because the page's
    // id is this Worker's business and not something to spell out in markup in
    // two places. It also keeps /giving/page working as an address staff may
    // have bookmarked from the version that was a screen.
    //
    // ⚠ The page needs both permissions to be useful and they are checked in
    // that order: `giving_manage` is what gets somebody to this screen, but
    // the editor itself is gated on `pages_edit`, so somebody holding only the
    // first would arrive at a 403 with no explanation. Say it here instead.
    if (path === '/giving/page' && method === 'GET') {
      if (!hasPermission(currentUser, 'giving_manage')) return new Response('Access denied.', { status: 403 });
      if (!hasPermission(currentUser, 'pages_edit')) {
        return html(`
${sidebarShell('giving', currentUser, `<a href="/giving">← Giving</a>`, await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">The giving page</div>
  <div class="alert alert-info">The giving page is edited in the page editor, which needs the <code>pages_edit</code> permission. You can change the amounts, the funds and the Tithe.ly link on the <a href="/giving">Giving screen</a> without it — ask an admin for page access to change the wording and the layout.</div>
</div>`, 'The giving page');
      }
      return new Response('', { status: 302, headers: { Location: `/pages/${GIVE_LANDING_PAGE_ID}/edit` } });
    }

    // ── USER MANAGEMENT ────────────────────────────────────────
    if (path.startsWith('/users') && !hasPermission(currentUser, 'users_manage')) {
      return new Response('Access denied.', { status: 403 });
    }

    if (path === '/users' && method === 'GET') {
      const users = await env.DB.prepare('SELECT id, username, email, permissions, last_login, active, created_at FROM users ORDER BY created_at').all();
      const msg = url.searchParams.get('msg');
      const alertHtml = msg === 'created' ? `<div class="alert alert-success">✓ User created.</div>`
        : msg === 'updated' ? `<div class="alert alert-success">✓ User updated. Their password is unchanged — that is set on its own screen.</div>`
        : msg === 'password' ? `<div class="alert alert-success">✓ Password set. They have been signed out of the admin everywhere and sign back in with the new one.</div>`
        : msg === 'deleted' ? `<div class="alert alert-info">User deleted.</div>` : '';

      const accessLabel = (perms) => {
        if (perms.length === 0) return 'No access';
        if (ALL_PERMISSIONS.every((p) => perms.includes(p))) return 'Full access';
        if (perms.length === 1) return `${PERMISSIONS[perms[0]] || perms[0]} only`;
        return `Custom access (${perms.length} of ${ALL_PERMISSIONS.length})`;
      };

      const listRows = users.results.map((u) => {
        let perms = [];
        try { perms = JSON.parse(u.permissions || '[]'); } catch (_) { perms = []; }
        const initials = (u.username || '?').slice(0, 2).toUpperCase();
        const lastLogin = u.last_login ? u.last_login.split('T')[0] : 'Never';
        return {
          href: `/users/edit/${u.id}`,
          filter: u.active ? 'active' : 'disabled',
          search: `${u.username} ${u.email || ''} ${perms.join(' ')}`.toLowerCase(),
          cells: [
            primaryCell(u.username, u.email || 'No email on file', { icon: escapeHtml(initials) }),
            `<span title="${escapeHtml(perms.map((p) => PERMISSIONS[p] || p).join(', ') || 'None')}">${escapeHtml(accessLabel(perms))}</span>`,
            escapeHtml(lastLogin),
            u.active ? statusPill('good', 'Active') : statusPill('plain', 'Disabled'),
          ],
          actions: `<a class="tlc-edit" href="/users/edit/${u.id}">Edit access</a>`,
          // Without an email there is no way to send a reset link, so the
          // account is one forgotten password away from being unusable.
          warn: u.email ? '' : `${u.username} has no email address, so a forgotten password cannot be reset.`,
          warnCta: u.email ? null : { label: 'Add one', href: `/users/edit/${u.id}` },
        };
      });

      return html(`
${sidebarShell('users', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'users',
    title: sectionCfg('users').title,
    purpose: sectionCfg('users').purpose,
    action: { label: sectionCfg('users').action, href: '/users/new' },
    search: sectionCfg('users').search,
    filters: filtersOf('users'),
    columns: columnsOf('users'),
    rows: listRows,
    noun: 'user',
    empty: 'No users yet.',
    note: sectionCfg('users').note,
  })}
</div>`, 'Users');
    }

    if (path === '/users/new' && method === 'GET') {
      return html(`
${sidebarShell('users', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">New user</div>
  <div class="page-sub">Who can get into this admin, and exactly what they can reach. Presets are shortcuts — the checkboxes are the truth.</div>
  <form method="POST" action="/users/new">
    <div class="card">
      <div class="form-group"><label>Username <span style="color:#B85C3A;">*</span></label><input type="text" name="username" required autocomplete="off"></div>
      <div class="form-group"><label>Email <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— used for password reset</span></label><input type="email" name="email" autocomplete="email" placeholder="user@timothystl.org"></div>
      <div class="form-group"><label>Password <span style="color:#B85C3A;">*</span></label><input type="password" name="password" autocomplete="new-password" placeholder="Min 8 characters"></div>
      <div class="form-group"><label>Confirm password</label><input type="password" name="password2" autocomplete="new-password"></div>
      <div class="form-group"><label>Permissions</label>${permissionCheckboxes([], await eventCoordinatorPermissions(env))}</div>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Create user</button>
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
      // Dynamic per-event keys (event_<id>_manage) never live in the static
      // PERMISSIONS object, so they are read off the event list itself —
      // the same list permissionCheckboxes() was handed to draw their boxes.
      const dynamicPermKeys = Object.keys(await eventCoordinatorPermissions(env));
      const perms = [...Object.keys(PERMISSIONS), ...dynamicPermKeys].filter(k => form.get('perm_' + k) === '1');
      const hash = await hashPassword(password);
      await env.DB.prepare('INSERT INTO users (username, password_hash, permissions, created_at, active, email) VALUES (?, ?, ?, ?, 1, ?)')
        .bind(username, hash, JSON.stringify(perms), new Date().toISOString(), email).run();
      return new Response('', { status: 302, headers: { Location: '/users?msg=created' } });
    }

    // ⚠ The password screen has to be matched BEFORE the two /users/edit/
    // handlers below it. Both used to read the id off the last path segment,
    // which would take the word "password" for an account id and 404.
    const userPwPath = path.match(/^\/users\/edit\/(\d+)\/password$/);
    // Renaming an account is its own screen for exactly the reason the password
    // is: a password manager fills a form's USERNAME box on sight, and marking
    // the input `readonly` does not stop an extension — only the browser's own
    // autofill. So opening katig's permissions and pressing Save posted
    // `username=admin`, which collides with the real admin account
    // (users.username is UNIQUE) and threw. Same shape of fix as the password:
    // the field is not on the access form at all, so there is nothing to fill.
    const userNamePath = path.match(/^\/users\/edit\/(\d+)\/username$/);
    const userEditPath = path.match(/^\/users\/edit\/(\d+)$/);

    // A password is changed here and nowhere else. It used to be two fields on
    // the access screen, and a browser password manager fills a form's username
    // box whenever it fills a password box beside it — so opening someone's
    // permissions and pressing Save silently rewrote both their name and their
    // password. With no password field on that form there is nothing for a
    // manager to fill, which is the actual fix rather than another autocomplete
    // hint browsers are free to ignore.
    if (userPwPath && method === 'GET') {
      const u = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(userPwPath[1]).first();
      if (!u) return new Response('Not found', { status: 404 });
      return html(`
${sidebarShell('users', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Set a password for ${escapeHtml(u.username)}</div>
  <div class="page-sub">The one screen that changes a password. Editing someone's access never touches it, so nothing your browser fills in on that screen can lock them out.</div>
  <form method="POST" action="/users/edit/${u.id}/password" autocomplete="off">
    <div class="card">
      <div class="form-group"><label>New password <span style="color:#B85C3A;">*</span></label><input type="password" name="password" required autocomplete="new-password" placeholder="Min 8 characters"></div>
      <div class="form-group"><label>Confirm new password <span style="color:#B85C3A;">*</span></label><input type="password" name="password2" required autocomplete="new-password"></div>
      <p class="tlc-hint">Saving signs ${escapeHtml(u.username)} out of the admin everywhere. They sign back in with the new password.</p>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Set password</button>
      <a href="/users/edit/${u.id}" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, 'Set password');
    }

    if (userPwPath && method === 'POST') {
      if (!hasPermission(currentUser, 'users_manage')) return new Response('Access denied.', { status: 403 });
      const uid = userPwPath[1];
      const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
      if (!target) return new Response('Not found', { status: 404 });
      const form = await request.formData();
      const password = form.get('password') || '';
      const password2 = form.get('password2') || '';
      if (!password) return new Response('Password required.', { status: 400 });
      if (password !== password2) return new Response('Passwords do not match.', { status: 400 });
      if (password.length < 8) return new Response('Password must be at least 8 characters.', { status: 400 });
      const hash = await hashPassword(password);
      await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, uid).run();
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run();
      return new Response('', { status: 302, headers: { Location: '/users?msg=password' } });
    }

    // ── Rename an account ──
    // The one place a username changes. It carries no password field, so a
    // manager has nothing to anchor on, and the name it writes is the one
    // somebody typed on a screen whose entire subject is the name.
    if (userNamePath && method === 'GET') {
      const u = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(userNamePath[1]).first();
      if (!u) return new Response('Not found', { status: 404 });
      const err = url.searchParams.get('err');
      const errHtml = err === 'taken'
        ? `<div class="alert alert-error">That username already belongs to another account. Pick a different one.</div>`
        : err === 'blank'
          ? `<div class="alert alert-error">A username cannot be blank.</div>` : '';
      return html(`
${sidebarShell('users', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">Rename ${escapeHtml(u.username)}</div>
  <div class="page-sub">Changes who this person signs in as. It does not change what they can reach, and it does not sign them out.</div>
  ${errHtml}
  <form method="POST" action="/users/edit/${u.id}/username" autocomplete="off">
    <div class="card">
      <div class="form-group">
        <label>Username</label>
        <input type="text" name="username" value="${escapeHtml(u.username || '')}" required autocomplete="off">
        <p class="tlc-hint">What they type to sign in. Their password and permissions are unchanged.</p>
      </div>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Save the new name</button>
      <a href="/users/edit/${u.id}" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, 'Rename account');
    }

    if (userNamePath && method === 'POST') {
      if (!hasPermission(currentUser, 'users_manage')) return new Response('Access denied.', { status: 403 });
      const uid = userNamePath[1];
      const form = await request.formData();
      const username = (form.get('username') || '').trim();
      if (!username) return new Response('', { status: 302, headers: { Location: `/users/edit/${uid}/username?err=blank` } });
      // ⚠ Checked, not left to the UNIQUE constraint. An unhandled constraint
      // error reaches the top-level catch and shows "Something went wrong" with
      // a reference number — which tells somebody renaming an account nothing
      // at all about the name being taken.
      const clash = await env.DB.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id <> ?')
        .bind(username, uid).first();
      if (clash) return new Response('', { status: 302, headers: { Location: `/users/edit/${uid}/username?err=taken` } });
      const before = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(uid).first();
      if (!before) return new Response('Not found', { status: 404 });
      await env.DB.prepare('UPDATE users SET username = ? WHERE id = ?').bind(username, uid).run();
      // The session rows carry the name for display, so they follow the rename
      // rather than being dropped — renaming somebody must not sign them out.
      await env.DB.prepare('UPDATE sessions SET username = ? WHERE user_id = ?').bind(username, uid).run();
      await logAudit(env.DB, currentUser, 'update', 'user', uid, username,
        { username: before.username }, { username });
      return new Response('', { status: 302, headers: { Location: `/users/edit/${uid}?toast=${encodeURIComponent('Renamed — they sign in as ' + username + ' from now on')}` } });
    }

    if (userEditPath && method === 'GET') {
      const uid = userEditPath[1];
      const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
      if (!u) return new Response('Not found', { status: 404 });
      let selectedPerms = [];
      try { selectedPerms = JSON.parse(u.permissions || '[]'); } catch(_) {}
      return html(`
${sidebarShell('users', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  <div class="page-title">${escapeHtml(u.username)}</div>
  <div class="page-sub">What this person can reach. Changing it takes effect the next time they load a screen, not at their next sign-in.</div>
  <form method="POST" action="/users/edit/${u.id}" autocomplete="off">
    <div class="card">
      <div class="form-group">
        <label>Username</label>
        <div class="tlc-static">${escapeHtml(u.username || '')} — changed on its own screen, so nothing here can change it by mistake. <a href="/users/edit/${u.id}/username">Rename this account</a></div>
      </div>
      <div class="form-group"><label>Email <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— used for password reset</span></label><input type="email" name="email" value="${(u.email || '').replace(/"/g,'&quot;')}" autocomplete="off" placeholder="user@timothystl.org"></div>
      <div class="form-group">
        <label>Password</label>
        <div class="tlc-static">Changed on its own screen, so nothing here can change it by mistake. <a href="/users/edit/${u.id}/password">Set a new password</a></div>
      </div>
      <div class="form-group"><label>Permissions</label>${permissionCheckboxes(selectedPerms, await eventCoordinatorPermissions(env))}</div>
      <div class="form-group">
        <label>Status</label>
        <div class="radio-row">
          <label><input type="radio" name="active" value="1"${u.active ? ' checked' : ''}> Active</label>
          <label><input type="radio" name="active" value="0"${!u.active ? ' checked' : ''}> Inactive</label>
        </div>
      </div>
    </div>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary">Save changes</button>
      <a href="/users" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
    </div>
  </form>
</div>`, `Edit User`);
    }

    // ⚠ This route no longer reads a password from the form, and must not be
    // given one back. The screen it serves is the one somebody opens to change
    // permissions; a password field on it is what let a password manager
    // rewrite an account's credentials as a side effect of ticking a box.
    if (userEditPath && method === 'POST') {
      if (!hasPermission(currentUser, 'users_manage')) return new Response('Access denied.', { status: 403 });
      const uid = userEditPath[1];
      const form = await request.formData();
      // ⚠ The username is deliberately NOT read here, exactly as the password
      // is not. Editing what somebody can REACH must never rewrite who they
      // ARE, and the rule has to hold against a stale tab or a crafted POST —
      // not merely against the markup — because the thing that was writing it
      // was never a person in the first place, it was a password manager.
      const email = (form.get('email') || '').trim().toLowerCase() || null;
      const active = form.get('active') === '1' ? 1 : 0;
      // Dynamic per-event keys (event_<id>_manage) never live in the static
      // PERMISSIONS object, so they are read off the event list itself —
      // the same list permissionCheckboxes() was handed to draw their boxes.
      const dynamicPermKeys = Object.keys(await eventCoordinatorPermissions(env));
      const perms = [...Object.keys(PERMISSIONS), ...dynamicPermKeys].filter(k => form.get('perm_' + k) === '1');
      // Fetch existing user to detect permission changes
      const existingUser = await env.DB.prepare('SELECT permissions, active FROM users WHERE id = ?').bind(uid).first();
      const oldPerms = existingUser ? existingUser.permissions : '[]';
      const newPermsJson = JSON.stringify(perms);
      const permsChanged = oldPerms !== newPermsJson;
      const deactivated = existingUser && existingUser.active && !active;
      await env.DB.prepare('UPDATE users SET email = ?, permissions = ?, active = ? WHERE id = ?')
        .bind(email, newPermsJson, active, uid).run();
      // Invalidate sessions only when something relevant changed
      if (deactivated || permsChanged) {
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
      const msg = url.searchParams.get('msg');
      const alertHtml = msg === 'rolledback' ? `<div class="alert alert-success">✓ Change rolled back. The rollback itself is now the newest entry in this log.</div>` : '';

      const when = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        return isNaN(d) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      };
      const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

      const listRows = rows.results.map((row) => {
        const summary = diffSummary(row.before_state, row.after_state);
        const note = rollbackNote(row);
        return {
          href: `/audit-log?entry=${row.id}`,
          filter: auditGroup(row),
          search: `${row.username || ''} ${row.action} ${row.entity_type} ${row.entity_label || ''} ${summary}`.toLowerCase(),
          cells: [
            // "Published · Page · Home", with the diff underneath. The action
            // is folded into this cell rather than given a pill of its own,
            // because on this screen every row is an action — a column of them
            // would be a column of noise. The diff is the sub-line, since
            // "what changed" is the reason anybody opens this screen.
            primaryCell(
              [row.action === 'rollback' ? 'Rolled back' : cap(row.action),
                cap(String(row.entity_type || '').replace(/_/g, ' ')),
                row.entity_label].filter(Boolean).join(' · '),
              summary || 'No field-level record of this change'
            ),
            escapeHtml(row.username || 'the system'),
            escapeHtml(when(row.created_at)),
            auditCanRollback(row)
              ? `<form method="POST" action="/rollback/${row.id}" style="margin:0;" onsubmit="return confirm('Put this back the way it was? The rollback is itself recorded here.')"><button type="submit" class="tlc-edit" style="background:none;border:0;cursor:pointer;font:inherit;color:inherit;padding:0;">Roll back</button></form>`
              // A dead button is worse than none; say why instead.
              : `<span style="color:var(--tlc-muted);font-size:12px;" title="${escapeHtml(note)}">${escapeHtml(note)}</span>`,
          ],
          actions: '',
        };
      });

      // The drawer, read-only end to end. The spec is explicit that it has no
      // save and no delete, and that read-only fields are a sand FILL rather
      // than grayed text — gray text reads as broken, a filled field reads as
      // "this is a fact, not a question".
      const entryId = url.searchParams.get('entry');
      const entry = entryId ? rows.results.find((r) => String(r.id) === entryId) : null;
      const auditDrawer = entry ? renderDrawer({
        key: 'audit',
        title: [entry.action === 'rollback' ? 'Rolled back' : cap(entry.action),
          cap(String(entry.entity_type || '').replace(/_/g, ' ')), entry.entity_label].filter(Boolean).join(' · '),
        sub: 'Audit entry · read-only',
        action: '', cancelHref: '/audit-log', readOnly: true,
        fields: [
          { kind: 'static', label: 'What changed', html: escapeHtml(diffSummary(entry.before_state, entry.after_state) || 'No field-level record of this change') },
          { kind: 'static', label: 'Who', value: entry.username || 'the system' },
          { kind: 'static', label: 'When', value: when(entry.created_at) },
          { kind: 'static', label: 'Can it be rolled back?',
            value: auditCanRollback(entry) ? 'Yes — the previous value was recorded.' : rollbackNote(entry) },
        ],
      }) : '';

      // Windowed, not one <a> per page — the log has no retention (a
      // deliberate call: it is the accountability record, not ephemeral
      // data), so it only grows, and a table a year in means a page number
      // for every one of a few hundred pages. First, last, and a few either
      // side of where you are covers the same ground in a constant number
      // of links.
      const pagination = totalPages > 1 ? `<div class="tlc-section" style="padding-top:0;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;align-items:center;">${
        paginationWindow(pageNum, totalPages).map((p) =>
          p === '…' ? `<span style="color:var(--tlc-muted);padding:0 4px;">…</span>`
            : `<a href="/audit-log?page=${p}" class="tlc-filter${p === pageNum ? ' is-on' : ''}">${p}</a>`
        ).join('')
      }</div>` : '';

      return html(`
${sidebarShell('audit', currentUser, '', await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'audit',
    title: sectionCfg('audit').title,
    purpose: sectionCfg('audit').purpose,
    search: sectionCfg('audit').search,
    filters: filtersOf('audit'),
    columns: columnsOf('audit'),
    rows: listRows,
    noun: 'entry', nounPlural: 'entries',
    empty: 'Nothing has been changed yet.',
    note: 'Rolling a change back does not erase it. The original entry stays, and the rollback is recorded as its own entry — so the log always says everything that happened, including the undoing.',
  })}
  ${auditDrawer}
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
        ).bind(before.title, before.summary, sanitizeClassicRich(before.body), before.image_url, before.publish_date, before.event_date, before.expire_date, before.pinned, entry.entity_id).run();
        await logAudit(env.DB, currentUser, 'rollback', 'news_item', entry.entity_id, entry.entity_label, null, before);
        return new Response('', { status: 302, headers: { Location: '/audit-log?msg=rolledback' } });
      } else if (entry.entity_type === 'ministry_page') {
        await env.DB.prepare(
          'UPDATE youth_pages SET title=?, content=?, cta_label=?, cta_url=? WHERE slug=?'
        ).bind(before.title, sanitizeClassicRich(before.content), before.cta_label, before.cta_url, entry.entity_id).run();
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
      "SELECT id, subject, published_at, format, status, created_at, approval_status, scheduled_send_at, sent_at, sent_count, beehiiv_id, brevo_campaign_id FROM newsletters ORDER BY CASE WHEN status = 'draft' THEN 0 ELSE 1 END, published_at DESC"
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
      const scheduledParam = url.searchParams.get('scheduled');
      alertHtml = emailErrParam
        ? `<div class="alert alert-error">Email failed: ${escapeHtml(emailErrParam)}</div>`
        : scheduledParam === '1'
          ? `<div class="alert alert-success">✓ "${escapeHtml(subjectParam)}" scheduled with Brevo.</div>`
          : scheduledParam === 'cancelled'
            ? `<div class="alert alert-info">Scheduled send cancelled.</div>`
            : `<div class="alert alert-success">✓ "${escapeHtml(subjectParam)}" sent to ${sentTo}.</div>`;
    } else if (msgParam === 'submitted') {
      // The approval flow used to redirect into News & Events, which is now a
      // separate section. These land here, where the issue actually lives.
      alertHtml = `<div class="alert alert-info">Newsletter submitted for approval. An approver will review it before it goes live.</div>`;
    } else if (msgParam === 'approved') {
      alertHtml = `<div class="alert alert-success">✓ Newsletter approved and published.</div>`;
    } else if (msgParam === 'rejected') {
      alertHtml = `<div class="alert alert-info">Newsletter returned to draft for revisions.</div>`;
    } else if (msgParam === 'locked') {
      alertHtml = `<div class="alert alert-info">That issue has already been sent, so it can't be approved or rejected. Duplicate it as a draft to work from a copy.</div>`;
    }

    const rows = newsletters.results;

    // How many an issue went to, or — for one not yet sent — how many it would
    // go to today. Both answer the question somebody brings to this column;
    // the difference between them is exactly the difference between "Sent" and
    // everything else, which the Status column already states. The real
    // audience is the Brevo list, not the local signup table — that table
    // only holds website-form signups and badly undercounts an audience also
    // built from Breeze imports/manual adds. Falls back to the local count
    // (rather than showing nothing) if Brevo can't be reached.
    const brevoListId = parseInt(env.BREVO_LIST_ID || '0', 10);
    const brevoCount = await getBrevoListCount(env, brevoListId);
    const audienceNow = brevoCount != null
      ? { n: brevoCount }
      : await env.DB.prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers').first().catch(() => null);

    const dateCell = (r, sent) => {
      const iso = r.published_at || r.scheduled_send_at || r.sent_at || '';
      if (!iso) return 'No date yet';
      const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
      if (isNaN(d)) return escapeHtml(iso);
      const when = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `${sent ? 'Sent' : 'Sends'} ${escapeHtml(when)}`;
    };

    const listRows = rows.map((r) => {
      const st = issueStatus(r);
      const sent = isNewsletterSent(r);
      const sends = sent
        ? (Number.isFinite(r.sent_count) && r.sent_count > 0 ? String(r.sent_count) : '—')
        : (audienceNow?.n > 0 ? String(audienceNow.n) : '—');
      return {
        href: `/edit/${r.id}`,
        filter: sent ? 'sent' : (r.approval_status === 'pending' ? 'awaiting-approval' : 'draft'),
        search: `${r.subject || ''} ${st.label} ${sendSummary(r)}`.toLowerCase(),
        cells: [
          primaryCell(r.subject || 'Untitled issue'),
          escapeHtml(sends),
          dateCell(r, sent),
          statusPill(st.tone, st.label),
        ],
        // A sent issue offers Duplicate rather than Edit — the row's own action
        // says what is possible before anybody clicks into a locked screen.
        actions: sent
          ? `<form method="POST" action="/newsletter/duplicate/${r.id}" style="display:inline;margin:0;"><button type="submit" class="tlc-edit" style="background:none;border:0;cursor:pointer;font:inherit;color:inherit;">Duplicate as draft</button></form><a class="tlc-edit" href="/edit/${r.id}">View</a>`
          : `<a class="tlc-edit" href="/edit/${r.id}">Edit</a>`,
      };
    });

    return html(`
${sidebarShell('newsletter', currentUser, `<a href="https://timothystl.org/news" target="_blank">View archive</a>`, await pageBadges())}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${renderListSection({
    key: 'newsletter',
    title: sectionCfg('newsletter').title,
    purpose: sectionCfg('newsletter').purpose,
    action: { label: sectionCfg('newsletter').action, href: '/new' },
    search: sectionCfg('newsletter').search,
    filters: filtersOf('newsletter'),
    columns: columnsOf('newsletter'),
    rows: listRows,
    pageSize: 10,
    noun: 'issue', nounPlural: 'issues',
    empty: 'No newsletters yet.',
    // The design's one ◆ line. The read-only rule is not stated here because the
    // row says it in a place you cannot miss — a sent issue offers Duplicate as
    // draft and View, never Edit — and the editor says it again if you open one.
    note: sectionCfg('newsletter').note,
  })}
</div>`, 'TLC Newsletter Admin');
  }
};
