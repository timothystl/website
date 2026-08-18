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

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n2 = (v) => (Number(v) || 0).toFixed(2);
// An amount that is not there reads as a dash, not $0.00 — "no housing
// allowance" and "a housing allowance of nothing" are different claims.
const amt = (v) => (Number(v) > 0 ? money(v) : '-');
const opt = (v) => (Number(v) > 0 ? n2(v) : '');

function pad(s, w) {
  s = String(s == null ? '' : s);
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}
function padR(s, w) {
  s = String(s == null ? '' : s);
  return s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s;
}

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
// Plain monospace columns (see admin/pdf.js) — a printed ledger, not a
// styled page, which is what a bookkeeper's own reconciliation copy
// actually needs to be.
export function buildPayrollPdfLines(body) {
  const label = String(body.periodLabel || '').slice(0, 80);
  const mdoRows = Array.isArray(body.mdo?.rows) ? body.mdo.rows : [];
  const churchRows = Array.isArray(body.church?.rows) ? body.church.rows : [];
  const lines = [];

  lines.push({ text: 'Timothy Lutheran -- Combined Payroll', font: 'B', size: 14 });
  lines.push({ text: 'Pay Period: ' + label, size: 10 });
  lines.push({
    text: body.approved
      ? 'Approved' + (body.approvedBy ? ' by ' + String(body.approvedBy).slice(0, 60) : '') + '.'
      : 'Not yet approved -- these figures may still change.',
    size: 9, gap: 4,
  });
  if (body.incomplete) {
    lines.push({ text: 'INCOMPLETE: the childcare app could not be reached, so no MDO staff are in this report.', font: 'B', size: 9, gap: 2 });
  }

  if (mdoRows.length) {
    lines.push({ text: 'MDO STAFF', font: 'B', size: 10, gap: 12 });
    lines.push({ text: pad('Name', 22) + ' ' + pad('Type/Rate', 12) + ' ' + padR('Hours', 8) + ' ' + padR('PTO', 8) + ' ' + padR('Gross Pay', 12), font: 'B', size: 9 });
    mdoRows.forEach((p) => {
      lines.push({
        text: pad(p.name, 22) + ' '
          + pad(p.salaried ? 'Salary' : money(p.rate) + '/hr', 12) + ' '
          + padR(p.salaried ? '-' : n2(p.hours), 8) + ' '
          + padR(p.pto > 0 ? n2(p.pto) : '-', 8) + ' '
          + padR(money(p.gross), 12),
        size: 9,
      });
    });
    lines.push({ text: pad('MDO Subtotal', 43) + ' ' + padR(money(body.mdo?.subtotal), 12), font: 'B', size: 9, gap: 2 });
  }

  if (churchRows.length) {
    lines.push({ text: 'CHURCH STAFF', font: 'B', size: 10, gap: 12 });
    lines.push({
      text: pad('Name', 18) + ' ' + padR('Base/Earnings', 24) + ' ' + padR('Housing', 10) + ' '
        + padR('Ins Opt-Out', 11) + ' ' + padR('HSA', 8) + ' ' + padR('Mileage', 9) + ' '
        + padR('403(b)', 10) + ' ' + padR('Gross Pay', 12),
      font: 'B', size: 8,
    });
    churchRows.forEach((p) => {
      lines.push({
        text: pad(p.name, 18) + ' '
          + padR(p.salaried ? money(p.base) : hoursAtRate(p), 24) + ' '
          + padR(amt(p.housing), 10) + ' '
          + padR(amt(p.optOut), 11) + ' '
          + padR(amt(p.hsa), 8) + ' '
          + padR(amt(p.mileage), 9) + ' '
          + padR(p.b403 > 0 ? '-' + money(p.b403) : '-', 10) + ' '
          + padR(money(p.gross), 12),
        size: 8,
      });
    });
    lines.push({
      text: pad('Church Subtotal', 74) + ' ' + padR(money(body.church?.subtotal), 12),
      font: 'B', size: 8, gap: 2,
    });
  }

  lines.push({ text: 'TOTAL GROSS PAY: ' + money(body.total), font: 'B', size: 12, gap: 14 });
  lines.push({ text: 'Gross, before withholding. Taxes, withholding and bank details stay with the payroll service.', size: 8, gap: 2 });

  return lines;
}
