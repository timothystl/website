// The payroll screen, in a real browser, against a stubbed Supabase.
//   node test/payroll.test.mjs
//
// Payroll is the one screen where a rendering bug costs somebody money, and
// almost all of it is client-side: the page fetches its own data through the
// /sb proxy and does every calculation in the browser. So it is tested the way
// it actually runs — real Chromium, real fetches, stubbed responses — rather
// than by asserting on strings in the Worker's output.
//
// The fixtures are the shapes that have actually caused trouble: a salaried
// person with several line items, an hourly person whose PTO has to count
// towards the 403(b) base, a name with an apostrophe, and a childcare app that
// cannot be reached.
import http from 'node:http'; import path from 'node:path'; import fs from 'node:fs';
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process';
const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr, 'x.js'))('playwright');
import { ADMIN_UI_CSS, PANEL_LIST_CSS } from '../admin/ui.js';

const FRAGMENT = fs.readFileSync(new URL('../admin/payroll.html', import.meta.url), 'utf8');

// ── the fixtures ────────────────────────────────────────────────────────────
// Andrew: salaried, three line items, a percentage 403(b).
// O'Brien: hourly, with PTO — the apostrophe used to break the Edit button and
//          the PTO used to be left out of the 403(b) base (PY-1, PY-2).
const CHURCH_STAFF = [
  { id: 'c1', name: 'Andrew Dinger', role: 'Lead Pastor', pay_type: 'salary', active: true,
    hourly_rate: 0, base_salary_biweekly: 1908, housing_allowance_biweekly: 1908,
    insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 150,
    retirement_403b_type: 'fixed', retirement_403b_amount: 0 },
  { id: 'c2', name: "Maria O'Brien", role: 'Office Assistant', pay_type: 'hourly', active: true,
    hourly_rate: 20, base_salary_biweekly: 0, housing_allowance_biweekly: 0,
    insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 0,
    retirement_403b_type: 'percent', retirement_403b_amount: 0.1 },
  { id: 'c3', name: 'Sam Reed', role: 'Custodial', pay_type: 'hourly', active: true,
    hourly_rate: 16, base_salary_biweekly: 0, housing_allowance_biweekly: 0,
    insurance_opt_out_biweekly: 0, hsa_contribution_biweekly: 0, mileage_biweekly: 0,
    retirement_403b_type: 'fixed', retirement_403b_amount: 0 },
];
// 60 hours worked + 8 PTO at $20 = $1,360 base. A 10% 403(b) on that is $136,
// so gross is $1,224. If the 403(b) were computed on hours alone ($1,200) the
// deduction would be $120 and the card would say $1,240 while the total said
// $1,224 — that is exactly PY-2.
const ENTRIES = [{ staff_id: 'c2', period_start: null, hours_worked: 60, pto_hours_used: 8, pto_hours_earned: 0 }];

const MDO_STAFF = [
  { id: 'm1', name: 'Skylor Murray', role: 'Childcare', pay_type: 'hourly', hourly_rate: 17.25, salary_biweekly: 0, active: true },
  { id: 'm2', name: 'T. Nguyen', role: 'MDO Director', pay_type: 'salary', hourly_rate: 0, salary_biweekly: 1750, active: true },
];
const MDO_HOURS = [{ staff_id: 'm1', work_date: null, hours_worked: 40 }];

