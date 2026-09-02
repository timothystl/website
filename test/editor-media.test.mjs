// Phase 5 — the media library: choosing, uploading with required alt text,
// videos, and gallery multi-select.   node test/editor-media.test.mjs
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

// The card grid is here for the picture-field group at the bottom: one card
// with a heading (which is the alt text a dropped photo borrows) and one
// without, because the refusal is the half worth pinning.
const grid = newBlock('cardgrid');
grid.items = [
  { img: '', eyebrow: '', title: 'Food Pantry', body: '<p>Open monthly.</p>', linkLabel: 'Learn more', url: '/foodpantry' },
  { img: '', eyebrow: '', title: '', body: '<p>Not named yet.</p>', linkLabel: '', url: '' },
];
const seed = sanitizeBlocks([newBlock('hero'), newBlock('textphoto'), newBlock('video'), newBlock('gallery'), grid, newBlock('documents')]);
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

const resetPage = async () => {
  await page.waitForTimeout(1900).catch(() => {});
  await fetch(base + '/ministries/api/page/music/draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks: seed, changes: [] }),
  });
  await page.goto(base + '/ministries/editor/music', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb');
  await page.click('#edHintX').catch(() => {});
};
const saved = () => JSON.parse(harness.pages.get('music').blocks);
await resetPage();

group('opening the library');
await page.click('.ed-paper .tlcb--textphoto');
await page.click('.ed-paper .tlcb.is-sel .tlcb-pick');
await page.waitForSelector('.ed-modal');
eq(await page.locator('.ed-modal[role="dialog"][aria-modal="true"]').count(), 1, 'modal is a real dialog');
ok((await page.textContent('.ed-modal-h')).includes('Photo library'), 'titled Photo library');
eq(await page.locator('.ed-tile').count(), 2, 'only photos are listed, not the video');
ok((await page.textContent('.ed-modal-grid')).includes('choir-loft.jpg'), 'filenames are shown');
eq(await page.evaluate(() => document.activeElement.id), 'edPickerClose', 'focus moves into the dialog');

group('choosing a photo');
await page.click('.ed-tile:has-text("handbells-easter.jpg")');
await page.waitForSelector('.ed-modal', { state: 'detached' });
await page.waitForTimeout(600);
ok(await page.locator('.ed-paper .tlcb--textphoto img[src*="handbells-easter"]').count() > 0, 'the photo lands on the block');
ok((await page.textContent('#edChanges')).includes('Changed photo · handbells-easter.jpg'), 'the change is logged with the filename');
await page.waitForTimeout(1900);
eq(saved().find((b) => b.type === 'textphoto').photo, '/images/handbells-easter.jpg', 'saved to the draft');
eq(saved().find((b) => b.type === 'textphoto').photoAlt, 'Handbells at Easter', "the library's alt text comes with it");

group('escape and backdrop close the dialog');
await page.click('.ed-paper .tlcb--textphoto');
await page.click('.ed-paper .tlcb.is-sel .tlcb-pick');
await page.waitForSelector('.ed-modal');
await page.keyboard.press('Escape');
await page.waitForSelector('.ed-modal', { state: 'detached' });
ok(true, 'Escape closes the dialog');
await page.click('.ed-paper .tlcb.is-sel .tlcb-pick');
await page.waitForSelector('.ed-modal');
await page.click('#edBack', { position: { x: 5, y: 5 } });
await page.waitForSelector('.ed-modal', { state: 'detached' });
ok(true, 'clicking the backdrop closes the dialog');

group('uploading a photo requires alt text');
await page.click('.ed-paper .tlcb--textphoto');
await page.click('.ed-paper .tlcb.is-sel .tlcb-pick');
await page.waitForSelector('.ed-modal');
await page.setInputFiles('#edFile', {
  name: 'organ-console.jpg', mimeType: 'image/jpeg',
  buffer: Buffer.from('\xff\xd8\xff\xe0fake-jpeg', 'binary'),
});
await page.waitForSelector('#edAltNew');
ok(true, 'after upload the library asks for a description');
await page.click('#edStagedAdd');
await page.waitForTimeout(200);
ok((await page.textContent('.ed-modal')).includes('read aloud'), 'adding without a description is refused, with a reason');
eq(await page.locator('.ed-tile').count(), 2, 'and nothing was added to the library');
await page.fill('#edAltNew', 'The organ console in the balcony');
await page.click('#edStagedAdd');
await page.waitForSelector('.ed-modal', { state: 'detached' });
await page.waitForTimeout(600);
ok(harness.media.some((m) => m.alt === 'The organ console in the balcony'), 'the photo joins the library with its description');
ok(await page.locator('.ed-paper .tlcb--textphoto img[src*="uploaded-"]').count() > 0, 'and is placed on the block straight away');

