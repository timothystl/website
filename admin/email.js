// ── EMAIL FUNCTIONS ──────────────────────────────────────────
// Extracted from tlc-admin-worker.js

import { formatDate } from './helpers.js';

// Short plain-text fields that end up in a broadcast email — a note heading, a
// subject — are typed by staff and land in six hundred inboxes. Rich bodies are
// deliberately not run through this: they come from the editor and are HTML on
// purpose. (The wider AC-2 sweep over this file is still open.)
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── BREVO EMAIL SEND ─────────────────────────────────────────
// Pass scheduledAt (ISO-8601 datetime) to have Brevo hold and auto-send the
// campaign at that time instead of sending immediately.
export async function sendBrevoNewsletter(env, { subject, htmlContent, listIds, scheduledAt }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { error: 'BREVO_API_KEY secret not configured' };

  const createResp = await fetch('https://api.brevo.com/v3/emailCampaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      name: `TLC Newsletter — ${subject}`,
      subject,
      sender: { name: 'Timothy Lutheran Church', email: env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org' },
      replyTo: env.BREVO_REPLY_TO || env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org',
      htmlContent,
      recipients: { listIds },
      ...(scheduledAt ? { scheduledAt } : {})
    })
  });
  if (!createResp.ok) return { error: `Brevo create error: ${await createResp.text()}` };
  const { id } = await createResp.json();

  // Scheduled campaigns are already queued by Brevo at creation time — calling
  // sendNow on top of a scheduledAt campaign would send it immediately instead.
  if (scheduledAt) return { success: true, campaignId: id, scheduled: true };

  const sendResp = await fetch(`https://api.brevo.com/v3/emailCampaigns/${id}/sendNow`, {
    method: 'POST',
    headers: { 'api-key': apiKey }
  });
  if (!sendResp.ok) return { error: `Brevo send error: ${await sendResp.text()}` };
  return { success: true, campaignId: id };
}

// ── BREVO CAMPAIGN CANCEL ────────────────────────────────────
// Deletes a not-yet-sent scheduled campaign so it never goes out.
export async function cancelBrevoCampaign(env, campaignId) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { error: 'BREVO_API_KEY secret not configured' };
  const resp = await fetch(`https://api.brevo.com/v3/emailCampaigns/${campaignId}`, {
    method: 'DELETE',
    headers: { 'api-key': apiKey }
  });
  if (!resp.ok && resp.status !== 404) return { error: `Brevo cancel error: ${await resp.text()}` };
  return { success: true };
}

// ── BREVO TRANSACTIONAL EMAIL ─────────────────────────────────
export async function sendTransactionalEmail(env, { subject, htmlContent, toEmails, replyTo }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { error: 'BREVO_API_KEY not configured' };
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender: { name: 'Timothy Lutheran Church', email: env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org' },
      replyTo: replyTo || { email: env.BREVO_REPLY_TO || env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org' },
      to: toEmails.map(e => ({ email: e })),
      subject,
      htmlContent
    })
  });
  if (!resp.ok) return { error: `Brevo error: ${await resp.text()}` };
  return { success: true };
}

