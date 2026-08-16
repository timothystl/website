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
import { renderPage, newBlock, migrateLegacyPage, sanitizeBlocks, BLOCK_DEFS, BLOCK_CSS } from '../admin/blocks.js';

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
  let body = fs.readFileSync(file);
  // ?edge=<id> stands in for site-worker.js having already put that page's
  // published blocks into the HTML. It does the same three things the real
  // rewriter does — prepend the host, mark the page, hide the original
  // children — so the SPA sees exactly what a real visitor's first paint has.
  const edge = url.searchParams.get('edge');
  if (edge && file.endsWith('index.html')) {
    const open = new RegExp('<div id="page-' + edge + '"([^>]*)>');
    body = Buffer.from(String(body).replace(open,
      (m, attrs) => '<div id="page-' + edge + '"' + attrs + ' data-tlcb-edge="1">' +
        '<div id="' + edge + '-blocks"><div class="tlcb-page"><div class="tlcb tlcb--text">' +
        'EDGE RENDERED</div></div></div>'));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
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
    // /api/pages is where the ONE copy of the block stylesheet ships now —
    // the ministry responses carry none, and the client awaits this before
    // injecting block markup. The stub mirrors that, or every geometry
    // assertion below would measure unstyled markup.
    if (u.includes('/api/pages')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ pages: [], menu: null, rendered: {}, redirects: {}, css: BLOCK_CSS }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto(base + '/' + slug, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return { page, ctx, errors };
}

// Same harness, but /api/pages answers with a real `rendered` entry and the
// document arrives with the edge injection already applied.
async function visitEdged(slug, renderedHtml, { edged = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://admin.timothystl.org/**', (route) => {
    const u = route.request().url();
    if (u.includes('/api/pages')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ pages: [{ id: slug, slug: '/' + slug }], menu: null,
          rendered: { [slug]: renderedHtml }, redirects: {}, css: BLOCK_CSS }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto(base + '/' + slug + (edged ? '?edge=' + slug : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  return { page, ctx, errors };
}

// The Worker's response shape for a block-managed page — withCss:false, as
// the real /api/ministry/:slug renders since the stylesheet moved to
// /api/pages alone.
const apiFor = (slug, blocks, extra = {}) => Object.assign({
  slug, title: 'Music Ministry', content: '<p>LEGACY CONTENT</p>', has_posts: 0,
  cta_label: 'Legacy CTA', cta_url: 'https://example.org', cta_label_2: '', cta_url_2: '',
  hero_image_url: '/images/hero.jpg', ministry_image_url: '/images/legacy-photo.jpg',
  vid_1_url: 'https://youtu.be/LEGACYVIDEO', vid_1_title: 'Legacy video',
  updated_at: '2026-07-30', page_status: 'live',
  blocks_html: blocks ? renderPage(sanitizeBlocks(blocks), { slug, withCss: false }) : '',
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
  // Hero first on purpose — that is the signal that puts the page in whole-page
  // mode, which is the harder layout to get right, so test every type in it.
  const all = ['hero', ...Object.keys(BLOCK_DEFS).filter((t) => t !== 'hero')].map((t) => newBlock(t));
  const { page, ctx, errors } = await visit('vbs', apiFor('vbs', all, { title: 'VBS' }));
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  // ⚠ `chips` — the Coming-up strip — renders NOTHING when nothing is coming
  // up, and that is deliberate: it is a one-line aside between two real
  // sections, and a strip announcing its own emptiness is worse than the gap.
  // This block has no feed behind it here, so it is correctly absent.
  //
  // Named rather than subtracted from the count. `all.length - 1` would pass
  // just as well if a SECOND type quietly stopped rendering, which is the
  // failure this assertion exists to catch.
  const drawn = await page.$$eval('#page-vbs .tlcb', (ns) => ns.map((n) =>
    (n.className.match(/tlcb--([a-z]+)/) || [])[1]).filter(Boolean));
  const absent = all.map((b) => b.type).filter((t) => !drawn.includes(t));
  eq(JSON.stringify(absent), JSON.stringify(['chips']),
    'every block type is on the page except the one that draws nothing when empty');
  // this list leads with a hero, so the page renders in whole-page mode and the
  // blocks live in the page itself rather than the old content region
  eq(await page.locator('#page-vbs .tlcb').count(), all.length - 1, 'and nothing else is missing');
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

console.log('\npublic ministry page — half blocks stack on a phone and center on a full-bleed page');
{
  const blocks = [
    newBlock('hero'),
    Object.assign(newBlock('text', { body: '<p>Left half</p>' }), { width: 'half' }),
    Object.assign(newBlock('text', { body: '<p>Right half</p>' }), { width: 'half' }),
  ];
  const { page, ctx, errors } = await visit('vbs', apiFor('vbs', blocks, { title: 'VBS' }));
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

  // ⚠ Pair members are GRANDCHILDREN of the page, so the > .tlcb centering
  // rule never reaches them — the wrapper has to carry the padding, or a half
  // run on a hero-led page sits hard against the viewport edge while every
  // full block around it is centered. At 1280 wide with an 1100px wrap that
  // padding is 90px a side.
  const pad = await page.evaluate(() => {
    const pair = document.querySelector('.tlcb-page--full > .tlcb-pair');
    return pair ? parseFloat(getComputedStyle(pair).paddingLeft) : null;
  });
  ok(pad !== null && pad > 80, 'the pair wrapper carries the full-bleed centering (got ' + pad + ')');

  const wide = await page.$$eval('.tlcb-pair .tlcb', (ns) => ns.map((n) => Math.round(n.getBoundingClientRect().width)));
  ok(wide.length === 2 && wide[0] < 700 && Math.abs(wide[0] - wide[1]) < 2,
    'halves sit side by side on desktop (got ' + wide.join(', ') + ')');

  // ⚠ The phone rule must be column-count — the pair is CSS columns, and the
  // old grid-template rule was a no-op that left two ~165px columns at 390px.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  const stacked = await page.$$eval('.tlcb-pair .tlcb', (ns) => ns.map((n) => Math.round(n.getBoundingClientRect().width)));
  ok(stacked.every((w) => w >= 330), 'halves take the full width at 390px (got ' + stacked.join(', ') + ')');
  const tops = await page.$$eval('.tlcb-pair .tlcb', (ns) => ns.map((n) => Math.round(n.getBoundingClientRect().top)));
  ok(tops[1] > tops[0] + 10, 'and one sits under the other rather than beside it');
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

console.log('\nthe homepage is frugal with its fetches');
{
  // The home card and the sermons page each fetched /api/sermon-series on
  // every homepage load — the same data twice — and the Christmas Market
  // posts were fetched at boot for a page the visitor had not opened.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const hits = [];
  await page.route('https://admin.timothystl.org/**', (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  eq(hits.filter((u) => u.includes('/api/sermon-series')).length, 1,
    'the sermon series is fetched exactly once');
  ok(!hits.some((u) => u.includes('/api/ministry/christmasmarket/posts')),
    'the market posts wait for their page to be opened');
  await ctx.close();
}

console.log('\nthe edge already rendered the page');
{
  // ⚠ THE FAILURE THIS GUARDS IS A VISIBLE ONE: every block on the page twice,
  // one copy under the other. The edge injects the blocks into the HTML so
  // there is no flash of the hardcoded markup; the client then loads
  // /api/pages for the menu and the church details, sees the same `rendered`
  // entry, and must not put it in again.
  const html = renderPage(sanitizeBlocks([newBlock('text', { body: '<p>PUBLISHED BODY</p>' })]),
    { slug: 'news', withCss: false });
  const { page, ctx, errors } = await visitEdged('news', html);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.locator('#news-blocks').count(), 1, 'the block host appears exactly once');
  ok((await page.textContent('#page-news')).includes('EDGE RENDERED'),
    'and it is the copy the edge put there');
  ok(!(await page.textContent('#page-news')).includes('PUBLISHED BODY'),
    'the client did not inject a second copy on top of it');
  await ctx.close();

  // ⚠ AND THE FALLBACK STILL WORKS. With no edge injection — an unreachable
  // admin at request time, or a page the worker could not resolve — the client
  // must do exactly what it always did. This is the half that makes the whole
  // change additive rather than a swap.
  const plain = await visitEdged('news', html, { edged: false });
  eq(plain.errors.length, 0, 'no page errors: ' + plain.errors.join(' | '));
  eq(await plain.page.locator('#news-blocks').count(), 1, 'the client injects it once');
  ok((await plain.page.textContent('#page-news')).includes('PUBLISHED BODY'),
    'and the published blocks are on the page');
  await plain.ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
