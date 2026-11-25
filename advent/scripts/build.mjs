#!/usr/bin/env node
// Builds the online Advent devotional from the booklet PDF.
//
//   node scripts/build.mjs [path/to/booklet.pdf]
//
// Reads source/booklet.pdf (or the path given), renders every page to WebP at two
// sizes, reads each page's text, finds the date line of each daily devotion
// (Nov 29 – Dec 25) to build the day → page map, and writes everything the
// viewer needs into dist/. Nothing about page numbers is hardcoded; when a day
// cannot be found the build stops and names it. source/overrides.json can pin
// any day (or title) by hand. Needs poppler-utils (pdftoppm, pdftotext, pdfinfo).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDays, cleanPageText, findExtras, pageRows, textMeasure, bodyAfterTitle } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const DIST = path.join(ROOT, process.env.ADVENT_DIST || 'dist');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'booklet.config.json'), 'utf8'));
const pdf = path.resolve(process.argv[2] || path.join(ROOT, config.pdf));
const overridesPath = path.join(ROOT, 'source', 'overrides.json');
const overrides = fs.existsSync(overridesPath)
  ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};

const SIZES = { sm: 800, lg: 1400 };

function fail(msg) {
  console.error(`\n✖ BUILD FAILED\n\n${msg}\n`);
  process.exit(1);
}
function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: opts.binary ? undefined : 'utf8', maxBuffer: 1 << 28, ...opts });
  } catch (e) {
    if (e.code === 'ENOENT') fail(`"${cmd}" is not installed. Install poppler-utils (Mac: brew install poppler).`);
    throw e;
  }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (!fs.existsSync(pdf)) fail(`No booklet found at ${pdf}.`);
const sharp = (await import('sharp')).default;

// ── 1. Page count and size ──────────────────────────────────────────────────
const info = run('pdfinfo', [pdf]);
const pageCount = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
const [, wPt, hPt] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info) || [];
if (!pageCount) fail('Could not read the page count from the PDF.');
console.log(`Booklet: ${path.relative(ROOT, pdf)} · ${pageCount} pages · ${(wPt / 72).toFixed(2)}×${(hPt / 72).toFixed(2)} in`);
if (pageCount % 2) console.warn('⚠ Odd page count; spreads may not line up as expected.');

// ── 2. Text for every page ──────────────────────────────────────────────────
const raws = [];
for (let n = 1; n <= pageCount; n++) {
  raws.push(run('pdftotext', ['-layout', '-enc', 'UTF-8', '-f', String(n), '-l', String(n), pdf, '-']));
}
const measure = textMeasure(raws.flatMap(pageRows));
const pages = raws.map((raw, i) => ({ n: i + 1, ...cleanPageText(raw, { measure }) }));

// ── 3. Day → page map ───────────────────────────────────────────────────────
const { days, missing, problems, year } = extractDays(pages, { overrides, year: config.year });
if (missing.length || problems.length) {
  const lines = [];
  if (missing.length) lines.push(`These days were not found in the PDF:\n  ${missing.join('\n  ')}`);
  if (problems.length) lines.push(problems.join('\n'));
  lines.push(
    'Each devotion\'s left page should have its date on a line by itself, e.g. "Wednesday, December 9".',
    `To pin a day by hand, add it to source/overrides.json, for example:\n  { "days": { "dec-9": { "page": 24 } } }`,
  );
  fail(lines.join('\n\n'));
}
for (const d of days) {
  if (d.page % 2) console.warn(`⚠ ${d.label} starts on page ${d.page} (a right-hand page). Check the spread.`);
}
const weeks = config.weeks.map((w) => ({ ...w, days: [] }));
for (const d of days) {
  const md = d.date.slice(5);
  const wk = [...weeks].reverse().find((w) => md >= w.from) || weeks[0];
  d.week = wk.name;
  wk.days.push(d.slug);
}
const extras = findExtras(pages, config.extras);
for (const e of config.extras) if (!extras.find((x) => x.label === e.label)) console.warn(`⚠ Contents entry "${e.label}" not found; left out.`);
console.log(`Found all ${days.length} days (${days[0].label} p${days[0].page} … ${days.at(-1).label} p${days.at(-1).page}) for ${year}.`);

// ── 4. Output folder ────────────────────────────────────────────────────────
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(SITE, DIST, { recursive: true, filter: (src) => !src.endsWith('.tmpl.html') });
fs.mkdirSync(path.join(DIST, 'pages'), { recursive: true });

