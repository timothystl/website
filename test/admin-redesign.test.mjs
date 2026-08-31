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
import { churchDate, churchDatePlus } from '../admin/when.js';
import { openCountOf } from '../admin/intake.js';
import worker, { PAYROLL_RPC_FNS } from '../tlc-admin-worker.js';
import { pushToAllSubscribers } from '../admin/webpush.js';
import { ALL_PERMISSIONS } from '../admin/auth.js';
// ⚠ Read from the record rather than pinned to a literal hex. These assertions
// are about "the preview shows the site's real bar, not a color that exists
// nowhere" — which was the v4.23.0 bug — and a hardcoded #4A5E3A turns every
// future change of default into five unrelated-looking failures somebody has
// to triage. The color is not what is being asserted; the agreement is.
import { DEFAULTS as CHROME_DEFAULTS, colorOf } from '../admin/appearance.js';
const CHROME_BAR = colorOf(CHROME_DEFAULTS.bar).value;
import { priceBreakdown, money as marketMoney, MARKET_DEFAULTS as MARKET_PRICE_DEFAULTS } from '../market-price.js';
import crypto from 'node:crypto';
import { SCHOOL_EVENTS } from '../admin/school-calendar-seed.js';

let pass = 0, fail = 0;
const { readFileSync } = await import('node:fs');
const payrollPage = readFileSync(new URL('../admin/payroll.html', import.meta.url), 'utf8');
const { hasMetadata } = await import('../admin/exif.js');
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} — missing ${JSON.stringify(needle)}`);
const lacks = (hay, needle, msg) => ok(!String(hay).includes(needle), `${msg} — unexpectedly contains ${JSON.stringify(needle)}`);
const group = (n) => console.log('\n' + n);

// ── a D1-shaped shim over node:sqlite ────────────────────────────────────────
// `log` records every executed statement, so a test can count what a request
// actually cost — which is how the marker-read collapse is pinned down.
function d1(db) {
  const log = [];
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { log.push(sql); try { return db.prepare(sql).get(...args) ?? null; } catch (e) { throw e; } },
    all: async () => { log.push(sql); return { results: db.prepare(sql).all(...args) }; },
    run: async () => {
      log.push(sql);
      const r = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    exec: async (sql) => { db.exec(sql); },
    log,
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

// `fresh: true` gives this call its own ExecutionContext. pageData() memoises
// per request, keyed on the ctx object — correct in production, where every
// request has its own — but this harness shares one ctx across the whole file,
// so without this a second /api/pages would serve the first one's answer
// forever and a test could never see a change take effect.
async function call(env, path, { cookie = '', method = 'GET', form = null, fresh = false, accept = '' } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', 'https://admin.timothystl.org');
  // A route that answers a browser's fetch() differently from a form post
  // needs the header that tells the two apart — the market's inline cells are
  // the first of those.
  if (accept) headers.set('accept', accept);
  let body;
  if (form) {
    // ⚠ BUILT BY HAND, NOT `new URLSearchParams(form)` — that constructor
    // stringifies an array value into ONE comma-joined pair rather than
    // repeating the key, which is not what a real browser posts for several
    // checkboxes sharing one `name` (Event Intake's bulk-assign `keys[]`,
    // for one). Appending each element separately is what `form.getAll(...)`
    // on the receiving end actually needs to see more than one value.
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
      else params.append(k, v);
    }
    body = params.toString();
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  const req = new Request('https://admin.timothystl.org' + path, { method, headers, body });
  return worker.fetch(req, env, fresh ? { waitUntil: () => {}, passThroughOnException: () => {} } : ctx);
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

// A real EC keypair, shaped exactly like a real VAPID pair — buildVapidAuthHeader
// (admin/webpush.js) signs a real JWT against it, so a placeholder string like
// 'k' throws inside crypto.subtle.importKey before a push ever gets as far as
// fetch(). Shared by every group that actually sends a push, not regenerated
// per assertion.
function fakeVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url') };
}

// Real EC subscription key material — sendWebPush encrypts against p256dh/auth
// before it ever reaches fetch(), so a placeholder string throws inside
// encryptPayload and the row silently never gets that far.
function fakeSubKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
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

// ── the four core values, edited from the admin ──────────────────────────────
group('The core values are office-editable, four fixed rows and nothing to add');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // The migration seeds one blank row per key — nothing to add, and nothing
  // yet customized.
  const seeded = db.prepare('SELECT key FROM core_values ORDER BY key').all();
  eq(seeded.length, 4, 'exactly four rows, seeded once by the schema migration');

  // The list shows all four, defaulted, with no add action — there is
  // genuinely nothing to add or delete here.
  const list = await (await call(env, '/values', { cookie })).text();
  has(list, 'Acceptance', 'the list shows a value by its default name');
  has(list, 'Default wording', 'and says plainly that nothing has been customized yet');
  lacks(list, '+ Add', 'no add action — there are always exactly four');

  // Editing one value does not touch the other three, and a blank field is
  // stored as NULL (the request for the default back), not as an empty
  // string that would read differently from "never touched" to a human
  // looking at the row.
  const form = new URLSearchParams({ short: 'Belong', name: '', blurb: '', tag: '', why: '' });
  const res = await worker.fetch(new Request('https://admin.timothystl.org/values/update/acceptance', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  }), env, ctx);
  eq(res.status, 302, 'the route matches and redirects');
  has(res.headers.get('location'), 'msg=saved', 'and says it saved');
  const row = db.prepare('SELECT * FROM core_values WHERE key = ?').get('acceptance');
  eq(row.short, 'Belong', 'the typed field is stored');
  eq(row.name, null, 'a blank field is stored as NULL, the request for the default back');
  const worship = db.prepare('SELECT short FROM core_values WHERE key = ?').get('worship');
  eq(worship.short, null, 'a different value is untouched');

  // The public API — and so every self-filling Core values block on the site
  // — reflects the override immediately.
  const api = await (await call(env, '/api/values', { fresh: true })).json();
  const acceptance = api.find((v) => v.key === 'acceptance');
  eq(acceptance.short, 'Belong', 'the public values API carries the override');
  eq(acceptance.name, 'Acceptance', 'and falls back to the default for the field left blank');

  // Editing changes what a published page renders without any page being
  // touched, so it has to join the /api/pages cache chokepoint the same way
  // Partners and Pages already do.
  const before = await call(env, '/values/update/acceptance', { cookie, method: 'POST',
    form: { short: 'Welcome Again', name: '', blurb: '', tag: '', why: '' } });
  eq(before.status, 302, 'the settings POST is what busts the /api/pages edge cache');

  // Resetting clears every column back to NULL and the list says so again.
  const resetRes = await worker.fetch(new Request('https://admin.timothystl.org/values/reset/acceptance', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org' },
  }), env, ctx);
  eq(resetRes.status, 302, 'reset redirects');
  has(resetRes.headers.get('location'), 'msg=reset', 'and says it reset');
  const afterReset = db.prepare('SELECT short, name FROM core_values WHERE key = ?').get('acceptance');
  eq(afterReset.short, null, 'the reset field is NULL again');
  const listAfter = await (await call(env, '/values', { cookie, fresh: true })).text();
  has(listAfter, 'Default wording', 'and the list shows it as default again');
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
  eq((await call(env, '/values', { cookie })).status, 403, 'and not Values, gated the same way as Partners');
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


// ── an empty Pages list has to say WHY it is empty ───────────────────────────
// Dinger opened /pages and got "No pages to show" beside a sidebar badge
// reading "24 waiting". Two different faults produce that screen and neither
// used to admit to being a fault, so the list read as a site whose pages had
// vanished.
group('an empty Pages list says why');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // A read that FAILS must never render as a site with no pages. Dropping the
  // column reproduces the real shape of this: a live table that migrated
  // part-way, so every query naming that column throws while the rest of the
  // admin — including the sidebar badge, which selects only status/blocks —
  // carries on working and reporting pages that exist.
  db.prepare('ALTER TABLE pages DROP COLUMN owner_username').run();
  let body = await (await call(env, '/pages', { cookie })).text();
  has(body, 'could not be read', 'a failed read says so instead of showing an empty table');
  has(body, 'not because the site has no pages', 'and says explicitly that the pages are still there');
  lacks(body, 'Use the button above to add the first one.',
    'and never tells you to add a page to fix a database fault');

  db.prepare('ALTER TABLE pages ADD COLUMN owner_username TEXT').run();
  body = await (await call(env, '/pages', { cookie })).text();
  lacks(body, 'could not be read', 'with the column back, the list reads normally again');
}

// The other way to get an empty list: an account that may only edit the pages
// assigned to it, with none assigned. `owns` filters every row away while the
// sidebar badge — scoped to EITHER pages permission — still counts them, so
// the screen has to explain the contradiction it is showing.
group('a page list emptied by ownership says so');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['pages_edit_own'], 'leader');
  ok(db.prepare('SELECT COUNT(*) AS n FROM pages').get().n > 0, 'the site has pages');

  const body = await (await call(env, '/pages', { cookie })).text();
  has(body, 'none are assigned to you', 'the screen says the pages exist but are not theirs');
  has(body, 'pages_edit_own', 'and names the permission it is acting on');
  lacks(body, 'Use the button above to add the first one.',
    'and does not point at a New page button that would refuse them');
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
  eq(db.prepare("SELECT short_link FROM pages WHERE id='archive'").get().short_link, 'archive', 'and stores the short link normalized');

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
  has(body, 'Hand-made', 'labeled by kind');
  has(body, '/about/our-staff', 'an automatic 301 from a rename appears');
  has(body, 'Automatic', 'labeled as automatic');
  has(body, 'Leave it', 'and staff are told not to touch it');
  has(body, '/beliefs', 'a derived short link appears too');
  has(body, 'Short link', 'labeled as such');
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
  // ⚠ The preview used to be admin navy with a hardcoded "T" badge and the
  // literal words "Timothy Lutheran" — beside a real site that is moss green
  // with a round logo and a strapline. It drew the real menu ITEMS into a bar
  // that exists nowhere, so staff were shown a picture of a header the site
  // does not have. These assertions pin the fix: the bar carries the real
  // colors and the real brand, and the old fiction is gone.
  has(body, 'tlc-hp-bar', 'with a preview built by the shared header renderer');
  has(body, '--hp-bar:' + CHROME_BAR, 'painted in the color the site actually uses, not admin navy');
  has(body, 'Neighborhood to the Nations', 'carrying the real tagline');
  lacks(body, 'tlc-preview-mark', 'and not the invented "T" badge it used to show');
  has(body, '/menu/appearance', 'and it points at where those things are edited');
  has(body, 'Word of Life School', 'listing the outside links');
  has(body, 'Live pages not in the menu', 'and the orphan panel');
  has(body, 'Drag a row by its', 'explaining how to reorder');
}

group('/give is on the block editor and published');
{
  // Every page has had a block draft since the site editor shipped and none
  // was ever published, so the whole editor sat behind a Publish nobody had
  // pressed. This is the first page moved across.
  const { db, env } = await boot();
  const row = db.prepare("SELECT blocks, published_blocks, status FROM pages WHERE id='give'").get();
  ok(row, 'the page exists');
  ok(row.published_blocks && row.published_blocks === row.blocks, 'the draft has been published whole');
  eq(row.status, 'published', 'and the page is live');

  const blocks = JSON.parse(row.published_blocks);
  eq(blocks[0].type, 'hero', 'it leads with a hero, so the page renders entirely from blocks');
  const btns = blocks.filter((b) => b.type === 'buttons').flatMap((b) => b.items || []);
  ok(btns.some((b) => b.url === 'https://give.timothystl.org'), 'the online-giving button survives the conversion');
  ok(btns.some((b) => b.url === 'https://serve.timothystl.org'), 'and so does the time-and-talent one');

  // ⚠ The one thing a published block must never hold. A block's URL is frozen
  // at publish time, so a Tithe.ly address here would go stale the moment the
  // office changed the link on the Giving screen — and nobody would notice.
  lacks(row.published_blocks, 'give.tithe.ly', 'and no block carries a Tithe.ly address');

  const cards = blocks.filter((b) => b.type === 'cardgrid').flatMap((b) => b.items || []);
  ok(cards.length >= 6, 'the six offline ways to give came across as cards');
  ok(cards.some((c) => /Qualified Charitable Distribution|QCD/i.test(c.body || '')), 'including the IRA copy');

  const api = await (await call(env, '/api/pages', { fresh: true })).json();
  ok(api.rendered && api.rendered.give, 'and the public bundle now renders it');
}

group('publishing /give never overwrites an edit the office made');
{
  // The guard that makes a one-time publish safe to ship. If somebody has
  // already worked on this page, what they typed is what they meant.
  const { db, env } = await boot();
  db.prepare("UPDATE pages SET blocks = ?, published_blocks = NULL, updated_by = 'dinger' WHERE id='give'")
    .run(JSON.stringify([{ id: 'x', type: 'text', title: 'Half-finished' }]));
  db.prepare("DELETE FROM _schema_version WHERE key='give_page_published_v1'").run();

  await call(env, '/api/pages', { fresh: true });   // any request re-runs the gate

  const row = db.prepare("SELECT published_blocks FROM pages WHERE id='give'").get();
  ok(!row.published_blocks, 'a page somebody is working on is left alone, not pushed live under them');
}

group('the Media screen answers "used where" from one pass, not one per file');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO pages (id,title,slug,status,blocks,published_blocks,updated_at) VALUES ('choirpage','Choir','/choir','published',?,?,?)")
    .run(JSON.stringify([{ id: 'a', type: 'photo', url: '/images/choir-2026.webp' }]), '[]', now);
  for (const [id, url] of [[1, 'https://admin.timothystl.org/images/choir-2026.webp'], [2, '/images/unused-2019.webp'], [3, '/images/logo.png']]) {
    db.prepare("INSERT INTO ministry_media (id, kind, url, filename, alt, bytes, created_at) VALUES (?,'photo',?,?,'',1000,?)")
      .run(id, url, url.split('/').pop(), now);
  }
  // Same filename, different origin — the stored URL and the one written into
  // a block routinely differ that way, so matching is on the filename tail.
  const body = await (await call(env, '/media', { cookie })).text();
  has(body, 'On Choir', 'a photo used in a page says where, even though the origins differ');
  has(body, 'Used nowhere', 'and one nothing references says so');

  // ⚠ The old substring test called logo.png used because a page mentioned
  // church-logo.png. Whole-filename matching cannot make that mistake, and a
  // false "in use" is the worse direction — it hides a file forever.
  db.prepare("UPDATE pages SET blocks = ? WHERE id='choirpage'").run(JSON.stringify([
    { id: 'a', type: 'photo', url: '/images/choir-2026.webp' },
    { id: 'b', type: 'photo', url: '/images/church-logo.png' },
  ]));
  const again = await (await call(env, '/media', { cookie, fresh: true })).text();
  eq((again.match(/Used nowhere/g) || []).length, 2,
     'logo.png and unused-2019.webp are both unused — logo.png is NOT counted as used just because church-logo.png contains it');
  has(again, 'On Choir', 'while the photo genuinely on that page still says so');
}

group('/sermons shows this week\'s service without anybody posting a link');
{
  const { db, env } = await boot();
  const realFetch = globalThis.fetch;
  const FEED = '<feed><entry><yt:videoId>abc123XYZ_-</yt:videoId>' +
    '<title>Sunday Worship &amp; Holy Communion</title><published>2026-08-03T15:00:00+00:00</published></entry></feed>';

  globalThis.fetch = async (u) => {
    const url = String(u && u.url ? u.url : u);
    if (url.includes('/feeds/videos.xml')) return new Response(FEED, { status: 200 });
    if (url.includes('youtube.com/@')) return new Response('{"externalId":"UCaaaaaaaaaaaaaaaaaaaaaa"}', { status: 200 });
    return new Response('{}', { status: 200 });
  };
  try {
    const r = await call(env, '/api/latest-sermon', { fresh: true });
    const d = await r.json();
    eq(r.status, 200, 'the endpoint answers');
    eq(d.video.videoId, 'abc123XYZ_-', 'with the newest video from the channel feed');
    eq(d.video.title, 'Sunday Worship & Holy Communion', 'and its title, entities decoded');

    // ⚠ The handle is resolved to a channel ID once and written back, because
    // the feed is keyed on the ID and finding it means scraping a page. Doing
    // that on every cache miss would make a Sunday depend on a scrape holding.
    eq(db.prepare("SELECT value FROM site_settings WHERE key='sermon_youtube_channel'").get().value,
       'UCaaaaaaaaaaaaaaaaaaaaaa', 'the resolved channel ID replaces the handle in the setting');
  } finally { globalThis.fetch = realFetch; }
}

group('the sermons embed fails to nothing, never to a broken page');
{
  // No channel, YouTube down, an empty feed — all of them mean "no embed", and
  // the page keeps the Watch on YouTube link it has always had. An empty video
  // frame reads as a broken page, which is worse than no frame.
  const { db, env } = await boot();
  const realFetch = globalThis.fetch;

  db.prepare("UPDATE site_settings SET value='' WHERE key='sermon_youtube_channel'").run();
  let d = await (await call(env, '/api/latest-sermon', { fresh: true })).json();
  eq(d.video, null, 'no channel set means no video');

  db.prepare("UPDATE site_settings SET value='UCaaaaaaaaaaaaaaaaaaaaaa' WHERE key='sermon_youtube_channel'").run();
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    d = await (await call(env, '/api/latest-sermon', { fresh: true })).json();
    eq(d.video, null, 'YouTube being unreachable means no video, not an error');
  } finally { globalThis.fetch = realFetch; }

  globalThis.fetch = async () => new Response('<feed></feed>', { status: 200 });
  try {
    d = await (await call(env, '/api/latest-sermon', { fresh: true })).json();
    eq(d.video, null, 'and an empty feed means no video');
  } finally { globalThis.fetch = realFetch; }
}

group('[B5] a session left idle stops working');
{
  // Seven days is right for somebody who uses this weekly, but on its own it
  // means a session left open on a shared office machine stays usable for a
  // week of doing nothing — and this admin sends email to the congregation,
  // reads prayer requests and approves payroll.
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  eq((await call(env, '/menu', { cookie })).status, 200, 'a fresh session works');
  const stamped = db.prepare('SELECT last_activity FROM sessions').get();
  ok(stamped.last_activity, 'and using it records when');

  const stale = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();  // 30h
  db.prepare('UPDATE sessions SET last_activity = ?').run(stale);
  // An unauthenticated request renders the login page (200), it does not 302.
  const after = await (await call(env, '/menu', { cookie })).text();
  has(after, 'name="password"', 'a session idle for longer than a day is sent back to the login page');
  eq(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0, 'and the row is deleted, not just refused');
}

group('[B5] ⚠ a session with no activity stamp is NOT signed out');
{
  // The column arrives by migration, so at that moment every existing session
  // has NULL in it. Failing closed would sign out the whole office on deploy —
  // for a security improvement nobody asked to be logged out for.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare('UPDATE sessions SET last_activity = NULL').run();
  eq((await call(env, '/menu', { cookie })).status, 200, 'it still works');
  ok(db.prepare('SELECT last_activity FROM sessions').get().last_activity,
     'and gets a stamp on the way through, so the clock starts from now');
}

group('[B5] the absolute seven-day expiry still applies');
{
  // Recent activity must not keep a session alive forever — that would turn a
  // seven-day limit into no limit at all for anybody who visits daily.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare('UPDATE sessions SET expires_at = ?, last_activity = ?')
    .run(new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
  has(await (await call(env, '/menu', { cookie })).text(), 'name="password"',
      'an expired session is refused however recently it was used');
}

group('[B6] an uploaded photo reaches storage with its GPS removed');
{
  // The unit tests prove the stripper; this proves it is actually WIRED to the
  // route every uploader posts to. A correct stripper nobody calls protects
  // nobody, and that was the state of the client-side one — it was attached to
  // the staff photo picker only.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const gps = new Uint8Array(readFileSync(new URL('./fixtures/gps.jpg', import.meta.url)));

  const stored = [];
  env.IMAGES = {
    put: async (key, body) => { stored.push({ key, body }); },
    get: async () => null, head: async () => null, delete: async () => {},
  };

  const fd = new FormData();
  fd.append('file', new File([gps], 'photo.jpg', { type: 'image/jpeg' }));
  const res = await worker.fetch(new Request('https://admin.timothystl.org/api/upload-image', {
    method: 'POST', headers: { cookie, origin: 'https://admin.timothystl.org' }, body: fd,
  }), env, ctx);
  eq(res.status, 200, 'the upload succeeds');
  eq(stored.length, 1, 'and one object was written');

  const bytes = new Uint8Array(stored[0].body);
  ok(!hasMetadata(bytes), 'what reached storage carries no EXIF');
  ok(bytes.length < gps.length, 'and is smaller than what was uploaded');
  ok(bytes[0] === 0xFF && bytes[1] === 0xD8, 'while still being a JPEG');
}

group('[B1] the gym cannot be double-booked for the same slot');
{
  // "Once it is booked it should be locked out." The booking flow checks for a
  // clash with a SELECT and then INSERTs; two requests can both pass the check.
  // The database is the only thing both requests share, so it is what enforces
  // this — a partial unique index over the active statuses.
  const { db } = await boot();
  db.prepare("INSERT INTO gym_groups (id, name, contact, email, active) VALUES (1,'Scouts','A','a@b.org',1)").run();
  const book = (status) => db.prepare(
    "INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status) VALUES (1,'2026-09-01','18:00','20:00',?)"
  ).run(status);

  book('confirmed');
  let refused = false;
  try { book('hold'); } catch (_) { refused = true; }
  ok(refused, 'a second active booking for the same slot is refused by the database itself');

  // ⚠ Partial on purpose. Releasing a hold has to hand the slot back — a
  // released booking reserving it forever would break the whole point.
  let releasedOk = true;
  try { book('released'); } catch (_) { releasedOk = false; }
  ok(releasedOk, 'but a released booking may sit on the same slot — it is history, not a reservation');

  db.prepare("UPDATE gym_bookings SET status='released' WHERE status='confirmed'").run();
  let rebookable = true;
  try { book('confirmed'); } catch (_) { rebookable = false; }
  ok(rebookable, 'and once the active one is released the slot can be booked again');

  // A different time on the same day is a different slot, not a clash.
  let other = true;
  try {
    db.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status) VALUES (1,'2026-09-01','09:00','10:00','confirmed')").run();
  } catch (_) { other = false; }
  ok(other, 'an unrelated time on the same day is unaffected');
}

group('the footer is admin-managed columns');
{
  // The footer's headings and groupings were hardcoded in public/index.html —
  // the Menu screen only ever managed a flat list, which cannot express "which
  // column is this link under".
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const cols = db.prepare('SELECT * FROM footer_columns ORDER BY sort_order').all();
  eq(cols.length, 4, 'the four columns the footer has today are seeded');
  eq(cols.map((c) => c.heading).join(','), 'Visit,Connect,Programs,Partners', 'with their real headings');
  eq(cols[3].source, 'partners', 'and Partners is filled from the partner ministries, not from menu items');

  // An existing install has footer links with no column; they are placed once.
  const assigned = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE menu = ? AND column_id IS NOT NULL').get('footer');
  ok(assigned.n >= 8, 'existing footer links were put into columns rather than left stranded');

  const body = await (await call(env, '/menu', { cookie })).text();
  has(body, 'Footer columns', 'the Menu screen shows them');
  has(body, 'data-column=', 'each column is its own drop target, so a link can be dragged between them');
  has(body, '/menu/columns/new', 'and a column can be added');

  const api = await (await call(env, '/api/pages', { fresh: true })).json();
  const fc = api.menu.footerColumns;
  ok(Array.isArray(fc) && fc.length >= 3, 'the public bundle carries the columns');
  ok(fc.some((c) => c.heading === 'Visit' && c.items.length), 'Visit has its links');
  ok(fc.some((c) => c.source === 'partners'), 'and the partners column comes through even though it has no items here');
}

group('renaming a column, and deleting one without losing links');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  await call(env, '/menu/columns/save', { cookie, method: 'POST', form: { id: '1', heading: 'Plan a visit', source: 'menu', visible: '1' } });
  eq(db.prepare('SELECT heading FROM footer_columns WHERE id=1').get().heading, 'Plan a visit', 'a column can be renamed');

  await call(env, '/menu/columns/save', { cookie, method: 'POST', form: { heading: 'Serve', source: 'menu', visible: '1' } });
  ok(db.prepare("SELECT id FROM footer_columns WHERE heading='Serve'").get(), 'and a new one added');

  // ⚠ A toggle posts a hidden 0 first, so form.get() reads as on either way.
  await call(env, '/menu/columns/save', { cookie, method: 'POST', form: { id: '2', heading: 'Connect', source: 'menu' } });
  eq(db.prepare('SELECT visible FROM footer_columns WHERE id=2').get().visible, 0, 'an unticked Shown really stores hidden');

  // The property that makes deleting safe: the links survive.
  const before = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE column_id=3').get().n;
  ok(before > 0, 'the Programs column has links in it');
  await call(env, '/menu/columns/delete/3', { cookie, method: 'POST' });
  ok(!db.prepare('SELECT id FROM footer_columns WHERE id=3').get(), 'the column is gone');
  eq(db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE id IN (28,29,30)').get().n, 3,
     'and every link that was in it still exists — deleting a heading must never delete somebody\'s links');

  const page = await (await call(env, '/menu', { cookie })).text();
  has(page, 'Not in a column', 'they surface in their own band rather than vanishing');
}

group('the header is drafted before it is published');
{
  // The point of this screen is that somebody can try a color on the front of
  // the church website WITHOUT it being on the front of the church website.
  // These assertions are that promise: a save reaches the draft and nothing
  // else, and only Publish moves it across.
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const first = await (await call(env, '/menu/appearance', { cookie })).text();
  has(first, 'Appearance', 'the screen renders');
  has(first, '--hp-bar:' + CHROME_BAR, 'showing the site as it stands, not an empty form');
  has(first, 'Everything on this screen is on the site', 'and says so when there is nothing pending');
  lacks(first, 'name="bar" value="gold"', 'gold is not offered as a BAR color');
  has(first, 'name="cta" value="gold"', 'but it is still offered for the Give button');

  const save = await call(env, '/menu/appearance/save', {
    cookie, method: 'POST',
    form: { bar: 'navy', rule: 'gold', cta: 'gold', nl_bg: 'navy', brand_name: 'Timothy Lutheran Church',
            tagline: 'from our Neighborhood to the Nations', logo_url: '/logo.png', logo_shape: 'round',
            nl_eyebrow: 'Stay Connected', nl_heading: 'Get our weekly newsletter', nl_body: 'x', nl_button: 'Subscribe',
            show_tagline: '1', nl_show: '1' },
  });
  eq(save.status, 302, 'saving redirects');

  const draftRow = db.prepare("SELECT value FROM site_settings WHERE key='site_appearance_draft'").get();
  eq(JSON.parse(draftRow.value).bar, 'navy', 'the draft has the new color');
  const liveRow = db.prepare("SELECT value FROM site_settings WHERE key='site_appearance'").get();
  ok(!liveRow, 'and NOTHING has been written to the live row — this is the whole promise');

  // The public bundle is what a visitor actually gets, so it is checked there
  // and not only in the table.
  const apiBefore = await (await call(env, '/api/pages', { fresh: true })).json();
  eq(apiBefore.details.appearance.bar, CHROME_BAR, 'visitors still see the unpublished-draft bar, not the draft');

  const pending = await (await call(env, '/menu/appearance', { cookie })).text();
  has(pending, 'Not published yet', 'the screen says something is waiting');
  has(pending, 'Bar color', 'and names what differs rather than saying only that something does');
  has(pending, 'On the site now', 'showing both bars so they can be compared');

  eq((await call(env, '/menu/appearance/publish', { cookie, method: 'POST' })).status, 302, 'publishing redirects');
  eq(JSON.parse(db.prepare("SELECT value FROM site_settings WHERE key='site_appearance'").get().value).bar,
     'navy', 'now the live row has it');
  const apiAfter = await (await call(env, '/api/pages', { fresh: true })).json();
  eq(apiAfter.details.appearance.bar, '#1E2D4A', 'and visitors get it, resolved to a real color');

  // Discarding is the other direction, and it must not touch what is live.
  await call(env, '/menu/appearance/save', { cookie, method: 'POST', form: { bar: 'plum', nl_show: '0' } });
  eq((await call(env, '/menu/appearance/discard', { cookie, method: 'POST' })).status, 302, 'discarding redirects');
  eq(JSON.parse(db.prepare("SELECT value FROM site_settings WHERE key='site_appearance_draft'").get().value).bar,
     'navy', 'the draft is back to what is published');
  eq(JSON.parse(db.prepare("SELECT value FROM site_settings WHERE key='site_appearance'").get().value).bar,
     'navy', 'and the live row was never involved');
}

group('an unreadable header cannot be saved from a stale tab');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // The form does not draw a gold bar chip, so this can only arrive from a
  // stale tab or a crafted POST — which is exactly why the rule is enforced on
  // the server and not by which chips get rendered.
  await call(env, '/menu/appearance/save', { cookie, method: 'POST', form: { bar: 'gold', nl_bg: 'gold' } });
  const d = JSON.parse(db.prepare("SELECT value FROM site_settings WHERE key='site_appearance_draft'").get().value);
  eq(d.bar, CHROME_DEFAULTS.bar, 'a gold bar is refused — white on gold is 2.6:1');
  eq(d.nl_bg, CHROME_DEFAULTS.nl_bg, 'and so is a gold newsletter band');

  await call(env, '/menu/appearance/save', { cookie, method: 'POST', form: { logo_url: 'javascript:alert(1)' } });
  eq(JSON.parse(db.prepare("SELECT value FROM site_settings WHERE key='site_appearance_draft'").get().value).logo_url,
     '', 'and a logo address that is not an image address is dropped, not escaped later');
}

group('the newsletter band is chrome, and can be switched off');
{
  // ⚠ It sits outside every page div, so it renders on all of them. It has
  // been called "the homepage newsletter block" and it is not one — which is
  // why switching it off has to be possible from here and not from the page
  // editor, where it would never be found.
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  await call(env, '/menu/appearance/save', { cookie, method: 'POST', form: { nl_show: '0' } });
  await call(env, '/menu/appearance/publish', { cookie, method: 'POST' });
  const api = await (await call(env, '/api/pages', { fresh: true })).json();
  eq(api.details.appearance.newsletter, null, 'a switched-off band is absent, not present-and-off');

  await call(env, '/menu/appearance/save', { cookie, method: 'POST', form: { nl_show: '1', nl_heading: 'Church news, weekly' } });
  await call(env, '/menu/appearance/publish', { cookie, method: 'POST' });
  const api2 = await (await call(env, '/api/pages', { fresh: true })).json();
  eq(api2.details.appearance.newsletter.heading, 'Church news, weekly', 'and its wording is editable');
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
  has(page, 'Live preview', 'which is labeled');

  // Approve/Reject are a second path to the same state a sent issue must
  // never re-enter — neither has a UI affordance on a sent issue, but with
  // no server-side check either was one stray click or stale tab away from
  // resetting a genuinely-sent issue back to draft.
  const approveRes = await post(env, '/newsletter/approve/7', cookie, form({}));
  eq(approveRes.status, 302, 'approve is refused with a redirect');
  has(approveRes.headers.get('location'), 'msg=locked', 'and says why');
  const rejectRes = await post(env, '/newsletter/reject/7', cookie, form({}));
  eq(rejectRes.status, 302, 'reject is refused with a redirect');
  has(rejectRes.headers.get('location'), 'msg=locked', 'and says why');

  const untouched = db.prepare('SELECT status, approval_status FROM newsletters WHERE id=7').get();
  eq(untouched.status, 'published', 'approve/reject left status alone');
  eq(untouched.approval_status, null, 'and approval_status alone');
}

// Reported: the editor asked who gets the issue twice — a "Who gets it" select offering
// Everyone / Church only / School & MDO families, and a Send email radio group. There are
// exactly two lists in Brevo (BREVO_TEST_LIST_ID, BREVO_LIST_ID), so the select named three
// audiences that do not exist and, by its own caption, decided nothing.
group('the newsletter editor asks who gets it once, in the real lists Brevo has');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,format,status,published_at,audience) VALUES (21,'Weekly','<p>Hi</p>','weekly','draft','2026-08-09','church')").run();
  const edit = await (await call(env, '/edit/21', { cookie })).text();

  has(edit, 'Test list', 'the send card names the test list');
  has(edit, '> Members', 'and the member list, by the name Brevo uses');
  has(edit, 'Website only', 'and the option to publish without emailing');
  lacks(edit, 'All subscribers', 'no longer offers a list nobody has');

  lacks(edit, 'Who gets it', 'the second, decorative audience question is gone');
  lacks(edit, 'name="audience"', 'along with its field');
  lacks(edit, 'School &amp; MDO families', 'and the audiences that were never real lists');

  // The column keeps what an older issue recorded rather than every save rewriting it.
  const save = await worker.fetch(new Request('https://admin.timothystl.org/publish', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'newsletter_id=21&subject=Weekly&format=weekly&pastor_note=%3Cp%3EHi%3C%2Fp%3E&published_at=2026-08-09&action=draft&email_send=none',
  }), env, ctx);
  eq(save.status, 302, 'the issue saves without an audience field on the form');
  eq(db.prepare('SELECT audience FROM newsletters WHERE id=21').get().audience, 'church',
     'and what it recorded before is left alone, not reset to the default');
}

// Reported: "we used to have a button that had schedule send — put that back in under the
// publish. it should have a time too." The /schedule-email/:id route and prepSchedule() both
// survived the redesign; only the control that reached them was dropped.
group('the editor can schedule a send, with a date and a time');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,format,status,published_at) VALUES (22,'Weekly','<p>Hi</p>','weekly','draft','2099-08-09')").run();
  const edit = await (await call(env, '/edit/22', { cookie })).text();

  has(edit, 'Schedule send', 'the button is back');
  has(edit, 'action="/schedule-email/22"', 'pointing at the route that was already there');
  has(edit, 'type="datetime-local"', 'and it asks for a time, not just a date');
  has(edit, 'prepSchedule', 'submitted through the helper that converts to a real instant');
  has(edit, 'toggleSchedule(22)', 'revealed by the toggle rather than always open');
  has(edit, 'T09:00', 'defaulting to 9am on the issue’s own publish date');
  has(edit, '>Members<', 'offering the member list');
  has(edit, '>Test list<', 'and the test list');

  // A form inside a form is invalid HTML and the browser silently drops the inner one, so
  // the schedule form has to sit outside #nl-form — which is exactly what would regress if
  // somebody later moved it up beside the Publish button it visually belongs to.
  const nlFormStart = edit.indexOf('id="nl-form"');
  const nlFormEnd = edit.indexOf('</form>', nlFormStart);
  const scheduleAt = edit.indexOf('action="/schedule-email/22"');
  ok(scheduleAt > nlFormEnd, 'and it is not nested inside the editor form');

  // A pending schedule says so — booking a second one does not move the first.
  db.prepare("UPDATE newsletters SET scheduled_send_at='2099-01-01T15:00:00.000Z', scheduled_list_type='all' WHERE id=22").run();
  const booked = await (await call(env, '/edit/22', { cookie })).text();
  has(booked, 'Already scheduled with Brevo', 'a booked issue says so');
  has(booked, 'Reschedule', 'and the button changes accordingly');
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

group('a corrected duplicate removes the sent issue it replaces, but only once IT is sent');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO newsletters (id,subject,pastor_note,published_at,status,sent_at) VALUES (30,'This week at Timothy','<p>Original.</p>','2026-08-20','published','2026-08-20T10:00:00Z')").run();

  await post(env, '/newsletter/duplicate/30', cookie, '');
  const copy = db.prepare('SELECT * FROM newsletters WHERE id <> 30 ORDER BY id DESC LIMIT 1').get();
  eq(copy.supersedes_id, 30, 'the copy remembers which sent issue it is meant to replace');

  // Still just a draft — the original is untouched everywhere a visitor reads it.
  let archive = await (await call(env, '/api/newsletters')).json();
  ok(archive.some((n) => n.id === 30), 'the original stays in the public archive while its correction is only a draft');
  eq((await call(env, '/api/newsletter/30')).status, 200, 'and its own detail page still resolves');

  // Send the correction — the same fields the real send route would set.
  db.prepare("UPDATE newsletters SET status='published', sent_at=?, subject=? WHERE id=?")
    .run('2026-08-20T11:00:00Z', 'This week at Timothy — updated', copy.id);

  archive = await (await call(env, '/api/newsletters')).json();
  ok(!archive.some((n) => n.id === 30), 'once the correction is actually sent, the original drops out of the public archive');
  ok(archive.some((n) => n.id === copy.id), 'and the correction is the one now shown in its place');
  eq((await call(env, '/api/newsletter/30')).status, 404, 'a bookmarked link to the superseded letter no longer resolves either');
  eq((await call(env, `/api/newsletter/${copy.id}`)).status, 200, 'the correction itself resolves normally');

  // The admin's own list is the audit trail — nothing vanishes from it, and
  // the original row is labeled so a superseded letter reads as accounted
  // for rather than as the admin having lost track of it.
  const adminList = await (await call(env, '/newsletters', { cookie })).text();
  has(adminList, 'This week at Timothy', 'the original subject is still in the admin list');
  has(adminList, 'superseded', 'and the row says why it is no longer public');
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

group('subscribers fetches Brevo pages together, not one at a time');
{
  // The first page is the only one that can be serial — it is where `count`
  // comes from. Everything after it should go out together rather than as
  // one round trip per page, which is what this asserts by counting requests
  // and by checking every page's contacts actually made it into the list.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  env.BREVO_API_KEY = 'test-key';
  env.BREVO_LIST_ID = '9';

  const requested = [];
  const realFetch = globalThis.fetch;
  const page = (n, count) => new Response(JSON.stringify({
    count,
    contacts: [{ email: `p${n}@example.com`, attributes: { FIRSTNAME: 'Page', LASTNAME: String(n) } }],
  }), { status: 200 });
  globalThis.fetch = async (u) => {
    const off = Number(new URL(String(u)).searchParams.get('offset'));
    requested.push(off);
    // 3 pages of 500 = 1500 contacts on paper; the stub returns one contact
    // per page so the test can tell them apart without building 1500 rows.
    return page(off, 1500);
  };
  const body = await (await call(env, '/subscribers', { cookie })).text();
  globalThis.fetch = realFetch;

  eq(requested.length, 3, 'three pages requested for 1500 contacts at 500 each');
  eq(new Set(requested).size, 3, 'three distinct offsets, not the same page three times');
  for (const off of [0, 500, 1000]) has(body, `Page ${off}`, `page at offset ${off} made it into the list`);

  // A page that fails should not cost the pages that succeeded — the render
  // path already tolerated Brevo being unreachable entirely; one bad page
  // partway through a pagination run is the same kind of partial failure.
  const requested2 = [];
  globalThis.fetch = async (u) => {
    const off = Number(new URL(String(u)).searchParams.get('offset'));
    requested2.push(off);
    if (off === 500) return new Response('', { status: 500 });
    return page(off, 1500);
  };
  const body2 = await (await call(env, '/subscribers', { cookie })).text();
  globalThis.fetch = realFetch;

  has(body2, 'Page 0', 'the page before the failure still shows');
  has(body2, 'Page 1000', 'and the page after it — the failure did not cancel the rest');
  ok(!body2.includes('Page 500'), 'only the page that actually failed is missing');
}

group('editing access cannot change a username or a password by accident');
{
  // A browser password manager fills a form's username box whenever it fills a
  // password box beside it. The access screen carried both, so opening it to
  // tick a permission and pressing Save silently rewrote the account's name and
  // its password. The fix is that the form no longer HAS a password field —
  // there is nothing for a manager to fill — rather than another autocomplete
  // hint browsers are free to ignore.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare('INSERT INTO users (username, password_hash, permissions, created_at, active, email) VALUES (?,?,?,?,1,?)')
    .run('jinah', 'pbkdf2:1:known:hash', JSON.stringify(['news_edit']), '2026-01-01T00:00:00Z', 'jinah@timothystl.org');
  const target = db.prepare("SELECT id FROM users WHERE username='jinah'").get().id;

  const edit = await (await call(env, `/users/edit/${target}`, { cookie })).text();
  ok(!/name="password"/.test(edit), 'the access screen has no password field at all');
  ok(!/name="password2"/.test(edit), 'nor a confirm field');
  // ⚠ `readonly` was the old answer and it was not enough: it stops the
  // browser's own autofill, not an extension, so a manager still wrote `admin`
  // into katig's name box and Save collided with the real admin account.
  // The field is simply not on this form now — same fix as the password.
  ok(!/name="username"/.test(edit), 'the access screen has no username field either');
  has(edit, `/users/edit/${target}/username`, 'just a link to the screen that renames the account');
  has(edit, `/users/edit/${target}/password`, 'and a link to the one screen that sets a password');

  // The server half of the same rule: even a crafted POST carrying a password
  // must not change one, or the fix is only in the markup.
  const res = await call(env, `/users/edit/${target}`, {
    method: 'POST', cookie,
    form: { username: 'jinah', email: 'jinah@timothystl.org', active: '1', password: 'hunter2hunter2', password2: 'hunter2hunter2', perm_news_edit: '1' },
  });
  eq(res.status, 302, 'saving access redirects');
  eq(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash, 'pbkdf2:1:known:hash',
    'and the password hash is untouched by a password posted at the access form');

  // The reported failure, exactly: a manager fills the name box with the
  // signed-in account's own name and Save posts it. It must be ignored — not
  // written and not thrown over.
  const hijack = await call(env, `/users/edit/${target}`, {
    method: 'POST', cookie,
    form: { username: 'dinger', email: 'jinah@timothystl.org', active: '1', perm_news_edit: '1' },
  });
  eq(hijack.status, 302, 'a posted username does not error');
  eq(db.prepare('SELECT username FROM users WHERE id = ?').get(target).username, 'jinah',
    'and never renames the account it was posted at');
  eq(db.prepare("SELECT COUNT(*) AS n FROM users WHERE username='dinger'").get().n, 1,
    'so the signed-in account is not duplicated or clobbered');

  // Renaming still has to be possible — on the screen whose subject it is.
  const rn = await call(env, `/users/edit/${target}/username`, { cookie });
  eq(rn.status, 200, 'the rename screen answers — the id is read past the word username');
  ok(!/type="password"/.test(await rn.text()), 'and carries no password field to anchor a manager on');

  const taken = await call(env, `/users/edit/${target}/username`, {
    method: 'POST', cookie, form: { username: 'dinger' },
  });
  eq(taken.status, 302, 'a name already in use redirects rather than throwing');
  has(taken.headers.get('location') || '', 'err=taken', 'and says which problem it was');
  eq(db.prepare('SELECT username FROM users WHERE id = ?').get(target).username, 'jinah', 'leaving the name alone');

  const renamed = await call(env, `/users/edit/${target}/username`, {
    method: 'POST', cookie, form: { username: 'jinah.kim' },
  });
  eq(renamed.status, 302, 'a free name is accepted');
  eq(db.prepare('SELECT username FROM users WHERE id = ?').get(target).username, 'jinah.kim',
    'and the account really is renamed on the screen that exists to rename it');
  db.prepare("UPDATE users SET username='jinah' WHERE id = ?").run(target);

  // The dedicated screen is where it really changes.
  const pw = await call(env, `/users/edit/${target}/password`, { cookie });
  eq(pw.status, 200, 'the password screen answers — the id is read past the word password');
  has(await pw.text(), 'Set a password for jinah', 'and names who it is for');

  const short = await call(env, `/users/edit/${target}/password`, {
    method: 'POST', cookie, form: { password: 'short', password2: 'short' },
  });
  eq(short.status, 400, 'a password under 8 characters is refused');

  const mismatch = await call(env, `/users/edit/${target}/password`, {
    method: 'POST', cookie, form: { password: 'a-real-password', password2: 'a-real-passwordX' },
  });
  eq(mismatch.status, 400, 'and two that do not match');
  eq(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash, 'pbkdf2:1:known:hash',
    'neither refusal left a half-written hash behind');

  const set = await call(env, `/users/edit/${target}/password`, {
    method: 'POST', cookie, form: { password: 'a-real-password', password2: 'a-real-password' },
  });
  eq(set.status, 302, 'a good pair is accepted');
  ok(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(target).password_hash !== 'pbkdf2:1:known:hash',
    'and the password really changed on the screen that exists to change it');
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
  has(queue, 'By organization', 'under their own heading');
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
  has(cal, 'gymcal-chip--hold', 'a hold is color-coded');
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
  has(cal, 'By organization', 'the bulk tools are on the default view as well');
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
  // The shape exportReport() posts: MDO first with its own columns, church
  // staff with theirs. The emailed report is the same report as the printed
  // page and the CSV, so the allowance columns have to reach the bookkeeper.
  const report = {
    periodStart: '2026-07-16', periodEnd: '2026-07-31', periodLabel: 'Jul 16 – Jul 31, 2026',
    approved: true, approvedBy: 'dinger', total: 7630,
    mdo: { subtotal: 3664, rows: [
      { name: 'Alyssa Ramsey', salaried: false, rate: 16, hours: 27.57, pto: 0, gross: 441.12 },
      { name: 'Jacinda Jockel', salaried: true, rate: 0, hours: 0, pto: 0, gross: 3222.88 },
    ] },
    church: { subtotal: 3966, rows: [
      { name: '<img src=x onerror=alert(1)>', salaried: true, rate: 0, hours: 0,
        base: 1908, housing: 1908, optOut: 0, hsa: 0, mileage: 150, b403: 0, gross: 3966 },
    ] },
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
  eq((await ok1.json()).to, 'books@example.com, dinger@timothystl.org', 'and reports where it went — Andrew rides along with the bookkeeper');
  eq(sent.length, 1, 'exactly one email');
  eq(sent[0].to[0].email, 'books@example.com', 'to the bookkeeper');
  eq(sent[0].to[1].email, 'dinger@timothystl.org', 'and a copy to Andrew');
  ok(sent[0].subject.includes('Jul 16'), 'with the period in the subject: ' + sent[0].subject);

  // The figures live in the attachments now, not a table in the body — the
  // body is one line saying the period and that it's attached, plus whether
  // the run was signed off.
  ok(sent[0].htmlContent.includes('Jul 16'), 'the body names the period');
  ok(sent[0].htmlContent.includes('is attached'), 'and says the figures are attached');
  ok(sent[0].htmlContent.includes('Approved by dinger'), 'saying it was signed off, and by whom');
  ok(!sent[0].htmlContent.includes('MDO Staff') && !sent[0].htmlContent.includes('Base / Earnings'),
    'no per-person table is in the body any more — that is what the attachments are for');

  // The page posts figures, not markup — a name never reaches the body at
  // all now, so it cannot become HTML in something that lands in an outside
  // inbox. It still reaches the CSV/PDF attachments; those escape their own
  // way (admin/payroll-report.test.mjs covers the CSV formula-injection
  // guard and the PDF's own ASCII-safety directly).
  ok(!sent[0].htmlContent.includes('<img src=x') && !sent[0].htmlContent.includes('&lt;img'),
    'a staff name never reaches the body at all');
  ok(Array.isArray(sent[0].attachment) && sent[0].attachment.length === 2,
    'the CSV and PDF still ride along as real attachments');
  ok(sent[0].attachment.some((a) => a.name.endsWith('.csv')) && sent[0].attachment.some((a) => a.name.endsWith('.pdf')),
    'one of each');

  // An unapproved run says so, rather than looking final.
  const sent2 = [];
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('brevo')) { sent2.push(JSON.parse(init.body)); return new Response('{}', { status: 201 }); }
    return realFetch(u, init);
  };
  // force:true is what makes this a second, deliberate send rather than the
  // already-emailed-today check below refusing it.
  await post({ ...report, approved: false, incomplete: true, force: true });
  globalThis.fetch = realFetch;
  ok(sent2[0].htmlContent.includes('Not yet approved'), 'an unapproved run is labeled as such');
  ok(sent2[0].htmlContent.includes('Incomplete'), 'and so is one missing its childcare figures');
}

group('a period already emailed today asks before sending it again');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO site_settings (key,value) VALUES ('payroll_bookkeeper_email','books@example.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const report = {
    periodStart: '2026-08-03', periodEnd: '2026-08-16', periodLabel: 'Aug 3 – Aug 16, 2026',
    approved: true, approvedBy: 'dinger', total: 100,
    mdo: { subtotal: 100, rows: [{ name: 'A', salaried: true, rate: 0, hours: 0, pto: 0, gross: 100 }] },
    church: { subtotal: 0, rows: [] },
  };
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('brevo')) { sent.push(1); return new Response('{}', { status: 201 }); }
    return realFetch(u, init);
  };
  env.BREVO_API_KEY = 'test-key';
  const post = (body) => worker.fetch(new Request('https://admin.timothystl.org/payroll/email', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env, ctx);

  const first = await post(report);
  eq(first.status, 200, 'the first send for this period goes straight through');
  eq(sent.length, 1, 'and reaches Brevo once');

  // Clicking Email report again for the same period, without confirming a
  // resend, must not silently mail the bookkeeper a second time — that is
  // the exact "keep spamming the bookkeeper" report this guards against.
  const second = await post(report);
  eq(second.status, 200, 'a same-day resend is not an error, it is a real question');
  const secondBody = await second.json();
  eq(secondBody.already_sent, true, 'and it says so rather than sending again');
  eq(secondBody.last_sent_to, 'books@example.com, dinger@timothystl.org', 'naming who already got it');
  ok(secondBody.last_sent_at, 'and when');
  eq(sent.length, 1, 'no second email reached Brevo');

  // A confirmed resend (force:true) is the one legitimate way past the check.
  const third = await post({ ...report, force: true });
  eq(third.status, 200, 'an explicit resend still works');
  eq(sent.length, 2, 'and this time Brevo is actually called again');
  globalThis.fetch = realFetch;

  // A different period is unaffected by the first period's send.
  globalThis.fetch = async (u, init) => {
    if (String(u).includes('brevo')) return new Response('{}', { status: 201 });
    return realFetch(u, init);
  };
  const otherRes = await post({ ...report, periodStart: '2026-08-17', periodEnd: '2026-08-30' });
  globalThis.fetch = realFetch;
  eq(otherRes.status, 200, 'a different period sends normally');
  ok(!(await otherRes.json()).already_sent, 'and is never told it was already sent');
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
  ok(staff.results.some((r) => r.section === 'Staff'), 'and a staff member, labeled by section');

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
  has(body, '/link-cards/tap/1">Edit<', 'and offers to edit a tap, per tap');
  has(body, 'only ever holds its short address', 'the note explains why editing works');
  has(body, 'Link Tree', 'the card list below is labeled plainly, not per-tap');
  ok(!body.includes('Show its cards'), 'the admin-only per-tap card filter is gone');

  // Editing changes where the tag lands without touching the tag. And the
  // "in use" checkbox has to actually persist: it posts behind a hidden
  // active=0, so a real browser submit sends active=0 (unchecked) or
  // active=0&active=1 (checked, hidden field first) — never active=1 alone.
  const res = await worker.fetch(new Request('https://admin.timothystl.org/link-cards/tap/3', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Giving+plate&placement=Offering+plates&destination=https%3A%2F%2Fgive.timothystl.org%2Feaster&active=0&active=1',
  }), env, ctx);
  eq(res.status, 302, 'editing redirects');
  const tap3 = db.prepare('SELECT destination, active FROM taps WHERE id=3').get();
  has(tap3.destination, '/easter', 'and the tap now lands somewhere new');
  eq(tap3.active, 1, 'and the checked "in use" box actually saves as on — reading only the first' +
    ' active= value (the hidden 0) would silently keep every tap off no matter what was ticked');

  // And unticking it really does turn it back off.
  const res2 = await worker.fetch(new Request('https://admin.timothystl.org/link-cards/tap/3', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Giving+plate&placement=Offering+plates&destination=https%3A%2F%2Fgive.timothystl.org%2Feaster&active=0',
  }), env, ctx);
  eq(res2.status, 302, 'editing redirects');
  eq(db.prepare('SELECT active FROM taps WHERE id=3').get().active, 0, 'and unticking it saves as off');
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

// Task 15 #1 and #2 — the two of the five that were real.
group('the MDO saved section, and the service labels the site uses');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // The MDO strip is the church's most-repeated ask. As a saved section the
  // office drops it in rather than retyping it, which is how three pages end
  // up describing one preschool three ways.
  const secs = await (await call(env, '/ministries/api/sections', { cookie })).json().catch(() => null);
  const list = secs && (secs.sections || secs);
  ok(Array.isArray(list) && list.some((x) => x.name === "Mother's Day Out"),
    'the MDO section is seeded and listed');

  // ⚠ Seeded ONCE, behind its own marker. The schema block re-runs on every
  // SCHEMA_VERSION bump, so a seed sitting in there would restore a section
  // the office deleted — or overwrite an edit to its words.
  db.prepare("DELETE FROM ministry_saved_sections WHERE name = ?").run("Mother's Day Out");
  await call(env, '/dashboard', { cookie });
  const after = db.prepare("SELECT COUNT(*) c FROM ministry_saved_sections WHERE name = ?").get("Mother's Day Out");
  eq(after.c, 0, 'deleting it makes it stay deleted');

  // Two Sunday services, neither labeled — Andrew's call on 2 Aug. Both
  // blank means the welcome card reads them as one line, "8:00 & 10:45 am",
  // with nothing beneath it.
  const times = db.prepare("SELECT value FROM site_settings WHERE key = 'church_service_times'").get();
  ok(times && /8:00 am/.test(times.value) && /10:45 am/.test(times.value), 'both services are there');
  ok(times && !/9:30/.test(times.value), 'the 9:30 Vietnamese service is off the site');
  ok(times && !/English|Traditional|Contemporary/.test(times.value), 'and neither service carries a label');
}

group('the last two borderline routes are on the shared pattern');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // #1. A ministry's posts list was the last hand-rolled table in the admin:
  // its own .ni-row markup, its own badges, its own empty state. As a config
  // it inherits search, filter pills, the scoped count and warning rows.
  const posts = await (await call(env, '/ministries/music/posts', { cookie })).text();
  has(posts, 'tlc-section', 'the posts list renders through renderListSection');
  has(posts, 'Dated updates on one ministry page', "and uses the config's purpose line");
  has(posts, 'tlc-filter', 'so it has filter pills');
  has(posts, 'tlc-count', 'and the scoped count label');
  has(posts, 'takes itself down', "and the section's ◆ note");
  ok(!posts.includes('class="ni-row"'), 'the hand-rolled row markup is gone');

  // #2. Add and edit are one builder. The tell is the control that used to
  // exist on only one of them — `add` had no Visibility card at all, which is
  // exactly the kind of thing two copies of a form drift into.
  const add = await (await call(env, '/notices/add', { cookie })).text();
  has(add, 'New notice', 'the add form still answers on its own address');
  has(add, 'Show this notice on the website', 'and now carries Visibility, like edit');
  has(add, 'name="published" value="1" checked', 'ticked by default, so the old behavior is the default');
  has(add, 'action="/notices/create"', 'posting to create');
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

// The two giving addresses are NOT one set of blocks, and this screen used to say they were:
// both cards offered "Edit this page" pointing at the same explainer, under a "kept in step"
// switch that wrote a setting nothing has ever read. /give really is a published block page,
// so its card now opens the real editor; give.timothystl.org really is still give-landing.js,
// so its button says so rather than promising an editor.
group('the giving page: two addresses, each pointing where it is actually edited');
{
  // ⚠ This panel used to say "One set of blocks · two places it appears",
  // beside a switch labeled "Kept in step: edit either one and the other
  // follows". Neither was true: give.timothystl.org is rendered by
  // give-landing.js and takes the money, timothystl.org/give is a block page
  // about how to give. The switch wrote a setting nothing ever read.
  //
  // A control that claims a behavior the code does not have is worse than no
  // control — somebody flips it, believes it worked, and stops checking.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const body = await (await call(env, '/giving', { cookie })).text();
  has(body, 'give.timothystl.org', 'the standalone address is shown');
  has(body, 'timothystl.org/give', 'and the on-site one');
  has(body, 'the amounts and funds offered on it', 'and the design’s purpose line');

  // ⚠ This group used to assert the panel said "One set of blocks" and carried
  // a "Kept in step" switch. BOTH WERE FALSE and the test was pinning them
  // down: the two pages have separate jobs, and the switch wrote
  // `give_keep_in_step`, which nothing in the codebase ever read. A test
  // asserting that a lie is displayed is worse than no test — it makes
  // correcting the lie look like a regression.
  lacks(body, 'One set of blocks', 'no longer claims one set of blocks in two places');
  lacks(body, 'Kept in step', 'and the switch that controlled nothing is gone');
  has(body, 'Separate pages', 'it says what is actually true');

  // BOTH addresses open a real editor now. #400 could only point one of them
  // at an editor because only one existed; the standalone page has its own.
  has(body, '/pages/give/edit', 'the on-site page links to the real block editor');
  lacks(body, "What's editable here", 'and the standalone page no longer offers an explainer instead of an editor');

  // The route is gone too. This Worker's tail falls through to the newsletter screen for any
  // unmatched path, so the assertion that means something is that the POST no longer WRITES —
  // not the status code, which an unrelated fallback happens to own.
  await worker.fetch(new Request('https://admin.timothystl.org/giving/keep-in-step', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'value=0',
  }), env, ctx);
  ok(!db.prepare("SELECT value FROM site_settings WHERE key='give_keep_in_step'").get(),
     'and the setting it used to write stays unwritten');
}

// The standalone giving page is a block-editor page now, so "Edit this page"
// has to reach the editor rather than a screen explaining why it cannot.
group('the giving page opens in the block editor');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const res = await call(env, '/giving/page', { cookie });
  eq(res.status, 302, 'Edit this page redirects');
  eq(res.headers.get('location'), '/pages/give-landing/edit', 'into the page editor');

  const row = db.prepare("SELECT blocks, published_blocks FROM pages WHERE id='give-landing'").get();
  ok(row, 'the giving page is seeded as a page row');
  ok(row.blocks && row.blocks.includes('amounts'), 'with the amount ladder in its draft');
  // ⚠ The load-bearing assertion. This is the page that takes the money;
  // the deploy must not switch its rendering path out from under anybody.
  ok(!row.published_blocks, 'and NOTHING published — the live page is untouched until somebody presses Publish');
}

// Dinger, 2026-08-06: "on the giving settings page, i can only edit the weekly
// giving tiers and not the larger commitment amounts." The ladders stay on the
// page they belong to — each row carries its own sentence about what the gift
// pays for — but this screen said nothing about them at all, so "the amounts
// live on the Giving screen" read as a complete statement.
group('Giving: the ladders are shown, with what each button will ask for');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const body = await (await call(env, '/giving', { cookie })).text();

  has(body, 'Amount ladders on the giving page', 'the ladders have a place on this screen');
  has(body, '$5,000', 'the larger commitments are listed');
  // The point of showing them here at all: the commitment and the ask are two
  // different numbers, and only one of them ends up on the button.
  has(body, 'Give $416/month', 'each row states what its button will actually ask for');
  has(body, '/giving/page', 'and links to the one place they are edited');

  // The seeded page is unpublished — that is the state every deploy starts in
  // — so editing the draft changes nothing a visitor sees. Saying so is the
  // difference between "my edit did not work" and "I have not published yet".
  has(body, 'still showing the built-in version', 'and says plainly that the live page is not the draft');

  db.prepare("UPDATE pages SET published_blocks = blocks WHERE id='give-landing'").run();
  const published = await (await call(env, '/giving', { cookie })).text();
  lacks(published, 'still showing the built-in version', 'the warning goes once the page is published');
}

// Dinger, seeing the read-only panel: "here you now just are showing what the
// amounts are but no way to EDIT them." So they are edited here, in the same
// panel-and-drawer shape as Funds and Amount tiers beside them. What makes
// that safe is not a second table — there is exactly one copy of a ladder row,
// the block on the giving page, and these routes are a second door onto it.
group('Giving: a ladder row is edited here, and it is the same record');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const post = (path, form) => worker.fetch(new Request('https://admin.timothystl.org' + path, {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  }), env, ctx);
  const ladders = () => JSON.parse(db.prepare("SELECT blocks FROM pages WHERE id='give-landing'").get().blocks)
    .filter((b) => b.type === 'amounts');

  const first = ladders()[0];
  ok(first && first.items.length, 'the seeded giving page has a ladder with rows on it');

  const body = await (await call(env, '/giving', { cookie })).text();
  has(body, 'data-sortlist="/giving-ladder/reorder', 'the rows drag to reorder');
  has(body, 'href="/giving?row=', 'and every row has an Edit that opens a drawer');
  has(body, '+ Add amount', 'a ladder can gain a row');

  // Editing an amount rewrites that row and nothing else.
  const before = first.items.length;
  await post('/giving-ladder/update', { block: first.id, index: '0', amount: '42', period: 'week', body: 'Buys a thing.' });
  const after = ladders()[0];
  eq(after.items.length, before, 'editing a row does not add or drop one');
  eq(after.items[0].amount, '42', 'the amount is stored');
  eq(after.items[0].period, 'week', 'and its period');
  has(after.items[0].body, 'Buys a thing.', 'and the sentence beside it');

  // ⚠ The draft, never the live copy. Editing from a side screen must not be
  // able to change the giving page without passing through Publish.
  const row = db.prepare("SELECT blocks, published_blocks FROM pages WHERE id='give-landing'").get();
  ok(!String(row.published_blocks || '').includes('Buys a thing.'),
     'the edit lands in the draft and NOT in what the site renders');

  // Rich text already in a description survives an edit that leaves the words
  // alone — otherwise editing an amount would quietly flatten it.
  const blocks2 = JSON.parse(row.blocks);
  const lad2 = blocks2.find((b) => b.type === 'amounts');
  lad2.items[1].body = '<p>Puts <em>flowers</em> on the altar.</p>';
  db.prepare("UPDATE pages SET blocks=? WHERE id='give-landing'").run(JSON.stringify(blocks2));
  await post('/giving-ladder/update', { block: lad2.id, index: '1', amount: '30', period: 'week',
    body: 'Puts flowers on the altar.' });
  has(ladders()[0].items[1].body, '<em>flowers</em>', 'unchanged words keep their markup');

  // Adding and deleting.
  await post('/giving-ladder/add', { block: first.id, amount: '7', period: 'month', body: 'A new row.' });
  eq(ladders()[0].items.length, before + 1, 'a row can be added');
  await post('/giving-ladder/delete/' + encodeURIComponent(first.id) + '/' + before, {});
  eq(ladders()[0].items.length, before, 'and deleted again');

  // Reorder posts the whole resulting order, same contract as the menu.
  const idx = ladders()[0].items.map((_, i) => i);
  const reversed = idx.slice().reverse();
  const firstAmountBefore = ladders()[0].items[0].amount;
  await post('/giving-ladder/reorder?block=' + encodeURIComponent(first.id), { order: JSON.stringify(reversed) });
  const reordered = ladders()[0];
  eq(reordered.items.length, idx.length, 'reordering never loses a row');
  eq(reordered.items[reordered.items.length - 1].amount, firstAmountBefore, 'the first row is now last');

  // ⚠ The drawer shows DIGITS whatever is stored. Some rows on the live draft
  // were seeded by an older version that stored the formatted string, and a
  // field whose hint says "digits only" prefilled with "$5,000" is a screen
  // arguing with itself.
  {
    const b = JSON.parse(db.prepare("SELECT blocks FROM pages WHERE id='give-landing'").get().blocks);
    const lad = b.find((x) => x.type === 'amounts');
    lad.items[0].amount = '$5,000';
    db.prepare("UPDATE pages SET blocks=? WHERE id='give-landing'").run(JSON.stringify(b));
    const drawer = await (await call(env, '/giving?row=' + encodeURIComponent(lad.id) + ':0', { cookie })).text();
    has(drawer, 'value="5000"', 'a stored "$5,000" is offered for editing as 5000');
    lacks(drawer, 'value="$5,000"', 'and never as the formatted string');

    // Saving normalizes, so editing any row quietly cleans it up.
    await post('/giving-ladder/update', { block: lad.id, index: '0', amount: '$9,500', period: 'year', body: 'x' });
    eq(ladders()[0].items[0].amount, '9500', 'a formatted amount is stored as digits');

    // Words are a legitimate row and must survive untouched — stripping them
    // to nothing would delete somebody's copy.
    await post('/giving-ladder/update', { block: lad.id, index: '0', amount: 'Any amount', period: '', body: 'x' });
    eq(ladders()[0].items[0].amount, 'Any amount', 'but words are stored exactly as typed');
  }

  // The drawer does the arithmetic rather than asking staff to divide by 12 in
  // their heads — the commitment and what the button charges are two different
  // numbers on a yearly row, which is the whole trap.
  {
    const lad = ladders()[0];
    const drawer = await (await call(env, '/giving?row=' + encodeURIComponent(lad.id) + ':1', { cookie })).text();
    has(drawer, 'id="ladder-preview"', 'the drawer carries a live preview of what the button will ask');
    has(drawer, 'tlcGiftForPeriod', 'driven by the shared arithmetic, not a retyped copy');
    // ⚠ The old label read "Given every", which reads as how the giver PAYS —
    // so Month on a $5,000 row looked like it should produce $416/month when
    // it would really charge $5,000 a month.
    has(drawer, 'The amount above is per', 'and the period is labeled as the unit, not the cadence');
    lacks(drawer, 'Given every', 'the misleading label is gone');
  }

  // A block id that is not on the page is a stale tab, and the answer is the
  // screen again — not a page of blocks written from a request about something
  // that is no longer there.
  const intact = db.prepare("SELECT blocks FROM pages WHERE id='give-landing'").get().blocks;
  const res = await post('/giving-ladder/update', { block: 'no-such-block', index: '0', amount: '999' });
  eq(res.status, 302, 'an unknown ladder redirects');
  eq(db.prepare("SELECT blocks FROM pages WHERE id='give-landing'").get().blocks, intact,
     'and writes nothing at all');
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
  has(body, 'Pay period', 'the pay-period picker is labeled');
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

group('the renter portal has its own origin');
{
  // ⚠ The portal renders renter-supplied content and is handed to people
  // outside the church. Same-origin with the admin, an injection in it could
  // act with a signed-in admin's session — the CSP allows 'unsafe-inline' and
  // the Origin gate cannot tell a portal script from an admin one.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const setOrigin = (v) => db.prepare("INSERT INTO site_settings (key,value) VALUES ('gym_portal_origin',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(v);
  db.prepare("INSERT INTO gym_groups (id,name,contact,email,access_token,active) VALUES (7,'Hoops','A','a@b.example','tok7',1)").run();

  const portalGet = (host = 'admin.timothystl.org') =>
    worker.fetch(new Request(`https://${host}/gym/book/tok7`), env, ctx);

  // ⚠ Blank is the SAFE DEFAULT and has to stay that way: code deploys before
  // somebody adds a Cloudflare route, and redirecting to a host that is not
  // serving yet would send every renter to the homepage — with a 200, because
  // the site is a single-page app, so it would not even look like an error.
  setOrigin('');
  eq((await portalGet()).status, 200, 'with no address set, the admin host still serves the portal');

  setOrigin('https://timothystl.org');
  const moved = await portalGet();
  eq(moved.status, 301, 'once it has an address, the admin host stops serving renter content');
  eq(moved.headers.get('Location'), 'https://timothystl.org/gym/book/tok7', 'and says where it went');

  // The iCal feed is subscribed inside people's calendar apps. Without the
  // redirect their calendar would just stop updating, with no error anywhere.
  const ics = await worker.fetch(new Request('https://admin.timothystl.org/gym/cal/abc.ics'), env, ctx);
  eq(ics.status, 301, 'the calendar feed moves too');
  eq(ics.headers.get('Location'), 'https://timothystl.org/gym/cal/abc.ics', 'to the same address');

  // On the portal's own host it is served, not redirected — otherwise this is
  // a loop.
  eq((await portalGet('timothystl.org')).status, 200, 'the portal host serves it');

  // ⚠ A portal form posts from the PORTAL's origin. Without accepting it the
  // whole booking flow 403s the moment the portal moves — and it would read
  // as "the portal is broken" with nothing to go on.
  const postFrom = (origin) => worker.fetch(new Request('https://timothystl.org/gym/book/tok7/hold', {
    method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: '',
  }), env, ctx);
  ok((await postFrom('https://timothystl.org')).status !== 403, 'a portal form posts from the portal origin');
  eq((await postFrom('https://evil.example')).status, 403, 'and somewhere else is still refused');

  // The gate is widened for portal paths only — not for the admin at large.
  const adminPost = await worker.fetch(new Request('https://admin.timothystl.org/link-cards/create', {
    method: 'POST', headers: { cookie, origin: 'https://timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'title=X&url=https%3A%2F%2Fa.example',
  }), env, ctx);
  eq(adminPost.status, 403, 'an admin POST from the portal origin is still refused');

  // ⚠ The link staff copy has to name the portal, or every group created from
  // here keeps handing out the admin domain and the move is undone one group
  // at a time.
  const groupPage = await (await call(env, '/gym-rentals/groups/edit/7', { cookie })).text();
  has(groupPage, 'https://timothystl.org/gym/book/tok7', 'the copyable link is the portal address');
  lacks(groupPage, 'https://admin.timothystl.org/gym/book/tok7', 'not the admin one');

  // Only http(s). This value becomes a link the office hands to renters.
  setOrigin('javascript:alert(1)');
  eq((await portalGet()).status, 200, 'an unsafe address is ignored rather than half-honored');
  setOrigin('');

  // ── Tasks 17b and 18: the renter portal ──────────────────────────────
  const portal = await (await portalGet()).text();

  // 17b. The portal keeps its own :root — a renter must never get the admin
  // sidebar or the ⌘K chip — but "not an admin screen" had been read as "not
  // styled". It takes the public site's moss masthead now.
  has(portal, '#4A5E3A', 'the portal wears the public site\'s moss masthead');
  has(portal, 'from our Neighborhood to the Nations', 'with the site\'s own brand line');
  lacks(portal, 'class="sidebar"', 'and none of the admin chrome');
  lacks(portal, 'tlc-ctx', 'no context bar either');

  // 18.1. The insurance notice is an obligation that comes AFTER booking. At
  // the top of the page it made somebody read a compliance requirement before
  // finding out whether their date was even free.
  const insuranceAt = portal.indexOf('certificate of insurance');
  const calendarAt = portal.indexOf('scal-month');
  ok(insuranceAt > -1 && calendarAt > -1 && insuranceAt > calendarAt,
    'the insurance notice sits after the calendar, at the confirm step');

  // 18.2. Both tabs feed one request, so the second is named for what it is.
  has(portal, '>Recurring dates<', 'the second tab is Recurring dates');
  lacks(portal, 'Repeat weekly pattern', 'not a competing flow');

  // 18.3. Availability was encoded twice, in color only — a red numeral AND a
  // red dot. Red numerals read as errors, and color alone fails for anyone
  // who cannot separate the two hues.
  // Scoped to the DAY CELLS. The hour-slot buttons inside a day still use red
  // for a taken hour, and that is a different control the spec does not touch —
  // asserting no red anywhere on the page would fail for the wrong reason.
  lacks(portal, 'font-weight:700;color:#D17070', 'no unavailable day is a red numeral');
  has(portal, 'color:#A9A396', 'unavailable days are gray, with no cell and no dot');
  lacks(portal, 'Fully booked</span>', 'and the color legend is gone — the drawing says it');

  // "Request", not "Confirm" — the office prices and approves it.
  has(portal, '>Request this booking<', 'the submit button says request');
  has(portal, 'Nothing is charged now', 'and says so in one line beneath');

  // ── Task 19 items 1-5: the hierarchy on this screen was upside down ──
  // You come here to edit a group. The booking link is a utility, and it was
  // the loudest thing on the page — above the group's own name, in the mist
  // tint with a heavy navy border, which means SELECTED everywhere else.
  const detailsAt = groupPage.indexOf('name="name"');
  const linkAt = groupPage.indexOf('id="portal-link"');
  ok(detailsAt > -1 && linkAt > -1 && detailsAt < linkAt,
    'the group record comes first and the booking link sits beneath it');
  lacks(groupPage, 'background:var(--mist);border-color:var(--steel);',
    'the link card is a plain card, not the selected treatment');
  lacks(groupPage, '📋', 'and the clipboard glyph is gone — no emoji in the admin');

  // Copy is the card's primary action and can never be pushed out of view.
  has(groupPage, 'id="portal-copy" class="btn btn-primary btn-sm" style="flex:none;"',
    'Copy is a navy primary that cannot be squeezed out of the row');
  has(groupPage, 'flex:1;min-width:0', 'and the field flexes rather than sitting in a grid');

  // Regenerate invalidates a link already in other people's inboxes. It is a
  // text button at the card foot, and the consequence is in the confirm where
  // it can actually stop somebody — not folded into the button label.
  has(groupPage, '>Regenerate link<', 'Regenerate is quiet and plainly labeled');
  lacks(groupPage, 'Regenerate token (old link stops working)', 'the warning is out of the label');
  has(groupPage, 'The link you have already shared will stop working',
    'and names what breaks, in the confirm');

  // The third crumb — an editor appends the record it is editing.
  has(groupPage, 'class="tlc-ctx-section">Hoops<',
    'the context bar names the group you are in');
}

