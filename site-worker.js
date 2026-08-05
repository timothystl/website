// Timothy Lutheran Church — Main Site Worker
// Handles server-side redirects before falling through to static assets.
// Custom redirects are fetched from the admin API and cached in memory for 60s.

import { renderGiveLandingHtml, FALLBACK_TIERS, FALLBACK_BASE_URL, FALLBACK_FUNDS } from './give-landing.js';

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
let giveFundsCache = null;
let giveFundsCacheTime = 0;
// 5 minutes. Was 60s, which meant the admin subrequest sat IN FRONT of the
// HTML once a minute per isolate — for a list of short links that changes a
// few times a year. A re-pointed redirect taking up to five minutes to settle
// is a fine trade for not making every fifth visitor wait on a cross-worker
// round trip.
const CACHE_TTL = 300_000;

// Paths handled via admin settings keys (instant server-side 302, no SPA load)
const SETTINGS_REDIRECTS = {
  'zoom':         { key: 'zoom_url',         fallback: 'https://us02web.zoom.us/j/3147818673' },
  'councilfiles': { key: 'councilfiles_url', fallback: 'https://drive.google.com/drive/folders/1pgqJ32H3HS7SNYnnf7rOswC5c87IAzA4?usp=drive_link' },
};

// A path that names a FILE — the redirect lookup skips these, and the asset
// response gets its Cache-Control from them. An extension allowlist rather
// than "contains a dot" so an unusual hand-made redirect with a dot in it
// keeps working unless it collides with a real asset type.
const ASSET_FILE_RE = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|css|js|mjs|json|xml|txt|map|pdf|webmanifest|mp3|mp4)$/i;
const LONG_CACHE_RE = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|mp3|mp4|pdf)$/i;
const SHORT_CACHE_RE = /\.(css|js|mjs|json|xml|txt|map|webmanifest)$/i;

// The site served every asset with NO Cache-Control at all, so browsers
// re-validated the logo, the fonts and every ministry photo on each visit.
// Images and fonts change by being replaced (new filename or ?v=), so a day
// of cache plus a week of stale-while-revalidate is safe; css/js keep an hour
// (the ?v= busting on index.html's references stays the real control); HTML
// gets no-cache so a publish is visible on the next load — no-cache still
// allows storing, it just forces the etag revalidation env.ASSETS supports.
function withAssetCaching(res, pathname) {
  const h = new Headers(res.headers);
  if (LONG_CACHE_RE.test(pathname)) h.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  else if (SHORT_CACHE_RE.test(pathname)) h.set('Cache-Control', 'public, max-age=3600');
  else h.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

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

// ── NFC TAPS ────────────────────────────────────────────────────────────────
// A tap resolves here, from the cached redirect list, which is why nothing has
// ever counted one: this Worker cannot write to D1. So it tells the admin
// Worker instead, and does not wait for the answer.
//
// ⚠ The order matters and is not an accident. The 302 is returned first and the
// beacon rides on waitUntil, so the visitor never waits for the count and a
// broken or unreachable admin cannot stop a physical tag from working. A tag is
// stuck to a pew rack; the number is a nice-to-have. If those two ever come
// into conflict, the tag wins.
//
// The filter is about machines, not malice — a crawler walking /tap1…/tap4 or a
// browser prefetching a link is what would actually make this number a lie.
// Kept in step with countsAsTap() in admin/taps.js, which is the tested copy.
const TAP_BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|preview|monitor|curl|wget|python-requests|headless|lighthouse|pingdom|uptime/i;

function countsAsTap(request) {
  const h = request.headers;
  const purpose = ((h.get('Sec-Purpose') || '') + ' ' + (h.get('Purpose') || '') + ' ' + (h.get('X-Moz') || '')).toLowerCase();
  if (/prefetch|prerender/.test(purpose)) return false;
  const ua = h.get('User-Agent') || '';
  if (!ua || TAP_BOT_UA.test(ua)) return false;
  return true;
}

function recordTap(request, ctx, path) {
  const m = /^tap(\d+)$/.exec(path);
  if (!m) return;
  if (!countsAsTap(request)) return;
  const beacon = fetch('https://admin.timothystl.org/api/tap-hit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tap: Number(m[1]) }),
  }).catch(() => {});
  // waitUntil keeps the request alive long enough for the POST to land without
  // the visitor waiting on it. Without ctx (a test harness, an older runtime)
  // the fetch is simply fire-and-forget — a missed count, never a missed tap.
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(beacon);
}

