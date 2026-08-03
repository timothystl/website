// Node test harness for admin/pages.js — run with: node admin/pages.test.mjs
// No test framework (the repo has no build step or dev dependencies).
import { orderPages, filterPages, pageStatus, menuTree, slugify, uniqueSlug, pageRename, PILLS,
         shortLinkFor, shortLinkClashes, withShortLinks, shortLinkRoutes,
         outboundUrl, isOutbound, slugPath, canReseed } from './pages.js';
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
  eq(pageStatus(live).label, 'Live', 'and reads as Live — the design\'s word, and the one on the filter chip beside it');

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
  // The list used to pick its tone by comparing the label string, so renaming a
  // pill silently recoloured it. The tone travels with the words now.
  ok(p.tone, `${key} pill carries its own tone`);
}
// The design's vocabulary for this screen, spelled out so a rename has to be
// deliberate rather than incidental.
{
  const labels = Object.values(PILLS).map((p) => p.label);
  for (const word of ['Live', 'Draft edits', 'Links out']) {
    ok(labels.includes(word), `“${word}” is one of the page pills`);
  }
}


// ── a page that links out ────────────────────────────────────────────────────
group('pages that link out');
{
  eq(outboundUrl({ external_url: 'https://mdo.timothystl.org' }), 'https://mdo.timothystl.org', 'an https address is an outbound page');
  eq(outboundUrl({ external_url: '  http://example.org  ' }), 'http://example.org', 'surrounding space is trimmed');
  eq(outboundUrl({ external_url: '' }), '', 'a blank is a normal page');
  eq(outboundUrl({}), '', 'so is a page with no column value at all');
  // Anything that is not http(s) is not stored as a link the office would then
  // click from inside their own admin session.
  eq(outboundUrl({ external_url: 'javascript:alert(1)' }), '', 'a javascript: address is not an outbound page');
  eq(outboundUrl({ external_url: '/somewhere' }), '', 'nor is a bare path');
  eq(isOutbound({ external_url: 'https://x.org' }), true, 'isOutbound agrees');

  // "Links out" beats every other state, including a draft, because a page with
  // no content of its own cannot have unpublished content either.
  const out = orderPages([row({ external_url: 'https://mdo.timothystl.org', blocks: B(3), published_blocks: B(1), status: 'draft', in_menu: 0 })])[0];
  eq(pageStatus(out).label, 'Links out', 'an outbound page reads as Links out whatever else is true of it');
  eq(pageStatus(out).tone, 'plain', 'and is not dressed up as a fault');
}


// ── an address typed by hand ─────────────────────────────────────────────────
group('typing an address');
{
  eq(slugPath('/about/beliefs'), '/about/beliefs', 'slashes survive — the whole point of the per-segment pass');
  eq(slugPath('about/beliefs'), '/about/beliefs', 'a missing leading slash is added');
  eq(slugPath('/Plan A Visit/'), '/plan-a-visit', 'each segment is cleaned the same way slugify cleans a title');
  eq(slugPath('///'), '', 'nothing usable comes back empty, so the caller can fall back to the title');
  eq(slugPath(''), '', 'and so does a blank');

  const all = [{ id: 'p', slug: '/plan-a-visit', title: 'Plan a Visit', parent_id: null }];
  const typed = pageRename(all[0], 'Plan a Visit', all, '/visit');
  eq(typed.slug, '/visit', 'a typed address wins over one derived from the title');
  eq(typed.redirects.length, 1, 'and the old address is kept working');
  eq(typed.redirects[0].from, '/plan-a-visit', 'with a 301 from where it used to be');

  const derived = pageRename(all[0], 'Visit Us', all);
  eq(derived.slug, '/visit-us', 'with nothing typed, the address still follows the title');
}


// ── short links ──────────────────────────────────────────────────────────────
group('short links');
{
  const P = (id, slug, over, title) => ({ id, slug, title: title || id, status: 'published', short_link: over || null });

  eq(shortLinkFor(P('a', '/about')), '/about', 'a top-level page’s short link is its own address');
  eq(shortLinkFor(P('b', '/about/beliefs')), '/beliefs', 'a child page shortens to its last segment');
  eq(shortLinkFor(P('c', '/a/b/c')), '/c', 'however deep it sits');
  eq(shortLinkFor(P('h', '/')), null, 'the homepage has no short link — / has no last segment');
  eq(shortLinkFor(null), null, 'a missing page does not throw');

  // The override exists so a volunteer can resolve a clash; it is normalised so
  // "visit", "/visit" and "/visit/" all mean the same thing.
  eq(shortLinkFor(P('d', '/about/plan-a-visit', 'visit')), '/visit', 'an override wins over the derived value');
  eq(shortLinkFor(P('e', '/x/y', '/visit')), '/visit', 'a leading slash in the override is fine');
  eq(shortLinkFor(P('f', '/x/y', 'visit/')), '/visit', 'and a trailing one');
  eq(shortLinkFor(P('g', '/x/y', '   ')), '/y', 'a blank override falls back to the derived value');
}

