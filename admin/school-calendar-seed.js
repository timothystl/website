// The Word of Life School year, on the church calendar.
// ─────────────────────────────────────────────────────────────────────────────
// Word of Life keeps no Google calendar and does not want one — they publish a
// PDF once a year. So there is nothing to subscribe to and nothing to merge:
// somebody has to read the sheet and put the dates in. This is that reading,
// done once, in version control, where it can be checked against the PDF
// rather than trusted.
//
// ⚠ THESE ARE ORDINARY News & Events ROWS, NOT A SPECIAL KIND OF RECORD. Once
// seeded they are edited, retitled and deleted from the News screen like
// anything else — which is the point. A separate school-events table would be
// a second thing to teach every reader of the calendar about, for data that is
// exactly the shape the calendar already reads.
//
// ⚠ EVERY ROW IS `channels: 'calendar'`, NOT `web`. A school break is a date on
// the month and is not news anybody wants a paragraph about; without that
// channel the only way to keep twenty-nine of them out of the news feed would
// be to keep them off the calendar too.
//
// ⚠ AND EVERY ROW IS CATEGORY `wol`, so the whole school year filters off the
// church calendar — and off somebody's subscribed phone — in one click. That
// was the deciding requirement: a hundred school dates crowding out a personal
// calendar is the problem this was meant to solve, not cause.
//
// ⚠ A TIMOTHY EARLY DISMISSAL IS 11:45 am. The school's own footnote gives two
// different times — Ascension at 12:00 pm, Timothy/St. Lucas at 11:45 — and
// this is Timothy's calendar. Do not "correct" these to noon.
//
// ⚠ WHAT WAS DELIBERATELY LEFT OUT, so nobody adds it back thinking it was
// missed: the three NWEA assessment weeks, K-8 picture day, 6th grade camp,
// end of Quarter 1, the Saturday teacher workday, the two August parent
// meetings, and the March parent-teacher conference evenings. Dinger went
// through the sheet and picked; this is the picked set.
//
// ⚠ THE SHEET ITSELF HAS AT LEAST ONE ERROR. It lists a Teacher Workday on
// Saturday 13 March 2027. It is not in this list, and if it is ever added it
// wants checking with the school first rather than copying.
//
// Every date below was verified against its weekday before being written down
// — Good Friday falls on 26 March 2027, Labor Day on 7 September 2026, and so
// on. A transcription error here is invisible: a wrong date looks exactly like
// a right one.

// A run of days is ONE row with a `through`, not one row per day — see
// news_items.event_end_date. A week off school should be one chip a reader
// takes in at a glance, not five identical ones.
export const SCHOOL_YEAR = '2026-2027';

export const SCHOOL_EVENTS = [
  // ── Early dismissals — 11:45 am at Timothy ──
  { date: '2026-08-19', time: '11:45', title: 'First day of school — early dismissal',
    summary: 'Word of Life School. No After School Care.' },
  { date: '2026-10-30', time: '11:45', title: 'Early dismissal — parent-teacher conferences',
    summary: 'Word of Life School. After School Care available.' },
  { date: '2026-12-18', time: '11:45', title: 'Early dismissal — teacher workday',
    summary: 'Word of Life School. End of the 2nd quarter. After School Care open.' },
  { date: '2027-01-29', time: '11:45', title: 'Faith in Action — early dismissal',
    summary: 'Word of Life School.' },
  { date: '2027-02-12', time: '11:45', title: 'Early dismissal — teacher professional development',
    summary: 'Word of Life School.' },
  { date: '2027-03-12', time: '11:45', title: 'Early dismissal — end of the 3rd quarter',
    summary: 'Word of Life School.' },
  { date: '2027-05-28', time: '11:45', title: 'Last day of school — early dismissal',
    summary: 'Word of Life School. No After School Care.' },

  // ── Graduations and last days ──
  { date: '2027-05-19', through: '2027-05-21', title: '8th grade last days and class trip',
    summary: 'Word of Life School.' },
  { date: '2027-05-25', title: '8th grade graduation', summary: 'Word of Life School.' },
  { date: '2027-05-26', title: 'Kindergarten last day of school', summary: 'Word of Life School.' },
  { date: '2027-05-27', title: 'Kindergarten graduation', summary: 'Word of Life School.' },
  { date: '2027-05-28', title: 'Field day and PreK programs',
    summary: 'Word of Life School. Field day for grades 1–7.' },

  { date: '2026-10-20', title: 'Grandparents Day',
    summary: 'Word of Life School. PreK in the morning, K–8 in the afternoon.' },

  // ── No school, and the breaks ──
  { date: '2026-09-04', title: 'No school — LESA teacher in-service', summary: 'Word of Life School.' },
  { date: '2026-09-07', title: 'No school — Labor Day', summary: 'Word of Life School.' },
  { date: '2026-10-21', through: '2026-10-23', title: 'No school — MO District teachers conference',
    summary: 'Word of Life School.' },
  { date: '2026-11-25', through: '2026-11-27', title: 'No school — Thanksgiving break',
    summary: 'Word of Life School.' },
  // The sheet carries this across the year boundary: 21–31 December under one
  // month and the 1st under the next. It is one break and reads as one here.
  { date: '2026-12-21', through: '2027-01-01', title: 'Christmas break', summary: 'Word of Life School.' },
  { date: '2027-01-04', title: 'School resumes', summary: 'Word of Life School.' },
  { date: '2027-01-18', title: 'No school — Martin Luther King, Jr. Day', summary: 'Word of Life School.' },
  { date: '2027-02-15', title: "No school — Presidents' Day", summary: 'Word of Life School.' },
  { date: '2027-03-15', through: '2027-03-19', title: 'Spring break', summary: 'Word of Life School.' },
  // ⚠ TWO ROWS, NOT A RANGE. The sheet writes these as "26, 29" — Good Friday
  // and Easter Monday, with an ordinary weekend between them. A 26–29 range
  // would draw a four-day bar and claim the school was closed on days it was
  // never open.
  { date: '2027-03-26', title: 'No school — Good Friday', summary: 'Word of Life School.' },
  { date: '2027-03-29', title: 'No school — Easter Monday', summary: 'Word of Life School.' },
  { date: '2027-04-30', title: 'No school — teacher workday', summary: 'Word of Life School.' },

  // ── The ones the congregation is actually invited to ──
  { date: '2026-12-12', title: 'Live Nativity', summary: 'Word of Life School, grades 5–8.' },
  { date: '2026-12-13', title: 'Christmas concerts',
    summary: 'Word of Life School. PreK–1st grade, and 2nd–4th grade.' },

  { date: '2026-09-30', title: 'PreK picture day', summary: 'Word of Life School.' },
  { date: '2027-01-25', through: '2027-01-29', title: 'National Lutheran Schools Week',
    summary: 'Word of Life School.' },
];

// The shape a `news_items` INSERT wants. Kept as a function rather than as a
// second literal so the list above stays readable against the printed sheet,
// which is the only way anybody can check it.
export function schoolEventRows(publishDate) {
  return SCHOOL_EVENTS.map((e) => ({
    title: e.title,
    summary: e.summary || '',
    publish_date: publishDate,
    event_date: e.date,
    event_end_date: e.through || null,
    event_time: e.time || null,
    // ⚠ NO EXPIRY. The expiry sweep DELETES a row and its image outright, and
    // the calendar deliberately shows last month as well as this one — a date
    // vanishing from the printed month the morning after it happened is not
    // what anybody means by "expired".
    expire_date: null,
    channels: 'calendar',
    calendar_category: 'wol',
  }));
}
