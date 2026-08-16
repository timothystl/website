// ── THE SITE'S CHROME ────────────────────────────────────────
// The header bar, and the newsletter band that sits above the footer.
//
// These are the parts of the site that are on EVERY page, which is exactly why
// they are not blocks. A block belongs to one page; the header belongs to all
// of them. Putting the header in the block editor would mean either editing it
// twenty-eight times or picking one page to secretly own it, and both of those
// are worse than a screen of its own.
//
// ── WHY THERE IS A DRAFT AND A PUBLISHED COPY ────────────────
// Everything else the Menu screen writes is live the moment it is saved, and
// for reordering a link that is right: the worst case is a link in the wrong
// order for two minutes. Appearance is different. Somebody trying a color, or
// uploading a logo to see how it crops, is *experimenting*, and an experiment
// that is instantly on the front of the church website is not an experiment.
//
// So this record is stored twice, under two site_settings keys, exactly the way
// a page stores `blocks` and `published_blocks`:
//
//   site_appearance_draft  — what the admin screen shows and the preview draws
//   site_appearance        — what visitors get
//
// Publishing copies the first over the second. Nothing else does.
//
// ── WHY THE COLORS ARE A LIST AND NOT A COLOR PICKER ───────
// The nav text, the tagline and the Give button's label are all light, and they
// are not editable. A free hex field is therefore one paste away from white
// text on a pale background — a header nobody can read, on every page at once,
// put there by somebody who was only trying to make it a bit lighter.
//
// The palette below is the site's own (public/styles.css), so every choice in
// it is a color the church already uses and every one of them carries light
// text safely. This is the same rule the block editor follows: a constrained
// choice, never a free value.
//
// Pure functions over plain objects — no D1, no Request — so the rules can be
// tested directly. See admin/appearance.test.mjs.

// ── THE PALETTE ──────────────────────────────────────────────
// The site's own colors (public/styles.css), so every choice here is one the
// church already uses. `ink` is what the site puts ON that color.
//
// ⚠ `bar: false` means "not offered as a bar color", and gold is the reason
// the flag exists. The nav links, the tagline and the brand name are all white
// and none of them is editable, so a gold bar would be white-on-#C9973A —
// 2.6:1, a header nobody can read, on every page at once, chosen by somebody
// who was only trying to make it warmer. Gold stays available for the bottom
// rule (which carries no text) and for the Give button (which is how the site
// already looks). The test asserts the readable pairs and deliberately does
// NOT assert gold's, because gold-on-white is a real contrast problem the site
// already has — see the note on `cta` below. Pretending it passes here would
// bury it.
export const PALETTE = [
  // ⚠ Ink navy is not the same as Navy, and both are here on purpose. Navy
  // (#1E2D4A) is the site's own --steel, used by every button and heading on
  // the pages that have not been converted; ink navy (#101B2E) is the
  // redesign's darker ground, and a bar in the first against a page in the
  // second reads as a mistake rather than as two shades. It leads the list
  // because it is the default.
  { key: 'ink',      label: 'Ink navy', value: '#101B2E', ink: '#FFFFFF', bar: true },
  { key: 'moss',     label: 'Moss',     value: '#4A5E3A', ink: '#FFFFFF', bar: true },
  { key: 'navy',     label: 'Navy',     value: '#1E2D4A', ink: '#FFFFFF', bar: true },
  { key: 'teal',     label: 'Teal',     value: '#2E7EA6', ink: '#FFFFFF', bar: true },
  { key: 'slate',    label: 'Slate',    value: '#3A4E5C', ink: '#FFFFFF', bar: true },
  { key: 'plum',     label: 'Plum',     value: '#8A6A8A', ink: '#FFFFFF', bar: true },
  { key: 'charcoal', label: 'Charcoal', value: '#1A1A2A', ink: '#FFFFFF', bar: true },
  { key: 'gold',     label: 'Gold',     value: '#C9973A', ink: '#FFFFFF', bar: false },
];

