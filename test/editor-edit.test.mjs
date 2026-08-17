// Phase 3 — selection, inspector, in-place editing, autosave, undo.
//   node test/editor-edit.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createEditorServer } from './editor-server.mjs';
import { newBlock, sanitizeBlocks, renderBlock, BG, INK } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const seedBlocks = sanitizeBlocks([
  newBlock('text', { body: '<p>Opening paragraph.</p>' }),
  newBlock('textphoto', { title: 'Sing with the Choir', body: '<p>Rehearsals are Wednesdays.</p>' }),
  newBlock('faq'),
  newBlock('spacer'),
]);
const harness = createEditorServer({ pages: [{ slug: 'music', title: 'Music Ministry', blocks: seedBlocks }] });
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
await reload();

const savedBlocks = () => JSON.parse(harness.pages.get('music').blocks);
const settle = (ms = 250) => page.waitForTimeout(ms);
const flushSave = () => page.waitForTimeout(1900);

group('selection');
await page.click('.ed-paper .tlcb--textphoto');
eq(await page.locator('.ed-paper .tlcb.is-sel').count(), 1, 'exactly one block selected');
ok((await page.textContent('#edInspHead')).includes('Text + photo'), 'inspector titles the selected block');
ok((await page.textContent('#edInspHead')).includes('Block 2 of 4'), 'inspector shows the position');
eq(await page.locator('.ed-row[aria-selected="true"]').first().textContent().then((t) => t.includes('Text + photo')), true, 'rail row marked selected');
eq(await page.locator('.ed-paper .tlcb.is-sel .tlcb-tools').isVisible(), true, 'block toolbar appears on selection');
eq(await page.locator('.ed-paper .tlcb.is-sel .tlcb-badge').isVisible(), true, 'type badge appears on selection');
await page.click('.ed-row:nth-child(3)');
ok((await page.textContent('#edInspHead')).includes('FAQ'), 'clicking a rail row selects that block');
await page.keyboard.press('Escape');
ok((await page.textContent('#edInspBody')).includes('Nothing selected'), 'Escape clears the selection');

group('spacing guardrail');
await page.click('.ed-paper .tlcb--textphoto');
const marginTop = () => page.evaluate(() => getComputedStyle(document.querySelector('.tlcb--textphoto')).marginTop);
eq(await marginTop(), '24px', 'starts at 24px');
await page.click('[data-k="step:spaceAbove:1"]');
await settle(80);
eq(await marginTop(), '32px', 'one step up is +8px, applied live without a redraw');
for (let i = 0; i < 20; i++) await page.click('[data-k="step:spaceAbove:1"]');
await settle(120);
eq(await marginTop(), '96px', 'stepper caps at 96px');
for (let i = 0; i < 30; i++) await page.click('[data-k="step:spaceAbove:-1"]');
await settle(120);
eq(await marginTop(), '0px', 'stepper floors at 0px');
eq(await page.locator('.ed-insp-body input[type="number"], .ed-insp-body input[type="text"][data-k^="step"]').count(), 0, 'no free-form pixel input anywhere');
await flushSave();
eq(savedBlocks()[1].spaceAbove, 0, 'spacing autosaved to the server');

group('color guardrail');
await page.click('[data-k="bg:3"]'); // Navy
await settle(120);
let sel = () => page.evaluate(() => {
  const n = document.querySelector('.tlcb--textphoto');
  return { bg: n.style.getPropertyValue('--tlcb-bg').trim(), ink: n.style.getPropertyValue('--tlcb-ink').trim() };
});
eq((await sel()).bg, '#1E2D4A', 'navy background applied');
eq((await sel()).ink, '#F3EDE1', 'ink auto-switched to Cream on a dark background');
eq(await page.locator('[data-k="ink:0"]').getAttribute('aria-disabled'), 'true', 'dark-background-unreadable ink is marked disabled');
// force: the swatch is aria-disabled, which Playwright honors as "not
// actionable" — but a real mouse can still hit it, and the handler must refuse.
await page.click('[data-k="ink:0"]', { force: true });
await settle(120);
eq((await sel()).ink, '#F3EDE1', 'clicking an unreadable ink changes nothing');
await page.click('[data-k="ink:4"]'); // Gold
await settle(120);
eq((await sel()).ink, '#C9973A', 'a readable ink can be chosen');
await page.click('[data-k="bg:0"]'); // back to Parchment
await settle(120);
eq((await sel()).ink, '#3A3A4A', 'going back to a light background restores a dark ink');
eq(await page.locator('[data-k="ink:4"]').getAttribute('aria-disabled'), 'true', 'gold is now the unusable one');

