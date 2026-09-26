import assert from 'node:assert/strict';
import { handleWebsiteAccessLogin } from '../admin/shared-staff-login.js';

function envWithUser(user) {
  const statements = [];
  const DB = {
    prepare(sql) {
      const statement = {
        bind(...values) { statement.values = values; return statement; },
        async first() { statements.push({ sql, values: statement.values }); return user; },
        async run() { statements.push({ sql, values: statement.values }); return { success: true }; },
      };
      return statement;
    },
  };
  return {
    env: {
      DB,
      WEBSITE_ACCESS_TEAM_DOMAIN: 'timothystl.cloudflareaccess.com',
      WEBSITE_ACCESS_AUD: 'website-audience',
    },
    statements,
  };
}

const request = (token = 'signed.jwt') => new Request('https://admin.timothystl.org/access-login', {
  headers: { 'Cf-Access-Jwt-Assertion': token },
});

{
  const { env, statements } = envWithUser({ id: 9, username: 'editor', permissions: '["news_edit"]' });
  const calls = [];
  const response = await handleWebsiteAccessLogin(request(), env, {
    verifyJwt: async (...args) => { calls.push(args); return 'editor@timothystl.org'; },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/');
  assert.match(response.headers.get('Set-Cookie'), /^tlc_session=[a-f0-9]{64}; Path=\/; Expires=.*; HttpOnly; Secure; SameSite=Strict$/);
  assert.deepEqual(calls[0], ['signed.jwt', {
    teamDomain: 'timothystl.cloudflareaccess.com',
    audience: 'website-audience',
  }]);
  assert.deepEqual(statements[0].values, ['editor@timothystl.org']);
  assert.ok(statements.some(({ sql, values }) => sql.startsWith('INSERT INTO sessions') && values[1] === 9));
  assert.ok(statements.some(({ sql, values }) => sql.startsWith('UPDATE users SET last_login') && values[1] === 9));
}

{
  const { env } = envWithUser(null);
  const response = await handleWebsiteAccessLogin(request(), env, {
    verifyJwt: async () => 'unassigned@timothystl.org',
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.match(await response.text(), /not assigned an active Website Admin account/);
}

{
  const { env } = envWithUser(null);
  assert.equal((await handleWebsiteAccessLogin(request('bad'), env, { verifyJwt: async () => null })).status, 401);
  assert.equal((await handleWebsiteAccessLogin(request(), { ...env, WEBSITE_ACCESS_AUD: '' }, { verifyJwt: async () => { throw new Error('must not run'); } })).status, 503);
  const broken = {
    ...env,
    DB: { prepare: () => ({ bind() { return this; }, first: async () => { throw new Error('offline'); } }) },
  };
  assert.equal((await handleWebsiteAccessLogin(request(), broken, { verifyJwt: async () => 'editor@timothystl.org' })).status, 503);
}

console.log('shared staff login: 3 passed');