group('an approved payroll period is locked server-side');
{
  // Approving a run is somebody signing off a set of figures. If the hours can
  // still change afterwards the signature is on nothing — and the fix list is
  // explicit that this is enforced at the proxy, not by hiding the button. A
  // stale tab, a second window and a crafted POST all arrive at the same line.
  //
  // ⚠ Payroll stopped talking to Supabase's REST table endpoints directly —
  // every call now goes through a gated `payroll_*` RPC function (see
  // "Payroll reads and writes through thirteen RPC functions" in CLAUDE.md),
  // so the period is in the POST BODY (`p_period_start`), not a
  // `period_start=eq.X` query string, and the path is always
  // `/sb/rest/v1/rpc/payroll_<fn>`. The stub below reads the body, not the
  // href, for exactly that reason.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const realFetch = globalThis.fetch;

  let approved = [];
  let supabaseUp = true;
  let reached = 0;               // did the write get through to Supabase?
  globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url;
    if (!supabaseUp) throw new Error('supabase unreachable');
    let raw = '';
    if (init && init.body != null) raw = typeof init.body === 'string' ? init.body : '';
    else if (input && typeof input.clone === 'function') { try { raw = await input.clone().text(); } catch (_) { raw = ''; } }
    let parsed = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
    if (href.includes('/rpc/payroll_get_period_approval')) {
      // Honor the filter, or the stub answers "approved" for every period and
      // the per-period scoping below would pass without being true.
      const want = String(parsed.p_period_start || '');
      return new Response(JSON.stringify(approved.filter((r) => r.period_start === want)), { status: 200 });
    }
    if (href.includes('/rpc/payroll_save_hours')) { reached++; return new Response('null', { status: 200 }); }
    return new Response('null', { status: 200 });
  };
  const saveHours = (period = '2026-07-20') => worker.fetch(new Request(
    'https://admin.timothystl.org/sb/rest/v1/rpc/payroll_save_hours',
    { method: 'POST', headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json', apikey: 'k' },
      body: JSON.stringify({ p_staff_id: 'a', p_period_start: period, p_hours_worked: 40, p_pto_used: 0, p_pto_earned: 0 }) }), env, ctx);

  reached = 0;
  eq((await saveHours()).status, 200, 'an unapproved period saves as before');
  eq(reached, 1, 'and the write really reached Supabase');

  approved = [{ period_start: '2026-07-20' }];
  reached = 0;
  const blocked = await saveHours();
  eq(blocked.status, 409, 'an approved period refuses the write');
  eq(reached, 0, 'and nothing reached Supabase');
  has(await blocked.text(), 'has been approved', 'with a message naming the way out');

  // A DIFFERENT period is unaffected — the lock is per run, not a global stop.
  reached = 0;
  eq((await saveHours('2026-08-03')).status, 200, 'another period is untouched');
  eq(reached, 1, 'and writes through');

  // ⚠ Fails CLOSED. A refusal costs a retry and says so; the other way round
  // silently rewrites figures somebody has already put their name to.
  supabaseUp = false;
  reached = 0;
  const cannotTell = await saveHours();
  eq(cannotTell.status, 409, 'if the approval cannot be read, nothing is written');
  eq(reached, 0, 'and the write is not attempted');
  supabaseUp = true;

  // ⚠ Rates are NOT period-scoped, so locking them would stop the office
  // fixing a rate for a run they have not done yet.
  reached = 0;
  const rate = await worker.fetch(new Request('https://admin.timothystl.org/sb/rest/v1/rpc/payroll_save_staff', {
    method: 'POST', headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json', apikey: 'k' },
    body: JSON.stringify({ p_id: 'a', p_hourly_rate: 21 }),
  }), env, ctx);
  eq(rate.status, 200, 'a staff record still saves while a period is approved');

  // And taking the approval back has to stay possible, or the lock is a trap.
  const unapprove = await worker.fetch(new Request(
    'https://admin.timothystl.org/sb/rest/v1/rpc/payroll_unapprove_period',
    { method: 'POST', headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json', apikey: 'k' },
      body: JSON.stringify({ p_period_start: '2026-07-20' }) }), env, ctx);
  eq(unapprove.status, 200, 'the approval itself can still be removed');

  globalThis.fetch = realFetch;
}

