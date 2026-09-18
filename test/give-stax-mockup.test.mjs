// ── Stax Giving MOCKUP: give.timothystl.org/stax-mockup ─────────────────────
//
// The real give.timothystl.org page takes real money (see test/give-page.test.mjs); this one
// must NOT — it is a sandbox-only prototype, and the two must never be confused. So this test
// checks the opposite things: the mockup page is clearly labeled, carries no Tithe.ly address at
// all, and the real give page is completely unaffected by the new routes added alongside it.
//
// Run: node test/give-stax-mockup.test.mjs

import assert from 'node:assert';

let passed = 0, failed = 0, groupName = '';
const group = (n) => { groupName = n; console.log('\n' + n); };
const ok = (cond, msg) => {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ ' + msg); }
};
const has = (hay, needle, msg) => ok(String(hay).includes(needle), msg + ` (missing: ${needle})`);
const hasNot = (hay, needle, msg) => ok(!String(hay).includes(needle), msg + ` (found: ${needle})`);

const worker = (await import('../site-worker.js')).default;

function stubAdmin() {
  // The mockup route must never reach the admin fetch at all — this stub throws if it's called,
  // so a routing-order regression (mockup path falling through to the real give page) fails loud.
  globalThis.fetch = async () => { throw new Error('admin should not be called for /stax-mockup'); };
}
stubAdmin();

const env = { ASSETS: { fetch: async () => new Response('asset-bytes', { status: 200 }) } };
const ctx = { waitUntil() {} };
const get = async (path) => worker.fetch(new Request('https://give.timothystl.org' + path), env, ctx);

// ─────────────────────────────────────────────────────────────────────────────
group('the mockup page is clearly labeled and never mentions Tithe.ly');
{
  const res = await get('/stax-mockup');
  ok(res.status === 200, 'responds 200');
  const html = await res.text();
  has(html, 'MOCKUP', 'carries a visible MOCKUP label');
  has(html, 'sandbox only', 'says plainly it is sandbox only');
  // Mentioning Tithe.ly BY NAME is fine and expected (the banner reassures visitors the real
  // Tithe.ly page is unchanged) — what must never appear is an actual Tithe.ly giving LINK,
  // which would mean this sandbox page could somehow route to a real charge.
  hasNot(html.toLowerCase(), 'give.tithe.ly', 'no actual Tithe.ly giving link');
  hasNot(html, 'formId=', 'no Tithe.ly form/location query params either');
  has(html, 'connect.timothystl.org/api/mockup/stax-giving', 'calls the chms repo\'s API cross-origin');
  has(html, 'Back to timothystl.org', 'reuses the real masthead/footer shell (same brand, same trust signals)');
}

// ─────────────────────────────────────────────────────────────────────────────
group('the v2 redesign: multi-fund gifts, contact fields, frequency, fee coverage');
{
  const res = await get('/stax-mockup');
  const html = await res.text();
  has(html, 'stxAddGift', 'has an "Add Another Gift" control for multi-fund gifts');
  has(html, 'gifts:', 'submits a gifts array (not a single fund_id/amount pair) to chms');
  has(html, 'stxFirst', 'collects first name separately');
  has(html, 'stxLast', 'collects last name separately');
  has(html, 'payer_first_name', 'posts payer_first_name to chms');
  has(html, 'payer_last_name', 'posts payer_last_name to chms');
  has(html, 'stxAddr', 'collects a street address (optional matching signal)');
  // The frequency row itself is built client-side from the FREQS array (see stxFreqRow), not
  // present as static server-rendered HTML — assert on the JS source, not the markup.
  has(html, 'Bi-weekly', 'offers the bi-weekly frequency');
  has(html, '1st & 15th', "offers the 1st & 15th frequency (Tithe.ly's own term for it)");
  has(html, 'biweekly', 'sends the biweekly interval value chms expects');
  has(html, 'twice_monthly', 'sends the twice_monthly interval value chms expects');
  has(html, 'cover_fees', 'submits a cover_fees flag');
  has(html, 'stxMemo', 'has a memo field');
  // Required vs optional: per the completion-rate research this mockup's docs cite, only
  // first/last/email are marked required — phone and address are not, even though they help
  // matching. required="" is how a browser-serialized boolean attribute with no value renders.
  const firstField = html.match(/<input id="stxFirst"[^>]*>/)[0];
  const phoneField = html.match(/<input id="stxPhone"[^>]*>/)[0];
  has(firstField, 'required', 'first name is required');
  hasNot(phoneField, 'required', 'phone is NOT required');
}

