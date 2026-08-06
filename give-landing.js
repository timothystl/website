// Standalone giving landing page — served at give.timothystl.org (site-worker.js).
//
// This file now does two jobs, and the difference between them matters:
//
//  1. `renderGiveDocument()` is the SHELL — the masthead, the footer and the
//     document around them. It is used whichever way the page's middle is
//     produced, so the chrome cannot differ between the two.
//  2. `renderGiveLandingHtml()` is the FALLBACK BODY — the whole page written
//     in code, exactly as it has been. It is what visitors get when the page
//     has not been published from the block editor yet, and when the admin
//     cannot be reached at all.
//
// ⚠ THE FALLBACK IS NOT DECORATION. This is the page that takes the money. If
// admin.timothystl.org is down, or a block render fails, or nobody has pressed
// Publish, somebody arriving from a bulletin insert still has to be able to
// give. That is why the amounts, the funds and the base link are all still
// hardcoded here as a last resort, and why site-worker.js drops from blocks to
// this body one step at a time rather than showing an error.
//
// ── Tithe.ly linking ────────────────────────────────────────────────────────
// The rule itself lives in give-link.js now — one definition, shared with
// admin/blocks.js so the block editor and this page can never disagree about
// what a gift of $25 costs. It used to be written out twice inside this file
// alone (once server-side, once as a client-side mirror).
//
// The base link (`give_url`) holds formId + locationId + fundId and NO amount;
// `withAmount()` appends `&amount=<cents>` on the fly. A tier's optional `url`
// is a full override for the rare case an amount should go somewhere else
// entirely.
//
// ── A note on what changed, and whose call it was ───────────────────────────
// This page used to have no way back into the site "by design: someone lands
// here from a bulletin/QR/text link, sees one thing, and gives." Andrew
// reversed that on 2026-08-05, asking for an editable header and footer and
// "at least a button that links back to the homepage". Recorded here rather
// than quietly overwritten, because the original reasoning was sound and a
// future session should know it was traded away deliberately, not forgotten.

import { withAmountAndFund, withAmount, fmtAmount, giftForPeriod, giveButtonLabel, GIVE_LINK_JS } from './give-link.js';

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

// The site as it stands, so an unreachable admin still produces the church's
// own masthead rather than an unstyled bar. These mirror DEFAULTS in
// admin/appearance.js resolved through publicAppearance() — the same values
// that screen starts from.
export const FALLBACK_APPEARANCE = {
  bar: '#4A5E3A', rule: '#C9973A', cta: '#C9973A', ink: '#FFFFFF', ctaInk: '#FFFFFF',
  logo: '/logo.png?v=20260328', logoShape: 'round',
  name: 'Timothy Lutheran Church', tagline: 'from our Neighborhood to the Nations',
};
export const FALLBACK_DETAILS = {
  address_line: '6704 Fyler Ave', address_city: 'St. Louis, MO 63139',
  phone: '', email: 'office@timothystl.org',
};

const HOME_URL = 'https://timothystl.org';

// Everything interpolated below is either staff-entered (the church name, the
// tagline, the address) or a palette value, so it is escaped on the way out.
// Short and local rather than imported: this module is loaded by site-worker.js,
// which must not pull in the admin's much larger block engine.
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
//
// ⚠ The amount here is the ANNUAL COMMITMENT; the button asks for a month of
// it (2026-08-06, Dinger: "no one is going to click to do a one time gift of
// 5000"). The arithmetic is giftForPeriod() in give-link.js, shared with the
// `amounts` block, so this fallback and the published page cannot come to
// different answers about what a $5,000/year row asks somebody to pay.
const LEADERSHIP_TIERS = [
  { amount: 5000,  outcome: 'Helps ensure every child hears about Jesus regardless of a family’s ability to pay.' },
  { amount: 9000,  outcome: 'Funds an entire year of music ministry that leads worship every Sunday.' },
  { amount: 10000, outcome: 'Keeps our campus warm throughout the winter so ministry never stops.' },
  { amount: 10000, outcome: 'Powers every classroom, office, sanctuary, and ministry space for a year.' },
  { amount: 18000, outcome: 'Provides health insurance for one member of our ministry staff, allowing them to care for people instead of worrying about their family’s healthcare.' },
];

