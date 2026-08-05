// Node test harness for admin/menu.js — run with: node admin/menu.test.mjs
//
// The navigation is the one screen where a mistake is visible to every visitor
// at once, so the rules that matter are pinned down here: a broken item is
// flagged rather than dropped, a menu item never records a page's address, and
// a page can appear in both menus without the two fighting.
import {
  MENUS, KINDS, MAX_DEPTH, normalizeMenu, normalizeKind, normalizeStyle, normalizeDepth,
  resolveItem, menuTree, publicMenu, orphanPages, menuWarnings, renumber,
  COLUMN_SOURCES, normalizeSource, footerColumns, publicFooter, renumberColumns,
} from './menu.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const PAGES = new Map([
  ['home',    { id: 'home',    title: 'Home',           menu_label: '',       slug: '/',              status: 'published' }],
  ['about',   { id: 'about',   title: 'About Us',       menu_label: 'About',  slug: '/about',         status: 'published' }],
  ['visit',   { id: 'visit',   title: 'Plan a Visit',   menu_label: '',       slug: '/visit',         status: 'published' }],
  ['give',    { id: 'give',    title: 'Give',           menu_label: '',       slug: '/give',          status: 'published' }],
  ['beliefs', { id: 'beliefs', title: 'What We Believe',menu_label: '',       slug: '/about/beliefs', status: 'published' }],
  ['draftp',  { id: 'draftp',  title: 'Coming Soon',    menu_label: '',       slug: '/soon',          status: 'draft' }],
]);

const item = (o) => Object.assign({
  id: 1, menu: 'header', label: '', kind: 'page', page_id: null, target: null,
  style: 'link', depth: 0, sort_order: 10, visible: 1,
}, o);

// ── normalisers ──────────────────────────────────────────────────────────────
group('normalisers');
{
  eq(normalizeMenu('footer'), 'footer', 'a real menu passes through');
  eq(normalizeMenu('sidebar'), 'header', 'an unknown menu falls back to header');
  eq(normalizeKind('external'), 'external', 'a real kind passes through');
  eq(normalizeKind('nonsense'), 'page', 'an unknown kind falls back to page');
  eq(normalizeStyle('button'), 'button', 'button style survives');
  eq(normalizeStyle('flashing'), 'link', 'anything else is a plain link');

  eq(normalizeDepth(1, 'header'), 1, 'the header allows one level of nesting');
  eq(normalizeDepth(2, 'header'), 1, 'and clamps a third level rather than accepting it');
  eq(normalizeDepth(1, 'footer'), 0, 'the footer is flat, so nesting is clamped away');
  eq(normalizeDepth(-4, 'header'), 0, 'a negative depth is clamped');
  eq(normalizeDepth('x', 'header'), 0, 'and so is nonsense');
  eq(MAX_DEPTH.header, 1, 'two levels in the header');
  eq(MAX_DEPTH.footer, 0, 'one in the footer');
}

// ── resolving ────────────────────────────────────────────────────────────────
group('resolving an item');
{
  const r = resolveItem(item({ kind: 'page', page_id: 'about' }), PAGES);
  eq(r.label, 'About', 'a page item with no label of its own uses the page’s menu label');
  eq(r.href, '/about', 'and the page’s address');
  eq(r.broken, false, 'and is not broken');

  // The label may differ from the page name on purpose.
  const r2 = resolveItem(item({ kind: 'page', page_id: 'visit', label: 'Visit' }), PAGES);
  eq(r2.label, 'Visit', 'a label on the item wins — "Visit" in the bar');
  eq(r2.href, '/visit', 'while the address still comes from the page');

  // THE rule this table exists to keep: the address is never recorded on the
  // item, so renaming a page updates every menu item pointing at it for free.
  const renamed = new Map(PAGES);
  renamed.set('visit', Object.assign({}, PAGES.get('visit'), { slug: '/plan-a-visit' }));
  eq(resolveItem(item({ kind: 'page', page_id: 'visit', label: 'Visit' }), renamed).href, '/plan-a-visit',
    'renaming the page moves the menu item with it — nothing to update by hand');
}
{
  group('broken items are flagged, never dropped');
  const gone = resolveItem(item({ kind: 'page', page_id: 'deleted-thing' }), PAGES);
  eq(gone.broken, true, 'an item pointing at a deleted page is broken');
  ok(gone.brokenReason.includes('deleted'), 'and says so');

  const draft = resolveItem(item({ kind: 'page', page_id: 'draftp' }), PAGES);
  eq(draft.broken, true, 'an item pointing at a draft page is broken');
  ok(draft.brokenReason.includes('draft'), 'and says why a visitor would hit nothing');
  eq(draft.label, 'Coming Soon', 'but it still knows what it was, so a human can decide');

  const empty = resolveItem(item({ kind: 'external', target: '   ' }), PAGES);
  eq(empty.broken, true, 'an external item with no destination is broken');
}
{
  group('external and short items');
  const ext = resolveItem(item({ kind: 'external', target: 'https://wordoflifeschool.net', label: 'Word of Life' }), PAGES);
  eq(ext.href, 'https://wordoflifeschool.net', 'an external item keeps its URL');
  eq(ext.broken, false, 'and is fine');
  const shortLink = resolveItem(item({ kind: 'short', target: '/zoom', label: 'Zoom' }), PAGES);
  eq(shortLink.href, '/zoom', 'a short-link item points at the short address');
}

