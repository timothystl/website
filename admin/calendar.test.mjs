// The merged church calendar feed. Run: node admin/calendar.test.mjs
//
// What is worth pinning here is not "does it render" — it is the handful of
// rules that are silently wrong rather than visibly broken when they break:
//
//   · an all-day event landing on one day too many, because Google's DTEND is
//     exclusive and every other calendar's is not;
//   · a wall-clock time being turned into an instant somewhere, which would
//     tell a reader outside Central the wrong time for a service;
//   · the de-dupe collapsing the wrong way and losing the start time of an
//     event that is in both Google and News & Events;
//   · an event whose color nobody set being DROPPED rather than shown as
//     uncategorized — a church event missing from the church calendar is the
//     worst failure this feature has.

import assert from 'node:assert/strict';
import {
  CATEGORIES, NEUTRAL_CATEGORY, categoryFor, categoryRecord, categoryForNews,
  addDays, shiftMonth, monthRange, wallClock, plainText, mergedCategories,
  normalizeGoogleEvent, normalizeNewsItem, dedupeEvents, sortEvents,
  buildIcs, foldIcsLine, parseCalendarIds, DEFAULT_CALENDAR_IDS,
  fetchGoogleEvents, buildCalendarFeed, readNewsEvents,
  normalizeClock, clockOnDay, newsEnd,
} from './calendar.js';

