// Phase 7 — the rebuilt Ministries list. Lifts the list markup and its
// search/filter/sort script straight out of the Worker source and runs them in
// a real browser, so the behaviour is tested without needing D1.
//   node test/ministries-list.test.mjs
import fs from 'node:fs'; import http from 'node:http'; import path from 'node:path';
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process';
const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr,'x.js'))('playwright');
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', 'tlc-admin-worker.js'), 'utf8');
const start = src.indexOf('<div class="wrap wrap-wide">\n  <div class="page-title">Ministries</div>');
const end = src.indexOf("`, 'Ministries Admin');");
let tpl = src.slice(start, end);
const rows = [
  {slug:'music',title:'Music Ministry',status:'live',blocks:7,updated:'2026-07-30'},
  {slug:'vbs',title:'Vacation Bible School',status:'draft',blocks:3,updated:'2026-07-12'},
  {slug:'bees',title:'Urban Beekeepers',status:'scheduled',blocks:5,updated:'2026-06-01'},
].map(r=>`<tr class="mrow" data-name="${(r.title+' '+r.slug).toLowerCase()}" data-status="${r.status}" data-updated="${r.updated}"><td><div>${r.title}</div><div>/${r.slug} · ${r.blocks} blocks</div></td><td>${r.status}</td><td>${r.updated}</td><td></td></tr>`).join('');
tpl = tpl.replace('${rows}', rows).replace(/\$\{[^}]*\}/g, '');
const page = '<!doctype html><html><head><meta charset="utf-8"><style>:root{--border:#ccc;--gray:#777;--sans:sans-serif;--steel:#123;--linen:#eee;--charcoal:#222;--mist:#eef;}</style></head><body>'+tpl+'</body></html>';
const srv = http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end(page);});
await new Promise(r=>srv.listen(0,r));
const b = await chromium.launch({executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium'});
const p = await (await b.newContext()).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:'+srv.address().port);
await p.waitForTimeout(300);
let pass=0,fail=0; const ok=(c,m)=>{c?pass++:(fail++,console.error('  ✗ '+m));};
ok(errs.length===0,'no page errors: '+errs.join(' | '));
const visible = async () => p.$$eval('#mBody tr', ns=>ns.filter(n=>n.style.display!=='none').map(n=>n.dataset.name));
ok((await visible()).length===3,'all rows visible by default');
await p.fill('#mSearch','bees'); await p.waitForTimeout(120);
ok((await visible()).length===1,'search filters rows');
await p.fill('#mSearch',''); await p.selectOption('#mStatus','draft'); await p.waitForTimeout(120);
ok((await visible()).length===1,'status filter works');
ok((await visible())[0].includes('vacation'),'and picks the right one');
await p.selectOption('#mStatus','hidden'); await p.waitForTimeout(120);
ok((await visible()).length===0,'a filter with no matches shows nothing');
ok(await p.locator('#mNone').isVisible(),'and an empty-state message');
await p.selectOption('#mStatus',''); await p.selectOption('#mSort','name'); await p.waitForTimeout(120);
const names = await visible();
ok(names[0].startsWith('music')&&names[2].startsWith('vacation'),'sort by name reorders: '+names.join(', '));
await p.selectOption('#mSort','recent'); await p.waitForTimeout(120);
const recent = await visible();
ok(recent[0].startsWith('music'),'sort by recent puts the newest first');
await b.close(); srv.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