// ── 5. Page images ──────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(ROOT, '.render-'));
try {
  console.log('Rendering pages…');
  run('pdftoppm', ['-png', '-r', String(Math.ceil((SIZES.lg / (wPt / 72)) * 1.15)), '-aa', 'yes', '-aaVector', 'yes', pdf, path.join(tmp, 'p')]);
  const rendered = fs.readdirSync(tmp).filter((f) => f.endsWith('.png')).sort();
  if (rendered.length !== pageCount) fail(`Rendered ${rendered.length} pages, expected ${pageCount}.`);
  await Promise.all(rendered.map(async (file, i) => {
    const n = i + 1;
    const base = `p${String(n).padStart(3, '0')}`;
    for (const [key, width] of Object.entries(SIZES)) {
      await sharp(path.join(tmp, file)).resize({ width }).webp({ quality: key === 'lg' ? 82 : 78, effort: 5 })
        .toFile(path.join(DIST, 'pages', `${base}-${key}.webp`));
    }
    pages[i].img = { sm: `/pages/${base}-sm.webp`, lg: `/pages/${base}-lg.webp` };
    if (n === 1) {
      await sharp(path.join(tmp, file)).resize({ width: 1200, height: 630, fit: 'contain', background: '#F3F7FA' })
        .jpeg({ quality: 82 }).toFile(path.join(DIST, 'share.jpg'));
    }
  }));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 6. PDF downloads ────────────────────────────────────────────────────────
const downloads = [];
for (const dl of [{ file: pdf, as: config.downloadName, label: config.downloadLabel }, ...(config.extraDownloads || [])]) {
  const src = path.resolve(ROOT, dl.file);
  if (!fs.existsSync(src)) { console.warn(`⚠ Optional download ${dl.file} not found; skipped.`); continue; }
  fs.copyFileSync(src, path.join(DIST, dl.as));
  downloads.push({ href: `/${dl.as}`, label: dl.label, sizeMB: +(fs.statSync(src).size / 1048576).toFixed(1) });
}

// ── 7. Manifest ─────────────────────────────────────────────────────────────
const manifest = {
  title: config.title,
  subtitle: config.subtitle,
  year,
  timeZone: config.timeZone,
  generated: new Date().toISOString(),
  source: { file: path.basename(pdf), sha256: createHash('sha256').update(fs.readFileSync(pdf)).digest('hex').slice(0, 16) },
  pageSize: { width: +wPt, height: +hPt },
  pageCount,
  pages: pages.map(({ n, img, paragraphs }) => ({ n, img, text: paragraphs.join('\n\n') })),
  days: days.map(({ slug, date, label, title, page, week }) => ({ slug, date, label, title, page, week })),
  weeks: weeks.map(({ name, label, days: d }) => ({ name, label, days: d })),
  extras,
  downloads,
};
fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest));

// ── 8. HTML: home page plus one static page per day ─────────────────────────
const tmpl = fs.readFileSync(path.join(SITE, 'index.tmpl.html'), 'utf8');
const analytics = config.cloudflareAnalyticsToken
  ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: config.cloudflareAnalyticsToken })}'></script>`
  : '';
const paraHtml = (text) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  .map((p) => (!p.includes('\n') && p.length <= 32 && !/[.,;:!?”"]$/.test(p) ? `<h3>${esc(p)}</h3>`
    : `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)).join('\n');
const dayText = (d) => {
  const { body } = bodyAfterTitle(pages[d.page - 1].paragraphs, d.label, d.title);
  const right = manifest.pages[d.page]?.text || '';
  return `<p class="tv-date">${esc(d.label)}</p><h2>${esc(d.title)}</h2>\n${paraHtml(body.join('\n\n'))}\n<hr>\n${paraHtml(right)}`;
};
function page({ title, description, canonical, day, body }) {
  return tmpl
    .replaceAll('{{TITLE}}', esc(title))
    .replaceAll('{{DESCRIPTION}}', esc(description))
    .replaceAll('{{CANONICAL}}', esc(canonical))
    .replaceAll('{{DAY}}', esc(day || ''))
    .replaceAll('{{SITE_TITLE}}', esc(config.title))
    .replaceAll('{{ASPECT}}', `${wPt} / ${hPt}`)
    .replace('{{NOSCRIPT_TEXT}}', body)
    .replace('{{ANALYTICS}}', analytics)
    .replaceAll('{{DOWNLOAD_HREF}}', esc(downloads[0]?.href || ''))
    .replaceAll('{{VERSION}}', manifest.source.sha256);
}
const base = (config.publicUrl || '').replace(/\/$/, '');
const contents = days.map((d) => `<li><a href="/${d.slug}">${esc(d.label)}: ${esc(d.title)}</a></li>`).join('');
fs.writeFileSync(path.join(DIST, 'index.html'), page({
  title: `${config.title}: ${config.subtitle}`,
  description: config.description,
  canonical: `${base}/`,
  body: `<h2>Daily devotions</h2><ul>${contents}</ul>`,
}));
for (const d of days) {
  fs.writeFileSync(path.join(DIST, `${d.slug}.html`), page({
    title: `${d.label}: ${d.title} · ${config.title}`,
    description: `${config.title}, ${d.label}: ${d.title}.`,
    canonical: `${base}/${d.slug}`,
    day: d.slug,
    body: dayText(d),
  }));
}
fs.writeFileSync(path.join(DIST, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: interest-cohort=()',
  '/pages/*',
  '  Cache-Control: public, max-age=86400',
  '/fonts/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/manifest.json',
  '  Cache-Control: public, max-age=300',
  '',
].join('\n'));

const total = fs.readdirSync(path.join(DIST, 'pages')).reduce((s, f) => s + fs.statSync(path.join(DIST, 'pages', f)).size, 0);
console.log(`✔ Built ${pageCount} pages (${(total / 1048576).toFixed(1)} MB of images), ${days.length} day pages → ${path.relative(ROOT, DIST)}/`);
