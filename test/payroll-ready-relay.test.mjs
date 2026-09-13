// /api/push/payroll-ready sits behind the SAME global CSRF Origin/Referer gate
// as every other admin POST route (tlc-admin-worker.js, right before the route
// dispatch below it) -- Finance's contract-relay call never carries a matching
// Origin header, exactly the problem PR #586 fixed for the /sb/* Supabase proxy
// and the /payroll/email route already got (see test/payroll-email-relay.test.mjs).
// This proves the same fix applied to this third route: a contract-relay call to
// /api/push/payroll-ready is never CSRF-blocked, a real browser session still is,
// and the per-period dedup still works regardless of which identity triggered it.
//   node --experimental-loader ./test/html-loader.mjs test/payroll-ready-relay.test.mjs
import { DatabaseSync } from 'node:sqlite';
import worker from '../tlc-admin-worker.js';
import { resetPayrollContractAuthCacheForTests } from '../admin/payroll-contract-auth.js';

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
const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;
const CONTRACT_KEY = 'test-contract-secret';

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(new TextEncoder().encode(JSON.stringify(obj))); }
async function makeKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
}
async function signToken(privateKey, kid, payload) {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

const db = new DatabaseSync(':memory:');
const env = {
  DB: d1(db),
  FINANCE_PAYROLL_CONTRACT_KEY: CONTRACT_KEY,
  FINANCE_ACCESS_TEAM_DOMAIN: TEAM,
  FINANCE_ACCESS_AUD: AUD,
  // No VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY on purpose -- pushToAllSubscribers
  // (admin/webpush.js) returns immediately with no D1 read when either is
  // missing, so this test never needs a real push_subscriptions fixture.
};
await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx);

const nowIso = new Date().toISOString();
db.prepare('INSERT INTO users (username,password_hash,permissions,email,created_at,active) VALUES (?,?,?,?,?,1)')
  .run('bookkeeper', 'pbkdf2:1:x:y', JSON.stringify(['payroll_manage']), 'bookkeeper@timothystl.org', nowIso);
const uid = db.prepare("SELECT id FROM users WHERE username='bookkeeper'").get().id;
const SESSION_TOKEN = 'ab'.repeat(32);
db.prepare('INSERT INTO sessions (token,user_id,username,permissions,expires_at,created_at) VALUES (?,?,?,?,?,?)')
  .run(SESSION_TOKEN, uid, 'bookkeeper', JSON.stringify(['payroll_manage']), new Date(Date.now() + 864e5).toISOString(), nowIso);

const keyPair = await makeKeyPair();
const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
jwk.kid = 'test-kid';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url === CERTS_URL) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  throw new Error(`Unexpected fetch in test: ${url}`);
};

function accessJwtPayload() {
  const now = Math.floor(Date.now() / 1000);
  return { email: 'bookkeeper@timothystl.org', iss: `https://${TEAM}`, aud: AUD, exp: now + 3600, iat: now };
}

// A different period per test so the INSERT-as-dedup (a real, deliberate
// PRIMARY KEY collision check) never interferes across unrelated tests.
let periodSeq = 0;
function nextPeriod() { periodSeq += 1; return `2026-0${periodSeq}-01`; }
function notified(periodStart) {
  return !!db.prepare('SELECT 1 FROM payroll_ready_notified WHERE period_start = ?').get(periodStart);
}

try {
  group('a contract-relay call reaches /api/push/payroll-ready without a matching Origin/Referer');
  {
    resetPayrollContractAuthCacheForTests();
    const token = await signToken(keyPair.privateKey, 'test-kid', accessJwtPayload());
    const period = nextPeriod();
    const res = await worker.fetch(new Request('https://admin.timothystl.org/api/push/payroll-ready', {
      method: 'POST',
      headers: { 'X-Contract-Key': CONTRACT_KEY, 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart: period, periodLabel: `Period ${period}` }),
    }), env, ctx);
    eq(res.status, 200, 'a contract-relay call with no Origin/Referer header succeeds');
    const body = await res.json();
    eq(body.success, true, 'and the request is accepted');
    ok(notified(period), 'the period is recorded as notified');
  }

  group('a repeat call for the same period is a silent no-op (dedup unaffected by identity)');
  {
    resetPayrollContractAuthCacheForTests();
    const token = await signToken(keyPair.privateKey, 'test-kid', accessJwtPayload());
    const period = nextPeriod();
    await worker.fetch(new Request('https://admin.timothystl.org/api/push/payroll-ready', {
      method: 'POST',
      headers: { 'X-Contract-Key': CONTRACT_KEY, 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart: period, periodLabel: `Period ${period}` }),
    }), env, ctx);
    const res = await worker.fetch(new Request('https://admin.timothystl.org/api/push/payroll-ready', {
      method: 'POST',
      headers: { Cookie: `tlc_session=${SESSION_TOKEN}`, Origin: 'https://admin.timothystl.org', 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart: period, periodLabel: `Period ${period}` }),
    }), env, ctx);
    eq(res.status, 200, 'the second notice for the same period still succeeds (a silent no-op, not an error)');
    eq(db.prepare('SELECT COUNT(*) AS n FROM payroll_ready_notified WHERE period_start = ?').get(period).n, 1,
      'only one row was ever recorded for this period');
  }

  group('a browser session with no Origin/Referer is still blocked (the gate still does its job)');
  {
    resetPayrollContractAuthCacheForTests();
    const period = nextPeriod();
    const res = await worker.fetch(new Request('https://admin.timothystl.org/api/push/payroll-ready', {
      method: 'POST',
      headers: { Cookie: `tlc_session=${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart: period, periodLabel: `Period ${period}` }),
    }), env, ctx);
    eq(res.status, 403, 'a session-cookie call with no matching Origin/Referer is still rejected');
    eq(await res.text(), 'Cross-origin request blocked.', 'the same message as every other CSRF refusal');
    ok(!notified(period), 'and the period was never recorded as notified');
  }

  group('a browser session WITH the correct Origin still works (unchanged happy path)');
  {
    resetPayrollContractAuthCacheForTests();
    const period = nextPeriod();
    const res = await worker.fetch(new Request('https://admin.timothystl.org/api/push/payroll-ready', {
      method: 'POST',
      headers: { Cookie: `tlc_session=${SESSION_TOKEN}`, Origin: 'https://admin.timothystl.org', 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart: period, periodLabel: `Period ${period}` }),
    }), env, ctx);
    eq(res.status, 200, 'a session-cookie call with the real admin Origin still succeeds');
    ok(notified(period), 'and the period is recorded as notified');
  }

  group('a contract-relay call without payroll_manage on the resolved user is refused');
  {
    resetPayrollContractAuthCacheForTests();
    db.prepare('INSERT INTO users (username,password_hash,permissions,email,created_at,active) VALUES (?,?,?,?,?,1)')
      .run('nobody', 'pbkdf2:1:x:y', JSON.stringify([]), 'nobody@timothystl.org', nowIso);
    const token = await signToken(keyPair.privateKey, 'test-kid', { ...accessJwtPayload(), email: 'nobody@timothystl.org' });
    const period = nextPeriod();
    const res = await worker.fetch(new Request('https://admin.timothystl.org/api/push/payroll-ready', {
      method: 'POST',
      headers: { 'X-Contract-Key': CONTRACT_KEY, 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodStart: period, periodLabel: `Period ${period}` }),
    }), env, ctx);
    eq(res.status, 403, 'no payroll_manage on the resolved user is still refused, contract-relay or not');
    ok(!notified(period), 'and the period was never recorded as notified');
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
