// ── GYM RENTAL HELPERS & ROUTE HANDLER ──────────────────────
// Extracted from tlc-admin-worker.js

import { html, topbarHtml, formatDate, tinymceEditorSection } from './helpers.js';
import { sendTransactionalEmail } from './email.js';

// ── IMAGE HELPERS ───────────────────────────────────────────
export function extractImageKeys(body, origin) {
  if (!body) return [];
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped + '/images/([^"\'\\s<>]+)', 'g');
  const keys = [];
  let m;
  while ((m = re.exec(body)) !== null) keys.push(m[1]);
  return keys;
}

export async function sweepExpiredItems(env, origin) {
  const today = new Date().toISOString().split('T')[0];
  try {
    const expired = await env.DB.prepare(
      "SELECT id, body FROM news_items WHERE expire_date IS NOT NULL AND expire_date < ?"
    ).bind(today).all();
    for (const item of expired.results) {
      for (const key of extractImageKeys(item.body || '', origin)) {
        try { await env.IMAGES.delete(key); } catch (_) {}
      }
      await env.DB.prepare('DELETE FROM news_items WHERE id = ?').bind(item.id).run();
    }
  } catch (_) {}
}

async function sweepExpiredHolds(env) {
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      "UPDATE gym_bookings SET status = 'expired' WHERE status = 'hold' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?"
    ).bind(now).run();
  } catch (_) {}
}

function fmtBookingDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmt12h(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m === 0 ? '00' : m.toString().padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function timeOptions(selected = '') {
  const slots = [];
  for (let h = 6; h < 24; h++) {
    for (const m of [0, 30]) {
      const val = `${h.toString().padStart(2,'0')}:${m === 0 ? '00' : '30'}`;
      slots.push(`<option value="${val}"${selected === val ? ' selected' : ''}>${fmt12h(val)}</option>`);
    }
  }
  return slots.join('');
}

function calcHours(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

const PAYMENT_LINK_DEFAULT = 'https://give.tithe.ly/?formId=e1769a0f-65b3-455f-933d-bfcf6a6ed6a8&locationId=fe6ddef2-d6d2-4c85-adfd-f19eac997d38&fundId=51451abb-a7e4-435a-8fc3-cb061b0ab1d7';

async function getPaymentLink(env) {
  return (await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_payment_link'").first())?.value || PAYMENT_LINK_DEFAULT;
}

async function getGroupRate(env, group) {
  if (group?.rate) return parseFloat(group.rate);
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first();
  return parseFloat(row?.value || '25');
}

function buildGymInvoiceEmailHtml(inv, group, bookingOrBookings, paymentLink = PAYMENT_LINK_DEFAULT) {
  const invNum   = `GYM-${inv.id.toString().padStart(4,'0')}`;
  const hours    = parseFloat(inv.total_hours  || 0);
  const rate     = parseFloat(inv.rate         || 0);
  const total    = parseFloat(inv.total_amount || 0);
  const rateType = inv.rate_type || 'hourly';
  const rateLabel = rateType === 'daily' ? '/day' : '/hr';
  const amountCents = Math.round(total * 100);
  const payLink  = amountCents > 0 ? `${paymentLink}&amount=${amountCents}` : paymentLink;
  const bookings = Array.isArray(bookingOrBookings) ? bookingOrBookings : [bookingOrBookings];
  const isMulti  = bookings.length > 1;

  let rentalRows;
  if (!isMulti) {
    const b = bookings[0] || {};
    const durationRow = rateType === 'daily' ? '' :
      `<tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Duration</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#1A1A2A;text-align:right;">${hours} hr${hours !== 1 ? 's' : ''}</td></tr>`;
    rentalRows = `
    <tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Date</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#1A1A2A;text-align:right;">${formatDate(b.booking_date)}</td></tr>
    <tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Time</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#1A1A2A;text-align:right;">${fmt12h(b.start_time)} – ${fmt12h(b.end_time)}</td></tr>
    ${durationRow}
    <tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Rate</td><td style="padding:10px 0;font-size:14px;color:#1A1A2A;text-align:right;">$${rate.toFixed(2)}${rateLabel}</td></tr>`;
  } else {
    const dateRows = bookings.map(b => {
      const bh = calcHours(b.start_time, b.end_time);
      const subtotal = rateType === 'daily' ? rate : bh * rate;
      const detail = rateType === 'daily'
        ? `${fmt12h(b.start_time)}&ndash;${fmt12h(b.end_time)} &middot; $${subtotal.toFixed(2)}`
        : `${fmt12h(b.start_time)}&ndash;${fmt12h(b.end_time)} &middot; ${bh} hr${bh !== 1 ? 's' : ''} &middot; $${subtotal.toFixed(2)}`;
      return `<tr style="border-bottom:1px solid #EDE9E0;">
        <td style="padding:8px 0;font-size:13px;color:#1A1A2A;font-weight:600;">${formatDate(b.booking_date)}</td>
        <td style="padding:8px 0;font-size:13px;color:#4A4860;text-align:right;">${detail}</td>
      </tr>`;
    }).join('');
    const totalHoursRow = rateType === 'daily' ? '' :
      `<tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Total Hours</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#1A1A2A;text-align:right;">${hours} hrs</td></tr>`;
    rentalRows = `
    <tr><td colspan="2" style="padding:4px 0 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#C9973A;">Rental Dates</td></tr>
    ${dateRows}
    <tr style="border-bottom:1px solid #EDE9E0;"><td style="padding:10px 0;font-size:14px;color:#4A4860;">Rate</td><td style="padding:10px 0;font-size:14px;color:#1A1A2A;text-align:right;">$${rate.toFixed(2)}${rateLabel}</td></tr>
    ${totalHoursRow}`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F7F3EC;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;background:#F7F3EC;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #EDE9E0;">
<tr><td style="background:#1E2D4A;padding:28px 36px;text-align:center;">
  <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#C9973A;margin-bottom:6px;">Timothy Lutheran Church</div>
  <div style="font-family:Georgia,serif;font-size:22px;color:white;margin-bottom:4px;">Gym Rental Invoice</div>
  <div style="font-size:13px;color:rgba(255,255,255,.6);">#${invNum}</div>
</td></tr>
<tr><td style="padding:36px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
    <tr>
      <td style="vertical-align:top;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;">Billed To</div>
        <div style="font-size:15px;font-weight:700;color:#1E2D4A;">${group.name}</div>
        ${group.contact ? `<div style="font-size:13px;color:#4A4860;margin-top:3px;">${group.contact}</div>` : ''}
        ${group.email   ? `<div style="font-size:13px;color:#4A4860;">${group.email}</div>` : ''}
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C9973A;margin-bottom:8px;">Invoice Date</div>
        <div style="font-size:14px;color:#1A1A2A;">${formatDate(inv.invoice_date)}</div>
        <div style="font-size:12px;font-weight:700;margin-top:4px;color:${inv.status==='paid'?'#1a3d1f':'#7a1f1f'};">${inv.status==='paid'?'✓ PAID':'UNPAID'}</div>
      </td>
    </tr>
  </table>
  <hr style="border:none;border-top:1px solid #EDE9E0;margin:0 0 24px;">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C9973A;margin-bottom:16px;">Rental Details</div>
  <table width="100%" cellpadding="0" cellspacing="0">
    ${rentalRows}
    <tr><td style="padding:20px 0 0;font-size:18px;font-weight:700;color:#1E2D4A;">Amount Due</td><td style="padding:20px 0 0;font-size:24px;font-weight:700;color:#1E2D4A;text-align:right;">$${total.toFixed(2)}</td></tr>
  </table>
  <hr style="border:none;border-top:1px solid #EDE9E0;margin:24px 0;">
  <div style="background:#F7F3EC;border-radius:8px;padding:18px 20px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#C9973A;margin-bottom:10px;">Payment</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr><td align="center">
        <a href="${payLink}" style="display:inline-block;background:#00DB72;color:white;font-weight:700;font-size:16px;padding:14px 48px;border-radius:6px;text-decoration:none;letter-spacing:.01em;">Pay Online →</a>
      </td></tr>
    </table>
    <div style="font-size:13px;color:#7A6E60;text-align:center;margin-bottom:16px;">— or —</div>
    <div style="font-size:14px;color:#4A4860;line-height:1.75;">Make your check payable to <strong>Timothy Lutheran Church</strong> and bring it to the church office or mail to:<br><br>Timothy Lutheran Church<br>4666 Fyler Ave, St. Louis, MO 63116</div>
    <div style="font-size:13px;color:#7A6E60;margin-top:12px;">Questions? <a href="mailto:office@timothystl.org" style="color:#2E7EA6;">office@timothystl.org</a></div>
  </div>
</td></tr>
<tr><td style="background:#F7F3EC;padding:20px 36px;text-align:center;font-size:12px;color:#7A6E60;">
  Timothy Lutheran Church · 4666 Fyler Ave, St. Louis, MO 63116
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── GOOGLE CALENDAR INTEGRATION ──────────────────────────────
// Requires Worker secrets: GCAL_SERVICE_ACCOUNT_EMAIL, GCAL_PRIVATE_KEY
// The service account must be granted "Make changes to events" on the target calendar.
async function getGCalAccessToken(env) {
  const email  = (env.GCAL_SERVICE_ACCOUNT_EMAIL || '').trim();
  const rawKey = env.GCAL_PRIVATE_KEY;
  if (!email || !rawKey) return null;
  try {
    const now  = Math.floor(Date.now() / 1000);
    const b64u = obj => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const hdr  = b64u({ alg:'RS256', typ:'JWT' });
    const pay  = b64u({ iss: email, scope:'https://www.googleapis.com/auth/calendar.events', aud:'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
    const sigInput = `${hdr}.${pay}`;
    const pem  = rawKey.replace(/\\n/g,'\n').replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
    const keyBuf = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    const key  = await crypto.subtle.importKey('pkcs8', keyBuf.buffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
    const sig  = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput));
    const jwt  = `${sigInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
    const res  = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    return (await res.json()).access_token || null;
  } catch (_) { return null; }
}

async function addGymBookingToGCal(env, { booking_date, start_time, end_time, group_name, notes }) {
  try {
    const calId = (await env.DB.prepare("SELECT value FROM site_settings WHERE key='gcal_calendar_id'").first())?.value;
    if (!calId) return;
    const token = await getGCalAccessToken(env);
    if (!token) return;
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary:  `Gym Rental — ${group_name}`,
        description: notes || '',
        location: 'Timothy Lutheran Church, 4666 Fyler Ave, St. Louis, MO 63116',
        start: { dateTime: `${booking_date}T${start_time}:00`, timeZone: 'America/Chicago' },
        end:   { dateTime: `${booking_date}T${end_time}:00`,   timeZone: 'America/Chicago' },
      }),
    });
  } catch (_) {} // never block booking flow
}

// ── GROUP BOOKING PORTAL ─────────────────────────────────────
function portalHtml(body, title = 'Gym Rental Portal') {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;600;700;800&family=Lora:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
<style>
:root{--steel:#1E2D4A;--amber:#C9973A;--sage:#4A5E3A;--warm:#FAF7F0;--linen:#F2EDE2;--mist:#EDF5F8;--border:#E8E0D0;--charcoal:#1A1A2A;--gray:#6B7280;--white:#fff;--sans:'Source Sans 3',Arial,sans-serif;--serif:'Lora',Georgia,serif;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:var(--sans);background:var(--warm);color:var(--charcoal);min-height:100vh;}
.portal-header{background:var(--steel);border-bottom:3px solid var(--amber);padding:18px 24px;text-align:center;}
.portal-brand{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;}
.portal-title{font-family:var(--serif);font-size:20px;color:white;}
.portal-group{font-size:13px;color:rgba(255,255,255,.65);margin-top:4px;}
.wrap{max-width:820px;margin:0 auto;padding:32px 20px;}
.card{background:var(--white);border:1px solid var(--border);border-radius:14px;padding:24px;margin-bottom:20px;}
.card-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--border);}
.form-group{margin-bottom:18px;}
label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:6px;}
input[type=date],input[type=text],input[type=email],textarea,select{width:100%;background:var(--white);border:1px solid var(--border);border-radius:6px;padding:10px 14px;font-family:var(--sans);font-size:14px;color:var(--charcoal);outline:none;transition:border-color .2s;}
input:focus,select:focus{border-color:var(--amber);box-shadow:0 0 0 3px rgba(201,151,58,.12);}
.btn{display:inline-flex;align-items:center;gap:8px;font-family:var(--sans);font-size:14px;font-weight:700;padding:11px 24px;border-radius:6px;border:none;cursor:pointer;text-decoration:none;transition:background .2s;line-height:1;}
.btn-primary{background:var(--steel);color:white;}
.btn-primary:hover{background:#2a4068;}
.btn-amber{background:var(--amber);color:var(--steel);}
.btn-amber:hover{background:#b8872a;}
.btn-sage{background:var(--sage);color:white;}
.btn-sage:hover{background:#3a4e2a;}
.btn-danger{background:#B85C3A;color:white;}
.btn-danger:hover{background:#9a4a2e;}
.btn-sm{font-size:12px;padding:7px 14px;}
.btn-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;}
.alert{padding:14px 18px;border-radius:8px;font-size:14px;margin-bottom:20px;line-height:1.5;}
.alert-success{background:#e8f5e9;border-left:3px solid #4A5E3A;color:#1a3d1f;}
.alert-error{background:#fce8e8;border-left:3px solid #B85C3A;color:#7a1f1f;}
.alert-info{background:var(--mist);border-left:3px solid var(--steel);color:var(--steel);}
.badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;}
.badge-confirmed{background:#e8f5e9;color:#1a3d1f;}
.badge-hold{background:#FFF3D6;color:#7A4F00;}
.badge-expired{background:#fce8e8;color:#7a1f1f;}
.booking-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;}
.booking-row:last-child{border-bottom:none;}
.booking-date{font-size:13px;font-weight:700;color:var(--steel);min-width:100px;}
.booking-time{font-size:13px;color:var(--gray);}
/* Selection calendar */
.scal-wrap{position:relative;}
.scal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px;}
.scal-nav-btn{background:var(--mist);border:1px solid var(--border);cursor:pointer;padding:6px 16px;border-radius:6px;font-size:18px;line-height:1;color:var(--steel);font-weight:700;transition:background .15s;flex-shrink:0;}
.scal-nav-btn:hover{background:var(--border);}
.scal-nav-btn:disabled{opacity:.35;cursor:default;}
.scal-nav-label{font-family:var(--serif);font-size:18px;color:var(--steel);font-weight:700;text-align:center;flex:1;}
.scal-month{display:none;}
.scal-month.active{display:block;}
.scal-table{width:100%;border-collapse:collapse;table-layout:fixed;}
.scal-table th{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gray);padding:7px 0;text-align:center;}
.scal-table td{padding:3px;vertical-align:top;}
.scal-cell{border-radius:8px;overflow:visible;border:2px solid transparent;position:relative;}
.scal-num{font-size:12px;font-weight:700;text-align:center;padding:4px 0;line-height:1.3;color:var(--steel);}
.scal-cell.scal-past .scal-num,.scal-cell.scal-blocked .scal-num{color:#CBD5E1;}
.scal-slots{display:flex;flex-direction:column;gap:2px;padding:2px;}
.scal-slot{min-height:28px;display:flex;align-items:center;padding:0 4px;width:100%;box-sizing:border-box;border:none;cursor:default;transition:filter .1s;border-radius:3px;position:relative;font-size:9px;font-weight:700;color:white;overflow:hidden;white-space:nowrap;letter-spacing:.01em;}
.scal-slot.open{background:#5A9E6F;cursor:pointer;}
.scal-slot.open:hover{filter:brightness(1.12);}
.scal-slot.taken{background:#D17070;}
.scal-slot.na{background:#E8EDF3;color:transparent;}
.scal-slot.selected{background:var(--amber) !important;cursor:pointer;}
.scal-cell.has-selection{border-color:var(--amber);}
.scal-slot[data-label]:hover::after{content:attr(data-label);position:absolute;bottom:calc(100% + 5px);left:50%;transform:translateX(-50%);background:#1E2D4A;color:white;font-size:11px;white-space:nowrap;padding:3px 8px;border-radius:4px;pointer-events:none;z-index:300;font-family:var(--sans);font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,.25);}
/* Legend */
.scal-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--gray);margin-top:14px;}
.scal-legend span{display:flex;align-items:center;gap:6px;}
.legend-swatch{width:24px;height:10px;border-radius:2px;flex-shrink:0;}
/* Pattern selector */
.pattern-card{background:var(--mist);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-top:16px;}
.pattern-card-title{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:12px;}
.pattern-fields{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;}
.pattern-fields .form-group{margin-bottom:0;flex:1;min-width:130px;}
/* Request bar */
.req-bar{position:sticky;bottom:0;left:0;right:0;background:var(--steel);color:white;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:3px solid var(--amber);z-index:100;max-height:30vh;overflow-y:auto;}
.req-bar-count{font-size:15px;font-weight:700;}
.req-bar-detail{font-size:12px;opacity:.75;margin-top:2px;}
/* Agreement card */
.agree-card{border:2px solid var(--steel);border-radius:10px;padding:18px 20px;margin-bottom:18px;background:var(--mist);}
.agree-card .total{font-size:22px;font-weight:700;color:var(--steel);margin-bottom:10px;}
.agree-check{display:flex;align-items:flex-start;gap:10px;font-size:14px;color:var(--charcoal);line-height:1.5;cursor:pointer;}
.agree-check input{width:auto;margin-top:2px;flex-shrink:0;}
/* Mobile responsive */
.time-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;}
@media(max-width:480px){
  .time-grid{grid-template-columns:1fr;}
  .scal-slot{min-height:44px;display:flex;align-items:center;justify-content:center;font-size:12px;padding:4px 2px;}
  .req-bar{padding:10px 14px;}
  .req-bar-count{font-size:14px;}
}
</style>
</head>
<body>${body}</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// GYM_SLOTS: all possible rentable hour slots (8 AM–9 PM), each [startHour, label]
const GYM_SLOTS = [
  [8,'8–9 AM'],[9,'9–10 AM'],[10,'10–11 AM'],[11,'11 AM–12 PM'],
  [12,'12–1 PM'],[13,'1–2 PM'],[14,'2–3 PM'],[15,'3–4 PM'],
  [16,'4–5 PM'],[17,'5–6 PM'],[18,'6–7 PM'],[19,'7–8 PM'],[20,'8–9 PM']
];

// Valid start hours per day of week: 0=Sun, 6=Sat, 1-5=weekday
function getValidHoursForDow(dow) {
  if (dow === 6) return new Set([8,9,10,11,12,13,14,15,16,17,18,19]); // Sat: 8am–8pm
  if (dow === 0) return new Set([13,14,15,16,17,18,19]);               // Sun: 1pm–8pm
  return new Set([17,18,19,20]);                                        // Mon–Fri: 5–9pm
}

// Build a slotMap from a booking results array: date -> bool[] indexed by GYM_SLOTS
function buildSlotMap(bookings) {
  const map = new Map();
  for (const b of bookings) {
    const [sh, sm] = b.start_time.split(':').map(Number);
    const [eh, em] = b.end_time.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins   = eh * 60 + em;
    if (!map.has(b.booking_date)) map.set(b.booking_date, Array(GYM_SLOTS.length).fill(false));
    const slots = map.get(b.booking_date);
    GYM_SLOTS.forEach(([h], i) => {
      if (startMins < (h + 1) * 60 && endMins > h * 60) slots[i] = true;
    });
  }
  return map;
}

function buildMonthCalendar(year, month, slotMap, blockedDates, token) {
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const today = new Date().toISOString().split('T')[0];
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay();
  let out = `<div class="cal-month">
<div class="cal-month-name">${MONTH_NAMES[month]} ${year}</div>
<table class="cal-table">
<tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr>
<tr>`;

  for (let i = 0; i < startDow; i++) out += '<td></td>';
  let dow = startDow;

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const mm = (month + 1).toString().padStart(2, '0');
    const dd = d.toString().padStart(2, '0');
    const ds = `${year}-${mm}-${dd}`;
    const isPast    = ds < today;
    const isBlocked = blockedDates.has(ds);
    const dowForDay = new Date(ds + 'T12:00:00').getDay();
    const validH    = getValidHoursForDow(dowForDay);
    const slots     = slotMap.get(ds) || Array(GYM_SLOTS.length).fill(false);
    const validTaken = GYM_SLOTS.map(([h], i) => validH.has(h) ? slots[i] : null).filter(s => s !== null);
    const allTaken  = validTaken.length > 0 && validTaken.every(s => s);

    let cell;
    if (isPast || isBlocked) {
      const naPips = GYM_SLOTS.map(([h]) => validH.has(h) ? `<span class="slot-pip slot-na"></span>` : '').join('');
      cell = `<span class="cal-day-cell ${isPast ? 'cal-past' : 'cal-blocked'}">
  <span class="cal-num">${d}</span>
  <div class="slot-pips">${naPips}</div>
</span>`;
    } else {
      const pips = GYM_SLOTS.map(([h, label], i) =>
        validH.has(h) ? `<span class="slot-pip ${slots[i] ? 'slot-taken' : 'slot-open'}" title="${label}"></span>` : ''
      ).join('');
      cell = `<a href="/gym/book/${token}/day?dt=${ds}" class="cal-day-cell${allTaken ? ' cal-full' : ''}">
  <span class="cal-num">${d}</span>
  <div class="slot-pips">${pips}</div>
</a>`;
    }

    out += `<td>${cell}</td>`;
    dow++;
    if (dow === 7 && d < lastDay.getDate()) { out += '</tr><tr>'; dow = 0; }
  }
  while (dow > 0 && dow < 7) { out += '<td></td>'; dow++; }
  out += '</tr></table></div>';
  return out;
}

// Builds the TinyMCE rich-text editor section for the body field
function tlcUploadHandler(blobInfo) {
  return new Promise(function(resolve, reject) {
    var fd = new FormData();
    fd.append('file', blobInfo.blob(), blobInfo.filename());
    fetch('/api/upload-image', { method: 'POST', body: fd })
      .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
      .then(function(d) { d && d.location ? resolve(d.location) : reject('Bad response'); })
      .catch(function(err) { reject('Upload failed: ' + err); });
  });
}

// ── MAIN GYM ROUTE HANDLER ─────────────────────────────────
export async function handleGymRoutes(path, method, url, request, env, currentUser = null, ctx = null) {

    // ── GROUP BOOKING PORTAL (/gym/book/:token/*) ───────────────
    if (path.startsWith('/gym/book/')) {
      const parts  = path.split('/').filter(Boolean); // ['gym','book',TOKEN,...]
      const token  = parts[2] || '';
      const sub    = parts[3] || '';     // 'new'|'hold'|'confirm'|'history'|'confirm-hold'|'release-hold'
      const subId  = parts[4] || '';     // booking id for confirm-hold / release-hold

      // Token validation — runs for every portal request
      const group = token ? await env.DB.prepare('SELECT * FROM gym_groups WHERE access_token = ?').bind(token).first() : null;
      if (!group || !group.active) {
        return portalHtml(`
<div class="portal-header"><div class="portal-brand">Timothy Lutheran Church</div><div class="portal-title">Gym Rental Portal</div></div>
<div class="wrap" style="max-width:500px;text-align:center;padding-top:60px;">
  <div style="font-size:48px;margin-bottom:16px;">🔒</div>
  <div style="font-family:var(--serif);font-size:22px;color:var(--steel);margin-bottom:12px;">Link not found</div>
  <div style="font-size:15px;color:var(--gray);line-height:1.6;">This booking link is invalid or no longer active. Please contact the church office to request a new link.</div>
  <div style="margin-top:24px;font-size:13px;color:var(--gray);">office@timothystl.org</div>
</div>`, 'Booking Portal');
      }

      // Helper: portal header for this group
      const portalHeader = `<div class="portal-header">
  <div class="portal-brand">Timothy Lutheran Church</div>
  <div class="portal-title">Gym Rental Portal</div>
  <div class="portal-group">Welcome, ${group.name}</div>
</div>`;

      const portalNav = (active) => `<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
  <a href="/gym/book/${token}" class="btn btn-sm ${active==='cal'?'btn-primary':'btn-sage'}" style="text-decoration:none;">📅 Select Dates</a>
  <a href="/gym/book/${token}/history" class="btn btn-sm ${active==='hist'?'btn-primary':'btn-sage'}" style="text-decoration:none;">My Bookings</a>
</div>`;

      const portalMsg = url.searchParams.get('msg');
      const _pc = parseInt(url.searchParams.get('created') || '0', 10);
      const _ps = parseInt(url.searchParams.get('skipped') || '0', 10);
      const paymentLink = await getPaymentLink(env);
      const _alertAmt = url.searchParams.get('amount');
      const _payLink = _alertAmt ? `${paymentLink}&amount=${_alertAmt}` : paymentLink;
      const _payBtn = `<div style="margin-top:12px;"><a href="${_payLink}" target="_blank" style="display:inline-block;background:#00DB72;color:white;font-weight:700;font-size:14px;padding:10px 28px;border-radius:6px;text-decoration:none;">Pay Invoice Online →</a></div>`;
      const portalAlert = (portalMsg || '').startsWith('holds') ? `<div class="alert alert-success">✓ ${_pc} hold${_pc===1?'':'s'} placed! The church office will review and confirm your dates — you'll receive an invoice by email once confirmed.${_ps > 0 ? ` (${_ps} slot${_ps===1?'':'s'} were already taken and skipped.)` : ''}</div>`
        : portalMsg === 'nohold' ? `<div class="alert alert-error">No slots could be booked — they may have been taken or blocked. Please choose different times.</div>`
        : portalMsg === 'hold' ? `<div class="alert alert-success">✓ Hold placed! The church office will review and confirm your date — you'll receive an invoice by email.</div>`
        : portalMsg === 'confirmed' ? `<div class="alert alert-success">✓ Booking confirmed. An invoice has been emailed to you.${_payBtn}</div>`
        : portalMsg === 'released' ? `<div class="alert alert-success">✓ Hold released.</div>`
        : portalMsg === 'converted' ? `<div class="alert alert-success">✓ Booking confirmed! Invoice emailed to you.${_payBtn}</div>`
        : portalMsg === 'recurring' ? `<div class="alert alert-success">✓ Recurring request submitted! The church office will review it and follow up with you.</div>`
        : portalMsg === 'err' ? `<div class="alert alert-error">Please check the payment agreement box.</div>`
        : portalMsg === 'ratelimit' ? `<div class="alert alert-error">Too many holds at once. Please contact the office if you need to book more than 20 slots.</div>`
        : '';

      // ── SELECTION CALENDAR ────────────────────────────────────
      if (!sub || sub === '') {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const sixMonOut = new Date(today.getFullYear(), today.getMonth() + 6, 28).toISOString().split('T')[0];

        const [bookings, blocked] = await Promise.all([
          env.DB.prepare("SELECT booking_date, start_time, end_time FROM gym_bookings WHERE status IN ('confirmed','hold') AND booking_date >= ? AND booking_date <= ?").bind(todayStr, sixMonOut).all(),
          env.DB.prepare('SELECT date FROM gym_blocked_dates WHERE date >= ? AND date <= ?').bind(todayStr, sixMonOut).all(),
        ]);
        const slotMap      = buildSlotMap(bookings.results);
        const blockedSet   = new Set(blocked.results.map(b => b.date));

        // Build 6-month interactive selection calendar (month navigator)
        const MNAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const NUM_MONTHS = 6;
        let calHtml = '<div class="scal-wrap">';
        calHtml += `<div class="scal-nav">
  <button class="scal-nav-btn" id="scal-prev" onclick="navMonth(-1)" disabled>&#8249;</button>
  <div class="scal-nav-label" id="scal-nav-label"></div>
  <button class="scal-nav-btn" id="scal-next" onclick="navMonth(1)">&#8250;</button>
</div>`;
        for (let mi = 0; mi < NUM_MONTHS; mi++) {
          const d = new Date(today.getFullYear(), today.getMonth() + mi, 1);
          const yr = d.getFullYear(), mo = d.getMonth();
          const lastDay = new Date(yr, mo + 1, 0).getDate();
          const startDow = d.getDay();
          calHtml += `<div class="scal-month${mi === 0 ? ' active' : ''}" id="scal-month-${mi}" data-label="${MNAMES[mo]} ${yr}">
<table class="scal-table"><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr><tr>`;
          for (let s = 0; s < startDow; s++) calHtml += '<td></td>';
          let dow = startDow;
          for (let day = 1; day <= lastDay; day++) {
            const mm = (mo + 1).toString().padStart(2, '0');
            const dd = day.toString().padStart(2, '0');
            const ds = `${yr}-${mm}-${dd}`;
            const isPast = ds < todayStr;
            const isBlocked = blockedSet.has(ds);
            const dowForDate = new Date(ds + 'T12:00:00').getDay();
            const validHours = getValidHoursForDow(dowForDate);
            const slots = slotMap.get(ds) || Array(GYM_SLOTS.length).fill(false);
            let numCls = 'scal-cell';
            if (isPast) numCls += ' scal-past';
            else if (isBlocked) numCls += ' scal-blocked';
            const slotDivs = GYM_SLOTS.map(([h, label], i) => {
              if (isPast || isBlocked || !validHours.has(h)) return `<span class="scal-slot na"></span>`;
              if (slots[i]) return `<span class="scal-slot taken" data-label="${label} \u2014 Booked">${label}</span>`;
              const st = `${h.toString().padStart(2,'0')}:00`;
              const et = `${(h+1).toString().padStart(2,'0')}:00`;
              return `<span class="scal-slot open" data-date="${ds}" data-st="${st}" data-et="${et}" data-label="${label}">${label}</span>`;
            }).join('');
            calHtml += `<td><div class="${numCls}" id="cell-${ds}"><div class="scal-num">${day}</div><div class="scal-slots">${slotDivs}</div></div></td>`;
            dow++;
            if (dow === 7 && day < lastDay) { calHtml += '</tr><tr>'; dow = 0; }
          }
          while (dow > 0 && dow < 7) { calHtml += '<td></td>'; dow++; }
          calHtml += '</tr></table></div>';
        }
        calHtml += '</div>';

        const rate = (await getGroupRate(env, group)).toFixed(2);

        return portalHtml(`
${portalHeader}
<div class="wrap" style="padding-bottom:100px;">
  ${portalAlert}
  ${portalNav('cal')}
  <div class="card">
    <div class="card-title" style="margin-bottom:6px;">Select Your Dates &amp; Times</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">Tap any green slot to select it. Tap again to deselect. You can pick slots across multiple dates.</div>
    ${calHtml}
    <div class="scal-legend">
      <span><span class="legend-swatch" style="background:#5A9E6F;"></span> Available (tap to select)</span>
      <span><span class="legend-swatch" style="background:var(--amber);"></span> Selected</span>
      <span><span class="legend-swatch" style="background:#D17070;"></span> Already booked</span>
      <span><span class="legend-swatch" style="background:#E8EDF3;"></span> Unavailable</span>
    </div>
    <div style="font-size:12px;color:var(--gray);margin-top:10px;">Each slot = 1 hour ($${rate}/hr). &nbsp;Mon–Fri: 5–9 PM &nbsp;·&nbsp; Sat: 8 AM–8 PM &nbsp;·&nbsp; Sun: 1–8 PM</div>

    <!-- Pattern selector -->
    <div class="pattern-card">
      <div class="pattern-card-title">Quick-select by pattern</div>
      <div style="font-size:12px;color:var(--gray);margin-bottom:12px;">e.g. "Every Monday at 5–6 PM from March 1 to May 5"</div>
      <div class="pattern-fields">
        <div class="form-group">
          <label>Day of week</label>
          <select id="pat-dow">
            <option value="0">Sundays</option>
            <option value="1">Mondays</option>
            <option value="2">Tuesdays</option>
            <option value="3">Wednesdays</option>
            <option value="4">Thursdays</option>
            <option value="5">Fridays</option>
            <option value="6">Saturdays</option>
          </select>
        </div>
        <div class="form-group">
          <label>Time slot</label>
          <select id="pat-time">
            <option value="08:00">8–9 AM</option>
            <option value="09:00">9–10 AM</option>
            <option value="10:00">10–11 AM</option>
            <option value="11:00">11 AM–12 PM</option>
            <option value="12:00">12–1 PM</option>
            <option value="13:00">1–2 PM</option>
            <option value="14:00">2–3 PM</option>
            <option value="15:00">3–4 PM</option>
            <option value="16:00">4–5 PM</option>
            <option value="17:00">5–6 PM</option>
            <option value="18:00">6–7 PM</option>
            <option value="19:00">7–8 PM</option>
            <option value="20:00">8–9 PM</option>
          </select>
        </div>
        <div class="form-group">
          <label>From</label>
          <input type="date" id="pat-start" style="font-size:13px;padding:7px 10px;">
        </div>
        <div class="form-group">
          <label>To</label>
          <input type="date" id="pat-end" style="font-size:13px;padding:7px 10px;">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" onclick="patternSelect(true)">Select all matching</button>
          <button type="button" class="btn btn-secondary btn-sm" style="background:var(--linen);color:var(--steel);" onclick="patternSelect(false)">Deselect matching</button>
        </div>
      </div>
      <div id="pat-result" style="font-size:12px;color:var(--gray);margin-top:10px;"></div>
    </div>

  </div>

  <!-- Request form — shown after slots selected -->
  <div id="req-form-wrap" style="display:none;">
    <div class="card">
      <div class="card-title">Your Request</div>
      <div id="sel-summary-list" style="font-size:13px;color:var(--charcoal);margin-bottom:16px;line-height:1.8;"></div>
      <form method="POST" action="/gym/book/${token}/request-slots" id="req-form">
        <div id="slot-inputs"></div>
        <div class="form-group">
          <label>Notes <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional — activity type, etc.)</span></label>
          <textarea name="notes" rows="2" maxlength="500" placeholder="e.g. Basketball practice"></textarea>
        </div>
        <div class="agree-card">
          <div style="background:#FFF8EC;border:1px solid #E8C87A;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#5A4200;">
            <strong>Proof of insurance required:</strong> Please submit a certificate of insurance naming Timothy Lutheran Church as an additional insured to <a href="mailto:dinger@timothystl.org" style="color:#2E7EA6;">dinger@timothystl.org</a> before your rental date.
          </div>
          <label class="agree-check">
            <input type="checkbox" name="agree" id="agree-box" required>
            <span>I agree to pay the rental fee ($${rate}/hr) to Timothy Lutheran Church upon confirmation of my booking.</span>
          </label>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
          <div>
            <button type="submit" formaction="/gym/book/${token}/request-slots" class="btn btn-amber">Submit Rental Request →</button>
            <div style="font-size:11px;color:var(--gray);margin-top:5px;">The church office will review and confirm your dates.<br>You'll receive an invoice by email once confirmed.</div>
          </div>
          <button type="button" class="btn btn-secondary" style="background:var(--linen);color:var(--steel);align-self:center;" onclick="clearAll()">Clear</button>
        </div>
      </form>
    </div>
  </div>

</div>

<!-- Sticky request bar -->
<div class="req-bar" id="req-bar" style="display:none;">
  <div>
    <div class="req-bar-count" id="req-bar-count">0 slots selected</div>
    <div class="req-bar-detail" id="req-bar-detail"></div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-amber" onclick="scrollToForm()">Review &amp; Submit Request →</button>
  </div>
</div>

<script>
const selected = new Map(); // key "DATE|ST|ET" -> {date, st, et}
const SLOT_LABELS = {'08:00':'8–9 AM','09:00':'9–10 AM','10:00':'10–11 AM','11:00':'11 AM–12 PM','12:00':'12–1 PM','13:00':'1–2 PM','14:00':'2–3 PM','15:00':'3–4 PM','16:00':'4–5 PM','17:00':'5–6 PM','18:00':'6–7 PM','19:00':'7–8 PM','20:00':'8–9 PM'};
let curMonth = 0;
const NUM_MONTHS = 6;

// Month navigation
function navMonth(dir) {
  const next = curMonth + dir;
  if (next < 0 || next >= NUM_MONTHS) return;
  document.getElementById('scal-month-' + curMonth).classList.remove('active');
  curMonth = next;
  document.getElementById('scal-month-' + curMonth).classList.add('active');
  updateNav();
}
function updateNav() {
  document.getElementById('scal-prev').disabled = curMonth === 0;
  document.getElementById('scal-next').disabled = curMonth === NUM_MONTHS - 1;
  document.getElementById('scal-nav-label').textContent =
    document.getElementById('scal-month-' + curMonth).dataset.label;
}
updateNav();

// Slot click handler
function toggleSlot(el, doSelect) {
  const {date, st, et} = el.dataset;
  const key = date + '|' + st + '|' + et;
  const shouldSelect = (doSelect === undefined) ? !selected.has(key) : doSelect;
  if (shouldSelect) {
    selected.set(key, {date, st, et});
    el.classList.add('selected');
  } else {
    selected.delete(key);
    el.classList.remove('selected');
  }
  const anyInCell = [...selected.keys()].some(k => k.startsWith(date + '|'));
  const cell = document.getElementById('cell-' + date);
  if (cell) cell.classList.toggle('has-selection', anyInCell);
}

document.querySelectorAll('.scal-slot.open').forEach(el => {
  el.addEventListener('click', function() { toggleSlot(this); update(); });
});

function update() {
  const n = selected.size;
  const bar = document.getElementById('req-bar');
  bar.style.display = n > 0 ? '' : 'none';
  document.getElementById('req-bar-count').textContent = n + ' slot' + (n===1?'':'s') + ' selected';

  const byDate = {};
  selected.forEach(({date, st}) => {
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(SLOT_LABELS[st] || st);
  });
  const dates = Object.keys(byDate).sort();
  document.getElementById('req-bar-detail').textContent = dates.length <= 3
    ? dates.map(d => new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})).join(', ')
    : dates.length + ' dates';

  const inp = document.getElementById('slot-inputs');
  inp.innerHTML = '';
  selected.forEach((_, key) => {
    const h = document.createElement('input');
    h.type='hidden'; h.name='slots'; h.value=key;
    inp.appendChild(h);
  });

  const summaryHtml = dates.map(d => {
    const dn = new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
    return '<strong>' + dn + '</strong>: ' + byDate[d].join(', ');
  }).join('<br>');
  document.getElementById('sel-summary-list').innerHTML = summaryHtml || '';
}

function scrollToForm() {
  document.getElementById('req-form-wrap').style.display = '';
  document.getElementById('req-form-wrap').scrollIntoView({behavior:'smooth', block:'start'});
}

function clearAll() {
  selected.clear();
  document.querySelectorAll('.scal-slot.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.scal-cell.has-selection').forEach(el => el.classList.remove('has-selection'));
  document.getElementById('req-form-wrap').style.display = 'none';
  update();
}

// Pattern selector
(function initPatternDates() {
  const today = new Date();
  const fmt = d => d.toISOString().split('T')[0];
  document.getElementById('pat-start').value = fmt(today);
  const end = new Date(today); end.setMonth(end.getMonth() + 1);
  document.getElementById('pat-end').value = fmt(end);
})();

function patternSelect(doSelect) {
  const dow   = parseInt(document.getElementById('pat-dow').value, 10);
  const time  = document.getElementById('pat-time').value;
  const start = document.getElementById('pat-start').value;
  const end   = document.getElementById('pat-end').value;
  if (!start || !end || start > end) {
    document.getElementById('pat-result').textContent = 'Please set a valid date range.';
    return;
  }
  const slots = document.querySelectorAll('.scal-slot.open[data-st="' + time + '"]');
  let matched = 0;
  slots.forEach(el => {
    const date = el.dataset.date;
    if (date < start || date > end) return;
    const d = new Date(date + 'T12:00:00');
    if (d.getDay() !== dow) return;
    toggleSlot(el, doSelect);
    matched++;
    // If slot is now visible in a different month, navigate to show first match
  });
  update();
  const DOW_NAMES = ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
  const action = doSelect ? 'Selected' : 'Deselected';
  document.getElementById('pat-result').textContent = matched > 0
    ? action + ' ' + matched + ' slot' + (matched===1?'':'s') + ' \u2014 ' + DOW_NAMES[dow] + ' at ' + (SLOT_LABELS[time]||time) + ' between ' + new Date(start+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' and ' + new Date(end+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) + '.'
    : 'No available slots matched in that range.';
}
</script>
`, `${group.name} — Gym Rental`);
      }

      // ── NEW BOOKING FORM ──────────────────────────────────────
      if (sub === 'new' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const selDate  = url.searchParams.get('dt') || '';
        const selStart = url.searchParams.get('st') || '';
        const selEnd   = url.searchParams.get('et') || '';
        const errParam = url.searchParams.get('err');
        const errAlert = errParam === 'conflict'  ? `<div class="alert alert-error">That time slot overlaps an existing booking. Please choose a different time.</div>`
          : errParam === 'blocked'   ? `<div class="alert alert-error">That date is not available. Please choose a different date.</div>`
          : errParam === 'invalid'   ? `<div class="alert alert-error">End time must be after start time.</div>`
          : errParam === 'cap'       ? `<div class="alert alert-error">You've reached your hold limit. Please confirm or release an existing hold before placing a new one.</div>`
          : errParam === 'ratelimit' ? `<div class="alert alert-error">Too many requests. Please wait a bit before submitting again.</div>`
          : errParam === 'agree'     ? `<div class="alert alert-error">Please check the payment agreement box to confirm a booking.</div>`
          : '';

        const rate = (await getGroupRate(env, group)).toFixed(2);

        return portalHtml(`
${portalHeader}
<div class="wrap">
  ${errAlert}
  ${portalNav('new')}
  <div class="card">
    <div class="card-title">Request a Booking</div>
    <form method="POST" id="booking-form">
      <div class="time-grid">
        <div class="form-group">
          <label>Date *</label>
          <input type="date" name="booking_date" required min="${today}" value="${selDate}" id="f-date">
        </div>
        <div class="form-group">
          <label>Start time *</label>
          <select name="start_time" required id="f-start" onchange="calcTotal()">
            <option value="">—</option>
            ${timeOptions(selStart)}
          </select>
        </div>
        <div class="form-group">
          <label>End time *</label>
          <select name="end_time" required id="f-end" onchange="calcTotal()">
            <option value="">—</option>
            ${timeOptions(selEnd)}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional, e.g. "Basketball practice"</span></label>
        <textarea name="notes" placeholder="Brief description of your use…" rows="2" maxlength="500"></textarea>
      </div>
      <div class="agree-card">
        <div style="background:#FFF8EC;border:1px solid #E8C87A;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#5A4200;">
          <strong>Proof of insurance required:</strong> Please submit a certificate of insurance naming Timothy Lutheran Church as an additional insured to <a href="mailto:dinger@timothystl.org" style="color:#2E7EA6;">dinger@timothystl.org</a> before your rental date.
        </div>
        <div class="total" id="total-display" style="display:none;">Estimated total: <span id="total-amt"></span></div>
        <div style="font-size:13px;color:var(--gray);margin-bottom:14px;">Rate: $${rate}/hr &nbsp;·&nbsp; Invoice emailed on confirmation &nbsp;·&nbsp; Payment by check or online</div>
        <label class="agree-check">
          <input type="checkbox" name="agree" id="agree-box">
          <span>I agree to pay the rental fee to Timothy Lutheran Church upon confirmation of this booking.</span>
        </label>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
        <div>
          <button type="submit" formaction="/gym/book/${token}/hold" class="btn btn-amber">Submit Rental Request →</button>
          <div style="font-size:11px;color:var(--gray);margin-top:5px;">The church office will review and confirm your date.<br>You'll receive an invoice by email once confirmed.</div>
        </div>
      </div>
    </form>
  </div>
</div>
<script>
var rate = ${rate};
function calcTotal() {
  var s = document.getElementById('f-start').value;
  var e = document.getElementById('f-end').value;
  if (!s || !e || e <= s) { document.getElementById('total-display').style.display = 'none'; return; }
  var sh = parseInt(s.split(':')[0]), sm = parseInt(s.split(':')[1]);
  var eh = parseInt(e.split(':')[0]), em = parseInt(e.split(':')[1]);
  var hrs = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
  if (hrs <= 0) { document.getElementById('total-display').style.display = 'none'; return; }
  document.getElementById('total-amt').textContent = '$' + (hrs * rate).toFixed(2) + ' (' + hrs + ' hr' + (hrs !== 1 ? 's' : '') + ')';
  document.getElementById('total-display').style.display = 'block';
}
</script>`, `Book — ${group.name}`);
      }

      // ── SHARED: validate form fields ───────────────────────────
      async function validateBookingForm() {
        const form = await request.formData();
        return {
          booking_date: form.get('booking_date') || '',
          start_time:   form.get('start_time')   || '',
          end_time:     form.get('end_time')     || '',
          notes:        form.get('notes')        || '',
          agree:        form.get('agree')        || '',
        };
      }

      const backToForm = (err, fields = {}) => new Response('', { status: 302, headers: {
        Location: `/gym/book/${token}/new?err=${err}&dt=${fields.booking_date||''}&st=${encodeURIComponent(fields.start_time||'')}&et=${encodeURIComponent(fields.end_time||'')}` }});

      // ── PLACE HOLD ─────────────────────────────────────────────
      if (sub === 'hold' && method === 'POST') {
        const fields = await validateBookingForm();
        if (!fields.booking_date || !fields.start_time || !fields.end_time) return backToForm('invalid', fields);
        if (fields.end_time <= fields.start_time) return backToForm('invalid', fields);

        // Rate limiting (max 5 booking actions per 24hrs per group)
        const recent = await env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE group_id = ? AND created_at > datetime('now','-24 hours')").bind(group.id).first();
        if (recent.n >= 5) return backToForm('ratelimit', fields);

        // Hold cap
        const holdCount = await env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE group_id = ? AND status = 'hold'").bind(group.id).first();
        if (holdCount.n >= (group.max_active_holds || 3)) return backToForm('cap', fields);

        // Blocked date
        const blocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date = ?').bind(fields.booking_date).first();
        if (blocked) return backToForm('blocked', fields);

        // Conflict check
        const conflict = await env.DB.prepare(`SELECT id FROM gym_bookings WHERE booking_date = ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`).bind(fields.booking_date, fields.end_time, fields.start_time).first();
        if (conflict) return backToForm('conflict', fields);

        // Create hold
        const holdExpiresAt = new Date(Date.now() + 48 * 3600000).toISOString();
        await env.DB.prepare(`INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, hold_expires_at, created_by) VALUES (?, ?, ?, ?, ?, 'hold', ?, 'group')`
        ).bind(group.id, fields.booking_date, fields.start_time, fields.end_time, fields.notes, holdExpiresAt).run();

        // Notify admin
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
        if (adminEmailRow?.value) {
          try {
            await sendTransactionalEmail(env, {
              subject: `Gym hold placed \u2014 ${group.name} \u2014 ${formatDate(fields.booking_date)}`,
              htmlContent: `<p><strong>${group.name}</strong> placed a 48-hour hold:</p><p>Date: ${formatDate(fields.booking_date)}<br>Time: ${fmt12h(fields.start_time)} \u2013 ${fmt12h(fields.end_time)}</p><p>Visit <a href="https://admin.timothystl.org/gym-rentals">admin.timothystl.org/gym-rentals</a> to review.</p>`,
              toEmails: [adminEmailRow.value],
            });
          } catch (_) {}
        }

        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=hold` } });
      }

      // ── CONFIRM BOOKING ────────────────────────────────────────
      if (sub === 'confirm' && method === 'POST') {
        const fields = await validateBookingForm();
        if (!fields.booking_date || !fields.start_time || !fields.end_time) return backToForm('invalid', fields);
        if (fields.end_time <= fields.start_time) return backToForm('invalid', fields);
        if (!fields.agree) return backToForm('agree', fields);

        // Rate limiting
        const recent = await env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE group_id = ? AND created_at > datetime('now','-24 hours')").bind(group.id).first();
        if (recent.n >= 5) return backToForm('ratelimit', fields);

        // Blocked date + conflict
        const blocked  = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date = ?').bind(fields.booking_date).first();
        if (blocked) return backToForm('blocked', fields);
        const conflict = await env.DB.prepare(`SELECT id FROM gym_bookings WHERE booking_date = ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`).bind(fields.booking_date, fields.end_time, fields.start_time).first();
        if (conflict) return backToForm('conflict', fields);

        // Create confirmed booking
        const bRes = await env.DB.prepare(`INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, created_by) VALUES (?, ?, ?, ?, ?, 'confirmed', 'group')`
        ).bind(group.id, fields.booking_date, fields.start_time, fields.end_time, fields.notes).run();
        const bookingId = bRes.meta.last_row_id;

        // Invoice
        const rate    = await getGroupRate(env, group);
        const hours   = calcHours(fields.start_time, fields.end_time);
        const total   = Math.round(hours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];
        const iRes = await env.DB.prepare(`INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(group.id, bookingId, invoiceDate, fields.booking_date, fields.booking_date, hours, rate, total).run();
        const invoiceId = iRes.meta.last_row_id;

        // Email invoice
        const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id = ?').bind(invoiceId).first();
        const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, fields, paymentLink);
        const subject   = `Gym Rental Invoice \u2014 ${group.name} \u2014 ${formatDate(fields.booking_date)}`;
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
        const toEmails = [];
        if (adminEmailRow?.value) toEmails.push(adminEmailRow.value);
        if (group.email) toEmails.push(group.email);
        try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
        await addGymBookingToGCal(env, { ...fields, group_name: group.name });

        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=confirmed&amount=${Math.round(total * 100)}` } });
      }

      // ── CONVERT HOLD → CONFIRMED ──────────────────────────────
      if (sub === 'confirm-hold' && method === 'POST' && subId) {
        const bid = parseInt(subId, 10);
        const booking = await env.DB.prepare("SELECT * FROM gym_bookings WHERE id = ? AND group_id = ? AND status = 'hold'").bind(bid, group.id).first();
        if (!booking) return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/history` } });

        const form = await request.formData();
        if (!form.get('agree')) return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/history?err=agree` } });

        await env.DB.prepare("UPDATE gym_bookings SET status='confirmed', hold_expires_at=NULL WHERE id=?").bind(bid).run();

        // Invoice
        const rate    = await getGroupRate(env, group);
        const hours   = calcHours(booking.start_time, booking.end_time);
        const total   = Math.round(hours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];
        const iRes = await env.DB.prepare(`INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(group.id, bid, invoiceDate, booking.booking_date, booking.booking_date, hours, rate, total).run();
        const invoiceId = iRes.meta.last_row_id;

        const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id = ?').bind(invoiceId).first();
        const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, booking, paymentLink);
        const subject   = `Gym Rental Invoice \u2014 ${group.name} \u2014 ${formatDate(booking.booking_date)}`;
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
        const toEmails = [];
        if (adminEmailRow?.value) toEmails.push(adminEmailRow.value);
        if (group.email) toEmails.push(group.email);
        try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
        await addGymBookingToGCal(env, { ...booking, group_name: group.name });

        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=converted&amount=${Math.round(total * 100)}` } });
      }

      // ── RELEASE OWN HOLD ──────────────────────────────────────
      if (sub === 'release-hold' && method === 'POST' && subId) {
        const bid = parseInt(subId, 10);
        await env.DB.prepare("UPDATE gym_bookings SET status='released' WHERE id=? AND group_id=? AND status='hold'").bind(bid, group.id).run();
        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=released` } });
      }

      // ── BOOKING HISTORY ───────────────────────────────────────
      if (sub === 'history' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const [upcoming, past] = await Promise.all([
          env.DB.prepare("SELECT * FROM gym_bookings WHERE group_id = ? AND booking_date >= ? AND status IN ('confirmed','hold') ORDER BY booking_date, start_time").bind(group.id, today).all(),
          env.DB.prepare("SELECT * FROM gym_bookings WHERE group_id = ? AND booking_date < ? ORDER BY booking_date DESC LIMIT 20").bind(group.id, today).all(),
        ]);
        const histErr = url.searchParams.get('err') === 'agree' ? `<div class="alert alert-error">Please check the payment agreement box to confirm your hold.</div>` : '';

        // Build invoice amount map for confirmed bookings (so pay link can pre-fill amount)
        const unpaidInvoices = await env.DB.prepare(
          "SELECT booking_id, booking_ids, total_amount FROM gym_invoices WHERE group_id=? AND status='unpaid'"
        ).bind(group.id).all();
        const invoiceAmtMap = new Map();
        for (const inv of unpaidInvoices.results) {
          const cents = Math.round(parseFloat(inv.total_amount || 0) * 100);
          if (inv.booking_id) invoiceAmtMap.set(inv.booking_id, cents);
          if (inv.booking_ids) {
            try { for (const bid of JSON.parse(inv.booking_ids)) invoiceAmtMap.set(bid, cents); } catch (_) {}
          }
        }

        const upHtml = upcoming.results.length === 0
          ? `<div style="padding:24px;text-align:center;color:var(--gray);font-size:14px;">No upcoming bookings.</div>`
          : upcoming.results.map(b => {
              const isHold = b.status === 'hold';
              const exp = b.hold_expires_at ? new Date(b.hold_expires_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
              const bAmt = invoiceAmtMap.get(b.id);
              const payHref = bAmt ? `${paymentLink}&amount=${bAmt}` : paymentLink;
              return `
<div class="booking-row">
  <div style="flex:1;">
    <div class="booking-date">${fmtBookingDate(b.booking_date)}</div>
    <div class="booking-time">${fmt12h(b.start_time)} – ${fmt12h(b.end_time)}</div>
    ${isHold ? `<div style="font-size:11px;color:#7A4F00;margin-top:2px;">Hold expires ${exp}</div>` : ''}
  </div>
  <span class="badge ${isHold ? 'badge-hold' : 'badge-confirmed'}">${isHold ? 'Pending Review' : 'Confirmed'}</span>
  ${isHold ? `
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <form method="POST" action="/gym/book/${token}/release-hold/${b.id}" onsubmit="return confirm('Release this hold?')">
      <button type="submit" class="btn btn-sm btn-danger">Cancel Request</button>
    </form>
  </div>` : `<a href="${payHref}" target="_blank" class="btn btn-sm btn-sage" style="text-decoration:none;">Pay Online →</a>`}
</div>`;
            }).join('');

        const pastHtml = past.results.length === 0
          ? `<div style="padding:16px;text-align:center;color:var(--gray);font-size:13px;">No past bookings.</div>`
          : past.results.map(b => `
<div class="booking-row">
  <div style="flex:1;">
    <div class="booking-date" style="color:var(--gray);">${fmtBookingDate(b.booking_date)}</div>
    <div class="booking-time">${fmt12h(b.start_time)} \u2013 ${fmt12h(b.end_time)}</div>
  </div>
  <span class="badge" style="background:var(--linen);color:var(--gray);">${b.status}</span>
</div>`).join('');

        return portalHtml(`
${portalHeader}
<div class="wrap">
  ${histErr}
  ${portalAlert}
  ${portalNav('hist')}
  <div class="card">
    <div class="card-title">Upcoming Bookings</div>
    ${upHtml}
  </div>
  <div class="card">
    <div class="card-title">Past Bookings</div>
    ${pastHtml}
  </div>
</div>`, `My Bookings — ${group.name}`);
      }

      // ── BATCH SLOT REQUEST ────────────────────────────────────
      if (sub === 'request-slots' && method === 'POST') {
        const form   = await request.formData();
        const slots  = form.getAll('slots');   // each "DATE|ST|ET"
        const notes  = form.get('notes') || '';
        const agree  = form.get('agree');
        const today  = new Date().toISOString().split('T')[0];

        if (!agree || !slots.length)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=agree` } });

        // Rate limit: max 20 new holds per submission, 8 per 24h per group
        if (slots.length > 20)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=ratelimit` } });
        const recentCount = await env.DB.prepare("SELECT COUNT(*) as n FROM gym_bookings WHERE group_id=? AND created_at > datetime('now','-24 hours')").bind(group.id).first();
        if ((recentCount?.n || 0) + slots.length > 20)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=ratelimit` } });

        const holdExpires = new Date(Date.now() + 48 * 3600000).toISOString().replace('T',' ').slice(0,19);
        let created = 0, skipped = 0;
        for (const slot of slots) {
          const [date, st, et] = slot.split('|');
          if (!date || !st || !et || date < today) { skipped++; continue; }
          const slotDow  = new Date(date + 'T12:00:00').getDay();
          const validH   = getValidHoursForDow(slotDow);
          if (!validH.has(parseInt(st.split(':')[0], 10))) { skipped++; continue; }
          const isBlocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date=?').bind(date).first();
          if (isBlocked) { skipped++; continue; }
          const conflict = await env.DB.prepare("SELECT id FROM gym_bookings WHERE booking_date=? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?").bind(date, et, st).first();
          if (conflict) { skipped++; continue; }
          try {
            await env.DB.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, hold_expires_at, created_by) VALUES (?, ?, ?, ?, ?, 'hold', ?, 'group')")
              .bind(group.id, date, st, et, notes, holdExpires).run();
            created++;
          } catch (_) { skipped++; }
        }

        // Notify admin
        if (created > 0) {
          const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
          const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
          try {
            await sendTransactionalEmail(env, {
              subject: `${created} hold(s) placed — ${group.name}`,
              htmlContent: `<p><strong>${group.name}</strong> placed ${created} hold(s) via the booking portal.</p><p>${skipped > 0 ? `(${skipped} slot(s) skipped due to conflicts.)` : ''}</p><p>Notes: ${notes || '—'}</p><p><a href="https://admin.timothystl.org/gym-rentals">Review at admin.timothystl.org/gym-rentals</a></p>`,
              toEmails: [adminEmail],
            });
          } catch (_) {}
        }

        const msg = created > 0 ? `holds${created}` : 'nohold';
        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/history?msg=${msg}&created=${created}&skipped=${skipped}` } });
      }

      // ── BATCH DIRECT CONFIRM ─────────────────────────────────
      if (sub === 'confirm-slots' && method === 'POST') {
        const form   = await request.formData();
        const slots  = form.getAll('slots');
        const notes  = form.get('notes') || '';
        const agree  = form.get('agree');
        const today  = new Date().toISOString().split('T')[0];

        if (!agree || !slots.length)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=agree` } });

        if (slots.length > 20)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?err=ratelimit` } });

        const rate    = await getGroupRate(env, group);
        const invoiceDate = new Date().toISOString().split('T')[0];
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';

        // First pass: create all bookings, collect the created ones
        let skipped = 0;
        const createdBookings = []; // { id, booking_date, start_time, end_time }
        for (const slot of slots) {
          const [date, st, et] = slot.split('|');
          if (!date || !st || !et || date < today) { skipped++; continue; }
          const slotDow = new Date(date + 'T12:00:00').getDay();
          const validH  = getValidHoursForDow(slotDow);
          if (!validH.has(parseInt(st.split(':')[0], 10))) { skipped++; continue; }
          const isBlocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date=?').bind(date).first();
          if (isBlocked) { skipped++; continue; }
          const conflict = await env.DB.prepare("SELECT id FROM gym_bookings WHERE booking_date=? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?").bind(date, et, st).first();
          if (conflict) { skipped++; continue; }
          try {
            const bRes = await env.DB.prepare("INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, created_by) VALUES (?, ?, ?, ?, ?, 'confirmed', 'group')")
              .bind(group.id, date, st, et, notes).run();
            createdBookings.push({ id: bRes.meta.last_row_id, booking_date: date, start_time: st, end_time: et });
            await addGymBookingToGCal(env, { booking_date: date, start_time: st, end_time: et, group_name: group.name, notes });
          } catch (_) { skipped++; }
        }

        // Second pass: create ONE invoice for all confirmed bookings
        if (createdBookings.length > 0) {
          const totalHours = createdBookings.reduce((sum, b) => sum + calcHours(b.start_time, b.end_time), 0);
          const totalAmount = Math.round(totalHours * rate * 100) / 100;
          const allDates = createdBookings.map(b => b.booking_date).sort();
          const bookingIds = JSON.stringify(createdBookings.map(b => b.id));
          const iRes = await env.DB.prepare(
            `INSERT INTO gym_invoices (group_id, booking_id, booking_ids, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
          ).bind(group.id, bookingIds, invoiceDate, allDates[0], allDates[allDates.length - 1], totalHours, rate, totalAmount).run();
          const invoiceId = iRes.meta.last_row_id;
          const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
          const subject = createdBookings.length === 1
            ? `Gym Rental Invoice — ${group.name} — ${formatDate(createdBookings[0].booking_date)}`
            : `Gym Rental Invoice — ${group.name} — ${createdBookings.length} dates`;
          const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, createdBookings, paymentLink);
          const toEmails = [adminEmail];
          if (group.email) toEmails.push(group.email);
          try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
        }

        const created = createdBookings.length;
        const msg = created > 0 ? `confirmed${created}` : 'nohold';
        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/history?msg=${msg}&created=${created}&skipped=${skipped}` } });
      }

      // ── RECURRING REQUEST FORM ────────────────────────────────
      if (sub === 'recurring' && method === 'GET') {
        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const dowOpts = DOW_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('');
        const timeOpts5to9 = ['17:00','18:00','19:00','20:00','21:00'].map(t => `<option value="${t}">${fmt12h(t)}</option>`).join('');
        const today = new Date().toISOString().split('T')[0];
        const errParam = url.searchParams.get('err');
        const errAlert = errParam === 'invalid' ? `<div class="alert alert-error">Please fill in all required fields and ensure end time is after start time.</div>`
          : errParam === 'dates' ? `<div class="alert alert-error">Start date must be today or later, and end date must be after start date.</div>`
          : '';
        return portalHtml(`
${portalHeader}
<div class="wrap">
  ${portalNav('rec')}
  <div class="card">
    <div class="card-title" style="margin-bottom:4px;">Recurring Rental Request</div>
    <div style="font-size:14px;color:var(--gray);margin-bottom:20px;line-height:1.6;">Request the same time slot every week for a season. The church office will review your request and confirm the dates.</div>
    ${errAlert}
    <form method="POST" action="/gym/book/${token}/recurring">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="form-group" style="grid-column:1/-1;">
          <label>Day of the week</label>
          <select name="day_of_week" required>${dowOpts}</select>
        </div>
        <div class="form-group">
          <label>Start time</label>
          <select name="start_time" required>${timeOpts5to9}</select>
        </div>
        <div class="form-group">
          <label>End time</label>
          <select name="end_time" required>${timeOpts5to9}</select>
        </div>
        <div class="form-group">
          <label>First date</label>
          <input type="date" name="start_date" required min="${today}">
        </div>
        <div class="form-group">
          <label>Last date</label>
          <input type="date" name="end_date" required min="${today}">
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label>Notes <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional — activity type, special needs, etc.)</span></label>
          <textarea name="notes" rows="3" maxlength="500" placeholder="e.g. Basketball practice for youth group"></textarea>
        </div>
      </div>
      <div style="margin-top:8px;padding:14px 16px;background:var(--mist);border-radius:8px;font-size:13px;color:var(--steel);line-height:1.6;">
        Rental rate is $${(await getGroupRate(env, group)).toFixed(2)}/hr. You will receive a monthly invoice once your request is approved.
      </div>
      <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
        <button type="submit" class="btn btn-primary">Submit Request →</button>
        <a href="/gym/book/${token}" class="btn btn-secondary" style="text-decoration:none;background:var(--linen);color:var(--steel);">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'Recurring Request');
      }

      if (sub === 'recurring' && method === 'POST') {
        const form    = await request.formData();
        const dow     = parseInt(form.get('day_of_week') || '1', 10);
        const st      = form.get('start_time') || '';
        const et      = form.get('end_time')   || '';
        const sd      = form.get('start_date') || '';
        const ed      = form.get('end_date')   || '';
        const notes   = form.get('notes') || '';
        const today   = new Date().toISOString().split('T')[0];

        if (isNaN(dow) || dow < 0 || dow > 6)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/recurring?err=invalid` } });
        if (!st || !et || !sd || !ed || et <= st)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/recurring?err=invalid` } });
        if (sd < today || ed <= sd)
          return new Response('', { status: 302, headers: { Location: `/gym/book/${token}/recurring?err=dates` } });

        await env.DB.prepare(
          `INSERT INTO gym_recurrences (group_id, day_of_week, start_time, end_time, start_date, end_date, status, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'pending_review', ?, 'group')`
        ).bind(group.id, dow, st, et, sd, ed, notes).run();

        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
        try {
          await sendTransactionalEmail(env, {
            subject: `Recurring rental request — ${group.name}`,
            htmlContent: `<p><strong>${group.name}</strong> submitted a recurring rental request:</p>
