// ── Stax Giving MOCKUP — the public-facing half ─────────────────────────────
// See chms repo's docs/STAX_GIVING_MOCKUP.md for the full walkthrough (this file's own header
// only covers what's specific to living in the Website repo). This is a prototype, not a shipped
// feature: sandbox only, no real charges, and it never touches give.timothystl.org's real
// Tithe.ly page above/below it in site-worker.js.
//
// Served at give.timothystl.org/stax-mockup — Andrew's call: the real giving portal belongs on
// the main website domain, not connect.timothystl.org (which also sits behind Cloudflare Access
// at the edge — dashboard config, invisible to any repo, and the reason a first pass of this
// mockup 401'd for him there).
//
// This page is presentational ONLY. Every API call it makes is cross-origin to the chms repo's
// Worker (connect.timothystl.org/api/mockup/stax-giving/*), which is where the actual donor
// matching, ledger writes, and Stax calls happen — per the original scope memo's own reasoning,
// Connect already owns donor identity and giving records, so this page has no business
// duplicating that logic. See chms's src/stax-giving-mockup.js corsHeadersFor()/
// CORS_ALLOWED_ORIGINS for the allowlist that makes the cross-origin calls below work.
//
// v3: reworked to a two-column hero layout (per a reference design Andrew shared) and a two-step
// flow inside one <form> — Step 1 picks amount/fund(s)/frequency, Step 2 collects contact details
// and payment. Both steps render server-side and are toggled client-side (no page reload, no
// second network round trip until the real submit), so the API contract with chms is unchanged.
import { renderGiveDocument, FALLBACK_APPEARANCE, FALLBACK_DETAILS } from './give-landing.js';

// Same host chms's public API is served from — see that repo's connect-worker.js wrangler.toml
// route (connect.timothystl.org).
const CHMS_API_BASE = 'https://connect.timothystl.org/api/mockup/stax-giving';
const STAXJS_URL = 'https://staxjs.staxpayments.com/staxjs-captcha.js';

