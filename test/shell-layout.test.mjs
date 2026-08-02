// The admin shell, measured in a real browser.
//   node test/shell-layout.test.mjs
//
// This file exists because of a bug that every CSS assertion in the repo
// missed. `.sidebar-groups` had `flex:1;min-height:0` and no `overflow-y`,
// while `.sidebar` itself carried `overflow-y:auto`. Every rule read fine on
// its own. What happened on screen was that the group list got squashed to the
// leftover flex height and its twenty-odd nav rows painted straight out of the
// box — so "⌘K searches every section" and "Sign out" rendered ON TOP of
// Filtered Mail, halfway up the sidebar, with the remaining groups continuing
// underneath them.
//
// You cannot catch that by grepping CSS, because no single declaration is
// wrong. You catch it by asking the browser where things actually are. Hence
// rectangles, not strings.

import http from 'node:http'; import path from 'node:path';
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process';
const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr, 'x.js'))('playwright');
import { html, sidebarShell, loginPage } from '../admin/helpers.js';
import { PERMISSIONS } from '../admin/auth.js';

// Somebody with every permission, so the sidebar renders every group — which
// is the case that overflows, and therefore the case that broke. `permissions`
// is a JSON array string, which is what hasPermission() parses.
const USER = { username: 'dinger', permissions: JSON.stringify(Object.keys(PERMISSIONS)) };

const body = sidebarShell('gym', USER, '', {})
  + '<div class="wrap"><h1 class="page-title">Gym rentals</h1>'
  + '<p class="page-sub">Rate, blocked dates and the renter portal.</p>'
  + '<div class="card">Content</div></div>';

const page = await html(body, 'Gym rentals').text();
const login = await loginPage().text();

const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html' });
  r.end(q.url.startsWith('/login') ? login : page);
});
await new Promise((r) => srv.listen(0, r));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const group = (n) => console.log('\n' + n);
const box = (sel) => p.$eval(sel, (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right }; });
const overlaps = (a, c) => a.x < c.right && c.x < a.right && a.y < c.bottom && c.y < a.bottom;

// A short viewport on purpose: the bug only appears when the nav is taller
// than the space it has. At 1200px high everything fits and nothing is wrong.
await p.setViewportSize({ width: 1280, height: 620 });
await p.goto('http://localhost:' + srv.address().port);
await p.waitForTimeout(120);

