// Smoke test for the v3.0.0 admin overhaul — run with:
//   node --experimental-loader ./test/html-loader.mjs test/admin-redesign.test.mjs
//
// This boots the real Worker against a real SQLite database (node:sqlite behind
// a D1-shaped shim) and asks for each redesigned screen the way a browser
// would, cookie and all. The point is to catch the class of mistake that unit
// tests on the renderers cannot see: a column that does not exist, a permission
// gate that locks out the person who should get in, a route that throws on an
// empty table.
//
// Every section is requested twice — once with data, once against empty tables —
// because "works when seeded" and "works on a fresh install" are different
// claims and the second one is what a new deploy actually hits.
import { DatabaseSync } from 'node:sqlite';
import worker from '../tlc-admin-worker.js';
import { ALL_PERMISSIONS } from '../admin/auth.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} — missing ${JSON.stringify(needle)}`);
const lacks = (hay, needle, msg) => ok(!String(hay).includes(needle), `${msg} — unexpectedly contains ${JSON.stringify(needle)}`);
const group = (n) => console.log('\n' + n);

// ── a D1-shaped shim over node:sqlite ────────────────────────────────────────
function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { try { return db.prepare(sql).get(...args) ?? null; } catch (e) { throw e; } },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    exec: async (sql) => { db.exec(sql); },
  };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
globalThis.fetch = async () => new Response('{}', { status: 200 });

// Boots a worker environment and runs the startup migration block by making
// one throwaway request, exactly as a fresh deploy does.
async function boot() {
  const db = new DatabaseSync(':memory:');
  const env = {
    DB: d1(db),
    IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} },
    BREVO_API_KEY: 'test',
  };
  // The first request through the worker runs every CREATE/ALTER/INSERT.
  await call(env, '/login');
  return { db, env };
}

async function call(env, path, { cookie = '', method = 'GET' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', 'https://admin.timothystl.org');
  const req = new Request('https://admin.timothystl.org' + path, { method, headers });
  return worker.fetch(req, env, ctx);
}

// A signed-in session, created directly in the tables the way login does.
function signIn(db, permissions = ALL_PERMISSIONS, username = 'dinger') {
  const token = 'a'.repeat(64);
  db.prepare('INSERT INTO users (username, password_hash, permissions, created_at, active) VALUES (?,?,?,?,1)')
    .run(username, 'pbkdf2:1:x:y', JSON.stringify(permissions), new Date().toISOString());
  const uid = db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  db.prepare('INSERT INTO sessions (token, user_id, username, permissions, expires_at, created_at) VALUES (?,?,?,?,?,?)')
    .run(token, uid, username, JSON.stringify(permissions),
      new Date(Date.now() + 864e5).toISOString(), new Date().toISOString());
  return { cookie: `tlc_session=${token}`, uid };
}

// ── the schema the overhaul adds ─────────────────────────────────────────────
group('schema');
{
  const { db } = await boot();
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);

  ok(cols('youth_pages').includes('value'), 'youth_pages carries a core value');
  ok(cols('news_items').includes('value'), 'news_items carries a core value');
  ok(cols('bible_classes').includes('value'), 'bible_classes carries a core value');
  ok(cols('youth_pages').includes('in_menu'), 'ministries have menu visibility separate from published state');

  const partners = db.prepare('SELECT * FROM partners ORDER BY sort_order').all();
  eq(partners.length, 4, 'four partners are seeded, one per value');
  eq(partners.map((p) => p.value).join(','), 'acceptance,worship,education,outreach', 'one partner per value, in value order');
  has(partners.find((p) => p.value === 'outreach').also_note, 'Papua New Guinea',
    'CFNA’s record names Pastor Rall and Mary Ann');
  has(partners.find((p) => p.value === 'education').site_url, 'wordoflifeschool.net',
    'Word of Life points at the school’s real domain, not the handoff’s');

  // UNIQUE(value) is what enforces "one partner per value" — a convention
  // nobody has to remember.
  let threw = false;
  try {
    db.prepare("INSERT INTO partners (name, value) VALUES ('Another', 'outreach')").run();
  } catch (_) { threw = true; }
  ok(threw, 'a second partner for one value is refused by the database');
}

