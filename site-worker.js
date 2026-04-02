// Timothy Lutheran Church — Main Site Worker
// Handles server-side redirects before falling through to static assets.
// Custom redirects are fetched from the admin API and cached in memory for 60s.

let redirectCache = null;
let redirectCacheTime = 0;
const CACHE_TTL = 60_000; // 60 seconds

async function getRedirects() {
  const now = Date.now();
  if (redirectCache && now - redirectCacheTime < CACHE_TTL) return redirectCache;
  try {
    const res = await fetch('https://admin.timothystl.org/api/redirects');
    if (res.ok) {
      const data = await res.json();
      redirectCache = data.redirects || [];
      redirectCacheTime = now;
    }
  } catch (_) {}
  return redirectCache || [];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//, '').replace(/\/$/, '');

    if (path) {
      const redirects = await getRedirects();
      const match = redirects.find(r => r.path === path);
      if (match) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': match.url }
        });
      }
    }

    // Fall through to static assets (SPA)
    return env.ASSETS.fetch(request);
  },
};
