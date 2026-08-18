// Run with: node --experimental-loader ./test/html-loader.mjs test/market-jumpbar-recovery.test.mjs
//
// Reproduces the real production bug behind "the jump to bars didnt get
// added": /christmasmarket/vendors had live content that predates every
// commit in this repo's history (built by hand, directly in the editor,
// before Phase 1's own publish migration ever ran), which is why the
// updated_by-guarded MARKET_PUBLISH_MARKER (v1/v2/v3) never once reached it.
// /christmasmarket separately had its regenerated seed (jump bar included)
// stuck in limbo — canReseed() correctly refuses to touch an already-published
// page, so the new block never even reached the draft.
//
// This drives the real worker's startup migration block against a database
// hand-set to that exact broken shape, then asserts the two new one-time
// fixes (tlc-admin-worker.js, "THE VENDOR PAGE'S LIVE CONTENT WAS NEVER THE
// SEED" and "/christmasmarket'S JUMP BAR") actually correct it — and that the
// christmasmarket fix touches nothing else on that page.
import { DatabaseSync } from 'node:sqlite';
import worker from '../tlc-admin-worker.js';
import { MARKET_VENDORS_PAGE } from '../admin/market-page-seed.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

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

async function call(env, path) {
  const req = new Request('https://admin.timothystl.org' + path, {
    headers: { origin: 'https://admin.timothystl.org' },
  });
  return worker.fetch(req, env, ctx);
}

// One real DB, seeded and migrated normally first — the healthy baseline
// every real deploy starts from.
const db = new DatabaseSync(':memory:');
{
  const env = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test' };
  await call(env, '/login');
}

// ── Corrupt the two pages into the exact shape found in production ──────────
group('reproduce the broken production shape');
{
  // marketvendors: published, but with hand-typed content that predates
  // every seed this repo has ever committed — a random block id, no mv-jump,
  // no mv-facts, wording that never matched market-page-seed.js. updated_by
  // is a real person, which is what makes MARKET_PUBLISH_MARKER refuse it.
  const stale = [
    { id: 'mv-hero', type: 'hero', title: 'Bring your goods to the Christmas Market', bg: 3, ink: 3 },
    { id: 'bmsy24gpi374', type: 'buttons', items: [{ title: 'Vendor Application', url: '#vendor' }] },
  ];
  db.prepare("UPDATE pages SET status='published', updated_by=?, blocks=?, published_blocks=? WHERE id='marketvendors'")
    .run('andrew', JSON.stringify(stale), JSON.stringify(stale));
  db.prepare("DELETE FROM _schema_version WHERE key='market_vendors_force_republish_v1'").run();

  // christmasmarket: published, real content the office wrote, but from
  // before Phase 3 — no jumplinks block anywhere.
  const preP3 = [
    { id: 'christmasmarket-1', type: 'hero', title: 'Weihnachtsmarkt' },
    { id: 'christmasmarket-2', type: 'text', body: '<p>Save the date.</p>' },
  ];
  db.prepare("UPDATE pages SET status='published', updated_by=?, blocks=?, published_blocks=? WHERE id='christmasmarket'")
    .run('office_person', JSON.stringify(preP3), JSON.stringify(preP3));
  db.prepare("DELETE FROM _schema_version WHERE key='christmasmarket_jumpbar_v1'").run();

  const mv = db.prepare("SELECT updated_by, published_blocks FROM pages WHERE id='marketvendors'").get();
  ok(mv.updated_by !== 'migration', 'setup: marketvendors now looks hand-edited');
  ok(!mv.published_blocks.includes('mv-jump'), 'setup: marketvendors has no jump bar yet');
  const cm = db.prepare("SELECT published_blocks FROM pages WHERE id='christmasmarket'").get();
  ok(!cm.published_blocks.includes('jumplinks'), 'setup: christmasmarket has no jump bar yet');
}

// A fresh env.DB object — MARKERS_SEEN is a WeakMap keyed on it, so this is
// what makes the next request actually re-read _schema_version instead of
// trusting a memo from before the corruption above.
const env2 = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test' };
await call(env2, '/login');

group('the vendor page is force-republished from the current seed');
{
  const row = db.prepare("SELECT status, updated_by, blocks, published_blocks FROM pages WHERE id='marketvendors'").get();
  const published = JSON.parse(row.published_blocks);
  eq(row.status, 'published', 'still published');
  eq(row.updated_by, 'migration', 'updated_by is reset, so a FUTURE person edit is respected again');
  ok(published.some((b) => b.id === 'mv-jump' && b.type === 'jumplinks'), 'the jump bar block is now on the live page');
  ok(published.some((b) => b.id === 'mv-facts'), 'the facts band is now on the live page too');
  eq(JSON.stringify(row.blocks), JSON.stringify(row.published_blocks), 'draft and published match — nothing left half-applied');
  const wantHero = MARKET_VENDORS_PAGE.blocks.find((b) => b.id === 'mv-hero');
  ok(published.some((b) => b.id === 'mv-hero' && b.title === wantHero.title), 'the hero is the current seed, not the stale wording');

  const rev = db.prepare("SELECT blocks, note FROM page_revisions WHERE page_id='marketvendors' ORDER BY id DESC LIMIT 1").get();
  ok(!!rev, 'the pre-existing content was snapshotted before being overwritten');
  ok(rev.blocks.includes('bmsy24gpi374'), 'the snapshot really is the stale hand-typed content, not the new seed');
}

group('the vendor page fix is idempotent — a second boot does not re-snapshot');
{
  const before = db.prepare("SELECT COUNT(*) AS n FROM page_revisions WHERE page_id='marketvendors'").get().n;
  const env3 = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test' };
  // The marker is 'done' now, so this alone would already skip it — delete it
  // to prove the CONTENT-equality guard is what actually stops a re-snapshot,
  // not just the marker.
  db.prepare("DELETE FROM _schema_version WHERE key='market_vendors_force_republish_v1'").run();
  await call(env3, '/login');
  const after = db.prepare("SELECT COUNT(*) AS n FROM page_revisions WHERE page_id='marketvendors'").get().n;
  eq(after, before, 'no new revision row — the live page already matches the seed');
}

group('christmasmarket gets the jump bar spliced in, and nothing else');
{
  const row = db.prepare("SELECT updated_by, blocks, published_blocks FROM pages WHERE id='christmasmarket'").get();
  const published = JSON.parse(row.published_blocks);
  const draft = JSON.parse(row.blocks);
  eq(row.updated_by, 'office_person', "the office's own authorship is untouched — this was never treated as a person's edit needing to be overwritten");
  eq(published.length, 3, 'exactly one block was added to the two that were there');
  eq(published[1].type, 'jumplinks', 'inserted right under the banner, matching where the extractor would have put it');
  eq(published[0].id, 'christmasmarket-1', 'the hero is exactly as it was');
  eq(published[2].id, 'christmasmarket-2', "the office's own text block is exactly as it was — same id, untouched");
  eq(published[2].body, '<p>Save the date.</p>', "the office's own words were not touched");
  eq(JSON.stringify(draft), JSON.stringify(published), 'the draft got the same splice, so the editor and the live page agree');
}

group('christmasmarket is idempotent — a second boot does not add a second bar');
{
  const env4 = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test' };
  db.prepare("DELETE FROM _schema_version WHERE key='christmasmarket_jumpbar_v1'").run();
  await call(env4, '/login');
  const row = db.prepare("SELECT published_blocks FROM pages WHERE id='christmasmarket'").get();
  const published = JSON.parse(row.published_blocks);
  eq(published.filter((b) => b.type === 'jumplinks').length, 1, 'still exactly one jump bar, not two');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
