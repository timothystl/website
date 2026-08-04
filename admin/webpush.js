// Web Push (RFC 8291 aes128gcm content coding + RFC 8292 VAPID), built directly
// against WebCrypto — Cloudflare Workers has no room for the `web-push` npm
// package (it shells out to Node's `crypto` module, which Workers doesn't have).
// The derivation below mirrors the widely-used `web-push`/`http_ece` reference
// implementation line for line (info strings, header layout, nonce math), so it
// talks to the same real push services those libraries do.
//
// Every push in this app is a single small JSON payload — well under the 4096
// byte record size — so this only ever emits ONE aes128gcm record. That is
// what lets `generateNonce` collapse to "the nonce is the derived nonce base,
// unchanged" (record counter 0 XORed with anything is itself) and the encrypt
// path skip the multi-record padding/looping the spec allows for.

const b64uToBytes = (s) => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const bytesToB64u = (bytes) => {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const concatBytes = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};

const textToBytes = (s) => new TextEncoder().encode(s);

// The one HKDF shape this whole module needs: HKDF-Expand(HKDF-Extract(salt,
// ikm), info, length) — WebCrypto's native "HKDF" algorithm does both steps in
// one call, which is why there's no separate extract()/expand() here.
async function hkdf(saltBytes, ikmBytes, infoBytes, lengthBytes) {
  const key = await crypto.subtle.importKey('raw', ikmBytes, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
    key, lengthBytes * 8
  );
  return new Uint8Array(bits);
}

// RFC 8291 §3.4: the shared secret is the ECDH result (salt=authSecret),
// mixed with both parties' raw public keys under the 'WebPush: info' label —
// this is what makes the auth secret bind the ciphertext to this one
// subscription rather than just to the ephemeral ECDH exchange.
async function deriveContentKeyMaterial(receiverPubKey, authSecret, ephemeralPrivateKey, ephemeralPubKeyBytes, contentSalt) {
  const receiverKey = await crypto.subtle.importKey(
    'raw', receiverPubKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverKey }, ephemeralPrivateKey, 256
  ));
  const info = concatBytes(textToBytes('WebPush: info\0'), receiverPubKey, ephemeralPubKeyBytes);
  const ikm = await hkdf(authSecret, ecdhSecret, info, 32);

  const cek = await hkdf(contentSalt, ikm, textToBytes('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(contentSalt, ikm, textToBytes('Content-Encoding: nonce\0'), 12);
  return { cek, nonce };
}

// Encrypts `payload` (a plain object, JSON-stringified) for one subscription
// and returns the raw aes128gcm body ready to POST as-is.
export async function encryptPayload(subscription, payloadObj) {
  const receiverPubKey = b64uToBytes(subscription.p256dh);
  const authSecret = b64uToBytes(subscription.auth);
  const plaintext = textToBytes(JSON.stringify(payloadObj));
  // header(21 or more) + tag(16) + pad-delimiter(1) must fit inside one 4096
  // record; push payloads here are short notification text, nowhere close.
  if (plaintext.length > 3000) throw new Error('push payload too large for a single record');

  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephemeralPubKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const contentSalt = crypto.getRandomValues(new Uint8Array(16));

  const { cek, nonce } = await deriveContentKeyMaterial(
    receiverPubKey, authSecret, ephemeral.privateKey, ephemeralPubKeyBytes, contentSalt
  );

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // Single, final record: plaintext followed by the aes128gcm pad delimiter
  // (0x02 = "last record, no padding"). No AAD, matching the spec.
  const recordPlaintext = concatBytes(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, recordPlaintext
  ));

  // aes128gcm header: salt(16) || record-size(4, BE) || keyid-length(1) || keyid.
  const rs = 4096;
  const header = new Uint8Array(21 + ephemeralPubKeyBytes.length);
  header.set(contentSalt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = ephemeralPubKeyBytes.length;
  header.set(ephemeralPubKeyBytes, 21);

  return concatBytes(header, ciphertext);
}

// RFC 8292: a short-lived JWT identifying this app server, signed with the
// VAPID private key. WebCrypto's ECDSA `sign` already returns the raw r||s
// signature JWS/ES256 wants — no DER-to-raw conversion needed, unlike most
// non-browser crypto libraries.
export async function buildVapidAuthHeader(endpoint, vapidPublicKeyB64u, vapidPrivateKeyB64u, subject) {
  const origin = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  };
  const signingInput = `${bytesToB64u(textToBytes(JSON.stringify(header)))}.${bytesToB64u(textToBytes(JSON.stringify(payload)))}`;

  const pubBytes = b64uToBytes(vapidPublicKeyB64u);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesToB64u(pubBytes.slice(1, 33)),
    y: bytesToB64u(pubBytes.slice(33, 65)),
    d: vapidPrivateKeyB64u,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, textToBytes(signingInput)));

  const jwt = `${signingInput}.${bytesToB64u(sig)}`;
  return `vapid t=${jwt}, k=${vapidPublicKeyB64u}`;
}

// Sends one push. Returns {ok:true} on success, {ok:false, gone:true} when the
// endpoint says the subscription no longer exists (404/410 — the caller should
// delete its row), or {ok:false, status} for anything else worth logging but
// not treating as a dead subscription.
export async function sendWebPush(env, subscription, payloadObj) {
  const vapidPublicKey = env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = env.VAPID_PRIVATE_KEY;
  if (!vapidPublicKey || !vapidPrivateKey) return { ok: false, status: 0, reason: 'vapid not configured' };

  const body = await encryptPayload(subscription, payloadObj);
  const auth = await buildVapidAuthHeader(subscription.endpoint, vapidPublicKey, vapidPrivateKey, 'mailto:office@timothystl.org');

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Urgency': 'normal',
      'Authorization': auth,
    },
    body,
  });
  if (res.ok) return { ok: true };
  if (res.status === 404 || res.status === 410) return { ok: false, gone: true, status: res.status };
  return { ok: false, status: res.status };
}

// Delivers one payload to every stored subscription, pruning any the push
// service reports as gone. Failures on individual sends never throw — a push
// is a courtesy notification, never something that should block the write
// (a held submission, a new hold request) that triggered it.
export async function pushToAllSubscribers(env, payloadObj) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  let rows;
  try {
    rows = (await env.DB.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions').all()).results || [];
  } catch (_) { return; }

  await Promise.all(rows.map(async (row) => {
    try {
      const result = await sendWebPush(env, row, payloadObj);
      if (!result.ok && result.gone) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
      }
    } catch (_) { /* one bad subscription must never block the rest */ }
  }));
}
