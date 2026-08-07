// TinyMCE is self-hosted. This checks that every file the editor will ask for
// is actually in the repo.   node admin/tinymce-assets.test.mjs
//
// ⚠ WHY THIS IS NOT PARANOIA. On the cloud build a wrong asset path was a 404
// and a console warning nobody would ever see. Self-hosted it is worse, because
// `wrangler-site.toml` sets `not_found_handling = "single-page-application"`:
// a missing file under /tinymce/ returns **index.html with a 200**, so the
// browser feeds an entire HTML document into a <script> tag or a <link>. The
// editor breaks, the network tab shows nothing but 200s, and the console error
// points at the SPA rather than at the missing file.
//
// This repo has been bitten by exactly that SPA-200 behaviour before — it is
// why /scheduler.html needed a real redirect rather than being left to 404.
//
// `blockquote` sat in the classic field's plugin list for months and is not a
// TinyMCE plugin at all. Against the CDN it cost nothing. Here it would have
// been the first thing to break.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { TINYMCE_VERSION, TINYMCE_BASE, TINYMCE_SRC, TINYMCE_HEAD, TINYMCE_PLUGINS, TINYMCE_SELF_HOSTED } from './db.js';
import { RICH_FIELD_JS } from './helpers.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const group = (n) => console.log('\n' + n);

const root = new URL('../public/tinymce/' + TINYMCE_VERSION + '/', import.meta.url);
const at = (rel) => new URL(rel, root);
const there = (rel) => existsSync(at(rel));
const editorHtml = readFileSync(new URL('./ministry-editor.html', import.meta.url), 'utf8');

// The plugin list out of an init config, wherever it is written.
const pluginsIn = (src) => {
  const out = [];
  const re = /plugins:\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1].split(/\s+/).filter(Boolean));
  return out;
};

group('nothing points at the metered cloud any more');
{
  const files = ['./db.js', './helpers.js', './ministry-editor.html', '../tlc-admin-worker.js']
    .map((f) => [f, readFileSync(new URL(f, import.meta.url), 'utf8')]);
  for (const [name, src] of files) {
    // The comments explain the history, so only look at what ships as a URL.
    const live = src.replace(/^\s*\/\/.*$/gm, '');
    ok(!live.includes('cdn.tiny.cloud'), name + ' still loads TinyMCE from the cloud CDN');
    ok(!/tiny\.cloud\/1\//.test(live), name + ' still carries a cloud API key path');
  }
  ok(TINYMCE_SRC.startsWith('https://timothystl.org/tinymce/'), 'the script comes off our own site: ' + TINYMCE_SRC);
  ok(TINYMCE_HEAD.includes(TINYMCE_SRC), 'and that is the URL the loader actually uses');
}

group('the version lives in the path, not a query string');
{
  // TinyMCE derives its base URL from this script tag and loads the theme,
  // model, icons, skin and every plugin relative to it. A ?v= would be stripped
  // from those, so they would cache forever with no way to bust them.
  ok(!TINYMCE_SRC.includes('?'), 'no query string on the script src');
  ok(TINYMCE_BASE.endsWith('/' + TINYMCE_VERSION), 'the base URL ends in the version: ' + TINYMCE_BASE);
  ok(/^\d+\.\d+\.\d+$/.test(TINYMCE_VERSION), 'the version is a real version: ' + TINYMCE_VERSION);
  const site = readFileSync(new URL('../site-worker.js', import.meta.url), 'utf8');
  ok(/IMMUTABLE_RE\s*=\s*\/\^\\\/tinymce\\\/\\d\+\\\.\\d\+\\\.\\d\+\\\//.test(site),
    'the site worker recognises a versioned tinymce path');
  ok(site.includes('max-age=31536000, immutable'), 'and caches it immutably');
}

group('every file the editor will ask for is in the repo');
{
  // The loader fetches this one directly; TinyMCE fetches the rest itself.
  ok(there('tinymce.min.js'), 'tinymce.min.js');
  ok(there('models/dom/model.min.js'), 'the DOM model — TinyMCE will not start without it');
  ok(there('themes/silver/theme.min.js'), 'the silver theme');
  ok(there('icons/default/icons.min.js'), 'the default icon pack — every toolbar button is one of these');

  // skin: 'oxide' and content_css: 'default' in the configs.
  ok(there('skins/ui/oxide/skin.min.css'), 'the oxide skin');
  ok(there('skins/ui/oxide/content.min.css'), 'its content CSS, for the classic fields');
  ok(there('skins/ui/oxide/content.inline.min.css'), 'and its INLINE content CSS — the block editor is inline mode');
  ok(there('skins/content/default/content.min.css'), "content_css: 'default'");

  for (const p of TINYMCE_PLUGINS) ok(there('plugins/' + p + '/plugin.min.js'), 'plugin: ' + p);
}

group('no config asks for a plugin we did not vendor');
{
  const configs = [...pluginsIn(RICH_FIELD_JS), ...pluginsIn(editorHtml)];
  ok(configs.length >= 2, 'both init configs were found — ' + configs.length);
  for (const list of configs) {
    ok(list.length > 0, 'the config names at least one plugin');
    for (const p of list) {
      ok(TINYMCE_PLUGINS.includes(p), '"' + p + '" is in TINYMCE_PLUGINS');
      ok(there('plugins/' + p + '/plugin.min.js'), '"' + p + '" exists on disk');
    }
  }
  // The specific one that was wrong. Named, so nobody puts it back.
  const named = new Set(configs.flat());
  ok(!named.has('blockquote'), 'blockquote is gone — it was never a TinyMCE plugin');

  // And nothing vendored is dead weight, since every byte here is committed.
  for (const p of TINYMCE_PLUGINS) ok(named.has(p), 'vendored plugin "' + p + '" is actually used by a config');
}

group('the open-source build is acknowledged as such');
{
  // TinyMCE 7 refuses to start self-hosted without one of these, and the
  // community build otherwise paints an "Upgrade" button into the chrome.
  ok(TINYMCE_SELF_HOSTED.license_key === 'gpl', 'license_key is gpl');
  ok(TINYMCE_SELF_HOSTED.promotion === false, 'the upgrade promotion is off');
  ok(/license_key:\s*'gpl'/.test(RICH_FIELD_JS), 'the classic field sets it');
  ok(/promotion:\s*false/.test(RICH_FIELD_JS), 'and turns off the promotion');
  ok(/license_key:\s*'gpl'/.test(editorHtml), 'the block editor sets it');
  ok(/promotion:\s*false/.test(editorHtml), 'and turns off the promotion');

  // GPL: the licence and notices travel with the code we redistribute.
  ok(there('license.md'), "TinyMCE's own licence file ships alongside it");
  ok(there('notices.txt'), 'and its third-party notices');
  ok(readFileSync(at('license.md'), 'utf8').includes('General Public License'), 'the licence is the GPL one');
}

group('the vendored folder stays a trimmed set');
{
  // The whole package is 11MB. Committing all of it — every skin, every plugin,
  // both minified and unminified — would be most of this repo. If this fails,
  // check what was added rather than raising the number.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    return e.isDirectory() ? walk(p) : [statSync(p).size];
  });
  const sizes = walk(root);
  const mb = sizes.reduce((a, b) => a + b, 0) / 1048576;
  ok(sizes.length <= 25, 'a small number of files: ' + sizes.length);
  ok(mb < 2.5, 'under 2.5MB on disk: ' + mb.toFixed(2) + 'MB');
  ok(!there('tinymce.js'), 'the unminified build is not committed');
  ok(!there('skins/ui/oxide-dark'), 'no skins we do not use');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
