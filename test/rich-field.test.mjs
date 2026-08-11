// The rich-text field, opened by hand, in a real browser.
//   node test/rich-field.test.mjs
//
// ⚠ WHY THIS EXISTS. TinyMCE Cloud bills by EDITOR LOAD, and an editor load is
// one *instance* finishing its init — not one page view. Every rich field in
// this admin used to initialize at page load, so opening the newsletter
// composer spent nine of them before anybody typed a word. Fields are now
// closed until somebody opens one, and that saving is only real if the closed
// state still holds the right content and the open state still edits and saves
// it. Both halves are measured here.
//
// ⚠ NOTHING HERE LOADS TinyMCE. The stub below stands in for the library, so
// running this suite costs zero editor loads against the church's account —
// which would be a peculiar way to test a change made to stop spending them.
// What is under test is the activation and the fallback, not TinyMCE itself.
import http from 'node:http'; import path from 'node:path';
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process';
const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr, 'x.js'))('playwright');
import { tinymceField, RICH_FIELD_JS, ADMIN_SHELL_CSS } from '../admin/helpers.js';

const STORED = '<p>Dear friends, <strong>thank you</strong> for a generous month.</p>';

// Two fields, because the saving comes from the ones nobody opens: the second
// has to reach the server untouched while the first is being edited.
const form = `<form method="POST" action="/save">
  ${tinymceField({ id: 'pastor-editor', name: 'pastor_note', value: STORED, minHeight: 200, label: 'Your message this week' })}
  ${tinymceField({ id: 'quick-editor', name: 'quick_body', value: '<p>Second note.</p>', minHeight: 140, label: 'Quick note' })}
  <button type="submit" name="action" value="publish">Publish</button>
</form>`;

// `mode=stub` gives the page a _onTinymce that resolves to a fake library, so
// the upgrade path runs without a network call. `mode=dead` gives it one that
// never resolves at all — a blocked CDN, an ad blocker, an outage.
const page = (mode) => `<!doctype html><html><head><meta charset="utf-8"><style>${ADMIN_SHELL_CSS}</style>
<script>
window._tinyInits = 0;
${mode === 'dead' ? '' : `
window._onTinymce = function (fn) { setTimeout(fn, 0); };
window.tinymce = {
  editors: [],
  init: function (cfg) {
    window._tinyInits++;
    var ta = cfg.target;
    var ed = {
      el: ta,
      value: ta.value,
      getElement: function () { return ta; },
      focus: function () { ta.dataset.tinyFocused = '1'; },
      save: function () { ta.value = ed.value; },
      uploadImages: function () { return Promise.resolve([]); },
    };
    ta.dataset.tinyOn = '1';
    window.tinymce.editors.push(ed);
    if (cfg.init_instance_callback) cfg.init_instance_callback(ed);
  },
};`}
<\/script>
</head><body>${form}<script>${RICH_FIELD_JS}<\/script></body></html>`;

