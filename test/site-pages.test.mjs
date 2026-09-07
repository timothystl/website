// End-to-end check that the public site takes its navigation and its page
// content from the admin's `pages` table — and, just as importantly, that it
// keeps working exactly as before when a page has nothing published.
//
//   node test/site-pages.test.mjs
//
// Serves ./public locally and stubs /api/pages with the shape the Worker
// returns, rendered through the real admin/blocks.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { renderPage, newBlock, sanitizeBlocks, BLOCK_CSS } from '../admin/blocks.js';
import { SITE_PAGES } from '../admin/site-pages.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
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

// The Worker's /api/pages response, built the way the Worker builds it.
const DETAILS = {
  settings: { address_line: '6704 Fyler Ave', address_city: 'St. Louis, MO 63139', phone: '(314) 781-8673', email: 'office@timothystl.org' },
  services: [{ day: 'Sunday', time: '8:00 am', note: 'Traditional' }, { day: 'Sunday', time: '10:45 am', note: 'Contemporary' }],
};

function apiPages({ publish = {}, redirects = {}, pages = SITE_PAGES, details = DETAILS } = {}) {
  const rendered = {};
  for (const [id, blocks] of Object.entries(publish)) {
    const p = pages.find((x) => x.id === id) || {};
    const children = pages.filter((c) => c.parent_id === id)
      .map((c) => ({ id: c.id, title: c.title, label: c.menu_label || c.title, slug: c.slug, seo_description: c.seo_description }));
    rendered[id] = renderPage(sanitizeBlocks(blocks), { slug: id, template: p.template, children, withCss: false });
  }
  return {
    pages: pages.map((p) => ({
      id: p.id, title: p.title, label: p.menu_label || p.title, slug: p.slug,
      parent: p.parent_id || null, in_menu: !!p.in_menu, template: p.template, seo_description: p.seo_description || '',
    })),
    rendered,
    css: Object.keys(rendered).length ? BLOCK_CSS : '',
    redirects,
    details,
  };
}

// The one base Tithe.ly link the office manages, served the way the admin does.
let GIVE_URL = 'https://give.tithe.ly/?formId=NEW-FORM-ID&locationId=LOC';

