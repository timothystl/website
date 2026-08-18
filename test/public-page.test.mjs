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
import { renderPage, newBlock, migrateLegacyPage, sanitizeBlocks, BLOCK_DEFS, BLOCK_CSS, BG } from '../admin/blocks.js';

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
//
// `path` defaults to `/slug` — true for most pages, but not for a nested
// address like the Christmas Market vendor application, whose id
// ("marketvendors") and real address ("/christmasmarket/vendors") are two
// different strings on purpose (`NESTED_PATHS` in public/index.html). A
// harness that only ever visited `/slug` could never exercise that gap.
async function visitEdged(slug, renderedHtml, { edged = true, path = null } = {}) {
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
  await page.goto(base + (path || '/' + slug) + (edged ? '?edge=' + slug : ''), { waitUntil: 'domcontentloaded' });
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

console.log('\na block ships its own script, and both paths run it');
{
  // ⚠ THE BUG THIS GUARDS WAS LIVE AND SILENT. A <script> inserted with
  // innerHTML never executes — the HTML spec, not a browser quirk — so the
  // countdown ticked on a direct visit (the edge parses the markup normally)
  // and sat frozen on an em dash if the same page was reached from anywhere
  // else on the site. Verified in a browser before it was fixed.
  //
  // The countdown is the block that proves it, because it is the one whose
  // browser half changes something a visitor can see.
  const blocks = sanitizeBlocks([Object.assign(newBlock('photobanner'),
    { title: 'Christmas Market', countdown: true })]);
  const data = { news: [{ id: 1, title: 'Christmas Market', event_date: '2099-12-06' }] };
  const html = renderPage(blocks, { slug: 'news', withCss: false, data });
  ok(/<script/.test(html), 'the countdown block really does ship a script');

  const { page, ctx, errors } = await visitEdged('news', html, { edged: false });
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.evaluate(() => !!window.__tlcCountdown), true,
    'the block script ran after a client-side takeover');
  const reads = (await page.textContent('[data-countdown]')).trim();
  ok(reads !== '—' && /\d+d /.test(reads),
    `the countdown is ticking rather than frozen — reads ${JSON.stringify(reads)}`);
  await ctx.close();
}

console.log('\nthe Give button is legible on every field');
{
  // ⚠ THE BUG THIS GUARDS WAS REPORTED AS "the background of the box blends
  // into the give button". .tlcb-chip was declared twice in BLOCK_CSS — once
  // for this button and once, 385 lines later, for the Coming-up strip's pill.
  // Equal specificity, so source order decided: the button lost its gold fill
  // to the strip's chip-bg background and kept its near-black ink. On the Ink
  // navy field that is #1B1608 on 8% cream over navy, about 1.3:1.
  //
  // Asserting the CONTRAST rather than the hex is what makes this worth
  // having: it fails for any future rule that repaints the button, not only
  // for a reintroduced duplicate of this one class name.
  // ⚠ ALPHA IS PART OF THE ANSWER, NOT NOISE TO BE DROPPED. The first version
  // of this helper read the first three numbers and ignored the fourth, which
  // made the very wash it was written to catch — rgba(245,240,230,0.08) — look
  // like opaque cream and score 14:1 against the near-black label. It would
  // have passed on the bug. A translucent fill has no contrast that can be
  // asserted at all, because what it composites over is a gradient, so the
  // alpha is checked separately and a translucent button fails outright.
  const parse = (c) => {
    const n = c.match(/[\d.]+/g).map(Number);
    return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(parse(a)), lum(parse(b))].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  const inkNavy = BG.findIndex((b) => b.name === 'Ink navy');
  const navy = BG.findIndex((b) => b.name === 'Navy');
  for (const [name, bg] of [['Ink navy', inkNavy], ['Navy', navy], ['Parchment', 0]]) {
    const html = renderPage(sanitizeBlocks([Object.assign(newBlock('give'), { bg })]),
      { slug: 'news', withCss: false });
    const { page, ctx } = await visitEdged('news', html, { edged: false });
    const seen = await page.evaluate(() => {
      const el = document.querySelector('.tlcb-chip--go');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, ink: cs.color };
    });
    ok(seen, `the Give button renders on ${name}`);
    if (seen) {
      // Opaque first — this is the assertion that fails on the reported bug.
      eq(parse(seen.bg).a, 1,
        `the Give button has a fill of its own on ${name} rather than a wash over the field — got ${seen.bg}`);
      const r = ratio(seen.bg, seen.ink);
      ok(r >= 4.5, `and its label is legible on ${name} — ${r.toFixed(2)}:1 (needs 4.5)`);
    }
    await ctx.close();
  }

  // And the Coming-up strip keeps its own pill, which is the half that would
  // go unnoticed if the fix were made by deleting a rule instead of scoping it.
  const strip = renderPage(sanitizeBlocks([newBlock('chips')]), { slug: 'news', withCss: false,
    data: { news: [{ id: 1, title: 'Christmas Market', event_date: '2099-12-06' }] } });
  const { page, ctx } = await visitEdged('news', strip, { edged: false });
  const pill = await page.evaluate(() => {
    const el = document.querySelector('.tlcb-chip-row .tlcb-chip');
    return el ? getComputedStyle(el).borderRadius : null;
  });
  eq(pill, '999px', 'the Coming-up strip still gets its rounded pill');
  await ctx.close();
}