// ── the permission rename, run for real ──────────────────────────────────────
group('permission migration');
{
  const db = new DatabaseSync(':memory:');
  const env = { DB: d1(db), IMAGES: {}, BREVO_API_KEY: 'test' };
  await call(env, '/login');   // builds the schema

  // Three accounts as they existed before the overhaul.
  const before = [
    ['office', ['news_edit', 'pages_edit']],              // notices, in old money
    ['sam.youth', ['site_pages_own', 'ministries_edit']], // a ministry leader
    ['admin', ['site_pages', 'users_manage']],            // the site editor
  ];
  for (const [u, perms] of before) {
    db.prepare('INSERT INTO users (username, password_hash, permissions, created_at, active) VALUES (?,?,?,?,1)')
      .run(u, 'x', JSON.stringify(perms), new Date().toISOString());
  }
  // Clear the marker so the migration runs over the rows just inserted.
  db.prepare("DELETE FROM _schema_version WHERE key = 'perm_rename_v3'").run();
  await call(env, '/login');

  const after = Object.fromEntries(db.prepare('SELECT username, permissions FROM users').all()
    .map((r) => [r.username, JSON.parse(r.permissions)]));

  ok(after.office.includes('notices_edit'), 'the old notices editor keeps notices');
  ok(!after.office.includes('pages_edit'), 'and does NOT gain the whole site editor');
  ok(after['sam.youth'].includes('pages_edit_own'), 'the ministry leader keeps their own pages');
  ok(!after['sam.youth'].includes('pages_edit'), 'and not everyone else’s');
  ok(after.admin.includes('pages_edit'), 'the real site editor keeps the site editor');
  ok(after.admin.includes('users_manage'), 'and their other permissions are untouched');

  // The marker must now be set, so a later deploy cannot run this twice.
  const marker = db.prepare("SELECT value FROM _schema_version WHERE key='perm_rename_v3'").get();
  eq(marker?.value, 'done', 'the one-time marker is stamped');

  // Prove the guard holds: bump the schema version (as any future migration
  // would) and confirm the rename does not re-run and demote the site editor.
  db.prepare("UPDATE _schema_version SET value='forced-rerun' WHERE key='version'").run();
  await call(env, '/login');
  const admin2 = JSON.parse(db.prepare("SELECT permissions FROM users WHERE username='admin'").get().permissions);
  ok(admin2.includes('pages_edit'), 'a SCHEMA_VERSION bump does not demote the site editor');
}

// ── every redesigned screen renders ──────────────────────────────────────────
const SCREENS = [
  ['/dashboard', 'Dashboard — needs you'],
  ['/dashboard?view=overview', 'Dashboard — overview'],
  ['/notices', 'Notices'],
  ['/christian-education', 'Christian Ed'],
  ['/newsitems', 'News & Events'],
  ['/sermons', 'Sermons'],
  ['/ministries', 'Ministries'],
  ['/partners', 'Partners'],
];

group('every section renders on an empty database');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  for (const [path, label] of SCREENS) {
    const res = await call(env, path, { cookie });
    eq(res.status, 200, `${label} responds 200 with nothing in the tables`);
    const body = await res.text();
    lacks(body, 'D1_ERROR', `${label} has no database error on its face`);
    lacks(body, 'no such column', `${label} does not name a missing column`);
    has(body, 'tlc-', `${label} renders through the shared pattern`);
  }
}