// ── the tree ─────────────────────────────────────────────────────────────────
group('the tree');
{
  const items = [
    item({ id: 1, page_id: 'about', sort_order: 10, depth: 0 }),
    item({ id: 2, page_id: 'beliefs', sort_order: 20, depth: 1 }),
    item({ id: 3, page_id: 'give', sort_order: 30, depth: 0, style: 'button' }),
  ];
  const tree = menuTree(items, PAGES, 'header');
  eq(tree.length, 2, 'two top-level items');
  eq(tree[0].children.length, 1, 'with the nested one beneath its parent');
  eq(tree[0].children[0].label, 'What We Believe', 'and it is the right child');
  eq(tree[1].style, 'button', 'the button survives');

  // A child with nothing above it cannot be a child.
  const leading = menuTree([item({ id: 9, page_id: 'about', depth: 1, sort_order: 5 })], PAGES, 'header');
  eq(leading.length, 1, 'a leading item at depth 1 is promoted rather than lost');
  eq(leading[0].depth, 0, 'to depth 0');
}
{
  // A page in both menus is the case `pages` could not express.
  const items = [
    item({ id: 1, menu: 'header', page_id: 'give', label: 'Give', style: 'button', sort_order: 10 }),
    item({ id: 2, menu: 'footer', page_id: 'give', label: 'Give Online', sort_order: 10 }),
  ];
  eq(menuTree(items, PAGES, 'header').length, 1, 'the header has its Give');
  eq(menuTree(items, PAGES, 'footer').length, 1, 'and the footer has its own');
  eq(menuTree(items, PAGES, 'header')[0].label, 'Give', 'with different labels');
  eq(menuTree(items, PAGES, 'footer')[0].label, 'Give Online', 'in each menu');
}

// ── what the public site gets ────────────────────────────────────────────────
group('the public menu');
{
  const items = [
    item({ id: 1, page_id: 'about', sort_order: 10 }),
    item({ id: 2, page_id: 'draftp', sort_order: 20 }),      // broken
    item({ id: 3, page_id: 'give', sort_order: 30, visible: 0 }), // switched off
    item({ id: 4, page_id: 'visit', sort_order: 40 }),
  ];
  const pub = publicMenu(items, PAGES, 'header');
  eq(pub.length, 2, 'a broken item and a hidden item are both left off the site');
  eq(pub.map((i) => i.label).join(','), 'About,Plan a Visit', 'leaving the working ones');

  // ...but the admin still shows the broken one, which is the whole point.
  eq(menuTree(items, PAGES, 'header').length, 4, 'the admin still lists every item, flagged');
}

// ── orphans ──────────────────────────────────────────────────────────────────
group('pages not in the menu');
{
  const pages = [...PAGES.values()];
  const items = [item({ id: 1, page_id: 'about' })];
  const orphans = orphanPages(pages, items);
  const slugs = orphans.map((p) => p.id);
  ok(!slugs.includes('about'), 'a page in the menu is not an orphan');
  ok(!slugs.includes('home'), 'the homepage is never an orphan — it is not a menu item');
  ok(!slugs.includes('draftp'), 'a draft page is not offered to the menu');
  ok(slugs.includes('visit') && slugs.includes('give'), 'live pages nobody linked are listed');
}

// ── rules ────────────────────────────────────────────────────────────────────
group('rules');
{
  const two = [
    item({ id: 1, page_id: 'give', style: 'button' }),
    item({ id: 2, page_id: 'visit', style: 'button' }),
  ];
  const w = menuWarnings(two, PAGES);
  ok(w.some((x) => x.includes('buttons')), 'a second button is warned about');

  const broken = menuWarnings([item({ id: 1, page_id: 'draftp' })], PAGES);
  ok(broken.some((x) => x.includes('draft')), 'a broken target is warned about by name');

  eq(menuWarnings([item({ id: 1, page_id: 'about' })], PAGES).length, 0, 'a clean menu warns about nothing');
}

// ── renumbering after a drag ─────────────────────────────────────────────────
group('renumbering');
{
  const out = renumber([{ id: 3, depth: 0 }, { id: 1, depth: 1 }, { id: 2, depth: 0 }], 'header');
  eq(out.map((o) => o.id).join(','), '3,1,2', 'order is preserved');
  eq(out[0].sort_order < out[1].sort_order, true, 'sort order ascends');
  eq(out[1].depth, 1, 'a nested item keeps its depth');

  // Gaps of 10 leave room to insert without renumbering everything.
  eq(out[0].sort_order, 10, 'numbering starts at 10');
  eq(out[1].sort_order, 20, 'in steps of 10');

  eq(renumber([{ id: 1, depth: 1 }], 'header')[0].depth, 0,
    'the first item cannot be nested — there is nothing above it to nest under');
  eq(renumber([{ id: 1, depth: 0 }, { id: 2, depth: 1 }], 'footer')[1].depth, 0,
    'the footer flattens any nesting');
}

