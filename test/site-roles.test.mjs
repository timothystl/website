// Roles and locked blocks. Office staff can do everything; a ministry leader
// edits the page they were handed and nothing else. The interesting part is
// that the limits are real — the server refuses, it is not just a hidden
// button — so each one is checked by calling the API directly as well.
//
//   node test/site-roles.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createEditorServer } from './editor-server.mjs';
import { newBlock } from '../admin/blocks.js';

const globalRoot = (process.env.NODE_PATH || execSync('npm root -g').toString()).trim().split(path.delimiter)[0];
const { chromium } = createRequire(path.join(globalRoot, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const seedPages = () => [
  { slug: 'home', title: 'Home', path: '/', template: 'home', blocks: [newBlock('hero', { title: 'Welcome' })] },
  { slug: 'youth', title: 'Youth', path: '/youth', owner_username: 'youthdirector', blocks: [
    newBlock('alert', { id: 'locked-notice', body: 'Services move to 8:00 and 11:00', locked: true }),
    newBlock('text', { body: '<p>Youth copy</p>' }),
  ] },
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });

async function harnessFor(role) {
  const h = createEditorServer({ pages: seedPages(), role });
  await new Promise((r) => h.server.listen(0, r));
  const base = 'http://localhost:' + h.server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !String(u).includes('localhost'), (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { h, base, ctx, page, errors };
}

const open = async (page, base, id) => {
  await page.goto(base + '/pages/' + id + '/edit', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ed-paper .tlcb', { timeout: 8000 });
  await page.waitForTimeout(200);
};

group('office staff: the full Page tab, and the lock is theirs to set');
{
  const { h, base, ctx, page, errors } = await harnessFor('office');
  await open(page, base, 'youth');
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));
  await page.click('#edTabPage');
  await page.waitForTimeout(150);
  eq(await page.locator('#edPageTitle').isEditable(), true, 'the office can rename a page');
  eq(await page.locator('#edPageOwner').count(), 1, 'and hand it to someone');
  eq(await page.locator('#edPageOwner').inputValue(), 'youthdirector', 'showing who has it now');
  eq(await page.locator('#edPageDelete').count(), 1, 'and delete it');

  // the lock checkbox is the office's own control
  await page.click('.ed-paper .tlcb--text');
  await page.waitForTimeout(200);
  const lock = page.locator('#edInspBody input[data-in="locked"]');
  eq(await lock.count(), 1, 'the office sees the lock control');
  eq(await lock.isChecked(), false, 'an ordinary block is not locked');
  await lock.check();
  await page.waitForTimeout(400);
  eq(await page.locator('.ed-row').nth(1).locator('.ed-row-tag').count(), 1, 'locking marks the rail row');
  // and the office can still take a locked block out
  await page.click('.ed-paper .tlcb--alert');
  await page.waitForTimeout(200);
  const before = await page.locator('.ed-paper .tlcb').count();
  await page.click('.ed-paper .tlcb.is-sel [data-act="del"]');
  await page.waitForTimeout(600);
  eq(await page.locator('.ed-paper .tlcb').count(), before - 1, 'the office can delete a locked block');
  await ctx.close(); h.server.close();
}

group('a ministry leader: their page, their words, not the site structure');
{
  const { h, base, ctx, page, errors } = await harnessFor('own');
  await open(page, base, 'youth');
  eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

  await page.click('#edTabPage');
  await page.waitForTimeout(150);
  eq(await page.locator('#edPageTitle').isEditable(), false, 'the page name is shown but not editable');
  eq(await page.locator('#edPageOwner').count(), 0, 'they cannot hand the page to someone else');
  eq(await page.locator('#edPageDelete').count(), 0, 'and there is no delete button');
  eq(await page.locator('.ed-menu-opts').count(), 0, 'menu placement is not theirs to change');
  ok((await page.textContent('#edInspBody')).includes('set by the church office'), 'and it says why');

  // the words on the page are still theirs
  await page.click('.ed-paper .tlcb--text [data-field="body"]');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Rewritten by the youth director');
  await page.click('.ed-paper .tlcb--alert');
  await page.waitForTimeout(200);
  ok((await page.textContent('.ed-paper')).includes('Rewritten by the youth director'), 'they can rewrite the page');

  // the locked block is marked and refuses to be deleted
  eq(await page.locator('.ed-row').first().locator('.ed-row-tag').count(), 1, 'the locked block is marked in the rail');
  eq(await page.locator('#edInspBody input[data-in="locked"]').count(), 0, 'they do not get the lock control');
  const before = await page.locator('.ed-paper .tlcb').count();
  await page.click('.ed-paper .tlcb--alert [data-act="del"]');
  await page.waitForTimeout(500);
  eq(await page.locator('.ed-paper .tlcb').count(), before, 'deleting a locked block does nothing');
  ok((await page.textContent('#edToast')).includes('church office'), 'and says why');

  // the server refuses the same things, whatever the browser sends
  const asApi = (p, body) => page.evaluate(async ([p, body]) => {
    const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.status;
  }, [p, body]);
  eq(await asApi('/pages/api/page/youth/settings', { title: 'Renamed anyway' }), 403,
    'the server refuses a rename however it is asked');
  eq(await asApi('/pages/api/page/youth/delete', {}), 403, 'and refuses a delete');
  eq(await asApi('/pages/api/page/youth/draft', { blocks: [newBlock('text', { body: '<p>only this</p>' })], changes: [] }), 403,
    'and refuses a save that drops the locked block');
  // …but an ordinary save, keeping the locked block, is fine
  const keepAll = await page.evaluate(() => Array.from(document.querySelectorAll('.ed-paper .tlcb')).map((e) => e.dataset.id));
  eq(await asApi('/pages/api/page/youth/draft', { blocks: keepAll.map((id) => ({ id, type: 'text', locked: id === 'locked-notice' })), changes: [] }), 200,
    'a save that keeps the locked block is accepted');
  await ctx.close(); h.server.close();
}

group('keyboard: undo');
{
  const { h, base, ctx, page } = await harnessFor('office');
  await open(page, base, 'youth');
  const before = await page.locator('.ed-paper .tlcb').count();
  await page.click('.ed-paper .tlcb--text');
  await page.waitForTimeout(150);
  await page.click('.ed-paper .tlcb.is-sel [data-act="del"]');
  await page.waitForTimeout(600);
  eq(await page.locator('.ed-paper .tlcb').count(), before - 1, 'a block is deleted');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(700);
  eq(await page.locator('.ed-paper .tlcb').count(), before, 'Ctrl+Z brings it back');
  // typing inside a field keeps the browser's own undo
  await page.click('.ed-paper .tlcb--text [data-field="body"]');
  await page.waitForTimeout(150);
  await page.keyboard.type('abc');
  const n = await page.locator('.ed-paper .tlcb').count();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  eq(await page.locator('.ed-paper .tlcb').count(), n, 'undo inside a field does not undo the last block change');
  await ctx.close(); h.server.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
