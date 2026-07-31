// End-to-end test for admin/forms.js — run with: node admin/forms.test.mjs
//
// admin/spam.test.mjs covers the scoring rules; this covers the wiring around
// them: what gets stored, what gets emailed, what a held message looks like in
// the admin, and that releasing one actually delivers it. It runs the real
// module against a real SQLite database (node:sqlite behind a small D1-shaped
// shim) with fetch stubbed, so nothing here talks to Brevo or ChMS.
import { DatabaseSync } from 'node:sqlite';
import { screenSubmission, formConfig, handleFilteredRoutes, heldCount, pruneSubmissions } from './forms.js';
import { DB_INIT_FORM_SUBMISSIONS, DB_INIT_SITE_SETTINGS, DB_INIT_AUDIT_LOG, DB_INIT_SUBSCRIBERS } from './db.js';
import { verifyFormToken, signFormToken } from './spam.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// ── a D1-shaped shim over node:sqlite ────────────────────────────────────────
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
  return { prepare: (sql) => stmt(sql) };
}

function freshEnv() {
  const db = new DatabaseSync(':memory:');
  for (const sql of [DB_INIT_FORM_SUBMISSIONS, DB_INIT_SITE_SETTINGS, DB_INIT_AUDIT_LOG, DB_INIT_SUBSCRIBERS]) {
    db.prepare(sql).run();
  }
  return { raw: db, env: { DB: d1(db), BREVO_API_KEY: 'test-key', CHMS_INTAKE_API_KEY: 'test-intake' } };
}

// Every outbound call the module can make, captured instead of sent.
let sentEmails = [];
let chmsPosts = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  // The ChMS hand-off passes a Request object; Brevo gets url + init.
  const body = JSON.parse(init?.body ?? await input.text());
  if (url.includes('brevo.com')) {
    sentEmails.push(body);
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  }
  if (url.includes('serve.timothystl.org')) {
    chmsPosts.push({ url, body });
    return new Response('{}', { status: 200 });
  }
  throw new Error('unexpected fetch to ' + url);
};

const req = (opts = {}) => new Request('https://admin.timothystl.org/api/contact', {
  method: 'POST',
  headers: { 'CF-Connecting-IP': opts.ip || '203.0.113.7', 'User-Agent': opts.ua || 'Mozilla/5.0' },
});
const admin = { id: 1, username: 'dinger', permissions: JSON.stringify(['settings_manage']) };

const LUMITOON = `Hi,

If your audience doesn't get your offer in seconds, you're losing leads.

At Lumitoon Studios, we create engaging 2D & 3D animated videos that clearly explain your value, capture attention, and convert viewers into customers.

Perfect for websites, ads, and sales funnels—our videos work for you 24/7.

Ready to boost conversions? Just reply to get started.

Reply STOP to opt out.`;

// ── the token handed to the page ─────────────────────────────────────────────
group('form config');
{
  const { env } = freshEnv();
  const cfg = await formConfig(env);
  ok(cfg.token, 'a token is issued');
  eq(cfg.turnstile_site_key, '', 'no Turnstile site key until one is saved');

  const secretRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='form_token_secret'").first();
  ok(secretRow?.value, 'the signing key is generated and stored on first use');
  // Freshly issued, so it is younger than the minimum age — proof the clock is
  // really being checked rather than the token merely existing.
  eq(await verifyFormToken(cfg.token, secretRow.value), 'too-fast', 'a token used instantly reads as too fast');
  eq(await verifyFormToken(cfg.token, secretRow.value, { now: Date.now() + 10_000 }), 'valid', 'and as valid ten seconds later');
}

// ── a real message ───────────────────────────────────────────────────────────
group('a real prayer request goes straight through');
{
  const { env } = freshEnv();
  sentEmails = []; chmsPosts = [];
  const secret = (await formConfig(env), (await env.DB.prepare("SELECT value FROM site_settings WHERE key='form_token_secret'").first()).value);
  const token = await signFormToken(secret, Date.now() - 30_000);

  const screen = await screenSubmission(env, req(), {
    kind: 'prayer', name: 'Heather Unruh', email: 'heatherju@yahoo.com',
    message: 'Please pray for my sister Michelle. She has been diagnosed with kidney cancer.',
    token,
  });
  eq(screen.held, false, 'it is not held');
  eq(screen.suspect, false, 'and not flagged');
  const row = await env.DB.prepare('SELECT * FROM form_submissions ORDER BY id DESC LIMIT 1').first();
  eq(row.status, 'delivered', 'the record says delivered');
  eq(row.kind, 'prayer', 'and remembers which form it came from');
  // The email is the record. A delivered row exists only for the flood count,
  // so it must not become a second copy of a private prayer request.
  eq(row.message, null, 'the message itself is not kept');
  eq(row.name, null, 'nor the name');
  eq(row.email, null, 'nor the email address');
  ok(row.ip, 'only the address it came from, for the flood limit');
  eq(await heldCount(env), 0, 'nothing is waiting for review');
}

