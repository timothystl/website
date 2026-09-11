// ── NEWSLETTER, CHRISTIAN EDUCATION, AND NEWS & EVENTS ────────────────────
// The weekly email is the one thing in this admin that reaches ~600 people and
// cannot be taken back. So the rules that decide whether an issue may still be
// changed, and who may send it, started here as pure functions rather than as
// conditions scattered through a route -- and the routes themselves (Newsletter,
// Christian Education, News & Events) followed, moved out of tlc-admin-worker.js's
// own if-chain in the same code-normalization pass as Menu, Sermons, Site Pages,
// and Ministries. See handleNewsletterRoutes below for that part, and
// admin/newsletter.test.mjs for the pure functions above it.

import { sanitizeClassicRich } from './blocks.js';
import { hasPermission, logAudit } from './auth.js';
import { html, sidebarShell, escapeHtml, tinymceEditorSection, tinymceNoteSection, tinymcePastorSection } from './helpers.js';
import { renderFormSection, renderListSection, statusPill, valueChip, valueChips } from './ui.js';
import { section as sectionCfg, columnsOf, filtersOf } from './sections.js';
import { valueByKey, normalizeValue } from './values.js';
import { churchDate, churchDatePlus } from './when.js';
import { sendBrevoNewsletter, buildEmailHtml, cancelBrevoCampaign, getBrevoListCount } from './email.js';
import { pushToAllSubscribers } from './webpush.js';
import { sweepExpiredItems, extractImageKeys } from './gym.js';
import { mergedCategories, activeCategories, normalizeClock } from './calendar.js';
import { TINYMCE_HEAD, THEMES, CONTENT_TYPES } from './db.js';


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

// ── A STALE FORM MUST NOT SILENTLY OVERWRITE A NEWER SAVE ───────────────────
// Reported directly: type a pastor's note, save as draft, and later find it
// gone. The composer's save has always been a blind UPDATE of every field
// from whatever form was submitted — with two tabs open on the same issue
// (two staff, or one person in two tabs), the second submit overwrites the
// first with a stale snapshot, silently.
//
// `expectedUpdatedAt` is what the form carried when it was LOADED — see the
// hidden `expected_updated_at` field on the edit screen. If the row's real
// `updated_at` has moved on since, somebody else saved in between. Either
// side being blank means there is nothing to compare — a brand-new issue
// (no editId at all), or a legacy row saved before this column existed —
// and a blank pairing is never treated as a conflict, which is what keeps
// this from refusing every single save the moment it ships.
export function hasConflict(existing, expectedUpdatedAt) {
  const cur = existing && existing.updated_at;
  const exp = (expectedUpdatedAt || '').trim();
  if (!cur || !exp) return false;
  return cur !== exp;
}

// ── SUPERSEDING A SENT ISSUE ────────────────────────────────────────────────
// "Duplicate as draft" is only ever offered on a sent issue (see canEdit
// above), and the copy it makes carries `supersedes_id` pointing back at the
// original — the office's own statement that this draft, once it too is
// sent, is what the original should read as having been replaced by. Until
// then the original is untouched: a half-written correction must never make
// the letter it is fixing disappear out from under a visitor.
//
// ⚠ ONE STRING, SHARED BY EVERY PUBLIC READER OF THIS TABLE — the
// newsletterarchive block (pageData()), /api/newsletters, /api/newsletter/:id
// and the legacy /news page. A superseded issue is real history and the
// admin's own list still shows it; this clause only ever belongs on a query
// answering a VISITOR. Writing it once here is what stops one of those four
// places quietly disagreeing with the other three — the same shape of bug
// this file's own COR-1 finding was about, for the news table instead.
//
// `status = 'published'` — not the broader isSent() — is deliberate: it is
// the exact condition the SEND route sets alongside `sent_at`, and every row
// that can carry a `supersedes_id` was created by the Duplicate route below,
// which always writes an explicit status. There is no legacy NULL-status row
// to account for here the way there is for an issue sent before that column
// existed.
// `hidden_from_site` is a THIRD, independent fact from status/sent — it is
// what "Remove from website" (see below) sets on an issue that has already
// gone out. Folding it into `status` would mean a hidden-but-sent issue
// reading as 'draft', which is wrong in every other place that column is
// read (issueStatus()'s "Sent" pill, the admin list's own draft-first sort,
// approvalState()) — all of those correctly check isSent() first and would
// keep working, but a stray future reader of `status` alone would not. A
// separate column is one fact with one name, not two meanings on one flag.
export const NEWSLETTER_PUBLIC_WHERE_SQL = `(status IS NULL OR status = 'published')
  AND (hidden_from_site IS NULL OR hidden_from_site = 0)
  AND id NOT IN (SELECT supersedes_id FROM newsletters WHERE supersedes_id IS NOT NULL AND status = 'published')`;

