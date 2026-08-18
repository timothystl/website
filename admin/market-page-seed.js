// ── /christmasmarket/vendors, AS BLOCKS ──────────────────────────────────────
//
// The vendor application's draft, hand-written for the same reason
// give-landing-seed.js is: this page has a real live payment application on
// it, and admin/BLOCK-EDITOR-ROLLOUT.md's extractor never ran against it,
// because it never had a `PAGES` entry in tools/extract-pages.mjs — the page
// was built directly in public/index.html (v5.6.0/v5.8.0), after the
// extractor's own list was written, and adding it there would have asked the
// generic extractor to make sense of a three-step form with a running total,
// which is exactly the shape of page that extractor cannot convert (see the
// note on /give in tools/extract-pages.mjs's own history).
//
// Andrew, asked how he wanted to keep this page's words current going
// forward, picked the Pages editor over the two lighter options offered —
// this is that.
//
// ⚠ THIS IS PUBLISHED NOW (2026-08-18). It used to seed the draft only, with
// the hardcoded markup in public/index.html rendering the live page until
// somebody pressed Publish. That markup is deleted: this file IS the page.
// The one-time, marker-gated publish lives in tlc-admin-worker.js beside the
// one that put /give on the editor, and it only ever touches a page nobody
// has edited by hand (`updated_by = 'migration'`). Unlike give.timothystl.org
// this page is NOT excluded from /api/pages: it is an ordinary SPA page like
// any other.
//
// ⚠ TWO SENTENCES FROM THE HARDCODED PAGE ARE CARRIED AS `text` BLOCKS
// (mv-rules-lead, mv-photos-lead) rather than as an intro on the block they
// belong to. `tiles` and `gallery` render no body or subtitle field, so the
// alternative was either losing Andrew's own copy or widening two shared
// block types for one page. A text block above each is what the live page
// actually was — a lead paragraph in its own right — and it is what the
// office can edit.
//
// ⚠ THE ONE BLOCK THAT TAKES MONEY HAS NO url FIELD AT ALL, and cannot: see
// the 'marketapp' entry in admin/blocks.js's BLOCK_DEFS and its renderer
// branch. What a vendor is charged and where the payment goes are both
// resolved from live settings (admin/market.js's marketConfigFromRows(),
// fed into pageData() as `data.market`) at the moment they submit — never
// stored on the block, never frozen at publish time.
//
// ⚠ THE NINE AGREEMENT CLAUSES ARE NOT RETYPED HERE. They are Andrew's own
// wording (2026-08, sent directly — see CLAUDE.md, "Copy correction"), and
// they are also what a brand-new marketapp block starts with when someone
// drags one onto a page from the palette (BLOCK_DEFS.marketapp.defaultItems).
// Reading them from there rather than pasting a second copy means there is
// exactly one place the vendor agreement's legal text lives — the same
// argument this file already makes for the pricing math living in
// market-price.js rather than being retyped per caller.
//
// ⚠ EDITORIAL CHOICE, WORTH KNOWING BEFORE CHANGING THIS COPY BACK: nothing
// below names the market coordinator or quotes the table fee in dollars.
// The coordinator's name and address change with whoever volunteers for the
// role (market_coordinator_email), and the fee is the market_table_fee
// setting the marketapp block already reads live — writing either into this
// page's prose would create a second copy that goes stale the day either one
// changes, which is the exact failure this whole editor exists to prevent.
// The marketapp block itself still names the coordinator by email, live,
// twice (closed-applications state and the step-3 fine print) because that
// dynamic mailto link is safe: it is read from the setting at render time,
// never typed.

// ⚠ THE APPLICATION ITSELF IS NOT ON THIS PAGE ANY MORE. It moved to
// /christmasmarket/vendors/apply (admin/market-vendors-apply-seed.js) so a
// first-time visitor can read what a table costs and what the rules are
// without meeting a form. This page ends in a call to action pointing there;
// the `marketapp` block is REMOVED rather than hidden, because a hidden block
// is one somebody switches back on by accident and then there are two.
export const MARKET_VENDORS_PAGE_ID = 'marketvendors';

// Palette indices into BG/INK in admin/blocks.js — see give-landing-seed.js
// for why these are named rather than inlined as bare numbers.
const BG_PARCHMENT = 0;
const BG_NAVY = 3;
// --steel, the site's own navy band. Same index as BG_NAVY — named twice on
// purpose, because the two uses are different decisions and one of them may
// move.
const BG_STEEL = 3;
const INK_INK = 0;
const INK_CREAM = 3;