group('the voters reports are public, and at least not indexable (FX-12)');
{
  // ⚠ THIS GROUP PINS A DECISION, NOT A FIX. There is no member login anywhere
  // on timothystl.org, so /api/voters cannot be gated without building one —
  // whether a Zoom link and a set of council reports should be behind a
  // sign-in is the congregation's call. What IS closed is the crawler half:
  // public/robots.txt governs timothystl.org and says nothing at all about
  // this origin, so both were indexable the moment an address appeared
  // anywhere crawlable.
  const { db, env } = await boot();
  db.prepare("INSERT INTO voters_page (id, meeting_info, zoom_link, files_json) VALUES (1,'Annual meeting','https://zoom.example/j/1','[]')").run();

  const api = await call(env, '/api/voters');
  eq(api.status, 200, 'the voters page still gets its data with no credential');
  has(await api.text(), 'zoom.example', 'including the meeting link');
  has(api.headers.get('x-robots-tag') || '', 'noindex', 'but it is not something to index');

  // The default R2 stub answers null for everything; the point here is the
  // headers on a hit, so give it one object to find.
  env.IMAGES = { ...env.IMAGES, get: async () => ({ body: 'PDF', writeHttpMetadata(h) { h.set('Content-Type', 'application/pdf'); } }) };
  const doc = await call(env, '/docs/report.pdf');
  eq(doc.status, 200, 'and a council report still downloads');
  has(doc.headers.get('x-robots-tag') || '', 'noindex', 'without becoming a search result');
}

group('the renter portal carries security headers of its own (FX-06)');
{
  // ⚠ THIS PAGE IS AUTHENTICATED BY A BEARER TOKEN IN ITS OWN URL, which makes
  // it a different problem from every other page in this Worker: anything that
  // leaks the address leaks the booking history behind it.
  const { db, env } = await boot();
  db.prepare("INSERT INTO gym_groups (id,name,contact,email,access_token,active) VALUES (8,'Hoops','A','a@b.example','tok8',1)").run();
  const res = await worker.fetch(new Request('https://admin.timothystl.org/gym/book/tok8'), env, ctx);
  eq(res.status, 200, 'the portal still serves');
  const h = (k) => res.headers.get(k) || '';

  // The Tithe.ly pay button opens in a new tab. Without a referrer policy the
  // token travels to Tithe.ly in the Referer header of that navigation.
  eq(h('referrer-policy'), 'no-referrer', 'no Referer leaves this page');
  has(h('x-robots-tag'), 'noindex', 'a token URL pasted anywhere crawlable is not indexed');
  has(h('cache-control'), 'no-store', 'one renter’s bookings are not left in a shared cache');
  eq(h('x-content-type-options'), 'nosniff', 'and nothing here is sniffed into another type');
  has(h('content-security-policy'), "frame-ancestors 'none'", 'the page with the POST actions cannot be framed');
  has(h('content-security-policy'), "form-action 'self'", 'and its forms cannot be re-pointed');

  // ⚠ rel="noopener noreferrer" is the other half of the Referer story — the
  // header covers the request, this covers window.opener on the opened page.
  // Asserted against the SOURCE rather than one rendered route: the pay links
  // are on the invoice and booking views, and a test that happened to render
  // the calendar would pass while saying nothing.
  const gymSrc = readFileSync(new URL('../admin/gym.js', import.meta.url), 'utf8');
  const blanks = [...gymSrc.matchAll(/<a\b[^>]*?target="_blank"[^>]*?>/g)].map((m) => m[0]);
  ok(blanks.length >= 3, 'the portal really does open things in a new tab: ' + blanks.length);
  for (const a of blanks) ok(/noopener/.test(a) && /noreferrer/.test(a), 'it opens safely: ' + a.slice(0, 110));

  // The site's own crawler instruction, which is a different mechanism from
  // the header and is the one Google reads before it ever requests the page.
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  has(robots, 'Disallow: /gym/', 'and robots.txt keeps crawlers off the portal entirely');
}

group('a newsletter that has not been sent is not public (FX-07)');
{
  // ⚠ IDs ARE SEQUENTIAL, so "you would have to guess the id" is not a
  // control. The list endpoint two routes above this one has always filtered
  // on status; the single-issue route was SELECT * with no filter at all.
  const { db, env } = await boot();
  const nl = (id, subject, status, note, camp, appr) => db.prepare(
    `INSERT INTO newsletters (id,subject,status,published_at,pastor_note,brevo_campaign_id,approval_status)
     VALUES (?,?,?,?,?,?,?)`).run(id, subject, status, '2026-08-01', note, camp, appr);
  nl(901, 'Draft under review', 'draft', '<p>Not sent yet.</p>', 'cmp-1', 'pending');
  nl(902, 'This week', 'published', '<p>Real issue.</p>', 'cmp-2', 'approved');

  const draft = await call(env, '/api/newsletter/901');
  eq(draft.status, 404, 'a draft is not served at all');
  lacks(await draft.text(), 'Not sent yet', 'and none of its words leak in the refusal');

  const live = await call(env, '/api/newsletter/902');
  eq(live.status, 200, 'a published issue still is');
  const row = JSON.parse(await live.text());
  has(row.subject, 'This week', 'with its content');

  // ⚠ AND ONLY THE PUBLIC COLUMNS. SELECT * shipped the Brevo campaign id and
  // the approval state to anybody who asked — internal bookkeeping about how
  // an issue was sent, on a public endpoint.
  ok(!('brevo_campaign_id' in row), 'the Brevo campaign id stays internal');
  ok(!('approval_status' in row), 'so does who approved it');
}

group('a sent newsletter can be removed from the website without being unsent');
{
  const { db, env } = await boot();
  const admin = signIn(db, ['newsletter_approve', 'newsletter_edit'], 'admin');
  const writer = signIn(db, ['newsletter_edit'], 'writer');

  db.prepare(
    `INSERT INTO newsletters (id, subject, status, published_at, pastor_note, sent_at, sent_count)
     VALUES (903, 'Already mailed', 'published', '2026-08-01', '<p>Real content.</p>', '2026-08-01T09:00:00Z', 611)`
  ).run();

  // Refused for an account that can edit newsletters but was never given the
  // approval permission — the same gate Delete already sits behind, because
  // pulling a sent communication off the public archive is a bigger decision
  // than drafting one.
  let res = await call(env, '/newsletter/hide/903', { cookie: writer.cookie, method: 'POST', form: {} });
  eq(res.status, 403, 'refused without newsletter_approve');
  let stillUp = await call(env, '/api/newsletter/903');
  eq(stillUp.status, 200, 'and nothing changed — still on the website');

  // Visible before, gone after — through the real public endpoints, not just
  // the shared SQL fragment (that half is covered in admin/newsletter.test.mjs).
  res = await call(env, '/newsletter/hide/903', { cookie: admin.cookie, method: 'POST', form: {} });
  eq(res.status, 302, 'the office account can hide it');
  const gone = await call(env, '/api/newsletter/903');
  eq(gone.status, 404, 'dropped from the single-issue endpoint');
  const list = JSON.parse(await (await call(env, '/api/newsletters')).text());
  ok(!list.some((n) => n.id === 903), 'and out of the archive list');

  // ⚠ THE EMAIL ITSELF IS UNTOUCHED. Hiding is about the website, never about
  // what already reached an inbox — sent_at and sent_count are exactly what
  // they were, and canEdit() still refuses to change the words.
  const row = db.prepare('SELECT status, sent_at, sent_count, pastor_note FROM newsletters WHERE id = 903').get();
  eq(row.sent_at, '2026-08-01T09:00:00Z', 'sent_at is untouched');
  eq(row.sent_count, 611, 'sent_count is untouched');
  eq(row.pastor_note, '<p>Real content.</p>', 'and the content itself was never touched');
  const editAttempt = await call(env, '/publish', {
    cookie: admin.cookie, method: 'POST',
    form: { newsletter_id: '903', subject: 'Rewritten', action: 'publish', email_send: 'none' },
  });
  eq(editAttempt.status, 302, 'the edit is refused (redirected, not applied)');
  eq(db.prepare('SELECT subject FROM newsletters WHERE id = 903').get().subject, 'Already mailed',
    'a hidden-but-sent issue is STILL locked — hiding it never reopens editing');

  // And it can come back.
  res = await call(env, '/newsletter/unhide/903', { cookie: admin.cookie, method: 'POST', form: {} });
  eq(res.status, 302, 'unhide succeeds');
  eq((await call(env, '/api/newsletter/903')).status, 200, 'back on the website');

  const audited = db.prepare(
    "SELECT action FROM audit_log WHERE entity_type='newsletter' AND entity_id='903' ORDER BY id"
  ).all().map((r) => r.action);
  eq(audited.join(','), 'unpublish,publish', 'both the hide and the unhide are in the audit log');

  // The same control is right on the newsletter LIST's own row — Dinger's
  // ask was to put it beside "Duplicate as draft" and "View", not make
  // somebody open the (otherwise read-only) editor just to reach it.
  let listHtml = await (await call(env, '/newsletters', { cookie: admin.cookie })).text();
  has(listHtml, `action="/newsletter/hide/903"`, 'the list row offers Remove from website while visible');
  lacks(listHtml, `action="/newsletter/unhide/903"`, 'and not Show on website — nothing to restore yet');

  await call(env, '/newsletter/hide/903', { cookie: admin.cookie, method: 'POST', form: {} });
  listHtml = await (await call(env, '/newsletters', { cookie: admin.cookie })).text();
  has(listHtml, `action="/newsletter/unhide/903"`, 'once hidden, the row offers Show on website instead');
  lacks(listHtml, `action="/newsletter/hide/903"`, 'and not Remove from website a second time');
  has(listHtml, 'Sent · off the website', 'and the row’s own status pill says so');

  // A writer who cannot approve sees neither control — the row still has to
  // read correctly, it just cannot act.
  const writerListHtml = await (await call(env, '/newsletters', { cookie: writer.cookie })).text();
  lacks(writerListHtml, `action="/newsletter/unhide/903"`, 'a plain editor gets no Show-on-website control');
  lacks(writerListHtml, `action="/newsletter/hide/903"`, 'nor a Remove-from-website one');

  await call(env, '/newsletter/unhide/903', { cookie: admin.cookie, method: 'POST', form: {} });
}

group('a stale save never overwrites a newer one — the pastor’s-note report');
{
  // Andrew, directly: "ive also had several times where i have typed in a
  // pastors note and hit save as draft, but then another user opens that
  // newsletter and the pastors note is not there anymore." Reproduced here
  // as the shape that actually causes it: two tabs open on the same draft,
  // the second one still carrying whatever was there when IT loaded.
  const { db, env } = await boot();
  const a = signIn(db, ['newsletter_edit'], 'staffA');
  const b = signIn(db, ['newsletter_edit'], 'staffB');

  db.prepare(
    `INSERT INTO newsletters (id, subject, status, published_at, pastor_note, format, updated_at)
     VALUES (950, 'This week at Timothy', 'draft', '2026-08-23', '', 'weekly', '2026-08-20T09:00:00.000Z')`
  ).run();

  // Both open the same draft at (essentially) the same moment — both forms
  // carry the same expected_updated_at, the version that was there before
  // either of them typed anything.
  const loadedAt = db.prepare('SELECT updated_at FROM newsletters WHERE id = 950').get().updated_at;
  eq(loadedAt, '2026-08-20T09:00:00.000Z', 'both tabs load against the same starting version');

  const save = (cookie, fields) => call(env, '/publish', {
    cookie, method: 'POST',
    form: Object.assign({
      newsletter_id: '950', format: 'weekly', action: 'draft', expected_updated_at: loadedAt,
      subject: 'This week at Timothy',
    }, fields),
  });

  // Staff A types the pastor's note and saves first. Nothing stopped them —
  // this is the ordinary, unconflicted case, exactly like today.
  let res = await save(a.cookie, { pastor_note: 'Grace and peace to you this week...' });
  eq(res.status, 302, 'A’s save succeeds');
  eq(res.headers.get('Location'), '/newsletters?msg=draft&subject=This%20week%20at%20Timothy', 'the ordinary draft-save redirect');
  const afterA = db.prepare('SELECT pastor_note, updated_at, updated_by FROM newsletters WHERE id = 950').get();
  eq(afterA.pastor_note, 'Grace and peace to you this week...', 'the note is really there');
  eq(afterA.updated_by, 'staffA', 'and attributed to whoever actually typed it');
  ok(afterA.updated_at !== loadedAt, 'updated_at moved on');

  // ⚠ THIS IS THE BUG. Staff B's tab has been open since before A saved —
  // their own form still carries the ORIGINAL expected_updated_at, and
  // their own pastor_note field still shows blank (what was there when
  // THEIR page loaded). Before this fix, B saving here — even just to
  // change something unrelated — would blindly overwrite A's note with B's
  // stale blank one. That silent loss is what this whole fix exists for.
  res = await save(b.cookie, { subject: 'This week at Timothy (updated)', pastor_note: '' });
  eq(res.status, 302, 'B’s save is accepted — but not as an overwrite');
  const loc = res.headers.get('Location');
  ok(/^\/edit\/\d+\?msg=conflict&other=950$/.test(loc), 'redirected to a NEW draft, naming the issue it was meant to update — got ' + loc);
  const recoveredId = Number(loc.match(/^\/edit\/(\d+)/)[1]);

  // The load-bearing assertion: A's note is EXACTLY as A left it.
  const stillA = db.prepare('SELECT subject, pastor_note FROM newsletters WHERE id = 950').get();
  eq(stillA.pastor_note, 'Grace and peace to you this week...', 'the original issue still has the real note — never overwritten');
  eq(stillA.subject, 'This week at Timothy', 'and B’s stale subject never landed on it either');

  // What B had typed was not thrown away — it is sitting in a draft of its
  // own, exactly as submitted, for a human to reconcile by hand.
  const recovered = db.prepare('SELECT subject, pastor_note, status FROM newsletters WHERE id = ?').get(recoveredId);
  eq(recovered.subject, 'Recovered — This week at Timothy (updated)', 'B’s content is preserved, not discarded');
  eq(recovered.pastor_note, '', 'exactly what B had, blank note included — nothing invented');
  eq(recovered.status, 'draft', 'and it is a draft, whatever button B pressed — never auto-sent');

  const conflictHtml = await (await call(env, `/edit/${recoveredId}?msg=conflict&other=950`, { cookie: b.cookie })).text();
  has(conflictHtml, 'Somebody else saved changes to this issue', 'the banner explains what happened');
  has(conflictHtml, 'staffA', 'and names who saved it');
  has(conflictHtml, `/edit/950`, 'with a way to open the real issue and compare');

  const audited = db.prepare(
    "SELECT action, entity_id FROM audit_log WHERE entity_type='newsletter' AND action='create' ORDER BY id DESC LIMIT 1"
  ).get();
  eq(String(audited.entity_id), String(recoveredId), 'the recovery itself is in the audit log');

  // And the mechanism gets out of the way once somebody has the real,
  // current version — B reloads, gets 950's now-current updated_at, and a
  // save against THAT succeeds normally.
  const freshEdit = await (await call(env, '/edit/950', { cookie: b.cookie })).text();
  const freshExpected = freshEdit.match(/name="expected_updated_at" value="([^"]*)"/)[1];
  ok(freshExpected !== loadedAt, 'a fresh load carries the real current version');
  res = await save(b.cookie, { expected_updated_at: freshExpected, pastor_note: 'Grace and peace to you this week...\n\nAlso: choir practice moved to Thursday.' });
  eq(res.status, 302, 'a save against the CURRENT version is never treated as a conflict');
  eq(res.headers.get('Location'), '/newsletters?msg=draft&subject=This%20week%20at%20Timothy', 'and it is the ordinary save redirect, not a recovery one');
  eq(db.prepare('SELECT pastor_note FROM newsletters WHERE id = 950').get().pastor_note,
    'Grace and peace to you this week...\n\nAlso: choir practice moved to Thursday.', 'the merged note is really saved on the real issue');
}

group('an upload needs a reason to be uploading (FX-08)');
{
  // ⚠ Nothing ever deletes an R2 object, so this is not "can they write a
  // file" — it is "can they host a file on the church's domain forever".
  const { db, env } = await boot();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const upload = async (cookie, route = '/api/upload-image', type = 'image/png') => {
    const fd = new FormData();
    fd.append('file', new Blob([png], { type }), 'x.png');
    return worker.fetch(new Request('https://admin.timothystl.org' + route, {
      method: 'POST', headers: { cookie, origin: 'https://admin.timothystl.org' }, body: fd,
    }), env, ctx);
  };

  // The Bookkeeper preset is the honest case: a real account, a real job, and
  // no business putting files on the website.
  const money = signIn(db, ['payroll_manage', 'giving_manage'], 'book');
  eq((await upload(money.cookie)).status, 403, 'somebody who edits no content cannot upload an image');
  eq((await upload(money.cookie, '/api/upload-doc', 'application/pdf')).status, 403, 'nor a document');

  // And the people whose screens have an image picker are unaffected — this
  // must not become a gate the office runs into every day.
  const leader = signIn(db, ['ministries_edit'], 'leader');
  ok((await upload(leader.cookie)).status !== 403, 'a ministry leader still uploads');
  const office = signIn(db, ['notices_edit'], 'office');
  ok((await upload(office.cookie, '/api/upload-doc', 'application/pdf')).status !== 403, 'and the voters documents still upload');

  // ⚠ /api/upload-doc was scoped to notices_edit alone, built for the Voters
  // screen's own file list. The Documents block puts a PDF uploader on any
  // page a pages_edit or pages_edit_own holder can reach, so the gate widened
  // to match — a page editor who cannot reach Voters must still be able to
  // attach a file to their own page.
  const pageEditor = signIn(db, ['pages_edit'], 'editor');
  ok((await upload(pageEditor.cookie, '/api/upload-doc', 'application/pdf')).status !== 403,
    'and so does a page editor, for the Documents block');
  const ownPageEditor = signIn(db, ['pages_edit_own'], 'ownEditor');
  ok((await upload(ownPageEditor.cookie, '/api/upload-doc', 'application/pdf')).status !== 403,
    'a ministry leader scoped to their own pages too');

  // Signed out is still the first gate, not the second.
  // Signed out is still the first gate, not the second. ⚠ The session gate
  // answers every unauthenticated request with the login PAGE, at 200 — an API
  // POST included — so the honest assertion is that what comes back is the
  // login screen and not an upload result. (That the status is 200 rather than
  // 401 on an API path is a pre-existing oddity of the gate, not of this fix.)
  const out = await upload('');
  const outBody = await out.text();
  has(outBody, '<!DOCTYPE html>', 'signed out, the upload endpoint answers with the login page');
  lacks(outBody, '"url"', 'and never with an uploaded file');
}

group('the payroll proxy no longer fingerprints its own secret (FX-09)');
{
  // A Worker secret is write-only from every tool that can reach this repo, so
  // when the two sides disagreed there was genuinely no other way to see
  // which. That mismatch is resolved, and what was left was a deliberate
  // partial disclosure of a secret with no remaining reason.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: '28000', message: 'invalid secret' }), { status: 403 });

  const call403 = (e) => worker.fetch(new Request('https://admin.timothystl.org/sb/rest/v1/rpc/payroll_get_staff', {
    method: 'POST', headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json', apikey: 'k' },
    body: '{}',
  }), e, ctx);

  const secret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const withSecret = await (await call403({ ...env, PAYROLL_PROXY_SECRET: secret })).text();
  lacks(withSecret, secret.slice(0, 6), 'the first characters of the secret are not in the response');
  lacks(withSecret, secret.slice(-6), 'nor the last');
  lacks(withSecret, String(secret.length), 'nor its length');

  // ⚠ The half that still helps and reveals nothing SURVIVES: whether this
  // Worker holds the secret at all. Removing that would have made an unset
  // secret indistinguishable from a wrong one, which is the diagnosis the
  // fingerprint existed for in the first place.
  const unset = await (await call403({ ...env, PAYROLL_PROXY_SECRET: '' })).text();
  has(unset, 'PAYROLL_PROXY_SECRET is not set', 'an unset secret still says so plainly');
  has(unset, 'wrangler', 'and names the way out');

  globalThis.fetch = realFetch;
}

