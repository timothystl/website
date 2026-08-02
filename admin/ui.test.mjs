// Node test harness for admin/ui.js and admin/values.js — run with:
//   node admin/ui.test.mjs
// No test framework (the repo has no build step or dev dependencies).
//
// These cover the parts of the shared pattern that are easy to get subtly
// wrong and hard to notice in a screenshot: pluralisation, the count label's
// scoping to the active filter, tone clamping, and the fact that every drawer
// toggle posts a value even when it is off.
import {
  esc, pluralise, countLabel, toneOf, statusPill, valueChip, valueSelect,
  primaryCell, renderListSection, renderDrawer, TONES, PALETTE,
} from './ui.js';
import { readFileSync } from 'node:fs';
import { tinymceField } from './helpers.js';
import { VALUES, VALUE_KEYS, valueByKey, normalizeValue } from './values.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} — missing ${JSON.stringify(needle)}`);
const lacks = (hay, needle, msg) => ok(!String(hay).includes(needle), `${msg} — should not contain ${JSON.stringify(needle)}`);
const group = (n) => console.log('\n' + n);

// ── escaping ─────────────────────────────────────────────────────────────────
group('escaping');
{
  eq(esc('<script>'), '&lt;script&gt;', 'angle brackets');
  eq(esc(`a"b'c&d`), 'a&quot;b&#39;c&amp;d', 'quotes and ampersand');
  eq(esc(null), '', 'null is empty, not the string "null"');
  eq(esc(0), '0', 'zero survives — a falsy value is still a value');
}

// ── pluralisation ────────────────────────────────────────────────────────────
group('pluralisation');
{
  eq(pluralise(1, 'card'), '1 card', 'one card');
  eq(pluralise(0, 'card'), '0 cards', 'zero is plural');
  eq(pluralise(2, 'card'), '2 cards', 'two cards');
  eq(pluralise(1, 'person', 'people'), '1 person', 'irregular singular');
  eq(pluralise(3, 'person', 'people'), '3 people', 'irregular plural');
}

// ── the count label ──────────────────────────────────────────────────────────
group('count label');
{
  // The rule from the handoff: M is scoped to what the filters allow. If the
  // filter itself only permits 5 rows, the label must not advertise 12.
  eq(countLabel(5, 5, 'notice'), '5 notices shown', 'nothing filtered out reads as a plain total');
  eq(countLabel(1, 1, 'notice'), '1 notice shown', 'and pluralises the total form');
  eq(countLabel(3, 8, 'notice'), '3 of 8 shown', 'a search inside a filter reads as N of M');
}

// ── tones ────────────────────────────────────────────────────────────────────
group('status tones');
{
  eq(Object.keys(TONES).length, 5, 'five tones and only five');
  eq(toneOf('good'), 'good', 'a real tone passes through');
  eq(toneOf('chartreuse'), 'plain', 'an unknown tone clamps to plain rather than rendering unstyled');
  has(statusPill('bad', 'Link clash'), TONES.bad.bg, 'the pill carries its tone background');
  has(statusPill('bad', 'Link clash'), 'Link clash', 'and its label');
  has(statusPill('nonsense', 'X'), TONES.plain.bg, 'an unknown tone still renders a pill');
  has(statusPill('good', '<b>hi'), '&lt;b&gt;hi', 'the label is escaped');
}

// ── the four values ──────────────────────────────────────────────────────────
group('core values');
{
  eq(VALUES.length, 4, 'four values');
  eq(VALUE_KEYS.join(','), 'acceptance,worship,education,outreach', 'stored keys are the church’s own names');
  eq(valueByKey('education').short, 'Grow', 'Grow is Christian Education');
  eq(valueByKey('outreach').short, 'Go', 'Go is Outreach');
  eq(valueByKey('nope'), null, 'an unknown key is null, not a throw — value is nullable everywhere');

  // The write path has to survive a form posting a display label.
  eq(normalizeValue('Welcome'), 'acceptance', 'a short name normalises to its key');
  eq(normalizeValue('CHRISTIAN EDUCATION'), 'education', 'a full name normalises case-insensitively');
  eq(normalizeValue('worship'), 'worship', 'a key passes through');
  eq(normalizeValue(''), null, 'blank is untagged');
  eq(normalizeValue('purple'), null, 'nonsense is untagged rather than stored');

  has(valueChip('education'), 'Grow', 'the chip shows the short name');
  has(valueChip('education'), valueByKey('education').tint, 'tinted by its own value');
  has(valueChip(null), 'No value', 'an untagged row says so plainly');
  has(valueChip('worship', { short: false }), 'Worship', 'the long name is available');

  const sel = valueSelect('value', 'outreach');
  has(sel, '<option value="outreach" selected>', 'the select preselects the stored key');
  has(sel, '— No value —', 'and offers untagged as a real choice');
}

