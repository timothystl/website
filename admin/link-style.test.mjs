// No decorative arrows at the end of a link. Run: node admin/link-style.test.mjs
//
// This file exists because the arrows keep coming back. They were swept once in
// v3.11.0 (90 of them), the ↗ went in Task 12c, and they still returned — I put
// "Learn more →" into the card grid's defaults and "Open in Google Maps →" into
// the map card on the same night the rest were removed. A style rule nobody
// checks is a style rule that decays, so this checks it.
//
// THE RULE
//
//   An arrow at the END of a link's text is decoration. The link text already
//   says where it goes; the glyph adds nothing and it is one more thing to keep
//   consistent across two hundred call sites.
//
//   An arrow BETWEEN two words is a separator, and that is a sentence:
//   "admin → Notices → Home", "hold → confirmed", "'Draft edits' → 'draft-edits'".
//   Those stay.
//
// The difference is mechanical, which is why it can be tested: decoration is
// immediately followed by a closing tag or the end of a string.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const FILES = [
  'public/index.html', 'public/manual.html', 'public/how-to-give.html',
  'admin/blocks.js', 'admin/db.js', 'admin/gym.js', 'admin/email.js',
  'admin/helpers.js', 'admin/ui.js', 'admin/sections.js', 'admin/market.js',
  'admin/site-pages.js', 'admin/page-seeds.js',
  'admin/ministry-editor.html',
  'tlc-admin-worker.js', 'tlc-links-worker.js', 'give-landing.js', 'site-worker.js',
];

// ⚠ admin/scheduler.html is NOT in that list. It is dead code behind the
// session gate, and its one arrow is a next-month BUTTON whose entire label is
// the glyph — that is an icon, not decoration trailing a link.

// ⚠ The quote case allows NO space. "'Learn more →'" ends a label, but
// "'Draft edits' → 'draft-edits'" is a separator whose next character is also a
// quote — with a space in between. Allowing whitespace there flags the
// separator, and the fix somebody reaches for is deleting this rule.
const DECORATIVE = /(?:→|↗|&rarr;|&#8594;)(?=\s*<\/|["'`])/g;

let pass = 0, fail = 0;
const hits = [];

for (const rel of FILES) {
  const file = path.join(root, rel);
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  let m;
  DECORATIVE.lastIndex = 0;
  while ((m = DECORATIVE.exec(src)) !== null) {
    const before = src.slice(Math.max(0, m.index - 48), m.index).replace(/\s+/g, ' ');
    hits.push(`${rel}: …${before}${m[0]}`);
  }
}

if (hits.length === 0) {
  pass++;
} else {
  fail++;
  console.error('  ✗ decorative arrows at the end of link text:');
  for (const h of hits.slice(0, 25)) console.error('      ' + h);
  if (hits.length > 25) console.error(`      … and ${hits.length - 25} more`);
  console.error('');
  console.error('    The link text says where it goes. Remove the glyph rather than');
  console.error('    adding an exception here — an arrow between two words is a');
  console.error('    separator and already passes.');
}

// A separator must still be allowed, or the next person "fixes" this by
// deleting the rule instead of the arrow.
const sep = 'Money &amp; Building → Gym rentals → Hoops';
DECORATIVE.lastIndex = 0;
if (!DECORATIVE.test(sep)) pass++;
else { fail++; console.error('  ✗ the rule wrongly flags a separator between two words'); }

// And decoration must actually be caught, so a green run means something.
for (const bad of ['<a href="/x">Learn more →</a>', "{ title: 'Give now →' }", '`Open in Maps →`']) {
  DECORATIVE.lastIndex = 0;
  if (DECORATIVE.test(bad)) pass++;
  else { fail++; console.error(`  ✗ the rule misses real decoration: ${bad}`); }
}

console.log(`link-style.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
