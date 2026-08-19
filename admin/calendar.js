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
export const CATEGORIES = [
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

const BY_COLOR_ID = Object.fromEntries(
  CATEGORIES.filter((c) => c.colorId).map((c) => [c.colorId, c.key])
);
const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export function categoryFor(colorId) {
  return BY_COLOR_ID[String(colorId == null ? '' : colorId)] || NEUTRAL_CATEGORY;
}
export function categoryRecord(key) {
  return BY_KEY[key] || BY_KEY[NEUTRAL_CATEGORY];
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
export function categoryForNews(row) {
  const raw = String((row && (row.value || row.theme)) || '').trim().toLowerCase();
  return NEWS_VALUE_CATEGORY[raw] || 'special';
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
export function normalizeGoogleEvent(ev, sourceLabel = 'gcal') {
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
      category: categoryFor(ev.colorId), source: sourceLabel,
    };
  }
  const start = wallClock(s.dateTime);
  if (!start) return null;
  return {
    id: `g:${ev.id || start + title}`,
    start, end: wallClock(e.dateTime) || start, allDay: false,
    title, location: String(ev.location || '').trim(),
    description: plainText(ev.description || ''),
    category: categoryFor(ev.colorId), source: sourceLabel,
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

// A News & Events record becomes an all-day entry on its event date. It has no
// time column and no location column, and inventing either would be worse than
// the honest all-day chip: "sometime that day" is exactly what the record says.
export function normalizeNewsItem(row) {
  if (!row || !isYmd(row.event_date)) return null;
  const title = String(row.title || '').trim();
  if (!title) return null;
  return {
    id: `n:${row.id}`,
    start: row.event_date, end: row.event_date, allDay: true,
    title, location: '',
    description: plainText(row.summary || row.body || ''),
    category: categoryForNews(row), source: 'news',
    url: '/news',
  };
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
    const news = kept.source === 'news' ? kept : ev;
    const gcal = kept.source === 'news' ? ev : kept;
    out[hit] = {
      ...news,
      start: gcal.allDay ? news.start : gcal.start,
      end:   gcal.allDay ? news.end   : gcal.end,
      allDay: news.allDay && gcal.allDay,
      location: news.location || gcal.location,
      description: news.description || gcal.description,
      // The merged entry genuinely is in both places, and the source swatch on
      // the chip should say so rather than picking a winner.
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

export function buildIcs(events, { name = 'Timothy Lutheran Church', tz = 'America/Chicago' } = {}) {
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
    lines.push(`CATEGORIES:${icsEsc(categoryRecord(ev.category).name)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
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
export async function fetchGoogleEvents(env, { ids, from, to, getToken }) {
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
      return (body.items || []).map((ev) => normalizeGoogleEvent(ev)).filter(Boolean);
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
export async function buildCalendarFeed(env, { from, to, getToken, calendarIds }) {
  const [google, news] = await Promise.all([
    fetchGoogleEvents(env, { ids: calendarIds, from, to, getToken }),
    readNewsEvents(env, from, to),
  ]);
  const merged = sortEvents(dedupeEvents(sortEvents(google.events.concat(news))));
  // Trimmed to the requested window AFTER the merge, so an event that reaches
  // into the window from outside it is kept while one that only touched the
  // padding is not.
  const inWindow = merged.filter((ev) => dayOf(ev.end || ev.start) >= from && dayOf(ev.start) <= to);
  return {
    from, to,
    events: inWindow,
    categories: CATEGORIES,
    sources: { google: google.ok, news: true, googleReason: google.reason },
  };
}

// Only records carrying an event date are events; a post about a sermon series
// is news and belongs on /news, not on a day of the month. Unlike /api/news
// this deliberately does NOT filter to future dates — a calendar showing last
// month has to show what happened in it.
export async function readNewsEvents(env, from, to) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, title, summary, body, event_date, publish_date, theme, value
         FROM news_items
        WHERE event_date IS NOT NULL AND event_date >= ? AND event_date <= ?
          AND (channels IS NULL OR channels LIKE '%web%')
        ORDER BY event_date ASC
        LIMIT 300`
    ).bind(addDays(from, -1), addDays(to, 1)).all();
    return (rows.results || []).map(normalizeNewsItem).filter(Boolean);
  } catch (_) { return []; }
}
