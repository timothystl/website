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
  const { page, ctx, errors } = await visit('/about', apiPages());
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
  await page.waitForTimeout(200);
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
group('the giving pages hand off rather than each carrying the link');
{
  const { page, ctx, errors } = await visit('/give', apiPages());
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  const href = await page.getAttribute('#page-give a.btn-primary', 'href');
  eq(href, 'https://give.timothystl.org', 'the Give Online button hands off to the giving page');
  eq(await page.locator('#page-give [data-give-link]').count(), 0,
    'and nothing on /give resolves the Tithe.ly link itself');
  ok(!(await page.innerHTML('#page-give')).includes('give.tithe.ly'),
    'the page holds no Tithe.ly address at all');
  // all six offline paths are still the reason to come here
  const body = await page.textContent('#page-give');
  for (const way of ['On Sunday morning', 'Bank bill pay', 'Thrivent Charitable',
                     'IRA charitable distribution', 'Donor Advised Fund', 'Planned giving']) {
    ok(body.includes(way), `/give still explains "${way}"`);
  }
  await ctx.close();
}
{
  // The CCS appeal is the exception: it asks for a specific fund, which cannot
  // be expressed as a link to give.timothystl.org, so it is resolved in the page.
  const { page, ctx } = await visit('/ccs', apiPages());
  await page.waitForTimeout(600);
  const ccs = await page.$$eval('#page-ccs [data-give-link]', (els) => els.map((e) => e.getAttribute('href')));
  eq(ccs.length, 2, 'both CCS buttons are wired');
  for (const h of ccs) {
    ok(h.includes('NEW-FORM-ID'), 'CCS follows the managed link: ' + h);
    ok(!h.includes('e1769a0f'), 'and not the copy baked into the page');
    ok(h.includes('fundId=49cdc381-ff0e-4b7e-b029-091f206850c1'), 'and keeps its own fund');
    eq((h.match(/fundId=/g) || []).length, 1, 'with one fundId, not two');
    ok(h.includes('frequency=one-time'), 'and its one-time frequency');
  }
  await ctx.close();
}
{
  // If the admin cannot be reached the CCS buttons must still give someone a
  // way to give — the href in the markup is the fallback.
  GIVE_URL = null;
  const { page, ctx } = await visit('/ccs', apiPages());
  await page.waitForTimeout(600);
  const href = await page.getAttribute('#page-ccs [data-give-link]', 'href');
  ok(/^https:\/\/give\.tithe\.ly\//.test(href), 'the button still points somewhere real: ' + href);
  await ctx.close();
  GIVE_URL = 'https://give.tithe.ly/?formId=NEW-FORM-ID&locationId=LOC';
}

group('the site still works when the admin is unreachable');
{
  const { page, ctx, errors } = await visit('/about', null);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  ok((await navLabels(page)).length >= 9, 'the hardcoded nav is left in place');
  ok((await page.textContent('#page-about')).includes('Timothy Lutheran'), 'the hardcoded page still renders');
  eq(await page.locator('.tlcb').count(), 0, 'and no block markup appears');
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
  // a page with nothing published is untouched
  await page.click('.nav-links button:has-text("About")');
  await page.waitForTimeout(400);
  eq(await page.locator('#page-about .tlcb').count(), 0, 'an unpublished page keeps its hardcoded markup');
  ok((await page.textContent('#page-about')).length > 200, 'and still has its content');
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
  const api = apiPages({ redirects: { '/oldname': '/worship' } });
  const { page, ctx, errors } = await visit('/oldname', api);
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.locator('#page-worship').isVisible(), true, 'the old address lands on the renamed page');
  eq(await page.locator('#page-404').isVisible(), false, 'and not on the 404');
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

group('a newsletter reads in place, without leaving the page');
{
  // ⚠ THE PLAIN <a href="/news/:id"> A PUBLISHED PAGE RENDERS USED TO BE A
  // REAL NAVIGATION. The legacy hardcoded /news page's own "Read this
  // letter" button has always called loadNewsletterDetail(id) directly and
  // swallowed the click; the newsletterarchive BLOCK never did, so reading a
  // letter from a published page reloaded the whole document — which reads
  // as a window popping open rather than the page quietly changing.
  //
  // ⚠ loadNewsletterDetail ITSELF NOW BUILDS A BODY-APPENDED OVERLAY
  // (#tlc-nl-overlay), NOT THE OLD IN-PAGE #newsletter-detail SECTION — a
  // separate, independent fix (see its own comment in public/index.html) for
  // the exact bug this group is also about: tlcTakeOverPage()'s "hide every
  // child of #page-news" loop swallowed that old section whole. This group
  // only has to prove the BLOCK now calls loadNewsletterDetail at all, which
  // a plain <a href> never did — the overlay's own correctness is that
  // function's problem, not this block's.
  const rendered = { news: renderPage([newBlock('newsletterarchive')], {
    slug: 'news', template: 'standard', children: [], withCss: false,
    data: { newsletters: [{ id: 42, subject: 'This week at Timothy', published_at: '2026-08-20', pastor_note: 'A short preview.' }] },
  }) };
  const api = {
    pages: [{ id: 'news', title: 'News', label: 'News', slug: 'news', parent: null, in_menu: true, template: 'standard', seo_description: '' }],
    rendered, css: BLOCK_CSS, redirects: {}, details: DETAILS,
  };
  const detailPayload = {
    id: 42, subject: 'This week at Timothy', published_at: '2026-08-20',
    pastor_note: '<p>The full letter, in place.</p>', events: [], news_items: [], bible_classes: [],
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
  // real navigation — exactly the difference this fix is about.
  await page.evaluate(() => { window.__stayedInPlace = true; });
  await page.click('.tlcb-nl-link');
  // ⚠ A fixed sleep here is exactly the kind of flake this suite otherwise
  // avoids — loadNewsletterDetail awaits a real fetch, and how long that
  // takes depends on the machine, not the fix. Wait for the actual content
  // to land instead of guessing how long that takes.
  await page.locator('#tlc-nl-overlay-content:has-text("The full letter, in place.")').waitFor({ timeout: 5000 });

  eq(await page.evaluate(() => window.__stayedInPlace === true), true, 'the click never reloaded the document');
  eq(await page.locator('#tlc-nl-overlay').isVisible(), true, 'the detail overlay opens in place');
  ok((await page.locator('#tlc-nl-overlay-content').innerText()).includes('The full letter, in place.'),
    'and shows the real, full letter fetched for it — not the truncated block preview');
  eq(new URL(page.url()).pathname, '/news/42', 'the address updates to the letter, for a bookmark or a refresh');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
