// Node test harness for admin/audit.js — run with: node admin/audit.test.mjs
//
// The log is only worth having if somebody can read it, so what is tested here
// is mostly the reading: that a diff shows the field that changed and not the
// six that did not, and that a row which cannot be rolled back says why rather
// than just lacking a button.
import {
  parseState, diffStates, diffSummary, auditGroup, canRollback, rollbackNote, actionTone,
} from './audit.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

group('parsing stored state');
{
  eq(parseState(null), null, 'null is null');
  eq(parseState('not json'), null, 'unparseable JSON is null rather than a throw');
  eq(parseState('{"a":1}').a, 1, 'a JSON string parses');
  eq(parseState({ a: 1 }).a, 1, 'an object passes through');
}

group('the diff');
{
  const d = diffStates({ title: 'Old', body: 'same', pinned: 0 }, { title: 'New', body: 'same', pinned: 0 });
  eq(d.length, 1, 'only the field that changed appears');
  eq(d[0].field, 'title', 'named');
  eq(d[0].from, 'Old', 'with what it was');
  eq(d[0].to, 'New', 'and what it became');

  // Timestamps change on every save and tell nobody anything.
  const noisy = diffStates({ title: 'A', updated_at: '1' }, { title: 'A', updated_at: '2' });
  eq(noisy.length, 0, 'a changed timestamp alone is not a change worth showing');

  const withNoise = diffStates({ title: 'A', updated_at: '1' }, { title: 'B', updated_at: '2' });
  eq(withNoise.length, 1, 'and does not pad out a real change');
  eq(withNoise[0].field, 'title', 'leaving the field that matters');

  // Empty is a value people set on purpose.
  const cleared = diffStates({ summary: 'Something' }, { summary: '' });
  eq(cleared.length, 1, 'clearing a field is a change');
  eq(cleared[0].to, 'empty', 'and reads as empty rather than as nothing');

  // Long values are summarized — a diff full of markup is a diff nobody reads.
  const long = diffStates({ body: 'x'.repeat(500) }, { body: 'y'.repeat(900) });
  eq(long[0].from, '500 characters', 'a long value is described by length');
  eq(long[0].to, '900 characters', 'on both sides');

  eq(diffStates({ on: true }, { on: false })[0].to, 'off', 'a boolean reads as on/off');
  eq(diffStates(null, null).length, 0, 'two nulls diff to nothing');
}
{
  group('creates and deletes');
  const created = diffStates(null, { title: 'New post', summary: '', body: 'Hello' });
  ok(created.some((x) => x.field === 'title' && x.from === null), 'a create lists what it set');
  ok(!created.some((x) => x.field === 'summary'), 'skipping fields it left empty');

  const deleted = diffStates({ title: 'Gone', body: 'Bye' }, null);
  ok(deleted.every((x) => x.to === null), 'a delete lists what was lost');
  ok(deleted.some((x) => x.field === 'title'), 'by name');
}

group('the one-line summary');
{
  eq(diffSummary({ title: 'A' }, { title: 'B' }), 'title: A → B', 'reads as field: before → after');
  eq(diffSummary({ a: '1', b: '2', c: '3' }, { a: 'x', b: 'y', c: 'z' }),
    'a: 1 → x · b: 2 → y · and 1 more', 'and is capped so the row stays a row');
  eq(diffSummary({ a: '1' }, { a: '1' }), '', 'no change summarizes to nothing');
  eq(diffSummary(null, { title: 'New' }), 'title: New', 'a create reads without an arrow');
  eq(diffSummary({ title: 'Old' }, null), 'title: was Old', 'and a delete says was');
}

group('grouping');
{
  eq(auditGroup({ entity_type: 'news_item', action: 'update' }), 'content', 'a news post is content');
  eq(auditGroup({ entity_type: 'user', action: 'update' }), 'people-ops', 'a user is people & ops');
  eq(auditGroup({ entity_type: 'gym_booking', action: 'create' }), 'people-ops', 'so is a booking');
  eq(auditGroup({ entity_type: 'news_item', action: 'rollback' }), 'rolled-back', 'a rollback is its own group');
  // A type nobody has classified yet must land somewhere, or it vanishes from
  // every filter and effectively from the log.
  eq(auditGroup({ entity_type: 'something_new', action: 'update' }), 'content',
    'an unrecognized entity type falls into content rather than disappearing');
  eq(auditGroup(null), 'content', 'and nothing at all does not throw');
}

group('what can be put back');
{
  const upd = { action: 'update', entity_type: 'news_item', before_state: '{"title":"Old"}' };
  eq(canRollback(upd), true, 'an update with a recorded before state can be rolled back');
  eq(rollbackNote(upd), '', 'and needs no explanation');

  eq(canRollback({ action: 'create', entity_type: 'news_item', before_state: null }), false, 'a create cannot');
  ok(rollbackNote({ action: 'create' }).includes('Nothing to go back to'), 'and says why');

  eq(canRollback({ action: 'delete', entity_type: 'news_item', before_state: '{}' }), false, 'a delete cannot');
  ok(rollbackNote({ action: 'delete' }).includes('cannot be undone'), 'and says why');

  eq(canRollback({ action: 'update', entity_type: 'user', before_state: '{}' }), false, 'a user change cannot, yet');
  ok(rollbackNote({ action: 'update', entity_type: 'user', before_state: '{}' }).includes('cannot be rolled back yet'),
    'and says so rather than just lacking a button');

  eq(canRollback({ action: 'update', entity_type: 'news_item', before_state: null }), false, 'nor one with no before state');
  ok(rollbackNote({ action: 'update', entity_type: 'news_item', before_state: null }).includes('No previous state'), 'and says why');

  ok(rollbackNote({ action: 'rollback' }).includes('itself a rollback'), 'a rollback entry explains itself');
  eq(canRollback(null), false, 'nothing is not rollbackable');
}

group('tones');
{
  eq(actionTone('delete'), 'bad', 'a delete is red');
  eq(actionTone('create'), 'good', 'a create is green');
  eq(actionTone('rollback'), 'auto', 'a rollback is the automatic tone');
  eq(actionTone('update'), 'plain', 'an update is unremarkable');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
