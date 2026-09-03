// Node test harness for admin/square.js — run with: node admin/square.test.mjs
import crypto from 'node:crypto';
import assert from 'node:assert';
import { createSquarePaymentLink, verifySquareSignature, squareFeeCents } from './square.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const group = (n) => console.log('\n' + n);

// ── the webhook signature, checked against an INDEPENDENT implementation ────
// Same shape as admin/webpush.test.mjs: this file's own HMAC is verified
// against Node's crypto module computing the identical thing a different
// way, which is what makes the check mean something — two copies of the
// same bug would agree with each other and tell you nothing.
group('the webhook signature is verified against an independent HMAC');
{
  const env = { SQUARE_WEBHOOK_SIGNATURE_KEY: 'test-signing-key-do-not-use-in-prod' };
  const url = 'https://admin.timothystl.org/api/square/webhook';
  const body = JSON.stringify({ type: 'payment.updated', data: { object: { payment: { id: 'p1', status: 'COMPLETED' } } } });
  const expected = crypto.createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY).update(url + body).digest('base64');

  ok(await verifySquareSignature(env, url, body, expected), 'a correctly signed notification verifies');
  ok(!(await verifySquareSignature(env, url, body, expected.slice(0, -1) + (expected.slice(-1) === 'A' ? 'B' : 'A'))),
    'a one-character-off signature is rejected');
  ok(!(await verifySquareSignature(env, url, body + ' ', expected)),
    'a body byte different from what was signed is rejected — the signature covers the exact bytes, not a re-parsed copy');
  ok(!(await verifySquareSignature(env, url + '/', body, expected)),
    'a different notification URL is rejected — the URL is part of what is signed');
  ok(!(await verifySquareSignature(env, url, body, '')), 'an empty signature is rejected, not treated as unset-and-fine');
  ok(!(await verifySquareSignature({}, url, body, expected)),
    'no signing key configured refuses the request rather than treating it as always valid');
}

// ── creating a link hands Square the amount it is given, and nothing else ───
group('a payment link is created with the exact amount it is handed, never recomputed here');
{
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return new Response(JSON.stringify({
      payment_link: { id: 'link_1', url: 'https://square.link/u/abc123', order_id: 'order_1' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const link = await createSquarePaymentLink(
    { SQUARE_ACCESS_TOKEN: 'sq0atp-test', SQUARE_LOCATION_ID: 'L1' },
    { idempotencyKey: 'market-vendor-42', amountCents: 9300, name: 'Test Vendor — 3 tables' }
  );
  eq(link.url, 'https://square.link/u/abc123', 'the checkout URL comes straight from Square’s response');
  eq(link.orderId, 'order_1', 'and the order id is captured from the SAME response, not a later lookup');

  ok(calls.length === 1, 'exactly one request is made');
  ok(calls[0].url.includes('connect.squareup.com'), 'production host by default, with no SQUARE_ENVIRONMENT set');
  const sent = JSON.parse(calls[0].opts.body);
  eq(sent.quick_pay.price_money.amount, 9300, 'the amount sent to Square is the one this function was handed');
  eq(sent.quick_pay.price_money.currency, 'USD');
  eq(sent.quick_pay.location_id, 'L1');
  eq(sent.idempotency_key, 'market-vendor-42', 'a retry with the same key cannot double-create a link');
  eq(calls[0].opts.headers.Authorization, 'Bearer sq0atp-test');
}

group('the Sandbox environment is a real switch, not a second token against the same host');
{
  let calledUrl = '';
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return new Response(JSON.stringify({ payment_link: { id: 'x', url: 'https://x', order_id: 'o' } }), { status: 200 });
  };
  await createSquarePaymentLink(
    { SQUARE_ACCESS_TOKEN: 't', SQUARE_LOCATION_ID: 'L1', SQUARE_ENVIRONMENT: 'sandbox' },
    { idempotencyKey: 'k', amountCents: 100 }
  );
  ok(calledUrl.includes('connect.squareupsandbox.com'), 'sandbox mode reaches Square’s separate sandbox host');
}

group('missing credentials refuse outright rather than silently doing nothing');
{
  await assert.rejects(
    () => createSquarePaymentLink({}, { idempotencyKey: 'k', amountCents: 100 }),
    /not configured/,
    'no SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID throws a clear error the caller can catch and fall back on'
  );
}

group('a refused request from Square surfaces as an error, not a silently broken link');
{
  globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ detail: 'Invalid location' }] }), { status: 400 });
  await assert.rejects(
    () => createSquarePaymentLink({ SQUARE_ACCESS_TOKEN: 't', SQUARE_LOCATION_ID: 'bad' }, { idempotencyKey: 'k', amountCents: 100 }),
    /Invalid location/
  );
}

group('squareFeeCents sums what Square actually reported, and knows the difference between zero and nothing yet');
{
  // Andrew's own example: a $36.50 table charge, $35.14 of it actually
  // deposited — a $1.36 fee, close to but not exactly the 2.9% + 30¢ the
  // gross-up assumes (2.9% of 3650 rounds to 106, +30 = 136 — this example
  // happens to land exactly on it, which is the point: it usually will,
  // and the whole reason to read the real figure is the times it does not).
  eq(squareFeeCents({ processing_fee: [{ amount_money: { amount: 136, currency: 'USD' } }] }), 136,
    'a single fee line is read straight');
  eq(squareFeeCents({ processing_fee: [
    { amount_money: { amount: 100, currency: 'USD' } },
    { amount_money: { amount: 36, currency: 'USD' } },
  ] }), 136, 'more than one fee line is summed — Square can split a fee across entries');
  eq(squareFeeCents({}), null, 'no processing_fee at all reads as "not reported yet", not zero');
  eq(squareFeeCents({ processing_fee: [] }), null, 'an empty array is the same fact — nothing to sum yet');
  eq(squareFeeCents(null), null, 'no payment object at all is handled the same way');
  eq(squareFeeCents({ processing_fee: [{ amount_money: { amount: 0, currency: 'USD' } }] }), 0,
    'a real, reported fee of zero is kept as zero — a different fact from null, and this is the one case that proves the distinction is real');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
