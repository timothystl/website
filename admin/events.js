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
export function capacityDecision(ev, currentQty, addingQty) {
  const cap_ = Number(ev.registration_cap);
  if (!Number.isFinite(cap_) || cap_ <= 0) return { waitlisted: false, refused: false };
  if (currentQty + addingQty <= cap_) return { waitlisted: false, refused: false };
  if (Number(ev.waitlist_enabled)) return { waitlisted: true, refused: false };
  return { waitlisted: false, refused: true };
}

// ── THE GENERIC EVENTS ADMIN (/events, /events/new, /events/:id) ────────────
// Built out below this line, phase by phase — see PHASE_B/C/D/E/F markers
// further down this file as they land. Returns null for anything it does not
// own, the same contract handleMarketRoutes and handleFilteredRoutes already
// use, so it can sit in the same route chain.
export async function handleEventsRoutes(request, env, path, method, currentUser, url, badges = {}) {
  if (path !== '/events' && !path.startsWith('/events/')) return null;
  return null;
}
