import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseSpaced, parseDateLine, extractDays, dayRange, findExtras, bodyAfterTitle, parsePdfXml, bookMetrics, pageBlocks } from '../scripts/lib.mjs';

// A page as the day finder sees it: its lines of text.
const page = (n, text) => ({ n, rows: text.split('\n').map((l) => collapseSpaced(l) ?? l.trim()).filter(Boolean) });

test('letter-spaced eyebrows collapse to sentence case', () => {
  assert.equal(collapseSpaced('W E E K   O N E'), 'Week one');
  assert.equal(collapseSpaced('W E E K   T W O   ·   L I F T E D'), 'Week two · Lifted');
  assert.equal(collapseSpaced('   C H R I S T M A S   D A Y  '), 'Christmas day');
  assert.equal(collapseSpaced('A word here'), null);
  assert.equal(collapseSpaced('Read: Isaiah 9'), null);
});

test('date lines parse; sentences that mention a date do not', () => {
  assert.deepEqual(parseDateLine('Wednesday, December 9'), { weekday: 3, month: 12, day: 9 });
  assert.deepEqual(parseDateLine('  Sunday, November 29 '), { weekday: 0, month: 11, day: 29 });
  assert.deepEqual(parseDateLine('Friday, Dec. 25'), { weekday: 5, month: 12, day: 25 });
  assert.equal(parseDateLine('Christmas Eve: Thursday, December 24, 4 and 10 pm.'), null);
});

test('day range covers Nov 29 through Dec 25', () => {
  const r = dayRange('11-29', '12-25');
  assert.equal(r.length, 27);
  assert.deepEqual(r[0], { month: 11, day: 29 });
  assert.deepEqual(r.at(-1), { month: 12, day: 25 });
});

const XML = `<pdf2xml>
<fontspec id="0" size="7" family="A" color="#000"/>
<fontspec id="1" size="9" family="A" color="#000"/>
<fontspec id="2" size="18" family="A" color="#000"/>
<fontspec id="3" size="11" family="A" color="#000"/>
<fontspec id="4" size="10" family="A" color="#000"/>
<page number="23" position="absolute" top="0" left="0" height="612" width="504">
<text top="582" left="248" width="8" height="9" font="0">23</text>
<text top="37" left="54" width="94" height="9" font="0">W E E K   T W O   ·   L I F T E D</text>
<text top="49" left="54" width="95" height="11" font="1">Wednesday, December 9</text>
<text top="60" left="54" width="71" height="21" font="2">The leap</text>
<text top="135" left="54" width="393" height="12" font="3">Everyone needs one person they can call when the news comes. The friend who doesn&#8217;t </text>
<text top="150" left="54" width="300" height="12" font="3">need the backstory.</text>
<text top="169" left="54" width="390" height="12" font="3">Mary goes &#8220;with haste&#8221; into the hill country to find hers. Elizabeth: too old to be </text>
<text top="183" left="54" width="120" height="12" font="3">six months along.</text>
<text top="200" left="54" width="390" height="12" font="3">A third paragraph of prose that runs the whole measure of the column and then some more</text>
<text top="214" left="54" width="24" height="11" font="3">Read </text>
<text top="214" left="78" width="56" height="11" font="3">Luke 1:39&#8211;45</text>
<text top="428" left="54" width="139" height="10" font="4">O God who began your kingdom</text>
<text top="440" left="54" width="100" height="10" font="4">in a kitchen in the hills,</text>
<text top="452" left="54" width="177" height="10" font="4">someone who will believe what you have</text>
<text top="428" left="270" width="59" height="10" font="4">spoken to me</text>
<text top="440" left="270" width="152" height="10" font="4">when I can hardly believe it.</text>
<text top="456" left="270" width="128" height="10" font="4">Amen.</text>
</page>
</pdf2xml>`;

test('reads lines in order, joins pieces, drops the folio, collapses eyebrows', () => {
  const p = parsePdfXml(XML)[23];
  assert.equal(p.width, 504);
  const texts = p.lines.map((l) => l.text);
  assert.equal(texts[0], 'Week two · Lifted');
  assert.ok(!texts.includes('23'), 'folio dropped');
  assert.ok(texts.includes('Read Luke 1:39–45'), 'pieces on one line are joined');
  assert.ok(texts.includes('Everyone needs one person they can call when the news comes. The friend who doesn’t'));
});

