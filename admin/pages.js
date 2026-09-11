// Page-tree logic shared by the admin screens, the editor and the public API.
// Pure functions over plain rows — no D1, no Request — so the rules that decide
// what staff see (what counts as a draft, what order the list is in, what a
// rename does to the address) can be tested directly.
import {
  sanitizeBlocks, parseBlocks, templateOf, snapSpace, cleanText, starterOf, starterBlocks,
  STARTERS, renderPage, blocksClientConfig, BLOCK_DEFS, editorPhoneCss,
} from './blocks.js';
import { hasPermission, logAudit } from './auth.js';
import { html, jsonResponse, sidebarShell, escapeHtml } from './helpers.js';
import { renderListSection, renderDrawer, statusPill, primaryCell, pluralise } from './ui.js';
import { section as sectionCfg, filtersOf, columnsOf } from './sections.js';
import { REDESIGN_BLOCKS } from './redesign-seeds.js';
import { LINKS_JS } from './links.js';
import { TINYMCE_HEAD } from './db.js';
// MINISTRY_EDITOR_HTML is NOT imported directly here (unlike everything else on this page) --
// admin/*.js files must stay importable under plain `node` with no loader (see the "Import
// every admin module as ESM" CI step), and a raw .html import needs the wrangler/html-loader
// build step tlc-admin-worker.js gets but this file does not. It arrives via editorShared
// instead, the same way sharedEditorApi/editorPageData/etc. do.

export const PAGE_FILTERS = ['all', 'published', 'drafts'];

// The design's own pill vocabulary for this list, in one place so the screen
// and the tests cannot drift from it: Live / Draft edits / Hidden / Links out /
// Clash. Each carries its tone as well as its words — the list used to pick a
// tone by comparing the label string, which meant renaming a pill silently
// recolored it.
export const PILLS = {
  published:  { label: 'Live',        tone: 'good',  bg: '#DCE6D6', fg: '#3B4C2E' },
  draft:      { label: 'Draft',       tone: 'warn',  bg: '#F5E4C0', fg: '#7A5A12' },
  draftEdits: { label: 'Draft edits', tone: 'warn',  bg: '#F5E4C0', fg: '#7A5A12' },
  scheduled:  { label: 'Scheduled',   tone: 'auto',  bg: '#E4EEF4', fg: '#1E5C7A' },
  hidden:     { label: 'Not in menu', tone: 'plain', bg: '#EDE9E0', fg: '#6A6858' },
  outbound:   { label: 'Links out',   tone: 'plain', bg: '#EDE9E0', fg: '#6A6858' },
};

const json = (v) => JSON.stringify(sanitizeBlocks(parseBlocks(v)));

// A page can stand in for somewhere else entirely — /mdo is the church's page
// in the menu and in the sitemap, but what it actually does is send the visitor
// to mdo.timothystl.org. Storing that on the page rather than as a loose
// redirect is what lets the menu point at it by page id, so renaming or moving
// it needs nothing else updated.
//
// Only http(s) counts. A `javascript:` address stored here would be a link the
// office could click from their own admin, so anything else reads as "not an
// outbound page" rather than being stored and half-honored.
export function outboundUrl(p) {
  const raw = String((p && p.external_url) || '').trim();
  if (!raw) return '';
  if (!/^https?:\/\/\S+$/i.test(raw)) return '';
  return raw;
}

export function isOutbound(p) {
  return !!outboundUrl(p);
}

// A page has unpublished work when its draft differs from what is live.
// Deriving that from an editing session's change log instead would let this
// list contradict the editor's own topbar — a bug worth not reintroducing.
export function decoratePage(p) {
  const draft = json(p.blocks);
  const live = json(p.published_blocks);
  return Object.assign({}, p, {
    hasDraftEdits: draft !== live,
    neverPublished: live === '[]',
    blockCount: sanitizeBlocks(parseBlocks(p.blocks)).length,
    template: templateOf(p.template).key,
  });
}

export function pageStatus(p) {
  // A page that sends visitors to another site has no content of its own, so
  // it can have no draft either — "Links out" is checked before every other
  // state rather than sitting beside them. Showing "Draft edits" on a page
  // nobody can edit would send staff to an editor with nothing in it.
  if (isOutbound(p)) return PILLS.outbound;
  if (p.status === 'draft') return PILLS.draft;
  if (p.publish_at) return PILLS.scheduled;
  if (p.hasDraftEdits) return PILLS.draftEdits;
  if (!p.in_menu) return PILLS.hidden;
  return PILLS.published;
}

