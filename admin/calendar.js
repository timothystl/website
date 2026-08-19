// ── THE CHURCH CALENDAR FEED ────────────────────────────────────────────────
// One month of events, assembled from the two Google calendars AND the News &
// Events records, normalized into a single shape and de-duplicated. Served at
// /api/calendar (JSON) and /api/calendar.ics (subscribe).
//
// WHY THIS EXISTS AT ALL. The site used to embed Google's own month view, and
// Google caps how many events a day cell shows before folding the rest into
// "N more" — regardless of how tall the iframe is. On a busy Sunday that hides
// two of three services, which is the one thing a church calendar exists to
// show. Rendering the month ourselves removes the cap; assembling the feed
// ourselves is what lets a News & Events record with a photo and a description
// sit on the same grid as a room booking, without anybody re-typing it into
// Google.
//
// ⚠ EVERY TIME IN THIS FILE IS A CHURCH WALL CLOCK, CARRYING NO TIMEZONE.
// `start` and `end` are local ISO strings — '2026-08-16T08:00:00' — with no Z
// and no offset, deliberately. A church calendar says "8:00 am" and means 8:00
// in St. Louis to every reader, wherever they are; a visitor in Denver must not
// be told the service is at 7. The Worker asks Google for Chicago times and
// keeps the wall-clock digits as text, and the browser slices those digits
// rather than constructing a Date from them. Do not "fix" this by making them
// instants — that is the bug, not the omission.

// ── CATEGORIES ──────────────────────────────────────────────────────────────
// ⚠ A GOOGLE EVENT HAS NO CATEGORY FIELD, so the event's COLOR is the category.
// Whoever enters the event picks a color once in Google and the site draws its
// own palette from it — so ten categories still read as one calendar rather
// than as Google's ten hues. The office-facing version of this table is in
// public/manual.html; if you change a row here, change it there.
//
// The `google` name is the label Google itself shows in its color picker, and
// it is the only thing the office ever sees — which is why it is carried on the
// record rather than left in a comment.
// ⚠ COLORS ARE A PALETTE, NOT A PICKER — the same rule the Appearance screen
// holds the site header to, and for the same reason. A category's color is used
// twice on every chip: as the ink of the time, and as the tint behind it. A free
// hex field is one paste away from a month where nobody can read the times, on a
// page the whole congregation opens. Each pair below was chosen together, and
// `admin/calendar.test.mjs` measures the contrast of every one of them.
export const CALENDAR_PALETTE = [
  { key: 'navy',   name: 'Navy',       color: '#1E2D4A', tint: '#EDF2F7' },
  { key: 'teal',   name: 'Teal',       color: '#2E7EA6', tint: '#E8F1F6' },
  { key: 'moss',   name: 'Moss',       color: '#4A5E3A', tint: '#EDF1E9' },
  { key: 'stone',  name: 'Stone',      color: '#7D7972', tint: '#F1EFEA' },
  { key: 'amber',  name: 'Amber',      color: '#B0821E', tint: '#F8F0DE' },
  { key: 'slate',  name: 'Slate',      color: '#3A4E5C', tint: '#EAEFF2' },
  { key: 'sand',   name: 'Sand',       color: '#8A6E2F', tint: '#F5EFE0' },
  { key: 'plum',   name: 'Plum',       color: '#7A5A7A', tint: '#F2ECF2' },
  { key: 'steel',  name: 'Steel blue', color: '#6A8090', tint: '#EEF2F4' },
  { key: 'gold',   name: 'Gold',       color: '#C9973A', tint: '#FBF1DC' },
  { key: 'brick',  name: 'Brick',      color: '#8C3A28', tint: '#F7E4DE' },
  { key: 'gray',   name: 'Gray',       color: '#8C8880', tint: '#F1EFEA' },
];
export const paletteEntry = (key) =>
  CALENDAR_PALETTE.find((p) => p.key === key) || CALENDAR_PALETTE[CALENDAR_PALETTE.length - 1];

