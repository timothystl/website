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
import { renderGiveDocument, FALLBACK_APPEARANCE, FALLBACK_DETAILS } from './give-landing.js';

// Same host chms's public API is served from — see that repo's connect-worker.js wrangler.toml
// route (connect.timothystl.org).
const CHMS_API_BASE = 'https://connect.timothystl.org/api/mockup/stax-giving';
const STAXJS_URL = 'https://staxjs.staxpayments.com/staxjs-captcha.js';

const css = `<style>
  .stx-banner {
    background: #3D2B00; color: #F5D98A; text-align: center; font-weight: 700; font-size: 13px;
    letter-spacing: .02em; padding: 12px 20px;
  }
  .stx-wrap { background: #FBF8F3; padding: 48px 20px 60px; display: flex; justify-content: center; }
  .stx-card {
    background: #fff; border: 1px solid #DDE3ED; border-radius: 14px; padding: 40px;
    max-width: 480px; width: 100%; box-shadow: 0 12px 28px -18px rgba(30,45,74,.4);
  }
  .stx-title { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 27px; color: #1E2D4A; text-align: center; }
  .stx-sub { font-family: 'Lora', Georgia, serif; font-style: italic; font-size: 14.5px; color: #2E7EA6; text-align: center; margin-top: 4px; margin-bottom: 28px; }
  .stx-msg { padding: 12px 14px; border-radius: 8px; margin-bottom: 16px; font-size: 13.5px; }
  .stx-msg.err { background: #FBEAE7; color: #A33B26; }
  .stx-msg.ok  { background: #E9F3E4; color: #3A6B2E; }
  .stx-field { margin-bottom: 18px; }
  .stx-field label {
    display: block; font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
    color: #6b6a5f; margin-bottom: 8px;
  }
  .stx-field select, .stx-field input {
    width: 100%; background: #fff; border: 1px solid #DDE3ED; border-radius: 9px;
    padding: 11px 14px; font-family: 'Source Sans 3', sans-serif; font-size: 15px; color: #1E2D4A;
  }
  .stx-field select:focus-visible, .stx-field input:focus-visible { outline: 2px solid #2E7EA6; outline-offset: 2px; }
  .stx-chips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
  .stx-chip {
    border-radius: 8px; font-size: 15px; font-weight: 700; text-align: center; padding: 11px 0;
    background: #fff; color: #1E2D4A; border: 1px solid #DDE3ED; cursor: pointer;
  }
  .stx-chip.active { background: #1E2D4A; color: #fff; border-color: #1E2D4A; }
  .stx-toggle-row { display: flex; gap: 8px; margin-bottom: 22px; }
  .stx-toggle {
    flex: 1; text-align: center; padding: 10px; border-radius: 8px; font-size: 13.5px; font-weight: 700;
    background: #fff; color: #1E2D4A; border: 1px solid #DDE3ED; cursor: pointer;
  }
  .stx-toggle.active { background: #2E7EA6; color: #fff; border-color: #2E7EA6; }
  .stx-wallets { display: flex; gap: 8px; margin-bottom: 14px; }
  .stx-wallet-mount { flex: 1; min-height: 44px; border-radius: 8px; overflow: hidden; }
  .stx-card-field { border: 1px solid #DDE3ED; border-radius: 9px; padding: 0 14px; margin-bottom: 14px; background: #fff; }
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
</style>`;