group('video library');
await page.click('.ed-paper .tlcb--video');
await page.click('.ed-paper .tlcb.is-sel .tlcb-pick');
await page.waitForSelector('.ed-modal');
ok((await page.textContent('.ed-modal-h')).includes('Video library'), 'titled Video library');
eq(await page.locator('.ed-tile').count(), 1, 'only videos are listed');
await page.fill('#edVidUrl', 'not-a-video');
await page.click('#edVidAdd');
await page.waitForTimeout(200);
ok((await page.textContent('.ed-modal')).includes('Paste a YouTube link'), 'a non-YouTube link is refused');
await page.fill('#edVidUrl', 'https://youtu.be/aaaaaaaaaaa');
await page.fill('#edVidName', 'Handbells at Easter Dawn');
await page.click('#edVidAdd');
await page.waitForSelector('.ed-modal', { state: 'detached' });
await page.waitForTimeout(600);
ok(await page.locator('.ed-paper .tlcb--video .tlcb-embed-ph').count() > 0, 'the video block updates');
await page.waitForTimeout(1900);
eq(saved().find((b) => b.type === 'video').video, 'https://youtu.be/aaaaaaaaaaa', 'video url saved');

group('gallery multi-select');
await page.click('.ed-paper .tlcb--gallery');
await page.click('.ed-paper .tlcb.is-sel .tlcb-pick--inline');
await page.waitForSelector('.ed-modal');
ok((await page.textContent('.ed-modal-h')).includes('Add 0 photos'), 'gallery mode offers a multi-select action');
await page.click('.ed-tile:has-text("choir-loft.jpg")');
await page.click('.ed-tile:has-text("handbells-easter.jpg")');
ok((await page.textContent('.ed-modal-h')).includes('Add 2 photos'), 'the count follows the selection');
eq(await page.locator('.ed-tile[aria-pressed="true"]').count(), 2, 'selected tiles are marked');
await page.click('.ed-tile:has-text("handbells-easter.jpg")'); // deselect
ok((await page.textContent('.ed-modal-h')).includes('Add 1 photo'), 'clicking again deselects');
await page.click('.ed-tile:has-text("handbells-easter.jpg")');
await page.click('#edGalleryAdd');
await page.waitForSelector('.ed-modal', { state: 'detached' });
await page.waitForTimeout(700);
eq(await page.locator('.ed-paper .tlcb--gallery img').count(), 2, 'both photos land in the gallery');
await page.waitForTimeout(1900);
eq(saved().find((b) => b.type === 'gallery').items.length, 2, 'gallery items saved');

group('hero photo');
await page.click('.ed-paper .tlcb--hero');
await page.click('.ed-paper .tlcb.is-sel .tlcb-pick');
await page.waitForSelector('.ed-modal');
await page.click('.ed-tile:has-text("choir-loft.jpg")');
await page.waitForSelector('.ed-modal', { state: 'detached' });
await page.waitForTimeout(600);
ok((await page.getAttribute('.ed-paper .tlcb--hero', 'style')).includes('choir-loft.jpg'), 'hero background uses the chosen photo');

group('inspector opens the same library');
await page.click('.ed-paper .tlcb--textphoto');
await page.click('[data-k="photo"]');
await page.waitForSelector('.ed-modal');
ok(true, 'the inspector Photo row opens the library too');
await page.keyboard.press('Escape');

// ── a card's picture is dropped on, not typed into ──────────────────────────
// The field used to be a bare text box holding /images/ministries/….webp, so
// putting a photo on a card meant uploading it somewhere else first and then
// copying the address across by hand.
await resetPage();