// ── THE CHROME ───────────────────────────────────────────────────────────────
// The masthead reads the same `site_appearance` record the main site's header
// does, so the church changes its logo, name, tagline or bar colour once and
// this page follows. It deliberately carries NO navigation: the settled job of
// this page is one action, and a row of section links is a row of ways to
// leave before giving. What it does carry, as of 2026-08-05, is a way home —
// the masthead itself, and one plain link.

function chromeCss(a) {
  return `
  .gv-top{background:${esc(a.bar)};padding:14px 40px;display:flex;align-items:center;gap:14px;
    border-bottom:3px solid ${esc(a.rule)};}
  .gv-brand{display:flex;align-items:center;gap:12px;text-decoration:none;min-width:0;}
  .gv-logo{width:42px;height:42px;background:#fff;display:flex;align-items:center;justify-content:center;
    padding:4px;flex-shrink:0;}
  .gv-logo--round{border-radius:50%;}
  .gv-logo--square{border-radius:8px;}
  .gv-logo img{width:100%;height:100%;object-fit:contain;}
  .gv-names{display:flex;flex-direction:column;min-width:0;}
  .gv-name{font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${esc(a.ink)};}
  .gv-tag{font-family:'Lora',Georgia,serif;font-style:italic;font-size:12.5px;color:${esc(a.ink)};opacity:.82;}
  .gv-home{margin-left:auto;color:${esc(a.ink)};font-size:13.5px;font-weight:600;text-decoration:none;
    border:1px solid rgba(255,255,255,.45);border-radius:8px;padding:8px 14px;white-space:nowrap;}
  .gv-home:hover{background:rgba(255,255,255,.14);}
  .gv-home:focus-visible,.gv-brand:focus-visible{outline:2px solid #fff;outline-offset:2px;}

  .gv-foot{background:#111E32;padding:26px 40px;display:flex;justify-content:space-between;align-items:center;
    flex-wrap:wrap;gap:12px;color:rgba(255,255,255,.72);font-size:13.5px;border-top:1px solid rgba(255,255,255,.1);}
  .gv-foot a{color:#C9973A;font-weight:600;text-decoration:none;}
  .gv-foot a:hover{text-decoration:underline;}
  @media (max-width:900px){
    .gv-top{padding:12px 20px;gap:10px;}
    .gv-tag{display:none;}
    .gv-home{padding:8px 12px;font-size:12.5px;}
    .gv-foot{padding:22px 20px;justify-content:center;text-align:center;}
  }`;
}

function topbarHtml(a) {
  const shape = a.logoShape === 'square' ? 'square' : 'round';
  const logo = a.logo
    ? `<span class="gv-logo gv-logo--${shape}"><img src="${esc(a.logo)}" alt=""></span>`
    : '';
  const tag = a.tagline ? `<span class="gv-tag">${esc(a.tagline)}</span>` : '';
  // The masthead is itself the link home — the thing everybody already tries
  // first — and the button beside it is for everybody who does not know that.
  return `<header class="gv-top">
    <a class="gv-brand" href="${HOME_URL}">
      ${logo}
      <span class="gv-names"><span class="gv-name">${esc(a.name)}</span>${tag}</span>
    </a>
    <a class="gv-home" href="${HOME_URL}">Back to timothystl.org</a>
  </header>`;
}

function footerHtml(d) {
  const addr = [d.address_line, d.address_city].filter(Boolean).join(', ');
  const mail = d.email
    ? `Questions? <a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`
    : '';
  return `<footer class="gv-foot">
    <div>${esc([d.name, addr].filter(Boolean).join(' · ') || addr)}</div>
    <div>${mail}${mail ? ' &middot; ' : ''}<a href="${HOME_URL}">timothystl.org</a></div>
  </footer>`;
}