group('every section renders with data');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();

  db.prepare("INSERT INTO notices (page_slug,label,body,published,position,updated_at) VALUES ('about','Lent midweek','<p>Wednesdays</p>',1,0,?)").run(now);
  db.prepare("INSERT INTO notices (page_slug,label,body,published,position,updated_at) VALUES ('home','Unwritten','',1,0,?)").run(now);
  db.prepare("INSERT INTO news_items (title,summary,publish_date,expire_date,value) VALUES ('Egg Hunt','Come along','2026-03-01','2099-01-01','outreach')").run();
  // The worker seeds a row per ministry slug on first boot, so these are
  // updates — which is also the realistic case.
  db.prepare("UPDATE youth_pages SET title='Music Ministry', content='<p>Sing</p>', value='worship', in_menu=1 WHERE slug='music'").run();
  db.prepare("UPDATE youth_pages SET title='Youth', content='', value='outreach', in_menu=0 WHERE slug='youth'").run();
  db.prepare("INSERT INTO sermon_series (title,description,active,sort_order) VALUES ('Advent','Waiting',1,0)").run();
  db.prepare("INSERT INTO sermon_notes (series_id,date,title,scripture) VALUES (1,'2026-12-01','Hope','Isaiah 9')").run();
  db.prepare("INSERT INTO sermon_notes (date,title,scripture,youtube_url) VALUES ('2026-12-08','Peace','Luke 2','https://youtu.be/x')").run();

  for (const [path, label] of SCREENS) {
    const res = await call(env, path, { cookie });
    eq(res.status, 200, `${label} responds 200 with rows present`);
    const body = await res.text();
    lacks(body, 'D1_ERROR', `${label} has no database error`);
    lacks(body, 'no such column', `${label} does not name a missing column`);
  }

  // Content actually reaches the page.
  const notices = await (await call(env, '/notices', { cookie })).text();
  has(notices, 'Lent midweek', 'a notice appears in the list');
  has(notices, 'Empty', 'a notice with no body is flagged Empty');
  has(notices, 'Nothing has been written', 'and grows a warning row saying why it matters');

  const news = await (await call(env, '/newsitems', { cookie })).text();
  has(news, 'Egg Hunt', 'a news post appears');
  has(news, 'Go', 'and shows its core-value chip');

  const sermons = await (await call(env, '/sermons', { cookie })).text();
  has(sermons, 'Advent', 'the series appears');
  has(sermons, 'Hope', 'with its sermon indented beneath');

  const dash = await (await call(env, '/dashboard', { cookie })).text();
  has(dash, 'Our four values', 'the dashboard reports on the church’s own priorities');
  has(dash, 'Word of Life', 'each value names the partner ministry paired to it');
  has(dash, 'Nothing new posted', 'a value with no recent posts says so plainly');
  has(dash, 'Needs you', 'the worklist is the default view');

  const overview = await (await call(env, '/dashboard?view=overview', { cookie })).text();
  has(overview, 'tlc-tile', 'the Overview alternative renders its stat tiles');

  const partners = await (await call(env, '/partners', { cookie })).text();
  has(partners, 'Christian Friends of New Americans', 'the partner list shows the seeded records');
  has(partners, 'Papua New Guinea', 'and surfaces CFNA’s missionaries as a note on the row');
  has(partners, 'lasmstl.org', 'with each partner’s own site');
  lacks(partners, '<span class="tlc-th">Status</span>',
    'no Status column — every partner is shown, so it would say the same on every row');

  const ministries = await (await call(env, '/ministries', { cookie })).text();
  has(ministries, 'In menu', 'ministries separate menu visibility from published state');
  has(ministries, 'Not listed', 'and a ministry taken out of the menu says so');
}

// ── one partner per value, enforced by the database ──────────────────────────
group('one partner per value');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // Deleting the outreach partner must leave the value visibly unpaired rather
  // than quietly showing three.
  db.prepare("DELETE FROM partners WHERE value='outreach'").run();
  const body = await (await call(env, '/partners', { cookie })).text();
  has(body, 'No partner for Go', 'a value with no partner is shown as a gap');
  has(body, 'will say this value has no partner', 'and explains what the public page will do');

  // The route refuses a duplicate rather than overwriting the incumbent.
  const form = new URLSearchParams({ name: 'Someone Else', value: 'education' });
  const res = await worker.fetch(new Request('https://admin.timothystl.org/partners/create', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }), env, ctx);
  eq(res.status, 302, 'a duplicate value redirects rather than erroring');
  has(res.headers.get('location'), 'msg=taken', 'and says the value is already taken');
  const stillWol = db.prepare("SELECT name FROM partners WHERE value='education'").get();
  eq(stillWol.name, 'Word of Life Lutheran School', 'the incumbent partner is not overwritten');
}

// ── permissions are enforced in the route, not just the UI ───────────────────
group('access control');
{
  const { db, env } = await boot();
  // A ministry leader: their own pages, ministries, news. Nothing else.
  const { cookie } = signIn(db, ['pages_edit_own', 'ministries_edit', 'news_edit'], 'sam.youth');

  eq((await call(env, '/ministries', { cookie })).status, 200, 'a ministry leader reaches Ministries');
  eq((await call(env, '/notices', { cookie })).status, 403, 'but not Notices');
  eq((await call(env, '/partners', { cookie })).status, 403, 'and not Partners');
  eq((await call(env, '/payroll', { cookie })).status, 403, 'and certainly not Payroll');

  // The sidebar must not advertise what the routes will refuse.
  const body = await (await call(env, '/ministries', { cookie })).text();
  lacks(body, 'href="/payroll"', 'the sidebar hides Payroll from someone who cannot open it');
  lacks(body, 'href="/notices"', 'and hides Notices too');
  has(body, 'href="/ministries"', 'while showing what they can reach');
}
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['notices_edit'], 'office');
  eq((await call(env, '/notices', { cookie })).status, 200, 'notices_edit opens Notices');
  eq((await call(env, '/voters', { cookie })).status, 200, 'and the Voters page, which shares the gate');
}