// The admin list's own pure half of the same rule, for rows already fetched
// in JS rather than filtered in SQL — so the "Superseded" note on the
// original's own row (it is never dropped from the admin's list — only from
// what a visitor sees) can't drift from what the public query hides.
export function supersededIds(rows) {
  const hidden = new Set();
  for (const r of rows || []) {
    if (r.supersedes_id != null && r.status === 'published') hidden.add(Number(r.supersedes_id));
  }
  return hidden;
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
  // Checked before "Sent" — an issue that went out is still sent, but the
  // fact somebody most needs to see at a glance is that it no longer shows
  // up on the website. Hiding a genuinely unsent issue can't happen through
  // this control (Save as draft is the door for that), but the row reads
  // sensibly either way.
  if (row.hidden_from_site) return { tone: 'plain', label: isSent(row) ? 'Sent · off the website' : 'Off the website' };
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

// A brand-new issue starts with nothing typed and nothing ticked. Before the
// picker existed, an event was TYPED into the issue, so the sidebar was never
// empty. After it, the office has to remember to tick a box every single
// week — forget once and "Upcoming" quietly collapses to just the calendar
// link, which is silent in exactly the way this repo's own rule warns
// about: a wrong-looking result that reads as correct. Pre-ticking whatever
// is genuinely coming up soon restores the old behavior without taking the
// choice away — every box is still individually removable before Save, and
// an EDIT of an already-saved issue is untouched, because that draft's own
// ticks (or lack of them) are a decision somebody already made.
//
// `cutoffDate` is a church-date string (YYYY-MM-DD), compared lexically —
// the same convention `orderEventRows` and the rest of this file already
// use, so this never has to parse a date to compare one.
export function defaultUpcomingEventIds(posts, cutoffDate) {
  if (!cutoffDate) return [];
  return (posts || [])
    .filter((p) => p.event_date && p.event_date <= cutoffDate)
    .map((p) => String(p.id));
}

// ── EMAIL SEND / UPCOMING EVENTS SUPPORT ────────────────────────────────
// Private to the routes below: builds the email payload a send/schedule
// route sends, and the picker the composer offers for "Upcoming events".
// See the long note at the foot of this file for why the `events` table
// stays and is still materialized -- these are the composer's half: which
// posts are offered, what the card looks like, and what a save reads.

// Shared by the immediate-send and schedule-send routes: loads a saved
// newsletter's content and renders it to the same email HTML both paths send.
async function buildNewsletterEmailPayload(env, id) {
  const row = await env.DB.prepare(
    'SELECT subject, pastor_note, wol_content, lasm_content, secondary_note, published_at, format, cta_url, cta_label, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes, news_item_ids, extra_notes FROM newsletters WHERE id = ?'
  ).bind(id).first();
  if (!row) return null;

  const eventsRows = await env.DB.prepare(
    'SELECT event_date, event_name, event_time, event_desc FROM events WHERE newsletter_id = ? ORDER BY sort_order'
  ).bind(id).all();

  // Re-fetch the newsletter's selected news items (title + summary/body/image) so the
  // Featured/More-from-Timothy sections aren't silently empty when sending/resending.
  const selectedNewsIds = (row.news_item_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  let selectedNewsItems = [];
  if (selectedNewsIds.length > 0) {
    const placeholders = selectedNewsIds.map(() => '?').join(',');
    const newsRows = await env.DB.prepare(
      `SELECT id, title, summary, body, image_url FROM news_items WHERE id IN (${placeholders})`
    ).bind(...selectedNewsIds).all();
    const newsMap = Object.fromEntries(newsRows.results.map(r => [String(r.id), r]));
    selectedNewsItems = selectedNewsIds.map(nid => newsMap[nid]).filter(Boolean);
  }

  const emailHtml = buildEmailHtml(row.subject, row.pastor_note, eventsRows.results, row.wol_content || '', row.lasm_content || '', row.published_at, selectedNewsItems, row.secondary_note || '', id, row.format || 'weekly', row.cta_url || '', row.cta_label || '', row.tertiary_note || '', row.tertiary_cta_label || '', row.tertiary_cta_url || '', JSON.parse(row.bible_classes || '[]'), parseExtras(row.extra_notes));
  return { row, emailHtml };
}

// ── THE NEWSLETTER'S UPCOMING EVENTS ────────────────────────────────────────
// See the long note at the foot of admin/newsletter.js for why the `events`
// table stays and is still materialized. These three are the composer's half:
// which posts are offered, what the card looks like, and what a save reads.

// Every post carrying a date from today onward — the same records the church
// calendar and the printed month are drawn from, which is the whole point.
//
// ⚠ NOT filtered to the email channel, unlike the news picker above it. That
// tick means "this is worth writing about in the letter"; an event's date is a
// fact about the week whether or not anybody wanted a paragraph on it, and
// leaving a dated post out of the offer would send somebody back to typing it.
async function upcomingEventPosts(env) {
  const today = churchDate();
  try {
    const rows = await env.DB.prepare(
      `SELECT id, title, summary, event_date, event_time, event_location FROM news_items
        WHERE event_date IS NOT NULL AND event_date >= ?
        ORDER BY event_date ASC, id ASC LIMIT 60`
    ).bind(today).all();
    return rows.results || [];
  } catch (_) { return []; }
}

// The rows an issue already carries, split into the two kinds. Anything with a
// news_item_id is a tick; anything without is a row somebody typed before the
// picker existed and is carried through untouched.
async function newsletterEventRows(env, id) {
  if (!id) return { picked: [], typed: [] };
  try {
    const rows = (await env.DB.prepare(
      'SELECT news_item_id, event_date, event_name, event_time, event_desc FROM events WHERE newsletter_id = ? ORDER BY sort_order'
    ).bind(id).all()).results || [];
    return {
      picked: rows.filter((r) => r.news_item_id != null).map((r) => String(r.news_item_id)),
      typed: rows.filter((r) => r.news_item_id == null),
    };
  } catch (_) { return { picked: [], typed: [] }; }
}

// ⚠ DELEGATED off the container, not bound per button. There is no rebuild
// here today, but the picker is server-rendered into two different forms and a
// handler on each button is the shape that silently stops working the first
// time either of them redraws.
const TYPED_EVENT_JS = `<script>
(function(){
  var c = document.getElementById('events-container');
  if (!c) return;
  c.addEventListener('click', function(e){
    var b = e.target.closest('[data-typed]');
    if (!b) return;
    e.preventDefault();
    var row = document.getElementById('typed-event-' + b.getAttribute('data-typed'));
    if (row) row.remove();
  });
})();
</script>`;

function eventPickerHtml(posts, picked = [], typed = []) {
  const chosen = new Set((picked || []).map(String));
  // ⚠ ANCHORED AT NOON, the same way admin/email.js and admin/blocks.js already
  // print a picked date. `new Date('2026-09-01')` is parsed as UTC midnight,
  // which renders as August 31 for a reader in Central — so the label under a
  // checkbox would name the day BEFORE the one the event is on, on a screen
  // whose whole job is getting the date right once.
  const when = (p) => {
    const d = p.event_date
      ? new Date(String(p.event_date) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : '';
    const t = prettyClock(p.event_time);
    return [d, t].filter(Boolean).join(' · ');
  };
  const list = posts.length === 0
    ? `<div style="font-size:13px;color:var(--gray);padding:10px 0;">No upcoming events yet. Add a News &amp; Events post with an event date and it will appear here — and on the calendar and the printed month, without being typed again.</div>`
    : posts.map((p) => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <input type="checkbox" name="event_news_ids" value="${p.id}"${chosen.has(String(p.id)) ? ' checked' : ''} style="margin-top:3px;flex-shrink:0;">
          <span style="flex:1;min-width:0;">
            <span style="display:block;font-weight:600;">${escapeHtml(p.title || '')}</span>
            <span style="display:block;font-size:12px;color:var(--gray);">${escapeHtml(when(p))}${p.event_location ? ' · ' + escapeHtml(p.event_location) : ''}</span>
          </span>
        </label>`).join('');

  // ⚠ A HAND-TYPED ROW IS KEPT, SHOWN AND REMOVABLE — and there is no way to
  // add another. Dropping them on the next save would silently delete work out
  // of somebody's draft; offering a "+ Add an event" beside them would reopen
  // the very loop this closes.
  const legacy = (typed || []).length === 0 ? '' : `
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Typed into this issue by hand, before events could be picked. They will print exactly as they are. Remove one and add the event as a post instead, and it will reach the calendar too.</div>
      ${typed.map((t, i) => `
        <div class="event-block" id="typed-event-${i}" style="position:relative;">
          <button type="button" class="remove-event" data-typed="${i}">×</button>
          <div style="font-weight:600;">${escapeHtml(t.event_name || '(untitled)')}</div>
          <div style="font-size:12px;color:var(--gray);">${escapeHtml([t.event_date, t.event_time].filter(Boolean).join(' · '))}${t.event_desc ? ' — ' + escapeHtml(t.event_desc) : ''}</div>
          <input type="hidden" name="typed_event_ids" value="${i}">
          <input type="hidden" name="typed_event_date_${i}" value="${escapeHtml(t.event_date || '')}">
          <input type="hidden" name="typed_event_name_${i}" value="${escapeHtml(t.event_name || '')}">
          <input type="hidden" name="typed_event_time_${i}" value="${escapeHtml(t.event_time || '')}">
          <input type="hidden" name="typed_event_desc_${i}" value="${escapeHtml(t.event_desc || '')}">
        </div>`).join('')}
    </div>`;

  return `<div id="events-container">${list}${legacy}</div>${typed && typed.length ? TYPED_EVENT_JS : ''}`;
}

// What a save reads back. The picked posts are re-read from the database
// rather than taken from the form, so what is printed is what the record
// actually says — a stale tab cannot post a title of its own.
async function newsletterEventsFromForm(env, form) {
  const ids = form.getAll('event_news_ids').map((v) => String(v).trim()).filter(Boolean);
  let picked = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    try {
      const rows = (await env.DB.prepare(
        `SELECT id, title, summary, event_date, event_time FROM news_items WHERE id IN (${ph})`
      ).bind(...ids).all()).results || [];
      picked = rows.map(eventRowFromPost);
    } catch (_) { picked = []; }
  }
  const typed = form.getAll('typed_event_ids').map((i) => ({
    news_item_id: null,
    event_date: form.get(`typed_event_date_${i}`) || '',
    event_name: form.get(`typed_event_name_${i}`) || '',
    event_time: form.get(`typed_event_time_${i}`) || '',
    event_desc: form.get(`typed_event_desc_${i}`) || '',
  })).filter((e) => e.event_name || e.event_date);
  return orderEventRows(picked.concat(typed));
}

// Makes "a start time is required unless All day is checked" a real client-
// side rule rather than only a hint sentence — native HTML5 validation blocks
// submit rather than the server silently accepting a blank time as "all day"
// by default. Only bites once an event date is actually entered; a plain
// announcement with no date needs neither field.
function newsEventTimeScript() {
  return `<script>
(function() {
  var dateEl = document.getElementById('fld-event_date');
  var allDayEl = document.getElementById('fld-event_all_day');
  var timeEl = document.getElementById('fld-event_time');
  if (!dateEl || !allDayEl || !timeEl) return;
  function sync() {
    var needsTime = !!dateEl.value && !allDayEl.checked;
    timeEl.required = needsTime;
    var lbl = timeEl.closest('.tlc-field').querySelector('.tlc-label');
    if (lbl) lbl.textContent = 'Starts at' + (needsTime ? ' *' : '');
  }
  dateEl.addEventListener('input', sync);
  allDayEl.addEventListener('change', sync);
  sync();
})();
<\/script>`;
}

// Wires the news-item "Header image" file input to /api/upload-image and
// fills the hidden image_url field with the resulting R2 URL. Replaces the
// old plain text input, which let staff paste a browser-local blob: URL
// (dead for every other visitor) into a field with no upload path.
function newsImageUploadScript(existingUrl = '') {
  const safeUrl = (existingUrl || '').replace(/"/g, '&quot;');
  return `<script>
(function() {
  var hidden = document.getElementById('image_url_val');
  var preview = document.getElementById('image-url-preview');
  var existing = "${safeUrl}";
  if (existing && existing.indexOf('blob:') !== 0) {
    hidden.value = existing;
    preview.innerHTML = '<img src="' + existing + '" style="width:100%;border-radius:6px;">';
    preview.style.display = '';
  }
  document.getElementById('image_url_file').addEventListener('change', async function() {
    var file = this.files[0];
    if (!file) return;
    var status = document.getElementById('image-url-status');
    status.textContent = 'Uploading…';
    var fd = new FormData();
    fd.append('file', file);
    try {
      var r = await fetch('/api/upload-image', { method: 'POST', body: fd });
      var j = await r.json();
      if (j.url) {
        hidden.value = j.url;
        preview.innerHTML = '<img src="' + j.url + '" style="width:100%;border-radius:6px;">';
        preview.style.display = '';
        status.textContent = '✓ Uploaded';
        status.style.color = 'var(--sage)';
      } else {
        status.textContent = j.error || 'Upload failed';
        status.style.color = '#B85C3A';
      }
    } catch (e) {
      status.textContent = 'Upload failed — try again';
      status.style.color = '#B85C3A';
    }
  });
})();
<\/script>`;
}

// ── ROUTES ───────────────────────────────────────────────────
// Newsletter composing/sending, Christian Education (Bible classes), and
// News & Events -- three admin screens that grew up together in this file
// and still share the same weekly-issue plumbing (the news picker, the
// event picker, the same TinyMCE notes). Moved out of tlc-admin-worker.js's
// own if-chain (September 2026 code-normalization survey), the last and
// largest domain to move, following the same pattern as Menu, Sermons,
// Site Pages, and Ministries.
//
// Unlike those, this domain's own route names were never namespaced under
// a single prefix (a historical quirk: /new, /publish, /edit/:id,
// /send-email/:id, /delete/:id are the newsletter's own top-level routes,
// alongside /newsletter/*, /newsitems, /newsitems/*, and
// /christian-education*) and it gates permission per section rather than
// with one upfront check, exactly as it always did -- both preserved
// verbatim rather than restructured. `ctx` is threaded through as its own
// parameter (not a shared bag) for the two calls that background work with
// ctx.waitUntil: pushing to subscribers on publish, and sweeping expired
// news items.
//
// ⚠ A request that matches none of the routes below (bare `return null`,
// same as every other domain here) falls through to whatever comes after
// Newsletter in tlc-admin-worker.js's own if-chain.
export async function handleNewsletterRoutes(request, env, path, method, currentUser, url, ctx, badges = {}) {
  // ── NEWSLETTER + NEWS PERMISSION GUARD ──
  // Routes under /new, /publish, /edit/, /delete/, /send-email/, /newsitems require news or newsletter permission
  const isNewsletterRoute = ['/new', '/publish', '/newsletter/preview'].includes(path) || path.startsWith('/edit/') || path.startsWith('/send-email/') || path.startsWith('/delete/') || path.startsWith('/newsletter/duplicate/') || path.startsWith('/newsletter/hide/') || path.startsWith('/newsletter/unhide/');
  const isNewsItemRoute = path === '/newsitems' || path.startsWith('/newsitems/');
  if (isNewsletterRoute && !hasPermission(currentUser, 'newsletter_edit') && !hasPermission(currentUser, 'newsletter_approve')) {
    return new Response('Access denied.', { status: 403 });
  }
  if (isNewsItemRoute && !hasPermission(currentUser, 'news_edit')) {
    return new Response('Access denied.', { status: 403 });
  }

  // ── NEW NEWSLETTER FORM ──
  // The extra note slots. All of them are rendered so TinyMCE can initialize
  // each one at load; the unused ones are simply hidden, and "+ Add another
  // note" reveals the next. Creating an editor instance on click would be a
  // second way for a rich field to exist, and that is how one of them ends up
  // behaving differently from the rest.
  const extraNoteFields = (list) => {
    const rows = [];
    for (let i = 0; i < MAX_EXTRA_NOTES; i++) {
      const n = list[i] || { title: '', body: '' };
      const shown = i < Math.max(list.length, 1);
      rows.push(`<div class="tlc-extra-note" data-extra="${i}"${shown ? '' : ' hidden'}>
        <div class="form-group">
          <label>Heading <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
          <input type="text" name="extra_title_${i}" value="${escapeHtml(n.title || '')}" placeholder="e.g. Thank you">
        </div>
        <div class="form-group">
          ${tinymceNoteSection(`extra-editor-${i}`, `extra_note_${i}`, n.body || '', 140)}
        </div>
      </div>`);
    }
    return rows.join('');
  };
  const extraNotesScript = `<script>
  (function(){
    var btn = document.getElementById('add-extra-note');
    if (!btn) return;
    var slots = Array.prototype.slice.call(document.querySelectorAll('.tlc-extra-note'));
    function sync(){
      var next = slots.filter(function(s){ return s.hasAttribute('hidden'); })[0];
      btn.style.display = next ? '' : 'none';
    }
    btn.addEventListener('click', function(){
      var next = slots.filter(function(s){ return s.hasAttribute('hidden'); })[0];
      if (next) next.removeAttribute('hidden');
      sync();
    });
    sync();
  })();
  </script>`;

  if (path === '/new' && method === 'GET') {
    const today = churchDate();
    // Fetch recent news items available for email inclusion
    const emailItems = await env.DB.prepare(
      `SELECT id, title, summary, publish_date FROM news_items
       WHERE publish_date <= ? AND (expire_date IS NULL OR expire_date >= ?)
         AND (channels IS NULL OR channels LIKE '%email%')
       ORDER BY COALESCE(event_date, publish_date) ASC LIMIT 20`
    ).bind(today, today).all();
    // A new issue starts with every event in the next two weeks ticked —
    // see the note on defaultUpcomingEventIds — so the sidebar isn't
    // empty unless the office deliberately unchecks everything.
    const upcomingPostsForNew = await upcomingEventPosts(env);
    const eventPicker = eventPickerHtml(upcomingPostsForNew, defaultUpcomingEventIds(upcomingPostsForNew, churchDatePlus(14)));
    const newsPickerHtml = emailItems.results.length === 0
      ? `<div style="font-size:13px;color:var(--gray);padding:10px 0;">No news items available. Add items in the News &amp; Events tab first.</div>`
      : emailItems.results.map(item => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <input type="checkbox" name="news_item_ids" value="${item.id}" style="margin-top:3px;flex-shrink:0;">
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--charcoal);">${item.title}</div>
            ${item.summary ? `<div style="font-size:12px;color:var(--gray);margin-top:2px;">${item.summary.substring(0, 100)}${item.summary.length > 100 ? '…' : ''}</div>` : ''}
            <div style="font-size:11px;color:var(--gray);margin-top:2px;">${item.publish_date}</div>
          </div>
        </label>`).join('');
    const bibleClassTemplatesRows = await env.DB.prepare('SELECT * FROM bible_classes WHERE active = 1 ORDER BY sort_order, id').all();
    const bibleClassTemplates = bibleClassTemplatesRows.results || [];
    const tplCheckboxesHtml = bibleClassTemplates.length ? bibleClassTemplates.map(t => `
      <div id="tpl-row-${t.id}">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 0;border-bottom:1px solid var(--border);">
          <input type="checkbox" id="tpl-cb-${t.id}" onchange="toggleTpl(this, ${t.id})">
          <span style="font-size:14px;color:var(--charcoal);"><strong>${t.title}</strong>${t.leader ? ` · <span style="font-weight:400;">${t.leader}</span>` : ''}${t.location ? ` · <span style="font-weight:400;color:var(--gray);">${t.location}</span>` : ''}</span>
        </label>
        <div id="tpl-date-row-${t.id}" style="display:none;padding:8px 0 4px 26px;">
          <label style="font-size:11px;color:var(--gray);display:block;margin-bottom:4px;">Date for this session</label>
          <input type="date" id="tpl-date-${t.id}" oninput="syncTplDate(${t.id})" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;">
          <input type="hidden" name="class_ids" id="tpl-cid-${t.id}" value="t${t.id}" disabled>
          <input type="hidden" name="class_date_t${t.id}" id="tpl-cdate-${t.id}" disabled>
          <input type="hidden" name="class_topic_t${t.id}" value="${t.title.replace(/"/g,'&quot;')}" id="tpl-ctopic-${t.id}" disabled>
          <input type="hidden" name="class_leader_t${t.id}" value="${(t.leader||'').replace(/"/g,'&quot;')}" id="tpl-cleader-${t.id}" disabled>
          <input type="hidden" name="class_location_t${t.id}" value="${(t.location||'').replace(/"/g,'&quot;')}" id="tpl-clocation-${t.id}" disabled>
        </div>
      </div>`).join('') : '';
    return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">← News &amp; Events</a>`, badges)}
<div class="tlc-wrap">
<div class="page-title">New newsletter</div>
<div class="page-sub">Write your update, add events, and publish to the website.</div>

<form method="POST" action="/publish" enctype="multipart/form-data">
<input type="hidden" name="format" id="format-input" value="weekly">

<div class="card">
  <div class="card-title">What are you writing?</div>
  <div class="tlc-fmt" style="flex-direction:row;">
    <button type="button" class="tlc-fmt-pill is-on" id="fmt-weekly" onclick="pickFormat('weekly')">Weekly</button>
    <button type="button" class="tlc-fmt-pill" id="fmt-quick" onclick="pickFormat('quick')">Special edition</button>
  </div>
  <div style="font-size:12.5px;color:var(--gray);margin-top:8px;">Weekly carries the pastor's note, events and ministry content. A special edition is a short message with an optional button — snow days, funerals, schedule changes.</div>
</div>

  <div class="card">
    <div class="card-title">Header</div>
    <div class="form-group">
      <label>Subject line <span style="color:#B85C3A;">*</span></label>
      <input type="text" name="subject" required placeholder="e.g. This week at Timothy — March 23">
    </div>
    <div class="form-group" id="date-field">
      <label>Date</label>
      <input type="date" name="published_at" value="${today}">
    </div>
  </div>

  <!-- WEEKLY FIELDS -->
  <div id="weekly-fields">
    <div class="card">
      <div class="card-title">Pastor's note</div>
      ${tinymcePastorSection()}
    </div>

    <div class="card">
      <div class="card-title">Secondary note <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A second free-form text block that appears in the email below the pastor's note. Leave blank to omit.</div>
      <div class="form-group">
        ${tinymceNoteSection('secondary-editor', 'secondary_note', '', 140)}
      </div>
    </div>

    <div class="card">
      <div class="card-title">News &amp; Events <span class="tag">Pick from your posts</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Check items to include. The <strong>first checked item</strong> appears as the featured story, the <strong>second</strong> as secondary news, and the rest as compact cards — all with a "Read more" link. Long text is automatically trimmed.</div>
      ${newsPickerHtml}
    </div>

    <div class="card">
      <div class="card-title">Upcoming events <span class="tag">Pick from your posts</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Every News &amp; Events post with a date from today onward. Ticking one prints it here <strong>and</strong> puts it on the church calendar and the printed month — it is the same record, entered once.</div>
      ${eventPicker}
    </div>

    <div class="card">
      <div class="card-title">Bible Classes <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">Check classes meeting this week. Each checked class will appear at the bottom of the email with a link to the full calendar.</div>
      ${tplCheckboxesHtml}
      <div id="classes-container" style="${bibleClassTemplates.length ? 'margin-top:12px;' : ''}"></div>
      <button type="button" class="add-event-btn" onclick="addBibleClass()" style="margin-top:${bibleClassTemplates.length ? '6' : '0'}px;">${bibleClassTemplates.length ? '+ Add one-time class' : '+ Add a class'}</button>
    </div>

    <div class="card">
      <div class="card-title">Word of Life &amp; LASM <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">These appear side by side in the email — left half Word of Life, right half LASM. Leave either blank to omit it.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Word of Life</label>
          ${tinymceNoteSection('wol-editor', 'wol_content', '', 120)}
        </div>
        <div class="form-group" style="margin:0;">
          <label>LASM</label>
          ${tinymceNoteSection('lasm-editor', 'lasm_content', '', 120)}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Tertiary note / CTA <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A full-width block below Word of Life &amp; LASM. Use it for a call-to-action, an announcement, a sign-up link, or anything else that doesn't fit the pastor's note. Leave blank to omit.</div>
      <div class="form-group">
        ${tinymceNoteSection('tertiary-editor', 'tertiary_note', '', 140)}
      </div>
      <div style="display:flex;gap:12px;margin-top:8px;">
        <div class="form-group" style="flex:1;margin:0;">
          <label>Button label <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
          <input type="text" name="tertiary_cta_label" placeholder="e.g. Sign Up, RSVP, Learn More">
        </div>
        <div class="form-group" style="flex:1;margin:0;">
          <label>Button link (URL) <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
          <input type="url" name="tertiary_cta_url" placeholder="https://...">
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">More notes <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A fourth and fifth block, below everything else — a thank-you, a correction, a one-off appeal. Each appears only if you write something in it.</div>
      ${extraNoteFields([])}
      <button type="button" class="add-event-btn" id="add-extra-note">+ Add another note</button>
      ${extraNotesScript}
    </div>
  </div>

  <!-- QUICK ANNOUNCEMENT FIELDS -->
  <div id="quick-fields" style="display:none;">
    <div class="card">
      <div class="card-title">Message</div>
      <div class="form-group">
        <label>Your announcement <span style="color:#B85C3A;">*</span></label>
        ${tinymceNoteSection('quick-editor', 'quick_body', '', 140)}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Button <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">Add a link button — e.g. "Sign Up", "Read More", "RSVP".</div>
      <div class="form-group">
        <label>Button label</label>
        <input type="text" name="cta_label" placeholder="e.g. Sign Up, Read More, RSVP">
      </div>
      <div class="form-group">
        <label>Button link (URL)</label>
        <input type="url" name="cta_url" placeholder="https://...">
      </div>
    </div>
  </div>

  <div class="card" style="border-color:var(--amber);">
    <div class="card-title">Send email</div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-bottom:12px;"><strong>Publish</strong> sends to the selected list and goes live on the website. <strong>Save as draft</strong> saves without sending anything.</div>
    <div class="radio-row">
      <label><input type="radio" name="email_send" value="test" checked> Test list</label>
      <label><input type="radio" name="email_send" value="all"> Members</label>
      <label><input type="radio" name="email_send" value="none"> Website only (no email)</label>
    </div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-top:6px;">These are the two lists in Brevo &mdash; the test list and the member list. This is the only place the audience is chosen.</div>
    <div style="margin-top:14px;padding:12px 14px;background:var(--mist);border-radius:8px;border:1px solid var(--ice);font-family:var(--sans);font-size:12px;color:var(--charcoal);line-height:1.7;">
      📊 <strong>Email is sent via Brevo.</strong> To see open rates, clicks, and delivery stats after sending, log in at <a href="https://app.brevo.com" target="_blank" style="color:var(--mid);font-weight:700;">app.brevo.com</a> → Campaigns.
    </div>
  </div>

  <div class="btn-row" style="margin-top:8px;">
    ${hasPermission(currentUser, 'newsletter_approve') ? `<button type="submit" name="action" value="publish" class="btn btn-primary">Publish</button>` : ''}
    <button type="submit" name="action" value="draft" class="btn btn-secondary">Save as draft</button>
    <a href="/" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
  </div>

</form>
</div>

<script>
let classCount = 0;
function addBibleClass(date, topic, location, leader) {
const c = document.getElementById('classes-container');
const id = ++classCount;
const div = document.createElement('div');
div.className = 'event-block';
div.id = 'class-'+id;
div.innerHTML = \`<button type="button" class="remove-event" onclick="removeBibleClass(\${id})">×</button>
  <div class="event-grid">
    <div class="form-group" style="margin:0;"><label>Date</label><input type="date" name="class_date_\${id}" value="\${date||''}"></div>
    <div class="form-group" style="margin:0;"><label>Topic</label><input type="text" name="class_topic_\${id}" placeholder="e.g. The Sermon on the Mount" value="\${topic||''}"></div>
  </div>
  <div class="event-grid" style="margin-top:12px;">
    <div class="form-group" style="margin:0;"><label>Location</label><input type="text" name="class_location_\${id}" placeholder="e.g. Fellowship Hall" value="\${location||''}"></div>
    <div class="form-group" style="margin:0;"><label>Leader</label><input type="text" name="class_leader_\${id}" placeholder="e.g. Pastor Matt" value="\${leader||''}"></div>
  </div>
  <input type="hidden" name="class_ids" value="\${id}">\`;
c.appendChild(div);
}
function removeBibleClass(id) { document.getElementById('class-'+id).remove(); }
function toggleTpl(cb, tplId) {
const row = document.getElementById('tpl-date-row-'+tplId);
const ids = ['tpl-cid-'+tplId, 'tpl-cdate-'+tplId, 'tpl-ctopic-'+tplId, 'tpl-cleader-'+tplId, 'tpl-clocation-'+tplId];
row.style.display = cb.checked ? '' : 'none';
ids.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !cb.checked; });
}
function syncTplDate(tplId) {
const v = document.getElementById('tpl-date-'+tplId)?.value || '';
const h = document.getElementById('tpl-cdate-'+tplId);
if (h) h.value = v;
}
function pickFormat(fmt) {
document.getElementById('format-input').value = fmt;
document.getElementById('fmt-weekly').classList.toggle('is-on', fmt === 'weekly');
document.getElementById('fmt-quick').classList.toggle('is-on', fmt === 'quick');
document.getElementById('weekly-fields').style.display = fmt === 'weekly' ? '' : 'none';
document.getElementById('quick-fields').style.display = fmt === 'quick' ? '' : 'none';
}
</script>`, 'New Newsletter', TINYMCE_HEAD);
  }

  // ── PUBLISH / SAVE ──
  if (path === '/publish' && method === 'POST') {
    const form = await request.formData();
    // ── THE LOCK ──
    // A sent issue is read-only, enforced here rather than only in the UI.
    // Once ~600 people have a copy in their inbox, the archived copy on the
    // website has to keep saying what was actually sent — editing it would
    // make the archive a lie. Checked before anything is read from the form
    // so a crafted POST cannot get partway in.
    // ⚠ ALSO WHERE THE CONFLICT CHECK READS updated_at — same fetch, so a
    // second SELECT is not needed a few lines further down.
    let existingBeforeSave = null;
    {
      const lockId = form.get('newsletter_id');
      if (lockId) {
        const existing = await env.DB.prepare(
          'SELECT status, approval_status, sent_at, beehiiv_id, brevo_campaign_id, updated_at, updated_by, ministry_content, ministry_type FROM newsletters WHERE id = ?'
        ).bind(lockId).first();
        existingBeforeSave = existing;
        const verdict = canEdit(existing);
        if (!verdict.ok) {
          return new Response('', { status: 302, headers: { Location: `/edit/${lockId}?msg=locked` } });
        }
      }
    }
    const subject = form.get('subject') || '';
    const publishedAt = form.get('published_at') || churchDate();
    const action = form.get('action') || 'publish';
    const fmt = form.get('format') || 'weekly';
    const editId = form.get('newsletter_id') || null; // present when editing an existing newsletter
    const emailSend = form.get('email_send') || 'none';
    // Test sends stay as drafts — only 'all' or 'none' (website-only) publishes to the archive
    const status = (action === 'publish' && emailSend !== 'test') ? 'published' : 'draft';

    const preheader = form.get('preheader') || '';
    // `audience` no longer has a control on the form — the Send email card picks the real
    // Brevo list, and the three-way "Who gets it" select named lists that do not exist. The
    // column stays and keeps whatever an older issue recorded, rather than every save
    // silently rewriting it to the default; nothing reads it today either way.
    let audience = normalizeAudience(form.get('audience'));
    if (!form.has('audience') && editId) {
      const prior = await env.DB.prepare('SELECT audience FROM newsletters WHERE id = ?').bind(editId).first().catch(() => null);
      if (prior && prior.audience) audience = normalizeAudience(prior.audience);
    }
    // Only the switches the form actually rendered are considered. A checkbox
    // posts nothing when off, so `block_seen` records which ones were on the
    // page — without it, a form that never showed a switch would read as
    // "off" and silently drop that section from the issue.
    // A form that rendered no switches at all (the new-newsletter form) must
    // store NULL, not an all-false object — null means "defaults, everything
    // on", whereas all-false would silently ship an empty issue.
    const seenBlocks = form.getAll('block_seen');
    const blocksJson = seenBlocks.length
      ? serializeBlocks(Object.fromEntries(seenBlocks.map((k) => [k, form.get('block_' + k) === '1'])))
      : null;

    // Strip <img src="blob:..."> tags — these are temporary in-browser URLs
    // that render as broken icons in email if the upload didn't finish.
    const stripBlobImgs = s => (s || '').replace(/<img[^>]*src=["']blob:[^"']*["'][^>]*>/gi, '');
    // ── FX-04: EVERY RICH FIELD ON THIS FORM GOES THROUGH HERE ──────────
    // These fields are stored as markup on purpose and rendered as markup on
    // purpose — into six hundred inboxes by admin/email.js, and into
    // `innerHTML` on timothystl.org by loadNewsletters()/loadNewsletterDetail().
    // Until this line they were stored exactly as posted, so an account
    // holding only `newsletter_edit` could put script on the public site.
    //
    // ⚠ sanitizeClassicRich, NOT sanitizeRich. The classic toolbar has a
    // table button and writes its own image styles; the page editor's
    // allowlist would delete both. See the note on CLASSIC_PROFILE in
    // admin/blocks.js.
    const cleanRich = s => sanitizeClassicRich(stripBlobImgs(s));

    // Weekly-specific fields
    const pastorNote = cleanRich(form.get('pastor_note') || '');
    const secondaryNote = fmt === 'weekly' ? cleanRich(form.get('secondary_note') || '') : '';
    const wolContent = fmt === 'weekly' ? cleanRich(form.get('wol_content') || '') : '';
    const lasmContent = fmt === 'weekly' ? cleanRich(form.get('lasm_content') || '') : '';
    const tertiaryNote = fmt === 'weekly' ? cleanRich(form.get('tertiary_note') || '') : '';
    // Blank slots collapse, so filling the third box without the second
    // does not leave a hole in the email.
    const extraNotesJson = fmt === 'weekly'
      ? serializeExtras(extrasFromForm(form).map((n) => ({ title: n.title, body: cleanRich(n.body) })))
      : '[]';
    const tertiaryCtaLabel = fmt === 'weekly' ? form.get('tertiary_cta_label') || '' : '';
    const tertiaryCtaUrl = fmt === 'weekly' ? form.get('tertiary_cta_url') || '' : '';
    // Legacy fields kept for DB/API compatibility but no longer shown in the
    // composer. Preserve an older issue's values when it is edited: removing
    // a write-only control must not silently erase historical content.
    const ministryContent = editId ? (existingBeforeSave?.ministry_content || '') : '';
    const ministryType = editId ? (existingBeforeSave?.ministry_type || 'text') : 'text';

    // Quick-announcement-specific fields
    const quickBody = cleanRich(form.get('quick_body') || '');
    const ctaUrl = form.get('cta_url') || '';
    const ctaLabel = form.get('cta_label') || '';

    // Combine for storage: quick announcements store message in pastor_note
    const savedNote = fmt === 'quick' ? quickBody : pastorNote;

    // The upcoming events, picked from the posts rather than typed here.
    // Materialized into `events` at save time — see the note at the foot of
    // admin/newsletter.js for why a sent issue's rows must be frozen copies
    // rather than a lookup resolved when the email is built.
    const events = fmt === 'weekly' ? await newsletterEventsFromForm(env, form) : [];

    // Collect bible classes (weekly only)
    const classIds = form.getAll('class_ids');
    const bibleClasses = [];
    if (fmt === 'weekly') {
      for (const id of classIds) {
        const topic = form.get(`class_topic_${id}`);
        if (!topic) continue;
        const entry = {
          date: form.get(`class_date_${id}`) || '',
          topic,
          location: form.get(`class_location_${id}`) || '',
          leader: form.get(`class_leader_${id}`) || '',
        };
        if (String(id).startsWith('t')) entry.template_id = parseInt(id.slice(1));
        bibleClasses.push(entry);
      }
    }
    const bibleClassesJson = bibleClasses.length ? JSON.stringify(bibleClasses) : null;

    // Fetch selected news items (weekly only)
    const selectedNewsIds = fmt === 'weekly' ? form.getAll('news_item_ids') : [];
    let selectedNewsItems = [];
    if (selectedNewsIds.length > 0) {
      const placeholders = selectedNewsIds.map(() => '?').join(',');
      const newsRows = await env.DB.prepare(
        `SELECT id, title, summary, body, image_url FROM news_items WHERE id IN (${placeholders})`
      ).bind(...selectedNewsIds).all();
      const newsMap = Object.fromEntries(newsRows.results.map(r => [r.id, r]));
      selectedNewsItems = selectedNewsIds.map(id => newsMap[id]).filter(Boolean);
    }

    const newsIdsStr = selectedNewsIds.join(',');
    const nowIso = new Date().toISOString();
    // ── THE CONFLICT CHECK ──
    // See hasConflict() in admin/newsletter.js and the comment on the
    // hidden expected_updated_at field this compares against.
    const conflict = !!editId
      && hasConflict(existingBeforeSave, form.get('expected_updated_at'));
    let newsletterId;
    if (editId && !conflict) {
      // Update existing newsletter
      await env.DB.prepare(
        'UPDATE newsletters SET subject=?, pastor_note=?, ministry_content=?, ministry_type=?, published_at=?, format=?, cta_url=?, cta_label=?, status=?, wol_content=?, lasm_content=?, secondary_note=?, news_item_ids=?, tertiary_note=?, tertiary_cta_label=?, tertiary_cta_url=?, bible_classes=?, preheader=?, audience=?, blocks=?, extra_notes=?, updated_at=?, updated_by=? WHERE id=?'
      ).bind(subject, savedNote, ministryContent, ministryType, publishedAt, fmt, ctaUrl, ctaLabel, status, wolContent, lasmContent, secondaryNote, newsIdsStr, tertiaryNote, tertiaryCtaLabel, tertiaryCtaUrl, bibleClassesJson, preheader, audience, blocksJson, extraNotesJson, nowIso, currentUser?.username || '', editId).run();
      newsletterId = parseInt(editId, 10);
      // Replace events
      await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(newsletterId).run();
    } else {
      // Insert new newsletter — a genuinely new issue, OR (when `conflict`
      // is true) a safe landing spot for exactly what was just typed,
      // rather than blindly overwriting a change somebody else already
      // saved. Always a draft when it's a recovery: an unattended "Publish"
      // click during a conflict must never send an email out of a copy
      // nobody has looked at yet.
      const insertStatus = conflict ? 'draft' : status;
      const insertSubject = conflict ? `Recovered — ${subject}` : subject;
      const result = await env.DB.prepare(
        'INSERT INTO newsletters (subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, status, wol_content, lasm_content, secondary_note, news_item_ids, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes, preheader, audience, blocks, extra_notes, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(insertSubject, savedNote, ministryContent, ministryType, publishedAt, fmt, ctaUrl, ctaLabel, insertStatus, wolContent, lasmContent, secondaryNote, newsIdsStr, tertiaryNote, tertiaryCtaLabel, tertiaryCtaUrl, bibleClassesJson, preheader, audience, blocksJson, extraNotesJson, nowIso, currentUser?.username || '').run();
      newsletterId = result.meta.last_row_id;
    }

    // Save events
    for (const e of events) {
      await env.DB.prepare(
        'INSERT INTO events (newsletter_id, event_date, event_name, event_time, event_desc, sort_order, news_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(newsletterId, e.event_date, e.event_name, e.event_time, e.event_desc, e.sort_order, e.news_item_id ?? null).run();
    }

    // A conflict never falls through into the approval/send logic below —
    // what was just typed is safe in its own draft, and that draft has not
    // been reviewed by anybody. Land back on it, naming the issue it was
    // meant to update, so nothing is a mystery.
    if (conflict) {
      await logAudit(env.DB, currentUser, 'create', 'newsletter', String(newsletterId), `Recovered — ${subject}`,
        null, { recovered_from: editId, reason: 'concurrent edit' });
      return new Response('', {
        status: 302,
        headers: { Location: `/edit/${newsletterId}?msg=conflict&other=${editId}` },
      });
    }

    // Approval workflow: editors without newsletter_approve submit for approval
    if (action === 'publish' && !hasPermission(currentUser, 'newsletter_approve')) {
      await env.DB.prepare("UPDATE newsletters SET status = 'draft', approval_status = 'pending' WHERE id = ?").bind(newsletterId).run();
      // This is what makes the approval queue worth having — without it,
      // "awaiting approval" is a tag nobody notices until they happen to
      // open the newsletter list. Never awaited, same reasoning as every
      // other push trigger here: a push failure must never turn into a
      // failure to submit.
      ctx.waitUntil(pushToAllSubscribers(env, {
        title: 'Newsletter awaiting approval',
        body: `${currentUser.username} submitted "${subject}" for approval.`,
        tag: 'newsletter-approval', url: `/edit/${newsletterId}`,
      }));
      return new Response('', {
        status: 302,
        headers: { Location: `/newsletters?msg=submitted&subject=${encodeURIComponent(subject)}` }
      });
    }

    // Send via Brevo if requested (only when publishing with newsletter_approve permission)
    let emailSuffix = '';
    if (action === 'publish' && emailSend !== 'none' && hasPermission(currentUser, 'newsletter_approve')) {
      const listId = emailSend === 'test' ? parseInt(env.BREVO_TEST_LIST_ID || '2', 10) : parseInt(env.BREVO_LIST_ID || '0', 10);
      if (!listId && emailSend === 'all') {
        emailSuffix = `&emailerr=${encodeURIComponent('BREVO_LIST_ID secret is not configured. Set it in Cloudflare Workers → Settings → Variables & Secrets.')}`;
      } else if (listId) {
        const emailHtml = buildEmailHtml(subject, savedNote, events, wolContent, lasmContent, publishedAt, selectedNewsItems, secondaryNote, newsletterId, fmt, ctaUrl, ctaLabel, tertiaryNote, tertiaryCtaLabel, tertiaryCtaUrl, bibleClasses);
        const result = await sendBrevoNewsletter(env, { subject, htmlContent: emailHtml, listIds: [listId] });
        emailSuffix = result.success
          ? `&emailed=${emailSend}`
          : `&emailerr=${encodeURIComponent(result.error)}`;
        // sent_at/sent_count are what isSent() and the list's "Sent" pill
        // read — without this the email genuinely goes out but the row
        // keeps reading Draft, same as the dedicated /send-email/:id route.
        // The count is the real Brevo list size, not the local signup
        // table — that table only holds website-form signups and badly
        // undercounts an audience also built from Breeze imports/manual adds.
        if (emailSend === 'all' && result.success) {
          const recipients = await getBrevoListCount(env, listId);
          await env.DB.prepare(
            "UPDATE newsletters SET sent_at = COALESCE(sent_at, ?), sent_count = COALESCE(sent_count, ?) WHERE id = ?"
          ).bind(new Date().toISOString(), recipients, newsletterId).run();
        }
      }
    }

    if (action === 'publish' && emailSend !== 'test') {
      await env.DB.prepare("UPDATE newsletters SET approval_status = 'approved', approved_by_username = ? WHERE id = ?").bind(currentUser.username, newsletterId).run();
    } else {
      // Saving as draft (or test send) clears any prior approval state
      await env.DB.prepare("UPDATE newsletters SET approval_status = NULL, approved_by_username = NULL WHERE id = ?").bind(newsletterId).run();
    }

    const redirectMsg = (action === 'publish' && emailSend !== 'test') ? 'published' : 'draft';
    return new Response('', {
      status: 302,
      headers: { Location: `/newsletters?msg=${encodeURIComponent(redirectMsg)}&subject=${encodeURIComponent(subject)}${emailSuffix}` }
    });
  }

  // ── BIBLE CLASS TEMPLATE CRUD ──
  // ── CHRISTIAN EDUCATION: BIBLE CLASSES CRUD ──
  const isCeRoute = path === '/christian-education' || path.startsWith('/christian-education/');
  if (isCeRoute && !hasPermission(currentUser, 'news_edit')) return new Response('Access denied.', { status: 403 });

  // The add form lives on its own address rather than under the list, so
  // this section reads the same as every other one: a list, and one action
  // that opens a form.
  // ── CHRISTIAN ED: THE FORM, ONCE ──
  // Add and Edit were two copies of the same fields on the old chrome. One
  // builder, through the shared renderer.
  const ceFormHtml = (c = null) => {
    const isNew = !c;
    const ACCENT_OPTS = [['mid', 'Navy'], ['teal', 'Teal'], ['steel', 'Steel'], ['sage', 'Moss'], ['amber', 'Gold'], ['plum', 'Plum']];
    return renderFormSection({
      title: isNew ? 'New class' : c.title || 'Edit class',
      purpose: isNew
        ? 'It appears on /education and in the newsletter’s class picker as soon as you save.'
        : 'Changes reach /education and the newsletter picker as soon as you save.',
      action: isNew ? '/christian-education/create' : `/christian-education/update/${c.id}`,
      cancelHref: '/christian-education',
      saveLabel: isNew ? 'Add class' : 'Save changes',
      deleteAction: isNew ? '' : `/christian-education/delete/${c.id}`,
      deleteConfirm: `Delete “${(c && c.title) || 'this class'}”? It disappears from /education.`,
      fields: [
        { name: 'title', label: 'Class title', value: c ? c.title : '', required: true, placeholder: 'Men’s Bible Study' },
        { name: 'label', label: 'Eyebrow', value: c ? (c.label || '') : '', placeholder: 'Saturday mornings',
          hint: 'The small line above the title on the website.' },
        { name: 'schedule', label: 'Schedule', value: c ? (c.schedule || '') : '', placeholder: 'Saturdays · 8:00 AM' },
        { kind: 'textarea', name: 'description', label: 'Description', rows: 3, value: c ? (c.description || '') : '',
          placeholder: 'What the class is, and who it is for.' },
        { name: 'leader', label: 'Leader', value: c ? (c.leader || '') : '', placeholder: 'Pastor Matt' },
        { name: 'location', label: 'Location', value: c ? (c.location || '') : '', placeholder: 'Fellowship Hall' },
        { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">Core value</label>${valueChips('value', c ? c.value : null)}<p class="tlc-hint">Which of the four this class serves.</p></div>` },
        { kind: 'choice', name: 'accent', label: 'Accent color', value: c ? (c.accent || 'mid') : 'mid',
          options: ACCENT_OPTS.map(([v, l]) => ({ value: v, label: l })) },
        { kind: 'number', name: 'sort_order', label: 'Order', value: c ? (c.sort_order || 0) : 0, min: 0, step: 1,
          hint: 'Lower numbers come first on the education page.' },
        { kind: 'toggle', name: 'active', label: 'Running', value: c ? !!c.active : true,
          on: 'Running', off: 'Paused',
          hint: 'Paused takes it off the website and out of the newsletter picker without deleting it.' },
      ],
    });
  };

  if ((path === '/christian-education' || path === '/christian-education/new') && method === 'GET') {

    if (path === '/christian-education/new') {
      return html(`
${sidebarShell('christian-education', currentUser, `<a href="/christian-education">All classes</a>`, badges)}
<div class="tlc-wrap">${ceFormHtml()}</div>`, 'New class — TLC Admin');
    }

    const ceRows = await env.DB.prepare('SELECT * FROM bible_classes ORDER BY sort_order, id').all();
    const ceMsg = url.searchParams.get('msg');
    const ceAlert = ceMsg === 'saved' ? `<div class="alert alert-success">✓ Class saved.</div>`
      : ceMsg === 'deleted' ? `<div class="alert alert-info">Class removed.</div>`
      : ceMsg === 'error' ? `<div class="alert alert-error">Title is required.</div>` : '';

    const rows = ceRows.results.map((c) => ({
      href: `/christian-education/edit/${c.id}`,
      filter: [c.active ? 'running' : 'paused', c.value || ''].filter(Boolean),
      search: `${c.title} ${c.label || ''} ${c.schedule || ''} ${c.leader || ''}`.toLowerCase(),
      cells: [
        `<div class="tlc-primary"><span class="tlc-primary-text">
          <span class="tlc-primary-title">${escapeHtml(c.title)}${c.value ? ` ${valueChip(c.value)}` : ''}</span>
          <span class="tlc-primary-sub">${escapeHtml([c.label, c.location].filter(Boolean).join(' · '))}</span>
        </span></div>`,
        escapeHtml(c.schedule || '—'),
        escapeHtml(c.leader || '—'),
        c.active ? statusPill('good', 'Running') : statusPill('plain', 'Paused'),
      ],
      actions: `<form method="POST" action="/christian-education/toggle/${c.id}" style="display:inline;margin:0;"><button type="submit" class="tlc-edit" style="background:none;border:0;cursor:pointer;font:inherit;color:inherit;">${c.active ? 'Pause' : 'Resume'}</button></form><a class="tlc-edit" href="/christian-education/edit/${c.id}">Edit</a>`,
    }));

    return html(`
${sidebarShell('christian-education', currentUser, `<a href="https://timothystl.org/education" target="_blank">View page</a>`, badges)}
<div class="tlc-wrap">
${ceAlert ? `<div class="tlc-section" style="padding-bottom:0;">${ceAlert}</div>` : ''}
${renderListSection({
  key: 'christian-ed',
  title: sectionCfg('ed').title,
  purpose: sectionCfg('ed').purpose,
  action: { label: sectionCfg('ed').action, href: '/christian-education/new' },
  search: sectionCfg('ed').search,
  columns: columnsOf('ed'),
  filters: filtersOf('ed'),
  valueChips: sectionCfg('ed').valueChips,
  rows,
  noun: 'class', nounPlural: 'classes',
  empty: 'No classes yet.',
  note: 'Pausing a class keeps it in this list but takes it off the website — the right move for something that breaks for the summer and comes back.',
})}
</div>`, 'Christian Education');
  }

  if (path === '/christian-education/create' && method === 'POST') {
    const ceForm = await request.formData();
    const title = (ceForm.get('title') || '').trim();
    if (!title) return new Response('', { status: 302, headers: { Location: '/christian-education?msg=error' } });
    // ⚠ A toggle posts a hidden `0` ahead of its checkbox, so `get()` returns
    // the 0 whether or not the box is ticked. `getAll(...).includes('1')` is
    // the only reading that is true when the switch is actually on.
    const ceActive = ceForm.getAll('active').includes('1') ? 1 : 0;
    const ceSort = parseInt(ceForm.get('sort_order') || '0', 10) || 0;
    await env.DB.prepare('INSERT INTO bible_classes (title, label, description, leader, location, schedule, accent, value, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(title, (ceForm.get('label')||'').trim()||null, (ceForm.get('description')||'').trim()||null, (ceForm.get('leader')||'').trim()||null, (ceForm.get('location')||'').trim()||null, (ceForm.get('schedule')||'').trim()||null, ceForm.get('accent')||'mid', normalizeValue(ceForm.get('value')), ceActive, ceSort).run();
    return new Response('', { status: 302, headers: { Location: '/christian-education?msg=saved' } });
  }

  if (path.startsWith('/christian-education/edit/') && method === 'GET') {
    const ceId = path.split('/').pop();
    const ceRow = await env.DB.prepare('SELECT * FROM bible_classes WHERE id = ?').bind(ceId).first();
    if (!ceRow) return new Response('Not found', { status: 404 });
    return html(`
${sidebarShell('christian-education', currentUser, `<a href="/christian-education">All classes</a>`, badges)}
<div class="tlc-wrap">${ceFormHtml(ceRow)}</div>`, 'Edit class — TLC Admin');
  }

  if (path.startsWith('/christian-education/update/') && method === 'POST') {
    const ceId = path.split('/').pop();
    const ceForm = await request.formData();
    const title = (ceForm.get('title') || '').trim();
    if (!title) return new Response('', { status: 302, headers: { Location: `/christian-education/edit/${ceId}?msg=error` } });
    await env.DB.prepare('UPDATE bible_classes SET title=?, label=?, description=?, leader=?, location=?, schedule=?, accent=?, value=?, active=?, sort_order=? WHERE id=?')
      .bind(title, (ceForm.get('label')||'').trim()||null, (ceForm.get('description')||'').trim()||null, (ceForm.get('leader')||'').trim()||null, (ceForm.get('location')||'').trim()||null, (ceForm.get('schedule')||'').trim()||null, ceForm.get('accent')||'mid', normalizeValue(ceForm.get('value')), ceForm.getAll('active').includes('1') ? 1 : 0, parseInt(ceForm.get('sort_order')||'0', 10) || 0, ceId).run();
    return new Response('', { status: 302, headers: { Location: '/christian-education?msg=saved' } });
  }

  if (path.startsWith('/christian-education/toggle/') && method === 'POST') {
    const ceId = path.split('/').pop();
    await env.DB.prepare('UPDATE bible_classes SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').bind(ceId).run();
    return new Response('', { status: 302, headers: { Location: '/christian-education' } });
  }

  if (path.startsWith('/christian-education/delete/') && method === 'POST') {
    const ceId = path.split('/').pop();
    await env.DB.prepare('DELETE FROM bible_classes WHERE id = ?').bind(ceId).run();
    return new Response('', { status: 302, headers: { Location: '/christian-education?msg=deleted' } });
  }

  // ── NEWSLETTER APPROVE / REJECT (requires newsletter_approve) ──
  // Sent is permanent: neither of these has anywhere in the UI that offers
  // them on an already-sent issue, but with no server-side check that was
  // only ever a matter of the right stale tab or a stray click away —
  // Reject in particular would have reset a genuinely sent issue back to
  // draft with no warning. canEdit() is the one check the main
  // save path already trusts for this.
  if (path.startsWith('/newsletter/approve/') && method === 'POST') {
    if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
    const id = path.split('/').pop();
    const existing = await env.DB.prepare(
      'SELECT status, approval_status, sent_at, beehiiv_id, brevo_campaign_id FROM newsletters WHERE id = ?'
    ).bind(id).first();
    if (!canEdit(existing).ok) {
      return new Response('', { status: 302, headers: { Location: '/newsletters?msg=locked' } });
    }
    await env.DB.prepare("UPDATE newsletters SET status = 'published', approval_status = 'approved', approved_by_username = ? WHERE id = ?").bind(currentUser.username, id).run();
    return new Response('', { status: 302, headers: { Location: '/newsletters?msg=approved' } });
  }

  if (path.startsWith('/newsletter/reject/') && method === 'POST') {
    if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
    const id = path.split('/').pop();
    const existing = await env.DB.prepare(
      'SELECT status, approval_status, sent_at, beehiiv_id, brevo_campaign_id FROM newsletters WHERE id = ?'
    ).bind(id).first();
    if (!canEdit(existing).ok) {
      return new Response('', { status: 302, headers: { Location: '/newsletters?msg=locked' } });
    }
    await env.DB.prepare("UPDATE newsletters SET status = 'draft', approval_status = NULL, approved_by_username = NULL WHERE id = ?").bind(id).run();
    return new Response('', { status: 302, headers: { Location: '/newsletters?msg=rejected' } });
  }

  // ── REMOVE FROM WEBSITE / SHOW ON WEBSITE AGAIN ──
  // The one thing "a sent issue is read-only" (canEdit/isSent)
  // never covered: an issue that already reached ~600 inboxes cannot be
  // un-sent, and this does not try to. It only decides whether the archived
  // copy on timothystl.org still shows it — the words themselves, and the
  // fact that it went out, are untouched. Gated the same way Delete already
  // is (newsletter_approve), since removing a public record of a sent
  // communication is a meaningfully bigger decision than editing a draft.
  //
  // ⚠ Deliberately NOT gated by canEdit()/isSent() — this is the
  // one action that has to work on a SENT issue, which is the whole reason
  // it exists. It also works on an unsent one without complaint, though
  // "Save as draft" is the ordinary door for that case.
  if (path.startsWith('/newsletter/hide/') && method === 'POST') {
    if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
    const id = path.split('/').pop();
    const existing = await env.DB.prepare('SELECT id, subject FROM newsletters WHERE id = ?').bind(id).first();
    if (!existing) return new Response('', { status: 302, headers: { Location: '/newsletters' } });
    await env.DB.prepare('UPDATE newsletters SET hidden_from_site = 1 WHERE id = ?').bind(id).run();
    await logAudit(env.DB, currentUser, 'unpublish', 'newsletter', id, existing.subject || `Issue ${id}`, { hidden_from_site: 0 }, { hidden_from_site: 1 });
    return new Response('', { status: 302, headers: { Location: `/edit/${id}?msg=hidden` } });
  }

  if (path.startsWith('/newsletter/unhide/') && method === 'POST') {
    if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
    const id = path.split('/').pop();
    const existing = await env.DB.prepare('SELECT id, subject FROM newsletters WHERE id = ?').bind(id).first();
    if (!existing) return new Response('', { status: 302, headers: { Location: '/newsletters' } });
    await env.DB.prepare('UPDATE newsletters SET hidden_from_site = 0 WHERE id = ?').bind(id).run();
    await logAudit(env.DB, currentUser, 'publish', 'newsletter', id, existing.subject || `Issue ${id}`, { hidden_from_site: 1 }, { hidden_from_site: 0 });
    return new Response('', { status: 302, headers: { Location: `/edit/${id}?msg=unhidden` } });
  }

  // ── EDIT EXISTING NEWSLETTER (GET) ──
  if (path.startsWith('/edit/') && method === 'GET') {
    const editId = path.split('/').pop();
    const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(editId).first();
    if (!row) return new Response('Not found', { status: 404 });
    const fmt = row.format || 'weekly';
    const today2 = churchDate();
    const savedNewsIds = (row.news_item_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    const editEmailItems = await env.DB.prepare(
      `SELECT id, title, summary, publish_date FROM news_items
       WHERE publish_date <= ? AND (expire_date IS NULL OR expire_date >= ?)
         AND (channels IS NULL OR channels LIKE '%email%')
       ORDER BY COALESCE(event_date, publish_date) ASC LIMIT 20`
    ).bind(today2, today2).all();
    const editEventState = await newsletterEventRows(env, editId);
    const editEventPicker = eventPickerHtml(await upcomingEventPosts(env), editEventState.picked, editEventState.typed);
    const editNewsPickerHtml = editEmailItems.results.length === 0
      ? `<div style="font-size:13px;color:var(--gray);padding:10px 0;">No news items available. Add items in the News &amp; Events tab first.</div>`
      : editEmailItems.results.map(item => `
        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <input type="checkbox" name="news_item_ids" value="${item.id}"${savedNewsIds.includes(String(item.id)) ? ' checked' : ''} style="margin-top:3px;flex-shrink:0;">
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--charcoal);">${item.title}</div>
            ${item.summary ? `<div style="font-size:12px;color:var(--gray);margin-top:2px;">${item.summary.substring(0, 100)}${item.summary.length > 100 ? '…' : ''}</div>` : ''}
            <div style="font-size:11px;color:var(--gray);margin-top:2px;">${item.publish_date}</div>
          </div>
        </label>`).join('');

    const editBibleClassTemplatesRows = await env.DB.prepare('SELECT * FROM bible_classes WHERE active = 1 ORDER BY sort_order, id').all();
    const editBibleClassTemplates = editBibleClassTemplatesRows.results || [];
    const editTplCheckboxesHtml = editBibleClassTemplates.length ? editBibleClassTemplates.map(t => `
      <div id="tpl-row-${t.id}">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 0;border-bottom:1px solid var(--border);">
          <input type="checkbox" id="tpl-cb-${t.id}" onchange="toggleTpl(this, ${t.id})">
          <span style="font-size:14px;color:var(--charcoal);"><strong>${t.title}</strong>${t.leader ? ` · <span style="font-weight:400;">${t.leader}</span>` : ''}${t.location ? ` · <span style="font-weight:400;color:var(--gray);">${t.location}</span>` : ''}</span>
        </label>
        <div id="tpl-date-row-${t.id}" style="display:none;padding:8px 0 4px 26px;">
          <label style="font-size:11px;color:var(--gray);display:block;margin-bottom:4px;">Date for this session</label>
          <input type="date" id="tpl-date-${t.id}" oninput="syncTplDate(${t.id})" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:5px;">
          <input type="hidden" name="class_ids" id="tpl-cid-${t.id}" value="t${t.id}" disabled>
          <input type="hidden" name="class_date_t${t.id}" id="tpl-cdate-${t.id}" disabled>
          <input type="hidden" name="class_topic_t${t.id}" value="${t.title.replace(/"/g,'&quot;')}" id="tpl-ctopic-${t.id}" disabled>
          <input type="hidden" name="class_leader_t${t.id}" value="${(t.leader||'').replace(/"/g,'&quot;')}" id="tpl-cleader-${t.id}" disabled>
          <input type="hidden" name="class_location_t${t.id}" value="${(t.location||'').replace(/"/g,'&quot;')}" id="tpl-clocation-${t.id}" disabled>
        </div>
      </div>`).join('') : '';

    const existingClasses = JSON.parse(row.bible_classes || '[]');
    const classesJs = existingClasses.map(c => c.template_id ? `
      (function(){
        const cb = document.getElementById('tpl-cb-${c.template_id}');
        if (cb) { cb.checked = true; toggleTpl(cb, ${c.template_id}); }
        const di = document.getElementById('tpl-date-${c.template_id}');
        if (di) { di.value = ${JSON.stringify(c.date||'')}; syncTplDate(${c.template_id}); }
      })();` : `
      (function(){
        addBibleClass(${JSON.stringify(c.date||'')}, ${JSON.stringify(c.topic||'')}, ${JSON.stringify(c.location||'')}, ${JSON.stringify(c.leader||'')});
      })();`).join('');

    const bodyVal = (fmt === 'quick' ? row.pastor_note : '') || '';
    const pastorNoteVal = (fmt === 'weekly' ? row.pastor_note : '') || '';
    const copiedNotice = url.searchParams.get('copied') === '1'
      ? `<div class="alert alert-success">✓ Duplicated as a new draft. Update the subject, date, and content, then publish when ready.</div>`
      : '';
    const nlLocked = !canEdit(row).ok;
    const nlBlocks = parseBlocks(row.blocks);
    // ── Schedule send ──
    // A pending schedule is worth stating outright: Brevo already holds a campaign, and
    // scheduling again REPLACES nothing — it creates a second one — so somebody needs to
    // see that one is already booked before they book another.
    const schedAt = row.scheduled_send_at ? new Date(row.scheduled_send_at) : null;
    const schedPending = schedAt && !isNaN(schedAt.getTime()) && schedAt.getTime() > Date.now();
    const scheduledNote = schedPending
      ? `<div class="alert alert-info" style="margin-bottom:10px;">Already scheduled with Brevo for <strong>${escapeHtml(schedAt.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Chicago' }))}</strong> (${escapeHtml(row.scheduled_list_type === 'test' ? 'test list' : 'members')}). Scheduling again adds a second campaign rather than moving this one &mdash; cancel the first in <a href="https://app.brevo.com" target="_blank">Brevo</a> if that is not what you want.</div>`
      : '';
    // Default the picker to the issue's own publish date at 9am, which is when this
    // newsletter actually goes out — a blank datetime field is a small chore every time.
    // Falls forward to tomorrow if that date has already passed, so the field never opens
    // on a time Brevo will reject.
    const schedBase = new Date(`${row.published_at || churchDate()}T09:00:00`);
    if (isNaN(schedBase.getTime()) || schedBase.getTime() <= Date.now()) {
      schedBase.setTime(Date.now() + 24 * 60 * 60 * 1000);
      schedBase.setHours(9, 0, 0, 0);
    }
    const pad2 = (n) => String(n).padStart(2, '0');
    const defaultScheduleAt = `${schedBase.getFullYear()}-${pad2(schedBase.getMonth() + 1)}-${pad2(schedBase.getDate())}T${pad2(schedBase.getHours())}:${pad2(schedBase.getMinutes())}`;
    const subjAdvice = subjectAdvice(row.subject || '');
    const preAdvice = preheaderAdvice(row.preheader || '');
    const lockedMsg = url.searchParams.get('msg') === 'locked'
      ? `<div class="alert alert-error">That issue has already been sent, so it cannot be changed. Duplicate it as a draft to work from a copy.</div>` : '';
    const hiddenMsg = url.searchParams.get('msg') === 'hidden'
      ? `<div class="alert alert-success">Removed from the website. The email that already went out is unaffected — this only stops it appearing in the archive.</div>`
      : url.searchParams.get('msg') === 'unhidden'
      ? `<div class="alert alert-success">Back on the website archive.</div>` : '';
    const canHide = hasPermission(currentUser, 'newsletter_approve');

    // ── A CONFLICTING SAVE LANDS HERE, ON THE COPY IT MADE ──
    // Somebody else saved this issue in between this form loading and this
    // save being submitted — see hasConflict() in admin/newsletter.js. What
    // was just typed was never discarded: it is THIS row, a new draft, so
    // there is something concrete to point at rather than an apology.
    let conflictMsg = '';
    if (url.searchParams.get('msg') === 'conflict') {
      const otherId = url.searchParams.get('other');
      const other = otherId ? await env.DB.prepare('SELECT id, subject, updated_by FROM newsletters WHERE id = ?').bind(otherId).first() : null;
      conflictMsg = `<div class="alert alert-error"><strong>Somebody else saved changes to this issue while you were working on it${other?.updated_by ? ` (${escapeHtml(other.updated_by)})` : ''}.</strong> To make sure nothing you typed was lost, it was NOT written over their version — what you had is saved here instead, as its own draft. Open ${other ? `<a href="/edit/${other.id}" target="_blank">the issue you were editing</a>` : 'the original issue'} in another tab to see their version, and copy across whatever you still need by hand.</div>`;
    }

    // Every block gets a switch except the pastor's note, which is locked on:
    // an issue without it is not a newsletter. Switching one off hides it from
    // the email AND from the form, so a light week is a few clicks rather than
    // deleting content you will want back next week — the words stay put.
    const blockSwitches = BLOCKS.map((b) => `<label class="tlc-toggle" style="padding:7px 0;">
  <input type="checkbox" name="block_${b.key}" value="1"${nlBlocks[b.key] ? ' checked' : ''}${b.locked || nlLocked ? ' disabled' : ''}${b.locked ? '' : ' data-nlblock="1"'}>
  <span class="tlc-toggle-track"><span class="tlc-toggle-knob"></span></span>
  <span class="tlc-toggle-label">${escapeHtml(b.label)}${b.locked ? ' <span style="color:var(--tlc-muted);font-size:11.5px;">— always in</span>' : ''}</span>
</label>${b.locked ? '' : `<input type="hidden" name="block_seen" value="${b.key}">`}`).join('');

    // Editing an issue is one screen with two halves: what you are writing on
    // the left, and what it will look like on the right, kept live. The
    // preview is built by the same function the send path uses, so the two
    // cannot drift — the whole reason it is worth the width.
    // Whether a second person could approve this. With only one holder of
    // newsletter_approve the step is a formality, and approvalState() says so
    // rather than implying a review that cannot happen.
    const approvers = await env.DB.prepare("SELECT permissions FROM users WHERE active = 1").all().catch(() => ({ results: [] }));
    const approverCount = (approvers.results || []).filter((u) => {
      try { const p = JSON.parse(u.permissions || '[]'); return p === 'all' || (Array.isArray(p) && p.includes('newsletter_approve')); }
      catch (_) { return false; }
    }).length;
    const nlState = approvalState(row, currentUser, approverCount > 1);
    const nlStatus = issueStatus(row);
    const nlSendLine = nlLocked
      ? sendSummary(row)
      : [nlState.state === 'pending' ? 'Awaiting approval' : null,
         row.published_at ? `sends ${new Date(row.published_at + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : 'no date set yet',
        ].filter(Boolean).join(' · ');

    return html(`
${sidebarShell('newsletter', currentUser, '', badges)}
<div class="tlc-wrap">
<div class="tlc-section" style="padding-bottom:0;">
  <h1 class="tlc-title">${escapeHtml(sectionCfg('newsletter').title)}</h1>
  <p class="tlc-purpose">${escapeHtml(sectionCfg('newsletter').purpose)}</p>
  <div class="tlc-nl-crumb">
    <a class="tlc-tap-btn" href="/newsletters">← All issues</a>
    ${statusPill(nlStatus.tone, nlStatus.label)}
  </div>
  <p class="tlc-nl-when">${escapeHtml(nlSendLine)}</p>
  ${copiedNotice}
  ${lockedMsg}
  ${hiddenMsg}
  ${conflictMsg}
  ${nlLocked
    ? `<div class="alert alert-info"><strong>${escapeHtml(sendSummary(row))}.</strong> A sent issue is read-only — the archive on the website has to keep saying what was actually sent. To work from a copy, duplicate it as a draft.
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        <form method="POST" action="/newsletter/duplicate/${editId}" style="margin:0;"><button type="submit" class="btn btn-sm btn-primary">Duplicate as draft</button></form>
        ${canHide ? (row.hidden_from_site
          ? `<form method="POST" action="/newsletter/unhide/${editId}" style="margin:0;"><button type="submit" class="btn btn-sm btn-secondary">Show on the website again</button></form>`
          : `<form method="POST" action="/newsletter/hide/${editId}" style="margin:0;" onsubmit="return confirm('Take this issue off timothystl.org/news? The email that already went out cannot be recalled — this only removes it from the website archive. You can put it back any time.')"><button type="submit" class="btn btn-sm btn-danger">Remove from website</button></form>`
        ) : ''}
        </div></div>`
    : ''}
</div>

<div class="tlc-nl-cols">
<div class="tlc-nl-form">
<form method="POST" action="/publish" enctype="multipart/form-data" id="nl-form">
<input type="hidden" name="newsletter_id" value="${editId}">
<!-- The version of this issue that was on screen when this form was
     loaded. /publish compares it against the row's CURRENT updated_at —
     if somebody else saved a change in between, this form's own submit
     would otherwise blindly overwrite it (a real report: type a pastor's
     note, save, and it's gone — someone else's stale tab had saved over
     it). A mismatch never discards what was just typed; see the note by
     the conflict check itself. -->
<input type="hidden" name="expected_updated_at" value="${escapeHtml(row.updated_at || '')}">
<input type="hidden" name="format" id="format-input" value="${fmt}">

  <div class="card">
    <div class="card-title">Subject line</div>
    <div class="form-group">
      <input type="text" name="subject" required value="${(row.subject||'').replace(/"/g,'&quot;')}" ${nlLocked ? 'readonly' : ''}>
      <div style="font-size:12px;color:${subjAdvice.tone === 'warn' ? '#8a6a00' : 'var(--gray)'};margin-top:4px;">${escapeHtml(subjAdvice.text)}</div>
    </div>
    <div class="card-title" style="margin-top:18px;">Preview text</div>
    <div class="form-group">
      <input type="text" name="preheader" value="${escapeHtml(row.preheader || '')}" ${nlLocked ? 'readonly' : ''} placeholder="e.g. Advent begins Sunday, plus the Christmas Market dates">
      <div style="font-size:12px;color:${preAdvice.tone === 'warn' ? '#8a6a00' : 'var(--gray)'};margin-top:4px;">${escapeHtml(preAdvice.text)} — this is the gray line after the subject in an inbox.</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <div class="card-title">Format</div>
        <div class="tlc-fmt">
          <button type="button" class="tlc-fmt-pill${fmt==='weekly'?' is-on':''}" id="fmt-weekly" onclick="pickFormat('weekly')"${nlLocked ? ' disabled' : ''}>Weekly</button>
          <button type="button" class="tlc-fmt-pill${fmt==='quick'?' is-on':''}" id="fmt-quick" onclick="pickFormat('quick')"${nlLocked ? ' disabled' : ''}>Special edition</button>
        </div>
      </div>
      <div>
        <div class="card-title">Publish date</div>
        <div class="form-group" style="margin:0;">
          <input type="date" name="published_at" value="${row.published_at||''}" ${nlLocked ? 'readonly' : ''}>
        </div>
      </div>
    </div>
  </div>

<div class="card" style="background:var(--tlc-parchment);">
  <div class="card-title">What goes in this issue</div>
  <div style="font-size:13px;color:var(--gray);margin-bottom:10px;">Switch a section off and it disappears from the email — the words stay saved for next week.</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 18px;">${blockSwitches}</div>
</div>

  <div id="weekly-fields" style="display:${fmt==='weekly'?'':'none'}">
    <div class="card">
      <div class="card-title">Pastor's note</div>
      ${tinymcePastorSection(pastorNoteVal)}
    </div>
    <div class="card">
      <div class="card-title">Secondary note <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A second free-form text block that appears in the email below the pastor's note. Leave blank to omit.</div>
      <div class="form-group">
        ${tinymceNoteSection('secondary-editor', 'secondary_note', row.secondary_note || '', 140)}
      </div>
    </div>
    <div class="card">
      <div class="card-title">News &amp; Events <span class="tag">Pick from your posts</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Check items to include. The <strong>first checked item</strong> appears as the featured story, the <strong>second</strong> as secondary news, and the rest as compact cards — all with a "Read more" link. Long text is automatically trimmed.</div>
      ${editNewsPickerHtml}
    </div>
    <div class="card">
      <div class="card-title">Upcoming events <span class="tag">Pick from your posts</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Every News &amp; Events post with a date from today onward. Ticking one prints it here <strong>and</strong> puts it on the church calendar and the printed month — it is the same record, entered once.</div>
      ${editEventPicker}
    </div>
    <div class="card">
      <div class="card-title">Bible Classes <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">Check classes meeting this week. Each checked class will appear at the bottom of the email with a link to the full calendar.</div>
      ${editTplCheckboxesHtml}
      <div id="classes-container" style="${editBibleClassTemplates.length ? 'margin-top:12px;' : ''}"></div>
      <button type="button" class="add-event-btn" onclick="addBibleClass()" style="margin-top:${editBibleClassTemplates.length ? '6' : '0'}px;">${editBibleClassTemplates.length ? '+ Add one-time class' : '+ Add a class'}</button>
    </div>
    <div class="card">
      <div class="card-title">Word of Life &amp; LASM <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:14px;">These appear side by side in the email — left half Word of Life, right half LASM. Leave either blank to omit it.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group" style="margin:0;">
          <label>Word of Life</label>
          ${tinymceNoteSection('wol-editor', 'wol_content', row.wol_content || '', 120)}
        </div>
        <div class="form-group" style="margin:0;">
          <label>LASM</label>
          ${tinymceNoteSection('lasm-editor', 'lasm_content', row.lasm_content || '', 120)}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Tertiary note / CTA <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A full-width block below Word of Life &amp; LASM. Use it for a call-to-action, an announcement, or a sign-up link. Leave blank to omit.</div>
      <div class="form-group">
        ${tinymceNoteSection('tertiary-editor', 'tertiary_note', row.tertiary_note || '', 140)}
      </div>
      <div style="display:flex;gap:12px;margin-top:8px;">
        <div class="form-group" style="flex:1;margin:0;">
          <label>Button label <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
          <input type="text" name="tertiary_cta_label" value="${(row.tertiary_cta_label||'').replace(/"/g,'&quot;')}" placeholder="e.g. Sign Up, RSVP, Learn More">
        </div>
        <div class="form-group" style="flex:1;margin:0;">
          <label>Button link (URL) <span style="font-weight:400;color:var(--gray);">(optional)</span></label>
          <input type="url" name="tertiary_cta_url" value="${(row.tertiary_cta_url||'').replace(/"/g,'&quot;')}" placeholder="https://...">
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">More notes <span class="tag">Optional</span></div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">A fourth and fifth block, below everything else — a thank-you, a correction, a one-off appeal. Each appears only if you write something in it.</div>
      ${extraNoteFields(parseExtras(row.extra_notes))}
      <button type="button" class="add-event-btn" id="add-extra-note">+ Add another note</button>
      ${extraNotesScript}
    </div>
  </div>

  <div id="quick-fields" style="display:${fmt==='quick'?'':'none'}">
    <div class="card">
      <div class="card-title">Message</div>
      <div class="form-group">
        ${tinymceNoteSection('quick-editor', 'quick_body', bodyVal, 140)}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Button <span class="tag">Optional</span></div>
      <div class="form-group">
        <label>Button label</label>
        <input type="text" name="cta_label" value="${(row.cta_label||'').replace(/"/g,'&quot;')}" placeholder="e.g. Sign Up">
      </div>
      <div class="form-group">
        <label>Button link (URL)</label>
        <input type="url" name="cta_url" value="${(row.cta_url||'').replace(/"/g,'&quot;')}" placeholder="https://...">
      </div>
    </div>
  </div>

  ${hasPermission(currentUser, 'newsletter_approve') ? `
  <div class="card" style="border-color:var(--amber);">
    <div class="card-title">Send email</div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-bottom:12px;"><strong>Publish</strong> sends to the selected list and goes live on the website. <strong>Save as draft</strong> saves without sending anything.</div>
    <div class="radio-row">
      <label><input type="radio" name="email_send" value="test" checked> Test list</label>
      <label><input type="radio" name="email_send" value="all"> Members</label>
      <label><input type="radio" name="email_send" value="none"> Website only (no email)</label>
    </div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-top:6px;">These are the two lists in Brevo &mdash; the test list and the member list. This is the only place the audience is chosen.</div>
    <div style="margin-top:14px;padding:12px 14px;background:var(--mist);border-radius:8px;border:1px solid var(--ice);font-family:var(--sans);font-size:12px;color:var(--charcoal);line-height:1.7;">
      📊 <strong>Email is sent via Brevo.</strong> To see open rates, clicks, and delivery stats after sending, log in at <a href="https://app.brevo.com" target="_blank" style="color:var(--mid);font-weight:700;">app.brevo.com</a> → Campaigns.
    </div>
  </div>` : ''}

  <div class="btn-row" style="margin-top:8px;">
    ${hasPermission(currentUser, 'newsletter_approve') ? `<button type="submit" name="action" value="publish" class="btn btn-primary">Publish</button>` : ''}
    <button type="submit" name="action" value="draft" class="btn btn-secondary">Save as draft</button>
    <a href="/newsletters" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
  </div>

