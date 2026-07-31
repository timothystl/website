// Phase 4 — reordering by drag, by keyboard and by the toolbar's up/down, plus
// adding blocks from the palette.   node test/editor-dnd.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createEditorServer } from './editor-server.mjs';
import { newBlock, sanitizeBlocks, GROUPS } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);
// Which palette tab holds a given block type — read from the definition so
// renaming or regrouping a block does not silently break the drag tests.
const groupOf = (type) => (GROUPS.find((g) => g.types.includes(type)) || {}).name;

const seed = sanitizeBlocks([newBlock('hero'), newBlock('text'), newBlock('video'), newBlock('faq')]);
const harness = createEditorServer({ pages: [{ slug: 'music', title: 'Music Ministry', blocks: seed }] });
await new Promise((r) => harness.server.listen(0, r));
const base = 'http://localhost:' + harness.server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()); });
await page.route('https://**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

const reload = async () => {
  await page.goto(base + '/ministries/editor/music', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb');
  await page.click('#edHintX').catch(() => {});
};
// Each group starts from the same four blocks. The draft lives on the server, so
// reloading the browser alone would inherit whatever the previous group left.
const resetPage = async () => {
  // Let any autosave the previous group left in flight land first, or it will
  // overwrite the seed we are about to write.
  await page.waitForTimeout(1900).catch(() => {});
  await fetch(base + '/ministries/api/page/music/draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks: seed, changes: [] }),
  });
  await reload();
};
const order = () => page.$$eval('.ed-paper .tlcb', (ns) => ns.map((n) => n.dataset.type));
// Structural changes round-trip to the server for a re-render, so poll for the
// expected order rather than guessing at a sleep.
const waitOrder = async (expected, ms = 5000) => {
  const want = JSON.stringify(expected);
  const until = Date.now() + ms;
  for (;;) {
    if (JSON.stringify(await order()) === want) return want;
    if (Date.now() > until) return JSON.stringify(await order());
    await page.waitForTimeout(50);
  }
};
const railOrder = () => page.$$eval('.ed-row .ed-row-label', (ns) => ns.map((n) => n.textContent.trim().split(' ·')[0]));
const settle = (ms = 500) => page.waitForTimeout(ms);

// Playwright has no native HTML5 drag; drive the same events the browser fires.
async function dragRailRow(fromIndex, toIndex, where = 'top') {
  const src = page.locator('.ed-row').nth(fromIndex);
  const dst = page.locator('.ed-row').nth(toIndex);
  await src.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
  const box = await dst.boundingBox();
  await dst.dispatchEvent('dragover', { clientY: where === 'top' ? box.y + 3 : box.y + box.height - 3, clientX: box.x + 5 });
  await dst.dispatchEvent('drop');
  await src.dispatchEvent('dragend').catch(() => {});
  await settle();
}

await resetPage();

group('starting order');
eq(await waitOrder(['hero', 'text', 'video', 'faq']), JSON.stringify(['hero', 'text', 'video', 'faq']), 'canvas order matches the seed');
eq(JSON.stringify(await railOrder()), JSON.stringify(['Hero banner', 'Rich text', 'Video', 'FAQ']), 'rail order matches');

group('drag a row down');
await dragRailRow(1, 3, 'bottom'); // Rich text → after FAQ (last)
eq(await waitOrder(['hero', 'video', 'faq', 'text']), JSON.stringify(['hero', 'video', 'faq', 'text']), 'moving down lands in the right slot (no off-by-one)');
ok((await page.textContent('#edChanges')).includes('Reordered rich text'), 'reorder is logged');

group('drag a row up to first');
await dragRailRow(3, 0, 'top'); // Rich text back to the top
eq(await waitOrder(['text', 'hero', 'video', 'faq']), JSON.stringify(['text', 'hero', 'video', 'faq']), 'moving up to first position works');

group('drop onto itself is a no-op');
const before = JSON.stringify(await order());
const changesBefore = await page.locator('#edChanges li').count();
await dragRailRow(2, 2, 'top');
await settle(600);
eq(JSON.stringify(await order()), before, 'dropping a block on itself changes nothing');
eq(await page.locator('#edChanges li').count(), changesBefore, 'and logs nothing');

group('drop indicator');
{
  const src = page.locator('.ed-row').nth(0);
  const dst = page.locator('.ed-row').nth(2);
  await src.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
  const box = await dst.boundingBox();
  await dst.dispatchEvent('dragover', { clientY: box.y + 3, clientX: box.x + 5 });
  await page.waitForTimeout(80);
  eq(await page.locator('.ed-drop').count(), 1, 'a gold bar marks the drop point in the rail');
  eq(await page.locator('.ed-canvas-drop').count(), 1, 'and a gold line marks it on the page');
  ok((await page.textContent('.ed-canvas-drop')).toLowerCase().includes('move here'), 'canvas line is labelled "move here"');
  await src.dispatchEvent('dragend');
  await page.waitForTimeout(80);
  eq(await page.locator('.ed-drop, .ed-canvas-drop').count(), 0, 'indicators disappear when the drag ends');
}

group('keyboard reordering');
await resetPage();
await page.locator('.ed-row').nth(0).focus();
await page.keyboard.press('Alt+ArrowDown');
await settle();
eq(await waitOrder(['text', 'hero', 'video', 'faq']), JSON.stringify(['text', 'hero', 'video', 'faq']), 'Alt+ArrowDown moves a block down');
ok((await page.textContent('#live')).includes('position 2 of 4'), 'the move is announced to screen readers');
eq(await page.evaluate(() => document.activeElement.dataset.id), await page.$eval('.ed-row:nth-child(2)', (n) => n.dataset.id), 'focus follows the moved row');
await page.keyboard.press('Alt+ArrowUp');
await settle();
eq(await waitOrder(['hero', 'text', 'video', 'faq']), JSON.stringify(['hero', 'text', 'video', 'faq']), 'Alt+ArrowUp moves it back');
await page.locator('.ed-row').nth(0).focus();
await page.keyboard.press('Alt+ArrowUp');
await settle();
eq(await waitOrder(['hero', 'text', 'video', 'faq']), JSON.stringify(['hero', 'text', 'video', 'faq']), 'moving the first block up does nothing');
await page.locator('.ed-row').nth(3).focus();
await page.keyboard.press('Alt+ArrowDown');
await settle();
eq(await waitOrder(['hero', 'text', 'video', 'faq']), JSON.stringify(['hero', 'text', 'video', 'faq']), 'moving the last block down does nothing');

group('arrow keys walk the rail');
await page.locator('.ed-row').nth(0).focus();
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(120);
eq(await page.evaluate(() => Number(document.activeElement.dataset.index)), 1, 'ArrowDown moves focus to the next row');
ok((await page.textContent('#edInspHead')).includes('Rich text'), 'and selects it');

group('toolbar up/down — the tablet path');
await resetPage();
await page.click('.ed-paper .tlcb--video');
await page.click('.ed-paper .tlcb.is-sel [data-act="up"]');
await settle();
eq(await waitOrder(['hero', 'video', 'text', 'faq']), JSON.stringify(['hero', 'video', 'text', 'faq']), 'toolbar ↑ moves the block up');
await page.click('.ed-paper .tlcb--video');
await page.click('.ed-paper .tlcb.is-sel [data-act="down"]');
await settle();
eq(await waitOrder(['hero', 'text', 'video', 'faq']), JSON.stringify(['hero', 'text', 'video', 'faq']), 'toolbar ↓ moves it back');

group('add by clicking a palette chip');
await resetPage();
await page.click('.ed-pal-tab[data-group="' + groupOf('times') + '"]');
await page.click('.ed-chip:has-text("Meeting times")');
await settle(700);
await page.waitForFunction(() => document.querySelectorAll('.ed-paper .tlcb').length === 5);
eq((await order()).length, 5, 'clicking a chip appends a block');
eq((await order())[4], 'times', 'the right type is appended');
ok((await page.textContent('#edInspHead')).includes('Meeting times'), 'the new block is selected');
ok((await page.textContent('#edChanges')).includes('Added meeting times'), 'the add is logged');

group('add by dragging a palette chip');
await resetPage();
{
  const chip = page.locator('.ed-chip:has-text("Callout box")');
  await page.click('.ed-pal-tab[data-group="' + groupOf('callout') + '"]');
  await chip.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
  const target = page.locator('.ed-row').nth(1);
  const box = await target.boundingBox();
  await target.dispatchEvent('dragover', { clientY: box.y + 3, clientX: box.x + 5 });
  await page.waitForTimeout(80);
  ok((await page.textContent('.ed-canvas-drop')).toLowerCase().includes('insert callout box here'), 'drop line names the block being inserted');
  await target.dispatchEvent('drop');
  await settle(700);
  eq(await waitOrder(['hero', 'callout', 'text', 'video', 'faq']), JSON.stringify(['hero', 'callout', 'text', 'video', 'faq']), 'the block lands where the line was');
}

group('empty page');
await resetPage();
for (let i = 0; i < 4; i++) {
  await page.click('.ed-paper .tlcb');
  await page.click('.ed-paper .tlcb.is-sel [data-act="del"]');
  await settle(400);
}
await page.waitForFunction(() => document.querySelectorAll('.ed-paper .tlcb').length === 0).catch(() => {});
eq((await order()).length, 0, 'all blocks removed');
ok((await page.textContent('.ed-paper')).includes('This page is empty'), 'empty state on the canvas');
ok((await page.textContent('.ed-rail-list')).includes('No blocks yet'), 'empty state in the rail');
await page.click('.ed-pal-tab[data-group="' + groupOf('text') + '"]');
await page.click('.ed-chip:has-text("Rich text")');
await settle(700);
await page.waitForFunction(() => document.querySelectorAll('.ed-paper .tlcb').length === 1).catch(() => {});
eq((await order()).length, 1, 'a block can be added back to an empty page');

group('order survives a reload');
await reload();
eq(await waitOrder(['text']), JSON.stringify(['text']), 'the server kept the draft');

eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
