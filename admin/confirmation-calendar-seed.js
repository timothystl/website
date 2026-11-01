// The 2026–2027 Confirmation class schedule, on the church calendar.
// ─────────────────────────────────────────────────────────────────────────────
// Andrew sent the year's unit-by-unit list (1 November 2026) to be put on the
// calendar. Same shape and same reasoning as admin/school-calendar-seed.js:
// ordinary News & Events rows, seeded once behind a marker, edited and deleted
// from the News screen afterward like anything else.
//
// ⚠ `channels: 'calendar'` — a class session is a date on the month, not news.
// ⚠ CATEGORY `learn`, beside the other classes and Bible studies.
// ⚠ ALL-DAY. The sheet gives dates only, no meeting time; a guessed time on a
//   phone calendar is worse than none. Add the time from the News screen.
//
// Kept exactly as the sheet has it, so nobody "fixes" these back:
//   · 11 and 18 October are BOTH "Apostles' Creed III" on the sheet.
//   · One NO CLASS line carries no date; it sits between 20 December and
//     10 January, so it is the two Sundays of Christmas break — 27 December
//     and 3 January — as two rows, not a range bar across the week.
//   · The NO CLASS Sundays are on the calendar on purpose: a family looking
//     at an empty Sunday should not have to guess.
//
// Every date below is a Sunday; that was checked before it was written down.
export const CONFIRMATION_YEAR = '2026-2027';

const C = (title) => `Confirmation: ${title}`;
const NO = 'No Confirmation class';
const AS_NEEDED = 'Confirmation class (as needed)';

export const CONFIRMATION_EVENTS = [
  { date: '2026-08-23', title: C('Kick-off Meeting') },
  { date: '2026-09-20', title: C('Intro — What Is Confirmation / How To') },
  { date: '2026-09-27', title: C("Apostles' Creed I") },
  { date: '2026-10-04', title: C("Apostles' Creed II") },
  { date: '2026-10-11', title: C("Apostles' Creed III") },
  { date: '2026-10-18', title: C("Apostles' Creed III") },
  { date: '2026-10-25', title: NO },
  { date: '2026-11-01', title: C('Means of Grace I') },
  { date: '2026-11-08', title: C('Means of Grace II') },
  { date: '2026-11-15', title: C('Means of Grace III') },
  { date: '2026-11-22', title: NO },
  { date: '2026-11-29', title: NO },
  { date: '2026-12-06', title: C('Means of Grace IV') },
  { date: '2026-12-13', title: NO },
  { date: '2026-12-20', title: C('Means of Grace V') },
  { date: '2026-12-27', title: NO },
  { date: '2027-01-03', title: NO },
  { date: '2027-01-10', title: C('Means of Grace VI') },
  { date: '2027-01-17', title: C('Means of Grace VII') },
  { date: '2027-01-24', title: C('Mission, Ministry & Lutheran Worship I') },
  { date: '2027-01-31', title: C('Mission, Ministry & Lutheran Worship II') },
  { date: '2027-02-07', title: C('Mission, Ministry & Lutheran Worship III') },
  { date: '2027-02-14', title: C('New Testament I') },
  { date: '2027-02-21', title: C('New Testament II') },
  { date: '2027-02-28', title: C('New Testament III') },
  { date: '2027-03-07', title: C('New Testament IV') },
  { date: '2027-03-14', title: NO },
  { date: '2027-03-21', title: NO },
  { date: '2027-03-28', title: NO },
  { date: '2027-04-04', title: AS_NEEDED },
  { date: '2027-04-11', title: AS_NEEDED },
  { date: '2027-04-18', title: NO },
  { date: '2027-04-25', title: AS_NEEDED },
  { date: '2027-05-02', title: AS_NEEDED },
  { date: '2027-05-09', title: NO },
  { date: '2027-05-16', title: 'Confirmation Sunday' },
];

export function confirmationEventRows(publishDate) {
  return CONFIRMATION_EVENTS.map((e) => ({
    title: e.title,
    summary: '',
    publish_date: publishDate,
    event_date: e.date,
    event_end_date: null,
    event_time: null,
    expire_date: null, // the expiry sweep deletes rows outright; see the school seed
    channels: 'calendar',
    calendar_category: 'learn',
  }));
}