// ─────────────────────────────────────────────────────────────────────────────
group('the v3 redesign: two-column hero layout and a two-step flow');
{
  const res = await get('/stax-mockup');
  const html = await res.text();
  has(html, 'stx-hero', 'uses the two-column hero layout');
  has(html, 'stx-headline', 'has a serif hero headline');
  has(html, 'Illustrative photo', 'marks the photo slot as a placeholder, not a fabricated real photo');
  hasNot(html, 'stx-hero-photo" aria-hidden="true"><img', 'does not fabricate an actual <img> for the photo placeholder');
  has(html, 'Make a gift', 'the card is titled like the reference design');

  has(html, 'id="stxStep1"', 'step 1 (amount/fund/frequency) is present');
  has(html, 'id="stxStep2"', 'step 2 (contact/payment) is present');
  has(html, '<div id="stxStep2" hidden>', 'step 2 starts hidden — it is reached via Continue, not shown up front');
  has(html, 'stxContinueBtn', 'step 1 ends in a Continue action');
  has(html, "You'll enter your details and payment on the next step.", 'step 1 sets the expectation that contact/payment come next');
  has(html, 'stxBackBtn', 'step 2 offers a way back to step 1');

  // Contact fields and payment must still live inside step 2's markup (not dropped), even though
  // step 2 is hidden until Continue is pressed.
  const step2Match = html.match(/<div id="stxStep2"[^>]*>[\s\S]*?<\/form>/);
  ok(!!step2Match, 'step 2 markup block is present');
  has(step2Match[0], 'stxFirst', 'contact fields live inside step 2');
  has(step2Match[0], 'stxCardNumber', 'payment fields live inside step 2');

  // Multi-fund gifts remain a step-1 concern (chosen before contact/payment).
  const step1Match = html.match(/<div id="stxStep1">[\s\S]*?<\/div>\s*<div id="stxStep2"/);
  ok(!!step1Match, 'step 1 markup block is present');
  has(step1Match[0], 'stxAddGift', 'multi-fund "Add Another Gift" stays in step 1');
  has(step1Match[0], 'stxChips', 'step 1 offers quick amount chips');

  // Moved per Andrew's request: cover-the-fees belongs on the amount/fund/frequency step, not
  // buried behind Continue — a donor should see the fee tradeoff before committing to advance.
  has(step1Match[0], 'stx-fees-row', 'the cover-the-fees toggle now lives in step 1');
  hasNot(step2Match[0], 'stx-fees-row', 'the cover-the-fees toggle is no longer duplicated in step 2');

  // Apple/Google Pay were never actually wired to mount into these divs (no JS ever populates
  // them) — reserving visible empty space for a payment method that can't appear yet just wastes
  // room on a step Andrew wants to fit without scrolling. Hidden until real wallet support lands.
  const walletsRow = html.match(/<div class="stx-wallets"[^>]*>/)[0];
  has(walletsRow, 'hidden', 'the empty Apple/Google Pay placeholder row stays hidden until wired up');
}

