// Node test harness for admin/newsletter.js — run with: node admin/newsletter.test.mjs
//
// The weekly email reaches ~600 people and cannot be recalled, so the rules
// that matter here are the ones that stop something going out wrong, or going
// out twice: what counts as sent, what a sent issue may still allow, and what
// happens to an issue written before any of these fields existed.
import {
  BLOCKS, BLOCK_KEYS, parseBlocks, serializeBlocks, blockOn,
  AUDIENCES, normalizeAudience, subjectAdvice, preheaderAdvice,
  SUBJECT_LIMIT, PREHEADER_LIMIT, isSent, canEdit, approvalState,
  issueStatus, sendSummary,
} from './newsletter.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// ── blocks ───────────────────────────────────────────────────────────────────
group('what goes in an issue');
{
  ok(BLOCKS.length >= 10, 'there is a switch per block');
  eq(BLOCKS.filter((b) => b.locked).length, 1, 'exactly one block is locked on');
  eq(BLOCKS.find((b) => b.locked).key, 'pastor', 'and it is the pastor’s note — an issue without it is not a newsletter');

  // THE migration case: an issue written before blocks existed has none stored.
  // Absent must mean everything ON. Defaulting to off would silently empty an
  // issue somebody had already written and was about to send.
  const legacy = parseBlocks(null);
  eq(Object.values(legacy).every(Boolean), true, 'an issue with no stored blocks has everything on');
  eq(parseBlocks('')['news'], true, 'an empty string is treated the same way');
  eq(parseBlocks('not json')['news'], true, 'and so is unparseable rubbish, rather than throwing');

  const some = parseBlocks(JSON.stringify({ news: false, wol: false }));
  eq(some.news, false, 'a stored off switch is respected');
  eq(some.wol, false, 'for each block named');
  eq(some.events, true, 'a block not mentioned stays on');
  eq(some.pastor, true, 'and the locked block is on whatever is stored');

  // A stale tab must not be able to switch off the locked block.
  eq(parseBlocks(JSON.stringify({ pastor: false })).pastor, true, 'the pastor’s note cannot be switched off, even by a direct write');
  eq(JSON.parse(serializeBlocks({ pastor: false, news: false })).pastor, true, 'nor on the way back in');
  eq(JSON.parse(serializeBlocks({ news: false })).news, false, 'while a real off switch round-trips');

  eq(blockOn(null, 'events'), true, 'blockOn reads the same defaults');
  eq(blockOn(JSON.stringify({ events: false }), 'events'), false, 'and the same stored values');

  // Serialising then parsing must be stable, or a save flips switches.
  const round = parseBlocks(serializeBlocks(parseBlocks(JSON.stringify({ news: false }))));
  eq(round.news, false, 'round-tripping does not flip a switch');
  eq(round.events, true, 'or turn one on');
}

// ── audience ─────────────────────────────────────────────────────────────────
group('who gets it');
{
  eq(AUDIENCES.length, 3, 'three audiences');
  eq(normalizeAudience('church'), 'church', 'a real audience passes through');
  eq(normalizeAudience('everybody-i-know'), 'everyone', 'anything else falls back to everyone');
  eq(normalizeAudience(null), 'everyone', 'including nothing at all');
}

// ── subject and preheader ────────────────────────────────────────────────────
group('subject and preheader guidance');
{
  eq(subjectAdvice('').tone, 'plain', 'an empty subject is prompted, not scolded');
  eq(subjectAdvice('Sunday at Timothy').tone, 'good', 'a short subject is fine');
  eq(subjectAdvice('x'.repeat(SUBJECT_LIMIT)).tone, 'good', 'exactly at the limit is still fine');
  eq(subjectAdvice('x'.repeat(SUBJECT_LIMIT + 1)).tone, 'warn', 'one over warns');
  ok(subjectAdvice('x'.repeat(80)).text.includes('cut this off'), 'and says what will happen');

  eq(preheaderAdvice('').tone, 'plain', 'an empty preheader explains what it is for');
  eq(preheaderAdvice('x'.repeat(PREHEADER_LIMIT + 1)).tone, 'warn', 'a long preheader warns');
  eq(preheaderAdvice('Come and see').n, 12, 'the count is the character count');
}

