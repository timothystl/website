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
import { renderPage, newBlock, sanitizeBlocks, BLOCK_DEFS, BLOCK_CSS, BG } from '../admin/blocks.js';

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

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });

// ?edge=<id> stands in for site-worker.js having already put that page's
// published blocks into the HTML — prepend the host, mark the page,
// hide every one of the page's own OTHER direct children, exactly what
// rewriteDocument() does in site-worker.js.
//
// ⚠ A REAL DOM, NOT A REGEX. An earlier version of this matched only the
// opening `<div id="page-<id>">` tag and spliced a closing `</div>` in right
// after the injected host — which closed `#page-<id>` immediately, kicking
// every one of its real hardcoded children out to become SIBLINGS instead.
// That went unnoticed because every existing assertion here only ever
// checked substrings of `textContent`, which does not care about nesting or
// about `display:none` either — so a test built to check that hidden
// content is ACTUALLY HIDDEN (not just present somewhere in the document)
// needs the real nesting a regex over an unparsed string cannot reliably
// preserve. `DOMParser`, run inside a scratch page, is a real HTML parser
// with no dependency this dependency-free repo would have to add — and it
// parses inertly: no script runs, no request fires, so it costs nothing
// beyond the one extra page.
async function computeEdgedHtml(rawHtml, pageId, blocksHtml) {
  const prep = await browser.newPage();
  try {
    return await prep.evaluate(({ rawHtml, pageId, blocksHtml }) => {
      const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
      const pageEl = doc.getElementById('page-' + pageId);
      if (pageEl) {
        const host = doc.createElement('div');
        host.id = pageId + '-blocks';
        host.innerHTML = blocksHtml;
        pageEl.insertBefore(host, pageEl.firstChild);
        pageEl.setAttribute('data-tlcb-edge', '1');
        Array.prototype.forEach.call(pageEl.children, (c) => {
          if (c === host) return;
          const prev = c.getAttribute('style') || '';
          c.setAttribute('style', prev ? prev + ';display:none' : 'display:none');
        });
      }
      return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    }, { rawHtml, pageId, blocksHtml });
  } finally {
    await prep.close();
  }
}

// ⚠ `nextEdgeBody` IS SINGLE-USE AND MUST BE SET IMMEDIATELY BEFORE THE ONE
// page.goto() IT IS FOR. This file drives its visits one at a time (every
// caller `await`s its own visit before the next starts), so a module-level
// slot consumed on the very next request that carries `?edge=` is safe; it
// would not be if two visits were ever in flight at once.
let nextEdgeBody = null;
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String((err && err.stack) || err));
  });
});
async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  let body = fs.readFileSync(file);
  // The body defaults to a placeholder ("EDGE RENDERED") good enough for
  // asserting the client did not inject a second copy on top of it; a caller
  // that needs the ACTUAL published markup on the page — a real calendar
  // mount, a real feed block — sets nextEdgeBody first.
  const edge = url.searchParams.get('edge');
  if (edge && file.endsWith('index.html')) {
    const inner = nextEdgeBody != null ? nextEdgeBody
      : '<div class="tlcb-page"><div class="tlcb tlcb--text">EDGE RENDERED</div></div>';
    nextEdgeBody = null;
    body = Buffer.from(await computeEdgedHtml(body.toString('utf8'), edge, inner));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
}
await new Promise((r) => server.listen(0, r));
const base = 'http://localhost:' + server.address().port;

