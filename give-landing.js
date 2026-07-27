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
// Amount tiers and the base link are admin-editable (admin.timothystl.org → Giving tab,
// `give_amount_tiers` table + `give_url` setting) rather than hardcoded here —
// site-worker.js fetches them and passes them into renderGiveLandingHtml() below. Any tier
// with no dedicated link falls back to the base link, so the CTA is always a real, working
// Tithe.ly page even for amounts that haven't been given their own prefilled link yet.

// Used only if the admin API is unreachable when site-worker.js builds the page, so the
// giving page never breaks outright. Matches the ministry-ladder amounts Andrew provided
// 2026-07-27 (see the "Makes possible" table below) — editable for real via the Giving tab.
export const FALLBACK_BASE_URL = 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8';
export const FALLBACK_TIERS = [30, 50, 75, 90, 150, 250].map(amount => ({
  amount, url: '', isDefault: amount === 50,
}));

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

// The "What Your Generosity Makes Possible" ministry ladder — Andrew's exact copy
// (2026-07-27), reinforcing the amount chips above with concrete outcomes rather than
// bare dollar labels. Purely informational — not wired to the interactive chip picker.
const MINISTRY_LADDER = [
  { amount: 30,  outcome: 'Provides one week of tuition assistance for a child in our daycare.' },
  { amount: 50,  outcome: 'Provides a week of tuition assistance for a student at Timothy Lutheran School.' },
  { amount: 75,  outcome: 'Sponsors devotional resources for families throughout the year.' },
  { amount: 90,  outcome: 'Helps send a youth to a retreat or gathering.' },
  { amount: 150, outcome: 'Provides a month of ministry support for a family in financial need.' },
  { amount: 250, outcome: 'Helps underwrite children’s ministry and outreach for an entire month.' },
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

// tiers: [{amount, url, isDefault}], baseUrl: string
export function renderGiveLandingHtml(tiers, baseUrl) {
  const safeTiers = Array.isArray(tiers) && tiers.length ? tiers : FALLBACK_TIERS;
  const safeBaseUrl = baseUrl || FALLBACK_BASE_URL;
  const defaultTier = safeTiers.find(t => t.isDefault) || safeTiers[0];
  const defaultAmount = defaultTier.amount;

  // Lookup table keyed by amount, falling back to the base link — same fallback semantics
  // as the original build, just one link per amount instead of a monthly/once pair.
  const linkByAmount = {};
  for (const t of safeTiers) linkByAmount[t.amount] = t.url || safeBaseUrl;

  const ladderRowsHtml = MINISTRY_LADDER.map(row => `
    <div class="ladder-row">
      <div class="ladder-amount">$${row.amount}<span class="ladder-period">/month</span></div>
      <div class="ladder-outcome">${row.outcome}</div>
    </div>`).join('');

  const leadershipRowsHtml = LEADERSHIP_TIERS.map(row => `
    <div class="leadership-row">
      <div class="leadership-left">
        <div class="leadership-amount">$${fmtAmount(row.amount)}<span class="leadership-period">/year</span></div>
        <div class="leadership-outcome">${row.outcome}</div>
      </div>
      <a class="leadership-cta" href="${safeBaseUrl}" target="_blank" rel="noopener">Give $${fmtAmount(row.amount)} →</a>
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

  /* ── Two-column band ── */
  .band-2col {
    display: grid;
    grid-template-columns: 1.05fr .95fr;
  }
  .photo-col {
    min-height: 520px;
    background: #22324f url('/images/IMG_6133.jpg') center/cover no-repeat;
    position: relative;
    display: flex; align-items: flex-end;
  }
  .photo-col::before {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(to bottom, rgba(17,30,50,.35), rgba(17,30,50,.88));
  }
  .photo-col-content { position: relative; padding: 44px 44px 40px; }
  .photo-col h1 {
    font-family: 'Lora', Georgia, serif;
    font-weight: 700; font-size: 56px; line-height: 1.05; color: #fff;
    text-wrap: balance;
  }

  .widget-col {
    background: #FBF8F3;
    padding: 38px 40px 36px;
    display: flex; flex-direction: column;
  }
  .widget-col .give-title { font-family: 'Lora', Georgia, serif; font-weight: 600; font-size: 27px; color: #1E2D4A; }
  .widget-col .tagline { font-family: 'Lora', Georgia, serif; font-style: italic; font-size: 15.5px; color: #2E7EA6; margin-top: 4px; }

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

  /* ── Ministry ladder ── */
  .ladder-section {
    background: #FBF8F3; padding: 48px 40px; border-top: 1px solid #DDE3ED;
  }
  .ladder-intro { max-width: 760px; margin: 0 auto 32px; text-align: center; }
  .ladder-eyebrow {
    font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
    color: #C9973A; margin-bottom: 10px;
  }
  .ladder-heading { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 30px; color: #1E2D4A; }
  .ladder-steps {
    margin-top: 20px; text-align: left; font-size: 15px; line-height: 1.7; color: #4A4860;
    display: flex; flex-direction: column; gap: 6px;
  }
  .ladder-steps b { color: #1E2D4A; }
  .ladder-table { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; }
  .ladder-row {
    display: grid; grid-template-columns: 140px 1fr; gap: 20px; align-items: baseline;
    padding: 16px 0; border-bottom: 1px solid #DDE3ED;
  }
  .ladder-row:last-child { border-bottom: none; }
  .ladder-amount { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 22px; color: #1E2D4A; }
  .ladder-period { font-family: 'Source Sans 3', sans-serif; font-weight: 400; font-size: 13px; color: #8C8880; }
  .ladder-outcome { font-size: 15px; line-height: 1.6; color: #4A4860; }

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
    .band-2col { grid-template-columns: 1fr; }
    .photo-col { min-height: 210px; }
    .photo-col h1 { font-size: 32px; }
    .values-band { grid-template-columns: 1fr 1fr; padding: 24px 20px 28px; }
    .amount-chips { gap: 8px; }
    .chip { font-size: 14px; padding: 11px 0; }
    .topbar { padding: 14px 20px; }
    .widget-col { padding: 28px 22px 26px; }
    .footer { padding: 22px 20px; text-align: center; justify-content: center; }
    .ladder-section, .leadership-section { padding: 36px 20px; }
    .ladder-row { grid-template-columns: 1fr; gap: 4px; }
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

  <div class="band-2col">
    <div class="photo-col">
      <div class="photo-col-content">
        <h1>Your Gift Continues His Work</h1>
      </div>
    </div>

    <div class="widget-col">
      <div class="give-title">Give to Timothy</div>
      <div class="tagline">From Our Neighborhood to the Nations</div>

      <div class="amount-label">Choose an amount</div>
      <div class="amount-chips" id="amount-chips" role="group" aria-label="Gift amount">
        ${safeTiers.map(t => `<div class="chip${t.amount===defaultAmount?' active':''}" tabindex="0" role="button" data-amount="${t.amount}" onclick="setAmount(${t.amount})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setAmount(${t.amount});}">$${t.amount}</div>`).join('')}
      </div>

      <div class="other-amount">
        <span class="dollar">$</span>
        <input type="number" min="1" step="1" id="other-amount-input" placeholder="Other amount" oninput="onOtherAmountInput(this)">
      </div>
      <div class="amount-error" id="amount-error">Please enter an amount of at least $1.</div>

      <a class="cta" id="give-cta" href="${safeBaseUrl}" target="_blank" rel="noopener">
        <span id="cta-label">Give $${defaultAmount}</span> <span aria-hidden="true">→</span>
      </a>

      <div class="trust-line">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4A5E3A" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/></svg>
        <span>Secure, encrypted giving through Tithe.ly. Receipt emailed instantly · tax-deductible · no account required.</span>
      </div>
    </div>
  </div>

  <div class="ladder-section">
    <div class="ladder-intro">
      <div class="ladder-eyebrow">What Your Generosity Makes Possible</div>
      <div class="ladder-heading">Every level is honorable.</div>
      <div class="ladder-steps">
        <div><b>1.</b> Start automated giving if you don't already.</div>
        <div><b>2.</b> Strengthen your recurring gift by increasing it to the next level.</div>
        <div><b>3.</b> Sustain the mission through leadership-level gifts that underwrite the ministries the whole congregation depends on.</div>
      </div>
    </div>
    <div class="ladder-table">${ladderRowsHtml}</div>
  </div>

  <div class="leadership-section">
    <div class="leadership-intro">
      <div class="leadership-eyebrow">Bigger Commitments. Bigger Impact.</div>
      <div class="leadership-heading">What your generosity becomes.</div>
      <div class="leadership-sub">A child hearing about Jesus. A family receiving hope. A teenager discovering lifelong faith. A teacher serving with confidence. A sanctuary filled with worship. A church whose doors stay open to the neighborhood.</div>
    </div>
    <div class="leadership-table">${leadershipRowsHtml}</div>
  </div>

  <div class="values-band">${valuesBandHtml}</div>

  <div class="footer">
    <div>Timothy Lutheran Church &middot; 6704 Fyler Ave, St. Louis, MO 63139</div>
    <div>Questions? <a href="mailto:office@timothystl.org">office@timothystl.org</a></div>
  </div>

<script>
  var BASE_URL = ${JSON.stringify(safeBaseUrl)};
  var LINK_BY_AMOUNT = ${JSON.stringify(linkByAmount)};
  var state = { amount: ${JSON.stringify(defaultAmount)} };

  function linkFor(amount) {
    return LINK_BY_AMOUNT[amount] || BASE_URL;
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

  function onOtherAmountInput(input) {
    var val = parseInt(input.value, 10);
    var errEl = document.getElementById('amount-error');
    if (!input.value) { errEl.classList.remove('show'); return; }
    if (!val || val < 1) { errEl.classList.add('show'); return; }
    errEl.classList.remove('show');
    // Clear chip selection — a custom amount has no pre-generated Tithe.ly link, so the
    // CTA falls back to the base (un-prefilled) giving form.
    state.amount = val;
    document.querySelectorAll('#amount-chips .chip').forEach(function(c) { c.classList.remove('active'); });
    document.getElementById('cta-label').textContent = 'Give $' + val;
    document.getElementById('give-cta').href = BASE_URL;
  }

  render();
</script>
</body>
</html>`;
}