// Google offers eleven event colors and nothing else, so this is the whole set
// the office can choose from when saying which color feeds a category. The
// names are Google's own, because they are the only thing shown in its picker.
export const GOOGLE_COLORS = [
  { id: '1',  name: 'Lavender' }, { id: '2',  name: 'Sage' },
  { id: '3',  name: 'Grape' },    { id: '4',  name: 'Flamingo' },
  { id: '5',  name: 'Banana' },   { id: '6',  name: 'Tangerine' },
  { id: '7',  name: 'Peacock' },  { id: '8',  name: 'Graphite' },
  { id: '9',  name: 'Blueberry' },{ id: '10', name: 'Basil' },
  { id: '11', name: 'Tomato' },
];
export const googleColorName = (id) => (GOOGLE_COLORS.find((g) => g.id === String(id)) || {}).name || '';

// ⚠ THIS IS THE SEED, NOT THE LIVE TABLE. The categories are editable in the
// admin (`calendar_categories`), and everything below reads whatever is stored.
// This list is what the table is seeded with, so the day the screen appears
// nothing on the site moves — and it is what the site falls back to if the
// table cannot be read at all.
export const DEFAULT_CATEGORIES = [
  { key: 'worship',  name: 'Worship',              google: 'Blueberry', colorId: '9',  color: '#1E2D4A', tint: '#EDF2F7' },
  { key: 'learn',    name: 'Learn / Bible study',  google: 'Peacock',   colorId: '7',  color: '#2E7EA6', tint: '#E8F1F6' },
  { key: 'ministry', name: 'Ministry & service',   google: 'Basil',     colorId: '10', color: '#4A5E3A', tint: '#EDF1E9' },
  { key: 'facility', name: 'Facility / rentals',   google: 'Graphite',  colorId: '8',  color: '#7D7972', tint: '#F1EFEA' },
  { key: 'youth',    name: 'Youth & family',       google: 'Tangerine', colorId: '6',  color: '#B0821E', tint: '#F8F0DE' },
  { key: 'wol',      name: 'Word of Life School',  google: 'Sage',      colorId: '2',  color: '#3A4E5C', tint: '#EAEFF2' },
  { key: 'mdo',      name: "Mother's Day Out",     google: 'Banana',    colorId: '5',  color: '#8A6E2F', tint: '#F5EFE0' },
  { key: 'music',    name: 'Music',                google: 'Grape',     colorId: '3',  color: '#7A5A7A', tint: '#F2ECF2' },
  { key: 'meetings', name: 'Meetings',             google: 'Lavender',  colorId: '1',  color: '#6A8090', tint: '#EEF2F4' },
  { key: 'special',  name: 'Special events',       google: 'Tomato',    colorId: '11', color: '#C9973A', tint: '#FBF1DC' },
  // ⚠ THE NEUTRAL CATEGORY IS NOT OPTIONAL. An event whose color nobody set,
  // or set to one this table has no row for (Flamingo), still has to appear on
  // the calendar — a church event silently missing from the church calendar is
  // the worst failure this feature has. It gets a gray chip and says "Other",
  // which reads as unclassified rather than as broken.
  { key: 'other',    name: 'Other',                google: '',          colorId: '',   color: '#8C8880', tint: '#F1EFEA' },
];

export const NEUTRAL_CATEGORY = 'other';

// Kept as an export because plenty of callers only ever want the shipped list.
export const CATEGORIES = DEFAULT_CATEGORIES;

// ── THE LIVE CATEGORY LIST ──────────────────────────────────────────────────
// Stored rows layered onto the seed. A row carries a name, which Google color
// feeds it, which palette swatch it wears, its order, and whether it is in use;
// the color and tint are resolved from the palette here rather than stored, so
// a swatch that is ever adjusted moves every category wearing it.
//
// ⚠ THE NEUTRAL CATEGORY CANNOT BE REMOVED OR RETIRED, whatever the table says.
// An event whose color nobody set — which is most of them — has to land
// somewhere, and a church event silently missing from the church calendar is
// the worst failure this feature has.
export function mergedCategories(rows) {
  const byKey = new Map((rows || []).map((r) => [String(r.key), r]));
  const seeded = DEFAULT_CATEGORIES.map((d, i) => ({ ...d, sort_order: i }));
  const seededKeys = new Set(seeded.map((c) => c.key));
  const extra = (rows || []).filter((r) => !seededKeys.has(String(r.key)))
    .map((r) => ({ key: String(r.key), name: '', google: '', colorId: '', color: '', tint: '', sort_order: 99 }));

  const out = seeded.concat(extra).map((base) => {
    const row = byKey.get(base.key);
    if (!row) return { ...base, active: true };
    const swatch = row.palette ? paletteEntry(row.palette) : null;
    const colorId = row.color_id == null ? base.colorId : String(row.color_id || '');
    return {
      key: base.key,
      name: (row.name || base.name || base.key),
      colorId,
      google: googleColorName(colorId),
      color: swatch ? swatch.color : base.color,
      tint: swatch ? swatch.tint : base.tint,
      palette: row.palette || '',
      sort_order: row.sort_order == null ? base.sort_order : Number(row.sort_order),
      // ⚠ The neutral row is forced active however it is stored.
      active: base.key === NEUTRAL_CATEGORY ? true : row.active !== 0,
    };
  });
  out.sort((a, b) => (a.sort_order - b.sort_order) || a.key.localeCompare(b.key));
  return out;
}