// ── THE TYPEFACE ─────────────────────────────────────────────
// One control, two pairs, and it moves the WHOLE site — the header, the
// footer, every heading on every page and every block in the page editor.
//
// That is the point rather than a side effect. Dinger's answer to "should the
// new language be opt-in per block?" was one look, one set of types; a per-
// block font toggle would produce exactly the patchwork he was asking not to
// have, and would do it one page at a time so nobody could see it happening.
//
// ⚠ THREE ROLES, NOT TWO. Both pairs use their two families differently:
// classically Lora sets headings and Source Sans does everything else, while
// in the redesign Bricolage sets headings AND the UI — buttons, eyebrows,
// small-caps meta — and Newsreader carries the reading copy. Collapsing that
// to a heading/body pair puts a serif on every button in the redesign, which
// is the one thing the design is emphatic about not doing.
//
// The three names are the three custom properties public/styles.css already
// declares, so switching the pair is re-pointing variables the site has always
// used rather than a new mechanism laid over the old one.
export const TYPEFACES = [
  {
    key: 'redesign', label: 'Bricolage & Newsreader',
    head: "'Bricolage Grotesque',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    body: "'Newsreader',Georgia,'Times New Roman',serif",
    ui: "'Bricolage Grotesque',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    note: 'The redesign. Display headings with tight, large type; a warm serif for reading.',
  },
  {
    key: 'classic', label: 'Lora & Source Sans',
    head: 'Lora,Georgia,serif',
    body: "'Source Sans 3',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    ui: "'Source Sans 3',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    note: 'The site as it read before the redesign. Picking this puts every page back.',
  },
];
// How big the site's text is. Dinger, looking at the site: "15 and 17pt is too
// small" — so this is one lever over the whole thing rather than a size on each
// block, which is the same argument the typeface selector settled: a site whose
// text size is decided a block at a time is a site that reads like several.
//
// ⚠ A MULTIPLIER, NOT A SET OF SIZES. Every size on the site is already chosen
// in proportion to the others — an eyebrow against a heading against body copy
// — and a control that set absolute sizes would flatten that. Scaling keeps the
// relationships and moves them together.
//
// ⚠ Headings scale LESS than body copy, and that is the whole design of it.
// Dinger asked for all three and said body copy matters most; a heading is
// already 38-64px, and multiplying that by the same 1.2 that takes body copy
// from a comfortable 16 to 19 takes a hero title from 64 to 77 and pushes the
// first paragraph off the screen. `head` is the gentler curve.
export const TEXT_SIZES = [
  { key: 'normal', label: 'Normal', body: 1, head: 1,
    note: 'The site as it reads today.' },
  { key: 'large', label: 'Large', body: 1.1, head: 1.05,
    note: 'About a point larger through the body copy. The usual answer when the site reads small on a laptop.' },
  { key: 'larger', label: 'Larger', body: 1.22, head: 1.1,
    note: 'Noticeably larger. Right when the congregation is reading it on phones and tablets more than on desks.' },
];
export const TEXT_SIZE_KEYS = TEXT_SIZES.map((t) => t.key);
export const textSizeOf = (key) => TEXT_SIZES.find((t) => t.key === key) || TEXT_SIZES[0];

export const TYPEFACE_KEYS = TYPEFACES.map((t) => t.key);
export const typefaceOf = (key) => TYPEFACES.find((t) => t.key === key) || TYPEFACES[0];

export const PALETTE_KEYS = PALETTE.map((c) => c.key);
// The bar and the newsletter band both carry light text, so both choose from
// this shorter list. The rule and the Give button choose from the whole one.
export const BAR_KEYS = PALETTE.filter((c) => c.bar).map((c) => c.key);

export function colorOf(key, fallback = 'moss') {
  return PALETTE.find((c) => c.key === key) || PALETTE.find((c) => c.key === fallback) || PALETTE[0];
}