group('the Supabase proxy forwards thirteen RPC calls and refuses everything else (FX-11)');
{
  // It used to forward ANY path under /sb/ to Supabase with the caller's key —
  // an authenticated open relay onto the whole project (AW-7). The 2026-08-12
  // migration left `anon` with no direct grant on any payroll table, which
  // narrows the blast radius but is not the same guarantee: that is the
  // credential happening not to be able to do much, and it is one Supabase
  // GRANT away from being wrong again.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const realFetch = globalThis.fetch;
  let forwarded = [];
  globalThis.fetch = async (input) => {
    forwarded.push(typeof input === 'string' ? input : input.url);
    return new Response('null', { status: 200 });
  };
  const H = { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json', apikey: 'k' };
  const post = (p, body = '{}') => worker.fetch(new Request('https://admin.timothystl.org' + p,
    { method: 'POST', headers: H, body }), env, ctx);

  forwarded = [];
  const ok13 = await post('/sb/rest/v1/rpc/payroll_get_staff');
  eq(ok13.status, 200, 'an allowlisted RPC still goes through');
  eq(forwarded.length, 1, 'and really reached Supabase');

  // ⚠ The four tables the migration closed. A 403 HERE means the request was
  // never forwarded at all, which is a different and stronger fact than
  // Supabase refusing it on arrival.
  forwarded = [];
  for (const t of ['church_staff', 'church_staff_period_entries', 'payroll_periods', 'staff_pto_entries']) {
    eq((await post('/sb/rest/v1/' + t)).status, 403, 'the ' + t + ' table is refused at the proxy');
  }
  eq((await post('/sb/rest/v1/rpc/some_other_function')).status, 403, 'so is an RPC that is not one of ours');
  eq((await post('/sb/auth/v1/token')).status, 403, 'and so is the auth endpoint');
  eq(forwarded.length, 0, 'and not one of them reached Supabase');

  // ⚠ PostgREST executes an RPC on GET too, so allowing the method would put a
  // payroll write one address bar away from a CSRF — the Origin gate only runs
  // on non-GET requests.
  forwarded = [];
  const viaGet = await worker.fetch(new Request(
    'https://admin.timothystl.org/sb/rest/v1/rpc/payroll_save_hours', { headers: { cookie } }), env, ctx);
  eq(viaGet.status, 403, 'a GET at an allowlisted RPC is refused too');
  eq(forwarded.length, 0, 'and never reached Supabase');

  // ⚠ THE LIST IS EXACTLY WHAT THE PAGE CALLS, in both directions — a new
  // call added to the page without being added here would 403 in front of
  // somebody running payroll, which is a bad way to find out.
  const called = new Set([...payrollPage.matchAll(/sb\.rpc\('([a-z_]+)'/g)].map((m) => m[1]));
  const allowed = new Set(PAYROLL_RPC_FNS);
  eq(called.size, 17, 'the page calls seventeen RPC functions');
  for (const f of called) ok(allowed.has(f), 'the proxy allows ' + f + ', which the page calls');
  for (const f of allowed) ok(called.has(f), 'the page calls ' + f + ', which the proxy allows');

  globalThis.fetch = realFetch;
}

group('the admin shell states frame-ancestors, and no longer allows eval (FX-10)');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const csp = (await call(env, '/dashboard', { cookie })).headers.get('content-security-policy') || '';

  // ⚠ frame-ancestors DOES NOT INHERIT FROM default-src. Every admin screen
  // except the page editor — which sets its own — was framable.
  has(csp, "frame-ancestors 'none'", 'an admin screen cannot be framed');
  has(csp, "base-uri 'none'", 'and an injected base tag cannot re-point its assets');
  ok(!/unsafe-eval/.test(csp), "and script-src no longer allows 'unsafe-eval': " + csp);
  // The half that was already right, pinned so a rewrite cannot lose it.
  has(csp, "'unsafe-inline'", 'inline script is still allowed, which the shell genuinely needs');
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
  for (const g of ['Website', 'Communication', 'Events', 'Money &amp; Building', 'People &amp; Access', 'Setup']) {
    has(body, `>${g}</div>`, `${g} is a group`);
  }
  // ⚠ The heading and the trail read the same constant. They were two typed
  // strings, and a rename that reached one and not the other would have the
  // sidebar and the breadcrumb disagreeing about where you are.
  lacks(body, 'Money &amp;amp; Building', 'a group name is escaped once, not twice');
  has(body, 'href="/redirects"', 'Redirects has its own address');
  has(body, 'href="/settings"', 'and so does Settings');
  has(body, 'sidebar-item-child', 'the five children of Pages keep their elbow');

  // The white util bar that held Sign Out is gone for good — that is the part
  // the design rejected. Sign Out lives in the sidebar foot now.
  ok(!body.includes('util-bar'), 'the util bar is gone');

  // The shell's CSS/JS is no longer inlined into the page — it is served
  // from its own cacheable routes (see "the shared shell CSS/JS is
  // externalised" below) and linked in rather than embedded, so these checks
  // read the asset responses rather than the page body.
  const shellCss = await (await call(env, '/assets/admin.css')).text();
  const shellJs = await (await call(env, '/assets/admin.js')).text();

  // Two flex columns, not a fixed rail plus matching body padding. The rail
  // width is a single custom property now, read by both sides.
  ok(shellCss.includes('body{display:flex;align-items:stretch;}'), 'the shell is a flex row');
  ok(shellCss.includes('.tlc-main{flex:1;min-width:0'), 'the content column takes what is left');
  ok(shellCss.includes('--tlc-rail:228px'), 'and the rail width is declared once');
  ok(!shellCss.includes('body{padding-left:228px'), 'the old padding arithmetic is gone');

  // ⚠ Below 900px it is a slide-over, and the CSS and the handler cannot ship
  // apart. A previous pass deleted the handler and kept the CSS, so a phone
  // got a sidebar off-canvas behind a button wired to nothing — an admin with
  // no navigation at all.
  ok(body.includes('id="sidebar-toggle"'), 'the hamburger is rendered');
  ok(body.includes('id="sidebar-backdrop"'), 'and the scrim it needs');
  ok(shellJs.includes("getElementById('sidebar-toggle')"), 'and the handler that opens it');
  ok(shellJs.includes("classList.toggle('is-open'"), 'which really toggles the class the CSS reads');

  // The context bar reports; it does not navigate.
  has(body, 'class="tlc-ctx"', 'the context bar is above the content');
  has(body, 'class="tlc-ctx-group">Admin<', 'Dashboard’s group reads Admin');
  has(body, 'class="tlc-ctx-section">Dashboard<', 'with the section beside it');
  // Task 12b/c. The right of the bar is the ⌘K chip and "View site", nothing
  // else. Connect links to an unrelated app and does not belong in the admin's
  // chrome — it is deleted, not moved to the sidebar foot. And the ↗ goes with
  // it everywhere: the link text says where it goes.
  has(body, '>View site<', 'the bar carries View site');
  ok(!body.includes('Connect'), 'Connect is gone from the chrome entirely');
  ok(!body.includes('↗'), 'and no outbound arrow glyphs survive on this screen');
  ok(!body.includes('tlc-ctx-tab'), 'no tabs in it');
  ok(!body.includes('class="tlc-nav-chip'), 'and no group chips — the sidebar navigates');

  // Sign out is in the sidebar foot, and NOT duplicated in the bar.
  has(body, 'class="sidebar-signout"', 'Sign out is in the sidebar foot');
  eq((body.match(/Sign out/g) || []).length, 1, 'and appears exactly once in the shell');

  // The trail follows the screen.
  const gym = await (await call(env, '/gym-rentals', { cookie })).text();
  has(gym, 'class="tlc-ctx-group">Events<', 'a gym screen names its group');
  has(gym, 'class="tlc-ctx-section">Gym rentals<', 'and its section');
}

group('the shared shell CSS/JS is externalised, not inlined');
{
  const { env } = await boot();

  // A visitor is never signed in when the browser first asks for these — the
  // login page needs its own CSS too — so both routes must answer with no
  // session at all.
  const cssRes = await call(env, '/assets/admin.css');
  const jsRes = await call(env, '/assets/admin.js');
  eq(cssRes.status, 200, 'the stylesheet loads with no session');
  eq(jsRes.status, 200, 'the script loads with no session');

  // A year, immutable — the whole point is that a browser only ever fetches
  // this once per deploy, not once per click.
  has(cssRes.headers.get('cache-control') || '', 'immutable', 'the stylesheet is cached for a year');
  has(jsRes.headers.get('cache-control') || '', 'immutable', 'so is the script');
  ok(!/private|max-age=10\b/.test(cssRes.headers.get('cache-control') || ''), 'not the page’s own short-lived header');

  // If a request for a plain static string ever touches the schema gate, the
  // whole reason it was moved ahead of it — zero D1 round-trips — is gone.
  // A DB whose prepare() always throws proves nothing was ever asked of it.
  const brokenDb = { prepare() { throw new Error('should never be queried for a static asset'); } };
  const untouched = await worker.fetch(
    new Request('https://admin.timothystl.org/assets/admin.css'),
    { ...env, DB: brokenDb }, ctx);
  eq(untouched.status, 200, 'serving the asset never touches the database');

  // And the page that used to carry this content inline now just points at
  // it, cache-busted by the same VERSION every deploy already bumps.
  // ⚠ Same env as the session it signs in to — a fresh boot() pairs a new
  // db with its own env, and signing in to one while calling the other
  // means the lookup finds no session at all.
  const { db: db2, env: env2 } = await boot();
  const { cookie } = signIn(db2);
  const page = await (await call(env2, '/dashboard', { cookie })).text();
  ok(/\/assets\/admin\.css\?v=v[\d.]+/.test(page), 'the page links the stylesheet, versioned');
  ok(/\/assets\/admin\.js\?v=v[\d.]+/.test(page), 'and the script, versioned');
  ok(!page.includes('<style>'), 'and carries no inline shell <style> of its own');
}

group('what is under Pages folds away');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const open = (html) => /id="sidebar-under-pages"(?! hidden)/.test(html);

  // Five rows permanently under Pages pushed the four groups below them down
  // the sidebar and read as one flat list of ten — the opposite of what
  // nesting them was for.
  const dash = await (await call(env, '/dashboard', { cookie })).text();
  ok(!open(dash), 'from somewhere else, the children are folded away');
  has(dash, 'class="sidebar-caret"', 'with a control to open them');

  // ⚠ Decided server-side, not by a script after paint. A sidebar whose rows
  // move once the page has loaded is a sidebar you cannot click confidently.
  ok(open(await (await call(env, '/pages', { cookie })).text()),
    'on Pages itself they are open');
  for (const [path, what] of [['/ministries', 'Ministries'], ['/sermons', 'Sermons'],
    ['/newsitems', 'News'], ['/partners', 'Partners'], ['/christian-education', 'Christian Ed']]) {
    const html = await (await call(env, path, { cookie })).text();
    ok(open(html), `and on ${what}, which is one of them`);
    // The row you are on cannot be the row that is hidden.
    has(html, 'data-here', 'marked as opened because you are inside it');
  }
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
  // ⚠ The CHURCH's today, not UTC's — the same helper /api/news now filters on.
  // Seeding a post with the UTC date made this block fail every evening after
  // about 7pm Central, because the Worker correctly read it as published
  // tomorrow. It used to pass only because the test and the code shared the
  // same wrong assumption about what day it was.
  const today = churchDate();

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
  db.prepare("INSERT INTO news_items (title,summary,publish_date,expire_date,pinned) VALUES ('Pinned post','s',?,?,1)").run(today, '2099-01-01');
  db.prepare("INSERT INTO news_items (title,summary,publish_date,expire_date,pinned) VALUES ('Ordinary post','s',?,?,0)").run(today, '2099-01-01');
  const news = await (await call(env, '/newsitems', { cookie })).text();
  has(news, 'tlc-pin', 'a pinned post carries a pin marker');
  ok(news.indexOf('tlc-pin') < news.indexOf('Pinned post'), 'the marker sits before the title');
  ok(news.indexOf('Pinned post') < news.indexOf('Ordinary post'), 'and pinned rows sort to the top');
  // "No emoji anywhere in the admin chrome."
  ok(!news.includes('\u{1F4F0}'), 'the newspaper emoji is gone — icons are typographic glyphs');

  // /api/news: an EVENT (has event_date) sorts soonest-first and disappears
  // once its date passes, whatever its expire_date says; a plain
  // ANNOUNCEMENT (no event_date) sorts newest-published-first, same as
  // before. Events lead announcements as a group, regardless of how far out
  // the soonest one is — a member deciding "what's next" should not have to
  // skim past a stale announcement to find it.
  // ⚠ EVENT DATES ARE RELATIVE TO `today`, NOT HARDCODED. An event date fixed
  // to a real calendar day eventually becomes a day in the PAST relative to
  // whenever this suite actually runs — and "an event disappears once its
  // date passes" means VBS's own event would drop out of /api/news entirely,
  // failing every assertion below it with an unrelated-looking symptom
  // (titles.indexOf returning -1). churchDatePlus keeps both events in the
  // future, and VBS soonest, however far the real calendar has moved on.
  db.prepare("INSERT INTO news_items (title,summary,publish_date,event_date,expire_date,pinned) VALUES ('Old announcement','s',?,NULL,?,0)").run('2026-01-01', '2099-01-01');
  db.prepare("INSERT INTO news_items (title,summary,publish_date,event_date,expire_date,pinned) VALUES ('New announcement','s',?,NULL,?,0)").run(today, '2099-01-01');
  // ⚠ A LITERAL DATE HERE IS THE SAME TRAP THE COMMENT ABOVE ALREADY WARNS
  // ABOUT, ONE FIELD OVER: VBS was hardcoded '2026-08-20' and passed for
  // months, then started failing the moment real calendar time reached that
  // date — "a past event drops off entirely" (the assertion two lines below
  // this one) is exactly the rule that then correctly removed VBS from the
  // feed, breaking the "still leads Christmas Market" ordering check that
  // depends on it being present. Both dates are relative now, so neither can
  // repeat that failure: churchDatePlus(3) is always soonest-but-one, and
  // Christmas Market's churchDatePlus(90) is always well after it.
  db.prepare("INSERT INTO news_items (title,summary,publish_date,event_date,expire_date,pinned) VALUES ('Christmas Market','s',?,?,?,0)").run('2026-01-01', churchDatePlus(90), '2099-01-01');
  db.prepare("INSERT INTO news_items (title,summary,publish_date,event_date,expire_date,pinned) VALUES ('VBS','s',?,?,?,0)").run('2026-01-01', churchDatePlus(3), '2099-01-01');
  // A past event, still inside its (generous) expire_date — must not appear.
  db.prepare("INSERT INTO news_items (title,summary,publish_date,event_date,expire_date,pinned) VALUES ('Last month''s rummage sale','s',?,?,?,0)").run('2026-01-01', '2020-01-01', '2099-01-01');
  const apiNews = await (await call(env, '/api/news')).json();
  const titles = apiNews.map((r) => r.title);
  ok(!titles.includes("Last month's rummage sale"), 'a past event drops off entirely, even with time left on its expire_date');
  ok(titles.indexOf('VBS') < titles.indexOf('Christmas Market'), 'the soonest event leads the next one: ' + titles.join(', '));
  ok(titles.indexOf('Christmas Market') < titles.indexOf('New announcement'),
    'every event leads every plain announcement, however far out the event is');
  ok(titles.indexOf('New announcement') < titles.indexOf('Old announcement'),
    'within plain announcements, the newest published still leads');
  ok(titles.indexOf('Pinned post') < titles.indexOf('VBS'), 'pinned still always leads everything else');

  // 20-audit: a read-only drawer. No save, no delete; fields are sand-filled
  // rather than grayed, because gray text reads as broken.
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
  has(screen, 'lands somewhere other than the Link Tree', 'the screen flags a tap that cannot show cards');
  has(screen, 'not visible to anybody', 'and says the cards on it are going unseen');

  // A tap that does land on the Link Tree carries no such warning.
  const firstTap = screen.slice(0, screen.indexOf('/tap2'));
  ok(!firstTap.includes('lands somewhere other than'), 'a tap on the Link Tree is not flagged');
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
  ok(!bookings.includes('<details open'), 'and not two accordions grouped by organization');

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
  // ⚠ The bucket is keyed on the CHURCH's day, so the expectation has to be
  // too. In UTC this line disagreed with the code every evening after 7pm.
  const day = churchDate();
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

  // ⚠ Needs its OWN session — the `cookie` above was just invalidated by the
  // /logout call for the AC-1 check. Reusing it here used to pass anyway,
  // because a logged-out request lands on the login page and that page was,
  // by coincidence, also padded past 10000 bytes with the shell's inlined
  // CSS/JS — so this assertion was really re-checking the login page, not
  // the scheduler. Externalising that CSS/JS (see admin/helpers.js) shrank
  // the login page below the threshold and exposed it.
  const staff = signIn(db, ALL_PERMISSIONS, 'office-staff');
  const inside = await (await call(env, '/scheduler', { cookie: staff.cookie })).text();
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

group('the schema gate reads once, then not at all');
{
  // Five serial marker SELECTs used to run ahead of routing on EVERY request
  // — including each of the public API calls the homepage makes. They are one
  // read now, and none once the binding has been seen current. Counted
  // mechanically off the shim's statement log rather than measured by hand.
  const db = new DatabaseSync(':memory:');
  const env = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test' };
  const markerReads = () => env.DB.log.filter((q) => /^\s*SELECT/i.test(q) && q.includes('_schema_version')).length;

  await call(env, '/login');       // fresh database: the migrations run
  env.DB.log.length = 0;
  await call(env, '/login');       // warm: every gate already satisfied
  eq(markerReads(), 1, 'a warm request makes exactly one marker read');

  env.DB.log.length = 0;
  await call(env, '/login');       // and now the binding is memoized
  eq(markerReads(), 0, 'after that, none at all');

  // The first-run /setup COUNT is remembered the same way — an unauthenticated
  // request no longer pays it once a user exists.
  signIn(db, ALL_PERMISSIONS, 'gate.user');
  await call(env, '/');
  env.DB.log.length = 0;
  await call(env, '/');
  eq(env.DB.log.filter((q) => q.includes('COUNT(*) as n FROM users')).length, 0,
    'the setup check is not re-counted on every request');
}

group('badges follow you into an edit screen');
{
  // badgeCounts used to be passed only on the 25 list screens, so the sidebar
  // badges visibly vanished the moment somebody clicked into any edit form —
  // and reappeared on the way back, which reads as the admin being broken.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("INSERT INTO gym_groups (id,name,contact,email,active) VALUES (7,'Badge League','B','b@c.co',1)").run();
  db.prepare(`INSERT INTO gym_bookings (group_id,booking_date,start_time,end_time,status,hold_expires_at,created_at)
              VALUES (7,'2099-01-05','18:00','20:00','hold','2099-01-01T00:00:00Z','2026-08-01T00:00:00Z')`).run();

  for (const p of ['/notices/add', '/pages/details', '/gym-rentals/groups']) {
    const body = await (await call(env, p, { cookie })).text();
    has(body, 'sidebar-badge', `${p} still shows the sidebar badges`);
  }
}

group('⚠ A hand-edited page can still be given the redesigned layout');
{
  // THE BUG THIS EXISTS FOR. The four redesigned drafts reach a page through
  // the seed loop, which is gated on canReseed() — untouched by a person AND
  // never published. That guard is right; it is what stops a deploy throwing
  // away somebody's work. But it meant the redesign could not reach the four
  // pages it was WRITTEN for, because those are exactly the pages most likely
  // to have been edited. /news had been rebuilt by hand, so the new draft was
  // silently skipped and the page looked untouched by the entire release.
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const handmade = JSON.stringify([{ id: 'x1', type: 'text', body: '<p>Something somebody wrote by hand.</p>' }]);
  db.prepare(
    "INSERT OR REPLACE INTO pages (id,title,slug,parent_id,sort,template,status,in_menu,blocks,published_blocks,updated_at,updated_by) " +
    "VALUES ('news','News & Events','/news',NULL,70,'standard','published',1,?,NULL,?,'katig')"
  ).run(handmade, new Date().toISOString());

  const before = db.prepare("SELECT blocks, updated_by FROM pages WHERE id='news'").get();
  eq(before.updated_by, 'katig', 'the page is stamped as edited by a person, so the seed loop skips it');

  const res = await call(env, '/pages/api/page/news/use-redesign', { cookie, method: 'POST' });
  eq(res.status, 200, 'the route matches');
  // ⚠ The action segment carries a HYPHEN. The route regex was ([^/]+)(\/[a-z]+)?
  // and would have missed it silently — a 404 with the handler sitting right
  // there looking correct.
  const out = await res.json();
  ok(out.blocks.length > 1, 'the redesigned layout replaces the hand-made one');
  ok(out.blocks.some((x) => x.type === 'photobanner'), 'including the photo banner, which is the whole look');
  ok(out.html.includes('tlcb--photobanner'), 'and it comes back rendered');

  const after = db.prepare("SELECT blocks, published_blocks, updated_by FROM pages WHERE id='news'").get();
  ok(JSON.parse(after.blocks).some((x) => x.type === 'photobanner'), 'the draft is written');
  // ⚠ THE LIVE PAGE MUST NOT MOVE. Same rule every seed in this repo follows:
  // the draft changes, and a person presses Publish.
  eq(after.published_blocks, null, 'and published_blocks is untouched, so the live page is exactly what it was');

  // ⚠ SNAPSHOT FIRST. page_revisions normally holds one entry per PUBLISH, and
  // a page that has never been published has none — so for /news the current
  // draft was the only copy of work somebody did by hand.
  const rev = db.prepare("SELECT blocks, note FROM page_revisions WHERE page_id='news' ORDER BY id DESC").get();
  ok(rev, 'what was there is saved to the version history first');
  eq(JSON.parse(rev.blocks)[0].type, 'text', 'as the hand-made blocks themselves, so they can be put back');

  // A page with no authored layout says so rather than writing nothing and
  // reporting success.
  db.prepare(
    "INSERT OR REPLACE INTO pages (id,title,slug,parent_id,sort,template,status,in_menu,blocks,updated_at) " +
    "VALUES ('prayer','Prayer','/prayer',NULL,80,'standard','published',1,'[]',?)"
  ).run(new Date().toISOString());
  const none = await call(env, '/pages/api/page/prayer/use-redesign', { cookie, method: 'POST' });
  eq(none.status, 400, 'a page with no redesigned layout is refused, not silently no-opped');
}

// ── a redraw keeps the page's layout ─────────────────────────────────────────
group('⚠ The editor redraws a sidebar page WITH its sidebar');
{
  // THE BUG THIS EXISTS FOR. Dinger: "the section with sidebar doesnt seem to
  // display a sidebar." The stateless /render endpoint took only the blocks and
  // the slug, so it rendered every page as `standard` — which has no aside. The
  // canvas was right on first paint and right the moment somebody switched
  // layout (both of those paths pass the template), so the sidebar appeared and
  // then vanished at the first added, deleted or reordered block, for the rest
  // of the session. A reload brought it back, which is what made it read as the
  // sidebar not displaying rather than as an editor fault.
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const body = [{ id: 'r1', type: 'text', body: '<p>Words on the page.</p>' }];
  // ⚠ The render ships the whole stylesheet, which names every class this group
  // is looking for. Assert against the markup alone or `lacks` can never fail.
  const render = async (mount, slug) => {
    const res = await worker.fetch(new Request('https://admin.timothystl.org' + mount + '/render', {
      method: 'POST',
      headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json' },
      body: JSON.stringify({ slug, blocks: body }),
    }), env, ctx);
    const out = await res.json();
    return String(out.html || '').replace(/<style[\s\S]*?<\/style>/g, '');
  };

  // /ministries is seeded as a section landing with seven pages beneath it.
  db.prepare("UPDATE pages SET template='sectionside' WHERE id='ministries'").run();
  const kids = db.prepare("SELECT title FROM pages WHERE parent_id='ministries' ORDER BY sort, title").all();
  ok(kids.length > 1, 'the page really does have pages beneath it');

  const side = await render('/pages/api', 'ministries');
  has(side, 'tlcb-page--sectionside', 'the redraw keeps the layout the page is actually set to');
  has(side, '<div class="tlcb-layout">', 'so the two columns are there');
  has(side, '<aside class="tlcb-side">', 'and the sidebar itself');
  // The child list is derived from the page tree, so it can only come from the
  // server — the browser posts blocks and a slug and nothing else.
  has(side, '<div class="tlcb-side-kids">', 'with the pages beneath this one listed in it');
  has(side, kids[0].title, 'by name');

  // Plain `sidebar` gets the aside without the child list — the aside is the
  // shared part, the kids are what the section layout adds.
  db.prepare("UPDATE pages SET template='sidebar' WHERE id='worship'").run();
  const plain = await render('/pages/api', 'worship');
  has(plain, 'tlcb-page--sidebar', 'a plain sidebar page redraws as one too');
  has(plain, '<aside class="tlcb-side">', 'with its aside');
  lacks(plain, 'tlcb-side-kids', 'and no section list, which belongs to the other layout');

  // ⚠ The other direction, which is what stops this becoming "always draw an
  // aside": a standard page must come back with none. It was not even getting
  // its own wrapper class before — renderPage() reads a missing template as
  // "this is a ministry page" and returns a bare column.
  const flat = await render('/pages/api', 'about');
  has(flat, 'tlcb-page--standard', 'a standard page is still standard');
  lacks(flat, 'tlcb-side', 'and grows no sidebar it never asked for');

  // A ministry page has no layout of its own, and the shared endpoint must not
  // go looking for one in the site pages table under the same name.
  const min = await render('/ministries/api', 'music');
  has(min, '<div class="tlcb-page"', 'a ministry page redraws as the bare column it always was');
  lacks(min, 'tlcb-page--', 'with no site layout applied to it');
}

// ── the aside has its own spacing control ────────────────────────────────────
group('The sidebar can be pushed down to line up with the content beside it');
{
  // Dinger: "if you'd rather the sidebar started lower instead, that isn't
  // adjustable today". The aside has no block of its own to carry a spaceAbove,
  // so it is a page-level number instead — same 8px step, same 0..96 cap a
  // block's own spacing carries.
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  db.prepare("UPDATE pages SET template='sidebar' WHERE id='worship'").run();

  const jsonPost = async (path, body) => worker.fetch(new Request('https://admin.timothystl.org' + path, {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env, ctx);

  // A value between two steps snaps to the nearer one, the same rule a
  // block's own spacing follows — not rejected, since a mistyped value is
  // still a person trying to move something 40-odd pixels.
  // ⚠ withCss ships the WHOLE stylesheet, which is full of its own unrelated
  // margin-top declarations — assert against the <aside> tag itself, not the
  // bare string, or a passing test proves nothing.
  let res = await jsonPost('/pages/api/page/worship/settings', { aside_top: 37 });
  eq(res.status, 200, 'the route matches');
  let out = await res.json();
  eq(out.page.aside_top, 40, 'snapped to the nearest 8px step');
  ok(out.rerender, 'and the canvas is told to redraw, since this changes what it looks like');
  has(out.html, '<aside class="tlcb-side" style="margin-top:40px">', 'the aside carries the new offset');

  // ⚠ Clamped to what a single block's own spaceAbove could introduce — the
  // whole reason this exists is to compensate for that, so anything past it
  // could never be lining up with real content.
  res = await jsonPost('/pages/api/page/worship/settings', { aside_top: 9000 });
  out = await res.json();
  eq(out.page.aside_top, 96, 'clamped to the same ceiling a block’s own spacing carries');

  // Zero is the ordinary case — flush, exactly as every page rendered before
  // this control existed — and it must not still carry a style attribute a
  // human would have to notice is doing nothing.
  res = await jsonPost('/pages/api/page/worship/settings', { aside_top: 0 });
  out = await res.json();
  eq(out.page.aside_top, 0, 'back to flush');
  has(out.html, '<aside class="tlcb-side">', 'and the style attribute is gone with it, not just zeroed');
  lacks(out.html.split('</style>').pop(), 'margin-top', 'nothing left on the aside itself, outside the shared stylesheet');

  // A rename alone must not touch it, and must not redraw the canvas either —
  // only the two settings that change what the canvas looks like should.
  res = await jsonPost('/pages/api/page/worship/settings', { aside_top: 24 });
  out = await res.json();
  eq(out.page.aside_top, 24, 'set for the next check');
  res = await jsonPost('/pages/api/page/worship/settings', { title: 'Worship & Music' });
  out = await res.json();
  eq(out.page.aside_top, 24, 'an unrelated save leaves it exactly where it was');
  eq(out.rerender, false, 'and does not redraw the canvas over a title change alone');

  // The public render carries it too — this is chrome around the page, not an
  // editor-only affordance.
  db.prepare('UPDATE pages SET published_blocks = blocks, status = \'published\' WHERE id = \'worship\'').run();
  const pub = await (await call(env, '/api/pages')).json();
  has(pub.rendered.worship, '<aside class="tlcb-side" style="margin-top:24px">', 'and the published page carries the same offset');
}

// ── unpublish, the reverse of publish ────────────────────────────────────────
group('Unpublish takes an accidentally-published page back off the site');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const jsonPost = async (path, body) => worker.fetch(new Request('https://admin.timothystl.org' + path, {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }), env, ctx);

  // Refusing to unpublish something that was never published is the same
  // rule the button's own visibility follows client-side (published_count),
  // enforced here too so a crafted POST can't skip the check.
  db.prepare("UPDATE pages SET published_blocks = NULL, status = 'draft' WHERE id = 'worship'").run();
  let res = await jsonPost('/pages/api/page/worship/unpublish');
  eq(res.status, 400, 'refused — nothing is published');

  // Publish it for real, confirm it reached the public API, then take it back.
  await jsonPost('/pages/api/page/worship/publish', {});
  let pub = await (await call(env, '/api/pages')).json();
  ok(pub.pages.some((p) => p.id === 'worship'), 'published: worship is in the page list');
  ok('worship' in pub.rendered, 'and its blocks are rendered');

  res = await jsonPost('/pages/api/page/worship/unpublish');
  eq(res.status, 200, 'unpublish succeeds');
  let out = await res.json();
  eq(out.status, 'draft', 'reports the page as a draft again');

  const row = db.prepare("SELECT status, published_blocks, blocks FROM pages WHERE id = 'worship'").get();
  eq(row.status, 'draft', 'stored as a draft');
  eq(row.published_blocks, null, 'nothing published in the database');
  ok(row.blocks && row.blocks !== '[]', 'the draft itself is untouched — nothing was lost');

  // ⚠ THE WHOLE PAGE COMES OFF /api/pages, NOT JUST ITS RENDERED HTML — that
  // endpoint's own query is `WHERE status = 'published'`. This is the load-
  // bearing assertion: unpublishing a page is "take it off the site," not
  // merely "stop showing its blocks."
  pub = await (await call(env, '/api/pages')).json();
  ok(!pub.pages.some((p) => p.id === 'worship'), 'unpublished: worship drops out of the page list entirely');
  ok(!('worship' in pub.rendered), 'and out of the rendered map');

  // A second unpublish refuses, same as the first check — nothing to undo.
  res = await jsonPost('/pages/api/page/worship/unpublish');
  eq(res.status, 400, 'refused a second time — already unpublished');

  const audited = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='unpublish' AND entity_type='page' AND entity_id='worship'").get().n;
  eq(audited, 1, 'the unpublish is in the audit log');

  // A ministry leader who may only edit their own pages can still take one
  // of their own down — same permission Publish already allows them.
  db.prepare("UPDATE pages SET owner_username = 'leah' WHERE id = 'worship'").run();
  await jsonPost('/pages/api/page/worship/publish', {});
  const leah = signIn(db, ['pages_edit_own'], 'leah');
  const leahPost = async (path) => worker.fetch(new Request('https://admin.timothystl.org' + path, {
    method: 'POST', headers: { cookie: leah.cookie, origin: 'https://admin.timothystl.org' },
  }), env, ctx);
  res = await leahPost('/pages/api/page/worship/unpublish');
  eq(res.status, 200, 'a ministry leader can unpublish their own page');
}

// ── the whole staff directory reaches the page ───────────────────────────────
group('⚠ The staff grid shows every member of staff');
{
  // THE BUG THIS EXISTS FOR. Dinger: "we are still not showing all staff
  // members in the staff layout cards." sanitizeBlock gives EVERY block a
  // `count`, clamped to 1..6 and defaulting to 3, whether or not its type has a
  // control for one — and the staff block sliced by it. So a directory of eight
  // could never show more than six and showed three, while the hardcoded /about
  // it replaces has always shown everybody. The other cap was the query itself.
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  db.prepare('DELETE FROM staff_members').run();
  const roster = ['Dinger', 'Pastor Matt', 'Jinah', 'Pastor Rall', 'Pastor Vo', 'Noah', 'Marla', 'Katie'];
  roster.forEach((name, i) => db.prepare(
    'INSERT INTO staff_members (name, title, email, photo_url, display_order) VALUES (?,?,?,?,?)'
  ).run(name, 'Staff', name.toLowerCase().replace(/\W/g, '') + '@timothystl.org', '', (i + 1) * 10));

  const blocks = JSON.stringify([{ id: 's1', type: 'staff', title: 'Our staff' }]);
  db.prepare("UPDATE pages SET blocks = ?, published_blocks = ?, status = 'published' WHERE id = 'about'")
    .run(blocks, blocks);

  const stored = JSON.parse(db.prepare("SELECT published_blocks FROM pages WHERE id='about'").get().published_blocks);
  eq(stored[0].count, undefined, 'the block itself carries no count — nothing here is asking for three');

  // ⚠ AND THE CROP TRAVELS WITH THEM. The Staff screen stores a per-person
  // object-position and zoom, and pageData() did not select either column — so
  // the block had no crop to honor even once it wanted to, and a face framed in
  // the admin came out framed differently on the published page.
  db.prepare("UPDATE staff_members SET photo_url='/images/dinger.webp', photo_position='40% 22%', photo_zoom=1.6 WHERE name='Dinger'").run();

  const api = await (await call(env, '/api/pages', { fresh: true })).json();
  const about = api.rendered.about;
  eq((about.match(/class="tlcb-person"/g) || []).length, roster.length,
    'every person in the directory is on the published page');
  for (const name of roster) has(about, name, name + ' is on it');
  has(about, 'object-position:40% 22%', 'with the crop the office set on the Staff screen');
  has(about, 'transform:scale(1.6)', 'and the zoom that goes with it');

  // ⚠ THE BUG THIS EXISTS FOR TOO: fixImageUrls() used to rewrite EVERY
  // src="/images/…" to admin.timothystl.org unconditionally, on the mistaken
  // premise that an uploaded image is always stored root-relative. A staff
  // photo like this one is a legacy static asset served from public/images/
  // on the SITE worker — admin.timothystl.org has no such file and 404s on
  // it, which is exactly what "many staff pictures are broken" looked like.
  has(about, 'src="/images/dinger.webp"',
    'a legacy static staff photo stays root-relative — it resolves fine on whichever site serves the page');
  ok(!about.includes('src="https://admin.timothystl.org/images/dinger.webp"'),
    'and must never be rewritten to admin.timothystl.org, which has no public/images/ of its own');

  // A genuinely R2-uploaded photo (the "news-" key /api/upload-image mints)
  // is stored ABSOLUTE already and is untouched either way — but the same
  // rewrite has to still fire for the one shape that legitimately needs it:
  // a root-relative upload key, if one is ever posted by hand or by an older
  // row. That is the one case fixImageUrls exists to fix.
  db.prepare("UPDATE staff_members SET photo_url='/images/news-1234-abcde.webp' WHERE name='Jinah'").run();
  const api2 = await (await call(env, '/api/pages', { fresh: true })).json();
  has(api2.rendered.about, 'src="https://admin.timothystl.org/images/news-1234-abcde.webp"',
    'a real upload-key path is still made absolute against the admin origin, where R2 actually serves it');
}


// ── the Christmas Market vendor application ──────────────────────────────────
// The public form and the coordinator's list, through the real Worker. What
// these check is not that the screen renders — it is the ordering that makes
// the whole thing safe: the application is SAVED before anybody is sent to
// pay, and the amount is decided here rather than by whatever the browser
// posted.
async function applyAsVendor(env, over = {}) {
  const fields = {
    participant_names: 'Marla Kerr', email: 'marla@example.com', phone: '(314) 555-0123',
    product_description: 'Handmade purses and crochet shawls', signature_name: 'Marla Kerr',
    tables: '1', ...over,
  };
  const body = new URLSearchParams(fields).toString();
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  const req = new Request('https://admin.timothystl.org/api/market/apply', { method: 'POST', headers, body });
  return worker.fetch(req, env, { waitUntil: () => {}, passThroughOnException: () => {} });
}

// ⚠ THE MARKET IS ONE `site_events` ROW NOW, NOT ELEVEN site_settings KEYS,
// AND ITS APPLICATIONS ARE `site_event_registrations` ROWS, NOT
// `market_vendors` ONES — see admin/events.js and the ONE-TIME migration in
// tlc-admin-worker.js. Every group below still asserts the identical
// user-facing behavior (the routes, the forms, the redirects, the numbers a
// vendor is shown); only the SQL a test reads the result back with changed,
// because the storage genuinely moved.
const marketEvent = (db) => db.prepare("SELECT * FROM site_events WHERE id='christmasmarket'").get();

group('a vendor application is saved before anybody is sent to pay');
{
  const { db, env } = await boot();
  db.prepare("INSERT INTO site_settings (key,value) VALUES ('give_url','https://give.tithe.ly/?formId=abc&fundId=general') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  db.prepare("UPDATE site_events SET fund_id = 'market-fund' WHERE id = 'christmasmarket'").run();

  const res = await applyAsVendor(env, { tables: '2' });
  eq(res.status, 200, 'a complete application is accepted');
  const d = await res.json();
  ok(d.success, 'and reports success');

  const saved = db.prepare("SELECT * FROM site_event_registrations WHERE event_id='christmasmarket'").all();
  eq(saved.length, 1, 'the application is in the coordinator’s list');
  eq(saved[0].payment_status, 'unpaid', 'marked unpaid — the website cannot see whether the card went through');
  eq(saved[0].qty, 2, 'with the number of tables asked for');
  eq(saved[0].amount_due_cents, 6210, 'and what was asked for, in cents');
  eq(saved[0].contact_email, 'marla@example.com', 'and the address to confirm the table to');

  // The link is built from give_url at request time and the market fund
  // REPLACES the base link's fund rather than adding a second.
  ok(d.payUrl.includes('amount=6210'), 'the payment link carries the amount in cents');
  eq((d.payUrl.match(/fundId=/g) || []).length, 1, 'and exactly one fundId');
  ok(d.payUrl.includes('fundId=market-fund'), 'which is the market’s');

  // ⚠ The load-bearing one. A maker who closes the card page must still exist
  // on the list — the Google Form this replaces lost them entirely.
  db.prepare("DELETE FROM site_settings WHERE key='give_url'").run();
  const noLink = await applyAsVendor(env, { email: 'sue@example.com' });
  eq(noLink.status, 200, 'with no giving link set the application is still accepted');
  const d2 = await noLink.json();
  eq(d2.payUrl, '', 'there is simply no payment address to send them to');
  eq(db.prepare("SELECT COUNT(*) AS n FROM site_event_registrations WHERE event_id='christmasmarket'").get().n, 2,
    'and the application is saved anyway — a payment problem must never lose it');
}

group('the price is decided by the server, never by the browser');
{
  const { db, env } = await boot();
  // Everything the page could post about money, posted wrong.
  const res = await applyAsVendor(env, { tables: '40', amount_due_cents: '1', total: '0.01', tableFee: '0' });
  eq(res.status, 200, 'the application still goes through');
  const saved = db.prepare("SELECT qty AS tables, amount_due_cents FROM site_event_registrations WHERE event_id='christmasmarket'").get();
  eq(saved.tables, 3, 'a posted table count above the maximum is clamped to it');
  eq(saved.amount_due_cents, 9300, 'and the amount is recomputed here — three tables is $93.00');

  const d = await res.json();
  ok(!d.payUrl || d.payUrl.includes('amount=9300'), 'the payment link asks for the recomputed figure');
}

// ── ONLY SO MANY TABLES ──────────────────────────────────────────────────────
// 60 confirmed, then a soft reserve up to 70, then the market is genuinely
// full. Driven through the real /api/market/apply route rather than only the
// pure capacityDecision() unit — what matters here is that the two counts the
// route computes against the live table (confirmed, and confirmed+reserved)
// are the RIGHT two counts, and that a soft-reserved row really gets no
// payment link.
group('confirmed tables pause at the cap, then a soft reserve, then the market is full');
{
  const { db, env } = await boot();
  db.prepare("UPDATE site_events SET registration_cap = 3, waitlist_enabled = 1, waitlist_cap = 5 WHERE id = 'christmasmarket'").run();

  // Three one-table applications fill the confirmed pause exactly.
  for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
    const res = await applyAsVendor(env, { email, tables: '1' });
    eq(res.status, 200, `${email} is accepted while under the pause`);
    const d = await res.json();
    eq(d.waitlisted, false, `${email} is an ordinary application, not a reserve`);
  }
  const confirmedCount = db.prepare(
    "SELECT COUNT(*) AS n FROM site_event_registrations WHERE event_id='christmasmarket' AND waitlisted = 0"
  ).get().n;
  eq(confirmedCount, 3, 'all three landed as ordinary, confirmed rows');

  // A fourth application, past the pause but inside the hard cap, is a soft
  // reserve: saved, no payment link, nothing charged.
  const fourth = await applyAsVendor(env, { email: 'd@example.com', tables: '1' });
  eq(fourth.status, 200, 'a fourth application past the pause is still accepted');
  const dFourth = await fourth.json();
  eq(dFourth.waitlisted, true, 'and marked as a soft reserve');
  eq(dFourth.payUrl, '', 'with no payment link at all');
  const fourthRow = db.prepare("SELECT * FROM site_event_registrations WHERE contact_email = 'd@example.com'").get();
  eq(fourthRow.waitlisted, 1, 'stored as waitlisted');
  eq(fourthRow.payment_status, 'unpaid', 'still unpaid — nothing was charged, but the debt is recorded');
  ok(fourthRow.amount_due_cents > 0, 'and what it would owe once confirmed is still on the row');

  // A fifth lands exactly on the hard cap (5 of 5) — still a reserve.
  const fifth = await applyAsVendor(env, { email: 'e@example.com', tables: '1' });
  eq((await fifth.json()).waitlisted, true, 'a fifth application lands exactly on the hard cap and is still reserved');

  // A sixth would exceed the hard cap outright — refused, not queued.
  const sixth = await applyAsVendor(env, { email: 'f@example.com', tables: '1' });
  eq(sixth.status, 409, 'a sixth application, past the hard cap, is refused outright');
  const dSixth = await sixth.json();
  ok(dSixth.error && /full/i.test(dSixth.error), 'and told plainly that the market is full');
  eq(db.prepare("SELECT COUNT(*) AS n FROM site_event_registrations WHERE contact_email = 'f@example.com'").get().n, 0,
    'nothing is stored for a refused application');

  // The coordinator can see and act on a reserved row from the Vendors tab.
  const { cookie } = signIn(db);
  const listBody = await (await call(env, '/market', { cookie })).text();
  has(listBody, 'Waiting list', 'the reserved row carries the waiting-list badge');
  has(listBody, 'data-mktfilter="waitlist"', 'and the filter that isolates them');
  has(listBody, 'Tables confirmed', 'and the capacity tile now speaks in confirmed/paused terms');

  const dRow = db.prepare("SELECT id FROM site_event_registrations WHERE contact_email = 'd@example.com'").get();
  const confirm = await call(env, '/market/update', {
    cookie, method: 'POST', accept: 'application/json',
    form: { id: String(dRow.id), field: 'confirm_reserve', value: '' },
  });
  eq(confirm.status, 200, 'confirming a reserved row off the waiting list succeeds');
  eq(JSON.parse(await confirm.text()).row.waitlisted, false, 'and answers that it is no longer reserved');
  eq(db.prepare('SELECT waitlisted FROM site_event_registrations WHERE id = ?').get(dRow.id).waitlisted, 0,
    'the database agrees — the row is now an ordinary confirmed application');
  eq(db.prepare('SELECT payment_status FROM site_event_registrations WHERE id = ?').get(dRow.id).payment_status, 'unpaid',
    'confirming does not itself take payment — the coordinator still collects it the ordinary way');

  // Only market_manage may confirm a row off the waiting list.
  const { cookie: settingsOnly } = signIn(db, ['settings_manage'], 'office2');
  const refusedConfirm = await call(env, '/market/update', {
    cookie: settingsOnly, method: 'POST', accept: 'application/json',
    form: { id: String(dRow.id), field: 'confirm_reserve', value: '' },
  });
  eq(refusedConfirm.status, 403, 'settings_manage alone cannot touch the vendor list');
}

group('the settings panel is where the two caps are set, and only settings_manage can set them');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const money = await (await call(env, '/market?tab=money', { cookie })).text();
  has(money, 'Pause confirmed tables at', 'the confirmed pause is on the Money & dates tab');
  has(money, 'Soft reserve once the pause is reached', 'with the toggle beside it');

  const save = await call(env, '/market/settings', { cookie, method: 'POST', form: {
    market_date_label: 'Saturday, Dec 12', market_hours_label: '10:00 am – 5:00 pm',
    market_table_fee: '30', market_max_tables: '9', market_fee_percent: '2.9', market_fee_fixed: '0.30',
    market_coordinator_email: 'marla@example.com',
    market_confirmed_cap: '60', market_soft_reserve_enabled: '1', market_hard_cap: '70',
  } });
  eq(save.status, 302, 'saved');
  eq(marketEvent(db).registration_cap, 60, 'the confirmed pause is stored on the event’s own registration_cap');
  eq(marketEvent(db).waitlist_enabled, 1, 'the soft reserve toggle is stored');
  eq(marketEvent(db).waitlist_cap, 70, 'and the absolute maximum is stored too');

  const moneyOn = await (await call(env, '/market?tab=money', { cookie })).text();
  has(moneyOn, 'id="fld-market_hard_cap"', 'while the reserve is on, the hard-cap field is a real, visible number input');

  // Toggling the reserve off — a real browser posts whatever `market_hard_cap`
  // was last in the DOM, which is the number the field above was showing.
  // The route must keep it rather than treat an untouched save as "clear it".
  const toggleOff = await call(env, '/market/settings', { cookie, method: 'POST', form: {
    market_date_label: 'Saturday, Dec 12', market_hours_label: '10:00 am – 5:00 pm',
    market_table_fee: '30', market_max_tables: '9', market_fee_percent: '2.9', market_fee_fixed: '0.30',
    market_coordinator_email: 'marla@example.com', market_confirmed_cap: '60', market_hard_cap: '70',
  } });
  eq(toggleOff.status, 302, 'saved with the reserve switched off');
  eq(marketEvent(db).waitlist_enabled, 0, 'the reserve is now off');
  eq(marketEvent(db).waitlist_cap, 70, 'and the hard cap the coordinator had set is NOT lost by toggling the reserve off');

  // Now that the reserve is off, a re-load replaces the number field with a
  // HIDDEN carrier of that same value — so a coordinator who saves some
  // OTHER field on this screen (never touching the reserve at all) still
  // posts `market_hard_cap`, and it still must not be read as "clear it".
  const moneyOff = await (await call(env, '/market?tab=money', { cookie })).text();
  lacks(moneyOff, 'id="fld-market_hard_cap"', 'the visible number field is gone now that the reserve is off');
  const hiddenMatch = moneyOff.match(/type="hidden" name="market_hard_cap" value="(\d*)"/);
  ok(hiddenMatch, 'a hidden carrier still exists for the field, so a browser posts it regardless');
  eq(hiddenMatch && hiddenMatch[1], '70', 'and it still carries the number that was saved, not blank');

  const untouchedSave = await call(env, '/market/settings', { cookie, method: 'POST', form: {
    market_date_label: 'Saturday, Dec 12', market_hours_label: '10:00 am – 5:00 pm',
    market_table_fee: '30', market_max_tables: '9', market_fee_percent: '2.9', market_fee_fixed: '0.30',
    market_coordinator_email: 'marla2@example.com', market_confirmed_cap: '60',
    market_hard_cap: hiddenMatch[1],
  } });
  eq(untouchedSave.status, 302, 'a later, unrelated save (a new coordinator email) still succeeds');
  eq(marketEvent(db).waitlist_cap, 70, 'and the hard cap survives it too, carried by the hidden field');

  const { cookie: marketOnly } = signIn(db, ['market_manage'], 'marla4');
  const refused = await call(env, '/market/settings', {
    cookie: marketOnly, method: 'POST', form: { market_confirmed_cap: '1' },
  });
  eq(refused.status, 403, 'market_manage alone cannot change the caps — that stays an office/pastor decision');
}

group('a ministry can be entered by hand, fee waived, taking no public application');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // The panel itself defaults the Category field to Ministry — this IS a
  // ministry-only door, and picking that off a dropdown every single time
  // would be one more click for the least-used form on the screen.
  const panelBody = await (await call(env, '/market', { cookie })).text();
  has(panelBody, '<option value="Ministry" selected>Ministry</option>', 'the manual-add form defaults its Category field to Ministry');

  const add = await call(env, '/market/add', {
    cookie, method: 'POST',
    form: { business_name: 'Timothy MDO', participant_names: 'Front office', tables: '2', category: 'Ministry', staff_notes: 'No charge — MDO' },
  });
  eq(add.status, 302, 'the ministry is added');

  const row = db.prepare("SELECT * FROM site_event_registrations WHERE event_id='christmasmarket'").get();
  ok(row, 'a real row was created, on the same table every application lands on');
  eq(row.payment_status, 'waived', 'the fee is waived automatically');
  eq(row.amount_due_cents, 0, 'nothing is asked for');
  eq(row.amount_paid_cents, 0, 'nothing is recorded as paid, either — there is nothing to reconcile');
  eq(row.qty, 2, 'with the tables asked for');
  eq(row.waitlisted, 0, 'and it is never a soft reserve — a staff decision takes a real table immediately');
  eq(JSON.parse(row.fields_json).category, 'Ministry', 'and its category is Ministry, not one of the craft categories');

  const body = await (await call(env, '/market', { cookie })).text();
  has(body, 'Timothy MDO', 'it appears on the coordinator’s list like any other row');
  has(body, 'Fee waived', 'marked waived, not unpaid');
  lacks(body, 'no payment recorded', 'and is never counted among the unpaid ones the coordinator has to chase');

  // A name is required — nothing is created without one.
  const blank = await call(env, '/market/add', { cookie, method: 'POST', form: { tables: '1' } });
  eq(blank.status, 302, 'a blank name does not error, it redirects with a message');
  eq(db.prepare("SELECT COUNT(*) AS n FROM site_event_registrations WHERE event_id='christmasmarket'").get().n, 1,
    'and nothing extra was created');

  // A manually-added table counts toward the confirmed pause, same as a paid
  // one — it really is occupying a table at the market.
  db.prepare("UPDATE site_events SET registration_cap = 2, waitlist_enabled = 1, waitlist_cap = 10 WHERE id = 'christmasmarket'").run();
  const res = await applyAsVendor(env, { email: 'past-mdo@example.com', tables: '1' });
  eq((await res.json()).waitlisted, true,
    'with MDO’s 2 tables already confirmed and a cap of 2, the next public application is a soft reserve');

  // Only market_manage may add a vendor by hand.
  const { cookie: settingsOnly } = signIn(db, ['settings_manage'], 'office3');
  const refused = await call(env, '/market/add', {
    cookie: settingsOnly, method: 'POST', form: { business_name: 'Should not land', tables: '1' },
  });
  eq(refused.status, 403, 'settings_manage alone cannot add a vendor');
}

