// Node test harness for how news posts land in the weekly newsletter — run
// with: node admin/newsletter-news-items.test.mjs
//
// Two things the office asked for: every post's picture shows in the email
// (the "More from Timothy" list used to drop them), and posts that are really
// one occasion at several times read as one item, while each stays its own
// entry on the calendar.
import { buildEmailHtml, groupNewsItems, newsWhenLabel } from './email.js';
import { renderListSection } from './ui.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const post = (id, title, extra = {}) => ({ id, title, summary: `About ${title}`, body: '', image_url: '', ...extra });

group('combining posts');
{
  const items = [
    post(1, 'Pastor update'),
    post(2, 'Thanksgiving Day service', { event_date: '2026-11-26', event_time: '10:00', newsletter_group: 'Thanksgiving Worship', image_url: '/images/thanks.jpg' }),
    post(3, 'Giving Tuesday'),
    post(4, 'Thanksgiving Eve service', { event_date: '2026-11-25', event_time: '19:00', newsletter_group: 'thanksgiving worship ' }),
    post(5, 'Lonely group', { newsletter_group: 'Just me' }),
  ];
  const g = groupNewsItems(items);
  eq(g.length, 4, 'two posts in one group become one item');
  eq(g[1].title, 'Thanksgiving Worship', 'the combined item is named for the group');
  eq(g[1].parts.length, 2, 'and lists both posts');
  eq(g[1].parts[0].title, 'Thanksgiving Eve service', 'in date order, Eve before Day');
  eq(g[1].parts[0].when, 'Wed, Nov 25, 7 p.m.', 'with the day and time');
  eq(g[1].parts[1].when, 'Thu, Nov 26, 10 a.m.', 'for each');
  eq(g[1].image_url, '/images/thanks.jpg', 'the first picture among them is used');
  eq(g[3].title, 'Lonely group', 'a group with one post in this issue is just that post');
  ok(!g[3].parts, 'with no date list');
  eq(newsWhenLabel({ event_date: '2026-12-02', event_time: '17:30' }), 'Wed, Dec 2, 5:30 p.m.', 'minutes are kept when not on the hour');
  eq(newsWhenLabel({ event_date: '2026-12-02' }), 'Wed, Dec 2', 'an all-day post shows just its day');
}

group('the email');
{
  const items = [
    post(1, 'Featured thing'),
    post(2, 'Second thing'),
    post(3, 'Thanksgiving Day service', { event_date: '2026-11-26', event_time: '10:00', newsletter_group: 'Thanksgiving Worship' }),
    post(4, 'Thanksgiving Eve service', { event_date: '2026-11-25', event_time: '19:00', newsletter_group: 'Thanksgiving Worship' }),
    post(5, 'Deck the Halls', { image_url: '/images/deck.jpg' }),
  ];
  const html = buildEmailHtml('This week', '<p>Hi</p>', [], '', '', '2026-11-22', items);
  const more = html.slice(html.indexOf('More from Timothy'));
  ok(more.includes('https://admin.timothystl.org/images/deck.jpg'), 'a More from Timothy post shows its picture');
  ok(more.includes('Thanksgiving Worship'), 'the combined item appears under its group name');
  ok(more.includes('Wed, Nov 25, 7 p.m.') && more.includes('Thu, Nov 26, 10 a.m.'), 'with both times listed');
  eq((more.match(/Thanksgiving Eve service/g) || []).length, 1, 'and the posts are not repeated as their own items');
}

group('the sort menu');
{
  const html = renderListSection({
    key: 't', title: 'T', columns: [{ label: 'Post' }], filters: [{ label: 'All', value: 'all' }],
    sorts: [{ label: 'Soonest first', key: '' }, { label: 'Latest date first', key: 'date', dir: 'desc' }],
    rows: [{ cells: ['a'], sortKeys: { date: '2026-12-01' } }],
  });
  ok(html.includes('class="tlc-sort"'), 'a list with sorts offers a sort menu');
  ok(html.includes('data-key="date" data-dir="desc"'), 'each choice carries its key and direction');
  ok(html.includes('data-sk-date="2026-12-01"'), 'and each row carries its sort value');
  const none = renderListSection({ key: 'u', title: 'U', columns: [{ label: 'X' }], filters: [{ label: 'All', value: 'all' }], rows: [] });
  ok(!none.includes('class="tlc-sort"'), 'a list without sorts is unchanged');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
