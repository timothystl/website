// Event Intake — the office's triage queue over everything with a date on it:
// Google Calendar bookings, News & Events posts, confirmed gym rentals, and
// anything typed in here directly. Built from `Event Intake.dc.html`
// (design_handoff_church_calendar's companion handoff), which the office
// asked for after "the calendar is ours now" landed and the real complaint
// turned out not to be "I need a fancier calendar" but "I forget what still
// needs a decision before Sunday."
//
// ⚠ THIS IS PURELY INTERNAL BOOKKEEPING. Nothing here changes what a visitor
// sees on timothystl.org/calendar — a Google event with every checklist item
// still open renders on the public calendar exactly as it always has. Gating
// public visibility on staff finishing a checklist would mean a genuinely
// forgotten checklist quietly deletes a service from the church calendar,
// which is a worse failure than the one this screen exists to prevent.
//
// ⚠ TYPE IS A SEPARATE QUESTION FROM CATEGORY, DELIBERATELY. `calendar_categories`
// (Worship / Learn / Ministry / Facility / Youth / WOL / MDO / Music / Meetings /
// Special / Other) is what colors an event on the public calendar, chosen from
// a Google event's own color. The four TYPES here (Worship / Education / Rental /
// News) are a coarser, office-only grouping that decides which checklist and
// which extra fields apply — "is this a room booking with a paper trail, or a
// class with a teacher" is a different question from "what color chip does it
// draw." Setting a type here never touches calendar_category.
//
// ⚠ THE MOCK'S "FUNERAL" CHECKLIST IS NOT REPRODUCED. The seed data gave one
// worship item (a funeral) a different four-item checklist from the other two
// worship items (a Divine Service and a rehearsal, which agree with each
// other) — but nothing in the mock's own logic ever regenerates a checklist
// when a "Service type" changes, so that variance was never reachable through
// any interaction, only visible in the one seed row that happened to start
// there. Building per-service-type checklists would be inventing a feature
// the design never actually wired up. One fixed checklist per TYPE, matching
// the majority (and only) agreeing pair for each.

// ── THE ELEVEN TYPES ─────────────────────────────────────────────────────────
// Started as the mock's four (Worship/Education/Rental/News); Andrew asked for
// seven more once he was actually working the queue — Meetings, Word of Life,
// MDO, Music, Youth & Family, Special event, Fellowship — because "Education"
// alone was covering a teacher-led class, a confirmation program, a WOL chapel
// visit and an MDO parent event, and one checklist could never fit all four.
//
// ⚠ COLORS ARE `CALENDAR_PALETTE` KEYS NOW, NOT HAND-PICKED HEXES. The
// original four were the mock's own literal hex values, and three of them —
// education #2E7EA6, rental #C9973A, news #7A8B5F — failed 4.5:1 white-text
// contrast on a filled pill (2.40:1 for rental) the moment they were checked,
// the identical WCAG gap the calendar's own palette had until 2026-08-20 (see
// admin/calendar.js). Rather than invent an eighth, ninth, tenth ad hoc color
// system for one more screen, every type here reuses the calendar's own
// contrast-verified swatch keys — the SAME ones `CAL_SEED_PALETTE` in
// tlc-admin-worker.js already assigns to the matching Google-color category
// (worship→navy, learn→teal, facility→stone, youth→amber, wol→slate,
// mdo→sand, music→plum, meetings→steel, special→gold). Type and category are
// still two separate ideas — picking a type here never writes
// calendar_category — but there is no reason for "Worship" to be one color on
// this screen and a different navy on the public calendar. `news` and
// `fellowship` have no calendar-category equivalent, so they take the two
// CALENDAR_PALETTE keys ('moss', 'brick') nothing else here uses; 'gray' is
// left alone, since on the calendar it means "uncategorized" and no type here
// is that.
export const TYPES = {
  worship: {
    key: 'worship', label: 'Worship', color: '#1E2D4A', palette: 'navy',
    note: 'Goes on the Worship calendar and into the bulletin build.',
  },
  education: {
    key: 'education', label: 'Education', color: '#276C8E', palette: 'teal',
    note: 'Adult Bible classes and studies — anything with a teacher and a room that is not Youth & Family, WOL or MDO.',
  },
  youth: {
    key: 'youth', label: 'Youth & Family', color: '#93571F', palette: 'amber',
    note: 'Sunday School, VBS, family events — anything the Youth Director runs.',
  },
  wol: {
    key: 'wol', label: 'Word of Life', color: '#3A4E5C', palette: 'slate',
    note: 'Word of Life School on our campus or calendar — chapel, programs, joint use.',
  },
  mdo: {
    key: 'mdo', label: 'MDO', color: '#776422', palette: 'sand',
    note: "Timothy's Mother's Day Out — chapel time, programs, and parent events.",
  },
  music: {
    key: 'music', label: 'Music', color: '#7A5A7A', palette: 'plum',
    note: 'Choir, handbells, cantors, special music — feeds the worship calendar.',
  },
  rental: {
    key: 'rental', label: 'Rental', color: '#68655F', palette: 'stone',
    note: 'Outside groups and building use. Nothing publishes until the paperwork is in.',
  },
  fellowship: {
    key: 'fellowship', label: 'Fellowship', color: '#8C3A28', palette: 'brick',
    note: 'Potlucks, socials, coffee hour extras — building community, not a class.',
  },
  meetings: {
    key: 'meetings', label: 'Meetings', color: '#576876', palette: 'steel',
    note: 'Council, elders, committees, staff meetings — nothing publicly facing.',
  },
  special: {
    key: 'special', label: 'Special event', color: '#646B1F', palette: 'gold',
    note: 'Christmas Market, VBS kickoff, one-off congregational events — the big ones.',
  },
  news: {
    key: 'news', label: 'News', color: '#4A5E3A', palette: 'moss',
    note: 'Needs a description, photo, or signup — the richer record wins on the public calendar.',
  },
};
export const TYPE_KEYS = Object.keys(TYPES);

