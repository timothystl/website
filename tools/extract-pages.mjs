// One-time converter: reads the hardcoded pages out of public/index.html and
// writes the block lists each page starts from in the editor.
//
//   node tools/extract-pages.mjs [--dry-run]
//
// Two outputs, from one converter so they cannot drift:
//   admin/page-seeds.js   PAGE_SEEDS — ministry/youth pages, for the ministry
//                         editor that is already live.
//   admin/site-pages.js   SITE_PAGES — every page on the site, with its menu
//                         placement, layout and search summary, for the `pages`
//                         table.
//
// Both are seeded into the DRAFT only. Until someone opens a page in the editor
// and presses Publish, the live site keeps rendering its hardcoded markup, so
// running this can never change what a visitor sees.
//
// Run it again whenever a page's hardcoded markup changes and its seed has not
// been published yet. It is a development tool, not part of the deploy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeBlocks, newBlock, TEMPLATES } from '../admin/blocks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, '..', 'public', 'index.html'), 'utf8');
const DRY = process.argv.includes('--dry-run');

// Ministry and youth pages, which the already-shipped ministry editor seeds.
const MINISTRY_SLUGS = ['music', 'stephen', 'foodpantry', 'bees', 'christmasmarket',
  'youth', 'sundayschool', 'confirmation', 'vbs', 'egghunt', 'family'];

// The whole site, in menu order. Menu placement is a decision, not something
// that can be read reliably out of the markup, so it is stated here once — this
// file IS the migration.
//
// Seeded to match today's navigation: the top-level entries are the desktop
// nav, with two additions the mobile menu already carries — Youth & Family
// (which owns six child pages, so it belongs at the top level) and Prayer
// Request, filed under Contact. Every detail page is reachable but out of the
// menu, exactly as today; staff can turn any of them on from the Pages screen.
const PAGES = [
  { id: 'home',            slug: '/',                 title: 'Home',                    template: 'home',     menu: false },
  { id: 'about',           slug: '/about',            title: 'About',                                         sort: 10 },
  { id: 'worship',         slug: '/worship',          title: 'Worship',                                       sort: 20 },
  { id: 'education',       slug: '/education',        title: 'Christian Education',     menuLabel: 'Learn',   sort: 30 },
  { id: 'sermons',         slug: '/sermons',          title: 'Sermons',                                       sort: 40 },
  { id: 'ministries',      slug: '/ministries',       title: 'Ministries',              template: 'section',  sort: 50 },
  { id: 'youthfamily',     slug: '/youthfamily',      title: 'Youth & Family',          template: 'section',  sort: 60 },
  { id: 'news',            slug: '/news',             title: 'News & Events',                                 sort: 70 },
  { id: 'calendar',        slug: '/calendar',         title: 'Calendar',                                      sort: 80 },
  { id: 'contact',         slug: '/contact',          title: 'Contact',                                       sort: 90 },
  { id: 'give',            slug: '/give',             title: 'Give',                                          sort: 100 },

  { id: 'music',           slug: '/music',            title: 'Music Ministry',          parent: 'ministries', sort: 20, menu: false },
  { id: 'stephen',         slug: '/stephen',          title: 'Stephen Ministry',        parent: 'ministries', sort: 30, menu: false },
  { id: 'foodpantry',      slug: '/foodpantry',       title: 'Food Pantry',             parent: 'ministries', sort: 40, menu: false },
  { id: 'bees',            slug: '/bees',             title: 'Urban Beekeepers',        parent: 'ministries', sort: 50, menu: false },
  { id: 'christmasmarket', slug: '/christmasmarket',  title: 'Christmas Market',        parent: 'ministries', sort: 60, menu: false },
  { id: 'ccs',             slug: '/ccs',              title: "Concordia Children's Services", parent: 'ministries', sort: 70, menu: false },
  { id: 'wol',             slug: '/wol',              title: 'Word of Life School',     parent: 'ministries', sort: 80, menu: false },

  { id: 'youth',           slug: '/youth',            title: 'Youth Ministry',          parent: 'youthfamily', sort: 10, menu: false },
  { id: 'sundayschool',    slug: '/sundayschool',     title: 'Sunday School',           parent: 'youthfamily', sort: 20, menu: false },
  { id: 'confirmation',    slug: '/confirmation',     title: 'Confirmation',            parent: 'youthfamily', sort: 30, menu: false },
  { id: 'vbs',             slug: '/vbs',              title: 'Vacation Bible School',   parent: 'youthfamily', sort: 40, menu: false },
  { id: 'egghunt',         slug: '/egghunt',          title: 'Easter Egg Hunt',         parent: 'youthfamily', sort: 50, menu: false },
  { id: 'family',          slug: '/family',           title: 'Family Ministry',         parent: 'youthfamily', sort: 60, menu: false },

  { id: 'prayer',          slug: '/prayer',           title: 'Prayer Request',          parent: 'contact',    sort: 10 },
];

