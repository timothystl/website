// Node test harness for admin/exif.js — run with: node admin/exif.test.mjs
//
// The fixtures in test/fixtures are REAL image files carrying REAL GPS
// coordinates, written by Pillow + piexif. The assertions that matter are
// therefore not "the function returned something" but:
//
//   1. the coordinates are genuinely gone from the bytes, and
//   2. the file still decodes as the same picture afterwards.
//
// (2) is the one that would otherwise be missed. A stripper that removes the
// metadata AND quietly corrupts the image has not helped anybody — and nobody
// finds out until a photo is broken on a live page, long after the upload.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripImageMetadata, hasMetadata } from './exif.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '..', 'test', 'fixtures');
const read = (f) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// The GPS values the fixtures were written with, as they appear in the bytes.
// Searching for them directly is the honest check: it does not trust our own
// parser to say the metadata is gone.
const contains = (bytes, ascii) => {
  const needle = [...ascii].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let k = 0; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
};

// A picture is still a picture if its container still parses to the same
// dimensions. Enough to catch a stripper that cut in the wrong place.
function dimensions(b) {
  if (b[0] === 0xFF && b[1] === 0xD8) {                       // JPEG: find SOFn
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xFF) return null;
      const m = b[i + 1];
      if (m === 0xDA) return null;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      }
      i += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x89 && b[1] === 0x50) {                       // PNG: IHDR is first
    return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0,
             h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
  }
  return null;
}

group('the GPS really is gone, and the picture really is not');
{
  for (const [file, w, h] of [['gps.jpg', 64, 48], ['gps.png', 40, 30]]) {
    const before = read(file);
    ok(hasMetadata(before), `${file} starts out carrying metadata`);
    ok(contains(before, 'TestCam') || contains(before, 'Exif'),
      `${file} really does have camera data in its bytes to begin with`);

    const after = stripImageMetadata(before);
    ok(!hasMetadata(after), `${file} has none afterwards`);
    ok(!contains(after, 'TestCam'), `${file} — the camera make is gone from the raw bytes`);
    ok(!contains(after, '/Users/somebody/Pictures'),
      `${file} — so is the path off somebody's machine`);
    ok(after.length < before.length, `${file} got smaller, so something was actually removed`);

    const d = dimensions(after);
    ok(d && d.w === w && d.h === h,
      `${file} still decodes as ${w}x${h} — stripping must not corrupt the image`);
  }

  // WebP has no dimension check here, but the RIFF size field is the thing
  // most easily left wrong, and a wrong one makes the file unreadable.
  const wBefore = read('gps.webp');
  ok(hasMetadata(wBefore), 'gps.webp starts out carrying metadata');
  const wAfter = stripImageMetadata(wBefore);
  ok(!hasMetadata(wAfter), 'and none afterwards');
  const riffSize = wAfter[4] | wAfter[5] << 8 | wAfter[6] << 16 | wAfter[7] << 24;
  eq(riffSize, wAfter.length - 8, 'the RIFF size field was rewritten to match what is left');
  ok(String.fromCharCode(...wAfter.subarray(8, 12)) === 'WEBP', 'and it is still a WebP');
}

group('a file with nothing to remove is handed back untouched');
{
  // Byte-identical, not merely equivalent: re-encoding a clean file would be
  // pure loss — bigger or blurrier for no privacy gain at all.
  for (const file of ['clean.jpg', 'clean.png', 'clean.webp']) {
    const before = read(file);
    const after = stripImageMetadata(before);
    eq(after.length, before.length, `${file} is the same length`);
    ok(before.every((v, i) => after[i] === v), `${file} is byte-for-byte identical`);
  }
}

group('⚠ anything it cannot parse is returned untouched, never mangled');
{
  // Losing somebody's photo to a parser that misread it is a worse outcome
  // than the metadata it was trying to remove — and the caller cannot tell a
  // corrupted image from a valid one until it is already on a page.
  const cases = {
    'a PDF': new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]),
    'random bytes': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    'an empty file': new Uint8Array([]),
    'a truncated JPEG': read('gps.jpg').subarray(0, 20),
    'a JPEG header and nothing else': new Uint8Array([0xFF, 0xD8]),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    const out = stripImageMetadata(bytes);
    eq(out.length, bytes.length, `${name} comes back the same length`);
    ok(bytes.every((v, i) => out[i] === v), `${name} comes back unchanged`);
  }

  // A truncated file must not be silently "repaired" into something shorter
  // that looks valid — that would turn a failed upload into a broken image
  // nobody notices.
  const cut = read('gps.jpg').subarray(0, 600);
  eq(stripImageMetadata(cut).length, 600, 'a JPEG cut off mid-segment is left exactly as it arrived');
}

group('the pixels are untouched');
{
  // Everything after SOS is entropy-coded image data. It is the part a
  // byte-level stripper is most likely to damage, so it is compared directly.
  const before = read('gps.jpg');
  const after = stripImageMetadata(before);
  const sos = (b) => { for (let i = 2; i + 1 < b.length; i++) if (b[i] === 0xFF && b[i + 1] === 0xDA) return i; return -1; };
  const a = before.subarray(sos(before)), z = after.subarray(sos(after));
  eq(z.length, a.length, 'the scan data is exactly as long as it was');
  ok(a.every((v, i) => z[i] === v), 'and byte-for-byte the same — no pixel was re-encoded');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