// ── GROUPED BY THE FOUR CORE VALUES ─────────────────────────────────────────
// Andrew: "we can organize by the 4 core values." The four are
// admin/values.js's own stored keys (acceptance/worship/education/outreach —
// see PARTNER_SEED in admin/db.js, which already pairs Word of Life with
// 'education' and CFNA with 'outreach'), in the order this repo's own Core
// Values section already states them: Worship, Acceptance, Christian
// Education, Outreach.
//
// ⚠ THREE TYPES DO NOT MAP TO A VALUE, ON PURPOSE. News, Meetings and Special
// event are administrative/cross-cutting — a council meeting or "the
// Christmas Market kickoff" is not itself an act of worship, education,
// outreach or acceptance the way a Sunday service or a confirmation class is.
// Forcing a value onto them would be inventing an answer nobody asked for;
// they render in their own unlabeled group instead, same as the mock's flat
// list, so the four value groups only ever contain a type that genuinely
// belongs to one.
export const VALUE_LABELS = { worship: 'Worship', acceptance: 'Acceptance', education: 'Christian Education', outreach: 'Outreach' };
export const VALUE_ORDER = ['worship', 'acceptance', 'education', 'outreach'];
export const TYPE_VALUE = {
  worship: 'worship', music: 'worship',
  fellowship: 'acceptance',
  education: 'education', youth: 'education', wol: 'education', mdo: 'education',
  rental: 'outreach',
};
export function typesForValue(value) {
  return TYPE_KEYS.filter((k) => TYPE_VALUE[k] === value);
}
export function typesWithNoValue() {
  return TYPE_KEYS.filter((k) => !TYPE_VALUE[k]);
}

// A type an intake row has never been given. Not one of TYPES on purpose — an
// unclassified item is not a fifth kind of event, it is the absence of the one
// decision every row eventually needs, and it is what routes a fresh Google
// import into "Needs a decision" before anybody has looked at it at all.
export const UNCLASSIFIED = null;

