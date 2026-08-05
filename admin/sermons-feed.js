// ── THE LATEST WORSHIP SERVICE ───────────────────────────────
// Andrew: "youtube.com/timothystl is the general worship service displayed each
// week. I don't know how we can make it pull the most current one every time."
//
// YouTube publishes a per-channel Atom feed at
//   https://www.youtube.com/feeds/videos.xml?channel_id=UC...
// with the newest uploads first. It needs **no API key, no quota and no
// account** — which matters more than it sounds: an API key would be one more
// secret to set, to rotate, and to notice had expired, on a feature whose whole
// point is that nobody has to touch it every week.
//
// ⚠ The feed is keyed on the channel ID (UC…), not the handle (@TimothySTL),
// and there is no public endpoint that converts one to the other. The channel
// page carries its own ID in the markup, so `channelIdFrom()` reads it there
// and the Worker caches the result. That is a scrape, and scrapes break — so
// the ID is also storable as a setting, and once resolved it is written back so
// the scrape never has to run again.
//
// Pure parsing only — no fetch, no env — so the fragile part is the part that
// can be tested against real markup. See admin/sermons-feed.test.mjs.

// A channel ID is always UC followed by 22 URL-safe base64 characters.
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export function isChannelId(v) {
  return CHANNEL_ID.test(String(v || '').trim());
}

// What the office types can be either form, because both are things somebody
// might reasonably paste: the address they know (@TimothySTL, or a full URL) or
// an ID they were given.
export function normalizeChannelInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return { kind: 'none', value: '' };
  if (isChannelId(s)) return { kind: 'id', value: s };

  const idInUrl = s.match(/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (idInUrl) return { kind: 'id', value: idInUrl[1] };

  const handle = s.match(/@([A-Za-z0-9._-]{3,30})/);
  if (handle) return { kind: 'handle', value: '@' + handle[1] };

  // A bare word is treated as a handle — "timothystl" is what somebody says out
  // loud, and it is what the old /sermons button linked to.
  if (/^[A-Za-z0-9._-]{3,30}$/.test(s)) return { kind: 'handle', value: '@' + s };
  return { kind: 'none', value: '' };
}

export function channelPageUrl(handle) {
  return 'https://www.youtube.com/' + String(handle).replace(/^@?/, '@');
}

export function feedUrl(channelId) {
  return 'https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(channelId);
}

// The channel ID out of a channel page. YouTube writes it in several places and
// they have moved around over the years, so all the known shapes are tried
// rather than the one that happens to work today.
export function channelIdFrom(html) {
  const s = String(html || '');
  const patterns = [
    /"externalId":"(UC[A-Za-z0-9_-]{22})"/,
    /"channelId":"(UC[A-Za-z0-9_-]{22})"/,
    /channel_id=(UC[A-Za-z0-9_-]{22})/,
    /\/channel\/(UC[A-Za-z0-9_-]{22})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return '';
}

const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// The feed's entries, newest first — which is the order YouTube sends them.
// Deliberately not sorted here: `published` is when the video was *uploaded*,
// and a stream that was scheduled days ahead carries the date it was scheduled,
// so re-sorting on it would reliably put the wrong service first.
export function parseFeed(xml) {
  const s = String(xml || '');
  const out = [];
  for (const m of s.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    if (!id) continue;
    out.push({
      videoId: id.trim(),
      title: unescapeXml((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim(),
      published: ((e.match(/<published>([^<]+)<\/published>/) || [])[1] || '').trim(),
    });
    if (out.length >= 15) break;
  }
  return out;
}

// Which entry to show. With no filter set this is simply the newest upload,
// which is right for a channel that only carries the weekly service.
//
// The filter exists because that assumption is one video away from being wrong:
// the moment somebody posts a concert, a funeral or a promo clip, the sermons
// page would silently show it as "this week's service". A filter is how the
// office fixes that themselves without anybody touching code.
export function pickLatest(entries, filter = '') {
  const list = Array.isArray(entries) ? entries : [];
  const needle = String(filter || '').trim().toLowerCase();
  if (!needle) return list[0] || null;
  return list.find((e) => e.title.toLowerCase().includes(needle)) || null;
}

export function embedUrl(videoId) {
  return 'https://www.youtube.com/embed/' + encodeURIComponent(videoId);
}
