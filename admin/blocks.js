// ── MINISTRY PAGE BLOCKS — the single shared renderer ────────────────────────
//
// A ministry page is an ordered array of typed blocks. This module owns:
//   • the block schema (types, defaults, allowed values)
//   • server-side sanitisation of anything written by a client
//   • the HTML templates for every block type
//
// CRITICAL: this is the ONLY place a block turns into HTML. The public site
// and the editor canvas both render through renderPage()/renderBlock(), so the
// two can never drift — that is the whole point of a WYSIWYG editor. If you
// add a block type, add it here and it appears in both places at once.
//
// How the editor avoids re-rendering on every keystroke/click:
// every visual knob a staff member can turn (spacing, colours, text size,
// column split, gap, spacer height) is emitted as a CSS custom property on the
// block wrapper. The editor changes the property on the DOM node directly and
// the browser repaints — no round trip, no second copy of these templates.
// Only structural changes (add / delete / duplicate / reorder / undo / reset)
// ask the Worker to re-render, and those are rare enough that a ~50ms fetch is
// imperceptible.

// ── PALETTES (guardrails: staff can only pick from these) ────────────────────

export const BG = [
  { name: 'Parchment', c: '#FBF8F3', dark: false },
  { name: 'Sand',      c: '#F7F3EC', dark: false },
  { name: 'Mist',      c: '#EDF2F7', dark: false },
  { name: 'Navy',      c: '#1E2D4A', dark: true },
];

export const INK = [
  { name: 'Ink',   c: '#3A3A4A', onDark: false },
  { name: 'Navy',  c: '#1E2D4A', onDark: false },
  { name: 'Slate', c: '#6A6858', onDark: false },
  { name: 'Cream', c: '#F3EDE1', onDark: true },
  { name: 'Gold',  c: '#C9973A', onDark: true },
];

export const SIZES = [
  { key: 's', label: 'S', body: 14, head: 19, hero: 30 },
  { key: 'm', label: 'M', body: 15, head: 22, hero: 38 },
  { key: 'l', label: 'L', body: 17, head: 26, hero: 46 },
];

export const SPLITS = [
  { key: '50', label: '50/50', a: '1fr', b: '1fr', text: 'Photo 50% · Text 50%' },
  { key: '40', label: '40/60', a: '4fr', b: '6fr', text: 'Photo 40% · Text 60%' },
  { key: '30', label: '30/70', a: '3fr', b: '7fr', text: 'Photo 30% · Text 70%' },
  { key: '70', label: '70/30', a: '7fr', b: '3fr', text: 'Photo 70% · Text 30%' },
];

export const TONES = [
  { name: 'Gold',  bg: '#C9973A', fg: '#1B1608' },
  { name: 'Navy',  bg: '#1E2D4A', fg: '#F5E4C0' },
  { name: 'Green', bg: '#4A5E3A', fg: '#F0F5EC' },
];

export const STAMP_PRESETS = ['New', 'Upcoming', 'Take note', 'Registration open'];

// Spacing guardrail: 8px steps, 0–96. No free-form pixel input anywhere.
export const SPACE_STEP = 8;
export const SPACE_MAX = 96;
export const snapSpace = (v) => Math.max(0, Math.min(SPACE_MAX, Math.round((Number(v) || 0) / SPACE_STEP) * SPACE_STEP));

// ── BLOCK TYPES ──────────────────────────────────────────────────────────────
// `items` blocks carry a small repeating list (FAQ rows, meeting times, …).
// itemFields lists the plain-text fields each row has; `rich` marks the ones
// edited as rich text. Anything not listed is dropped on save.

