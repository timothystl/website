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
export const VALUES = [
  {
    key: 'acceptance',
    short: 'Welcome',
    name: 'Acceptance',
    tint: '#EDF0E4',
    ink: '#3F5424',
    solid: '#4A5E3A',
    blurb: 'Intentionally welcoming and loving all people as Jesus does.',
  },
  {
    key: 'worship',
    short: 'Receive',
    name: 'Worship',
    tint: '#E7EEF7',
    ink: '#1E2D4A',
    solid: '#1E2D4A',
    blurb: "Gathering as God's people, celebrating His grace, receiving His gifts of Word and Sacrament.",
  },
  {
    key: 'education',
    short: 'Grow',
    name: 'Christian Education',
    tint: '#E4EFEF',
    ink: '#17565C',
    solid: '#1F6B72',
    blurb: 'Equipping people for a lifelong journey with Christ.',
  },
  {
    key: 'outreach',
    short: 'Go',
    name: 'Outreach',
    tint: '#FAF0DC',
    ink: '#7A5B18',
    solid: '#C9973A',
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
