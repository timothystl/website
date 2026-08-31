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
import { statusPill, panel, renderField, TONES } from './ui.js';
import { section as sectionCfg } from './sections.js';
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
// exactly like the old `market_vendors` row, so every renderer and the CSV
// export did not need to change — they still read `row.business_name`,
// `row.product_description`, and so on, on an object built fresh from the new
// table instead of read straight off the old one.
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
    // ── THE THREE THE COORDINATOR SETS, NOT THE VENDOR ──────────────────
    // `category`, `check_no` and `check_date` are absent on every row that
    // existed before this shipped, and on every row a vendor has just
    // submitted — nothing on the public application asks for any of them.
    // They live in the same `fields_json` blob for the same reason
    // everything else does: the generic registration table means a field
    // like this needs no schema change to exist. An absent one reads as ''
    // and renders exactly as it did before this feature.
    category: cleanCategory(f.category),
    check_no: String(f.check_no || ''),
    check_date: String(f.check_date || ''),
    amount_due_cents: reg.amount_due_cents || 0,
    table_number: reg.table_number || '',
    payment_status: reg.payment_status || 'unpaid',
    amount_paid_cents: reg.amount_paid_cents,
    square_order_id: reg.square_order_id || '',
    staff_notes: reg.staff_notes || '',
    created_at: reg.created_at,
    // A soft reserve — see marketInsertArgs() and capacityDecision() in
    // admin/events.js. Confirming a row (below) clears this, exactly the
    // action that turns it back into an ordinary paying application.
    waitlisted: !!reg.waitlisted,
  };
}

// ── CATEGORY ─────────────────────────────────────────────────────────────────
// A fixed list, not free text, and that is the whole point of it. What a
// vendor writes in "what do you sell" is a paragraph — it sorts by whichever
// word it happens to begin with, so the list could never answer "how many
// bakers have we got" or "are the candle people all together". The
// coordinator picks one per vendor from this list.
//
// ⚠ 'Other' is the fallback and must stay last: an unrecognized stored value
// (a list edited between deploys, a hand-typed POST) lands there rather than
// reaching the page unchecked, the same rule every `choices` field in the
// block editor follows.
export const VENDOR_CATEGORIES = [
  'Baked goods', 'Candles & soap', 'Jewelry', 'Wood', 'Textiles',
  'Ornaments', 'Food & drink', 'Art & prints', 'Wreaths & greens', 'Ministry', 'Other',
];

// Blank stays blank — "not categorized yet" is a real state, and defaulting
// it to 'Other' would quietly claim somebody had looked at every row.
export function cleanCategory(v) {
  const s = trim(v);
  if (!s) return '';
  return VENDOR_CATEGORIES.includes(s) ? s : 'Other';
}

