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
// ── EXTRA NOTES ──────────────────────────────────────────────
// The pastor's note, a secondary note and a tertiary note were the three
// free-form blocks an issue could carry. Some weeks need a fourth or a fifth —
// a thank-you, a correction, a one-off appeal that belongs beside the rest
// rather than squeezed into one of the three.
//
// Stored as JSON rather than as more columns, because "how many notes" is a
// property of an issue and not of the schema: a week needing three extras
// should not need a migration. The form offers a fixed number of slots; the
// data does not care.
export const MAX_EXTRA_NOTES = 3;

export function parseExtras(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch (_) { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => ({
      title: String((x && x.title) || '').slice(0, 120).trim(),
      body: String((x && x.body) || '').trim(),
    }))
    // A note with no body is not a note. Dropping it here rather than at render
    // time means an empty slot somebody opened and thought better of never
    // reaches the email, the preview, or the archive.
    .filter((x) => x.body)
    .slice(0, MAX_EXTRA_NOTES);
}

// Reads the numbered fields the form posts back. Blank slots collapse, so
// filling in the third box without the second does not leave a hole.
export function extrasFromForm(form) {
  const out = [];
  for (let i = 0; i < MAX_EXTRA_NOTES; i++) {
    out.push({
      title: String(form.get(`extra_title_${i}`) || ''),
      body: String(form.get(`extra_note_${i}`) || ''),
    });
  }
  return parseExtras(out);
}

export const serializeExtras = (list) => JSON.stringify(parseExtras(list));

// ⚠ These are no longer offered anywhere. The editor used to carry a "Who gets it" select
// built from this list, next to the Send email card that picks the actual Brevo list — two
// controls for one question, and this one named three lists that do not exist (there are
// exactly two in Brevo: the test list and the member list). The select was removed 2026-08-05;
// the column and this vocabulary stay so an issue that already recorded a value keeps it and
// still normalizes. Nothing reads it. If a real church/school split ever exists in Brevo,
// this is where it would start again.
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
// Phones truncate a subject around 60 characters and the preheader — the gray
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

// ── SUBSCRIBER IMPORT ────────────────────────────────────────
// The Subscribers screen's one action is Import CSV, and the file it gets is
// whatever the office exported from somewhere else — Brevo, Breeze, a
// spreadsheet somebody keeps by hand. So this reads the *columns it can find*
// rather than demanding a fixed layout: any header containing "email" is the
// address, and a name is assembled from whichever of name / first / last exist.
// A file with no header row still works, because a cell that looks like an
// address is treated as one.
//
// Nothing is rejected for being malformed. A row with no address is counted
// and reported, not silently dropped — somebody who pastes 200 lines and gets
// 180 back needs to know about the other 20.
export function parseSubscriberCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  const seen = new Set();
  let skipped = 0;

  if (!lines.length) return { rows, skipped };

  const cellsOf = (line) => splitCsvLine(line).map((c) => c.trim().replace(/^"|"$/g, '').trim());
  const looksLikeEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  // Work out the columns from the first line, but only if it is a header —
  // a first line that already holds an address is data, not a header.
  const first = cellsOf(lines[0]);
  const isHeader = !first.some(looksLikeEmail);
  let emailCol = -1, nameCol = -1, firstCol = -1, lastCol = -1;
  if (isHeader) {
    first.forEach((h, i) => {
      const k = h.toLowerCase().replace(/[^a-z]/g, '');
      if (emailCol < 0 && k.includes('email')) emailCol = i;
      else if (k === 'firstname' || k === 'first' || k === 'fname') firstCol = i;
      else if (k === 'lastname' || k === 'last' || k === 'lname' || k === 'surname') lastCol = i;
      else if (nameCol < 0 && k.includes('name')) nameCol = i;
    });
  }

  for (const line of lines.slice(isHeader ? 1 : 0)) {
    const cells = cellsOf(line);
    // Fall back to whichever cell looks like an address, so a headerless or
    // oddly-ordered file still imports.
    const email = (emailCol >= 0 && looksLikeEmail(cells[emailCol] || '') ? cells[emailCol] : cells.find(looksLikeEmail)) || '';
    if (!email) { skipped++; continue; }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = (nameCol >= 0 ? cells[nameCol] : '')
      || [firstCol >= 0 ? cells[firstCol] : '', lastCol >= 0 ? cells[lastCol] : ''].filter(Boolean).join(' ')
      || cells.filter((c) => c && c !== email && !looksLikeEmail(c))[0]
      || '';
    rows.push({ email, name: name.trim() });
  }
  return { rows, skipped };
}

// Minimal CSV field splitter: commas separate, double quotes group, "" is a
// literal quote. Enough for an exported contact list; deliberately not a
// general CSV parser.
function splitCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',' || ch === '\t' || ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}


// ── UPCOMING EVENTS: PICKED, NOT RETYPED ────────────────────────────────────
// The `events` table is one row per date printed inside a single issue, keyed
// to `newsletter_id`. Those rows used to be TYPED, free-hand, into the
// composer — and they reached the email and nothing else. Not the calendar,
// not the printed month, not Google. That is the loop this closes: an event
// was written here, then written again on the calendar, then remembered a
// third time when the month had to be printed.
//
// ⚠ THE TABLE STAYS, AND IS STILL WRITTEN, AND THAT IS DELIBERATE. A sent
// issue is locked and its archive has to keep saying what was actually sent —
// so the picked posts are MATERIALIZED into these rows at save time rather
// than resolved when the email is built. Editing a post's title next March
// must not rewrite an issue six hundred people already have. It also means
// `buildEmailHtml`, the archive page and the public API are byte-for-byte
// unchanged; nothing downstream had to learn about any of this.
//
// `events.news_item_id` is what makes a row re-tickable on a later edit. A row
// with none is one somebody typed by hand before this existed — kept, shown,
// removable, and impossible to create another of.

// `19:00` as somebody would read it aloud. The email and the archive print
// this string as-is, so it is made once here rather than in two renderers.
// ⚠ Anything that is not a real clock comes back EMPTY, not as itself: the
// column is nullable and a blank time is a real answer (an all-day event),
// where echoing a half-typed value would print `19:` into six hundred inboxes.
export function prettyClock(hm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(String(hm || '').trim());
  if (!m) return '';
  const h24 = Number(m[1]);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m[2]} ${h24 < 12 ? 'am' : 'pm'}`;
}

// A picked post becomes the row the email will print. The description is the
// post's own summary — the one-line "location, special note" the typed field
// asked for — so nothing has to be written twice to say the same thing.
export function eventRowFromPost(post) {
  return {
    news_item_id: post.id,
    event_date: post.event_date || '',
    event_name: String(post.title || '').trim(),
    event_time: prettyClock(post.event_time),
    event_desc: String(post.summary || '').trim(),
  };
}

// ⚠ THE ORDER IS THE ORDER OF THE EVENTS, NOT THE ORDER THEY WERE TICKED. A
// checkbox list posts in document order, which is already by date — but a
// hand-kept legacy row has no place in that sequence at all, and appending it
// after the picked ones would print February under March. Everything is sorted
// on the date it actually falls on, and anything dateless sits at the end
// rather than at the top pretending to be the next thing happening.
export function orderEventRows(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ad = a.r.event_date || '', bd = b.r.event_date || '';
      if (!ad && !bd) return a.i - b.i;
      if (!ad) return 1;
      if (!bd) return -1;
      return ad === bd ? a.i - b.i : (ad < bd ? -1 : 1);
    })
    .map(({ r }, i) => ({ ...r, sort_order: i }));
}