const css = `<style>
  .stx-banner {
    background: #3D2B00; color: #F5D98A; text-align: center; font-weight: 700; font-size: 13px;
    letter-spacing: .02em; padding: 9px 20px;
  }
  .stx-hero { background: #FBF8F3; padding: 44px 20px 72px; }
  .stx-hero-inner {
    max-width: 1080px; margin: 0 auto; display: flex; align-items: flex-start; gap: 56px;
  }
  .stx-hero-copy { flex: 1.1; min-width: 0; padding-top: 8px; }
  .stx-eyebrow {
    display: block; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
    color: #C9973A; margin-bottom: 14px;
  }
  .stx-headline {
    font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 38px; line-height: 1.18;
    color: #1E2D4A; margin: 0 0 18px;
  }
  .stx-hero-sub { font-size: 16px; line-height: 1.6; color: #3f3d36; max-width: 46ch; margin: 0 0 28px; }
  .stx-hero-photo {
    position: relative; border-radius: 14px; overflow: hidden; margin-bottom: 22px;
    padding-bottom: 62%; background: linear-gradient(135deg, #1E2D4A 0%, #2E7EA6 55%, #4A5E3A 100%);
    border: 1px dashed rgba(255,255,255,.35);
  }
  .stx-hero-photo span {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 20px; color: #FBF8F3; font-size: 12.5px; font-weight: 700;
    letter-spacing: .03em; text-transform: uppercase; background: rgba(17,30,50,.28);
  }
  .stx-other-ways {
    display: inline-block; font-family: 'Source Sans 3', sans-serif; font-weight: 700; font-size: 14.5px;
    color: #2E7EA6; text-decoration: none;
  }
  .stx-other-ways:hover { text-decoration: underline; }
  .stx-card {
    background: #fff; border: 1px solid #DDE3ED; border-radius: 14px; padding: 22px;
    max-width: 440px; width: 100%; flex-shrink: 0; box-shadow: 0 12px 28px -18px rgba(30,45,74,.4);
  }
  .stx-card-title { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 21px; color: #1E2D4A; margin-bottom: 12px; }
  .stx-back {
    background: none; border: none; color: #2E7EA6; font-family: 'Source Sans 3', sans-serif;
    font-weight: 700; font-size: 13px; cursor: pointer; padding: 0 0 18px; text-align: left;
  }
  .stx-back:hover { text-decoration: underline; }
  .stx-step-caption { font-size: 12.5px; color: #6b6a5f; text-align: center; margin-top: 12px; line-height: 1.5; }
  .stx-msg { padding: 12px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 13.5px; }
  .stx-msg.err { background: #FBEAE7; color: #A33B26; }
  .stx-msg.ok  { background: #E9F3E4; color: #3A6B2E; }
  .stx-err-detail { display: block; margin-top: 6px; font-size: 11.5px; font-family: ui-monospace, Menlo, monospace; opacity: .85; word-break: break-word; }
  .stx-section-label {
    display: block; font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    color: #4A5E3A; margin: 22px 0 10px;
  }
  .stx-section-label:first-of-type { margin-top: 0; }
  .stx-field { margin-bottom: 14px; }
  .stx-field label {
    display: block; font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    color: #6b6a5f; margin-bottom: 8px;
  }
  .stx-field select, .stx-field input {
    width: 100%; background: #fff; border: 1px solid #DDE3ED; border-radius: 9px;
    padding: 11px 14px; font-family: 'Source Sans 3', sans-serif; font-size: 15px; color: #1E2D4A;
  }
  .stx-field select:focus-visible, .stx-field input:focus-visible { outline: 2px solid #2E7EA6; outline-offset: 2px; }
  .stx-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .stx-row3 { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 10px; }
  /* [hidden] on its own loses to the class rules above (same CSS specificity, and these come
     later in the cascade) — without this, JS setting .hidden=true on a .stx-row2/.stx-row3
     element (like stxExpCvvRow in demo mode) would set the DOM property but the element would
     still render as a grid. */
  .stx-row2[hidden], .stx-row3[hidden] { display: none; }
  .stx-gift-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 10px; }
  .stx-gift-row .stx-field { flex: 1; margin-bottom: 0; }
  .stx-gift-remove {
    flex-shrink: 0; width: 40px; height: 42px; margin-top: 0; border-radius: 9px; border: 1px solid #DDE3ED;
    background: #fff; color: #A33B26; font-size: 18px; cursor: pointer; line-height: 1;
  }
  .stx-gift-remove:hover { background: #FBEAE7; }
  .stx-add-gift {
    background: none; border: none; color: #2E7EA6; font-family: 'Source Sans 3', sans-serif;
    font-weight: 700; font-size: 14px; cursor: pointer; padding: 4px 0 18px; text-align: left;
  }
  .stx-add-gift:hover { text-decoration: underline; }
  .stx-chips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
  .stx-chip {
    border-radius: 8px; font-size: 15px; font-weight: 700; text-align: center; padding: 11px 0;
    background: #fff; color: #1E2D4A; border: 1px solid #DDE3ED; cursor: pointer;
  }
  .stx-chip.active { background: #1E2D4A; color: #fff; border-color: #1E2D4A; }
  .stx-freq-row { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
  .stx-freq {
    flex: 1; min-width: 78px; text-align: center; padding: 10px 6px; border-radius: 8px;
    font-size: 12.5px; font-weight: 700; background: #fff; color: #1E2D4A; border: 1px solid #DDE3ED; cursor: pointer;
  }
  .stx-freq.active { background: #2E7EA6; color: #fff; border-color: #2E7EA6; }
  .stx-fees-row {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;
    background: #FBF8F3; border: 1px solid #DDE3ED; border-radius: 9px; padding: 12px 14px;
  }
  .stx-fees-label { font-size: 13.5px; color: #1E2D4A; }
  .stx-fees-amount { color: #6b6a5f; font-size: 12.5px; }
  .stx-yn { display: flex; gap: 4px; }
  .stx-yn button {
    padding: 7px 14px; border-radius: 7px; border: 1px solid #DDE3ED; background: #fff;
    color: #1E2D4A; font-family: 'Source Sans 3', sans-serif; font-weight: 700; font-size: 12.5px; cursor: pointer;
  }
  .stx-yn button.active { background: #2E7EA6; color: #fff; border-color: #2E7EA6; }
  .stx-wallets { display: flex; gap: 8px; margin-bottom: 14px; }
  .stx-wallet-mount { flex: 1; min-height: 44px; border-radius: 8px; overflow: hidden; }
  .stx-card-field { border: 1px solid #DDE3ED; border-radius: 9px; padding: 0 14px; margin-bottom: 14px; background: #fff; }
  .stx-exp-row { display: flex; gap: 8px; }
  .stx-exp-row select { width: auto; flex: 1; }
  .stx-cta {
    width: 100%; margin-top: 8px; background: #C9973A; color: #1E2D4A; font-size: 17px;
    font-weight: 800; padding: 16px; border: none; border-radius: 10px; cursor: pointer;
    font-family: 'Source Sans 3', sans-serif; box-shadow: 0 10px 24px -14px rgba(30,45,74,.5);
  }
  .stx-cta:hover { background: #E8C070; }
  .stx-cta:disabled { opacity: .6; cursor: wait; }
  .stx-demo-note {
    font-size: 12.5px; color: #6b6a5f; background: #FBF8F3; border: 1px dashed #DDE3ED;
    border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; line-height: 1.5;
  }
  .stx-fine { font-size: 12px; color: #8C8880; text-align: center; margin-top: 18px; line-height: 1.5; }
  /* Step 2 (contact + payment) packs a lot of fields into one card — tightened deliberately so it
     fits without scrolling on a normal screen, unlike step 1's more relaxed amount/fund spacing. */
  #stxStep2 .stx-back { padding-bottom: 4px; }
  #stxStep2 .stx-section-label { margin: 8px 0 4px; }
  #stxStep2 .stx-section-label:first-of-type { margin-top: 0; }
  #stxStep2 .stx-field { margin-bottom: 4px; }
  #stxStep2 .stx-field label { margin-bottom: 3px; }
  #stxStep2 .stx-field select, #stxStep2 .stx-field input { padding: 7px 12px; }
  #stxStep2 .stx-row2, #stxStep2 .stx-row3 { gap: 8px; }
  #stxStep2 .stx-card-field { margin-bottom: 6px; }
  #stxStep2 .stx-cta { margin-top: 2px; padding: 11px 16px; }
  @media (max-width: 860px) {
    .stx-hero-inner { flex-direction: column; gap: 36px; }
    .stx-card { max-width: 100%; }
    .stx-headline { font-size: 30px; }
  }
</style>`;

