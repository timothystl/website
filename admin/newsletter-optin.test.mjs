// Newsletter double opt-in — run with: node admin/newsletter-optin.test.mjs
//
// The confirmation template is made in Brevo on first use and remembered; each
// signup then asks Brevo to send that template's confirm link. Real SQLite
// behind a D1-shaped shim, fetch stubbed — nothing here talks to Brevo.
import { DatabaseSync } from 'node:sqlite';
import { DB_INIT_SITE_SETTINGS } from './db.js';
import { ensureOptinTemplate, requestNewsletterOptin, optinTemplateHtml, OPTIN_REDIRECT_URL } from './email.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { db.prepare(sql).run(...args); return { meta: {} }; },
  });
  return { prepare: (sql) => stmt(sql) };
}
function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.prepare(DB_INIT_SITE_SETTINGS).run();
  return { DB: d1(db), BREVO_API_KEY: 'k' };
}

let calls = [];
let templateStatus = 201, optinStatus = 204;
globalThis.fetch = async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  if (url.endsWith('/smtp/templates')) return new Response(JSON.stringify({ id: 42 }), { status: templateStatus });
  if (url.endsWith('/contacts/doubleOptinConfirmation')) return new Response(null, { status: optinStatus });
  throw new Error('unexpected fetch ' + url);
};

ok(optinTemplateHtml().includes('{{ doubleoptin }}'), 'the template carries Brevo\'s confirm-link placeholder');

{
  const env = freshEnv(); calls = [];
  eq(await ensureOptinTemplate(env), 42, 'the template is created on first use');
  eq(calls[0].body.tag, 'optin', 'tagged optin, as Brevo requires for double opt-in');
  eq(await ensureOptinTemplate(env), 42, 'and remembered');
  eq(calls.length, 1, 'without a second create');

  calls = [];
  const r = await requestNewsletterOptin(env, { email: 'ann@example.com', name: 'Ann', listId: 7 });
  eq(r.ok, true, 'Brevo accepting the request is success');
  const body = calls[0].body;
  eq(body.templateId, 42, 'the confirmation uses the stored template');
  eq(body.includeListIds[0], 7, 'and adds them to the newsletter list on the click');
  eq(body.redirectionUrl, OPTIN_REDIRECT_URL, 'then lands them on the thank-you page');
  ok(OPTIN_REDIRECT_URL.includes('/api/'), 'which lives under the public /api/ prefix');
}

{
  const env = freshEnv(); calls = []; templateStatus = 400;
  const r = await requestNewsletterOptin(env, { email: 'b@example.com', name: '', listId: 7 });
  ok(r.error, 'no template means an error so the caller keeps the signup pending');
  templateStatus = 201; optinStatus = 400;
  const r2 = await requestNewsletterOptin(env, { email: 'b@example.com', name: '', listId: 7 });
  ok(r2.error, 'and so does Brevo refusing the opt-in request');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