// ── the list section ─────────────────────────────────────────────────────────
group('list section');
{
  const out = renderListSection({
    key: 'staff',
    title: 'Staff directory',
    purpose: 'One record per person.',
    action: { label: '+ Add person', href: '/staff/new' },
    search: 'Search staff',
    filters: [{ label: 'All', value: 'all' }, { label: 'Hidden', value: 'hidden' }],
    columns: [
      { label: 'Person', width: '2.2fr' },
      { label: 'Email', width: '1.8fr' },
      { label: 'Order', width: '.7fr', align: 'right' },
    ],
    rows: [
      { cells: [primaryCell('Andrew Dinger', 'Lead Pastor'), 'dinger@timothystl.org', '10'],
        href: '/staff/1', filter: 'live', search: 'andrew dinger lead pastor' },
      { cells: [primaryCell('Chau Vo', 'Pastor'), '—', '60'],
        href: '/staff/2', filter: 'hidden', search: 'chau vo',
        warn: 'No photo yet', warnCta: { label: 'Add photo', href: '/staff/2' } },
    ],
    note: 'Photo crop is set per person and reused everywhere.',
    noun: 'person', nounPlural: 'people',
  });

  has(out, 'id="sec-staff"', 'the section is addressable by key');
  has(out, 'data-noun-plural="people"', 'the irregular plural reaches the client script');
  has(out, '<h1 class="tlc-title">Staff directory</h1>', 'title');
  has(out, 'One record per person.', 'purpose line');
  has(out, '+ Add person', 'the single header action');
  has(out, 'tlc-note-mark', 'the ◆ note is present — it is the teaching surface');
  has(out, 'Andrew Dinger', 'a row renders');
  has(out, 'Lead Pastor', 'and its sub-line, so the drawer is not needed to identify it');
  has(out, 'data-filter="hidden"', 'rows carry their filter membership');
  has(out, 'tlc-warn', 'a row needing attention grows a warning row');
  has(out, 'Add photo', 'with its own action label');

  // The grid template must include one extra track for the actions cell, or
  // the last column and the Edit link fight over the same column.
  has(out, 'grid-template-columns:2.2fr 1.8fr .7fr 118px', 'columns plus an actions track');

  // Three columns of data, and the header row must match them exactly.
  const ths = out.match(/<span class="tlc-th[ "]/g) || [];
  eq(ths.length, 4, 'one header cell per column, plus the actions column');
}
{
  // A section with no rows still renders its chrome — an empty Notices screen
  // must teach the pattern, not look broken.
  const out = renderListSection({
    key: 'empty', title: 'Nothing', columns: [{ label: 'A' }], rows: [],
    empty: 'No notices on any page yet.', noun: 'notice',
  });
  has(out, 'No notices on any page yet.', 'the empty state is the section’s own words');
  has(out, 'tlc-tbody', 'and the table is still there');
}

// ── the drawer ───────────────────────────────────────────────────────────────
group('drawer');
{
  const out = renderDrawer({
    key: 'user', title: 'admin', sub: 'Users · saved changes are logged',
    action: '/users/update/1', cancelHref: '/users',
    deleteAction: '/users/delete/1',
    fields: [
      { kind: 'text', name: 'username', label: 'Username', value: 'admin', required: true },
      { kind: 'toggle', name: 'active', label: 'Account is active', value: 1 },
      { kind: 'toggle', name: 'notify', label: 'Email on login', value: 0 },
      { kind: 'value', name: 'value', label: 'Core value', value: 'outreach' },
      { kind: 'perms', name: 'perms', label: 'Access', options: [
        { value: 'news_edit', label: 'News & events', checked: true },
        { value: 'audit_view', label: 'Audit log', checked: false },
      ] },
    ],
  });

  has(out, 'role="dialog"', 'the drawer is a dialog');
  has(out, 'aria-modal="true"', 'and modal');
  has(out, 'Save changes', 'ends in Save');
  has(out, 'Delete', 'and offers Delete');
  has(out, 'Cancel', 'and Cancel');
  has(out, 'formnovalidate', 'Delete skips validation — a required field must not block a delete');

  // An unchecked toggle has to post something. Without the hidden 0 the server
  // cannot tell "switched off" from "this form never showed that field", and a
  // partial save silently clears flags it never rendered.
  const hiddenZeros = out.match(/<input type="hidden" name="(active|notify)" value="0">/g) || [];
  eq(hiddenZeros.length, 2, 'every toggle posts a 0 ahead of its checkbox');
  has(out, 'name="active" value="1" checked', 'an on toggle is checked');
  has(out, 'name="notify" value="1">', 'an off toggle is not');

  has(out, '<code class="tlc-perm-key">news_edit</code>', 'permission keys show in monospace so screen and code use one word');
  has(out, 'value="outreach" selected', 'the value select preselects');
}
{
  // Nothing in the drawer may accept a raw style value — that is the whole
  // premise of the redesign. Assert the field kinds cannot smuggle one in.
  const out = renderDrawer({
    key: 'x', title: 'X', action: '/x',
    fields: [{ kind: 'text', name: 'title', label: 'Title', value: '" onfocus="alert(1)' }],
  });
  lacks(out, 'onfocus="alert(1)"', 'a quote in a value cannot break out of the attribute');
  has(out, '&quot; onfocus=', 'it is escaped instead');
}

