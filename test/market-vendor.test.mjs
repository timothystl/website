// The Christmas Market vendor application, driven in a real browser — run with:
//   node test/market-vendor.test.mjs
//
// The interesting half of this page is not markup, it is behavior: three
// steps, a total that has to move when somebody picks a second table, and a
// submit that must not reach the payment page with an empty required field.
// None of that can be checked by reading the HTML.
//
// ⚠ IT DRIVES THE BLOCK, NOT THE OLD HARDCODED PAGE. Until 2026-08-18 the
// application was markup in public/index.html wired by tlcMarketInit(); it is
// a `marketapp` block now, on its own page at /christmasmarket/vendors/apply,
// and the block ships its own delegated script inside its own markup. So this
// suite renders the real seed through the real renderer (admin/blocks.js) and
// serves it the way the live site gets it — through /api/pages — rather than
// reading anything out of public/index.html.
//
// ⚠ THE ADMIN IS NEVER REACHED. /api/pages is stubbed here with markup this
// file renders itself. One group deliberately makes it fail, because that is
// now a state with real consequences: deleting the hardcoded markup means an
// unreachable admin leaves the page EMPTY rather than stale, and that trade
// is worth pinning rather than leaving as folklore.
//
// ⚠ NOTHING HERE SUBMITS TO A REAL WORKER. The application POST is stubbed;
// what the server does with it is test/admin-redesign.test.mjs's job. This is
// only about what the browser does before and after.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { renderPage, sanitizeBlocks } from '../admin/blocks.js';
import { MARKET_APPLY_PAGE } from '../admin/market-vendors-apply-seed.js';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = 'http://localhost:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });

const APPLY_PATH = '/christmasmarket/vendors/apply';
const DEFAULT_MARKET = {
  open: true, tableFee: 30, feePercent: 2.9, feeFixed: 0.30, maxTables: 3,
  dateLabel: 'Saturday, Dec 5', hoursLabel: '11:00 am – 6:00 pm',
  coordinatorEmail: 'tlc.christmasmarket@gmail.com',
};

// The page as the Worker would render it: the real seed, the real renderer,
// the real settings shape. If this drifts from what pageData() supplies, the
// live page and this suite disagree — which is why it takes the seed rather
// than a fixture of its own.
function renderApply(market) {
  return renderPage(sanitizeBlocks(MARKET_APPLY_PAGE.blocks), {
    slug: MARKET_APPLY_PAGE.id,
    template: MARKET_APPLY_PAGE.template,
    data: { market },
    withCss: true,
  });
}

// A page with the admin stubbed. `market` null means /api/pages fails, which
// is the unreachable-admin case.
async function open({ market = {}, width = 1280, apply = { success: true, payUrl: 'https://give.tithe.ly/?amount=3120' } } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const submitted = [];
  await page.route('**/admin.timothystl.org/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/pages')) {
      if (market === null) return route.abort();
      const cfg = { ...DEFAULT_MARKET, ...market };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        pages: [{ id: MARKET_APPLY_PAGE.id, slug: APPLY_PATH, title: MARKET_APPLY_PAGE.title, in_menu: 0 }],
        rendered: { [MARKET_APPLY_PAGE.id]: renderApply(cfg) },
        menu: null, details: {}, redirects: {},
      }) });
    }
    if (url.includes('/api/market/apply')) {
      submitted.push(route.request().postData() || '');
      return route.fulfill({ status: apply.error ? 400 : 200, contentType: 'application/json', body: JSON.stringify(apply) });
    }
    // form-config, redirects, everything else the page asks for.
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + APPLY_PATH);
  // ⚠ `attached`, not the default `visible`. With the admin unreachable this
  // page div is genuinely empty, so it has no height and "visible" would time
  // out on the one case that group exists to check.
  await page.waitForSelector('#page-marketvendorsapply.active', { state: 'attached' });
  if (market !== null) {
    // The blocks arrive after a fetch on this path (the live site also gets
    // them injected at the edge, which this harness cannot reproduce), so
    // wait for the application itself rather than for paint.
    await page.waitForSelector('.tlcb-mktapp', { state: 'attached' });
  }
  return { page, ctx, errors, submitted };
}

