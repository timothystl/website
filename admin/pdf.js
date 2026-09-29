// ── A MINIMAL, DEPENDENCY-FREE PDF WRITER ───────────────────
// This repo carries no third-party JS anywhere, and Cloudflare Workers has
// no headless browser to render a page to PDF with — so a report that has
// to leave the Worker as a real PDF file is built byte by byte here, the
// same way admin/exif.js reads image bytes by hand instead of pulling in a
// library.
//
// Type is set in the Finance app's own faces — Figtree for body text and
// Outfit for headings and totals — embedded from admin/pdf-fonts.js as
// small TrueType subsets, so the report reads like the screen it came from
// on any reader, installed fonts or not. Because they are proportional,
// columns are placed by x position and right-aligned by measuring each
// string against the font's own width table (textWidth), not by padding
// with spaces the way a monospace layout would.
//
// A line is either one `text` at the left margin or a row of `cells`, each
// { text, x, align: 'left'|'right', font, color }. A line can also carry
// `bg` (a full-bleed filled band behind it — the title banner, a shaded
// subtotal row), `rule` (a stroked horizontal line drawn just under it —
// the underline below a column header) and `color` (its text color, e.g.
// white on a navy band). PDF content streams are just operators, so a
// filled rectangle or a stroked line is two or three of them, emitted
// before the BT/ET text block on the same page.
//
// ⚠ TEXT IS ASCII ONLY. The embedded fonts are simple TrueType fonts taking
// single-byte codes through WinAnsiEncoding, subset to 32-126; a codepoint
// outside that range is not a rendering quirk if emitted raw, it is a
// corrupted content stream (or a missing glyph). asciiSafe() substitutes
// the punctuation this codebase actually uses (em dash, curly quotes, the
// minus sign) and replaces anything else with '?' rather than emit it.
// The font programs themselves are written ASCIIHex-encoded, so the whole
// file stays 7-bit and can be base64-encoded as a binary string directly.
import { PDF_FONTS } from './pdf-fonts.js';

function asciiSafe(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/−/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');
}