// Which real record, if any, already owns this type's extra fields. `rental`
// defers to Gym Rentals only when the booking actually came through the gym
// system; a Google-booked outside group or a hand-typed wedding has no gym
// record to defer to and keeps its fields editable here. `news` defers to the
// News & Events post whenever the item is genuinely sourced from one. Worship
// and education have no existing owner anywhere in this codebase — nothing
// else records a presider, a bulletin deadline, or what a Sunday School class
// needs copied — so their fields are always editable here, never deferred.
export function deferredFieldsSource(type, sourceKind) {
  if (type === 'rental' && sourceKind === 'gym') return 'gym';
  if (type === 'news' && sourceKind === 'news') return 'news';
  return null;
}

// ── ROOMS ─────────────────────────────────────────────────────────────────
export const ROOMS = ['Sanctuary', 'Gym', 'Youth Room', '3rd Floor Classroom', 'Multipurpose Room', 'Kitchen', 'Parking Lot'];

// ── SOURCES ───────────────────────────────────────────────────────────────
// Four now, one more than the mock's three: `gym` joins `gcal`/`news`/`local`
// because the office asked for confirmed rentals to flow into the same queue
// rather than living only on the Gym Rentals screen. The mock's "Entered
// here" is `local` — a row with no backing record anywhere else, the only
// kind whose title/date/time/room are genuinely typed here rather than pulled
// from something real.
export const SOURCE_LABEL = { gcal: 'Google', news: 'News & Events', gym: 'Gym Rentals', local: 'Entered here' };
export const SOURCE_COLOR = { gcal: '#2E7EA6', news: '#C9973A', gym: '#8A6E2F', local: '#7A8B5F' };

// ── THE KEY SPACE ─────────────────────────────────────────────────────────
// ⚠ DELIBERATELY THE SAME PREFIXES admin/calendar.js ALREADY USES — `g:`, `n:`,
// `b:` — because fetchGoogleEvents()/readNewsEvents() already produce exactly
// this shape and there is no reason to invent a second id scheme for the same
// underlying records. `l:` is new, for a `local` row's own auto-increment id.
export function intakeKeyFor(sourceKind, sourceId) {
  const prefix = sourceKind === 'gcal' ? 'g' : sourceKind === 'news' ? 'n' : sourceKind === 'gym' ? 'b' : 'l';
  return `${prefix}:${sourceId}`;
}
export function sourceKindOfKey(key) {
  const p = String(key || '').slice(0, 1);
  return p === 'g' ? 'gcal' : p === 'n' ? 'news' : p === 'b' ? 'gym' : p === 'l' ? 'local' : null;
}