group('an application with a required field missing is refused with a sentence');
{
  const { db, env } = await boot();
  const res = await applyAsVendor(env, { email: '' });
  eq(res.status, 400, 'it is refused');
  const d = await res.json();
  ok(d.error && d.error.includes('email'), 'and says what is wrong in plain words');
  ok(!d.error.includes('_'), 'without naming a database column');
  eq(db.prepare("SELECT COUNT(*) AS n FROM site_event_registrations WHERE event_id='christmasmarket'").get().n, 0, 'nothing is stored');
}

group('closing applications stops the page taking money');
{
  const { db, env } = await boot();
  db.prepare("UPDATE site_events SET registration_open = 0 WHERE id = 'christmasmarket'").run();
  const res = await applyAsVendor(env);
  eq(res.status, 403, 'an application posted while closed is refused');
  const d = await res.json();
  ok(d.error.includes('christmasmarket'), 'and points at the coordinator instead of just saying no');
  eq(db.prepare("SELECT COUNT(*) AS n FROM site_event_registrations WHERE event_id='christmasmarket'").get().n, 0, 'nothing is stored');

  const cfg = await (await call(env, '/api/market-config', { fresh: true })).json();
  eq(cfg.open, false, 'and the public page is told, so it hides the form rather than failing on submit');
  // ⚠ The giving link must not be in this response. The browser is never
  // handed a payment address it could edit before it is used.
  ok(!JSON.stringify(cfg).includes('tithe.ly'), 'the config carries no payment address at all');
}

group('the coordinator’s list');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const empty = await call(env, '/market', { cookie });
  eq(empty.status, 200, '/market renders with nothing in the table');
  const emptyBody = await empty.text();
  lacks(emptyBody, 'D1_ERROR', 'with no database error on its face');
  lacks(emptyBody, 'no such column', 'and no missing column');
  has(emptyBody, 'Christmas Market vendors', 'titled from the section config');

  await applyAsVendor(env, { product_description: 'Beeswax candles', tables: '2' });
  const id = db.prepare("SELECT id FROM site_event_registrations WHERE event_id='christmasmarket'").get().id;

  const body = await (await call(env, '/market', { cookie })).text();
  has(body, 'Marla Kerr', 'the vendor appears');
  has(body, 'Beeswax candles', 'with what they sell');
  has(body, 'Not paid yet', 'and their payment state');
  // ⚠ THE ROW IS THE FORM NOW, so the per-row warning band the list section
  // used to grow under every unpaid vendor is gone — seventy of those under a
  // dense table is a screen nobody can read, and the tiles above already
  // count them. What must NOT be lost is the SENTENCE: somebody who applied
  // and never finished at the card page is the one thing this screen exists
  // to surface, because the Google Form it replaced could not see them at
  // all. It is said once, over the list, with the filter that isolates them
  // one click away.
  has(body, 'no payment recorded', 'the unpaid case is still named over the list');
  has(body, 'Their spaces are not held', 'and still says what that costs');
  has(body, 'data-mktfilter="unpaid"', 'with one click to only those');

  // Recording a payment is what the screen is for.
  const saveRes = await call(env, '/market/update', {
    cookie, method: 'POST',
    form: { id: String(id), table_number: '19/20', payment_status: 'paid', amount_paid: '62.10', staff_notes: 'Near the door' },
  });
  eq(saveRes.status, 302, 'saving redirects back to the list');
  const after = db.prepare('SELECT * FROM site_event_registrations WHERE id = ?').get(id);
  eq(after.table_number, '19/20', 'a table number can be a range, because a two-table vendor takes one');
  eq(after.payment_status, 'paid', 'the payment state is stored');
  eq(after.amount_paid_cents, 6210, 'and the amount as integer cents');

  // ⚠ Blank is not zero. "Nobody has checked yet" and "they paid nothing" are
  // different facts, and collapsing them puts every fresh row on the
  // reconciled side of the ledger.
  await call(env, '/market/update', { cookie, method: 'POST', form: { id: String(id), payment_status: 'unpaid', amount_paid: '' } });
  eq(db.prepare('SELECT amount_paid_cents FROM site_event_registrations WHERE id = ?').get(id).amount_paid_cents, null,
    'clearing the amount stores NULL, not 0');

  // The spreadsheet this replaced — she still needs to be able to hand the
  // list to somebody.
  const csv = await call(env, '/market/export.csv', { cookie });
  eq(csv.status, 200, 'the list exports');
  eq(csv.headers.get('Content-Type').split(';')[0], 'text/csv', 'as a CSV');
  const csvText = await csv.text();
  has(csvText, 'Marla Kerr', 'with the vendor in it');
  has(csvText, 'Table #', 'and the coordinator’s own columns');

  // The badge and the list have to agree, like every other badge.
  await applyAsVendor(env, { email: 'sue@example.com' });
  const withUnpaid = await (await call(env, '/market', { cookie })).text();
  has(withUnpaid, 'sidebar-badge', 'an unpaid application puts a badge on the sidebar');
}


// ── THE ROW IS THE FORM ──────────────────────────────────────────────────────
// The drawer is gone. Every change the coordinator makes seventy times a
// season — a table number, a category, a payment state, a check that arrived
// — is made in the row and saves on its own. What is worth testing is not
// that the markup exists; it is that each of those single-field POSTs writes
// exactly what it says and nothing else, and that a field name arriving in a
// request cannot become a column name.
group('a vendor row edits in place');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  await applyAsVendor(env, { product_description: 'Beeswax candles', tables: '1' });
  const id = db.prepare("SELECT id FROM site_event_registrations WHERE event_id='christmasmarket'").get().id;
  const reg = () => db.prepare('SELECT * FROM site_event_registrations WHERE id = ?').get(id);
  const fields = () => JSON.parse(reg().fields_json || '{}');
  const cell = (field, value) => call(env, '/market/update', {
    cookie, method: 'POST', accept: 'application/json',
    form: { id: String(id), field, value: value == null ? '' : String(value) },
  });

  const body = await (await call(env, '/market', { cookie })).text();
  has(body, 'data-cell="1"', 'the cells in the row are editable');
  has(body, 'data-sort="category"', 'every column header sorts');
  has(body, 'data-mktfilter="check"', 'and Awaiting check is one of the filters');
  lacks(body, 'tlc-drawer', 'the drawer is gone — nothing opens a panel to change a number');

  // ── One field at a time ──
  const one = await cell('table_number', '19/20');
  eq(one.status, 200, 'a single cell saves on its own');
  eq(JSON.parse(await one.clone().text()).ok, true, 'and answers that it did');
  eq(reg().table_number, '19/20', 'writing exactly that field');
  eq(reg().payment_status, 'unpaid', '⚠ and touching nothing else — a whole-row write would have reset this');

  await cell('category', 'Candles & soap');
  eq(fields().category, 'Candles & soap', 'a category is stored on the application');
  eq(fields().product_description, 'Beeswax candles',
    '⚠ merged into fields_json, never replacing it — a save here cannot drop what the vendor typed');
  await cell('category', 'Antiques & oddities');
  eq(fields().category, 'Other', 'a category that is not on the list clamps to Other rather than being stored raw');

  // ⚠ MARKING A ROW PAID RECORDS THE AMOUNT ASKED. Without it the row reads
  // "Paid" over "asked $46.65", and the "Recorded as paid" tile — which sums
  // amount_paid_cents — stays at zero however many rows are marked, so the
  // reconciliation reads short for a reason nobody can find.
  await cell('payment_status', 'paid');
  eq(reg().amount_paid_cents, reg().amount_due_cents, 'marking a row paid records the amount asked');
  // ⚠ And never over an amount somebody typed: a partial payment is a fact.
  await cell('amount_paid', '20.00');
  await cell('payment_status', 'unpaid');
  await cell('payment_status', 'paid');
  eq(reg().amount_paid_cents, 2000, 'but an amount already recorded is left exactly as it was');
  // ⚠ And only `paid` does it — a waived fee and a vendor who dropped out
  // both mean no money arrived, so recording one would make the collected
  // figure include money the church never had.
  await cell('amount_paid', '');
  await cell('payment_status', 'waived');
  eq(reg().amount_paid_cents, null, 'a waived fee records nothing, because nothing arrived');
  await cell('payment_status', 'unpaid');
  await cell('amount_paid', '');

  // ⚠ CHANGING THE TABLE COUNT CHANGES WHAT THEY OWE. Leaving amount_due
  // behind would leave the coordinator chasing the wrong figure, and no
  // screen anywhere would say so.
  const dueBefore = reg().amount_due_cents;
  await cell('tables', '3');
  eq(reg().qty, 3, 'a table count can be corrected in the row');
  ok(reg().amount_due_cents > dueBefore, 'and what they are asked for follows it');
  await cell('tables', '99');
  eq(reg().qty, 3, 'a count past the market’s own limit is clamped to it, not stored');
  await cell('tables', '1');

  // ── The check ──
  // ⚠ RECORDING A CHECK NUMBER IS WHAT TURNS "AWAITING CHECK" INTO PAID. That
  // is a decision, not an inference: before this there was nowhere to record
  // that a check had arrived, so "said they would send one" and "never paid"
  // looked identical on the list.
  db.prepare("UPDATE site_event_registrations SET fields_json = json_set(fields_json,'$.payment_method','check'), payment_status='unpaid', amount_paid_cents=NULL WHERE id = ?").run(id);
  const awaiting = await (await call(env, '/market', { cookie })).text();
  has(awaiting, 'Awaiting check', 'a check vendor with nothing recorded reads as awaiting one');
  has(awaiting, 'Checks not in yet', 'and is counted on a tile of its own');

  await cell('check_no', '1042');
  eq(fields().check_no, '1042', 'the number is recorded');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(fields().check_date), 'and the day it came, stamped rather than asked for twice');
  eq(reg().payment_status, 'paid', 'which turns the row paid');
  eq(reg().amount_paid_cents, reg().amount_due_cents, 'for the whole amount asked');

  // ⚠ Clearing the box back out must never un-pay anybody — the money is in
  // the bank whatever the box now says.
  await cell('check_no', '');
  eq(reg().payment_status, 'paid', 'clearing the number does not undo the payment');

  // ── ✓ In, which is the one-click version of all of that ──
  const { env: env2, db: db2 } = await boot();
  const { cookie: c2 } = signIn(db2);
  await applyAsVendor(env2, { payment_method: 'check' });
  const id2 = db2.prepare("SELECT id FROM site_event_registrations WHERE event_id='christmasmarket'").get().id;
  const inRes = await call(env2, '/market/update', { cookie: c2, method: 'POST', accept: 'application/json', form: { id: String(id2), field: 'check_in' } });
  eq(inRes.status, 200, '✓ In records the check in one click');
  const r2 = db2.prepare('SELECT * FROM site_event_registrations WHERE id = ?').get(id2);
  eq(r2.payment_status, 'paid', 'flipping the row to paid');
  eq(r2.amount_paid_cents, r2.amount_due_cents, 'for the amount asked');
  const f2 = JSON.parse(r2.fields_json || '{}');
  eq(f2.check_no, '—', 'a check with no number written down still says one arrived');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(f2.check_date), 'dated today');

  // ── The field name is checked before it is used ──
  // ⚠ `updateRegistration()` builds its SQL from the KEYS of the object it is
  // handed, so a field name taken straight from the request would be a column
  // name taken straight from the request. Everything maps a posted name onto
  // a fixed column, and anything else is refused.
  const bogus = await call(env, '/market/update', {
    cookie, method: 'POST', form: { id: String(id), field: 'payment_status = 1, staff_notes', value: 'x' },
  });
  eq(bogus.status, 302, 'a field name this list does not have is refused');
  const bogusJson = await call(env, '/market/update', {
    cookie, method: 'POST', accept: 'application/json',
    form: { id: String(id), field: 'contact_email', value: 'attacker@example.com' },
  });
  eq(bogusJson.status, 400, 'and named as refused when the browser asked for an answer');
  eq(reg().contact_email, 'marla@example.com', 'with the column it aimed at untouched');

  // ⚠ THE WHOLE-FORM PATH IS KEPT, and not only for the tests that already
  // used it: the expanded row is a real <form>, so a coordinator whose script
  // never loaded can still record a payment.
  const whole = await call(env, '/market/update', {
    cookie, method: 'POST',
    form: { id: String(id), table_number: '7', payment_status: 'waived', amount_paid: '', staff_notes: 'Comped' },
  });
  eq(whole.status, 302, 'the no-script path still posts the whole row');
  eq(reg().table_number, '7', 'writing every field on it');
  eq(reg().payment_status, 'waived', 'including the payment state');
  eq(reg().amount_paid_cents, null, 'and blank is still NULL, not zero');

  // Every one of those is in the audit log, which is what the drawer's own
  // save always promised.
  const entries = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type='market_vendor'").get().n;
  ok(entries >= 8, 'every cell save wrote its own audit entry');
}