group('client styling matches the server exactly');
// The editor applies CSS variables itself instead of re-rendering. If that ever
// drifts from admin/blocks.js, the canvas would lie about the published page.
for (const variant of [
  { bg: 3, ink: 4, size: 'l', side: 'right', split: '30', gap: 8, spaceAbove: 96, spaceBelow: 0 },
  { bg: 1, ink: 2, size: 's', side: 'above', split: '70', gap: 96, spaceAbove: 0, spaceBelow: 48 },
  { bg: 2, ink: 1, size: 'm', side: 'left', split: '50', gap: 32, spaceAbove: 16, spaceBelow: 16 },
]) {
  const b = Object.assign(newBlock('textphoto'), variant);
  const serverStyle = (renderBlock(b, {}).match(/style="([^"]*)"/) || [])[1];
  const clientStyle = await page.evaluate((blk) => window.__edStyleVars(blk), b);
  eq(clientStyle, serverStyle, 'client styleVars matches the server for ' + JSON.stringify(variant));
}

group('text size + split + side');
await page.click('[data-k="size:l"]');
await settle(80);
// ⚠ A calc(), not a bare px. The size a block chooses is multiplied by the
// page's text scale, which lives on the page wrapper because it comes from the
// Appearance record. The fallback is 1, so this still RENDERS at 17px — what
// changed is the expression, and the client's copy has to match the server's
// byte for byte, which the loop above asserts.
eq(await page.evaluate(() => document.querySelector('.tlcb--textphoto').style.getPropertyValue('--tlcb-body').trim()),
  'calc(17px * var(--tlcb-scale, 1))', 'large text applied');
await page.click('[data-k="split:70"]');
await settle(80);
eq(await page.evaluate(() => document.querySelector('.tlcb--textphoto').style.getPropertyValue('--tlcb-cols').trim()), '7fr 3fr', 'split applied');
ok((await page.textContent('.ed-insp-body')).includes('Photo 70% · Text 30%'), 'split readout updates');
await page.click('[data-k="side:right"]');
await settle(80);
eq(await page.evaluate(() => document.querySelector('.tlcb--textphoto').style.getPropertyValue('--tlcb-media-order').trim()), '2', 'photo moves to the right');
await page.click('[data-k="side:above"]');
await settle(80);
eq(await page.evaluate(() => document.querySelector('.tlcb--textphoto').style.getPropertyValue('--tlcb-cols').trim()), '1fr', 'above → single column');
ok((await page.textContent('.ed-insp-body')).includes('Full width'), 'split readout says full width');

group('in-place text editing');
await reload();
await page.click('.ed-paper .tlcb--textphoto');
const heading = page.locator('.ed-paper .tlcb--textphoto [data-field="title"]');
await heading.click();
await page.keyboard.press('Control+A');
await page.keyboard.type('Sing with us');
// typing must not redraw the canvas underneath the caret
eq(await page.evaluate(() => document.activeElement.dataset.field), 'title', 'focus stays in the field while typing');
await page.click('.ed-paper .tlcb--text');
await settle(150);
eq(await page.locator('.ed-paper .tlcb--textphoto [data-field="title"]').textContent(), 'Sing with us', 'edit is kept on the canvas');
ok((await page.textContent('#edChanges')).includes('Edited text in text + photo'), 'change log records the edit');
ok((await page.textContent('#edPill')).startsWith('Draft'), 'status pill flips to Draft');
await flushSave();
eq(savedBlocks()[1].title, 'Sing with us', 'edit autosaved to the server');
ok((await page.textContent('#edSaved')).startsWith('Autosaved'), 'autosave label updates');
// rail label follows the block's own heading
ok((await page.locator('.ed-row').nth(1).textContent()).includes('Sing with us'), 'rail row shows the new heading');

