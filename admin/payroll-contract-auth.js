// ── Payroll contract auth: lets Finance's app reach this Worker's existing ──
// Supabase payroll proxy (the /sb/* handler in tlc-admin-worker.js) on behalf
// of a real, specific admin -- not as an anonymous trusted server.
//
// This is deliberately NOT the ADMIN_PUSH_API_KEY/X-Push-Key shape already used
// elsewhere in this Worker: that pattern authenticates "a trusted server," with
// no idea which person is behind the call. Payroll needs to know WHO, because
// the proxy it's calling only ever runs for someone holding the payroll_manage
// permission -- the same gate a signed-in admin already has to clear.
//
// The identity comes from Cloudflare Access, which already fronts Finance's
// app: every request reaching Finance carries a Cf-Access-Jwt-Assertion header
// Access itself signs. Finance forwards that header unchanged; this module
// verifies it independently against Access's own published keys (never trusts
// Finance's say-so) and maps the verified email onto a row in this Worker's own
// `users` table. Two things both have to be true before anything is treated as
// an authenticated admin: the shared X-Contract-Key secret (proves the call
// came from Finance's Worker at all) is checked by the caller before this runs,
// and the JWT verifies to an email matching an active user here.
//
// Fails closed throughout -- any missing config, bad signature, expired token,
// wrong issuer/audience, or unmatched/deactivated account returns null, never
// throws. The caller treats null exactly like "no session," which is what
// already happens for a browser with no cookie.

const JWKS_CACHE_MS = 60 * 60 * 1000;
let jwksCache = null; // { teamDomain, keys: Map<kid, CryptoKey>, fetchedAt }

function base64UrlToUint8Array(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(b64url)));
}

async function fetchJwks(teamDomain, fetchImpl) {
  if (jwksCache && jwksCache.teamDomain === teamDomain && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_MS) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const { keys } = await res.json();
  const imported = new Map();
  for (const jwk of keys || []) {
    if (!jwk.kid) continue;
    imported.set(jwk.kid, await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    ));
  }
  jwksCache = { teamDomain, keys: imported, fetchedAt: Date.now() };
  return imported;
}

// Same shape as chms/src/access-jwt.js's verifyAccessJwt -- reimplemented here
// rather than shared, since this is a separate deployable Worker in a separate
// repository. Keep the two in sync if either changes.
export async function verifyAccessJwt(token, { teamDomain, audience, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!token || !teamDomain || !audience) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64UrlDecodeJson(headerB64);
    payload = base64UrlDecodeJson(payloadB64);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let keys;
  try {
    keys = await fetchJwks(teamDomain, fetchImpl);
  } catch {
    return null;
  }
  let key = keys.get(header.kid);
  if (!key) {
    jwksCache = null;
    try { keys = await fetchJwks(teamDomain, fetchImpl); } catch { return null; }
    key = keys.get(header.kid);
  }
  if (!key) return null;

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let signature;
  try { signature = base64UrlToUint8Array(sigB64); } catch { return null; }
  const valid = await crypto.subtle
    .verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, signedData)
    .catch(() => false);
  if (!valid) return null;

  const nowSec = now() / 1000;
  if (typeof payload.exp !== 'number' || payload.exp < nowSec) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(audience)) return null;
  if (!payload.email || typeof payload.email !== 'string') return null;

  return payload.email.toLowerCase();
}

// Same construction as chms/src/auth.js's timingSafeEqual: compares SHA-256
// digests of both inputs rather than the inputs themselves, so neither the
// content nor the length of a wrong guess is observable from timing.
export async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a || '')),
    crypto.subtle.digest('SHA-256', enc.encode(b || '')),
  ]);
  const bufA = new Uint8Array(digestA), bufB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

/**
 * Resolves a Finance-relayed request into the same shape getSession() returns
 * ({ id, username, permissions }), or null. Requires ALL of: the shared
 * X-Contract-Key secret, a Cf-Access-Jwt-Assertion verifying to an email, and
 * that email matching an active row in `users`. hasPermission() from auth.js
 * still gates the actual payroll_manage check on whatever this returns --
 * this function only establishes identity, the same as getSession() does.
 */
export async function resolvePayrollContractCaller(request, env) {
  const expectedKey = env.FINANCE_PAYROLL_CONTRACT_KEY || '';
  if (!expectedKey) return null;
  const key = request.headers.get('X-Contract-Key') || '';
  if (!(await timingSafeEqual(key, expectedKey))) return null;

  const teamDomain = env.FINANCE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.FINANCE_ACCESS_AUD || '';
  if (!teamDomain || !audience) return null;

  const email = await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion') || '', { teamDomain, audience });
  if (!email) return null;

  const row = await env.DB.prepare(
    `SELECT id, username, permissions FROM users WHERE LOWER(email) = ? AND active = 1`
  ).bind(email).first();
  return row || null;
}

/** Test-only: clears the module-scope JWKS cache so tests don't leak state into each other. */
export function resetPayrollContractAuthCacheForTests() {
  jwksCache = null;
}
