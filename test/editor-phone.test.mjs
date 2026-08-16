// The page editor on a phone — run with: node test/editor-phone.test.mjs
//
// Below 900px the four columns cannot be columns: 224 + 266 + canvas + 318 into
// 390px is not a layout. One surface is on screen at a time and a bar along the
// bottom switches between them.
//
// ⚠ THE ASSERTIONS THAT MATTER ARE THE ONES ABOUT WHAT IS ALREADY THERE. Every
// drag in this editor has a tap equivalent, built as a KEYBOARD equivalent and
// inherited by touch: a palette chip adds on click, a block moves with the
// arrows in its toolbar, a row moves with the arrows beside it. If any of those
// stopped working, a phone would lose the ability rather than the convenience —
// so they are driven here at 390px, by tap, with no drag anywhere in the file.
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createEditorServer } from './editor-server.mjs';
import { newBlock, sanitizeBlocks } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const seed = sanitizeBlocks([
  newBlock('hero', { title: 'Music Ministry' }),
  newBlock('text', { body: '<p>First paragraph.</p>' }),
  newBlock('cardgrid'),
]);
const harness = createEditorServer({ pages: [{ slug: 'music', title: 'Music Ministry', blocks: seed }] });
await new Promise((r) => harness.server.listen(0, r));
const base = 'http://localhost:' + harness.server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
// A real phone viewport, and a touch context — hasTouch matters, because a
// touch context is what makes Playwright's tap() legal and what the browser
// reports to any code that asks.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(m.text())) return;
  errors.push('console: ' + m.text());
});
await page.route('https://**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

await page.goto(base + '/ministries/editor/music', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ed-paper .tlcb', { timeout: 8000 });
await page.tap('#edHintX').catch(() => {});

const shown = () => page.evaluate(() => ({
  pages: !!document.querySelector('.ed-pages') && getComputedStyle(document.querySelector('.ed-pages')).display !== 'none',
  blocks: getComputedStyle(document.querySelector('.ed-rail')).display !== 'none',
  canvas: getComputedStyle(document.querySelector('.ed-mid')).display !== 'none',
  insp: getComputedStyle(document.querySelector('.ed-insp')).display !== 'none',
}));
const saved = () => JSON.parse(harness.pages.get('music').blocks);

group('one surface at a time');
{
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.locator('.ed-mtabs').isVisible(), true, 'the bottom bar is on screen');
  const first = await shown();
  eq(first.canvas, true, 'it opens on the page itself');
  eq(first.blocks, false, 'not the outline');
  eq(first.insp, false, 'and not the settings panel');

  // ⚠ NOTHING OVERFLOWS SIDEWAYS. Four columns into 390px is exactly the
  // failure this layout exists to prevent, and it shows up as a horizontal
  // scrollbar rather than as anything obviously broken.
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, 'no horizontal overflow at 390px (got ' + over + ')');
}

group('the bar moves between them');
{
  await page.tap('.ed-mtabs [data-m="blocks"]');
  let v = await shown();
  eq(v.blocks, true, 'Blocks shows the outline');
  eq(v.canvas, false, 'and puts the page away');
  eq(await page.getAttribute('.ed-mtabs [data-m="blocks"]', 'aria-selected'), 'true', 'the tab says so');

  await page.tap('.ed-mtabs [data-m="insp"]');
  v = await shown();
  eq(v.insp, true, 'Settings shows the panel');
  eq(v.blocks, false, 'and puts the outline away');
  eq(await page.getAttribute('.ed-mtabs [data-m="blocks"]', 'aria-selected'), 'false', 'only one tab is current');

  await page.tap('.ed-mtabs [data-m="canvas"]');
  eq((await shown()).canvas, true, 'and back to the page');
}

group('the paper is the phone');
{
  // ⚠ NO ZOOM. Fixed at 390 inside a ~370px canvas the paper would scale to
  // about 0.8 — and `zoom` and caret hit-testing do not agree in every engine,
  // so text would land where it was not tapped. This is the assertion that
  // keeps typing honest.
  const paper = await page.evaluate(() => {
    const p = document.querySelector('.ed-paper');
    return { zoom: getComputedStyle(p).zoom, inlineWidth: p.style.width, phoneClass: p.classList.contains('ed-paper--phone') };
  });
  ok(paper.zoom === '1' || paper.zoom === 'normal' || paper.zoom === '', 'the canvas is 1:1 (' + paper.zoom + ')');
  eq(paper.inlineWidth, '', 'the paper takes the width it is given rather than a fixed one');
  eq(paper.phoneClass, true, 'and it renders under the phone rules');
  eq(await page.locator('.ed-devices').isVisible(), false, 'the preview-width switcher is gone — you are on a phone');
}

