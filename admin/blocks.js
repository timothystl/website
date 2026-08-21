// ── MINISTRY PAGE BLOCKS — the single shared renderer ────────────────────────
//
// A ministry page is an ordered array of typed blocks. This module owns:
//   • the block schema (types, defaults, allowed values)
//   • server-side sanitization of anything written by a client
//   • the HTML templates for every block type
//
// CRITICAL: this is the ONLY place a block turns into HTML. The public site
// and the editor canvas both render through renderPage()/renderBlock(), so the
// two can never drift — that is the whole point of a WYSIWYG editor. If you
// add a block type, add it here and it appears in both places at once.
//
// How the editor avoids re-rendering on every keystroke/click:
// every visual knob a staff member can turn (spacing, colors, text size,
// column split, gap, spacer height) is emitted as a CSS custom property on the
// block wrapper. The editor changes the property on the DOM node directly and
// the browser repaints — no round trip, no second copy of these templates.
// Only structural changes (add / delete / duplicate / reorder / undo / reset)
// ask the Worker to re-render, and those are rare enough that a ~50ms fetch is
// imperceptible.

// The one definition of how an amount becomes a Tithe.ly link — shared with
// give-landing.js so the block editor and the hardcoded fallback page can
// never disagree about what a gift of $25 costs. See give-link.js.
import { withAmountAndFund, withFund, parseAmount, fmtAmount, giftForPeriod, giveButtonLabel, GIVE_LINK_JS } from '../give-link.js';

// The Christmas Market's own pricing — one definition, shared with the public
// /api/market/apply route and its test suite, for the same reason as above:
// three copies of a rule about somebody's money is three chances for one of
// them to be wrong in a way nobody notices, because a wrong price still LOOKS
// like a working price.
//
// ⚠ FROM ../market-price.js, NOT ./market.js. admin/market.js imports from
// admin/helpers.js, which itself imports FROM this file (for sanitizeRich) —
// so importing admin/market.js here would complete a circular import. Node
// tolerates that in simple cases; Cloudflare Workers' module loader is not
// guaranteed to, so the cycle is avoided outright rather than relied upon.
import { priceBreakdown, money as marketMoney, MARKET_PRICING_JS, MARKET_DEFAULTS } from '../market-price.js';
// The countdown needs a real instant, not a date somebody reads — see the note
// on churchInstant() itself.
import { churchInstant } from './when.js';

// ── PALETTES (guardrails: staff can only pick from these) ────────────────────

// ── THE BACKGROUND PALETTE, AND WHY IT CARRIES THE 1b LANGUAGE ───────────────
// The first four are the site as it has always been. Entries 4–7 are the
// redesign's own surfaces, and picking one does more than change a color: it
// puts that block into the new language — display type at real scale, pill
// buttons, the photo treatments. `lang: '1b'` is the flag that says so and
// `renderBlock` turns it into a class.
//
// ⚠ APPEND ONLY. `bg` is stored on every block as an INDEX, so inserting an
// entry silently repaints every page on the site. New surfaces go on the end.
//
// A 1b entry also carries the rest of its color set — the heading ink, the
// eyebrow, the link, the hairline — because in this language they move
// together: a navy band wants a gold eyebrow, a gold band wants a
// gold-shadow one. Leaving those to a second control would let somebody
// assemble a gold eyebrow on a gold field. One decision, not four.
export const BG = [
  { name: 'Parchment', c: '#FBF8F3', dark: false },
  { name: 'Sand',      c: '#F7F3EC', dark: false },
  { name: 'Mist',      c: '#EDF2F7', dark: false },
  { name: 'Navy',      c: '#1E2D4A', dark: true },
  // ⚠ EACH CARRIES A GRADIENT, AND THAT IS THE POINT. The handoff is blunt
  // about it: "Flat navy and flat sand are a large part of why the old pages
  // read as dead. Every large field in this language now carries a shallow
  // gradient — 6–10% of value across the field, never a hue jump." The first
  // build of this shipped flat fills, and the answer from Dinger was that the
  // pages still did not look like the design. They were right.
  //
  // `c` stays the flat color and is still what the ink guardrail and the
  // inspector's contrast maths read; `grad` is what actually gets painted.
  // Copy these declarations verbatim — they are authored, not sampled.
  { name: 'Paper',     c: '#F5F0E6', dark: false, lang: '1b', head: '#101B2E', eyebrow: '#B44A2E', link: '#B37F1E', rule: '#E7DFCD', chip: '#FFFDF8',
    grad: 'linear-gradient(180deg,#F5F0E6 0%,#EFE8D9 100%)' },
  { name: 'White',     c: '#FFFDF8', dark: false, lang: '1b', head: '#101B2E', eyebrow: '#B44A2E', link: '#B37F1E', rule: '#E7DFCD', chip: '#F5F0E6',
    grad: 'linear-gradient(180deg,#FFFDF8 0%,#F7F2E6 100%)' },
  { name: 'Ink navy',  c: '#101B2E', dark: true,  lang: '1b', head: '#FFFFFF', eyebrow: '#E4A93C', link: '#E4A93C', rule: 'rgba(245,240,230,.14)', chip: 'rgba(245,240,230,.08)',
    grad: 'linear-gradient(135deg,#101B2E 0%,#1B2C4A 52%,#2A3E66 100%)' },
  // ⚠ Gold ink is #3B2E12 on this field for EVERYTHING — body, headings and
  // eyebrows alike. The README's "gold shadow" moved from #7A4E12 to #3B2E12
  // between handoff revisions; this is the later value.
  { name: 'Gold',      c: '#E4A93C', dark: false, lang: '1b', head: '#101B2E', eyebrow: '#3B2E12', link: '#101B2E', rule: 'rgba(16,27,46,.18)', chip: '#FFFDF8',
    grad: 'linear-gradient(120deg,#E4A93C 0%,#F0C46B 52%,#D89428 100%)' },
  // Three more, added 2026-08-17 at Dinger's ask for wider background choice
  // on ordinary boxes (the Give/Newsletter/Signup panels). Plain, like Navy —
  // no 1b fields, because these are not a second design language, just three
  // more colors to paint an existing panel with. All three are colors the
  // site already uses elsewhere (Design System → Colors in CLAUDE.md) rather
  // than new ones invented for this palette: Teal for links/Beekeepers/
  // Christmas Market, Moss for the nav header/Stephen Ministry, Slate for
  // Food Pantry. Each is dark enough that the ink guardrail forces Cream or
  // Gold ink, never a dark one, the same as Navy already does.
  { name: 'Teal',  c: '#2E7EA6', dark: true },
  { name: 'Moss',  c: '#4A5E3A', dark: true },
  { name: 'Slate', c: '#3A4E5C', dark: true },
];

// ⚠ APPEND ONLY, for the same reason as BG.
// "Body ink" and "Gold ink" exist so the two light 1b surfaces have a readable
// partner: on a gold field the site's usual #3A3A4A is muddy, and the design's
// own answer is a near-black brown.
export const INK = [
  { name: 'Ink',      c: '#3A3A4A', onDark: false },
  { name: 'Navy',     c: '#1E2D4A', onDark: false },
  { name: 'Slate',    c: '#6A6858', onDark: false },
  { name: 'Cream',    c: '#F3EDE1', onDark: true },
  { name: 'Gold',     c: '#C9973A', onDark: true },
  { name: 'Body ink', c: '#453F30', onDark: false },
  { name: 'Gold ink', c: '#3B2E12', onDark: false },
];

export const SIZES = [
  { key: 's', label: 'S', body: 14, head: 24, hero: 30 },
  { key: 'm', label: 'M', body: 15, head: 30, hero: 38 },
  { key: 'l', label: 'L', body: 17, head: 36, hero: 46 },
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

export const STAMP_PRESETS = ['New', 'Upcoming', 'Take note', 'Registration open', 'Registration closed', 'Cancelled'];

// How big the stamp reads. `m` is the size the stamp has always rendered at —
// so it has to stay byte-identical to the base `.tlcb-stamp` rule, the same
// "the default adds no class" rule every other layout control here follows —
// and `l` is the "make it bigger" ask, a second, larger rule layered on top.
export const STAMP_SIZES = [
  { key: 'm', label: 'Normal' },
  { key: 'l', label: 'Large' },
];

// ── THE 1b LANGUAGE ──────────────────────────────────────────────────────────
// Andrew's brief was one sentence: "it just feels dead, and so do all the pages
// on the site — the editor is helpful, it just all lacks energy." The answer
// the designer landed on (direction 1b, chosen over a broadsheet and a bulletin
// board) is three decisions in priority order: full-bleed photography, display
// type at real scale, and a few things that move.
//
// It arrives as a set of BLOCK TYPES rather than as a site-wide restyle, which
// is what makes it safe to adopt one page at a time: a page renders in the new
// language exactly to the extent that it is built from these blocks.
//
// ⚠ THE ARROWS IN THE MOCKS ARE DELIBERATELY NOT HERE. Every link label in the
// handoff ends with a decorative arrow glyph. This repo has a CI check
// (admin/link-style.test.mjs) that forbids exactly that, added after Dinger
// said it keeps coming back in and he does not want it — twice. The layout is
// the design's; the trailing glyph is not.
//
// ⚠ And do not quote one of those labels in a comment either: the check greps
// source, so a comment reproducing the glyph fails it as surely as markup
// would. Describe the label; do not paste it. (This comment is the second
// time that has been learned here.)

// A banner is one of three heights. Not a pixel field: the whole guardrail of
// this editor is that a layout choice is a choice from a short list.
export const BANNER_HEIGHTS = [
  { key: 'short', label: 'Short', px: 420 },
  { key: 'mid', label: 'Medium', px: 520 },
  { key: 'tall', label: 'Tall', px: 640 },
];

// How much dark is laid over the photograph. The gradient shape is fixed and
// only its top stop moves, because the BOTTOM stop is what keeps the headline
// legible and is not somebody's decision to weaken.
export const VEILS = [
  { key: 'light', label: 'Light', top: 0.5 },
  { key: 'medium', label: 'Medium', top: 0.72 },
  { key: 'heavy', label: 'Heavy', top: 0.88 },
];

// Where a banner photo's crop is centered. Three, not a free-form pixel or
// percentage field — the pastor's own constraint for this editor is that it
// must not be possible to break the page, and a typed-in coordinate is
// exactly the kind of thing that can. The common real problem this answers
// is a face or a subject sitting at the top of the frame getting cut off by
// a wide, short crop; left/right matter far less on a banner that is always
// wider than it is tall, so this is one axis, not nine positions.
export const IMG_POSITIONS = [
  { key: 'top', label: 'Top', css: 'center top' },
  { key: 'center', label: 'Center', css: 'center center' },
  { key: 'bottom', label: 'Bottom', css: 'center bottom' },
];

// ── THE SECOND LAYER OVER A HERO ─────────────────────────────────────────────
// The handoff's own words: "This is what stops the heroes reading gray." A veil
// on its own is neutral dark over a photograph, and over a photograph that does
// not exist yet it is neutral dark over navy — which is exactly the flat, dead
// field the redesign was commissioned to get rid of.
//
// Clay from the bottom corner on News, Sermons and Visit; gold from the top
// corner on Worship, Ministries, About and Give. Warm either way, and warm is
// the whole job.
//
// ⚠ It goes OVER the veil, in that order. Under it, the veil mutes the thing
// whose entire purpose is to stop the field being muted.
export const GLOWS = [
  { key: 'clay', label: 'Clay', css: 'radial-gradient(880px 400px at 14% 104%, rgba(180,74,46,.44), transparent 68%)' },
  { key: 'gold', label: 'Gold', css: 'radial-gradient(880px 400px at 86% -4%, rgba(228,169,60,.40), transparent 68%)' },
  { key: 'green', label: 'Green', css: 'radial-gradient(880px 400px at 14% 104%, rgba(47,107,58,.44), transparent 68%)' },
  { key: 'none', label: 'None', css: '' },
];

// The calendar tray. Same reasoning as the banner: three heights, not a number.
// ⚠ RE-BASED FOR A MONTH GRID. These were 420/560/700, and the Calendar block
// never read them at all — it hardcoded 520px — so no stored value has ever
// meant anything and re-pointing the scale breaks nothing. 700 was below the
// 800 the hardcoded /calendar page already used, so honoring the old numbers
// would have made a published page SHORTER than the one it replaced.
//
// Tall is what a month with several things on a weekday actually needs before
// Google stops folding the day into "N more".
export const EMBED_HEIGHTS = [
  { key: 's', label: 'Short', px: 520 },
  { key: 'm', label: 'Medium', px: 800 },
  { key: 'l', label: 'Tall', px: 1100 },
];

// ── THE INFO CARD ────────────────────────────────────────────────────────────
// The white box that sits over a banner — service times, the address, a phone
// number. It is deliberately **not** a block somebody drags in: a floating
// block would mean asking the office to position it, and refusing to ask that
// is the whole point of this editor. It is a slot on the banner, switched on
// here, and the banner's own text column narrows to make room. One per banner,
// never overlapping, never dragged.
export const CARD_SIDES = [
  { key: 'off', label: 'Off' },
  { key: 'right', label: 'Right' },
  { key: 'left', label: 'Left' },
];

// How a block is separated from the page behind it. A short list rather than a
// free-form shadow, for the reason every other layout control here is: the
// office should not be choosing blur radii, and a page of eight blocks each
// with its own hand-tuned shadow is the patchwork this editor exists to
// prevent.
//
// ⚠ `none` MUST add no class and no declaration. It is what every page on the
// site renders today, so it has to stay byte-identical rather than becoming a
// rule that happens to agree with the old one.
//
// `lined` is a hairline rather than a shadow, and it earns its place: on a
// field that is already a soft cream, a shadow is nearly invisible and a rule
// is what actually separates the block. Same control, because "how is this
// block set apart" is one decision, not two.
export const SHADOWS = [
  { key: 'none', label: 'None', note: 'The block sits flat on the page. This is how every page looks today.' },
  { key: 'soft', label: 'Soft', note: 'A close shadow. Enough to lift the block off the page without announcing itself.' },
  { key: 'lifted', label: 'Lifted', note: 'A deeper shadow, as though the block were raised toward the reader. Right for one block on a page, not for six.' },
  { key: 'lined', label: 'Lined', note: 'A hairline border instead of a shadow. Right on a pale field, where a shadow barely shows.' },
];
export const SHADOW_KEYS = SHADOWS.map((s) => s.key);

// ── Shading ──────────────────────────────────────────────────────────────────
// ⚠ AN OVERLAY, NOT COLOR ARITHMETIC. A white-to-black wash over whatever the
// surface already is produces the handoff's "6–10% of value across the field,
// never a hue jump" — and it is hue-safe BY CONSTRUCTION, because an overlay
// with no hue in it cannot introduce one. It needs to know nothing about the
// color underneath, so it works on all ten palette entries, on the four that
// carry an authored gradient as well as the six that are flat, and on any
// entry added later without a second thought.
//
// A free two-color gradient picker would be the same mistake the hex field
// would have been on the Appearance screen: one paste away from an unreadable
// band, on a control whose whole point is that it cannot break the page.
export const SHADES = [
  { key: 'none', label: 'None', css: '', note: 'The block is painted in its color flat, which is how every page looks today.' },
  { key: 'soft', label: 'Soft', css: 'linear-gradient(180deg,rgba(255,255,255,.05),rgba(0,0,0,.06))',
    note: 'A shallow wash, lighter at the top. Enough to stop a large field reading dead without anybody noticing a gradient.' },
  { key: 'strong', label: 'Strong', css: 'linear-gradient(180deg,rgba(255,255,255,.09),rgba(0,0,0,.11))',
    note: 'The same wash, roughly twice as deep. Right for a tall band; heavy on a small box.' },
];
export const SHADE_KEYS = SHADES.map((s) => s.key);

// ── Appear ───────────────────────────────────────────────────────────────────
// One movement, one duration, no timeline and no delay. The gap between this
// and an animation editor is the whole reason it can exist here at all.
export const APPEARS = [
  { key: 'none', label: 'None', note: 'The block is simply there. This is how every page behaves today.' },
  { key: 'fade', label: 'Fade in', note: 'The block fades up as it comes into view. Shown on the live page only — the editor draws it in place so it is not moving while you work.' },
  { key: 'rise', label: 'Rise in', note: 'The block fades and lifts slightly as it comes into view. Live page only, and skipped entirely for anyone who has asked their device to reduce motion.' },
];
export const APPEAR_KEYS = APPEARS.map((a) => a.key);

// ── Button color ─────────────────────────────────────────────────────────────
// ⚠ THE BACKGROUND AND THE INK ARE ONE CHOICE, NEVER TWO. Offering them
// separately is what produces white on gold at 2.6:1 — which is what the site's
// own header Give button does today and is recorded here as known. Pairing them
// means an unreadable button is not expressible, so there is no warning to
// write and nothing for anybody to click past.
//
// ⚠ `default` stores nothing and emits nothing, so every button already on the
// site renders from exactly the CSS it always did. A deploy must not repaint
// the most-clicked control on a church website; picking a color here is how
// that changes, and it is somebody's decision rather than a side effect.
export const BTNS = [
  { key: 'default', label: 'Default', note: 'Navy with cream lettering, the site’s own button. Nothing is stored, so this is exactly what the page renders today.' },
  { key: 'gold', label: 'Gold', bg: '#C9973A', ink: '#1B1608', bd: '#C9973A', note: 'Gold with near-black lettering, about 7:1. The gold used everywhere else on the site, with ink dark enough to read on it.' },
  { key: 'ink', label: 'Ink navy', bg: '#101B2E', ink: '#F5E4C0', bd: '#101B2E', note: 'The deepest navy with cream lettering. Right on a pale field where the standard navy is not quite separate enough.' },
  { key: 'teal', label: 'Teal', bg: '#2E7EA6', ink: '#FFFFFF', bd: '#2E7EA6', note: 'The site’s teal with white lettering, about 4.6:1. Reads as a second action beside a navy or gold one.' },
  { key: 'cream', label: 'Cream', bg: '#F5E4C0', ink: '#1B1608', bd: '#F5E4C0', note: 'Cream with near-black lettering. For a dark field, where a pale button is the one that stands out.' },
  { key: 'outline', label: 'Outline', bg: 'transparent', ink: 'currentColor', bd: 'currentColor', note: 'No fill — a hairline and the surrounding text color. Right for the quieter of two buttons side by side.' },
];
export const BTN_KEYS = BTNS.map((b) => b.key);

// What the card holds is picked from a short list rather than left as a blank
// canvas. The first two read the one church-details record, so changing the
// service times once changes every card on the site — which is the reason to
// offer them as choices at all rather than as free text.
export const CARD_SHOWS = [
  { key: 'services', label: 'Service times', note: 'Reads the service times from the church details — change them once and every card follows.' },
  { key: 'address', label: 'Address & directions', note: 'Reads the address from the church details, with a link to directions.' },
  { key: 'contact', label: 'Contact', note: 'The office phone and email from the church details.' },
  { key: 'links', label: 'A short list of links', note: 'Up to four links, typed below.' },
  { key: 'text', label: 'Free text', note: 'The only option that asks you to type anything.' },
];

// Spacing guardrail: 8px steps, 0–96. No free-form pixel input anywhere.
export const SPACE_STEP = 8;
export const SPACE_MAX = 96;
export const snapSpace = (v) => Math.max(0, Math.min(SPACE_MAX, Math.round((Number(v) || 0) / SPACE_STEP) * SPACE_STEP));

// ── BLOCK TYPES ──────────────────────────────────────────────────────────────
// `items` blocks carry a small repeating list (FAQ rows, meeting times, …).
// itemFields lists the plain-text fields each row has; `rich` marks the ones
// edited as rich text. Anything not listed is dropped on save.

export const BLOCK_DEFS = {
  // ── Site-wide blocks. Several of these fill themselves from data the church
  // already maintains: the point is that nobody retypes a sermon title into a
  // page and then lets it go stale.
  alert: {
    label: 'Notice bar', glyph: '!',
    defaults: { body: 'Something everyone needs to know.', spaceAbove: 0, spaceBelow: 16, url: '' },
    url: true, urlLabel: 'Where "Details" goes (optional)', richBody: true, align: true,
  },
  slideshow: {
    label: 'Welcome banner', glyph: '❏',
    align: true,
    defaults: { title: 'A line that says who you are', subtitle: 'A sentence underneath it.', spaceAbove: 0, spaceBelow: 24 },
    photo: true, subtitle: true, richSubtitle: true, banner: true, infoCard: true,
    links: true, defaultLinks: [{ title: 'Plan your visit', url: '/visit' }, { title: 'Watch a service', url: '/worship' }],
    items: true, itemFields: ['url', 'title'], itemUrlFields: ['url'], itemLabel: 'Slide', gallery: true, defaultItems: [],
  },
  quicklinks: {
    label: 'Link tiles', glyph: '⊞',
    align: true,
    defaults: { title: 'Start here', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['title', 'url', 'meta'], itemUrlFields: ['url'], itemLabel: 'Tile',
    itemPlaceholders: { title: 'Label', url: 'Where it goes', meta: 'Small note' },
    defaultItems: [
      { title: 'Plan a visit', url: '/visit', meta: 'Visit' },
      { title: 'Worship & sermons', url: '/worship', meta: 'Worship' },
      { title: 'School & daycare', url: '/school', meta: 'School' },
      { title: 'Give', url: '/give', meta: 'Give' },
    ],
  },
  sermon: {
    label: 'Latest sermon', glyph: '♪',
    align: true,
    defaults: { title: 'The latest sermon', spaceAbove: 24, spaceBelow: 24 },
    auto: 'sermon', autoNote: 'Shows the newest sermon from the sermon library. Nothing to update by hand.',
    autoCount: false,
  },
  news: {
    label: 'News highlights', glyph: '▤',
    align: true,
    defaults: { title: 'What\u2019s happening', spaceAbove: 24, spaceBelow: 24 },
    auto: 'news', autoNote: 'Shows the newest posts. Pin a post to keep it in front.',
  },
  // The /news page's own feed - every current announcement AND event, as full
  // expandable cards (image, summary, body), not the title-and-date list
  // "News highlights" shows elsewhere. It shares that block's data but not its
  // shape, so pages already using "News highlights" are untouched by this.
  newsfeed: {
    label: 'News feed', glyph: '☰',
    align: true,
    defaults: { title: 'Announcements & events', spaceAbove: 24, spaceBelow: 24, count: 4, cols: 2, photos: true },
    auto: 'newsfeed', autoCount: true,
    choices: [
      { key: 'cols', label: 'Cards per row', def: 2, options: [{ key: 1, label: '1' }, { key: 2, label: '2' }],
        note: 'Two reads as a feed you scan; one reads as a list you work through. Both stack on a phone.' },
    ],
    switches: [
      { key: 'photos', label: 'Show photos', def: true,
        note: 'A post with no picture keeps its full card either way \u2014 it simply starts at the heading, rather than leaving a gray rectangle where a photograph should be.' },
    ],
    autoNote: 'Every current announcement and event. An event (one with a date) sorts soonest-first and drops off once it has passed; a plain announcement sorts newest-first. Nothing to update by hand.',
    autoCount: false,
  },
  newsletterarchive: {
    label: 'Newsletter archive', glyph: '✉',
    align: true,
    defaults: { title: 'Weekly newsletters', spaceAbove: 24, spaceBelow: 24, count: 1 },
    auto: 'newsletterarchive',
    autoNote: 'Every sent newsletter, newest first. The count below is how many of the most recent are open with a preview; everything older folds away under its month, closed, showing just the title of each letter.',
  },
  staff: {
    label: 'Staff grid', glyph: '☺',
    align: true,
    defaults: { title: 'People to know', spaceAbove: 24, spaceBelow: 24 },
    // ⚠ NO COUNT CONTROL, AND THE BLOCK NO LONGER SLICES. A staff grid is the
    // DIRECTORY, not a feed — "the three most recent people" is not a thing
    // anybody wants on an About page, and the count was silently cutting the
    // church's own staff off the bottom of it. `count` is clamped to 1..6 for
    // every block type, so a directory of eight could never show more than six
    // and showed three by default, while the hardcoded /about it replaces has
    // always shown everybody. Who appears, and in what order, is decided on the
    // Staff screen — which is where somebody looking to change it would go.
    auto: 'staff', autoCount: false,
    autoNote: 'Everybody in the staff directory, in the order set on the Staff screen.',
  },
  servicetimes: {
    label: 'Service times', glyph: '◷',
    align: true,
    defaults: { title: 'When we gather', spaceAbove: 24, spaceBelow: 24 },
    auto: 'servicetimes', autoNote: 'Reads the one service-times record in the admin, so a change lands on every page at once.',
    autoCount: false,
    choices: [
      { key: 'layout', label: 'Shown as', def: 'rows', options: [{ key: 'rows', label: 'A list' }, { key: 'tiles', label: 'Big tiles' }],
        note: 'Tiles set the time itself at full display size, alternating dark and gold \u2014 right when the times are the reason somebody opened the page. A list is right when they are one detail among several.' },
    ],
  },
  map: {
    label: 'Map & address', glyph: '◎',
    align: true,
    defaults: { title: 'Find us', body: '<p>Where to park and which door to use.</p>', spaceAbove: 24, spaceBelow: 24 },
    richBody: true, auto: 'map', autoNote: 'The address, phone and email come from the church details in the admin.',
    autoCount: false, split: true,
  },
  // ⚠ THE BLOCK /sermons COULD NOT BE BUILT WITHOUT. Its hardcoded markup was
  // filled live by loadSermons(), so the extractor correctly found nothing to
  // lift and produced a page of `hero, buttons` — which was harmless while the
  // page was unpublished and became "the sermons are gone" the moment it was
  // published, because the takeover hides the very section loadSermons() fills.
  //
  // Self-filling from ctx.data, like the sermon card and the staff grid: a
  // sermon preached next week appears with nobody editing a page. There is
  // nothing here to type and nothing to keep in step.
  sermonlist: {
    label: 'Sermon library', glyph: '≡',
    align: true,
    defaults: { title: 'Sermons', body: '', spaceAbove: 24, spaceBelow: 24 },
    richBody: true,
    auto: 'sermonlist',
    autoNote: 'Every series and the sermons in it, read from the Sermons screen. Add a sermon there and it appears here.',
    autoCount: false,
    switches: [
      { key: 'openFirst', label: 'Open the current series', def: true,
        note: 'The active series starts expanded and the rest are folded away. A page that opens with everything expanded is a very long page.' },
    ],
  },

  // ⚠ THE SAME SHAPE AS THE SERMON LIBRARY, AND THE SAME TRAP. /education — the
  // page the menu calls "Learn" — draws its class cards into a
  // `bible-classes-grid` that loadBibleClasses() fills from the API at runtime.
  // So the extractor correctly lifts the page's prose and nothing else, and
  // publishing it would hide the very grid that loader fills. This is the block
  // that keeps that from happening.
  classes: {
    label: 'Bible classes', glyph: '✦',
    align: true,
    defaults: { title: 'Classes and studies', body: '', spaceAbove: 24, spaceBelow: 24, cols: 3 },
    richBody: true,
    auto: 'classes',
    autoNote: 'Every active class, read from the Christian Ed screen. Add one there, or pause one, and this follows.',
    autoCount: false,
    choices: [
      { key: 'cols', label: 'Columns', def: 3,
        options: [{ key: 2, label: 'Two' }, { key: 3, label: 'Three' }],
        note: 'Three reads well with six or more classes; two gives each card more room when there are only a few.' },
    ],
  },

  // Everything the church has for reaching it, in one droppable block. The
  // info card can already show an address or a phone number, but only as a slot
  // on a banner — so a plain page had no way to say "here is how you reach us"
  // without somebody typing the address into a text block, where it goes stale
  // the day the office moves.
  //
  // ⚠ IT READS THE RECORD, so it joins the sermon block and the staff grid as
  // self-filling. The one thing it will store is an email override, and that is
  // the exception described on `contactEmail` in sanitizeBlock.
  contact: {
    label: 'Contact details', glyph: '✆',
    align: true,
    defaults: { title: 'How to reach us', body: '', spaceAbove: 24, spaceBelow: 24 },
    richBody: true,
    auto: 'contact',
    autoNote: 'The address, phone, email and social accounts all come from Church details in the admin — change them once and every Contact block on the site follows.',
    autoCount: false,
    contactEmail: true,
    switches: [
      { key: 'showAddress', label: 'Show the address', def: true,
        note: 'The street address, with a link to directions. Off when the block is only there to give somebody a phone number.' },
      { key: 'showSocial', label: 'Show social accounts', def: true,
        note: 'Facebook, Instagram and YouTube, as named links. An account left blank under Church details is left off entirely — a link to nowhere is worse than no link.' },
    ],
  },
  hero: {
    label: 'Hero banner', glyph: '▣',
    defaults: { title: 'Ministry name', eyebrow: 'Ministry', subtitle: 'One line about this ministry.', spaceAbove: 0, spaceBelow: 0, veil: 'medium', imgPos: 'center' },
    photo: true, subtitle: true, richSubtitle: true, banner: true, infoCard: true, align: true,
    choices: [
      { key: 'veil', label: 'Photo shading', def: 'medium', options: VEILS,
        note: 'How much dark is laid over the photograph so the white headline stays readable. Lighter if the photograph is already dark. With no photo there is nothing to shade and this does nothing.' },
      { key: 'imgPos', label: 'Photo position', def: 'center', options: IMG_POSITIONS,
        note: 'Which part of the photo stays in frame once it is cropped to fit the banner — Top if the subject sits high in the picture, Bottom if it sits low. With no photo this does nothing.' },
    ],
  },
  text: {
    label: 'Rich text', glyph: '¶',
    defaults: { body: '<p>Tell people what this ministry is and who it is for.</p>', spaceAbove: 8, spaceBelow: 8 },
    richBody: true, align: true,
  },
  textphoto: {
    label: 'Text + photo', glyph: '◲',
    defaults: { title: 'A heading', body: '<p>A short paragraph beside the photo.</p>', spaceAbove: 24, spaceBelow: 24 },
    richBody: true, photo: true, align: true,
  },
  columns: {
    label: 'Columns', glyph: '▥',
    align: true,
    defaults: { title: 'Three ways to take part', spaceAbove: 24, spaceBelow: 24, cols: 2 },
    items: true, itemFields: ['title', 'body'], richItemFields: ['body'],
    itemLabel: 'Column',
    defaultItems: [
      { title: 'First', body: '<p>What happens here.</p>' },
      { title: 'Second', body: '<p>What happens here.</p>' },
    ],
  },
  // ── CARD GRID (Task 14) ──────────────────────────────────────────────────
  // The live site uses this layout on four pages and the editor could not make
  // it: /worship's four info cards, /education's three class cards,
  // /ministries' eight cards with a colored top rule, and the community
  // partners row. `columns` is plain text with no card, no image and no link;
  // `quicklinks` is a fixed 4-up of short labels. Neither is this.
  //
  // Every per-card field except the heading is optional, ON PURPOSE: one grid
  // has to carry a logo card and a text-only card side by side without looking
  // half-finished. /ministries mixes a wordmark, a roundel and a photograph.
  cardgrid: {
    label: 'Card grid', glyph: '▩',
    align: true,
    defaults: {
      eyebrow: 'WHAT WE OFFER', title: 'Ways to take part', subtitle: '',
      spaceAbove: 24, spaceBelow: 24, cols: 3, align: 'left', topRule: false,
      logos: false, feature: false,
    },
    switches: [
      { key: 'logos', label: 'Pictures are logos', def: false,
        note: 'Logos sit at their own size against the card, left-aligned and never cropped. Photographs fill the card top edge to edge. A grid of one kind should not be laid out as the other.' },
      { key: 'feature', label: 'Lead with a featured card', def: false,
        note: 'The first card is drawn dark, so the eye starts somewhere. It is the first card rather than a chosen one, so reordering the grid moves it \u2014 there is no second setting to forget.' },
    ],
    items: true,
    itemFields: ['img', 'eyebrow', 'title', 'body', 'linkLabel', 'url'],
    richItemFields: ['body'],
    itemUrlFields: ['img', 'url'],
    // ⚠ A picture, not a destination. `itemUrlFields` only says "put this
    // through safeUrl"; it cannot tell an address a visitor is SENT to from one
    // an <img> is pointed at, and the editor has to know the difference — one
    // gets the pick-a-page control and the dead-link warning, the other gets a
    // thumbnail and a place to drop a photograph. Declared on the type so a new
    // block with a picture field gets the right control for free, and one with
    // a link field never gets it by accident.
    itemImageFields: ['img'],
    itemLabel: 'Card',
    itemPlaceholders: {
      img: 'Logo or photo (optional)', eyebrow: 'SMALL LABEL', title: 'Card heading',
      body: 'One short paragraph.', linkLabel: 'Learn more', url: '/where-it-goes',
    },
    defaultItems: [
      { title: 'First card', body: '<p>What this is.</p>', linkLabel: 'Learn more', url: '' },
      { title: 'Second card', body: '<p>What this is.</p>', linkLabel: 'Learn more', url: '' },
      { title: 'Third card', body: '<p>What this is.</p>', linkLabel: 'Learn more', url: '' },
    ],
  },
  video: {
    label: 'Video', glyph: '▶',
    align: true,
    defaults: { title: 'Watch', spaceAbove: 24, spaceBelow: 24 },
    video: true,
  },
  gallery: {
    label: 'Photo gallery', glyph: '▦',
    align: true,
    defaults: { title: 'Through the church year', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['url', 'title'], itemUrlFields: ['url'], itemLabel: 'Photo', gallery: true,
    defaultItems: [],
  },
  posts: {
    label: 'Posts feed', glyph: '☰',
    align: true,
    defaults: { title: 'From this ministry', spaceAbove: 24, spaceBelow: 24 },
    feed: 'posts', auto: 'posts', autoNote: 'Shows the newest posts for this page.',
  },
  faq: {
    label: 'FAQ', glyph: '?',
    align: true,
    defaults: { title: 'Questions people ask', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['title', 'body'], richItemFields: ['body'], itemLabel: 'Question',
    defaultItems: [{ title: 'A question people ask', body: '<p>The answer.</p>' }],
  },
  // ⚠ THIS EXISTS TO STOP A PAGE BECOMING ONE LONG WALL OF TEXT. Dinger, on
  // confirmation: the youth director will post everything whether or not
  // anybody reads it, so the job is to give him somewhere to put it that stays
  // legible. Folding is the whole feature — every lesson closed, so the page
  // reads as a syllabus rather than a transcript.
  //
  // <details>, the same choice the FAQ, the sermon library and the newsletter
  // archive all make: no JavaScript, a keyboard and screen-reader control for
  // free, and identical in the editor canvas and on the live page.
  lessons: {
    label: 'Lessons', glyph: '⋮',
    align: true,
    defaults: { title: 'Lessons in this study', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['meta', 'title', 'body', 'url'], richItemFields: ['body'],
    itemUrlFields: ['url'], itemLabel: 'Lesson',
    itemPlaceholders: { meta: 'Week 1', title: 'What this one is about', body: 'The notes', url: 'A handout to download (optional)' },
    defaultItems: [
      { meta: 'Week 1', title: 'The first lesson', body: '<p>What this week covers.</p>', url: '' },
      { meta: 'Week 2', title: 'The second lesson', body: '<p>What this week covers.</p>', url: '' },
    ],
  },
  // A way into the member site. This was possible already — any button block
  // can point at it — but a link in a row of buttons says nothing about what is
  // behind it, and "log in" is exactly the thing somebody needs told.
  portal: {
    label: 'Member portal', glyph: '⌸',
    align: true,
    defaults: {
      title: 'Members', subtitle: 'Timothy Connect',
      body: '<p>Your directory, giving history and sign-ups, in one place.</p>',
      url: 'https://connect.timothystl.org', spaceAbove: 24, spaceBelow: 24,
    },
    subtitle: true, richBody: true, url: true, urlLabel: 'Where the button goes',
  },
  events: {
    label: 'Upcoming events', glyph: '▤',
    align: true,
    defaults: { title: 'Upcoming', spaceAbove: 24, spaceBelow: 24 },
    feed: 'events', auto: 'events', autoNote: 'Pulls from the church calendar.',
  },
  times: {
    label: 'Meeting times', glyph: '◷',
    align: true,
    defaults: { title: 'When we gather', spaceAbove: 24, spaceBelow: 24, layout: 'rows' },
    items: true, itemFields: ['title', 'body', 'meta'], itemLabel: 'Row',
    itemPlaceholders: { title: 'Who', body: 'When', meta: 'Where' },
    defaultItems: [{ title: 'Group name', body: 'Wednesdays, 7:00 pm', meta: 'Fellowship Hall' }],
    // The same two layouts Service times has, drawn by the same .tlcb-tile
    // rules — Dinger asked for the tile look here, and the alternative was a
    // second set of tile CSS that agrees with the first until somebody
    // improves one of them.
    // ⚠ `rows` is the default, so every Meeting times block already on the
    // site renders exactly as it did.
    choices: [
      { key: 'layout', label: 'Shown as', def: 'rows',
        options: [{ key: 'rows', label: 'A list' }, { key: 'tiles', label: 'Big tiles' }],
        note: 'Tiles give each group its own card, alternating ink navy and gold — right when the meetings are the reason somebody opened the page. A list is right when they are one detail among several.' },
    ],
  },

  // ⚠ THE FREELY-EDITABLE TILES. Service times draws tiles from the one
  // church-details record, which is what makes it correct everywhere at once
  // and also what makes it useless for anything that is not a service. Dinger
  // asked for "cards that drop on the boxes like the service times box but
  // that I can edit freely", and this is that: the same .tlcb-tile rules, the
  // same alternating pairing, with the words typed on the page.
  //
  // It is a separate type rather than a "source" switch on Service times
  // because the two hold different things — one has a day and a time read from
  // a record, the other has whatever somebody wants to put in a box — and a
  // switch between them would silently discard one shape or the other.
  tiles: {
    label: 'Info tiles', glyph: '▤',
    align: true,
    defaults: { title: 'At a glance', spaceAbove: 24, spaceBelow: 24 },
    items: true,
    itemFields: ['big', 'title', 'body'],
    richItemFields: ['body'],
    itemLabel: 'Tile',
    itemPlaceholders: { big: 'A number or a time', title: 'Tile heading', body: 'One short line.' },
    defaultItems: [
      { big: '', title: 'First tile', body: '<p>What this is.</p>' },
      { big: '', title: 'Second tile', body: '<p>What this is.</p>' },
    ],
  },
  calendar: {
    label: 'Calendar', glyph: '▩',
    align: true,
    defaults: { title: 'Calendar', spaceAbove: 24, spaceBelow: 24, url: '', embedHeight: 'm', subscribe: true },
    // ⚠ embedGate: this field also takes a Google Form and other embeds (see
    // the render branch below), and until now NOTHING checked which sites
    // those "other embeds" were allowed to be — any https address rendered
    // straight into an iframe. Gated on the same allowlist the Embed block
    // uses, below.
    url: true, urlLabel: 'Google Calendar embed URL', richBody: true, embedGate: true,
    choices: [
      { key: 'embedHeight', label: 'How tall', def: 'm', options: EMBED_HEIGHTS,
        // ⚠ Says which case it applies to, because for the common one it
        // applies to nothing: the church calendar sizes itself, and a control
        // that silently does nothing is worse than one that explains itself.
        note: 'Only applies to an embedded form or other embed. Left blank, or given a Google Calendar address, this block draws the church calendar, which sizes itself.' },
    ],
    switches: [
      { key: 'subscribe', label: 'Offer to add it to a phone', def: true,
        note: 'A second button that subscribes somebody\u2019s own calendar app, so it keeps updating instead of relying on them coming back to this page.' },
    ],
  },
  download: {
    label: 'File download', glyph: '⤓',
    align: true,
    defaults: { title: 'A document to download', body: 'PDF', spaceAbove: 16, spaceBelow: 16 },
    url: true, urlLabel: 'File URL',
  },

  // A list of files, where `download` is one. A confirmation packet, a set of
  // forms, a year of council minutes — several documents that belong together
  // rather than one line each competing for its own block.
  documents: {
    label: 'Documents', glyph: '▧',
    align: true,
    defaults: { title: 'Downloads', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['title', 'url'], itemUrlFields: ['url'], itemFileFields: ['url'],
    itemLabel: 'File',
    itemPlaceholders: { title: 'What the file is', url: 'PDF, or a link — Google Drive, etc.' },
    defaultItems: [{ title: 'A document', url: '' }],
  },
  callout: {
    label: 'Callout box', glyph: '❢',
    defaults: { title: 'Please note', body: '<p>Something people need to know.</p>', spaceAbove: 24, spaceBelow: 24 },
    richBody: true, infoCard: true, align: true,
  },
  // A call to action, not a bare row of buttons. The heading and the
  // description default to EMPTY, so every Button bar already on a page keeps
  // rendering exactly the row it renders today — the head is drawn only when
  // somebody has written one (or when the editor is open, where it shows as a
  // placeholder to type into).
  buttons: {
    label: 'Button bar', glyph: '⬒',
    align: true,
    defaults: { eyebrow: '', title: '', body: '', spaceAbove: 16, spaceBelow: 16 },
    richBody: true,
    items: true, itemFields: ['title', 'url'], itemUrlFields: ['url'], itemLabel: 'Button',
    itemPlaceholders: { title: 'Button label', url: 'https://…' },
    defaultItems: [{ title: 'Get in touch', url: 'mailto:office@timothystl.org' }],
  },
  spacer: {
    label: 'Spacer', glyph: '↕',
    defaults: { spaceAbove: 0, spaceBelow: 0, height: 48 },
  },
  // ⚠ Two sources, and 'record' is the default for a NEW block on purpose.
  // A logo typed in here is a logo the values page and the footer's Partners
  // column never get, and one that goes stale the moment a partner rebrands —
  // the same argument that makes the sermon and staff blocks self-filling. The
  // hand-typed list stays available (`manual`) because not every logo on the
  // site is a partner ministry: a sponsor, a denomination mark or a one-off
  // event supporter has no business being a row in `partners`.
  //
  // Existing blocks keep 'manual' — see sanitizeBlock, which only defaults to
  // 'record' when the block carries no items and no source of its own.
  partners: {
    label: 'Partner logos', glyph: '◈',
    align: true,
    partnerSource: true,
    defaults: { title: 'With thanks to', spaceAbove: 24, spaceBelow: 24, source: 'record', partnerIds: [] },
    items: true, itemFields: ['title', 'url', 'meta'], itemUrlFields: ['url', 'meta'], itemLabel: 'Partner',
    itemImageFields: ['meta'],
    itemPlaceholders: { title: 'Partner name', url: 'Link (optional)', meta: 'Logo image URL' },
    defaultItems: [{ title: 'Partner name', url: '', meta: '' }],
  },
  form: {
    label: 'Signup form', glyph: '◉',
    defaults: { title: 'Sign up', body: 'Fill this in and the office will be in touch.', spaceAbove: 24, spaceBelow: 24, url: '' },
    // ⚠ embedGate: this had the same gap Calendar's "other embed" fallback
    // did — an arbitrary https address, iframed with no check on where it
    // pointed. The field only ever asked for a Google Form, which is on the
    // allowlist, so this closes it with no change to the documented use.
    url: true, urlLabel: 'Google Form embed URL', richBody: true, align: true, embedGate: true,
  },
  // A handful of other services the office pastes in, and nothing else —
  // see EMBED_HOSTS above the sanitizer for the full list and why it exists.
  // Distinct from Calendar and Signup form, which are typed for one Google
  // product each; this is the block for the rest of them (a Drive folder, a
  // Tithe.ly or Square checkout, a podcast player, one of the church's own
  // other apps at connect./serve./mdo.timothystl.org).
  embed: {
    label: 'Embed', glyph: '⧉',
    align: true,
    defaults: { title: '', spaceAbove: 24, spaceBelow: 24, url: '', embedHeight: 'm' },
    url: true, urlLabel: 'Paste the embed code, or just the address', richBody: true, embedGate: true,
    choices: [
      { key: 'embedHeight', label: 'How tall', def: 'm', options: EMBED_HEIGHTS,
        note: 'A tall page like a Google Form usually wants Tall; a short player like a podcast episode usually wants Short.' },
    ],
  },
  newsletter: {
    label: 'Newsletter', glyph: '✉',
    defaults: { title: 'Get news by email', body: 'A short note each month.', spaceAbove: 24, spaceBelow: 24 },
    richBody: true, align: true,
  },
  give: {
    label: 'Give', glyph: '♡',
    // ⚠ bg:3/ink:3 is Navy + Cream — the exact pair `.tlcb-give` used to
    // hardcode in CSS. A new block still opens looking like it always has;
    // what changed is that the Background/Text swatches now actually reach
    // it, instead of being cosmetically disconnected from a fixed color.
    defaults: { title: 'Support this ministry', body: 'Gifts go directly toward this work.', spaceAbove: 24, spaceBelow: 24, url: 'https://give.timothystl.org', bg: 3, ink: 3 },
    url: true, urlLabel: 'Giving link', richBody: true, align: true,
    // Which fund the button lands on. The list comes from the Giving screen at
    // render time; the block stores only the id. See the render branch.
    giveFund: true,
    // Not every use of this block is a donation ask — a table fee, an event
    // registration, a deposit. Blank keeps the computed "Give now" / "Give to
    // X" wording; typing anything replaces it outright, same rule contactEmail
    // follows for the same reason: the common case needs no field filled in.
    buttonText: true,
  },

  // ── THE TWO GIVING-PAGE BLOCKS ────────────────────────────────────────────
  // These are what let give.timothystl.org be edited without ever putting a
  // Tithe.ly address into a block.
  //
  // ⚠ THE RULE THAT MAKES THIS SAFE, and the reason the giving page sat in
  // hardcoded code until now: a block's URL is frozen the moment the page is
  // published. Storing the Tithe.ly link in a block would mean the office
  // changing the base link on the Giving screen and the donation page going
  // on charging to the old form — silently, because the page would still look
  // perfect. So NEITHER of these types has a `url` field and neither has an
  // `itemUrlFields` entry. There is nowhere to put a link even by accident.
  // Every href on both is COMPUTED at render time from ctx.data.give, exactly
  // as give-landing.js has always computed it.

  // The transaction itself: chips, the fund dropdown, a custom amount, the
  // button. Entirely self-filling — the amounts come from the Giving screen's
  // Amount Tiers, the funds from its Funds, the base link from its Base
  // Tithe.ly Link. What is editable here is the wording around them.
  giving: {
    label: 'Giving widget', glyph: '$',
    defaults: {
      title: 'Give to Timothy', subtitle: 'From Our Neighborhood to the Nations',
      body: 'Secure, encrypted giving through Tithe.ly. Receipt emailed instantly · tax-deductible · no account required.',
      eyebrow: '', spaceAbove: 24, spaceBelow: 24,
    },
    subtitle: true, richBody: true, align: true,
    auto: 'give',
    autoNote: 'The amounts, the funds and the Tithe.ly link all come from the Giving screen. Nothing here holds a payment link, so changing the base link on that screen changes this the moment it is saved.',
    autoCount: false,
  },

  // The ministry ladder and the leadership tiers are the SAME SHAPE — a
  // heading, a short intro, and a list of "$X /period — what it does" rows,
  // each with its own Give button. They differ only in color, which is
  // already a block-level choice (Theme colors). So this is one type used
  // twice, not two near-identical types that would drift apart the first time
  // somebody improved one of them.
  amounts: {
    label: 'Amount ladder', glyph: '≣',
    defaults: {
      eyebrow: 'What your generosity makes possible',
      title: 'Every gift accomplishes great things in His Kingdom.',
      body: '', spaceAbove: 24, spaceBelow: 24,
    },
    richBody: true, align: true,
    items: true,
    // No URL field, on purpose — see the note above. `amount` is a plain field
    // rather than a number because it is typed by hand; it is parsed when the
    // link is built, and a row that is not a number renders as prose with no
    // button rather than as a broken one.
    itemFields: ['amount', 'period', 'body'],
    richItemFields: ['body'],
    itemLabel: 'Amount',
    itemPlaceholders: { amount: '25', period: 'week', body: 'What this gift does.' },
    defaultItems: [
      { amount: '30', period: 'week', body: '<p>Puts flowers on the altar.</p>' },
      { amount: '100', period: 'week', body: '<p>Provides tuition assistance for a child to Word of Life.</p>' },
    ],
  },

  // ── THE CHRISTMAS MARKET APPLICATION ──────────────────────────────────────
  // The three-step vendor application from /christmasmarket/vendors, folded
  // into the editor at Andrew's own request, after he supplied the market's
  // real 2026 rules and there was nowhere on the site to put them without a
  // developer editing public/index.html by hand.
  //
  // ⚠ THE SAME RULE AS THE TWO GIVING-PAGE BLOCKS, FOR THE SAME REASON: this
  // type has no url field and cannot have one. What a vendor is charged and
  // what is recorded against them both come from admin/market.js's
  // priceBreakdown() at the moment they submit — a block's own value is the
  // RUNNING TOTAL shown on screen, never the address the money is sent to. See
  // the 'marketapp' branch in renderBlock() and `data.market` in pageData().
  //
  // What IS editable here: the intro above the form (this block's own `body`),
  // and the vendor agreement's clauses — as an item list, the same shape the
  // FAQ block uses, so a clause can be added, removed, reordered or reworded
  // without a developer. Everything else — the fields themselves, the pricing
  // math, the payment hand-off — is fixed, because it is the one thing on this
  // page that actually takes money and it has already been tested end to end.
  marketapp: {
    label: 'Market application', glyph: '⚑',
    align: true, richBody: true,
    defaults: {
      eyebrow: 'The application', title: 'Vendor application',
      body: '<p>Three short steps, about five minutes. You pay by card at the end and the coordinator confirms your table number by email.</p>',
      spaceAbove: 24, spaceBelow: 24,
    },
    auto: 'market',
    autoNote: 'The fee, the dates, the table maximum and whether applications are open all come from Settings and the Christmas Market screen — change one there and this follows. Nothing here can hold a payment address; that is resolved from the Giving screen the instant somebody submits.',
    autoCount: false,
    items: true, itemFields: ['body'], richItemFields: ['body'], itemLabel: 'Agreement clause',
    // The nine real clauses, as Andrew sent them (2026-08). A clause with no
    // words is dropped at render rather than shown blank, the same rule every
    // item list on the site follows.
    defaultItems: [
      { body: '<p>The fee for my table(s), plus the card processing fee, is due when I apply. It is refunded only if my application or products are declined as inappropriate; otherwise there is no refund for a withdrawal within three weeks of the market, or for a no-show.</p>' },
      { body: '<p>Timothy Lutheran Church provides one 6-foot table and weather coverage for each 8×10 ft space. I supply my own chairs, a table covering that reaches the ground, signage, display, bags, and change, and I keep my display within my assigned space.</p>' },
      { body: '<p>My merchandise reflects handmade, Christmas, and gift themes. I will not sell secondhand items, and I will not sell alcohol or other beverages.</p>' },
      { body: '<p>I will enter from Ivanhoe at the north lot entrance by 8:30 am and be set up before vehicle access closes at 10:30. I will keep my table staffed until the market closes at 6:00 pm, and move my vehicle back to the lot to load out only once vehicles are allowed back in at 6:15 pm.</p>' },
      { body: '<p>All my electrical needs and appliances are declared on my application and approved by Marla Steenbock in advance. I will not bring a heater or a heated blanket.</p>' },
      { body: '<p>If I sell food or drink, I am responsible for complying with all City of St. Louis health department requirements and for safe handling of everything I serve.</p>' },
      { body: '<p>I am responsible for collecting and reporting any sales tax, and for the security of my own merchandise and cash.</p>' },
      { body: '<p>Timothy Lutheran Church is not liable for loss, theft, or damage to my property, or for injury arising from my participation. I will leave my space clean.</p>' },
      { body: '<p>Timothy Lutheran Church may photograph the market and use those images to promote future markets.</p>' },
    ],
  },

  // ── A GENERIC EVENT'S REGISTRATION FORM ───────────────────────────────────
  // `marketapp` above is the Christmas Market's own three-step, nine-field
  // wizard, kept exactly as it is (ground rule: the market must not regress).
  // This is the general case that lets ANY event — VBS, the Egg Hunt, a
  // concert — take sign-ups with no developer, driven entirely by that
  // event's own `site_event_fields` rows (see admin/events.js).
  //
  // ⚠ SAME RULE AS marketapp: NO url FIELD, AND IT CANNOT HAVE ONE. What a
  // registrant is charged and where the payment goes are both resolved from
  // that event's own `site_events` row at the moment they submit — see the
  // 'registration' branch in renderBlock() and `data.eventsById` in
  // pageData(). A block's URL is frozen the instant the page is published;
  // storing a payment address here would go on charging to the old form
  // after the office changed it, and the page would still look perfect.
  //
  // ⚠ `eventId` IS AN ID REFERENCE, NOT A LINK — the same shape the `give`
  // block's own `fundId` already is. It says WHICH event this form belongs
  // to; it is never itself a URL and safeUrl() never touches it.
  registration: {
    label: 'Event registration', glyph: '✎',
    align: true, richBody: true,
    defaults: {
      eyebrow: 'Register', title: 'Sign up',
      body: '<p>Fill this in to reserve your spot.</p>',
      eventId: '', spaceAbove: 24, spaceBelow: 24,
    },
    eventRef: true,
    auto: 'events', autoCount: false,
    autoNote: 'Which event this is, and every field it asks for, come from that event’s own Registrations tab — pick the event on the right, then add fields there. Nothing about capacity, price or whether sign-ups are open is typed here.',
  },

  // ── THE JUMP BAR ──────────────────────────────────────────────────────────
  // A row of chips that jump to the sections further down the page, with an
  // optional filled button on the right.
  //
  // ⚠ IT IS A SITE-WIDE CAPABILITY, NOT A MARKET FEATURE. It was asked for by
  // a handoff about the Christmas Market and it is built once, here, so any
  // long page can carry one — a `/give` that has grown six sections, a
  // ministry page with a rules section somebody keeps being asked to find.
  //
  // ⚠ `auto` IS THE DEFAULT AND IS THE WHOLE POINT. The links are derived from
  // the page's own blocks at render time, so adding, removing or reordering a
  // section moves the bar with it and there is nothing to keep in step by
  // hand. `manual` exists for the one thing derivation cannot do — link OUT
  // (the market points at the volunteer sign-up on another host).
  //
  // ⚠ IT IS SERVER-RENDERED. No client-side derivation, because the bar has to
  // be in the HTML a crawler and a reader with no JavaScript get — a
  // navigation aid that needs a script to exist is one the people most likely
  // to need it never see.
  jumplinks: {
    label: 'Jump links', glyph: '⇥',
    align: true,
    defaults: { title: 'Jump to', mode: 'auto', sticky: true, url: '', buttonText: '', spaceAbove: 0, spaceBelow: 0 },
    // The bar's own micro-label is the block's `title`; blank hides it.
    // The right-hand button is the block's `url` + `buttonText` rather than a
    // nested `cta` object, because those are fields sanitizeBlock and the
    // inspector already have — a nested object would be a new shape in the
    // sanitizer for one block type.
    url: true, urlLabel: 'Where the button on the right goes (optional)', buttonText: true,
    items: true, itemFields: ['title', 'url'], itemUrlFields: ['url'], itemLabel: 'Link',
    itemPlaceholders: { title: 'What it is called', url: '#block-id, or a full address' },
    defaultItems: [],
    choices: [
      { key: 'mode', label: 'Links come from', def: 'auto',
        options: [{ key: 'auto', label: 'The page itself' }, { key: 'manual', label: 'The list below' }],
        note: 'The links are built from the sections on this page. Add, remove or reorder a section and this bar follows — there is nothing here to keep in step by hand.' },
    ],
    switches: [
      { key: 'sticky', label: 'Stick to the top while reading', def: true,
        note: 'The bar stays in view under the site header as somebody scrolls past it. Switch it off and it simply sits where it was put.' },
    ],
    autoNote: 'In "The page itself" mode every section with a heading or an eyebrow becomes a chip, in page order. A block with neither is skipped, because there would be nothing to call it.',
  },

  // ── THE MARKET'S FACTS, READ LIVE ─────────────────────────────────────────
  // The band across the top of /christmasmarket/vendors/apply: market day,
  // hours, table fee and the coordinator's address.
  //
  // ⚠ NOT ONE OF THOSE FOUR VALUES IS TYPED, AND THERE IS NO FIELD TO TYPE
  // ONE INTO. They are the market's own `site_events` row, read through the
  // same eventFeeConfig() (admin/events.js) the application block itself
  // reads, fed in as `data.market`, resolved at render time. That is the
  // whole reason this is a block type rather than
  // four lines somebody writes into a text block: the split page means the
  // date and the fee now appear on TWO public pages, and two typed copies is
  // two things to remember every December. Change the setting once and both
  // pages follow.
  //
  // ⚠ NO url FIELD, for the same reason `marketapp` has none — nothing here
  // may carry a payment address.
  marketfacts: {
    label: 'Market facts', glyph: '⌗',
    align: true,
    defaults: { title: '', spaceAbove: 0, spaceBelow: 0 },
    auto: 'market', autoCount: false,
    autoNote: 'The market day, the hours, the table fee and the coordinator’s address, read from the Christmas Market screen. Nothing here is typed, so this band and the application below it can never quote different figures.',
  },

  // ── THE STANDOUT CARD ─────────────────────────────────────────────────────
  // The handoff calls it "the service-times tile made general", and that is
  // exactly how it is built: it shares its CSS with the Service times block's
  // tiles rather than owning a second copy, so the two cannot drift. Two of
  // these at half width reproduce the Worship layout by hand, which is the
  // point — a page needs "8:00 am" beside "10:45 am" and it also needs
  // "1,240 lbs" beside "68 households", and those are one shape.
  highlight: {
    label: 'Standout card', glyph: '\u25C9',
    align: true, richBody: true,
    defaults: {
      eyebrow: 'Last month', big: '68', title: 'households served',
      body: '<p>What the number means, in a sentence.</p>',
      bg: 6, ink: 3, spaceAbove: 24, spaceBelow: 24,
    },
    // The one field no other type has: a display line set far larger than any
    // heading. It is plain text and short on purpose — it is a number or a
    // time, not a sentence.
    bigLine: true,
    items: true, itemFields: ['title', 'url'], itemUrlFields: ['url'], itemLabel: 'Button',
    itemPlaceholders: { title: 'Button label', url: '/where-it-goes' },
    defaultItems: [],
  },

  // ── THE CALL-TO-ACTION BAND ───────────────────────────────────────────────
  // ⚠ I ARGUED AGAINST THIS TYPE AND WAS WRONG. The reasoning was that the
  // Button bar already carries an eyebrow, a heading and a rich description
  // above its buttons, so on a gold field it IS this. That is true of the
  // markup and false of the job: a Button bar is a row of choices that grew a
  // heading, and this is one ask that happens to end in a button. They want
  // different defaults, different spacing and different wording in the
  // palette, and asking somebody to reach for "Button bar" when they mean
  // "ask the congregation to do something" is the kind of indirection this
  // editor exists to remove. The handoff lists it; it is here.
  cta: {
    label: 'Call-to-action band', glyph: '\u2605',
    align: true, richBody: true,
    defaults: {
      eyebrow: 'Get involved', title: 'Ready to put your hands to work?',
      body: '<p>One short paragraph on why, and what happens next.</p>',
      bg: 7, ink: 6, spaceAbove: 24, spaceBelow: 24,
    },
    items: true, itemFields: ['title', 'url'], itemUrlFields: ['url'], itemLabel: 'Button',
    itemPlaceholders: { title: 'Button label', url: '/where-it-goes' },
    defaultItems: [{ title: 'See what is open', url: '' }],
  },

  // ── THE EMAIL SIGNUP BAND ─────────────────────────────────────────────────
  // ⚠ The Newsletter block is the same idea and stays; this is the redesign's
  // banded version, centered by default and sitting on a field. The one real
  // difference is that this one is a BAND — full width, its own surface — and
  // Newsletter is a card in a column. Same argument as News highlights against
  // News feed, which this repo already settled the same way.
  signup: {
    label: 'Email signup', glyph: '\u2709',
    align: true, richBody: true,
    defaults: {
      eyebrow: 'Stay connected', title: 'The weekly letter',
      body: '<p>News, what is coming up, and a word from Pastor Dinger \u2014 in your inbox each week.</p>',
      align: 'center', bg: 4, ink: 5, spaceAbove: 24, spaceBelow: 24,
    },
  },

  // ── THE FOUR CORE VALUES ──────────────────────────────────────────────────
  // Self-filling from the values record, and ⚠ THE ORDER IS FIXED — Welcome,
  // Receive, Grow, Go. There is deliberately no reorder control, because the
  // order IS the content: it is an arc that starts with being let in and ends
  // pointing out of the door, and each card's "why this one is here" sentence
  // only makes sense in that sequence. This is the one block in the library
  // whose items cannot be dragged, and that is on purpose rather than missing.
  values: {
    label: 'Core values', glyph: '\u2726',
    align: true,
    defaults: { title: 'What we are for', cols: 4, spaceAbove: 24, spaceBelow: 24, bg: 5, ink: 5 },
    auto: 'values',
    autoNote: 'The four core values, always in this order, from the one record they live in. The wording, the partner ministry and the six ways in all come from there — nothing here to retype, and nothing that can go stale.',
    autoCount: false,
    choices: [
      { key: 'cols', label: 'Cards per row', def: 4,
        options: [{ key: 2, label: '2' }, { key: 4, label: '4' }],
        note: 'Four across reads as one arc; two makes each card taller and gives the six ways in room to breathe. Both stack on a phone.' },
    ],
    switches: [
      { key: 'ways', label: 'Show the ways in', def: false,
        note: 'The six things each value looks like in practice. Off, a card is its word, its tagline and its partner ministry \u2014 which is the right length beside other blocks. On, the block becomes the page.' },
    ],
  },

  // ── THE REDESIGN'S OWN FOUR ───────────────────────────────────────────────
  // Four, not the handoff's six. Its `cta` and `signup` types are the Button
  // bar and the Newsletter block already in this file — the Button bar has
  // carried an eyebrow, a heading and a rich description above its buttons
  // since v4.32.0, which is precisely what its `cta` draws. Adding them would
  // have been two more near-identical types to drift apart the first time
  // somebody improved one of them, which is the argument the Amount ladder
  // above already settles. Put either on the Gold or Ink navy background and
  // it is the mock.
  //
  // These four earn their place by being shapes nothing here can make.

  // The full-bleed photograph with the headline over it. Distinct from the two
  // banners above in the ways that matter to this design: it runs edge to edge
  // at a real height, its shading is a choice, and it can count down.
  photobanner: {
    label: 'Photo banner', glyph: '◧',
    align: true, photo: true, subtitle: true, richSubtitle: true, banner: true, infoCard: true,
    defaults: {
      eyebrow: 'Happening next', title: 'The thing everyone should know about.',
      subtitle: 'Where it is, when it starts, and who it is for.',
      spaceAbove: 0, spaceBelow: 0, bg: 6, ink: 3,
      bannerHeight: 'mid', veil: 'medium', countdown: true, pulse: true,
    },
    choices: [
      { key: 'bannerHeight', label: 'Banner height', def: 'mid', options: BANNER_HEIGHTS,
        note: 'Three heights rather than a pixel field, so a banner is never taller than the screen it opens on. All three come down on a phone.' },
      { key: 'veil', label: 'Photo shading', def: 'medium', options: VEILS,
        note: 'How much dark is laid over the photograph so the white headline stays readable. Heavier if the picture is bright or busy. With no photo there is nothing to shade and this does nothing.' },
      { key: 'glow', label: 'Warm glow', def: 'clay', options: GLOWS,
        note: 'A soft warm light from one corner. It is what keeps a banner from reading gray \u2014 with a photograph and without one. Clay on news and sermons, gold on worship and ministries, green on the values page.' },
    ],
    switches: [
      { key: 'countdown', label: 'Countdown', def: true,
        note: 'Counts down to the next dated event in News & Events, and moves itself on to the following one when that passes. Nothing to reset, and nothing shows if there is no upcoming event.' },
      { key: 'pulse', label: 'Pulsing dot', def: true,
        note: 'The small gold dot beside the label. It holds still for anyone whose device asks for reduced motion.' },
    ],
  },

  // A sentence worth setting large, beside the paragraph that explains it.
  // Callout box is a boxed notice; this is the opposite gesture — no box, no
  // border, the words carrying it.
  quote: {
    label: 'Quote band', glyph: '\u275D',
    align: true, richBody: true,
    defaults: {
      title: 'A diverse city church serving as a bold witness to the saving grace of God through Jesus Christ.',
      body: '<p>The paragraph beside it \u2014 who this congregation is, in the plainest words you can find.</p>',
      spaceAbove: 0, spaceBelow: 0, bg: 4, ink: 5,
    },
  },

  // One line of dated pills. Not a feed and not a calendar: the thing you read
  // without stopping, on your way down the page.
  chips: {
    label: 'Coming-up strip', glyph: '\u22EF',
    align: true,
    defaults: { title: 'Coming up', count: 5, spaceAbove: 0, spaceBelow: 0, bg: 5, ink: 5 },
    auto: 'chips',
    autoNote: 'The next few dated events from News & Events, shown as one line of pills. Nothing to update by hand, and the strip disappears entirely when there is nothing coming up.',
  },

  // The Photo banner's countdown switch, as its own block \u2014 for a page that
  // wants a countdown without a full-bleed photograph over it. Same
  // mechanism (COUNTDOWN_SCRIPT, churchInstant), a second place to reach it.
  countdown: {
    label: 'Countdown', glyph: '\u23F1',
    align: true,
    defaults: { eyebrow: 'Coming up', spaceAbove: 24, spaceBelow: 24, newsId: '', pulse: true },
    // Which post to count down to. Blank \u2014 the default \u2014 means the next
    // upcoming one, the same rule `giveFund` and `contactEmail` already use:
    // the common case needs nothing picked. See the render branch and
    // sanitizeBlock's `newsRef` handling.
    newsRef: true,
    switches: [
      { key: 'pulse', label: 'Pulsing dot', def: true,
        note: 'The small gold dot beside the label. It holds still for anyone whose device asks for reduced motion.' },
    ],
  },

  // The archive as a band rather than a column: this week's letter argued for
  // on the left, everything else listed on the right. Same data as Newsletter
  // archive, a different shape — the same relationship News highlights and
  // News feed already have, and for the same reason.
  letter: {
    label: 'Weekly letter', glyph: '\u270E',
    align: true, richBody: true,
    defaults: {
      eyebrow: '', title: 'The weekly letter',
      body: '<p>Pastor Dinger writes every week \u2014 what we are preaching, who needs prayer, and what is on the calendar.</p>',
      count: 5, spaceAbove: 0, spaceBelow: 0, bg: 6, ink: 3, signup: true,
    },
    auto: 'letter',
    autoNote: 'The newest letter is what the button opens, and the ones before it are listed beside it. Both come from the newsletter archive, so nothing here goes stale.',
    switches: [
      { key: 'signup', label: 'Offer the email sign-up', def: true,
        note: 'A second, quieter button beside the first, for somebody who would rather it arrived than remember to come back.' },
    ],
  },
};

// Which block types offer the Alignment chips is a def-level flag,
// `align: true`, same idiom as `richBody`/`photo`/`url` — one source of truth,
// not a second list to keep in step.
//
// ⚠ EVERY type has it now except Spacer, and that is a deliberate reversal.
// It used to be ten, and the reasoning written here for excluding the rest was
// that "centering a grid's cells and centering the grid itself are different
// problems, each needing its own bespoke CSS". That is true, and it is not a
// reason to withhold the control — it is a description of what the CSS below
// has to do. Dinger asked for left/center/right on "all blocks… and that
// should work for buttons too" while looking at a Button bar, which was one of
// the excluded ones: a lone button sitting hard left with no way to move it.
// Spacer is the one genuine exclusion — it has no content to align.
//
// ⚠ Hero was believed "already centered by design" and left off this list —
// wrong. `.tlcb-hero{text-align:center}` only ever centered inline text
// *inside* each already-left-positioned box; `.tlcb-band-text`'s own
// `align-items:flex-start` (shared with every banner-shaped block) is what
// actually decides whether the eyebrow/title/subtitle sit centered or
// hugging the left edge, and nothing overrode it for Hero the way Callout's
// own `.tlcb--center.tlcb--callout .tlcb-band-text{align-items:center}`
// does. So Hero was rendering left in practice the whole time, and joining
// this shared mechanism changes nothing for a page that has never touched
// its Alignment chip — 'left' was already the truth on screen, not a new
// default being imposed.
export const ALIGNABLE_TYPES = new Set(
  Object.keys(BLOCK_DEFS).filter((k) => BLOCK_DEFS[k].align)
);

// ⚠ AN EXCLUSION LIST, NOT A PER-TYPE FLAG — deliberately unlike ALIGNABLE_TYPES
// above. Alignment is a real question per type (centering a grid's cells and
// centering the grid itself are different problems). "Can this block be set
// apart from the page behind it" is not: anything that paints a surface can,
// so the interesting information is the four that cannot, and writing those
// four down beats writing `shadow: true` thirty-six times and missing one.
//
// Spacer has no surface — a shadow on a deliberate gap is a line across the
// page nobody asked for. The three banner types run edge to edge in whole-page
// mode, and a shadow around a full-bleed field draws a box around the browser
// window.
const NO_SHADOW = new Set(['spacer', 'hero', 'photobanner', 'slideshow']);
export const SHADOWABLE_TYPES = new Set(
  Object.keys(BLOCK_DEFS).filter((k) => !NO_SHADOW.has(k))
);

// Shading paints the block's own field, so the only type it means nothing to is
// the one with no field to paint. ⚠ Unlike shadow this does NOT exclude the
// banners — a wash across a tall full-bleed band is exactly where it earns its
// place, and the three authored gradients already prove the idea there.
const NO_SHADE = new Set(['spacer']);
export const SHADEABLE_TYPES = new Set(
  Object.keys(BLOCK_DEFS).filter((k) => !NO_SHADE.has(k))
);

// ⚠ The banners are excluded from Appear, and that is not a taste call: the
// first thing on a page fading in is a page that looks like it failed to load.
// Spacer has nothing to animate.
const NO_APPEAR = new Set(['spacer', 'hero', 'photobanner', 'slideshow']);
export const APPEARABLE_TYPES = new Set(
  Object.keys(BLOCK_DEFS).filter((k) => !NO_APPEAR.has(k))
);

// ⚠ A POSITIVE LIST, unlike the three above, because most types render no
// button at all and offering a button color on them would be a control that
// visibly does nothing. Derived from what the renderer actually emits — the
// test walks every type, renders it, and asserts this set is exactly the set
// whose markup contains a .tlcb-btn, so adding a button to a type without
// adding it here fails rather than shipping a dead control.
// ⚠ Not 'form' — its button markup is now editor-only (see the render branch
// below), so it never reaches the public page and needs no public-facing
// Button color control.
export const BTN_TYPES = new Set(['slideshow', 'download', 'documents', 'buttons', 'newsletter', 'cta', 'signup', 'letter', 'portal', 'give']);

// The design's own four groups, in its order. Structure leads because that is
// what somebody reaches for first on an empty page — the banner and the shape
// of it — and Content is what they fill it with afterwards.
export const GROUPS = [
  { name: 'Structure', types: ['alert', 'photobanner', 'hero', 'slideshow', 'highlight', 'cta', 'quicklinks', 'cardgrid', 'buttons', 'callout', 'partners', 'jumplinks', 'spacer'] },
  { name: 'Content',   types: ['text', 'textphoto', 'quote', 'values', 'video', 'columns', 'gallery', 'faq', 'lessons', 'sermon', 'sermonlist', 'classes', 'news', 'newsfeed', 'staff', 'posts'] },
  // Contact sits beside Map & address, which is where somebody looking for
  // "how do people reach us" already goes — the two answer the same question
  // and one of them draws a map.
  { name: 'Dates',     types: ['servicetimes', 'tiles', 'chips', 'countdown', 'map', 'contact', 'events', 'times', 'download', 'documents', 'calendar', 'embed'] },
  // `giving` and `amounts` join the group that already holds `give` rather
  // than starting a fifth. They belong to one page, and a group of two that
  // only ever appears on the giving page would read on every other page as a
  // section of the library that is broken.
  { name: 'Sign up',   types: ['form', 'signup', 'newsletter', 'letter', 'newsletterarchive', 'portal', 'give', 'giving', 'amounts', 'marketapp', 'marketfacts', 'registration'] },
];

export const BLOCK_TYPE_KEYS = Object.keys(BLOCK_DEFS);

// ── PAGE LAYOUTS ─────────────────────────────────────────────────────────────
// The template owns the wrapper around the blocks and nothing else. Switching
// template must never drop a block, which is why nothing here inspects or
// rewrites the block list — it only decides what goes around it.

export const TEMPLATES = [
  { key: 'home',     label: 'Home',           hint: 'Full-width banner, no sidebar. The homepage only.' },
  { key: 'standard', label: 'Standard page',  hint: 'Banner, then your blocks in one column. Right for most pages.' },
  { key: 'section',  label: 'Section landing', hint: 'Banner plus an automatic list of the pages beneath this one.' },
  { key: 'sidebar',  label: 'With sidebar',   hint: 'Blocks on the left; service times and contact details on the right.' },
  // ⚠ THE PER-PAGE SWITCH IS THE LAYOUT ITSELF. Dinger wants the pages beneath
  // a section listed in a callout beside the content — "and can be automatic if
  // the subpage view is turned on for that group, not every one might need it".
  // A page-level flag would have meant a column, a control on the Page tab and
  // a second thing to keep in step with the layout it only makes sense
  // alongside; choosing this layout IS turning it on for that page, and
  // choosing another is turning it off.
  { key: 'sectionside', label: 'Section with sidebar',
    hint: 'Banner, then blocks on the left with the pages beneath this one listed beside them, above the church details.' },
];

export const templateOf = (key) => TEMPLATES.find((t) => t.key === key) || TEMPLATES[1];

// ── ESCAPING / SANITIZING ────────────────────────────────────────────────────

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

// ── EMBEDDING SOMEBODY ELSE'S PAGE ──────────────────────────────────────────
// An iframe has no same-origin restriction of its own — accepting an
// arbitrary address here would let a page editor put literally any site
// inside timothystl.org, phishing page included. So this is an allowlist of
// the handful of services the office actually has reason to paste in, not a
// general embed-anything box.
export const EMBED_HOSTS = [
  'docs.google.com', 'forms.gle', 'drive.google.com', 'calendar.google.com',
  'tithe.ly', 'squareup.com', 'open.spotify.com', 'podcasts.apple.com',
  'connect.timothystl.org', 'serve.timothystl.org', 'mdo.timothystl.org',
];

// Takes either a bare address or a pasted <iframe ...> snippet — the shape
// most of these services actually hand somebody to copy — and returns a safe
// src to embed, or '' if it is not one of the hosts above. Shared by the
// Embed block and the Calendar block's own non-calendar-address fallback, so
// there is one gate for what may go in an iframe, not two that could come to
// disagree about it.
//
// ⚠ THE HOST CHECK NEEDS A REAL PARSED URL, NOT A REGEX ON THE STRING. A
// regex anchored on "starts with https://docs.google.com" is exactly the
// shape of check a crafted address like "https://docs.google.com.evil.com/"
// or "https://evil.com/?=docs.google.com" walks straight through. `new URL()`
// is what actually answers "what host does a browser send this request to."
export function allowedEmbedSrc(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const tagMatch = raw.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  const candidate = tagMatch ? tagMatch[1] : raw;
  const safe = safeUrl(candidate);
  if (!safe) return '';
  let host;
  try { host = new URL(safe).hostname.toLowerCase(); } catch (_) { return ''; }
  return EMBED_HOSTS.includes(host) ? safe : '';
}

const RICH_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'a', 'h2', 'h3', 'h4', 'blockquote', 'span', 'div', 'img', 'hr', 'sup', 'sub']);
// `rel` is deliberately NOT allowed through: it is re-added below, once. Letting
// the incoming one survive as well made every sanitize pass append another copy.
const RICH_ATTRS = { a: ['href', 'target'], img: ['src', 'alt', 'width', 'height'], p: ['class'] };
const RICH_VOID = new Set(['br', 'img', 'hr']);

// ⚠ AN ALLOWLIST OF CLASS VALUES, NOT JUST OF THE ATTRIBUTE. `class` is the
// one attribute here that names a rule in our own stylesheet, so letting an
// arbitrary value through would let saved content borrow any class on the
// site — a banner's veil, a card's shadow, the giving widget's chrome — and
// apply it to a paragraph. `style` is not allowed at all and must not be: a
// free style attribute is arbitrary CSS injected into a page that other staff
// open inside their own authenticated session, which is what AW-2 is about.
//
// A class that is not on this list is dropped and the element is kept, so
// pasting from somewhere else loses the styling rather than the words.
const RICH_CLASSES = new Set(['tlcb-lead']);

// ── THE CARD'S OWN, NARROWER ALLOWLIST (Task 13b) ────────────────────────────
// Free text is the deliberate exception among the five card kinds — the other
// four never go stale because they read the church details. So it gets a real
// rich field rather than a bold line and a small line, but NOT the page's one:
// the card is a small box against a banner, and a heading, an image or a list
// breaks its shape. Bold, italic, links and line breaks, and nothing else.
//
// It is a separate SET rather than a flag on sanitizeRich, so widening the page
// editor's allowlist later cannot quietly widen this one too.
const CARD_RICH_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'a']);
export function sanitizeCardRich(input) {
  const full = sanitizeRich(input);
  return full.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, tag) =>
    (CARD_RICH_TAGS.has(tag.toLowerCase()) ? m : '')).slice(0, 1200);
}
// ── A SENTENCE'S OWN, NARROWER ALLOWLIST ─────────────────────────────────────
// A banner subtitle is one line under a title. It wants emphasis and the
// occasional link; it does not want a heading, a list or a rule, any of which
// would put a second block's worth of structure inside a banner. Same shape as
// CARD_RICH_TAGS above and for the same reason: widening the page editor's
// allowlist later must not quietly widen this one too.
//
// ⚠ The toolbar offered on these fields is narrowed to match — see
// openRichField() in admin/ministry-editor.html. A control that appears and is
// then silently dropped on save is worse than one that was never offered.
const LINE_RICH_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'sup', 'sub']);
export function sanitizeLineRich(input) {
  const full = sanitizeRich(input);
  return full.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, tag) =>
    (LINE_RICH_TAGS.has(tag.toLowerCase()) ? m : '')).slice(0, 1200);
}

const RICH_DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[\s\S]*?(<\/\1\s*>|$)/gi;

// TinyMCE output is user input. Only staff can reach the editor, but a stored
// XSS here would run in another staff member's authenticated admin session —
// the cross-privilege escalation path called out in the July 2026 review.
//
// ── ONE ENGINE, TWO PROFILES (FX-04) ─────────────────────────────────────────
// The loop below used to BE sanitizeRich. It is parameterized now because the
// classic admin forms (the newsletter's notes, a news body, a sermon note)
// needed sanitizing too and could not take this exact allowlist — see
// CLASSIC_PROFILE below for why. Copying the loop instead would have been two
// implementations of the one thing in this codebase that must not have two.
//
// A profile is { tags, attrs, voids, classes, styles }. `styles` absent means
// the `style` attribute is not allowed at all, which is what every profile but
// the classic one wants.
function sanitizeProfile(input, profile) {
  if (!input) return '';
  let s = String(input).slice(0, 40000);
  s = s.replace(RICH_DROP_WITH_CONTENT, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!profile.tags.has(t)) return '';
    if (match.startsWith('</')) return profile.voids.has(t) ? '' : '</' + t + '>';
    const allowed = profile.attrs[t] || [];
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
      // Every class on the element has to be one we recognize. A single
      // unknown one drops the whole attribute rather than being filtered out
      // of it — the words survive either way, and a half-honored class list is
      // harder to reason about than none.
      if (name === 'class') {
        const cls = val.split(/\s+/).filter(Boolean);
        if (!cls.length || !cls.every((c) => profile.classes.has(c))) continue;
        val = cls.join(' ');
      }
      if (name === 'style') {
        val = safeStyle(val, profile.styles);
        if (!val) continue;
      }
      if ((name === 'width' || name === 'height') && !/^\d{1,4}$/.test(val)) continue;
      if (name === 'colspan' || name === 'rowspan') {
        if (!/^\d{1,3}$/.test(val)) continue;
      }
      if (name === 'target') val = '_blank';
      out += ' ' + name + '="' + esc(val) + '"';
    }
    if (t === 'a' && / href=/.test(out)) out += ' rel="noopener noreferrer"';
    return '<' + t + out + '>';
  });
  return s;
}

const RICH_PROFILE = { tags: RICH_TAGS, attrs: RICH_ATTRS, voids: RICH_VOID, classes: RICH_CLASSES, styles: null };

export function sanitizeRich(input) {
  return sanitizeProfile(input, RICH_PROFILE);
}

// ── A CONSTRAINED `style`, WHICH IS NOT THE SAME AS ALLOWING ONE ─────────────
// The note on RICH_CLASSES above says a free style attribute must never be
// allowed, and that still holds: it is arbitrary CSS running in another admin's
// authenticated session. But the classic editor WRITES styles itself — its own
// NodeChange handler puts `margin:8px;max-width:100%;height:auto` on every
// image it touches — so dropping the attribute wholesale would visibly break
// every picture in the newsletter archive.
//
// So the property is allowlisted AND the value is character-restricted:
//   · a declaration whose property is not on the list is dropped
//   · parentheses are rejected outright, which is what kills url(...) and the
//     old expression(...) — there is no safe value in these properties that
//     needs one
//   · quotes, backslashes, angle brackets, @ and & cannot appear either
// Anything unrecognized drops that declaration and keeps the rest, so a paste
// from Word loses its font soup and keeps its alignment.
const STYLE_VALUE_RE = /^[a-zA-Z0-9 .,%#/-]+$/;
export function safeStyle(value, allowedProps) {
  if (!allowedProps || !allowedProps.size) return '';
  const out = [];
  for (const decl of String(value || '').slice(0, 600).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!allowedProps.has(prop)) continue;
    if (!val || val.length > 80 || !STYLE_VALUE_RE.test(val)) continue;
    out.push(prop + ':' + val);
  }
  return out.join(';');
}

// ── THE CLASSIC ADMIN FORMS' PROFILE (FX-04) ────────────────────────────────
// The newsletter's notes, a news body, a sermon note, a youth page and a
// ministry post are all edited by the CLASSIC TinyMCE (admin/helpers.js), whose
// toolbar is `blocks | bold italic underline | align* | bullist numlist |
// link image | table | code`. Every one of those has to survive the round trip
// or sanitizing silently eats real, already-published content.
//
// ⚠ THIS IS WIDER THAN sanitizeRich AND THAT IS THE WHOLE POINT — but it is a
// SEPARATE SET, exactly like sanitizeCardRich and sanitizeLineRich are narrower
// separate sets. Widening one must never quietly widen another. In particular
// the page editor must NOT gain tables or `style` by being handed this profile.
//
// What the block editor's list lacks and this needs:
//   · the table family — the classic toolbar has a `table` button
//   · h1/h5/h6/pre — TinyMCE's `blocks` dropdown offers all six headings
//   · `style`, constrained by safeStyle above — alignment, and the image
//     margins the editor writes itself
const CLASSIC_TAGS = new Set([...RICH_TAGS, 'h1', 'h5', 'h6', 'pre', 'code',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col']);
const CLASSIC_STYLES = new Set(['text-align', 'margin', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding', 'width', 'height', 'max-width', 'min-width',
  'border', 'border-collapse', 'vertical-align', 'float']);
const CLASSIC_ATTRS = (() => {
  const styled = ['style'];
  const a = {
    a: ['href', 'target'],
    img: ['src', 'alt', 'width', 'height', 'style'],
    td: ['colspan', 'rowspan', 'style'],
    th: ['colspan', 'rowspan', 'scope', 'style'],
    table: ['style', 'border'],
    col: ['span', 'style'],
    colgroup: ['span', 'style'],
    p: ['class', 'style'],
  };
  for (const t of ['div', 'span', 'li', 'ul', 'ol', 'tr', 'thead', 'tbody', 'tfoot',
    'caption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']) a[t] = styled;
  return a;
})();
const CLASSIC_VOID = new Set([...RICH_VOID, 'col']);
const CLASSIC_PROFILE = {
  tags: CLASSIC_TAGS, attrs: CLASSIC_ATTRS, voids: CLASSIC_VOID,
  classes: RICH_CLASSES, styles: CLASSIC_STYLES,
};

// The one to call on a classic admin form's rich field, on the way IN.
export function sanitizeClassicRich(input) {
  return sanitizeProfile(input, CLASSIC_PROFILE);
}

export const cleanText = (s, max = 200) => String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);

// A block's optional jump-to name — becomes the `id` a same-page link can
// target with `#name`. Lowercased and collapsed to letters/digits/hyphens,
// the same shape slugify() gives a page address, so what somebody types is
// what they type into a button's link field: no separate display form to
// keep in sync, because the sanitized value IS what is shown back to them
// after the inspector's own re-render round-trip.
// A block's own DOM id, decided in ONE place so the markup, the Jump links
// block's hrefs and the inspector's own note cannot come to disagree about
// what a fragment has to say.
//
// ⚠ A typed jump-to name is used BARE. It was prefixed at first, on real
// namespace grounds — a name is competing for the same id space as the SPA's
// `page-<id>` divs — and that shipped as a bug: the box on screen said one
// thing and the page answered to another, so a button linking to the name
// somebody was shown matched nothing. What is in the box has to BE the
// address. A block's own id is the fallback, and needs no prefix either: it
// is unique within the page by construction.
//
// ⚠ Put through the same character strip as a typed name. `cleanText` allows
// spaces and punctuation, so a hand-written seed id could otherwise reach an
// id attribute as something no fragment could ever target.
export function blockDomId(b) {
  if (!b) return '';
  if (b.anchorId) return String(b.anchorId);
  return cleanAnchorId(b.id);
}

export const cleanAnchorId = (s) => String(s == null ? '' : s).toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

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
    subtitle: d.subtitle || '',
    eyebrow: d.eyebrow || '',
    body: d.body || '',
    url: d.url || '',
    spaceAbove: d.spaceAbove == null ? 24 : d.spaceAbove,
    spaceBelow: d.spaceBelow == null ? 24 : d.spaceBelow,
    gap: 32,
    height: d.height == null ? 48 : d.height,
    split: '40',
    side: 'left',
    cols: d.cols || 2,
    count: d.count || 3,
    locked: false,
    // ⚠ Read from the type's own defaults rather than hardcoded to 0. The
    // redesign's four types are each born on a particular surface — a photo
    // banner on ink navy, a quote on paper — and a new one landing on
    // Parchment would have to be recolored by hand every time.
    bg: d.bg == null ? 0 : d.bg,
    ink: d.ink == null ? 0 : d.ink,
    size: 'm',
    photo: '',
    photoAlt: '',
    video: '',
    stamp: '',
    stampSize: 'm',
    stampPulse: false,
    tone: 0,
    corner: 'tr',
    hidden: false,
    source: def.partnerSource ? (d.source || 'manual') : undefined,
    partnerIds: [],
    ...(def.bigLine ? { big: d.big || '' } : {}),
    items: def.items ? JSON.parse(JSON.stringify(def.defaultItems || [])) : [],
    links: def.links ? JSON.parse(JSON.stringify(def.defaultLinks || [])) : [],
    // The def-driven fields, from the same two arrays sanitizeBlock reads.
    ...Object.fromEntries((def.choices || []).map((c) => [c.key, d[c.key] == null ? c.def : d[c.key]])),
    ...Object.fromEntries((def.switches || []).map((sw) => [sw.key, d[sw.key] == null ? !!sw.def : !!d[sw.key]])),
  }, over));
}

// Never trust the client. Client-side clamping is a courtesy; this is the
// control. A stale tab must not be able to write spaceAbove:900 or a hex color.
export function sanitizeBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const def = BLOCK_DEFS[b.type];
  if (!def) return null; // unknown type → dropped entirely
  const richBody = !!def.richBody;
  const out = {
    id: cleanText(b.id, 32) || makeBlockId(),
    type: b.type,
    title: cleanText(b.title, 200),
    // ⚠ A RICH SUBTITLE IS SANITIZED, NOT FLATTENED. The three banners carry a
    // sentence under the title and had no rich field at all, so selecting the
    // words offered no toolbar and there was nothing on screen to say why.
    // Everywhere else the subtitle is a label or an eyebrow and stays plain —
    // running those through the markup allowlist would let a heading into a
    // one-line label.
    subtitle: def.richSubtitle ? sanitizeLineRich(b.subtitle) : cleanText(b.subtitle, 300),
    eyebrow: cleanText(b.eyebrow, 80),
    body: richBody ? sanitizeRich(b.body) : cleanText(b.body, 600),
    // ⚠ Gated on the DEFINITION, the same way `card` is below. It used to be
    // stored for every block type whether or not that type had a URL field,
    // so a type with no link — including the two giving-page types, whose
    // entire safety argument is that there is nowhere to put a payment
    // address — would quietly keep whatever was posted at it. Nothing
    // rendered it, so nothing was broken; but "the renderer happens not to
    // read it" is a much weaker guarantee than "it was never stored", and the
    // first one is one new render branch away from failing. Every type that
    // reads b.url declares url:true (alert, download, calendar, form, give),
    // so nothing loses a link it was using.
    // ⚠ `embedGate` types (Embed, Calendar) run through the host allowlist
    // instead of plain safeUrl — an iframe has no origin restriction of its
    // own, so what may reach one is a much narrower question than what may
    // reach an href. See allowedEmbedSrc() for why.
    url: def.url ? (def.embedGate ? allowedEmbedSrc(b.url) : safeUrl(b.url)).slice(0, 600) : '',
    spaceAbove: snapSpace(b.spaceAbove),
    spaceBelow: snapSpace(b.spaceBelow),
    gap: snapSpace(b.gap == null ? 32 : b.gap),
    height: snapSpace(b.height == null ? 48 : b.height),
    split: SPLITS.some((s) => s.key === b.split) ? b.split : '40',
    side: ['left', 'right', 'above'].includes(b.side) ? b.side : 'left',
    // 2, 3 or 4 — a constrained choice, never a free number. The card grid
    // needs 4-up for /worship; `columns` only ever offers 2 or 3 in its own
    // inspector, and a crafted 4 there is a wide text row, not a broken page.
    // ⚠ 1 is legal now. A one-up news feed is a real layout (a list you work
    // through rather than a grid you scan), and `columns`/`cardgrid` rendering
    // a single wide column from a crafted value is a wide row, not a broken
    // page. Each type's own `choices` entry below narrows this to the set that
    // type actually offers.
    cols: [1, 2, 3, 4].includes(Number(b.cols)) ? Number(b.cols) : 2,
    // Left, center or right. Anything else is 'left' — an unknown alignment is
    // a stale tab or a crafted POST, and the answer to both is the default the
    // page has always had rather than a third state nothing has CSS for.
    align: b.align === 'center' || b.align === 'right' ? b.align : 'left',
    // Task 13c. Full or Half — a property of the BLOCK, never a container the
    // office drags things into. The rail is a flat list and stays one; pairing
    // is what two adjacent halves DO, not a level of nesting they live in.
    width: b.width === 'half' ? 'half' : 'full',
    topRule: !!b.topRule,
    count: Math.max(1, Math.min(6, Math.floor(Number(b.count)) || 3)),
    locked: !!b.locked,
    bg: clampIndex(b.bg, BG.length),
    ink: clampIndex(b.ink, INK.length),
    size: SIZES.some((s) => s.key === b.size) ? b.size : 'm',
    photo: safeUrl(b.photo).slice(0, 600),
    photoAlt: cleanText(b.photoAlt, 200),
    video: safeUrl(b.video).slice(0, 600),
    stamp: cleanText(b.stamp, 40),
    stampSize: STAMP_SIZES.some((s) => s.key === b.stampSize) ? b.stampSize : 'm',
    stampPulse: !!b.stampPulse,
    tone: clampIndex(b.tone, TONES.length),
    // ⚠ A third position, beyond the two corners. 'bc' sits centered along
    // the block's lower edge — still tilted, just not squeezed into a corner,
    // which is what makes a bigger stamp actually readable rather than
    // hanging off the edge of the block.
    corner: b.corner === 'tl' || b.corner === 'bc' ? b.corner : 'tr',
    hidden: !!b.hidden,
    // On every block, like width/spaceAbove above — not gated on the type,
    // because any block can be a jump target and the sanitizer is the one
    // place that turns whatever was typed into a safe DOM id.
    anchorId: cleanAnchorId(b.anchorId),
    items: [],
    links: [],
  };
  // ── THE DEF-DRIVEN FIELDS ──────────────────────────────────────────────
  // `choices` and `switches` are declared on the type, beside its label and
  // its defaults, and read here and by the inspector from the same two arrays.
  // That is the whole reason they exist rather than another dozen lines above
  // and another dozen if-branches in the editor: a field cannot appear on the
  // screen without being guarded on the way in, because the same declaration
  // produces both.
  //
  // ⚠ AFTER the base fields, deliberately. `cols` is sanitized above against
  // every value any type may use, and a type offering only 1 or 2 has to be
  // able to narrow that — otherwise a crafted 4 survives on a block whose
  // renderer has no four-column layout.
  //
  // An unknown value takes the declared default rather than the first option,
  // because for a banner height and a shading level the sensible default is
  // the middle one, not the smallest.
  for (const c of (def.choices || [])) {
    const hit = c.options.find((o) => String(o.key) === String(b[c.key]));
    out[c.key] = hit ? hit.key : c.def;
  }
  // A switch stores what it means, not what was posted: `def` decides which
  // way an ABSENT value falls, so a switch that is on by default stays on for
  // every block saved before it existed.
  for (const sw of (def.switches || [])) {
    out[sw.key] = b[sw.key] == null ? !!sw.def : !!b[sw.key] && b[sw.key] !== '0' && b[sw.key] !== 'false';
  }

  // Color guardrail, enforced server-side too: an ink that is unreadable on
  // the chosen background snaps back to a readable one.
  if (INK[out.ink].onDark !== BG[out.bg].dark) out.ink = BG[out.bg].dark ? 3 : 0;

  // The info card. Off unless the block is one of the three that can carry it,
  // so a stale tab cannot switch one on for a block with nowhere to put it —
  // and so a block type losing the slot loses its cards rather than rendering
  // them somewhere unintended.
  out.card = def.infoCard && CARD_SIDES.some((s) => s.key === b.card) ? b.card : 'off';
  out.cardShows = CARD_SHOWS.some((s) => s.key === b.cardShows) ? b.cardShows : 'services';
  out.cardEyebrow = cleanText(b.cardEyebrow, 60);
  out.cardBody = sanitizeCardRich(b.cardBody);
  out.cardLinks = Array.isArray(b.cardLinks)
    ? b.cardLinks.slice(0, 4).map((raw) => ({
      title: cleanText(raw && raw.title, 60),
      url: safeUrl(raw && raw.url).slice(0, 600),
    }))
    : [];

  // Where a Partner logos block gets its logos. Gated on the definition, the
  // same way `url` and `card` are — a type with no source choice cannot be
  // given one by a stale tab or a crafted POST.
  //
  // ⚠ 'manual' IS THE FALLBACK, and that is what leaves every existing block
  // alone. A block saved before this existed carries no `source` and a list of
  // typed items; reading that as 'record' would replace somebody's hand-built
  // logo row with the four partner ministries the moment this deployed. The
  // new-block default lives in `defaults`, where it only ever reaches a block
  // somebody is creating now.
  //
  // Both keys are set ONLY on a type that has the choice, rather than on every
  // block the way `card` is. A type with no source has no `source` field at
  // all — and, incidentally, that is what keeps this change out of the
  // generated page seeds for the twenty-odd types it means nothing to.
  // ⚠ Set ONLY on a type that has it, the same way `source` is below, rather
  // than on every block the way `card` is. A key added to all 36 types is a key
  // added to all 25 generated page seeds, for a field 35 of them can never
  // render. Short on purpose too: it is a number or a time set at 56px, and a
  // sentence at that size is not a display line, it is a broken page.
  if (def.bigLine) out.big = cleanText(b.big, 24);

  // ⚠ AN OVERRIDE, AND BLANK IS THE NORMAL CASE. Dinger: every contact button
  // on the site goes to office@timothystl.org, and some of them should go to a
  // person. So the block may carry an address of its own — but it defaults to
  // empty, and empty means "read the church-details record", which keeps the
  // change-it-once-everywhere-follows behavior that record exists for.
  //
  // The cost is real and worth stating: an address typed here is a second copy,
  // and it will not follow when the office's own address changes. That is the
  // trade somebody makes by filling the field in, which is why it is a field
  // somebody has to fill in rather than a value pre-loaded from the record.
  // The fund a Give button lands on, by id. ⚠ Stored ONLY when set, like
  // `shadow` above — putting a 0 on every give block would add the key to the
  // generated seeds for a default that means "no fund chosen".
  if (def.giveFund) {
    const id = Math.floor(Number(b.giveFund));
    if (Number.isFinite(id) && id > 0) out.giveFund = id;
  }

  // Which News & Events post a countdown targets, by id — the identical
  // shape `giveFund` is for `give_funds`. Stored only when set; blank is the
  // common case and means "the next upcoming one", so it must not land in
  // every generated seed as a value that means nothing.
  if (def.newsRef) {
    const id = Math.floor(Number(b.newsId));
    if (Number.isFinite(id) && id > 0) out.newsId = id;
  }

  // Which event a `registration` block belongs to — an ID reference into
  // `site_events`, the identical shape `giveFund` above is for
  // `give_funds`. Never a URL: safeUrl() never sees it, and there is no
  // itemUrlFields/url declaration for this type at all.
  if (def.eventRef) {
    out.eventId = cleanText(b.eventId, 60);
  }

  if (def.contactEmail) {
    const raw = cleanText(b.contactEmail, 120).trim();
    // A plain address, not a URL. `mailto:` is built at render time, so a
    // crafted `javascript:` never reaches an href — there is nowhere to put a
    // scheme even deliberately.
    // ⚠ The colon and the slash are excluded on purpose. Without them
    // `mailto:x@y.z` passes, and the render would then emit
    // `mailto:mailto:x@y.z` — a link that silently opens nothing. A bare
    // address contains neither character.
    out.contactEmail = /^[^\s@<>"':/\\]+@[^\s@<>"':/\\]+\.[^\s@<>"':/\\]+$/.test(raw) ? raw : '';
  }

  // Blank means "read the computed default" — the same rule contactEmail
  // follows above, for the same reason: the common case (an actual gift)
  // needs nobody to type anything, and only the exception (a fee, a deposit,
  // a registration) has to fill the field in.
  if (def.buttonText) out.buttonText = cleanText(b.buttonText, 60).trim();

  // ⚠ STORED ONLY WHEN IT IS NOT THE DEFAULT, unlike `align` which every block
  // carries. Putting `shadow:'none'` in the base object adds the key to all 25
  // generated page seeds — the exact trap recorded above `big` — and the seed
  // suite says so immediately, because it asserts each seed is already
  // sanitized. Absent means 'none', which is what every page renders today, so
  // nothing on the site moves and nothing needs regenerating.
  if (SHADOWABLE_TYPES.has(out.type)) {
    const sh = SHADOW_KEYS.includes(b.shadow) ? b.shadow : 'none';
    if (sh !== 'none') out.shadow = sh;
  }

  // All three follow the shadow rule above: stored only when it is not the
  // default, so none of them lands in the 25 generated page seeds and no
  // existing page changes by a pixel until somebody picks something.
  if (SHADEABLE_TYPES.has(out.type)) {
    const sd = SHADE_KEYS.includes(b.shade) ? b.shade : 'none';
    if (sd !== 'none') out.shade = sd;
  }
  if (APPEARABLE_TYPES.has(out.type)) {
    const ap = APPEAR_KEYS.includes(b.appear) ? b.appear : 'none';
    if (ap !== 'none') out.appear = ap;
  }
  if (BTN_TYPES.has(out.type)) {
    const bt = BTN_KEYS.includes(b.btn) ? b.btn : 'default';
    if (bt !== 'default') out.btn = bt;
  }

  if (def.partnerSource) {
    out.source = b.source === 'record' ? 'record' : 'manual';
  // Which partners, by id. Empty means all of them — so a partner added later
  // appears without anybody editing the page, which is the point of reading the
  // record at all. A chosen subset is a deliberate act and is kept as one.
    out.partnerIds = Array.isArray(b.partnerIds)
      ? [...new Set(b.partnerIds.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0))].slice(0, 24)
      : [];
  }

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
  if (def.links && Array.isArray(b.links)) {
    out.links = b.links.slice(0, 4).map((raw) => ({
      title: cleanText(raw && raw.title, 60),
      url: safeUrl(raw && raw.url).slice(0, 600),
    }));
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
    // title stays empty: the legacy content already carries its own headings,
    // and a block default like "A heading" would appear as real page copy.
    push('textphoto', { title: '', body: content, photo: row.ministry_image_url, photoAlt: row.title || '', side: 'right', split: '40' });
  } else if (content) {
    push('text', { body: content });
  } else if (row.ministry_image_url) {
    push('textphoto', { title: '', body: '', photo: row.ministry_image_url, photoAlt: row.title || '', side: 'above' });
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
// ── STARTERS ─────────────────────────────────────────────────────────────────
// "New page" offers a working set of blocks rather than an empty canvas. An
// empty page is the hardest thing to start from, and the office's first
// question is always "what goes on it?" — a starter answers that with a page
// they can edit down rather than a blank one they have to build up.
//
// Every starter lands in the DRAFT. A new page always begins as a draft, so
// nothing here can reach the site until somebody presses Publish.
export const STARTERS = [
  {
    key: 'ministry', label: 'Ministry page', note: 'A banner, a paragraph, and a way to get in touch.',
    build: (title) => [
      newBlock('hero', { title: title || 'Ministry name', eyebrow: 'Ministry' }),
      newBlock('text', { body: '<p>Tell people what this ministry is and who it is for.</p>' }),
      newBlock('buttons', { items: [{ title: 'Contact the office', url: 'mailto:office@timothystl.org' }] }),
    ],
  },
  {
    key: 'text', label: 'Simple text page', note: 'A heading and some words. Nothing else to fill in.',
    build: (title) => [
      newBlock('hero', { title: title || 'Page title', eyebrow: '' }),
      newBlock('text', { body: '<p>Write here the way you would speak to a visitor — plainly, and without church shorthand.</p>' }),
    ],
  },
  {
    key: 'home', label: 'Homepage', note: 'A welcome banner with a service-times card, then what is happening.',
    build: (title) => [
      newBlock('slideshow', { title: title || 'A congregation on Fyler since 1889', card: 'right', cardShows: 'services', cardEyebrow: 'Join us Sunday' }),
      newBlock('quicklinks'),
      newBlock('news'),
      newBlock('sermon'),
      newBlock('map'),
    ],
  },
  {
    key: 'signup', label: 'Sign-up page', note: 'A banner, what people are signing up for, and the form.',
    build: (title) => [
      newBlock('hero', { title: title || 'Sign up', eyebrow: '' }),
      newBlock('text', { body: '<p>What this is, who it is for, and when it happens.</p>' }),
      newBlock('form'),
    ],
  },
];

export const starterOf = (key) => STARTERS.find((s) => s.key === key) || STARTERS[0];

// Ministry pages keep the ministry starter, which is what this used to be —
// the signature is unchanged so every existing caller behaves as before.
export function starterBlocks(title, key = 'ministry') {
  return sanitizeBlocks(starterOf(key).build(title));
}

// ── STYLESHEET ───────────────────────────────────────────────────────────────
// Shipped once per page (renderPage prepends it). Class-prefixed `tlcb-` so it
// cannot collide with the public site's own stylesheet or the admin shell.

// ── FX-17: THE BYTES, SEPARATE FROM THE TAG THAT CARRIES THEM ───────────────
// This stylesheet is 85KB, and it used to travel inline on every published page
// TWICE — once injected into the document at the edge (into HTML served
// `no-cache`, so never reusable) and again inside the /api/pages JSON, because
// the client fetches that payload regardless for the nav and the footer.
//
// The admin's own ~89KB went to /assets/admin.css, `immutable`, cache-busted by
// ?v=VERSION, back in 2026-08-03. This is the same move for the public site:
// BLOCK_CSS_RAW is served at /assets/blocks.css and /api/pages ships a <link>
// pointing at it instead of the bytes.
//
// ⚠ BLOCK_CSS (the inline <style>) IS STILL WHAT renderPage EMITS. The editor
// canvas renders through the same function and is a different situation — it is
// behind a session, on the admin origin, and re-renders constantly while
// somebody arranges a page. Changing that too is worth doing and is not this
// change; a <link> there needs the canvas's own load ordering thought about.
export const BLOCK_CSS_RAW = `
/* Whole-page mode: the blocks are the page, so each one is centered at the
   site's own content width while the banner runs edge to edge. */
.tlcb-page--full{--tlcb-wrap:1100px;}
/* Backgrounds run edge to edge like the site's own sections, while the content
   inside stays centered at the site's content width. */
.tlcb-page--full > .tlcb{max-width:none;border-radius:0;margin:0;
  padding-top:calc(14px + var(--tlcb-space-above,0px));
  padding-bottom:calc(14px + var(--tlcb-space-below,0px));
  padding-left:max(var(--tlcb-pad), calc((100% - var(--tlcb-wrap)) / 2));
  padding-right:max(var(--tlcb-pad), calc((100% - var(--tlcb-wrap)) / 2));}
.tlcb-page--full > .tlcb--hero{padding:0;}
/* ⚠ THE HERO WAS THE ONE BANNER WHOSE WORDS DID NOT LINE UP WITH THE PAGE.
   The rule above zeroes the block's padding so the colored field runs edge to
   edge — right — but nothing then put the CONTENT back on the content column,
   so the title sat 28px from the viewport edge (the hero's own padding) while
   every heading below it started at (100% - 1100px)/2. On a wide screen that
   is the title hard against the glass and the page beginning a couple of
   hundred pixels to its right.
   Photo banner never had this: it is not excluded above, so it inherits the
   same inset every other block gets. This gives the hero the identical
   expression rather than a nudge, so the two cannot drift apart. */
.tlcb-page--full > .tlcb--hero .tlcb-hero{border-radius:0;
  padding-left:max(var(--tlcb-pad), calc((100% - var(--tlcb-wrap)) / 2));
  padding-right:max(var(--tlcb-pad), calc((100% - var(--tlcb-wrap)) / 2));}
/* A half run's WRAPPER needs the same centering — pair members are
   grandchildren, so the > .tlcb rule above never reaches them, and a run of
   halves on a hero-led page sat hard against the viewport edge while every
   full-width block around it was centered. The math goes on the wrapper and
   only the wrapper: inside a half column, (100% - wrap)/2 means nothing. */
.tlcb-page--full > .tlcb-pair{
  padding-left:max(var(--tlcb-pad), calc((100% - var(--tlcb-wrap)) / 2));
  padding-right:max(var(--tlcb-pad), calc((100% - var(--tlcb-wrap)) / 2));}
/* ⚠ These were USED in seven rules and DEFINED nowhere, so those rules fell
   back to the browser's default font — the card-grid headings, eyebrow, link
   and intro, and the map card's three text rules, on every public page that
   carries one of those blocks. Nothing errored and nothing looked obviously
   broken, which is why it survived. Defined here, on the wrapper every render
   path emits, so there is one place they come from.

   ── AND THEY NOW FOLLOW THE SITE'S TYPEFACE SETTING ───────────────────────
   Each one defers to the property applyAppearance() re-points from the
   published Appearance record, falling back to the classic pair. So a block
   is set in whatever the site is set in, with nothing to keep in step and no
   per-block font control — which is exactly what "one look" has to mean: the
   alternative is a page whose banner and whose paragraphs disagree.

   ⚠ The fallbacks are the CLASSIC pair, not the redesign, and that is not an
   oversight. This stylesheet also renders inside the editor canvas and inside
   /api/ministry/:slug, where public/styles.css is not present — the fallback
   is what shows when nobody has defined the property at all. It is the more
   conservative of the two, and the editor sets the real value explicitly so
   the canvas never has to rely on it.

   ⚠ --tlcb-ui is a THIRD role, not a synonym for --tlcb-sans. In the redesign
   the reading face is a serif and the buttons, eyebrows and small-caps meta
   are not; collapsing the two puts a serif on every button on the site. */
.tlcb-page{--tlcb-pad:24px;
  --tlcb-serif:var(--font-heading,Lora,Georgia,serif);
  --tlcb-sans:var(--font-body,'Source Sans 3',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif);
  --tlcb-ui:var(--font-ui,'Source Sans 3',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif);
  font-family:var(--tlcb-sans);}
.tlcb{position:relative;border-radius:10px;background:var(--tlcb-bg,#FBF8F3);color:var(--tlcb-ink,#3A3A4A);
  padding:14px var(--tlcb-pad);border:2px solid transparent;
  margin-top:var(--tlcb-space-above,0px);margin-bottom:var(--tlcb-space-below,0px);
  /* On every block, not just ones with a jump-to name — the nav is 64px plus
     its 3px rule on every page, and a fragment jump has to clear it whichever
     block ends up on the receiving end. */
  scroll-margin-top:88px;}
/* Two consecutive Halves make one row, left then right, in the order they
   were dropped — a THIRD starts a new row rather than joining a three-up.

   ⚠ A GRID, NOT CSS COLUMNS. This used to be column-count:2, which reads the
   whole run into two balanced columns instead of left-to-right rows — so a
   run of four halves went top-to-bottom in the left track before starting
   the right one, not across. Andrew asked for reading order instead, plus a
   way to make two blocks in a row line up — align-items:stretch does both:
   grid cells are placed row-major (left, right, left, right...) and each
   block's box stretches to the row's own height, so a short block beside a
   tall one still ends flush with it rather than leaving a gap under itself.
   That was the original reason columns replaced a grid here (a 450px map
   beside a 150px news list, 300px of nothing before the next block); stretch
   fills that same gap instead of flowing content around it. */
.tlcb-pair{display:grid;grid-template-columns:1fr 1fr;column-gap:32px;align-items:stretch;
  margin-top:var(--tlcb-space-above,0px);margin-bottom:var(--tlcb-space-below,0px);}
.tlcb-pair > .tlcb{margin:0;height:100%;}
.tlcb--hero{padding:0;}
.tlcb--spacer{padding:0 var(--tlcb-pad);}
.tlcb *{box-sizing:border-box;}
.tlcb-eyebrow{font:800 11.5px/1.4 var(--tlcb-ui);letter-spacing:.16em;text-transform:uppercase;
  color:var(--tlcb-eyebrow-ink,#C9973A);margin-bottom:8px;}
.tlcb-head{font-family:var(--tlcb-serif);font-weight:800;line-height:1.05;letter-spacing:-.02em;margin:0;
  font-size:var(--tlcb-head,22px);color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-prose{font-size:var(--tlcb-body,15px);font-weight:300;line-height:1.6;color:var(--tlcb-ink,#3A3A4A);text-wrap:pretty;}
.tlcb-prose h2{font-family:var(--tlcb-serif);font-weight:700;line-height:1.2;margin:0 0 16px;
  font-size:var(--tlcb-head,30px);color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-prose h3{font-family:var(--tlcb-serif);font-weight:700;line-height:1.25;margin:0 0 12px;
  font-size:calc(var(--tlcb-head,30px) * .72);color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-prose h4{font:600 calc(var(--tlcb-body,15px) * 1.15)/1.35 var(--tlcb-ui);margin:0 0 8px;
  color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-prose blockquote{margin:0 0 .8em;padding-left:16px;border-left:3px solid #C9973A;color:#4A4860;}
.tlcb-prose > :first-child{margin-top:0;}
.tlcb-prose > :last-child{margin-bottom:0;}
.tlcb-prose p{margin:0 0 .8em;}
.tlcb-prose a{color:#2E7EA6;}
.tlcb-prose ul,.tlcb-prose ol{margin:0 0 .8em;padding-left:1.3em;}
.tlcb-prose img{max-width:100%;height:auto;border-radius:8px;}
/* A lead paragraph — the opening line, set larger and a shade darker than the
   copy under it. Scales off the body size like everything else, so it follows
   the site's text-size setting rather than pinning a number. */
.tlcb-prose p.tlcb-lead{font-size:calc(var(--tlcb-body,15px) * 1.22);line-height:1.5;font-weight:400;
  color:var(--tlcb-head-ink,#1E2D4A);margin:0 0 .7em;}
/* A rule between passages. It takes the surface's own hairline, so it is
   visible on a pale field and on a dark one without a second declaration. */
.tlcb-prose hr{border:0;border-top:1px solid var(--tlcb-rule,#E7DFD1);margin:1.4em 0;}
/* Footnote marks. Without the reduced line-height a superscript pushes its own
   line taller than the ones around it, which shows up as uneven leading in a
   paragraph that has one. */
.tlcb-prose sup,.tlcb-prose sub{font-size:.72em;line-height:0;position:relative;vertical-align:baseline;}
.tlcb-prose sup{top:-.5em;}
.tlcb-prose sub{bottom:-.25em;}
.tlcb-stack{display:flex;flex-direction:column;gap:12px;}
.tlcb-grid{display:grid;grid-template-columns:var(--tlcb-cols,1fr 1fr);gap:var(--tlcb-gap,32px);align-items:center;}
.tlcb-cols{display:grid;grid-template-columns:var(--tlcb-cols,1fr 1fr);gap:var(--tlcb-gap,32px);align-items:start;}
/* ── CARD GRID ────────────────────────────────────────────────
   Cards in a row are EQUAL HEIGHT with the content top-aligned and the link
   pinned to the foot, so the links line up across the row however much body
   text each card carries. That is the whole reason for the flex column and
   the margin-top:auto on the foot. */
.tlcb-cg-grid{display:grid;grid-template-columns:var(--tlcb-cols,repeat(3,1fr));gap:24px;align-items:stretch;margin-top:8px;}
.tlcb-cg-card{display:flex;flex-direction:column;background:#FFFDF9;border:1px solid #E7DFD1;border-radius:20px;padding:28px 26px;
  box-shadow:0 2px 6px rgba(11,22,44,.05),0 10px 24px rgba(11,22,44,.06);
  transition:box-shadow .3s cubic-bezier(.2,.8,.2,1),transform .3s cubic-bezier(.2,.8,.2,1);}
/* Bible classes, read from the Christian Ed screen. auto-fit inside the chosen
   column count so a row of two on a narrow page does not leave a lone card. */
.tlcb-cl{display:grid;grid-template-columns:var(--tlcb-cols,repeat(3,1fr));gap:20px;align-items:stretch;margin-top:6px;}
.tlcb-cl-card{display:flex;flex-direction:column;gap:6px;padding:24px 22px;border-radius:14px;
  border:1px solid var(--tlcb-rule,#E7DFD1);background:rgba(255,255,255,.55);}
.tlcb-cl-eyebrow{font:800 11px/1.4 var(--tlcb-ui);letter-spacing:.13em;text-transform:uppercase;}
.tlcb-cl-t{font-family:var(--tlcb-serif);font-weight:700;font-size:calc(var(--tlcb-head,22px) * .7);
  line-height:1.2;color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-cl-d{margin:0;font-family:var(--tlcb-sans);font-size:calc(14px * var(--tlcb-scale, 1));
  line-height:1.55;color:var(--tlcb-body,#4A4860);}
.tlcb-cl-m{font-family:var(--tlcb-sans);font-size:calc(13px * var(--tlcb-scale, 1));color:var(--tlcb-body,#4A4860);}
.tlcb-cl-w{margin-top:auto;padding-top:8px;font-family:var(--tlcb-ui);font-weight:700;
  font-size:calc(13px * var(--tlcb-scale, 1));color:var(--tlcb-ink,#1A1A2A);display:flex;flex-direction:column;gap:2px;}
.tlcb-cl-w span{font-weight:400;color:var(--tlcb-body,#8A8898);}
/* The sermon library: series that fold open, and their sermons inside. */
.tlcb-sl{display:flex;flex-direction:column;gap:10px;margin-top:6px;}
.tlcb-sl-set{border:1px solid var(--tlcb-rule,#E7DFD1);border-radius:12px;background:rgba(255,255,255,.5);}
.tlcb-sl-sum{display:flex;align-items:baseline;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding:14px 18px;cursor:pointer;list-style:none;}
.tlcb-sl-sum::-webkit-details-marker{display:none;}
/* The caret, drawn rather than shipped as a glyph so it turns with the state. */
.tlcb-sl-sum::after{content:'';width:7px;height:7px;flex:none;margin-left:auto;
  border-right:2px solid var(--tlcb-eyebrow-ink,#C9973A);border-bottom:2px solid var(--tlcb-eyebrow-ink,#C9973A);
  transform:rotate(45deg);transition:transform .15s ease;}
.tlcb-sl-set[open] > .tlcb-sl-sum::after{transform:rotate(-135deg);}
.tlcb-sl-name{font-family:var(--tlcb-serif);font-weight:700;font-size:calc(var(--tlcb-head,22px) * .72);
  line-height:1.2;color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-sl-c{font:700 11.5px/1.4 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;
  color:var(--tlcb-eyebrow-ink,#2E7EA6);}
.tlcb-sl-d{margin:0 18px 4px;font-family:var(--tlcb-sans);font-size:calc(14px * var(--tlcb-scale, 1));
  color:var(--tlcb-body,#4A4860);line-height:1.5;}
.tlcb-sl-rows{display:flex;flex-direction:column;padding:0 18px 10px;}
.tlcb-sl-row{display:flex;align-items:baseline;justify-content:space-between;gap:14px;
  padding:10px 0;border-top:1px solid var(--tlcb-rule,#E7DFD1);}
.tlcb-sl-b{display:flex;flex-direction:column;gap:2px;min-width:0;}
.tlcb-sl-t{font-family:var(--tlcb-sans);font-weight:600;font-size:calc(15px * var(--tlcb-scale, 1));
  color:var(--tlcb-ink,#1A1A2A);}
.tlcb-sl-m{font-family:var(--tlcb-ui);font-size:calc(12.5px * var(--tlcb-scale, 1));color:var(--tlcb-body,#8A8898);}
.tlcb-sl-go{flex:none;font:800 12px/1 var(--tlcb-ui);letter-spacing:.08em;text-transform:uppercase;
  color:var(--tlcb-link-ink,#2E7EA6);text-decoration:none;}
a.tlcb-sl-go:hover{text-decoration:underline;}
/* Contact details. A label column wide enough for "Instagram" and a value
   column that takes the rest, so the addresses line up under each other rather
   than starting at a different place on every row. */
.tlcb-ct{display:flex;flex-direction:column;gap:2px;margin-top:6px;}
.tlcb-ct-row{display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:baseline;padding:7px 0;}
.tlcb-ct-row--sub{padding-top:0;}
.tlcb-ct-l{font:800 11.5px/1.5 var(--tlcb-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--tlcb-eyebrow-ink,#2E7EA6);}
.tlcb-ct-v{font-family:var(--tlcb-sans);font-size:var(--tlcb-body,16px);color:var(--tlcb-ink,#1A1A2A);}
.tlcb-ct-a{color:var(--tlcb-link-ink,#2E7EA6);text-decoration:none;}
.tlcb-ct-a:hover{text-decoration:underline;}
/* ⚠ The label column collapses on a phone. 96px of it beside a long address in
   390px leaves the value about 200px, which wraps an email onto three lines. */
/* How a block is set apart from the page — see SHADOWS. Only ever emitted when
   somebody has chosen one, so a page that has never touched the control renders
   from exactly the CSS it always did.
   ⚠ The radius is on the block wrapper, which normally has none. Without it a
   shadow traces a hard rectangle around a surface whose own corners are round,
   and the two disagree by about 20px at each corner. */
.tlcb--sh-soft{border-radius:14px;box-shadow:0 2px 6px rgba(11,22,44,.05),0 10px 24px rgba(11,22,44,.06);}
.tlcb--sh-lifted{border-radius:14px;box-shadow:0 18px 44px rgba(16,27,46,.18);}

/* ── Appear ───────────────────────────────────────────────────────────────
   ⚠ GATED POSITIVELY, TWICE OVER, AND THE NESTING ORDER IS THE WHOLE SAFETY
   OF IT. The initial opacity:0 exists ONLY inside both gates, so a browser
   without scroll-driven animations and a visitor who has asked for reduced
   motion are never handed a hidden block with nothing to un-hide it. Firefox
   has no animation-timeline yet and simply gets a normal page.

   This repo has shipped a correct rule defeated by a later declaration at
   equal specificity four separate times. A rule that is never granted cannot
   lose that argument, which is why nothing here is granted and then revoked
   further down. */
@supports (animation-timeline: view()){
  @media (prefers-reduced-motion: no-preference){
    .tlcb--ap-fade,.tlcb--ap-rise{animation:tlcb-ap-fade .5s ease-out both;
      animation-timeline:view();animation-range:entry 0% entry 60%;}
    .tlcb--ap-rise{animation-name:tlcb-ap-rise;}
    @keyframes tlcb-ap-fade{from{opacity:0;}to{opacity:1;}}
    @keyframes tlcb-ap-rise{from{opacity:0;transform:translateY(18px);}to{opacity:1;transform:none;}}
  }
}
.tlcb--sh-lined{border-radius:14px;border:1px solid var(--tlcb-rule,#E7DFD1);}
/* ⚠ In whole-page mode a block is a full-bleed band, so a rounded, shadowed box
   inside it would read as a card floating in a section rather than as the
   section itself. The separation there is the band's own background — which is
   why these are switched off rather than made subtler. */
.tlcb-page--full > .tlcb--sh-soft,
.tlcb-page--full > .tlcb--sh-lifted,
.tlcb-page--full > .tlcb--sh-lined{border-radius:0;box-shadow:none;border:0;}
/* A soft lift, not a drop — the card rises toward the reader.
   The lift is on --link ONLY. A card that lifts under the pointer promises
   that clicking it does something, and a card with no address cannot keep
   that promise. */
.tlcb-cg-card--link:hover{box-shadow:0 18px 40px rgba(16,27,46,.16);transform:translateY(-4px);}
/* The card is an anchor on the public page, so every word inside it would
   otherwise take the browser's link color and underline. The heading, body and
   eyebrow keep their own; only the label at the foot reads as a link. */
a.tlcb-cg-card{color:inherit;text-decoration:none;}
a.tlcb-cg-card:hover .tlcb-cg-link{text-decoration:underline;}
.tlcb-cg-img{margin-bottom:14px;}
.tlcb-cg-img img{display:block;max-width:100%;max-height:120px;width:auto;height:auto;object-fit:contain;}
.tlcb-cg-eyebrow{font:800 11.5px/1.4 var(--tlcb-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--tlcb-eyebrow-ink,#2E7EA6);margin-bottom:6px;}
.tlcb-cg-eyebrow:empty{display:none;}
.tlcb-cg-head{font-family:var(--tlcb-serif);font-weight:700;font-size:calc(var(--tlcb-head,22px) * .78);line-height:1.15;letter-spacing:-.01em;color:#1E2D4A;margin-bottom:8px;}
.tlcb-cg-body{margin-bottom:14px;}
.tlcb-cg-foot{margin-top:auto;}
.tlcb-cg-foot:empty{display:none;}
.tlcb-cg-link{font:800 13px/1.3 var(--tlcb-ui);color:var(--tlcb-link-ink,#2E7EA6);text-decoration:none;}
.tlcb-cg-link:hover{text-decoration:underline;}
/* A label the office typed on a card with no address. It is not a link, so it
   does not get the link's color or its underline — otherwise it is a dead link
   wearing a working one's clothes. */
.tlcb-cg-link--off{color:var(--tlcb-body,#4A4860);opacity:.65;}
.tlcb-cg-link--off:hover{text-decoration:none;}
.tlcb-cg-intro{font-family:var(--tlcb-sans);max-width:56em;color:var(--tlcb-body,#4A4860);}
.tlcb-cg-intro:empty{display:none;}
/* The colored hairline across the card top on /ministries. It is switched on
   for the whole grid rather than picked per card — one decision, not eight. */
.tlcb-cg--rule .tlcb-cg-card{border-top:3px solid #2E7EA6;}
.tlcb-cg--center{text-align:center;}
.tlcb-cg--center .tlcb-cg-img img{margin:0 auto;}
.tlcb-cg--center .tlcb-cg-intro{margin-left:auto;margin-right:auto;}
.tlcb-cg--right{text-align:right;}
.tlcb-cg--right .tlcb-cg-img img{margin-left:auto;}
.tlcb-cg--right .tlcb-cg-intro{margin-left:auto;}
/* ── Alignment, for every block type except Spacer ────────────────────────
   ALIGNABLE_TYPES (see its comment) decides who gets the chips; these are the
   rules those chips drive. One pair of classes, tlcb--center/tlcb--right,
   with left deliberately having NO class at all — left is what every block
   has always rendered as, so the untouched page keeps rendering from exactly
   the CSS it always did rather than from a new rule that happens to agree.

   text-align is the workhorse and it INHERITS, so one declaration reaches
   every heading, eyebrow and paragraph in the subtree without naming them.
   What follows it is only the things inheritance cannot do: a flex row (whose
   justify-content is not inherited), a flex column whose own align-items
   would leave the boxes hugging one edge with their text aligned inside them,
   and a max-width element that needs its side margins moved. */
.tlcb--center{text-align:center;}
.tlcb--right{text-align:right;}
/* Every row of buttons or links on the site, in one place: tlcb-inline is
   the action row shared by the banner-shaped types, tlcb-btns is the Button
   bar's own row (and the Welcome banner's), tlcb-alert is the Notice bar,
   which is a horizontal row rather than a heading+prose column — so
   "centered" there means moving the row, not the text inside it. Button bar
   is the block Dinger had selected when he asked for this. */
.tlcb--center .tlcb-inline,.tlcb--center .tlcb-btns,.tlcb--center .tlcb-alert{justify-content:center;}
.tlcb--right .tlcb-inline,.tlcb--right .tlcb-btns,.tlcb--right .tlcb-alert{justify-content:flex-end;}
/* The flex columns. .tlcb-band-text (Welcome banner, Page banner, Callout)
   sets align-items:flex-start itself, which beats any amount of text-align.
   A tag pinned with align-self has to be moved on its own for the same
   reason — it opts out of the container's alignment by definition. */
.tlcb--center .tlcb-band-text{align-items:center;}
.tlcb--right .tlcb-band-text{align-items:flex-end;}
.tlcb--center .tlcb-callout-tag{align-self:center;}
.tlcb--right .tlcb-callout-tag{align-self:flex-end;}
/* Elements carrying their own max-width sit at the left of the space they are
   given, whatever their text does, until the side margins are moved. */
.tlcb--center .tlcb-hero-sub,.tlcb--center .tlcb-cg-intro{margin-left:auto;margin-right:auto;}
.tlcb--right .tlcb-hero-sub,.tlcb--right .tlcb-cg-intro{margin-left:auto;margin-right:0;}
/* ⚠ The amount ladder aligns its INTRO ONLY. Its rows are
   "$100 /week ———— [Give $100]" — a left column and a right button — and
   moving that text is not what "center this section" means to anybody looking
   at it. The live leadership section is exactly this shape: a centered heading
   over left-aligned rows.
   This used to be written as a list of the five elements to center, on the
   grounds that a rule existing only to undo the rule above it goes wrong the
   moment a sixth element is added. That reasoning inverted when alignment
   became general: the undo is now the robust half. Anything added INSIDE a
   row inherits the row's own left, and anything added to the intro inherits
   the block's alignment, with no list to keep in step either way. */
.tlcb--center.tlcb--amounts .tlcb-am-row,.tlcb--right.tlcb--amounts .tlcb-am-row{text-align:left;}
.tlcb--center.tlcb--amounts .tlcb-am>.tlcb-prose{margin-left:auto;margin-right:auto;max-width:680px;}
.tlcb--right.tlcb--amounts .tlcb-am>.tlcb-prose{margin-left:auto;margin-right:0;max-width:680px;}
/* The three type-specific rules that used to sit here — Callout and Hero's
   band-text align-items, Hero's subtitle margins, and the Notice bar's row
   justify-content — are gone, not lost: each is now the generic rule above
   that does the same job for every type at once. Two rules for one job is two
   places to disagree, and the generic one had to exist regardless. */
.tlcb-media{order:var(--tlcb-media-order,0);min-height:150px;border-radius:20px;overflow:hidden;background:#E4EAF2 center/cover no-repeat;
  display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;}
.tlcb-media img{width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;transition:transform .5s cubic-bezier(.2,.8,.2,1);}
.tlcb-media:hover img{transform:scale(1.04);}
/* Matches .page-hero in public/styles.css — this is the page banner, so it has
   to be the same thing whether the page draws it or a block does. */
.tlcb-hero{border-radius:8px;padding:56px 28px;position:relative;
  background:#1E2D4A var(--tlcb-hero-img,none) var(--tlcb-hero-pos,center)/cover;}
/* ⚠ THE TOP STOP IS THE ONLY THING "Photo shading" MOVES. The bottom stop
   stays fixed at .92 regardless — that is what keeps the headline legible on
   any photograph, and is not somebody's decision to weaken, the same rule
   Photo banner's own veil follows. Default landed here at .82, between
   Photo banner's Medium (.72) and Heavy (.88) — reported as reading too
   dark, which "Light" (.5) or "Medium" now answer without a code change. */
.tlcb-hero::before{content:'';position:absolute;inset:0;border-radius:inherit;
  background:linear-gradient(135deg,rgba(30,45,74,var(--tlcb-hero-veil-top,.82)),rgba(17,30,50,.92));opacity:var(--tlcb-hero-veil,0);}
.tlcb-hero > *{position:relative;z-index:1;}
.tlcb-hero-eyebrow{font:800 12px/1 var(--tlcb-ui);letter-spacing:.18em;text-transform:uppercase;color:#E8C070;margin-bottom:8px;}
.tlcb-hero-title{font-family:var(--tlcb-serif);font-weight:800;font-size:var(--tlcb-hero,38px);line-height:1;letter-spacing:-.03em;color:#fff;margin:0;}
/* No auto side margins by default — align-items:flex-start (.tlcb-band-text's
   own base) already puts this flush left; a flex item's own horizontal auto
   margins self-center regardless of the container's align-items, which is
   what let the subtitle alone drift centered even in "left" mode before Hero
   had a real Alignment control. .tlcb--center.tlcb--hero below restores them. */
.tlcb-hero-sub{font-size:17px;color:rgba(255,255,255,.72);max-width:600px;margin:12px 0 0;font-weight:300;line-height:1.5;}
.tlcb-embed{position:relative;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:#1E2D4A;}
.tlcb-embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}
.tlcb-embed-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#FBF8F3;font-size:30px;}
.tlcb-gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.tlcb-gallery span,.tlcb-gallery img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:7px;background:#DDE3ED;}
/* The tile is a button on the public page so a photograph can be opened from
   the keyboard. It has to give up every default a button carries or the grid
   grows borders and padding it never had. */
.tlcb-gal-open{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in;border-radius:7px;}
.tlcb-gal-open:focus-visible{outline:3px solid #C9973A;outline-offset:2px;}

/* ── The photo viewer ─────────────────────────────────────────────────────
   Appended to the body rather than drawn inside the block, so it is not
   clipped by anything the page does with overflow. That also puts it outside
   .tlcb-page, so none of the --tlcb-* properties reach it and every color
   here is written out. */
.tlcb-lb{position:fixed;inset:0;z-index:9999;background:rgba(11,18,32,.92);
  display:flex;align-items:center;justify-content:center;gap:8px;padding:24px;}
.tlcb-lb[hidden]{display:none;}
.tlcb-lb-fig{margin:0;display:flex;flex-direction:column;align-items:center;gap:12px;max-width:min(1100px,100%);max-height:100%;}
.tlcb-lb-fig img{max-width:100%;max-height:78vh;width:auto;height:auto;border-radius:10px;
  box-shadow:0 24px 70px rgba(0,0,0,.5);background:#1E2D4A;}
/* ⚠ --font-ui, not --tlcb-ui. The viewer is appended to the body, so it sits
   outside .tlcb-page and none of the --tlcb-* properties reach it — but
   --font-ui is declared on :root in styles.css and re-pointed by the
   appearance record, so it does. Writing the family out as a literal here
   would pin the caption to one typeface while the rest of the site followed
   the setting, which is what the 1b test catches. */
.tlcb-lb-fig figcaption{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;justify-content:center;
  font-family:var(--font-ui);font-size:14px;font-weight:400;line-height:1.5;
  color:rgba(247,243,236,.86);text-align:center;}
.tlcb-lb-of{color:rgba(247,243,236,.55);font-size:13px;}
.tlcb-lb-x{position:absolute;top:16px;right:16px;width:44px;height:44px;border:0;border-radius:50%;
  background:rgba(247,243,236,.12);color:#F7F3EC;font-size:26px;line-height:1;cursor:pointer;}
.tlcb-lb-nav{width:44px;height:44px;flex:none;border:0;border-radius:50%;background:rgba(247,243,236,.12);
  color:#F7F3EC;font-size:28px;line-height:1;cursor:pointer;}
.tlcb-lb-nav[hidden]{display:none;}
.tlcb-lb-x:hover,.tlcb-lb-nav:hover{background:rgba(247,243,236,.22);}
.tlcb-lb-x:focus-visible,.tlcb-lb-nav:focus-visible{outline:3px solid #C9973A;outline-offset:2px;}
/* ⚠ GATED POSITIVELY, never by an override further down. A reduced-motion
   visitor is not given the animation to begin with, so there is no later
   declaration that has to win a cascade argument to take it away. */
@media (prefers-reduced-motion: no-preference){
  .tlcb-lb{animation:tlcb-lb-in .16s ease-out;}
  @keyframes tlcb-lb-in{from{opacity:0;}to{opacity:1;}}
}
@media (max-width:640px){
  .tlcb-lb{padding:12px;gap:4px;}
  .tlcb-lb-fig img{max-height:66vh;}
}
.tlcb-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.tlcb-cards .tlcb-card{border:1px solid #DDE3ED;border-radius:8px;background:#F7F3EC;padding:11px;display:flex;flex-direction:column;gap:6px;}
.tlcb-card-t{font:600 12.5px/1.3 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-card-m{font-size:11px;color:#8A8898;}
.tlcb-rows{display:flex;flex-direction:column;gap:8px;}
.tlcb-row{display:flex;align-items:center;gap:14px;padding:11px 13px;border:1px solid #DDE3ED;border-radius:8px;background:#F7F3EC;}
.tlcb-row-d{flex:none;width:60px;text-align:center;font:700 12.5px/1.3 var(--tlcb-ui);color:#1E2D4A;letter-spacing:.03em;}
.tlcb-row-b{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0;}
.tlcb-row-n{font:600 13.5px/1.3 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-row-m{font-size:12px;color:#8A8898;}
.tlcb-times{display:flex;flex-direction:column;}
.tlcb-time{display:grid;grid-template-columns:1.2fr 1.3fr 1fr;gap:12px;padding:10px 2px;border-bottom:1px solid #EDE9E0;font-size:13.5px;}
.tlcb-time b{font-weight:600;color:#1E2D4A;}
.tlcb-time i{font-style:normal;color:#4A4860;}
.tlcb-time u{text-decoration:none;color:#8A8898;}
.tlcb-faq{padding:12px 14px;border:1px solid #DDE3ED;border-radius:8px;background:#F7F3EC;}
.tlcb-faq summary{font:600 13.5px/1.35 var(--tlcb-ui);color:#1E2D4A;cursor:pointer;list-style:none;
  display:flex;align-items:center;gap:10px;justify-content:space-between;}
.tlcb-faq summary::-webkit-details-marker{display:none;}
.tlcb-faq summary::after{content:'⌄';color:#8A8898;font-size:13px;}
.tlcb-faq[open] summary::after{content:'⌃';}
.tlcb-faq .tlcb-prose{margin-top:6px;font-size:13px;}

/* ── Lessons ──────────────────────────────────────────────────────────────
   Closed on the page, so a study with fourteen weeks in it reads as fourteen
   lines rather than fourteen essays. The week marker sits before the title
   because that is what somebody scans for when they are looking for the one
   they missed. */
.tlcb-lesson{border:1px solid var(--tlcb-rule,#DDE3ED);border-radius:8px;padding:12px 14px;background:var(--tlcb-chip-bg,rgba(0,0,0,.02));}
.tlcb-lesson + .tlcb-lesson{margin-top:8px;}
.tlcb-lesson > summary{cursor:pointer;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;
  font:600 15px/1.4 var(--tlcb-ui);color:var(--tlcb-head-ink,#1E2D4A);list-style:none;}
.tlcb-lesson > summary::-webkit-details-marker{display:none;}
/* The caret is drawn rather than left to the browser, so it is the same mark
   on every engine and turns with the disclosure. */
.tlcb-lesson > summary::before{content:'';flex:none;width:7px;height:7px;margin-right:2px;
  border-right:2px solid var(--tlcb-eyebrow-ink,#C9973A);border-bottom:2px solid var(--tlcb-eyebrow-ink,#C9973A);
  transform:rotate(-45deg);transition:transform .12s ease;}
.tlcb-lesson[open] > summary::before{transform:rotate(45deg);}
.tlcb-lesson-w{font:800 11px/1.4 var(--tlcb-ui);letter-spacing:.14em;text-transform:uppercase;
  color:var(--tlcb-eyebrow-ink,#C9973A);flex:none;}
.tlcb-lesson-t{flex:1;min-width:0;}
.tlcb-lesson .tlcb-prose{margin-top:10px;}
.tlcb-lesson-dl{display:inline-block;margin-top:10px;font:700 12.5px/1 var(--tlcb-ui);
  color:var(--tlcb-link-ink,#2E7EA6);}
/* A reduced-motion visitor gets the caret without the turn. Granted only where
   motion is welcome, rather than granted and then taken away. */
@media (prefers-reduced-motion: reduce){
  .tlcb-lesson > summary::before{transition:none;}
}

/* ── Member portal ────────────────────────────────────────────────────── */
.tlcb-portal{display:flex;flex-direction:column;gap:10px;align-items:flex-start;
  padding:22px 24px;border:1px solid var(--tlcb-rule,#DDE3ED);border-radius:12px;
  background:var(--tlcb-chip-bg,rgba(0,0,0,.02));}
.tlcb-portal .tlcb-btns{margin-top:4px;}
.tlcb-callout{padding:18px 20px;border-radius:10px;background:#FDF8EC;border:1px solid #F0DCB0;display:flex;flex-direction:column;gap:7px;}
.tlcb-callout-tag{align-self:flex-start;padding:2px 8px;border-radius:5px;background:#C9973A;color:#1B1608;
  font:700 10px/1.6 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;}
.tlcb-callout-t{font:600 16px/1.35 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-btns{display:flex;gap:10px;flex-wrap:wrap;}
/* ⚠ THE FALLBACKS ARE THE SITE AS IT ALWAYS LOOKED. A block with no button
   color chosen emits none of these properties, so each var() falls through to
   the literal that has been here since the button existed. Nothing repaints
   until somebody picks a color on a particular block. */
.tlcb-btn{display:inline-block;padding:15px 22px;border-radius:999px;font:800 14px/1 var(--tlcb-ui);text-decoration:none;
  background:var(--tlcb-btn-bg,#1E2D4A);color:var(--tlcb-btn-ink,#F5E4C0);border:1px solid var(--tlcb-btn-bd,#1E2D4A);}
/* The ghost variant keeps its own transparent fill — it is the quiet button
   beside a loud one, so taking the chosen color would make the pair identical
   and lose the distinction the variant exists for. It follows the chosen INK
   only, so the two still read as a set. */
.tlcb-btn--ghost{background:transparent;color:var(--tlcb-btn-bd,#1E2D4A);border:1px solid var(--tlcb-btn-bd,#C4CEDF);}
/* ⚠ THE PANEL FOLLOWS THE BLOCK'S OWN BACKGROUND. It used to carry two
   hardcoded colors — mist for the Newsletter block, cream for the Signup form —
   so a block had TWO surfaces and the inspector's Background swatch reached
   only one of them. Dinger, with a Signup form on a Mist field: "i can change
   the blue, but not the color of the box with the text on it." He was right;
   there was no control, because the box was painted here.
   ⚠ --tlcb-bg-flat, not --tlcb-bg. The latter is a GRADIENT on the redesign
   surfaces, and a gradient drawn again inside a smaller box repeats the ramp at
   a different scale — two versions of the same field, visibly disagreeing.
   The rule follows the block too: a hardcoded #DDE3ED hairline is invisible on
   a pale field and glaring on a dark one, and --tlcb-rule already carries the
   right answer for both. The panel--form variant's separate cream override is
   gone with it — the block's own background is the one true answer now, so a
   second hardcoded fill for one block type would just be the same bug with a
   narrower blast radius. */
.tlcb-panel{display:flex;flex-direction:column;gap:10px;padding:18px 20px;
  border:1px solid var(--tlcb-rule,#DDE3ED);border-radius:9px;background:var(--tlcb-bg-flat,#EDF2F7);}
.tlcb-field{height:38px;border:1px solid #C7CEDA;border-radius:7px;background:#fff;padding:0 12px;font-size:13px;width:100%;}
.tlcb-inline{display:flex;gap:9px;align-items:center;flex-wrap:wrap;}
.tlcb-inline .tlcb-field{flex:1;min-width:180px;}
/* ⚠ FOLLOWS THE BLOCK'S OWN BACKGROUND NOW, the same fix the Newsletter/
   Signup form panel got above — this used to hardcode navy regardless of
   the Theme colors swatch, so picking a background did nothing but the
   border/rule ever moved. --tlcb-bg-flat, not --tlcb-bg, for the same
   reason .tlcb-panel uses it: the latter is a gradient on the redesign
   surfaces and would repeat its own ramp inside a smaller box. The head
   and note read the wrapper's own --tlcb-head-ink/--tlcb-ink now instead of
   a hardcoded cream, which is what actually kept the box unreadable if a
   background were ever picked — see the .give type's bg:3/ink:3 default
   above for why an untouched block still opens looking exactly as before. */
.tlcb-give{display:flex;flex-direction:column;gap:11px;padding:20px;border-radius:10px;
  border:1px solid var(--tlcb-rule,rgba(245,240,230,.14));background:var(--tlcb-bg-flat,#1E2D4A);}
.tlcb-give-note{font-size:14px;line-height:1.7;color:var(--tlcb-ink,#C4CEDF);}
/* ⚠ QUALIFIED, AND IT HAS TO STAY QUALIFIED. This selector was bare, and so was
   the Coming-up strip's own chip 385 lines below — two components, one class
   name, equal specificity, so source order decided and the later one won. The
   Give button lost its gold fill to that rule's chip-bg background and kept
   its near-black ink, which on the Ink navy field is #1B1608 on 8% cream over
   navy: about 1.3:1, and reported as "the background of the box blends into
   the give button".

   This is the same defect as the two duplicate card declarations fixed in
   v4.5.0. Two rules for one class name is worth grepping for. */
.tlcb-give .tlcb-chip{padding:8px 14px;border:1px solid rgba(245,228,192,.4);border-radius:7px;color:#F3EDE1;
  font:600 13px/1 var(--tlcb-ui);text-decoration:none;}
/* ⚠ THE SAME PAIRED --tlcb-btn-* VARIABLES EVERY OTHER BUTTON READS, with the
   original gold as the fallback so an untouched Give block repaints by not one
   pixel. This selector stays more specific than the generic .tlcb-btn rule on
   purpose — the chip's own padding/radius/weight are its own geometry, not the
   pill every other button draws — only the three colors are shared. */
.tlcb-give .tlcb-chip--go{background:var(--tlcb-btn-bg,#C9973A);color:var(--tlcb-btn-ink,#1B1608);
  border-color:var(--tlcb-btn-bd,#C9973A);padding:10px 18px;font-weight:700;}
/* ── The giving widget ── the one block that takes money. Its colors are
   fixed rather than following the block's Theme colors palette: this is the
   most-clicked control on the church website and a staff member trying a
   background on it is one pick away from an invisible Give button. The
   wording around it is fully editable; the button is not. */
.tlcb-gv{display:flex;flex-direction:column;padding:26px 24px;border:1px solid #DDE3ED;border-radius:11px;background:#FBF8F3;}
.tlcb-gv-title{font:600 27px/1.2 var(--tlcb-serif);color:#1E2D4A;}
.tlcb-gv-tag{font:italic 400 15.5px/1.4 var(--tlcb-serif);color:#2E7EA6;margin-top:4px;}
.tlcb-gv-lab{font:800 11px/1 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;color:#6B6A5F;margin:24px 0 9px;}
.tlcb-gv-fund{width:100%;background:#fff;border:1px solid #DDE3ED;border-radius:9px;padding:12px 14px;
  font:600 15px/1 var(--tlcb-ui);color:#1E2D4A;cursor:pointer;}
.tlcb-gv-chips{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.tlcb-gv-chip{border-radius:8px;font:700 17px/1 var(--tlcb-ui);text-align:center;padding:14px 0;
  background:#fff;color:#1E2D4A;border:1px solid #DDE3ED;cursor:pointer;transition:all .15s;}
.tlcb-gv-chip.is-on{background:#1E2D4A;color:#fff;border-color:#1E2D4A;}
.tlcb-gv-other{margin-top:10px;background:#fff;border:1px solid #DDE3ED;border-radius:9px;padding:12px 14px;
  display:flex;align-items:center;gap:8px;font:400 19px/1 var(--tlcb-serif);color:#8C8880;}
.tlcb-gv-other input{border:none;outline:none;font:400 15px/1 var(--tlcb-ui);color:#1E2D4A;flex:1;min-width:0;background:transparent;}
.tlcb-gv-err{font-size:12.5px;color:#B0821E;margin:6px 0 0;}
.tlcb-gv-cta{margin-top:22px;display:block;text-align:center;background:#C9973A;color:#1E2D4A;
  font:800 21px/1 var(--tlcb-ui);padding:20px;border-radius:10px;text-decoration:none;}
.tlcb-gv-trust{margin-top:16px;font-size:12.5px;line-height:1.55;color:#6B6A5F;}
.tlcb-gv-trust p{margin:0;}

/* ── THE MARKET APPLICATION ───────────────────────────────────────────────
   Ported from the standalone fallback page's .mkt-* rules in public/styles.css
   into this block system's own namespace — hardcoded hex matching the same
   site palette, var(--tlcb-serif)/--tlcb-ui for type, since this block also
   has to render correctly inside the editor canvas, which never loads
   public/styles.css at all. */
.tlcb-mktapp-facts{font:600 13.5px/1 var(--tlcb-ui);color:#6B6A5F;margin:6px 0 22px;}
/* ── THE JUMP BAR ─────────────────────────────────────────────────────────
   ⚠ THESE RULES LIVE HERE, NOT IN public/styles.css, and the handoff asks for
   the other file. The reason is the same one the whole .tlcb-* namespace is in
   this file: the editor canvas never loads public/styles.css, so a bar styled
   there would be correct on the live page and unstyled in the editor — a
   preview that disagrees with the site, which is exactly what this repo has
   spent releases removing. BLOCK_CSS is served to the public site with every
   /api/pages response, so the public page gets these rules either way.

   Literal hex for the same reason every rule around it uses literal hex —
   --amber #C9973A, --white #FBF8F3, --border #DDE3ED, --steel #1E2D4A,
   --text-muted #8A8898, --shadow — none of which is defined inside the canvas. */
.jump-bar{background:#FBF8F3;border-top:3px solid #C9973A;border-bottom:1px solid #DDE3ED;
  box-shadow:0 2px 12px rgba(30,45,74,.08);}
/* ⚠ top is the site nav's own height (64px plus its 3px rule), NOT 0. The nav
   is sticky at z-index 100, so a bar stuck at 0 slides underneath it and
   disappears. Below the nav, never over it. */
.jump-bar--stuck{position:sticky;top:67px;z-index:5;}
.jump-inner{max-width:1080px;margin:0 auto;padding:12px 28px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.jump-label{font:700 10px/1 var(--tlcb-ui);letter-spacing:.12em;text-transform:uppercase;color:#8A8898;flex:none;}
.jump-scroll{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;}
.jump-link{display:inline-flex;align-items:center;font:700 12.5px/1 var(--tlcb-ui);color:#1E2D4A;
  background:#fff;border:1px solid #DDE3ED;border-radius:999px;padding:9px 16px;min-height:44px;
  text-decoration:none;white-space:nowrap;}
.jump-link:hover{border-color:#C9973A;}
.jump-cta{margin-left:auto;background:#C9973A;border-color:#C9973A;font-weight:800;flex:none;}
/* ⚠ Alignment has to move the flex row, not the text inside it. The generic
   .tlcb--center rule is text-align, which a flex container ignores — a
   control that looks live and does nothing is worse than no control. */
.tlcb--center .jump-inner,.tlcb--center .tlcb-mktfacts{justify-content:center;}
.tlcb--right .jump-inner,.tlcb--right .tlcb-mktfacts{justify-content:flex-end;}
/* ⚠ A jump has to clear the nav AND the bar, or the heading it lands on is
   tucked behind both. The sibling combinator is what keeps this off every
   other page on the site: only blocks that actually follow a jump bar get the
   taller margin, and the 88px default above stays exactly as it was. */
.tlcb--jumplinks ~ .tlcb,
.tlcb--jumplinks ~ .tlcb-pair .tlcb{scroll-margin-top:148px;}
@media print{.jump-bar{display:none;}}
/* ⚠ On a phone the row SCROLLS rather than wrapping to three lines, and the
   button stays pinned outside the scroller — a bar that grows to half the
   screen is one nobody scrolls past. Every chip keeps its 44px. */
@media (max-width:620px){
  .jump-inner{flex-wrap:nowrap;padding:10px 16px;}
  .jump-scroll{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;
    scrollbar-width:none;flex:1;}
  .jump-scroll::-webkit-scrollbar{display:none;}
  .jump-label{display:none;}
}
/* The facts band on the apply page. Four label/value pairs, every value read
   from the market settings — see the marketfacts branch in renderInner. */
.tlcb-mktfacts{display:flex;flex-wrap:wrap;gap:30px 44px;padding:16px 0;border-bottom:1px solid #DDE3ED;}
.tlcb-mktfacts-cell{display:flex;flex-direction:column;gap:5px;}
.tlcb-mktfacts-l{font:700 10px/1 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;color:#6B6A5F;}
.tlcb-mktfacts-v{font:800 15px/1.2 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-mktfacts-v--mail a{color:#2E7EA6;text-decoration:none;}
.tlcb-mktfacts-v--mail a:hover{text-decoration:underline;}
.tlcb-mktapp-closed{padding:20px 22px;border:1px solid #DDE3ED;border-left:3px solid #C9973A;border-radius:10px;background:#FBF8F3;}
.tlcb-mktapp-closed p{margin:0;font-size:14.5px;line-height:1.6;color:#4A4860;}
.tlcb-mktapp-card{max-width:760px;background:#FBF8F3;border:1px solid #DDE3ED;border-radius:16px;
  box-shadow:0 6px 32px rgba(30,45,74,.14);overflow:hidden;}
.tlcb-mktapp-steps{display:flex;border-bottom:1px solid #DDE3ED;background:#EDF2F7;}
.tlcb-mktapp-step{flex:1;background:#EDF2F7;border:none;border-bottom:3px solid transparent;padding:16px 14px;
  text-align:left;cursor:pointer;font-family:var(--tlcb-ui);min-height:44px;}
.tlcb-mktapp-step span{display:block;font:700 10px/1 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;color:#8A8898;}
.tlcb-mktapp-step b{display:block;font:800 13.5px/1.3 var(--tlcb-ui);color:#8A8898;margin-top:2px;}
.tlcb-mktapp-step[aria-selected="true"]{background:#FBF8F3;border-bottom-color:#C9973A;}
.tlcb-mktapp-step[aria-selected="true"] b{color:#1E2D4A;}
.tlcb-mktapp-form{padding:30px 30px 26px;}
.tlcb-mktapp-panel{display:none;flex-direction:column;gap:20px;}
.tlcb-mktapp-panel.is-on{display:flex;}
/* ⚠ In the editor every panel is shown at once (see the --editing rule below),
   so somebody arranging the page can reach the agreement clauses in step 3
   without a script that will not run on the canvas to switch steps for them. */
.tlcb-mktapp--editing .tlcb-mktapp-panel{display:flex;}
.tlcb-mktapp-lead{font-size:14.5px;color:#4A4860;line-height:1.65;margin:0;}
.tlcb-mktapp-field{display:flex;flex-direction:column;gap:6px;}
.tlcb-mktapp-field>label,.tlcb-mktapp-field>span{font:700 10.5px/1 var(--tlcb-ui);letter-spacing:.06em;text-transform:uppercase;color:#4A4860;}
.tlcb-mktapp-field input,.tlcb-mktapp-field textarea{width:100%;background:#fff;border:1px solid #DDE3ED;border-radius:8px;
  padding:11px 13px;font:400 14.5px/1.5 var(--tlcb-serif);color:#1A1A2A;min-height:44px;}
.tlcb-mktapp-field textarea{min-height:96px;resize:vertical;font-family:var(--tlcb-serif);}
.tlcb-mktapp-field input:focus,.tlcb-mktapp-field textarea:focus{outline:none;border-color:#C9973A;box-shadow:0 0 0 3px rgba(201,151,58,.15);}
.tlcb-mktapp-req{color:#C9973A;}
.tlcb-mktapp-opt{font-weight:400;text-transform:none;letter-spacing:0;color:#8A8898;font-family:var(--tlcb-serif);}
.tlcb-mktapp-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.tlcb-mktapp-csz{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-top:8px;}
.tlcb-mktapp-choice{display:flex;gap:8px;flex-wrap:wrap;}
.tlcb-mktapp-pill,.tlcb-mktapp-tbtn{background:#fff;border:1px solid #DDE3ED;color:#1A1A2A;cursor:pointer;min-height:44px;
  font-family:var(--tlcb-serif);transition:background .15s,border-color .15s,color .15s;}
.tlcb-mktapp-pill{border-radius:999px;padding:9px 16px;font-size:13.5px;}
.tlcb-mktapp-tbtn{border-radius:10px;padding:14px 10px;font:800 14px/1 var(--tlcb-ui);}
.tlcb-mktapp-pill[aria-pressed="true"],.tlcb-mktapp-tbtn[aria-pressed="true"]{background:#1E2D4A;border-color:#1E2D4A;color:#fff;}
.tlcb-mktapp-tables{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:10px;}
.tlcb-mktapp-check{display:flex;gap:10px;align-items:flex-start;background:#EDF2F7;border:1px solid #C4CEDF;border-radius:10px;padding:14px;cursor:pointer;}
.tlcb-mktapp-check input{width:18px;height:18px;margin-top:2px;accent-color:#4A5E3A;flex-shrink:0;}
.tlcb-mktapp-check span{font-size:13.5px;line-height:1.55;color:#1A1A2A;}
.tlcb-mktapp-drop{background:#EDF2F7;border:2px dashed #C4CEDF;border-radius:10px;padding:22px 18px;text-align:center;
  cursor:pointer;display:block;}
.tlcb-mktapp-drop b{display:block;font:700 13.5px/1 var(--tlcb-ui);color:#1E2D4A;margin-bottom:4px;}
.tlcb-mktapp-drop span{font-size:12.5px;color:#4A4860;}
.tlcb-mktapp-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.tlcb-mktapp-thumbs img{width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid #DDE3ED;cursor:pointer;}
.tlcb-mktapp-total{background:#1E2D4A;border-radius:14px;padding:20px;}
.tlcb-mktapp-total-lab{font:700 10px/1 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;color:#E8C070;margin-bottom:12px;}
.tlcb-mktapp-total-rows{display:grid;gap:9px;font:400 14px/1.4 var(--tlcb-serif);color:rgba(255,255,255,.85);}
.tlcb-mktapp-total-rows>div{display:flex;justify-content:space-between;gap:14px;}
.tlcb-mktapp-total-rows hr{border:none;border-top:1px solid rgba(255,255,255,.18);margin:3px 0;}
.tlcb-mktapp-total-due{font:800 18px/1 var(--tlcb-ui);color:#fff;}
.tlcb-mktapp-total p{font-size:12.5px;color:rgba(255,255,255,.7);line-height:1.6;margin:12px 0 0;}
.tlcb-mktapp-agree{background:#EDE9E0;border:1px solid #DDE3ED;border-radius:10px;padding:18px;max-height:190px;overflow:auto;
  font-size:13.5px;color:#4A4860;line-height:1.7;}
.tlcb-mktapp-agree p{margin:0 0 9px;}
.tlcb-mktapp-agree p:last-child{margin-bottom:0;}
.tlcb-mktapp-agree strong{font-family:var(--tlcb-ui);color:#1E2D4A;}
.tlcb-mktapp-clause{margin:0 0 9px;}
.tlcb-mktapp-clause:last-child{margin-bottom:0;}
.tlcb-mktapp-fine{font-size:12.5px;color:#8A8898;line-height:1.6;margin:0;}
.tlcb-mktapp-foot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;}
.tlcb-mktapp-foot--end{justify-content:flex-end;}
.tlcb-mktapp-alert{display:none;padding:11px 14px;border-radius:8px;font-size:13.5px;line-height:1.5;}
.tlcb-mktapp-alert--err{display:block;background:#fce8e8;border-left:3px solid #B85C3A;color:#7a1f1f;}
.tlcb-mktapp-alert--ok{display:block;background:#e8f5e9;border-left:3px solid #4A5E3A;color:#1a3d1f;}
@media(max-width:640px){
  .tlcb-mktapp-pair,.tlcb-mktapp-csz{grid-template-columns:1fr;}
  .tlcb-mktapp-steps{flex-direction:column;}
  .tlcb-mktapp-step{border-bottom-width:1px;border-left:3px solid transparent;}
  .tlcb-mktapp-step[aria-selected="true"]{border-bottom-color:#DDE3ED;border-left-color:#C9973A;}
  .tlcb-mktapp-form{padding:20px 18px;}
}

/* ── A generic event's registration form ── the single-page counterpart of
   .tlcb-mktapp above, sharing every token but none of the three-step
   markup. Deliberately its own class prefix rather than reusing
   .tlcb-mktapp-* — the market's own bespoke form must never pick up a rule
   meant for this one, or the reverse, just because a selector happened to
   match both. */
.tlcb-reg-facts{font:400 13.5px/1.5 var(--tlcb-serif);color:#4A4860;margin:0 0 18px;}
.tlcb-reg-closed{padding:20px 22px;border:1px solid #DDE3ED;border-left:3px solid #C9973A;border-radius:10px;background:#FBF8F3;}
.tlcb-reg-closed p{margin:0;font-size:14.5px;line-height:1.6;color:#4A4860;}
.tlcb-reg-form{display:flex;flex-direction:column;gap:18px;max-width:560px;
  background:#FBF8F3;border:1px solid #DDE3ED;border-radius:16px;padding:28px;
  box-shadow:0 6px 32px rgba(30,45,74,.14);}
.tlcb-reg-field{display:flex;flex-direction:column;gap:6px;}
.tlcb-reg-field>label{font:700 10.5px/1 var(--tlcb-ui);letter-spacing:.06em;text-transform:uppercase;color:#4A4860;}
.tlcb-reg-field input,.tlcb-reg-field textarea,.tlcb-reg-field select{width:100%;background:#fff;
  border:1px solid #DDE3ED;border-radius:8px;padding:11px 13px;font:400 14.5px/1.5 var(--tlcb-serif);
  color:#1A1A2A;min-height:44px;}
.tlcb-reg-field textarea{min-height:96px;resize:vertical;font-family:var(--tlcb-serif);}
.tlcb-reg-field input:focus,.tlcb-reg-field textarea:focus,.tlcb-reg-field select:focus{
  outline:none;border-color:#C9973A;box-shadow:0 0 0 3px rgba(201,151,58,.15);}
.tlcb-reg-req{color:#C9973A;}
.tlcb-reg-hint{margin:0;font-size:12px;color:#8A8898;line-height:1.5;}
.tlcb-reg-check{display:flex;gap:10px;align-items:flex-start;background:#EDF2F7;border:1px solid #C4CEDF;
  border-radius:10px;padding:14px;cursor:pointer;}
.tlcb-reg-check input{width:18px;height:18px;margin-top:2px;accent-color:#4A5E3A;flex-shrink:0;}
.tlcb-reg-check span{font-size:13.5px;line-height:1.55;color:#1A1A2A;font-family:var(--tlcb-serif);
  text-transform:none;letter-spacing:0;font-weight:400;}
.tlcb-reg-total{background:#1E2D4A;border-radius:14px;padding:18px 20px;}
.tlcb-reg-total-due{display:flex;justify-content:space-between;gap:14px;font:800 18px/1 var(--tlcb-ui);color:#fff;}
.tlcb-reg-foot{display:flex;justify-content:flex-end;}
.tlcb-reg-alert{display:none;padding:11px 14px;border-radius:8px;font-size:13.5px;line-height:1.5;}
.tlcb-reg-alert--err{display:block;background:#fce8e8;border-left:3px solid #B85C3A;color:#7a1f1f;}
.tlcb-reg-alert--ok{display:block;background:#e8f5e9;border-left:3px solid #4A5E3A;color:#1a3d1f;}
@media(max-width:640px){.tlcb-reg-form{padding:20px 18px;}}

/* ── The amount ladder ── one row per "$X /period does Y". Follows the
   block's own Theme colors, which is how the same type renders as the pale
   ministry ladder and as the navy leadership section. */
.tlcb-am{display:flex;flex-direction:column;}
.tlcb-am-list{margin-top:20px;display:flex;flex-direction:column;gap:10px;}
/* ⚠ The card fill is derived from the block's OWN background rather than
   written twice (a pale rule plus a dark override). Two rules for one surface
   means the later one wins at equal specificity whatever the theme, which is
   how a "dark mode" fix silently applies itself to the light one — this repo
   has shipped that bug more than once. color-mix lightens whichever
   background is set, so Parchment gives the near-white ministry ladder and
   Navy gives the leadership panel, from one declaration. It also tracks
   --tlcb-bg live, which matters: changing Theme colors in the editor patches
   that variable on the wrapper without re-rendering, so anything keyed off a
   CLASS instead would not follow until the next structural change. */
.tlcb-am-row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  background:color-mix(in srgb, var(--tlcb-bg,#FBF8F3) 82%, #fff);
  border:1px solid color-mix(in srgb, var(--tlcb-ink,#1E2D4A) 18%, transparent);
  border-radius:10px;padding:14px 16px;}
.tlcb-am-l{flex:1;min-width:220px;}
.tlcb-am-amt{display:flex;align-items:baseline;gap:1px;}
.tlcb-am-n{font:700 19px/1.2 var(--tlcb-serif);color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-am-p{font:400 12px/1 var(--tlcb-ui);color:var(--tlcb-ink,#8C8880);opacity:.75;}
.tlcb-am-o{font-size:13px;line-height:1.5;color:var(--tlcb-ink,#4A4860);margin-top:2px;max-width:420px;}
.tlcb-am-o p{margin:0;}
.tlcb-am-cta{background:#C9973A;color:#1B1608;font:800 13px/1 var(--tlcb-ui);
  padding:11px 16px;border-radius:8px;white-space:nowrap;text-decoration:none;}
/* Follows the block's own ink so it is readable on the pale ministry ladder
   and on the navy leadership panel alike — the same reason the row card is
   derived from --tlcb-bg rather than written twice. */
.tlcb-am-note{margin-top:14px;font-size:12.5px;line-height:1.5;color:var(--tlcb-ink,#4A4860);opacity:.8;}
/* The label over the rows. Deliberately the same shape as the giving widget's
   own "Choose an amount" label beside it — the two sit side by side in the
   page's top row, and two different ways of labeling a list of amounts on one
   screen reads as two different kinds of thing. */
.tlcb-am-lab{margin:22px 0 0;font:800 12px/1.3 var(--tlcb-ui);letter-spacing:.1em;
  text-transform:uppercase;color:var(--tlcb-head-ink,#1E2D4A);opacity:.85;}
.tlcb-am-lab + .tlcb-am-list{margin-top:10px;}
.tlcb-dl{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid #DDE3ED;border-radius:9px;background:#F7F3EC;}
.tlcb-dl-i{flex:none;width:38px;height:46px;border-radius:5px;background:#FBF8F3;border:1px solid #C4CEDF;display:flex;
  align-items:center;justify-content:center;font:700 10px/1 var(--tlcb-ui);color:#8A8898;}
.tlcb-dl-b{flex:1;display:flex;flex-direction:column;gap:3px;min-width:0;}
.tlcb-dl-t{font:600 14px/1.35 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-dl-m{font-size:12px;color:#8A8898;}
.tlcb-logos{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.tlcb-logo{height:56px;border:1px solid #DDE3ED;border-radius:7px;background:#F7F3EC;display:flex;align-items:center;
  justify-content:center;font-size:11px;color:#6A6858;letter-spacing:.06em;text-align:center;padding:6px;overflow:hidden;text-decoration:none;}
.tlcb-logo img{max-width:100%;max-height:100%;object-fit:contain;}
.tlcb-spacer{height:var(--tlcb-height,48px);}
.tlcb-note{font-size:11.5px;color:#8A8898;}
.tlcb [contenteditable="true"]:empty::before{content:attr(data-ph);color:#A8A69A;font-style:italic;}
.tlcb [contenteditable="true"]{min-height:1em;}

/* ── Site-wide blocks ─────────────────────────────────────────────────────── */
.tlcb-alert{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:8px;background:#FDF8EC;border:1px solid #F0DCB0;
  font-size:13.5px;color:#4A4860;flex-wrap:wrap;}
.tlcb-alert-tag{flex:none;padding:2px 8px;border-radius:5px;background:#C9973A;color:#1B1608;
  font:700 10px/1.6 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;}
.tlcb-alert-body{flex:1;min-width:120px;}
.tlcb-alert-link{flex:none;color:#2E7EA6;font-family:var(--tlcb-ui);font-weight:800;text-decoration:none;}
.tlcb-slide{position:relative;border-radius:10px;overflow:hidden;padding:64px 40px;display:flex;flex-direction:column;
  align-items:flex-start;gap:14px;min-height:300px;justify-content:center;
  background:#43536F var(--tlcb-slide-img,none) center/cover;}
.tlcb-slide::before{content:'';position:absolute;inset:0;background:linear-gradient(105deg,rgba(17,30,50,.86),rgba(30,45,74,.55));}
.tlcb-slide > *{position:relative;z-index:1;}
.tlcb-slide-title{font-family:var(--tlcb-serif);font-weight:800;font-size:var(--tlcb-hero,38px);line-height:1;letter-spacing:-.03em;color:#fff;margin:0;max-width:16em;}
.tlcb-slide-sub{font-size:16px;line-height:1.55;color:rgba(255,255,255,.8);margin:0;max-width:34em;font-weight:300;}
.tlcb-btn--ghost-light{background:transparent;color:#F3EDE1;border:1px solid rgba(245,228,192,.5);}
.tlcb-dots{display:flex;gap:6px;margin-top:4px;}
.tlcb-dots span{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.4);}
.tlcb-dots span.on{background:#E8C070;}
/* ── THE INFO CARD ────────────────────────────────────────────────────────
   A slot on a banner, not a block. When it is on, the banner becomes two
   columns and the text column narrows to make room — the card never overlaps
   the text and is never positioned by hand. Below the tablet breakpoint it
   stacks under the text at full width. */
.tlcb-band-text{display:flex;flex-direction:column;align-items:flex-start;gap:14px;min-width:0;}
.tlcb-band--card{display:grid;grid-template-columns:1fr minmax(320px,34%);gap:34px;align-items:center;}
.tlcb-band--card-left{grid-template-columns:minmax(320px,34%) 1fr;}
.tlcb-band--card-left .tlcb-band-text{order:2;}
.tlcb-band--card-left .tlcb-card{order:1;}
/* Inside a half column the card stacks under the text, exactly as on a phone:
   minmax(320px,34%) beside a headline in a ~500px column leaves the words
   about 150px. The two-class selectors outrank the single-class rules above,
   so no !important is needed — same treatment as the phone rules, which stay
   the stronger of the two. */
.tlcb-pair .tlcb-band--card{grid-template-columns:1fr;}
.tlcb-pair .tlcb-band--card-left .tlcb-band-text{order:0;}
.tlcb-pair .tlcb-band--card-left .tlcb-card{order:1;}
/* ⚠ A GRADIENT, A REAL SHADOW AND A FADING RULE — all three off the
   prototype, and all three things the first build flattened. The card is the
   most-photographed element of this design (it sits on the Home banner) and a
   flat white box with a hairline is not what it is. */
aside.tlcb-card{background:linear-gradient(180deg,#FFFDF8 0%,#F5F0E6 100%);border-radius:22px;padding:34px 32px;box-shadow:0 20px 50px rgba(16,27,46,.40);
  display:flex;flex-direction:column;position:relative;z-index:1;}
.tlcb-card-eyebrow{font:800 11px/1.4 var(--tlcb-ui);letter-spacing:.16em;text-transform:uppercase;color:#B44A2E;}
.tlcb-card-eyebrow:empty::before{content:attr(data-ph);opacity:.45;}
/* ⚠ NO BORDER PER ROW. The spec's own row list carries an explicit
   { rule: true } between the times and the address, which only makes sense if
   the rows themselves have no rule. Bordering every row AND stacking 20px of
   padding on each is what made this card run to nearly 500px on the homepage —
   about twice the height of the one it reproduces. One hairline, not six. */
.tlcb-card-row{display:flex;flex-direction:column;gap:2px;padding:9px 0;}
.tlcb-card-row--tight{padding:7px 0;}
/* ⚠ A FADING rule, not a hairline. It is 2px of gold dissolving to nothing
   across the card — the prototype's own declaration. A flat 1px line is what
   the first build drew and it reads as a divider in a form; this reads as
   part of the card. */
.tlcb-card-rule{height:2px;background:linear-gradient(90deg,#E4A93C,rgba(228,169,60,0));margin:16px 0;border:0;}
.tlcb-card-row--tight .tlcb-card-link{margin-top:5px;}
.tlcb-card-free{display:block;font-size:14.5px;line-height:1.65;}
.tlcb-card-free p{margin:0 0 8px;}
.tlcb-card-free p:last-child{margin-bottom:0;}
.tlcb-card-free a{color:#2E7EA6;}
.tlcb-card-row:last-child{border-bottom:0;padding-bottom:0;}
.tlcb-card-body > :first-child{padding-top:20px;}
.tlcb-card-1{font:400 24px/1.15 var(--tlcb-serif);color:#1E2D4A;}
.tlcb-card-2{font:400 13.5px/1.5 var(--tlcb-ui);color:#4A4860;}
.tlcb-card-link{font:600 15px/1.5 var(--tlcb-ui);color:#2E7EA6;text-decoration:none;}
.tlcb-card-link:hover{text-decoration:underline;}
.tlcb-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
.tlcb-tile{display:flex;flex-direction:column;gap:8px;padding:16px;border:1px solid #DDE3ED;border-radius:9px;background:#FBF8F3;
  text-decoration:none;color:inherit;}
.tlcb-tile:hover{border-color:#2E7EA6;}
.tlcb-tile-i{font-size:17px;color:#2E7EA6;}
.tlcb-tile-t{font:600 13.5px/1.3 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-svcs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.tlcb-svc{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid #DDE3ED;border-radius:9px;background:#FBF8F3;}
.tlcb-svc-d{font:700 10px/1.6 var(--tlcb-ui);letter-spacing:.12em;text-transform:uppercase;color:#8A8898;}
.tlcb-svc-t{font-family:var(--tlcb-serif);font-weight:700;font-size:21px;color:#1E2D4A;line-height:1.2;}
.tlcb-svc-n{font-size:12.5px;color:#6A6858;}
.tlcb-sermon{display:grid;grid-template-columns:var(--tlcb-cols,4fr 6fr);gap:var(--tlcb-gap,32px);align-items:center;}
.tlcb-sermon--text{grid-template-columns:1fr;}
.tlcb-sermon-play{position:relative;aspect-ratio:16/9;border-radius:8px;background:#1E2D4A center/cover;display:flex;
  align-items:center;justify-content:center;order:var(--tlcb-media-order,0);text-decoration:none;}
.tlcb-sermon-play--audio{aspect-ratio:auto;min-height:96px;background:#1E2D4A;}
.tlcb-sermon-play span{width:46px;height:46px;border-radius:50%;background:rgba(251,248,243,.92);color:#1E2D4A;
  display:flex;align-items:center;justify-content:center;font-size:17px;}
.tlcb-sermon-b{display:flex;flex-direction:column;gap:6px;min-width:0;}
.tlcb-sermon-t{font-family:var(--tlcb-serif);font-weight:700;font-size:calc(var(--tlcb-head,30px) * .78);line-height:1.25;color:var(--tlcb-head-ink,#1E2D4A);}
.tlcb-sermon-m{font-size:13px;color:#8A8898;}
.tlcb-sermon-all{font-size:13px;color:#2E7EA6;text-decoration:none;font-weight:600;}
.tlcb-news{display:flex;align-items:baseline;gap:14px;padding:11px 13px;border:1px solid #DDE3ED;border-radius:8px;background:#F7F3EC;}
.tlcb-news-d{flex:none;width:56px;font:700 12px/1.4 var(--tlcb-ui);color:#8A8898;letter-spacing:.03em;}
.tlcb-news-t{flex:1;font:600 13.5px/1.35 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-nf-list{display:flex;flex-direction:column;gap:10px;}
.tlcb-nf-item{background:#fff;border:1px solid #E4E0D4;border-radius:18px;overflow:hidden;}
.tlcb-nf-item summary{list-style:none;cursor:pointer;padding:15px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px;}
.tlcb-nf-item summary::-webkit-details-marker{display:none;}
.tlcb-nf-head{display:flex;flex-direction:column;gap:3px;min-width:0;}
.tlcb-nf-pin{align-self:flex-start;font:800 10px/1.4 var(--tlcb-ui);letter-spacing:.14em;text-transform:uppercase;color:#C9973A;}
.tlcb-nf-date{font:600 12px/1.4 var(--tlcb-ui);letter-spacing:.08em;text-transform:uppercase;color:#8A8898;}
.tlcb-nf-title{font-family:var(--tlcb-serif);font-weight:700;font-size:19px;line-height:1.2;letter-spacing:-.01em;color:#1E2D4A;}
.tlcb-nf-chev{flex:none;width:12px;height:12px;border-right:2px solid #8A8898;border-bottom:2px solid #8A8898;transform:rotate(45deg);transition:transform .15s;}
.tlcb-nf-item[open] .tlcb-nf-chev{transform:rotate(-135deg);}
.tlcb-nf-body{padding:0 18px 18px;}
.tlcb-nf-body img{width:100%;max-height:340px;object-fit:contain;background:#F7F3EC;border-radius:8px;margin-bottom:12px;}
.tlcb-nf-body p{font-size:14px;line-height:1.7;color:#3A3A4A;margin:0 0 8px;}
.tlcb-nl-list{display:flex;flex-direction:column;gap:10px;}
.tlcb-nl-item{background:#fff;border:1px solid #E4E0D4;border-radius:12px;padding:20px;}
.tlcb-nl-date{display:block;font:700 11px/1.4 var(--tlcb-ui);letter-spacing:.06em;text-transform:uppercase;color:#C9973A;margin-bottom:4px;}
.tlcb-nl-subj{display:block;font-family:var(--tlcb-serif);font-size:19px;color:#1E2D4A;margin-bottom:8px;}
.tlcb-nl-note{font-size:14px;line-height:1.7;color:#6A6858;margin:0 0 10px;}
.tlcb-nl-link{font:700 13px var(--tlcb-ui);color:#2E7EA6;text-decoration:none;}
.tlcb-nl-row{display:flex;align-items:baseline;gap:14px;padding:10px 13px;border:1px solid #E4E0D4;border-radius:8px;text-decoration:none;}
.tlcb-nl-row-d{flex:none;width:64px;font:700 11px/1.4 var(--tlcb-ui);color:#8A8898;letter-spacing:.03em;}
.tlcb-nl-row-t{flex:1;font:600 13.5px/1.35 var(--tlcb-ui);color:#1E2D4A;}
/* A closed month reads as one row, the same weight as a letter row, so the
   list stays a list rather than becoming a stack of panels. */
.tlcb-nl-month{border:1px solid #E4E0D4;border-radius:8px;background:#fff;}
.tlcb-nl-msum{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 13px;cursor:pointer;font:700 13px/1.35 var(--tlcb-ui);color:#1E2D4A;list-style:none;}
.tlcb-nl-msum::-webkit-details-marker{display:none;}
/* The caret is drawn here and turns on open, so the control says which way it
   goes without needing a word for it. */
.tlcb-nl-msum::after{content:'';flex:none;width:7px;height:7px;border-right:2px solid #8A8898;border-bottom:2px solid #8A8898;transform:rotate(45deg);margin-right:3px;transition:transform .15s;}
.tlcb-nl-month[open] > .tlcb-nl-msum::after{transform:rotate(-135deg);}
.tlcb-nl-mcount{margin-left:auto;font:700 11px/1 var(--tlcb-ui);color:#6A6858;background:#F2EFE7;border-radius:999px;padding:4px 8px;}
.tlcb-nl-mlist{display:flex;flex-direction:column;gap:8px;padding:0 13px 13px;}
/* Inside a month the rows are already fenced by the month's own border, so a
   second border on each one reads as a box in a box. */
.tlcb-nl-mlist .tlcb-nl-row{border:0;padding:7px 0;border-top:1px solid #EFEBE1;border-radius:0;}
.tlcb-people{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
.tlcb-person{display:flex;flex-direction:column;gap:6px;}
/* The tile clips, the photo fills it. overflow:hidden is what keeps a zoomed
   face inside its own tile instead of spilling over the name beside it. */
.tlcb-person-p{aspect-ratio:1/1;border-radius:9px;background:#DDE3ED;overflow:hidden;
  position:relative;display:block;}
.tlcb-person-p img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.tlcb-person-n{font:600 13.5px/1.3 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-person-r{font-size:12px;color:#8A8898;}
.tlcb-map{min-height:230px;overflow:hidden;}
.tlcb-map-f{width:100%;height:100%;min-height:230px;border:0;display:block;}
.tlcb-map-ph{color:#8A8898;font-size:13px;}
.tlcb-addr{display:flex;flex-direction:column;gap:3px;font-size:13.5px;color:#4A4860;}
/* The half-width map: one card carrying the address, the link out and the map
   beneath. Same card geometry as everything else on a page — 12 radius, the
   sand edge — so it reads as part of the site rather than as a widget. */
.tlcb-mapc{background:#FFFDF9;border:1px solid #E7DFD1;border-radius:12px;padding:22px 22px 18px;
  display:flex;flex-direction:column;gap:7px;}
.tlcb-mapc-name{font:700 15px/1.4 var(--tlcb-sans);color:#1E2D4A;}
.tlcb-mapc-line{font:400 14px/1.5 var(--tlcb-sans);color:#4A4860;}
.tlcb-mapc-link{font:700 14px/1.5 var(--tlcb-sans);color:#2E7EA6;text-decoration:none;margin-top:3px;}
.tlcb-mapc-link:hover{text-decoration:underline;}
/* The map sits inside the card's padding rather than bleeding to its edges —
   the screenshot shows the card's cream around it on all four sides. */
.tlcb-mapc-frame{margin-top:11px;border-radius:8px;overflow:hidden;min-height:300px;}
.tlcb-mapc-frame .tlcb-map-f{min-height:300px;}
.tlcb-stamp{position:absolute;z-index:4;bottom:14px;padding:7px 15px;border-radius:7px;
  font:700 13px/1.3 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;
  box-shadow:0 5px 16px rgba(30,45,74,.3);white-space:nowrap;}
.tlcb-stamp--tl{left:10px;right:auto;transform:rotate(-8deg);}
.tlcb-stamp--tr{right:10px;left:auto;transform:rotate(8deg);}
.tlcb-stamp--bc{left:50%;right:auto;transform:translateX(-50%) rotate(-6deg);}
.tlcb-stamp--lg{font-size:26px;padding:16px 32px;border-radius:11px;}
.tlcb-stamp--pulse{animation:tlcb-stamp-pulse 1.5s ease-in-out infinite;}
@keyframes tlcb-stamp-pulse{0%,100%{opacity:1;box-shadow:0 5px 16px rgba(30,45,74,.3);}
  50%{opacity:.82;box-shadow:0 7px 26px 5px rgba(30,45,74,.55);}}
.tlcb-empty{margin:40px;padding:52px 28px;border:2px dashed #C4CEDF;border-radius:12px;text-align:center;
  display:flex;flex-direction:column;gap:8px;}
.tlcb-empty b{font:500 22px/1.2 Lora,Georgia,serif;color:#1E2D4A;font-weight:500;}
.tlcb-empty span{font-size:13.5px;color:#8A8898;}
/* Page layouts. The template owns the wrapper only — it never touches a block,
   so switching layout can never drop content. */
.tlcb-layout{display:grid;grid-template-columns:1fr 300px;gap:32px;align-items:start;
  max-width:var(--tlcb-wrap,none);margin:0 auto;padding:0 var(--tlcb-pad);}
.tlcb-layout-main{min-width:0;display:flex;flex-direction:column;}
.tlcb-side{position:sticky;top:16px;display:flex;flex-direction:column;gap:14px;}
.tlcb-side-card{border:1px solid #DDE3ED;border-radius:11px;background:#FBF8F3;padding:18px;
  display:flex;flex-direction:column;gap:10px;}
.tlcb-side-h{font:700 11px/1.4 var(--tlcb-ui);letter-spacing:.12em;text-transform:uppercase;
  color:#8A8898;margin:0;}
.tlcb-side .tlcb-svc{padding:10px 12px;}
.tlcb-side .tlcb-svc-t{font-size:18px;}
.tlcb-side-lines{display:flex;flex-direction:column;gap:5px;font-size:calc(13.5px * var(--tlcb-scale, 1));color:#4A4860;line-height:1.5;}
.tlcb-side-lines a{color:#2E7EA6;}
/* The pages beneath a section, in the aside. Rows rather than a bulleted list:
   these are destinations, and a row with its own hit area is easier to hit than
   a line of text — the same reasoning the phone tap-target pass applied to the
   footer. */
.tlcb-side-kids{display:flex;flex-direction:column;}
.tlcb-side-kids a,.tlcb-side-kids span{display:block;padding:9px 0;font-family:var(--tlcb-sans);
  font-size:calc(14px * var(--tlcb-scale, 1));line-height:1.35;color:#2E7EA6;text-decoration:none;
  border-bottom:1px solid var(--tlcb-rule,#E7DFD1);}
.tlcb-side-kids a:last-child,.tlcb-side-kids span:last-child{border-bottom:0;padding-bottom:0;}
.tlcb-side-kids a:hover{text-decoration:underline;}
.tlcb-side-kids span{color:#4A4860;}
.tlcb-kids{max-width:var(--tlcb-wrap,none);margin:0 auto;padding:8px var(--tlcb-pad) 32px;
  display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;}
.tlcb-kid{display:flex;flex-direction:column;gap:5px;padding:16px 18px;border:1px solid #DDE3ED;
  border-radius:11px;background:#FBF8F3;text-decoration:none;}
.tlcb-kid-t{font-family:var(--tlcb-serif);font-weight:700;font-size:17px;color:#1E2D4A;line-height:1.25;}
.tlcb-kid-d{font-size:13px;color:#6A6858;line-height:1.5;}

/* ── THE REDESIGN'S FOUR OWN SHAPES ───────────────────────────────────────
   Everything above is a primitive every block type shares. These four are the
   shapes nothing already here could make. */

/* PHOTO BANNER. Full-bleed, three heights, and readable with no photograph at
   all — which is the state it will be in until the church supplies some. The
   background is the block's own surface (ink navy by default), so a banner
   with no picture is a flat navy field rather than a gray hole; the photo,
   when there is one, is layered over it and the veil over that. */
.tlcb-pb{position:relative;overflow:hidden;display:flex;align-items:flex-end;
  min-height:var(--tlcb-pb-h,520px);padding:44px;border-radius:0;
  background:var(--tlcb-bg,#101B2E) var(--tlcb-pb-img,none) center/cover no-repeat;}
.tlcb-pb--short{--tlcb-pb-h:420px;}
.tlcb-pb--mid{--tlcb-pb-h:520px;}
.tlcb-pb--tall{--tlcb-pb-h:640px;}
.tlcb-pb-veil{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(180deg,rgba(16,27,46,var(--tlcb-pb-top,.72)) 0%,rgba(16,27,46,.16) 42%,rgba(16,27,46,.89) 100%);}
.tlcb-pb-glow{position:absolute;inset:0;pointer-events:none;background:var(--tlcb-pb-glow,none);}
.tlcb-pb-body{position:relative;z-index:1;display:flex;flex-direction:column;align-items:flex-start;width:100%;}
.tlcb-pb-eyebrow{display:flex;align-items:center;gap:10px;margin-bottom:16px;}
.tlcb-pb-eyebrow-t{font:800 12px/1 var(--tlcb-ui);letter-spacing:.16em;text-transform:uppercase;
  color:var(--tlcb-eyebrow-ink,#E4A93C);}
/* 64px is the design's own figure and it is not derived from the block's text
   size: this is the one place on the site set at display scale, and tying it
   to the S/M/L control would make S produce a 30px hero. It comes down on a
   phone in the media query at the foot of this stylesheet. */
.tlcb-pb-title{font-family:var(--tlcb-serif);font-weight:800;font-size:64px;line-height:.98;
  letter-spacing:-.03em;color:#fff;margin:0;max-width:19em;}
.tlcb-pb--card .tlcb-pb-title{font-size:56px;}
.tlcb-pb-foot{display:flex;align-items:flex-end;gap:34px;margin-top:26px;flex-wrap:wrap;}
.tlcb-pb-count-l{display:block;font:800 11px/1 var(--tlcb-ui);letter-spacing:.16em;text-transform:uppercase;
  color:rgba(255,255,255,.6);margin-bottom:8px;}
/* Tabular figures, so the seconds place does not shove the whole line sideways
   every time it ticks. */
.tlcb-pb-count-v{font-family:var(--tlcb-serif);font-weight:700;font-size:34px;line-height:1;color:#fff;
  font-variant-numeric:tabular-nums;}
.tlcb-pb-sub{font-size:18px;font-weight:300;line-height:1.55;color:rgba(255,255,255,.82);max-width:26em;margin:0;}

/* THE STANDOUT CARD, and the Service times tiles — ONE set of rules. The
   handoff calls the standout card "the service-times tile made general", so
   they share this by construction rather than by two copies that agree today. */
.tlcb-tile{display:flex;flex-direction:column;align-items:flex-start;gap:8px;
  border-radius:22px;padding:34px 32px;height:100%;
  background:var(--tlcb-bg,#101B2E);box-shadow:0 18px 44px rgba(16,27,46,.14);}
.tlcb-tile-big{font-family:var(--tlcb-serif);font-weight:800;font-size:56px;line-height:1;
  letter-spacing:-.03em;color:var(--tlcb-head-ink,#fff);}
.tlcb-tile-big:empty{display:none;}
.tlcb-tile-t{font-family:var(--tlcb-serif);font-weight:700;font-size:calc(var(--tlcb-head,22px) * .74);
  line-height:1.15;letter-spacing:-.01em;color:var(--tlcb-head-ink,#fff);}
.tlcb-tile-t:empty{display:none;}
.tlcb-tile .tlcb-prose{margin-top:2px;}
/* The two service tiles, side by side, using the same card. */
.tlcb-tiles2{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:stretch;}
/* ⚠ Meeting times and Info tiles hold HOWEVER MANY somebody types, not two, so
   they cannot use the pair grid above — three groups in a two-column grid is a
   lone tile on a second row. auto-fit fills the width and wraps on its own,
   and 240px is the narrowest a tile reads at with 32px of padding inside it. */
.tlcb-tiles-n{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;align-items:stretch;}
.tlcb-tile-m{font-family:var(--tlcb-ui);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:var(--tlcb-eyebrow-ink,#C9973A);margin-top:auto;padding-top:10px;}
.tlcb-tile-m:empty{display:none;}

/* THE CALL-TO-ACTION BAND. One ask, ending in a button. */
.tlcb-cta{display:flex;align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap;}
.tlcb-cta-b{flex:1;min-width:min(100%,340px);display:flex;flex-direction:column;gap:10px;align-items:flex-start;}
.tlcb--center .tlcb-cta{justify-content:center;text-align:center;}
.tlcb--center .tlcb-cta-b{align-items:center;}

/* THE EMAIL SIGNUP BAND. */
.tlcb-signup{align-items:flex-start;}
.tlcb--center .tlcb-signup{align-items:center;}
.tlcb-signup .tlcb-inline{margin-top:6px;}

/* THE FOUR CORE VALUES. Each card is its own gradient field — the one place
   in this language where a hue other than navy or gold is allowed.
   ⚠ A PHOTO REPLACES THE FIELD, NOT ADDS TO IT — exactly the Hero block's own
   mechanism (--tlcb-hero-img / --tlcb-hero-veil), reused rather than invented
   twice. The photo variable is only ever emitted by the renderer when a value
   has an uploaded photo; absent, the fallback falls through to the gradient
   exactly as it always rendered. The veil is a FIXED dark wash, not a
   translucent version of each value's own hue — deriving one from four
   different brand colors is a second design decision nobody asked for, and a
   flat dark veil is legible under any of the four regardless of what a photo
   itself contains. */
.tlcb-vals{display:grid;grid-template-columns:var(--tlcb-cols,repeat(4,1fr));gap:20px;align-items:stretch;}
.tlcb-val{position:relative;display:flex;flex-direction:column;gap:6px;border-radius:22px;padding:30px 26px;
  background:var(--v-photo,var(--v-field)) center/cover;color:var(--v-ink);box-shadow:0 18px 44px rgba(16,27,46,.16);
  overflow:hidden;}
.tlcb-val::before{content:'';position:absolute;inset:0;
  background:linear-gradient(165deg,rgba(8,12,22,.34),rgba(8,12,22,.64));opacity:var(--v-veil,0);}
.tlcb-val > *{position:relative;z-index:1;}
/* Newsreader italic at display size — the word is the thing on this card. */
.tlcb-val-word{font-family:var(--tlcb-sans);font-style:italic;font-weight:400;font-size:44px;
  line-height:1;letter-spacing:-.01em;color:var(--v-head);}
.tlcb-val-sub{font:800 11px/1.4 var(--tlcb-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--v-label);}
/* The rule fades out of the accent rather than stopping — same gesture as the
   info card's gold line. */
.tlcb-val-rule{height:2px;margin:10px 0 4px;background:linear-gradient(90deg,var(--v-accent),transparent);}
.tlcb-val-tag{font-family:var(--tlcb-sans);font-style:italic;font-weight:300;font-size:17px;line-height:1.45;color:var(--v-ink);}
.tlcb-val-ways{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin-top:14px;}
.tlcb-val-way{display:flex;flex-direction:column;gap:2px;}
.tlcb-val-wt{font:800 10.5px/1.3 var(--tlcb-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--v-head);}
.tlcb-val-wb{font-size:13.5px;font-weight:300;line-height:1.5;color:var(--v-ink);}
/* ⚠ A DARK wash, never a white one. A white wash lightens the surface the
   white text is sitting on, and white fails. The handoff is explicit. */
.tlcb-val-partner{margin-top:auto;padding:14px 16px;border-radius:14px;background:rgba(16,27,46,.18);
  display:flex;flex-direction:column;gap:3px;}
.tlcb-val-pn{font:800 11px/1.35 var(--tlcb-ui);letter-spacing:.06em;color:var(--v-head);}
.tlcb-val-pb{font-size:13px;font-weight:300;line-height:1.5;color:var(--v-ink);}

/* QUOTE BAND. No box and no border — the opposite gesture from Callout. */
.tlcb-quote{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;}
.tlcb-quote-q{font-family:var(--tlcb-sans);font-style:italic;font-weight:400;font-size:30px;line-height:1.35;
  color:var(--tlcb-head-ink,#101B2E);border-left:3px solid var(--tlcb-eyebrow-ink,#E4A93C);
  padding-left:26px;margin:0;}
.tlcb-quote-b{font-size:calc(var(--tlcb-body,15px) * 1.15);font-weight:300;line-height:1.75;color:var(--tlcb-ink,#453F30);}

/* COMING-UP STRIP. One line, read on the way past. */
.tlcb-chips{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  border-bottom:1px solid var(--tlcb-rule,#E7DFCD);padding-bottom:16px;}
.tlcb-chips-l{font:800 11px/1 var(--tlcb-ui);letter-spacing:.16em;text-transform:uppercase;
  color:var(--tlcb-meta,#8A8168);flex:none;}
.tlcb-chip-row{display:flex;gap:10px;flex-wrap:wrap;}
/* ⚠ Qualified for the same reason as the Give button's chip above — see the
   note there. This one is the Coming-up strip's pill and lives inside
   .tlcb-chip-row; that one lives inside .tlcb-give. Neither selector can now
   reach the other's markup. */
.tlcb-chip-row .tlcb-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--tlcb-rule,#D8CFBB);
  border-radius:999px;padding:9px 16px;background:var(--tlcb-chip-bg,#F5F0E6);white-space:nowrap;}
.tlcb-chip-d{font:800 12px/1 var(--tlcb-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--tlcb-eyebrow-ink,#B44A2E);}
.tlcb-chip-t{font:600 14px/1 var(--tlcb-ui);color:var(--tlcb-head-ink,#1B2C4A);}

/* WEEKLY LETTER. This week argued for on the left, the back issues listed on
   the right — rather than the archive's vertical column, which is a different
   block for a different job. */
.tlcb-lt{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center;}
.tlcb-lt-b{display:flex;flex-direction:column;gap:14px;align-items:flex-start;}
.tlcb-lt-list{display:flex;flex-direction:column;}
.tlcb-lt-row{display:flex;justify-content:space-between;gap:14px;padding:15px 0;text-decoration:none;
  border-bottom:1px solid var(--tlcb-rule,rgba(245,240,230,.14));}
.tlcb-lt-s{font-size:16px;font-weight:600;line-height:1.3;color:var(--tlcb-head-ink,#F5F0E6);}
.tlcb-lt-d{font:600 12px/1.5 var(--tlcb-ui);letter-spacing:.08em;text-transform:uppercase;
  color:var(--tlcb-ink,rgba(245,240,230,.5));white-space:nowrap;}

/* ── THE THINGS THAT MOVE ─────────────────────────────────────────────────
   Motion was a third of the brief, alongside the photography and the type:
   the site read as dead, and a page where nothing has ever moved reads as a
   printout. There are exactly three movements and they are all small — a
   photo that pushes in under the cursor, a card that rises toward it, and one
   dot that breathes to say something is imminent.

   ⚠ ALL THREE ARE GATED ON prefers-reduced-motion, which the mocks did not do
   and the handoff says in as many words to add. That setting is not a taste
   preference: for somebody with a vestibular disorder, motion they did not
   ask for causes actual nausea, and this is a church website that people open
   because they are looking for help. The query tests for the reduce value
   rather than for no-preference, so a browser that has never heard of it
   still gets the animation. (No backticks in this comment — it lives inside a
   template literal and one ends the string. See CLAUDE.md; this is the fourth
   time.) */
.tlcb-pulse{width:9px;height:9px;border-radius:50%;background:#E4A93C;display:inline-block;flex:none;
  animation:tlcb-pulse 1.8s ease-in-out infinite;}
@keyframes tlcb-pulse{0%,100%{opacity:1}50%{opacity:.35}}
/* The standalone Countdown block's own label and number. The banner's
   countdown is white-on-photo and cannot be reused as-is; these read the
   block's own ink and eyebrow colors so they work on any of the ten
   backgrounds, not just a dark photo field. */
.tlcb-cd-l{font:800 11px/1 var(--tlcb-ui);letter-spacing:.16em;text-transform:uppercase;
  color:var(--tlcb-eyebrow-ink,#C9973A);}
.tlcb-cd-v{font-family:var(--tlcb-serif);font-weight:700;font-size:28px;line-height:1;
  color:var(--tlcb-head-ink,#1E2D4A);font-variant-numeric:tabular-nums;}
@media(prefers-reduced-motion:reduce){
  .tlcb-pulse{animation:none;}
  .tlcb-stamp--pulse{animation:none;}
  .tlcb-media img,.tlcb-cg-card{transition:none;}
  .tlcb-media:hover img{transform:none;}
  .tlcb-cg-card--link:hover{transform:none;}
}
@media(max-width:640px){
PHONE_RULES_PLACEHOLDER
  .tlcb-hide-phone{display:none!important;}
}
`.replace('PHONE_RULES_PLACEHOLDER', phoneRules(''));

// The inline form, unchanged, for every caller that wants the bytes in the
// document — renderPage(withCss) and anything rendering outside a page that can
// link to the asset route.
export const BLOCK_CSS = `<style id="tlcb-css">\n${BLOCK_CSS_RAW}\n</style>`;

// ⚠ THE SAME id THE INLINE TAG CARRIES. tlcEnsureBlockCss() and
// tlcTakeOverPage() in public/index.html both ask `getElementById('tlcb-css')`
// whether the stylesheet is already here; a <link> answers that question just
// as well as a <style>, which is the only reason this swap is invisible to
// them. Change the id in one place and the client silently injects a second
// copy on every navigation.
export const blockCssLink = (version) =>
  `<link id="tlcb-css" rel="stylesheet" href="https://admin.timothystl.org/assets/blocks.css?v=${encodeURIComponent(version || '0')}">`;

// What "phone" does to a block layout, written once. The public page applies it
// through a media query; the editor applies the identical rules to the paper
// when the Phone device tab is active, since there the viewport is still wide.
// Sharing the text is the point — a phone preview that lies is worse than none.
function phoneRules(p) {
  return [
    `${p}.tlcb-grid,${p}.tlcb-cols{grid-template-columns:1fr!important;}`,
    // A 4-up of cards is still readable two across on a tablet; a 3-up is not,
    // because each card keeps its padding and the text column collapses.
    `${p}.tlcb-cg-grid{grid-template-columns:1fr!important;}`,
    // Halves stack full width in source order. ⚠ The pair is a CSS GRID, not
    // columns — a column-count rule here would be a silent no-op, and halves
    // would render as two side-by-side tracks on a 390px phone.
    // grid-template-columns is the property the pair actually uses, so it is
    // the one that stacks it: with one column, the second half wraps to its
    // own row automatically.
    `${p}.tlcb-pair{grid-template-columns:1fr!important;}`,
    // ⚠ The ONE exception to "halves stack in source order", and it is about
    // money rather than taste. On the giving page the ladder sits left and the
    // widget right, so stacking in source order buries the actual Give button
    // under the whole case for giving — somebody who arrived to give has to
    // scroll past the argument to reach the button. #400 fixed exactly this in
    // the hardcoded page (`.widget-col{order:-1}`); without this rule,
    // publishing the block version would quietly undo that fix.
    //
    // Scoped to the giving widget, which only ever appears on that one page,
    // rather than reversing pairs generally — every other pair on the site
    // reads correctly top-to-bottom and must keep doing so.
    `${p}.tlcb-pair > .tlcb--giving{order:-1!important;}`,
    `${p}.tlcb-media{order:0!important;}`,
    `${p}.tlcb-cards{grid-template-columns:1fr!important;}`,
    `${p}.tlcb-gallery{grid-template-columns:1fr 1fr!important;}`,
    `${p}.tlcb-logos{grid-template-columns:1fr 1fr!important;}`,
    `${p}.tlcb-tiles{grid-template-columns:1fr 1fr!important;}`,
    `${p}.tlcb-svcs{grid-template-columns:1fr!important;}`,
    `${p}.tlcb-people{grid-template-columns:1fr 1fr!important;}`,
    `${p}.tlcb-sermon{grid-template-columns:1fr!important;}`,
    `${p}.tlcb-sermon-play{order:0!important;}`,
    `${p}.tlcb-slide{padding:40px 22px!important;min-height:0!important;}`,
    `${p}.tlcb-slide-title{font-size:calc(var(--tlcb-hero,38px) * .74)!important;}`,
    `${p}.tlcb-time{grid-template-columns:1fr!important;gap:2px;}`,
    `${p}.tlcb-hero-title{font-size:calc(var(--tlcb-hero,38px) * .74)!important;}`,
    `${p}.tlcb-layout{grid-template-columns:1fr!important;}`,
    `${p}.tlcb-side{position:static!important;}`,
    `${p}.tlcb-kids{grid-template-columns:1fr!important;}`,
    // The info card stacks under the banner text at full width rather than
    // squeezing a 320px card and a headline into one narrow row.
    `${p}.tlcb-band--card{grid-template-columns:1fr!important;}`,
    `${p}.tlcb-band--card-left .tlcb-band-text{order:0!important;}`,
    `${p}.tlcb-band--card-left .tlcb-card{order:1!important;}`,
    `${p}aside.tlcb-card{padding:24px 22px!important;}`,
    // The redesign's own shapes. ⚠ The banner heights come down as well as the
    // headline: 640px of photograph on a 390px phone is most of the screen
    // before a word is read, and the design's own responsive note says so.
    // ⚠ The contact block's label column collapses. 96px beside a value in a
    // 390px screen leaves about 200px, which wraps an email across three lines.
    // Stacked, the label sits above its value and both get the full width.
    `${p}.tlcb-ct-row{grid-template-columns:1fr!important;gap:1px!important;}`,
    `${p}.tlcb-ct-row--sub .tlcb-ct-l{display:none!important;}`,
    `${p}.tlcb-pb{padding:26px 22px!important;}`,
    `${p}.tlcb-pb--short{--tlcb-pb-h:300px!important;}`,
    `${p}.tlcb-pb--mid{--tlcb-pb-h:360px!important;}`,
    `${p}.tlcb-pb--tall{--tlcb-pb-h:420px!important;}`,
    `${p}.tlcb-pb-title,${p}.tlcb-pb--card .tlcb-pb-title{font-size:36px!important;}`,
    `${p}.tlcb-pb-foot{gap:18px!important;}`,
    `${p}.tlcb-quote,${p}.tlcb-lt{grid-template-columns:1fr!important;gap:26px!important;}`,
    `${p}.tlcb-vals,${p}.tlcb-tiles2{grid-template-columns:1fr!important;}`,
    `${p}.tlcb-val-ways{grid-template-columns:1fr!important;}`,
    `${p}.tlcb-quote-q{font-size:23px!important;}`,
    // The strip shows what fits and scrolls sideways for the rest rather than
    // wrapping to four lines and pushing the page down.
    `${p}.tlcb-chips{flex-wrap:nowrap!important;overflow-x:auto!important;}`,
    `${p}.tlcb-card-1{font-size:21px!important;}`,
  ].join('\n  ');
}

// Editor-only: the same phone layout, scoped to the paper instead of the
// viewport, plus the "hidden on phone" reminder treatment (dimmed, not removed).
export function editorPhoneCss() {
  return phoneRules('.ed-paper--phone ') + '\n.ed-paper--phone .tlcb-hide-phone{opacity:.4;}';
}

// Everything the editor client needs to draw the rail, palette and inspector,
// derived from the definitions above rather than restated in the editor page.
// `data` is the same bundle renderPage gets. Only the partner list is read out
// of it, and only so the inspector can offer real partners to tick rather than
// a text field to retype their names into.
export function blocksClientConfig(data) {
  const types = {};
  for (const [key, d] of Object.entries(BLOCK_DEFS)) {
    types[key] = {
      label: d.label, glyph: d.glyph,
      photo: !!d.photo, video: !!d.video, url: !!d.url, urlLabel: d.urlLabel || '',
      items: !!d.items, itemFields: d.itemFields || [], itemLabel: d.itemLabel || 'Row',
      auto: d.auto || '', autoNote: d.autoNote || '', autoCount: d.auto ? d.autoCount !== false : false,
      itemPlaceholders: d.itemPlaceholders || {}, richItemFields: d.richItemFields || [],
      itemUrlFields: d.itemUrlFields || [], itemImageFields: d.itemImageFields || [], itemFileFields: d.itemFileFields || [],
      richBody: !!d.richBody, align: !!d.align,
      gallery: !!d.gallery, feed: d.feed || '', infoCard: !!d.infoCard,
      shadow: SHADOWABLE_TYPES.has(key), contactEmail: !!d.contactEmail, giveFund: !!d.giveFund, eventRef: !!d.eventRef,
      newsRef: !!d.newsRef,
      shade: SHADEABLE_TYPES.has(key), appear: APPEARABLE_TYPES.has(key), btn: BTN_TYPES.has(key),
      partnerSource: !!d.partnerSource, embedGate: !!d.embedGate,
      choices: d.choices || [], switches: d.switches || [],
      defaults: d.defaults || {}, defaultItems: d.defaultItems || [],
    };
  }
  return { types, groups: GROUPS, templates: TEMPLATES, BG, INK, SIZES, SPLITS, TONES, SHADOWS, SHADES, APPEARS, BTNS,
    bannerHeights: BANNER_HEIGHTS, veils: VEILS, glows: GLOWS, imgPositions: IMG_POSITIONS, embedHeights: EMBED_HEIGHTS,
    partners: (data && data.partners) || [],
    // Just the one field, so the Contact block's inspector can name the address
    // it is falling back to rather than saying "the church email" and making
    // somebody go and look. The rest of the record is not shipped — nothing in
    // the inspector reads it, and the renderer gets it from ctx.data anyway.
    churchEmail: (data && data.settings && data.settings.email) || '',
    // Name and id only. The inspector offers these to pick from; the Tithe.ly
    // id stays server-side, because nothing in the editor has any business
    // holding one — see the Give block's render branch.
    giveFunds: ((data && data.give && data.give.funds) || []).map((f) => ({ id: f.id, name: f.name })),
    // Name and id only, same reasoning as giveFunds above — the inspector
    // offers these to pick a `registration` block's event from; everything
    // that event actually costs or asks for is resolved server-side at
    // render time, never here.
    events: ((data && data.eventsById) ? Object.values(data.eventsById) : []).map((e) => ({ id: e.id, name: e.name })),
    // Every dated News & Events post, soonest first — what the Countdown
    // block's picker offers. Same shape as `events` above: id and a label
    // only, nothing the render branch does not already read from ctx.data
    // itself. Sorted here so the picker and the block's own "automatic"
    // fallback (upcoming()[0] in renderInner) agree about which one is next.
    upcomingNews: ((data && data.news) || [])
      .filter((n) => n.event_date)
      .slice()
      .sort((a, b2) => String(a.event_date).localeCompare(String(b2.event_date)))
      .map((n) => ({ id: n.id, title: n.title, date: fmtNewsDate(n.event_date, true) })),
    cardSides: CARD_SIDES, cardShows: CARD_SHOWS, starters: STARTERS.map((s) => ({ key: s.key, label: s.label, note: s.note })),
    stamps: STAMP_PRESETS, stampSizes: STAMP_SIZES, step: SPACE_STEP, max: SPACE_MAX,
    // The allowlist itself, so the inspector can name what is and is not
    // embeddable BEFORE somebody saves and finds out the address was
    // dropped — one list, read by the sanitizer and shown on the screen,
    // rather than a second copy typed into the editor that could drift.
    embedHosts: EMBED_HOSTS };
}

// ── RENDERING ────────────────────────────────────────────────────────────────

// ⚠ calendarSrc() USED TO LIVE HERE and is deliberately gone. It wrote the
// height Google needs into a Google Calendar embed address — because Google
// lays its month grid out to the height in the URL rather than to the box.
// No Google Calendar address can reach an iframe any more: the Calendar block
// treats one as the CHURCH calendar and renders the site's own month instead
// (see the `calendar` branch in renderBlock). So the function could only ever
// have been code that looked live and did nothing, which is the one thing this
// repo keeps having to delete. Its browser mirror, tlcCalSrc() in
// public/index.html, went with the embeds it served.

const sizeOf = (b) => SIZES.find((s) => s.key === b.size) || SIZES[1];
const shadeOf = (b) => (SHADES.find((s) => s.key === b.shade) || SHADES[0]).css;
const btnOf = (b) => BTNS.find((x) => x.key === b.btn && x.key !== 'default');
const splitOf = (b) => SPLITS.find((s) => s.key === b.split) || SPLITS[1];

// A URL going into a CSS url() inside a style="" attribute has two escape
// contexts stacked (HTML attribute, then CSS string). Rather than reason about
// both, strip every character that could close either one — a legitimate image
// URL never contains them.
const cssUrl = (u) => String(u || '').replace(/["'\\()\s<>;{}]/g, '');

// ── A STAFF PHOTO'S CROP ─────────────────────────────────────────────────────
// The Staff screen lets somebody drag a face into place and zoom in, and stores
// the result as an `object-position` pair and a `transform: scale()` factor.
// Every other staff photo on the site honors it; the Staff grid block did not,
// so a face sat differently on a published page than in the admin that framed
// it — a portrait cropped through the forehead, with no setting on the page to
// explain why.
//
// ⚠ BOTH VALUES GO STRAIGHT INTO A STYLE ATTRIBUTE, so neither is trusted: the
// position has to match the exact shape the picker writes, and the zoom is a
// number clamped to the range the slider offers. Anything else is the default
// framing rather than a guess. `tlc-admin-worker.js` imports these two rather
// than keeping the copies it used to have — one definition, so the admin's own
// preview and the public page cannot come to disagree about a crop.
export const isSafeObjectPosition = (v) => typeof v === 'string' && /^\d{1,3}% \d{1,3}%$/.test(v);

export function safeZoomFactor(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2.5, Math.max(1, n));
}

// news_items/newsletters store plain ISO dates (no time). Reading it back at
// noon local time, the same convention the rest of the site uses for these
// dates, is what stops a date-only value drifting a day in either direction
// across a timezone boundary.
function fmtNewsDate(iso, short) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return short
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function wrapperVars(b) {
  const sz = sizeOf(b);
  const sp = splitOf(b);
  const bg = BG[b.bg] || BG[0];
  const ink = INK[b.ink] || INK[0];
  const cols = b.side === 'above' ? '1fr' : (b.side === 'right' ? sp.b + ' ' + sp.a : sp.a + ' ' + sp.b);
  const v = [
    // The gradient when the surface has one, the flat color otherwise. Both
    // land on --tlcb-bg because every rule that paints a block already says
    // `background:`, which takes an image as happily as a color.
    // ⚠ SHADING LAYERS OVER WHATEVER IS ALREADY THERE rather than replacing
    // it, so the four authored gradients keep their own shape and the six flat
    // surfaces gain one. An image may be listed before a color in `background`,
    // which is why this composes cleanly in both cases.
    '--tlcb-bg:' + (shadeOf(b) ? shadeOf(b) + ',' + (bg.grad || bg.c) : (bg.grad || bg.c)),
    '--tlcb-bg-flat:' + bg.c,
    '--tlcb-ink:' + ink.c,
    // The composed half of a background. The four redesign surfaces carry
    // their own heading ink, eyebrow, link and hairline because in that
    // language those move together with the background — see the note on BG.
    // Every older surface falls back to exactly what it has always emitted,
    // so nothing on an existing page shifts by a pixel.
    '--tlcb-head-ink:' + (bg.head || (bg.dark ? '#F3EDE1' : '#1E2D4A')),
    '--tlcb-eyebrow-ink:' + (bg.eyebrow || '#C9973A'),
    '--tlcb-link-ink:' + (bg.link || '#2E7EA6'),
    '--tlcb-rule:' + (bg.rule || (bg.dark ? 'rgba(245,240,230,.14)' : '#E7DFD1')),
    '--tlcb-chip-bg:' + (bg.chip || 'rgba(0,0,0,.04)'),
    // ⚠ calc() against the PAGE's scale, not a number baked in here. The scale
    // lives on the page wrapper (see pageFontVars) because it comes from the
    // appearance record, which wrapperVars has no access to — and because a
    // block that stored its own copy would keep the old size after somebody
    // changed it. Absent means 1, which is the size the block has always drawn.
    '--tlcb-body:calc(' + sz.body + 'px * var(--tlcb-scale, 1))',
    '--tlcb-head:calc(' + sz.head + 'px * var(--tlcb-head-scale, 1))',
    '--tlcb-hero:calc(' + sz.hero + 'px * var(--tlcb-head-scale, 1))',
    '--tlcb-gap:' + b.gap + 'px',
    '--tlcb-height:' + b.height + 'px',
    '--tlcb-media-order:' + (b.side === 'right' ? 2 : 0),
    // Spacing is a custom property rather than an inline margin so whole-page
    // mode can spend it as padding instead, keeping section backgrounds
    // continuous the way the site's own sections are. An inline margin would
    // beat any stylesheet rule trying to do that.
    '--tlcb-space-above:' + b.spaceAbove + 'px',
    '--tlcb-space-below:' + b.spaceBelow + 'px',
  ];
  // Button color, when one has been chosen. ⚠ Absent emits nothing at all, so
  // .tlcb-btn falls through to the values it has always carried — a deploy
  // never repaints a button somebody did not ask it to.
  const btn = btnOf(b);
  if (btn) {
    v.push('--tlcb-btn-bg:' + btn.bg);
    v.push('--tlcb-btn-ink:' + btn.ink);
    v.push('--tlcb-btn-bd:' + btn.bd);
  }
  if (b.type === 'textphoto' || b.type === 'map' || b.type === 'sermon') v.push('--tlcb-cols:' + cols);
  if (b.type === 'columns') v.push('--tlcb-cols:repeat(' + b.cols + ',1fr)');
  if (b.type === 'cardgrid') v.push('--tlcb-cols:repeat(' + b.cols + ',1fr)');
  if (b.type === 'values') v.push('--tlcb-cols:repeat(' + b.cols + ',1fr)');
  if (b.type === 'classes') v.push('--tlcb-cols:repeat(' + b.cols + ',1fr)');
  if (b.type === 'hero' && b.photo) {
    v.push("--tlcb-hero-img:url('" + cssUrl(b.photo) + "')");
    v.push('--tlcb-hero-veil:1'); // the gradient that keeps white text legible over a photo
    v.push('--tlcb-hero-veil-top:' + (VEILS.find((x) => x.key === b.veil) || VEILS[1]).top);
    v.push('--tlcb-hero-pos:' + (IMG_POSITIONS.find((x) => x.key === b.imgPos) || IMG_POSITIONS[1]).css);
  }
  return v.join(';');
}

// In editing mode text fields become contenteditable and carry data-field so
// the editor can commit them on blur. On the public site they are plain HTML.
// `extra` may carry a data-ph placeholder; that is editor chrome, so it is
// stripped from the public render rather than shipped to every visitor.
const publicAttrs = (extra) => extra.replace(/ data-ph="[^"]*"/g, '');

function field(opts, b, key, tag, cls, value, extra = '', rich = false) {
  const content = value == null ? '' : value;
  if (!opts.editing) return `<${tag} class="${cls}"${publicAttrs(extra)}>${content}</${tag}>`;
  return `<${tag} class="${cls}" data-field="${key}"${rich ? ' data-rich="1"' : ''} contenteditable="true" spellcheck="true"${extra}>${content}</${tag}>`;
}

function itemField(opts, idx, key, tag, cls, value, extra = '', rich = false) {
  const content = value == null ? '' : value;
  if (!opts.editing) return `<${tag} class="${cls}"${publicAttrs(extra)}>${content}</${tag}>`;
  return `<${tag} class="${cls}" data-item="${idx}" data-field="${key}"${rich ? ' data-rich="1"' : ''} contenteditable="true" spellcheck="true"${extra}>${content}</${tag}>`;
}

// ⚠ WHICH TILE IS GOLD, IN ONE PLACE. A block has ONE background, and this
// layout needs two — so the alternate carries its colors inline. That was
// written out inside the Service times branch; Meeting times and Info tiles
// draw the same tiles, and three copies of the pairing is three chances for
// one of them to drift into a different gold.
function tileAlt(i) {
  if (i % 2 !== 1) return '';
  const gold = BG[7];
  return ` style="--tlcb-bg:${gold.grad};--tlcb-head-ink:${gold.head};--tlcb-ink:#3B2E12;--tlcb-eyebrow-ink:${gold.eyebrow}"`;
}

const ytId = (u) => (String(u || '').match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/) || [])[1] || '';

function renderBody(opts, b, def, ph = 'Write something here…') {
  const val = def.richBody ? (b.body || '') : esc(b.body || '');
  return field(opts, b, 'body', 'div', 'tlcb-prose', val, ` data-ph="${esc(ph)}"`, !!def.richBody);
}

// The small uppercase label the site puts above a heading (.eyebrow in
// public/styles.css). Only rendered when it has something in it, so blocks that
// never had one are unchanged.
function renderEyebrow(opts, b) {
  if (!opts.editing && !b.eyebrow) return '';
  return field(opts, b, 'eyebrow', 'div', 'tlcb-eyebrow', esc(b.eyebrow || ''), ' data-ph="Small label (optional)"');
}

function renderHead(opts, b, ph = 'Heading') {
  return renderEyebrow(opts, b) +
    field(opts, b, 'title', 'div', 'tlcb-head', esc(b.title || ''), ` data-ph="${esc(ph)}"`);
}

function renderStamp(opts, b) {
  if (!b.stamp) return '';
  const t = TONES[b.tone] || TONES[0];
  const style = `background:${t.bg};color:${t.fg}`;
  const editable = opts.editing ? ' data-field="stamp" contenteditable="true"' : '';
  // ⚠ 'm' adds no class, same rule as SHADOWS' `none` and every other
  // layout control here — the size the stamp has always rendered at must
  // stay exactly what `.tlcb-stamp` alone produces, not a class that
  // happens to agree with it.
  const sizeClass = b.stampSize === 'l' ? ' tlcb-stamp--lg' : '';
  const posClass = b.corner === 'tl' ? ' tlcb-stamp--tl' : b.corner === 'bc' ? ' tlcb-stamp--bc' : ' tlcb-stamp--tr';
  // ⚠ Live page only, like the three APPEARS movements above — the editor
  // draws the stamp in place so it is not pulsing while somebody is trying
  // to read it and work on the block underneath it.
  const pulseClass = (b.stampPulse && !opts.editing) ? ' tlcb-stamp--pulse' : '';
  return `<span class="tlcb-stamp${posClass}${sizeClass}${pulseClass}" style="${style}"${editable}>${esc(b.stamp)}</span>`;
}

// A banner carrying a card lays out as two columns rather than one. The side
// is a class rather than a style variable because it changes the *order* of
// the two columns, which is structure, not styling.
const cardClass = (b) => (b.card === 'left' || b.card === 'right') ? ` tlcb-band--card tlcb-band--card-${b.card}` : '';

// The info card, drawn once for all three blocks that can carry it. What it
// holds comes from `cardShows`; the two that read the church details read
// ctx.data, never the block, so a phone number changed in the admin lands on
// every card at once. Returns '' when the slot is off, which is what lets the
// banner renderers stay one line longer rather than branching twice.
function renderInfoCard(b, opts) {
  if (!b || b.card !== 'left' && b.card !== 'right') return '';
  const data = opts.data || {};
  const st = data.settings || {};
  const services = data.services || [];
  const row = (primary, secondary) => `<div class="tlcb-card-row">
      <span class="tlcb-card-1">${esc(primary)}</span>
      ${secondary ? `<span class="tlcb-card-2">${esc(secondary)}</span>` : ''}
    </div>`;
  // The spec's own row list has an explicit { rule: true } between the times
  // and the address, which means the ROWS carry no borders — one hairline in
  // the whole card, not one per row. Bordering every row is what made this
  // twice the height it should be.
  const ruleRow = '<div class="tlcb-card-rule"></div>';

  // ── TASK 13a ─────────────────────────────────────────────────────────────
  // Two bugs with one cause, and the cause was reading CARD_KINDS.times.rows as
  // "the first two entries" rather than as the composed unit it describes.
  //
  // 1. Services that share a label collapse onto ONE line. On the live
  //    homepage 8:00 and 10:45 are both English worship, so they read
  //    "8:00 & 10:45 am" with a single label beneath — not one row each. The
  //    grouping is by the label the office typed, so it follows the data: give
  //    two services the same note and they merge; leave them Traditional and
  //    Contemporary and they stay apart, which is also right.
  // 2. The meridiem prints ONCE. "8:00 am & 10:45 am" is how a machine says it.
  const groupServices = (rows) => {
    const order = [];
    const byLabel = new Map();
    const days = new Set(rows.map((r) => r.day).filter(Boolean));
    const oneDay = days.size <= 1;
    for (const r of rows) {
      // "Sunday · English worship" on every line repeats what the eyebrow
      // already said and wraps to two lines in a 415px card. The day earns its
      // place only when the services are not all on the same one.
      // ⚠ Falls back to nothing, not to the day. With every service on one
      // Sunday the eyebrow already says so, and printing "Sunday" under each
      // time is the same redundancy the note-only rule exists to remove. The
      // day still returns below the moment services span more than one.
      const label = oneDay ? (r.note || '') : [r.day, r.note].filter(Boolean).join(' · ');
      if (!byLabel.has(label)) { byLabel.set(label, []); order.push(label); }
      byLabel.get(label).push(String(r.time || '').trim());
    }
    return order.map((label) => {
      const times = byLabel.get(label).filter(Boolean);
      const mer = (t) => (t.match(/\s*(am|pm)$/i) || [, ''])[1].toLowerCase();
      const last = times[times.length - 1] || '';
      const shared = times.length > 1 && times.every((t) => mer(t) && mer(t) === mer(last));
      const joined = shared
        ? times.map((t, i) => (i === times.length - 1 ? t : t.replace(/\s*(am|pm)$/i, ''))).join(' & ')
        : times.join(' & ');
      return { time: joined, label };
    });
  };

  // The address and phone rows, shared by the composed services card and the
  // address/contact cards, so there is one description of each.
  // ⚠ THE ADDRESS IS ONE ROW, NOT FOUR. Every .tlcb-card-row carries 20px of
  // padding top and bottom plus a hairline, so emitting the street, the city,
  // the landmark and the directions link as separate rows made the card about
  // twice the height it should be — which is exactly what happened on the
  // homepage the first time this shipped. The live card stacks those lines
  // inside ONE row; the row is the unit of separation, not the line.
  const addressRows = () => {
    const line = st.address_line || '';
    const city = st.address_city || '';
    const near = st.address_near || '';
    if (!line && !city) return '';
    const maps = `https://maps.google.com/?q=${encodeURIComponent([line, city].filter(Boolean).join(', '))}`;
    return `<div class="tlcb-card-row tlcb-card-row--tight">`
      + `<span class="tlcb-card-2">${esc(line)}</span>`
      + (city ? `<span class="tlcb-card-2">${esc(city)}</span>` : '')
      + (near ? `<span class="tlcb-card-2">${esc(near)}</span>` : '')
      + `<a class="tlcb-card-link" href="${esc(maps)}">Get directions</a>`
      + `</div>`;
  };
  const phoneRow = () => (st.phone
    ? `<div class="tlcb-card-row tlcb-card-row--tight"><a class="tlcb-card-link" href="tel:${esc(String(st.phone).replace(/[^0-9+]/g, ''))}">${esc(st.phone)}</a></div>`
    : '');

  let body = '';
  if (b.cardShows === 'services') {
    // ⚠ "Service times" is NOT only service times. The card is one composed
    // unit — times, a hairline, the address, directions, then the phone — and
    // rendering only the times is what dropped the address off the homepage.
    if (!services.length) {
      body = `<p class="tlcb-note">No service times set yet — add them under Church details.</p>`;
    } else {
      const times = groupServices(services).map((g) => row(g.time, g.label)).join('');
      const rest = addressRows() + phoneRow();
      body = times + (rest ? ruleRow + rest : '');
    }
  } else if (b.cardShows === 'address') {
    // `pageData()` strips the `church_` prefix, so these are the same keys the
    // map block and the sidebar read — one record, four places, no retyping.
    const line = st.address_line || '';
    const city = st.address_city || '';
    const maps = line || city ? `https://maps.google.com/?q=${encodeURIComponent([line, city].filter(Boolean).join(', '))}` : '';
    body = (line || city)
      ? row(line, city) + (maps ? `<div class="tlcb-card-row"><a class="tlcb-card-link" href="${esc(maps)}">Get directions</a></div>` : '')
      : `<p class="tlcb-note">No address set yet — add it under Church details.</p>`;
  } else if (b.cardShows === 'contact') {
    const phone = st.phone || '';
    const email = st.email || '';
    body = (phone || email)
      ? (phone ? row(phone, 'Church office') : '') + (email ? `<div class="tlcb-card-row"><a class="tlcb-card-link" href="mailto:${esc(email)}">${esc(email)}</a></div>` : '')
      : `<p class="tlcb-note">No phone or email set yet — add them under Church details.</p>`;
  } else if (b.cardShows === 'links') {
    const links = (b.cardLinks || []).filter((l) => l.title || l.url);
    body = links.length
      ? links.map((l) => {
        const href = safeUrl(l.url);
        return `<div class="tlcb-card-row">${href && !opts.editing
          ? `<a class="tlcb-card-link" href="${esc(href)}">${esc(l.title || '')}</a>`
          : `<span class="tlcb-card-link">${esc(l.title || '')}</span>`}</div>`;
      }).join('')
      : `<p class="tlcb-note">No links yet — add them in the inspector.</p>`;
  } else {
    body = b.cardBody
      ? `<div class="tlcb-card-row tlcb-card-free">${b.cardBody}</div>`
      : `<p class="tlcb-note">Nothing typed yet.</p>`;
  }

  // The eyebrow is edited on the page like any other text, so it goes through
  // `field()` rather than being printed flat.
  const eyebrow = (b.cardEyebrow || opts.editing)
    ? field(opts, b, 'cardEyebrow', 'div', 'tlcb-card-eyebrow', esc(b.cardEyebrow || ''),
        ` data-ph="${b.cardShows === 'text' ? 'Take note' : 'JOIN US SUNDAY'}"`)
    : '';
  // The card's contents are read from elsewhere or set in the inspector, so
  // only the eyebrow is typed on the page — the rest is inert.
  return `<aside class="tlcb-card">${eyebrow}<div class="tlcb-card-body" contenteditable="false">${body}</div></aside>`;
}

// ── THE GIVING WIDGET'S BROWSER HALF ─────────────────────────────────────────
// Shipped inside the block so the block works wherever it is rendered rather
// than only on the one page whose shell remembered to include a script — the
// same self-contained property every other block type has.
//
// It is delegated off `document` and guarded, so N widgets on a page share one
// listener and a second copy of this script is a no-op. It is never emitted in
// the editor: the canvas shows the widget as furniture, because a chip that
// really navigated to Tithe.ly is not something to have under a cursor that is
// trying to drag a block.
//
// ⚠ No backticks anywhere in this string — it lives inside a template literal
// and one would terminate it, breaking the module while still passing
// `node --check`. That has happened three times in this repo.
const GIVING_WIDGET_SCRIPT = '<script>' + GIVE_LINK_JS + `
  (function () {
    if (window.__tlcGiveWired) return;
    window.__tlcGiveWired = 1;
    function cfgOf(w) { try { return JSON.parse(w.getAttribute('data-give') || '{}'); } catch (e) { return {}; } }
    function paint(w, amount) {
      var cfg = cfgOf(w);
      var fundSel = w.querySelector('.tlcb-gv-fund');
      var fund = fundSel ? fundSel.value : (cfg.fund || '');
      var cta = w.querySelector('.tlcb-gv-cta');
      if (!cta || !(amount > 0)) return;
      var over = cfg.overrides || {};
      // A tier's own override link ignores the fund entirely — it is a
      // deliberate "send this amount somewhere else", not an amount+fund pair.
      cta.setAttribute('href', over[amount] || tlcGiveLink(cfg.baseUrl || '', amount, fund));
      cta.textContent = 'Give $' + Number(amount).toLocaleString('en-US');
    }
    function current(w) {
      var on = w.querySelector('.tlcb-gv-chip.is-on');
      if (on) return Number(on.getAttribute('data-amount'));
      var other = w.querySelector('.tlcb-gv-other input');
      return other ? Number(other.value) : 0;
    }
    document.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.tlcb-gv-chip');
      if (!chip) return;
      var w = chip.closest('.tlcb-gv');
      if (!w) return;
      var list = w.querySelectorAll('.tlcb-gv-chip');
      for (var i = 0; i < list.length; i++) list[i].classList.remove('is-on');
      chip.classList.add('is-on');
      var other = w.querySelector('.tlcb-gv-other input');
      if (other) other.value = '';
      var err = w.querySelector('.tlcb-gv-err');
      if (err) err.hidden = true;
      paint(w, Number(chip.getAttribute('data-amount')));
    });
    document.addEventListener('change', function (e) {
      if (!e.target.classList || !e.target.classList.contains('tlcb-gv-fund')) return;
      var w = e.target.closest('.tlcb-gv');
      if (w) paint(w, current(w));
    });
    document.addEventListener('input', function (e) {
      var inp = e.target.closest && e.target.closest('.tlcb-gv-other input');
      if (!inp) return;
      var w = inp.closest('.tlcb-gv');
      if (!w) return;
      var err = w.querySelector('.tlcb-gv-err');
      var val = parseInt(inp.value, 10);
      if (!inp.value) { if (err) err.hidden = true; return; }
      if (!val || val < 1) { if (err) err.hidden = false; return; }
      if (err) err.hidden = true;
      var list = w.querySelectorAll('.tlcb-gv-chip');
      for (var i = 0; i < list.length; i++) list[i].classList.remove('is-on');
      paint(w, val);
    });
  })();
` + '<\/script>';


// ── THE COUNTDOWN'S BROWSER HALF ─────────────────────────────────────────────
// Shipped inside the block, like the giving widget's, so the block works
// wherever it is rendered rather than only on a page whose shell remembered a
// script. Delegated off one interval and guarded, so N banners share it and a
// second copy of this string is a no-op.
//
// The server renders the first value, so the banner is correct in the HTML
// before any script runs and correct forever if the script never does. All
// this adds is the ticking.
//
// ⚠ No backticks anywhere in this string. It lives inside a template literal
// and one would end it, breaking the module while still passing node --check.
const COUNTDOWN_SCRIPT = '<script>' + `
  (function () {
    if (window.__tlcCountdown) return;
    window.__tlcCountdown = 1;
    function paint() {
      var els = document.querySelectorAll('[data-countdown]');
      for (var i = 0; i < els.length; i++) {
        var t = Date.parse(els[i].getAttribute('data-countdown'));
        if (!t) continue;
        var s = Math.max(0, Math.floor((t - Date.now()) / 1000));
        var d = Math.floor(s / 86400); s -= d * 86400;
        var h = Math.floor(s / 3600); s -= h * 3600;
        var m = Math.floor(s / 60); s -= m * 60;
        var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
        els[i].textContent = d + 'd ' + p2(h) + 'h ' + p2(m) + 'm ' + p2(s) + 's';
      }
    }
    paint();
    setInterval(paint, 1000);
  })();
` + '<\/script>';

// ── THE PHOTO GALLERY'S BROWSER HALF ─────────────────────────────────────────
// Shipped inside the block for the same reason the countdown's is: the block
// works wherever it is rendered rather than only on a page whose shell
// remembered a script. Guarded, so N galleries on one page share one copy and
// a second copy of this string does nothing.
//
// ⚠ IT READS THE GALLERY OUT OF THE DOM rather than being handed a list of
// photographs. There is then exactly one description of what is in a gallery —
// the markup the visitor is already looking at — so the viewer cannot come to
// disagree with the grid behind it, and a gallery whose photos were changed
// needs nothing regenerated.
//
// ⚠ Nothing here runs in the editor: the gallery renders plain images there, so
// there is no button to delegate from. Clicking a photo on the canvas has to
// select the block, which is what somebody in an editor means by it.
//
// ⚠ No backticks anywhere in this string. It lives inside a template literal
// and one would end it, breaking the module while still passing node --check.
const LIGHTBOX_SCRIPT = '<script>' + `
  (function () {
    if (window.__tlcLightbox) return;
    window.__tlcLightbox = 1;
    var box = null, img = null, cap = null, count = null;
    var shots = [], at = 0, opener = null;

    function build() {
      if (box) return;
      box = document.createElement('div');
      box.className = 'tlcb-lb';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Photo viewer');
      box.hidden = true;
      box.innerHTML =
        '<button type="button" class="tlcb-lb-x" aria-label="Close photo viewer">&#215;</button>' +
        '<button type="button" class="tlcb-lb-nav tlcb-lb-prev" aria-label="Previous photo">&#8249;</button>' +
        '<figure class="tlcb-lb-fig"><img alt=""><figcaption><span class="tlcb-lb-cap"></span>' +
        '<span class="tlcb-lb-of"></span></figcaption></figure>' +
        '<button type="button" class="tlcb-lb-nav tlcb-lb-next" aria-label="Next photo">&#8250;</button>';
      document.body.appendChild(box);
      img = box.querySelector('img');
      cap = box.querySelector('.tlcb-lb-cap');
      count = box.querySelector('.tlcb-lb-of');
      box.querySelector('.tlcb-lb-x').addEventListener('click', close);
      box.querySelector('.tlcb-lb-prev').addEventListener('click', function () { step(-1); });
      box.querySelector('.tlcb-lb-next').addEventListener('click', function () { step(1); });
      // Clicking the backdrop closes; clicking the photograph itself does not,
      // or reaching for the picture would dismiss it.
      box.addEventListener('click', function (e) { if (e.target === box) close(); });
      box.addEventListener('keydown', onKey);
    }

    function paint() {
      var s = shots[at];
      if (!s) return;
      img.src = s.src;
      img.alt = s.alt;
      cap.textContent = s.alt;
      // One of a set is worth saying; one on its own is not.
      count.textContent = shots.length > 1 ? (at + 1) + ' of ' + shots.length : '';
      var many = shots.length > 1;
      box.querySelector('.tlcb-lb-prev').hidden = !many;
      box.querySelector('.tlcb-lb-next').hidden = !many;
    }

    function step(d) {
      if (shots.length < 2) return;
      at = (at + d + shots.length) % shots.length;
      paint();
    }

    function open(grid, i, from) {
      build();
      var btns = grid.querySelectorAll('.tlcb-gal-open');
      shots = [];
      for (var n = 0; n < btns.length; n++) {
        var p = btns[n].querySelector('img');
        if (p) shots.push({ src: p.getAttribute('src'), alt: p.getAttribute('alt') || '' });
      }
      if (!shots.length) return;
      at = Math.max(0, Math.min(i, shots.length - 1));
      opener = from;
      paint();
      box.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      box.querySelector('.tlcb-lb-x').focus();
    }

    function close() {
      if (!box || box.hidden) return;
      box.hidden = true;
      document.documentElement.style.overflow = '';
      // ⚠ Focus goes back to the thumbnail it was opened from. Without this a
      // keyboard visitor is returned to the top of the document and has to tab
      // all the way down again to reach the next photograph.
      if (opener && document.contains(opener)) opener.focus();
      opener = null;
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); return; }
      if (e.key !== 'Tab') return;
      // A modal that lets Tab wander back onto the page behind it is a modal a
      // screen reader user cannot tell they are still inside.
      var stops = [];
      var all = box.querySelectorAll('button');
      for (var i = 0; i < all.length; i++) if (!all[i].hidden) stops.push(all[i]);
      if (!stops.length) return;
      var first = stops[0], last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.tlcb-gal-open') : null;
      if (!btn) return;
      var grid = btn.closest('.tlcb-gallery');
      if (!grid) return;
      e.preventDefault();
      var btns = grid.querySelectorAll('.tlcb-gal-open');
      var i = 0;
      for (var n = 0; n < btns.length; n++) if (btns[n] === btn) i = n;
      open(grid, i, btn);
    });
  })();
` + '<\/script>';

// ── THE LETTER BLOCK'S OWN LINKS OPEN THE OVERLAY, NOT A NEW PAGE ────────────
// Every "Read this week" / older-letter link this block renders keeps its
// real href="/news/<id>" (a shared link, a new tab, no-JS all still work) —
// but in public rendering it also carries class="tlcb-lt-open"
// data-nl-id="<id>", which this script intercepts so the click stays on
// /news and opens the same overlay loadNewsletterDetail() (public/index.html)
// already builds for a direct /news/<id> visit, rather than letting a real
// navigation run into tlcMaybeTakeOverSitePage()'s "hide every child of
// #page-news" pass, which is what silently swallowed the old in-page panel.
//
// ⚠ Guarded like every other block script (COUNTDOWN_SCRIPT, LIGHTBOX_SCRIPT):
// idempotent, delegated off document, appended only in public rendering.
//
// ⚠ No backticks anywhere in this string. It lives inside a template literal
// and one would end it, breaking the module while still passing node --check.
const LETTER_SCRIPT = '<script>' + `
  (function () {
    if (window.__tlcLetterLinks) return;
    window.__tlcLetterLinks = 1;
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('.tlcb-lt-open') : null;
      if (!a) return;
      var id = a.getAttribute('data-nl-id');
      if (!id || typeof window.loadNewsletterDetail !== 'function') return;
      e.preventDefault();
      window.loadNewsletterDetail(id);
    });
  })();
` + '<\/script>';

// ── THE MARKET APPLICATION'S BROWSER HALF ────────────────────────────────────
// Shipped inside the block for the same reason as the three above: the block
// works wherever it is rendered — the edge-rendered first paint, or the
// client takeover after — rather than only on a page whose shell remembered a
// script. Guarded, so more than one instance on a page still wires once.
//
// ⚠ The pricing config is read off `data-market-cfg`, SERVER-RENDERED — there
// is no fetch here at all. The standalone fallback page (public/index.html)
// fetches /api/market-config after paint because it has to; this block does
// not, because pageData() already computed the same thing before this markup
// left the Worker.
//
// ⚠ No backticks anywhere in this string (or in MARKET_PRICING_JS, prepended
// below). It lives inside a template literal and one would end it, breaking
// the module while still passing `node --check`.
const MARKET_APP_SCRIPT = '<script>' + MARKET_PRICING_JS + `
  (function () {
    if (window.__tlcMktAppWired) return;
    window.__tlcMktAppWired = 1;

    function cfgOf(w) { try { return JSON.parse(w.getAttribute('data-market-cfg') || '{}'); } catch (e) { return {}; } }

    function paint(w) {
      var cfg = cfgOf(w);
      var chosen = w.querySelector('[data-tables][aria-pressed="true"]');
      var n = chosen ? Number(chosen.getAttribute('data-tables')) : 1;
      var p = tlcMktPrice(n, cfg);
      var set = function (sel, text) { var el = w.querySelector(sel); if (el) el.textContent = text; };
      set('[data-row="sub-label"]', n + (n === 1 ? ' table × ' : ' tables × ') + tlcMktMoney(Math.round((Number(cfg.tableFee) || 0) * 100)));
      set('[data-row="sub"]', tlcMktMoney(p.subtotalCents));
      set('[data-row="fee"]', tlcMktMoney(p.feeCents));
      set('[data-row="due"]', tlcMktMoney(p.totalCents));
      var submit = w.querySelector('[data-submit-label]');
      if (submit) submit.textContent = 'Submit and pay ' + tlcMktMoney(p.totalCents);
      var hidden = w.querySelector('[name="tables"]');
      if (hidden) hidden.value = String(n);
    }

    function go(w, step) {
      var n = Math.min(3, Math.max(1, Number(step) || 1));
      var steps = w.querySelectorAll('.tlcb-mktapp-step');
      for (var i = 0; i < steps.length; i++) steps[i].setAttribute('aria-selected', String(Number(steps[i].getAttribute('data-step')) === n));
      var panels = w.querySelectorAll('.tlcb-mktapp-panel');
      for (var j = 0; j < panels.length; j++) panels[j].classList.toggle('is-on', Number(panels[j].getAttribute('data-panel')) === n);
    }

    function say(w, message, kind) {
      var el = w.querySelector('.tlcb-mktapp-alert');
      if (!el) return;
      el.textContent = message || '';
      el.className = 'tlcb-mktapp-alert' + (message ? ' tlcb-mktapp-alert--' + (kind === 'ok' ? 'ok' : 'err') : '');
    }

    // Which step needs to be complete before somebody may move PAST it. Moving
    // BACK never validates — trapping somebody on step 2 when they wanted to
    // fix a typo on step 1 is the classic wizard failure.
    function check(w, step) {
      var v = function (name) { var el = w.querySelector('[name="' + name + '"]'); return el ? (el.value || '').trim() : ''; };
      var problems = [];
      if (step === 1) {
        if (!v('participant_names')) problems.push(['participant_names', 'Please say who will be at the table.']);
        if (!v('email')) problems.push(['email', 'Please give us an email address so we can confirm your table.']);
        else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v('email'))) problems.push(['email', 'That email address does not look right — please check it.']);
        if (!v('phone')) problems.push(['phone', 'Please give us a phone number.']);
      }
      if (step === 2 && !v('product_description')) problems.push(['product_description', 'Please describe what you plan to sell.']);
      if (step === 3 && !v('signature_name')) problems.push(['signature_name', 'Please type your name at the bottom to agree to the vendor terms.']);
      if (!problems.length) { say(w, ''); return true; }
      say(w, problems[0][1], 'err');
      var field = w.querySelector('[name="' + problems[0][0] + '"]');
      if (field) { field.focus(); field.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return false;
    }

    var photos = [];
    function paintThumbs(w) {
      var wrap = w.querySelector('.tlcb-mktapp-thumbs');
      if (!wrap) return;
      wrap.innerHTML = '';
      photos.forEach(function (f, idx) {
        var img = document.createElement('img');
        img.alt = f.name || 'Sample photo';
        img.src = URL.createObjectURL(f);
        img.title = 'Click to remove';
        img.addEventListener('click', function () { photos.splice(idx, 1); paintThumbs(w); });
        wrap.appendChild(img);
      });
    }
    function addPhotos(w, files) {
      if (!files) return;
      for (var i = 0; i < files.length && photos.length < 5; i++) {
        if (/^image\\//.test(files[i].type)) photos.push(files[i]);
      }
      paintThumbs(w);
    }

    document.addEventListener('click', function (e) {
      var w = e.target.closest && e.target.closest('.tlcb-mktapp');
      if (!w) return;

      var tab = e.target.closest('.tlcb-mktapp-step');
      if (tab) { go(w, tab.getAttribute('data-step')); return; }

      var next = e.target.closest('[data-goto]');
      if (next) {
        var to = Number(next.getAttribute('data-goto'));
        var active = w.querySelector('.tlcb-mktapp-step[aria-selected="true"]');
        var from = active ? Number(active.getAttribute('data-step')) : 1;
        if (to > from && !check(w, from)) return;
        go(w, to);
        return;
      }

      var pill = e.target.closest('[data-returning]');
      if (pill) {
        var val = pill.getAttribute('data-returning');
        var already = pill.getAttribute('aria-pressed') === 'true';
        var pills = w.querySelectorAll('[data-returning]');
        for (var k = 0; k < pills.length; k++) pills[k].setAttribute('aria-pressed', 'false');
        if (!already) pill.setAttribute('aria-pressed', 'true');
        var hid = w.querySelector('[name="returning_vendor"]');
        if (hid) hid.value = already ? '' : val;
        return;
      }

      var tbtn = e.target.closest('[data-tables]');
      if (tbtn) {
        var all = w.querySelectorAll('[data-tables]');
        for (var m = 0; m < all.length; m++) all[m].setAttribute('aria-pressed', 'false');
        tbtn.setAttribute('aria-pressed', 'true');
        paint(w);
        return;
      }
    });

    // Drag-and-drop photos, and — the important half — swallow a drop
    // ANYWHERE else on the block. Missing the drop zone by half an inch would
    // otherwise make the browser navigate to the photograph, replacing a
    // half-filled application with a JPEG and no way back to it.
    document.addEventListener('dragover', function (e) {
      if (e.target.closest && e.target.closest('.tlcb-mktapp')) e.preventDefault();
    });
    document.addEventListener('drop', function (e) {
      var w = e.target.closest && e.target.closest('.tlcb-mktapp');
      if (!w) return;
      e.preventDefault();
      var drop = e.target.closest('.tlcb-mktapp-drop');
      if (drop) addPhotos(w, e.dataTransfer && e.dataTransfer.files);
    });
    document.addEventListener('change', function (e) {
      var input = e.target.closest && e.target.closest('.tlcb-mktapp-drop input[type="file"]');
      if (!input) return;
      addPhotos(input.closest('.tlcb-mktapp'), input.files);
      input.value = '';
    });

    document.addEventListener('submit', function (e) {
      var form = e.target.closest && e.target.closest('.tlcb-mktapp-form');
      if (!form) return;
      e.preventDefault();
      var w = form.closest('.tlcb-mktapp');
      var cfg = cfgOf(w);
      if (form.querySelector('[name="website"]').value) { form.reset(); return; }
      for (var s = 1; s <= 3; s++) { if (!check(w, s)) { go(w, s); return; } }

      var btn = w.querySelector('[data-submit-label]');
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      say(w, '');

      var fd = new FormData(form);
      fd.delete('photos');
      photos.forEach(function (f) { fd.append('photos', f, f.name); });
      if (window.tlcFormToken) fd.append('form_token', window.tlcFormToken);

      fetch('https://admin.timothystl.org/api/market/apply', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok || res.d.error) throw new Error(res.d.error || 'Server error');
          if (res.d.payUrl) { say(w, 'Application received — taking you to payment…', 'ok'); window.location.href = res.d.payUrl; return; }
          say(w, 'Your application is in. We could not open the payment page from here — email '
            + (cfg.coordinatorEmail || 'the coordinator') + ' and they will take payment and hold your space.', 'ok');
          if (btn) { btn.disabled = true; btn.textContent = 'Application received'; }
        })
        .catch(function (err) {
          say(w, (err && err.message) || ('Something went wrong. Please try again, or email '
            + (cfg.coordinatorEmail || 'the coordinator') + ' and they will take your application by hand.'), 'err');
          if (btn) { btn.disabled = false; btn.textContent = label; }
        });
    });

    var apps = document.querySelectorAll('.tlcb-mktapp:not(.tlcb-mktapp--editing)');
    for (var q = 0; q < apps.length; q++) paint(apps[q]);
  })();
` + '<\/script>';

// ── A GENERIC EVENT'S REGISTRATION SCRIPT ─────────────────────────────────
// The single-page counterpart to MARKET_APP_SCRIPT above — no three-step
// wizard (this form asks whatever `site_event_fields` says, not nine fixed
// fields), no photo upload. Reuses MARKET_PRICING_JS for the live total the
// same way the market's own block does; the two scripts can both be on one
// page (they never are, today, but nothing stops a future page from doing
// it) because redefining the same functions twice is harmless.
//
// ⚠ No backticks anywhere in this string, for the identical reason
// MARKET_APP_SCRIPT's own comment gives.
const REGISTRATION_SCRIPT = '<script>' + MARKET_PRICING_JS + `
  (function () {
    if (window.__tlcRegAppWired) return;
    window.__tlcRegAppWired = 1;

    function cfgOf(w) { try { return JSON.parse(w.getAttribute('data-reg-cfg') || '{}'); } catch (e) { return {}; } }

    function paint(w) {
      var cfg = cfgOf(w);
      if (!cfg.feeConfig) return;
      var qtyEl = w.querySelector('[name="qty"]');
      var n = qtyEl ? (Number(qtyEl.value) || 1) : 1;
      var p = tlcMktPrice(n, cfg.feeConfig);
      var set = function (sel, text) { var el = w.querySelector(sel); if (el) el.textContent = text; };
      set('[data-row="due"]', tlcMktMoney(p.totalCents));
      var submit = w.querySelector('[data-submit-label]');
      if (submit && submit.getAttribute('data-pay-label') !== '0') submit.textContent = 'Continue to payment — ' + tlcMktMoney(p.totalCents);
    }

    function say(w, message, kind) {
      var el = w.querySelector('.tlcb-reg-alert');
      if (!el) return;
      el.textContent = message || '';
      el.className = 'tlcb-reg-alert' + (message ? ' tlcb-reg-alert--' + (kind === 'ok' ? 'ok' : 'err') : '');
    }

    document.addEventListener('input', function (e) {
      var w = e.target.closest && e.target.closest('.tlcb-reg');
      if (w && e.target.name === 'qty') paint(w);
    });

    document.addEventListener('submit', function (e) {
      var form = e.target.closest && e.target.closest('.tlcb-reg-form');
      if (!form) return;
      e.preventDefault();
      var w = form.closest('.tlcb-reg');
      var cfg = cfgOf(w);
      if (form.querySelector('[name="website"]').value) { form.reset(); return; }
      say(w, '');

      var btn = w.querySelector('[data-submit-label]');
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      var fd = new FormData(form);
      fd.append('event_id', cfg.eventId || '');
      if (window.tlcFormToken) fd.append('form_token', window.tlcFormToken);

      fetch('https://admin.timothystl.org/api/events/register', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok || res.d.error) throw new Error(res.d.error || 'Server error');
          if (res.d.payUrl) { say(w, 'You are signed up — taking you to payment…', 'ok'); window.location.href = res.d.payUrl; return; }
          say(w, res.d.waitlisted ? 'You are on the waitlist — we will be in touch if a spot opens up.' : 'You are signed up. We will be in touch.', 'ok');
          if (btn) { btn.disabled = true; btn.textContent = 'Signed up'; }
          form.reset();
        })
        .catch(function (err) {
          say(w, (err && err.message) || 'Something went wrong. Please try again.', 'err');
          if (btn) { btn.disabled = false; btn.textContent = label; }
        });
    });

    var forms = document.querySelectorAll('.tlcb-reg:not(.tlcb-reg--editing)');
    for (var q = 0; q < forms.length; q++) paint(forms[q]);
  })();
` + '<\/script>';

function renderInner(b, opts) {
  const def = BLOCK_DEFS[b.type];
  const t = b.type;
  const data = opts.data || {};


  // ── Self-filling blocks ───────────────────────────────────────────────────
  // These read from ctx.data, never from the block. In the editor they show
  // real data too, so what staff arrange is what visitors get; when there is
  // nothing to show they say so plainly rather than rendering empty furniture.


  // The next dated event, shared by the banner's countdown and the coming-up
  // strip. Both answer "what is next", so both read the one list and neither
  // stores a copy of it.
  const upcoming = () => (data.news || [])
    .filter((n) => n.event_date)
    .sort((a2, b2) => String(a2.event_date).localeCompare(String(b2.event_date)));

  if (t === 'photobanner') {
    const h = BANNER_HEIGHTS.find((x) => x.key === b.bannerHeight) || BANNER_HEIGHTS[1];
    const pick = opts.editing
      ? `<button type="button" class="tlcb-pick" data-act="photo">Change photo</button>` : '';
    // ⚠ THE VEIL IS ONLY DRAWN OVER A PHOTOGRAPH. With no photo the banner is
    // a flat navy field, which is a deliberate look rather than a hole — the
    // church has a handful of usable photographs and this has to read as
    // finished before any of them are uploaded. Laying a dark gradient over
    // navy would just make it look like a photograph failed to load.
    const veil = b.photo
      ? `<span class="tlcb-pb-veil" style="--tlcb-pb-top:${(VEILS.find((v) => v.key === b.veil) || VEILS[1]).top}"></span>`
      : '';
    // ⚠ AFTER the veil in source order, so it paints on top of it. Under the
    // veil, the layer whose entire job is to stop the field reading gray is
    // itself grayed. And unlike the veil this is drawn WITH OR WITHOUT a
    // photograph — a banner with no picture is the state this site ships in,
    // and it is the one that most needs the warmth.
    const glowCss = (GLOWS.find((g) => g.key === b.glow) || GLOWS[0]).css;
    const glow = glowCss ? `<span class="tlcb-pb-glow" style="--tlcb-pb-glow:${glowCss}"></span>` : '';
    const dot = b.pulse ? '<span class="tlcb-pulse"></span>' : '';
    const eyebrow = (b.eyebrow || opts.editing)
      ? `<div class="tlcb-pb-eyebrow">${dot}${field(opts, b, 'eyebrow', 'span', 'tlcb-pb-eyebrow-t', esc(b.eyebrow || ''), ' data-ph="Happening next"')}</div>`
      : '';
    const next = b.countdown ? upcoming()[0] : null;
    // Church time, not the visitor's and not the Worker's. A countdown is
    // arithmetic against Date.now() in a browser that may be anywhere, so the
    // target has to be an instant rather than a date somebody reads.
    const target = next ? churchInstant(next.event_date, '09:00') : '';
    const clock = target
      ? `<div class="tlcb-pb-count"><span class="tlcb-pb-count-l">Starts in</span>
           <span class="tlcb-pb-count-v" data-countdown="${esc(target)}">\u2014</span></div>`
      : '';
    const sub = (b.subtitle || opts.editing)
      ? field(opts, b, 'subtitle', 'p', 'tlcb-pb-sub', b.subtitle || '', ' data-ph="Where it is, when it starts, who it is for" data-rich-line="1"', true)
      : '';
    const foot = clock || sub ? `<div class="tlcb-pb-foot">${clock}${sub}</div>` : '';
    return `<div class="tlcb-pb tlcb-pb--${esc(h.key)}${cardClass(b)}"${b.photo ? ` style="--tlcb-pb-img:url('${cssUrl(b.photo)}')"` : ''}>${pick}${veil}${glow}
      <div class="tlcb-band-text tlcb-pb-body">${eyebrow}
      ${field(opts, b, 'title', 'h1', 'tlcb-pb-title', esc(b.title || ''), ' data-ph="The thing everyone should know about"')}
      ${foot}</div>${renderInfoCard(b, opts)}
      ${target ? COUNTDOWN_SCRIPT : ''}</div>`;
  }

  // One row of buttons, shared by the three band types below so a button
  // renders identically whichever of them it sits in.
  const bandButtons = () => {
    const rows = (b.items || []).filter((i) => i.title);
    if (!rows.length) return '';
    return `<div class="tlcb-btns">` + rows.map((it, i) => {
      const cls = 'tlcb-btn' + (i > 0 ? (BG[b.bg] && BG[b.bg].dark ? ' tlcb-btn--ghost-light' : ' tlcb-btn--ghost') : '');
      const href = safeUrl(it.url);
      return href && !opts.editing
        ? `<a class="${cls}" href="${esc(href)}">${esc(it.title)}</a>`
        : `<span class="${cls}">${esc(it.title)}</span>`;
    }).join('') + `</div>`;
  };

  if (t === 'highlight') {
    // ⚠ .tlcb-tile is the Service times tile's own class, used here rather
    // than copied. The handoff calls this "the service-times tile made
    // general", so the two share their card CSS by construction — a second
    // copy is how the general one and the specific one come to look different.
    return `<div class="tlcb-tile">
      ${renderEyebrow(opts, b)}
      ${field(opts, b, 'big', 'div', 'tlcb-tile-big', esc(b.big || ''), ' data-ph="68"')}
      ${field(opts, b, 'title', 'div', 'tlcb-tile-t', esc(b.title || ''), ' data-ph="What it is"')}
      ${renderBody(opts, b, def, 'A sentence about it')}
      ${bandButtons()}
    </div>`;
  }

  if (t === 'cta') {
    return `<div class="tlcb-cta">
      <div class="tlcb-cta-b">${renderHead(opts, b, 'Ready to put your hands to work?')}
        ${renderBody(opts, b, def, 'Why, and what happens next')}</div>
      ${bandButtons()}
    </div>`;
  }

  if (t === 'signup') {
    // The form posts to the same place the site-wide band does. It is markup
    // rather than a second sign-up mechanism — there is one subscriber list.
    const form = opts.editing
      ? `<div class="tlcb-inline"><span class="tlcb-field">you@example.com</span><span class="tlcb-btn">Subscribe</span></div>`
      : `<form class="tlcb-inline" method="POST" action="https://admin.timothystl.org/api/subscribe">
          <input class="tlcb-field" type="email" name="email" required placeholder="you@example.com" aria-label="Email address">
          <button class="tlcb-btn" type="submit">Subscribe</button>
        </form>`;
    return `<div class="tlcb-stack tlcb-signup">${renderHead(opts, b, 'The weekly letter')}
      ${renderBody(opts, b, def, 'What lands in their inbox, and how often')}${form}</div>`;
  }

  if (t === 'values') {
    const vals = data.values || [];
    if (!vals.length) {
      return `<div class="tlcb-stack">${renderHead(opts, b)}<p class="tlcb-note">The core values record could not be read.</p></div>`;
    }
    const cards = vals.map((v) => {
      // ⚠ Each card carries its OWN field, ink and accent inline. A block has
      // one background and this needs four — and the four hues are the single
      // departure from navy and gold in this whole language, allowed on the
      // value card field and its rule and nowhere else. Not nav, not buttons,
      // not links, not headings.
      // ⚠ A PHOTO ALWAYS TAKES LIGHT INK, regardless of the value's own
      // darkInk flag. darkInk exists to keep text readable on a light flat
      // gradient (Outreach's gold); the photo veil is a fixed dark wash, so
      // the ink that would be right for the gradient is exactly wrong once a
      // photo replaces it.
      const hasPhoto = !!v.photoUrl;
      const ink = (!hasPhoto && v.darkInk) ? '#3B2E12' : 'rgba(255,255,255,.94)';
      const head = (!hasPhoto && v.darkInk) ? '#101B2E' : '#FFFFFF';
      const label = (!hasPhoto && v.darkInk) ? 'rgba(16,27,46,.72)' : 'rgba(255,255,255,.88)';
      const photoVars = hasPhoto ? `--v-photo:url('${cssUrl(v.photoUrl)}');--v-veil:1;` : '';
      const ways = b.ways && (v.ways || []).length
        ? `<div class="tlcb-val-ways">${v.ways.map((w) => `<div class="tlcb-val-way">
             <span class="tlcb-val-wt">${esc(w.title || '')}</span>
             <span class="tlcb-val-wb">${esc(w.body || '')}</span>
           </div>`).join('')}</div>`
        : '';
      // The partner sits on a DARK wash, never a white one — a white wash
      // lightens the surface the white text is sitting on, and white fails.
      const partner = v.partner
        ? `<div class="tlcb-val-partner"><span class="tlcb-val-pn">${esc(v.partner.name || '')}</span>
             ${v.partner.body ? `<span class="tlcb-val-pb">${esc(v.partner.body)}</span>` : ''}</div>`
        : '';
      return `<div class="tlcb-val" style="--v-field:${v.field};${photoVars}--v-ink:${ink};--v-head:${head};--v-label:${label};--v-accent:${v.light}">
        <span class="tlcb-val-word">${esc(v.short || '')}</span>
        <span class="tlcb-val-sub">${esc(v.name || '')}</span>
        <span class="tlcb-val-rule"></span>
        <span class="tlcb-val-tag">${esc(v.tag || v.blurb || '')}</span>
        ${ways}${partner}
      </div>`;
    }).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b, 'What we are for')}
      <div class="tlcb-vals">${cards}</div></div>`;
  }

  if (t === 'quote') {
    return `<div class="tlcb-quote">
      ${field(opts, b, 'title', 'blockquote', 'tlcb-quote-q', esc(b.title || ''), ' data-ph="The sentence worth setting large"')}
      <div class="tlcb-quote-b">${renderBody(opts, b, def, 'The paragraph beside it')}</div>
    </div>`;
  }

  if (t === 'chips') {
    const rows = upcoming().slice(0, b.count);
    // ⚠ Renders NOTHING when there is nothing coming up — not an empty strip,
    // not a "no events" line. It is a one-line aside between two real sections,
    // and a strip announcing its own emptiness is worse than the gap it leaves.
    // In the editor it says so, because a block that vanishes from the canvas
    // is a block somebody thinks they broke.
    if (!rows.length) {
      return opts.editing
        ? `<div class="tlcb-chips">${renderHead(opts, b, 'Coming up')}<span class="tlcb-note">Nothing dated is coming up, so this strip will not appear on the page at all.</span></div>`
        : '';
    }
    const pills = rows.map((n) => `<span class="tlcb-chip">`
      + `<span class="tlcb-chip-d">${esc(fmtNewsDate(n.event_date, true))}</span>`
      + `<span class="tlcb-chip-t">${esc(n.title || '')}</span></span>`).join('');
    return `<div class="tlcb-chips">
      ${field(opts, b, 'title', 'span', 'tlcb-chips-l', esc(b.title || ''), ' data-ph="Coming up"')}
      <div class="tlcb-chip-row">${pills}</div></div>`;
  }

  if (t === 'countdown') {
    // Blank means automatic — the same next-upcoming-post `upcoming()[0]`
    // already computes for the banner switch and the Coming-up strip. A
    // picked id that no longer has a date (the post was edited, or deleted)
    // is treated exactly like nothing picked at all, never as an error.
    const auto = !b.newsId;
    const target = auto
      ? upcoming()[0]
      : (data.news || []).find((n) => Number(n.id) === Number(b.newsId) && n.event_date);
    // ⚠ RENDERS NOTHING WHEN THERE IS NOTHING TO COUNT DOWN TO — the same rule
    // the Coming-up strip follows, for the same reason: a countdown block that
    // shows a dash forever, or a sentence explaining its own emptiness, is
    // worse than the block simply not being there. The editor says why,
    // because a block that vanishes from the canvas is one somebody thinks
    // they broke.
    if (!target) {
      return opts.editing
        ? `<div class="tlcb-stack">${renderEyebrow(opts, b)}<span class="tlcb-note">${auto
            ? 'Nothing dated is coming up in News & Events, so this block will not appear on the page.'
            : 'That post no longer has a date, so this block will not appear on the page. Pick another in the panel on the right.'}</span></div>`
        : '';
    }
    const dot = b.pulse ? '<span class="tlcb-pulse"></span>' : '';
    // Church time, not the visitor's and not the Worker's — same reasoning as
    // the banner's own countdown, restated here because this is a second
    // place the arithmetic has to be right.
    const at = churchInstant(target.event_date, '09:00');
    return `<div class="tlcb-stack">
      <div class="tlcb-inline">${dot}${field(opts, b, 'eyebrow', 'span', 'tlcb-eyebrow', esc(b.eyebrow || ''), ' data-ph="Coming up"')}</div>
      <div class="tlcb-head">${esc(target.title || '')}</div>
      <div class="tlcb-inline"><span class="tlcb-cd-l">Starts in</span>
        <span class="tlcb-cd-v" data-countdown="${esc(at)}">—</span></div>
      ${COUNTDOWN_SCRIPT}
    </div>`;
  }

  if (t === 'letter') {
    const issues = data.newsletters || [];
    const newest = issues[0];
    const rest = issues.slice(1, 1 + Math.max(0, b.count));
    const dead = opts.editing ? ' onclick="return false"' : '';
    const eyebrow = newest
      ? `<div class="tlcb-eyebrow">${esc(fmtNewsDate(newest.published_at))}</div>`
      : renderEyebrow(opts, b);
    // \u26a0 `tlcb-lt-open`/`data-nl-id` are what LETTER_SCRIPT (below) intercepts
    // so a click stays on /news and opens the overlay `loadNewsletterDetail()`
    // (public/index.html) builds, rather than running into a real navigation
    // that `tlcMaybeTakeOverSitePage()`'s "hide every child of #page-news"
    // pass would swallow. The real href stays too \u2014 a shared link, a new tab
    // and no-JS all still work; the script only ever prevents the default.
    const read = newest
      ? `<a class="tlcb-btn tlcb-lt-open" href="/news/${esc(newest.id)}" data-nl-id="${esc(newest.id)}"${dead}>Read this week</a>`
      : '';
    // The sign-up goes to the site's own page rather than carrying a form of
    // its own: there is exactly one newsletter sign-up on this site and it is
    // site-wide chrome (Menu \u2192 Appearance), not something a block owns a
    // second copy of.
    const join = b.signup ? `<a class="tlcb-btn tlcb-btn--ghost-light" href="/news#subscribe"${dead}>Get it by email</a>` : '';
    const list = rest.map((n) => `<a class="tlcb-lt-row tlcb-lt-open" href="/news/${esc(n.id)}" data-nl-id="${esc(n.id)}"${dead}>
      <span class="tlcb-lt-s">${esc(n.subject || '')}</span>
      <span class="tlcb-lt-d">${esc(fmtNewsDate(n.published_at, true))}</span></a>`).join('');
    const right = list
      ? `<div class="tlcb-lt-list">${list}</div>`
      : (opts.editing ? `<span class="tlcb-note">Older letters will be listed here as they are sent.</span>` : '');
    // The script only has a job when there is a real link on the page for it
    // to intercept, and it must never ship in the editor canvas.
    const letterScript = !opts.editing && (newest || rest.length) ? LETTER_SCRIPT : '';
    return `<div class="tlcb-lt">
      <div class="tlcb-lt-b">${eyebrow}
        ${field(opts, b, 'title', 'div', 'tlcb-head', esc(b.title || ''), ' data-ph="The weekly letter"')}
        ${renderBody(opts, b, def, 'What the letter is, and who writes it')}
        ${read || join ? `<div class="tlcb-btns">${read}${join}</div>` : ''}
        ${newest ? '' : `<span class="tlcb-note">No letters have been sent yet, so the button is hidden until the first one goes out.</span>`}
      </div>${right}${letterScript}</div>`;
  }

  if (t === 'alert') {
    const href = safeUrl(b.url);
    const link = href && !opts.editing
      ? `<a class="tlcb-alert-link" href="${esc(href)}">Details</a>`
      : (opts.editing && href ? `<span class="tlcb-alert-link">Details</span>` : '');
    return `<div class="tlcb-alert"><span class="tlcb-alert-tag">Notice</span>
      ${field(opts, b, 'body', 'div', 'tlcb-alert-body', b.body || '', ' data-ph="One line everyone needs to read"', true)}
      ${link}</div>`;
  }

  if (t === 'slideshow') {
    const slides = (b.items || []).filter((i) => i.url);
    const bg = b.photo || (slides[0] && slides[0].url) || '';
    const pick = opts.editing ? `<button type="button" class="tlcb-pick" data-act="gallery">Manage slides</button>` : '';
    const dots = slides.length > 1
      ? `<div class="tlcb-dots">${slides.map((_, i) => `<span${i ? '' : ' class="on"'}></span>`).join('')}</div>` : '';
    const btns = (b.links || []).map((l, i) => {
      const cls = 'tlcb-btn' + (i > 0 ? ' tlcb-btn--ghost-light' : '');
      const href = safeUrl(l.url);
      return href && !opts.editing
        ? `<a class="${cls}" href="${esc(href)}">${esc(l.title || '')}</a>`
        : `<span class="${cls}">${esc(l.title || '')}</span>`;
    }).join('');
    return `<div class="tlcb-slide${cardClass(b)}"${bg ? ` style="--tlcb-slide-img:url('${cssUrl(bg)}')"` : ''}>${pick}
      <div class="tlcb-band-text">
      ${field(opts, b, 'title', 'h1', 'tlcb-slide-title', esc(b.title || ''), ' data-ph="A line that says who you are"')}
      ${field(opts, b, 'subtitle', 'p', 'tlcb-slide-sub', b.subtitle || '', ' data-ph="A sentence underneath it" data-rich-line="1"', true)}
      <div class="tlcb-btns">${btns}</div>${dots}</div>${renderInfoCard(b, opts)}</div>`;
  }

  if (t === 'quicklinks') {
    const tiles = (b.items || []).map((it, i) => {
      const inner = `<span class="tlcb-tile-i">${esc(it.meta || '◆')}</span>
        ${itemField(opts, i, 'title', 'span', 'tlcb-tile-t', esc(it.title || ''), ' data-ph="Label"')}`;
      const href = safeUrl(it.url);
      return href && !opts.editing
        ? `<a class="tlcb-tile" href="${esc(href)}">${inner}</a>`
        : `<span class="tlcb-tile">${inner}</span>`;
    }).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-tiles">${tiles}</div></div>`;
  }

  if (t === 'servicetimes') {
    const svc = data.services || [];
    // ⚠ The tiles use .tlcb-tile — the Standout card's own class — so the two
    // are one set of rules rather than two that agree today. They alternate
    // ink navy and gold, which is the design's own pairing and is why the
    // second tile carries its colors inline: the block's single bg cannot
    // express two surfaces.
    if (b.layout === 'tiles' && svc.length) {
      const tiles = svc.slice(0, 4).map((r, i) => {
        const alt = tileAlt(i);
        return `<div class="tlcb-tile"${alt}>
          ${r.note ? `<div class="tlcb-eyebrow">${esc(r.note)}</div>` : ''}
          <div class="tlcb-tile-big">${esc(r.time || '')}</div>
          ${r.day ? `<div class="tlcb-prose">${esc(r.day)}</div>` : ''}
        </div>`;
      }).join('');
      return `<div class="tlcb-stack">${b.title || opts.editing ? renderHead(opts, b) : ''}
        <div class="tlcb-tiles2">${tiles}</div></div>`;
    }
    const rows = svc.map((r) => `<div class="tlcb-svc">
        <span class="tlcb-svc-d">${esc(r.day || '')}</span>
        <span class="tlcb-svc-t">${esc(r.time || '')}</span>
        <span class="tlcb-svc-n">${esc(r.note || '')}</span>
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}
      ${rows ? `<div class="tlcb-svcs">${rows}</div>` : `<p class="tlcb-note">Service times have not been filled in yet — add them under Church details in the admin.</p>`}</div>`;
  }

  if (t === 'sermon') {
    const sm = data.sermon;
    if (!sm) {
      return `<div class="tlcb-stack">${renderHead(opts, b)}<p class="tlcb-note">Nothing in the sermon library yet.</p></div>`;
    }
    // Two states, chosen from the data rather than from a setting the editor
    // has to remember: with a recording it gets a play card, without one it is
    // a text card. The sermon library has no recordings attached today, so the
    // text card is what staff will see — and the block upgrades itself the day
    // a video or audio URL is filled in, with nobody editing a page.
    const id = ytId(sm.youtube_url);
    const play = safeUrl(sm.youtube_url) || safeUrl(sm.audio_url);
    const thumb = id ? `https://img.youtube.com/vi/${esc(id)}/mqdefault.jpg` : '';
    const media = play
      ? `<a class="tlcb-sermon-play${thumb ? '' : ' tlcb-sermon-play--audio'}" href="${esc(play)}"${opts.editing ? ' onclick="return false"' : ' target="_blank" rel="noopener noreferrer"'}
           ${thumb ? `style="background-image:url('${cssUrl(thumb)}')"` : ''}><span>${id ? '▶' : '♪'}</span></a>`
      : '';
    return `<div class="tlcb-stack">${renderHead(opts, b)}
      <div class="tlcb-sermon${play ? '' : ' tlcb-sermon--text'}">
        ${media}
        <div class="tlcb-sermon-b">
          ${sm.series ? `<span class="tlcb-eyebrow">${esc(sm.series)}</span>` : ''}
          <span class="tlcb-sermon-t">${esc(sm.title || '')}</span>
          <span class="tlcb-sermon-m">${esc([sm.date, sm.scripture].filter(Boolean).join(' · '))}</span>
          ${opts.editing ? '<span class="tlcb-note">All sermons</span>' : '<a class="tlcb-sermon-all" href="/sermons">All sermons</a>'}
        </div>
      </div></div>`;
  }

  if (t === 'news') {
    const rows = (data.news || []).slice(0, b.count).map((n) => `<div class="tlcb-news">
        <span class="tlcb-news-d">${esc(fmtNewsDate(n.event_date || n.publish_date, true))}</span>
        <span class="tlcb-news-t">${esc(n.title || '')}</span>
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}
      ${rows ? `<div class="tlcb-rows">${rows}</div>` : `<p class="tlcb-note">No posts yet.</p>`}</div>`;
  }

  if (t === 'newsfeed') {
    const rows = (data.news || []).map((n) => {
      const dateLabel = fmtNewsDate(n.event_date || n.publish_date);
      const hasImage = n.image_url && n.image_url.trim();
      const hasBody = (n.body && n.body.trim()) || n.summary;
      const summary = `<summary>
        <span class="tlcb-nf-head">
          ${n.pinned ? '<span class="tlcb-nf-pin">Pinned</span>' : ''}
          ${dateLabel ? `<span class="tlcb-nf-date">${esc(dateLabel)}</span>` : ''}
          <span class="tlcb-nf-title">${esc(n.title || '')}</span>
        </span>
        ${hasBody ? '<span class="tlcb-nf-chev" aria-hidden="true"></span>' : ''}
      </summary>`;
      const body = hasBody ? `<div class="tlcb-nf-body">
        ${hasImage ? `<img src="${esc(n.image_url)}" alt="" loading="lazy">` : ''}
        ${n.summary ? `<p>${esc(n.summary)}</p>` : ''}
        ${n.body ? `<div class="rich-content">${n.body}</div>` : ''}
      </div>` : '';
      return `<details class="tlcb-nf-item"${opts.editing ? ' open' : ''}>${summary}${body}</details>`;
    }).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}
      ${rows ? `<div class="tlcb-nf-list">${rows}</div>` : `<p class="tlcb-note">No current announcements or events.</p>`}</div>`;
  }

  if (t === 'newsletterarchive') {
    const issues = data.newsletters || [];
    // Only the most recent b.count issues carry a preview (the pastor's note,
    // truncated) — the rest are a plain title-and-date row. A newsletter
    // archive that previews every issue back to launch is a wall of text
    // nobody scrolls through; a bare list of every issue loses the one thing
    // that gets somebody to click "Read this letter" on THIS week's.
    const open = issues.slice(0, b.count);
    const rest = issues.slice(b.count);

    const card = (n) => {
      const note = (n.pastor_note || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
      return `<div class="tlcb-nl-item">
        <span class="tlcb-nl-date">${esc(fmtNewsDate(n.published_at))}</span>
        <span class="tlcb-nl-subj">${esc(n.subject || '')}</span>
        ${note ? `<p class="tlcb-nl-note">${esc(note)}${note.length >= 220 ? '…' : ''}</p>` : ''}
        <a class="tlcb-nl-link" href="/news/${esc(n.id)}"${opts.editing ? ' onclick="return false"' : ''}>Read this letter</a>
      </div>`;
    };
    const row = (n) => `<a class="tlcb-nl-row" href="/news/${esc(n.id)}"${opts.editing ? ' onclick="return false"' : ''}>
      <span class="tlcb-nl-row-d">${esc(fmtNewsDate(n.published_at, true))}</span>
      <span class="tlcb-nl-row-t">${esc(n.subject || '')}</span>
    </a>`;

    // ── Everything older than the open ones folds away, a month at a time ──
    // The archive used to print a title row for every issue it had, which on a
    // WEEKLY letter is a column of near-identical lines that grows forever and
    // buries the block under it. Grouping by month turns a year into twelve
    // closed rows, and the month is the unit somebody actually remembers a
    // letter by.
    //
    // ⚠ The group key is the raw `YYYY-MM` off the stored string, NOT a month
    // read back out of a Date. Constructing a date and asking it for its month
    // puts an issue published on the 1st into the previous month for anybody
    // behind UTC — the archive would be correct in St. Louis and wrong in the
    // Worker that renders it. The LABEL still goes through fmtNewsDate's noon
    // anchoring for the same reason.
    const groups = [];
    for (const n of rest) {
      const key = String(n.published_at || '').slice(0, 7);
      let g = groups.find((x) => x.key === key);
      if (!g) {
        const d = new Date(key + '-01T12:00:00');
        groups.push(g = {
          key,
          label: Number.isNaN(d.getTime()) ? 'Earlier' : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          items: [],
        });
      }
      g.items.push(n);
    }
    // <details> rather than a script: it opens with no JavaScript at all, it is
    // a keyboard control and a screen-reader control for free, and it behaves
    // the same in the editor canvas as on the live page. Every one starts
    // closed — the point of the block is this week's letter.
    const months = groups.map((g) => `<details class="tlcb-nl-month">
      <summary class="tlcb-nl-msum">${esc(g.label)}<span class="tlcb-nl-mcount">${g.items.length}</span></summary>
      <div class="tlcb-nl-mlist">${g.items.map(row).join('')}</div>
    </details>`).join('');

    const body = open.map(card).join('') + months;
    return `<div class="tlcb-stack">${renderHead(opts, b)}
      ${body ? `<div class="tlcb-nl-list">${body}</div>` : `<p class="tlcb-note">No newsletters yet.</p>`}</div>`;
  }

  if (t === 'staff') {
    // ⚠ NOT sliced to b.count. See the note on the type: this is the directory,
    // and every block carries a count of 3 by default whether or not its type
    // has a control for one — so slicing here silently dropped five of the
    // church's eight staff the moment /about was published from the editor.
    // ⚠ An <img>, not a background-image, and that is what makes the crop
    // possible: object-position plus a scale() is the exact mechanism the Staff
    // screen's picker writes and every other staff photo on the site reads. A
    // background can be positioned but cannot be zoomed the same way, so the
    // block would have had to approximate a framing somebody chose by eye.
    const person = (m) => {
      const pos = isSafeObjectPosition(m.photo_position) ? m.photo_position : '50% 50%';
      const zoom = safeZoomFactor(m.photo_zoom);
      // Somebody with no photo keeps the plain tile the block always drew,
      // rather than an <img> pointing at nothing.
      const photo = m.photo_url
        ? `<img src="${esc(safeUrl(m.photo_url))}" alt="${esc(m.name || '')}" loading="lazy"
             style="object-position:${pos};transform:scale(${zoom})">`
        : '';
      return `<div class="tlcb-person">
        <span class="tlcb-person-p">${photo}</span>
        <span class="tlcb-person-n">${esc(m.name || '')}</span>
        <span class="tlcb-person-r">${esc(m.title || '')}</span>
      </div>`;
    };
    const people = (data.staff || []).map(person).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}
      ${people ? `<div class="tlcb-people">${people}</div>` : `<p class="tlcb-note">The staff directory is empty.</p>`}</div>`;
  }

  if (t === 'classes') {
    const rows = Array.isArray(data.classes) ? data.classes : [];
    // ⚠ The accent is a KEY from a short list, resolved here to one of the
    // site's own colors. The Christian Ed screen stores 'teal' or 'sage', never
    // a hex — so there is no way for a class to introduce a color the site does
    // not use, and no way for a stored value to reach a style attribute.
    const ACCENT = { mid: '#2E7EA6', teal: '#2E7EA6', steel: '#1E2D4A', sage: '#4A5E3A', amber: '#C9973A', plum: '#8A6A8A' };
    const cards = rows.map((c) => {
      const accent = ACCENT[c.accent] || 'var(--tlcb-eyebrow-ink,#2E7EA6)';
      const when = [c.schedule, c.location].filter(Boolean);
      return `<div class="tlcb-cl-card">` +
        (c.label ? `<div class="tlcb-cl-eyebrow" style="color:${esc(accent)}">${esc(c.label)}</div>` : '') +
        `<div class="tlcb-cl-t">${esc(c.title || '')}</div>` +
        (c.description ? `<p class="tlcb-cl-d">${esc(c.description)}</p>` : '') +
        (c.leader ? `<div class="tlcb-cl-m">Led by ${esc(c.leader)}</div>` : '') +
        (when.length ? `<div class="tlcb-cl-w">${esc(when[0])}` +
          (when[1] ? `<span>${esc(when[1])}</span>` : '') + `</div>` : '') +
        `</div>`;
    }).join('');
    const body = cards
      ? `<div class="tlcb-cl">${cards}</div>`
      : `<p class="tlcb-note">No classes running yet — add them under Christian Ed in the admin.</p>`;
    return `<div class="tlcb-stack" style="gap:9px">${renderHead(opts, b)}` +
      `${renderBody(opts, b, def, 'One line about who these are for, if it helps.')}${body}</div>`;
  }

  if (t === 'sermonlist') {
    const series = Array.isArray(data.sermonSeries) ? data.sermonSeries : [];
    const loose = Array.isArray(data.sermonLoose) ? data.sermonLoose : [];
    // One sermon row, shared by a series and by the standalone list below, so
    // the two cannot come to look different.
    const row = (n) => {
      const play = safeUrl(n.youtube_url) || safeUrl(n.audio_url);
      const meta = [n.date, n.scripture].filter(Boolean).join(' · ');
      const label = ytId(n.youtube_url) ? 'Watch' : (safeUrl(n.audio_url) ? 'Listen' : '');
      // ⚠ Not a link when there is no recording. Most of this library is text
      // only today, and a "Watch" that goes nowhere is the dead link this
      // repo's own rule is about.
      const go = play && !opts.editing
        ? `<a class="tlcb-sl-go" href="${esc(play)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
        : (play ? `<span class="tlcb-sl-go">${esc(label)}</span>` : '');
      return `<div class="tlcb-sl-row"><span class="tlcb-sl-b">` +
        `<span class="tlcb-sl-t">${esc(n.title || '')}</span>` +
        (meta ? `<span class="tlcb-sl-m">${esc(meta)}</span>` : '') +
        `</span>${go}</div>`;
    };
    const groups = series.filter((se) => (se.sermons || []).length).map((se) => {
      // ⚠ <details>, not a script — the same choice the newsletter archive
      // made. It opens with no JavaScript at all, it is a keyboard and
      // screen-reader control for free, and it behaves identically in the
      // editor canvas and on the live page.
      const open = (b.openFirst !== false && se.active) || opts.editing;
      const count = (se.sermons || []).length;
      return `<details class="tlcb-sl-set"${open ? ' open' : ''}>
        <summary class="tlcb-sl-sum"><span class="tlcb-sl-name">${esc(se.title || '')}</span>` +
        `<span class="tlcb-sl-c">${esc(se.dates || '')}${se.dates ? ' · ' : ''}${count} sermon${count === 1 ? '' : 's'}</span></summary>` +
        (se.description ? `<p class="tlcb-sl-d">${esc(se.description)}</p>` : '') +
        `<div class="tlcb-sl-rows">${(se.sermons || []).map(row).join('')}</div></details>`;
    }).join('');
    const singles = loose.length
      ? `<details class="tlcb-sl-set"${opts.editing ? ' open' : ''}>
          <summary class="tlcb-sl-sum"><span class="tlcb-sl-name">Other sermons</span>` +
        `<span class="tlcb-sl-c">${loose.length} sermon${loose.length === 1 ? '' : 's'}</span></summary>` +
        `<div class="tlcb-sl-rows">${loose.map(row).join('')}</div></details>`
      : '';
    const body = groups || singles
      ? `<div class="tlcb-sl">${groups}${singles}</div>`
      : `<p class="tlcb-note">Nothing in the sermon library yet — add a series and its sermons under Sermons in the admin.</p>`;
    return `<div class="tlcb-stack" style="gap:9px">${renderHead(opts, b)}` +
      `${renderBody(opts, b, def, 'One line about the preaching here, if it helps.')}${body}</div>`;
  }

  if (t === 'contact') {
    const st = data.settings || {};
    const rows = [];
    const line = (label, value, href) => {
      if (!value) return;
      rows.push(`<div class="tlcb-ct-row"><span class="tlcb-ct-l">${esc(label)}</span>` +
        (href
          ? `<a class="tlcb-ct-v tlcb-ct-a" href="${esc(href)}">${esc(value)}</a>`
          : `<span class="tlcb-ct-v">${esc(value)}</span>`) + '</div>');
    };
    if (b.showAddress !== false) {
      const addr = [st.address_line, st.address_city].filter(Boolean).join(' · ');
      if (addr) {
        const maps = `https://maps.google.com/?q=${encodeURIComponent([st.address_line, st.address_city].filter(Boolean).join(', '))}`;
        line('Address', addr, maps);
        // The landmark is how somebody finds the door from the road. It hangs
        // under the address rather than taking a label of its own.
        if (st.address_near) rows.push(`<div class="tlcb-ct-row tlcb-ct-row--sub"><span class="tlcb-ct-l"></span><span class="tlcb-ct-v">${esc(st.address_near)}</span></div>`);
      }
    }
    // ⚠ tel: strips everything but the digits. "(314) 781-8673" is what a
    // person should READ, and what a phone should DIAL is 3147818673 — a href
    // carrying the brackets and the space is one some dialers refuse.
    if (st.phone) line('Phone', st.phone, 'tel:' + String(st.phone).replace(/[^\d+]/g, ''));
    // The block's own address when somebody has set one, the church's when not.
    const email = b.contactEmail || st.email || '';
    if (email) line('Email', email, 'mailto:' + email);
    if (b.showSocial !== false) {
      // Named links rather than icons: an icon needs a label for a screen
      // reader anyway, and three words are clearer than three glyphs to the
      // congregation this is written for.
      for (const [label, url] of [['Facebook', st.facebook], ['Instagram', st.instagram], ['YouTube', st.youtube]]) {
        const href = safeUrl(url);
        // A blank account is left off entirely — see the seed note. A row
        // reading "Instagram —" tells nobody anything.
        if (href) line(label, label === 'YouTube' ? 'Watch on YouTube' : 'Follow on ' + label, href);
      }
    }
    const body = rows.length
      ? `<div class="tlcb-ct">${rows.join('')}</div>`
      : `<p class="tlcb-note">Nothing to show yet — fill in the address, phone and email under Church details in the admin.</p>`;
    return `<div class="tlcb-stack" style="gap:9px">${renderHead(opts, b)}${renderBody(opts, b, def, 'One line about when the office is open, if it helps.')}${body}</div>`;
  }

  if (t === 'map') {
    const st = data.settings || {};
    const addr = [st.address_line, st.address_city].filter(Boolean).join(', ');
    const q = encodeURIComponent(addr || 'Timothy Lutheran Church St. Louis');
    const frame = opts.editing
      ? `<span class="tlcb-map-ph">Map</span>`
      : `<iframe class="tlcb-map-f" src="https://www.google.com/maps?q=${q}&output=embed" title="Map" loading="lazy"></iframe>`;
    // ⚠ HALF WIDTH IS A DIFFERENT LAYOUT, NOT A NARROWER ONE. The full-width
    // block is a two-column grid — map beside the text — and squeezing that
    // into half a page gives two columns of about 170px each, which is too
    // narrow for a street address and far too narrow for a map. So at half
    // width it stacks: the heading and the paragraph, then ONE card carrying
    // the address, the link out and the map beneath it.
    //
    // Everything in the card reads the church-details record, same as the
    // welcome card and the sidebar layout — change the address once and every
    // map block on the site follows.
    if (b.width === 'half') {
      const maps = `https://maps.google.com/?q=${q}`;
      const lines = [
        st.name ? `<div class="tlcb-mapc-name">${esc(st.name)}</div>` : '',
        // A middot rather than the comma `addr` uses: that string also feeds the
        // Google Maps query, where a comma is what separates the parts.
        (st.address_line || st.address_city)
          ? `<div class="tlcb-mapc-line">${esc([st.address_line, st.address_city].filter(Boolean).join(' · '))}</div>` : '',
        st.address_near ? `<div class="tlcb-mapc-line">${esc(st.address_near)}</div>` : '',
      ].filter(Boolean).join('');
      const body = lines
        ? lines + `<a class="tlcb-mapc-link" href="${esc(maps)}">Open in Google Maps</a>`
        : '<span class="tlcb-note">Add the church address under Church details in the admin.</span>';
      return `<div class="tlcb-stack" style="gap:9px">${renderHead(opts, b)}${renderBody(opts, b, def)}
        <div class="tlcb-mapc">${body}<div class="tlcb-map tlcb-mapc-frame">${frame}</div></div>
      </div>`;
    }
    return `<div class="tlcb-grid">
      <div class="tlcb-media tlcb-map">${frame}</div>
      <div class="tlcb-stack" style="gap:9px">${renderHead(opts, b)}${renderBody(opts, b, def)}
        <div class="tlcb-addr">
          ${addr ? `<span>${esc(addr)}</span>` : ''}
          ${st.phone ? `<span>${esc(st.phone)}</span>` : ''}
          ${st.email ? `<span>${esc(st.email)}</span>` : ''}
          ${addr || st.phone || st.email ? '' : '<span class="tlcb-note">Add the church address under Church details in the admin.</span>'}
        </div>
      </div></div>`;
  }

  if (t === 'hero') {
    const change = opts.editing
      ? `<button type="button" class="tlcb-pick" data-act="photo">Change photo</button>` : '';
    return `<div class="tlcb-hero${cardClass(b)}">${change}
      <div class="tlcb-band-text">
      ${field(opts, b, 'eyebrow', 'div', 'tlcb-hero-eyebrow', esc(b.eyebrow || ''), ' data-ph="Ministry"')}
      ${field(opts, b, 'title', 'h1', 'tlcb-hero-title', esc(b.title || ''), ' data-ph="Page title"')}
      ${field(opts, b, 'subtitle', 'p', 'tlcb-hero-sub', b.subtitle || '', ' data-ph="One line about this ministry" data-rich-line="1"', true)}
      </div>${renderInfoCard(b, opts)}
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
        ${itemField(opts, i, 'title', 'div', 'tlcb-head', esc(it.title || ''), ' data-ph="Column heading" style="font-size:calc(var(--tlcb-head,22px) * .8)"')}
        ${itemField(opts, i, 'body', 'div', 'tlcb-prose', it.body || '', ' data-ph="What happens here"', true)}
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-cols">${cells}</div></div>`;
  }

  if (t === 'cardgrid') {
    const cards = (b.items || []).map((it, i) => {
      // Contained at its own aspect and never cropped: these are logos as often
      // as photos, and /ministries mixes a wordmark, a roundel and a
      // photograph — a square crop would ruin at least one of the three.
      const img = it.img
        ? `<div class="tlcb-cg-img"><img src="${esc(it.img)}" alt="${esc(it.title || '')}" loading="lazy"></div>`
        : '';
      const eyebrow = itemField(opts, i, 'eyebrow', 'div', 'tlcb-cg-eyebrow', esc(it.eyebrow || ''), ' data-ph="SMALL LABEL"');
      const head = itemField(opts, i, 'title', 'div', 'tlcb-cg-head', esc(it.title || ''), ' data-ph="Card heading"');
      const body = itemField(opts, i, 'body', 'div', 'tlcb-prose tlcb-cg-body', it.body || '', ' data-ph="One short paragraph."', true);
      // ⚠ THE WHOLE CARD IS THE LINK, not the words at the bottom of it. The
      // card lifts on hover and reads as one clickable object, and only the
      // "Learn more" was ever clickable — so a click anywhere else did nothing
      // and the card looked broken. The label stays, because it says WHERE the
      // card goes; it is just no longer the only target.
      //
      // ⚠ It is an <a> only on the public page. In the editor the card has to
      // stay a <div>: the heading and body inside it are contenteditable, and
      // clicking into them inside an anchor navigates instead of typing.
      const href = safeUrl(it.url);
      const linked = !!href && !opts.editing;
      // ⚠ A card with nowhere to go LOSES THE HOVER. Lifting under the pointer
      // is a promise that clicking does something, and the whole complaint here
      // was a card that made that promise and broke it. The class follows the
      // href rather than `linked`, so the editor shows the same lift the
      // visitor will get.
      const cls = 'tlcb-cg-card' + (href ? ' tlcb-cg-card--link' : '');
      // The arrow is part of the label the office types, so "Learn more",
      // "Visit MDO site" and "Watch video" all work with no setting for it.
      // ⚠ Never a nested <a>. Inside a linked card the label is a span that
      // merely looks like a link — the card around it is the real one.
      const link = it.linkLabel
        ? (opts.editing
            ? itemField(opts, i, 'linkLabel', 'div', 'tlcb-cg-link', esc(it.linkLabel), ' data-ph="Learn more"')
            : linked
              ? `<span class="tlcb-cg-link">${esc(it.linkLabel)}</span>`
              // No href: still not a link. A dead link is worse than a missing
              // one, and `href="#"` is exactly the dead link this repo's own
              // rule is about.
              : `<span class="tlcb-cg-link tlcb-cg-link--off">${esc(it.linkLabel)}</span>`)
        : '';
      const open = linked ? `<a class="${cls}" href="${esc(href)}">` : `<div class="${cls}">`;
      return `${open}${img}${eyebrow}${head}${body}<div class="tlcb-cg-foot">${link}</div>${linked ? '</a>' : '</div>'}`;
    }).join('');
    const intro = b.subtitle
      ? field(opts, b, 'subtitle', 'div', 'tlcb-cg-intro', esc(b.subtitle), ' data-ph="One short paragraph of introduction."')
      : (opts.editing ? field(opts, b, 'subtitle', 'div', 'tlcb-cg-intro', '', ' data-ph="One short paragraph of introduction."') : '');
    return `<div class="tlcb-stack tlcb-cg${b.align === 'left' ? '' : ' tlcb-cg--' + b.align}${b.topRule ? ' tlcb-cg--rule' : ''}">
      ${renderHead(opts, b, 'Section heading')}${intro}
      <div class="tlcb-cg-grid">${cards}</div>
    </div>`;
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
    // ⚠ A BUTTON ON THE PUBLIC PAGE, A PLAIN IMAGE IN THE EDITOR — the same
    // split the card grid makes with its anchor, and for the same reason:
    // inside the editor a click on a photograph has to select the block, and a
    // button would swallow it. It is a real button rather than an image with a
    // click handler because a handler on an image is not reachable by keyboard
    // at all — the fault the accessibility pass found on the header logo.
    const tiles = (b.items || []).length
      ? b.items.map((it) => {
        if (!it.url) return `<span></span>`;
        const photo = `<img src="${esc(it.url)}" alt="${esc(it.title || '')}" loading="lazy">`;
        return opts.editing ? photo
          : `<button type="button" class="tlcb-gal-open" aria-label="${esc(it.title ? 'View photo: ' + it.title : 'View photo')}">${photo}</button>`;
      }).join('')
      : `<span></span><span></span><span></span>`;
    const pick = opts.editing ? `<button type="button" class="tlcb-pick tlcb-pick--inline" data-act="gallery">Manage photos</button>` : '';
    // Only where there is something to open. An empty gallery ships no script.
    const lb = !opts.editing && (b.items || []).some((it) => it.url) ? LIGHTBOX_SCRIPT : '';
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-gallery">${tiles}</div>${pick}${lb}</div>`;
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
    if (b.layout === 'tiles' && (b.items || []).length) {
      const tiles = (b.items || []).map((it, i) => `<div class="tlcb-tile"${tileAlt(i)}>
          ${itemField(opts, i, 'title', 'div', 'tlcb-tile-t', esc(it.title || ''), ' data-ph="Who"')}
          ${itemField(opts, i, 'body', 'div', 'tlcb-prose', esc(it.body || ''), ' data-ph="When"')}
          ${itemField(opts, i, 'meta', 'div', 'tlcb-tile-m', esc(it.meta || ''), ' data-ph="Where"')}
        </div>`).join('');
      return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-tiles-n">${tiles}</div></div>`;
    }
    const rows = (b.items || []).map((it, i) => `<div class="tlcb-time">
        ${itemField(opts, i, 'title', 'b', '', esc(it.title || ''), ' data-ph="Who"')}
        ${itemField(opts, i, 'body', 'i', '', esc(it.body || ''), ' data-ph="When"')}
        ${itemField(opts, i, 'meta', 'u', '', esc(it.meta || ''), ' data-ph="Where"')}
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-times">${rows}</div></div>`;
  }

  if (t === 'tiles') {
    const tiles = (b.items || []).map((it, i) => `<div class="tlcb-tile"${tileAlt(i)}>
        ${itemField(opts, i, 'big', 'div', 'tlcb-tile-big', esc(it.big || ''), ' data-ph="8:00"')}
        ${itemField(opts, i, 'title', 'div', 'tlcb-tile-t', esc(it.title || ''), ' data-ph="Tile heading"')}
        ${itemField(opts, i, 'body', 'div', 'tlcb-prose', it.body || '', ' data-ph="One short line."', true)}
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-tiles-n">${tiles}</div></div>`;
  }

  if (t === 'faq') {
    const rows = (b.items || []).map((it, i) => `<details class="tlcb-faq"${opts.editing ? ' open' : ''}>
        <summary>${itemField(opts, i, 'title', 'span', '', esc(it.title || ''), ' data-ph="A question people ask"')}</summary>
        ${itemField(opts, i, 'body', 'div', 'tlcb-prose', it.body || '', ' data-ph="The answer"', true)}
      </details>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-rows">${rows}</div></div>`;
  }

  if (t === 'lessons') {
    // ⚠ Open in the editor, closed on the page. Somebody arranging a lesson
    // cannot type into a body they cannot see; a visitor wants the list.
    const rows = (b.items || []).map((it, i) => {
      const href = safeUrl(it.url);
      // ⚠ No address, no link — rather than a Handout that goes nowhere. The
      // dead-link rule, same as the sermon library's missing recording.
      const sheet = href && !opts.editing
        ? `<a class="tlcb-lesson-dl" href="${esc(href)}">Handout</a>` : '';
      return `<details class="tlcb-lesson"${opts.editing ? ' open' : ''}>
        <summary><span class="tlcb-lesson-w">${itemField(opts, i, 'meta', 'span', '', esc(it.meta || ''), ' data-ph="Week 1"')}</span>` +
        `<span class="tlcb-lesson-t">${itemField(opts, i, 'title', 'span', '', esc(it.title || ''), ' data-ph="What this one is about"')}</span></summary>
        ${itemField(opts, i, 'body', 'div', 'tlcb-prose', it.body || '', ' data-ph="The notes"', true)}
        ${sheet}
      </details>`;
    }).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-rows">${rows}</div></div>`;
  }

  if (t === 'portal') {
    const href = safeUrl(b.url) || 'https://connect.timothystl.org';
    const go = opts.editing
      ? `<span class="tlcb-btn">Sign in</span>`
      : `<a class="tlcb-btn" href="${esc(href)}">Sign in</a>`;
    return `<div class="tlcb-portal">
      ${b.subtitle || opts.editing ? field(opts, b, 'subtitle', 'span', 'tlcb-eyebrow', esc(b.subtitle || ''), ' data-ph="Timothy Connect"') : ''}
      ${renderHead(opts, b)}
      ${renderBody(opts, b, def, 'What somebody finds behind the sign-in')}
      <div class="tlcb-btns">${go}</div>
    </div>`;
  }

  if (t === 'callout') {
    return `<div class="tlcb-callout${cardClass(b)}">
      <div class="tlcb-band-text">
      <span class="tlcb-callout-tag">Please note</span>
      ${field(opts, b, 'title', 'div', 'tlcb-callout-t', esc(b.title || ''), ' data-ph="What people need to know"')}
      ${renderBody(opts, b, def)}
      </div>${renderInfoCard(b, opts)}
    </div>`;
  }

  if (t === 'buttons') {
    const btns = (b.items || []).map((it, i) => {
      const cls = 'tlcb-btn' + (i > 0 ? ' tlcb-btn--ghost' : '');
      if (opts.editing) return itemField(opts, i, 'title', 'span', cls, esc(it.title || ''), ' data-ph="Button label"');
      const href = safeUrl(it.url);
      return href ? `<a class="${cls}" href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(it.title || '')}</a>`
        : `<span class="${cls}">${esc(it.title || '')}</span>`;
    }).join('');
    // ⚠ The head is CONDITIONAL, and that is what keeps every existing Button
    // bar unchanged. renderHead/renderBody always emit their element so the
    // editor has something to click into; on the live site an empty one would
    // be a stray blank line above the buttons on pages nobody has touched.
    const hasHead = !!(b.eyebrow || b.title || (b.body || '').replace(/<[^>]*>/g, '').trim());
    if (!opts.editing && !hasHead) return `<div class="tlcb-btns">${btns}</div>`;
    return `<div class="tlcb-stack">${renderHead(opts, b, 'Heading (optional)')}${renderBody(opts, b, def, 'A sentence about why (optional)')}<div class="tlcb-btns">${btns}</div></div>`;
  }

  if (t === 'spacer') {
    return opts.editing
      ? `<div class="tlcb-spacer" style="border:1px dashed #C4CEDF;border-radius:7px;display:flex;align-items:center;justify-content:center;font:600 11px/1 var(--tlcb-ui);color:#A8A69A;letter-spacing:.1em">${b.height}PX SPACE</div>`
      : `<div class="tlcb-spacer"></div>`;
  }

  if (t === 'partners') {
    // From the record, or hand-typed. Both end up as the same {title,url,logo}
    // shape so there is one row renderer below, not two that drift apart.
    let rows;
    if (b.source === 'record') {
      const chosen = new Set(b.partnerIds || []);
      rows = (data.partners || [])
        .filter((p) => !chosen.size || chosen.has(p.id))
        .map((p) => ({ title: p.name, url: p.url, logo: p.logo }));
    } else {
      rows = (b.items || []).map((it) => ({ title: it.title, url: it.url, logo: it.meta }));
    }
    if (!rows.length) {
      // Says what is missing and where to fix it, rather than rendering an
      // empty strip that reads as a broken page.
      const why = b.source === 'record'
        ? 'No partner ministries yet — add them under Partners in the admin.'
        : 'No logos added yet.';
      return `<div class="tlcb-stack">${renderHead(opts, b)}${opts.editing ? `<p class="tlcb-note">${why}</p>` : ''}</div>`;
    }
    const logos = rows.map((r) => {
      const logo = safeUrl(r.logo);
      const inner = logo ? `<img src="${esc(logo)}" alt="${esc(r.title || '')}" loading="lazy">` : esc(r.title || 'LOGO');
      const href = safeUrl(r.url);
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
      <span class="tlcb-dl-b">${field(opts, b, 'title', 'span', 'tlcb-dl-t', esc(b.title || ''), ' data-ph="What the file is"')}
        <span class="tlcb-dl-m">${href ? esc(href.split('/').pop().slice(0, 60)) : 'No file chosen yet'}</span></span>
      ${btn}
    </div>`;
  }

  if (t === 'documents') {
    // The single-file version of the row above, reused per row: same
    // .tlcb-dl markup, so a list of documents and one File download block
    // never come to look like two different ideas of what a file link is.
    const rows = (b.items || []).map((it, i) => {
      const href = safeUrl(it.url);
      const dl = href && !opts.editing
        ? `<a class="tlcb-btn tlcb-btn--ghost" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Download</a>`
        : `<span class="tlcb-btn tlcb-btn--ghost">Download</span>`;
      return `<div class="tlcb-dl">
        <span class="tlcb-dl-i">${href && /\.pdf($|\?)/i.test(href) ? 'PDF' : 'FILE'}</span>
        <span class="tlcb-dl-b">${itemField(opts, i, 'title', 'span', 'tlcb-dl-t', esc(it.title || ''), ' data-ph="What the file is"')}
          <span class="tlcb-dl-m">${href ? esc(href.split('/').pop().slice(0, 60)) : 'No file chosen yet'}</span></span>
        ${dl}
      </div>`;
    }).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b, 'Downloads')}<div class="tlcb-rows">${rows}</div></div>`;
  }

  if (t === 'calendar') {
    // ⚠ Gated here too, not only in sanitizeBlock — a block saved before the
    // host allowlist existed still has whatever https address was posted at
    // it back then, and render is the one place that data is guaranteed to
    // pass through this before ever reaching an iframe.
    const src = allowedEmbedSrc(b.url);
    // ⚠ THE CONTROL WAS DEAD. "How tall" has been on this block's inspector
    // since it shipped, stored on every save, and read by nothing — the height
    // was hardcoded at 520px. Somebody choosing Tall watched nothing happen,
    // which is worse than not offering the choice: they believe it worked and
    // stop looking.
    const px = (EMBED_HEIGHTS.find((h) => h.key === b.embedHeight) || EMBED_HEIGHTS[1]).px;

    // ⚠ A GOOGLE CALENDAR ADDRESS — OR NONE AT ALL — MEANS THE CHURCH
    // CALENDAR, AND THE CHURCH CALENDAR IS NOT AN EMBED ANY MORE.
    //
    // This is the gap that made the whole v5.29.0 feature invisible on the one
    // page it was built for. /calendar had been PUBLISHED from the page editor
    // with one of these blocks on it, so the SPA's takeover hid the hardcoded
    // mount and rendered this block instead — a Google iframe, complete with
    // the "N more" cap the feature exists to remove. The page looked exactly
    // as it had before, and every test passed, because they all drove the
    // hardcoded page nobody was being served.
    //
    // So a calendar block now renders a MOUNT for the site's own month.
    // ⚠ It is still an embed for anything else: this field also takes a Google
    // Form and other embeds, and those have nothing to do with the church
    // calendar. That is the whole reason the test is on the ADDRESS rather
    // than on the block type.
    const isChurchCalendar = !src || /^https?:\/\/calendar\.google\.com\//i.test(src);
    if (isChurchCalendar) {
      // ⚠ In the editor the canvas has neither the site's stylesheet nor its
      // calendar script, so a bare mount would read as a block that renders
      // nothing. It says what will be there instead.
      const inner = opts.editing
        ? `<div style="border:1px solid #DDE3ED;border-radius:9px;padding:26px;text-align:center;background:#F7F3EC;color:#8A8898;font-size:13px">The church calendar — the month, drawn by the site from the Google calendars and News &amp; Events together. Nothing to paste.</div>`
        : `<div class="tlc-cal-mount" data-tlc-calendar></div>`;
      return `<div class="tlcb-stack">${renderHead(opts, b)}${inner}</div>`;
    }
    const inner = src && !opts.editing
      ? `<iframe src="${esc(src)}" title="${esc(b.title || 'Calendar')}" loading="lazy" style="width:100%;height:${px}px;border:0;border-radius:9px"></iframe>`
      : `<div style="border:1px solid #DDE3ED;border-radius:9px;padding:26px;text-align:center;background:#F7F3EC;color:#8A8898;font-size:13px">Embed</div>`;
    return `<div class="tlcb-stack">${renderHead(opts, b)}${inner}</div>`;
  }

  if (t === 'form') {
    // ⚠ Gated here too, same reasoning as Calendar above — a block saved
    // before the allowlist existed still has whatever was posted at it then.
    const src = allowedEmbedSrc(b.url);
    // ⚠ A VISITOR NEVER SEES A FAKE FIELD OR A FAKE BUTTON. The editing-mode
    // mockup (two blank boxes, a "Sign up" pill) exists so whoever is
    // configuring this block can see roughly what it will look like once a
    // Google Form URL is pasted in — it was never meant to reach the public
    // page. It did anyway: published with no url, the .tlcb-btn class is
    // exactly what a real button looks like, and .tlcb-field reads as a real
    // input, so a visitor sees what appears to be a working form with nothing
    // behind either control. That is the dead-control rule broken — a block
    // that renders nothing is honest; a block that renders something inert
    // and interactive-looking is not. An unconfigured block now renders only
    // its own head/body in public and says nothing else.
    let inner;
    if (src && !opts.editing) {
      inner = `<iframe src="${esc(src)}" title="${esc(b.title || 'Form')}" loading="lazy" style="width:100%;height:640px;border:0;border-radius:9px"></iframe>`;
    } else if (opts.editing) {
      inner = `<div class="tlcb-stack" style="gap:9px"><span class="tlcb-field"></span><span class="tlcb-field"></span>
          <span class="tlcb-btn" style="align-self:flex-start;background:#2E7EA6;border-color:#2E7EA6;color:#fff">Sign up</span>
          <span class="tlcb-note">${src ? 'Form embed' : 'Paste a Google Form URL in the panel on the right.'}</span></div>`;
    } else {
      inner = '';
    }
    return `<div class="tlcb-panel">${renderHead(opts, b)}${renderBody(opts, b, def)}${inner}</div>`;
  }

  if (t === 'embed') {
    // ⚠ THERE IS NO THIRD STATE HERE, ONLY TWO. An address off the allowlist
    // is dropped at the sanitizer (see sanitizeBlock, above) — never stored —
    // so by the time a block reaches render, "nothing pasted yet" and
    // "something was pasted and refused" are the same fact: b.url is blank
    // either way. Telling those apart would mean keeping the rejected value
    // around just to explain itself, which is the thing this allowlist
    // exists to stop doing. The inspector's own standing note (not this
    // render branch) is where "that address isn't on the list" belongs,
    // said before anything is ever saved.
    const src = allowedEmbedSrc(b.url);
    const px = (EMBED_HEIGHTS.find((h) => h.key === b.embedHeight) || EMBED_HEIGHTS[1]).px;
    const inner = src && !opts.editing
      ? `<iframe src="${esc(src)}" title="${esc(b.title || 'Embed')}" loading="lazy" style="width:100%;height:${px}px;border:0;border-radius:9px"></iframe>`
      : `<div style="border:1px solid #DDE3ED;border-radius:9px;padding:26px;text-align:center;background:#F7F3EC;color:#8A8898;font-size:13px">${src ? 'Embed' : 'Paste an embed code, or the address it points to, in the panel on the right.'}</div>`;
    return `<div class="tlcb-stack">${renderHead(opts, b)}${renderBody(opts, b, def)}${inner}</div>`;
  }

  if (t === 'newsletter') {
    const form = opts.editing
      ? `<div class="tlcb-inline"><span class="tlcb-field" style="line-height:38px;color:#8A8898">you@email.com</span><span class="tlcb-btn">Subscribe</span></div>`
      : `<form class="tlcb-inline" method="POST" action="https://admin.timothystl.org/api/subscribe" target="_blank">
          <input class="tlcb-field" type="email" name="email" placeholder="you@email.com" required aria-label="Email address">
          <button class="tlcb-btn" type="submit">Subscribe</button></form>`;
    return `<div class="tlcb-panel">${renderHead(opts, b)}${renderBody(opts, b, def)}${form}</div>`;
  }

  if (t === 'give') {
    // ⚠ A FUND IS AN ID HERE, NEVER A URL. Dinger asked for a Give button that
    // lands on a named fund — the CCS appeal generalized, which until now was
    // two buttons hand-wired in public/index.html and rewritten in the browser.
    // Storing the fund's id and resolving it against the Giving screen's base
    // link at render time is what keeps the settled rule intact: a block's URL
    // is frozen the moment it is published, so a stored Tithe.ly address would
    // go on charging to the old form after the office changed the base link,
    // and the page would still look perfect.
    const give = data.give || {};
    const fund = b.giveFund
      ? (Array.isArray(give.funds) ? give.funds : []).find((f) => Number(f.id) === Number(b.giveFund))
      : null;
    // Falls back to the plain hand-off when the fund has gone away, or has no
    // Tithe.ly id, or the base link is unset — give.timothystl.org still takes
    // the gift, it just asks which fund. A button that takes money is never
    // traded for one that errors.
    const fundHref = fund && fund.tithelyFundId && give.baseUrl
      ? withFund(give.baseUrl, fund.tithelyFundId) : '';
    const href = fundHref || safeUrl(b.url) || 'https://give.timothystl.org';
    // Just the one button — an amount is a choice give.timothystl.org's own
    // widget already asks for; suggesting one here duplicated that page
    // instead of just handing off to it.
    // ⚠ NOT EVERY USE OF THIS BUTTON IS A GIFT. A market table fee, a VBS
    // registration, a gym deposit are all payments this block can be aimed
    // at, and "Give now" is the wrong word on every one of them — a typed
    // buttonText replaces the computed wording outright rather than being
    // appended to it, the same override shape contactEmail uses.
    const autoLabel = fund ? 'Give to ' + fund.name : 'Give now';
    const label = (b.buttonText && b.buttonText.trim()) || autoLabel;
    // ⚠ `tlcb-btn` is a MARKER, not a style source — every color it could set
    // is already declared by the more specific `.tlcb-give .tlcb-chip--go`
    // rule above, so nothing repaints from this class alone. ⚠ IT HAS TO COME
    // FIRST IN THE ATTRIBUTE. The derivation test finds every type offering a
    // color control with `/class="tlcb-btn/` — an anchored match against the
    // start of the attribute, the same convention every other multi-class
    // button on the site already follows (`tlcb-btn tlcb-btn--ghost`, etc.).
    // Reordering costs nothing: class order has no effect on CSS specificity.
    const go = opts.editing
      // The editing-mode span is never inside an anchor, so it can be typed
      // into directly — unlike the card grid's link label, there is no
      // nested-anchor problem to route around here.
      ? field(opts, b, 'buttonText', 'span', 'tlcb-btn tlcb-chip tlcb-chip--go', esc(b.buttonText || ''), ` data-ph="${esc(autoLabel)}"`)
      : `<a class="tlcb-btn tlcb-chip tlcb-chip--go" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
    return `<div class="tlcb-give">${renderHead(opts, b)}
      ${field(opts, b, 'body', 'div', 'tlcb-give-note', b.body || '', ' data-ph="Why it matters"', true)}
      <div class="tlcb-inline">${go}</div>
    </div>`;
  }

  // ── THE GIVING WIDGET ─────────────────────────────────────────────────────
  // Self-filling from ctx.data.give. The block carries the wording; the Giving
  // screen carries the amounts, the funds and the link. Nothing here is stored
  // on the page, which is the property that lets this be a published block at
  // all.
  if (t === 'giving') {
    const give = data.give || {};
    const tiers = Array.isArray(give.tiers) ? give.tiers : [];
    const funds = Array.isArray(give.funds) ? give.funds : [];
    const baseUrl = give.baseUrl || '';
    const head = `${renderEyebrow(opts, b)}
      ${field(opts, b, 'title', 'div', 'tlcb-gv-title', esc(b.title || ''), ' data-ph="Give to Timothy"')}
      ${field(opts, b, 'subtitle', 'div', 'tlcb-gv-tag', esc(b.subtitle || ''), ' data-ph="A line under the heading"')}`;
    const note = field(opts, b, 'body', 'div', 'tlcb-gv-trust', b.body || '', ' data-ph="What happens after they press the button"', true);

    // Nothing to give to. Say so in the editor; on the live page an empty
    // widget would be the church asking for money with no way to send it, so
    // it says that plainly too rather than rendering dead furniture.
    if (!tiers.length || !baseUrl) {
      return `<div class="tlcb-gv">${head}
        <p class="tlcb-note">${baseUrl
          ? 'No amounts are switched on yet — add them under Giving, Amount Tiers.'
          : 'The base Tithe.ly link has not been filled in yet, so this cannot take a gift. Add it under Giving.'}</p>
        ${note}</div>`;
    }

    const defaultFund = funds.find((f) => f.isDefault) || funds[0] || { tithelyFundId: '' };
    const defaultTier = tiers.find((x) => x.isDefault) || tiers[0];
    const fundId = defaultFund.tithelyFundId || '';
    // A tier's own `url` is a full override — it ignores the fund selector
    // entirely, because it exists for the rare case an amount should go
    // somewhere else altogether. That is set on the Giving screen, not here.
    const overrides = {};
    for (const x of tiers) if (x.url) overrides[x.amount] = x.url;
    const linkFor = (amt) => overrides[amt] || withAmountAndFund(baseUrl, amt, fundId);

    const chips = tiers.map((x) => {
      const on = x.amount === defaultTier.amount ? ' is-on' : '';
      return `<button type="button" class="tlcb-gv-chip${on}" data-amount="${esc(String(x.amount))}"${opts.editing ? ' disabled' : ''}>$${esc(String(x.amount))}</button>`;
    }).join('');

    // Hidden entirely when there is only one fund — a dropdown with one option
    // is a question with one answer.
    const fundPick = funds.length > 1 ? `<label class="tlcb-gv-lab" for="tlcb-gv-fund-${esc(b.id)}">Give to</label>
      <select class="tlcb-gv-fund" id="tlcb-gv-fund-${esc(b.id)}"${opts.editing ? ' disabled' : ''}>
        ${funds.map((f) => `<option value="${esc(f.tithelyFundId || '')}"${f.id === defaultFund.id ? ' selected' : ''}>${esc(f.name || '')}</option>`).join('')}
      </select>` : '';

    const cta = opts.editing
      ? `<span class="tlcb-gv-cta">Give $${esc(String(defaultTier.amount))}</span>`
      : `<a class="tlcb-gv-cta" href="${esc(linkFor(defaultTier.amount))}" target="_blank" rel="noopener">Give $${esc(String(defaultTier.amount))}</a>`;

    // The state the browser needs, as data rather than as generated code —
    // one attribute to read instead of a script per block.
    const cfg = esc(JSON.stringify({ baseUrl, overrides, fund: fundId }));

    return `<div class="tlcb-gv" data-give="${cfg}">${head}
      ${fundPick}
      <div class="tlcb-gv-lab">Choose an amount</div>
      <div class="tlcb-gv-chips" role="group" aria-label="Gift amount">${chips}</div>
      <div class="tlcb-gv-other">
        <span aria-hidden="true">$</span>
        <input type="number" min="1" step="1" placeholder="Other amount" aria-label="Other amount"${opts.editing ? ' disabled' : ''}>
      </div>
      <p class="tlcb-gv-err" hidden>Please enter an amount of at least $1.</p>
      ${cta}
      ${note}
    </div>${opts.editing ? '' : GIVING_WIDGET_SCRIPT}`;
  }

  // ── THE AMOUNT LADDER ─────────────────────────────────────────────────────
  // "$100 /week — provides tuition assistance for a child." The amount and the
  // words are the block's; the link is computed, every time, from the Giving
  // screen's base link.
  if (t === 'amounts') {
    const give = data.give || {};
    const baseUrl = give.baseUrl || '';
    const funds = Array.isArray(give.funds) ? give.funds : [];
    // The ladder always gives to the default fund. These are specific,
    // narrative asks — "sends a youth to the National Youth Gathering" — not a
    // generic amount somebody picks a fund for, so the widget's fund selector
    // deliberately does not reach them.
    const fundId = (funds.find((f) => f.isDefault) || funds[0] || {}).tithelyFundId || '';

    // Whether any row's button ends up asking for a month of an annual
    // commitment, which is a fact the page has to state — see the note below.
    let anyMonthly = false;

    const rows = (b.items || []).map((it, i) => {
      const amt = parseAmount(it.amount);
      const period = String(it.period || '').replace(/^\/+/, '');
      const label = amt == null ? esc(String(it.amount || '')) : '$' + esc(fmtAmount(amt));
      // The row's amount is the COMMITMENT ("$5,000 /year"); the button asks
      // for the TRANSACTION, which for an annual row is a twelfth of it. The
      // rule lives in give-link.js beside the link arithmetic, so this and the
      // hardcoded fallback in give-landing.js cannot come to different answers
      // about what somebody is being asked to pay.
      const gift = giftForPeriod(it.amount, period);
      if (gift && gift.per === 'month') anyMonthly = true;
      // No amount, or no link to build one from, means no button — never a
      // button that goes nowhere. A dead link is worse than a missing one
      // because it looks like it works.
      const btn = (gift == null || !baseUrl)
        ? ''
        : (opts.editing
          ? `<span class="tlcb-am-cta">${esc(giveButtonLabel(gift))}</span>`
          : `<a class="tlcb-am-cta" href="${esc(withAmountAndFund(baseUrl, gift.amount, fundId))}" target="_blank" rel="noopener">${esc(giveButtonLabel(gift))}</a>`);
      return `<div class="tlcb-am-row">
        <div class="tlcb-am-l">
          <div class="tlcb-am-amt">${itemField(opts, i, 'amount', 'span', 'tlcb-am-n', label, ' data-ph="25"')}${
            (period || opts.editing) ? itemField(opts, i, 'period', 'span', 'tlcb-am-p', esc(period ? '/' + period : ''), ' data-ph="/week"') : ''}</div>
          ${itemField(opts, i, 'body', 'div', 'tlcb-am-o', it.body || '', ' data-ph="What this gift does."', true)}
        </div>${btn}
      </div>`;
    }).join('');

    // ⚠ Tithe.ly cannot be told from a link that a gift is recurring — that is
    // why the frequency toggle came off this page in 2026-07. So a button
    // reading "Give $416/month" prefills one month and nothing more, and the
    // one step it cannot take for somebody has to be said out loud. Rendered
    // only when a monthly button actually exists, so a purely weekly ladder
    // does not carry an instruction about a screen it never reaches.
    const monthlyNote = anyMonthly
      ? `<p class="tlcb-am-note">Each button opens the giving form with one month&rsquo;s amount already filled in &mdash; choose <strong>Monthly</strong> there to make it repeat.</p>`
      : '';

    // A heading over the ROWS THEMSELVES, distinct from the block's own
    // heading and intro above it (Dinger, 2026-08-06). On this page the block
    // heading is an argument — "Every gift accomplishes great things in His
    // Kingdom" — and several paragraphs can sit under it; by the time the eye
    // reaches the cards there is nothing saying what the list of them IS.
    // Empty on every existing page, so nothing gains a heading it did not ask
    // for; in the editor it shows as a placeholder, because a field nobody can
    // see is a field nobody uses.
    const listHead = (b.subtitle || opts.editing)
      ? field(opts, b, 'subtitle', 'div', 'tlcb-am-lab', esc(b.subtitle || ''), ' data-ph="A heading for this list, e.g. Weekly giving"')
      : '';

    return `<div class="tlcb-am">${renderHead(opts, b, 'A heading for this ladder')}
      ${(b.body || opts.editing) ? renderBody(opts, b, def) : ''}
      ${rows ? `${listHead}<div class="tlcb-am-list">${rows}</div>${monthlyNote}`
        : `<p class="tlcb-note">No amounts yet — add one in the panel on the right.</p>`}</div>`;
  }

  // ── THE CHRISTMAS MARKET APPLICATION ──────────────────────────────────────
  if (t === 'jumplinks') {
    // ⚠ ONE PER PAGE. Two sticky bars stack on top of each other and the
    // second one's links land under the first — so the first is rendered and
    // any others are not. In the editor the extra one says why rather than
    // vanishing, because a block that disappears from the canvas is a block
    // somebody thinks they broke.
    const siblings = opts.siblings || [];
    const first = siblings.find((s) => s && s.type === 'jumplinks');
    if (first && first.id !== b.id) {
      return opts.editing
        ? `<div class="jump-bar"><span class="tlcb-note">There is already a jump bar on this page, and one is all a page can have — two of them stack on top of each other. This one will not appear on the live page. Delete it, or delete the other.</span></div>`
        : '';
    }

    // In `auto` the links ARE the page: every block with something to call it,
    // in page order, skipping this block and anything unnamed. `manual` reads
    // the typed list, which is the only way to point off the page.
    const auto = b.mode !== 'manual';
    const links = auto
      ? siblings
        .filter((s) => s && s.type !== 'jumplinks' && (s.title || s.eyebrow))
        .map((s) => ({ title: cleanText(s.title || s.eyebrow, 40), url: '#' + blockDomId(s) }))
        .filter((l) => l.title && l.url !== '#')
      : (b.items || []).filter((it) => it.title && it.url);

    const label = b.title
      ? `<span class="jump-label">${esc(b.title)}</span>`
      : (opts.editing ? field(opts, b, 'title', 'span', 'jump-label', '', ' data-ph="Jump to"') : '');

    // A button with no address is a dead link, so it is not drawn at all —
    // and its label is edited on the canvas, the same way the Give block's is.
    const ctaText = b.buttonText || (opts.editing ? '' : '');
    const cta = b.url
      ? (opts.editing
        ? `<span class="jump-link jump-cta">${field(opts, b, 'buttonText', 'span', '', esc(ctaText), ' data-ph="Button label"')}</span>`
        : (ctaText ? `<a class="jump-link jump-cta" href="${esc(b.url)}">${esc(ctaText)}</a>` : ''))
      : (opts.editing ? `<span class="jump-link jump-cta tlcb-note">Add an address in the panel to draw a button here</span>` : '');

    // ⚠ The editor's "add an address" hint is a placeholder, not a button, so
    // it must not count as content here — otherwise a brand-new bar with
    // nothing to link to would show that hint instead of saying, plainly,
    // that nothing on the page has a heading yet.
    if (!links.length && !b.url) {
      return opts.editing
        ? `<div class="jump-bar"><span class="tlcb-note">${auto
          ? 'Nothing on this page has a heading or an eyebrow yet, so there is nothing to jump to. Give a section below a heading and it appears here.'
          : 'No links yet — add one in the panel on the right.'}</span></div>`
        : '';
    }

    const chips = links.map((l) => opts.editing
      ? `<span class="jump-link">${esc(l.title)}</span>`
      : `<a class="jump-link" href="${esc(safeUrl(l.url))}">${esc(l.title)}</a>`).join('');

    // ⚠ Sticky is not applied in the editor. A bar that detaches and follows
    // the canvas while somebody is arranging blocks is one they cannot get
    // hold of, and it would cover the block above it.
    const stuck = b.sticky && !opts.editing ? ' jump-bar--stuck' : '';
    return `<div class="jump-bar${stuck}"><div class="jump-inner">${label}<div class="jump-scroll">${chips}</div>${cta}</div></div>`;
  }

  if (t === 'marketfacts') {
    const raw = data.market || {};
    // Same defaulting rule the application block applies to itself: a
    // genuinely empty data.market must print the figures a visitor would
    // really be charged, never the word "undefined".
    const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const feeCents = Math.round(numOr(raw.tableFee, MARKET_DEFAULTS.tableFee) * 100);
    const maxTables = numOr(raw.maxTables, MARKET_DEFAULTS.maxTables);
    const email = raw.coordinatorEmail || '';
    const pairs = [
      ['Market day', esc(raw.dateLabel || ''), false],
      ['Hours', esc(raw.hoursLabel || ''), false],
      ['Table fee', `${esc(marketMoney(feeCents))} · ${esc(String(maxTables))} max`, false],
      ['Coordinator', email
        ? (opts.editing ? esc(email) : `<a href="mailto:${esc(email)}">${esc(email)}</a>`)
        : '', true],
    ];
    const cells = pairs.filter(([, v]) => v).map(([label, value, mail]) =>
      `<div class="tlcb-mktfacts-cell"><span class="tlcb-mktfacts-l">${esc(label)}</span>`
      + `<span class="tlcb-mktfacts-v${mail ? ' tlcb-mktfacts-v--mail' : ''}">${value}</span></div>`).join('');
    // A band with nothing in it is a band that reads as broken. In the editor
    // it says why instead, the same rule the Coming-up strip follows.
    if (!cells) {
      return opts.editing
        ? `<div class="tlcb-mktfacts"><span class="tlcb-note">The market day, hours, fee and coordinator all come from the Christmas Market screen. None is set yet, so this band will not appear on the page.</span></div>`
        : '';
    }
    return `<div class="tlcb-mktfacts">${cells}</div>`;
  }

  if (t === 'marketapp') {
    const raw = data.market || {};
    const editing = !!opts.editing;
    const dis = editing ? ' disabled' : '';

    const head = `${renderHead(opts, b, 'Vendor application')}${renderBody(opts, b, def)}`;

    // Applications closed is decided HERE, at render time, from the same
    // setting the Christmas Market screen's toggle writes — never client-side.
    // A page rendered while applications are closed simply never ships the
    // form at all, so there is no state for a script to get wrong.
    //
    // ⚠ Missing data.market entirely reads as CLOSED, same as an explicit
    // off. There is no numeric fallback that makes it safe to open a payment
    // form when the settings that decide its price could not be read.
    if (!raw.open) {
      return `<div class="tlcb-mktapp">${head}
        <div class="tlcb-mktapp-closed">
          <p><strong>Applications are closed right now.</strong> Email <a href="mailto:${esc(raw.coordinatorEmail || '')}">${esc(raw.coordinatorEmail || '')}</a> and the coordinator will tell you when they open for the next market.</p>
        </div>
      </div>`;
    }

    // ⚠ FALLS BACK TO THE SAME DEFAULTS priceBreakdown() ALREADY APPLIES
    // INTERNALLY. This branch reads several of these fields directly — the
    // facts line, the fee-percent label — rather than only through
    // priceBreakdown(), so without its own defaulting a genuinely incomplete
    // data.market renders the literal word "undefined" into the page instead
    // of the $30 / 2.9% / 30¢ a visitor would actually be charged.
    const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const market = {
      tableFee: numOr(raw.tableFee, MARKET_DEFAULTS.tableFee),
      feePercent: numOr(raw.feePercent, MARKET_DEFAULTS.feePercent),
      feeFixed: numOr(raw.feeFixed, MARKET_DEFAULTS.feeFixed),
      maxTables: numOr(raw.maxTables, MARKET_DEFAULTS.maxTables),
      coordinatorEmail: raw.coordinatorEmail || '',
      dateLabel: raw.dateLabel || '',
      hoursLabel: raw.hoursLabel || '',
    };

    const fee = marketMoney(Math.round((Number(market.tableFee) || 0) * 100));
    const facts = `<p class="tlcb-mktapp-facts">${esc(market.dateLabel || '')} · ${esc(market.hoursLabel || '')} · ${esc(fee)} per table</p>`;

    const tableBtns = Array.from({ length: Math.max(1, Math.min(9, Number(market.maxTables) || 3)) }, (_, i) => i + 1)
      .map((n) => `<button type="button" class="tlcb-mktapp-tbtn"${n === 1 ? ' aria-pressed="true"' : ' aria-pressed="false"'} data-tables="${n}"${dis}>${n} table${n === 1 ? '' : 's'}</button>`)
      .join('');

    const price = priceBreakdown(1, market);
    // ⚠ A clause with no words is dropped, ON THE PUBLIC PAGE ONLY. In the
    // editor every item stays, even a freshly-added blank one — that is what
    // gives it a contenteditable div to type into at all, the same reason a
    // block that renders nothing still renders something while it is being
    // worked on. `i` is the ORIGINAL array index either way: nothing is
    // filtered while editing, so the index itemField writes data-item="i"
    // from still lines up with sanitizeBlock's own b.items[i] — and public
    // rendering never reads data-item at all, so an index into the filtered
    // list would be meaningless there regardless.
    const agreeItems = (b.items || [])
      .filter((it) => opts.editing || it.body)
      .map((it, i) => itemField(opts, i, 'body', 'div', 'tlcb-mktapp-clause', it.body || '', ' data-ph="A clause of the agreement"', true))
      .join('');

    // The config a vendor's browser needs to retotal live and to know what it
    // is quoting — computed here, server-side, so nothing has to fetch it
    // after paint the way the standalone fallback page does. ⚠ No payment
    // address in it: the giving link and the market's fund are resolved by
    // /api/market/apply at the moment of submission, never by the browser.
    const cfg = esc(JSON.stringify({
      tableFee: market.tableFee, feePercent: market.feePercent, feeFixed: market.feeFixed,
      maxTables: market.maxTables, coordinatorEmail: market.coordinatorEmail || '',
    }));

    const field3 = (id, name, label, type, ph, required, auto) =>
      `<div class="tlcb-mktapp-field"><label for="${id}">${esc(label)}${required ? ' <span class="tlcb-mktapp-req">*</span>' : ''}</label>
        <input type="${type}" id="${id}" name="${name}" placeholder="${esc(ph || '')}"${auto ? ` autocomplete="${auto}"` : ''}${dis}></div>`;

    return `<div class="tlcb-mktapp${editing ? ' tlcb-mktapp--editing' : ''}" data-market-cfg="${cfg}">
      ${head}
      ${facts}
      <div class="tlcb-mktapp-card">
        <div class="tlcb-mktapp-steps" role="tablist" aria-label="Vendor application steps">
          <button type="button" class="tlcb-mktapp-step" role="tab" aria-selected="true" data-step="1"${dis}><span>Step 1</span><b>You &amp; your booth</b></button>
          <button type="button" class="tlcb-mktapp-step" role="tab" aria-selected="false" data-step="2"${dis}><span>Step 2</span><b>What you sell</b></button>
          <button type="button" class="tlcb-mktapp-step" role="tab" aria-selected="false" data-step="3"${dis}><span>Step 3</span><b>Tables &amp; payment</b></button>
        </div>

        <form class="tlcb-mktapp-form" novalidate>
        <div style="position:absolute;left:-9999px;" aria-hidden="true">
          <label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"${dis}></label>
        </div>

        <div class="tlcb-mktapp-panel is-on" data-panel="1">
          <p class="tlcb-mktapp-lead">Who's behind the table, and how we reach you.</p>
          ${field3('mkt-b-names', 'participant_names', 'Participant name(s)', 'text', 'Everyone who will be at the table', true, 'name')}
          <div class="tlcb-mktapp-pair">
            ${field3('mkt-b-biz', 'business_name', 'Business name', 'text', 'If you have one', false, 'organization')}
            ${field3('mkt-b-web', 'website_or_social', 'Website or Instagram', 'text', '@yourshop', false)}
          </div>
          <div class="tlcb-mktapp-pair">
            ${field3('mkt-b-email', 'email', 'Email', 'email', 'you@example.com', true, 'email')}
            ${field3('mkt-b-phone', 'phone', 'Telephone', 'tel', '(314) 555-0123', true, 'tel')}
          </div>
          <div class="tlcb-mktapp-field"><label for="mkt-b-street">Mailing address</label>
            <input type="text" id="mkt-b-street" name="street" placeholder="Street" autocomplete="street-address"${dis}>
            <div class="tlcb-mktapp-csz">
              <input type="text" name="city" placeholder="City" aria-label="City" autocomplete="address-level2"${dis}>
              <input type="text" name="state" placeholder="State" aria-label="State" autocomplete="address-level1"${dis}>
              <input type="text" name="zip" placeholder="ZIP" aria-label="ZIP" autocomplete="postal-code"${dis}>
            </div>
          </div>
          <div class="tlcb-mktapp-field"><span>Sold with us before?</span>
            <div class="tlcb-mktapp-choice" role="group">
              <button type="button" class="tlcb-mktapp-pill" data-returning="yes" aria-pressed="false"${dis}>Returning vendor</button>
              <button type="button" class="tlcb-mktapp-pill" data-returning="no" aria-pressed="false"${dis}>First year</button>
            </div>
            <input type="hidden" name="returning_vendor" value="">
          </div>
          <div class="tlcb-mktapp-foot tlcb-mktapp-foot--end"><button type="button" class="tlcb-btn" data-goto="2"${dis}>Next: what you sell</button></div>
        </div>

        <div class="tlcb-mktapp-panel" data-panel="2">
          <p class="tlcb-mktapp-lead">The more specific you are, the better we can space out similar tables.</p>
          <div class="tlcb-mktapp-field"><label for="mkt-b-product">Description of product <span class="tlcb-mktapp-req">*</span></label>
            <textarea id="mkt-b-product" name="product_description" placeholder="e.g. handmade purses, tote bags, wallets, crochet shawls"${dis}></textarea></div>
          <label class="tlcb-mktapp-check"><input type="checkbox" name="sells_food" value="1"${dis}>
            <span><strong>I'll be selling food or drink.</strong> You're responsible for City of St. Louis health department requirements for what you sell — the coordinator will follow up with what that means for your table.</span></label>
          ${field3('mkt-b-power', 'appliances_power', 'Appliances, wattage, amperage', 'text', 'None — or: popcorn popper, 1200W / 15A', false)}
          <div class="tlcb-mktapp-field"><label>Sample photos <span class="tlcb-mktapp-opt">— optional, up to five</span></label>
            <label class="tlcb-mktapp-drop">
              <input type="file" name="photos" accept="image/*" multiple style="position:absolute;left:-9999px;"${dis}>
              <b>Drop photos here or browse</b><span>We use these to promote the market and to place your table well.</span>
            </label>
            <div class="tlcb-mktapp-thumbs"></div>
          </div>
          <div class="tlcb-mktapp-field"><label for="mkt-b-req">Special requests</label>
            <textarea id="mkt-b-req" name="special_requests" placeholder="Booth placement, neighbors you'd like to be near, anything else"${dis}></textarea></div>
          <div class="tlcb-mktapp-foot"><button type="button" class="tlcb-btn tlcb-btn--ghost" data-goto="1"${dis}>Back</button><button type="button" class="tlcb-btn" data-goto="3"${dis}>Next: tables &amp; payment</button></div>
        </div>

        <div class="tlcb-mktapp-panel" data-panel="3">
          <div class="tlcb-mktapp-field"><span>How many tables? <span class="tlcb-mktapp-req">*</span></span>
            <div class="tlcb-mktapp-tables">${tableBtns}</div>
            <input type="hidden" name="tables" value="1"></div>
          <div class="tlcb-mktapp-total">
            <div class="tlcb-mktapp-total-lab">Your total</div>
            <div class="tlcb-mktapp-total-rows">
              <div><span data-row="sub-label">1 table × ${esc(fee)}</span><span data-row="sub">${esc(marketMoney(price.subtotalCents))}</span></div>
              <div><span data-row="fee-label">Card processing fee (${esc(String(market.feePercent))}% + ${esc(String(Math.round((Number(market.feeFixed) || 0) * 100)))}¢)</span><span data-row="fee">${esc(marketMoney(price.feeCents))}</span></div>
              <hr>
              <div class="tlcb-mktapp-total-due"><span>Due today</span><span data-row="due">${esc(marketMoney(price.totalCents))}</span></div>
            </div>
            <p>Vendors cover the processing fee so the full ${esc(fee)} per table goes to the market. Payment opens with this amount already filled in.</p>
          </div>
          <div class="tlcb-mktapp-agree" tabindex="0" role="region" aria-label="Vendor agreement">
            <p><strong>Vendor agreement.</strong> By applying I agree that:</p>
            ${agreeItems || '<p class="tlcb-note">No clauses yet — add one in the panel on the right.</p>'}
          </div>
          <p class="tlcb-mktapp-fine">When you pay, please use the same name you entered above — it's how we match your payment to your table.</p>
          <div class="tlcb-mktapp-field"><label for="mkt-b-sign">Type your name to agree <span class="tlcb-mktapp-req">*</span></label>
            <input type="text" id="mkt-b-sign" name="signature_name" placeholder="Your full name"${dis}></div>
          <div class="tlcb-mktapp-alert" role="alert"></div>
          ${editing ? '' : '<div class="tlc-turnstile" style="margin-bottom:12px;"></div>'}
          <div class="tlcb-mktapp-foot">
            <button type="button" class="tlcb-btn tlcb-btn--ghost" data-goto="2"${dis}>Back</button>
            ${editing ? `<span class="tlcb-btn" data-submit-label>Submit and pay ${esc(marketMoney(price.totalCents))}</span>`
              : `<button type="submit" class="tlcb-btn" data-submit-label${dis}>Submit and pay ${esc(marketMoney(price.totalCents))}</button>`}
          </div>
          <p class="tlcb-mktapp-fine">Need to pay by check or cash instead? Email <a href="mailto:${esc(market.coordinatorEmail || '')}">${esc(market.coordinatorEmail || '')}</a> and the coordinator will hold your space.</p>
        </div>
        </form>
      </div>
    </div>${editing ? '' : MARKET_APP_SCRIPT}`;
  }

  // ── A GENERIC EVENT'S REGISTRATION FORM ───────────────────────────────────
  // The `marketapp` block above is the Christmas Market's own bespoke nine
  // fields; this is any other event's — driven entirely by `data.eventsById`
  // and `data.eventFieldsById`, both assembled in pageData() from that
  // event's `site_events` row and its `site_event_fields` rows.
  if (t === 'registration') {
    const editing = !!opts.editing;
    const dis = editing ? ' disabled' : '';
    const head = `${renderHead(opts, b, 'Sign up')}${renderBody(opts, b, def)}`;

    const ev = b.eventId ? (data.eventsById || {})[b.eventId] : null;

    // ⚠ NO EVENT PICKED, OR THE PICKED ONE HAS REGISTRATION TURNED OFF: say
    // so in the editor and render nothing at all on the live page — a form
    // to nowhere is worse than no form.
    if (!ev || !ev.hasRegistration) {
      return editing
        ? `<div class="tlcb-reg">${head}<p class="tlcb-note">${!b.eventId ? 'Pick an event in the panel on the right.'
            : !ev ? 'That event could not be found — pick another in the panel on the right.'
            : `“${esc(ev.name)}” does not have registration turned on. Turn it on from that event's own screen.`}</p></div>`
        : '';
    }

    if (!ev.registrationOpen) {
      return `<div class="tlcb-reg">${head}
        <div class="tlcb-reg-closed">
          <p><strong>Sign-ups are closed right now.</strong>${ev.coordinatorEmail ? ` Email <a href="mailto:${esc(ev.coordinatorEmail)}">${esc(ev.coordinatorEmail)}</a> with any questions.` : ''}</p>
        </div>
      </div>`;
    }

    const fields = (data.eventFieldsById && data.eventFieldsById[b.eventId]) || [];
    const fee = ev.hasPayment ? marketMoney(Math.round((Number(ev.feeConfig.tableFee) || 0) * 100)) : '';
    const facts = [ev.dateLabel, ev.hasPayment ? `${fee} each` : ''].filter(Boolean).join(' · ');

    const fieldHtml = (f) => {
      const id = 'reg-f-' + esc(f.key);
      const req = f.required ? ' <span class="tlcb-reg-req">*</span>' : '';
      if (f.kind === 'checkbox') {
        return `<div class="tlcb-reg-field"><label class="tlcb-reg-check"><input type="checkbox" id="${id}" name="field_${esc(f.key)}" value="1"${dis}> <span>${esc(f.label)}${req}</span></label>${f.hint ? `<p class="tlcb-reg-hint">${esc(f.hint)}</p>` : ''}</div>`;
      }
      let input;
      if (f.kind === 'textarea') {
        input = `<textarea id="${id}" name="field_${esc(f.key)}" placeholder="${esc(f.placeholder || '')}"${dis}></textarea>`;
      } else if (f.kind === 'select') {
        const opts_ = (Array.isArray(f.options) ? f.options : []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
        input = `<select id="${id}" name="field_${esc(f.key)}"${dis}><option value="">Choose…</option>${opts_}</select>`;
      } else {
        const type = ['email', 'tel', 'number', 'date'].includes(f.kind) ? f.kind : 'text';
        input = `<input type="${type}" id="${id}" name="field_${esc(f.key)}" placeholder="${esc(f.placeholder || '')}"${dis}>`;
      }
      return `<div class="tlcb-reg-field"><label for="${id}">${esc(f.label)}${req}</label>${input}${f.hint ? `<p class="tlcb-reg-hint">${esc(f.hint)}</p>` : ''}</div>`;
    };

    const qtyRow = ev.hasPayment
      ? `<div class="tlcb-reg-field"><label for="reg-qty">How many?</label>
          <input type="number" id="reg-qty" name="qty" min="1" max="${esc(String(ev.feeConfig.maxTables))}" value="1"${dis}></div>`
      : '';
    const totalBlock = ev.hasPayment
      ? `<div class="tlcb-reg-total"><div class="tlcb-reg-total-due"><span>Due today</span><span data-row="due">${esc(marketMoney(priceBreakdown(1, ev.feeConfig).totalCents))}</span></div></div>`
      : '';
    const submitLabel = ev.hasPayment ? `Continue to payment — ${marketMoney(priceBreakdown(1, ev.feeConfig).totalCents)}` : 'Sign up';

    const cfg = esc(JSON.stringify({ eventId: b.eventId, feeConfig: ev.hasPayment ? ev.feeConfig : null }));

    return `<div class="tlcb-reg${editing ? ' tlcb-reg--editing' : ''}" data-reg-cfg="${cfg}">
      ${head}
      ${facts ? `<p class="tlcb-reg-facts">${esc(facts)}</p>` : ''}
      <form class="tlcb-reg-form" novalidate>
        <div style="position:absolute;left:-9999px;" aria-hidden="true">
          <label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"${dis}></label>
        </div>
        ${fields.map(fieldHtml).join('') || (editing ? '<p class="tlcb-note">No fields yet — add one on this event\'s Registrations tab.</p>' : '')}
        ${qtyRow}
        ${totalBlock}
        <div class="tlcb-reg-alert" role="alert"></div>
        ${editing ? '' : '<div class="tlc-turnstile" style="margin-bottom:12px;"></div>'}
        <div class="tlcb-reg-foot">
          ${editing ? `<span class="tlcb-btn" data-submit-label>${esc(submitLabel)}</span>`
            : `<button type="submit" class="tlcb-btn" data-submit-label${dis}>${esc(submitLabel)}</button>`}
        </div>
      </form>
    </div>${editing ? '' : REGISTRATION_SCRIPT}`;
  }

  return `<div class="tlcb-note">Unknown block</div>`;
}

// opts: { editing, slug, index, total }
export function renderBlock(b, opts = {}) {
  const def = BLOCK_DEFS[b.type];
  if (!def) return '';
  const classes = ['tlcb', 'tlcb--' + b.type];
  if (b.hidden) classes.push('tlcb-hide-phone');
  // One class for the whole page's worth of alignment. ALIGNABLE_TYPES is the
  // one place the list lives, and it is derived from the defs rather than
  // written out again. Card grid ALSO carries its own older `tlcb-cg--*`
  // classes from its own render branch — those handle the inside of a card,
  // which the generic rules deliberately do not reach.
  if (ALIGNABLE_TYPES.has(b.type) && b.align !== 'left') classes.push('tlcb--' + b.align);
  // ⚠ Only when it is not 'none'. An untouched page renders from exactly the
  // CSS it always did rather than from a new rule that happens to agree with
  // it — the same rule left-alignment follows above.
  if (SHADOWABLE_TYPES.has(b.type) && b.shadow && b.shadow !== 'none') classes.push('tlcb--sh-' + b.shadow);
  // ⚠ THE LIVE PAGE ONLY. On the canvas the block is something being worked on,
  // and one that fades itself in every time it scrolls past is one nobody can
  // edit. The inspector's note says so, rather than leaving somebody to wonder
  // why the control appears to do nothing.
  if (!opts.editing && APPEARABLE_TYPES.has(b.type) && b.appear && b.appear !== 'none') {
    classes.push('tlcb--ap-' + b.appear);
  }
  // A button elsewhere on the page (or a link inside a paragraph) can jump
  // straight here with `#name` — safeUrl() already accepts a leading `#` on
  // every URL field, so the only missing half was something on the page for
  // it to land on. Present in the editor too, harmlessly: nothing there ever
  // scrolls by fragment, and it is one less thing that can differ from the
  // published markup.
  //
  // ⚠ THE BARE NAME, NOT A PREFIXED ONE. This was `jump-${b.anchorId}` at
  // first, on genuine namespace-collision grounds — a block's id sharing the
  // page's own id space with `id="page-<id>"` and the router's anchors. But
  // the inspector's own on-screen note, and every word said about this
  // feature, promised "link to #<exactly this>" — a prefix nobody was told
  // about is indistinguishable from the feature simply not working: a button
  // linking to the name shown on screen matches nothing, the browser has
  // nowhere to send it, and Dinger reported it landing on the home page.
  // What's shown in the box has to BE the address, not a value close to it.
  //
  // ⚠ AND EVERY BLOCK CARRIES ONE NOW, not only the ones somebody has named.
  // That is what makes the Jump links block's automatic mode possible at all:
  // it derives its chips from the page's own sections, so every section has to
  // be addressable without anybody having named it first. A typed name still
  // wins — see blockDomId(), which is the one place both halves are decided.
  const domId = blockDomId(b);
  const idAttr = domId ? ` id="${esc(domId)}"` : '';
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
  const inner = renderInner(b, opts);
  // ⚠ A block that renders nothing renders NOTHING — not an empty wrapper.
  // The wrapper carries the block's background and its spacing, so an empty
  // one is an invisible colored band that still pushes the page down, and on
  // a light surface it is invisible in the worst way: nobody can see what is
  // making the gap. The Coming-up strip is the type that does this (it draws
  // no strip when nothing is coming up), and it will not be the last.
  //
  // Never in the editor, where the canvas has to keep something clickable for
  // every block in the rail — a block you cannot select is a block you cannot
  // delete.
  if (!inner && !opts.editing) return '';
  return `<div class="${classes.join(' ')}"${idAttr} style="${wrapperVars(b)}"${attrs}>${tools}${renderStamp(opts, b)}${inner}</div>`;
}

// The sidebar template's right-hand column. Reads the one site-settings record,
// never the page — staff fix the phone number once and every sidebar updates.
// The pages beneath this one, as a card in the aside. Same source as the
// section template's list below the content — derived from the page tree, never
// stored — so it cannot go stale and needs nothing typed.
function sidebarKids(ctx) {
  const kids = ctx.children || [];
  if (!kids.length) {
    // In the editor an empty aside card is a question worth answering; on the
    // live page a section with no children yet is just a page with no list.
    return ctx.editing
      ? `<div class="tlcb-side-card"><h2 class="tlcb-side-h">In this section</h2>
      <p class="tlcb-note">Pages you file beneath this one are listed here automatically.</p></div>`
      : '';
  }
  return `<div class="tlcb-side-card"><h2 class="tlcb-side-h">In this section</h2>
    <div class="tlcb-side-kids">${kids.map((k) => {
      const href = safeUrl(k.slug || '');
      const t = esc(k.title || '');
      // The editor renders them inert, like every other link in the canvas —
      // clicking one there should select the block, not leave the page.
      return ctx.editing || !href ? `<span>${t}</span>` : `<a href="${esc(href)}">${t}</a>`;
    }).join('')}</div></div>`;
}

function sidebarAside(ctx) {
  const data = ctx.data || {};
  const st = data.settings || {};
  const services = data.services || [];
  const times = services.length ? `<div class="tlcb-side-card"><h2 class="tlcb-side-h">Service times</h2>
      ${services.map((r) => `<div class="tlcb-svc">
        <span class="tlcb-svc-d">${esc(r.day || '')}</span>
        <span class="tlcb-svc-t">${esc(r.time || '')}</span>
        <span class="tlcb-svc-n">${esc(r.note || '')}</span>
      </div>`).join('')}</div>` : '';
  const addr = [st.address_line, st.address_city].filter(Boolean).join(', ');
  const tel = safeUrl(st.phone ? 'tel:' + String(st.phone).replace(/[^0-9+]/g, '') : '');
  const mail = safeUrl(st.email ? 'mailto:' + st.email : '');
  const lines = [
    addr ? `<span>${esc(addr)}</span>` : '',
    st.phone ? (ctx.editing || !tel ? `<span>${esc(st.phone)}</span>` : `<a href="${esc(tel)}">${esc(st.phone)}</a>`) : '',
    st.email ? (ctx.editing || !mail ? `<span>${esc(st.email)}</span>` : `<a href="${esc(mail)}">${esc(st.email)}</a>`) : '',
  ].filter(Boolean).join('');
  const contact = lines ? `<div class="tlcb-side-card"><h2 class="tlcb-side-h">Visit us</h2>
      <div class="tlcb-side-lines">${lines}</div></div>` : '';
  // The child list leads when the layout asks for it — somebody on a section
  // page is looking for the page beneath it, not for the office's phone number.
  const kids = ctx.withKids ? sidebarKids(ctx) : '';
  // ⚠ THE ASIDE HAS NO SPACING OF ITS OWN OTHERWISE. A block's own spaceAbove
  // can push the content column down without moving the aside beside it,
  // which is exactly the "sidebar starts too high" complaint this exists to
  // fix — one page-level number, not a block property, because the aside is
  // not a block. Same 8px step and 0..96 cap a block's own spacing carries,
  // snapped again here rather than trusted from the caller: this is written
  // straight into a style attribute.
  const top = snapSpace(ctx.asideTop || 0);
  const style = top ? ` style="margin-top:${top}px"` : '';
  if (kids || times || contact) return `<aside class="tlcb-side"${style}>${kids}${times}${contact}</aside>`;
  // Empty in the editor is a question, so answer it there; on the live page an
  // unfilled sidebar is just nothing.
  return ctx.editing ? `<aside class="tlcb-side"${style}><div class="tlcb-side-card">
      <p class="tlcb-note">Service times and contact details appear here. Fill them in under Church details in the admin.</p>
    </div></aside>` : `<aside class="tlcb-side"${style}></aside>`;
}

// The section template's automatic child list. Never stored on the page — it is
// derived from which pages sit beneath this one, so it cannot go stale.
function childList(ctx) {
  const kids = ctx.children || [];
  if (!kids.length) {
    return ctx.editing ? `<div class="tlcb-kids"><p class="tlcb-note">Pages you file beneath this one are listed here automatically.</p></div>` : '';
  }
  return `<div class="tlcb-kids">${kids.map((k) => {
    const href = safeUrl(k.slug || '');
    const body = `<span class="tlcb-kid-t">${esc(k.title || '')}</span>` +
      (k.seo_description ? `<span class="tlcb-kid-d">${esc(k.seo_description)}</span>` : '');
    return ctx.editing || !href ? `<span class="tlcb-kid">${body}</span>` : `<a class="tlcb-kid" href="${esc(href)}">${body}</a>`;
  }).join('')}</div>`;
}

// wrapTemplate(template, inner, ctx) — the four page layouts.
//
// `inner` may be the joined block HTML or the per-block array; passing the array
// lets `sidebar` lift a leading banner out above the two columns, which is what
// "banner, then blocks" means on every template but `home`.
// ── THE TYPEFACE, ON THE PAGE WRAPPER ────────────────────────────────────────
// The site's chosen pair, written onto the one element every render path emits,
// so it reaches the public page, the editor canvas and /api/ministry/:slug from
// a single line — rather than each of those three remembering to set it, which
// is how the editor comes to show a page in a typeface the site does not use.
//
// Empty when the appearance record is unavailable, which leaves the stylesheet
// rule's own fallback in charge. Nothing here can throw or render a broken
// declaration: an unreadable record simply means the classic pair.
function pageFontVars(ctx) {
  const f = (ctx && ctx.data && ctx.data.appearance && ctx.data.appearance.fonts) || null;
  if (!f || !f.head || !f.body || !f.ui) return '';
  // A font stack is author-controlled data from a fixed list in
  // admin/appearance.js, never anything a visitor or a page editor types — but
  // it is being written into a style attribute, so the two characters that
  // could close it are dropped rather than reasoned about.
  const clean = (s) => String(s).replace(/["<>;{}\\]/g, '');
  // Text size rides along with the typeface, from the same record and onto the
  // same wrapper — one decision about how the site reads, landing in one place.
  // A number, clamped rather than trusted: it is written into a style attribute,
  // and the sizes below are calc()s that a non-number would silently break.
  const ap = (ctx && ctx.data && ctx.data.appearance) || {};
  const num = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 3 ? Number(v) : def);
  const ts = ap.textScale || {};
  const scale = `;--tlcb-scale:${num(ts.body, 1)};--tlcb-head-scale:${num(ts.head, 1)}`;
  return ` style="--tlcb-serif:${clean(f.head)};--tlcb-sans:${clean(f.body)};--tlcb-ui:${clean(f.ui)}${scale}"`;
}

export function wrapTemplate(template, inner, ctx = {}) {
  const key = templateOf(template).key;
  const parts = Array.isArray(inner) ? inner.slice() : [String(inner || '')];
  const list = Array.isArray(ctx.blocks) ? ctx.blocks : [];
  // One signal decides full-bleed, everywhere: the page opens with a banner.
  // `home` is always full-bleed because it has no other shape.
  const banners = new Set(['hero', 'slideshow']);
  const leads = !!(list[0] && banners.has(list[0].type)) ||
    (!list.length && Array.isArray(inner) && /^<div class="tlcb tlcb--(hero|slideshow)\b/.test(parts[0] || ''));
  const full = key === 'home' || leads;
  const cls = 'tlcb-page tlcb-page--' + key + (full ? ' tlcb-page--full' : '');
  // ⚠ `sectionside` lists its children in the ASIDE, so it must not also append
  // the section template's list below the content — that is the same list
  // twice on one page.
  const tail = (ctx.empty || '') + (key === 'section' ? childList(ctx) : '');
  const fonts = pageFontVars(ctx);

  if (key === 'sidebar' || key === 'sectionside') {
    const banner = leads && Array.isArray(inner) ? parts.shift() : '';
    const side = sidebarAside({ ...ctx, withKids: key === 'sectionside' });
    return `<div class="${cls}"${fonts}>${banner}<div class="tlcb-layout">` +
      `<div class="tlcb-layout-main">${parts.join('')}</div>${side}</div>${tail}</div>`;
  }
  return `<div class="${cls}"${fonts}>${parts.join('')}${tail}</div>`;
}

// ── HALF-WIDTH BLOCKS (Task 13c) ─────────────────────────────────────────────
// Two consecutive Half blocks pair into one row, first left, second right. A
// THIRD consecutive Half starts a new row rather than joining a three-up — the
// row is a pair or it is nothing, which is what makes this expressible without
// a container.
//
// A Half with no Half neighbor renders at half width, left-aligned, with the
// right side empty. That is a legitimate layout, not an error state, so it gets
// no warning.
//
// ⚠ Space above and below belong to the ROW, not to each block, and the row
// takes the LARGER of the pair. Two blocks with different spacing sitting side
// by side would otherwise start at different heights, which reads as a bug in
// the page rather than a choice.
export function pairHalves(list, opts = {}) {
  const total = list.length;
  const out = [];
  let i = 0;
  while (i < list.length) {
    if (list[i] && list[i].width === 'half') {
      // Take exactly TWO consecutive halves, not the whole run — a third
      // starts a new row, so a run of four reads left, right, left, right
      // down the page instead of left column top-to-bottom then right.
      const hasPartner = list[i + 1] && list[i + 1].width === 'half';
      const row = hasPartner ? list.slice(i, i + 2) : [list[i]];
      const above = Math.max(...row.map((b) => b.spaceAbove || 0));
      const below = Math.max(...row.map((b) => b.spaceBelow || 0));
      const inner = row.map((blk, n) => renderBlock(
        // A member's own spacing is spent by the row, so it must not be spent
        // twice. Inside the row, blocks are separated by the column gap.
        Object.assign({}, blk, { spaceAbove: 0, spaceBelow: 0 }),
        Object.assign({}, opts, { index: i + n, total }),
      )).join('');
      const lone = row.length === 1 ? ' tlcb-pair--lone' : '';
      out.push(`<div class="tlcb-pair${lone}" style="--tlcb-space-above:${above}px;--tlcb-space-below:${below}px">${inner}</div>`);
      i += row.length;
      continue;
    }
    out.push(renderBlock(list[i], Object.assign({}, opts, { index: i, total })));
    i += 1;
  }
  return out;
}

export function renderPage(blocks, opts = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const total = list.length;
  // ⚠ The blocks are handed to every block's own render. Only the Jump links
  // block reads them today — its automatic mode IS the page's own section
  // list — but the alternative was a second, parallel pass over the list that
  // could disagree with the one that renders it.
  const parts = pairHalves(list, Object.assign({}, opts, { siblings: list }));
  const empty = !total && opts.editing
    ? `<div class="tlcb-empty"><b>This page is empty</b><span>Drag a block up from the panel below to begin.</span></div>`
    : '';
  const css = opts.withCss === false ? '' : BLOCK_CSS;
  // No template named means a ministry page, which has always been a bare
  // column with the full-bleed class applied by the caller. Left exactly as it
  // was so converting ministry pages to `pages` rows can happen on its own.
  if (!opts.template) return css + `<div class="tlcb-page"${pageFontVars(opts)}>` + parts.join('') + empty + `</div>`;
  return css + wrapTemplate(opts.template, parts, Object.assign({}, opts, { blocks: list, empty }));
}
