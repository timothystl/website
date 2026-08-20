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
  issueStatus, sendSummary, parseSubscriberCsv,
  parseExtras, extrasFromForm, serializeExtras, MAX_EXTRA_NOTES,
  prettyClock, eventRowFromPost, orderEventRows,
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

  // Serializing then parsing must be stable, or a save flips switches.
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
  eq(issueStatus({ status: 'sent' }).tone, 'plain', 'and is gray — done, not needing attention');
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


group('the subscriber CSV import');
{
  // A real Brevo export: header row, quoted fields, first and last apart.
  const brevo = parseSubscriberCsv(
    'EMAIL,FIRSTNAME,LASTNAME,SMS\n' +
    '"jane@example.com","Jane","Smith",\n' +
    '"bob@example.com","Bob","",\n');
  eq(brevo.rows.length, 2, 'both people are read');
  eq(brevo.rows[0].email, 'jane@example.com', 'the address comes from the EMAIL column');
  eq(brevo.rows[0].name, 'Jane Smith', 'and the name is assembled from first and last');
  eq(brevo.rows[1].name, 'Bob', 'an empty last name does not leave a trailing space');

  // A spreadsheet somebody keeps by hand: one "Name" column, different order.
  const byHand = parseSubscriberCsv('Name,Email\nAnn Brown,ann@example.com\n');
  eq(byHand.rows[0].email, 'ann@example.com', 'column order does not matter');
  eq(byHand.rows[0].name, 'Ann Brown', 'a single Name column is used as-is');

  // No header at all. The first line is data, and a cell that looks like an
  // address is treated as one — a file that arrives without a header is the
  // common case, not an error.
  const bare = parseSubscriberCsv('ann@example.com\nbob@example.com\n');
  eq(bare.rows.length, 2, 'a headerless file still imports');
  eq(bare.rows[0].name, '', 'with no name invented');

  // Semicolons and tabs separate too — Excel exports both depending on locale.
  eq(parseSubscriberCsv('a@b.com;Ann').rows[0].name, 'Ann', 'semicolons separate');
  eq(parseSubscriberCsv('a@b.com\tAnn').rows[0].name, 'Ann', 'so do tabs');

  // Nothing is rejected silently. A line with no address is counted, because
  // somebody pasting 200 lines and getting 180 back needs to know about the 20.
  const messy = parseSubscriberCsv('Email,Name\nann@example.com,Ann\n,Nobody\njust some text\n');
  eq(messy.rows.length, 1, 'only the usable row is imported');
  eq(messy.skipped, 2, 'and the rest are counted, not dropped quietly');

  // The same address twice in one file is one person.
  const dup = parseSubscriberCsv('Email\nann@example.com\nANN@example.com\n');
  eq(dup.rows.length, 1, 'a repeated address is imported once, case-insensitively');

  eq(parseSubscriberCsv('').rows.length, 0, 'an empty paste imports nothing');
  eq(parseSubscriberCsv(null).rows.length, 0, 'and so does nothing at all');
}


