// admin/webpush.js encrypts by hand against RFC 8291 (aes128gcm) — there is no
// real push service to send a message through in a test run, so what this
// file checks instead is that a message encrypted by our code can be
// decrypted back to the same plaintext by an INDEPENDENT implementation of
// the same spec, built on Node's `crypto` module rather than WebCrypto. If a
// byte in the header layout, the HKDF info strings, or the nonce were wrong,
// this round-trip would not agree with itself.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptPayload } from './webpush.js';

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }

// Simulates what a browser's PushManager.subscribe() hands back.
function fakeSubscription() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    p256dh: b64u(ecdh.getPublicKey()),
    auth: b64u(crypto.randomBytes(16)),
    _privateKey: ecdh, // kept only so the test's own decrypt can use it
  };
}

// Independent decrypt, mirroring the reference `http_ece` derivation
// (RFC 8291 §3.4 / RFC 8188 §2.1) but via Node's crypto primitives instead
// of WebCrypto — a deliberately different code path from admin/webpush.js.
function decryptAes128Gcm(body, sub, senderPubKeyExpected) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const keyid = body.subarray(21, 21 + idlen); // the sender's ephemeral public key
  const ciphertext = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  assert.deepEqual(keyid, senderPubKeyExpected);

  const receiverPubKey = Buffer.from(sub.p256dh, 'base64url');
  const authSecret = Buffer.from(sub.auth, 'base64url');
  const ecdhSecret = sub._privateKey.computeSecret(keyid);

  const info = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPubKey, keyid]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdhSecret, authSecret, info, 32));

  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const enc = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2); // the "last record" pad delimiter
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

async function run() {
  const sub = fakeSubscription();
  const payload = { title: 'Filtered Mail', body: 'A message was held for review.', tag: 'held-mail' };

  const body = new Uint8Array(await encryptPayload(sub, payload));
  const idlen = body[20];
  const senderPubKey = Buffer.from(body.subarray(21, 21 + idlen));

  const decrypted = decryptAes128Gcm(Buffer.from(body), sub, senderPubKey);
  assert.deepEqual(JSON.parse(decrypted), payload);

  // Header shape sanity: salt(16) + rs(4) + idlen(1) + keyid(65, uncompressed P-256).
  assert.equal(idlen, 65);
  assert.equal(senderPubKey[0], 0x04);

  console.log('webpush.test.mjs: aes128gcm round-trip OK');
}

run().catch((err) => { console.error(err); process.exit(1); });