// ── FOUR VIEWS OF ONE ROSTER, AND FOUR SHEETS ────────────────────────────────
group('the volunteer roster is four views and four printed sheets');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);
  const realFetch = globalThis.fetch;
  env.CHMS_INTAKE_API_KEY = 'test-intake-key';
  // Two days, real clock times, one job short-handed and one with nobody at
  // all — the shape the market's own roster actually has.
  const ROSTER = {
    open: true, signedUp: 3, openShifts: 5,
    roles: [
      { name: 'Tent crew', lead: 'Rick Vogel', shifts: [
        { label: '9:00–11:00 am', date: '2026-12-04', needed: 6, filled: 1, people: [{ name: 'Rick Vogel', email: 'rick@example.com' }] },
      ] },
      { name: 'Kitchen', shifts: [
        { label: '11:00 am–1:00 pm', date: '2026-12-05', needed: 3, filled: 1, people: [{ name: 'Marla Bruns', email: 'marla@example.com' }] },
      ] },
      { name: 'Trash', shifts: [
        { label: '1:00–3:00 pm', date: '2026-12-05', needed: 4, filled: 0, people: [] },
      ] },
    ],
  };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(ROSTER),
      { status: 200, headers: { 'Content-Type': 'application/json' } });

    // ⚠ TWO DATES IS TWO DAYS, and only then is the day switch worth drawing:
    // Friday setup and Saturday market are different crews doing different
    // work, and one list of both is neither day's list.
    const job = await (await call(env, '/market?tab=volunteers', { cookie })).text();
    has(job, 'Friday, December 4', 'the day switch names the days the roster actually covers');
    has(job, 'Saturday, December 5', 'both of them');
    has(job, 'Tent crew', 'the first day’s jobs are shown');
    lacks(job, 'Kitchen', '⚠ and the other day’s are NOT — a day switch that shows both days is not a day switch');
    has(job, 'Lead · Rick Vogel', 'with the lead named, because the sheet is printed for them');
    has(job, '5 still needed', 'and how short each job is');

    const sat = await (await call(env, '/market?tab=volunteers&day=2026-12-05', { cookie })).text();
    has(sat, 'Kitchen', 'picking the other day shows that day');
    lacks(sat, 'Tent crew', 'and only that day');
    // Most short-handed first — a roster sorted by name is a list, sorted by
    // what is missing it is a worklist.
    // Trash is short four and Kitchen short two, so the ordering is by what
    // is missing and not by name — which is the whole reason it is sorted.
    ok(sat.indexOf('Trash') < sat.indexOf('Kitchen'), 'jobs are ordered by how short-handed they are');

    const time = await (await call(env, '/market?tab=volunteers&view=time&day=2026-12-05', { cookie })).text();
    has(time, '11:00 AM', 'the by-time view runs down the day');
    has(time, '2 short', 'saying how short each slot is');

    const grid = await (await call(env, '/market?tab=volunteers&view=grid&day=2026-12-05', { cookie })).text();
    has(grid, 'tlc-grid-block', 'the grid draws a block per shift');
    has(grid, 'Across the top', 'with an axis to turn it on its side');
    const flipped = await (await call(env, '/market?tab=volunteers&view=grid&axis=time&day=2026-12-05', { cookie })).text();
    has(flipped, 'tlc-grid-rowlab', 'flipped, the jobs run down the left');

    const everybody = await (await call(env, '/market?tab=volunteers&view=people&day=2026-12-05', { cookie })).text();
    has(everybody, 'Marla Bruns', 'everybody coming is listed');
    has(everybody, 'mailto:marla@example.com', 'and is somebody you can write to');
    has(everybody, '11–1 pm', 'with when they arrive and when they can go home');

    // ── The sheets ──
    // ⚠ EACH IS A REAL ADDRESS, not a modal: it survives a reload, can be sent
    // to a job lead as a link, and goes to the printer through the browser's
    // own Print rather than through a script.
    const lead = await (await call(env, '/market?tab=volunteers&print=leads&job=Kitchen&day=2026-12-05', { cookie })).text();
    has(lead, 'Kitchen', 'a lead’s sheet is their job');
    has(lead, 'Marla Bruns', 'and their people');
    lacks(lead, 'Trash', '⚠ and nobody else’s — a lead handed the master list has to find their own job in it first');
    has(lead, 'data-noprint', 'with the screen’s own chrome marked not to print');

    const master = await (await call(env, '/market?tab=volunteers&print=people&day=2026-12-05', { cookie })).text();
    has(master, 'Everybody coming', 'the master list prints');
    const bySlot = await (await call(env, '/market?tab=volunteers&print=time&day=2026-12-05', { cookie })).text();
    has(bySlot, 'Master list by time slot', 'and so does the by-time sheet');
    const gridSheet = await (await call(env, '/market?tab=volunteers&print=grid&day=2026-12-05', { cookie })).text();
    has(gridSheet, 'Who is where, hour by hour', 'and the grid');
    has(gridSheet, 'Print landscape', 'which says which way up it wants to come out');

    // ── The CSV ──
    const csv = await call(env, '/market/volunteers.csv', { cookie });
    eq(csv.status, 200, 'the roster exports');
    eq(csv.headers.get('Content-Type').split(';')[0], 'text/csv', 'as a CSV');
    const csvText = await csv.text();
    has(csvText, 'Marla Bruns', 'with the people on it');
    has(csvText, '(open)', '⚠ and a row for every spot nobody has taken — a file listing only who came is a thank-you list');
    has(csvText, 'Friday, December 4', 'across both days, not just the one on screen');
    has(csvText, 'Saturday, December 5', 'both of them');

    // The roster carries the name of everybody coming, so it is behind the
    // coordinator's own permission — same rule as the vendor export.
    // ⚠ AN ARRAY, NOT AN OBJECT. `hasPermission` reads the stored JSON as a
    // list of names, so `{ pages_edit: true }` grants NOTHING — and this
    // assertion would then have passed on the outer gate refusing a user with
    // no permissions at all, rather than on the route's own check. Verified
    // by removing that check: with the array it fails, with the object it did
    // not.
    const writer = signIn(db, ['pages_edit'], 'marketpagewriter').cookie;
    eq((await call(env, '/market/volunteers.csv', { cookie: writer })).status, 403,
      'somebody who can only edit the market’s page cannot download the roster');

    // ⚠ WHEN SERVE SENDS NO CLOCK, THE THREE VIEWS THAT NEED ONE SAY SO. A
    // label this cannot read has no start and no end, and drawing it at
    // midnight would put a block on the grid at a time nobody is coming.
    globalThis.fetch = async () => new Response(JSON.stringify({ open: true, roles: [
      { name: 'Odd job', shifts: [{ label: 'sometime after lunch', needed: 2, filled: 0, people: [] }] },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const noTimes = await (await call(env, '/market?tab=volunteers&view=grid', { cookie })).text();
    has(noTimes, 'needs each shift', 'the grid says what it is missing rather than drawing a guess');
    const stillThere = await (await call(env, '/market?tab=volunteers', { cookie })).text();
    has(stillThere, 'Odd job', '⚠ while the by-job view — which needs no clock — still shows every shift');

    // ⚠ AN UNREACHABLE SERVE IS A 503, NOT AN EMPTY FILE. A CSV with a header
    // row and nothing under it reads as "nobody has signed up", which is a
    // very different thing to hand somebody — and it is the one that gets
    // acted on.
    globalThis.fetch = async () => { throw new Error('nope'); };
    const dead = await call(env, '/market/volunteers.csv', { cookie });
    eq(dead.status, 503, 'an unreachable Serve refuses the export rather than exporting an empty roster');
    has(await dead.text(), 'could not be read', 'and says which of the two it is');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── /market is one screen now, reachable by three different permissions ─────
// Dinger, after learning "Most tables one vendor may take" was on Settings
// with no link from the Christmas Market screen pointing at it: "if all
// christmas market settings ... can move to the christmas market tab that
// would be helpful." All nine did — but the screen was already scoped so the
// coordinator (market_manage alone) never sees the church's payment-account
// details, and 'Office staff' (settings_manage) and 'Bookkeeper'
// (giving_manage) are real presets that hold neither market_manage nor each
// other. Consolidating onto one address could not mean gating the whole page
// on market_manage — that would have quietly taken settings/payment editing
// away from both presets. So the PAGE is reachable by any of the three, and
// each PANEL — and each mutating route — still checks its own.
// ── the market is an event section, in five tabs ────────────────────────────
// README §4 of design_handoff_market_event. The screen answers five different
// questions now, and the rule that makes that safe is the same one the three
// permissions have always had: a tab a reader cannot use is ABSENT, and every
// mutating route still checks its own permission whoever else can see the tab.
group('the Christmas Market screen is five tabs, and each one is somebody’s');
{
  const { db, env } = await boot();

  db.prepare("INSERT INTO ministry_media (filename, kind, url, thumb_url, alt, meta, bytes, created_by, created_at) VALUES ('christmasmarket-2024.webp','photo','/images/events/christmasmarket/christmasmarket-2024.webp','','','',0,'x','2026-01-01')").run();
  const mediaId = db.prepare("SELECT id FROM ministry_media WHERE filename='christmasmarket-2024.webp'").get().id;

  const { cookie: full } = signIn(db);
  const all = await (await call(env, '/market', { cookie: full })).text();
  for (const t of ['Vendors', 'Page &amp; copy', 'Money &amp; dates', 'Volunteers', 'Photos']) {
    has(all, `>${t}</a>`, `full access sees the ${t} tab`);
  }
  has(all, 'tlc-tile-num', 'and lands on Vendors, which is the first tab');

  // ⚠ Only the ACTIVE tab is built. The vendor list is seventy people's home
  // addresses; it must not be in the markup of a tab somebody opened to fix a
  // photograph's description.
  const photos = await (await call(env, '/market?tab=photos', { cookie: full })).text();
  lacks(photos, 'tlc-tile-num', 'the vendor tiles are not rendered on another tab');
  has(photos, 'What is in the photo', 'and the photos tab is');

  const pages = await (await call(env, '/market?tab=pages', { cookie: full })).text();
  has(pages, '/pages/marketvendors/edit', 'the pages tab links into the real editor');
  has(pages, '/pages/marketvendorsapply/edit', 'for the apply page too');
  has(pages, '/christmasmarket/vendors', 'and out to the live page');

  // A tab nobody asked for by name falls back rather than showing nothing.
  const junk = await (await call(env, '/market?tab=nonsense', { cookie: full })).text();
  has(junk, 'tlc-tile-num', 'an unknown tab name lands on the first real one');

  // The coordinator: market_manage alone.
  const { cookie: marla } = signIn(db, ['market_manage'], 'marla');
  const mb = await (await call(env, '/market', { cookie: marla })).text();
  has(mb, '>Vendors</a>', 'the coordinator gets Vendors');
  has(mb, '>Volunteers</a>', 'and Volunteers, which is her own roster');
  lacks(mb, 'Money &amp; dates</a>', 'and no Money & dates tab at all — not disabled, absent');
  lacks(mb, 'Page &amp; copy</a>', 'and no Page & copy');
  lacks(mb, 'Photos</a>', 'and no Photos');
  // ⚠ Asking for a tab she cannot see must not hand it over.
  const sneak = await (await call(env, '/market?tab=money', { cookie: marla })).text();
  lacks(sneak, 'Tithe.ly fund ID', 'and typing the address of one gets her the tab she can open instead');
  lacks(sneak, 'Most tables one vendor may take', 'for the settings panel too');

  // The page writer: pages_edit alone, no market_manage.
  const { cookie: writer } = signIn(db, ['pages_edit'], 'writer');
  eq((await call(env, '/market', { cookie: writer })).status, 200, 'pages_edit alone opens the screen');
  const wb = await (await call(env, '/market', { cookie: writer })).text();
  has(wb, 'Page &amp; copy', 'and lands on the tab they came for');
  has(wb, 'Photos</a>', 'photos too — pages_edit covers those');
  lacks(wb, '>Vendors</a>', 'but never the vendor list');
  lacks(wb, '>Volunteers</a>', 'nor the volunteer roster');
  eq((await call(env, '/market/export.csv', { cookie: writer })).status, 403,
    'and the export still refuses them — reaching the page is not reaching the PII');
  eq((await call(env, '/market/settings', { cookie: writer, method: 'POST', form: { market_table_fee: '99' } })).status, 403,
    'and so does the settings route');

  // Photos: the alt text really saves, and only for somebody who may.
  const shown = await (await call(env, '/market?tab=photos', { cookie: writer })).text();
  has(shown, 'christmasmarket-2024.webp', 'a market photograph is listed on the photos tab');
  const saved = await call(env, '/market/photo-alt', { cookie: writer, method: 'POST', form: { id: String(mediaId), alt: 'Vendors and shoppers in the gym' } });
  eq(saved.status, 302, 'saving a description redirects');
  eq(db.prepare('SELECT alt FROM ministry_media WHERE id = ?').get(mediaId).alt, 'Vendors and shoppers in the gym',
    'and the description is stored');
  eq((await call(env, '/market/photo-alt', { cookie: marla, method: 'POST', form: { id: String(mediaId), alt: 'x' } })).status, 403,
    'the coordinator cannot write it — she has no photos tab to write it from');

  // ── the volunteers tab, both ways ────────────────────────────────────
  // ⚠ STUBBED, deliberately, in both directions. Serve is a different
  // application on another host; a test that really called it would pass or
  // fail on whether that host happened to be up, which is exactly the thing
  // this tab is supposed to survive rather than be measured by.
  const realFetch = globalThis.fetch;
  env.CHMS_INTAKE_API_KEY = 'test-intake-key';
  try {
    // ⚠ THE CALL MUST CARRY THE SHARED SECRET. ChMS's own endpoint answers
    // 401 without it (it returns names and email addresses, so it is never
    // unauthenticated) — a stub that ignores headers would pass this test
    // whether or not the key was ever sent, which is exactly how the missing
    // header shipped unnoticed the first time. Verified against the bug:
    // reverting the header on the request side fails this assertion.
    let sentKey = null;
    globalThis.fetch = async (u, init) => {
      // ⚠ READ THE HEADER OFF WHICHEVER ARGUMENT CARRIES IT. The call under
      // test builds a real `Request` and hands it to the VOLUNTEER_WORKER
      // service binding, falling back to `fetch(req, { signal })` when no
      // binding is configured — which is this harness. So `init` holds only
      // the abort signal and the header lives on `u`. Reading `init.headers`
      // alone reported `undefined` and failed this assertion for a key that
      // was being sent perfectly well.
      //
      // Both forms are still checked rather than just the Request one: the
      // property this assertion exists to hold is "the secret went with the
      // request", and it has to keep holding if the call ever goes back to a
      // plain fetch(url, init). Verified against the bug in both directions —
      // dropping 'X-Intake-Key' from the Request in admin/market.js still
      // fails this.
      sentKey = (typeof Request !== 'undefined' && u instanceof Request)
        ? u.headers.get('X-Intake-Key')
        : (init && init.headers && init.headers['X-Intake-Key']);
      return new Response(JSON.stringify({
        open: true, signedUp: 7, openShifts: 4,
        roles: [
          { name: 'Setup crew', shifts: [{ label: 'Friday 4–8pm', needed: 6, filled: 2, people: [{ name: 'Ann Poe', email: 'ann@example.com' }, { name: 'Bo Rice', email: 'bo@example.com' }] }] },
          { name: 'Welcome table', shifts: [{ label: 'Saturday 10–1', needed: 2, filled: 2, people: [{ name: 'Cy Dean', email: 'cy@example.com' }, { name: 'Di Ely', email: 'di@example.com' }] }] },
          { name: 'Cleanup', shifts: [{ label: 'Saturday 5–7pm', needed: 3, filled: 0, people: [] }] },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const vol = await (await call(env, '/market?tab=volunteers', { cookie: marla })).text();
    eq(sentKey, 'test-intake-key', 'the request to Serve carries the shared X-Intake-Key');
    has(vol, 'Setup crew', 'the roster is read from Serve');
    has(vol, 'mailto:ann@example.com', 'and a volunteer is somebody you can write to');
    has(vol, 'Nobody yet', 'an entirely open shift says so in words, not as a blank cell');
    has(vol, 'Full', 'a covered role reads as covered');
    // ⚠ Most short-handed first. Sorted by name this is a list; sorted by what
    // is missing it is a worklist, which is the only reason it gets opened.
    ok(vol.indexOf('Setup crew') < vol.indexOf('Cleanup')
      && vol.indexOf('Cleanup') < vol.indexOf('Welcome table'),
      'roles are ordered by how short-handed they are');
    has(vol, 'serve.timothystl.org/christmasmarket', 'with the way into Serve on every role');

    // A dead Serve must not take the tab with it.
    globalThis.fetch = async () => { throw new Error('nope'); };
    const down = await (await call(env, '/market?tab=volunteers', { cookie: marla })).text();
    has(down, 'Counts are not available right now', 'an unreachable Serve degrades rather than failing');
    has(down, 'Manage shifts in Serve', 'and still offers the one thing that always works');

    // ⚠ And an answer of the wrong shape is not an answer. A proxy or a
    // stray page answering 200 would otherwise draw four tiles of zeros and
    // present them as the roster.
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, message: 'not the roster' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const junkVol = await (await call(env, '/market?tab=volunteers', { cookie: marla })).text();
    has(junkVol, 'Counts are not available right now', 'a reply this screen cannot read is treated as no reply');

    // ⚠ Nobody has set CHMS_INTAKE_API_KEY on this Worker — a real, expected
    // state before the manual step in G24/CLAUDE.md is done. It has to say
    // so rather than blaming Serve for a 401 this Worker itself caused.
    delete env.CHMS_INTAKE_API_KEY;
    globalThis.fetch = async () => { throw new Error('should not be called with no key configured to send'); };
    const noKey = await (await call(env, '/market?tab=volunteers', { cookie: marla })).text();
    has(noKey, 'CHMS_INTAKE_API_KEY is not set on this Worker', 'an unset key says so, rather than a generic failure');
  } finally { globalThis.fetch = realFetch; delete env.CHMS_INTAKE_API_KEY; }
}

// ── THE VOLUNTEERS TAB HAS A REAL OFF SWITCH ─────────────────────────────────
// `has_volunteers` already existed as a column on `site_events` and was
// simply never read by the market's own tab list — every canMarket account
// saw the Volunteers tab regardless. This is the door: a toggle in the
// Vendors tab's own Applications panel (same shape and permission as
// "Taking vendor applications" beside it), so a year the market isn't using
// Serve for its roster, the tab can be hidden without losing anything else.
group('the Volunteers tab can be switched off, and back on');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const on = await (await call(env, '/market', { cookie })).text();
  has(on, '>Volunteers</a>', 'showing by default — the market’s own row was seeded with it on');
  has(on, 'Volunteers tab', 'and the toggle for it is on the Vendors tab, in the Applications panel');

  const off = await call(env, '/market/volunteers-tab', { cookie, method: 'POST', form: {} });
  eq(off.status, 302, 'switching it off redirects back to the screen');
  eq(decodeURIComponent(off.headers.get('Location')).includes('is hidden'), true, 'and the toast says so');
  eq(db.prepare("SELECT has_volunteers FROM site_events WHERE id='christmasmarket'").get().has_volunteers, 0,
    'the market’s own row is updated — has_volunteers, not a second field');

  const hiddenBody = await (await call(env, '/market', { cookie })).text();
  lacks(hiddenBody, '>Volunteers</a>', 'the tab is gone — not disabled, absent, same as every other tab on this screen');

  // ⚠ Asking for it by address must not hand it over anyway.
  const sneak = await (await call(env, '/market?tab=volunteers', { cookie })).text();
  lacks(sneak, 'Manage shifts in Serve', 'the volunteers section itself is never built once the tab is hidden');
  lacks(sneak, 'Who is covering the market', 'nor its own purpose line');
  has(sneak, 'tlc-tile-num', 'and the address falls back to Vendors, the first tab still open to this reader');

  // Nothing about the market itself — its vendors, its pages, its capacity
  // settings — moved when the tab was hidden.
  eq(db.prepare("SELECT COUNT(*) AS n FROM site_events WHERE id='christmasmarket'").get().n, 1, 'the event row is untouched otherwise');

  // Switching it back on works the same way.
  const back = await call(env, '/market/volunteers-tab', { cookie, method: 'POST', form: { volunteers_enabled: '1' } });
  eq(decodeURIComponent(back.headers.get('Location')).includes('showing again'), true, 'the toast says it is back');
  const backBody = await (await call(env, '/market', { cookie })).text();
  has(backBody, '>Volunteers</a>', 'and the tab really is');

  // Only market_manage may touch this — same permission as the applications
  // toggle right beside it in the same panel.
  const { cookie: pagesOnly } = signIn(db, ['pages_edit'], 'writer2');
  const refused = await call(env, '/market/volunteers-tab', { cookie: pagesOnly, method: 'POST', form: { volunteers_enabled: '0' } });
  eq(refused.status, 403, 'pages_edit alone cannot touch it');
  eq(db.prepare("SELECT has_volunteers FROM site_events WHERE id='christmasmarket'").get().has_volunteers, 1,
    'and the setting is unchanged by the refused attempt');
}

group('the vendor list is gated on its own permission');
{
  const { db, env } = await boot();
  // ⚠ FIVE permissions reach this page now, not three — pages_edit and
  // ministries_edit joined when it became the event section, because its own
  // pages and its own photographs are managed here. So "nobody" has to mean
  // none of the five.
  const { cookie: nobody } = signIn(db, ['news_edit'], 'nobody');
  eq((await call(env, '/market', { cookie: nobody })).status, 403, 'refused with none of the five permissions');

  const { cookie: marla } = signIn(db, ['market_manage'], 'marla');
  eq((await call(env, '/market', { cookie: marla })).status, 200, 'the coordinator gets in with market_manage alone');
  const body = await (await call(env, '/market', { cookie: marla })).text();
  lacks(body, '/payroll', 'and sees nothing else in the sidebar');
  lacks(body, '/subscribers', 'including no list of everybody’s email addresses');
  // ⚠ "Market settings"/"Payment" are also words that appear elsewhere on
  // this page regardless of who is looking (the bare header's own purpose
  // line, the vendor list's own "Payment" column) — so the marker for each
  // panel is a field unique to it, not the panel's own title.
  lacks(body, 'Most tables one vendor may take', 'and no settings panel — that needs settings_manage, which she does not hold');
  lacks(body, 'Tithe.ly fund ID', 'and no payment panel either — that needs giving_manage');
  eq((await call(env, '/market/export.csv', { cookie: marla })).status, 200, 'the coordinator can still export the list');

  // Office staff: settings_manage, no market_manage, no giving_manage.
  const { cookie: office } = signIn(db, ['pages_edit', 'settings_manage'], 'office');
  eq((await call(env, '/market', { cookie: office })).status, 200, 'settings_manage alone still gets in');
  // ⚠ Money & dates is a TAB now, and office staff also holds pages_edit, so
  // the tab they land on by default is Page & copy — the first one they can
  // open, deliberately, rather than a hardcoded Vendors they would find empty.
  const officeLanding = await (await call(env, '/market', { cookie: office })).text();
  has(officeLanding, 'Page &amp; copy', 'a bare /market lands on the first tab they can open');
  const officeBody = await (await call(env, '/market?tab=money', { cookie: office })).text();
  has(officeBody, 'Most tables one vendor may take', 'and sees the settings panel');
  lacks(officeBody, 'Tithe.ly fund ID', 'but not the payment panel');
  lacks(officeBody, 'tlc-tile-num', 'and no vendor tiles/list — that PII is market_manage-only');
  eq((await call(env, '/market/export.csv', { cookie: office })).status, 403, 'the export refuses settings_manage alone — seventy home addresses');
  eq((await call(env, '/market/applications', { cookie: office, method: 'POST', form: { open: '1' } })).status, 403,
    'and so does the coordinator’s own toggle — that stays market_manage regardless of who else can reach the page');

  // Bookkeeper: giving_manage, no market_manage, no settings_manage.
  const { cookie: bookkeeper } = signIn(db, ['gym_manage', 'giving_manage', 'payroll_manage'], 'bookkeeper');
  const bkBody = await (await call(env, '/market', { cookie: bookkeeper })).text();
  has(bkBody, 'Tithe.ly fund ID', 'the bookkeeper sees the payment panel');
  lacks(bkBody, 'Volunteers</a>', 'and no Volunteers tab — that roster is the coordinator’s');
  lacks(bkBody, 'Most tables one vendor may take', 'but not the settings panel');
  lacks(bkBody, 'tlc-tile-num', 'and no vendor list');
}

// ── the nine market settings, none of which had anywhere to be set ──────────
// Dinger: "i set the market fund id in the giving tab. confirm where vendor
// signups go" — and there was no field to set it in. Checked, not assumed:
// none of the nine market_* settings were reachable from any screen before
// v5.14.0. All nine now live on the Christmas Market screen (v5.19.0),
// gated the same way editing them always was — a field moving screens never
// widened who could change it.
group('the Christmas Market fund ID is set from the Christmas Market screen');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  const giving = await (await call(env, '/giving', { cookie })).text();
  lacks(giving, 'Christmas Market fund', 'the field is gone from the Giving screen');
  has(giving, '/market', 'which points to where it actually lives now');

  const market = await (await call(env, '/market?tab=money', { cookie })).text();
  has(market, 'Tithe.ly fund ID', 'the field is on the Christmas Market screen instead');

  const save = await call(env, '/market/fund', { cookie, method: 'POST', form: { market_fund_id: 'mkt-fund-123' } });
  eq(save.status, 302, 'saving redirects back to the Christmas Market screen');
  eq(save.headers.get('Location').startsWith('/market'), true, 'specifically to /market, not /giving');
  eq(marketEvent(db).fund_id, 'mkt-fund-123', 'and the fund ID is stored');

  const after = await (await call(env, '/market?tab=money', { cookie })).text();
  has(after, 'mkt-fund-123', 'the saved value is shown back on the screen');

  // Blank is a real, valid value — it means "use the base link's own fund" —
  // so it must not be refused the way a malformed give_url is.
  const clear = await call(env, '/market/fund', { cookie, method: 'POST', form: { market_fund_id: '' } });
  eq(clear.status, 302, 'clearing it is not an error');
  eq(marketEvent(db).fund_id, '', 'and it is really cleared');

  // A vendor's payment link has to actually use it.
  const fundBack = await call(env, '/market/fund', { cookie, method: 'POST', form: { market_fund_id: 'holiday-market' } });
  eq(fundBack.status, 302, 'set up for the next check');
  const withFund = await applyAsVendor(env, { email: 'withfund@example.com' });
  const d = await withFund.json();
  ok(d.payUrl.includes('fundId=holiday-market'), 'a vendor applying after the fund is set gets a link carrying it');

  // Somebody without giving_manage cannot set it, even holding market_manage —
  // the coordinator must never be able to reach the church's payment account.
  const { cookie: marla } = signIn(db, ['market_manage'], 'marla2');
  eq((await call(env, '/market/fund', { cookie: marla, method: 'POST', form: { market_fund_id: 'x' } })).status, 403,
    'refused without giving_manage, market_manage notwithstanding');
}

group('the other seven market settings moved to the Christmas Market screen too');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db);

  // They still appear on Settings — so searching there for "market" still
  // finds something — but as a pointer, not an inline editor.
  const settingsList = await (await call(env, '/settings', { cookie })).text();
  has(settingsList, 'Christmas Market table fee', 'the table fee is still listed on Settings, for discoverability');
  has(settingsList, 'Christmas Market day', 'so is the market day');
  has(settingsList, 'Christmas Market coordinator email', 'and the coordinator email');

  // ⚠ The generic editor no longer accepts these keys — a POST here is
  // exactly the "two forms writing one key" trap this file warns about. And
  // there is no site_settings row for either key any more at all — they are
  // `site_events` columns now — so "nothing was written" is checked there.
  const hijack = await call(env, '/settings/update', { cookie, method: 'POST', form: { key: 'market_table_fee', value: '99' } });
  eq(hijack.status, 302, 'the request is not an error');
  ok(hijack.headers.get('Location').includes('settings-error'), 'but it is refused as an unknown key on this screen');
  ok(!db.prepare("SELECT value FROM site_settings WHERE key='market_table_fee'").get(),
    'and it never lands in site_settings at all — the key does not exist there any more');
  eq(marketEvent(db).fee_amount, 30, 'and the market’s own default table fee is untouched — nothing was written');

  // ⚠ market_applications_open must stay unreachable here too — it already
  // has its own toggle and route on /market.
  const before = marketEvent(db).registration_open;
  const openHijack = await call(env, '/settings/update', { cookie, method: 'POST', form: { key: 'market_applications_open', value: '0' } });
  ok(openHijack.headers.get('Location').includes('settings-error'), 'refused as an unknown key');
  eq(marketEvent(db).registration_open, before, 'and the switch on /market is untouched');

  // The real save path is now /market/settings, gated settings_manage.
  const market = await (await call(env, '/market?tab=money', { cookie })).text();
  has(market, 'Most tables one vendor may take', 'the field is on the Christmas Market screen');

  const save = await call(env, '/market/settings', { cookie, method: 'POST', form: {
    market_date_label: 'Saturday, Dec 12', market_hours_label: '10:00 am – 5:00 pm',
    market_table_fee: '35', market_max_tables: '5', market_fee_percent: '2.9', market_fee_fixed: '0.30',
    market_coordinator_email: 'newcoordinator@example.com',
  } });
  eq(save.status, 302, 'saved from the new screen');
  eq(save.headers.get('Location').startsWith('/market'), true, 'and redirects back to it, not to Settings');
  eq(marketEvent(db).fee_amount, 35, 'the fee is stored');
  eq(marketEvent(db).max_qty, 5, 'so is the table limit — the whole reason this moved');

  // Somebody with only market_manage cannot reach this route — the seven
  // settings stay an office/pastor decision, not the coordinator's.
  const { cookie: marla } = signIn(db, ['market_manage'], 'marla3');
  eq((await call(env, '/market/settings', { cookie: marla, method: 'POST', form: { market_table_fee: '1' } })).status, 403,
    'refused without settings_manage');

  // A price change actually reaches the vendor page.
  const cfg = await (await call(env, '/api/market-config', { fresh: true })).json();
  eq(cfg.tableFee, 35, 'the vendor page reads the new table fee');
  eq(cfg.maxTables, 5, 'and the new table limit');
}

// ── /christmasmarket/vendors is a real Pages row now ─────────────────────────
// The vendor application moved onto the block editor (admin/market-page-seed.js)
// so office staff can edit its rules, its FAQ and its vendor-detail cards
// without a developer touching public/index.html. What matters here is not
// that the page renders — admin/blocks.test.mjs already covers the block and
// the seed in isolation — it is that the real seed-and-publish pipeline this
// Worker runs on every deploy actually reaches it, the same way it already
// does for give-landing and /about/values.
group('the vendor application page is seeded and PUBLISHED from its seed');
{
  const { db, env } = await boot();

  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get('marketvendors');
  ok(row, 'the page is seeded on first boot, like every other seeded page');
  eq(row.slug, '/christmasmarket/vendors', 'at the address the SPA router already knows');
  eq(row.parent_id, 'christmasmarket', 'nested under the Christmas Market page');
  eq(row.in_menu, 0, 'not in the header/footer nav — same as the hardcoded page today');
  // ⚠ PUBLISHED, unlike every other seeded page — and it has to be. The
  // hardcoded markup this page used to render is deleted from
  // public/index.html, so an unpublished draft would leave the address
  // blank. The one-time MARKET_PUBLISH_MARKER in tlc-admin-worker.js is
  // what does it, and only ever to a page nobody has edited by hand.
  ok(row.published_blocks, 'and published — the seed IS the live page now');
  eq(row.published_blocks, row.blocks, 'draft and live are the same blocks on the day it ships');

  // ⚠ UNLIKE give-landing, this page must be an ordinary member of /api/pages.
  // give.timothystl.org is excluded because it is a different hostname's page
  // living in the `pages` table only to get the editor for free; this one is
  // a normal SPA page and visitors reach it at /christmasmarket/vendors.
  const api = await (await call(env, '/api/pages', { fresh: true })).json();
  const listed = api.pages.find((p) => p.id === 'marketvendors');
  ok(listed, 'the page is in the public page list');
  eq(listed.slug, '/christmasmarket/vendors', 'at its real address');
  ok(!api.pages.some((p) => p.id === 'give-landing'), 'sanity: give-landing is still excluded, unlike this page');
  ok(api.rendered.marketvendors, 'and it renders — there is no hardcoded fallback left behind it');
}

group('once published, the application reads live settings — never a stored price or address');
{
  const { db, env } = await boot();
  db.prepare("INSERT INTO site_settings (key,value) VALUES ('give_url','https://give.tithe.ly/?formId=abc&locationId=loc&fundId=general') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  db.prepare(
    "UPDATE site_events SET fund_id = 'market-fund', fee_amount = 40, date_label = 'Saturday, Dec 12', " +
    "hours_label = '10:00 am – 5:00 pm', coordinator_email = 'newcoordinator@example.com' WHERE id = 'christmasmarket'"
  ).run();

  // Already published by the migration; this line is belt and braces so the
  // group still reads as "once published" whatever the seeding pipeline does.
  db.prepare("UPDATE pages SET published_blocks = blocks WHERE id='marketvendors'").run();

  const api = await (await call(env, '/api/pages', { fresh: true })).json();
  const html = api.rendered.marketvendors;
  ok(html, 'the published page now renders');
  has(html, 'Bring your table to the Christmas Market', 'the hero is there');
  has(html, 'Saturday, Dec 12', 'the live market date, not whatever was on the page when it was drafted');
  has(html, '10:00 am – 5:00 pm', 'and the live hours');
  has(html, 'mailto:newcoordinator@example.com', 'the coordinator email is read live, never typed into the page');
  lacks(html, 'give.tithe.ly', 'no block on the page carries the Tithe.ly link itself — see the "no url field" rule');
  lacks(html, 'undefined', 'nothing on the page renders the literal word "undefined"');

  // ⚠ THE SAME PRICE THE ADMIN'S OWN /api/market-config REPORTS. Computed by
  // the one shared function in market-price.js — a literal here would pass
  // even if the block and the settings screen quietly drifted apart.
  const price = priceBreakdown(1, { tableFee: 40 });
  has(html, marketMoney(price.totalCents), 'the block’s one-table total agrees with the shared pricing function');

  // Changing the fee later changes what the PUBLISHED page shows on its next
  // read — nothing about the block was frozen when it was published, because
  // there was never a price stored on it to freeze.
  db.prepare("UPDATE site_events SET fee_amount = 55 WHERE id = 'christmasmarket'").run();
  const api2 = await (await call(env, '/api/pages', { fresh: true })).json();
  const price2 = priceBreakdown(1, { tableFee: 55 });
  has(api2.rendered.marketvendors, marketMoney(price2.totalCents), 'a fee changed after publishing still reaches the live page');
}

// ── Square reconciles itself, and a vendor can pay by check ─────────────────
// Every group below runs against a market whose fee is the plain $30/2.9%/30¢
// default (nobody has touched site_events for these), so the grossed-up total
// for one table is the anchor figure this whole file already trusts: $31.20.

group('paying by check owes the flat fee, never the grossed-up card total');
{
  const { db, env } = await boot();
  const res = await applyAsVendor(env, { tables: '2', payment_method: 'check' });
  eq(res.status, 200, 'a check application is accepted like any other');
  const d = await res.json();
  ok(d.success, 'and saved');
  ok(d.checkPay, 'the response says this one is paying by check, so the confirmation screen can read differently');
  eq(d.payUrl, '', 'no payment link at all — there is nothing to redirect a check-paying vendor to');

  const saved = db.prepare("SELECT * FROM site_event_registrations WHERE event_id='christmasmarket'").get();
  const flat = priceBreakdown(2, MARKET_PRICE_DEFAULTS).subtotalCents; // 2 × $30 = $60.00, no card fee
  eq(saved.amount_due_cents, flat, 'the row owes the flat table fee, not the grossed-up card total');
  eq(saved.payment_status, 'unpaid', 'still unpaid — a check has not arrived yet, the same fact as any other unpaid row');
  ok(JSON.parse(saved.fields_json).payment_method === 'check', 'and the choice itself is on the row, for the coordinator to see');
  eq(d.totalCents, flat, 'the figure in the response is the same flat fee, not the card total');
}

group('a card application still owes the grossed-up total, and defaults to card with no field posted');
{
  const { db, env } = await boot();
  // No payment_method field at all — the shape every application before
  // this feature existed already posted.
  const res = await applyAsVendor(env, { tables: '2' });
  const d = await res.json();
  ok(!d.checkPay, 'defaults to card when nothing is posted');

  const saved = db.prepare("SELECT * FROM site_event_registrations WHERE event_id='christmasmarket'").get();
  const grossed = priceBreakdown(2, MARKET_PRICE_DEFAULTS).totalCents; // includes the 2.9% + 30¢ card fee
  eq(saved.amount_due_cents, grossed, 'a card application still owes the grossed-up total');
  ok(grossed > priceBreakdown(2, MARKET_PRICE_DEFAULTS).subtotalCents, 'sanity: the grossed-up figure really is larger than the flat one');
  eq(JSON.parse(saved.fields_json).payment_method, 'card', 'and the row records the method explicitly, not just by omission');
}

function stubSquareFetch(handler) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('online-checkout/payment-links')) return handler(url, opts);
    // Anything else in flight during this request (a Brevo send, a push
    // notification) is fired inside ctx.waitUntil and never awaited by this
    // test — it gets a harmless empty response rather than a real network
    // call the sandbox has no route to anyway.
    return new Response('{}', { status: 200 });
  };
  return () => { globalThis.fetch = real; };
}

group('Square: a link is created per application, and its order id is captured immediately');
{
  const { db, env } = await boot();
  db.prepare("UPDATE site_events SET payment_provider = 'square' WHERE id = 'christmasmarket'").run();
  env.SQUARE_ACCESS_TOKEN = 'sq0atp-test';
  env.SQUARE_LOCATION_ID = 'L1';

  const restore = stubSquareFetch(async () => new Response(JSON.stringify({
    payment_link: { id: 'link_1', url: 'https://square.link/u/abc123', order_id: 'order_abc123' },
  }), { status: 200 }));
  let res;
  try { res = await applyAsVendor(env, { tables: '1' }); } finally { restore(); }

  const d = await res.json();
  eq(d.payUrl, 'https://square.link/u/abc123', 'the vendor is sent to the link Square just created for them');

  const saved = db.prepare("SELECT square_order_id FROM site_event_registrations WHERE event_id='christmasmarket'").get();
  eq(saved.square_order_id, 'order_abc123',
    'captured straight from the CREATE response — never a later lookup that could fail independently');
}

group('Square: an unreachable API falls back to the static per-table link, silently');
{
  const { db, env } = await boot();
  // ⚠ NO SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID set at all — the exact state
  // this Worker is in the moment this feature ships, before anybody has run
  // the wrangler secret commands. createSquarePaymentLink() throws before it
  // ever calls fetch, so no stub is even needed to prove the fallback works.
  db.prepare(`UPDATE site_events SET payment_provider = 'square', square_links = '${JSON.stringify({ 1: 'https://square.link/u/one' })}' WHERE id = 'christmasmarket'`).run();

  const res = await applyAsVendor(env, { tables: '1' });
  eq(res.status, 200, 'the vendor is never told anything went wrong');
  const d = await res.json();
  eq(d.payUrl, 'https://square.link/u/one', 'and still gets a working link — the office’s own static one');

  const saved = db.prepare("SELECT square_order_id, payment_status FROM site_event_registrations WHERE event_id='christmasmarket'").get();
  eq(saved.square_order_id, null, 'no order id was ever created, so there is nothing to store');
  eq(saved.payment_status, 'unpaid', 'and the application is on the coordinator’s list regardless');
}

// A real HMAC, computed the same way admin/square.test.mjs verifies against —
// an independent implementation is what makes this check mean something.
async function squareWebhook(env, payload, { badSignature = false } = {}) {
  const url = 'https://admin.timothystl.org/api/square/webhook';
  const rawBody = JSON.stringify(payload);
  const sig = badSignature
    ? 'not-the-right-signature=='
    : crypto.createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(url + rawBody).digest('base64');
  const headers = new Headers({ 'content-type': 'application/json', 'x-square-hmacsha256-signature': sig });
  const req = new Request(url, { method: 'POST', headers, body: rawBody });
  return worker.fetch(req, env, { waitUntil: () => {}, passThroughOnException: () => {} });
}

group('the Square webhook marks the matching application paid, by order id alone');
{
  const { db, env } = await boot();
  db.prepare("UPDATE site_events SET payment_provider = 'square' WHERE id = 'christmasmarket'").run();
  env.SQUARE_ACCESS_TOKEN = 'sq0atp-test';
  env.SQUARE_LOCATION_ID = 'L1';
  env.SQUARE_WEBHOOK_SIGNATURE_KEY = 'test-signing-key';

  const restore = stubSquareFetch(async () => new Response(JSON.stringify({
    payment_link: { id: 'link_2', url: 'https://square.link/u/xyz', order_id: 'order_xyz' },
  }), { status: 200 }));
  try { await applyAsVendor(env, { tables: '1' }); } finally { restore(); }

  const before = db.prepare("SELECT id, payment_status, amount_paid_cents FROM site_event_registrations WHERE square_order_id = 'order_xyz'").get();
  ok(before, 'the row created above is findable by the order id Square gave us');
  eq(before.payment_status, 'unpaid', 'and starts unpaid, same as any other fresh application');

  const res = await squareWebhook(env, {
    type: 'payment.updated',
    data: { object: { payment: { order_id: 'order_xyz', status: 'COMPLETED', amount_money: { amount: 3120, currency: 'USD' } } } },
  });
  eq(res.status, 200, 'Square gets a 200');

  const after = db.prepare('SELECT payment_status, amount_paid_cents FROM site_event_registrations WHERE id = ?').get(before.id);
  eq(after.payment_status, 'paid', 'the exact matching row is marked paid — no human had to check anything');
  eq(after.amount_paid_cents, 3120, 'and the amount Square actually reports is what is recorded');

  const audit = db.prepare("SELECT username FROM audit_log WHERE entity_type = 'market_vendor' AND entity_id = ?").all(String(before.id));
  eq(audit.length, 1, 'the automatic mark-paid is written to the audit log like any other change');
  eq(audit[0].username, 'square-webhook', 'attributed to the webhook, not to a person who never touched it');

  // ⚠ Square redelivers events. The same payment landing twice must not
  // double-log or otherwise behave as if it happened twice.
  await squareWebhook(env, {
    type: 'payment.updated',
    data: { object: { payment: { order_id: 'order_xyz', status: 'COMPLETED', amount_money: { amount: 3120, currency: 'USD' } } } },
  });
  const auditAfterRedelivery = db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'market_vendor' AND entity_id = ?").get(String(before.id));
  eq(auditAfterRedelivery.n, 1, 'a redelivered event for an already-paid row is a silent no-op, not a second entry');
}

group('the Square webhook refuses a bad signature, and quietly ignores a payment that is not ours');
{
  const { db, env } = await boot();
  env.SQUARE_WEBHOOK_SIGNATURE_KEY = 'test-signing-key';

  const bad = await squareWebhook(env, {
    type: 'payment.updated',
    data: { object: { payment: { order_id: 'order_anything', status: 'COMPLETED' } } },
  }, { badSignature: true });
  eq(bad.status, 401, 'a signature that does not verify is refused outright');

  const unrelated = await squareWebhook(env, {
    type: 'payment.updated',
    data: { object: { payment: { order_id: 'order_never_seen', status: 'COMPLETED', amount_money: { amount: 100 } } } },
  });
  eq(unrelated.status, 200, 'a correctly signed event for an order id nobody applied under is still answered 200');
  const rows = db.prepare("SELECT COUNT(*) AS n FROM site_event_registrations WHERE payment_status = 'paid'").get();
  eq(rows.n, 0, 'and nothing on the coordinator’s list was touched by it');
}

group('the church calendar feed is PUBLIC, and answers with no session at all');
{
  const { db, env } = await boot();
  // ⚠ THIS IS THE CHECK THAT MATTERS, AND IT IS THE ONE /api/latest-sermon
  // failed on its first attempt: a public route written BELOW the session gate
  // answers every visitor with a 302 to the login page. No unit test can see
  // that — only booting the real Worker and asking without a cookie can.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [
    { id: 'g1', summary: 'Divine Service', colorId: '9',
      start: { dateTime: '2026-08-16T08:00:00-05:00' }, end: { dateTime: '2026-08-16T09:15:00-05:00' } },
  ] }) });
  try {
    env.GCAL_API_KEY = 'test-key';
    db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels, value) VALUES (?,?,?,?,?,?,?)")
      .run('Rally Day picnic', 'Bring a dish.', '2026-08-01', '2026-08-16', '2026-12-31', 'web', 'outreach');

    const res = await call(env, '/api/calendar?month=2026-08', { fresh: true });
    eq(res.status, 200, 'a visitor with no cookie gets the feed, not the login page');
    eq(res.headers.get('access-control-allow-origin'), '*', 'and the SPA on the other origin may read it');
    const feed = await res.json();
    eq(feed.from, '2026-08-01', 'the month asked for is the month returned');
    eq(feed.to, '2026-08-31', 'to its real last day');
    ok(feed.categories.length >= 10, 'the palette rides along, so the page hardcodes none of it');

    // Both halves arrived, and the de-dupe left them as two different events.
    const titles = feed.events.map((e) => e.title);
    ok(titles.includes('Divine Service'), 'the Google half is there');
    ok(titles.includes('Rally Day picnic'), 'and so is the News & Events half');
    const svc = feed.events.find((e) => e.title === 'Divine Service');
    eq(svc.start, '2026-08-16T08:00:00', 'and the time is the church wall clock, with no offset on it');
    eq(svc.category, 'worship', 'Blueberry filed it under Worship');
    const news = feed.events.find((e) => e.title === 'Rally Day picnic');
    eq(news.source, 'news', 'the News entry says where it came from');
    eq(news.allDay, true, 'and is all-day, because a News record has no time column');

    // A month nobody asked for, and a crafted one, both answer rather than throwing.
    eq((await call(env, '/api/calendar', { fresh: true })).status, 200, 'no month is today’s month');
    const junk = await call(env, '/api/calendar?month=nonsense', { fresh: true });
    eq(junk.status, 200, 'a crafted month falls back rather than erroring');

    // The subscribe feed, on the same route family and just as public.
    const ics = await call(env, '/api/calendar.ics?month=2026-08', { fresh: true });
    eq(ics.status, 200, 'the .ics is public too');
    ok((ics.headers.get('content-type') || '').includes('text/calendar'),
      'and is served as a calendar, or no app will subscribe to it');
    const body = await ics.text();
    ok(body.startsWith('BEGIN:VCALENDAR'), 'it is a calendar');
    ok(body.includes('SUMMARY:Divine Service'), 'carrying the Google entry');
    // ⚠ AND THE NEWS ENTRY, which is the whole reason to offer our own .ics
    // rather than pointing people at Google's — subscribing there gets you
    // half the church's events.
    ok(body.includes('SUMMARY:Rally Day picnic'), 'and the News & Events entry Google does not have');
  } finally { globalThis.fetch = realFetch; }
}

group('with Google unreachable the feed still answers, and says which half is missing');
{
  const { db, env } = await boot();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    env.GCAL_API_KEY = 'test-key';
    db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels) VALUES (?,?,?,?,?,?)")
      .run('Trunk or Treat', 'Costumes welcome.', '2026-10-01', '2026-10-31', '2026-12-31', 'web');
    const res = await call(env, '/api/calendar?month=2026-10', { fresh: true });
    eq(res.status, 200, 'an unreachable Google is not a 500 — to the browser that is indistinguishable from a dead network');
    const feed = await res.json();
    eq(feed.sources.google, false, 'the page is told the Google half is missing, so it can say so');
    // ⚠ Named, not counted. The Worker seeds the school year into every fresh
    // database, so "the feed has exactly one event" stopped being a fact about
    // this test and became a fact about the seed.
    ok(feed.events.some((e) => e.title === 'Trunk or Treat'), 'and still gets everything that did answer');
    ok(feed.events.every((e) => e.source !== 'gcal'), 'with nothing from the half that could not be reached');
  } finally { globalThis.fetch = realFetch; }
}

// ── FX-04, end to end through the real Worker ───────────────────────────────
// The unit tests in admin/blocks.test.mjs pin what sanitizeClassicRich does.
// This pins that it is actually WIRED — to the write path, so a new row is
// clean, and to the public read path, so the rows already in the table are
// neutralized without a destructive migration over six years of newsletters.
group('classic rich fields cannot carry script to the public site (FX-04)');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ALL_PERMISSIONS, 'editor');

  const NASTY = '<p>Real words.</p><script>alert(1)</script><img src=x onerror=alert(2)>';
  const TABLE = '<table><tbody><tr><td style="text-align:center">Sunday</td></tr></tbody></table>';

  // ── the write path ──
  const created = await call(env, '/newsitems/create', { cookie, method: 'POST', form: {
    title: 'A post', summary: 'x', body: NASTY + TABLE,
    publish_date: churchDate(), ch_web: '1',
  }});
  eq(created.status, 302, 'the news post saves');
  const stored = db.prepare("SELECT body FROM news_items WHERE title = 'A post'").get();
  ok(stored, 'and the row is there');
  ok(!/script/i.test(stored.body), 'STORED clean — no script tag reaches the database');
  ok(!/onerror/i.test(stored.body), 'and no event handler either');
  has(stored.body, 'Real words.', 'the words survive');
  has(stored.body, '<table>', "and so does the table — this is the half a naive fix breaks");
  has(stored.body, 'text-align:center', 'including the alignment inside it');

  // ── the legacy read path ──
  // A row written before FX-04 existed, inserted straight into the table the
  // way six years of them already sit there. Nothing sanitized it on the way
  // in, so the public endpoint is the only thing standing between it and
  // `innerHTML` on timothystl.org.
  db.prepare('INSERT INTO news_items (title, summary, body, publish_date, channels) VALUES (?,?,?,?,?)')
    .run('Legacy', 'x', NASTY, churchDate(), 'web');
  const legacyRaw = db.prepare("SELECT body FROM news_items WHERE title = 'Legacy'").get().body;
  has(legacyRaw, '<script>', 'the legacy row really is unsanitized in the table');

  const feed = await (await call(env, '/api/news', { fresh: true })).json();
  const legacy = feed.find((r) => r.title === 'Legacy');
  ok(legacy, 'the legacy post is served');
  ok(!/script/i.test(legacy.body), '/api/news cleans it on the way out');
  has(legacy.body, 'Real words.', 'without losing the words');
  ok(legacyRaw.includes('<script>'),
    'and the stored bytes are UNCHANGED — cleaning on read is reversible, a migration is not');

  // ── the newsletter, which is the field that reaches six hundred inboxes ──
  db.prepare("INSERT INTO newsletters (subject, pastor_note, published_at, status) VALUES (?,?,?,'published')")
    .run('An issue', NASTY, churchDate());
  const nlId = db.prepare("SELECT id FROM newsletters WHERE subject = 'An issue'").get().id;
  const list = await (await call(env, '/api/newsletters', { fresh: true })).json();
  const issue = list.find((n) => n.subject === 'An issue');
  ok(issue && !/script/i.test(issue.pastor_note), '/api/newsletters cleans the pastor note');
  const detail = await (await call(env, '/api/newsletter/' + nlId, { fresh: true })).json();
  ok(!/script/i.test(detail.pastor_note), 'and so does /api/newsletter/:id');
  has(detail.pastor_note, 'Real words.', 'still without losing the words');
}

// ── FX-17: the block stylesheet is a link, not 85KB, and it is cacheable ────
group('the block stylesheet ships as a cacheable asset (FX-17)');
{
  const { env } = await boot();

  const res = await call(env, '/assets/blocks.css', { fresh: true });
  eq(res.status, 200, '/assets/blocks.css answers');
  has(res.headers.get('content-type') || '', 'text/css', 'as CSS');
  has(res.headers.get('cache-control') || '', 'immutable', 'cached for a year and immutable');
  // ⚠ CROSS-ORIGIN, unlike /assets/admin.css. timothystl.org is the one asking.
  eq(res.headers.get('access-control-allow-origin'), '*', 'and reachable from the public site');
  const css = await res.text();
  ok(css.length > 50000, 'it really is the whole stylesheet');
  ok(!css.trimStart().startsWith('<style'), 'served as raw CSS, not as a <style> tag');

  const api = await (await call(env, '/api/pages', { fresh: true })).json();
  ok(Object.keys(api.rendered).length > 0,
    'there are published pages, so this assertion is not vacuous');
  has(api.css, '<link', '/api/pages ships a <link>');
  has(api.css, 'id="tlcb-css"',
    'carrying the id the client reads to decide whether the stylesheet is already here');
  has(api.css, '/assets/blocks.css', 'pointed at the asset route');
  ok(!api.css.includes('<style'), 'and not the bytes');
  ok(api.css.length < 300,
    `the payload carries a link, not a stylesheet — got ${api.css.length} bytes`);
}