// ── the lock ─────────────────────────────────────────────────────────────────
group('a sent issue is read-only');
{
  eq(isSent(null), false, 'nothing is not sent');
  eq(isSent({ status: 'draft' }), false, 'a draft is not sent');
  eq(isSent({ status: 'sent' }), true, 'status sent counts');
  eq(isSent({ sent_at: '2026-07-24T10:00:00Z' }), true, 'a recorded send counts');
  eq(isSent({ beehiiv_id: 'abc' }), true, 'a provider id counts');
  eq(isSent({ brevo_campaign_id: '42' }), true, 'from either provider');

  // Generosity is deliberate: a newsletter that reached anybody at all is
  // locked, whichever field happened to record it.
  eq(isSent({ status: 'draft', brevo_campaign_id: '42' }), true,
    'a draft that nonetheless went out through Brevo is still locked');

  eq(canEdit({ status: 'draft' }).ok, true, 'a draft can be edited');
  eq(canEdit({ status: 'sent' }).ok, false, 'a sent issue cannot');
  ok(canEdit({ status: 'sent' }).reason.includes('Duplicate'), 'and is told what to do instead');
  eq(canEdit(null).ok, false, 'a missing issue cannot be edited');
  ok(canEdit(null).reason.length > 0, 'and says so rather than failing silently');
}

// ── approval ─────────────────────────────────────────────────────────────────
group('two-person approval');
{
  const writer = { username: 'office', permissions: ['newsletter_edit'] };
  const approver = { username: 'dinger', permissions: ['newsletter_approve'] };

  const draft = approvalState({ approval_status: 'none' }, writer, true);
  eq(draft.state, 'draft', 'a fresh issue is a draft');
  eq(draft.canSubmit, true, 'and can be submitted');
  eq(draft.canApprove, false, 'but not approved from that state');

  const pending = approvalState({ approval_status: 'pending', submitted_by: 'office' }, approver, true);
  eq(pending.state, 'pending', 'a submitted issue is pending');
  eq(pending.canApprove, true, 'and an approver may approve it');
  eq(pending.canSubmit, false, 'and cannot be resubmitted');

  const writerLooking = approvalState({ approval_status: 'pending', submitted_by: 'office' }, writer, true);
  eq(writerLooking.canApprove, false, 'someone without the permission cannot approve');

  // The honest cases. An approval step one person completes alone is a
  // formality; saying so is more useful than implying a control that is not there.
  const selfApprove = approvalState({ approval_status: 'pending', submitted_by: 'dinger' }, approver, true);
  ok(selfApprove.note.includes('second pair of eyes'), 'approving your own submission is flagged as weaker');

  const alone = approvalState({ approval_status: 'pending', submitted_by: 'office' }, approver, false);
  ok(alone.note.includes('formality'), 'with only one approver, the step is described as a formality');

  const sent = approvalState({ status: 'sent' }, approver, true);
  eq(sent.state, 'sent', 'a sent issue is past approval');
  eq(sent.canApprove, false, 'and cannot be approved again');
  eq(sent.canSubmit, false, 'or resubmitted');
}

// ── the list ─────────────────────────────────────────────────────────────────
group('the issue list');
{
  eq(issueStatus({ status: 'draft' }).label, 'Draft', 'a draft reads as Draft');
  eq(issueStatus({ approval_status: 'pending' }).label, 'Awaiting approval', 'a submitted issue says so');
  eq(issueStatus({ status: 'sent' }).label, 'Sent', 'a sent issue says so');
  eq(issueStatus({ status: 'sent' }).tone, 'plain', 'and is grey — done, not needing attention');
  eq(issueStatus({ approval_status: 'pending' }).tone, 'warn', 'while awaiting approval is amber');

  const future = new Date(Date.now() + 864e5).toISOString();
  eq(issueStatus({ status: 'draft', scheduled_send_at: future }).label, 'Scheduled', 'a future send reads as Scheduled');
  const past = new Date(Date.now() - 864e5).toISOString();
  eq(issueStatus({ status: 'draft', scheduled_send_at: past }).label, 'Draft',
    'a schedule in the past is not still "scheduled" — it already fired or lapsed');

  eq(sendSummary({ status: 'draft' }), 'Not sent', 'an unsent issue says so plainly');
  ok(sendSummary({ status: 'sent', sent_at: '2026-07-24T10:00:00Z', sent_count: 609 }).includes('609 subscribers'),
    'a sent issue keeps its real send record');
  ok(sendSummary({ status: 'sent', sent_count: 1 }).includes('1 subscriber'), 'pluralised properly');
  eq(sendSummary({ status: 'sent' }), 'Sent', 'a sent issue with no record still reads sensibly');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
