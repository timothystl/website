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
import { withAmountAndFund, parseAmount, fmtAmount, giftForPeriod, giveButtonLabel, GIVE_LINK_JS } from '../give-link.js';
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

export const STAMP_PRESETS = ['New', 'Upcoming', 'Take note', 'Registration open'];

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
export const EMBED_HEIGHTS = [
  { key: 's', label: 'Short', px: 420 },
  { key: 'm', label: 'Medium', px: 560 },
  { key: 'l', label: 'Tall', px: 700 },
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
    photo: true, subtitle: true, banner: true, infoCard: true,
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
    auto: 'staff', autoNote: 'Pulls from the staff directory.',
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
  hero: {
    label: 'Hero banner', glyph: '▣',
    defaults: { title: 'Ministry name', eyebrow: 'Ministry', subtitle: 'One line about this ministry.', spaceAbove: 0, spaceBelow: 0 },
    photo: true, subtitle: true, banner: true, infoCard: true, align: true,
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
  events: {
    label: 'Upcoming events', glyph: '▤',
    align: true,
    defaults: { title: 'Upcoming', spaceAbove: 24, spaceBelow: 24 },
    feed: 'events', auto: 'events', autoNote: 'Pulls from the church calendar.',
  },
  times: {
    label: 'Meeting times', glyph: '◷',
    align: true,
    defaults: { title: 'When we gather', spaceAbove: 24, spaceBelow: 24 },
    items: true, itemFields: ['title', 'body', 'meta'], itemLabel: 'Row',
    itemPlaceholders: { title: 'Who', body: 'When', meta: 'Where' },
    defaultItems: [{ title: 'Group name', body: 'Wednesdays, 7:00 pm', meta: 'Fellowship Hall' }],
  },
  calendar: {
    label: 'Calendar', glyph: '▩',
    align: true,
    defaults: { title: 'Calendar', spaceAbove: 24, spaceBelow: 24, url: '', embedHeight: 'm', subscribe: true },
    url: true, urlLabel: 'Google Calendar embed URL', richBody: true,
    choices: [
      { key: 'embedHeight', label: 'How tall', def: 'm', options: EMBED_HEIGHTS,
        note: 'A month grid needs the room; a short tray is right when the calendar is not the point of the page.' },
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
    url: true, urlLabel: 'Google Form embed URL', richBody: true, align: true,
  },
  newsletter: {
    label: 'Newsletter', glyph: '✉',
    defaults: { title: 'Get news by email', body: 'A short note each month.', spaceAbove: 24, spaceBelow: 24 },
    richBody: true, align: true,
  },
  give: {
    label: 'Give', glyph: '♡',
    defaults: { title: 'Support this ministry', body: 'Gifts go directly toward this work.', spaceAbove: 24, spaceBelow: 24, url: 'https://give.timothystl.org' },
    url: true, urlLabel: 'Giving link', richBody: true, align: true,
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
    align: true, photo: true, subtitle: true, banner: true, infoCard: true,
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

// The design's own four groups, in its order. Structure leads because that is
// what somebody reaches for first on an empty page — the banner and the shape
// of it — and Content is what they fill it with afterwards.
export const GROUPS = [
  { name: 'Structure', types: ['alert', 'photobanner', 'hero', 'slideshow', 'highlight', 'cta', 'quicklinks', 'cardgrid', 'buttons', 'callout', 'partners', 'spacer'] },
  { name: 'Content',   types: ['text', 'textphoto', 'quote', 'values', 'video', 'columns', 'gallery', 'faq', 'sermon', 'news', 'newsfeed', 'staff', 'posts'] },
  { name: 'Dates',     types: ['servicetimes', 'chips', 'map', 'events', 'times', 'download', 'calendar'] },
  // `giving` and `amounts` join the group that already holds `give` rather
  // than starting a fifth. They belong to one page, and a group of two that
  // only ever appears on the giving page would read on every other page as a
  // section of the library that is broken.
  { name: 'Sign up',   types: ['form', 'signup', 'newsletter', 'letter', 'newsletterarchive', 'give', 'giving', 'amounts'] },
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

const RICH_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li',
  'a', 'h2', 'h3', 'h4', 'blockquote', 'span', 'div', 'img', 'hr', 'sup', 'sub']);
// `rel` is deliberately NOT allowed through: it is re-added below, once. Letting
// the incoming one survive as well made every sanitize pass append another copy.
const RICH_ATTRS = { a: ['href', 'target'], img: ['src', 'alt', 'width', 'height'] };
const RICH_VOID = new Set(['br', 'img', 'hr']);

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
    subtitle: cleanText(b.subtitle, 300),
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
    url: def.url ? safeUrl(b.url).slice(0, 600) : '',
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
    tone: clampIndex(b.tone, TONES.length),
    corner: b.corner === 'tl' ? 'tl' : 'tr',
    hidden: !!b.hidden,
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

export const BLOCK_CSS = `<style id="tlcb-css">
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
.tlcb-page--full > .tlcb--hero .tlcb-hero{border-radius:0;}
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
  margin-top:var(--tlcb-space-above,0px);margin-bottom:var(--tlcb-space-below,0px);}
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
.tlcb-cg-card:hover{box-shadow:0 18px 40px rgba(16,27,46,.16);transform:translateY(-4px);}
/* A soft lift, not a drop — the card rises toward the reader. */
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
  background:#1E2D4A var(--tlcb-hero-img,none) center/cover;}
.tlcb-hero::before{content:'';position:absolute;inset:0;border-radius:inherit;
  background:linear-gradient(135deg,rgba(30,45,74,.82),rgba(17,30,50,.92));opacity:var(--tlcb-hero-veil,0);}
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
.tlcb-callout{padding:18px 20px;border-radius:10px;background:#FDF8EC;border:1px solid #F0DCB0;display:flex;flex-direction:column;gap:7px;}
.tlcb-callout-tag{align-self:flex-start;padding:2px 8px;border-radius:5px;background:#C9973A;color:#1B1608;
  font:700 10px/1.6 var(--tlcb-ui);letter-spacing:.1em;text-transform:uppercase;}
.tlcb-callout-t{font:600 16px/1.35 var(--tlcb-ui);color:#1E2D4A;}
.tlcb-btns{display:flex;gap:10px;flex-wrap:wrap;}
.tlcb-btn{display:inline-block;padding:15px 22px;border-radius:999px;font:800 14px/1 var(--tlcb-ui);text-decoration:none;
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
  font:600 13px/1 var(--tlcb-ui);text-decoration:none;}
.tlcb-chip--go{background:#C9973A;color:#1B1608;border-color:#C9973A;padding:10px 18px;font-weight:700;}
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
.tlcb-person-p{aspect-ratio:1/1;border-radius:9px;background:#DDE3ED center/cover no-repeat;}
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
.tlcb-side-lines{display:flex;flex-direction:column;gap:5px;font-size:13.5px;color:#4A4860;line-height:1.5;}
.tlcb-side-lines a{color:#2E7EA6;}
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
   in this language where a hue other than navy or gold is allowed. */
.tlcb-vals{display:grid;grid-template-columns:var(--tlcb-cols,repeat(4,1fr));gap:20px;align-items:stretch;}
.tlcb-val{display:flex;flex-direction:column;gap:6px;border-radius:22px;padding:30px 26px;
  background:var(--v-field);color:var(--v-ink);box-shadow:0 18px 44px rgba(16,27,46,.16);}
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
.tlcb-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--tlcb-rule,#D8CFBB);
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
@media(prefers-reduced-motion:reduce){
  .tlcb-pulse{animation:none;}
  .tlcb-media img,.tlcb-cg-card{transition:none;}
  .tlcb-media:hover img{transform:none;}
  .tlcb-cg-card:hover{transform:none;}
}
@media(max-width:640px){
PHONE_RULES_PLACEHOLDER
  .tlcb-hide-phone{display:none!important;}
}
</style>`.replace('PHONE_RULES_PLACEHOLDER', phoneRules(''));

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
      itemUrlFields: d.itemUrlFields || [], itemImageFields: d.itemImageFields || [],
      richBody: !!d.richBody, align: !!d.align,
      gallery: !!d.gallery, feed: d.feed || '', infoCard: !!d.infoCard,
      partnerSource: !!d.partnerSource,
      choices: d.choices || [], switches: d.switches || [],
      defaults: d.defaults || {}, defaultItems: d.defaultItems || [],
    };
  }
  return { types, groups: GROUPS, templates: TEMPLATES, BG, INK, SIZES, SPLITS, TONES,
    bannerHeights: BANNER_HEIGHTS, veils: VEILS, glows: GLOWS, embedHeights: EMBED_HEIGHTS,
    partners: (data && data.partners) || [],
    cardSides: CARD_SIDES, cardShows: CARD_SHOWS, starters: STARTERS.map((s) => ({ key: s.key, label: s.label, note: s.note })),
    stamps: STAMP_PRESETS, step: SPACE_STEP, max: SPACE_MAX };
}