// ── palette ──────────────────────────────────────────────────────────────────
group('palette');
{
  // Straight from the Foundations spec. These are asserted because they had
  // already drifted once: the sidebar was a darker navy of my own invention
  // and the tone colours were approximations.
  eq(PALETTE.gold, '#C9973A', 'gold is the one accent');
  eq(PALETTE.navy, '#1D3557', 'navy');
  eq(PALETTE.sidebarNavy, '#1D3557', 'the sidebar is that same navy, not a darker one');
  eq(PALETTE.navyRaised, '#27496E', 'the active nav row is raised, not recoloured');
  eq(PALETTE.navyInk, '#1E2D4A', 'headings and primary buttons');
  eq(PALETTE.card, '#FFFDF9', 'cards are one step brighter than the background');
  eq(PALETTE.parchment, '#FAF7F1', 'and the background is the warm white');

  eq(TONES.good.bg + TONES.good.fg, '#EDF0E4' + '#3F5424', 'Good');
  eq(TONES.warn.bg + TONES.warn.fg, '#FAF0DC' + '#7A5B18', 'Waiting');
  eq(TONES.bad.bg + TONES.bad.fg, '#F7E4DE' + '#8C3A28', 'Problem');
  eq(TONES.plain.bg + TONES.plain.fg, '#EFE7D9' + '#6A6858', 'Neutral');
}

group('the Foundations spec’s small parts');
{
  // "the word is not optional" — a switch alone says only that a setting
  // exists, and which way is on is a convention nobody agreed to.
  const d = renderDrawer({
    key: 'k', title: 'T', action: '/x',
    fields: [{ kind: 'toggle', name: 'active', label: 'On the website', value: 1, on: 'Showing', off: 'Hidden' }],
  });
  has(d, 'tlc-toggle-state', 'a toggle carries a state word');
  has(d, 'data-off="Hidden"', 'and knows what to say when it is switched off');
  has(d, '>Showing<', 'reading the current state, not a fixed label');

  // Four options or fewer is chips, not a select — the whole decision at once.
  const c = renderDrawer({
    key: 'k', title: 'T', action: '/x',
    fields: [{ kind: 'chips', name: 'kind', label: 'Kind', value: 'gift',
      options: [{ value: 'gift', label: 'Gift' }, { value: 'payment', label: 'Payment' }] }],
  });
  has(c, 'tlc-chips', 'a chip choice renders');
  has(c, 'role="radiogroup"', 'as a real radio group, so it is operable by keyboard');
  has(c, 'value="gift" checked', 'with the stored value selected');
  lacks(c, '<select', 'and no select in sight');
}

