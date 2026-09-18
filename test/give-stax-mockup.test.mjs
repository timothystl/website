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
