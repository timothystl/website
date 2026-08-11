// The four values, as color. Run: node admin/values.test.mjs
//
// This file exists because of a bug that no per-file review would have caught:
// `values.js` was internally consistent, `ui.js` was internally consistent, and
// two of the four value tints were byte-identical to two of the five status
// tones. On Ministries those columns sit next to each other, so the same pale
// green meant "live" in one and "Acceptance" in the other.
//
// Every assertion below is about the RELATIONSHIP between the two palettes, so
// it lives in neither and reads both.

import assert from 'node:assert/strict';
import { VALUES, VALUE_KEYS, normalizeValue, valueByKey } from './values.js';
import { TONES, PALETTE } from './ui.js';

let pass = 0;
const test = (name, fn) => {
  try { fn(); pass++; } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

// ── color maths ─────────────────────────────────────────────
const chan = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
const rgb = (hex) => [1, 3, 5].map((i) => chan(hex, i));

const luminance = (hex) =>
  rgb(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((acc, c, i) => acc + [0.2126, 0.7152, 0.0722][i] * c, 0);

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Largest single-channel gap. Crude next to a perceptual metric, but it is the
// one a person can verify by eye against a color picker, which matters more
// here than precision — this test is read by whoever is about to change a hex.
const spread = (a, b) => Math.max(...[1, 3, 5].map((i) => Math.abs(chan(a, i) - chan(b, i))));

const HEX = /^#[0-9A-F]{6}$/;

// ── the shape ────────────────────────────────────────────────

test('four values, in the stored-key order the database uses', () => {
  assert.deepEqual(VALUE_KEYS, ['acceptance', 'worship', 'education', 'outreach']);
});

test('every value carries all three Foundations columns, uppercase hex', () => {
  for (const v of VALUES) {
    for (const col of ['tint', 'ink', 'solid']) {
      assert.match(v[col], HEX, `${v.key}.${col} is ${v[col]} — want uppercase #RRGGBB`);
    }
  }
});

// ── the rule this file exists for ────────────────────────────

test('no value tint collides with a status tone background', () => {
  const tones = Object.entries(TONES);
  for (const v of VALUES) {
    for (const [name, tone] of tones) {
      assert.notEqual(
        v.tint.toUpperCase(),
        tone.bg.toUpperCase(),
        `value "${v.name}" tint ${v.tint} is the "${name}" status tone. ` +
          'A chip meaning "tagged X" must not be the same fill as a pill meaning ' +
          '"the row is in state Y" — they appear in adjacent columns.',
      );
    }
  }
});

test('no value tint collides with the selected-filter-chip fill', () => {
  // A selected filter chip is #E7EEF7. A value chip sitting on that exact fill
  // reads as already-selected on a screen where filters and values are both
  // chips — which Ministries, News and Christian Ed all are.
  for (const v of VALUES) {
    assert.notEqual(v.tint.toUpperCase(), '#E7EEF7', `${v.name} tint is the chip-on fill`);
  }
});

test('a value tint is more saturated than every status tone', () => {
  // The rule, stated as a test: status is pale, a value is not. This is what
  // keeps the two readable apart when a future tone lands on a nearby hue,
  // and it is why the fix was a rule rather than four replacement hexes.
  const chroma = (hex) => { const c = rgb(hex); return Math.max(...c) - Math.min(...c); };
  const palest = Math.max(...Object.values(TONES).map((t) => chroma(t.bg)));
  for (const v of VALUES) {
    assert.ok(
      chroma(v.tint) > palest,
      `${v.name} tint ${v.tint} (chroma ${chroma(v.tint)}) is no more saturated than ` +
        `the most saturated status tone (${palest}). Values must read as richer than states.`,
    );
  }
});

test('the four tints are at least 20 apart from each other', () => {
  for (let i = 0; i < VALUES.length; i++) {
    for (let j = i + 1; j < VALUES.length; j++) {
      const d = spread(VALUES[i].tint, VALUES[j].tint);
      assert.ok(
        d >= 20,
        `${VALUES[i].name} and ${VALUES[j].name} tints are only ${d} apart. ` +
          'Four chips in one column have to be told apart at a glance.',
      );
    }
  }
});

// ── legibility ───────────────────────────────────────────────

test('ink on tint clears 4.5:1', () => {
  for (const v of VALUES) {
    const r = contrast(v.tint, v.ink);
    assert.ok(r >= 4.5, `${v.name}: ink ${v.ink} on tint ${v.tint} is ${r.toFixed(2)}:1`);
  }
});

test('solid is dark enough to read as a border against its own tint', () => {
  // `solid` is the 2px border a selected chip takes. It does not carry text, so
  // it needs to be visible rather than legible — 3:1, the non-text threshold.
  for (const v of VALUES) {
    const r = contrast(v.tint, v.solid);
    assert.ok(r >= 3, `${v.name}: solid ${v.solid} on tint ${v.tint} is only ${r.toFixed(2)}:1`);
  }
});

test('ink on the card surface stays legible too', () => {
  // A value's name is also printed on an ordinary card, not only inside a chip.
  for (const v of VALUES) {
    const r = contrast(PALETTE.card, v.ink);
    assert.ok(r >= 4.5, `${v.name}: ink ${v.ink} on card ${PALETTE.card} is ${r.toFixed(2)}:1`);
  }
});

// ── the lookups the write paths depend on ────────────────────

test('normalizeValue passes a stored key through unchanged', () => {
  for (const k of VALUE_KEYS) assert.equal(normalizeValue(k), k);
});

test('normalizeValue resolves a display label back to its stored key', () => {
  // Deliberate, and the reason the function exists: the chip says "Welcome"
  // and the column holds 'acceptance'. A form posting the label it rendered
  // must not write a value no reader recognizes.
  assert.equal(normalizeValue('Welcome'), 'acceptance');
  assert.equal(normalizeValue('GROW'), 'education');
  assert.equal(normalizeValue('Christian Education'), 'education');
  assert.equal(normalizeValue('  Outreach  '), 'outreach');
});

test('normalizeValue refuses anything that is not one of the four', () => {
  for (const junk of ['', null, undefined, 0, 'outreach2', 'welcoming', 'grow ing']) {
    assert.equal(normalizeValue(junk), null, `normalizeValue(${JSON.stringify(junk)})`);
  }
});

test('valueBy finds a value by its stored key', () => {
  assert.equal(valueByKey('outreach').short, 'Go');
  assert.equal(valueByKey('nope'), null);
});

console.log(`values.test.mjs: ${pass} passed`);