// ── badges and the worklist agree ────────────────────────────────────────────
group('badges match the worklist');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO gym_groups (name,contact,email,active) VALUES ('Southside Volleyball','Ann','a@b.co',1)").run();
  for (const d of ['2099-01-01', '2099-01-08', '2099-01-15']) {
    db.prepare("INSERT INTO gym_bookings (group_id,booking_date,start_time,end_time,status,created_at) VALUES (1,?,'18:00','20:00','hold',?)")
      .run(d, new Date().toISOString());
  }
  const body = await (await call(env, '/dashboard', { cookie })).text();
  has(body, '3 gym requests waiting for review', 'the worklist counts the holds');
  has(body, 'Southside Volleyball', 'and names who is waiting');
  has(body, '<span class="sidebar-badge"', 'the sidebar carries a badge');
  // The badge and the worklist read the same query, so the number must match.
  // Match the gym badge by its own title — the sidebar carries several.
  const badge = body.match(/class="sidebar-badge" title="(\d+) gym request[^"]*">(\d+)</);
  eq(badge && badge[2], '3', 'and it is the same number the worklist shows');
}


// ── phase 3: short links, clashes, redirects ─────────────────────────────────
group('short links on the Pages screen');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();

  ok(db.prepare('PRAGMA table_info(pages)').all().some((c) => c.name === 'short_link'),
    'pages carries a short_link override column');

  // The Worker seeds the real site's pages on boot. Clear them so this test
  // owns its fixture and asserts against addresses it chose.
  db.prepare('DELETE FROM pages').run();
  const mk = (id, title, slug, parent) => db.prepare(
    "INSERT INTO pages (id,title,slug,parent_id,sort,template,status,in_menu,blocks,published_blocks,updated_at) VALUES (?,?,?,?,0,'standard','published',1,'[]','[]',?)"
  ).run(id, title, slug, parent || null, now);

  mk('about', 'About Us', '/about');
  mk('beliefs', 'What We Believe', '/about/beliefs', 'about');

  let body = await (await call(env, '/pages', { cookie })).text();
  has(body, 'Short link', 'the Pages list has a Short link column');
  has(body, '/beliefs', 'a child page shows its derived short link');
  lacks(body, 'Link clash', 'nothing clashes yet');

  // Two pages both deriving /sermons.
  mk('sermons', 'Sermons', '/worship/sermons');
  mk('archive', 'Sermon Archive', '/media/sermons');
  body = await (await call(env, '/pages', { cookie })).text();
  has(body, 'Link clash', 'a collision is flagged');
  has(body, 'already taken by the', 'with a warning row that names the other page');
  has(body, 'Fix short link', 'and an action to resolve it');

  // Resolving it by hand clears both.
  const res = await worker.fetch(new Request('https://admin.timothystl.org/pages/archive/link', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'short_link=archive',
  }), env, ctx);
  eq(res.status, 302, 'saving a short link redirects');
  eq(db.prepare("SELECT short_link FROM pages WHERE id='archive'").get().short_link, 'archive', 'and stores it normalised');

  body = await (await call(env, '/pages', { cookie })).text();
  lacks(body, 'Link clash', 'giving one of them a different short link clears the clash');

  // The form itself.
  const form = await (await call(env, '/pages/beliefs/link', { cookie })).text();
  has(form, 'timothystl.org/', 'the short-link form shows the address it builds');
  has(form, 'follow the page address automatically', 'and explains what blank means');
}

group('short links reach the public API');
{
  const { db, env } = await boot();
  const now = new Date().toISOString();
  db.prepare('DELETE FROM pages').run();
  const mk = (id, title, slug, parent, blocks) => db.prepare(
    "INSERT INTO pages (id,title,slug,parent_id,sort,template,status,in_menu,blocks,published_blocks,updated_at) VALUES (?,?,?,?,0,'standard','published',1,?,?,?)"
  ).run(id, title, slug, parent || null, blocks || '[]', blocks || '[]', now);

  mk('about', 'About Us', '/about');
  mk('beliefs', 'What We Believe', '/about/beliefs', 'about');

  let api = await (await call(env, '/api/pages')).json();
  eq(api.redirects['/beliefs'], '/about/beliefs', 'a short link is published as a route');
  eq('/about' in api.redirects, false, 'a page already at its own address needs no route');

  // A clash publishes nothing at all — better a 404 than an address said out
  // loud on Sunday quietly reaching the wrong page.
  mk('s1', 'Sermons', '/worship/sermons');
  mk('s2', 'Archive', '/media/sermons');
  api = await (await call(env, '/api/pages')).json();
  eq('/sermons' in api.redirects, false, 'a clashing short link is published for neither page');

  // A rename 301 must beat a short link on the same address: the old address
  // is a promise already in bulletins and in Google.
  db.prepare("INSERT INTO page_redirects (from_slug,to_slug,created_at) VALUES ('/beliefs','/about/what-we-believe',?)").run(now);
  api = await (await call(env, '/api/pages')).json();
  eq(api.redirects['/beliefs'], '/about/what-we-believe',
    'a rename 301 wins over a short link wanting the same address');
}

