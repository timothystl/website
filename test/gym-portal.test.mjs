// The renter booking portal, driven in a real browser at 390px.
//   node --experimental-loader ./test/html-loader.mjs test/gym-portal.test.mjs
//
// Task 18 items 4 and 5. Two things here can only be checked by driving the
// page: whether removing one time from a date leaves the rest of that date
// alone, and whether a tap target is actually 44px on a phone. Both were
// wrong, and neither shows up in the markup.
//
// ⚠ A renter opens this from an email, ON A PHONE. That is the device this
// screen is for, so 390px is the default viewport here rather than a
// responsive afterthought at the bottom of the file.

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
    first: async () => { try { return db.prepare(sql).get(...args) ?? null; } catch (e) { throw e; } },
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
globalThis.fetch = async () => new Response('{}', { status: 200 });

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const db = new DatabaseSync(':memory:');
const env = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test' };
await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx);
db.prepare("INSERT INTO gym_groups (id,name,contact,email,access_token,active) VALUES (9,'Hoops League','A','a@b.example','tok9',1)").run();

const srv = http.createServer(async (q, r) => {
  const res = await worker.fetch(new Request('https://admin.timothystl.org' + q.url, {
    headers: { origin: 'https://admin.timothystl.org' },
  }), env, ctx);
  const body = await res.text();
  r.writeHead(res.status, { 'Content-Type': res.headers.get('content-type') || 'text/html' });
  r.end(body);
});
await new Promise((r) => srv.listen(0, r));
const URL_ = 'http://localhost:' + srv.address().port + '/gym/book/tok9';

const br = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const p = await (await br.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(URL_);
await p.waitForTimeout(300);

group('the phone is the real device (item 5)');
{
  // The 7-column month grid is the tightest thing on the page. A missed tap on
  // a calendar is not a small annoyance — it books the wrong day, or nothing,
  // and the renter tries again somewhere else.
  const docW = await p.evaluate(() => document.documentElement.scrollWidth);
  eq(docW, 390, 'nothing pushes the page sideways at 390px');

  const small = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('button,a,[role=button]').forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 32)) {
        out.push(((n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 24)) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    });
    return out;
  });
  ok(small.length === 0, 'every tap target clears 44px: ' + small.join(' | '));

  const cell = await p.$eval('[id^="cell-"]', (n) => Math.round(n.getBoundingClientRect().height));
  ok(cell >= 44, `a calendar day is at least 44px tall (got ${cell})`);

  // The request bar used to carry display:none AND display:flex in one style
  // attribute — the later one won, so an empty bar reading zero slots sat on
  // screen until the first script ran. The inline style may carry only the
  // none; everything else comes from the .req-bar class.
  const barStyle = await p.$eval('#req-bar', (n) => n.getAttribute('style') || '');
  ok(!/flex/.test(barStyle), 'the request bar markup does not force itself visible: ' + barStyle);
}

group('the request basket (item 4)');
{
  const days = await p.$$eval('[id^="cell-"]', (ns) => ns.slice(0, 40).map((n) => n.dataset.date));
  const pick = async (date, n) => {
    await p.click('#cell-' + date);
    await p.waitForTimeout(150);
    const btns = await p.$$('#day-panel-slots .slot-btn:not([disabled])');
    for (let i = 0; i < n && i < btns.length; i++) { await btns[i].click(); await p.waitForTimeout(60); }
  };
  const rows = () => p.$$eval('.bk-row', (rs) => rs.map((r) => ({
    date: r.querySelector('.bk-date').textContent,
    meta: r.querySelector('.bk-meta').textContent,
    times: [...r.querySelectorAll('.bk-time')].length,
  })));

  await pick(days[0], 2);
  await pick(days[1], 1);
  await p.waitForTimeout(200);

  let r = await rows();
  eq(r.length, 2, 'one row per date, not one row per slot');
  eq(r[0].times, 2, 'and every time on that date is listed');

  // The spec's own rule: adjacent hours print as ONE range, a gap as two.
  // "5–7 PM" and "5–6 PM, 7–8 PM" are different bookings.
  ok(/1–3 PM/.test(r[0].meta), 'two adjacent hours print as one range: ' + r[0].meta);

  // ⚠ Removing ONE time must leave the rest of that date alone. "Clear it all
  // and start again" is not a correction, and it is what a renter had before.
  await p.click('.bk-row:first-child .bk-time .bk-x');
  await p.waitForTimeout(200);
  r = await rows();
  eq(r.length, 2, 'removing one time keeps the date');
  eq(r[0].times, 1, 'and drops only that time');
  ok(!/1–3 PM/.test(r[0].meta), 'the range recomputes rather than going stale: ' + r[0].meta);

  await p.click('.bk-row:first-child > .bk-x');
  await p.waitForTimeout(200);
  r = await rows();
  eq(r.length, 1, 'the row ✕ removes the whole date');

  // What actually gets submitted has to follow the basket, or the renter books
  // something they removed.
  const inputs = await p.$$eval('#slot-inputs input', (n) => n.length);
  eq(inputs, 1, 'the posted slots match what the basket shows');
}

group('the basket is tappable at 390px');
{
  // ⚠ The first tap scan above runs on a fresh page, where the basket does
  // not exist yet — which is exactly how the basket's 44px rules shipped
  // defeated: they sat in the head stylesheet and the body stylesheet's
  // desktop sizes, later in source at equal specificity, won at every width.
  // Every string assertion stayed green. This scan runs with the basket ON
  // SCREEN, so a cascade regression fails here rather than in a renter's hand.
  const x = await p.$eval('.bk-row > .bk-x', (n) => {
    const r = n.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok(x.w >= 44 && x.h >= 44, `the row's remove button is 44px on a phone (got ${x.w}x${x.h})`);

  const chip = await p.$eval('.bk-time .bk-x', (n) => {
    const r = n.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  ok(chip.w >= 28 && chip.h >= 28, `a chip's remove target is at least 28px (got ${chip.w}x${chip.h})`);

  // And the visible bar is the styled one — sticky, capped at 30vh — not the
  // old inline copy that the class rules never reached.
  const bar = await p.$eval('#req-bar', (n) => {
    const c = getComputedStyle(n); return { display: c.display, position: c.position, max: c.maxHeight };
  });
  ok(bar.display === 'flex', 'the bar shows once slots are picked');
  ok(bar.position === 'sticky', `and is the styled sticky bar (got ${bar.position})`);
  ok(Math.abs(parseFloat(bar.max) - 844 * 0.3) < 2 || bar.max === '30vh',
    `capped at 30vh so it cannot swallow the page (got ${bar.max})`);
}

group('no script errors');
ok(errs.length === 0, 'the portal threw: ' + errs.join(' | '));

await br.close();
srv.close();
console.log(`\ngym-portal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