// Children sit directly under their parent whatever the sort columns say, so
// the list reads as the menu it describes. Anything orphaned still appears —
// a page you cannot see is a page you cannot fix.
//
// This walks the whole tree, not just one level: most of the site is two
// levels deep (a menu can only be built that shallow), but a handful of pages
// — the Christmas Market vendor application, filed under the Christmas
// Market page, itself filed under Ministries — are a genuine third level,
// created directly by their seed rather than through the Settings screen
// (which refuses to let anyone file a page under another page that already
// has a parent). A single-level walk left a page like that unplaced by
// everything above, so it fell into the "anything orphaned still appears"
// catch-all and rendered as if it had no parent at all — nowhere close to
// where it actually lives in the tree. Recursing here means a page's real
// depth, however deep, is what the list — and the editor rail, which reads
// this same order — actually shows.
export function orderPages(rows) {
  const list = rows.map(decoratePage);
  const byParent = new Map();
  for (const p of list) {
    const key = p.parent_id || '';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(p);
  }
  const out = [];
  const placed = new Set();
  // Depth-first: a page is followed immediately by its own children before
  // its next sibling, so nesting reads correctly at any depth. `placed`
  // doubles as the cycle guard — a page whose parent chain loops back on
  // itself is only ever visited once.
  const walk = (parentKey) => {
    for (const p of byParent.get(parentKey) || []) {
      if (placed.has(p.id)) continue;
      out.push(p); placed.add(p.id);
      walk(p.id);
    }
  };
  walk('');
  for (const p of list) if (!placed.has(p.id)) out.push(p);
  return out;
}

export function filterPages(ordered, filter) {
  if (filter === 'drafts') return ordered.filter((p) => p.hasDraftEdits || p.status === 'draft');
  if (filter === 'published') return ordered.filter((p) => !p.hasDraftEdits && p.status === 'published');
  return ordered;
}

// Whether a page's seeded draft may safely be replaced by a newer conversion of
// the same hardcoded markup.
//
// The seeds are generated from public/index.html, so improving the converter
// produces a better draft — but only pages nobody has touched may take it.
// `updated_by` is stamped 'migration' on insert and overwritten the moment a
// person saves, and an empty `published_blocks` means the page has never gone
// live from the editor. Both must hold, or a re-seed would throw away work.
export function canReseed(row) {
  if (!row) return false;
  const untouched = (row.updated_by || '') === 'migration';
  const neverPublished = row.published_blocks == null || String(row.published_blocks).trim() === '';
  return untouched && neverPublished;
}

// The public menu: two levels, in-menu only, published only.
export function menuTree(rows) {
  const list = rows.filter((p) => p.in_menu && p.status === 'published');
  return list.filter((p) => !p.parent_id).map((p) => Object.assign({}, p, {
    children: list.filter((c) => c.parent_id === p.id),
  }));
}

// ── SHORT LINKS ──────────────────────────────────────────────
// Every page answers on a short address as well as its real one, so `/beliefs`
// works as well as `/about/beliefs` — the difference between something you can
// say from the pulpit and something you have to spell out.
//
// The short link is the last segment of the address, derived rather than typed,
// so it cannot drift when a page is renamed. `short_link` on the row overrides
// it, and that column exists for exactly one reason: it is how a volunteer
// resolves a clash.
//
// The homepage has none — `/` has no last segment, and a short link for the
// front page would be a second address for the thing already at the root.
export function shortLinkFor(page) {
  if (!page || page.slug === '/') return null;
  const override = String(page.short_link || '').trim();
  if (override) return '/' + override.replace(/^\/+|\/+$/g, '');
  const segment = String(page.slug || '').split('/').filter(Boolean).pop();
  return segment ? '/' + segment : null;
}

