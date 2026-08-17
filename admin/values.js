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
    // The redesign's own field for this value — a gradient, its bright
    // accent, and whether text on it is light or dark. Authored to a
    // contrast budget: a field is measured at the END THAT HURTS (the
    // light stop for white ink), which is why these are darker than the
    // brand hues they came from.
    field: 'linear-gradient(150deg,#153A1E 0%,#2F6B3A 58%,#3F7A38 100%)',
    light: '#6FA84E',
    darkInk: false,
    tag: 'Welcoming all people with the love of Jesus.',
    why: 'Nothing else on this list happens to a person who never felt welcome. Acceptance is not the warm-up; it is the first thing the gospel does.',
    ways: [
      { title: 'Worship with us', body: 'Join us for uplifting worship and receive God’s grace.' },
      { title: 'For everyone', body: 'People of all ages and every stage of life are welcome.' },
      { title: 'Connect & belong', body: 'Find meaningful relationships and grow in faith together.' },
      { title: 'Learn & grow', body: 'Explore God’s Word and deepen your walk with Christ.' },
      { title: 'Serve together', body: 'Use your gifts to make a difference in our community and beyond.' },
      { title: 'Come as you are', body: 'You don’t have to have it all figured out. There’s a place for you.' },
    ],
    short: 'Welcome',
    name: 'Acceptance',
    tint: '#D6E4BE',
    ink: '#33431E',
    solid: '#4A5E3A',
    blurb: 'Intentionally welcoming and loving all people as Jesus does.',
  },
  {
    key: 'worship',
    // The redesign's own field for this value — a gradient, its bright
    // accent, and whether text on it is light or dark. Authored to a
    // contrast budget: a field is measured at the END THAT HURTS (the
    // light stop for white ink), which is why these are darker than the
    // brand hues they came from.
    field: 'linear-gradient(150deg,#0E2B5B 0%,#1B4FA0 58%,#3266AE 100%)',
    light: '#3E7BD1',
    darkInk: false,
    tag: 'Gathering as God’s people to celebrate His grace and receive His gifts through Word and Sacrament.',
    why: 'Lutherans put receiving before doing. Sunday morning is not what we offer God; it is where He hands out what He has already won.',
    ways: [
      { title: 'Sermons', body: 'God speaks to us through His Word preached and taught.' },
      { title: 'Communion', body: 'Receiving Christ’s true body and blood for the forgiveness of sins.' },
      { title: 'Worship music', body: 'Using our voices and instruments to praise our Savior.' },
      { title: 'Serving in worship', body: 'Many gifts, one body — serving together in worship.' },
      { title: 'Choirs', body: 'Handbells, youth, adult and African choirs lifting our voices in praise.' },
      { title: 'Livestream & media', body: 'Bringing worship to our homebound and beyond.' },
    ],
    short: 'Receive',
    name: 'Worship',
    tint: '#CEDBF7',
    ink: '#1E2D4A',
    solid: '#1E2D4A',
    blurb: "Gathering as God's people, celebrating His grace, receiving His gifts of Word and Sacrament.",
  },
  {
    key: 'education',
    // The redesign's own field for this value — a gradient, its bright
    // accent, and whether text on it is light or dark. Authored to a
    // contrast budget: a field is measured at the END THAT HURTS (the
    // light stop for white ink), which is why these are darker than the
    // brand hues they came from.
    field: 'linear-gradient(150deg,#0C3F47 0%,#17636D 58%,#1F7A86 100%)',
    light: '#45AFB8',
    darkInk: false,
    tag: 'Growing together in Christ — equipping people to grow in a lifelong journey with Him.',
    why: 'Faith that stopped learning stopped moving. Confirmation is not graduation, and neither is being sixty.',
    ways: [
      { title: 'Bible studies', body: 'Digging into Scripture together to know God more deeply.' },
      { title: 'Youth ministry', body: 'Encouraging students to live and share their faith.' },
      { title: 'Sunday School', body: 'Learning about God’s love at every age.' },
      { title: 'Adult education', body: 'Equipping adults to grow in faith and live it out every day.' },
      { title: 'Confirmation', body: 'Building a strong foundation in the Lutheran faith.' },
      { title: 'Resources', body: 'You don’t have to know everything. Here is where to start.' },
    ],
    short: 'Grow',
    name: 'Christian Education',
    tint: '#BAE8DE',
    ink: '#0F5049',
    solid: '#1F7A70',
    blurb: 'Equipping people for a lifelong journey with Christ.',
  },
  {
    key: 'outreach',
    // The redesign's own field for this value — a gradient, its bright
    // accent, and whether text on it is light or dark. Authored to a
    // contrast budget: a field is measured at the END THAT HURTS (the
    // light stop for white ink), which is why these are darker than the
    // brand hues they came from.
    field: 'linear-gradient(140deg,#E4A93C 0%,#F0C46B 52%,#D89428 100%)',
    light: '#E8A93C',
    darkInk: true,
    tag: 'Sharing Jesus with our neighbors and the nations — sharing the love of Jesus with those who do not yet know Him.',
    why: 'From our neighborhood to the nations is not a slogan on the letterhead. It is the last line of the arc, and it points out the door.',
    ways: [
      { title: 'Vacation Bible School', body: 'Sharing God’s love and the joy of the Gospel with kids.' },
      { title: 'Short-term missions', body: 'Answering God’s call to go and serve around the world.' },
      { title: 'Local service', body: 'Meeting needs and showing Christ’s love in our community.' },
      { title: 'Share the gospel', body: 'Telling others about Jesus and inviting them into His family.' },
      { title: 'Food pantry', body: 'Providing food and caring for families in need.' },
      { title: 'Neighborhood presence', body: 'The Christmas Market, the bees, the clean-ups — being here, visibly.' },
    ],
    short: 'Go',
    name: 'Outreach',
    tint: '#E4CBEE',
    ink: '#573A5F',
    solid: '#8A6A8A',
    blurb: "Sharing the love of Jesus with those who don't yet know Him.",
  },
];

export const VALUE_KEYS = VALUES.map((v) => v.key);

// The office-editable fields, layered onto the hardcoded record. `rows` is
// whatever `core_values` holds — one row per key, any subset of columns
// filled in. A blank or missing column is not an edit; it is "still the
// hardcoded default", which is what lets the table be seeded empty and
// change nothing on the site until somebody actually fills a field in.
//
// ⚠ EVERY OTHER FIELD ON THE RECORD — field, light, darkInk, tint, ink, solid,
// ways — passes through untouched. Those are the design tokens; this only
// ever widens what a value SAYS, never what it looks like structurally.
export const VALUE_TEXT_FIELDS = ['short', 'name', 'blurb', 'tag', 'why'];

export function mergedValues(rows) {
  const byKey = new Map((rows || []).map((r) => [r.key, r]));
  return VALUES.map((v) => {
    // ⚠ `|| {}`, NOT a special case for "no row". A missing row and a row
    // whose every column is NULL (the shape the seed actually produces) have
    // to read identically, or the seed's very first day would render
    // differently from a database that never migrated at all.
    const row = byKey.get(v.key) || {};
    const out = { ...v, photo_url: row.photo_url || '' };
    for (const f of VALUE_TEXT_FIELDS) if (row[f]) out[f] = row[f];
    return out;
  });
}

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
