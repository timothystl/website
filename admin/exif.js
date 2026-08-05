// ── [B6] STRIPPING METADATA OUT OF UPLOADED IMAGES ───────────
// A photo taken on a phone carries EXIF, and EXIF routinely carries GPS
// coordinates. Staff upload photos of the building, of events, of each other;
// every one of those files is then served publicly from this domain forever.
// Somebody's home address can end up in a staff portrait's metadata without
// anybody involved knowing it is there.
//
// ── WHY THIS IS SERVER-SIDE ──────────────────────────────────
// There was already a client-side re-encode (`compressToWebp`) that strips
// metadata as a side effect of drawing to a canvas — but it is wired to the
// staff photo picker ONLY. The news header image, the rich-text editors and
// the logo picker all POST the file exactly as it came off the phone. And even
// the re-encoder falls back to `resolve(file)` — the untouched original — when
// the canvas cannot produce a WebP.
//
// So the strip happens at /api/upload-image, which every one of those paths
// goes through. A privacy guarantee that depends on which button somebody
// happened to click is not a guarantee.
//
// ── WHY IT IS BYTE-LEVEL AND NOT A DECODE ────────────────────
// Cloudflare Workers has no image library, and decoding to re-encode would be
// both expensive and lossy. It does not need one: in all three formats the
// metadata lives in its own self-delimiting container chunk, so it can be cut
// out without touching a single pixel. The image that comes out is byte-for-
// byte the same picture, minus the metadata.
//
// ⚠ EVERY function here fails OPEN — an unrecognised, truncated or malformed
// file is returned untouched rather than mangled. Losing somebody's photo to a
// parser that misread it would be a worse outcome than the metadata it was
// trying to remove, and the caller cannot tell a corrupted image from a valid
// one until somebody opens the page and finds it broken.
//
// Pure functions over Uint8Array — no Request, no env — so they can be tested
// against real files. See admin/exif.test.mjs.

const u32be = (b, i) => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
const u32le = (b, i) => (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24) >>> 0;
const put32le = (b, i, v) => { b[i] = v & 255; b[i + 1] = (v >>> 8) & 255; b[i + 2] = (v >>> 16) & 255; b[i + 3] = (v >>> 24) & 255; };
const tag = (b, i, s) => s.split('').every((c, k) => b[i + k] === c.charCodeAt(0));

// ── JPEG ─────────────────────────────────────────────────────
// A JPEG is SOI followed by marker segments. EXIF (and GPS with it) lives in
// APP1; XMP is a second APP1. Both are dropped.
//
// APP0 is kept — it is the JFIF header, which says how to interpret the pixel
// density — and so is APP14, which tells a decoder that a four-channel image is
// YCCK/CMYK rather than something else. Dropping either can change how the
// picture renders, and neither carries anything personal.
//
// Scanning stops at SOS: after that marker the rest of the file is entropy-
// coded pixel data in which a 0xFF byte is not a marker, and continuing to
// read it as segments is how a stripper corrupts an image.
function stripJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  const keep = [bytes.subarray(0, 2)];
  let i = 2;
  let removed = false;

  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xFF) return null;              // not where a marker should be
    const marker = bytes[i + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    if (marker === 0xDA) { keep.push(bytes.subarray(i)); i = bytes.length; break; }  // SOS: the rest is pixels
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;                          // truncated
    const isExifOrXmp = marker === 0xE1;
    if (isExifOrXmp) { removed = true; } else { keep.push(bytes.subarray(i, i + 2 + len)); }
    i += 2 + len;
  }
  if (!removed) return null;                          // nothing to do; hand back the original
  return concat(keep);
}

// ── PNG ──────────────────────────────────────────────────────
// Every PNG chunk carries its own length and CRC, so dropping one needs no
// fix-ups anywhere else. `eXIf` is the EXIF chunk; the text chunks are where
// camera software and editors leave comments, which can name a person or a
// file path on somebody's machine.
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt']);

function stripPng(bytes) {
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (bytes.length < 8 || !SIG.every((v, k) => bytes[k] === v)) return null;
  const keep = [bytes.subarray(0, 8)];
  let i = 8;
  let removed = false;

  while (i + 8 <= bytes.length) {
    const len = u32be(bytes, i);
    const name = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + len;                          // length + type + data + CRC
    if (len > bytes.length || end > bytes.length) return null;   // truncated
    if (PNG_DROP.has(name)) removed = true;
    else keep.push(bytes.subarray(i, end));
    i = end;
    if (name === 'IEND') break;
  }
  if (!removed) return null;
  return concat(keep);
}

// ── WEBP ─────────────────────────────────────────────────────
// A RIFF container: 'RIFF' + size + 'WEBP' + chunks. Metadata rides in EXIF
// and XMP chunks, which only exist in the extended (VP8X) form.
//
// ⚠ Two things have to be right or the file is broken rather than clean: the
// RIFF size field in the header must be rewritten to match what is left, and
// every chunk is padded to an even length with a byte that is NOT counted in
// its own size field. Miss the padding and every subsequent chunk is read one
// byte out.
function stripWebp(bytes) {
  if (bytes.length < 16 || !tag(bytes, 0, 'RIFF') || !tag(bytes, 8, 'WEBP')) return null;
  const keep = [];
  let i = 12;
  let removed = false;

  while (i + 8 <= bytes.length) {
    const name = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    const size = u32le(bytes, i + 4);
    const padded = size + (size % 2);                  // the pad byte is not in `size`
    const end = i + 8 + padded;
    if (end > bytes.length) return null;               // truncated
    if (name === 'EXIF' || name === 'XMP ') removed = true;
    else keep.push(bytes.subarray(i, end));
    i = end;
  }
  if (!removed) return null;

  const body = concat(keep);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12), 0);
  out.set(body, 12);
  put32le(out, 4, out.length - 8);                     // RIFF size counts everything after it
  return out;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// The one entry point. Returns the cleaned bytes, or the ORIGINAL when there
// was nothing to remove or the file could not be parsed with confidence.
export function stripImageMetadata(input) {
  let bytes;
  try {
    bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  } catch (_) {
    return input;
  }
  if (!bytes.length) return input;
  try {
    const out = stripJpeg(bytes) || stripPng(bytes) || stripWebp(bytes);
    // A stripper that produced something LARGER than it was given has not
    // understood the file. Refuse it rather than store the result.
    if (out && out.length && out.length <= bytes.length) return out;
  } catch (_) { /* fail open, deliberately */ }
  return bytes;
}

// Whether a stored object still carries metadata — used by the test, and
// useful for checking a file by hand.
export function hasMetadata(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
    for (let i = 2; i + 3 < bytes.length;) {
      if (bytes[i] !== 0xFF) return false;
      const marker = bytes[i + 1];
      if (marker === 0xDA) return false;
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker === 0xE1) return true;
      if (len < 2) return false;
      i += 2 + len;
    }
    return false;
  }
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    for (let i = 8; i + 8 <= bytes.length;) {
      const len = u32be(bytes, i);
      const name = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
      if (PNG_DROP.has(name)) return true;
      i += 12 + len;
      if (name === 'IEND') break;
    }
    return false;
  }
  if (bytes.length > 16 && tag(bytes, 0, 'RIFF') && tag(bytes, 8, 'WEBP')) {
    for (let i = 12; i + 8 <= bytes.length;) {
      const name = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
      const size = u32le(bytes, i + 4);
      if (name === 'EXIF' || name === 'XMP ') return true;
      i += 8 + size + (size % 2);
    }
    return false;
  }
  return false;
}
