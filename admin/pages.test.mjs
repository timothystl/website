// Node test harness for admin/pages.js — run with: node admin/pages.test.mjs
// No test framework (the repo has no build step or dev dependencies).
import { orderPages, filterPages, pageStatus, menuTree, slugify, uniqueSlug, pageRename, PILLS } from './pages.js';
import { newBlock, sanitizeBlocks } from './blocks.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const B = (n) => JSON.stringify(sanitizeBlocks(Array.from({ length: n }, () => newBlock('text'))));
const row = (over) => Object.assign({
  id: 'x', title: 'X', menu_label: '', slug: '/x', parent_id: null, sort: 0,
  template: 'standard', status: 'published', in_menu: 1,
  blocks: null, published_blocks: null, publish_at: null, updated_at: null, updated_by: null,
}, over);

// ── draft vs live ────────────────────────────────────────────────────────────
group('what counts as a draft');
{
  const same = B(2);
  const [live] = orderPages([row({ blocks: same, published_blocks: same })]);
  eq(live.hasDraftEdits, false, 'identical draft and live is not a draft');
  eq(pageStatus(live).label, 'Published', 'and reads as Published');

  const [edited] = orderPages([row({ blocks: B(3), published_blocks: B(2) })]);
  eq(edited.hasDraftEdits, true, 'a draft that differs from live has unpublished changes');
  eq(pageStatus(edited).label, 'Draft edits', 'and reads as Draft edits');

  // A page that has never gone live must say Draft even with no session edits —
  // deriving the badge from the change log alone was the bug here.
  const [fresh] = orderPages([row({ status: 'draft', blocks: B(2), published_blocks: null })]);
  eq(pageStatus(fresh).label, 'Draft', 'a page that has never been published reads as Draft');
  eq(fresh.neverPublished, true, 'and is marked as never published');

  const [sched] = orderPages([row({ blocks: B(1), published_blocks: B(1), publish_at: '2099-01-01T00:00:00Z' })]);
  eq(pageStatus(sched).label, 'Scheduled', 'a scheduled page reads as Scheduled');

  const one = B(1);
  const [hidden] = orderPages([row({ in_menu: 0, blocks: one, published_blocks: one })]);
  eq(pageStatus(hidden).label, 'Not in menu', 'a page out of the menu says so');

  // whitespace or key order in the stored JSON must not read as an edit
  const blocks = sanitizeBlocks([newBlock('text', { body: '<p>a</p>' })]);
  const [noisy] = orderPages([row({ blocks: JSON.stringify(blocks), published_blocks: JSON.stringify(blocks, null, 2) })]);
  eq(noisy.hasDraftEdits, false, 'reformatted JSON is not an edit');
  const [broken] = orderPages([row({ blocks: 'not json', published_blocks: 'also not json' })]);
  eq(broken.hasDraftEdits, false, 'unreadable blocks do not crash the list');
  eq(broken.blockCount, 0, 'and count as no blocks');
}

// ── ordering ─────────────────────────────────────────────────────────────────
group('list order');
{
  const rows = [
    row({ id: 'ministries', slug: '/ministries', sort: 50 }),
    row({ id: 'music', slug: '/music', parent_id: 'ministries', sort: 10 }),
    row({ id: 'about', slug: '/about', sort: 10 }),
    row({ id: 'stephen', slug: '/stephen', parent_id: 'ministries', sort: 20 }),
    row({ id: 'orphan', slug: '/orphan', parent_id: 'gone' }),
  ];
  const ids = orderPages(rows).map((p) => p.id);
  eq(JSON.stringify(ids), JSON.stringify(['ministries', 'music', 'stephen', 'about', 'orphan']),
    'children follow their parent; an orphan still appears rather than vanishing');
  eq(orderPages(rows).length, rows.length, 'no page is lost or duplicated');
  eq(orderPages([]).length, 0, 'an empty site does not throw');
}

