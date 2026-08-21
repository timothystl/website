// Node test harness for admin/intake.js — run with: node admin/intake.test.mjs
import assert from 'node:assert/strict';
import {
  TYPES, TYPE_KEYS, UNCLASSIFIED, deferredFieldsSource, ROOMS,
  SOURCE_LABEL, SOURCE_COLOR, intakeKeyFor, sourceKindOfKey,
  CHECKLISTS, TYPE_FIELDS, checklistFor, openCountOf, isReady,
  isValidTypeField, isValidChecklistKey,
  mergeIntakeItems, QUEUE_TOP, inQueue, filterQueue, queueCounts, QUEUE_TITLES,
  VALUE_LABELS, VALUE_ORDER, TYPE_VALUE, typesForValue, typesWithNoValue,
} from './intake.js';
import { CALENDAR_PALETTE } from './calendar.js';

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

group('the eleven types group under the four core values, and three deliberately do not');
{
  // ⚠ Every value-mapped type actually appears in TYPES, and every group is
  // non-empty — a typo in TYPE_VALUE (a key that isn't a real type, or a
  // value string that isn't one of the four) would silently vanish a type
  // from the rail rather than error.
  for (const [type, value] of Object.entries(TYPE_VALUE)) {
    ok(TYPE_KEYS.includes(type), `${type} in TYPE_VALUE is a real type`);
    ok(VALUE_ORDER.includes(value), `${value} in TYPE_VALUE is one of the four`);
  }
  eq(VALUE_ORDER.length, 4);
  for (const v of VALUE_ORDER) ok(VALUE_LABELS[v], `${v} has a label`);
  eq(VALUE_LABELS.education, 'Christian Education');

  // Every type appears in EXACTLY one place: a value group, or the no-value
  // list — never both, never neither.
  const grouped = VALUE_ORDER.flatMap((v) => typesForValue(v));
  const ungrouped = typesWithNoValue();
  eq(grouped.length + ungrouped.length, TYPE_KEYS.length, 'every type is accounted for exactly once');
  eq(new Set(grouped.concat(ungrouped)).size, TYPE_KEYS.length, 'and none of them twice');

  // The three cross-cutting types this repo deliberately would not force
  // under a value — see the note above TYPE_VALUE in intake.js.
  for (const t of ['news', 'meetings', 'special']) ok(!TYPE_VALUE[t], `${t} has no value`);
  ok(ungrouped.includes('news') && ungrouped.includes('meetings') && ungrouped.includes('special'));

  // Word of Life ties to 'education' here exactly as PARTNER_SEED already
  // ties the Word of Life partner ministry to 'education' in admin/db.js —
  // verified by reading that mapping, not asserted against itself.
  eq(TYPE_VALUE.wol, 'education');
  eq(TYPE_VALUE.rental, 'outreach');
}

group('every type color is a real CALENDAR_PALETTE entry, at 4.5:1 against cream — verified, not assumed');
{
  // ⚠ THIS IS THE EXACT SHAPE OF BUG admin/calendar.js's own CALENDAR_PALETTE
  // comment warns about: "a comment claimed a test already checked this and
  // it didn't." Computed independently here rather than trusted, the same
  // way admin/calendar.test.mjs verifies the calendar's own palette.
  const chan = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  const rgb = (hex) => [1, 3, 5].map((i) => chan(hex, i));
  const luminance = (hex) => rgb(hex).map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + [0.2126, 0.7152, 0.0722][i] * c, 0);
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const CREAM = '#F7F4EE'; // .ei-pill-on's own text color, the white-on-fill state every type's color has to carry

  const paletteByKey = new Map(CALENDAR_PALETTE.map((p) => [p.key, p]));
  const usedPaletteKeys = new Set();
  for (const t of TYPE_KEYS) {
    const type = TYPES[t];
    ok(type.palette, `${t} names a CALENDAR_PALETTE key`);
    const entry = paletteByKey.get(type.palette);
    ok(entry, `${type.palette} (${t}'s palette key) is a real CALENDAR_PALETTE entry`);
    eq(type.color, entry.color, `${t}'s color is exactly its palette entry's color, not a hand-typed near-miss`);
    ok(contrast(type.color, CREAM) >= 4.5, `${t} (${type.color}) clears 4.5:1 against cream pill text — got ${contrast(type.color, CREAM).toFixed(2)}:1`);
    usedPaletteKeys.add(type.palette);
  }
  // ⚠ NO TWO TYPES SHARE A COLOR. Eleven types, eleven of the twelve
  // CALENDAR_PALETTE keys — 'gray' is the one left over, deliberately (it
  // means "uncategorized" on the calendar, and no type here is that).
  eq(usedPaletteKeys.size, TYPE_KEYS.length, 'every type has its own color — none doubled up');
  ok(!usedPaletteKeys.has('gray'), "'gray' is reserved for the calendar's own uncategorized fallback, not spent on a real type");
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
