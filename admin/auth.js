// ── AUTH: sessions, passwords, permissions, audit log ────────

// The permission key is the contract between this screen and every route that
// gates on it, so the two must use the same word. The Users drawer prints each
// key in monospace beside its plain-language name for exactly that reason.
//
// Ordered as the drawer shows them: content first, then site structure, then
// people and money.
export const PERMISSIONS = {
  newsletter_edit:    'Write newsletters',
  newsletter_approve: 'Approve & send newsletters',
  news_edit:          'News & events',
  ministries_edit:    'Ministry pages',
  sermons_edit:       'Sermons',
  // The site editor: every page on the public site, and the menu. Distinct
  // from notices_edit (the banner bar that can sit on any page) so a ministry
  // leader can be given their own pages without also being handed the notice
  // bar on every page in the site.
  pages_edit:         'Website pages & menu',
  pages_edit_own:     'Website pages — only their own',
  notices_edit:       'Notice banners',
  staff_edit:         'Staff profiles',
  links_edit:         'Taps & links',
  settings_manage:    'Settings & subscribers',
  gym_manage:         'Gym rentals',
  giving_manage:      'Giving',
  payroll_manage:     'Payroll',
  // The Christmas Market vendor list. Its own key rather than a share of
  // giving_manage or news_edit, for the same reason payroll and giving each
  // got one: the coordinator is a volunteer who runs one event a year, and the
  // list holds seventy people's home addresses and phone numbers. She should
  // be able to have exactly that and nothing else.
  market_manage:      'Christmas Market vendors',
  // The /events index and /events/new — creating an event, and everything
  // about it that is not one specific event's own registrations. A single
  // event's coordinator is gated separately, on that event's own dynamic
  // 'event_<id>_manage' key (see eventCoordinatorPermissionKey() in
  // admin/events.js) — holding this does not itself open any one event's
  // roster, the same separation market_manage already keeps from the market
  // being merely reachable.
  events_manage:      'Events (create & manage)',
  // The Event Intake screen — the checklist over every Google booking, News
  // post and confirmed gym rental. Its own key rather than a share of
  // news_edit or gym_manage: it reads across all three (plus payment/renter
  // detail from Gym Rentals), so it should not silently widen to whoever
  // holds any one of them.
  intake_manage:      'Event intake',
  users_manage:       'User management',
  audit_view:         'Audit log & rollback',
};

// All permissions — used to create the first admin account
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

// ── PERMISSION RENAME (v3.0.0) ───────────────────────────────
// The redesign made the permission names match the sections they open. Two of
// them swapped meaning in the process, which is why this is a table rather
// than a rename in place:
//
//   pages_edit      used to mean the notice banners  → notices_edit
//   site_pages      used to mean the site editor     → pages_edit
//   site_pages_own                                   → pages_edit_own
//
// Because `pages_edit` exists on both sides with two different meanings, the
// migration must build a fresh list from the old one. Rewriting entries in
// place would turn an old notices editor into a full site editor the moment
// the two rules ran in the wrong order.
export const PERMISSION_RENAMES = {
  pages_edit: 'notices_edit',
  site_pages: 'pages_edit',
  site_pages_own: 'pages_edit_own',
};

// Pure so it can be tested without a database. Unknown keys are dropped rather
// than carried forward — a permission nobody checks is a permission nobody can
// reason about.
//
// ⚠ THIS IS NOT IDEMPOTENT, AND IT CANNOT BE. `pages_edit` means the notice
// banners on the way in and the site editor on the way out, so a row holding
// the new `pages_edit` is indistinguishable from a row holding the old one.
// Run it twice and you demote every site editor to notices-only.
//
// The caller must therefore gate it on a one-time marker that is independent
// of SCHEMA_VERSION (which re-runs the whole migration block on every bump).
// See PERM_RENAME_MARKER in tlc-admin-worker.js.
export function migratePermissionKeys(perms) {
  const list = Array.isArray(perms) ? perms : [];
  const out = [];
  for (const p of list) {
    const renamed = Object.prototype.hasOwnProperty.call(PERMISSION_RENAMES, p)
      ? PERMISSION_RENAMES[p]
      : (Object.prototype.hasOwnProperty.call(PERMISSIONS, p) ? p : null);
    if (renamed && !out.includes(renamed)) out.push(renamed);
  }
  return out;
}