// Regions the SPA fills from the admin API. They must not be baked into a seed
// or the content would end up on the page twice.
const DYNAMIC_IDS = /-(content|admin-content|upcoming|past|concert|admin-cta)-?section$|^[a-z]+-admin-cta$/;

const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '').trim();
// Plain-text fields are escaped again when they are rendered, so entities have
// to come out of the markup decoded or a title reads "Location &amp;amp; times".
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decode = (s) => String(s).replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(Number(e[1] === 'x' || e[1] === 'X' ? '0' + e.slice(1) : e.slice(1)));
  return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
});
const text = (s) => decode(strip(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const grab = (chunk, re) => { const m = chunk.match(re); return m ? m[1] : ''; };

// Keeps the inline formatting the copy actually uses and drops layout markup.
function prose(chunk) {
  const ps = chunk.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  return ps
    .filter((p) => !/class="[^"]*\b(eyebrow|btn)/.test(p))
    .map((p) => '<p>' + strip(p.replace(/^<p\b[^>]*>/i, '').replace(/<\/p>$/i, ''))
      .replace(/<(?!\/?(strong|b|em|i|a|br)\b)[^>]*>/gi, '') + '</p>')
    .join('\n');
}

function buttonsIn(chunk) {
  const out = [];
  const re = /<a\b([^>]*class="[^"]*\bbtn\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    const href = grab(m[1], /href="([^"]*)"/);
    const label = text(m[2]);
    if (href && label) out.push({ title: label, url: href });
  }
  return out;
}

function pageChunk(slug) {
  const start = html.indexOf(`id="page-${slug}"`);
  if (start < 0) return '';
  const next = html.indexOf('<div id="page-', start + 10);
  return html.slice(start, next > -1 ? next : html.length);
}

// Splits a page into its top-level <section> elements by counting tags, since
// sections nest and a regex cannot see the matching close.
function sections(chunk) {
  const out = [];
  const re = /<section\b[^>]*>/gi;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    let depth = 1;
    const inner = /<section\b[^>]*>|<\/section>/gi;
    inner.lastIndex = m.index + m[0].length;
    let x;
    while (depth > 0 && (x = inner.exec(chunk)) !== null) depth += x[0][1] === '/' ? -1 : 1;
    if (depth !== 0) continue;
    out.push({ open: m[0], body: chunk.slice(m.index + m[0].length, x.index) });
    re.lastIndex = x.index;
  }
  return out;
}

