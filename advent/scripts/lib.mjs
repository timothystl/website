// Text cleanup and day detection for the Advent booklet build.
// Pure functions so they can be tested without a PDF.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_ABBR = MONTHS.map((m) => m.slice(0, 3).toLowerCase());

const pad = (n) => String(n).padStart(2, '0');
export const slugFor = (month, day) => `${MON_ABBR[month - 1]}-${day}`;

// "W E E K   T W O   ·   L I F T E D" → "Week two · Lifted". Null when the line isn't letter-spaced.
export function collapseSpaced(line) {
  const t = line.trim();
  const words = t.split(/\s{2,}/);
  if (words.length < 2 && !/^(\S ){2,}\S$/.test(t)) return null;
  if (!words.every((w) => /^\S( \S)*$/.test(w))) return null;
  const joined = words.map((w) => w.replace(/ /g, '')).join(' ');
  if (joined.replace(/[\s·•|–—-]/g, '').length < 3) return null;
  return sentenceCase(joined);
}

// ALL CAPS → sentence case; each part after a "·" separator starts a new sentence.
export function sentenceCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(/(\s*[·•|]\s*)/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

const decode = (s) => s.replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// pdftohtml -xml → for each page, its text lines in reading (content) order:
// { [n]: { width, height, lines: [{ top, left, width, size, text }] } }
// Pieces that sit on the same baseline are joined into one line. The page number
// (folio) at the top or bottom margin is dropped.
export function parsePdfXml(xml) {
  const fonts = {};
  for (const f of xml.matchAll(/<fontspec id="(\d+)" size="([\d.]+)"/g)) fonts[f[1]] = +f[2];
  const out = {};
  for (const pm of xml.matchAll(/<page number="(\d+)"[^>]*height="([\d.]+)" width="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)) {
    const H = +pm[2];
    const lines = [];
    let cur = null;
    for (const t of pm[4].matchAll(/<text top="(-?[\d.]+)" left="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)" font="(\d+)">([\s\S]*?)<\/text>/g)) {
      const item = { top: +t[1], left: +t[2], width: +t[3], height: +t[4], size: fonts[t[5]] || +t[4], text: decode(t[6]) };
      if (!item.text.trim()) continue;
      const sameLine = cur && Math.abs(item.top - cur.top) <= Math.max(3, item.height * 0.4)
        && item.left >= cur.left + cur.width - 3;
      if (sameLine) {
        const gap = item.left - (cur.left + cur.width);
        cur.text += (gap > 1.5 && !/\s$/.test(cur.text) && !/^\s/.test(item.text) ? ' ' : '') + item.text;
        cur.width = item.left + item.width - cur.left;
        cur.size = Math.max(cur.size, item.size);
      } else {
        cur = { ...item };
        lines.push(cur);
      }
    }
    for (const l of lines) {
      const c = collapseSpaced(l.text);
      l.wasSpaced = c !== null;
      l.text = c ?? l.text.replace(/\s+/g, ' ').trim();
    }
    const kept = lines.filter((l) => !(/^\d{1,3}$/.test(l.text) && (l.top > H * 0.88 || l.top < H * 0.06)));
    out[+pm[1]] = { width: +pm[3], height: H, lines: kept };
  }
  return out;
}

// Typical body type size and full-line width across the booklet.
export function bookMetrics(pagesXml) {
  const bySize = new Map();
  const all = Object.values(pagesXml).flatMap((p) => p.lines);
  for (const l of all) bySize.set(l.size, (bySize.get(l.size) || 0) + l.text.length);
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  const widths = all.filter((l) => Math.abs(l.size - body) < 0.6).map((l) => l.width).sort((a, b) => a - b);
  const measure = widths[Math.floor(widths.length * 0.9)] || 300;
  return { body, measure };
}

// One page's lines → reading blocks: { k: 'h' (heading) | 'e' (eyebrow) | 'p', t: text }.
// A new block starts at a larger-than-line gap, a change of type size, or a jump back
// up the page (the next column). Prose is rejoined so it reflows; a block whose lines
// all stop well short of the measure (a prayer or liturgy) keeps its line breaks.
export function pageBlocks(page, { body, measure }) {
  if (!page) return [];
  const groups = [];
  let g = null;
  for (const l of page.lines) {
    const prev = g && g.at(-1);
    const split = !prev
      || Math.abs(l.size - prev.size) > 0.6
      || (l.top < prev.top - 2 || Math.abs(l.left - prev.left) > 40 && l.top - prev.top > prev.size * 0.5)
        // a new column — unless a sentence carries over into it
        && !(/[^.!?:;”"’)]$/.test(prev.text) && /^[a-z]/.test(l.text))
      || l.top - prev.top > Math.max(prev.size, l.size) * 1.45;
    if (split) { g = [l]; groups.push(g); } else g.push(l);
  }
  return groups.map((ls) => {
    const size = ls[0].size;
    const spaced = ls.length === 1 && ls[0].wasSpaced;
    const lineated = ls.length > 1 && Math.max(...ls.map((l) => l.width)) < measure * 0.8;
    let t = ls[0].text;
    for (let i = 1; i < ls.length; i++) {
      const prev = ls[i - 1].text;
      if (!lineated && /[a-z]-$/.test(prev) && /^[a-z]/.test(ls[i].text)) t = t.slice(0, -1) + ls[i].text;
      else t += (lineated ? '\n' : ' ') + ls[i].text;
    }
    const k = size >= body * 1.35 ? 'h' : spaced || (size < body * 0.8 && /^[A-Z0-9 ·•|’'–—-]+$/.test(t) && t.length < 60) ? 'e' : 'p';
    return { k, t: k === 'e' ? sentenceCase(t) : t };
  });
}

// The blocks of a devotion's left page that follow the date and title, plus any eyebrow above.
export function bodyAfterTitle(blocks, label, title) {
  const at = blocks.findIndex((b) => b.t.split('\n').some((l) => l.trim() === label));
  if (at < 0) return { eyebrow: [], body: blocks.filter((b) => b.t !== title) };
  const eyebrow = blocks.slice(0, at);
  const rest = blocks.slice(at);
  // The date (and the title, if it shares the date's block) come off the front.
  const lines = rest[0].t.split('\n');
  const after = lines.slice(lines.findIndex((l) => l.trim() === label) + 1).filter((l) => l.trim() !== title);
  if (after.length) rest[0] = { ...rest[0], t: after.join('\n') }; else rest.shift();
  if (rest.length && title && rest[0].t.trim() === title) rest.shift();
  return { eyebrow, body: rest };
}

const DATE_RE = new RegExp(
  `^(${WEEKDAYS.join('|')}),?\\s+(${MONTHS.join('|')}|Nov\\.?|Dec\\.?)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\.?$`, 'i');

export function parseDateLine(line) {
  const m = DATE_RE.exec(line.trim());
  if (!m) return null;
  const wd = WEEKDAYS.findIndex((w) => w.toLowerCase() === m[1].toLowerCase());
  const mo = MON_ABBR.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
  return { weekday: wd, month: mo, day: Number(m[3]) };
}

// Every day from first (e.g. "11-29") through last ("12-25"), month/day only.
export function dayRange(first = '11-29', last = '12-25') {
  const out = [];
  const d = new Date(Date.UTC(2001, Number(first.slice(0, 2)) - 1, Number(first.slice(3))));
  const end = new Date(Date.UTC(2001, Number(last.slice(0, 2)) - 1, Number(last.slice(3))));
  while (d <= end) {
    out.push({ month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

// pages: [{ n, rows }] → { days, missing, problems, year }
export function extractDays(pages, { overrides = {}, year: fixedYear, first, last } = {}) {
  const range = dayRange(first, last);
  const found = new Map(); // slug → [{ page, row, parsed, title }]
  for (const p of pages) {
    const hits = [];
    p.rows.forEach((row, i) => {
      const parsed = parseDateLine(row);
      if (parsed) hits.push({ parsed, i });
    });
    // A page that lists several dates is a schedule (midweek services), not a devotion.
    const distinct = new Set(hits.map((h) => `${h.parsed.month}-${h.parsed.day}`));
    for (const h of hits) {
      const slug = slugFor(h.parsed.month, h.parsed.day);
      const title = p.rows.slice(h.i + 1).find((r) => !parseDateLine(r)) || '';
      const entry = { page: p.n, row: h.i, parsed: h.parsed, title, schedule: distinct.size > 1 };
      if (!found.has(slug)) found.set(slug, []);
      found.get(slug).push(entry);
    }
  }

  // Year: the configured one, else the year in which every found weekday is right.
  const parsedAll = [...found.values()].flat().filter((e) => !e.schedule).map((e) => e.parsed);
  let year = fixedYear;
  if (!year) {
    const now = new Date().getUTCFullYear();
    let best = { y: now, score: -1 };
    for (let y = now - 3; y <= now + 6; y++) {
      const score = parsedAll.filter((p) => weekdayOf(y, p.month, p.day) === p.weekday).length;
      if (score > best.score || (score === best.score && Math.abs(y - now) < Math.abs(best.y - now))) best = { y, score };
    }
    year = best.y;
  }

  const days = [];
  const missing = [];
  const problems = [];
  const oDays = overrides.days || {};
  for (const { month, day } of range) {
    const slug = slugFor(month, day);
    const label = `${WEEKDAYS[weekdayOf(year, month, day)]}, ${MONTHS[month - 1]} ${day}`;
    const date = `${year}-${pad(month)}-${pad(day)}`;
    const o = oDays[slug] || {};
    let page = o.page;
    let title = o.title;
    if (!page) {
      const all = found.get(slug) || [];
      const cands = all.filter((c) => !c.schedule);
      if (cands.length === 1) {
        page = cands[0].page;
        title ??= cands[0].title;
        if (cands[0].parsed.weekday !== weekdayOf(year, month, day)) {
          problems.push(`Page ${page} says "${WEEKDAYS[cands[0].parsed.weekday]}" for ${MONTHS[month - 1]} ${day}, but that date is a ${WEEKDAYS[weekdayOf(year, month, day)]} in ${year}. Check the booklet or set "year" in booklet.config.json.`);
        }
      } else if (cands.length > 1) {
        problems.push(`${label} appears as a date line on more than one page (${cands.map((c) => c.page).join(', ')}). Pin the right one in source/overrides.json.`);
        continue;
      } else {
        missing.push(all.length ? `${label} (only seen on page ${all.map((c) => c.page).join(', ')}, which lists several dates)` : label);
        continue;
      }
    }
    days.push({ slug, date, label, title: (title || '').trim(), page });
  }
  return { days, missing, problems, year };
}

// Contents entries such as "How to use this devotional": first page whose text contains `find`.
export function findExtras(pages, extras = [], skip = new Set()) {
  const out = [];
  for (const e of extras) {
    if (e.page) { out.push({ label: e.label, page: e.page }); continue; }
    const needle = (e.find || e.label).toLowerCase();
    const p = pages.find((pg) => !skip.has(pg.n) && pg.rows.some((r) => r.toLowerCase().includes(needle)));
    if (p) out.push({ label: e.label, page: p.n, ...(e.position ? { position: e.position } : {}) });
  }
  return out;
}

// ── Artwork ──────────────────────────────────────────────────────────────────
// pdftohtml -xml output → { [pageNumber]: { width, height, boxes: [{ top, left, width, height }] } }
export function parseImageBoxes(xml) {
  const out = {};
  const pageRe = /<page number="(\d+)"[^>]*height="([\d.]+)" width="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g;
  let pm;
  while ((pm = pageRe.exec(xml))) {
    const boxes = [];
    const imgRe = /<image top="(-?[\d.]+)" left="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
    let im;
    while ((im = imgRe.exec(pm[4]))) boxes.push({ top: +im[1], left: +im[2], width: +im[3], height: +im[4] });
    out[+pm[1]] = { width: +pm[3], height: +pm[2], boxes };
  }
  return out;
}

// The artwork regions on one page: images big enough to be art (not ornaments),
// clipped to the page, with overlapping or touching pieces merged into one.
// An image that fills nearly the whole page means the page itself is the art.
export function artRegions(info) {
  if (!info) return { regions: [], fullPage: false };
  const { width: W, height: H } = info;
  let boxes = info.boxes.map((b) => {
    const x0 = Math.max(0, b.left), y0 = Math.max(0, b.top);
    const x1 = Math.min(W, b.left + b.width), y1 = Math.min(H, b.top + b.height);
    return { x0, y0, x1, y1 };
  }).filter((b) => b.x1 - b.x0 >= W * 0.15 && b.y1 - b.y0 >= H * 0.08 && (b.x1 - b.x0) * (b.y1 - b.y0) >= W * H * 0.04);
  const GAP = 4;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.x0 <= b.x1 + GAP && b.x0 <= a.x1 + GAP && a.y0 <= b.y1 + GAP && b.y0 <= a.y1 + GAP) {
          boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  if (boxes.some((b) => (b.x1 - b.x0) * (b.y1 - b.y0) >= W * H * 0.85)) return { regions: [], fullPage: true };
  boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return { regions: boxes.map((b) => ({ left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 })), fullPage: false };
}