console.log('\nthe photo gallery opens a viewer');
{
  const blocks = sanitizeBlocks([Object.assign(newBlock('gallery'), {
    items: [{ url: '/images/logo.png', title: 'The choir' },
      { url: '/images/logo.png', title: 'Handbells' }],
  })]);
  const html = renderPage(blocks, { slug: 'news', withCss: false });
  const { page, ctx, errors } = await visitEdged('news', html, { edged: false });
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

  // A real button, so it is reachable without a pointer at all.
  eq(await page.locator('.tlcb-gal-open').count(), 2, 'each photo is a button');
  eq(await page.locator('.tlcb-lb').count(), 0, 'no viewer is built until one is opened');

  await page.locator('.tlcb-gal-open').first().click();
  eq(await page.locator('.tlcb-lb').isVisible(), true, 'clicking a photo opens the viewer');
  eq(await page.locator('.tlcb-lb-cap').textContent(), 'The choir', 'the caption is the photo description');
  eq(await page.locator('.tlcb-lb-of').textContent(), '1 of 2', 'and it says which one of how many');

  await page.keyboard.press('ArrowRight');
  eq(await page.locator('.tlcb-lb-cap').textContent(), 'Handbells', 'the right arrow moves to the next photo');
  await page.keyboard.press('ArrowRight');
  eq(await page.locator('.tlcb-lb-cap').textContent(), 'The choir', 'and it wraps round');

  // ⚠ Focus has to come back to the thumbnail it was opened from, or a
  // keyboard visitor is dropped at the top of the document every time they
  // close a photograph.
  await page.keyboard.press('Escape');
  eq(await page.locator('.tlcb-lb').isVisible(), false, 'Escape closes it');
  eq(await page.evaluate(() => document.activeElement &&
    document.activeElement.classList.contains('tlcb-gal-open')), true,
  'and focus returns to the photo it was opened from');
  await ctx.close();

  // The editor renders the same block as plain images: on the canvas a click
  // has to select the block, not open a viewer over the page being edited.
  const edit = renderPage(blocks, { slug: 'news', withCss: false, editing: true });
  ok(!/tlcb-gal-open/.test(edit), 'no viewer buttons in the editor');
  ok(!/__tlcLightbox/.test(edit), 'and no viewer script in the editor');
}

console.log('\na jump-to-name button actually jumps, instead of bouncing to home');
{
  // Dinger: "i created a #application jump to, created a button that would
  // go there, and when i publish it and click on that button it takes me to
  // the home page." — then, after a first fix, still: "still going to home
  // page. also refresh isnt reloading the page." Three bugs stacked here,
  // and the reported page (the Christmas Market vendor application) is what
  // caught the second and third: its id ("marketvendors") and its real
  // address ("/christmasmarket/vendors") are two different strings, and a
  // test that only ever visits `/marketvendors` — page id == path — can
  // never catch a bug that only shows up when they differ.
  //
  // (1) the target block's id carried a "jump-" prefix nothing on screen
  // ever mentioned, so #application never matched anything.
  // (2) even with a matching id, a same-page #fragment click fires a native
  // popstate event with e.state null — indistinguishable, to a naive
  // handler, from "nothing left in history" — and the first fix attempt
  // re-derived the page id from location.pathname to tell the two apart,
  // which is exactly what breaks on this page: 'christmasmarket/vendors' is
  // not 'marketvendors', so that lookup failed and fell back to home, same
  // as before. Comparing the PATH itself (which a #fragment click never
  // changes) rather than trying to re-resolve an id fixes both the common
  // case and this one, without needing to know about NESTED_PATHS at all.
  // (3) separately, "refresh isn't reloading the page": a full load or
  // reload with a jump-to-name fragment still in the address bar always
  // scrolled to the top, because the block content a fragment might target
  // arrives asynchronously (the /api/pages fetch), well after showPage()'s
  // own synchronous scroll-to-hash attempt already came up empty-handed —
  // and by the time a retry could run, history.replaceState (built from
  // the page's plain address, never a fragment) had already erased the
  // hash from the address bar, so a second attempt reading location.hash
  // fresh would find nothing either. Fixed by capturing the hash once, up
  // front, and handing that same value to both attempts.
  const blocks = sanitizeBlocks([
    Object.assign(newBlock('buttons'), { items: [{ title: 'Jump to application', url: '#application' }] }),
    Object.assign(newBlock('spacer'), { height: 96 }),
    Object.assign(newBlock('text', { body: '<p>The application section.</p>' }), { anchorId: 'application' }),
  ]);
  const html = renderPage(blocks, { slug: 'marketvendors', withCss: false });
  const { page, ctx, errors } = await visitEdged('marketvendors', html, { edged: false, path: '/christmasmarket/vendors' });
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

  ok(/id="application"/.test(await page.content()), 'the target block carries the exact name shown in the inspector, no hidden prefix');
  eq(await page.evaluate(() => (document.querySelector('.page.active') || {}).id), 'page-marketvendors',
    'sanity check: the nested address really did resolve to the vendor page, not somewhere else');

  await page.locator('a.tlcb-btn', { hasText: 'Jump to application' }).click();
  await page.waitForTimeout(400);
  eq(await page.evaluate(() => (document.querySelector('.page.active') || {}).id), 'page-marketvendors',
    'the click stays on the same page — it does not bounce to home, even on a nested address');
  ok(await page.evaluate(() => window.scrollY > 0), 'and the page actually scrolled down to the target');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  eq(await page.evaluate(() => (document.querySelector('.page.active') || {}).id), 'page-marketvendors',
    'a hard reload while sitting at the fragment stays on the same page too');
  ok(await page.evaluate(() => window.scrollY > 0),
    'and lands back at the target instead of resetting to the top — "refresh isn\'t reloading the page"');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
