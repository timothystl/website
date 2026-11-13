import { appendFileSync } from 'node:fs';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw Error('Required managed credentials are unavailable');
async function api(path, body) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + (path.startsWith('/d1/') ? process.env.CLOUDFLARE_D1_API_TOKEN : token), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw Error('Metadata API unavailable, HTTP ' + response.status);
  return result.result;
}
const configuration = await import('node:fs').then(fs => fs.readFileSync('wrangler.toml', 'utf8'));
const databaseMatch = configuration.match(/database_id\s*=\s*"([a-f0-9-]+)"/);
if (!databaseMatch) throw Error('Website database configuration missing');
const schema = await api('/d1/database/' + databaseMatch[1] + '/query', {
  sql: "SELECT type,name,sql FROM sqlite_master WHERE name='auth_attempt_limits' OR tbl_name='auth_attempt_limits'",
});
const objects = schema.flatMap(result => result.results || []);
const table = objects.find(item => item.name === 'auth_attempt_limits');
if (table && !/bucket TEXT PRIMARY KEY,\s*used INTEGER NOT NULL,\s*expires_at INTEGER NOT NULL/i.test(table.sql)) {
  throw Error('Authentication counter schema conflicts with reviewed definition');
}
const report = { checkedAt: new Date().toISOString(), authCounterTablePresent: !!table, schemaCompatible: true, workers: [] };
for (const worker of ['timothy-website','timothy-website-admin','timothy-links','timothy-connect','timothy-finance-app','ministry-study','timothy-app-launcher','timothy-mymdo-app']) {
  try {
    const settings = await api('/workers/scripts/' + worker + '/settings');
    const bindings = settings.bindings || [];
    const flag = name => {
      const binding = bindings.find(item => item.name === name);
      if (!binding) return 'absent';
      if (binding.type !== 'plain_text') return 'configured-but-not-readable';
      return String(binding.text) === '1' ? 'enabled' : 'not-enabled';
    };
    report.workers.push({ worker, inspected: true,
      developmentBypass: flag('STUDY_DEV_NO_AUTH'),
      liveGiving: flag('STAX_LIVE'),
      staxApiConfigured: bindings.some(item => item.name === 'STAX_SANDBOX_API_KEY'),
      staxWebTokenConfigured: bindings.some(item => item.name === 'STAX_SANDBOX_WEB_PAYMENTS_TOKEN'),
      statefulBindings: bindings.filter(item => ['d1','r2_bucket','kv_namespace','durable_object_namespace'].includes(item.type)).map(item => ({name:item.name,type:item.type})),
      observability: { enabled:settings.observability?.enabled ?? null, redactQueryString:settings.observability?.redact_query_string ?? null, invocationLogs:settings.observability?.logs?.invocation_logs ?? null, logpush:settings.logpush ?? null },
    });
  } catch {
    report.workers.push({worker,inspected:false});
  }
}
const rendered = JSON.stringify(report,null,2);
console.log(rendered);
appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n```json\n' + rendered + '\n```\n');
