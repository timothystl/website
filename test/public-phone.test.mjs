// [B8] The public site at phone width, MEASURED — run with:
//   node test/public-phone.test.mjs
//
// The backlog item asked for "a tap-through on a real phone to verify
// button/link sizes feel comfortable". A person doing that once tells you
// about the day they did it; this tells you on every change, which is the
// half that keeps being true.
//
// 390px because that is an iPhone at its most common width, and because the
// gym portal suite already measures there — one number to remember rather
// than two. 44px is Apple's minimum and the one WCAG 2.5.5 settles near; it
// is a floor, not a target.
//
// ⚠ This measures the site as it SHIPS — no admin API, because a visitor on a
// phone with a slow connection sees exactly that for the first second, and it
// is also what they see whenever admin.timothystl.org is unreachable.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const group = (n) => console.log('\n' + n);

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = 'http://localhost:' + server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// The admin is unreachable on purpose — see the note at the top.
await page.route('https://admin.timothystl.org/**', (route) => route.abort());
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });

const MIN = 44;

// Every control a visitor can actually hit, with the rectangle it presents.
// Hidden things are skipped: a nav item behind a closed hamburger has no size
// yet, and reporting it as 0x0 would bury the real findings in noise.
async function targets(selector) {
  return page.$$eval(selector, (els) => els
    .map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || !r.width || !r.height) return null;
      return {
        w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right),
        label: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 42),
      };
    })
    .filter(Boolean));
}

group('nothing on the page scrolls sideways');
{
  // A horizontal scrollbar on a phone is the most reported "the site is
  // broken" symptom there is, and it is always one element overhanging.
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== 'fixed';
      })
      .slice(0, 5)
      .map((el) => (el.className || el.tagName) + ' → ' + Math.round(el.getBoundingClientRect().right));
  });
  ok(overflow.length === 0, `nothing overhangs 390px — found: ${overflow.join(' | ')}`);

  const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(!scrolls, 'and the document itself does not scroll horizontally');
}

group('the header is usable with a thumb');
{
  const toggles = await targets('.nav-toggle');
  ok(toggles.length === 1, 'the hamburger is on screen at phone width');
  for (const t of toggles) {
    ok(t.w >= MIN && t.h >= MIN, `the hamburger is at least ${MIN}px (got ${t.w}x${t.h})`);
  }

  // The brand block is the way back to the homepage and is tapped constantly.
  const brand = await targets('.nav-brand');
  for (const b of brand) ok(b.h >= MIN, `the logo/home control is at least ${MIN}px tall (got ${b.h})`);
}

group('the open mobile menu');
{
  await page.click('.nav-toggle');
  await page.waitForTimeout(120);
  const items = await targets('#navMobile button, #navMobile a');
  ok(items.length > 3, `the drawer opens and lists its links (${items.length})`);
  const small = items.filter((i) => i.h < MIN);
  ok(small.length === 0,
    `every link in the drawer is at least ${MIN}px tall — short: ${small.map((s) => `${s.label} ${s.h}px`).join(', ')}`);
  await page.click('.nav-toggle');
  await page.waitForTimeout(120);
}

group('buttons and links in the page body');
{
  const btns = await targets('.btn, .nav-cta');
  ok(btns.length > 0, `the page has buttons to measure (${btns.length})`);
  const small = btns.filter((b) => b.h < MIN);
  ok(small.length === 0,
    `every button is at least ${MIN}px tall — short: ${small.map((s) => `${s.label} ${s.h}px`).join(', ')}`);
}

group('the footer, where the links are smallest');
{
  const links = await targets('footer a, footer button');
  ok(links.length > 5, `the footer has links to measure (${links.length})`);
  // ⚠ Footer links are a dense list, so height here is the tap target: two
  // links 20px apart is how somebody opens the wrong page.
  const tight = links.filter((l) => l.h < 30);
  ok(tight.length === 0,
    `no footer link is under 30px tall — tight: ${tight.map((s) => `${s.label} ${s.h}px`).join(', ')}`);
}

group('the newsletter form can be filled in on a phone');
{
  const fields = await targets('#newsletter-signup-form input:not([type=hidden]), #newsletter-signup-form button');
  ok(fields.length >= 3, 'the form is on the page');
  const small = fields.filter((f) => f.h < MIN);
  ok(small.length === 0,
    `every field and its button is at least ${MIN}px tall — short: ${small.map((s) => `${s.label} ${s.h}px`).join(', ')}`);
}

group('no script errors at phone width');
{
  ok(errors.length === 0, `no page errors — got: ${errors.slice(0, 3).join(' | ')}`);
}

await browser.close();
server.close();
console.log(`\npublic-phone: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
