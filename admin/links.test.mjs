// Node test harness for admin/links.js — run with: node admin/links.test.mjs
//
// The assertion that matters here is not "does it find a page". It is that a
// dead internal link is NAMED, because the whole reason this module exists is
// the repo's own rule: a dead link is worse than a missing one, since it looks
// like it works. Everything else is about not crying wolf — an address that
// legitimately resolves through a short link or a redirect must not be flagged,
// or the office learns to ignore the warning and it stops meaning anything.
import { normalizePath, linkKind, resolveLink, linkWarning, pickerGroups, LINKS_JS } from './links.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// The three things that answer an address on this site.
const TARGETS = [
  { url: '/', label: 'Home', kind: 'page' },
  { url: '/about', label: 'About', kind: 'page' },
  { url: '/about/values', label: 'Our Values', kind: 'page' },
  { url: '/ministries/music', label: 'Music Ministry', kind: 'page' },
  { url: '/music', label: 'Music Ministry', kind: 'short' },
  { url: '/zoom', label: 'Zoom meeting', kind: 'redirect' },
];

group('One canonical spelling, so a link is not flagged over a slash');
{
  eq(normalizePath('/About/'), '/about', 'case and a trailing slash are the same address');
  eq(normalizePath('/news?tag=x'), '/news', 'a query string is not this function’s business');
  eq(normalizePath('/news#top'), '/news', 'nor is a fragment');
  eq(normalizePath('/'), '/', 'the homepage keeps its slash');
  eq(normalizePath('about'), '', 'a bare word is not a path');
  eq(normalizePath(null), '', 'and neither is nothing');
}

group('What kind of address this is');
{
  eq(linkKind(''), 'empty', 'blank');
  eq(linkKind('/about'), 'internal', 'a page on this site');
  eq(linkKind('#signup'), 'anchor', 'a spot on the same page');
  eq(linkKind('mailto:office@timothystl.org'), 'mailto', 'an email address');
  eq(linkKind('tel:+13147818673'), 'tel', 'a phone number');
  eq(linkKind('https://serve.timothystl.org'), 'external', 'another site');
  // safeUrl() turns this into https://… on the way in, so it is external.
  eq(linkKind('wordoflifeschool.net'), 'external', 'a bare domain typed by staff');
  eq(linkKind('javascript:alert(1)'), 'unusable', 'and anything safeUrl would drop');
}

group('⚠ A dead internal link is named — the whole point of this module');
{
  const bad = resolveLink('/abuot', TARGETS);
  eq(bad.ok, false, 'a typo does not resolve');
  ok(bad.warning.includes('/abuot'), 'the warning quotes back the address that fails');
  ok(/page not found/i.test(bad.warning), 'and says what a visitor would actually see');
  // ⚠ It must not read as a refusal. A page somebody is about to create is a
  // legitimate reason to type an address that answers nothing today.
  ok(/about to make that page|leave it/i.test(bad.warning),
    'and says the address may simply not exist yet, because refusing would be wrong often enough to be ignored');

  eq(resolveLink('', TARGETS).warning, '', 'a blank link is not a problem to solve');
  eq(resolveLink('#top', TARGETS).warning, '', 'nor is an anchor');
  eq(resolveLink('mailto:office@timothystl.org', TARGETS).warning, '', 'nor an email address');
  eq(resolveLink('https://serve.timothystl.org', TARGETS).warning, '', 'nor another site entirely');
}

group('⚠ It must not cry wolf, or the office learns to ignore it');
{
  // Every one of these resolves through a DIFFERENT mechanism. A check that
  // knew only about page slugs would flag the last two, which are exactly the
  // addresses the church prints on flyers.
  for (const [url, why] of [
    ['/about', 'a page slug'],
    ['/about/values', 'a nested page'],
    ['/', 'the homepage'],
    ['/ministries/music', 'a ministry page at its full address'],
    ['/music', 'the same ministry at its SHORT link, which is what gets printed'],
    ['/zoom', 'a redirect with no page row behind it at all'],
  ]) {
    eq(resolveLink(url, TARGETS).ok, true, why + ' resolves');
    eq(resolveLink(url, TARGETS).warning, '', why + ' is not warned about');
  }
  eq(resolveLink('/ABOUT/', TARGETS).ok, true, 'and neither case nor a trailing slash trips it');
  eq(resolveLink('/news?tag=x', TARGETS).ok, false, 'an unknown page is still unknown with a query on it');
  eq(resolveLink('/about?x=1', TARGETS).ok, true, 'and a known one is still known');
}

group('An absolute link back at this same site');
{
  // Not an error — it works. But it pins the link to production, so the same
  // page on test.timothystl.org sends people to the live site instead.
  const own = resolveLink('https://timothystl.org/about', TARGETS);
  eq(own.ok, true, 'it is not treated as broken, because it is not');
  ok(own.warning.includes('/about'), 'but it suggests the plain address');
  ok(/test site/i.test(own.warning), 'and says why that matters');
  eq(resolveLink('https://www.timothystl.org/give', TARGETS).warning.includes('/give'), true, 'www too');
  eq(resolveLink('https://serve.timothystl.org/x', TARGETS).warning, '',
    'a genuinely different host of the church’s is left alone');
}

