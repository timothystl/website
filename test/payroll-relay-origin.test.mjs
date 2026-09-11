// The payroll Supabase proxy's CSRF Origin/Referer check must never block
// Finance's contract-relay calls (server-to-server, no browser Origin header
// to carry) while still enforcing it for a real browser session — the whole
// point of the check. Drives the actual /sb/* handler in tlc-admin-worker.js
// end to end, the same way test/media-upload.test.mjs does, but without a
// browser: this is a header/auth-path question, not a UI one.
//   node test/payroll-relay-origin.test.mjs
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
  if (url.startsWith('https://dahdstopsumxnqvdclmy.supabase.co/')) {
    return new Response(JSON.stringify([{ id: 'abc', full_name: 'Real Person' }]), { status: 200 });
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
};

function accessJwtPayload() {
  const now = Math.floor(Date.now() / 1000);
  return { email: 'bookkeeper@timothystl.org', iss: `https://${TEAM}`, aud: AUD, exp: now + 3600, iat: now };
}

try {
  group('contract-relay calls (Finance -> Website, server-to-server) are never CSRF-blocked');
  {
    resetPayrollContractAuthCacheForTests();
    const token = await signToken(keyPair.privateKey, 'test-kid', accessJwtPayload());
    // No Origin, no Referer -- exactly what a Cloudflare service-binding fetch sends.
    const res = await worker.fetch(new Request('https://admin.timothystl.org/sb/rest/v1/rpc/payroll_get_staff', {
      method: 'POST',
      headers: { 'X-Contract-Key': CONTRACT_KEY, 'Cf-Access-Jwt-Assertion': token, 'Content-Type': 'application/json' },
      body: '{}',
    }), env, ctx);
    eq(res.status, 200, 'a contract-relay call with no Origin/Referer header succeeds');
    const body = await res.json();
    ok(Array.isArray(body) && body.length === 1, 'and the real RPC response is returned');
  }

  group('a browser session with no Origin/Referer is still blocked (the check still does its job)');
  {
    resetPayrollContractAuthCacheForTests();
    const res = await worker.fetch(new Request('https://admin.timothystl.org/sb/rest/v1/rpc/payroll_get_staff', {
      method: 'POST',
      headers: { Cookie: `tlc_session=${SESSION_TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    }), env, ctx);
    eq(res.status, 403, 'a session-cookie call with no matching Origin/Referer is still rejected');
    eq(await res.text(), 'Cross-origin request blocked.', 'with the same message as before this fix');
  }

  group('a browser session WITH the correct Origin still works (unchanged happy path)');
  {
    resetPayrollContractAuthCacheForTests();
    const res = await worker.fetch(new Request('https://admin.timothystl.org/sb/rest/v1/rpc/payroll_get_staff', {
      method: 'POST',
      headers: { Cookie: `tlc_session=${SESSION_TOKEN}`, Origin: 'https://admin.timothystl.org', 'Content-Type': 'application/json' },
      body: '{}',
    }), env, ctx);
    eq(res.status, 200, 'a session-cookie call with the real admin Origin still succeeds');
  }

  group('a forged Origin header cannot ride along on a contract-relay call to bypass anything new');
  {
    resetPayrollContractAuthCacheForTests();
    const token = await signToken(keyPair.privateKey, 'test-kid', accessJwtPayload());
    const res = await worker.fetch(new Request('https://admin.timothystl.org/sb/rest/v1/rpc/payroll_get_staff', {
      method: 'POST',
      headers: {
        'X-Contract-Key': CONTRACT_KEY, 'Cf-Access-Jwt-Assertion': token,
        Origin: 'https://evil.example', 'Content-Type': 'application/json',
      },
      body: '{}',
    }), env, ctx);
    // The relay path never looks at Origin at all -- a bogus one present alongside valid
    // contract-relay credentials is simply ignored, not treated as a reason to block.
    eq(res.status, 200, 'contract-relay auth is what matters, not whatever Origin happens to be present');
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
