// The Christmas Market vendor table, driven in a real browser.
//   node --experimental-loader ./test/html-loader.mjs test/market-admin.test.mjs
//
// The row is the form now, and everything that makes that true happens in the
// browser: a cell saving on its own, the payment pill and the money line
// redrawing from what the SERVER said the row became, a column sorting, a
// filter narrowing, a row opening underneath itself. None of it is visible to
// a test that only reads the markup the Worker sent — which is exactly why the
// old drawer, whose every action was a form post and a redirect, needed no
// browser test and this does.
//
// ⚠ THE WORKER IS REAL AND SO IS THE DATABASE. The saves here go through
// /market/update into node:sqlite, so an assertion about what a cell shows
// after it saves is an assertion about what was actually stored.

import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import worker from '../tlc-admin-worker.js';

const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr, 'x.js'))('playwright');

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
// Serve, stubbed — a different application on another host, so a test that
// really called it would pass or fail on whether that host happened to be up.
// Two jobs on the Saturday, one of them short-handed, which is enough for a
// lead's sheet to have something on it.
const ROSTER = { open: true, roles: [
  { name: 'Kitchen', lead: 'Marla Bruns', shifts: [
    { label: '9:00–11:00 am', date: '2026-12-05', needed: 3, filled: 2,
      people: [{ name: 'Ellen Ritter', email: 'ellen@example.com' }, { name: 'Hilda Vogt' }] },
  ] },
  { name: 'Greeters', shifts: [
    { label: '11:00 am–1:00 pm', date: '2026-12-05', needed: 2, filled: 0, people: [] },
  ] },
] };
globalThis.fetch = async () => new Response(JSON.stringify(ROSTER),
  { status: 200, headers: { 'Content-Type': 'application/json' } });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const db = new DatabaseSync(':memory:');
const env = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test', CHMS_INTAKE_API_KEY: 'test-key' };
await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx);

// A signed-in coordinator, and four vendors — one paying by card and unpaid,
// two by check (one arrived, one not), and one who dropped out.
// ⚠ HEX, 64 CHARACTERS. The cookie is read with /tlc_session=([a-f0-9]{64})/,
// so a token outside that alphabet is not "an invalid session" — it is no
// token at all, and every request quietly renders the login page, which looks
// exactly like a permissions problem.
const TOKEN = 'ab'.repeat(32);
// ⚠ ISO TIMESTAMPS, NOT `datetime('now')`. The session check compares
// `expires_at` against `new Date().toISOString()` as a STRING, and SQLite's
// own format uses a space where ISO uses a 'T' — which sorts earlier, so a
// session written the SQL way reads as already expired and every request
// lands on the login page looking like a permissions problem.
const nowIso = new Date().toISOString();
db.prepare('INSERT INTO users (username,password_hash,permissions,created_at,active) VALUES (?,?,?,?,1)')
  .run('marla', 'pbkdf2:1:x:y', JSON.stringify(['market_manage']), nowIso);
const uid = db.prepare("SELECT id FROM users WHERE username='marla'").get().id;
db.prepare('INSERT INTO sessions (token,user_id,username,permissions,expires_at,created_at) VALUES (?,?,?,?,?,?)')
  .run(TOKEN, uid, 'marla', JSON.stringify(['market_manage']),
    new Date(Date.now() + 864e5).toISOString(), nowIso);

