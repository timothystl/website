// Phase 6 — publish, schedule, revision history, restore.
//   node test/editor-publish.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createEditorServer } from './editor-server.mjs';
import { newBlock, sanitizeBlocks, parseBlocks, renderPage } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const seed = sanitizeBlocks([newBlock('hero'), newBlock('text'), newBlock('faq')]);
const harness = createEditorServer({ pages: [{ slug: 'music', title: 'Music Ministry', blocks: seed }] });
await new Promise((r) => harness.server.listen(0, r));
const base = 'http://localhost:' + harness.server.address().port;
const row = () => harness.pages.get('music');

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()); });
await page.route('https://**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));

const load = async () => {
  await page.goto(base + '/ministries/editor/music', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb');
  await page.click('#edHintX').catch(() => {});
};
await load();

group('an edit becomes a draft');
await page.click('.ed-paper .tlcb--text [data-field="body"]');
await page.keyboard.press('Control+A');
await page.keyboard.type('Fresh copy for the music page.');
await page.click('.ed-paper .tlcb--hero');
await page.waitForTimeout(2100);
ok((await page.textContent('#edPill')).startsWith('Draft'), 'status pill says Draft');
eq(row().page_status, 'draft', 'server marks the page a draft');
ok(parseBlocks(row().published_blocks).every((b) => !JSON.stringify(b).includes('Fresh copy')), 'the live version is untouched');

group('publish');
await page.click('#edPublish');
await page.waitForSelector('.ed-toast');
ok((await page.textContent('.ed-toast')).includes('timothystl.org/music'), 'toast names the page it went to');
await page.waitForTimeout(300);
eq(await page.textContent('#edPill'), 'Published', 'status returns to Published');
ok((await page.textContent('#edChanges')).includes('Nothing since the last publish'), 'the change log is cleared');
eq(row().page_status, 'live', 'server marks the page live');
ok(JSON.stringify(parseBlocks(row().published_blocks)).includes('Fresh copy'), 'the edit is now what the public site renders');
eq(harness.revisions.length, 1, 'publishing snapshots a revision');
await page.waitForTimeout(2900);
eq(await page.locator('.ed-toast').count(), 0, 'the toast dismisses itself');

group('the published page really is what the editor showed');
{
  // Comparing raw HTML against a browser-serialised DOM is a losing game
  // (attribute order, entities, whitespace). What has to hold is that the
  // published blocks are the ones the canvas is showing, and that rendering
  // them publicly produces the same content without any editor chrome.
  const published = parseBlocks(row().published_blocks);
  const canvasTypes = await page.$$eval('.ed-paper .tlcb', (ns) => ns.map((n) => n.dataset.type));
  eq(JSON.stringify(canvasTypes), JSON.stringify(published.map((b) => b.type)), 'same blocks in the same order as the canvas');
  const canvasIds = await page.$$eval('.ed-paper .tlcb', (ns) => ns.map((n) => n.dataset.id));
  eq(JSON.stringify(canvasIds), JSON.stringify(published.map((b) => b.id)), 'and the very same blocks, not lookalikes');
  // drop the stylesheet — it mentions [contenteditable] in a rule and would
  // otherwise match the checks below
  const publicHtml = renderPage(published, { slug: 'music' }).replace(/<style[\s\S]*?<\/style>/, '');
  ok(publicHtml.includes('Fresh copy for the music page.'), 'the edited copy is in the public render');
  ok(!publicHtml.includes('contenteditable'), 'the public render carries no editable fields');
  ok(!publicHtml.includes('data-act='), 'and no editor toolbars');
  const canvasText = await page.locator('.ed-paper').innerText();
  ok(canvasText.includes('Fresh copy for the music page.'), 'and it is what the canvas is showing');
}

group('publishing options panel');
await page.click('#edMore');
await page.waitForSelector('.ed-panel');
eq(await page.getAttribute('#edMore', 'aria-expanded'), 'true', 'the button reports its state');
ok((await page.textContent('.ed-panel')).includes('Everything is published'), 'the panel says where the page stands');
ok(await page.locator('.ed-panel a[href$="/music"]').count() > 0, 'offers a compare-with-live link');
ok(await page.locator('.ed-rev').count() === 1, 'the revision just published is listed');
await page.keyboard.press('Escape');
eq(await page.locator('.ed-panel').count(), 0, 'Escape closes the panel');

group('scheduling');
await page.click('.ed-paper .tlcb--text [data-field="body"]');
await page.keyboard.press('Control+A');
await page.keyboard.type('Copy that should wait until Sunday.');
await page.click('.ed-paper .tlcb--hero');
await page.waitForTimeout(2100);
await page.click('#edMore');
await page.waitForSelector('.ed-panel');
// a time in the past must be refused
await page.fill('#edWhen', '2020-01-01T06:00');
await page.click('#edSchedule');
await page.waitForSelector('.ed-toast');
ok((await page.textContent('.ed-toast')).includes('future'), 'a date in the past is refused');
eq(row().page_status, 'draft', 'and nothing was scheduled');
await page.waitForTimeout(2800);
const future = new Date(Date.now() + 36e5);
const pad = (n) => String(n).padStart(2, '0');
const localValue = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
await page.fill('#edWhen', localValue);
await page.click('#edSchedule');
await page.waitForTimeout(500);
eq(row().page_status, 'scheduled', 'the page is scheduled');
ok((await page.textContent('#edPill')).startsWith('Scheduled'), 'the pill shows the scheduled time');
ok(Math.abs(new Date(row().publish_at) - future) < 61000, 'the local wall-clock time was converted correctly');
ok(!JSON.stringify(parseBlocks(row().published_blocks)).includes('until Sunday'), 'the live page has not changed yet');
await page.click('#edUnschedule');
await page.waitForTimeout(400);
eq(row().page_status, 'draft', 'a schedule can be cancelled');
eq(row().publish_at, null, 'and the time is cleared');

group('restore an earlier version');
await page.click('#edPublish');
await page.waitForTimeout(600);
eq(harness.revisions.length, 2, 'two revisions now');
await load();
await page.click('#edMore');
await page.waitForSelector('.ed-rev');
eq(await page.locator('.ed-rev').count(), 2, 'both revisions listed, newest first');
await page.locator('.ed-rev').nth(1).locator('[data-restore]').click(); // the older one
await page.waitForSelector('.ed-toast');
ok((await page.textContent('.ed-toast')).includes('draft'), 'restoring says it loaded a draft');
await page.waitForTimeout(400);
ok((await page.locator('.ed-paper').innerHTML()).includes('Fresh copy'), 'the older wording is back on the canvas');
eq(row().page_status, 'draft', 'restoring leaves the page as a draft');
ok(JSON.stringify(parseBlocks(row().published_blocks)).includes('until Sunday'), 'and never touches the live page directly');

group('scheduled pages are promoted when due');
{
  const post = (body) => fetch(base + '/ministries/api/page/music/schedule', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  // Put a distinctive draft in place and schedule it for a moment already past.
  await fetch(base + '/ministries/api/page/music/draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks: sanitizeBlocks([newBlock('text', { body: '<p>The scheduled version.</p>' })]), changes: [] }),
  });
  await post({ publish_at: new Date(Date.now() + 36e5).toISOString() });
  eq(row().page_status, 'scheduled', 'page is scheduled');
  row().publish_at = new Date(Date.now() - 60000).toISOString(); // its moment arrives

  const before = harness.revisions.length;
  const out = await (await fetch(base + '/__promote-scheduled', { method: 'POST' })).json();
  eq(out.promoted, 1, 'the promotion run picks up the due page');
  eq(row().page_status, 'live', 'and marks it live');
  eq(row().publish_at, null, 'and clears the scheduled time');
  ok(JSON.stringify(parseBlocks(row().published_blocks)).includes('scheduled version'), 'the waiting draft is what got published');
  eq(harness.revisions.length, before + 1, 'a scheduled publish is snapshotted too');
  eq(harness.revisions[harness.revisions.length - 1].published_by, 'scheduled', 'and attributed to the schedule');

  const again = await (await fetch(base + '/__promote-scheduled', { method: 'POST' })).json();
  eq(again.promoted, 0, 'a second run does not republish it');
}

eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

await browser.close();
harness.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
