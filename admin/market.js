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

const num = (v, fallback) => {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

// ── WHAT THE COORDINATOR TRACKS ──────────────────────────────────────────────
// The four states Marla kept by hand in the 2024 spreadsheet's payment column.
// `waived` is a real one, not a courtesy: Timothy MDO, the Word of Life 8th
// grade and the youth group take tables at no charge, and recording that as
// "unpaid" would leave three rows on a chase list forever.
export const PAYMENT_STATES = [
  { value: 'unpaid', label: 'Not paid yet', tone: 'warn' },
  { value: 'paid', label: 'Paid', tone: 'good' },
  // `auto` rather than `good`: a waived fee is a decision the office made, not
  // money that arrived, and coloring it the same green as Paid would make a
  // reconciliation read right when it does not balance.
  { value: 'waived', label: 'Fee waived', tone: 'auto' },
  { value: 'dropped', label: 'Dropped out', tone: 'plain' },
];
export const paymentState = (v) => PAYMENT_STATES.find((s) => s.value === v) || PAYMENT_STATES[0];

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
// Pure — takes the `site_settings` rows however they were fetched, and
// composes the shape every caller wants. Split out so `pageData()` in the
// Worker (which already fetches every page's settings in one batched
// Promise.all, precisely to avoid a query per block) can compose `data.market`
// from rows it already has, rather than this module making its own second
// round trip on every single page render.
export function marketConfigFromRows(rows) {
  const get = (k, d) => {
    const row = (rows || []).find((r) => r.key === k);
    const v = row && row.value != null ? String(row.value).trim() : '';
    return v === '' ? d : v;
  };
  return {
    tableFee: num(get('market_table_fee', ''), MARKET_DEFAULTS.tableFee),
    feePercent: num(get('market_fee_percent', ''), MARKET_DEFAULTS.feePercent),
    feeFixed: num(get('market_fee_fixed', ''), MARKET_DEFAULTS.feeFixed),
    maxTables: clampTables(get('market_max_tables', String(MARKET_DEFAULTS.maxTables)), 9),
    fundId: get('market_fund_id', ''),
    coordinatorEmail: get('market_coordinator_email', 'tlc.christmasmarket@gmail.com'),
    dateLabel: get('market_date_label', 'Saturday, Dec 5'),
    hoursLabel: get('market_hours_label', '11:00 am – 6:00 pm'),
    // ⚠ Open by default. A market page that ships switched off looks broken to
    // whoever opens it first, and the only way in is a link from
    // /christmasmarket — nobody stumbles onto it out of season. The switch is
    // on the coordinator's own screen, where she will see it.
    open: get('market_applications_open', '1') !== '0',
    giveUrl: get('give_url', ''),
    // 'tithely' (the default — every existing church payment link) or
    // 'square', for the market's own separate Square account.
    paymentProvider: get('market_payment_provider', 'tithely') === 'square' ? 'square' : 'tithely',
    // One Square Payment Link per table count, keyed by the table count as a
    // string ("1", "2", "3", …). ⚠ Square has no way to put an amount in a
    // link the way Tithe.ly does, so unlike `fundId`+`giveUrl` this cannot be
    // computed from one base link — the office pastes one link per price
    // point, which is small and fixed because `maxTables` bounds it (3 by
    // default, 9 at most). Malformed JSON reads as "no links yet" rather than
    // throwing, same as every other best-effort read in this file.
    squareLinks: (() => {
      try {
        const parsed = JSON.parse(get('market_square_links', '{}'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_) { return {}; }
    })(),
  };
}

export async function marketSettings(env) {
  let rows = [];
  try {
    rows = (await env.DB.prepare("SELECT key, value FROM site_settings WHERE key LIKE 'market_%' OR key = 'give_url'").all()).results || [];
  } catch (_) { /* fall through to the defaults below */ }
  return marketConfigFromRows(rows);
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
<p style="margin:12px 0 0"><strong>Asked to pay:</strong> ${escapeHtml(money(totalCents))}</p>
<p style="margin:12px 0 0;font-size:13px;color:#4A4860">Whether they actually paid is not something the website can see — mark it on the vendor list in the admin.</p>`;
}

export function vendorEmailHtml(v, { totalCents, payUrl, settings }) {
  return `<p>Hi ${escapeHtml(v.participant_names)},</p>
<p>Thank you for applying for a table at the Timothy Christmas Market on ${escapeHtml(settings.dateLabel)}, ${escapeHtml(settings.hoursLabel)}.</p>
<p>You asked for <strong>${v.tables} table${v.tables === 1 ? '' : 's'}</strong>, which comes to <strong>${escapeHtml(money(totalCents))}</strong> including the card processing fee.</p>
${payUrl ? `<p><strong>Your space is held once payment arrives.</strong> If you closed the payment page before finishing, you can pay here: <a href="${escapeHtml(payUrl)}">${escapeHtml(money(totalCents))} for your table${v.tables === 1 ? '' : 's'}</a>.</p>` : ''}
<p>Marla, our market coordinator, will confirm your table number by email. If you would rather pay by check or cash, or you need to change anything, reply to this message or write to <a href="mailto:${escapeHtml(settings.coordinatorEmail)}">${escapeHtml(settings.coordinatorEmail)}</a>.</p>
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
  const canMarket = hasPermission(currentUser, 'market_manage');
  const canSettings = hasPermission(currentUser, 'settings_manage');
  const canGiving = hasPermission(currentUser, 'giving_manage');
  if (!canMarket && !canSettings && !canGiving) {
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
    const head = ['Table #', 'Payment', 'Participants', 'Business', 'Tables', 'Amount asked', 'Amount paid',
      'Email', 'Phone', 'Street', 'City', 'State', 'ZIP', 'Website or social', 'Returning',
      'What they sell', 'Food', 'Appliances / power', 'Special requests', 'Agreed as', 'Applied', 'Staff notes'];
    const body = rows.map((r) => [
      t(r.table_number), t(paymentState(r.payment_status).label), t(r.participant_names), t(r.business_name),
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
    const before = await env.DB.prepare('SELECT * FROM market_vendors WHERE id = ?').bind(id).first().catch(() => null);
    if (!before) return new Response('', { status: 302, headers: { Location: '/market?msg=gone' } });

    const status = paymentState(String(form.get('payment_status') || '')).value;
    const tableNumber = cap(form.get('table_number'), 40);
    const notes = cap(form.get('staff_notes'), 2000);
    // Blank means "we have not recorded a payment", which is a different fact
    // from "they paid nothing" — so it stays NULL rather than becoming 0.
    const paidRaw = trim(form.get('amount_paid'));
    const paidCents = paidRaw === '' ? null : Math.round(num(paidRaw, 0) * 100);

    await env.DB.prepare(
      'UPDATE market_vendors SET table_number = ?, payment_status = ?, amount_paid_cents = ?, staff_notes = ? WHERE id = ?'
    ).bind(tableNumber || null, status, paidCents, notes || null, id).run();
    await logAudit(env.DB, currentUser, 'update', 'market_vendor', String(id), before.participant_names,
      { table_number: before.table_number, payment_status: before.payment_status, amount_paid_cents: before.amount_paid_cents },
      { table_number: tableNumber || null, payment_status: status, amount_paid_cents: paidCents });
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent('Saved · written to the audit log') } });
  }

  if (path === '/market/delete' && method === 'POST') {
    if (!canMarket) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const id = Number(form.get('id') || 0);
    const before = await env.DB.prepare('SELECT * FROM market_vendors WHERE id = ?').bind(id).first().catch(() => null);
    if (before) {
      await env.DB.prepare('DELETE FROM market_vendors WHERE id = ?').bind(id).run();
      await logAudit(env.DB, currentUser, 'delete', 'market_vendor', String(id), before.participant_names, before, null);
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
    const open = form.getAll('open').includes('1') ? '1' : '0';
    await env.DB.prepare("INSERT INTO site_settings (key, value) VALUES ('market_applications_open', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(open).run();
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_applications_open', 'Vendor applications',
      { value: settings.open ? '1' : '0' }, { value: open });
    return new Response('', {
      status: 302,
      headers: { Location: '/market?toast=' + encodeURIComponent(open === '1' ? 'Applications are open · the page can take payments' : 'Applications are closed · the page says so and takes nothing') },
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
  if (path === '/market/settings' && method === 'POST') {
    if (!canSettings) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const fields = {
      market_date_label: cap(form.get('market_date_label'), 80),
      market_hours_label: cap(form.get('market_hours_label'), 80),
      market_table_fee: cap(form.get('market_table_fee'), 20),
      market_max_tables: cap(form.get('market_max_tables'), 4),
      market_fee_percent: cap(form.get('market_fee_percent'), 20),
      market_fee_fixed: cap(form.get('market_fee_fixed'), 20),
      market_coordinator_email: cap(form.get('market_coordinator_email'), 200),
    };
    const before = {};
    for (const k of Object.keys(fields)) {
      const row = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(k).first().catch(() => null);
      before[k] = row?.value ?? null;
    }
    for (const [k, v] of Object.entries(fields)) {
      await env.DB.prepare(
        'INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(k, v).run();
    }
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_settings', 'Christmas Market settings', before, fields);
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
    const before = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'market_fund_id'").first();
    await env.DB.prepare(
      "INSERT INTO site_settings (key, value) VALUES ('market_fund_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(val).run();
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_fund_id', 'Christmas Market fund',
      { value: before?.value ?? null }, { value: val });
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
    const beforeProvider = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'market_payment_provider'").first();
    const beforeLinks = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'market_square_links'").first();
    await env.DB.prepare(
      "INSERT INTO site_settings (key, value) VALUES ('market_payment_provider', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(provider).run();
    await env.DB.prepare(
      "INSERT INTO site_settings (key, value) VALUES ('market_square_links', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(linksJson).run();
    await logAudit(env.DB, currentUser, 'update', 'settings', 'market_payment_provider', 'Christmas Market payment method',
      { provider: beforeProvider?.value ?? null, square_links: beforeLinks?.value ?? null },
      { provider, square_links: linksJson });
    return new Response('', { status: 302, headers: { Location: '/market?toast=' + encodeURIComponent('Saved · written to the audit log') } });
  }

  if (path === '/market' && method === 'GET') {
    const msg = url.searchParams.get('msg');
    const cfg = sectionCfg('market');

    // ── EVERYTHING BELOW IS canMarket ONLY. Somebody who reached this page on
    // settings_manage or giving_manage alone gets none of it — not the
    // vendor list, not the applications toggle, not even the counts, all of
    // which are the coordinator's own PII-adjacent view of the event. The
    // ⚠ above the permission gate is the reasoning; this is where it is
    // actually enforced for the read side.
    let vendorSection = '';
    let vendorDrawer = '';
    let alertHtml = '';
    if (canMarket) {
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
            statusPill(st.tone, st.label),
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
      `, canSettings || canGiving ? { right: '<a class="tlc-action-quiet" href="#market-config">Fees, dates &amp; payment</a>' } : {});

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
    const settingsPanel = canSettings ? panel('Market settings', `
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
    const paymentPanel = canGiving ? panel('Payment', `
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

    const configSection = (settingsPanel || paymentPanel)
      ? `<div id="market-config" style="margin-top:24px;display:grid;grid-template-columns:${settingsPanel && paymentPanel ? '1fr 1fr' : '1fr'};gap:20px;">
          ${settingsPanel}${paymentPanel}
        </div>`
      : '';

    // A visitor with no market_manage sees no vendor list at all — the
    // config panels need SOME header, since renderListSection normally
    // supplies it, so a bare one stands in for exactly that case.
    const bareHeader = !canMarket ? `<header class="tlc-section-head">
        <div class="tlc-section-headings">
          <h1 class="tlc-title">${escapeHtml(cfg.title)}</h1>
          <p class="tlc-purpose">Christmas Market settings and payment — the vendor list itself needs the Christmas Market vendors permission.</p>
        </div>
      </header>` : '';

    return html(`
${sidebarShell('market', currentUser, `<a href="https://timothystl.org/christmasmarket/vendors" target="_blank">View the vendor page</a>`, badges)}
<div class="tlc-wrap">
  ${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
  ${bareHeader}
  ${vendorSection}
  ${vendorDrawer}
  ${configSection}
</div>`, 'Christmas Market');
  }

  return null;
}

async function allApplications(env) {
  try {
    return (await env.DB.prepare(
      `SELECT * FROM market_vendors
       ORDER BY CASE payment_status WHEN 'unpaid' THEN 0 ELSE 1 END, created_at DESC, id DESC`
    ).all()).results || [];
  } catch (_) { return []; }
}

export function photosOf(r) {
  try {
    const list = JSON.parse(r.photos || '[]');
    return Array.isArray(list) ? list.filter((u) => typeof u === 'string' && u) : [];
  } catch (_) { return []; }
}
