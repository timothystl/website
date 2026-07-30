// Phase 10 — a ministry page whose blocks lead with a hero banner is rendered
// entirely from blocks, with the hardcoded sections stood down.
//   node test/whole-page.test.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { renderPage, sanitizeBlocks, newBlock } from '../admin/blocks.js';
import { PAGE_SEEDS } from '../admin/page-seeds.js';
import { createEditorServer } from './editor-server.mjs';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const site = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => site.listen(0, r));
const base = 'http://localhost:' + site.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });

async function visit(slug, blocks, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const payload = Object.assign({
    slug, title: 'Ministry', content: '<p>LEGACY BODY</p>', has_posts: 0,
    cta_label: '', cta_url: '', hero_image_url: '', ministry_image_url: '', page_status: 'live',
    blocks_html: blocks ? renderPage(sanitizeBlocks(blocks), { slug }) : '',
  }, extra);
  await page.route('https://admin.timothystl.org/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(route.request().url().endsWith('/posts') ? [] : payload),
  }));
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto(base + '/' + slug, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  return { page, ctx, errors };
}

group('the seeds are faithful to the pages they came from');
{
  eq(Object.keys(PAGE_SEEDS).length, 11, 'every ministry page has a seed');
  for (const [slug, blocks] of Object.entries(PAGE_SEEDS)) {
    eq(blocks[0].type, 'hero', `${slug} starts with its banner`);
    ok(blocks[0].title.length > 0, `${slug} banner has a title`);
    ok(blocks.length >= 2, `${slug} carries its sections too`);
    const clean = sanitizeBlocks(blocks);
    eq(JSON.stringify(clean), JSON.stringify(blocks), `${slug} seed is already sanitised`);
  }
  const music = PAGE_SEEDS.music;
  eq(music[0].title, 'Praise the Lord with Every Gift', 'music banner title came across');
  eq(music[0].eyebrow, 'Music Ministry', 'music banner eyebrow came across');
  ok(music[0].subtitle.startsWith('Rooted in the Lutheran tradition'), 'music banner subtitle came across');
  ok(JSON.stringify(music).includes('hammer dulcimer'), 'the body copy came across');
  ok(music.some((b) => b.type === 'buttons' && b.items.some((i) => i.url.includes('serve.timothystl.org'))),
    'the volunteer button and its link came across');
}

group('a page whose blocks lead with a hero takes over completely');
{
  const { page, ctx, errors } = await visit('music', PAGE_SEEDS.music);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.locator('.tlcb-page--full').count(), 1, 'the page renders in whole-page mode');
  eq(await page.locator('.tlcb--hero').count(), 1, 'exactly one banner');
  // the hardcoded banner and sections must be gone, not merely pushed down
  eq(await page.locator('#music-hero').isVisible().catch(() => false), false, 'the hardcoded banner is stood down');
  eq(await page.locator('#music-vid-grid').isVisible().catch(() => false), false, 'so is the hardcoded video strip');
  const body = await page.locator('#page-music').innerText();
  eq(body.split('Praise the Lord with Every Gift').length - 1, 1, 'the page title appears exactly once');
  eq(body.split('Traditional with eclectic music').length - 1, 1, 'and so does each section heading');
  ok(!body.includes('LEGACY BODY'), 'the legacy content column is not rendered as well');
  // the banner really is edge to edge
  const heroWidth = await page.evaluate(() => document.querySelector('.tlcb--hero').getBoundingClientRect().width);
  const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
  eq(Math.round(heroWidth), pageWidth, 'the banner spans the full width');
  // section backgrounds are continuous — no page background showing between blocks
  const gaps = await page.evaluate(() => {
    const bs = Array.from(document.querySelectorAll('.tlcb-page--full > .tlcb'));
    let worst = 0;
    for (let i = 1; i < bs.length; i++) {
      const above = bs[i - 1].getBoundingClientRect().bottom;
      const below = bs[i].getBoundingClientRect().top;
      worst = Math.max(worst, Math.abs(below - above));
    }
    return worst;
  });
  ok(gaps <= 1, 'blocks butt up against each other, so backgrounds run continuously (worst gap ' + gaps + 'px)');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, 'no horizontal overflow (got ' + overflow + ')');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(250);
  const phoneOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(phoneOverflow <= 1, 'no horizontal overflow on a phone (got ' + phoneOverflow + ')');
  await ctx.close();
}

group('every seeded page renders without error');
for (const [slug, blocks] of Object.entries(PAGE_SEEDS)) {
  const { page, ctx, errors } = await visit(slug, blocks);
  eq(errors.length, 0, `${slug}: no page errors ` + errors.join(' | '));
  eq(await page.locator('.tlcb-page--full').count(), 1, `${slug} renders in whole-page mode`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `${slug}: no horizontal overflow`);
  await ctx.close();
}

group('a page without a hero keeps its hardcoded sections');
{
  const { page, ctx, errors } = await visit('music', [newBlock('text', { body: '<p>Just a note.</p>' })]);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.locator('.tlcb-page--full').count(), 0, 'not in whole-page mode');
  eq(await page.locator('#music-hero').isVisible(), true, 'the hardcoded banner is still there');
  ok((await page.locator('#music-content').innerText()).includes('Just a note'), 'blocks still fill the content region');
  await ctx.close();
}

group('the editor previews whole-page mode the same way');
{
  const harness = createEditorServer({ pages: [{ slug: 'music', title: 'Music Ministry', blocks: PAGE_SEEDS.music }] });
  await new Promise((r) => harness.server.listen(0, r));
  const editorBase = 'http://localhost:' + harness.server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(editorBase + '/ministries/editor/music', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb');
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.locator('.ed-row').count(), PAGE_SEEDS.music.length, 'every section is a row in the rail');
  eq(await page.locator('.ed-paper .tlcb-page--full').count(), 1, 'the canvas previews whole-page mode');
  ok((await page.locator('.ed-row').first().textContent()).includes('Hero banner'), 'the banner is the first row — and editable');
  // the banner text is editable on the canvas, which was the whole complaint
  const heroTitle = page.locator('.ed-paper .tlcb--hero [data-field="title"]');
  eq(await heroTitle.getAttribute('contenteditable'), 'true', 'the banner title can be typed into');
  eq(await page.locator('.ed-paper .tlcb--hero [data-field="eyebrow"]').getAttribute('contenteditable'), 'true', 'so can its small label');
  eq(await page.locator('.ed-paper .tlcb--hero [data-field="subtitle"]').getAttribute('contenteditable'), 'true', 'and its subtitle');
  await heroTitle.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Sing to the Lord a New Song');
  await page.click('.ed-paper .tlcb--textphoto');
  await page.waitForTimeout(2100);
  const saved = JSON.parse(harness.pages.get('music').blocks);
  eq(saved[0].title, 'Sing to the Lord a New Song', 'editing the banner saves');
  // dropping the hero would hand the page back to its hardcoded sections
  eq(saved[0].type, 'hero', 'the banner is a normal block that can be moved or removed');
  await ctx.close();
  harness.server.close();
}

await browser.close();
site.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