// ── WHERE A CHECK HAS GOT TO ─────────────────────────────────────────────────
// Three states, and only the middle one is new information. Before this, a
// vendor who chose "pay by check" and a vendor who simply never paid looked
// identical on the list — both said unpaid — so the coordinator had no way to
// tell the person she is waiting on the post for from the person she has to
// chase.
//
// ⚠ Still no fifth `payment_status`. This is derived, every time, from the
// payment method and whether a check has been recorded; nothing stores it.
export function checkState(row) {
  if (row.payment_method !== 'check') return { paying: 'card', received: false, pending: false };
  const received = !!(row.check_no || row.check_date);
  return {
    paying: 'check',
    received,
    // A vendor who dropped out or had the fee waived is not somebody the
    // coordinator is waiting on a check from, whatever the payment method
    // says — leaving them on the chase list is how a reconciliation reads
    // short forever.
    pending: !received && row.payment_status !== 'dropped' && row.payment_status !== 'waived',
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
export function marketInsertArgs(value, price, photos, { waitlisted = false } = {}) {
  return {
    event_id: 'christmasmarket',
    qty: value.tables,
    payment_status: 'unpaid',
    amount_due_cents: value.payment_method === 'check' ? price.subtotalCents : price.totalCents,
    // A soft-reserved table is exactly what `waitlisted` already means on
    // every other event's registrations — no payment link was offered, and
    // it does not count against the confirmed-tables pause (see
    // capacityDecision() in admin/events.js) until the coordinator confirms
    // it by hand, which is the same action that turns it back into an
    // ordinary paying row.
    waitlisted,
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

// ── WHAT A ROW LOOKS LIKE AFTER A CELL SAVES ─────────────────────────────────
// The presentational state of the four cells that can change under each
// other: the payment pill, the money line beneath it, and the check column,
// which appears and disappears depending on both.
//
// ⚠ ONE FUNCTION, READ BY BOTH SIDES. The server renders the table from this
// and `/market/update` answers with it, so a cell that has just saved is
// redrawn from what the DATABASE now holds rather than from what the browser
// hoped it had sent. Two descriptions of "what does a paid check-paying
// vendor look like" is exactly how a row ends up saying Paid in one place and
// Awaiting check in another after a single click.
export function vendorCellState(row) {
  const label = paymentLabel(row);
  const chk = checkState(row);
  return {
    id: row.id,
    payment_status: row.payment_status,
    tone: label.tone,
    statusLabel: label.label,
    // "asked $46.65" and "$46.65 recorded" are different sentences on
    // purpose: one is what the church wants, the other is what somebody has
    // actually seen. NULL means nobody has looked yet, and reads as the first.
    moneyLine: row.amount_paid_cents == null
      ? 'asked ' + money(row.amount_due_cents)
      : money(row.amount_paid_cents) + ' recorded',
    // ⚠ FOUR MODES, NOT THREE. A check-paying vendor whose fee was waived, or
    // who dropped out, is not somebody a check is expected from — `pending`
    // is already false for both (see `checkState`) — and drawing them the
    // number box and the ✓ In button invites the coordinator to record a
    // check that is never coming, on the row that says in the cell beside it
    // that nothing is owed.
    checkMode: chk.paying === 'card' ? 'card'
      : chk.received ? 'received'
      : chk.pending ? 'pending' : 'quiet',
    checkNo: row.check_no || '',
    checkDate: row.check_date || '',
    checkLabel: chk.received
      ? '✓ Check ' + (row.check_no && row.check_no !== '—' ? '#' + row.check_no : '(no number)')
        + (row.check_date ? ' · ' + row.check_date : '')
      : '',
    category: row.category || '',
    tables: row.tables,
    table_number: row.table_number || '',
    due: money(row.amount_due_cents),
    waitlisted: !!row.waitlisted,
  };
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

export function coordinatorEmailHtml(v, { totalCents, photos = [], suspect = false, waitlisted = false }) {
  const addr = [v.street, [v.city, v.state].filter(Boolean).join(', '), v.zip].filter(Boolean).join(' · ');
  return `${suspect ? '<p style="margin:0 0 12px;padding:10px 12px;background:#FAF0DC;border-left:3px solid #C9973A;"><strong>This one was flagged for review by the screening filter.</strong> It is almost certainly a real application — this note is just so you read it twice.</p>' : ''}
${waitlisted ? '<p style="margin:0 0 12px;padding:10px 12px;background:#FAF0DC;border-left:3px solid #C9973A;"><strong>Soft reserve — confirmed tables are full.</strong> No payment link was sent. Confirm this one from the Vendors tab once a table opens, and it will be asked to pay.</p>' : ''}
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

export function vendorEmailHtml(v, { totalCents, payUrl, settings, waitlisted = false }) {
  const byCheck = v.payment_method === 'check';
  return `<p>Hi ${escapeHtml(v.participant_names)},</p>
<p>Thank you for applying for a table at the Timothy Christmas Market on ${escapeHtml(settings.dateLabel)}, ${escapeHtml(settings.hoursLabel)}.</p>
${waitlisted
  ? `<p><strong>Confirmed tables are full right now, so you are on our waiting list.</strong> Nothing is due and no payment has been taken — we will reach out the moment a table opens up, and only ask for payment then. Your spot for ${v.tables} table${v.tables === 1 ? '' : 's'} would come to <strong>${escapeHtml(money(totalCents))}</strong>${byCheck ? '' : ' including the card processing fee'} once confirmed.</p>`
  : `<p>You asked for <strong>${v.tables} table${v.tables === 1 ? '' : 's'}</strong>, which comes to <strong>${escapeHtml(money(totalCents))}</strong>${byCheck ? '' : ' including the card processing fee'}.</p>
${byCheck
  ? `<p><strong>Please bring a check made out to Timothy Lutheran Church, or exact cash, on the day</strong> — Marla, our market coordinator, marks your table paid when it arrives.</p>`
  : (payUrl ? `<p><strong>Your space is held once payment arrives.</strong> If you closed the payment page before finishing, you can pay here: <a href="${escapeHtml(payUrl)}">${escapeHtml(money(totalCents))} for your table${v.tables === 1 ? '' : 's'}</a>.</p>` : '')}`}
<p>Marla will confirm your table number by email. ${waitlisted ? 'If' : byCheck ? 'If' : 'If you would rather pay by check or cash, or if'} you need to change anything, reply to this message or write to <a href="mailto:${escapeHtml(settings.coordinatorEmail)}">${escapeHtml(settings.coordinatorEmail)}</a>.</p>
<p>Doors open to vendors at 8:30 am. Please be set up by 10:30 and stay until the market closes at 6:00.</p>
<p>We are glad you are coming,<br>Timothy Lutheran Church</p>`;
}

// ── THE COORDINATOR'S LIST ───────────────────────────────────────────────────
// Returns a Response for the routes it owns, or null so the caller's route
// chain carries on — the same contract handleFilteredRoutes and handleGymRoutes
// use.
// ── THE VENDOR TABLE — THE ROW IS THE FORM ───────────────────────────────────
// Every change the coordinator makes seventy times in a season — a table
// number, a category, a payment state, a check that arrived — is made in the
// row itself and saves on its own. The drawer this replaces meant opening a
// panel, saving, and landing back at the top of the list for each one of
// them, which is what made the list slower to use than the spreadsheet it was
// built to replace.
//
// ⚠ THE EXPANDED ROW IS A REAL <form> POSTING TO /market/update. Without
// JavaScript every cell in it still saves, by the whole-form path the route
// kept — the inline cells are an enhancement on top of a page that works
// without them, not the only way in.
const SELLS_CAP = 54;

const sortKey = (v) => String(v == null ? '' : v).toLowerCase();

function vendorRow(r, settings, cats) {
  const cell = vendorCellState(r);
  const sells = String(r.product_description || '').replace(/\s+/g, ' ').trim();
  const sellsShort = sells.length > SELLS_CAP ? sells.slice(0, SELLS_CAP - 1) + '…' : sells;
  const name = r.business_name || r.participant_names || '(no name given)';
  const sub = [r.business_name ? r.participant_names : '', r.email].filter(Boolean).join(' · ');
  const t = TONES[cell.tone] || TONES.plain;
  const chk = checkState(r);
  const attr = (k, v) => `${k}="${escapeHtml(String(v))}"`;
  const d = (f) => `data-id="${r.id}" data-field="${f}"`;

  const checkCol = cell.checkMode === 'card'
    ? `<span class="tlc-mkt-quiet">Card, online</span>`
    : cell.checkMode === 'quiet'
      ? `<span class="tlc-mkt-quiet">Check or cash — nothing owed</span>`
    : cell.checkMode === 'received'
      ? `<span class="tlc-mkt-checkin">${escapeHtml(cell.checkLabel)}</span>`
      : `<div class="tlc-mkt-check">
          <div class="tlc-mkt-check-row">
            <input type="text" class="tlc-mkt-in tlc-mkt-in-check" ${d('check_no')} data-cell="1"
              value="${escapeHtml(cell.checkNo)}" placeholder="Check #" aria-label="Check number for ${escapeHtml(name)}">
            <button type="button" class="tlc-mkt-in-btn" data-checkin="1" data-id="${r.id}"
              title="Mark the check received today">✓ In</button>
          </div>
          <input type="date" class="tlc-mkt-in tlc-mkt-in-check" ${d('check_date')} data-cell="1"
            value="${escapeHtml(cell.checkDate)}" aria-label="Date the check arrived">
        </div>`;

  // Sorting is done in the browser over the rows already rendered — no new
  // query, and no round trip for something the page is already holding. Each
  // key is written out as its own attribute so the comparison is on a value
  // rather than on scraped markup; `tables` is numeric and `check` is an
  // order, not a word, so both are stored as numbers.
  const sorts = [
    attr('data-s-business', sortKey(name)),
    attr('data-s-category', sortKey(cell.category || 'zzz')),
    attr('data-s-sells', sortKey(sells)),
    attr('data-s-tables', r.tables || 0),
    attr('data-s-tableno', sortKey(r.table_number)),
    attr('data-s-status', sortKey(cell.statusLabel)),
    attr('data-s-check', chk.received ? 2 : chk.pending ? 1 : 0),
  ].join(' ');

  return `<div class="tlc-mkt-row${r.payment_status === 'dropped' ? ' is-out' : ''}" data-row="${r.id}" ${sorts}
    data-filter="${escapeHtml(paymentState(r.payment_status).value)}"
    data-check-pending="${chk.pending ? '1' : '0'}"
    data-waitlisted="${r.waitlisted ? '1' : '0'}"
    data-search="${escapeHtml(`${r.participant_names || ''} ${r.business_name || ''} ${r.email || ''} ${sells} ${cell.category} ${r.table_number || ''}`.toLowerCase())}">
    <div class="tlc-mkt-cells">
      <div class="tlc-mkt-name">
        <span class="tlc-mkt-biz">${escapeHtml(name)}</span>
        ${sub ? `<span class="tlc-mkt-sub">${escapeHtml(sub)}</span>` : ''}
        ${r.waitlisted ? `<span class="tlc-mkt-waitbadge">
            Waiting list — confirmed tables are full
            <button type="button" class="tlc-mkt-waitbtn" data-confirmreserve="1" data-id="${r.id}"
              title="Take this table off the waiting list and open it to payment">Confirm table</button>
          </span>` : ''}
      </div>
      <select class="tlc-mkt-sel" ${d('category')} data-cell="1" aria-label="Category for ${escapeHtml(name)}">
        <option value=""${cell.category ? '' : ' selected'}>—</option>
        ${cats.map((c) => `<option value="${escapeHtml(c)}"${c === cell.category ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
      </select>
      <span class="tlc-mkt-sells" title="${escapeHtml(sells)}">${escapeHtml(sellsShort)}${r.sells_food ? ' <strong>· food</strong>' : ''}</span>
      <select class="tlc-mkt-sel tlc-mkt-sel-n" ${d('tables')} data-cell="1" aria-label="Tables for ${escapeHtml(name)}">
        ${Array.from({ length: settings.maxTables }, (_, i) => i + 1).map((n) =>
          `<option value="${n}"${n === r.tables ? ' selected' : ''}>${n}</option>`).join('')}
      </select>
      <input type="text" class="tlc-mkt-in" ${d('table_number')} data-cell="1"
        value="${escapeHtml(r.table_number || '')}" placeholder="—" aria-label="Table number for ${escapeHtml(name)}">
      <div class="tlc-mkt-pay">
        <select class="tlc-mkt-pill" ${d('payment_status')} data-cell="1" aria-label="Payment for ${escapeHtml(name)}"
          style="background:${t.bg};color:${t.fg};border-color:${t.bd};">
          ${PAYMENT_STATES.map((st) => `<option value="${escapeHtml(st.value)}"${st.value === r.payment_status ? ' selected' : ''}>${escapeHtml(
            st.value === 'unpaid' && r.payment_method === 'check' ? 'Awaiting check' : st.label)}</option>`).join('')}
        </select>
        <span class="tlc-mkt-money">${escapeHtml(cell.moneyLine)}</span>
      </div>
      <div class="tlc-mkt-checkcol">${checkCol}</div>
      <button type="button" class="tlc-mkt-caret" data-expand="${r.id}" aria-expanded="false"
        aria-controls="mkt-more-${r.id}" aria-label="Show the rest of ${escapeHtml(name)}’s application">▾</button>
    </div>
    <div class="tlc-mkt-more" id="mkt-more-${r.id}" hidden>
      <form method="POST" action="/market/update" class="tlc-mkt-more-grid">
        <input type="hidden" name="id" value="${r.id}">
        <input type="hidden" name="table_number" value="${escapeHtml(r.table_number || '')}">
        <input type="hidden" name="payment_status" value="${escapeHtml(r.payment_status || 'unpaid')}">
        <input type="hidden" name="category" value="${escapeHtml(cell.category)}">
        <div>
          <div class="tlc-mkt-lbl">What they sell</div>
          <p class="tlc-mkt-para">${escapeHtml(sells) || '<span class="tlc-mkt-quiet">Nothing written.</span>'}</p>
          ${r.appliances_power ? `<div class="tlc-mkt-lbl">Appliances / power</div><p class="tlc-mkt-para">${escapeHtml(r.appliances_power)}</p>` : ''}
          ${r.special_requests ? `<div class="tlc-mkt-lbl">Special requests</div><p class="tlc-mkt-para">${escapeHtml(r.special_requests)}</p>` : ''}
          <div class="tlc-mkt-lbl">Your notes</div>
          <textarea class="tlc-mkt-notes" name="staff_notes" ${d('staff_notes')} data-cell="1" rows="3"
            placeholder="Only ever seen here — the vendor is not shown this.">${escapeHtml(r.staff_notes || '')}</textarea>
        </div>
        <div>
          <div class="tlc-mkt-lbl">Contact</div>
          <p class="tlc-mkt-para">${escapeHtml(r.participant_names || '')}<br>
            ${r.email ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a><br>` : ''}
            ${escapeHtml(r.phone || '')}
            ${r.website_or_social ? `<br>${escapeHtml(r.website_or_social)}` : ''}
            ${[r.street, [r.city, r.state].filter(Boolean).join(', '), r.zip].filter(Boolean).length
              ? `<br>${escapeHtml([r.street, [r.city, r.state].filter(Boolean).join(', '), r.zip].filter(Boolean).join(' · '))}` : ''}</p>
          <p class="tlc-mkt-quiet">${escapeHtml(r.returning_vendor === 'yes' ? 'Returning vendor' : r.returning_vendor === 'no' ? 'First year' : 'Did not say')}
            · applied ${escapeHtml(String(r.created_at || '').slice(0, 10))}<br>
            Agreed to the vendor terms as ${escapeHtml(r.signature_name || '—')}</p>
          ${photosOf(r).length ? `<div class="tlc-mkt-lbl" style="margin-top:10px;">Sample photos</div>${photosOf(r)
            .map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener"><img src="${escapeHtml(u)}" alt="" class="tlc-mkt-photo"></a>`).join('')}` : ''}
        </div>
        <div>
          <div class="tlc-mkt-lbl">Money</div>
          <p class="tlc-mkt-para">Asked for ${escapeHtml(cell.due)}<br>${escapeHtml(
            r.payment_method === 'check'
              ? 'Paying by check or cash — flat fee, no card charge added'
              : 'Paying by card, online')}</p>
          <label class="tlc-mkt-lbl" for="mkt-paid-${r.id}">Amount paid</label>
          <input type="text" id="mkt-paid-${r.id}" class="tlc-mkt-in tlc-mkt-in-box" name="amount_paid"
            ${d('amount_paid')} data-cell="1"
            value="${escapeHtml(r.amount_paid_cents == null ? '' : (r.amount_paid_cents / 100).toFixed(2))}"
            placeholder="${escapeHtml((r.amount_due_cents / 100).toFixed(2))}">
          <p class="tlc-mkt-quiet">Blank is not the same as zero.${r.sells_food ? ' Selling food — the health department requirements are theirs.' : ''}</p>
          <div class="tlc-mkt-more-actions">
            <button type="submit" class="tlc-btn-primary tlc-mkt-nojs">Save</button>
          </div>
        </div>
      </form>
      <form method="POST" action="/market/delete" class="tlc-mkt-del-form"
        onsubmit="return confirm('Delete this application? The vendor is not told, and nothing is refunded.');">
        <input type="hidden" name="id" value="${r.id}">
        <button type="submit" class="tlc-mkt-del">Delete this application</button>
      </form>
    </div>
  </div>`;
}

// Every column sorts, ascending then descending. The default is Category and
// then vendor name — which is the order the coordinator actually works in,
// because the questions she is answering are "how many bakers" and "are the
// candle people together", not "who applied first".
const VENDOR_HEADS = [
  { key: 'business', label: 'Vendor' },
  { key: 'category', label: 'Category' },
  { key: 'sells', label: 'Sells' },
  { key: 'tables', label: 'Tbls', numeric: true },
  { key: 'tableno', label: 'Table #' },
  { key: 'status', label: 'Payment' },
  { key: 'check', label: 'Check or cash', numeric: true },
];

// The five states a filter pill can select, plus the one that is not a state.
// ⚠ 'check' keys off `checkState().pending`, NOT off a `payment_status`
// value — see the note on the filter list in admin/sections.js. It is written
// onto each row as its own attribute so the pill has one thing to match on.
const VENDOR_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Not paid yet', value: 'unpaid' },
  { label: 'Awaiting check', value: 'check' },
  { label: 'Waiting list', value: 'waitlist' },
  { label: 'Paid', value: 'paid' },
  { label: 'Fee waived', value: 'waived' },
  { label: 'Dropped out', value: 'dropped' },
];

// ── A VENDOR ENTERED BY HAND ─────────────────────────────────────────────────
// The public application is the only door onto the vendor list for everybody
// EXCEPT a church-related ministry (MDO, the Word of Life 8th grade, the
// youth group) that takes a table and is never asked to pay for it. Making
// one of those fill out the public form and then marking the fee waived
// would be asking a real ministry to pretend it is a paying vendor for a
// minute — this is the direct route instead.
//
// ⚠ A COLLAPSED <details>, NOT ITS OWN ADDRESS. This is a rare action —
// maybe half a dozen a season — sitting above a list somebody opens dozens of
// times, so it must not cost a second screen or crowd the vendor list's own
// tools every time the page loads.
function manualAddPanel(settings) {
  return `<details class="tlc-mkt-add">
    <summary class="tlc-mkt-add-summary">+ Add a vendor by hand</summary>
    <div class="tlc-mkt-add-body">
      <p class="tlc-hint" style="margin:0 0 12px;">For a church ministry taking a table at no charge — MDO, Word of Life, the youth group — not for a maker who should use the public application. The fee is waived automatically and nobody is emailed a payment link.</p>
      <form method="POST" action="/market/add">
        ${renderField({ name: 'business_name', label: 'Ministry or group name', required: true })}
        ${renderField({ name: 'participant_names', label: 'Contact person', placeholder: 'Who to reach about this table' })}
        ${renderField({ kind: 'number', name: 'tables', label: 'Tables', value: 1, min: 1, max: 20, step: 1 })}
        ${renderField({ kind: 'choice', name: 'category', label: 'Category', value: 'Ministry',
          options: [{ value: '', label: '— Not categorized —' }, ...VENDOR_CATEGORIES.map((c) => ({ value: c, label: c }))] })}
        ${renderField({ kind: 'textarea', name: 'staff_notes', label: 'Notes', placeholder: 'Only ever seen here — nothing is emailed for this row.' })}
        <div class="btn-row" style="margin-top:4px;"><button type="submit" class="tlc-btn-primary">Add, fee waived</button></div>
      </form>
    </div>
  </details>`;
}

export function vendorTable(rows, settings, cfg) {
  const cats = VENDOR_CATEGORIES;
  const heads = VENDOR_HEADS.map((h, i) => `<button type="button" class="tlc-mkt-h${
    h.key === 'category' ? ' is-on' : ''}" data-sort="${h.key}"${h.numeric ? ' data-num="1"' : ''}
    aria-label="Sort by ${escapeHtml(h.label)}">${escapeHtml(h.label)}<span class="tlc-mkt-caretsm">${
    h.key === 'category' ? '▲' : ''}</span></button>`).join('');

  const filters = VENDOR_FILTERS.map((f) =>
    `<button type="button" class="tlc-mkt-filter${f.value === 'all' ? ' is-on' : ''}" data-mktfilter="${escapeHtml(f.value)}"
      aria-pressed="${f.value === 'all' ? 'true' : 'false'}">${escapeHtml(f.label)}</button>`).join('');

  // Rendered in the default order — category, then name — so the page is
  // already sorted before any script has run.
  const ordered = rows.slice().sort((a, b) => {
    const ca = (a.category || 'zzz').toLowerCase();
    const cb = (b.category || 'zzz').toLowerCase();
    const na = String(a.business_name || a.participant_names || '').toLowerCase();
    const nb = String(b.business_name || b.participant_names || '').toLowerCase();
    return ca.localeCompare(cb) || na.localeCompare(nb);
  });

  return `<div class="tlc-mkt-tools">
      <label class="tlc-mkt-search">
        <span aria-hidden="true">⌕</span>
        <input type="search" id="tlc-mkt-q" placeholder="${escapeHtml(cfg.search || 'Search vendors')}"
          aria-label="${escapeHtml(cfg.search || 'Search vendors')}">
      </label>
      <div class="tlc-mkt-filters">${filters}</div>
      <span class="tlc-mkt-count" id="tlc-mkt-count" data-total="${rows.length}">${
        rows.length} ${rows.length === 1 ? 'application' : 'applications'} shown</span>
    </div>
    <div class="tlc-mkt-wrap">
      <div class="tlc-mkt-table" id="tlc-mkt-table">
        <div class="tlc-mkt-head">${heads}<span></span></div>
        <div class="tlc-mkt-body" id="tlc-mkt-body">
          ${ordered.map((r) => vendorRow(r, settings, cats)).join('')}
        </div>
        <div class="tlc-mkt-none" id="tlc-mkt-none" hidden>
          <span class="tlc-mkt-none-t">No vendor applications match that.</span>
          <span class="tlc-mkt-quiet">Clear the search box, or pick All above.</span>
        </div>
      </div>
    </div>
    ${rows.length ? '' : `<p class="tlc-hint" style="margin-top:14px;">${escapeHtml(settings.open
      ? 'The vendor page is open and waiting — applications land here as they arrive.'
      : 'Applications are switched off, so the page is not taking any. Turn them on above.')}</p>`}
    <p class="tlc-note"><span class="tlc-note-mark" aria-hidden="true">◆</span><span>${escapeHtml(cfg.note || '')}</span></p>`;
}

// ── THE VOLUNTEER ROSTER, AS FOUR WAYS OF LOOKING AT ONE THING ───────────────
//
// The tab stays a read-only window on Serve — shifts are created and changed
// there, and two places editing one roster is two rosters. What changed is
// that the same roster can now be read four ways, and each way prints:
//
//   by job     a panel per job, most short-handed first, for the job lead
//   by time    slot by slot down the day, for whoever is running the floor
//   grid       every job against the clock, for the wall in the kitchen
//   everybody  alphabetical, for the welcome table
//
// ⚠ EVERY ONE OF THOSE EXCEPT THE FIRST NEEDS A REAL START AND END, AND
// SERVE SENDS A LABEL. The contract as built (design_handoff_market_event,
// and the endpoint itself) is `{ label: '8:30–11:00 am', needed, filled,
// people }` — a string written for a human. So `parseShiftLabel()` reads the
// clock back out of it, and everything below is derived from that. When Serve
// grows real `start`/`end`/`day`/`lead` fields — which is the one change this
// design asks of it — they are preferred and no parsing happens at all.
//
// ⚠ AND A SHIFT WHOSE TIME CANNOT BE READ IS MARKED `timed: false`, NOT GIVEN
// A GUESS. Three of the four views are arithmetic on the clock; inventing
// midnight for a label this could not parse would draw a block on the grid at
// a time nobody is coming, which is worse than saying so. The views that need
// times say how many shifts they had to leave out, and the by-job view — the
// one that needs no clock at all — shows everything regardless.

// Minutes past midnight, or null. Accepts what a person writes ('9:00 AM',
// '8:30am', '2 PM'), what a form posts ('14:00'), and the ISO instant Serve
// would send if it grew a real field ('2026-12-05T09:00:00Z' → its own local
// clock reading, which is what a shift time is).
export function parseClock(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}[T ](\d{1,2}):(\d{2})/.exec(s);
  if (iso) return Number(iso[1]) * 60 + Number(iso[2]);
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(s);
  if (m) {
    const h = Number(m[1]) % 12;
    return (m[3].toLowerCase() === 'p' ? h + 12 : h) * 60 + Number(m[2] || 0);
  }
  const h24 = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (h24) {
    const h = Number(h24[1]);
    return h > 23 ? null : h * 60 + Number(h24[2]);
  }
  return null;
}

// '8:30–11:00 am' → { start: 510, end: 660 }.
//
// ⚠ THE MERIDIEM ON THE END OF THE LABEL BELONGS TO BOTH HALVES, AND THAT IS
// THE WHOLE DIFFICULTY. '11:00 am–2:30 pm' says each half outright, but
// '8:30–11:00 am' gives one for two — and the market's own labels are written
// both ways. So a start with no am/pm inherits the end's, and is then pushed
// forward twelve hours if that would put it AFTER the end: '11:00–2:30 pm'
// inherits PM, reads 23:00–14:30, and is corrected to 11:00 AM. Getting this
// wrong does not throw — it silently draws a morning shift in the evening.
export function parseShiftLabel(label) {
  const s = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // ⚠ NOT ANCHORED AT THE START. Serve's own labels routinely name the day in
  // front of the times — 'Friday 4–8pm', 'Saturday 5–7pm' — and an anchored
  // pattern reads every one of those as having no clock at all, which quietly
  // empties three of the four views on exactly the labels the market uses.
  const m = /(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*(?:–|—|-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)/i.exec(s);
  if (!m) return null;
  const hasMer = (t) => /[ap]\.?m\.?$/i.test(t.trim());
  const merOf = (t) => (/p\.?m\.?$/i.test(t.trim()) ? 'pm' : 'am');
  let a = m[1].trim();
  let b = m[2].trim();
  if (!hasMer(a) && hasMer(b)) a += ' ' + merOf(b);
  if (!hasMer(b) && hasMer(a)) b += ' ' + merOf(a);
  let start = parseClock(a);
  let end = parseClock(b);
  if (start == null || end == null) return null;
  // Only ever correct a half that had no meridiem of its own. A label that
  // says '2:00 PM–11:00 AM' outright is wrong in Serve, and quietly fixing it
  // here would hide that from the person who could correct it.
  if (start >= end && !hasMer(m[1].trim())) start = (start + 720) % 1440;
  if (start >= end && !hasMer(m[2].trim())) end = (end + 720) % 1440;
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

const MER = (m) => (m >= 720 ? ' PM' : ' AM');
// '9:00 AM'. Whole hours keep their :00 because the grid's hour rules read as
// a column of times, and '9 AM' beside '9:30 AM' does not line up.
export function fmtClock(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return (((h + 11) % 12) + 1) + ':' + String(m % 60).padStart(2, '0') + MER(m);
}
// '9' / '9:30' — for a range, where the meridiem is said once at the end.
export const fmtShort = (mins) => fmtClock(mins).replace(':00', '').replace(/ [AP]M$/, '');
// The same, keeping the meridiem — for a time shown on its own, where '9'
// could as easily be nine at night as nine in the morning.
export const fmtShortMer = (mins) => fmtShort(mins) + MER(mins).toLowerCase();
export const fmtRange = (a, b) => fmtShort(a) + '–' + fmtShort(b) + MER(b).toLowerCase();

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
// ⚠ Anchored at noon UTC, never `new Date('2026-12-04')`. A bare date string
// is parsed as midnight UTC, which is the previous day for everybody west of
// Greenwich — including St. Louis, including this Worker's readers. Same trap
// the newsletter archive's month grouping is written around.
export function fmtDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (isNaN(d.getTime())) return '';
  return DAY_NAMES[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
}

const personOf = (p) => {
  if (typeof p === 'string') return { name: p, email: '' };
  if (!p || typeof p !== 'object') return null;
  const name = String(p.name || p.email || '').trim();
  return name ? { name, email: String(p.email || '').trim() } : null;
};

// Serve's payload in, the model every view below reads out.
//
// Returns `{ days, untimed, jobs }` — `days` is one entry per date the roster
// covers, each with its own shifts. A roster with no dates at all (which is
// what the endpoint sends today) is ONE day with a blank key and no label,
// and the day switch is simply not drawn: a chooser with one thing in it is a
// control that cannot do anything.
export function normalizeRoster(vol) {
  const roles = Array.isArray(vol && vol.roles) ? vol.roles : [];
  const shifts = [];
  let untimed = 0;
  roles.forEach((role) => {
    const job = String((role && role.name) || '').trim() || 'Unnamed job';
    const lead = String((role && (role.lead || role.leader)) || '').trim();
    (Array.isArray(role && role.shifts) ? role.shifts : []).forEach((sh) => {
      if (!sh || typeof sh !== 'object') return;
      const label = String(sh.label || '').trim();
      // Structured fields win outright when Serve sends them — no parsing.
      const start = parseClock(sh.start != null ? sh.start : sh.starts_at);
      const end = parseClock(sh.end != null ? sh.end : sh.ends_at);
      const fromLabel = start == null || end == null ? parseShiftLabel(label) : null;
      const s = start != null && end != null && end > start ? { start, end } : fromLabel;
      const people = (Array.isArray(sh.people) ? sh.people : []).map(personOf).filter(Boolean);
      const needed = Math.max(0, Number(sh.needed) || 0);
      // `filled` is Serve's own count and is trusted for the tiles, but the
      // NAMES are what the sheets print — so a shift whose count and list
      // disagree reports the longer of the two rather than quietly printing
      // fewer people than it says are coming.
      const filled = Math.max(people.length, Math.max(0, Number(sh.filled) || 0));
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(sh.date || role.date || '').trim())
        ? String(sh.date || role.date).trim() : '';
      if (!s) untimed += 1;
      shifts.push({
        job, lead, label, date,
        start: s ? s.start : null, end: s ? s.end : null, timed: !!s,
        needed, filled, people,
      });
    });
  });

  const keys = [...new Set(shifts.map((s) => s.date))].sort();
  const days = keys.map((k) => ({
    key: k || 'all',
    label: k ? fmtDay(k) : '',
    date: k,
    shifts: shifts.filter((s) => s.date === k),
  }));
  return {
    days: days.length ? days : [{ key: 'all', label: '', date: '', shifts: [] }],
    untimed,
    total: shifts.length,
  };
}

// ── THE FOUR VIEWS, AS DATA ──────────────────────────────────────────────────
// Pure, so each one is testable without a roster fetch or a browser, and so
// the printed sheet and the screen are built from the same call rather than
// from two readings of the same list.

// Most short-handed first. A roster sorted by name is a list; sorted by what
// is missing it is a worklist, which is the only reason the coordinator opens
// it at all.
export function jobsFor(shifts) {
  const map = new Map();
  shifts.forEach((sh) => {
    if (!map.has(sh.job)) map.set(sh.job, { name: sh.job, lead: sh.lead, shifts: [] });
    const j = map.get(sh.job);
    if (!j.lead && sh.lead) j.lead = sh.lead;
    j.shifts.push(sh);
  });
  return [...map.values()].map((j) => {
    j.shifts.sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9));
    const needed = j.shifts.reduce((a, s) => a + s.needed, 0);
    const filled = j.shifts.reduce((a, s) => a + s.filled, 0);
    return { ...j, needed, filled, short: Math.max(0, needed - filled) };
  }).sort((a, b) => (b.short - a.short) || a.name.localeCompare(b.name));
}

// One entry per distinct start+end, every job running in it side by side.
export function slotsFor(shifts) {
  const map = new Map();
  shifts.filter((s) => s.timed).forEach((sh) => {
    const k = sh.start + '|' + sh.end;
    if (!map.has(k)) map.set(k, { start: sh.start, end: sh.end, entries: [] });
    map.get(k).entries.push(sh);
  });
  return [...map.values()].map((s) => {
    s.entries.sort((a, b) => a.job.localeCompare(b.job));
    const needed = s.entries.reduce((a, e) => a + e.needed, 0);
    const filled = s.entries.reduce((a, e) => a + e.filled, 0);
    return { ...s, needed, filled, short: Math.max(0, needed - filled) };
  }).sort((a, b) => (a.start - b.start) || (a.end - b.end));
}

// Alphabetical, with when they arrive and when they can go home. This is the
// welcome-table list, and the only view keyed on a person rather than a job.
export function peopleFor(shifts) {
  const map = new Map();
  shifts.forEach((sh) => sh.people.forEach((p) => {
    if (!map.has(p.name)) map.set(p.name, { name: p.name, email: p.email, shifts: [] });
    const e = map.get(p.name);
    if (!e.email && p.email) e.email = p.email;
    e.shifts.push(sh);
  }));
  return [...map.values()].map((p) => {
    p.shifts.sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9));
    const timed = p.shifts.filter((s) => s.timed);
    const from = timed.length ? Math.min(...timed.map((s) => s.start)) : null;
    const to = timed.length ? Math.max(...timed.map((s) => s.end)) : null;
    // Hours WORKED, not hours on site — somebody with a gap in the middle of
    // the day is not owed lunch for it, and the welcome table wants to know
    // how long each person actually signed up for.
    const minutes = timed.reduce((a, s) => a + (s.end - s.start), 0);
    return { ...p, from, to, hours: Math.round(minutes / 6) / 10 };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ── THE CSV ──────────────────────────────────────────────────────────────────
// One row per person per shift, across every day, PLUS a row for every spot
// nobody has taken, marked `(open)`. The open rows are the point: a file
// listing only the people who came is a thank-you list, and what the
// coordinator is doing with a spreadsheet in November is looking for holes.
export function volunteerCsvRows(days) {
  const head = ['Day', 'Date', 'Job', 'Job lead', 'Start', 'End', 'Hours', 'Person',
    'Spots filled', 'Spots needed', 'Status'];
  const out = [head];
  days.forEach((day) => {
    day.shifts.slice()
      .sort((a, b) => ((a.start ?? 1e9) - (b.start ?? 1e9)) || a.job.localeCompare(b.job))
      .forEach((s) => {
        const hours = s.timed ? ((s.end - s.start) / 60).toFixed(2) : '';
        const status = s.filled >= s.needed ? 'Full' : s.filled === 0 ? 'Nobody yet' : 'Short';
        const base = [day.label || '', day.date || '', s.job, s.lead || '',
          s.timed ? fmtClock(s.start) : s.label, s.timed ? fmtClock(s.end) : '', hours];
        s.people.forEach((p) => out.push(base.concat([p.name, s.filled, s.needed, status])));
        for (let i = s.people.length; i < s.needed; i++) {
          out.push(base.concat(['(open)', s.filled, s.needed, status]));
        }
      });
  });
  return out;
}

// ⚠ Every cell goes through `csvCell` — a cell beginning = + - @ is a FORMULA
// to a spreadsheet, and this file exists to be opened in one. Unlike the
// vendor export there are no computed money columns here, so there is nothing
// that a quoting guard could turn into text that stops summing: every column
// is safe to guard, and a volunteer's name really can begin with a hyphen.
export const volunteerCsv = (days) =>
  volunteerCsvRows(days).map((r) => r.map(csvCell).join(',')).join('\r\n');

// ── THE VOLUNTEER TAB, RENDERED ──────────────────────────────────────────────
// Four views of one roster and four printed sheets, all of them addresses:
// `?tab=volunteers&day=…&view=…&axis=…&print=…`. Nothing here is a JavaScript
// mode. A view somebody has arranged survives a reload, can be sent to the
// job lead as a link, and prints with the browser's own Print rather than
// through a script — which also means the print sheets are markup a screen
// reader can read, not a canvas.
const VOL_VIEWS = [
  { key: 'job', label: 'By job' },
  { key: 'time', label: 'By time' },
  { key: 'grid', label: 'Grid' },
  { key: 'people', label: 'Everybody' },
];

const HOUR_H = 78;   // one hour, down the page, in the jobs-across grid
const HOUR_W = 148;  // one hour, across the page, in the time-across grid

const fillTone = (filled, needed) => (filled >= needed ? 'ok' : filled === 0 ? 'none' : 'short');
const FILL = {
  ok:    { bg: TONES.good.bg, bd: TONES.good.bd, fg: TONES.good.fg },
  short: { bg: TONES.warn.bg, bd: TONES.warn.bd, fg: TONES.warn.fg },
  none:  { bg: '#FBEDE7',     bd: TONES.bad.bd,  fg: TONES.bad.fg },
};
// 'Marla B.' — a grid block is a few hundred pixels wide and a column of full
// names in it is a column of ellipses. The sheets and the list views print
// the whole name; only the grid abbreviates.
const shortName = (n) => {
  const p = String(n || '').trim().split(/\s+/);
  return p.length > 1 ? p[0] + ' ' + p[1].charAt(0) + '.' : (p[0] || '');
};
// ⚠ A NAME IS SOMEBODY YOU CAN WRITE TO. Wherever a full name is shown it is
// a mailto link when Serve gave an address — the coordinator's most common
// next action after reading a short-handed shift is emailing the people on
// it, and a list of plain names makes her go and look each one up. The grid
// is the exception: its blocks abbreviate to fit, and a link on 'Marla B.'
// inside a 100px box is a tap target nobody can hit.
const whoOf = (sh, brief) => (sh.people.length
  ? sh.people.map((p) => (brief || !p.email
    ? escapeHtml(brief ? shortName(p.name) : p.name)
    : `<a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.name)}</a>`)).join(', ')
  : '');

const segLink = (base, items, current, param) => `<div class="tlc-seg" role="group">${items.map((i) =>
  `<a class="${i.key === current ? 'is-on' : ''}" href="${escapeHtml(base + (base.includes('?') ? '&' : '?') + param + '=' + encodeURIComponent(i.key))}"${
    i.key === current ? ' aria-current="true"' : ''}>${escapeHtml(i.label)}</a>`).join('')}</div>`;

// ── By job — the job lead's own view ──
function volByJob(shifts, base) {
  const jobs = jobsFor(shifts);
  if (!jobs.length) return `<p class="tlc-hint">No jobs are set up for this day yet.</p>`;
  return `<div class="tlc-vol-jobs">${jobs.map((j) => `
    <div class="tlc-vol-job">
      <div class="tlc-vol-job-h">
        <span style="min-width:0;">
          <span class="tlc-vol-job-n">${escapeHtml(j.name)}</span>
          <span class="tlc-vol-job-l">Lead · ${escapeHtml(j.lead || 'Unassigned')}</span>
        </span>
        <span class="tlc-vol-job-r">
          ${j.short > 0 ? statusPill(j.filled === 0 ? 'bad' : 'warn', `${j.short} still needed`) : statusPill('good', 'Full')}
          <a class="tlc-action-quiet" href="${escapeHtml(base + '&print=leads&job=' + encodeURIComponent(j.name))}"
            title="Print this lead's sheet">Sheet</a>
        </span>
      </div>
      <div class="tlc-vol-job-b">${j.shifts.map((s) => `
        <div class="tlc-vol-shift">
          <span class="tlc-vol-t">${escapeHtml(s.timed ? fmtRange(s.start, s.end) : (s.label || 'No time given'))}</span>
          <span class="tlc-vol-n tlc-vol-${fillTone(s.filled, s.needed)}">${s.filled}/${s.needed}</span>
          <span class="tlc-vol-who">${s.people.length ? whoOf(s)
            : '<span class="tlc-hint">Nobody yet — this shift is entirely open.</span>'}</span>
        </div>`).join('')}</div>
    </div>`).join('')}</div>
  <p class="tlc-note"><span class="tlc-note-mark" aria-hidden="true">◆</span><span>Most short-handed first, because that is the order the work is in. <strong>Sheet</strong> prints that one lead their own page — their shifts, their people, and nobody else's.</span></p>`;
}

// ── By time — the floor manager's view ──
function volByTime(shifts, untimedHere) {
  const slots = slotsFor(shifts);
  if (!slots.length) return volNoTimes(untimedHere);
  return `<div class="tlc-vol-panel">${slots.map((s) => `
    <div class="tlc-vol-slot">
      <div>
        <div class="tlc-vol-slot-t">${escapeHtml(fmtClock(s.start))}</div>
        <div class="tlc-vol-slot-e">to ${escapeHtml(fmtClock(s.end))}</div>
        <div style="margin-top:8px;">${s.short > 0 ? statusPill('warn', `${s.short} short`) : statusPill('good', 'Covered')}</div>
      </div>
      <div class="tlc-vol-slot-jobs">${s.entries.map((e) => `
        <div class="tlc-vol-card tlc-vol-fill-${fillTone(e.filled, e.needed)}">
          <div class="tlc-vol-card-h">
            <span class="tlc-vol-card-n">${escapeHtml(e.job)}</span>
            <span class="tlc-vol-n tlc-vol-${fillTone(e.filled, e.needed)}">${e.filled}/${e.needed}</span>
          </div>
          <div class="tlc-vol-card-w">${e.people.length ? whoOf(e) : 'Open'}</div>
        </div>`).join('')}</div>
    </div>`).join('')}</div>
  ${untimedNote(untimedHere)}`;
}

// ── The grid — every job against the clock ──
// ⚠ THE ROWS AND COLUMNS ARE WHOLE HOURS AND A SHIFT IS A BLOCK LAID OVER
// THEM. A row per distinct slot instead — which is the obvious way to build
// this, and the wrong one — makes a 7:30–11:00 shift exactly as tall as the
// 9:00–11:00 shift beside it, and how long each job actually runs is the one
// thing somebody reads this grid to compare.
function volGrid(shifts, axis) {
  const timed = shifts.filter((s) => s.timed);
  if (!timed.length) return volNoTimes(shifts.length);
  const jobs = [...new Set(timed.map((s) => s.job))].sort((a, b) => a.localeCompare(b));
  const hourStart = Math.floor(Math.min(...timed.map((s) => s.start)) / 60);
  const hourEnd = Math.ceil(Math.max(...timed.map((s) => s.end)) / 60);
  const hours = Math.max(1, hourEnd - hourStart);
  const label = (i) => escapeHtml(fmtClock((hourStart + i) * 60));

  const blockOf = (s, across) => {
    const f = FILL[fillTone(s.filled, s.needed)];
    const off = (s.start - hourStart * 60) / 60;
    const len = (s.end - s.start) / 60;
    const pos = across
      ? `top:5px;bottom:5px;left:${Math.round(off * HOUR_W + 2)}px;width:${Math.round(len * HOUR_W - 4)}px;`
      : `left:4px;right:4px;top:${Math.round(off * HOUR_H + 2)}px;height:${Math.round(len * HOUR_H - 4)}px;`;
    return `<div class="tlc-grid-block" style="${pos}background:${f.bg};border:1px solid ${f.bd};"
      title="${escapeHtml(`${s.job} · ${fmtRange(s.start, s.end)} · ${s.filled} of ${s.needed}`)}">
      <span class="tlc-grid-count" style="color:${f.fg};">${s.filled} of ${s.needed}</span>
      <span class="tlc-grid-who">${s.people.length ? whoOf(s, true) : 'Open'}</span>
    </div>`;
  };

  if (axis === 'time') {
    // Jobs down the left, hours across — the orientation the printed grid uses.
    const trackW = hours * HOUR_W;
    const rule = `repeating-linear-gradient(to right, var(--tlc-divider) 0 1px, transparent 1px ${HOUR_W}px)`;
    return `<div class="tlc-grid-wrap"><div style="min-width:${190 + trackW}px;">
      <div class="tlc-grid-head">
        <span class="tlc-grid-hcell" style="flex:0 0 190px;border-left:0;">Job</span>
        <div style="flex:none;position:relative;height:38px;width:${trackW}px;">
          ${Array.from({ length: hours }, (_, i) =>
            `<span class="tlc-grid-hourlab" style="top:10px;left:${i * HOUR_W}px;padding-left:8px;border-left:1px solid var(--tlc-edge);">${label(i)}</span>`).join('')}
        </div>
      </div>
      ${jobs.map((job, i) => `
        <div class="tlc-grid-row" style="background:${i % 2 ? 'var(--tlc-parchment)' : 'var(--tlc-card)'};">
          <span class="tlc-grid-rowlab"><b>${escapeHtml(job)}</b><span>Lead · ${escapeHtml(
            (timed.find((s) => s.job === job) || {}).lead || 'Unassigned')}</span></span>
          <div class="tlc-grid-track" style="height:56px;width:${trackW}px;background-image:${rule};">
            ${timed.filter((s) => s.job === job).map((s) => blockOf(s, true)).join('')}
          </div>
        </div>`).join('')}
    </div></div>
    <p class="tlc-note"><span class="tlc-note-mark" aria-hidden="true">◆</span><span>Same roster, turned on its side — this is the shape the printed grid uses, so what is on the screen is what comes out of the printer.</span></p>`;
  }

  // Hours down the side, jobs across the top.
  const cols = `190px repeat(${jobs.length},minmax(104px,1fr))`;
  const rule = `repeating-linear-gradient(var(--tlc-divider) 0 1px, transparent 1px ${HOUR_H}px)`;
  return `<div class="tlc-grid-wrap"><div style="min-width:${190 + jobs.length * 104}px;">
    <div class="tlc-grid-head" style="display:grid;grid-template-columns:${cols};">
      <span class="tlc-grid-hcell" style="border-left:0;">Time</span>
      ${jobs.map((g) => `<span class="tlc-grid-hcell">${escapeHtml(g)}</span>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:${cols};">
      <div style="position:relative;height:${hours * HOUR_H}px;background-image:${rule};">
        ${Array.from({ length: hours }, (_, i) =>
          `<div class="tlc-grid-hourlab" style="left:0;top:${i * HOUR_H}px;padding:5px 12px;">${label(i)}</div>`).join('')}
      </div>
      ${jobs.map((job) => `
        <div style="position:relative;height:${hours * HOUR_H}px;border-left:1px solid var(--tlc-divider);background-image:${rule};">
          ${timed.filter((s) => s.job === job).map((s) => blockOf(s, false)).join('')}
        </div>`).join('')}
    </div>
  </div></div>
  <p class="tlc-note"><span class="tlc-note-mark" aria-hidden="true">◆</span><span>Every block is a real stretch of the day, so a 7:30–11:00 shift is one tall block and a 9:00–11:00 job beside it covers only its own hours. Green is covered, amber short, red nobody yet; blank means that job is not running then.</span></p>`;
}

// ── Everybody — the welcome table's list ──
function volPeople(shifts) {
  const people = peopleFor(shifts);
  if (!people.length) return `<p class="tlc-hint">Nobody has taken a shift on this day yet.</p>`;
  return `<div class="tlc-vol-panel">
    <div class="tlc-vol-rows tlc-vol-rows-h"><span>Person</span><span>On site</span><span>Shifts</span></div>
    ${people.map((p) => `
      <div class="tlc-vol-rows">
        <span class="tlc-vol-pname">${p.email
          ? `<a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.name)}</a>`
          : escapeHtml(p.name)}
          <span class="tlc-vol-pnote">${p.shifts.length} shift${p.shifts.length === 1 ? '' : 's'}${
            p.hours ? ` · ${p.hours} hrs` : ''}</span></span>
        <span class="tlc-vol-t">${escapeHtml(p.from == null ? '—' : fmtRange(p.from, p.to))}</span>
        <span class="tlc-vol-who">${p.shifts.map((s) => escapeHtml(
          s.job + (s.timed ? ` (${fmtRange(s.start, s.end)})` : ''))).join(' · ')}</span>
      </div>`).join('')}
  </div>
  <p class="tlc-note"><span class="tlc-note-mark" aria-hidden="true">◆</span><span>This is the list to print for the welcome table: everybody coming, when they arrive, and when they can go home. Hours are hours <em>worked</em> — a gap in the middle of somebody's day is not counted.</span></p>`;
}

// ⚠ WHEN SERVE SENDS NO CLOCK, THREE OF THE FOUR VIEWS SAY SO RATHER THAN
// DRAWING SOMETHING. Serve's summary sends a shift's time as a LABEL written
// for a human, and `parseShiftLabel()` reads most of them — but a label it
// cannot read has no start and no end, and a view built on arithmetic over
// the clock cannot honestly include it. Inventing midnight would put a block
// on the grid at a time nobody is coming. By job, which needs no clock, shows
// every shift regardless, so nothing is ever unreachable.
const volNoTimes = (n) => `<div class="alert alert-warn">
  <strong>This view needs each shift's start and end, and Serve has not sent them.</strong>
  ${n ? `${n} shift${n === 1 ? '' : 's'} came through with a time this screen could not read.` : ''}
  <strong>By job</strong> shows the whole roster whichever way the times are written, so nothing is hidden — and Serve sending a real start and end on each shift is what turns the other three on.
</div>`;
const untimedNote = (n) => (n ? `<p class="tlc-hint" style="margin-top:12px;">${n} shift${n === 1 ? '' : 's'} ${
  n === 1 ? 'is' : 'are'} missing from this view — ${n === 1 ? 'its' : 'their'} time could not be read. <strong>By job</strong> shows ${
  n === 1 ? 'it' : 'them'}.</p>` : '');

// ── THE PRINTED SHEETS ───────────────────────────────────────────────────────
// Plain markup and one @page rule; no library, and no second rendering of the
// roster. Four of them, and each is a preview of exactly what comes out of
// the printer, because it IS what comes out — everything that is chrome
// carries data-noprint and everything else is the sheet.
function printSheets(kind, shifts, dayLabel, job, axis) {
  const head = (title, sub, wide) => `<div class="tlc-print-sheet${wide ? ' tlc-print-sheet--wide' : ''}">
    <div class="tlc-print-h"><span class="tlc-print-t">${escapeHtml(title)}</span>
      <span class="tlc-print-mark">Timothy Christmas Market</span></div>
    <p class="tlc-print-sub">${escapeHtml(sub)}</p>`;
  const block = (h, lines) => `<div class="tlc-print-block"><div class="tlc-print-bh">${escapeHtml(h)}</div>${
    lines.map((l) => `<div class="tlc-print-line"><span>${escapeHtml(l[0])}</span><span>${escapeHtml(l[1])}</span></div>`).join('')}</div>`;

  if (kind === 'grid') {
    return head('Who is where, hour by hour', `${dayLabel} · green is covered, amber short, red nobody yet. Print landscape.`, true)
      + volGrid(shifts, axis).replace(/<p class="tlc-note">[\s\S]*?<\/p>$/, '') + '</div>';
  }
  if (kind === 'time') {
    const slots = slotsFor(shifts);
    return head('Master list by time slot', dayLabel)
      + slots.map((s) => block(`${fmtClock(s.start)} – ${fmtClock(s.end)}`, s.entries.map((e) =>
        [e.job, `${e.people.length ? e.people.map((p) => p.name).join(', ') : 'OPEN'}  (${e.filled}/${e.needed})`]))).join('')
      + '</div>';
  }
  if (kind === 'people') {
    const people = peopleFor(shifts);
    return head('Everybody coming — master list', `${dayLabel} · ${people.length} ${people.length === 1 ? 'person' : 'people'}`)
      + block('Alphabetical, with arrival and last shift', people.map((p) => [
        p.name,
        (p.from == null ? 'time not given' : `${fmtClock(p.from)} – ${fmtClock(p.to)}`)
          + ' · ' + p.shifts.map((s) => s.job + (s.timed ? ' ' + fmtShort(s.start) : '')).join(', '),
      ])) + '</div>';
  }
  // One page per lead — their shifts, their people, and nobody else's. That
  // is the whole point of it: a lead handed the master list has to find their
  // own job in it first, on a morning when they have twelve other things on.
  let jobs = jobsFor(shifts);
  if (job) jobs = jobs.filter((j) => j.name === job);
  jobs = jobs.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!jobs.length) return `<p class="tlc-hint">Nothing to print — that job is not running on this day.</p>`;
  return jobs.map((j) => head(j.name,
    `${dayLabel} · lead: ${j.lead || 'Unassigned'} · ${j.filled} of ${j.needed} spots filled`)
    + block('Your people', j.shifts.map((s) => [
      s.timed ? `${fmtClock(s.start)} – ${fmtClock(s.end)}` : (s.label || 'Time not given'),
      `${s.people.length ? s.people.map((p) => p.name).join(', ') : 'Nobody yet'}  (${s.filled} of ${s.needed})`,
    ])) + '</div>').join('');
}