let pass = 0;
const test = (name, fn) => {
  try { const r = fn(); if (r && r.then) return r.then(() => { pass++; }, (e) => {
      console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; });
    pass++;
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};
const queue = [];
const atest = (name, fn) => queue.push(() => test(name, fn));

// ── the category table ──────────────────────────────────────
test('every Google color the office can pick maps to exactly one category', () => {
  const ids = CATEGORIES.filter((c) => c.colorId).map((c) => c.colorId);
  assert.equal(new Set(ids).size, ids.length, 'two categories claim one Google color');
  // Google offers eleven event colors. Ten are mapped by name in the handoff;
  // Flamingo (4) deliberately is not, and has to land on the neutral category
  // rather than anywhere in particular.
  assert.equal(categoryFor('4'), NEUTRAL_CATEGORY, 'Flamingo falls through to neutral');
  for (const c of CATEGORIES) if (c.colorId) assert.equal(categoryFor(c.colorId), c.key, c.google);
});

test('an event with no color at all is neutral, never dropped', () => {
  assert.equal(categoryFor(undefined), NEUTRAL_CATEGORY);
  assert.equal(categoryFor(null), NEUTRAL_CATEGORY);
  assert.equal(categoryFor(''), NEUTRAL_CATEGORY);
  // The overwhelmingly common case: nobody touched the color picker, so the
  // event carries the calendar's default and Google sends no colorId at all.
  const ev = normalizeGoogleEvent({ id: 'x', summary: 'Trustees', start: { dateTime: '2026-08-10T19:00:00-05:00' }, end: { dateTime: '2026-08-10T20:00:00-05:00' } });
  assert.ok(ev, 'a colorless event still becomes an event');
  assert.equal(ev.category, NEUTRAL_CATEGORY);
});

test('every category has a color and a tint, and the neutral one is reachable', () => {
  for (const c of CATEGORIES) {
    assert.match(c.color, /^#[0-9A-F]{6}$/i, `${c.key} color`);
    assert.match(c.tint, /^#[0-9A-F]{6}$/i, `${c.key} tint`);
  }
  assert.equal(categoryRecord('nonsense').key, NEUTRAL_CATEGORY, 'an unknown key resolves rather than throwing');
});

test('a News record can be told outright what it is on the calendar', () => {
  // ⚠ THE GAP THIS CLOSES. The value tag only ever reached three of the
  // calendar's categories, so a post could never be marked as a meeting or a
  // rehearsal — it silently became Special events, whatever it actually was.
  assert.equal(categoryForNews({ calendar_category: 'meetings' }), 'meetings');
  assert.equal(categoryForNews({ calendar_category: 'music', value: 'worship' }), 'music',
    'and what the office said beats what the value tag implies');
  // Blank is the ordinary state — every post written before the field existed
  // has one — and still falls through to the guess.
  assert.equal(categoryForNews({ calendar_category: '', value: 'worship' }), 'worship');
  assert.equal(categoryForNews({ calendar_category: null, value: 'outreach' }), 'ministry');
  // ⚠ A category that no longer exists, or has been retired, must not come
  // back through this door either.
  assert.equal(categoryForNews({ calendar_category: 'nonsense' }), 'special',
    'an unknown category falls through to the guess rather than being honored');
  const retired = mergedCategories([{ key: 'music', active: 0 }]);
  assert.equal(categoryForNews({ calendar_category: 'music' }, retired), 'special',
    'and so does a retired one');
});

test('a News record takes its category from the value it was tagged with', () => {
  assert.equal(categoryForNews({ value: 'worship' }), 'worship');
  assert.equal(categoryForNews({ value: 'education' }), 'learn');
  assert.equal(categoryForNews({ theme: 'Christian Education' }), 'learn');
  assert.equal(categoryForNews({ value: 'outreach' }), 'ministry');
  // Untagged is the ordinary case, and an announced happening with a photo and
  // a sign-up is exactly what Special events means.
  assert.equal(categoryForNews({}), 'special');
  assert.equal(categoryForNews({ value: '' }), 'special');
});

// ── dates ───────────────────────────────────────────────────
test('date arithmetic crosses months, years and a leap day', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('a month range knows how long the month is', () => {
  assert.deepEqual(monthRange(2026, 2), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange(2024, 2), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(monthRange(2026, 12), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(shiftMonth(2026, 1, -1), [2025, 12]);
  assert.deepEqual(shiftMonth(2026, 12, 1), [2027, 1]);
  assert.deepEqual(shiftMonth(2026, 8, 12), [2027, 8]);
});

// ── the wall clock ──────────────────────────────────────────
test('a time keeps the digits Google sent and loses only the offset', () => {
  // ⚠ THE ASSERTION THAT MATTERS: 08:00 in, 08:00 out. We ask Google for
  // Chicago times, so the digits in front of the offset already ARE the
  // church's wall clock. Anything that "helpfully" converted here would move
  // every service by the reader's own offset.
  assert.equal(wallClock('2026-08-16T08:00:00-05:00'), '2026-08-16T08:00:00');
  assert.equal(wallClock('2026-01-11T10:45:00-06:00'), '2026-01-11T10:45:00', 'and again on the winter side of DST');
  assert.equal(wallClock('2026-08-16T08:00:00Z'), '2026-08-16T08:00:00');
  assert.equal(wallClock(''), null);
  assert.equal(wallClock(undefined), null);
});

test('nothing in a normalized event carries a timezone', () => {
  const ev = normalizeGoogleEvent({
    id: 'a', summary: 'Divine Service', colorId: '9',
    start: { dateTime: '2026-08-16T08:00:00-05:00' }, end: { dateTime: '2026-08-16T09:15:00-05:00' },
  });
  assert.equal(ev.start, '2026-08-16T08:00:00');
  assert.equal(ev.end, '2026-08-16T09:15:00');
  assert.doesNotMatch(ev.start, /Z|[+-]\d\d:\d\d$/, 'no offset survived into the payload');
  assert.equal(ev.category, 'worship');
  assert.equal(ev.allDay, false);
});

// ── the exclusive-end trap ──────────────────────────────────
test("an all-day event's end is made inclusive, because Google's is not", () => {
  // Google reports a ONE-day all-day event as 08-16 → 08-17. Carried through
  // as-is, every all-day event on the site would sit on one day too many —
  // and a "Vacation Bible School, Mon–Fri" would run into Saturday.
  const one = normalizeGoogleEvent({ id: 'a', summary: 'Rally Day', start: { date: '2026-08-16' }, end: { date: '2026-08-17' } });
  assert.equal(one.start, '2026-08-16');
  assert.equal(one.end, '2026-08-16', 'a one-day event ends on the day it starts');
  assert.equal(one.allDay, true);

  const week = normalizeGoogleEvent({ id: 'b', summary: 'VBS', start: { date: '2026-06-08' }, end: { date: '2026-06-13' } });
  assert.equal(week.end, '2026-06-12', 'Mon-Fri stays Mon-Fri');

  // Google occasionally omits the end on an all-day event. A missing end must
  // mean the same one day, not an event with no end at all.
  const noEnd = normalizeGoogleEvent({ id: 'c', summary: 'Holiday', start: { date: '2026-07-04' } });
  assert.equal(noEnd.end, '2026-07-04');
});

test('a cancelled or unusable event produces nothing rather than a blank chip', () => {
  assert.equal(normalizeGoogleEvent({ id: 'a', summary: 'Gone', status: 'cancelled', start: { date: '2026-08-16' } }), null);
  assert.equal(normalizeGoogleEvent(null), null);
  assert.equal(normalizeGoogleEvent({ id: 'a', summary: 'No when' }), null, 'an event with no start is not an event');
  // A summary is optional in Google and routinely missing on a private
  // booking. The slot is real, so it is shown rather than dropped.
  const untitled = normalizeGoogleEvent({ id: 'a', start: { date: '2026-08-16' }, end: { date: '2026-08-17' } });
  assert.equal(untitled.title, 'Untitled event');
});

test('a News record becomes an all-day entry, and one without a date is not an event', () => {
  const ev = normalizeNewsItem({ id: 7, title: 'Trunk or Treat', summary: 'Costumes welcome.', event_date: '2026-10-31', value: 'outreach' });
  assert.equal(ev.start, '2026-10-31');
  assert.equal(ev.end, '2026-10-31');
  assert.equal(ev.allDay, true, 'a News record has no time column, and inventing one would be a lie');
  assert.equal(ev.source, 'news');
  assert.equal(ev.category, 'ministry');
  assert.equal(normalizeNewsItem({ id: 8, title: 'A sermon series', publish_date: '2026-10-01' }), null);
  assert.equal(normalizeNewsItem({ id: 9, title: '', event_date: '2026-10-31' }), null);
});

test('a News body arrives as text, never as markup', () => {
  const ev = normalizeNewsItem({ id: 1, title: 'X', event_date: '2026-08-16',
    summary: '<p>Bring a <b>dish</b> &amp; a friend.</p><p>6pm</p>' });
  assert.equal(ev.description, 'Bring a dish & a friend.\n6pm');
  assert.doesNotMatch(ev.description, /[<>]/, 'no tags survive into the feed');
  assert.equal(plainText('<script>alert(1)</script>Hi'), 'alert(1)Hi', 'a tag is stripped, its text kept');
});

// ── the de-dupe ─────────────────────────────────────────────
const g = (t, start, extra = {}) => ({ id: 'g:' + t + start, title: t, start, end: start, allDay: !start.includes('T'), location: '', description: '', category: 'worship', source: 'gcal', ...extra });
const n = (t, date, extra = {}) => ({ id: 'n:' + t, title: t, start: date, end: date, allDay: true, location: '', description: '', category: 'special', source: 'news', ...extra });

test('the same happening in both places collapses to one entry', () => {
  const out = dedupeEvents([
    g('Rally Day', '2026-08-16T09:30:00'),
    n('Rally  DAY!', '2026-08-16', { description: 'Breakfast at 9.' }),
  ]);
  assert.equal(out.length, 1, 'shown twice it reads as two events');
  // ⚠ THE NEWS RECORD WINS THE WORDS — it has the description, the photo and
  // the sign-up — BUT GOOGLE WINS THE CLOCK. A News record has no time of day,
  // so collapsing to it alone would turn a 9:30 service into a shapeless
  // all-day chip.
  assert.equal(out[0].description, 'Breakfast at 9.', 'the richer copy survives');
  assert.equal(out[0].start, '2026-08-16T09:30:00', 'and so does the time only Google had');
  assert.equal(out[0].allDay, false);
  assert.equal(out[0].source, 'both', 'the chip says it is in both, rather than picking a winner');
});

test('two genuinely different events on one day are both kept', () => {
  const out = dedupeEvents([g('Divine Service', '2026-08-16T08:00:00'), g('Bible Class', '2026-08-16T09:30:00')]);
  assert.equal(out.length, 2);
  // The same title far apart in the day is two services, not one duplicate.
  const two = dedupeEvents([g('Divine Service', '2026-08-16T08:00:00'), n('Divine Service', '2026-08-16')]);
  assert.equal(two.length, 1, 'an all-day News record beside a timed one is the same happening');
  const apart = dedupeEvents([
    g('Divine Service', '2026-08-16T08:00:00'),
    { ...g('Divine Service', '2026-08-16T10:45:00'), source: 'news' },
  ]);
  assert.equal(apart.length, 2, '8:00 and 10:45 are two services, and 2h45m is well past the 30-minute window');
});

test('two entries from the same source are never merged into each other', () => {
  // Google itself legitimately holds the same title twice — a room booked back
  // to back. Collapsing those would delete a real booking.
  const out = dedupeEvents([g('Gym Rental', '2026-08-16T18:00:00'), g('Gym Rental', '2026-08-16T18:20:00')]);
  assert.equal(out.length, 2);
});

test('events sort by start, with the all-day entry leading its day', () => {
  const out = sortEvents([
    g('Evening', '2026-08-16T18:00:00'), n('All day thing', '2026-08-16'), g('Morning', '2026-08-16T08:00:00'),
  ]);
  assert.deepEqual(out.map((e) => e.title), ['All day thing', 'Morning', 'Evening']);
});

// ── the .ics feed ───────────────────────────────────────────
test('the subscribe feed is a calendar a reader would accept', () => {
  const ics = buildIcs([
    { id: 'a', start: '2026-08-16T08:00:00', end: '2026-08-16T09:15:00', allDay: false, title: 'Divine Service', location: 'Sanctuary', description: '', category: 'worship' },
    { id: 'b', start: '2026-06-08', end: '2026-06-12', allDay: true, title: 'VBS', location: '', description: '', category: 'youth' },
  ]);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(ics, /VERSION:2\.0/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.equal(ics.split('\n').every((l) => l === '' || l.endsWith('\r')), true, 'every line is CRLF-terminated');
  // A timed event carries the church's zone by name, so a subscriber in another
  // timezone sees 8:00 Central rather than 8:00 their own.
  assert.match(ics, /DTSTART;TZID=America\/Chicago:20260816T080000/);
  assert.match(ics, /DTEND;TZID=America\/Chicago:20260816T091500/);
  // ⚠ AND THE EXCLUSIVE END COMES BACK for an all-day event, because that is
  // what DTEND means in the format. Mon-Fri is DTEND Saturday.
  assert.match(ics, /DTSTART;VALUE=DATE:20260608/);
  assert.match(ics, /DTEND;VALUE=DATE:20260613/);
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/, 'a feed with no DTSTAMP is one some readers refuse');
});

test('a comma, a semicolon and a newline in a title cannot break the feed', () => {
  const ics = buildIcs([{ id: 'a', start: '2026-08-16', end: '2026-08-16', allDay: true, title: 'Bread, wine; and a note', description: 'Line one\nLine two', category: 'other' }]);
  assert.match(ics, /SUMMARY:Bread\\, wine\; and a note/);
  assert.match(ics, /Line one\\nLine two/);
  assert.doesNotMatch(ics, /DESCRIPTION:Line one\r\nLine two/, 'a raw newline would end the property');
});

test('a long line is folded on octets, not characters', () => {
  const long = 'DESCRIPTION:' + 'x'.repeat(300);
  const folded = foldIcsLine(long);
  for (const seg of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(seg).length <= 75, 'RFC 5545 caps a line at 75 octets');
  }
  assert.equal(folded.split('\r\n').slice(1).every((s) => s.startsWith(' ')), true, 'a continuation begins with a space');
  assert.equal(folded.replace(/\r\n /g, ''), long, 'unfolding gives back exactly what went in');
  // ⚠ The case a character-counting folder gets wrong: a multi-byte character
  // split down the middle is a corrupt file, not a long line.
  const wide = 'SUMMARY:' + '\u00e9'.repeat(80);
  const wf = foldIcsLine(wide);
  assert.equal(wf.replace(/\r\n /g, ''), wide, 'accented text round-trips through the fold');
  for (const seg of wf.split('\r\n')) assert.ok(new TextEncoder().encode(seg).length <= 75);
});

// ── which calendars ─────────────────────────────────────────
test('an unset calendar list falls back to the two the old embed used', () => {
  assert.deepEqual(parseCalendarIds(''), DEFAULT_CALENDAR_IDS);
  assert.deepEqual(parseCalendarIds(null), DEFAULT_CALENDAR_IDS);
  assert.deepEqual(parseCalendarIds('  '), DEFAULT_CALENDAR_IDS);
  assert.deepEqual(parseCalendarIds('a@b.com, c@d.com'), ['a@b.com', 'c@d.com']);
  assert.deepEqual(parseCalendarIds('a@b.com\nc@d.com'), ['a@b.com', 'c@d.com']);
});

// ── reading Google ──────────────────────────────────────────
const fakeDb = (rows) => ({
  prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }),
});

atest('with no credentials at all the feed still carries the News records', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  try {
    const out = await fetchGoogleEvents({}, { ids: ['a@b'], from: '2026-08-01', to: '2026-08-31' });
    assert.deepEqual(out.events, []);
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'unconfigured', 'the page needs to know WHY, so it can say so');
  } finally { globalThis.fetch = realFetch; }
});

atest('singleEvents is asked for, or every Sunday but the first disappears', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(String(u)); return { ok: true, json: async () => ({ items: [] }) }; };
  try {
    await fetchGoogleEvents({ GCAL_API_KEY: 'k' }, { ids: ['a@b'], from: '2026-08-01', to: '2026-08-31' });
    assert.equal(seen.length, 1);
    // ⚠ Without this, a weekly service comes back as ONE event carrying an
    // RRULE and the grid shows it once a month.
    assert.match(seen[0], /singleEvents=true/);
    assert.match(seen[0], /timeZone=America%2FChicago/, 'so the digits we keep are church time');
    assert.match(seen[0], /key=k/);
    // The window is padded so a multi-day event that began before the month
    // still reaches the grid's leading days.
    assert.match(seen[0], /timeMin=2026-07-31/);
    assert.match(seen[0], /timeMax=2026-09-02/);
  } finally { globalThis.fetch = realFetch; }
});