// ── CHECKLIST TEMPLATES ─────────────────────────────────────────────────────
// One fixed, ordered list per type. Each item carries its own stable KEY —
// not just a position — so a stored {key: true} survives a template reorder
// and a stale record from before an item was added or removed just reads that
// item as still open rather than throwing.
export const CHECKLISTS = {
  worship: [
    { key: 'readings', label: 'Readings confirmed against lectionary', who: 'Pastor' },
    { key: 'hymns', label: 'Hymns chosen', who: 'Music' },
    { key: 'bulletin', label: 'Bulletin text to office', who: 'Pastor' },
    { key: 'altarguild', label: 'Altar guild scheduled', who: 'Altar Guild' },
  ],
  education: [
    { key: 'teacher', label: 'Teacher confirmed', who: 'Education' },
    { key: 'room', label: 'Room reserved on Google', who: 'Office' },
    { key: 'materials', label: 'Materials copied', who: 'Office' },
    { key: 'listed', label: 'Listed on the website', who: 'Communications' },
  ],
  youth: [
    { key: 'leader', label: 'Leader confirmed', who: 'Youth Director' },
    { key: 'room', label: 'Room reserved on Google', who: 'Office' },
    { key: 'materials', label: 'Materials or registration ready', who: 'Youth Director' },
    { key: 'listed', label: 'Listed on the website', who: 'Communications' },
  ],
  wol: [
    { key: 'contact', label: 'Word of Life contact confirmed', who: 'Office' },
    { key: 'room', label: 'Room reserved on Google', who: 'Office' },
    { key: 'custodian', label: 'Custodian told about setup', who: 'Facilities' },
    { key: 'listed', label: 'Listed on the website, if public', who: 'Communications' },
  ],
  mdo: [
    { key: 'contact', label: 'MDO director confirmed', who: 'Office' },
    { key: 'room', label: 'Room reserved on Google', who: 'Office' },
    { key: 'materials', label: 'Materials ready', who: 'Office' },
    { key: 'parents', label: 'Parents notified', who: 'Communications' },
  ],
  music: [
    { key: 'leader', label: 'Director or leader confirmed', who: 'Music' },
    { key: 'selected', label: 'Music selected', who: 'Music' },
    { key: 'rehearsal', label: 'Rehearsal scheduled', who: 'Music' },
    { key: 'worship', label: 'Coordinated with the worship service', who: 'Pastor' },
  ],
  rental: [
    { key: 'agreement', label: 'Signed use agreement on file', who: 'Office' },
    { key: 'insurance', label: 'Certificate of insurance current', who: 'Office' },
    { key: 'custodian', label: 'Custodian told about setup', who: 'Facilities' },
    { key: 'fee', label: 'Fee or waiver recorded', who: 'Bookkeeper' },
  ],
  fellowship: [
    { key: 'organizer', label: 'Organizer confirmed', who: 'Office' },
    { key: 'setup', label: 'Setup or food arranged', who: 'Facilities' },
    { key: 'announced', label: 'Announced to the congregation', who: 'Communications' },
    { key: 'signup', label: 'Signup live, if it needs one', who: 'Communications' },
  ],
  meetings: [
    { key: 'agenda', label: 'Agenda sent', who: 'Office' },
    { key: 'room', label: 'Room and setup confirmed', who: 'Facilities' },
    { key: 'minutes', label: 'Minutes taken', who: 'Office' },
    { key: 'followup', label: 'Action items followed up', who: 'Pastor' },
  ],
  special: [
    { key: 'coordinator', label: 'Coordinator confirmed', who: 'Office' },
    { key: 'budget', label: 'Budget approved', who: 'Bookkeeper' },
    { key: 'promotion', label: 'Promotion planned', who: 'Communications' },
    { key: 'volunteers', label: 'Volunteers scheduled', who: 'Office' },
  ],
  news: [
    { key: 'description', label: 'Description written', who: 'Communications' },
    { key: 'photo', label: 'Photo attached', who: 'Communications' },
    { key: 'signup', label: 'Signup link live', who: 'Communications' },
    { key: 'announced', label: 'Announced in bulletin 2 weeks out', who: 'Office' },
  ],
};

