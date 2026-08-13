// ── WHERE A LINK GOES, AND WHETHER ANYTHING IS THERE ─────────────────────────
//
// Every URL field in the block editor was a plain text box. `safeUrl()` in
// admin/blocks.js decides whether a value is SAFE — no `javascript:`, no
// quotes to break out of an attribute — and that is all it decides. It has no
// opinion about whether the address exists, so `/abuot` saves perfectly
// cleanly, renders as an ordinary link, and sends the visitor to the
// page-not-found screen.
//
// That is the repo's own rule being broken by omission: **a dead link is worse
// than a missing one, because it looks like it works.** It was written down
// when `/give`'s "Speak with a pastor" button came out of the extractor
// pointing at `#`, and the fix there was one call site. This is the general
// case — every link anybody types from now on.
//
// So two things live here. A PICKER, so the ordinary way to link to a page on
// this site is to choose it rather than to type it; and a CHECK, so an address
// that answers nothing says so while somebody is still looking at it.
//
// ⚠ IT WARNS, IT NEVER REFUSES. An address can be legitimately unresolvable at
// the moment it is typed — a page somebody is about to create, a redirect the
// office adds next week, a path served by a Worker route this admin knows
// nothing about. Refusing would be wrong often enough to be infuriating, and
// the office would learn to work around it. Naming it is enough.
//
// Pure functions over plain objects — no D1, no Request. See admin/links.test.mjs.

// ── WHAT COUNTS AS "SOMETHING IS THERE" ──────────────────────────────────────
// Not just page slugs. Three separate things answer an address on this site,
// and a check that knew only about the first would cry wolf on the other two:
//
//   pages      — a `pages` row's own slug (/about, /about/values)
//   short      — the derived short link (/beliefs for /about/beliefs), which is
//                the address that gets printed on a flyer and said from the
//                pulpit, and is very often the one somebody types here
//   redirect   — a `redirects` row (/zoom, /councilfiles, /volunteer), which is
//                a real destination even though no page row exists for it
//
// The ministry pages are `pages` rows too and answer on both their own address
// and /ministries/<slug>, so they need no separate kind — the caller supplies
// both spellings.
export const TARGET_KINDS = ['page', 'short', 'redirect'];