async function visit(urlPath, api) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://admin.timothystl.org/**', (route) => {
    const u = route.request().url();
    if (u.includes('/api/pages')) {
      if (api === null) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'down' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(api) });
    }
    if (u.includes('/api/redirects')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"redirects":[]}' });
    if (u.includes('/api/settings/give_url')) {
      if (GIVE_URL === null) return route.fulfill({ status: 500, contentType: 'text/plain', body: 'down' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ value: GIVE_URL }) });
    }
    if (u.endsWith('/posts')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    if (u.includes('/api/ministry/')) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'nope' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto(base + urlPath, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  return { page, ctx, errors };
}

const navLabels = (page) => page.$$eval('.nav-links button', (els) => els.map((e) => e.textContent.trim()));
const mobileLabels = (page) => page.$$eval('#navMobile button', (els) => els.map((e) => e.textContent.trim()));

group('the menu is generated from the pages table');
{
  // ⚠ Worship is published in the mock here — as it genuinely is in
  // production (see admin/BLOCK-EDITOR-ROLLOUT.md, Phase C) — because
  // its old hardcoded body is gone and an unpublished #page-worship now
  // collapses to zero height (nothing but a hidden notices anchor), which
  // Playwright reads as "not visible" whatever `.active` says. That is not
  // this group's concern — it is the "published vs unpublished" mechanism,
  // covered below — so this click needs real content to land on.
  const api = apiPages({ publish: { worship: [newBlock('hero', { title: 'Worship at Timothy' })] } });
  const { page, ctx, errors } = await visit('/about', api);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  const expected = SITE_PAGES.filter((p) => p.in_menu && !p.parent_id).map((p) => p.menu_label || p.title);
  eq(JSON.stringify(await navLabels(page)), JSON.stringify(expected), 'the desktop nav is exactly the top-level menu pages, in order');
  ok((await navLabels(page)).includes('Learn'), 'a page shows its menu label, not its full title');
  ok(!(await navLabels(page)).includes('Music Ministry'), 'a page kept out of the menu stays out');
  // children only appear in the mobile menu, indented
  const mob = await mobileLabels(page);
  ok(mob.includes('Prayer Request'), 'a child page in the menu appears in the mobile menu');
  ok(await page.locator('#navMobile a[href="https://mdo.timothystl.org"]').count() > 0, 'external mobile links are not pages and survive the rebuild');
  // the nav still works
  await page.click('.nav-links button:has-text("Worship")');
  await page.waitForSelector('#page-worship .tlcb--hero', { timeout: 5000 });
  eq(await page.locator('#page-worship').isVisible(), true, 'a generated nav button navigates');
  eq(new URL(page.url()).pathname, '/worship', 'and pushes the right address');
  await ctx.close();
}

group('the footer reads the church details record');
{
  const { page, ctx, errors } = await visit('/about', apiPages());
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  const foot = await page.locator('.footer-brand-addr').innerHTML();
  ok(foot.includes('6704 Fyler Ave'), 'the address comes from the record');
  ok(foot.includes('(314) 781-8673') && foot.includes('office@timothystl.org'), 'so do the phone and email');
  ok(foot.includes('8:00 am') && foot.includes('10:45 am'), 'and every service time');
  ok(!foot.includes('&lt;br&gt;'), 'the line breaks are line breaks, not escaped text');
  await ctx.close();
}
{
  // a changed record reaches the footer without touching the page
  const { page, ctx } = await visit('/about', apiPages({ details: {
    settings: { address_line: '1 New Street', address_city: 'St. Louis, MO', phone: '314-000-0000', email: 'hello@timothystl.org' },
    services: [{ day: 'Sunday', time: '9:00 am' }],
  } }));
  const foot = await page.locator('.footer-brand-addr').innerHTML();
  ok(foot.includes('1 New Street') && foot.includes('9:00 am'), 'changing the record changes the footer');
  ok(!foot.includes('6704 Fyler'), 'and the old details are gone');
  await ctx.close();
}
{
  // and the markup that shipped with the page is the fallback
  const { page, ctx } = await visit('/about', apiPages({ details: null }));
  ok((await page.locator('.footer-brand-addr').innerHTML()).includes('6704 Fyler Ave'),
    'with no record the footer keeps what shipped with the page');
  await ctx.close();
}

// The two giving pages have separate jobs. /give is where somebody decides HOW
// to give — the plate, bank bill pay, a QCD, a bequest — and its online button
// simply hands off. give.timothystl.org is the transaction, and it resolves the
// office's link server-side, so /give never holds a second copy of it.
//
// ⚠ Both /give and /ccs are confirmed published in production now (see
// admin/BLOCK-EDITOR-ROLLOUT.md, Phase C), so their old hardcoded fallback
// markup — including the CCS-specific [data-give-link]/data-give-fund
// mechanism loadGiveLinks()/giveLinkFor() resolved — is gone. That mechanism
// was never ported to a block type (there is no way to put a custom
// data-give-* attribute on any block's button, and sanitizeRich() would
// strip one pasted into rich text), so it was already unreachable by any
// currently-published page before this pass touched anything: CCS's own
// real published content (checked directly against the live database) is a
// plain Button bar linking to give.timothystl.org, exactly like /give's —
// a visitor picks "Concordia Children's Orphanage" from the fund dropdown
// there instead of landing on a pre-selected fund. loadGiveLinks() and
// giveLinkFor() are left in public/index.html regardless — dead code
// removal is Phase D, not this pass — but there is no page left whose
// [data-give-link] markup this test can drive, so both pages are tested
// through their real, current shape: a plain hand-off button and no baked
// Tithe.ly address, with the "which fund a visitor lands on" question left
// to the actual give.timothystl.org page's own tests (see
// test/give-page.test.mjs).
group('the giving pages hand off rather than each carrying the link');
{
  const giveBlocks = [
    newBlock('hero', { title: 'Give to Timothy Lutheran' }),
    newBlock('buttons', { items: [{ title: 'Give Online', url: 'https://give.timothystl.org' }] }),
  ];
  const { page, ctx, errors } = await visit('/give', apiPages({ publish: { give: giveBlocks } }));
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  const href = await page.getAttribute('#page-give .tlcb-btn', 'href');
  eq(href, 'https://give.timothystl.org', 'the Give Online button hands off to the giving page');
  eq(await page.locator('#page-give [data-give-link]').count(), 0,
    'and nothing on /give resolves the Tithe.ly link itself');
  ok(!(await page.innerHTML('#page-give')).includes('give.tithe.ly'),
    'the page holds no Tithe.ly address at all');
  await ctx.close();
}
{
  // CCS's real published content is the same shape as /give's — a plain
  // hand-off button, no fund-specific resolution baked into the page.
  const ccsBlocks = [
    newBlock('hero', { title: "Concordia Children's Services" }),
    newBlock('buttons', { items: [{ title: 'Give to CCS', url: 'https://give.timothystl.org' }] }),
  ];
  const { page, ctx } = await visit('/ccs', apiPages({ publish: { ccs: ccsBlocks } }));
  await page.waitForTimeout(600);
  eq(await page.locator('#page-ccs [data-give-link]').count(), 0,
    'CCS holds no fund-specific Tithe.ly resolution of its own any more');
  ok(!(await page.innerHTML('#page-ccs')).includes('give.tithe.ly'),
    'and no baked-in Tithe.ly address either');
  const href = await page.getAttribute('#page-ccs .tlcb-btn', 'href');
  eq(href, 'https://give.timothystl.org', 'CCS hands off to the giving page, same as /give');
  await ctx.close();
}

group('the site still works when the admin is unreachable');
{
  // ⚠ Phase C (admin/BLOCK-EDITOR-ROLLOUT.md) deleted the hardcoded body
  // /about used to fall back to during an outage — a deliberate, discussed
  // tradeoff (the plan's own "delete it all now" call), not a bug this test
  // should paper over. What survives an outage now is the site's CHROME —
  // the nav and footer, both driven from the hardcoded fallback markup that
  // is still in the document for THEM — not this page's own content.
  const { page, ctx, errors } = await visit('/about', null);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  ok((await navLabels(page)).length >= 9, 'the hardcoded nav is left in place');
  eq((await page.textContent('#page-about')).trim(), '', 'the page body is blank without its old hardcoded fallback (the accepted Phase C tradeoff)');
  eq(await page.locator('.tlcb').count(), 0, 'and no block markup appears either');
  await ctx.close();
}

group('a published page takes over; an unpublished one does not');
{
  const api = apiPages({ publish: {
    worship: [newBlock('hero', { title: 'Worship at Timothy' }), newBlock('text', { body: '<p>PUBLISHED WORSHIP COPY</p>' })],
  } });
  const { page, ctx, errors } = await visit('/worship', api);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  ok((await page.textContent('#page-worship')).includes('PUBLISHED WORSHIP COPY'), 'the published blocks render');
  eq(await page.locator('#page-worship .tlcb--hero').count(), 1, 'the banner is a block');
  eq(await page.locator('style#tlcb-css').count(), 1, 'the block stylesheet ships once');
  // every hardcoded section on that page is stood down
  const visibleLegacy = await page.$$eval('#page-worship > *', (els) =>
    els.filter((e) => !e.id.endsWith('-blocks') && e.style.display !== 'none').length);
  eq(visibleLegacy, 0, 'the hardcoded sections are all stood down');
  // a page with nothing published is untouched — no takeover happens, so no
  // blocks appear. ⚠ Since Phase C there is no longer meaningful hardcoded
  // content left to check for either (see the "admin unreachable" group
  // above for the same tradeoff) — the mechanism this asserts is "an
  // unpublished page never gets blocks," not "an unpublished page still
  // looks like something."
  await page.click('.nav-links button:has-text("About")');
  await page.waitForTimeout(400);
  eq(await page.locator('#page-about .tlcb').count(), 0, 'an unpublished page never takes on blocks');
  await ctx.close();
}

group('layouts decide their own width');
{
  const api = apiPages({ publish: {
    contact: [newBlock('text', { body: '<p>Sidebar page</p>' })],
  }, pages: SITE_PAGES.map((p) => p.id === 'contact' ? Object.assign({}, p, { template: 'sidebar' }) : p) });
  const { page, ctx, errors } = await visit('/contact', api);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.locator('#page-contact .tlcb-page--sidebar').count(), 1, 'the sidebar layout is used');
  eq(await page.locator('#page-contact .tlcb-page--full').count(), 0, 'and is not forced to full width by the takeover');
  eq(await page.locator('#page-contact .tlcb-layout-main').count(), 1, 'the blocks are in the main column');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, 'no horizontal overflow (got ' + overflow + ')');
  await ctx.close();
}