test('blocks: headings, eyebrow, paragraphs by spacing, verse kept, columns joined mid-sentence', () => {
  const pages = parsePdfXml(XML);
  const metrics = bookMetrics(pages);
  assert.equal(metrics.body, 11);
  const blocks = pageBlocks(pages[23], metrics);
  assert.deepEqual(blocks, [
    { k: 'e', t: 'Week two · Lifted' },
    { k: 'p', t: 'Wednesday, December 9' },
    { k: 'h', t: 'The leap' },
    { k: 'p', t: 'Everyone needs one person they can call when the news comes. The friend who doesn’t need the backstory.' },
    { k: 'p', t: 'Mary goes “with haste” into the hill country to find hers. Elizabeth: too old to be six months along.' },
    { k: 'p', t: 'A third paragraph of prose that runs the whole measure of the column and then some more Read Luke 1:39–45' },
    { k: 'p', t: 'O God who began your kingdom\nin a kitchen in the hills,\nsomeone who will believe what you have\nspoken to me\nwhen I can hardly believe it.' },
    { k: 'p', t: 'Amen.' },
  ]);
  const { eyebrow, body } = bodyAfterTitle(blocks, 'Wednesday, December 9', 'The leap');
  assert.deepEqual(eyebrow, [{ k: 'e', t: 'Week two · Lifted' }]);
  assert.match(body[0].t, /^Everyone needs/);
});

function bookletPages(skip = []) {
  const pages = [page(1, 'Held'), page(2, 'How to use this devotional'),
    page(3, 'Midweek services\nWednesday, December 2\nWednesday, December 9')];
  let n = 4;
  for (const { month, day } of dayRange()) {
    const d = new Date(Date.UTC(2026, month - 1, day));
    const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const slug = `${month === 11 ? 'nov' : 'dec'}-${day}`;
    pages.push(page(n, skip.includes(slug) ? 'W E E K   O N E\n\nSomething else' : `W E E K   O N E\n\n${label}\n\nTitle ${slug}\nRead: Psalm 1`));
    pages.push(page(n + 1, 'Prayer\n\nAmen.'));
    n += 2;
  }
  pages.push(page(n, 'Prayer list'), page(n + 1, 'About the art'), page(n + 2, 'Back'));
  return pages;
}

test('finds all 27 days, ignores the schedule page, infers the year', () => {
  const { days, missing, problems, year } = extractDays(bookletPages());
  assert.equal(year, 2026);
  assert.deepEqual(missing, []);
  assert.deepEqual(problems, []);
  assert.equal(days.length, 27);
  assert.deepEqual(days[0], { slug: 'nov-29', date: '2026-11-29', label: 'Sunday, November 29', title: 'Title nov-29', page: 4 });
  assert.equal(days.find((d) => d.slug === 'dec-9').page, 24);
  assert.equal(days.find((d) => d.slug === 'dec-2').page, 10);
  assert.equal(days.at(-1).page, 56);
});

test('reports missing days by name, and overrides fill them', () => {
  const pages = bookletPages(['dec-9', 'dec-14']);
  const r = extractDays(pages, { year: 2026 });
  assert.equal(r.missing.length, 2);
  assert.match(r.missing[0], /Wednesday, December 9 \(only seen on page 3/);
  assert.equal(r.missing[1], 'Monday, December 14');
  const fixed = extractDays(pages, { year: 2026, overrides: { days: { 'dec-9': { page: 24, title: 'Pinned' }, 'dec-14': { page: 34 } } } });
  assert.deepEqual(fixed.missing, []);
  assert.equal(fixed.days.find((d) => d.slug === 'dec-9').title, 'Pinned');
});

test('a date printed as a devotion heading on two pages is an error', () => {
  const pages = bookletPages();
  pages[40] = page(41, 'Wednesday, December 9\n\nAgain');
  const r = extractDays(pages, { year: 2026 });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /December 9 appears as a date line on more than one page \(24, 41\)/);
});

test('wrong weekday for the year is flagged', () => {
  const r = extractDays(bookletPages(), { year: 2027 });
  assert.ok(r.problems.length > 0);
  assert.match(r.problems[0], /in 2027/);
});

test('contents extras found by text; body strips date and title', () => {
  const pages = bookletPages();
  assert.deepEqual(findExtras(pages, [{ label: 'About the art' }, { label: 'Nope' }]), [{ label: 'About the art', page: 59 }]);
  assert.deepEqual(findExtras(pages, [{ label: 'About the art' }], new Set([59])), []);
});

test('artwork regions: ornaments ignored, pieces merged, full-page art flagged', async () => {
  const { parseImageBoxes, artRegions } = await import('../scripts/lib.mjs');
  const xml = `<page number="5" position="absolute" top="0" left="0" height="612" width="396">
<image top="34" left="43" width="310" height="150" src="a.jpg"/>
<image top="184" left="43" width="310" height="108" src="b.jpg"/>
<image top="560" left="180" width="30" height="20" src="ornament.png"/>
</page>
<page number="6" position="absolute" top="0" left="0" height="612" width="396">
<image top="-9" left="-9" width="414" height="630" src="bleed.jpg"/>
</page>
<page number="7" position="absolute" top="0" left="0" height="612" width="396"></page>`;
  const boxes = parseImageBoxes(xml);
  assert.deepEqual(artRegions(boxes[5]), { regions: [{ left: 43, top: 34, width: 310, height: 258 }], fullPage: false });
  assert.deepEqual(artRegions(boxes[6]), { regions: [], fullPage: true });
  assert.deepEqual(artRegions(boxes[7]), { regions: [], fullPage: false });
  assert.deepEqual(artRegions(undefined), { regions: [], fullPage: false });
});
