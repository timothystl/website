// ── NFC TAPS: COUNTING ───────────────────────────────────────────────────────
// The four physical tags hold nothing but their own short address — /tap1 …
// /tap4 — so re-pointing one is a click in the admin and nobody reprograms a
// tag stuck to a pew rack a year ago. This module is the other half of that
// promise: knowing whether anybody is actually tapping them.
//
// Pure functions over plain values, so the rules about what counts, what a
// month is, and what the screen is allowed to claim can be tested directly
// without a Worker or a database.

// ── WHAT COUNTS ──────────────────────────────────────────────────────────────
// The realistic way this number goes wrong is not somebody attacking a church's
// tap counter. It is a crawler walking /tap1…/tap4, or a browser prefetching a
// link before anybody has decided to follow it. Both would inflate the count
// with events where no human held a phone to a tag, which is the one thing the
// number is supposed to mean.
//
// So the filter is deliberately about *machines*, not about malice. There is no
// shared secret to configure — a feature that silently does nothing until
// somebody sets a Worker secret is a feature that silently does nothing.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|preview|monitor|curl|wget|python-requests|headless|lighthouse|pingdom|uptime/i;

export function countsAsTap(headers) {
  const get = (k) => {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(k) || '';
    return headers[k] || headers[String(k).toLowerCase()] || '';
  };

  // A prefetch or a prerender is the browser guessing, not somebody tapping.
  // Chrome sends Sec-Purpose; older builds and Firefox send Purpose or X-Moz.
  const purpose = (get('Sec-Purpose') + ' ' + get('Purpose') + ' ' + get('X-Moz')).toLowerCase();
  if (/prefetch|prerender/.test(purpose)) return false;

  const ua = get('User-Agent');
  // No user-agent at all is a script. A real phone always sends one.
  if (!ua) return false;
  if (BOT_UA.test(ua)) return false;

  return true;
}

// ── BUCKETS ──────────────────────────────────────────────────────────────────
// One row per tap per day rather than one row per tap. A lifetime counter
// cannot answer "this month", which is the only question the screen asks; one
// row per hit would answer everything and grow without bound for a number
// nobody will ever slice that finely. Four taps times 365 days is 1,460 rows a
// year, and the write is a single upsert.

export const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
export const monthKey = (d) => new Date(d).toISOString().slice(0, 7);

// Buckets older than this are pruned. Thirteen months keeps "this month against
// the same month last year" answerable, which is the comparison somebody would
// actually make about a tag on a noticeboard, and stops the table growing
// forever for a number that is only ever read as a recent trend.
export const KEEP_DAYS = 400;

export function pruneBefore(now) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - KEEP_DAYS);
  return dayKey(d);
}

// Sums the buckets for one tap in one month. Rows are `{tap_id, day, hits}` as
// they come back from D1 — filtered here rather than in SQL so the same rule is
// used by the screen, the tests and any future report.
export function countInMonth(rows, tapId, when) {
  const m = monthKey(when);
  let n = 0;
  for (const r of rows || []) {
    if (Number(r.tap_id) !== Number(tapId)) continue;
    if (String(r.day || '').slice(0, 7) !== m) continue;
    n += Number(r.hits) || 0;
  }
  return n;
}

// ── WHAT THE SCREEN IS ALLOWED TO SAY ────────────────────────────────────────
// ⚠ The whole reason this was not built as a display change: `taps.scans` has a
// column but nothing ever wrote to it, so putting a number on the card would
// have meant showing a zero somebody then trusted.
//
// The same trap survives the fix, one deploy later. Counting starts the moment
// this ships, so on the morning after every tap reads "0 taps this month" — a
// number that looks exactly like "the tags are not working" and would send
// somebody to check four tags that are fine.
//
// So a tap that has never been counted says so, rather than saying zero. Once
// there is at least one recorded hit the month figure is real, and a genuine
// zero at the start of a month is then worth reporting as zero.
export function tapCountLabel({ month = 0, everCounted = false } = {}) {
  if (!everCounted) return 'Not counted yet';
  if (month === 0) return 'No taps this month';
  return `${month} tap${month === 1 ? '' : 's'} this month`;
}

// A tap is only worth reading a count for once something has been recorded for
// it. `total` is the lifetime figure kept on the tap row itself, so answering
// "has this ever been counted?" needs no scan of the buckets.
export const everCounted = (tap) => Number(tap && tap.scans) > 0;

// The tap ids that exist are the ids of the physical tags — four of them, fixed,
// because the id IS the address. Anything else posted at the counting endpoint
// is not a tap that exists, so it is dropped rather than creating a row for a
// tag nobody has.
export function validTapId(value, known) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (known && !known.includes(n)) return 0;
  return n;
}
