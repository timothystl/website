#!/usr/bin/env node
// Browser checks for the built site (run `npm run build` first).
//   node test/browser-check.mjs [--shots dir]
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'manifest.json'), 'utf8'));
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const PORT = 8790;
const BASE = `http://localhost:${PORT}`;

const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), String(PORT)], { stdio: 'pipe' });
await new Promise((r) => server.stdout.once('data', r));
const browser = await chromium.launch();
let failures = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(`✔ ${name}`); } catch (e) { failures++; results.push(`✖ ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}
async function open(ctxOpts, url) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  const external = [];
  page.on('request', (req) => { if (!req.url().startsWith(BASE)) external.push(req.url()); });
  await page.goto(BASE + url);
  await page.waitForFunction(() => document.getElementById('counter').textContent.length > 0);
  await page.waitForTimeout(150);
  return { ctx, page, errors, external };
}
const counter = (page) => page.locator('#counter').textContent();
const DESKTOP = { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 };
const PHONE = devices['iPhone 13'];
const dayBy = (slug) => m.days.find((d) => d.slug === slug);

await check('desktop: ?date=2026-12-09 opens the Dec 9 spread as two pages', async () => {
  const { ctx, page, errors, external } = await open(DESKTOP, '/?date=2026-12-09');
  const d = dayBy('dec-9');
  assert.match(await counter(page), new RegExp(`${d.label}: ${d.title}`));
  assert.match(await counter(page), new RegExp(`Pages ${d.page}–${d.page + 1} of ${m.pageCount}`));
  assert.equal(new URL(page.url()).pathname, '/dec-9');
  assert.equal(await page.locator('#btn-today').isVisible(), true);
  assert.equal(await page.locator('#notice').textContent(), '(Test date: 2026-12-09.)');
  const cookies = await ctx.cookies();
  assert.deepEqual(cookies, []);
  assert.deepEqual(external, [], 'no third-party requests');
  const imgs = await page.locator('.page img[src]').count();
  assert.ok(imgs > 0 && imgs <= 10, `only nearby pages load (${imgs})`);
  const next = await page.locator('#btn-next').boundingBox();
  assert.ok(next.y + next.height <= 900, `page-turn buttons visible without scrolling (bottom ${next.y + next.height})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-dec-9.png') });
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('desktop: arrow keys and buttons turn pages', async () => {
  const { ctx, page } = await open(DESKTOP, '/?date=2026-12-09');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1000);
  assert.match(await counter(page), new RegExp(dayBy('dec-10').label));
  await page.click('#btn-prev');
  await page.waitForTimeout(1000);
  assert.match(await counter(page), new RegExp(dayBy('dec-9').label));
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1000);
  assert.match(await counter(page), new RegExp(dayBy('dec-8').label));
  await ctx.close();
});

await check('before Advent (?date=2026-11-20) → cover with notice', async () => {
  const { ctx, page } = await open(DESKTOP, '/?date=2026-11-20');
  assert.match(await counter(page), /^Cover$/);
  assert.match(await page.locator('#notice').textContent(), /begin Sunday, November 29/);
  assert.equal(await page.locator('#btn-today').isVisible(), false);
  await ctx.close();
});

