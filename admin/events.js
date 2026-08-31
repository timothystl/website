// ── EVENTS: THE MARKET, GENERALIZED ──────────────────────────────────────────
//
// The Christmas Market was the first event this admin ran end to end:
// registration, payment, a coordinator's list, volunteers read from Serve,
// its own pages. This file is that shape made general — `site_events`,
// `site_event_fields`, `site_event_registrations` — so a second event (VBS,
// the Egg Hunt, a concert) is a row an office person creates, not a deploy a
// developer ships.
//
// ⚠ THIS FILE HAS NO IMPORT FROM admin/market.js, AND MUST NOT GAIN ONE.
// admin/market.js imports FROM here (the same one-directional shape
// market-price.js already established for the identical reason — see the
// note at the top of that file). A leaf-to-market import is safe; a
// market-to-leaf-to-market cycle is exactly what this repo has already been
// bitten by once.
//
// ⚠ THE TABLE IS `site_events`, NOT `events`. `events` already exists (see
// admin/db.js) and means something unrelated — one row per date/time printed
// inside a single newsletter issue. Reusing that name would silently union
// two unrelated tables the moment a query ran against the wrong one.
//
// ── THE MARKET STAYS THE MARKET ──────────────────────────────────────────────
// The Christmas Market's own three-step vendor application (admin/market.js,
// the `marketapp` block) is NOT rebuilt on top of `site_event_fields` — its
// nine fixed fields are exactly the shape they have always been, tested end
// to end, and generalizing that specific form was never asked for. What
// generalizes is the STORAGE (one `site_events` row instead of eleven
// `site_settings` keys, `site_event_registrations` instead of
// `market_vendors`) and the SCREENS that read any event's records —
// Registrations/Volunteers/Photos tabs a coordinator opens the same way
// whichever event they run. A brand-new event's public registration form,
// by contrast, IS `site_event_fields`-driven — see the `registration` block
// in admin/blocks.js.

import { MARKET_DEFAULTS, clampTables, priceBreakdown, money } from '../market-price.js';
import { hasPermission, logAudit } from './auth.js';
import { html, sidebarShell, escapeHtml, formatDate } from './helpers.js';
import { renderListSection, renderDrawer, renderFormSection, renderField, primaryCell,
         statusPill, rowActions, panel, panelList } from './ui.js';
import { section as sectionCfg, columnsOf, filtersOf } from './sections.js';
import { churchDate } from './when.js';
import { slugify as pageSlugify, uniqueSlug } from './pages.js';
import { newBlock, sanitizeBlocks, starterBlocks } from './blocks.js';

// ── PAYMENT STATES ───────────────────────────────────────────────────────────
// The four states the Christmas Market coordinator kept by hand in the 2024
// spreadsheet's payment column, unchanged and now shared by every event that
// takes money. `waived` is a real state, not a courtesy — a comped
// registration (staff kids, a scholarship) is a decision somebody made, not
// money that arrived, and coloring it the same green as Paid would make a
// reconciliation read balanced when it is not.
export const PAYMENT_STATES = [
  { value: 'unpaid', label: 'Not paid yet', tone: 'warn' },
  { value: 'paid', label: 'Paid', tone: 'good' },
  { value: 'waived', label: 'Fee waived', tone: 'auto' },
  { value: 'dropped', label: 'Dropped out', tone: 'plain' },
];
export const paymentState = (v) => PAYMENT_STATES.find((s) => s.value === v) || PAYMENT_STATES[0];

const num = (v, fallback) => {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};
const trim = (v) => String(v == null ? '' : v).trim();
const cap = (v, n) => trim(v).slice(0, n);

// ── THE EVENT RECORD ──────────────────────────────────────────────────────────

export function getEvent(env, id) {
  return env.DB.prepare('SELECT * FROM site_events WHERE id = ?').bind(id).first().catch(() => null);
}

// `includeArchived` off by default — an archived event is closed for good,
// not merely hidden, and the list/sidebar should not have to filter it out
// themselves every time.
export async function listEvents(env, { includeArchived = false } = {}) {
  const sql = includeArchived
    ? 'SELECT * FROM site_events ORDER BY sort_order, id'
    : "SELECT * FROM site_events WHERE status != 'archived' ORDER BY sort_order, id";
  return (await env.DB.prepare(sql).all().catch(() => ({ results: [] }))).results || [];
}

// A slug an office person can read out loud, derived from the event's name —
// the same convention `slugify()` gives a page address. Collisions are
// resolved by the caller (append -2, -3, …) rather than here, because only
// the caller knows what already exists.
export function slugifyEventId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'event';
}

// The dynamic per-event coordinator permission — 'event_<id>_manage' — that
// gates a NEW event's Registrations/Volunteers/Photos tabs, generalizing the
// market's own `market_manage`. It is a plain string `hasPermission()` can
// check with no change to that function at all: permissions here have never
// been anything but membership in a JSON array on the user row, so a key
// nobody typed into admin/auth.js's static PERMISSIONS map works exactly the
// same as one that is.
//
// ⚠ THE MIGRATED CHRISTMAS MARKET KEEPS 'market_manage', VERBATIM. This
// function is never called for it — ground rule 3 is "permissions stay
// exactly as they are". Only an event created from here on gets a generated
// key.
export function eventCoordinatorPermissionKey(id) {
  return `event_${slugifyEventId(id)}_manage`;
}

// A label for that dynamic key, for the Users screen's checkbox list — see
// eventCoordinatorPermissions() below, and permissionCheckboxes() in
// admin/helpers.js which renders it.
export function eventCoordinatorPermissionLabel(ev) {
  return `${ev.name || ev.id} registrations`;
}

// Every event's OWN coordinator permission, as a {key: label} map — for the
// Users screen, so granting a VBS coordinator access to VBS's roster is a
// checkbox like any other permission, and does NOT also open the Christmas
// Market's or the Egg Hunt's. The migrated market is excluded: its
// permission is the static 'market_manage' already in admin/auth.js's
// PERMISSIONS map, and listing it twice would be two checkboxes for one key.
export async function eventCoordinatorPermissions(env) {
  const rows = await listEvents(env, { includeArchived: true });
  const out = {};
  for (const ev of rows) {
    if (ev.legacy_kind === 'market') continue;
    const key = ev.coordinator_permission || eventCoordinatorPermissionKey(ev.id);
    out[key] = eventCoordinatorPermissionLabel(ev);
  }
  return out;
}

// ── MONEY ─────────────────────────────────────────────────────────────────────
// Shapes an event row into exactly the object market-price.js's
// priceBreakdown() and admin/blocks.js's `marketapp`/`marketfacts` branches
// already expect from admin/market.js's old marketConfigFromRows() — same
// field names, so neither of those had to change to read from here instead.
// `giveUrl` is not a column on the event; it is threaded in by the caller
// from the shared `give_url` site setting, the same way it always was.
//
// ⚠ FALLS BACK TO market-price.js's OWN DEFAULTS, never to zero or blank,
// for the same reason priceBreakdown() itself does: an event with has_payment
// on but a genuinely empty row must still quote a real card-processor fee
// rather than the literal word "undefined" reaching a public page.
export function eventFeeConfig(ev, giveUrl = '') {
  if (!ev) ev = {};
  return {
    tableFee: num(ev.fee_amount, MARKET_DEFAULTS.tableFee),
    feePercent: num(ev.fee_percent, MARKET_DEFAULTS.feePercent),
    feeFixed: num(ev.fee_fixed, MARKET_DEFAULTS.feeFixed),
    maxTables: Math.max(1, Math.floor(num(ev.max_qty, MARKET_DEFAULTS.maxTables))),
    fundId: ev.fund_id || '',
    coordinatorEmail: ev.coordinator_email || '',
    dateLabel: ev.date_label || '',
    hoursLabel: ev.hours_label || '',
    open: !!Number(ev.registration_open ?? 1),
    // ⚠ Blank/NULL means uncapped — read as '' rather than 0, so a form field
    // built from this renders empty rather than a misleading literal 0.
    registrationCap: ev.registration_cap == null ? '' : Number(ev.registration_cap),
    waitlistEnabled: !!Number(ev.waitlist_enabled),
    waitlistCap: ev.waitlist_cap == null ? '' : Number(ev.waitlist_cap),
    volunteersEnabled: !!Number(ev.has_volunteers),
    giveUrl: giveUrl || '',
    paymentProvider: ev.payment_provider === 'square' ? 'square' : 'tithely',
    squareLinks: safeJsonObject(ev.square_links),
  };
}

export function safeJsonObject(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}

export { priceBreakdown, money };