group('short link clashes');
{
  const P = (id, slug, title, over) => ({ id, slug, title, status: 'published', short_link: over || null });

  // Nothing colliding.
  {
    const c = shortLinkClashes([P('1', '/about', 'About'), P('2', '/about/beliefs', 'Beliefs')]);
    eq(c.size, 0, 'distinct short links do not clash');
  }

  // A top-level page reached at its own address is identity, not a collision.
  {
    const c = shortLinkClashes([P('1', '/worship', 'Worship')]);
    eq(c.size, 0, 'a page whose short link is its own address is not clashing with itself');
  }

  // Two children deriving one short link — both flagged, neither guessed.
  {
    const pages = [P('1', '/worship/sermons', 'Sermons'), P('2', '/media/sermons', 'Sermon Archive')];
    const c = shortLinkClashes(pages);
    eq(c.size, 2, 'both pages wanting /sermons are flagged, not just the loser');
    eq(c.get('1').link, '/sermons', 'the clashing link is named');
    eq(c.get('1').withTitle, 'Sermon Archive', 'and so is the other page, so the message is actionable');
    eq(c.get('2').withTitle, 'Sermons', 'from both sides');
  }

  // A short link that shadows a different page's real address. The real address
  // must win — otherwise /sermons quietly stops reaching the Sermons page.
  {
    const pages = [P('1', '/sermons', 'Sermons'), P('2', '/worship/sermons', 'Sunday Sermons')];
    const c = shortLinkClashes(pages);
    eq(c.has('2'), true, 'a short link shadowing a real address is refused');
    eq(c.get('2').reason, 'address', 'and says why');
    eq(c.get('2').withTitle, 'Sermons', 'naming the page that actually lives there');
    eq(c.has('1'), false, 'the page that really is at that address is not blamed');
  }

  // Resolving a clash by overriding one side clears both.
  {
    const pages = [P('1', '/worship/sermons', 'Sermons'), P('2', '/media/sermons', 'Archive', 'archive')];
    eq(shortLinkClashes(pages).size, 0, 'giving one of them a different short link clears the clash');
  }

  // The homepage never participates.
  {
    const c = shortLinkClashes([{ id: 'h', slug: '/', title: 'Home', status: 'published' }, P('1', '/a/home', 'Home Groups')]);
    eq(c.size, 0, 'the homepage has no short link to clash with');
  }
}

group('publishable short-link routes');
{
  const P = (id, slug, title, over, status) => ({ id, slug, title, short_link: over || null, status: status || 'published' });

  {
    const r = shortLinkRoutes([P('1', '/about', 'About'), P('2', '/about/beliefs', 'Beliefs')]);
    eq(r['/beliefs'], '/about/beliefs', 'a child page publishes its short link');
    eq('/about' in r, false, 'a page already at its own address needs no route');
  }
  {
    // A clash must publish NOTHING, or the address said out loud on Sunday
    // silently points at whichever page happened to sort first.
    const r = shortLinkRoutes([P('1', '/worship/sermons', 'Sermons'), P('2', '/media/sermons', 'Archive')]);
    eq(Object.keys(r).length, 0, 'a clashing short link is published for neither page');
  }
  {
    const r = shortLinkRoutes([P('1', '/about/beliefs', 'Beliefs', null, 'draft')]);
    eq(Object.keys(r).length, 0, 'a draft page does not publish a short link');
  }
}

group('short links decorated onto a list');
{
  const rows = [
    { id: '1', slug: '/worship/sermons', title: 'Sermons', status: 'published' },
    { id: '2', slug: '/media/sermons', title: 'Archive', status: 'published' },
    { id: '3', slug: '/about/beliefs', title: 'Beliefs', status: 'published' },
  ];
  const out = withShortLinks(rows);
  eq(out[0].shortLink, '/sermons', 'the link is attached to the row');
  ok(out[0].shortLinkClash, 'and so is the clash');
  eq(out[2].shortLinkClash, null, 'a clean row carries no clash');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// ── re-seeding ───────────────────────────────────────────────────────────────
// Improving the converter should reach pages nobody has touched, and must never
// reach one that someone has edited or published.
group('re-seeding an untouched draft');
{
  ok(canReseed({ updated_by: 'migration', published_blocks: null }), 'a page still exactly as the migration left it can take a better draft');
  ok(canReseed({ updated_by: 'migration', published_blocks: '' }), 'an empty published column counts as never published');

  ok(!canReseed({ updated_by: 'dinger', published_blocks: null }), 'a page someone has edited is left alone');
  ok(!canReseed({ updated_by: 'migration', published_blocks: '[]' }), 'a page that has been published is left alone');
  ok(!canReseed({ updated_by: 'dinger', published_blocks: '[{}]' }), 'edited and published is doubly left alone');
  ok(!canReseed({ updated_by: '', published_blocks: null }), 'an unknown editor is treated as a person, not the migration');
  ok(!canReseed(null), 'a page that does not exist cannot be re-seeded');
  ok(!canReseed(undefined), 'and neither can a missing row');
}
