// Node test harness for admin/spam.js — run with: node admin/spam.test.mjs
// No test framework (the repo has no build step or dev dependencies).
//
// The corpus below is real: every "legitimate" message is an actual submission
// that came through timothystl.org's contact or prayer form, and every "spam"
// one is an actual pitch that reached the office inbox. New rules get judged
// against this file — if a change holds one of the real messages below, the
// change is wrong.
import { scoreSubmission, signFormToken, verifyFormToken, HOLD_SCORE, SUSPECT_SCORE } from './spam.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// A submission that came through the real form: token valid, no Turnstile
// configured, first message from that address.
const viaForm = { tokenState: 'valid', turnstile: 'off', recentFromIp: 1 };

// ── real messages from real people ───────────────────────────────────────────
group('real submissions are always delivered');
const LEGIT = [
  ['prayer request', { name: 'Frank', email: 'lordoflight316@gmail.com', message: "Please pray to Jesus Christ for my wife's parents. For peace in their marriage and for them to be saved if they are not saved, and for God to heal their bodies." }],
  ['food pantry', { name: 'Shauntelle Sanderss', email: 'ssanders1129@gmail.com', message: "Hello I was wanting to know is the food pantry open Tommorow Thank You So Much I'm really in need of food 314-324-8566 Shauntelle" }],
  ['giving question', { name: 'Larry Copley', email: 'larrycopley@charter.net', message: 'With the switch to tithe.ly I no longer have access to giving history.' }],
  ['comfort dog ask', { name: 'Pete Breting', email: 'pbreting@pikesb40.org', message: 'Hi, Do you have a comfort dog that would come up to Bowling Green MO periodically to visit participants in our day program for developmentally disabled adults?' }],
  ['pastor referral', { name: 'Stephen Krenz', email: 'pastork@splcolumbia.com', message: 'I have a woman in my adult confirmation class whose mother is Vietnamese and asked about a Vietnamese Lutheran church for her. Might you have a service she could attend?' }],
  ['wedding question', { name: 'Aka anonymous', email: 'bo3gurl27@gmail.com', message: 'Just a quick question. Does Pastor Wilson still preach there, and if he does/does not can he do marriage vows and sign court documents?' }],
  ['visitor', { name: 'Mark Cavender', email: 'mdcavender@att.net', message: 'Visiting friends.' }],
  ['ministry inquiry', { name: 'Barlencia Bailey', email: 'barlencia.bailey@gmail.com', message: "Inquiry About Hosting A Women's Spa Ministry Experience. Good afternoon, My name is Barlencia, and I am reaching out with gratitude for the ministry of your congregation." }],
  ['cancer prayer', { name: 'Heather Unruh', email: 'heatherju@yahoo.com', message: 'Please pray for my sister Michelle Unruh. She has been diagnosed with a rare form of kidney cancer. She is starting her first line of treatment next week.' }],
  ['bulletin request', { name: 'Diane saleska', email: 'saleskad@umsl.edu', message: 'My cousin Doug having multiple cardiac bypass on Monday April 20. Just pray this week. No need to put name in bulletin. Thanks Diane' }],
];
for (const [label, sub] of LEGIT) {
  const r = scoreSubmission(sub, viaForm);
  ok(r.verdict !== 'spam', `${label} is never held (scored ${r.score}: ${r.reasons.join('; ') || 'nothing flagged'})`);
  ok(r.score < SUSPECT_SCORE, `${label} is not even flagged (scored ${r.score}: ${r.reasons.join('; ') || 'nothing flagged'})`);
}

// A real message that happens to include a link and a friendly opener still
// gets through — that combination must stay under the hold threshold.
{
  const r = scoreSubmission({
    name: 'Gail Nielsen', email: 'gail@example.org',
    message: 'Hello there, our LWML group is putting together the fall retreat. The signup is at https://example.org/retreat if you want to look it over.',
  }, viaForm);
  ok(r.verdict !== 'spam', `a real note with a link and a casual opener is delivered (scored ${r.score})`);
}