group('single-line fields do not take newlines');
await page.click('.ed-paper .tlcb--textphoto [data-field="title"]');
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await settle(120);
eq((await page.locator('.ed-paper .tlcb--textphoto [data-field="title"]').innerHTML()).includes('<div'), false, 'Enter in a heading does not inject block markup');

group('stamp');
await page.click('.ed-paper .tlcb--textphoto');
await page.click('[data-k="stamp:Upcoming"]');
await settle(400);
eq(await page.locator('.ed-paper .tlcb--textphoto .tlcb-stamp').count(), 1, 'stamp appears on the block');
eq(await page.locator('.ed-paper .tlcb--textphoto .tlcb-stamp').textContent(), 'Upcoming', 'stamp text');
ok((await page.textContent('#edChanges')).includes('Stamp → Upcoming'), 'change log records the stamp');
await page.click('[data-k="tone:2"]');
await settle(400);
ok((await page.getAttribute('.ed-paper .tlcb--textphoto .tlcb-stamp', 'style')).includes('#4A5E3A'), 'stamp tone applied');
await page.click('[data-k="corner:tl"]');
await settle(400);
ok((await page.getAttribute('.ed-paper .tlcb--textphoto .tlcb-stamp', 'class')).includes('tlcb-stamp--tl'), 'stamp corner applied');
// a stamp is editable in place
await page.click('.ed-paper .tlcb--textphoto .tlcb-stamp');
await page.keyboard.press('Control+A');
await page.keyboard.type('Bring a friend');
await page.click('.ed-paper .tlcb--text');
await settle(200);
eq(await page.locator('.ed-paper .tlcb--textphoto .tlcb-stamp').textContent(), 'Bring a friend', 'staff can reword a stamp preset');
await page.click('.ed-paper .tlcb--textphoto');
await page.click('[data-k="stamp:"]');
await settle(400);
eq(await page.locator('.ed-paper .tlcb-stamp').count(), 0, 'stamp removed');

group('show on phone');
await page.click('.ed-paper .tlcb--textphoto');
eq(await page.getAttribute('[data-k="hide"]', 'aria-checked'), 'true', 'shown on phone by default');
await page.click('[data-k="hide"]');
await settle(150);
eq(await page.getAttribute('[data-k="hide"]', 'aria-checked'), 'false', 'toggle flips');
ok((await page.getAttribute('.ed-paper .tlcb--textphoto', 'class')).includes('tlcb-hide-phone'), 'block marked hidden on phone');
ok((await page.locator('.ed-row').nth(1).textContent()).includes('Hidden'), 'rail row shows the Hidden tag');
await page.click('[data-device="phone"]');
await settle(350);
const dim = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.tlcb--textphoto')).opacity));
ok(dim < 0.6, 'hidden block is dimmed in phone preview rather than removed (opacity ' + dim + ')');
await page.click('[data-device="desktop"]');
await page.click('[data-k="hide"]');
await settle(150);

group('duplicate, delete, undo');
await reload();
await page.click('.ed-paper .tlcb--faq');
await page.click('.ed-paper .tlcb.is-sel [data-act="dup"]');
await settle(400);
eq(await page.locator('.ed-paper .tlcb').count(), 5, 'duplicate adds a block');
eq(await page.locator('.ed-paper .tlcb--faq').count(), 2, 'the copy is the same type');
eq(await page.locator('.ed-row').count(), 5, 'rail follows');
ok((await page.textContent('#edChanges')).includes('Duplicated faq'), 'change log records the duplicate');
await page.click('#edUndo');
await settle(400);
eq(await page.locator('.ed-paper .tlcb').count(), 4, 'undo removes the copy');
ok((await page.textContent('#edChanges')).includes('Undid last change'), 'undo is logged');

