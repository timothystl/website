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
  has(out, 'grid-template-columns:2.2fr 1.8fr .7fr auto', 'columns plus an actions track');

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
  eq(PALETTE.gold, '#C9973A', 'gold is the one accent');
  eq(PALETTE.navy, '#1D3557', 'navy');
  eq(PALETTE.sidebarNavy, '#12243D', 'the sidebar is its own darker navy');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
