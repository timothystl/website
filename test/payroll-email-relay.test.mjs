// /payroll/email (emailing the gross-pay report to the bookkeeper) sits behind
// the SAME global CSRF Origin/Referer gate as every other admin POST route
// (tlc-admin-worker.js, right before the route dispatch below it) -- Finance's
// contract-relay call never carries a matching Origin header, exactly the
// problem PR #586 fixed for the /sb/* Supabase proxy. This proves the same
// fix applied to that earlier, more central gate: a contract-relay call to
// /payroll/email is never CSRF-blocked, a real browser session still is, and
// the sent email correctly attributes to the relayed identity, not "the
// office" (there is no session to read a username from).
//   node --experimental-loader ./test/html-loader.mjs test/payroll-email-relay.test.mjs
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
  BREVO_API_KEY: 'test-key',
  FINANCE_PAYROLL_CONTRACT_KEY: CONTRACT_KEY,
  FINANCE_ACCESS_TEAM_DOMAIN: TEAM,
  FINANCE_ACCESS_AUD: AUD,
};
await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx);
db.prepare("INSERT INTO site_settings (key,value) VALUES ('payroll_bookkeeper_email','books@example.com') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();

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
const sentEmails = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url === CERTS_URL) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  if (url.startsWith('https://api.brevo.com/')) {
    sentEmails.push(JSON.parse(init.body));
    return new Response('{}', { status: 201 });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
};

function accessJwtPayload() {
  const now = Math.floor(Date.now() / 1000);
  return { email: 'bookkeeper@timothystl.org', iss: `https://${TEAM}`, aud: AUD, exp: now + 3600, iat: now };
}

// A different period per test so the "already emailed today" dedup (a real,
// deliberate 12-hour check on the same period) never interferes across them.
let periodSeq = 0;
function reportFor(periodStart) {
  return {
    periodStart, periodEnd: periodStart, periodLabel: `Period ${periodStart}`,
    approved: true, approvedBy: 'bookkeeper', total: 100,
    mdo: { subtotal: 100, rows: [{ name: 'A Person', salaried: true, rate: 0, hours: 0, pto: 0, gross: 100 }] },
    church: { subtotal: 0, rows: [] },
  };
}
function nextPeriod() { periodSeq += 1; return `2026-0${periodSeq}-01`; }

try {
  group('a contract-relay call reaches /payroll/email without a matching Origin/Referer');
  {
    resetPayrollContractAuthCacheForTests();
    const token = await signToken(keyPair.privateKey, 'test-kid', accessJwtPayload());
    const res = await worker.fetch(new Request('https://admin.timothystl.org/payroll/email', {
      method: 'POST',
      headers: { 'X-Contract-Key': CONTRACT_KEY, 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(reportFor(nextPeriod())),
    }), env, ctx);
    eq(res.status, 200, 'a contract-relay call with no Origin/Referer header succeeds');
    const body = await res.json();
    eq(body.ok, true, 'and the email actually sends');
    eq(sentEmails.at(-1).to[0].email, 'books@example.com', 'to the configured bookkeeper');
  }

  group('the sent email attributes to the relayed identity, not "the office"');
  {
    resetPayrollContractAuthCacheForTests();
    const token = await signToken(keyPair.privateKey, 'test-kid', accessJwtPayload());
    await worker.fetch(new Request('https://admin.timothystl.org/payroll/email', {
      method: 'POST',
      headers: { 'X-Contract-Key': CONTRACT_KEY, 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(reportFor(nextPeriod())),
    }), env, ctx);
    ok(sentEmails.at(-1).htmlContent.includes('Sent from the Timothy Lutheran admin by bookkeeper.'),
      'the relayed username is credited, not a fallback');
  }

  group('a browser session with no Origin/Referer is still blocked (the gate still does its job)');
  {
    resetPayrollContractAuthCacheForTests();
    const res = await worker.fetch(new Request('https://admin.timothystl.org/payroll/email', {
      method: 'POST',
      headers: { Cookie: `tlc_session=${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(reportFor(nextPeriod())),
    }), env, ctx);
    eq(res.status, 403, 'a session-cookie call with no matching Origin/Referer is still rejected');
    eq(await res.text(), 'Cross-origin request blocked.', 'the same message as every other CSRF refusal');
  }

  group('a browser session WITH the correct Origin still works (unchanged happy path)');
  {
    resetPayrollContractAuthCacheForTests();
    const res = await worker.fetch(new Request('https://admin.timothystl.org/payroll/email', {
      method: 'POST',
      headers: { Cookie: `tlc_session=${SESSION_TOKEN}`, Origin: 'https://admin.timothystl.org', 'Content-Type': 'application/json' },
      body: JSON.stringify(reportFor(nextPeriod())),
    }), env, ctx);
    eq(res.status, 200, 'a session-cookie call with the real admin Origin still succeeds');
    ok(sentEmails.at(-1).htmlContent.includes('Sent from the Timothy Lutheran admin by bookkeeper.'),
      'and still attributes correctly from the session');
  }

  group('a contract-relay call without payroll_manage on the resolved user is refused');
  {
    resetPayrollContractAuthCacheForTests();
    db.prepare('INSERT INTO users (username,password_hash,permissions,email,created_at,active) VALUES (?,?,?,?,?,1)')
      .run('nobody', 'pbkdf2:1:x:y', JSON.stringify([]), 'nobody@timothystl.org', nowIso);
    const token = await signToken(keyPair.privateKey, 'test-kid', { ...accessJwtPayload(), email: 'nobody@timothystl.org' });
    const res = await worker.fetch(new Request('https://admin.timothystl.org/payroll/email', {
      method: 'POST',
      headers: { 'X-Contract-Key': CONTRACT_KEY, 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(reportFor(nextPeriod())),
    }), env, ctx);
    eq(res.status, 403, 'no payroll_manage on the resolved user is still refused, contract-relay or not');
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