// ── THE RECORD ───────────────────────────────────────────────
// The defaults are the site exactly as it stands today, not a neutral starting
// point. Somebody opening this screen for the first time should see what is
// already on the website — a form full of blanks would read as "the header has
// no settings" and invite them to fill it in from scratch.
export const DEFAULTS = {
  // ⚠ The one default here that is NOT the site as it stood before this
  // screen existed. Dinger asked for the redesign to be the site's look —
  // "have it all one look" — so the record ships pointing at it, and the
  // control is how somebody goes back rather than how they opt in.
  //
  // It has to be the default rather than something to switch on afterwards
  // for a reason beyond preference: this value also decides what renders when
  // the admin is UNREACHABLE, since applyAppearance() never runs then and the
  // static markup is all there is. A default of 'classic' would mean the site
  // silently reverted to the old typefaces during an admin outage.
  typeface: 'redesign',
  // Normal is the site exactly as it reads today, so the record ships changing
  // nothing — unlike `typeface` above, this is a preference rather than a look
  // somebody has already asked for.
  textSize: 'normal',
  // Header
  // ⚠ Also changed for the redesign, and with a caveat worth knowing: a
  // default only decides what an UNSET field is. If somebody has already saved
  // an appearance record — and this screen has existed since v4.23.0 — their
  // stored 'moss' wins and the bar does not move until they pick ink navy on
  // the screen. That is one click, and it is the right way round: the color of
  // the church's header is theirs to change, not a deploy's.
  bar: 'ink',
  rule: 'gold',
  cta: 'gold',
  logo_url: '/logo.png?v=20260328',
  logo_shape: 'round',
  brand_name: 'Timothy Lutheran Church',
  tagline: 'from our Neighborhood to the Nations',
  show_tagline: true,
  // The newsletter band above the footer. It is site-wide chrome, not a block
  // on the homepage — it renders on every page, outside every page div — which
  // is why it is edited here and not in the page editor. See the note in
  // public/index.html above the section itself.
  nl_show: true,
  nl_bg: 'ink',
  nl_eyebrow: 'Stay Connected',
  nl_heading: 'Get our weekly newsletter',
  nl_body: 'News, upcoming events, and a word from Pastor Dinger — delivered to your inbox each week.',
  nl_button: 'Subscribe',
};

export const TEXT_FIELDS = ['logo_url', 'brand_name', 'tagline', 'nl_eyebrow', 'nl_heading', 'nl_body', 'nl_button'];
export const COLOR_FIELDS = ['bar', 'rule', 'cta', 'nl_bg'];
export const FLAG_FIELDS = ['show_tagline', 'nl_show'];

// Long enough for the real strings and short enough that this record can never
// become a place to store a page's worth of content. The tagline is a line in a
// 64px-tall bar; the newsletter body is two sentences.
const MAX_LEN = { logo_url: 500, brand_name: 80, tagline: 120, nl_eyebrow: 40, nl_heading: 90, nl_body: 300, nl_button: 30 };

// A logo address has to survive being put in an <img src> on every page of the
// site. `javascript:` and `data:` are refused outright rather than escaped:
// there is no version of either that is a photograph of a church, so anything
// that is not an ordinary image address is a mistake at best.
export function safeLogoUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.startsWith('/')) return s;                 // an asset on the site itself
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

// ── SANITIZING ───────────────────────────────────────────────
// Every write goes through here — the form, and anything else that ever calls
// it. A stale tab, a crafted POST and a hand-edited settings row all arrive at
// this function, so the guardrails cannot live in the browser.
export function sanitizeAppearance(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = Object.assign({}, DEFAULTS);

  // The bar and the newsletter band are text on color, so they take the
  // narrower list — enforced here rather than only in the form, because a
  // stale tab is exactly how an unreadable header would get saved.
  for (const f of COLOR_FIELDS) {
    const allowed = (f === 'bar' || f === 'nl_bg') ? BAR_KEYS : PALETTE_KEYS;
    if (allowed.includes(src[f])) out[f] = src[f];
  }
  for (const f of TEXT_FIELDS) {
    if (src[f] == null) continue;
    let v = String(src[f]).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN[f] || 200);
    if (f === 'logo_url') v = safeLogoUrl(v);
    out[f] = v;
  }
  for (const f of FLAG_FIELDS) {
    if (src[f] != null) out[f] = !!src[f] && src[f] !== '0' && src[f] !== 'false';
  }
  out.logo_shape = src.logo_shape === 'square' ? 'square' : 'round';
  // Same shape as logo_shape: an unknown value is a stale tab or a crafted
  // POST, and the answer to both is the default rather than a third state the
  // site has no fonts loaded for.
  if (TYPEFACE_KEYS.includes(src.typeface)) out.typeface = src.typeface;
  if (TEXT_SIZE_KEYS.includes(src.textSize)) out.textSize = src.textSize;

  // A header with no name and no logo is a bar with nothing in it, and the
  // brand block is also the way back to the homepage. Emptying both is
  // therefore treated as a mistake rather than honored: the name comes back.
  if (!out.brand_name && !out.logo_url) out.brand_name = DEFAULTS.brand_name;

  return out;
}

