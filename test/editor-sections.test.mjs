// Phase 9 — saved sections: keep a block (or a whole page) as a reusable named
// section and drop it onto any ministry page.
//   node test/editor-sections.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createEditorServer } from './editor-server.mjs';
import { newBlock, sanitizeBlocks, parseBlocks } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const seed = sanitizeBlocks([
  newBlock('hero'),
  newBlock('text', { body: '<p>Page copy.</p>' }),
  newBlock('buttons', { items: [{ title: 'Contact the office', url: 'mailto:office@timothystl.org' }] }),
]);
const harness = createEditorServer({
  pages: [
    { slug: 'music', title: 'Music Ministry', blocks: seed },
    { slug: 'bees', title: 'Urban Beekeepers', blocks: sanitizeBlocks([newBlock('text', { body: '<p>Bees.</p>' })]) },
  ],
});
await new Promise((r) => harness.server.listen(0, r));
const base = 'http://localhost:' + harness.server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()); });
await page.route('https://**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

const open = async (slug) => {
  await page.goto(base + '/ministries/editor/' + slug, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb');
  await page.click('#edHintX').catch(() => {});
};
const order = () => page.$$eval('.ed-paper .tlcb', (ns) => ns.map((n) => n.dataset.type));
const waitCount = (n) => page.waitForFunction((want) => document.querySelectorAll('.ed-paper .tlcb').length === want, n, { timeout: 6000 });

await open('music');

group('the Saved group starts empty');
await page.click('.ed-pal-tab[data-group="Saved"]');
eq(await page.locator('.ed-pal-tab[aria-pressed="true"]').textContent(), 'Saved', 'there is a fifth palette group');
ok((await page.textContent('.ed-pal-chips')).includes('Nothing saved yet'), 'and it explains how to fill it');

group('saving a block as a section');
page.once('dialog', (d) => d.accept('Contact the office'));
await page.click('.ed-paper .tlcb--buttons');
await page.click('[data-k="save-section"]');
await page.waitForSelector('.ed-toast');
ok((await page.textContent('.ed-toast')).includes('Saved'), 'the editor confirms it saved');
await page.waitForTimeout(400);
eq(harness.sections.length, 1, 'the section reached the server');
eq(harness.sections[0].name, 'Contact the office', 'under the name that was typed');
eq(parseBlocks(harness.sections[0].blocks).length, 1, 'holding the one block');
await page.click('.ed-pal-tab[data-group="Saved"]');
eq(await page.locator('.ed-chip--saved').count(), 1, 'and appears as a chip');
ok((await page.textContent('.ed-chip--saved')).includes('Contact the office'), 'named on the chip');

group('a section will not save without a name');
page.once('dialog', (d) => d.accept('   '));
await page.click('.ed-paper .tlcb--text');
await page.click('[data-k="save-section"]');
await page.waitForSelector('.ed-toast');
ok((await page.textContent('.ed-toast')).includes('needs a name'), 'an empty name is refused');
eq(harness.sections.length, 1, 'and nothing is stored');
await page.waitForTimeout(2800);

group('cancelling the prompt saves nothing');
page.once('dialog', (d) => d.dismiss());
await page.click('[data-k="save-section"]');
await page.waitForTimeout(400);
eq(harness.sections.length, 1, 'cancelling is a no-op');

group('dropping a section onto another page');
await open('bees');
eq((await order()).length, 1, 'the bees page starts with one block');
await page.click('.ed-pal-tab[data-group="Saved"]');
await page.click('.ed-chip--saved');
await waitCount(2);
eq(JSON.stringify(await order()), JSON.stringify(['text', 'buttons']), 'clicking the chip appends the saved block');
ok((await page.textContent('#edChanges')).includes('Contact the office'), 'the change log names the section');
const btn = await page.locator('.ed-paper .tlcb--buttons').innerText();
ok(btn.includes('Contact the office'), 'and the block arrives with its content: ' + btn.trim());

group('the same section can be dropped twice without colliding');
await page.click('.ed-chip--saved');
await waitCount(3);
const ids = await page.$$eval('.ed-paper .tlcb', (ns) => ns.map((n) => n.dataset.id));
eq(new Set(ids).size, ids.length, 'every block on the page still has a distinct id');

group('dragging a section to an exact position');
await open('music');
await page.click('.ed-pal-tab[data-group="Saved"]');
{
  const chip = page.locator('.ed-chip--saved').first();
  await chip.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
  const target = page.locator('.ed-row').nth(1);
  const box = await target.boundingBox();
  await target.dispatchEvent('dragover', { clientY: box.y + 3, clientX: box.x + 5 });
  await page.waitForTimeout(100);
  ok((await page.textContent('.ed-canvas-drop')).toLowerCase().includes('contact the office'),
    'the drop line names the section being inserted');
  await target.dispatchEvent('drop');
  await waitCount(4);
  eq(JSON.stringify(await order()), JSON.stringify(['hero', 'buttons', 'text', 'buttons']),
    'the section lands exactly where the line was');
}

group('saving a whole page as a section');
page.once('dialog', (d) => d.accept('Standard ministry layout'));
await page.click('#edMore');
await page.waitForSelector('.ed-panel');
await page.click('#edSavePage');
await page.waitForTimeout(600);
eq(harness.sections.length, 2, 'a second section is stored');
const whole = harness.sections.find((s) => s.name === 'Standard ministry layout');
eq(parseBlocks(whole.blocks).length, 4, 'holding every block on the page');
await page.click('.ed-pal-tab[data-group="Saved"]');
eq(await page.locator('.ed-chip--saved').count(), 2, 'both sections are in the palette');
ok((await page.textContent('.ed-pal-chips')).includes('4'), 'the chip shows how many blocks it carries');

group('deleting a saved section');
page.once('dialog', (d) => d.accept());
await page.click('[data-del-section]');
await page.waitForTimeout(500);
eq(harness.sections.length, 1, 'the section is removed from the server');
eq(await page.locator('.ed-chip--saved').count(), 1, 'and from the palette');
eq((await order()).length, 4, 'pages already using it keep their blocks');

group('the server will not store rubbish');
{
  const bad = await (await fetch(base + '/ministries/api/sections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Nasty', blocks: [{ type: 'text', spaceAbove: 900, body: '<script>alert(1)</script><p>hi</p>' }] }),
  })).json();
  eq(bad.ok, true, 'it accepts the section');
  const stored = parseBlocks(harness.sections.find((s) => s.name === 'Nasty').blocks);
  eq(stored[0].spaceAbove, 96, 'but clamps the spacing');
  ok(!stored[0].body.includes('script'), 'and strips the script tag');
  const empty = await (await fetch(base + '/ministries/api/sections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Empty', blocks: [] }),
  })).json();
  ok(empty.error, 'an empty section is refused');
}

eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