// Block ids are written out rather than generated, so re-running the seed
// (tools/extract-pages.mjs does not touch this page, but a future hand-edit
// of this file might) produces a byte-identical draft and a diff only when
// the content really changed.
export const MARKET_VENDORS_BLOCKS = [
  {
    id: 'mv-hero', type: 'hero',
    eyebrow: 'Vendor applications · Weihnachtsmarkt, Timothy’s Christmas Market',
    title: 'Bring your table to the Christmas Market',
    subtitle: 'Sixty-plus makers, bakers and neighbors set up outdoors in our parking lot on market day, '
      + 'under weather coverage we provide. Read the four things that matter, then apply — the form is its own page, '
      + 'about five minutes, one payment.',
    bg: BG_NAVY, ink: INK_CREAM, size: 'l',
    spaceAbove: 0, spaceBelow: 0,
  },
  // The hero block carries no links of its own, so the two buttons under it
  // are their own block. The first is the whole reason this page was split;
  // the second is an in-page jump to the details below, which works because
  // every block renders its own id as a DOM id (see renderBlock).
  {
    id: 'mv-hero-cta', type: 'buttons',
    spaceAbove: 24, spaceBelow: 8,
    items: [
      { title: 'Start the application', url: '/christmasmarket/vendors/apply' },
      { title: 'Vendor details', url: '#mv-details' },
    ],
  },
  // ⚠ THE SAME BLOCK TYPE THE APPLY PAGE USES, and that is the point. The
  // split put the date, the hours and the fee on two public addresses; both
  // read them from the one setting rather than either page carrying a typed
  // copy that goes stale in December.
  {
    id: 'mv-facts', type: 'marketfacts',
    spaceAbove: 8, spaceBelow: 0,
  },
  // ⚠ AUTO MODE, so the bar follows the page rather than a typed list somebody
  // has to remember to update. Reordering, renaming or adding a section below
  // moves the chips with it; there is nothing here to fall out of step.
  {
    id: 'mv-jump', type: 'jumplinks',
    title: 'Jump to', mode: 'auto', sticky: true,
    url: '/christmasmarket/vendors/apply', buttonText: 'Apply for a table',
    spaceAbove: 0, spaceBelow: 0,
  },
  {
    id: 'mv-details', type: 'cardgrid',
    eyebrow: 'Before you apply', title: 'Vendor details',
    cols: 4, bg: BG_PARCHMENT, ink: INK_INK, spaceAbove: 48, spaceBelow: 48,
    items: [
      { title: 'Your space', body: '<p>Each table gets an 8×10 ft space with weather coverage and one 6-foot table we provide. '
        + 'Bring your own chairs and a table covering that reaches the ground. Most vendors take one table.</p>' },
      { title: 'Setup &amp; teardown', body: '<p>Enter from Ivanhoe at the north lot entrance starting at 8:30 am. Vehicle access closes at 10:30 '
        + '— move yours to street parking at least 3 blocks away once you’re unloaded, and stay set up until 6:00 pm. '
        + 'Vehicles are allowed back at 6:15 to load out.</p>' },
      { title: 'Handmade &amp; local first', body: '<p>Artisans, bakers, small businesses and youth groups — handmade, Christmas and gift items. '
        + 'Secondhand goods aren’t permitted, and direct sales reps are encouraged to offer a gift basket.</p>' },
      { title: 'Pay when you apply', body: '<p>Submitting takes you to secure card payment with your amount already filled in. '
        + 'Vendors cover the small card processing fee, shown before you submit.</p>' },
    ],
  },
  {
    id: 'mv-rules-lead', type: 'text',
    body: '<p>Nothing here is a surprise if you have done a market before. The full agreement is at the bottom of the application.</p>',
    spaceAbove: 48, spaceBelow: 0,
  },
  {
    id: 'mv-rules', type: 'tiles',
    eyebrow: 'The short version', title: 'Rules at a glance',
    spaceAbove: 16, spaceBelow: 48,
    items: [
      { title: 'You bring the chairs', body: '<p>We supply your 6-foot table and weather coverage. You bring chairs, a table covering that reaches '
        + 'the ground, signage, display, change, and your own bags.</p>' },
      { title: 'No alcohol at vendor booths', body: '<p>Vendors may not sell alcohol or other beverages. Only a booth owned and operated by Timothy '
        + 'Lutheran Church may sell drinks.</p>' },
      { title: 'Food vendors', body: '<p>Prepared and packaged food is welcome. You are responsible for meeting City of St. Louis health department '
        + 'requirements for what you sell.</p>' },
      { title: 'Electricity is limited', body: '<p>Tell us your appliances, wattage and amperage on the application — the coordinator approves every '
        + 'electrical request before the market. Heaters and heated blankets aren’t permitted; bring your own cord and surge protector.</p>' },
      { title: 'Refunds are limited', body: '<p>Your fee is refunded only if we decline your application or products. Otherwise there are no refunds for '
        + 'a withdrawal within three weeks of the market, or for a no-show.</p>' },
    ],
  },
  {
    id: 'mv-photos-lead', type: 'text',
    body: '<p>Aisles of handmade goods, the smell of something baking, and most of Lindenwood Park through the doors before noon.</p>',
    spaceAbove: 40, spaceBelow: 0,
  },
  {
    id: 'mv-photos', type: 'gallery',
    eyebrow: 'Past markets', title: 'What the day looks like',
    spaceAbove: 16, spaceBelow: 40,
    // ⚠ ONE REAL PHOTOGRAPH. The old hardcoded page shipped two more slots as
    // explicit placeholders saying what was wanted; a gallery block has no
    // such placeholder state — an item with no url renders as an empty
    // grid cell, which looks like a fault rather than an invitation. Add the
    // rest from "Manage photos" in the editor when they exist, the same
    // "still open" note this repo already carries for the market's photos.
    items: [
      { url: '/images/ministries/christmas-mkt.webp', title: 'Shoppers at the Timothy Christmas Market' },
    ],
  },
  {
    id: 'mv-notes', type: 'cardgrid',
    title: 'Questions, or just shopping?', cols: 2,
    bg: BG_PARCHMENT, ink: INK_INK, spaceAbove: 0, spaceBelow: 48,
    items: [
      { title: 'Questions first?', body: '<p>The market coordinator would rather hear from you before you apply than after — their address is at the '
        + 'top of this page and on the application itself.</p>' },
      { title: 'Just want to shop?', body: '<p>The market is free and open to the public. Come by on market day — the date and hours are at the top of '
        + 'this page.</p>', linkLabel: 'Market details', url: '/christmasmarket' },
    ],
  },
  {
    id: 'mv-faq', type: 'faq',
    eyebrow: 'Good to know', title: 'Questions vendors ask',
    spaceAbove: 24, spaceBelow: 48,
    items: [
      { title: 'Can I request to be next to a friend?', body: '<p>Yes — put it in special requests. We honor placement requests whenever the floor '
        + 'plan allows, and returning vendors usually keep their spot.</p>' },
      { title: 'What if I don’t have photos yet?', body: '<p>Apply anyway. Photos are optional — last year’s inventory or works in progress is '
        + 'plenty, and you can email them to the coordinator later.</p>' },
      { title: 'Is there a commission on sales?', body: '<p>No — the table fee is all we take. What you sell is yours.</p>' },
      { title: 'Do church groups pay the fee?', body: '<p>Timothy and Word of Life youth groups and ministries can apply with the fee waived — note it in '
        + 'special requests and the coordinator will sort it out.</p>' },
      { title: 'Is the market outdoors?', body: '<p>Yes — Weihnachtsmarkt sets up in our parking lot, and every space has weather coverage we provide. '
        + 'Enter from Ivanhoe at the north lot entrance.</p>' },
      { title: 'Can I share a table with someone?', body: '<p>Sure — list both names under participants and apply once. One fee covers the table however '
        + 'many of you are behind it.</p>' },
      { title: 'What if I need to cancel?', body: '<p>Email the coordinator as soon as you know. Your fee is refunded if we decline your application or '
        + 'products — otherwise there are no refunds within three weeks of the market, or for a no-show.</p>' },
    ],
  },
  // The closing ask. Somebody who has read the rules, the photos and the FAQ
  // has reached the bottom of a long page — this is the second and last time
  // the apply page is offered, and it is the reason they are here.
  {
    id: 'mv-apply-cta', type: 'cta',
    eyebrow: 'Ready?', title: 'The application takes about five minutes.',
    body: '<p>You will need what you sell, your power needs, and a card.</p>',
    bg: BG_STEEL, ink: INK_CREAM,
    spaceAbove: 0, spaceBelow: 0,
    items: [{ title: 'Apply for a table', url: '/christmasmarket/vendors/apply' }],
  },
  {
    id: 'mv-shop-cta', type: 'cta',
    eyebrow: 'Not a vendor?', title: 'Come shop the market',
    body: '<p>Free admission, free parking on Ivanhoe, and a lot full of handmade gifts and food.</p>',
    align: 'center', bg: BG_NAVY, ink: INK_CREAM,
    spaceAbove: 0, spaceBelow: 0,
    items: [{ title: 'Market details', url: '/christmasmarket' }],
  },
];

export const MARKET_VENDORS_PAGE = {
  id: MARKET_VENDORS_PAGE_ID,
  title: 'Christmas Market Vendor Application',
  menu_label: '',
  // Matches NESTED_PATHS in public/index.html (tlcPathFor) and site-worker.js
  // (pathForPageId) — both have to agree on this address or the edge-render
  // injection looks for this page's blocks at the wrong path. See the note in
  // site-worker.js: "a mirror of tlcPathFor(), and it has to stay one."
  slug: '/christmasmarket/vendors',
  parent_id: 'christmasmarket',
  sort: 10,
  template: 'standard',
  // Not in the header/footer nav — same as today. The page is reached from a
  // link on /christmasmarket, not from the main menu, exactly as the
  // hardcoded page is now.
  in_menu: 0,
  seo_description: 'Apply for a vendor table at Timothy Lutheran Church’s Christmas Market — space, fees, rules and the application.',
  blocks: MARKET_VENDORS_BLOCKS,
};