const step = (page) => page.$eval('.tlcb-mktapp-step[aria-selected="true"]', (b) => b.dataset.step);
const due = (page) => page.textContent('[data-row="due"]');
const alertText = (page) => page.textContent('.tlcb-mktapp-alert');

group('the address resolves to the apply page');
{
  const { page, ctx, errors } = await open();
  ok(await page.isVisible('#page-marketvendorsapply'), APPLY_PATH + ' shows the application page');
  eq(await page.evaluate(() => location.pathname), APPLY_PATH,
    'and the address stays as typed rather than being rewritten to /marketvendorsapply');
  eq(await page.title(), 'Vendor Application — Timothy Christmas Market', 'with its own title');
  eq(await page.getAttribute('link[rel="canonical"]', 'href'), 'https://timothystl.org' + APPLY_PATH,
    'and its own canonical, so the nested address is the one indexed');
  ok(await page.isVisible('.tlcb-mktapp-form'), 'the application is on it');
  eq(errors.length, 0, `no script errors — ${errors.join(' | ')}`);
  await ctx.close();
}

group('the three steps');
{
  const { page, ctx } = await open();
  eq(await step(page), '1', 'it opens on step 1');
  ok(await page.isVisible('[data-panel="1"]'), 'and shows only that panel');
  ok(!(await page.isVisible('[data-panel="2"]')), 'the others are hidden');

  // ⚠ Moving forward validates; going back never does. Being trapped on step 2
  // when you wanted to fix a typo on step 1 is the classic wizard failure.
  await page.click('[data-goto="2"]');
  eq(await step(page), '1', 'Next refuses to leave step 1 with the required fields empty');
  ok((await alertText(page)).includes('who will be at the table'),
    'and says which one, in a sentence');

  await page.fill('#mkt-b-names', 'Marla Kerr');
  await page.fill('#mkt-b-email', 'not-an-email');
  await page.fill('#mkt-b-phone', '(314) 555-0123');
  await page.click('[data-goto="2"]');
  eq(await step(page), '1', 'an unusable email address is caught before the payment page, not after');

  await page.fill('#mkt-b-email', 'marla@example.com');
  await page.click('[data-goto="2"]');
  eq(await step(page), '2', 'a complete step 1 moves on');

  await page.click('[data-goto="1"]');
  eq(await step(page), '1', 'Back never validates — step 2 is empty and it still goes');

  // The tabs are a real way through, and they deliberately do not validate.
  await page.click('.tlcb-mktapp-step[data-step="3"]');
  eq(await step(page), '3', 'a tab jumps straight to any step');
  await ctx.close();
}

group('the total moves with the table count');
{
  const { page, ctx } = await open();
  await page.click('.tlcb-mktapp-step[data-step="3"]');
  eq(await due(page), '$31.20', 'one table is $31.20 — the figure confirmed against a real 2024 payment');
  eq(await page.textContent('[data-row="sub"]'), '$30', 'the subtotal is the bare table fee');
  eq(await page.textContent('[data-row="fee"]'), '$1.20', 'and the fee line is what the vendor is covering');

  await page.click('[data-tables="2"]');
  eq(await due(page), '$62.10', 'two tables retotals immediately');
  eq(await page.textContent('[data-row="sub-label"]'), '2 tables × $30', 'and the subtotal line says why');

  await page.click('[data-tables="3"]');
  eq(await due(page), '$93', 'three tables is $93.00');

  // ⚠ The button has to carry the figure. A button reading one amount that
  // charges another would be the worst thing this page could do.
  ok((await page.textContent('[data-submit-label]')).includes('$93'), 'the submit button says what it will ask for');
  eq(await page.$eval('[data-tables="3"]', (b) => b.getAttribute('aria-pressed')), 'true',
    'and the chosen count is marked pressed, not just tinted');
  eq(await page.$eval('[data-tables="1"]', (b) => b.getAttribute('aria-pressed')), 'false', 'the others are not');
  await ctx.close();
}

