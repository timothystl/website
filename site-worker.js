// Timothy Lutheran Church — Main Site Worker
// Handles server-side redirects before falling through to static assets.
// Custom redirects are fetched from the admin API and cached in memory for 60s.

import { renderGiveLandingHtml, renderGiveBlocksHtml, FALLBACK_TIERS, FALLBACK_BASE_URL, FALLBACK_FUNDS } from './give-landing.js';

// ── PUBLIC PUSH: the site's own service worker ──────────────────
// The admin's is admin.timothystl.org's own — see SERVICE_WORKER_JS in
// admin/helpers.js — and a push subscription is scoped to the ORIGIN it was
// registered on, so a congregation member's browser needs one registered
// here, on this origin, not on the admin's. Same shape and the same reason:
// no caching, no fetch interception — a "worship is canceled" push must
// never be followed by a stale cached page telling somebody it is not.
const SITE_SERVICE_WORKER_JS = `
self.addEventListener('install', function(event){ self.skipWaiting(); });
self.addEventListener('activate', function(event){ event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(event){
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || 'Timothy Lutheran Church';
  var url = data.url || '/';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/images/android-chrome-192x192.png',
    badge: '/images/android-chrome-192x192.png',
    tag: data.tag || undefined,
    data: { url: url }
  }));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
    for (var i = 0; i < list.length; i++) {
      var client = list[i];
      if ('focus' in client) { client.focus(); if ('navigate' in client) client.navigate(url); return; }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
`;

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
let givePageCache = null;
let givePageCacheTime = 0;
// 15 minutes. Was 60s, then 5 minutes — each raise for the same reason: the
// admin subrequest sits IN FRONT of the HTML whenever this expires, for lists
// that change a few times a year.
//
// ⚠ THIS IS THE ONE CACHE A PUBLISH CANNOT REACH, so it is the real staleness
// floor for the whole site. The admin's /api/pages entry is DELETED by the
// chokepoint the moment anything is published; this copy lives in each site
// isolate's own memory, where nothing can purge it, so an edit takes up to
// this long to appear however promptly the admin cleared its own copy.
// Raised deliberately on 2026-09-04, on Dinger's call after the D1 free-tier
// row-read ceiling took the admin down: "Live site on all pages can be behind.
// That's better than blowing through our usage allotment." If somebody later
// reports "I published it and still see the old one", this number is the
// answer and shortening it is a real cost, not a free fix.
const CACHE_TTL = 900_000;

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

// ── JUNK PATHS ARE A REAL 404, NOT THE WHOLE APP ────────────────────────────
// `not_found_handling = "single-page-application"` means an unknown path is
// answered with index.html and a 200. That is exactly right for /worship and
// /christmasmarket/vendors — the SPA routes client-side and there is no file
// on disk for either — and it is exactly wrong for /wp-login.php, because the
// pipeline below does not know the difference: it runs the redirect lookup,
// then getPublishedPages(), which on a cold isolate is a subrequest to the
// admin Worker and a full /api/pages build. A vulnerability scanner walking a
// few thousand paths therefore boots the entire site a few thousand times.
//
// ⚠ THIS RUNS BEFORE ANY SUBREQUEST, which is the whole point. A 404 that
// still cost a D1 read would save nothing.
//
// Two rules, both chosen because they cannot touch a real address:
//
//   1. A path ending in an extension we do not serve. Every real route on this
//      site is a slug — pageRename()/slugify() strip everything that is not a
//      letter, digit or hyphen — so a real route never has a dot in it, and a
//      real file always ends in one of the extensions below. `.php`, `.env`,
//      `.asp`, `.jsp`, `.sql`, `.bak` and the rest are, by construction,
//      nobody's page. html/htm are included as SERVED rather than refused:
//      public/ really does hold manual.html and how-to-give.html.
//
//   2. A short denylist for the extensionless probes — /wp-admin, /.git/config.
//      ⚠ Every entry is anchored to whole path segments. `vendor` is
//      deliberately NOT in it: /christmasmarket/vendors is a real page, and a
//      prefix match is one careless edit away from taking the Christmas Market
//      off the site.
//
// Anything that matches neither is served exactly as it was before.
const SERVED_EXT_RE = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|css|js|mjs|json|xml|txt|map|pdf|webmanifest|mp3|mp4|html?)$/i;
const HAS_EXT_RE = /\.[a-z0-9]{1,8}$/i;
const SCANNER_PATH_RE = /(^|\/)(wp-admin|wp-content|wp-includes|wp-json|wordpress|xmlrpc|phpmyadmin|phpinfo|myadmin|cgi-bin|node_modules|autodiscover|actuator|jenkins|solr|struts|\.git|\.svn|\.env|\.aws|\.ssh|\.vscode|\.idea)(\/|$)/i;