// The list as the public calendar should see it: retired categories gone, but
// never the neutral one.
export function activeCategories(cats) {
  const list = (cats && cats.length ? cats : mergedCategories([]));
  const on = list.filter((c) => c.active !== false);
  return on.some((c) => c.key === NEUTRAL_CATEGORY)
    ? on
    : on.concat(list.filter((c) => c.key === NEUTRAL_CATEGORY));
}

export function categoryFor(colorId, cats) {
  const list = activeCategories(cats);
  const want = String(colorId == null ? '' : colorId);
  if (!want) return NEUTRAL_CATEGORY;
  const hit = list.find((c) => c.colorId && String(c.colorId) === want);
  return hit ? hit.key : NEUTRAL_CATEGORY;
}
export function categoryRecord(key, cats) {
  const list = activeCategories(cats);
  return list.find((c) => c.key === key)
    || list.find((c) => c.key === NEUTRAL_CATEGORY)
    || DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
}

// A News & Events record carries no calendar color. It does carry the four
// values (`value`, the newer chip field, or the older free `theme`), and three
// of those map onto a calendar category cleanly. Anything else is a promoted
// happening with a photo and a description, which is what Special events is.
const NEWS_VALUE_CATEGORY = {
  worship: 'worship',
  education: 'learn',
  'christian education': 'learn',
  outreach: 'ministry',
  acceptance: 'ministry',
};
export function categoryForNews(row, cats) {
  const live = activeCategories(cats);
  // ⚠ WHAT THE OFFICE ACTUALLY SAID WINS. The value-tag guess below only ever
  // reached three of the calendar's categories, so a post could never be
  // marked as a meeting or a rehearsal — it silently became Special events.
  // `calendar_category` is the field that says so outright; blank still falls
  // through to the guess, so every post written before it existed is unmoved.
  const said = String((row && row.calendar_category) || '').trim();
  if (said && live.some((c) => c.key === said)) return said;
  const raw = String((row && (row.value || row.theme)) || '').trim().toLowerCase();
  const want = NEWS_VALUE_CATEGORY[raw] || 'special';
  // ⚠ A category the office has retired must not come back through this door —
  // by either route.
  return live.some((c) => c.key === want) ? want : NEUTRAL_CATEGORY;
}

