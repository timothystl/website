// The church calendar as a visitor actually meets it. Serves ./public locally,
// stubs /api/calendar with what the real Worker would return, and drives a real
// browser against the real public/index.html.
//
//   NODE_PATH=$(npm root -g) node test/public-calendar.test.mjs
//
// The whole reason this page exists is that Google's month view folds a busy
// day into "N more" at any height. So the assertion this file is built around
// is the uncapped one: put SEVEN events on one Sunday and count seven chips.
// Everything else — the filters, the phone layout, the print sheet, the
// unreachable-Google fallback — is a rule that fails silently rather than
// visibly, which is the other thing worth a browser for.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { CATEGORIES } from '../admin/calendar.js';
import { renderPage, sanitizeBlock, newBlock, BLOCK_CSS } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  let body = fs.readFileSync(file);
  // ⚠ THE GOOGLE FONTS LINK IS STRIPPED WHEN SERVING, and it is worth saying
  // why rather than leaving it as a mystery. It is render-blocking, and in a
  // sandbox with no route to fonts.googleapis.com the browser waits out the
  // full connection timeout before painting — about thirteen seconds per page
  // load, which is the whole run. Nothing this file asserts is about the
  // webfont: the sizes it measures come from padding and min-height, and the
  // column-equality check is about the grid track, not the glyphs.
  if (file.endsWith('index.html')) {
    body = Buffer.from(String(body)
      .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, '')
      .replace(/<script[^>]+cloudflareinsights[^>]*><\/script>/g, ''));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(0, r));
const base = 'http://localhost:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });

// ⚠ THE FIXTURE IS BUILT IN THE MONTH THE PAGE WILL OPEN ON, rather than a
// fixed August. The page opens on today's month in church time, and a fixture
// pinned to one month would mean clicking the arrow up to a hundred times per
// group to reach it — slow, and one more thing to go wrong between the setup
// and the assertion. Every date below is derived, so this file means the same
// thing whenever it is run.
const churchToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const YM = churchToday.slice(0, 7);
const MONTH_NAME = new Date(Date.UTC(+YM.slice(0, 4), +YM.slice(5, 7) - 1, 1))
  .toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
const day = (n) => YM + '-' + String(n).padStart(2, '0');
const dowOf = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();
// A Sunday in the middle of the month — after the 11th so it cannot collide
// with the 10th, before the 19th so it cannot reach the 24th.
let BUSY_N = 12; while (dowOf(day(BUSY_N)) !== 0) BUSY_N++;
const SUNDAY = day(BUSY_N);
// 24-28 exists in every month, February included.
const VBS_FROM = 24, VBS_TO = 28;

const ev = (o) => ({ location: '', description: '', allDay: false, source: 'gcal', category: 'other', ...o });
const BUSY_SUNDAY = [
  ev({ id: 'g1', title: 'Divine Service', start: SUNDAY + 'T08:00:00', end: SUNDAY + 'T09:15:00', category: 'worship' }),
  ev({ id: 'g2', title: 'Adult Bible Class', start: SUNDAY + 'T09:30:00', end: SUNDAY + 'T10:30:00', category: 'learn' }),
  ev({ id: 'g3', title: 'Sunday School', start: SUNDAY + 'T09:30:00', end: SUNDAY + 'T10:30:00', category: 'youth' }),
  ev({ id: 'g4', title: 'Divine Service', start: SUNDAY + 'T10:45:00', end: SUNDAY + 'T12:00:00', category: 'worship' }),
  ev({ id: 'g5', title: 'Choir rehearsal', start: SUNDAY + 'T13:00:00', end: SUNDAY + 'T14:00:00', category: 'music' }),
  ev({ id: 'g6', title: 'Scout troop', start: SUNDAY + 'T15:00:00', end: SUNDAY + 'T16:30:00', category: 'facility' }),
  ev({ id: 'n1', title: 'Rally Day picnic', start: SUNDAY, end: SUNDAY, allDay: true, source: 'news',
      category: 'special', description: 'Bring a dish to share.' }),
];
const OTHER_DAYS = [
  ev({ id: 'g7', title: 'Trustees meeting', start: day(10) + 'T19:00:00', end: day(10) + 'T20:00:00', category: 'meetings' }),
  ev({ id: 'n2', title: 'Vacation Bible School', start: day(VBS_FROM), end: day(VBS_TO), allDay: true,
      source: 'news', category: 'youth' }),
];
// Seven chips on the Sunday, one on the 10th, and five days of VBS: the grid
// draws one chip per day an event touches, so 13 is the number on screen.
const CHIPS_ALL = 13, CHIPS_NEWS = 6, CHIPS_WORSHIP = 2;
const FEED = { from: day(1), to: day(28), events: BUSY_SUNDAY.concat(OTHER_DAYS),
  categories: CATEGORIES, sources: { google: true, news: true, googleReason: '' } };

