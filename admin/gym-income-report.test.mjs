// Finance's Facilities → Gym rental income reads /api/contracts/gym-income-v1.
// Run with: node admin/gym-income-report.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB_INIT_GYM_GROUPS, DB_INIT_GYM_INVOICES, DB_INIT_USERS } from './db.js';
import { buildGymIncomeReport, handleGymIncomeContract } from './gym-income-report.js';
import { resetPayrollContractAuthCacheForTests } from './payroll-contract-auth.js';

const TEAM = 'timothystl.cloudflareaccess.com';
const AUD = 'test-aud';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(DB_INIT_GYM_GROUPS); db.exec(DB_INIT_GYM_INVOICES); db.exec(DB_INIT_USERS);
  db.exec("INSERT INTO gym_groups (id, name) VALUES (1, 'Lions Basketball'), (2, 'Tuesday Volleyball')");
  const inv = db.prepare('INSERT INTO gym_invoices (group_id, invoice_date, total_hours, total_amount, status) VALUES (?,?,?,?,?)');
  inv.run(1, '2026-01-05', 4, 100, 'paid');
  inv.run(1, '2026-02-02', 4, 100.5, 'unpaid');   // overdue by 2026-09-28
  inv.run(2, '2026-09-20', 2, 50, 'unpaid');      // due 2026-10-04, not overdue yet
  inv.run(2, '2025-12-01', 2, 40, 'unpaid');      // last year, still owed
  inv.run(2, '2025-11-01', 2, 40, 'paid');
  const stmt = (sql, args = []) => ({
    async first() { return db.prepare(sql).get(...args); },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  return { prepare(sql) { return { bind: (...args) => stmt(sql, args), ...stmt(sql) }; }, _raw: db };
}

test('totals, months, groups, and open invoices for a year', async () => {
  const r = await buildGymIncomeReport(makeDb(), { year: 2026, today: '2026-09-28' });
  assert.deepEqual(r.years, [2026, 2025]);
  assert.deepEqual(r.totals, { invoiced_cents: 25050, paid_cents: 10000, unpaid_cents: 15050, overdue_cents: 10050, invoice_count: 3, hours: 10 });
  assert.equal(r.months[0].paid_cents, 10000);
  assert.equal(r.months[1].invoiced_cents, 10050);
  assert.equal(r.months[8].invoiced_cents, 5000);
  assert.deepEqual(r.groups.map((g) => [g.group_name, g.invoiced_cents, g.unpaid_cents]), [['Lions Basketball', 20050, 10050], ['Tuesday Volleyball', 5000, 5000]]);
  // Unpaid invoices from every year, oldest first, with overdue marked.
  assert.deepEqual(r.open_invoices.map((i) => [i.invoice_date, i.amount_cents, i.overdue]),
    [['2025-12-01', 4000, true], ['2026-02-02', 10050, true], ['2026-09-20', 5000, false]]);
});

// ── Contract auth: key + verified Access identity + gym_manage ──
function b64url(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const b64json = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
async function setupAuth() {
  resetPayrollContractAuthCacheForTests();
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
  globalThis.fetch = async (url) => new Response(JSON.stringify({ keys: [jwk] }));
  return async (email) => {
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64json({ alg: 'RS256', kid: 'k1' })}.${b64json({ email, iss: `https://${TEAM}`, aud: AUD, exp: now + 600 })}`;
    const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, keys.privateKey, new TextEncoder().encode(input));
    return `${input}.${b64url(new Uint8Array(sig))}`;
  };
}
function envFor(db) {
  db._raw.exec(`INSERT INTO users (username, password_hash, permissions, created_at, email, active) VALUES
    ('bookkeeper', 'x', '["gym_manage","payroll_manage"]', '2026-01-01', 'books@timothystl.org', 1),
    ('editor', 'x', '["pages_edit"]', '2026-01-01', 'editor@timothystl.org', 1)`);
  return { DB: db, FINANCE_PAYROLL_CONTRACT_KEY: 'secret', FINANCE_ACCESS_TEAM_DOMAIN: TEAM, FINANCE_ACCESS_AUD: AUD };
}
const call = (env, headers, query = '?year=2025') => handleGymIncomeContract(
  new Request(`https://admin.timothystl.org/api/contracts/gym-income-v1${query}`, { headers }), env, { today: '2026-09-28' });

test('answers a gym_manage user relayed by Finance, and refuses everyone else', async () => {
  const sign = await setupAuth();
  const env = envFor(makeDb());
  const ok = await call(env, { 'X-Contract-Key': 'secret', 'Cf-Access-Jwt-Assertion': await sign('books@timothystl.org') });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.year, 2025);
  assert.equal(body.totals.invoiced_cents, 8000);
  assert.equal((await call(env, { 'X-Contract-Key': 'secret', 'Cf-Access-Jwt-Assertion': await sign('editor@timothystl.org') })).status, 403);
  assert.equal((await call(env, { 'X-Contract-Key': 'wrong', 'Cf-Access-Jwt-Assertion': await sign('books@timothystl.org') })).status, 401);
  assert.equal((await call(env, { 'X-Contract-Key': 'secret' })).status, 401);
  const fallback = await call(env, { 'X-Contract-Key': 'secret', 'Cf-Access-Jwt-Assertion': await sign('books@timothystl.org') }, '?year=abc');
  assert.equal((await fallback.json()).year, 2026);
});
