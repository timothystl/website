// Safe integration regression: real Worker + SQLite, all outbound fetch mocked.
// Set NEWSLETTER_BROWSER=1, NODE_PATH and CHROME_PATH to also test release/retry in Chromium.
// Run: node --experimental-loader ./test/html-loader.mjs test/newsletter-confirmation.test.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import path from 'node:path';
import worker from '../website-admin-worker.js';
import { handleFilteredRoutes } from '../admin/forms.js';
import { signFormToken } from '../admin/spam.js';
import { OPTIN_REDIRECT_URL } from '../admin/email.js';

const admin = { id: 1, username: 'reviewer', permissions: JSON.stringify(['settings_manage']) };
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} });
let mode, calls, pending, members;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(init.body) : null;
  calls.push({ url, body });
  if (url === 'https://api.brevo.com/v3/smtp/templates') {
    if (mode === 'template') return new Response('{}', { status: 503 });
    assert.match(body.htmlContent, /href="{{ doubleoptin }}"/);
    return Response.json({ id: 42 }, { status: 201 });
  }
  if (url === 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation') {
    if (mode === 'network') throw new Error('simulated connection failure');
    if (mode === 'refused') return new Response('{}', { status: 400 });
    assert.deepEqual(body.includeListIds, [7]);
    assert.equal(body.redirectionUrl, OPTIN_REDIRECT_URL);
    pending.set('https://confirmation.example.test/token-' + pending.size, body);
    return new Response(null, { status: 204 });
  }
  // Model the unsafe legacy endpoint so regressions cannot hide in a caught exception.
  if (url === 'https://api.brevo.com/v3/contacts') {
    members.add(body.email);
    return new Response('{}', { status: 201 });
  }
  if (pending.has(url)) {
    const signup = pending.get(url);
    members.add(signup.email);
    pending.delete(url);
    return new Response(null, { status: 302, headers: { Location: signup.redirectionUrl } });
  }
  throw new Error('Unexpected outbound request: ' + url);
};
async function boot(failure = 'ok') {
  mode = failure; calls = []; pending = new Map(); members = new Set(['existing@example.com']);
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => { const r = raw.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  const env = { DB: { prepare: sql => stmt(sql), batch: stmts => Promise.all(stmts.map(s => s.run())), exec: async sql => raw.exec(sql) }, BREVO_API_KEY: 'mock-key', BREVO_LIST_ID: '7' };
  await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx());
  raw.prepare("INSERT OR REPLACE INTO site_settings (key,value) VALUES ('form_token_secret','test-secret')").run();
  raw.prepare("INSERT INTO newsletter_subscribers (email,name) VALUES ('existing@example.com','Existing')").run();
  return { raw, env };
}
async function signup(env, accept = 'application/json', email = 'new@example.com') {
  const body = new FormData(); body.set('email', email); body.set('name', 'New');
  body.set('form_token', await signFormToken('test-secret', Date.now() - 5000));
  return worker.fetch(new Request('https://admin.timothystl.org/api/subscribe', { method: 'POST', headers: { Accept: accept }, body }), env, ctx());
}
function unchanged(raw) {
  assert.equal(raw.prepare("SELECT name FROM newsletter_subscribers WHERE email='existing@example.com'").get().name, 'Existing');
  assert.deepEqual([...members], ['existing@example.com']);
  assert.equal(calls.filter(c => c.url === 'https://api.brevo.com/v3/contacts').length, 0, 'never directly add a contact');
}
try {
  for (const failure of ['template', 'refused', 'network', 'missing-key', 'missing-list']) {
    for (const accept of ['application/json', 'text/html']) {
      const { raw, env } = await boot(failure);
      if (failure === 'missing-key') delete env.BREVO_API_KEY;
      if (failure === 'missing-list') delete env.BREVO_LIST_ID;
      const response = await signup(env, accept);
      unchanged(raw);
      assert.equal(response.status, 503, failure + ' is retryable');
      if (accept === 'text/html') assert.match(await response.text(), /Confirmation still needed/);
      else assert.deepEqual(Object.keys(await response.json()).sort(), ['error', 'pending', 'retry']);
      assert.equal(raw.prepare("SELECT count(*) n FROM newsletter_subscribers WHERE email='new@example.com'").get().n, 1, 'saved pending despite failure');
      unchanged(raw);
      mode = 'ok'; env.BREVO_API_KEY = 'mock-key'; env.BREVO_LIST_ID = '7';
      assert.deepEqual(await (await signup(env)).json(), { success: true, confirm: true });
      assert.equal(raw.prepare("SELECT count(*) n FROM newsletter_subscribers WHERE email='new@example.com'").get().n, 1, 'retry does not duplicate');
      unchanged(raw);
      raw.close();
    }
  }
  console.log('Public confirmation failures, HTML/JSON responses, and retries passed');
  for (const failure of ['ok', 'template', 'refused', 'network', 'missing-list']) {
    const { raw, env } = await boot(failure);
    if (failure === 'missing-list') delete env.BREVO_LIST_ID;
    raw.prepare("INSERT INTO form_submissions (kind,email,name,status) VALUES ('subscribe','held@example.com','Held','held')").run();
    const release = () => handleFilteredRoutes(new Request('https://admin.timothystl.org/filtered/release', { method: 'POST', body: new URLSearchParams({ id: '1' }) }), env, '/filtered/release', 'POST', admin, ctx());
    const response = await release();
    unchanged(raw);
    assert.match(response.headers.get('Location'), failure === 'ok' ? /confirmation-sent/ : /confirmation-failed/);
    assert.equal(raw.prepare('SELECT status FROM form_submissions WHERE id=1').get().status, 'released', 'spam hold cleared even if email fails');
    assert.equal(raw.prepare("SELECT count(*) n FROM newsletter_subscribers WHERE email='held@example.com'").get().n, 1);
    unchanged(raw);
    const page = await handleFilteredRoutes(new Request('https://admin.timothystl.org/filtered/1'), env, '/filtered/1', 'GET', admin, ctx());
    assert.match(await page.text(), /Retry confirmation email/);
    mode = 'ok'; env.BREVO_LIST_ID = '7';
    assert.match((await release()).headers.get('Location'), /confirmation-sent/);
    unchanged(raw);
    assert.equal(raw.prepare("SELECT count(*) n FROM audit_log WHERE action='release'").get().n, 1, 'retry preserves original release audit');
    const click = await fetch([...pending.keys()][0]);
    const landing = await worker.fetch(new Request(click.headers.get('Location')), env, ctx());
    assert.equal(landing.status, 200);
    assert.deepEqual([...members], ['existing@example.com', 'held@example.com'], 'released signup joins only after confirming');
    raw.close();
  }
  console.log('Filtered release, failure, retry, and confirmation click regressions passed');
  if (process.env.NEWSLETTER_BROWSER) {
    const { chromium } = createRequire(path.join(process.env.NODE_PATH, 'x.js'))('playwright');
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
    try {
      const { raw, env } = await boot('network');
      raw.prepare("INSERT INTO form_submissions (kind,email,name,status) VALUES ('subscribe','browser@example.com','Browser','held')").run();
      const page = await browser.newPage();
      // Every browser request is intercepted; no browser traffic reaches production.
      await page.route('**/*', async route => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin !== 'https://admin.example.test' || !url.pathname.startsWith('/filtered')) return route.fulfill({ status: 404, body: '' });
        let response = await handleFilteredRoutes(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(req.method() === 'POST' ? { body: req.postData() } : {}) }), env, url.pathname, req.method(), admin, ctx());
        // Resolve redirects inside the mock: Playwright does not intercept
        // every redirected navigation, so never hand a 302 to the browser.
        if (response.status === 302) {
          const next = new URL(response.headers.get('Location'), req.url());
          response = await handleFilteredRoutes(new Request(next), env, next.pathname, 'GET', admin, ctx());
        }
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      });
      page.on('dialog', dialog => dialog.accept());
      await page.goto('https://admin.example.test/filtered/1');
      await page.getByRole('button', { name: 'Release and send confirmation', exact: true }).click();
      await page.getByText('Spam hold cleared; signup is still pending.', { exact: false }).waitFor();
      assert.match(await page.locator('body').innerText(), /signup is still pending/);
      unchanged(raw);
      mode = 'ok';
      await page.getByRole('button', { name: 'Retry confirmation email', exact: true }).click();
      await page.getByText('Confirmation email requested.', { exact: false }).waitFor();
      assert.match(await page.locator('body').innerText(), /only after clicking the email link/);
      unchanged(raw);
      raw.close();
      console.log('Browser release → failure notice → retry → confirmation requested passed');
    } finally { await browser.close(); }
  }
  const { raw, env } = await boot();
  assert.equal((await signup(env)).status, 200);
  unchanged(raw);
  // The thank-you route is informational, never a subscription endpoint.
  const direct = await worker.fetch(new Request(OPTIN_REDIRECT_URL), env, ctx());
  assert.equal(direct.status, 200); unchanged(raw);
  const link = [...pending.keys()][0];
  assert.ok(link, 'mock confirmation email contains a unique link');
  const clicked = await fetch(link);
  assert.equal(clicked.status, 302);
  const landing = await worker.fetch(new Request(clicked.headers.get('Location')), env, ctx());
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /Thank you for confirming/);
  assert.deepEqual([...members], ['existing@example.com', 'new@example.com'], 'only simulated confirmation click joins list');
  assert.equal(calls.filter(c => c.url === 'https://api.brevo.com/v3/contacts').length, 0);
  raw.close();
  console.log('Mock email → confirmation click → real Worker landing flow passed (no live provider calls)');
} finally { globalThis.fetch = originalFetch; }