// ─────────────────────────────────────────────────────────────────────────────
group('the cover-the-fees estimate is a flat percentage, framed as an ask not a fee added on');
{
  const res = await get('/stax-mockup');
  const html = await res.text();
  has(html, 'consider giving an extra 2% to cover the processing fee', 'default copy asks for an extra gift, not "a fee is added"');
  hasNot(html, 'adds an estimated fee to your total', 'old "fee added to your total" framing is gone');
  hasNot(html, 'to your total', 'no remaining copy frames this as a fee tacked onto the total');
  has(html, "'gives ' + money(feeCents()) + ' extra to cover the fee'", 'the toggled-on state also uses the "gives extra" framing');
  has(html, 'var feeRate = 0.02', 'the flat rate is 2%, matching the interchange + $0.12 Andrew described');
  hasNot(html, 'feeFixedCents', 'no separate fixed-cents component — Andrew asked for a flat percentage only');
}

// ─────────────────────────────────────────────────────────────────────────────
group('regression: [hidden] must actually hide a .stx-row2/.stx-row3 element');
{
  // Real bug, caught before shipping: .stx-row2 { display: grid } and the browser's own
  // [hidden] { display: none } have equal CSS specificity, and the author rule comes later in
  // the cascade — so JS setting .hidden = true on a .stx-row2 element (stxExpCvvRow in demo
  // mode) set the DOM property but the element kept rendering as a grid. Verified against a
  // real headless Chromium, not just this static-HTML check.
  const res = await get('/stax-mockup');
  const html = await res.text();
  has(html, '.stx-row2[hidden], .stx-row3[hidden] { display: none; }', 'an explicit [hidden] override beats the class rule for row layouts');
}

// ─────────────────────────────────────────────────────────────────────────────
group('expiration date is collected as plain month/year fields, not inside Stax.js iframes');
{
  // Mirrors childcare-portal's own live Stax integration (parent-billing.js /
  // pbPopulateStaxExpYearOnce + the tokenize({ month, year }) call) — only card number and CVV
  // are Stax's own hosted fields; month/year travel as plain form fields per Stax's documented
  // sample, not a new pattern invented here.
  const res = await get('/stax-mockup');
  const html = await res.text();
  has(html, 'id="stxExpMonth"', 'has an expiration month field');
  has(html, 'id="stxExpYear"', 'has an expiration year field');
  const monthField = html.match(/<select id="stxExpMonth"[^>]*>/)[0];
  const yearField = html.match(/<select id="stxExpYear"[^>]*>/)[0];
  has(monthField, 'required', 'expiration month is required');
  has(yearField, 'required', 'expiration year is required');
  has(html, "month: document.getElementById('stxExpMonth').value", 'month is passed into the Stax.js tokenize() call');
  has(html, "year: document.getElementById('stxExpYear').value", 'year is passed into the Stax.js tokenize() call');
  has(html, 'function populateExpYearOnce', 'year options are populated client-side');
  // Same bug class as the Continue-button fix: a required field inside a hidden container can
  // block native validation. Demo mode hides the expiration/CVV row, so it must also clear
  // `required` on both selects or the Give button would silently fail the same way Continue did.
  has(html, "document.getElementById('stxExpMonth').required = false", 'demo mode clears required on the hidden month field');
  has(html, "document.getElementById('stxExpYear').required = false", 'demo mode clears required on the hidden year field');
}

// ─────────────────────────────────────────────────────────────────────────────
group('regression: a successful submission must not wipe its own success message');
{
  // Real bug, caught before shipping: showMsg() was called, then goToStep(1) — which
  // unconditionally clears any message — ran right after, silently erasing the "thank you" or
  // "simulated gift recorded" text a donor would otherwise see. Fixed by calling goToStep(1)
  // BEFORE showMsg() on both the successful-submission path and the step-2 fallback validation
  // path. Verified end-to-end against a real headless Chromium (a static-HTML check can't run
  // this code path), asserting on the corrected source order here.
  const res = await get('/stax-mockup');
  const html = await res.text();
  const submitFnStart = html.indexOf('function submit(pmId)');
  ok(submitFnStart > -1, 'the submit() function is present');
  const goToStepIdx = html.indexOf('goToStep(1);', submitFnStart);
  const showMsgIdx = html.indexOf("showMsg(res.d.demo ? 'Simulated gift recorded", submitFnStart);
  ok(goToStepIdx > -1 && showMsgIdx > -1 && goToStepIdx < showMsgIdx, 'goToStep(1) runs before the success showMsg(), so the message survives');
}

