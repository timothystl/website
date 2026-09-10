// Node test harness for admin/payroll-contract-auth.js — run with:
//   node admin/payroll-contract-auth.test.mjs
//
// Covers the two independent building blocks (JWT verification, the shared-
// secret + JWT + users-table resolver) with the same adversarial cases the
// chms repo's equivalent access-jwt.js tests use, since a mistake here is
// exactly as consequential: this is what stands between "any Finance-Access
// user" and "a specific admin who actually holds payroll_manage."
import { verifyAccessJwt, timingSafeEqual, resolvePayrollContractCaller, resetPayrollContractAuthCacheForTests } from './payroll-contract-auth.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-audience-tag';
const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

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
async function signToken(privateKey, kid, payload, { alg = 'RS256' } = {}) {
  const header = { alg, kid, typ: 'JWT' };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}
function accessPayload(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { email: 'sarah@timothystl.org', iss: `https://${TEAM}`, aud: AUD, exp: now + 3600, iat: now, ...overrides };
}
function mockFetch(jwk) {
  return async (url) => {
    if (url !== CERTS_URL) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  };
}

// ── verifyAccessJwt ──────────────────────────────────────────────────────────
group('verifyAccessJwt');
{
  resetPayrollContractAuthCacheForTests();
  const keyPair = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwk.kid = 'test-kid';

  const token = await signToken(keyPair.privateKey, 'test-kid', accessPayload());
  const email = await verifyAccessJwt(token, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) });
  eq(email, 'sarah@timothystl.org', 'accepts a validly signed, current token');

  resetPayrollContractAuthCacheForTests();
  const upper = await signToken(keyPair.privateKey, 'test-kid', accessPayload({ email: 'Sarah@TimothySTL.org' }));
  eq(await verifyAccessJwt(upper, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) }), 'sarah@timothystl.org', 'lowercases the email');

  resetPayrollContractAuthCacheForTests();
  ok((await verifyAccessJwt('', { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) })) === null, 'rejects a missing token');
  ok((await verifyAccessJwt('not-a-jwt', { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) })) === null, 'rejects a malformed token');

  resetPayrollContractAuthCacheForTests();
  const attacker = await makeKeyPair();
  const forged = await signToken(attacker.privateKey, 'test-kid', accessPayload());
  ok((await verifyAccessJwt(forged, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) })) === null, 'rejects a token signed by a key not published under its kid');

  resetPayrollContractAuthCacheForTests();
  const noneAlg = await signToken(keyPair.privateKey, 'test-kid', accessPayload(), { alg: 'none' });
  ok((await verifyAccessJwt(noneAlg, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) })) === null, 'rejects alg:none rather than trusting the header');

  resetPayrollContractAuthCacheForTests();
  const expired = await signToken(keyPair.privateKey, 'test-kid', accessPayload({ exp: Math.floor(Date.now() / 1000) - 10 }));
  ok((await verifyAccessJwt(expired, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) })) === null, 'rejects an expired token');

  resetPayrollContractAuthCacheForTests();
  const wrongAud = await signToken(keyPair.privateKey, 'test-kid', accessPayload({ aud: 'someone-elses-app' }));
  ok((await verifyAccessJwt(wrongAud, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) })) === null, 'rejects the wrong audience');

  resetPayrollContractAuthCacheForTests();
  const wrongIss = await signToken(keyPair.privateKey, 'test-kid', accessPayload({ iss: 'https://someone-else.cloudflareaccess.com' }));
  ok((await verifyAccessJwt(wrongIss, { teamDomain: TEAM, audience: AUD, fetchImpl: mockFetch(jwk) })) === null, 'rejects the wrong issuer');
}

// ── timingSafeEqual ──────────────────────────────────────────────────────────
group('timingSafeEqual');
{
  ok(await timingSafeEqual('right-secret', 'right-secret'), 'equal strings match');
  ok(!(await timingSafeEqual('right-secret', 'wrong-secret')), 'different strings of the same length do not match');
  ok(!(await timingSafeEqual('short', 'a-much-longer-string-entirely')), 'different-length strings do not match');
  ok(!(await timingSafeEqual('', 'anything')), 'empty never matches non-empty');
}