// Stored as JSON in a settings row, so anything unreadable — a truncated write,
// a hand-edit, a row that predates this screen — has to come back as the
// current site rather than as an exception. The header is on every page; there
// is no version of this that is allowed to throw.
export function parseAppearance(json) {
  if (!json) return Object.assign({}, DEFAULTS);
  try {
    return sanitizeAppearance(JSON.parse(json));
  } catch (_) {
    return Object.assign({}, DEFAULTS);
  }
}

// ── FROM THE FORM ────────────────────────────────────────────
// ⚠ A toggle posts a hidden `0` ahead of its checkbox, so `form.get(name)` is
// the `0` whether or not the box is ticked and reads as truthy either way.
// `getAll(name).includes('1')` is the only correct read, and getting it wrong
// here would silently hide the tagline and the newsletter band on every page.
export function appearanceFromForm(form) {
  const raw = {};
  for (const f of [...TEXT_FIELDS, ...COLOR_FIELDS]) raw[f] = form.get(f);
  raw.logo_shape = form.get('logo_shape');
  raw.typeface = form.get('typeface');
  raw.textSize = form.get('textSize');
  for (const f of FLAG_FIELDS) raw[f] = form.getAll(f).includes('1');
  return sanitizeAppearance(raw);
}

// ── DRAFT vs PUBLISHED ───────────────────────────────────────
// Same question a page's list row answers, and answered the same way: by
// comparing the two stored copies, never by remembering what happened in this
// session. A flag set at save time would disagree with the database the first
// time two people had the screen open.
export function isDirty(draft, published) {
  return JSON.stringify(sanitizeAppearance(draft)) !== JSON.stringify(sanitizeAppearance(published));
}

// What actually differs, so the screen can say "the bar color and the logo"
// rather than the unhelpfully vague "you have unpublished changes".
export const FIELD_LABELS = {
  typeface: 'Typeface',
  textSize: 'Text size',
  bar: 'Bar color', rule: 'Bottom rule', cta: 'Give button', logo_url: 'Logo',
  logo_shape: 'Logo shape', brand_name: 'Church name', tagline: 'Tagline',
  show_tagline: 'Tagline shown', nl_show: 'Newsletter band', nl_bg: 'Newsletter color',
  nl_eyebrow: 'Newsletter eyebrow', nl_heading: 'Newsletter heading',
  nl_body: 'Newsletter wording', nl_button: 'Newsletter button',
};

export function changedFields(draft, published) {
  const a = sanitizeAppearance(draft);
  const b = sanitizeAppearance(published);
  return Object.keys(FIELD_LABELS).filter((k) => a[k] !== b[k]);
}

// ── THE PREVIEW ──────────────────────────────────────────────
// ⚠ This is the whole reason this file exists rather than a couple of extra
// settings rows. The Menu screen has always had a preview bar, and it has
// always been WRONG: admin navy, a hardcoded "T" in a gold square, the literal
// string "Timothy Lutheran", and no tagline — beside a real site that is moss
// green with a round photographic logo and a strapline under the name. Staff
// were being shown a picture of a header that does not exist and asked to
// arrange it.
//
// So the preview is built from the same record the site is, by one function
// used on both the Menu screen and the appearance screen. A preview that can
// disagree with the site is worse than no preview, because it is believed.
//
// It is deliberately NOT the site's own stylesheet re-served into the admin:
// public/styles.css would drag the whole site cascade into every admin page.
// These are the header's own rules, copied — and the values they use come from
// the record, so the two cannot drift on the part that is editable.
const pesc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The tagline's color is not editable — it is the site's `--honey`, chosen to
// sit on a dark bar. If the bar ever becomes light this has to be revisited,
// which is another reason pale bar colors are not offered.
const TAGLINE_INK = '#E8C070';

