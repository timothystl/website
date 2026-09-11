// ── Per-request D1 query-count attribution ──────────────────────────────────────
// Overhaul goal 5 (observability): this repo's D1 usage has no per-route attribution today —
// `tlc-admin-worker.js` is one flat if-chain with no central dispatcher (unlike Connect's
// `handleAdminApi`), so there's no single place that already knows "which route" the way
// Connect's admin API segment does. The one place every request DOES pass through is the
// outer `fetch(request, env, ctx)` in tlc-admin-worker.js, so that's the chokepoint here:
// wrap env.DB there, once, and every handler this Worker reaches — admin screens, the public
// /api/contact /api/prayer /api/subscribe endpoints, the login page — gets attributed for
// free. No handler file needs to change.
//
// ⚠ UNLIKE chms's src/db-attribution.js (PR #956), this file CANNOT hand back a fresh
// wrapper on every request. tlc-admin-worker.js has its own isolate-lifetime caches —
// MARKERS_SEEN and SETUP_DONE — keyed on `env.DB`'s own object identity, to skip a
// ~140-statement schema-migration block after the first request in a given isolate (see the
// "SCHEMA GATE" comment there). A fresh Proxy each request would give env.DB a new identity
// every time and defeat both caches silently, turning "once per isolate" into "every single
// request" — a real cost and latency regression, not just an observability quirk. So the
// wrapped D1 handle is memoized per real db object (WeakMap keyed on the actual binding) and
// reused for the rest of the isolate's life; only the query count is meant to reflect one
// request, tracked via a start/end delta rather than a reset (a reset would also risk zeroing
// out a still-in-flight concurrent request's count on the same isolate).
const dbWrapperCache = new WeakMap(); // real D1Database -> { db: proxy, counter }

/** Wraps a D1Database so every prepare() call is counted, memoized per real db object so the
 *  same db always gets back the identical proxy (see the file-level note on why). Never
 *  throws; a missing/undefined db passes through unwrapped with a fresh, uncached counter. */
export function wrapDbForAttribution(db) {
  if (!db) return { db, counter: { queries: 0 } };
  let entry = dbWrapperCache.get(db);
  if (entry) return entry;
  const counter = { queries: 0 };
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (...args) => {
          counter.queries += 1;
          return target.prepare(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  entry = { db: wrapped, counter };
  dbWrapperCache.set(db, entry);
  return entry;
}

/** Wraps env so env.DB resolves to the counting proxy above; every other binding (R2,
 *  secrets, service bindings) passes through untouched. Safe to call once per request —
 *  the same real db always gets the same wrapped proxy back (see the note above), and the
 *  returned counter accumulates for the isolate's whole life. Read counter.queries before
 *  and after a request and log the difference (see logDbAttribution) rather than resetting it. */
export function wrapEnvForDbAttribution(env) {
  const { db, counter } = wrapDbForAttribution(env.DB);
  const wrapped = new Proxy(env, {
    get(target, prop, receiver) {
      return prop === 'DB' ? db : Reflect.get(target, prop, receiver);
    },
  });
  return { env: wrapped, counter };
}

// A starting guess, not a calibrated budget — this repo has no query-budget precedent to
// measure against (unlike chms's apps/finance/query-budget.js). Chosen well above what a
// normal page render or form submission should need; tune once real logs show actual usage.
// The one-time ~140-statement schema-migration block (see the SCHEMA GATE comment in
// tlc-admin-worker.js) will legitimately cross this on its one request per isolate — that's a
// true, useful signal, not a false alarm, and it only fires once per isolate lifetime.
export const ADMIN_QUERY_LOG_THRESHOLD = 15;

/** Emits one structured, greppable Cloudflare Logs line for a request whose D1 usage was
 *  notable, so a future spike can be attributed to a route without guesswork. `startCount` is
 *  counter.queries as read right before this request began; the delta since then is this
 *  request's share (see the note on wrapEnvForDbAttribution for why it's a delta, not a
 *  reset-to-zero count). */
export function logDbAttribution(path, method, counter, startCount) {
  const used = counter.queries - startCount;
  if (used > ADMIN_QUERY_LOG_THRESHOLD) {
    console.log('d1_query_attribution', JSON.stringify({ route: path, method, queries: used }));
  }
}