// ── resolvePayrollContractCaller ─────────────────────────────────────────────
group('resolvePayrollContractCaller');
{
  function fakeDb(rows) {
    return {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (/FROM users/.test(sql)) return rows.find((r) => r.email === args[0] && r.active) || null;
                return null;
              },
            };
          },
        };
      },
    };
  }
  function envWith({ keyPair, jwk, users = [] }) {
    return {
      DB: fakeDb(users),
      FINANCE_PAYROLL_CONTRACT_KEY: 'test-secret',
      FINANCE_ACCESS_TEAM_DOMAIN: TEAM,
      FINANCE_ACCESS_AUD: AUD,
      _fetchImpl: mockFetch(jwk),
    };
  }
  function req({ contractKey = 'test-secret', jwt } = {}) {
    return new Request('https://admin.example/sb/rest/v1/rpc/payroll_get_staff', {
      method: 'POST',
      headers: {
        'X-Contract-Key': contractKey,
        ...(jwt !== undefined ? { 'Cf-Access-Jwt-Assertion': jwt } : {}),
      },
    });
  }
  // resolvePayrollContractCaller calls global fetch for the JWKS -- stub it globally for this block.
  const originalFetch = globalThis.fetch;

  const keyPair = await makeKeyPair();
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwk.kid = 'test-kid';
  globalThis.fetch = mockFetch(jwk);

  resetPayrollContractAuthCacheForTests();
  {
    const env = envWith({ users: [{ id: 1, username: 'sarah', permissions: '["payroll_manage"]', email: 'sarah@timothystl.org', active: 1 }] });
    const token = await signToken(keyPair.privateKey, 'test-kid', accessPayload());
    const caller = await resolvePayrollContractCaller(req({ jwt: token }), env);
    ok(caller && caller.username === 'sarah', 'resolves a matching, active user from a valid contract key + JWT');
  }

  resetPayrollContractAuthCacheForTests();
  {
    const env = envWith({ users: [{ id: 1, username: 'sarah', permissions: '["payroll_manage"]', email: 'sarah@timothystl.org', active: 1 }] });
    const token = await signToken(keyPair.privateKey, 'test-kid', accessPayload());
    ok((await resolvePayrollContractCaller(req({ jwt: token, contractKey: 'wrong-secret' }), env)) === null, 'rejects when the contract key is wrong, before ever checking the JWT');
  }

  resetPayrollContractAuthCacheForTests();
  {
    const env = envWith({ users: [{ id: 1, username: 'sarah', permissions: '["payroll_manage"]', email: 'sarah@timothystl.org', active: 1 }] });
    ok((await resolvePayrollContractCaller(req({}), env)) === null, 'rejects a missing Access assertion even with a correct contract key');
  }

  resetPayrollContractAuthCacheForTests();
  {
    const env = envWith({ users: [] });
    const token = await signToken(keyPair.privateKey, 'test-kid', accessPayload());
    ok((await resolvePayrollContractCaller(req({ jwt: token }), env)) === null, 'rejects a verified identity with no matching user row');
  }

  resetPayrollContractAuthCacheForTests();
  {
    const env = envWith({ users: [{ id: 1, username: 'former', permissions: '["payroll_manage"]', email: 'sarah@timothystl.org', active: 0 }] });
    const token = await signToken(keyPair.privateKey, 'test-kid', accessPayload());
    ok((await resolvePayrollContractCaller(req({ jwt: token }), env)) === null, 'rejects a deactivated account even with a matching email');
  }

  resetPayrollContractAuthCacheForTests();
  {
    const env = { DB: fakeDb([]), FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD }; // no FINANCE_PAYROLL_CONTRACT_KEY set
    const token = await signToken(keyPair.privateKey, 'test-kid', accessPayload());
    ok((await resolvePayrollContractCaller(req({ jwt: token }), env)) === null, 'returns null (not a throw) when the contract key is not configured at all');
  }

  globalThis.fetch = originalFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
