// The self-hosted TinyMCE actually boots, from the files in this repo.
//   node test/tinymce-selfhost.test.mjs
//
// This is the one suite that loads the REAL library rather than a stub. It can,
// because self-hosting is the whole point — there is no meter to spend and no
// account to bill. It serves public/tinymce/<version>/ off a local static
// server, points the loader at it, and opens a field.
//
// ⚠ THE ASSERTION THAT EARNS THIS SUITE is that every /assets/tinymce/ request
// comes back 200 AND as JavaScript or CSS. In production that route proxies
// raw.githubusercontent.com, so what arrives is whatever GitHub returned — a
// rate-limit page, a 404 body, an outage page — and only the content type
// distinguishes those from the file. Checking status codes alone would sail
// straight past it. The local server below serves a wrong-content-type body
// for anything missing, deliberately, so that is what a broken path looks
// like here too.
import http from 'node:http'; import path from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process';
const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr, 'x.js'))('playwright');
import { TINYMCE_VERSION, TINYMCE_BASE, TINYMCE_HEAD } from '../admin/db.js';
import { tinymceField, RICH_FIELD_JS, ADMIN_SHELL_CSS, ADMIN_CSP } from '../admin/helpers.js';

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/plain', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const vendor = new URL('../admin/vendor/tinymce/', import.meta.url);

const STORED = '<p>The office wrote this <strong>last week</strong>.</p>';
const CLASSIC = tinymceField({ id: 'pastor-editor', name: 'pastor_note', value: STORED, minHeight: 200, label: 'Your message this week' });

// The block editor's own config, inline mode, kept in step with
// admin/ministry-editor.html by the assertion in admin/tinymce-assets.test.mjs.
const INLINE_BOOT = `
window._onTinymce(function () {
  window.tinymce.init({
    target: document.getElementById('canvasField'),
    base_url: BASE, suffix: '.min', license_key: 'gpl',
    inline: true, menubar: false, statusbar: false, branding: false,
    plugins: 'lists link autolink',
    toolbar: 'bold italic underline | bullist numlist | link',
    valid_elements: 'p,br,strong/b,em/i,u,s,ul,ol,li,a[href|target|rel],h2,h3,h4,blockquote',
    link_default_target: '_blank',
    init_instance_callback: function (ed) { ed.focus(); window.__inlineReady = true; },
  });
});`;

const page = (base) => `<!doctype html><html><head><meta charset="utf-8">
<script>var BASE = '${base}';<\/script>
<style>${ADMIN_SHELL_CSS}</style>
${TINYMCE_HEAD.split(TINYMCE_BASE).join(base)}
</head><body>
<form method="POST" action="/save">${CLASSIC}<button type="submit" name="action" value="publish">Publish</button></form>
<div id="canvasField" data-rich="1" contenteditable="true"><p>Canvas text.</p></div>
<script>${RICH_FIELD_JS}<\/script>
<script>function bootInline(){${INLINE_BOOT}}<\/script>
</body></html>`;

