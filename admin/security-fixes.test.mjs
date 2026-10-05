// Security remediation: reset tokens (RP-12), login throttling (RP-13),
// audit redaction (RP-04), delete audit (RP-09), pinned editor source (RP-10).
//   node admin/security-fixes.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  logAudit, redactAuditState, hashPassword, verifyPasswordOrDummy,
  loginThrottled, resetRequestThrottled, createPasswordReset, findPasswordReset, consumePasswordReset,
  LOGIN_FAIL_LIMIT, RESET_REQUEST_ADDRESS_LIMIT,
} from './auth.js';
import { DB_INIT_AUDIT_LOG, DB_INIT_PASSWORD_RESETS, TINYMCE_UPSTREAM } from './db.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };
const group = (n) => console.log('\n' + n);

function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { prepare: (sql) => stmt(sql) };
}
const fresh = () => {
  const raw = new DatabaseSync(':memory:');
  raw.prepare(DB_INIT_AUDIT_LOG).run();
  raw.prepare(DB_INIT_PASSWORD_RESETS).run();
  return { raw, db: d1(raw) };
};

group('RP-04 audit log never stores sensitive registration data');
{
  const { raw, db } = fresh();
  const row = { id: 1, contact_name: 'Pat', fields_json: '{"shirt":"M"}', sensitive_json: '{"allergy":"peanuts"}' };
  await logAudit(db, { id: 1, username: 'a' }, 'delete', 'event_registration', 1, 'Pat', row, null);
  const stored = raw.prepare('SELECT before_state FROM audit_log').get().before_state;
  ok(!stored.includes('peanuts'), 'allergy text is not in the audit row');
  ok(stored.includes('Pat'), 'the rest of the row is still recorded');
  ok(redactAuditState(row).sensitive_json === '[redacted]', 'redaction marks the field');
  ok(row.sensitive_json.includes('peanuts'), 'the caller’s object is not mutated');
}

group('RP-12 reset tokens');
{
  const { raw, db } = fresh();
  const t1 = await createPasswordReset(db, 7);
  const stored = raw.prepare('SELECT token FROM password_resets').get().token;
  ok(stored !== t1 && !stored.includes(t1), 'the token itself is not stored');
  ok(!!(await findPasswordReset(db, t1)), 'the emailed token validates');
  const t2 = await createPasswordReset(db, 7);
  ok(!(await findPasswordReset(db, t1)), 'an earlier token stops working when a new one is issued');
  ok(!!(await findPasswordReset(db, t2)), 'the newest token works');
  ok(!(await findPasswordReset(db, stored)), 'the stored value cannot be used as a token');
  await consumePasswordReset(db, t2);
  ok(!(await findPasswordReset(db, t2)), 'a used token is refused');
  const t3 = await createPasswordReset(db, 7);
  raw.prepare("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  ok(!(await findPasswordReset(db, t3)), 'an expired token is refused');
}

group('RP-12 reset request throttling');
{
  const { db } = fresh();
  for (let i = 0; i < RESET_REQUEST_ADDRESS_LIMIT; i++) {
    ok(!(await resetRequestThrottled(db, '1.1.1.' + i, 'a@x.org')), 'allowed before the limit');
    await logAudit(db, { id: null, username: '' }, 'reset_requested', 'auth', 'a@x.org', '1.1.1.' + i, null, null);
  }
  ok(await resetRequestThrottled(db, '9.9.9.9', 'a@x.org'), 'one address is limited even from fresh IPs');
  ok(!(await resetRequestThrottled(db, '9.9.9.9', 'b@x.org')), 'another address is unaffected');
}

group('RP-13 login throttling and timing');
{
  const { db } = fresh();
  for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) {
    await logAudit(db, { id: null, username: 'pastor' }, 'login_failed', 'auth', '', '2.2.2.' + i, null, null);
  }
  ok(await loginThrottled(db, '8.8.8.8', 'pastor'), 'a username is locked out across rotating IPs');
  ok(!(await loginThrottled(db, '8.8.8.8', 'someone-else')), 'other usernames are not');
  for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) {
    await logAudit(db, { id: null, username: 'u' + i }, 'login_failed', 'auth', '', '3.3.3.3', null, null);
  }
  ok(await loginThrottled(db, '3.3.3.3', 'fresh'), 'the per-address limit still applies');

  const real = await hashPassword('correct horse');
  const time = async (stored) => { const t = performance.now(); await verifyPasswordOrDummy('wrong guess', stored); return performance.now() - t; };
  await time(real); // warm up
  const known = [], unknown = [];
  for (let i = 0; i < 5; i++) { known.push(await time(real)); unknown.push(await time(null)); }
  const med = (a) => a.sort((x, y) => x - y)[2];
  ok(med(unknown) > med(known) * 0.5, `unknown username does real hashing work (${med(unknown).toFixed(0)}ms vs ${med(known).toFixed(0)}ms)`);
  ok(!(await verifyPasswordOrDummy('anything', null)), 'a missing account never verifies');
  ok(await verifyPasswordOrDummy('correct horse', real), 'a real account still verifies');
}

group('RP-10 editor files come from a pinned commit');
{
  ok(/\/[0-9a-f]{40}\/admin\/vendor\/tinymce\/$/.test(TINYMCE_UPSTREAM), 'upstream URL names a 40-character commit');
  ok(!/\/(main|master|HEAD)\//.test(TINYMCE_UPSTREAM), 'upstream URL is not a branch');
  const worker = readFileSync(new URL('../website-admin-worker.js', import.meta.url), 'utf8');
  ok(!worker.includes('raw.githubusercontent.com/timothystl/website/main'), 'the worker no longer fetches from main');
}

group('RP-09 permanent deletes leave an audit entry');
{
  const gym = readFileSync(new URL('./gym.js', import.meta.url), 'utf8');
  ok(/'delete', 'gym_group'/.test(gym), 'deleting a rental group is audited');
  ok(/'delete', 'gym_invoice'/.test(gym), 'deleting an invoice is audited');
  ok(/const \{ access_token, \.\.\.rest \}/.test(gym), 'the group’s access token is kept out of the audit copy');
}

group('RP-01 push alerts do not quote messages or name people');
{
  const worker = readFileSync(new URL('../website-admin-worker.js', import.meta.url), 'utf8');
  ok(!/message\.slice\(0, 150\)/.test(worker), 'no push body is built from message text');
  ok(!/title: 'New prayer request from/.test(worker), 'prayer push does not name the person');
  ok(!/title: 'New message from ' \+/.test(worker), 'contact push does not name the person');
  ok(!/value\.contact_name \|\| value\.contact_email \|\| 'Someone'/.test(worker), 'event sign-up push does not name the person');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
