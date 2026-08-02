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

async function call(env, path, { cookie = '', method = 'GET', form = null } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', 'https://admin.timothystl.org');
  let body;
  if (form) {
    body = new URLSearchParams(form).toString();
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  const req = new Request('https://admin.timothystl.org' + path, { method, headers, body });
  return worker.fetch(req, env, ctx);
}

// A signed-in session, created directly in the tables the way login does.
let tokenSeq = 0;
function signIn(db, permissions = ALL_PERMISSIONS, username = 'dinger') {
  // A distinct token per sign-in, so a test can hold two sessions at once —
  // which is how the permission-scoping of search gets checked.
  tokenSeq += 1;
  const token = String(tokenSeq).padStart(2, '0').repeat(32).slice(0, 64);
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
  // The design shows this as a switch, not a pill — it is a thing you flip,
  // and flipping it posts immediately.
  has(ministries, 'tlc-switch', 'and In menu is a switch');
  has(ministries, '/ministries/toggle-menu/', 'that posts on click');
  has(ministries, 'Ministry pages', 'the title comes from the design config');
  has(ministries, 'Short link', 'and the Short link column is present');
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

  // Resolving it by hand clears both. The short link is a field in the Details
  // drawer now, not a screen of its own — one place a page's name, address and
  // short link are edited rather than two that can disagree.
  const res = await worker.fetch(new Request('https://admin.timothystl.org/pages/archive/details', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'title=Sermon+Archive&slug=%2Fmedia%2Fsermons&short_link=archive&external_url=',
  }), env, ctx);
  eq(res.status, 302, 'saving the details redirects');
  eq(db.prepare("SELECT short_link FROM pages WHERE id='archive'").get().short_link, 'archive', 'and stores the short link normalised');

  body = await (await call(env, '/pages', { cookie })).text();
  lacks(body, 'Link clash', 'giving one of them a different short link clears the clash');

  // The drawer itself, and the old address still leads to it.
  const drawer = await (await call(env, '/pages/beliefs/details', { cookie })).text();
  has(drawer, 'Short link', 'the drawer carries the short-link field');
  has(drawer, 'Clear it to switch off', 'and explains what blank means');
  has(drawer, 'Open in page editor', 'with content reached from here rather than edited here');
  const moved = await call(env, '/pages/beliefs/link', { cookie });
  eq(moved.status, 302, 'the old short-link address still leads somewhere');
  eq(moved.headers.get('location'), '/pages/beliefs/details', 'namely the drawer');
}

group('a new page starts from a starter');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const picker = await (await call(env, '/pages/new', { cookie })).text();
  has(picker, 'Starts as', 'the action opens a starter picker rather than creating a page outright');
  has(picker, 'Homepage', 'with the homepage starter');
  has(picker, 'Simple text page', 'the plain one');
  has(picker, 'Ministry page', 'the ministry one');
  has(picker, 'Sign-up page', 'and the sign-up one');
  has(picker, 'begins as a draft', 'and says nothing reaches the site until Publish');

  const made = await worker.fetch(new Request('https://admin.timothystl.org/pages/new', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'title=Plan+a+Visit&starter=home',
  }), env, ctx);
  eq(made.status, 302, 'creating one lands in the editor');
  const row = db.prepare("SELECT * FROM pages WHERE title='Plan a Visit'").get();
  ok(row, 'the page exists');
  eq(row.status, 'draft', 'as a draft — a new page is never live by accident');
  eq(row.slug, '/plan-a-visit', 'with an address derived from its name');
  eq(row.published_blocks, null, 'and nothing published');
  const blocks = JSON.parse(row.blocks);
  ok(blocks.length > 1, 'the starter put a working page in the draft');
  eq(blocks[0].card, 'right', 'and the homepage starter switched the info card on');
}

group('a page can stand in for another site');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();
  db.prepare('DELETE FROM pages').run();
  db.prepare(
    "INSERT INTO pages (id,title,slug,parent_id,sort,template,status,in_menu,blocks,published_blocks,external_url,updated_at) " +
    "VALUES ('mdo','Mother’s Day Out','/mdo',NULL,0,'standard','published',1,'[]','[]','https://mdo.timothystl.org',?)"
  ).run(now);

  const body = await (await call(env, '/pages', { cookie })).text();
  has(body, 'Links out', 'the list says the page links out');
  has(body, 'mdo.timothystl.org', 'and where to');
  lacks(body, '/pages/mdo/edit', 'with no editor to open — there is nothing in it to edit');

  // The public API sends the visitor to the other site rather than rendering a
  // page that would redirect out from under them.
  const api = await (await call(env, '/api/pages')).json();
  eq(api.redirects['/mdo'], 'https://mdo.timothystl.org', 'the address resolves to the outside site');
  ok(!api.rendered.mdo, 'and nothing is rendered for it');
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

  // Redirects has its own address now. /settings is the Settings screen, which
  // is a different section in the design and lists site_settings keys.
  const body = await (await call(env, '/redirects', { cookie })).text();
  has(body, '/zoom', 'a hand-made redirect appears');
  has(body, 'Hand-made', 'labelled by kind');
  has(body, '/about/our-staff', 'an automatic 301 from a rename appears');
  has(body, 'Automatic', 'labelled as automatic');
  has(body, 'Leave it', 'and staff are told not to touch it');
  has(body, '/beliefs', 'a derived short link appears too');
  has(body, 'Short link', 'labelled as such');
  has(body, 'Giving', 'and a giving link, managed elsewhere but listed here');
  has(body, 'keeps old bulletins and Google results working', 'the note is the design’s wording, not mine');

  // The drawer is the one place a redirect is written, and it opens on its own
  // address so a half-filled form survives a refresh.
  const drawer = await (await call(env, '/redirects/edit/zoom', { cookie })).text();
  has(drawer, 'Edit /zoom', 'editing one opens a drawer named for it');
  has(drawer, 'us02web.zoom.us', 'prefilled with where it currently goes');
  has(drawer, 'original_path', 'and carries the old path, so renaming it moves rather than duplicates');
}