// ── REGISTRATIONS ─────────────────────────────────────────────────────────────

export async function listRegistrations(env, eventId) {
  return (await env.DB.prepare(
    `SELECT * FROM site_event_registrations WHERE event_id = ?
     ORDER BY CASE payment_status WHEN 'unpaid' THEN 0 ELSE 1 END, created_at DESC, id DESC`
  ).bind(eventId).all().catch(() => ({ results: [] }))).results || [];
}

export function getRegistration(env, id) {
  return env.DB.prepare('SELECT * FROM site_event_registrations WHERE id = ?').bind(id).first().catch(() => null);
}

export function countUnpaid(env, eventId) {
  return env.DB.prepare(
    "SELECT COUNT(*) AS n FROM site_event_registrations WHERE event_id = ? AND payment_status = 'unpaid'"
  ).bind(eventId).first().then((r) => (r && r.n) || 0).catch(() => 0);
}

// Reads back a registration's `fields_json` (and, when asked, its
// `sensitive_json`) as plain objects. `includeSensitive` defaults OFF — a
// caller has to say it wants the sensitive half, so a screen written without
// that in mind cannot accidentally show it.
export function registrationFields(reg, { includeSensitive = false } = {}) {
  const fields = safeJsonObject(reg && reg.fields_json);
  if (!includeSensitive) return fields;
  return { ...fields, ...safeJsonObject(reg && reg.sensitive_json) };
}

