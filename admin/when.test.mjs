// What day it is, here.   node admin/when.test.mjs
//
// The bug this exists to stop: the Worker runs in UTC, the church is in
// St. Louis, and every evening from about 7pm they disagree about the date.
// The cases below are real instants pinned in UTC, so they assert the offset
// rather than describing it.
import { CHURCH_TZ, churchDate, churchDatePlus, churchHour, partOfDay, churchFormat } from './when.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

group('the evening that started this');
{
  // Andrew's screenshot: the dashboard said "Friday morning" while it was
  // Thursday evening where he was. 2026-08-07T01:00:00Z is Friday 1am UTC and
  // Thursday 8pm in St. Louis.
  const d = new Date('2026-08-07T01:00:00Z');
  eq(d.toISOString().slice(0, 10), '2026-08-07', 'UTC calls it the 7th — this is what the old code used');
  eq(churchDate(d), '2026-08-06', 'the church is still on the 6th');
  eq(churchFormat({ weekday: 'long' }, d), 'Thursday', 'and it is Thursday, not Friday');
  eq(partOfDay(d), 'evening', 'in the evening, not the morning');
  eq(churchHour(d), 20, '8pm');
}

group('the rest of the day is unaffected');
{
  // Nothing about this may change the answer during office hours, which is
  // most of when the admin is actually used.
  const d = new Date('2026-08-06T15:00:00Z'); // 10am Central
  eq(churchDate(d), '2026-08-06', 'a mid-morning date is the same either way');
  eq(partOfDay(d), 'morning', 'morning');
  eq(churchFormat({ weekday: 'long' }, d), 'Thursday', 'Thursday');
}

group('daylight saving is Intl’s problem, not ours');
{
  // Central is UTC-5 in summer and UTC-6 in winter. A hardcoded offset gets
  // one of these two wrong, which is the whole reason this goes through Intl.
  eq(churchHour(new Date('2026-07-01T17:00:00Z')), 12, 'July: UTC-5, so 5pm UTC is noon');
  eq(churchHour(new Date('2026-01-01T17:00:00Z')), 11, 'January: UTC-6, so 5pm UTC is 11am');
  // Either side of the same winter midnight.
  eq(churchDate(new Date('2026-01-02T05:59:00Z')), '2026-01-01', 'still the 1st at 11:59pm Central');
  eq(churchDate(new Date('2026-01-02T06:01:00Z')), '2026-01-02', 'the 2nd a minute later');
}

group('midnight does not read as evening');
{
  // ⚠ `hour12: false` renders midnight as "24" in some engines, which would
  // put the greeting an entire part-of-day out at 12:30am.
  const midnight = new Date('2026-08-07T05:30:00Z'); // 12:30am Central
  eq(churchHour(midnight), 0, 'midnight is hour 0, never 24');
  eq(partOfDay(midnight), 'morning', 'and half past midnight is the morning');
  eq(partOfDay(new Date('2026-08-06T17:30:00Z')), 'afternoon', '12:30pm is the afternoon');
  eq(partOfDay(new Date('2026-08-06T23:00:00Z')), 'evening', '6pm is the evening');
}

group('adding days is calendar arithmetic, not milliseconds');
{
  const d = new Date('2026-08-07T01:00:00Z'); // Thursday the 6th, church time
  eq(churchDatePlus(0, d), '2026-08-06', 'zero days is today');
  eq(churchDatePlus(3, d), '2026-08-09', 'three days on');
  eq(churchDatePlus(90, d), '2026-11-04', 'the news form’s 90-day expiry default');
  eq(churchDatePlus(-1, d), '2026-08-05', 'and it goes backwards');

  // ⚠ Across a DST boundary a day is 23 or 25 hours long, so adding days in
  // MILLISECONDS lands an hour out — and an hour is enough to cross midnight
  // and report the wrong DAY. It only bites when the local time is within that
  // hour of midnight, which is why this case is pinned to 11:30pm rather than
  // to the evening above, where the two approaches agree and the case would
  // prove nothing.
  //
  // 11:30pm Central on 2026-03-07, the night before Central springs forward.
  // The news form's expiry default is +90 days from whenever it is opened, so
  // this is a real instant somebody can hit, not a contrived one.
  const lateBeforeDst = new Date('2026-03-08T05:30:00Z');
  eq(churchDate(lateBeforeDst), '2026-03-07', 'that instant really is the 7th, at 11:30pm');
  const naive = new Date(lateBeforeDst.getTime() + 90 * 86400000);
  const naiveDate = churchDate(naive);
  eq(naiveDate, '2026-06-06', 'the millisecond version slips a day forward');
  eq(churchDatePlus(90, lateBeforeDst), '2026-06-05', 'the calendar version does not');
  ok(naiveDate !== churchDatePlus(90, lateBeforeDst), 'the two really do disagree here');

  // Month and year ends.
  eq(churchDatePlus(1, new Date('2026-01-31T18:00:00Z')), '2026-02-01', 'end of a month');
  eq(churchDatePlus(1, new Date('2026-12-31T18:00:00Z')), '2027-01-01', 'end of a year');
  eq(churchDatePlus(1, new Date('2028-02-28T18:00:00Z')), '2028-02-29', 'a leap day');
}

group('the shape is what the database already stores');
{
  // Every date column in this schema is 'YYYY-MM-DD'. A helper that returned
  // anything else would compare wrong in SQL without erroring.
  ok(/^\d{4}-\d{2}-\d{2}$/.test(churchDate()), 'churchDate is YYYY-MM-DD: ' + churchDate());
  ok(/^\d{4}-\d{2}-\d{2}$/.test(churchDatePlus(90)), 'and so is churchDatePlus: ' + churchDatePlus(90));
  // Zero-padded, so string comparison and date comparison agree.
  eq(churchDate(new Date('2026-03-05T18:00:00Z')), '2026-03-05', 'single digits are padded');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
