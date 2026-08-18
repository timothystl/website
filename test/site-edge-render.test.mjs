// The published blocks, put into the HTML at the edge — run with:
//   node test/site-edge-render.test.mjs
//
// Dinger: "the old pages and content are always loading first and then current
// content and layout display even on hard refresh." Publishing more pages could
// never have fixed that. public/index.html ships the hardcoded markup for all
// 28 pages, and that is what paints; the published blocks arrive afterwards,
// from a request to another origin. site-worker.js now puts them into the
// document as it serves it.
//
// The assertions worth having are all about what must NOT happen: the same
// blocks twice, an injection into the wrong page, or a page that stops working
// because the admin was unreachable.
import { readFileSync } from 'node:fs';
import { pathForPageId, pageIdForPath, rewriteDocument } from '../site-worker.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// ── a recording stand-in for HTMLRewriter ────────────────────────────────────
// HTMLRewriter is a Workers API and does not exist in Node. What is worth
// testing here is not Cloudflare's parser — it is WHICH selectors we ask for
// and WHAT we do to the elements they match, and a recorder pins both.
function fakeElement() {
  const attrs = new Map();
  const added = [];
  return {
    added,
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, v),
    prepend: (html) => added.push({ where: 'prepend', html }),
    append: (html) => added.push({ where: 'append', html }),
    attrs,
  };
}

function runRewrite(opts) {
  const seen = [];
  let transformed = null;
  class Recorder {
    on(selector, handlers) { seen.push({ selector, handlers }); return this; }
    transform(res) { transformed = res; return res; }
  }
  const prev = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = Recorder;
  try {
    rewriteDocument({ marker: 'the response' }, opts);
  } finally {
    if (prev === undefined) delete globalThis.HTMLRewriter; else globalThis.HTMLRewriter = prev;
  }
  const fire = (selector) => {
    const hit = seen.find((s) => s.selector === selector);
    if (!hit) return null;
    const el = fakeElement();
    hit.handlers.element(el);
    return el;
  };
  return { selectors: seen.map((s) => s.selector), fire, transformed };
}

