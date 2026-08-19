// ── THE CHRISTMAS MARKET VENDOR APPLICATION ──────────────────────────────────
//
// Replaces the Google Form + spreadsheet the market ran on through 2024
// (`Weihnachtsmarkt Registration`, 68 vendors, ~69 tables). Three parts live
// here: the money, the intake, and the coordinator's list.
//
// ⚠ THE MONEY IS THE PART TO READ FIRST. A vendor pays a GROSSED-UP amount so
// that after the card processor takes its cut the church still receives the
// whole table fee. Get it wrong in the cheap direction and the market quietly
// runs a few dollars short across seventy vendors; get it wrong in the
// expensive direction and every vendor is overcharged. Neither shows up as an
// error anywhere — a wrong amount still looks like a working button, which is
// the same reason give-link.js exists as one file.

import { html, sidebarShell, escapeHtml } from './helpers.js';
import { hasPermission, logAudit } from './auth.js';
import { renderListSection, renderDrawer, primaryCell, statusPill, rowActions, panel, renderField } from './ui.js';
import { section as sectionCfg, columnsOf, filtersOf } from './sections.js';
import { churchDate } from './when.js';
import { withAmountAndFund } from '../give-link.js';
// The pricing itself moved to a leaf module with no admin/ imports, so
// admin/blocks.js — which admin/helpers.js already has a one-way dependency
// on — can import the same arithmetic without completing a circular import.
// Re-exported here so every existing caller of admin/market.js (including its
// own test file) keeps working unchanged. See market-price.js.
import { MARKET_DEFAULTS, clampTables, priceBreakdown, money, MARKET_PRICING_JS } from '../market-price.js';
export { MARKET_DEFAULTS, clampTables, priceBreakdown, money, MARKET_PRICING_JS };
// ── THE MARKET IS ONE EVENT NOW, NOT ELEVEN site_settings ROWS ──────────────
// admin/events.js is the generalized event record and registration table —
// see its own header comment for why it exists and why the import runs only
// this direction. `marketConfigFromRows(rows)` (site_settings rows in, a fee
// config out) is gone; `marketSettings(env)` below now reads the market's own
// `site_events` row through `eventFeeConfig()`, which is the SAME shaped
// object the old function returned, so admin/blocks.js's `marketapp` and
// `marketfacts` branches — and everything else that reads `data.market` —
// needed no change at all.
import {
  PAYMENT_STATES, paymentState, getEvent, eventFeeConfig, listRegistrations, getRegistration,
  insertRegistration, updateRegistration, deleteRegistration, registrationFields, countUnpaid,
  csvCell,
} from './events.js';
export { PAYMENT_STATES, paymentState };

const num = (v, fallback) => {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

// ── WHAT THE COORDINATOR TRACKS ──────────────────────────────────────────────
// `PAYMENT_STATES`/`paymentState` moved to admin/events.js, generalized for
// any event that takes money — imported and re-exported above so every
// existing caller of admin/market.js (including its own test file) is
// unchanged.

// ── READING THE APPLICATION ──────────────────────────────────────────────────
// Pure, so the rules can be tested without a database or a request. Returns
// `{ ok, errors, value }`; `errors` is a list of plain sentences a vendor can
// act on, never a field name.
//
// ⚠ Only four fields are required, and the list is short on purpose. Every
// extra required field is a maker who gives up halfway and emails Marla
// instead, which is the workflow this page exists to replace. Photos, the
// mailing address, the appliance list and the business name are all optional
// — the coordinator can ask afterwards, and she would rather have the
// application.
const REQUIRED = [
  ['participant_names', 'Please say who will be at the table.'],
  ['email', 'Please give us an email address so we can confirm your table.'],
  ['phone', 'Please give us a phone number.'],
  ['product_description', 'Please describe what you plan to sell.'],
  ['signature_name', 'Please type your name at the bottom to agree to the vendor terms.'],
];

const trim = (v) => String(v == null ? '' : v).trim();
const cap = (v, n) => trim(v).slice(0, n);

export function sanitizeApplication(form, cfg = {}) {
  const value = {
    participant_names: cap(form.participant_names, 300),
    business_name: cap(form.business_name, 200),
    website_or_social: cap(form.website_or_social, 300),
    returning_vendor: trim(form.returning_vendor) === 'yes' ? 'yes'
      : trim(form.returning_vendor) === 'no' ? 'no' : '',
    email: cap(form.email, 200).toLowerCase(),
    phone: cap(form.phone, 60),
    street: cap(form.street, 200),
    city: cap(form.city, 120),
    state: cap(form.state, 60),
    zip: cap(form.zip, 20),
    product_description: cap(form.product_description, 4000),
    sells_food: trim(form.sells_food) === '1' ? 1 : 0,
    appliances_power: cap(form.appliances_power, 500),
    special_requests: cap(form.special_requests, 2000),
    tables: clampTables(form.tables, cfg.maxTables ?? MARKET_DEFAULTS.maxTables),
    signature_name: cap(form.signature_name, 200),
    // 'card' is the only value every application before this carried, so it
    // is the default for anything else too — a stale form, a hand-typed
    // POST, a missing field all land on the path that already existed.
    payment_method: trim(form.payment_method) === 'check' ? 'check' : 'card',
  };

  const errors = [];
  for (const [field, message] of REQUIRED) {
    if (!value[field]) errors.push(message);
  }
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) {
    errors.push('That email address does not look right — please check it.');
  }
  return { ok: errors.length === 0, errors, value };
}

// The message the spam screener scores. A vendor application has no single
// "message" field, so the three free-text fields somebody would actually
// stuff a pitch into are joined — the product description above all, which is
// the one field a marketing bot fills in.
export const screenableText = (v) =>
  [v.product_description, v.special_requests, v.business_name, v.website_or_social]
    .filter(Boolean).join('\n\n');

// ── SETTINGS ─────────────────────────────────────────────────────────────────
// One read, shaped for both the public page and this admin screen. Every value
// falls back to the design's own figures, so a market page rendered against an
// unreachable or unseeded database still quotes the right price.
//
// ⚠ THE ELEVEN market_* site_settings ROWS ARE GONE. The market is one row on
// `site_events` now (id 'christmasmarket'), and `eventFeeConfig()` in
// admin/events.js shapes it into exactly this object — so nothing downstream
// of `marketSettings()`/`marketConfig()` had to change at all. `pageData()` in
// tlc-admin-worker.js builds `data.market` the identical way, from the row it
// already fetches in its own batched Promise.all.
export async function marketSettings(env) {
  const [ev, giveRow] = await Promise.all([
    getEvent(env, 'christmasmarket'),
    env.DB.prepare("SELECT value FROM site_settings WHERE key = 'give_url'").first().catch(() => null),
  ]);
  return eventFeeConfig(ev, (giveRow && giveRow.value) || '');
}

// ── THE MARKET'S OWN FIELD SHAPE, ON THE GENERIC REGISTRATION TABLE ─────────
// The market's nine fields keep the exact names they have always had as
// `market_vendors` columns — `marketFieldsFromValue()` carries a
// `sanitizeApplication()` result over into `site_event_registrations`'s
// `fields_json`, and `marketRowFromRegistration()` reconstructs a row shaped
// exactly like the old `market_vendors` row, so every renderer, the CSV
// export and the coordinator's drawer below did not need to change — they
// still read `editing.business_name`, `editing.product_description`, and so
// on, on an object built fresh from the new table instead of read straight
// off the old one.
function marketFieldsFromValue(value) {
  return {
    business_name: value.business_name || '',
    website_or_social: value.website_or_social || '',
    returning_vendor: value.returning_vendor || '',
    street: value.street || '',
    city: value.city || '',
    state: value.state || '',
    zip: value.zip || '',
    product_description: value.product_description || '',
    sells_food: value.sells_food ? 1 : 0,
    appliances_power: value.appliances_power || '',
    special_requests: value.special_requests || '',
    signature_name: value.signature_name || '',
    payment_method: value.payment_method === 'check' ? 'check' : 'card',
  };
}

