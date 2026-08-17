// The block editor's inline rich field actually closes.
//   node --experimental-loader ./test/html-loader.mjs test/editor-richfield-close.test.mjs
//
// Dinger: "After I click in a text field box and want to leave it the font
// text selector panel stays up." Confirmed by driving the real admin worker
// against the real vendored TinyMCE (no stub — a stub would not have caught
// this): TinyMCE's own 'blur' event never fires at all in this inline,
// multiple-editors-per-page embedding, so the teardown that used to live on
// `ed.on('blur', …)` in admin/ministry-editor.html never ran, and a field's
// floating toolbar stayed on screen for the rest of the session — one more
// added per field ever clicked into.
//
// ⚠ THE REPLACEMENT IS A NATIVE `focusout` LISTENER, NOT A DIFFERENT TINYMCE
// EVENT — measured directly, native `focusout` fires reliably in every case
// tried, including moving focus from one inline editor straight into a
// second one on the same canvas, where TinyMCE's own 'blur' never fires.
// ⚠ AND IT HAS TO IGNORE FOCUS MOVING INTO THE EDITOR'S OWN UI. Opening the
// Link dialog also fires a native `focusout` — its address field lives
// outside the contenteditable, in a `.tox-dialog` — so a naive "any focusout
// closes the field" would tear the editor down out from under a dialog that
// still references it. Toolbar buttons need no such guard: TinyMCE already
// prevents them from taking focus, so clicking Bold never fires focusout at
// all — confirmed here too, since a version of this fix that broke that
// would still show a green run everywhere else.
import http from 'node:http';
import path from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import worker from '../tlc-admin-worker.js';
import { TINYMCE_VERSION } from '../admin/db.js';
import { newBlock, sanitizeBlocks } from '../admin/blocks.js';
import { ALL_PERMISSIONS } from '../admin/auth.js';

const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr, 'x.js'))('playwright');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { try { return db.prepare(sql).get(...args) ?? null; } catch (e) { throw e; } },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async (s) => Promise.all(s.map((x) => x.run())), exec: async (sql) => { db.exec(sql); } };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
globalThis.fetch = async () => new Response('{}', { status: 200 });

const db = new DatabaseSync(':memory:');
const env = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test' };
await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx);

const token = '11'.repeat(32);
db.prepare('INSERT INTO users (username, password_hash, permissions, created_at, active) VALUES (?,?,?,?,1)')
  .run('dinger', 'pbkdf2:1:x:y', JSON.stringify(ALL_PERMISSIONS), new Date().toISOString());
const uid = db.prepare('SELECT id FROM users WHERE username = ?').get('dinger').id;
db.prepare('INSERT INTO sessions (token, user_id, username, permissions, expires_at, created_at) VALUES (?,?,?,?,?,?)')
  .run(token, uid, 'dinger', JSON.stringify(ALL_PERMISSIONS), new Date(Date.now() + 86400000).toISOString(), new Date().toISOString());

const blocks = sanitizeBlocks([
  newBlock('text', { body: '<p>Opening paragraph with some text to select.</p>' }),
  newBlock('text', { body: '<p>Second paragraph.</p>' }),
]);
db.prepare("UPDATE pages SET blocks = ? WHERE id = 'about'").run(JSON.stringify(blocks));

// The real vendored library, served locally — no network, no stub. A stub
// TinyMCE cannot reproduce this bug: it lives entirely inside the real
// library's own focus/blur internals.
const vendor = new URL('../admin/vendor/tinymce/', import.meta.url);
const TYPES = { '.js': 'text/javascript', '.css': 'text/css' };