// ── BUILD EMAIL HTML ─────────────────────────────────────────
// Layout: header · 2/3 pastor note + 1/3 events · main news · secondary news · WOL+LASM · additional posts · footer
export function buildEmailHtml(subject, pastorNote, events, wolContent, lasmContent, publishedAt, newsItems = [], secondaryNote = '', newsletterId = null, format = 'weekly', ctaUrl = '', ctaLabel = '', tertiaryNote = '', tertiaryCtaLabel = '', tertiaryCtaUrl = '', bibleClasses = [], extraNotes = []) {
  const dateStr = formatDate(publishedAt);
  const isQuick = format === 'quick';

  // Relative /images/... paths only resolve against the admin domain — fine in a
  // browser tab, but emails have no page origin to resolve them against.
  function fixImgSrc(url) {
    return url && url.startsWith('/images/') ? `https://admin.timothystl.org${url}` : url;
  }
  function fixBodyImgSrcs(html) {
    if (!html) return html;
    return html.replace(/src="\/images\//g, 'src="https://admin.timothystl.org/images/')
               .replace(/src='\/images\//g, "src='https://admin.timothystl.org/images/");
  }
  pastorNote = fixBodyImgSrcs(pastorNote);

  // HTML-aware truncation: cuts by visible-text length but keeps tags
  // (bold, paragraphs, line breaks) intact instead of stripping them, and
  // closes any tags left open by the cut.
  function truncateHtmlAware(html, limit) {
    const VOID_TAGS = new Set(['br', 'img', 'hr']);
    let result = '';
    let visibleCount = 0;
    let openTags = [];
    let i = 0;
    let cut = false;
    while (i < html.length && !cut) {
      if (html[i] === '<') {
        const close = html.indexOf('>', i);
        if (close === -1) break;
        const tag = html.slice(i, close + 1);
        result += tag;
        const nameMatch = tag.match(/^<\/?([a-zA-Z0-9]+)/);
        const name = nameMatch ? nameMatch[1].toLowerCase() : null;
        if (name && !VOID_TAGS.has(name) && !tag.endsWith('/>')) {
          if (tag.startsWith('</')) {
            const idx = openTags.lastIndexOf(name);
            if (idx !== -1) openTags.splice(idx, 1);
          } else {
            openTags.push(name);
          }
        }
        i = close + 1;
        continue;
      }
      if (visibleCount >= limit) { cut = true; break; }
      result += html[i];
      visibleCount++;
      i++;
    }
    if (cut) {
      result = result.replace(/\s+$/, '') + '…';
      for (let k = openTags.length - 1; k >= 0; k--) result += `</${openTags[k]}>`;
    }
    return { html: result, cut };
  }

  function truncate(text, limit) {
    if (!text) return '';
    const source = text + '';
    const stripped = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // Content fits within the limit — keep the original HTML (paragraphs, line
    // breaks, bold, images) instead of flattening it to plain text.
    if (stripped.length <= limit) return source;
    // Too long to show in full — truncate but keep formatting tags intact
    // rather than flattening to plain text. Any images cut off by the
    // truncation are appended afterward so they still render.
    const { html: truncated } = truncateHtmlAware(source, limit);
    const allImgs = source.match(/<img[^>]*>/gi) || [];
    const missingImgHtml = allImgs
      .filter(tag => !truncated.includes(tag))
      .map(tag => {
        const m = tag.match(/src=["']([^"']+)["']/i);
        return m ? `<img src="${m[1]}" alt="" style="max-width:100%;height:auto;border-radius:6px;display:block;margin-top:8px;">` : '';
      }).join('');
    return truncated + missingImgHtml;
  }

  // ── QUICK ANNOUNCEMENT layout (full-width, no events column) ──
  if (isQuick) {
    const ctaButtonHtml = (ctaLabel && ctaUrl)
      ? `<div style="text-align:center;margin:22px 0 0;"><a href="${ctaUrl}" style="display:inline-block;background:#0A3C5C;color:white;font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none;">${ctaLabel}</a></div>`
      : '';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#FAF7F0;font-family:'Source Sans 3',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F0;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <!-- HEADER -->
      <tr><td style="background:#0A3C5C;border-bottom:3px solid #D4922A;padding:16px 28px;border-radius:14px 14px 0 0;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="padding-right:14px;"><img src="https://timothystl.org/logo.png" alt="Timothy Lutheran Church" height="44" width="44" style="display:block;border-radius:50%;background:white;padding:3px;"></td>
          <td valign="middle">
            <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;font-weight:800;color:white;">Timothy Lutheran Church</div>
            <div style="font-family:'Lora',Georgia,serif;font-size:11px;font-style:italic;color:#D4922A;margin-top:2px;">from our Neighborhood to the Nations</div>
          </td>
        </tr></table>
      </td></tr>
      <!-- DATE + SUBJECT + FULL-WIDTH BODY -->
      <tr><td style="background:white;padding:24px 28px 28px;border-left:1px solid #E8E0D0;border-right:1px solid #E8E0D0;">
        <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#D4922A;margin-bottom:6px;">${dateStr}</div>
        <div style="font-family:'Lora',Georgia,serif;font-size:22px;color:#0A3C5C;margin-bottom:18px;padding-bottom:16px;border-bottom:2px solid #D4922A;">${subject}</div>
        <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:15px;color:#3D3530;line-height:1.85;">${pastorNote || ''}</div>
        ${ctaButtonHtml}
        <!-- FOOTER -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
          <tr><td style="border-top:1px solid #E8E0D0;padding:20px 0;text-align:center;">
            <a href="https://timothystl.org/news" style="display:inline-block;background:#0A3C5C;color:white;font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none;margin-right:10px;">Read on our website</a>
            <a href="https://timothystl.breezechms.com/give/online" style="display:inline-block;background:#D4922A;color:#0A3C5C;font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none;">Give online</a>
          </td></tr>
          <tr><td style="text-align:center;font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;color:#7A6E60;line-height:1.8;padding-bottom:20px;">
            6704 Fyler Ave · St. Louis, MO 63139<br>
            Sunday worship · 8:00 &amp; 10:45 am<br>
            <a href="mailto:dinger@timothystl.org" style="color:#7A6E60;text-decoration:none;">dinger@timothystl.org</a> · <a href="tel:+13147818673" style="color:#7A6E60;text-decoration:none;">(314) 781-8673</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="background:white;border:1px solid #E8E0D0;border-top:none;border-radius:0 0 14px 14px;height:10px;"></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  }

  // ── WEEKLY NEWSLETTER layout ──

  // Events sidebar rows
  const eventsRowsHtml = (events && events.length) ? events.map(e => `
<tr><td style="padding:9px 0;border-bottom:1px solid #E0D8CC;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="42" valign="top">
      <div style="background:#0A3C5C;color:white;border-radius:5px;padding:5px 6px;text-align:center;width:34px;">
        <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.7;">${e.event_date ? new Date(e.event_date+'T12:00:00').toLocaleDateString('en-US',{month:'short'}) : ''}</div>
        <div style="font-family:'Lora',Georgia,serif;font-size:16px;line-height:1.1;color:white;">${e.event_date ? new Date(e.event_date+'T12:00:00').getDate() : ''}</div>
      </div>
    </td>
    <td style="padding-left:9px;vertical-align:top;">
      <div style="font-family:'Lora',Georgia,serif;font-size:13px;color:#0A3C5C;">${e.event_name || ''}</div>
      <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;color:#7A6E60;">${e.event_time || ''}${e.event_desc ? ' · ' + e.event_desc : ''}</div>
    </td>
  </tr></table>
</td></tr>`).join('') : '';

  const calendarLink = `<a href="https://timothystl.org/calendar" style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;color:#D4922A;text-decoration:none;">View full calendar</a>`;
  const eventsSidebar = eventsRowsHtml ? `
<div style="background:#F7F3EC;border-radius:8px;padding:14px;">
  <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:10px;">Upcoming</div>
  <table width="100%" cellpadding="0" cellspacing="0">${eventsRowsHtml}</table>
  <div style="margin-top:12px;text-align:center;">${calendarLink}</div>
</div>` : `<div style="background:#F7F3EC;border-radius:8px;padding:14px 14px 12px;text-align:center;">${calendarLink}</div>`;

  // Main news (first item — featured)
  const mainNews = newsItems[0] || null;
  const secondaryNews = newsItems[1] || null;
  const additionalNews = newsItems.slice(2);

  const mainNewsImg = mainNews && mainNews.image_url ? `<img src="${fixImgSrc(mainNews.image_url)}" alt="" style="width:100%;max-height:220px;object-fit:contain;background:#F7F3EC;border-radius:8px;display:block;margin-bottom:10px;">` : '';
  const mainNewsHtml = mainNews ? `
<tr><td style="padding:22px 0 0;border-top:2px solid #D4922A;">
  <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#D4922A;margin-bottom:8px;">Featured</div>
  <div style="font-family:'Lora',Georgia,serif;font-size:20px;color:#0A3C5C;margin-bottom:8px;">${mainNews.title}</div>
  ${mainNewsImg}
  ${(mainNews.summary || mainNews.body) ? `<div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;color:#3D3530;line-height:1.75;margin-bottom:10px;">${truncate(mainNews.summary || fixBodyImgSrcs(mainNews.body), 280)}</div>` : ''}
  <a href="https://timothystl.org/news" style="font-family:'Source Sans 3',Arial,sans-serif;font-size:12px;font-weight:700;color:#D4922A;text-decoration:none;">Read more</a>
</td></tr>` : '';

  const secondaryNewsImg = secondaryNews && secondaryNews.image_url ? `<img src="${fixImgSrc(secondaryNews.image_url)}" alt="" style="width:100%;max-height:200px;object-fit:contain;background:#F7F3EC;border-radius:8px;display:block;margin-bottom:8px;">` : '';
  const secondaryNewsHtml = secondaryNews ? `
<tr><td style="padding:18px 0 0;border-top:1px solid #E8E0D0;">
  <div style="font-family:'Lora',Georgia,serif;font-size:17px;color:#0A3C5C;margin-bottom:6px;">${secondaryNews.title}</div>
  ${secondaryNewsImg}
  ${(secondaryNews.summary || secondaryNews.body) ? `<div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;color:#3D3530;line-height:1.7;margin-bottom:8px;">${truncate(secondaryNews.summary || fixBodyImgSrcs(secondaryNews.body), 200)}</div>` : ''}
  <a href="https://timothystl.org/news" style="font-family:'Source Sans 3',Arial,sans-serif;font-size:12px;font-weight:700;color:#D4922A;text-decoration:none;">Read more</a>
</td></tr>` : '';

  // WOL + LASM side by side — full width when only one is present
  const ministryCol = (label, content, width) => `<td class="min-col" width="${width}" valign="top" style="background:#EEF5EF;border-left:3px solid #6B8F71;border-radius:0 6px 6px 0;padding:13px;">
      <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6B8F71;margin-bottom:7px;">${label}</div><div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;color:#3D3530;line-height:1.7;">${content}</div>
    </td>`;
  const ministryRowHtml = (wolContent || lasmContent) ? `
<tr><td style="padding-top:22px;border-top:1px solid #E8E0D0;">
  <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6B8F71;margin-bottom:12px;">From our Ministry Partners</div>
  <table width="100%" cellpadding="0" cellspacing="0"><tr>
    ${wolContent && lasmContent
      ? `${ministryCol('Word of Life', wolContent, '48%')}<td class="min-gap" width="4%"></td>${ministryCol('LASM', lasmContent, '48%')}`
      : `${ministryCol(wolContent ? 'Word of Life' : 'LASM', wolContent || lasmContent, '100%')}`}
  </tr></table>
</td></tr>` : '';

  // Tertiary note / CTA block
  const tertiaryCta = (tertiaryCtaLabel && tertiaryCtaUrl)
    ? `<div style="text-align:center;margin-top:14px;"><a href="${tertiaryCtaUrl}" style="display:inline-block;background:#D4922A;color:#0A3C5C;font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;font-weight:700;padding:10px 24px;border-radius:6px;text-decoration:none;">${tertiaryCtaLabel}</a></div>`
    : '';
  const tertiaryNoteHtml = tertiaryNote ? `
<tr><td style="padding-top:20px;border-top:1px solid #E8E0D0;">
  <div style="background:#F4EFE8;border-left:3px solid #D4922A;border-radius:0 8px 8px 0;padding:16px 18px;">
    <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;color:#3D3530;line-height:1.8;">${tertiaryNote}</div>
    ${tertiaryCta}
  </div>
</td></tr>` : '';

  // Extra notes — the fourth block onward. Each is optional and each is its own
  // block rather than one long one, so a thank-you and a correction in the same
  // week read as two things. A heading is optional; without one the note simply
  // starts. Titles are escaped because they are typed, and land in an email
  // that goes to six hundred people.
  const extraNotesHtml = (extraNotes || []).map((n) => `
<tr><td style="padding-top:20px;border-top:1px solid #E8E0D0;">
  ${n.title ? `<div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;color:#0A3C5C;margin-bottom:8px;">${esc(n.title)}</div>` : ''}
  <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;color:#3D3530;line-height:1.8;">${n.body}</div>
</td></tr>`).join('');

  // Additional posts (3rd item onward — compact)
  const additionalNewsHtml = additionalNews.length ? `
<tr><td style="padding-top:20px;border-top:1px solid #E8E0D0;">
  <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D4922A;margin-bottom:12px;">More from Timothy</div>
  <table width="100%" cellpadding="0" cellspacing="0">
    ${additionalNews.map(item => `
    <tr><td style="padding:11px 0;border-bottom:1px solid #F0E8DC;">
      <div style="font-family:'Lora',Georgia,serif;font-size:15px;color:#0A3C5C;margin-bottom:4px;">${item.title}</div>
      ${(item.summary || item.body) ? `<div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:12px;color:#3D3530;line-height:1.65;margin-bottom:6px;">${truncate(item.summary || fixBodyImgSrcs(item.body), 150)}</div>` : ''}
      <a href="https://timothystl.org/news" style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;color:#D4922A;text-decoration:none;">Read more</a>
    </td></tr>`).join('')}
  </table>
</td></tr>` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
/* Responsive email — works in Gmail/iOS/Android/Apple Mail; Outlook desktop ignores and shows readable fixed layout */
@media (max-width:600px){
  .pastor-col{display:block !important;width:100% !important;padding-right:0 !important;border-right:none !important;}
  .spacer-col{display:none !important;}
  .events-col{display:block !important;width:100% !important;margin-top:16px !important;}
  .min-col{display:block !important;width:100% !important;margin-bottom:12px !important;}
  .min-gap{display:none !important;}
}
img{max-width:100% !important;height:auto !important;}
</style>
</head>
<body style="margin:0;padding:0;background:#FAF7F0;font-family:'Source Sans 3',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F0;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <!-- HEADER -->
      <tr><td style="background:#0A3C5C;border-bottom:3px solid #D4922A;padding:16px 28px;border-radius:14px 14px 0 0;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td valign="middle" style="padding-right:14px;"><img src="https://timothystl.org/logo.png" alt="Timothy Lutheran Church" height="44" width="44" style="display:block;border-radius:50%;background:white;padding:3px;"></td>
          <td valign="middle">
            <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;font-weight:800;color:white;">Timothy Lutheran Church</div>
            <div style="font-family:'Lora',Georgia,serif;font-size:11px;font-style:italic;color:#D4922A;margin-top:2px;">from our Neighborhood to the Nations</div>
          </td>
        </tr></table>
      </td></tr>
      <!-- DATE + SUBJECT -->
      <tr><td style="background:white;padding:24px 28px 0;border-left:1px solid #E8E0D0;border-right:1px solid #E8E0D0;">
        <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#D4922A;margin-bottom:6px;">${dateStr}</div>
        <div style="font-family:'Lora',Georgia,serif;font-size:22px;color:#0A3C5C;margin-bottom:18px;">${subject}</div>
        <!-- 2/3 pastor note + 1/3 events -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td class="pastor-col" width="390" valign="top" style="padding-right:18px;border-right:1px solid #E8E0D0;">
              ${pastorNote ? `<div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:15px;color:#3D3530;line-height:1.85;">${truncate(pastorNote, 500)}</div><div style="margin-top:10px;"><a href="https://timothystl.org/${newsletterId ? 'news/' + newsletterId : 'news'}" style="font-family:'Source Sans 3',Arial,sans-serif;font-size:12px;font-weight:700;color:#D4922A;text-decoration:none;">Read the full letter</a></div>` : ''}
            </td>
            <td class="spacer-col" width="16"></td>
            <td class="events-col" width="165" valign="top">${eventsSidebar}</td>
          </tr>
        </table>
        <!-- secondary note (typed) -->
        ${secondaryNote ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:0;"><tr><td style="padding:18px 0 0;border-top:1px solid #E8E0D0;"><div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:14px;color:#3D3530;line-height:1.8;">${secondaryNote}</div></td></tr></table>` : ''}
        <!-- news + ministry sections -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">
          ${mainNewsHtml}
          ${secondaryNewsHtml}
          ${ministryRowHtml}
          ${tertiaryNoteHtml}
          ${extraNotesHtml}
          ${additionalNewsHtml}
          ${bibleClasses && bibleClasses.length ? `
<tr><td style="padding-top:22px;border-top:1px solid #E8E0D0;">
  <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#0A3C5C;margin-bottom:12px;">Bible Classes</div>
  <table width="100%" cellpadding="0" cellspacing="0">
    ${bibleClasses.map(c => `<tr><td style="padding:9px 0;border-bottom:1px solid #F0E8DC;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        ${c.date ? `<td width="42" valign="top"><div style="background:#1E2D4A;color:white;border-radius:5px;padding:5px 6px;text-align:center;width:34px;"><div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:8px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.7;">${new Date(c.date+'T12:00:00').toLocaleDateString('en-US',{month:'short'})}</div><div style="font-family:'Lora',Georgia,serif;font-size:16px;line-height:1.1;color:white;">${new Date(c.date+'T12:00:00').getDate()}</div></div></td>` : ''}
        <td style="padding-left:${c.date?'9':'0'}px;vertical-align:top;">
          <div style="font-family:'Lora',Georgia,serif;font-size:13px;color:#0A3C5C;">${c.topic}</div>
          <div style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;color:#7A6E60;">${[c.leader,c.location].filter(Boolean).join(' · ')}</div>
        </td>
      </tr></table>
    </td></tr>`).join('')}
  </table>
  <div style="margin-top:10px;"><a href="https://timothystl.org/news" style="font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;font-weight:700;color:#C9973A;text-decoration:none;">View full calendar</a></div>
</td></tr>` : ''}
        </table>
        <!-- FOOTER -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
          <tr><td style="border-top:1px solid #E8E0D0;padding:20px 0;text-align:center;">
            <a href="https://timothystl.org/news" style="display:inline-block;background:#0A3C5C;color:white;font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none;margin-right:10px;">Read on our website</a>
            <a href="https://timothystl.breezechms.com/give/online" style="display:inline-block;background:#D4922A;color:#0A3C5C;font-family:'Source Sans 3',Arial,sans-serif;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none;">Give online</a>
          </td></tr>
          <tr><td style="text-align:center;font-family:'Source Sans 3',Arial,sans-serif;font-size:11px;color:#7A6E60;line-height:1.8;padding-bottom:20px;">
            6704 Fyler Ave · St. Louis, MO 63139<br>
            Sunday worship · 8:00 &amp; 10:45 am<br>
            <a href="mailto:dinger@timothystl.org" style="color:#7A6E60;text-decoration:none;">dinger@timothystl.org</a> · <a href="tel:+13147818673" style="color:#7A6E60;text-decoration:none;">(314) 781-8673</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="background:white;border:1px solid #E8E0D0;border-top:none;border-radius:0 0 14px 14px;height:10px;"></td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── BUILD WEB HTML (for archive) ─────────────────────────────
export function buildWebHtml(subject, pastorNote, events, ministryContent, ministryType, publishedAt) {
  return JSON.stringify({ subject, pastorNote, events, ministryContent, ministryType, publishedAt });
}