// Sections whose markup says plainly what block they are. Recognising these is
// what turns a wall of divs into something staff can actually edit; anything
// unrecognised falls through to the generic text/photo conversion below.
function recognise(sec, push, ctx) {
  const b = sec.body;
  const bg = /section--linen|section--mist/.test(sec.open) ? 1 : 0;
  const eyebrow = text(grab(b, /<span[^>]*class="[^"]*eyebrow[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
  const heading = text(grab(b, /<h2[^>]*>([\s\S]*?)<\/h2>/i));

  if (/<form id="contact-form"/.test(b)) {
    push('form', { eyebrow, title: heading || 'Get in touch', bg, spaceAbove: 64, spaceBelow: 24 });
    push('map', { title: 'Find us', bg, spaceAbove: 0, spaceBelow: 64 });
    return true;
  }
  if (/<form id="prayer-form"/.test(b)) {
    push('form', { eyebrow, title: heading || 'Send a prayer request', body: prose(b), bg, spaceAbove: 64, spaceBelow: 64 });
    return true;
  }
  if (/id="home-sermon-card"/.test(b)) {
    push('sermon', { eyebrow, title: 'Current series', bg, spaceAbove: 64, spaceBelow: 24 });
    push('news', { title: 'News & announcements', bg, spaceAbove: 0, spaceBelow: 64, count: 3 });
    return true;
  }
  if (/id="staff-grid"|Staff &amp; leadership/.test(b)) {
    push('staff', { eyebrow, title: heading || 'Staff & leadership', bg, spaceAbove: 64, spaceBelow: 64, count: 6 });
    return true;
  }
  if (/calendar\.google\.com/.test(b)) {
    push('calendar', { eyebrow, title: heading || 'Church calendar', bg, spaceAbove: 64, spaceBelow: 64 });
    return true;
  }
  // "Location & service times" — the times themselves live in site settings now
  if (/service times/i.test(heading)) {
    push('servicetimes', { eyebrow, title: heading, bg, spaceAbove: 64, spaceBelow: 24 });
    push('map', { title: 'Where to find us', bg, spaceAbove: 0, spaceBelow: 64 });
    return true;
  }
  return false;
}

function convert(slug) {
  const chunk = pageChunk(slug);
  if (!chunk) return [];
  const blocks = [];
  const push = (type, over) => { const b = newBlock(type, over); if (b) blocks.push(b); };

  // 1. the page banner
  // most pages use a plain <div class="page-hero">; the homepage uses
  // <section class="hero"> with the same shape inside
  const hero = chunk.match(/<div [^>]*class="[^"]*page-hero[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<!--[\s\S]*?-->\s*)*<(?:section|div)/i)
    || chunk.match(/<section class="hero">([\s\S]*?)<\/section>/i);
  if (hero) {
    push('hero', {
      eyebrow: text(grab(hero[1], /<span[^>]*class="[^"]*eyebrow[^"]*"[^>]*>([\s\S]*?)<\/span>/i)),
      title: text(grab(hero[1], /<h1[^>]*>([\s\S]*?)<\/h1>/i)),
      subtitle: text(grab(hero[1], /<p[^>]*>([\s\S]*?)<\/p>/i)),
      spaceAbove: 0, spaceBelow: 0,
    });
  }

  // 2. every hardcoded section, in order
  for (const sec of sections(chunk)) {
    const id = grab(sec.open, /id="([^"]*)"/);
    if (id && DYNAMIC_IDS.test(id)) continue;
    if (/display:none/.test(sec.open)) continue;
    if (/class="hero"/.test(sec.open)) continue; // already taken as the banner
    if (recognise(sec, push, { slug })) continue;

    const eyebrow = text(grab(sec.body, /<span[^>]*class="[^"]*eyebrow[^"]*"[^>]*>([\s\S]*?)<\/span>/i));
    const heading = text(grab(sec.body, /<h2[^>]*>([\s\S]*?)<\/h2>/i));
    const bg = /section--linen/.test(sec.open) ? 1 : 0;
    const twoCol = sec.body.match(/<div class="two-col"[^>]*>([\s\S]*)<\/div>/i);
    const hasPhotoSlot = /-photo-wrap|img-placeholder/.test(sec.body);
    const buttons = buttonsIn(sec.body);
    const body = prose(sec.body);

    if (twoCol && hasPhotoSlot) {
      // text one side, a photo the other — exactly a Text + photo block
      const photoOnLeft = sec.body.indexOf('photo-wrap') < sec.body.indexOf('<h2');
      push('textphoto', {
        eyebrow, title: heading, body, bg,
        side: photoOnLeft ? 'left' : 'right', split: '50',
        spaceAbove: 88, spaceBelow: 88,
      });
    } else if (body || heading) {
      push('text', { eyebrow, title: heading, body, bg, spaceAbove: 88, spaceBelow: buttons.length ? 24 : 88 });
    }
    if (buttons.length) push('buttons', { items: buttons, bg, spaceAbove: 0, spaceBelow: 88 });
  }

  return sanitizeBlocks(blocks);
}

// `text` blocks have no heading field of their own on the public page, so fold
// a heading into the body where one was found.
function foldHeadings(blocks) {
  return blocks.map((b) => {
    if (b.type !== 'text' || !b.title) return b;
    return Object.assign({}, b, { body: `<h2>${b.title}</h2>\n${b.body}`, title: '' });
  });
}

