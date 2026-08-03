// Standalone giving landing page — served at give.timothystl.org (site-worker.js).
// This is NOT part of the public/index.html SPA and has no nav back into it by design:
// per Andrew, someone lands here from a bulletin/QR/text link, sees one thing, and gives.
//
// Built from the "Giving Landing" design handoff (option 4a — "Conversion patterns"),
// adapted from the literal spec: (1) the top nav's Visit/Worship/Learn links and the nav
// "Give" button are dropped — there's nowhere else on this page to send someone, and the
// whole page already is the give action; (2) the impact-figures block (real $ / meals-
// served / cents-per-dollar stats) is omitted entirely rather than shipping the design's
// placeholder numbers; (3) the Monthly/One-time toggle from the original build was removed
// 2026-07-27 — Tithe.ly has no way to generate a custom link that prefills specifically as
// recurring vs. one-time, so the toggle never actually changed anything real. The giver
// picks frequency on Tithe.ly's own page.
//
// ── Tithe.ly linking ────────────────────────────────────────────────────────────────
// Correction, 2026-07-27: Tithe.ly DOES support prefilling the gift amount — confirmed
// against a real link Andrew generated (`?formId=...&locationId=...&fundId=...&amount=2500`
// for a $25 gift — amount is in CENTS). This supersedes the earlier assumption (based on
// generic Tithe.ly help-doc search results, not a real generated link) that a distinct link
// had to be pre-made per amount. Now: the base link (`give_url` setting) is expected to
// hold everything EXCEPT amount — formId + locationId + fundId — and `withAmount()` below
// appends `&amount=<cents>` for whatever amount is selected/typed, computed on the fly. A
// tier's optional `url` field becomes a full override (e.g. to send one specific tier to a
// different fund entirely) rather than the normal case — the normal case now needs no
// per-tier link management at all.

// Used only if the admin API is unreachable when site-worker.js builds the page, so the
// giving page never breaks outright. Matches the ministry-ladder amounts Andrew provided
// 2026-07-27 (see the "Makes possible" table below) — editable for real via the Giving tab.
export const FALLBACK_BASE_URL = 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8';
export const FALLBACK_TIERS = [30, 50, 75, 90, 150, 250].map(amount => ({
  amount, url: '', isDefault: amount === 50,
}));
// A single "General Fund" entry with a blank tithelyFundId means "use whatever fundId is
// already in the base link" — no fund override applied. This is what a fresh/unseeded DB
// gets too (see the give_funds seed in tlc-admin-worker.js).
export const FALLBACK_FUNDS = [{ id: 0, name: 'General Fund', tithelyFundId: '', isDefault: true }];

const VALUES_BAND = [
  { key: 'acceptance', label: 'Acceptance', word: 'Welcome', color: '#4A5E3A' },
  { key: 'worship',    label: 'Worship',    word: 'Receive', color: '#1E2D4A' },
  { key: 'christianed', label: 'Christian Education', word: 'Grow', color: '#2E7EA6' },
  { key: 'outreach',   label: 'Outreach',   word: 'Go',      color: '#C9973A' },
];

const valuesBandHtml = VALUES_BAND.map(v => `
  <div class="vb-cell" style="border-left:2px solid ${v.color};">
    <div class="vb-label" style="color:${v.color};">${v.label}</div>
    <div class="vb-word">${v.word}</div>
  </div>`).join('');

// ── The two giving pages, and which one does what ──────────────────────────
// This page is the transaction: pick an amount, pick a fund, go. The *other*
// ways to give — the offering plate, bank bill pay, Thrivent, an IRA qualified
// charitable distribution, a Donor Advised Fund, a gift through a will — need
// paragraphs and a phone call, not a button, and they live on
// timothystl.org/give.
//
// So this strip names them and links there. It deliberately does not repeat the
// copy: two descriptions of a QCD, in two files, is one of them going stale.
const OTHER_WAYS = [
  'On Sunday morning',
  'Bank bill pay',
  'Thrivent Charitable',
  'IRA charitable distribution',
  'Donor Advised Fund',
  'Planned giving',
];

const otherWaysHtml = OTHER_WAYS.map(w => `<span class="ow-item">${w}</span>`).join('');

