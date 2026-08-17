// ── HOW A TABLE COUNT BECOMES A CHRISTMAS MARKET PRICE ───────────────────────
//
// One definition, imported by everything that needs it — `admin/market.js`
// (the public application route and the coordinator's screen) and
// `admin/blocks.js` (the self-filling application block on the page editor).
//
// ⚠ THIS IS A TOP-LEVEL, LEAF FILE ON PURPOSE, the same as give-link.js beside
// it — no imports from anything under admin/. admin/blocks.js already imports
// give-link.js for the identical reason: admin/helpers.js imports FROM
// blocks.js (for its rich-text sanitizer), so admin/market.js — which imports
// helpers.js — cannot be imported BY blocks.js without completing a circular
// import. A pure file with no admin/ imports at all is import-safe from
// anywhere, which is the whole point of splitting it out here rather than
// leaving it inside market.js.
//
// ⚠ THE MONEY IS THE PART TO READ FIRST. A vendor pays a GROSSED-UP amount so
// that after the card processor takes its cut the church still receives the
// whole table fee. Get it wrong in the cheap direction and the market quietly
// runs a few dollars short across seventy vendors; get it wrong in the
// expensive direction and every vendor is overcharged. Neither shows up as an
// error anywhere — a wrong amount still looks like a working button, which is
// the same reason give-link.js exists as one file.

export const MARKET_DEFAULTS = {
  tableFee: 30,
  feePercent: 2.9,
  feeFixed: 0.30,
  maxTables: 3,
};

const num = (v, fallback) => {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

// Tables asked for, clamped to what the market actually offers. Anything
// unreadable becomes one table rather than zero — a vendor who reached the
// payment step wants at least one, and a zero-dollar application is a row
// somebody has to chase.
// ⚠ The minus sign is kept in the strip on purpose. Without it "-4" reads as
// FOUR — the sign is discarded and the absolute value clamps to the maximum —
// so posting a negative would quietly buy somebody the largest booth the
// market sells. It has to survive long enough to fail the `< 1` test below.
export function clampTables(v, maxTables = MARKET_DEFAULTS.maxTables) {
  const n = Math.floor(Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, Math.floor(maxTables)));
}

/**
 * What a vendor is asked to pay, in integer cents.
 *
 *   total = round( (tables × fee + fixed) / (1 − percent) )
 *
 * ⚠ CENTS, INTEGER, END TO END. Money on this site has been a float since the
 * gym invoices (AC-5 / GY-7 in the July 2026 review, both still open there),
 * and the failure it produces is a printed subtotal that disagrees with the
 * rows above it. Nothing new should be built that way, so the amount is cents
 * from the moment it is computed to the moment it is stored, and only ever
 * becomes dollars to be printed or handed to Tithe.ly.
 *
 * ⚠ THE HANDOFF'S THIRD FIGURE IS WRONG AND THIS DELIBERATELY DISAGREES WITH
 * IT. README.md gives "1 table $31.20, 2 tables $62.10, 3 tables $92.99". The
 * first two are exactly what this formula produces; the third is the formula
 * TRUNCATED where the other two happened to need no rounding at all. Follow it
 * and the church nets $89.99 on a three-table vendor — a penny short of the
 * $90 the gross-up exists to protect. $31.20 is the anchor worth trusting: it
 * is what a one-table vendor really paid in 2024, which is how the 2.9% + 30¢
 * rate was confirmed in the first place, and rounding (rather than truncating,
 * or rounding up) is what reproduces it. Three tables is $93.00.
 * market.test.mjs asserts the church nets the full fee at all three counts,
 * which is the property, rather than pinning the three numbers alone.
 */
export function priceBreakdown(tables, cfg = {}) {
  const fee = num(cfg.tableFee, MARKET_DEFAULTS.tableFee);
  const pct = num(cfg.feePercent, MARKET_DEFAULTS.feePercent) / 100;
  const fixed = num(cfg.feeFixed, MARKET_DEFAULTS.feeFixed);
  const n = clampTables(tables, cfg.maxTables ?? MARKET_DEFAULTS.maxTables);

  const subtotalCents = Math.round(n * fee * 100);
  // A percentage at or above 100 would divide by zero or go negative. It can
  // only get here by somebody typing it into Settings, and the honest answer
  // to "the processor takes everything" is to charge the fee itself rather
  // than to ask for an infinite amount.
  const denom = 1 - pct;
  const totalCents = denom > 0.01
    ? Math.round(((n * fee + fixed) / denom) * 100)
    : subtotalCents;
  return {
    tables: n,
    subtotalCents,
    feeCents: totalCents - subtotalCents,
    totalCents,
  };
}

// "$30", "$31.20". Whole dollars lose their trailing zeros, the way the design
// writes them — a ladder of $30 / $60 / $90 reads worse with .00 on every row.
export function money(cents) {
  const v = (Number(cents) || 0) / 100;
  return '$' + v.toFixed(2).replace(/\.00$/, '');
}

// ── THE BROWSER'S COPY ───────────────────────────────────────────────────────
// The three-step card recomputes the subtotal, the fee, the total and the
// submit button's label the instant somebody picks a different number of
// tables. That has to happen without a round trip, so the arithmetic exists
// twice — and `admin/market.test.mjs` evaluates this string and runs it
// against the exported functions over the same table of inputs, so the two
// cannot drift. That is what makes a mirror safe rather than a second chance
// to be wrong.
//
// ⚠ No backticks and no template literals in here. This string sits inside a
// template literal wherever it is shipped, and a stray backtick terminates
// that literal and breaks the whole module while still passing `node --check`
// — see the note in .github/workflows/test.yml.
export const MARKET_PRICING_JS = `
  function tlcMktClampTables(v, maxTables) {
    var n = Math.floor(Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(n, Math.max(1, Math.floor(maxTables || 3)));
  }
  function tlcMktPrice(tables, cfg) {
    cfg = cfg || {};
    var fee = Number(cfg.tableFee); if (!isFinite(fee)) fee = 30;
    var pct = Number(cfg.feePercent); if (!isFinite(pct)) pct = 2.9;
    pct = pct / 100;
    var fixed = Number(cfg.feeFixed); if (!isFinite(fixed)) fixed = 0.30;
    var n = tlcMktClampTables(tables, cfg.maxTables);
    var subtotalCents = Math.round(n * fee * 100);
    var denom = 1 - pct;
    var totalCents = denom > 0.01
      ? Math.round(((n * fee + fixed) / denom) * 100)
      : subtotalCents;
    return { tables: n, subtotalCents: subtotalCents, feeCents: totalCents - subtotalCents, totalCents: totalCents };
  }
  function tlcMktMoney(cents) {
    var v = (Number(cents) || 0) / 100;
    return '$' + v.toFixed(2).replace(/\\.00$/, '');
  }
`;
