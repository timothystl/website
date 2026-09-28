// ── Gym rental income for Finance ──────────────────────────────────────────
// Finance's Facilities → Gym rental income page reads this over its service
// binding. Bookings and invoices stay here; Finance only reports on them.
//
// Same caller proof as Finance's payroll relay (payroll-contract-auth.js): the
// shared X-Contract-Key secret plus a Website-verified Access identity that
// maps to an active user here, who must hold gym_manage.
//
// Figures come from gym_invoices. An invoice counts toward the year and month
// of its invoice_date. Invoices record paid/unpaid, not the date money arrived,
// so "paid" means "paid as of now," not "collected in that month." Overdue
// matches the invoice email: unpaid 14 days after the invoice date.
import { resolvePayrollContractCaller } from './payroll-contract-auth.js';
import { hasPermission } from './auth.js';

const DUE_DAYS = 14;
const OPEN_LIMIT = 100;

const cents = (amount) => Math.round((Number(amount) || 0) * 100);

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function buildGymIncomeReport(db, { year, today }) {
  const yearRows = (await db.prepare(
    "SELECT DISTINCT substr(invoice_date, 1, 4) AS y FROM gym_invoices WHERE invoice_date GLOB '[0-9][0-9][0-9][0-9]-*' ORDER BY y DESC"
  ).all()).results || [];
  const years = yearRows.map((r) => Number(r.y)).filter(Number.isInteger);

  const invoices = (await db.prepare(
    `SELECT i.id, i.invoice_date, i.period_start, i.period_end, i.total_hours, i.total_amount, i.status,
            i.group_id, COALESCE(g.name, 'Unknown group') AS group_name
       FROM gym_invoices i LEFT JOIN gym_groups g ON g.id = i.group_id
      WHERE substr(i.invoice_date, 1, 4) = ?
      ORDER BY i.invoice_date, i.id`
  ).bind(String(year)).all()).results || [];

  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, invoiced_cents: 0, paid_cents: 0, invoice_count: 0 }));
  const groups = new Map();
  const totals = { invoiced_cents: 0, paid_cents: 0, unpaid_cents: 0, overdue_cents: 0, invoice_count: 0, hours: 0 };
  for (const inv of invoices) {
    const amount = cents(inv.total_amount);
    const paid = inv.status === 'paid';
    const overdue = !paid && addDays(inv.invoice_date, DUE_DAYS) < today;
    const hours = Number(inv.total_hours) || 0;
    totals.invoiced_cents += amount;
    totals.invoice_count += 1;
    totals.hours += hours;
    if (paid) totals.paid_cents += amount; else totals.unpaid_cents += amount;
    if (overdue) totals.overdue_cents += amount;
    const m = months[Number(inv.invoice_date.slice(5, 7)) - 1];
    if (m) {
      m.invoiced_cents += amount;
      m.invoice_count += 1;
      if (paid) m.paid_cents += amount;
    }
    const key = inv.group_id ?? `name:${inv.group_name}`;
    const g = groups.get(key) || { group_name: inv.group_name, invoiced_cents: 0, paid_cents: 0, unpaid_cents: 0, invoice_count: 0, hours: 0 };
    g.invoiced_cents += amount;
    g.invoice_count += 1;
    g.hours += hours;
    if (paid) g.paid_cents += amount; else g.unpaid_cents += amount;
    groups.set(key, g);
  }
  totals.hours = Math.round(totals.hours * 100) / 100;

  // Every unpaid invoice, not just this year's: an old unpaid invoice is still money owed.
  const open = ((await db.prepare(
    `SELECT i.id, i.invoice_date, i.period_start, i.period_end, i.total_amount, COALESCE(g.name, 'Unknown group') AS group_name
       FROM gym_invoices i LEFT JOIN gym_groups g ON g.id = i.group_id
      WHERE i.status = 'unpaid'
      ORDER BY i.invoice_date, i.id
      LIMIT ?`
  ).bind(OPEN_LIMIT).all()).results || []).map((inv) => {
    const due = addDays(inv.invoice_date, DUE_DAYS);
    return {
      id: inv.id, group_name: inv.group_name, invoice_date: inv.invoice_date,
      period_start: inv.period_start || '', period_end: inv.period_end || '',
      amount_cents: cents(inv.total_amount), due_date: due, overdue: due < today,
    };
  });

  return {
    contract: 'website.gym-income.v1',
    year, today, years, due_days: DUE_DAYS,
    totals,
    months,
    groups: [...groups.values()]
      .map((g) => ({ ...g, hours: Math.round(g.hours * 100) / 100 }))
      .sort((a, b) => b.invoiced_cents - a.invoiced_cents || a.group_name.localeCompare(b.group_name)),
    open_invoices: open,
    open_limited: open.length === OPEN_LIMIT,
  };
}

// GET /api/contracts/gym-income-v1?year=YYYY
export async function handleGymIncomeContract(request, env, { today }) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  const user = await resolvePayrollContractCaller(request, env).catch(() => null);
  if (!user) return new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401, headers });
  if (!hasPermission(user, 'gym_manage')) {
    return new Response(JSON.stringify({ error: 'Gym rental income requires the Gym permission in Website Admin.' }), { status: 403, headers });
  }
  const requested = parseInt(new URL(request.url).searchParams.get('year') || '', 10);
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2200 ? requested : Number(today.slice(0, 4));
  try {
    return new Response(JSON.stringify(await buildGymIncomeReport(env.DB, { year, today })), { headers });
  } catch (e) {
    console.error('gym-income-v1 failed:', e?.message);
    return new Response(JSON.stringify({ error: 'Gym invoices could not be read.' }), { status: 500, headers });
  }
}