// Fires a real file drag at a zone. ⚠ `dragover` has to be fired too: the
// handler proves it is a file drag from dataTransfer.types, which is the only
// part of a DataTransfer a browser exposes before the drop lands.
const dropFile = async (selector, name, mimeType, text) =>
  page.evaluate(({ selector, name, mimeType, text }) => {
    const zone = document.querySelector(selector);
    if (!zone) throw new Error('no zone ' + selector);
    const dt = new DataTransfer();
    dt.items.add(new File([text], name, { type: mimeType }));
    for (const kind of ['dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, { selector, name, mimeType, text });

group('a card grid has picture fields, not address boxes');
await page.click('.ed-paper .tlcb--cardgrid');
await page.waitForSelector('.ed-insp [data-rows="item"]');
eq(await page.locator('.ed-img[data-imgdrop="item:0:img"]').count(), 1, 'card 1 gets a picture field');
eq(await page.locator('.ed-img[data-imgdrop="item:1:img"]').count(), 1, 'card 2 gets one too');
ok((await page.textContent('.ed-img[data-imgdrop="item:0:img"]')).includes('Drop a photo here'),
  'and it says a photo can be dropped on it');
eq(await page.locator('.ed-img[data-imgdrop="item:0:img"] input[data-in="item:0:img"]').count(), 1,
  'the address box is still there — a partner logo is often hosted by the partner');
// The two predicates must not collide: `img` is something an <img> points at,
// `url` is somewhere a visitor is sent, and they get different controls.
eq(await page.locator('.ed-img[data-imgdrop="item:0:url"]').count(), 0, "a card's link is not a picture field");
eq(await page.locator('.ed-link input[data-in="item:0:url"]').count(), 1, 'it keeps the pick-a-page control');
// Dinger read the "https://…" placeholder as documentation and asked why the
// field "only allows a full website url or page names" — the placeholder
// vanishes on typing and the picker beside it only ever lists real pages, so
// #name (a same-page jump) had no visible mention anywhere. This line is
// always on screen, whether or not the box has been touched yet.
ok((await page.locator('.ed-link .ed-note').first().textContent()).includes('#name'),
  'the box says a #name jump is a real option, not just a page or a URL');
eq(await page.locator('.ed-img[data-imgdrop="photo"]').count(), 0, 'no block photo on a card grid');

group('choosing a card picture from the library');
await page.click('[data-k="pickimg:item:0:img"]');
await page.waitForSelector('.ed-modal');
ok((await page.textContent('.ed-modal-h')).includes('Photo library'), 'the same library opens');
await page.click('.ed-tile:has-text("choir-loft.jpg")');
await page.waitForSelector('.ed-modal', { state: 'detached' });
await page.waitForTimeout(700);
eq(await page.locator('.ed-paper .tlcb--cardgrid img[src*="choir-loft"]').count(), 1, 'it lands on that card');
ok((await page.textContent('#edChanges')).includes('Changed picture · choir-loft.jpg'), 'and is logged');
await page.waitForTimeout(1900);
eq(saved().find((b) => b.type === 'cardgrid').items[0].img, '/images/choir-loft.jpg', 'saved to the draft');
eq(saved().find((b) => b.type === 'cardgrid').items[1].img, '', 'and only that card changed');

group('dropping a photo straight onto a card');
const before = harness.media.length;
// Card 2 has no heading, and the heading is the description the library needs.
await dropFile('.ed-img[data-imgdrop="item:1:img"]', 'garden.jpg', 'image/jpeg', 'fake-jpeg-bytes');
await page.waitForTimeout(500);
eq(harness.media.length, before, 'a card with no heading is refused — there is no description to borrow');
ok((await page.textContent('#edToast')).toLowerCase().includes('heading'), 'and it says to name the card first');

// Card 1 is "Food Pantry", and already carries the library photo chosen above —
// so this proves a drop replaces a picture as well as filling an empty field.
await dropFile('.ed-img[data-imgdrop="item:0:img"]', 'pantry-shelves.jpg', 'image/jpeg', 'fake-jpeg-bytes');
await page.waitForTimeout(1500);
eq(harness.media.length, before + 1, 'a card that has one uploads');
eq(harness.media[0].alt, 'Food Pantry', 'the library entry borrows the heading as its description');
ok(await page.locator('.ed-paper .tlcb--cardgrid img[src*="uploaded-"]').count() > 0, 'and the photo is on the card');
await page.waitForTimeout(1900);
const grid0 = saved().find((b) => b.type === 'cardgrid');
ok(/uploaded-/.test(grid0.items[0].img), 'saved to the draft, replacing the one that was there');
eq(grid0.items[1].img, '', 'and the other card is untouched');

group('what is not a photo, and what is not a field');
const before2 = harness.media.length;
await dropFile('.ed-img[data-imgdrop="item:0:img"]', 'budget.pdf', 'application/pdf', 'not-a-picture');
await page.waitForTimeout(400);
eq(harness.media.length, before2, 'a PDF is refused');
ok((await page.textContent('#edToast')).includes('JPEG'), 'and it says what would work');
// ⚠ Missing the thumbnail must not navigate the browser to the file, taking
// the editor and anything not yet autosaved with it.
const wentAway = await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['x'], 'stray.jpg', { type: 'image/jpeg' }));
  const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
  document.body.dispatchEvent(ev);
  return !ev.defaultPrevented;
});
ok(!wentAway, 'a file dropped anywhere else is swallowed rather than followed');