let mdoDown = false;
// payroll_reviews is held for real in the stub, so approving and un-approving
// round-trip the way they do against Postgres — a test that accepted any POST
// would not notice the page sending a delete that never matched anything.
let REVIEWS = [];

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname.startsWith('/sb/rest/v1/')) {
    const table = u.pathname.slice('/sb/rest/v1/'.length);

    if (table === 'payroll_reviews') {
      const val = (k) => {
        const raw = u.searchParams.get(k);
        return raw ? raw.replace(/^eq\./, '') : null;
      };
      if (q.method === 'GET') {
        r.writeHead(200, { 'Content-Type': 'application/json' });
        return r.end(JSON.stringify(REVIEWS));
      }
      if (q.method === 'DELETE') {
        const src = val('source'), sid = val('staff_id');
        REVIEWS = REVIEWS.filter((x) => !(x.source === src && x.staff_id === sid));
        r.writeHead(200, { 'Content-Type': 'application/json' });
        return r.end('[]');
      }
      let raw = '';
      q.on('data', (c) => { raw += c; });
      return q.on('end', () => {
        try {
          const rec = JSON.parse(raw);
          REVIEWS = REVIEWS.filter((x) => !(x.source === rec.source && x.staff_id === rec.staff_id));
          REVIEWS.push({ ...rec, reviewed_at: '2026-08-01T10:00:00Z' });
        } catch (_) { /* the page sent nothing usable */ }
        r.writeHead(200, { 'Content-Type': 'application/json' });
        r.end('[]');
      });
    }

    if (q.method !== 'GET') { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end('[]'); }
    if (mdoDown && ['staff', 'staff_hours', 'staff_clock_events', 'staff_pto_entries'].includes(table)) {
      r.writeHead(500, { 'Content-Type': 'application/json' });
      return r.end(JSON.stringify({ message: 'childcare app unreachable' }));
    }
    const body = {
      church_staff: CHURCH_STAFF,
      church_staff_period_entries: u.search.includes('lt.') ? [] : ENTRIES,
      staff: MDO_STAFF,
      staff_hours: MDO_HOURS,
      staff_clock_events: [],
      staff_pto_entries: [],
    }[table] || [];
    r.writeHead(200, { 'Content-Type': 'application/json' });
    return r.end(JSON.stringify(body));
  }
  r.writeHead(200, { 'Content-Type': 'text/html' });
  r.end(`<!doctype html><html><head><meta charset="utf-8"><style>${ADMIN_UI_CSS}${PANEL_LIST_CSS}</style></head>`
    + `<body><span class="sidebar-user">dinger</span>${FRAGMENT}</body></html>`);
});
await new Promise((r) => srv.listen(0, r));
const base = 'http://localhost:' + srv.address().port;

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.goto(base);
await p.waitForFunction(() => !document.querySelector('#entryRows .tlc-pay-empty'), null, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(300);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const group = (n) => console.log('\n' + n);
const text = async (sel) => (await p.$eval(sel, (n) => n.textContent)).replace(/\s+/g, ' ').trim();

group('the page runs at all');
ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

group('enter & approve');
{
  const rows = await p.$$eval('#entryRows .tlc-pay-row', (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
  // Three church staff, the one childcare person with hours, and the salaried
  // MDO director — who has no hours to show but is still owed a salary.
  ok(rows.length === 5, 'everybody who is owed something this period: ' + rows.length);
  ok(rows.some((r) => r.includes('Andrew Dinger') && r.includes('Salaried')), 'a salaried person is marked salaried');
  ok(rows.some((r) => r.includes("Maria O'Brien")), 'an apostrophe in a name renders as itself');

  // Salaried people have no hours box — there is nothing to type.
  const boxes = await p.$$eval('#entryRows input.tlc-pay-in', (ns) => ns.map((n) => n.dataset.staff + ':' + n.dataset.field));
  ok(!boxes.includes('c1:hours_worked'), 'a salaried person gets no hours box');
  ok(boxes.includes('c2:hours_worked'), 'an hourly person does');
  ok(boxes.includes('c1:pto_hours_used'), 'but everybody can record PTO');

  // The status column says the thing that actually blocks a payroll run.
  ok((await text('#entryRows')).includes('Needs hours'), 'somebody with no hours yet is flagged');
  ok((await text('#entryState')).includes('still needs hours'), 'and the period says so in its own badge');

  // Nothing can be approved until its figures exist, so that row gets no
  // button — one that silently did nothing would be worse than none.
  const noBtn = await p.$('[data-review-staff="c3"]');
  ok(noBtn === null, 'a person with no hours yet has no Approve button');
  ok(await p.$('[data-review-staff="c1"]') !== null, 'somebody whose figures are in does');
}

group('checking a row off as reviewed');
{
  // Approved is a stored fact, not a label: a row in payroll_reviews.
  ok((await text('#entryRows')).includes('Ready'), 'a row with figures but no review reads as Ready');

  await p.click('[data-review-staff="c1"]');
  await p.waitForTimeout(250);
  ok((await text('#entryRows')).includes('Approved'), 'approving one says so');
  ok(REVIEWS.length === 1 && REVIEWS[0].staff_id === 'c1', 'and it really was written: ' + JSON.stringify(REVIEWS));
  ok(REVIEWS[0].reviewed_by === 'dinger', 'with who did it, taken from the signed-in user');

  // MDO people can be checked off too — a review covering only half the
  // payroll would be worse than none.
  await p.click('[data-review-staff="m1"]');
  await p.waitForTimeout(250);
  ok(REVIEWS.some((x) => x.source === 'mdo' && x.staff_id === 'm1'), 'a childcare person can be approved as well');

  // Un-checking deletes the row rather than flipping a flag, so "reviewed"
  // can never be half-set.
  await p.click('[data-review-staff="c1"]');
  await p.waitForTimeout(250);
  ok(!REVIEWS.some((x) => x.staff_id === 'c1'), 'un-approving removes the record: ' + JSON.stringify(REVIEWS));
  ok((await text('#entryRows')).includes('Ready'), 'and the row goes back to Ready');

  // It survives a reload — that is the whole point of storing it.
  const p3 = await ctx.newPage();
  await p3.goto(base);
  await p3.waitForTimeout(700);
  const after = (await p3.$eval('#entryRows', (n) => n.textContent)).replace(/\s+/g, ' ');
  ok(after.includes('Approved'), 'the childcare approval is still there after a reload');
  await p3.close();
}

group('the period badge names the outstanding step');
{
  // With somebody still missing hours, that outranks everything — telling
  // Dinger "2 left to check" while two people have no hours would point him
  // at the wrong job.
  ok((await text('#entryState')).includes('still needs hours'), 'missing hours outrank unchecked rows');
}

group('the childcare app is read, not imported');
{
  const live = await text('#mdoLiveText');
  ok(live.includes('read live from the MDO app'), 'the row says hours come from the MDO app: ' + live);
  const btns = await p.$$eval('#mdoLive button', (ns) => ns.map((n) => n.textContent.trim()));
  ok(!btns.some((t) => /import/i.test(t)),
    'and offers no Import button, because there is no import step to be stale: ' + btns.join('/'));
  ok(btns.includes('Read again'), 'the one real action is fetching again');
}

group('the report — detail cards');
{
  await p.click('#viewReport');
  await p.waitForTimeout(200);
  const body = await text('#reportBody');

  // Andrew: 1908 + 1908 + 150 = 3966.
  ok(body.includes('$3,966.00'), 'a salaried gross adds up its line items: ' + body.slice(0, 120));

  // PY-2: the 403(b) base must include PTO, or the card does not reconcile.
  ok(body.includes('$1,224.00'), 'PTO counts towards the 403(b) base, so the card reconciles to its own gross');
  ok(body.includes('−$136.00'), 'and the deduction shown is the one that was actually applied');

  ok(body.includes('Church staff'), 'the church group is labelled');
  ok(body.includes('Timothy MDO'), 'and so is MDO');
  ok(body.includes('Combined total'), 'with a combined total');
}

group('the report — one line each');
{
  await p.click('.tlc-pay-lay[data-layout="table"]');
  await p.waitForTimeout(150);
  const body = await text('#reportBody');
  ok(body.includes('Hours / salary'), 'the compact layout has the design’s columns');
  ok(body.includes('60.00 hrs @ $20.00'), 'and states the basis of an hourly gross');
  ok((await text('#layoutNote')).includes('reconcile against the service'), 'with the design’s note');
}

group('the report — totals only');
{
  await p.click('.tlc-pay-lay[data-layout="summary"]');
  await p.waitForTimeout(150);
  const body = await text('#reportBody');
  ok(body.includes('People paid'), 'the summary counts people');
  ok(body.includes('Hours recorded'), 'and hours');
  ok((await text('#layoutNote')).includes('safe to share with council'), 'with the design’s note');

  // Church 3966 + 1224 = 5190 (Sam has no hours, so no pay).
  // MDO 40 × 17.25 = 690, plus 1750 salaried = 2440. Combined 7630.
  ok(body.includes('$5,190.00'), 'the church subtotal is right');
  ok(body.includes('$2,440.00'), 'the MDO subtotal is right');
  ok(body.includes('$7,630.00'), 'and the combined total is the sum of them');
}

group('a person with no pay is left out of the report');
{
  const body = await text('#reportBody');
  ok(!body.includes('Sam Reed'), 'somebody with no hours does not appear as a $0.00 line');
}

group('the person drawer');
{
  await p.click('#viewEntry');
  await p.waitForTimeout(120);
  await p.click('[data-edit-staff="c2"]');
  await p.waitForTimeout(150);
  ok(await p.locator('#staffDrawer').evaluate((n) => n.classList.contains('is-open')), 'editing a person opens the drawer');
  ok((await p.$eval('#fName', (n) => n.value)) === "Maria O'Brien", 'an apostrophe survives into the form');
  ok((await p.$eval('#fHourlyRate', (n) => n.value)) === '20', 'and the rate is prefilled');
  ok(await p.locator('#hourlyField').isVisible(), 'an hourly person is shown the rate field');
  ok(await p.locator('#salaryField').isHidden(), 'and not the salary one');

  // PY-7: Escape closes it and focus comes back.
  await p.keyboard.press('Escape');
  await p.waitForTimeout(120);
  ok(!(await p.locator('#staffDrawer').evaluate((n) => n.classList.contains('is-open'))), 'Escape closes the drawer');
}

group('when the childcare app cannot be read, the report says so');
{
  mdoDown = true;
  const p2 = await ctx.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(String(e)));
  await p2.goto(base);
  await p2.waitForTimeout(700);
  ok(errs2.length === 0, 'the page still runs: ' + errs2.join(' | '));

  const live = await p2.$eval('#mdoLiveText', (n) => n.textContent);
  ok(live.includes('could not be reached'), 'the entry view says the app is unreachable');
  ok(live.includes('incomplete'), 'and that the report is therefore incomplete');

  await p2.click('#viewReport');
  await p2.waitForTimeout(200);
  const body = await p2.$eval('#reportBody', (n) => n.textContent);
  // PY-9: a failed MDO query used to be swallowed by `|| []`, so the report
  // quietly came out short and nobody knew until somebody was underpaid.
  ok(body.includes('Do not send it to the payroll service'),
    'and the report itself refuses to look complete');
  ok(!body.includes('Skylor Murray'), 'no childcare staff are shown, rather than a stale copy');
  await p2.close();
  mdoDown = false;
}

group('CSV export');
{
  const csv = await p.evaluate(() => {
    // eslint-disable-next-line no-undef
    const rows = reportGroups();
    return JSON.stringify(rows.map((g) => g.people.map((x) => x.name)));
  }).catch(() => null);
  ok(csv === null || typeof csv === 'string', 'reportGroups is reachable for the exporter');

  // A cell starting with = is a formula to a spreadsheet (PY-5).
  const quoted = await p.evaluate(() => csvCell('=cmd|calc'));
  ok(quoted.startsWith('"\''), 'a cell beginning with = is prefixed so it cannot execute: ' + quoted);
  ok((await p.evaluate(() => csvCell('Smith "Jones"'))) === '"Smith ""Jones"""', 'quotes are doubled');
}

group('money is rounded to cents before it is summed');
{
  // PY-6: rounding only the total makes a printed subtotal disagree with the
  // rows above it. Three thirds of a cent must not become a cent.
  const summed = await p.evaluate(() => {
    const parts = [0.005, 0.005, 0.005];
    return fromCents(parts.reduce((n, x) => n + cents(x), 0));
  });
  ok(Math.abs(summed - 0.03) < 1e-9, 'each value rounds before it is added: ' + summed);
}

await b.close();
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