group('the footer is headed columns, not a flat list');
{
  // The header is one bar, so an ordered list describes it completely. The
  // footer is groups with headings, and "which group is this under" has
  // nowhere to live in an ordered list — infer it from position and a link
  // silently changes column the moment somebody reorders the one above it.
  const cols = [
    { id: 1, heading: 'Visit', source: 'menu', sort_order: 10, visible: 1 },
    { id: 2, heading: 'Connect', source: 'menu', sort_order: 20, visible: 1 },
    { id: 3, heading: 'Partners', source: 'partners', sort_order: 30, visible: 1 },
  ];
  const items = [
    item({ id: 1, menu: 'footer', kind: 'page', page_id: 'visit', column_id: 1, sort_order: 10 }),
    item({ id: 2, menu: 'footer', kind: 'page', page_id: 'about', column_id: 2, sort_order: 20 }),
    item({ id: 3, menu: 'footer', kind: 'page', page_id: 'give', column_id: 1, sort_order: 30 }),
    item({ id: 4, menu: 'header', kind: 'page', page_id: 'about', sort_order: 10 }),
  ];
  const { columns, orphans } = footerColumns(cols, items, PAGES);
  eq(columns.length, 3, 'every column is returned');
  eq(columns[0].items.length, 2, 'with the items assigned to it');
  eq(columns[1].items.length, 1, 'and only those');
  eq(orphans.length, 0, 'nothing is stranded');
  eq(columns[2].items.length, 0, 'a partners column carries no menu items — the site fills it');
  ok(!columns.some((c) => c.items.some((i) => i.id === 4)), 'a header item never leaks into the footer');

  eq(normalizeSource('nonsense'), 'menu', 'an unknown source falls back');
  ok(COLUMN_SOURCES.includes('partners'), 'partners is a real source');
}

group('a footer link is never lost to a deleted column');
{
  // ⚠ The property that makes deleting a column safe. A link the office put in
  // the footer vanishing because of a column somebody removed is exactly the
  // silent loss the rest of this file exists to prevent.
  const cols = [{ id: 1, heading: 'Visit', source: 'menu', sort_order: 10, visible: 1 }];
  const items = [
    item({ id: 1, menu: 'footer', kind: 'page', page_id: 'visit', column_id: 99, sort_order: 10 }),
    item({ id: 2, menu: 'footer', kind: 'page', page_id: 'about', column_id: null, sort_order: 20 }),
  ];
  const { orphans } = footerColumns(cols, items, PAGES);
  eq(orphans.length, 2, 'both a dead column and no column at all read as stranded');

  const pub = publicFooter(cols, items, PAGES);
  eq(pub.length, 1, 'the site still renders one column');
  eq(pub[0].items.length, 2, 'and both stranded links appear in it rather than disappearing');
  eq(pub[0].heading, 'Visit', 'under the first real column, not a headless one');
}

group('what the footer shows the site, and what it does not');
{
  const cols = [
    { id: 1, heading: 'Visit', source: 'menu', sort_order: 10, visible: 1 },
    { id: 2, heading: 'Empty', source: 'menu', sort_order: 20, visible: 1 },
    { id: 3, heading: 'Hidden', source: 'menu', sort_order: 30, visible: 0 },
    { id: 4, heading: 'Partners', source: 'partners', sort_order: 40, visible: 1 },
  ];
  const items = [
    item({ id: 1, menu: 'footer', kind: 'page', page_id: 'visit', column_id: 1, sort_order: 10 }),
    item({ id: 2, menu: 'footer', kind: 'page', page_id: 'draftp', column_id: 1, sort_order: 20 }),
    item({ id: 3, menu: 'footer', kind: 'page', page_id: 'about', column_id: 1, sort_order: 30, visible: 0 }),
  ];
  const pub = publicFooter(cols, items, PAGES);
  const headings = pub.map((c) => c.heading);
  ok(headings.includes('Visit'), 'a column with links shows');
  ok(!headings.includes('Empty'), 'one with none does not — a heading over nothing reads as a fault');
  ok(!headings.includes('Hidden'), 'and a hidden column stays off');
  ok(headings.includes('Partners'), 'but an empty partners column is kept — the site fills it after this runs');
  eq(pub[0].items.length, 1, 'a draft page and a hidden item are both left out');

  // The admin sees what the site does not, which is the whole point of the split.
  const admin = footerColumns(cols, items, PAGES);
  eq(admin.columns[0].items.length, 3, 'the admin still lists the broken and hidden ones so they can be fixed');
}

group('columns renumber from scratch');
{
  const out = renumberColumns([{ id: 5 }, { id: 2 }, { id: 9 }]);
  eq(out[0].sort_order, 10, 'numbering starts at 10');
  eq(out[2].id, 9, 'in the order posted');
  eq(new Set(out.map((c) => c.sort_order)).size, 3, 'and no two columns claim one position');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