group('a row being dragged is not swallowed by the picture field it passes over');
// ⚠ The picture field sits INSIDE the row, so a card dragged by its grip travels
// over other cards' thumbnails on the way to where it is going. If the drop
// target claimed that, dragging a card past another card's picture would
// silently stop working — and the picture fields are new, so it would read as
// them having broken reordering.
await page.click('.ed-paper .tlcb--cardgrid');
await page.waitForSelector('.ed-insp [data-rows="item"]');
const dragged = await page.evaluate(() => {
  const rows = document.querySelector('.ed-insp [data-rows="item"]');
  const grip = rows.querySelector('.ed-item[data-row="1"] .ed-grip');
  const zone = rows.querySelector('.ed-item[data-row="0"] .ed-img');
  const dt = new DataTransfer();
  // ⚠ The pointer's Y decides which side of the row the drop lands on, and a
  // DragEvent with no clientY reads as 0 — which is above the panel, not above
  // the row, and lands the card back where it started.
  const box = rows.querySelector('.ed-item[data-row="0"]').getBoundingClientRect();
  const fire = (node, kind) => node.dispatchEvent(new DragEvent(kind,
    { bubbles: true, cancelable: true, dataTransfer: dt, clientY: box.top + 2 }));
  fire(grip, 'dragstart');
  fire(zone, 'dragover');
  const out = {
    claimed: zone.classList.contains('is-over'),
    marked: !!rows.querySelector('.ed-item.is-drop-before, .ed-item.is-drop-after'),
  };
  fire(zone, 'drop');
  return out;
});
ok(!dragged.claimed, 'the picture field does not light up for a row that is being moved');
ok(dragged.marked, 'the reorder indicator shows instead');
await page.waitForTimeout(1900);
eq(saved().find((b) => b.type === 'cardgrid').items[1].title, 'Food Pantry', 'and the card really moved');

group('the arrows still move a row that has a picture field in it');
await page.click('.ed-insp [data-rows="item"] .ed-item[data-row="1"] [data-a="item-up"]');
await page.waitForTimeout(1900);
eq(saved().find((b) => b.type === 'cardgrid').items[0].title, 'Food Pantry', 'moved back with the arrow');

// ⚠ Found while building the picture fields, and older than them: a card's
// heading identifies its item BY INDEX, and reordering moves the index out from
// under a heading that still has focus. patch() reorders, renderInspector()
// pulls focus into the panel, and the focusout that fires lands on a canvas the
// Worker has not redrawn yet — so the old node's index wrote one card's words
// over another's. The canvas came back right a moment later; only the SAVED
// draft was wrong, which is why nobody caught it.
group('reordering with the caret in a heading does not overwrite the other card');
await page.click('.ed-paper .tlcb--cardgrid [data-item="0"][data-field="title"]');
eq(await page.evaluate(() => document.activeElement.className), 'tlcb-cg-head', 'the caret is in a card heading');
await page.evaluate(() => document.querySelector(
  '.ed-insp [data-rows="item"] .ed-item[data-row="1"] [data-a="item-up"]').click());