// The "What Your Generosity Makes Possible" ministry ladder — Andrew's exact copy
// (updated 2026-07-27, weekly framing). Each row links directly to Tithe.ly for that
// amount, same as the leadership tiers below — not just informational.
const MINISTRY_LADDER = [
  { amount: 15,  outcome: 'Sponsors devotional resources throughout the year.' },
  { amount: 30,  outcome: 'Puts flowers on the altar.' },
  { amount: 50,  outcome: 'Sends a youth to the National Youth Gathering.' },
  { amount: 75,  outcome: 'Helps support tuition aid preparing future church workers.' },
  { amount: 100, outcome: 'Provides tuition assistance for a child to Word of Life.' },
  { amount: 175, outcome: 'Underwrites music ministry for the year.' },
  { amount: 300, outcome: 'Provides one week of care in our MDO program.' },
];

// "Bigger Commitments. Bigger Impact." — leadership-level annual gifts, Andrew's exact
// copy (2026-07-27). Each gets its own direct Give button rather than joining the chip
// picker above — fewer, larger, more narrative asks. Both $10,000 items are intentional:
// two distinct real costs (heat, power) that happen to land at the same figure.
const LEADERSHIP_TIERS = [
  { amount: 5000,  outcome: 'Helps ensure every child hears about Jesus regardless of a family’s ability to pay.' },
  { amount: 9000,  outcome: 'Funds an entire year of music ministry that leads worship every Sunday.' },
  { amount: 10000, outcome: 'Keeps our campus warm throughout the winter so ministry never stops.' },
  { amount: 10000, outcome: 'Powers every classroom, office, sanctuary, and ministry space for a year.' },
  { amount: 18000, outcome: 'Provides health insurance for one member of our ministry staff, allowing them to care for people instead of worrying about their family’s healthcare.' },
];

const fmtAmount = n => n.toLocaleString('en-US');

// Appends Tithe.ly's amount param (cents), and optionally overrides fundId, on a base link
// that already carries formId/locationId/fundId. Robust to a base link with or without
// existing query params, and to one that may (incorrectly) already have its own amount=/
// fundId= — this always wins.
function withAmountAndFund(baseUrl, amountDollars, tithelyFundId) {
  const cents = Math.round(amountDollars * 100);
  try {
    const u = new URL(baseUrl);
    if (tithelyFundId) u.searchParams.set('fundId', tithelyFundId);
    u.searchParams.set('amount', String(cents));
    return u.toString();
  } catch {
    // baseUrl isn't a valid absolute URL (shouldn't happen — validated on save) — best
    // effort rather than throwing on a public page.
    const sep = baseUrl.includes('?') ? '&' : '?';
    const fundPart = tithelyFundId ? `&fundId=${encodeURIComponent(tithelyFundId)}` : '';
    return `${baseUrl}${sep}amount=${cents}${fundPart}`;
  }
}
const withAmount = (baseUrl, amountDollars) => withAmountAndFund(baseUrl, amountDollars, '');