// Block ids are stable and derived from the page, not from the clock, so
// re-running this produces a diff only when the page's content actually
// changed — and a seed keeps the same ids across runs, which is what makes
// revision history and undo readable after a re-extract.
function blocksFor(slug) {
  const blocks = sanitizeBlocks(foldHeadings(convert(slug)));
  return blocks.map((b, i) => Object.assign({}, b, { id: `${slug}-${i + 1}` }));
}

// The search summaries already written for each page, so the migration does not
// silently throw away work that was done for SEO.
function seoDescriptions() {
  const out = {};
  const start = html.indexOf('var PAGE_META = {');
  if (start < 0) return out;
  const body = html.slice(start, html.indexOf('\n};', start));
  const re = /'([a-z0-9]+)':\s*\{[^}]*?desc:\s*'((?:[^'\\]|\\.)*)'/gi;
  let m;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  return out;
}

// ── run ──────────────────────────────────────────────────────────────────────
const seo = seoDescriptions();
const templateKeys = new Set(TEMPLATES.map((t) => t.key));

const seeds = {};
for (const slug of MINISTRY_SLUGS) {
  const blocks = blocksFor(slug);
  if (blocks.length) seeds[slug] = blocks;
}

const sitePages = PAGES.map((p) => {
  const template = p.template || 'standard';
  if (!templateKeys.has(template)) throw new Error(`${p.id}: unknown layout "${template}"`);
  return {
    id: p.id,
    title: p.title,
    menu_label: p.menuLabel || '',
    slug: p.slug,
    parent_id: p.parent || null,
    sort: p.sort || 0,
    template,
    in_menu: p.menu === false ? 0 : 1,
    seo_description: seo[p.id] || '',
    blocks: blocksFor(p.id),
  };
});

const byId = new Map(sitePages.map((p) => [p.id, p]));
for (const p of sitePages) {
  if (p.parent_id && !byId.has(p.parent_id)) throw new Error(`${p.id}: parent "${p.parent_id}" is not a page`);
  if (p.parent_id && byId.get(p.parent_id).parent_id) {
    throw new Error(`${p.id}: menu depth is two levels; "${p.parent_id}" is already a child`);
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('PAGE', 20) + pad('ADDRESS', 20) + pad('LAYOUT', 10) + pad('MENU', 6) + 'BLOCKS');
for (const p of sitePages) {
  console.log(pad((p.parent_id ? '  ' : '') + p.id, 20) + pad(p.slug, 20) + pad(p.template, 10) +
    pad(p.in_menu ? 'yes' : '—', 6) + (p.blocks.length ? p.blocks.map((b) => b.type).join(', ') : '(none found)'));
}
const empty = sitePages.filter((p) => !p.blocks.length).map((p) => p.id);
if (empty.length) console.log('\nno blocks extracted for: ' + empty.join(', ') + ' — these open as an empty page in the editor');

if (DRY) {
  console.log('\n--dry-run: nothing written');
  process.exit(0);
}

const seedsOut = `// GENERATED by tools/extract-pages.mjs — do not edit by hand.
//
// The blocks each ministry page starts from when it is taken over in the page
// editor, lifted from the hardcoded markup that used to render it. Seeded into
// the DRAFT only: the live page keeps rendering exactly as it does today until
// someone opens the editor, looks it over, and presses Publish.
export const PAGE_SEEDS = ${JSON.stringify(seeds, null, 2)};
`;
fs.writeFileSync(path.join(HERE, '..', 'admin', 'page-seeds.js'), seedsOut);

const siteOut = `// GENERATED by tools/extract-pages.mjs — do not edit by hand.
//
// Every page on the site: its menu placement, layout, search summary, and the
// blocks it starts from. Seeded into each page's DRAFT only — a page keeps
// rendering its hardcoded markup in public/index.html until someone opens it in
// the editor and presses Publish.
export const SITE_PAGES = ${JSON.stringify(sitePages, null, 2)};
`;
fs.writeFileSync(path.join(HERE, '..', 'admin', 'site-pages.js'), siteOut);

console.log('\nwrote admin/page-seeds.js (' + Math.round(seedsOut.length / 1024) + ' KB)');
console.log('wrote admin/site-pages.js (' + Math.round(siteOut.length / 1024) + ' KB)');
