// ── give.timothystl.org, AS BLOCKS ───────────────────────────────────────────
//
// The giving landing page's draft. Hand-written rather than produced by
// tools/extract-pages.mjs, because that extractor reads page divs out of
// public/index.html and this page has never been in the SPA — it is its own
// document, served by site-worker.js on its own hostname.
//
// ⚠ THIS SEEDS THE DRAFT ONLY. `published_blocks` stays empty, so
// give.timothystl.org goes on rendering give-landing.js exactly as it does
// today until somebody opens the editor, reads this against the live page and
// presses Publish. That is deliberate and it is not the same call that was
// made for /give: this is the page that takes the money, and a deploy that
// silently swaps the donation page's rendering path is not something to do
// while nobody is looking.
//
// ⚠ NOT ONE BLOCK HERE CARRIES A TITHE.LY ADDRESS, and none can: neither
// `giving` nor `amounts` has a url field to put one in. Every Give button is
// computed at render time from the `give_url` setting. That is the whole
// reason this page could move into the editor — a block's URL is frozen the
// moment it is published, so a stored link would go on charging to the old
// form after the office changed it, and the page would still look perfect.
//
// The copy is Andrew's own, carried across verbatim from give-landing.js
// (2026-07-27). Where the two differ from here on, the editor is the truth —
// give-landing.js is the fallback for when the admin cannot be reached.

export const GIVE_LANDING_PAGE_ID = 'give-landing';

// Palette indices into BG/INK in admin/blocks.js, named so a reordering of
// those arrays is a one-line fix here rather than four silent color changes.
const BG_PARCHMENT = 0;
const BG_NAVY = 3;
const INK_INK = 0;
const INK_CREAM = 3;

// The ministry ladder — weekly amounts, each tied to one concrete outcome.
const LADDER = [
  ['15', 'Sponsors devotional resources throughout the year.'],
  ['30', 'Puts flowers on the altar.'],
  ['50', 'Sends a youth to the National Youth Gathering.'],
  ['75', 'Helps support tuition aid preparing future church workers.'],
  ['100', 'Provides tuition assistance for a child to Word of Life.'],
  ['175', 'Underwrites music ministry for the year.'],
  ['300', 'Provides one week of care in our MDO program.'],
];

// Leadership giving — annual. Both $10,000 rows are deliberate: two distinct
// real costs (heat, power) that happen to land at the same figure.
const LEADERSHIP = [
  ['5000', 'Helps ensure every child hears about Jesus regardless of a family’s ability to pay.'],
  ['9000', 'Funds an entire year of music ministry that leads worship every Sunday.'],
  ['10000', 'Keeps our campus warm throughout the winter so ministry never stops.'],
  ['10000', 'Powers every classroom, office, sanctuary, and ministry space for a year.'],
  ['18000', 'Provides health insurance for one member of our ministry staff, allowing them to care for people instead of worrying about their family’s healthcare.'],
];

const rows = (list, period) => list.map(([amount, body]) => ({ amount, period, body: `<p>${body}</p>` }));

// Block ids are written out rather than generated, so re-running the seed
// produces a byte-identical draft and a diff only when the content really
// changed — the same rule tools/extract-pages.mjs follows.
export const GIVE_LANDING_BLOCKS = [
  {
    id: 'gl-hero', type: 'hero',
    title: 'Your Gift Continues His Work',
    eyebrow: '', subtitle: '',
    align: 'center', bg: BG_NAVY, ink: INK_CREAM, size: 'l',
    spaceAbove: 0, spaceBelow: 0,
  },
  // The ladder and the widget are a HALF/HALF pair, which is what produces the
  // live page's two-column give row — the ladder on the left, the amount chips
  // on the right. A third half would start a new row; there is no third.
  {
    id: 'gl-ladder', type: 'amounts', width: 'half',
    eyebrow: 'What Your Generosity Makes Possible',
    title: 'Every gift accomplishes great things in His Kingdom.',
    body: '<p><strong>1.</strong> Start automated giving if you don’t already.</p>'
      + '<p><strong>2.</strong> Strengthen your recurring gift by increasing it to the next level.</p>'
      + '<p><strong>3.</strong> Sustain the mission through leadership-level gifts that underwrite the ministries the whole congregation depends on.</p>',
    items: rows(LADDER, 'week'),
    bg: BG_PARCHMENT, ink: INK_INK, spaceAbove: 40, spaceBelow: 40,
  },
  {
    id: 'gl-widget', type: 'giving', width: 'half',
    title: 'Give to Timothy',
    subtitle: 'From Our Neighborhood to the Nations',
    body: '<p>Secure, encrypted giving through Tithe.ly. Receipt emailed instantly · tax-deductible · no account required.</p>',
    bg: BG_PARCHMENT, ink: INK_INK, spaceAbove: 40, spaceBelow: 40,
  },
  {
    id: 'gl-leadership', type: 'amounts',
    eyebrow: 'Bigger Commitments. Bigger Impact.',
    title: 'What your generosity becomes.',
    body: '<p>A child hearing about Jesus. A family receiving hope. A teenager discovering lifelong faith. '
      + 'A teacher serving with confidence. A sanctuary filled with worship. A church whose doors stay open to the neighborhood.</p>',
    items: rows(LEADERSHIP, 'year'),
    align: 'center', bg: BG_NAVY, ink: INK_CREAM,
    spaceAbove: 48, spaceBelow: 48,
  },
  // The offline paths are NAMED here and described on timothystl.org/give.
  // Deliberately no descriptions: two accounts of an IRA qualified charitable
  // distribution, in two places, is one of them going stale.
  // A `text` block rather than a Callout: Callout renders a fixed "Please
  // note" tag and ignores the eyebrow, and this strip is neither a warning nor
  // something to note — it is the quiet list of the other doors in.
  {
    id: 'gl-other', type: 'text',
    body: '<h3>Not every gift starts with a card.</h3>'
      + '<p>On Sunday morning · Bank bill pay · Thrivent Charitable · '
      + 'IRA charitable distribution · Donor Advised Fund · Planned giving</p>',
    bg: BG_PARCHMENT, ink: INK_INK, spaceAbove: 32, spaceBelow: 8,
  },
  {
    id: 'gl-other-cta', type: 'buttons',
    items: [{ title: 'See all the ways to give', url: 'https://timothystl.org/give' }],
    spaceAbove: 0, spaceBelow: 32,
  },
];

export const GIVE_LANDING_PAGE = {
  id: GIVE_LANDING_PAGE_ID,
  title: 'Giving page (give.timothystl.org)',
  menu_label: '',
  // Its own address is the hostname, not a path on the main site. The slug is
  // recorded so the Pages list has something to show and so nothing else can
  // claim it, but /api/pages skips this page: rendering the transaction page
  // inside the SPA as well would make a third giving surface, and the whole
  // settled rule is that there are two, with separate jobs.
  slug: '/give-landing',
  parent_id: null,
  sort: 900,
  template: 'standard',
  in_menu: 0,
  seo_description: 'Give securely online to Timothy Lutheran Church.',
  blocks: GIVE_LANDING_BLOCKS,
};