group('the Redirects screen shows every kind');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO redirects (path,url,label,category,active) VALUES ('zoom','https://us02web.zoom.us/j/314','Zoom','general',1)").run();
  db.prepare("INSERT INTO redirects (path,url,label,category,active) VALUES ('market','https://square.link/x','Market vendor','giving',1)").run();
  db.prepare("INSERT INTO page_redirects (from_slug,to_slug,created_at) VALUES ('/about/our-staff','/about/staff',?)").run(now);
  db.prepare('DELETE FROM pages').run();
  db.prepare("INSERT INTO pages (id,title,slug,parent_id,sort,template,status,in_menu,blocks,published_blocks,updated_at) VALUES ('b','Beliefs','/about/beliefs',NULL,0,'standard','published',1,'[]','[]',?)").run(now);

  const body = await (await call(env, '/settings', { cookie })).text();
  has(body, '/zoom', 'a hand-made redirect appears');
  has(body, 'Hand-made', 'labelled by kind');
  has(body, '/about/our-staff', 'an automatic 301 from a rename appears');
  has(body, 'Automatic', 'labelled as automatic');
  has(body, 'Leave it', 'and staff are told not to touch it');
  has(body, '/beliefs', 'a derived short link appears too');
  has(body, 'Short link', 'labelled as such');
  has(body, 'Giving', 'and a giving link, managed elsewhere but listed here');
  has(body, 'last year’s bulletins', 'the section note explains why automatics matter');
}


// ── phase 4: the menu ────────────────────────────────────────────────────────
group('the menu is seeded from the nav as it stands');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const header = db.prepare("SELECT * FROM menu_items WHERE menu='header' ORDER BY sort_order").all();
  const footer = db.prepare("SELECT * FROM menu_items WHERE menu='footer' ORDER BY sort_order").all();
  ok(header.length >= 8, 'the header is seeded');
  ok(footer.length >= 8, 'and so is the footer');
  eq(header.filter((i) => i.style === 'button').length, 1, 'exactly one button in the header');
  eq(header.find((i) => i.style === 'button').page_id, 'give', 'and it is Give');

  // The case `pages` could not express, and the reason this is its own table.
  const gives = db.prepare("SELECT menu FROM menu_items WHERE page_id='give'").all().map((r) => r.menu);
  ok(gives.includes('header') && gives.includes('footer'), 'one page appears in both menus');

  // External items have no page row at all.
  const ext = db.prepare("SELECT * FROM menu_items WHERE kind='external'").all();
  ok(ext.length >= 3, 'the outside sites are menu items with no page behind them');
  ok(ext.some((i) => i.target.includes('wordoflifeschool.net')), 'including Word of Life');

  const body = await (await call(env, '/menu', { cookie })).text();
  eq((await call(env, '/menu', { cookie })).status, 200, 'the Menu screen renders');
  has(body, 'Live preview', 'with a live preview of the real bar');
  has(body, 'Word of Life School', 'listing the outside links');
  has(body, 'Live pages not in the menu', 'and the orphan panel');
  has(body, 'Drag a row by its', 'explaining how to reorder');
}

group('the menu never records a page address');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  // Rename a page's address directly; every menu item pointing at it must move
  // with it, because none of them wrote the address down.
  db.prepare("UPDATE pages SET slug='/plan-a-visit' WHERE id='about'").run();
  const api = await (await call(env, '/api/pages')).json();
  const about = api.menu.header.find((i) => i.label === 'About');
  eq(about && about.href, '/plan-a-visit', 'renaming a page moves its menu item with it');
}

