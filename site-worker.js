// Timothy Lutheran Church — Main Site Worker
// Handles server-side redirects before falling through to static assets.
// Custom redirects are fetched from the admin API and cached in memory for 60s.

import { renderGiveLandingHtml, FALLBACK_TIERS, FALLBACK_BASE_URL } from './give-landing.js';

const ERROR_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Something went wrong — Timothy Lutheran Church</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Lora:wght@600&family=Source+Sans+3:wght@400;600&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #F7F3EC;
      font-family: 'Source Sans 3', Arial, sans-serif;
      color: #1A1A2A;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 24px;
      text-align: center;
    }
    .eyebrow {
      display: block;
      font-family: 'Source Sans 3', Arial, sans-serif;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #C9973A;
      margin-bottom: 16px;
    }
    h1 {
      font-family: Lora, Georgia, serif;
      font-size: clamp(36px, 6vw, 64px);
      color: #1E2D4A;
      line-height: 1.1;
      margin-bottom: 20px;
    }
    p {
      font-size: 18px;
      color: #4A4860;
      max-width: 520px;
      line-height: 1.6;
      margin-bottom: 36px;
    }
    .btn {
      display: inline-block;
      background: #1E2D4A;
      color: #fff;
      font-family: 'Source Sans 3', Arial, sans-serif;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <span class="eyebrow">500 Error</span>
  <h1>Something went wrong</h1>
  <p>We're sorry — something on our end broke. Please try again in a moment, or go back to the home page.</p>
  <a href="/" class="btn">Go to Home Page</a>
</body>
</html>`;

let redirectCache = null;
let redirectCacheTime = 0;
const settingsCache = {};
const settingsCacheTime = {};
let giveAmountsCache = null;
let giveAmountsCacheTime = 0;
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

// give.timothystl.org amount tiers — admin-editable via the Giving tab. Falls back to
// give-landing.js's hardcoded FALLBACK_TIERS if admin.timothystl.org is unreachable, so
// the giving page never breaks outright.
async function getGiveAmounts() {
  const now = Date.now();
  if (giveAmountsCache && now - giveAmountsCacheTime < CACHE_TTL) return giveAmountsCache;
  try {
    const res = await fetch('https://admin.timothystl.org/api/give-amounts');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.tiers) && data.tiers.length) {
        giveAmountsCache = data.tiers;
        giveAmountsCacheTime = now;
      }
    }
  } catch (_) {}
  return giveAmountsCache || FALLBACK_TIERS;
}

export default {
  async fetch(request, env) {
    try {
    const url = new URL(request.url);

    // Canonical redirect: www → apex (301 = permanent, cached by browsers/crawlers)
    if (url.hostname === 'www.timothystl.org') {
      return new Response(null, {
        status: 301,
        headers: { 'Location': 'https://timothystl.org' + url.pathname + url.search }
      });
    }

    // give.timothystl.org — standalone giving landing page, not part of the main SPA.
    // Same Worker, different hostname (same pattern used in the chms repo for
    // connect.timothystl.org) — serves one single-purpose page regardless of path.
    // Amount tiers + base link are admin-editable (Giving tab) and fetched/cached the
    // same way as the custom redirects and zoom/councilfiles settings above.
    if (url.hostname === 'give.timothystl.org') {
      const [tiers, baseUrl] = await Promise.all([
        getGiveAmounts(),
        getSettingUrl('give_url', FALLBACK_BASE_URL),
      ]);
      return new Response(renderGiveLandingHtml(tiers, baseUrl), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    }

    const path = url.pathname.replace(/^\//, '').replace(/\/$/, '').toLowerCase();

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
    } catch (err) {
      return new Response(ERROR_PAGE_HTML, {
        status: 500,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    }
  },
};