export function marketRowFromRegistration(reg) {
  const f = registrationFields(reg);
  return {
    id: reg.id,
    participant_names: reg.contact_name || '',
    business_name: f.business_name || '',
    website_or_social: f.website_or_social || '',
    returning_vendor: f.returning_vendor || '',
    email: reg.contact_email || '',
    phone: reg.contact_phone || '',
    street: f.street || '',
    city: f.city || '',
    state: f.state || '',
    zip: f.zip || '',
    product_description: f.product_description || '',
    sells_food: f.sells_food ? 1 : 0,
    appliances_power: f.appliances_power || '',
    special_requests: f.special_requests || '',
    tables: reg.qty || 1,
    // photosOf() below still expects a JSON-encoded STRING, same as the
    // market_vendors.photos column used to hold — reconstructed here rather
    // than changed there, so photosOf() itself needed no edit.
    photos: Array.isArray(f.photos) && f.photos.length ? JSON.stringify(f.photos) : null,
    signature_name: f.signature_name || '',
    // Absent on every application saved before this shipped — 'card' is the
    // one path that already existed, so it is the read-side default too.
    payment_method: f.payment_method === 'check' ? 'check' : 'card',
    amount_due_cents: reg.amount_due_cents || 0,
    table_number: reg.table_number || '',
    payment_status: reg.payment_status || 'unpaid',
    amount_paid_cents: reg.amount_paid_cents,
    square_order_id: reg.square_order_id || '',
    staff_notes: reg.staff_notes || '',
    created_at: reg.created_at,
  };
}

// Called by the /api/market/apply route in tlc-admin-worker.js after
// sanitizeApplication() has run, to build the arguments insertRegistration()
// (admin/events.js) needs. Kept here, not there, because it is the one place
// that knows the market's own field names.
//
// ⚠ A CHECK/CASH APPLICATION OWES THE FLAT FEE, NEVER THE GROSSED-UP ONE.
// The gross-up exists to cover a card processor's cut; a vendor paying by
// check or cash never touches a processor, so charging them the marked-up
// total would be asking for money the church has no fee to cover. `price`
// already carries both figures — `subtotalCents` is exactly `tables ×
// tableFee`, the same number the "1 table × $X" line already shows — so
// this needs no second pricing function, only the right field of the one
// that already exists.
export function marketInsertArgs(value, price, photos) {
  return {
    event_id: 'christmasmarket',
    qty: value.tables,
    payment_status: 'unpaid',
    amount_due_cents: value.payment_method === 'check' ? price.subtotalCents : price.totalCents,
    contact_name: value.participant_names,
    contact_email: value.email,
    contact_phone: value.phone,
    fields: { ...marketFieldsFromValue(value), photos: photos && photos.length ? photos : undefined },
  };
}

// A purely presentational relabeling for the coordinator's list, the CSV
// export and the vendor drawer — it does NOT introduce a fifth
// `payment_status`. Every filter, every CSV column and every existing test
// keys off the four states `PAYMENT_STATES` already declares; a vendor who
// chose to pay by check is still, factually, unpaid until the coordinator
// marks the check received. This only changes what she is TOLD about why.
export function paymentLabel(row) {
  const st = paymentState(row.payment_status);
  if (row.payment_method === 'check' && row.payment_status === 'unpaid') {
    return { value: st.value, tone: st.tone, label: 'Awaiting check' };
  }
  return st;
}

// The payment address, built at request time from `give_url` and the market's
// own fund — or, when the market is running on Square, looked up from the
// office's own pasted links.
//
// ⚠ NEVER STORED. The whole reason a block cannot hold a Tithe.ly address (see
// give-link.js, and "The two giving pages have separate jobs" in CLAUDE.md) is
// that a stored one goes on charging to the old form after the office changes
// the base link, and the page still looks perfect. The same rule holds here:
// the application row records what was ASKED FOR in cents, and the address is
// recomputed every time it is needed.
//
// ⚠ `tables` is required for Square and ignored for Tithe.ly. Square Payment
// Links cannot take an amount as a URL parameter the way Tithe.ly can, so
// there is no formula here — only a lookup against what the office pasted in
// for that exact table count. A count with no matching link returns '',
// exactly like a blank base link does for Tithe.ly: a missing address, never
// a wrong one.
export function marketPayUrl(settings, totalCents, tables) {
  if (settings.paymentProvider === 'square') {
    const url = (settings.squareLinks || {})[String(tables)];
    return typeof url === 'string' ? url.trim() : '';
  }
  const base = settings.giveUrl || '';
  if (!base) return '';
  return withAmountAndFund(base, totalCents / 100, settings.fundId);
}

// What the public page fetches before it can quote a price or take a payment.
export async function marketConfig(env) {
  const s = await marketSettings(env);
  return {
    open: s.open,
    tableFee: s.tableFee,
    feePercent: s.feePercent,
    feeFixed: s.feeFixed,
    maxTables: s.maxTables,
    dateLabel: s.dateLabel,
    hoursLabel: s.hoursLabel,
    coordinatorEmail: s.coordinatorEmail,
  };
}

// ── EMAIL ────────────────────────────────────────────────────────────────────
const row = (label, v) => (v ? `<p style="margin:0 0 6px"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(v))}</p>` : '');

export function coordinatorEmailHtml(v, { totalCents, photos = [], suspect = false }) {
  const addr = [v.street, [v.city, v.state].filter(Boolean).join(', '), v.zip].filter(Boolean).join(' · ');
  return `${suspect ? '<p style="margin:0 0 12px;padding:10px 12px;background:#FAF0DC;border-left:3px solid #C9973A;"><strong>The spam filter scored this one as doubtful.</strong> It is almost certainly a real application — this note is just so you read it twice.</p>' : ''}
<p style="margin:0 0 12px"><strong>${escapeHtml(v.participant_names)}</strong>${v.business_name ? ` — ${escapeHtml(v.business_name)}` : ''} applied for ${v.tables} table${v.tables === 1 ? '' : 's'}.</p>
${row('Email', v.email)}
${row('Phone', v.phone)}
${row('Website or social', v.website_or_social)}
${row('Sold with us before', v.returning_vendor === 'yes' ? 'Returning vendor' : v.returning_vendor === 'no' ? 'First year' : '')}
${row('Mailing address', addr)}
<p style="margin:12px 0 6px"><strong>What they sell:</strong></p>
<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(v.product_description)}</p>
${v.sells_food ? '<p style="margin:0 0 6px"><strong>Selling food or drink</strong> — health department requirements are theirs, but they will be expecting to hear from you.</p>' : ''}
${row('Appliances / power', v.appliances_power)}
${v.special_requests ? `<p style="margin:12px 0 6px"><strong>Special requests:</strong></p><p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(v.special_requests)}</p>` : ''}
${photos.length ? `<p style="margin:12px 0 6px"><strong>Sample photos:</strong></p><p style="margin:0 0 12px">${photos.map((u, i) => `<a href="${escapeHtml(u)}">Photo ${i + 1}</a>`).join(' · ')}</p>` : ''}
${row('Agreed as', v.signature_name)}
<p style="margin:12px 0 0"><strong>Asked to pay:</strong> ${escapeHtml(money(totalCents))}${v.payment_method === 'check' ? ' — by check or cash, no card processing fee' : ''}</p>
<p style="margin:12px 0 0;font-size:13px;color:#4A4860">Whether they actually paid is not something the website can see — mark it on the vendor list in the admin.</p>`;
}