atest('the service account is preferred, and a plain API key still works alone', async () => {
  const realFetch = globalThis.fetch;
  let auth = null, url = '';
  globalThis.fetch = async (u, init) => {
    url = String(u); auth = init && init.headers && init.headers.Authorization;
    return { ok: true, json: async () => ({ items: [] }) };
  };
  try {
    await fetchGoogleEvents({ GCAL_API_KEY: 'k' }, { ids: ['a@b'], from: '2026-08-01', to: '2026-08-31',
      getToken: async () => 'TOKEN' });
    assert.equal(auth, 'Bearer TOKEN');
    assert.doesNotMatch(url, /key=k/, 'a bearer token and a key in the query is a request Google refuses');
  } finally { globalThis.fetch = realFetch; }
});

atest('one calendar failing never discards the one that answered', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => String(u).includes('good')
    ? { ok: true, json: async () => ({ items: [{ id: '1', summary: 'Service', colorId: '9', start: { dateTime: '2026-08-16T08:00:00-05:00' }, end: { dateTime: '2026-08-16T09:00:00-05:00' } }] }) }
    : { ok: false, status: 404 };
  try {
    const out = await fetchGoogleEvents({ GCAL_API_KEY: 'k' }, { ids: ['good@b', 'bad@b'], from: '2026-08-01', to: '2026-08-31' });
    assert.equal(out.events.length, 1, 'what did answer is kept');
    assert.equal(out.ok, false, 'and the page is still told a calendar is missing');
  } finally { globalThis.fetch = realFetch; }
});

