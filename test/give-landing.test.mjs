// give.timothystl.org — the standalone giving page. Run with:
//
//   node test/give-landing.test.mjs
//
// Renders the real page through renderGiveLandingHtml() and lays it out in a real
// browser at three widths, because the thing being asserted here is a LAYOUT fact
// (which block comes first on a phone) that no amount of string-matching on the
// markup can tell you — the DOM order is deliberately the opposite of the visual
// order below the breakpoint, and only a layout engine knows that.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { renderGiveLandingHtml, FALLBACK_TIERS, FALLBACK_BASE_URL, FALLBACK_FUNDS } from '../give-landing.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };
const group = (n) => console.log('\n' + n);

const html = renderGiveLandingHtml(FALLBACK_TIERS, FALLBACK_BASE_URL, FALLBACK_FUNDS);
const file = path.join('/tmp', 'give-landing-test.html');
writeFileSync(file, html);

const browser = await chromium.launch();

/** Where the two columns of .give-row actually sit at a given viewport width. */
async function layoutAt(width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto('file://' + file);
  const box = await page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { top: Math.round(b.top), left: Math.round(b.left) };
    };
    return { widget: r('.widget-col'), ladder: r('.ladder-col') };
  });
  await page.close();
  return {
    ...box,
    stacked: Math.abs(box.widget.left - box.ladder.left) < 5,
    widgetFirst: box.widget.top < box.ladder.top,
  };
}

group('on a phone, the giving widget comes before the case for giving');
{
  // Someone arriving to give should not have to scroll past the whole ministry ladder to
  // reach the button. The two columns are in the other order in the DOM (the ladder reads
  // as the left column on a desktop), so this is done with `order` in the phone media
  // query — which means a source-order check would pass while the page was still wrong.
  const phone = await layoutAt(390);
  ok(phone.stacked, 'the two columns stack into one at 390px');
  ok(phone.widgetFirst, 'and "Give to Timothy" is the first of them');

  const small = await layoutAt(820);
  ok(small.stacked && small.widgetFirst, 'same at 820px, still under the 900px breakpoint');
}

group('on a desktop it is still two columns, ladder on the left');
{
  const desktop = await layoutAt(1280);
  ok(!desktop.stacked, 'the columns sit side by side at 1280px');
  ok(desktop.ladder.left < desktop.widget.left, 'with the ladder on the left, as designed');
  ok(Math.abs(desktop.ladder.top - desktop.widget.top) < 5, 'and both starting at the same height');
}

group('the page still transacts');
{
  // Cheap guard on the thing that actually matters about this page: the CTA carries a real
  // Tithe.ly link with the amount in CENTS. A layout change should never quietly break it.
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.goto('file://' + file);
  const href = await page.getAttribute('#give-cta', 'href');
  await page.close();
  const defaultTier = FALLBACK_TIERS.find((t) => t.isDefault) || FALLBACK_TIERS[0];
  ok(/give\.tithe\.ly/.test(href), 'the Give button points at Tithe.ly');
  ok(new URL(href).searchParams.get('amount') === String(defaultTier.amount * 100),
     `and prefills ${defaultTier.amount * 100} cents for the $${defaultTier.amount} default`);
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