group('Settings lists the keys the rest of the site reads');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO site_settings (key,value) VALUES ('zoom_url','https://us02web.zoom.us/j/314') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();

  const body = await (await call(env, '/settings', { cookie })).text();
  has(body, 'Zoom meeting link', 'a setting is named in plain language');
  has(body, 'zoom_url', 'and the real key is shown, because that is what the code uses');
  has(body, 'The /zoom short link', 'with what reads it');
  has(body, 'Church address', 'church details are listed');
  has(body, 'Gym rate per hour', 'so are the gym ones');
  has(body, 'These are the real keys in site_settings', 'the note is the design’s wording');

  // A setting with a screen of its own sends you there rather than offering a
  // second field writing the same key.
  has(body, '/pages/details', 'church details open on their own screen');
  has(body, '/gym-rentals', 'and the gym ones on theirs');

  // Only the listed keys can be written — the old form took any key in the body.
  const bad = await call(env, '/settings/update', {
    method: 'POST', cookie, form: { key: 'admin_password', value: 'x' },
  });
  eq(bad.headers.get('location'), '/settings?msg=settings-error', 'an unlisted key is refused');
  const pw = db.prepare("SELECT value FROM site_settings WHERE key='admin_password'").get();
  eq(pw, undefined, 'and nothing was written');

  const good = await call(env, '/settings/update', {
    method: 'POST', cookie, form: { key: 'zoom_url', value: 'https://zoom.example/new' },
  });
  eq(good.headers.get('location'), '/settings?msg=saved', 'a listed key saves');
  eq(db.prepare("SELECT value FROM site_settings WHERE key='zoom_url'").get().value,
    'https://zoom.example/new', 'and the value really changed');
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
  // The Sends column is the question people bring to this screen: did it go,
  // and to how many. A sent issue reports what it actually reached.
  has(body, '>609<', 'a sent issue keeps its real send count');
  // en-US ordering: the handoff writes "24 July", but every other date in
  // this admin reads American and so do its readers.
  has(body, 'Sent Fri, Jul 24', 'and says when, as a date somebody can read');
  has(body, 'Sends Tue, Dec 1', 'an unsent issue says when it will go instead');
  has(body, 'Duplicate as draft', 'and offers duplication rather than editing');
  has(body, 'change a post and the unsent issue follows', 'the note is the design’s wording, not mine');
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
  has(page, '>Sent<', 'the editor carries the same Sent pill as the list');
  has(page, 'read-only', 'explains the lock');
  has(page, 'Duplicate as draft', 'and offers the way forward');
  has(page, 'tlc-nl-cols', 'and is the two-column editor — form beside a live preview');
  has(page, 'Live preview', 'which is labelled');
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
  has(staff, 'Photo crop is set per person', 'the note is the design\u2019s wording, not mine');

  const users = await (await call(env, '/users', { cookie })).text();
  has(users, 'Full access', 'the admin account reads as full access');
  has(users, 'the checkboxes are the truth', 'the note is the design\u2019s wording, not mine');

  const subs = await (await call(env, '/subscribers', { cookie })).text();
  has(subs, 'Ann Brown', 'a website signup appears');
  has(subs, 'never delete by hand to remove someone', 'the note is the design’s wording, not mine');
  has(subs, 'Import CSV', 'the section’s one action is the design’s');
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

  // Queue first is the other layout, reached deliberately.
  const queue = await (await call(env, '/gym-rentals?view=queue', { cookie })).text();
  eq((await call(env, '/gym-rentals?view=queue', { cookie })).status, 200, 'the queue view responds');
  has(queue, 'Calendar first', 'the design’s layout toggle is present');
  has(queue, 'Queue first', 'both ways round');
  has(queue, 'Southside Volleyball', 'a group appears in the queue');
  has(queue, 'Conflicts', 'the design’s Conflicts column');
  has(queue, 'tlc-gym-approve', 'a hold carries the Approve action');
  has(queue, 'tlc-gym-open', 'and Open beside it');
  has(queue, 'Groups book through their own portal link', 'the purpose line is the design’s');
  // The bulk tools carry the invoice generation and the calendar push. They
  // moved below the queue; they were not replaced by it.
  has(queue, 'Confirm All', 'the bulk actions are intact');
  has(queue, 'By organisation', 'under their own heading');
  has(queue, '/gym-rentals/invoices', 'and invoices are still reachable');

  // A hold on a blocked date is the one thing on this screen that is wrong.
  db.prepare("INSERT INTO gym_bookings (group_id,booking_date,start_time,end_time,status,created_at) VALUES (1,?,'18:00','20:00','hold',?)")
    .run(`${month}-24`, now);
  const clash = await (await call(env, '/gym-rentals?view=queue', { cookie })).text();
  has(clash, 'Blocked date', 'a hold on a blocked date says so in the Conflicts column');
  has(clash, 'will double-book the gym', 'and grows a warning row saying what approving it would do');

  // Calendar first is the DEFAULT — the month is what somebody wants to see
  // before deciding anything, so a bare /gym-rentals must land on it.
  const cal = await (await call(env, '/gym-rentals', { cookie })).text();
  eq((await call(env, '/gym-rentals', { cookie })).status, 200, 'the calendar view responds');
  has(cal, 'gymcal-grid', 'the month grid renders by default');
  has(cal, 'gymcal-chip--hold', 'a hold is colour-coded');
  has(cal, 'gymcal-chip--confirmed', 'and so is a confirmed booking');
  has(cal, 'Christmas Market', 'a blocked date is shown with its reason');
  has(cal, 'Everything else about a booking', 'the calendar says where bookings actually change');

  // The two panels the design puts under the month.
  has(cal, 'Requests to review', 'the review panel sits under the month');
  has(cal, 'tlc-gym-release', 'where a hold can be released as well as approved');
  has(cal, 'Invoices', 'and the invoice panel beside it');
  has(cal, 'Rate $', 'which says what it is billing at');

  // Paid and Unpaid are told apart, which is the whole reason the panel is
  // worth having rather than a count of unpaid invoices.
  db.prepare("INSERT INTO gym_invoices (group_id,invoice_date,period_start,period_end,total_hours,rate,total_amount,status,created_at) VALUES (1,?,?,?,26,25,650,'unpaid',?)")
    .run(`${month}-01`, `${month}-01`, `${month}-31`, now);
  db.prepare("INSERT INTO gym_invoices (group_id,invoice_date,period_start,period_end,total_hours,rate,total_amount,status,created_at) VALUES (1,?,?,?,2,25,50,'paid',?)")
    .run(`${month}-01`, `${month}-01`, `${month}-31`, now);
  const withInvoices = await (await call(env, '/gym-rentals', { cookie })).text();
  has(withInvoices, 'Unpaid', 'an unpaid invoice says so');
  has(withInvoices, '>Paid<', 'and a paid one is told apart from it');
  has(withInvoices, '$650.00', 'with the amount, not a count');

  // ⚠ Calendar first is the default now, so the bulk tools must be on it too.
  // They carry the invoice generation, the price-setting and the calendar push;
  // hiding them on the view everybody lands on would be dropping them.
  has(cal, 'By organisation', 'the bulk tools are on the default view as well');
  has(cal, 'Confirm All', 'including confirming a whole group at one price');
  // Approving from the panel must not mean approving blind.
  has(cal, 'This slot conflicts with something already booked',
    'a conflicting hold warns before it is approved from the panel');

  // Month navigation must not lose the view.
  has(cal, 'view=calendar&m=', 'month navigation keeps the calendar view');

  // Clicking a day books it. The date is carried through, so the form opens
  // already filled in rather than asking again for what was just clicked.
  has(cal, `/gym-rentals/bookings/new?dt=${month}-21`, 'a day links to the booking form with its own date');
  has(cal, 'gymcal-day--open', 'and is styled as something you can click');
  has(cal, 'Book this day', 'with a label for anybody not using a mouse');
  // A blocked date and a date already gone are not bookable, so they do not
  // pretend to be.
  ok(!cal.includes(`/gym-rentals/bookings/new?dt=${month}-24`), 'a blocked date is not offered');
  has(cal, 'gymcal-cell--past', 'and days already gone are marked as such');
  // A booking on the calendar links to the group it belongs to.
  has(cal, '/gym-rentals/groups/1', 'a booking links to its group');
}