// ── RENDERING ────────────────────────────────────────────────────────────────

const sizeOf = (b) => SIZES.find((s) => s.key === b.size) || SIZES[1];
const splitOf = (b) => SPLITS.find((s) => s.key === b.split) || SPLITS[1];

// A URL going into a CSS url() inside a style="" attribute has two escape
// contexts stacked (HTML attribute, then CSS string). Rather than reason about
// both, strip every character that could close either one — a legitimate image
// URL never contains them.
const cssUrl = (u) => String(u || '').replace(/["'\\()\s<>;{}]/g, '');

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
    '--tlcb-bg:' + (bg.grad || bg.c),
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
    '--tlcb-body:' + sz.body + 'px',
    '--tlcb-head:' + sz.head + 'px',
    '--tlcb-hero:' + sz.hero + 'px',
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
  if (b.type === 'textphoto' || b.type === 'map' || b.type === 'sermon') v.push('--tlcb-cols:' + cols);
  if (b.type === 'columns') v.push('--tlcb-cols:repeat(' + b.cols + ',1fr)');
  if (b.type === 'cardgrid') v.push('--tlcb-cols:repeat(' + b.cols + ',1fr)');
  if (b.type === 'values') v.push('--tlcb-cols:repeat(' + b.cols + ',1fr)');
  if (b.type === 'hero' && b.photo) {
    v.push("--tlcb-hero-img:url('" + cssUrl(b.photo) + "')");
    v.push('--tlcb-hero-veil:1'); // the gradient that keeps white text legible over a photo
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
  return `<span class="tlcb-stamp tlcb-stamp--${b.corner === 'tl' ? 'tl' : 'tr'}" style="${style}"${editable}>${esc(b.stamp)}</span>`;
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
      ? field(opts, b, 'subtitle', 'p', 'tlcb-pb-sub', esc(b.subtitle || ''), ' data-ph="Where it is, when it starts, who it is for"')
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
      const ink = v.darkInk ? '#3B2E12' : 'rgba(255,255,255,.94)';
      const head = v.darkInk ? '#101B2E' : '#FFFFFF';
      const label = v.darkInk ? 'rgba(16,27,46,.72)' : 'rgba(255,255,255,.88)';
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
      return `<div class="tlcb-val" style="--v-field:${v.field};--v-ink:${ink};--v-head:${head};--v-label:${label};--v-accent:${v.light}">
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

  if (t === 'letter') {
    const issues = data.newsletters || [];
    const newest = issues[0];
    const rest = issues.slice(1, 1 + Math.max(0, b.count));
    const dead = opts.editing ? ' onclick="return false"' : '';
    const eyebrow = newest
      ? `<div class="tlcb-eyebrow">${esc(fmtNewsDate(newest.published_at))}</div>`
      : renderEyebrow(opts, b);
    const read = newest
      ? `<a class="tlcb-btn" href="/news/${esc(newest.id)}"${dead}>Read this week</a>`
      : '';
    // The sign-up goes to the site's own page rather than carrying a form of
    // its own: there is exactly one newsletter sign-up on this site and it is
    // site-wide chrome (Menu \u2192 Appearance), not something a block owns a
    // second copy of.
    const join = b.signup ? `<a class="tlcb-btn tlcb-btn--ghost-light" href="/news#subscribe"${dead}>Get it by email</a>` : '';
    const list = rest.map((n) => `<a class="tlcb-lt-row" href="/news/${esc(n.id)}"${dead}>
      <span class="tlcb-lt-s">${esc(n.subject || '')}</span>
      <span class="tlcb-lt-d">${esc(fmtNewsDate(n.published_at, true))}</span></a>`).join('');
    const right = list
      ? `<div class="tlcb-lt-list">${list}</div>`
      : (opts.editing ? `<span class="tlcb-note">Older letters will be listed here as they are sent.</span>` : '');
    return `<div class="tlcb-lt">
      <div class="tlcb-lt-b">${eyebrow}
        ${field(opts, b, 'title', 'div', 'tlcb-head', esc(b.title || ''), ' data-ph="The weekly letter"')}
        ${renderBody(opts, b, def, 'What the letter is, and who writes it')}
        ${read || join ? `<div class="tlcb-btns">${read}${join}</div>` : ''}
        ${newest ? '' : `<span class="tlcb-note">No letters have been sent yet, so the button is hidden until the first one goes out.</span>`}
      </div>${right}</div>`;
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
      ${field(opts, b, 'subtitle', 'p', 'tlcb-slide-sub', esc(b.subtitle || ''), ' data-ph="A sentence underneath it"')}
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
      const gold = BG[7];
      const tiles = svc.slice(0, 4).map((r, i) => {
        const alt = i % 2 === 1
          ? ` style="--tlcb-bg:${gold.grad};--tlcb-head-ink:${gold.head};--tlcb-ink:#3B2E12;--tlcb-eyebrow-ink:${gold.eyebrow}"`
          : '';
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
    const people = (data.staff || []).slice(0, b.count).map((m) => `<div class="tlcb-person">
        <span class="tlcb-person-p"${m.photo_url ? ` style="background-image:url('${cssUrl(m.photo_url)}')"` : ''}></span>
        <span class="tlcb-person-n">${esc(m.name || '')}</span>
        <span class="tlcb-person-r">${esc(m.title || '')}</span>
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}
      ${people ? `<div class="tlcb-people">${people}</div>` : `<p class="tlcb-note">The staff directory is empty.</p>`}</div>`;
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
      ${field(opts, b, 'subtitle', 'p', 'tlcb-hero-sub', esc(b.subtitle || ''), ' data-ph="One line about this ministry"')}
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
      // The arrow is part of the label the office types, so "Learn more",
      // "Visit MDO site" and "Watch video" all work with no setting for it.
      const link = it.linkLabel
        ? (opts.editing
            ? itemField(opts, i, 'linkLabel', 'div', 'tlcb-cg-link', esc(it.linkLabel), ' data-ph="Learn more"')
            : `<a class="tlcb-cg-link" href="${esc(it.url || '#')}">${esc(it.linkLabel)}</a>`)
        : '';
      return `<div class="tlcb-cg-card">${img}${eyebrow}${head}${body}<div class="tlcb-cg-foot">${link}</div></div>`;
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
        ${itemField(opts, i, 'title', 'b', '', esc(it.title || ''), ' data-ph="Who"')}
        ${itemField(opts, i, 'body', 'i', '', esc(it.body || ''), ' data-ph="When"')}
        ${itemField(opts, i, 'meta', 'u', '', esc(it.meta || ''), ' data-ph="Where"')}
      </div>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-times">${rows}</div></div>`;
  }

  if (t === 'faq') {
    const rows = (b.items || []).map((it, i) => `<details class="tlcb-faq"${opts.editing ? ' open' : ''}>
        <summary>${itemField(opts, i, 'title', 'span', '', esc(it.title || ''), ' data-ph="A question people ask"')}</summary>
        ${itemField(opts, i, 'body', 'div', 'tlcb-prose', it.body || '', ' data-ph="The answer"', true)}
      </details>`).join('');
    return `<div class="tlcb-stack">${renderHead(opts, b)}<div class="tlcb-rows">${rows}</div></div>`;
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
    return `<div class="tlcb-panel tlcb-panel--form">${renderHead(opts, b)}${renderBody(opts, b, def)}${inner}</div>`;
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
    const href = safeUrl(b.url) || 'https://give.timothystl.org';
    // Just the one button — an amount is a choice give.timothystl.org's own
    // widget already asks for; suggesting one here duplicated that page
    // instead of just handing off to it.
    const go = opts.editing
      ? `<span class="tlcb-chip tlcb-chip--go">Give now</span>`
      : `<a class="tlcb-chip tlcb-chip--go" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Give now</a>`;
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
  return `<div class="${classes.join(' ')}" style="${wrapperVars(b)}"${attrs}>${tools}${renderStamp(opts, b)}${inner}</div>`;
}

// The sidebar template's right-hand column. Reads the one site-settings record,
// never the page — staff fix the phone number once and every sidebar updates.
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
  if (times || contact) return `<aside class="tlcb-side">${times}${contact}</aside>`;
  // Empty in the editor is a question, so answer it there; on the live page an
  // unfilled sidebar is just nothing.
  return ctx.editing ? `<aside class="tlcb-side"><div class="tlcb-side-card">
      <p class="tlcb-note">Service times and contact details appear here. Fill them in under Church details in the admin.</p>
    </div></aside>` : '<aside class="tlcb-side"></aside>';
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
  return ` style="--tlcb-serif:${clean(f.head)};--tlcb-sans:${clean(f.body)};--tlcb-ui:${clean(f.ui)}"`;
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
  const tail = (ctx.empty || '') + (key === 'section' ? childList(ctx) : '');
  const fonts = pageFontVars(ctx);

  if (key === 'sidebar') {
    const banner = leads && Array.isArray(inner) ? parts.shift() : '';
    return `<div class="${cls}"${fonts}>${banner}<div class="tlcb-layout">` +
      `<div class="tlcb-layout-main">${parts.join('')}</div>${sidebarAside(ctx)}</div>${tail}</div>`;
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
  const parts = pairHalves(list, opts);
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