// Which extra fields a type asks for, in order. `kind` is 'text' or 'area';
// `defer` marks a field that is read-only display once deferredFieldsSource()
// says a real record already owns it — see the note at the top of the file.
export const TYPE_FIELDS = {
  worship: [
    { key: 'service', label: 'Service type', kind: 'select',
      options: ['Divine Service', 'Funeral', 'Wedding', 'Rehearsal', 'Midweek', 'Baptism'], required: true },
    { key: 'presider', label: 'Presiding / preaching', kind: 'text', required: true },
    { key: 'music', label: 'Music', kind: 'text', hint: 'Organist, choir, cantor' },
    { key: 'bulletin', label: 'Bulletin text due', kind: 'text', hint: 'Wednesday noon', required: true },
  ],
  education: [
    { key: 'teacher', label: 'Teacher', kind: 'text', required: true },
    { key: 'series', label: 'Series or class', kind: 'text', hint: 'Colossians, week 1 of 6', required: true },
    { key: 'ages', label: 'Who it’s for', kind: 'text', hint: 'Adults · Ages 2–4 · Parents' },
    { key: 'materials', label: 'Materials to prepare', kind: 'area', hint: 'Handouts, copies, supplies' },
  ],
  youth: [
    { key: 'program', label: 'Program', kind: 'select',
      options: ['Sunday School', 'Confirmation', 'VBS', 'Family Event', 'Other'], required: true },
    { key: 'leader', label: 'Leader', kind: 'text', required: true },
    { key: 'ages', label: 'Who it’s for', kind: 'text', hint: 'Grade, or “whole family”' },
    { key: 'materials', label: 'Materials or registration', kind: 'area', hint: 'Handouts, sign-up link, supplies' },
  ],
  wol: [
    { key: 'contact', label: 'Word of Life contact', kind: 'text', required: true },
    { key: 'what', label: 'What it is', kind: 'select',
      options: ['Chapel', 'Program', 'Joint use', 'Other'], required: true },
    { key: 'space', label: 'Room or space needed', kind: 'text' },
    { key: 'notes', label: 'Notes for facilities', kind: 'area' },
  ],
  mdo: [
    { key: 'contact', label: 'MDO staff contact', kind: 'text', required: true },
    { key: 'what', label: 'What it is', kind: 'select',
      options: ['Chapel time', 'Program', 'Parent event', 'Other'], required: true },
    { key: 'space', label: 'Room', kind: 'text', hint: 'MDO Wing, usually' },
    { key: 'notes', label: 'Notes', kind: 'area' },
  ],
  music: [
    { key: 'group', label: 'Group', kind: 'select',
      options: ['Choir', 'Handbells', 'Cantors', 'Instrumentalists', 'Other'], required: true },
    { key: 'leader', label: 'Director or leader', kind: 'text', required: true },
    { key: 'occasion', label: 'Rehearsal or performance', kind: 'text' },
    { key: 'music', label: 'Music selected', kind: 'area' },
  ],
  rental: [
    { key: 'renter', label: 'Renter or group', kind: 'text', required: true },
    { key: 'contact', label: 'Contact', kind: 'text', hint: 'Phone or email', required: true },
    { key: 'fee', label: 'Fee and deposit', kind: 'text', hint: '$650 — deposit $200 received', required: true },
    { key: 'setup', label: 'Setup, teardown, access', kind: 'area', hint: 'Tables, chairs, doors, times' },
  ],
  fellowship: [
    { key: 'what', label: 'What it is', kind: 'text', hint: 'Potluck, coffee hour, game night', required: true },
    { key: 'host', label: 'Host or organizer', kind: 'text', required: true },
    { key: 'food', label: 'Food or setup needs', kind: 'area' },
    { key: 'signup', label: 'Signup needed?', kind: 'text', hint: 'timothystl.org/… or “no”' },
  ],
  meetings: [
    { key: 'body', label: 'Meeting', kind: 'select',
      options: ['Council', 'Elders', 'Staff', 'Committee', 'Other'], required: true },
    { key: 'chair', label: 'Called by / chair', kind: 'text', required: true },
    { key: 'agenda', label: 'Agenda items due', kind: 'text' },
    { key: 'minutes', label: 'Minutes owner', kind: 'text' },
  ],
  special: [
    { key: 'name', label: 'Event name', kind: 'text', required: true },
    { key: 'lead', label: 'Lead / coordinator', kind: 'text', required: true },
    { key: 'needs', label: 'What it needs', kind: 'area', hint: 'Staffing, budget, promotion' },
    { key: 'budget', label: 'Budget or fee', kind: 'text' },
  ],
  news: [
    { key: 'description', label: 'Description', kind: 'area', hint: 'Two or three sentences for the website', required: true },
    { key: 'photo', label: 'Photo', kind: 'text', hint: 'Filename or “needs one”' },
    { key: 'signup', label: 'Signup or link', kind: 'text', hint: 'timothystl.org/…' },
  ],
};

// ⚠ CHECKED AGAINST A LIST BEFORE IT IS USED. The field-save and checklist-
// toggle routes build a JSON blob from a posted key, so a key taken straight
// from the request would be whatever the request said it was — the same
// shape of hole the market vendor screen's own field allowlist exists to
// close. Neither of these ever reaches SQL as a column name (unlike the
// market's case); they just have no business landing in extra_json/checks_json
// as an arbitrary attacker-chosen key.
export function isValidTypeField(type, key) {
  return !!(TYPE_FIELDS[type] || []).find((f) => f.key === key);
}
export function isValidChecklistKey(type, key) {
  return !!(CHECKLISTS[type] || []).find((c) => c.key === key);
}

// ── CHECKLIST STATE ───────────────────────────────────────────────────────
// Stored sparse — {key: true} for a checked item, absent means unchecked —
// so a template addition reads every existing row as having that one new item
// still open, rather than needing a backfill.
export function checklistFor(type, checksState) {
  const tpl = CHECKLISTS[type];
  if (!tpl) return [];
  const st = checksState || {};
  return tpl.map((c) => ({ ...c, done: !!st[c.key] }));
}