await page.click('.ed-paper .tlcb--spacer');
await page.click('.ed-paper .tlcb.is-sel [data-act="del"]');
await settle(400);
eq(await page.locator('.ed-paper .tlcb--spacer').count(), 0, 'delete removes the block');
ok((await page.textContent('#edInspBody')).includes('Nothing selected'), 'selection clears after a delete');
await page.click('#edUndo');
await settle(400);
eq(await page.locator('.ed-paper .tlcb--spacer').count(), 1, 'undo brings the block back');

group('redo');
await reload();
// Redo is only ever reachable after an undo, so it starts unavailable rather
// than looking like a control somebody has failed to find a use for.
eq(await page.locator('#edRedo').isDisabled(), true, 'redo starts disabled');
await page.click('.ed-paper .tlcb--faq');
await page.click('.ed-paper .tlcb.is-sel [data-act="dup"]');
await settle(400);
eq(await page.locator('.ed-paper .tlcb').count(), 5, 'duplicate adds a block');
eq(await page.locator('#edRedo').isDisabled(), true, 'and a fresh edit leaves nothing to redo');

await page.click('#edUndo');
await settle(400);
eq(await page.locator('.ed-paper .tlcb').count(), 4, 'undo removes the copy');
eq(await page.locator('#edRedo').isDisabled(), false, 'now there is something to redo');

await page.click('#edRedo');
await settle(400);
eq(await page.locator('.ed-paper .tlcb').count(), 5, 'redo puts it back');
eq(await page.locator('.ed-paper .tlcb--faq').count(), 2, 'and it is the same type');
ok((await page.textContent('#edChanges')).includes('Redid last change'), 'redo is logged');
eq(await page.locator('#edRedo').isDisabled(), true, 'the redo stack is spent');

// ⚠ THE ASSERTION THIS GROUP EXISTS FOR. Stepping back and then making a new
// edit abandons the branch that was undone. Without pushHistory() clearing the
// stack, Redo would assemble a page from that dead branch — content the editor
// appears to invent out of nothing.
await page.click('#edUndo');
await settle(400);
eq(await page.locator('.ed-paper .tlcb').count(), 4, 'stepped back again');
eq(await page.locator('#edRedo').isDisabled(), false, 'with a redo waiting');
await page.click('.ed-paper .tlcb--spacer');
await page.click('.ed-paper .tlcb.is-sel [data-act="del"]');
await settle(400);
eq(await page.locator('#edRedo').isDisabled(), true,
  'a new edit abandons the redo branch rather than leaving it reachable');

// Cmd/Ctrl+Shift+Z is the other half of the shortcut the undo handler already
// reserved by testing for the absence of shift.
await page.click('#edUndo');
await settle(400);
const beforeKey = await page.locator('.ed-paper .tlcb').count();
await page.keyboard.press('Control+Shift+z');
await settle(400);
eq(await page.locator('.ed-paper .tlcb').count(), beforeKey - 1,
  'Ctrl+Shift+Z redoes the delete');

group('reset block');
await page.click('.ed-paper .tlcb--textphoto');
await page.click('[data-k="bg:3"]');
await page.click('[data-k="size:l"]');
await settle(150);
await page.click('[data-k="reset"]');
await settle(450);
const afterReset = await page.evaluate(() => {
  const n = document.querySelector('.tlcb--textphoto');
  return { bg: n.style.getPropertyValue('--tlcb-bg').trim(), body: n.style.getPropertyValue('--tlcb-body').trim() };
});
eq(afterReset.bg, '#FBF8F3', 'reset restores the default background');
eq(afterReset.body, 'calc(15px * var(--tlcb-scale, 1))', 'reset restores the default text size');
ok((await page.textContent('#edChanges')).includes('Reset text + photo'), 'reset is logged');