group('payroll emails its report to the bookkeeper');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const report = {
    periodStart: '2026-07-16', periodEnd: '2026-07-31', periodLabel: 'Jul 16 – Jul 31, 2026',
    approved: true, approvedBy: 'dinger', total: 7630,
    groups: [{ name: 'Church staff', subtotal: 5190, people: [
      { name: '<img src=x onerror=alert(1)>', kind: 'Salaried', basis: '—', pto: 0, gross: 3966 },
    ] }],
  };
  const post = (body) => worker.fetch(new Request('https://admin.timothystl.org/payroll/email', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env, ctx);

  // Without an address there is nothing to send to, and it says which setting.
  const noAddr = await post(report);
  eq(noAddr.status, 400, 'with no bookkeeper address set it refuses');
  ok((await noAddr.json()).error.includes('Settings'), 'and names where to set one');

  db.prepare("INSERT INTO site_settings (key,value) VALUES ('payroll_bookkeeper_email','books@example.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();

  // Brevo is stubbed so the test asserts what was actually built and sent.
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('brevo')) { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 201 }); }
    return realFetch(u, init);
  };
  env.BREVO_API_KEY = 'test-key';

  const ok1 = await post(report);
  globalThis.fetch = realFetch;

  eq(ok1.status, 200, 'with an address it sends');
  eq((await ok1.json()).to, 'books@example.com', 'and reports where it went');
  eq(sent.length, 1, 'exactly one email');
  eq(sent[0].to[0].email, 'books@example.com', 'to the bookkeeper');
  ok(sent[0].subject.includes('Jul 16'), 'with the period in the subject: ' + sent[0].subject);
  ok(sent[0].htmlContent.includes('$7,630.00'), 'and the combined total in the body');
  ok(sent[0].htmlContent.includes('Approved by dinger'), 'saying it was signed off, and by whom');

  // The page posts figures, not markup. A name is escaped on the way in, so it
  // cannot become HTML in something that lands in an outside inbox.
  ok(!sent[0].htmlContent.includes('<img src=x'), 'a name cannot smuggle markup into the email');
  ok(sent[0].htmlContent.includes('&lt;img'), 'it is escaped instead');

  // An unapproved run says so, rather than looking final.
  const sent2 = [];
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('brevo')) { sent2.push(JSON.parse(init.body)); return new Response('{}', { status: 201 }); }
    return realFetch(u, init);
  };
  await post({ ...report, approved: false, incomplete: true });
  globalThis.fetch = realFetch;
  ok(sent2[0].htmlContent.includes('Not yet approved'), 'an unapproved run is labelled as such');
  ok(sent2[0].htmlContent.includes('Incomplete'), 'and so is one missing its childcare figures');
}

group('emailing payroll needs the payroll permission');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ALL_PERMISSIONS.filter((p) => p !== 'payroll_manage'), 'nopay2');
  const res = await worker.fetch(new Request('https://admin.timothystl.org/payroll/email', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json' },
    body: '{}',
  }), env, ctx);
  eq(res.status, 403, 'somebody without payroll_manage cannot mail the report out');
}


// ── phase 7: giving — gift vs payment ────────────────────────────────────────
group('gift and payment are tagged apart');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  ok(db.prepare('PRAGMA table_info(redirects)').all().some((c) => c.name === 'give_kind'),
    'giving links carry a gift-or-payment tag');

  db.prepare("INSERT INTO redirects (path,url,label,category,active,give_kind) VALUES ('vendor','https://square.link/x','Market vendor deposit','giving',1,'payment')").run();
  db.prepare("INSERT INTO redirects (path,url,label,category,active,give_kind) VALUES ('memorial','https://give.tithe.ly/y','Memorial gift','giving',1,'gift')").run();

  const body = await (await call(env, '/giving', { cookie })).text();
  eq((await call(env, '/giving', { cookie })).status, 200, 'the Giving screen renders');
  has(body, 'Market vendor deposit', 'a payment link appears');
  has(body, 'Memorial gift', 'and a gift link');
  has(body, 'year-end statement', 'the note explains what the distinction is for');
  has(body, 'default to Payment', 'and which way a new link errs');

  // The safer default has to hold on the write path, not just in the form.
  const res = await worker.fetch(new Request('https://admin.timothystl.org/redirects/add', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'category=giving&path=untagged&url=https%3A%2F%2Fexample.org%2Fpay&label=No+tag+given&active=1',
  }), env, ctx);
  eq(res.status, 302, 'adding a link without a tag succeeds');
  eq(db.prepare("SELECT give_kind FROM redirects WHERE path='untagged'").get().give_kind, 'payment',
    'and defaults to Payment — a mis-tagged gift would put a non-donation on a tax statement');

  const res2 = await worker.fetch(new Request('https://admin.timothystl.org/redirects/add', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'category=giving&path=realgift&url=https%3A%2F%2Fexample.org%2Fgive&label=A+gift&active=1&give_kind=gift',
  }), env, ctx);
  eq(res2.status, 302, 'and an explicit gift is accepted');
  eq(db.prepare("SELECT give_kind FROM redirects WHERE path='realgift'").get().give_kind, 'gift', 'as a gift');
}


// ── phase 9: media, audit rollback, ⌘K ───────────────────────────────────────
group('media');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  ok(db.prepare('PRAGMA table_info(ministry_media)').all().some((c) => c.name === 'bytes'),
    'media rows record the size actually stored');

  const now = new Date().toISOString();
  db.prepare("INSERT INTO ministry_media (filename,kind,url,alt,bytes,created_at) VALUES ('choir.webp','photo','/images/choir.webp','The choir on Easter morning',420000,?)").run(now);
  db.prepare("INSERT INTO ministry_media (filename,kind,url,alt,bytes,created_at) VALUES ('huge.jpg','photo','/images/huge.jpg','A big one',2400000,?)").run(now);
  db.prepare("INSERT INTO ministry_media (filename,kind,url,alt,bytes,created_at) VALUES ('noalt.webp','photo','/images/noalt.webp','',90000,?)").run(now);
  // A page that uses one of them, so "used nowhere" can be wrong as well as right.
  db.prepare("UPDATE youth_pages SET blocks='[{\"type\":\"photo\",\"url\":\"/images/choir.webp\"}]' WHERE slug='music'").run();

  const body = await (await call(env, '/media', { cookie })).text();
  eq((await call(env, '/media', { cookie })).status, 200, 'the Media screen renders');
  has(body, 'choir.webp', 'a file appears');
  has(body, 'On Music', 'and says which page uses it');
  has(body, 'Used nowhere', 'while an unused file says so');
  has(body, '2.3 MB', 'an oversized file shows its real size');
  has(body, 'over the 1MB target', 'with a warning row explaining the cost');
  has(body, 'No alt text', 'and a photo with no alt text is flagged');
  has(body, 'screen reader', 'in terms of who it affects');

  // Alt text is edited in place — it is the field the screen exists to fix.
  const res = await worker.fetch(new Request('https://admin.timothystl.org/media/alt/3', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'alt=' + encodeURIComponent('Children at the egg hunt'),
  }), env, ctx);
  eq(res.status, 302, 'saving alt text redirects');
  eq(db.prepare('SELECT alt FROM ministry_media WHERE id=3').get().alt, 'Children at the egg hunt', 'and stores it');
  ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type='media'").get().n > 0, 'and is audited');
}

group('the audit log shows what changed');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO audit_log (user_id,username,action,entity_type,entity_id,entity_label,before_state,after_state,created_at) VALUES (1,'dinger','update','news_item','5','Egg Hunt',?,?,?)")
    .run(JSON.stringify({ title: 'Egg Hunt', summary: 'Old text', updated_at: '1' }),
         JSON.stringify({ title: 'Egg Hunt', summary: 'New text', updated_at: '2' }), now);
  db.prepare("INSERT INTO audit_log (user_id,username,action,entity_type,entity_id,entity_label,before_state,after_state,created_at) VALUES (1,'dinger','update','user','2','office','{}','{}',?)").run(now);

  const body = await (await call(env, '/audit-log', { cookie })).text();
  eq((await call(env, '/audit-log', { cookie })).status, 200, 'the audit log renders');
  has(body, 'summary: Old text → New text', 'the row shows the field that changed');
  lacks(body, 'updated_at:', 'and not the timestamp that changes on every save');
  has(body, 'Roll back', 'a reversible change offers a rollback');
  has(body, 'People &amp; ops', 'and the filters split content from people & ops');
  has(body, 'does not erase it', 'the note explains that rolling back is itself recorded');
}

