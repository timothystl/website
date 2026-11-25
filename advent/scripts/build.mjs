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
import { extractDays, findExtras, bodyAfterTitle, parseImageBoxes, artRegions, parsePdfXml, bookMetrics, pageBlocks } from './lib.mjs';

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
const PDF_VERSION = createHash('sha256').update(fs.readFileSync(pdf)).digest('hex').slice(0, 16);
// Changes when either the booklet or the viewer code changes (for app.js, styles.css, manifest.json).
const BUILD_VERSION = createHash('sha256').update(PDF_VERSION)
  .update(fs.readFileSync(path.join(SITE, 'app.js'))).update(fs.readFileSync(path.join(SITE, 'styles.css')))
  .update(JSON.stringify(config)).digest('hex').slice(0, 16);
const sharp = (await import('sharp')).default;

// ── 1. Page count and size ──────────────────────────────────────────────────
const info = run('pdfinfo', [pdf]);
const pageCount = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
const [, wPt, hPt] = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(info) || [];
if (!pageCount) fail('Could not read the page count from the PDF.');
console.log(`Booklet: ${path.relative(ROOT, pdf)} · ${pageCount} pages · ${(wPt / 72).toFixed(2)}×${(hPt / 72).toFixed(2)} in`);
if (pageCount % 2) console.warn('⚠ Odd page count; spreads may not line up as expected.');

// ── 2. Text for every page ──────────────────────────────────────────────────
// pdftohtml -xml gives every line of text in reading order with its position and
// type size (so columns, paragraphs and headings survive), and where each picture sits.
const xmlDir = fs.mkdtempSync(path.join(ROOT, '.xml-'));
let pdfXml;
try {
  run('pdftohtml', ['-xml', '-q', '-zoom', '1', '-nodrm', '-enc', 'UTF-8', pdf, path.join(xmlDir, 'b')]);
  pdfXml = fs.readFileSync(path.join(xmlDir, 'b.xml'), 'utf8');
} finally {
  fs.rmSync(xmlDir, { recursive: true, force: true });
}
const textByPage = parsePdfXml(pdfXml);
const imageBoxes = parseImageBoxes(pdfXml);
const metrics = bookMetrics(textByPage);
const pages = [];
// Eyebrows are set in tracked capitals; restore the booklet's own capitalization of
// names such as "Christmas Day" after converting them to sentence case.
const NAMES = [...new Set(config.weeks.flatMap((w) => [w.name, ...(config.properNames || [])]))];
const fixNames = (t) => NAMES.reduce((s, name) => s.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), name), t);
for (let n = 1; n <= pageCount; n++) {
  const blocks = pageBlocks(textByPage[n], metrics).map((b) => (b.k === 'e' ? { ...b, t: fixNames(b.t) } : b));
  pages.push({ n, blocks, rows: (textByPage[n]?.lines || []).map((l) => l.text) });
}

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
const extras = findExtras(pages, config.extras, new Set(days.flatMap((d) => [d.page, d.page + 1])));
for (const e of config.extras) if (!extras.find((x) => x.label === e.label)) console.warn(`⚠ Contents entry "${e.label}" not found; left out.`);
console.log(`Found all ${days.length} days (${days[0].label} p${days[0].page} … ${days.at(-1).label} p${days.at(-1).page}) for ${year}.`);

// ── 4. Output folder ────────────────────────────────────────────────────────
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(SITE, DIST, { recursive: true, filter: (src) => !src.endsWith('.tmpl.html') });
fs.mkdirSync(path.join(DIST, 'pages'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'art'), { recursive: true });