let posted = null;
const srv = http.createServer((q, r) => {
  if (q.method === 'POST') {
    let body = '';
    q.on('data', (c) => { body += c; });
    q.on('end', () => { posted = new URLSearchParams(body); r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<p>saved</p>'); });
    return;
  }
  r.writeHead(200, { 'Content-Type': 'text/html' });
  r.end(page(q.url.includes('dead') ? 'dead' : 'stub'));
});
await new Promise((r) => srv.listen(0, r));
const base = 'http://localhost:' + srv.address().port;

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext();
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const group = (n) => console.log('\n' + n);

// ── closed is the default, and it costs nothing ──────────────────────────────
group('a field starts closed');
await p.goto(base);
await p.waitForTimeout(150);

ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
ok(await p.evaluate(() => window._tinyInits) === 0,
  'no editor is created at page load — this is the whole saving');
ok((await p.$$('[data-rich]')).length === 2, 'both fields rendered');
ok(await p.locator('#pastor-editor').isHidden(), 'the textarea is out of the way');
ok(await p.locator('.tlc-rich-view').first().isVisible(), 'and a preview of the content stands in for it');
ok((await p.locator('.tlc-rich-view').first().innerText()).includes('thank you'),
  'the preview shows what is actually in the field, not a placeholder');
ok(await p.locator('.tlc-rich-view').first().evaluate((n) => n.querySelector('strong') !== null),
  'with its formatting, so a closed field is readable at a glance');

// A preview that is 200px of blank space with a caret icon would be a worse
// screen than the one this replaced — and one that grows with a long note
// would move the rest of the form the moment it was opened.
const h = await p.locator('.tlc-rich-view').first().evaluate((n) => n.getBoundingClientRect().height);
ok(Math.round(h) === 200, 'a closed field is exactly the height its editor will be: ' + Math.round(h));
const h2 = await p.locator('.tlc-rich-view').nth(1).evaluate((n) => n.getBoundingClientRect().height);
ok(Math.round(h2) === 140, 'each field keeps its own height rather than a shared one: ' + Math.round(h2));

// ── opening one ──────────────────────────────────────────────────────────────
group('opening one creates exactly one editor');
await p.locator('.tlc-rich-view').first().click();
await p.waitForTimeout(150);

ok(await p.evaluate(() => window._tinyInits) === 1,
  'one click, one editor — not one per field on the page');
ok(await p.locator('#pastor-editor').isVisible(), 'the textarea took the preview’s place');
ok(await p.locator('#pastor-editor').evaluate((n) => n.dataset.tinyOn === '1'),
  'and TinyMCE was pointed at that textarea');
ok(await p.locator('#pastor-editor').evaluate((n) => n.dataset.tinyFocused === '1'),
  'the caret lands in the field the person clicked, not somewhere else');
ok(await p.locator('#quick-editor').isHidden(),
  'the other field is untouched — opening one does not open them all');

// Opening the same field again must not create a second instance. The mount is
// marked, and that mark is what stops a double click costing twice.
await p.evaluate(() => {
  const v = document.querySelector('[data-rich]');
  if (v) v.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
});
await p.waitForTimeout(80);
ok(await p.evaluate(() => window._tinyInits) === 1, 'clicking an open field again creates nothing');

// ── what reaches the server ──────────────────────────────────────────────────
group('an unopened field submits what it was given');
await p.evaluate(() => {
  // Stand in for typing: the stub's save() copies this into the textarea, the
  // same contract TinyMCE's own editor.save() has.
  window.tinymce.editors[0].value = '<p>Rewritten by the pastor.</p>';
});
await p.click('button[type=submit]');
await p.waitForTimeout(300);

ok(posted !== null, 'the form reached the server');
ok(posted.get('pastor_note') === '<p>Rewritten by the pastor.</p>',
  'the opened field submits the edit: ' + posted.get('pastor_note'));
ok(posted.get('quick_body') === '<p>Second note.</p>',
  'and the field nobody opened submits its stored value byte for byte: ' + posted.get('quick_body'));
ok(posted.get('action') === 'publish',
  'the submit button’s own name survives the programmatic submit — Publish vs Save as draft turns on it');

// ── the library never arrives ────────────────────────────────────────────────
// ⚠ The field has to stay usable. Before this change the stored value only
// arrived via the init callback, so a blocked CDN meant opening a post and
// pressing Save wrote an empty body back over it.
group('a blocked CDN costs the toolbar, never the content');
posted = null;
const p2 = await ctx.newPage();
const errs2 = []; p2.on('pageerror', (e) => errs2.push(String(e)));
await p2.goto(base + '/?dead');
await p2.waitForTimeout(150);
ok(errs2.length === 0, 'no page errors with no TinyMCE at all: ' + errs2.join(' | '));

await p2.locator('.tlc-rich-view').first().click();
await p2.waitForTimeout(120);
ok(await p2.locator('#pastor-editor').isVisible(), 'the field still opens');
ok(await p2.evaluate(() => document.activeElement && document.activeElement.id) === 'pastor-editor',
  'still takes the caret');
ok(await p2.locator('#pastor-editor').inputValue() === STORED,
  'and still holds the real content rather than an empty box');

await p2.fill('#pastor-editor', '<p>Typed with no toolbar.</p>');
await p2.click('button[type=submit]');
await p2.waitForTimeout(300);
ok(posted && posted.get('pastor_note') === '<p>Typed with no toolbar.</p>', 'what was typed saves');
ok(posted && posted.get('quick_body') === '<p>Second note.</p>', 'and the untouched field is not blanked');

await b.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
