// Node test harness for the permission rename in admin/auth.js — run with:
//   node admin/auth.test.mjs
//
// This migration rewrites what every existing account can reach, and two of
// the keys swap meaning, so the ordering hazard is the whole point of the
// file: `pages_edit` exists on both sides of the rename with two different
// meanings. Get it wrong and an account that could edit notice banners
// silently gains the site editor.
import {
  PERMISSIONS, ALL_PERMISSIONS, PERMISSION_RENAMES, PERMISSION_PRESETS,
  migratePermissionKeys,
} from './auth.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const same = (a, b, msg) => eq(JSON.stringify(a), JSON.stringify(b), msg);
const group = (n) => console.log('\n' + n);

// ── the key set ──────────────────────────────────────────────────────────────
group('permission keys');
{
  eq(ALL_PERMISSIONS.length, 19,
    'nineteen keys: the spec’s fourteen, plus notices and own-pages, plus the market coordinator, the events index, and event intake');

  // The fourteen names the design handoff calls "the real permission names".
  const spec = [
    'newsletter_edit', 'newsletter_approve', 'news_edit', 'ministries_edit',
    'sermons_edit', 'pages_edit', 'staff_edit', 'links_edit', 'settings_manage',
    'gym_manage', 'giving_manage', 'payroll_manage', 'users_manage', 'audit_view',
  ];
  for (const k of spec) ok(k in PERMISSIONS, `spec name ${k} exists`);

  // The two the handoff's list forgot. Dropping either would ungate the
  // Notices section and delete the ministry-leader role the site editor
  // enforces server-side, so they are deliberately kept.
  ok('notices_edit' in PERMISSIONS, 'notices_edit exists — Notices must stay gated');
  ok('pages_edit_own' in PERMISSIONS, 'pages_edit_own exists — the ministry-leader role survives');

  // Added after the handoff, with the Christmas Market vendor list. Its own key
  // rather than a share of giving_manage or news_edit for the same reason
  // payroll and giving each got one: the market coordinator is a volunteer who
  // runs one event a year, and the list holds seventy people's home addresses.
  ok('market_manage' in PERMISSIONS, 'market_manage exists — the vendor list is gated on its own');

  // Added with the generalized events section — the /events index and
  // /events/new, distinct from any one event's own dynamic coordinator key.
  ok('events_manage' in PERMISSIONS, 'events_manage exists — the events index is gated on its own');

  // The old names must be gone, or a stale route gating on one would silently
  // pass for nobody and no one would notice.
  ok(!('site_pages' in PERMISSIONS), 'site_pages is retired');
  ok(!('site_pages_own' in PERMISSIONS), 'site_pages_own is retired');
}

