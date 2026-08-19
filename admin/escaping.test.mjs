// The escaping sweep (FX-13 / FX-14 / FX-15 / FX-16) — run with:
//   node admin/escaping.test.mjs
//
// Two halves, because the two files have to be checked two different ways.
//
//  · admin/email.js is a pure function, so it is CALLED with hostile values and
//    the output inspected. That is the real check.
//  · public/index.html is browser code inside an HTML file. Its helpers are
//    lifted out and exercised for real (the same trick admin/links.test.mjs
//    uses on LINKS_JS); its CALL SITES are pinned as a source rule, the way
//    admin/link-style.test.mjs pins the no-arrows rule — a grep is a weak test
//    of behavior and a strong test of "nobody quietly added a bare one back".
import fs from 'node:fs';
import { buildEmailHtml } from './email.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// ── FX-13: admin/email.js ────────────────────────────────────────────────────
group('the newsletter email escapes every field the office types as text');
{
  // One hostile string in every plain-text slot at once. `"` is the one that
  // matters in an attribute, `<` the one that matters in a text node.
  const X = '</div>"<script>alert(1)</script>';
  const html = buildEmailHtml(
    /* subject        */ 'Subject ' + X,
    /* pastorNote     */ '<p>Real <strong>markup</strong>, on purpose.</p>',
    /* events         */ [{ event_date: '2026-08-20', event_name: 'Event ' + X, event_time: '7pm ' + X, event_desc: 'Desc ' + X }],
    /* wolContent     */ '', /* lasmContent */ '',
    /* publishedAt    */ '2026-08-19',
    /* newsItems      */ [
      { title: 'Main ' + X, summary: 'S1', image_url: 'https://ex.example/a.png"onerror=alert(1)' },
      { title: 'Second ' + X, summary: 'S2' },
      { title: 'More ' + X, summary: 'S3' },
    ],
    /* secondaryNote  */ '',
    /* newsletterId   */ 1,
    /* format         */ 'weekly',
    /* ctaUrl         */ 'https://ex.example/x"onmouseover=alert(1)',
    /* ctaLabel       */ 'Label ' + X,
    /* tertiaryNote   */ '<p>Also real markup.</p>',
    /* tertiaryCtaLabel */ 'TLabel ' + X,
    /* tertiaryCtaUrl */ 'javascript:alert(1)',
    /* bibleClasses   */ [{ date: '2026-08-21', topic: 'Topic ' + X, leader: 'Leader ' + X, location: 'Loc ' + X }],
    /* extraNotes     */ [{ title: 'Note ' + X, body: '<p>Body markup.</p>' }],
  );

  ok(!/<script>alert\(1\)<\/script>/.test(html), 'no injected script tag survives anywhere in the email');
  ok(html.includes('&lt;script&gt;'), 'they are escaped instead');
  // Count them: eleven separate slots carried the payload.
  ok((html.match(/&lt;script&gt;/g) || []).length >= 10,
    'every slot that carried it escaped it, not just the first');

  // ⚠ The two CTA hrefs are the ones that matter beyond mail clients.
  ok(!/href="javascript:/i.test(html), 'a javascript: CTA address becomes no address at all');
  ok(!/href="[^"]*"onmouseover/i.test(html), 'and a quote in a CTA address cannot open a new attribute');

  // ⚠ AND THE HALF THAT MUST NOT BE ESCAPED. The notes are markup on purpose;
  // escaping them would print the tags as words in six hundred inboxes.
  ok(html.includes('<strong>markup</strong>'), "the pastor's note keeps its markup");
  ok(html.includes('<p>Also real markup.</p>'), 'and so does the tertiary note');
  ok(html.includes('<p>Body markup.</p>'), 'and an extra note body');
  ok(!html.includes('&lt;strong&gt;'), 'none of them is escaped');
}

// ── FX-15 + the client's safeHref ───────────────────────────────────────────
const SPA = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
// Lifted by brace-matching rather than by a regex: these are real functions in
// a 4,000-line HTML file, and a regex that has to know where a function ends is
// a second parser nobody wants to debug.
const lift = (name) => {
  const start = SPA.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('could not find ' + name + ' in public/index.html');
  let depth = 0, i = SPA.indexOf('{', start);
  for (let j = i; j < SPA.length; j++) {
    if (SPA[j] === '{') depth++;
    else if (SPA[j] === '}' && --depth === 0) return SPA.slice(start, j + 1);
  }
  throw new Error('unbalanced braces lifting ' + name);
};
const { escText, safeHref } = (new Function(lift('escText') + '\n' + lift('safeHref')
  + '\nreturn { escText, safeHref };'))();

group("the public site's own escText is safe in an attribute, not just a text node");
{
  eq(escText('a<b>c'), 'a&lt;b&gt;c', 'angle brackets');
  eq(escText('a&c'), 'a&amp;c', 'ampersand');
  // ⚠ THE POINT OF FX-15. Without these two a value dropped into href="…"
  // closes the attribute and everything after it becomes markup.
  eq(escText('a"c'), 'a&quot;c', 'double quote');
  eq(escText("a'c"), 'a&#39;c', 'single quote');
  eq(escText(null), '', 'null is empty, not the word null');
  eq(escText(0), '0', 'and zero is still zero');
}

group('and a CTA address the office typed cannot be a javascript: URL');
{
  eq(safeHref('https://ex.example/x'), 'https://ex.example/x', 'https passes');
  eq(safeHref('http://ex.example/x'), 'http://ex.example/x', 'http passes');
  eq(safeHref('mailto:a@b.com'), 'mailto:a@b.com', 'mailto passes');
  eq(safeHref('tel:3145551234'), 'tel:3145551234', 'tel passes');
  eq(safeHref('/give'), '/give', 'a site-relative path passes');
  eq(safeHref('javascript:alert(1)'), '', 'javascript: does not');
  eq(safeHref('  JavaScript:alert(1)'), '', 'nor does it with padding and odd case');
  eq(safeHref('data:text/html,<script>'), '', 'nor a data: URL');
  eq(safeHref(''), '', 'nor an empty one');
  eq(safeHref(null), '', 'nor a missing one');
}

// ── FX-14: the call sites, as a source rule ─────────────────────────────────
group('no newsletter field is interpolated bare into the public renderer');
{
  // Each of these was going in raw before FX-14. The rule is not "escText
  // appears somewhere near" — it is that the bare form does not appear at all.
  const bare = [
    ["+ n.subject +", 'the newsletter subject'],
    ["+(e.event_name||'')+", "an event's name"],
    ["+ (e.event_name||'') +", "an event's name (spaced)"],
    ["+(c.topic||'')+", 'a Bible class topic'],
    ["+n.tertiary_cta_url+", 'a CTA address, into an href'],
    ["+n.tertiary_cta_label+", "a CTA's label"],
    ["+[c.leader,c.location].filter(Boolean).join(' · ')+", 'a class leader and location'],
  ];
  for (const [needle, what] of bare) {
    ok(!SPA.includes(needle), `${what} is not interpolated bare`);
  }
  // And the positive half: the escaped forms really are there, so this group
  // cannot pass just because somebody deleted the code.
  ok(SPA.includes('escText(n.subject)'), 'the subject goes through escText');
  ok(SPA.includes('escText(safeHref(n.tertiary_cta_url))'),
    'and the CTA address through safeHref then escText, in that order');
  // Every URL, not just the one that started this — the rule written into
  // admin/email.js says safeUrl-then-esc, and it has to hold on both sides.
  ok(SPA.includes('escText(safeHref(n.ministry_content))'),
    "the ministry update's image address goes the same way");
}

// ── FX-16: no hand-rolled partial escape left in the gym ────────────────────
group('the gym has no hand-rolled partial escapes left');
{
  const GYM = fs.readFileSync(new URL('./gym.js', import.meta.url), 'utf8');
  // ⚠ The full five-character escape is fine and one copy of it survives on
  // purpose — it is browser code inside a template literal, where the
  // escapeHtml this module imports does not exist. What must not come back is
  // a PARTIAL one: `.replace(/</g,'&lt;')` on its own leaves quotes alive in
  // an attribute, and `.replace(/"/g,'&quot;')` on its own leaves tags alive
  // in a text node.
  // ⚠ A CHAIN, NOT A LINE. The one surviving full escape is written across two
  // lines, so testing line by line calls each half a partial. Runs of adjacent
  // .replace() calls are collapsed first, and a run is only a fault if it is
  // missing one of the five entities.
  const ENT = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'];
  const CHAIN = /(?:\.replace\(\/[^/]+\/g,\s*'&[a-z#0-9]+;'\)\s*)+/g;
  const partials = [];
  for (const m of GYM.matchAll(CHAIN)) {
    const run = m[0];
    if (ENT.every((e) => run.includes(e))) continue;         // a complete escape
    partials.push([GYM.slice(0, m.index).split('\n').length, run.replace(/\s+/g, ' ').trim()]);
  }
  for (const [n, run] of partials) console.error('    ' + n + ': ' + run.slice(0, 100));
  eq(partials.length, 0, 'no partial escape survives in admin/gym.js');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