group('repeating rows');
await reload();
await page.click('.ed-paper .tlcb--faq');
eq(await page.locator('.ed-paper .tlcb--faq details').count(), 1, 'FAQ starts with one row');
await page.click('[data-k="item-add"]');
await settle(450);
eq(await page.locator('.ed-paper .tlcb--faq details').count(), 2, 'a row can be added');
await page.click('[data-k="item-del:1"]');
await settle(450);
eq(await page.locator('.ed-paper .tlcb--faq details').count(), 1, 'a row can be removed');
// the question itself is edited on the page, not in a form
await page.click('.ed-paper .tlcb--faq [data-item="0"][data-field="title"]');
await page.keyboard.press('Control+A');
await page.keyboard.type('Do I need to audition?');
await page.click('.ed-paper .tlcb--text');
await flushSave();
eq(savedBlocks().find((b) => b.type === 'faq').items[0].title, 'Do I need to audition?', 'row text saved');

// ── reordering a block's own rows ────────────────────────────────────────────
// ⚠ There was no way to do this at all until v5.1.0: the inspector offered add
// and remove and nothing else, so moving the seventh card in a grid to the top
// meant deleting and retyping all seven. On /ministries that is nine cards, and
// that grid's featured card is simply the FIRST one — so which ministry the
// page led with was fixed at insertion order and could not be changed.
group('rows can be reordered');
await reload();
await page.click('.ed-paper .tlcb--faq');
// Three rows, so there is a middle one — with two, up and down are the same
// move and a swapped sign would still pass.
await page.click('[data-k="item-add"]'); await settle(450);
await page.click('[data-k="item-add"]'); await settle(450);
const titles = ['First', 'Second', 'Third'];
for (let i = 0; i < 3; i++) {
  await page.click(`.ed-paper .tlcb--faq [data-item="${i}"][data-field="title"]`);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(titles[i]);
}
await page.click('.ed-paper .tlcb--text');
await flushSave();
const rowTitles = () => savedBlocks().find((x) => x.type === 'faq').items.map((r) => r.title);
eq(rowTitles().join(','), 'First,Second,Third', 'three rows in the order they were typed');

await page.click('.ed-paper .tlcb--faq');
await page.click('[data-k="item-down:0"]');
await settle(450);
await flushSave();
eq(rowTitles().join(','), 'Second,First,Third', 'the first row moves down');

await page.click('[data-k="item-up:2"]');
await settle(450);
await flushSave();
eq(rowTitles().join(','), 'Second,Third,First', 'and the last moves up');

// ⚠ The ends are disabled rather than silently doing nothing — a control that
// looks live and is not is worse than one that is visibly unavailable.
eq(await page.locator('[data-k="item-up:0"]').isDisabled(), true, 'the first row cannot move up');
eq(await page.locator('[data-k="item-down:2"]').isDisabled(), true, 'nor the last one down');

// The grip carries draggable, NOT the row: a draggable ancestor stops the
// mouse selecting text inside the row's inputs.
eq(await page.locator('.ed-item[data-row="0"] .ed-grip').getAttribute('draggable'), 'true',
  'the grip is the drag handle');
eq(await page.locator('.ed-item[data-row="0"]').getAttribute('draggable'), null,
  'and the row itself is not draggable, so its inputs stay selectable');

// One row means no reordering to offer, so neither control is drawn.
await page.click('[data-k="item-del:2"]'); await settle(450);
await page.click('[data-k="item-del:1"]'); await settle(450);
eq(await page.locator('.ed-item .ed-grip').count(), 0, 'a single row offers no grip');
eq(await page.locator('.ed-move').count(), 0, 'and no arrows');

// ── the info card ────────────────────────────────────────────────────────────
// A slot on the banner, switched on in the inspector. The banner's own text
// column narrows to make room, so the card can never overlap the words and
// there is nothing for the office to position.
group('the info card');
// The music fixture has no banner, so add one — which also proves the card is
// offered on a block the moment it is inserted, not only on seeded ones.
await page.click('.ed-pal-tab[data-group="Structure"]');
await page.click('.ed-chip[data-type="hero"]');
await page.waitForSelector('.ed-paper .tlcb--hero');
await page.click('.ed-paper .tlcb--hero');
ok((await page.textContent('#edInspBody')).includes('Info card'), 'a banner offers the card');
ok(!(await page.textContent('#edInspBody')).includes('Card shows'), 'and hides what it shows until it is on');
eq(await page.locator('.ed-paper .tlcb--hero .tlcb-card').count(), 0, 'nothing is drawn while it is off');

