// ── THE FOUR CORE VALUES ─────────────────────────────────────
// One record per value, used by Ministries, News & Events, Christian Ed,
// Partners, the Dashboard's "Our Four Values" cards, and the public /values
// page. This is the only place the pairing lives — the short name in the chip
// ("Welcome") and the church's own stated value ("Acceptance") are two labels
// for one thing, and every screen that shows both reads them from here.
//
// The stored key is the third column: 'acceptance' | 'worship' | 'education'
// | 'outreach'. Those are what land in the `value` column on youth_pages,
// news_items, bible_classes and partners, so renaming a display label never
// touches the database.

// tint / ink / solid are the Foundations spec's own three columns. `solid` is
// the 2px border a chip takes when it is the selected filter — without it a
// selected chip has to change its fill, which reads as a different value
// rather than the same one, chosen.

// ⚠ A VALUE IS NOT A STATUS, AND MUST NOT LOOK LIKE ONE.
//
// These four used to borrow their tints from the status tones: Acceptance was
// #EDF0E4, the same pale green as `good`, and Outreach was #FAF0DC, the same
// pale amber as `warn`. On Ministries those columns sit side by side, so one
// green chip meant "this page is live" and the chip beside it meant "tagged
// Acceptance" — identical fills, unrelated meanings. Nothing warned about it
// because each palette was correct on its own; only together were they wrong.
//
// The fix is a rule rather than four new hexes, because a rule survives
// somebody adding a sixth status tone: **a status tone is pale and low-chroma,
// a value tint is saturated.** Status is a state the row is passing through;
// a value is what the row *is*. Separating the two categories by chroma means
// they stay distinguishable even where the hues are neighbors, and it cannot
// be undone by a later tone landing on a hue a value already uses.
//
// The hues are the church's own (moss, navy, teal, plum — see the design
// system in CLAUDE.md), spaced so no two tints are within 20 of each other on
// any channel. `values.test.mjs` asserts the separation, the non-collision and
// 4.5:1 ink-on-tint, so this cannot quietly drift back.
export const VALUES = [
  {
    key: 'acceptance',
    short: 'Welcome',
    name: 'Acceptance',
    tint: '#D6E4BE',
    ink: '#33431E',
    solid: '#4A5E3A',
    blurb: 'Intentionally welcoming and loving all people as Jesus does.',
  },
  {
    key: 'worship',
    short: 'Receive',
    name: 'Worship',
    tint: '#CEDBF7',
    ink: '#1E2D4A',
    solid: '#1E2D4A',
    blurb: "Gathering as God's people, celebrating His grace, receiving His gifts of Word and Sacrament.",
  },
  {
    key: 'education',
    short: 'Grow',
    name: 'Christian Education',
    tint: '#BAE8DE',
    ink: '#0F5049',
    solid: '#1F7A70',
    blurb: 'Equipping people for a lifelong journey with Christ.',
  },
  {
    key: 'outreach',
    short: 'Go',
    name: 'Outreach',
    tint: '#E4CBEE',
    ink: '#573A5F',
    solid: '#8A6A8A',
    blurb: "Sharing the love of Jesus with those who don't yet know Him.",
  },
];

export const VALUE_KEYS = VALUES.map((v) => v.key);

const BY_KEY = new Map(VALUES.map((v) => [v.key, v]));

// Unknown / unset reads as null rather than throwing — `value` is nullable on
// every table that carries it, and an untagged row is a normal state, not an
// error.
export function valueByKey(key) {
  return BY_KEY.get(key) || null;
}

// Accepts anything a form or an old row might hold and returns a stored key or
// null. Guards the write path so a stale tab cannot put 'Welcome' or 'GROW' in
// the column where every reader expects 'acceptance' / 'education'.
export function normalizeValue(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (BY_KEY.has(s)) return s;
  const hit = VALUES.find((v) => v.short.toLowerCase() === s || v.name.toLowerCase() === s);
  return hit ? hit.key : null;
}
