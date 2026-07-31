// ── SPAM SCREENING for the public forms (contact, prayer, subscribe) ──
//
// Pure functions only — no D1, no fetch, no Worker globals beyond WebCrypto —
// so the whole thing is testable with `node admin/spam.test.mjs`.
//
// Design rule: a church must never lose a real prayer request. Nothing here
// rejects a submission outright. A message that scores past HOLD_SCORE is
// *held* — stored in full, visible under Filtered Mail in the admin, one click
// from being released. Everything below the threshold is delivered as before,
// with a marker in the subject line when it scored high enough to be worth a
// second look. That is why the weights lean conservative: a missed spam is an
// annoyance, a held prayer request is a pastoral failure.

// A score at or above this is held for review instead of emailed.
export const HOLD_SCORE = 6;
// At or above this (but below HOLD_SCORE) the message is still delivered, with
// "[likely spam]" prefixed to the subject so it can be filtered or eyeballed.
export const SUSPECT_SCORE = 3;

// Sales/marketing vocabulary. Individually weak — a real note might contain
// one — so each is worth 2 and the whole group is capped (MARKETING_CAP)
// below. Phrases are matched against the lowercased message with whitespace
// collapsed, so line breaks inside a phrase don't hide it.
const MARKETING = [
  [/\bseo\b|search engine optimi[sz]ation/, 'SEO pitch'],
  [/backlinks?\b|link building|domain authority|dofollow/, 'link-building pitch'],
  [/guest post|guest article|article idea|sponsored post|link insertion|content collaboration/, 'guest-post pitch'],
  [/website? (design|redesign|development|revamp) (service|compan|agenc|team)/, 'web design pitch'],
  [/increase (your )?(traffic|sales|revenue|leads|conversions|visibility)/, 'growth pitch'],
  [/boost (your )?(conversion|sale|traffic|ranking|engagement)/, 'growth pitch'],
  [/conversion rate|sales funnel|lead generation|generate (more )?leads|losing leads|convert (viewers|visitors|traffic) into/, 'funnel pitch'],
  [/digital marketing|marketing (agency|services)|social media management/, 'marketing pitch'],
  [/explainer video|animated video|whiteboard animation|motion graphics|2d ?& ?3d|video production service/, 'video production pitch'],
  [/mobile app development|dedicated developers|offshore (team|developers)|outsourcing (service|solution)|it staffing/, 'dev outsourcing pitch'],
  [/free (trial|consultation|quote|audit|sample|demo)|no obligation|risk[- ]free/, 'free-offer hook'],
  [/(let me know|would you be|are you) (if )?(interested|open to)|ready to (boost|grow|scale|get started)|get started today/, 'sales close'],
  [/hope (this (email|message) finds you|you are doing) well|i wanted to follow up|just (following|checking) (up|in)|circling back/, 'cold-outreach opener'],
  [/our (team|company) (can|specializes|offers|provides)|we specialize in|we offer (a )?(wide )?range/, 'vendor introduction'],
  [/price list|pricing plans|affordable rates|competitive rates|best rates/, 'pricing pitch'],
  [/work(s)? for you 24\/7|24\/7 support|round[- ]the[- ]clock support/, 'sales copy'],
  [/\bb2b\b|\broi\b|\bkpis?\b|growth hack/, 'marketing jargon'],
];
const MARKETING_WEIGHT = 2;
const MARKETING_CAP = 6;

// Bulk-mail machinery. Nobody writing to their church adds an opt-out line —
// these mean the message came off a mailing list, not out of a person's head.
const BULK = [
  [/reply stop|text stop|opt[- ]?out|unsubscribe/, 'bulk-mail opt-out line'],
  [/click here to (unsubscribe|remove|opt)|to stop receiving/, 'bulk-mail opt-out line'],
  [/this (e-?mail|message) (is|was) sent to|you (are )?receiv(ing|ed) this (e-?mail|message) because/, 'bulk-mail footer'],
];
const BULK_WEIGHT = 5;