// Two pages wanting one short link is a real situation — /worship/sermons and a
// top-level Sermons page both derive `/sermons` — and the rule is that it is
// **flagged, never guessed**. Silently giving it to whichever page sorted first
// would mean an address said out loud on Sunday quietly pointing at the wrong
// page, which nobody would notice until somebody complained.
//
// A short link that collides with another page's *real* address is the same
// problem: the real address must win, so the short link is refused rather than
// shadowing a page that already answers there.
export function shortLinkClashes(pages) {
  const byLink = new Map();
  const addresses = new Map();
  for (const p of pages) addresses.set(p.slug, p);

  for (const p of pages) {
    const link = shortLinkFor(p);
    if (!link) continue;
    // A top-level page's short link is its own address. That is identity, not
    // a collision — /about is reached at /about.
    if (link === p.slug) continue;
    const list = byLink.get(link) || [];
    list.push(p);
    byLink.set(link, list);
  }

  const out = new Map();
  for (const [link, list] of byLink) {
    const realPage = addresses.get(link);
    // Somebody else's actual address.
    if (realPage && !list.includes(realPage)) {
      for (const p of list) out.set(p.id, { link, withTitle: realPage.menu_label || realPage.title, reason: 'address' });
      continue;
    }
    if (list.length > 1) {
      for (const p of list) {
        const other = list.find((x) => x.id !== p.id);
        out.set(p.id, { link, withTitle: other ? (other.menu_label || other.title) : '', reason: 'short' });
      }
    }
  }
  return out;
}

// Decorates a list with `shortLink` and `shortLinkClash` in one pass, so the
// Pages screen and the public API cannot disagree about which links are safe.
export function withShortLinks(pages) {
  const clashes = shortLinkClashes(pages);
  return pages.map((p) => Object.assign({}, p, {
    shortLink: shortLinkFor(p),
    shortLinkClash: clashes.get(p.id) || null,
  }));
}

// The short links that are safe to publish: everything except a clash and
// except a link that is already a page's own address. Returned as
// shortLink → slug so the public router can resolve one without a second
// lookup table.
export function shortLinkRoutes(pages) {
  const out = {};
  for (const p of withShortLinks(pages)) {
    if (!p.shortLink || p.shortLinkClash) continue;
    if (p.shortLink === p.slug) continue;
    if (p.status !== 'published') continue;
    out[p.shortLink] = p.slug;
  }
  return out;
}

// Renaming a page regenerates its address. This is the one place a well-meaning
// volunteer can break an inbound link, so the caller always writes a redirect
// from the old address — see pageRename below.
export function slugify(title, parentSlug = '') {
  const base = String(title || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'page';
  const parent = parentSlug && parentSlug !== '/' ? parentSlug.replace(/\/+$/, '') : '';
  return parent + '/' + base;
}

// An address typed by hand, cleaned up a segment at a time. slugify() collapses
// everything that is not a letter or a digit, which would turn `/about/beliefs`
// into `/about-beliefs` — so a typed path is normalized per segment and its
// slashes are kept. Returns '' when nothing usable was typed, so the caller can
// fall back to deriving the address from the title.
export function slugPath(typed) {
  const parts = String(typed || '').split('/').map((s) => s.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)).filter(Boolean);
  return parts.length ? '/' + parts.join('/') : '';
}