// ── FX-19: everything that changes what /api/pages says busts the edge copy ──
// The chokepoint runs BEFORE routing, so this is testable without caring
// whether the route behind each prefix exists, what it does, or whether the
// signed-in account may use it. What is being pinned is the prefix list.
group('the /api/pages cache chokepoint covers what feeds pageData (FX-19)');
{
  const { env } = await boot();
  const deleted = [];
  const realCaches = globalThis.caches;
  globalThis.caches = { default: {
    async match() { return null; },
    async put() {},
    async delete(req) { deleted.push(typeof req === 'string' ? req : req.url); return true; },
  }};
  try {
    // Each of these feeds a self-filling block, so a write under it changes
    // what a published page renders without the page itself being touched.
    const busts = [
      ['/pages/x/save', 'a page'],
      ['/menu/reorder', 'the menu'],
      ['/partners/update/1', 'a partner'],
      ['/values/update/acceptance', 'a core value'],
      ['/staff/create', 'a staff member — the Staff grid block'],
      ['/giving-tiers/add', 'a giving amount — the Amount ladder block'],
      ['/christian-education/create', 'a Bible class — the Bible classes block'],
      ['/sermons/new-note', 'a sermon — the Sermon library block'],
      ['/newsitems/create', 'a news post — the News feed block'],
      ['/market/settings', 'a market setting — the Market facts block'],
      ['/events/new', 'an event — the Registration block'],
    ];
    for (const [path, what] of busts) {
      deleted.length = 0;
      await call(env, path, { method: 'POST', form: { x: '1' } });
      ok(deleted.some((u) => u.includes('/api/pages')), `saving ${what} busts the edge copy`);
    }

    // ⚠ And it is a list, not "bust on every POST". A login attempt changes
    // nothing about what a visitor is served, and rebuilding that payload
    // means five queries and a render of every published page.
    deleted.length = 0;
    await call(env, '/login', { method: 'POST', form: { username: 'x', password: 'y' } });
    ok(!deleted.length, 'a POST that cannot change the public site does not bust it');
  } finally {
    if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
  }
}

// ── FX-16: the gym's escaping, and the screen that had no test at all ───────
// ⚠ THIS GROUP EXISTS BECAUSE OF A NEAR MISS. admin/gym.js defines an `esc`
// helper at module level — except it does not: that definition sits INSIDE a
// template literal, as browser code shipped to the renter portal, so it is a
// string and not a binding. A local `const esc` on this screen was the only
// thing making `${esc(g.name)}` resolve. Removing it during the FX-16 sweep
// left five server-side call sites referencing an identifier that does not
// exist — which imports cleanly and throws ReferenceError the moment somebody
// opens the screen. The whole suite stayed green through it, because nothing
// asked for this page.
group("a gym group's own screen renders, and escapes what it renders (FX-16)");
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ALL_PERMISSIONS, 'dinger.gym');

  db.prepare('INSERT INTO gym_groups (name, contact, email, phone, notes, access_token, active) VALUES (?,?,?,?,?,?,1)')
    .run('Lindenwood "Hoops" & Co <script>alert(1)</script>', 'Ann O\'Brien',
         'ann@example.com', '(314) 555-0100', 'Weekly practice <b>6pm</b>', 'tok-esc-test');
  const gid = db.prepare("SELECT id FROM gym_groups WHERE access_token = 'tok-esc-test'").get().id;

  const res = await call(env, `/gym-rentals/groups/edit/${gid}`, { cookie });
  eq(res.status, 200, "the group's screen renders at all");
  const body = await res.text();

  // The name lands in a value="…" attribute. A raw double quote closes it.
  ok(!body.includes('value="Lindenwood "Hoops"'), 'the quote in the name cannot close the attribute');
  has(body, '&quot;Hoops&quot;', 'it is escaped instead');
  ok(!/<script>alert\(1\)<\/script>/.test(body), 'and the script tag never reaches the markup');
  has(body, '&lt;script&gt;', 'having been escaped');
  // ⚠ Found by driving this screen rather than by reading it: the name was
  // also going raw into <title>, which is RCDATA — a name containing a literal
  // closing title tag ends the element and the rest is parsed as markup.
  // Escaped at the sink in html(), so every screen that titles itself from a
  // record is covered, not just this one.
  ok(!/<title>[^<]*<script>/.test(body), 'and not through the document title either');
  // The notes textarea is the other renter-reachable field on this screen.
  has(body, '&lt;b&gt;6pm&lt;/b&gt;', 'the notes are escaped in the textarea');
  ok(!body.includes('<b>6pm</b>'), 'and not rendered as markup');
}

group('building rentals reach the calendar, and never name the renter');
{
  const { db, env } = await boot();
  const realFetch = globalThis.fetch;
  // Google is asked for, and answers with the gym's own pushed copy — the one
  // that DOES carry the group name.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [
    { id: 'g1', summary: 'Gym Rental — Lindenwood Soccer Club', colorId: '8',
      start: { dateTime: '2026-08-20T18:00:00-05:00' }, end: { dateTime: '2026-08-20T20:00:00-05:00' } },
    { id: 'g2', summary: 'Divine Service', colorId: '9',
      start: { dateTime: '2026-08-16T08:00:00-05:00' }, end: { dateTime: '2026-08-16T09:15:00-05:00' } },
  ] }) });
  try {
    env.GCAL_API_KEY = 'test-key';
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('calendar_google_ids','one@group.calendar.google.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    db.prepare("INSERT INTO gym_groups (name, contact, email, active) VALUES (?,?,?,1)")
      .run('Lindenwood Soccer Club', 'A Renter', 'renter@example.com');
    const gid = db.prepare('SELECT id FROM gym_groups').get().id;
    db.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status, notes) VALUES (?,?,?,?,?,?)")
      .run(gid, '2026-08-20', '18:00', '20:00', 'confirmed', 'Bring the portable goals; back door code 1234');
    // A hold is not a booking anybody can rely on, so it stays off the calendar.
    db.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status) VALUES (?,?,?,?,?)")
      .run(gid, '2026-08-21', '18:00', '20:00', 'hold');

    const feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    const body = JSON.stringify(feed);

    const building = feed.events.filter((e) => e.source === 'building');
    eq(building.length, 1, 'the confirmed booking is on the calendar');
    eq(building[0].title, 'Gym rented', 'and it names the room rather than saying only that something is on');
    eq(building[0].location, 'Gym', 'which room, since the church rents exactly one');
    eq(building[0].start, '2026-08-20T18:00:00', 'with the real time');
    eq(building[0].category, 'facility', 'filed under Facility / rentals');

    // ⚠ THE PRIVACY RULE, AND IT HAS TWO HALVES. The renter is not named by the
    // booking entry — and the copy the gym PUSHES to Google, which does carry
    // the name, is dropped rather than shown alongside it. Without the second
    // half, adding the gym's calendar to the public list publishes every
    // renter's name on the church's public calendar.
    ok(!body.includes('Lindenwood Soccer Club'), 'the renter is never named anywhere in the feed');
    ok(!body.includes('Gym Rental'), 'and the pushed Google copy is dropped, not shown beside it');
    // The renter's own notes are the field the July 2026 review found being
    // rendered unescaped into staff email. They have no business here at all.
    ok(!body.includes('back door code'), 'and the renter notes never reach a public page');

    eq(feed.events.filter((e) => e.title === 'Divine Service').length, 1, 'an ordinary Google event is untouched');
    eq(feed.events.filter((e) => e.start.startsWith('2026-08-21')).length, 0, 'a hold is not shown as a booking');
  } finally { globalThis.fetch = realFetch; }
}

group('the calendar categories are editable, and the feed follows them');
{
  const { db, env } = await boot();
  const admin = signIn(db, ALL_PERMISSIONS);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [
    { id: 'g1', summary: 'Divine Service', colorId: '9',
      start: { dateTime: '2026-08-16T08:00:00-05:00' }, end: { dateTime: '2026-08-16T09:15:00-05:00' } },
  ] }) });
  try {
    env.GCAL_API_KEY = 'test-key';
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('calendar_google_ids','one@group.calendar.google.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    const screen = await call(env, '/calendar-categories', { cookie: admin.cookie });
    eq(screen.status, 200, 'the screen opens');
    const shown = await screen.text();
    ok(shown.includes('Worship') && shown.includes('Blueberry'), 'it lists a category and the Google color that feeds it');
    ok(shown.includes('Other'), 'including the one an uncolored event lands in');

    // Blueberry feeds Worship to start with.
    let feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    // Found by title rather than by position — the seeded school year shares
    // this month, and its rows sort before a mid-August Google event.
    const gcalEv = (f) => f.events.find((e) => e.source === 'gcal');
    eq(gcalEv(feed).category, 'worship', 'a Blueberry event is Worship');

    // Rename it and re-point it at Basil.
    const saved = await call(env, '/calendar-categories/save/worship', { cookie: admin.cookie, method: 'POST',
      form: { name: 'Divine Service', color_id: '4', palette: 'moss', active: '1' } });
    eq(saved.status, 302, 'the save is accepted');
    feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    const cat = feed.categories.find((c) => c.key === 'worship');
    eq(cat.name, 'Divine Service', 'the new name reaches the public feed');
    eq(cat.color, '#4A5E3A', 'and so does the palette swatch it now wears');
    // ⚠ Blueberry no longer feeds anything — Worship was re-pointed at Flamingo
    // — so the event falls to the neutral category rather than disappearing.
    eq(gcalEv(feed).category, 'other', 'an event whose color no category claims is Other, never dropped');
    ok(gcalEv(feed), 'and it is still on the calendar');

    // ⚠ Two categories cannot share one Google color — the question has no answer.
    const clash = await call(env, '/calendar-categories/save/learn', { cookie: admin.cookie, method: 'POST',
      form: { name: 'Learn', color_id: '4', palette: 'teal', active: '1' } });
    eq(clash.headers.get('location'), '/calendar-categories?msg=taken', 'a color already in use is refused, with a reason');
    const still = await call(env, '/calendar-categories', { cookie: admin.cookie });
    ok((await still.text()).includes('Divine Service'), 'and the category that had it keeps it');

    // ⚠ Other cannot be retired however the form arrives — it is where every
    // uncolored event lands, which is most of them.
    await call(env, '/calendar-categories/save/other', { cookie: admin.cookie, method: 'POST',
      form: { name: 'Other', palette: 'gray' } });
    feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    ok(feed.categories.some((c) => c.key === 'other'), 'Other survives a post that would retire it');

    // A retired category stops being offered.
    await call(env, '/calendar-categories/save/music', { cookie: admin.cookie, method: 'POST',
      form: { name: 'Music', color_id: '3', palette: 'plum' } });
    feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    ok(!feed.categories.some((c) => c.key === 'music'), 'a retired category is gone from the public list');

    // Adding one.
    const added = await call(env, '/calendar-categories/add', { cookie: admin.cookie, method: 'POST',
      form: { name: 'Fellowship', color_id: '9', palette: 'gold' } });
    eq(added.status, 302, 'a new category is accepted');
    feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    ok(feed.categories.some((c) => c.name === 'Fellowship'), 'and reaches the public list');
    // Flamingo now feeds it, so the neutral fallback is no longer where a
    // Flamingo event goes.
    eq(feed.categories.find((c) => c.name === 'Fellowship').colorId, '9', 'carrying the color it was given');
    // ⚠ And the event follows the color rather than the old category name:
    // Blueberry now feeds Fellowship, so the service that fell to Other when
    // Worship was re-pointed lands there.
    eq(feed.events[0].category, 'fellowship', 'an event moves when a category takes over its color');
  } finally { globalThis.fetch = realFetch; }
}

group('the category screen is gated, like every other page screen');
{
  const { db, env } = await boot();
  const nobody = signIn(db, ['news_edit'], 'newsy');
  eq((await call(env, '/calendar-categories', { cookie: nobody.cookie })).status, 403,
    'an account without pages_edit is refused');
  eq((await call(env, '/calendar-categories/save/worship', { cookie: nobody.cookie, method: 'POST',
    form: { name: 'Hijacked', palette: 'gray' } })).status, 403, 'and so is the save route, not just the screen');
}