</form>

  ${hasPermission(currentUser, 'newsletter_approve') ? `
  <!-- Schedule send. Sits OUTSIDE #nl-form on purpose: a form inside a form is invalid
       HTML and the browser drops the inner one, so this has to be its own form even
       though it reads as part of the button row above it.
       ⚠ It posts the issue AS ALREADY SAVED. Brevo builds the campaign from the stored
       row at this moment, so anything typed but not saved is not in the scheduled email —
       hence the reminder in the copy rather than a silent surprise next Sunday. -->
  <div class="card" style="margin-top:14px;">
    <div class="card-title">Schedule send <span class="tag">Optional</span></div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-bottom:10px;">
      Hand the issue to Brevo now and have it go out at a set date and time. Save your changes first &mdash; Brevo builds the email from the saved issue, not from what is on screen.
    </div>
    ${scheduledNote}
    <button type="button" class="btn btn-secondary" onclick="toggleSchedule(${row.id})">${row.scheduled_send_at ? 'Reschedule&hellip;' : 'Schedule send&hellip;'}</button>
    <div id="sched-row-${row.id}" style="display:none;margin-top:12px;">
      <form method="POST" action="/schedule-email/${row.id}" onsubmit="return prepSchedule(this)">
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div class="form-group" style="margin:0;">
            <label>Date and time</label>
            <input type="datetime-local" name="scheduled_at_local" value="${defaultScheduleAt}" required>
          </div>
          <div class="form-group" style="margin:0;">
            <label>Send to</label>
            <select name="list_type">
              <option value="all">Members</option>
              <option value="test">Test list</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary">Schedule</button>
        </div>
        <!-- prepSchedule() fills this with a real ISO instant computed in the browser's own
             timezone: the Worker runs in UTC and cannot turn "2026-08-09T09:00" back into
             the office's local time. -->
        <input type="hidden" name="scheduled_at">
      </form>
    </div>
  </div>` : ''}