group('the settings reach the page');
{
  const { page, ctx } = await open({ market: {
    tableFee: 40, feePercent: 2.6, feeFixed: 0.10, maxTables: 4,
    dateLabel: 'Saturday, Dec 6', hoursLabel: '10:00 am – 5:00 pm',
    coordinatorEmail: 'market@example.org',
  } });
  // ⚠ Scoped to the page. The facts band is this page's own, and an unscoped
  // read would pick up whatever else the SPA ships in the document.
  const facts = await page.textContent('#page-marketvendorsapply .tlcb-mktfacts');
  ok(facts.includes('Dec 6'), 'the market day comes from settings');
  ok(facts.includes('10:00 am'), 'and so do the hours');
  ok(facts.includes('$40'), 'and the table fee');
  ok(facts.includes('4 max'), 'and the table maximum');
  eq(await page.$$eval('[data-tables]', (b) => b.length), 4, 'raising the maximum adds a table button');
  eq(await page.getAttribute('#page-marketvendorsapply .tlcb-mktfacts a', 'href'), 'mailto:market@example.org',
    'and the coordinator’s address is a setting, not a hardcoded mailto');
  await page.click('.tlcb-mktapp-step[data-step="3"]');
  eq(await due(page), '$41.17', 'a different processor’s rate reprices the whole page');
  await ctx.close();
}

// ⚠ THE COST OF DELETING THE HARDCODED MARKUP, PINNED RATHER THAN ASSUMED.
// The old page shipped every figure twice — in the markup and in a fetch — so
// an unreachable admin still quoted a working price. There is no second copy
// any more: the page is its blocks. What matters is that the failure is a
// blank region rather than a form quoting a price nobody can honor, and that
// nothing throws on the way there.
group('an unreachable admin leaves no half-working form behind');
{
  const { page, ctx, errors } = await open({ market: null });
  eq(await page.$$eval('.tlcb-mktapp', (n) => n.length), 0, 'no application is rendered at all');
  eq(await page.$$eval('[data-tables]', (n) => n.length), 0, 'and no price is quoted that could not be charged');
  eq(errors.length, 0, `with no script error — ${errors.join(' | ')}`);
  await ctx.close();
}

group('closing applications hides the form and keeps the page');
{
  const { page, ctx } = await open({ market: { open: false } });
  ok(!(await page.isVisible('.tlcb-mktapp-form')), 'the application card is gone');
  ok(await page.isVisible('.tlcb-mktapp-closed'), 'and says applications are closed');
  ok((await page.textContent('.tlcb-mktapp-closed')).includes('tlc.christmasmarket'),
    'with a person to write to instead');
  ok(await page.isVisible('#page-marketvendorsapply .tlcb-mktfacts'),
    'and the market day and hours are still on the page — somebody out of season learns when to come back');
  await ctx.close();
}

group('submitting');
{
  const { page, ctx, submitted } = await open();
  // Reaching step 3 by tab, with everything empty — the tabs do not validate,
  // so submit is the last line and has to check every step, not just this one.
  await page.click('.tlcb-mktapp-step[data-step="3"]');
  await page.click('[data-submit-label]');
  eq(submitted.length, 0, 'an empty application never leaves the browser');
  eq(await step(page), '1', 'and it lands on the first step that is wrong, not the last');

  await page.fill('#mkt-b-names', 'Marla Kerr');
  await page.fill('#mkt-b-email', 'marla@example.com');
  await page.fill('#mkt-b-phone', '3145550123');
  await page.click('[data-goto="2"]');
  await page.fill('#mkt-b-product', 'Handmade purses');
  await page.click('[data-goto="3"]');
  await page.click('[data-submit-label]');
  eq(submitted.length, 0, 'nor one with no signature — that is the agreement');
  eq(await step(page), '3', 'staying on the step with the empty box');

  await page.fill('#mkt-b-sign', 'Marla Kerr');
  await page.click('[data-submit-label]');
  await page.waitForTimeout(250);
  eq(submitted.length, 1, 'a complete application is sent');
  const body = submitted[0] || '';
  ok(body.includes('Marla Kerr'), 'carrying what was typed');
  ok(body.includes('marla@example.com'), 'including the address to reply to');
  await ctx.close();
}