// ─────────────────────────────────────────────────────────────────────────────
group('phone and state format as the donor types, matching what chms normalizes to anyway');
{
  const res = await get('/stax-mockup');
  const html = await res.text();
  has(html, "getElementById('stxPhone').addEventListener('input'", 'phone reformats live as typed');
  has(html, "digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6)", 'phone formats as (555) 555-1234, matching chms\'s own normalizePhone() shape');
  has(html, "getElementById('stxState').addEventListener('input'", 'state forces the stored value to uppercase, not just its on-screen look');
}

// ─────────────────────────────────────────────────────────────────────────────
group('regression: Continue must not be silently blocked by hidden step-2 required fields');
{
  // Real bug, reported live: clicking Continue did nothing — no error, no advance to step 2.
  // Root cause was native HTML5 constraint validation. stxForm wraps BOTH steps in one <form>,
  // and stxFirst/stxLast/stxEmail (required, step 2) start `hidden`. A type="submit" button
  // click validates the WHOLE form before firing the 'submit' event; the browser found required
  // fields it could not focus (they're inside a hidden container) and just blocked the submit
  // outright — no JS ever ran, no message ever showed. formnovalidate on the Continue button
  // skips native validation for that click specifically (our own JS still validates the gift
  // fields before advancing); the final Give button keeps native validation, since by then step
  // 2's required fields are visible and focusable.
  const res = await get('/stax-mockup');
  const html = await res.text();
  const continueBtn = html.match(/<button[^>]*id="stxContinueBtn"[^>]*>/)[0];
  const payBtn = html.match(/<button[^>]*id="stxPayBtn"[^>]*>/)[0];
  has(continueBtn, 'formnovalidate', 'Continue skips native validation of the still-hidden step-2 fields');
  hasNot(payBtn, 'formnovalidate', 'the final Give button keeps native validation once step 2 is visible');
}

// ─────────────────────────────────────────────────────────────────────────────
group('a gift defaults to General Fund so picking just an amount is enough to Continue');
{
  const res = await get('/stax-mockup');
  const html = await res.text();
  has(html, 'general fund', 'the client-side default-fund match is case-insensitive against fund names');
  has(html, "gifts[0] && !gifts[0].fundId", 'only fills in the default when no fund has been picked yet');
}

// ─────────────────────────────────────────────────────────────────────────────
group('the Apple Pay placeholder names what is missing, not fake verification content');
{
  const res = await get('/.well-known/apple-developer-merchantid-domain-association');
  ok(res.status === 200, 'responds 200');
  ok((res.headers.get('content-type') || '').includes('text/plain'), 'plain text, not HTML');
  const text = await res.text();
  has(text, 'not the real', 'says outright this is not real verification content');
  has(text, 'give.timothystl.org', 'names the domain it would activate on');
}

// ─────────────────────────────────────────────────────────────────────────────
group('the real give page and its assets are unaffected by the new routes');
{
  // Root path still needs the admin fetch (the real give page's normal behavior) — restore a
  // working stub only for this group so the earlier throwing stub does not leak into it.
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    if (url.includes('/api/give-page')) {
      return new Response(JSON.stringify({ tiers: [], funds: [], baseUrl: '' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  };
  const root = await get('/');
  ok(root.status === 200, 'root path still responds 200');
  const rootHtml = await root.text();
  hasNot(rootHtml, 'MOCKUP', 'the real give page never carries the mockup banner');

  const asset = await get('/logo.png');
  const assetBody = await asset.text();
  ok(assetBody === 'asset-bytes', 'a real asset file still falls through to ASSETS.fetch, not the mockup or give page');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