// ── the address of a page ────────────────────────────────────────────────────
group('the edge and the router agree on where a page lives');
{
  eq(pathForPageId('home'), '/', 'the homepage is /');
  eq(pathForPageId('worship'), '/worship', 'an ordinary page is its own id');
  eq(pathForPageId('values'), '/about/values', 'and a nested one is nested');
  eq(pathForPageId('marketvendors'), '/christmasmarket/vendors', 'and so is the market application');
  eq(pathForPageId('marketvendorsapply'), '/christmasmarket/vendors/apply', 'and the apply page the split added');

  // ⚠ THE ASSERTION THIS FILE EXISTS FOR. site-worker.js carries a mirror of
  // tlcPathFor() in public/index.html, because the SPA routes by page ID and
  // its divs are id="page-<id>" — using pages.slug at the edge would let the
  // worker inject into a page the router does not agree it is showing. There is
  // no module both files can import, so the two copies are held together the
  // way styleVars()/wrapperVars() already are: read both, assert they agree.
  const spa = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const nested = spa.match(/var NESTED_PATHS = (\{[^}]*\});/);
  ok(!!nested, 'NESTED_PATHS is still found in the SPA');
  const fn = spa.match(/function tlcPathFor\(id\) \{ return ([^;]+); \}/);
  ok(!!fn, 'tlcPathFor is still found in the SPA');
  if (nested && fn) {
    // eslint-disable-next-line no-new-func
    const theirs = new Function('NESTED_PATHS', 'id', 'return ' + fn[1] + ';')
      .bind(null, JSON.parse(nested[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"')));
    for (const id of ['home', 'worship', 'values', 'news', 'give', 'ministries', 'marketvendors', 'marketvendorsapply']) {
      eq(pathForPageId(id), theirs(id), 'the two copies agree for ' + id);
    }
  }
}

group('a request path finds its page, or finds nothing');
{
  const data = { pages: [{ id: 'home' }, { id: 'news' }, { id: 'values' }] };
  eq(pageIdForPath(data, '/'), 'home', 'the root is the homepage');
  eq(pageIdForPath(data, '/news'), 'news', 'a page by its address');
  eq(pageIdForPath(data, '/news/'), 'news', 'a trailing slash is the same address');
  eq(pageIdForPath(data, '/NEWS'), 'news', 'and so is a shouted one');
  eq(pageIdForPath(data, '/about/values'), 'values', 'a nested address resolves');
  eq(pageIdForPath(data, '/nothing-here'), '', 'an unknown address matches nothing');
  eq(pageIdForPath(data, '/newsletter'), '', 'and a longer address is not a prefix match');
  // ⚠ Every one of these must be survivable: they are what an unreachable admin
  // or a half-written payload looks like, and the answer to all of them is
  // "inject nothing", never "throw on the way to serving the church website".
  eq(pageIdForPath(null, '/news'), '', 'no payload at all');
  eq(pageIdForPath({}, '/news'), '', 'a payload with no pages');
  eq(pageIdForPath({ pages: null }, '/news'), '', 'a payload with a null page list');
}

// ── what the rewriter is asked to do ─────────────────────────────────────────
group('the blocks go in, and the hardcoded markup is stood down');
{
  const r = runRewrite({
    socialImage: '', pageId: 'news',
    blocksHtml: '<div class="tlcb-page">real content</div>',
    blockCss: '<style id="tlcb-css">.tlcb{}</style>',
  });
  ok(r.selectors.includes('#page-news'), 'it targets the page being served');
  ok(r.selectors.includes('#page-news > *'), 'and that page\'s own children');
  ok(!r.selectors.includes('#page-home'), 'and no other page — one page per request, not all 28');

  const page = r.fire('#page-news');
  eq(page.added.length, 1, 'the blocks are added once');
  eq(page.added[0].where, 'prepend', 'above the hardcoded markup, not below it');
  // ⚠ The same host id the client-side takeover creates. Everything that later
  // looks for it — feed hydration, a takeover on SPA navigation — expects it.
  ok(page.added[0].html.startsWith('<div id="news-blocks">'), 'in the host the client also builds');
  ok(page.added[0].html.includes('real content'), 'carrying the rendered blocks');
  eq(page.getAttribute('data-tlcb-edge'), '1', 'and the page is marked, so the client does not do it again');

  const child = r.fire('#page-news > *');
  ok(/display:none/.test(child.getAttribute('style')), 'the hardcoded sections are hidden');
  // ⚠ An existing style attribute is KEPT. A section carrying its own styling
  // must not lose it on the way to being hidden, because it is still the
  // fallback if the page is ever re-rendered client-side.
  {
    const seen = [];
    class Rec { on(sel, h) { seen.push({ sel, h }); return this; } transform(x) { return x; } }
    const prev = globalThis.HTMLRewriter;
    globalThis.HTMLRewriter = Rec;
    rewriteDocument({}, { socialImage: '', pageId: 'news', blocksHtml: '<i>x</i>', blockCss: '' });
    if (prev === undefined) delete globalThis.HTMLRewriter; else globalThis.HTMLRewriter = prev;
    const styled = fakeElement();
    styled.setAttribute('style', 'background:red');
    seen.find((x) => x.sel === '#page-news > *').h.element(styled);
    eq(styled.getAttribute('style'), 'background:red;display:none', 'appended, not replaced');
  }
  // ⚠ Hidden, never removed. The client hides them too, and a page re-rendered
  // client-side later expects them to still be there.
  eq(child.added.length, 0, 'and nothing is removed');

  const head = r.fire('head');
  ok(head && head.added.length === 1 && head.added[0].where === 'append',
    'the block stylesheet is appended to the head');
  ok(head.added[0].html.includes('tlcb-css'), 'and it is the one the client would have added');
}

group('the chrome is in the first paint too');
{
  // ⚠ MEASURED AGAINST THE LIVE SITE, which is where this came from: the
  // stylesheet paints the bar `var(--sage)` (moss) and the stored appearance is
  // slate, so every page painted a moss header and snapped to slate when
  // /api/pages returned. The page BODY was already arriving rendered; the
  // chrome was not.
  const appearance = {
    fonts: { head: 'Bricolage', body: 'Newsreader', ui: 'Bricolage' },
    textScale: { body: 1.1, head: 1.05 },
    bar: '#3A4E5C', rule: '#C9973A', cta: '#C9973A', ink: '#FFFFFF', ctaInk: '#FFFFFF',
    logo: 'https://admin.timothystl.org/images/logo.png', logoShape: 'round',
    name: 'Timothy Lutheran Church', tagline: 'from our Neighborhood to the Nations',
    newsletter: { bg: '#3A4E5C', eyebrow: 'Stay Connected', heading: 'Get our weekly newsletter' },
  };
  const r = runRewrite({ socialImage: '', pageId: '', blocksHtml: '', blockCss: '', appearance });

  const head = r.fire('head');
  // ⚠ Reported, not thrown. Without the chrome the head handler is never
  // registered and `head` is null — a crash here would say "TypeError" where it
  // should say which property went missing.
  ok(!!head, 'the head is rewritten at all');
  const css = head ? head.added.map((a) => a.html).join('') : '';
  ok(css.includes('--nav-bar:#3A4E5C'), 'the header color is written into the document');
  ok(css.includes('--tlc-text-scale:1.1'), 'and the text size');
  ok(css.includes('--font-body:Newsreader'), 'and the reading face');
  // ⚠ These are the exact properties applyAppearance() sets. If the edge set
  // one name and the client set another the flash would simply move.
  for (const k of ['--nav-rule', '--nav-cta', '--nav-ink', '--nav-cta-ink', '--font-heading', '--font-ui', '--tlc-head-scale']) {
    ok(css.includes(k + ':'), k + ' is set at the edge');
  }

  const logo = r.fire('img.nav-logo-img');
  eq(logo.getAttribute('src'), appearance.logo, 'the real logo is served, not the markup default');
  const band = r.fire('#newsletter-band');
  ok(/background:#3A4E5C/.test(band.getAttribute('style')), 'the newsletter band arrives its own color');

  // ⚠ CHROME IS ON EVERY PAGE, published or not. An unconverted page flashes
  // its header exactly the same way a converted one does, so this must not be
  // gated on there being blocks.
  ok(r.selectors.includes('head'), 'with no published blocks at all');
  ok(!r.selectors.includes('#page-news'), 'and no page injection alongside it');
}

group('an appearance that says nothing changes nothing');
{
  // The whole change is additive: a missing record, or a field absent from it,
  // leaves the stylesheet's own fallbacks exactly as they are today.
  eq(runRewrite({ socialImage: '', pageId: '', blocksHtml: '', appearance: null }).selectors.length, 0,
    'no record, no rewriting');
  const bare = runRewrite({ socialImage: '', pageId: '', blocksHtml: '', appearance: {} });
  const head = bare.fire('head');
  ok(!head || head.added.length === 0, 'an empty record writes no stylesheet');
  const logo = bare.fire('img.nav-logo-img');
  ok(logo && logo.getAttribute('src') === null, 'and leaves the markup logo alone');

  // ⚠ A blank logo is a real choice — the church name on its own — so it hides
  // the image rather than leaving the default one in place.
  const noLogo = runRewrite({ socialImage: '', pageId: '', blocksHtml: '', appearance: { logo: '', bar: '#111' } });
  ok(/display:none/.test(noLogo.fire('img.nav-logo-img').getAttribute('style')), 'an empty logo is hidden');
  // And a band switched off is not drawn.
  ok(/display:none/.test(noLogo.fire('#newsletter-band').getAttribute('style')), 'a band switched off is hidden');

  // ⚠ These land in a stylesheet and an attribute. The values come from a fixed
  // list in admin/appearance.js rather than from anything a visitor types, but
  // the characters that could end a declaration or the block are dropped rather
  // than reasoned about.
  const nasty = runRewrite({ socialImage: '', pageId: '', blocksHtml: '',
    appearance: { bar: 'red;}body{display:none', textScale: { body: 'NaN', head: 99 } } });
  const out = nasty.fire('head').added.map((a) => a.html).join('');
  ok(!out.includes('}body{'), 'a crafted color cannot close the rule');
  ok(!/--tlc-text-scale:/.test(out), 'a non-number scale is dropped');
  ok(!/--tlc-head-scale:/.test(out), 'and so is one outside a sane range');
}

group('nothing published means nothing touched');
{
  const r = runRewrite({ socialImage: '', pageId: '', blocksHtml: '', blockCss: '' });
  eq(r.selectors.length, 0, 'no page, no rewriting at all');

  // A page that resolved but has nothing published is the same case: the
  // hardcoded markup is the page, exactly as before this existed.
  const none = runRewrite({ socialImage: '', pageId: 'news', blocksHtml: '', blockCss: '' });
  eq(none.selectors.length, 0, 'a page with no published blocks is left alone');
}

group('the social image still works, and shares the one pass');
{
  const both = runRewrite({
    socialImage: 'https://example.org/p.jpg', pageId: 'news',
    blocksHtml: '<div>x</div>', blockCss: '',
  });
  ok(both.selectors.includes('meta[property="og:image"]'), 'og:image is still rewritten');
  ok(both.selectors.includes('meta[name="twitter:image"]'), 'and the Twitter tag with it');
  ok(both.selectors.includes('#page-news'), 'in the SAME rewriter as the blocks');
  eq(both.transformed.marker, 'the response', 'one transform over the document, not two');

  const alone = runRewrite({ socialImage: 'https://example.org/p.jpg', pageId: '', blocksHtml: '' });
  eq(alone.selectors.length, 2, 'and it still works on a page with no blocks');

  // ⚠ Set only when there is one. Passing an empty string through would blank
  // the tag the markup already carries, so every shared link would lose its
  // picture the moment this ran.
  const neither = runRewrite({ socialImage: '', pageId: '', blocksHtml: '' });
  eq(neither.selectors.length, 0, 'and an unset image leaves the markup alone');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