// tiers: [{amount, url, isDefault}], baseUrl: string, funds: [{id, name, tithelyFundId, isDefault}]
export function renderGiveLandingHtml(tiers, baseUrl, funds) {
  const safeTiers = Array.isArray(tiers) && tiers.length ? tiers : FALLBACK_TIERS;
  const safeBaseUrl = baseUrl || FALLBACK_BASE_URL;
  const safeFunds = Array.isArray(funds) && funds.length ? funds : FALLBACK_FUNDS;
  const defaultTier = safeTiers.find(t => t.isDefault) || safeTiers[0];
  const defaultAmount = defaultTier.amount;
  const defaultFund = safeFunds.find(f => f.isDefault) || safeFunds[0];

  // Per-tier override URLs only — used as-is (ignoring the fund selector entirely), for the
  // rare case a specific amount should go somewhere else altogether. Everything else is
  // computed client-side from BASE_URL + the currently selected fund, so switching funds
  // updates every amount's link without a page reload.
  const tierOverrideByAmount = {};
  for (const t of safeTiers) if (t.url) tierOverrideByAmount[t.amount] = t.url;
  const initialLinkByAmount = {};
  for (const t of safeTiers) initialLinkByAmount[t.amount] = t.url || withAmountAndFund(safeBaseUrl, t.amount, defaultFund.tithelyFundId);

  const ladderRowsHtml = MINISTRY_LADDER.map(row => `
    <div class="ladder-row">
      <div class="ladder-left">
        <div class="ladder-amount">$${row.amount}<span class="ladder-period">/week</span></div>
        <div class="ladder-outcome">${row.outcome}</div>
      </div>
      <a class="ladder-cta" href="${withAmount(safeBaseUrl, row.amount)}" target="_blank" rel="noopener">Give $${row.amount}</a>
    </div>`).join('');

  const leadershipRowsHtml = LEADERSHIP_TIERS.map(row => `
    <div class="leadership-row">
      <div class="leadership-left">
        <div class="leadership-amount">$${fmtAmount(row.amount)}<span class="leadership-period">/year</span></div>
        <div class="leadership-outcome">${row.outcome}</div>
      </div>
      <a class="leadership-cta" href="${withAmount(safeBaseUrl, row.amount)}" target="_blank" rel="noopener">Give $${fmtAmount(row.amount)}</a>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Give — Timothy Lutheran Church</title>
<meta name="description" content="Support the ministry of Timothy Lutheran Church — give securely online through Tithe.ly, one-time or monthly.">
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/images/favicon-32x32.png">
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Source+Sans+3:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Source Sans 3', Arial, sans-serif;
    color: #4A4860;
    background: #F7F3EC;
  }
  a { text-decoration: none; }

  /* ── Top bar ── */
  .topbar {
    background: #111E32;
    padding: 14px 40px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .topbar .logo-disc {
    width: 34px; height: 34px; border-radius: 50%;
    background: #fff; display: flex; align-items: center; justify-content: center;
    padding: 4px; flex-shrink: 0;
  }
  .topbar .logo-disc img { width: 100%; height: 100%; object-fit: contain; }
  .topbar .church-name {
    font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase;
    color: #fff;
  }

  /* ── Hero header (full-width, replaces the old photo panel) ── */
  .hero-header {
    background: #111E32; padding: 56px 40px; text-align: center;
  }
  .hero-header h1 {
    font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 48px; line-height: 1.1;
    color: #fff; text-wrap: balance; max-width: 820px; margin: 0 auto;
  }

  /* ── Give row: ministry ladder (left) + giving widget (right) ── */
  .give-row {
    display: grid;
    grid-template-columns: 1.15fr .85fr;
    background: #FBF8F3;
  }
  .ladder-col {
    padding: 48px 44px; border-right: 1px solid #DDE3ED;
  }
  .ladder-eyebrow {
    font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
    color: #C9973A; margin-bottom: 10px;
  }
  .ladder-heading { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 26px; color: #1E2D4A; }
  .ladder-steps {
    margin-top: 18px; font-size: 14px; line-height: 1.65; color: #4A4860;
    display: flex; flex-direction: column; gap: 5px;
  }
  .ladder-steps b { color: #1E2D4A; }
  .ladder-list { margin-top: 24px; display: flex; flex-direction: column; gap: 10px; }
  .ladder-row {
    display: flex; align-items: center; justify-content: space-between; gap: 14px;
    background: #fff; border: 1px solid #DDE3ED; border-radius: 10px; padding: 14px 16px;
    flex-wrap: wrap;
  }
  .ladder-amount { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 19px; color: #1E2D4A; }
  .ladder-period { font-family: 'Source Sans 3', sans-serif; font-weight: 400; font-size: 12px; color: #8C8880; }
  .ladder-outcome { font-size: 13px; line-height: 1.5; color: #4A4860; margin-top: 2px; max-width: 320px; }
  .ladder-cta {
    background: #C9973A; color: #1E2D4A; font-weight: 800; font-size: 13px;
    padding: 10px 16px; border-radius: 8px; white-space: nowrap; transition: background .2s;
  }
  .ladder-cta:hover { background: #E8C070; }

  .widget-col {
    background: #FBF8F3;
    padding: 48px 40px;
    display: flex; flex-direction: column;
  }
  .widget-col .give-title { font-family: 'Lora', Georgia, serif; font-weight: 600; font-size: 27px; color: #1E2D4A; }
  .widget-col .tagline { font-family: 'Lora', Georgia, serif; font-style: italic; font-size: 15.5px; color: #2E7EA6; margin-top: 4px; }

  .fund-label {
    font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    color: #6b6a5f; margin-top: 24px; margin-bottom: 8px;
  }
  .fund-select {
    width: 100%; background: #fff; border: 1px solid #DDE3ED; border-radius: 9px;
    padding: 12px 14px; font-family: 'Source Sans 3', sans-serif; font-size: 15px;
    color: #1E2D4A; font-weight: 600; cursor: pointer;
  }
  .fund-select:focus-visible { outline: 2px solid #2E7EA6; outline-offset: 2px; }

  .amount-label {
    font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    color: #6b6a5f; margin-top: 26px; margin-bottom: 10px;
  }
  .amount-chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .chip {
    border-radius: 8px; font-size: 17px; font-weight: 700; text-align: center;
    padding: 14px 0; background: #fff; color: #1E2D4A; border: 1px solid #DDE3ED;
    cursor: pointer; transition: all .15s;
  }
  .chip.active { background: #1E2D4A; color: #fff; border-color: #1E2D4A; box-shadow: 0 6px 16px -8px rgba(30,45,74,.6); }
  .chip:focus-visible { outline: 2px solid #2E7EA6; outline-offset: 2px; }

  .other-amount {
    margin-top: 10px; background: #fff; border: 1px solid #DDE3ED; border-radius: 9px;
    padding: 12px 14px; display: flex; align-items: center; gap: 8px;
  }
  .other-amount .dollar { font-family: 'Lora', Georgia, serif; font-size: 19px; color: #8C8880; }
  .other-amount input {
    border: none; outline: none; font-size: 15px; font-family: 'Source Sans 3', sans-serif;
    color: #1E2D4A; flex: 1; min-width: 0; background: transparent;
  }
  .other-amount input:focus-visible { outline: 2px solid #2E7EA6; outline-offset: 2px; }
  .amount-error { font-size: 12.5px; color: #B0821E; margin-top: 6px; display: none; }
  .amount-error.show { display: block; }

  .cta {
    margin-top: 22px; display: flex; align-items: center; justify-content: center; gap: 8px;
    background: #C9973A; color: #1E2D4A; font-family: 'Source Sans 3', sans-serif;
    font-size: 21px; font-weight: 800; padding: 20px; border-radius: 10px;
    box-shadow: 0 12px 28px -14px rgba(30,45,74,.5);
    transition: background .2s, transform .15s;
  }
  .cta:hover { background: #E8C070; transform: translateY(-2px); }
  .cta:focus-visible { outline: 2px solid #2E7EA6; outline-offset: 2px; }

  .trust-line {
    margin-top: 16px; display: flex; gap: 9px; font-size: 12.5px; line-height: 1.55; color: #6b6a5f;
  }
  .trust-line svg { flex-shrink: 0; margin-top: 2px; }


  /* ── Leadership giving ── */
  .leadership-section { background: #111E32; padding: 48px 40px; }
  .leadership-intro { max-width: 720px; margin: 0 auto 32px; text-align: center; }
  .leadership-eyebrow {
    font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
    color: #E8C070; margin-bottom: 10px;
  }
  .leadership-heading { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 30px; color: #fff; }
  .leadership-sub { font-size: 15px; color: rgba(255,255,255,.7); margin-top: 10px; line-height: 1.6; }
  .leadership-table { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
  .leadership-row {
    display: flex; align-items: center; justify-content: space-between; gap: 20px;
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.14);
    border-radius: 10px; padding: 18px 22px; flex-wrap: wrap;
  }
  .leadership-amount { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 24px; color: #E8C070; }
  .leadership-period { font-family: 'Source Sans 3', sans-serif; font-weight: 400; font-size: 13px; color: rgba(255,255,255,.55); }
  .leadership-outcome { font-size: 14.5px; color: rgba(255,255,255,.82); line-height: 1.55; margin-top: 4px; max-width: 480px; }
  .leadership-cta {
    background: #C9973A; color: #1E2D4A; font-weight: 800; font-size: 14.5px;
    padding: 12px 20px; border-radius: 8px; white-space: nowrap; transition: background .2s;
  }
  .leadership-cta:hover { background: #E8C070; }

  /* ── Other ways to give ── */
  .other-ways {
    background: #FBF8F3; border-top: 1px solid #DDE3ED; padding: 30px 40px 34px;
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 20px;
  }
  .ow-copy { max-width: 620px; }
  .ow-eyebrow {
    font-size: 11px; font-weight: 800; text-transform: uppercase;
    letter-spacing: .06em; color: #4A5E3A;
  }
  .ow-heading {
    font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 21px;
    color: #1A1A2A; margin-top: 5px;
  }
  .ow-items { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
  .ow-item {
    background: #FFFFFF; border: 1px solid #DDE3ED; border-radius: 999px;
    padding: 5px 13px; font-size: 12.5px; color: #4A4860; white-space: nowrap;
  }
  .ow-cta {
    background: #1E2D4A; color: #FFFFFF; font-weight: 800; font-size: 14.5px;
    padding: 12px 22px; border-radius: 8px; white-space: nowrap; transition: background .2s;
  }
  .ow-cta:hover { background: #2E4670; }

  /* ── Values band ── */
  .values-band {
    background: #F7F3EC; border-top: 1px solid #DDE3ED; padding: 32px 40px 36px;
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
  }
  .vb-cell { padding: 0 20px; }
  .vb-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
  .vb-word { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 22px; color: #1A1A2A; margin-top: 4px; }

  /* ── Footer ── */
  .footer {
    background: #111E32; padding: 26px 40px; display: flex; justify-content: space-between;
    flex-wrap: wrap; gap: 12px; color: rgba(255,255,255,.7); font-size: 13.5px;
    border-top: 1px solid rgba(255,255,255,.1);
  }
  .footer a { color: #C9973A; font-weight: 600; }

  @media (max-width: 900px) {
    .hero-header { padding: 40px 20px; }
    .hero-header h1 { font-size: 32px; }
    .give-row { grid-template-columns: 1fr; }
    .ladder-col { border-right: none; border-bottom: 1px solid #DDE3ED; padding: 32px 22px; }
    .values-band { grid-template-columns: 1fr 1fr; padding: 24px 20px 28px; }
    .other-ways { padding: 26px 20px 30px; }
    .ow-cta { width: 100%; text-align: center; }
    .amount-chips { gap: 8px; }
    .chip { font-size: 14px; padding: 11px 0; }
    .topbar { padding: 14px 20px; }
    .widget-col { padding: 32px 22px; }
    .footer { padding: 22px 20px; text-align: center; justify-content: center; }
    .leadership-section { padding: 36px 20px; }
    .ladder-row { flex-direction: column; align-items: flex-start; }
    .ladder-cta { width: 100%; text-align: center; }
    .leadership-row { flex-direction: column; align-items: flex-start; }
    .leadership-cta { width: 100%; text-align: center; }
  }
</style>
</head>
<body>
  <div class="topbar">
    <div class="logo-disc"><img src="/logo.png" alt=""></div>
    <div class="church-name">Timothy Lutheran Church</div>
  </div>

  <div class="hero-header">
    <h1>Your Gift Continues His Work</h1>
  </div>

  <div class="give-row">
    <div class="ladder-col">
      <div class="ladder-eyebrow">What Your Generosity Makes Possible</div>
      <div class="ladder-heading">Every gift accomplishes great things in His Kingdom.</div>
      <div class="ladder-steps">
        <div><b>1.</b> Start automated giving if you don't already.</div>
        <div><b>2.</b> Strengthen your recurring gift by increasing it to the next level.</div>
        <div><b>3.</b> Sustain the mission through leadership-level gifts that underwrite the ministries the whole congregation depends on.</div>
      </div>
      <div class="ladder-list">${ladderRowsHtml}</div>
    </div>

    <div class="widget-col">
      <div class="give-title">Give to Timothy</div>
      <div class="tagline">From Our Neighborhood to the Nations</div>

      ${safeFunds.length > 1 ? `
      <div class="fund-label">Give to</div>
      <select class="fund-select" id="fund-select" onchange="setFund(this.value)">
        ${safeFunds.map(f => `<option value="${(f.tithelyFundId||'').replace(/"/g,'&quot;')}"${f.id===defaultFund.id?' selected':''}>${f.name}</option>`).join('')}
      </select>` : ''}

      <div class="amount-label">Choose an amount</div>
      <div class="amount-chips" id="amount-chips" role="group" aria-label="Gift amount">
        ${safeTiers.map(t => `<div class="chip${t.amount===defaultAmount?' active':''}" tabindex="0" role="button" data-amount="${t.amount}" onclick="setAmount(${t.amount})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setAmount(${t.amount});}">$${t.amount}</div>`).join('')}
      </div>

      <div class="other-amount">
        <span class="dollar">$</span>
        <input type="number" min="1" step="1" id="other-amount-input" placeholder="Other amount" oninput="onOtherAmountInput(this)">
      </div>
      <div class="amount-error" id="amount-error">Please enter an amount of at least $1.</div>

      <a class="cta" id="give-cta" href="${initialLinkByAmount[defaultAmount]}" target="_blank" rel="noopener">
        <span id="cta-label">Give $${defaultAmount}</span> <span aria-hidden="true"></span>
      </a>

      <div class="trust-line">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4A5E3A" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/></svg>
        <span>Secure, encrypted giving through Tithe.ly. Receipt emailed instantly · tax-deductible · no account required.</span>
      </div>
    </div>
  </div>

  <div class="leadership-section">
    <div class="leadership-intro">
      <div class="leadership-eyebrow">Bigger Commitments. Bigger Impact.</div>
      <div class="leadership-heading">What your generosity becomes.</div>
      <div class="leadership-sub">A child hearing about Jesus. A family receiving hope. A teenager discovering lifelong faith. A teacher serving with confidence. A sanctuary filled with worship. A church whose doors stay open to the neighborhood.</div>
    </div>
    <div class="leadership-table">${leadershipRowsHtml}</div>
  </div>

  <div class="other-ways">
    <div class="ow-copy">
      <div class="ow-eyebrow">Other ways to give</div>
      <div class="ow-heading">Not every gift starts with a card.</div>
      <div class="ow-items">${otherWaysHtml}</div>
    </div>
    <a class="ow-cta" href="https://timothystl.org/give">See all the ways to give</a>
  </div>

  <div class="values-band">${valuesBandHtml}</div>

  <div class="footer">
    <div>Timothy Lutheran Church &middot; 6704 Fyler Ave, St. Louis, MO 63139</div>
    <div>Questions? <a href="mailto:office@timothystl.org">office@timothystl.org</a></div>
  </div>

<script>
  var BASE_URL = ${JSON.stringify(safeBaseUrl)};
  var TIER_OVERRIDES = ${JSON.stringify(tierOverrideByAmount)};
  var state = { amount: ${JSON.stringify(defaultAmount)}, fundId: ${JSON.stringify(defaultFund.tithelyFundId || '')} };

  // Client-side mirror of the server's withAmountAndFund() — Tithe.ly prefills the gift
  // amount via a plain ?amount=<cents> query param, and lets a different fund be selected
  // via ?fundId=..., both appended to the base formId/locationId/fundId link. Recomputed
  // here (not just server-side) so changing the fund selector or typing a custom "other
  // amount" both produce a real prefilled link without a page reload.
  function withAmountAndFund(baseUrl, amountDollars, tithelyFundId) {
    var cents = Math.round(amountDollars * 100);
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

  function linkFor(amount) {
    // A tier's own override link ignores the fund selector entirely — it's a full,
    // deliberate override (e.g. a different fund/form), not just an amount+fund combo.
    if (TIER_OVERRIDES[amount]) return TIER_OVERRIDES[amount];
    return withAmountAndFund(BASE_URL, amount, state.fundId);
  }

  function render() {
    var chips = document.querySelectorAll('#amount-chips .chip');
    chips.forEach(function(c) {
      var isActive = Number(c.getAttribute('data-amount')) === state.amount;
      c.classList.toggle('active', isActive);
    });

    document.getElementById('cta-label').textContent = 'Give $' + state.amount;
    document.getElementById('give-cta').href = linkFor(state.amount);
  }

  function setAmount(amount) {
    state.amount = amount;
    document.getElementById('other-amount-input').value = '';
    document.getElementById('amount-error').classList.remove('show');
    render();
  }

  function setFund(tithelyFundId) {
    state.fundId = tithelyFundId;
    render();
  }

  function onOtherAmountInput(input) {
    var val = parseInt(input.value, 10);
    var errEl = document.getElementById('amount-error');
    if (!input.value) { errEl.classList.remove('show'); return; }
    if (!val || val < 1) { errEl.classList.add('show'); return; }
    errEl.classList.remove('show');
    // Clear chip selection, but a custom amount now gets its own prefilled link too —
    // Tithe.ly's amount param works for any figure, not just the fixed tiers.
    state.amount = val;
    document.querySelectorAll('#amount-chips .chip').forEach(function(c) { c.classList.remove('active'); });
    document.getElementById('cta-label').textContent = 'Give $' + val;
    document.getElementById('give-cta').href = withAmountAndFund(BASE_URL, val, state.fundId);
  }

  render();
</script>
</body>
</html>`;
}
