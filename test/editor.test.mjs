// Drives the ministry page editor in a real browser against the local harness
// in editor-server.mjs.  node test/editor.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createEditorServer } from './editor-server.mjs';
import { newBlock, BLOCK_DEFS, GROUPS } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const harness = createEditorServer();
await new Promise((r) => harness.server.listen(0, r));
const base = 'http://localhost:' + harness.server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Only real JS errors count. The harness has no favicon/fonts, and those
// resource-load failures are noise, not defects.
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource/i.test(t)) return;
  errors.push('console: ' + t);
});
// Fonts and any other outbound request are stubbed — the container has no egress.
await page.route('https://**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

await page.goto(base + '/ministries/editor/music', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ed-paper .tlcb', { timeout: 5000 });

group('shell');
eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
eq(await page.locator('.ed-top').count(), 1, 'top bar present');
eq(await page.textContent('#edTitle'), 'Music Ministry', 'breadcrumb shows the page title');
eq(await page.textContent('#edPill'), 'Published', 'status pill starts published');
eq(await page.textContent('#edSaved'), 'No changes yet', 'autosave label starts empty');
eq(await page.locator('#edUndo').isDisabled(), true, 'undo disabled with an empty history');
ok((await page.textContent('#edChanges')).includes('Nothing since the last publish'), 'change log starts empty');
ok((await page.getAttribute('#edView', 'href')).endsWith('/music'), 'View live points at the public page');

group('rail');
const railRows = page.locator('.ed-row');
eq(await railRows.count(), 3, 'rail lists every block');
ok((await railRows.nth(0).textContent()).includes('Text + photo'), 'first row is the migrated text+photo block');
ok((await railRows.nth(1).textContent()).includes('Video'), 'second row is the video block');
ok((await railRows.nth(2).textContent()).includes('Button bar'), 'third row is the button bar');
eq(await railRows.nth(0).getAttribute('aria-label'), 'Text + photo block, position 1 of 3', 'rows carry an accessible name with position');

group('canvas');
eq(await page.locator('.ed-paper .tlcb').count(), 3, 'canvas renders every block');
ok(await page.locator('.ed-paper .tlcb--textphoto').count() === 1, 'text+photo block on the canvas');
ok((await page.locator('.ed-paper').innerHTML()).includes('congregation'), 'real page content is on the canvas');
eq(await page.locator('.ed-paper [contenteditable]').count() > 0, true, 'text fields are editable in the canvas');
eq(await page.locator('.ed-paper .tlcb-tools').first().isVisible(), false, 'block toolbars hidden until selected');
eq(await page.locator('style#tlcb-css').count(), 1, 'block stylesheet shipped with the canvas');

group('device switcher');
const paperWidth = () => page.evaluate(() => {
  const p = document.getElementById('edPaper');
  return { css: p.style.width, zoom: p.style.zoom, phone: p.classList.contains('ed-paper--phone') };
});
let w = await paperWidth();
eq(w.css, '900px', 'desktop paper is 900px, the width the design handoff specifies');
await page.click('[data-device="tablet"]');
w = await paperWidth();
eq(w.css, '620px', 'tablet paper is 620px');
await page.click('[data-device="phone"]');
await page.waitForTimeout(300); // the paper width transition is 180ms
w = await paperWidth();
eq(w.css, '390px', 'phone paper is 390px');
eq(w.phone, true, 'phone class applied to the paper');
eq(await page.locator('[data-device="phone"]').getAttribute('aria-pressed'), 'true', 'active device tab marked pressed');
// The paper must keep its true width and be scaled, never flex-shrunk to fit.
const measured = await page.evaluate(() => document.getElementById('edPaper').getBoundingClientRect().width);
ok(Math.abs(measured - 390) < 2, 'phone paper measures 390px on screen, not collapsed (got ' + measured + ')');
// columns collapse in phone preview, driven by the shared phone rules
const cols = await page.evaluate(() => {
  const el = document.querySelector('.ed-paper .tlcb--textphoto .tlcb-grid');
  return el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : -1;
});
eq(cols, 1, 'text+photo collapses to one column in phone preview');
await page.click('[data-device="desktop"]');
const colsBack = await page.evaluate(() => {
  const el = document.querySelector('.ed-paper .tlcb--textphoto .tlcb-grid');
  return el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : -1;
});
eq(colsBack, 2, 'columns come back on desktop');

group('paper scaling in a narrow window');
await page.setViewportSize({ width: 1100, height: 900 });
await page.waitForTimeout(250);
const narrow = await paperWidth();
ok(Number(narrow.zoom) < 1 && Number(narrow.zoom) > 0.2, 'paper zooms down to fit a narrow canvas (zoom ' + narrow.zoom + ')');
// 900px paper + 266px rail + 318px inspector + padding needs ~1550px of window
await page.setViewportSize({ width: 1700, height: 900 });
await page.waitForTimeout(250);
eq(Number((await paperWidth()).zoom), 1, 'zoom returns to 1 when the window is wide enough');
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(250);

group('palette');
// Counts come from the palette definition rather than being restated here, so
// adding a block type cannot silently leave the palette half-drawn.
eq(await page.locator('.ed-pal-tab').count(), GROUPS.length + 1, 'every block group, plus Saved');
eq(await page.locator('.ed-pal-tab[aria-pressed="true"]').textContent(), GROUPS[0].name, 'the first group is active by default');
for (const g of GROUPS) {
  await page.click('.ed-pal-tab[data-group="' + g.name + '"]');
  eq(await page.locator('.ed-chip').count(), g.types.length, `${g.name} shows all ${g.types.length} of its blocks`);
  const txt = await page.locator('.ed-pal-chips').textContent();
  for (const t of g.types) ok(txt.includes(BLOCK_DEFS[t].label), `${g.name} lists ${BLOCK_DEFS[t].label}`);
}
await page.click('.ed-pal-tab[data-group="' + GROUPS[1].name + '"]');
await page.click('#edPalToggle');
eq(await page.locator('.ed-pal-chips').isVisible(), false, 'palette collapses');
await page.click('#edPalToggle');
eq(await page.locator('.ed-pal-chips').isVisible(), true, 'palette reopens');
await page.click('.ed-pal-tab[data-group="' + GROUPS[0].name + '"]');

group('inspector empty state');
ok((await page.textContent('#edInspBody')).includes('Nothing selected'), 'inspector shows the empty state');

group('hint strip');
eq(await page.locator('#edHint').isVisible(), true, 'first-run tip visible');
await page.click('#edHintX');
eq(await page.locator('#edHint').isVisible(), false, 'tip dismisses');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ed-paper .tlcb');
eq(await page.locator('#edHint').isVisible(), false, 'tip stays dismissed after a reload');

group('no layout overflow');
const overflow = await page.evaluate(() => document.body.scrollWidth - document.body.clientWidth);
ok(overflow <= 1, 'editor shell does not scroll horizontally (got ' + overflow + ')');
const bodyScroll = await page.evaluate(() => document.body.scrollHeight - document.body.clientHeight);
ok(bodyScroll <= 1, 'editor shell does not scroll vertically — regions scroll internally (got ' + bodyScroll + ')');

eq(errors.length, 0, 'still no page errors: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