<ul>
  <li><strong>Day:</strong> ${DOW_NAMES[dow]}s</li>
  <li><strong>Time:</strong> ${fmt12h(st)} – ${fmt12h(et)}</li>
  <li><strong>Date range:</strong> ${formatDate(sd)} – ${formatDate(ed)}</li>
  ${notes ? `<li><strong>Notes:</strong> ${notes}</li>` : ''}
</ul>
<p><a href="https://admin.timothystl.org/gym-rentals">Review at admin.timothystl.org/gym-rentals</a></p>`,
            toEmails: [adminEmail],
          });
        } catch (_) {}

        return new Response('', { status: 302, headers: { Location: `/gym/book/${token}?msg=recurring` } });
      }

      // Fallback: redirect to calendar
      return new Response('', { status: 302, headers: { Location: `/gym/book/${token}` } });
    } // end /gym/book

    // ── GYM ICAL FEED (public, token-protected) ──────────────────
    if (path.startsWith('/gym/cal/') && path.endsWith('.ics')) {
      const feedToken = path.slice('/gym/cal/'.length, -'.ics'.length);
      const tokenRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_ical_token'").first();
      const validToken = tokenRow?.value || '';
      if (!feedToken || feedToken !== validToken) {
        return new Response('Not found', { status: 404 });
      }
      const bookings = await env.DB.prepare(
        `SELECT b.*, g.name as group_name FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id WHERE b.status = 'confirmed' ORDER BY b.booking_date, b.start_time`
      ).all();
      const now = new Date();
      const stamp = now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
      const toIcalDt = (dateStr, timeStr) => {
        const [y,m,d] = dateStr.split('-');
        const [h,min] = timeStr.split(':');
        return `${y}${m}${d}T${h}${min}00`;
      };
      const events = bookings.results.map(b => [
        'BEGIN:VEVENT',
        `UID:gym-booking-${b.id}@timothystl.org`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${toIcalDt(b.booking_date, b.start_time)}`,
        `DTEND:${toIcalDt(b.booking_date, b.end_time)}`,
        `SUMMARY:${(b.group_name || 'Rental').replace(/[,;\\]/g,' ')} — ${fmt12h(b.start_time)}–${fmt12h(b.end_time)}`,
        b.notes ? `DESCRIPTION:${b.notes.replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/:/g,'\\:').replace(/\n/g,'\\n')}` : '',
        'LOCATION:Timothy Lutheran Church Gym',
        'END:VEVENT',
      ].filter(Boolean).join('\r\n')).join('\r\n');
      const ical = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Timothy Lutheran Church//Gym Rentals//EN',
        'X-WR-CALNAME:TLC Gym Rentals',
        'X-WR-TIMEZONE:America/Chicago',
        'CALSCALE:GREGORIAN',
        events,
        'END:VCALENDAR',
      ].join('\r\n');
      return new Response(ical, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="gym-rentals.ics"' } });
    }

    if (path.startsWith('/gym-rentals')) {
      await sweepExpiredHolds(env);

      const gymMsg = url.searchParams.get('msg');
      const gymAlertN = parseInt(url.searchParams.get('n') || '0', 10);
      const gymAlert = gymMsg === 'saved'           ? `<div class="alert alert-success">✓ Saved.</div>`
        : gymMsg === 'created'       ? `<div class="alert alert-success">✓ Group created.</div>`
        : gymMsg === 'deleted'       ? `<div class="alert alert-success">✓ Deleted.</div>`
        : gymMsg === 'confirmed-all' ? `<div class="alert alert-success">✓ ${gymAlertN} hold${gymAlertN===1?'':'s'} confirmed — invoices sent.</div>`
        : '';

      // ── DASHBOARD ──────────────────────────────────────────────
      if (path === '/gym-rentals' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const fmtShort = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

        const [holdsRes, pendingRes, confirmedRes, rateRow] = await Promise.all([
          env.DB.prepare(`SELECT b.*, g.name as group_name, r.day_of_week as rec_dow, r.start_date as rec_start, r.end_date as rec_end FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id LEFT JOIN gym_recurrences r ON r.id = b.recurrence_id WHERE b.status = 'hold' ORDER BY b.group_id, b.hold_expires_at`).all(),
          env.DB.prepare(`SELECT r.*, g.name as group_name FROM gym_recurrences r LEFT JOIN gym_groups g ON g.id = r.group_id WHERE r.status = 'pending_review' ORDER BY r.created_at`).all(),
          env.DB.prepare(`SELECT b.*, g.name as group_name, r.day_of_week as rec_dow, r.start_date as rec_start, r.end_date as rec_end FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id LEFT JOIN gym_recurrences r ON r.id = b.recurrence_id WHERE b.status = 'confirmed' AND b.booking_date >= ? ORDER BY b.group_id, b.recurrence_id, b.booking_date`).bind(today).all(),
          env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first(),
        ]);

        // De-duplicate recurring bookings — show one row per recurrence_id
        const buildItems = (rows) => {
          const seen = new Set();
          const items = [];
          for (const b of rows) {
            if (b.recurrence_id) {
              if (seen.has(b.recurrence_id)) continue;
              seen.add(b.recurrence_id);
              items.push({ ...b, isRecurring: true });
            } else {
              items.push({ ...b, isRecurring: false });
            }
          }
          return items;
        };

        // Render a single booking line
        const bookingLine = (b, mode = 'none') => {
          // mode: 'hold' | 'confirmed' | 'none'
          const timeRange = `${fmt12h(b.start_time)}–${fmt12h(b.end_time)}`;
          const deleteAction = b.isRecurring
            ? `/gym-rentals/bookings/delete-recurring/${b.recurrence_id}`
            : `/gym-rentals/bookings/delete/${b.id}`;
          const deleteConfirm = b.isRecurring
            ? `Delete all future bookings in this recurring series?`
            : `Delete this confirmed booking on ${fmtShort(b.booking_date)}?`;
          const cb = (mode === 'hold' && !b.isRecurring)
            ? `<input type="checkbox" class="hold-cb" data-id="${b.id}" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">`
            : (mode === 'confirmed' && !b.isRecurring)
            ? `<input type="checkbox" class="conf-cb" data-id="${b.id}" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">`
            : `<span style="width:16px;flex-shrink:0;"></span>`;
          const actions = mode === 'hold' ? `<div style="display:flex;gap:5px;flex-shrink:0;">
    <form method="POST" action="/gym-rentals/bookings/confirm-admin/${b.id}" style="display:contents;" onsubmit="return confirm('Confirm this hold and generate an invoice?')"><button type="submit" class="btn btn-sm btn-primary">Confirm</button></form>
    <form method="POST" action="/gym-rentals/bookings/release/${b.id}" style="display:contents;" onsubmit="return confirm('Release this hold?')"><button type="submit" class="btn btn-sm btn-danger">Release</button></form>
  </div>` : mode === 'confirmed' ? `<form method="POST" action="${deleteAction}" style="display:contents;" onsubmit="return confirm('${deleteConfirm}')"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form>` : '';
          if (b.isRecurring) {
            const label = `${DOW_FULL[b.rec_dow]}s, ${fmtShort(b.rec_start)} – ${fmtShort(b.rec_end)}`;
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 18px;border-bottom:1px solid var(--border);">
  ${cb}
  <div style="flex:1;font-family:var(--sans);font-size:13px;font-weight:600;color:var(--charcoal);">${label}</div>
  <div style="font-family:var(--sans);font-size:13px;color:var(--steel);">${timeRange}</div>
  <span class="badge" style="background:#e8f0fe;color:#1a3060;font-size:10px;">Recurring</span>
  ${actions}
</div>`;
          } else {
            const exp = mode === 'hold' && b.hold_expires_at
              ? ` <span style="color:#7A4F00;font-size:11px;">exp ${new Date(b.hold_expires_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</span>`
              : '';
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 18px;border-bottom:1px solid var(--border);">
  ${cb}
  <div style="font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);min-width:110px;">${fmtBookingDate(b.booking_date)}</div>
  <div style="flex:1;font-family:var(--sans);font-size:13px;color:var(--charcoal);">${timeRange}${exp}</div>
  ${actions}
</div>`;
          }
        };

        // Render an org accordion
        const orgAccordion = (orgName, items, mode) => `
<details open style="margin-bottom:8px;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
  <summary style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:11px 18px;background:var(--mist);font-family:var(--sans);font-size:14px;font-weight:700;color:var(--charcoal);list-style:none;-webkit-appearance:none;">
    <span>${orgName}</span>
    <span style="font-size:12px;font-weight:400;color:var(--gray);">${items.length} booking${items.length !== 1 ? 's' : ''}</span>
  </summary>
  ${items.map(b => bookingLine(b, mode)).join('')}
</details>`;

        // Build holds HTML (grouped by org)
        const holdItems = buildItems(holdsRes.results);
        let holdsHtml = `<div style="text-align:center;padding:24px;color:var(--gray);font-size:14px;">No pending holds.</div>`;
        if (holdItems.length > 0) {
          const groups = {}, order = [];
          for (const b of holdItems) {
            const n = b.group_name || '— Unassigned —';
            if (!groups[n]) { groups[n] = []; order.push(n); }
            groups[n].push(b);
          }
          holdsHtml = order.map(n => orgAccordion(n, groups[n], 'hold')).join('');
        }

        // Pending recurring requests (awaiting review)
        const pendingRecHtml = pendingRes.results.length === 0 ? '' : `
<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
  <div style="font-family:var(--sans);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gray);margin-bottom:8px;">Recurring requests — awaiting review</div>
  ${pendingRes.results.map(r => `<div style="display:flex;align-items:center;gap:12px;padding:9px 14px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:var(--linen);">
  <div style="flex:1;font-family:var(--sans);font-size:13px;">
    <span style="font-weight:700;color:var(--charcoal);">${r.group_name || '—'}</span>
    <span style="color:var(--gray);margin:0 5px;">·</span>
    <span style="color:var(--charcoal);">${DOW_FULL[r.day_of_week]}s, ${fmtShort(r.start_date)} – ${fmtShort(r.end_date)}</span>
    <span style="color:var(--gray);margin:0 5px;">·</span>
    <span style="color:var(--steel);">${fmt12h(r.start_time)}–${fmt12h(r.end_time)}</span>
  </div>
  <a href="/gym-rentals/recurring/review/${r.id}" class="btn btn-sm btn-primary">Review</a>
</div>`).join('')}
</div>`;

        // Build confirmed HTML (grouped by org)
        const confirmedItems = buildItems(confirmedRes.results);
        let confirmedHtml = `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No upcoming confirmed bookings.</div>`;
        if (confirmedItems.length > 0) {
          const groups = {}, order = [];
          for (const b of confirmedItems) {
            const n = b.group_name || '— Unassigned —';
            if (!groups[n]) { groups[n] = []; order.push(n); }
            groups[n].push(b);
          }
          confirmedHtml = order.map(n => orgAccordion(n, groups[n], 'confirmed')).join('');
        }

        const confirmAllBtn = holdsRes.results.length >= 1
          ? `<form method="POST" action="/gym-rentals/bookings/confirm-all-holds" onsubmit="return confirm('Confirm all ${holdsRes.results.length} holds and generate invoices?')" style="display:inline;"><button type="submit" class="btn btn-sm btn-primary">Confirm All (${holdsRes.results.length})</button></form>`
          : '';

        return html(`
${topbarHtml('gym', currentUser)}
<style>details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }</style>
<div class="wrap">
  <div class="page-title">Gym Rentals</div>
  <div class="page-sub">Manage rental groups, bookings, and schedules.</div>
  ${gymAlert}
  <div class="btn-row" style="margin-bottom:16px;">
    <a href="/gym-rentals/bookings/new" class="btn btn-primary">+ New Booking</a>
    <a href="/gym-rentals/groups" class="btn btn-secondary">Manage Groups</a>
    <a href="/gym-rentals/blocked" class="btn btn-sage">Blocked Dates</a>
    <a href="/gym-rentals/invoices" class="btn btn-secondary">Invoices</a>
    <a href="/gym-rentals/test-gcal" class="btn btn-secondary" style="margin-left:auto;">Test GCal →</a>
  </div>
  <div style="background:var(--mist);border:1px solid var(--border);border-radius:10px;padding:12px 18px;margin-bottom:24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
    <div style="font-size:14px;color:var(--charcoal);">Rental rate: <strong>$${rateRow?.value || '25.00'}/hr</strong></div>
    <a href="/settings" style="font-size:13px;color:var(--teal,#2E7EA6);text-decoration:none;border-bottom:1px solid currentColor;">Change rate →</a>
    <div style="margin-left:auto;font-size:12px;color:var(--gray);">Mon–Fri 5–9 PM &nbsp;·&nbsp; Sat 8 AM–8 PM &nbsp;·&nbsp; Sun 1–8 PM</div>
  </div>
  <div class="card">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span>Pending Holds</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${confirmAllBtn}
        <button type="button" class="btn btn-sm btn-primary" id="bulk-confirm-btn" onclick="bulkHoldAction('confirm')" style="display:none;">Confirm Selected</button>
        <button type="button" class="btn btn-sm btn-danger" id="bulk-release-btn" onclick="bulkHoldAction('release')" style="display:none;">Release Selected</button>
      </div>
    </div>
    ${holdsHtml}
    ${pendingRecHtml}
  </div>
  <div class="card" style="margin-top:16px;">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span>Confirmed Bookings</span>
      <button type="button" class="btn btn-sm btn-danger" id="bulk-delete-btn" onclick="bulkConfirmedAction('delete')" style="display:none;">Delete Selected</button>
    </div>
    ${confirmedHtml}
  </div>
</div>
<script>
function getChecked(cls) {
  return [...document.querySelectorAll('.' + cls + ':checked')].map(cb => cb.dataset.id);
}
function bulkPost(url, ids, msg) {
  if (!ids.length) { alert('Select at least one item first.'); return; }
  if (!confirm(msg.replace('{n}', ids.length))) return;
  const form = document.createElement('form');
  form.method = 'POST'; form.action = url;
  ids.forEach(id => { const i = document.createElement('input'); i.type='hidden'; i.name='ids'; i.value=id; form.appendChild(i); });
  document.body.appendChild(form); form.submit();
}
function bulkHoldAction(action) {
  const ids = getChecked('hold-cb');
  if (action === 'confirm') bulkPost('/gym-rentals/bookings/bulk-confirm', ids, 'Confirm {n} selected hold(s) and generate invoice(s)?');
  else bulkPost('/gym-rentals/bookings/bulk-release', ids, 'Release {n} selected hold(s)?');
}
function bulkConfirmedAction(action) {
  const ids = getChecked('conf-cb');
  bulkPost('/gym-rentals/bookings/bulk-delete', ids, 'Delete {n} selected confirmed booking(s)? This cannot be undone.');
}
// Show/hide bulk buttons on checkbox change
document.addEventListener('change', function(e) {
  if (e.target.classList.contains('hold-cb')) {
    const any = document.querySelectorAll('.hold-cb:checked').length > 0;
    document.getElementById('bulk-confirm-btn').style.display = any ? '' : 'none';
    document.getElementById('bulk-release-btn').style.display = any ? '' : 'none';
  }
  if (e.target.classList.contains('conf-cb')) {
    const any = document.querySelectorAll('.conf-cb:checked').length > 0;
    document.getElementById('bulk-delete-btn').style.display = any ? '' : 'none';
  }
});
</script>`, 'Gym Rentals');
      }

      // ── GROUPS LIST ──────────────────────────────────────────
      if (path === '/gym-rentals/groups' && method === 'GET') {
        const groups = await env.DB.prepare('SELECT * FROM gym_groups ORDER BY name').all();
        const groupsHtml = groups.results.length === 0
          ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No groups yet. Add your first rental group.</div>`
          : groups.results.map(g => `
<div class="ni-row">
  <div style="flex:1;">
    <div style="font-family:var(--serif);font-size:16px;color:var(--steel);">${g.name}</div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);margin-top:3px;">${[g.contact,g.email,g.phone].filter(Boolean).join(' · ')}</div>
  </div>
  <div class="ni-meta">Max ${g.max_active_holds||3} holds</div>
  <span class="badge ${g.active ? 'badge-active' : 'badge-expired'}">${g.active ? 'Active' : 'Inactive'}</span>
  <div class="ni-actions">
    <a href="/gym-rentals/groups/edit/${g.id}" class="btn btn-sm btn-secondary">Edit</a>
  </div>
</div>`).join('');
        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">Rental Groups</div>
  <div class="page-sub">Each group gets a private booking link. Share it with them — no login required.</div>
  ${gymAlert}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/gym-rentals/groups/new" class="btn btn-primary">+ Add Group</a>
  </div>
  <div class="card">${groupsHtml}</div>
</div>`, 'Rental Groups');
      }

      // ── NEW GROUP FORM ───────────────────────────────────────
      if (path === '/gym-rentals/groups/new' && method === 'GET') {
        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals/groups">← Groups</a>`)}
<div class="wrap">
  <div class="page-title">Add Rental Group</div>
  <div class="page-sub">After saving, you'll see their private booking link to share.</div>
  <div class="card">
    <form method="POST" action="/gym-rentals/groups/create">
      <div class="form-group">
        <label>Group name *</label>
        <input type="text" name="name" required placeholder="e.g. St. Francis Basketball League">
      </div>
      <div class="form-group">
        <label>Contact person</label>
        <input type="text" name="contact" placeholder="John Smith">
      </div>
      <div class="form-group">
        <label>Contact email *</label>
        <input type="email" name="email" required placeholder="contact@example.com">
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input type="text" name="phone" placeholder="314-555-0100">
      </div>
      <div class="form-group">
        <label>Max simultaneous holds <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— prevents a group from holding too many dates at once (default: 3)</span></label>
        <input type="number" name="max_active_holds" value="3" min="1" max="20">
      </div>
      <div class="form-group">
        <label>Custom rate ($/hr) <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— leave blank to use global default</span></label>
        <input type="number" name="rate" step="0.01" min="0" placeholder="e.g. 20.00">
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— internal only, not shown to group</span></label>
        <textarea name="notes" maxlength="1000" placeholder="Internal notes about this group…"></textarea>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Save &amp; Get Link →</button>
        <a href="/gym-rentals/groups" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  </div>
</div>`, 'Add Group');
      }

      // ── CREATE GROUP ─────────────────────────────────────────
      if (path === '/gym-rentals/groups/create' && method === 'POST') {
        const form = await request.formData();
        const token = crypto.randomUUID().replace(/-/g, '');
        const customRate = parseFloat(form.get('rate') || '') || null;
        await env.DB.prepare(
          'INSERT INTO gym_groups (name, contact, email, phone, notes, access_token, max_active_holds, rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          form.get('name')||'', form.get('contact')||'', form.get('email')||'',
          form.get('phone')||'', form.get('notes')||'', token,
          parseInt(form.get('max_active_holds')||'3', 10), customRate
        ).run();
        const row = await env.DB.prepare('SELECT id FROM gym_groups WHERE access_token = ?').bind(token).first();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/groups/edit/${row.id}?msg=created` } });
      }

      // ── EDIT GROUP ───────────────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/edit/') && method === 'GET') {
        const gid = parseInt(path.split('/').pop(), 10);
        const g = await env.DB.prepare('SELECT * FROM gym_groups WHERE id = ?').bind(gid).first();
        if (!g) return new Response('Not found', { status: 404 });
        const portalLink = `${url.origin}/gym/book/${g.access_token}`;
        const em = url.searchParams.get('msg');
        const editAlert = em === 'created' ? `<div class="alert alert-success">✓ Group created! Share the booking link below with the group.</div>`
          : em === 'saved' ? `<div class="alert alert-success">✓ Changes saved.</div>`
          : em === 'regen' ? `<div class="alert alert-success">✓ New token generated. Old link no longer works — share the new one.</div>`
          : '';
        const esc = v => (v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals/groups">← Groups</a>`)}
<div class="wrap">
  <div class="page-title">${g.name}</div>
  <div class="page-sub">Edit group details and manage their booking link.</div>
  ${editAlert}
  <div class="card" style="background:var(--mist);border-color:var(--steel);">
    <div class="card-title">📋 Private Booking Link</div>
    <div style="font-family:var(--sans);font-size:13px;color:var(--charcoal);margin-bottom:12px;">Share this link with the group. The token in the URL is their key — no login needed.</div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <input type="text" id="portal-link" value="${portalLink}" readonly style="font-family:monospace;font-size:12px;background:white;flex:1;min-width:200px;">
      <button type="button" onclick="navigator.clipboard.writeText(document.getElementById('portal-link').value).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)})" class="btn btn-secondary btn-sm">Copy</button>
    </div>
    <div style="margin-top:14px;">
      <form method="POST" action="/gym-rentals/groups/regen-token/${g.id}" onsubmit="return confirm('This invalidates their current link. They will need the new URL to book. Continue?')">
        <button type="submit" class="btn btn-sm btn-danger">Regenerate token (old link stops working)</button>
      </form>
    </div>
  </div>
  <div class="card">
    <form method="POST" action="/gym-rentals/groups/update/${g.id}">
      <div class="form-group">
        <label>Group name *</label>
        <input type="text" name="name" required value="${esc(g.name)}">
      </div>
      <div class="form-group">
        <label>Contact person</label>
        <input type="text" name="contact" value="${esc(g.contact)}">
      </div>
      <div class="form-group">
        <label>Contact email</label>
        <input type="email" name="email" value="${esc(g.email)}">
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input type="text" name="phone" value="${esc(g.phone)}">
      </div>
      <div class="form-group">
        <label>Max simultaneous holds</label>
        <input type="number" name="max_active_holds" value="${g.max_active_holds||3}" min="1" max="20">
      </div>
      <div class="form-group">
        <label>Custom rate ($/hr) <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— leave blank to use global default</span></label>
        <input type="number" name="rate" step="0.01" min="0" value="${g.rate != null ? g.rate : ''}" placeholder="e.g. 20.00">
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— internal only</span></label>
        <textarea name="notes" maxlength="1000">${(g.notes||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>
      </div>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary">Save changes →</button>
      </div>
    </form>
    <hr style="border:none;border-top:1px solid var(--border);margin:24px 0;">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <form method="POST" action="/gym-rentals/groups/toggle/${g.id}" style="display:inline;">
        <button type="submit" class="btn ${g.active ? 'btn-danger' : 'btn-sage'}">${g.active ? 'Deactivate group (disables portal access)' : 'Reactivate group'}</button>
      </form>
      <form method="POST" action="/gym-rentals/groups/delete/${g.id}" style="display:inline;" onsubmit="return confirm('Permanently delete ${g.name.replace(/'/g,"\\'")} and all their bookings and invoices? This cannot be undone.')">
        <button type="submit" class="btn btn-danger">Delete group permanently</button>
      </form>
    </div>
  </div>
</div>`, `Edit — ${g.name}`);
      }

      // ── UPDATE GROUP ─────────────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/update/') && method === 'POST') {
        const gid = parseInt(path.split('/').pop(), 10);
        const form = await request.formData();
        const updatedRate = parseFloat(form.get('rate') || '') || null;
        await env.DB.prepare('UPDATE gym_groups SET name=?,contact=?,email=?,phone=?,notes=?,max_active_holds=?,rate=? WHERE id=?')
          .bind(form.get('name')||'', form.get('contact')||'', form.get('email')||'', form.get('phone')||'', form.get('notes')||'', parseInt(form.get('max_active_holds')||'3',10), updatedRate, gid).run();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/groups/edit/${gid}?msg=saved` } });
      }

      // ── TOGGLE GROUP ACTIVE ───────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/toggle/') && method === 'POST') {
        const gid = parseInt(path.split('/').pop(), 10);
        const g = await env.DB.prepare('SELECT active FROM gym_groups WHERE id=?').bind(gid).first();
        if (g) await env.DB.prepare('UPDATE gym_groups SET active=? WHERE id=?').bind(g.active ? 0 : 1, gid).run();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/groups/edit/${gid}?msg=saved` } });
      }

      // ── REGENERATE TOKEN ──────────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/regen-token/') && method === 'POST') {
        const gid = parseInt(path.split('/').pop(), 10);
        const token = crypto.randomUUID().replace(/-/g, '');
        await env.DB.prepare('UPDATE gym_groups SET access_token=? WHERE id=?').bind(token, gid).run();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/groups/edit/${gid}?msg=regen` } });
      }

      // ── DELETE GROUP ──────────────────────────────────────────
      if (path.startsWith('/gym-rentals/groups/delete/') && method === 'POST') {
        const gid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare('DELETE FROM gym_invoices WHERE group_id=?').bind(gid).run();
        await env.DB.prepare('DELETE FROM gym_bookings WHERE group_id=?').bind(gid).run();
        await env.DB.prepare('DELETE FROM gym_recurrences WHERE group_id=?').bind(gid).run();
        await env.DB.prepare('DELETE FROM gym_groups WHERE id=?').bind(gid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/groups?msg=deleted' } });
      }

      // ── GCAL TEST ────────────────────────────────────────────
      if (path === '/gym-rentals/test-gcal' && method === 'GET') {
        const steps = [];
        // Step 1: check secrets
        const rawEmail = env.GCAL_SERVICE_ACCOUNT_EMAIL || '';
        const hasEmail = !!rawEmail;
        const cleanEmail = rawEmail.trim();
        const emailOk = hasEmail && cleanEmail === rawEmail && cleanEmail.endsWith('.gserviceaccount.com');
        steps.push({ ok: emailOk, label: 'GCAL_SERVICE_ACCOUNT_EMAIL secret', detail: hasEmail ? `"${cleanEmail}" (${rawEmail.length} chars${rawEmail !== cleanEmail ? ' — WARNING: has leading/trailing whitespace' : ''})` : 'NOT SET' });
        const hasKey = !!env.GCAL_PRIVATE_KEY;
        const keyHasHeader = hasKey && (env.GCAL_PRIVATE_KEY.includes('BEGIN PRIVATE KEY') || env.GCAL_PRIVATE_KEY.includes('BEGIN RSA PRIVATE KEY'));
        steps.push({ ok: hasKey && keyHasHeader, label: 'GCAL_PRIVATE_KEY secret', detail: hasKey ? `(${env.GCAL_PRIVATE_KEY.length} chars${keyHasHeader ? ', header found ✓' : ' — WARNING: missing -----BEGIN PRIVATE KEY----- header'})` : 'NOT SET' });
        // Step 2: calendar ID in settings
        const calRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gcal_calendar_id'").first();
        const calId  = calRow?.value || '';
        steps.push({ ok: !!calId, label: 'Google Calendar ID (in Settings tab)', detail: calId || 'EMPTY — set this in Settings before continuing' });
        // Step 3: JWT build + sign
        let token = null, jwtError = '';
        if (hasEmail && hasKey) {
          try {
            const now  = Math.floor(Date.now() / 1000);
            const b64u = obj => btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
            const hdr  = b64u({ alg:'RS256', typ:'JWT' });
            const pay  = b64u({ iss: env.GCAL_SERVICE_ACCOUNT_EMAIL, scope:'https://www.googleapis.com/auth/calendar.events', aud:'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
            const sigInput = `${hdr}.${pay}`;
            const pem  = env.GCAL_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/-----[^-]+-----/g,'').replace(/\s/g,'');
            const keyBuf = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
            const key  = await crypto.subtle.importKey('pkcs8', keyBuf.buffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
            const sig  = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput));
            const jwt  = `${sigInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
            steps.push({ ok: true, label: 'JWT built and signed (crypto.subtle)', detail: 'Key parsed and signed successfully' });
            // Step 4: exchange JWT for token
            const tokenRes  = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' },
              body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
            });
            const tokenBody = await tokenRes.json();
            token = tokenBody.access_token || null;
            steps.push({ ok: !!token, label: 'OAuth access token from Google', detail: token ? '(received)' : `FAILED (${tokenRes.status}): ${tokenBody.error || ''} — ${tokenBody.error_description || JSON.stringify(tokenBody)}` });
          } catch (e) {
            steps.push({ ok: false, label: 'JWT built and signed (crypto.subtle)', detail: `ERROR: ${e.message}` });
          }
        }
        // Step 4: create test event
        let eventCreated = false, eventError = '';
        if (token && calId) {
          const today = new Date().toISOString().split('T')[0];
          const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              summary: 'TLC Admin — GCal Test Event (safe to delete)',
              description: 'Created by the admin test page. You can delete this.',
              start: { dateTime: `${today}T10:00:00`, timeZone: 'America/Chicago' },
              end:   { dateTime: `${today}T11:00:00`, timeZone: 'America/Chicago' },
            }),
          });
          if (res.ok) {
            eventCreated = true;
          } else {
            const body = await res.json().catch(() => ({}));
            eventError = body?.error?.message || `HTTP ${res.status}`;
          }
          steps.push({ ok: eventCreated, label: 'Create test event on calendar', detail: eventCreated ? 'Event created — check your calendar' : `FAILED: ${eventError}` });
        }
        const stepsHtml = steps.map(s => `
<div style="display:flex;align-items:flex-start;gap:14px;padding:12px 0;border-bottom:1px solid var(--border);">
  <span style="font-size:18px;flex-shrink:0;">${s.ok ? '✅' : '❌'}</span>
  <div>
    <div style="font-family:var(--sans);font-size:14px;font-weight:700;color:var(--charcoal);">${s.label}</div>
    <div style="font-family:var(--sans);font-size:13px;color:${s.ok ? 'var(--gray)' : '#B85C3A'};margin-top:2px;">${s.detail}</div>
  </div>
</div>`).join('');
        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals">← Gym Rentals</a>`)}
<div class="wrap">
  <div class="page-title">Google Calendar — Connection Test</div>
  <div class="page-sub">Checks secrets, access token, and creates a test event on your calendar.</div>
  <div class="card">${stepsHtml}</div>
  ${eventCreated ? `<div class="alert alert-success">✓ Everything is working. A test event was added to your calendar — check it and delete it.</div>` : ''}
  <div style="margin-top:8px;"><a href="/gym-rentals/test-gcal" class="btn btn-secondary">Run test again</a></div>
</div>`, 'GCal Test');
      }

      // ── BLOCKED DATES CALENDAR ───────────────────────────────
      if (path === '/gym-rentals/blocked' && method === 'GET') {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const sixMonthsOut = new Date(today.getFullYear(), today.getMonth() + 6, 1).toISOString().split('T')[0];

        const [blocked, bookings] = await Promise.all([
          env.DB.prepare('SELECT date FROM gym_blocked_dates WHERE date >= ?').bind(todayStr).all(),
          env.DB.prepare("SELECT DISTINCT booking_date FROM gym_bookings WHERE status IN ('confirmed','hold') AND booking_date >= ?").bind(todayStr).all(),
        ]);
        const blockedSet = new Set(blocked.results.map(b => b.date));
        const bookingSet = new Set(bookings.results.map(b => b.booking_date));

        // Build 3-month admin block calendar
        const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        let calHtml = '<div class="cal-grid">';
        for (let i = 0; i < 3; i++) {
          const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
          const yr = d.getFullYear(), mo = d.getMonth();
          const lastDay = new Date(yr, mo + 1, 0);
          const startDow = d.getDay();
          calHtml += `<div class="cal-month"><div class="cal-month-name">${MONTHS[mo]} ${yr}</div>
<table class="cal-table"><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr><tr>`;
          for (let s = 0; s < startDow; s++) calHtml += '<td></td>';
          let dow = startDow;
          for (let day = 1; day <= lastDay.getDate(); day++) {
            const mm = (mo + 1).toString().padStart(2, '0');
            const dd = day.toString().padStart(2, '0');
            const ds = `${yr}-${mm}-${dd}`;
            const isPast = ds < todayStr;
            const isBlocked = blockedSet.has(ds);
            const hasBooking = bookingSet.has(ds);
            let cls = 'bcal-day';
            if (isPast) cls += ' bcal-past';
            else if (isBlocked) cls += ' bcal-blocked';
            else if (hasBooking) cls += ' bcal-has-booking';
            const dot = hasBooking && !isBlocked ? `<span class="bcal-dot"></span>` : '';
            const attrs = isPast ? '' : `data-date="${ds}" data-blocked="${isBlocked ? '1' : '0'}"`;
            calHtml += `<td><span class="${cls}" ${attrs}>${day}${dot}</span></td>`;
            dow++;
            if (dow === 7 && day < lastDay.getDate()) { calHtml += '</tr><tr>'; dow = 0; }
          }
          while (dow > 0 && dow < 7) { calHtml += '<td></td>'; dow++; }
          calHtml += '</tr></table></div>';
        }
        calHtml += '</div>';

        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals">← Dashboard</a>`)}