// ── extra notes ──────────────────────────────────────────────────────────────
// The pastor's note, a secondary and a tertiary were the three free-form blocks
// an issue could carry. Some weeks need a fourth or a fifth.
group('extra notes');
{
  eq(parseExtras('[]').length, 0, 'an issue with none has none');
  eq(parseExtras(null).length, 0, 'and neither does one written before the column existed');
  eq(parseExtras('not json').length, 0, 'a corrupt value is empty rather than a crash');
  eq(parseExtras({ title: 'x' }).length, 0, 'and so is something that is not a list');

  const two = parseExtras([{ title: 'Thank you', body: '<p>To everyone who helped.</p>' }, { title: '', body: '<p>A correction.</p>' }]);
  eq(two.length, 2, 'two notes come back as two');
  eq(two[0].title, 'Thank you', 'with their headings');
  eq(two[1].title, '', 'a heading is optional — the note simply starts');

  // A note with no body is not a note. Dropped here rather than at render time,
  // so a slot somebody opened and thought better of never reaches the email.
  eq(parseExtras([{ title: 'Heading only', body: '' }]).length, 0, 'a heading with no body is not a note');
  eq(parseExtras([{ title: '', body: '   ' }]).length, 0, 'nor is whitespace');

  // Blank slots collapse, so filling the third box without the second does not
  // leave a hole in the email.
  const form = new Map([
    ['extra_title_0', ''], ['extra_note_0', ''],
    ['extra_title_1', ''], ['extra_note_1', ''],
    ['extra_title_2', 'Late addition'], ['extra_note_2', '<p>One more thing.</p>'],
  ]);
  const fromForm = extrasFromForm({ get: (k) => form.get(k) });
  eq(fromForm.length, 1, 'only the filled slot is kept');
  eq(fromForm[0].title, 'Late addition', 'and it keeps its heading');

  // Bounded, so a crafted POST cannot make an issue of arbitrary length.
  const many = parseExtras(Array.from({ length: 20 }, (_, i) => ({ title: 't' + i, body: '<p>x</p>' })));
  eq(many.length, MAX_EXTRA_NOTES, 'no more than the form can offer is ever stored');

  eq(JSON.parse(serializeExtras([{ title: 'A', body: '<p>b</p>' }])).length, 1, 'serializing round-trips');
  eq(serializeExtras([]), '[]', 'and empty is an empty list, not null');
}


// ── upcoming events, picked rather than retyped ──────────────────────────────
group('an issue\'s event rows are built from posts, not typed');
{
  eq(prettyClock('19:00'), '7:00 pm', 'evening reads as a person would say it');
  eq(prettyClock('09:05'), '9:05 am', 'and the morning keeps its minutes');
  eq(prettyClock('12:00'), '12:00 pm', 'noon is 12 pm, not 0 pm');
  eq(prettyClock('00:30'), '12:30 am', 'and half past midnight is 12:30 am, not 0:30');
  // ⚠ A HALF-TYPED VALUE MUST NOT BE ECHOED. This string is printed as-is
  // into ~600 inboxes; `19:` reaching one of them is worse than no time.
  for (const bad of ['', null, undefined, '25:00', '7pm', 'noon', '19']) {
    eq(prettyClock(bad), '', `${JSON.stringify(bad)} prints nothing at all`);
  }

  const row = eventRowFromPost({ id: 12, title: ' Council meeting ', summary: 'Fellowship Hall.', event_date: '2026-09-01', event_time: '19:00' });
  eq(row.news_item_id, 12, 'the row remembers which post it came from');
  eq(row.event_name, 'Council meeting');
  eq(row.event_time, '7:00 pm');
  eq(row.event_desc, 'Fellowship Hall.', "the post's own summary is the one-line description");

  // ⚠ ORDER IS BY DATE, NOT BY TICK ORDER. A checkbox list posts in document
  // order, which is already by date — but a hand-kept legacy row has no place
  // in that sequence, and appending it would print February under March.
  const ordered = orderEventRows([
    { event_name: 'Later', event_date: '2026-09-20' },
    { event_name: 'Typed', event_date: '2026-09-02' },
    { event_name: 'Sooner', event_date: '2026-09-01' },
  ]);
  eq(ordered.map((r) => r.event_name).join(','), 'Sooner,Typed,Later', 'everything sorts on the date it falls on');
  eq(ordered.map((r) => r.sort_order).join(','), '0,1,2', 'and sort_order is renumbered from scratch');

  // A dateless row sits at the END rather than at the top pretending to be
  // the next thing happening.
  const withBlank = orderEventRows([
    { event_name: 'Undated' },
    { event_name: 'Dated', event_date: '2026-09-01' },
  ]);
  eq(withBlank[0].event_name, 'Dated');
  eq(withBlank[1].event_name, 'Undated', 'a dateless row goes last, not first');

  // Two on one day keep the order they arrived in, so the office can decide it.
  const sameDay = orderEventRows([
    { event_name: 'Second', event_date: '2026-09-01' },
    { event_name: 'First', event_date: '2026-09-01' },
  ]);
  eq(sameDay.map((r) => r.event_name).join(','), 'Second,First', 'a tie keeps the order it was given');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