export function openCountOf(type, checksState) {
  if (!type || !CHECKLISTS[type]) return null;
  return checklistFor(type, checksState).filter((c) => !c.done).length;
}

// Unclassified is never ready — picking a type is the first checklist item,
// even though it isn't drawn as one.
export function isReady(item) {
  if (!item.type) return false;
  return openCountOf(item.type, item.checks) === 0;
}

// ── MERGING RAW SOURCE ROWS WITH WHAT THE OFFICE HAS ALREADY DECIDED ────────
// `raw` is the union of what fetchGoogleEvents()/readNewsEvents() already
// produce (id, start, end, allDay, title, location, description, source) plus
// gym's own richer read and any `local` rows — see tlc-admin-worker.js for
// where each is assembled. `rows` is what is already in `event_intake`, keyed
// by the same id space. A raw item with no matching row is genuinely new —
// it is still shown, with type unset, rather than waiting on a sync to create
// a placeholder first.
export function mergeIntakeItems(raw, rows) {
  const byKey = new Map((rows || []).map((r) => [r.source_key || intakeKeyFor('local', r.id), r]));
  return (raw || []).map((ev) => {
    const row = byKey.get(ev.id);
    const type = row ? (row.event_type || null) : null;
    const checks = row && row.checks_json ? safeParse(row.checks_json, {}) : {};
    const extra = row && row.extra_json ? safeParse(row.extra_json, {}) : {};
    return {
      key: ev.id,
      sourceKind: ev.source === 'gcal' ? 'gcal' : ev.source === 'news' ? 'news' : ev.source === 'gym' ? 'gym' : 'local',
      title: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay,
      location: ev.location || '',
      type, room: (row && row.room) || '', extra, checks,
      publishedAt: (row && row.published_at) || null,
      dbId: row ? row.id : null,
    };
  });
}

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch (_) { return fallback; }
}

// ── QUEUES ───────────────────────────────────────────────────────────────
// ⚠ "imported" IS EVERY GOOGLE-SOURCED ITEM, READY OR NOT — matching the
// mock's own filter exactly. It is not "recently imported": it is the whole
// set of things the office did not type in, which is the queue somebody opens
// when they want to sweep the calendar rather than work a specific backlog.
export const QUEUE_TOP = ['inbox', 'imported', 'ready'];

export function inQueue(item, queue) {
  if (queue === 'inbox') return !isReady(item);
  if (queue === 'imported') return item.sourceKind === 'gcal';
  if (queue === 'ready') return isReady(item);
  return item.type === queue;
}

export function filterQueue(items, queue) {
  return items.filter((it) => inQueue(it, queue)).slice().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

export function queueCounts(items) {
  const counts = {};
  for (const q of QUEUE_TOP.concat(TYPE_KEYS)) counts[q] = items.filter((it) => inQueue(it, q)).length;
  return counts;
}

export const QUEUE_TITLES = {
  inbox: ['Needs a decision', 'Something is missing before this can publish'],
  imported: ['Imported from Google', 'Pulled from the office calendars — confirm what the feed can’t know'],
  ready: ['Ready to publish', 'Everything checked off'],
  worship: ['Worship', 'Services, funerals, weddings, rehearsals'],
  education: ['Education', 'Adult Bible classes and studies'],
  youth: ['Youth & Family', 'Sunday School, confirmation, VBS, family events'],
  wol: ['Word of Life', 'Word of Life School on our campus or calendar'],
  mdo: ['MDO', "Timothy's Mother's Day Out"],
  music: ['Music', 'Choir, handbells, cantors, special music'],
  rental: ['Rentals', 'Outside groups and building use'],
  fellowship: ['Fellowship', 'Potlucks, socials, coffee hour extras'],
  meetings: ['Meetings', 'Council, elders, committees, staff'],
  special: ['Special events', 'Christmas Market, VBS kickoff, one-off events'],
  news: ['News & Events', 'Public-facing entries with copy and photos'],
};