group('system actions reach the audit log');
{
  const { db, env } = await boot();
  // user_id was NOT NULL, so anything the system did on its own threw on
  // insert and was silently swallowed — exactly the entries somebody later
  // wants to find.
  const col = db.prepare('PRAGMA table_info(audit_log)').all().find((c) => c.name === 'user_id');
  eq(col.notnull, 0, 'audit_log.user_id is nullable');
  let threw = false;
  try {
    db.prepare("INSERT INTO audit_log (user_id,username,action,entity_type,entity_id,entity_label,created_at) VALUES (NULL,'','publish','page','x','Scheduled page',?)")
      .run(new Date().toISOString());
  } catch (_) { threw = true; }
  eq(threw, false, 'so a system action can be recorded at all');
}

group('⌘K searches every section, within permissions');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO news_items (title,summary,publish_date) VALUES ('Egg Hunt Saturday','Bring a basket','2026-03-01')").run();
  db.prepare("INSERT INTO staff_members (name,title,display_order) VALUES ('Andrew Dinger','Lead Pastor',10)").run();

  const shell = await (await call(env, '/dashboard', { cookie })).text();
  has(shell, 'tlc-k-input', 'the palette is in the shared shell, so it is on every screen');
  has(shell, '⌘K searches every section', 'the sidebar foot explains the shortcut');
  // And the context bar carries the chip, so it is reachable without scrolling
  // a column to the bottom.
  has(shell, 'class="tlc-ctx-k" id="tlc-k-open-2">⌘K<', 'and the context bar offers it');

  const res = await call(env, '/api/search?q=egg', { cookie });
  eq(res.status, 200, 'search responds');
  const d = await res.json();
  ok(d.results.some((r) => r.section === 'News & Events' && r.label.includes('Egg Hunt')), 'and finds a news post');

  const staff = await (await call(env, '/api/search?q=dinger', { cookie })).json();
  ok(staff.results.some((r) => r.section === 'Staff'), 'and a staff member, labelled by section');

  eq((await (await call(env, '/api/search?q=a', { cookie })).json()).results.length, 0,
    'a single letter searches nothing — that would return the whole database');

  // Searching must not be a way around a permission gate.
  const { cookie: limited } = signIn(db, ['news_edit'], 'newsonly');
  const scoped = await (await call(env, '/api/search?q=dinger', { cookie: limited })).json();
  ok(!scoped.results.some((r) => r.section === 'Staff'),
    'somebody without staff_edit gets no staff results');
  ok(!scoped.results.some((r) => r.section === 'Users'), 'nor user results');
}


// ── matching the design ──────────────────────────────────────────────────────
group('Taps & links');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const taps = db.prepare('SELECT * FROM taps ORDER BY id').all();
  eq(taps.length, 4, 'four NFC taps are seeded');
  eq(taps[0].id, 1, 'and their ids are their addresses — tap 1 is /tap1');
  ok(db.prepare('PRAGMA table_info(link_cards)').all().some((c) => c.name === 'tap'),
    'a link card can belong to a tap');

  db.prepare("UPDATE link_cards SET tap = 2 WHERE id = (SELECT MIN(id) FROM link_cards)").run();

  const body = await (await call(env, '/link-cards', { cookie })).text();
  eq((await call(env, '/link-cards', { cookie })).status, 200, 'the screen renders');
  has(body, 'Taps &amp; links', 'titled from the design config');
  has(body, '/tap1', 'each tap shows its short address');
  has(body, '/tap4', 'all four of them');
  has(body, 'Re-point', 'and offers to re-point');
  has(body, 'only ever holds its short address', 'the note explains why re-pointing works');

  // Re-pointing changes where the tag lands without touching the tag.
  const res = await worker.fetch(new Request('https://admin.timothystl.org/link-cards/tap/3', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Giving+plate&placement=Offering+plates&destination=https%3A%2F%2Fgive.timothystl.org%2Feaster&active=1',
  }), env, ctx);
  eq(res.status, 302, 're-pointing redirects');
  has(db.prepare('SELECT destination FROM taps WHERE id=3').get().destination, '/easter',
    'and the tap now lands somewhere new');

  // Filtering to one tap shows only its cards.
  const one = await (await call(env, '/link-cards?tap=2', { cookie })).text();
  has(one, 'Cards on /tap2', 'filtering to a tap says so');
}

group('screens say what the design says');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  // Each of these strings was wrong before — the screens used wording I wrote
  // rather than the design's.
  const checks = [
    ['/ministries', 'Ministry pages'],
    ['/ministries', 'Eleven ministry pages'],
    ['/partners', 'Partner ministries'],
    ['/christian-education', 'Christian Education'],
    ['/notices', 'Short banners pinned to a specific page'],
    ['/staff', 'Photo crop is set per person'],
    ['/newsitems', 'One list behind one page'],
    ['/sermons', 'One series is the active one shown on the site'],
    ['/users', 'the checkboxes are the truth'],
    ['/media', 'the two things that go wrong'],
    ['/link-cards', 'Four NFC taps'],
  ];
  for (const [path, text] of checks) {
    const body = await (await call(env, path, { cookie })).text();
    has(body, text, `${path} uses the design's wording`);
  }
}

group('rows carry an overflow menu');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const body = await (await call(env, '/ministries', { cookie })).text();
  has(body, 'tlc-more-btn', 'a row has a ⋯ menu');
  has(body, 'tlc-menu-item', 'with items inside it');
  has(body, 'View live', 'including the rarely-wanted ones that should not sit in the row');
}

group('the giving page has both surfaces');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const body = await (await call(env, '/giving', { cookie })).text();
  has(body, 'give.timothystl.org', 'the standalone address is shown');
  has(body, 'timothystl.org/give', 'and the on-site one');
  has(body, 'One set of blocks', 'described as one set of blocks in two places');
  has(body, 'Kept in step', 'with the keep-in-step switch');
  has(body, 'the amounts and funds offered on it', 'and the design’s purpose line');

  const res = await worker.fetch(new Request('https://admin.timothystl.org/giving/keep-in-step', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'value=0',
  }), env, ctx);
  eq(res.status, 302, 'the switch posts');
  eq(db.prepare("SELECT value FROM site_settings WHERE key='give_keep_in_step'").get().value, '0', 'and is stored');
}