function pdfEscape(s) {
  return asciiSafe(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export const PAGE_W = 612, PAGE_H = 792, MARGIN = 36;

// Resource name and subset tag per font key. The tag is the six-capital
// prefix PDF expects on the BaseFont of an embedded subset.
const FONT_KEYS = [
  { key: 'R', res: 'F1', tag: 'TLCFGR' },
  { key: 'B', res: 'F2', tag: 'TLCFGB' },
  { key: 'H', res: 'F3', tag: 'TLCOSB' },
];
const fontKey = (f) => (f === 'B' || f === 'H' ? f : 'R');

// Width of a string in points, set in `font` at `size`.
export function textWidth(text, font, size) {
  const widths = PDF_FONTS[fontKey(font)].widths;
  let units = 0;
  for (const ch of asciiSafe(text)) units += widths[ch.charCodeAt(0) - 32] || 0;
  return (units * size) / 1000;
}

// The string cut down (with a trailing '...') until it fits `maxWidth`, so
// a long name cannot run into the next column.
export function fitText(text, font, size, maxWidth) {
  let s = asciiSafe(text);
  if (textWidth(s, font, size) <= maxWidth) return s;
  while (s.length && textWidth(s + '...', font, size) > maxWidth) s = s.slice(0, -1);
  return s.trimEnd() + '...';
}

let hexCache = null;
function fontHex() {
  if (hexCache) return hexCache;
  hexCache = {};
  for (const { key } of FONT_KEYS) {
    const bin = atob(PDF_FONTS[key].base64);
    let hex = '';
    for (let i = 0; i < bin.length; i++) {
      hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
      if (i % 40 === 39) hex += '\n';
    }
    hexCache[key] = { hex: hex + '>', length1: bin.length };
  }
  return hexCache;
}

// lines: see the header. 'gap' adds extra space ABOVE a line. font/size
// default to R/9; `color`/`bg`/`rule` are each an [r,g,b] triple, 0..1.
export function buildReportPdf(lines) {
  const usableH = PAGE_H - MARGIN * 2;
  const pages = [];
  let cur = [];
  let used = 0;
  for (const raw of lines || []) {
    const font = fontKey(raw.font);
    const cells = Array.isArray(raw.cells)
      ? raw.cells.map((c) => ({ text: c.text, x: Number(c.x) || MARGIN, align: c.align === 'right' ? 'right' : 'left', font: fontKey(c.font || font), color: c.color || null }))
      : [{ text: raw.text, x: MARGIN, align: 'left', font, color: null }];
    const ln = {
      cells,
      size: raw.size || 9,
      color: raw.color || null,
      bg: raw.bg || null,
      rule: raw.rule || null,
    };
    const lh = ln.size * 1.5 + (raw.gap || 0);
    if (used + lh > usableH && cur.length) { pages.push(cur); cur = []; used = 0; }
    cur.push({ ...ln, lh });
    used += lh;
  }
  pages.push(cur); // always at least one page, even if empty

  const objects = [];
  const catalogId = 1, pagesId = 2;
  let nextId = 3;
  const fontIds = {};
  for (const f of FONT_KEYS) {
    fontIds[f.key] = { font: nextId++, descriptor: nextId++, file: nextId++ };
  }
  const contentIds = [];
  const pageIds = [];

  const rgb3 = (c) => c.map((v) => Number(v.toFixed(3))).join(' ');
  const resOf = Object.fromEntries(FONT_KEYS.map((f) => [f.key, f.res]));

  for (const pl of pages) {
    // Graphics (bands and rules) are painted first, as a set of plain path
    // operators outside any text object — PDF does not allow path
    // construction inside a BT/ET block, so the two passes are kept apart
    // rather than interleaved line by line.
    const graphics = [];
    const text = ['BT'];
    let curFont = null, curSize = null, curColor = null;
    let y = PAGE_H - MARGIN;
    for (const ln of pl) {
      y -= ln.lh;
      if (ln.bg) {
        graphics.push(`${rgb3(ln.bg)} rg`);
        graphics.push(`0 ${(y - ln.lh * 0.3).toFixed(2)} ${PAGE_W} ${(ln.lh * 1.15).toFixed(2)} re f`);
      }
      if (ln.rule) {
        graphics.push(`${rgb3(ln.rule)} RG`);
        graphics.push('1 w');
        graphics.push(`${MARGIN} ${(y - ln.lh * 0.3).toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${(y - ln.lh * 0.3).toFixed(2)} l S`);
      }
      for (const cell of ln.cells) {
        const s = asciiSafe(cell.text);
        if (!s) continue;
        const f = resOf[cell.font];
        if (f !== curFont || ln.size !== curSize) {
          text.push(`/${f} ${ln.size} Tf`);
          curFont = f; curSize = ln.size;
        }
        const col = rgb3(cell.color || ln.color || [0, 0, 0]);
        if (col !== curColor) {
          text.push(`${col} rg`);
          curColor = col;
        }
        const x = cell.align === 'right' ? cell.x - textWidth(s, cell.font, ln.size) : cell.x;
        text.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`);
        text.push(`(${pdfEscape(s)}) Tj`);
      }
    }
    text.push('ET');
    const body = graphics.concat(text).join('\n');
    const contentId = nextId++;
    contentIds.push(contentId);
    objects[contentId - 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  }
  const fontRes = FONT_KEYS.map((f) => `/${f.res} ${fontIds[f.key].font} 0 R`).join(' ');
  for (let i = 0; i < pages.length; i++) {
    const pageId = nextId++;
    pageIds.push(pageId);
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] `
      + `/Resources << /Font << ${fontRes} >> >> /Contents ${contentIds[i]} 0 R >>`;
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => p + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;

  const hex = fontHex();
  for (const { key, tag } of FONT_KEYS) {
    const meta = PDF_FONTS[key];
    const ids = fontIds[key];
    const baseFont = `${tag}+${meta.name}`;
    objects[ids.font - 1] = `<< /Type /Font /Subtype /TrueType /BaseFont /${baseFont} /FirstChar 32 /LastChar 126 `
      + `/Widths [${meta.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${ids.descriptor} 0 R >>`;
    // Flags 32 = Nonsymbolic (standard Latin character set).
    objects[ids.descriptor - 1] = `<< /Type /FontDescriptor /FontName /${baseFont} /Flags 32 `
      + `/FontBBox [${meta.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${meta.ascent} /Descent ${meta.descent} `
      + `/CapHeight ${meta.capHeight} /StemV ${meta.weight >= 600 ? 120 : 80} /FontWeight ${meta.weight} /FontFile2 ${ids.file} 0 R >>`;
    objects[ids.file - 1] = `<< /Length ${hex[key].hex.length} /Length1 ${hex[key].length1} /Filter /ASCIIHexDecode >>\n`
      + `stream\n${hex[key].hex}\nendstream`;
  }

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < objects.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  // Every character written above is ASCII (0x20-0x7E, plus the \n we
  // control), so this is safe to base64-encode as a binary string directly.
  return out;
}
