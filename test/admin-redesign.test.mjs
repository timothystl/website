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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