// ── the pitches that prompted this ───────────────────────────────────────────
group('marketing spam is held');
{
  // The exact message the office received on 2026-07-31.
  const lumitoon = {
    name: 'Sarah Glover', email: 'sarah@thelumitoonstudios.com',
    message: `Hi,

If your audience doesn't get your offer in seconds, you're losing leads.

At Lumitoon Studios, we create engaging 2D & 3D animated videos that clearly explain your value, capture attention, and convert viewers into customers.

Perfect for websites, ads, and sales funnels—our videos work for you 24/7.

Ready to boost conversions? Just reply to get started.

Best regards,

Sarah Glover
Lumitoon Studios
sarah@thelumitoonstudios.com

Reply STOP to opt out.`,
  };
  const r = scoreSubmission(lumitoon, viaForm);
  eq(r.verdict, 'spam', `the Lumitoon pitch is held (scored ${r.score})`);
  ok(r.reasons.length >= 3, 'and the hold is explained by several reasons, not one lucky match');
  ok(r.reasons.some(x => /opt-out/.test(x)), 'including its bulk-mail opt-out line');
}
{
  const seo = scoreSubmission({
    name: 'Raj', email: 'raj@seopros.biz',
    message: 'Hello Sir, I am an SEO expert. I can increase your traffic with quality backlinks and improve your domain authority. Let me know if you are interested in our price list.',
  }, viaForm);
  eq(seo.verdict, 'spam', `an SEO pitch is held (scored ${seo.score})`);
}
{
  const scam = scoreSubmission({
    name: 'Barrister John', email: 'j@example.com',
    message: 'Dear Sir, I write concerning an inheritance of USD 4.5M. You have been named next of kin. Kindly reply for the wire transfer fee details.',
  }, viaForm);
  eq(scam.verdict, 'spam', `an advance-fee scam is held (scored ${scam.score})`);
}
{
  const linky = scoreSubmission({
    name: 'promo', email: 'a@b.co',
    message: 'Check https://a.example https://b.example https://c.example for the best rates.',
  }, viaForm);
  eq(linky.verdict, 'spam', `a message that is mostly links is held (scored ${linky.score})`);
}
{
  const markup = scoreSubmission({ name: 'x', email: 'a@b.co', message: 'nice site <a href="https://x.example">click</a>' }, viaForm);
  ok(markup.score >= HOLD_SCORE, 'raw HTML in a plain-text form is held');
}
{
  const cyr = scoreSubmission({ name: 'Иван', email: 'a@b.co', message: 'Здравствуйте, предлагаем услуги продвижения сайта' }, viaForm);
  ok(cyr.score >= 4, 'a non-Latin message is scored');
}

group('borderline pitches are flagged but still delivered');
{
  // Real message, 2026-07-25 — a guest-post pitch dressed as a reader note.
  const r = scoreSubmission({
    name: 'Loly', email: 'LYRich@birdingforkids.org',
    message: 'Hey there, I wanted to follow up and see if you had a chance to consider my article idea about the performing arts and leadership. Let me know your thoughts.',
  }, viaForm);
  eq(r.verdict, 'suspect', `a guest-post pitch is flagged, not held (scored ${r.score})`);
}

// ── the signals gathered around the message ──────────────────────────────────
group('honeypot');
{
  const r = scoreSubmission({ name: 'x', message: 'hello', honeypot: 'http://spam.example' }, viaForm);
  eq(r.verdict, 'spam', 'a filled honeypot is held on its own');
  eq(r.reasons.length, 1, 'and needs no other reason');
}