atest('the feed merges both sources and trims to the month', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [
    { id: '1', summary: 'Divine Service', colorId: '9', start: { dateTime: '2026-08-16T08:00:00-05:00' }, end: { dateTime: '2026-08-16T09:00:00-05:00' } },
    { id: '2', summary: 'Last month', start: { date: '2026-07-30' }, end: { date: '2026-07-31' } },
  ] }) });
  try {
    const feed = await buildCalendarFeed({ DB: fakeDb([
      { id: 5, title: 'Trunk or Treat', summary: 'Costumes.', event_date: '2026-08-20', value: 'outreach' },
    ]) }, { from: '2026-08-01', to: '2026-08-31', calendarIds: ['a@b'], getToken: async () => 'T' });
    assert.deepEqual(feed.events.map((e) => e.title), ['Divine Service', 'Trunk or Treat']);
    assert.equal(feed.sources.google, true);
    assert.equal(feed.sources.news, true);
    assert.ok(feed.categories.length, 'the palette rides along, so the page never hardcodes it');
    // The July event was inside the padded fetch window and outside the month.
    assert.equal(feed.events.some((e) => e.title === 'Last month'), false);
  } finally { globalThis.fetch = realFetch; }
});

atest('a database that will not answer costs the News half, not the whole feed', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ items: [
    { id: '1', summary: 'Divine Service', colorId: '9', start: { dateTime: '2026-08-16T08:00:00-05:00' }, end: { dateTime: '2026-08-16T09:00:00-05:00' } },
  ] }) });
  const brokenDb = { prepare: () => { throw new Error('no table'); } };
  try {
    assert.deepEqual(await readNewsEvents({ DB: brokenDb }, '2026-08-01', '2026-08-31'), []);
    const feed = await buildCalendarFeed({ DB: brokenDb }, { from: '2026-08-01', to: '2026-08-31', calendarIds: ['a@b'], getToken: async () => 'T' });
    assert.equal(feed.events.length, 1, 'the Google half still renders');
  } finally { globalThis.fetch = realFetch; }
});