group('Giving: funds and amounts are two panels, side by side');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  // The Worker seeds a General Fund on first boot, so start from a known list.
  db.prepare('DELETE FROM give_funds').run();
  db.prepare('DELETE FROM give_amount_tiers').run();
  db.prepare("INSERT INTO give_funds (id,name,tithely_fund_id,is_default,active,sort_order) VALUES (1,'General Fund','',1,1,10)").run();
  db.prepare("INSERT INTO give_funds (id,name,tithely_fund_id,is_default,active,sort_order) VALUES (2,'Organ Fund','abc',0,1,20)").run();
  db.prepare("INSERT INTO give_amount_tiers (id,amount,url,is_default,active,sort_order) VALUES (1,25,'',0,1,10)").run();
  db.prepare("INSERT INTO give_amount_tiers (id,amount,url,is_default,active,sort_order) VALUES (2,100,'',1,1,20)").run();

  const body = await (await call(env, '/giving', { cookie })).text();
  has(body, 'tlc-give-cols', 'the two panels sit side by side');
  has(body, 'General Fund', 'a fund is listed');
  has(body, 'Default when nobody chooses', 'and says it is the default in words, not a code');
  has(body, '$100', 'an amount is listed');
  has(body, 'Showing', 'with its state as a pill');
  has(body, 'tlc-pl-grip', 'and a grip, because the order is what the page shows');
  has(body, 'data-sortlist="/giving-funds/reorder"', 'dragging posts the whole resulting order');

  // The drawer holds the fields, so eight funds is eight rows rather than
  // forty inputs.
  const drawer = await (await call(env, '/giving?fund=2', { cookie })).text();
  has(drawer, 'Organ Fund', 'opening a fund names it');
  has(drawer, 'Tithe.ly fund ID', 'and offers its fields');

  // A toggle posts a hidden 0 ahead of the checkbox. Reading it with get()
  // would see that '0' and store 1 every time — so an unticked Default would
  // silently become the default.
  await call(env, '/giving-funds/update', {
    method: 'POST', cookie,
    form: { id: '2', name: 'Organ Fund', tithely_fund_id: 'abc', is_default: '0', active: '0' },
  });
  const organ = db.prepare('SELECT is_default, active FROM give_funds WHERE id=2').get();
  eq(organ.is_default, 0, 'an unticked Default really stores 0');
  eq(organ.active, 0, 'and so does an unticked Active');
  eq(db.prepare('SELECT is_default FROM give_funds WHERE id=1').get().is_default, 1,
    'and the existing default was not disturbed');

  await call(env, '/giving-funds/reorder', { method: 'POST', cookie, form: { order: '["2","1"]' } });
  const order = db.prepare('SELECT id FROM give_funds ORDER BY sort_order').all().map((r) => r.id);
  eq(order.join(','), '2,1', 'reordering renumbers from scratch');

  await call(env, '/giving-funds/toggle/1', { method: 'POST', cookie, form: { value: '0' } });
  eq(db.prepare('SELECT active FROM give_funds WHERE id=1').get().active, 0, 'the row switch hides a fund in one click');
}

group('payroll lives in the shared shell now');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const body = await (await call(env, '/payroll', { cookie })).text();

  // PY-3: it used to be a standalone document whose only way out was a Sign
  // Out button. It is a fragment inside the shared shell now.
  has(body, 'class="sidebar"', 'it has the admin sidebar');
  has(body, 'tlc-k-open', 'and the ⌘K palette, like every other screen');
  has(body, 'Enter hours and exceptions', 'the purpose line is the design’s');

  // The design's chrome.
  has(body, 'Pay period', 'the pay-period picker is labelled');
  has(body, 'Enter &amp; approve', 'the two views are the design’s');
  has(body, 'Report', 'both of them');
  has(body, 'Print report', 'with Print report');
  has(body, 'Export CSV', 'and Export CSV');
  has(body, 'Detail cards', 'and the report’s three layouts');
  has(body, 'One line each', 'one line each');
  has(body, 'Totals only', 'and totals only');

  // The CDN script is gone — the page runs under the admin CSP now, which
  // allows no third-party script host.
  ok(!body.includes('cdn.jsdelivr.net'), 'the Supabase CDN bundle is no longer loaded');
  ok(body.includes('/sb/rest/v1/'), 'it talks to Supabase through the permission-gated proxy instead');

  // ⚠ The one rule that must not be broken: MDO rates are read from the MDO
  // app and are never editable here. A second place to set what somebody is
  // paid is a second answer to what they are owed.
  has(body, 'Rates for church staff are entered here', 'the screen says where a church rate comes from');
  has(body, 'live in the MDO app and are read from it', 'and that MDO rates are read, not set');

  const res = await call(env, '/payroll', { cookie });
  eq(res.headers.get('x-robots-tag'), 'noindex, nofollow', 'and it is still noindex, as the standalone page was');
}

group('payroll access is gated on its own permission');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ALL_PERMISSIONS.filter((p) => p !== 'payroll_manage'), 'nopay');
  eq((await call(env, '/payroll', { cookie })).status, 403, 'somebody without payroll_manage cannot open it');
  eq((await call(env, '/sb/rest/v1/church_staff', { cookie })).status, 401, 'nor read Supabase through the proxy');
}

group('the shell is the sidebar plus a context bar');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const body = await (await call(env, '/dashboard', { cookie })).text();

  // ⚠ The sidebar STAYS. The revised spec is explicit that the build's mistake
  // was never the sidebar — it was hiding it behind a hamburger. Twenty-one
  // sections in five groups is more than a horizontal bar holds honestly.
  has(body, 'class="sidebar"', 'the sidebar is there');
  for (const g of ['Website', 'Email', 'Money &amp; Building', 'People &amp; Access', 'Setup']) {
    has(body, `>${g}</div>`, `${g} is a group`);
  }
  has(body, 'href="/redirects"', 'Redirects has its own address');
  has(body, 'href="/settings"', 'and so does Settings');
  has(body, 'sidebar-item-child', 'the five children of Pages keep their elbow');

  // What IS gone: every way of hiding it. No off-canvas default, no backdrop
  // shown, no toggle script — the hamburger survives only below 900px, where a
  // phone genuinely cannot spare 228px.
  const shellCss = await (await call(env, '/dashboard', { cookie })).text();
  // The DEFAULT rule must not translate it away. The one inside the 900px
  // media query is the legitimate slide-over, so match the first occurrence
  // only — asserting on the whole stylesheet would fail on the rule the spec
  // actually asks for.
  const firstSidebarRule = shellCss.slice(shellCss.indexOf('.sidebar{'));
  ok(!firstSidebarRule.slice(0, firstSidebarRule.indexOf('}')).includes('translateX'),
    'the sidebar does not start off-canvas');
  ok(shellCss.includes('body{padding-left:228px;}'), 'and the content sits beside it, not under it');
  ok(shellCss.includes('@media (max-width:900px)'), 'the slide-over is the one responsive rule');

  // The context bar reports; it does not navigate.
  has(body, 'class="tlc-ctx"', 'the context bar is above the content');
  has(body, 'class="tlc-ctx-group">Admin<', 'Dashboard’s group reads Admin');
  has(body, 'class="tlc-ctx-section">Dashboard<', 'with the section beside it');
  has(body, 'View site ↗', 'and the two global actions');
  has(body, 'Connect ↗', 'both of them');
  ok(!body.includes('tlc-ctx-tab'), 'no tabs in it');
  ok(!body.includes('class="tlc-nav-chip'), 'and no group chips — the sidebar navigates');

  // Sign out is in the sidebar foot, and NOT duplicated in the bar.
  has(body, 'class="sidebar-signout"', 'Sign out is in the sidebar foot');
  eq((body.match(/Sign out/g) || []).length, 1, 'and appears exactly once in the shell');

  // The trail follows the screen.
  const gym = await (await call(env, '/gym-rentals', { cookie })).text();
  has(gym, 'class="tlc-ctx-group">Money &amp; Building<', 'a gym screen names its group');
  has(gym, 'class="tlc-ctx-section">Gym rentals<', 'and its section');
}