const vendor = (name, email, fields, over = {}) => {
  db.prepare(`INSERT INTO site_event_registrations
    (event_id, qty, payment_status, amount_due_cents, amount_paid_cents, contact_name, contact_email, contact_phone, table_number, fields_json, created_at)
    VALUES ('christmasmarket',?,?,?,?,?,?,'(314) 555-0100',?,?,?)`)
    .run(over.qty ?? 1, over.status ?? 'unpaid', over.due ?? 4665, over.paid ?? null,
      name, email, over.table ?? '', JSON.stringify(fields), new Date().toISOString());
};
vendor('Steph Ruhl', 'steph@example.com', { business_name: 'Little Bear Knits', product_description: 'Knitted hats and mittens', payment_method: 'card', category: 'Textiles' });
vendor('Hilda Vogt', 'hilda@example.com', { business_name: "Sweet Hilda's Bakery", product_description: 'Springerle and stollen', payment_method: 'check', category: 'Baked goods' }, { due: 4500 });
vendor('Marcus Dohrmann', 'marcus@example.com', { business_name: 'Bee Line Apiary', product_description: 'Raw honey', payment_method: 'check', category: 'Food & drink', check_no: '1042', check_date: '2026-08-12' }, { due: 4500, status: 'paid', paid: 4500 });
vendor('Karen Weber', 'karen@example.com', { business_name: 'Painted Pony Studio', product_description: 'Watercolor prints', payment_method: 'card', category: 'Art & prints' }, { status: 'dropped' });
// Timothy MDO, the Word of Life 8th grade and the youth group take tables at
// no charge — a real row, and the one the check column must not offer to
// record a check against.
vendor('Rick Vogel', 'rick@example.com', { business_name: 'Alpine Alpacas', product_description: 'Alpaca socks and yarn', payment_method: 'check', category: 'Textiles' }, { due: 4500, status: 'waived' });