// Same harness, but /api/pages answers with a real `rendered` entry and the
// document arrives with the edge injection already applied.
//
// `path` defaults to `/slug` — true for most pages, but not for a nested
// address like the Christmas Market vendor application, whose id
// ("marketvendors") and real address ("/christmasmarket/vendors") are two
// different strings on purpose (`NESTED_PATHS` in public/index.html). A
// harness that only ever visited `/slug` could never exercise that gap.
// `pagesRoute`, when given, replaces the default /api/pages fulfillment —
// used to simulate the admin being slow, unreachable, or erroring, which is
// exactly the case an edge-rendered page's own body must not depend on.
//
// `edgeBody`, when given, is what actually lands in the initial HTML at
// `?edge=` — the default placeholder text is enough to prove the client did
// not inject a second copy on top of it, but it carries no real block markup
// (no calendar mount, no feed block), so a test that needs the edge's OWN
// content to actually do something passes its real rendered HTML here.
async function visitEdged(slug, renderedHtml, { edged = true, path = null, pagesRoute = null, edgeBody = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  const hits = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Playwright runs matching routes in reverse registration order. Register
  // the catch-all first so the admin-specific handler below actually sees
  // /api/pages instead of having every HTTPS request swallowed as an empty
  // response. Reversing these two registrations makes the takeover tests fail
  // non-vacuously: `hits` stays empty and no managed body is injected.
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.route('https://admin.timothystl.org/**', (route) => {
    const u = route.request().url();
    hits.push(u);
    if (u.includes('/api/pages')) {
      if (pagesRoute) return pagesRoute(route);
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ pages: [{ id: slug, slug: '/' + slug }], menu: null,
          rendered: { [slug]: renderedHtml }, redirects: {}, css: BLOCK_CSS }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  if (edged && edgeBody != null) nextEdgeBody = edgeBody;
  await page.goto(base + (path || '/' + slug) + (edged ? '?edge=' + slug : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  return { page, ctx, errors, hits };
}

// ⚠ THE OLD /api/ministry/:slug + tlcApplyBlocks() INJECTION PATH HAD TWO
// TEST GROUPS HERE ("block-managed" and "legacy fallback (not yet
// converted)"), driving them through /music's own #music-content,
// #music-content-section, #music-vid-grid, #music-ministry-photo-wrap and
// .page-cta-bar — the markup tlcApplyBlocks()/loadMinistryPage() inject
// into and toggle. That markup is gone: every ministry-style page (music,
// stephen, foodpantry, bees, christmasmarket, the six youth pages) is now
// confirmed published in the newer `pages` table (see
// admin/BLOCK-EDITOR-ROLLOUT.md, Phase C), so tlcMaybeTakeOverSitePage()
// always wins before tlcMaybeTakeOver()/loadMinistryPage() are ever
// reached, and there is no page left on the site whose fallback still
// needs exercising through this path. The three groups below that tested
// the block *rendering engine itself* (not this now-unreachable injection
// path) are converted to visitEdged(..., { edged: false }) — the
// mechanism every currently-published page actually uses.
console.log('\npublic ministry page — every block type renders without error');
{
  // Hero first on purpose — that is the signal that puts the page in whole-page
  // mode, which is the harder layout to get right, so test every type in it.
  const all = ['hero', ...Object.keys(BLOCK_DEFS).filter((t) => t !== 'hero')].map((t) => newBlock(t));
  const html = renderPage(sanitizeBlocks(all), { slug: 'vbs', withCss: false });
  const { page, ctx, errors } = await visitEdged('vbs', html, { edged: false });
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  // ⚠ `chips` — the Coming-up strip — renders NOTHING when nothing is coming
  // up, and that is deliberate: it is a one-line aside between two real
  // sections, and a strip announcing its own emptiness is worse than the gap.
  // This block has no feed behind it here, so it is correctly absent.
  //
  // ⚠ `registration` joins it for the identical reason: with no event
  // chosen (newBlock('registration') carries a blank eventId, since it can
  // only ever be pointed at a real event from the inspector), there is
  // nothing to put a form to, and a form for no event is worse than a gap.
  //
  // ⚠ `countdown` is the third: `newBlock('countdown')` defaults to automatic
  // mode (a blank `newsId`), which counts down to the next upcoming News &
  // Events post — and this fixture hands renderPage() no news data at all,
  // so there is nothing to find. Same rule, same reason: a countdown with
  // nothing to count down to renders nothing rather than a dash forever.
  //
  // Named rather than subtracted from the count. `all.length - 3` would pass
  // just as well if a FOURTH type quietly stopped rendering, which is the
  // failure this assertion exists to catch.
  const drawn = await page.$$eval('#page-vbs .tlcb', (ns) => ns.map((n) =>
    (n.className.match(/tlcb--([a-z]+)/) || [])[1]).filter(Boolean));
  const absent = all.map((b) => b.type).filter((t) => !drawn.includes(t));
  eq(JSON.stringify(absent.slice().sort()), JSON.stringify(['chips', 'countdown', 'registration']),
    'every block type is on the page except the three that draw nothing when empty');
  // this list leads with a hero, so the page renders in whole-page mode and the
  // blocks live in the page itself rather than the old content region
  eq(await page.locator('#page-vbs .tlcb').count(), all.length - 3, 'and nothing else is missing');
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
  const html = renderPage(sanitizeBlocks(blocks), { slug: 'vbs', withCss: false });
  const { page, ctx, errors } = await visitEdged('vbs', html, { edged: false });
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
  const html = renderPage(sanitizeBlocks(blocks), { slug: 'vbs', withCss: false });
  const { page, ctx } = await visitEdged('vbs', html, { edged: false });
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
  // Catch-all first; Playwright gives the later, more-specific admin route
  // precedence when both patterns match.
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.route('https://admin.timothystl.org/**', (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
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

console.log('\na failed client body fetch is retried when the visitor comes back');
{
  // The first request models a brief admin/D1 failure after the edge did not
  // supply this page. The old promise cache kept that null forever, and the
  // false takeover result then short-circuited every later visit in the SPA.
  // Reverting either cache fix makes this fail: bodyHits stays at 1 and the
  // published body never appears.
  const bodyHtml = renderPage(sanitizeBlocks([newBlock('text', { body: '<p>RECOVERED BODY</p>' })]),
    { slug: 'news', withCss: false });
  let bodyHits = 0;
  const retry = await visitEdged('news', bodyHtml, {
    edged: false,
    pagesRoute: (route) => {
      const u = new URL(route.request().url());
      if (u.searchParams.get('id') === 'news') {
        bodyHits += 1;
        if (bodyHits === 1) return route.fulfill({ status: 503, body: 'temporarily unavailable' });
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ rendered: { news: bodyHtml } }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ pages: [], menu: null, details: null, redirects: {}, css: BLOCK_CSS }) });
    },
  });
  eq(bodyHits, 1, 'the initial body request really failed once');
  eq(await retry.page.locator('#news-blocks').count(), 0, 'the failed attempt did not inject a false body');
  await retry.page.evaluate(() => { window.showPage('home'); window.showPage('news'); });
  await retry.page.waitForTimeout(900);
  eq(bodyHits, 2, 'returning to the page retries its body request');
  eq(await retry.page.locator('#news-blocks').count(), 1, 'the recovered body is injected exactly once');
  ok((await retry.page.textContent('#page-news')).includes('RECOVERED BODY'), 'the recovered body is visible');
  await retry.ctx.close();
}

console.log('\nthe edge-rendered body is authoritative — it does not wait on /api/pages');
{
  // Phase A: tlcMaybeTakeOverSitePage() used to require /api/pages to
  // succeed and echo back a non-empty `rendered[id]` before it would even
  // acknowledge the edge already did its job — so a slow or failed admin
  // (needed only for the nav, footer and appearance chrome, none of which
  // this page's own body reads) meant a calendar block sitting in an
  // edge-rendered page never mounted at all, and a legacy loader was sent
  // chasing a page that was already correct.
  const calHtml = renderPage(sanitizeBlocks([newBlock('calendar')]), { slug: 'news', withCss: false });
  ok(/data-tlc-calendar/.test(calHtml), 'sanity: the fixture really carries a calendar mount');

  // ⚠ NEVER RESOLVES — the closest thing to the real symptom (D1 exhausted,
  // ~16s per admin query — see CLAUDE.md's "D1 hit its free-tier row-read
  // ceiling"): a request that is slow rather than one that fails outright.
  {
    const { page, ctx, errors, hits } = await visitEdged('news', calHtml, {
      pagesRoute: () => new Promise(() => {}),
      edgeBody: calHtml,
    });
    eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
    const drew = await page.evaluate(() => {
      const el = document.querySelector('[data-tlc-calendar]');
      return el ? el.innerHTML.length > 0 : null;
    });
    ok(drew, 'the calendar block mounts even while /api/pages is still hanging');
    ok(hits.some((u) => u.includes('/api/pages')), 'the fetch was still made — this is additive, not a skip');
    await ctx.close();
  }

  // A hard failure (the admin answering, but with an error) must not put a
  // legacy loader on top of the body the edge already delivered correctly.
  {
    const textHtml = renderPage(sanitizeBlocks([newBlock('text', { body: '<p>PUBLISHED BODY</p>' })]),
      { slug: 'news', withCss: false });
    const { page, ctx, errors } = await visitEdged('news', textHtml, {
      pagesRoute: (route) => route.fulfill({ status: 500, body: 'admin unavailable' }),
      edgeBody: textHtml,
    });
    eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
    eq(await page.locator('#news-blocks').count(), 1, 'still exactly one copy of the block host');
    ok((await page.textContent('#page-news')).includes('PUBLISHED BODY'), 'the edge content is unchanged');
    await ctx.close();
  }

  // The successful case: /api/pages is still the one door onto the nav,
  // footer and appearance chrome — and it is asked for exactly once, not
  // once for "is this page real" and again for "now build the chrome".
  {
    const bodyHtml = renderPage(sanitizeBlocks([newBlock('text', { body: '<p>PUBLISHED BODY</p>' })]),
      { slug: 'news', withCss: false });
    const nav = { header: [{ kind: 'external', href: 'https://example.org/give', label: 'Give Now', style: 'button' }] };
    const details = { settings: { address_line: '123 Test Ave', address_city: 'St. Louis', phone: '555-0100', email: 'office@example.org' }, services: [] };
    const { page, ctx, errors, hits } = await visitEdged('news', bodyHtml, {
      pagesRoute: (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ pages: [{ id: 'news', slug: '/news' }], menu: nav, details,
          rendered: { news: bodyHtml }, redirects: {}, css: BLOCK_CSS }) }),
      edgeBody: bodyHtml,
    });
    eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
    eq(hits.filter((u) => u.includes('/api/pages')).length, 1, '/api/pages is fetched exactly once');
    eq(await page.locator('#news-blocks').count(), 1, 'the block host still appears exactly once');
    // ⚠ Requirement (4): the global chrome this fetch is actually for must
    // still work — a page whose own body is authoritative is not a page
    // that stops updating its nav and footer.
    ok((await page.textContent('.nav-links')).includes('Give Now'), 'the admin-managed nav still renders');
    ok((await page.locator('.footer-brand-addr').innerHTML()).includes('123 Test Ave'),
      'and the footer address still renders from church details');
    await ctx.close();
  }
}

console.log('\nan edge-rendered page is authoritative at first paint');
{
  // Requirement (5). This asks the question at the earliest possible moment —
  // right after DOMContentLoaded, before any of this file's own JavaScript has
  // had a chance to run tlcMaybeTakeOverSitePage() at all — because a flash
  // this brief would never survive to a check made after waitForTimeout(900).
  // Any unconditional anchors beside the managed block host must be hidden in
  // the edge response itself, not by client JavaScript a moment later. Phase C
  // removed the old fallback bodies, so this deliberately no longer pretends
  // one still exists merely to make the assertion non-vacuous.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.route('https://admin.timothystl.org/**', (route) => new Promise(() => {})); // never answers
  await page.goto(base + '/news?edge=news', { waitUntil: 'domcontentloaded' });
  const state = await page.evaluate(() => {
    const pageEl = document.getElementById('page-news');
    const hardcoded = pageEl ? Array.from(pageEl.children).filter((c) => c.id !== 'news-blocks') : [];
    return {
      edgeMarked: !!(pageEl && pageEl.getAttribute('data-tlcb-edge')),
      noticesAnchorPresent: hardcoded.some((c) => c.id === 'notices-news'),
      nonBlockChildrenHidden: hardcoded.every((c) => getComputedStyle(c).display === 'none'),
      blockHostVisible: !!document.getElementById('news-blocks'),
    };
  });
  ok(state.edgeMarked, 'the edge marker is present at the very first paint');
  ok(state.noticesAnchorPresent, 'sanity: the unconditional notices anchor is still in the document');
  ok(state.nonBlockChildrenHidden, 'and every non-block child is already display:none before any client script has run');
  ok(state.blockHostVisible, 'the real block host is already present at the very first paint');
  await ctx.close();
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
