// Standalone giving landing page — served at give.timothystl.org (site-worker.js).
// This is NOT part of the public/index.html SPA and has no nav back into it by design:
// per Andrew, someone lands here from a bulletin/QR/text link, sees one thing, and gives.
//
// Built from the "Giving Landing" design handoff (option 4a — "Conversion patterns"),
// adapted in two ways from the literal spec: (1) the top nav's Visit/Worship/Learn links
// and the nav "Give" button are dropped — there's nowhere else on this page to send
// someone, and the whole page already is the give action; (2) the impact-figures block
// (real $ / meals-served / cents-per-dollar stats) is omitted entirely rather than
// shipping the design's placeholder numbers — add it back once real figures exist.
//
// ── Tithe.ly linking ────────────────────────────────────────────────────────────────
// The amount chips + Monthly/One-time toggle are real state (not decorative) and do
// change the CTA label, but Tithe.ly doesn't publish a safe-to-guess raw query-string
// spec for prefilling amount/frequency — their own "Create Custom Link" dashboard tool
// generates a complete URL per configuration instead. TITHELY_LINKS below is a lookup
// table ready to hold one generated link per (frequency, amount) combo; until Andrew
// generates and pastes in the real ones, every combo falls back to the base giving-form
// link so the CTA is always a real, working Tithe.ly page — just not amount-prefilled yet.
const TITHELY_BASE_URL = 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8';

const TITHELY_LINKS = {
  monthly: { 25: '', 40: '', 75: '', 150: '', 300: '', 500: '' },
  once:    { 25: '', 40: '', 75: '', 150: '', 300: '', 500: '' },
};

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

export const GIVE_LANDING_HTML = `<!DOCTYPE html>
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
    font-weight: 700; font-size: 62px; line-height: 1.02; color: #fff;
    text-wrap: balance;
  }

  .widget-col {
    background: #FBF8F3;
    padding: 38px 40px 36px;
    display: flex; flex-direction: column;
  }
  .widget-col .give-title { font-family: 'Lora', Georgia, serif; font-weight: 600; font-size: 27px; color: #1E2D4A; }
  .widget-col .tagline { font-family: 'Lora', Georgia, serif; font-style: italic; font-size: 15.5px; color: #2E7EA6; margin-top: 4px; }

  .freq-toggle {
    margin-top: 22px;
    background: #EDE7DC; border-radius: 9px; padding: 4px; display: flex; gap: 4px;
  }
  .freq-toggle button {
    flex: 1; border: none; background: transparent; border-radius: 7px;
    font-family: 'Source Sans 3', sans-serif; font-size: 14.5px; font-weight: 700;
    color: #6b6a5f; padding: 10px 0; cursor: pointer; transition: all .15s;
  }
  .freq-toggle button.active { background: #fff; color: #1E2D4A; box-shadow: 0 2px 8px -3px rgba(30,45,74,.35); }
  .freq-toggle button:focus-visible { outline: 2px solid #2E7EA6; outline-offset: 2px; }

  .recur-note { font-size: 12.5px; color: #6b6a5f; margin-top: 10px; }

  .amount-label {
    font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    color: #6b6a5f; margin-top: 24px; margin-bottom: 10px;
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
  }
  .footer a { color: #C9973A; font-weight: 600; }

  @media (max-width: 900px) {
    .band-2col { grid-template-columns: 1fr; }
    .photo-col { min-height: 210px; }
    .photo-col h1 { font-size: 34px; }
    .values-band { grid-template-columns: 1fr 1fr; padding: 24px 20px 28px; }
    .amount-chips { gap: 8px; }
    .chip { font-size: 14px; padding: 11px 0; }
    .topbar { padding: 14px 20px; }
    .widget-col { padding: 28px 22px 26px; }
    .footer { padding: 22px 20px; text-align: center; justify-content: center; }
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
        <h1>Your Gift Continues the Work</h1>
      </div>
    </div>

    <div class="widget-col">
      <div class="give-title">Give to Timothy</div>
      <div class="tagline">From Our Neighborhood to the Nations</div>

      <div class="freq-toggle" role="tablist" aria-label="Giving frequency">
        <button type="button" id="freq-monthly" class="active" role="tab" aria-selected="true" onclick="setFreq('monthly')">Monthly</button>
        <button type="button" id="freq-once" role="tab" aria-selected="false" onclick="setFreq('once')">One-time</button>
      </div>
      <div class="recur-note" id="recur-note">Recurring gifts can be changed or cancelled anytime.</div>

      <div class="amount-label">Choose an amount</div>
      <div class="amount-chips" id="amount-chips" role="group" aria-label="Gift amount">
        ${[25,40,75,150,300,500].map(a => `<div class="chip${a===40?' active':''}" tabindex="0" role="button" data-amount="${a}" onclick="setAmount(${a})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setAmount(${a});}">$${a}</div>`).join('')}
      </div>

      <div class="other-amount">
        <span class="dollar">$</span>
        <input type="number" min="1" step="1" id="other-amount-input" placeholder="Other amount" oninput="onOtherAmountInput(this)">
      </div>
      <div class="amount-error" id="amount-error">Please enter an amount of at least $1.</div>

      <a class="cta" id="give-cta" href="${TITHELY_BASE_URL}" target="_blank" rel="noopener">
        <span id="cta-label">Give $40 monthly</span> <span aria-hidden="true">→</span>
      </a>

      <div class="trust-line">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4A5E3A" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/></svg>
        <span>Secure, encrypted giving through Tithe.ly. Receipt emailed instantly · tax-deductible · no account required.</span>
      </div>
    </div>
  </div>

  <div class="values-band">${valuesBandHtml}</div>

  <div class="footer">
    <div>Timothy Lutheran Church &middot; 6704 Fyler Ave, St. Louis, MO 63139</div>
    <div>Questions? <a href="mailto:office@timothystl.org">office@timothystl.org</a></div>
  </div>

<script>
  var TITHELY_BASE_URL = ${JSON.stringify(TITHELY_BASE_URL)};
  var TITHELY_LINKS = ${JSON.stringify(TITHELY_LINKS)};
  var state = { freq: 'monthly', amount: 40 };

  function linkFor(freq, amount) {
    var byFreq = TITHELY_LINKS[freq] || {};
    return byFreq[amount] || TITHELY_BASE_URL;
  }

  function render() {
    document.getElementById('freq-monthly').classList.toggle('active', state.freq === 'monthly');
    document.getElementById('freq-monthly').setAttribute('aria-selected', state.freq === 'monthly');
    document.getElementById('freq-once').classList.toggle('active', state.freq === 'once');
    document.getElementById('freq-once').setAttribute('aria-selected', state.freq === 'once');
    document.getElementById('recur-note').style.display = state.freq === 'monthly' ? 'block' : 'none';

    var chips = document.querySelectorAll('#amount-chips .chip');
    chips.forEach(function(c) {
      var isActive = Number(c.getAttribute('data-amount')) === state.amount;
      c.classList.toggle('active', isActive);
    });

    var label = state.freq === 'monthly' ? ('Give $' + state.amount + ' monthly') : ('Give $' + state.amount);
    document.getElementById('cta-label').textContent = label;
    document.getElementById('give-cta').href = linkFor(state.freq, state.amount);
  }

  function setFreq(freq) {
    state.freq = freq;
    render();
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
    var label = state.freq === 'monthly' ? ('Give $' + val + ' monthly') : ('Give $' + val);
    document.getElementById('cta-label').textContent = label;
    document.getElementById('give-cta').href = TITHELY_BASE_URL;
  }

  render();
</script>
</body>
</html>`;
