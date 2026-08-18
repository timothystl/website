// Node test harness for admin/payroll-report.js and admin/pdf.js.
//   node admin/payroll-report.test.mjs
//
// The Worker never sees a PDF library or a headless browser, so the PDF has
// to be structurally correct by construction — object offsets that really
// point at the object they claim to, a Root that really is a Catalog. That
// is checked directly against the bytes (xrefIntegrityOk), not trusted from
// "the file opened somewhere" — a corrupt-but-tolerated PDF is exactly the
// class of bug a lenient reader would hide.
import { buildPayrollCsv, buildPayrollPdfLines } from './payroll-report.js';
import { buildMonospacePdf } from './pdf.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const group = (n) => console.log('\n' + n);

// Verifies every non-free xref entry's byte offset lands exactly at the
// "N 0 obj" marker for object N. This is the same check that would catch a
// slipped offset from a length miscount anywhere upstream — a PDF reader
// that tolerates a wrong offset (many do, via a linear scan fallback) would
// hide the exact bug this exists to catch.
function xrefIntegrityOk(pdf) {
  const xrefIdx = pdf.indexOf('\nxref\n');
  const trailerIdx = pdf.indexOf('\ntrailer\n', xrefIdx);
  if (xrefIdx < 0 || trailerIdx < 0) return false;
  const lines = pdf.slice(xrefIdx + 1, trailerIdx).split('\n').filter(Boolean);
  const total = parseInt((lines[1] || '').split(' ')[1], 10);
  if (!Number.isFinite(total) || total < 2) return false;
  for (let i = 1; i < total; i++) {
    const entry = lines[2 + i];
    if (!entry) return false;
    const offset = parseInt(entry.slice(0, 10), 10);
    const expected = i + ' 0 obj';
    if (pdf.slice(offset, offset + expected.length) !== expected) return false;
  }
  return true;
}

// The body /payroll/email actually receives — the client's exportReport()
// posts exactly this shape.
const BODY = {
  periodStart: '2026-08-01', periodEnd: '2026-08-14',
  periodLabel: '8/1/2026 – 8/14/2026',
  approved: true, approvedBy: 'dinger',
  incomplete: false,
  total: 2196,
  mdo: {
    subtotal: 800,
    rows: [
      { name: 'Pat Rivera', salaried: false, rate: 20, hours: 40, pto: 0, gross: 800 },
    ],
  },
  church: {
    subtotal: 1396,
    rows: [
      { name: "Maria O'Brien", salaried: false, rate: 20, hours: 60, pto: 8, base: 1360,
        housing: 0, optOut: 0, hsa: 0, mileage: 0, b403: 136, gross: 1224 },
      { name: 'Andrew Dinger', salaried: true, rate: 0, hours: 0, pto: 0, base: 1908,
        housing: 1908, optOut: 0, hsa: 0, mileage: 150, b403: 0, gross: 172 },
    ],
  },
};

group('buildPayrollCsv matches the client\'s own shape');
{
  const csv = buildPayrollCsv(BODY);
  ok(csv.startsWith('"TLC Payroll - 8/1/2026'), 'title row leads with the period label');
  ok(csv.includes('"MDO Staff"'), 'has an MDO section header');
  ok(csv.includes('"Pat Rivera"'), 'MDO row carries the name');
  ok(csv.includes('"800.00"'), 'MDO gross is present, unquoted-number-as-text');
  ok(csv.includes('"Church Staff"'), 'has a Church section header');
  ok(csv.includes("\"Maria O'Brien\""), 'an apostrophe in a name survives (PY-1 class)');
  // 403(b) is written as a negative — the CSV formula guard must not eat
  // the leading minus the way it would eat a leading "=" (PY-5's own rule).
  ok(csv.includes('"-136.00"'), '403(b) keeps its negative sign, not formula-escaped away');
  ok(csv.includes('"TOTAL GROSS PAY"'), 'has the total row');
  ok(csv.includes('"2196.00"'), 'total figure is present');
  ok(!csv.includes('WARNING'), 'no incomplete warning when the run is complete');

  const incompleteCsv = buildPayrollCsv({ ...BODY, incomplete: true });
  ok(incompleteCsv.includes('WARNING: the childcare app'), 'an incomplete run says so in the CSV');

  // CSV-injection guard: a name starting with a formula trigger character
  // must come back prefixed, exactly as the client's own csvText() does.
  const injected = buildPayrollCsv({ ...BODY, church: { subtotal: 0, rows: [
    { name: '=cmd()', salaried: false, rate: 1, hours: 1, pto: 0, base: 1, housing: 0, optOut: 0, hsa: 0, mileage: 0, b403: 0, gross: 1 },
  ] } });
  ok(injected.includes("\"'=cmd()\""), 'a name starting with = is guarded against spreadsheet formula injection');
}

