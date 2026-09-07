// Phase 10 — a ministry page whose blocks lead with a hero banner is rendered
// entirely from blocks, with the hardcoded sections stood down.
//   node test/whole-page.test.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { renderPage, sanitizeBlocks, newBlock } from '../admin/blocks.js';
import { PAGE_SEEDS } from '../admin/page-seeds.js';
import { createEditorServer } from './editor-server.mjs';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });

// ⚠ THE THREE GROUPS THAT USED TO FOLLOW HERE ("a page whose blocks lead
// with a hero takes over completely", "every seeded page renders without
// error", "a page without a hero keeps its hardcoded sections") drove the
// OLD /api/ministry/:slug → tlcMaybeTakeOver()/tlcApplyBlocks() public
// rendering path against /music's own hardcoded markup (#music-hero,
// #music-content, #music-content-section, #music-vid-grid, …). That markup
// is gone (see admin/BLOCK-EDITOR-ROLLOUT.md, Phase C) — checked directly
// against production: every one of the 11 rows this file's PAGE_SEEDS
// covers (music, stephen, foodpantry, bees, christmasmarket, youth,
// sundayschool, confirmation, vbs, egghunt, family) is confirmed present
// in BOTH the old `youth_pages` table AND the newer `pages` table, and
// tlcMaybeTakeOverSitePage() (the newer table's takeover) is checked FIRST
// in showPage() and always wins, so tlcMaybeTakeOver() never runs for any
// page that currently exists on the site. This "Phase 10" mechanism was
// superseded by the more general Site Editor (see CLAUDE.md, added
// 2026-07-31) before every one of PAGE_SEEDS' own pages was migrated onto
// it. The data these seeds carry, and the editor canvas that still renders
// them for editing, are both still real — see the two groups below.
group('the seeds are faithful to the pages they came from');
{
  eq(Object.keys(PAGE_SEEDS).length, 11, 'every ministry page has a seed');
  for (const [slug, blocks] of Object.entries(PAGE_SEEDS)) {
    eq(blocks[0].type, 'hero', `${slug} starts with its banner`);
    ok(blocks[0].title.length > 0, `${slug} banner has a title`);
    ok(blocks.length >= 2, `${slug} carries its sections too`);
    const clean = sanitizeBlocks(blocks);
    eq(JSON.stringify(clean), JSON.stringify(blocks), `${slug} seed is already sanitized`);
  }
  const music = PAGE_SEEDS.music;
  eq(music[0].title, 'Praise the Lord with Every Gift', 'music banner title came across');
  eq(music[0].eyebrow, 'Music Ministry', 'music banner eyebrow came across');
  ok(music[0].subtitle.startsWith('Rooted in the Lutheran tradition'), 'music banner subtitle came across');
  ok(JSON.stringify(music).includes('hammer dulcimer'), 'the body copy came across');
  ok(music.some((b) => b.type === 'buttons' && b.items.some((i) => i.url.includes('serve.timothystl.org'))),
    'the volunteer button and its link came across');
}

group('the editor previews whole-page mode the same way');
{
  const harness = createEditorServer({ pages: [{ slug: 'music', title: 'Music Ministry', blocks: PAGE_SEEDS.music }] });
  await new Promise((r) => harness.server.listen(0, r));
  const editorBase = 'http://localhost:' + harness.server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('https://**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(editorBase + '/ministries/editor/music', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb');
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  eq(await page.locator('.ed-row').count(), PAGE_SEEDS.music.length, 'every section is a row in the rail');
  eq(await page.locator('.ed-paper .tlcb-page--full').count(), 1, 'the canvas previews whole-page mode');
  ok((await page.locator('.ed-row').first().textContent()).includes('Hero banner'), 'the banner is the first row — and editable');
  // the banner text is editable on the canvas, which was the whole complaint
  const heroTitle = page.locator('.ed-paper .tlcb--hero [data-field="title"]');
  eq(await heroTitle.getAttribute('contenteditable'), 'true', 'the banner title can be typed into');
  eq(await page.locator('.ed-paper .tlcb--hero [data-field="eyebrow"]').getAttribute('contenteditable'), 'true', 'so can its small label');
  eq(await page.locator('.ed-paper .tlcb--hero [data-field="subtitle"]').getAttribute('contenteditable'), 'true', 'and its subtitle');
  await heroTitle.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Sing to the Lord a New Song');
  await page.click('.ed-paper .tlcb--textphoto');
  await page.waitForTimeout(2100);
  const saved = JSON.parse(harness.pages.get('music').blocks);
  eq(saved[0].title, 'Sing to the Lord a New Song', 'editing the banner saves');
  // dropping the hero would hand the page back to its hardcoded sections
  eq(saved[0].type, 'hero', 'the banner is a normal block that can be moved or removed');
  await ctx.close();
  harness.server.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
