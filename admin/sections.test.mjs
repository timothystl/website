// Node test harness for admin/sections.js — run with: node admin/sections.test.mjs
//
// This file exists because of a specific failure. The first pass at the
// overhaul wrote every screen's title, purpose line, filter set, column layout
// and ◆ note by hand from the README's prose, without checking them against the
// design. Nearly all of them drifted — wrong filters, invented columns, notes
// nobody had approved — and it was not caught until somebody looked at the
// admin and said "this isn't the design".
//
// So: the config is data lifted from the prototype, and these assertions pin
// down the values that were actually wrong. If a screen needs different words,
// change them in sections.js — not in a route, and not here without looking at
// the prototype first.
import { SECTIONS, section, columnsOf, filtersOf } from './sections.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

group('every section the admin renders has a config');
{
  // The list sections. Dashboard, menu, gym, giving and payroll are bespoke and
  // carry only a title and purpose.
  const listSections = ['pages', 'partners', 'newsletter', 'news', 'ministries', 'sermons',
    'ed', 'notices', 'links', 'staff', 'users', 'subscribers', 'redirects', 'media', 'audit'];
  for (const key of listSections) {
    const s = section(key);
    ok(!!s.title, `${key} has a title`);
    ok(!!s.purpose, `${key} has a purpose line`);
    ok(Array.isArray(s.columns) && s.columns.length >= 3, `${key} has 3+ columns`);
    ok(s.columns.length <= 4, `${key} has no more than 4 columns — the rule the pattern enforces`);
    ok(Array.isArray(s.filters), `${key} has filters`);
  }
  ok(!!section('dashboard').title, 'the dashboard has a title');
  ok(!!section('giving').purpose, 'giving has a purpose line');
  ok(!!section('payroll').purpose, 'payroll has one too, for when it is built');
}

group('the values that had drifted');
{
  // Each of these was wrong in the first pass. They are asserted individually
  // rather than as a blob so a failure names the screen.
  eq(section('ministries').title, 'Ministry pages', 'Ministries is titled "Ministry pages"');
  eq(section('partners').title, 'Partner ministries', 'Partners is titled "Partner ministries"');
  eq(section('ed').title, 'Christian Education', 'Christian Ed is titled in full');
  eq(section('links').title, 'Taps & links', 'the links screen is Taps & links');

  eq(section('news').filters.join(','), 'All,Live,Scheduled,Expired', 'News has four filters and no Pinned');
  eq(section('ed').filters.join(','), 'All,Running,Paused', 'Christian Ed filters on Running, not "On the website"');
  eq(section('notices').filters.join(','), 'All,Showing,Hidden', 'Notices filters on Showing/Hidden');
  eq(section('staff').filters.join(','), 'All,On the website,Hidden', 'Staff filters on being on the website');
  eq(section('sermons').filters.join(','), 'All,Active series,Missing media', 'Sermons filters on missing media');
  eq(section('subscribers').filters.join(','), 'All,Website,Added by office,Bounced', 'Subscribers filters by source');
  eq(section('media').filters.join(','), 'All,Photos,Files,Needs alt text,Over 1 MB,Unused', 'Media has six filters');

  eq(section('subscribers').action, 'Import CSV', 'Subscribers imports a CSV rather than adding one by one');
  eq(section('media').action, 'Upload', 'Media has an Upload action');
  eq(section('redirects').action, '+ New redirect', 'Redirects can add one');
  eq(section('users').action, '+ New user', 'Users invites with "+ New user"');
  eq(section('links').action, '+ New card', 'Taps adds a card');

  // Columns that were missing or invented.
  eq(columnsOf('ministries').map((c) => c.label).join(','), 'Ministry,Short link,In menu,Status',
    'Ministries shows a Short link column and no Value column');
  eq(columnsOf('news').map((c) => c.label).join(','), 'Post,Published,Expires,Status',
    'News has no Value column — the chip sits beside the title');
  eq(columnsOf('ed').map((c) => c.label).join(','), 'Class,Schedule,Leader,Status',
    'Christian Ed has no Value column either');
  eq(columnsOf('newsletter').map((c) => c.label).join(','), 'Issue,Sends,Date,Status',
    'the Newsletter list has a Sends column');
  eq(columnsOf('audit').map((c) => c.label).join(','), 'Change,Who,When,',
    'the Audit log folds the action into the Change cell and leaves the last column for Roll back');
  eq(columnsOf('links').map((c) => c.label).join(','), 'Card,Goes to,Order,Status', 'Taps columns');
}

group('filter values are derivable and stable');
{
  // The client filters on these strings, so they have to be predictable from
  // the label rather than hand-maintained in parallel.
  eq(filtersOf('news').map((f) => f.value).join(','), 'all,live,scheduled,expired', 'simple labels');
  eq(filtersOf('ministries').map((f) => f.value).join(','), 'all,with-posts,draft-edits,not-in-menu',
    'multi-word labels hyphenate');
  eq(filtersOf('media').map((f) => f.value).join(','), 'all,photos,files,needs-alt-text,over-1-mb,unused',
    'and so do ones with numbers');
  eq(filtersOf('partners')[0].value, 'all', 'All is always "all"');
}

group('section() is strict');
{
  let threw = false;
  try { section('nope'); } catch (_) { threw = true; }
  ok(threw, 'an unknown key throws rather than rendering a screen with no title');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