// Money scams. Rare through a church form, catastrophic when someone bites.
const SCAM = [
  [/crypto(currency)?|bitcoin|\bforex\b|binary options|casino|online gambling/, 'crypto/gambling pitch'],
  [/loan offer|investment opportunity|inheritance|beneficiary of|next of kin|unclaimed funds/, 'advance-fee scam wording'],
  [/western union|wire transfer fee|gift ?cards?\b.{0,30}(purchase|buy|send)/, 'wire/gift-card scam wording'],
];
const SCAM_WEIGHT = 5;

// The donated-piano scam. It arrives at churches constantly, in the same shape
// every time: a valuable instrument offered free on behalf of a third party,
// with an outside address to write to. What follows is a delivery or "moving
// company" fee for a piano that does not exist.
//
// It is scored in two halves on purpose, because a member really might write
// offering the church a piano. The item on its own is nearly worthless as a
// signal (ITEM_GIFT); it takes one of the shapes a parishioner would never use
// (GIFT_SCAM_SHAPE) to reach the hold threshold. Someone writing about their
// own piano — "we'd like to donate my mother's upright" — stays well under it.
const ITEM_GIFT_SUBJECT = /\b(baby ?grand|grand piano|upright piano|piano|pipe organ|church organ|hammond organ|harpsichord|treadmill|pool table)\b/;
const ITEM_GIFT_OFFER = /\b(for free|free of charge|at no cost|no cost to you|donat(e|ing|ion)|giving (it )?away|give away|good home|loving home|bequeath)\b/;
const ITEM_GIFT_WEIGHT = 2;

// Written about a named third party rather than by the person who owns it.
// Only worth a little on its own: a member relaying a neighbour's offer writes
// this way too, and that message must still reach the office.
const GIFT_THIRD_PARTY = [
  [/\b(is|are) (offering|donating|gifting|giving away|looking to donate)\b.{0,40}\b(her|his|their)\b/, 'offered on behalf of someone else'],
  [/\b(mr|mrs|ms|miss)\.? ?[a-z]+.{0,60}\b(is|are) (offering|donating|gifting)/, 'offered on behalf of someone else'],
];
const GIFT_THIRD_PARTY_WEIGHT = 2;

// The tells no member offering their own piano would ever write.
const GIFT_TELLS = [
  // The redirect to an address other than the one the form was filled in with.
  [/contact (her|him|them)\b.{0,30}(via|at|through)\b.{0,20}(e-?mail|address)/, 'redirects to a different email address'],
  // The stock sentiment these always carry.
  [/passionate (music )?(enthusiast|lover)|someone who (will|can) (appreciate|treasure|care for)|retir(es|ing) from music/, 'stock wording from the donated-instrument scam'],
  [/\blate (husband|wife|father|mother|spouse)\b.{0,80}\b(donat|offer|gift|give|left behind|good home)/, 'late-relative framing'],
];
const GIFT_TELLS_WEIGHT = 4;

// The payload of the scam, and decisive on its own: the item is free, you
// merely cover the shipping.
const DELIVERY_FEE = [
  [/(only|just|simply) (pay|cover|handle)\b.{0,30}(shipping|delivery|moving|transport|freight)/, 'free item, you pay the delivery'],
  [/(shipping|delivery|moving|freight) (fee|cost|charge|company)\b.{0,40}(only|your|arrang)/, 'free item, you pay the delivery'],
];
const DELIVERY_FEE_WEIGHT = 5;
// Even a pile of these shouldn't swamp everything else — one clear tell is
// enough to hold, and holding is the strongest thing the filter can do.
const GIFT_CAP = 8;

// Blast-mail greetings — a real visitor writes to a person or to "Timothy",
// not to the owner of a website.
const IMPERSONAL = [
  [/dear (sir|madam|owner|webmaster|website owner|team|user|customer)/, 'addressed to a webmaster, not a person'],
  [/(hi|hello|greetings)[, ]+(there|team|owner|webmaster)\b/, 'addressed to a webmaster, not a person'],
];
const IMPERSONAL_WEIGHT = 3;