group('a section landing lists its child pages');
{
  const api = apiPages({ publish: { ministries: [newBlock('hero', { title: 'Ministries' })] } });
  const { page, ctx } = await visit('/ministries', api);
  eq(await page.locator('#page-ministries .tlcb-kids').count(), 1, 'the child list is rendered');
  ok(await page.locator('#page-ministries .tlcb-kid:has-text("Music Ministry")').count() > 0, 'a child page is listed');
  await page.click('#page-ministries .tlcb-kid:has-text("Music Ministry")');
  await page.waitForTimeout(300);
  eq(new URL(page.url()).pathname, '/music', 'and its link goes to that page');
  await ctx.close();
}

group('a renamed page redirects instead of 404ing');
{
  // Worship is published here for the same reason as the nav-generation
  // group above — its hardcoded fallback is gone, so it needs real content
  // to have any height for isVisible() to read true.
  const api = apiPages({
    redirects: { '/oldname': '/worship' },
    publish: { worship: [newBlock('hero', { title: 'Worship at Timothy' })] },
  });
  const { page, ctx, errors } = await visit('/oldname', api);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await page.waitForSelector('#page-worship .tlcb--hero', { timeout: 5000 });
  eq(await page.locator('#page-worship').isVisible(), true, 'the old address lands on the renamed page');
  eq(await page.locator('#page-404').isVisible(), false, 'and not on the 404');
  await ctx.close();
}