group('buildPayrollPdfLines feeds buildMonospacePdf a structurally valid PDF');
{
  const lines = buildPayrollPdfLines(BODY);
  const pdf = buildMonospacePdf(lines);
  ok(pdf.startsWith('%PDF-1.4'), 'starts with a PDF header');
  ok(xrefIntegrityOk(pdf), 'every xref offset points at its own object — verified against the bug below');
  ok(pdf.includes('Pat Rivera'), 'MDO row name is in the content stream');
  ok(pdf.includes("Maria O'Brien"), "an apostrophe in a name reaches the PDF text unescaped-as-a-parenthesis-break");
  ok(pdf.includes('Andrew Dinger'), 'the salaried church row is present');
  ok(pdf.includes('TOTAL GROSS PAY: $2,196.00'), 'the total line is present and formatted like money() elsewhere');
  ok(pdf.includes('Approved by dinger'), 'the approval state is stated, matching the emailed HTML');
  ok(!pdf.includes('INCOMPLETE'), 'no incomplete banner on a complete run');

  const incompletePdf = buildMonospacePdf(buildPayrollPdfLines({ ...BODY, incomplete: true }));
  ok(incompletePdf.includes('INCOMPLETE: the childcare app'), 'an incomplete run says so in the PDF too');

  // Verify the xref check is not vacuous: corrupt a real offset and confirm
  // it is caught, the same way it would catch a real length miscount.
  const corrupted = pdf.replace(/(\d{10}) 00000 n \n/, (m, off) => String(Number(off) + 5).padStart(10, '0') + ' 00000 n \n');
  ok(!xrefIntegrityOk(corrupted), 'the integrity check actually fails on a corrupted offset — not vacuous');
}

group('a very long roster spans multiple PDF pages, each still valid');
{
  const bigRows = Array.from({ length: 90 }, (_, i) => ({
    name: `Staffer ${i}`, salaried: false, rate: 15, hours: 20, pto: 0, gross: 300,
  }));
  const pdf = buildMonospacePdf(buildPayrollPdfLines({ ...BODY, mdo: { subtotal: 27000, rows: bigRows }, church: { subtotal: 0, rows: [] } }));
  ok(xrefIntegrityOk(pdf), 'a multi-page PDF still has correct object offsets');
  const pageCountMatch = pdf.match(/\/Count (\d+)/);
  ok(pageCountMatch && Number(pageCountMatch[1]) > 1, `90 rows overflow one page — got Count ${pageCountMatch && pageCountMatch[1]}`);
  ok(pdf.includes('Staffer 0') && pdf.includes('Staffer 89'), 'both the first and last row made it into the document');
}

group('non-ASCII text is substituted, not emitted raw — a corrupt content stream is worse than a "?"');
{
  const pdf = buildMonospacePdf(buildPayrollPdfLines({ ...BODY, mdo: { subtotal: 1, rows: [
    { name: 'José “Café” Müller', salaried: false, rate: 1, hours: 1, pto: 0, gross: 1 },
  ] }, church: { subtotal: 0, rows: [] } }));
  ok(xrefIntegrityOk(pdf), 'a name with accented/curly characters still produces a structurally valid PDF');
  ok(!/[^\x00-\x7F]/.test(pdf), 'no byte above ASCII 0x7E reached the file (WinAnsiEncoding-safe by construction)');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