group('a submission that never touched the form');
{
  // A bot POSTing straight at the API with an innocuous message: penalised, but
  // not held — that is deliberate, so a cache or key problem can never silence
  // a real prayer request.
  const bare = scoreSubmission({ name: 'Jo', message: 'Please pray for my mother.' }, { tokenState: 'missing', turnstile: 'off', recentFromIp: 1 });
  eq(bare.verdict, 'suspect', `a missing token alone does not hold a clean message (scored ${bare.score})`);

  // The same missing token under a sales pitch is what pushes it over.
  const pitch = scoreSubmission({ name: 'Jo', message: 'We offer a wide range of marketing services. Free trial available.' }, { tokenState: 'missing', turnstile: 'off', recentFromIp: 1 });
  eq(pitch.verdict, 'spam', `a missing token plus a pitch is held (scored ${pitch.score})`);

  const tooFast = scoreSubmission({ name: 'Jo', message: 'Please pray for my mother.' }, { tokenState: 'too-fast', turnstile: 'off', recentFromIp: 1 });
  ok(tooFast.score >= SUSPECT_SCORE, 'an instant submit is flagged');

  const stale = scoreSubmission({ name: 'Jo', message: 'Please pray for my mother.' }, { tokenState: 'expired', turnstile: 'off', recentFromIp: 1 });
  eq(stale.verdict, 'clean', 'a tab left open all day is not punished');

  const noKey = scoreSubmission({ name: 'Jo', message: 'Please pray for my mother.' }, { tokenState: 'unavailable', turnstile: 'off', recentFromIp: 1 });
  eq(noKey.verdict, 'clean', 'our own signing key being unreadable never counts against a visitor');
}

group('turnstile and flooding');
{
  const failed = scoreSubmission({ name: 'Jo', message: 'Please pray for my mother.' }, { tokenState: 'valid', turnstile: 'failed', recentFromIp: 1 });
  eq(failed.verdict, 'spam', 'a failed Turnstile challenge is held');
  const off = scoreSubmission({ name: 'Jo', message: 'Please pray for my mother.' }, { tokenState: 'valid', turnstile: 'off', recentFromIp: 1 });
  eq(off.verdict, 'clean', 'Turnstile not being configured costs nothing');
  const flood = scoreSubmission({ name: 'Jo', message: 'Please pray for my mother.' }, { tokenState: 'valid', turnstile: 'off', recentFromIp: 9 });
  eq(flood.verdict, 'spam', 'nine submissions in an hour from one address is held');
  const family = scoreSubmission({ name: 'Jo', message: 'Please pray for my mother.' }, { tokenState: 'valid', turnstile: 'off', recentFromIp: 3 });
  eq(family.verdict, 'clean', 'a few from one church-office address is not');
}

// ── form token ───────────────────────────────────────────────────────────────
group('form token');
{
  const secret = 'test-secret-value';
  const now = 1_800_000_000_000;
  const token = await signFormToken(secret, now - 10_000);

  eq(await verifyFormToken(token, secret, { now }), 'valid', 'a token signed 10s ago is valid');
  eq(await verifyFormToken(token, 'other-secret', { now }), 'invalid', 'a token signed with another key is invalid');
  eq(await verifyFormToken('', secret, { now }), 'missing', 'no token reads as missing');
  eq(await verifyFormToken(token, '', { now }), 'unavailable', 'no signing key reads as unavailable');
  eq(await verifyFormToken('garbage', secret, { now }), 'invalid', 'a malformed token is invalid');
  eq(await verifyFormToken(`${now - 10_000}.deadbeef`, secret, { now }), 'invalid', 'a forged signature is invalid');

  const instant = await signFormToken(secret, now - 200);
  eq(await verifyFormToken(instant, secret, { now }), 'too-fast', 'submitting 200ms after page load is too fast');

  const old = await signFormToken(secret, now - 20 * 60 * 60 * 1000);
  eq(await verifyFormToken(old, secret, { now }), 'expired', 'a 20-hour-old token has expired');

  const future = await signFormToken(secret, now + 10 * 60 * 1000);
  eq(await verifyFormToken(future, secret, { now }), 'invalid', 'a token dated in the future is invalid');

  // Same input, same token — the signature is deterministic, so a token issued
  // by one Worker isolate verifies in another.
  eq(await signFormToken(secret, now), await signFormToken(secret, now), 'signing is deterministic across isolates');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
