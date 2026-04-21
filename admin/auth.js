// ── AUTH: sessions, passwords, permissions, audit log ────────

export const PERMISSIONS = {
  newsletter_edit:    'Newsletter — draft & edit',
  newsletter_approve: 'Newsletter — approve & send',
  news_edit:          'News & Events',
  ministries_edit:    'Ministries & Youth Pages',
  sermons_edit:       'Sermons',
  pages_edit:         'Pages',
  staff_edit:         'Staff profiles',
  settings_manage:    'Settings & Subscribers',
  gym_manage:         'Gym Rentals',
  users_manage:       'User management',
  audit_view:         'Audit log & rollback',
};

// All permissions — used to create the first admin account
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

// ── PASSWORD HASHING (PBKDF2-SHA256) ─────────────────────────

async function pbkdf2(password, salt, iterations = 100000) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations },
    key, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await pbkdf2(password, salt);
  return `pbkdf2:100000:${salt}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iters, salt, expected] = parts;
  const hash = await pbkdf2(password, salt, parseInt(iters, 10));
  return hash === expected;
}

// ── SESSION MANAGEMENT ────────────────────────────────────────

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function getTokenFromRequest(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(/tlc_session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

export async function createSession(db, user) {
  const token = randomHex(32);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    'INSERT INTO sessions (token, user_id, username, permissions, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(token, user.id, user.username, user.permissions || '[]', expiresAt, new Date().toISOString()).run();
  // Update last_login
  await db.prepare('UPDATE users SET last_login = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id).run();
  return token;
}

export async function getSession(db, request) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  const row = await db.prepare(
    `SELECT s.user_id, s.username, s.permissions, s.expires_at, u.active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).bind(token).first();
  if (!row || !row.active) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return { id: row.user_id, username: row.username, permissions: row.permissions, token };
}

export async function deleteSession(db, request) {
  const token = getTokenFromRequest(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export function sessionCookieHeader(token) {
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  return `tlc_session=${token}; Path=/; Expires=${exp}; HttpOnly; SameSite=Strict`;
}

export function clearSessionCookieHeader() {
  return 'tlc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict';
}

// ── PERMISSION HELPERS ────────────────────────────────────────

export function hasPermission(user, permission) {
  if (!user) return false;
  try {
    return JSON.parse(user.permissions || '[]').includes(permission);
  } catch { return false; }
}

// ── AUDIT LOG ────────────────────────────────────────────────

export async function logAudit(db, user, action, entityType, entityId, entityLabel, beforeState, afterState) {
  try {
    await db.prepare(
      `INSERT INTO audit_log
         (user_id, username, action, entity_type, entity_id, entity_label, before_state, after_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      user.id,
      user.username,
      action,
      entityType,
      String(entityId ?? ''),
      entityLabel || '',
      beforeState != null ? JSON.stringify(beforeState) : null,
      afterState  != null ? JSON.stringify(afterState)  : null,
      new Date().toISOString()
    ).run();
  } catch (_) { /* never let audit failure break the main action */ }
}