// ── the migration ────────────────────────────────────────────────────────────
group('migrating stored permissions');
{
  // The hazard, stated directly: an account that had only the old pages_edit
  // (notice banners) must NOT come out holding the new pages_edit (the whole
  // site editor).
  same(migratePermissionKeys(['pages_edit']), ['notices_edit'],
    'an old notices editor becomes a notices editor, not a site editor');

  same(migratePermissionKeys(['site_pages']), ['pages_edit'],
    'an old site editor keeps the site editor under its new name');

  same(migratePermissionKeys(['site_pages_own']), ['pages_edit_own'],
    'a ministry leader keeps their own-pages role');

  // Both at once, in both orders — this is where an in-place rewrite breaks.
  same(migratePermissionKeys(['pages_edit', 'site_pages']), ['notices_edit', 'pages_edit'],
    'holding both old keys maps to both new ones');
  same(migratePermissionKeys(['site_pages', 'pages_edit']), ['pages_edit', 'notices_edit'],
    'and the result does not depend on the order they were stored in');

  // Nobody gains anything they did not already have.
  const before = ['news_edit', 'pages_edit'];
  const after = migratePermissionKeys(before);
  eq(after.includes('pages_edit'), false, 'a notices-only account does not gain the site editor');
  eq(after.length, before.length, 'and gains nothing else either');
}
{
  group('migration edge cases');
  same(migratePermissionKeys([]), [], 'an account with no permissions stays empty');
  same(migratePermissionKeys(null), [], 'a null column does not throw');
  same(migratePermissionKeys(undefined), [], 'nor does a missing one');
  same(migratePermissionKeys(['news_edit']), ['news_edit'], 'an untouched key passes through');
  same(migratePermissionKeys(['made_up_key']), [], 'a key nothing checks is dropped');

  // ⚠ The migration is deliberately NOT idempotent, and this test exists to
  // pin that down rather than to wish it away. `pages_edit` means the notice
  // banners going in and the site editor coming out, so a second pass demotes
  // every site editor to notices-only. There is no per-row signal that could
  // tell the two apart.
  //
  // This is why the caller gates on a one-time marker instead of on
  // SCHEMA_VERSION. If this assertion ever starts failing because someone made
  // the function idempotent, check that the marker is still in place before
  // celebrating.
  const once = migratePermissionKeys(['pages_edit', 'site_pages', 'news_edit']);
  same(once, ['notices_edit', 'pages_edit', 'news_edit'], 'one pass maps both old keys');
  same(migratePermissionKeys(once), ['notices_edit', 'news_edit'],
    'a second pass would demote the site editor — hence the one-time marker');

  // A row that somehow holds both the old and new spelling of one thing.
  same(migratePermissionKeys(['site_pages', 'pages_edit', 'notices_edit']),
    ['pages_edit', 'notices_edit'], 'no duplicates when old and new names collide');

  // Full access must survive intact — this is the admin account.
  const full = migratePermissionKeys(['newsletter_edit', 'newsletter_approve', 'news_edit',
    'ministries_edit', 'sermons_edit', 'pages_edit', 'site_pages', 'site_pages_own',
    'staff_edit', 'settings_manage', 'gym_manage', 'users_manage', 'audit_view',
    'links_edit', 'payroll_manage', 'giving_manage']);
  // ⚠ Measured against the sixteen keys that EXISTED when the rename ran, not
  // against ALL_PERMISSIONS. The property is "the migration loses nothing" —
  // it cannot conjure a permission added long afterwards, and asserting that
  // it does would fail every future time somebody adds one, for a reason that
  // has nothing to do with the migration.
  const AT_RENAME = ALL_PERMISSIONS.filter((k) => k !== 'market_manage' && k !== 'events_manage' && k !== 'intake_manage');
  eq(AT_RENAME.length, 16, 'sixteen keys existed at the rename');
  eq(full.length, 16, 'an account holding every old key holds every renamed key');
  for (const k of AT_RENAME) ok(full.includes(k), `full access retains ${k}`);
}

// ── presets ──────────────────────────────────────────────────────────────────
group('presets');
{
  eq(Object.keys(PERMISSION_PRESETS).length, 5, 'five presets');
  same(PERMISSION_PRESETS['Full access'], ALL_PERMISSIONS, 'Full access is literally everything');

  // A preset that names a key which no longer exists would tick a box the
  // drawer never renders, silently granting nothing.
  for (const [name, keys] of Object.entries(PERMISSION_PRESETS)) {
    for (const k of keys) ok(k in PERMISSIONS, `preset "${name}" names a real key: ${k}`);
  }

  // The ministry leader gets their own pages, and emphatically not everyone's.
  ok(PERMISSION_PRESETS['Ministry leader'].includes('pages_edit_own'), 'ministry leader has own-pages');
  ok(!PERMISSION_PRESETS['Ministry leader'].includes('pages_edit'), 'and not the whole site');
  ok(!PERMISSION_PRESETS['Bookkeeper'].includes('users_manage'), 'the bookkeeper cannot make users');
  ok(!PERMISSION_PRESETS['Office staff'].includes('payroll_manage'), 'office staff do not get payroll');
  // One event, once a year, and nothing else — deliberately not folded into
  // Office staff. A preset that grants more than the job is not a shortcut.
  same(PERMISSION_PRESETS['Market coordinator'], ['market_manage'],
    'the market coordinator gets the vendor list and nothing else');
}

// ── the rename table itself ──────────────────────────────────────────────────
group('rename table');
{
  for (const [from, to] of Object.entries(PERMISSION_RENAMES)) {
    ok(to in PERMISSIONS, `${from} renames to a key that exists: ${to}`);
    if (from !== 'pages_edit') ok(!(from in PERMISSIONS), `${from} is not also a live key`);
  }
  // pages_edit is the one name that is both an old key and a new key. That is
  // intended, and it is exactly why the migration cannot rewrite in place.
  ok('pages_edit' in PERMISSIONS && 'pages_edit' in PERMISSION_RENAMES,
    'pages_edit is deliberately on both sides of the rename');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
