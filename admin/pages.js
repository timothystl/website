// Page-tree logic shared by the admin screens, the editor and the public API.
// Pure functions over plain rows — no D1, no Request — so the rules that decide
// what staff see (what counts as a draft, what order the list is in, what a
// rename does to the address) can be tested directly.
import { sanitizeBlocks, parseBlocks, templateOf } from './blocks.js';

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