// ── the pitch ────────────────────────────────────────────────────────────────
group('a sales pitch is held, not emailed');
{
  const { env } = freshEnv();
  sentEmails = []; chmsPosts = [];
  const screen = await screenSubmission(env, req(), {
    kind: 'contact', name: 'Sarah Glover', email: 'sarah@thelumitoonstudios.com', message: LUMITOON,
    token: '', // posted straight at the API, as these do
  });
  eq(screen.held, true, 'it is held');
  eq(sentEmails.length, 0, 'no email is sent to the office');
  eq(chmsPosts.length, 0, 'and nothing is forwarded to ChMS');
  eq(await heldCount(env), 1, 'it is waiting for review');

  const row = await env.DB.prepare("SELECT * FROM form_submissions WHERE status='held'").first();
  ok(row.message.includes('Lumitoon'), 'the message is stored in full, not discarded');
  ok(JSON.parse(row.reasons).length >= 3, 'with the reasons it was held');
  eq(row.ip, '203.0.113.7', 'and the address it came from');
}

// ── the review page ──────────────────────────────────────────────────────────
group('the Filtered Mail page');
{
  const { env } = freshEnv();
  sentEmails = []; chmsPosts = [];
  await screenSubmission(env, req(), { kind: 'contact', name: 'Sarah Glover', email: 'sarah@thelumitoonstudios.com', message: LUMITOON, token: '' });

  const page = await handleFilteredRoutes(new Request('https://admin.timothystl.org/filtered'), env, '/filtered', 'GET', admin, {});
  const body = await page.text();
  ok(body.includes('Sarah Glover'), 'the held message is listed');
  ok(body.includes('bulk-mail opt-out line'), 'with the reason it was held');
  ok(body.includes('This is real — send it to me'), 'and a way to release it');

  const denied = await handleFilteredRoutes(new Request('https://admin.timothystl.org/filtered'), env,
    '/filtered', 'GET', { id: 2, username: 'youth', permissions: JSON.stringify(['ministries_edit']) }, {});
  eq(denied.status, 403, 'someone without settings access cannot read held mail');

  // Releasing sends the withheld email and forwards it on, exactly as a clean
  // submission would have.
  const id = (await env.DB.prepare("SELECT id FROM form_submissions WHERE status='held'").first()).id;
  const fd = new FormData(); fd.append('id', String(id));
  const rel = await handleFilteredRoutes(
    new Request('https://admin.timothystl.org/filtered/release', { method: 'POST', body: fd }),
    env, '/filtered/release', 'POST', admin, {});
  eq(rel.status, 302, 'releasing redirects back to the list');
  eq(sentEmails.length, 1, 'the office finally gets the email');
  ok(sentEmails[0].htmlContent.includes('Released from the website spam filter'), 'marked as released by hand');
  ok(sentEmails[0].htmlContent.includes('Lumitoon'), 'with the original message intact');
  eq(chmsPosts.length, 1, 'and it reaches ChMS');
  eq(await heldCount(env), 0, 'the queue is empty again');

  const after = await env.DB.prepare('SELECT status, released_by FROM form_submissions WHERE id = ?').bind(id).first();
  eq(after.status, 'released', 'the row is marked released');
  eq(after.released_by, 'dinger', 'and records who did it');

  const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type='form_submission'").first();
  eq(audit.n, 1, 'the release is in the audit log');
}

group('deleting a held message');
{
  const { env } = freshEnv();
  await screenSubmission(env, req(), { kind: 'contact', name: 'Spammer', email: 'a@b.co', message: LUMITOON, token: '' });
  const id = (await env.DB.prepare("SELECT id FROM form_submissions WHERE status='held'").first()).id;
  const fd = new FormData(); fd.append('id', String(id));
  await handleFilteredRoutes(new Request('https://admin.timothystl.org/filtered/delete', { method: 'POST', body: fd }),
    env, '/filtered/delete', 'POST', admin, {});
  eq(await heldCount(env), 0, 'it is gone');
}

// ── flooding ─────────────────────────────────────────────────────────────────
group('one address firing repeatedly');
{
  const { env } = freshEnv();
  const clean = { kind: 'contact', name: 'Bot', email: 'a@b.co', message: 'Hello, I would like more information about your services.', token: '' };
  const results = [];
  for (let i = 0; i < 12; i++) results.push(await screenSubmission(env, req({ ip: '198.51.100.4' }), clean));
  eq(results[0].held, false, 'the first one is delivered');
  ok(results[11].held, 'the twelfth from the same address is held');

  // A different address is unaffected by the first one's flood.
  const other = await screenSubmission(env, req({ ip: '198.51.100.99' }), clean);
  eq(other.held, false, 'a different visitor is not caught in it');
}

// ── retention ────────────────────────────────────────────────────────────────
group('retention');
{
  const { env, raw } = freshEnv();
  raw.prepare("INSERT INTO form_submissions (kind, message, status, created_at) VALUES ('contact','old','delivered',datetime('now','-60 days'))").run();
  raw.prepare("INSERT INTO form_submissions (kind, message, status, created_at) VALUES ('contact','recent','delivered',datetime('now','-2 days'))").run();
  raw.prepare("INSERT INTO form_submissions (kind, message, status, created_at) VALUES ('contact','held','held',datetime('now','-400 days'))").run();
  await pruneSubmissions(env);
  const rows = (await env.DB.prepare('SELECT message FROM form_submissions').all()).results.map(r => r.message);
  ok(!rows.includes('old'), 'a delivered record older than 30 days is pruned');
  ok(rows.includes('recent'), 'a recent one is kept for the rate limit');
  ok(rows.includes('held'), 'a held message is never pruned, however old');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
