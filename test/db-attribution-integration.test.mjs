// Integration check for admin/db-attribution.js's wiring into tlc-admin-worker.js's real
// fetch() — not just the standalone module. Two things only a real dispatch through the
// actual worker can prove: (1) the SCHEMA GATE's MARKERS_SEEN/SETUP_DONE identity caches
// still work across repeated requests once env.DB is wrapped (the whole reason the module
// memoizes by real-db identity instead of wrapping fresh every request — see
// admin/db-attribution.js's file-level comment), and (2) an ordinary request doesn't trip the
// d1_query_attribution log.
//   node --experimental-loader ./test/html-loader.mjs test/db-attribution-integration.test.mjs
import { DatabaseSync } from 'node:sqlite';
import worker from '../tlc-admin-worker.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
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

const db = new DatabaseSync(':memory:');
const env = { DB: d1(db) };

group('the schema gate only runs its migration block once per env.DB, even though fetch() wraps env on every call');
{
  const logs = [];
  const orig = console.log;
  console.log = (...args) => { logs.push(args); orig(...args); };
  try {
    await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx);
    // If wrapping broke the MARKERS_SEEN/SETUP_DONE identity check, _schema_version wouldn't
    // exist yet on request 1 either -- so this alone doesn't distinguish. The real proof is
    // that a SECOND request doesn't re-run the ~140-statement block: check the table it
    // creates exists, then confirm a second request doesn't blow past the log threshold from
    // re-running that block (which would push it over ADMIN_QUERY_LOG_THRESHOLD every time).
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_version'"
    ).get();
    ok(!!tableExists, 'the schema gate ran at least once and created _schema_version');
  } finally {
    console.log = orig;
  }
}

group('a second request to the same login route logs no d1_query_attribution line (schema gate skipped, low query count)');
{
  const logs = [];
  const orig = console.log;
  console.log = (...args) => logs.push(args);
  try {
    const res = await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx);
    ok(res.status < 500, 'the request still succeeds');
  } finally {
    console.log = orig;
  }
  const attributionLogs = logs.filter((l) => l[0] === 'd1_query_attribution');
  eq(attributionLogs.length, 0, 'no attribution log on a second, ordinary low-cost request');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
