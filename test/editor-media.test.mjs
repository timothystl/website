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

const seed = sanitizeBlocks([newBlock('hero'), newBlock('textphoto'), newBlock('video'), newBlock('gallery')]);
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

eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
