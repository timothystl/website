// Node test harness for admin/intake.js — run with: node admin/intake.test.mjs
import assert from 'node:assert/strict';
import { TYPES, TYPE_KEYS, UNCLASSIFIED, ROOMS } from './intake.js';
import { CALENDAR_PALETTE } from './calendar.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

group('the eleven types are still real, still-used ideas after Office follow-up was retired');
{
  eq(TYPE_KEYS.length, 11, 'eleven types');
  eq(UNCLASSIFIED, null, 'unclassified is null, not one of the eleven types');
  ok(!TYPE_KEYS.includes(null), 'and it is never in the type list itself');
  for (const t of TYPE_KEYS) {
    ok(TYPES[t].label, `${t} has a label`);
    ok(TYPES[t].color, `${t} has a color`);
    ok(TYPES[t].note, `${t} has an explanatory note`);
  }
}

group('every type color is a real CALENDAR_PALETTE entry, at 4.5:1 against cream — verified, not assumed');
{
  // ⚠ THIS IS THE EXACT SHAPE OF BUG admin/calendar.js's own CALENDAR_PALETTE
  // comment warns about: "a comment claimed a test already checked this and
  // it didn't." Computed independently here rather than trusted, the same
  // way admin/calendar.test.mjs verifies the calendar's own palette.
  const chan = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  const rgb = (hex) => [1, 3, 5].map((i) => chan(hex, i));
  const luminance = (hex) => rgb(hex).map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + [0.2126, 0.7152, 0.0722][i] * c, 0);
  const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const CREAM = '#F7F4EE'; // a filled type pill's own white-ish text color, wherever one is drawn

  const paletteByKey = new Map(CALENDAR_PALETTE.map((p) => [p.key, p]));
  const usedPaletteKeys = new Set();
  for (const t of TYPE_KEYS) {
    const type = TYPES[t];
    ok(type.palette, `${t} names a CALENDAR_PALETTE key`);
    const entry = paletteByKey.get(type.palette);
    ok(entry, `${type.palette} (${t}'s palette key) is a real CALENDAR_PALETTE entry`);
    eq(type.color, entry.color, `${t}'s color is exactly its palette entry's color, not a hand-typed near-miss`);
    ok(contrast(type.color, CREAM) >= 4.5, `${t} (${type.color}) clears 4.5:1 against cream pill text — got ${contrast(type.color, CREAM).toFixed(2)}:1`);
    usedPaletteKeys.add(type.palette);
  }
  // ⚠ NO TWO TYPES SHARE A COLOR. Eleven types, eleven of the twelve
  // CALENDAR_PALETTE keys — 'gray' is the one left over, deliberately (it
  // means "uncategorized" on the calendar, and no type here is that).
  eq(usedPaletteKeys.size, TYPE_KEYS.length, 'every type has its own color — none doubled up');
  ok(!usedPaletteKeys.has('gray'), "'gray' is reserved for the calendar's own uncategorized fallback, not spent on a real type");
}

group('ROOMS is complete');
{
  ok(ROOMS.includes('Sanctuary') && ROOMS.includes('Gym'), 'the two rooms a rental most often needs exist');
  eq(new Set(ROOMS).size, ROOMS.length, 'no duplicate rooms');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
