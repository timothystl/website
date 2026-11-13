import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loginThrottled, resetRequestThrottled, logAudit } from './auth.js';

function database() {
  const raw = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...values) => statement(sql, values),
    async run() { return { meta: raw.prepare(sql).run(...args) }; },
  });
  return { raw, prepare: sql => statement(sql), async batch(statements) {
    raw.exec('BEGIN');
    try {
      const results = statements.map(item => ({ success: true, results: raw.prepare(item.sql).all(...item.args) }));
      raw.exec('COMMIT');
      return results;
    } catch (error) { raw.exec('ROLLBACK'); throw error; }
  } };
}

test('concurrent attempts remain limited with no audit table or audit writes', async () => {
  const db = database();
  const attempts = await Promise.all(Array.from({ length: 40 }, async (_, index) => {
    await logAudit(db, null, 'login_failed', 'auth', '', 'synthetic-ip', null, null);
    return loginThrottled(db, 'synthetic-ip-' + index, 'synthetic-user');
  }));
  assert.equal(attempts.filter(throttled => !throttled).length, 10);
  assert.equal(await loginThrottled(db, 'another-ip', 'synthetic-user'), true);
  const buckets = db.raw.prepare('SELECT bucket,used FROM auth_attempt_limits').all();
  assert.ok(buckets.every(row => row.bucket.startsWith('sha256:') && row.used <= 10));
});

test('reset limit follows normalized email across rotating addresses', async () => {
  const db = database();
  const attempts = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    resetRequestThrottled(db, 'ip-' + index, index % 2 ? ' TEST@EXAMPLE.TEST ' : 'test@example.test')));
  assert.equal(attempts.filter(throttled => !throttled).length, 3);
});

test('IP limit also applies when usernames or reset addresses rotate', async () => {
  const db = database();
  for (let index = 0; index < 10; index++) assert.equal(await loginThrottled(db, 'one-ip', 'user-' + index), false);
  assert.equal(await loginThrottled(db, 'one-ip', 'new-user'), true);
  for (let index = 0; index < 5; index++) assert.equal(await resetRequestThrottled(db, 'one-ip', index + '@example.test'), false);
  assert.equal(await resetRequestThrottled(db, 'one-ip', 'another@example.test'), true);
});

test('attempts never extend the original deadline and expired windows can reopen', async () => {
  const db = database();
  await loginThrottled(db, 'ip', 'user');
  db.raw.prepare('UPDATE auth_attempt_limits SET expires_at=?').run(Date.now() + 60000);
  const before = db.raw.prepare('SELECT bucket,expires_at FROM auth_attempt_limits ORDER BY bucket').all();
  await loginThrottled(db, 'ip', 'user');
  assert.deepEqual(db.raw.prepare('SELECT bucket,expires_at FROM auth_attempt_limits ORDER BY bucket').all(), before);
  db.raw.exec('UPDATE auth_attempt_limits SET expires_at=0');
  assert.equal(await loginThrottled(db, 'ip', 'user'), false);
  assert.ok(db.raw.prepare('SELECT used FROM auth_attempt_limits').all().every(row => row.used === 1));
});

test('counter storage failures refuse login and reset even when audit is unrelated', async () => {
  const db = database();
  await loginThrottled(db, 'ip', 'user');
  db.raw.exec("CREATE TRIGGER reject_limit BEFORE UPDATE ON auth_attempt_limits BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.equal(await loginThrottled(db, 'ip', 'user'), true);
  const failed = { prepare() { throw Error('unavailable'); } };
  assert.equal(await loginThrottled(failed, 'ip', 'user'), true);
  assert.equal(await resetRequestThrottled(failed, 'ip', 'test@example.test'), true);
});
