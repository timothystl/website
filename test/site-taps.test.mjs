// The site worker's half of tap counting — run with: node test/site-taps.test.mjs
//
// A tap resolves in site-worker.js from a cached redirect list, which is why
// nothing counted one until now: that Worker cannot reach D1. It tells the
// admin Worker instead, and the properties worth pinning down are all about
// what that must never cost the visitor.
import worker from '../site-worker.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

// The admin API, stubbed. Every outbound fetch is recorded so the test can say
// what the Worker tried to do as well as what it returned.
const REDIRECTS = {
  redirects: [
    { path: 'tap1', url: 'https://links.timothystl.org', label: 'Link tree' },
    { path: 'tap3', url: 'https://give.timothystl.org', label: 'Giving plate' },
    { path: 'zoom-ish', url: 'https://example.org/z', label: 'Something else' },
  ],
};

let sent = [];
let adminUp = true;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  sent.push({ url, init });
  if (!adminUp) throw new Error('admin unreachable');
  if (url.includes('/api/redirects')) {
    return new Response(JSON.stringify(REDIRECTS), { headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
};

const env = { ASSETS: { fetch: async () => new Response('<html>the site</html>', { headers: { 'Content-Type': 'text/html' } }) } };

// A stand-in for Cloudflare's ExecutionContext, so the test can assert the
// beacon was handed to waitUntil rather than awaited.
const makeCtx = () => {
  const held = [];
  return { held, waitUntil: (p) => held.push(p) };
};

const go = async (path, headers = { 'User-Agent': PHONE }, ctx = makeCtx()) => {
  sent = [];
  const res = await worker.fetch(new Request('https://timothystl.org/' + path, { headers }), env, ctx);
  return { res, ctx, beacons: sent.filter((s) => s.url.includes('/api/tap-hit')) };
};

const settle = async (ctx) => { await Promise.allSettled(ctx.held); };


// ── the tap still works ──────────────────────────────────────────────────────
group('a tap resolves, and is counted');
{
  const { res, ctx, beacons } = await go('tap1');
  eq(res.status, 302, 'the tag lands where the admin says');
  eq(res.headers.get('Location'), 'https://links.timothystl.org', 'at the destination it was re-pointed to');
  eq(beacons.length, 1, 'and one beacon is sent');
  eq(JSON.parse(beacons[0].init.body).tap, 1, 'naming the tap that was used');
  eq(beacons[0].init.method, 'POST', 'as a POST');
  eq(ctx.held.length, 1, 'handed to waitUntil, so the visitor never waits for it');
  await settle(ctx);

  const three = await go('tap3');
  eq(JSON.parse(three.beacons[0].init.body).tap, 3, 'each tag is counted as itself');
  await settle(three.ctx);
}


// ── nothing about counting may reach the visitor ─────────────────────────────
// A tag is stuck to a pew rack; the count is a nice-to-have. Where the two ever
// come into conflict, the tag wins.
group('the count never costs the tap');
{
  // The redirect must be returned even when the beacon endpoint is throwing.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    sent.push({ url, init });
    if (url.includes('/api/tap-hit')) throw new Error('counting is down');
    return new Response(JSON.stringify(REDIRECTS), { headers: { 'Content-Type': 'application/json' } });
  };
  const { res, ctx } = await go('tap1');
  eq(res.status, 302, 'a broken counting endpoint does not break the tag');
  eq(res.headers.get('Location'), 'https://links.timothystl.org', 'which still lands where it should');
  await settle(ctx); // the rejection is caught, not left unhandled
  globalThis.fetch = originalFetch;

  // No ctx at all — an older runtime, or a harness. The tap must still resolve.
  const bare = await worker.fetch(new Request('https://timothystl.org/tap1', { headers: { 'User-Agent': PHONE } }), env, undefined);
  eq(bare.status, 302, 'and neither does a missing ExecutionContext');
}


// ── only real taps ───────────────────────────────────────────────────────────
// The way this number actually goes wrong is machines, not malice.
group('what is not a tap');
{
  const bot = await go('tap1', { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
  eq(bot.res.status, 302, 'a crawler still gets the redirect');
  eq(bot.beacons.length, 0, 'but is not counted as somebody tapping a tag');

  const pre = await go('tap1', { 'User-Agent': PHONE, 'Sec-Purpose': 'prefetch;anonymous-client-ip' });
  eq(pre.res.status, 302, 'a prefetch still resolves');
  eq(pre.beacons.length, 0, 'and is not counted — the browser guessed, nobody tapped');

  const naked = await go('tap1', {});
  eq(naked.beacons.length, 0, 'a request with no user-agent is a script, not a phone');

  // An ordinary redirect is not a tap.
  const other = await go('zoom-ish');
  eq(other.res.status, 302, 'a hand-made redirect still redirects');
  eq(other.beacons.length, 0, 'and is not counted as a tap');

  // A tap that does not resolve is not counted either — a mistyped address or a
  // switched-off tag must never show up as usage.
  const missing = await go('tap9');
  eq(missing.beacons.length, 0, 'an address that resolves to nothing is not a tap');
  eq(missing.res.status, 200, 'and falls through to the site as before');
}


// ── the tag outlives the admin ───────────────────────────────────────────────
group('the cached list is what keeps a tag working');
{
  // The list is cached in the isolate, so a tag keeps working through an admin
  // outage. That robustness is the reason counting is a beacon rather than a
  // second redirect hop through the admin worker.
  adminUp = false;
  const { res, ctx } = await go('tap1');
  eq(res.status, 302, 'a tag still resolves while the admin is unreachable');
  eq(res.headers.get('Location'), 'https://links.timothystl.org', 'from the cached list');
  await settle(ctx);
  adminUp = true;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
