import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseSpaced, cleanPageText, parseDateLine, extractDays, dayRange, findExtras, bodyAfterTitle } from '../scripts/lib.mjs';

const page = (n, text) => ({ n, ...cleanPageText(text, { measure: 60 }) });

test('letter-spaced eyebrows collapse to sentence case', () => {
  assert.equal(collapseSpaced('W E E K   O N E'), 'Week one');
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

test('prose reflows; short lineated text keeps its breaks; folio dropped', () => {
  const t = cleanPageText([
    'Prayer', '',
    'Hold us today,', 'and keep us. Amen.', '',
    'This is a long line of prose that runs right to the measure of', 'the page and keeps on going.', '',
    '                 12',
  ].join('\n'), { measure: 62 });
  assert.deepEqual(t.paragraphs, [
    'Prayer',
    'Hold us today,\nand keep us. Amen.',
    'This is a long line of prose that runs right to the measure of the page and keeps on going.',
  ]);
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
  const { eyebrow, body } = bodyAfterTitle(pages[3].paragraphs, 'Sunday, November 29', 'Title nov-29');
  assert.deepEqual(eyebrow, ['Week one']);
  assert.deepEqual(body, ['Read: Psalm 1']);
});