<style>
.bcal-day{display:block;width:34px;height:34px;line-height:34px;border-radius:50%;margin:0 auto;font-size:13px;font-weight:600;text-align:center;position:relative;cursor:pointer;color:var(--steel);}
.bcal-past{color:#CBD5E1;cursor:default;}
.bcal-blocked{background:#fce8e8;color:#7a1f1f;cursor:pointer;}
.bcal-blocked.bcal-pending-unblock{background:transparent;color:#CBD5E1;text-decoration:line-through;}
.bcal-has-booking{color:var(--steel);}
.bcal-selected{background:var(--amber);color:white;}
.bcal-dot{display:block;width:5px;height:5px;border-radius:50%;background:var(--amber);position:absolute;bottom:2px;left:50%;transform:translateX(-50%);}
.bcal-selected .bcal-dot{background:white;}
.bcal-legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--gray);margin-top:12px;}
.bcal-legend span{display:flex;align-items:center;gap:6px;}
</style>
<div class="wrap">
  <div class="page-title">Blocked Dates</div>
  <div class="page-sub">Click dates to select them, then save. Already-blocked dates (red) can be clicked to unblock.</div>
  ${gymAlert}
  <div class="card">
    <div class="card-title">Select dates to block or unblock</div>
    ${calHtml}
    <div class="bcal-legend" style="margin-bottom:16px;">
      <span><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:#fce8e8;border:1px solid #e8a0a0;"></span> Currently blocked</span>
      <span><span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--amber);"></span> Selected to block</span>
      <span><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--amber);vertical-align:middle;margin:0 4px;"></span> Has booking (still blockable)</span>
    </div>
    <form id="block-form" method="POST" action="/gym-rentals/blocked/batch">
      <div id="block-inputs"></div>
      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:4px;">
        <div class="form-group" style="flex:1;min-width:200px;margin-bottom:0;">
          <label>Reason for new blocked dates (optional)</label>
          <input type="text" name="reason" placeholder="e.g. Church event, Holiday">
        </div>
        <button type="submit" class="btn btn-primary" style="flex-shrink:0;" id="save-btn">Save changes</button>
        <a href="/gym-rentals/blocked" class="btn btn-secondary" style="flex-shrink:0;text-decoration:none;">Reset</a>
      </div>
      <div id="selection-summary" style="font-size:13px;color:var(--gray);margin-top:10px;"></div>
    </form>
  </div>
