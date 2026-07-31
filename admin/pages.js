// Page-tree logic shared by the admin screens, the editor and the public API.
// Pure functions over plain rows — no D1, no Request — so the rules that decide
// what staff see (what counts as a draft, what order the list is in, what a
// rename does to the address) can be tested directly.
import { sanitizeBlocks, parseBlocks, templateOf } from './blocks.js';

export const PAGE_FILTERS = ['all', 'published', 'drafts'];

// Wording is fixed by the design and used in two places (this list and the
// editor topbar); keeping it here is what stops them disagreeing.
export const PILLS = {
  published:  { label: 'Published',   bg: '#DCE6D6', fg: '#3B4C2E' },
  draft:      { label: 'Draft',       bg: '#F5E4C0', fg: '#7A5A12' },
  draftEdits: { label: 'Draft edits', bg: '#F5E4C0', fg: '#7A5A12' },
  scheduled:  { label: 'Scheduled',   bg: '#E4EEF4', fg: '#1E5C7A' },
  hidden:     { label: 'Not in menu', bg: '#EDE9E0', fg: '#6A6858' },
};

const json = (v) => JSON.stringify(sanitizeBlocks(parseBlocks(v)));

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
  if (p.status === 'draft') return PILLS.draft;
  if (p.publish_at) return PILLS.scheduled;
  if (p.hasDraftEdits) return PILLS.draftEdits;
  if (!p.in_menu) return PILLS.hidden;
  return PILLS.published;
}

// Children sit directly under their parent whatever the sort columns say, so
// the list reads as the menu it describes. Anything orphaned still appears —
// a page you cannot see is a page you cannot fix.
export function orderPages(rows) {
  const list = rows.map(decoratePage);
  const out = [];
  const placed = new Set();
  for (const p of list.filter((x) => !x.parent_id)) {
    out.push(p); placed.add(p.id);
    for (const c of list.filter((x) => x.parent_id === p.id)) { out.push(c); placed.add(c.id); }
  }
  for (const p of list) if (!placed.has(p.id)) out.push(p);
  return out;
}

export function filterPages(ordered, filter) {
  if (filter === 'drafts') return ordered.filter((p) => p.hasDraftEdits || p.status === 'draft');
  if (filter === 'published') return ordered.filter((p) => !p.hasDraftEdits && p.status === 'published');
  return ordered;
}

// The public menu: two levels, in-menu only, published only.
export function menuTree(rows) {
  const list = rows.filter((p) => p.in_menu && p.status === 'published');
  return list.filter((p) => !p.parent_id).map((p) => Object.assign({}, p, {
    children: list.filter((c) => c.parent_id === p.id),
  }));
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
export function pageRename(page, newTitle, allPages) {
  const parent = page.parent_id ? allPages.find((p) => p.id === page.parent_id) : null;
  const taken = new Set(allPages.filter((p) => p.id !== page.id).map((p) => p.slug));
  // The homepage keeps its address whatever it is called.
  const slug = page.slug === '/' ? '/' : uniqueSlug(slugify(newTitle, parent ? parent.slug : ''), taken);
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
