// Node test harness for admin/intake.js — run with: node admin/intake.test.mjs
import assert from 'node:assert/strict';
import {
  TYPES, TYPE_KEYS, UNCLASSIFIED, deferredFieldsSource, ROOMS,
  SOURCE_LABEL, SOURCE_COLOR, intakeKeyFor, sourceKindOfKey,
  CHECKLISTS, TYPE_FIELDS, checklistFor, openCountOf, isReady,
  isValidTypeField, isValidChecklistKey,
  mergeIntakeItems, QUEUE_TOP, inQueue, filterQueue, queueCounts, QUEUE_TITLES,
} from './intake.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

group('every type has exactly four checklist items and four extra fields');
{
  for (const t of TYPE_KEYS) {
    eq(CHECKLISTS[t].length, 4, `${t} has four checklist items`);
    ok(Array.isArray(TYPE_FIELDS[t]) && TYPE_FIELDS[t].length >= 3, `${t} has extra fields`);
    // Every checklist item's key is unique within its own type.
    const keys = CHECKLISTS[t].map((c) => c.key);
    eq(new Set(keys).size, keys.length, `${t}'s checklist keys are unique`);
  }
  eq(UNCLASSIFIED, null, 'unclassified is null, not one of the four types');
  ok(!TYPE_KEYS.includes(null), 'and it is never in the type list itself');
}

group('deferredFieldsSource — only rental+gym and news+news defer to a real record');
{
  eq(deferredFieldsSource('rental', 'gym'), 'gym', 'a gym-sourced rental defers to Gym Rentals');
  eq(deferredFieldsSource('rental', 'gcal'), null, 'a Google-booked outside group has no gym record to defer to');
  eq(deferredFieldsSource('rental', 'local'), null, 'a hand-typed wedding has nowhere else to defer to either');
  eq(deferredFieldsSource('news', 'news'), 'news', 'a news-sourced item defers to the News & Events post');
  eq(deferredFieldsSource('news', 'gcal'), null, 'a Google event classified as news has no post yet');
  eq(deferredFieldsSource('worship', 'gcal'), null, 'worship never defers — nothing else owns a presider or a bulletin deadline');
  eq(deferredFieldsSource('education', 'news'), null, 'education never defers either');
}

group('the key space matches admin/calendar.js exactly, both directions');
{
  eq(intakeKeyFor('gcal', 'abc123'), 'g:abc123');
  eq(intakeKeyFor('news', 45), 'n:45');
  eq(intakeKeyFor('gym', 12), 'b:12');
  eq(intakeKeyFor('local', 7), 'l:7');
  eq(sourceKindOfKey('g:abc123'), 'gcal');
  eq(sourceKindOfKey('n:45'), 'news');
  eq(sourceKindOfKey('b:12'), 'gym');
  eq(sourceKindOfKey('l:7'), 'local');
  eq(sourceKindOfKey('x:1'), null, 'an unrecognized prefix is nothing, not a guess');
  eq(sourceKindOfKey(''), null);
}

group('checklistFor and openCountOf read sparse state, and survive a template addition');
{
  const full = checklistFor('worship', { readings: true, hymns: true, bulletin: true, altarguild: true });
  eq(full.filter((c) => c.done).length, 4, 'every item checked reads as four done');
  eq(openCountOf('worship', { readings: true, hymns: true, bulletin: true, altarguild: true }), 0);

  const empty = checklistFor('worship', {});
  eq(empty.filter((c) => c.done).length, 0, 'a blank state is every item unchecked, not a crash');
  eq(openCountOf('worship', {}), 4);
  eq(openCountOf('worship', null), 4, 'a null state reads the same as blank');

  // ⚠ THE PROPERTY BACKWARD COMPATIBILITY DEPENDS ON: a stored key that no
  // longer exists in the template is silently ignored, and a template key
  // that did not exist when the record was saved reads as still open.
  const partial = checklistFor('worship', { readings: true, retired_key_from_an_old_template: true });
  eq(partial.length, 4, 'the template decides how many items there are, not the stored keys');
  eq(partial.find((c) => c.key === 'readings').done, true);
  eq(partial.find((c) => c.key === 'hymns').done, false, 'an item added after this record was saved reads as open');

  eq(openCountOf('worship', {}), 4);
  eq(openCountOf(null, {}), null, 'an unclassified item has no checklist to count at all');
  eq(openCountOf('not-a-real-type', {}), null, 'and neither does a bogus type');
}

group('isReady — unclassified is never ready, and a type with every box checked is');
{
  eq(isReady({ type: null, checks: {} }), false);
  eq(isReady({ type: 'rental', checks: {} }), false, 'four unchecked boxes is not ready');
  eq(isReady({ type: 'rental', checks: { agreement: true, insurance: true, custodian: true, fee: true } }), true);
  eq(isReady({ type: 'rental', checks: { agreement: true, insurance: true, custodian: true } }), false, 'three of four is still not ready');
}

