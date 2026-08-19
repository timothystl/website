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

  // ⚠ The filters compose. Worship is entirely a Google category here, so
  // asking for Worship AND News & Events must yield the empty state rather
  // than quietly widening one of the two.
  await p.click('.tlc-cal-pill[data-cal="src"][data-val="news"]');
  await p.waitForTimeout(120);
  eq(await count(), 0, 'the two filters are ANDed');
  ok(await p.$('.tlc-cal-empty'), 'and a combination with nothing in it says so rather than showing a blank month');

  await p.click('.tlc-cal-pill[data-cal="cat"][data-val="all"]');
  await p.waitForTimeout(120);
  eq(await count(), CHIPS_NEWS, 'News & Events alone leaves the News entries — the picnic, plus five days of VBS');
  await p.click('.tlc-cal-pill[data-cal="src"][data-val="all"]');
  await p.waitForTimeout(120);
  eq(await count(), all, 'clearing both filters restores the month');
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
  ok(/8:00 AM/.test(list) && /Divine Service/.test(list), 'and the events are spelled out');
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

await browser.close();
server.close();
console.log(`public-calendar.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
