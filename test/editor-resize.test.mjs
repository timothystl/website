// Phase 8 — photos are resized in the browser before they are uploaded, so an
// 8MB straight-off-the-phone picture never lands on the site at full size.
//   node test/editor-resize.test.mjs
import path from 'node:path';
import zlib from 'node:zlib';
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

// A real, valid PNG of the given size — noisy so it does not compress to
// nothing, which is what a photo off a camera behaves like.
function makePng(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      raw[o++] = (x * 7 + y * 13) & 0xff;
      raw[o++] = (x * 3 + y * 5) & 0xff;
      raw[o++] = (x ^ y) & 0xff;
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const seed = sanitizeBlocks([newBlock('textphoto')]);
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
await page.goto(base + '/ministries/editor/music', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ed-paper .tlcb');
await page.click('#edHintX').catch(() => {});

// Drives the editor's own shrink() with a file built inside the page.
const shrinkIn = (w, h, type, maxDim) => page.evaluate(async ([w, h, type, maxDim]) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = (i * 7) & 0xff; img.data[i + 1] = (i * 13) & 0xff;
    img.data[i + 2] = (i * 3) & 0xff; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, type, 1));
  const file = new File([blob], 'camera-roll.' + (type === 'image/png' ? 'png' : 'jpg'), { type });
  const out = await window.__edShrink(file, maxDim);
  return out ? { w: out.width, h: out.height, size: out.blob.size, name: out.filename, type: out.blob.type, orig: file.size }
             : { skipped: true, orig: file.size };
}, [w, h, type, maxDim]);

group('a big photo is shrunk');
{
  const r = await shrinkIn(3000, 2000, 'image/jpeg', 1600);
  eq(r.w, 1600, 'longest edge comes down to 1600px');
  eq(r.h, 1067, 'aspect ratio is kept');
  ok(r.size < r.orig, `result is smaller than the original (${r.orig} → ${r.size})`);
  ok(r.type === 'image/webp' || r.type === 'image/jpeg', 'encoded to a web format (' + r.type + ')');
  ok(/\.(webp|jpg)$/.test(r.name), 'filename extension matches the encoding: ' + r.name);
}

group('a portrait photo is shrunk on its long edge');
{
  const r = await shrinkIn(1200, 3000, 'image/jpeg', 1600);
  eq(r.h, 1600, 'height is the constrained edge');
  eq(r.w, 640, 'width scales with it');
}

group('thumbnails');
{
  const full = await shrinkIn(3000, 2000, 'image/jpeg', 1600);
  const r = await shrinkIn(3000, 2000, 'image/jpeg', 400);
  eq(r.w, 400, 'thumb is 400px on its long edge');
  eq(r.h, 267, 'and keeps its shape');
  // An absolute byte threshold would only be measuring how well this synthetic
  // noise happens to compress; what matters is the thumb is a fraction of the
  // full-size image it sits beside in the grid.
  ok(r.size < full.size / 4, `thumb is far smaller than the full size (${full.size} → ${r.size})`);
}

group('an already-small photo is left alone');
{
  const r = await shrinkIn(300, 200, 'image/png', 1600);
  ok(r.skipped || r.size < r.orig, 'a small image is either untouched or still smaller, never inflated');
}

group('an animated GIF is never canvased');
{
  const r = await page.evaluate(async () => {
    // 1x1 GIF — the point is the type, not the pixels: a canvas round-trip
    // would freeze an animation to one frame.
    const bytes = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'wave.gif', { type: 'image/gif' });
    return await window.__edShrink(file, 1600);
  });
  eq(r, null, 'GIFs are passed through untouched');
}

group('end to end: uploading a 3000px photo');
{
  const before = harness.uploads.length;
  const png = makePng(3000, 2000);
  ok(png.length > 1_000_000, 'the test photo really is large (' + Math.round(png.length / 1024) + ' KB)');
  await page.click('.ed-paper .tlcb--textphoto');
  await page.click('.ed-paper .tlcb.is-sel .tlcb-pick');
  await page.waitForSelector('.ed-modal');
  await page.setInputFiles('#edFile', { name: 'camera-roll.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('#edAltNew', { timeout: 15000 });
  const sent = harness.uploads.slice(before);
  eq(sent.length, 2, 'a full-size image and a thumbnail are uploaded');
  ok(sent[0].bytes < png.length, `the full-size upload is smaller than the original (${png.length} → ${sent[0].bytes})`);
  ok(sent[1].bytes < sent[0].bytes, 'the thumbnail is smaller again');
  ok(sent[0].bytes < 900_000, 'and comfortably under a megabyte (' + Math.round(sent[0].bytes / 1024) + ' KB)');
  ok((await page.textContent('.ed-modal-f')).includes('Resized'), 'the dialog says what it saved');

  await page.fill('#edAltNew', 'A test photo of the choir');
  await page.click('#edStagedAdd');
  await page.waitForSelector('.ed-modal', { state: 'detached' });
  await page.waitForTimeout(500);
  const added = harness.media[0];
  ok(added.thumb_url && added.thumb_url !== added.url, 'the library row keeps a separate thumbnail');
  ok(/\d+×\d+/.test(added.meta), 'and records the stored dimensions: ' + added.meta);
}

group('the library grid uses the thumbnail, not the full image');
{
  await page.click('.ed-paper .tlcb--textphoto');
  await page.click('.ed-paper .tlcb.is-sel .tlcb-pick');
  await page.waitForSelector('.ed-modal');
  const thumb = harness.media[0].thumb_url;
  const styles = await page.$$eval('.ed-tile-th', (ns) => ns.map((n) => n.getAttribute('style') || ''));
  ok(styles.some((s) => s.includes(thumb)), 'grid tile is backed by the thumbnail');
  await page.keyboard.press('Escape');
}

eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
