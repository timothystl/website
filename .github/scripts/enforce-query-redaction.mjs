import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const workers = Object.freeze([
  'timothy-website', 'timothy-website-admin', 'timothy-links', 'timothy-connect',
  'timothy-finance-app', 'ministry-study', 'timothy-app-launcher',
]);

export async function enforceQueryRedaction({ account, token, fetchImpl = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(account || '') || !token) throw Error('Managed credentials unavailable');
  const results = [];
  for (const worker of workers) {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/script-settings`;
    async function api(method = 'GET', body) {
      const response = await fetchImpl(endpoint, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
      });
      const value = await response.json();
      if (!response.ok || !value.success) throw Error('Observability operation failed');
      return value.result;
    }
    try {
      const before = await api();
      if (typeof before.observability?.enabled !== 'boolean') throw Error('Observability settings unavailable');
      if (!before.observability.redact_query_string) {
        await api('PATCH', { observability: { ...before.observability, redact_query_string: true } });
      }
      const after = await api();
      if (after.observability?.redact_query_string !== true) throw Error('Redaction verification failed');
      results.push({ worker, verified: true, changed: before.observability.redact_query_string !== true });
    } catch {
      results.push({ worker, verified: false });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await enforceQueryRedaction({ account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
  const rendered = JSON.stringify({ completedAt: new Date().toISOString(), results }, null, 2);
  console.log(rendered);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n```json\n' + rendered + '\n```\n');
  if (results.some(result => !result.verified)) process.exitCode = 1;
}