group('broken menu items are flagged, never dropped');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("UPDATE pages SET status='draft' WHERE id='worship'").run();

  const body = await (await call(env, '/menu', { cookie })).text();
  has(body, 'is a draft', 'the admin flags an item pointing at a draft page');
  has(body, 'Worship', 'and still shows it, so a human can decide');

  // The site must not render it.
  const api = await (await call(env, '/api/pages')).json();
  ok(!api.menu.header.some((i) => i.label === 'Worship'), 'but the site leaves it out entirely');
}

group('removing a menu item leaves the page alone');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const item = db.prepare("SELECT id FROM menu_items WHERE menu='header' AND page_id='sermons'").get();
  const res = await worker.fetch(new Request(`https://admin.timothystl.org/menu/remove/${item.id}`, {
    method: 'POST', headers: { cookie, origin: 'https://admin.timothystl.org' },
  }), env, ctx);
  eq(res.status, 302, 'removing redirects');
  eq(db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE id = ?').get(item.id).n, 0, 'the item is gone');
  eq(db.prepare("SELECT status FROM pages WHERE id='sermons'").get().status, 'published', 'the page is untouched and still live');

  const body = await (await call(env, '/menu', { cookie })).text();
  has(body, 'Live pages not in the menu', 'and it reappears in the orphan panel');
}

group('reordering renumbers from scratch');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const ids = db.prepare("SELECT id FROM menu_items WHERE menu='header' ORDER BY sort_order").all().map((r) => r.id);
  const reversed = ids.slice().reverse().map((id) => ({ id, menu: 'header', depth: 0 }));
  const res = await worker.fetch(new Request('https://admin.timothystl.org/menu/reorder', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'order=' + encodeURIComponent(JSON.stringify(reversed)),
  }), env, ctx);
  eq(res.status, 302, 'reordering redirects');
  const after = db.prepare("SELECT id FROM menu_items WHERE menu='header' ORDER BY sort_order").all().map((r) => r.id);
  eq(after.join(','), ids.slice().reverse().join(','), 'the new order is stored');
  // No two items may claim one position.
  const orders = db.prepare("SELECT sort_order FROM menu_items WHERE menu='header'").all().map((r) => r.sort_order);
  eq(new Set(orders).size, orders.length, 'and every position is unique');
}

group('menu access control');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['notices_edit'], 'office');
  eq((await call(env, '/menu', { cookie })).status, 403, 'the menu needs pages_edit');
}


// ── phase 5: the newsletter ──────────────────────────────────────────────────
const form = (obj) => {
  const b = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) v.forEach((x) => b.append(k, x)); else b.append(k, v);
  }
  return b.toString();
};
const post = (env, path, cookie, body) => worker.fetch(new Request('https://admin.timothystl.org' + path, {
  method: 'POST',
  headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
  body,
}), env, ctx);

group('the newsletter list');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,published_at,status) VALUES (1,'Advent begins','<p>Hi</p>','2026-12-01','draft')").run();
  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,published_at,status,sent_at,sent_count) VALUES (2,'Last week','<p>Hi</p>','2026-07-24','published','2026-07-24T10:00:00Z',609)").run();

  // The list is the unmatched fall-through, addressed as /newsletters — '/'
  // itself redirects to the dashboard.
  const body = await (await call(env, '/newsletters', { cookie })).text();
  has(body, 'Advent begins', 'a draft appears');
  // en-US ordering: the handoff writes "24 July", but every other date in
  // this admin reads American and so do its readers.
  has(body, 'Sent July 24 to 609 subscribers', 'a sent issue keeps its real send record');
  has(body, 'Duplicate as draft', 'and offers duplication rather than editing');
  has(body, 'read-only', 'the section note states the rule');
}

group('a sent issue cannot be modified by any path');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,published_at,status,sent_at) VALUES (7,'Already sent','<p>Original</p>','2026-07-24','published','2026-07-24T10:00:00Z')").run();

  // The direct POST — the path a stale tab or a crafted request takes.
  const res = await post(env, '/publish', cookie, form({
    newsletter_id: '7', subject: 'Rewritten', pastor_note: '<p>Tampered</p>',
    published_at: '2026-07-24', format: 'weekly', action: 'publish',
  }));
  eq(res.status, 302, 'the write is refused with a redirect');
  has(res.headers.get('location'), 'msg=locked', 'and says why');

  const after = db.prepare('SELECT subject, pastor_note FROM newsletters WHERE id=7').get();
  eq(after.subject, 'Already sent', 'the subject is untouched');
  eq(after.pastor_note, '<p>Original</p>', 'and so is the body — the archive still says what was sent');

  // The editor shows it read-only rather than pretending it is editable.
  const page = await (await call(env, '/edit/7', { cookie })).text();
  has(page, 'Sent newsletter', 'the editor titles it as sent');
  has(page, 'read-only', 'explains the lock');
  has(page, 'Duplicate as draft', 'and offers the way forward');
}