// ── READING THE ROSTER OUT OF SERVE ──────────────────────────────────────────
// Pulled out of the volunteers tab so the CSV route reads the roster exactly
// the way the screen does — one fetch, one set of failure rules, one idea of
// what "Serve did not answer" means. Two copies of this would be two answers
// to whether the market has enough volunteers.
export async function fetchRoster(env) {
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
    // ⚠ THE SERVICE BINDING, NOT A PLAIN fetch() TO THE HOSTNAME. A plain
    // fetch from inside this Worker to serve.timothystl.org answered 404
    // persistently, where the identical URL with the identical key fetched
    // from off-network never did — and three cache-layer fixes in a row
    // (no-store on Serve's side, cf:{cacheTtl:0} here, then a cache-busting
    // query string that no colo could possibly have seen before) all failed
    // to shift it, which rules out caching as the cause. `env.VOLUNTEER_WORKER`
    // (bound to the chms Worker in wrangler.toml — the same binding
    // `forwardToChms()` in `admin/forms.js` already uses) is an in-process
    // call into the deployed chms code with no DNS, no edge routing and no
    // cache in between, and it fixed it. Do not "simplify" this back to a
    // hostname fetch.
    //
    // ⚠ It is undefined only in a harness with no service bindings, where the
    // plain-fetch fallback is fine because nothing there could be stale.
    const req = new Request(
      'https://serve.timothystl.org/api/signups/christmasmarket/summary',
      { headers: { Accept: 'application/json', 'X-Intake-Key': intakeKey } });
    const res = env.VOLUNTEER_WORKER
      ? await env.VOLUNTEER_WORKER.fetch(req, { signal: AbortSignal.timeout(4000) })
      : await fetch(req, { signal: AbortSignal.timeout(4000) });
    if (res.ok) vol = await res.json();
    // ⚠ THE STATUS AND NOTHING ELSE. This used to capture Serve's raw
    // response body and its cf-ray and render both onto the screen — a
    // diagnostic for the 404 above, which the service binding fixed. Another
    // application's raw error output is not something the market coordinator
    // has any use for, and a body captured from a host that is misbehaving is
    // the last thing worth painting into an admin page. What she needs is
    // whether the roster could be read, which the empty state already says.
    else volError = `Serve answered ${res.status}.`;
  } catch (e) { volError = `Serve could not be reached: ${e.message || e}`; }
}
// ⚠ And an answer that is not the shape this expects is not an answer.
// Something else on that host answering 200 with a page, or a proxy
// returning its own JSON, would otherwise draw four tiles of zeros and
// call them the roster.
if (vol && !Array.isArray(vol.roles)) { vol = null; volError = volError || 'Serve answered with something this screen could not read.'; }
  return { vol, volError };
}

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

  // ── THE ROSTER AS A SPREADSHEET ──────────────────────────────────────────
  // The server-side twin of the Export CSV button on the Volunteers tab —
  // same rows, same columns, from the same `volunteerCsv()`. The button IS
  // this route, so there is one assembly of the roster rather than a second
  // one in the browser that could come to disagree with it. Gated
  // `market_manage` for the reason the vendor export is: the file carries the
  // names of everybody coming, and that belongs behind the coordinator's own
  // permission rather than behind whoever can edit the market's page.
  if (path === '/market/volunteers.csv' && method === 'GET') {
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const { vol, volError } = await fetchRoster(env);
    // ⚠ An unreachable Serve is a 503, not an empty file. A CSV with a header
    // row and nothing under it reads as "nobody has signed up", which is a
    // very different thing to hand somebody than "the roster could not be
    // read" — and it is the one that gets acted on.
    if (!vol) return new Response(`The roster could not be read. ${volError || 'Serve did not answer.'}`, { status: 503 });
    return new Response(volunteerCsv(normalizeRoster(vol).days), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="christmas-market-volunteers-${churchDate()}.csv"`,
      },
    });
  }

  // ── ONE CELL AT A TIME, OR THE WHOLE FORM ────────────────────────────────
  // The row IS the form now, so the ordinary case is a single field changing
  // — a table number typed, a category picked, a check marked in — and each
  // one saves on its own with its own audit entry. That is what makes the
  // drawer unnecessary: nothing has to be opened, saved and closed to change
  // one number, and nothing lands the coordinator back at the top of a list
  // of seventy rows.
  //
  // ⚠ THE WHOLE-FORM PATH IS KEPT, AND NOT ONLY FOR THE TESTS. A POST with no
  // `field` is the no-JavaScript path: the expanded row is a real <form> that
  // submits normally if the fetch never runs, and a coordinator on a phone
  // with a flaky connection must still be able to record a payment. One
  // route, both shapes — a second route for the single-field case would be a
  // second place that has to agree about what "paid" means.
  //
  // ⚠ AND THE FIELD NAME IS CHECKED AGAINST A LIST BEFORE IT IS USED.
  // `updateRegistration()` builds its SQL from the KEYS of the object it is
  // handed, so a field name that came straight from the request would be a
  // column name coming straight from the request. Everything below maps a
  // posted name onto a fixed column, and an unrecognized one is refused.
  if (path === '/market/update' && method === 'POST') {
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
    const fail = (code, message) => (wantsJson
      ? new Response(JSON.stringify({ ok: false, error: message }), { status: code, headers: { 'Content-Type': 'application/json' } })
      : new Response('', { status: 302, headers: { Location: '/market?msg=gone' } }));

    const id = Number(form.get('id') || 0);
    if (!id) return fail(400, 'No application was named.');
    const before = await getRegistration(env, id);
    if (!before || before.event_id !== 'christmasmarket') return fail(404, 'That application is no longer there.');
    const row = marketRowFromRegistration(before);

    const field = trim(form.get('field'));
    const patch = {};
    const fieldPatch = {};

    // Blank means "we have not recorded a payment", which is a different fact
    // from "they paid nothing" — so it stays NULL rather than becoming 0.
    const readPaid = (raw) => (trim(raw) === '' ? null : Math.round(num(raw, 0) * 100));

    if (!field) {
      // The whole row, as the expanded panel posts it without script.
      patch.table_number = cap(form.get('table_number'), 40) || null;
      patch.payment_status = paymentState(String(form.get('payment_status') || '')).value;
      patch.amount_paid_cents = readPaid(form.get('amount_paid'));
      patch.staff_notes = cap(form.get('staff_notes'), 2000) || null;
      if (form.get('category') != null) fieldPatch.category = cleanCategory(form.get('category'));
    } else if (field === 'check_in') {
      // ⚠ ONE CLICK IS THE POINT OF THIS BUTTON. A check arriving in the
      // office mail is one event, and making the coordinator record a number,
      // then a date, then change the payment state, then type the amount is
      // four chances to do three of them. It stamps today — in CHURCH time,
      // not the Worker's UTC, or a check that came in on Thursday evening is
      // dated Friday — and leaves a number already typed alone.
      fieldPatch.check_no = row.check_no || '—';
      fieldPatch.check_date = row.check_date || churchDate();
      patch.payment_status = 'paid';
      patch.amount_paid_cents = before.amount_due_cents || 0;
    } else if (field === 'confirm_reserve') {
      // ── TAKING A ROW OFF THE WAITING LIST ─────────────────────────────
      // This is the ONLY door — a soft-reserved row never leaves the
      // waitlist by itself, and nothing else on this screen writes the
      // `waitlisted` column. It does not take payment or generate a link;
      // it only turns the row back into an ordinary application the
      // coordinator now works the same way she works every other one —
      // by email, by phone, or by pointing the vendor at the market page
      // to pay. A row that was never waitlisted is a harmless no-op.
      patch.waitlisted = 0;
    } else if (field === 'table_number') {
      patch.table_number = cap(form.get('value'), 40) || null;
    } else if (field === 'payment_status') {
      patch.payment_status = paymentState(String(form.get('value') || '')).value;
      // ⚠ MARKING A ROW PAID RECORDS THE AMOUNT ASKED, unless one is already
      // recorded. Without this the row reads "Paid" over "asked $46.65" and —
      // worse — the "Recorded as paid" tile, which sums `amount_paid_cents`,
      // stays at zero however many rows the coordinator marks. A
      // reconciliation that reads short for a reason nobody can find is
      // exactly what this screen exists to prevent, and it is the same rule
      // recording a check number already follows; the two paths agreeing is
      // the point.
      //
      // ⚠ An amount ALREADY recorded is never overwritten — a partial payment
      // she typed by hand is a fact, and this must not quietly round it up to
      // the full fee. And only `paid` does this: a waived fee and a vendor
      // who dropped out both mean no money arrived, so recording one would
      // make the collected figure include money the church never had.
      if (patch.payment_status === 'paid' && before.amount_paid_cents == null) {
        patch.amount_paid_cents = before.amount_due_cents || 0;
      }
    } else if (field === 'amount_paid') {
      patch.amount_paid_cents = readPaid(form.get('value'));
    } else if (field === 'staff_notes') {
      patch.staff_notes = cap(form.get('value'), 2000) || null;
    } else if (field === 'tables') {
      // Changing the count changes what they OWE, and saying so is the whole
      // reason this is editable here — but it never silently rewrites what
      // they have already been recorded as paying.
      const tables = clampTables(form.get('value'), settings.maxTables);
      patch.qty = tables;
      const price = priceBreakdown(tables, settings);
      patch.amount_due_cents = row.payment_method === 'check' ? price.subtotalCents : price.totalCents;
    } else if (field === 'category') {
      fieldPatch.category = cleanCategory(form.get('value'));
    } else if (field === 'check_no' || field === 'check_date') {
      const value = cap(form.get('value'), 40);
      fieldPatch[field] = value;
      const other = field === 'check_no' ? row.check_date : row.check_no;
      // A number with no date reads as a check that arrived at no particular
      // time, which is the fact somebody reconciling a bank statement most
      // wants. Typing one fills the other in rather than asking twice.
      if (value && !other && field === 'check_no') fieldPatch.check_date = churchDate();
      // ⚠ RECORDING A CHECK IS WHAT TURNS "AWAITING CHECK" INTO PAID, and
      // that is a decision, not an inference — see the note above
      // `checkState()`. It only ever moves an UNPAID row: a waived fee or a
      // vendor who dropped out keeps the state the coordinator chose, and
      // clearing the number back out never un-pays anybody, because the money
      // is in the bank whatever the box now says.
      if ((value || other) && row.payment_status === 'unpaid') {
        patch.payment_status = 'paid';
        patch.amount_paid_cents = before.amount_due_cents || 0;
      }
    } else {
      return fail(400, 'That is not a field on this list.');
    }

    if (Object.keys(fieldPatch).length) {
      // The market's own three coordinator fields live in `fields_json`
      // alongside everything else the application carries — merged, never
      // replaced, so a save here cannot drop what the vendor typed.
      patch.fields_json = JSON.stringify({ ...registrationFields(before), ...fieldPatch });
    }

    await updateRegistration(env, id, patch);
    const beforeState = { table_number: before.table_number, payment_status: before.payment_status,
      amount_paid_cents: before.amount_paid_cents, qty: before.qty,
      category: row.category, check_no: row.check_no, check_date: row.check_date,
      waitlisted: row.waitlisted };
    const afterRow = marketRowFromRegistration({ ...before, ...patch });
    await logAudit(env.DB, currentUser, 'update', 'market_vendor', String(id), before.contact_name,
      beforeState,
      { table_number: afterRow.table_number, payment_status: afterRow.payment_status,
        amount_paid_cents: afterRow.amount_paid_cents, qty: afterRow.tables,
        category: afterRow.category, check_no: afterRow.check_no, check_date: afterRow.check_date,
        waitlisted: afterRow.waitlisted });

    if (wantsJson) {
      // The cell that saved gets back the row as it now stands, so the
      // payment pill, the money line and the check column can all be redrawn
      // from what was actually STORED rather than from what the browser hoped
      // it had sent. A cell that says "saved" over a value the database does
      // not hold is the one failure this design must not have.
      return new Response(JSON.stringify({ ok: true, row: vendorCellState(afterRow) }),
        { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent('Saved · written to the audit log') } });
  }

  // ── A VENDOR ENTERED BY HAND ─────────────────────────────────────────────
  // See manualAddPanel() above for who this is for. The row it creates is
  // ordinary in every other way — it appears in the list, sorts, filters,
  // exports and can be edited exactly like a real application — except that
  // it starts `payment_status: 'waived'` and asks for nothing, so it never
  // reaches the unpaid band or the coordinator's chase list.
  //
  // ⚠ NEVER COUNTS AGAINST THE CONFIRMED-TABLES PAUSE AS A WAITLIST ROW. A
  // ministry the coordinator is adding by hand is a decision she has already
  // made, not a public application arriving after the pause — it is inserted
  // `waitlisted: 0`, occupying a real table the same as any paid one, so the
  // "Tables confirmed" tile and the pause itself both count it honestly.
  if (path === '/market/add' && method === 'POST') {
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const businessName = cap(form.get('business_name'), 200);
    if (!businessName) {
      return new Response('', { status: 302, headers: { Location: '/market?msg=addname' } });
    }
    const tables = clampTables(form.get('tables'), 20);
    const value = {
      participant_names: cap(form.get('participant_names'), 300) || businessName,
      business_name: businessName,
      website_or_social: '', returning_vendor: '', email: '', phone: '',
      street: '', city: '', state: '', zip: '',
      product_description: '', sells_food: 0, appliances_power: '', special_requests: '',
      tables, signature_name: currentUser?.username || 'staff', payment_method: 'card',
    };
    const price = priceBreakdown(tables, settings);
    const args = marketInsertArgs(value, price, [], { waitlisted: false });
    // Waived, and nothing owed — the whole reason this door exists.
    args.payment_status = 'waived';
    args.amount_due_cents = 0;
    args.amount_paid_cents = 0;
    const notes = cap(form.get('staff_notes'), 2000);
    if (notes) args.staff_notes = notes;
    const category = cleanCategory(form.get('category'));
    if (category) args.fields = { ...args.fields, category };

    const id = await insertRegistration(env, args);
    await logAudit(env.DB, currentUser, 'create', 'market_vendor', String(id), businessName,
      null, { business_name: businessName, tables, payment_status: 'waived', category });
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent(`${businessName} added, fee waived · written to the audit log`) } });
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

  // ── SHOWING OR HIDING THE VOLUNTEERS TAB ─────────────────────────────────
  // `has_volunteers` already existed as a capability flag on `site_events` —
  // the generic events admin only ever sets it once, at creation, and never
  // offers a way back. The market's own row was seeded with it ON, and
  // nothing here ever read it at all: the Volunteers tab showed to every
  // canMarket account regardless. This is the door that was missing — a real
  // toggle, same shape and same permission as "Taking vendor applications"
  // right above it, so the coordinator can turn off the Serve read-out for a
  // year the market isn't using it without losing anything else on the
  // screen.
  //
  // ⚠ SWITCHED OFF, THE TAB IS ABSENT FROM `TABS`, NOT DISABLED — same rule
  // every other tab on this screen follows. `active` then falls back to the
  // first tab this reader can still open, so nobody lands on a dead link.
  if (path === '/market/volunteers-tab' && method === 'POST') {
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const enabled = form.getAll('volunteers_enabled').includes('1') ? 1 : 0;
    await env.DB.prepare("UPDATE site_events SET has_volunteers = ?, updated_at = datetime('now') WHERE id = 'christmasmarket'").bind(enabled).run();
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_volunteers_enabled', 'Volunteers tab',
      { value: settings.volunteersEnabled ? '1' : '0' }, { value: String(enabled) });
    return new Response('', {
      status: 302,
      headers: { Location: '/market?toast=' + encodeURIComponent(enabled === 1 ? 'The Volunteers tab is showing again' : 'The Volunteers tab is hidden — nothing about the market itself changed') },
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
    // ── HOW MANY TABLES THE MARKET WILL TAKE, TOTAL ──────────────────────
    // Two numbers, not one, because "confirmed and paying" and "the market
    // is entirely full" are different facts. `market_confirmed_cap` (60) is
    // where a new application stops being taken at face value and starts
    // being held as a soft reserve instead — no payment link, nothing
    // charged — until a table frees up or the coordinator confirms one by
    // hand. `market_hard_cap` (70) is the absolute ceiling PAST the soft
    // reserve; once confirmed-plus-reserved tables would exceed it, the
    // application form refuses outright. A blank confirmed cap means
    // uncapped, same as every other event's registration_cap.
    const confirmedCap = form.get('market_confirmed_cap')
      ? Math.max(0, parseInt(form.get('market_confirmed_cap'), 10) || 0) : null;
    const softReserveOn = form.getAll('market_soft_reserve_enabled').includes('1') ? 1 : 0;
    const hardCap = form.get('market_hard_cap')
      ? Math.max(0, parseInt(form.get('market_hard_cap'), 10) || 0) : null;

    const before = {
      market_date_label: settings.dateLabel, market_hours_label: settings.hoursLabel,
      market_table_fee: String(settings.tableFee), market_max_tables: String(settings.maxTables),
      market_fee_percent: String(settings.feePercent), market_fee_fixed: String(settings.feeFixed),
      market_coordinator_email: settings.coordinatorEmail,
      market_confirmed_cap: String(settings.registrationCap), market_soft_reserve_enabled: settings.waitlistEnabled ? '1' : '0',
      market_hard_cap: String(settings.waitlistCap),
    };
    const after = {
      market_date_label: dateLabel, market_hours_label: hoursLabel,
      market_table_fee: String(tableFee), market_max_tables: String(maxTables),
      market_fee_percent: String(feePercent), market_fee_fixed: String(feeFixed),
      market_coordinator_email: coordinatorEmail,
      market_confirmed_cap: String(confirmedCap), market_soft_reserve_enabled: String(softReserveOn),
      market_hard_cap: String(hardCap),
    };
    await env.DB.prepare(
      `UPDATE site_events SET date_label = ?, hours_label = ?, fee_amount = ?, max_qty = ?,
         fee_percent = ?, fee_fixed = ?, coordinator_email = ?,
         registration_cap = ?, waitlist_enabled = ?, waitlist_cap = ?,
         updated_at = datetime('now'), updated_by = ?
       WHERE id = 'christmasmarket'`
    ).bind(dateLabel, hoursLabel, tableFee, maxTables, feePercent, feeFixed, coordinatorEmail,
      confirmedCap, softReserveOn, hardCap, currentUser?.username || null).run();
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
      { key: 'volunteers', label: 'Volunteers', on: canMarket && settings.volunteersEnabled },
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
    let alertHtml = '';
    // ⚠ Only the ACTIVE tab is built. Rendering all five and hiding four would
    // read every vendor's home address, every page's blocks and the volunteer
    // roster on every single view of this screen, to throw four fifths of it
    // away — and it would put PII in the markup of a tab somebody opened for
    // photographs.
    if (active === 'vendors' && canMarket) {
      const rows = await allApplications(env);

      const active = rows.filter((r) => r.payment_status !== 'dropped');
      const counts = {
        tables: active.reduce((a, r) => a + (r.tables || 0), 0),
        // Confirmed and reserved are the same two sets capacityDecision()
        // itself weighs — see the settings panel's own two numbers below.
        confirmedTables: active.filter((r) => !r.waitlisted).reduce((a, r) => a + (r.tables || 0), 0),
        reserveTables: active.filter((r) => r.waitlisted).reduce((a, r) => a + (r.tables || 0), 0),
        reserveCount: active.filter((r) => r.waitlisted).length,
        unpaid: rows.filter((r) => r.payment_status === 'unpaid').length,
        // ⚠ "Waiting on a card" and "checks not in yet" are two different
        // problems with two different answers — one is an email, the other is
        // a walk to the office mailbox — and before this they were one number
        // that could only ever say "unpaid".
        unpaidCard: rows.filter((r) => r.payment_status === 'unpaid' && r.payment_method !== 'check').length,
        checkOut: rows.filter((r) => checkState(r).pending).length,
        collectedCents: rows.reduce((a, r) => a + (r.amount_paid_cents || 0), 0),
        askedCents: active.reduce((a, r) => a + (r.amount_due_cents || 0), 0),
      };

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
        <form method="POST" action="/market/volunteers-tab" style="margin:16px 0 0;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
          <input type="hidden" name="volunteers_enabled" value="0">
          <label class="tlc-toggle">
            <input type="checkbox" name="volunteers_enabled" value="1"${settings.volunteersEnabled ? ' checked' : ''}>
            <span class="tlc-toggle-track"><span class="tlc-toggle-knob"></span></span>
            <span class="tlc-toggle-label">Volunteers tab</span>
            <span class="tlc-toggle-state" data-on="Showing" data-off="Hidden">${settings.volunteersEnabled ? 'Showing' : 'Hidden'}</span>
          </label>
          <button type="submit" class="tlc-btn-primary">Save</button>
        </form>
        <p class="tlc-hint" style="margin-top:8px;">Off hides the Volunteers tab above — it reads live from Serve (serve.timothystl.org) and is worth switching off if the market isn't using Serve for its roster this year. Nothing about the market's own vendors or pages is affected either way.</p>
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

      const tile = (label, n, note, tone) =>
        `<div class="tlc-tile${tone ? ' tlc-tile--' + tone : ''}"><div class="tlc-tile-label">${escapeHtml(label)}</div>`
        + `<div class="tlc-tile-num">${escapeHtml(String(n))}</div>`
        + `<div class="tlc-tile-note">${escapeHtml(note)}</div></div>`;

      // ⚠ The fourth tile is the new one, and it is amber rather than plain
      // because it is the only one of the four that is a job of work. The
      // other three are the state of the market; this one is a list of
      // people the coordinator has to go and find.
      //
      // ⚠ THE FIRST TILE SPLITS INTO TWO NUMBERS ONLY ONCE THERE IS A CAP TO
      // SPLIT AGAINST. A market running uncapped has no "confirmed vs.
      // reserved" distinction to draw — every table is simply confirmed —
      // and showing "0 on the waiting list" on a market that has never had
      // one is the same dead-control failure this admin warns about
      // elsewhere: a number that can only ever read zero teaches nobody
      // anything.
      const tilesFirst = settings.registrationCap
        ? tile('Tables confirmed', counts.confirmedTables,
            `of ${settings.registrationCap} before the pause${counts.reserveTables ? ` · ${counts.reserveTables} on the waiting list` : ''}`,
            counts.confirmedTables >= settings.registrationCap ? 'warn' : undefined)
        : tile('Tables asked for', counts.tables, `${rows.length} application${rows.length === 1 ? '' : 's'}, dropped-out excluded`);

      const tiles = `<div class="tlc-tiles">
        ${tilesFirst}
        ${tile('Recorded as paid', money(counts.collectedCents), `of ${money(counts.askedCents)} asked for`)}
        ${tile('Waiting on a card', counts.unpaidCard, 'Applied online and never finished paying')}
        ${tile('Checks not in yet', counts.checkOut, 'Said they would mail or bring one', 'warn')}
      </div>`;

      // ⚠ THE UNPAID CASE STILL HAS TO SAY WHAT IT COSTS. The list this
      // replaced grew a warning row under every unpaid vendor saying their
      // space was not held; a table whose whole point is that the rows are
      // dense has no room for seventy of those, and the tiles above already
      // count them. What must NOT be lost is the sentence — somebody who
      // applied and never finished at the card page is the one thing this
      // screen exists to surface, because the Google Form it replaced could
      // not see them at all. So it is said once, over the list, with the
      // filter that isolates them one click away.
      const unpaidBand = counts.unpaid
        ? `<div class="alert alert-warn tlc-mkt-band">
            <strong>${counts.unpaid} application${counts.unpaid === 1 ? ' has' : 's have'} no payment recorded.</strong>
            Their spaces are not held until it arrives.
            ${counts.checkOut ? `${counts.checkOut} of them said they would send a check — those are the amber ones.` : ''}
            <button type="button" class="tlc-mkt-bandlink" data-mktfilter="unpaid">Show only those</button>
          </div>`
        : '';

      // Confirmed tables paused at the cap, so this many are a soft
      // reserve rather than a normal application — no payment link was
      // ever sent, and nothing is charged until the coordinator confirms
      // one from its own row (the "Confirm table" button next to its
      // name), which is what opens it to payment.
      const reserveBand = counts.reserveCount
        ? `<div class="alert alert-warn tlc-mkt-band">
            <strong>${counts.reserveCount} application${counts.reserveCount === 1 ? ' is' : 's are'} on the waiting list</strong>
            (${counts.reserveTables} table${counts.reserveTables === 1 ? '' : 's'}) — confirmed tables were full when they applied, so no payment was asked for.
            <button type="button" class="tlc-mkt-bandlink" data-mktfilter="waitlist">Show only those</button>
          </div>`
        : '';

      alertHtml = msg === 'gone'
        ? `<div class="alert alert-warn">That application is no longer there — somebody may have deleted it.</div>`
        : msg === 'addname'
        ? `<div class="alert alert-warn">A ministry or group name is needed to add a vendor by hand.</div>` : '';

      vendorSection = `<section class="tlc-section tlc-mkt-section" data-mkt="1">
        <header class="tlc-section-head">
          <div class="tlc-section-headings">
            <h1 class="tlc-title">${escapeHtml(cfg.title)}</h1>
            <p class="tlc-purpose">${escapeHtml(cfg.purpose)}</p>
          </div>
          <div class="tlc-section-actions">
            <a class="tlc-action" href="/market/export.csv">${escapeHtml(cfg.action)}</a>
          </div>
        </header>
        ${tiles}
        ${openPanel}
        ${manualAddPanel(settings)}
        ${unpaidBand}
        ${reserveBand}
        ${vendorTable(rows, settings, cfg)}
      </section>`;
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
        ${renderField({ kind: 'number', name: 'market_confirmed_cap', label: 'Pause confirmed tables at (blank = uncapped)', value: settings.registrationCap, min: 0, step: 1,
          hint: 'Once this many tables have been asked for, a new application stops being taken at face value — see Soft reserve below.' })}
        <label class="tlc-toggle" style="margin:10px 0;">
          <input type="hidden" name="market_soft_reserve_enabled" value="0">
          <input type="checkbox" name="market_soft_reserve_enabled" value="1"${settings.waitlistEnabled ? ' checked' : ''}>
          <span class="tlc-toggle-track"><span class="tlc-toggle-knob"></span></span>
          <span class="tlc-toggle-label">Soft reserve once the pause is reached</span>
          <span class="tlc-toggle-state" data-on="On" data-off="Off">${settings.waitlistEnabled ? 'On' : 'Off'}</span>
        </label>
        <p class="tlc-hint" style="margin:-4px 0 12px;">A vendor applying past the pause is put on a waiting list instead of being turned away — the application is saved, no payment link is offered and nothing is charged, until the coordinator confirms one by hand from the Vendors tab. Off means the pause above simply refuses anything past it.</p>
        ${settings.waitlistEnabled ? renderField({ kind: 'number', name: 'market_hard_cap', label: 'Absolute maximum, waiting list included (blank = unbounded)', value: settings.waitlistCap, min: 0, step: 1,
          hint: 'The market’s own hard ceiling — 70 tables is the most the space can physically hold. Once confirmed plus the waiting list would reach it, the application form refuses outright rather than adding another name to the list.' })
          // ⚠ HIDDEN, NOT OMITTED, WHEN THE TOGGLE IS OFF. Switching the
          // reserve off collapses this field out of the form; without a
          // hidden carrier the route would read no `market_hard_cap` at all
          // and quietly clear the number back to blank the moment the
          // coordinator saved with the toggle off — losing the figure she
          // typed for no reason connected to what she actually changed.
          : `<input type="hidden" name="market_hard_cap" value="${escapeHtml(String(settings.waitlistCap ?? ''))}">`}
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
    if (active === 'volunteers' && canMarket && settings.volunteersEnabled) {
      const { vol, volError } = await fetchRoster(env);

      const roster = normalizeRoster(vol || {});
      // ⚠ THE DAY SWITCH IS NOT DRAWN WHEN THERE IS ONE DAY. Friday setup and
      // Saturday market are different days with different crews, and Serve
      // will send a date per shift once it can — but it does not today, and a
      // chooser with one thing in it is a control that cannot do anything.
      const days = roster.days;
      const wantDay = String(url.searchParams.get('day') || '');
      const day = days.find((d) => d.key === wantDay) || days[0];
      const dayLabel = day.label || settings.dateLabel || 'the market';
      const shifts = day.shifts;
      const untimedHere = shifts.filter((s) => !s.timed).length;

      const wantView = String(url.searchParams.get('view') || '');
      const view = VOL_VIEWS.some((v) => v.key === wantView) ? wantView : 'job';
      const axis = url.searchParams.get('axis') === 'time' ? 'time' : 'jobs';
      const printKind = ['leads', 'time', 'people', 'grid'].includes(String(url.searchParams.get('print') || ''))
        ? String(url.searchParams.get('print')) : '';
      const printJob = String(url.searchParams.get('job') || '');

      // Every control on this tab is a link, so each one needs the address it
      // would produce — this is that, with the day carried along unless the
      // control IS the day switch.
      const qs = (extra, keepDay = true) => {
        const p = new URLSearchParams({ tab: 'volunteers' });
        if (keepDay && day.key !== 'all') p.set('day', day.key);
        Object.entries(extra || {}).forEach(([k, v]) => { if (v) p.set(k, v); });
        return '/market?' + p.toString();
      };
      const base = qs({ view, axis: axis === 'time' ? 'time' : '' });

      // ── A PRINT ADDRESS RENDERS THE SHEET AND NOTHING ELSE ──────────────
      // Not a modal: this way the sheet survives a reload, can be handed to a
      // job lead as a link, and goes to the printer through the browser's own
      // Print — so nothing intercepts ⌘P, and there is no dialog that a page
      // inside a frame cannot dismiss.
      if (printKind && vol) {
        const sheetTitle = printKind === 'leads'
          ? (printJob ? `${printJob} — the lead's sheet` : 'one sheet per job lead')
          : printKind === 'time' ? 'the master list by time slot'
          : printKind === 'grid' ? 'the grid, hour by hour' : 'everybody coming';
        return html(`
${sidebarShell('market', currentUser, '', badges)}
<div class="tlc-wrap">
  <section class="tlc-section" style="max-width:none;">
    <div data-noprint="1" style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:22px;">
      <span class="tlc-mkt-quiet">Print preview — ${escapeHtml(sheetTitle)}. Everything on this page is what comes out; use your browser's Print.</span>
      <a class="tlc-action-quiet" href="${escapeHtml(base)}">Back to the roster</a>
    </div>
    ${printSheets(printKind, shifts, dayLabel, printJob, axis)}
  </section>
</div>`, 'Christmas Market — print');
      }

      const tile = (label, n, note, tone) =>
        `<div class="tlc-tile${tone ? ' tlc-tile--' + tone : ''}"><div class="tlc-tile-label">${escapeHtml(label)}</div>`
        + `<div class="tlc-tile-num">${escapeHtml(String(n))}</div>`
        + `<div class="tlc-tile-note">${escapeHtml(note)}</div></div>`;

      const people = peopleFor(shifts);
      const needed = shifts.reduce((a, s) => a + s.needed, 0);
      const filled = shifts.reduce((a, s) => a + s.filled, 0);
      const thinnest = slotsFor(shifts).slice().sort((a, b) => b.short - a.short)[0];

      const viewBody = view === 'time' ? volByTime(shifts, untimedHere)
        : view === 'grid' ? volGrid(shifts, axis)
        : view === 'people' ? volPeople(shifts)
        : volByJob(shifts, base);

      const axisBar = view === 'grid' && shifts.some((s) => s.timed) ? `
        <div data-noprint="1" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:-4px 0 14px;">
          <span class="tlc-mkt-lbl" style="margin:0;">Across the top</span>
          ${segLink(qs({ view: 'grid' }), [{ key: 'jobs', label: 'Jobs' }, { key: 'time', label: 'Time slots' }], axis, 'axis')}
        </div>` : '';

      const dayBar = days.length > 1
        ? segLink(qs({ view, axis: axis === 'time' ? 'time' : '' }, false),
            days.map((d) => ({ key: d.key, label: d.label || 'The market' })), day.key, 'day')
        : '';

      const printBtn = (kind, label) =>
        `<a class="tlc-action-quiet" href="${escapeHtml(qs({ view, print: kind, axis: axis === 'time' ? 'time' : '' }))}">${escapeHtml(label)}</a>`;

      volunteersSection = `<section class="tlc-section" style="max-width:1460px;">
        <header class="tlc-section-head" data-noprint="1">
          <div class="tlc-section-headings">
            <h1 class="tlc-title">Volunteers</h1>
            <p class="tlc-purpose">Who is covering the market, read from Serve. Shifts are set up and changed there — this is a window on them, and the place you print from.</p>
          </div>
          <div class="tlc-section-actions"><a class="tlc-action" href="https://serve.timothystl.org/christmasmarket" target="_blank" rel="noopener">Manage shifts in Serve</a></div>
        </header>`
        + (vol
          ? `<div class="tlc-tiles" data-noprint="1">
              ${tile('Signed up', people.length, `People who have taken a shift${day.label ? ' ' + day.label.split(',')[0] : ''}`)}
              ${tile('Spots filled', `${filled} of ${needed}`, `Across ${shifts.length} shift${shifts.length === 1 ? '' : 's'}`)}
              ${tile('Still needed', Math.max(0, needed - filled), 'Spots with nobody in them yet', Math.max(0, needed - filled) ? 'warn' : '')}
              ${tile('Thinnest hour', thinnest ? fmtShortMer(thinnest.start) : '—',
                thinnest ? `${thinnest.short} short across ${thinnest.entries.length} job${thinnest.entries.length === 1 ? '' : 's'}` : 'Every slot is covered')}
            </div>
            <div class="tlc-vol-bar" data-noprint="1">
              ${dayBar}
              ${segLink(qs({ axis: axis === 'time' ? 'time' : '' }), VOL_VIEWS, view, 'view')}
              <span class="tlc-vol-prints">
                ${printBtn('leads', 'Print job-lead sheets')}
                ${printBtn('people', 'Print master list')}
                ${printBtn('time', 'Print by time slot')}
                ${printBtn('grid', 'Print the grid')}
                <a class="tlc-action" href="/market/volunteers.csv"
                  title="One row per person per shift across both days, plus a row for every spot nobody has taken">Export CSV</a>
              </span>
            </div>
            ${axisBar}
            ${viewBody}`
          : `<div class="alert alert-warn">Counts are not available right now — ${escapeHtml(volError || 'Serve did not answer.')} Nothing is wrong with the market itself; the roster lives in Serve and is still there, behind the button above.</div>`)
        + `</section>`;
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
    // config panels need SOME header, since the vendor tab normally supplies
    // it, so a bare one stands in for exactly that case.
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