// ── DATE HELPERS ────────────────────────────────────────────────────────────
// Plain string arithmetic on 'YYYY-MM-DD'. Deliberately not Date maths: a Date
// built from a bare date string is UTC midnight, and every "+1 day" done that
// way is one DST changeover away from landing on the wrong date. See the
// churchDatePlus() note in admin/when.js for the same lesson learned the hard
// way.
export function addDays(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const out = new Date(t);
  return `${out.getUTCFullYear()}-${String(out.getUTCMonth() + 1).padStart(2, '0')}-${String(out.getUTCDate()).padStart(2, '0')}`;
}
// [year, month] shifted by n months, month staying 1-12. Returned as a pair so
// it spreads straight into monthRange().
export function shiftMonth(year, month, n) {
  const zero = (year * 12) + (month - 1) + n;
  return [Math.floor(zero / 12), (zero % 12) + 1];
}
export function monthRange(year, month) { // month is 1-12
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const days  = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: first, to: `${year}-${String(month).padStart(2, '0')}-${String(days).padStart(2, '0')}` };
}
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// ── NORMALIZING ─────────────────────────────────────────────────────────────
// ⚠ `end` ON AN ALL-DAY EVENT IS MADE INCLUSIVE HERE, and Google's is not.
// Google reports a one-day all-day event as start 08-16 / end 08-17, which is
// the classic exclusive-end that puts every multi-day event on one day too
// many. Fixing it once, at the boundary, is why nothing downstream — not the
// grid, not the print sheet, not the list — has to know about it. The .ics
// writer puts the exclusive day back, because that is what the format wants.
export function normalizeGoogleEvent(ev, sourceLabel = 'gcal', cats) {
  if (!ev || ev.status === 'cancelled') return null;
  const title = String(ev.summary || '').trim() || 'Untitled event';
  const s = ev.start || {}, e = ev.end || {};
  if (s.date) {
    if (!isYmd(s.date)) return null;
    const endExclusive = isYmd(e.date) ? e.date : addDays(s.date, 1);
    return {
      id: `g:${ev.id || s.date + title}`,
      start: s.date, end: addDays(endExclusive, -1), allDay: true,
      title, location: String(ev.location || '').trim(),
      description: plainText(ev.description || ''),
      category: categoryFor(ev.colorId, cats), source: sourceLabel,
    };
  }
  const start = wallClock(s.dateTime);
  if (!start) return null;
  return {
    id: `g:${ev.id || start + title}`,
    start, end: wallClock(e.dateTime) || start, allDay: false,
    title, location: String(ev.location || '').trim(),
    description: plainText(ev.description || ''),
    category: categoryFor(ev.colorId, cats), source: sourceLabel,
  };
}

// '2026-08-16T08:00:00-05:00' → '2026-08-16T08:00:00'. The offset is dropped
// rather than applied: we asked Google for Chicago times, so the digits in
// front of it already ARE the church's wall clock. See the file header.
export function wallClock(dt) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(dt || ''));
  return m ? `${m[1]}T${m[2]}:${m[3]}:00` : null;
}

// A News body is admin-authored HTML. It is shown in a detail panel as text,
// never as markup, so it is flattened here rather than sanitized — there is no
// case for a heading or an image inside a calendar event's description.
export function plainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// A News & Events record becomes an entry on its event date.
//
// It used to be all-day always, because the record genuinely had no time
// column — and that was the reason the newsletter kept its own separate event
// rows: a 7:00 pm council meeting could be typed into an email and could not
// be said here at all. `event_time` is that column, so a post entered once is
// now a complete event and the newsletter has nothing left to retype.
//
// ⚠ THE TIME IS A CHURCH WALL CLOCK, like every other time in this file, and
// it is assembled by CONCATENATION rather than by any date arithmetic. The
// column holds exactly what an <input type="time"> posts — `19:00` — so the
// event starts at 19:00 in St. Louis whoever is reading it.
//
// ⚠ A BLANK TIME IS STILL ALL DAY, not midnight. `19:00` and `` are different
// facts, and reading the second as `00:00` would put every dateless-but-timed
// announcement at the top of the day looking deliberate.
export function normalizeNewsItem(row, cats) {
  if (!row || !isYmd(row.event_date)) return null;
  const title = String(row.title || '').trim();
  if (!title) return null;
  const start = clockOnDay(row.event_date, row.event_time);
  // A run of days — a break, a camp, an assessment week. Anything earlier than
  // the start, or not a date at all, is ignored rather than honored: an end
  // BEFORE a beginning is a typo, and drawing it would take the event off the
  // month entirely, which is the one failure this feed must not have.
  const lastDay = isYmd(row.event_end_date) && row.event_end_date > row.event_date
    ? row.event_end_date : row.event_date;
  const base = {
    id: `n:${row.id}`,
    title, location: String(row.event_location || '').trim(),
    description: plainText(row.summary || row.body || ''),
    category: categoryForNews(row, cats), source: 'news',
    url: '/news',
  };
  if (!start) return { ...base, start: row.event_date, end: lastDay, allDay: true };
  return { ...base, start, end: newsEnd(row.event_date, lastDay, start, row.event_end_time), allDay: false };
}

