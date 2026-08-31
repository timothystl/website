// The Christmas Market vendor application — run with: node admin/market.test.mjs
//
// Two things are worth testing here and they are not the same thing.
//
// The first is the MONEY, and the assertion that matters is not "one table is
// $31.20" — it is "the church receives the whole table fee". A figure pinned to
// a literal goes green forever the moment somebody copies the wrong literal in;
// the property is what says the gross-up is doing its job, and it is what
// caught the handoff's own third figure being a penny short.
//
// The second is the MIRROR. The arithmetic exists twice — once here for the
// server, once as a string shipped to the browser so the three-step card can
// retotal without a round trip — and the only thing that makes a mirror safe
// rather than a second chance to be wrong is that both run over the same table
// of inputs in the same test.

import {
  MARKET_DEFAULTS, MARKET_PRICING_JS, priceBreakdown, clampTables, money,
  sanitizeApplication, screenableText, paymentState, PAYMENT_STATES, marketPayUrl, photosOf,
  marketRowFromRegistration, marketInsertArgs, paymentLabel,
  coordinatorEmailHtml, vendorEmailHtml,
  VENDOR_CATEGORIES, cleanCategory, checkState, vendorCellState,
  parseClock, parseShiftLabel, fmtClock, fmtRange, fmtDay,
  normalizeRoster, jobsFor, slotsFor, peopleFor, volunteerCsvRows, volunteerCsv,
  setSignupsOpen,
} from './market.js';
import { capacityDecision } from './events.js';

import { execFileSync } from 'node:child_process';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const CFG = { ...MARKET_DEFAULTS };

// ── the property the gross-up exists for ─────────────────────────────────────
group('the church receives the whole table fee');
{
  // What the processor actually keeps, to the cent, out of what the vendor
  // pays: 2.9% of the charge plus 30 cents, rounded to a cent the way a real
  // processor bills it.
  const processorTakes = (totalCents, cfg) =>
    Math.round(totalCents * (cfg.feePercent / 100)) + Math.round(cfg.feeFixed * 100);

  for (const tables of [1, 2, 3]) {
    const p = priceBreakdown(tables, CFG);
    const net = p.totalCents - processorTakes(p.totalCents, CFG);
    eq(net, tables * CFG.tableFee * 100,
      `${tables} table(s): the market nets the full $${tables * CFG.tableFee} after the card fee`);
    ok(p.totalCents > p.subtotalCents, `${tables} table(s): the vendor is asked for more than the bare fee`);
    eq(p.feeCents, p.totalCents - p.subtotalCents, `${tables} table(s): the fee line is the difference, not a second sum`);
  }

  // The 2024 anchor. This one IS worth pinning to a literal: it is not a
  // number this file computed, it is what a real vendor really paid, and it is
  // how the 2.9% + 30¢ rate was identified in the first place.
  eq(money(priceBreakdown(1, CFG).totalCents), '$31.20',
    'one table is $31.20 — the figure confirmed against a real 2024 payment');
  eq(money(priceBreakdown(2, CFG).totalCents), '$62.10', 'two tables is $62.10');

  // ⚠ The handoff says $92.99 here and it is wrong — that is the formula
  // truncated, and it leaves the church a penny short of $90, which is the one
  // thing the gross-up exists to prevent. The net assertion above is what
  // proves it; this pins the consequence so nobody "fixes" it back.
  eq(money(priceBreakdown(3, CFG).totalCents), '$93',
    'three tables is $93.00, not the handoff’s $92.99');
}

group('the arithmetic survives what somebody might type into Settings');
{
  eq(clampTables(0), 1, 'zero tables reads as one — nobody reaches the payment step wanting none');
  eq(clampTables(-4), 1, 'and so does a negative');
  eq(clampTables('two'), 1, 'and so does a word');
  eq(clampTables(99), 3, 'more than the maximum is clamped to it');
  eq(clampTables(99, 5), 5, 'and the maximum is the one configured, not a constant');
  eq(clampTables('2'), 2, 'a string from a form posts fine');

  // A processor taking 100% would divide by zero and ask for an infinite
  // amount. The honest answer is to charge the fee itself.
  const absurd = priceBreakdown(1, { ...CFG, feePercent: 100 });
  eq(absurd.totalCents, 3000, 'a 100% fee falls back to the table fee rather than asking for infinity');
  eq(absurd.feeCents, 0, 'and reports no fee rather than a nonsense one');

  const free = priceBreakdown(2, { tableFee: 0, feePercent: 2.9, feeFixed: 0.30 });
  ok(free.totalCents >= 0, 'a zero table fee does not go negative');

  eq(money(0), '$0', 'zero is $0');
  eq(money(3000), '$30', 'a whole dollar loses its trailing zeros');
  eq(money(3120), '$31.20', 'and cents are kept');
}