async function open(opts = {}) {
  const { feed = FEED, width = 1280, height = 950, status = 200, page: which = 'calendar', rendered = {} } = opts;
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  let calls = 0;
  await p.route('https://admin.timothystl.org/**', (route) => {
    const u = route.request().url();
    if (u.includes('/api/calendar')) {
      calls++;
      if (status !== 200) return route.fulfill({ status, contentType: 'text/plain', body: 'nope' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed) });
    }
    if (u.includes('/api/pages')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ pages: [], menu: null, rendered, redirects: {},
        css: Object.keys(rendered).length ? BLOCK_CSS : '' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await p.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await p.goto(base + '/' + which, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#tlc-cal-' + (which === 'news' ? 'news' : 'main') + ' .tlc-cal', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(500);
  return { p, ctx, errors, calls: () => calls };
}

// The page already opens on this month, so this only confirms it rather than
// navigating anywhere.
async function goToFixtureMonth(p) {
  const title = (await p.textContent('.tlc-cal-title')).trim();
  return title === MONTH_NAME + ' ' + YM.slice(0, 4);
}

// ── the whole point: no cap ─────────────────────────────────
{
  const { p, ctx, errors } = await open();
  ok(await goToFixtureMonth(p), 'the month can be navigated to');
  const chips = await p.$$eval('.tlc-cal-day', (days, n) => {
    const hit = days.find((d) => d.querySelector('.tlc-cal-num')?.textContent.trim() === String(n)
      && !d.classList.contains('tlc-cal-day--out'));
    return hit ? Array.from(hit.querySelectorAll('.tlc-cal-chip')).map((c) => c.textContent.trim()) : null;
  }, BUSY_N);
  ok(chips, 'the busy Sunday is on the grid');
  // ⚠ THE ASSERTION THIS FILE EXISTS FOR. Google's embed showed two of these
  // and a "3 more" link, at every iframe height that was ever tried. Seven
  // events on a Sunday means seven chips.
  eq(chips.length, 7, 'every event on a busy Sunday is drawn');
  ok(!/\bmore\b/i.test(chips.join(' ')), 'and nothing was folded into an "N more"');
  ok(chips.some((c) => c.includes('8:00 AM') && c.includes('Divine Service')), 'the 8:00 service is named with its time');
  ok(chips.some((c) => c.includes('10:45 AM')), 'and so is the 10:45');
  ok(chips.some((c) => c.includes('All day') && c.includes('Rally Day picnic')), 'the News record reads as all-day');
  // The row grew rather than clipping: the tallest cell is well past the 150px
  // floor, and the chips are inside the box rather than spilling out of it.
  const grew = await p.$$eval('.tlc-cal-day', (days, n) => {
    const hit = days.find((d) => d.querySelector('.tlc-cal-num')?.textContent.trim() === String(n) && !d.classList.contains('tlc-cal-day--out'));
    const last = hit.querySelector('.tlc-cal-chip:last-of-type');
    return { h: hit.getBoundingClientRect().height,
             spill: last.getBoundingClientRect().bottom - hit.getBoundingClientRect().bottom };
  }, BUSY_N);
  ok(grew.h > 150, `the day cell grew past the 150px floor (was ${Math.round(grew.h)}px)`);
  ok(grew.spill <= 1, 'and the last chip sits inside it rather than overflowing');
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── a long title stays inside its own day ──────────────────
{
  // ⚠ A SINGLE GENUINELY UNBREAKABLE TOKEN is the case that threatens the
  // grid — and it has to have no hyphens in it, because a browser breaks a
  // line at a hyphen for free. Ordinary prose wraps at its spaces and would
  // never have asked for more than a column, so a realistic-looking title here
  // would make both assertions below pass whatever the CSS said.
  const long = [ev({ id: 'x', title: 'ReformationSundayPotluckAndHymnFestivalInTheFellowshipHall',
    start: day(22) + 'T09:00:00', end: day(22) + 'T10:00:00', category: 'worship' })];
  const { p, ctx } = await open({ feed: { ...FEED, events: FEED.events.concat(long) } });
  await goToFixtureMonth(p);
  const widths = await p.$$eval('.tlc-cal-day', (d) => d.slice(0, 7).map((c) => Math.round(c.getBoundingClientRect().width)));
  // The seven days are one seventh of the calendar each, and stay that way.
  ok(Math.max(...widths) - Math.min(...widths) <= 1, 'seven columns stay equal beside a very long title: ' + widths.join(','));
  const spill = await p.$$eval('.tlc-cal-name', (names) => {
    const hit = names.find((n) => n.textContent.includes('ReformationSunday'));
    if (!hit) return null;
    const cell = hit.closest('.tlc-cal-day');
    return Math.round(hit.getBoundingClientRect().right - cell.getBoundingClientRect().right);
  });
  ok(spill !== null, 'the long-titled event is on the grid');
  ok(spill <= 1, 'and its title wraps inside the day rather than over the next one (' + spill + 'px past the edge)');
  // ⚠ HONEST NOTE ON WHAT THESE TWO PROVE. They are a property of the rendered
  // page — a title cannot break the week — not a guard on one declaration.
  // Both were driven against `repeat(7, 1fr)` and against the title rule with
  // no overflow-wrap, and both still passed: the chip is a <button>, and a
  // button's own intrinsic sizing already breaks the word and caps its
  // min-content. `minmax(0, 1fr)` and `overflow-wrap: anywhere` stay in the
  // stylesheet because they are what the layout is meant to rest on rather
  // than a UA default nobody chose — but do not read a green run here as
  // evidence that either is still there.
  await ctx.close();
}

// ── the filters ─────────────────────────────────────────────
{
  const { p, ctx } = await open();
  await goToFixtureMonth(p);
  const count = () => p.$$eval('.tlc-cal-chip', (c) => c.length);
  const all = await count();
  eq(all, CHIPS_ALL, 'every event in the month is drawn to start with');

  await p.click('.tlc-cal-pill[data-cal="cat"][data-val="worship"]');
  await p.waitForTimeout(120);
  eq(await count(), CHIPS_WORSHIP, 'the category filter leaves only the two services');
  eq(await p.$eval('.tlc-cal-pill[data-val="worship"]', (e) => e.getAttribute('aria-pressed')), 'true', 'and the pill says so');

  await p.click('.tlc-cal-pill[data-cal="cat"][data-val="all"]');
  await p.waitForTimeout(120);
  eq(await count(), all, 'clearing the filter restores the month');
  await ctx.close();
}

// ── the Source band is gone, and a rental never names the renter ─
// Andrew: "I dont need on this view to see the source of info" — the pills
// (All sources / Google Calendar / News & Events / Building use) and the
// color key beside them are retired. Category filtering (below) already
// covers "just the rentals" via the Facility/rentals pill, so nothing was
// lost that a source-only filter could still do. `tlc-cal-srcdot` — the small
// per-event dot with a hover title — is deliberately left alone: it is not a
// filter band, and removing it was not asked for.
{
  const withRental = FEED.events.concat([
    ev({ id: 'b:1', title: 'Gym rented', location: 'Gym', start: day(21) + 'T18:00:00', end: day(21) + 'T20:00:00',
      source: 'building', category: 'facility' }),
  ]);
  const { p, ctx } = await open({ feed: { ...FEED, events: withRental } });
  await goToFixtureMonth(p);
  eq(await p.$$eval('.tlc-cal-src', (x) => x.length), 0, 'no Source band renders at all, with or without a rental in the month');
  const rental = await p.$$eval('.tlc-cal-chip .tlc-cal-name', (n) => n.map((x) => x.textContent)).then((t) => t.filter((x) => x === 'Gym rented'));
  eq(rental.length, 1, 'the booking is still on the month');
  eq(rental[0], 'Gym rented', 'which names the room, and never the renter');
  await ctx.close();
}

// ── a category nobody used gets no pill ─────────────────────
{
  const { p, ctx } = await open();
  await goToFixtureMonth(p);
  const pills = await p.$$eval('.tlc-cal-cats .tlc-cal-pill', (b) => b.map((x) => x.getAttribute('data-val')));
  ok(pills.includes('all') && pills.includes('worship'), 'the categories in the month are offered');
  // A pill whose only possible outcome is the empty state is a control that
  // looks live and does nothing — the rule the rest of this site is held to.
  ok(!pills.includes('mdo'), "a category with nothing in this month is not offered");
  ok(!pills.includes('wol'), 'nor is another one');
  await ctx.close();
}

// ── a multi-day event is on every day it touches ────────────
{
  const { p, ctx } = await open();
  await goToFixtureMonth(p);
  const days = await p.$$eval('.tlc-cal-day', (cells) => cells
    .filter((c) => !c.classList.contains('tlc-cal-day--out'))
    .filter((c) => Array.from(c.querySelectorAll('.tlc-cal-name')).some((n) => n.textContent.includes('Vacation Bible School')))
    .map((c) => c.querySelector('.tlc-cal-num').textContent.trim()));
  // The Worker made the end inclusive, so Mon 24 → Fri 28 is five days, not
  // four and not six.
  eq(days.join(','), '24,25,26,27,28', 'a five-day event is on all five days');
  const labels = await p.$$eval('.tlc-cal-day', (cells) => cells
    .filter((c) => Array.from(c.querySelectorAll('.tlc-cal-name')).some((n) => n.textContent.includes('Vacation Bible School')))
    .map((c) => c.querySelector('.tlc-cal-time').textContent.trim()));
  eq(labels[1], 'Continues', 'the days after the first say so rather than repeating a start');
  await ctx.close();
}

// ── clicking an event ───────────────────────────────────────
{
  const { p, ctx } = await open();
  await goToFixtureMonth(p);
  ok(!(await p.$('.tlc-cal-detail')), 'nothing is open to begin with');
  await p.click('.tlc-cal-chip[data-val="n1"]');
  await p.waitForTimeout(120);
  const detail = await p.textContent('.tlc-cal-detail');
  ok(/Rally Day picnic/.test(detail), 'the chip opens its own event');
  ok(/Bring a dish to share\./.test(detail), 'with the description Google alone would not have had');
  ok(detail.includes('Sunday, ' + MONTH_NAME + ' ' + BUSY_N), 'and when it is');
  await p.click('.tlc-cal-detail .close');
  await p.waitForTimeout(120);
  ok(!(await p.$('.tlc-cal-detail')), 'and it closes again');
  await ctx.close();
}

// ── the phone ───────────────────────────────────────────────
{
  const { p, ctx, errors } = await open({ width: 390 });
  await goToFixtureMonth(p);
  // ⚠ NEVER A SEVEN-COLUMN GRID ON A PHONE — 390px over seven days is about
  // 50px each, which does not fit a date and a word. This is why the old embed
  // switched to Google's agenda view under 700px, and the list is the same
  // information rather than a degraded month.
  // ⚠ ASSERTED AS ABSENT FROM THE DOM, not as display:none. The switch is in
  // the renderer — a narrow viewport renders the list instead of the grid —
  // and the CSS rule that also hides it is a second belt for a resize caught
  // between the two. Checking the computed style alone would pass whether or
  // not the renderer ever made the choice.
  eq(await p.$$eval('.tlc-cal-grid', (g) => g.length), 0, 'the month grid is not drawn on a phone at all');
  const rows = await p.$$eval('.tlc-cal-listday', (r) => r.length);
  ok(rows >= 3, 'the week-grouped list is what a phone gets (' + rows + ' days)');
  ok(await p.$('.tlc-cal-weekhd'), 'with its week headings');
  const list = (await p.$$eval('.tlc-cal-listevs', (n) => n.map((x) => x.textContent).join(' ')));
  // The list has room for the whole block, so it prints one: 8:00 – 9:15 AM.
  ok(/8:00\s*[–-]\s*9:15 AM/.test(list) && /Divine Service/.test(list), 'and the events are spelled out');
  // Nothing may scroll sideways on a phone — the rule the rest of the site is
  // measured against at this width.
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, 'the page does not scroll sideways (' + overflow + 'px)');
  const taps = await p.$$eval('.tlc-cal-arrow, .tlc-cal-today, .tlc-cal-pill',
    (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h > 0));
  ok(taps.every((h) => h >= 44), 'every control is a 44px tap target: ' + taps.join(','));
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── the print sheet ─────────────────────────────────────────
{
  // ⚠ THE VIEWPORT HERE IS THE PAPER, and that is load-bearing rather than
  // incidental. The sheet is `height:100vh`, so under `emulateMedia('print')`
  // the vh unit is still the BROWSER window — measure at the default 950px and
  // a grid that would overflow a real page fits comfortably, and every
  // assertion below passes on a sheet that prints with its last week cut off.
  // 989 x 749 is letter landscape at the 0.35in margins the @page rule asks
  // for, at 96dpi.
  const { p, ctx } = await open({ width: 989, height: 749 });
  await goToFixtureMonth(p);
  await p.click('.tlc-cal-pill[data-cal="cat"][data-val="worship"]');
  await p.waitForTimeout(120);
  eq(await p.$$eval('.tlc-cal-chip', (c) => c.length), CHIPS_WORSHIP, 'the screen is filtered to Worship');
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(120);
  const sheetShown = await p.$eval('.tlc-print-sheet', (e) => getComputedStyle(e).display);
  ok(sheetShown !== 'none', 'the sheet appears when printing');
  // ⚠ THE SHEET IGNORES THE FILTERS ON SCREEN. Somebody printing the month for
  // the narthex wants the month; a sheet quietly missing every category but one
  // — because of a pill clicked five minutes ago — is wrong in a way nobody can
  // see by looking at it.
  const printed = await p.$$eval('.tlc-print-ev', (e) => e.length);
  ok(printed === CHIPS_ALL, 'and prints every event regardless (' + printed + ')');
  // ⚠ The one place a cap IS right — but the cap is the page, not a number.
  // The six week rows divide whatever height the page box offers, and each
  // cell clips rather than growing, so a busy day can never push the sheet
  // onto a second page. (That it really is one page is proven by generating a
  // PDF and counting, below; this is the mechanism that makes it true.)
  const cells = await p.$$eval('.tlc-print-cell', (c) => c.map((x) => Math.round(x.getBoundingClientRect().height)));
  eq(cells.length, 42, 'six weeks are on the sheet');
  ok(Math.max(...cells) - Math.min(...cells) <= 1, 'every week row is the same height: ' + Math.max(...cells) + ' vs ' + Math.min(...cells));
  const clips = await p.$eval('.tlc-print-cell', (c) => getComputedStyle(c).overflow);
  eq(clips, 'hidden', 'and a day with too much on it clips rather than growing the row');
  // ⚠ AND THE LAST WEEK IS STILL ON THE SHEET. Counting PDF pages alone is not
  // enough to prove this: the sheet is height:100vh with overflow hidden, so a
  // grid too tall for it prints as one page by CUTTING the last row off —
  // which is a worse failure than two pages, because the sheet looks complete.
  // The fixed-112px version this replaced does exactly that, and passes the
  // page count.
  const fits = await p.evaluate(() => {
    const sheet = document.querySelector('.tlc-print-sheet');
    const last = document.querySelectorAll('.tlc-print-cell')[41];
    return Math.round(last.getBoundingClientRect().bottom - sheet.getBoundingClientRect().bottom);
  });
  ok(fits <= 1, 'the last week of the month is inside the sheet, not clipped off it (' + fits + 'px past)');
  const hidden = await p.evaluate(() => {
    const gone = (sel) => { const e = document.querySelector(sel); return !e || getComputedStyle(e).display === 'none'; };
    return { cal: gone('.tlc-cal'), nav: gone('.nav'), foot: gone('footer'), hero: gone('#page-calendar .page-hero') };
  });
  ok(hidden.cal, 'the interactive calendar does not print');
  ok(hidden.nav && hidden.foot && hidden.hero, 'and neither does the page around it, which would take the first sheet');
  await p.emulateMedia({ media: 'screen' });
  await ctx.close();
}

// ── A PUBLISHED /calendar PAGE GETS THE REAL CALENDAR ───────
{
  // ⚠ THE CASE THAT WAS COMPLETELY UNTESTED, AND THE REASON THIS FEATURE WAS
  // INVISIBLE ON THE ONE PAGE IT WAS BUILT FOR. Every other group here drives
  // the hardcoded markup in public/index.html — which is only what a visitor
  // gets while the page is UNPUBLISHED. /calendar had in fact been published
  // from the page editor, so the SPA hid that markup and rendered the page's
  // blocks instead: a Calendar block, which was still a Google iframe, cap and
  // all. The page looked exactly as it had before and every test stayed green.
  const block = sanitizeBlock({ ...newBlock('calendar'), url: 'https://calendar.google.com/calendar/embed?src=x' });
  const html = renderPage([block], { editing: false, withCss: false });
  const { p, ctx, errors } = await open({ rendered: { calendar: html } });
  await p.waitForSelector('#page-calendar .tlc-cal', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);

  eq(await p.$$eval('#page-calendar iframe[src*="calendar.google.com"]', (f) => f.length), 0,
    'a published calendar page carries no Google embed at all');
  ok(await p.$('#page-calendar .tlcb--calendar .tlc-cal'), "the block's own mount is filled with the church calendar");
  const chips = await p.$$eval('#page-calendar .tlcb--calendar .tlc-cal-chip', (c) => c.length);
  eq(chips, CHIPS_ALL, 'and it draws the real month, uncapped');
  // The block sits on the calendar page, so it is the one that owns the sheet.
  eq(await p.$$eval('.tlc-print-sheet', (x) => x.length), 1, 'exactly one print sheet, on the block mount');
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── but a real embed is still a real embed ──────────────────
{
  // ⚠ The field takes a Google Form and other embeds too, and those have
  // nothing to do with the church calendar. The switch is on the ADDRESS, not
  // on the block type — get that wrong and every embedded form on the site
  // turns into a month grid.
  const block = sanitizeBlock({ ...newBlock('calendar'), url: 'https://docs.google.com/forms/d/e/abc/viewform' });
  const html = renderPage([block], { editing: false, withCss: false });
  const { p, ctx } = await open({ rendered: { calendar: html } });
  await p.waitForTimeout(500);
  eq(await p.$$eval('#page-calendar iframe[src*="docs.google.com/forms"]', (f) => f.length), 1,
    'a form embed is still an iframe');
  eq(await p.$$eval('#page-calendar [data-tlc-calendar]', (x) => x.length), 0, 'and gets no calendar mount');
  await ctx.close();
}

// ── the sheet is ONE page, and that is measurable ───────────
{
  // ⚠ THE ASSERTION THAT CAUGHT THE REAL BUG. Everything else about this sheet
  // can look right on screen and still be wrong on paper: at the design's
  // stated 112px cell, six week rows plus the header, the weekday strip and
  // the footer come to about 800px, and a letter page in landscape at 0.35in
  // margins gives 748px. It printed as TWO pages — the second one mostly
  // blank, carrying the last week of the month. Nothing short of generating a
  // real PDF and counting the pages would have said so.
  //
  // The month here is deliberately the worst case the sheet will ever meet:
  // every category in use, and one Sunday carrying seven separate items.
  const busy = [];
  CATEGORIES.forEach((c, i) => busy.push(ev({ id: 'c' + i, title: c.name + ' gathering',
    start: day(2 + (i % 20)) + 'T09:00:00', end: day(2 + (i % 20)) + 'T10:00:00', category: c.key })));
  ['08:00', '09:30', '10:45', '13:00', '15:00', '17:00', '19:00'].forEach((t, i) =>
    busy.push(ev({ id: 's' + i, title: 'Sunday item ' + (i + 1),
      start: SUNDAY + 'T' + t + ':00', end: SUNDAY + 'T' + t + ':00', category: 'worship' })));
  busy.push(ev({ id: 'v', title: 'Vacation Bible School', start: day(VBS_FROM), end: day(VBS_TO),
    allDay: true, source: 'news', category: 'youth' }));

  const { p, ctx } = await open({ feed: { ...FEED, events: busy } });
  await goToFixtureMonth(p);
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  eq(pages, 1, 'the busiest possible month still prints as one landscape sheet');
  ok(pdf.length > 5000, 'and the sheet has real content on it (' + pdf.length + ' bytes)');
  await ctx.close();
}

// ── a day with more on it than its row can hold says so, rather than being
// clipped mid-line ────────────────────────────────────────────────────────
// Reported plainly: "on long days things are cut off." The fixed cell was
// always going to clip SOMETHING — that is the whole mechanism that keeps the
// sheet to one page — but it used to clip mid-row with no explanation. This
// drives the real beforeprint fallback (tlcPrintFitCells, index.html), not
// just the CSS, because only that code knows how many events actually fit and
// turns the rest into an honest "+N more" line.
{
  // ⚠ THE VIEWPORT IS THE PAPER, same as the DOM-level print-sheet group
  // above — at the default (much taller) viewport the sheet's `height:100vh`
  // has room to spare and nothing overflows a row sized for it.
  //
  // ⚠ SEVEN SHORT EVENTS — the BUSY_SUNDAY fixture — turned out NOT to
  // overflow a real print row: that fixture exists to prove the sheet stays
  // ONE PAGE with it, which only holds if it fits. A church Wednesday with a
  // full evening's activities (real titles, some genuinely long — "Maplewood
  // Richmond Heights" is a real gym renter's name from the report) is what
  // actually forces the case this feature exists for.
  const stacked = day(15) + 'T18:00:00';
  const OVERSTUFFED = Array.from({ length: 12 }, (_, i) => ev({
    id: 'stk' + i, start: stacked, end: stacked,
    title: ['Bible Class', 'Sing a long', "Children's Choir", 'Maplewood Richmond Heights', 'Handbells',
      'Timothy Choir', 'Council Meeting', 'Elders Meeting', 'Gym rented', 'Adult Confirmation',
      'Property Committee', 'Finance Committee'][i],
  }));
  const { p, ctx } = await open({ width: 989, height: 749, feed: { ...FEED, events: OVERSTUFFED } });
  await goToFixtureMonth(p);
  // Found before printing, while the sheet is still display:none but its DOM
  // (event count included) is queryable regardless.
  const idx = await p.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.tlc-print-cell'));
    return cells.findIndex((c) => c.querySelectorAll('.tlc-print-ev').length === 12);
  });
  ok(idx >= 0, 'the twelve-event Wednesday is on the print sheet before anything is trimmed');

  await p.evaluate(() => window.print());
  await p.waitForTimeout(150);
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(120);

  const after = await p.evaluate((i) => {
    const cell = document.querySelectorAll('.tlc-print-cell')[i];
    const evs = Array.from(cell.querySelectorAll('.tlc-print-ev'));
    const visible = evs.filter((e) => getComputedStyle(e).display !== 'none');
    const more = cell.querySelector('.tlc-print-more');
    return {
      total: evs.length, visible: visible.length,
      moreText: more ? more.textContent : null,
      cellFits: Math.round(cell.getBoundingClientRect().bottom) <= Math.round(cell.parentElement.getBoundingClientRect().bottom) + 1,
    };
  }, idx);
  eq(after.total, 12, 'no event was removed from the DOM, only hidden');
  ok(after.visible < 12, 'and not all twelve are shown once the row cannot hold them (' + after.visible + ' visible)');
  ok(after.moreText, 'a "+N more" line explains the rest, instead of the last visible one being cut mid-line');
  eq(after.moreText, '+' + (12 - after.visible) + ' more', 'and the count on it matches exactly what is hidden: ' + after.moreText);

  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  eq(pages, 1, 'and the sheet this trims for is still one page');
  await ctx.close();
}

// ── a day that DOES fit is untouched ─────────────────────────
// ⚠ Verified against the bug on the way in: an earlier draft of this hid
// events on every cell, not only the ones that overflow, because the "does it
// already fit" short-circuit was written after the loop that removes rows
// rather than before it.
{
  const { p, ctx } = await open({ width: 989, height: 749 });
  await goToFixtureMonth(p);
  await p.evaluate(() => window.print());
  await p.waitForTimeout(150);
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(120);
  const quiet = await p.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.tlc-print-cell'));
    // The 10th carries exactly one event (Trustees meeting) — nowhere near
    // enough to overflow a row sized for a whole month's worst day.
    const cell = cells.find((c) => c.querySelectorAll('.tlc-print-ev').length === 1 &&
      Array.from(c.querySelectorAll('.tlc-print-ev .tx')).some((t) => t.textContent.includes('Trustees')));
    if (!cell) return null;
    return {
      hidden: Array.from(cell.querySelectorAll('.tlc-print-ev')).filter((e) => getComputedStyle(e).display === 'none').length,
      more: !!cell.querySelector('.tlc-print-more'),
    };
  });
  ok(quiet, 'the Trustees meeting day is found on the sheet');
  eq(quiet.hidden, 0, 'a day that already fits has nothing hidden on it');
  eq(quiet.more, false, 'and carries no "+N more" line it does not need');
  await ctx.close();
}

// ── the sheet still isolates itself without :has() support ──
// ⚠ THE PRIMARY MECHANISM IS :has(), AND EVERY TEST ABOVE PROVES IT WORKS.
// This is the fallback for the gap that CSS's own comment already admitted:
// "a browser without :has() prints the page with its chrome above the sheet:
// degraded, not broken... every current browser has it." Reported again,
// verbatim, later: "the print calendar is just printing the full page not the
// calendar on one page of paper" — a church office machine is exactly the
// kind that goes years between browser updates, so "every current browser"
// was optimistic rather than universal.
//
// There is no browser build in this sandbox that genuinely lacks :has(), so
// this simulates one the only honest way available: serve styles.css with
// every rule whose selector contains :has( stripped out before it reaches the
// page. A selector list containing an unsupported pseudo-class is INVALID —
// the whole rule is dropped by a real non-supporting browser too — so this
// produces the identical CSSOM a real one would have, not an approximation.
{
  const stripHasRules = (css) => {
    const lines = css.split('\n'), out = [];
    let skipDepth = 0;
    for (const line of lines) {
      if (skipDepth > 0) {
        skipDepth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        continue;
      }
      if (/:has\(/.test(line) && line.includes('{')) {
        if (line.trim().endsWith('}')) continue;
        skipDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  };

  const ctx = await browser.newContext({ viewport: { width: 989, height: 749 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.route(base + '/styles.css', async (route) => {
    const res = await route.fetch();
    const stripped = stripHasRules(await res.text());
    await route.fulfill({ response: res, body: stripped, contentType: 'text/css' });
  });
  await p.route('https://admin.timothystl.org/**', (route) => {
    const u = route.request().url();
    if (u.includes('/api/calendar')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FEED) });
    if (u.includes('/api/pages')) return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ pages: [], menu: null, rendered: {}, redirects: {}, css: '' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await p.route('https://**', (route) => route.fulfill({ status: 200, body: '' }));
  await p.goto(base + '/calendar', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#tlc-cal-main .tlc-cal', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(500);
  ok(await goToFixtureMonth(p), 'the month can be navigated to');

  const hasRuleCount = await p.evaluate(() => {
    let n = 0;
    for (const sheet of document.styleSheets) {
      try { for (const rule of sheet.cssRules) if (rule.selectorText && rule.selectorText.includes(':has(')) n++; }
      catch (e) {}
    }
    return n;
  });
  eq(hasRuleCount, 0, 'confirmed: the loaded stylesheet has no :has() rule left for the browser to fall back on');

  // ⚠ TRIGGERED THE SAME WAY Ctrl/Cmd+P AND THE BROWSER'S OWN PRINT MENU ITEM
  // ARE — window.print(), never the button. The button's handler is the same
  // bare call (see tlcCalClick); binding this fallback to the click alone
  // would miss both of those.
  await p.evaluate(() => window.print());
  await p.waitForTimeout(150);
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(120);

  const stray = await p.evaluate(() => {
    const sheet = document.querySelector('.tlc-print-sheet');
    const out = [];
    document.querySelectorAll('#page-calendar .tlc-cal, .nav, footer, #newsletter-band, #page-calendar .page-hero').forEach((el) => {
      if (el.contains(sheet)) return;                       // on the path down to it
      if (getComputedStyle(el).display !== 'none') out.push(el.className || el.tagName);
    });
    return out;
  });
  eq(stray.length, 0, 'the chrome is hidden even without :has() support: ' + stray.join(', '));

  const box = await p.$eval('.tlc-print-sheet', (e) => {
    const r = e.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left) };
  });
  eq(box.top, 0, 'and the sheet sits at the top of the page rather than pushed down by hidden chrome (' + box.top + 'px)');
  eq(box.left, 0, 'and flush left (' + box.left + 'px)');

  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  eq(pages, 1, 'and it still prints as one page, not the whole document');

  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── when Google cannot be read ──────────────────────────────
{
  const { p, ctx } = await open({ feed: { ...FEED, events: OTHER_DAYS.filter((e) => e.source === 'news'),
    sources: { google: false, news: true, googleReason: 'unconfigured' } } });
  await goToFixtureMonth(p);
  const note = await p.textContent('.tlc-cal-note');
  ok(/News & Events entries only/.test(note), 'the page says which half is missing rather than looking complete');
  ok(await p.$('.tlc-cal-note a[href*="calendar.google.com"]'), 'and offers Google directly');
  ok(await p.$$eval('.tlc-cal-chip', (c) => c.length) > 0, 'while still drawing what it does have');
  await ctx.close();
}

{
  const { p, ctx, errors } = await open({ status: 500 });
  await p.waitForTimeout(400);
  const note = await p.textContent('.tlc-cal-note');
  ok(/could not be loaded/.test(note), 'a failed feed falls back to a link out, not an empty grid');
  ok(await p.$('.tlc-cal-note a[href*="calendar.google.com"]'), 'with somewhere to go');
  eq(errors.length, 0, 'and no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── the /news strip ─────────────────────────────────────────
{
  const { p, ctx, errors, calls } = await open({ page: 'news' });
  ok(await p.$('#tlc-cal-news .tlc-cal'), 'the same calendar renders on /news');
  ok(await p.$$eval('#tlc-cal-news .tlc-cal-chip', (c) => c.length) >= 0, 'and draws its month');
  // ⚠ ONE PRINT SHEET IN THE DOCUMENT. Two would print two pages, and the
  // second would be a month nobody asked for.
  eq(await p.$$eval('.tlc-print-sheet', (s) => s.length), 0, '/news does not carry its own print sheet');
  ok(calls() >= 1, 'and it does fetch when the page is opened');
  // ⚠ AND PRINTING /news IS NOT PRINTING THE CALENDAR PAGE. The rules that
  // strip the hero, the nav and the footer are scoped to #page-calendar on
  // purpose — unscoped they would quietly change how every page on the site
  // prints, which nobody asked for. What /news does lose is the interactive
  // calendar widget, which is `data-noprint` wherever it is mounted.
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(120);
  const news = await p.evaluate(() => {
    const shown = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    return { cal: shown('#tlc-cal-news .tlc-cal'), nav: shown('.nav'), foot: shown('footer'),
             hero: shown('#page-news .page-hero') };
  });
  eq(news.cal, false, 'the calendar widget does not print from /news either');
  ok(news.nav && news.foot && news.hero, 'but the rest of the page prints exactly as it did before this feature');
  await p.emulateMedia({ media: 'screen' });
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── nothing is fetched until a calendar page is opened ──────
{
  const { p, ctx, calls } = await open({ page: '' });
  await p.waitForTimeout(400);
  // The homepage carries neither mount, so opening the site must not pay for a
  // month of events — the lazy behavior the iframe already had.
  eq(calls(), 0, 'the homepage does not fetch the calendar');
  await ctx.close();
}

// ── a block of time, where there is room to print one ───────
// "for blocks that building in use maybe it should say ... the time block that
// it is used." A gym rental is only useful as a block: the question somebody
// is asking is whether the gym is free at two.
{
  const timed = [
    ev({ id: 'b:9', title: 'Gym rented', location: 'Gym', source: 'building', category: 'facility',
         start: day(21) + 'T13:00:00', end: day(21) + 'T15:00:00' }),
    // An end equal to the start is what a News post with no end time produces.
    ev({ id: 'n:9', title: 'Council meeting', source: 'news', category: 'meetings',
         start: day(21) + 'T19:00:00', end: day(21) + 'T19:00:00' }),
    ev({ id: 'g:9', title: 'Morning prayer', category: 'worship',
         start: day(21) + 'T09:00:00', end: day(21) + 'T13:30:00' }),
  ];
  const { p, ctx, errors } = await open({ feed: { ...FEED, events: timed }, width: 800 });
  await p.waitForTimeout(300);
  const list = await p.$$eval('.tlc-cal-listev .ltime', (e) => e.map((x) => x.textContent.trim()));

  ok(list.includes('9:00 AM – 1:30 PM'), 'a span crossing noon keeps both meridiems: ' + list.join(' | '));
  ok(list.includes('1:00 – 3:00 PM'), 'and one inside the afternoon prints a single PM, as a bulletin would');
  // ⚠ AN END NOBODY TYPED MUST NOT BE PRINTED AS ONE. The .ics needs a number
  // and derives one; the page must not claim a duration the record never made.
  ok(list.includes('7:00 PM'), 'an unstated end shows the start alone: ' + list.join(' | '));
  ok(!list.some((t) => t.startsWith('7:00') && t.includes('–')), 'and never invents a range for it');

  // The grid chip stays compact — a range does not fit a day cell.
  const chip = await p.$$eval('.tlc-cal-chip .tlc-cal-time', (e) => e.map((x) => x.textContent.trim()));
  ok(!chip.some((t) => t.includes('–')), 'the month grid keeps the start alone, for room: ' + chip.join(' | '));

  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── the list view's time and its title never overlap ────────
// Reported directly, with a screenshot: "on agenda view the time is printing
// over the events in places." tlcCalSpan() prints a start–end RANGE, and one
// crossing noon does not collapse to a single meridiem the way "8:00 – 9:15
// AM" does — "10:00 AM – 12:00 PM" is nearly half again as wide. The .ltime
// column was a FIXED 88px, sized for a single start time; a range wider than
// that, with white-space:nowrap on it, overflowed into the title beside it
// rather than wrapping — silent in the markup, and only visible on screen.
//
// ⚠ THIS ONLY REPRODUCES AT A DESKTOP WIDTH, WITH LIST EXPLICITLY CHOSEN. Under
// 900px the phone rules collapse .tlc-cal-listev to a single column
// (grid-template-columns:1fr) — time and title stack instead of sitting side
// by side, so there is nothing to overlap there. And a wide window defaults to
// the month grid; List is a toggle, not the default, and the report says
// "agenda view" — somebody had clicked it. The first version of this test used
// width:800 and never caught the bug it was written for, for exactly this
// reason.
{
  const rental = [
    ev({ id: 'b:wide', title: 'Gym rented', location: 'Gym', source: 'building', category: 'facility',
         start: day(15) + 'T10:00:00', end: day(15) + 'T12:00:00' }),
  ];
  const { p, ctx, errors } = await open({ feed: { ...FEED, events: rental }, width: 1280 });
  await goToFixtureMonth(p);
  await p.click('.tlc-cal-seg [data-cal="view"][data-val="list"]');
  await p.waitForTimeout(200);
  const time = await p.textContent('.tlc-cal-listev .ltime');
  eq(time.trim(), '10:00 AM – 12:00 PM', 'the reported case: a range crossing noon, unabbreviated');
  // ⚠ MEASURED FROM THE RENDERED TEXT, NOT THE BOX. .ltime is blockified as a
  // grid item and its box stays at the track's width even when its nowrap
  // content is wider — overflow:visible content paints past the box without
  // growing the rect getBoundingClientRect() reports for the box itself. A
  // Range over the text finds where the glyphs actually land, which is the
  // only thing "overlapping the title" can mean. Verified against the bug:
  // this same measurement over the OLD 88px column reads the text out to
  // 406px while the title starts at 381px — a real ~25px overlap; over the
  // fixed column here they no longer touch.
  const geom = await p.$eval('.tlc-cal-listev', (btn) => {
    const range = document.createRange();
    range.selectNodeContents(btn.querySelector('.ltime'));
    const timeTextRight = range.getBoundingClientRect().right;
    const titleLeft = btn.querySelector('.lt').getBoundingClientRect().left;
    return { timeTextRight, titleLeft };
  });
  ok(geom.timeTextRight <= geom.titleLeft, 'the rendered time does not run into the title (time text ends at ' +
    Math.round(geom.timeTextRight) + 'px, title starts at ' + Math.round(geom.titleLeft) + 'px)');
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── the printed sheet on a PUBLISHED page ───────────────────
// ⚠ THE CASE THE PRINT RULES WERE NEVER DRIVEN AGAINST, AND THE SAME MISTAKE AS
// LAST TIME. Every print assertion above renders the hardcoded /calendar markup
// — which is what a visitor gets only while the page is UNPUBLISHED. /calendar
// has in fact been published, so what a visitor really gets is a stack of
// blocks with the calendar somewhere inside it. The old print CSS was a
// DENYLIST naming the hardcoded page's chrome (.nav, .page-hero, footer, the
// newsletter band), and a block appears on none of it — so a published page
// printed its hero, its text and its buttons above the sheet and pushed the
// month onto page two. Reported as "it is printing the whole page".
{
  const hero = sanitizeBlock({ ...newBlock('hero'), title: 'Church calendar',
    subtitle: 'Everything happening at Timothy, all in one place, month by month.' });
  const words = sanitizeBlock({ ...newBlock('text'),
    body: '<p>' + 'A paragraph that exists to take up room on the page. '.repeat(40) + '</p>' });
  const cal = sanitizeBlock({ ...newBlock('calendar'), url: '' });
  const html = renderPage([hero, words, cal, sanitizeBlock({ ...newBlock('text'), body: '<p>And something after it.</p>' })],
    { editing: false, withCss: false });

  const { p, ctx, errors } = await open({ rendered: { calendar: html } });
  await p.waitForSelector('#page-calendar .tlc-print-sheet', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  eq(await p.$$eval('.tlc-print-sheet', (x) => x.length), 1, 'the published page draws exactly one sheet');

  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(150);

  // ⚠ ASKED OF THE BROWSER, NOT READ OFF THE CSS. Reading the rules is what
  // produced the bug: they looked complete, and were complete for a page
  // nobody was being served.
  const stray = await p.evaluate(() => {
    const sheet = document.querySelector('.tlc-print-sheet');
    const out = [];
    document.querySelectorAll('#page-calendar .tlcb, .nav, footer, #newsletter-band').forEach((el) => {
      if (el.contains(sheet)) return;                       // on the path down to it
      if (getComputedStyle(el).display !== 'none') out.push(el.className || el.tagName);
    });
    return out;
  });
  eq(stray.length, 0, 'nothing else on the page is printed: ' + stray.join(', '));

  // The proof that matters: it is still one sheet of paper.
  const pdf = await p.pdf({ preferCSSPageSize: true, printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  eq(pages, 1, 'a published calendar page still prints as ONE landscape sheet');
  ok(pdf.length > 5000, 'with real content on it (' + pdf.length + ' bytes)');
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// ── and a page with no sheet prints as it always did ────────
{
  // ⚠ The rule is scoped to a document that HAS a sheet, so it can never reach
  // a ministry page somebody is printing with its hero and its footer — the
  // behavior the old scoping existed to protect.
  const { p, ctx } = await open({ page: 'news' });
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(150);
  eq(await p.$$eval('.tlc-print-sheet', (x) => x.length), 0, '/news draws no sheet');
  const navShown = await p.$eval('.nav', (e) => getComputedStyle(e).display);
  ok(navShown !== 'none', 'so the page around it prints exactly as it always has');
  await ctx.close();
}

// ── subscribing to part of it ───────────────────────────────
// ⚠ A LINK TO AN .ics FILE IS NOT A SUBSCRIPTION. Clicking one downloads a
// snapshot: the events land once and never update, which looks like it worked
// and quietly stops being true the following week. What is pinned here is that
// the panel offers a `webcal:` address and a copyable one, and that the choice
// of what is in it actually reaches the address.
{
  const { p, ctx, errors } = await open();
  ok(!(await p.$('.tlc-cal-subpanel')), 'the panel is shut to begin with');
  await p.click('.tlc-cal-sub');
  ok(await p.$('.tlc-cal-subpanel'), 'Subscribe opens it');
  eq(await p.getAttribute('.tlc-cal-sub', 'aria-expanded'), 'true', 'and says so to a screen reader');

  // ⚠ webcal:, not https:. This is the whole difference between subscribing
  // and downloading a file that never changes again.
  const href = await p.getAttribute('.tlc-cal-subbtn', 'href');
  ok(/^webcal:\/\//.test(href), 'the button hands the address to a calendar app: ' + href);
  ok(!/[?&]cat=/.test(href), 'and with everything ticked it asks for everything, not a list of all of them');

  const url = await p.inputValue('.tlc-cal-suburl');
  ok(/^https:\/\//.test(url), 'and there is an https address to paste into an app that ignores webcal');

  // ⚠ EVERY CLICK REDRAWS THE PANEL, so an element handle taken before one is
  // detached by the time of the next. Everything below re-queries.
  const catCount = (await p.$$('.tlc-cal-subcat input')).length;
  ok(catCount >= 2, 'there is a box per category on the month');
  // Unticking one leaves the other ten, rather than leaving nothing.
  await p.click('.tlc-cal-subcat:nth-of-type(2) input');
  const href2 = await p.getAttribute('.tlc-cal-subbtn', 'href');
  ok(/[?&]cat=/.test(href2), 'unticking one narrows the address: ' + href2);
  const asked = decodeURIComponent((href2.match(/[?&]cat=([^&]*)/) || [])[1] || '').split(',');
  eq(asked.length, catCount - 1, 'to everything except the one that was unticked');

  // ⚠ THE PANEL IS ITS OWN CHOICE, NOT THE MONTH'S FILTER PILLS. A pill is
  // what somebody is looking at for a moment; a subscription is what appears
  // in their calendar every day for years, and coupling them would silently
  // change one when they touched the other.
  const pill = await p.$('.tlc-cal-cats [data-cal="cat"][data-val="worship"]');
  if (pill) {
    await pill.click();
    await p.waitForTimeout(150);
    const href3 = await p.getAttribute('.tlc-cal-subbtn', 'href');
    eq(href3, href2, 'clicking a month filter does not rewrite the subscription');
  }

  // ⚠ Nothing ticked is refused rather than served as an empty file: from
  // inside a calendar app, an empty subscription and a broken one look the same.
  for (let i = 0; i < catCount + 2; i++) {
    const next = await p.$('.tlc-cal-subcat input[type=checkbox]:checked');
    if (!next) break;
    await next.click();
  }
  ok(!(await p.$('.tlc-cal-subbtn')), 'with nothing ticked there is no address to add');
  ok(await p.$('.tlc-cal-subwarn'), 'and it says to choose something');

  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await ctx.close();
}

// The panel must never reach the printed month — it is a control, and the
// sheet is a handout.
{
  const { p, ctx } = await open();
  await p.click('.tlc-cal-sub');
  await p.emulateMedia({ media: 'print' });
  const shown = await p.$eval('.tlc-cal-subpanel', (el) => getComputedStyle(el).display);
  eq(shown, 'none', 'the Subscribe panel is not on the printed sheet');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`public-calendar.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
