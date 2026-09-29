// ── THE EMAILED PAYROLL REPORT — CSV + PDF, FROM ONE SET OF FIGURES ──
// admin/payroll.html's own exportReport() posts the same shape to
// /payroll/email that its screen, its CSV download and its printed page
// all read from — mdo.rows / church.rows / the two subtotals / the total.
// These two builders read that identical body so the emailed attachments
// cannot become a third shape that quietly disagrees with what's on
// screen or on paper (the same reasoning the v4.30.0 payroll-export
// rebuild states for the HTML email body itself).
//
// ⚠ Money, hours and a "no value" dash all have to be formatted exactly
// the way the client's own exportReport()/renderPrintTable() do, or the
// numbers a bookkeeper reconciles against would silently disagree between
// what she sees on screen and what lands in her inbox.

import { MARGIN, PAGE_W, fitText } from './pdf.js';

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n2 = (v) => (Number(v) || 0).toFixed(2);
// An amount that is not there reads as a dash, not $0.00 — "no housing
// allowance" and "a housing allowance of nothing" are different claims.
const amt = (v) => (Number(v) > 0 ? money(v) : '-');
const opt = (v) => (Number(v) > 0 ? n2(v) : '');


// The church table has no PTO column — it never has — so an hourly
// person's PTO is named inside the Base / Earnings cell, matching the
// print table's hoursAtRate() exactly (PY-2: the cell otherwise would not
// reconcile to the Gross Pay beside it).
function hoursAtRate(p) {
  const pto = Number(p.pto) || 0;
  return n2(p.hours) + (pto > 0 ? '+' + n2(pto) + 'pto' : '') + '@' + n2(p.rate);
}