const body = `
<div class="stx-banner">MOCKUP — sandbox only, no real charges. The real Tithe.ly giving page above is unchanged.</div>
<div class="stx-hero">
  <div class="stx-hero-inner">
    <div class="stx-hero-copy">
      <span class="stx-eyebrow">Giving at Timothy &middot; Stax mockup</span>
      <h1 class="stx-headline">Your generosity helps ministry grow.</h1>
      <p class="stx-hero-sub">Every gift to Timothy Lutheran Church — large or small, one time or ongoing — helps us worship boldly, form disciples, and care for our neighbors in Christ's name. Thank you for giving.</p>
      <div class="stx-hero-photo" aria-hidden="true"><span>Illustrative photo &mdash; replace with Timothy photography</span></div>
      <a class="stx-other-ways" href="/">Other ways to give &rarr;</a>
    </div>
    <div class="stx-card">
      <div class="stx-card-title">Make a gift</div>
      <div id="stxMsg"></div>
      <form id="stxForm">
        <div id="stxStep1">
          <label class="stx-section-label">Amount</label>
          <div class="stx-chips" id="stxChips"></div>

          <div id="stxGifts"></div>
          <button type="button" class="stx-add-gift" id="stxAddGift">+ Add Another Gift</button>
          <div id="stxMemoStep1Anchor"></div>

          <label class="stx-section-label">How often</label>
          <div class="stx-freq-row" id="stxFreqRow"></div>

          <div class="stx-fees-row">
            <div>
              <div class="stx-fees-label">Cover the processing fee</div>
              <div class="stx-fees-amount" id="stxFeeAmount">consider giving an extra 2% to cover the processing fee</div>
            </div>
            <div class="stx-yn" id="stxFeeYn">
              <button type="button" data-val="0" class="active">No</button>
              <button type="button" data-val="1">Yes</button>
            </div>
          </div>

          <button class="stx-cta" id="stxContinueBtn" type="submit" formnovalidate>Continue</button>
          <div class="stx-step-caption">You'll enter your details and payment on the next step.</div>
        </div>

        <div id="stxStep2" hidden>
          <button type="button" class="stx-back" id="stxBackBtn">&larr; Back</button>
          <div id="stxMemoStep2Anchor"></div>
          <div class="stx-field" id="stxMemoField"><label for="stxMemo">Memo (optional)</label><input id="stxMemo" type="text" maxlength="500" placeholder="In memory of&hellip;"></div>

          <label class="stx-section-label">Contact details</label>
          <div class="stx-row2">
            <div class="stx-field"><label for="stxFirst">First name</label><input id="stxFirst" type="text" required></div>
            <div class="stx-field"><label for="stxLast">Last name</label><input id="stxLast" type="text" required></div>
          </div>
          <div class="stx-row2">
            <div class="stx-field"><label for="stxEmail">Email</label><input id="stxEmail" type="email" required></div>
            <div class="stx-field"><label for="stxPhone">Phone (optional)</label><input id="stxPhone" type="tel"></div>
          </div>
          <div class="stx-field"><label for="stxAddr" id="stxAddrLabel">Street address (optional)</label><input id="stxAddr" type="text"></div>
          <div class="stx-row3">
            <div class="stx-field"><label for="stxCity">City</label><input id="stxCity" type="text"></div>
            <div class="stx-field"><label for="stxState">State</label><input id="stxState" type="text" maxlength="2" style="text-transform:uppercase;"></div>
            <div class="stx-field"><label for="stxZip">ZIP</label><input id="stxZip" type="text" maxlength="10"></div>
          </div>

          <label class="stx-section-label">Payment</label>
          <div class="stx-wallets" hidden>
            <div class="stx-wallet-mount" id="stxApplePayMount"></div>
            <div class="stx-wallet-mount" id="stxGooglePayMount"></div>
          </div>
          <div class="stx-field" id="stxCardNumberField">
            <label>Card number</label>
            <div class="stx-card-field" id="stxCardNumber" style="height:40px;"></div>
          </div>
          <div class="stx-row2" id="stxExpCvvRow">
            <div class="stx-field">
              <label for="stxExpMonth">Expiration</label>
              <div class="stx-exp-row">
                <select id="stxExpMonth" aria-label="Expiration month" autocomplete="cc-exp-month" required>
                  <option value="">MM</option>
                  <option value="01">01</option><option value="02">02</option><option value="03">03</option>
                  <option value="04">04</option><option value="05">05</option><option value="06">06</option>
                  <option value="07">07</option><option value="08">08</option><option value="09">09</option>
                  <option value="10">10</option><option value="11">11</option><option value="12">12</option>
                </select>
                <select id="stxExpYear" aria-label="Expiration year" autocomplete="cc-exp-year" required><option value="">YYYY</option></select>
              </div>
            </div>
            <div class="stx-field" id="stxCardCvvField">
              <label>CVV</label>
              <div class="stx-card-field" id="stxCardCvv" style="height:40px;"></div>
            </div>
          </div>

          <button class="stx-cta" id="stxPayBtn" type="submit">Give</button>
        </div>
      </form>
      <div class="stx-fine" id="stxFine">Apple Pay appears here automatically once this domain is registered with Stax. First name, last name, and email are required so a gift can be matched to the right giving record; everything else is optional.</div>
    </div>
  </div>
</div>
<script>
(function(){
  var CHMS_API = '${CHMS_API_BASE}';
  var configured = false, staxInstance = null, webPaymentsToken = null;
  var funds = [];
  var gifts = [{ fundId: '', amount: '' }];
  var coverFees = false;
  var feeRate = 0.02; // overwritten by /funds — see its own comment in src (Andrew's flat estimate)
  var FREQS = [
    { key: '', label: 'One Time' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'biweekly', label: 'Bi-weekly' },
    { key: 'twice_monthly', label: '1st & 15th' },
    { key: 'monthly', label: 'Monthly' },
  ];
  var freq = '';
  var CHIP_AMOUNTS = [25, 50, 100, 250];
  var step = 1;

  function showMsg(text, ok){
    document.getElementById('stxMsg').innerHTML = '<div class="stx-msg ' + (ok ? 'ok' : 'err') + '">' + text + '</div>';
  }
  function clearMsg(){ document.getElementById('stxMsg').innerHTML = ''; }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  // Mockup-only: shows Stax.js's actual rejection reason inline instead of a purely generic
  // message, since this is the only diagnostic a phone tester (no DevTools console) can see.
  // Stax's fieldErrors describe which field failed validation (e.g. "address_1 is required"),
  // never card data itself, so surfacing them here is safe.
  function cardErrorMsg(errOrRes){
    var base = 'Could not read the card. Please check the expiration date and card number, and try again.';
    try {
      if (!errOrRes) return base;
      var parts = [];
      if (errOrRes.message) parts.push(String(errOrRes.message));
      if (Array.isArray(errOrRes.fieldErrors) && errOrRes.fieldErrors.length) {
        parts.push(errOrRes.fieldErrors.map(function(fe){
          var field = (fe && (fe.field || fe.name)) || '?';
          var detail = (fe && (fe.message || fe.error)) || JSON.stringify(fe);
          return field + ': ' + detail;
        }).join('; '));
      }
      if (!parts.length && errOrRes.code) parts.push(String(errOrRes.code));
      if (!parts.length) return base;
      return base + '<br><span class="stx-err-detail">' + esc(parts.join(' — ')) + '</span>';
    } catch (e) { return base; }
  }
  function subtotalCents(){
    return gifts.reduce(function(sum, g){ var n = Number(g.amount); return sum + (n > 0 ? Math.round(n * 100) : 0); }, 0);
  }
  function feeCents(){ return coverFees ? Math.round(subtotalCents() * feeRate) : 0; }
  function totalCents(){ return subtotalCents() + feeCents(); }
  function money(cents){ return '$' + (cents / 100).toFixed(2); }

  function renderChips(){
    var wrap = document.getElementById('stxChips');
    var current = Number(gifts[0] && gifts[0].amount);
    wrap.innerHTML = CHIP_AMOUNTS.map(function(a){
      return '<div class="stx-chip' + (current === a ? ' active' : '') + '" data-amt="' + a + '">$' + a + '</div>';
    }).join('');
    Array.prototype.forEach.call(wrap.children, function(el){
      el.addEventListener('click', function(){
        if (!gifts[0]) gifts[0] = { fundId: '', amount: '' };
        gifts[0].amount = el.dataset.amt;
        renderGifts(); renderChips(); updateTotal();
      });
    });
  }

  function renderFreqRow(){
    var row = document.getElementById('stxFreqRow');
    row.innerHTML = FREQS.map(function(f){
      return '<div class="stx-freq' + (f.key === freq ? ' active' : '') + '" data-key="' + f.key + '">' + f.label + '</div>';
    }).join('');
    Array.prototype.forEach.call(row.children, function(el){
      el.addEventListener('click', function(){ freq = el.dataset.key; renderFreqRow(); });
    });
  }

  // Month/year travel as plain fields, not inside Stax.js's hosted iframes — only card number
  // and CVV are Stax's own fields. Same split childcare-portal's live Stax integration uses (see
  // that repo's parent-billing.js pbPopulateStaxExpYearOnce/tokenize call), not a new pattern.
  function populateExpYearOnce(){
    var yearEl = document.getElementById('stxExpYear');
    if (!yearEl || yearEl.options.length > 1) return;
    var thisYear = new Date().getFullYear();
    for (var y = thisYear; y <= thisYear + 15; y++) {
      var opt = document.createElement('option');
      opt.value = String(y); opt.textContent = String(y);
      yearEl.appendChild(opt);
    }
  }

  // Stax.js's card number/CVV live inside its own cross-origin iframes, which our own form's
  // native reset() (see submit()'s success handler) never touches — a real bug reported live:
  // a donor's card number stayed visibly filled in on the page after a successful gift. Stax.js
  // has no documented cleanup/clear API (same finding childcare-portal's own integration already
  // made — see parent-billing.js's pbOpenStaxModal comment), so the proven fix there is the one
  // used here too: never try to clear the old instance, always mount a fresh one. Clearing the
  // mount divs' own innerHTML first guards against Stax.js finding old iframe content still
  // there when it re-mounts.
  function mountStaxCardFields(){
    if (!webPaymentsToken || !window.StaxJs) return;
    var numberEl = document.getElementById('stxCardNumber'), cvvEl = document.getElementById('stxCardCvv');
    if (numberEl) numberEl.innerHTML = '';
    if (cvvEl) cvvEl.innerHTML = '';
    staxInstance = new window.StaxJs(webPaymentsToken, {
      number: { id: 'stxCardNumber', placeholder: '0000 0000 0000 0000', style: 'height:38px;width:100%;font-size:15px;border:none;outline:none;', type: 'text', format: 'prettyFormat' },
      cvv: { id: 'stxCardCvv', placeholder: 'CVV', style: 'height:38px;width:100%;font-size:15px;border:none;outline:none;', type: 'text' },
    });
    if (typeof staxInstance.showCardForm === 'function') staxInstance.showCardForm();
  }

  function fundOptionsHtml(selected){
    var opts = '<option value="">Choose a fund&hellip;</option>';
    funds.forEach(function(f){ opts += '<option value="' + f.id + '"' + (String(f.id) === String(selected) ? ' selected' : '') + '>' + esc(f.name) + '</option>'; });
    return opts;
  }

  function renderGifts(){
    var wrap = document.getElementById('stxGifts');
    wrap.innerHTML = gifts.map(function(g, i){
      return '<div class="stx-gift-row" data-i="' + i + '">' +
        '<div class="stx-field"><select class="stx-gift-fund">' + fundOptionsHtml(g.fundId) + '</select></div>' +
        '<div class="stx-field" style="max-width:120px;"><input class="stx-gift-amount" type="number" min="1" step="0.01" placeholder="Amount" value="' + esc(g.amount) + '"></div>' +
        (gifts.length > 1 ? '<button type="button" class="stx-gift-remove" title="Remove this gift">&times;</button>' : '') +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('.stx-gift-row'), function(row){
      var i = Number(row.dataset.i);
      row.querySelector('.stx-gift-fund').addEventListener('change', function(e){ gifts[i].fundId = e.target.value; updateTotal(); });
      row.querySelector('.stx-gift-amount').addEventListener('input', function(e){ gifts[i].amount = e.target.value; renderChips(); updateTotal(); });
      var rm = row.querySelector('.stx-gift-remove');
      if (rm) rm.addEventListener('click', function(){ gifts.splice(i, 1); renderGifts(); renderChips(); updateTotal(); });
    });
  }

  function updateTotal(){
    document.getElementById('stxFeeAmount').textContent = coverFees
      ? 'gives ' + money(feeCents()) + ' extra to cover the fee'
      : 'consider giving an extra ' + Math.round(feeRate * 100) + '% to cover the processing fee';
    var t = totalCents();
    document.getElementById('stxContinueBtn').textContent = t > 0 ? ('Continue with ' + money(t)) : 'Continue';
    document.getElementById('stxPayBtn').textContent = t > 0 ? ('Give ' + money(t)) : 'Give';
    updateMemoPlacement();
  }

  // A fund named "Other" (staff can add one via the funds admin page, same opt-in curation as
  // every other fund) means the gift isn't self-explanatory the way "Building Fund" is — move
  // the memo field up to step 1 so a donor explains what it's for before they even reach
  // contact/payment, instead of it being one more thing tucked behind Continue.
  function isOtherFundSelected(){
    return gifts.some(function(g){
      var f = funds.filter(function(x){ return String(x.id) === String(g.fundId); })[0];
      return f && /\\bother\\b/i.test(f.name);
    });
  }
  function updateMemoPlacement(){
    var memoField = document.getElementById('stxMemoField');
    var anchor = document.getElementById(isOtherFundSelected() ? 'stxMemoStep1Anchor' : 'stxMemoStep2Anchor');
    anchor.parentNode.insertBefore(memoField, anchor.nextSibling);
  }

  function goToStep(n){
    step = n;
    document.getElementById('stxStep1').hidden = n !== 1;
    document.getElementById('stxStep2').hidden = n !== 2;
    clearMsg();
  }

  document.getElementById('stxAddGift').addEventListener('click', function(){
    gifts.push({ fundId: '', amount: '' });
    renderGifts();
    updateTotal();
  });
  document.getElementById('stxBackBtn').addEventListener('click', function(){ goToStep(1); });

  // Format phone as (555) 555-1234 while typing — the same shape chms's own normalizePhone()
  // produces server-side for donor matching (src/api-utils.js), so what's shown here already
  // matches what the ledger/review-queue will display, not just a cosmetic difference.
  document.getElementById('stxPhone').addEventListener('input', function(e){
    var digits = e.target.value.replace(/\\D/g, '').slice(0, 10);
    var formatted = digits;
    if (digits.length > 6) formatted = '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
    else if (digits.length > 3) formatted = '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
    else if (digits.length > 0) formatted = '(' + digits;
    e.target.value = formatted;
  });

  // State is a 2-letter postal abbreviation — force the stored value to uppercase as typed, not
  // just its on-screen appearance (the field's text-transform CSS only changes how it LOOKS;
  // without this, typing lowercase would still submit lowercase to chms).
  document.getElementById('stxState').addEventListener('input', function(e){
    var upper = e.target.value.toUpperCase();
    if (upper !== e.target.value) e.target.value = upper;
  });

  Array.prototype.forEach.call(document.querySelectorAll('#stxFeeYn button'), function(btn){
    btn.addEventListener('click', function(){
      coverFees = btn.dataset.val === '1';
      Array.prototype.forEach.call(document.querySelectorAll('#stxFeeYn button'), function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      updateTotal();
    });
  });

  renderChips();
  renderFreqRow();
  renderGifts();
  updateTotal();

  fetch(CHMS_API + '/funds').then(function(r){ return r.json(); }).then(function(d){
    configured = !!d.configured;
    funds = d.funds || [];
    if (typeof d.estimatedFeeRate === 'number') feeRate = d.estimatedFeeRate;
    // Default the first gift line to General Fund so a donor who only picks an amount chip still
    // has a valid gift to Continue with — one less required tap, and matches how most donors give.
    if (gifts[0] && !gifts[0].fundId) {
      var general = funds.filter(function(f){ return /general fund/i.test(f.name); })[0];
      if (general) gifts[0].fundId = String(general.id);
    }
    renderGifts();
    updateTotal();
    if (!configured) {
      var note = document.createElement('div');
      note.className = 'stx-demo-note';
      note.textContent = 'Demo mode: no live Stax sandbox key configured yet, so card fields are skipped and submitting records a simulated gift through the same matching/ledger path a real Stax webhook would use.';
      document.getElementById('stxForm').parentNode.insertBefore(note, document.getElementById('stxForm'));
      document.getElementById('stxCardNumberField').hidden = true;
      document.getElementById('stxExpCvvRow').hidden = true;
      // A required field inside a hidden container can still block native form validation on
      // submit in some browsers (the exact bug class that broke Continue — see that fix's
      // comment on stxContinueBtn) — clear required here so demo mode's Give button isn't hit
      // by the same thing.
      document.getElementById('stxExpMonth').required = false;
      document.getElementById('stxExpYear').required = false;
      return;
    }
    // Address fields (street/city/state/ZIP) stay genuinely optional here — Stax.js only
    // requires them for AVS when tokenize() has no customer_id (confirmed against Stax's own
    // field reference; see the tokenize() call's own comment), and the /stax-customer call made
    // right before tokenize() always gets one. No required/label overrides needed, matching
    // demo mode's already-optional markup exactly.
    populateExpYearOnce();
    var s = document.createElement('script');
    s.src = '${STAXJS_URL}';
    s.onload = function(){
      fetch(CHMS_API + '/webpayments-token').then(function(r){ return r.json(); }).then(function(t){
        if (!t.token) return;
        webPaymentsToken = t.token;
        mountStaxCardFields();
      });
    };
    document.head.appendChild(s);
  }).catch(function(){ showMsg('Could not load funds. Please try again.', false); });

  document.getElementById('stxForm').addEventListener('submit', function(e){
    e.preventDefault();
    var validGifts = gifts.filter(function(g){ return g.fundId && Number(g.amount) > 0; });

    if (step === 1) {
      if (!validGifts.length) { showMsg('Choose a fund and an amount for at least one gift.', false); return; }
      goToStep(2);
      return;
    }

    if (!validGifts.length) { goToStep(1); showMsg('Choose a fund and an amount for at least one gift.', false); return; }

    var payBtn = document.getElementById('stxPayBtn');
    var payBtnLabel = payBtn.textContent;
    payBtn.disabled = true; payBtn.textContent = 'Processing\\u2026';
    var payload = {
      gifts: validGifts.map(function(g){ return { fund_id: g.fundId, amount: g.amount }; }),
      cover_fees: coverFees,
      memo: document.getElementById('stxMemo').value,
      payer_first_name: document.getElementById('stxFirst').value,
      payer_last_name: document.getElementById('stxLast').value,
      payer_email: document.getElementById('stxEmail').value,
      payer_phone: document.getElementById('stxPhone').value,
      payer_address_line1: document.getElementById('stxAddr').value,
      payer_city: document.getElementById('stxCity').value,
      payer_state: document.getElementById('stxState').value,
      payer_zip: document.getElementById('stxZip').value,
    };

    function reset(){ payBtn.disabled = false; payBtn.textContent = payBtnLabel; }

    function submit(pmId){
      var endpoint = CHMS_API + (freq ? '/recurring' : '/checkout');
      if (freq) payload.interval = freq;
      if (pmId) payload.payment_method_id = pmId;
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
        .then(function(res){
          reset();
          if (!res.ok) { showMsg(res.d.error || 'Something went wrong.', false); return; }
          document.getElementById('stxForm').reset();
          gifts = [{ fundId: '', amount: '' }]; coverFees = false; freq = '';
          renderGifts(); renderChips(); renderFreqRow(); updateTotal(); goToStep(1);
          // The native form reset() above never touches Stax.js's own card-number/CVV iframes —
          // re-mount them fresh so a donor's card number doesn't stay visibly filled in after a
          // successful gift (real bug, reported live).
          if (configured) mountStaxCardFields();
          showMsg(res.d.demo ? 'Simulated gift recorded (demo mode).' : 'Thank you \\u2014 your gift was recorded.', true);
        }).catch(function(){ reset(); showMsg('Network error. Please try again.', false); });
    }

    if (configured && staxInstance && typeof staxInstance.tokenize === 'function') {
      // customer_id is what exempts tokenize() from Stax's own address/AVS requirement —
      // confirmed against Stax's own tokenize() field reference
      // (docs.staxpayments.com/docs/tokenize-a-card-on-your-website): address_1/address_city/
      // address_state are each documented as "Required if customer_id is not passed into
      // details". This is also the confirmed (not guessed) answer to why childcare-portal's own
      // Stax integration (parent-billing.js's pbStaxTokenizeAndCharge) never needs address
      // fields: every family gets one persistent Stax Customer, reused on every charge.
      // /stax-customer (chms) mirrors that here — reusing a matched donor's existing customer id
      // or creating a fresh one — so this call gets the same exemption, and address fields stay
      // genuinely optional, matching demo mode.
      //
      // match_customer deliberately NOT sent alongside customer_id — confirmed live: adding
      // customer_id (this same session) started a "Store not found" (404) rejection inside
      // tokenize() that never happened before. Stax's own docs say customer_id already skips
      // matching/creating a customer on its own ("a new customer will not be created or matched
      // based on values"), so match_customer should be redundant once customer_id is set;
      // dropping it is the cheapest test of whether it was routing tokenize() through a
      // different internal path this sandbox store isn't fully provisioned for. If "Store not
      // found" persists without it, the cause is elsewhere (Stax-side sandbox store
      // provisioning for customer-linked tokenization) and this mockup may need to fall back to
      // the address-required path, or Stax support may need to enable it for this store.
      fetch(CHMS_API + '/stax-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payer_first_name: document.getElementById('stxFirst').value,
          payer_last_name: document.getElementById('stxLast').value,
          payer_email: document.getElementById('stxEmail').value,
          payer_phone: document.getElementById('stxPhone').value,
        }),
      }).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
        .then(function(custRes){
          if (!custRes.ok || !custRes.d.customerId) { reset(); showMsg('Could not start payment. Please try again.', false); return; }
          // Rides through to chms's /checkout or /recurring below so it reuses this SAME Stax
          // customer at charge time instead of creating a second one.
          payload.stax_customer_id = custRes.d.customerId;
          // firstname/lastname/method/validate mirror childcare-portal's own live tokenize()
          // call (parent-billing.js's pbStaxTokenizeAndCharge) — Stax.js's sample only shows
          // month/year riding alongside the number/cvv iframes, but the proven production call
          // also always sends these; not including them is a likely reason a tokenize attempt
          // gets rejected.
          staxInstance.tokenize({
            firstname: document.getElementById('stxFirst').value,
            lastname: document.getElementById('stxLast').value,
            method: 'card',
            validate: true,
            month: document.getElementById('stxExpMonth').value,
            year: document.getElementById('stxExpYear').value,
            customer_id: custRes.d.customerId,
          }).then(function(res){
            // Stax.js can RESOLVE without a usable token instead of rejecting — checked
            // explicitly (matching childcare-portal's own paymentMethodId guard) rather than
            // passing a possibly-undefined id on to submit(), which chms would just reject
            // anyway but with a less specific error than this page can give directly.
            if (!res || !res.id) { reset(); showMsg(cardErrorMsg(res), false); return; }
            submit(res.id);
          }).catch(function(err){
            console.error('Stax.js tokenize() failed:', err);
            reset();
            showMsg(cardErrorMsg(err), false);
          });
        }).catch(function(){ reset(); showMsg('Network error. Please try again.', false); });
    } else {
      submit(null);
    }
  });
})();
</script>`;

