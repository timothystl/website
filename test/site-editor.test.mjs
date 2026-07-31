// Drives the SITE page editor — the same screen as the ministry editor, but
// addressed as /pages/:id/edit and talking to /pages/api. What is under test
// here is the part that differs: the far-left pages rail, moving between pages
// without losing an unsaved edit, and the fact that everything else still
// works when the editor is mounted somewhere new.
//
//   node test/site-editor.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createEditorServer } from './editor-server.mjs';
import { newBlock } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const harness = createEditorServer({
  pages: [
    { slug: 'home', title: 'Home', path: '/', template: 'home', blocks: [newBlock('hero', { title: 'Welcome' })] },
    { slug: 'about', title: 'About', path: '/about', blocks: [newBlock('hero', { title: 'About us' }), newBlock('text', { body: '<p>ABOUT COPY</p>' })] },
    { slug: 'beliefs', title: 'What We Believe', path: '/about/beliefs', parent_id: 'about', blocks: [newBlock('text', { body: '<p>Beliefs</p>' })] },
    { slug: 'secret', title: 'Thank You', path: '/thank-you', in_menu: 0, blocks: [newBlock('text', { body: '<p>Thanks</p>' })] },
  ],
});
await new Promise((r) => harness.server.listen(0, r));
const base = 'http://localhost:' + harness.server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// The container has no egress. Left to time out, the Google Fonts stylesheet in
// <head> blocks script execution on the *second* full page load, so the editor
// never boots and the failure looks like a bug in the editor. Answer it here.
await ctx.route((u) => !String(u).includes('localhost'), (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|net::ERR|Failed to load resource|fonts\.googleapis/.test(t)) return;
  errors.push('console: ' + t);
});

const open = async (id) => {
  await page.goto(base + '/pages/' + id + '/edit', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb, .ed-empty, .tlcb-empty', { timeout: 8000 });
  await page.waitForTimeout(150);
};
const railTitles = () => page.$$eval('.ed-page .ed-page-t', (els) => els.map((e) => e.textContent.trim()));

group('the editor loads at its own address');
await open('about');
eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
eq(await page.locator('.ed-pages').count(), 1, 'the pages rail is present');
ok((await page.textContent('#edTitle')).includes('About'), 'the topbar names the page');
eq(await page.locator('.ed-crumb a').textContent(), 'Pages', 'the breadcrumb goes back to Pages, not Ministries');
eq(await page.getAttribute('#edView', 'href'), 'https://timothystl.org/about',
  'View live uses the page address, not its id');
ok((await page.textContent('.ed-paper')).includes('ABOUT COPY'), 'the page renders on the canvas');

group('the pages rail');
{
  const titles = await railTitles();
  ok(titles.includes('Home') && titles.includes('About') && titles.includes('What We Believe'), 'every page is listed');
  eq(await page.locator('.ed-page.is-here .ed-page-t').textContent(), 'About', 'the page being edited is marked');
  eq(await page.locator('.ed-page[data-page="beliefs"].ed-page--child').count(), 1, 'a child page is indented');
  eq(await page.locator('.ed-page[data-page="secret"] .ed-page-tag').textContent(), 'hidden', 'a page out of the menu is labelled');
  eq(await page.locator('.ed-page[data-page="home"] .ed-page-tag').count(), 1, 'the homepage carries its own mark');
  eq(await page.locator('.ed-page-dot').count(), 0, 'nothing has unpublished changes yet');
}

group('searching the rail');
await page.fill('#edPagesSearch', 'believ');
await page.waitForTimeout(120);
{
  const titles = await railTitles();
  ok(titles.includes('What We Believe'), 'a matching page is shown');
  ok(titles.includes('About'), 'and its parent stays, so the child is not stranded');
  ok(!titles.includes('Home'), 'pages that do not match are hidden');
}
await page.fill('#edPagesSearch', 'zzz');
await page.waitForTimeout(120);
ok((await page.textContent('.ed-pages-list')).includes('No pages match'), 'an empty search says so');
await page.fill('#edPagesSearch', '');
await page.waitForTimeout(120);
eq((await railTitles()).length, 4, 'clearing the search brings every page back');

group('collapsing the rail');
await page.click('#edPagesToggle');
await page.waitForTimeout(150);
eq(await page.locator('.ed-pages--shut').count(), 1, 'the rail collapses');
eq(await page.locator('#edPagesList').isVisible(), false, 'and its list is hidden');
await page.click('#edPagesToggle');
await page.waitForTimeout(150);
eq(await page.locator('.ed-pages--shut').count(), 0, 'and reopens');

group('an unsaved edit survives switching pages');
{
  // type into the page but do not wait for the 1.5s autosave
  await page.click('.ed-paper .tlcb--text [data-field="body"]');
  await page.waitForTimeout(120);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('EDITED COPY');
  await page.click('.ed-paper .tlcb--hero');
  await page.waitForTimeout(150);
  ok((await page.textContent('#edPill')).startsWith('Draft'), 'the edit is registered before leaving');
  await page.click('.ed-page[data-page="home"]');
  await page.waitForFunction(() => location.pathname === '/pages/home/edit', null, { timeout: 8000 });
  await page.waitForSelector('.ed-paper .tlcb', { timeout: 8000 });
  ok((await page.textContent('#edTitle')).includes('Home'), 'the editor moves to the page that was clicked');
  await open('about');
  ok((await page.textContent('.ed-paper')).includes('EDITED COPY'),
    'the edit made just before switching was written out rather than lost');
  eq(await page.locator('.ed-page[data-page="about"] .ed-page-dot').count(), 1,
    'and the rail marks the page as having unpublished changes');
}

group('everything else still works under the new address');
{
  await open('about');
  const before = await page.locator('.ed-paper .tlcb').count();
  await page.click('.ed-pal-tab[data-group="Content"]');
  await page.click('.ed-chip:has-text("Rich text")');
  await page.waitForFunction((n) => document.querySelectorAll('.ed-paper .tlcb').length === n + 1, before, { timeout: 8000 });
  eq(await page.locator('.ed-paper .tlcb').count(), before + 1, 'a block can be added');
  await page.click('.ed-paper .tlcb.is-sel [data-act="del"]');
  await page.waitForFunction((n) => document.querySelectorAll('.ed-paper .tlcb').length === n, before, { timeout: 8000 });
  eq(await page.locator('.ed-paper .tlcb').count(), before, 'and deleted again');
  eq(await page.locator('#edUndo').isDisabled(), false, 'undo is offered');
}

group('the homepage renders through its own layout');
await open('home');
eq(await page.locator('.ed-paper .tlcb-page--home').count(), 1, 'the Home layout is used on the canvas');
eq(await page.getAttribute('#edView', 'href'), 'https://timothystl.org/', 'and View live points at the root');

eq(errors.length, 0, 'no page errors overall: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