group('the rich-text field cannot be escaped from');
{
  // ⚠ AC-3. The content is interpolated into an inline <script>, and the HTML
  // parser ends a script block at the first `</script` REGARDLESS of JavaScript
  // string context. Seven near-identical builders each escaped backslash,
  // backtick and $ — and none of them escaped this. Somebody with
  // content-edit rights could have saved a post containing it and run script
  // in the session of any admin who later opened that screen.
  const out = tinymceField({ id: 'x', name: 'x', value: '</script><img src=x onerror=alert(1)>' });
  lacks(out, '</script><img', 'a closing script tag in saved content does not close the block');
  has(out, '<\\/script>', 'it is split so the parser never sees it');
  // And it must still be the same string once JavaScript joins it up.
  eq(JSON.parse('"' + '<\\/script>'.replace(/\\\//g, '\\/').replace(/\\\//g, '/') + '"'), '</script>',
    'the escape is a JS escape, not a mangling — the content round-trips');

  // The other three, which were already handled, must stay handled.
  const t = tinymceField({ id: 'y', name: 'y', value: 'a`b${c}d\\e' });
  has(t, '\\`', 'a backtick is escaped');
  has(t, '\\$', 'and a dollar');

  // Every field gets the same toolbar — the design's "painted on all of them,
  // not just the first".
  has(out, 'bold italic underline', 'the toolbar is on it');
  has(t, 'bold italic underline', 'and on the next one too');

  // The id and name are attribute-escaped, since both reach markup.
  const q = tinymceField({ id: 'a"b', name: 'c"d', value: '' });
  lacks(q, 'id="a"b"', 'a quote in an id cannot break out of the attribute');
}


// ── one palette ──────────────────────────────────────────────────────────────
// The shell used to open with the pre-redesign :root and append the new tokens
// after it, so anything not explicitly restyled came out in the old
// teal-and-orange scheme and the wrong typefaces. These assertions are what
// stop that creeping back one hardcoded hex at a time.
group('one palette');
{
  // Read as text rather than importing, because what matters is what ships in
  // the stylesheet — a value can be correct in a constant and wrong in the CSS.
  const shell = readFileSync(new URL('./helpers.js', import.meta.url), 'utf8');
  // The palette itself lives in ADMIN_UI_CSS now, so anything about tokens has
  // to read both. The radii and font-stack assertions below stay on the legacy
  // shell on purpose: ui.js carries the redesign's own values — a 3px elbow, a
  // 5px chip — which Foundations specifies and Task 1's audit never covered.
  const uiSrc = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  const allCss = shell + uiSrc;

  for (const [hex, was] of [['#0A3C5C', 'the old steel'], ['#D4922A', 'the old amber'],
                            ['#3D3530', 'the old charcoal'], ['#7A6E60', 'the old grey']]) {
    ok(!allCss.includes(hex), `the shell carries no ${hex} — ${was}`);
  }

  // Georgia is legal only as the serif fallback, never as the face itself.
  // Line comments are stripped first — a comment mentioning the fallback is
  // prose, not a font declaration, and failing on it would teach whoever hits
  // this to weaken the assertion rather than fix the CSS.
  const css = allCss.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const georgia = css.split('Georgia').length - 1;
  const asFallback = css.split("'Lora',Georgia").length - 1;
  eq(georgia, asFallback, 'Georgia appears only behind Lora, never on its own');

  ok(!shell.includes('-apple-system'), 'the system font stack is gone — the admin is Source Sans 3');
  ok(allCss.includes("--steel:#1E2D4A"), 'the legacy names point at the Foundations values');
  ok(allCss.includes("--amber:#C9973A"), 'including the amber');
  ok(allCss.includes("--border:#E7DFD1"), 'and one border colour');

  // Radii: 8 (inputs, chips, buttons), 9 (nav rows, search), 11–12 (cards),
  // 999 (pills, toggles). Anything else is somebody eyeballing it.
  //
  // ⚠ This read only helpers.js, so the file it did NOT read — ui.js, which is
  // the design system every redesigned screen is built from — drifted to 5, 6,
  // 7, 10, 13 and 14 without a word. A rule enforced on one of two files is
  // not enforced. Both are checked now.
  //
  // 3px survives on marks under 12px square: a legend swatch and the nav
  // elbow, which Foundations itself specifies as `radius 0 0 0 3px`. They are
  // marks, not components, and rounding them to 8 would make them circles.
  const LEGAL = [3, 8, 9, 11, 12, 999];
  for (const [name, src] of [['the shell', shell], ['the design system', uiSrc]]) {
    const radii = [...src.matchAll(/border-radius:(\d+)px/g)].map((m) => Number(m[1]));
    const illegal = [...new Set(radii.filter((r) => !LEGAL.includes(r)))].sort((a, b) => a - b);
    eq(illegal.join(','), '', `every radius in ${name} is one of the legal values`);
  }

  // The focus ring is blue. It was amber, which is the colour this admin uses
  // for "needs attention" — a focused field is not a problem.
  ok(shell.includes('rgba(46,126,166,.15)'), 'the focus ring is blue, not amber');

  // Exactly one :root in the admin shell — the legacy names are folded into
  // ADMIN_UI_CSS's block rather than declared in a second one. The gym module
  // has its own, and that one is deliberate: the renter portal is a standalone
  // document with no shell CSS, so its tokens are the only ones it has.
  eq(allCss.split(':root{').length - 1, 1, 'the shell declares exactly one :root');
}


// ── the first screen anybody sees ────────────────────────────────────────────
// Login, forgot password, reset and first-run setup were never redesigned.
// They inherit Task 1's primitives rather than carrying their own values, so
// what this asserts is that the shared card is the spec's card — and that none
// of the four has grown a private override since.
group('login and the account screens');
{
  const shell = readFileSync(new URL('./helpers.js', import.meta.url), 'utf8');

  ok(shell.includes('.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#1E2D4A;}'),
    'the backdrop is the Foundations navy');
  ok(shell.includes('max-width:380px'), 'the card is 380px');
  ok(shell.includes('padding:36px 34px'), 'with the spec’s padding');
  ok(shell.includes('box-shadow:0 18px 44px rgba(11,22,44,.28)'), 'and its shadow');
  ok(shell.includes('.login-title{font:500 25px/1.2 var(--serif);color:#1E2D4A;'), 'the title is Lora 25 navy');

  // The eyebrow is the same on all four screens. It was the old amber.
  // Matched on the account screens' own markup — the header nav's brand uses
  // the same type treatment, and counting both would make this assertion pass
  // for the wrong reason.
  const eyebrows = shell.split("letter-spacing:.16em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;").length - 1;
  eq(eyebrows, 4, 'all four account screens carry the gold eyebrow at .16em');
}


// ── the shell ────────────────────────────────────────────────────────────────
// Spec: screens/00b-header-nav.html, revised. The sidebar STAYS — the build's
// mistake was hiding it behind a hamburger, not having it. What this asserts is
// that every way of hiding it is gone, and that the context bar above the
// content reports rather than navigates.
group('the shell');
{
  const shell = readFileSync(new URL('./helpers.js', import.meta.url), 'utf8');

  // The sidebar, as Foundations specifies it.
  ok(shell.includes('.sidebar{position:fixed;top:0;left:0;width:228px'), 'the sidebar is 228px and on screen');
  ok(shell.includes('body{padding-left:228px;}'), 'and the content sits beside it, not under it');
  ok(!shell.includes('.wrap{max-width:860px'), 'the narrow content column is gone');

  // Every way of hiding it, gone — the fix list's own check, verbatim: no
  // util bar, no hamburger, no backdrop, no off-canvas transform, anywhere.
  // ⚠ The hamburger that was left behind had NO handler wired to it, so below
  // 900px the admin had no navigation at all. Restoring the button would have
  // been fixing the symptom of a pattern the design had already rejected.
  for (const dead of ['util-bar', 'sidebar-toggle', 'sidebar-backdrop', 'translateX(-100%)']) {
    ok(!shell.includes(dead), `the slide-over is gone: no ${dead}`);
  }
  ok(shell.includes('@media (max-width:900px)'), 'below 900px it restacks — the only responsive rule');
  const narrow = shell.slice(shell.indexOf('@media (max-width:900px)'));
  ok(narrow.slice(0, narrow.indexOf('\n}')).includes('.sidebar{position:static'),
    'and restacking means static above the content, never hidden');

  // The context bar. Same navy as the sidebar, so the two read as one shell.
  ok(shell.includes('.tlc-ctx{display:flex;align-items:center;gap:14px;height:46px;padding:0 26px;background:#1E2D4A'),
    'the context bar is 46px of the same navy');
  ok(shell.includes('.tlc-ctx-group{font:500 12.5px/1 var(--tlc-sans);color:#8598B0'), 'the group crumb is quiet');
  ok(shell.includes('.tlc-ctx-section{font:600 13.5px/1 var(--tlc-sans);color:#FFFFFF'), 'the section crumb leads');
  ok(shell.includes('.tlc-ctx-sep{font:400 12.5px/1 var(--tlc-sans);color:#4E6180'), 'with the separator between them');

  // ⚠ It reports; it does not navigate. The spec's own "get this wrong and it
  // shows" leads with putting tabs or chips in here.
  ok(!shell.includes('tlc-ctx-tab'), 'there are no tabs in the context bar');
  ok(!shell.includes('tlc-nav-chip'), 'and no group chips anywhere');

  // Sign out lives in the sidebar foot, in gold, and is not duplicated.
  ok(shell.includes('.sidebar-signout{color:var(--tlc-gold) !important;}'), 'Sign out is gold in the sidebar foot');
  ok(!shell.includes('util-bar-signout'), 'and the white util bar that held it is gone');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
