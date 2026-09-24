import { cancelBrevoCampaign } from './email.js';

// One durable operation per issue. No timeout-based lock stealing: a timed-out
// provider call can still succeed. A terminated request requires reconciliation,
// not a second potentially concurrent send. Normal errors always release the lock.
export async function withScheduleOperation(env, id, action) {
  const token = crypto.randomUUID();
  const row = await env.DB.prepare('UPDATE newsletters SET schedule_operation = ? WHERE id = ? AND schedule_operation IS NULL RETURNING *').bind(token, id).first();
  if (!row) return { error: 'This issue is busy or unavailable. Refresh before retrying. If it stays busy, ask an administrator to check its Brevo campaign.' };
  try { return await action(row); }
  catch { return { error: 'The campaign operation could not be confirmed. Refresh and check the campaign in Brevo before retrying.' }; }
  finally {
    await env.DB.prepare('UPDATE newsletters SET schedule_operation = NULL WHERE id = ? AND schedule_operation = ?').bind(id, token).run();
  }
}

export async function scheduleNewsletter(env, id, { subject, htmlContent, listIds, scheduledAt, listType }) {
  if (!env.BREVO_API_KEY) return { error: 'BREVO_API_KEY secret not configured' };
  return withScheduleOperation(env, id, async row => {
    if (row.sent_at || (row.scheduled_send_at && Date.parse(row.scheduled_send_at) <= Date.now())) {
      return { error: 'This issue may already have been sent. Check Brevo and duplicate the issue for a new send.' };
    }
    const headers = { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY };
    let campaignId = row.brevo_campaign_id;
    const content = { subject, htmlContent, recipients: { listIds } };
    if (!campaignId) {
      // Create an UNSCHEDULED draft. If the response or DB write is lost, the
      // orphan draft cannot send. Persist its ID before any request can queue it.
      const response = await fetch('https://api.brevo.com/v3/emailCampaigns', {
        method: 'POST', headers, body: JSON.stringify({ ...content,
          name: `TLC Newsletter — ${subject}`,
          sender: { name: 'Timothy Lutheran Church', email: env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org' },
          replyTo: env.BREVO_REPLY_TO || env.BREVO_SENDER_EMAIL || 'dinger@timothystl.org',
        }),
      });
      if (!response.ok) return { error: 'Brevo could not create the campaign draft. Nothing was scheduled.' };
      campaignId = (await response.json()).id;
      if (!Number.isSafeInteger(campaignId) || campaignId <= 0) return { error: 'Brevo returned an invalid draft ID. Nothing was scheduled.' };
      await env.DB.prepare("UPDATE newsletters SET brevo_campaign_id = ?, schedule_state = 'pending' WHERE id = ?").bind(String(campaignId), id).run();
    }
    // Save intended time first: even if Brevo times out after accepting it, the
    // next request retains both the ID and time and never creates another send.
    await env.DB.prepare("UPDATE newsletters SET scheduled_send_at = ?, scheduled_list_type = ?, schedule_state = 'pending' WHERE id = ?").bind(scheduledAt, listType, id).run();
    const response = await fetch(`https://api.brevo.com/v3/emailCampaigns/${encodeURIComponent(campaignId)}`, {
      method: 'PUT', headers, body: JSON.stringify({ ...content, scheduledAt }),
    });
    if (!response.ok) return { error: 'Brevo did not confirm the schedule. The campaign is retained; retry or cancel it before creating another send.' };
    await env.DB.prepare("UPDATE newsletters SET schedule_state = 'confirmed' WHERE id = ?").bind(id).run();
    return { success: true, campaignId };
  });
}

export async function cancelNewsletterSchedule(env, id) {
  return withScheduleOperation(env, id, async row => {
    if (row.sent_at || (row.scheduled_send_at && Date.parse(row.scheduled_send_at) <= Date.now())) {
      return { error: 'This campaign may already have been sent. Check Brevo; cancelling cannot recall a delivered email.' };
    }
    if (row.brevo_campaign_id) {
      const result = await cancelBrevoCampaign(env, row.brevo_campaign_id);
      if (!result.success) return result;
    }
    await env.DB.prepare('UPDATE newsletters SET schedule_state = NULL, scheduled_send_at = NULL, scheduled_list_type = NULL, brevo_campaign_id = NULL WHERE id = ?').bind(id).run();
    return { success: true };
  });
}