// Preset bundles shown above the checkboxes in the Users drawer. They are
// shortcuts that tick a set of boxes — the checkboxes remain the truth, and a
// preset never grants anything the boxes do not then show.
export const PERMISSION_PRESETS = {
  'Office staff': ['newsletter_edit', 'news_edit', 'ministries_edit', 'sermons_edit', 'pages_edit', 'notices_edit', 'staff_edit', 'links_edit', 'settings_manage', 'events_manage', 'intake_manage'],
  'Ministry leader': ['pages_edit_own', 'ministries_edit', 'news_edit'],
  'Bookkeeper': ['gym_manage', 'giving_manage', 'payroll_manage'],
  // One event, once a year, and nothing else in the admin. Deliberately not
  // folded into Office staff: the market coordinator is a different person
  // from whoever writes the newsletter, and each of them being able to do the
  // other's job is not the point of a preset.
  'Market coordinator': ['market_manage'],
  'Full access': ALL_PERMISSIONS,
};

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

// Constant-time string comparison to prevent timing attacks on password verification.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iters, salt, expected] = parts;
  const hash = await pbkdf2(password, salt, parseInt(iters, 10));
  return timingSafeEqual(hash, expected);
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

// Signed out after this long without a request, however much of the seven-day
// window is left. A day is long enough that nobody is logged out mid-task or
// between one working day and the next, and short enough that a machine left
// unattended over a weekend is not still signed in on Monday.
export const IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;
// How stale the stamp has to be before it is worth a write.
const ACTIVITY_WRITE_MS = 5 * 60 * 1000;

export async function getSession(db, request) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  // Read permissions from the users table (not the session row) so permission
  // changes take effect on the next request instead of requiring re-login.
  const row = await db.prepare(
    `SELECT s.user_id, s.username, u.permissions AS permissions, s.expires_at, s.last_activity, u.active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).bind(token).first();
  if (!row || !row.active) return null;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  // ── [B5] IDLE TIMEOUT ────────────────────────────────────────
  // The absolute expiry is seven days, which is the right length for somebody
  // who uses this every week. On its own it means a session left open on a
  // shared office machine, or on a laptop somebody lends out, stays usable for
  // a week of doing nothing — and this admin can send email to the whole
  // congregation, read everyone's prayer requests and approve payroll.
  //
  // So a session also has to have been USED recently. Both limits apply: seven
  // days since sign-in, and IDLE_LIMIT since the last request.
  //
  // ⚠ A missing last_activity is treated as active, not as expired. The column
  // is added by migration, so every session that exists at that moment has
  // NULL in it — failing closed would sign out the whole office on deploy, for
  // a security improvement nobody asked to be logged out for.
  const last = row.last_activity ? new Date(row.last_activity).getTime() : NaN;
  if (Number.isFinite(last) && now - last > IDLE_LIMIT_MS) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  // Written back only once the stamp is meaningfully stale, so an ordinary
  // screen — which makes several requests — costs one write rather than one
  // per request. A minute of drift on a 24-hour limit is not worth the writes.
  if (!Number.isFinite(last) || now - last > ACTIVITY_WRITE_MS) {
    await db.prepare('UPDATE sessions SET last_activity = ? WHERE token = ?')
      .bind(new Date(now).toISOString(), token).run().catch(() => {});
  }
  return { id: row.user_id, username: row.username, permissions: row.permissions, token };
}

export async function deleteSession(db, request) {
  const token = getTokenFromRequest(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

// AC-1: `Secure` was missing. Without it the browser will send the session
// cookie over plain HTTP, so anything that can downgrade or intercept a
// request — a hostile network, an http:// link somebody clicks — gets a
// working admin session. The admin is HTTPS-only in practice, which is
// exactly why the flag costs nothing and closes the case where it is not.
//
// It is on the clear header too: a browser will refuse to overwrite a Secure
// cookie with a non-Secure one, so signing out has to match or the cookie
// survives the sign-out.
export function sessionCookieHeader(token) {
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
  return `tlc_session=${token}; Path=/; Expires=${exp}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookieHeader() {
  return 'tlc_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
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
      user?.id ?? null,
      user?.username ?? '',
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