group('An address the site cannot use at all');
{
  const bad = resolveLink('javascript:alert(1)', TARGETS);
  eq(bad.ok, false, 'refused');
  // safeUrl() stores '' for this, so the field would appear to have simply
  // lost what was typed. Saying so beats silence.
  ok(/will not be saved/i.test(bad.warning), 'and says it will not be saved, rather than leaving the field to empty itself');
}

group('The picker offers each destination once');
{
  const groups = pickerGroups(TARGETS);
  eq(groups.length, 2, 'pages, and short links & redirects');
  eq(groups[0].name, 'Pages on this site', 'pages lead');
  const labels = groups[0].items.map((i) => i.label);
  // ⚠ /music and /ministries/music are the SAME destination. Offering both is
  // two rows reading "Music Ministry" that go to the same place, which is a
  // picker somebody stops trusting.
  eq(labels.filter((l) => l === 'Music Ministry').length, 1, 'a ministry appears once, not at both its addresses');
  eq(groups[0].items.find((i) => i.label === 'Music Ministry').url, '/music',
    'and it is the SHORT address that is offered, because that is the one the church uses');
  ok(labels.indexOf('About') < labels.indexOf('Our Values'), 'sorted by name');
  eq(groups[1].items.length, 1, 'the redirect is offered separately');
  eq(groups[1].items[0].url, '/zoom', 'as itself');

  // A page and a redirect at one address is the page — the page is the thing,
  // the redirect is a way of reaching it.
  const clash = pickerGroups([
    { url: '/give', label: 'Giving link', kind: 'redirect' },
    { url: '/give', label: 'Give', kind: 'page' },
  ]);
  eq(clash.length, 1, 'one address, one entry');
  eq(clash[0].items[0].label, 'Give', 'and the page wins');

  eq(pickerGroups([]).length, 0, 'nothing to offer is no groups, not an empty one');
  eq(pickerGroups([{ url: 'not-a-path', label: 'x' }]).length, 0, 'and an unusable target is dropped');
}

group('linkWarning is the sentence and nothing else');
{
  eq(linkWarning('/about', TARGETS), '', 'silent when it resolves');
  ok(linkWarning('/nope', TARGETS).length > 20, 'and a real sentence when it does not');
}

// ── THE BROWSER COPY, AGAINST THE SAME ASSERTIONS ──────────────────────────
// The picker and the check have to run in the browser, so there are two
// implementations. This is what stops them drifting: the client mirror is
// evaluated here and put through the SAME cases as the exports above, rather
// than being eyeballed for similarity.
//
// ⚠ It is evaluated with `new Function`, which is the point — if the string is
// not valid JavaScript, that throws here rather than in somebody's editor,
// where a broken picker looks like a field that has simply stopped working.
group('The browser copy answers identically');
{
  const mirror = new Function(LINKS_JS +
    'return { tlcNormalizePath, tlcLinkKind, tlcResolveLink, tlcLinkWarning, tlcPickerGroups };')();

  const cases = ['', '/about', '/ABOUT/', '/abuot', '/music', '/zoom', '#top',
    'mailto:office@timothystl.org', 'tel:+13147818673', 'https://serve.timothystl.org',
    'https://timothystl.org/about', 'wordoflifeschool.net', 'javascript:alert(1)',
    '/news?tag=x', '/about?x=1', 'about'];

  for (const c of cases) {
    const a = resolveLink(c, TARGETS);
    const bb = mirror.tlcResolveLink(c, TARGETS);
    eq(bb.kind, a.kind, JSON.stringify(c) + ': same kind in the browser');
    eq(bb.ok, a.ok, JSON.stringify(c) + ': same verdict in the browser');
    eq(bb.warning, a.warning, JSON.stringify(c) + ': same words in the browser');
    eq(mirror.tlcNormalizePath(c), normalizePath(c), JSON.stringify(c) + ': same canonical path');
    eq(mirror.tlcLinkKind(c), linkKind(c), JSON.stringify(c) + ': same classification');
    eq(mirror.tlcLinkWarning(c, TARGETS), linkWarning(c, TARGETS), JSON.stringify(c) + ': same sentence');
  }

  eq(JSON.stringify(mirror.tlcPickerGroups(TARGETS)), JSON.stringify(pickerGroups(TARGETS)),
    'and the picker offers exactly the same list, in the same order');
  eq(JSON.stringify(mirror.tlcPickerGroups([])), JSON.stringify(pickerGroups([])), 'including when there is nothing');

  // ⚠ The string is itself inside a template literal in the file that ships it.
  // A backtick would end that literal and break the whole module while still
  // passing `node --check` — four times in this repo now.
  ok(!LINKS_JS.includes(String.fromCharCode(96)), 'the mirror contains no backtick');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
