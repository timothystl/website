// End-to-end check that a block-managed ministry page renders correctly on the
// public site. Serves ./public locally, stubs the admin API with exactly what
// the Worker would return (rendered by the real admin/blocks.js), and drives a
// real browser.
//
//   NODE_PATH=$(npm root -g) node test/public-page.test.mjs
//
// Playwright + Chromium are preinstalled in the dev container; this is not part
// of the deploy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { renderPage, newBlock, migrateLegacyPage, sanitizeBlocks, BLOCK_DEFS } from '../admin/blocks.js';

// Playwright is installed globally in the dev container, not as a project
// dependency (the repo has no package.json on purpose). ESM ignores NODE_PATH,
// so resolve it off the global root by hand.
const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// Mirrors the site worker: unknown paths fall through to the SPA shell.
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

async function visit(slug, apiPage, posts = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://admin.timothystl.org/**', (route) => {
    const u = route.request().url();
    if (u.endsWith('/posts')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(posts) });
    if (u.includes('/api/ministry/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiPage) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto(base + '/' + slug, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return { page, ctx, errors };
}

// The Worker's response shape for a block-managed page.
const apiFor = (slug, blocks, extra = {}) => Object.assign({
  slug, title: 'Music Ministry', content: '<p>LEGACY CONTENT</p>', has_posts: 0,
  cta_label: 'Legacy CTA', cta_url: 'https://example.org', cta_label_2: '', cta_url_2: '',
  hero_image_url: '/images/hero.jpg', ministry_image_url: '/images/legacy-photo.jpg',
  vid_1_url: 'https://youtu.be/LEGACYVIDEO', vid_1_title: 'Legacy video',
  updated_at: '2026-07-30', page_status: 'live',
  blocks_html: blocks ? renderPage(sanitizeBlocks(blocks), { slug }) : '',
}, extra);

console.log('\npublic ministry page — block-managed');
{
  const blocks = migrateLegacyPage({
    slug: 'music', title: 'Music Ministry',
    content: '<p>BLOCK CONTENT HERE</p>',
    ministry_image_url: '/images/choir.jpg',
    cta_label: 'Join the choir', cta_url: 'https://forms.gle/abc',
    vid_1_url: 'https://youtu.be/dQw4w9WgXcQ', vid_1_title: 'Handbells',
    has_posts: 1,
  });
  const { page, ctx, errors } = await visit('music', apiFor('music', blocks), [
    { id: 1, title: 'Advent Lessons and Carols', post_date: '2099-12-08', event_date: '2099-12-08', body: '<p>x</p>' },
    { id: 2, title: 'An older note', post_date: '2020-01-01', body: '<p>y</p>' },
  ]);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  ok(await page.locator('#music-content .tlcb--textphoto').count() > 0, 'text+photo block rendered into the content region');
  ok(await page.locator('#music-content').innerHTML().then((h) => h.includes('BLOCK CONTENT HERE')), 'block body text is on the page');
  ok(!(await page.locator('#music-content').innerHTML()).includes('LEGACY CONTENT'), 'legacy content column is not also rendered');
  eq(await page.locator('#music-content-section').isVisible(), true, 'content section is shown');
  eq(await page.locator('.tlcb--video iframe, .tlcb--video .tlcb-embed-ph').count(), 1, 'video block rendered');
  ok(await page.locator('#music-content img[src*="choir.jpg"]').count() > 0, 'block photo rendered');
  // legacy regions must not double up
  eq(await page.locator('#music-vid-grid').isVisible(), false, 'legacy video section is taken down when a Video block exists');
  eq(await page.locator('#music-ministry-photo-wrap img').count(), 0, 'legacy ministry photo slot stays empty');
  const ctaVisible = await page.locator('#page-music > .page-cta-bar').isVisible().catch(() => false);
  eq(ctaVisible, false, 'hardcoded CTA bar hidden when a Button bar block exists');
  ok(await page.locator('.tlcb--buttons a[href="https://forms.gle/abc"]').count() > 0, 'button block links out');
  // feed hydration
  ok(await page.locator('.tlcb--posts .tlcb-card').count() > 0, 'posts feed block hydrated from the ministry posts API');
  eq(await page.locator('#music-upcoming-section').isVisible().catch(() => false), false, 'legacy post accordion stays hidden');
  // stylesheet shipped exactly once
  eq(await page.locator('style#tlcb-css').count(), 1, 'block stylesheet present once');
  await ctx.close();
}

console.log('\npublic ministry page — legacy fallback (not yet converted)');
{
  const { page, ctx, errors } = await visit('music', apiFor('music', null));
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  ok((await page.locator('#music-content').innerHTML()).includes('LEGACY CONTENT'), 'legacy content still renders when there are no blocks');
  eq(await page.locator('.tlcb').count(), 0, 'no block markup on a legacy page');
  ok(await page.locator('#music-ministry-photo-wrap img').count() > 0, 'legacy ministry photo still fills its slot');
  ok(await page.locator('#music-vid-grid .vid-card').count() > 0, 'legacy video grid still fills');
  await ctx.close();
}

console.log('\npublic ministry page — every block type renders without error');
{
  const all = Object.keys(BLOCK_DEFS).map((t) => newBlock(t));
  const { page, ctx, errors } = await visit('vbs', apiFor('vbs', all, { title: 'VBS' }));
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  // this list leads with a hero, so the page renders in whole-page mode and the
  // blocks live in the page itself rather than the old content region
  eq(await page.locator('#page-vbs .tlcb').count(), all.length, 'all block types present on the page');
  // nothing overflows the page horizontally — the classic phone-layout failure
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, 'no horizontal overflow at 1280px (got ' + overflow + ')');
  eq(await page.locator('.tlcb-page--full').count(), 1, 'and it took the whole page over');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  const overflowPhone = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflowPhone <= 1, 'no horizontal overflow at 390px (got ' + overflowPhone + ')');
  // columns collapse on a phone
  const cols = await page.evaluate(() => {
    const el = document.querySelector('.tlcb--textphoto .tlcb-grid');
    return el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : 0;
  });
  eq(cols, 1, 'text+photo collapses to one column on a phone');
  await ctx.close();
}

console.log('\npublic ministry page — hidden-on-phone blocks');
{
  const blocks = [newBlock('text', { body: '<p>Always</p>' }), newBlock('text', { body: '<p>Desktop only</p>', hidden: true })];
  const { page, ctx } = await visit('vbs', apiFor('vbs', blocks, { title: 'VBS' }));
  eq(await page.locator('.tlcb-hide-phone').isVisible(), true, 'hidden-on-phone block is visible on desktop');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  eq(await page.locator('.tlcb-hide-phone').isVisible(), false, 'hidden-on-phone block is hidden on a phone');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