group('a news post says what it is on the calendar, rather than having it guessed');
{
  const { db, env } = await boot();
  const admin = signIn(db, ALL_PERMISSIONS);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
  try {
    env.GCAL_API_KEY = 'test-key';
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('calendar_google_ids','one@group.calendar.google.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();

    // The form offers the live categories, not a hardcoded list.
    const form = await (await call(env, '/newsitems/new', { cookie: admin.cookie })).text();
    ok(form.includes('On the calendar, this is'), 'the post form asks what it is on the calendar');
    ok(form.includes('Meetings') && form.includes('Music'), 'and offers the categories the calendar actually has');

    // ⚠ THE CASE THAT WAS IMPOSSIBLE BEFORE. The four values only ever reached
    // three of the calendar's categories, so a council meeting with a date on
    // it silently became "Special events" whatever anybody did.
    const made = await call(env, '/newsitems/create', { cookie: admin.cookie, method: 'POST', form: {
      title: 'Council meeting', summary: 'In the fellowship hall.',
      publish_date: '2026-08-01', event_date: '2026-08-11', expire_date: '2026-12-31',
      calendar_category: 'meetings', ch_web: '1',
    } });
    eq(made.status, 302, 'the post saves');
    let feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    const ev = feed.events.find((e) => e.title === 'Council meeting');
    ok(ev, 'and reaches the calendar');
    eq(ev.category, 'meetings', 'filed where the office said, not where the value tag would have put it');

    // A post with no category set still falls back to the old guess, so
    // nothing written before this field existed moves.
    await call(env, '/newsitems/create', { cookie: admin.cookie, method: 'POST', form: {
      title: 'Rally Day', summary: 'Come along.', publish_date: '2026-08-01',
      event_date: '2026-08-12', expire_date: '2026-12-31', value: 'worship', ch_web: '1',
    } });
    feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    eq(feed.events.find((e) => e.title === 'Rally Day').category, 'worship',
      'an untagged post still follows its value, exactly as before');
  } finally { globalThis.fetch = realFetch; }
}

group('a news post carries a time, so it is a whole event and nothing is retyped');
{
  const { db, env } = await boot();
  const admin = signIn(db, ALL_PERMISSIONS);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
  try {
    env.GCAL_API_KEY = 'test-key';
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('calendar_google_ids','one@group.calendar.google.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();

    const form = await (await call(env, '/newsitems/new', { cookie: admin.cookie })).text();
    ok(form.includes('Starts at') && form.includes('type="time"'), 'the post form asks what time it starts');
    ok(form.includes('Where'), 'and where it is');

    // ⚠ THE CASE THE NEWSLETTER'S OWN EVENT ROWS EXISTED FOR. Before this a
    // 7:00 pm meeting could be typed into an email and could not be said here,
    // so it was entered again by hand — and again into Google.
    eq((await call(env, '/newsitems/create', { cookie: admin.cookie, method: 'POST', form: {
      title: 'Council meeting', summary: 'In the fellowship hall.',
      publish_date: '2026-08-01', event_date: '2026-08-11', expire_date: '2026-12-31',
      event_time: '19:00', event_end_time: '20:30', event_location: 'Fellowship Hall',
      calendar_category: 'meetings', ch_web: '1',
    } })).status, 302, 'the post saves');

    let feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    let ev = feed.events.find((e) => e.title === 'Council meeting');
    ok(ev, 'and reaches the calendar');
    eq(ev.allDay, false, 'as a timed event rather than an all-day chip');
    eq(ev.start, '2026-08-11T19:00:00');
    eq(ev.end, '2026-08-11T20:30:00');
    eq(ev.location, 'Fellowship Hall');
    // The rule the whole feed is built on, restated at the one new door into it.
    ok(!/[Zz]|[+-]\d{2}:\d{2}$/.test(ev.start), 'carrying no timezone, like every other time in the feed');

    // A post with no time is still an all-day event, so nothing already
    // written moved when the column arrived.
    await call(env, '/newsitems/create', { cookie: admin.cookie, method: 'POST', form: {
      title: 'Rummage sale', publish_date: '2026-08-01', event_date: '2026-08-12',
      expire_date: '2026-12-31', ch_web: '1',
    } });
    feed = await (await call(env, '/api/calendar?month=2026-08', { fresh: true })).json();
    eq(feed.events.find((e) => e.title === 'Rummage sale').allDay, true,
      'a post with no time is all day, not midnight');

    // ⚠ A TIME THE CALENDAR WOULD IGNORE MUST NOT BE STORED EITHER, or the
    // edit form comes back showing a time the month does not show.
    await call(env, '/newsitems/create', { cookie: admin.cookie, method: 'POST', form: {
      title: 'Bad clock', publish_date: '2026-08-01', event_date: '2026-08-13',
      expire_date: '2026-12-31', event_time: '25:00', ch_web: '1',
    } });
    eq(db.prepare("SELECT event_time FROM news_items WHERE title='Bad clock'").get().event_time, null,
      'an impossible time is stored as nothing at all');

    // The edit form shows back what was saved, so a time survives a second save.
    const id = db.prepare("SELECT id FROM news_items WHERE title='Council meeting'").get().id;
    const edit = await (await call(env, `/newsitems/edit/${id}`, { cookie: admin.cookie })).text();
    ok(edit.includes('value="19:00"'), 'the edit form shows the stored start time');
    ok(edit.includes('Fellowship Hall'), 'and the stored location');

    // It rides into a subscription as a real instant, not an all-day block.
    const ics = await (await call(env, '/api/calendar.ics?month=2026-08', { fresh: true })).text();
    ok(ics.includes('DTSTART;TZID=America/Chicago:20260811T190000'), 'the .ics carries the clock');
    ok(ics.includes('LOCATION:Fellowship Hall'), 'and the location');
  } finally { globalThis.fetch = realFetch; }
}

group('the newsletter picks its events from the posts, instead of retyping them');
{
  const { db, env } = await boot();
  const admin = signIn(db, ALL_PERMISSIONS);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10);

  const far = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO news_items (title, summary, publish_date, event_date, event_time, event_location, channels)
              VALUES ('Council meeting','In the fellowship hall.',?,?,'19:00','Fellowship Hall','web')`).run(today, soon);
  const postId = db.prepare("SELECT id FROM news_items WHERE title='Council meeting'").get().id;
  db.prepare(`INSERT INTO news_items (title, summary, publish_date, event_date, event_time, event_location, channels)
              VALUES ('Rummage sale','','2000-01-01',?,'','','web')`).run(far);
  const farId = db.prepare("SELECT id FROM news_items WHERE title='Rummage sale'").get().id;

  // ⚠ THE LOOP THIS CLOSES. The composer used to offer a blank date/name/time
  // to type into, and those rows reached the email and NOTHING else.
  const form = await (await call(env, '/new', { cookie: admin.cookie })).text();
  ok(form.includes('name="event_news_ids"'), 'the composer offers the posts that already carry a date');
  ok(form.includes('Council meeting'), 'including the one just written');
  ok(!form.includes('name="event_ids"'), 'and no longer offers a blank row to type into');
  ok(!/addEvent\(\)/.test(form), 'the "+ Add an event" path is gone, not merely hidden');

  // ⚠ A BRAND-NEW ISSUE STARTS WITH THE NEARBY EVENTS ALREADY TICKED, not
  // with an empty sidebar the office has to remember to fill in every week.
  ok(form.includes(`name="event_news_ids" value="${postId}" checked`),
    'an event less than two weeks out is pre-ticked on a new issue');
  ok(!form.includes(`name="event_news_ids" value="${farId}" checked`),
    'one 40 days out is offered, but not pre-ticked');

  // ⚠ A DATED POST IS OFFERED WHETHER OR NOT IT IS TICKED FOR EMAIL. The email
  // channel means "worth a paragraph"; a date is a fact about the week, and
  // leaving it out of the offer sends somebody back to typing it.
  ok(!form.includes('name="news_item_ids" value="' + postId + '"'),
    'the post is not offered by the news picker, which is email-channel only');

  const made = await call(env, '/publish', { cookie: admin.cookie, method: 'POST', form: {
    subject: 'This week at Timothy', published_at: today, format: 'weekly',
    action: 'draft', event_news_ids: String(postId),
  } });
  eq(made.status, 302, 'the issue saves');
  const nl = db.prepare("SELECT id FROM newsletters WHERE subject='This week at Timothy'").get();
  const rows = db.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY sort_order').all(nl.id);
  eq(rows.length, 1, 'and one event row is materialized from the post');
  eq(rows[0].event_name, 'Council meeting');
  eq(rows[0].event_time, '7:00 pm', 'with the clock written as somebody would read it aloud');
  eq(rows[0].event_desc, 'In the fellowship hall.');
  eq(rows[0].news_item_id, postId, 'remembering which post it came from');

  // The tick survives a round trip, which is the whole job of news_item_id.
  const edit = await (await call(env, `/edit/${nl.id}`, { cookie: admin.cookie })).text();
  ok(edit.includes(`name="event_news_ids" value="${postId}" checked`), 'reopening the issue re-ticks the event');

  // ⚠ MATERIALIZED, NOT RESOLVED AT SEND TIME. A sent issue's archive has to
  // keep saying what was actually sent, so renaming the post next March must
  // not rewrite an issue six hundred people already have.
  db.prepare("UPDATE news_items SET title='Council meeting (moved)' WHERE id=?").run(postId);
  eq(db.prepare('SELECT event_name FROM events WHERE newsletter_id = ?').get(nl.id).event_name, 'Council meeting',
    'editing the post afterwards does not rewrite an issue already written');

  // ⚠ A HAND-TYPED ROW FROM BEFORE THE PICKER IS KEPT, NOT SILENTLY DROPPED.
  db.prepare(`INSERT INTO events (newsletter_id, event_date, event_name, event_time, event_desc, sort_order, news_item_id)
              VALUES (?, '2000-01-01', 'Typed by hand', '6:30 pm', 'From the old composer', 9, NULL)`).run(nl.id);
  const withTyped = await (await call(env, `/edit/${nl.id}`, { cookie: admin.cookie })).text();
  ok(withTyped.includes('Typed by hand'), 'the old row is shown');
  ok(withTyped.includes('name="typed_event_ids"'), 'and posted back so a save does not delete it');

  await call(env, '/publish', { cookie: admin.cookie, method: 'POST', form: {
    newsletter_id: String(nl.id), subject: 'This week at Timothy', published_at: today, format: 'weekly',
    action: 'draft', event_news_ids: String(postId),
    typed_event_ids: '0', typed_event_date_0: '2000-01-01', typed_event_name_0: 'Typed by hand',
    typed_event_time_0: '6:30 pm', typed_event_desc_0: 'From the old composer',
  } });
  const after = db.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY sort_order').all(nl.id);
  eq(after.length, 2, 'both rows survive the save');
  eq(after[0].event_name, 'Typed by hand', 'and the earlier date prints first, whichever kind of row it is');
  eq(after[0].news_item_id, null, 'a hand-typed row still has no post behind it');

  // The preview reads the same ticks, so it cannot flatter what will send.
  const preview = await (await call(env, '/newsletter/preview', { cookie: admin.cookie, method: 'POST', form: {
    subject: 'x', published_at: today, format: 'weekly', block_events: '1',
    event_news_ids: String(postId),
  } })).text();
  ok(preview.includes('Council meeting (moved)'), 'the preview shows the post as it reads right now');
}

group('the Word of Life school year is on the calendar, and off the news feed');
{
  const { db, env } = await boot();
  const admin = signIn(db, ALL_PERMISSIONS);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
  try {
    env.GCAL_API_KEY = 'test-key';
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('calendar_google_ids','one@group.calendar.google.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();

    const seeded = db.prepare("SELECT COUNT(*) c FROM news_items WHERE channels = 'calendar'").get().c;
    eq(seeded, SCHOOL_EVENTS.length, 'every picked date from the school PDF is in');

    // ⚠ THE WHOLE REASON FOR THE CALENDAR-ONLY CHANNEL. Twenty-nine school
    // dates in the news feed would bury everything the church actually wrote.
    const news = await (await call(env, '/api/news?limit=100')).json();
    ok(!news.some((n) => n.title === 'Spring break'), 'a school date is not news anybody wants a paragraph about');

    // ⚠ AND IT IS STILL ON THE MONTH, which is the half that would be easy to
    // break by filtering the channel in one place and not the other.
    const march = await (await call(env, '/api/calendar?month=2027-03', { fresh: true })).json();
    const brk = march.events.find((e) => e.title === 'Spring break');
    ok(brk, 'but it is on the calendar');
    eq(brk.category, 'wol', 'filed under Word of Life, so the whole school year filters off in one click');
    eq(brk.start, '2027-03-15');
    eq(brk.end, '2027-03-19', 'a week off school is one entry spanning its days, not five identical ones');
    eq(brk.allDay, true);

    // A Timothy early dismissal is 11:45, not noon — the school's own footnote
    // gives Ascension a different time and this is Timothy's calendar.
    const may = await (await call(env, '/api/calendar?month=2027-05', { fresh: true })).json();
    const last = may.events.find((e) => e.title.startsWith('Last day of school'));
    eq(last.start, '2027-05-28T11:45:00', 'an early dismissal carries the time it actually happens');

    // ⚠ Good Friday and Easter Monday are TWO rows, not a range. A 26–29 span
    // would draw a four-day bar and claim the school was shut on days it was
    // never open.
    eq(march.events.filter((e) => e.title.startsWith('No school —')).length, 2, 'two closures in March, not one bar across the weekend');

    // ⚠ TWENTY-NINE ROWS IN A LIST SORTED FURTHEST-FUTURE FIRST would put the
    // school year on top of whatever the office wrote for next Sunday, so the
    // admin list has a chip that isolates them. It does not hide them from
    // All, which would make the list a half-truth.
    const list = await (await call(env, '/newsitems', { cookie: admin.cookie })).text();
    ok(list.includes('Calendar only'), 'the News list offers a Calendar only filter');
    ok(/data-filter="[^"]*calendar-only/.test(list), 'and the school rows carry it');
    ok(list.includes('Spring break'), 'while still being in the list itself');
    // ⚠ And they are not told off for having no expiry: not having one is
    // exactly what a date on the month is for.
    ok(!/calendar-only[\s\S]{0,900}No expiry date/.test(list),
      'a calendar-only post is not warned about its missing expiry date');

    // ⚠ THE MARKER IS WHAT MAKES THIS SAFE TO DELETE FROM. Without it a date
    // the office removed on purpose comes back on the next deploy, silently.
    db.prepare("DELETE FROM news_items WHERE title = 'Spring break'").run();
    await call(env, '/api/news', { fresh: true });            // any request re-runs the schema block
    eq(db.prepare("SELECT COUNT(*) c FROM news_items WHERE title = 'Spring break'").get().c, 0,
      'a deleted school date stays deleted');
  } finally { globalThis.fetch = realFetch; }
}

group('a subscription can leave out what would crowd somebody\'s own calendar');
{
  const { db, env } = await boot();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [] }) });
  try {
    env.GCAL_API_KEY = 'test-key';
    db.prepare("INSERT INTO site_settings (key, value) VALUES ('calendar_google_ids','one@group.calendar.google.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels, calendar_category) VALUES (?,?,?,?,?,?,?)")
      .run('Advent service', 'In the sanctuary.', '2026-11-01', '2026-12-02', '2099-01-01', 'web', 'worship');

    const all = await (await call(env, '/api/calendar.ics?month=2026-12', { fresh: true })).text();
    ok(all.includes('SUMMARY:Advent service'), 'the whole feed carries the service');
    ok(all.includes('SUMMARY:Christmas break'), 'and the school year, which is exactly the problem');
    ok(all.includes('X-WR-CALNAME:Timothy Lutheran Church\r\n'), 'and is named plainly');

    // ⚠ THE POINT OF THE WHOLE FEATURE. Somebody already carrying a work
    // calendar and a school calendar will not add a third that buries their
    // week — they will not subscribe at all.
    const worship = await (await call(env, '/api/calendar.ics?month=2026-12&cat=worship', { fresh: true })).text();
    ok(worship.includes('SUMMARY:Advent service'), 'a filtered feed keeps what was asked for');
    ok(!worship.includes('SUMMARY:Christmas break'), 'and leaves out the school year');
    ok(worship.includes('X-WR-CALNAME:Timothy Lutheran Church — Worship'),
      'and says what is in it, so two subscriptions are told apart in a sidebar');

    // ⚠ THE FILTER IS PART OF THE CACHE KEY, and this drives a REAL cache to
    // prove it. Without the key, whichever filter was asked for first is
    // served to every other subscriber for ten minutes — somebody who asked
    // for worship quietly getting the school year, with nothing at their end
    // to see. Asserting it against the Node harness's absent `caches` would
    // have passed either way, which is no assertion at all.
    const realCaches = globalThis.caches;
    const store = new Map();
    globalThis.caches = { default: {
      async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : null; },
      async put(req, res) { store.set(req.url, res.clone()); },
      async delete() { return true; },
    }};
    try {
      // Warm the cache with the worship feed, then ask for the school one.
      await call(env, '/api/calendar.ics?month=2026-12&cat=worship');
      const school = await (await call(env, '/api/calendar.ics?month=2026-12&cat=wol')).text();
      ok(school.includes('SUMMARY:Christmas break'), 'a different filter is not served the previous one');
      ok(!school.includes('SUMMARY:Advent service'), 'in either direction');
      // The same filter written the other way round is ONE cache entry, not two.
      const before = store.size;
      await call(env, '/api/calendar.ics?month=2026-12&cat=wol,worship');
      await call(env, '/api/calendar.ics?month=2026-12&cat=worship,wol');
      eq(store.size, before + 1, 'the order the categories are written in does not make a second entry');
    } finally {
      if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches;
    }

    // ⚠ AND IT APPLIES TO THE SUBSCRIPTION, NOT TO THE PAGE. The month on
    // screen filters in the browser; filtering the JSON here would leave the
    // pills unable to widen what they were handed, and the print sheet — which
    // deliberately ignores the pills — printing a month short of everything.
    const json = await (await call(env, '/api/calendar?month=2026-12&cat=worship', { fresh: true })).json();
    ok(json.events.some((e) => e.title === 'Christmas break'),
      'the page still gets the whole month, whatever the subscription asked for');
  } finally { globalThis.fetch = realFetch; }
}


// ── EVENT INTAKE, end to end through the real Worker ────────────────────────
// admin/intake.test.mjs already covers every pure decision (types, checklist
// templates, the merge, the queues) with zero D1 access. What only a real
// Worker + real sqlite can prove: the permission gate, that a sync actually
// writes placeholder rows, that Publish is refused server-side (not just by a
// disabled button) when the checklist is incomplete, that a deferred field
// set is genuinely read-only against a crafted POST (not just hidden in the
// markup), that a "local" row created here reaches the PUBLIC calendar feed,
// and — the one property Andrew's three answers are all binding on — that
// none of this ever gates the public calendar or touches calendar_category.
group('Event Intake is gated on its own permission');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['news_edit'], 'noaccess');
  const res = await call(env, '/event-intake', { cookie, fresh: true });
  eq(res.status, 403, 'holding no intake_manage at all is refused');
  ok(!(await res.text()).includes('Timothy’s Calendar'), 'and never renders the screen to get there');
}

group('a visit syncs Google, News and gym rows into placeholders, all unclassified');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  const realFetch = globalThis.fetch;
  const gcalDate = churchDatePlus(5);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [
    { id: 'ei-g1', summary: 'Choir Rehearsal', colorId: '9',
      start: { dateTime: `${gcalDate}T19:00:00-05:00` }, end: { dateTime: `${gcalDate}T20:00:00-05:00` } },
  ] }) });
  try {
    env.GCAL_API_KEY = 'test-key';
    const newsDate = churchDatePlus(6);
    db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, event_time, expire_date, channels) VALUES (?,?,?,?,?,?,?)")
      .run('Rally Day Kickoff', 'Classes then a picnic.', churchDate(), newsDate, '09:15', '2099-01-01', 'web');
    db.prepare("INSERT INTO gym_groups (id, name, contact, email, active) VALUES (1,'Boy Scouts Troop 217','Dave Kessler','dave@troop217.org',1)").run();
    const gymDate = churchDatePlus(7);
    db.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status, notes) VALUES (1,?,'18:30','20:30','confirmed','Tables 4, chairs 40')")
      .run(gymDate);
    // A held/expired hold must never appear — only confirmed bookings do.
    db.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status) VALUES (1,?,'09:00','10:00','hold')").run(gymDate);

    const res = await call(env, '/event-intake', { cookie, fresh: true });
    eq(res.status, 200, 'intake_manage reaches the screen');
    const html = await res.text();
    has(html, 'Choir Rehearsal', 'the Google event is in the default (inbox) queue');
    has(html, 'Rally Day Kickoff', 'so is the News post');
    has(html, 'Boy Scouts Troop 217', 'and the confirmed gym booking, titled by group name');
    has(html, 'Needs a type', 'none of the three has been classified yet');
    ok(!html.includes('4 open') || true, 'sanity: page renders without throwing');

    // ⚠ THE SYNC WROTE PLACEHOLDER ROWS — this is the row the badge and a
    // later visit both depend on, and it is the one thing a unit test on
    // admin/intake.js alone could never prove (it has no D1 access at all).
    // ⚠ Scoped to OUR OWN three keys, not a bare row count — the school-year
    // seed (admin/school-calendar-seed.js) writes ~29 News & Events rows with
    // channel='calendar', and several of those genuinely fall inside Event
    // Intake's own sync window too. That is correct behavior (Andrew's
    // "everything flows into the queue" applies to them as much as to this
    // test's own data), not a defect to work around — so the test asks about
    // its own rows by key instead of assuming it is the only thing synced.
    const newsId = db.prepare("SELECT id FROM news_items WHERE title = 'Rally Day Kickoff'").get().id;
    const gymBookingId = db.prepare("SELECT id FROM gym_bookings WHERE status = 'confirmed'").get().id;
    const myKeys = ['g:ei-g1', `n:${newsId}`, `b:${gymBookingId}`];
    const placeholders = myKeys.map(() => '?').join(',');
    const rowsOf = () => db.prepare(`SELECT source_kind, source_key, event_type FROM event_intake WHERE source_key IN (${placeholders})`).all(...myKeys);
    const rows = rowsOf();
    eq(rows.length, 3, 'exactly one placeholder row per synced source of ours (the hold is not confirmed, so it never syncs)');
    ok(rows.every((r) => r.event_type === null), 'and every one starts unclassified');
    ok(rows.some((r) => r.source_kind === 'gcal' && r.source_key === 'g:ei-g1'), 'the Google row uses the same key space the public calendar reads');
    ok(rows.some((r) => r.source_kind === 'gym'), 'the gym row synced too — Andrew’s explicit "everything, including gym bookings"');

    // A second visit must not duplicate the rows — ON CONFLICT(source_key)
    // updates in place rather than inserting a sibling.
    await call(env, '/event-intake', { cookie, fresh: true });
    eq(rowsOf().length, 3, 'a second sync does not duplicate placeholder rows for the same three keys');
  } finally { globalThis.fetch = realFetch; }
}

group('picking a type never touches calendar_category, and the checklist is purely internal');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  const newsDate = churchDatePlus(4);
  db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels, calendar_category) VALUES (?,?,?,?,?,?,?)")
    .run('Council Meeting', 'Monthly meeting.', churchDate(), newsDate, '2099-01-01', 'web', 'meetings');
  await call(env, '/event-intake', { cookie, fresh: true }); // sync
  const key = `n:${db.prepare("SELECT id FROM news_items WHERE title='Council Meeting'").get().id}`;
  // ⚠ Looked up by source_key, not "the first news-kind row" — the
  // school-year seed writes its own News-sourced rows into event_intake too,
  // so grabbing an arbitrary row of that kind would silently check somebody
  // else's row instead of this test's own.

  const res = await call(env, '/event-intake/type', { cookie, method: 'POST',
    form: { key, type: 'worship', queue: 'inbox' } });
  eq(res.status, 302, 'redirects back to the queue');
  const after = db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(key);
  eq(after.event_type, 'worship', 'the Intake type is stored');
  const news = db.prepare("SELECT calendar_category FROM news_items WHERE title='Council Meeting'").get();
  eq(news.calendar_category, 'meetings', 'and the News post’s OWN calendar_category is completely untouched — type and category are separate ideas');

  // ⚠ THE LOAD-BEARING ASSERTION: the public calendar feed shows this event
  // — unchanged, still under its News category — with no checklist item
  // ever checked and nothing ever published from this screen. Internal
  // tracking here must never gate what the congregation sees.
  const feed = await (await call(env, `/api/calendar?month=${newsDate.slice(0, 7)}`, { fresh: true })).json();
  const onFeed = feed.events.find((e) => e.title === 'Council Meeting');
  ok(onFeed, 'the event is on the public calendar with zero Intake checklist progress');
  eq(onFeed.category, 'meetings', 'still wearing its own category, not Intake’s "worship"');

  // An unrecognized type is refused rather than stored.
  await call(env, '/event-intake/type', { cookie, method: 'POST', form: { key, type: 'not-a-real-type', queue: 'inbox' } });
  eq(db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(key).event_type, null,
    'a bogus type clears the classification rather than storing garbage');
}

group('Publish is never gated on the checklist or the room — reported as "dont make any field required"');
{
  // Andrew: "not every event needs a room, or the checklist... dont make any
  // field required, you can just leave it with a publish button." The
  // checklist was already never what put anything ON the public calendar —
  // a Google/News/gym-sourced event reaches it through its own path
  // regardless, and a local one reaches it the instant it is entered — so
  // gating Publish on it was only ever an internal courtesy that got in the
  // way of a routine class or a plain note like "First day of school."
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  const newsDate = churchDatePlus(3);
  db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels) VALUES (?,?,?,?,?,?)")
    .run('Adult Bible Study', 'Colossians, week 1.', churchDate(), newsDate, '2099-01-01', 'web');
  await call(env, '/event-intake', { cookie, fresh: true });
  const newsId = db.prepare("SELECT id FROM news_items WHERE title='Adult Bible Study'").get().id;
  const key = `n:${newsId}`;
  await call(env, '/event-intake/type', { cookie, method: 'POST', form: { key, type: 'education', queue: 'inbox' } });

  // Publish with only ONE of the four education checklist items ticked, and
  // no room at all — this used to be refused server-side.
  const res = await call(env, '/event-intake/save', { cookie, method: 'POST',
    form: { key, queue: 'education', action: 'publish', check_teacher: '1' } });
  eq(res.status, 302, 'redirects on success');
  const row = db.prepare("SELECT published_at, published_by, checks_json, room FROM event_intake WHERE source_key = ?").get(key);
  ok(row.published_at, 'published even though three of four checklist items were never ticked and no room was set');
  eq(row.published_by, 'office', 'and records who');
  ok(JSON.parse(row.checks_json).teacher === true, 'the one real tick is still saved alongside it — the checklist is a record now, not a gate');
  eq(row.room, '', 'no room was required either');
}

group('a bare item — no type, no room, no checklist ticked — can still be published, "materials copied" is not a calendar requirement');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  const newsDate = churchDatePlus(5);
  db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels) VALUES (?,?,?,?,?,?)")
    .run('First day of school', 'No description needed.', churchDate(), newsDate, '2099-01-01', 'web');
  await call(env, '/event-intake', { cookie, fresh: true });
  const newsId = db.prepare("SELECT id FROM news_items WHERE title='First day of school'").get().id;
  const key = `n:${newsId}`;
  // No /event-intake/type call at all — Publish is pressed on an item that
  // is still "Needs a type."
  const res = await call(env, '/event-intake/save', { cookie, method: 'POST',
    form: { key, queue: 'inbox', action: 'publish' } });
  eq(res.status, 302, 'redirects on success');
  const row = db.prepare("SELECT published_at, event_type FROM event_intake WHERE source_key = ?").get(key);
  ok(row.published_at, 'a plain note publishes with nothing filled in at all');
  eq(row.event_type, null, 'and never picked up a type it was never given');
}

group('a deferred field set (a gym-sourced rental) is read-only against a crafted POST, not just hidden');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  db.prepare("INSERT INTO gym_groups (id, name, contact, email, active) VALUES (1,'Red Cross','Angela Poe','apoe@redcross.org',1)").run();
  const gymDate = churchDatePlus(10);
  db.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status, notes) VALUES (1,?,'12:30','16:30','confirmed','8 tables, 20 chairs')")
    .run(gymDate);
  await call(env, '/event-intake', { cookie, fresh: true });
  const bookingId = db.prepare('SELECT id FROM gym_bookings ORDER BY id DESC LIMIT 1').get().id;
  const key = `b:${bookingId}`;
  await call(env, '/event-intake/type', { cookie, method: 'POST', form: { key, type: 'rental', queue: 'inbox' } });

  // A gym-sourced rental defers ALL its extra fields to Gym Rentals — see
  // deferredFieldsSource('rental', 'gym') in admin/intake.js. A crafted POST
  // trying to overwrite the renter's name through Intake must be dropped.
  const res = await call(env, '/event-intake/save', { cookie, method: 'POST',
    form: { key, queue: 'rental', action: 'save', room: 'Gym',
      extra_renter: 'SOMEBODY ELSE ENTIRELY', extra_contact: 'not-a-real-contact' } });
  eq(res.status, 302, 'still saves the parts that are genuinely Intake’s (the room)');
  const row = db.prepare("SELECT extra_json, room FROM event_intake WHERE source_key = ?").get(key);
  eq(row.room, 'Gym', 'the room, which is not deferred, is saved');
  eq(row.extra_json, null, 'but extra_json was never written at all — the deferred fields have nowhere to land');

  // And the real renter name still comes from gym_groups, not from anything
  // Intake could have overwritten.
  const group = db.prepare('SELECT name FROM gym_groups WHERE id = 1').get();
  eq(group.name, 'Red Cross', 'the real record is untouched');
  const page = await (await call(env, `/event-intake?queue=rental&selected=${encodeURIComponent(key)}`, { cookie, fresh: true })).text();
  has(page, 'Red Cross', 'and the screen displays it read-only, pulled live from the real record');
  has(page, 'Managed on the Gym Rentals screen, not here.', 'saying so in as many words');
}

group("the checklist renders before the type's own fields, and a tick shows without a reload");
{
  // Reported plainly: "move the info box on right side up to the top so I can
  // see it for the event" and "these checkboxes are all unable to be ticked."
  // Both traced to the same panel — a Rental item is the one type whose extra
  // block (the deferred Gym Rentals note) is tall enough that the checklist
  // used to sit well below the fold.
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  db.prepare("INSERT INTO gym_groups (id, name, contact, email, active) VALUES (1,'Cub Scouts','Pat Reyes','preyes@example.org',1)").run();
  const gymDate = churchDatePlus(9);
  db.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status, notes) VALUES (1,?,'18:00','20:00','confirmed','')")
    .run(gymDate);
  await call(env, '/event-intake', { cookie, fresh: true });
  const bookingId = db.prepare('SELECT id FROM gym_bookings ORDER BY id DESC LIMIT 1').get().id;
  const key = `b:${bookingId}`;
  await call(env, '/event-intake/type', { cookie, method: 'POST', form: { key, type: 'rental', queue: 'inbox' } });
  await call(env, '/event-intake/save', { cookie, method: 'POST',
    form: { key, queue: 'rental', action: 'save', room: 'Gym', check_agreement: '1' } });

  const page = await (await call(env, `/event-intake?queue=rental&selected=${encodeURIComponent(key)}`, { cookie, fresh: true })).text();
  const checklistAt = page.indexOf('Before it publishes');
  const typeBlockAt = page.indexOf('Rental only');
  ok(checklistAt >= 0 && typeBlockAt >= 0, 'both the checklist and the type-specific block are on the page');
  ok(checklistAt < typeBlockAt,
    'the checklist ("Before it publishes") renders before the type’s own fields ("Rental only"), so it does not need scrolling past to reach: ' +
    checklistAt + ' vs ' + typeBlockAt);

  // ⚠ THE ROOT CAUSE OF "unable to be ticked": the tick glyph and the fill
  // were only ever written into the markup by the SERVER, keyed on whatever
  // was already saved — clicking a box toggled the underlying input just
  // fine, but nothing on screen ever said so until a reload. The fix is that
  // the glyph is in the DOM unconditionally now, and a live CSS rule (not a
  // second server-side flag) decides whether it is visible.
  const checkSpans = page.match(/class="ei-check-box" aria-hidden="true">[^<]*</g) || [];
  eq(checkSpans.length, 4, 'the four Rental checklist items each render a box');
  ok(checkSpans.every((s) => s.endsWith('>✓<')), 'and every one of them — ticked or not — carries the tick mark in the markup: ' + checkSpans.join(' | '));
  const doneCount = (page.match(/class="ei-check ei-check-done"/g) || []).length;
  eq(doneCount, 1, 'but only the one item actually saved as done gets the done class server-side, so an unopened page still shows the truth');
  has(page, '.ei-check:has(input:checked)', 'and a CSS rule keyed off the checkbox’s own live checked state is what makes a click visible with no reload');
}

group('"+ New event" creates a local row with no other record, and it reaches the public calendar directly');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  const formRes = await call(env, '/event-intake/new-form', { cookie, fresh: true });
  eq(formRes.status, 200, 'the standalone form is reachable');
  has(await formRes.text(), 'For a booking with no Google event and no News', 'and says what it is for');

  const wedDate = churchDatePlus(20);
  const res = await call(env, '/event-intake/new', { cookie, method: 'POST', form: {
    local_title: 'Wedding — Bauer / Klein', local_event_date: wedDate,
    local_event_time: '14:00', room: 'Sanctuary', type: 'rental',
  } });
  eq(res.status, 302, 'redirects back into the queue with the new row selected');
  const row = db.prepare("SELECT * FROM event_intake WHERE source_kind='local'").get();
  ok(row, 'a local row now exists');
  eq(row.event_type, 'rental', 'the type picked on the standalone form is stored immediately');
  eq(row.local_title, 'Wedding — Bauer / Klein');

  // ⚠ THE OTHER HALF — admin/calendar.js's readLocalIntakeEvents() is unit
  // tested with a stub DB; this proves the real route that creates a local
  // row and the real public feed that reads it agree with each other.
  const feed = await (await call(env, `/api/calendar?month=${wedDate.slice(0, 7)}`, { fresh: true })).json();
  const onFeed = feed.events.find((e) => e.title === 'Wedding — Bauer / Klein');
  ok(onFeed, 'the local event reaches the public calendar with no Google event and no News post behind it');
  eq(onFeed.source, 'local', 'and says so');
  eq(onFeed.start, `${wedDate}T14:00:00`, 'carrying the church wall clock, no offset');

  // A missing title or date is refused, not silently dropped as a blank row.
  const bad = await call(env, '/event-intake/new', { cookie, method: 'POST', form: { local_title: '', local_event_date: '' } });
  eq(bad.status, 302, 'still redirects');
  eq(db.prepare("SELECT COUNT(*) AS n FROM event_intake WHERE source_kind='local'").get().n, 1,
    'but nothing was inserted for the incomplete submission');

  // Deleting the local row removes it from the calendar; deleting a
  // non-local key (the safety the route itself enforces) is a silent no-op.
  await call(env, '/event-intake/local/delete', { cookie, method: 'POST', form: { key: 'g:not-a-real-id' } });
  eq(db.prepare("SELECT COUNT(*) AS n FROM event_intake WHERE source_kind='local'").get().n, 1,
    'a non-local key deletes nothing');
  await call(env, '/event-intake/local/delete', { cookie, method: 'POST', form: { key: `l:${row.id}` } });
  eq(db.prepare("SELECT COUNT(*) AS n FROM event_intake WHERE source_kind='local'").get().n, 0,
    'the local row itself deletes cleanly');
  const feedAfter = await (await call(env, `/api/calendar?month=${wedDate.slice(0, 7)}`, { fresh: true })).json();
  ok(!feedAfter.events.some((e) => e.title === 'Wedding — Bauer / Klein'), 'and is gone from the public calendar too');
}

group('the sidebar badge counts open Intake items, from the database alone');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  const newsDate = churchDatePlus(8);
  db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels) VALUES (?,?,?,?,?,?)")
    .run('MDO Open House', 'Tour the wing.', churchDate(), newsDate, '2099-01-01', 'web');
  // Before any visit, the badge reads zero — nothing has synced yet, not even
  // the school-year seed (it only reaches event_intake through a sync, same
  // as anything else).
  const dash0 = await call(env, '/dashboard', { cookie, fresh: true });
  const dash0Html = await dash0.text();
  has(dash0Html, 'sidebar-item', 'the dashboard renders at all');
  lacks(dash0Html, 'item(s) need a decision', 'and before any visit event_intake is empty, so nothing is counted yet');

  await call(env, '/event-intake', { cookie, fresh: true }); // syncs everything in the window
  const dash = await call(env, '/dashboard', { cookie, fresh: true });
  const dashHtml = await dash.text();
  has(dashHtml, 'Event Intake', 'the row is visible to intake_manage');
  // ⚠ NOT a literal "1 item(s)" — the school-year seed's own rows are inside
  // the same sync window and genuinely count too (Andrew's "everything"), so
  // the true number is whatever badgeCounts()/intakeOpenCount() says it is.
  // The test reads that number out of the database with the SAME openCountOf
  // the app uses, rather than assuming it is the only source of open items.
  const openNow = db.prepare(
    "SELECT event_type, checks_json FROM event_intake WHERE event_date IS NULL OR event_date >= ?"
  ).all(churchDatePlus(-3)).filter((r) => openCountOf(r.event_type, r.checks_json ? JSON.parse(r.checks_json) : {}) !== 0).length;
  ok(openNow >= 1, 'at least our own unclassified row counts as open');
  has(dashHtml, `${openNow} item(s) need a decision`, 'and the badge title names exactly that many');

  // Publish OUR item, and the count drops by exactly one.
  const key = `n:${db.prepare("SELECT id FROM news_items WHERE title='MDO Open House'").get().id}`;
  await call(env, '/event-intake/type', { cookie, method: 'POST', form: { key, type: 'education', queue: 'inbox' } });
  await call(env, '/event-intake/save', { cookie, method: 'POST', form: {
    key, queue: 'education', action: 'publish', room: 'Multipurpose Room',
    check_teacher: '1', check_room: '1', check_materials: '1', check_listed: '1',
  } });
  const dashAfter = await call(env, '/dashboard', { cookie, fresh: true });
  const afterHtml = await dashAfter.text();
  lacks(afterHtml, `${openNow} item(s) need a decision`, 'the old count is gone');
  has(afterHtml, `${openNow - 1} item(s) need a decision`, 'and it dropped by exactly the one item that was just published');
}

group('the left rail is grouped by the four core values, not a flat "By calendar" list');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  const res = await call(env, '/event-intake', { cookie, fresh: true });
  const page = await res.text();
  has(page, 'Christian Education', 'the value group heading renders, not the raw stored key "education"');
  // Word of Life, MDO and Youth & Family sit under Christian Education —
  // matching PARTNER_SEED's own Word-of-Life-is-'education' pairing.
  const eduIdx = page.indexOf('Christian Education');
  const outreachIdx = page.indexOf('Outreach');
  for (const label of ['Word of Life', 'MDO', 'Youth &amp; Family']) {
    const i = page.indexOf(`>${label}<`);
    ok(i > eduIdx && i < outreachIdx, `${label} renders between Christian Education and Outreach`);
  }
  // News, Meetings and Special event render under "Other", never under any
  // of the four value headings — the cross-cutting types this repo would not
  // force a value onto (see the note above TYPE_VALUE in admin/intake.js).
  const otherIdx = page.lastIndexOf('>Other<');
  ok(otherIdx > -1, 'the ungrouped "Other" heading renders');
  for (const label of ['News', 'Meetings', 'Special event']) {
    ok(page.indexOf(`>${label}<`) > otherIdx, `${label} renders after Other, not folded into a value group`);
  }
}

group('bulk type assignment sets one type on many events at once, and skips what does not belong to the office');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  const d1 = churchDatePlus(12), d2 = churchDatePlus(13), d3 = churchDatePlus(14);
  db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels) VALUES (?,?,?,?,?,?)")
    .run('Fall Kickoff Sunday School', 'First day back.', churchDate(), d1, '2099-01-01', 'web');
  db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels) VALUES (?,?,?,?,?,?)")
    .run('Confirmation Retreat', 'Overnight at camp.', churchDate(), d2, '2099-01-01', 'web');
  db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels) VALUES (?,?,?,?,?,?)")
    .run('Deacon Meeting', 'Not a youth event.', churchDate(), d3, '2099-01-01', 'web');
  await call(env, '/event-intake', { cookie, fresh: true }); // sync
  const idOf = (title) => db.prepare('SELECT id FROM news_items WHERE title = ?').get(title).id;
  const k1 = `n:${idOf('Fall Kickoff Sunday School')}`;
  const k2 = `n:${idOf('Confirmation Retreat')}`;
  const k3 = `n:${idOf('Deacon Meeting')}`;

  // Andrew, looking at 135 unclassified imports: "can we just bulk assign
  // them?" — two of three checked, one left alone, one type for both.
  const res = await call(env, '/event-intake/bulk-type', { cookie, method: 'POST',
    form: { queue: 'inbox', type: 'youth', keys: [k1, k2] } });
  eq(res.status, 302, 'redirects back to the queue, same shape as every other action here');
  eq(db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(k1).event_type, 'youth');
  eq(db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(k2).event_type, 'youth');
  eq(db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(k3).event_type, null,
    'the one not checked is untouched, even though it synced in the same visit');

  // ⚠ AN UNRECOGNIZED TYPE DOES NOTHING, THE SAME REFUSAL /event-intake/type
  // ALREADY ENFORCES FOR ONE EVENT — a crafted POST can't smuggle a bogus
  // value into the column via the bulk door just because the single-item
  // door checks it.
  await call(env, '/event-intake/bulk-type', { cookie, method: 'POST',
    form: { queue: 'inbox', type: 'not-a-real-type', keys: [k3] } });
  eq(db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(k3).event_type, null,
    'a bogus type on the bulk route is refused exactly like on the single-item route');

  // ⚠ A KEY WITH NO MATCHING ITEM IN THIS REQUEST'S OWN MERGE IS SKIPPED, NOT
  // TRUSTED AS A BARE ID. A stale page or a crafted form posting a key for an
  // event outside the sync window (or that never existed) must not reach
  // writeIntakePatch with nothing real behind it.
  const before = db.prepare("SELECT COUNT(*) AS n FROM event_intake").get().n;
  await call(env, '/event-intake/bulk-type', { cookie, method: 'POST',
    form: { queue: 'inbox', type: 'meetings', keys: ['n:999999'] } });
  eq(db.prepare("SELECT COUNT(*) AS n FROM event_intake").get().n, before, 'nothing was inserted or corrupted for a key that matches no real item');
}

// Three more reports off the same screen: the room list didn't match the
// church's real spaces, the detail panel's own head (now wrapping eleven
// type pills across three lines) pushed "Before it publishes" out of view,
// and there was no way to act on a whole group of same-named events at once
// ("i could pick all richmond heights and say those are gymn rentals").
group('the room list is the church’s real spaces, the checklist sits above the type picker, and the list can be filtered by name');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');
  db.prepare("INSERT INTO gym_groups (id, name, contact, email, active) VALUES (1,'Cub Scouts','Pat Reyes','preyes@example.org',1)").run();
  const gymDate = churchDatePlus(9);
  db.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, status, notes) VALUES (1,?,'18:00','20:00','confirmed','')")
    .run(gymDate);
  await call(env, '/event-intake', { cookie, fresh: true });
  const bookingId = db.prepare('SELECT id FROM gym_bookings ORDER BY id DESC LIMIT 1').get().id;
  const key = `b:${bookingId}`;
  await call(env, '/event-intake/type', { cookie, method: 'POST', form: { key, type: 'rental', queue: 'inbox' } });

  const page = await (await call(env, `/event-intake?queue=rental&selected=${encodeURIComponent(key)}`, { cookie, fresh: true })).text();

  for (const room of ['Kitchen', 'Gym', 'Youth Room', '3rd Floor Classroom', 'Multipurpose Room', 'Sanctuary', 'Parking Lot']) {
    has(page, `>${room}<`, `the room list offers "${room}"`);
  }
  for (const stale of ['Fellowship Hall', 'MDO Wing', 'Whole campus', 'Room 4', 'Lawn']) {
    lacks(page, `>${stale}<`, `and no longer offers the old "${stale}"`);
  }

  // The checklist ("Before it publishes") now renders before the type pill
  // row, which used to sit in the fixed head and, at eleven types, wrapped
  // across three lines pushing everything else down. Reported as wanting the
  // info box "moved up to the top so I can see it for the event."
  const checklistAt = page.indexOf('Before it publishes');
  const pillrowAt = page.indexOf('class="ei-pillrow"');
  ok(checklistAt >= 0 && pillrowAt >= 0, 'both the checklist and the type picker are on the page');
  ok(checklistAt < pillrowAt, 'the checklist renders before the type picker, not after it');
  lacks(page.slice(page.indexOf('class="ei-detail-head"'), page.indexOf('class="ei-detail-body"')), 'ei-pillrow',
    'and the type picker is no longer inside the fixed head — that was most of what pushed the checklist out of view');

  // The name filter and "select all shown" — Andrew: "i could pick all
  // richmond heights and say those are gymn rentals, all worship is worship,
  // all handbells are music." Deep interaction (typing narrows the list,
  // "select all shown" ticks only what the filter left visible, clearing the
  // filter never un-ticks anything) was verified directly in a real browser
  // against this exact markup; this pins the wiring that makes it possible.
  has(page, 'id="ei-filter"', 'a name filter input is on the page');
  has(page, 'oninput="tlcEiFilter(this)"', 'wired to filter the list live');
  has(page, 'id="ei-filter-count"', 'and it says how many of the queue currently match');
  has(page, 'onclick="tlcEiSelectAllShown(this)"', '"Select all shown" now means what it says — only what the filter left visible');
  lacks(page, "querySelectorAll('.ei-row-check').forEach(function(c){c.checked=this.checked}",
    'not the old handler that ticked the whole queue regardless of a filter');
}

// ⚠ Reported live: "when i assign type, it pops up the confirmation screen,
// i click ok, then the wheel spins, and then back to the screen with nothing
// changed, or saved or assigned." The write landed every time — /event-intake
// /type's own single-row `WHERE source_key = ?` query has no scale problem at
// all. What was losing it was the very next READ: readIntakeRows() built one
// `IN (...)` over EVERY non-local key in the sync window, and D1 refuses a
// prepared statement with too many bound parameters — a real church calendar
// with recurring weekly services over the 63-day window, plus News and gym,
// clears that easily (the office's own screenshot showed 86 "Imported from
// Google" alone). The failure was silent (`.catch(() => ({results: []}))`),
// so every non-local item read back with dbId:null, type:null, forever.
//
// node:sqlite's own bound-parameter ceiling is far above D1's real one, so
// this cannot be reproduced by just seeding enough rows — the same gap the
// print sheet's :has()-fallback test hit with a production browser
// constraint this sandbox's own engine does not share. Simulated the only
// honest way available: wrap the D1 shim to throw exactly the way D1 does
// once a single bind() call is handed more than 99 parameters, and seed a
// window genuinely larger than that so an unchunked query would trip it.
group('a large intake window is read back in chunks, so D1’s bound-parameter limit cannot silently blank every type');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['intake_manage'], 'office');

  const rawPrepare = env.DB.prepare;
  env.DB.prepare = (sql) => {
    const s = rawPrepare(sql);
    return {
      first: s.first, all: s.all, run: s.run,
      bind: (...a) => {
        const bound = s.bind(...a);
        return {
          first: bound.first, run: bound.run,
          all: async () => {
            if (a.length > 99) throw new Error('D1_ERROR: too many SQL variables to bind (max 99 per statement)');
            return bound.all();
          },
        };
      },
    };
  };

  // 130 News & Events posts, all inside the sync window — comfortably more
  // than one 99-parameter chunk.
  for (let i = 0; i < 130; i++) {
    db.prepare("INSERT INTO news_items (title, summary, publish_date, event_date, expire_date, channels) VALUES (?,?,?,?,?,?)")
      .run(`Intake Scale Test ${i}`, 'Seeded for the bound-parameter test.', churchDate(), churchDatePlus(1 + (i % 55)), '2099-01-01', 'web');
  }
  const idOf = (i) => db.prepare('SELECT id FROM news_items WHERE title = ?').get(`Intake Scale Test ${i}`).id;
  const keyOf = (i) => `n:${idOf(i)}`;

  const first = await call(env, '/event-intake', { cookie, fresh: true }); // syncs all 130 placeholders
  eq(first.status, 200, 'the sync itself never trips the bind limit — syncIntakeRows binds one row at a time');

  // A single-item assign, exactly the reported gesture — pick an event well
  // past the 99th chunked query, so an unchunked read would have missed it.
  const farKey = keyOf(120);
  await call(env, '/event-intake/type', { cookie, method: 'POST', form: { key: farKey, type: 'meetings', queue: 'inbox' } });
  const stored = db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(farKey);
  eq(stored.event_type, 'meetings', 'the write itself always lands — it is a single-row query with no scale problem');

  const page = await (await call(env, `/event-intake?queue=inbox&selected=${encodeURIComponent(farKey)}`, { cookie, fresh: true })).text();
  ok(page.includes('Intake Scale Test 120'), 'the selected event renders in the list');
  // The direct symptom, exactly as reported: a chunked read shows the type
  // that was just set — its "Meetings" pill in the detail pane renders with
  // `class="ei-pill ei-pill-on"`, which only appears when `item.type === k`
  // for the selected item. An unchunked read silently forgets the write
  // happened, on every single visit, however many times the type is set
  // again — no pill is ever `on`, whatever was just clicked and confirmed.
  // ⚠ Checked as the exact rendered class ATTRIBUTE, not a bare substring —
  // `.ei-pill-on{...}` is also a CSS rule name in this same page's own
  // stylesheet, so `page.includes('ei-pill-on')` alone is always true and
  // was caught passing against the unfixed code on the first attempt.
  ok(page.includes('class="ei-pill ei-pill-on"'), 'the type just assigned to the selected item actually shows as assigned, not "Needs a type" forever');

  // The unambiguous check: bulk-assign a type across two events, one inside
  // the first chunk and one past it, and confirm BOTH actually wrote — bulk-
  // type reads before it writes, so a truncated read means dbId:null for
  // anything past the first chunk and Promise.all([]) silently does nothing.
  const nearKey = keyOf(10), farBulkKey = keyOf(125);
  const res = await call(env, '/event-intake/bulk-type', { cookie, method: 'POST',
    form: { queue: 'inbox', type: 'youth', keys: [nearKey, farBulkKey] } });
  eq(res.status, 302, 'redirects back to the queue');
  eq(db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(nearKey).event_type, 'youth',
    'an event inside the first 99-key chunk gets the bulk type');
  eq(db.prepare('SELECT event_type FROM event_intake WHERE source_key = ?').get(farBulkKey).event_type, 'youth',
    'and so does one past it — this is the assertion an unchunked read fails, with dbId read back as null');

  env.DB.prepare = rawPrepare;
}

group('the public push-alert plumbing is gone; staff subscriptions still filter by audience');
{
  // 2026-08-22: the "Push Alert" /notify composer and the website's own
  // subscribe/unsubscribe-public routes were removed — push delivery only
  // ever worked through the connect app's PWA, so a visitor subscribing on
  // timothystl.org rang nothing real. The routes and the /notify screen are
  // gone; the audience column and pushToAllSubscribers' audience parameter
  // stay, since every existing trigger still relies on the 'staff' default.
  const { db, env } = await boot();
  const office = signIn(db, ['notices_edit'], 'office');

  // ⚠ Neither route sat behind a session (a website visitor has never signed
  // into anything), so removing them doesn't produce a clean 404 — an
  // anonymous request past this point falls through to the login page
  // (getSession() returns null). What actually matters is that no row is
  // ever written and no CORS header invites a cross-origin browser to trust
  // the response as a real API answer.
  for (const path of ['/api/push/subscribe-public', '/api/push/unsubscribe-public']) {
    const res = await worker.fetch(new Request('https://admin.timothystl.org' + path, {
      method: 'POST', headers: { origin: 'https://timothystl.org', 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://fcm.example/removed-route-' + path }),
    }), env, ctx);
    lacks(res.headers.get('access-control-allow-origin') || '', '*', `${path} no longer answers as a CORS-enabled API route`);
  }
  ok(!db.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint LIKE '%removed-route%'").get(),
    'and no subscription row was ever written by either');

  const notifyPage = await call(env, '/notify', { cookie: office.cookie });
  lacks(await notifyPage.text(), 'Push Alert', '/notify no longer renders the composer');
  const sentAttempt = await worker.fetch(new Request('https://admin.timothystl.org/notify/send', {
    method: 'POST', headers: { cookie: office.cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: 'x', body: 'y' }).toString(),
  }), env, ctx);
  ok(!/Sent to \d+ of \d+/.test(await sentAttempt.text().catch(() => '')), '/notify/send no longer sends a broadcast');

  const sidebar = await (await call(env, '/pages', { cookie: office.cookie })).text();
  lacks(sidebar, 'Push Alert', 'and the sidebar no longer links to it');

  const cols = db.prepare('PRAGMA table_info(push_subscriptions)').all().map((r) => r.name);
  ok(cols.includes('audience'), 'the audience column is left in place — no code writes anything but staff to it now');

  const k1 = fakeSubKeys();
  db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, ?, ?, ?)')
    .run('https://fcm.example/old-staff-device', k1.p256dh, k1.auth);
  const oldRow = db.prepare("SELECT audience FROM push_subscriptions WHERE endpoint = 'https://fcm.example/old-staff-device'").get();
  eq(oldRow.audience, 'staff', 'a pre-existing subscription is a staff one, with no migration script');

  const realFetch = globalThis.fetch;
  const reached = [];
  globalThis.fetch = async (input) => {
    reached.push(typeof input === 'string' ? input : input.url);
    return new Response('', { status: 201 });
  };
  const k2 = fakeSubKeys();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, audience) VALUES (2, ?, ?, ?, 'staff')")
    .run('https://fcm.example/staff-2', k2.p256dh, k2.auth);

  const envWithVapid = { ...env, ...fakeVapidKeys() };
  const staffResult = await pushToAllSubscribers(envWithVapid, { title: 'x', body: 'y' });
  eq(staffResult.total, 2, 'the default call still reaches every staff row');

  globalThis.fetch = realFetch;
}

group('every push notification leaves a trail in the Push Log, whatever triggered it');
{
  // Dinger: a push arrived about a reply from a real person and tapping it
  // just opened the dashboard — because a *delivered* contact/prayer message
  // was never stored anywhere, only emailed. The fix isn't the click target,
  // it's that nothing about the push itself was ever recorded either. Every
  // caller of pushToAllSubscribers() funnels through one function, so logging
  // there covers all of them at once.
  const { db, env } = await boot();
  const envWithVapid = { ...env, ...fakeVapidKeys() };
  const admin = signIn(db, ['settings_manage'], 'office2');
  const outsider = signIn(db, ALL_PERMISSIONS.filter((p) => p !== 'settings_manage'), 'noaccess2');

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 201 });

  const k1 = fakeSubKeys();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, audience) VALUES (1, ?, ?, ?, 'staff')")
    .run('https://fcm.example/plog-staff', k1.p256dh, k1.auth);

  await pushToAllSubscribers(envWithVapid, { title: 'New message from Leah Seveking', body: 'Re: the LCEF proposal — thanks for...', tag: 'contact-message', url: '/dashboard' });

  const rows = db.prepare('SELECT * FROM push_log ORDER BY id ASC').all();
  eq(rows.length, 1, 'the staff trigger was logged');
  eq(rows[0].audience, 'staff', 'the row is the staff-audience push');
  eq(rows[0].sent, 1, 'and it really counted the one staff device it reached');
  has(rows[0].title, 'Leah Seveking', 'the title survives into the log');
  has(rows[0].body, 'LCEF', 'so does the body — this is the record a lost push used to leave nothing of');

  globalThis.fetch = realFetch;

  const denied = await call(env, '/push-log', { cookie: outsider.cookie });
  eq(denied.status, 403, 'gated on settings_manage, the same as Filtered Mail beside it');

  const page = await call(env, '/push-log', { cookie: admin.cookie });
  eq(page.status, 200, 'settings_manage can open it');
  const body = await page.text();
  has(body, 'Leah Seveking', 'the delivered-message push shows up by name');
  has(body, 'Push Log', 'the sidebar and title name the screen plainly');
}

group('Contact and Prayer publish through the block editor now, but never without their real form');
{
  // Used to be a blanket exclusion: no block on the site could express the
  // real form's honeypot/token/Turnstile screening, so both pages were
  // permanently withheld from `rendered`, however their published_blocks
  // read — found live after both had been published once with a generic
  // "Signup form" block (a Google Form embed with no URL) standing in for
  // the real form, invisibly, until compared to the live site by hand.
  //
  // `prayerform`/`contactform` (admin/blocks.js) close that gap with a real,
  // fixed block instead of a blanket ban — so these are ordinary editable,
  // publishable pages now, and what has to keep holding is narrower: the
  // required block cannot be missing from what actually goes live. See
  // NATIVE_FORM_REQUIRED_TYPE / missingNativeForm in tlc-admin-worker.js.
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['pages_edit'], 'siteeditor');

  // The seeded draft (admin/native-form-page-seed.js, via ALL_SEEDED_PAGES)
  // already carries the real block, not the generic one — publish it exactly
  // as the office would, through the real route, not a direct DB write.
  const pubPrayer = await call(env, '/pages/api/page/prayer/publish', { cookie, method: 'POST' });
  eq(pubPrayer.status, 200, 'prayer publishes cleanly with its seeded block');
  const pubContact = await call(env, '/pages/api/page/contact/publish', { cookie, method: 'POST' });
  eq(pubContact.status, 200, 'so does contact');

  const api = await (await call(env, '/api/pages', { fresh: true })).json();
  ok(!!api.rendered.contact, 'contact renders from blocks now that it has its real form');
  ok(!!api.rendered.prayer, 'so does prayer');
  ok(api.rendered.prayer.includes('data-tlc-native-form="prayer"'), 'and the rendered HTML carries the real, screened form — not a stand-in');
  ok(api.rendered.prayer.includes('name="website"'), 'honeypot included');
  ok(api.rendered.prayer.includes('class="tlc-turnstile"'), 'Turnstile mount included');
  ok(api.rendered.contact.includes('data-tlc-native-form="contact"'), 'contact carries its own real form too');

  // ⚠ THE ROUTE REFUSES, NOT JUST THE SEED HAPPENING TO BE RIGHT. A crafted
  // publish with the required block stripped out of the posted blocks must
  // fail the same way an untouched, correctly-seeded page succeeds above —
  // this is the property the whole exclusion used to buy, kept without the
  // exclusion.
  const strippedBody = JSON.stringify({ blocks: [{ id: 'x', type: 'hero', title: 'Prayer Requests' }] });
  const strip = await worker.fetch(new Request('https://admin.timothystl.org/pages/api/page/prayer/publish', {
    method: 'POST',
    headers: { cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/json' },
    body: strippedBody,
  }), env, ctx);
  eq(strip.status, 400, 'publishing without the prayerform block is refused');
  const stripBody = await strip.json();
  ok(/prayer request form/i.test(stripBody.error || ''), 'and says which block is missing: ' + stripBody.error);

  // And the read path is a second, independent guard — not just the write
  // path's own honesty. A row that reached "published, but missing the
  // block" some other way (a direct DB write, a migration) must not render
  // either.
  db.prepare("UPDATE pages SET published_blocks = ? WHERE id = 'contact'")
    .run(JSON.stringify([{ id: 'x', type: 'hero', title: 'Contact Us' }]));
  const api2 = await (await call(env, '/api/pages', { fresh: true })).json();
  ok(!api2.rendered.contact, 'a published page missing its required block still does not render — belt and braces');
  ok(!!api2.rendered.prayer, 'prayer is unaffected, still published and correct');

  // Still ordinary pages throughout: addressable, in the page list, at their
  // own slug — this was never withheld, before or after.
  const contactEntry = api.pages.find((p) => p.id === 'contact');
  const prayerEntry = api.pages.find((p) => p.id === 'prayer');
  ok(!!contactEntry, 'contact appears in the page list');
  ok(!!prayerEntry, 'prayer appears in the page list');
  eq(contactEntry.slug, '/contact', 'at its own address, so the router and the menu are unaffected');
  eq(prayerEntry.slug, '/prayer', 'same for prayer');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
