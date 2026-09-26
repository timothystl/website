// A cold Site Worker keeps serving the last successful public page bundle when
// Website Admin is unavailable. This drives the real getPublishedPages()
// boundary with a recording Cache API stand-in; it never contains draft or
// authenticated data because the source is the public /api/pages response.
import { getPublishedPages, resetPublishedPagesCacheForTests } from '../site-worker.js';

let pass = 0, fail = 0;
const ok = (condition, message) => {
  if (condition) pass++;
  else { fail++; console.error('  ✗ ' + message); }
};
const eq = (actual, expected, message) => ok(
  JSON.stringify(actual) === JSON.stringify(expected),
  `${message} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
);

const priorFetch = globalThis.fetch;
const priorCaches = globalThis.caches;

function validBundle(label) {
  return {
    pages: [{ id: 'home' }],
    rendered: { home: `<main>${label}</main>` },
    css: '.published{}',
    details: { appearance: { name: 'Timothy' } },
  };
}

try {
  console.log('\na successful Admin response refreshes the durable public snapshot');
  {
    resetPublishedPagesCacheForTests();
    let stored = null;
    const pending = [];
    globalThis.caches = { default: {
      match: async () => undefined,
      put: async (request, response) => { stored = { request, response }; },
    } };
    const fresh = validBundle('fresh');
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/pages')) return Response.json(fresh);
      if (String(url).endsWith('/api/content-stamp')) return Response.json({ stamp: 'publish-2' });
      throw new Error('unexpected URL ' + url);
    };
    const result = await getPublishedPages({ waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    eq(result, fresh, 'the live bundle is returned');
    ok(stored && stored.request.url.includes('published-pages-snapshot-v1'), 'the snapshot has a private cache key');
    eq(await stored.response.json(), fresh, 'the public bundle is what was saved');
    ok(stored.response.headers.get('Cache-Control').includes('max-age=31536000'), 'the last-known copy survives ordinary cache churn');
  }

  console.log('\na cold isolate falls back to the last successful snapshot');
  {
    resetPublishedPagesCacheForTests();
    const lastKnown = validBundle('last known');
    globalThis.caches = { default: {
      match: async () => Response.json(lastKnown),
      put: async () => { throw new Error('an outage must not replace the snapshot'); },
    } };
    globalThis.fetch = async () => { throw new Error('Website Admin unavailable'); };
    const result = await getPublishedPages({ waitUntil: () => { throw new Error('nothing should be written'); } });
    eq(result, lastKnown, 'the cached published bundle is returned');
  }

  console.log('\nan invalid snapshot cannot become public page data');
  {
    resetPublishedPagesCacheForTests();
    globalThis.caches = { default: {
      match: async () => Response.json({ draft: 'not a public bundle' }),
      put: async () => undefined,
    } };
    globalThis.fetch = async () => { throw new Error('Website Admin unavailable'); };
    eq(await getPublishedPages({ waitUntil: () => {} }), null, 'malformed cached data is rejected');
  }
} finally {
  if (priorFetch === undefined) delete globalThis.fetch; else globalThis.fetch = priorFetch;
  if (priorCaches === undefined) delete globalThis.caches; else globalThis.caches = priorCaches;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