export function renderGiveStaxMockupHtml() {
  return renderGiveDocument({
    body, css,
    appearance: FALLBACK_APPEARANCE,
    details: FALLBACK_DETAILS,
    title: 'Give (Stax mockup) — Timothy Lutheran Church',
    description: 'Prototype only, sandbox mode — not a live giving page. See give.timothystl.org for the real one.',
  });
}

// ── Apple Pay domain verification — noted, not activated ───────────────────
// Stax requires a domain-verification file hosted at exactly this well-known path on the domain
// registered for Apple Pay. This route intentionally does NOT serve fake verification content
// (only Stax/Apple can issue the real file) — it exists so visiting the URL shows exactly what's
// missing and confirms give.timothystl.org is where it would go once registered.
export function applePayDomainPlaceholderResponse() {
  return new Response(
    '# Apple Pay domain association placeholder (Stax Giving mockup)\n' +
    '#\n' +
    '# This file is not the real Apple/Stax verification content -- it cannot be, Stax issues it\n' +
    '# per registered domain. To activate Apple Pay on give.timothystl.org/stax-mockup:\n' +
    '#   1. Register give.timothystl.org in the Stax dashboard for Apple Pay.\n' +
    '#   2. Stax provides the actual verification file content.\n' +
    '#   3. Replace this placeholder response (see site-worker.js\'s route for this path) with\n' +
    '#      that content, served at exactly this path, with no redirect.\n',
    { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}