// ── A NEWS POST WITH A TIME ─────────────────────────────────────────────────
// The column that ended the retyping. Before it, a News & Events record could
// say WHICH DAY and nothing more — so a 7:00 pm meeting had to be typed into
// the newsletter by hand and into Google by hand.
//
// Everything here is a case that is silently wrong rather than visibly broken:
// a blank time read as midnight, a derived end pushing an event onto tomorrow,
// or a stored time the month refuses to show.

test('a time makes a news post a timed event, as a bare wall clock', () => {
  const cats = mergedCategories([]);
  const ev = normalizeNewsItem({ id: 7, title: 'Council', event_date: '2026-09-01', event_time: '19:00' }, cats);
  assert.equal(ev.allDay, false);
  assert.equal(ev.start, '2026-09-01T19:00:00');
  // The property the whole file is built around: no Z, no offset, ever.
  assert.ok(!/[Zz]|[+-]\d{2}:\d{2}$/.test(ev.start), 'a start must carry no timezone');
});

test('a BLANK time is all day, not midnight', () => {
  const cats = mergedCategories([]);
  for (const t of [undefined, null, '', '   ']) {
    const ev = normalizeNewsItem({ id: 1, title: 'Fair', event_date: '2026-09-01', event_time: t }, cats);
    assert.equal(ev.allDay, true, `blank time ${JSON.stringify(t)} must stay all day`);
    assert.equal(ev.start, '2026-09-01');
  }
});