const body = `
<div class="stx-banner">MOCKUP — sandbox only, no real charges. The real Tithe.ly giving page above is unchanged.</div>
<div class="stx-wrap">
  <div class="stx-card">
    <div class="stx-title">Give</div>
    <div class="stx-sub">Timothy Lutheran Church &middot; Stax mockup</div>
    <div id="stxMsg"></div>
    <form id="stxForm">
      <div class="stx-field">
        <label for="stxFund">Fund</label>
        <select id="stxFund" required><option value="">Loading funds&hellip;</option></select>
      </div>
      <div class="stx-field">
        <label>Amount</label>
        <div class="stx-chips" id="stxChips"></div>
        <input id="stxAmount" type="number" min="1" step="0.01" placeholder="Other amount" required>
      </div>
      <div class="stx-toggle-row">
        <div class="stx-toggle active" data-freq="once">One-time</div>
        <div class="stx-toggle" data-freq="recurring">Recurring</div>
      </div>
      <div class="stx-field" id="stxIntervalField" hidden>
        <label for="stxInterval">Frequency</label>
        <select id="stxInterval"><option value="monthly">Monthly</option><option value="weekly">Weekly</option></select>
      </div>
      <div class="stx-field"><label for="stxName">Name</label><input id="stxName" type="text" required></div>
      <div class="stx-field"><label for="stxEmail">Email</label><input id="stxEmail" type="email" required></div>
      <div class="stx-field"><label for="stxPhone">Phone (optional)</label><input id="stxPhone" type="tel"></div>

      <div class="stx-wallets">
        <div class="stx-wallet-mount" id="stxApplePayMount"></div>
        <div class="stx-wallet-mount" id="stxGooglePayMount"></div>
      </div>
      <div class="stx-field" id="stxCardNumberField">
        <label>Card number</label>
        <div class="stx-card-field" id="stxCardNumber" style="height:40px;"></div>
      </div>
      <div class="stx-field" id="stxCardCvvField" style="max-width:140px;">
        <label>CVV</label>
        <div class="stx-card-field" id="stxCardCvv" style="height:40px;"></div>
      </div>

      <button class="stx-cta" id="stxPayBtn" type="submit">Give</button>
    </form>
    <div class="stx-fine">Apple Pay appears here automatically once this domain is registered with Stax.</div>
  </div>
</div>
<script>
(function(){
  var CHMS_API = '${CHMS_API_BASE}';
  var freq = 'once', configured = false, staxInstance = null;
  var chips = [25, 50, 100, 250];
  var chipsEl = document.getElementById('stxChips');
  chips.forEach(function(v){
    var el = document.createElement('div');
    el.className = 'stx-chip'; el.textContent = '$' + v;
    el.addEventListener('click', function(){
      document.getElementById('stxAmount').value = v;
      Array.prototype.forEach.call(chipsEl.children, function(c){ c.classList.remove('active'); });
      el.classList.add('active');
    });
    chipsEl.appendChild(el);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.stx-toggle'), function(t){
    t.addEventListener('click', function(){
      Array.prototype.forEach.call(document.querySelectorAll('.stx-toggle'), function(x){ x.classList.remove('active'); });
      t.classList.add('active');
      freq = t.dataset.freq;
      document.getElementById('stxIntervalField').hidden = (freq !== 'recurring');
    });
  });

  function showMsg(text, ok){
    document.getElementById('stxMsg').innerHTML = '<div class="stx-msg ' + (ok ? 'ok' : 'err') + '">' + text + '</div>';
  }

  fetch(CHMS_API + '/funds').then(function(r){ return r.json(); }).then(function(d){
    configured = !!d.configured;
    var sel = document.getElementById('stxFund');
    sel.innerHTML = '';
    (d.funds || []).forEach(function(f){
      var o = document.createElement('option'); o.value = f.id; o.textContent = f.name; sel.appendChild(o);
    });
    if (!configured) {
      var note = document.createElement('div');
      note.className = 'stx-demo-note';
      note.textContent = 'Demo mode: no live Stax sandbox key configured yet, so card fields are skipped and submitting records a simulated gift through the same matching/ledger path a real Stax webhook would use.';
      document.getElementById('stxForm').parentNode.insertBefore(note, document.getElementById('stxForm'));
      document.getElementById('stxCardNumberField').hidden = true;
      document.getElementById('stxCardCvvField').hidden = true;
      return;
    }
    var s = document.createElement('script');
    s.src = '${STAXJS_URL}';
    s.onload = function(){
      fetch(CHMS_API + '/webpayments-token').then(function(r){ return r.json(); }).then(function(t){
        if (!t.token || !window.StaxJs) return;
        staxInstance = new window.StaxJs(t.token, {
          number: { id: 'stxCardNumber', placeholder: '0000 0000 0000 0000', style: 'height:38px;width:100%;font-size:15px;border:none;outline:none;', type: 'text', format: 'prettyFormat' },
          cvv: { id: 'stxCardCvv', placeholder: 'CVV', style: 'height:38px;width:100%;font-size:15px;border:none;outline:none;', type: 'text' },
        });
        if (typeof staxInstance.showCardForm === 'function') staxInstance.showCardForm();
      });
    };
    document.head.appendChild(s);
  }).catch(function(){ showMsg('Could not load funds. Please try again.', false); });

  document.getElementById('stxForm').addEventListener('submit', function(e){
    e.preventDefault();
    var payBtn = document.getElementById('stxPayBtn');
    payBtn.disabled = true; payBtn.textContent = 'Processing\\u2026';
    var payload = {
      fund_id: document.getElementById('stxFund').value,
      amount: document.getElementById('stxAmount').value,
      payer_name: document.getElementById('stxName').value,
      payer_email: document.getElementById('stxEmail').value,
      payer_phone: document.getElementById('stxPhone').value,
    };

    function submit(pmId){
      var endpoint = CHMS_API + (freq === 'recurring' ? '/recurring' : '/checkout');
      if (freq === 'recurring') payload.interval = document.getElementById('stxInterval').value;
      if (pmId) payload.payment_method_id = pmId;
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, d: d }; }); })
        .then(function(res){
          payBtn.disabled = false; payBtn.textContent = 'Give';
          if (!res.ok) { showMsg(res.d.error || 'Something went wrong.', false); return; }
          showMsg(res.d.demo ? 'Simulated gift recorded (demo mode).' : 'Thank you \\u2014 your gift was recorded.', true);
          document.getElementById('stxForm').reset();
        }).catch(function(){ payBtn.disabled = false; payBtn.textContent = 'Give'; showMsg('Network error. Please try again.', false); });
    }

    if (configured && staxInstance && typeof staxInstance.tokenize === 'function') {
      staxInstance.tokenize({}).then(function(res){ submit(res && res.id); })
        .catch(function(){ payBtn.disabled = false; payBtn.textContent = 'Give'; showMsg('Could not read the card. Please check the number and try again.', false); });
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
