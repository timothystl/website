// ── NEWSLETTER RULES ─────────────────────────────────────────
// The weekly email is the one thing in this admin that reaches ~600 people and
// cannot be taken back. So the rules that decide whether an issue may still be
// changed, and who may send it, live here as pure functions rather than as
// conditions scattered through a route.
//
// Nothing here touches D1 or the Request. See admin/newsletter.test.mjs.

// ── WHAT GOES IN AN ISSUE ────────────────────────────────────
// One switch per block. A light week is a few clicks rather than deleting
// content you will want back next week — switching a block off hides it from
// the form *and* the email, but the words stay in the database.
//
// The pastor's note is locked on. An issue with nothing in it is not a
// newsletter, and this is the block that makes it one.
export const BLOCKS = [
  { key: 'pastor',   label: "Pastor's note",     locked: true },
  { key: 'secondary', label: 'Second note' },
  { key: 'news',     label: 'News posts' },
  { key: 'events',   label: 'Upcoming events' },
  { key: 'classes',  label: 'Bible classes' },
  { key: 'sermon',   label: 'This Sunday' },
  { key: 'wol',      label: 'Word of Life' },
  { key: 'lasm',     label: 'LASM' },
  { key: 'tertiary', label: 'Third note & button' },
  { key: 'cta',      label: 'Main button' },
  { key: 'bulletin', label: 'Bulletin download' },
];

export const BLOCK_KEYS = BLOCKS.map((b) => b.key);
const LOCKED = new Set(BLOCKS.filter((b) => b.locked).map((b) => b.key));

// An issue written before blocks existed has none stored. It must render
// exactly as it always did, so absent means everything on — never everything
// off, which would silently empty an issue somebody had already written.
export function parseBlocks(raw) {
  let stored = null;
  try { stored = raw ? JSON.parse(raw) : null; } catch (_) { stored = null; }
  const out = {};
  for (const b of BLOCKS) {
    if (LOCKED.has(b.key)) { out[b.key] = true; continue; }
    out[b.key] = (stored && typeof stored === 'object' && b.key in stored) ? !!stored[b.key] : true;
  }
  return out;
}

export function serializeBlocks(obj) {
  const out = {};
  for (const b of BLOCKS) out[b.key] = LOCKED.has(b.key) ? true : !!(obj && obj[b.key]);
  return JSON.stringify(out);
}

export function blockOn(raw, key) {
  return !!parseBlocks(raw)[key];
}

// ── WHO GETS IT ──────────────────────────────────────────────
export const AUDIENCES = [
  { key: 'everyone', label: 'Everyone' },
  { key: 'church',   label: 'Church only' },
  { key: 'school',   label: 'School & MDO families' },
];
const AUDIENCE_KEYS = new Set(AUDIENCES.map((a) => a.key));
export function normalizeAudience(v) {
  return AUDIENCE_KEYS.has(v) ? v : 'everyone';
}

// ── SUBJECT AND PREHEADER ────────────────────────────────────
// Phones truncate a subject around 60 characters and the preheader — the grey
// line after the subject in an inbox — around 110. Neither is a hard limit, so
// these are guidance, never a block on saving: a subject that is too long is a
// worse email, not an invalid one.
export const SUBJECT_LIMIT = 60;
export const PREHEADER_LIMIT = 110;

export function subjectAdvice(subject) {
  const n = String(subject || '').length;
  if (n === 0) return { n, tone: 'plain', text: 'A subject line is the first thing anyone sees.' };
  if (n > SUBJECT_LIMIT) return { n, tone: 'warn', text: `${n} characters — phones will cut this off around ${SUBJECT_LIMIT}.` };
  return { n, tone: 'good', text: `${n} of about ${SUBJECT_LIMIT} characters.` };
}

export function preheaderAdvice(text) {
  const n = String(text || '').length;
  if (n === 0) return { n, tone: 'plain', text: 'Without this, inboxes show the first words of the email instead.' };
  if (n > PREHEADER_LIMIT) return { n, tone: 'warn', text: `${n} characters — most inboxes stop around ${PREHEADER_LIMIT}.` };
  return { n, tone: 'good', text: `${n} of about ${PREHEADER_LIMIT} characters.` };
}

// ── THE LOCK ─────────────────────────────────────────────────
// A sent issue is read-only. This is the rule the whole phase turns on: once
// ~600 people have a copy in their inbox, the archived copy on the website must
// keep saying what was actually sent. Editing it would make the archive a lie.
//
// `isSent` is deliberately generous about what counts as sent — status, a
// recorded send, or a provider id. A newsletter that reached anybody at all is
// locked, whichever of those recorded it.
export function isSent(row) {
  if (!row) return false;
  if (row.status === 'sent') return true;
  if (row.sent_at) return true;
  if (row.beehiiv_id || row.brevo_campaign_id) return true;
  return false;
}

// Every mutating newsletter route asks this. It returns a reason rather than a
// boolean so the refusal can say why, which is the difference between a locked
// door and a broken one.
export function canEdit(row) {
  if (!row) return { ok: false, reason: 'That newsletter no longer exists.' };
  if (isSent(row)) {
    return { ok: false, reason: 'This issue has already been sent, so it cannot be changed. Duplicate it as a draft to work from a copy.' };
  }
  return { ok: true, reason: '' };
}

// ── APPROVAL ─────────────────────────────────────────────────
// Two people: one writes and submits, a second approves and sends. The value is
// entirely in the two being different — an approval step one person can
// complete alone is a formality, and saying so plainly is more useful than
// pretending otherwise.
export function approvalState(row, user, hasSecondApprover) {
  const sent = isSent(row);
  const status = row?.approval_status || 'none';
  const canApprove = !!user && Array.isArray(user.permissions)
    ? user.permissions.includes('newsletter_approve')
    : false;

  if (sent) return { state: 'sent', canSubmit: false, canApprove: false, note: '' };
  if (status === 'pending') {
    const selfApproving = canApprove && row.submitted_by && row.submitted_by === user?.username;
    return {
      state: 'pending',
      canSubmit: false,
      canApprove,
      note: selfApproving
        ? 'You submitted this issue. Approving your own submission is allowed, but a second pair of eyes is the point of this step.'
        : (hasSecondApprover ? '' : 'Only one account can approve, so this step is a formality until a second approver exists.'),
    };
  }
  return { state: 'draft', canSubmit: true, canApprove: false, note: '' };
}

// ── THE LIST ─────────────────────────────────────────────────
// What the Newsletter screen shows per row. Sends is the column that answers
// the question people actually bring to this screen: did it go, and to how many.
export function issueStatus(row) {
  if (isSent(row)) return { tone: 'plain', label: 'Sent' };
  if (row.approval_status === 'pending') return { tone: 'warn', label: 'Awaiting approval' };
  if (row.scheduled_send_at && new Date(row.scheduled_send_at).getTime() > Date.now()) {
    return { tone: 'auto', label: 'Scheduled' };
  }
  return { tone: 'good', label: 'Draft' };
}

export function sendSummary(row) {
  if (!isSent(row)) return 'Not sent';
  const when = row.sent_at ? new Date(row.sent_at) : null;
  const date = when && !isNaN(when) ? when.toLocaleDateString('en-US', { day: 'numeric', month: 'long' }) : null;
  const count = Number.isFinite(row.sent_count) && row.sent_count > 0
    ? `${row.sent_count} subscriber${row.sent_count === 1 ? '' : 's'}` : null;
  if (date && count) return `Sent ${date} to ${count}`;
  if (date) return `Sent ${date}`;
  if (count) return `Sent to ${count}`;
  return 'Sent';
}
