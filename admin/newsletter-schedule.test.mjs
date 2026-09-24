import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { scheduleNewsletter, cancelNewsletterSchedule } from './newsletter-schedule.js';
import { isSent } from './newsletter.js';
function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE newsletters(id INTEGER PRIMARY KEY, schedule_operation TEXT, schedule_state TEXT, sent_at TEXT, brevo_campaign_id TEXT, scheduled_send_at TEXT, scheduled_list_type TEXT); INSERT INTO newsletters(id) VALUES(1)`);
  const DB = { prepare(sql) { const stmt = (args=[]) => ({ bind: (...v) => stmt(v), async first() { return raw.prepare(sql).get(...args); }, async run() { return raw.prepare(sql).run(...args); } }); return stmt(); } };
  return { env: { DB, BREVO_API_KEY: 'test-only' }, raw, row: () => raw.prepare('SELECT * FROM newsletters').get() };
}
const options = { subject: 'Test fixture', htmlContent: '<p>Mock only</p>', listIds: [2], scheduledAt: '2099-10-01T15:00:00.000Z', listType: 'test' };
test('create draft, persist ID before scheduling, and reuse it when rescheduling', async () => {
  const x = setup(), calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, method: init.method, body });
    if (init.method === 'POST') { assert.equal(body.scheduledAt, undefined); return Response.json({ id: 12 }); }
    assert.equal(x.row().brevo_campaign_id, '12');
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal((await scheduleNewsletter(x.env, 1, options)).success, true);
    assert.equal((await scheduleNewsletter(x.env, 1, { ...options, scheduledAt: '2099-10-02T15:00:00.000Z' })).success, true);
    assert.deepEqual(calls.map(c => c.method), ['POST','PUT','PUT']);
    assert.equal(calls[1].url, calls[2].url);
    assert.equal(x.row().schedule_operation, null);
    assert.equal(isSent(x.row()), false);
  } finally { globalThis.fetch = original; }
});
test('concurrent schedules and cancellation cannot overtake an active request', async () => {
  const x=setup(), original=globalThis.fetch; let release, entered;
  const started = new Promise(r => entered=r), gate=new Promise(r => release=r); let creates=0;
  globalThis.fetch = async (url, init) => {
    if (init.method === 'POST') { creates++; entered(); await gate; return Response.json({ id: 20 }); }
    return new Response(null, { status: 204 });
  };
  try {
    const first = scheduleNewsletter(x.env,1,options); await started;
    assert.match((await scheduleNewsletter(x.env,1,options)).error, /busy/);
    assert.match((await cancelNewsletterSchedule(x.env,1)).error, /busy/);
    release(); assert.equal((await first).success,true); assert.equal(creates,1);
  } finally { release?.(); globalThis.fetch=original; }
});
test('ambiguous provider timeout retains ID; retry updates that same campaign; cancellation clears only after success', async () => {
  const x=setup(), original=globalThis.fetch; let creates=0, fail=true;
  globalThis.fetch=async (url, init) => {
    if(init.method==='POST'){creates++; return Response.json({id:30});}
    if(fail) throw new Error('response lost');
    return new Response(null,{status:204});
  };
  try {
    assert.ok((await scheduleNewsletter(x.env,1,options)).error);
    assert.equal(x.row().brevo_campaign_id,'30'); assert.equal(x.row().schedule_state,'pending');
    assert.ok((await cancelNewsletterSchedule(x.env,1)).error);
    assert.equal(x.row().brevo_campaign_id,'30');
    fail=false; assert.equal((await scheduleNewsletter(x.env,1,options)).success,true); assert.equal(creates,1);
    assert.equal((await cancelNewsletterSchedule(x.env,1)).success,true);
    assert.equal(x.row().brevo_campaign_id,null); assert.equal(x.row().scheduled_send_at,null);
  } finally {globalThis.fetch=original;}
});
test('provider rejection never creates a replacement and sent issues cannot be scheduled', async () => {
  const x=setup(), original=globalThis.fetch; let calls=0;
  x.raw.exec("UPDATE newsletters SET brevo_campaign_id='40', scheduled_send_at='2099-10-01T15:00:00Z'");
  globalThis.fetch=async (url,init)=>{calls++;assert.equal(init.method,'PUT');return new Response('rejected',{status:400});};
  try {
    assert.ok((await scheduleNewsletter(x.env,1,options)).error);
    assert.equal(x.row().brevo_campaign_id,'40');
    x.raw.exec("UPDATE newsletters SET sent_at='2026-09-01'");
    assert.ok((await scheduleNewsletter(x.env,1,options)).error);assert.equal(calls,1);
  } finally {globalThis.fetch=original;}
});