test('a time that is not a time is no time, never a guess', () => {
  const cats = mergedCategories([]);
  for (const t of ['25:00', '7pm', '19:60', 'noon', '1900']) {
    const ev = normalizeNewsItem({ id: 1, title: 'X', event_date: '2026-09-01', event_time: t }, cats);
    assert.equal(ev.allDay, true, `${t} must not become a start time`);
  }
});

test('a stated end is kept; an unstated one is an hour and is never shown', () => {
  const cats = mergedCategories([]);
  const stated = normalizeNewsItem({ id: 1, title: 'X', event_date: '2026-09-01', event_time: '09:00', event_end_time: '11:30' }, cats);
  assert.equal(stated.end, '2026-09-01T11:30:00');
  const derived = normalizeNewsItem({ id: 2, title: 'Y', event_date: '2026-09-01', event_time: '09:00' }, cats);
  assert.equal(derived.end, '2026-09-01T10:00:00');
  // An end BEFORE the start is a typo, not an overnight event.
  const backwards = normalizeNewsItem({ id: 3, title: 'Z', event_date: '2026-09-01', event_time: '09:00', event_end_time: '08:00' }, cats);
  assert.equal(backwards.end, '2026-09-01T10:00:00');
});

test('a derived end never spills onto the next day', () => {
  const cats = mergedCategories([]);
  // ⚠ The one that would be invisible: tlcCalDates() walks start date → end
  // date inclusive, so a naive +1 hour here draws an 11:30 pm event on
  // tomorrow's grid as well, finished before anybody woke up.
  //
  // ⚠ ASSERTING THE DATE ALONE IS VACUOUS AND THE FIRST VERSION OF THIS DID
  // EXACTLY THAT. Removing the clamp produces `2026-09-01T24:30:00` — the same
  // DATE, an hour that does not exist, and lexically still >= the start. So
  // the clock itself is what has to be read: 24:30 reaches the .ics as
  // `20260901T243000`, which is a malformed instant a calendar app either
  // drops or silently shifts.
  for (const t of ['23:00', '23:30', '23:59']) {
    const ev = normalizeNewsItem({ id: 1, title: 'Late', event_date: '2026-09-01', event_time: t }, cats);
    assert.equal(ev.end.slice(0, 10), '2026-09-01', `${t} must end on its own day`);
    assert.match(ev.end, /T([01]\d|2[0-3]):[0-5]\d:00$/, `${t} produced an impossible end: ${ev.end}`);
    assert.ok(ev.end >= ev.start, `${t} must not end before it starts`);
  }
});

