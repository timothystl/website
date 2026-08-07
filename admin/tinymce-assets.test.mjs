// TinyMCE is self-hosted. This checks that every file the editor will ask for
// is actually in the repo.   node admin/tinymce-assets.test.mjs
//
// ⚠ WHY THIS IS NOT PARANOIA. Nothing enumerates these paths: TinyMCE fetches
// its own theme, model, icons, skin and plugins by convention from `base_url`,
// so the /assets/tinymce/ route has to allowlist the SHAPE of a path rather
// than a list of filenames. That means a name that is merely wrong sails
// through the route and fails at the far end — a 404 in the network tab, a
// console warning nobody is looking at, and an editor missing a feature.
//
// `blockquote` sat in the classic field's plugin list for months and is not a
// TinyMCE plugin at all — it is a core format, so there has never been a
// plugins/blockquote/ to fetch. It cost nothing against the cloud and it costs
// nothing now; it is simply the kind of thing only a test notices.
//
// The other half — that the files really are served, and really are JavaScript
// rather than an error page — needs a browser and lives in
// test/tinymce-selfhost.test.mjs.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { TINYMCE_VERSION, TINYMCE_BASE, TINYMCE_HEAD, TINYMCE_PLUGINS } from './db.js';
import { RICH_FIELD_JS } from './helpers.js';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const group = (n) => console.log('\n' + n);

const root = new URL('./vendor/tinymce/', import.meta.url);
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
    // ⚠ Comments are stripped first. Several of them name the old CDN, because
    // that is the history worth recording, and a check that fails on a comment
    // teaches whoever hits it to delete the note rather than the code. The
    // negative lookbehind on ':' is what keeps this from eating the // in an
    // https:// URL, which is the only thing it is actually looking for.
    const live = src.replace(/(^|[^:])\/\/.*$/gm, '$1');
    ok(!live.includes('cdn.tiny.cloud'), name + ' still loads TinyMCE from the cloud CDN');
    ok(!/tiny\.cloud\/1\//.test(live), name + ' still carries a cloud API key path');
  }
  ok(TINYMCE_BASE.startsWith('/assets/tinymce/'), 'the script comes off our own origin: ' + TINYMCE_BASE);
  ok(TINYMCE_HEAD.includes(TINYMCE_BASE + '/tinymce.min.js'), 'and that is the URL the loader actually uses');
  ok(!/<script[^>]+src=/.test(TINYMCE_HEAD), 'nothing is fetched by a script tag at page load — the loader injects on demand');
}

group('the version lives in the path, not a query string');
{
  // TinyMCE derives its base URL from this script tag and loads the theme,
  // model, icons, skin and every plugin relative to it. A ?v= would be stripped
  // from those, so they would cache forever with no way to bust them.
  ok(TINYMCE_BASE.endsWith('/' + TINYMCE_VERSION), 'the base URL ends in the version: ' + TINYMCE_BASE);
  ok(/^\d+\.\d+\.\d+$/.test(TINYMCE_VERSION), 'the version is a real version: ' + TINYMCE_VERSION);
  // Both init configs must point their own lazy loads at the SAME versioned
  // base. TinyMCE fetches theme/model/icons/skin/plugins from base_url with no
  // query string, and the route serves everything immutable for a year — an
  // unversioned base_url would leave a year-old theme against a new core.
  ok(RICH_FIELD_JS.includes("base_url: '" + TINYMCE_BASE + "'"), 'the classic field points at the versioned base');
  ok(editorHtml.includes("base_url: '" + TINYMCE_BASE + "'"), 'and so does the page editor');
  const worker = readFileSync(new URL('../tlc-admin-worker.js', import.meta.url), 'utf8');
  ok(worker.includes("versioned[1] !== TINYMCE_VERSION"), 'the route strips and checks the version segment');
  ok(worker.includes('max-age=31536000, immutable'), 'and serves it immutably');
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
  // TinyMCE 7 refuses to start self-hosted without this and renders an
  // "invalid licence" notice over the editor instead. (`promotion: false` is
  // NOT needed — checked in a real browser: the community build draws no
  // Upgrade button with menubar off.)
  ok(/license_key:\s*'gpl'/.test(RICH_FIELD_JS), 'the classic field sets it');
  ok(/license_key:\s*'gpl'/.test(editorHtml), 'the page editor sets it');

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
  ok(!there('tinymce.d.ts'), 'no TypeScript definitions');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
