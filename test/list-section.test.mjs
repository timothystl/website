// The shared list pattern, in a real browser.
//   node test/list-section.test.mjs
//
// Replaces the old test/ministries-list.test.mjs, which lifted the Ministries
// screen's own bespoke table and script out of the Worker. There is no bespoke
// table any more: every list section is renderListSection() and every one of
// them is driven by LIST_SECTION_JS. Testing those two once covers all twenty
// sections, so this is where search, filtering and the count label are pinned
// down.
//
// Note on a deliberate behaviour change: the old Ministries list had a sort
// dropdown (name / recently updated). The shared pattern has no sort control —
// each section states its own order, and the count label plus filters are what
// a volunteer uses to narrow a list. Nothing here tests sorting because there
// is nothing to sort.
import http from 'node:http'; import path from 'node:path';
import { createRequire } from 'node:module'; import { execSync } from 'node:child_process';
const gr = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(path.join(gr, 'x.js'))('playwright');
import { renderListSection, primaryCell, statusPill, valueChip, ADMIN_UI_CSS, LIST_SECTION_JS } from '../admin/ui.js';

const ROWS = [
  { title: 'Music Ministry',        slug: 'music', value: 'worship',    menu: 1, status: 'live' },
  { title: 'Vacation Bible School', slug: 'vbs',   value: 'education',  menu: 1, status: 'draft' },
  { title: 'Urban Beekeepers',      slug: 'bees',  value: null,         menu: 0, status: 'live' },
];

const section = renderListSection({
  key: 'ministries',
  title: 'Ministries',
  purpose: 'Every ministry page on the website.',
  action: { label: '+ New ministry page', href: '/ministries/add' },
  search: 'Search ministries',
  filters: [
    { label: 'All', value: 'all' },
    { label: 'Receive', value: 'worship' },
    { label: 'Grow', value: 'education' },
    { label: 'Not listed', value: 'off-menu' },
    { label: 'Draft', value: 'draft' },
  ],
  columns: [
    { label: 'Ministry', width: '2.8fr' },
    { label: 'Value', width: '.9fr' },
    { label: 'In menu', width: '1fr' },
    { label: 'Status', width: '.9fr' },
  ],
  rows: ROWS.map((r) => ({
    href: `/ministries/editor/${r.slug}`,
    filter: [r.status, r.menu ? 'in-menu' : 'off-menu', r.value || 'untagged'].filter(Boolean),
    search: `${r.title} ${r.slug}`.toLowerCase(),
    cells: [
      primaryCell(r.title, `/${r.slug}`),
      valueChip(r.value),
      r.menu ? statusPill('good', 'In menu') : statusPill('plain', 'Not listed'),
      statusPill(r.status === 'draft' ? 'warn' : 'good', r.status === 'draft' ? 'Draft' : 'Live'),
    ],
    warn: r.value ? '' : 'No core value on this ministry.',
    warnCta: r.value ? null : { label: 'Tag it', href: `/ministries/edit/${r.slug}` },
  })),
  noun: 'ministry', nounPlural: 'ministries',
  empty: 'No ministry pages yet.',
  note: 'In menu and Status are two different things.',
});

const page = `<!doctype html><html><head><meta charset="utf-8"><style>${ADMIN_UI_CSS}</style></head>`
  + `<body>${section}<script>${LIST_SECTION_JS}</script></body></html>`;

const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(page); });
await new Promise((r) => srv.listen(0, r));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const p = await (await b.newContext()).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:' + srv.address().port);
await p.waitForTimeout(200);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('  ✗ ' + m)); };
const shown = () => p.$$eval('.tlc-row-wrap', (ns) => ns.filter((n) => !n.hidden).map((n) => n.dataset.search));
const count = () => p.$eval('.tlc-count', (n) => n.textContent);
const clickFilter = async (label) => { await p.click(`.tlc-filter:text-is("${label}")`); await p.waitForTimeout(80); };

ok(errs.length === 0, 'no page errors: ' + errs.join(' | '));

// ── the count label ──
ok((await shown()).length === 3, 'every row is visible by default');
ok((await count()) === '3 ministries shown', 'the count uses the irregular plural: ' + (await count()));

// ── search ──
await p.fill('.tlc-search input', 'bees'); await p.waitForTimeout(100);
ok((await shown()).length === 1, 'search narrows the list');
ok((await count()) === '1 of 3 shown', 'and the count reads N of M: ' + (await count()));

await p.fill('.tlc-search input', 'zzz'); await p.waitForTimeout(100);
ok((await shown()).length === 0, 'a search with no hits shows nothing');
ok(await p.locator('.tlc-empty').isVisible(), 'and the empty state appears');
ok((await count()) === '0 of 3 shown', 'the count says zero rather than going blank');

await p.fill('.tlc-search input', ''); await p.waitForTimeout(100);
ok((await shown()).length === 3, 'clearing the search restores every row');
ok(await p.locator('.tlc-empty').isHidden(), 'and hides the empty state again');

// ── filters ──
await clickFilter('Grow');
ok((await shown()).length === 1, 'a value filter narrows to that value');
ok((await shown())[0].includes('vacation'), 'and picks the right row');
// This is the rule the handoff calls out: M is what the FILTER can reach, not
// the table's row count. "1 of 3" here would tell a volunteer two rows are
// hiding somewhere.
ok((await count()) === '1 ministry shown', 'the count is scoped to the filter, not the table: ' + (await count()));

await clickFilter('Not listed');
ok((await shown()).length === 1, 'menu visibility filters independently of status');
ok((await shown())[0].includes('bees'), 'and finds the unlisted ministry');

await clickFilter('Draft');
ok((await shown()).length === 1, 'the status filter works too');

// search and filter compose
await p.fill('.tlc-search input', 'music'); await p.waitForTimeout(100);
ok((await shown()).length === 0, 'a search inside a non-matching filter finds nothing');
ok((await count()) === '0 of 1 shown', 'and M is still the filter’s reach: ' + (await count()));

await p.fill('.tlc-search input', ''); await clickFilter('All');
ok((await shown()).length === 3, 'All restores everything');

// ── warning rows ──
ok(await p.locator('.tlc-warn').count() === 1, 'exactly the untagged ministry grows a warning row');
ok((await p.locator('.tlc-warn-cta').first().textContent()).trim() === 'Tag it', 'with its own action label');

// ── row click ──
// The whole row navigates, but a link inside it must win — otherwise the
// warning row's Fix link and any inline form get swallowed.
await p.click('.tlc-row-wrap:first-child .tlc-primary-title');
await p.waitForTimeout(150);
ok(p.url().endsWith('/ministries/editor/music'), 'clicking a row opens it: ' + p.url());

await p.goBack(); await p.waitForTimeout(200);
await p.click('.tlc-warn-cta');
await p.waitForTimeout(150);
ok(p.url().endsWith('/ministries/edit/bees'), 'a link inside a row wins over the row: ' + p.url());

await b.close(); srv.close();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
