// Node test harness for admin/appearance.js — run with: node admin/appearance.test.mjs
//
// This record is drawn on every page of the website, so the assertions worth
// having are the ones about what CANNOT happen: an unreadable header, a logo
// address that is not an image, a toggle read the wrong way round, or a
// publish that happens without anybody asking for one.
import {
  PALETTE, PALETTE_KEYS, BAR_KEYS, DEFAULTS, colorOf, safeLogoUrl, sanitizeAppearance,
  parseAppearance, appearanceFromForm, isDirty, changedFields, publicAppearance,
  TYPEFACES, TYPEFACE_KEYS, typefaceOf, renderHeaderPreview, renderNewsletterPreview,
  TEXT_SIZES, TEXT_SIZE_KEYS, textSizeOf,
} from './appearance.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// A stand-in for FormData with the two methods the real read uses. `getAll` is
// the one that matters: see the toggle note in appearance.js.
const formOf = (pairs) => ({
  get: (k) => { const hit = pairs.filter((p) => p[0] === k); return hit.length ? hit[hit.length - 1][1] : null; },
  getAll: (k) => pairs.filter((p) => p[0] === k).map((p) => p[1]),
});

// Relative luminance, so "light text is readable on this" is measured rather
// than asserted by eye. Same formula the values suite uses.
const lum = (hex) => {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

group('A bar color cannot be one the nav text disappears against');
{
  // The nav links, the tagline and the brand name are all white and none of
  // them is editable, so a pale bar color would be a header nobody can read —
  // on every page at once, chosen by somebody who was only trying to make it
  // warmer. This is the assertion that keeps such a color off the bar list.
  for (const c of PALETTE.filter((x) => x.bar)) {
    ok(contrast(c.value, c.ink) >= 4.5,
      `${c.label} carries its own ink at 4.5:1 (got ${contrast(c.value, c.ink).toFixed(2)})`);
  }
  ok(!BAR_KEYS.includes('gold'),
    'gold is not offered as a bar color — white on #C9973A is 2.6:1');
  ok(PALETTE_KEYS.includes('gold'),
    'but it stays available for the rule and the Give button, which is how the site already looks');

  // Enforced server-side, not only by which chips the form draws: a stale tab
  // is exactly how an unreadable header would otherwise get saved.
  eq(sanitizeAppearance({ bar: 'gold' }).bar, DEFAULTS.bar, 'a posted gold bar is refused, not honored');
  eq(sanitizeAppearance({ nl_bg: 'gold' }).nl_bg, DEFAULTS.nl_bg, 'and so is a gold newsletter band');
  eq(sanitizeAppearance({ cta: 'gold' }).cta, 'gold', 'while a gold Give button is accepted');

  ok(PALETTE.every((c) => /^#[0-9A-F]{6}$/.test(c.value)), 'every entry is a full six-digit hex');
  eq(new Set(PALETTE_KEYS).size, PALETTE.length, 'no two entries share a key');
  eq(colorOf('nope').key, 'moss', 'an unknown key falls back rather than throwing');
  eq(colorOf('nope', 'gold').key, 'gold', 'and the fallback is the caller\'s to choose');
}

group('The defaults are the site as it stands');
{
  // Somebody opening this screen for the first time should recognize it. A
  // form full of blanks reads as "the header has no settings yet".
  eq(DEFAULTS.bar, 'ink', 'the bar is the redesign\u2019s ink navy');
  eq(DEFAULTS.rule, 'gold', 'over the gold rule');
  eq(DEFAULTS.brand_name, 'Timothy Lutheran Church', 'with the real church name');
  ok(DEFAULTS.tagline.includes('Neighborhood to the Nations'), 'and the real tagline');
  ok(DEFAULTS.nl_show, 'the newsletter band starts on, because it is on the site today');
}

group('Sanitizing refuses what the browser cannot be trusted to');
{
  const bad = sanitizeAppearance({ bar: '#ff0000', rule: 'javascript', cta: null });
  eq(bad.bar, DEFAULTS.bar, 'a raw hex is not a palette key, so it is dropped');
  eq(bad.rule, 'gold', 'and so is anything else not in the list');

  eq(sanitizeAppearance({ logo_shape: 'circle' }).logo_shape, 'round', 'an unknown shape clamps');
  eq(sanitizeAppearance({ logo_shape: 'square' }).logo_shape, 'square', 'a known one is kept');

  eq(sanitizeAppearance({ brand_name: '  Timothy   Lutheran  ' }).brand_name, 'Timothy Lutheran',
    'whitespace is collapsed — this lands in a 64px bar');
  eq(sanitizeAppearance({ tagline: 'x'.repeat(400) }).tagline.length, 120, 'and long text is capped');

  // Emptying both halves of the brand block would leave a bar with nothing in
  // it — and the brand block is also the way back to the homepage.
  eq(sanitizeAppearance({ brand_name: '', logo_url: '' }).brand_name, DEFAULTS.brand_name,
    'a header with no name AND no logo is treated as a mistake, not honored');
  eq(sanitizeAppearance({ brand_name: '', logo_url: '/logo.png' }).brand_name, '',
    'but a logo on its own is a real choice');
}

group('A logo address has to be an image address');
{
  eq(safeLogoUrl('javascript:alert(1)'), '', 'javascript: is refused outright');
  eq(safeLogoUrl('data:image/svg+xml,<svg onload=alert(1)>'), '', 'and so is data:');
  eq(safeLogoUrl('/logo.png'), '/logo.png', 'a site asset is fine');
  eq(safeLogoUrl('https://admin.timothystl.org/images/x.webp'), 'https://admin.timothystl.org/images/x.webp',
    'as is an uploaded one');
  eq(sanitizeAppearance({ logo_url: 'javascript:alert(1)', brand_name: 'TLC' }).logo_url, '',
    'and the refusal survives a full sanitize rather than being escaped later');
}

group('Unreadable storage comes back as the current site');
{
  eq(parseAppearance('').bar, DEFAULTS.bar, 'an empty row is the defaults');
  eq(parseAppearance('not json{').bar, DEFAULTS.bar, 'so is a truncated write');
  eq(parseAppearance(null).brand_name, DEFAULTS.brand_name, 'and so is no row at all');
  eq(parseAppearance(JSON.stringify({ bar: 'teal' })).bar, 'teal', 'a good row is honored');
  eq(parseAppearance(JSON.stringify({ bar: 'teal' })).rule, 'gold',
    'and a partial row fills the rest from the defaults rather than blanking them');
}

group('⚠ A toggle posts a hidden 0 ahead of its checkbox');
{
  // form.get() returns that 0 whether or not the box is ticked, and '0' is a
  // truthy string. Reading it that way would hide the tagline and the
  // newsletter band on every page of the site, silently, on the next save.
  const off = appearanceFromForm(formOf([['show_tagline', '0'], ['nl_show', '0']]));
  eq(off.show_tagline, false, 'an unticked tagline switch really stores false');
  eq(off.nl_show, false, 'and so does the newsletter band');

  const on = appearanceFromForm(formOf([['show_tagline', '0'], ['show_tagline', '1']]));
  eq(on.show_tagline, true, 'a ticked one stores true even though a 0 was posted first');

  const full = appearanceFromForm(formOf([['bar', 'navy'], ['brand_name', 'TLC'], ['nl_show', '0']]));
  eq(full.bar, 'navy', 'the color comes through');
  eq(full.nl_heading, DEFAULTS.nl_heading, 'and a field the form did not show keeps its stored default');
}

group('Draft and published are compared, never remembered');
{
  const live = sanitizeAppearance({});
  ok(!isDirty(live, live), 'an untouched draft is not dirty');
  ok(isDirty(sanitizeAppearance({ bar: 'navy' }), live), 'a changed color is');
  ok(!isDirty({ bar: DEFAULTS.bar, junk: 'ignored' }, live),
    'and a field nobody defined cannot make the screen claim an unpublished change');

  const changed = changedFields(sanitizeAppearance({ bar: 'navy', tagline: 'Hello' }), live);
  ok(changed.includes('bar') && changed.includes('tagline'), 'the screen can name what differs');
  ok(!changed.includes('cta'), 'and not name what does not');
}

group('What the public site is sent');
{
  const pub = publicAppearance({ bar: 'navy', rule: 'gold', cta: 'gold' });
  eq(pub.bar, '#1E2D4A', 'colors are resolved to values here, not in the browser');
  eq(pub.ink, '#FFFFFF', 'with the ink that goes on them');
  ok(!('logo_url' in pub), 'the stored shape is not leaked as-is');

  eq(publicAppearance({ show_tagline: false }).tagline, '',
    'a hidden tagline is sent as empty rather than as a flag the site has to interpret');
  eq(publicAppearance({ nl_show: false }).newsletter, null,
    'and a hidden newsletter band is absent, not present-and-off');
  ok(publicAppearance({ nl_show: true }).newsletter.heading, 'a shown one carries its wording');
}

group('The typeface reaches every page, so it is guarded like one');
{
  eq(TYPEFACES.length, 2, 'two pairs, not a font list');
  ok(TYPEFACE_KEYS.includes('redesign') && TYPEFACE_KEYS.includes('classic'), 'the redesign and the way back');

  // ⚠ THREE ROLES. Collapsing head/ui to one puts the reading serif on every
  // button in the redesign, which is the single thing the design is emphatic
  // about not doing — and it would do it silently, since the text is still
  // legible, just wrong.
  for (const t of TYPEFACES) {
    ok(t.head && t.body && t.ui, t.key + ' names all three roles');
    ok(t.note, t.key + ' says what picking it does');
  }
  ok(typefaceOf('redesign').ui === typefaceOf('redesign').head,
    'in the redesign the UI face is the display face, not the reading face');
  ok(typefaceOf('redesign').ui !== typefaceOf('redesign').body,
    'and specifically not the serif — a serif Give button is the failure this pins');
  ok(typefaceOf('classic').ui === typefaceOf('classic').body,
    'classically the UI face is the body face, which is how the site read before');

  eq(typefaceOf('nonsense').key, 'redesign', 'an unknown pair clamps to the default');
  eq(sanitizeAppearance({ typeface: 'wingdings' }).typeface, 'redesign',
    'and a crafted POST cannot select a pair the site has no fonts loaded for');
  eq(sanitizeAppearance({ typeface: 'classic' }).typeface, 'classic', 'a real one is kept');

  const pub = publicAppearance({ typeface: 'redesign' });
  ok(/Bricolage/.test(pub.fonts.head), 'the site is sent a real stack, not the key');
  ok(/Newsreader/.test(pub.fonts.body), 'including the reading face');
  ok(!('typeface' in pub), 'and not the key alongside it, which would be two answers');

  ok(changedFields({ typeface: 'classic' }, DEFAULTS).includes('typeface'),
    'switching it counts as an unpublished change like any other');

  // ⚠ THE ONE ASSERTION THAT CATCHES A REAL, VISIBLE BUG. public/styles.css
  // holds the default that renders BEFORE the appearance fetch returns, and
  // forever if the admin is unreachable. If it names a different pair from
  // DEFAULTS.typeface, every page paints one pair and visibly reflows to the
  // other on every single load — on all 28 pages, for every visitor.
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const root = css.slice(0, css.indexOf('}'));
  const decl = (name) => (root.match(new RegExp('--' + name + ':([^;]+);')) || [, ''])[1];
  const want = typefaceOf(DEFAULTS.typeface);
  const firstFamily = (stack) => String(stack).split(',')[0].replace(/['"]/g, '').trim();
  eq(firstFamily(decl('font-heading')), firstFamily(want.head),
    'public/styles.css --font-heading matches DEFAULTS.typeface');
  eq(firstFamily(decl('font-body')), firstFamily(want.body),
    'public/styles.css --font-body matches DEFAULTS.typeface');
  eq(firstFamily(decl('font-ui')), firstFamily(want.ui),
    'public/styles.css --font-ui matches DEFAULTS.typeface');

  // The unconverted pages still name these directly and do not follow the
  // selector; re-pointing them restyles half-converted pages one variable at
  // a time. They retire when the last page is converted.
  ok(/--serif:'Lora'/.test(root), '--serif is deliberately left on the old pair');
  ok(/--sans:'Source Sans 3'/.test(root), 'and so is --sans');

  // Both pairs have to be REQUESTED, or the selected one renders as a
  // fallback stack with nothing in the browser to show it.
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const links = index.slice(0, index.indexOf('</head>'));
  for (const fam of ['Lora', 'Source+Sans+3', 'Bricolage+Grotesque', 'Newsreader']) {
    ok(links.includes('family=' + fam), fam.replace(/\+/g, ' ') + ' is loaded on the public site');
  }
}

group('The preview draws the site, including its type');
{
  // The whole reason this file exists rather than a few settings rows: a
  // preview that can disagree with the site is worse than no preview. That
  // argument does not stop at the colors.
  const head = renderHeaderPreview({ typeface: 'redesign' }, [{ label: 'Give', style: 'button' }]);
  ok(/--hp-head:[^"]*Bricolage/.test(head), 'the header preview carries the published pair');
  const band = renderNewsletterPreview({ typeface: 'classic' });
  ok(/--hp-head:[^"]*Lora/.test(band), 'and so does the newsletter band preview');
}

group('Text size is a multiplier, and Normal changes nothing');
{
  // ⚠ THE ONE THAT MATTERS. Normal has to be exactly 1 on both curves, because
  // the stylesheet's fallback is 1 — if they disagreed, every page would resize
  // the moment the appearance fetch landed, on every load.
  const normal = textSizeOf('normal');
  eq(normal.body, 1, 'Normal leaves body copy alone');
  eq(normal.head, 1, 'and headings too');
  eq(DEFAULTS.textSize, 'normal', 'and it is the default, so the record ships changing nothing');

  // ⚠ Headings scale LESS than body copy at every step. A hero at 64px taken up
  // by the body copy's multiplier pushes the first paragraph off the screen.
  for (const t of TEXT_SIZES) {
    ok(t.head <= t.body, t.key + ': headings scale no harder than body copy');
    ok(t.body >= 1 && t.body <= 1.5, t.key + ': body multiplier is a sane number');
    ok(!!t.label && !!t.note, t.key + ' says what it is and what it does');
  }
  // It goes up, and each step is a real difference rather than a rounding.
  for (let i = 1; i < TEXT_SIZES.length; i++) {
    ok(TEXT_SIZES[i].body > TEXT_SIZES[i - 1].body + 0.02,
      TEXT_SIZES[i].key + ' is visibly larger than ' + TEXT_SIZES[i - 1].key);
  }

  // A crafted or stale value falls back rather than reaching a style attribute.
  eq(sanitizeAppearance({ textSize: 'enormous' }).textSize, 'normal', 'a crafted size is refused');
  eq(sanitizeAppearance({ textSize: '' }).textSize, 'normal', 'and so is an empty one');
  eq(textSizeOf('nope').key, 'normal', 'and the lookup falls back too');

  // What the site is actually sent: two numbers, never a key.
  const pub = publicAppearance({ textSize: 'larger' });
  eq(pub.textScale.body, textSizeOf('larger').body, 'the site is sent the body multiplier');
  eq(pub.textScale.head, textSizeOf('larger').head, 'and the heading one');
  eq(publicAppearance({}).textScale.body, 1, 'an empty record is Normal');

  // ⚠ THE STYLESHEET HAS TO AGREE. Its declared fallback is what renders before
  // the appearance fetch returns and forever if the admin is unreachable — the
  // same argument the typeface default carries, and the same failure if it is
  // wrong: every page painting one size and visibly reflowing to another.
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  ok(/--tlc-text-scale:1;/.test(css), 'styles.css declares the body scale as 1');
  ok(/--tlc-head-scale:1;/.test(css), 'and the heading scale as 1');
  // Every size on the sheet goes through one of the two, so the control is
  // whole rather than reaching the handful of rules somebody remembered.
  const sizes = css.match(/font-size:[^;}]+/g) || [];
  ok(sizes.length > 60, 'the sheet really does set a lot of sizes (' + sizes.length + ')');
  const missed = sizes.filter((d) => !/var\(--tlc-(text|head)-scale, 1\)/.test(d));
  eq(missed.length, 0, 'and every one of them scales: ' + missed.slice(0, 3).join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