group('a collapsed rail is not a blank column');
{
  // ⚠ The collapse is a desktop idea: it exists to give the canvas room, and
  // there is no canvas beside it here. A stored "shut" from a desk session
  // would otherwise make Blocks an empty 26px spine.
  await page.evaluate(() => { try { localStorage.setItem('tlcEdRailblocks', '0'); } catch (_) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb', { timeout: 8000 });
  await page.tap('#edHintX').catch(() => {});
  await page.tap('.ed-mtabs [data-m="blocks"]');
  const w = await page.evaluate(() => document.querySelector('.ed-rail').getBoundingClientRect().width);
  ok(w > 200, 'the outline fills the screen even when it was collapsed at a desk (got ' + Math.round(w) + ')');
  eq(await page.locator('.ed-rail-list .ed-row').first().isVisible(), true, 'and its rows are visible');
  // The stored choice is left alone, for when they are back at that desk.
  eq(await page.evaluate(() => localStorage.getItem('tlcEdRailblocks')), '0', 'the desktop choice is not overwritten');
}

group('picking a block in the outline takes you to it');
{
  await page.tap('.ed-rail-list .ed-row:nth-child(2)');
  await page.waitForTimeout(300);
  eq((await shown()).canvas, true, 'the page comes forward');
  eq(await page.locator('.ed-paper .tlcb.is-sel').count(), 1, 'with that block selected');
}

// ── the tap paths that were already there ────────────────────────────────────
group('a block is added by tapping it, not dragging it');
{
  const before = (await page.locator('.ed-paper .tlcb').count());
  await page.tap('.ed-mtabs [data-m="canvas"]');
  // ⚠ A chip from the group the palette actually OPENS on. It opens on the
  // first group in the config (Structure), and `text` lives in Content — a test
  // that reaches for the wrong tab fails as though tap-to-add were broken.
  await page.tap('.ed-pal-chips .ed-chip[data-type="callout"]');
  await page.waitForTimeout(700);
  eq(await page.locator('.ed-paper .tlcb').count(), before + 1, 'the palette adds on tap');
  await page.waitForTimeout(1900);
  eq(saved().length, seed.length + 1, 'and it reaches the draft');
}

group('a block moves by its arrows');
{
  const typesNow = () => page.$$eval('.ed-paper .tlcb', (ns) =>
    ns.map((n) => (n.className.match(/tlcb--([a-z]+)/) || [])[1]));
  const before = await typesNow();
  // Select the last block and walk it up one.
  await page.tap('.ed-paper .tlcb:last-child');
  await page.waitForTimeout(200);
  const up = page.locator('.ed-paper .tlcb.is-sel [data-act="up"]');
  eq(await up.count(), 1, 'the selected block offers an up arrow');
  await up.tap();
  await page.waitForTimeout(800);
  const after = await typesNow();
  ok(JSON.stringify(after) !== JSON.stringify(before), 'and tapping it reorders the page');
  await page.waitForTimeout(1900);
  eq(saved().map((b) => b.type).join(','), after.join(','), 'the draft matches what is on screen');
}

group('a row inside a block moves by its arrows');
{
  // The card grid seeded above has three cards. Reordering them is the case
  // v5.1.0 built the arrows for, and it is drag-only without them.
  await page.tap('.ed-paper .tlcb--cardgrid');
  await page.waitForTimeout(200);
  await page.tap('.ed-mtabs [data-m="insp"]');
  await page.waitForSelector('.ed-insp [data-rows="item"]');
  const heads = () => page.$$eval('.ed-insp [data-rows="item"] .ed-item-n', (ns) => ns.map((n) => n.textContent));
  const before = await heads();
  await page.tap('.ed-insp [data-rows="item"] .ed-item[data-row="1"] [data-a="item-up"]');
  await page.waitForTimeout(700);
  ok(JSON.stringify(await heads()) !== JSON.stringify(before), 'a card moves up on tap');
}

group('what somebody aims at is big enough to hit');
{
  // ⚠ 44px, the same rule public-phone.test.mjs holds the public site to —
  // applied to the editor for the first time. A 12px grip is not a target.
  await page.tap('.ed-mtabs [data-m="canvas"]');
  const small = await page.evaluate(() => {
    const out = [];
    const sel = '.ed-mtabs button, .ed-pal-chips .ed-chip, .ed-pal-toggle';
    document.querySelectorAll(sel).forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.height < 44) out.push((n.className || n.tagName) + ' ' + Math.round(r.height) + 'px');
    });
    return out;
  });
  eq(small.length, 0, 'every control on the page surface clears 44px: ' + small.slice(0, 4).join(' | '));
}

group('the tip says what is true here');
{
  await page.evaluate(() => { try { localStorage.removeItem('tlc-ministry-editor-hint-v1'); } catch (_) {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb', { timeout: 8000 });
  const tip = await page.textContent('#edHint');
  // ⚠ It is the first thing anybody reads, and the desktop wording is four
  // instructions of which all four are wrong on a phone.
  ok(!/drag/i.test(tip), 'it does not tell a phone to drag things');
  ok(/bar at the bottom/i.test(tip), 'it points at the bar instead');
}

eq(errors.length, 0, 'no page errors overall: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