group('the sidebar footer never covers the navigation');
{
  const footer = await box('.sidebar-footer');
  const items = await p.$$eval('.sidebar-item', (ns) => ns.map((n) => {
    const r = n.getBoundingClientRect();
    return { label: n.textContent.trim(), x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  }));

  ok(items.length > 12, `the sidebar rendered its full nav (${items.length} rows)`);

  // ⚠ Ask what is PAINTED, not what is laid out. A row scrolled under the
  // clip edge still reports a rectangle down there — getBoundingClientRect
  // describes layout, not visibility — so comparing rectangles alone flags
  // rows the container is correctly hiding. elementFromPoint answers the
  // question the screenshot asked: what is actually on top of the footer?
  const covering = await p.evaluate(() => {
    const f = document.querySelector('.sidebar-footer').getBoundingClientRect();
    const hits = new Set();
    for (let y = f.top + 3; y < f.bottom - 3; y += 6) {
      for (let x = f.left + 3; x < f.right - 3; x += 20) {
        const el = document.elementFromPoint(x, y);
        const item = el && el.closest && el.closest('.sidebar-item');
        if (item) hits.add(item.textContent.trim());
      }
    }
    return [...hits];
  });
  ok(covering.length === 0,
    `nav rows are painted over the footer: ${covering.join(', ')}`);

  // And it is genuinely at the bottom, not merely out of the way.
  ok(footer.bottom <= 621 && footer.bottom > 500,
    `the footer sits at the foot of the rail (bottom ${Math.round(footer.bottom)} of 620)`);
}

group('the group list is the scroller');
{
  const scrolls = await p.$eval('.sidebar-groups', (n) => n.scrollHeight > n.clientHeight + 1);
  ok(scrolls, 'the nav overflows at this height — otherwise this whole file proves nothing');

  // ⚠ THIS IS THE LOAD-BEARING ASSERTION. Reintroducing the original CSS —
  // `overflow-y:auto` on .sidebar, none on .sidebar-groups, `margin-top:auto`
  // back on the footer — was tried, and THIS is the line that failed; the
  // paint check above stayed green, because under the flex shell the squashed
  // box no longer happens to land the footer under the nav. The wrong nesting
  // is the defect. The overlap was only the shape it took in the old shell.
  const sidebarScrolls = await p.$eval('.sidebar', (n) => n.scrollHeight > n.clientHeight + 1);
  ok(!sidebarScrolls, 'the sidebar itself does not scroll; it clips and the list inside scrolls');

  // Scrolling the list must not drag the footer with it.
  const before = await box('.sidebar-footer');
  await p.$eval('.sidebar-groups', (n) => { n.scrollTop = n.scrollHeight; });
  await p.waitForTimeout(60);
  const after = await box('.sidebar-footer');
  ok(Math.abs(before.y - after.y) < 1, 'the footer stays put while the list scrolls under it');
}

group('two columns, and the content gets the rest');
{
  const side = await box('.sidebar');
  const main = await box('.tlc-main');

  ok(Math.round(side.w) === 228, `the rail is 228px (got ${Math.round(side.w)})`);
  ok(Math.round(side.x) === 0, 'the rail starts at the left edge');
  ok(Math.round(main.x) === 228, `the content column starts where the rail ends (got ${Math.round(main.x)})`);
  ok(Math.round(main.right) === 1280, 'and runs to the right edge');
  ok(!overlaps(side, main), 'the two columns do not overlap');

  // The context bar belongs to the content column, not the full width — it
  // "starts where the sidebar ends", per 00b-header-nav.
  const ctxBar = await box('.tlc-ctx');
  ok(Math.round(ctxBar.x) === 228, `the context bar starts at the content column (got ${Math.round(ctxBar.x)})`);
}

group('the merged sidebar kept the Foundations values');
{
  // The colour-and-type block used to be a SECOND set of .sidebar* rules after
  // the interpolated stylesheets, winning on source order alone. It was merged
  // into the shell block; these are the values that came from the later block
  // and would quietly revert to the early ones if the merge ever regressed.
  const st = await p.$eval('.sidebar', (n) => {
    const c = getComputedStyle(n);
    return { bg: c.backgroundColor, overflow: c.overflow, position: c.position };
  });
  ok(st.bg === 'rgb(29, 53, 87)', `the rail is the spec navy #1D3557 (got ${st.bg})`);
  ok(st.overflow === 'hidden' && st.position === 'sticky', 'and kept its shell geometry');

  const item = await p.$eval('.sidebar-item', (n) => {
    const c = getComputedStyle(n);
    return { size: c.fontSize, radius: c.borderRadius, pad: c.paddingLeft };
  });
  ok(item.size === '13.5px', `nav rows are 13.5px (got ${item.size})`);
  ok(item.radius === '9px' && item.pad === '12px', 'with the rounded raised-row geometry');
}

group('a wide table cannot push the content column off screen');
{
  // min-width:0 on the flex child. Without it the column refuses to shrink
  // below its content and the whole layout slides right.
  await p.$eval('.wrap', (n) => {
    const t = document.createElement('div');
    t.style.cssText = 'width:3000px;height:20px;background:#ccc';
    t.id = 'fat';
    n.appendChild(t);
  });
  await p.waitForTimeout(60);
  const main = await box('.tlc-main');
  const side = await box('.sidebar');
  ok(Math.round(main.x) === 228, `the content column held its position (got ${Math.round(main.x)})`);
  ok(Math.round(side.w) === 228, 'and the rail was not squeezed');
  await p.$eval('#fat', (n) => n.remove());
}

group('the form width rule caps the field column and nothing else');
{
  // Task 19. The cap is on the field column; the heading, the purpose line and
  // anything with a table in it stay full width. Measured at 1900px because
  // that is the monitor the rule exists for — at 1280px a 640px form and an
  // uncapped one are not obviously different, which is how this went unnoticed.
  await p.setViewportSize({ width: 1900, height: 900 });
  await p.evaluate(() => {
    const w = document.querySelector('.wrap');
    w.className = 'tlc-wrap';
    w.innerHTML = '<h1 class="page-title">Add a ministry page</h1>'
      + '<p class="page-sub">Purpose line.</p>'
      + '<div class="card" id="t19-form"><div class="form-group"><label>Name</label>'
      + '<input type="text"></div></div>'
      + '<div class="btn-row" id="t19-btns"><button class="btn btn-primary">Save</button></div>'
      + '<div class="card" id="t19-mixed"><div class="form-group"><label>Rate</label>'
      + '<input type="text"></div><table><tr><td>wide</td></tr></table></div>'
      + '<div class="card" id="t19-table"><table><tr><td>pure table</td></tr></table></div>';
  });
  await p.waitForTimeout(80);

  const wide = await box('#t19-table');
  ok(Math.round((await box('#t19-form')).w) === 640,
    `a field-only card caps at 640 (got ${Math.round((await box('#t19-form')).w)})`);
  ok(Math.round((await box('#t19-mixed')).w) > 900,
    'a card holding a table keeps its width — fixing the form must not break the table beside it');
  ok(Math.round(wide.w) > 900, 'a pure table card is untouched');
  ok(Math.round((await box('.page-title')).w) > 900, 'the heading is not capped');

  // "Buttons at the foot of a form align to the left edge of the field column,
  // not the right edge of the page."
  ok(Math.round((await box('#t19-btns')).x) === Math.round((await box('#t19-form')).x),
    'the buttons begin at the left edge of the field column');
}

group('below 900px the rail is a slide-over, and the content takes the width');
{
  await p.setViewportSize({ width: 480, height: 760 });
  // ⚠ The rail transitions over .2s. Measuring sooner catches it mid-slide and
  // reports a half-open sidebar as a layout bug, which is a lie either way.
  await p.waitForTimeout(400);

  const main = await box('.tlc-main');
  ok(Math.round(main.x) === 0, `the content column takes the full width (got x=${Math.round(main.x)})`);

  const side = await box('.sidebar');
  ok(side.right <= 1, 'the rail is off-canvas until asked for');

  // The button and its handler must ship together — a previous pass shipped
  // the CSS without the JS and a phone had no navigation at all.
  const toggle = await p.$('#sidebar-toggle');
  ok(toggle !== null, 'the hamburger exists below 900px');
  await p.click('#sidebar-toggle');
  await p.waitForTimeout(260);
  const open = await box('.sidebar');
  ok(Math.round(open.x) === 0, `clicking it actually opens the rail (got x=${Math.round(open.x)})`);

  await p.keyboard.press('Escape');
  await p.waitForTimeout(260);
  const closed = await box('.sidebar');
  ok(closed.right <= 1, 'Escape closes it again');
}

group('the login page fills the viewport');
{
  // The regression this catches shipped: body{display:flex} made the shell a
  // flex ROW, and on the four screens with no sidebar (login, forgot, reset,
  // setup) the wrapper was the only flex item with no width — so the navy
  // backdrop shrank to fit its 380px card and sat as a strip on the left of
  // the viewport, warm page colour filling the rest. Every string assertion
  // stayed green. Only a browser asked "how wide is it?" would have noticed.
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.goto('http://localhost:' + srv.address().port + '/login');
  await p.waitForTimeout(120);

  const wrap = await box('.login-wrap');
  ok(wrap.w >= 1270, `the navy backdrop spans the viewport (got ${Math.round(wrap.w)} of 1280)`);
  ok(wrap.h >= 800, 'and its full height');

  const card = await box('.login-card');
  const off = Math.abs((card.x + card.w / 2) - 640);
  ok(off < 2, `the card is centred (midpoint off by ${Math.round(off)}px)`);

  const navy = await p.$eval('.login-wrap', (n) => getComputedStyle(n).backgroundColor);
  ok(navy === 'rgb(30, 45, 74)', `on the Foundations navy (got ${navy})`);
}

group('no script errors');
ok(errs.length === 0, 'the page threw: ' + errs.join(' | '));

await b.close(); srv.close();
console.log(`\nshell-layout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
