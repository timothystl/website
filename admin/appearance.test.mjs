// Node test harness for admin/appearance.js — run with: node admin/appearance.test.mjs
//
// This record is drawn on every page of the website, so the assertions worth
// having are the ones about what CANNOT happen: an unreadable header, a logo
// address that is not an image, a toggle read the wrong way round, or a
// publish that happens without anybody asking for one.
import {
  PALETTE, PALETTE_KEYS, BAR_KEYS, DEFAULTS, colourOf, safeLogoUrl, sanitizeAppearance,
  parseAppearance, appearanceFromForm, isDirty, changedFields, publicAppearance,
} from './appearance.js';

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

group('A bar colour cannot be one the nav text disappears against');
{
  // The nav links, the tagline and the brand name are all white and none of
  // them is editable, so a pale bar colour would be a header nobody can read —
  // on every page at once, chosen by somebody who was only trying to make it
  // warmer. This is the assertion that keeps such a colour off the bar list.
  for (const c of PALETTE.filter((x) => x.bar)) {
    ok(contrast(c.value, c.ink) >= 4.5,
      `${c.label} carries its own ink at 4.5:1 (got ${contrast(c.value, c.ink).toFixed(2)})`);
  }
  ok(!BAR_KEYS.includes('gold'),
    'gold is not offered as a bar colour — white on #C9973A is 2.6:1');
  ok(PALETTE_KEYS.includes('gold'),
    'but it stays available for the rule and the Give button, which is how the site already looks');

  // Enforced server-side, not only by which chips the form draws: a stale tab
  // is exactly how an unreadable header would otherwise get saved.
  eq(sanitizeAppearance({ bar: 'gold' }).bar, 'moss', 'a posted gold bar is refused, not honoured');
  eq(sanitizeAppearance({ nl_bg: 'gold' }).nl_bg, 'navy', 'and so is a gold newsletter band');
  eq(sanitizeAppearance({ cta: 'gold' }).cta, 'gold', 'while a gold Give button is accepted');

  ok(PALETTE.every((c) => /^#[0-9A-F]{6}$/.test(c.value)), 'every entry is a full six-digit hex');
  eq(new Set(PALETTE_KEYS).size, PALETTE.length, 'no two entries share a key');
  eq(colourOf('nope').key, 'moss', 'an unknown key falls back rather than throwing');
  eq(colourOf('nope', 'gold').key, 'gold', 'and the fallback is the caller\'s to choose');
}

group('The defaults are the site as it stands');
{
  // Somebody opening this screen for the first time should recognise it. A
  // form full of blanks reads as "the header has no settings yet".
  eq(DEFAULTS.bar, 'moss', 'the bar is the moss green that is on the site now');
  eq(DEFAULTS.rule, 'gold', 'over the gold rule');
  eq(DEFAULTS.brand_name, 'Timothy Lutheran Church', 'with the real church name');
  ok(DEFAULTS.tagline.includes('Neighborhood to the Nations'), 'and the real tagline');
  ok(DEFAULTS.nl_show, 'the newsletter band starts on, because it is on the site today');
}

group('Sanitising refuses what the browser cannot be trusted to');
{
  const bad = sanitizeAppearance({ bar: '#ff0000', rule: 'javascript', cta: null });
  eq(bad.bar, 'moss', 'a raw hex is not a palette key, so it is dropped');
  eq(bad.rule, 'gold', 'and so is anything else not in the list');

  eq(sanitizeAppearance({ logo_shape: 'circle' }).logo_shape, 'round', 'an unknown shape clamps');
  eq(sanitizeAppearance({ logo_shape: 'square' }).logo_shape, 'square', 'a known one is kept');

  eq(sanitizeAppearance({ brand_name: '  Timothy   Lutheran  ' }).brand_name, 'Timothy Lutheran',
    'whitespace is collapsed — this lands in a 64px bar');
  eq(sanitizeAppearance({ tagline: 'x'.repeat(400) }).tagline.length, 120, 'and long text is capped');

  // Emptying both halves of the brand block would leave a bar with nothing in
  // it — and the brand block is also the way back to the homepage.
  eq(sanitizeAppearance({ brand_name: '', logo_url: '' }).brand_name, DEFAULTS.brand_name,
    'a header with no name AND no logo is treated as a mistake, not honoured');
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
    'and the refusal survives a full sanitise rather than being escaped later');
}

group('Unreadable storage comes back as the current site');
{
  eq(parseAppearance('').bar, 'moss', 'an empty row is the defaults');
  eq(parseAppearance('not json{').bar, 'moss', 'so is a truncated write');
  eq(parseAppearance(null).brand_name, DEFAULTS.brand_name, 'and so is no row at all');
  eq(parseAppearance(JSON.stringify({ bar: 'teal' })).bar, 'teal', 'a good row is honoured');
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
  eq(full.bar, 'navy', 'the colour comes through');
  eq(full.nl_heading, DEFAULTS.nl_heading, 'and a field the form did not show keeps its stored default');
}

group('Draft and published are compared, never remembered');
{
  const live = sanitizeAppearance({});
  ok(!isDirty(live, live), 'an untouched draft is not dirty');
  ok(isDirty(sanitizeAppearance({ bar: 'navy' }), live), 'a changed colour is');
  ok(!isDirty({ bar: 'moss', junk: 'ignored' }, live),
    'and a field nobody defined cannot make the screen claim an unpublished change');

  const changed = changedFields(sanitizeAppearance({ bar: 'navy', tagline: 'Hello' }), live);
  ok(changed.includes('bar') && changed.includes('tagline'), 'the screen can name what differs');
  ok(!changed.includes('cta'), 'and not name what does not');
}

group('What the public site is sent');
{
  const pub = publicAppearance({ bar: 'navy', rule: 'gold', cta: 'gold' });
  eq(pub.bar, '#1E2D4A', 'colours are resolved to values here, not in the browser');
  eq(pub.ink, '#FFFFFF', 'with the ink that goes on them');
  ok(!('logo_url' in pub), 'the stored shape is not leaked as-is');

  eq(publicAppearance({ show_tagline: false }).tagline, '',
    'a hidden tagline is sent as empty rather than as a flag the site has to interpret');
  eq(publicAppearance({ nl_show: false }).newsletter, null,
    'and a hidden newsletter band is absent, not present-and-off');
  ok(publicAppearance({ nl_show: true }).newsletter.heading, 'a shown one carries its wording');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