await page.click('[data-k="card:right"]');
await settle(400);
eq(await page.locator('.ed-paper .tlcb--hero .tlcb-card').count(), 1, 'switching it on draws the card');
eq(await page.locator('.ed-paper .tlcb--hero .tlcb-hero.tlcb-band--card-right').count(), 1, 'on the side chosen');
ok((await page.textContent('#edInspBody')).includes('Card shows'), 'and now offers what it holds');
// The card sits BESIDE the text, never over it — that is the whole reason it
// is a slot rather than a floating block.
const overlap = await page.evaluate(() => {
  const t = document.querySelector('.tlcb--hero .tlcb-band-text').getBoundingClientRect();
  const c = document.querySelector('.tlcb--hero .tlcb-card').getBoundingClientRect();
  return t.right > c.left + 1 && c.right > t.left + 1;
});
eq(overlap, false, 'the card never overlaps the banner text');

await page.click('[data-k="cardShows:contact"]');
await settle(400);
ok((await page.textContent('.ed-paper .tlcb--hero .tlcb-card')).includes('314'),
  'the contact card reads the church details rather than asking anyone to retype them');

await flushSave();
const heroSaved = savedBlocks().find((b) => b.type === 'hero');
eq(heroSaved.card, 'right', 'the card is saved on the block');
eq(heroSaved.cardShows, 'contact', 'and so is what it shows');

await page.click('[data-k="card:off"]');
await settle(400);
eq(await page.locator('.ed-paper .tlcb--hero .tlcb-card').count(), 0, 'switching it off takes it away again');

group('spacing steppers on a half block re-render the pair');
{
  // ⚠ A half block's spacing is written by the SERVER onto the .tlcb-pair
  // wrapper. The stepper's style-mode patch updated a custom property on the
  // block's own node — one the pair never reads — so the stepper moved
  // nothing on screen or in the published page, while the inspector counted
  // up happily. Half blocks take the width chip's path now: a re-render.
  await flushSave();
  const halves = sanitizeBlocks([
    Object.assign(newBlock('text', { body: '<p>Left.</p>' }), { width: 'half' }),
    Object.assign(newBlock('text', { body: '<p>Right.</p>' }), { width: 'half' }),
  ]);
  await fetch(base + '/ministries/api/page/music/draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks: halves, changes: [] }),
  });
  await reload();
  await page.waitForSelector('.ed-paper .tlcb-pair');

  const below = () => page.evaluate(() =>
    parseInt(document.querySelector('.ed-paper .tlcb-pair').style.getPropertyValue('--tlcb-space-below'), 10) || 0);
  const start = await below();
  await page.click('.ed-paper .tlcb--text');
  await page.click('[data-k="step:spaceBelow:1"]');
  await page.waitForFunction((want) => {
    const p = document.querySelector('.ed-paper .tlcb-pair');
    return p && (parseInt(p.style.getPropertyValue('--tlcb-space-below'), 10) || 0) === want;
  }, start + 8, { timeout: 5000 }).catch(() => {});
  eq(await below(), start + 8, 'stepping a half block moves the pair wrapper the page actually renders');
}

group('server rejects what the client would never send');
const bad = await (await fetch(base + '/ministries/api/render', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ blocks: [{ type: 'text', spaceAbove: 900, bg: 9, ink: 9, body: '<script>alert(1)</script><p>hi</p>' }] }),
})).json();
eq(bad.blocks[0].spaceAbove, 96, 'a stale tab cannot write spaceAbove:900');
eq(bad.blocks[0].bg, 0, 'a stale tab cannot write an out-of-range color');
ok(!bad.html.includes('<script>alert'), 'a stale tab cannot write a script tag');

group('draft state on the server');
eq(harness.pages.get('music').page_status, 'draft', 'page is marked draft once it differs from what is published');

eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
