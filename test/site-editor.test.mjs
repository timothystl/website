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
    // A page already on the section-with-sidebar layout, and one filed beneath
    // it, so the aside and its section list can be checked without the test
    // having to drive the layout control first.
    { slug: 'grow', title: 'Grow', path: '/grow', template: 'sectionside', blocks: [newBlock('text', { body: '<p>GROW COPY</p>' })] },
    { slug: 'classes', title: 'Bible Classes', path: '/grow/classes', parent_id: 'grow', blocks: [newBlock('text', { body: '<p>Classes</p>' })] },
    // Mirrors the real Worker's NATIVE_FORM_ONLY_PAGE_IDS — a page whatever
    // is published for it never reaches the live site.
    { slug: 'contact', title: 'Contact', path: '/contact', neverLive: true, blocks: [newBlock('text', { body: '<p>CONTACT COPY</p>' })] },
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
  eq(await page.locator('.ed-page[data-page="secret"] .ed-page-tag').textContent(), 'hidden', 'a page out of the menu is labeled');
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
eq((await railTitles()).length, 7, 'clearing the search brings every page back');

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

group('the Page tab');
{
  await open('about');
  eq(await page.locator('.ed-tabs button').count(), 2, 'the inspector has a Block tab and a Page tab');
  await page.click('#edTabPage');
  await page.waitForTimeout(150);
  eq(await page.locator('#edPageTitle').inputValue(), 'About', 'the page name is filled in');
  eq(await page.locator('#edPageSlug').inputValue(), '/about', 'so is the address');
  eq(await page.locator('.ed-menu-opt[aria-pressed="true"]').textContent(), 'Top level of the menu', 'menu placement is shown');
  eq(await page.locator('#edPageInMenu').isChecked(), true, 'and whether it is in the menu');
  eq(await page.locator('#edPageTemplate').inputValue(), 'standard', 'the layout is shown');
  ok((await page.textContent('#edPageTemplateHint')).length > 10, 'with a plain-language description of it');
  // clicking a block brings the Block tab back on its own
  await page.click('.ed-paper .tlcb--hero');
  await page.waitForTimeout(150);
  eq(await page.locator('#edTabBlock').getAttribute('aria-selected'), 'true', 'clicking a block returns to the Block tab');
}

group('the search summary counts characters');
{
  await page.click('#edTabPage');
  await page.waitForTimeout(150);
  await page.fill('#edPageSeo', 'x'.repeat(150));
  await page.waitForTimeout(100);
  eq(await page.locator('#edSeoCount').textContent(), '150 / 160', 'the counter tracks what is typed');
  eq(await page.locator('#edSeoCount.is-over').count(), 0, 'and is not flagged under the limit');
  await page.fill('#edPageSeo', 'x'.repeat(170));
  await page.waitForTimeout(100);
  eq(await page.locator('#edSeoCount.is-over').count(), 1, 'going over the limit is flagged');
}

group('renaming a page moves its address and leaves a redirect');
{
  await open('about');
  await page.click('#edTabPage');
  await page.waitForTimeout(150);
  await page.fill('#edPageTitle', 'About Timothy');
  await page.waitForFunction(() => document.getElementById('edPageSlug').value === '/about-timothy', null, { timeout: 8000 });
  eq(await page.locator('#edPageSlug').inputValue(), '/about-timothy', 'the address follows the name');
  ok((await page.textContent('#edTitle')).includes('About Timothy'), 'the topbar follows too');
  eq(await page.getAttribute('#edView', 'href'), 'https://timothystl.org/about-timothy', 'and so does View live');
  ok((await railTitles()).includes('About Timothy'), 'the pages rail follows');
  // the child page moved with its parent
  await page.click('.ed-page[data-page="beliefs"]');
  await page.waitForFunction(() => location.pathname === '/pages/beliefs/edit', null, { timeout: 8000 });
  await page.waitForSelector('.ed-paper .tlcb', { timeout: 8000 });
  await page.click('#edTabPage');
  await page.waitForTimeout(200);
  eq(await page.locator('#edPageSlug').inputValue(), '/about-timothy/beliefs', 'a child page moved with its parent');
}

