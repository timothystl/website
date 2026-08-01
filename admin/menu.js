// ── THE NAVIGATION ───────────────────────────────────────────
// `menu_items` and `pages` answer two different questions, which is why this is
// a join table rather than more columns on `pages`:
//
//   pages      — what a page IS, and where it lives. One row per page.
//   menu_items — what the NAVIGATION looks like. One row per appearance.
//
// A page can appear twice (Give is in the header and the footer), under a
// shorter label than its own title ("Visit" in the bar, "Plan a Visit" on the
// page), and the navigation also carries things that are not pages at all —
// Word of Life School, Mother's Day Out, the volunteer site. None of that fits
// in a column on `pages`, and forcing it there would mean either losing the
// footer or inventing page rows that are not pages.
//
// What this is NOT is a second source of truth for a page's address. A `page`
// item stores `page_id` and nothing else about the page: the label falls back
// to the page's own, and the address is always read from `pages`. Rename a page
// and every menu item pointing at it follows, because none of them recorded it.
//
// Pure functions over plain rows — no D1, no Request — so the rules can be
// tested directly. See admin/menu.test.mjs.

export const MENUS = ['header', 'footer'];
export const KINDS = ['page', 'external', 'short'];

// Two levels in the header, flat in the footer. A third level in a church
// website's navigation is a menu nobody can use on a phone.
export const MAX_DEPTH = { header: 1, footer: 0 };

export function normalizeMenu(v) {
  return MENUS.includes(v) ? v : 'header';
}
export function normalizeKind(v) {
  return KINDS.includes(v) ? v : 'page';
}
export function normalizeStyle(v) {
  return v === 'button' ? 'button' : 'link';
}
export function normalizeDepth(depth, menu) {
  const d = Math.max(0, Math.min(MAX_DEPTH[normalizeMenu(menu)], parseInt(depth, 10) || 0));
  return d;
}

// ── RESOLVING AN ITEM ────────────────────────────────────────
// What a menu item actually points at, and whether it still works.
//
// A broken item is **flagged, never dropped**. If somebody unpublishes the page
// behind a menu item, silently removing the item would hide the mistake; the
// office would notice only when a visitor mentioned the gap. So it stays in the
// list, marked, until a human decides.
export function resolveItem(item, pagesById) {
  const kind = normalizeKind(item.kind);
  const style = normalizeStyle(item.style);
  const base = { id: item.id, menu: normalizeMenu(item.menu), kind, style, depth: normalizeDepth(item.depth, item.menu), visible: !!item.visible };

  if (kind === 'page') {
    const page = pagesById.get(item.page_id);
    if (!page) {
      return Object.assign(base, {
        label: item.label || 'Missing page', href: null,
        broken: true, brokenReason: 'The page this points at has been deleted.',
      });
    }
    // The label may differ from the page name on purpose — "Visit" in the bar,
    // "Plan a Visit" on the page. Falling back to the page's own name means a
    // new item needs no label typed at all.
    const label = item.label || page.menu_label || page.title;
    if (page.status !== 'published') {
      return Object.assign(base, {
        label, href: page.slug, pageId: page.id,
        broken: true, brokenReason: 'The page this points at is a draft, so visitors would hit nothing.',
      });
    }
    return Object.assign(base, { label, href: page.slug, pageId: page.id, broken: false, brokenReason: '' });
  }

  const target = String(item.target || '').trim();
  if (!target) {
    return Object.assign(base, {
      label: item.label || 'Untitled', href: null,
      broken: true, brokenReason: 'This item has no destination.',
    });
  }
  return Object.assign(base, { label: item.label || target, href: target, broken: false, brokenReason: '' });
}

// ── THE TREE ─────────────────────────────────────────────────
// Depth rather than a parent pointer: an item at depth 1 belongs to the nearest
// preceding depth-0 item. That is exactly what dragging expresses ("drop onto
// an item's name to nest under it"), and it makes reordering a list operation
// rather than a tree rewrite — there is no way to orphan a child by moving its
// parent, because the child has no reference to lose.
export function menuTree(items, pagesById, menu = 'header') {
  const rows = items
    .filter((i) => normalizeMenu(i.menu) === menu)
    .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id))
    .map((i) => resolveItem(i, pagesById));

  const out = [];
  for (const r of rows) {
    if (r.depth === 0 || out.length === 0) {
      out.push(Object.assign({}, r, { depth: 0, children: [] }));
    } else {
      out[out.length - 1].children.push(r);
    }
  }
  return out;
}

// What the public site renders: visible items only, and broken ones left out.
// The admin still shows a broken item, flagged — the site must not.
export function publicMenu(items, pagesById, menu = 'header') {
  return menuTree(items.filter((i) => i.visible), pagesById, menu)
    .filter((i) => !i.broken)
    .map((i) => Object.assign({}, i, { children: i.children.filter((c) => !c.broken) }));
}

// ── ORPHANS ──────────────────────────────────────────────────
// Published pages that no menu item points at. Not an error — "Thank You" and a
// concert landing page are meant to be reachable only by link — so the panel
// says so rather than nagging. It exists because the alternative is a page the
// office forgot they made.
export function orphanPages(pages, items) {
  const linked = new Set(items.filter((i) => normalizeKind(i.kind) === 'page').map((i) => i.page_id));
  return pages
    .filter((p) => p.status === 'published' && p.slug !== '/' && !linked.has(p.id))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

// ── RULES ────────────────────────────────────────────────────
// Checked on write, not just in the UI, so a stale tab cannot save a second
// button or a third level.
export function menuWarnings(items, pagesById) {
  const out = [];
  const buttons = items.filter((i) => normalizeStyle(i.style) === 'button' && i.visible);
  if (buttons.length > 1) {
    out.push(`${buttons.length} items are set as buttons. One is the point — a second stops the first standing out.`);
  }
  const broken = items.map((i) => resolveItem(i, pagesById)).filter((r) => r.broken);
  for (const b of broken) out.push(`“${b.label}” — ${b.brokenReason}`);
  return out;
}

// Renumbers a menu from scratch after a drag. Returns [{id, sort_order, depth,
// menu}] for every item in the affected menus, so the write is one predictable
// batch rather than a diff nobody can reason about.
//
// A leading item cannot be nested (there is nothing above it to nest under), so
// its depth is clamped to 0 — the one case where dropping is quietly corrected
// rather than refused, because the alternative is a child with no parent.
export function renumber(order, menu) {
  const max = MAX_DEPTH[normalizeMenu(menu)];
  return order.map((it, i) => ({
    id: it.id,
    menu: normalizeMenu(menu),
    sort_order: (i + 1) * 10,
    depth: i === 0 ? 0 : Math.max(0, Math.min(max, parseInt(it.depth, 10) || 0)),
  }));
}