export const BLOCK_DEFS = {
  hero: {
    label: 'Hero banner', glyph: '▣', group: 'Structure',
    defaults: { title: 'Ministry name', body: 'Ministry', spaceAbove: 0, spaceBelow: 24 },
    photo: true,
  },
  text: {
    label: 'Rich text', glyph: '¶', group: 'Content',
    defaults: { body: '<p>Tell people what this ministry is and who it is for.</p>', spaceAbove: 8, spaceBelow: 8 },
    richBody: true,
  },
  textphoto: {
    label: 'Text + photo', glyph: '◲', group: 'Content',
    defaults: { title: 'A heading', body: '<p>A short paragraph beside the photo.</p>', spaceAbove: 24, spaceBelow: 24 },
    richBody: true, photo: true,
  },
  columns: {
    label: 'Columns', glyph: '▥', group: 'Content',
    defaults: { title: 'Three ways to take part', spaceAbove: 24, spaceBelow: 24, cols: 2 },
    items: true, itemFields: ['title', 'body'], richItemFields: ['body'],
    itemLabel: 'Column',
    defaultItems: [
      { title: 'First', body: '<p>What happens here.</p>' },
      { title: 'Second', body: '<p>What happens here.</p>' },
    ],
  },
  video: {
    label: 'Video', glyph: '▶', group: 'Content',
    defaults: { title: 'Watch', spaceAbove: 24, spaceBelow: 24 },
    video: true,
  },
  gallery: {
    label: 'Photo gallery', glyph: '▦', group: 'Content',
    defaults: { title: 'Through the church year', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['url', 'title'], itemUrlFields: ['url'], itemLabel: 'Photo', gallery: true,
    defaultItems: [],
  },
  posts: {
    label: 'Posts feed', glyph: '☰', group: 'Content',
    defaults: { title: 'From this ministry', spaceAbove: 24, spaceBelow: 24 },
    feed: 'posts',
  },
  faq: {
    label: 'FAQ', glyph: '?', group: 'Content',
    defaults: { title: 'Questions people ask', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['title', 'body'], richItemFields: ['body'], itemLabel: 'Question',
    defaultItems: [{ title: 'A question people ask', body: '<p>The answer.</p>' }],
  },
  events: {
    label: 'Upcoming events', glyph: '▤', group: 'Dates',
    defaults: { title: 'Upcoming', spaceAbove: 24, spaceBelow: 24 },
    feed: 'events',
  },
  times: {
    label: 'Meeting times', glyph: '◷', group: 'Dates',
    defaults: { title: 'When we gather', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['title', 'body', 'meta'], itemLabel: 'Row',
    itemPlaceholders: { title: 'Who', body: 'When', meta: 'Where' },
    defaultItems: [{ title: 'Group name', body: 'Wednesdays, 7:00 pm', meta: 'Fellowship Hall' }],
  },
  calendar: {
    label: 'Calendar', glyph: '▩', group: 'Dates',
    defaults: { title: 'Calendar', spaceAbove: 24, spaceBelow: 24, url: '' },
    url: true, urlLabel: 'Google Calendar embed URL',
  },
  download: {
    label: 'File download', glyph: '⤓', group: 'Dates',
    defaults: { title: 'A document to download', body: 'PDF', spaceAbove: 16, spaceBelow: 16 },
    url: true, urlLabel: 'File URL',
  },
  callout: {
    label: 'Callout box', glyph: '❢', group: 'Structure',
    defaults: { title: 'Please note', body: '<p>Something people need to know.</p>', spaceAbove: 24, spaceBelow: 24 },
    richBody: true,
  },
  buttons: {
    label: 'Button bar', glyph: '⬒', group: 'Structure',
    defaults: { spaceAbove: 16, spaceBelow: 16 },
    items: true, itemFields: ['title', 'url'], itemUrlFields: ['url'], itemLabel: 'Button',
    itemPlaceholders: { title: 'Button label', url: 'https://…' },
    defaultItems: [{ title: 'Get in touch', url: 'mailto:office@timothystl.org' }],
  },
  spacer: {
    label: 'Spacer', glyph: '↕', group: 'Structure',
    defaults: { spaceAbove: 0, spaceBelow: 0, height: 48 },
  },
  partners: {
    label: 'Partner logos', glyph: '◈', group: 'Structure',
    defaults: { title: 'With thanks to', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['title', 'url', 'meta'], itemUrlFields: ['url', 'meta'], itemLabel: 'Partner',
    itemPlaceholders: { title: 'Partner name', url: 'Link (optional)', meta: 'Logo image URL' },
    defaultItems: [{ title: 'Partner name', url: '', meta: '' }],
  },
  form: {
    label: 'Signup form', glyph: '◉', group: 'Sign up',
    defaults: { title: 'Sign up', body: 'Fill this in and the office will be in touch.', spaceAbove: 24, spaceBelow: 24, url: '' },
    url: true, urlLabel: 'Google Form embed URL',
  },
  newsletter: {
    label: 'Newsletter', glyph: '✉', group: 'Sign up',
    defaults: { title: 'Get news by email', body: 'A short note each month.', spaceAbove: 24, spaceBelow: 24 },
  },
  give: {
    label: 'Give', glyph: '♡', group: 'Sign up',
    defaults: { title: 'Support this ministry', body: 'Gifts go directly toward this work.', spaceAbove: 24, spaceBelow: 24, url: 'https://give.timothystl.org' },
    url: true, urlLabel: 'Giving link',
  },
};

export const GROUPS = [
  { name: 'Content',   types: ['text', 'textphoto', 'columns', 'video', 'gallery', 'posts', 'faq'] },
  { name: 'Dates',     types: ['events', 'times', 'calendar', 'download'] },
  { name: 'Structure', types: ['hero', 'callout', 'buttons', 'spacer', 'partners'] },
  { name: 'Sign up',   types: ['form', 'newsletter', 'give'] },
];

export const BLOCK_TYPE_KEYS = Object.keys(BLOCK_DEFS);

// ── ESCAPING / SANITISING ────────────────────────────────────────────────────

export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// URLs that are safe to put in href/src. Everything else is dropped rather
// than "fixed" — a silently rewritten link is worse than a missing one.
export function safeUrl(u) {
  // Quotes, angle brackets, backslashes and raw whitespace are never valid in a
  // URL (they must be percent-encoded), and every one of them is an escape
  // character in some context we drop URLs into. Strip them up front so no
  // downstream template has to be clever about it.
  const s = String(u || '').trim().replace(/["'<>\\`\s\u0000-\u001F\u007F]/g, '');
  if (!s) return '';
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  if (/^[/#]/.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s; // bare domain typed by staff
  return '';
}

const RICH_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'a', 'h2', 'h3', 'h4', 'blockquote', 'span', 'div', 'img', 'hr', 'sup', 'sub']);
const RICH_ATTRS = { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'] };
const RICH_VOID = new Set(['br', 'img', 'hr']);
const RICH_DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[\s\S]*?(<\/\1\s*>|$)/gi;

// TinyMCE output is user input. Only staff can reach the editor, but a stored
// XSS here would run in another staff member's authenticated admin session —
// the cross-privilege escalation path called out in the July 2026 review.
export function sanitizeRich(input) {
  if (!input) return '';
  let s = String(input).slice(0, 40000);
  s = s.replace(RICH_DROP_WITH_CONTENT, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!RICH_TAGS.has(t)) return '';
    if (match.startsWith('</')) return RICH_VOID.has(t) ? '' : '</' + t + '>';
    const allowed = RICH_ATTRS[t] || [];
    let out = '';
    const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = re.exec(attrs)) !== null) {
      const name = m[1].toLowerCase();
      if (!allowed.includes(name)) continue;
      let val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : (m[4] || '');
      if (name === 'href' || name === 'src') {
        val = safeUrl(val);
        if (!val) continue;
      }
      if ((name === 'width' || name === 'height') && !/^\d{1,4}$/.test(val)) continue;
      if (name === 'target') val = '_blank';
      out += ' ' + name + '="' + esc(val) + '"';
    }
    if (t === 'a' && / href=/.test(out)) out += ' rel="noopener noreferrer"';
    return '<' + t + out + '>';
  });
  return s;
}

export const cleanText = (s, max = 200) => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

const clampIndex = (v, n) => {
  const i = Math.floor(Number(v));
  return Number.isFinite(i) && i >= 0 && i < n ? i : 0;
};

let idSeq = 0;
export function makeBlockId() {
  idSeq = (idSeq + 1) % 100000;
  return 'b' + Date.now().toString(36) + idSeq.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

export function newBlock(type, over = {}) {
  const def = BLOCK_DEFS[type];
  if (!def) return null;
  const d = def.defaults || {};
  return sanitizeBlock(Object.assign({
    id: makeBlockId(),
    type,
    title: d.title || '',
    body: d.body || '',
    url: d.url || '',
    spaceAbove: d.spaceAbove == null ? 24 : d.spaceAbove,
    spaceBelow: d.spaceBelow == null ? 24 : d.spaceBelow,
    gap: 32,
    height: d.height == null ? 48 : d.height,
    split: '40',
    side: 'left',
    cols: d.cols || 2,
    bg: 0,
    ink: 0,
    size: 'm',
    photo: '',
    photoAlt: '',
    video: '',
    stamp: '',
    tone: 0,
    corner: 'tr',
    hidden: false,
    items: def.items ? JSON.parse(JSON.stringify(def.defaultItems || [])) : [],
  }, over));
}

// Never trust the client. Client-side clamping is a courtesy; this is the
// control. A stale tab must not be able to write spaceAbove:900 or a hex colour.
export function sanitizeBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const def = BLOCK_DEFS[b.type];
  if (!def) return null; // unknown type → dropped entirely
  const richBody = !!def.richBody;
  const out = {
    id: cleanText(b.id, 32) || makeBlockId(),
    type: b.type,
    title: cleanText(b.title, 200),
    body: richBody ? sanitizeRich(b.body) : cleanText(b.body, 600),
    url: safeUrl(b.url).slice(0, 600),
    spaceAbove: snapSpace(b.spaceAbove),
    spaceBelow: snapSpace(b.spaceBelow),
    gap: snapSpace(b.gap == null ? 32 : b.gap),
    height: snapSpace(b.height == null ? 48 : b.height),
    split: SPLITS.some((s) => s.key === b.split) ? b.split : '40',
    side: ['left', 'right', 'above'].includes(b.side) ? b.side : 'left',
    cols: Number(b.cols) === 3 ? 3 : 2,
    bg: clampIndex(b.bg, BG.length),
    ink: clampIndex(b.ink, INK.length),
    size: SIZES.some((s) => s.key === b.size) ? b.size : 'm',
    photo: safeUrl(b.photo).slice(0, 600),
    photoAlt: cleanText(b.photoAlt, 200),
    video: safeUrl(b.video).slice(0, 600),
    stamp: cleanText(b.stamp, 40),
    tone: clampIndex(b.tone, TONES.length),
    corner: b.corner === 'tl' ? 'tl' : 'tr',
    hidden: !!b.hidden,
    items: [],
  };
  // Colour guardrail, enforced server-side too: an ink that is unreadable on
  // the chosen background snaps back to a readable one.
  if (INK[out.ink].onDark !== BG[out.bg].dark) out.ink = BG[out.bg].dark ? 3 : 0;

  if (def.items && Array.isArray(b.items)) {
    const fields = def.itemFields || [];
    const rich = def.richItemFields || [];
    const urls = def.itemUrlFields || [];
    out.items = b.items.slice(0, 24).map((raw) => {
      const item = {};
      for (const f of fields) {
        const v = raw && raw[f] != null ? raw[f] : '';
        if (urls.includes(f)) item[f] = safeUrl(v).slice(0, 600);
        else if (rich.includes(f)) item[f] = sanitizeRich(v);
        else item[f] = cleanText(v, 300);
      }
      return item;
    });
  }
  return out;
}

export function sanitizeBlocks(arr) {
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (_) { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  return arr.slice(0, 120).map(sanitizeBlock).filter(Boolean).map((b) => {
    while (seen.has(b.id)) b.id = makeBlockId();
    seen.add(b.id);
    return b;
  });
}

export function parseBlocks(json) {
  if (!json) return [];
  try {
    const v = typeof json === 'string' ? JSON.parse(json) : json;
    return Array.isArray(v) ? v : [];
  } catch (_) { return []; }
}

// ── LEGACY MIGRATION ─────────────────────────────────────────────────────────
// Turns a pre-blocks youth_pages row into an equivalent block list so nothing
// staff wrote is lost. The legacy columns are deliberately left in place: they
// are the rollback path until every page has been published from the new
// editor at least once.

// Deliberately does NOT emit a hero block from hero_image_url. On this site the
// public ministry page is an SPA view whose banner is part of the page frame,
// driven by hero_image_url; blocks render into the content region below it. A
// migrated hero block would draw a *second* banner under the real one, which
// breaks the "looks the same as before" bar Phase 1 has to clear. Staff can add
// a hero block deliberately if they want one mid-page.
export function migrateLegacyPage(row) {
  const blocks = [];
  const push = (type, over) => { const b = newBlock(type, over); if (b) blocks.push(b); };

  const content = (row.content || '').trim();
  if (content && row.ministry_image_url) {
    // The one legacy layout that was genuinely two-column: body text with the
    // ministry photo alongside it (the Music page).
    push('textphoto', { body: content, photo: row.ministry_image_url, photoAlt: row.title || '', side: 'right', split: '40' });
  } else if (content) {
    push('text', { body: content });
  } else if (row.ministry_image_url) {
    push('textphoto', { body: '', photo: row.ministry_image_url, photoAlt: row.title || '', side: 'above' });
  }

  for (const i of [1, 2, 3]) {
    const url = row['vid_' + i + '_url'];
    if (url) push('video', { title: row['vid_' + i + '_title'] || 'Watch', video: url });
  }

  const buttons = [];
  if (row.cta_label && row.cta_url) buttons.push({ title: row.cta_label, url: row.cta_url });
  if (row.cta_label_2 && row.cta_url_2) buttons.push({ title: row.cta_label_2, url: row.cta_url_2 });
  if (buttons.length) push('buttons', { items: buttons });

  if (row.has_posts) push('posts', { title: 'From this ministry' });

  return sanitizeBlocks(blocks);
}

// A brand-new page starts from three sensible blocks rather than a blank
// canvas — an empty page is intimidating, three blocks are not.
export function starterBlocks(title) {
  return sanitizeBlocks([
    newBlock('hero', { title: title || 'Ministry name', body: 'Ministry' }),
    newBlock('text', { body: '<p>Tell people what this ministry is and who it is for.</p>' }),
    newBlock('buttons', { items: [{ title: 'Contact the office', url: 'mailto:office@timothystl.org' }] }),
  ]);
}

// ── STYLESHEET ───────────────────────────────────────────────────────────────
// Shipped once per page (renderPage prepends it). Class-prefixed `tlcb-` so it
// cannot collide with the public site's own stylesheet or the admin shell.

export const BLOCK_CSS = `<style id="tlcb-css">
.tlcb-page{--tlcb-pad:24px;font-family:'Source Sans 3',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
.tlcb{position:relative;border-radius:10px;background:var(--tlcb-bg,#FBF8F3);color:var(--tlcb-ink,#3A3A4A);
  padding:14px var(--tlcb-pad);border:2px solid transparent;}
.tlcb--hero{padding:0;}
.tlcb--spacer{padding:0 var(--tlcb-pad);}
.tlcb *{box-sizing:border-box;}
.tlcb-head{font-family:Lora,Georgia,serif;font-weight:500;line-height:1.25;margin:0;
  font-size:var(--tlcb-head,22px);color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-prose{font-size:var(--tlcb-body,15px);line-height:1.75;color:var(--tlcb-ink,#3A3A4A);text-wrap:pretty;}
.tlcb-prose > :first-child{margin-top:0;}
.tlcb-prose > :last-child{margin-bottom:0;}
.tlcb-prose p{margin:0 0 .8em;}
.tlcb-prose a{color:#2E7EA6;}
.tlcb-prose ul,.tlcb-prose ol{margin:0 0 .8em;padding-left:1.3em;}
.tlcb-prose img{max-width:100%;height:auto;border-radius:8px;}
.tlcb-stack{display:flex;flex-direction:column;gap:12px;}
.tlcb-grid{display:grid;grid-template-columns:var(--tlcb-cols,1fr 1fr);gap:var(--tlcb-gap,32px);align-items:center;}
.tlcb-cols{display:grid;grid-template-columns:var(--tlcb-cols,1fr 1fr);gap:var(--tlcb-gap,32px);align-items:start;}
.tlcb-media{order:var(--tlcb-media-order,0);min-height:150px;border-radius:8px;background:#E4EAF2 center/cover no-repeat;
  display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;}
.tlcb-media img{width:100%;height:100%;object-fit:cover;display:block;border-radius:8px;}
.tlcb-hero{border-radius:8px;min-height:196px;padding:22px var(--tlcb-pad);display:flex;flex-direction:column;
  justify-content:flex-end;background:linear-gradient(180deg,rgba(30,45,74,.12),rgba(30,45,74,.72)),var(--tlcb-hero-img,linear-gradient(135deg,#43536F,#1E2D4A));
  background-size:cover;background-position:center;position:relative;}
.tlcb-hero-eyebrow{font:600 11px/1 'Source Sans 3',sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#E8C070;}
.tlcb-hero-title{font-family:Lora,Georgia,serif;font-weight:500;font-size:var(--tlcb-hero,38px);line-height:1.1;color:#FBF8F3;margin:8px 0 0;}
.tlcb-embed{position:relative;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#1E2D4A;}
.tlcb-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
.tlcb-embed-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#FBF8F3;font-size:30px;}
.tlcb-gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.tlcb-gallery span,.tlcb-gallery img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:7px;background:#DDE3ED;}
.tlcb-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.tlcb-card{border:1px solid #DDE3ED;border-radius:8px;background:#F7F3EC;padding:11px;display:flex;flex-direction:column;gap:6px;}
.tlcb-card-t{font:600 12.5px/1.3 'Source Sans 3',sans-serif;color:#1E2D4A;}
.tlcb-card-m{font-size:11px;color:#8A8898;}
.tlcb-rows{display:flex;flex-direction:column;gap:8px;}
.tlcb-row{display:flex;align-items:center;gap:14px;padding:11px 13px;border:1px solid #DDE3ED;border-radius:8px;background:#F7F3EC;}
.tlcb-row-d{flex:none;width:60px;text-align:center;font:700 12.5px/1.3 'Source Sans 3',sans-serif;color:#1E2D4A;letter-spacing:.03em;}
.tlcb-row-b{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;}
.tlcb-row-n{font:600 13.5px/1.3 'Source Sans 3',sans-serif;color:#1E2D4A;}
.tlcb-row-m{font-size:12px;color:#8A8898;}
.tlcb-times{display:flex;flex-direction:column;}
.tlcb-time{display:grid;grid-template-columns:1.2fr 1.3fr 1fr;gap:12px;padding:10px 2px;border-bottom:1px solid #EDE9E0;font-size:13.5px;}
.tlcb-time b{font-weight:600;color:#1E2D4A;}
.tlcb-time i{font-style:normal;color:#4A4860;}
.tlcb-time u{text-decoration:none;color:#8A8898;}
.tlcb-faq{padding:12px 14px;border:1px solid #DDE3ED;border-radius:8px;background:#F7F3EC;}
.tlcb-faq summary{font:600 13.5px/1.35 'Source Sans 3',sans-serif;color:#1E2D4A;cursor:pointer;list-style:none;
  display:flex;align-items:center;gap:10px;justify-content:space-between;}
.tlcb-faq summary::-webkit-details-marker{display:none;}
.tlcb-faq summary::after{content:'⌄';color:#8A8898;font-size:13px;}
.tlcb-faq[open] summary::after{content:'⌃';}
.tlcb-faq .tlcb-prose{margin-top:6px;font-size:13px;}
.tlcb-callout{padding:18px 20px;border-radius:10px;background:#FDF8EC;border:1px solid #F0DCB0;display:flex;flex-direction:column;gap:7px;}
.tlcb-callout-tag{align-self:flex-start;padding:2px 8px;border-radius:5px;background:#C9973A;color:#1B1608;
  font:700 10px/1.6 'Source Sans 3',sans-serif;letter-spacing:.1em;text-transform:uppercase;}
.tlcb-callout-t{font:600 16px/1.35 'Source Sans 3',sans-serif;color:#1E2D4A;}
.tlcb-btns{display:flex;gap:10px;flex-wrap:wrap;}
.tlcb-btn{display:inline-block;padding:11px 20px;border-radius:8px;font:600 14px/1 'Source Sans 3',sans-serif;text-decoration:none;
  background:#1E2D4A;color:#F5E4C0;border:1px solid #1E2D4A;}
.tlcb-btn--ghost{background:transparent;color:#1E2D4A;border:1px solid #C4CEDF;}
.tlcb-panel{display:flex;flex-direction:column;gap:10px;padding:18px 20px;border:1px solid #DDE3ED;border-radius:9px;background:#EDF2F7;}
.tlcb-panel--form{background:#F7F3EC;}
.tlcb-field{height:38px;border:1px solid #C7CEDA;border-radius:7px;background:#fff;padding:0 12px;font-size:13px;width:100%;}
.tlcb-inline{display:flex;gap:9px;align-items:center;flex-wrap:wrap;}
.tlcb-inline .tlcb-field{flex:1;min-width:180px;}
.tlcb-give{display:flex;flex-direction:column;gap:11px;padding:20px;border-radius:10px;background:#1E2D4A;}
.tlcb-give .tlcb-head{color:#F3EDE1;}
.tlcb-give-note{font-size:14px;line-height:1.7;color:#C4CEDF;}
.tlcb-chip{padding:8px 14px;border:1px solid rgba(245,228,192,.4);border-radius:7px;color:#F3EDE1;
  font:600 13px/1 'Source Sans 3',sans-serif;text-decoration:none;}
.tlcb-chip--go{background:#C9973A;color:#1B1608;border-color:#C9973A;padding:10px 18px;font-weight:700;}
.tlcb-dl{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid #DDE3ED;border-radius:9px;background:#F7F3EC;}
.tlcb-dl-i{flex:none;width:38px;height:46px;border-radius:5px;background:#FBF8F3;border:1px solid #C4CEDF;display:flex;
  align-items:center;justify-content:center;font:700 10px/1 'Source Sans 3',sans-serif;color:#8A8898;}
.tlcb-dl-b{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;}
.tlcb-dl-t{font:600 14px/1.35 'Source Sans 3',sans-serif;color:#1E2D4A;}
.tlcb-dl-m{font-size:12px;color:#8A8898;}
.tlcb-logos{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.tlcb-logo{height:56px;border:1px solid #DDE3ED;border-radius:7px;background:#F7F3EC;display:flex;align-items:center;
  justify-content:center;font-size:11px;color:#6A6858;letter-spacing:.06em;text-align:center;padding:6px;overflow:hidden;text-decoration:none;}
.tlcb-logo img{max-width:100%;max-height:100%;object-fit:contain;}
.tlcb-spacer{height:var(--tlcb-height,48px);}
.tlcb-note{font-size:11.5px;color:#8A8898;}
.tlcb-stamp{position:absolute;z-index:4;bottom:14px;padding:7px 15px;border-radius:7px;
  font:700 13px/1.3 'Source Sans 3',sans-serif;letter-spacing:.1em;text-transform:uppercase;
  box-shadow:0 5px 16px rgba(30,45,74,.3);white-space:nowrap;}
.tlcb-stamp--tl{left:10px;right:auto;transform:rotate(-8deg);}
.tlcb-stamp--tr{right:10px;left:auto;transform:rotate(8deg);}
.tlcb-empty{margin:40px;padding:52px 28px;border:2px dashed #C4CEDF;border-radius:12px;text-align:center;
  display:flex;flex-direction:column;gap:8px;}
.tlcb-empty b{font:500 22px/1.2 Lora,Georgia,serif;color:#1E2D4A;font-weight:500;}
.tlcb-empty span{font-size:13.5px;color:#8A8898;}
@media(max-width:640px){
  .tlcb-grid,.tlcb-cols{grid-template-columns:1fr!important;}
  .tlcb-media{order:0!important;}
  .tlcb-cards{grid-template-columns:1fr!important;}
  .tlcb-gallery{grid-template-columns:1fr 1fr!important;}
  .tlcb-logos{grid-template-columns:1fr 1fr!important;}
  .tlcb-time{grid-template-columns:1fr!important;gap:2px;}
  .tlcb-hero-title{font-size:calc(var(--tlcb-hero,38px) * .74)!important;}
  .tlcb-hide-phone{display:none!important;}
}
</style>`;

// ── RENDERING ────────────────────────────────────────────────────────────────

const sizeOf = (b) => SIZES.find((s) => s.key === b.size) || SIZES[1];
const splitOf = (b) => SPLITS.find((s) => s.key === b.split) || SPLITS[1];

// A URL going into a CSS url() inside a style="" attribute has two escape
// contexts stacked (HTML attribute, then CSS string). Rather than reason about
// both, strip every character that could close either one — a legitimate image
// URL never contains them.
const cssUrl = (u) => String(u || '').replace(/["'\\()\s<>;{}]/g, '');

function wrapperVars(b) {
  const sz = sizeOf(b);
  const sp = splitOf(b);
  const bg = BG[b.bg] || BG[0];
  const ink = INK[b.ink] || INK[0];
  const cols = b.side === 'above' ? '1fr' : (b.side === 'right' ? sp.b + ' ' + sp.a : sp.a + ' ' + sp.b);
  const v = [
    '--tlcb-bg:' + bg.c,
    '--tlcb-ink:' + ink.c,
    '--tlcb-head-ink:' + (bg.dark ? '#F3EDE1' : '#1E2D4A'),
    '--tlcb-body:' + sz.body + 'px',
    '--tlcb-head:' + sz.head + 'px',
    '--tlcb-hero:' + sz.hero + 'px',
    '--tlcb-gap:' + b.gap + 'px',
    '--tlcb-height:' + b.height + 'px',
    '--tlcb-media-order:' + (b.side === 'right' ? 2 : 0),
    'margin-top:' + b.spaceAbove + 'px',
    'margin-bottom:' + b.spaceBelow + 'px',
  ];
  if (b.type === 'textphoto') v.push('--tlcb-cols:' + cols);
  if (b.type === 'columns') v.push('--tlcb-cols:repeat(' + b.cols + ',1fr)');
  if (b.type === 'hero' && b.photo) v.push("--tlcb-hero-img:url('" + cssUrl(b.photo) + "')");
  return v.join(';');
}

// In editing mode text fields become contenteditable and carry data-field so
// the editor can commit them on blur. On the public site they are plain HTML.
function field(opts, b, key, tag, cls, value, extra = '') {
  const content = value == null ? '' : value;
  if (!opts.editing) return `<${tag} class="${cls}"${extra}>${content}</${tag}>`;
  return `<${tag} class="${cls}" data-field="${key}" contenteditable="true" spellcheck="true"${extra}>${content}</${tag}>`;
}

function itemField(opts, idx, key, tag, cls, value, extra = '') {
  const content = value == null ? '' : value;
  if (!opts.editing) return `<${tag} class="${cls}"${extra}>${content}</${tag}>`;
  return `<${tag} class="${cls}" data-item="${idx}" data-field="${key}" contenteditable="true" spellcheck="true"${extra}>${content}</${tag}>`;
}

const ytId = (u) => (String(u || '').match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/) || [])[1] || '';

function renderBody(opts, b, def) {
  const val = def.richBody ? (b.body || '') : esc(b.body || '');
  return field(opts, b, 'body', 'div', 'tlcb-prose', val);
}

function renderHead(opts, b) {
  return field(opts, b, 'title', 'div', 'tlcb-head', esc(b.title || ''));
}

function renderStamp(opts, b) {
  if (!b.stamp) return '';
  const t = TONES[b.tone] || TONES[0];
  const style = `background:${t.bg};color:${t.fg}`;
  const editable = opts.editing ? ' data-field="stamp" contenteditable="true"' : '';
  return `<span class="tlcb-stamp tlcb-stamp--${b.corner === 'tl' ? 'tl' : 'tr'}" style="${style}"${editable}>${esc(b.stamp)}</span>`;
}

function renderInner(b, opts) {
  const def = BLOCK_DEFS[b.type];
  const t = b.type;

  if (t === 'hero') {
    const change = opts.editing
      ? `<button type="button" class="tlcb-pick" data-act="photo">Change photo</button>` : '';
    return `<div class="tlcb-hero">${change}
      ${field(opts, b, 'body', 'div', 'tlcb-hero-eyebrow', esc(b.body || 'Ministry'))}
      ${field(opts, b, 'title', 'div', 'tlcb-hero-title', esc(b.title || ''))}
    </div>`;
  }

  if (t === 'text') return renderBody(opts, b, def);

  if (t === 'textphoto') {
    const img = b.photo
      ? `<img src="${esc(b.photo)}" alt="${esc(b.photoAlt)}" loading="lazy">`
      : `<span class="tlcb-note">No photo yet</span>`;
    const pick = opts.editing ? `<button type="button" class="tlcb-pick tlcb-pick--on" data-act="photo">Change photo</button>` : '';
    return `<div class="tlcb-grid">
      <div class="tlcb-media">${img}${pick}</div>
      <div class="tlcb-stack" style="gap:9px">${renderHead(opts, b)}${renderBody(opts, b, def)}</div>
    </div>`;
  }

  if (t === 'columns') {
    const cells = (b.items || []).map((it, i) => `<div class="tlcb-stack" style="gap:7px">
        ${itemField(opts, i, 'title', 'div', 'tlcb-head', esc(it.title || ''), ' style="font-size:calc(var(--tlcb-head,22px) * .8)"')}
        ${itemField(opts, i, 'body', 'div', 'tlcb-prose', it.body || '')}
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-cols">${cells}</div></div>`;
  }

  if (t === 'video') {
    const id = ytId(b.video);
    const media = id
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}" title="${esc(b.title || 'Video')}" allowfullscreen loading="lazy"></iframe>`
      : `<span class="tlcb-embed-ph">▶</span>`;
    const pick = opts.editing ? `<button type="button" class="tlcb-pick tlcb-pick--on" data-act="video">Choose video</button>` : '';
    const inner = opts.editing && id
      ? `<span class="tlcb-embed-ph" style="background:#1E2D4A url('https://img.youtube.com/vi/${esc(id)}/mqdefault.jpg') center/cover">▶</span>`
      : media;
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-embed">${inner}${pick}</div></div>`;
  }

  if (t === 'gallery') {
    const tiles = (b.items || []).length
      ? b.items.map((it) => it.url
        ? `<img src="${esc(it.url)}" alt="${esc(it.title || '')}" loading="lazy">`
        : `<span></span>`).join('')
      : `<span></span><span></span><span></span>`;
    const pick = opts.editing ? `<button type="button" class="tlcb-pick tlcb-pick--inline" data-act="gallery">Manage photos</button>` : '';
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-gallery">${tiles}</div>${pick}</div>`;
  }

  if (t === 'posts' || t === 'events') {
    const feed = t === 'posts' ? 'posts' : 'events';
    const sample = opts.editing
      ? (t === 'posts'
        ? `<div class="tlcb-cards">${[1, 2, 3].map(() => `<div class="tlcb-card"><div style="height:44px;border-radius:5px;background:repeating-linear-gradient(135deg,#DDE3ED 0 8px,#D2DAE7 8px 16px)"></div><span class="tlcb-card-t">A post from this ministry</span><span class="tlcb-card-m">Date</span></div>`).join('')}</div>`
        : `<div class="tlcb-rows">${[1, 2, 3].map(() => `<div class="tlcb-row"><span class="tlcb-row-d">Date</span><span class="tlcb-row-b"><span class="tlcb-row-n">An upcoming event</span><span class="tlcb-row-m">Time · Place</span></span></div>`).join('')}</div>`)
      : '';
    const note = opts.editing
      ? `<span class="tlcb-note">${t === 'posts' ? 'Shows the newest posts for this ministry automatically.' : 'Shows upcoming dated posts for this ministry automatically.'}</span>`
      : '';
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div data-tlcb-feed="${feed}" data-slug="${esc(opts.slug || '')}">${sample}</div>${note}</div>`;
  }

  if (t === 'times') {
    const rows = (b.items || []).map((it, i) => `<div class="tlcb-time">
        ${itemField(opts, i, 'title', 'b', '', esc(it.title || ''))}
        ${itemField(opts, i, 'body', 'i', '', esc(it.body || ''))}
        ${itemField(opts, i, 'meta', 'u', '', esc(it.meta || ''))}
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-times">${rows}</div></div>`;
  }

  if (t === 'faq') {
    const rows = (b.items || []).map((it, i) => `<details class="tlcb-faq"${opts.editing ? ' open' : ''}>
        <summary>${itemField(opts, i, 'title', 'span', '', esc(it.title || ''))}</summary>
        ${itemField(opts, i, 'body', 'div', 'tlcb-prose', it.body || '')}
      </details>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-rows">${rows}</div></div>`;
  }

  if (t === 'callout') {
    return `<div class="tlcb-callout">
      <span class="tlcb-callout-tag">Please note</span>
      ${field(opts, b, 'title', 'div', 'tlcb-callout-t', esc(b.title || ''))}
      ${renderBody(opts, b, def)}
    </div>`;
  }

  if (t === 'buttons') {
    const btns = (b.items || []).map((it, i) => {
      const cls = 'tlcb-btn' + (i > 0 ? ' tlcb-btn--ghost' : '');
      if (opts.editing) return itemField(opts, i, 'title', 'span', cls, esc(it.title || ''));
      const href = safeUrl(it.url);
      return href ? `<a class="${cls}" href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(it.title || '')}</a>`
        : `<span class="${cls}">${esc(it.title || '')}</span>`;
    }).join('');
    return `<div class="tlcb-btns">${btns}</div>`;
  }

  if (t === 'spacer') {
    return opts.editing
      ? `<div class="tlcb-spacer" style="border:1px dashed #C4CEDF;border-radius:7px;display:flex;align-items:center;justify-content:center;font:600 11px/1 'Source Sans 3',sans-serif;color:#A8A69A;letter-spacing:.1em">${b.height}PX SPACE</div>`
      : `<div class="tlcb-spacer"></div>`;
  }

  if (t === 'partners') {
    const logos = (b.items || []).map((it) => {
      const inner = it.meta ? `<img src="${esc(it.meta)}" alt="${esc(it.title || '')}">` : esc(it.title || 'LOGO');
      const href = safeUrl(it.url);
      return href && !opts.editing
        ? `<a class="tlcb-logo" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
        : `<span class="tlcb-logo">${inner}</span>`;
    }).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-logos">${logos}</div></div>`;
  }

  if (t === 'download') {
    const href = safeUrl(b.url);
    const kind = esc((b.body || 'PDF').slice(0, 6).toUpperCase());
    const btn = href && !opts.editing
      ? `<a class="tlcb-btn tlcb-btn--ghost" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Download</a>`
      : `<span class="tlcb-btn tlcb-btn--ghost">Download</span>`;
    return `<div class="tlcb-dl">
      <span class="tlcb-dl-i">${kind}</span>
      <span class="tlcb-dl-b">${field(opts, b, 'title', 'span', 'tlcb-dl-t', esc(b.title || ''))}
        <span class="tlcb-dl-m">${href ? esc(href.split('/').pop().slice(0, 60)) : 'No file chosen yet'}</span></span>
      ${btn}
    </div>`;
  }

  if (t === 'calendar') {
    const src = safeUrl(b.url);
    const inner = src && !opts.editing
      ? `<iframe src="${esc(src)}" title="${esc(b.title || 'Calendar')}" loading="lazy" style="width:100%;height:520px;border:0;border-radius:9px"></iframe>`
      : `<div style="border:1px solid #DDE3ED;border-radius:9px;padding:26px;text-align:center;background:#F7F3EC;color:#8A8898;font-size:13px">${src ? 'Calendar embed' : 'Paste a Google Calendar embed URL in the panel on the right.'}</div>`;
    return `<div class="tlcb-stack">${renderHead(opts, b)}${inner}</div>`;
  }

  if (t === 'form') {
    const src = safeUrl(b.url);
    const inner = src && !opts.editing
      ? `<iframe src="${esc(src)}" title="${esc(b.title || 'Form')}" loading="lazy" style="width:100%;height:640px;border:0;border-radius:9px"></iframe>`
      : `<div class="tlcb-stack" style="gap:9px"><span class="tlcb-field"></span><span class="tlcb-field"></span>
          <span class="tlcb-btn" style="align-self:flex-start;background:#2E7EA6;border-color:#2E7EA6;color:#fff">Sign up</span>
          <span class="tlcb-note">${src ? 'Form embed' : 'Paste a Google Form URL in the panel on the right.'}</span></div>`;
    return `<div class="tlcb-panel tlcb-panel--form">${renderHead(opts, b)}${field(opts, b, 'body', 'div', 'tlcb-prose', esc(b.body || ''))}${inner}</div>`;
  }

  if (t === 'newsletter') {
    const form = opts.editing
      ? `<div class="tlcb-inline"><span class="tlcb-field" style="line-height:38px;color:#8A8898">you@email.com</span><span class="tlcb-btn">Subscribe</span></div>`
      : `<form class="tlcb-inline" method="POST" action="https://admin.timothystl.org/api/subscribe" target="_blank">
          <input class="tlcb-field" type="email" name="email" placeholder="you@email.com" required aria-label="Email address">
          <button class="tlcb-btn" type="submit">Subscribe</button></form>`;
    return `<div class="tlcb-panel">${renderHead(opts, b)}${field(opts, b, 'body', 'div', 'tlcb-prose', esc(b.body || ''))}${form}</div>`;
  }

  if (t === 'give') {
    const href = safeUrl(b.url) || 'https://give.timothystl.org';
    const chip = (label, amt) => opts.editing
      ? `<span class="tlcb-chip">${esc(label)}</span>`
      : `<a class="tlcb-chip" href="${esc(href + (href.includes('?') ? '&' : '?') + 'amount=' + amt)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
    const go = opts.editing
      ? `<span class="tlcb-chip tlcb-chip--go">Give now</span>`
      : `<a class="tlcb-chip tlcb-chip--go" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Give now</a>`;
    return `<div class="tlcb-give">${renderHead(opts, b)}
      ${field(opts, b, 'body', 'div', 'tlcb-give-note', esc(b.body || ''))}
      <div class="tlcb-inline">${chip('$25', 2500)}${chip('$100', 10000)}${go}</div>
    </div>`;
  }

  return `<div class="tlcb-note">Unknown block</div>`;
}

// opts: { editing, slug, index, total }
export function renderBlock(b, opts = {}) {
  const def = BLOCK_DEFS[b.type];
  if (!def) return '';
  const classes = ['tlcb', 'tlcb--' + b.type];
  if (b.hidden) classes.push('tlcb-hide-phone');
  const attrs = opts.editing
    ? ` data-id="${esc(b.id)}" data-type="${esc(b.type)}" tabindex="0" role="group"` +
      ` aria-label="${esc(def.label)} block${opts.total ? ', position ' + (opts.index + 1) + ' of ' + opts.total : ''}"`
    : '';
  const tools = opts.editing ? `<div class="tlcb-tools" contenteditable="false">
      <span class="tlcb-tool tlcb-tool--drag" draggable="true" data-act="move" title="Drag to move">⠿ Move</span>
      <span class="tlcb-tool-div"></span>
      <button type="button" class="tlcb-tool" data-act="up" title="Move up">↑</button>
      <button type="button" class="tlcb-tool" data-act="down" title="Move down">↓</button>
      <span class="tlcb-tool-div"></span>
      <button type="button" class="tlcb-tool" data-act="dup">Duplicate</button>
      <button type="button" class="tlcb-tool" data-act="hide">${b.hidden ? 'Show' : 'Hide'}</button>
      <button type="button" class="tlcb-tool tlcb-tool--del" data-act="del">Delete</button>
    </div><span class="tlcb-badge" contenteditable="false">${esc(def.label)}</span>` : '';
  return `<div class="${classes.join(' ')}" style="${wrapperVars(b)}"${attrs}>${tools}${renderStamp(opts, b)}${renderInner(b, opts)}</div>`;
}

export function renderPage(blocks, opts = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const total = list.length;
  const body = list.map((b, i) => renderBlock(b, Object.assign({}, opts, { index: i, total }))).join('');
  const empty = !total && opts.editing
    ? `<div class="tlcb-empty"><b>This page is empty</b><span>Drag a block up from the panel below to begin.</span></div>`
    : '';
  const css = opts.withCss === false ? '' : BLOCK_CSS;
  return css + `<div class="tlcb-page">` + body + empty + `</div>`;
}