group('the sidebar hides whole groups, not rows');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['ministries_edit']);
  const body = await (await call(env, '/ministries', { cookie })).text();
  has(body, '>Website</div>', 'the group they can reach is there');
  ok(!body.includes('>Money &amp; Building</div>'), 'a group they cannot reach is not rendered');
  ok(!body.includes('href="/payroll"'), 'and nothing inside one leaks as a link');
}

group('the per-screen reference files');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();

  // 04-partners / 03-ministries / 05-news / 07-ed: "Core value: chips".
  // Four options is four chips, not a select that hides three of them.
  const partners = await (await call(env, '/partners/new', { cookie })).text();
  has(partners, 'tlc-vchips', 'the core value is chosen from chips');
  has(partners, 'role="radiogroup"', 'operable by keyboard');
  ok(!/<select name="value"/.test(partners), 'and not from a select');

  // 15-staff: a person is a round 52px avatar, and the Photo column reads
  // "Set" / "No photo yet".
  db.prepare("INSERT INTO staff_members (name,title,email,display_order) VALUES ('Jane Doe','Organist','j@x.co',1)").run();
  const staff = await (await call(env, '/staff', { cookie })).text();
  has(staff, 'tlc-primary-icon--person', 'a person gets the round avatar');
  has(staff, 'No photo yet', 'and the spec’s own wording for a missing one');

  // 11-redirects: the status column reads Redirecting, not Live.
  db.prepare("INSERT INTO redirects (path,url,label,category,active) VALUES ('zoom','https://z.example','Zoom','general',1)").run();
  const red = await (await call(env, '/redirects', { cookie })).text();
  has(red, 'Redirecting', 'a live redirect says what it does');

  // 12-media: a file is a 64x48 rectangle, not a round avatar.
  db.prepare("INSERT INTO ministry_media (url,filename,kind,created_at) VALUES ('/i/a.jpg','a.jpg','photo',?)").run(now);
  const media = await (await call(env, '/media', { cookie })).text();
  has(media, 'tlc-primary-icon--file', 'a file gets the rectangular thumbnail');
}

group('per-screen, part two');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // 06-sermons: the media pill is YouTube / Audio / Text only. "Text only" is
  // NOT a warning — a sermon with no recording is a good text card, and
  // adding a link later upgrades it with no other edit.
  db.prepare("INSERT INTO sermon_notes (id,title,date,scripture,youtube_url) VALUES (1,'With video',?,'John 1','https://youtu.be/x')").run(today);
  db.prepare("INSERT INTO sermon_notes (id,title,date,scripture) VALUES (2,'No recording',?,'Luke 2')").run(today);
  const serm = await (await call(env, '/sermons', { cookie })).text();
  has(serm, 'YouTube', 'a sermon with a video says YouTube, not "Video"');
  has(serm, 'Text only', 'and one without says Text only');
  // Not a blanket string check: the section's ◆ note legitimately reads "No
  // recordings are attached yet". What must not exist is a PILL saying it.
  ok(!/tlc-pill[^>]*>\s*No recording/.test(serm), 'a normal state is not dressed up as a fault');
  ok(!/warn[^>]*>\s*Text only/.test(serm), 'and Text only is not amber');

  // 05-news: pinned rows carry a marker BEFORE the title, and sort to the top.
  db.prepare("INSERT INTO news_items (id,title,summary,publish_date,expire_date,pinned) VALUES (1,'Pinned post','s',?,?,1)").run(today, '2099-01-01');
  db.prepare("INSERT INTO news_items (id,title,summary,publish_date,expire_date,pinned) VALUES (2,'Ordinary post','s',?,?,0)").run(today, '2099-01-01');
  const news = await (await call(env, '/newsitems', { cookie })).text();
  has(news, 'tlc-pin', 'a pinned post carries a pin marker');
  ok(news.indexOf('tlc-pin') < news.indexOf('Pinned post'), 'the marker sits before the title');
  ok(news.indexOf('Pinned post') < news.indexOf('Ordinary post'), 'and pinned rows sort to the top');
  // "No emoji anywhere in the admin chrome."
  ok(!news.includes('\u{1F4F0}'), 'the newspaper emoji is gone — icons are typographic glyphs');

  // 20-audit: a read-only drawer. No save, no delete; fields are sand-filled
  // rather than greyed, because grey text reads as broken.
  db.prepare("INSERT INTO audit_log (user_id,username,action,entity_type,entity_id,entity_label,before_state,after_state,created_at) VALUES (NULL,'office','update','news_item','1','Pinned post','{\"title\":\"Old\"}','{\"title\":\"New\"}',?)").run(now);
  const logRow = db.prepare("SELECT id FROM audit_log ORDER BY id DESC LIMIT 1").get();
  const audit = await (await call(env, `/audit-log?entry=${logRow.id}`, { cookie })).text();
  has(audit, 'Audit entry · read-only', 'the drawer says what it is');
  has(audit, 'tlc-static', 'its fields are static, not inputs');
  ok(!/drawer-audit[\s\S]*?tlc-btn-primary/.test(audit), 'and it offers no save');
  ok(!/drawer-audit[\s\S]*?tlc-drawer-delete/.test(audit), 'nor a delete');
}

group('the NFC taps actually answer');
{
  // ⚠ The premise of the whole feature is "the tag only ever holds its short
  // address — /tap1 … /tap4 — so re-pointing is a click and nothing is
  // reprogrammed". That only holds if the short address resolves. It did not:
  // taps live in their own table and /api/redirects read only `redirects`, so
  // every physical tag 404'd while the admin happily let you re-point it.
  const { db, env } = await boot();
  const api = async () => (await (await call(env, '/api/redirects')).json()).redirects;

  const seeded = await api();
  const tap1 = seeded.find((r) => r.path === 'tap1');
  ok(!!tap1, 'the tap short link is served: ' + JSON.stringify(seeded.map((r) => r.path)));
  ok(/links\.timothystl\.org/.test(tap1.url), 'pointing where the tap says: ' + tap1.url);

  // Re-pointing a tap changes where the tag lands, with nothing reprogrammed.
  db.prepare("UPDATE taps SET destination='https://give.timothystl.org' WHERE id=1").run();
  const after = (await api()).find((r) => r.path === 'tap1');
  eq(after.url, 'https://give.timothystl.org', 're-pointing a tap moves the address');

  // A switched-off tap stops answering rather than sending people somewhere
  // stale.
  db.prepare('UPDATE taps SET active=0 WHERE id=1').run();
  ok(!(await api()).some((r) => r.path === 'tap1'), 'a tap switched off stops resolving');

  // A hand-made redirect at the same path wins, so the office can override one
  // without going near the taps screen.
  db.prepare('UPDATE taps SET active=1 WHERE id=1').run();
  db.prepare("INSERT INTO redirects (path,url,label,category,active) VALUES ('tap1','https://override.example','Override','general',1)").run();
  eq((await api()).find((r) => r.path === 'tap1').url, 'https://override.example',
    'a hand-made redirect beats the tap');
}