await page.waitForTimeout(2200);
const after = saved().find((b) => b.type === 'cardgrid').items.map((i) => i.title);
eq(JSON.stringify(after), JSON.stringify(['', 'Food Pantry']), 'both headings survive the move');

// ── the Documents block: a native file picker, not the photo library ────────
// No shared library of PDFs exists the way ministry_media is a library of
// photos, so this field never opens that modal — a <label>-wrapped hidden
// file input, plus the same drag-and-drop shape the picture fields use.
await resetPage();

group('a document field is a file picker, not a picture field');
await page.click('.ed-paper .tlcb--documents');
await page.waitForSelector('.ed-insp [data-rows="item"]');
eq(await page.locator('.ed-img[data-docdrop="item:0:url"]').count(), 1, 'the file gets its own drop zone');
eq(await page.locator('.ed-img[data-imgdrop="item:0:url"]').count(), 0, 'never the picture one — the two predicates do not collide');
ok((await page.textContent('.ed-img[data-docdrop="item:0:url"]')).includes('Drop a file here'),
  'and it says a file can be dropped on it — PDF, Word, Excel or PowerPoint');
eq(await page.locator('.ed-img[data-docdrop="item:0:url"] input[type="file"][data-docupload="item:0:url"]').count(), 1,
  'a real hidden file input opens the OS picker');
eq(await page.locator('.ed-img[data-docdrop="item:0:url"] input[data-in="item:0:url"]').count(), 1,
  'the address box stays too — a document is often hosted elsewhere, a Google Drive link');
eq(await page.locator('.ed-modal').count(), 0, 'clicking the field never opens the photo library modal');

group('uploading a PDF onto a document field');
const docsBefore = harness.docUploads.length;
await dropFile('.ed-img[data-docdrop="item:0:url"]', 'council-minutes.pdf', 'application/pdf', 'fake-pdf-bytes');
await page.waitForTimeout(500);
eq(harness.docUploads.length, docsBefore + 1, 'the file reaches /api/upload-doc');
// ⚠ Unlike a photo (which is resized/re-encoded client-side), a PDF is
// posted untouched — so the real filename survives, not a synthesized one.
ok(await page.locator('.ed-paper .tlcb--documents').textContent().then((t) => t.includes('council-minutes')),
  'the real filename lands on the block, not a generated one');
ok((await page.textContent('#edChanges')).includes('Changed file · council-minutes.pdf'),
  'logged as a file change, not a "picture" change — setImageSpec takes the noun');
await page.waitForTimeout(1900);
eq(saved().find((b) => b.type === 'documents').items[0].url, '/docs/1-council-minutes.pdf', 'saved to the draft');

group('a non-PDF is refused, and nothing is uploaded');
const docsBefore2 = harness.docUploads.length;
await dropFile('.ed-img[data-docdrop="item:0:url"]', 'flyer.jpg', 'image/jpeg', 'not-a-pdf');
await page.waitForTimeout(400);
eq(harness.docUploads.length, docsBefore2, 'no request was made for the wrong file type');
ok((await page.textContent('#edToast')).toLowerCase().includes('pdf'), 'and it says a PDF is wanted');

group('typing a link still works, for a document hosted elsewhere');
// Waits for the actual save request rather than guessing at the two
// chained debounces (inspectorInput's own 700ms, then scheduleSave's
// 1500ms) — #edSaved only has minute resolution, so it cannot reliably
// tell "the old save" from "the new one" the way this response can.
const draftSaved = page.waitForResponse((res) =>
  res.url().includes('/draft') && res.request().method() === 'POST', { timeout: 8000 });
await page.fill('.ed-img[data-docdrop="item:0:url"] input[data-in="item:0:url"]', 'https://drive.google.com/file/d/xyz/view');
await draftSaved;
eq(saved().find((b) => b.type === 'documents').items[0].url, 'https://drive.google.com/file/d/xyz/view',
  'a typed address is saved just like the upload was');

eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
