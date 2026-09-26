import { createSession, sessionCookieHeader } from './auth.js';
import { verifyAccessJwt } from './payroll-contract-auth.js';

// Exchange a Cloudflare Access identity for the Website Admin session the rest
// of this application already understands. Access proves who the person is;
// the local users row remains the complete authorization decision.
export async function handleWebsiteAccessLogin(request, env, { verifyJwt = verifyAccessJwt } = {}) {
  const teamDomain = env.WEBSITE_ACCESS_TEAM_DOMAIN || '';
  const audience = env.WEBSITE_ACCESS_AUD || '';
  if (!teamDomain || !audience) {
    return new Response('Shared sign-in is not configured. Use the regular Website Admin sign-in.', { status: 503 });
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const email = await verifyJwt(token, { teamDomain, audience });
  if (!email) return new Response('Staff sign-in could not be verified.', { status: 401 });

  const user = await env.DB.prepare(
    'SELECT id, username, permissions FROM users WHERE LOWER(email) = ? AND active = 1 LIMIT 1'
  ).bind(email).first().catch(() => undefined);
  if (user === undefined) return new Response('Website Admin is temporarily unavailable.', { status: 503 });
  if (!user) {
    return new Response('Your staff identity is valid, but it is not assigned an active Website Admin account.', { status: 403 });
  }

  let sessionToken;
  try {
    sessionToken = await createSession(env.DB, user);
  } catch {
    return new Response('Website Admin could not create a session.', { status: 503 });
  }
  return new Response('', {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': sessionCookieHeader(sessionToken),
      'Cache-Control': 'no-store',
    },
  });
}