group('a link card can be a sign-up form');
{
  // The newsletter sign-up form was hardcoded into the links page, so it showed
  // on every tap and the office could not edit a word of it. It is a card kind
  // now — which means the URL rule has to stop applying to it, in both
  // directions.
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // Seeded once, so the office finds it on the screen rather than having to
  // know it exists.
  const seeded = db.prepare("SELECT * FROM link_cards WHERE kind='signup'").all();
  eq(seeded.length, 1, 'the sign-up card is seeded as an ordinary row');
  eq(seeded[0].url, '', 'with no address, because it does not go anywhere');

  // ⚠ It must not come back after being deleted. The seed sits outside the
  // schema block for exactly this reason — that block re-runs on every
  // SCHEMA_VERSION bump.
  db.prepare("DELETE FROM link_cards WHERE kind='signup'").run();
  await call(env, '/link-cards', { cookie });
  eq(db.prepare("SELECT COUNT(*) n FROM link_cards WHERE kind='signup'").get().n, 0,
    'a deleted sign-up card stays deleted');

  const form = await (await call(env, '/link-cards/new', { cookie })).text();
  has(form, 'What the card does', 'the card form asks which kind it is');
  has(form, 'Newsletter sign-up', 'and offers the form option');

  // A sign-up card saves with no address. Applying the link rule to it would
  // bounce the form back with nothing said.
  await call(env, '/link-cards/create', { cookie, method: 'POST', form: {
    title: 'Get the Newsletter', description: 'Weekly news', kind: 'signup', url: '', icon_emoji: '✉️', icon_color: 'amber', sort_order: '90',
  } });
  const made = db.prepare("SELECT * FROM link_cards WHERE title='Get the Newsletter'").get();
  ok(!!made, 'a sign-up card saves without a URL');
  eq(made.kind, 'signup', 'and is stored as one');

  // A link card still has to have a real address — the relaxation is scoped to
  // the kind that has nowhere to go, not removed.
  await call(env, '/link-cards/create', { cookie, method: 'POST', form: {
    title: 'Bad card', kind: 'link', url: 'javascript:alert(1)', icon_color: 'sky', sort_order: '1',
  } });
  ok(!db.prepare("SELECT id FROM link_cards WHERE title='Bad card'").get(),
    'a link card with an unsafe address is still refused');

  // The list says what a sign-up card is instead of leaving the address cell
  // blank, which reads as a card somebody forgot to finish.
  const list = await (await call(env, '/link-cards', { cookie })).text();
  has(list, 'Sign-up form', 'the list names the kind in the address column');

  // The public API carries the kind, which is the only way the links page can
  // tell the two apart.
  const api = await (await call(env, '/api/link-cards')).json();
  ok(api.cards.some((c) => c.kind === 'signup'), 'the public API reports the kind');
  ok(api.cards.some((c) => c.kind === 'link'), 'and still reports ordinary cards');
}

group('each tap serves its own cards');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // The links page works out which tap it is from the address the office typed
  // into "Lands on", so the API has to carry both halves: which tap a card is
  // on, and where each tap lands. Without either, every tap shows every card.
  const api = await (await call(env, '/api/link-cards')).json();
  ok(api.cards.every((c) => 'tap' in c), 'every card reports which tap it is on');
  ok(api.taps.length >= 4, 'and the taps ride along: ' + api.taps.length);
  ok(api.taps.every((t) => t.destination), 'each with the address it lands on');

  // A switched-off tap is not sent, so its cards stop showing rather than
  // being served at an address the office has retired.
  db.prepare('UPDATE taps SET active=0 WHERE id=2').run();
  const off = await (await call(env, '/api/link-cards')).json();
  ok(!off.taps.some((t) => t.id === 2), 'a switched-off tap is not published');
  db.prepare('UPDATE taps SET active=1 WHERE id=2').run();

  // ⚠ Tap 3 lands on the giving page, which is a different Worker — cards
  // assigned to it can never appear. Saying so on the screen is what stops
  // "I moved it and nothing happened" being a mystery.
  db.prepare("UPDATE link_cards SET tap=3 WHERE id=(SELECT MIN(id) FROM link_cards)").run();
  const screen = await (await call(env, '/link-cards', { cookie })).text();
  has(screen, 'lands somewhere other than the links page', 'the screen flags a tap that cannot show cards');
  has(screen, 'not visible to anybody', 'and says the cards on it are going unseen');

  // A tap that does land on the links page carries no such warning.
  const firstTap = screen.slice(0, screen.indexOf('/tap2'));
  ok(!firstTap.includes('lands somewhere other than'), 'a tap on the links page is not flagged');
}

group('a newsletter can carry a fourth and fifth note');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // The composer offers the slots and the button that reveals them.
  const form = await (await call(env, '/new', { cookie })).text();
  has(form, 'More notes', 'the composer offers more than the three fixed notes');
  has(form, '+ Add another note', 'behind a button, so an unused slot is not clutter');
  has(form, 'extra_note_0', 'with a real field behind it');

  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,format,status,published_at,extra_notes) VALUES (9,'Test issue','<p>Note</p>','weekly','draft','2026-08-01',?)")
    .run(JSON.stringify([{ title: 'Thank you', body: '<p>To everyone who helped.</p>' }]));

  const edit = await (await call(env, '/edit/9', { cookie })).text();
  has(edit, 'Thank you', 'an issue that has one shows it when reopened');
  has(edit, 'To everyone who helped', 'with its words');

  // The preview is built by the same function the send path uses, so an extra
  // note that shows here is one that will actually go out.
  const preview = await worker.fetch(new Request('https://admin.timothystl.org/newsletter/preview', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'subject=Test&format=weekly&pastor_note=%3Cp%3EHi%3C%2Fp%3E&extra_title_0=Thank+you&extra_note_0=%3Cp%3EGrateful%3C%2Fp%3E',
  }), env, ctx);
  const previewHtml = await preview.text();
  has(previewHtml, 'Thank you', 'the preview shows the extra note');
  has(previewHtml, 'Grateful', 'and its body');

  // A heading is typed by staff and lands in six hundred inboxes.
  const nasty = await worker.fetch(new Request('https://admin.timothystl.org/newsletter/preview', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'subject=Test&format=weekly&extra_title_0=%3Cscript%3Ealert(1)%3C%2Fscript%3E&extra_note_0=%3Cp%3Ex%3C%2Fp%3E',
  }), env, ctx);
  const nastyHtml = await nasty.text();
  ok(!nastyHtml.includes('<script>alert(1)'), 'a heading cannot smuggle markup into the email');
}

