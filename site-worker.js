// Timothy Lutheran Church — Main Site Worker
// Handles server-side redirects before falling through to static assets.
// Custom redirects are fetched from the admin API and cached in memory for 60s.

let redirectCache = null;
let redirectCacheTime = 0;
const settingsCache = {};
const settingsCacheTime = {};
const CACHE_TTL = 60_000; // 60 seconds

// Paths handled via admin settings keys (instant server-side 302, no SPA load)
const SETTINGS_REDIRECTS = {
  'zoom':         { key: 'zoom_url',         fallback: 'https://us02web.zoom.us/j/3147818673' },
  'councilfiles': { key: 'councilfiles_url', fallback: 'https://drive.google.com/drive/folders/1pgqJ32H3HS7SNYnnf7rOswC5c87IAzA4?usp=drive_link' },
};

// Reject anything that isn't an http(s) URL — guards against javascript:,
// data:, or relative-path payloads sneaking in via admin settings.
function isSafeRedirectUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

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

async function getSettingUrl(key, fallback) {
  const now = Date.now();
  if (settingsCache[key] && now - (settingsCacheTime[key] || 0) < CACHE_TTL) {
    return settingsCache[key];
  }
  try {
    const res = await fetch(`https://admin.timothystl.org/api/settings/${key}`);
    if (res.ok) {
      const data = await res.json();
      settingsCache[key] = data.value || fallback;
      settingsCacheTime[key] = now;
      return settingsCache[key];
    }
  } catch (_) {}
  return fallback;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Canonical redirect: www → apex (301 = permanent, cached by browsers/crawlers)
    if (url.hostname === 'www.timothystl.org') {
      return new Response(null, {
        status: 301,
        headers: { 'Location': 'https://timothystl.org' + url.pathname + url.search }
      });
    }

    const path = url.pathname.replace(/^\//, '').replace(/\/$/, '');

    if (path) {
      // Settings-based redirects (zoom, councilfiles) — handled before SPA loads
      if (SETTINGS_REDIRECTS[path]) {
        const { key, fallback } = SETTINGS_REDIRECTS[path];
        const location = await getSettingUrl(key, fallback);
        const safeLocation = isSafeRedirectUrl(location) ? location : fallback;
        return new Response(null, {
          status: 302,
          headers: { 'Location': safeLocation }
        });
      }

      // Custom redirects from DB
      const redirects = await getRedirects();
      const match = redirects.find(r => r.path === path);
      if (match && isSafeRedirectUrl(match.url)) {
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
