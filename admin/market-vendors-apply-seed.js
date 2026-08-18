// ── /christmasmarket/vendors/apply, AS BLOCKS ────────────────────────────────
//
// Page 2 of 2. `/christmasmarket/vendors` is the pitch — what a table costs,
// what the rules are, what the day looks like — and this is the form, and
// almost nothing else.
//
// ⚠ THE SPLIT IS THE WHOLE POINT, so resist putting prose back here. Every
// sentence that explains the market belongs on page A; a vendor who has
// clicked through has already read it, and a second copy here is a second
// thing to keep current every December. What this page carries is a banner
// that says where you are, a band of facts that are READ rather than typed,
// and the application.
//
// ⚠ NOT ONE FIGURE ON THIS PAGE IS STORED IN A BLOCK. The date, the hours,
// the table fee, the table maximum and the coordinator's address all come
// from the `market_*` settings through `data.market`, on both the facts band
// (BLOCK_DEFS.marketfacts) and the application itself (BLOCK_DEFS.marketapp).
// Neither type has a url field, so a payment address cannot be stored on this
// page even deliberately — what a vendor is charged and where it goes are
// both resolved server-side at the moment they submit. See market-price.js
// and marketPayUrl() in admin/market.js.
//
// ⚠ THE NINE AGREEMENT CLAUSES ARE NOT RETYPED HERE, for the same reason
// admin/market-page-seed.js gives: they are Andrew's own wording and they
// live in BLOCK_DEFS.marketapp.defaultItems, which is also what a brand-new
// application block starts with. One copy, not three.

import { BLOCK_DEFS } from './blocks.js';

export const MARKET_APPLY_PAGE_ID = 'marketvendorsapply';

// Palette indices into BG/INK in admin/blocks.js — named rather than left as
// bare numbers, the same as the other two hand-authored seeds.
const BG_MOSS = 9;
const INK_CREAM = 3;

const AGREEMENT_ITEMS = JSON.parse(JSON.stringify(BLOCK_DEFS.marketapp.defaultItems));

export const MARKET_APPLY_BLOCKS = [
  // The banner. A `cta` band rather than a hero: a hero is the top of a page
  // somebody has arrived at, and this is the second step of something they
  // are already doing — it needs to say where they are and offer the way
  // back, not open an argument.
  {
    id: 'mva-banner', type: 'cta',
    eyebrow: 'Vendor application',
    title: 'Timothy Christmas Market',
    body: '<p>Three short steps, about five minutes, one payment at the end.</p>',
    bg: BG_MOSS, ink: INK_CREAM,
    spaceAbove: 0, spaceBelow: 0,
    // No trailing arrow, and no leading one either — see admin/link-style.test.mjs.
    items: [{ title: 'Rules & details', url: '/christmasmarket/vendors' }],
  },
  {
    id: 'mva-facts', type: 'marketfacts',
    spaceAbove: 0, spaceBelow: 0,
  },
  {
    id: 'mva-application', type: 'marketapp',
    eyebrow: 'The application', title: 'Vendor application',
    body: '<p>You pay by card at the end and the coordinator confirms your table number by email.</p>',
    spaceAbove: 40, spaceBelow: 48,
    items: AGREEMENT_ITEMS,
  },
];

export const MARKET_APPLY_PAGE = {
  id: MARKET_APPLY_PAGE_ID,
  title: 'Christmas Market Vendor Application Form',
  menu_label: '',
  // ⚠ THREE PLACES HAVE TO AGREE ON THIS ADDRESS: here, NESTED_PATHS in
  // public/index.html (tlcPathFor) and pathForPageId() in site-worker.js.
  // The SPA routes by page id and derives the address from it, so a mismatch
  // means the edge injection looks for this page's blocks at the wrong path
  // and silently finds nothing — the page still works, it just loses the
  // flash-prevention every other converted page has.
  slug: '/christmasmarket/vendors/apply',
  parent_id: 'marketvendors',
  sort: 10,
  template: 'standard',
  // Reached from page A, never from the header or footer — the same as its
  // parent. Somebody should read what a table costs before meeting a form.
  in_menu: 0,
  seo_description: 'Apply for a vendor table at Timothy Lutheran Church’s Christmas Market — three steps, about five minutes.',
  blocks: MARKET_APPLY_BLOCKS,
};