// ── 5. Page images ──────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(ROOT, '.render-'));
const ART_PAGES = new Set(days.flatMap((d) => [d.page, d.page + 1]).concat(extras.map((e) => e.page)));
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
    // ?v= changes with every new PDF, so browsers never show a previous booklet's pages.
    pages[i].img = { sm: `/pages/${base}-sm.webp?v=${PDF_VERSION}`, lg: `/pages/${base}-lg.webp?v=${PDF_VERSION}` };
    pages[i].art = [];
    if (ART_PAGES.has(n)) {
      const { regions, fullPage } = artRegions(imageBoxes[n]);
      const meta = await sharp(path.join(tmp, file)).metadata();
      const scale = meta.width / +wPt;
      const crops = fullPage ? [{ left: 0, top: 0, width: +wPt, height: +hPt }] : regions;
      for (const [k, r] of crops.entries()) {
        const left = Math.max(0, Math.round(r.left * scale));
        const top = Math.max(0, Math.round(r.top * scale));
        const width = Math.min(meta.width - left, Math.round(r.width * scale));
        const height = Math.min(meta.height - top, Math.round(r.height * scale));
        if (width < 20 || height < 20) continue;
        const outW = Math.min(width, 1200);
        const name = `/art/${base}-${k + 1}.webp`;
        await sharp(path.join(tmp, file)).extract({ left, top, width, height }).resize({ width: outW })
          .webp({ quality: 82, effort: 5 }).toFile(path.join(DIST, name));
        pages[i].art.push({ src: `${name}?v=${PDF_VERSION}`, width: outW, height: Math.round((height * outW) / width) });
      }
    }
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
  downloads.push({ href: `/${dl.as}?v=${PDF_VERSION}`, label: dl.label, sizeMB: +(fs.statSync(src).size / 1048576).toFixed(1) });
}

// ── 7. Manifest ─────────────────────────────────────────────────────────────
const manifest = {
  title: config.title,
  subtitle: config.subtitle,
  year,
  timeZone: config.timeZone,
  generated: new Date().toISOString(),
  source: { file: path.basename(pdf), sha256: PDF_VERSION },
  pageSize: { width: +wPt, height: +hPt },
  pageCount,
  pages: pages.map(({ n, img, art, blocks }) => ({ n, img, ...(art.length ? { art } : {}), blocks })),
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
const blockHtml = (blocks) => blocks.map((b) => (b.k === 'h' ? `<h3>${esc(b.t)}</h3>`
  : b.k === 'e' ? `<p class="tv-eyebrow">${esc(b.t)}</p>` : `<p>${esc(b.t).replace(/\n/g, '<br>')}</p>`)).join('\n');
const dayText = (d) => {
  const { eyebrow, body } = bodyAfterTitle(pages[d.page - 1].blocks, d.label, d.title);
  const right = pages[d.page]?.blocks || [];
  const artHtml = (pg) => (pages[pg - 1]?.art || []).map((a) => `<figure class="tv-art"><img src="${a.src}" width="${a.width}" height="${a.height}" alt="Artwork for ${esc(d.label)}" loading="lazy" decoding="async"></figure>`).join('\n');
  return `${eyebrow.map((b) => `<p class="tv-eyebrow">${esc(b.t)}</p>`).join('')}<p class="tv-date">${esc(d.label)}</p><h2>${esc(d.title)}</h2>
${blockHtml(body)}
${artHtml(d.page)}
<hr>
${artHtml(d.page + 1)}
${blockHtml(right)}`;
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
    .replaceAll('{{VERSION}}', BUILD_VERSION);
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

const artCount = pages.reduce((s, p) => s + (p.art?.length || 0), 0);
const daysWithoutArt = days.filter((d) => !pages[d.page - 1].art.length && !pages[d.page]?.art?.length).map((d) => d.label);
console.log(`Artwork: ${artCount} picture(s) cut out for the text view.`);
if (daysWithoutArt.length) console.warn(`⚠ No picture found for ${daysWithoutArt.length} day(s) (drawn art isn't detected): ${daysWithoutArt.slice(0, 5).join('; ')}${daysWithoutArt.length > 5 ? '…' : ''}`);
const total = fs.readdirSync(path.join(DIST, 'pages')).reduce((s, f) => s + fs.statSync(path.join(DIST, 'pages', f)).size, 0);
console.log(`✔ Built ${pageCount} pages (${(total / 1048576).toFixed(1)} MB of images), ${days.length} day pages → ${path.relative(ROOT, DIST)}/`);