const srv = http.createServer(async (q, r) => {
  const url = decodeURIComponent(q.url.split('?')[0]);
  if (url.startsWith('/assets/tinymce/')) {
    let rel = url.slice('/assets/tinymce/'.length);
    const v = /^(\d+\.\d+\.\d+)\/(.*)$/.exec(rel);
    if (v) { if (v[1] !== TINYMCE_VERSION) { r.writeHead(404); return r.end('nf'); } rel = v[2]; }
    const f = new URL('./' + rel, vendor);
    if (existsSync(f) && statSync(f).isFile()) {
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(url)] || 'application/octet-stream' });
      return r.end(readFileSync(f));
    }
    r.writeHead(404); return r.end('nf');
  }
  const res = await worker.fetch(new Request('https://admin.timothystl.org' + q.url, {
    headers: { cookie: 'tlc_session=' + token, origin: 'https://admin.timothystl.org' },
  }), env, ctx);
  const body = await res.arrayBuffer();
  r.writeHead(res.status, { 'Content-Type': res.headers.get('content-type') || 'text/html' });
  r.end(Buffer.from(body));
});
await new Promise((r) => srv.listen(0, r));
const base = 'http://localhost:' + srv.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const p = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));

await p.goto(base + '/pages/about/edit', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.ed-paper .tlcb', { timeout: 15000 });

const bodies = await p.$$('.ed-paper [data-field="body"]');
eq(bodies.length, 2, 'two rich fields on the canvas');

const toolbarCount = () => p.$$eval('.tox-tinymce-inline', (els) => els.filter((e) => e.offsetParent !== null).length);
const contentBodyCount = () => p.$$eval('.mce-content-body', (els) => els.length);

group('a field closes when focus leaves it for empty canvas');
{
  await bodies[0].click();
  await p.waitForTimeout(1200);
  eq(await toolbarCount(), 1, 'opening one field shows one toolbar');

  const paper = await p.$('.ed-paper');
  const box = await paper.boundingBox();
  await p.mouse.click(box.x + 5, box.y + 5);
  await p.waitForTimeout(1200);
  eq(await toolbarCount(), 0, 'clicking empty canvas closes it — no toolbar left on screen');
  eq(await contentBodyCount(), 0, 'and the field is handed back as plain contenteditable, openable again');
}

group('a field closes when focus moves straight into a second field');
{
  await bodies[0].click();
  await p.waitForTimeout(1200);
  await bodies[1].click();
  await p.waitForTimeout(1200);
  eq(await toolbarCount(), 1, 'only the field actually in use shows a toolbar — the first one closed itself');
  eq(await contentBodyCount(), 1, 'confirmed by content-body count too, not just visible toolbars');
}

group('the Link dialog does not get torn down out from under itself');
{
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.ed-paper .tlcb', { timeout: 15000 });
  const b2 = await p.$$('.ed-paper [data-field="body"]');
  await b2[0].click();
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    const el = document.querySelector('.mce-content-body');
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('p') || el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await p.waitForTimeout(300);
  const opened = await p.evaluate(() => {
    const btn = document.querySelector('.tox-tinymce-inline [aria-label="Insert/edit link"], .tox-tinymce-inline [aria-label="Link"]');
    if (!btn) return false;
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((type) =>
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
    return true;
  });
  ok(opened, 'the link button was found and clicked');
  await p.waitForTimeout(800);
  eq(await p.$$eval('.tox-dialog', (els) => els.length), 1, 'the dialog opened');
  eq(await toolbarCount(), 1, 'and the editor is still there to insert the link into');
}

group('a toolbar button never closes the field it belongs to');
{
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.ed-paper .tlcb', { timeout: 15000 });
  const b3 = await p.$$('.ed-paper [data-field="body"]');
  await b3[0].click();
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    const el = document.querySelector('.mce-content-body');
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('p') || el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const btn = document.querySelector('.tox-tinymce-inline [aria-label="Bold"], .tox-tinymce-inline button[title="Bold"]');
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((type) =>
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
  });
  await p.waitForTimeout(500);
  eq(await toolbarCount(), 1, 'the field is still open after using a toolbar button');
  const bold = await p.$eval('.mce-content-body', (el) => el.innerHTML.includes('<strong>'));
  ok(bold, 'and the command actually ran');
}

eq(errors.length, 0, 'no page errors: ' + errors.join(' | '));

await browser.close();
srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