group('the gym sub-screens use the shared pattern');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO gym_groups (id,name,contact,email,active,access_token) VALUES (1,'Southside Volleyball','Ann','a@b.co',1,'tok')").run();
  db.prepare("INSERT INTO gym_groups (id,name,contact,email,active) VALUES (2,'No Link Club','Bo','b@c.co',1)").run();
  db.prepare("INSERT INTO gym_invoices (group_id,invoice_date,period_start,period_end,total_hours,rate,total_amount,status,created_at) VALUES (1,?,?,?,26,25,650,'unpaid',?)")
    .run('2026-08-01', '2026-08-01', '2026-08-31', now);

  const groups = await (await call(env, '/gym-rentals/groups', { cookie })).text();
  has(groups, 'tlc-section', 'Rental groups is a list section now');
  has(groups, 'Southside Volleyball', 'with the groups in it');
  has(groups, 'Every group that rents the gym', 'and the purpose line from sections.js');
  // A group with no token cannot be booked with — the whole mechanic is a
  // private link rather than an account.
  has(groups, 'has no booking link', 'a group with no link is flagged');

  const inv = await (await call(env, '/gym-rentals/invoices', { cookie })).text();
  has(inv, '$650.00', 'Invoices shows the amount');
  has(inv, 'Unpaid', 'and whether it is paid');
  has(inv, 'hrs at $25.00/hr', 'and the rate it billed at');
  ok(!inv.includes('class="ni-row"'), 'neither screen is hand-built rows any more');

  db.prepare("INSERT INTO gym_bookings (group_id,booking_date,start_time,end_time,status,created_at) VALUES (1,'2099-01-14','18:00','20:00','hold',?)").run(now);
  const bookings = await (await call(env, '/gym-rentals/bookings', { cookie })).text();
  has(bookings, 'Every hold and confirmed booking', 'All bookings is a list section');
  has(bookings, 'Southside Volleyball', 'with the bookings in it');
  ok(!bookings.includes('<details open'), 'and not two accordions grouped by organisation');

  db.prepare("INSERT INTO gym_recurrences (group_id,day_of_week,start_time,end_time,start_date,end_date,status,created_at) VALUES (1,2,'18:00','20:00','2099-01-01','2099-03-01','pending_review',?)").run(now);
  const rec = await (await call(env, '/gym-rentals/recurring', { cookie })).text();
  has(rec, 'Needs review', 'Recurring requests flags what is waiting');
  has(rec, 'Nothing happens on this request until somebody reviews it',
    'and says so, because these are the only rows that never resolve themselves');

  // ⚠ Blocked dates keeps its CALENDAR. You block "the week of the Christmas
  // Market" by seeing the month; a table of dates would be a worse interface
  // than the one it replaced. It wears the shared header and note instead.
  const blocked = await (await call(env, '/gym-rentals/blocked', { cookie })).text();
  has(blocked, 'cal-grid', 'Blocked dates is still a calendar');
  has(blocked, 'Days the gym cannot be booked', 'with the shared purpose line');
  has(blocked, 'does not cancel bookings already confirmed', 'and the rule it enforces');
}

group('the taps are counted');
{
  // \u26a0 Until now `taps.scans` was a column nothing ever wrote to. Resolution
  // happens in site-worker.js from a cached list, which cannot reach D1 \u2014 so
  // this endpoint is the only place a tap can be recorded, and it is why the
  // count was a real piece of work rather than a display change.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const hit = (tap) => worker.fetch(new Request('https://admin.timothystl.org/api/tap-hit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tap }),
  }), env, ctx);

  // No Origin at all: this is called server-to-server by the site worker, so it
  // has to be on the cross-origin allowlist or the CSRF gate blocks every tap.
  const first = await hit(1);
  eq(first.status, 200, 'a tap is recorded without an Origin header');

  await hit(1);
  await hit(2);
  const day = new Date().toISOString().slice(0, 10);
  eq(db.prepare('SELECT hits FROM tap_hits WHERE tap_id=1 AND day=?').get(day).hits, 2,
    'two taps on one tag on one day are one row counting two');
  eq(db.prepare('SELECT hits FROM tap_hits WHERE tap_id=2 AND day=?').get(day).hits, 1,
    'a different tag is a different row');
  eq(db.prepare('SELECT scans FROM taps WHERE id=1').get().scans, 2,
    'and the lifetime total on the tap row follows');

  // The ids are the printed addresses, not a sequence to extend.
  const bogus = await hit(97);
  eq(bogus.status, 200, 'a tap id that does not exist still answers 200');
  eq(db.prepare('SELECT COUNT(*) n FROM tap_hits WHERE tap_id=97').get().n, 0,
    'but records nothing \u2014 there is no tag 97');

  // \u26a0 Nothing about counting may reach the visitor. The site worker sends this
  // with waitUntil and never waits; this route must never answer with an error
  // that could be mistaken for the tap itself failing.
  const junk = await worker.fetch(new Request('https://admin.timothystl.org/api/tap-hit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json at all',
  }), env, ctx);
  eq(junk.status, 200, 'a malformed body is swallowed rather than reported');

  // The screen. A tap that has been counted shows its month; one that never has
  // says so rather than showing a zero somebody would read as "tags broken".
  db.prepare("INSERT INTO tap_hits (tap_id,day,hits) VALUES (1,'2020-01-01',999)").run();
  const screen = await (await call(env, '/link-cards', { cookie })).text();
  has(screen, '2 taps this month', 'the card shows the month\u2019s figure');
  has(screen, 'Not counted yet', 'and a tap nothing has recorded says exactly that');
  ok(!/>0 taps this month/.test(screen), 'never a bare zero on an uncounted tag');
  ok(!screen.includes('1001 taps'), 'an old bucket is not counted into this month');

  // Opening the screen is what clears old buckets \u2014 often enough for a table
  // gaining four rows a day, and it cannot quietly stop the way a cron can.
  eq(db.prepare("SELECT COUNT(*) n FROM tap_hits WHERE day='2020-01-01'").get().n, 0,
    'buckets past the retention window are pruned when somebody looks');
}

group('the July review\u2019s open security items');
{
  const { db, env } = await boot();

  // AW-1: the top-level catch used to return e.stack to EVERY caller. It also
  // wraps the login page and the public contact/prayer/subscribe endpoints, so
  // a stranger could read file names, line numbers and query shapes.
  const boom = await worker.fetch(new Request('https://admin.timothystl.org/api/newsletter/x', {
    headers: { origin: 'https://admin.timothystl.org' },
  }), { ...env, DB: { prepare() { throw new Error('SECRET-INTERNAL-DETAIL'); } } }, ctx);
  const body = await boom.text();
  ok(!body.includes('SECRET-INTERNAL-DETAIL'), 'an error does not hand its message to the caller');
  ok(!/\bat\s+\w+.*:\d+:\d+/.test(body), 'nor a stack trace');
  has(body, 'Reference:', 'it gives a reference instead, so the log can still be found');

  // AC-1: without Secure the browser will send the session cookie over plain
  // HTTP. It has to be on the clearing header too, or signing out cannot
  // overwrite the cookie it set.
  const { cookie } = signIn(db);
  const out = await call(env, '/logout', { cookie });
  const setCookie = out.headers.get('set-cookie') || '';
  has(setCookie, 'Secure', 'signing out clears a Secure cookie');
  has(setCookie, 'HttpOnly', 'and keeps HttpOnly');

  // VS-2: the Worship Schedule Builder is behind the session now. Before, it
  // sat in public/ and answered to anybody on the internet.
  const anon = await worker.fetch(new Request('https://admin.timothystl.org/scheduler'), env, ctx);
  const anonBody = await anon.text();
  ok(!anonBody.includes('Worship Schedule'), 'a signed-out visitor does not get the scheduler');
  has(anonBody, 'Sign in', 'they get the login page');

  const inside = await (await call(env, '/scheduler', { cookie })).text();
  ok(inside.length > 10000, 'a signed-in staff member does get it: ' + inside.length + ' bytes');
}

group('renter notes cannot smuggle markup into the office\u2019s session');
{
  // GY-2. `notes` is typed by a renter in the public booking portal and was
  // rendered unescaped into the admin review page and into staff emails —
  // stored XSS running in the session of whoever opened it.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO gym_groups (id,name,contact,email,active) VALUES (1,'Southside','Ann','a@b.co',1)").run();
  db.prepare(`INSERT INTO gym_recurrences (id,group_id,day_of_week,start_time,end_time,start_date,end_date,notes,status,created_at)
              VALUES (1,1,2,'18:00','20:00','2026-09-01','2026-12-15','<img src=x onerror=alert(1)>','pending_review',?)`).run(now);

  const page = await (await call(env, '/gym-rentals/recurring/review/1', { cookie })).text();
  ok(!page.includes('<img src=x onerror'), 'the note does not reach the page as markup');
  has(page, '&lt;img src=x', 'it is escaped instead');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
