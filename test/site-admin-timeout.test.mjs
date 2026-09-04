// A degraded admin cannot hold the public site — run with:
//   node test/site-admin-timeout.test.mjs
//
// 2026-09-04: D1 hit its daily row-read ceiling, every admin query started
// taking about sixteen seconds, and timothystl.org served /worship in
// 47.1s — HTTP 200, with the hardcoded fallback markup sitting right there
// unused. Three of these calls run one after another on a page load.
//
// All four already had a try/catch and a cache to fall back on. Not one could
// ever reach it, because a slow answer is not an error: they hung. The
// assertions here are that the bound exists, that it is on every call, and
// that the page still arrives when it fires.
import worker from '../site-worker.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const group = (n) => console.log('\n' + n);

// HTMLRewriter is a Workers API with no Node equivalent. Nothing here is about
// the parser, so a pass-through is enough to let the handler run to the end.
class PassThroughRewriter {
  on() { return this; }
  transform(res) { return res; }
}

// An admin that accepts the connection and then says nothing — the shape of
// the real outage, and the one a try/catch alone is blind to. Rejects only when
// the signal fires, so a call made without one hangs the test rather than
// passing it quietly.
function hangingAdmin(calls) {
  return (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const signal = init.signal || (input && input.signal);
    calls.push({ url, at: Date.now(), signal });
    return new Promise((_, reject) => {
      if (!signal) return; // no bound: hangs forever, which is the bug
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
}

const htmlAssets = {
  fetch: async () => new Response('<html><body><div id="page-worship"></div></body></html>',
    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }),
};

async function loadPage(path) {
  const calls = [];
  const realFetch = globalThis.fetch;
  const realRW = globalThis.HTMLRewriter;
  globalThis.fetch = hangingAdmin(calls);
  globalThis.HTMLRewriter = PassThroughRewriter;
  // ⚠ Node's AbortSignal.timeout() uses an UNREF'D timer, so with nothing else
  // pending the process exits before it can fire and the await never settles.
  // A Worker has no such problem — the in-flight request keeps the isolate
  // alive — so this is a harness artifact, not something the code must handle.
  const keepAlive = setInterval(() => {}, 50);
  const started = Date.now();
  let res, err = null;
  try {
    res = await worker.fetch(new Request('https://timothystl.org' + path), { ASSETS: htmlAssets }, { waitUntil() {} });
  } catch (e) { err = e; }
  const elapsed = Date.now() - started;
  clearInterval(keepAlive);
  globalThis.fetch = realFetch;
  if (realRW === undefined) delete globalThis.HTMLRewriter; else globalThis.HTMLRewriter = realRW;
  return { res, err, elapsed, calls };
}

group('every call to the admin Worker is bounded');
const run = await loadPage('/worship');
ok(run.calls.length > 0, `the page really does call the admin (${run.calls.length} calls)`);
ok(run.calls.every((c) => c.signal), 'and every one of them carries an abort signal');
for (const c of run.calls) ok(c.url.startsWith('https://admin.timothystl.org/'), `only the admin is called: ${c.url}`);

group('a silent admin does not hold the page');
ok(!run.err, `the request completes rather than throwing (${run.err && run.err.message})`);
ok(run.res && run.res.status === 200, `the visitor still gets their page (${run.res && run.res.status})`);
// The bug served this in 47 seconds. Two bounded waits is the ceiling now — the
// redirect lookup, then the settings/pages pair together. Generous enough not
// to be flaky, tight enough that a regression to serial-and-unbounded fails.
ok(run.elapsed < 12000, `and gets it in ${(run.elapsed / 1000).toFixed(1)}s, not 47`);

group('the two independent lookups start together');
// They ask the admin different questions and neither needs the other's answer.
// Awaiting them in sequence added a round trip to every healthy page load and
// doubled how long a degraded admin could hold the site.
const settings = run.calls.find((c) => c.url.includes('/api/settings/'));
const pages = run.calls.find((c) => c.url.includes('/api/pages'));
ok(settings, 'the social-image setting is read');
ok(pages, 'the published pages are read');
if (settings && pages) {
  ok(Math.abs(settings.at - pages.at) < 1000,
    `both are in flight at once (${Math.abs(settings.at - pages.at)}ms apart, not one after the other)`);
}

group('a junk path still costs nothing');
// The 404 gate runs before all of this, so a degraded admin cannot slow it
// down either — the two changes have to hold together.
const junk = await loadPage('/wp-login.php');
ok(junk.res.status === 404, `a scanner probe is still refused (${junk.res.status})`);
ok(junk.calls.length === 0, `and still makes no admin call (${junk.calls.length})`);
ok(junk.elapsed < 1000, `answered immediately (${junk.elapsed}ms)`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
