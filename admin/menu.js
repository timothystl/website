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
//
// handleMenuRoutes, near the bottom of this file, is the exception: it owns the actual HTTP
// routing/D1 logic for the Menu screen (moved out of tlc-admin-worker.js's own if-chain).

import { hasPermission, logAudit } from './auth.js';
import { html, sidebarShell, escapeHtml } from './helpers.js';
import { renderFormSection, panel } from './ui.js';
import {
  PALETTE as CHROME_PALETTE, BAR_KEYS, FIELD_LABELS as CHROME_LABELS,
  TYPEFACES, TEXT_SIZES, appearanceFromForm, changedFields as chromeChanged,
  renderHeaderPreview, renderNewsletterPreview,
  CHROME_DRAFT_KEY, CHROME_LIVE_KEY, readChrome, readChromePair, writeChrome,
} from './appearance.js';

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
    // A page that links out is still a page here — the item points at it by id,
    // so renaming or re-pointing it needs nothing changed in the menu — but the
    // bar links straight to the outside site rather than to an address whose
    // only job is to bounce.
    const out = String(page.external_url || '').trim();
    const href = /^https?:\/\/\S+$/i.test(out) ? out : page.slug;
    return Object.assign(base, { label, href, pageId: page.id, broken: false, brokenReason: '' });
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

// ── FOOTER COLUMNS ───────────────────────────────────────────
// The header is one bar, so a flat ordered list describes it completely. The
// footer is not: it is headed groups — Visit, Connect, Programs, Partners —
// and "which group is this link under" is a fact that has nowhere to live in
// an ordered list. That is why `footer_columns` is its own table and
// `menu_items.column_id` points at it, rather than the grouping being inferred
// from position (which would mean a link silently changing column the moment
// somebody reordered the one above it).
//
// A column's `source` is where its links come from:
//   'menu'     — ordinary menu items assigned to it
//   'partners' — filled from the partner ministries, on the site, at load
//
// Partners is a real column on the site today and its contents are not menu
// items at all, so modeling it as one would mean either faking eleven rows or
// pretending the column does not exist. It gets a source instead.
export const COLUMN_SOURCES = ['menu', 'partners'];

export function normalizeSource(v) {
  return COLUMN_SOURCES.includes(v) ? v : 'menu';
}

// Columns with their items, in order. `orphans` is every footer item that is
// not in any column — a link pointing at a deleted column, or one that predates
// this table.
//
// ⚠ An orphan is NOT dropped. A link the office put in the footer disappearing
// because of a column they deleted is exactly the kind of silent loss the rest
// of this file exists to avoid, so it stays in the list and the admin says
// where it is showing. See publicFooter().
export function footerColumns(columns, items, pagesById) {
  const cols = (columns || [])
    .slice()
    .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id))
    .map((c) => ({
      id: c.id,
      heading: c.heading || '',
      source: normalizeSource(c.source),
      visible: !!c.visible,
      items: [],
    }));
  const byId = new Map(cols.map((c) => [c.id, c]));

  const footerItems = (items || [])
    .filter((i) => normalizeMenu(i.menu) === 'footer')
    .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));

  const orphans = [];
  for (const raw of footerItems) {
    const resolved = Object.assign(resolveItem(raw, pagesById), { columnId: raw.column_id || null });
    const col = raw.column_id != null ? byId.get(raw.column_id) : null;
    if (col && col.source === 'menu') col.items.push(resolved);
    else orphans.push(resolved);
  }
  return { columns: cols, orphans };
}

// What the site renders. Hidden and broken items are left out — the admin
// shows them, flagged, and the site must not — and an empty 'menu' column is
// dropped, because a heading with nothing under it reads as a broken page.
//
// Orphans are shown under the FIRST column rather than in a headless fifth
// one: they have to appear somewhere, an unheaded column at the end of a
// footer looks like a fault, and the admin states plainly where they went.
// A 'partners' column is kept even though it is empty here — the site fills it
// after this runs, from the partner ministries.
export function publicFooter(columns, items, pagesById) {
  const { columns: cols, orphans } = footerColumns(columns, items, pagesById);
  const live = (list) => list.filter((i) => i.visible && !i.broken)
    .map((i) => ({ label: i.label, href: i.href, kind: i.kind }));

  const out = cols.filter((c) => c.visible).map((c) => ({
    heading: c.heading,
    source: c.source,
    items: live(c.items),
  }));
  const spare = live(orphans);
  if (spare.length) {
    const first = out.find((c) => c.source === 'menu');
    if (first) first.items = first.items.concat(spare);
    else out.push({ heading: '', source: 'menu', items: spare });
  }
  return out.filter((c) => c.source !== 'menu' || c.items.length);
}

// Same contract as renumber(): the whole resulting order is posted and the
// server renumbers from scratch, so a dropped row cannot leave two columns
// claiming one position.
export function renumberColumns(order) {
  return order.map((c, i) => ({ id: c.id, sort_order: (i + 1) * 10 }));
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

// ── ROUTES ───────────────────────────────────────────────────
// The second genuinely bespoke screen: a tree with drag-and-drop and a live
// preview of the real header. Gated on pages_edit — whoever owns the site's
// structure owns its navigation. Moved out of tlc-admin-worker.js's own
// if-chain; the routing logic used to sit there while this file held only
// the pure helpers above (see the September 2026 code-normalization survey).
export async function handleMenuRoutes(request, env, path, method, currentUser, url, badges = {}) {
  if (!(path === '/menu' || path.startsWith('/menu/'))) return null;

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
${sidebarShell('menu', currentUser, `<a href="/menu">← Menu</a>`, badges)}
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
${sidebarShell('menu', currentUser, `<a href="/menu">← Menu</a>`, badges)}
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
${sidebarShell('menu', currentUser, `<a href="https://timothystl.org" target="_blank">View site</a>`, badges)}
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
${sidebarShell('menu', currentUser, `<a href="/menu">← Menu</a>`, badges)}
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