// The document around whatever produced the middle. `css` is whatever that
// middle needs — this page's own stylesheet on the fallback path, the block
// engine's on the published path.
export function renderGiveDocument({ body, css = '', appearance, details, title = 'Give — Timothy Lutheran Church' }) {
  const a = Object.assign({}, FALLBACK_APPEARANCE, appearance || {});
  const d = Object.assign({}, FALLBACK_DETAILS, details || {});
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Support the ministry of Timothy Lutheran Church — give securely online through Tithe.ly, one-time or monthly.">
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/images/favicon-32x32.png">
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Source+Sans+3:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Source Sans 3', Arial, sans-serif; color: #4A4860; background: #F7F3EC; }
  a { text-decoration: none; }
  ${chromeCss(a)}
</style>
${css}
</head>
<body>
${topbarHtml(a)}
${body}
${footerHtml(d)}
</body>
</html>`;
}

// The published-from-the-editor path. The blocks were rendered by the admin
// worker (which is where the block engine and the database are); this only has
// to put them in the shell.
export function renderGiveBlocksHtml(html, css, appearance, details) {
  return renderGiveDocument({ body: html, css: css || '', appearance, details });
}

// tiers: [{amount, url, isDefault}], baseUrl: string, funds: [{id, name, tithelyFundId, isDefault}]
export function renderGiveLandingHtml(tiers, baseUrl, funds, appearance, details) {
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

  const leadershipRowsHtml = LEADERSHIP_TIERS.map(row => {
    // The row states the annual commitment; the button asks for one month of
    // it. Same helper the `amounts` block uses, so the fallback and the
    // published page cannot disagree about the figure.
    const gift = giftForPeriod(row.amount, 'year');
    return `
    <div class="leadership-row">
      <div class="leadership-left">
        <div class="leadership-amount">$${fmtAmount(row.amount)}<span class="leadership-period">/year</span></div>
        <div class="leadership-outcome">${row.outcome}</div>
      </div>
      <a class="leadership-cta" href="${withAmount(safeBaseUrl, gift.amount)}" target="_blank" rel="noopener">${giveButtonLabel(gift)}</a>
    </div>`;
  }).join('');

  const css = `<style>
  /* ── Hero header (full-width) ── */
  .hero-header { background: #111E32; padding: 56px 40px; text-align: center; }
  .hero-header h1 {
    font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 48px; line-height: 1.1;
    color: #fff; text-wrap: balance; max-width: 820px; margin: 0 auto;
  }

  /* ── Give row: ministry ladder (left) + giving widget (right) ── */
  .give-row { display: grid; grid-template-columns: 1.15fr .85fr; background: #FBF8F3; }
  .ladder-col { padding: 48px 44px; border-right: 1px solid #DDE3ED; }
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
  .ladder-list-label {
    margin-top: 24px; font-size: 12px; font-weight: 800; letter-spacing: .1em;
    text-transform: uppercase; color: #1E2D4A; opacity: .85;
  }
  .ladder-list { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
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

  .widget-col { background: #FBF8F3; padding: 48px 40px; display: flex; flex-direction: column; }
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

  .trust-line { margin-top: 16px; display: flex; gap: 9px; font-size: 12.5px; line-height: 1.55; color: #6b6a5f; }
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
  .leadership-note {
    max-width: 780px; margin: 16px auto 0; text-align: center;
    font-size: 13px; line-height: 1.55; color: rgba(255,255,255,.7);
  }
  .leadership-note strong { color: #E8C070; }

  /* ── Other ways to give ── */
  .other-ways {
    background: #FBF8F3; border-top: 1px solid #DDE3ED; padding: 30px 40px 34px;
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 20px;
  }
  .ow-copy { max-width: 620px; }
  .ow-eyebrow { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #4A5E3A; }
  .ow-heading { font-family: 'Lora', Georgia, serif; font-weight: 700; font-size: 21px; color: #1A1A2A; margin-top: 5px; }
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

  @media (max-width: 900px) {
    .hero-header { padding: 40px 20px; }
    .hero-header h1 { font-size: 32px; }
    .give-row { grid-template-columns: 1fr; }
    /* On a phone the two columns stack in source order, which buries the actual giving widget
       under the whole ministry ladder — someone arriving to give has to scroll past the case
       for giving to reach the button. Put the widget first; the ladder then reads as the
       supporting argument below it, which is the right order on a small screen. The divider
       moves with it, so the line still falls between the two. */
    .widget-col { order: -1; border-bottom: 1px solid #DDE3ED; padding: 32px 22px; }
    .ladder-col { order: 0; border-right: none; padding: 32px 22px; }
    .values-band { grid-template-columns: 1fr 1fr; padding: 24px 20px 28px; }
    .other-ways { padding: 26px 20px 30px; }
    .ow-cta { width: 100%; text-align: center; }
    .amount-chips { gap: 8px; }
    .chip { font-size: 14px; padding: 11px 0; }
    .leadership-section { padding: 36px 20px; }
    .ladder-row { flex-direction: column; align-items: flex-start; }
    .ladder-cta { width: 100%; text-align: center; }
    .leadership-row { flex-direction: column; align-items: flex-start; }
    .leadership-cta { width: 100%; text-align: center; }
  }
</style>`;

  const body = `
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
      <!-- A label over the rows themselves. The heading above is an argument
           and the three steps under it are a paragraph; by the time the eye
           reaches the cards nothing has said what the list of them is. On the
           block version of this page this is an editable field on the block
           (2026-08-06) — here it is fixed, because this body is the fallback
           for when the admin cannot be reached. -->
      <div class="ladder-list-label">Weekly giving</div>
      <div class="ladder-list">${ladderRowsHtml}</div>
    </div>

    <div class="widget-col">
      <div class="give-title">Give to Timothy</div>
      <div class="tagline">From Our Neighborhood to the Nations</div>

      ${safeFunds.length > 1 ? `
      <div class="fund-label">Give to</div>
      <select class="fund-select" id="fund-select" onchange="setFund(this.value)">
        ${safeFunds.map(f => `<option value="${(f.tithelyFundId||'').replace(/"/g,'&quot;')}"${f.id===defaultFund.id?' selected':''}>${esc(f.name)}</option>`).join('')}
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
    <!-- ⚠ Tithe.ly cannot be told from a link that a gift recurs — that is why
         the frequency toggle came off this page in July. A button reading
         "Give $416/month" prefills one month and nothing else, so the one step
         it cannot take for somebody is said plainly rather than assumed. -->
    <p class="leadership-note">Each button opens the giving form with one month&rsquo;s amount already filled in &mdash; choose <strong>Monthly</strong> there to make it repeat.</p>
  </div>

  <div class="other-ways">
    <div class="ow-copy">
      <div class="ow-eyebrow">Other ways to give</div>
      <div class="ow-heading">Not every gift starts with a card.</div>
      <div class="ow-items">${otherWaysHtml}</div>
    </div>
    <a class="ow-cta" href="${HOME_URL}/give">See all the ways to give</a>
  </div>

  <div class="values-band">${valuesBandHtml}</div>

<script>
  ${GIVE_LINK_JS}
  var BASE_URL = ${JSON.stringify(safeBaseUrl)};
  var TIER_OVERRIDES = ${JSON.stringify(tierOverrideByAmount)};
  var state = { amount: ${JSON.stringify(defaultAmount)}, fundId: ${JSON.stringify(defaultFund.tithelyFundId || '')} };

  function linkFor(amount) {
    // A tier's own override link ignores the fund selector entirely — it's a full,
    // deliberate override (e.g. a different fund/form), not just an amount+fund combo.
    if (TIER_OVERRIDES[amount]) return TIER_OVERRIDES[amount];
    return tlcGiveLink(BASE_URL, amount, state.fundId);
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
    document.getElementById('give-cta').href = tlcGiveLink(BASE_URL, val, state.fundId);
  }

  render();
<\/script>`;

  return renderGiveDocument({ body, css, appearance, details });
}