const srv = http.createServer(async (q, r) => {
  const chunks = [];
  for await (const c of q) chunks.push(c);
  const res = await worker.fetch(new Request('https://admin.timothystl.org' + q.url, {
    method: q.method,
    headers: { ...q.headers, origin: 'https://admin.timothystl.org', cookie: `tlc_session=${TOKEN}` },
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  }), env, ctx);
  const body = Buffer.from(await res.arrayBuffer());
  r.writeHead(res.status, { 'Content-Type': res.headers.get('content-type') || 'text/html' });
  r.end(body);
});
await new Promise((r) => srv.listen(0, r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
if (process.env.DEBUG_MKT) {
  page.on('console', (m) => console.log('  [console]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('response', async (r) => { if (r.url().includes('/market/update')) console.log('  [resp]', r.status(), (await r.text()).slice(0, 200)); });
  page.on('requestfailed', (r) => console.log('  [reqfail]', r.url(), r.failure()?.errorText));
}
const rowOf = (name) => page.locator('.tlc-mkt-row', { hasText: name });

try {
  await page.goto(BASE + '/market', { waitUntil: 'networkidle' });

  group('the table as it arrives');
  {
    eq(await page.locator('.tlc-mkt-row').count(), 5, 'every application is a row');
    // The default order is category then vendor name — the order the
    // coordinator works in, because the questions are "how many bakers" and
    // "are the candle people together".
    const cats = await page.locator('.tlc-mkt-row [data-field="category"]').evaluateAll(
      (els) => els.map((e) => e.value));
    eq(cats.join(','), 'Art & prints,Baked goods,Food & drink,Textiles,Textiles', 'sorted by category on arrival');
    ok(await page.locator('.tlc-mkt-nojs').first().isHidden(),
      'the no-script Save button is hidden once the cells can save themselves');
    eq(await page.locator('.tlc-mkt-more').first().isVisible(), false, 'and every row starts closed');

    // ⚠ THE EMPTY STATE IS HIDDEN WHEN THERE IS SOMETHING TO SHOW, and it
    // takes a rule of its own to be: an explicit `display` beats the
    // browser's own [hidden]{display:none}, so without that rule this sits
    // under a full table telling somebody nothing matches while ten rows of
    // matches are above it. Found by looking at the rendered page, not by any
    // assertion — which is why there is one now.
    eq(await page.locator('#tlc-mkt-none').isVisible(), false,
      'the "nothing matches" line is hidden while rows are showing');

    // ⚠ A LABEL THAT DOES NOT FIT IS A DIFFERENT WORD. A select clips rather
    // than wrapping, so a Payment column half a column too narrow does not
    // look cramped — it silently reads 'AWAITING CHE'.
    // ⚠ MEASURED AGAINST THE TEXT, NOT AGAINST scrollWidth. A <select> clips
    // its own display text to fit and never overflows its box, so scrollWidth
    // is equal to clientWidth whether the label fits or not — an assertion on
    // that passes on the bug, which is exactly what the first version of this
    // one did while the screen read AWAITING CHEC.
    const pill = rowOf("Sweet Hilda's Bakery").locator('[data-field="payment_status"]');
    const room = await pill.evaluate((el) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const label = [...el.options].map((o) => o.textContent)
        .reduce((a, b) => (b.length > a.length ? b : a), '');
      const tracking = parseFloat(cs.letterSpacing) || 0;
      const text = ctx.measureText(label.toUpperCase()).width + tracking * label.length;
      // The arrow a select draws for itself, plus its own padding.
      const chrome = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 22;
      return { text: Math.ceil(text), have: el.clientWidth - chrome, label };
    });
    ok(room.have >= room.text,
      `the payment pill fits its longest label (${room.label}: needs ${room.text}px, has ${room.have}px)`);

    // A check-paying vendor whose fee was waived is not somebody a check is
    // expected from, so the column does not offer to record one.
    const waived = rowOf('Alpine Alpacas');
    eq(await waived.locator('[data-checkin]').count(), 0,
      'a waived check-payer is not offered a check to mark in');
    ok((await waived.locator('.tlc-mkt-checkcol').textContent()).includes('nothing owed'),
      'and says why the boxes are not there');
  }

  group('a cell saves on its own');
  {
    const row = rowOf('Little Bear Knits');
    await row.locator('[data-field="table_number"]').fill('19/20');
    await row.locator('[data-field="table_number"]').blur();
    await row.locator('[data-field="table_number"].tlc-mkt-saved').waitFor({ timeout: 5000 });
    ok(true, 'the cell says it saved, on the cell rather than in a toast at the far end of the screen');
    eq(db.prepare("SELECT table_number FROM site_event_registrations WHERE contact_name='Steph Ruhl'").get().table_number,
      '19/20', 'and the table number really is in the database');

    // ⚠ THE PILL AND THE MONEY LINE REDRAW FROM WHAT THE SERVER SAID, not
    // from what the browser hoped it sent. A row that says Paid over a
    // database that says otherwise is the one failure this design must not
    // have.
    await row.locator('[data-field="payment_status"]').selectOption('paid');
    await row.locator('.tlc-mkt-money', { hasText: 'recorded' }).waitFor({ timeout: 5000 });
    ok(true, 'marking a row paid redraws the money line as a recorded amount');
    eq(db.prepare("SELECT payment_status FROM site_event_registrations WHERE contact_name='Steph Ruhl'").get().payment_status,
      'paid', 'because that is what was stored');
  }

  group('a check is marked in with one click');
  {
    const row = rowOf("Sweet Hilda's Bakery");
    ok((await row.locator('.tlc-mkt-pay').textContent()).includes('Awaiting check'),
      'a check vendor who has not paid is told apart from one who simply has not');
    await row.locator('[data-checkin]').click();
    await row.locator('.tlc-mkt-checkin').waitFor({ timeout: 5000 });
    const stored = db.prepare("SELECT * FROM site_event_registrations WHERE contact_name='Hilda Vogt'").get();
    eq(stored.payment_status, 'paid', '✓ In flips the row to paid');
    eq(stored.amount_paid_cents, stored.amount_due_cents, 'for the amount asked');
    ok((await row.locator('.tlc-mkt-checkcol').textContent()).includes('✓ Check'),
      'and the column becomes a statement rather than two empty boxes');
  }

  group('sorting, filtering and searching');
  {
    await page.locator('[data-sort="business"]').click();
    let names = await page.locator('.tlc-mkt-biz').allTextContents();
    eq(names[0], 'Alpine Alpacas', 'clicking a column header sorts by it');
    await page.locator('[data-sort="business"]').click();
    names = await page.locator('.tlc-mkt-biz').allTextContents();
    eq(names[0], "Sweet Hilda's Bakery", 'and clicking it again turns the order round');

    // ⚠ THE COUNT IS SCOPED TO WHAT THE ACTIVE FILTER CAN REACH. "1 of 4"
    // where 4 is every application teaches somebody that three rows are
    // hiding somewhere.
    await page.locator('[data-mktfilter="dropped"]').click();
    eq(await page.locator('.tlc-mkt-row:visible').count(), 1, 'a filter narrows the table');
    eq((await page.locator('#tlc-mkt-count').textContent()).trim(), '1 application shown',
      'and the count says what is shown, scoped to the filter');

    await page.locator('[data-mktfilter="all"]').click();
    await page.locator('#tlc-mkt-q').fill('honey');
    eq(await page.locator('.tlc-mkt-row:visible').count(), 1, 'the search reads what a vendor sells, not just their name');
    ok((await page.locator('#tlc-mkt-count').textContent()).includes('of 5'),
      'and says how many it is narrowing from');

    await page.locator('#tlc-mkt-q').fill('zzzz');
    eq(await page.locator('.tlc-mkt-row:visible').count(), 0, 'a search that matches nothing shows nothing');
    ok(await page.locator('#tlc-mkt-none').isVisible(), 'and says so rather than leaving an empty box');
    await page.locator('#tlc-mkt-q').fill('');
  }

  group('the rest of the application opens underneath its own row');
  {
    const row = rowOf('Bee Line Apiary');
    await row.locator('[data-expand]').click();
    ok(await row.locator('.tlc-mkt-more').isVisible(), 'the chevron opens the row in place');
    ok((await row.locator('.tlc-mkt-more').textContent()).includes('Raw honey'), 'showing what they sell');
    ok((await row.locator('.tlc-mkt-more').textContent()).includes('marcus@example.com'), 'and how to reach them');
    eq(await row.locator('[data-expand]').getAttribute('aria-expanded'), 'true', 'and says it is open to a screen reader');

    // The notes field is a cell like any other — it saves on its own.
    await row.locator('[data-field="staff_notes"]').fill('Check came in the office mail.');
    await row.locator('[data-field="staff_notes"]').blur();
    await row.locator('.tlc-mkt-notes.tlc-mkt-saved').waitFor({ timeout: 5000 });
    eq(db.prepare("SELECT staff_notes FROM site_event_registrations WHERE contact_name='Marcus Dohrmann'").get().staff_notes,
      'Check came in the office mail.', 'a note typed in the open row is stored');

    await row.locator('[data-expand]').click();
    eq(await row.locator('.tlc-mkt-more').isVisible(), false, 'and the chevron closes it again');
  }

  group('a printed sheet is the sheet, and nothing else');
  {
    // ⚠ THE ADMIN'S OWN CHROME IS NOT PART OF THE SHEET. Checked by asking the
    // browser what it will actually print rather than by reading the CSS —
    // without the print rules the navy sidebar comes out down the left of
    // every page and a job lead's handout arrives with a column of admin
    // navigation on it.
    await page.goto(BASE + '/market?tab=volunteers&print=leads&day=2026-12-05', { waitUntil: 'domcontentloaded' });
    await page.emulateMedia({ media: 'print' });
    ok(await page.locator('.tlc-print-sheet').first().isVisible(), 'the sheet itself prints');
    eq(await page.locator('.sidebar').isVisible(), false, 'the sidebar does not');
    eq(await page.locator('[data-noprint]').first().isVisible(), false,
      'and neither does the preview bar above it');
    await page.emulateMedia({ media: 'screen' });
    ok(await page.locator('.sidebar').isVisible(), 'while on screen the sidebar is still there');
    await page.goto(BASE + '/market', { waitUntil: 'domcontentloaded' });
  }

  group('a save that does not reach the server looks failed');
  {
    // ⚠ THE WHOLE RISK OF EDITING IN PLACE is somebody typing a table number,
    // seeing it sit there looking typed, and walking away from a change that
    // never landed. Verified by making the route unreachable rather than by
    // reasoning about it.
    await page.route('**/market/update', (r) => r.abort());
    const row = rowOf('Painted Pony Studio');
    await row.locator('[data-field="table_number"]').fill('99');
    await row.locator('[data-field="table_number"]').blur();
    await row.locator('.tlc-mkt-failed').waitFor({ timeout: 5000 });
    ok(true, 'a cell whose save failed is marked failed, not left looking saved');
    eq(db.prepare("SELECT table_number FROM site_event_registrations WHERE contact_name='Karen Weber'").get().table_number,
      '', 'and nothing was written');
    await page.unroute('**/market/update');
  }
} finally {
  await browser.close();
  srv.close();
}

console.log(`\nmarket-admin.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