group('the homepage keeps its address');
{
  await open('home');
  await page.click('#edTabPage');
  await page.waitForTimeout(150);
  eq(await page.locator('#edPageSlug').isEditable(), false, 'the homepage address cannot be edited');
  await page.fill('#edPageTitle', 'Welcome');
  await page.waitForTimeout(1200);
  eq(await page.locator('#edPageSlug').inputValue(), '/', 'and renaming it does not move it');
}

group('changing the layout redraws the canvas');
{
  await open('home');
  await page.click('#edTabPage');
  await page.waitForTimeout(150);
  eq(await page.locator('.ed-paper .tlcb-page--home').count(), 1, 'starts on the Home layout');
  await page.selectOption('#edPageTemplate', 'sidebar');
  await page.waitForFunction(() => !!document.querySelector('.ed-paper .tlcb-page--sidebar'), null, { timeout: 8000 });
  eq(await page.locator('.ed-paper .tlcb-page--sidebar').count(), 1, 'switching layout redraws through the new one');
  eq(await page.locator('.ed-paper .tlcb').count(), 1, 'and does not drop the block');
  await page.selectOption('#edPageTemplate', 'home');
  await page.waitForFunction(() => !!document.querySelector('.ed-paper .tlcb-page--home'), null, { timeout: 8000 });
  eq(await page.locator('.ed-paper .tlcb').count(), 1, 'and switching back does not drop it either');
}

// ⚠ THE BUG THIS EXISTS FOR. Dinger: "the section with sidebar doesnt seem to
// display a sidebar." Switching layout redrew correctly (the group above), and
// so did a fresh load — both of those paths send the page's template. The
// stateless /render the editor uses for every STRUCTURAL change sent only the
// blocks and the slug, and renderPage() reads a missing template as "this is a
// ministry page" and returns a bare column. So the sidebar appeared, and then
// vanished at the first duplicated, deleted or reordered block and stayed gone
// until a reload — which is what made it read as the sidebar not displaying.
group('the layout survives a structural change');
{
  await open('grow');
  eq(await page.locator('.ed-paper .tlcb-page--sectionside').count(), 1, 'the page opens on its own layout');
  eq(await page.locator('.ed-paper .tlcb-side').count(), 1, 'so the sidebar is drawn');
  ok((await page.textContent('.ed-paper .tlcb-side-kids')).includes('Bible Classes'),
    'listing the page filed beneath this one');

  const before = await page.locator('.ed-paper .tlcb').count();
  await page.click('.ed-paper .tlcb--text');
  await page.click('.ed-paper .tlcb.is-sel [data-act="dup"]');
  await page.waitForFunction((n) => document.querySelectorAll('.ed-paper .tlcb').length === n + 1,
    before, { timeout: 8000 });
  eq(await page.locator('.ed-paper .tlcb-page--sectionside').count(), 1, 'duplicating a block keeps the layout');
  eq(await page.locator('.ed-paper .tlcb-side').count(), 1, 'and the sidebar with it');
  ok((await page.textContent('.ed-paper .tlcb-side-kids')).includes('Bible Classes'),
    'section list included — it is derived from the page tree, so only the server can supply it');

  await page.click('#edUndo');
  await page.waitForFunction((n) => document.querySelectorAll('.ed-paper .tlcb').length === n,
    before, { timeout: 8000 });
  eq(await page.locator('.ed-paper .tlcb-side').count(), 1, 'undo keeps it too');

  // ⚠ The other direction, which is what stops the fix becoming "always draw an
  // aside": a page on a layout without one must redraw without one.
  await open('about');
  const n = await page.locator('.ed-paper .tlcb').count();
  await page.click('.ed-paper .tlcb--text');
  await page.click('.ed-paper .tlcb.is-sel [data-act="dup"]');
  await page.waitForFunction((c) => document.querySelectorAll('.ed-paper .tlcb').length === c + 1,
    n, { timeout: 8000 });
  eq(await page.locator('.ed-paper .tlcb-side').count(), 0, 'a standard page grows no sidebar it never asked for');
  await page.click('#edUndo');
  await page.waitForFunction((c) => document.querySelectorAll('.ed-paper .tlcb').length === c,
    n, { timeout: 8000 });
}

