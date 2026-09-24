// A Bible class's meeting pattern → display line and calendar dates.
// Run: node admin/class-schedule.test.mjs
import assert from 'node:assert/strict';
import { composeSchedule, parseScheduleText, classDates, formatTimeRange } from './class-schedule.js';
import { normalizeBibleClass, mergedCategories, groupClassEvents, dedupeEvents, findCalendarMatches, findGroupSuggestions } from './calendar.js';

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
    classId: 7, group: '', aliases: [], leader: 'Gary Krekow',
  });
});

const cats = mergedCategories([]);
const oct = (row) => normalizeBibleClass(row, '2026-10-04', '2026-10-04', cats);
const adult = { id: 1, title: 'Adult Bible Class', meet_days: '0', start_time: '09:30', end_time: '10:30', location: 'Fellowship Hall', calendar_group: 'Christian Education' };
const youth = { id: 2, title: 'Junior & Senior High Bible Class', meet_days: '0', start_time: '09:30', location: '3rd Floor Youth Room', calendar_group: 'Christian Education' };
const school = { id: 3, title: 'Sunday School', meet_days: '0', start_time: '09:30', end_time: '10:15', calendar_group: 'Christian Education' };
const confirm = { id: 4, title: 'Confirmation', meet_days: '0', start_time: '12:30', end_time: '13:30', calendar_group: 'Christian Education' };

test('a group meeting at one time becomes one entry', () => {
  const out = groupClassEvents([...oct(adult), ...oct(youth), ...oct(school), ...oct(confirm)]);
  assert.equal(out.length, 2, 'the 9:30 classes fold together; 12:30 Confirmation stands alone');
  const ce = out.find((e) => e.title === 'Christian Education');
  assert.equal(ce.start, '2026-10-04T09:30:00');
  assert.equal(ce.end, '2026-10-04T10:30:00', 'spans to the latest end');
  assert.deepEqual(ce.classIds, [1, 2, 3]);
  assert.match(ce.description, /9:30 AM · Adult Bible Class — Fellowship Hall/);
  assert.equal(out.find((e) => e.classId === 4).title, 'Confirmation', 'a class alone in its slot keeps its name');
});
test('an ungrouped class is untouched', () => {
  const out = groupClassEvents([...oct({ ...adult, calendar_group: '' }), ...oct(youth)]);
  assert.deepEqual(out.map((e) => e.title).sort(), ['Adult Bible Class', 'Junior & Senior High Bible Class']);
});
test('an alias makes a differently named Google event merge', () => {
  const g = { id: 'g:x', title: 'Bible Class', start: '2026-10-04T09:30:00', end: '2026-10-04T10:30:00', allDay: false, source: 'gcal', category: 'learn' };
  assert.equal(dedupeEvents([g, ...oct(adult)]).length, 2, 'without an alias both stay');
  const merged = dedupeEvents([g, ...oct({ ...adult, calendar_aliases: 'Bible Class' })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'Adult Bible Class', 'the class wins the words');
  const grouped = groupClassEvents([...oct(adult), ...oct(youth)]);
  assert.equal(dedupeEvents([{ ...g, title: 'Adult Bible Class' }, ...grouped]).length, 1, 'a group answers to its members’ names');
});
test('possible matches: similar name, same slot, not yet decided', () => {
  const google = [
    { title: 'Bible Class', start: '2026-10-04T09:30:00', allDay: false, category: 'other' },
    { title: 'Bible Class', start: '2026-10-11T09:30:00', allDay: false, category: 'other' },
    { title: 'Handbells', start: '2026-10-04T09:30:00', allDay: false, category: 'music' },
    { title: 'Bible Study', start: '2026-10-04T18:00:00', allDay: false, category: 'other' },
    { title: 'Adult Bible Class', start: '2026-10-04T09:30:00', allDay: false, category: 'other' },
  ];
  const rows = [{ ...adult, calendar_group: '' }];
  const m = findCalendarMatches(rows, google, '2026-10-01', '2026-10-31');
  assert.equal(m.length, 1, 'only "Bible Class": Handbells shares no word, the evening one is another time, the exact name already merges');
  assert.equal(m[0].googleTitle, 'Bible Class');
  assert.equal(m[0].count, 2);
  assert.equal(findCalendarMatches([{ ...rows[0], calendar_aliases: 'Bible Class' }], google, '2026-10-01', '2026-10-31').length, 0, 'confirmed');
  assert.equal(findCalendarMatches([{ ...rows[0], not_matches: 'Bible Class' }], google, '2026-10-01', '2026-10-31').length, 0, 'dismissed');
});
test('group suggestions: same day and time, not yet one group', () => {
  const a = { ...adult, active: 1, calendar_group: '' }, y = { ...youth, active: 1, calendar_group: '' };
  const s = findGroupSuggestions([a, y, { ...confirm, active: 1 }]);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].classes.map((c) => c.id), [1, 2]);
  assert.equal(findGroupSuggestions([{ ...a, calendar_group: 'CE' }, { ...y, calendar_group: 'CE' }]).length, 0, 'already grouped');
  assert.equal(findGroupSuggestions([a, { ...y, active: 0 }]).length, 0, 'paused classes are left out');
});

console.log(`class-schedule: ${pass} passed`);