group('duplicating a sent issue gives an editable draft');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,published_at,status,sent_at) VALUES (8,'Sent issue','<p>Body</p>','2026-07-24','published','2026-07-24T10:00:00Z')").run();
  const res = await post(env, '/newsletter/duplicate/8', cookie, '');
  eq(res.status, 302, 'duplication redirects');
  const copy = db.prepare("SELECT * FROM newsletters WHERE id <> 8 ORDER BY id DESC LIMIT 1").get();
  ok(copy, 'a copy exists');
  eq(copy.status, 'draft', 'and it is a draft');
  eq(copy.sent_at, null, 'with no send record of its own');
  eq(canEditsCheck(copy), true, 'so it can be edited');
}
function canEditsCheck(row) {
  return !(row.status === 'sent' || row.sent_at || row.beehiiv_id || row.brevo_campaign_id);
}

group('block switches survive a save');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,published_at,status) VALUES (9,'Light week','<p>Hi</p>','2026-12-01','draft')").run();

  // Every switch was on the page; two of them were turned off.
  const keys = ['secondary','news','events','classes','sermon','wol','lasm','tertiary','cta','bulletin'];
  await post(env, '/publish', cookie, form(Object.assign({
    newsletter_id: '9', subject: 'Light week', published_at: '2026-12-01',
    format: 'weekly', action: 'draft', pastor_note: '<p>Hi</p>',
    block_seen: keys,
  }, Object.fromEntries(keys.filter((k) => k !== 'wol' && k !== 'lasm').map((k) => ['block_' + k, '1'])))));

  const saved = JSON.parse(db.prepare('SELECT blocks FROM newsletters WHERE id=9').get().blocks);
  eq(saved.wol, false, 'a switch turned off is stored off');
  eq(saved.lasm, false, 'for each one');
  eq(saved.news, true, 'a switch left on stays on');
  eq(saved.pastor, true, 'and the locked block is always on');
}

group('a brand-new issue does not save itself empty');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  // The new-newsletter form renders no block switches at all. If that were read
  // as "everything off", a first issue would ship with nothing in it.
  await post(env, '/publish', cookie, form({
    subject: 'First issue', published_at: '2026-12-01', format: 'weekly',
    action: 'draft', pastor_note: '<p>Hello</p>',
  }));
  const row = db.prepare("SELECT blocks FROM newsletters WHERE subject='First issue'").get();
  eq(row.blocks, null, 'no switches on the form stores null, not all-false');
}

group('the preview is built by the same code that sends');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const res = await post(env, '/newsletter/preview', cookie, form({
    subject: 'Preview me', published_at: '2026-12-01', format: 'weekly',
    pastor_note: '<p>A word from the pastor</p>',
    block_pastor: '1', block_wol: '1', wol_content: '<p>School news</p>',
  }));
  eq(res.status, 200, 'the preview renders');
  const html = await res.text();
  has(html, 'A word from the pastor', 'and contains what was typed');
  has(html, 'School news', 'including a block that is switched on');

  // A switched-off block must be absent from the preview, or the preview lies
  // about what will be sent.
  const off = await (await post(env, '/newsletter/preview', cookie, form({
    subject: 'Preview me', published_at: '2026-12-01', format: 'weekly',
    pastor_note: '<p>A word from the pastor</p>',
    wol_content: '<p>School news</p>',
  }))).text();
  ok(!off.includes('School news'), 'a switched-off block is absent from the preview too');
}

group('newsletter access control');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['news_edit'], 'newsonly');
  eq((await call(env, '/new', { cookie })).status, 403, 'news_edit alone cannot write newsletters');
  eq((await post(env, '/newsletter/preview', cookie, 'subject=x')).status, 403, 'nor build a preview');
}