// `path` is already lowercased with the leading and trailing slash stripped.
export function isJunkPath(path) {
  if (!path) return false;
  if (SCANNER_PATH_RE.test(path)) return true;
  return HAS_EXT_RE.test(path) && !SERVED_EXT_RE.test(path);
}

// Deliberately not the SPA's own #page-404: reaching that means serving the
// whole application, which is the cost this exists to avoid. Cached for an
// hour so a scanner's second pass is absorbed by the edge and never reaches
// this Worker at all.
const NOT_FOUND_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Page not found &middot; Timothy Lutheran Church</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#F7F3EC;color:#1A1A2A;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center}
main{padding:32px;max-width:32rem}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0 0 1.5rem;color:#4A4860}
a{display:inline-block;padding:12px 24px;border-radius:999px;background:#1E2D4A;color:#F5E4C0;text-decoration:none}</style>
</head><body><main><h1>Page not found</h1>
<p>That address does not exist on our site.</p>
<a href="https://timothystl.org/">Go to the homepage</a></main></body></html>`;

function notFoundResponse() {
  return new Response(NOT_FOUND_HTML, {
    status: 404,
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
const LONG_CACHE_RE = /\.(png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf|mp3|mp4|pdf)$/i;
const SHORT_CACHE_RE = /\.(css|js|mjs|json|xml|txt|map|webmanifest)$/i;

// The site served every asset with NO Cache-Control at all, so browsers
// re-validated the logo, the fonts and every ministry photo on each visit.
// Images and fonts change by being replaced (new filename or ?v=), so a day
// of cache plus a week of stale-while-revalidate is safe; css/js keep an hour
// (the ?v= busting on index.html's references stays the real control); HTML
// gets no-cache so a publish is visible on the next load — no-cache still
// allows storing, it just forces the etag revalidation env.ASSETS supports.
export function withAssetCaching(res, pathname) {
  const h = new Headers(res.headers);
  if (LONG_CACHE_RE.test(pathname)) h.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  else if (SHORT_CACHE_RE.test(pathname)) h.set('Cache-Control', 'public, max-age=3600');
  else {
    h.set('Cache-Control', 'no-cache');
    // ⚠ THE ETAG BELOW STILL BELONGS TO THE STATIC index.html ASSET, NOT TO
    // WHATEVER THIS RESPONSE WAS JUST REWRITTEN INTO. Publishing a page (a
    // new hero photo, a calendar color, anything read from D1) never touches
    // that static file, so its ETag/Last-Modified never change — but
    // `no-cache` still means "ask again with a conditional request", and a
    // browser whose cached copy still matches THAT etag gets back a bare 304
    // with no body. Per HTTP semantics a 304 tells the browser to keep
    // showing what it already has, so it goes right on displaying whatever
    // was baked into the page the LAST time it genuinely fetched it — the
    // photo from before the last publish, invisibly, forever, until the
    // static asset itself changes on a real code deploy. Stripping the
    // validators here (and the matching conditional headers on the request
    // to env.ASSETS below) makes every document-shaped request a plain,
    // uncached fetch instead — the actual behavior "no-cache" was meant to
    // give a page whose real content lives in D1, not in this file.
    h.delete('ETag');
    h.delete('Last-Modified');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// Companion to the ETag strip above: without this, env.ASSETS.fetch() still
// receives the BROWSER'S OWN conditional headers (If-None-Match /
// If-Modified-Since, carried straight through on `request`) and can answer
// 304 with an empty body — at which point there is nothing left to rewrite
// with this visit's published blocks, and the response sent on is whatever a
// 304 happens to look like once Cache-Control is rewritten onto it. Only
// applied to a document-shaped request (an unknown extension, which is what
// every SPA route looks like) — an actual asset file (an image, a font, the
// stylesheet) is meant to keep validating normally.
export function stripConditionalHeaders(request) {
  const h = new Headers(request.headers);
  h.delete('If-None-Match');
  h.delete('If-Modified-Since');
  return new Request(request, { headers: h });
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

// ── THE PUBLISHED PAGES, RENDERED AT THE EDGE ───────────────────────────────
// Dinger: "the old pages and content are always loading first and then current
// content and layout display even on hard refresh."
//
// He was right and publishing more pages could never have fixed it.
// public/index.html ships the HARDCODED markup for all 28 pages — that is what
// paints. Only afterwards does tlcMaybeTakeOverSitePage() fetch /api/pages from
// admin.timothystl.org, hide the hardcoded sections and drop the published
// blocks in. Publishing changes WHAT replaces the markup; it cannot change that
// the markup is painted first, because the replacement waits on a request to
// another origin. A hard refresh makes it worse: nothing is cached, so the round
// trip is at its longest.
//
// So the blocks are put into the HTML here, as it is served. Same door the
// social preview image already goes through, and for a related reason — that
// one because crawlers do not run the page's JavaScript, this one because the
// visitor's eyes do not wait for it.
//
// ⚠ THIS IS PURELY ADDITIVE. Anything that goes wrong — the admin unreachable,
// a page not published, a path that maps to nothing — injects nothing, and the
// page then behaves exactly as it did before this existed: hardcoded markup,
// then the client-side takeover. The fallback is not a second code path bolted
// on; it is simply what happens when this does nothing.
// ⚠ EVERY CALL FROM HERE TO THE ADMIN WORKER IS BOUNDED. All four had a
// try/catch and a cache to fall back on, and not one of them could ever reach
// it: a slow answer is not an error, so they hung instead. On 2026-09-04 D1 hit
// its daily row-read ceiling, every admin query started taking ~16s, and three
// of these run one after another on a page load — timothystl.org served
// /worship in 47 seconds, HTTP 200, with the fallback markup sitting right
// there unused.
//
// 4s matches the ceiling admin/market.js already puts on its own cross-app
// call, for the same reason stated there: one application must not sit waiting
// on another. In health these answer in well under a second (the payload is
// edge-cached for 120s), so this fires only when something is already wrong —
// and when it does, every caller below degrades to exactly what it was
// designed to degrade to.
const ADMIN_FETCH_TIMEOUT_MS = 4000;
function fetchAdmin(path) {
  return fetch('https://admin.timothystl.org' + path, { signal: AbortSignal.timeout(ADMIN_FETCH_TIMEOUT_MS) });
}

let pagesCache = null;
let pagesCacheTime = 0;

async function getPublishedPages() {
  const now = Date.now();
  if (pagesCache && now - pagesCacheTime < CACHE_TTL) return pagesCache;
  try {
    const res = await fetchAdmin('/api/pages');
    if (res.ok) {
      pagesCache = await res.json();
      pagesCacheTime = now;
    }
  } catch (_) { /* the client-side takeover is the fallback */ }
  return pagesCache;
}

// ⚠ A MIRROR OF tlcPathFor() IN public/index.html, AND IT HAS TO STAY ONE.
// The SPA routes by page ID and its divs are id="page-<id>"; the address is
// derived from the id, not from pages.slug — so using the slug here would let
// the edge inject into a page the router does not agree it is showing. There is
// no module both files can import (index.html is plain HTML), so this is the
// same arrangement styleVars()/wrapperVars() already live under: two copies and
// a test that reads both and asserts they agree.
const NESTED_PATHS = { values: '/about/values', marketvendors: '/christmasmarket/vendors',
  marketvendorsapply: '/christmasmarket/vendors/apply' };
export function pathForPageId(id) {
  return id === 'home' ? '/' : (NESTED_PATHS[id] || '/' + id);
}

export function pageIdForPath(data, pathname) {
  const want = (pathname.replace(/\/+$/, '') || '/').toLowerCase();
  for (const p of (data && data.pages) || []) {
    if (pathForPageId(p.id).toLowerCase() === want) return p.id;
  }
  return '';
}

// One rewriter pass over the document: the social image, and the page's own
// blocks. Two .transform() calls would be two passes over 220KB.
//
// ⚠ Content added with prepend()/append() is NOT re-parsed by HTMLRewriter, so
// the `> *` selector below matches only the page's ORIGINAL children and never
// the block markup just put in front of them. That is what makes hiding the old
// sections expressible at all in a streaming rewriter.
// ── THE CHROME, ALSO IN THE FIRST PAINT ─────────────────────────────────────
// Dinger, after every page was published and the block markup was already
// arriving at the edge: "I have published all pages and still the echo version
// of pages loads first."
//
// He was right again, and the earlier fix was half of one. The page BODY comes
// down rendered now — but the header, the logo and the newsletter band are
// still swapped in by applyAppearance() AFTER a cross-origin fetch to
// /api/pages. Measured against the live site: the stylesheet paints the bar
// `var(--sage)` (moss) and the stored appearance is `#3A4E5C` (slate), so every
// page paints a moss header and snaps to slate a moment later. The logo is a
// custom upload, so it swaps too, and the newsletter band is slate as well.
//
// So the same door: the payload is already fetched, and everything below is
// already in it. These are the exact properties applyAppearance() sets, which
// is what keeps the two from disagreeing — if the edge sets one and the client
// sets another, the flash simply moves.
//
// ⚠ ADDITIVE, LIKE THE BLOCKS. No appearance in the payload, or a field absent
// from it, means nothing is written and the stylesheet's own fallbacks apply
// exactly as they do today. The client still runs and still sets all of this;
// it just has nothing left to change.
export function appearanceStyle(a) {
  if (!a) return '';
  // Custom properties only, and each one guarded — a value is a color or a font
  // stack from a fixed list in admin/appearance.js, never anything a visitor
  // types, but it is being written into a stylesheet, so the characters that
  // could end the declaration or the block are dropped rather than reasoned
  // about.
  const clean = (v) => String(v == null ? '' : v).replace(/["'<>;{}\\]/g, '').slice(0, 200);
  const rows = [];
  const put = (name, v) => { if (v) rows.push(name + ':' + clean(v)); };
  if (a.fonts) {
    put('--font-heading', a.fonts.head);
    put('--font-body', a.fonts.body);
    put('--font-ui', a.fonts.ui);
  }
  if (a.textScale) {
    // Numbers, clamped rather than trusted: these multiply every font-size on
    // the site, and a non-number would break every calc() at once.
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 3 ? Number(v) : null);
    const b = num(a.textScale.body);
    const h = num(a.textScale.head);
    if (b) rows.push('--tlc-text-scale:' + b);
    if (h) rows.push('--tlc-head-scale:' + h);
  }
  put('--nav-bar', a.bar);
  put('--nav-rule', a.rule);
  put('--nav-cta', a.cta);
  put('--nav-ink', a.ink);
  put('--nav-cta-ink', a.ctaInk);
  return rows.length ? '<style id="tlc-appearance">:root{' + rows.join(';') + '}</style>' : '';
}

export function rewriteDocument(res, { socialImage, pageId, blocksHtml, blockCss, appearance }) {
  let rw = new HTMLRewriter();
  if (socialImage) {
    rw = rw
      .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', socialImage); } })
      .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', socialImage); } });
  }
  // The chrome is on every page, published or not, so this is NOT inside the
  // `blocksHtml` branch below — an unconverted page flashes its header exactly
  // the same way a converted one does.
  const chromeCss = appearanceStyle(appearance);
  if (chromeCss || (pageId && blocksHtml && blockCss)) {
    rw = rw.on('head', {
      element(el) {
        if (chromeCss) el.append(chromeCss, { html: true });
        if (pageId && blocksHtml && blockCss) el.append(blockCss, { html: true });
      },
    });
  }
  if (appearance) {
    rw = rw
      // The logo is an upload, so the markup's own /logo.png is the wrong
      // picture on a site that has set one — it swaps visibly on every load.
      // ⚠ An empty logo is a real choice (the church name on its own), which is
      // why this hides the image rather than leaving the default in place.
      .on('img.nav-logo-img', {
        element(el) {
          if (appearance.logo) {
            el.setAttribute('src', appearance.logo);
            if (appearance.logoShape === 'square') el.setAttribute('class', 'nav-logo-img is-square');
          } else {
            el.setAttribute('style', 'display:none');
          }
        },
      })
      // ⚠ setInnerContent's default is TEXT, not html — the church name is
      // office-entered and must not become markup on the way through.
      .on('.nav-brand-name', {
        element(el) {
          if (appearance.name != null) {
            el.setInnerContent(String(appearance.name));
            if (!appearance.name) el.setAttribute('style', 'display:none');
          }
        },
      })
      .on('.nav-brand-sub', {
        element(el) {
          el.setInnerContent(String(appearance.tagline || ''));
          if (!appearance.tagline) el.setAttribute('style', 'display:none');
        },
      })
      // The band is chrome too, and it is on all 28 pages. Switched off it is
      // not rendered at all, which is what the client does with it.
      .on('#newsletter-band', {
        element(el) {
          const n = appearance.newsletter;
          if (!n) { el.setAttribute('style', 'display:none'); return; }
          const bg = String(n.bg || '').replace(/["'<>;{}\\]/g, '').slice(0, 60);
          if (bg) el.setAttribute('style', 'background:' + bg + ';padding:56px 28px;');
        },
      });
  }
  if (pageId && blocksHtml) {
    const sel = '#page-' + pageId;
    rw = rw
      .on(sel, {
        element(el) {
          // The same host element and id the client-side takeover creates, so
          // everything that later looks for it — feed hydration, a second
          // takeover on SPA navigation — finds what it expects.
          el.prepend('<div id="' + pageId + '-blocks">' + blocksHtml + '</div>', { html: true });
          // How the client knows not to do this again. It still hydrates the
          // feeds; it just does not re-inject what is already here.
          el.setAttribute('data-tlcb-edge', '1');
        },
      })
      // Exactly what tlcTakeOverPage() does to them, and for the same reason:
      // the hardcoded sections are the fallback, not content to show alongside.
      // ⚠ Hidden rather than removed — the client's own takeover hides them too,
      // and a page that is later re-rendered client-side expects them present.
      .on(sel + ' > *', {
        element(el) {
          const prev = el.getAttribute('style') || '';
          el.setAttribute('style', prev ? prev + ';display:none' : 'display:none');
        },
      });
  }
  return rw.transform(res);
}

async function getRedirects() {
  const now = Date.now();
  if (redirectCache && now - redirectCacheTime < CACHE_TTL) return redirectCache;
  try {
    const res = await fetchAdmin('/api/redirects');
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

// HTMLRewriter is a Workers streaming parser — it edits as the bytes go past
// rather than buffering the whole 220KB page to run a regex over it. The social
// image lives in rewriteDocument() below with the page's blocks, because two
// .transform() calls would be two passes over that 220KB for one document.
// Both the Open Graph and Twitter tags are set, since the two are read by
// different crawlers and one without the other means half of them show the old
// picture.

async function getSettingUrl(key, fallback) {
  const now = Date.now();
  if (settingsCache[key] && now - (settingsCacheTime[key] || 0) < CACHE_TTL) {
    return settingsCache[key];
  }
  try {
    const res = await fetchAdmin(`/api/settings/${key}`);
    if (res.ok) {
      const data = await res.json();
      settingsCache[key] = data.value || fallback;
      settingsCacheTime[key] = now;
      return settingsCache[key];
    }
  } catch (_) {}
  return fallback;
}

// ── give.timothystl.org, in ONE request ──────────────────────────────────────
// This used to be three separate cached subrequests — amounts, funds, and the
// base link — each with its own cache entry and its own way of failing. They
// are now one call to /api/give-page, which also carries the page's published
// blocks (if anybody has published them), the editable masthead and the church
// details for the footer.
//
// ⚠ ONE ROUND TRIP, THREE LEVELS OF FALLING BACK, and the order is the whole
// point on the page that takes the money:
//
//   1. the admin answers and the page has been published  → render the blocks
//   2. the admin answers and it has not                   → render the
//      hardcoded body with the REAL amounts and base link it just returned
//   3. the admin cannot be reached at all                 → render the
//      hardcoded body from the last good response, or from the constants in
//      give-landing.js if there has never been one
//
// Level 3 still takes a gift. That is not a nicety: an admin outage must never
// mean somebody arriving from a bulletin insert finds a page that cannot
// accept their offering.
async function getGivePage() {
  const now = Date.now();
  if (givePageCache && now - givePageCacheTime < CACHE_TTL) return givePageCache;
  try {
    const res = await fetchAdmin('/api/give-page');
    if (res.ok) {
      const data = await res.json();
      // Amounts are the test of a usable response rather than `html`, which is
      // legitimately empty until somebody presses Publish. Treating an
      // unpublished page as a failed fetch would throw away the real amounts
      // that came with it and quietly serve the hardcoded ones instead.
      if (data && Array.isArray(data.tiers)) {
        givePageCache = data;
        givePageCacheTime = now;
      }
    }
  } catch (_) {}
  return givePageCache;
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
    // As of v4.24.0 the page itself is editable in the block editor, not just
    // its amounts — see getGivePage() above for the three ways this can be
    // answered and why the last one still has to take a gift.
    if (url.hostname === 'give.timothystl.org') {
      // ⚠ Assets first, and this is a real bug fix rather than tidying. This
      // branch used to answer EVERY path on this hostname with the giving
      // page, so the masthead logo and the favicon — /logo.png and
      // /images/favicon-32x32.png, both referenced by this very page — were
      // served the HTML document instead of an image. No error, no log: just a
      // church logo that has never appeared on the giving page. Anything that
      // names a real asset file now falls through to the static assets, the
      // same as on every other hostname.
      if (ASSET_FILE_RE.test(url.pathname)) {
        return withAssetCaching(await env.ASSETS.fetch(request), url.pathname);
      }

      const page = await getGivePage();
      if (page && page.html) {
        return new Response(renderGiveBlocksHtml(page.html, page.css, page.appearance, page.details), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }
      return new Response(renderGiveLandingHtml(
        page ? page.tiers : FALLBACK_TIERS,
        (page && page.baseUrl) || FALLBACK_BASE_URL,
        page ? page.funds : FALLBACK_FUNDS,
        page && page.appearance,
        page && page.details,
      ), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    // Served at the plain path so its scope covers the whole origin — a worker
    // registered under a subpath would only ever control that subpath. Cached
    // briefly rather than not at all: a deploy changing this file should reach
    // browsers within a few minutes, not sit behind a year-long immutable
    // cache the way the images and fonts below do.
    if (url.pathname === '/sw.js') {
      return new Response(SITE_SERVICE_WORKER_JS, { headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'Service-Worker-Allowed': '/',
      }});
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

      // ⚠ BEFORE the redirect lookup and before ASSETS, because both cost a
      // subrequest and neither can help a path like /wp-login.php. See
      // isJunkPath above for why these two rules cannot catch a real address.
      // scheduler.html is handled just above, so its .html still redirects.
      if (isJunkPath(path)) return notFoundResponse();

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
    // ⚠ A document-shaped path (no file extension — every SPA route looks
    // like this) has its conditional headers stripped first, or a browser
    // revalidating against the static index.html's unchanged ETag gets a 304
    // with no body to inject this visit's published content into. See the
    // note on withAssetCaching.
    const assetRes = await env.ASSETS.fetch(
      !ASSET_FILE_RE.test(path) ? stripConditionalHeaders(request) : request
    );

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
      // ⚠ STARTED BEFORE the social lookup is awaited, not after it. These two
      // ask the admin Worker different questions and neither needs the other's
      // answer; awaiting them in sequence simply added one round trip to every
      // page load, and doubled how long a degraded admin could hold the site.
      const pagesPromise = getPublishedPages();
      const social = await getSettingUrl('social_image_url', '');
      const socialImage = /^https:\/\/\S+$/.test(social) ? social : '';

      // ── THE PAGE'S OWN BLOCKS, IN THE FIRST PAINT ────────────────
      // See getPublishedPages above for why this is here rather than in the
      // browser. Everything is optional: no payload, no match, or nothing
      // published for this page all mean "inject nothing", and the page then
      // renders its hardcoded markup and waits for the client exactly as it
      // always has.
      let pageId = '';
      let blocksHtml = '';
      let blockCss = '';
      let appearance = null;
      try {
        const pageData = await pagesPromise;
        if (pageData) {
          pageId = pageIdForPath(pageData, url.pathname);
          blocksHtml = (pageData.rendered && pageData.rendered[pageId]) || '';
          // Shipped once for the whole payload, so it is fetched from the same
          // place the client would have taken it from.
          if (blocksHtml) blockCss = pageData.css || '';
          // The header, logo and newsletter band — see appearanceStyle. This is
          // read for EVERY page, not just a published one: the chrome is on all
          // 28 of them and flashes on all 28.
          appearance = (pageData.details && pageData.details.appearance) || null;
        }
      } catch (_) { /* fall through to the client-side takeover */ }

      if (socialImage || blocksHtml || appearance) {
        return withAssetCaching(
          rewriteDocument(assetRes, { socialImage, pageId, blocksHtml, blockCss, appearance }),
          url.pathname,
        );
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
