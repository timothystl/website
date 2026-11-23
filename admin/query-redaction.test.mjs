import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceQueryRedaction, workers } from '../.github/scripts/enforce-query-redaction.mjs';

test('redaction preserves current observability settings and omits the separately reviewed childcare app', async () => {
  const states = new Map(workers.map(worker => [worker, { enabled: true, head_sampling_rate: 0.25, logs: { enabled: true, invocation_logs: true }, redact_query_string: false }]));
  const calls = [];
  const results = await enforceQueryRedaction({ account: 'a'.repeat(32), token: 'synthetic-token', fetchImpl: async (url, init) => {
    const worker = url.split('/').at(-2);
    assert.ok(workers.includes(worker));
    assert.ok(!url.includes('timothy-mymdo-app'));
    calls.push(init.method);
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      assert.equal(body.observability.head_sampling_rate, 0.25);
      assert.deepEqual(body.observability.logs, { enabled: true, invocation_logs: true });
      states.set(worker, body.observability);
    }
    return Response.json({ success: true, result: { observability: states.get(worker) } });
  } });
  assert.equal(results.length, 7);
  assert.ok(results.every(result => result.verified && result.changed));
  assert.equal(calls.filter(method => method === 'PATCH').length, 7);
  assert.ok(!JSON.stringify(results).includes('synthetic-token'));
});

test('a failed setting is reported without provider payload or credentials and other workers still verify', async () => {
  const results = await enforceQueryRedaction({ account: 'a'.repeat(32), token: 'synthetic-token', fetchImpl: async url => {
    if (url.includes('/timothy-links/')) return Response.json({success:false,error:'private provider detail'}, {status:403});
    return Response.json({success:true,result:{observability:{enabled:true,redact_query_string:true}}});
  } });
  assert.equal(results.filter(result => result.verified).length, 6);
  assert.equal(results.filter(result => !result.verified).length, 1);
  assert.ok(!JSON.stringify(results).includes('private provider detail'));
});