// ── phase 6: staff, users, subscribers ───────────────────────────────────────
group('staff, users and subscribers on the shared pattern');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO staff_members (name,title,email,photo_url,display_order) VALUES ('Andrew Dinger','Lead Pastor','dinger@timothystl.org','/images/a.jpg',10)").run();
  db.prepare("INSERT INTO staff_members (name,title,email,display_order) VALUES ('Chau Vo','Pastor',NULL,20)").run();
  db.prepare("INSERT INTO newsletter_subscribers (email,name,subscribed_at) VALUES ('a@b.co','Ann Brown','2026-05-01T00:00:00Z')").run();

  for (const [path, label] of [['/staff', 'Staff'], ['/users', 'Users'], ['/subscribers', 'Subscribers']]) {
    const res = await call(env, path, { cookie });
    eq(res.status, 200, `${label} responds 200`);
    const body = await res.text();
    lacks(body, 'D1_ERROR', `${label} has no database error`);
    lacks(body, 'no such column', `${label} names no missing column`);
    has(body, 'tlc-section', `${label} renders through the shared pattern`);
    has(body, 'tlc-note-mark', `${label} states the rule it enforces`);
  }

  const staff = await (await call(env, '/staff', { cookie })).text();
  has(staff, 'Andrew Dinger', 'a staff member appears');
  has(staff, 'Lead Pastor', 'with their role as the sub-line');
  has(staff, 'No photo', 'and somebody without a photo is flagged');
  has(staff, 'crop is set once', 'the note explains why the crop lives on the person');

  const users = await (await call(env, '/users', { cookie })).text();
  has(users, 'Full access', 'the admin account reads as full access');
  has(users, 'Disabling an account keeps its history', 'the note distinguishes disable from delete');

  const subs = await (await call(env, '/subscribers', { cookie })).text();
  has(subs, 'Ann Brown', 'a website signup appears');
  has(subs, 'Never delete somebody to unsubscribe', 'the note states the rule that matters');
  // Brevo is unreachable in the harness, so the error path must still render
  // the website signups rather than showing an empty screen.
  has(subs, 'Website signup', 'website signups show even when Brevo cannot be read');
}

group('the permission checkboxes are the truth');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const body = await (await call(env, '/users/new', { cookie })).text();
  // Each row prints its key so the screen and the code use the same word.
  for (const key of ['newsletter_edit', 'pages_edit', 'notices_edit', 'pages_edit_own', 'payroll_manage']) {
    has(body, `<code class="tlc-perm-key">${key}</code>`, `the drawer shows the ${key} key in monospace`);
  }
  has(body, 'tlc-preset', 'presets sit above the checkboxes');
  has(body, 'Office staff', 'including the office preset');
  has(body, 'Ministry leader', 'and the ministry-leader preset');
  has(body, 'Full access', 'and full access');
}


// ── phase 7: gym, both layouts ───────────────────────────────────────────────
group('gym rentals ships both layouts');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();
  const month = now.slice(0, 7);
  db.prepare("INSERT INTO gym_groups (id,name,contact,email,active) VALUES (1,'Southside Volleyball','Ann','a@b.co',1)").run();
  db.prepare("INSERT INTO gym_bookings (group_id,booking_date,start_time,end_time,status,created_at) VALUES (1,?,'18:00','20:00','hold',?)")
    .run(`${month}-14`, now);
  db.prepare("INSERT INTO gym_bookings (group_id,booking_date,start_time,end_time,status,created_at) VALUES (1,?,'18:00','20:00','confirmed',?)")
    .run(`${month}-21`, now);
  db.prepare("INSERT INTO gym_blocked_dates (date,reason) VALUES (?,'Christmas Market')").run(`${month}-24`);

  const queue = await (await call(env, '/gym-rentals', { cookie })).text();
  eq((await call(env, '/gym-rentals', { cookie })).status, 200, 'the queue view responds');
  has(queue, 'Gym view', 'the layout toggle is present');
  has(queue, 'Southside Volleyball', 'and the queue still lists holds by group');
  has(queue, 'Confirm All', 'with its bulk actions intact');

  const cal = await (await call(env, '/gym-rentals?view=calendar', { cookie })).text();
  eq((await call(env, '/gym-rentals?view=calendar', { cookie })).status, 200, 'the calendar view responds');
  has(cal, 'gymcal-grid', 'the month grid renders');
  has(cal, 'gymcal-chip--hold', 'a hold is colour-coded');
  has(cal, 'gymcal-chip--confirmed', 'and so is a confirmed booking');
  has(cal, 'Christmas Market', 'a blocked date is shown with its reason');
  has(cal, 'Confirming, releasing and invoicing all happen in the Queue view',
    'the calendar says where bookings actually change, so there is one place to do it');

  // Month navigation must not lose the view.
  has(cal, 'view=calendar&m=', 'month navigation keeps the calendar view');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
