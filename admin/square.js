// ── SQUARE: A CHECKOUT LINK PER VENDOR, AND THE WEBHOOK THAT CONFIRMS ONE ────
//
// Every Square payment link on the market was, until now, a handful of
// static links the office pasted into the Giving tab (later the Christmas
// Market screen) by hand — one per table count, each manually priced in the
// Square dashboard. That is why the website "cannot see whether a card
// cleared": a static link carries no information about WHICH vendor paid it,
// so there was nothing a webhook could ever match against.
//
// This file is the other way of doing it: a payment link created per
// application, at the moment they apply, carrying that application's own
// Square Order id — captured immediately from the creation response, not
// guessed at from the webhook later. When Square later reports that order's
// payment completed, the match is exact, not a best guess by amount and
// timing (which two vendors buying the same number of tables the same week
// would defeat).
//
// ⚠ THE STATIC LINKS ARE NOT REMOVED. If this fails — no credentials set
// yet, Square's API unreachable, a bad response — the caller falls back to
// exactly the link a vendor would have gotten before this file existed. See
// the try/catch around this module's one caller in tlc-admin-worker.js.
//
// ⚠ VERIFY THE API VERSION BEFORE GOING LIVE. Square requires a
// `Square-Version` header naming a dated API release; SQUARE_API_VERSION
// below is a real, working format but was not tested against a live Square
// account from this environment (no outbound access to Square's API here).
// Test with the Sandbox access token first — Square's dashboard has a
// webhook "Send test event" button that shows the exact payload and headers
// a real one carries, which is the only way to confirm the signature header
// name and the payment/order field paths below are still current.

const SQUARE_API_VERSION = '2025-01-23';

// Two different hosts, not two different tokens against one host — Square's
// Sandbox and Production environments are physically separate systems.
// Which one a request reaches is decided by SQUARE_ENVIRONMENT (a plain
// Worker secret, defaulting to production so a forgotten setting fails
// toward the real system rather than silently testing against it forever).
function apiHost(env) {
  return String(env.SQUARE_ENVIRONMENT || '').trim().toLowerCase() === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

// ── CREATE ONE PAYMENT LINK, PRICED EXACTLY LIKE EVERY OTHER PAYMENT LINK ────
// The amount is never computed here — it arrives already grossed-up from
// priceBreakdown(), the one shared definition of what a vendor owes. This
// function's only job is handing that number to Square and getting back
// something to send the vendor to and something to remember.
//
// ⚠ `idempotencyKey` should be derived from the application's own row id
// (e.g. `market-vendor-<id>`), not a random value. Square uses it to refuse
// creating a second link if this call is ever retried — a random key would
// let a retried request quietly double the number of live links for one
// application.
export async function createSquarePaymentLink(env, { idempotencyKey, amountCents, name, redirectUrl }) {
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
    throw new Error('Square is not configured — SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID unset');
  }
  const res = await fetch(`${apiHost(env)}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_API_VERSION,
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      quick_pay: {
        name: String(name || 'Christmas Market table').slice(0, 300),
        price_money: { amount: Math.max(0, Math.round(Number(amountCents) || 0)), currency: 'USD' },
        location_id: env.SQUARE_LOCATION_ID,
      },
      ...(redirectUrl ? { checkout_options: { redirect_url: redirectUrl } } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.payment_link) {
    throw new Error('Square payment link creation failed: ' + (body?.errors?.[0]?.detail || res.status));
  }
  // ⚠ order_id COMES FROM THIS RESPONSE, not from a later lookup. Quick Pay
  // creates an ad-hoc Order behind the link whether or not one is spelled
  // out in the request, and that Order's id is what a completed-payment
  // webhook event carries — capturing it now is what makes the later match
  // exact instead of a second round trip guessing which order a payment
  // belongs to.
  return {
    url: body.payment_link.url,
    paymentLinkId: body.payment_link.id,
    orderId: body.payment_link.order_id || '',
  };
}

// ── WHAT SQUARE ACTUALLY KEEPS, VS. WHAT THE GROSS-UP ASSUMED ────────────────
// `priceBreakdown()` grosses a vendor's total up assuming a flat 2.9% + 30¢
// — a reasonable estimate, not a promise. The card network and card brand
// Square actually processed against (debit vs. credit, a rewards card, an
// out-of-network one) can shift the real fee a few cents either way, and
// that is exactly the gap between what a vendor paid and what shows up in
// the church's bank account. A `Payment`'s own `processing_fee` array is
// Square's answer to "what did we actually take" — summed here rather than
// assumed, so the office can reconcile against its own payout report rather
// than against the estimate the price ladder was built from.
//
// ⚠ RETURNS NULL, NOT ZERO, WHEN THE ARRAY IS ABSENT OR EMPTY. Square does
// not always know the fee at the instant a payment completes — it can be
// calculated and reported on a LATER `payment.updated` redelivery for the
// same payment. Null is "not reported yet"; a real, reported $0 fee (a
// payment type Square does not charge for) is a different fact and must
// stay distinguishable from "we don't know."
export function squareFeeCents(payment) {
  const fees = Array.isArray(payment?.processing_fee) ? payment.processing_fee : [];
  if (!fees.length) return null;
  return fees.reduce((sum, f) => sum + (Number(f?.amount_money?.amount) || 0), 0);
}

// ── VERIFYING A WEBHOOK ACTUALLY CAME FROM SQUARE ────────────────────────────
// HMAC-SHA256 over (the exact notification URL Square was configured to
// call) + (the exact raw request body), base64-encoded, compared against
// the signature Square sends in a header. ⚠ Read the body as text FIRST —
// the signature is computed over the literal bytes sent, not over a
// re-serialized JSON.parse/stringify round trip, which can reorder keys or
// change whitespace and produce a signature that never matches.
//
// Without this, anyone who learns the webhook's address could POST a fake
// "payment completed" event and mark any application paid for free — this
// is the one thing in this file that is a real vulnerability if skipped or
// gotten wrong, not just an inconvenience.
export async function verifySquareSignature(env, notificationUrl, rawBody, providedSignature) {
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY || !providedSignature) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(notificationUrl + rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(expected, providedSignature);
}

// Same shape as admin/auth.js's password-comparison helper — a plain `===`
// on a signature short-circuits on the first differing byte, which leaks
// how much of a guess was right through response timing. The signature
// itself is not a secret a visitor is trying to brute-force one byte at a
// time in practice, but there is no cost to doing this correctly anyway.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
