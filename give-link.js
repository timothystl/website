// ── HOW AN AMOUNT BECOMES A TITHE.LY LINK ────────────────────────────────────
//
// One definition, imported by everything that needs it. It used to exist three
// times — once server-side in give-landing.js, once as a client-side mirror in
// the same file's inline script, and it would have become a fourth the moment
// the giving page moved onto the block editor. Three copies of an arithmetic
// rule about somebody's money is three chances for one of them to be wrong in
// a way nobody notices, because a wrong link still LOOKS like a working link.
//
// The rule itself (confirmed 2026-07-27 against a real Tithe.ly-generated link,
// not a help page): the base link carries formId + locationId + fundId and NO
// amount. Tithe.ly prefills the gift from `?amount=<cents>` — cents, not
// dollars — and a different fund can be selected with `?fundId=…`.
//
// ⚠ The base link is never stored anywhere but the `give_url` setting. It is
// read at request time and the amount appended on the fly. That is why the
// giving page can be edited in the block editor at all: a block holds the
// amount and the words, never the address, so a block published today still
// charges to the right form after the office changes the base link.

export function withAmountAndFund(baseUrl, amountDollars, tithelyFundId) {
  const cents = Math.round(Number(amountDollars) * 100);
  try {
    const u = new URL(baseUrl);
    if (tithelyFundId) u.searchParams.set('fundId', tithelyFundId);
    u.searchParams.set('amount', String(cents));
    return u.toString();
  } catch {
    // baseUrl is not a valid absolute URL (it is validated on save, so this
    // should not happen) — best effort rather than throwing on a public page
    // whose entire job is to take a gift.
    const sep = baseUrl.includes('?') ? '&' : '?';
    const fundPart = tithelyFundId ? `&fundId=${encodeURIComponent(tithelyFundId)}` : '';
    return `${baseUrl}${sep}amount=${cents}${fundPart}`;
  }
}

export const withAmount = (baseUrl, amountDollars) => withAmountAndFund(baseUrl, amountDollars, '');

// An amount typed by staff into a block. Returns null for anything that is not
// a positive number, and the caller renders the row WITHOUT a button rather
// than with a broken one — "$ask the office /month" is a legitimate row to
// write, and a button pointing at $NaN is not a legitimate thing to show.
export function parseAmount(v) {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Thousands separators, so a leadership tier reads $10,000 rather than $10000.
export const fmtAmount = (n) => Number(n).toLocaleString('en-US');

// ── AN ANNUAL COMMITMENT IS ASKED FOR ONE MONTH AT A TIME ────────────────────
//
// Dinger, 2026-08-06: "i would like those to be able to enter lets say
// $5000/year and then the give button would read 416 per month. no one is
// going to click to do a one time gift of 5000."
//
// He is describing the gap between what a leadership row PROMISES and what its
// button ASKED FOR. The row says $5,000 a year — a commitment somebody makes
// once and keeps — and the button was handing Tithe.ly a single $5,000 charge,
// which is not a thing anybody presses. The commitment and the transaction are
// two different numbers, and only one of them belongs on a button.
//
// So the period a row is written in decides what its button asks for. An
// annual row asks for a twelfth; everything else asks for exactly what it
// says, because a $15/week or a $100/month row is already a figure somebody
// would put through a card in one go.
export function isAnnualPeriod(period) {
  return /^\s*\/?\s*(a\s+|per\s+)?(year|yr|yrs|years|annual|annually|annum)\s*$/i
    .test(String(period == null ? '' : period));
}

// What the button actually asks for: `{ amount, per }`, or null when there is
// no usable number (the caller then renders NO button — a dead link is worse
// than a missing one, because it looks like it works).
//
// ⚠ The monthly figure is rounded DOWN to a whole dollar. Twelve of them come
// to a little less than the annual figure ($416 × 12 = $4,992), and that is
// the right direction to be wrong in: a button must never ask for more than
// the number printed on the row beside it. It is also the figure Dinger
// himself wrote for $5,000 — whole dollars, no cents on a button.
export function giftForPeriod(amountDollars, period) {
  const amt = parseAmount(amountDollars);
  if (amt == null) return null;
  if (!isAnnualPeriod(period)) return { amount: amt, per: '' };
  const monthly = Math.floor(amt / 12);
  // Under $12 a year there is no whole-dollar month to ask for, so the row is
  // left asking for the amount as written rather than for $0.
  return monthly >= 1 ? { amount: monthly, per: 'month' } : { amount: amt, per: '' };
}

export const giveButtonLabel = (gift) =>
  'Give $' + fmtAmount(gift.amount) + (gift.per ? '/' + gift.per : '');

// ── THE CLIENT-SIDE MIRROR ───────────────────────────────────────────────────
// The same rule again, but it HAS to be in the browser as well: switching fund
// or typing a custom amount must rewrite every link without a page reload.
// Shipped as a string from this file so the browser copy and the server copy
// are edited in one place and can be seen next to each other.
//
// ⚠ No backticks and no template literals in here. This string is itself
// inside a template literal in every file that ships it, and a stray backtick
// terminates that literal and breaks the whole module while still passing
// `node --check` — which has bitten this repo three times. See the note in
// .github/workflows/test.yml.
export const GIVE_LINK_JS = `
  function tlcGiveLink(baseUrl, amountDollars, tithelyFundId) {
    var cents = Math.round(Number(amountDollars) * 100);
    try {
      var u = new URL(baseUrl);
      if (tithelyFundId) u.searchParams.set('fundId', tithelyFundId);
      u.searchParams.set('amount', String(cents));
      return u.toString();
    } catch (e) {
      var sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
      var fundPart = tithelyFundId ? ('&fundId=' + encodeURIComponent(tithelyFundId)) : '';
      return baseUrl + sep + 'amount=' + cents + fundPart;
    }
  }
`;

// The period arithmetic, mirrored for the browser for the same reason: the
// Giving screen's ladder drawer shows what a row's button will ask for, live,
// as somebody types the amount and picks the period. Without it that drawer
// would be asking staff to divide by twelve in their heads and trust the
// answer — which is how the wrong figure ends up on a button.
//
// ⚠ Two copies again, so `test/give-page.test.mjs` runs this string and the
// exported functions above over the same table of inputs and asserts they
// agree. That is what makes a mirror safe rather than a second chance to be
// wrong: they cannot drift without a test going red.
export const GIVE_PERIOD_JS = `
  function tlcParseAmount(v) {
    var n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  }
  function tlcFmtAmount(n) { return Number(n).toLocaleString('en-US'); }
  function tlcIsAnnual(period) {
    return /^\\s*\\/?\\s*(a\\s+|per\\s+)?(year|yr|yrs|years|annual|annually|annum)\\s*$/i
      .test(String(period == null ? '' : period));
  }
  function tlcGiftForPeriod(amountDollars, period) {
    var amt = tlcParseAmount(amountDollars);
    if (amt == null) return null;
    if (!tlcIsAnnual(period)) return { amount: amt, per: '' };
    var monthly = Math.floor(amt / 12);
    return monthly >= 1 ? { amount: monthly, per: 'month' } : { amount: amt, per: '' };
  }
  function tlcGiveButtonLabel(gift) {
    return 'Give $' + tlcFmtAmount(gift.amount) + (gift.per ? '/' + gift.per : '');
  }
`;