let posted = null;
const srv = http.createServer((q, r) => {
  if (q.method === 'POST') {
    let body = ''; q.on('data', (c) => { body += c; });
    q.on('end', () => { posted = new URLSearchParams(body); r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('ok'); });
    return;
  }
  const url = decodeURIComponent(q.url.split('?')[0]);
  if (url.startsWith('/assets/tinymce/')) {
    let rel = url.slice('/assets/tinymce/'.length);
    const v = /^(\d+\.\d+\.\d+)\/(.*)$/.exec(rel);
    // The route in tlc-admin-worker.js strips the version segment the same way.
    if (v) { if (v[1] !== TINYMCE_VERSION) { r.writeHead(404); return r.end('nf'); } rel = v[2]; }
    const f = new URL('./' + rel, vendor);
    if (existsSync(f) && statSync(f).isFile()) {
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(url)] || 'application/octet-stream' });
      return r.end(readFileSync(f));
    }
    // ⚠ Imitating the proxy on purpose: what comes back for a missing file is
    // whatever the upstream said, not the file, and the content type is the
    // only thing that tells you.
    r.writeHead(200, { 'Content-Type': 'text/html' });
    return r.end('<!doctype html><html><body>not the file</body></html>');
  }
  // ⚠ THE REAL ADMIN CSP, not a paraphrase of it. This is what makes the
  // 'unsafe-eval' removal (FX-10) verifiable rather than asserted: the library
  // boots under the exact header a signed-in admin gets, and any policy
  // violation it provokes is recorded below.
  r.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': ADMIN_CSP });
  r.end(page(TINYMCE_BASE));
});
await new Promise((r) => srv.listen(0, r));
const base = 'http://localhost:' + srv.address().port;

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const p = await (await b.newContext()).newPage();
const errs = []; const logs = []; const assets = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
// Every CSP violation the page provokes, collected before anything navigates.
// addInitScript runs in each new document BEFORE its own scripts, so a
// violation raised while TinyMCE is still booting is still caught.
const csp = [];
await p.exposeFunction('__cspViolation', (d) => { csp.push(d); });
await p.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolation({ directive: e.violatedDirective, blocked: e.blockedURI, sample: (e.sample || '').slice(0, 120) });
  });
});
const offsite = [];
p.on('request', (req) => {
  const u = new URL(req.url());
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') offsite.push(u.href);
});
p.on('response', async (res) => {
  const u = new URL(res.url());
  if (u.pathname.startsWith('/assets/tinymce/')) assets.push({ path: u.pathname, status: res.status(), type: res.headers()['content-type'] || '' });
});

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const group = (n) => console.log('\n' + n);

await p.goto(base);
await p.waitForTimeout(200);

group('the library is not fetched until a field is opened');
ok(assets.length === 0, 'nothing under /assets/tinymce/ requested on load — got ' + assets.map((a) => a.path).join(', '));

group('opening a field boots the real editor from our own files');
await p.locator('.tlc-rich-view').first().click();
await p.waitForSelector('.tox-tinymce', { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(900);

ok(await p.locator('.tox-tinymce').count() > 0, 'the editor chrome rendered');
ok(assets.length > 0, 'and it pulled its own assets: ' + assets.length + ' requests');

group('every asset is what it claims to be, not an error page');
for (const a of assets) {
  ok(a.status === 200, a.path + ' → ' + a.status);
  ok(!/text\/html/.test(a.type), a.path + ' came back as HTML — that is not the file — an error page or a rate limit reached the browser instead');
}
ok(assets.some((a) => a.path.endsWith('/tinymce.min.js')), 'the library itself');
ok(assets.some((a) => a.path.includes('/themes/silver/')), 'the theme');
ok(assets.some((a) => a.path.includes('/models/dom/')), 'the model');
ok(assets.some((a) => a.path.includes('/skins/ui/oxide/skin')), 'the skin');
ok(assets.some((a) => a.path.includes('/icons/default/')), 'the icons');

group('nothing reaches for Tiny at all');
{
  // ⚠ The paid Tiny plan is CANCELLED (2026-08-07). The open-source build has
  // no key and no phone-home, and this asserts that against the real library
  // rather than against the source: a boot that quietly contacted tiny.cloud
  // would now be contacting an account that no longer exists, and the symptom
  // would be a license notice over the editor rather than anything in a log.
  ok(offsite.length === 0, 'no request left this origin during a full boot: ' + offsite.join(' | '));
  ok(!offsite.some((u) => u.includes('tiny.cloud')), 'and none of them to tiny.cloud');
}

group('the open-source build starts clean');
ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));
// TinyMCE 7 shouts about a missing license key. If this fires, license_key: 'gpl' is not reaching init.
const license = logs.filter((l) => /licen[cs]e/i.test(l));
ok(license.length === 0, 'no license complaint: ' + license.join(' | '));
// Checked rather than configured: the community build draws no Upgrade
// button with menubar off, so `promotion: false` is not needed.
ok(await p.locator('.tox-promotion').count() === 0, 'no "Upgrade" promotion in the chrome');
ok(await p.locator('.tox-notification').count() === 0, 'no warning notification over the editor');

