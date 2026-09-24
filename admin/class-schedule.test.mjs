// A Bible class's meeting pattern → display line and calendar dates.
// Run: node admin/class-schedule.test.mjs
import assert from 'node:assert/strict';
import { composeSchedule, parseScheduleText, classDates, formatTimeRange } from './class-schedule.js';
import { normalizeBibleClass, mergedCategories } from './calendar.js';

let pass = 0;
const test = (name, fn) => { fn(); pass++; };

test('display line: every week, one day', () => {
  assert.equal(composeSchedule({ days: '0', weeks: '', start: '09:30' }), 'Sundays · 9:30 AM');
});
test('display line: 1st & 3rd, with range and note', () => {
  assert.equal(composeSchedule({ days: [6], weeks: '1,3', start: '08:00', end: '09:15', note: 'Panera' }),
    '1st & 3rd Saturdays · 8:00–9:15 AM · Panera');
  assert.equal(composeSchedule({ days: [3], weeks: '2', start: '19:00' }), '2nd Wednesday · 7:00 PM');
});
test('display line: range across noon and multiple days', () => {
  assert.equal(formatTimeRange('11:30', '12:30'), '11:30 AM–12:30 PM');
  assert.equal(composeSchedule({ days: [0, 3], start: '10:00' }), 'Sundays & Wednesdays · 10:00 AM');
});
test('no day or no time: the note alone', () => {
  assert.equal(composeSchedule({ days: [], start: '', note: 'By arrangement' }), 'By arrangement');
  assert.equal(composeSchedule({ days: [0], start: '' }), '');
});

test('old free text is read back into a pattern', () => {
  assert.deepEqual(parseScheduleText('1st & 3rd Saturdays · 8:00 AM'),
    { days: [6], weeks: '1,3', start: '08:00', end: '', note: '' });
  assert.deepEqual(parseScheduleText('Wednesday · 10:00 AM · Sing-along at 11:00 AM'),
    { days: [3], weeks: '', start: '10:00', end: '', note: 'Sing-along at 11:00 AM' });
  assert.deepEqual(parseScheduleText('Sunday · 9:30–10:15 AM (includes parent-child closing)'),
    { days: [0], weeks: '', start: '09:30', end: '10:15', note: '' });
  assert.deepEqual(parseScheduleText('Sundays during the school year · 12:30–1:30 PM'),
    { days: [0], weeks: '', start: '12:30', end: '13:30', note: '' });
  assert.equal(parseScheduleText('By arrangement · dinger@timothystl.org').note, 'By arrangement · dinger@timothystl.org');
  assert.deepEqual(parseScheduleText('By arrangement · dinger@timothystl.org').days, []);
});

test('dates: every Sunday in October 2026', () => {
  assert.deepEqual(classDates({ meet_days: '0', start_time: '09:30' }, '2026-10-01', '2026-10-31'),
    ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
});
test('dates: 1st & 3rd Saturdays, clipped to a season', () => {
  const row = { meet_days: '6', weeks: '1,3', start_time: '08:00' };
  assert.deepEqual(classDates(row, '2026-10-01', '2026-10-31'), ['2026-10-03', '2026-10-17']);
  assert.deepEqual(classDates({ ...row, start_date: '2026-10-10' }, '2026-10-01', '2026-10-31'), ['2026-10-17']);
  assert.deepEqual(classDates({ ...row, end_date: '2026-10-10' }, '2026-10-01', '2026-10-31'), ['2026-10-03']);
});
test('dates: none without a day or a time', () => {
  assert.deepEqual(classDates({ meet_days: '', start_time: '09:30' }, '2026-10-01', '2026-10-31'), []);
  assert.deepEqual(classDates({ meet_days: '0', start_time: '' }, '2026-10-01', '2026-10-31'), []);
});

test('calendar entries are wall-clock, Learn-colored, one per date', () => {
  const cats = mergedCategories([]);
  const evs = normalizeBibleClass({ id: 7, title: 'Junior & Senior High Bible Class', meet_days: '0',
    start_time: '09:30', end_time: '10:30', location: '3rd Floor Youth Room', leader: 'Gary Krekow',
    description: '<p>Scripture together.</p>' }, '2026-10-01', '2026-10-11', cats);
  assert.equal(evs.length, 2);
  assert.deepEqual(evs[0], {
    id: 'c:7:2026-10-04', start: '2026-10-04T09:30:00', end: '2026-10-04T10:30:00', allDay: false,
    title: 'Junior & Senior High Bible Class', location: '3rd Floor Youth Room',
    description: 'Scripture together.\n\nLed by Gary Krekow', category: 'learn', source: 'class', url: '/education',
  });
});

console.log(`class-schedule: ${pass} passed`);