export function vendorEmailHtml(v, { totalCents, payUrl, settings }) {
  const byCheck = v.payment_method === 'check';
  return `<p>Hi ${escapeHtml(v.participant_names)},</p>
<p>Thank you for applying for a table at the Timothy Christmas Market on ${escapeHtml(settings.dateLabel)}, ${escapeHtml(settings.hoursLabel)}.</p>
<p>You asked for <strong>${v.tables} table${v.tables === 1 ? '' : 's'}</strong>, which comes to <strong>${escapeHtml(money(totalCents))}</strong>${byCheck ? '' : ' including the card processing fee'}.</p>
${byCheck
  ? `<p><strong>Please bring a check made out to Timothy Lutheran Church, or exact cash, on the day</strong> — Marla, our market coordinator, marks your table paid when it arrives.</p>`
  : (payUrl ? `<p><strong>Your space is held once payment arrives.</strong> If you closed the payment page before finishing, you can pay here: <a href="${escapeHtml(payUrl)}">${escapeHtml(money(totalCents))} for your table${v.tables === 1 ? '' : 's'}</a>.</p>` : '')}
<p>Marla will confirm your table number by email. ${byCheck ? 'If' : 'If you would rather pay by check or cash, or if'} you need to change anything, reply to this message or write to <a href="mailto:${escapeHtml(settings.coordinatorEmail)}">${escapeHtml(settings.coordinatorEmail)}</a>.</p>
<p>Doors open to vendors at 8:30 am. Please be set up by 10:30 and stay until the market closes at 6:00.</p>
<p>We are glad you are coming,<br>Timothy Lutheran Church</p>`;
}