</div>
<script>
const toBlock = new Set();
const toUnblock = new Set();

document.querySelectorAll('.bcal-day[data-date]').forEach(el => {
  el.addEventListener('click', function() {
    const date = this.dataset.date;
    const wasBlocked = this.dataset.blocked === '1';
    if (wasBlocked) {
      if (toUnblock.has(date)) {
        toUnblock.delete(date);
        this.classList.remove('bcal-pending-unblock');
      } else {
        toUnblock.add(date);
        this.classList.add('bcal-pending-unblock');
      }
    } else {
      if (toBlock.has(date)) {
        toBlock.delete(date);
        this.classList.remove('bcal-selected');
      } else {
        toBlock.add(date);
        this.classList.add('bcal-selected');
      }
    }
    updateSummary();
  });
});

function updateSummary() {
  const inp = document.getElementById('block-inputs');
  inp.innerHTML = '';
  toBlock.forEach(d => {
    const h = document.createElement('input');
    h.type = 'hidden'; h.name = 'to_block'; h.value = d;
    inp.appendChild(h);
  });
  toUnblock.forEach(d => {
    const h = document.createElement('input');
    h.type = 'hidden'; h.name = 'to_unblock'; h.value = d;
    inp.appendChild(h);
  });
  const parts = [];
  if (toBlock.size) parts.push(toBlock.size + ' date(s) to block');
  if (toUnblock.size) parts.push(toUnblock.size + ' date(s) to unblock');
  document.getElementById('selection-summary').textContent = parts.length ? parts.join(' · ') : 'No changes selected.';
  document.getElementById('save-btn').disabled = !parts.length;
}
updateSummary();
</script>
`, 'Blocked Dates');
      }

      if (path === '/gym-rentals/blocked/batch' && method === 'POST') {
        const form = await request.formData();
        const reason = form.get('reason') || '';
        const toBlock   = form.getAll('to_block');
        const toUnblock = form.getAll('to_unblock');
        for (const d of toBlock) {
          try { await env.DB.prepare('INSERT OR REPLACE INTO gym_blocked_dates (date, reason) VALUES (?, ?)').bind(d, reason).run(); } catch (_) {}
        }
        for (const d of toUnblock) {
          try { await env.DB.prepare('DELETE FROM gym_blocked_dates WHERE date = ?').bind(d).run(); } catch (_) {}
        }
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/blocked?msg=saved' } });
      }

      // Keep single-date add/delete for backward compatibility
      if (path === '/gym-rentals/blocked/add' && method === 'POST') {
        const form = await request.formData();
        const bdate = form.get('date');
        if (bdate) {
          try { await env.DB.prepare('INSERT OR REPLACE INTO gym_blocked_dates (date, reason) VALUES (?, ?)').bind(bdate, form.get('reason')||'').run(); } catch (_) {}
        }
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/blocked?msg=saved' } });
      }

      if (path.startsWith('/gym-rentals/blocked/delete/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare('DELETE FROM gym_blocked_dates WHERE id=?').bind(bid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/blocked?msg=deleted' } });
      }

      // ── RELEASE HOLD (admin action from dashboard) ────────────
      if (path.startsWith('/gym-rentals/bookings/release/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare("UPDATE gym_bookings SET status='released' WHERE id=? AND status='hold'").bind(bid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals?msg=saved' } });
      }

      // ── DELETE CONFIRMED BOOKING ──────────────────────────────
      if (path.startsWith('/gym-rentals/bookings/delete/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare("DELETE FROM gym_bookings WHERE id=? AND status='confirmed'").bind(bid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals?msg=deleted' } });
      }

      // ── DELETE RECURRING CONFIRMED BOOKINGS ───────────────────
      if (path.startsWith('/gym-rentals/bookings/delete-recurring/') && method === 'POST') {
        const rid = parseInt(path.split('/').pop(), 10);
        const today = new Date().toISOString().split('T')[0];
        await env.DB.prepare("DELETE FROM gym_bookings WHERE recurrence_id=? AND status='confirmed' AND booking_date >= ?").bind(rid, today).run();
        await env.DB.prepare("UPDATE gym_recurrences SET status='cancelled' WHERE id=?").bind(rid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals?msg=deleted' } });
      }

      // ── API: GROUP RATE ──────────────────────────────────────
      if (path === '/gym-rentals/api/group-rate' && method === 'GET') {
        const gid = parseInt(url.searchParams.get('id') || '0', 10);
        if (!gid) return new Response(JSON.stringify({ rate: 25 }), { headers: { 'Content-Type': 'application/json' } });
        const g = await env.DB.prepare('SELECT rate FROM gym_groups WHERE id = ?').bind(gid).first();
        const r = await getGroupRate(env, g || {});
        return new Response(JSON.stringify({ rate: r }), { headers: { 'Content-Type': 'application/json' } });
      }

      // ── NEW BOOKING FORM ──────────────────────────────────────
      if (path === '/gym-rentals/bookings/new' && method === 'GET') {
        const groups = await env.DB.prepare('SELECT id, name, rate FROM gym_groups WHERE active = 1 ORDER BY name').all();
        const selGroup     = url.searchParams.get('grp')       || '';
        const selNotes     = url.searchParams.get('notes')     || '';
        const selRate      = url.searchParams.get('rate')      || '';
        const selRateType  = url.searchParams.get('rate_type') || 'hourly';
        const selSlotsRaw  = url.searchParams.get('slots')     || '';
        const errParam    = url.searchParams.get('err');
        const errAlert    = errParam === 'nodates'  ? `<div class="alert alert-error">Please select at least one date and set its times.</div>`
          : errParam === 'times'    ? `<div class="alert alert-error">Each selected date needs a valid start and end time (end must be after start).</div>`
          : errParam === 'nogroup'  ? `<div class="alert alert-error">Please select a group.</div>`
          : '';

        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_rate_per_hour'").first();
        const globalRate = rateRow ? parseFloat(rateRow.value || '25').toFixed(2) : '25.00';

        const groupOptions = groups.results.map(g =>
          `<option value="${g.id}" data-rate="${g.rate || ''}"${selGroup == g.id ? ' selected' : ''}>${g.name}</option>`).join('');

        // Build calendar server-side
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const sixMonthsOut = new Date(today); sixMonthsOut.setMonth(today.getMonth() + 6);
        const sixMonStr = sixMonthsOut.toISOString().split('T')[0];

        const [bookedRows, blockedRows] = await Promise.all([
          env.DB.prepare(`SELECT booking_date FROM gym_bookings WHERE booking_date >= ? AND booking_date <= ? AND status IN ('confirmed','hold')`).bind(todayStr, sixMonStr).all(),
          env.DB.prepare(`SELECT date FROM gym_blocked_dates WHERE date >= ? AND date <= ?`).bind(todayStr, sixMonStr).all(),
        ]);
        const bookedSet  = new Set(bookedRows.results.map(r => r.booking_date));
        const blockedSet = new Set(blockedRows.results.map(r => r.date));

        // Calendar container — cells are built by JS renderCalendar() using createElement + addEventListener
        // (matching the pattern from the childcare portal: create element, wire click, then append)


        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">New Booking</div>
  <div class="page-sub">Click dates, set times, then review before sending an invoice.</div>
  ${errAlert}
  <div class="card">
    <form id="nbf" method="POST" action="/gym-rentals/bookings/review">
      <div class="form-group">
        <label>Group *</label>
        <select name="group_id" id="group-sel" required>
          <option value="">— select group —</option>
          ${groupOptions}
        </select>
      </div>

      <div class="form-group">
        <label>Dates * <span id="date-count" style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--amber);font-size:13px;"></span></label>
        <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">Tap any date to select it. Tap again to deselect.</div>
        <div class="scal-wrap" id="adm-cal">
          <div class="scal-nav">
            <button type="button" class="scal-nav-btn" id="scal-prev" disabled>&#8249;</button>
            <div class="scal-nav-label" id="scal-nav-label"></div>
            <button type="button" class="scal-nav-btn" id="scal-next">&#8250;</button>
          </div>
          <div class="scal-grid" id="adm-cal-grid"></div>
        </div>
        <div style="margin-top:12px;margin-bottom:4px;">
          <span style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">Quick-add by day of week:</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">
            <button type="button" class="pat-btn" data-dow="0">Sun</button>
            <button type="button" class="pat-btn" data-dow="1">Mon</button>
            <button type="button" class="pat-btn" data-dow="2">Tue</button>
            <button type="button" class="pat-btn" data-dow="3">Wed</button>
            <button type="button" class="pat-btn" data-dow="4">Thu</button>
            <button type="button" class="pat-btn" data-dow="5">Fri</button>
            <button type="button" class="pat-btn" data-dow="6">Sat</button>
            <button type="button" id="add-pattern-btn" class="btn btn-sm btn-secondary" style="margin-left:6px;" disabled>Add selected days</button>
            <button type="button" id="clear-all-btn" class="btn btn-sm btn-secondary" style="display:none;">Clear all</button>
          </div>
        </div>
      </div>

      <!-- Times + date list -->
      <div style="margin:0 0 16px;padding:14px 16px;background:var(--mist);border-radius:8px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);">
          <span style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);white-space:nowrap;">Default time:</span>
          <select id="def-start" style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;min-width:100px;background:white;"></select>
          <span style="font-size:12px;color:var(--gray);">to</span>
          <select id="def-end"   style="font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;min-width:100px;background:white;"></select>
          <button type="button" id="apply-all-btn" class="btn btn-sm btn-secondary">Apply to all</button>
          <span style="font-size:11px;color:var(--gray);">— new dates auto-use this time</span>
        </div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:8px;">Selected Dates &amp; Times</div>
        <div id="date-list"><div style="font-size:13px;color:var(--gray);font-style:italic;">No dates added yet.</div></div>
      </div>

      <div class="form-group" style="margin-top:18px;">
        <label>Rate type</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-top:6px;">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;cursor:pointer;">
            <input type="radio" name="rate_type" value="hourly"${selRateType !== 'daily' ? ' checked' : ''}> Per hour
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0;font-size:14px;cursor:pointer;">
            <input type="radio" name="rate_type" value="daily"${selRateType === 'daily' ? ' checked' : ''}> Per day (flat rate)
          </label>
        </div>
      </div>
      <div class="form-group">
        <label>Rate override <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;" id="rate-hint">— leave blank to use group/global rate ($${globalRate}/hr)</span></label>
        <input type="number" name="rate_override" id="rate-override" step="0.01" min="0" placeholder="${globalRate}" value="${selRate}" style="max-width:140px;">
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— included on the invoice</span></label>
        <textarea name="notes" maxlength="1000" placeholder="e.g. Basketball practice, weekly session">${selNotes.replace(/</g,'&lt;')}</textarea>
      </div>
      <!-- Pre-filled slots from back-navigation (read by JS via DOM, no injection) -->
      <input type="hidden" id="initial-slots" value="${selSlotsRaw.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">
      <input type="hidden" id="booked-dates" value="${JSON.stringify([...bookedSet]).replace(/"/g,'&quot;')}">
      <input type="hidden" id="blocked-dates" value="${JSON.stringify([...blockedSet]).replace(/"/g,'&quot;')}">
      <input type="hidden" id="today-str" value="${todayStr}">
      <input type="hidden" name="slots" id="slots-json">
      <div class="btn-row">
        <button type="submit" class="btn btn-primary" id="review-btn" disabled>Review →</button>
        <a href="/gym-rentals" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  </div>
</div>
<style>
.scal-wrap{position:relative;}.scal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px;}.scal-nav-btn{background:var(--mist,#EDF5F8);border:1px solid var(--border,#E8E0D0);cursor:pointer;padding:8px 18px;border-radius:6px;font-size:18px;line-height:1;font-weight:700;transition:background .15s;flex-shrink:0;color:var(--steel,#1E2D4A);touch-action:manipulation;}.scal-nav-btn:hover{background:var(--border,#E8E0D0);}.scal-nav-btn:disabled{opacity:.35;cursor:default;}.scal-nav-label{font-family:var(--serif,Georgia,serif);font-size:18px;font-weight:700;text-align:center;flex:1;color:var(--steel,#1E2D4A);}.scal-month{display:none;}.scal-month.active{display:block;}
.scal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
.scal-dow{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gray,#6B7280);padding:6px 0;text-align:center;}
.adm-cell{border-radius:6px;text-align:center;padding:10px 2px;font-size:13px;font-weight:700;border:2px solid transparent;transition:background .12s,border-color .12s,transform .1s;line-height:1;font-family:inherit;color:var(--steel,#1E2D4A);min-width:0;overflow:hidden;}
div.adm-avail{cursor:pointer;background:#fff;border-color:#ddd;}
div.adm-avail:hover{background:#D4EDDA;border-color:#5A9E6F;transform:scale(1.06);}
div.adm-avail.adm-selected{background:#C9973A !important;border-color:#A07020 !important;color:white !important;}
.adm-booked{background:#F7D0D0;color:#9B4040;}
.adm-blocked{background:#E8EDF3;color:#CBD5E1;}
.adm-past{color:#CBD5E1;}
.date-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#E8E0D0);flex-wrap:wrap;}
.date-row:last-child{border-bottom:none;}
.date-row-label{font-family:var(--sans,Arial,sans-serif);font-size:13px;font-weight:700;color:var(--steel,#1E2D4A);min-width:160px;}
.date-row select{font-size:13px;padding:6px 10px;border:1px solid var(--border,#E8E0D0);border-radius:6px;background:white;color:var(--charcoal,#1A1A2A);min-width:110px;}
.date-row .btn-rm{background:none;border:1px solid #ddd;border-radius:4px;color:#999;cursor:pointer;font-size:14px;padding:4px 8px;line-height:1;}
.date-row .btn-rm:hover{background:#fce8e8;border-color:#B85C3A;color:#B85C3A;}
.pat-btn{font-family:var(--sans,Arial,sans-serif);font-size:12px;font-weight:700;padding:5px 10px;border-radius:6px;border:1px solid var(--border,#E8E0D0);background:white;cursor:pointer;color:var(--steel,#1E2D4A);transition:background .12s,border-color .12s;}
.pat-btn.active{background:#1E2D4A;color:white;border-color:#1E2D4A;}
</style>
<script>
(function(){
  function buildTimeOpts(selected) {
    var opts = '<option value="">—</option>';
    for (var h = 6; h < 24; h++) {
      for (var mi = 0; mi < 2; mi++) {
        var m = mi === 0 ? 0 : 30;
        var hh = h < 10 ? '0'+h : ''+h;
        var mm = m === 0 ? '00' : '30';
        var val = hh+':'+mm;
        var disp = (h===0?12:h>12?h-12:h)+':'+(m===0?'00':'30')+' '+(h<12?'AM':'PM');
        opts += '<option value="'+val+'"'+(selected===val?' selected':'')+'>'+disp+'</option>';
      }
    }
    return opts;
  }

  /* Populate default-time selects */
  var defStart = document.getElementById('def-start');
  var defEnd   = document.getElementById('def-end');
  defStart.innerHTML = buildTimeOpts('');
  defEnd.innerHTML   = buildTimeOpts('');

  var slots = [];
  var selectedDows = {};  /* day-of-week toggles */
  var DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MNAMES    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var TODAY_STR = document.getElementById('today-str').value;
  var BOOKED  = new Set(JSON.parse(document.getElementById('booked-dates').value  || '[]'));
  var BLOCKED = new Set(JSON.parse(document.getElementById('blocked-dates').value || '[]'));

  /* Parse today to seed the calendar date */
  var _tp    = TODAY_STR.split('-');
  var calDate = new Date(+_tp[0], +_tp[1]-1, 1);  /* first of current month */
  var monthOffset = 0;
  var NUM_MONTHS  = 6;

  function isInSlots(ds) {
    for (var i = 0; i < slots.length; i++) { if (slots[i].date === ds) return true; }
    return false;
  }
  function addToSlots(ds, label) {
    if (isInSlots(ds)) return;
    slots.push({date: ds, label: label, start: defStart.value, end: defEnd.value});
  }
  function removeFromSlots(ds) {
    slots = slots.filter(function(s){ return s.date !== ds; });
  }

  /* renderCalendar — builds cells with createElement + addEventListener (iOS-safe) */
  function renderCalendar() {
    var year  = calDate.getFullYear();
    var month = calDate.getMonth();
    var grid  = document.getElementById('adm-cal-grid');
    grid.innerHTML = '';

    document.getElementById('scal-nav-label').textContent =
      new Date(year, month, 1).toLocaleDateString('en-US', {month:'long', year:'numeric'});
    document.getElementById('scal-prev').disabled = monthOffset <= 0;
    document.getElementById('scal-next').disabled = monthOffset >= NUM_MONTHS - 1;

    /* Day-of-week headers */
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(function(d) {
      var h = document.createElement('div');
      h.className = 'scal-dow';
      h.textContent = d;
      grid.appendChild(h);
    });

    /* Leading empty cells */
    var firstDow = new Date(year, month, 1).getDay();
    for (var i = 0; i < firstDow; i++) { grid.appendChild(document.createElement('div')); }

    var daysInMonth = new Date(year, month + 1, 0).getDate();
    for (var day = 1; day <= daysInMonth; day++) {
      var mm  = (month + 1).toString().padStart(2, '0');
      var dd  = day.toString().padStart(2, '0');
      var ds  = year + '-' + mm + '-' + dd;
      var isPast    = ds < TODAY_STR;
      var isBooked  = BOOKED.has(ds);
      var isBlocked = BLOCKED.has(ds);
      var selected  = isInSlots(ds);

      var cell = document.createElement('div');
      cell.textContent = day;

      if (!isPast && !isBooked && !isBlocked) {
        var lbl = DOW_NAMES[new Date(ds+'T12:00:00').getDay()] + ', ' + MNAMES[month] + ' ' + day + ', ' + year;
        cell.className = 'adm-cell adm-avail' + (selected ? ' adm-selected' : '');
        cell.id = 'adm-cell-' + ds;
        /* Create element, wire click, then append — this is the pattern that works on iOS */
        cell.addEventListener('click', (function(dateStr, label) {
          return function(e) {
            e.stopPropagation();
            if (isInSlots(dateStr)) { removeFromSlots(dateStr); } else { addToSlots(dateStr, label); }
            slots.sort(function(a,b){ return a.date < b.date ? -1 : 1; });
            renderCalendar();
            renderList();
            updateCounter();
            document.getElementById('date-list').scrollIntoView({behavior:'smooth', block:'nearest'});
          };
        })(ds, lbl));
      } else {
        cell.className = 'adm-cell ' + (isPast ? 'adm-past' : isBlocked ? 'adm-blocked' : 'adm-booked');
        if (!isPast) cell.title = isBlocked ? 'Blocked' : 'Already booked';
      }
      grid.appendChild(cell);
    }
  }

  /* Month navigation */
  document.getElementById('scal-prev').addEventListener('click', function() {
    if (monthOffset <= 0) return;
    monthOffset--;
    calDate.setMonth(calDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('scal-next').addEventListener('click', function() {
    if (monthOffset >= NUM_MONTHS - 1) return;
    monthOffset++;
    calDate.setMonth(calDate.getMonth() + 1);
    renderCalendar();
  });

  /* Day-of-week pattern picker */
  document.querySelectorAll('.pat-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var dow = this.getAttribute('data-dow');
      if (selectedDows[dow]) {
        delete selectedDows[dow];
        this.classList.remove('active');
      } else {
        selectedDows[dow] = true;
        this.classList.add('active');
      }
      var count = Object.keys(selectedDows).length;
      document.getElementById('add-pattern-btn').disabled = count === 0;
      var pc = document.getElementById('pat-count'); if (pc) pc.textContent = count > 0 ? count+' day'+(count===1?'':'s')+' selected' : '';
    });
  });

  document.getElementById('add-pattern-btn').addEventListener('click', function() {
    var dows = Object.keys(selectedDows).map(Number);
    if (!dows.length) return;
    var added = 0;
    /* Iterate over the 6-month window and add matching available days */
    var d = new Date(TODAY_STR + 'T12:00:00');
    var endD = new Date(TODAY_STR + 'T12:00:00');
    endD.setMonth(endD.getMonth() + NUM_MONTHS);
    while (d <= endD) {
      if (dows.indexOf(d.getDay()) !== -1) {
        var yr = d.getFullYear();
        var mo = (d.getMonth()+1).toString().padStart(2,'0');
        var dy = d.getDate().toString().padStart(2,'0');
        var ds = yr+'-'+mo+'-'+dy;
        if (!BOOKED.has(ds) && !BLOCKED.has(ds) && !isInSlots(ds)) {
          var lbl = DOW_NAMES[d.getDay()] + ', ' + MNAMES[d.getMonth()] + ' ' + d.getDate() + ', ' + yr;
          addToSlots(ds, lbl);
          added++;
        }
      }
      d.setDate(d.getDate() + 1);
    }
    if (added) {
      slots.sort(function(a,b){ return a.date < b.date ? -1 : 1; });
      renderCalendar();
      renderList();
      updateCounter();
    }
  });


  /* Apply default times to all slots */
  document.getElementById('apply-all-btn').addEventListener('click', function() {
    var st = defStart.value;
    var et = defEnd.value;
    slots.forEach(function(s) { s.start = st; s.end = et; });
    renderList();
    checkReview();
  });

  function getDow(dateStr) { return new Date(dateStr+'T12:00:00').getDay(); }

  function renderList() {
    var el = document.getElementById('date-list');
    if (slots.length === 0) {
      el.innerHTML = '<div style="font-size:13px;color:#6B7280;font-style:italic;">No dates added yet.</div>';
      checkReview();
      return;
    }
    var html = '';
    slots.forEach(function(s) {
      var dow = getDow(s.date);
      var dowName = DOW_NAMES[dow];
      /* Count how many other slots share this day-of-week */
      var sameCount = slots.filter(function(x){ return x.date!==s.date && getDow(x.date)===dow; }).length;
      var copyBtn = sameCount > 0
        ? '<button type="button" class="btn-rm copy-dow-btn" data-copy="'+s.date+'" title="Copy these times to all other '+dowName+'s" style="font-size:11px;padding:3px 7px;color:var(--steel,#1E2D4A);border-color:#bbb;">Copy to all '+dowName+'s</button>'
        : '';
      html += '<div class="date-row" id="row-'+s.date+'">'
        +'<span class="date-row-label">'+s.label+'</span>'
        +'<span style="font-size:12px;color:#6B7280;white-space:nowrap;">Start:</span>'
        +'<select id="start-'+s.date+'">'+buildTimeOpts(s.start)+'</select>'
        +'<span style="font-size:12px;color:#6B7280;white-space:nowrap;">End:</span>'
        +'<select id="end-'+s.date+'">'+buildTimeOpts(s.end)+'</select>'
        +copyBtn
        +'<button type="button" class="btn-rm" data-rm="'+s.date+'">&#x2715;</button>'
        +'</div>';
    });
    el.innerHTML = html;
    slots.forEach(function(s) {
      var ss = document.getElementById('start-'+s.date);
      var ee = document.getElementById('end-'+s.date);
      if (ss) ss.addEventListener('change', function(){ s.start = this.value; checkReview(); });
      if (ee) ee.addEventListener('change', function(){ s.end   = this.value; checkReview(); });
    });
    el.querySelectorAll('[data-rm]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        removeFromSlots(this.getAttribute('data-rm'));
        renderCalendar();
        renderList();
        updateCounter();
      });
    });
    el.querySelectorAll('.copy-dow-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var srcDate = this.getAttribute('data-copy');
        var src = slots.find(function(s){ return s.date===srcDate; });
        if (!src) return;
        var srcDow = getDow(srcDate);
        slots.forEach(function(s) {
          if (s.date !== srcDate && getDow(s.date) === srcDow) {
            s.start = src.start; s.end = src.end;
          }
        });
        renderList();
        checkReview();
      });
    });
    checkReview();
  }

  function updateCounter() {
    var n = slots.length;
    document.getElementById('date-count').textContent = n > 0 ? '('+n+' date'+(n===1?'':'s')+' selected)' : '';
    var clearBtn = document.getElementById('clear-all-btn');
    if (clearBtn) clearBtn.style.display = n > 0 ? 'inline-flex' : 'none';
    checkReview();
  }

  /* Clear all dates */
  var clearAllBtn = document.getElementById('clear-all-btn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', function() {
      slots = [];
      renderCalendar();
      renderList();
      updateCounter();
    });
  }

  function checkReview() {
    var ok = slots.length > 0 && slots.every(function(s){ return s.start && s.end && s.end > s.start; });
    document.getElementById('review-btn').disabled = !ok;
  }

  /* Review button click */
  document.getElementById('review-btn').addEventListener('click', function() {
    if (slots.length === 0) { alert('Please select at least one date.'); return; }
    var bad = null;
    for (var i = 0; i < slots.length; i++) {
      if (!slots[i].start || !slots[i].end || slots[i].end <= slots[i].start) { bad = slots[i]; break; }
    }
    if (bad) { alert('Each date needs a valid start time and end time (end must be after start).'); return; }
    document.getElementById('slots-json').value = JSON.stringify(slots.map(function(s){
      return {date:s.date, start_time:s.start, end_time:s.end};
    }));
    document.getElementById('nbf').submit();
  });

  /* Rate hint helpers */
  function getRateUnit() {
    var rt = document.querySelector('input[name="rate_type"]:checked');
    return rt && rt.value === 'daily' ? '/day' : '/hr';
  }
  function updateRateHint(rateVal, isGlobal) {
    var unit = getRateUnit();
    var label = isGlobal ? 'group/global' : 'group';
    document.getElementById('rate-hint').textContent = '— leave blank to use '+label+' rate ($'+parseFloat(rateVal).toFixed(2)+unit+')';
    var ov = document.getElementById('rate-override');
    if (!ov.value) ov.placeholder = parseFloat(rateVal).toFixed(2);
  }
  var _lastRate = null, _lastRateIsGlobal = true;

  /* Rate hint on group change */
  document.getElementById('group-sel').addEventListener('change', function() {
    var opt = this.options[this.selectedIndex];
    var grpRate = parseFloat(opt.getAttribute('data-rate') || '');
    if (!isNaN(grpRate) && grpRate > 0) {
      _lastRate = grpRate.toFixed(2); _lastRateIsGlobal = false;
      updateRateHint(_lastRate, false);
    } else if (this.value) {
      fetch('/gym-rentals/api/group-rate?id='+this.value)
        .then(function(r){ return r.json(); })
        .then(function(data) {
          _lastRate = parseFloat(data.rate || 25).toFixed(2); _lastRateIsGlobal = true;
          updateRateHint(_lastRate, true);
        }).catch(function(){});
    }
  });

  /* Rate hint on rate_type change */
  document.querySelectorAll('input[name="rate_type"]').forEach(function(radio) {
    radio.addEventListener('change', function() {
      if (_lastRate) updateRateHint(_lastRate, _lastRateIsGlobal);
      else {
        var hint = document.getElementById('rate-hint');
        var unit = getRateUnit();
        hint.textContent = hint.textContent.replace(/\/hr|\/day/, unit);
      }
    });
  });

  /* Restore pre-filled slots from back-navigation */
  var initEl = document.getElementById('initial-slots');
  if (initEl && initEl.value) {
    try {
      var parsed = JSON.parse(initEl.value);
      parsed.forEach(function(s) {
        var dt  = new Date(s.date + 'T12:00:00');
        var lbl = DOW_NAMES[dt.getDay()] + ', ' + MNAMES[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
        addToSlots(s.date, lbl);
        var slot = slots[slots.length-1];
        if (slot && slot.date === s.date) { slot.start = s.start_time||''; slot.end = s.end_time||''; }
      });
      if (slots.length) { slots.sort(function(a,b){ return a.date<b.date?-1:1; }); }
    } catch(e) {}
  }

  /* Initial render */
  renderCalendar();
  if (slots.length) { renderList(); updateCounter(); }
})();
</script>
`, 'New Booking');
      }

      // ── BOOKING REVIEW ────────────────────────────────────────
      if (path === '/gym-rentals/bookings/review' && method === 'POST') {
        const form         = await request.formData();
        const group_id     = parseInt(form.get('group_id') || '0', 10);
        const slotsRaw     = form.get('slots') || '';
        const rate_override = parseFloat(form.get('rate_override') || '') || null;
        const rate_type    = form.get('rate_type') === 'daily' ? 'daily' : 'hourly';
        const notes        = form.get('notes') || '';

        const backUrl = (err) => {
          const p = new URLSearchParams({ err, grp: group_id, notes, rate_type });
          if (rate_override) p.set('rate', rate_override);
          if (slotsRaw) p.set('slots', slotsRaw);
          return `/gym-rentals/bookings/new?${p}`;
        };

        if (!group_id) return new Response('', { status: 302, headers: { Location: backUrl('nogroup') } });

        let slots;
        try { slots = JSON.parse(slotsRaw); } catch (_) { slots = []; }
        if (!slots.length) return new Response('', { status: 302, headers: { Location: backUrl('nodates') } });
        const badSlot = slots.find(s => !s.start_time || !s.end_time || s.end_time <= s.start_time);
        if (badSlot) return new Response('', { status: 302, headers: { Location: backUrl('times') } });

        const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id = ?').bind(group_id).first();
        if (!group) return new Response('', { status: 302, headers: { Location: backUrl('nogroup') } });
        const rate = rate_override !== null ? rate_override : await getGroupRate(env, group);

        // Check each slot for conflicts/blocked
        const rows = [];
        for (const s of slots) {
          const blocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date = ?').bind(s.date).first();
          const conflict = !blocked && await env.DB.prepare(
            `SELECT id FROM gym_bookings WHERE booking_date = ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`
          ).bind(s.date, s.end_time, s.start_time).first();
          const hours = calcHours(s.start_time, s.end_time);
          rows.push({ ...s, hours, blocked: !!blocked, conflict: !!conflict });
        }

        const validRows   = rows.filter(r => !r.blocked && !r.conflict);
        const skippedRows = rows.filter(r => r.blocked || r.conflict);
        const totalHours  = Math.round(validRows.reduce((a, r) => a + r.hours, 0) * 100) / 100;
        const grandTotal  = rate_type === 'daily'
          ? Math.round(validRows.length * rate * 100) / 100
          : Math.round(totalHours * rate * 100) / 100;
        const rateLabel   = rate_type === 'daily' ? '/day' : '/hr';

        const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const reviewLabel = (d) => { const dt = new Date(d + 'T12:00:00'); return DAYS[dt.getDay()] + ' ' + dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };

        const validTableRows = validRows.map(r => `
<tr>
  <td style="padding:10px 12px;font-family:var(--sans);font-size:14px;font-weight:600;color:var(--steel);">${reviewLabel(r.date)}</td>
  <td style="padding:10px 12px;font-size:13px;color:var(--charcoal);">${fmt12h(r.start_time)} – ${fmt12h(r.end_time)}</td>
  <td style="padding:10px 12px;font-size:13px;color:var(--charcoal);text-align:right;">${rate_type === 'daily' ? '—' : `${r.hours} hr${r.hours !== 1 ? 's' : ''}`}</td>
  <td style="padding:10px 12px;font-size:13px;font-weight:600;color:var(--charcoal);text-align:right;">$${(rate_type === 'daily' ? rate : r.hours * rate).toFixed(2)}</td>
</tr>`).join('');

        const skippedAlert = skippedRows.length > 0 ? `
<div class="alert alert-error" style="margin-bottom:18px;">
  <strong>${skippedRows.length} date${skippedRows.length > 1 ? 's' : ''} skipped</strong> — conflict or blocked:
  <ul style="margin:6px 0 0 16px;padding:0;">
    ${skippedRows.map(r => `<li>${reviewLabel(r.date)} — ${r.blocked ? 'blocked' : 'conflict with existing booking'}</li>`).join('')}
  </ul>
</div>` : '';

        const hiddenSlots = validRows.map(r =>
          `<input type="hidden" name="slot" value="${encodeURIComponent(JSON.stringify({date:r.date,start_time:r.start_time,end_time:r.end_time}))}">`
        ).join('');

        const editBack = `/gym-rentals/bookings/new?grp=${group_id}&slots=${encodeURIComponent(slotsRaw)}&notes=${encodeURIComponent(notes)}&rate_type=${rate_type}${rate_override ? '&rate=' + rate_override : ''}`;

        return html(`
${topbarHtml('gym', currentUser, `<a href="${editBack}">← Edit</a>`)}
<div class="wrap">
  <div class="page-title">Review Booking</div>
  <div class="page-sub">${group.name} — $${rate.toFixed(2)}${rateLabel}</div>
  ${skippedAlert}
  ${validRows.length === 0 ? `<div class="alert alert-error">No valid dates remain. <a href="${editBack}">Go back</a>.</div>` : `
  <div class="card">
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <thead>
        <tr style="border-bottom:2px solid var(--border);">
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">Date</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">Time</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">${rate_type === 'daily' ? 'Rate' : 'Hours'}</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);">Subtotal</th>
        </tr>
      </thead>
      <tbody>${validTableRows}</tbody>
      <tfoot>
        <tr style="border-top:2px solid var(--border);background:var(--mist);">
          <td colspan="2" style="padding:12px;font-family:var(--sans);font-size:14px;font-weight:700;color:var(--steel);">Total (${validRows.length} date${validRows.length !== 1 ? 's' : ''})</td>
          <td style="padding:12px;text-align:right;font-size:14px;font-weight:700;color:var(--steel);">${rate_type === 'daily' ? `$${rate.toFixed(2)}/day` : `${totalHours} hrs`}</td>
          <td style="padding:12px;text-align:right;font-size:16px;font-weight:700;color:var(--steel);">$${grandTotal.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    ${notes ? `<div style="font-size:13px;color:var(--charcoal);margin-bottom:18px;"><strong>Notes:</strong> ${notes.replace(/</g,'&lt;')}</div>` : ''}
    <form method="POST" action="/gym-rentals/bookings/confirm">
      <input type="hidden" name="group_id" value="${group_id}">
      ${hiddenSlots}
      <input type="hidden" name="rate" value="${rate}">
      <input type="hidden" name="rate_type" value="${rate_type}">
      <input type="hidden" name="notes" value="${notes.replace(/"/g,'&quot;')}">
      <div class="btn-row">
        <button type="submit" class="btn btn-primary" onclick="this.disabled=true;this.textContent='Creating…';return true;">Confirm &amp; Send Invoice →</button>
        <a href="${editBack}" class="btn btn-secondary">← Edit</a>
      </div>
    </form>
  </div>`}
</div>`, 'Review Booking');
      }

      // ── CONFIRM BOOKING ───────────────────────────────────────
      if (path === '/gym-rentals/bookings/confirm' && method === 'POST') {
        const form      = await request.formData();
        const group_id  = parseInt(form.get('group_id') || '0', 10);
        const rate      = parseFloat(form.get('rate') || '25');
        const rate_type = form.get('rate_type') === 'daily' ? 'daily' : 'hourly';
        const notes     = form.get('notes') || '';
        const slotStrs  = form.getAll('slot').filter(Boolean);

        if (!group_id || slotStrs.length === 0) {
          return new Response('', { status: 302, headers: { Location: '/gym-rentals/bookings/new?err=nodates' } });
        }
        const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id = ?').bind(group_id).first();
        if (!group) return new Response('', { status: 302, headers: { Location: '/gym-rentals/bookings/new?err=nogroup' } });

        const bookingIds = [];
        const bookings   = [];

        for (const slotStr of slotStrs) {
          let s;
          try { s = JSON.parse(decodeURIComponent(slotStr)); } catch (_) { continue; }
          const { date: dt, start_time, end_time } = s;
          if (!dt || !start_time || !end_time) continue;
          // Re-check conflict/blocked
          const blocked = await env.DB.prepare('SELECT id FROM gym_blocked_dates WHERE date = ?').bind(dt).first();
          const conflict = !blocked && await env.DB.prepare(
            `SELECT id FROM gym_bookings WHERE booking_date = ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`
          ).bind(dt, end_time, start_time).first();
          if (blocked || conflict) continue;

          const bRes = await env.DB.prepare(
            `INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, created_by) VALUES (?, ?, ?, ?, ?, 'confirmed', 'admin')`
          ).bind(group_id, dt, start_time, end_time, notes).run();
          bookingIds.push(bRes.meta.last_row_id);
          bookings.push({ booking_date: dt, start_time, end_time, notes });
        }

        if (bookingIds.length === 0) {
          return new Response('', { status: 302, headers: { Location: '/gym-rentals/bookings/new?err=conflict' } });
        }

        const sortedDates = bookings.map(b => b.booking_date).sort();
        const totalHours  = Math.round(bookings.reduce((a, b) => a + calcHours(b.start_time, b.end_time), 0) * 100) / 100;
        const totalAmount = rate_type === 'daily'
          ? Math.round(bookings.length * rate * 100) / 100
          : Math.round(totalHours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];

        const iRes = await env.DB.prepare(
          `INSERT INTO gym_invoices (group_id, booking_ids, invoice_date, period_start, period_end, total_hours, rate, rate_type, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(group_id, JSON.stringify(bookingIds), invoiceDate, sortedDates[0], sortedDates[sortedDates.length - 1], totalHours, rate, rate_type, totalAmount).run();
        const invoiceId = iRes.meta.last_row_id;

        const inv       = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id = ?').bind(invoiceId).first();
        const pymtLink  = await getPaymentLink(env);
        const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId, rate_type }, group, bookings, pymtLink);
        const subject   = bookings.length === 1
          ? `Gym Rental Invoice — ${group.name} — ${formatDate(sortedDates[0])}`
          : `Gym Rental Invoice — ${group.name} — ${bookings.length} dates`;
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
        const toEmails = [adminEmail];
        if (group.email) toEmails.push(group.email);

        // Run email + GCal in the background so the redirect is instant
        const bgWork = async () => {
          try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
          await Promise.all(bookings.map(b =>
            addGymBookingToGCal(env, { booking_date: b.booking_date, start_time: b.start_time, end_time: b.end_time, group_name: group.name, notes })
          ));
        };
        if (ctx?.waitUntil) ctx.waitUntil(bgWork()); else await bgWork();

        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${invoiceId}?msg=created` } });
      }

      // ── ALL BOOKINGS LIST ─────────────────────────────────────
      if (path === '/gym-rentals/bookings' && method === 'GET') {
        const today = new Date().toISOString().split('T')[0];
        const [upcoming, past] = await Promise.all([
          env.DB.prepare(`SELECT b.*, g.name as group_name FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id WHERE b.booking_date >= ? AND b.status IN ('confirmed','hold') ORDER BY b.booking_date, b.start_time`).bind(today).all(),
          env.DB.prepare(`SELECT b.*, g.name as group_name FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id WHERE b.booking_date < ? ORDER BY b.booking_date DESC LIMIT 30`).bind(today).all(),
        ]);
        const statusBadge = s => s === 'confirmed' ? `<span class="badge badge-active">Confirmed</span>`
          : s === 'hold'      ? `<span class="badge" style="background:#FFF3D6;color:#7A4F00;">Hold</span>`
          : s === 'cancelled' ? `<span class="badge badge-expired">Cancelled</span>`
          : s === 'released'  ? `<span class="badge badge-expired">Released</span>`
          : s === 'expired'   ? `<span class="badge badge-expired">Expired</span>`
          : `<span class="badge">${s}</span>`;
        const bRow = (b, actions = true) => `
<div class="ni-row">
  <div style="font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);min-width:100px;">${fmtBookingDate(b.booking_date)}</div>
  <div style="font-family:var(--serif);font-size:15px;color:var(--charcoal);flex:1;">${b.group_name||'—'}</div>
  <div class="ni-meta">${fmt12h(b.start_time)} \u2013 ${fmt12h(b.end_time)}</div>
  ${statusBadge(b.status)}
  ${actions && (b.status === 'confirmed' || b.status === 'hold') ? `<div class="ni-actions" style="display:flex;gap:6px;flex-wrap:wrap;">
    ${b.status === 'hold' ? `<form method="POST" action="/gym-rentals/bookings/confirm-admin/${b.id}" style="display:contents;" onsubmit="return confirm('Confirm this hold and generate an invoice?')"><button type="submit" class="btn btn-sm btn-primary">Confirm</button></form>` : ''}
    <form method="POST" action="/gym-rentals/bookings/cancel/${b.id}" style="display:contents;" onsubmit="return confirm('Cancel this booking? The group will be notified.')">
      <button type="submit" class="btn btn-sm btn-danger">Cancel</button>
    </form>
  </div>` : ''}
</div>`;
        const groupByOrg = (rows, showActions) => {
          const groups = {};
          const order = [];
          for (const b of rows) {
            const name = b.group_name || '— Unassigned —';
            if (!groups[name]) { groups[name] = []; order.push(name); }
            groups[name].push(b);
          }
          return order.map(name => `
<details open style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;overflow:hidden;">
  <summary style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:11px 16px;background:var(--mist);font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);list-style:none;-webkit-appearance:none;">
    <span>${name}</span>
    <span style="font-size:12px;font-weight:400;color:var(--gray);">${groups[name].length} booking${groups[name].length !== 1 ? 's' : ''}</span>
  </summary>
  ${groups[name].map(b => bRow(b, showActions)).join('')}
</details>`).join('');
        };
        const upHtml = upcoming.results.length === 0
          ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No upcoming bookings.</div>`
          : groupByOrg(upcoming.results, true);
        const pastHtml = past.results.length === 0
          ? `<div style="text-align:center;padding:24px;color:var(--gray);font-size:13px;">No past bookings on record.</div>`
          : groupByOrg(past.results, false);
        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">All Bookings</div>
  <div class="page-sub">Upcoming and past gym rentals.</div>
  ${gymAlert}
  <div class="btn-row" style="margin-bottom:28px;">
    <a href="/gym-rentals/bookings/new" class="btn btn-primary">+ New Booking</a>
  </div>
  <div class="card">
    <div class="card-title">Upcoming</div>
    ${upHtml}
  </div>
  <div class="card">
    <div class="card-title">Recent Past (last 30)</div>
    ${pastHtml}
  </div>
</div>`, 'All Bookings');
      }

      // ── ADMIN CONFIRM HOLD ────────────────────────────────────
      if (path.startsWith('/gym-rentals/bookings/confirm-admin/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        const booking = await env.DB.prepare('SELECT * FROM gym_bookings WHERE id=? AND status=\'hold\'').bind(bid).first();
        if (!booking) return new Response('', { status: 302, headers: { Location: '/gym-rentals/bookings?msg=saved' } });
        await env.DB.prepare("UPDATE gym_bookings SET status='confirmed', hold_expires_at=NULL WHERE id=?").bind(bid).run();
        // Generate invoice
        const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(booking.group_id).first();
        const rate  = await getGroupRate(env, group);
        const hours = calcHours(booking.start_time, booking.end_time);
        const total = Math.round(hours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];
        const iRes = await env.DB.prepare(
          `INSERT INTO gym_invoices (group_id, booking_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(booking.group_id, bid, invoiceDate, booking.booking_date, booking.booking_date, hours, rate, total).run();
        const invoiceId = iRes.meta.last_row_id;
        const inv   = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
        if (group) {
          const pymtLink  = await getPaymentLink(env);
          const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, booking, pymtLink);
          const subject = `Gym Rental Confirmed — ${group.name} — ${formatDate(booking.booking_date)}`;
          const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
          const toEmails = [adminEmailRow?.value || 'office@timothystl.org'];
          if (group.email) toEmails.push(group.email);
          try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
          await addGymBookingToGCal(env, { ...booking, group_name: group.name });
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${invoiceId}?msg=created` } });
      }

      // ── CONFIRM ALL HOLDS ─────────────────────────────────────
      if (path === '/gym-rentals/bookings/confirm-all-holds' && method === 'POST') {
        const allHolds = await env.DB.prepare("SELECT * FROM gym_bookings WHERE status='hold'").all();
        const invoiceDate = new Date().toISOString().split('T')[0];
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
        const pymtLink = await getPaymentLink(env);

        // Group holds by group_id so each group gets one invoice
        const byGroup = new Map();
        for (const booking of allHolds.results) {
          if (!byGroup.has(booking.group_id)) byGroup.set(booking.group_id, []);
          byGroup.get(booking.group_id).push(booking);
        }

        let confirmed = 0;
        for (const [groupId, bookings] of byGroup) {
          for (const booking of bookings) {
            await env.DB.prepare("UPDATE gym_bookings SET status='confirmed', hold_expires_at=NULL WHERE id=?").bind(booking.id).run();
            await addGymBookingToGCal(env, { ...booking, group_name: '' });
          }
          const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(groupId).first();
          if (group) {
            for (const b of bookings) b.group_name = group.name;
          }
          const rate = await getGroupRate(env, group);
          const totalHours = bookings.reduce((s, b) => s + calcHours(b.start_time, b.end_time), 0);
          const totalAmount = Math.round(totalHours * rate * 100) / 100;
          const allDates = bookings.map(b => b.booking_date).sort();
          const bookingIds = JSON.stringify(bookings.map(b => b.id));
          const iRes = await env.DB.prepare(
            `INSERT INTO gym_invoices (group_id, booking_id, booking_ids, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
          ).bind(groupId, bookingIds, invoiceDate, allDates[0], allDates[allDates.length - 1], totalHours, rate, totalAmount).run();
          const invoiceId = iRes.meta.last_row_id;
          const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
          if (group) {
            const subject = bookings.length === 1
              ? `Gym Rental Confirmed — ${group.name} — ${formatDate(bookings[0].booking_date)}`
              : `Gym Rental Confirmed — ${group.name} — ${bookings.length} dates`;
            const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, bookings, pymtLink);
            const toEmails = [adminEmail];
            if (group.email) toEmails.push(group.email);
            try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
          }
          confirmed += bookings.length;
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals?msg=confirmed-all&n=${confirmed}` } });
      }

      // ── BULK CONFIRM SELECTED HOLDS ───────────────────────────
      if (path === '/gym-rentals/bookings/bulk-confirm' && method === 'POST') {
        const form = await request.formData();
        const ids = form.getAll('ids').map(id => parseInt(id, 10)).filter(Boolean);
        if (!ids.length) return new Response('', { status: 302, headers: { Location: '/gym-rentals' } });

        const invoiceDate = new Date().toISOString().split('T')[0];
        const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
        const adminEmail = adminEmailRow?.value || 'office@timothystl.org';
        const pymtLink = await getPaymentLink(env);

        const byGroup = new Map();
        for (const bid of ids) {
          const booking = await env.DB.prepare("SELECT * FROM gym_bookings WHERE id=? AND status='hold'").bind(bid).first();
          if (!booking) continue;
          if (!byGroup.has(booking.group_id)) byGroup.set(booking.group_id, []);
          byGroup.get(booking.group_id).push(booking);
        }

        let confirmed = 0;
        for (const [groupId, bookings] of byGroup) {
          for (const booking of bookings) {
            await env.DB.prepare("UPDATE gym_bookings SET status='confirmed', hold_expires_at=NULL WHERE id=?").bind(booking.id).run();
            await addGymBookingToGCal(env, { ...booking, group_name: '' });
          }
          const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(groupId).first();
          const rate = await getGroupRate(env, group);
          const totalHours = bookings.reduce((s, b) => s + calcHours(b.start_time, b.end_time), 0);
          const totalAmount = Math.round(totalHours * rate * 100) / 100;
          const allDates = bookings.map(b => b.booking_date).sort();
          const bookingIds = JSON.stringify(bookings.map(b => b.id));
          const iRes = await env.DB.prepare(
            `INSERT INTO gym_invoices (group_id, booking_id, booking_ids, invoice_date, period_start, period_end, total_hours, rate, total_amount, status) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
          ).bind(groupId, bookingIds, invoiceDate, allDates[0], allDates[allDates.length - 1], totalHours, rate, totalAmount).run();
          const invoiceId = iRes.meta.last_row_id;
          const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
          if (group) {
            const subject = bookings.length === 1
              ? `Gym Rental Confirmed — ${group.name} — ${formatDate(bookings[0].booking_date)}`
              : `Gym Rental Confirmed — ${group.name} — ${bookings.length} dates`;
            const emailHtml = buildGymInvoiceEmailHtml({ ...inv, id: invoiceId }, group, bookings, pymtLink);
            const toEmails = [adminEmail];
            if (group.email) toEmails.push(group.email);
            try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
          }
          confirmed += bookings.length;
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals?msg=confirmed-all&n=${confirmed}` } });
      }

      // ── BULK RELEASE SELECTED HOLDS ───────────────────────────
      if (path === '/gym-rentals/bookings/bulk-release' && method === 'POST') {
        const form = await request.formData();
        const ids = form.getAll('ids').map(id => parseInt(id, 10)).filter(Boolean);
        for (const bid of ids) {
          await env.DB.prepare("UPDATE gym_bookings SET status='released' WHERE id=? AND status='hold'").bind(bid).run();
        }
        return new Response('', { status: 302, headers: { Location: '/gym-rentals?msg=saved' } });
      }

      // ── BULK DELETE CONFIRMED BOOKINGS ────────────────────────
      if (path === '/gym-rentals/bookings/bulk-delete' && method === 'POST') {
        const form = await request.formData();
        const ids = form.getAll('ids').map(id => parseInt(id, 10)).filter(Boolean);
        for (const bid of ids) {
          await env.DB.prepare("DELETE FROM gym_bookings WHERE id=? AND status='confirmed'").bind(bid).run();
        }
        return new Response('', { status: 302, headers: { Location: '/gym-rentals?msg=deleted' } });
      }

      // ── CANCEL BOOKING ────────────────────────────────────────
      if (path.startsWith('/gym-rentals/bookings/cancel/') && method === 'POST') {
        const bid = parseInt(path.split('/').pop(), 10);
        const booking = await env.DB.prepare('SELECT * FROM gym_bookings WHERE id=?').bind(bid).first();
        await env.DB.prepare("UPDATE gym_bookings SET status='cancelled' WHERE id=?").bind(bid).run();
        // Notify group
        if (booking) {
          const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(booking.group_id).first();
          if (group?.email) {
            try {
              await sendTransactionalEmail(env, {
                subject: `Gym rental cancelled — ${formatDate(booking.booking_date)}`,
                htmlContent: `<p>Hi ${group.name},</p><p>Your gym rental booking has been cancelled by the church office:</p><ul><li><strong>Date:</strong> ${formatDate(booking.booking_date)}</li><li><strong>Time:</strong> ${fmt12h(booking.start_time)} – ${fmt12h(booking.end_time)}</li></ul><p>If you have questions, please contact <a href="mailto:office@timothystl.org">office@timothystl.org</a>.</p>`,
                toEmails: [group.email],
              });
            } catch (_) {}
          }
        }
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/bookings?msg=saved' } });
      }

      // ── INVOICES LIST ─────────────────────────────────────────
      if (path === '/gym-rentals/invoices' && method === 'GET') {
        const invoices = await env.DB.prepare(
          `SELECT i.*, g.name as group_name FROM gym_invoices i LEFT JOIN gym_groups g ON g.id = i.group_id ORDER BY i.created_at DESC LIMIT 100`
        ).all();
        const invRowHtml = invoices.results.length === 0
          ? `<div style="text-align:center;padding:40px;color:var(--gray);font-size:14px;">No invoices yet. Invoices are generated automatically when a booking is created.</div>`
          : invoices.results.map(inv => {
              const invNum = `GYM-${inv.id.toString().padStart(4,'0')}`;
              return `
<div class="ni-row">
  <div style="font-family:var(--sans);font-size:12px;font-weight:700;color:var(--gray);min-width:72px;">${invNum}</div>
  <div style="flex:1;">
    <div style="font-family:var(--serif);font-size:15px;color:var(--steel);">${inv.group_name||'—'}</div>
    <div style="font-family:var(--sans);font-size:12px;color:var(--gray);">${formatDate(inv.invoice_date)}</div>
  </div>
  <div style="font-family:var(--sans);font-size:16px;font-weight:700;color:var(--charcoal);">$${parseFloat(inv.total_amount||0).toFixed(2)}</div>
  <span class="badge ${inv.status==='paid'?'badge-active':'badge-pinned'}">${inv.status==='paid'?'Paid':'Unpaid'}</span>
  <div class="ni-actions">
    <a href="/gym-rentals/invoices/view/${inv.id}" class="btn btn-sm btn-secondary">View</a>
    <form method="POST" action="/gym-rentals/invoices/toggle-paid/${inv.id}" style="display:contents;">
      <button type="submit" class="btn btn-sm ${inv.status==='paid'?'btn-danger':'btn-sage'}">${inv.status==='paid'?'Mark Unpaid':'Mark Paid'}</button>
    </form>
    <form method="POST" action="/gym-rentals/invoices/delete/${inv.id}" style="display:contents;" onsubmit="return confirm('Delete invoice ${invNum}? This cannot be undone.')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
  </div>
</div>`; }).join('');
        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">Invoices</div>
  <div class="page-sub">Invoice history and payment tracking.</div>
  ${gymAlert}
  <div class="card">${invRowHtml}</div>
</div>`, 'Invoices');
      }

      // ── INVOICE VIEW / PRINT ──────────────────────────────────
      if (path.startsWith('/gym-rentals/invoices/view/') && method === 'GET') {
        const iid = parseInt(path.split('/').pop(), 10);
        const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id = ?').bind(iid).first();
        if (!inv) return new Response('Not found', { status: 404 });
        const group   = await env.DB.prepare('SELECT * FROM gym_groups WHERE id = ?').bind(inv.group_id).first();

        // Multi-booking invoice support
        let viewBookings = [];
        if (inv.booking_ids) {
          try {
            const ids = JSON.parse(inv.booking_ids);
            if (ids.length) {
              const rows = await env.DB.prepare(`SELECT * FROM gym_bookings WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY booking_date, start_time`).bind(...ids).all();
              viewBookings = rows.results;
            }
          } catch (_) {}
        }
        if (!viewBookings.length && inv.booking_id) {
          const b = await env.DB.prepare('SELECT * FROM gym_bookings WHERE id = ?').bind(inv.booking_id).first();
          if (b) viewBookings = [b];
        }
        const invNum    = `GYM-${iid.toString().padStart(4,'0')}`;
        const hours     = parseFloat(inv.total_hours  || 0);
        const rate      = parseFloat(inv.rate         || 0);
        const total     = parseFloat(inv.total_amount || 0);
        const rateType  = inv.rate_type || 'hourly';
        const rateLabel = rateType === 'daily' ? '/day' : '/hr';
        const paymentLink = await getPaymentLink(env);
        const vm = url.searchParams.get('msg');
        const viewAlert = vm === 'created' ? `<div class="alert alert-success">&#10003; Booking confirmed. Invoice emailed to ${group?.email ? group.email : 'you and the group'}.</div>`
          : vm === 'saved'   ? `<div class="alert alert-success">&#10003; Saved.</div>`
          : '';

        let rentalDetailsRows = '';
        if (viewBookings.length > 1) {
          const dateRows = viewBookings.map(b => {
            const bh = calcHours(b.start_time, b.end_time);
            const sub = rateType === 'daily' ? rate : bh * rate;
            const detail = rateType === 'daily'
              ? `${fmt12h(b.start_time)} &ndash; ${fmt12h(b.end_time)} &middot; $${sub.toFixed(2)}`
              : `${fmt12h(b.start_time)} &ndash; ${fmt12h(b.end_time)} &middot; ${bh} hr${bh !== 1 ? 's' : ''} &middot; $${sub.toFixed(2)}`;
            return `<tr style="border-bottom:1px solid var(--border);">
              <td style="padding:8px 0;font-size:14px;color:var(--charcoal);font-weight:600;">${formatDate(b.booking_date)}</td>
              <td style="padding:8px 0;font-size:13px;color:var(--gray);text-align:right;">${detail}</td>
            </tr>`;
          }).join('');
          const totalHoursRow = rateType === 'daily' ? '' :
            `<tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Total Hours</td><td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right;">${hours} hrs</td></tr>`;
          rentalDetailsRows = `
            <tr><td colspan="2" style="padding:4px 0 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--amber);">Rental Dates (${viewBookings.length})</td></tr>
            ${dateRows}
            <tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Rate</td><td style="padding:10px 0;font-size:14px;text-align:right;">$${rate.toFixed(2)}${rateLabel}</td></tr>
            ${totalHoursRow}`;
        } else {
          const booking = viewBookings[0];
          const durationRow = rateType === 'daily' ? '' :
            `<tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Duration</td><td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right;">${hours} hr${hours !== 1 ? 's' : ''}</td></tr>`;
          rentalDetailsRows = `
            <tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Date</td><td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right;">${booking ? formatDate(booking.booking_date) : formatDate(inv.period_start)}</td></tr>
            <tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Time</td><td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right;">${booking ? `${fmt12h(booking.start_time)} \u2013 ${fmt12h(booking.end_time)}` : '\u2014'}</td></tr>
            ${durationRow}
            <tr style="border-bottom:1px solid var(--border);"><td style="padding:10px 0;font-size:14px;color:var(--gray);">Rate</td><td style="padding:10px 0;font-size:14px;text-align:right;">$${rate.toFixed(2)}${rateLabel}</td></tr>`;
        }

        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals/invoices">\u2190 Invoices</a>`)}
<div class="wrap">
  <div class="page-title">Invoice ${invNum}</div>
  <div class="page-sub">${group?.name||'\u2014'}</div>
  ${viewAlert}
  <div class="btn-row" style="margin-bottom:24px;">
    <button type="button" onclick="window.print()" class="btn btn-secondary">Print / Save PDF</button>
    <form method="POST" action="/gym-rentals/invoices/email/${iid}" style="display:contents;">
      <button type="submit" class="btn btn-sage">Resend Email</button>
    </form>
    <form method="POST" action="/gym-rentals/invoices/toggle-paid/${iid}" style="display:contents;">
      <button type="submit" class="btn ${inv.status==='paid'?'btn-danger':'btn-primary'}">${inv.status==='paid'?'Mark Unpaid':'Mark as Paid'}</button>
    </form>
  </div>
  <div class="card" style="max-width:640px;margin:0 auto;" id="invoice-print">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:28px;">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;">Timothy Lutheran Church</div>
        <div style="font-family:var(--serif);font-size:22px;color:var(--steel);">Gym Rental Invoice</div>
        <div style="font-size:13px;color:var(--gray);margin-top:4px;">#${invNum}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12px;color:var(--gray);">Invoice date</div>
        <div style="font-size:15px;font-weight:700;color:var(--charcoal);">${formatDate(inv.invoice_date)}</div>
        <div style="margin-top:8px;font-size:12px;font-weight:700;padding:3px 12px;border-radius:999px;display:inline-block;${inv.status==='paid'?'background:#e8f5e9;color:#1a3d1f;':'background:#FFF3D6;color:#7A4F00;'}">${inv.status==='paid'?'PAID':'UNPAID'}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px;">
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:8px;">Billed To</div>
        <div style="font-size:16px;font-weight:700;color:var(--steel);">${group?.name||'\u2014'}</div>
        ${group?.contact ? `<div style="font-size:13px;color:var(--gray);margin-top:3px;">${group.contact}</div>` : ''}
        ${group?.email   ? `<div style="font-size:13px;color:var(--gray);">${group.email}</div>` : ''}
        ${group?.phone   ? `<div style="font-size:13px;color:var(--gray);">${group.phone}</div>` : ''}
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:8px;">From</div>
        <div style="font-size:14px;font-weight:700;color:var(--steel);">Timothy Lutheran Church</div>
        <div style="font-size:13px;color:var(--gray);margin-top:3px;">4666 Fyler Ave, St. Louis, MO 63116</div>
        <div style="font-size:13px;color:var(--gray);">office@timothystl.org</div>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin-bottom:24px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:16px;">Rental Details</div>
    <table style="width:100%;border-collapse:collapse;">
      ${rentalDetailsRows}
      <tr><td style="padding:20px 0 0;font-size:18px;font-weight:700;color:var(--steel);">Amount Due</td><td style="padding:20px 0 0;font-size:24px;font-weight:700;color:var(--steel);text-align:right;">$${total.toFixed(2)}</td></tr>
    </table>
    <hr style="border:none;border-top:1px solid var(--border);margin:24px 0;">
    <div style="background:var(--linen);border-radius:8px;padding:16px 20px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber);margin-bottom:10px;">Payment</div>
      <div style="text-align:center;margin-bottom:14px;"><a href="${paymentLink}&amount=${Math.round(total * 100)}" target="_blank" style="display:inline-block;background:#00DB72;color:white;font-weight:700;font-size:15px;padding:12px 36px;border-radius:6px;text-decoration:none;">Pay Online \u2192</a></div>
      <div style="font-size:13px;color:var(--gray);text-align:center;margin-bottom:10px;">\u2014 or \u2014</div>
      <div style="font-size:14px;color:var(--charcoal);line-height:1.75;">Make check payable to <strong>Timothy Lutheran Church</strong> and bring to the office or mail to 4666 Fyler Ave, St. Louis, MO 63116.</div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:20px 0 16px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:10px;">Adjust Invoice</div>
    <form method="POST" action="/gym-rentals/invoices/edit-amount/${iid}" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
      <div class="form-group" style="margin:0;">
        <label style="font-size:11px;margin-bottom:4px;">Total ($)</label>
        <input type="number" name="total_amount" step="0.01" min="0" value="${total.toFixed(2)}" style="width:110px;">
      </div>
      <div class="form-group" style="margin:0;">
        <label style="font-size:11px;margin-bottom:4px;">Rate ($/hr)</label>
        <input type="number" name="rate" step="0.01" min="0" value="${rate.toFixed(2)}" style="width:90px;">
      </div>
      <button type="submit" class="btn btn-sm btn-secondary" style="margin-bottom:1px;">Save &amp; Update</button>
    </form>
  </div>
</div>
<style>@media print{.topbar,.tab-nav,.btn-row{display:none!important;}.wrap{padding:0!important;max-width:none!important;}#invoice-print{border:none!important;box-shadow:none!important;}.form-group,form[action*="edit-amount"]{display:none!important;}}</style>`, `Invoice ${invNum}`);
      }

            // ── TOGGLE INVOICE PAID / UNPAID ──────────────────────────
      if (path.startsWith('/gym-rentals/invoices/toggle-paid/') && method === 'POST') {
        const iid = parseInt(path.split('/').pop(), 10);
        const inv = await env.DB.prepare('SELECT status FROM gym_invoices WHERE id=?').bind(iid).first();
        if (inv) await env.DB.prepare('UPDATE gym_invoices SET status=? WHERE id=?').bind(inv.status==='paid'?'unpaid':'paid', iid).run();
        const ref = request.headers.get('Referer') || '';
        return new Response('', { status: 302, headers: { Location: ref.includes('/view/') ? `/gym-rentals/invoices/view/${iid}?msg=saved` : `/gym-rentals/invoices?msg=saved` } });
      }

      // ── EDIT INVOICE AMOUNT ───────────────────────────────────
      if (path.startsWith('/gym-rentals/invoices/edit-amount/') && method === 'POST') {
        const iid = parseInt(path.split('/').pop(), 10);
        const form = await request.formData();
        const newTotal = parseFloat(form.get('total_amount') || '0');
        const newRate  = parseFloat(form.get('rate') || '0');
        if (!isNaN(newTotal) && newTotal >= 0) {
          await env.DB.prepare('UPDATE gym_invoices SET total_amount=?, rate=? WHERE id=?').bind(newTotal, newRate, iid).run();
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${iid}?msg=saved` } });
      }

      // ── DELETE INVOICE ────────────────────────────────────────
      if (path.startsWith('/gym-rentals/invoices/delete/') && method === 'POST') {
        const iid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare('DELETE FROM gym_invoices WHERE id=?').bind(iid).run();
        return new Response('', { status: 302, headers: { Location: '/gym-rentals/invoices?msg=deleted' } });
      }

      // ── RESEND INVOICE EMAIL ──────────────────────────────────
      if (path.startsWith('/gym-rentals/invoices/email/') && method === 'POST') {
        const iid = parseInt(path.split('/').pop(), 10);
        const inv = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(iid).first();
        if (inv) {
          const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(inv.group_id).first();
          let resendBookings = [];
          if (inv.booking_ids) {
            try {
              const ids = JSON.parse(inv.booking_ids);
              if (ids.length) {
                const rows = await env.DB.prepare(`SELECT * FROM gym_bookings WHERE id IN (${ids.map(()=>'?').join(',')}) ORDER BY booking_date, start_time`).bind(...ids).all();
                resendBookings = rows.results;
              }
            } catch (_) {}
          }
          if (!resendBookings.length && inv.booking_id) {
            const b = await env.DB.prepare('SELECT * FROM gym_bookings WHERE id=?').bind(inv.booking_id).first();
            resendBookings = b ? [b] : [{ booking_date: inv.period_start, start_time: '', end_time: '' }];
          }
          if (!resendBookings.length) resendBookings = [{ booking_date: inv.period_start, start_time: '', end_time: '' }];
          const pymtLink  = await getPaymentLink(env);
          const emailHtml = buildGymInvoiceEmailHtml(inv, group, resendBookings.length === 1 ? resendBookings[0] : resendBookings, pymtLink);
          const subject = resendBookings.length > 1
            ? `Gym Rental Invoice — ${group?.name||'Group'} — ${resendBookings.length} dates`
            : `Gym Rental Invoice — ${group?.name||'Group'} — ${formatDate(inv.invoice_date)}`;          const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'gym_admin_email'").first();
          const toEmails = [];
          if (adminEmailRow?.value) toEmails.push(adminEmailRow.value);
          if (group?.email) toEmails.push(group.email);
          if (toEmails.length) try { await sendTransactionalEmail(env, { subject, htmlContent: emailHtml, toEmails }); } catch (_) {}
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${iid}?msg=saved` } });
      }

      // ── RECURRING LIST ────────────────────────────────────────
      if (path === '/gym-rentals/recurring' && method === 'GET') {
        const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const recs = await env.DB.prepare(
          `SELECT r.*, g.name as group_name FROM gym_recurrences r LEFT JOIN gym_groups g ON g.id = r.group_id ORDER BY r.created_at DESC`
        ).all();
        const statusBadge = s => s === 'approved' ? `<span class="badge badge-confirmed">Approved</span>`
          : s === 'rejected' ? `<span class="badge badge-expired">Rejected</span>`
          : `<span class="badge badge-upcoming">Pending</span>`;
        const recsHtml = recs.results.length === 0
          ? `<div style="text-align:center;padding:32px;color:var(--gray);font-size:14px;">No recurring requests yet.</div>`
          : recs.results.map(r => `
<div class="ni-row">
  <div style="font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);min-width:80px;">${DOW_NAMES[r.day_of_week]}s</div>
  <div style="font-family:var(--serif);font-size:15px;color:var(--charcoal);flex:1;">${r.group_name||'—'}</div>
  <div class="ni-meta">${fmt12h(r.start_time)} – ${fmt12h(r.end_time)}</div>
  <div class="ni-meta">${formatDate(r.start_date)} – ${formatDate(r.end_date)}</div>
  ${statusBadge(r.status)}
  <div class="ni-actions">
    <a href="/gym-rentals/recurring/review/${r.id}" class="btn btn-sm btn-secondary">View</a>
  </div>
</div>`).join('');
        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals">← Dashboard</a>`)}
<div class="wrap">
  <div class="page-title">Recurring Requests</div>
  <div class="page-sub">All recurring rental requests from groups.</div>
  ${gymAlert}
  <div class="card">
    ${recsHtml}
  </div>
</div>`, 'Recurring Requests');
      }

      // ── RECURRING REVIEW / APPROVE / REJECT ───────────────────
      if (path.startsWith('/gym-rentals/recurring/review/') && method === 'GET') {
        const rid = parseInt(path.split('/').pop(), 10);
        const rec = await env.DB.prepare(
          `SELECT r.*, g.name as group_name, g.email as group_email FROM gym_recurrences r LEFT JOIN gym_groups g ON g.id = r.group_id WHERE r.id = ?`
        ).bind(rid).first();
        if (!rec) return new Response('Not found', { status: 404 });

        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const rateRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_rate_per_hour'").first();
        const rate = parseFloat(rateRow?.value || '25');
        const hours = calcHours(rec.start_time, rec.end_time);

        // Generate all dates in range matching day_of_week
        const dates = [];
        const cur = new Date(rec.start_date + 'T12:00:00');
        const endD = new Date(rec.end_date + 'T12:00:00');
        while (cur <= endD) {
          if (cur.getDay() === rec.day_of_week) dates.push(cur.toISOString().split('T')[0]);
          cur.setDate(cur.getDate() + 1);
        }

        // Check conflicts and blocked for each date
        const [blockedRows, conflictRows] = await Promise.all([
          env.DB.prepare('SELECT date FROM gym_blocked_dates').all(),
          env.DB.prepare(`SELECT booking_date FROM gym_bookings WHERE booking_date >= ? AND booking_date <= ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`).bind(rec.start_date, rec.end_date, rec.end_time, rec.start_time).all(),
        ]);
        const blockedSet  = new Set(blockedRows.results.map(b => b.date));
        const conflictSet = new Set(conflictRows.results.map(b => b.booking_date));

        let okCount = 0;
        const dateRowsHtml = dates.map(d => {
          const isBlocked  = blockedSet.has(d);
          const isConflict = conflictSet.has(d);
          const skip = isBlocked || isConflict;
          if (!skip) okCount++;
          const badge = isBlocked  ? `<span class="badge badge-expired">Blocked</span>`
            : isConflict ? `<span class="badge" style="background:#FFF3D6;color:#7A4F00;">Conflict</span>`
            : `<span class="badge badge-confirmed">OK</span>`;
          return `<div class="ni-row" style="${skip ? 'opacity:.5;' : ''}">
  <div style="font-family:var(--sans);font-size:13px;font-weight:700;color:var(--steel);min-width:160px;">${fmtBookingDate(d)}</div>
  <div style="font-size:13px;color:var(--gray);">${fmt12h(rec.start_time)} – ${fmt12h(rec.end_time)}</div>
  ${badge}
</div>`;
        }).join('');

        const isPending = rec.status === 'pending_review';
        const _rmsg = url.searchParams.get('msg');
        const msgAlert = _rmsg === 'approved' ? `<div class="alert alert-success">✓ Approved — ${okCount} bookings created.</div>`
          : _rmsg === 'rejected'  ? `<div class="alert alert-error">Request rejected.</div>`
          : _rmsg === 'noinvoice' ? `<div class="alert alert-info">All sessions in that month are already invoiced.</div>`
          : '';

        return html(`
${topbarHtml('gym', currentUser, `<a href="/gym-rentals/recurring">← Recurring</a>`)}
<div class="wrap">
  <div class="page-title">Recurring Request</div>
  ${msgAlert}
  <div class="card">
    <div class="card-title">Request Details</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;font-size:14px;">
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Group</div><div style="font-weight:600;">${rec.group_name||'—'}</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Day</div><div style="font-weight:600;">${DOW_NAMES[rec.day_of_week]}s</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Time</div><div style="font-weight:600;">${fmt12h(rec.start_time)} – ${fmt12h(rec.end_time)}</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Date Range</div><div style="font-weight:600;">${formatDate(rec.start_date)} – ${formatDate(rec.end_date)}</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Rate</div><div style="font-weight:600;">$${(hours * rate).toFixed(2)}/session (${hours}h × $${rate}/hr)</div></div>
      <div><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Status</div><div style="font-weight:600;">${rec.status}</div></div>
      ${rec.notes ? `<div style="grid-column:1/-1;"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--gray);margin-bottom:4px;">Notes</div><div>${rec.notes}</div></div>` : ''}
    </div>
    ${isPending ? `
    <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border);">
      <div style="font-size:14px;color:var(--charcoal);margin-bottom:16px;"><strong>${okCount}</strong> of ${dates.length} dates will be booked (${dates.length - okCount} skipped due to conflicts or blocked dates).</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <form method="POST" action="/gym-rentals/recurring/approve/${rec.id}">
          <button type="submit" class="btn btn-primary" onclick="if(!confirm('Approve and create ${okCount} bookings?'))return false;this.disabled=true;this.textContent='Approving…';return true;">Approve (${okCount} bookings)</button>
        </form>
        <form method="POST" action="/gym-rentals/recurring/reject/${rec.id}" onsubmit="return confirm('Reject this request?')">
          <button type="submit" class="btn btn-danger">Reject</button>
        </form>
      </div>
    </div>` : ''}
  </div>
  <div class="card">
    <div class="card-title">Dates (${dates.length} total)</div>
    ${dateRowsHtml || `<div style="padding:20px;text-align:center;color:var(--gray);">No dates in range.</div>`}
  </div>
  ${rec.status === 'approved' ? (() => {
    // Build month selector for invoicing
    const monthSet = new Set(dates.map(d => d.slice(0,7)));
    const months = [...monthSet].sort();
    const monthOpts = months.map(m => {
      const [y, mo] = m.split('-');
      const label = new Date(`${m}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'});
      return `<option value="${m}">${label}</option>`;
    }).join('');
    return `<div class="card">
    <div class="card-title">Generate Monthly Invoice</div>
    <div style="font-size:13px;color:var(--gray);margin-bottom:16px;">Creates one invoice covering all sessions in the selected month. Only sessions not already invoiced will be included.</div>
    <form method="POST" action="/gym-rentals/recurring/invoice/${rec.id}" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
      <div class="form-group" style="flex:0 0 200px;margin-bottom:0;">
        <label>Month</label>
        <select name="month" required>${monthOpts}</select>
      </div>
      <button type="submit" class="btn btn-primary" style="flex-shrink:0;">Generate Invoice →</button>
    </form>
  </div>`;
  })() : ''}
</div>`, 'Review Recurring Request');
      }

      if (path.startsWith('/gym-rentals/recurring/approve/') && method === 'POST') {
        const rid = parseInt(path.split('/').pop(), 10);
        const rec = await env.DB.prepare('SELECT * FROM gym_recurrences WHERE id = ?').bind(rid).first();
        if (!rec || rec.status !== 'pending_review') return new Response('', { status: 302, headers: { Location: '/gym-rentals/recurring' } });

        const dates = [];
        const cur = new Date(rec.start_date + 'T12:00:00');
        const endD = new Date(rec.end_date + 'T12:00:00');
        while (cur <= endD) {
          if (cur.getDay() === rec.day_of_week) dates.push(cur.toISOString().split('T')[0]);
          cur.setDate(cur.getDate() + 1);
        }

        const [blockedRows, conflictRows] = await Promise.all([
          env.DB.prepare('SELECT date FROM gym_blocked_dates').all(),
          env.DB.prepare(`SELECT booking_date FROM gym_bookings WHERE booking_date >= ? AND booking_date <= ? AND status IN ('confirmed','hold') AND start_time < ? AND end_time > ?`).bind(rec.start_date, rec.end_date, rec.end_time, rec.start_time).all(),
        ]);
        const blockedSet  = new Set(blockedRows.results.map(b => b.date));
        const conflictSet = new Set(conflictRows.results.map(b => b.booking_date));

        const recGroup = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(rec.group_id).first();
        let created = 0;
        for (const d of dates) {
          if (blockedSet.has(d) || conflictSet.has(d)) continue;
          try {
            await env.DB.prepare(
              `INSERT INTO gym_bookings (group_id, booking_date, start_time, end_time, notes, status, created_by, recurrence_id) VALUES (?, ?, ?, ?, ?, 'confirmed', 'admin', ?)`
            ).bind(rec.group_id, d, rec.start_time, rec.end_time, rec.notes||'', rec.id).run();
            await addGymBookingToGCal(env, { booking_date: d, start_time: rec.start_time, end_time: rec.end_time, group_name: recGroup?.name || '', notes: rec.notes||'' });
            created++;
          } catch (_) {}
        }
        await env.DB.prepare("UPDATE gym_recurrences SET status='approved' WHERE id=?").bind(rid).run();

        // Notify group
        const group = recGroup;
        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        if (group?.email) {
          try {
            await sendTransactionalEmail(env, {
              subject: `Recurring rental approved — ${DOW_NAMES[rec.day_of_week]}s ${fmt12h(rec.start_time)}–${fmt12h(rec.end_time)}`,
              htmlContent: `<p>Hi ${group.name},</p>
<p>Your recurring gym rental request has been approved. We've created <strong>${created} bookings</strong>:</p>
<ul>
  <li><strong>Day:</strong> ${DOW_NAMES[rec.day_of_week]}s</li>
  <li><strong>Time:</strong> ${fmt12h(rec.start_time)} – ${fmt12h(rec.end_time)}</li>
  <li><strong>Date range:</strong> ${formatDate(rec.start_date)} – ${formatDate(rec.end_date)}</li>
</ul>
<p>You can view your bookings at your portal link. Invoices will be sent monthly. Questions? Reply to this email or contact <a href="mailto:office@timothystl.org">office@timothystl.org</a>.</p>`,
              toEmails: [group.email],
            });
          } catch (_) {}
        }

        return new Response('', { status: 302, headers: { Location: `/gym-rentals/recurring/review/${rid}?msg=approved` } });
      }

      if (path.startsWith('/gym-rentals/recurring/reject/') && method === 'POST') {
        const rid = parseInt(path.split('/').pop(), 10);
        await env.DB.prepare("UPDATE gym_recurrences SET status='rejected' WHERE id=?").bind(rid).run();
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/recurring/review/${rid}?msg=rejected` } });
      }

      // ── RECURRING MONTHLY INVOICE ─────────────────────────────
      if (path.startsWith('/gym-rentals/recurring/invoice/') && method === 'POST') {
        const rid   = parseInt(path.split('/').pop(), 10);
        const form  = await request.formData();
        const month = form.get('month') || ''; // "YYYY-MM"
        if (!month) return new Response('', { status: 302, headers: { Location: `/gym-rentals/recurring/review/${rid}` } });

        const rec = await env.DB.prepare('SELECT * FROM gym_recurrences WHERE id=? AND status=\'approved\'').bind(rid).first();
        if (!rec) return new Response('', { status: 302, headers: { Location: '/gym-rentals/recurring' } });

        // Find all confirmed bookings for this recurrence in the selected month, not yet invoiced
        const periodStart = `${month}-01`;
        const periodEnd   = `${month}-31`;
        const alreadyInvoiced = await env.DB.prepare(
          'SELECT booking_id FROM gym_invoices WHERE recurrence_id=? AND period_start >= ? AND period_start <= ?'
        ).bind(rid, periodStart, periodEnd).all();
        const invoicedIds = new Set(alreadyInvoiced.results.map(r => r.booking_id));

        const sessions = await env.DB.prepare(
          `SELECT * FROM gym_bookings WHERE recurrence_id=? AND status='confirmed' AND booking_date >= ? AND booking_date <= ? ORDER BY booking_date`
        ).bind(rid, periodStart, periodEnd).all();

        const newSessions = sessions.results.filter(b => !invoicedIds.has(b.id));
        if (newSessions.length === 0)
          return new Response('', { status: 302, headers: { Location: `/gym-rentals/recurring/review/${rid}?msg=noinvoice` } });

        const group = await env.DB.prepare('SELECT * FROM gym_groups WHERE id=?').bind(rec.group_id).first();
        const rate = await getGroupRate(env, group);
        const hours = calcHours(rec.start_time, rec.end_time);
        const totalHours  = hours * newSessions.length;
        const totalAmount = Math.round(totalHours * rate * 100) / 100;
        const invoiceDate = new Date().toISOString().split('T')[0];

        const iRes = await env.DB.prepare(
          `INSERT INTO gym_invoices (group_id, recurrence_id, invoice_date, period_start, period_end, total_hours, rate, total_amount, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')`
        ).bind(rec.group_id, rid, invoiceDate, newSessions[0].booking_date, newSessions[newSessions.length-1].booking_date, totalHours, rate, totalAmount,
          `${newSessions.length} sessions — ${new Date(`${month}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}`
        ).run();
        const invoiceId = iRes.meta.last_row_id;

        const inv   = await env.DB.prepare('SELECT * FROM gym_invoices WHERE id=?').bind(invoiceId).first();
        const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        if (group) {
          const sessionList = newSessions.map(b => `<li>${formatDate(b.booking_date)} — ${fmt12h(b.start_time)}–${fmt12h(b.end_time)}</li>`).join('');
          const emailHtml = `<h2 style="font-family:Georgia,serif;color:#1E2D4A;">Gym Rental Invoice — ${new Date(`${month}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</h2>
<p>Hi ${group.name},</p>
<p>Your monthly gym rental invoice is attached for ${new Date(`${month}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}.</p>
<ul>${sessionList}</ul>
<p><strong>Total: $${totalAmount.toFixed(2)}</strong> (${totalHours}h × $${rate}/hr)</p>
<p>Please remit payment to Timothy Lutheran Church. Questions? <a href="mailto:office@timothystl.org">office@timothystl.org</a></p>`;
          const adminEmailRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key='gym_admin_email'").first();
          const toEmails = [adminEmailRow?.value || 'office@timothystl.org'];
          if (group.email) toEmails.push(group.email);
          try {
            await sendTransactionalEmail(env, {
              subject: `Gym Rental Invoice — ${group.name} — ${new Date(`${month}-15`).toLocaleDateString('en-US',{month:'long',year:'numeric'})}`,
              htmlContent: emailHtml,
              toEmails,
            });
          } catch (_) {}
        }
        return new Response('', { status: 302, headers: { Location: `/gym-rentals/invoices/view/${invoiceId}?msg=created` } });
      }

      // Fallback: redirect to dashboard
      return new Response('', { status: 302, headers: { Location: '/gym-rentals' } });
    } // end /gym-rentals

  return null; // not handled
}
