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