// The chosen pair, as custom properties the preview's own rules read. Without
// this the preview would draw the site's header in the ADMIN's typefaces — the
// exact class of lie this function was written to end, just moved from the
// colors to the type.
const fontVars = (a) => `--hp-head:${pesc(a.fonts.head)};--hp-body:${pesc(a.fonts.body)};--hp-ui:${pesc(a.fonts.ui)};`;

export function renderHeaderPreview(appearance, items = [], { note = '' } = {}) {
  const a = publicAppearance(appearance);
  const brand = a.logo
    ? `<img src="${pesc(a.logo)}" alt="" class="tlc-hp-logo${a.logoShape === 'square' ? ' is-square' : ''}">`
    : '';
  const links = items.map((i) => `<span class="tlc-hp-item${i.style === 'button' ? ' is-button' : ''}">${pesc(i.label)}</span>`).join('');

  return `<div class="tlc-hp" style="--hp-bar:${pesc(a.bar)};--hp-rule:${pesc(a.rule)};--hp-cta:${pesc(a.cta)};--hp-ink:${pesc(a.ink)};--hp-cta-ink:${pesc(a.ctaInk)};${fontVars(a)}">
  <div class="tlc-hp-bar">
    <span class="tlc-hp-brand">
      ${brand}
      <span class="tlc-hp-words">
        ${a.name ? `<span class="tlc-hp-name">${pesc(a.name)}</span>` : ''}
        ${a.tagline ? `<span class="tlc-hp-tag">${pesc(a.tagline)}</span>` : ''}
      </span>
    </span>
    <span class="tlc-hp-links">${links}</span>
  </div>
  ${note ? `<div class="tlc-hp-note">${pesc(note)}</div>` : ''}
</div>`;
}

// The newsletter band, drawn the same way and for the same reason.
export function renderNewsletterPreview(appearance) {
  const a = publicAppearance(appearance);
  const n = a.newsletter;
  if (!n) {
    return `<div class="tlc-hp-off">The newsletter band is switched off — no page shows it.</div>`;
  }
  return `<div class="tlc-np" style="--np-bg:${pesc(n.bg)};${fontVars(a)}">
  ${n.eyebrow ? `<div class="tlc-np-eyebrow">${pesc(n.eyebrow)}</div>` : ''}
  <div class="tlc-np-head">${pesc(n.heading)}</div>
  ${n.body ? `<div class="tlc-np-body">${pesc(n.body)}</div>` : ''}
  <div class="tlc-np-form">
    <span class="tlc-np-input">Your name (optional)</span>
    <span class="tlc-np-input">Email address</span>
    <span class="tlc-np-btn">${pesc(n.button)}</span>
  </div>
</div>`;
}

