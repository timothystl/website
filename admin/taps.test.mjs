// Node test harness for admin/taps.js — run with: node admin/taps.test.mjs
// No test framework (the repo has no build step or dev dependencies).
import {
  countsAsTap, dayKey, monthKey, pruneBefore, KEEP_DAYS,
  countInMonth, tapCountLabel, everCounted, validTapId,
} from './taps.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const h = (o) => new Headers(o);


// ── what counts ──────────────────────────────────────────────────────────────
group('what counts as a tap');
{
  ok(countsAsTap(h({ 'User-Agent': PHONE })), 'somebody holding a phone to a tag counts');
  ok(countsAsTap(h({ 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/126' })), 'and so does an Android one');

  // The realistic way the number goes wrong is machines, not malice.
  ok(!countsAsTap(h({ 'User-Agent': PHONE, 'Sec-Purpose': 'prefetch;anonymous-client-ip' })),
    'a prefetch is the browser guessing, not somebody tapping');
  ok(!countsAsTap(h({ 'User-Agent': PHONE, 'Sec-Purpose': 'prefetch;prerender' })), 'a prerender likewise');
  ok(!countsAsTap(h({ 'User-Agent': PHONE, 'Purpose': 'prefetch' })), 'the older header is honoured too');
  ok(!countsAsTap(h({ 'User-Agent': PHONE, 'X-Moz': 'prefetch' })), 'and Firefox’s');

  ok(!countsAsTap(h({ 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' })), 'a crawler does not count');
  ok(!countsAsTap(h({ 'User-Agent': 'curl/8.4.0' })), 'nor does curl');
  ok(!countsAsTap(h({ 'User-Agent': 'facebookexternalhit/1.1' })), 'nor a link-preview fetcher');
  ok(!countsAsTap(h({ 'User-Agent': 'WhatsApp/2.23' })), 'nor WhatsApp unfurling the link somebody pasted');
  ok(!countsAsTap(h({})), 'no user-agent at all is a script — a real phone always sends one');
  ok(!countsAsTap(null), 'and nothing at all does not throw');

  // Plain objects as well as Headers, so this is usable from a test or a queue
  // consumer without constructing a Request.
  ok(countsAsTap({ 'User-Agent': PHONE }), 'a plain object works the same way');
  ok(!countsAsTap({ 'user-agent': 'Googlebot' }), 'case-insensitively');
}


// ── buckets ──────────────────────────────────────────────────────────────────
group('buckets');
{
  eq(dayKey('2026-08-01T17:04:00Z'), '2026-08-01', 'a bucket is one tap on one day');
  eq(monthKey('2026-08-01T17:04:00Z'), '2026-08', 'and a month is what the screen asks about');

  const rows = [
    { tap_id: 1, day: '2026-08-01', hits: 3 },
    { tap_id: 1, day: '2026-08-14', hits: 5 },
    { tap_id: 1, day: '2026-07-31', hits: 90 },
    { tap_id: 2, day: '2026-08-02', hits: 7 },
  ];
  eq(countInMonth(rows, 1, '2026-08-09T00:00:00Z'), 8, 'a month is the sum of its days');
  eq(countInMonth(rows, 2, '2026-08-09T00:00:00Z'), 7, 'each tap counted apart from the others');
  eq(countInMonth(rows, 1, '2026-07-09T00:00:00Z'), 90, 'last month is still answerable');
  eq(countInMonth(rows, 3, '2026-08-09T00:00:00Z'), 0, 'a tap with no rows is zero, not a crash');
  eq(countInMonth([], 1, '2026-08-09T00:00:00Z'), 0, 'and neither is an empty table');
  eq(countInMonth(null, 1, '2026-08-09T00:00:00Z'), 0, 'nor a failed query');
  // Ids come back from D1 as numbers but arrive from JSON as strings.
  eq(countInMonth([{ tap_id: '1', day: '2026-08-01', hits: '4' }], 1, '2026-08-09T00:00:00Z'), 4,
    'string ids and counts are compared as numbers');

  // Thirteen months keeps "this month against the same month last year"
  // answerable without the table growing forever.
  ok(KEEP_DAYS > 365, 'retention covers more than a year, so a year-on-year comparison survives');
  // ⚠ Church time, so this instant is 7pm on 2026-07-31 in St. Louis, not
  // midnight on 08-01 — and the boundary is 400 days before THAT. It read
  // 2025-06-27 while the buckets were keyed in UTC; the day it moved by is the
  // same day every tap after 7pm was being filed under.
  eq(pruneBefore('2026-08-01T00:00:00Z'), '2025-06-26', 'anything older than that is dropped');
}


// ── what the screen is allowed to say ────────────────────────────────────────
// ⚠ This is the trap the whole feature exists inside. `taps.scans` had a column
// and nothing wrote to it, so a number on the card would have been a zero
// somebody trusted. The same trap survives the fix by one deploy: counting
// starts when this ships, so the next morning every tap would read "0 taps this
// month" — indistinguishable from "the tags are broken".
group('what a card is allowed to claim');
{
  eq(tapCountLabel({ month: 0, everCounted: false }), 'Not counted yet',
    'a tap nothing has ever recorded says so rather than saying zero');
  eq(tapCountLabel({}), 'Not counted yet', 'which is also the default');
  eq(tapCountLabel({ month: 0, everCounted: true }), 'No taps this month',
    'once something has been recorded, a real zero is worth reporting');
  eq(tapCountLabel({ month: 1, everCounted: true }), '1 tap this month', 'one reads singular');
  eq(tapCountLabel({ month: 214, everCounted: true }), '214 taps this month', 'and the rest plural');

  eq(everCounted({ scans: 0 }), false, 'a tap with a lifetime zero has never been counted');
  eq(everCounted({ scans: 3 }), true, 'one with a lifetime total has');
  eq(everCounted({}), false, 'a row from before the column was written is not counted either');
  eq(everCounted(null), false, 'and a missing row does not throw');
}


// ── which taps exist ─────────────────────────────────────────────────────────
// The id IS the printed address, so ids are not a sequence to extend — anything
// that is not one of the tags that exist is dropped rather than creating a
// bucket for a tag nobody has.
group('which taps exist');
{
  const known = [1, 2, 3, 4];
  eq(validTapId(2, known), 2, 'a real tap is accepted');
  eq(validTapId('3', known), 3, 'as a string too — it arrives as JSON');
  eq(validTapId(9, known), 0, 'a tap that does not exist is dropped');
  eq(validTapId(0, known), 0, 'and so is zero');
  eq(validTapId(-1, known), 0, 'and a negative');
  eq(validTapId('abc', known), 0, 'and something that is not a number at all');
  eq(validTapId(null, known), 0, 'and nothing');
  eq(validTapId(1.9, known), 1, 'a fraction floors to the tap it names');
  eq(validTapId(5), 5, 'with no list to check against, any positive id is taken at face value');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