await check('after Christmas (?date=2026-12-28) → cover, archive notice', async () => {
  const { ctx, page } = await open(DESKTOP, '/?date=2026-12-28');
  assert.match(await counter(page), /^Cover$/);
  assert.match(await page.locator('#notice').textContent(), /has ended/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop-after.png') });
  await ctx.close();
});

await check('Today button returns to today after browsing', async () => {
  const { ctx, page } = await open(DESKTOP, '/nov-29?date=2026-12-25');
  assert.match(await counter(page), /Sunday, November 29/);
  await page.click('#btn-today');
  await page.waitForTimeout(300);
  assert.match(await counter(page), /Friday, December 25/);
  await ctx.close();
});

await check(`every day link (${m.days.length}) opens the right spread on desktop and phone`, async () => {
  for (const opts of [DESKTOP, PHONE]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    for (const d of m.days) {
      await page.goto(`${BASE}/${d.slug}?date=2026-11-01`);
      await page.waitForFunction(() => document.getElementById('counter').textContent.length > 0);
      const c = await counter(page);
      assert.ok(c.includes(`${d.label}: ${d.title}`), `${d.slug}: counter was "${c}"`);
      const pagesPart = opts === DESKTOP ? `Pages ${d.page}–${d.page + 1}` : `Page ${d.page} of`;
      assert.ok(c.includes(pagesPart), `${d.slug}: expected "${pagesPart}", counter was "${c}"`);
      assert.equal(new URL(page.url()).pathname, `/${d.slug}`);
      assert.equal(await page.title(), `${d.label}: ${d.title} · ${m.title}`);
    }
    await ctx.close();
  }
});

await check('phone: single page, swipe turns to the art and prayer page', async () => {
  const { ctx, page, errors } = await open(PHONE, '/dec-9');
  const d = dayBy('dec-9');
  assert.match(await counter(page), new RegExp(`Page ${d.page} of`));
  const box = await page.locator('#book').boundingBox();
  assert.ok(box.width <= 390 && box.width > 300, `book width ${box.width}`);
  const docW = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(docW <= 390, `no sideways scroll (${docW})`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-dec-9.png') });
  const y = box.y + box.height / 2;
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', box.x + box.width - 30);
  for (let x = box.x + box.width - 60; x > box.x + 40; x -= 40) await touch('touchMove', x);
  await touch('touchEnd');
  await page.waitForTimeout(1200);
  assert.match(await counter(page), new RegExp(`Page ${d.page + 1} of`));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-dec-9-right.png') });
  const targets = await page.$$eval('button:not([hidden]), a.btn', (els) => els.filter((e) => e.offsetParent).map((e) => {
    const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim(), r.width, r.height];
  }));
  for (const [id, w, h] of targets) assert.ok(w >= 44 && h >= 44, `${id} is ${w}×${h}`);
  assert.deepEqual(errors, []);
  await ctx.close();
});

await check('days list: grouped by week, jumps to the chosen day', async () => {
  const { ctx, page } = await open(PHONE, '/?date=2026-12-09');
  await page.click('#btn-contents');
  const heads = await page.locator('#contents-list h3').allTextContents();
  assert.deepEqual(heads, ['Front of the booklet', ...m.weeks.map((w) => w.label), 'Back of the booklet']);
  assert.equal(await page.locator('#contents-list .today-tag').count(), 1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-days.png') });
  await page.click('#contents-list a[data-slug="dec-20"]');
  await page.waitForTimeout(200);
  assert.match(await counter(page), new RegExp(dayBy('dec-20').label));
  assert.equal(new URL(page.url()).pathname, '/dec-20');
  await page.click('#btn-contents');
  await page.click('#contents-list a:has-text("About the art")');
  await page.waitForTimeout(200);
  assert.match(await counter(page), /About the art/);
  await ctx.close();
});

await check('read as text: larger type, day navigation, back to booklet', async () => {
  const { ctx, page } = await open(PHONE, '/dec-9');
  await page.click('#btn-text');
  const d = dayBy('dec-9');
  assert.equal(await page.locator('#tv-article h2').textContent(), d.title);
  assert.equal(await page.locator('#reader').isVisible(), false);
  const size = await page.locator('#tv-article p:not([class])').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  assert.ok(size >= 18, `text size ${size}`);
  assert.ok((await page.locator('#tv-article').textContent()).includes('Amen'), 'prayer from the right page is included');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-text.png'), fullPage: true });
  await page.click('#tv-next');
  assert.equal(await page.locator('#tv-article h2').textContent(), dayBy('dec-10').title);
  assert.match(page.url(), /\/dec-10#text$/);
  await page.click('#tv-back');
  await page.waitForTimeout(300);
  assert.match(await counter(page), new RegExp(dayBy('dec-10').label));
  await ctx.close();
});

await check('#text link opens straight to the text view', async () => {
  const { ctx, page } = await open(DESKTOP, '/dec-24#text');
  assert.equal(await page.locator('#tv-article h2').textContent(), dayBy('dec-24').title);
  await ctx.close();
});

await check('without JavaScript a day page still shows its text', async () => {
  const ctx = await browser.newContext({ ...DESKTOP, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dec-9`);
  assert.equal(await page.locator('#tv-article h2').textContent(), dayBy('dec-9').title);
  assert.equal(await page.locator('#tv-article').isVisible(), true);
  await ctx.close();
});

await check('download button serves the PDF', async () => {
  const { ctx, page } = await open(DESKTOP, '/');
  const href = await page.locator('a.download').getAttribute('href');
  const res = await page.request.get(BASE + href);
  assert.equal(res.status(), 200);
  assert.equal(res.headers()['content-type'], 'application/pdf');
  assert.equal((await res.body()).subarray(0, 5).toString(), '%PDF-');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('a.download')]);
  assert.equal(dl.suggestedFilename(), path.basename(href));
  await ctx.close();
});

await check('tablet portrait (768×1024) shows two-page spreads', async () => {
  const { ctx, page } = await open({ viewport: { width: 768, height: 1024 } }, '/dec-9');
  assert.match(await counter(page), /Pages 24–25/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tablet-dec-9.png') });
  await ctx.close();
});

await browser.close();
server.kill();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