// ── THE COORDINATOR'S LIST ───────────────────────────────────────────────────
// Returns a Response for the routes it owns, or null so the caller's route
// chain carries on — the same contract handleFilteredRoutes and handleGymRoutes
// use.
export async function handleMarketRoutes(request, env, path, method, currentUser, url, badges = {}) {
  if (path !== '/market' && !path.startsWith('/market/')) return null;

  // ⚠ THREE PERMISSIONS CAN REACH THIS SCREEN NOW, NOT JUST ONE. Every setting
  // that touches the market used to be scattered — the vendor list here, the
  // date/fee/etc. on Settings, the fund and payment method on Giving — because
  // each needed a different permission: the coordinator (market_manage) must
  // never see the church's financial account internals, and 'Office staff'
  // (settings_manage) and 'Bookkeeper' (giving_manage) are real presets that
  // hold neither of the other two. Consolidating everything onto one screen
  // cannot mean gating the whole screen on market_manage alone — that would
  // quietly take settings/payment editing away from anyone who has it today
  // but isn't the coordinator. So the PAGE is reachable by any of the three,
  // and each PANEL — and each mutating route below — checks its own.
//
  // ⚠ TWO MORE JOINED THEM when the screen became the event section: the
  // office person who writes the market's own pages (pages_edit) and whoever
  // keeps its photographs (ministries_edit). Same rule as the first three —
  // holding one of them opens the page and exactly one tab, never the others.
  const canMarket = hasPermission(currentUser, 'market_manage');
  const canSettings = hasPermission(currentUser, 'settings_manage');
  const canGiving = hasPermission(currentUser, 'giving_manage');
  const canPages = hasPermission(currentUser, 'pages_edit');
  const canPhotos = canPages || hasPermission(currentUser, 'ministries_edit');
  if (!canMarket && !canSettings && !canGiving && !canPages && !canPhotos) {
    return new Response('Access denied.', { status: 403 });
  }

  const settings = await marketSettings(env);

  // ── CSV, because the thing this replaced was a spreadsheet ──
  // Marla worked the 2024 market off a sheet, and a list she cannot sort,
  // total or hand to somebody else is a step backwards from that however good
  // the screen is.
  if (path === '/market/export.csv' && method === 'GET') {
    // Seventy vendors' home addresses and phone numbers, in one file — the
    // same PII the coordinator's own permission exists to scope down to.
    // Reaching the page via settings_manage or giving_manage must not be a
    // back door to it.
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const rows = await allApplications(env);
    // ⚠ A cell that starts = + - @ is a FORMULA to a spreadsheet, and this
    // file is opened in one by definition. Same guard as the payroll export
    // (PY-5), and applied only to text somebody TYPED — the figures below are
    // formatted by this file and a blanket guard would turn them into text
    // that stops summing.
    const t = (v) => {
      const s = String(v == null ? '' : v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const n = (v) => String(v == null ? '' : v);
    const head = ['Table #', 'Payment', 'Pay by', 'Participants', 'Business', 'Tables', 'Amount asked', 'Amount paid',
      'Email', 'Phone', 'Street', 'City', 'State', 'ZIP', 'Website or social', 'Returning',
      'What they sell', 'Food', 'Appliances / power', 'Special requests', 'Agreed as', 'Applied', 'Staff notes'];
    const body = rows.map((r) => [
      t(r.table_number), t(paymentLabel(r).label), t(r.payment_method === 'check' ? 'Check or cash' : 'Card, online'),
      t(r.participant_names), t(r.business_name),
      n(r.tables), n(((r.amount_due_cents || 0) / 100).toFixed(2)),
      r.amount_paid_cents == null ? '' : n((r.amount_paid_cents / 100).toFixed(2)),
      t(r.email), t(r.phone), t(r.street), t(r.city), t(r.state), t(r.zip),
      t(r.website_or_social), t(r.returning_vendor === 'yes' ? 'Returning' : r.returning_vendor === 'no' ? 'First year' : ''),
      t(r.product_description), t(r.sells_food ? 'Yes' : ''), t(r.appliances_power), t(r.special_requests),
      t(r.signature_name), t(r.created_at), t(r.staff_notes),
    ].join(',')).join('\r\n');
    return new Response([head.map(t).join(','), body].filter(Boolean).join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="christmas-market-vendors-${churchDate()}.csv"`,
      },
    });
  }

  if (path === '/market/update' && method === 'POST') {
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const id = Number(form.get('id') || 0);
    if (!id) return new Response('', { status: 302, headers: { Location: '/market' } });
    const before = await getRegistration(env, id);
    if (!before || before.event_id !== 'christmasmarket') return new Response('', { status: 302, headers: { Location: '/market?msg=gone' } });

    const status = paymentState(String(form.get('payment_status') || '')).value;
    const tableNumber = cap(form.get('table_number'), 40);
    const notes = cap(form.get('staff_notes'), 2000);
    // Blank means "we have not recorded a payment", which is a different fact
    // from "they paid nothing" — so it stays NULL rather than becoming 0.
    const paidRaw = trim(form.get('amount_paid'));
    const paidCents = paidRaw === '' ? null : Math.round(num(paidRaw, 0) * 100);

    await updateRegistration(env, id, {
      table_number: tableNumber || null, payment_status: status, amount_paid_cents: paidCents, staff_notes: notes || null,
    });
    await logAudit(env.DB, currentUser, 'update', 'market_vendor', String(id), before.contact_name,
      { table_number: before.table_number, payment_status: before.payment_status, amount_paid_cents: before.amount_paid_cents },
      { table_number: tableNumber || null, payment_status: status, amount_paid_cents: paidCents });
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent('Saved · written to the audit log') } });
  }

  if (path === '/market/delete' && method === 'POST') {
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const id = Number(form.get('id') || 0);
    const before = await getRegistration(env, id);
    if (before && before.event_id === 'christmasmarket') {
      await deleteRegistration(env, id);
      await logAudit(env.DB, currentUser, 'delete', 'market_vendor', String(id), before.contact_name, before, null);
    }
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent('Application deleted · it is in the audit log if you need it back') } });
  }

  if (path === '/market/applications' && method === 'POST') {
    // The coordinator's own toggle — deliberately still market_manage only,
    // not settings_manage. Whether the market is taking money is the one
    // decision that belongs to whoever runs the event day to day.
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    // A toggle posts a hidden 0 ahead of its checkbox, so `get` always returns
    // the 0 and reads as on. See the note on the giving handlers.
    const open = form.getAll('open').includes('1') ? 1 : 0;
    await env.DB.prepare("UPDATE site_events SET registration_open = ?, updated_at = datetime('now') WHERE id = 'christmasmarket'").bind(open).run();
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_applications_open', 'Vendor applications',
      { value: settings.open ? '1' : '0' }, { value: String(open) });
    return new Response('', {
      status: 302,
      headers: { Location: '/market?toast=' + encodeURIComponent(open === 1 ? 'Applications are open · the page can take payments' : 'Applications are closed · the page says so and takes nothing') },
    });
  }

  // The seven plain settings — day, hours, table fee, the two processor
  // figures, the coordinator's address — that used to live on the generic
  // Settings screen. Moved here so the coordinator's whole day-to-day picture
  // is one screen, gated `settings_manage` because they are still an
  // office/pastor decision, not the coordinator's — a stale bookmark to the
  // old /settings?edit=market_table_fee address still works (see the
  // Settings screen's SETTINGS_VIEW, which now points here instead of
  // opening its own drawer for these seven keys).
  // ⚠ ALL SEVEN NOW WRITE `site_events`, THE MARKET'S OWN ROW — not eleven
  // separate site_settings keys. Same fields, same permission, same address;
  // only the storage moved.
  if (path === '/market/settings' && method === 'POST') {
    if (!canSettings) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const dateLabel = cap(form.get('market_date_label'), 80);
    const hoursLabel = cap(form.get('market_hours_label'), 80);
    const tableFee = num(form.get('market_table_fee'), settings.tableFee);
    const maxTables = clampTables(form.get('market_max_tables'), 9);
    const feePercent = num(form.get('market_fee_percent'), settings.feePercent);
    const feeFixed = num(form.get('market_fee_fixed'), settings.feeFixed);
    const coordinatorEmail = cap(form.get('market_coordinator_email'), 200);

    const before = {
      market_date_label: settings.dateLabel, market_hours_label: settings.hoursLabel,
      market_table_fee: String(settings.tableFee), market_max_tables: String(settings.maxTables),
      market_fee_percent: String(settings.feePercent), market_fee_fixed: String(settings.feeFixed),
      market_coordinator_email: settings.coordinatorEmail,
    };
    const after = {
      market_date_label: dateLabel, market_hours_label: hoursLabel,
      market_table_fee: String(tableFee), market_max_tables: String(maxTables),
      market_fee_percent: String(feePercent), market_fee_fixed: String(feeFixed),
      market_coordinator_email: coordinatorEmail,
    };
    await env.DB.prepare(
      `UPDATE site_events SET date_label = ?, hours_label = ?, fee_amount = ?, max_qty = ?,
         fee_percent = ?, fee_fixed = ?, coordinator_email = ?, updated_at = datetime('now'), updated_by = ?
       WHERE id = 'christmasmarket'`
    ).bind(dateLabel, hoursLabel, tableFee, maxTables, feePercent, feeFixed, coordinatorEmail, currentUser?.username || null).run();
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_settings', 'Christmas Market settings', before, after);
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent('Saved · written to the audit log') } });
  }

  // ⚠ MOVED HERE FROM /giving/market-fund, verbatim in logic — only the
  // permission check and the redirect target changed. The fund still
  // REPLACES the base link's fund rather than adding a second (see
  // marketPayUrl()), it still takes knowing Tithe.ly's own account
  // internals, and it is still gated `giving_manage` rather than
  // `market_manage` for exactly that reason — the coordinator must never
  // need or be able to see the church's payment-account details. It moved
  // OFF the Giving screen and onto this one because that is where every
  // other market setting already lives, not because the permission changed.
  if (path === '/market/fund' && method === 'POST') {
    if (!canGiving) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const val = String(form.get('market_fund_id') || '').trim().slice(0, 200);
    await env.DB.prepare("UPDATE site_events SET fund_id = ?, updated_at = datetime('now') WHERE id = 'christmasmarket'").bind(val).run();
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_fund_id', 'Christmas Market fund',
      { value: settings.fundId }, { value: val });
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent('Saved · written to the audit log') } });
  }

  // ⚠ MOVED HERE FROM /giving/market-payment, same reasoning as the fund
  // route above — still `giving_manage`, still the office's own Square
  // account, just addressed under /market now.
  if (path === '/market/payment' && method === 'POST') {
    if (!canGiving) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const provider = form.get('market_payment_provider') === 'square' ? 'square' : 'tithely';
    const maxTables = clampTables(String(form.get('max_tables') || ''), 9);
    const links = {};
    for (let n = 1; n <= maxTables; n++) {
      const raw = String(form.get(`square_link_${n}`) || '').trim();
      if (!raw) continue;
      let proto = '';
      try { proto = new URL(raw).protocol; } catch (_) {}
      if (proto !== 'http:' && proto !== 'https:') {
        return new Response('', { status: 302, headers: { Location: '/market?msg=payment-error' } });
      }
      links[String(n)] = raw.slice(0, 500);
    }
    const linksJson = JSON.stringify(links);
    await env.DB.prepare(
      "UPDATE site_events SET payment_provider = ?, square_links = ?, updated_at = datetime('now') WHERE id = 'christmasmarket'"
    ).bind(provider, linksJson).run();
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_payment_provider', 'Christmas Market payment method',
      { provider: settings.paymentProvider, square_links: JSON.stringify(settings.squareLinks || {}) },
      { provider, square_links: linksJson });
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent('Saved · written to the audit log') } });
  }

  // The one thing the Photos tab writes. Uploading is deliberately NOT here —
  // see the tab itself for why there is one uploader on this site and not two.
  if (path === '/market/photo-alt' && method === 'POST') {
    if (!canPhotos) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const id = Number(form.get('id') || 0);
    const alt = cap(form.get('alt'), 300);
    const before = await env.DB.prepare('SELECT filename, alt FROM ministry_media WHERE id = ?').bind(id).first().catch(() => null);
    if (before) {
      await env.DB.prepare('UPDATE ministry_media SET alt = ? WHERE id = ?').bind(alt, id).run();
      await logAudit(env.DB, currentUser, 'update', 'media', String(id), before.filename || '', { alt: before.alt }, { alt });
    }
    return new Response('', { status: 302, headers: { Location: '/market?tab=photos&toast=' + encodeURIComponent('Saved \u00b7 written to the audit log') } });
  }

  if (path === '/market' && method === 'GET') {
    const msg = url.searchParams.get('msg');
    const cfg = sectionCfg('market');

    // ── FIVE TABS, ONE SCREEN ────────────────────────────────────────────
    // ⚠ A tab a reader cannot use is ABSENT, not disabled. A disabled tab
    // tells somebody the church has a screen they are not trusted with, which
    // is a worse thing to say than nothing — and the coordinator holding
    // market_manage alone genuinely has no business knowing the Tithe.ly fund
    // exists. Every tab still checks its own permission when it renders, and
    // every mutating route checks its own again: this list decides what is
    // DRAWN, never what is allowed.
    const TABS = [
      { key: 'vendors', label: 'Vendors', on: canMarket },
      { key: 'pages', label: 'Page & copy', on: canPages },
      { key: 'money', label: 'Money & dates', on: canSettings || canGiving },
      { key: 'volunteers', label: 'Volunteers', on: canMarket },
      { key: 'photos', label: 'Photos', on: canPhotos },
    ].filter((t) => t.on);
    // ⚠ The default is the first tab this reader can actually open, not a
    // hardcoded 'vendors' — otherwise the office person who only holds
    // pages_edit lands on an empty screen and concludes the tab is broken.
    const wanted = String(url.searchParams.get('tab') || '');
    const active = (TABS.find((t) => t.key === wanted) || TABS[0] || { key: '' }).key;
    const tabNav = TABS.length > 1 ? `<nav class="tlc-tabs" aria-label="Christmas Market">${TABS.map((t) =>
      `<a class="tlc-tab${t.key === active ? ' is-on' : ''}" href="/market?tab=${t.key}"${t.key === active ? ' aria-current="page"' : ''}>${escapeHtml(t.label)}</a>`
    ).join('')}</nav>` : '';

    // ── EVERYTHING BELOW IS canMarket ONLY. Somebody who reached this page on
    // settings_manage or giving_manage alone gets none of it — not the
    // vendor list, not the applications toggle, not even the counts, all of
    // which are the coordinator's own PII-adjacent view of the event. The
    // ⚠ above the permission gate is the reasoning; this is where it is
    // actually enforced for the read side.
    let vendorSection = '';
    let vendorDrawer = '';
    let alertHtml = '';
    // ⚠ Only the ACTIVE tab is built. Rendering all five and hiding four would
    // read every vendor's home address, every page's blocks and the volunteer
    // roster on every single view of this screen, to throw four fifths of it
    // away — and it would put PII in the markup of a tab somebody opened for
    // photographs.
    if (active === 'vendors' && canMarket) {
      const rows = await allApplications(env);
      const editId = Number(url.searchParams.get('edit') || 0);
      const editing = editId ? rows.find((r) => r.id === editId) : null;

      const counts = {
        tables: rows.filter((r) => r.payment_status !== 'dropped').reduce((a, r) => a + (r.tables || 0), 0),
        unpaid: rows.filter((r) => r.payment_status === 'unpaid').length,
        collectedCents: rows.reduce((a, r) => a + (r.amount_paid_cents || 0), 0),
      };

      const listRows = rows.map((r) => {
        const st = paymentState(r.payment_status);
        const sells = String(r.product_description || '').replace(/\s+/g, ' ').trim();
        return {
          href: `/market?edit=${r.id}`,
          filter: st.value,
          search: `${r.participant_names || ''} ${r.business_name || ''} ${r.email || ''} ${r.product_description || ''} ${r.table_number || ''}`.toLowerCase(),
          cells: [
            primaryCell(r.business_name || r.participant_names,
              [r.business_name ? r.participant_names : '', r.email].filter(Boolean).join(' · ')),
            `<span title="${escapeHtml(sells)}">${escapeHtml(sells.length > 80 ? sells.slice(0, 79) + '…' : sells)}</span>`
              + (r.sells_food ? ' <strong>· food</strong>' : ''),
            `${r.tables}${r.table_number ? ` <span style="color:var(--tlc-muted);">· #${escapeHtml(r.table_number)}</span>` : ''}`,
            // ⚠ The FILTER above still keys on the real four-state value —
            // only the label shown here is relabeled for a check-paying
            // vendor. Filtering by the display label would need a fifth
            // filter pill for a state that does not actually exist.
            statusPill(paymentLabel(r).tone, paymentLabel(r).label),
          ],
          actions: rowActions({ label: 'Open', href: `/market?edit=${r.id}` }),
          // Somebody who applied and never finished at the card page is the
          // one thing this screen exists to surface — the old workflow could
          // not see them at all, because an abandoned Google Form left no row
          // anywhere.
          warn: r.payment_status === 'unpaid'
            ? `No payment recorded. They were asked for ${money(r.amount_due_cents)} — their space is not held until it arrives.`
            : '',
          warnCta: r.payment_status === 'unpaid' ? { label: 'Record it', href: `/market?edit=${r.id}` } : null,
        };
      });

      const openPanel = panel('Applications', `
        <form method="POST" action="/market/applications" style="margin:0;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <input type="hidden" name="open" value="0">
          <label class="tlc-toggle">
            <input type="checkbox" name="open" value="1"${settings.open ? ' checked' : ''}>
            <span class="tlc-toggle-track"><span class="tlc-toggle-knob"></span></span>
            <span class="tlc-toggle-label">Taking vendor applications</span>
            <span class="tlc-toggle-state" data-on="Open" data-off="Closed">${settings.open ? 'Open' : 'Closed'}</span>
          </label>
          <button type="submit" class="tlc-btn-primary">Save</button>
        </form>
        <p class="tlc-hint" style="margin-top:12px;">Switched off, the vendor page still explains the market and still lists the coordinator's address — it just stops taking applications and stops asking anybody for money. Nothing already submitted is affected.</p>
        <p class="tlc-hint" style="margin-top:8px;">${(() => {
          const priced = `${escapeHtml(money(priceBreakdown(1, settings).totalCents))} for one table, ${escapeHtml(money(priceBreakdown(settings.maxTables, settings).totalCents))} for ${settings.maxTables}.`;
          if (settings.paymentProvider === 'square') {
            const have = Array.from({ length: settings.maxTables }, (_, i) => i + 1)
              .filter((n) => (settings.squareLinks || {})[String(n)]).length;
            return have >= settings.maxTables
              ? `Payments go through Square. ${priced}`
              : `Payments go through Square, but only ${have} of ${settings.maxTables} table counts have a link set — see Payment below.`;
          }
          return settings.giveUrl
            ? `Payments open at the church's own giving link with the amount filled in. ${priced}`
            : 'No giving link is set, so the page will take applications but cannot open a payment. Set it below, under Payment.';
        })()}</p>
      `, canSettings || canGiving ? { right: '<a class="tlc-action-quiet" href="/market?tab=money">Fees, dates &amp; payment</a>' } : {});

      const tile = (label, n, note) =>
        `<div class="tlc-tile"><div class="tlc-tile-label">${escapeHtml(label)}</div>`
        + `<div class="tlc-tile-num">${escapeHtml(String(n))}</div>`
        + `<div class="tlc-tile-note">${escapeHtml(note)}</div></div>`;
      const headerExtra = `<div class="tlc-tiles">
        ${tile('Applications', rows.length, 'Every vendor who has applied')}
        ${tile('Tables asked for', counts.tables, 'Dropped-out vendors excluded')}
        ${tile('Not paid yet', counts.unpaid, 'Spaces that are not held')}
        ${tile('Recorded as paid', money(counts.collectedCents), 'What you have marked, not what the processor says')}
      </div>${openPanel}`;

      alertHtml = msg === 'gone' ? `<div class="alert alert-warn">That application is no longer there — somebody may have deleted it.</div>` : '';

      vendorSection = renderListSection({
        key: 'market',
        title: cfg.title,
        purpose: cfg.purpose,
        action: { label: cfg.action, href: '/market/export.csv' },
        search: cfg.search,
        filters: filtersOf('market'),
        columns: columnsOf('market'),
        rows: listRows,
        headerExtra,
        noun: 'application',
        empty: 'No vendor applications yet.',
        emptyHelp: settings.open
          ? 'The vendor page is open and waiting — applications land here as they arrive.'
          : 'Applications are switched off, so the page is not taking any. Turn them on above.',
        note: cfg.note,
      });

      vendorDrawer = editing ? renderDrawer({
        key: 'market-vendor',
        title: editing.business_name || editing.participant_names,
        sub: `Applied ${escapeHtml(String(editing.created_at || '').slice(0, 10))} · asked for ${escapeHtml(money(editing.amount_due_cents))}`,
        action: '/market/update',
        cancelHref: '/market',
        deleteAction: '/market/delete',
        deleteConfirm: 'Delete this application? The vendor is not told, and nothing is refunded.',
        fields: [
          { kind: 'html', html: `<input type="hidden" name="id" value="${editing.id}">` },
          { name: 'table_number', label: 'Table number', value: editing.table_number || '',
            placeholder: 'e.g. 19 or 19/20',
            hint: 'Free text on purpose — a two-table vendor takes a range, and that is how the floor plan is written.' },
          { kind: 'static', label: 'Paying by',
            value: editing.payment_method === 'check' ? 'Check or cash' : 'Card, online',
            hint: editing.payment_method === 'check'
              ? 'They asked for the flat table fee — no card processing fee is included.'
              : (editing.square_order_id ? 'Marked paid automatically once Square confirms this exact order.' : '') },
          { kind: 'choice', name: 'payment_status', label: 'Payment', value: editing.payment_status || 'unpaid',
            options: PAYMENT_STATES.map((s) => ({ value: s.value, label: s.label })),
            hint: 'The website cannot see whether a card actually went through — this is your record, not the processor’s.' },
          { name: 'amount_paid', label: 'Amount paid', type: 'text',
            value: editing.amount_paid_cents == null ? '' : (editing.amount_paid_cents / 100).toFixed(2),
            placeholder: (editing.amount_due_cents / 100).toFixed(2),
            hint: 'Leave blank if you have not checked yet. Blank is not the same as zero.' },
          { kind: 'textarea', name: 'staff_notes', label: 'Your notes', value: editing.staff_notes || '', rows: 3,
            hint: 'Only ever seen here. The vendor is not shown this.' },
          { kind: 'static', label: 'What they sell', html: `<span style="white-space:pre-wrap">${escapeHtml(editing.product_description || '')}</span>` },
          ...(editing.sells_food ? [{ kind: 'static', label: 'Food or drink', html: 'Yes — health department requirements are theirs, and they are expecting to hear from you.' }] : []),
          ...(editing.appliances_power ? [{ kind: 'static', label: 'Appliances / power', value: editing.appliances_power }] : []),
          ...(editing.special_requests ? [{ kind: 'static', label: 'Special requests', html: `<span style="white-space:pre-wrap">${escapeHtml(editing.special_requests)}</span>` }] : []),
          { kind: 'static', label: 'Contact', html:
            `${escapeHtml(editing.participant_names)}<br>`
            + `<a href="mailto:${escapeHtml(editing.email)}">${escapeHtml(editing.email)}</a><br>`
            + `${escapeHtml(editing.phone || '')}`
            + (editing.website_or_social ? `<br>${escapeHtml(editing.website_or_social)}` : '')
            + ([editing.street, [editing.city, editing.state].filter(Boolean).join(', '), editing.zip].filter(Boolean).length
                ? `<br>${escapeHtml([editing.street, [editing.city, editing.state].filter(Boolean).join(', '), editing.zip].filter(Boolean).join(' · '))}` : '') },
          { kind: 'static', label: 'Sold with us before',
            value: editing.returning_vendor === 'yes' ? 'Returning vendor' : editing.returning_vendor === 'no' ? 'First year' : 'Did not say' },
          ...(photosOf(editing).length ? [{ kind: 'static', label: 'Sample photos', html: photosOf(editing)
            .map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener"><img src="${escapeHtml(u)}" alt="" style="height:72px;width:auto;border-radius:8px;margin:0 8px 8px 0;"></a>`).join('') }] : []),
          { kind: 'static', label: 'Agreed to the vendor terms as', value: editing.signature_name || '' },
        ],
      }) : '';
    }

    // ── MARKET SETTINGS — the seven plain fields, settings_manage only.
    // Consolidated here at Andrew's own request, after finding "Most tables
    // one vendor may take" tucked into the generic Settings screen with no
    // link from here pointing at it.
    const settingsPanel = (active === 'money' && canSettings) ? panel('Market settings', `
      <form method="POST" action="/market/settings">
        ${renderField({ name: 'market_date_label', label: 'Market day', value: settings.dateLabel,
          hint: 'Written the way it should read on the page — this is printed, not parsed.' })}
        ${renderField({ name: 'market_hours_label', label: 'Market hours', value: settings.hoursLabel,
          hint: 'Also printed as written.' })}
        ${renderField({ kind: 'number', name: 'market_table_fee', label: 'Table fee ($)', value: settings.tableFee, min: 0, step: 1,
          hint: 'What one 8-foot table costs a vendor. The vendor is asked for this plus the card fee, so the market receives this figure whole.' })}
        ${renderField({ kind: 'number', name: 'market_max_tables', label: 'Most tables one vendor may take', value: settings.maxTables, min: 1, max: 9, step: 1,
          hint: 'The vendor page offers this many buttons, and refuses anything larger however it arrives.' })}
        ${renderField({ kind: 'number', name: 'market_fee_percent', label: 'Card processing fee (%)', value: settings.feePercent, min: 0, step: 0.1,
          hint: 'The percentage the card processor takes. Change this and the fixed charge below together if the church switches processors — nothing else needs editing.' })}
        ${renderField({ kind: 'number', name: 'market_fee_fixed', label: 'Card processing fee (fixed, $)', value: settings.feeFixed, min: 0, step: 0.01,
          hint: 'The per-transaction charge on top of the percentage.' })}
        ${renderField({ name: 'market_coordinator_email', label: 'Coordinator email', value: settings.coordinatorEmail,
          hint: 'Where a vendor application is sent, and the address printed on the vendor page for anything the form cannot handle.' })}
        <div class="btn-row" style="margin-top:4px;"><button type="submit" class="tlc-btn-primary">Save</button></div>
      </form>
    `) : '';

    // ── PAYMENT — the fund and the processor choice, giving_manage only.
    // Moved here verbatim from the Giving screen (see /market/fund and
    // /market/payment above) — same forms, same fields, addressed under
    // /market now because that is where the rest of the market already is.
    const paymentPanel = (active === 'money' && canGiving) ? panel('Payment', `
      <form method="POST" action="/market/fund">
        ${renderField({ name: 'market_fund_id', label: 'Tithe.ly fund ID', value: settings.fundId,
          placeholder: "Blank uses the base link's fund",
          hint: "Which fund a vendor's table payment lands in when the market runs on Tithe.ly. It REPLACES the base giving link's fund rather than adding a second — get it the same way as any fund's ID: generate a link for that fund from Tithe.ly and copy the fundId value out of it. Leave it blank and market payments use whatever fund the Base Tithe.ly Link already carries." })}
        <div class="btn-row" style="margin-top:4px;"><button type="submit" class="tlc-btn-primary">Save</button></div>
      </form>
      <form method="POST" action="/market/payment" style="margin-top:20px;">
        <input type="hidden" name="max_tables" value="${escapeHtml(String(settings.maxTables))}">
        ${renderField({ kind: 'chips', name: 'market_payment_provider', label: 'Payment provider', value: settings.paymentProvider,
          options: [{ value: 'tithely', label: 'Tithe.ly (uses the fund above)' }, { value: 'square', label: 'Square' }],
          hint: "The market runs on its own, separate Square account rather than Tithe.ly. Unlike the fund above, Square has no way to put an amount in a link — a vendor only ever picks 1 to " + settings.maxTables + " table" + (settings.maxTables === 1 ? '' : 's') + ", so paste one Square Payment Link per table count below, each set to the exact grossed-up price shown." })}
        ${Array.from({ length: settings.maxTables }, (_, i) => i + 1).map((n) => renderField({
          name: `square_link_${n}`, label: `Square link — ${n} table${n === 1 ? '' : 's'} (${escapeHtml(money(priceBreakdown(n, settings).totalCents))})`,
          value: (settings.squareLinks || {})[String(n)] || '', placeholder: 'https://square.link/u/…',
        })).join('')}
        <div class="btn-row" style="margin-top:4px;"><button type="submit" class="tlc-btn-primary">Save</button></div>
      </form>
    `) : '';

    // ── PAGE & COPY ──────────────────────────────────────────────────────
    // Everything a visitor reads on the market's pages is a block field, so
    // this tab's job is to get somebody INTO the page editor with the state of
    // each page already answered — not to be a second editor.
    //
    // ⚠ NO REORDERING HERE, and that is a deliberate departure from the
    // handoff's "drag-to-reorder section list". Blocks are arranged in one
    // place, the page editor, where the canvas shows what the arrangement
    // actually looks like. A second surface that writes the same `blocks`
    // column is the exact trap this repo has warned about since the
    // Foundations pass — two forms disagreeing about one record. The list
    // below is a read-only table of contents, which is the half that answers
    // "what is on this page" without inviting somebody to rearrange it blind.
    let pagesSection = '';
    if (active === 'pages' && canPages) {
      const ids = ['christmasmarket', 'marketvendors', 'marketvendorsapply'];
      const rows = [];
      for (const id of ids) {
        const r = await env.DB.prepare(
          'SELECT id, title, slug, status, blocks, published_blocks, updated_at, updated_by FROM pages WHERE id = ?'
        ).bind(id).first().catch(() => null);
        if (r) rows.push(r);
      }
      const cards = rows.map((r) => {
        const draft = String(r.blocks || '');
        const live = String(r.published_blocks || '');
        const published = !!live;
        const pending = published && draft !== live;
        const state = !published
          ? statusPill('warn', 'Never published')
          : pending ? statusPill('warn', 'Unpublished edits') : statusPill('good', 'Live');
        let sections = [];
        try {
          sections = (JSON.parse(draft) || []).filter((b) => b && (b.title || b.eyebrow))
            .map((b) => String(b.title || b.eyebrow));
        } catch (_) { sections = []; }
        const banner = pending
          ? `<div class="alert alert-warn" style="margin:0 0 14px;">This page has edits that nobody has published. A visitor is still seeing the version before them — open the editor, read the draft against the live page, and press Publish.</div>`
          : (!published
            ? `<div class="alert alert-warn" style="margin:0 0 14px;">Nothing has ever been published from this page's blocks, so what a visitor sees is not what is in the editor.</div>`
            : '');
        return panel(r.title || r.id, `
          ${banner}
          <p class="tlc-hint" style="margin:0 0 12px;"><code>${escapeHtml(r.slug || '')}</code>${
            r.updated_at ? ` · last saved ${escapeHtml(String(r.updated_at).slice(0, 10))}${r.updated_by ? ' by ' + escapeHtml(r.updated_by) : ''}` : ''}</p>
          <div class="btn-row" style="margin:0 0 14px;">
            <a class="tlc-btn-primary" href="/pages/${escapeHtml(r.id)}/edit">Edit the page</a>
            <a class="tlc-action-quiet" href="https://timothystl.org${escapeHtml(r.slug || '')}" target="_blank" rel="noopener">View it live</a>
            ${published ? `<a class="tlc-action-quiet" href="/pages/${escapeHtml(r.id)}/edit#publish">Compare &amp; publish</a>` : ''}
          </div>
          <p class="tlc-hint" style="margin:0 0 6px;"><strong>What is on it</strong> — in page order. Rearranging happens in the editor, where you can see it.</p>
          ${sections.length
            ? `<ol class="tlc-hint" style="margin:0;padding-left:20px;">${sections.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>`
            : `<p class="tlc-hint" style="margin:0;">Nothing on this page carries a heading yet.</p>`}
        `, { right: state });
      }).join('');
      pagesSection = `<header class="tlc-section-head">
          <div class="tlc-section-headings">
            <h1 class="tlc-title">Page &amp; copy</h1>
            <p class="tlc-purpose">The market's own pages. Every word a visitor reads on them is a field in the page editor — nothing about the market is typed into code.</p>
          </div>
        </header>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;">${cards}</div>`
        + (rows.length ? '' : `<p class="tlc-hint">The market's pages are not in the database yet — they arrive with the next deploy's migration.</p>`);
    }

    // ── VOLUNTEERS ───────────────────────────────────────────────────────
    // ⚠ NOT UNAUTHENTICATED — this reads names AND email addresses, so ChMS
    // requires the same shared secret every other cross-Worker call to it
    // already uses (see `getChmsFundSuggestions` in the Giving tab). Shifts
    // live in Serve (serve.timothystl.org), a different application with its
    // own accounts; this is a server-to-server GET of a summary it publishes,
    // so the coordinator can see who is covering the market without a second
    // login. Nothing here writes back, and nothing should: two places editing
    // one roster is two rosters.
    let volunteersSection = '';
    if (active === 'volunteers' && canMarket) {
      let vol = null;
      let volError = '';
      const intakeKey = env.CHMS_INTAKE_API_KEY || '';
      if (!intakeKey) {
        // A request Serve would only 401 anyway is not worth making — and
        // "CHMS_INTAKE_API_KEY is not set" is a clearer thing to tell whoever
        // opens this screen than a bare "Serve answered 401."
        volError = 'CHMS_INTAKE_API_KEY is not set on this Worker.';
      } else {
        try {
          // ⚠ A TIMEOUT, because this is another application on another host
          // and an admin screen must not sit waiting on one. Four seconds and
          // the tab renders its own honest empty state instead.
          // ⚠ Bypassing Cloudflare's edge cache for this subrequest is load-bearing,
          // not defensive boilerplate — see the class comment above. An external
          // curl to this exact URL with this exact key returned 200 with real data
          // while this live subrequest kept getting Serve's own generic 404 fallback,
          // because the two requests land at different Cloudflare colos and a colo
          // that saw a 404 before the route existed could keep serving it forever.
          // Serve's own responses now carry Cache-Control: no-store too, which is
          // the real, permanent fix — this is belt-and-braces on our side.
          // ⚠ The FETCH STANDARD's `cache` field (`cache: 'no-store'`) is NOT
          // implemented by Cloudflare Workers' fetch() and throws a TypeError the
          // instant it's present in the RequestInit — confirmed live ("The 'cache'
          // field on 'RequestInitializerDict' is not implemented"), which is worse
          // than the caching bug it was meant to fix. The Workers-native mechanism
          // is the `cf` object: `cacheTtl: 0` tells Cloudflare's edge not to cache
          // this particular subrequest's response at all. Do not reintroduce the
          // standard `cache` field here.
          const res = await fetch('https://serve.timothystl.org/api/signups/christmasmarket/summary',
            { headers: { Accept: 'application/json', 'X-Intake-Key': intakeKey },
              cf: { cacheTtl: 0, cacheEverything: false },
              signal: AbortSignal.timeout(4000) });
          if (res.ok) vol = await res.json();
          else {
            // Live diagnostic: the status alone hasn't been enough to explain
            // a persistent "404" here that no external reproduction (same
            // key, same URL) has matched — capture what Serve actually sent
            // back, since this screen is already gated on canMarket and
            // nothing here is shown to a visitor.
            let bodySnippet = '';
            let ct = '';
            try {
              ct = res.headers.get('content-type') || '';
              const cfRay = res.headers.get('cf-ray') || '';
              const text = await res.text();
              bodySnippet = (text || '').slice(0, 300);
              volError = `Serve answered ${res.status} (${ct || 'no content-type'}` +
                (cfRay ? `, cf-ray ${cfRay}` : '') + `): ${bodySnippet || '(empty body)'}`;
            } catch (readErr) {
              volError = `Serve answered ${res.status}, and the body could not be read: ${readErr.message || readErr}`;
            }
          }
        } catch (e) { volError = `Serve could not be reached: ${e.message || e}`; }
      }
      // ⚠ And an answer that is not the shape this expects is not an answer.
      // Something else on that host answering 200 with a page, or a proxy
      // returning its own JSON, would otherwise draw four tiles of zeros and
      // call them the roster.
      if (vol && !Array.isArray(vol.roles)) { vol = null; volError = volError || 'Serve answered with something this screen could not read.'; }

      const roles = Array.isArray(vol?.roles) ? vol.roles : [];
      // ⚠ Most short-handed first. A roster sorted by name is a list; sorted by
      // what is missing, it is a worklist — which is the only reason the
      // coordinator opens it.
      const shortOf = (r) => (r.shifts || []).reduce((a, sh) =>
        a + Math.max(0, (Number(sh.needed) || 0) - (Number(sh.filled) || 0)), 0);
      const sorted = roles.slice().sort((a, b) => shortOf(b) - shortOf(a));

      const tile = (label, n, note) =>
        `<div class="tlc-tile"><div class="tlc-tile-label">${escapeHtml(label)}</div>`
        + `<div class="tlc-tile-num">${escapeHtml(String(n))}</div>`
        + `<div class="tlc-tile-note">${escapeHtml(note)}</div></div>`;

      const rolePanels = sorted.map((r) => {
        const shifts = Array.isArray(r.shifts) ? r.shifts : [];
        const rows = shifts.map((sh) => {
          const needed = Number(sh.needed) || 0;
          const filled = Number(sh.filled) || 0;
          const people = Array.isArray(sh.people) ? sh.people : [];
          const who = people.length
            ? people.map((pp) => pp && pp.email
              ? `<a href="mailto:${escapeHtml(pp.email)}">${escapeHtml(pp.name || pp.email)}</a>`
              : escapeHtml((pp && pp.name) || '')).filter(Boolean).join(', ')
            // ⚠ An empty shift says so in words. A blank cell reads as data
            // that failed to load, which is the one thing it must not be
            // confused with on a screen that can also fail to load.
            : '<span class="tlc-hint">Nobody yet — this shift is entirely open.</span>';
          return `<tr><td style="padding:6px 12px 6px 0;">${escapeHtml(sh.label || '')}</td>`
            + `<td style="padding:6px 12px 6px 0;white-space:nowrap;">${filled} of ${needed}</td>`
            + `<td style="padding:6px 0;">${who}</td></tr>`;
        }).join('');
        const short = shortOf(r);
        return panel(r.name || 'Role', `
          <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows
            || '<tr><td class="tlc-hint">No shifts are set up for this role yet.</td></tr>'}</table>
        `, {
          right: (short > 0 ? statusPill('warn', short + ' still needed') : statusPill('good', 'Full'))
            + ` <a class="tlc-action-quiet" href="https://serve.timothystl.org/christmasmarket" target="_blank" rel="noopener">Manage shifts in Serve</a>`,
        });
      }).join('');

      // ⚠ A failure here is NOT an error state for this screen. Serve being
      // down, or this endpoint not existing yet, must not stop the coordinator
      // opening the tab — so it degrades to the one thing that always
      // works, a link to the app that owns the roster.
      volunteersSection = `<header class="tlc-section-head">
          <div class="tlc-section-headings">
            <h1 class="tlc-title">Volunteers</h1>
            <p class="tlc-purpose">Who is covering the market, read from Serve. Shifts are set up and changed there — this is a window on them, not a second copy.</p>
          </div>
          <div class="tlc-section-actions"><a class="tlc-btn-primary" href="https://serve.timothystl.org/christmasmarket" target="_blank" rel="noopener">Manage shifts in Serve</a></div>
        </header>`
        + (vol
          ? `<div class="tlc-tiles">
              ${tile('Signed up', vol.signedUp ?? 0, 'People who have taken a shift')}
              ${tile('Open shifts', vol.openShifts ?? 0, 'Still to be covered')}
              ${tile('Roles', roles.length, 'Jobs the market needs')}
              ${tile('Sign-ups', vol.open ? 'Open' : 'Closed', vol.open ? 'Serve is taking volunteers' : 'Serve is not taking volunteers')}
            </div>
            ${rolePanels || `<p class="tlc-hint">Serve has no roles for the market yet. Set them up there and they appear here.</p>`}`
          : `<div class="alert alert-warn">Counts are not available right now — ${escapeHtml(volError || 'Serve did not answer.')} Nothing is wrong with the market itself; the roster lives in Serve and is still there, behind the button above.</div>`);
    }

    // ── PHOTOS ───────────────────────────────────────────────────────────
    // ⚠ NO SECOND UPLOADER. Every image on this site arrives through one path
    // (/api/upload-image, from the page editor's own picker) and is catalogd
    // in one table, which is what makes "used nowhere" and the size warnings
    // on the Media screen true. A second upload form here would be a second
    // record of the same photograph. What this tab adds is the one thing the
    // library cannot do — show only the market's photographs, and let the
    // description be fixed without hunting for them among two hundred others.
    let photosSection = '';
    if (active === 'photos' && canPhotos) {
      const all = (await env.DB.prepare(
        "SELECT id, filename, kind, url, thumb_url, alt FROM ministry_media ORDER BY id DESC LIMIT 400"
      ).all().catch(() => ({ results: [] }))).results || [];
      const isMarket = (m) => /christmasmarket|christmas-m|weihnacht|market/i.test(`${m.url || ''} ${m.filename || ''}`);
      const mine = all.filter(isMarket);
      const cards = mine.map((m) => `
        <div class="tlc-card" style="padding:14px;">
          ${m.kind === 'video'
            ? `<p class="tlc-hint" style="margin:0 0 8px;">Video</p>`
            : `<img src="${escapeHtml(m.thumb_url || m.url)}" alt="${escapeHtml(m.alt || '')}" style="width:100%;height:150px;object-fit:cover;border-radius:8px;background:var(--tlc-linen);">`}
          <p class="tlc-hint" style="margin:8px 0;word-break:break-all;">${escapeHtml(m.filename || '')}</p>
          <form method="POST" action="/market/photo-alt" style="margin:0;">
            <input type="hidden" name="id" value="${m.id}">
            ${renderField({ name: 'alt', label: 'What is in the photo', value: m.alt || '',
              placeholder: 'Somebody reading this instead of seeing it',
              hint: m.alt ? '' : 'This one has no description, so a visitor using a screen reader is told nothing about it.' })}
            <div class="btn-row" style="margin-top:4px;"><button type="submit" class="tlc-btn-primary">Save</button></div>
          </form>
        </div>`).join('');
      photosSection = `<header class="tlc-section-head">
          <div class="tlc-section-headings">
            <h1 class="tlc-title">Photos</h1>
            <p class="tlc-purpose">The market's photographs, and what each one says to somebody who cannot see it.</p>
          </div>
        </header>
        <p class="tlc-hint" style="margin:0 0 16px;">Photographs are added in the page editor, by dropping one onto a gallery or a banner — they land in the library and appear here. Store them under <code>/images/events/christmasmarket/</code> so they stay together.</p>
        ${mine.length
          ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">${cards}</div>`
          : `<p class="tlc-hint">No market photographs in the library yet. Add one from the <a href="/pages/christmasmarket/edit">market page editor</a> and it shows up here.</p>`}
        <p class="tlc-hint" style="margin-top:20px;">Every photograph on the site, market or not, is on the <a href="/media">Media screen</a>.</p>`;
    }

    const configSection = (settingsPanel || paymentPanel)
      ? `<div id="market-config" style="margin-top:24px;display:grid;grid-template-columns:${settingsPanel && paymentPanel ? '1fr 1fr' : '1fr'};gap:20px;">
          ${settingsPanel}${paymentPanel}
        </div>`
      : '';

    // A visitor with no market_manage sees no vendor list at all — the
    // config panels need SOME header, since renderListSection normally
    // supplies it, so a bare one stands in for exactly that case.
    const bareHeader = active === 'money' ? `<header class="tlc-section-head">
        <div class="tlc-section-headings">
          <h1 class="tlc-title">Money &amp; dates</h1>
          <p class="tlc-purpose">What the market costs a vendor, when it runs, and where the money lands. Changed here once a year, and every page reads it from here.</p>
        </div>
      </header>` : '';

    return html(`
${sidebarShell('market', currentUser, `<a href="https://timothystl.org/christmasmarket/vendors" target="_blank">View the vendor page</a>`, badges)}
<div class="tlc-wrap">
  ${tabNav}
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${bareHeader}
  ${vendorSection}
  ${vendorDrawer}
  ${configSection}
  ${pagesSection}
  ${volunteersSection}
  ${photosSection}
</div>`, 'Christmas Market');
  }

  return null;
}

async function allApplications(env) {
  try {
    return (await listRegistrations(env, 'christmasmarket')).map(marketRowFromRegistration);
  } catch (_) { return []; }
}

export function photosOf(r) {
  try {
    const list = JSON.parse(r.photos || '[]');
    return Array.isArray(list) ? list.filter((u) => typeof u === 'string' && u) : [];
  } catch (_) { return []; }
}