// One canonical spelling, so /About/ and /about compare equal. Query strings
// and fragments are dropped: /news?tag=x is the /news page, and the part after
// the ? is not this function's business.
export function normalizePath(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  s = s.split('#')[0].split('?')[0];
  if (!s.startsWith('/')) return '';
  s = s.toLowerCase();
  // A trailing slash is the same address; '/' itself is the homepage and keeps it.
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

// The site's own hostnames. An absolute link to one of these is not wrong —
// it works — but it is worth saying something about, because the test site
// serves the same pages on a different host and a hardcoded absolute address
// silently keeps pointing at production from there.
const OWN_HOSTS = ['timothystl.org', 'www.timothystl.org'];

// ── WHAT KIND OF ADDRESS IS THIS ─────────────────────────────────────────────
// Deliberately mirrors what safeUrl() accepts, because anything it rejects is
// stored as an empty string and the field will simply appear to have lost what
// was typed into it — which is worth its own message rather than silence.
export function linkKind(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 'empty';
  if (s.startsWith('#')) return 'anchor';
  if (/^mailto:/i.test(s)) return 'mailto';
  if (/^tel:/i.test(s)) return 'tel';
  if (/^https?:\/\//i.test(s)) return 'external';
  if (s.startsWith('/')) return 'internal';
  // safeUrl turns a bare domain typed by staff into https://…, so it is
  // external once stored. Anything else it drops entirely.
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'external';
  return 'unusable';
}

const hostOf = (raw) => {
  const m = String(raw).match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : '';
};

// ── THE ANSWER ───────────────────────────────────────────────────────────────
// `targets` is [{ url, label, kind }] — see linkTargets() in the Worker.
// Returns what this address is, whether anything answers it, and what to say.
export function resolveLink(raw, targets = []) {
  const kind = linkKind(raw);
  const out = { kind, ok: true, label: '', warning: '' };

  if (kind === 'empty' || kind === 'anchor' || kind === 'mailto' || kind === 'tel') return out;

  if (kind === 'unusable') {
    out.ok = false;
    out.warning = 'This is not an address the site can use, so it will not be saved. '
      + 'A page on this site starts with a slash, and anything else needs https:// in front of it.';
    return out;
  }

  if (kind === 'external') {
    const host = hostOf(raw.startsWith('http') ? raw : 'https://' + raw);
    if (OWN_HOSTS.includes(host)) {
      // Not an error — it works. But it pins the link to production, so the
      // same page on test.timothystl.org sends people to the live site.
      const path = normalizePath('/' + String(raw).replace(/^https?:\/\/[^/]+\/?/i, ''));
      out.warning = 'This points back at this same site. Use just '
        + (path || '/') + ' instead, so the link keeps working on the test site too.';
    }
    return out;
  }

  // Internal. This is the case that was silently producing dead links.
  const path = normalizePath(raw);
  const hit = targets.find((t) => normalizePath(t.url) === path);
  if (hit) {
    out.label = hit.label || '';
    return out;
  }
  out.ok = false;
  out.warning = 'Nothing on this site answers ' + path + ' yet, so this link would show the '
    + '“page not found” screen. Pick a page below, or leave it if you are about to make that page.';
  return out;
}

// Just the sentence, for a caller that wants nothing else.
export function linkWarning(raw, targets = []) {
  return resolveLink(raw, targets).warning;
}

// ── THE PICKER'S OWN LIST ────────────────────────────────────────────────────
// Grouped, deduplicated and sorted for a <select>. A short link and the page it
// derives from are the SAME destination, so only one of them is offered — the
// short one, because that is the address the church actually uses and the one
// that survives the page being moved under a different parent.
export function pickerGroups(targets = []) {
  const byPath = new Map();
  for (const t of targets) {
    const path = normalizePath(t.url);
    if (!path) continue;
    const prev = byPath.get(path);
    // A page beats a redirect at the same address, because the page is the
    // thing and the redirect is a way of reaching it.
    if (!prev || (prev.kind === 'redirect' && t.kind !== 'redirect')) {
      byPath.set(path, { url: path, label: t.label || path, kind: t.kind || 'page' });
    }
  }
  // Drop a page whose short link is also offered: two rows reading "About" and
  // "About" that go to the same place is a picker somebody stops trusting.
  const all = [...byPath.values()];
  const shortLabels = new Set(all.filter((t) => t.kind === 'short').map((t) => t.label));
  const kept = all.filter((t) => !(t.kind === 'page' && shortLabels.has(t.label)));

  const group = (kind, name) => ({
    name,
    items: kept.filter((t) => (kind === 'page' ? t.kind !== 'redirect' : t.kind === 'redirect'))
      .sort((a, b) => a.label.localeCompare(b.label)),
  });
  return [group('page', 'Pages on this site'), group('redirect', 'Short links & redirects')]
    .filter((g) => g.items.length);
}

// ── THE CLIENT-SIDE MIRROR ───────────────────────────────────────────────────
// The picker and the check have to run in the BROWSER: the warning must appear
// while somebody is still looking at the box they typed into, and re-rendering
// the inspector on every keystroke to get it would steal the focus out from
// under them.
//
// Shipped as a string from this file, the same way give-link.js ships its
// arithmetic, so the browser copy and the server copy are edited in one place
// and can be read next to each other. admin/links.test.mjs evaluates this
// string and runs the SAME assertions against it as against the exports above,
// so the two cannot drift without a test failing.
//
// ⚠ No backticks and no template literals in here. This string is itself
// inside a template literal in the file that ships it, and a stray backtick
// terminates that literal and breaks the whole module while still passing
// `node --check` — which has now bitten this repo four times.
export const LINKS_JS = `
function tlcNormalizePath(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  s = s.split('#')[0].split('?')[0];
  if (s.charAt(0) !== '/') return '';
  s = s.toLowerCase();
  if (s.length > 1 && s.charAt(s.length - 1) === '/') s = s.slice(0, -1);
  return s;
}
function tlcLinkKind(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return 'empty';
  if (s.charAt(0) === '#') return 'anchor';
  if (/^mailto:/i.test(s)) return 'mailto';
  if (/^tel:/i.test(s)) return 'tel';
  if (/^https?:\\/\\//i.test(s)) return 'external';
  if (s.charAt(0) === '/') return 'internal';
  if (/^[\\w.-]+\\.[a-z]{2,}(\\/|$)/i.test(s)) return 'external';
  return 'unusable';
}
function tlcResolveLink(raw, targets) {
  targets = targets || [];
  var kind = tlcLinkKind(raw);
  var out = { kind: kind, ok: true, label: '', warning: '' };
  if (kind === 'empty' || kind === 'anchor' || kind === 'mailto' || kind === 'tel') return out;
  if (kind === 'unusable') {
    out.ok = false;
    out.warning = 'This is not an address the site can use, so it will not be saved. '
      + 'A page on this site starts with a slash, and anything else needs https:// in front of it.';
    return out;
  }
  if (kind === 'external') {
    var withProto = /^https?:\\/\\//i.test(raw) ? String(raw) : 'https://' + String(raw);
    var m = withProto.match(/^https?:\\/\\/([^/?#]+)/i);
    var host = m ? m[1].toLowerCase() : '';
    if (host === 'timothystl.org' || host === 'www.timothystl.org') {
      var path = tlcNormalizePath('/' + String(raw).replace(/^https?:\\/\\/[^/]+\\/?/i, ''));
      out.warning = 'This points back at this same site. Use just ' + (path || '/')
        + ' instead, so the link keeps working on the test site too.';
    }
    return out;
  }
  var want = tlcNormalizePath(raw);
  for (var i = 0; i < targets.length; i++) {
    if (tlcNormalizePath(targets[i].url) === want) { out.label = targets[i].label || ''; return out; }
  }
  out.ok = false;
  out.warning = 'Nothing on this site answers ' + want + ' yet, so this link would show the '
    + '\u201Cpage not found\u201D screen. Pick a page below, or leave it if you are about to make that page.';
  return out;
}
function tlcLinkWarning(raw, targets) { return tlcResolveLink(raw, targets).warning; }
function tlcPickerGroups(targets) {
  targets = targets || [];
  var byPath = {}, order = [];
  for (var i = 0; i < targets.length; i++) {
    var path = tlcNormalizePath(targets[i].url);
    if (!path) continue;
    var prev = byPath[path];
    if (!prev || (prev.kind === 'redirect' && targets[i].kind !== 'redirect')) {
      if (!prev) order.push(path);
      byPath[path] = { url: path, label: targets[i].label || path, kind: targets[i].kind || 'page' };
    }
  }
  var all = order.map(function (p) { return byPath[p]; });
  var shortLabels = {};
  all.forEach(function (t) { if (t.kind === 'short') shortLabels[t.label] = 1; });
  var kept = all.filter(function (t) { return !(t.kind === 'page' && shortLabels[t.label]); });
  var mk = function (isRedirect, name) {
    return { name: name, items: kept.filter(function (t) {
      return isRedirect ? t.kind === 'redirect' : t.kind !== 'redirect';
    }).sort(function (a, b) { return a.label.localeCompare(b.label); }) };
  };
  return [mk(false, 'Pages on this site'), mk(true, 'Short links & redirects')]
    .filter(function (g) { return g.items.length; });
}
`;
