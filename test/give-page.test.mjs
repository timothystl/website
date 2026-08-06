// ── give.timothystl.org STILL TAKES MONEY ────────────────────────────────────
//
// The giving page moved onto the block editor. Every other test in this repo
// asks whether a page RENDERS; this one asks whether it TRANSACTS, which is a
// different question and the only one that matters here. A giving page that
// renders beautifully and links to the wrong form is a worse outcome than one
// that fails to load, because nobody finds out.
//
// So the assertions are about arithmetic and fallbacks:
//   • a chip for $25 produces amount=2500 — CENTS, not dollars
//   • the fund selector's id reaches the link
//   • no block anywhere can carry a Tithe.ly address
//   • the page still gives when the admin is unpublished, unreachable, or
//     returning nonsense
//
// Drives site-worker.js directly with fetch stubbed, the same shape as
// test/site-taps.test.mjs. No browser needed.
//
// Run: node test/give-page.test.mjs

import assert from 'node:assert';

let passed = 0, failed = 0, groupName = '';
const group = (n) => { groupName = n; console.log('\n' + n); };
const ok = (cond, msg) => {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ ' + msg); }
};
const eq = (a, b, msg) => {
  if (a === b) { passed++; }
  else { failed++; console.log(`  ✗ ${msg}\n      expected ${JSON.stringify(b)}\n      got      ${JSON.stringify(a)}`); }
};
const has = (hay, needle, msg) => ok(String(hay).includes(needle), msg + ` (missing: ${needle})`);
const hasNot = (hay, needle, msg) => ok(!String(hay).includes(needle), msg + ` (found: ${needle})`);

const worker = (await import('../site-worker.js')).default;
const { renderBlock, sanitizeBlock, renderPage, BLOCK_DEFS } = await import('../admin/blocks.js');
const { withAmountAndFund } = await import('../give-link.js');
const { renderGiveLandingHtml } = await import('../give-landing.js');
const { GIVE_LANDING_BLOCKS } = await import('../admin/give-landing-seed.js');

const BASE = 'https://give.tithe.ly/?formId=FORM&locationId=LOC&fundId=GENERAL';

// site-worker caches its admin fetch for five minutes in module scope, so each
// case has to run in a fresh module instance or the second one would silently
// assert against the first one's response.
async function freshWorker() {
  const mod = await import('../site-worker.js?bust=' + Math.random());
  return mod.default;
}