group('a self-filling block says where its content comes from');
{
  await open('about');
  await page.click('.ed-pal-tab[data-group="Content"]');
  await page.click('.ed-chip:has-text("News highlights")');
  await page.waitForFunction(() => !!document.querySelector('.ed-paper .tlcb--news'), null, { timeout: 8000 });
  await page.waitForTimeout(200);
  eq(await page.locator('.ed-fills').count(), 1, 'the "Fills itself" panel is shown');
  ok((await page.textContent('.ed-fills')).includes('newest posts'), 'and says in plain words what fills it');
  const shown = () => page.locator('.ed-fills output').textContent();
  eq(await shown(), '3', 'how many to show starts at the block default');
  await page.click('.ed-fills [data-a="count"][data-v="1"]');
  await page.waitForTimeout(500);
  eq(await shown(), '4', 'the stepper goes up');
  for (let i = 0; i < 4; i++) { await page.click('.ed-fills [data-a="count"][data-v="1"]'); await page.waitForTimeout(350); }
  eq(await shown(), '6', 'and stops at six');
  for (let i = 0; i < 8; i++) { await page.click('.ed-fills [data-a="count"][data-v="-1"]'); await page.waitForTimeout(350); }
  eq(await shown(), '1', 'and at one going the other way');
  // no editable body inside an auto block
  eq(await page.locator('.ed-paper .tlcb--news [data-field="body"]').count(), 0, 'an auto block has no editable body text');
  await page.click('.ed-paper .tlcb--news [data-act="del"]');
  await page.waitForTimeout(500);
}

group('pasting brings text, not formatting');
{
  await open('about');
  await page.click('.ed-paper .tlcb--text [data-field="body"]');
  await page.waitForTimeout(120);
  await page.keyboard.press('Control+A');
  // a paste carrying its own fonts, sizes and colors, exactly as Word sends it
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Pasted words');
    dt.setData('text/html', '<span style="font-family:Comic Sans MS;font-size:44px;color:#f0f">Pasted words</span>');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(150);
  const html = await page.locator('.ed-paper .tlcb--text [data-field="body"]').innerHTML();
  ok(html.includes('Pasted words'), 'the words arrive');
  ok(!/Comic Sans|font-size|color:/.test(html), 'the formatting does not: ' + html.slice(0, 200));
}

group('the homepage renders through its own layout');
await open('home');
eq(await page.locator('.ed-paper .tlcb-page--home').count(), 1, 'the Home layout is used on the canvas');
eq(await page.getAttribute('#edView', 'href'), 'https://timothystl.org/', 'and View live points at the root');

group('a page whatever is published never reaches the live site says so');
{
  await open('contact');
  const banner = page.locator('#edNeverLive');
  eq(await banner.isVisible(), true, 'the warning shows on a page flagged neverLive');
  ok((await banner.textContent()).includes('never reaches the live site'), 'and says so in words, not just a color');
  eq(await page.getAttribute('#edNeverLiveViewLive', 'href'), 'https://timothystl.org/contact',
    'its link points at the real live page, so a person can check the two against each other');

  // Scoped, not a general break: an ordinary page's editor stays exactly as
  // it was — no banner, no space reserved for one.
  await open('about');
  eq(await page.locator('#edNeverLive').isVisible(), false, 'an ordinary page shows nothing');
}

eq(errors.length, 0, 'no page errors overall: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
