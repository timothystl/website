// Node test harness for admin/sermons-feed.js — run with:
//   node admin/sermons-feed.test.mjs
//
// This is the parsing half of "show this week's service without anybody
// touching it" — and parsing somebody else's markup is the part that breaks
// silently, so the shapes are pinned here rather than discovered on a Sunday.
import {
  isChannelId, normalizeChannelInput, channelIdFrom, channelPageUrl, feedUrl,
  parseFeed, pickLatest, embedUrl,
} from './sermons-feed.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const ID = 'UCabcdefghijklmnopqrstuv';

group('what the office types can be any of the things they might paste');
{
  eq(normalizeChannelInput('@TimothySTL').kind, 'handle', 'a handle is a handle');
  eq(normalizeChannelInput('@TimothySTL').value, '@TimothySTL', 'kept as typed');
  eq(normalizeChannelInput('timothystl').value, '@timothystl',
    'a bare word is a handle — it is what somebody says out loud');
  eq(normalizeChannelInput('https://www.youtube.com/@TimothySTL').value, '@TimothySTL',
    'and so is a full address');

  eq(normalizeChannelInput(ID).kind, 'id', 'a channel ID is recognized as one');
  eq(normalizeChannelInput(`https://www.youtube.com/channel/${ID}`).value, ID,
    'including inside a channel URL');

  eq(normalizeChannelInput('').kind, 'none', 'an empty setting resolves to nothing');
  eq(normalizeChannelInput('   ').kind, 'none', 'and so does whitespace');
  ok(!isChannelId('UCtooshort'), 'a malformed ID is not accepted as one');
  ok(!isChannelId('XCabcdefghijklmnopqrstuv'), 'nor is one with the wrong prefix');
}

group('the channel ID is found in every shape YouTube has used');
{
  // All four really appear in channel-page markup. Trying only the one that
  // works today is how this breaks on a Sunday morning with nobody watching.
  eq(channelIdFrom(`{"externalId":"${ID}","x":1}`), ID, 'externalId');
  eq(channelIdFrom(`"channelId":"${ID}"`), ID, 'channelId');
  eq(channelIdFrom(`<link href="...channel_id=${ID}">`), ID, 'the RSS link');
  eq(channelIdFrom(`<a href="/channel/${ID}">`), ID, 'a channel path');
  eq(channelIdFrom('<html>nothing here</html>'), '', 'and markup with none returns empty');
  eq(channelIdFrom(null), '', 'as does nothing at all');
}

group('addresses are built the way YouTube expects');
{
  eq(channelPageUrl('@TimothySTL'), 'https://www.youtube.com/@TimothySTL', 'the channel page');
  eq(channelPageUrl('TimothySTL'), 'https://www.youtube.com/@TimothySTL', 'with the @ added if missing');
  eq(feedUrl(ID), `https://www.youtube.com/feeds/videos.xml?channel_id=${ID}`, 'and the feed');
  eq(embedUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'and the embed');
}

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>Timothy Lutheran Church</title>
 <entry>
  <yt:videoId>aaaaaaaaaaa</yt:videoId>
  <title>Sunday Worship &amp; Holy Communion — August 3</title>
  <published>2026-08-03T15:10:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>bbbbbbbbbbb</yt:videoId>
  <title>Community Concert: Bach at Timothy</title>
  <published>2026-08-06T01:00:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>ccccccccccc</yt:videoId>
  <title>Sunday Worship — July 27</title>
  <published>2026-07-27T15:05:00+00:00</published>
 </entry>
</feed>`;

group('the feed parses, and keeps the order it arrived in');
{
  const entries = parseFeed(FEED);
  eq(entries.length, 3, 'every entry is read');
  eq(entries[0].videoId, 'aaaaaaaaaaa', 'newest first, as YouTube sends them');
  eq(entries[0].title, 'Sunday Worship & Holy Communion — August 3',
    'and the title comes back with its entities decoded');

  // ⚠ Deliberately NOT re-sorted on `published`. That is the upload time, and a
  // stream scheduled days ahead carries the date it was scheduled — sorting on
  // it would reliably put the wrong service first. The concert below is proof:
  // it has the latest `published` of the three.
  const byPublished = [...entries].sort((a, b) => b.published.localeCompare(a.published));
  eq(byPublished[0].videoId, 'bbbbbbbbbbb',
    'sorting by published date would have chosen the concert — which is why it is not done');

  eq(parseFeed('').length, 0, 'an empty feed is no entries, not an error');
  eq(parseFeed('<html>404</html>').length, 0, 'and neither is a page that is not a feed');
  eq(parseFeed('<entry><title>No id</title></entry>').length, 0,
    'an entry with no video id is skipped rather than half-built');
}

group('which video to show, and why a filter exists at all');
{
  const entries = parseFeed(FEED);
  eq(pickLatest(entries).videoId, 'aaaaaaaaaaa',
    'with no filter it is simply the newest upload — right for a channel that only carries the service');

  // The moment somebody posts a concert or a funeral, "newest" is the wrong
  // video and the sermons page would present it as this week's service. The
  // filter is how the office fixes that without anybody touching code.
  const withConcertFirst = [entries[1], entries[0], entries[2]];
  eq(pickLatest(withConcertFirst).videoId, 'bbbbbbbbbbb', 'newest wins by default, concert included');
  eq(pickLatest(withConcertFirst, 'sunday worship').videoId, 'aaaaaaaaaaa',
    'a filter picks the newest one that matches instead');
  eq(pickLatest(withConcertFirst, 'SUNDAY WORSHIP').videoId, 'aaaaaaaaaaa', 'case does not matter');

  eq(pickLatest(withConcertFirst, 'evening prayer'), null,
    'a filter matching nothing returns nothing — better than showing the wrong service');
  eq(pickLatest([]), null, 'and an empty feed returns nothing rather than throwing');
  eq(pickLatest(null), null, 'as does no feed at all');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