function stubAdmin(payload, { fail = false } = {}) {
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    if (fail) throw new Error('admin unreachable');
    if (url.includes('/api/give-page')) {
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const env = { ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
const ctx = { waitUntil() {} };
const getGive = async (w, path = '/') =>
  (await w.fetch(new Request('https://give.timothystl.org' + path), env, ctx));

// ─────────────────────────────────────────────────────────────────────────────
group('the arithmetic: an amount becomes cents, never dollars');
{
  eq(withAmountAndFund(BASE, 25, ''), 'https://give.tithe.ly/?formId=FORM&locationId=LOC&fundId=GENERAL&amount=2500',
    '$25 is amount=2500');
  eq(withAmountAndFund(BASE, 5000, ''), 'https://give.tithe.ly/?formId=FORM&locationId=LOC&fundId=GENERAL&amount=500000',
    'a $5,000 leadership gift is 500000 cents');
  // ⚠ A fund override REPLACES the base link's fundId rather than appending a
  // second one. Two fundId params is undefined behaviour at Tithe.ly's end,
  // which is a coin-flip about which fund somebody's gift lands in.
  const organ = withAmountAndFund(BASE, 25, 'ORGAN');
  has(organ, 'fundId=ORGAN', 'the chosen fund reaches the link');
  hasNot(organ, 'fundId=GENERAL', 'and REPLACES the base one rather than adding a second');
  eq((organ.match(/fundId=/g) || []).length, 1, 'exactly one fundId, always');
  // Cents must be an integer — a fractional cent is a link Tithe.ly rejects.
  has(withAmountAndFund(BASE, 33.335, ''), 'amount=3334', 'a fractional amount rounds to whole cents');
}

// ─────────────────────────────────────────────────────────────────────────────
group('no block can carry a Tithe.ly address, even if one is posted at it');
{
  // The governing rule: a block's URL is frozen at publish time, so a stored
  // Tithe.ly link goes on charging to the old form after the office changes
  // the base link — and the page still looks perfect. Neither giving block has
  // anywhere to put one, and this proves it against a hostile write rather
  // than by reading the definition.
  for (const type of ['giving', 'amounts']) {
    ok(!BLOCK_DEFS[type].url, `${type} has no url field at all`);
    ok(!(BLOCK_DEFS[type].itemUrlFields || []).length, `${type} has no per-row url field either`);
    const dirty = sanitizeBlock({
      type,
      url: 'https://give.tithe.ly/?formId=EVIL',
      items: [{ amount: '25', period: 'week', body: '<p>x</p>', url: 'https://give.tithe.ly/?formId=EVIL' }],
    });
    eq(dirty.url, '', `${type} drops a url posted at the block`);
    hasNot(JSON.stringify(dirty.items), 'tithe.ly', `${type} drops a url posted at one of its rows`);
  }
  // And the seeded draft itself is clean — the thing that would actually get
  // published.
  hasNot(JSON.stringify(GIVE_LANDING_BLOCKS), 'tithe.ly', 'the seeded draft carries no Tithe.ly address');
  hasNot(JSON.stringify(GIVE_LANDING_BLOCKS), 'give.tithe', 'nor a partial one');
}

// ─────────────────────────────────────────────────────────────────────────────
group('the blocks compute their links from the data, at render time');
{
  const data = {
    give: {
      baseUrl: BASE,
      tiers: [{ amount: 25, url: '', isDefault: false }, { amount: 100, url: '', isDefault: true }],
      funds: [{ id: 1, name: 'General Fund', tithelyFundId: '', isDefault: true }],
    },
  };

  const widget = renderBlock(sanitizeBlock({ type: 'giving', title: 'Give to Timothy' }), { data });
  has(widget, 'amount=10000', 'the widget opens on the default tier, in cents');
  has(widget, 'data-amount="25"', 'and offers the other chip');
  has(widget, 'Give $100', 'with a button naming the amount');

  const ladder = renderBlock(sanitizeBlock({
    type: 'amounts',
    items: [{ amount: '15', period: 'week', body: '<p>Sponsors devotional resources.</p>' }],
  }), { data });
  has(ladder, 'amount=1500', 'a ladder row links at its own amount, in cents');
  has(ladder, '/week', 'and shows the period');
  has(ladder, '<p>Sponsors devotional resources.</p>', 'and keeps its description as real markup, not escaped');

  // A row somebody has half-written must not become a button that goes
  // nowhere. A dead link is worse than a missing one: it looks like it works.
  const vague = renderBlock(sanitizeBlock({
    type: 'amounts', items: [{ amount: 'Any amount', period: '', body: '<p>Whatever you can.</p>' }],
  }), { data });
  hasNot(vague, 'tlcb-am-cta', 'a row with no numeric amount gets NO button rather than a broken one');
  has(vague, 'Whatever you can.', 'but its words still show');

  // The same block with no base link configured: still no button.
  const unconfigured = renderBlock(sanitizeBlock({
    type: 'amounts', items: [{ amount: '15', period: 'week', body: '<p>x</p>' }],
  }), { data: { give: { baseUrl: '', tiers: [], funds: [] } } });
  hasNot(unconfigured, 'tlcb-am-cta', 'no base link means no button, rather than a link to nowhere');

  // The widget says so plainly instead of rendering dead furniture.
  const noWidget = renderBlock(sanitizeBlock({ type: 'giving' }), { data: { give: { baseUrl: '', tiers: [], funds: [] } } });
  has(noWidget, 'has not been filled in', 'an unconfigured widget says what is wrong');

  // In the editor the chips must not be live — a chip that really navigated to
  // Tithe.ly under a cursor trying to drag a block is a way to leave the
  // editor by accident.
  const editing = renderBlock(sanitizeBlock({ type: 'giving' }), { data, editing: true });
  has(editing, 'disabled', 'the editor canvas renders the controls inert');
  hasNot(editing, '<script', 'and ships no script into the editor');
}

// ─────────────────────────────────────────────────────────────────────────────
// The commitment and the transaction are two different numbers. A row that
// says $5,000 a year must not hand Tithe.ly a single $5,000 charge — "no one
// is going to click to do a one time gift of 5000" (Dinger, 2026-08-06) — so
// the ask is a twelfth of it, and the LINK has to carry that same twelfth. A
// button labelled $416 that charges $5,000 would be the worst outcome on this
// page, so both halves are asserted, not just the label.
group('an annual row asks for one month of it, in the label AND in the link');
{
  const data = { give: { baseUrl: BASE, tiers: [], funds: [] } };
  const annual = renderBlock(sanitizeBlock({
    type: 'amounts',
    items: [{ amount: '5000', period: 'year', body: '<p>Helps ensure every child hears about Jesus.</p>' }],
  }), { data });
  has(annual, 'Give $416/month', 'the button asks for a month, not the year');
  has(annual, 'amount=41600', 'and the link charges that same $416, in cents');
  hasNot(annual, 'amount=500000', 'never the whole annual figure');
  has(annual, '$5,000', 'while the row still states the annual commitment');
  has(annual, '/year', 'and the period it is committed for');
  has(annual, 'choose <strong>Monthly</strong>', 'and the page says the one step the link cannot take');

  // Weekly and monthly rows are already figures somebody would put through a
  // card in one go, so they are left exactly as written. A silent /12 there
  // would halve the ministry ladder's asks.
  const weekly = renderBlock(sanitizeBlock({
    type: 'amounts', items: [{ amount: '15', period: 'week', body: '<p>x</p>' }],
  }), { data });
  has(weekly, 'Give $15', 'a weekly row asks for exactly what it says');
  hasNot(weekly, '/month', 'with no monthly conversion');
  hasNot(weekly, 'choose <strong>Monthly</strong>', 'and no instruction about a screen it never reaches');

  // Under $12 a year there is no whole-dollar month to ask for. Asking for $0
  // would be a button that cannot take a gift.
  const tiny = renderBlock(sanitizeBlock({
    type: 'amounts', items: [{ amount: '10', period: 'year', body: '<p>x</p>' }],
  }), { data });
  has(tiny, 'Give $10', 'an annual row too small to split monthly asks for itself');
  hasNot(tiny, 'Give $0', 'never a button for nothing');

  // The leadership section of the hardcoded fallback — the page that is live
  // until somebody presses Publish — has to have made the same move, or the
  // two versions of this page ask for different money.
  const fallback = renderGiveLandingHtml(
    [{ amount: 25, url: '', isDefault: true }], BASE,
    [{ id: 1, name: 'General Fund', tithelyFundId: '', isDefault: true }],
  );
  has(fallback, 'Give $416/month', 'the fallback page asks monthly too');
  hasNot(fallback, 'amount=500000', 'and no button on it charges a year at once');
  has(fallback, 'Weekly giving', 'the ministry ladder has a heading over its rows');
}

// ─────────────────────────────────────────────────────────────────────────────
group('a ladder can carry a heading over the rows themselves');
{
  const data = { give: { baseUrl: BASE, tiers: [], funds: [] } };
  const titled = renderBlock(sanitizeBlock({
    type: 'amounts', subtitle: 'Weekly giving',
    items: [{ amount: '15', period: 'week', body: '<p>x</p>' }],
  }), { data });
  has(titled, 'tlcb-am-lab', 'the heading renders');
  has(titled, 'Weekly giving', 'with the words typed');

  const untitled = renderBlock(sanitizeBlock({
    type: 'amounts', items: [{ amount: '15', period: 'week', body: '<p>x</p>' }],
  }), { data });
  hasNot(untitled, 'tlcb-am-lab', 'and is absent on a ladder that has not been given one');
  // But it is offered in the editor, or nobody would know the field exists.
  const editing = renderBlock(sanitizeBlock({
    type: 'amounts', items: [{ amount: '15', period: 'week', body: '<p>x</p>' }],
  }), { data, editing: true });
  has(editing, 'tlcb-am-lab', 'the editor shows the empty field as a placeholder');
}

// ─────────────────────────────────────────────────────────────────────────────
group('the fund selector only appears when there is a choice to make');
{
  const one = renderBlock(sanitizeBlock({ type: 'giving' }), {
    data: { give: { baseUrl: BASE, tiers: [{ amount: 25, url: '', isDefault: true }],
      funds: [{ id: 1, name: 'General Fund', tithelyFundId: '', isDefault: true }] } },
  });
  // ⚠ Assert on the SELECT, not on the class name: the widget's own script
  // names .tlcb-gv-fund in a querySelector, so a class-name search matches
  // even when no dropdown was rendered. The first version of this assertion
  // did exactly that and reported a bug that was not there.
  hasNot(one, '<select', 'one fund means no dropdown — a question with one answer');

  const two = renderBlock(sanitizeBlock({ type: 'giving' }), {
    data: { give: { baseUrl: BASE, tiers: [{ amount: 25, url: '', isDefault: true }], funds: [
      { id: 1, name: 'General Fund', tithelyFundId: '', isDefault: true },
      { id: 2, name: 'Organ Fund', tithelyFundId: 'ORGAN', isDefault: false },
    ] } },
  });
  has(two, '<select', 'two funds means a dropdown');
  has(two, 'Organ Fund', 'listing the second');
}

// ─────────────────────────────────────────────────────────────────────────────
group('site-worker: published blocks are what the visitor gets');
{
  const w = await freshWorker();
  const blocks = [sanitizeBlock({ type: 'amounts', title: 'Ladder', items: [{ amount: '15', period: 'week', body: '<p>Devotionals.</p>' }] })];
  stubAdmin({
    html: renderPage(blocks, { template: 'standard', withCss: false, data: { give: { baseUrl: BASE, tiers: [], funds: [] } } }),
    css: '<style id="tlcb-css"></style>',
    appearance: { bar: '#4A5E3A', rule: '#C9973A', ink: '#FFFFFF', name: 'Timothy Lutheran Church', tagline: 'from our Neighborhood to the Nations', logo: '/logo.png', logoShape: 'round' },
    details: { address_line: '6704 Fyler Ave', address_city: 'St. Louis, MO 63139', email: 'office@timothystl.org' },
    baseUrl: BASE, tiers: [{ amount: 15, url: '', isDefault: true }], funds: [],
  });
  const body = await (await getGive(w)).text();
  has(body, 'Ladder', 'the published blocks render');
  has(body, 'amount=1500', 'with a working link');
  hasNot(body, 'Your Gift Continues His Work', 'and the hardcoded fallback body is NOT also emitted');
  has(body, 'tlcb-css', 'the block stylesheet ships');
}

// ─────────────────────────────────────────────────────────────────────────────
group('site-worker: an unpublished page falls back with the REAL amounts');
{
  const w = await freshWorker();
  // This is the state every deploy starts in, and it is not an error. The
  // important part is that the fallback uses the amounts and base link the
  // admin just returned, not the constants compiled into give-landing.js —
  // dropping to hardcoded amounts here would quietly undo the office's own
  // Amount Tiers.
  stubAdmin({
    html: '', css: '',
    appearance: null, details: null,
    baseUrl: BASE,
    tiers: [{ amount: 42, url: '', isDefault: true }],
    funds: [{ id: 1, name: 'General Fund', tithelyFundId: '', isDefault: true }],
  });
  const body = await (await getGive(w)).text();
  has(body, 'Your Gift Continues His Work', 'the hardcoded body renders');
  has(body, 'amount=4200', 'using the admin’s own amount, not a compiled-in one');
  // ⚠ Not `$30`: that string legitimately appears in the hardcoded ministry
  // ladder, which is narrative copy rather than a tier. The tiers are the
  // CHIPS, so that is what to look at.
  has(body, 'data-amount="42"', 'the chip row is built from the admin’s tiers');
  hasNot(body, 'data-amount="30"', 'and not from the compiled-in fallback ones');
}

// ─────────────────────────────────────────────────────────────────────────────
group('site-worker: the page still gives when the admin is unreachable');
{
  const w = await freshWorker();
  stubAdmin(null, { fail: true });
  const res = await getGive(w);
  const body = await res.text();
  eq(res.status, 200, 'an admin outage is still a 200');
  has(body, 'Your Gift Continues His Work', 'the hardcoded page renders');
  has(body, 'give.tithe.ly', 'and it can still reach Tithe.ly');
  has(body, 'amount=', 'with a prefilled amount');
  has(body, 'Back to timothystl.org', 'and the way home is not lost with it');
}

group('site-worker: a nonsense response is treated as no response');
{
  const w = await freshWorker();
  // A truncated or half-migrated payload must not produce a page with no
  // amounts on it. `tiers` being an array is the test of a usable response.
  stubAdmin({ html: '', tiers: 'not-an-array' });
  const body = await (await getGive(w)).text();
  has(body, 'Your Gift Continues His Work', 'falls all the way back');
  has(body, 'give.tithe.ly', 'and still transacts');
}

// ─────────────────────────────────────────────────────────────────────────────
group('on a phone the button comes before the case for pressing it');
{
  // #400 fixed this in the hardcoded page: stacking the two columns in source
  // order buries the Give button under the whole ministry ladder, so somebody
  // who arrived to give has to scroll past the argument to reach it. The block
  // version stacks the same way and would have quietly undone that fix the
  // moment the page was published.
  const { BLOCK_CSS } = await import('../admin/blocks.js');
  has(BLOCK_CSS, '.tlcb-pair > .tlcb--giving{order:-1', 'the widget is pulled above the ladder when a pair stacks');
  // Scoped to the giving widget, not to pairs generally — every other pair on
  // the site reads correctly top-to-bottom.
  hasNot(BLOCK_CSS, '.tlcb-pair > .tlcb{order:-1', 'and pairs are not reversed generally');
}

// ─────────────────────────────────────────────────────────────────────────────
group('the chrome: a way home, and assets that are not the page');
{
  const w = await freshWorker();
  stubAdmin({
    html: '', css: '', baseUrl: BASE, tiers: [{ amount: 15, url: '', isDefault: true }], funds: [],
    appearance: { bar: '#4A5E3A', rule: '#C9973A', ink: '#FFFFFF', name: 'Timothy Lutheran Church', tagline: 'from our Neighborhood to the Nations', logo: '/logo.png', logoShape: 'round' },
    details: { address_line: '6704 Fyler Ave', address_city: 'St. Louis, MO 63139', email: 'office@timothystl.org' },
  });
  const body = await (await getGive(w)).text();
  has(body, 'https://timothystl.org', 'there is a way back to the site');
  has(body, 'Back to timothystl.org', 'as a named link, not only the logo');
  has(body, '#4A5E3A', 'the masthead takes its colour from the Appearance record');
  has(body, 'from our Neighborhood to the Nations', 'and its tagline');
  has(body, '6704 Fyler Ave', 'the footer reads the church details');

  // ⚠ This branch used to answer EVERY path on this hostname with the giving
  // page, so the masthead logo and the favicon this very page asks for were
  // served an HTML document instead of an image. Silently — no error, no log.
  const logo = await getGive(w, '/logo.png');
  eq(await logo.text(), 'asset', 'an image path on this hostname serves the asset, not the page');
  const ico = await getGive(w, '/images/favicon-32x32.png');
  eq(await ico.text(), 'asset', 'and so does the favicon the page references');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
