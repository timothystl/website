// ── A MINIMAL, DEPENDENCY-FREE PDF WRITER ───────────────────
// This repo carries no third-party JS anywhere, and Cloudflare Workers has
// no headless browser to render a page to PDF with — so a report that has
// to leave the Worker as a real PDF file is built byte by byte here, the
// same way admin/exif.js reads image bytes by hand instead of pulling in a
// library. Text is laid out as plain monospace lines (Courier is one of
// the 14 standard PDF fonts, so nothing has to be embedded) — good enough
// for a tabular report where alignment matters more than typography.
//
// A line can also carry `bg` (a full-bleed filled band behind it — the
// title banner, a shaded subtotal row) and `rule` (a stroked horizontal
// line drawn just under it — the underline below a column header) and
// `color` (its own text color, e.g. white on a navy band). None of that
// needs a second drawing pass or a graphics library: PDF content streams
// are just operators, and a filled rectangle or a stroked line is two or
// three of them, emitted before the BT/ET text block on the same page.
//
// ⚠ TEXT IS ASCII ONLY. A simple (non-embedded) PDF font takes single-byte
// character codes through WinAnsiEncoding; a codepoint outside the ASCII
// printable range is not a rendering quirk if emitted raw, it is a
// corrupted content stream. asciiSafe() substitutes the punctuation this
// codebase actually uses (em dash, curly quotes, the minus sign) and
// replaces anything else with '?' rather than emit it. If a real name
// needs true Unicode someday, that is a different, much larger piece of
// work — an embedded CID font, not a tweak to this one.

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

const PAGE_W = 612, PAGE_H = 792, MARGIN = 36;

// lines: [{ text, font: 'R'|'B', size, gap, color, bg, rule }] — 'gap' adds
// extra space ABOVE this line (a blank line would also work but a gap reads
// cleaner in the source that builds these arrays). font/size default to
// R/9. `color`/`bg`/`rule` are each an [r,g,b] triple, 0..1 — `color` is
// the text's own paint, `bg` fills a full-bleed band behind the line, and
// `rule` strokes a thin line just under it.
export function buildMonospacePdf(lines) {
  const usableH = PAGE_H - MARGIN * 2;
  const pages = [];
  let cur = [];
  let used = 0;
  for (const raw of lines || []) {
    const ln = {
      text: raw.text,
      font: raw.font === 'B' ? 'B' : 'R',
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
  const catalogId = 1, pagesId = 2, fontRId = 3, fontBId = 4;
  let nextId = 5;
  const contentIds = [];
  const pageIds = [];

  const rgb3 = (c) => c.map((v) => Number(v.toFixed(3))).join(' ');

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
      const f = ln.font === 'B' ? 'F2' : 'F1';
      if (f !== curFont || ln.size !== curSize) {
        text.push(`/${f} ${ln.size} Tf`);
        curFont = f; curSize = ln.size;
      }
      const col = ln.color || [0, 0, 0];
      if (!curColor || rgb3(col) !== curColor) {
        text.push(`${rgb3(col)} rg`);
        curColor = rgb3(col);
      }
      text.push(`1 0 0 1 ${MARGIN} ${y.toFixed(2)} Tm`);
      text.push(`(${pdfEscape(ln.text)}) Tj`);
    }
    text.push('ET');
    const body = graphics.concat(text).join('\n');
    const contentId = nextId++;
    contentIds.push(contentId);
    objects[contentId - 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  }
  for (let i = 0; i < pages.length; i++) {
    const pageId = nextId++;
    pageIds.push(pageId);
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] `
      + `/Resources << /Font << /F1 ${fontRId} 0 R /F2 ${fontBId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => p + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
  objects[fontRId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  objects[fontBId - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>';

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

  // Every character written above is ASCII (0x20-0x7E, plus the \n/\r we
  // control), so this is safe to base64-encode as a binary string directly.
  return out;
}
