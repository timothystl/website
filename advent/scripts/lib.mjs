// Text cleanup and day detection for the Advent booklet build.
// Pure functions so they can be tested without a PDF.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_ABBR = MONTHS.map((m) => m.slice(0, 3).toLowerCase());

const pad = (n) => String(n).padStart(2, '0');
export const slugFor = (month, day) => `${MON_ABBR[month - 1]}-${day}`;

// "W E E K   O N E" → "Week one". Returns null when the line isn't letter-spaced.
export function collapseSpaced(line) {
  const t = line.trim();
  const words = t.split(/\s{2,}/);
  if (!words.every((w) => /^(\S )+\S$/.test(w))) return null;
  const joined = words.map((w) => w.replace(/ /g, '')).join(' ');
  if (joined.replace(/\s/g, '').length < 3) return null;
  return sentenceCase(joined);
}

export function sentenceCase(s) {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Layout-mode pdftotext output for one page → raw rows (letter-spaced eyebrows collapsed).
export function pageRows(raw) {
  const rows = raw.replace(/\f/g, '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, ''));
  // Drop a lone page number (folio) at the bottom.
  while (rows.length && !rows.at(-1).trim()) rows.pop();
  if (rows.length && /^\s*\d{1,3}\s*$/.test(rows.at(-1))) rows.pop();
  return rows.map((l) => (l.trim() ? collapseSpaced(l) ?? l.trim().replace(/\s{2,}/g, ' ') : ''));
}

// The booklet's text measure: the length of a typical full line of prose.
export function textMeasure(allRows) {
  const lens = allRows.filter(Boolean).map((l) => l.length).sort((a, b) => a - b);
  if (!lens.length) return 60;
  return lens[Math.floor(lens.length * 0.9)] || lens.at(-1);
}

// Clean reading text. Paragraphs are separated by a blank line. A paragraph whose
// lines all fall well short of the measure (a heading, a prayer set line by line)
// keeps its line breaks; prose is rejoined so it can reflow at a larger size.
export function cleanPageText(raw, { measure } = {}) {
  const cleaned = pageRows(raw);
  measure ||= textMeasure(cleaned);
  const paras = [];
  let cur = [];
  for (const l of cleaned) {
    if (!l) { if (cur.length) paras.push(cur); cur = []; continue; }
    cur.push(l);
  }
  if (cur.length) paras.push(cur);
  const out = paras.map((p) => {
    const lineated = Math.max(...p.map((l) => l.length)) < measure * 0.85;
    let s = p[0];
    for (let i = 1; i < p.length; i++) {
      const prev = p[i - 1];
      if (!lineated && /[a-z]-$/.test(prev) && /^[a-z]/.test(p[i])) s = s.slice(0, -1) + p[i];
      else s += (lineated ? '\n' : ' ') + p[i];
    }
    return s;
  });
  return { paragraphs: out, rows: cleaned.filter(Boolean) };
}

// Paragraphs of a devotion's left page that follow the date and title.
export function bodyAfterTitle(paragraphs, label, title) {
  const at = paragraphs.findIndex((p) => p.split('\n')[0].trim() === label);
  const before = at > 0 ? paragraphs.slice(0, at) : [];
  let rest = at >= 0 ? paragraphs.slice(at) : paragraphs.slice();
  const strip = (p, line) => (p.split('\n')[0].trim() === line ? p.split('\n').slice(1).join('\n').trim() : p);
  if (rest.length) rest[0] = strip(rest[0], label);
  if (!rest[0]) rest.shift();
  if (rest.length && title) rest[0] = strip(rest[0], title);
  if (rest.length && !rest[0]) rest.shift();
  return { eyebrow: before, body: rest };
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
export function findExtras(pages, extras = []) {
  const out = [];
  for (const e of extras) {
    if (e.page) { out.push({ label: e.label, page: e.page }); continue; }
    const needle = (e.find || e.label).toLowerCase();
    const p = pages.find((pg) => pg.rows.some((r) => r.toLowerCase().includes(needle)));
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