// `HH:MM` on a date, as a wall clock. Anything that is not a real time of day
// — blank, `25:00`, whatever a stale form posts — is no time at all rather
// than a guess, which is what sends the record back to being all-day.
export function clockOnDay(ymd, hm) {
  const t = normalizeClock(hm);
  return t ? `${ymd}T${t}:00` : null;
}

// `HH:MM`, or null. Exported because the save path needs the same answer the
// renderer does — a value the calendar would ignore must not be STORED either,
// or the form comes back showing a time the month does not show.
export function normalizeClock(hm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(String(hm || '').trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

// ⚠ AN END TIME IS OPTIONAL AND A DERIVED ONE IS NEVER SHOWN.
//
// The screen prints the START and nothing else — `tlcCalTime()` reads
// `ev.start` and has no branch for an end — so a derived end cannot make the
// page claim a duration nobody entered. But `.ics` has no way to express "it
// starts at 7 and we did not say when it stops": DTEND equal to DTSTART is a
// zero-length event, which a calendar app draws as a hairline somebody's eye
// slides straight past. So an unstated end becomes one hour, the same
// assumption every calendar app makes when you type a start and stop.
//
// ⚠ AND IT IS CLAMPED TO THE SAME DAY. `tlcCalDates()` walks from the start
// date to the END date inclusive, so a 11:30 pm event given a naive +1 hour
// would be drawn on two days — tomorrow's grid growing an event that finished
// before anybody woke up.
export function newsEnd(ymd, lastDay, start, endTime) {
  const stated = clockOnDay(lastDay, endTime);
  if (stated && stated > start) return stated;
  // A run of days with a start time but no end time finishes at the end of its
  // last day, rather than an hour after it began on the first one.
  if (lastDay !== ymd) return `${lastDay}T23:59:00`;
  const m = /T(\d{2}):(\d{2})/.exec(start);
  const h = Number(m[1]);
  if (h >= 23) return `${ymd}T23:59:00`;
  return `${ymd}T${String(h + 1).padStart(2, '0')}:${m[2]}:00`;
}

// ── DE-DUPE ─────────────────────────────────────────────────────────────────
// The same happening is routinely in both places: Google holds the room-and-
// time booking, the News record holds the description, the photo and the
// sign-up. Shown twice it reads as two events.
//
// ⚠ THE NEWS RECORD WINS, and that is the whole point of the rule — it carries
// the richer copy. But it keeps the GOOGLE START TIME when Google had one,
// because a News record has no time of day at all: collapsing to the News
// record alone would turn "8:00 am Rally Day" into a shapeless all-day chip.
// The News record wins the words; Google wins the clock.
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const minutesOf = (iso) => {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const dayOf = (iso) => String(iso || '').slice(0, 10);

// ⚠ WHICH ENTRY WINS THE WORDS, when the same happening is in more than one
// place. A News record is the richest — it has the description, the photo and
// the sign-up — then a building booking, which at least knows it is a booking,
// then Google. The CLOCK is a separate question and is answered below.
const SOURCE_RANK = { news: 3, building: 2, gcal: 1, both: 0 };
const rankOf = (e) => SOURCE_RANK[e.source] || 0;

export function dedupeEvents(events) {
  const out = [];
  for (const ev of events) {
    const hit = out.findIndex((o) => {
      if (o.source === ev.source) return false;
      if (norm(o.title) !== norm(ev.title)) return false;
      if (dayOf(o.start) !== dayOf(ev.start)) return false;
      const a = minutesOf(o.start), b = minutesOf(ev.start);
      // One of the pair being all-day is the ordinary case (a News record
      // always is), and same-day is as close as it can get. Only when BOTH
      // carry a clock is the 30-minute window meaningful.
      if (a == null || b == null) return true;
      return Math.abs(a - b) <= 30;
    });
    if (hit === -1) { out.push(ev); continue; }
    const kept = out[hit];
    // The richer record wins the words...
    const rich = rankOf(ev) > rankOf(kept) ? ev : kept;
    const other = rich === kept ? ev : kept;
    // ...and whichever one actually carries a clock wins the time. ⚠ THIS IS
    // THE HALF THAT IS EASY TO GET BACKWARDS. A News record has no time column
    // at all, so collapsing to it alone turns a 9:30 service into a shapeless
    // all-day chip. Written as "prefer the timed entry" rather than "Google
    // wins", so it still holds now that a third source exists.
    const timed = !rich.allDay ? rich : (!other.allDay ? other : rich);
    out[hit] = {
      ...rich,
      start: timed.start,
      end: timed.end,
      allDay: rich.allDay && other.allDay,
      location: rich.location || other.location,
      description: rich.description || other.description,
      // The merged entry genuinely is in more than one place, and the source
      // swatch on the chip should say so rather than picking a winner.
      source: 'both',
    };
  }
  return out;
}

export function sortEvents(events) {
  return events.slice().sort((a, b) => {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    // All-day first within a day: it is the heading for the day, not an item
    // wedged between two timed things.
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  });
}

// ── THE .ICS FEED ───────────────────────────────────────────────────────────
// What the Subscribe button hands a calendar app. It is the merged feed, so
// somebody subscribing gets the News & Events entries too — which is the whole
// reason to offer our own rather than linking at Google's.
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (iso) => String(iso).replace(/[-:]/g, '');

// ⚠ RFC 5545 CAPS A LINE AT 75 OCTETS and a calendar app is entitled to reject
// a longer one outright — an event with a real description is well past that.
// Folded on OCTETS rather than characters, because a multi-byte character split
// down the middle is a corrupt file rather than a long line.
export function foldIcsLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let i = 0, limit = 75;
  while (i < bytes.length) {
    let take = Math.min(limit, bytes.length - i);
    // Never cut inside a UTF-8 sequence: back off while the next byte is a
    // continuation byte (10xxxxxx).
    while (take > 0 && i + take < bytes.length && (bytes[i + take] & 0xC0) === 0x80) take--;
    out.push((out.length ? ' ' : '') + new TextDecoder().decode(bytes.slice(i, i + take)));
    i += take; limit = 74;
  }
  return out.join('\r\n');
}

export function buildIcs(events, { name = 'Timothy Lutheran Church', tz = 'America/Chicago', cats } = {}) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Timothy Lutheran Church//Calendar//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(name)}`, `X-WR-TIMEZONE:${tz}`,
  ];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${icsEsc(ev.id)}@timothystl.org`);
    // A feed with no DTSTAMP is one some readers refuse. It is the moment the
    // feed was produced, which genuinely is an instant, so it is UTC — unlike
    // everything else in this file.
    lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`);
    if (ev.allDay) {
      // The inclusive end normalizeGoogleEvent() produced goes back to being
      // exclusive, because that is what the format means by DTEND.
      lines.push(`DTSTART;VALUE=DATE:${stamp(ev.start)}`);
      lines.push(`DTEND;VALUE=DATE:${stamp(addDays(ev.end, 1))}`);
    } else {
      lines.push(`DTSTART;TZID=${tz}:${stamp(ev.start)}`);
      lines.push(`DTEND;TZID=${tz}:${stamp(ev.end || ev.start)}`);
    }
    lines.push(`SUMMARY:${icsEsc(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${icsEsc(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${icsEsc(ev.description)}`);
    lines.push(`CATEGORIES:${icsEsc(categoryRecord(ev.category, cats).name)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

// ── SUBSCRIBING TO PART OF IT ───────────────────────────────────────────────
// ⚠ THE WHOLE POINT OF THE FILTER IS THAT A SUBSCRIPTION IS NOT A PAGE. A
// visitor clicking a pill is looking at one thing for a moment; somebody
// subscribing is deciding what appears in their own calendar every day for
// years. A hundred school dates and every building rental crowding out a
// personal calendar is exactly what stops people subscribing at all — and
// then they go back to being told things by hand, which is the problem the
// whole calendar exists to solve.
//
// ⚠ AN ABSENT FILTER MEANS EVERYTHING, and an unrecognized one is dropped
// rather than treated as a category nothing matches. A subscription that
// silently returns an empty file because a category was renamed is one
// somebody's calendar quietly stops updating from, with nothing to see.
export function parseFilterList(raw) {
  return String(raw || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function filterEvents(events, { cats: wantCats, sources: wantSources } = {}) {
  const c = (wantCats || []).length ? new Set(wantCats) : null;
  const s = (wantSources || []).length ? new Set(wantSources) : null;
  return events.filter((ev) => {
    if (c && !c.has(ev.category)) return false;
    // `both` is one happening that is in two places, not a third source, so it
    // answers to either of the sources it came from rather than falling out of
    // each — the same rule the page's own source pills follow.
    if (s && !(s.has(ev.source) || (ev.source === 'both' && (s.has('gcal') || s.has('news'))))) return false;
    return true;
  });
}

// What a calendar app will call it in somebody's sidebar. A filtered feed says
// what is in it, because "Timothy Lutheran Church" appearing twice with
// different contents is the thing that makes people unsubscribe from both.
export function feedName(wantCats, cats, base = 'Timothy Lutheran Church') {
  const list = wantCats || [];
  if (!list.length || list.length >= activeCategories(cats).length) return base;
  const names = list.map((k) => categoryRecord(k, cats).name);
  return `${base} — ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
}

