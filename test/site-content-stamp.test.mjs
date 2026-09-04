// The page bundle re-fetches on a PUBLISH, not on a clock — run with:
//   node test/site-content-stamp.test.mjs
//
// 2026-09-04, after the D1 free-tier row-read ceiling took the admin down.
// Dinger: "We don't have that many changes either. Just always call by for new
// data is wasteful. Can we set that function to a manual. So when I publish a
// real change then I can force that call."
//
// The site Worker's copy of /api/pages lives in one isolate's memory, where
// nothing outside can purge it — so before this its only invalidation was a
// timer, and it re-fetched the whole bundle (~30 admin queries, ~500 D1 rows)
// whether or not a word had changed. It now asks a few bytes instead, and pays
// for the bundle only when the answer says something was published.
//
// ⚠ EVERY TIME ADVANCE HERE IS TWENTY MINUTES, WHICH IS DELIBERATE. The clock
// this replaced was fifteen, so a shorter jump would pass against the old code
// too and prove nothing. Verified against the bug: restoring the CACHE_TTL
// check fails the "a quiet week costs nothing" group with a second bundle
// fetch on every advance.
import worker from '../site-worker.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const group = (n) => console.log('\n' + n);

class PassThroughRewriter { on() { return this; } transform(res) { return res; } }

const htmlAssets = {
  fetch: async () => new Response('<html><body><div id="page-worship"></div></body></html>',
    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }),
};

// One admin, one stamp it can be told to change, and a count of what was asked
// of it. `reachable` off is the outage case: the site must keep what it has
// rather than treating "I could not ask" as "something changed".
const admin = { stamp: 'v1', reachable: true, pages: 0, stamps: 0 };

function stubFetch(input) {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/api/content-stamp')) {
    admin.stamps++;
    if (!admin.reachable) return Promise.reject(new Error('unreachable'));
    return Promise.resolve(new Response(JSON.stringify({ stamp: admin.stamp }),
      { headers: { 'Content-Type': 'application/json' } }));
  }
  if (url.includes('/api/pages')) {
    admin.pages++;
    if (!admin.reachable) return Promise.reject(new Error('unreachable'));
    return Promise.resolve(new Response(JSON.stringify({ pages: [], menu: [], rendered: {}, redirects: {} }),
      { headers: { 'Content-Type': 'application/json' } }));
  }
  // Redirects and anything else this page load happens to want.
  return Promise.resolve(new Response(JSON.stringify({ redirects: [] }),
    { headers: { 'Content-Type': 'application/json' } }));
}

let clock = Date.now();
const realNow = Date.now;
const realFetch = globalThis.fetch;
const realRW = globalThis.HTMLRewriter;
Date.now = () => clock;
globalThis.fetch = stubFetch;
globalThis.HTMLRewriter = PassThroughRewriter;

const advance = (mins) => { clock += mins * 60_000; };
async function load() {
  await worker.fetch(new Request('https://timothystl.org/worship'), { ASSETS: htmlAssets }, { waitUntil() {} });
}

group('the first page load pays for the bundle, the second pays for nothing');
await load();
const firstPages = admin.pages, firstStamps = admin.stamps;
ok(firstPages === 1, `the bundle is fetched once — got ${firstPages}`);
ok(firstStamps === 1, `the stamp is asked once, alongside the bundle — got ${firstStamps}`);
await load();
ok(admin.pages === 1, `a second load in the same minute re-fetches nothing — got ${admin.pages}`);
ok(admin.stamps === 1, `and does not even re-ask the stamp — got ${admin.stamps}`);

group('a quiet week costs nothing but the stamp');
advance(20);
await load();
ok(admin.pages === 1, `twenty minutes later, with nothing published, the bundle is NOT re-fetched — got ${admin.pages}`);
ok(admin.stamps === 2, `the stamp is re-asked once — got ${admin.stamps}`);
advance(20);
await load();
ok(admin.pages === 1, `and again — still one bundle fetch after forty minutes — got ${admin.pages}`);

group('a publish is picked up');
admin.stamp = 'v2';
advance(20);
await load();
ok(admin.pages === 2, `a changed stamp re-fetches the bundle — got ${admin.pages}`);
advance(20);
await load();
ok(admin.pages === 2, `and only once — the new stamp is recorded against the new bundle — got ${admin.pages}`);

group('an unreachable admin never counts as a change');
admin.reachable = false;
advance(20);
await load();
ok(admin.pages === 2, `a failed stamp probe leaves the cached bundle alone — got ${admin.pages}`);

Date.now = realNow;
globalThis.fetch = realFetch;
if (realRW === undefined) delete globalThis.HTMLRewriter; else globalThis.HTMLRewriter = realRW;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
