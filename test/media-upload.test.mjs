// The Media screen's upload page, driven in a real browser — the drag-and-drop
// zone, the auto-picked kind chip, the "dropped anywhere else" guard, and the
// actual upload landing in the library. None of this shows up in a test that
// only reads the markup: a DragEvent has to be real for the dragover-vs-drop
// distinction (dataTransfer.files is empty until the drop lands) to mean
// anything, and the "does it actually save" question needs a real Worker
// behind it.
//   node --experimental-loader ./test/html-loader.mjs test/media-upload.test.mjs

import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import worker from '../tlc-admin-worker.js';

const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr, 'x.js'))('playwright');

function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    exec: async (sql) => { db.exec(sql); },
  };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const eq = (a, b, m) => ok(a === b, `${m} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

const db = new DatabaseSync(':memory:');
const stored = [];
const env = {
  DB: d1(db),
  // A real (if in-memory) R2 stand-in — the point of this suite is that an
  // upload actually reaches storage and the library, not that it's stubbed
  // into looking like it did.
  IMAGES: {
    put: async (key, body) => { stored.push({ key }); },
    get: async () => null, head: async () => null, delete: async () => {},
  },
};
await worker.fetch(new Request('https://admin.timothystl.org/login'), env, ctx);

const TOKEN = 'cd'.repeat(32);
const nowIso = new Date().toISOString();
db.prepare('INSERT INTO users (username,password_hash,permissions,created_at,active) VALUES (?,?,?,?,1)')
  .run('office', 'pbkdf2:1:x:y', JSON.stringify(['pages_edit']), nowIso);
const uid = db.prepare("SELECT id FROM users WHERE username='office'").get().id;
db.prepare('INSERT INTO sessions (token,user_id,username,permissions,expires_at,created_at) VALUES (?,?,?,?,?,?)')
  .run(TOKEN, uid, 'office', JSON.stringify(['pages_edit']), new Date(Date.now() + 864e5).toISOString(), nowIso);

const srv = http.createServer(async (q, r) => {
  const chunks = [];
  for await (const c of q) chunks.push(c);
  const res = await worker.fetch(new Request('https://admin.timothystl.org' + q.url, {
    method: q.method,
    headers: { ...q.headers, origin: 'https://admin.timothystl.org', cookie: `tlc_session=${TOKEN}` },
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  }), env, ctx);
  const body = Buffer.from(await res.arrayBuffer());
  const headers = { 'Content-Type': res.headers.get('content-type') || 'text/html' };
  if (res.headers.get('location')) headers.Location = res.headers.get('location');
  r.writeHead(res.status, headers);
  r.end(body);
});
await new Promise((r) => srv.listen(0, r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
if (process.env.DEBUG_MEDIA) {
  page.on('console', (m) => console.log('  [console]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
}

// Fires a real file drag at the dropzone. dragover has to be fired too — the
// handler's own dataTransfer.types check is the only thing readable before
// the drop lands, and skipping it would prove nothing about that path.
const dropFile = async (name, mimeType, text) =>
  page.evaluate(({ name, mimeType, text }) => {
    const zone = document.getElementById('media-dropzone');
    const dt = new DataTransfer();
    dt.items.add(new File([text], name, { type: mimeType }));
    for (const kind of ['dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, { name, mimeType, text });

try {
  await page.goto(BASE + '/media/upload', { waitUntil: 'networkidle' });

  group('the dropzone is real, not decoration');
  eq(await page.locator('#media-dropzone').count(), 1, 'the drop target exists');
  eq(await page.locator('#media-dropzone input[type=file]').count(), 1, 'with the file input inside it');

  group('dropping a photo lights it up, names it, and picks the Photo chip');
  await page.evaluate(() => {
    // The "file" chip stands in as the wrong default for this drop, so a
    // photo landing on "Photo" is worth proving rather than assuming.
    document.querySelector('input[name="kind"][value="file"]').checked = true;
  });
  await dropFile('garden.jpg', 'image/jpeg', 'fake-jpeg-bytes');
  eq(await page.locator('#media-dropzone-name').textContent(), 'garden.jpg', 'the dropped filename is shown');
  ok(await page.locator('input[name="kind"][value="photo"]').isChecked(), 'and the Photo chip is picked for it');

  group('dropping a PDF picks the File chip instead');
  await dropFile('minutes.pdf', 'application/pdf', 'fake-pdf-bytes');
  eq(await page.locator('#media-dropzone-name').textContent(), 'minutes.pdf', 'the new name replaces the old one');
  ok(await page.locator('input[name="kind"][value="file"]').isChecked(), 'and the File chip is picked for a PDF');

  group('a file dropped anywhere else on the page is swallowed, not followed');
  const wentAway = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'stray.jpg', { type: 'image/jpeg' }));
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    document.body.dispatchEvent(ev);
    return !ev.defaultPrevented;
  });
  ok(!wentAway, 'the window-level guard still prevents the default outside the zone');

  group('dropping a photo and submitting actually uploads it');
  await dropFile('pantry-shelf.jpg', 'image/jpeg', 'fake-jpeg-bytes');
  await page.fill('input[name="alt"]', 'Shelves at the food pantry');
  await page.click('button[type=submit]');
  await page.waitForFunction(() => location.href.includes('/media?msg=uploaded'), { timeout: 5000 });
  ok(stored.length >= 1, 'the file actually reached storage');
  const row = db.prepare("SELECT * FROM ministry_media WHERE filename LIKE 'news-%' OR filename LIKE '%pantry-shelf%' ORDER BY id DESC LIMIT 1").get();
  ok(row, 'and a library row was written');
  if (row) {
    eq(row.kind, 'photo', 'as a photo');
    eq(row.alt, 'Shelves at the food pantry', 'carrying the alt text that was typed');
  }

  group('a photo with no alt text refuses to submit');
  await page.goto(BASE + '/media/upload', { waitUntil: 'networkidle' });
  await dropFile('no-alt.jpg', 'image/jpeg', 'fake-jpeg-bytes');
  await page.click('button[type=submit]');
  await page.waitForTimeout(300);
  ok((await page.textContent('#media-upload-status') || '').toLowerCase().includes('describe'),
    'and says so, without ever navigating away');
  eq(page.url(), BASE + '/media/upload', 'still on the upload screen');
} finally {
  await browser.close();
  srv.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
