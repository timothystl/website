// ── PUBLIC FORM INTAKE: screening, storage, and the Filtered Mail review page ──
//
// Everything that arrives through the public contact / prayer / subscribe forms
// passes through screenSubmission() before an email is sent. The scoring rules
// themselves live in admin/spam.js (pure, unit-tested); this module is the part
// that touches D1, Turnstile and Brevo.
//
// Nothing is ever discarded. A held message is stored in full and listed at
// /filtered, where one click releases it — sending the email that was withheld
// and forwarding it on to ChMS exactly as if it had come through cleanly.

import { scoreSubmission, signFormToken, verifyFormToken } from './spam.js';
import { html, sidebarShell, escapeHtml, formatDate } from './helpers.js';
import { hasPermission, logAudit } from './auth.js';
import { sendTransactionalEmail } from './email.js';

export const OFFICE_EMAIL = 'dinger@timothystl.org';

// The signing key for form tokens. Self-provisioning: generated on first use
// and kept in site_settings, so there is no secret for staff to configure and
// nothing to go stale. Cached per isolate — this is read on every public form
// GET and POST.
// Keyed on `env` rather than a bare module variable: an isolate only ever sees
// one env in production, but keying it this way means the cache can't outlive
// the bindings it was read through.
const SECRET_CACHE = new WeakMap();
export async function formTokenSecret(env) {
  if (SECRET_CACHE.has(env)) return SECRET_CACHE.get(env);
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key='form_token_secret'").first();
    if (row?.value) { SECRET_CACHE.set(env, row.value); return row.value; }
    const generated = crypto.randomUUID() + crypto.randomUUID();
    await env.DB.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('form_token_secret', ?)").bind(generated).run();
    SECRET_CACHE.set(env, generated);
    return generated;
  } catch (_) {
    // D1 unreachable — verifyFormToken treats a missing key as 'unavailable',
    // which costs a visitor nothing. The forms keep working.
    return null;
  }
}

// What the public site asks for when a form page loads. The token is what the
// browser sends back with the submission; the site key (blank unless Turnstile
// has been set up) tells the page whether to draw a challenge widget.
// Every visitor to the site hits this once, so the site-key lookup is cached
// per isolate for a minute rather than costing a D1 read per page view. The
// token itself is always minted fresh — it carries its issue time.
const SITE_KEY_CACHE = new WeakMap();
export async function formConfig(env) {
  const secret = await formTokenSecret(env);
  let cached = SITE_KEY_CACHE.get(env);
  if (!cached || Date.now() - cached.at > 60_000) {
    let siteKey = '';
    try {
      const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key='turnstile_site_key'").first();
      siteKey = row?.value || '';
    } catch (_) {}
    cached = { siteKey, at: Date.now() };
    SITE_KEY_CACHE.set(env, cached);
  }
  return {
    token: secret ? await signFormToken(secret) : '',
    turnstile_site_key: cached.siteKey,
  };
}

// 'off' unless TURNSTILE_SECRET_KEY is set on the Worker. A network failure
// talking to Cloudflare reads as 'off' rather than 'failed' — an outage at
// their end must not start holding real messages.
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return 'off';
  if (!token) return 'missing';
  try {
    const body = new FormData();
    body.append('secret', env.TURNSTILE_SECRET_KEY);
    body.append('response', token);
    if (ip) body.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    if (!res.ok) return 'off';
    const data = await res.json();
    return data.success ? 'ok' : 'failed';
  } catch (_) {
    return 'off';
  }
}

/**
 * Screen one public submission and record it.
 *
 * @returns {{held:boolean, suspect:boolean, score:number, reasons:string[], id:number|null}}
 */
