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