export const APPEARANCE_CSS = `
.tlc-hp{background:var(--hp-bar);border-bottom:3px solid var(--hp-rule);border-radius:12px;overflow:hidden;margin-bottom:18px;}
.tlc-hp-bar{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:12px 20px;min-height:64px;}
.tlc-hp-brand{display:flex;align-items:center;gap:12px;}
.tlc-hp-logo{width:44px;height:44px;border-radius:50%;flex-shrink:0;object-fit:contain;background:#fff;padding:3px;}
.tlc-hp-logo.is-square{border-radius:8px;}
.tlc-hp-words{display:flex;flex-direction:column;gap:2px;}
.tlc-hp-name{font:800 14px var(--hp-head,var(--tlc-sans));color:var(--hp-ink);}
.tlc-hp-tag{font:600 10px var(--hp-body,var(--tlc-sans));color:${TAGLINE_INK};letter-spacing:.04em;}
.tlc-hp-links{display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.tlc-hp-item{font:700 13px var(--hp-ui,var(--tlc-sans));color:var(--hp-ink);opacity:.85;padding:6px 10px;border-radius:8px;}
.tlc-hp-item.is-button{background:var(--hp-cta);color:var(--hp-cta-ink);opacity:1;font-weight:800;padding:7px 16px;}
.tlc-hp-note{padding:0 20px 10px;font-size:11.5px;color:var(--hp-ink);opacity:.55;}
.tlc-hp-off{background:var(--tlc-sand);border-radius:12px;padding:18px 20px;margin-bottom:18px;font:400 13.5px var(--tlc-sans);color:var(--tlc-secondary);}
.tlc-np{background:var(--np-bg);border-radius:12px;padding:26px 24px;margin-bottom:18px;text-align:center;}
.tlc-np-eyebrow{font:700 10.5px var(--hp-ui,var(--tlc-sans));letter-spacing:.12em;text-transform:uppercase;color:${TAGLINE_INK};margin-bottom:8px;}
.tlc-np-head{font:400 22px var(--hp-head,var(--tlc-serif));color:#fff;margin-bottom:6px;}
.tlc-np-body{font:400 13.5px var(--hp-body,var(--tlc-sans));color:rgba(255,255,255,.72);max-width:460px;margin:0 auto 16px;line-height:1.5;}
.tlc-np-form{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}
.tlc-np-input{font:400 12.5px var(--tlc-sans);color:rgba(255,255,255,.5);background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:8px 12px;}
.tlc-np-btn{font:700 12.5px var(--tlc-sans);color:var(--tlc-gold-ink);background:var(--tlc-gold);border-radius:8px;padding:8px 18px;}
.tlc-sw{display:flex;gap:8px;flex-wrap:wrap;}
.tlc-sw label{cursor:pointer;}
.tlc-sw input{position:absolute;opacity:0;width:0;height:0;}
.tlc-sw span{display:flex;align-items:center;gap:7px;border:2px solid transparent;border-radius:8px;padding:6px 11px 6px 7px;font:600 12.5px var(--tlc-sans);color:var(--tlc-ink);background:var(--tlc-sand);}
.tlc-sw i{width:18px;height:18px;border-radius:5px;display:block;}
.tlc-sw input:checked+span{border-color:var(--tlc-ink);background:#E7EEF7;}
.tlc-sw input:focus-visible+span{outline:2px solid var(--tlc-ink);outline-offset:2px;}
`;

// ── WHAT THE PUBLIC SITE GETS ────────────────────────────────
// Resolved to real colors here rather than in the browser, so public/index.html
// never has to carry a copy of the palette. A palette entry renamed or
// re-valued in this file reaches the site on the next deploy with nothing to
// keep in step — which is the whole reason the site is sent values and not keys.
export function publicAppearance(a) {
  const s = sanitizeAppearance(a);
  const tf = typefaceOf(s.typeface);
  const ts = textSizeOf(s.textSize);
  return {
    // Real font stacks, not the key — same argument as the colors. The site
    // never carries a copy of what "redesign" means, so renaming or re-cutting
    // a pair here reaches every page on the next deploy with nothing to keep
    // in step. These land on --font-heading / --font-body / --font-ui, which
    // public/styles.css already declares and every block already reads.
    fonts: { head: tf.head, body: tf.body, ui: tf.ui },
    // Two multipliers, not one — see TEXT_SIZES. They land on --tlc-text-scale
    // and --tlc-head-scale, which public/styles.css and every block read.
    textScale: { body: ts.body, head: ts.head },
    bar: colorOf(s.bar).value,
    rule: colorOf(s.rule, 'gold').value,
    cta: colorOf(s.cta, 'gold').value,
    ink: colorOf(s.bar).ink,
    // ⚠ The Give button's label is white on gold today — 2.6:1, which is below
    // the 4.5:1 a body of text needs. That is the site as it already is, and
    // it is sent on unchanged here rather than quietly corrected: recoloring
    // the most-clicked button on the church website is a decision somebody
    // should make on purpose, not a side effect of making the header editable.
    // Flagged in CLAUDE.md. Picking a darker CTA color on this screen fixes
    // it today without any code change, which is part of why the choice exists.
    ctaInk: colorOf(s.cta, 'gold').ink,
    logo: s.logo_url,
    logoShape: s.logo_shape,
    name: s.brand_name,
    tagline: s.show_tagline ? s.tagline : '',
    newsletter: s.nl_show
      ? { bg: colorOf(s.nl_bg, 'navy').value, eyebrow: s.nl_eyebrow, heading: s.nl_heading, body: s.nl_body, button: s.nl_button }
      : null,
  };
}
