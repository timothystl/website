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
} from './market.js';

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

console.log(`\nmarket.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