// Makes an address unique against the addresses already in use.
export function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) return slug;
  for (let i = 2; i < 100; i++) {
    const next = `${slug}-${i}`;
    if (!taken.has(next)) return next;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

// What renaming a page means, decided in one place: the new address, and the
// redirect rows that keep every old address working — including the old
// addresses of any child pages, which move with their parent.
export function pageRename(page, newTitle, allPages, desiredSlug = '') {
  const parent = page.parent_id ? allPages.find((p) => p.id === page.parent_id) : null;
  const taken = new Set(allPages.filter((p) => p.id !== page.id).map((p) => p.slug));
  // An address typed by hand wins over one derived from the title — the Details
  // drawer exists so the office can say `/visit` about a page called "Plan a
  // Visit". It is still put through slugify, so a typed address cannot be
  // something the router would not accept.
  const typed = slugPath(desiredSlug);
  const wanted = typed || slugify(newTitle, parent ? parent.slug : '');
  // The homepage keeps its address whatever it is called.
  const slug = page.slug === '/' ? '/' : uniqueSlug(wanted, taken);
  const redirects = [];
  if (slug !== page.slug) {
    redirects.push({ from: page.slug, to: slug });
    // A child keeps its own last segment and only moves under the new parent
    // path. Regenerating it from the child's title would silently rename every
    // child address as a side effect of renaming the parent.
    for (const child of allPages.filter((p) => p.parent_id === page.id)) {
      const segment = child.slug.split('/').filter(Boolean).pop() || '';
      if (!segment) continue;
      const childSlug = uniqueSlug(slug.replace(/\/+$/, '') + '/' + segment, taken);
      if (childSlug !== child.slug) redirects.push({ from: child.slug, to: childSlug, id: child.id });
    }
  }
  return { slug, redirects };
}

// ── PAGE EDITOR RESPONSE HEADERS ────────────────────────────────
// Locked down: admin-only, never cached, a strict CSP for the editor shell.
export const EDITOR_HEADERS = {
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
export function pageSettings(row) {
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
export async function pageEditors(env) {
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
export function pageEditorStatus(row) {
  if (row.publish_at) return 'scheduled';
  if (row.status === 'draft') return 'draft';
  const draft = JSON.stringify(sanitizeBlocks(parseBlocks(row.blocks)));
  const live = JSON.stringify(sanitizeBlocks(parseBlocks(row.published_blocks)));
  return draft === live ? 'live' : 'draft';
}

// ── ROUTES ───────────────────────────────────────────────────
// The all-pages list, the New/Details drawers, Church details, and the page
// editor's own API (settings, draft autosave, publish/unpublish, schedule,
// revisions/restore, the redesigned-layout swap). Moved out of
// tlc-admin-worker.js's own if-chain (September 2026 code-normalization
// survey).
//
// `editorShared` carries the handful of things this domain genuinely shares
// with the (not yet extracted) Ministries editor and/or the public /api/pages
// handler and the daily cron -- sharedEditorApi, editorPageData,
// pageLayoutContext, linkTargets, promoteScheduledPages, missingNativeForm,
// NATIVE_FORM_REQUIRED_TYPE, and MINISTRY_EDITOR_HTML (the last one for a
// second reason too: admin/*.js files must stay importable under plain node
// with no loader, and a raw .html import needs the build step
// tlc-admin-worker.js gets but this file does not — see the note above
// MINISTRY_EDITOR_HTML's one call site below). These stay defined in
// tlc-admin-worker.js for now rather than moving here, so nothing about
// Ministries or the cron changes in this pass; a genuinely shared module is
// the right place for them once Ministries gets the same treatment.
//
// ⚠ A request to /pages or /pages/* that matches none of the routes below
// (bare `return null`, same as every other domain here) falls through to
// tlc-admin-worker.js's own legacy-compat redirect ("old bookmarked /pages
// admin URLs redirect to /notices" -- this screen used to live at /pages
// before that name moved to what is now the Notices tab). That fallback is
// NOT dead code and is NOT part of this module -- it stays exactly where it
// is, relying on this function returning null for anything it does not
// recognize, the same way it always has.
export async function handlePagesRoutes(request, env, path, method, currentUser, url, badges, editorShared) {
  if (!(path === '/pages' || path.startsWith('/pages/'))) return null;
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
    await editorShared.promoteScheduledPages(env);
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
${sidebarShell('pages', currentUser, `<a href="/pages/details">Church details</a>`, badges)}
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
${sidebarShell('pages', currentUser, `<a href="/pages">← All pages</a>`, badges)}
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
    return new Response(editorShared.MINISTRY_EDITOR_HTML
      .replace('/*TLCB_EDITOR_CSS*/', editorPhoneCss())
      .replace('/*TLCB_LINKS_JS*/', LINKS_JS)
      .replace('<!--TLCB_TINYMCE-->', TINYMCE_HEAD), { headers: EDITOR_HEADERS });
  }

  // ── The editor's API ──
  if (path.startsWith('/pages/api/')) {
    const shared = await editorShared.sharedEditorApi(path, method, request, env, editorShared.ctx, currentUser, '/pages/api');
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
        config: blocksClientConfig(await editorShared.editorPageData(env, editorShared.ctx)),
        // Every address on the site that answers, for the link picker and
        // its dead-link check. Deliberately NOT the `pages` list above:
        // that one is scoped to what this person may open.
        linkTargets: await editorShared.linkTargets(),
        // Whether a designer-authored layout exists for THIS page. Sent
        // rather than worked out in the browser, so the editor never draws
        // a button that would come back "there is no redesigned layout".
        hasRedesign: !!REDESIGN_BLOCKS[row.id],
        // ⚠ THE RULE, NOT A YES/NO ANSWER. This used to send whether the
        // required native-form block was missing AT THE MOMENT OF THIS
        // GET — which was correct on load and then went stale the
        // instant somebody added or removed a block, because nothing
        // client-side ever re-asked the question. Reported directly: the
        // block was added back, the banner and the disabled Publish
        // button both just sat there until the page was reloaded. Sent
        // now as a static fact about the PAGE (which type it needs, if
        // any — null for every ordinary page and the ministries mount),
        // so renderTop() can re-check it against S.blocks on every
        // render instead of trusting a snapshot from load time.
        nativeFormRequired: editorShared.NATIVE_FORM_REQUIRED_TYPE[row.id]
          ? { type: editorShared.NATIVE_FORM_REQUIRED_TYPE[row.id], label: (BLOCK_DEFS[editorShared.NATIVE_FORM_REQUIRED_TYPE[row.id]] || {}).label || 'form' }
          : null,
        media: media.results || [],
        html: renderPage(blocks, {
          editing: true, slug: row.id, template: row.template, withCss: true,
          data: await editorShared.editorPageData(env, editorShared.ctx), children, asideTop: row.aside_top || 0,
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
          data: await editorShared.editorPageData(env, editorShared.ctx),
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
      // ⚠ THE ACTUAL GUARD, NOT JUST THE DISABLED BUTTON. Prayer and
      // Contact may publish only while their real, spam-screened form
      // block is still among what is being published — a crafted POST
      // with it stripped out is refused here, not merely discouraged by
      // the editor's own UI. See NATIVE_FORM_REQUIRED_TYPE and
      // missingNativeForm's own comment for why this exists at all.
      if (editorShared.missingNativeForm(pageId, blocks)) {
        const need = BLOCK_DEFS[editorShared.NATIVE_FORM_REQUIRED_TYPE[pageId]] || {};
        return jsonResponse({ error: `This page needs its ${need.label || 'form'} block before it can publish — the real, spam-screened form must stay on the page.` }, 400);
      }
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

    // Unpublish: the reverse of Publish, for exactly the case Publish has
    // no undo for on its own — pressed by accident, or before the page
    // was actually ready. Clears published_blocks and takes the page back
    // to 'draft', which is the same state a page is in before it has ever
    // been published — the DRAFT (row.blocks) is untouched, so nothing
    // typed is lost and Publish works again once the page is ready.
    //
    // ⚠ THIS REMOVES THE PAGE FROM /api/pages ENTIRELY, NOT JUST ITS
    // RENDERED HTML. That endpoint's own query is `WHERE status =
    // 'published'` — an unpublished page drops out of the menu, the
    // sitemap-adjacent page list, and any section landing's child list,
    // and its address stops resolving until it is published again. That
    // is the honest shape of "take this off the site," not a surprise;
    // the confirm dialog in the editor says so in as many words.
    if (action === '/unpublish' && method === 'POST') {
      if (row.published_blocks == null) return jsonResponse({ error: 'This page is not published.' }, 400);
      const nowIso = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE pages SET published_blocks = NULL, status = 'draft', publish_at = NULL, updated_at = ?, updated_by = ? WHERE id = ?"
      ).bind(nowIso, currentUser?.username || '', pageId).run();
      await logAudit(env.DB, currentUser, 'unpublish', 'page', pageId, row.title,
        { blocks: sanitizeBlocks(parseBlocks(row.published_blocks)).length }, null);
      return jsonResponse({ ok: true, status: 'draft', saved_at: nowIso });
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
          editing: true, slug: row.id, withCss: true, data: await editorShared.editorPageData(env, editorShared.ctx),
        }, await editorShared.pageLayoutContext(env, '/pages/api', row.id))),
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
          editing: true, slug: row.id, withCss: true, data: await editorShared.editorPageData(env, editorShared.ctx),
        }, await editorShared.pageLayoutContext(env, '/pages/api', row.id))),
      });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
}