// ── WHICH CALENDARS ─────────────────────────────────────────────────────────
// The two ids that were hardcoded in the old embed URL. They are a setting now
// (`calendar_google_ids`) so adding the school's calendar is not a deploy, and
// these are the seeded default so nothing has to be typed for the site to work
// exactly as it did.
export const DEFAULT_CALENDAR_IDS = [
  'calendar@timothystl.org',
  'c_7f6d3db77b48c01af48592e21b2743d22fdf2b221d9d3c4e0c02680b73b89041@group.calendar.google.com',
];
export function parseCalendarIds(setting) {
  const list = String(setting || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CALENDAR_IDS.slice();
}

// ── READING GOOGLE ──────────────────────────────────────────────────────────
// Two credential paths, tried in that order, and the site works with either:
//
//   1. The service account already configured for gym bookings
//      (GCAL_SERVICE_ACCOUNT_EMAIL / GCAL_PRIVATE_KEY). Needs each calendar
//      shared with that account as "See all event details".
//   2. A plain API key (GCAL_API_KEY). Works on a PUBLIC calendar with nothing
//      shared with anybody, which is what these two already are.
//
// ⚠ Neither being set is a normal state, not an error to shout about: the feed
// then carries the News & Events records alone and says so in `sources`, and
// the page shows a line offering Google Calendar directly. A church calendar
// that renders half its events and admits it beats one that renders none.
//
// ⚠ `singleEvents=true` IS LOAD-BEARING AND MUST NOT BE REMOVED. Without it a
// weekly service comes back as one event carrying an RRULE, and every Sunday
// but the first vanishes from the grid. Expanding recurrence ourselves is a
// project; asking Google to do it is a query parameter.
export async function fetchGoogleEvents(env, { ids, from, to, getToken, cats }) {
  const key = String(env.GCAL_API_KEY || '').trim();
  let token = null;
  if (typeof getToken === 'function') {
    try { token = await getToken(env, 'https://www.googleapis.com/auth/calendar.readonly'); } catch (_) { token = null; }
  }
  if (!token && !key) return { events: [], ok: false, reason: 'unconfigured' };

  const results = await Promise.all(ids.map(async (id) => {
    const q = new URLSearchParams({
      singleEvents: 'true', orderBy: 'startTime', maxResults: '500',
      timeZone: 'America/Chicago',
      // The window is padded a day either side so a multi-day event that
      // started before the month still lands on the grid's leading days.
      timeMin: `${addDays(from, -1)}T00:00:00Z`,
      timeMax: `${addDays(to, 2)}T00:00:00Z`,
    });
    if (!token && key) q.set('key', key);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${q}`;
    try {
      const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      if (!res.ok) return null;
      const body = await res.json();
      return (body.items || [])
        .map((ev) => normalizeGoogleEvent(ev, 'gcal', cats))
        .filter(Boolean)
        // ⚠ A GYM BOOKING PUSHED TO GOOGLE IS DROPPED HERE, and this is a
        // privacy rule rather than a de-dupe. addGymBookingToGCal() writes
        // "Gym Rental — <group name>" into whichever calendar the gym is
        // configured to write to; if that calendar is ever added to the public
        // list, every renter's name lands on the church's public calendar. The
        // same booking is served from the booking table instead, under a name
        // that says the building is in use and nothing else.
        .filter((e) => !/^gym rental\s*[—-]/i.test(e.title));
    } catch (_) { return null; }
  }));

  // ⚠ One calendar failing must not discard the one that answered. A partly
  // read feed is reported as not-ok so the page can say a calendar is missing,
  // and still carries everything it did get.
  const ok = results.every((r) => r !== null);
  return { events: results.filter(Boolean).flat(), ok, reason: ok ? '' : 'partial' };
}

// ── THE FEED ────────────────────────────────────────────────────────────────
// Everything above, assembled. Returns the payload /api/calendar serves.
export async function buildCalendarFeed(env, { from, to, getToken, calendarIds, cats }) {
  const [google, news, building] = await Promise.all([
    fetchGoogleEvents(env, { ids: calendarIds, from, to, getToken, cats }),
    readNewsEvents(env, from, to, cats),
    readGymBookings(env, from, to),
  ]);
  const merged = sortEvents(dedupeEvents(sortEvents(google.events.concat(news, building))));
  // Trimmed to the requested window AFTER the merge, so an event that reaches
  // into the window from outside it is kept while one that only touched the
  // padding is not.
  const inWindow = merged.filter((ev) => dayOf(ev.end || ev.start) >= from && dayOf(ev.start) <= to);
  return {
    from, to,
    events: inWindow,
    categories: activeCategories(cats),
    sources: { google: google.ok, news: true, building: true, googleReason: google.reason },
  };
}

// Only records carrying an event date are events; a post about a sermon series
// is news and belongs on /news, not on a day of the month. Unlike /api/news
// this deliberately does NOT filter to future dates — a calendar showing last
// month has to show what happened in it.
export async function readNewsEvents(env, from, to, cats) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, title, summary, body, event_date, event_end_date, event_time, event_end_time,
              event_location, publish_date, theme, value, calendar_category
         FROM news_items
        WHERE event_date IS NOT NULL AND event_date >= ? AND event_date <= ?
          AND (channels IS NULL OR channels LIKE '%web%' OR channels LIKE '%calendar%')
        ORDER BY event_date ASC
        LIMIT 300`
    ).bind(addDays(from, -1), addDays(to, 1)).all();
    return (rows.results || []).map((r) => normalizeNewsItem(r, cats)).filter(Boolean);
  } catch (_) { return []; }
}

// ── BUILDING RENTALS ────────────────────────────────────────────────────────
// The gym bookings the office already takes, read straight from the booking
// table rather than from the Google calendar the gym pushes to. Two reasons
// that is the right source: the push is best-effort and silently does nothing
// when the service account is not configured, and it did not exist when the
// earliest bookings were taken — so the table is the only place that has all
// of them.
//
// ⚠ THE RENTER IS NEVER NAMED. `gym_groups.name` is not read and not joined.
// A visitor checking whether the gym is free needs the time, not who booked
// it, and this is a public page — the entry says the building is in use and
// stops there. The office sees the group, the rate and the invoice on the Gym
// Rentals screen, which is where that belongs.
//
// ⚠ AND `notes` IS NEVER READ EITHER. It is typed by the renter, and it is the
// field the July 2026 review found being rendered unescaped into staff email
// (GY-2). It has no business on a public calendar at all.
export const BUILDING_IN_USE = 'Building in use';

export async function readGymBookings(env, from, to) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, booking_date, start_time, end_time
         FROM gym_bookings
        WHERE status = 'confirmed' AND booking_date >= ? AND booking_date <= ?
        ORDER BY booking_date ASC, start_time ASC
        LIMIT 400`
    ).bind(from, to).all();
    return (rows.results || []).map(normalizeGymBooking).filter(Boolean);
  } catch (_) { return []; }
}

// A booking is a wall clock like everything else here — `HH:MM` as the office
// typed it, on the date they picked, carried through as text.
export function normalizeGymBooking(row) {
  if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.booking_date || ''))) return null;
  const hhmm = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : null;
  };
  const start = hhmm(row.start_time);
  if (!start) return null;
  const end = hhmm(row.end_time) || start;
  return {
    id: `b:${row.id}`,
    start: `${row.booking_date}T${start}:00`,
    end: `${row.booking_date}T${end}:00`,
    allDay: false,
    title: BUILDING_IN_USE,
    location: '', description: '',
    category: 'facility',
    source: 'building',
  };
}