// ⚠ The application is already saved by the time the browser sees the answer.
// A missing payment address is therefore not a failure to report as one.
group('no payment link is not an error');
{
  const { page, ctx } = await open({ apply: { success: true, payUrl: '' } });
  await page.fill('#mkt-b-names', 'Marla Kerr');
  await page.fill('#mkt-b-email', 'marla@example.com');
  await page.fill('#mkt-b-phone', '3145550123');
  await page.click('[data-goto="2"]');
  await page.fill('#mkt-b-product', 'Candles');
  await page.click('[data-goto="3"]');
  await page.fill('#mkt-b-sign', 'Marla Kerr');
  await page.click('[data-submit-label]');
  await page.waitForFunction(() => (document.querySelector('.tlcb-mktapp-alert') || {}).textContent);
  const said = await alertText(page);
  ok(said.includes('application is in'), 'the vendor is told their application arrived, because it did');
  ok(said.includes('tlc.christmasmarket'), 'and how to pay instead');
  ok(!said.toLowerCase().includes('went wrong'), 'never that something broke');
  await ctx.close();
}

group('the pills answer an optional question');
{
  const { page, ctx } = await open();
  const stored = () => page.$eval('[name="returning_vendor"]', (i) => i.value);
  eq(await stored(), '', 'nothing is chosen to begin with');
  await page.click('[data-returning="yes"]');
  eq(await stored(), 'yes', 'clicking one records it');
  await page.click('[data-returning="no"]');
  eq(await stored(), 'no', 'clicking the other swaps it');
  // ⚠ Without this there is no way back to "did not say" once tapped, on a
  // question nobody has to answer.
  await page.click('[data-returning="no"]');
  eq(await stored(), '', 'clicking the chosen one again clears it');
  eq(await page.$$eval('[data-returning][aria-pressed="true"]', (b) => b.length), 0, 'and nothing is left pressed');
  await ctx.close();
}

// ⚠ A file dropped half an inch off the drop zone must not make the browser
// navigate to the photograph — that is a half-filled application replaced by
// a JPEG, with no way back to it.
group('a stray file drop does not throw the application away');
{
  const { page, ctx } = await open();
  await page.click('.tlcb-mktapp-step[data-step="3"]');
  const defaultPrevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
    const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    document.querySelector('.tlcb-mktapp-agree').dispatchEvent(e);
    return e.defaultPrevented;
  });
  ok(defaultPrevented, 'a drop anywhere on the application is swallowed');
  eq(await page.evaluate(() => location.pathname), APPLY_PATH, 'and the page is still the page');
  await ctx.close();
}

// The same 390px floor the rest of the public site is measured at.
group('on a phone');
{
  const { page, ctx, errors } = await open({ width: 390 });
  eq(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true,
    'the page does not scroll sideways');
  const small = await page.$$eval('#page-marketvendorsapply .tlcb-mktapp-step, #page-marketvendorsapply .tlcb-btn, #page-marketvendorsapply .tlcb-mktapp-pill',
    (els) => els.filter((e) => e.offsetParent !== null)
      .map((e) => ({ t: (e.textContent || '').trim().slice(0, 28), h: Math.round(e.getBoundingClientRect().height) }))
      .filter((x) => x.h < 44));
  ok(small.length === 0, `every step tab, button and pill is at least 44px tall — under: ${JSON.stringify(small)}`);

  await page.click('.tlcb-mktapp-step[data-step="3"]');
  const buttons = await page.$$eval('[data-tables]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  ok(buttons.every((h) => h >= 44), `the table buttons too — ${JSON.stringify(buttons)}`);
  const inputs = await page.$$eval('#page-marketvendorsapply .tlcb-mktapp-field input',
    (els) => els.filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height)));
  ok(inputs.every((h) => h >= 40), `and the fields are tappable — ${JSON.stringify(inputs)}`);
  eq(errors.length, 0, `no script errors at phone width — ${errors.join(' | ')}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\nmarket-vendor: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