group('mergeIntakeItems — a brand-new source row is shown unclassified, not dropped');
{
  const raw = [
    { id: 'g:1', source: 'gcal', title: 'Choir Rehearsal', start: '2026-08-26T19:00:00', end: '2026-08-26T20:00:00', allDay: false, location: 'Sanctuary' },
    { id: 'n:9', source: 'news', title: 'Rally Day', start: '2026-08-23', end: '2026-08-23', allDay: true, location: '' },
  ];
  const rows = [
    { source_key: 'g:1', event_type: 'worship', room: 'Sanctuary', extra_json: '{"presider":"Pastor Dinger"}', checks_json: '{"readings":true}', published_at: null, id: 5 },
  ];
  const merged = mergeIntakeItems(raw, rows);
  eq(merged.length, 2, 'both raw items appear');
  const g1 = merged.find((m) => m.key === 'g:1');
  eq(g1.type, 'worship');
  eq(g1.extra.presider, 'Pastor Dinger');
  eq(g1.checks.readings, true);
  eq(g1.sourceKind, 'gcal');
  const n9 = merged.find((m) => m.key === 'n:9');
  eq(n9.type, null, 'a source row with no matching event_intake row is unclassified, not skipped');
  eq(n9.sourceKind, 'news');
  eq(JSON.stringify(n9.extra), '{}', 'and its extra fields are empty rather than undefined');
}

group('mergeIntakeItems — malformed stored JSON fails open rather than throwing');
{
  const raw = [{ id: 'g:2', source: 'gcal', title: 'X', start: '2026-08-01T09:00:00', end: '2026-08-01T10:00:00', allDay: false, location: '' }];
  const rows = [{ source_key: 'g:2', event_type: 'worship', room: '', extra_json: '{not json', checks_json: '[]', published_at: null, id: 6 }];
  const merged = mergeIntakeItems(raw, rows);
  eq(merged.length, 1, 'a row with corrupted JSON still renders rather than crashing the whole list');
  eq(JSON.stringify(merged[0].extra), '{}');
  eq(JSON.stringify(merged[0].checks), '{}', 'a JSON array is not an object either, and falls back the same way');
}

group('queues — "imported" is every Google item whether or not it is ready');
{
  const items = [
    { key: 'g:1', sourceKind: 'gcal', type: 'worship', checks: { readings: true, hymns: true, bulletin: true, altarguild: true }, start: '2026-08-20T09:00:00' },
    { key: 'g:2', sourceKind: 'gcal', type: null, checks: {}, start: '2026-08-21T09:00:00' },
    { key: 'n:1', sourceKind: 'news', type: 'news', checks: { description: true, photo: true, signup: true, announced: true }, start: '2026-08-19T00:00:00' },
    { key: 'b:1', sourceKind: 'gym', type: 'rental', checks: {}, start: '2026-08-22T00:00:00' },
  ];
  eq(filterQueue(items, 'imported').length, 2, 'both Google items, including the fully-checked one');
  eq(filterQueue(items, 'inbox').length, 2, 'the two not yet ready: the unclassified Google item and the open rental');
  eq(filterQueue(items, 'ready').length, 2, 'the finished worship item and the finished news item');
  eq(filterQueue(items, 'worship').length, 1);
  eq(filterQueue(items, 'rental').length, 1);
  eq(filterQueue(items, 'education').length, 0, 'a type with nothing in it counts zero, not undefined');

  const counts = queueCounts(items);
  eq(counts.inbox, 2);
  eq(counts.imported, 2);
  eq(counts.ready, 2);

  // Sorted by start, earliest first.
  const sorted = filterQueue(items, 'imported');
  ok(sorted[0].start < sorted[1].start, 'the queue lists soonest first');

  for (const q of QUEUE_TOP) ok(Array.isArray(QUEUE_TITLES[q]) && QUEUE_TITLES[q].length === 2, `${q} has a title and a subtitle`);
  for (const t of TYPE_KEYS) ok(Array.isArray(QUEUE_TITLES[t]), `${t} has queue titles too`);
}

group('field and checklist keys are checked against a list before they are used');
{
  ok(isValidTypeField('worship', 'presider'), 'a real worship field passes');
  ok(!isValidTypeField('worship', 'renter'), 'a rental field is not a worship field');
  ok(!isValidTypeField('worship', '__proto__'), 'a prototype-pollution attempt is not a field at all');
  ok(!isValidTypeField(null, 'presider'), 'unclassified has no fields to post to');
  ok(!isValidTypeField('worship', ''), 'an empty key is not a field');

  ok(isValidChecklistKey('rental', 'agreement'), 'a real rental checklist item passes');
  ok(!isValidChecklistKey('rental', 'readings'), 'a worship item is not a rental item');
  ok(!isValidChecklistKey('rental', 'constructor'), 'nor is an object-prototype name');
  ok(!isValidChecklistKey(null, 'agreement'), 'unclassified has no checklist to post to either');
}

group('ROOMS and SOURCE labels are complete');
{
  ok(ROOMS.includes('Sanctuary') && ROOMS.includes('Fellowship Hall'), 'the two rooms every rental checklist references exist');
  for (const s of ['gcal', 'news', 'gym', 'local']) {
    ok(SOURCE_LABEL[s], `${s} has a label`);
    ok(SOURCE_COLOR[s], `${s} has a color`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