export async function screenSubmission(env, request, sub) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const secret = await formTokenSecret(env);
  const tokenState = await verifyFormToken(sub.token, secret);
  const turnstile = await verifyTurnstile(env, sub.turnstileToken, ip);

  let recentFromIp = 0;
  if (ip) {
    try {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM form_submissions WHERE ip = ? AND created_at >= datetime('now','-1 hour')"
      ).bind(ip).first();
      recentFromIp = (row?.n || 0) + 1; // counting this one
    } catch (_) {}
  }

  const result = scoreSubmission(
    { name: sub.name, email: sub.email, message: sub.message, honeypot: sub.honeypot },
    { tokenState, turnstile, recentFromIp }
  );
  const held = result.verdict === 'spam';
  const suspect = result.verdict === 'suspect';

  // A held message is stored in full — it has to be readable to be released.
  // A delivered one is not: the email in the office inbox is the record, and
  // the only reason to keep a row at all is the per-address flood count. So
  // the content of everyone's prayer requests never lands in this table.
  let id = null;
  try {
    const ins = await env.DB.prepare(
      `INSERT INTO form_submissions (kind, name, email, message, ip, user_agent, score, reasons, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      sub.kind,
      held ? (sub.name || null) : null,
      held ? (sub.email || null) : null,
      held ? (sub.message || null) : null,
      ip || null, (request.headers.get('User-Agent') || '').slice(0, 300) || null,
      result.score, JSON.stringify(result.reasons),
      held ? 'held' : 'delivered'
    ).run();
    id = ins?.meta?.last_row_id ?? null;
  } catch (_) { /* logging must never block a real message */ }

  return { held, suspect, score: result.score, reasons: result.reasons, id };
}

// Delivered rows exist only to power the per-address rate limit and to give
// staff a little context on the Filtered page; they are pruned aggressively so
// the table never becomes a shadow archive of everyone's prayer requests. Held
// rows stay until someone releases or deletes them.
export async function pruneSubmissions(env) {
  try {
    await env.DB.prepare("DELETE FROM form_submissions WHERE status='delivered' AND created_at < datetime('now','-30 days')").run();
    await env.DB.prepare("DELETE FROM form_submissions WHERE status='released' AND created_at < datetime('now','-90 days')").run();
  } catch (_) {}
}

export async function heldCount(env) {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM form_submissions WHERE status='held'").first();
    return row?.n || 0;
  } catch (_) { return 0; }
}

// The ChMS hand-off, shared by the live contact/prayer routes and by releasing
// a held message later. Fire-and-forget: ChMS being down must not fail the
// visitor's submission.
export function forwardToChms(env, ctx, kind, payload) {
  const url = kind === 'prayer'
    ? 'https://serve.timothystl.org/api/intake/prayer'
    : 'https://serve.timothystl.org/api/intake/connect-card';
  const body = kind === 'prayer'
    ? { ...payload, source: 'website-prayer', is_urgent: 0 }
    : { ...payload, source: 'website-contact' };
  const job = (async () => {
    try {
      const req = new Request(url, {
        method: 'POST',
        headers: { 'X-Intake-Key': env.CHMS_INTAKE_API_KEY || '', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const res = env.VOLUNTEER_WORKER ? await env.VOLUNTEER_WORKER.fetch(req) : await fetch(req);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`ChMS intake forward failed (${kind}): HTTP ${res.status} — ${text}`);
      }
    } catch (e) {
      console.error(`ChMS intake forward failed (${kind}):`, e?.message);
    }
  })();
  if (ctx?.waitUntil) ctx.waitUntil(job); else return job;
}

// The email the office gets. Shared so a released message reads exactly like
// one that came through cleanly, apart from the note at the top.
export function officeEmailHtml(kind, { name, email, message }, releasedNote = '') {
  const label = kind === 'prayer' ? 'Prayer request' : 'Message';
  return `${releasedNote}<p><strong>Name:</strong> ${name ? escapeHtml(name) : kind === 'prayer' ? '(anonymous)' : ''}</p>`
    + `<p><strong>Email:</strong> ${email ? escapeHtml(email) : '(not provided)'}</p>`
    + `<p><strong>${label}:</strong></p><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;
}

export function officeSubject(kind, name, suspect) {
  const base = kind === 'prayer'
    ? `Prayer Request — ${name || 'Anonymous'}`
    : `Contact Form — ${name}`;
  return suspect ? `[likely spam] ${base}` : base;
}

// ── FILTERED MAIL ADMIN PAGE ─────────────────────────────────
// Returns a Response for the routes it owns, or null so the caller's route
// chain carries on.
export async function handleFilteredRoutes(request, env, path, method, currentUser, ctx) {
  if (!path.startsWith('/filtered')) return null;
  if (!hasPermission(currentUser, 'settings_manage')) {
    return new Response('Access denied.', { status: 403 });
  }

  if (path === '/filtered' && method === 'GET') {
    await pruneSubmissions(env);
    const url = new URL(request.url);
    const msg = url.searchParams.get('msg') || '';
    const rows = await env.DB.prepare(
      `SELECT id, kind, name, email, message, score, reasons, status, created_at, released_at, released_by
       FROM form_submissions WHERE status IN ('held','released')
       ORDER BY CASE status WHEN 'held' THEN 0 ELSE 1 END, created_at DESC LIMIT 100`
    ).all();
    const deliveredRow = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM form_submissions WHERE status='delivered' AND created_at >= datetime('now','-30 days')"
    ).first();

    const held = rows.results.filter(r => r.status === 'held');
    const released = rows.results.filter(r => r.status === 'released');

    const card = (r) => {
      let reasons = [];
      try { reasons = JSON.parse(r.reasons || '[]'); } catch (_) {}
      const kindLabel = r.kind === 'prayer' ? 'Prayer form' : r.kind === 'subscribe' ? 'Newsletter signup' : 'Contact form';
      const isHeld = r.status === 'held';
      return `
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:12px;align-items:baseline;flex-wrap:wrap;">
    <div style="font-family:var(--serif);font-size:16px;color:var(--charcoal);">${r.name ? escapeHtml(r.name) : '(no name)'}</div>
    <div style="font-size:13px;color:var(--gray);">${r.email ? escapeHtml(r.email) : '(no email)'}</div>
    <div style="flex:1;"></div>
    <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--linen);color:var(--gray);">${kindLabel}</span>
    <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:${isHeld ? '#f5e6e6' : '#e6f5ea'};color:${isHeld ? '#B85C3A' : '#2E7A4A'};">${isHeld ? 'held' : 'released'}</span>
  </div>
  <div style="font-size:12px;color:var(--gray);margin-top:4px;">${r.created_at ? formatDate(String(r.created_at).slice(0, 10)) : ''}${r.released_by ? ` · released by ${escapeHtml(r.released_by)}` : ''}</div>
  <div style="white-space:pre-wrap;font-size:14px;color:var(--charcoal);margin:12px 0;padding:12px;background:var(--linen);border-radius:8px;max-height:260px;overflow:auto;">${escapeHtml(r.message || '')}</div>
  <div style="font-size:12px;color:var(--gray);">Why it was held: ${reasons.length ? escapeHtml(reasons.join(' · ')) : 'no reason recorded'} <span style="opacity:.7;">(score ${r.score})</span></div>
  ${isHeld ? `
  <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
    <form method="POST" action="/filtered/release" onsubmit="return confirm('Send this message through to the office inbox?');" style="display:inline;">
      <input type="hidden" name="id" value="${r.id}">
      <button type="submit" class="btn btn-primary btn-sm">This is real — send it to me</button>
    </form>
    <form method="POST" action="/filtered/delete" onsubmit="return confirm('Delete this message for good?');" style="display:inline;">
      <input type="hidden" name="id" value="${r.id}">
      <button type="submit" class="btn btn-sm" style="background:var(--mist);color:var(--steel);">Delete</button>
    </form>
  </div>` : ''}
</div>`;
    };

    let turnstileKey = '';
    try {
      const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key='turnstile_site_key'").first();
      turnstileKey = row?.value || '';
    } catch (_) {}

    const notice = msg === 'released' ? `<div class="alert alert-success">Sent through to ${escapeHtml(OFFICE_EMAIL)}.</div>`
      : msg === 'turnstile-saved' ? `<div class="alert alert-success">Saved. The forms will start using it right away.</div>`
      : msg === 'deleted' ? `<div class="alert alert-success">Message deleted.</div>`
      : msg === 'release-failed' ? `<div class="alert alert-error">Could not send that message — check the Brevo key and try again.</div>`
      : '';

    return html(`
${sidebarShell('filtered', currentUser)}
<div class="wrap">
  <div class="page-title">Filtered Mail</div>
  <div class="page-sub">Messages the website held back as spam. Nothing here was emailed to you — release anything that turns out to be real.</div>
  ${notice}
  <div class="card" style="margin-bottom:20px;display:flex;gap:32px;flex-wrap:wrap;">
    <div>
      <div style="font-family:var(--serif);font-size:36px;color:${held.length ? '#B85C3A' : 'var(--steel)'};font-weight:700;">${held.length}</div>
      <div style="font-size:13px;color:var(--gray);margin-top:4px;">Waiting for review</div>
    </div>
    <div>
      <div style="font-family:var(--serif);font-size:36px;color:var(--sage);font-weight:700;">${deliveredRow?.n || 0}</div>
      <div style="font-size:13px;color:var(--gray);margin-top:4px;">Delivered to you (last 30 days)</div>
    </div>
  </div>
  ${held.length ? held.map(card).join('') : `<div class="card" style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">Nothing held right now. 🎉</div>`}
  ${released.length ? `<div class="page-title" style="font-size:18px;margin:28px 0 12px;">Released</div>${released.map(card).join('')}` : ''}
  <div class="card" style="margin-top:28px;">
    <div class="card-title">Extra protection (optional)</div>
    <div style="font-size:13px;color:var(--gray);line-height:1.6;margin-bottom:14px;">
      If spam still gets through, Cloudflare Turnstile adds a quiet "are you human?" check to the
      contact and prayer forms — most visitors never see anything but a tick. Create a widget at
      <a href="https://dash.cloudflare.com/?to=/:account/turnstile" target="_blank" style="color:var(--steel);">dash.cloudflare.com → Turnstile</a>
      for <strong>timothystl.org</strong>, paste the <em>site key</em> below, and give the
      <em>secret key</em> to whoever maintains the site (it is set on the worker as
      <code>TURNSTILE_SECRET_KEY</code>). Until both halves are in place nothing changes on the site.
    </div>
    <form method="POST" action="/filtered/turnstile" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <input type="text" name="site_key" value="${escapeHtml(turnstileKey)}" placeholder="0x4AAAAAAA…" class="form-input" style="flex:1;min-width:260px;">
      <button type="submit" class="btn btn-primary btn-sm">Save</button>
    </form>
  </div>
  <div style="font-size:12px;color:var(--gray);margin-top:24px;line-height:1.6;">
    Held messages stay here until you release or delete them. Released ones are cleared after 90 days,
    and the record of delivered messages after 30 — the email in your inbox is the copy that keeps.
  </div>
</div>`, 'Filtered Mail');
  }

  if (path === '/filtered/release' && method === 'POST') {
    const form = await request.formData();
    const id = parseInt(form.get('id') || '0');
    const row = await env.DB.prepare("SELECT * FROM form_submissions WHERE id = ? AND status='held'").bind(id).first();
    if (!row) return new Response('', { status: 302, headers: { Location: '/filtered' } });

    if (row.kind === 'subscribe') {
      // Nothing to email — finish the signup the filter interrupted, on both
      // the Brevo list (which is the one that actually receives newsletters)
      // and the local record behind the Subscribers tab.
      if (env.BREVO_API_KEY) {
        try {
          await fetch('https://api.brevo.com/v3/contacts', {
            method: 'POST',
            headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: (row.email || '').toLowerCase(),
              attributes: { FIRSTNAME: row.name || '' },
              listIds: [parseInt(env.BREVO_LIST_ID || '2')],
              updateEnabled: true,
            }),
          });
        } catch (e) { console.error('Brevo add on release failed:', e?.message); }
      }
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email, name) VALUES (?, ?)')
          .bind((row.email || '').toLowerCase(), row.name || null).run();
      } catch (_) {}
    } else {
      const note = `<p style="font-size:13px;color:#777;">Released from the website spam filter by ${escapeHtml(currentUser?.username || 'an admin')}.</p>`;
      const result = await sendTransactionalEmail(env, {
        subject: officeSubject(row.kind, row.name, false),
        htmlContent: officeEmailHtml(row.kind, row, note),
        toEmails: [OFFICE_EMAIL],
        replyTo: row.email ? { email: row.email, name: row.name || '' } : undefined,
      });
      if (result.error) {
        return new Response('', { status: 302, headers: { Location: '/filtered?msg=release-failed' } });
      }
      // Awaited rather than fired off: forwardToChms only detaches when it has
      // a real ExecutionContext to hand the work to, and a release happening
      // outside a request context would otherwise be dropped mid-flight.
      await forwardToChms(env, ctx, row.kind, { name: row.name || '', email: row.email || '', message: row.message || '' });
    }

    await env.DB.prepare("UPDATE form_submissions SET status='released', released_at=CURRENT_TIMESTAMP, released_by=? WHERE id=?")
      .bind(currentUser?.username || null, id).run();
    await logAudit(env.DB, currentUser, 'release', 'form_submission', String(id), `${row.kind} from ${row.name || row.email || 'unknown'}`);
    return new Response('', { status: 302, headers: { Location: '/filtered?msg=released' } });
  }

  if (path === '/filtered/turnstile' && method === 'POST') {
    const form = await request.formData();
    const key = (form.get('site_key') || '').trim();
    await env.DB.prepare("INSERT OR REPLACE INTO site_settings (key, value, label, hint) VALUES ('turnstile_site_key', ?, 'Turnstile site key', 'Public half of the Cloudflare Turnstile widget used on the contact and prayer forms')")
      .bind(key).run();
    await logAudit(env.DB, currentUser, 'update', 'setting', 'turnstile_site_key', key ? 'Turnstile enabled' : 'Turnstile cleared');
    return new Response('', { status: 302, headers: { Location: '/filtered?msg=turnstile-saved' } });
  }

  if (path === '/filtered/delete' && method === 'POST') {
    const form = await request.formData();
    const id = parseInt(form.get('id') || '0');
    const row = await env.DB.prepare('SELECT kind, name, email FROM form_submissions WHERE id = ?').bind(id).first();
    await env.DB.prepare('DELETE FROM form_submissions WHERE id = ?').bind(id).run();
    if (row) await logAudit(env.DB, currentUser, 'delete', 'form_submission', String(id), `${row.kind} from ${row.name || row.email || 'unknown'}`);
    return new Response('', { status: 302, headers: { Location: '/filtered?msg=deleted' } });
  }

  return null;
}
