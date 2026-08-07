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
// payroll_periods is held for real in the stub, so approving and taking it
// back round-trip the way they do against Postgres — a test that accepted any
// POST would not notice the page sending a delete that never matched anything.
let APPROVALS = [];

const srv = http.createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname.startsWith('/sb/rest/v1/')) {
    const table = u.pathname.slice('/sb/rest/v1/'.length);

    if (table === 'payroll_periods') {
      if (q.method === 'GET') {
        r.writeHead(200, { 'Content-Type': 'application/json' });
        return r.end(JSON.stringify(APPROVALS));
      }
      if (q.method === 'DELETE') {
        APPROVALS = [];
        r.writeHead(200, { 'Content-Type': 'application/json' });
        return r.end('[]');
      }
      let raw = '';
      q.on('data', (c) => { raw += c; });
      return q.on('end', () => {
        try {
          const rec = JSON.parse(raw);
          APPROVALS = [{ ...rec, approved_at: '2026-08-01T10:00:00Z' }];
        } catch (_) { /* the page sent nothing usable */ }
        r.writeHead(200, { 'Content-Type': 'application/json' });
        r.end('[]');
      });
    }
    if (table === 'x-email') { /* unreachable; keeps the shape obvious */ }

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
  // The Paid As column was removed — salaried is now read off the row having
  // no hours box (checked below) rather than a "Salaried" pill.
  ok(rows.some((r) => r.includes('Andrew Dinger')), 'the salaried lead pastor has a row');
  ok(rows.some((r) => r.includes("Maria O'Brien")), 'an apostrophe in a name renders as itself');
  ok(rows.some((r) => r.includes('Andrew Dinger') && /Edit/.test(r)),
    'the Edit button moved up onto the person\'s own row');

  // Salaried people have no hours box — there is nothing to type. PTO is an
  // hourly idea too (v4.2.0): a salaried person is paid the same whether or
  // not they take the day off, so they get neither box.
  const boxes = await p.$$eval('#entryRows input.tlc-pay-in', (ns) => ns.map((n) => n.dataset.staff + ':' + n.dataset.field));
  ok(!boxes.includes('c1:hours_worked'), 'a salaried person gets no hours box');
  ok(boxes.includes('c2:hours_worked'), 'an hourly person does');
  ok(!boxes.includes('c1:pto_hours_used'), 'and no PTO box either');
  ok(boxes.includes('c2:pto_hours_used'), 'but an hourly person can record PTO');

  // The status column says the thing that actually blocks a payroll run.
  ok((await text('#entryRows')).includes('Needs hours'), 'somebody with no hours yet is flagged');
  ok((await text('#entryState')).includes('still needs hours'), 'and the period says so in its own badge');

}

group('approving the period');
{
  // One decision about one run, not a tick beside eleven names.
  ok(await p.$('[data-review-staff]') === null, 'there is no per-row Approve button');
  ok(await p.$('#approvePeriodBtn') !== null, 'there is one Approve period button');

  const summary = await text('#periodSummary');
  ok(/hours from/.test(summary), 'the footer says what the run adds up to: ' + summary);

  // Somebody still has no hours, so approving asks rather than refuses — the
  // office may know that person genuinely worked none.
  p.once('dialog', (d) => d.accept());
  await p.click('#approvePeriodBtn');
  await p.waitForTimeout(300);

  ok(APPROVALS.length === 1, 'the approval was written: ' + JSON.stringify(APPROVALS));
  ok(APPROVALS[0].approved_by === 'dinger', 'with who did it, taken from the signed-in user');
  ok((await text('#entryState')).includes('Approved'), 'the period badge says Approved');
  ok((await text('#periodSummary')).includes('Approved by dinger'), 'and the footer says who and when');
  ok((await text('#entryRows')).includes('Approved'), 'every row in it reads Approved too');
  ok((await p.$eval('#approvePeriodBtn', (n) => n.textContent)).includes('Take back'),
    'and the button offers to undo rather than repeating itself');

  // Taking it back deletes the row rather than flipping a flag, so approved
  // can never be half-set.
  p.once('dialog', (d) => d.accept());
  await p.click('#approvePeriodBtn');
  await p.waitForTimeout(300);
  ok(APPROVALS.length === 0, 'taking it back removes the record');
  ok((await text('#entryRows')).includes('Ready'), 'and the rows go back to Ready');

  // Approve again so the reload check below has something to find.
  p.once('dialog', (d) => d.accept());
  await p.click('#approvePeriodBtn');
  await p.waitForTimeout(300);

  const p3 = await ctx.newPage();
  await p3.goto(base);
  await p3.waitForTimeout(700);
  ok((await p3.$eval('#entryState', (n) => n.textContent)).includes('Approved'),
    'the approval is still there after a reload');
  await p3.close();
}