export async function insertRegistration(env, data) {
  const ins = await env.DB.prepare(
    `INSERT INTO site_event_registrations
       (event_id, qty, payment_status, amount_due_cents, amount_paid_cents, waitlisted,
        contact_name, contact_email, contact_phone, table_number, fields_json, sensitive_json, staff_notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    data.event_id, data.qty || 1, data.payment_status || 'unpaid', data.amount_due_cents || 0,
    data.amount_paid_cents == null ? null : data.amount_paid_cents, data.waitlisted ? 1 : 0,
    data.contact_name || null, data.contact_email || null, data.contact_phone || null,
    data.table_number || null, JSON.stringify(data.fields || {}),
    data.sensitive && Object.keys(data.sensitive).length ? JSON.stringify(data.sensitive) : null,
    data.staff_notes || null
  ).run();
  return ins?.meta?.last_row_id ?? null;
}

export async function updateRegistration(env, id, patch) {
  const sets = [];
  const args = [];
  for (const [col, val] of Object.entries(patch)) { sets.push(`${col} = ?`); args.push(val); }
  if (!sets.length) return;
  args.push(id);
  await env.DB.prepare(`UPDATE site_event_registrations SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
}

export async function deleteRegistration(env, id) {
  await env.DB.prepare('DELETE FROM site_event_registrations WHERE id = ?').bind(id).run();
}

// ── FIELDS (the generic, per-event registration form) ────────────────────────

export async function eventFields(env, eventId) {
  return (await env.DB.prepare(
    'SELECT * FROM site_event_fields WHERE event_id = ? ORDER BY sort_order, id'
  ).bind(eventId).all().catch(() => ({ results: [] }))).results || [];
}

export const FIELD_KINDS = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email address' },
  { value: 'tel', label: 'Phone number' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Choice list' },
  { value: 'checkbox', label: 'Yes / no' },
];
export const fieldKindLabel = (k) => (FIELD_KINDS.find((f) => f.value === k) || FIELD_KINDS[0]).label;

// A machine-safe key from whatever a coordinator typed as the field's label
// — lowercase, underscored, so it survives being a JSON object key and a CSV
// header without escaping. Collisions are numbered rather than silently
// merged, since two fields quietly sharing one key would overwrite each
// other's answers on every submission.
export function slugifyFieldKey(label, existing = []) {
  let base = String(label || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'field';
  let key = base;
  let n = 2;
  while (existing.includes(key)) { key = `${base}_${n}`; n += 1; }
  return key;
}

// ── CSV, GENERIC ───────────────────────────────────────────────────────────────
// A cell that starts = + - @ is a formula to a spreadsheet, and this file is
// opened in one by definition — same guard admin/market.js's own export and
// the payroll export (PY-5) both carry.
export function csvCell(v) {
  const s = String(v == null ? '' : v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function csvRow(cells) { return cells.map(csvCell).join(','); }

// Builds the generic Registrations CSV for an event whose form is
// `site_event_fields`-driven — every field, in the order the coordinator
// arranged them, PLUS the fixed columns every event shares. A sensitive
// field is included: this export is behind the same coordinator permission
// that gates the tab it is downloaded from, so it is the coordinator's own
// notification-equivalent view, not a wider audience.
export function registrationsCsv(event, fields, rows) {
  const head = ['Registered', 'Payment', 'Contact', 'Email', 'Phone', 'Qty', 'Amount asked', 'Amount paid',
    'Table / spot', 'Waitlisted', ...fields.map((f) => f.label), 'Staff notes'];
  const body = rows.map((r) => {
    const vals = registrationFields(r, { includeSensitive: true });
    return csvRow([
      String(r.created_at || '').slice(0, 19), paymentState(r.payment_status).label,
      r.contact_name || '', r.contact_email || '', r.contact_phone || '', r.qty || 1,
      ((r.amount_due_cents || 0) / 100).toFixed(2),
      r.amount_paid_cents == null ? '' : (r.amount_paid_cents / 100).toFixed(2),
      r.table_number || '', r.waitlisted ? 'Yes' : '',
      ...fields.map((f) => vals[f.key] == null ? '' : vals[f.key]),
      r.staff_notes || '',
    ]);
  }).join('\r\n');
  return [csvRow(head), body].filter(Boolean).join('\r\n');
}

// ── READING A PUBLIC REGISTRATION ────────────────────────────────────────────
// Pure, so the rules can be tested with no database — the same shape
// admin/market.js's sanitizeApplication() is, and for the same reason: the
// errors it returns are plain sentences a visitor can act on, never a field
// name.
//
// ⚠ THERE IS NO FIXED "NAME / EMAIL / PHONE" SECTION, unlike the market's own
// form — a generic event's fields ARE its whole form, coordinator-defined.
// Confirmation and the coordinator's own notification still need SOME
// address to reach somebody at, so it is inferred from field KIND: the
// first `email`-kind field is the contact email, the first `text`-kind
// field is the contact name, the first `tel`-kind field is the phone. A
// coordinator who wants a reliable confirmation email should give their
// form exactly one field of kind Email — which is also, not coincidentally,
// what every real form does anyway.
export function sanitizeRegistration(form, fields, cfg = {}) {
  const values = {};
  for (const f of fields) {
    const raw = form[`field_${f.key}`];
    values[f.key] = f.kind === 'checkbox' ? (String(raw || '') === '1' ? 1 : 0)
      : cap(raw, f.kind === 'textarea' ? 4000 : 400);
  }
  const errors = [];
  for (const f of fields) {
    const empty = f.kind === 'checkbox' ? !values[f.key] : !trim(values[f.key]);
    if (f.required && empty) errors.push(`Please fill in “${f.label}.”`);
  }
  const emailField = fields.find((f) => f.kind === 'email');
  const email = emailField ? trim(values[emailField.key]).toLowerCase() : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('That email address does not look right — please check it.');
  }
  const nameField = fields.find((f) => f.kind === 'text');
  const phoneField = fields.find((f) => f.kind === 'tel');
  const qty = clampTables(form.qty, cfg.maxTables || 9);

  return {
    ok: errors.length === 0,
    errors,
    value: {
      fields: values,
      contact_name: nameField ? trim(values[nameField.key]) : '',
      contact_email: email,
      contact_phone: phoneField ? trim(values[phoneField.key]) : '',
      qty,
    },
  };
}

// Every text-shaped field's value, joined for the spam screener — the same
// idea as admin/market.js's screenableText(), generalized: whichever fields
// a coordinator actually built the form with, not a fixed list.
export function registrationScreenableText(value, fields) {
  return fields
    .filter((f) => f.kind === 'text' || f.kind === 'textarea')
    .map((f) => value.fields[f.key])
    .filter(Boolean).join('\n\n');
}

// Splits a submitted registration's field values into the non-sensitive and
// sensitive halves, per that event's own `site_event_fields.sensitive`
// flags — the one place that split is decided, so a CSV export or a search
// index built later can trust `fields_json` alone and never even touch
// `sensitive_json`.
export function splitRegistrationFields(value, fields) {
  const nonSensitive = {};
  const sensitive = {};
  for (const f of fields) {
    const v = value.fields[f.key];
    if (v === '' || v == null) continue;
    (f.sensitive ? sensitive : nonSensitive)[f.key] = v;
  }
  return { nonSensitive, sensitive };
}

// Whether adding `qty` more registrants would exceed the event's cap, and if
// so whether the waitlist absorbs them. `currentQty` is the sum of `qty`
// across every registration that is not dropped and not already
// waitlisted — the same "counts against capacity" set a coordinator would
// expect. A cap of null/0 means uncapped.
//
// ⚠ `currentTotalQty` is a SECOND sum — everything `currentQty` counts, PLUS
// whatever is already sitting on the waitlist — and it is what
// `ev.waitlist_cap` is checked against, never `currentQty` alone. The
// Christmas Market's own shape is the reason this exists: 60 confirmed
// tables (`registration_cap`) plus a soft-reserve waitlist of up to 10 more
// (`waitlist_cap` = 70) before the market is genuinely full and starts
// refusing outright. Defaults to `currentQty` for every existing caller that
// never passes it, which reproduces the exact behavior this function has
// always had — an unbounded waitlist — for every event whose `waitlist_cap`
// is NULL.
export function capacityDecision(ev, currentQty, addingQty, currentTotalQty = currentQty) {
  const cap_ = Number(ev.registration_cap);
  if (!Number.isFinite(cap_) || cap_ <= 0) return { waitlisted: false, refused: false };
  if (currentQty + addingQty <= cap_) return { waitlisted: false, refused: false };
  if (!Number(ev.waitlist_enabled)) return { waitlisted: false, refused: true };
  const hardCap = Number(ev.waitlist_cap);
  if (Number.isFinite(hardCap) && hardCap > 0 && currentTotalQty + addingQty > hardCap) {
    return { waitlisted: false, refused: true };
  }
  return { waitlisted: true, refused: false };
}

// ── THE GENERIC EVENTS ADMIN (/events, /events/new, /events/:id) ────────────
// Returns null for anything it does not own, the same contract
// handleMarketRoutes and handleFilteredRoutes already use, so it can sit in
// the same route chain.

// Reserved so a slugified event name can never collide with a real route —
// /events/new especially, which would otherwise swallow an event literally
// named "New".
const RESERVED_EVENT_IDS = new Set(['new']);

async function generateEventId(env, name) {
  const base = slugifyEventId(name);
  const existing = await env.DB.prepare('SELECT id FROM site_events').all().catch(() => ({ results: [] }));
  const taken = new Set([...(existing.results || []).map((r) => r.id), ...RESERVED_EVENT_IDS]);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const next = `${base}-${i}`;
    if (!taken.has(next)) return next;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const STATUS_PILL = { live: ['good', 'Live'], draft: ['warn', 'Draft'], archived: ['plain', 'Archived'] };

// ── PHASE B — the /events list ───────────────────────────────────────────────
async function renderEventsList(env, currentUser, badges) {
  const [events, regRows, pages] = await Promise.all([
    listEvents(env, { includeArchived: true }),
    env.DB.prepare(
      "SELECT event_id, COUNT(*) AS n, SUM(CASE WHEN payment_status='unpaid' THEN 1 ELSE 0 END) AS unpaid FROM site_event_registrations GROUP BY event_id"
    ).all().catch(() => ({ results: [] })),
    env.DB.prepare('SELECT id, slug, status, published_blocks FROM pages').all().catch(() => ({ results: [] })),
  ]);
  const countsById = Object.fromEntries((regRows.results || []).map((r) => [r.event_id, r]));
  const pagesById = Object.fromEntries((pages.results || []).map((p) => [p.id, p]));

  const rows = events.map((ev) => {
    const [tone, label] = STATUS_PILL[ev.status] || STATUS_PILL.draft;
    const counts = countsById[ev.id];
    const pageIds = [ev.page_landing_id, ev.page_registration_id].filter(Boolean);
    const pageLinks = pageIds.map((id) => pagesById[id]).filter(Boolean)
      .map((p) => `<a href="/pages/${escapeHtml(p.id)}/edit">${escapeHtml(p.slug || p.id)}</a>${p.published_blocks ? '' : ' <span class="tlc-hint">(unpublished)</span>'}`);
    return {
      href: `/events/${ev.id}`,
      filter: ev.status,
      search: `${ev.name || ''} ${ev.id}`.toLowerCase(),
      cells: [
        primaryCell(ev.name || ev.id, ev.id),
        [ev.date_label, ev.hours_label].filter(Boolean).join(' · ') || '<span class="tlc-hint">Not set</span>',
        pageLinks.length ? pageLinks.join(', ') : '<span class="tlc-hint">No page yet</span>',
        Number(ev.has_registration)
          ? `${(counts && counts.n) || 0} signed up${counts && counts.unpaid ? ` · ${counts.unpaid} unpaid` : ''}`
          : '<span class="tlc-hint">No registrations</span>',
        statusPill(tone, label),
      ],
    };
  });

  return html(`
${sidebarShell('events', currentUser, '', badges)}
<div class="tlc-wrap">
  ${renderListSection({
    key: 'events',
    title: sectionCfg('events').title,
    purpose: sectionCfg('events').purpose,
    action: { label: sectionCfg('events').action, href: '/events/new' },
    search: sectionCfg('events').search,
    filters: filtersOf('events'),
    columns: columnsOf('events'),
    rows,
    noun: 'event',
    empty: 'No events yet.',
    note: sectionCfg('events').note,
  })}
</div>`, 'Events');
}

// Pages this admin could reasonably connect an event to: real content pages
// (not the ones locked into the site's own chrome, not an outbound redirect
// like /mdo, which has no blocks at all) that no OTHER active event has
// already claimed. VBS, Sunday School, Confirmation and the rest of the
// Youth & Family group are already real `pages` rows — a plain page nobody
// has turned into an event yet — so this is what lets a new or existing
// event ADOPT one of those instead of `createEvent()` minting a second page
// at a second address for the same thing.
async function candidateExistingPages(env) {
  const claimed = await env.DB.prepare(
    "SELECT page_landing_id AS id FROM site_events WHERE page_landing_id IS NOT NULL AND status != 'archived' " +
    "UNION SELECT page_registration_id AS id FROM site_events WHERE page_registration_id IS NOT NULL AND status != 'archived'"
  ).all().catch(() => ({ results: [] }));
  const claimedIds = new Set((claimed.results || []).map((r) => r.id));
  const pages = await env.DB.prepare(
    "SELECT id, title, slug FROM pages WHERE locked = 0 AND external_url IS NULL ORDER BY title"
  ).all().catch(() => ({ results: [] }));
  return (pages.results || []).filter((p) => !claimedIds.has(p.id));
}

// ── PHASE C — creating one ────────────────────────────────────────────────────
async function renderNewEventForm(env, currentUser, badges) {
  // "Start the page from" — every OTHER event that already has a
  // registration page, so a new one can begin as a working copy rather than
  // a blank canvas. Blank is still the default: cloning is an offer, not an
  // assumption about what the new event needs.
  const sources = await env.DB.prepare(
    "SELECT id, name, page_registration_id FROM site_events WHERE page_registration_id IS NOT NULL AND status != 'archived' ORDER BY sort_order, id"
  ).all().catch(() => ({ results: [] }));
  const existingPages = await candidateExistingPages(env);

  return html(`
${sidebarShell('events', currentUser, '', badges)}
<div class="tlc-wrap">
  ${renderFormSection({
    title: 'New event',
    purpose: 'Six questions. Everything past this — the registration form’s own fields, the price, whether it takes payment — is set on the event’s own screen afterward.',
    action: '/events/new',
    cancelHref: '/events',
    saveLabel: 'Create event',
    fields: [
      { name: 'name', label: 'What is it called?', required: true, placeholder: 'Vacation Bible School' },
      { name: 'date_label', label: 'When (in words)', placeholder: 'June 9–13, 2027', hint: 'Printed exactly as written — this is not parsed into a real date.' },
      { name: 'hours_label', label: 'Hours (in words)', placeholder: '9am–noon' },
      { name: 'coordinator_email', label: 'Coordinator email', type: 'email', hint: 'Where a sign-up is sent, and the address shown if something goes wrong.' },
      { kind: 'toggle', name: 'has_registration', label: 'Takes sign-ups', value: 1, on: 'Yes', off: 'No', hint: 'A public form, with fields the coordinator decides on the next screen.' },
      { kind: 'toggle', name: 'has_payment', label: 'Takes a payment', value: 0, on: 'Yes', off: 'No', hint: 'A card fee gets added on top, the same way the Christmas Market’s does.' },
      { kind: 'toggle', name: 'has_volunteers', label: 'Has a volunteer roster', value: 0, on: 'Yes', off: 'No', hint: 'Read from Serve (serve.timothystl.org) — see the Volunteers tab once the event exists.' },
      { kind: 'toggle', name: 'has_photos', label: 'Has its own photographs', value: 0, on: 'Yes', off: 'No' },
      {
        kind: 'choice', name: 'existing_page_id', label: 'Its page', value: '',
        options: [{ value: '', label: 'Create a new page' }, ...existingPages.map((p) => ({ value: p.id, label: `Use the existing page — ${p.title || p.id} (${p.slug || p.id})` }))],
        hint: 'VBS, Sunday School, and the rest of Youth & Family already have a page. Pick it here instead of creating a second one at a second address — a sign-up form is added to it, not built beside it.',
      },
      {
        kind: 'chips', name: 'clone_from', label: 'Or start a new page from', value: '',
        options: [{ value: '', label: 'A blank page' }, ...(sources.results || []).map((s) => ({ value: s.page_registration_id, label: `A copy of ${s.name || s.id}’s page` }))],
        hint: 'Only used when "Its page" above is left as Create a new page. A copy carries over everything on that page — its own words included — as a starting point to edit down, not a finished page.',
      },
    ],
  })}
</div>`, 'New event');
}

async function createEvent(env, currentUser, form) {
  const name = cap(form.get('name'), 200) || 'New event';
  const id = await generateEventId(env, name);
  const key = eventCoordinatorPermissionKey(id);
  // ⚠ getAll(...).includes('1'), not get() === '1' — a toggle field posts a
  // hidden 0 BEFORE its checkbox (renderField's 'toggle' kind, admin/ui.js),
  // so a real browser submission's form.get(name) returns that hidden '0'
  // first regardless of whether the box is checked. get() === '1' here would
  // read every toggle as permanently off. Same rule this repo's toggle
  // fields have always needed elsewhere; caught by giving the test its own
  // hidden-then-checkbox pair instead of a single bare value.
  const hasRegistration = form.getAll('has_registration').includes('1') ? 1 : 0;
  const hasPayment = form.getAll('has_payment').includes('1') ? 1 : 0;
  const hasVolunteers = form.getAll('has_volunteers').includes('1') ? 1 : 0;
  const hasPhotos = form.getAll('has_photos').includes('1') ? 1 : 0;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO site_events
       (id, name, status, date_label, hours_label, coordinator_email, coordinator_permission,
        has_registration, has_payment, has_volunteers, has_photos,
        fee_amount, fee_percent, fee_fixed, max_qty, payment_provider,
        registration_open, waitlist_enabled, volunteer_slug, photo_folder,
        sort_order, created_at, updated_at, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, name, 'draft', cap(form.get('date_label'), 200), cap(form.get('hours_label'), 200),
    cap(form.get('coordinator_email'), 200), key,
    hasRegistration, hasPayment, hasVolunteers, hasPhotos,
    MARKET_DEFAULTS.tableFee, MARKET_DEFAULTS.feePercent, MARKET_DEFAULTS.feeFixed, MARKET_DEFAULTS.maxTables,
    'tithely', 1, 0, hasVolunteers ? id : null, hasPhotos ? `images/events/${id}/` : null,
    999, now, now, currentUser?.username || ''
  ).run();

  // A page is only created for an event that has something to put on one —
  // the same reasoning a payments-only or volunteers-only event does not get
  // an unused page it would just have to delete.
  //
  // ⚠ "Its page" (existing_page_id) is checked FIRST and, when set, skips
  // page creation entirely — VBS already has a page (`/vbs`, from the
  // youth-page seed); creating a fresh one here would leave two live
  // addresses for one event, the market's own address duplicated by a
  // second party nobody asked for. Adopting the real page instead means a
  // registration block is ADDED to it, never a new page minted beside it.
  let pageId = null;
  const existingPageId = cap(form.get('existing_page_id'), 60);
  if (existingPageId) {
    const existing = await env.DB.prepare('SELECT id, blocks FROM pages WHERE id = ?').bind(existingPageId).first().catch(() => null);
    if (existing) {
      pageId = existing.id;
      if (hasRegistration) await addRegistrationBlockToPage(env, pageId, id, existing.blocks, now, currentUser);
    }
  }
  if (!pageId && (hasRegistration || hasPayment)) {
    const cloneFromPageId = cap(form.get('clone_from'), 60);
    let blocks;
    if (cloneFromPageId) {
      const src = await env.DB.prepare('SELECT blocks FROM pages WHERE id = ?').bind(cloneFromPageId).first().catch(() => null);
      let parsed = [];
      try { parsed = JSON.parse((src && src.blocks) || '[]'); } catch (_) { parsed = []; }
      // The one thing a clone must NOT carry over verbatim: a registration
      // block still pointing at the SOURCE event. Every other field — the
      // words, the photos, the layout — is exactly what "start from" means.
      blocks = sanitizeBlocks((Array.isArray(parsed) ? parsed : []).map((b) =>
        (b && b.type === 'registration') ? { ...b, eventId: id } : b));
    } else {
      blocks = sanitizeBlocks(starterBlocks(name, 'ministry'));
      if (hasRegistration) blocks.push(newBlock('registration', { eventId: id }));
    }
    pageId = 'page-' + Math.random().toString(36).slice(2, 8);
    for (let i = 0; i < 5; i++) {
      const clash = await env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(pageId).first();
      if (!clash) break;
      pageId = 'page-' + Math.random().toString(36).slice(2, 8);
    }
    const taken = await env.DB.prepare('SELECT slug FROM pages').all().catch(() => ({ results: [] }));
    const slug = uniqueSlug(pageSlugify(name), new Set((taken.results || []).map((p) => p.slug)));
    await env.DB.prepare(
      "INSERT INTO pages (id, title, menu_label, slug, parent_id, sort, template, status, in_menu, seo_description, blocks, updated_at, updated_by) " +
      "VALUES (?, ?, '', ?, NULL, 999, 'standard', 'draft', 0, '', ?, ?, ?)"
    ).bind(pageId, name, slug, JSON.stringify(blocks), now, currentUser?.username || '').run();
  }
  if (pageId) {
    await env.DB.prepare('UPDATE site_events SET page_landing_id = ?, page_registration_id = ? WHERE id = ?')
      .bind(pageId, pageId, id).run();
  }

  await logAudit(env.DB, currentUser, 'create', 'event', id, name, null,
    { name, has_registration: hasRegistration, has_payment: hasPayment, has_volunteers: hasVolunteers, has_photos: hasPhotos, page_id: pageId, existing_page: !!existingPageId });
  return id;
}

// Adds a `registration` block for `eventId` to a page's DRAFT blocks —
// never `published_blocks`, the same rule every other draft-only write in
// this admin follows — unless one for this event is already there. Shared
// by createEvent()'s "Its page" picker and the Page & copy tab's "Connect a
// different page" action below, so adopting an existing page behaves
// identically whichever screen it's done from.
async function addRegistrationBlockToPage(env, pageId, eventId, rawBlocks, now, currentUser) {
  let parsed = [];
  try { parsed = JSON.parse(rawBlocks || '[]'); } catch (_) { parsed = []; }
  const list = Array.isArray(parsed) ? parsed : [];
  if (list.some((b) => b && b.type === 'registration' && b.eventId === eventId)) return false;
  const next = sanitizeBlocks([...list, newBlock('registration', { eventId })]);
  await env.DB.prepare('UPDATE pages SET blocks = ?, updated_at = ?, updated_by = ? WHERE id = ?')
    .bind(JSON.stringify(next), now, currentUser?.username || '', pageId).run();
  return true;
}

// ── PHASE D — one event's own screen ─────────────────────────────────────────
async function renderEventScreen(env, currentUser, url, badges, id) {
  const ev = await getEvent(env, id);
  if (!ev) return new Response('', { status: 302, headers: { Location: '/events' } });
  const canEvent = hasPermission(currentUser, ev.coordinator_permission) || hasPermission(currentUser, 'events_manage');
  const canPages = hasPermission(currentUser, 'pages_edit');
  if (!canEvent && !canPages) return new Response('Access denied.', { status: 403 });

  const TABS = [
    { key: 'registrations', label: 'Registrations', on: canEvent && Number(ev.has_registration) },
    { key: 'page', label: 'Page & copy', on: canEvent || canPages },
    { key: 'money', label: 'Money & dates', on: canEvent },
    { key: 'volunteers', label: 'Volunteers', on: canEvent && Number(ev.has_volunteers) },
    { key: 'photos', label: 'Photos', on: canEvent && Number(ev.has_photos) },
  ].filter((t) => t.on);
  const wanted = String(url.searchParams.get('tab') || '');
  const active = (TABS.find((t) => t.key === wanted) || TABS[0] || { key: '' }).key;
  const tabNav = TABS.length > 1 ? `<nav class="tlc-tabs" aria-label="${escapeHtml(ev.name || id)}">${TABS.map((t) =>
    `<a class="tlc-tab${t.key === active ? ' is-on' : ''}" href="/events/${id}?tab=${t.key}"${t.key === active ? ' aria-current="page"' : ''}>${escapeHtml(t.label)}</a>`
  ).join('')}</nav>` : '';

  const [tone, statusLabel] = STATUS_PILL[ev.status] || STATUS_PILL.draft;
  const bareHeader = `<header class="tlc-section-head">
      <div class="tlc-section-headings">
        <h1 class="tlc-title">${escapeHtml(ev.name || id)} ${statusPill(tone, statusLabel)}</h1>
        <p class="tlc-purpose">${escapeHtml([ev.date_label, ev.hours_label].filter(Boolean).join(' · ') || 'Nothing about when this runs is set yet.')}</p>
      </div>
    </header>`;

  let body = '';

  // ── REGISTRATIONS + the field editor ───────────────────────────────────
  if (active === 'registrations' && canEvent) {
    const [rows, fields] = await Promise.all([listRegistrations(env, id), eventFields(env, id)]);
    const regRows = rows.map((r) => {
      const values = registrationFields(r, { includeSensitive: false });
      const summary = fields.filter((f) => !f.sensitive).slice(0, 2)
        .map((f) => values[f.key]).filter(Boolean).join(' · ');
      return `<div class="tlc-row-wrap"><div class="tlc-row" style="grid-template-columns:2fr 1fr 1fr 1fr 118px;">
        <span class="tlc-td">${primaryCell(r.contact_name || r.contact_email || `#${r.id}`, summary)}</span>
        <span class="tlc-td">${escapeHtml(r.contact_email || '')}</span>
        <span class="tlc-td">${r.qty || 1}${r.waitlisted ? ' <span class="tlc-hint">(waitlisted)</span>' : ''}</span>
        <span class="tlc-td">
          <form method="POST" action="/events/${id}/registrations/update" style="margin:0;display:inline-flex;gap:6px;align-items:center;">
            <input type="hidden" name="id" value="${r.id}">
            <select name="payment_status" onchange="this.form.submit()">
              ${PAYMENT_STATES.map((s) => `<option value="${s.value}"${s.value === r.payment_status ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
            </select>
          </form>
        </span>
        <span class="tlc-td tlc-right">
          <form method="POST" action="/events/${id}/registrations/delete" style="margin:0;" onsubmit="return confirm('Delete this sign-up?')">
            <input type="hidden" name="id" value="${r.id}">
            <button type="submit" class="tlc-edit" style="background:none;border:0;cursor:pointer;">Delete</button>
          </form>
        </span>
      </div></div>`;
    }).join('');

    const fieldRows = panelList({
      id: 'event-fields-list',
      reorderAction: `/events/${id}/fields/reorder`,
      empty: 'No fields yet — a registration form with none of its own asks only for whatever the coordinator adds here.',
      rows: fields.map((f) => ({
        id: f.id,
        name: f.label,
        sub: `${fieldKindLabel(f.kind)}${f.required ? ' · required' : ''}${f.sensitive ? ' · sensitive' : ''} · field_${f.key}`,
        action: `<form method="POST" action="/events/${id}/fields/delete" style="margin:0;" onsubmit="return confirm('Delete this field? Answers already collected for it are kept, just no longer shown as a column.')">
          <input type="hidden" name="id" value="${f.id}"><button type="submit" class="tlc-edit" style="background:none;border:0;cursor:pointer;">Delete</button>
        </form>`,
      })),
    });

    body = `${bareHeader}
    ${rows.length ? `<div class="tlc-table">
      <div class="tlc-thead" style="grid-template-columns:2fr 1fr 1fr 1fr 118px;">
        <span class="tlc-th">Who</span><span class="tlc-th">Email</span><span class="tlc-th">Qty</span><span class="tlc-th">Payment</span><span class="tlc-th"></span>
      </div>
      <div class="tlc-tbody">${regRows}</div>
    </div>` : `<p class="tlc-hint">Nobody has signed up yet.</p>`}
    <div class="btn-row" style="margin:16px 0 28px;"><a class="tlc-action-quiet" href="/events/${id}/export.csv">Export CSV</a></div>
    ${panel('The form’s own fields', `
      ${fieldRows}
      <form method="POST" action="/events/${id}/fields" style="margin-top:16px;display:grid;gap:10px;grid-template-columns:2fr 1fr 90px 90px 100px;align-items:end;">
        ${renderField({ name: 'label', label: 'Field', placeholder: 'Child’s name', required: true })}
        ${renderField({ kind: 'choice', name: 'kind', label: 'Kind', value: 'text', options: FIELD_KINDS })}
        ${renderField({ kind: 'toggle', name: 'required', label: 'Required', value: 0, on: 'Yes', off: 'No' })}
        ${renderField({ kind: 'toggle', name: 'sensitive', label: 'Sensitive', value: 0, on: 'Yes', off: 'No', hint: 'Kept out of the plain export column.' })}
        <button type="submit" class="tlc-btn-primary">Add field</button>
      </form>
    `)}`;
  }

  // ── PAGE & COPY ─────────────────────────────────────────────────────────
  if (active === 'page' && (canEvent || canPages)) {
    const ids = [ev.page_landing_id, ev.page_registration_id].filter((v, i, a) => v && a.indexOf(v) === i);
    const rows = [];
    for (const pid of ids) {
      const r = await env.DB.prepare('SELECT id, title, slug, status, blocks, published_blocks, updated_at, updated_by FROM pages WHERE id = ?').bind(pid).first().catch(() => null);
      if (r) rows.push(r);
    }
    const cards = rows.map((r) => {
      const published = !!r.published_blocks;
      const pending = published && String(r.blocks || '') !== String(r.published_blocks || '');
      const state = !published ? statusPill('warn', 'Never published') : (pending ? statusPill('warn', 'Unpublished edits') : statusPill('good', 'Live'));
      return panel(r.title || r.id, `
        <p class="tlc-hint" style="margin:0 0 12px;"><code>${escapeHtml(r.slug || '')}</code>${r.updated_at ? ` · last saved ${escapeHtml(String(r.updated_at).slice(0, 10))}` : ''}</p>
        <div class="btn-row" style="margin:0;">
          <a class="tlc-btn-primary" href="/pages/${escapeHtml(r.id)}/edit">Edit the page</a>
          <a class="tlc-action-quiet" href="https://timothystl.org${escapeHtml(r.slug || '')}" target="_blank" rel="noopener">View it live</a>
          <form method="POST" action="/events/${id}/disconnect-page" style="margin:0;" onsubmit="return confirm('Disconnect ${escapeHtml((r.title || r.id).replace(/'/g, '')).replace(/"/g, '&quot;')} from this event? The page itself is not deleted — it just stops being this event’s page, so you can connect the real one instead.')">
            <button type="submit" class="tlc-action-quiet">Disconnect</button>
          </form>
        </div>
      `, { right: state });
    }).join('');
    // Every page not already spoken for by another live event — so an
    // event created before this picker existed (or one whose page was
    // built by mistake, a second `/vbs` beside the real one) can still be
    // pointed at the page that was always the right one.
    const candidates = await candidateExistingPages(env);
    const connectPanel = candidates.length ? panel('Connect a different page', `
      <p class="tlc-hint" style="margin:0 0 12px;">If this event already has a page somewhere else on the site — VBS almost certainly does — connect it here instead of leaving two.${Number(ev.has_registration) ? ' A sign-up form is added to it; nothing already on the page is touched.' : ''}</p>
      <form method="POST" action="/events/${id}/connect-page" style="margin:0;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
        ${renderField({ kind: 'choice', name: 'page_id', label: 'Page', value: '',
          options: [{ value: '', label: 'Choose a page…' }, ...candidates.map((p) => ({ value: p.id, label: `${p.title || p.id} (${p.slug || p.id})` }))] })}
        <button type="submit" class="tlc-btn-primary">Connect</button>
      </form>
    `) : '';
    body = `<header class="tlc-section-head">
        <div class="tlc-section-headings">
          <h1 class="tlc-title">Page &amp; copy</h1>
          <p class="tlc-purpose">Every word a visitor reads is a field in the page editor — nothing about this event is typed into code.</p>
        </div>
      </header>
      ${cards ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;">${cards}</div>`
        : `<p class="tlc-hint">This event has no page of its own yet. Connect an existing one below, or add a Registration block (or a page) from the Pages screen and it will show up here once linked.</p>`}
      ${connectPanel ? `<div style="margin-top:20px;">${connectPanel}</div>` : ''}`;
  }

  // ── MONEY & DATES ───────────────────────────────────────────────────────
  if (active === 'money' && canEvent) {
    const cfg = eventFeeConfig(ev);
    body = `<header class="tlc-section-head">
        <div class="tlc-section-headings">
          <h1 class="tlc-title">Money &amp; dates</h1>
          <p class="tlc-purpose">What this costs, when it runs, and whether it is taking sign-ups right now.</p>
        </div>
      </header>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        ${panel('Details', `
          <form method="POST" action="/events/${id}/settings">
            ${renderField({ name: 'name', label: 'Name', value: ev.name })}
            ${renderField({ kind: 'choice', name: 'status', label: 'Status', value: ev.status,
              options: [{ value: 'draft', label: 'Draft' }, { value: 'live', label: 'Live' }, { value: 'archived', label: 'Archived' }] })}
            ${renderField({ name: 'date_label', label: 'When (in words)', value: ev.date_label })}
            ${renderField({ name: 'hours_label', label: 'Hours (in words)', value: ev.hours_label })}
            ${renderField({ name: 'coordinator_email', label: 'Coordinator email', type: 'email', value: ev.coordinator_email })}
            ${Number(ev.has_registration) ? `
              ${renderField({ kind: 'toggle', name: 'registration_open', label: 'Taking sign-ups', value: Number(ev.registration_open ?? 1), on: 'Open', off: 'Closed' })}
              ${renderField({ kind: 'number', name: 'registration_cap', label: 'Capacity (blank = uncapped)', value: ev.registration_cap == null ? '' : ev.registration_cap, min: 0 })}
              ${renderField({ kind: 'toggle', name: 'waitlist_enabled', label: 'Waitlist once full', value: Number(ev.waitlist_enabled), on: 'Yes', off: 'No, refuse instead' })}
              ${Number(ev.waitlist_enabled) ? renderField({ kind: 'number', name: 'waitlist_cap', label: 'Hard maximum, waitlist included (blank = unbounded)', value: ev.waitlist_cap == null ? '' : ev.waitlist_cap, min: 0,
                hint: 'Once capacity is reached, sign-ups queue on the waitlist until this total is reached too — then they are refused outright.' }) : ''}
            ` : ''}
            ${Number(ev.has_volunteers) ? renderField({ name: 'volunteer_slug', label: 'Serve slug', value: ev.volunteer_slug,
              hint: 'The address this event answers to on serve.timothystl.org.' }) : ''}
            ${Number(ev.has_photos) ? renderField({ name: 'photo_folder', label: 'Photo folder', value: ev.photo_folder,
              hint: 'Where photographs for this event are stored, so the Photos tab knows which ones are its own.' }) : ''}
            <div class="btn-row" style="margin-top:4px;"><button type="submit" class="tlc-btn-primary">Save</button></div>
          </form>
        `)}
        ${Number(ev.has_payment) ? panel('Payment', `
          <form method="POST" action="/events/${id}/money">
            ${renderField({ kind: 'number', name: 'fee_amount', label: 'Base fee ($)', value: cfg.tableFee, min: 0, step: 1 })}
            ${renderField({ kind: 'number', name: 'max_qty', label: 'Most one registration may take', value: cfg.maxTables, min: 1, step: 1 })}
            ${renderField({ kind: 'number', name: 'fee_percent', label: 'Card processing fee (%)', value: cfg.feePercent, min: 0, step: 0.1 })}
            ${renderField({ kind: 'number', name: 'fee_fixed', label: 'Card processing fee (fixed, $)', value: cfg.feeFixed, min: 0, step: 0.01 })}
            ${renderField({ name: 'fund_id', label: 'Tithe.ly fund ID', value: cfg.fundId, placeholder: "Blank uses the base link's fund" })}
            ${renderField({ kind: 'chips', name: 'payment_provider', label: 'Payment provider', value: cfg.paymentProvider,
              options: [{ value: 'tithely', label: 'Tithe.ly' }, { value: 'square', label: 'Square' }] })}
            <div class="btn-row" style="margin-top:4px;"><button type="submit" class="tlc-btn-primary">Save</button></div>
          </form>
        `) : ''}
      </div>
      <div class="btn-row" style="margin-top:24px;">
        ${ev.status === 'archived'
          ? `<form method="POST" action="/events/${id}/unarchive" style="margin:0;"><button type="submit" class="tlc-action-quiet">Unarchive</button></form>`
          : `<form method="POST" action="/events/${id}/archive" style="margin:0;" onsubmit="return confirm('Archive this event? It stops showing on public listings; nothing is deleted.')"><button type="submit" class="tlc-action-quiet">Archive</button></form>`}
      </div>`;
  }

  // ── VOLUNTEERS ──────────────────────────────────────────────────────────
  // ⚠ READ-ONLY, and there is no sign-in — the same shape the market's own
  // Volunteers tab always was, generalized off `volunteer_slug` instead of
  // the literal string 'christmasmarket'. See Serve's own
  // GET /api/signups/<slug>/summary — as of this writing that endpoint is
  // still hardcoded to the market on the Serve side, so a slug other than
  // 'christmasmarket' will get an honest "not available" here until that is
  // generalized there too. Nothing here writes back, and nothing should.
  if (active === 'volunteers' && canEvent) {
    const slug = ev.volunteer_slug || '';
    let vol = null;
    let volError = '';
    if (!slug) {
      volError = 'No Serve slug is set for this event yet — set one on the Money & dates tab.';
    } else {
      try {
        const res = await fetch(`https://serve.timothystl.org/api/signups/${encodeURIComponent(slug)}/summary`,
          { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
        if (res.ok) vol = await res.json();
        else volError = `Serve answered ${res.status}.`;
      } catch (e) { volError = 'Serve could not be reached.'; }
      if (vol && !Array.isArray(vol.roles)) { vol = null; volError = volError || 'Serve answered with something this screen could not read.'; }
    }

    const roles = Array.isArray(vol?.roles) ? vol.roles : [];
    const shortOf = (r) => (r.shifts || []).reduce((a, sh) => a + Math.max(0, (Number(sh.needed) || 0) - (Number(sh.filled) || 0)), 0);
    const sorted = roles.slice().sort((a, b) => shortOf(b) - shortOf(a));
    const tile = (label, n, note) => `<div class="tlc-tile"><div class="tlc-tile-label">${escapeHtml(label)}</div><div class="tlc-tile-num">${escapeHtml(String(n))}</div><div class="tlc-tile-note">${escapeHtml(note)}</div></div>`;
    const rolePanels = sorted.map((r) => {
      const shifts = Array.isArray(r.shifts) ? r.shifts : [];
      const rowsHtml = shifts.map((sh) => {
        const needed = Number(sh.needed) || 0;
        const filled = Number(sh.filled) || 0;
        const people = Array.isArray(sh.people) ? sh.people : [];
        const who = people.length
          ? people.map((pp) => pp && pp.email ? `<a href="mailto:${escapeHtml(pp.email)}">${escapeHtml(pp.name || pp.email)}</a>` : escapeHtml((pp && pp.name) || '')).filter(Boolean).join(', ')
          : '<span class="tlc-hint">Nobody yet — this shift is entirely open.</span>';
        return `<tr><td style="padding:6px 12px 6px 0;">${escapeHtml(sh.label || '')}</td><td style="padding:6px 12px 6px 0;white-space:nowrap;">${filled} of ${needed}</td><td style="padding:6px 0;">${who}</td></tr>`;
      }).join('');
      const short = shortOf(r);
      return panel(r.name || 'Role', `<table style="width:100%;border-collapse:collapse;font-size:14px;">${rowsHtml || '<tr><td class="tlc-hint">No shifts set up for this role yet.</td></tr>'}</table>`,
        { right: (short > 0 ? statusPill('warn', short + ' still needed') : statusPill('good', 'Full'))
          + (slug ? ` <a class="tlc-action-quiet" href="https://serve.timothystl.org/${escapeHtml(slug)}" target="_blank" rel="noopener">Manage shifts in Serve</a>` : '') });
    }).join('');

    body = `<header class="tlc-section-head">
        <div class="tlc-section-headings">
          <h1 class="tlc-title">Volunteers</h1>
          <p class="tlc-purpose">Who is covering this, read from Serve. Shifts are set up and changed there — this is a window on them, not a second copy.</p>
        </div>
        ${slug ? `<div class="tlc-section-actions"><a class="tlc-btn-primary" href="https://serve.timothystl.org/${escapeHtml(slug)}" target="_blank" rel="noopener">Manage shifts in Serve</a></div>` : ''}
      </header>`
      + (vol ? `<div class="tlc-tiles">
            ${tile('Signed up', vol.signedUp ?? 0, 'People who have taken a shift')}
            ${tile('Open shifts', vol.openShifts ?? 0, 'Still to be covered')}
            ${tile('Roles', roles.length, 'Jobs this event needs')}
            ${tile('Sign-ups', vol.open ? 'Open' : 'Closed', vol.open ? 'Serve is taking volunteers' : 'Serve is not taking volunteers')}
          </div>
          ${rolePanels || `<p class="tlc-hint">Serve has no roles set up for this event yet.</p>`}`
        : `<div class="alert alert-warn">Counts are not available right now — ${escapeHtml(volError || 'Serve did not answer.')} Nothing here is broken; the roster lives in Serve.</div>`);
  }

  // ── PHOTOS ──────────────────────────────────────────────────────────────
  if (active === 'photos' && canEvent) {
    const all = (await env.DB.prepare(
      "SELECT id, filename, kind, url, thumb_url, alt FROM ministry_media ORDER BY id DESC LIMIT 400"
    ).all().catch(() => ({ results: [] }))).results || [];
    const needle = (ev.photo_folder || id).toLowerCase();
    const idNeedle = id.toLowerCase();
    const mine = all.filter((m) => `${m.url || ''} ${m.filename || ''}`.toLowerCase().includes(needle)
      || `${m.url || ''} ${m.filename || ''}`.toLowerCase().includes(idNeedle));
    const cards = mine.map((m) => `
      <div class="tlc-card" style="padding:14px;">
        ${m.kind === 'video' ? `<p class="tlc-hint" style="margin:0 0 8px;">Video</p>`
          : `<img src="${escapeHtml(m.thumb_url || m.url)}" alt="${escapeHtml(m.alt || '')}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;background:var(--tlc-linen);">`}
        <p class="tlc-hint" style="margin:8px 0;word-break:break-all;">${escapeHtml(m.filename || '')}</p>
        <form method="POST" action="/events/${id}/photo-alt" style="margin:0;">
          <input type="hidden" name="id" value="${m.id}">
          ${renderField({ name: 'alt', label: 'Description', value: m.alt || '' })}
          <button type="submit" class="tlc-btn-primary" style="margin-top:6px;">Save</button>
        </form>
      </div>`).join('');
    body = `<header class="tlc-section-head">
        <div class="tlc-section-headings">
          <h1 class="tlc-title">Photos</h1>
          <p class="tlc-purpose">This event’s photographs, and what each one says to somebody who cannot see it.</p>
        </div>
      </header>
      <p class="tlc-hint" style="margin:0 0 16px;">Photographs are added in the page editor, by dropping one onto a gallery or a banner — they land in the library and appear here. Store them under <code>${escapeHtml(ev.photo_folder || `images/events/${id}/`)}</code> so they stay together.</p>
      ${mine.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">${cards}</div>`
        : `<p class="tlc-hint">No photographs for this event in the library yet.</p>`}
      <p class="tlc-hint" style="margin-top:20px;">Every photograph on the site is on the <a href="/media">Media screen</a>.</p>`;
  }

  if (!body) body = `<div class="alert alert-warn">Nothing on this tab is reachable with what you hold.</div>`;

  return html(`
${sidebarShell('events', currentUser, `<a href="/events">All events</a>`, badges)}
<div class="tlc-wrap">
  ${tabNav}
  ${body}
</div>`, ev.name || id);
}

export async function handleEventsRoutes(request, env, path, method, currentUser, url, badges = {}) {
  if (path !== '/events' && !path.startsWith('/events/')) return null;

  if (path === '/events' && method === 'GET') {
    // Reachable by events_manage, OR any single event's own coordinator key —
    // a VBS coordinator holding only event_vbs_manage still needs a way to
    // reach their own row, even though the index otherwise belongs to
    // events_manage. Same reasoning the market's sidebar row already carries.
    const eventPerms = await eventCoordinatorPermissions(env);
    const canSeeIndex = hasPermission(currentUser, 'events_manage')
      || Object.keys(eventPerms).some((k) => hasPermission(currentUser, k))
      || hasPermission(currentUser, 'market_manage');
    if (!canSeeIndex) return new Response('Access denied.', { status: 403 });
    return renderEventsList(env, currentUser, badges);
  }

  if (path === '/events/new') {
    if (!hasPermission(currentUser, 'events_manage')) return new Response('Access denied.', { status: 403 });
    if (method === 'GET') return renderNewEventForm(env, currentUser, badges);
    if (method === 'POST') {
      const form = await request.formData();
      const id = await createEvent(env, currentUser, form);
      return new Response('', { status: 302, headers: { Location: `/events/${id}?toast=${encodeURIComponent('Created · written to the audit log')}` } });
    }
  }

  // ── /events/:id and its sub-routes ─────────────────────────────────────
  // ⚠ [a-z0-9.-]+, not [a-z-]+ — /export.csv carries a literal dot, and a
  // narrower class would silently fail to match it, falling through to
  // whatever later route happens to answer instead (found by a test, not by
  // reading — the CSV request landed on an unrelated screen).
  const m = path.match(/^\/events\/([^/]+)(\/[a-z0-9.-]+(?:\/[a-z0-9.-]+)?)?$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  const action = m[2] || '';

  if (!action && method === 'GET') return renderEventScreen(env, currentUser, url, badges, id);

  // Every mutating route re-checks the SAME event's own permission —
  // reaching one event's screen must never be a back door into another's.
  const ev = await getEvent(env, id);
  if (!ev) return new Response('', { status: 302, headers: { Location: '/events' } });
  const canEvent = hasPermission(currentUser, ev.coordinator_permission) || hasPermission(currentUser, 'events_manage');
  // The Page & copy tab is reachable by either key (its own tab-visibility
  // rule, above) — connecting or disconnecting a page is content work, not
  // money or a roster, so its two routes below check the same pair.
  const canPages = hasPermission(currentUser, 'pages_edit');

  if (action === '/connect-page' && method === 'POST') {
    if (!(canEvent || canPages)) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const pageId = cap(form.get('page_id'), 60);
    if (pageId) {
      const page = await env.DB.prepare('SELECT id, blocks FROM pages WHERE id = ?').bind(pageId).first().catch(() => null);
      if (page) {
        const now = new Date().toISOString();
        if (Number(ev.has_registration)) await addRegistrationBlockToPage(env, pageId, id, page.blocks, now, currentUser);
        const before = { page_landing_id: ev.page_landing_id, page_registration_id: ev.page_registration_id };
        await updateEventRow(env, id, { page_landing_id: pageId, page_registration_id: pageId, updated_at: now, updated_by: currentUser?.username || '' });
        await logAudit(env.DB, currentUser, 'update', 'event', id, ev.name, before, { page_landing_id: pageId, page_registration_id: pageId });
      }
    }
    return new Response('', { status: 302, headers: { Location: `/events/${id}?tab=page&toast=${encodeURIComponent('Connected · written to the audit log')}` } });
  }

  if (action === '/disconnect-page' && method === 'POST') {
    if (!(canEvent || canPages)) return new Response('Access denied.', { status: 403 });
    const before = { page_landing_id: ev.page_landing_id, page_registration_id: ev.page_registration_id };
    if (before.page_landing_id || before.page_registration_id) {
      await updateEventRow(env, id, { page_landing_id: null, page_registration_id: null, updated_at: new Date().toISOString(), updated_by: currentUser?.username || '' });
      await logAudit(env.DB, currentUser, 'update', 'event', id, ev.name, before, { page_landing_id: null, page_registration_id: null });
    }
    return new Response('', { status: 302, headers: { Location: `/events/${id}?tab=page&toast=${encodeURIComponent('Disconnected · the page itself is untouched')}` } });
  }

  if (action === '/export.csv' && method === 'GET') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const [fields, rows] = await Promise.all([eventFields(env, id), listRegistrations(env, id)]);
    const csv = registrationsCsv(ev, fields, rows);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${id}-registrations-${churchDate()}.csv"`,
      },
    });
  }

  if (action === '/settings' && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const before = { ...ev };
    const patch = {
      name: cap(form.get('name'), 200) || ev.name,
      status: ['draft', 'live', 'archived'].includes(form.get('status')) ? form.get('status') : ev.status,
      date_label: cap(form.get('date_label'), 200),
      hours_label: cap(form.get('hours_label'), 200),
      coordinator_email: cap(form.get('coordinator_email'), 200),
      registration_open: form.getAll('registration_open').includes('1') ? 1 : 0,
      registration_cap: form.get('registration_cap') ? Math.max(0, parseInt(form.get('registration_cap'), 10) || 0) : null,
      waitlist_enabled: form.getAll('waitlist_enabled').includes('1') ? 1 : 0,
      waitlist_cap: form.get('waitlist_cap') ? Math.max(0, parseInt(form.get('waitlist_cap'), 10) || 0) : null,
      volunteer_slug: cap(form.get('volunteer_slug'), 200) || null,
      photo_folder: cap(form.get('photo_folder'), 200) || null,
      updated_at: new Date().toISOString(),
      updated_by: currentUser?.username || '',
    };
    await updateEventRow(env, id, patch);
    await logAudit(env.DB, currentUser, 'update', 'event', id, patch.name, before, patch);
    return new Response('', { status: 302, headers: { Location: `/events/${id}?tab=money&toast=${encodeURIComponent('Saved · written to the audit log')}` } });
  }

  if (action === '/money' && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const before = { ...ev };
    const patch = {
      fee_amount: num(form.get('fee_amount'), MARKET_DEFAULTS.tableFee),
      max_qty: Math.max(1, Math.floor(num(form.get('max_qty'), MARKET_DEFAULTS.maxTables))),
      fee_percent: num(form.get('fee_percent'), MARKET_DEFAULTS.feePercent),
      fee_fixed: num(form.get('fee_fixed'), MARKET_DEFAULTS.feeFixed),
      fund_id: cap(form.get('fund_id'), 200) || null,
      payment_provider: form.get('payment_provider') === 'square' ? 'square' : 'tithely',
      updated_at: new Date().toISOString(),
      updated_by: currentUser?.username || '',
    };
    await updateEventRow(env, id, patch);
    await logAudit(env.DB, currentUser, 'update', 'event', id, ev.name, before, patch);
    return new Response('', { status: 302, headers: { Location: `/events/${id}?tab=money&toast=${encodeURIComponent('Saved · written to the audit log')}` } });
  }

  if ((action === '/archive' || action === '/unarchive') && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const archiving = action === '/archive';
    await updateEventRow(env, id, {
      status: archiving ? 'archived' : 'draft',
      archived_at: archiving ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(), updated_by: currentUser?.username || '',
    });
    await logAudit(env.DB, currentUser, archiving ? 'archive' : 'unarchive', 'event', id, ev.name, { status: ev.status }, { status: archiving ? 'archived' : 'draft' });
    return new Response('', { status: 302, headers: { Location: `/events/${id}?tab=money` } });
  }

  if (action === '/photo-alt' && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const mid = Number(form.get('id') || 0);
    const alt = cap(form.get('alt'), 300);
    const before = await env.DB.prepare('SELECT filename, alt FROM ministry_media WHERE id = ?').bind(mid).first().catch(() => null);
    if (before) {
      await env.DB.prepare('UPDATE ministry_media SET alt = ? WHERE id = ?').bind(alt, mid).run();
      await logAudit(env.DB, currentUser, 'update', 'media', String(mid), before.filename || '', { alt: before.alt }, { alt });
    }
    return new Response('', { status: 302, headers: { Location: `/events/${id}?tab=photos&toast=${encodeURIComponent('Saved · written to the audit log')}` } });
  }

  // ── Fields ────────────────────────────────────────────────────────────
  if (action === '/fields' && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const label = cap(form.get('label'), 200);
    if (!label) return new Response('', { status: 302, headers: { Location: `/events/${id}` } });
    const kind = FIELD_KINDS.some((k) => k.value === form.get('kind')) ? form.get('kind') : 'text';
    const existingKeys = (await eventFields(env, id)).map((f) => f.key);
    const key = slugifyFieldKey(label, existingKeys);
    const maxSort = await env.DB.prepare('SELECT COALESCE(MAX(sort_order),-1) AS n FROM site_event_fields WHERE event_id = ?').bind(id).first().catch(() => ({ n: -1 }));
    await env.DB.prepare(
      'INSERT INTO site_event_fields (event_id, key, label, kind, required, sensitive, sort_order) VALUES (?,?,?,?,?,?,?)'
    ).bind(id, key, label, kind, form.getAll('required').includes('1') ? 1 : 0,
      form.getAll('sensitive').includes('1') ? 1 : 0, ((maxSort && maxSort.n) || -1) + 1).run();
    await logAudit(env.DB, currentUser, 'create', 'event_field', `${id}:${key}`, label, null, { label, kind });
    return new Response('', { status: 302, headers: { Location: `/events/${id}` } });
  }

  if (action === '/fields/delete' && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const fid = Number(form.get('id') || 0);
    const before = await env.DB.prepare('SELECT * FROM site_event_fields WHERE id = ? AND event_id = ?').bind(fid, id).first().catch(() => null);
    if (before) {
      await env.DB.prepare('DELETE FROM site_event_fields WHERE id = ? AND event_id = ?').bind(fid, id).run();
      await logAudit(env.DB, currentUser, 'delete', 'event_field', `${id}:${before.key}`, before.label, before, null);
    }
    return new Response('', { status: 302, headers: { Location: `/events/${id}` } });
  }

  if (action === '/fields/reorder' && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    let order = [];
    try { order = JSON.parse(form.get('order') || '[]'); } catch (_) { order = []; }
    const stmts = order.map((fid, i) =>
      env.DB.prepare('UPDATE site_event_fields SET sort_order = ? WHERE id = ? AND event_id = ?').bind(i, Number(fid), id));
    if (stmts.length) await env.DB.batch(stmts);
    return new Response('', { status: 302, headers: { Location: `/events/${id}` } });
  }

  // ── Registrations ────────────────────────────────────────────────────
  if (action === '/registrations/update' && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const rid = Number(form.get('id') || 0);
    const status = PAYMENT_STATES.some((s) => s.value === form.get('payment_status')) ? form.get('payment_status') : 'unpaid';
    const before = await getRegistration(env, rid);
    if (before && before.event_id === id) {
      const patch = { payment_status: status };
      // ⚠ MARKING A ROW PAID RECORDS THE AMOUNT ASKED, unless one is already
      // recorded — the identical rule /market/update (admin/market.js) already
      // follows for the Christmas Market's own vendor screen. This is the
      // OTHER door onto the same site_event_registrations row (the generic
      // "Registrations" tab any has_payment event gets), and without this it
      // is a second form disagreeing with the first about what "Paid" means:
      // the pill reads Paid off payment_status alone, but the money line and
      // the "Recorded as paid" total both read amount_paid_cents, which this
      // route left NULL. A row marked Paid here read "asked $X" forever and
      // was invisible to reconciliation — exactly the failure the market
      // screen's own rule exists to prevent, just reachable through a second
      // door that never got the same rule.
      if (status === 'paid' && before.amount_paid_cents == null) {
        patch.amount_paid_cents = before.amount_due_cents || 0;
      }
      await updateRegistration(env, rid, patch);
      await logAudit(env.DB, currentUser, 'update', 'event_registration', String(rid), before.contact_name || before.contact_email || '',
        { payment_status: before.payment_status, amount_paid_cents: before.amount_paid_cents },
        { payment_status: status, amount_paid_cents: patch.amount_paid_cents ?? before.amount_paid_cents });
    }
    return new Response('', { status: 302, headers: { Location: `/events/${id}` } });
  }

  if (action === '/registrations/delete' && method === 'POST') {
    if (!canEvent) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const rid = Number(form.get('id') || 0);
    const before = await getRegistration(env, rid);
    if (before && before.event_id === id) {
      await deleteRegistration(env, rid);
      await logAudit(env.DB, currentUser, 'delete', 'event_registration', String(rid), before.contact_name || before.contact_email || '', before, null);
    }
    return new Response('', { status: 302, headers: { Location: `/events/${id}` } });
  }

  return null;
}

async function updateEventRow(env, id, patch) {
  const sets = [];
  const args = [];
  for (const [col, val] of Object.entries(patch)) { sets.push(`${col} = ?`); args.push(val); }
  if (!sets.length) return;
  args.push(id);
  await env.DB.prepare(`UPDATE site_events SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
}
