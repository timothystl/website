// The links page — run with: node test/links-page.test.mjs
//
// Two things this file exists to pin down.
//
// 1. Each tap shows its own cards. The tag holds nothing but a short address,
//    so the page has to work out which tap it is BY that address — the one the
//    office typed into "Lands on". Nothing is configured twice, which is the
//    property that keeps the two Workers from drifting.
// 2. A card can be a sign-up form rather than a link, which means the URL
//    check must stop applying to it without being weakened for anything else.
import worker from '../tlc-links-worker.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const same = (a, b, msg) => eq(JSON.stringify(a), JSON.stringify(b), msg);
const group = (n) => console.log('\n' + n);

const TAPS = [
  { id: 1, destination: 'https://links.timothystl.org' },
  { id: 2, destination: 'https://links.timothystl.org/welcome' },
  { id: 3, destination: 'https://give.timothystl.org' },
  { id: 4, destination: 'https://links.timothystl.org/school' },
];
const CARDS = [
  { title: 'Everywhere', url: 'https://timothystl.org/contact', kind: 'link', tap: null, icon_color: 'sage' },
  { title: 'Narthex',    url: 'https://timothystl.org/news',    kind: 'link', tap: 1,    icon_color: 'sky' },
  { title: 'Visitors',   url: 'https://timothystl.org/about',   kind: 'link', tap: 2,    icon_color: 'sky' },
  { title: 'Plate',      url: 'https://give.tithe.ly/x',        kind: 'link', tap: 3,    icon_color: 'amber' },
  { title: 'Newsletter', url: '',                               kind: 'signup', tap: null, icon_color: 'amber' },
];

let adminUp = true;
let payload = { cards: CARDS, taps: TAPS };
globalThis.fetch = async () => {
  if (!adminUp) throw new Error('admin unreachable');
  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
};

const at = async (path, host = 'links.timothystl.org') =>
  (await worker.fetch(new Request(`https://${host}${path}`))).text();
// Card titles render inside a <div class="card-title">, so match the element
// rather than the word — "Everywhere" also appears in prose on the page.
const titles = (html) => [...html.matchAll(/<div class="card-title">([^<]+)<\/div>/g)].map((m) => m[1]);

group('each tap shows its own cards');
{
  same(await at('/').then(titles), ['Everywhere', 'Narthex', 'Newsletter'],
    'the root address is tap 1 — its cards, plus the ones on every tap');
  same(await at('/welcome').then(titles), ['Everywhere', 'Visitors', 'Newsletter'],
    'a tap with its own path shows its own cards');

  // A card with no tap is on all of them. That is what every card was before
  // taps existed, so nothing has to be reassigned for this to be right today.
  ok((await at('/welcome')).includes('Everywhere'), 'an untagged card shows behind every tap');
  ok(!(await at('/welcome')).includes('Narthex'), 'and another tap\'s card does not');

  // Trailing slashes and case are noise in an address printed on a card.
  same(await at('/Welcome/').then(titles), await at('/welcome').then(titles),
    'the match ignores case and a trailing slash');

  // An address nobody has claimed shows the link tree rather than an empty
  // page — a mistyped or shared URL is still the church's links.
  same(await at('/nothing-here').then(titles), await at('/').then(titles),
    'an unclaimed address falls back to the link tree');
}

group('a tap landing off the links page');
{
  // Tap 3 points at the giving page, which is a different Worker entirely, so
  // its card can never appear here. The admin says so on the tap's own card;
  // what matters here is that it does not leak onto somebody else's tap.
  const everywhere = [await at('/'), await at('/welcome'), await at('/school')];
  ok(!everywhere.some((h) => h.includes('Plate')),
    'a card on a tap that lands elsewhere shows on no tap');
}

group('a card can be a sign-up form');
{
  const home = await at('/');
  ok(home.includes('signup-card'), 'a signup card renders as a form');
  ok(home.includes('Email address'), 'with the field it exists for');
  // ⚠ It has no URL. The safety check on card addresses must not be applied to
  // it — doing so would silently drop the form.
  ok(titles(home).includes('Newsletter'), 'and is not dropped for having no address');

  // The check still applies to everything else.
  payload = { cards: [{ title: 'Bad', url: 'javascript:alert(1)', kind: 'link', tap: null }], taps: TAPS };
  ok(!(await at('/')).includes('javascript:alert'), 'an unsafe address is still refused');
  payload = { cards: CARDS, taps: TAPS };
}

group('when the admin cannot be read');
{
  adminUp = false;
  const html = await at('/welcome');
  // Everything, rather than nothing: a tap showing the wrong set for a minute
  // beats one that comes up empty in somebody's hand.
  ok(html.includes('Sermon Notes'), 'the built-in cards are served');
  ok(html.includes('signup-card'), 'including the sign-up form, which used to be hardcoded below them');
  eq((await worker.fetch(new Request('https://links.timothystl.org/welcome'))).status, 200,
    'and the tag still resolves');
  adminUp = true;
}

group('no tap information at all');
{
  // An older admin, or a database that could not be read: fall back to showing
  // every card, which is exactly what the page did before taps existed.
  payload = { cards: CARDS, taps: [] };
  const t = titles(await at('/welcome'));
  ok(t.includes('Narthex') && t.includes('Visitors'), 'every card is shown when no taps are known');
  payload = { cards: CARDS, taps: TAPS };
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