group('every configured plugin actually loaded');
{
  // A button is only drawn if its plugin registered it, so this is the real
  // check that link/image/table/code arrived and started — not just that a file
  // was fetched. `data-mce-name` is the toolbar item's own id.
  const names = await p.$$eval('.tox-toolbar button, .tox-toolbar__primary button',
    (ns) => ns.map((n) => n.getAttribute('data-mce-name')));
  for (const n of ['bold', 'italic', 'underline', 'bullist', 'numlist', 'undo', 'redo', 'blocks',
                   'alignleft', 'aligncenter', 'alignright', 'link', 'image', 'table', 'code']) {
    ok(names.includes(n), 'toolbar button: ' + n + ' — have ' + names.join(','));
  }
}

group('the block editor\u2019s inline config boots too');
{
  // ⚠ Before the form submit below, which navigates the page away.
  const before = assets.length;
  await p.evaluate(() => window.bootInline());
  await p.waitForFunction(() => window.__inlineReady === true, null, { timeout: 20000 }).catch(() => {});
  ok(await p.evaluate(() => window.__inlineReady === true), 'the inline editor initialized');
  ok(await p.locator('#canvasField.mce-content-body').count() > 0, 'and marked the canvas field as its own');
  ok(await p.locator('.tox-tinymce-inline').count() > 0, 'with the floating toolbar, not a second editor frame');
  for (const a of assets.slice(before)) ok(!/text\/html/.test(a.type), a.path + ' came back as HTML');
  ok(errs.length === 0, 'still no page errors: ' + errs.join(' | '));
}

group('it holds the stored content, and saves what is typed');
const shown = await p.frameLocator('.tox-edit-area iframe').locator('body').innerHTML().catch(() => '');
ok(shown.includes('last week'), 'the editor opened on the real stored content: ' + shown.slice(0, 80));
ok(shown.includes('<strong>') || shown.includes('<b>'), 'with its formatting intact');

await p.frameLocator('.tox-edit-area iframe').locator('body').click();
await p.keyboard.type(' Added today.');
await p.waitForTimeout(200);
await p.click('button[type=submit]');
await p.waitForTimeout(600);
ok(posted !== null, 'the form reached the server');
ok((posted.get('pastor_note') || '').includes('Added today.'), 'the typed text was saved: ' + (posted.get('pastor_note') || '').slice(0, 90));
ok((posted.get('pastor_note') || '').includes('last week'), 'and the original text survived');

await b.close(); srv.close();
group('it boots under the real admin CSP, with no unsafe-eval (FX-10)');
// ⚠ THE POINT OF THIS GROUP IS THE ABSENCE OF 'unsafe-eval'. The header the
// page above was served IS admin/helpers.js's ADMIN_CSP — so if TinyMCE, its
// plugins, or the shell's own scripts ever reach for eval or new Function,
// script-src refuses it and a violation lands in `csp`. Everything already
// asserted above — the editor opening on stored content, the toolbar buttons,
// the save — ran under that header, so a green suite is the evidence.
ok(!/unsafe-eval/.test(ADMIN_CSP), "the admin CSP does not allow 'unsafe-eval'");
ok(/frame-ancestors 'none'/.test(ADMIN_CSP), 'and it states frame-ancestors outright, which does not inherit from default-src');
ok(/base-uri 'none'/.test(ADMIN_CSP), 'and base-uri, so an injected base tag cannot re-point every relative asset');
ok(csp.length === 0, 'no CSP violation fired while the real library booted: ' + JSON.stringify(csp).slice(0, 300));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