// ── CSV ──────────────────────────────────────────────────────
function csvCell(v) {
  const s = String(v == null ? '' : v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + guarded.replace(/"/g, '""') + '"';
}
function csvNumCell(v) {
  return '"' + String(v === null || v === undefined ? '' : v) + '"';
}

export function buildPayrollCsv(body) {
  const label = String(body.periodLabel || '').slice(0, 80);
  const mdoRows = Array.isArray(body.mdo?.rows) ? body.mdo.rows : [];
  const churchRows = Array.isArray(body.church?.rows) ? body.church.rows : [];
  const rows = [[csvCell('TLC Payroll - ' + label)], []];

  if (mdoRows.length) {
    rows.push([csvCell('MDO Staff'), csvCell('Type'), csvCell('Rate'), csvCell('Hours'), csvCell('PTO Hours'), csvCell('Gross Pay')]);
    mdoRows.forEach((p) => {
      rows.push([
        csvCell(p.name),
        csvCell(p.salaried ? 'Salary' : 'Hourly'),
        csvNumCell(p.salaried ? '' : n2(p.rate)),
        csvNumCell(p.salaried ? '' : n2(p.hours)),
        csvNumCell(opt(p.pto)),
        csvNumCell(n2(p.gross)),
      ]);
    });
    rows.push([csvCell('MDO Subtotal'), '', '', '', '', csvNumCell(n2(body.mdo?.subtotal))]);
    rows.push([]);
  }

  if (churchRows.length) {
    rows.push([csvCell('Church Staff'), csvCell('Type'), csvCell('Base/Earnings'), csvCell('Housing'),
      csvCell('Ins Opt-Out'), csvCell('HSA'), csvCell('Mileage'), csvCell('403(b)'), csvCell('Gross Pay')]);
    churchRows.forEach((p) => {
      rows.push([
        csvCell(p.name),
        csvCell(p.salaried ? 'Salary' : 'Hourly'),
        csvNumCell(p.salaried ? n2(p.base) : hoursAtRate(p)),
        csvNumCell(opt(p.housing)),
        csvNumCell(opt(p.optOut)),
        csvNumCell(opt(p.hsa)),
        csvNumCell(opt(p.mileage)),
        csvNumCell(p.b403 > 0 ? '-' + n2(p.b403) : ''),
        csvNumCell(n2(p.gross)),
      ]);
    });
    rows.push([csvCell('Church Subtotal'), '', '', '', '', '', '', '', csvNumCell(n2(body.church?.subtotal))]);
    rows.push([]);
  }

  rows.push([csvCell('TOTAL GROSS PAY'), '', '', '', '', '', '', '', csvNumCell(n2(body.total))]);
  if (body.incomplete) rows.push([csvCell('WARNING: the childcare app could not be read, so MDO staff are missing from this export.')]);

  return rows.map((r) => r.join(',')).join('\r\n');
}

// ── PDF ──────────────────────────────────────────────────────
// Set in the Finance app's type (Figtree for the table, Outfit for the
// masthead, section heads and totals — see admin/pdf.js) over the site's own
// navy/gold/cream palette (see Design System → Colors in CLAUDE.md). The
// columns are placed by x position: text columns start at their x, number
// columns end at theirs, so figures line up on the right the way a
// bookkeeper reconciles them by eye. Every color used here is one already
// in use elsewhere on the site; nothing new was invented.

const NAVY = [0.118, 0.176, 0.290]; // #1E2D4A
const GOLD = [0.788, 0.596, 0.227]; // #C9973A
const CREAM = [0.969, 0.953, 0.925]; // #F7F3EC
const LINEN = [0.929, 0.914, 0.878]; // #EDE9E0 — the zebra tint, one shade darker than cream
const WHITE = [1, 1, 1];
const GOOD_INK = [0.247, 0.329, 0.145]; // TONES.good.ink #3F5424
const WAITING_INK = [0.478, 0.357, 0.094]; // TONES.warn.ink #7A5B18
const PROBLEM_INK = [0.549, 0.227, 0.157]; // TONES.problem.ink #8C3A28
const GRAY_TEXT = [0.29, 0.28, 0.38]; // close to --text-secondary #4A4860

const RIGHT = PAGE_W - MARGIN;
const L = (text, x) => ({ text, x, align: 'left' });
const R = (text, x) => ({ text, x, align: 'right' });

// MDO table, 9pt: Name | Type/Rate | Hours | PTO | Gross Pay
const MDO_NAME_W = 200;
const MDO_TYPE_X = MARGIN + 210;
const MDO_HOURS_X = 400, MDO_PTO_X = 470;
// Church table, 8pt: Name | Base/Earnings | Housing | Ins Opt-Out | HSA | Mileage | 403(b) | Gross Pay
const CH_NAME_W = 118;
const CH_X = { base: 262, housing: 318, optOut: 374, hsa: 420, mileage: 470, b403: 522 };

export function buildPayrollPdfLines(body) {
  const label = String(body.periodLabel || '').slice(0, 80);
  const mdoRows = Array.isArray(body.mdo?.rows) ? body.mdo.rows : [];
  const churchRows = Array.isArray(body.church?.rows) ? body.church.rows : [];
  const lines = [];

  // The masthead — one solid navy band, three lines deep, so the report
  // reads as the church's own the moment it's opened rather than as a
  // plain text dump. Church name, section title, then the period, in that
  // order — the same lead a printed bulletin would use.
  lines.push({ text: 'Timothy Lutheran Church', font: 'H', size: 17, bg: NAVY, color: WHITE });
  lines.push({ text: 'Combined Payroll', font: 'H', size: 12, bg: NAVY, color: GOLD, gap: 2 });
  lines.push({ text: 'Pay Period: ' + label, size: 10, bg: NAVY, color: WHITE, gap: 3 });

  lines.push({
    text: body.approved
      ? 'Approved' + (body.approvedBy ? ' by ' + String(body.approvedBy).slice(0, 60) : '') + '.'
      : 'Not yet approved -- these figures may still change.',
    size: 9, color: body.approved ? GOOD_INK : WAITING_INK, gap: 8,
  });
  if (body.incomplete) {
    lines.push({ text: 'INCOMPLETE: the childcare app could not be reached, so no MDO staff are in this report.', font: 'B', size: 9, color: PROBLEM_INK, gap: 2 });
  }

  if (mdoRows.length) {
    lines.push({ text: 'MDO STAFF', font: 'H', size: 10, color: NAVY, bg: CREAM, gap: 12 });
    lines.push({
      cells: [L('Name', MARGIN), L('Type/Rate', MDO_TYPE_X), R('Hours', MDO_HOURS_X), R('PTO', MDO_PTO_X), R('Gross Pay', RIGHT)],
      font: 'B', size: 9, rule: NAVY, color: NAVY,
    });
    mdoRows.forEach((p, i) => {
      lines.push({
        cells: [
          L(fitText(p.name, 'R', 9, MDO_NAME_W), MARGIN),
          L(p.salaried ? 'Salary' : money(p.rate) + '/hr', MDO_TYPE_X),
          R(p.salaried ? '-' : n2(p.hours), MDO_HOURS_X),
          R(p.pto > 0 ? n2(p.pto) : '-', MDO_PTO_X),
          R(money(p.gross), RIGHT),
        ],
        size: 9, bg: i % 2 ? LINEN : null,
      });
    });
    lines.push({
      cells: [L('MDO Subtotal', MARGIN), R(money(body.mdo?.subtotal), RIGHT)],
      font: 'H', size: 9, color: NAVY, bg: CREAM, gap: 2,
    });
  }

  if (churchRows.length) {
    lines.push({ text: 'CHURCH STAFF', font: 'H', size: 10, color: NAVY, bg: CREAM, gap: 12 });
    lines.push({
      cells: [
        L('Name', MARGIN), R('Base/Earnings', CH_X.base), R('Housing', CH_X.housing), R('Ins Opt-Out', CH_X.optOut),
        R('HSA', CH_X.hsa), R('Mileage', CH_X.mileage), R('403(b)', CH_X.b403), R('Gross Pay', RIGHT),
      ],
      font: 'B', size: 8, rule: NAVY, color: NAVY,
    });
    churchRows.forEach((p, i) => {
      lines.push({
        cells: [
          L(fitText(p.name, 'R', 8, CH_NAME_W), MARGIN),
          R(p.salaried ? money(p.base) : hoursAtRate(p), CH_X.base),
          R(amt(p.housing), CH_X.housing),
          R(amt(p.optOut), CH_X.optOut),
          R(amt(p.hsa), CH_X.hsa),
          R(amt(p.mileage), CH_X.mileage),
          R(p.b403 > 0 ? '-' + money(p.b403) : '-', CH_X.b403),
          R(money(p.gross), RIGHT),
        ],
        size: 8, bg: i % 2 ? LINEN : null,
      });
    });
    lines.push({
      cells: [L('Church Subtotal', MARGIN), R(money(body.church?.subtotal), RIGHT)],
      font: 'H', size: 8, color: NAVY, bg: CREAM, gap: 2,
    });
  }

  lines.push({ text: 'TOTAL GROSS PAY: ' + money(body.total), font: 'H', size: 13, color: GOLD, bg: NAVY, gap: 14 });
  lines.push({ text: 'Gross, before withholding. Taxes, withholding and bank details stay with the payroll service.', size: 8, color: GRAY_TEXT, gap: 4 });

  return lines;
}
