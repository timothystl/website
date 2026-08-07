// ── WHAT DAY IS IT, HERE ─────────────────────────────────────────────────────
// The Worker runs in UTC. The church is in St. Louis. Between about 7pm and
// midnight Central every single day, those two disagree about what the date is
// — and every one of the places that asked `new Date()` what today was got the
// wrong answer for those five hours.
//
// It surfaced as the dashboard greeting saying "Friday morning" on a Thursday
// evening, which is harmless. The same bug underneath was not:
//
//   - a news post written on Thursday evening was DATED FRIDAY, because the
//     form's default publish_date was the UTC date;
//   - /api/news publishes on `publish_date <= today` and hides on
//     `expire_date >= today`, so on the public site a post appeared five hours
//     early and vanished five hours early;
//   - the expiry sweep deleted a post, and its image out of R2, a day sooner
//     than the office had asked for.
//
// So "today" is the church's today, and it comes from here. `Intl` does the
// DST arithmetic, which is the part worth not hand-rolling: Central is UTC-5
// in summer and UTC-6 in winter, and the changeover is not on a date anyone
// wants to hardcode.
//
// ⚠ This is for DATES SOMEBODY READS OR PICKS — what day a post is dated, what
// counts as expired, what the dashboard says. It is NOT for timestamps.
// `created_at`, `sent_at` and the audit log are instants, and an instant
// belongs in UTC; leave `new Date().toISOString()` alone in those places.
export const CHURCH_TZ = 'America/Chicago';

const pad2 = (n) => String(n).padStart(2, '0');

function parts(d, opts) {
  const out = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: CHURCH_TZ, ...opts }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

// 'YYYY-MM-DD' for the church's calendar, which is the shape every date column
// in this database already uses.
export function churchDate(d = new Date()) {
  const p = parts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

// N days from the church's today, N may be negative.
//
// ⚠ Calendar arithmetic on the date-only value, NOT `Date.now() + n * 864e5`
// then formatted. Adding days in milliseconds is wrong twice a year: across a
// DST boundary the day is 23 or 25 hours long, so "90 days from now" computed
// in milliseconds lands an hour out — and an hour is enough to cross midnight
// and report the wrong DAY. Here the hours never enter into it.
export function churchDatePlus(days, d = new Date()) {
  const [y, m, day] = churchDate(d).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day) + days * 86400000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

// 0–23 in church time. ⚠ `hour12: false` renders midnight as "24" in some
// engines, which would make the greeting read "evening" at 12:30am.
export function churchHour(d = new Date()) {
  const h = Number(parts(d, { hour: 'numeric', hour12: false }).hour);
  return h === 24 ? 0 : h;
}

// The greeting's own words. Split out so the boundaries are somewhere a person
// can read them rather than buried in a ternary in a route handler.
export function partOfDay(d = new Date()) {
  const h = churchHour(d);
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

// Any en-US format, in church time. `weekday: 'long'` for the greeting, the
// longer shape for the panel heading.
export function churchFormat(opts, d = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: CHURCH_TZ, ...opts }).format(d);
}
