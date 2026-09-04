// A junk path is a 404, and it costs nothing — run with:
//   node test/site-404.test.mjs
//
// Dinger, the day D1 hit its free-tier row-read ceiling with nobody logged in:
// "maybe someone is spamming our site". The site's own configuration made that
// as expensive as it could possibly be — `not_found_handling =
// "single-page-application"` answers an unknown path with index.html and a
// 200, and the pipeline behind it then runs the redirect lookup and
// getPublishedPages(), a subrequest to the admin Worker and a full /api/pages
// build. Every /wp-login.php probe booted the whole website.
//
// The assertions that matter here are the two that could take the site down if
// they were wrong: that no real address is ever refused, and that a refused one
// reaches neither ASSETS nor the network.
import { readFileSync } from 'node:fs';
import worker, { isJunkPath } from '../site-worker.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const group = (n) => console.log('\n' + n);

// ── every real address, read from the source rather than retyped ────────────
// A hand-kept copy of this list is the failure this test exists to prevent: it
// would go stale the first time somebody adds a page, and the way you would
// find out is the new page 404ing in front of the congregation.
const seedSrc = readFileSync(new URL('../admin/site-pages.js', import.meta.url), 'utf8');
const slugs = [...seedSrc.matchAll(/"slug":\s*"([^"]*)"/g)].map(m => m[1]);
const indexSrc = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const nested = [...indexSrc.matchAll(/'(\/[a-z0-9/-]+)'/g)].map(m => m[1])
  .filter(p => p.includes('/', 1));

const norm = (p) => p.replace(/^\//, '').replace(/\/$/, '').toLowerCase();

group('no real address is ever refused');
ok(slugs.length >= 25, `read the page seeds (found ${slugs.length})`);
for (const s of slugs) ok(!isJunkPath(norm(s)), `page slug ${s || '/'} must be served`);
for (const s of nested) ok(!isJunkPath(norm(s)), `nested route ${s} must be served`);
// The nested routes by name, in case the scrape above ever stops finding them.
for (const s of ['about/values', 'christmasmarket/vendors', 'christmasmarket/vendors/apply'])
  ok(!isJunkPath(s), `nested route /${s} must be served`);
// Short links, settings redirects and the taps all resolve through the
// redirect lookup, which sits AFTER this gate — refusing one here would make
// an address printed on a flyer dead with nothing to explain it.
for (const s of ['zoom', 'councilfiles', 'voters', 'manual', 'volunteer', 'serve', 'mdo', 'tap1', 'tap4'])
  ok(!isJunkPath(s), `short link /${s} must reach the redirect lookup`);
// Real files in public/ — including the two .html pages, which is why html is
// on the served list rather than the refused one.
for (const s of ['index.html', 'manual.html', 'how-to-give.html', 'robots.txt', 'sitemap.xml',
                 'logo.png', 'images/favicon-32x32.png', 'styles.css', 'sw.js', 'site.webmanifest'])
  ok(!isJunkPath(s), `real file /${s} must be served`);
ok(!isJunkPath(''), 'the homepage is not junk');

group('a scanner probe is refused');
for (const s of ['wp-login.php', 'index.php', 'admin.php', 'xmlrpc.php', '.env', '.env.bak',
                 'config.json.bak', 'backup.sql', 'shell.jsp', 'test.asp', 'db.zip', 'app.yml',
                 'wp-admin', 'wp-admin/setup-config.php', 'wp-content/plugins/x', 'wp-includes/a',
                 '.git/config', '.git', '.svn/entries', '.aws/credentials', '.ssh/id_rsa',
                 'phpmyadmin', 'cgi-bin/luci', 'autodiscover/autodiscover.xml',
                 'actuator/env', 'solr/admin/info'])
  ok(isJunkPath(s), `scanner probe /${s} must be refused`);

group('vendor is not a prefix match');
// /christmasmarket/vendors is a real, published page with no hardcoded
// fallback behind it — a prefix rule here would take the Christmas Market off
// the site, which is the single most expensive mistake this file could make.
ok(!isJunkPath('christmasmarket/vendors'), 'the vendor page survives');
ok(!isJunkPath('christmasmarket/vendors/apply'), 'the vendor application survives');
ok(!isJunkPath('vendors'), 'a bare /vendors is not refused');

group('a refused path costs nothing');
// The point of the gate is not the status code, it is that nothing downstream
// runs. If either of these is called, the 404 is saving no D1 reads at all and
// the change is worthless.
let assetCalls = 0, netCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a) => { netCalls++; return realFetch(...a); };
const env = { ASSETS: { fetch: async () => { assetCalls++; return new Response('', { status: 200 }); } } };
const ctx = { waitUntil() {} };
const res = await worker.fetch(new Request('https://timothystl.org/wp-login.php'), env, ctx);
globalThis.fetch = realFetch;
ok(res.status === 404, `a junk path answers 404 (got ${res.status})`);
ok(assetCalls === 0, `ASSETS is never reached (called ${assetCalls}x)`);
ok(netCalls === 0, `no subrequest is made (made ${netCalls})`);
const body = await res.text();
ok(!body.includes('page-worship'), 'the whole SPA is not served');
ok(res.headers.get('cache-control')?.includes('max-age=3600'), 'the edge absorbs the repeat');
ok((res.headers.get('x-robots-tag') || '').includes('noindex'), 'it is not indexable');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