// Only fully-qualified links count. A bare "tithe.ly" or "csl.edu" shows up in
// perfectly normal messages from members, so bare domains are deliberately not
// matched here.
const URL_RE = /(https?:\/\/|www\.)[^\s<>"']+/gi;
// Cyrillic, CJK, Arabic, Hebrew, Thai, Devanagari. An English-language parish
// in south St. Louis does not receive these from real neighbours.
const NON_LATIN_RE = /[Ѐ-ӿ֐-׿؀-ۿऀ-ॿ฀-๿぀-ヿ一-鿿가-힯]/;
const MARKUP_RE = /<a\s|<script|\[url[=\]]|\[link[=\]]|<iframe/i;

// Penalties for the signals the Worker gathers around the message rather than
// inside it. `tokenState` comes from verifyFormToken (a bot POSTing straight
// at the API never fetched a token); `turnstile` is 'off' unless
// TURNSTILE_SECRET_KEY is configured.
const TOKEN_PENALTY = {
  valid: 0,
  expired: 1,      // a tab left open all day — barely a signal
  'too-fast': 4,   // submitted faster than a human reads the form
  missing: 4,      // posted straight at the API, skipping the page
  invalid: 5,      // forged or tampered
  unavailable: 0,  // our own signing key was unreadable — never punish for that
};
const TURNSTILE_PENALTY = { ok: 0, off: 0, missing: 5, failed: 6 };

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Scores each *distinct reason* once, not each regex. Several patterns often
// describe the same tell — two phrasings of a bulk-mail opt-out line, two ways
// of writing "so-and-so is offering her piano" — and charging for both would
// double a signal that a visitor only gave once.
function matchGroup(text, group, weight, hits) {
  let score = 0;
  for (const [re, why] of group) {
    if (re.test(text) && !hits.includes(why)) {
      score += weight;
      hits.push(why);
    }
  }
  return score;
}

/**
 * Score one submission.
 *
 * @param {{name?:string, email?:string, message?:string, honeypot?:string}} sub
 * @param {{tokenState?:string, turnstile?:string, recentFromIp?:number}} signals
 * @returns {{score:number, verdict:'clean'|'suspect'|'spam', reasons:string[]}}
 */
export function scoreSubmission(sub = {}, signals = {}) {
  const reasons = [];
  let score = 0;

  // The hidden field no human can see. On its own, decisive.
  if (sub.honeypot) {
    return { score: 99, verdict: 'spam', reasons: ['hidden honeypot field was filled in'] };
  }

  const message = normalize(sub.message);
  const name = normalize(sub.name);
  const haystack = `${name} ${normalize(sub.email)} ${message}`;

  const marketingHits = [];
  const marketing = matchGroup(haystack, MARKETING, MARKETING_WEIGHT, marketingHits);
  if (marketing) {
    score += Math.min(marketing, MARKETING_CAP);
    reasons.push(...marketingHits);
  }
  score += matchGroup(haystack, BULK, BULK_WEIGHT, reasons);
  score += matchGroup(haystack, SCAM, SCAM_WEIGHT, reasons);
  score += matchGroup(message, IMPERSONAL, IMPERSONAL_WEIGHT, reasons);

  // The donated-instrument scam: an item being given away, plus at least one
  // thing a real member offering their own piano would never write.
  const giftHits = [];
  let gift = 0;
  if (ITEM_GIFT_SUBJECT.test(message) && ITEM_GIFT_OFFER.test(message)) {
    gift += ITEM_GIFT_WEIGHT;
    giftHits.push('an instrument or large item offered free');
  }
  if (gift) {
    gift += matchGroup(message, GIFT_THIRD_PARTY, GIFT_THIRD_PARTY_WEIGHT, giftHits);
    gift += matchGroup(message, GIFT_TELLS, GIFT_TELLS_WEIGHT, giftHits);
  }
  gift += matchGroup(message, DELIVERY_FEE, DELIVERY_FEE_WEIGHT, giftHits);
  if (gift) { score += Math.min(gift, GIFT_CAP); reasons.push(...giftHits); }

  const links = (String(sub.message || '').match(URL_RE) || []).length;
  if (links === 1) { score += 2; reasons.push('contains a link'); }
  else if (links === 2) { score += 4; reasons.push('contains 2 links'); }
  else if (links > 2) { score += 5; reasons.push(`contains ${links} links`); }

  if (MARKUP_RE.test(String(sub.message || ''))) { score += 5; reasons.push('contains HTML or BBCode markup'); }
  if (NON_LATIN_RE.test(String(sub.message || ''))) { score += 4; reasons.push('non-Latin script'); }
  if (/(https?:\/\/|www\.)/i.test(name)) { score += 5; reasons.push('link in the name field'); }

  const tokenState = signals.tokenState || 'valid';
  const tokenPenalty = TOKEN_PENALTY[tokenState] ?? 0;
  if (tokenPenalty) {
    score += tokenPenalty;
    reasons.push(tokenState === 'too-fast'
      ? 'submitted faster than a person could type it'
      : `form token ${tokenState} (did not come from the website form)`);
  }

  const turnstile = signals.turnstile || 'off';
  const tsPenalty = TURNSTILE_PENALTY[turnstile] ?? 0;
  if (tsPenalty) { score += tsPenalty; reasons.push(`Turnstile check ${turnstile}`); }

  // Graduated rather than a hard cut-off: a school or office behind one shared
  // address can legitimately send several in an hour, so only an obvious flood
  // reaches the hold threshold on its own.
  const recent = Number(signals.recentFromIp || 0);
  if (recent > 8) { score += 6; reasons.push(`${recent} submissions from this address in the last hour`); }
  else if (recent > 5) { score += 4; reasons.push(`${recent} submissions from this address in the last hour`); }
  else if (recent > 2) { score += 2; reasons.push(`${recent} submissions from this address in the last hour`); }

  const verdict = score >= HOLD_SCORE ? 'spam' : score >= SUSPECT_SCORE ? 'suspect' : 'clean';
  return { score, verdict, reasons };
}

// ── FORM TOKEN ────────────────────────────────────────────────
// Issued by GET /api/form-config when the page loads, sent back with the
// submission. It proves two things a bot posting straight at the API can't
// fake: the request came from a browser that actually loaded the form, and a
// human-plausible amount of time passed before submit. It is a *signal*, not a
// gate — a missing token adds to the score, it never rejects on its own, so a
// misconfigured key or a stale cache can't silence the forms.

async function hmac(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function signFormToken(secret, issuedAt = Date.now()) {
  const payload = String(issuedAt);
  return `${payload}.${await hmac(secret, payload)}`;
}

/**
 * @returns {'valid'|'missing'|'invalid'|'too-fast'|'expired'|'unavailable'}
 */
export async function verifyFormToken(token, secret, opts = {}) {
  if (!secret) return 'unavailable';
  if (!token) return 'missing';
  const now = opts.now ?? Date.now();
  const minAgeMs = opts.minAgeMs ?? 2500;
  const maxAgeMs = opts.maxAgeMs ?? 12 * 60 * 60 * 1000;

  const [ts, sig] = String(token).split('.');
  if (!ts || !sig || !/^\d+$/.test(ts)) return 'invalid';
  const expected = await hmac(secret, ts);
  if (sig.length !== expected.length) return 'invalid';
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return 'invalid';

  const age = now - Number(ts);
  if (age < -60000) return 'invalid';   // issued in the future — clock forged
  if (age < minAgeMs) return 'too-fast';
  if (age > maxAgeMs) return 'expired';
  return 'valid';
}