</div>

<aside class="tlc-nl-preview">
  <div class="tlc-nl-preview-head">
    <span class="tlc-panel-title">Live preview</span>
    <button type="button" class="tlc-tap-btn" id="nl-preview-btn">Refresh</button>
  </div>
  <div class="tlc-nl-inbox">
    <span class="tlc-nl-inbox-subj" id="nl-inbox-subj">${escapeHtml(row.subject || 'Untitled issue')}</span>
    <span class="tlc-nl-inbox-pre" id="nl-inbox-pre">${escapeHtml(row.preheader || 'No preview text yet')}</span>
  </div>
  <iframe id="nl-preview" title="Email preview" class="tlc-nl-frame"></iframe>
  <p class="tlc-note" style="margin:10px 0 0;"><span class="tlc-note-mark">◆</span><span>Built by the same code that sends the email, so what you see here and what lands in an inbox cannot drift apart. A section switched off is missing from this preview too.</span></p>
</aside>
</div>
</div>
<script>(function(){
// The inbox strip above the frame mirrors the two fields as you type — those
// are the only part of an email most people ever read, and waiting for a
// round trip to see them would be the wrong trade.
var form = document.getElementById('nl-form');
var subj = form && form.querySelector('input[name=subject]');
var pre = form && form.querySelector('input[name=preheader]');
if (subj) subj.addEventListener('input', function(){
  document.getElementById('nl-inbox-subj').textContent = subj.value || 'Untitled issue';
});
if (pre) pre.addEventListener('input', function(){
  document.getElementById('nl-inbox-pre').textContent = pre.value || 'No preview text yet';
});

var btn = document.getElementById('nl-preview-btn');
var frame = document.getElementById('nl-preview');
if (!btn || !frame || !form) return;
function refresh(){
  // TinyMCE keeps its content in an iframe until asked, so a preview taken
  // straight from the textareas would show the last saved text rather than
  // what is on screen.
  if (window.tinymce && tinymce.triggerSave) { try { tinymce.triggerSave(); } catch(e){} }
  btn.textContent = 'Updating…'; btn.disabled = true;
  fetch('/newsletter/preview', { method: 'POST', body: new FormData(form) })
    .then(function(r){ return r.text(); })
    .then(function(html){ frame.srcdoc = html; })
    .catch(function(){ frame.srcdoc = '<p style="font-family:sans-serif;padding:20px;color:#8A4A4A;">Could not build the preview just now.</p>'; })
    .finally(function(){ btn.textContent = 'Refresh'; btn.disabled = false; });
}
btn.addEventListener('click', refresh);
// Typing anywhere in the form redraws the body, but only once you pause —
// a request per keystroke would make the preview slower, not more live.
var t = null;
form.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(refresh, 900); });
form.addEventListener('change', function(){ clearTimeout(t); t = setTimeout(refresh, 300); });
refresh();
})();</script>
<script>
let classCount = 0;
function addBibleClass(date, topic, location, leader) {
const c = document.getElementById('classes-container');
const id = ++classCount;
const div = document.createElement('div');
div.className = 'event-block'; div.id = 'class-'+id;
div.innerHTML = \`<button type="button" class="remove-event" onclick="removeBibleClass(\${id})">×</button>
  <div class="event-grid">
    <div class="form-group" style="margin:0;"><label>Date</label><input type="date" name="class_date_\${id}" value="\${date||''}"></div>
    <div class="form-group" style="margin:0;"><label>Topic</label><input type="text" name="class_topic_\${id}" placeholder="e.g. The Sermon on the Mount" value="\${topic||''}"></div>
  </div>
  <div class="event-grid" style="margin-top:12px;">
    <div class="form-group" style="margin:0;"><label>Location</label><input type="text" name="class_location_\${id}" placeholder="e.g. Fellowship Hall" value="\${location||''}"></div>
    <div class="form-group" style="margin:0;"><label>Leader</label><input type="text" name="class_leader_\${id}" placeholder="e.g. Pastor Matt" value="\${leader||''}"></div>
  </div>
  <input type="hidden" name="class_ids" value="\${id}">\`;
c.appendChild(div);
}
function removeBibleClass(id) { document.getElementById('class-'+id).remove(); }
function toggleTpl(cb, tplId) {
const row = document.getElementById('tpl-date-row-'+tplId);
const ids = ['tpl-cid-'+tplId, 'tpl-cdate-'+tplId, 'tpl-ctopic-'+tplId, 'tpl-cleader-'+tplId, 'tpl-clocation-'+tplId];
row.style.display = cb.checked ? '' : 'none';
ids.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !cb.checked; });
}
function syncTplDate(tplId) {
const v = document.getElementById('tpl-date-'+tplId)?.value || '';
const h = document.getElementById('tpl-cdate-'+tplId);
if (h) h.value = v;
}
function pickFormat(fmt) {
document.getElementById('format-input').value = fmt;
document.getElementById('fmt-weekly').classList.toggle('is-on', fmt === 'weekly');
document.getElementById('fmt-quick').classList.toggle('is-on', fmt === 'quick');
document.getElementById('weekly-fields').style.display = fmt === 'weekly' ? '' : 'none';
document.getElementById('quick-fields').style.display = fmt === 'quick' ? '' : 'none';
}
${classesJs}
</script>`, 'Edit Newsletter', TINYMCE_HEAD);
  }

  // ── SEND EMAIL (for saved newsletters) ──
  if (path.startsWith('/send-email/') && method === 'POST') {
    if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
    const id = path.split('/').pop();
    const form = await request.formData();
    const listType = form.get('list_type') || 'test';
    const listId = listType === 'test' ? parseInt(env.BREVO_TEST_LIST_ID || '2', 10) : parseInt(env.BREVO_LIST_ID || '0', 10);

    if (!listId && listType === 'all') {
      return new Response('', {
        status: 302,
        headers: { Location: `/newsletters?msg=emailed&emailerr=${encodeURIComponent('BREVO_LIST_ID secret is not configured. Set it in Cloudflare Workers → Settings → Variables & Secrets.')}` }
      });
    }

    const payload = await buildNewsletterEmailPayload(env, id);
    if (!payload) return new Response('Not found', { status: 404 });
    const { row, emailHtml } = payload;
    const result = await sendBrevoNewsletter(env, { subject: row.subject, htmlContent: emailHtml, listIds: [listId] });

    // Sending to all = publish the newsletter so it appears on the website,
    // and record what actually went out. sent_at is what locks the issue from
    // then on, and sent_count is what the list shows instead of guessing —
    // "Sent 24 July to 609 subscribers" is a fact, not an estimate. The count
    // comes from the real Brevo list, not the local signup table — that table
    // only holds website-form signups and badly undercounts an audience also
    // built from Breeze imports/manual adds.
    if (listType === 'all' && result.success) {
      const recipients = await getBrevoListCount(env, listId);
      await env.DB.prepare(
        "UPDATE newsletters SET status = 'published', approval_status = 'approved', approved_by_username = ?, published_at = COALESCE(published_at, ?), sent_at = COALESCE(sent_at, ?), sent_count = COALESCE(sent_count, ?) WHERE id = ?"
      ).bind(currentUser.username, churchDate(), new Date().toISOString(), recipients, id).run();
    }

    const suffix = result.success
      ? `&emailed=${listType}`
      : `&emailerr=${encodeURIComponent(result.error)}`;
    return new Response('', {
      status: 302,
      headers: { Location: `/newsletters?msg=emailed&subject=${encodeURIComponent(row.subject)}${suffix}` }
    });
  }

  // ── SCHEDULE SEND (Brevo scheduledAt — send-to-all only) ──
  if (path.startsWith('/schedule-email/') && method === 'POST') {
    if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
    const id = path.split('/').pop();
    const form = await request.formData();
    const listType = form.get('list_type') || 'all';
    const listId = listType === 'test' ? parseInt(env.BREVO_TEST_LIST_ID || '2', 10) : parseInt(env.BREVO_LIST_ID || '0', 10);
    // Submitted by prepSchedule() in helpers.js as a browser-computed ISO
    // instant — the Worker itself runs in UTC and can't turn a bare
    // "2026-07-20T09:00" string back into the office's actual local time.
    const scheduledAtSubmitted = form.get('scheduled_at') || '';

    if (!listId) {
      return new Response('', {
        status: 302,
        headers: { Location: `/newsletters?msg=emailed&emailerr=${encodeURIComponent('BREVO_LIST_ID secret is not configured. Set it in Cloudflare Workers → Settings → Variables & Secrets.')}` }
      });
    }
    const scheduledDate = scheduledAtSubmitted ? new Date(scheduledAtSubmitted) : null;
    if (!scheduledDate || isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      return new Response('', {
        status: 302,
        headers: { Location: `/newsletters?msg=emailed&emailerr=${encodeURIComponent('Pick a valid date/time in the future to schedule this send.')}` }
      });
    }
    const scheduledAtIso = scheduledDate.toISOString();

    const payload = await buildNewsletterEmailPayload(env, id);
    if (!payload) return new Response('Not found', { status: 404 });
    const { row, emailHtml } = payload;
    const result = await sendBrevoNewsletter(env, { subject: row.subject, htmlContent: emailHtml, listIds: [listId], scheduledAt: scheduledAtIso });

    if (result.success) {
      await env.DB.prepare(
        'UPDATE newsletters SET scheduled_send_at = ?, scheduled_list_type = ?, brevo_campaign_id = ? WHERE id = ?'
      ).bind(scheduledAtIso, listType, String(result.campaignId), id).run();

      // There's no Brevo→worker callback for "campaign actually sent", and no
      // Workers Cron in this project to poll for it — publish now (like an
      // immediate send-to-all does) so the archive link the email points back
      // to (buildEmailHtml's /news/{id} "Read the full letter" link) is live
      // by the time Brevo delivers it, rather than 404ing until someone
      // happens to revisit this page after the scheduled time.
      if (listType === 'all') {
        await env.DB.prepare(
          "UPDATE newsletters SET status = 'published', approval_status = 'approved', approved_by_username = ?, published_at = COALESCE(published_at, ?) WHERE id = ?"
        ).bind(currentUser.username, churchDate(), id).run();
      }
    }

    const suffix = result.success
      ? `&scheduled=1`
      : `&emailerr=${encodeURIComponent(result.error)}`;
    return new Response('', {
      status: 302,
      headers: { Location: `/newsletters?msg=emailed&subject=${encodeURIComponent(row.subject)}${suffix}` }
    });
  }

  // ── CANCEL SCHEDULED SEND ──
  if (path.startsWith('/newsletter/cancel-schedule/') && method === 'POST') {
    if (!hasPermission(currentUser, 'newsletter_approve')) return new Response('Access denied.', { status: 403 });
    const id = path.split('/').pop();
    const row = await env.DB.prepare('SELECT brevo_campaign_id FROM newsletters WHERE id = ?').bind(id).first();
    if (!row) return new Response('Not found', { status: 404 });

    if (row.brevo_campaign_id) {
      const result = await cancelBrevoCampaign(env, row.brevo_campaign_id);
      if (!result.success) {
        return new Response('', {
          status: 302,
          headers: { Location: `/newsletters?msg=emailed&emailerr=${encodeURIComponent(result.error)}` }
        });
      }
    }
    await env.DB.prepare(
      'UPDATE newsletters SET scheduled_send_at = NULL, scheduled_list_type = NULL, brevo_campaign_id = NULL WHERE id = ?'
    ).bind(id).run();
    return new Response('', { status: 302, headers: { Location: `/newsletters?msg=emailed&scheduled=cancelled` } });
  }

  // ── LIVE EMAIL PREVIEW ──
  // Rendered by buildEmailHtml — the exact function the send path uses — from
  // the values currently in the form. That is the whole point: a preview
  // written separately would drift from the email, and nobody would find out
  // until an issue had already gone to ~600 people.
  if (path === '/newsletter/preview' && method === 'POST') {
    if (!hasPermission(currentUser, 'newsletter_edit') && !hasPermission(currentUser, 'newsletter_approve')) {
      return new Response('Access denied.', { status: 403 });
    }
    const f = await request.formData();
    const fmt = f.get('format') || 'weekly';
    const on = (key) => f.get('block_' + key) === '1';

    // Events come from the form as it is being edited, so the preview shows
    // unsaved ticks rather than what is in the database — read through the
    // SAME collector the save uses, or the preview would flatter what will
    // actually send.
    const events = on('events') ? await newsletterEventsFromForm(env, f) : [];

    let newsItems = [];
    const newsIds = on('news') ? f.getAll('news_item_ids').filter(Boolean) : [];
    if (newsIds.length) {
      try {
        const ph = newsIds.map(() => '?').join(',');
        const nr = await env.DB.prepare(`SELECT id, title, summary, body, image_url FROM news_items WHERE id IN (${ph})`).bind(...newsIds).all();
        const map = Object.fromEntries((nr.results || []).map((r) => [String(r.id), r]));
        newsItems = newsIds.map((n) => map[n]).filter(Boolean);
      } catch (_) { newsItems = []; }
    }

    let classes = [];
    if (on('classes')) { try { classes = JSON.parse(f.get('bible_classes_json') || '[]'); } catch (_) { classes = []; } }

    const emailHtml = buildEmailHtml(
      f.get('subject') || '(no subject yet)',
      f.get('pastor_note') || f.get('quick_body') || '',
      events,
      on('wol') ? (f.get('wol_content') || '') : '',
      on('lasm') ? (f.get('lasm_content') || '') : '',
      f.get('published_at') || churchDate(),
      newsItems,
      on('secondary') ? (f.get('secondary_note') || '') : '',
      f.get('newsletter_id') || null,
      fmt,
      on('cta') ? (f.get('cta_url') || '') : '',
      on('cta') ? (f.get('cta_label') || '') : '',
      on('tertiary') ? (f.get('tertiary_note') || '') : '',
      on('tertiary') ? (f.get('tertiary_cta_label') || '') : '',
      on('tertiary') ? (f.get('tertiary_cta_url') || '') : '',
      classes,
      extrasFromForm(f)
    );
    return new Response(emailHtml, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  // ── DELETE ──
  if (path.startsWith('/delete/') && method === 'POST') {
    const id = path.split('/').pop();
    const toDelete = await env.DB.prepare('SELECT status FROM newsletters WHERE id = ?').bind(id).first();
    if (toDelete && toDelete.status !== 'draft' && !hasPermission(currentUser, 'newsletter_approve')) {
      return new Response('Access denied. Only admins can delete published newsletters.', { status: 403 });
    }
    await env.DB.prepare('DELETE FROM events WHERE newsletter_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(id).run();
    // Back to the newsletter list, which is where the issue lived — News &
    // Events is a different section now.
    return new Response('', { status: 302, headers: { Location: '/newsletters?msg=deleted' } });
  }

  // ── DUPLICATE ──
  if (path.startsWith('/newsletter/duplicate/') && method === 'POST') {
    const id = path.split('/').pop();
    const row = await env.DB.prepare('SELECT * FROM newsletters WHERE id = ?').bind(id).first();
    if (!row) return new Response('Not found', { status: 404 });
    const eventsRows = await env.DB.prepare('SELECT * FROM events WHERE newsletter_id = ? ORDER BY sort_order').bind(id).all();
    const copyPublishedAt = row.published_at || churchDate();
    // Duplicate is only ever offered on a sent issue (canEdit refuses the
    // regular edit form for anything else) — but this is checked rather
    // than assumed, because a copy of a draft has nothing to supersede.
    // See NEWSLETTER_PUBLIC_WHERE_SQL: once THIS copy is itself sent, the
    // original drops out of the public archive; until then it is untouched.
    const supersedesId = isSent(row) ? row.id : null;
    const result = await env.DB.prepare(
      'INSERT INTO newsletters (subject, pastor_note, ministry_content, ministry_type, published_at, format, cta_url, cta_label, status, wol_content, lasm_content, secondary_note, news_item_ids, tertiary_note, tertiary_cta_label, tertiary_cta_url, bible_classes, extra_notes, supersedes_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      `Copy of ${row.subject}`, row.pastor_note, row.ministry_content, row.ministry_type, copyPublishedAt, row.format,
      row.cta_url, row.cta_label, 'draft', row.wol_content, row.lasm_content, row.secondary_note,
      row.news_item_ids, row.tertiary_note, row.tertiary_cta_label, row.tertiary_cta_url, row.bible_classes,
      // A copy carries the extra notes too — the whole point of duplicating a
      // sent issue is to start from what actually went out.
      row.extra_notes || '[]', supersedesId
    ).run();
    const newId = result.meta.last_row_id;
    for (const e of eventsRows.results) {
      await env.DB.prepare(
        'INSERT INTO events (newsletter_id, event_date, event_name, event_time, event_desc, sort_order, news_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(newId, e.event_date, e.event_name, e.event_time, e.event_desc, e.sort_order, e.news_item_id ?? null).run();
    }
    return new Response('', { status: 302, headers: { Location: `/edit/${newId}?copied=1` } });
  }

  // ── NEWS & EVENTS: COMBINED LIST (Newsletter + News Posts) ──
  if (path === '/newsitems' && method === 'GET') {
    // Backgrounded, not awaited: an R2 delete plus a D1 DELETE per expired
    // row was blocking every single visit to this screen on work that is a
    // no-op almost every time. An item's own `state` already reads
    // 'expired' straight off its `expire_date` regardless of whether this
    // sweep has run yet, so deferring it costs nothing but one extra
    // "Expired" pill showing for the one visit before the row is actually
    // removed — the same screen already shows that state on purpose.
    ctx.waitUntil(sweepExpiredItems(env, new URL(request.url).origin));
    const itemsRes = await env.DB.prepare(
      'SELECT * FROM news_items ORDER BY pinned DESC, COALESCE(event_date, publish_date) DESC, id DESC'
    ).all();
    const today = churchDate();
    const soon = churchDatePlus(3);
    const msgParam = url.searchParams.get('msg');
    const alertHtml = msgParam === 'saved' ? `<div class="alert alert-success">✓ News post saved.</div>`
      : msgParam === 'deleted' ? `<div class="alert alert-info">Post deleted.</div>` : '';

    const listRows = itemsRes.results.map((item) => {
      let state = 'live';
      if (item.publish_date && item.publish_date > today) state = 'scheduled';
      else if (item.expire_date && item.expire_date < today) state = 'expired';
      const expiringSoon = state === 'live' && item.expire_date && item.expire_date <= soon;
      // A post that goes on the month and deliberately not into the news
      // feed — a school break, a week of testing. `channels` is a list, so a
      // post ticked for the calendar AND the website is not one of these.
      const calOnly = String(item.channels || '').split(',').map((c) => c.trim()).filter(Boolean).join(',') === 'calendar';

      const status = state === 'scheduled' ? statusPill('auto', 'Scheduled')
        : state === 'expired' ? statusPill('plain', 'Expired')
        : expiringSoon ? statusPill('warn', 'Expiring')
        : statusPill('good', 'Live');

      // The expire date is the field that matters on this screen: a post
      // carrying one disappears on its own, which is the whole reason the
      // site does not go stale. A post without one never leaves, so it is
      // called out rather than left blank.
      const expires = item.expire_date
        ? escapeHtml(item.expire_date)
        : calOnly
          ? `<span style="color:#6A6858;">On the calendar</span>`
          : `<span style="color:#7A5B18;">Never</span>`;

      return {
        href: `/newsitems/edit/${item.id}`,
        // ⚠ A CALENDAR-ONLY POST IS ITS OWN FILTER, because there are
        // twenty-nine of them and this list sorts furthest-future first —
        // so the school year sits on top of whatever the office wrote for
        // next Sunday. The chip isolates them; it does not hide them from
        // All, which would make the list a half-truth.
        filter: [state, item.value || '', calOnly ? 'calendar-only' : ''].filter(Boolean),
        search: `${item.title} ${item.summary || ''} ${valueByKey(item.value)?.short || ''}`.toLowerCase(),
        cells: [
          // The pin marker sits BEFORE the title, where the eye starts —
          // the rows are already sorted pinned-first, so the marker's job is
          // to explain why this row is up here, not to be found. No emoji in
          // the admin chrome; the fallback is a typographic glyph like every
          // other icon in the pattern.
          `<div class="tlc-primary">
            <span class="tlc-primary-icon tlc-primary-icon--file">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : '▤'}</span>
            <span class="tlc-primary-text">
              <span class="tlc-primary-title">${item.pinned ? '<span class="tlc-pin" title="Pinned to the top" aria-label="Pinned">▲</span>' : ''}${escapeHtml(item.title)}${item.value ? ` ${valueChip(item.value)}` : ''}</span>
              <span class="tlc-primary-sub">${escapeHtml((item.summary || '').slice(0, 80))}</span>
            </span></div>`,
          escapeHtml(item.publish_date || '—'),
          expires,
          status,
        ],
        warn: (!item.expire_date && !calOnly)
          ? 'No expiry date, so this post stays on the site until somebody removes it by hand.'
          : '',
        warnCta: (!item.expire_date && !calOnly) ? { label: 'Set one', href: `/newsitems/edit/${item.id}` } : null,
      };
    });

    return html(`
${sidebarShell('news', currentUser, `<a href="https://timothystl.org/news" target="_blank">View site</a>`, badges)}
<div class="tlc-wrap">
${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
${renderListSection({
  key: 'news',
  title: sectionCfg('news').title,
  purpose: sectionCfg('news').purpose,
  action: { label: sectionCfg('news').action, href: '/newsitems/new' },
  search: sectionCfg('news').search,
  filters: filtersOf('news'),
  valueChips: sectionCfg('news').valueChips,
  columns: columnsOf('news'),
  rows: listRows,
  noun: 'post',
  empty: 'No news posts yet.',
  note: sectionCfg('news').note,
})}
</div>`, 'TLC Admin — News & Events');
  }

  // ── NEWS ITEMS: NEW FORM ──
  // ── NEWS ITEMS: THE FORM, ONCE ──
  // New and Edit were two near-identical copies of the same 90 lines, on the
  // old chrome. One builder now, through the shared form renderer, so a post
  // opened from the redesigned list stays in the redesign.
  // The live category list, for the picker below. Read once per render
  // rather than per field, and falling back to the shipped list so the form
  // still offers something sensible if the table cannot be read.
  const newsCalCats = activeCategories(mergedCategories(
    ((await env.DB.prepare('SELECT key, name, color_id, palette, sort_order, active FROM calendar_categories')
      .all().catch(() => ({ results: [] }))).results) || []
  ));
  const newsFormHtml = (item = null) => {
    const isNew = !item;
    const today = churchDate();
    const in90 = churchDatePlus(90);
    const ch = item ? (item.channels == null ? 'web' : item.channels) : 'web,email';
    const on = (k) => (item ? ch.includes(k) : (k === 'web' || k === 'email'));
    const box = (name, label, checked) =>
      `<label class="tlc-choice"><input type="checkbox" name="${name}" value="1"${checked ? ' checked' : ''}><span>${label}</span></label>`;
    return renderFormSection({
      title: isNew ? 'New post' : item.title || 'Edit post',
      purpose: isNew
        ? 'Announcements and dated events. A post with an expire date drops off the site on its own.'
        : 'Changes reach the website as soon as you save.',
      action: isNew ? '/newsitems/create' : `/newsitems/update/${item.id}`,
      cancelHref: '/newsitems',
      saveLabel: isNew ? 'Save and publish' : 'Save changes',
      deleteAction: isNew ? '' : `/newsitems/delete/${item.id}`,
      deleteConfirm: `Delete “${(item && item.title) || 'this post'}”? It disappears from the website.`,
      wide: true,
      note: 'Expiry is what keeps the site honest — a post with an expire date disappears without anyone remembering to delete it.',
      fields: [
        { name: 'title', label: 'Title', value: item ? item.title : '', required: true, placeholder: 'Easter services — April 20' },
        { kind: 'textarea', name: 'summary', label: 'Summary', rows: 3, value: item ? (item.summary || '') : '',
          placeholder: 'Two or three sentences.', hint: 'What shows on the card, before anybody clicks through.' },
        // ⚠ The value column has existed since v3.0.0 and the list filters on
        // it, but no form ever set one — so every post was untagged and the
        // filter could never match. Same shape of bug as the tap counter.
        { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">Value</label>${valueChips('value', item ? item.value : null)}<p class="tlc-hint">Which of the four this post serves. Used by the filters and the values report.</p></div>` },
        // ⚠ Only offered on a post that HAS an event date, because only
        // those reach the calendar at all. Offering it on an announcement
        // would be a control that looks live and does nothing.
        { kind: 'choice', name: 'calendar_category', label: 'On the calendar, this is',
          value: item ? (item.calendar_category || '') : '',
          options: [{ value: '', label: '— work it out from the value above —' }]
            .concat(newsCalCats.map((c) => ({ value: c.key, label: c.name }))),
          hint: 'Only used when the post has an event date. Sets which category it files under on the church calendar — the same list a Google event\u2019s color chooses from. Change the list under Pages \u2192 Calendar.' },
        { kind: 'html', html: tinymceEditorSection(item ? (item.body || '') : '') },
        { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">Header image</label>
          <input type="hidden" name="image_url" id="image_url_val" value="">
          <input type="file" id="image_url_file" accept="image/*">
          <div id="image-url-status" class="tlc-hint"></div>
          <div id="image-url-preview" style="display:none;margin-top:8px;max-width:240px;"></div>
          <p class="tlc-hint">Optional. Shown as the card thumbnail.</p></div>` },
        { kind: 'choice', name: 'theme', label: 'Theme', value: item ? (item.theme || '') : '',
          options: [{ value: '', label: '— none —' }].concat(THEMES.map((t) => ({ value: t, label: t }))) },
        { kind: 'choice', name: 'content_type', label: 'Content type', value: item ? (item.content_type || '') : '',
          options: [{ value: '', label: '— none —' }].concat(CONTENT_TYPES.map((t) => ({ value: t, label: t }))) },
        { kind: 'html', html: `<div class="tlc-field"><label class="tlc-label">Where it appears</label>
          <div class="tlc-choices">${box('ch_web', 'Website', on('web'))}${box('ch_email', 'Email newsletter', on('email'))}${box('ch_calendar', 'Church calendar only', on('calendar'))}${box('ch_bulletin', 'Bulletin', on('bulletin'))}${box('ch_social', 'Social media', on('social'))}</div>
          <p class="tlc-hint">The weekly email pulls from the posts ticked for it, rather than asking you to retype them. A dated post is on the calendar either way \u2014 tick <strong>Church calendar only</strong> for a date that belongs on the month but is not news anybody wants to read a paragraph about.</p></div>` },
        { kind: 'date', name: 'publish_date', label: 'Publish date', value: item ? (item.publish_date || '') : today },
        { kind: 'date', name: 'event_date', label: 'Event date', value: item ? (item.event_date || '') : '',
          hint: 'Optional. A post with one sorts by the event rather than by when it was written \u2014 and appears on the church calendar, the printed month and the weekly email, without being entered anywhere else.' },
        // ⚠ THE FIELD THAT ENDS THE RETYPING. Without a time, a post could
        // only ever be an all-day chip, so a 7:00 pm meeting had to be typed
        // into the newsletter by hand and into Google by hand. Leaving it
        // blank is still a real answer — an all-day event — which is why
        // there is no default and no placeholder time.
        { kind: 'date', name: 'event_end_date', label: 'Through', value: item ? (item.event_end_date || '') : '',
          hint: 'Optional. For something that runs several days \u2014 a break, a camp, a week of testing. One entry rather than five.' },
        // \u26a0 FORCES A CHOICE RATHER THAN LETTING A BLANK TIME MEAN "ALL DAY"
        // BY DEFAULT. A blank time used to be read as a real answer, and it
        // still is once this is checked \u2014 but leaving it unchecked AND the
        // time blank is what silently produced a calendar full of all-day
        // chips for services and meetings that genuinely start at a clock
        // time nobody got around to typing in. Unchecked by default on a
        // brand-new post, so adding an event date and saving without either
        // a time or this box is refused rather than quietly defaulting.
        { kind: 'toggle', name: 'event_all_day', label: 'All day event',
          value: item ? (!!item.event_date && !item.event_time) : false,
          on: 'All day', off: 'Has a start time',
          hint: 'Only checked events skip the start time. Leave this off and fill in a start time below for anything that happens at a specific hour.' },
        { kind: 'text', type: 'time', name: 'event_time', label: 'Starts at', value: item ? (item.event_time || '') : '',
          hint: 'Required unless this is an all-day event (above). Church time, always.' },
        { kind: 'text', type: 'time', name: 'event_end_time', label: 'Ends at', value: item ? (item.event_end_time || '') : '',
          hint: 'Optional. The calendar page shows only the start; this is what a subscribed phone uses to draw how long it runs.' },
        { kind: 'text', name: 'event_location', label: 'Where', value: item ? (item.event_location || '') : '',
          placeholder: 'e.g. Fellowship Hall',
          hint: 'Optional. Shown on the event and carried into a subscribed calendar.' },
        { kind: 'date', name: 'expire_date', label: 'Expire date', value: item ? (item.expire_date || '') : in90,
          hint: 'The post hides itself after this date. Clear it only for something genuinely permanent.' },
        { kind: 'toggle', name: 'pinned', label: 'Pin to the top', value: item ? !!item.pinned : false,
          on: 'Pinned', off: 'In date order',
          hint: 'A pinned post sits above the rest until you unpin it.' },
      ],
    });
  };

  if (path === '/newsitems/new' && method === 'GET') {
    const newsMsg = url.searchParams.get('msg');
    const newsAlert = newsMsg === 'event-time-required'
      ? `<div class="alert alert-error">This has an event date, so it needs either a start time or "All day event" checked.</div>` : '';
    return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">All posts</a>`, badges)}
<div class="tlc-wrap">
${newsAlert ? `<div class="tlc-section" style="padding-bottom:0;">${newsAlert}</div>` : ''}
${newsFormHtml()}
</div>
${newsImageUploadScript()}
${newsEventTimeScript()}`, 'New post — TLC Admin', TINYMCE_HEAD);
  }

  // ── NEWS ITEMS: CREATE (POST) ──
  if (path === '/newsitems/create' && method === 'POST') {
    const form = await request.formData();
    const title = form.get('title') || '';
    const summary = form.get('summary') || '';
    const body = sanitizeClassicRich(form.get('body') || '');   // FX-04
    // blob: URLs are only valid in the browser tab that created them — dead
    // for every other visitor. Drop rather than store one if it slips through.
    const image_url = (form.get('image_url') || '').trim().startsWith('blob:') ? '' : (form.get('image_url') || '');
    const publish_date = form.get('publish_date') || churchDate();
    const event_date = form.get('event_date') || '';
    const event_end_date = form.get('event_end_date') || '';
    const event_time = normalizeClock(form.get('event_time'));
    const event_end_time = normalizeClock(form.get('event_end_time'));
    const event_location = String(form.get('event_location') || '').trim();
    const expire_date = form.get('expire_date') || '';
    // A toggle posts a hidden 0 ahead of its checkbox, so get() always sees
    // the 0. getAll() is the only reading that is true when it is really on.
    const pinned = form.getAll('pinned').includes('1') ? 1 : 0;
    const event_all_day = form.getAll('event_all_day').includes('1');
    // ⚠ THE SERVER-SIDE BACKSTOP FOR newsEventTimeScript()'s CLIENT CHECK.
    // A blank time used to be a real, silent answer — "all day" — and a
    // crafted POST or a browser with JS disabled must not still be able to
    // leave that ambiguous now that there is a real "All day event" box to
    // check. Only bites when there is actually an event date to place on
    // the calendar; a plain announcement needs neither field.
    if (event_date && !event_all_day && !event_time) {
      return new Response('', { status: 302, headers: { Location: '/newsitems/new?msg=event-time-required' } });
    }
    const theme = form.get('theme') || '';
    const content_type = form.get('content_type') || '';
    const channels = [
      form.get('ch_web') === '1' && 'web',
      form.get('ch_email') === '1' && 'email',
      // ⚠ A CHANNEL THE CALENDAR READS AND /news DOES NOT. A school break or
      // a testing week belongs on the month and is not something anybody
      // wants a paragraph about; without this the only way to keep it off
      // the news feed was to keep it off the calendar too.
      form.get('ch_calendar') === '1' && 'calendar',
      form.get('ch_bulletin') === '1' && 'bulletin',
      form.get('ch_social') === '1' && 'social',
    ].filter(Boolean).join(',') || 'web';
    const newItemResult = await env.DB.prepare(
      'INSERT INTO news_items (title, summary, body, image_url, publish_date, event_date, event_end_date, event_time, event_end_time, event_location, expire_date, pinned, theme, content_type, channels, value, calendar_category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(title, summary, body, image_url, publish_date, event_date || null, event_end_date || null, event_time, event_end_time, event_location || null, expire_date || null, pinned, theme || null, content_type || null, channels, normalizeValue(form.get('value')) || null, String(form.get('calendar_category') || '').trim() || null).run();
    await logAudit(env.DB, currentUser, 'create', 'news_item', newItemResult.meta.last_row_id, title, null, { title, summary, publish_date, expire_date, pinned });
    return new Response('', { status: 302, headers: { Location: '/newsitems?msg=saved' } });
  }

  // ── NEWS ITEMS: EDIT FORM ──
  // ── NEWS ITEMS: EDIT FORM ──
  if (path.startsWith('/newsitems/edit/') && method === 'GET') {
    const id = path.split('/').pop();
    const item = await env.DB.prepare('SELECT * FROM news_items WHERE id = ?').bind(id).first();
    if (!item) return new Response('Not found', { status: 404 });
    const newsMsg = url.searchParams.get('msg');
    const newsAlert = newsMsg === 'event-time-required'
      ? `<div class="alert alert-error">This has an event date, so it needs either a start time or "All day event" checked.</div>` : '';
    return html(`
${sidebarShell('news', currentUser, `<a href="/newsitems">All posts</a>`, badges)}
<div class="tlc-wrap">
${newsAlert ? `<div class="tlc-section" style="padding-bottom:0;">${newsAlert}</div>` : ''}
${newsFormHtml(item)}
</div>
${newsImageUploadScript(item.image_url || '')}
${newsEventTimeScript()}`, 'Edit post — TLC Admin', TINYMCE_HEAD);
  }

  // ── NEWS ITEMS: UPDATE (POST) ──
  if (path.startsWith('/newsitems/update/') && method === 'POST') {
    const id = path.split('/').pop();
    const form = await request.formData();
    const title = form.get('title') || '';
    const summary = form.get('summary') || '';
    const body = sanitizeClassicRich(form.get('body') || '');   // FX-04
    // blob: URLs are only valid in the browser tab that created them — dead
    // for every other visitor. Drop rather than store one if it slips through.
    const image_url = (form.get('image_url') || '').trim().startsWith('blob:') ? '' : (form.get('image_url') || '');
    const publish_date = form.get('publish_date') || '';
    const event_date = form.get('event_date') || '';
    const event_end_date = form.get('event_end_date') || '';
    const event_time = normalizeClock(form.get('event_time'));
    const event_end_time = normalizeClock(form.get('event_end_time'));
    const event_location = String(form.get('event_location') || '').trim();
    const expire_date = form.get('expire_date') || '';
    // A toggle posts a hidden 0 ahead of its checkbox, so get() always sees
    // the 0. getAll() is the only reading that is true when it is really on.
    const pinned = form.getAll('pinned').includes('1') ? 1 : 0;
    const event_all_day = form.getAll('event_all_day').includes('1');
    // ⚠ THE SERVER-SIDE BACKSTOP FOR newsEventTimeScript()'s CLIENT CHECK —
    // see the identical guard on /newsitems/create for why this exists.
    if (event_date && !event_all_day && !event_time) {
      return new Response('', { status: 302, headers: { Location: `/newsitems/edit/${id}?msg=event-time-required` } });
    }
    const theme = form.get('theme') || '';
    const content_type = form.get('content_type') || '';
    const channels = [
      form.get('ch_web') === '1' && 'web',
      form.get('ch_email') === '1' && 'email',
      // ⚠ A CHANNEL THE CALENDAR READS AND /news DOES NOT. A school break or
      // a testing week belongs on the month and is not something anybody
      // wants a paragraph about; without this the only way to keep it off
      // the news feed was to keep it off the calendar too.
      form.get('ch_calendar') === '1' && 'calendar',
      form.get('ch_bulletin') === '1' && 'bulletin',
      form.get('ch_social') === '1' && 'social',
    ].filter(Boolean).join(',') || 'web';
    const beforeItem = await env.DB.prepare('SELECT title, summary, body, image_url, publish_date, event_date, expire_date, pinned FROM news_items WHERE id = ?').bind(id).first();
    await env.DB.prepare(
      'UPDATE news_items SET title=?, summary=?, body=?, image_url=?, publish_date=?, event_date=?, event_end_date=?, event_time=?, event_end_time=?, event_location=?, expire_date=?, pinned=?, theme=?, content_type=?, channels=?, value=?, calendar_category=? WHERE id=?'
    ).bind(title, summary, body, image_url, publish_date, event_date || null, event_end_date || null, event_time, event_end_time, event_location || null, expire_date || null, pinned, theme || null, content_type || null, channels, normalizeValue(form.get('value')) || null, String(form.get('calendar_category') || '').trim() || null, id).run();
    await logAudit(env.DB, currentUser, 'update', 'news_item', id, title, beforeItem, { title, summary, publish_date, expire_date, pinned });
    return new Response('', { status: 302, headers: { Location: '/newsitems?msg=saved' } });
  }

  // ── NEWS ITEMS: DELETE ──
  if (path.startsWith('/newsitems/delete/') && method === 'POST') {
    const id = path.split('/').pop();
    const origin = new URL(request.url).origin;
    const item = await env.DB.prepare('SELECT title, body FROM news_items WHERE id = ?').bind(id).first();
    if (item) {
      for (const key of extractImageKeys(item.body || '', origin)) {
        try { await env.IMAGES.delete(key); } catch (_) {}
      }
    }
    await env.DB.prepare('DELETE FROM news_items WHERE id = ?').bind(id).run();
    await logAudit(env.DB, currentUser, 'delete', 'news_item', id, item ? item.title : id, item, null);
    return new Response('', { status: 302, headers: { Location: '/newsitems?msg=deleted' } });
  }
  return null;
}
