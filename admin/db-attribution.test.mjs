// Node test harness for admin/db-attribution.js — run with: node admin/db-attribution.test.mjs
//
// The identity-preservation behavior is the whole point of this file, not an incidental
// detail: tlc-admin-worker.js's SCHEMA GATE (MARKERS_SEEN, SETUP_DONE) is a WeakMap keyed on
// env.DB's own object identity, memoizing "has this isolate already run the ~140-statement
// migration block" across requests. A wrapper that handed back a fresh Proxy every request
// would silently defeat that cache and re-run the block on every single request — a real cost
// and latency regression, not just an observability nit. So most of what's tested here is
// that wrapping is stable across repeated calls for the same real db, not just that counting
// works.
import { wrapDbForAttribution, wrapEnvForDbAttribution, logDbAttribution, ADMIN_QUERY_LOG_THRESHOLD } from './db-attribution.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

/** A minimal D1-shaped stub: prepare() returns a chainable object whose bind/first/all/run
 *  resolve without touching a real database. */
function makeFakeDb() {
  const statement = {
    bind: () => statement,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ meta: {} }),
  };
  return { prepare: () => statement };
}

group('wrapDbForAttribution: counting');
{
  const { db, counter } = wrapDbForAttribution(makeFakeDb());
  eq(counter.queries, 0, 'starts at zero');
  db.prepare('SELECT 1');
  db.prepare('SELECT 2');
  eq(counter.queries, 2, 'counts each prepare() call');
}

group('wrapDbForAttribution: identity is memoized per real db (the load-bearing behavior)');
{
  const realDb = makeFakeDb();
  const first = wrapDbForAttribution(realDb);
  const second = wrapDbForAttribution(realDb);
  ok(first.db === second.db, 'the SAME real db always gets back the identical wrapped proxy');
  ok(first.counter === second.counter, 'and the identical counter object — no reset on re-wrap');

  first.db.prepare('SELECT 1');
  eq(second.counter.queries, 1, 'a query counted through one call site is visible through the other');

  const otherDb = makeFakeDb();
  const third = wrapDbForAttribution(otherDb);
  ok(third.db !== first.db, 'a DIFFERENT real db gets its own, independent wrapped proxy');
  eq(third.counter.queries, 0, 'and its own independent counter, unaffected by the first db\'s activity');
}

group('wrapDbForAttribution: prepared statements still work (bind/first/all/run unaffected)');
{
  const { db } = wrapDbForAttribution(makeFakeDb());
  const stmt = db.prepare('SELECT 1').bind(1);
  ok((await stmt.first()) === null, 'first() resolves');
  const all = await stmt.all();
  eq(all.results.length, 0, 'all() resolves');
  const run = await stmt.run();
  ok(typeof run.meta === 'object', 'run() resolves');
}

group('wrapDbForAttribution: an undefined db passes through without throwing');
{
  const { db, counter } = wrapDbForAttribution(undefined);
  eq(db, undefined, 'db stays undefined');
  eq(counter.queries, 0, 'counter stays at zero');
}

group('wrapEnvForDbAttribution: wraps only DB; every other binding passes through untouched');
{
  const realDb = makeFakeDb();
  const kv = { get: async () => null };
  const env = { DB: realDb, IMAGES: kv, BREVO_API_KEY: 'secret' };
  const { env: wrapped, counter } = wrapEnvForDbAttribution(env);

  ok(wrapped.IMAGES === kv, 'IMAGES binding untouched');
  eq(wrapped.BREVO_API_KEY, 'secret', 'plain var untouched');
  ok(wrapped.DB !== realDb, 'DB is the wrapped proxy, not the raw binding');

  wrapped.DB.prepare('SELECT 1');
  eq(counter.queries, 1, 'counts through the wrapped env');
}

group('wrapEnvForDbAttribution: env.DB keeps the SAME identity across repeated calls (the schema-gate guarantee)');
{
  const realDb = makeFakeDb();
  const env = { DB: realDb };
  const { env: firstEnv } = wrapEnvForDbAttribution(env);
  const { env: secondEnv } = wrapEnvForDbAttribution(env);

  // This is exactly the check tlc-admin-worker.js's MARKERS_SEEN/SETUP_DONE WeakMaps rely on
  // (MARKERS_SEEN.get(env.DB)) — if this ever fails, the schema-migration block would silently
  // start re-running on every request instead of once per isolate.
  ok(firstEnv.DB === secondEnv.DB, 'env.DB resolves to the identical object on every call, across separate wrapEnvForDbAttribution invocations for the same real env');
}

group('wrapEnvForDbAttribution: a request\'s count survives being read via a fresh wrap call mid-isolate');
{
  // Simulates what tlc-admin-worker.js's fetch() does on every request: call
  // wrapEnvForDbAttribution again (cheap — it just looks up the cache), read the counter
  // before dispatching, then diff after.
  const env = { DB: makeFakeDb() };

  const { env: reqOneEnv, counter: reqOneCounter } = wrapEnvForDbAttribution(env);
  const reqOneStart = reqOneCounter.queries;
  reqOneEnv.DB.prepare('SELECT a');
  reqOneEnv.DB.prepare('SELECT b');
  const reqOneUsed = reqOneCounter.queries - reqOneStart;
  eq(reqOneUsed, 2, 'request 1 sees its own 2 queries');

  const { counter: reqTwoCounter } = wrapEnvForDbAttribution(env);
  ok(reqTwoCounter === reqOneCounter, 'the counter is the same shared object across requests, by design');
  eq(reqTwoCounter.queries, 2, 'request 2 starts counting from where request 1 left off, not from zero');
}

group('logDbAttribution: threshold behavior uses the start/end delta, not the raw total');
{
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args);
  try {
    const counter = { queries: 100 }; // isolate-lifetime total is already large
    logDbAttribution('/admin/api/reports', 'GET', counter, 100 - ADMIN_QUERY_LOG_THRESHOLD);
    eq(logs.length, 0, 'exactly at the threshold does not log, even though the lifetime total is huge');

    logDbAttribution('/admin/api/reports', 'GET', counter, 100 - ADMIN_QUERY_LOG_THRESHOLD - 1);
    eq(logs.length, 1, 'one query over the threshold logs');
    const [label, payload] = logs[0];
    eq(label, 'd1_query_attribution', 'labeled for easy grepping');
    const parsed = JSON.parse(payload);
    eq(parsed.route, '/admin/api/reports', 'names the route');
    eq(parsed.method, 'GET', 'names the method');
    eq(parsed.queries, ADMIN_QUERY_LOG_THRESHOLD + 1, 'reports the DELTA for this request, not the isolate-lifetime total (100)');
  } finally {
    console.log = orig;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