group('an address that really is unknown still 404s');
{
  const { page, ctx } = await visit('/no-such-page', apiPages());
  eq(await page.locator('#page-404').isVisible(), true, 'unknown addresses show the 404 page');
  eq(new URL(page.url()).pathname, '/no-such-page', 'and keep the address the visitor typed');
  await ctx.close();
}

group('the homepage is converted like any other page');
{
  const api = apiPages({ publish: { home: [newBlock('hero', { title: 'PUBLISHED HOME' })] } });
  const { page, ctx, errors } = await visit('/', api);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  ok((await page.textContent('#page-home')).includes('PUBLISHED HOME'), 'the homepage takes over even though showPage never runs for it');
  eq(await page.locator('#page-home .tlcb-page--home').count(), 1, 'and uses the Home layout');
  await ctx.close();
}

group('a newsletter reads in place, without leaving the page — and never in an overlay');
{
  // ⚠ THE PLAIN <a href="/news/:id"> A PUBLISHED PAGE RENDERS USED TO BE A
  // REAL NAVIGATION. The legacy hardcoded /news page's own "Read this
  // letter" button has always called loadNewsletterDetail(id) directly and
  // swallowed the click; the newsletterarchive BLOCK never did, so reading a
  // letter from a published page reloaded the whole document.
  //
  // ⚠ AND ONCE THAT WAS FIXED BY CALLING loadNewsletterDetail(), IT WAS
  // WRONG A SECOND WAY: that function builds a body-appended overlay
  // (#tlc-nl-overlay) — a real modal — and it was reported directly against
  // this exact screen: "it still does a pop up window... i dont want the
  // overlay." This block does not call loadNewsletterDetail() at all now;
  // NEWSLETTER_ARCHIVE_SCRIPT (admin/blocks.js) expands the letter inline,
  // inside the card that was clicked. This group asserts the overlay never
  // appears at all, not merely that the click stayed on the page.
  const rendered = { news: renderPage([newBlock('newsletterarchive')], {
    slug: 'news', template: 'standard', children: [], withCss: false,
    data: { newsletters: [
      { id: 42, subject: 'This week at Timothy', published_at: '2026-08-20', pastor_note: 'A short preview.' },
    ] },
  }) };
  const api = {
    pages: [{ id: 'news', title: 'News', label: 'News', slug: 'news', parent: null, in_menu: true, template: 'standard', seo_description: '' }],
    rendered, css: BLOCK_CSS, redirects: {}, details: DETAILS,
  };
  const detailPayload = {
    id: 42, subject: 'This week at Timothy', published_at: '2026-08-20',
    // ⚠ AN ENTITY IN THE STORED BODY, deliberately — the reported "junk
    // characters coming through" (you&rsquo;ve) was pastor_note's own
    // named entities surviving the block's tag-strip and then being
    // escaped a second time. The full letter is HTML and goes in as HTML
    // (unescaped, same as loadNewsletterDetail always did); nothing about
    // that path double-escapes.
    pastor_note: '<p>The full letter, in place. You&rsquo;ve read it.</p>',
    events: [], news_items: [], bible_classes: [],
  };

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://admin.timothystl.org/**', (route) => {
    const u = route.request().url();
    if (u.includes('/api/pages')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(api) });
    if (u.includes('/api/redirects')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"redirects":[]}' });
    if (u.includes('/api/newsletter/42')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailPayload) });
    if (u.endsWith('/posts')) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await page.goto(base + '/news', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

  // A marker on `window` survives an in-place transition and is wiped by a
  // real navigation — the same check that pins the click never reloads.
  await page.evaluate(() => { window.__stayedInPlace = true; });
  eq(await page.locator('#tlc-nl-overlay').count(), 0, 'no overlay exists in the document before the click');
  await page.click('.tlcb-nl-link');
  // ⚠ A fixed sleep here is exactly the kind of flake this suite otherwise
  // avoids — the script awaits a real fetch, and how long that takes
  // depends on the machine, not the fix. Wait for the actual content to
  // land instead of guessing how long that takes.
  await page.locator('.tlcb-nl-full:has-text("The full letter, in place.")').waitFor({ timeout: 5000 });

  eq(await page.evaluate(() => window.__stayedInPlace === true), true, 'the click never reloaded the document');
  eq(await page.locator('#tlc-nl-overlay').count(), 0, 'and it never opened the shared overlay either');
  const panelText = await page.locator('.tlcb-nl-full').innerText();
  ok(panelText.includes('The full letter, in place.'),
    'the panel shows the real, full letter fetched for it — not the truncated block preview');
  ok(panelText.includes('You’ve read it.') || panelText.includes("You've read it."),
    'a named entity in the letter decodes to a real apostrophe, not literal "&rsquo;" text');
  ok(!panelText.includes('&rsquo;') && !panelText.includes('&amp;'), 'and nothing is left double-escaped');
  eq(new URL(page.url()).pathname, '/news', 'the address stays put — this is an in-page panel, not a navigated view');

  // Clicking again closes the very panel it opened.
  await page.click('.tlcb-nl-link');
  await page.waitForTimeout(150);
  eq(await page.locator('.tlcb-nl-full').isVisible(), false, 'a second click on the same letter closes it');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