group('a person with no hours is named before the run is signed off');
{
  // Dismissing the confirm must leave the approval exactly as it was.
  p.once('dialog', (d) => d.accept());
  await p.click('#approvePeriodBtn');           // take it back
  await p.waitForTimeout(250);
  let asked = '';
  p.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
  await p.click('#approvePeriodBtn');
  await p.waitForTimeout(250);
  ok(asked.includes('Sam Reed'), 'the person missing hours is named, not just counted: ' + asked);
  ok(APPROVALS.length === 0, 'and saying no really does not approve it');
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
  // No "Paid as" column: it repeated one word per row and said nothing the
  // row did not already say twice — a dash under Hours / salary and n/a under
  // PTO used IS "salaried". Four columns, not five.
  ok(!body.includes('Paid as'), 'and no Paid as column');
  ok(!body.includes('Childcare app'), 'nor the words that column carried');
  const cols = await p.$eval('#reportBody .tlc-pay-thead', (n) => n.children.length);
  ok(cols === 4, 'four columns in the header: ' + cols);
  const cells = await p.$eval('#reportBody .tlc-pay-row', (n) => n.children.length);
  ok(cells === 4, 'and four in every row, so the grid still lines up: ' + cells);
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

// ── THE EXPORTS ─────────────────────────────────────────────────────────────
// The CSV and the printed report are what leave this building: the bookkeeper
// keys the church allowance columns in by hand and reconciles the CSV against
// the printed page. Their SHAPE is therefore part of the contract, not a
// styling choice — the two drifted into a generic Person / Paid as / Gross
// table once, which dropped every allowance column and put church staff above
// MDO, and nobody found out until a payroll run. These assertions pin the
// format down so that cannot happen quietly again.
group('the CSV export keeps its format');
{
  const csv = await p.evaluate(async () => {
    let captured = null;
    const realCreate = URL.createObjectURL.bind(URL);
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:stub'; };
    HTMLAnchorElement.prototype.click = function () {};
    document.getElementById('exportBtn').click();
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    return captured ? await captured.text() : null;
  });
  ok(typeof csv === 'string' && csv.length > 0, 'pressing Export CSV produces a file');
  const lines = (csv || '').split('\r\n');
  const at = (s) => lines.findIndex((l) => l.startsWith(s));

  ok(lines[0].startsWith('"TLC Payroll — '), 'it opens with the title and period in column A alone: ' + lines[0]);
  ok(lines[1] === '', 'then a blank row');

  // MDO first. Not the order of reportGroups() (which drives the screen) —
  // this is the order of the report the office has always sent out.
  ok(at('"MDO Staff"') === 2, 'MDO staff lead the file');
  ok(at('"MDO Staff"') < at('"Church Staff"'), 'and church staff follow them');
  ok(lines[2] === '"MDO Staff","Type","Rate","Hours","PTO Hours","Gross Pay"',
    'with the MDO columns: ' + lines[2]);
  ok(lines[at('"Church Staff"')] === '"Church Staff","Type","Base/Earnings","Housing","Ins Opt-Out","HSA","Mileage","403(b)","Gross Pay"',
    'and the church columns, allowances and all: ' + lines[at('"Church Staff"')]);

  // An hourly row carries its rate and hours; a salaried one leaves them blank
  // rather than writing 0.00, which would read as "worked no hours".
  ok(lines.includes('"Skylor Murray","Hourly","17.25","40.00","","690.00"'),
    'an hourly childcare row: ' + lines.find((l) => l.startsWith('"Skylor Murray"')));
  ok(lines.includes('"T. Nguyen","Salary","","","","1750.00"'),
    'a salaried one leaves rate, hours and PTO blank: ' + lines.find((l) => l.startsWith('"T. Nguyen"')));

  // The columns the generic table lost. Mileage and housing are real money
  // somebody has to key in; an allowance that is not paid is blank, not 0.00.
  ok(lines.includes('"Andrew Dinger","Salary","1908.00","1908.00","","","150.00","","3966.00"'),
    'a church row keeps base, housing and mileage: ' + lines.find((l) => l.startsWith('"Andrew Dinger"')));
  // PY-2: the 403(b) base includes PTO, so 10% of (60+8)×$20 is $136, and it
  // is written as a negative because it comes off the gross. The church table
  // has no PTO column, so the PTO is named inside Base / Earnings — otherwise
  // that cell reads as $1,200 of earnings beside a gross built on $1,360.
  ok(lines.some((l) => l.startsWith('"Maria O\'Brien"') && l.includes('"60.00 + 8.00 PTO @ 20.00"') && l.includes('"-136.00"') && l.endsWith('"1224.00"')),
    'an hourly church row shows hours @ rate and a negative 403(b): ' + lines.find((l) => l.startsWith('"Maria O\'Brien"')));

  // Subtotal and total rows are padded to their own table's width, so the
  // figure lands under the Gross Pay column instead of in column B.
  ok(lines.includes('"MDO Subtotal",,,,,"2440.00"'), 'the MDO subtotal sits under Gross Pay: ' + lines.find((l) => l.startsWith('"MDO Subtotal"')));
  ok(lines.includes('"Church Subtotal",,,,,,,,"5190.00"'), 'and so does the church one: ' + lines.find((l) => l.startsWith('"Church Subtotal"')));
  ok(lines.includes('"TOTAL GROSS PAY",,,,,,,,"7630.00"'), 'and the combined total: ' + lines.find((l) => l.startsWith('"TOTAL')));

  // A cell starting with = is a formula to a spreadsheet (PY-5).
  const quoted = await p.evaluate(() => csvText('=cmd|calc'));
  ok(quoted.startsWith('"\''), 'a typed cell beginning with = is prefixed so it cannot execute: ' + quoted);
  ok((await p.evaluate(() => csvText('Smith "Jones"'))) === '"Smith ""Jones"""', 'quotes are doubled');
  // ⚠ And the guard must NOT reach our own figures. The 403(b) is written as a
  // negative, so prefixing it would turn -136.00 into text and the
  // bookkeeper's column would stop summing.
  ok((await p.evaluate(() => csvNum('-136.00'))) === '"-136.00"', 'a negative figure we formatted ourselves is left as a number');
}

group('the printed report keeps its format');
{
  await p.click('#viewReport');
  await p.waitForTimeout(150);
  const html = await p.$eval('#tlcPayPrint', (n) => n.innerHTML);
  const txt = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  ok(html.includes('Timothy Lutheran — Combined Payroll'), 'it is headed as the combined payroll');
  ok(html.includes('Pay Period:'), 'and names the period');
  ok(html.indexOf('MDO Staff') < html.indexOf('Church Staff'), 'MDO staff print first, church staff second');
  ok(html.includes('MDO Subtotal') && html.includes('Church Subtotal'), 'each group has its own subtotal');
  ok(html.includes('Total Gross Pay'), 'and there is one combined total');
  for (const col of ['Base / Earnings', 'Housing', 'Ins Opt-Out', 'HSA', 'Mileage', '403(b)']) {
    ok(html.includes(col), 'the church table keeps its ' + col + ' column');
  }
  ok(txt.includes('$17.25/hr') && txt.includes('40.00'), 'an hourly rate and its hours are printed');
  ok(txt.includes('$690.00') && txt.includes('$2,440.00'), 'with the gross and the MDO subtotal');
  ok(txt.includes('$7,630.00'), 'and the combined total');
  // An allowance that is not paid is an em dash, not $0.00.
  ok(txt.includes('—'), 'an allowance nobody has reads as a dash rather than a zero');

  // ⚠ The printed report must NOT follow the three screen layouts. It is the
  // bookkeeper's copy and has one shape; printing started following the screen
  // once, and the report changed shape depending on which tab was selected.
  const before = await p.$eval('#tlcPayPrint', (n) => n.innerHTML);
  await p.click('.tlc-pay-lay[data-layout="summary"]');
  await p.waitForTimeout(150);
  const after = await p.$eval('#tlcPayPrint', (n) => n.innerHTML);
  ok(before === after, 'switching to Totals only does not change what would print');
  await p.click('.tlc-pay-lay[data-layout="cards"]');
  await p.waitForTimeout(150);
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
