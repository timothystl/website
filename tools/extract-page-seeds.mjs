// One-time converter: reads the hardcoded ministry pages out of
// public/index.html and writes admin/page-seeds.js, the block list each page
// starts from when staff take it over in the editor.
//
//   node tools/extract-page-seeds.mjs
//
// Run it again whenever a ministry page's hardcoded markup changes and the seed
// has not been published yet. It is a development tool, not part of the deploy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeBlocks, newBlock } from '../admin/blocks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, '..', 'public', 'index.html'), 'utf8');

const SLUGS = ['music', 'stephen', 'foodpantry', 'bees', 'christmasmarket',
  'youth', 'sundayschool', 'confirmation', 'vbs', 'egghunt', 'family'];

// Regions the SPA fills from the admin API. They must not be baked into a seed
// or the content would end up on the page twice.
const DYNAMIC_IDS = /-(content|admin-content|upcoming|past|concert|admin-cta)-?section$|^[a-z]+-admin-cta$/;

const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '').trim();
const text = (s) => strip(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
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

function convert(slug) {
  const chunk = pageChunk(slug);
  if (!chunk) return [];
  const blocks = [];
  const push = (type, over) => { const b = newBlock(type, over); if (b) blocks.push(b); };

  // 1. the page banner
  // most pages use a plain <div class="page-hero">; Music also carries an id
  const hero = chunk.match(/<div [^>]*class="[^"]*page-hero[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<!--[\s\S]*?-->\s*)*<(?:section|div)/i);
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

const seeds = {};
for (const slug of SLUGS) {
  const blocks = sanitizeBlocks(foldHeadings(convert(slug)));
  if (blocks.length) seeds[slug] = blocks;
  console.log(`${slug.padEnd(18)} ${blocks.length} blocks  ${blocks.map((b) => b.type).join(', ')}`);
}

const out = `// GENERATED by tools/extract-page-seeds.mjs — do not edit by hand.
//
// The blocks each ministry page starts from when it is taken over in the page
// editor, lifted from the hardcoded markup that used to render it. Seeded into
// the DRAFT only: the live page keeps rendering exactly as it does today until
// someone opens the editor, looks it over, and presses Publish.
export const PAGE_SEEDS = ${JSON.stringify(seeds, null, 2)};
`;
fs.writeFileSync(path.join(HERE, '..', 'admin', 'page-seeds.js'), out);
console.log('\nwrote admin/page-seeds.js (' + Math.round(out.length / 1024) + ' KB)');
