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

export const VALUES = [
  {
    key: 'acceptance',
    short: 'Welcome',
    name: 'Acceptance',
    ink: '#1D3557',
    tint: '#E7ECF3',
    blurb: 'Intentionally welcoming and loving all people as Jesus does.',
  },
  {
    key: 'worship',
    short: 'Receive',
    name: 'Worship',
    ink: '#3E5C76',
    tint: '#E9EFF4',
    blurb: "Gathering as God's people, celebrating His grace, receiving His gifts of Word and Sacrament.",
  },
  {
    key: 'education',
    short: 'Grow',
    name: 'Christian Education',
    ink: '#4A5E3A',
    tint: '#EAF1E5',
    blurb: 'Equipping people for a lifelong journey with Christ.',
  },
  {
    key: 'outreach',
    short: 'Go',
    name: 'Outreach',
    ink: '#C9973A',
    tint: '#FBF1DC',
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