// ── filters ──────────────────────────────────────────────────────────────────
group('filters');
{
  const same = B(1);
  const rows = orderPages([
    row({ id: 'a', slug: '/a', blocks: same, published_blocks: same }),
    row({ id: 'b', slug: '/b', blocks: B(2), published_blocks: same }),
    row({ id: 'c', slug: '/c', status: 'draft', blocks: same, published_blocks: same }),
  ]);
  eq(filterPages(rows, 'all').length, 3, 'All shows everything');
  eq(JSON.stringify(filterPages(rows, 'drafts').map((p) => p.id)), JSON.stringify(['b', 'c']),
    'Drafts shows unpublished changes and never-published pages');
  eq(JSON.stringify(filterPages(rows, 'published').map((p) => p.id)), JSON.stringify(['a']),
    'Published shows only pages with nothing outstanding');
  eq(filterPages(rows, 'nonsense').length, 3, 'an unknown filter shows everything rather than nothing');
}

// ── menu ─────────────────────────────────────────────────────────────────────
group('menu');
{
  const rows = [
    row({ id: 'about', slug: '/about', sort: 10 }),
    row({ id: 'beliefs', slug: '/about/beliefs', parent_id: 'about' }),
    row({ id: 'secret', slug: '/secret', in_menu: 0 }),
    row({ id: 'unfinished', slug: '/unfinished', status: 'draft' }),
  ];
  const tree = menuTree(rows);
  eq(tree.length, 1, 'only published, in-menu, top-level pages are menu entries');
  eq(tree[0].children.length, 1, 'children hang off their parent');
  ok(!JSON.stringify(tree).includes('secret'), 'a page out of the menu is not in the menu');
  ok(!JSON.stringify(tree).includes('unfinished'), 'an unpublished page is not in the menu');
}

// ── addresses ────────────────────────────────────────────────────────────────
group('addresses');
eq(slugify('Vacation Bible School'), '/vacation-bible-school', 'a name becomes a clean address');
eq(slugify('News & Events'), '/news-and-events', 'an ampersand is spelled out rather than dropped');
eq(slugify('  Sermons!!  '), '/sermons', 'punctuation and padding come off');
eq(slugify('Beliefs', '/about'), '/about/beliefs', 'a child page sits under its parent');
eq(slugify('Beliefs', '/'), '/beliefs', 'the homepage is not a path prefix');
eq(slugify(''), '/page', 'an empty name still produces a usable address');
eq(slugify('—'), '/page', 'a name with nothing usable in it still produces an address');
ok(/^\/[a-z0-9/-]+$/.test(slugify('Ünïcodé Ñame')), 'accented characters do not leak into the address');
eq(uniqueSlug('/vbs', new Set(['/vbs'])), '/vbs-2', 'a taken address gets a number');
eq(uniqueSlug('/vbs', new Set(['/vbs', '/vbs-2'])), '/vbs-3', 'and keeps counting');
eq(uniqueSlug('/vbs', new Set()), '/vbs', 'a free address is left alone');

group('renaming');
{
  const all = [
    row({ id: 'home', slug: '/', title: 'Home' }),
    row({ id: 'ministries', slug: '/ministries', title: 'Ministries' }),
    row({ id: 'music', slug: '/ministries/music', title: 'Music Ministry', parent_id: 'ministries' }),
    row({ id: 'other', slug: '/serving', title: 'Serving' }),
  ];
  const r = pageRename(all[1], 'Our Ministries', all);
  eq(r.slug, '/our-ministries', 'renaming a page regenerates its address');
  ok(r.redirects.some((x) => x.from === '/ministries' && x.to === '/our-ministries'), 'the old address redirects to the new one');
  ok(r.redirects.some((x) => x.from === '/ministries/music' && x.to === '/our-ministries/music'),
    'a child moves with its parent and its old address redirects too');

  eq(pageRename(all[0], 'Welcome', all).slug, '/', 'the homepage keeps its address whatever it is called');
  eq(pageRename(all[0], 'Welcome', all).redirects.length, 0, 'and writes no redirect');

  const same = pageRename(all[1], 'Ministries', all);
  eq(same.slug, '/ministries', 'renaming to the same name is a no-op');
  eq(same.redirects.length, 0, 'and writes no redirect');

  const clash = pageRename(all[1], 'Serving', all);
  eq(clash.slug, '/serving-2', 'a rename onto a taken address gets a number rather than colliding');
}

group('pill wording');
for (const [key, p] of Object.entries(PILLS)) {
  ok(p.label && p.bg && p.fg, `${key} pill has a label and colours`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