function isHtmlResponse(res) {
  return (res.headers.get('content-type') || '').includes('text/html');
}

// HTMLRewriter is a Workers streaming parser — it edits the attribute as the
// bytes go past rather than buffering the whole 220KB page to run a regex over
// it. Both the Open Graph and Twitter tags are set, because the two are read
// by different crawlers and one without the other means half of them show the
// old picture.
function rewriteSocialImage(res, imageUrl) {
  return new HTMLRewriter()
    .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', imageUrl); } })
    .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', imageUrl); } })
    .transform(res);
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

// give.timothystl.org fund selector — same fetch-and-cache pattern, own fallback.
async function getGiveFunds() {
  const now = Date.now();
  if (giveFundsCache && now - giveFundsCacheTime < CACHE_TTL) return giveFundsCache;
  try {
    const res = await fetch('https://admin.timothystl.org/api/give-funds');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.funds) && data.funds.length) {
        giveFundsCache = data.funds;
        giveFundsCacheTime = now;
      }
    }
  } catch (_) {}
  return giveFundsCache || FALLBACK_FUNDS;
}

export default {
  async fetch(request, env, ctx) {
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
      const [tiers, baseUrl, funds] = await Promise.all([
        getGiveAmounts(),
        getSettingUrl('give_url', FALLBACK_BASE_URL),
        getGiveFunds(),
      ]);
      return new Response(renderGiveLandingHtml(tiers, baseUrl, funds), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    }

    const path = url.pathname.replace(/^\//, '').replace(/\/$/, '').toLowerCase();

    if (path) {
      // VS-2: the Worship Schedule Builder used to sit in public/ and was
      // served to anybody who typed this address — the whole staff tool, with
      // no login. It now lives behind the admin session at
      // admin.timothystl.org/scheduler.
      //
      // This is belt as well as braces: the file is out of public/ already, so
      // there is nothing here to serve. But `not_found_handling` is
      // single-page-application, which means an unknown path returns
      // index.html with a 200 rather than a 404 — so without this, the old
      // address would quietly answer with the website's homepage and look like
      // it still works. Sending it somewhere real is more useful than either.
      if (path === 'scheduler.html' || path === 'scheduler') {
        return new Response(null, {
          status: 302,
          headers: { 'Location': 'https://admin.timothystl.org/scheduler' },
        });
      }

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

      // Custom redirects from DB — which is also where the four NFC taps
      // resolve, since /api/redirects merges them in.
      //
      // ⚠ NOT for asset files. On a cold isolate (or an expired cache) this
      // lookup is a cross-worker subrequest sitting in front of the response
      // — and every image, stylesheet and script on the page was paying it.
      // A short link is an address someone says out loud or prints on a
      // flyer; none of those end in a file extension, so anything that looks
      // like an asset skips straight through. (scheduler.html, the one
      // dotted path that ever redirected, is handled explicitly above.)
      if (!ASSET_FILE_RE.test(path)) {
        const redirects = await getRedirects();
        const match = redirects.find(r => r.path === path);
        if (match && isSafeRedirectUrl(match.url)) {
          // Counted only once the tap has resolved to somewhere real, so a
          // mistyped /tap9 or a switched-off tag never shows up as a tap.
          recordTap(request, ctx, path);
          return new Response(null, {
            status: 302,
            headers: { 'Location': match.url }
          });
        }
      }
    }

    // Fall through to static assets (SPA), with caching the edge and the
    // browser can actually use — see withAssetCaching below.
    const assetRes = await env.ASSETS.fetch(request);

    // ── [B7] THE SOCIAL PREVIEW IMAGE ────────────────────────────
    // og:image is read by crawlers out of the HTML as it is served. Facebook
    // and Bluesky do not run the page's JavaScript, so this is the one thing
    // on the site that CANNOT be swapped client-side the way the header and
    // the footer now are — it has to be rewritten here, before the bytes leave.
    //
    // Default is the logo, which is what the markup says, so nothing changes
    // until somebody sets the setting. A proper 1200x630 photograph of the
    // congregation is what actually improves a shared link; this is the field
    // to put it in when there is one.
    if (isHtmlResponse(assetRes)) {
      const social = await getSettingUrl('social_image_url', '');
      if (/^https:\/\/\S+$/.test(social)) {
        return withAssetCaching(rewriteSocialImage(assetRes, social), url.pathname);
      }
    }
    return withAssetCaching(assetRes, url.pathname);
    } catch (err) {
      return new Response(ERROR_PAGE_HTML, {
        status: 500,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    }
  },
};