test('a location rides through, and a missing one is empty rather than absent', () => {
  const cats = mergedCategories([]);
  assert.equal(normalizeNewsItem({ id: 1, title: 'X', event_date: '2026-09-01', event_location: ' Fellowship Hall ' }, cats).location, 'Fellowship Hall');
  assert.equal(normalizeNewsItem({ id: 2, title: 'Y', event_date: '2026-09-01' }, cats).location, '');
});

test('normalizeClock is the one answer the save path and the renderer share', () => {
  assert.equal(normalizeClock('19:00'), '19:00');
  assert.equal(normalizeClock('09:05'), '09:05');
  assert.equal(normalizeClock('19:00:00'), '19:00');  // a seconds-carrying value still reads
  assert.equal(normalizeClock('24:00'), null);
  assert.equal(normalizeClock(''), null);
  assert.equal(normalizeClock(null), null);
  // If these two disagreed, a time could be STORED that the month then refuses
  // to show — the form would come back looking saved and the calendar would
  // say all day.
  assert.equal(clockOnDay('2026-09-01', '19:00'), '2026-09-01T19:00:00');
  assert.equal(clockOnDay('2026-09-01', '24:00'), null);
});

test('a timed news record now wins the clock in the de-dupe, not just the words', () => {
  const cats = mergedCategories([]);
  const news = normalizeNewsItem({ id: 5, title: 'Rally Day', event_date: '2026-09-13', event_time: '08:00', summary: 'Bring a dish' }, cats);
  const g = normalizeGoogleEvent({ id: 'g1', summary: 'Rally Day', start: { dateTime: '2026-09-13T08:00:00-05:00' }, end: { dateTime: '2026-09-13T09:00:00-05:00' } }, cats);
  const [ev] = dedupeEvents([g, news]);
  assert.equal(ev.description, 'Bring a dish', 'the News record still wins the words');
  assert.equal(ev.allDay, false);
  assert.equal(ev.start.slice(11, 16), '08:00');
  assert.equal(ev.source, 'both');
});

test('a timed news event writes a real DTSTART, not a DATE', () => {
  const cats = mergedCategories([]);
  const ics = buildIcs([normalizeNewsItem({ id: 1, title: 'Council', event_date: '2026-09-01', event_time: '19:00' }, cats)], { cats });
  assert.ok(ics.includes('DTSTART;TZID=America/Chicago:20260901T190000'), ics);
  assert.ok(ics.includes('DTEND;TZID=America/Chicago:20260901T200000'), ics);
  assert.ok(!ics.includes('DTSTART;VALUE=DATE'), 'a timed event must not be written as an all-day one');
});

await queue.reduce((p, f) => p.then(f), Promise.resolve());
console.log(`calendar.test.mjs: ${pass} passed`);