// ── the browser's copy cannot drift from this one ────────────────────────────
group('the client mirror agrees with the server, input for input');
{
  // Evaluated exactly as the browser gets it, then run over the same cases.
  const sandbox = {};
  new Function(MARKET_PRICING_JS + '; this.price = tlcMktPrice; this.money = tlcMktMoney; this.clamp = tlcMktClampTables;').call(sandbox);

  const CONFIGS = [
    CFG,
    { tableFee: 30, feePercent: 2.9, feeFixed: 0.30, maxTables: 3 },
    { tableFee: 35, feePercent: 2.6, feeFixed: 0.10, maxTables: 4 },   // a different processor
    { tableFee: 25, feePercent: 3.5, feeFixed: 0.49, maxTables: 2 },
    { tableFee: 30, feePercent: 0, feeFixed: 0, maxTables: 3 },        // no fee at all
  ];
  const INPUTS = [1, 2, 3, 4, 0, -1, '2', 'three', null, undefined, 99];

  let checked = 0;
  for (const cfg of CONFIGS) {
    for (const input of INPUTS) {
      const a = priceBreakdown(input, cfg);
      const b = sandbox.price(input, cfg);
      ok(a.tables === b.tables && a.subtotalCents === b.subtotalCents
        && a.feeCents === b.feeCents && a.totalCents === b.totalCents,
        `mirror agrees for ${JSON.stringify(input)} at ${cfg.feePercent}% + ${cfg.feeFixed}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      eq(sandbox.money(b.totalCents), money(a.totalCents), `and formats it the same way`);
      checked++;
    }
  }
  ok(checked === CONFIGS.length * INPUTS.length, `every combination was checked (${checked})`);

  // ⚠ The trap this file exists to catch: a template literal eats a regex
  // escape and the mirror silently starts doing something else. It happened
  // to admin/links.js's LINKS_JS. The mirror's money() carries `\.00$` and
  // would strip real cents if the backslash were lost.
  eq(sandbox.money(6210), '$62.10', 'the mirror’s decimal escape survived being a string inside a string');
}

// ── what an application has to carry, and what it must not demand ────────────
group('reading an application');
{
  const good = {
    participant_names: '  Marla Kerr and Sue  ',
    email: '  Marla@Example.COM ',
    phone: '(314) 555-0123',
    product_description: 'Handmade purses, tote bags, crochet shawls',
    signature_name: 'Marla Kerr',
    tables: '2',
  };
  const r = sanitizeApplication(good, CFG);
  ok(r.ok, 'a complete application passes');
  eq(r.value.participant_names, 'Marla Kerr and Sue', 'names are trimmed');
  eq(r.value.email, 'marla@example.com', 'and the email is lowercased so a duplicate is findable');
  eq(r.value.tables, 2, 'tables comes back as a number');
  eq(r.value.sells_food, 0, 'the food box is off unless it was ticked');
  eq(r.value.returning_vendor, '', 'and "sold with us before" is genuinely optional');

  // ⚠ Only five fields are required, and this is the assertion that keeps it
  // that way. Every extra required field is a maker who gives up halfway and
  // emails Marla instead — which is the workflow this page replaces.
  const bare = sanitizeApplication({ ...good, business_name: '', street: '', city: '', appliances_power: '' }, CFG);
  ok(bare.ok, 'no business name, no address and no appliance list is still a valid application');

  for (const [field, why] of [['participant_names', 'who is at the table'], ['email', 'an email'],
    ['phone', 'a phone number'], ['product_description', 'what they sell'], ['signature_name', 'the agreement signature']]) {
    const missing = sanitizeApplication({ ...good, [field]: '' }, CFG);
    ok(!missing.ok, `an application with no ${why} is refused`);
    ok(missing.errors[0] && !missing.errors[0].includes('_'),
      `and says so in a sentence rather than naming the ${field} column`);
  }

  const badEmail = sanitizeApplication({ ...good, email: 'marla at example' }, CFG);
  ok(!badEmail.ok, 'an unusable email address is caught here rather than bouncing later');

  // A vendor cannot ask for more tables than the market offers, whatever they
  // post — the buttons only go to three, but the buttons are not the guard.
  eq(sanitizeApplication({ ...good, tables: '40' }, CFG).value.tables, 3,
    'a posted table count above the maximum is clamped, not honored');

  eq(sanitizeApplication({ ...good, sells_food: '1' }, CFG).value.sells_food, 1, 'the food box is stored when ticked');
  eq(sanitizeApplication({ ...good, returning_vendor: 'maybe' }, CFG).value.returning_vendor, '',
    'and anything other than yes/no for "sold with us before" is dropped rather than stored');

  const long = sanitizeApplication({ ...good, product_description: 'x'.repeat(9000) }, CFG);
  ok(long.value.product_description.length <= 4000, 'a runaway paste is capped rather than stored whole');
}

group('what the spam filter is given to read');
{
  const text = screenableText({
    product_description: 'Handmade purses', special_requests: 'Near the door please',
    business_name: 'Kerr Bags', website_or_social: '@kerrbags',
  });
  ok(text.includes('Handmade purses'), 'the product description is scored — it is the field a pitch lands in');
  ok(text.includes('Near the door please'), 'and so are the special requests');
  eq(screenableText({ product_description: 'Only this' }), 'Only this', 'empty fields are left out rather than padding the text');
}

// ── the payment address is never a stored string ─────────────────────────────
group('the payment link is built, never kept');
{
  const settings = { giveUrl: 'https://give.tithe.ly/?formId=abc&fundId=general', fundId: 'market-fund' };
  const url = marketPayUrl(settings, 3120);
  ok(url.includes('amount=3120'), 'the amount is appended in cents, as Tithe.ly wants it');
  eq((url.match(/fundId=/g) || []).length, 1, 'the market fund REPLACES the base link’s fund rather than adding a second');
  ok(url.includes('fundId=market-fund'), 'and it is the market’s fund that wins');
  ok(url.includes('formId=abc'), 'the rest of the base link is left alone');

  eq(marketPayUrl({ giveUrl: '', fundId: 'x' }, 3120), '',
    'no giving link set means no payment address — the caller renders no button rather than a dead one');

  const noFund = marketPayUrl({ giveUrl: 'https://give.tithe.ly/?formId=abc', fundId: '' }, 6210);
  ok(noFund.includes('amount=6210'), 'a blank market fund still gets an amount');
  ok(!noFund.includes('fundId='), 'and adds no fund at all, so the base link’s own is used');
}

group('a Square market looks the link up by table count instead of computing it');
{
  const squareSettings = {
    paymentProvider: 'square',
    giveUrl: 'https://give.tithe.ly/?formId=abc', // present but must be ignored on this provider
    fundId: 'market-fund',
    squareLinks: { '1': 'https://square.link/u/one', '2': 'https://square.link/u/two' },
  };
  eq(marketPayUrl(squareSettings, 3120, 1), 'https://square.link/u/one',
    'the link for the exact table count is returned, whatever the amount happens to be');
  eq(marketPayUrl(squareSettings, 6210, 2), 'https://square.link/u/two');
  eq(marketPayUrl(squareSettings, 9300, 3), '',
    'a table count with no link set gets no address, never a wrong or Tithe.ly one');
  eq(marketPayUrl(squareSettings, 3120), '',
    'no table count at all also gets nothing, rather than guessing');

  eq(marketPayUrl({ paymentProvider: 'tithely', giveUrl: 'https://give.tithe.ly/?formId=abc', fundId: '', squareLinks: { '1': 'https://square.link/u/one' } }, 3120, 1).includes('amount=3120'), true,
    'a Tithe.ly market ignores any Square links even if some are set — the provider flag is what decides');
}

group('what the coordinator tracks');
{
  eq(PAYMENT_STATES.length, 4, 'four payment states, because the market really has four');
  eq(paymentState('paid').label, 'Paid', 'a known state resolves');
  eq(paymentState('nonsense').value, 'unpaid', 'and an unknown one falls back to unpaid, never to paid');
  eq(paymentState(undefined).value, 'unpaid', 'as does a missing one');
  // ⚠ A waived fee must not read as money received. Three church groups take
  // tables at no charge every year, and a green "Paid" pill on those rows
  // would make a reconciliation look balanced when it is short by three fees.
  ok(paymentState('waived').tone !== paymentState('paid').tone,
    'a waived fee is toned differently from money that actually arrived');

  eq(photosOf({ photos: null }).length, 0, 'no photos is an empty list, not a crash');
  eq(photosOf({ photos: 'not json' }).length, 0, 'and so is a corrupt one');
  eq(photosOf({ photos: '["/images/a.jpg","",null]' }).length, 1, 'blanks and nulls are dropped from a stored list');
}

// ── a vendor can choose to pay by check or cash instead ──────────────────────
group('paying by check owes the flat fee, never the grossed-up card total');
{
  const good = {
    participant_names: 'Marla Kerr', email: 'marla@example.com', phone: '3145550123',
    product_description: 'Handmade purses', signature_name: 'Marla Kerr', tables: '2',
  };

  eq(sanitizeApplication(good, CFG).value.payment_method, 'card',
    'defaults to card with no field posted at all — every application before this shipped that way');
  eq(sanitizeApplication({ ...good, payment_method: 'check' }, CFG).value.payment_method, 'check');
  eq(sanitizeApplication({ ...good, payment_method: 'venmo' }, CFG).value.payment_method, 'card',
    'anything other than the literal string "check" falls back to card, never stored as typed');

  const price = priceBreakdown(2, CFG);
  ok(price.feeCents > 0, 'sanity: two tables really does carry a card fee in this config');

  const cardArgs = marketInsertArgs({ ...good, payment_method: 'card', tables: 2 }, price, []);
  eq(cardArgs.amount_due_cents, price.totalCents, 'a card application owes the grossed-up total');

  const checkArgs = marketInsertArgs({ ...good, payment_method: 'check', tables: 2 }, price, []);
  eq(checkArgs.amount_due_cents, price.subtotalCents, 'a check application owes only the flat table fee');
  ok(checkArgs.amount_due_cents < cardArgs.amount_due_cents,
    'and that flat fee is strictly less than the card total — the whole point of not charging a card fee nobody incurred');
  eq(checkArgs.fields.payment_method, 'check', 'the choice itself is carried into fields_json so the coordinator can see it');
}

group('the coordinator sees a check application relabeled, without inventing a fifth payment state');
{
  const unpaidCheck = { payment_status: 'unpaid', payment_method: 'check' };
  eq(paymentLabel(unpaidCheck).label, 'Awaiting check', 'an unpaid check application reads differently from a plain unpaid one');
  eq(paymentLabel(unpaidCheck).value, 'unpaid', 'but the underlying VALUE is still the real one — no fifth state exists');

  eq(paymentLabel({ payment_status: 'unpaid', payment_method: 'card' }).label, 'Not paid yet',
    'a card application keeps the ordinary label');
  eq(paymentLabel({ payment_status: 'paid', payment_method: 'check' }).label, 'Paid',
    'once a check is actually recorded as paid, it reads exactly like any other paid row — the relabel only applies while unpaid');
  eq(paymentLabel({ payment_status: 'waived', payment_method: 'check' }).label, 'Fee waived',
    'and a waived check application is not relabeled either');
}

group('marketRowFromRegistration and marketInsertArgs agree on the field shape');
{
  const reg = {
    id: 9, contact_name: 'Marla Kerr', contact_email: 'marla@example.com', contact_phone: '3145550123',
    qty: 1, payment_status: 'unpaid', amount_due_cents: 3000, amount_paid_cents: null,
    table_number: '', staff_notes: '', created_at: '2026-08-18 00:00:00', square_order_id: 'order_abc',
    fields_json: JSON.stringify({ product_description: 'Purses', signature_name: 'Marla Kerr', payment_method: 'check' }),
  };
  const row = marketRowFromRegistration(reg);
  eq(row.payment_method, 'check', 'the payment method round-trips out of fields_json');
  eq(row.square_order_id, 'order_abc', 'and the Square order id is surfaced too, for the drawer’s own note');

  const noField = marketRowFromRegistration({ ...reg, square_order_id: null, fields_json: JSON.stringify({ signature_name: 'x' }) });
  eq(noField.payment_method, 'card', 'a registration saved before this shipped has no payment_method key at all, and reads as card');
  eq(noField.square_order_id, '', 'and no stored order id reads as an empty string, never null or undefined reaching a template');
}

group('the confirmation emails branch on how the vendor chose to pay');
{
  const settings = { dateLabel: 'Saturday, Dec 12', hoursLabel: '10–5', coordinatorEmail: 'marla@example.com' };
  const cardVendor = { participant_names: 'Marla Kerr', tables: 1, payment_method: 'card' };
  const checkVendor = { participant_names: 'Marla Kerr', tables: 1, payment_method: 'check' };

  const cardHtml = vendorEmailHtml(cardVendor, { totalCents: 3120, payUrl: 'https://square.link/u/x', settings });
  ok(cardHtml.includes('including the card processing fee'), 'a card vendor is told the total includes the fee');
  ok(cardHtml.includes('square.link/u/x'), 'and is given the payment link');
  ok(!cardHtml.includes('bring a check'), 'and is not told to bring a check');

  const checkHtml = vendorEmailHtml(checkVendor, { totalCents: 3000, payUrl: '', settings });
  ok(checkHtml.includes('bring a check'), 'a check vendor is told to bring a check or cash');
  ok(!checkHtml.includes('including the card processing fee'), 'and the flat total is never described as including a fee it does not carry');
  ok(!checkHtml.includes('If') || checkHtml.match(/If/g).length < (checkHtml.match(/If you|If they/g) || []).length + 3,
    'sanity: the closing sentence reads as one clause, not a doubled "If ... If"');

  const coordCardHtml = coordinatorEmailHtml({ ...cardVendor, product_description: 'Purses', signature_name: 'Marla Kerr' }, { totalCents: 3120 });
  ok(!coordCardHtml.includes('no card processing fee'), 'the coordinator email says nothing extra for a card application');
  const coordCheckHtml = coordinatorEmailHtml({ ...checkVendor, product_description: 'Purses', signature_name: 'Marla Kerr' }, { totalCents: 3000 });
  ok(coordCheckHtml.includes('no card processing fee'), 'and flags a check application so she knows not to expect the fee in the total');
}


// ── THE COORDINATOR'S THREE OWN FIELDS ───────────────────────────────────────
group('category, and where a check has got to');
{
  eq(cleanCategory('Wood'), 'Wood', 'a category from the list is kept');
  eq(cleanCategory(''), '', 'and blank stays blank — "not categorized yet" is a real state, not Other');
  eq(cleanCategory('   '), '', 'whitespace is blank too');
  // ⚠ A stored value that is not on the list — a list edited between deploys,
  // or a hand-typed POST — lands on Other rather than reaching the page
  // unchecked. Same rule every `choices` field in the block editor follows.
  eq(cleanCategory('Antiques'), 'Other', 'anything else clamps to Other rather than being written out');
  eq(cleanCategory('<script>'), 'Other', 'including something that is trying to be markup');
  ok(VENDOR_CATEGORIES[VENDOR_CATEGORIES.length - 1] === 'Other', 'Other is last, because it is the fallback');
  eq(cleanCategory('Ministry'), 'Ministry', 'Ministry is a real category — for the ministries entered by hand, not craft vendors');
  ok(VENDOR_CATEGORIES.indexOf('Ministry') < VENDOR_CATEGORIES.length - 1, 'and it sits before Other, never after it');

  const card = { payment_method: 'card', payment_status: 'unpaid', check_no: '', check_date: '' };
  eq(checkState(card).paying, 'card', 'a card vendor is not somebody a check is expected from');
  eq(checkState(card).pending, false, 'and never appears on the chase list');

  const owed = { payment_method: 'check', payment_status: 'unpaid', check_no: '', check_date: '' };
  eq(checkState(owed).pending, true, 'a check vendor with nothing recorded is being waited on');
  eq(checkState(owed).received, false, 'and nothing has arrived');

  eq(checkState({ ...owed, check_no: '1042' }).received, true, 'a number recorded means it arrived');
  eq(checkState({ ...owed, check_no: '1042' }).pending, false, 'and takes them off the chase list');
  eq(checkState({ ...owed, check_date: '2026-08-12' }).received, true, 'a date alone is enough — a check with no number is still a check');

  // ⚠ Waived and dropped are the two that would otherwise sit on the chase
  // list forever. Timothy MDO, the Word of Life 8th grade and the youth group
  // take tables at no charge; nobody is ever putting a check in the post for
  // those, and a reconciliation that keeps counting them reads short every
  // year for a reason nobody can find.
  eq(checkState({ ...owed, payment_status: 'waived' }).pending, false, 'a waived fee is not a check anybody is waiting for');
  eq(checkState({ ...owed, payment_status: 'dropped' }).pending, false, 'and neither is a vendor who dropped out');
}

group('what a row looks like after a cell saves');
{
  const base = { id: 4, payment_method: 'check', payment_status: 'unpaid', amount_due_cents: 4500,
    amount_paid_cents: null, tables: 1, table_number: '', check_no: '', check_date: '', category: '' };
  const st = vendorCellState(base);
  eq(st.statusLabel, 'Awaiting check', 'a check vendor who has not paid is told apart from one who simply has not');
  eq(st.tone, 'warn', 'in the tone of something waiting, not something broken');
  eq(st.checkMode, 'pending', 'and the check column offers somewhere to record it');
  // ⚠ NULL is "nobody has checked yet", which is a different fact from "they
  // paid nothing" — the two sentences say so.
  eq(st.moneyLine, 'asked $45', 'an unchecked row says what was asked for');
  eq(vendorCellState({ ...base, amount_paid_cents: 4500 }).moneyLine, '$45 recorded',
    'and a checked one says what somebody actually saw');
  eq(vendorCellState({ ...base, amount_paid_cents: 0 }).moneyLine, '$0 recorded',
    'zero recorded is a recorded fact, not an absent one');

  const paid = vendorCellState({ ...base, check_no: '1042', check_date: '2026-08-12', payment_status: 'paid' });
  eq(paid.checkMode, 'received', 'a recorded check turns the column into a statement');
  ok(paid.checkLabel.includes('#1042') && paid.checkLabel.includes('2026-08-12'),
    'carrying the number and the day it came');
  // The ✓ In button stamps '—' when nobody typed a number, and a check with no
  // number is still a check that arrived.
  ok(vendorCellState({ ...base, check_no: '—', payment_status: 'paid' }).checkLabel.includes('(no number)'),
    'a check recorded without a number says so rather than printing a dash as if it were one');
  eq(vendorCellState({ ...base, payment_method: 'card' }).checkMode, 'card', 'a card vendor gets no check boxes at all');
}

// ── THE VOLUNTEER ROSTER ─────────────────────────────────────────────────────
// ⚠ THE ONE THING WORTH TESTING HARDEST IS THE CLOCK. Serve sends a shift's
// time as a LABEL written for a human, and three of the four views are
// arithmetic over it — so a label read wrong does not throw, it draws a
// morning shift in the evening and looks entirely plausible doing it.
group('reading a shift time out of a label');
{
  eq(parseClock('9:00 AM'), 540, 'a plain morning time');
  eq(parseClock('9:00 PM'), 1260, 'and an evening one');
  eq(parseClock('12:00 AM'), 0, 'midnight is zero, not twelve hundred');
  eq(parseClock('12:30 PM'), 750, 'and noon is twelve hundred, not zero');
  eq(parseClock('8:30am'), 510, 'with or without the space');
  eq(parseClock('2 PM'), 840, 'and with or without the minutes');
  eq(parseClock('14:00'), 840, 'a 24-hour time is read as itself');
  eq(parseClock('2026-12-05T07:30:00Z'), 450, 'and an ISO instant gives up its own clock reading');
  eq(parseClock('sometime after lunch'), null, 'anything else is null rather than a guess');
  eq(parseClock(''), null, 'and so is nothing');
  eq(parseClock('25:00'), null, 'a 25th hour is not a time');

  // ⚠ Read through a helper that survives a null rather than off `.start`
  // directly: a parser regression that returns null would THROW on a bare
  // property read, and a crashed suite is a much weaker signal than a named
  // failing assertion — it stops at the first one and says nothing about the
  // rest.
  const range = (l) => { const r = parseShiftLabel(l); return r ? `${r.start}-${r.end}` : 'null'; };

  eq(range('11:00 am–2:30 pm'), '660-870', 'a label saying both halves outright is read as written');

  // ⚠ THE MERIDIEM ON THE END OF THE LABEL BELONGS TO BOTH HALVES. This is
  // the case that makes the parser worth having: '8:30–11:00 am' gives one
  // am for two times.
  eq(range('8:30–11:00 am'), '510-660', 'a start with no am/pm inherits the end’s, and the end keeps its own');

  // ⚠ AND INHERITING IT BLINDLY IS WRONG THE OTHER WAY. '11:00–2:30 pm'
  // inherited straight would read 23:00–14:30 — an end before its start —
  // so a start that inherited is pushed back twelve hours when it has to be.
  eq(range('11:00–2:30 pm'), '660-870',
    'a start that inherited PM and would land after its end is corrected back to the morning');

  eq(range('7:30 AM - 11:00 AM'), '450-660', 'a hyphen works as well as a dash');
  eq(range('9:00 AM to 11:00 AM'), '540-660', 'and so does the word to');
  // ⚠ Serve's own labels routinely name the day in front of the times, so an
  // anchored pattern would read every one of them as having no clock at all
  // and quietly empty three of the four views on exactly the labels the
  // market uses.
  eq(range('Friday 4–8pm'), '960-1200', 'a day written in front of the times is stepped over');
  // ⚠ AND A LABEL THAT SAYS NEITHER HALF IS LEFT UNTIMED RATHER THAN GUESSED.
  // '10–1' is almost certainly ten in the morning to one in the afternoon —
  // and 'almost certainly' is not something to draw a grid from. The by-job
  // view shows it regardless, so nothing is lost but the guess.
  eq(range('Saturday 10–1'), 'null', 'a range with no am or pm anywhere in it is not a time');
  eq(range('all afternoon'), 'null', 'a label with no clock in it is null, never a guess');
  eq(range('2:00 PM–11:00 AM'), 'null',
    'a label that says an end before its start OUTRIGHT is refused rather than quietly corrected — that is wrong in Serve, and hiding it here hides it from whoever could fix it');

  eq(fmtClock(510), '8:30 AM', 'a time reads back the way somebody would say it');
  eq(fmtClock(720), '12:00 PM', 'noon is PM');
  eq(fmtClock(0), '12:00 AM', 'and midnight is AM');
  eq(fmtRange(450, 660), '7:30–11 am', 'a range says the meridiem once, at the end');
  eq(fmtRange(660, 900), '11–3 pm', 'even when the two halves are on different sides of noon');

  // ⚠ ANCHORED AT NOON UTC, never `new Date('2026-12-04')`. A bare date
  // string is parsed as midnight UTC, which is the day BEFORE for everybody
  // west of Greenwich — including St. Louis, and including this Worker's
  // readers. Same trap the newsletter archive's month grouping is written
  // around.
  eq(fmtDay('2026-12-04'), 'Friday, December 4', 'a date reads as the day it actually is');
  eq(fmtDay('2026-12-05'), 'Saturday, December 5', 'the market day too');
  eq(fmtDay('2026-01-01'), 'Thursday, January 1', 'and a date that would roll backwards over a year boundary');
  eq(fmtDay('nonsense'), '', 'anything unparseable is blank rather than Invalid Date');

  // ⚠ AND THAT HAS TO HOLD ON A MACHINE THAT IS NOT IN UTC, which is the only
  // place the bug it guards against can appear at all. A bare `new Date(iso)`
  // read with local getters is right in UTC and a day early everywhere west
  // of Greenwich — including St. Louis — so a test running in UTC passes
  // whether or not the noon anchor is there. Re-run in the church's own zone,
  // in a child process, because TZ is fixed for the life of a Node process.
  const inChicago = execFileSync(process.execPath, ['-e',
    "import('./admin/market.js').then(m=>process.stdout.write(m.fmtDay('2026-12-04')+'|'+m.fmtDay('2026-01-01')))"],
    { env: { ...process.env, TZ: 'America/Chicago' }, encoding: 'utf8' });
  eq(inChicago, 'Friday, December 4|Thursday, January 1',
    'a date reads as the same day in the church’s own timezone as it does in the Worker’s UTC');
}

group('the roster, normalized');
{
  const SERVE = {
    open: true, signedUp: 4, openShifts: 3,
    roles: [
      { name: 'Setup', shifts: [
        { label: '9:00–11:00 am', needed: 4, filled: 2, people: [{ name: 'Rick Vogel', email: 'rick@example.com' }, { name: 'Ben Ostermann', email: '' }] },
        { label: 'whenever', needed: 2, filled: 0, people: [] },
      ] },
      { name: 'Kitchen', shifts: [
        { label: '11:00 am–1:00 pm', needed: 3, filled: 1, people: [{ name: 'Marla Bruns', email: 'marla@example.com' }] },
      ] },
    ],
  };
  const r = normalizeRoster(SERVE);
  eq(r.days.length, 1, 'a roster with no dates is one day, so no day switch is drawn for a chooser that could not do anything');
  eq(r.days[0].label, '', 'and that day has no label to print, because Serve did not give one');
  eq(r.total, 3, 'every shift is carried');
  eq(r.untimed, 1, 'and the one whose time could not be read is counted rather than dropped');
  const shifts = r.days[0].shifts;
  eq(shifts[0].start, 540, 'a readable label becomes a real start');
  eq(shifts[1].timed, false, '⚠ an unreadable one is marked untimed, NOT given a guessed midnight');
  eq(shifts[1].start, null, 'with no start at all');

  // ⚠ STRUCTURED FIELDS WIN OUTRIGHT — this is the one change the design asks
  // of Serve, and the day it lands no parsing should happen at all.
  const structured = normalizeRoster({ roles: [{ name: 'Grill', lead: 'Dale Fischer', shifts: [
    { label: 'nonsense that cannot be parsed', start: '10:00 AM', end: '1:00 PM', date: '2026-12-05', needed: 3, filled: 0, people: [] },
  ] }] });
  const g = structured.days[0].shifts[0];
  eq(g.start, 600, 'a real start field is used in preference to the label');
  eq(g.end, 780, 'and a real end field');
  eq(g.lead, 'Dale Fischer', 'a lead sent by Serve is carried through');
  eq(structured.days[0].label, 'Saturday, December 5', 'and a date puts the shift on a named day');

  // Two dates is two days, in order, and only then is the switch worth drawing.
  const twoDays = normalizeRoster({ roles: [{ name: 'Tents', shifts: [
    { label: '9:00–11:00 am', date: '2026-12-05', needed: 2, filled: 0, people: [] },
    { label: '9:00–11:00 am', date: '2026-12-04', needed: 2, filled: 0, people: [] },
  ] }] });
  eq(twoDays.days.length, 2, 'two dates is two days');
  eq(twoDays.days[0].date, '2026-12-04', 'in date order, setup before market');

  // ⚠ The NAMES are what the printed sheets carry, so a shift whose own count
  // disagrees with its list of people reports the longer of the two — printing
  // fewer people than the count claims are coming is the worse mistake.
  const mismatch = normalizeRoster({ roles: [{ name: 'X', shifts: [
    { label: '9:00–10:00 am', needed: 5, filled: 1, people: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
  ] }] });
  eq(mismatch.days[0].shifts[0].filled, 3, 'three names beat a count of one');

  eq(normalizeRoster({}).days.length, 1, 'an empty answer is still one day, so every view has something to render');
  eq(normalizeRoster({}).days[0].shifts.length, 0, 'with nothing in it');
  eq(normalizeRoster(null).total, 0, 'and null does not throw');
}

group('the four views');
{
  const R = normalizeRoster({ roles: [
    { name: 'Kitchen', shifts: [
      { label: '9:00–11:00 am', needed: 3, filled: 1, people: [{ name: 'Marla Bruns', email: 'm@example.com' }] },
      { label: '11:00 am–1:00 pm', needed: 3, filled: 3, people: [{ name: 'Marla Bruns', email: 'm@example.com' }, { name: 'Sue Vogel' }, { name: 'Hilda Vogt' }] },
    ] },
    { name: 'Tents', lead: 'Rick Vogel', shifts: [
      { label: '9:00–11:00 am', needed: 6, filled: 0, people: [] },
    ] },
    { name: 'Greeters', shifts: [
      { label: '11:00 am–1:00 pm', needed: 2, filled: 2, people: [{ name: 'Joyce Lammert' }, { name: 'Sue Vogel' }] },
    ] },
  ] });
  const shifts = R.days[0].shifts;

  // ⚠ MOST SHORT-HANDED FIRST. Sorted by name this is a list; sorted by what
  // is missing it is a worklist, which is the only reason it gets opened.
  const jobs = jobsFor(shifts);
  eq(jobs[0].name, 'Tents', 'the job missing six people leads');
  eq(jobs[0].short, 6, 'by how many it is short');
  eq(jobs[1].name, 'Kitchen', 'then the one missing two');
  eq(jobs[2].name, 'Greeters', 'and a full job is last');
  eq(jobs[2].short, 0, 'with nothing outstanding');
  eq(jobs[1].shifts[0].start, 540, 'a job’s own shifts are in time order');
  eq(jobs[0].lead, 'Rick Vogel', 'a lead is carried onto the job');
  eq(jobs[1].lead, '', 'and one Serve never sent is blank rather than invented');

  const slots = slotsFor(shifts);
  eq(slots.length, 2, 'the day is two distinct slots');
  eq(slots[0].start, 540, 'earliest first');
  eq(slots[0].short, 8, 'and each says how short it is across every job running in it');
  eq(slots[0].entries.length, 2, 'with the jobs of that slot beside each other');
  eq(slots[0].entries[0].job, 'Kitchen', 'in alphabetical order, because there is no other order to a slot');

  // ⚠ An untimed shift cannot be placed on the clock, so it is absent from
  // the slot view rather than piled at midnight. By job — which needs no
  // clock — still shows it, so it is never unreachable.
  const withUntimed = normalizeRoster({ roles: [{ name: 'Odd', shifts: [{ label: 'whenever', needed: 1, filled: 0, people: [] }] }] });
  eq(slotsFor(withUntimed.days[0].shifts).length, 0, 'an unreadable time is left out of the by-time view');
  eq(jobsFor(withUntimed.days[0].shifts).length, 1, 'and shown by the view that needs no clock');

  const people = peopleFor(shifts);
  eq(people.length, 4, 'everybody coming, once each however many shifts they hold');
  eq(people[0].name, 'Hilda Vogt', 'alphabetical, because this is the welcome table’s list');
  const marla = people.find((p) => p.name === 'Marla Bruns');
  eq(marla.shifts.length, 2, 'somebody on two shifts is one person with two shifts');
  eq(marla.from, 540, 'arriving for the first');
  eq(marla.to, 780, 'and free after the last');
  eq(marla.hours, 4, 'having worked both');
  eq(marla.email, 'm@example.com', 'and reachable, because emailing the roster is the next thing anybody does with it');

  // ⚠ HOURS WORKED, NOT HOURS ON SITE. Somebody with a gap in the middle of
  // the day is not owed lunch for it, and the two figures differ by exactly
  // the gap.
  const gap = peopleFor(normalizeRoster({ roles: [{ name: 'J', shifts: [
    { label: '9:00–10:00 am', needed: 1, filled: 1, people: [{ name: 'Zed' }] },
    { label: '3:00–4:00 pm', needed: 1, filled: 1, people: [{ name: 'Zed' }] },
  ] }] }).days[0].shifts)[0];
  eq(gap.hours, 2, 'two one-hour shifts six hours apart is two hours worked');
  eq(gap.from, 540, 'though they are on site from the first');
  eq(gap.to, 960, 'to the last');
}

group('the roster as a spreadsheet');
{
  const R = normalizeRoster({ roles: [{ name: 'Grill', shifts: [
    { label: '11:00 am–1:00 pm', date: '2026-12-05', needed: 3, filled: 1, people: [{ name: 'Dale Fischer' }] },
  ] }] });
  const rows = volunteerCsvRows(R.days);
  eq(rows[0][0], 'Day', 'the header names the day first');
  eq(rows[0].length, 11, 'and there are eleven columns');
  eq(rows.length, 4, 'one row for the person, and one for each spot nobody has taken');
  eq(rows[1][7], 'Dale Fischer', 'the person who signed up');
  // ⚠ THE (open) ROWS ARE THE POINT. A file listing only the people who came
  // is a thank-you list; what the coordinator is doing with a spreadsheet in
  // November is looking for the holes.
  eq(rows[2][7], '(open)', 'a spot with nobody in it is a row of its own');
  eq(rows[3][7], '(open)', 'one per missing spot, so they can be counted');
  eq(rows[1][6], '2.00', 'with the hours the shift runs');
  eq(rows[1][10], 'Short', 'and whether it is covered');
  eq(rows[1][1], '2026-12-05', 'dated');
  eq(rows[1][0], 'Saturday, December 5', 'and named');

  const text = volunteerCsv(R.days);
  ok(text.split('\r\n').length === 4, 'the file is those rows, CRLF as a spreadsheet expects');
  ok(text.startsWith('"Day"'), 'every cell quoted');

  // ⚠ A cell beginning = + - @ is a FORMULA to a spreadsheet, and this file
  // exists to be opened in one. Unlike the vendor export there is no computed
  // money column here that a quoting guard would turn into text that stops
  // summing, so every column is guarded — and a volunteer's name really can
  // begin with a hyphen.
  const nasty = volunteerCsv(normalizeRoster({ roles: [{ name: '=cmd|calc', shifts: [
    { label: '9:00–10:00 am', needed: 1, filled: 1, people: [{ name: '-Bobby' }] },
  ] }] }).days);
  ok(nasty.includes(`"'=cmd|calc"`), 'a job name that is trying to be a formula is neutralized');
  ok(nasty.includes(`"'-Bobby"`), 'and so is a person’s');

  eq(volunteerCsvRows([]).length, 1, 'an empty roster is the header alone, never a row of nothing');
}

// ── TABLE CAPACITY: PAUSE CONFIRMED, THEN A SOFT RESERVE, THEN NOTHING ──────
// capacityDecision() itself lives in admin/events.js, generalized for any
// event that takes registrations — this pins the exact shape the Christmas
// Market asks of it: 60 confirmed, then a soft reserve up to 70, then
// refused outright. See tlc-admin-worker.js's /api/market/apply route for
// where the two counts it is handed (confirmed, and confirmed+reserved) are
// actually computed against the live table.
group('a table cap pauses confirmed applications, then softly reserves, then refuses');
{
  const ev = { registration_cap: 60, waitlist_enabled: 1, waitlist_cap: 70 };

  // Under the pause: neither waitlisted nor refused.
  eq(JSON.stringify(capacityDecision(ev, 55, 3, 55)), JSON.stringify({ waitlisted: false, refused: false }),
    '58 of 60 confirmed — a 3-table application is accepted outright');

  // Exactly at the pause: still accepted outright — the pause is where
  // NEW applications stop being taken at face value, not a table short of it.
  eq(JSON.stringify(capacityDecision(ev, 58, 2, 58)), JSON.stringify({ waitlisted: false, refused: false }),
    'landing exactly on 60 confirmed is still an ordinary application');

  // Past the pause, inside the hard cap: soft-reserved.
  eq(JSON.stringify(capacityDecision(ev, 60, 5, 60)), JSON.stringify({ waitlisted: true, refused: false }),
    '60 confirmed plus 5 more (65 of 70) is a soft reserve, not a refusal');

  // Past the pause AND past the hard cap: refused outright, not queued.
  eq(JSON.stringify(capacityDecision(ev, 60, 11, 60)), JSON.stringify({ waitlisted: false, refused: true }),
    '60 confirmed plus 11 more would be 71 — past the 70 absolute maximum — refused');

  // The hard cap counts what is ALREADY reserved, not only what is confirmed —
  // a market sitting at 60 confirmed and 8 already reserved (68 of 70) has
  // room for exactly 2 more, not 10.
  eq(JSON.stringify(capacityDecision(ev, 60, 2, 68)), JSON.stringify({ waitlisted: true, refused: false }),
    '68 of 70 total plus 2 more lands exactly on 70 — a reserve, not a refusal');
  eq(JSON.stringify(capacityDecision(ev, 60, 3, 68)), JSON.stringify({ waitlisted: false, refused: true }),
    '68 of 70 total plus 3 more would be 71 — past the hard cap — refused, even though confirmed alone (60) has not moved');

  // No waitlist enabled at all: refused the moment the pause is reached,
  // whatever the hard cap says — the market’s own settings panel makes this
  // exact choice (“Soft reserve” off).
  const noWaitlist = { registration_cap: 60, waitlist_enabled: 0, waitlist_cap: 70 };
  eq(JSON.stringify(capacityDecision(noWaitlist, 60, 1, 60)), JSON.stringify({ waitlisted: false, refused: true }),
    'with the soft reserve switched off, anything past the pause is refused outright');

  // No hard cap set at all (blank “Absolute maximum”): the waitlist is
  // unbounded, matching every OTHER event’s capacityDecision() before this
  // work — nothing about this change may narrow that default.
  const uncappedReserve = { registration_cap: 60, waitlist_enabled: 1, waitlist_cap: null };
  eq(JSON.stringify(capacityDecision(uncappedReserve, 60, 500, 900)), JSON.stringify({ waitlisted: true, refused: false }),
    'a blank hard cap never refuses — the waitlist absorbs whatever comes, as it always has');

  // No cap set at all: every application is accepted outright, exactly the
  // uncapped default this repo has documented since the generic events work.
  eq(JSON.stringify(capacityDecision({}, 1000, 5)), JSON.stringify({ waitlisted: false, refused: false }),
    'a market with no cap at all takes any application, as it always has');

  // The default fourth argument reproduces the exact pre-existing behavior
  // for every caller that never passes it — the generic /api/events/register
  // route’s own existing call sites among them.
  eq(JSON.stringify(capacityDecision(ev, 60, 3)), JSON.stringify(capacityDecision(ev, 60, 3, 60)),
    'omitting currentTotalQty defaults it to currentQty, unchanged from before this work');
}

group('a soft-reserved application is inserted waitlisted, and takes no payment link');
{
  const price = priceBreakdown(2, CFG);
  const value = { participant_names: 'Sue Lin', business_name: '', email: 'sue@example.com', phone: '3145550100',
    tables: 2, signature_name: 'Sue Lin', payment_method: 'card',
    website_or_social: '', returning_vendor: '', street: '', city: '', state: '', zip: '',
    product_description: 'Ornaments', sells_food: 0, appliances_power: '', special_requests: '' };

  const reserved = marketInsertArgs(value, price, [], { waitlisted: true });
  eq(reserved.waitlisted, true, 'the insert args carry the reserve flag');
  eq(reserved.amount_due_cents, price.totalCents, 'what would be owed is still recorded, for when it is confirmed');

  const ordinary = marketInsertArgs(value, price, []);
  eq(ordinary.waitlisted, false, 'omitting the option — every existing caller before this — reads as an ordinary application');

  // marketRowFromRegistration() has to read the flag back out the same way.
  const row = marketRowFromRegistration({
    id: 1, contact_name: 'Sue Lin', contact_email: 'sue@example.com', contact_phone: '3145550100',
    qty: 2, payment_status: 'unpaid', amount_due_cents: price.totalCents, amount_paid_cents: null,
    waitlisted: 1, created_at: '2026-08-31 00:00:00',
    fields_json: JSON.stringify({ product_description: 'Ornaments', signature_name: 'Sue Lin', payment_method: 'card' }),
  });
  eq(row.waitlisted, true, 'a stored 1 reads back as a real boolean, not the integer');
  eq(vendorCellState(row).waitlisted, true, 'and the cell state the row saves/repaints from carries it too');

  const notReserved = marketRowFromRegistration({ id: 2, waitlisted: 0, fields_json: '{}' });
  eq(notReserved.waitlisted, false, 'a stored 0 — or nothing at all — reads back false');
}

group('the confirmation emails say “waiting list”, not “pay now”, for a soft reserve');
{
  const settings = { dateLabel: 'Saturday, Dec 12', hoursLabel: '10–5', coordinatorEmail: 'marla@example.com' };
  const vendor = { participant_names: 'Sue Lin', tables: 2, payment_method: 'card' };

  const vendorHtml = vendorEmailHtml(vendor, { totalCents: 6210, payUrl: '', settings, waitlisted: true });
  ok(vendorHtml.includes('waiting list'), 'the vendor is told they are on the waiting list');
  ok(!vendorHtml.includes('Your space is held'), 'and never told their space is held, which is only true once confirmed');
  ok(!vendorHtml.includes('for your table'), 'and given no payment link of any kind — the only href left is the plain mailto for questions');

  const ordinaryHtml = vendorEmailHtml(vendor, { totalCents: 6210, payUrl: 'https://square.link/u/x', settings, waitlisted: false });
  ok(!ordinaryHtml.includes('waiting list'), 'an ordinary, non-reserved application says nothing about a waiting list');

  const coordHtml = coordinatorEmailHtml({ ...vendor, product_description: 'Ornaments', signature_name: 'Sue Lin' },
    { totalCents: 6210, waitlisted: true });
  ok(coordHtml.includes('Soft reserve'), 'the coordinator is told this one is a soft reserve');
  ok(coordHtml.includes('No payment link was sent'), 'and that nothing was sent to collect on it');

  const coordOrdinary = coordinatorEmailHtml({ ...vendor, product_description: 'Ornaments', signature_name: 'Sue Lin' },
    { totalCents: 6210 });
  ok(!coordOrdinary.includes('Soft reserve'), 'an ordinary application carries no such notice — waitlisted defaults to false');
}

group('setSignupsOpen calls chms with the shared secret and the right boolean');
{
  const realFetch = globalThis.fetch;

  // No key configured on this Worker at all: never even tries the network.
  {
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response('{}'); };
    const r = await setSignupsOpen({}, false);
    eq(r.ok, false, 'refused without a network call');
    ok(r.error.includes('CHMS_INTAKE_API_KEY'), 'and says which secret is missing');
    eq(called, false, 'a request Serve would only 401 anyway is never made');
  }

  // A real request: the right URL, header and body.
  {
    let seen = null;
    globalThis.fetch = async (u, init) => {
      const req = (typeof Request !== 'undefined' && u instanceof Request) ? u : null;
      seen = {
        url: req ? req.url : u,
        method: req ? req.method : (init && init.method),
        key: req ? req.headers.get('X-Intake-Key') : (init && init.headers && init.headers['X-Intake-Key']),
        body: req ? await req.clone().text() : (init && init.body),
      };
      return new Response(JSON.stringify({ open: true }), { status: 200 });
    };
    const r = await setSignupsOpen({ CHMS_INTAKE_API_KEY: 'k' }, true);
    eq(r.ok, true, 'a 200 from chms reads as success');
    eq(seen.url, 'https://serve.timothystl.org/api/signups/christmasmarket/toggle', 'the real write route');
    eq(seen.method, 'POST', 'as a POST');
    eq(seen.key, 'k', 'carrying the shared secret');
    eq(seen.body, JSON.stringify({ open: true }), 'and the boolean, exactly');
  }

  // A 404 — no Christmas Market event yet in Serve — gets its own message,
  // not a bare "Serve answered 404."
  {
    globalThis.fetch = async () => new Response('{}', { status: 404 });
    const r = await setSignupsOpen({ CHMS_INTAKE_API_KEY: 'k' }, false);
    eq(r.ok, false, 'a 404 is not success');
    ok(r.error.includes('No Christmas Market event'), 'and says plainly there is nothing to toggle yet');
  }

  // Any other failure status.
  {
    globalThis.fetch = async () => new Response('{}', { status: 500 });
    const r = await setSignupsOpen({ CHMS_INTAKE_API_KEY: 'k' }, false);
    eq(r.ok, false, 'a 500 is not success');
    ok(r.error.includes('500'), 'and names the status');
  }

  // Unreachable entirely.
  {
    globalThis.fetch = async () => { throw new Error('boom'); };
    const r = await setSignupsOpen({ CHMS_INTAKE_API_KEY: 'k' }, false);
    eq(r.ok, false, 'a network failure is not success');
    ok(r.error.includes('boom'), 'and the underlying reason is in the message');
  }

  globalThis.fetch = realFetch;
}

console.log(`\nmarket.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
