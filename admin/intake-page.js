// ── EVENT INTAKE — the office's own triage screen over everything that has
// a date ─────────────────────────────────────────────────────────────────
//
// Built from the `Event Intake.dc.html` Claude Design handoff (the
// `custom-google-calendar-redesign` bundle's companion file to the church
// calendar boards already shipped — see "The calendar is ours now" in
// CLAUDE.md). Recreated directly from the mock's markup/CSS rather than
// from a screenshot, per that bundle's own README.
//
// Three panes: queues on the left, the selected queue's list in the middle,
// the selected item's form on the right. Every control is a plain link or a
// plain <form> — see the note above handleIntakeRoutes() for why this
// screen does a full reload per action rather than the Christmas Market
// vendor table's instant-save pattern.
//
// Three deliberate, explicit decisions from Andrew, all binding on this
// design:
//   1. The checklist is PURELY INTERNAL STAFF TRACKING. It never gates what
//      appears on the public /calendar — that feed (admin/calendar.js) has
//      no idea event_intake exists, except for reading a "local" row's own
//      fields. An item with every box unchecked, still classified as
//      Worship, already shows up on the church calendar exactly as it does
//      today; Publish here only fills in this screen's own record.
//   2. "Type" (Worship / Education / Rental / News) is a NEW, SEPARATE idea
//      from the eleven calendar_categories a Google event's color already
//      maps to (see admin/calendar.js). Nothing here ever writes
//      calendar_category, and picking a type never touches it.
//   3. EVERYTHING flows into the queue — not just Google Calendar events.
//      Every News & Events post with a date, and every confirmed gym
//      booking, gets a row too. (The mock's own seed data only ever showed
//      "google"/"news"/"form" as sources; gym is this repo's fourth,
//      answering Andrew's explicit "everything, including gym bookings".)
//
// A fourth source — "local" — is new relative to the mock too: the
// "+ New event" button the mock's own topbar always had, for a booking with
// no Google event and no News & Events post behind it (a private wedding, a
// one-off outside group). A local row is the one kind Event Intake can
// create or delete outright; every other row's real record — the Google
// event, the News post, the gym booking — is unaffected by anything here.
//
// admin/intake.js holds every pure decision (types, checklists, the merge,
// the queues) and is unit-tested with zero D1 access. This file is the D1
// I/O, the routes, and the render — the same split admin/market.js and
// admin/gym.js already use for their own bespoke (non-renderListSection)
// screens.
import { html, sidebarShell, escapeHtml } from './helpers.js';
import { hasPermission } from './auth.js';
import { churchDatePlus } from './when.js';
import {
  mergedCategories, parseCalendarIds, fetchGoogleEvents, readNewsEvents,
  normalizeLocalIntakeEvent, normalizeClock,
} from './calendar.js';
import { getGCalAccessToken } from './gym.js';
import {
  TYPES, TYPE_KEYS, TYPE_FIELDS, CHECKLISTS, ROOMS, SOURCE_LABEL, SOURCE_COLOR,
  intakeKeyFor, sourceKindOfKey, checklistFor, openCountOf, isReady,
  mergeIntakeItems, QUEUE_TOP, filterQueue, queueCounts, QUEUE_TITLES,
  deferredFieldsSource, VALUE_LABELS, VALUE_ORDER, typesForValue, typesWithNoValue,
} from './intake.js';
// ⚠ isValidTypeField()/isValidChecklistKey() are NOT imported here. The save
// route below never trusts a posted FIELD NAME at all — it iterates
// TYPE_FIELDS[type]/CHECKLISTS[type] (the fixed list) and reads each value by
// its own known key, so a crafted extra___proto__ or check_constructor in the
// POST body is never even looked at, let alone validated. Both functions are
// still exported from admin/intake.js and covered by admin/intake.test.mjs —
// they exist for a future write path (e.g. an AJAX single-field save, the way
// the Christmas Market vendor table works) that would need to check a posted
// key rather than only ever building one from a fixed list.

// ── EVENT INTAKE — STYLE ─────────────────────────────────────────────────
// Recreated from `Event Intake.dc.html` — the three-column layout, the
// exact colors and radii it specifies, and Bricolage Grotesque for every
// label/heading/button, Newsreader for body text (the same pair the site
// redesign uses for the public-facing "1b" language — see the site
// redesign entry in CLAUDE.md — reused here rather than the admin's own
// Lora/Source Sans, because that pairing is what the mock actually
// specifies down to the family names).
//
// ⚠ Passed to html() as extraHead, so it lands inside the admin shell's own
// <head> — the sidebar/context-bar chrome around this screen keeps using
// Lora/Source Sans as normal; only the .ei-* surface switches fonts.
const INTAKE_CSS = `<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Newsreader:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
.ei-wrap{background:#E4E0D6;font-family:'Newsreader',Georgia,serif;color:#1A1A2A;margin:-24px -28px;padding:0;min-height:calc(100vh - 46px);display:flex;flex-direction:column;}
.ei-wrap *,.ei-wrap *::before,.ei-wrap *::after{box-sizing:border-box;}
.ei-wrap a{color:#2E7EA6;text-decoration:none;}
.ei-wrap a:hover{color:#1E2D4A;}
.ei-wrap input,.ei-wrap select,.ei-wrap textarea,.ei-wrap button{font:inherit;color:inherit;}
.ei-wrap input:focus,.ei-wrap select:focus,.ei-wrap textarea:focus,.ei-wrap button:focus-visible{outline:2px solid #2E7EA6;outline-offset:1px;}

.ei-topbar{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 28px;background:#1E2D4A;color:#F7F4EE;}
.ei-brand{display:flex;align-items:baseline;gap:14px;}
.ei-brand-name{font-family:'Bricolage Grotesque',sans-serif;font-size:17px;font-weight:800;letter-spacing:-.01em;}
.ei-brand-sub{font-family:'Bricolage Grotesque',sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#9FB0C9;}
.ei-topbar-r{display:flex;align-items:center;gap:18px;}
.ei-open-count{font-size:15px;color:#C6D0DF;}

.ei-btn{font-family:'Bricolage Grotesque',sans-serif;font-size:13px;font-weight:800;border:none;border-radius:999px;padding:10px 18px;cursor:pointer;display:inline-block;text-align:center;}
.ei-btn-gold{background:#C9973A;color:#1A1A2A;}
.ei-btn-gold:hover{background:#DCA845;color:#1A1A2A;}

.ei-warn{background:#FBEEDA;color:#8A5B12;font-size:14px;padding:10px 28px;border-bottom:1px solid #EED9AE;}

.ei-cols{display:grid;grid-template-columns:236px minmax(320px,1fr) minmax(390px,470px);align-items:stretch;flex:1;min-height:0;overflow-x:auto;overflow-y:hidden;}

/* ── LEFT RAIL — queues ── */
.ei-rail{background:#FBF8F3;border-right:1px solid #DDE3ED;padding:22px 16px;display:flex;flex-direction:column;gap:22px;min-height:0;overflow:auto;}
.ei-rail-group{display:flex;flex-direction:column;gap:4px;}
.ei-rail-label{font-family:'Bricolage Grotesque',sans-serif;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8A8898;padding:0 8px 6px;}
.ei-qrow{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;border:none;cursor:pointer;border-radius:8px;padding:9px 10px;font-family:'Bricolage Grotesque',sans-serif;font-size:14px;font-weight:600;background:transparent;color:#4A4860;text-decoration:none;}
.ei-qrow:hover{background:#F1ECE0;color:#1E2D4A;}
.ei-qrow-on{background:#1E2D4A;color:#F7F4EE;font-weight:700;}
.ei-qrow-on:hover{background:#1E2D4A;color:#F7F4EE;}
.ei-qrow-label{display:flex;align-items:center;gap:9px;}
.ei-qrow-count{font-size:12px;font-weight:800;background:#EAE4D6;color:#6A6858;border-radius:999px;padding:2px 8px;}
.ei-qrow-on .ei-qrow-count{background:rgba(255,255,255,.18);color:#F7F4EE;}
.ei-dot{width:9px;height:9px;border-radius:3px;flex:none;display:inline-block;}
.ei-rail-sources{margin-top:auto;display:flex;flex-direction:column;gap:6px;border-top:1px solid #DDE3ED;padding:16px 10px 0;}
.ei-rail-title{font-family:'Bricolage Grotesque',sans-serif;font-size:13px;font-weight:800;color:#1E2D4A;}
.ei-src-row{display:flex;align-items:center;gap:8px;font-size:14px;color:#4A4860;}

/* ── MIDDLE — the queue's list ── */
.ei-mid{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;border-right:1px solid #DDE3ED;background:#EFEBE2;}
.ei-mid-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:20px 24px 14px;}
.ei-mid-title{display:block;font-family:'Bricolage Grotesque',sans-serif;font-size:22px;font-weight:700;color:#1E2D4A;}
.ei-mid-sub{display:block;font-size:15px;color:#8A8898;}
.ei-mid-list{flex:1;min-height:0;overflow:auto;padding:0 16px 24px;display:flex;flex-direction:column;gap:8px;}
.ei-empty{padding:40px 12px;text-align:center;font-size:16px;color:#8A8898;}

.ei-filterbar{display:flex;align-items:center;gap:10px;padding:0 24px 10px;}
.ei-filterbar input{flex:1;min-width:0;border:1px solid #DDE3ED;border-radius:8px;padding:9px 12px;font-size:14px;background:#fff;}
.ei-filterbar input:focus{outline:2px solid #2E7EA6;outline-offset:1px;}
.ei-bulkbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 2px 4px;font-size:13px;color:#4A4860;}
.ei-bulkall{display:flex;align-items:center;gap:6px;font-family:'Bricolage Grotesque',sans-serif;font-weight:700;cursor:pointer;}
.ei-bulkbar select{border:1px solid #DDE3ED;border-radius:8px;padding:7px 9px;background:#fff;font-size:13px;}
.ei-row-line{display:flex;align-items:flex-start;gap:8px;}
.ei-row-checkwrap{flex:none;padding-top:16px;}
.ei-row-check{width:16px;height:16px;cursor:pointer;}
.ei-row{display:grid;grid-template-columns:52px 1fr auto;gap:14px;align-items:start;flex:1;min-width:0;text-align:left;cursor:pointer;background:#fff;border:1px solid #DDE3ED;border-left:4px solid #DDE3ED;border-radius:10px;padding:13px 15px;text-decoration:none;color:inherit;}
.ei-row:hover{border-color:#C9C2AE;}
.ei-row-on{background:#FFFDF9;border-color:#1E2D4A;box-shadow:0 0 0 1px #1E2D4A inset;}
.ei-row-date{display:flex;flex-direction:column;align-items:center;}
.ei-row-dow{font-family:'Bricolage Grotesque',sans-serif;font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#8A8898;}
.ei-row-day{font-family:'Bricolage Grotesque',sans-serif;font-size:22px;font-weight:700;color:#1E2D4A;line-height:1.1;}
.ei-row-mid{display:flex;flex-direction:column;gap:4px;min-width:0;}
.ei-row-title{font-family:'Bricolage Grotesque',sans-serif;font-size:16px;font-weight:700;color:#1A1A2A;line-height:1.3;}
.ei-row-meta{display:flex;align-items:center;gap:7px;font-size:14px;color:#8A8898;}
.ei-row-chips{display:flex;flex-wrap:wrap;align-items:flex-start;gap:6px;padding-top:2px;}
.ei-chip{font-family:'Bricolage Grotesque',sans-serif;font-size:11px;font-weight:700;line-height:1.5;white-space:nowrap;background:#FBEEDA;color:#8A5B12;border-radius:5px;padding:3px 7px;}
.ei-status{font-family:'Bricolage Grotesque',sans-serif;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#8A5B12;background:#FBEEDA;border-radius:999px;padding:4px 10px;white-space:nowrap;}
.ei-status-ready{color:#3F5424;background:#EDF0E4;}

/* ── RIGHT — the detail / form pane ── */
.ei-detail{background:#fff;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;height:100%;}
.ei-detail-empty{align-items:center;justify-content:center;padding:40px;text-align:center;color:#8A8898;font-size:16px;}
.ei-form{display:flex;flex-direction:column;min-height:0;overflow:hidden;flex:1;}
.ei-detail-head{padding:20px 26px 16px;border-bottom:1px solid #EDE9E0;display:flex;flex-direction:column;gap:12px;}
.ei-detail-headrow{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;}
.ei-kicker{display:block;font-family:'Bricolage Grotesque',sans-serif;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8A8898;}
.ei-detail-title{display:block;font-family:'Bricolage Grotesque',sans-serif;font-size:24px;font-weight:700;color:#1E2D4A;line-height:1.2;}
.ei-pillrow{display:flex;gap:6px;flex-wrap:wrap;}
.ei-pillform{display:contents;}
.ei-pill{display:flex;align-items:center;gap:7px;font-family:'Bricolage Grotesque',sans-serif;font-size:12px;font-weight:700;cursor:pointer;border-radius:999px;padding:7px 13px;background:#fff;color:#4A4860;border:1px solid #DDE3ED;}
.ei-pill:hover{border-color:#C9C2AE;}
.ei-pill-on{color:#F7F4EE;}
.ei-pill-dot{width:8px;height:8px;border-radius:2px;flex:none;display:inline-block;background:#8A8898;}

.ei-detail-body{flex:1;min-height:0;overflow:auto;padding:20px 26px 26px;display:flex;flex-direction:column;gap:22px;}
.ei-basegroup{display:flex;flex-direction:column;gap:14px;border-top:1px solid #EDE9E0;padding-top:20px;}
.ei-basegroup:first-child{border-top:none;padding-top:0;}
.ei-note{font-size:14px;color:#8A8898;line-height:1.5;margin:0;}
.ei-field{display:flex;flex-direction:column;gap:5px;}
.ei-field-label{font-family:'Bricolage Grotesque',sans-serif;font-size:12px;font-weight:700;color:#4A4860;}
.ei-field select,.ei-field input,.ei-field textarea{border:1px solid #DDE3ED;border-radius:8px;padding:9px 11px;font-size:16px;background:#FBF8F3;width:100%;}
.ei-field textarea{resize:vertical;font-family:'Newsreader',Georgia,serif;}
.ei-field-row{display:flex;gap:12px;}
.ei-field-row .ei-field{flex:1;min-width:0;}

.ei-checklist{display:flex;flex-direction:column;gap:10px;border-top:1px solid #EDE9E0;padding-top:20px;}
.ei-checklist-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;}
.ei-check{position:relative;display:grid;grid-template-columns:20px 1fr;gap:11px;align-items:start;width:100%;text-align:left;cursor:pointer;background:#FBF8F3;border:1px solid #DDE3ED;border-radius:8px;padding:11px 12px;}
.ei-check input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer;width:100%;height:100%;}
.ei-check-box{width:20px;height:20px;border-radius:5px;border:1.5px solid #C9C2AE;background:transparent;color:transparent;font-family:'Bricolage Grotesque',sans-serif;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none;}
/* Do not put a backtick in this comment — it lives inside a JS template
   literal and one has broken this module before.
   DRIVEN BY the live checked state, not only by the server-rendered class.
   The done flag from the database sets the box's INITIAL paint (the checked
   attribute and this class, so a reload shows the truth) — but clicking the
   box only ever changed the input's checked state, and nothing here was
   reading that afterward, so the tick and the fill silently never appeared
   until the whole page reloaded. Reported as the checkboxes being "unable to
   be ticked" — they were being ticked, the screen just never said so. Both
   selectors below are kept: the class keeps the very first paint honest
   before any script has run, and the checked-state rule (via the same
   has-selector mechanism already used elsewhere in this admin) is what makes
   every click after that visible with no page reload. */
.ei-check-done,.ei-check:has(input:checked){background:#EDF0E4;border-color:#B9C7A4;}
.ei-check-done .ei-check-box,.ei-check:has(input:checked) .ei-check-box{background:#3F5424;border-color:#3F5424;color:#fff;}
.ei-check-text{display:flex;flex-direction:column;gap:2px;}
.ei-check-text>span:first-child{font-size:16px;line-height:1.35;color:#1A1A2A;}
.ei-check-who{font-size:13px;color:#8A8898;}

.ei-deferred{display:flex;flex-direction:column;gap:8px;background:#FBF8F3;border:1px solid #DDE3ED;border-radius:8px;padding:14px 16px;}
.ei-deferred-note{font-size:13px;color:#8A8898;margin:0;}
.ei-deferred-row{font-size:15px;color:#1A1A2A;}
.ei-deferred-link{font-size:13px;font-weight:700;}

.ei-actions{display:flex;flex-direction:column;gap:10px;border-top:1px solid #EDE9E0;padding-top:20px;}
.ei-actions>div{display:flex;gap:10px;}
.ei-btn-primary{flex:1;background:#1E2D4A;color:#F7F4EE;padding:13px;font-size:14px;}
.ei-btn-primary[disabled]{background:#DDE3ED;color:#8A8898;cursor:not-allowed;}
.ei-btn-primary:not([disabled]):hover{background:#16233A;}
.ei-btn-ghost{background:#FBF8F3;color:#4A4860;border:1px solid #DDE3ED;padding:13px 16px;font-size:14px;font-weight:700;border-radius:9px;}
.ei-btn-ghost:hover{border-color:#C9C2AE;}
.ei-footnote{font-size:14px;line-height:1.55;color:#8A8898;margin:0;}
.ei-holdform{margin:0;}
.ei-link-btn{background:none;border:none;padding:10px 26px;font-family:'Bricolage Grotesque',sans-serif;font-size:13px;font-weight:700;color:#4A4860;cursor:pointer;text-align:left;width:100%;}
.ei-link-btn:hover{color:#1E2D4A;text-decoration:underline;}
.ei-link-danger{color:#8C3A28;}
.ei-link-danger:hover{color:#6B2A1C;}

@media (max-width:900px){
  .ei-cols{grid-template-columns:1fr;grid-auto-rows:auto;overflow:visible;}
  .ei-rail,.ei-mid,.ei-detail{overflow:visible;min-height:0;}
  .ei-wrap{min-height:auto;}
}
</style>`;
// ── EVENT INTAKE ──────────────────────────────────────────────────────────
// The office's own triage queue over everything with a date on it. See the
// long note at the top of admin/intake.js for the design — types are a
// separate question from calendar categories, nothing here gates the public
// calendar, and a "local" row is the one kind with no other record anywhere
// else.
//
// ⚠ THIS SCREEN DOES A FULL RELOAD PER ACTION, NOT AJAX-PER-FIELD. The
// Christmas Market's vendor table (v5.30.0) is this repo's other precedent
// and it saves each field instantly. Event Intake does not, on purpose: the
// screen is new, the mock's own interaction (an instant checkbox click) would
// need a client script this pass did not build, and every action here already
// reads cleanly as "submit a form, land back on the queue" — Type, Save,
// Publish, Hold, New, Delete. If the office finds the reload tedious once
// this is in daily use, wiring the market's own AJAX pattern onto these same
// routes is the next step, not a rewrite.
export async function handleIntakeRoutes(request, env, path, method, currentUser, url, badges = {}) {
  if (path !== '/event-intake' && !path.startsWith('/event-intake/')) return null;
  if (!hasPermission(currentUser, 'intake_manage')) {
    return new Response('Access denied.', { status: 403 });
  }

      const INTAKE_FROM = churchDatePlus(-3);
      const INTAKE_TO = churchDatePlus(60);
      const isYmdLoose = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

      // Every source's raw list, already shaped for mergeIntakeItems: source
      // is one of gcal/news/gym/local. Gym's renter/contact/notes ride in a
      // side map rather than the shared shape — Google and News items have
      // nothing analogous, and parsing it for the 95% of rows that are not
      // gym rentals would be wasted work.
      async function loadIntakeRaw() {
        const catRows = ((await env.DB.prepare(
          'SELECT key, name, color_id, palette, sort_order, active FROM calendar_categories'
        ).all().catch(() => ({ results: [] }))).results) || [];
        const cats = mergedCategories(catRows);
        const idRow = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'calendar_google_ids'")
          .first().catch(() => null);
        const [google, news, gymRows, localRows] = await Promise.all([
          fetchGoogleEvents(env, { ids: parseCalendarIds(idRow && idRow.value), from: INTAKE_FROM, to: INTAKE_TO, getToken: getGCalAccessToken, cats }),
          readNewsEvents(env, INTAKE_FROM, INTAKE_TO, cats),
          env.DB.prepare(
            `SELECT b.id, b.booking_date, b.start_time, b.end_time, b.notes,
                    g.name AS group_name, g.contact AS group_contact, g.phone AS group_phone
               FROM gym_bookings b LEFT JOIN gym_groups g ON g.id = b.group_id
              WHERE b.status = 'confirmed' AND b.booking_date >= ? AND b.booking_date <= ?
              ORDER BY b.booking_date ASC`
          ).bind(INTAKE_FROM, INTAKE_TO).all().then((r) => r.results || []).catch(() => []),
          env.DB.prepare(
            `SELECT id, local_title, local_event_date, local_end_date, local_event_time, local_end_time, room
               FROM event_intake WHERE source_kind = 'local' AND local_event_date IS NOT NULL
                AND local_event_date >= ? AND local_event_date <= ? ORDER BY local_event_date ASC`
          ).bind(INTAKE_FROM, INTAKE_TO).all().then((r) => r.results || []).catch(() => []),
        ]);

        const gymExtra = new Map();
        const gymRaw = gymRows.map((b) => {
          const st = (b.start_time || '00:00').slice(0, 5);
          const et = (b.end_time || b.start_time || '00:00').slice(0, 5);
          const key = intakeKeyFor('gym', b.id);
          gymExtra.set(key, {
            renter: b.group_name || '(no group on file)',
            contact: [b.group_contact, b.group_phone].filter(Boolean).join(' · ') || '—',
            setup: b.notes || '',
          });
          return { id: key, source: 'gym', title: b.group_name || 'Gym rental',
            start: `${b.booking_date}T${st}:00`, end: `${b.booking_date}T${et}:00`, allDay: false, location: 'Gym' };
        });

        const localRaw = localRows.map((r) => {
          const ev = normalizeLocalIntakeEvent({ ...r, event_type: null }, cats);
          return ev ? { id: `l:${r.id}`, source: 'local', title: ev.title, start: ev.start, end: ev.end, allDay: ev.allDay, location: ev.location } : null;
        }).filter(Boolean);

        return { raw: google.events.concat(news, gymRaw, localRaw), gymExtra, googleOk: google.ok };
      }

      // New Google/News/gym rows get a placeholder so they exist for the
      // badge and for a later visit; a `local` row is already the real row,
      // nothing to sync. event_date is refreshed on every visit so the
      // sidebar badge (a DB-only count — see intakeOpenCount) stays roughly
      // current without ever fetching Google itself.
      //
      // ⚠ RUN IN PARALLEL, NOT ONE-AT-A-TIME. This used to be a serial
      // `for…await` loop, and every GET of /event-intake runs it — including
      // the redirect target after every single action, so picking a type on
      // one event meant re-syncing the whole window (recurring services over
      // ~63 days plus news/gym/local can genuinely run to 100+ rows) as one
      // D1 round trip per row, awaited before the next began. Reported as the
      // screen "hanging up" when assigning a type — it wasn't hung, it was
      // waiting on a hundred-plus sequential writes it did not need to be
      // sequential. Each row's key is distinct, so nothing here can collide
      // with another row in the same batch; there is no reason two INSERTs
      // for two different events have to wait on each other.
      async function syncIntakeRows(raw) {
        const dayOf = (iso) => String(iso || '').slice(0, 10);
        await Promise.all(raw.filter((ev) => ev.source !== 'local').map((ev) => {
          const kind = ev.source === 'gcal' ? 'gcal' : ev.source === 'news' ? 'news' : 'gym';
          return env.DB.prepare(
            `INSERT INTO event_intake (source_kind, source_key, event_date) VALUES (?, ?, ?)
             ON CONFLICT(source_key) DO UPDATE SET event_date = excluded.event_date`
          ).bind(kind, ev.id, dayOf(ev.start)).run().catch(() => {});
        }));
      }

      // ⚠ CHUNKED AT 99, NOT ONE `IN (...)` OVER EVERY KEY — D1 refuses a
      // prepared statement with too many bound parameters, and this window
      // (recurring Google services over 63 days, plus News and gym) clears
      // that on its own the moment a real church's calendar has more than a
      // handful of weekly services. The failure was SILENT: `.catch(() =>
      // ({results: []}))` swallowed the error, so every non-local item read
      // back with no matching row — `dbId` null, `type` null — however many
      // times a type had actually been written. That is the reported "I
      // assign a type, it spins, and nothing is saved, forever": the write
      // itself went through `/event-intake/type`'s own single-row
      // `WHERE source_key = ?` query and landed every time; it was THIS read,
      // on the very next page load, that lost it — and bulk-type reads the
      // same way before it writes, so `dbId` was null there too and its
      // `Promise.all` had nothing to act on. Same limit, same fix as the gym
      // module's multi-booking invoice fetch (`admin/gym.js`) — chunk to 99.
      async function readIntakeRows(raw) {
        const rows = [];
        const local = await env.DB.prepare("SELECT * FROM event_intake WHERE source_kind = 'local'")
          .all().catch(() => ({ results: [] }));
        rows.push(...(local.results || []));
        const keys = raw.filter((ev) => ev.source !== 'local').map((ev) => ev.id);
        for (let i = 0; i < keys.length; i += 99) {
          const chunk = keys.slice(i, i + 99);
          const placeholders = chunk.map(() => '?').join(',');
          const r = await env.DB.prepare(`SELECT * FROM event_intake WHERE source_key IN (${placeholders})`)
            .bind(...chunk).all().catch(() => ({ results: [] }));
          rows.push(...(r.results || []));
        }
        return rows;
      }

      async function findIntakeRow(key) {
        const kind = sourceKindOfKey(key);
        if (!kind) return null;
        if (kind === 'local') {
          return await env.DB.prepare('SELECT * FROM event_intake WHERE id = ?').bind(key.slice(2)).first().catch(() => null);
        }
        return await env.DB.prepare('SELECT * FROM event_intake WHERE source_key = ?').bind(key).first().catch(() => null);
      }

      // ⚠ patch's KEYS are always written by THIS FILE, never by a request —
      // every route below builds it from a fixed object literal. Only the
      // VALUES ever come from the form, bound as parameters.
      const INTAKE_PATCH_COLUMNS = ['event_type', 'room', 'extra_json', 'checks_json', 'published_at', 'published_by',
        'local_title', 'local_event_date', 'local_end_date', 'local_event_time', 'local_end_time', 'event_date'];
      async function writeIntakePatch(id, patch) {
        const cols = Object.keys(patch).filter((k) => INTAKE_PATCH_COLUMNS.includes(k));
        if (!cols.length) return;
        const sets = cols.map((c) => `${c} = ?`).concat(["updated_at = datetime('now')", 'updated_by = ?']);
        const vals = cols.map((c) => patch[c]).concat([currentUser.username]);
        await env.DB.prepare(`UPDATE event_intake SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
      }

      const redirectTo = (queue, selected) => new Response('', { status: 302,
        headers: { Location: `/event-intake?queue=${encodeURIComponent(queue || 'inbox')}&selected=${encodeURIComponent(selected || '')}` } });

      // ── TYPE — its own instant action, deliberately separate from the
      // combined save below. Changing type changes which checklist and which
      // fields apply, so it cannot share a submit with edits to either.
      if (path === '/event-intake/type' && method === 'POST') {
        const form = await request.formData();
        const key = String(form.get('key') || '');
        const type = TYPE_KEYS.includes(String(form.get('type') || '')) ? String(form.get('type')) : null;
        const row = await findIntakeRow(key);
        if (row) await writeIntakePatch(row.id, { event_type: type });
        return redirectTo(form.get('queue'), key);
      }

      // ── SAVE — room, the type's own extra fields (unless a real record
      // already owns them), the checklist, and Publish, all in one submit.
      if (path === '/event-intake/save' && method === 'POST') {
        const form = await request.formData();
        const key = String(form.get('key') || '');
        const queue = String(form.get('queue') || 'inbox');
        const action = String(form.get('action') || 'save');
        const row = await findIntakeRow(key);
        if (row) {
          const type = row.event_type;
          const patch = {};

          const room = String(form.get('room') || '');
          patch.room = ROOMS.includes(room) ? room : '';

          if (type && !deferredFieldsSource(type, row.source_kind)) {
            const extra = {};
            for (const f of (TYPE_FIELDS[type] || [])) {
              const v = form.get(`extra_${f.key}`);
              if (v != null) extra[f.key] = String(v);
            }
            patch.extra_json = JSON.stringify(extra);
          }

          if (type) {
            const checks = {};
            for (const c of (CHECKLISTS[type] || [])) {
              if (form.get(`check_${c.key}`) === '1') checks[c.key] = true;
            }
            patch.checks_json = JSON.stringify(checks);
          }
          // ⚠ PUBLISH IS NEVER GATED ON THE CHECKLIST, THE ROOM, OR EVEN
          // HAVING A TYPE — reported directly: "not every event needs a
          // room, or the checklist... dont make any field required, you can
          // just leave it with a publish button." The checklist was never
          // what put an event on the public calendar in the first place (a
          // Google, News or gym-sourced event reaches it through its own
          // path regardless; a local one reaches it the moment it is
          // entered) — it was only ever the office's own record of its own
          // paperwork, and forcing that paperwork before Publish would work
          // conflated "on the calendar" with "the office is done with it,"
          // which is a real distinction for a rental's insurance and a
          // fiction for a plain note like "First day of school."
          if (action === 'publish') {
            patch.published_at = new Date().toISOString();
            patch.published_by = currentUser.username;
          }

          if (row.source_kind === 'local') {
            const title = String(form.get('local_title') || '').trim();
            if (title) patch.local_title = title;
            const d = String(form.get('local_event_date') || '').trim();
            if (isYmdLoose(d)) { patch.local_event_date = d; patch.event_date = d; }
            const ed = String(form.get('local_end_date') || '').trim();
            patch.local_end_date = isYmdLoose(ed) ? ed : null;
            patch.local_event_time = normalizeClock(form.get('local_event_time'));
            patch.local_end_time = normalizeClock(form.get('local_end_time'));
          }

          await writeIntakePatch(row.id, patch);
        }
        return redirectTo(queue, key);
      }

      // ── HOLD — no write at all. Matching the mock exactly: "Hold" is not a
      // status, it is just "take me back to the inbox without publishing."
      if (path === '/event-intake/hold' && method === 'POST') {
        return new Response('', { status: 302, headers: { Location: '/event-intake?queue=inbox' } });
      }

      // ── A NEW "ENTERED HERE" EVENT — the only kind with no other record.
      if (path === '/event-intake/new' && method === 'POST') {
        const form = await request.formData();
        const title = String(form.get('local_title') || '').trim();
        const date = String(form.get('local_event_date') || '').trim();
        if (!title || !isYmdLoose(date)) {
          return new Response('', { status: 302, headers: { Location: '/event-intake?msg=needsdate' } });
        }
        const endDate = String(form.get('local_end_date') || '').trim();
        const room = ROOMS.includes(String(form.get('room') || '')) ? String(form.get('room')) : '';
        const type = TYPE_KEYS.includes(String(form.get('type') || '')) ? String(form.get('type')) : null;
        const ins = await env.DB.prepare(
          `INSERT INTO event_intake (source_kind, event_type, room, local_title, local_event_date, local_end_date,
                                      local_event_time, local_end_time, event_date, updated_by)
           VALUES ('local', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(type, room, title, date, isYmdLoose(endDate) ? endDate : null,
          normalizeClock(form.get('local_event_time')), normalizeClock(form.get('local_end_time')), date, currentUser.username).run();
        return new Response('', { status: 302,
          headers: { Location: `/event-intake?queue=inbox&selected=${encodeURIComponent('l:' + ins.meta.last_row_id)}` } });
      }

      // A local row is the one kind Intake can genuinely delete — it has no
      // other home, unlike a Google event, a News post or a gym booking,
      // each of which stays exactly as real as it always was.
      if (path === '/event-intake/local/delete' && method === 'POST') {
        const form = await request.formData();
        const key = String(form.get('key') || '');
        if (sourceKindOfKey(key) === 'local') {
          await env.DB.prepare('DELETE FROM event_intake WHERE id = ?').bind(key.slice(2)).run();
        }
        return new Response('', { status: 302, headers: { Location: '/event-intake?queue=inbox' } });
      }

      // ── BULK TYPE — set a type on many events in one submit, instead of
      // one type-pill click per event. Andrew, looking at 135 unclassified
      // imports: "can we just bulk assign them?"
      //
      // ⚠ TWO SHAPES, ONE ROUTE, THE SAME WAY /event-intake/type ALREADY
      // WORKS FOR ONE. `keys` (a checked row's own checkbox) is read with
      // `getAll`, so this works whether the office ticked three rows by hand
      // or used "Select all shown" — that control just checks every box on
      // the page before the browser submits; it needs no server-side idea of
      // "everything in this queue" at all, and cannot silently apply to a row
      // that scrolled off screen or that a filter had already excluded.
      // ⚠ EVERY KEY IS VALIDATED AGAINST WHAT `mergeIntakeItems` ACTUALLY
      // PRODUCED FOR THIS REQUEST, not trusted as a bare id. A posted key with
      // no matching item (a stale page, a crafted form) is silently skipped
      // rather than handed to writeIntakePatch with no row behind it.
      if (path === '/event-intake/bulk-type' && method === 'POST') {
        const form = await request.formData();
        const queue = String(form.get('queue') || 'inbox');
        const type = TYPE_KEYS.includes(String(form.get('type') || '')) ? String(form.get('type')) : null;
        const keys = new Set(form.getAll('keys').map(String));
        if (type && keys.size) {
          const { raw } = await loadIntakeRaw();
          await syncIntakeRows(raw);
          const rows = await readIntakeRows(raw);
          const items = mergeIntakeItems(raw, rows);
          const targets = items.filter((it) => keys.has(it.key) && it.dbId != null);
          await Promise.all(targets.map((it) => writeIntakePatch(it.dbId, { event_type: type })));
        }
        return redirectTo(queue, '');
      }

      if (path === '/event-intake' && method === 'GET') {
        const { raw, gymExtra, googleOk } = await loadIntakeRaw();
        await syncIntakeRows(raw);
        const rows = await readIntakeRows(raw);
        const items = mergeIntakeItems(raw, rows);
        const askedQueue = url.searchParams.get('queue') || 'inbox';
        const queue = QUEUE_TOP.concat(TYPE_KEYS).includes(askedQueue) ? askedQueue : 'inbox';
        const list = filterQueue(items, queue);
        const askedSelected = url.searchParams.get('selected') || '';
        const selected = items.find((it) => it.key === askedSelected) || list[0] || items[0] || null;
        const counts = queueCounts(items);
        const openTotal = items.filter((it) => !isReady(it)).length;

        return html(
          await renderIntakePage({ items, list, queue, selected, counts, openTotal, gymExtra, googleOk }, currentUser, badges),
          'Event Intake — TLC Admin', INTAKE_CSS
        );
      }

      if (path === '/event-intake/new-form' && method === 'GET') {
        return html(await intakeNewEventForm(currentUser, badges), 'New event — TLC Admin');
      }

  return new Response('Not found', { status: 404 });
}

// ── EVENT INTAKE — RENDER ────────────────────────────────────────────────
// Built from `Event Intake.dc.html` (design_handoff_church_calendar's
// companion handoff). Three panes: queues, the queue's list, the selected
// item's form. Every control here is a plain link or a plain form — no
// client JS at all — trading the mock's instant checkbox clicks for a full
// reload per action. See the CLAUDE.md entry for why: this screen is new
// enough, and large enough, that the AJAX-per-field pattern the Christmas
// Market's vendor table uses (v5.30.0) was worth deferring rather than
// rebuilding from scratch under this pass's own time budget.

function intakeEsc(s) { return escapeHtml(String(s == null ? '' : s)); }

function intakeDayLabel(iso) {
  const d = String(iso || '').slice(0, 10);
  if (!d) return { dow: '', month: '', day: '' };
  const dt = new Date(d + 'T12:00:00Z');
  return {
    dow: dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toUpperCase(),
    month: dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    day: +d.slice(8, 10),
  };
}

function intakeTimeLabel(iso, allDay) {
  if (allDay) return 'All day';
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  let h = +m[1]; const ap = h < 12 ? 'am' : 'pm'; h = h % 12; if (h === 0) h = 12;
  return `${h}:${m[2]} ${ap}`;
}

function intakeQueueLink(id, label, count, active, dotColor) {
  const dot = dotColor ? `<span class="ei-dot" style="background:${intakeEsc(dotColor)}"></span>` : '';
  return `<a class="ei-qrow${active ? ' ei-qrow-on' : ''}" href="/event-intake?queue=${encodeURIComponent(id)}">
    <span class="ei-qrow-label">${dot}${intakeEsc(label)}</span>
    <span class="ei-qrow-count">${count}</span>
  </a>`;
}

// ⚠ GROUPED BY THE FOUR CORE VALUES, NOT A FLAT "By calendar" LIST ANY MORE.
// Andrew asked for this once there were eleven types to scan rather than
// four. Each of admin/values.js's own four value keys (worship / acceptance
// / education / outreach — the same ones PARTNER_SEED already ties Word of
// Life to 'education' and CFNA to 'outreach' with) gets its own labeled
// group, in the order this repo's own Core Values section states them.
// typesWithNoValue() — News, Meetings, Special event — is deliberately its
// own unlabeled group rather than forced under one of the four; see the note
// above TYPE_VALUE in admin/intake.js for why.
function intakeValueGroup(value, queue, counts) {
  const keys = typesForValue(value);
  if (!keys.length) return '';
  const rows = keys.map((t) => intakeQueueLink(t, TYPES[t].label, counts[t] || 0, queue === t, TYPES[t].color)).join('');
  return `<div class="ei-rail-group">
    <span class="ei-rail-label">${intakeEsc(VALUE_LABELS[value])}</span>
    ${rows}
  </div>`;
}

function intakeLeftRail(queue, counts) {
  const top = QUEUE_TOP.map((q) => intakeQueueLink(q, QUEUE_TITLES[q][0], counts[q] || 0, queue === q)).join('');
  const valueGroups = VALUE_ORDER.map((v) => intakeValueGroup(v, queue, counts)).join('');
  const other = typesWithNoValue().map((t) => intakeQueueLink(t, TYPES[t].label, counts[t] || 0, queue === t, TYPES[t].color)).join('');
  const sources = Object.keys(SOURCE_LABEL).map((s) =>
    `<span class="ei-src-row"><span class="ei-dot" style="background:${intakeEsc(SOURCE_COLOR[s])}"></span>${intakeEsc(SOURCE_LABEL[s])}</span>`).join('');
  return `<div class="ei-rail">
    <div class="ei-rail-group">
      <span class="ei-rail-label">Needs a decision</span>
      ${top}
    </div>
    ${valueGroups}
    <div class="ei-rail-group">
      <span class="ei-rail-label">Other</span>
      ${other}
    </div>
    <div class="ei-rail-sources">
      <span class="ei-rail-title">Sources</span>
      ${sources}
    </div>
  </div>`;
}

function intakeListRow(item, queue, selectedKey) {
  const d = intakeDayLabel(item.start);
  const on = item.key === selectedKey;
  const typeColor = item.type ? TYPES[item.type].color : '#DDE3ED';
  const ready = isReady(item);
  const open = openCountOf(item.type, item.checks);
  const openLabels = item.type
    ? checklistFor(item.type, item.checks).filter((c) => !c.done).map((c) => c.label)
    : ['Needs a type'];
  const chips = openLabels.slice(0, 3).map((l) => `<span class="ei-chip">${intakeEsc(l)}</span>`).join('');
  const statusLabel = ready ? 'Ready' : (open == null ? 'Needs a type' : `${open} open`);
  const href = `/event-intake?queue=${encodeURIComponent(queue)}&selected=${encodeURIComponent(item.key)}`;
  // ⚠ THE CHECKBOX SITS BESIDE THE ROW, NOT INSIDE IT. `.ei-row` is an anchor
  // — the office clicks anywhere on it to open the record — and a checkbox
  // nested inside an <a> is invalid HTML and would toggle selection on every
  // ordinary click instead of navigating. The two are siblings in one flex
  // line, wired to the same event by the checkbox's own `value`.
  return `<div class="ei-row-line">
    <label class="ei-row-checkwrap"><input type="checkbox" class="ei-row-check" name="keys" value="${intakeEsc(item.key)}" aria-label="Select ${intakeEsc(item.title)} for bulk assignment"></label>
    <a class="ei-row${on ? ' ei-row-on' : ''}" href="${href}" style="border-left-color:${intakeEsc(typeColor)}">
      <span class="ei-row-date"><span class="ei-row-dow">${intakeEsc(d.dow)}</span><span class="ei-row-day">${d.day}</span></span>
      <span class="ei-row-mid">
        <span class="ei-row-title">${intakeEsc(item.title)}</span>
        <span class="ei-row-meta"><span class="ei-dot" style="background:${intakeEsc(SOURCE_COLOR[item.sourceKind])}"></span>${intakeEsc(SOURCE_LABEL[item.sourceKind])} · ${intakeEsc(intakeTimeLabel(item.start, item.allDay))}${item.location ? ' · ' + intakeEsc(item.location) : ''}</span>
        ${chips ? `<span class="ei-row-chips">${chips}</span>` : ''}
      </span>
      <span class="ei-status${ready ? ' ei-status-ready' : ''}">${intakeEsc(statusLabel)}</span>
    </a>
  </div>`;
}

// ⚠ ONE FORM WRAPS THE WHOLE LIST, so every visible row's checkbox posts
// together with whichever type was chosen in the toolbar — the same
// full-reload-per-action shape the rest of this screen already uses, not a
// new AJAX mechanism. "Select all shown" is the one place this screen uses
// more than a bare `confirm()`: there is no way to link one checkbox's state
// to a dozen others without it, and it touches nothing else on the page.
// The submit itself also confirms, naming how many events are about to
// change — the one bulk action on this screen with the power to silently
// misfile 135 events at once if clicked with the wrong type selected.
function intakeMiddle(list, queue, selectedKey) {
  const [title, sub] = QUEUE_TITLES[queue] || QUEUE_TITLES.inbox;
  const rows = list.map((it) => intakeListRow(it, queue, selectedKey)).join('');
  const typeOptions = TYPE_KEYS.map((k) => `<option value="${intakeEsc(k)}">${intakeEsc(TYPES[k].label)}</option>`).join('');
  // ⚠ THE FILTER NARROWS "SHOWN", AND "SELECT ALL SHOWN" READS IT — Andrew:
  // "i could pick all richmond heights and say those are gymn rentals, all
  // worship is worship". Typing a name hides every non-matching row (client
  // side, tlcEiFilter in EI_SCRIPT below); "Select all shown" already meant
  // "every checkbox in this queue" and now genuinely means what it says,
  // ticking only the rows the filter left visible rather than the whole
  // queue underneath it.
  const filterbar = list.length ? `<div class="ei-filterbar">
      <input type="text" id="ei-filter" oninput="tlcEiFilter(this)" placeholder="Filter by name…" aria-label="Filter this list by name">
      <span class="ei-mid-sub" id="ei-filter-count"></span>
    </div>` : '';
  const toolbar = list.length ? `<div class="ei-bulkbar">
      <label class="ei-bulkall"><input type="checkbox" onclick="tlcEiSelectAllShown(this)"> Select all shown</label>
      <select name="type" required><option value="">Assign type…</option>${typeOptions}</select>
      <button type="submit" class="ei-btn ei-btn-ghost">Assign to selected</button>
    </div>` : '';
  return `<div class="ei-mid">
    <div class="ei-mid-head">
      <span class="ei-mid-title">${intakeEsc(title)}</span>
      <span class="ei-mid-sub">${intakeEsc(sub)}</span>
    </div>
    ${filterbar}
    <form method="POST" action="/event-intake/bulk-type" class="ei-mid-list"
      onsubmit="var n=this.querySelectorAll('.ei-row-check:checked').length; if(!n){alert('Select at least one event first.');return false;} return confirm('Assign this type to '+n+' event'+(n===1?'':'s')+'?');">
      <input type="hidden" name="queue" value="${intakeEsc(queue)}">
      ${toolbar}
      ${rows || '<div class="ei-empty">Nothing waiting here. That’s the goal.</div>'}
    </form>
  </div>`;
}

function intakeTypeField(f, item, deferred) {
  const val = deferred ? '' : (item.extra[f.key] || '');
  if (deferred) return '';
  const name = `extra_${f.key}`;
  const mark = f.required ? ' *' : '';
  let control;
  if (f.kind === 'select') {
    control = `<select name="${name}"><option value="">—</option>${(f.options || [])
      .map((o) => `<option value="${intakeEsc(o)}"${o === val ? ' selected' : ''}>${intakeEsc(o)}</option>`).join('')}</select>`;
  } else if (f.kind === 'area') {
    control = `<textarea name="${name}" rows="3" placeholder="${intakeEsc(f.hint || '')}">${intakeEsc(val)}</textarea>`;
  } else {
    control = `<input type="text" name="${name}" value="${intakeEsc(val)}" placeholder="${intakeEsc(f.hint || '')}">`;
  }
  return `<label class="ei-field"><span class="ei-field-label">${intakeEsc(f.label)}${mark}</span>${control}</label>`;
}

// A deferred field set is READ-ONLY display pulled from the real record —
// see deferredFieldsSource() in admin/intake.js for exactly when.
function intakeDeferredPanel(item, gymExtra) {
  const src = deferredFieldsSource(item.type, item.sourceKind);
  if (!src) return '';
  if (src === 'gym') {
    const g = gymExtra.get(item.key) || {};
    return `<div class="ei-deferred">
      <p class="ei-deferred-note">Managed on the Gym Rentals screen, not here.</p>
      <div class="ei-deferred-row"><b>Renter or group</b> ${intakeEsc(g.renter || '—')}</div>
      <div class="ei-deferred-row"><b>Contact</b> ${intakeEsc(g.contact || '—')}</div>
      ${g.setup ? `<div class="ei-deferred-row"><b>Notes</b> ${intakeEsc(g.setup)}</div>` : ''}
      <a class="ei-deferred-link" href="/gym-rentals">Manage in Gym Rentals →</a>
    </div>`;
  }
  // src === 'news'
  const newsId = item.key.slice(2);
  return `<div class="ei-deferred">
    <p class="ei-deferred-note">Owned by the News &amp; Events post — edit the words there, not here.</p>
    ${item.description ? `<div class="ei-deferred-row">${intakeEsc(item.description).slice(0, 240)}</div>` : ''}
    <a class="ei-deferred-link" href="/newsitems/edit/${intakeEsc(newsId)}">Edit in News &amp; Events →</a>
  </div>`;
}

function intakeChecklistPanel(item) {
  if (!item.type) {
    return `<p class="ei-note">Pick a type below to see what this needs before it publishes.</p>`;
  }
  const list = checklistFor(item.type, item.checks);
  const doneCount = list.filter((c) => c.done).length;
  // ⚠ THE ✓ IS ALWAYS IN THE MARKUP NOW, NOT CONDITIONAL ON `c.done`. Its
  // color is what CSS toggles (transparent unticked, white ticked, via the
  // :checked rule above) — the same mechanism that makes the fill and border
  // update live. A ✓ present in the DOM but invisible is what lets a click
  // reveal it with no re-render; one only ever added server-side never would.
  const rows = list.map((c) => `<label class="ei-check${c.done ? ' ei-check-done' : ''}">
    <input type="checkbox" name="check_${intakeEsc(c.key)}" value="1"${c.done ? ' checked' : ''}>
    <span class="ei-check-box" aria-hidden="true">✓</span>
    <span class="ei-check-text"><span>${intakeEsc(c.label)}</span><span class="ei-check-who">${intakeEsc(c.who)}</span></span>
  </label>`).join('');
  return `<div class="ei-checklist">
    <div class="ei-checklist-head"><span class="ei-rail-label">Before it publishes</span><span class="ei-mid-sub">${doneCount} of ${list.length}</span></div>
    ${rows}
  </div>`;
}

function intakeDetail(item, gymExtra, queue) {
  if (!item) {
    return `<div class="ei-detail ei-detail-empty">
      <p>Nothing in this queue. Pick another one on the left, or
      <a href="/event-intake/new-form">enter a new event</a> directly.</p>
    </div>`;
  }
  const ready = isReady(item);
  const open = openCountOf(item.type, item.checks);
  const d = intakeDayLabel(item.start);
  const kicker = `${intakeEsc(SOURCE_LABEL[item.sourceKind])} · ${intakeEsc(d.month)} ${d.day}`;
  // ⚠ The hidden "queue" field carries the list the office is BROWSING, not
  // item.type — a Save or a Type change from inside "Needs a decision" must
  // land back there, not jump to whatever the item's type happens to be
  // (which is often the very thing that just changed).
  const typePills = TYPE_KEYS.map((k) => {
    const on = item.type === k;
    return `<form method="POST" action="/event-intake/type" class="ei-pillform">
      <input type="hidden" name="key" value="${intakeEsc(item.key)}">
      <input type="hidden" name="type" value="${intakeEsc(k)}">
      <input type="hidden" name="queue" value="${intakeEsc(queue)}">
      <button type="submit" class="ei-pill${on ? ' ei-pill-on' : ''}" style="${on ? `background:${intakeEsc(TYPES[k].color)};border-color:${intakeEsc(TYPES[k].color)};` : ''}">
        <span class="ei-pill-dot" style="background:${intakeEsc(TYPES[k].color)}"></span>${intakeEsc(TYPES[k].label)}
      </button>
    </form>`;
  }).join('');

  const deferred = deferredFieldsSource(item.type, item.sourceKind);
  const typeFields = item.type ? (TYPE_FIELDS[item.type] || []).map((f) => intakeTypeField(f, item, !!deferred)).join('') : '';

  const localFields = item.sourceKind === 'local' ? `
    <div class="ei-basegroup">
      <span class="ei-rail-label">Entered here</span>
      <label class="ei-field"><span class="ei-field-label">Title *</span><input type="text" name="local_title" value="${intakeEsc(item.title)}"></label>
      <div class="ei-field-row">
        <label class="ei-field"><span class="ei-field-label">Date *</span><input type="date" name="local_event_date" value="${intakeEsc(String(item.start).slice(0, 10))}"></label>
        <label class="ei-field"><span class="ei-field-label">Through</span><input type="date" name="local_end_date" value="${intakeEsc(String(item.end || '').slice(0, 10))}"></label>
      </div>
      <div class="ei-field-row">
        <label class="ei-field"><span class="ei-field-label">Starts at</span><input type="time" name="local_event_time" value="${item.allDay ? '' : intakeEsc(String(item.start).slice(11, 16))}"></label>
        <label class="ei-field"><span class="ei-field-label">Ends at</span><input type="time" name="local_end_time" value="${item.allDay ? '' : intakeEsc(String(item.end || '').slice(11, 16))}"></label>
      </div>
    </div>` : '';

  return `<div class="ei-detail">
    <form method="POST" action="/event-intake/save" class="ei-form">
      <input type="hidden" name="key" value="${intakeEsc(item.key)}">
      <input type="hidden" name="queue" value="${intakeEsc(queue)}">
      <div class="ei-detail-head">
        <div class="ei-detail-headrow">
          <div>
            <span class="ei-kicker">${kicker}</span>
            <span class="ei-detail-title">${intakeEsc(item.title)}</span>
          </div>
          <span class="ei-status${ready ? ' ei-status-ready' : ''}">${ready ? 'Ready' : (open == null ? 'Needs a type' : `${open} open`)}</span>
        </div>
      </div>
      <div class="ei-detail-body">
        ${/* ⚠ THE PILL ROW MOVED OUT OF THE FIXED HEAD, DELIBERATELY. Eleven
             types wrap across three lines there, and that alone — not the
             checklist's own old position — was most of what pushed "Room" and
             "Before it publishes" out of view: the head sits above the
             scrolling body and is never scrolled away, so its own height is
             what has to shrink. Reported as wanting the info box "moved up to
             the top so I can see it for the event." Reassigning a type is
             still one click; it now costs one scroll less to see what a
             correctly-typed event needs, which is the more common visit. */ ''}
        ${localFields}
        <div class="ei-basegroup">
          <span class="ei-rail-label">Every event</span>
          <label class="ei-field"><span class="ei-field-label">Room</span>
            <select name="room"><option value="">—</option>${ROOMS.map((r) => `<option value="${intakeEsc(r)}"${r === item.room ? ' selected' : ''}>${intakeEsc(r)}</option>`).join('')}</select>
          </label>
        </div>
        ${intakeChecklistPanel(item)}
        <div class="ei-basegroup">
          <span class="ei-rail-label">Type</span>
          <div class="ei-pillrow">${typePills}</div>
        </div>
        ${item.type ? `<div class="ei-basegroup">
          <span class="ei-rail-label" style="color:${intakeEsc(TYPES[item.type].color)}">${intakeEsc(TYPES[item.type].label)} only</span>
          <p class="ei-note">${intakeEsc(TYPES[item.type].note)}</p>
          ${deferred ? intakeDeferredPanel(item, gymExtra) : typeFields}
        </div>` : ''}
        <div class="ei-actions">
          <button type="submit" name="action" value="save" class="ei-btn ei-btn-ghost">Save</button>
          <button type="submit" name="action" value="publish" class="ei-btn ei-btn-primary">Publish</button>
        </div>
      </div>
    </form>
    <form method="POST" action="/event-intake/hold" class="ei-holdform"><button type="submit" class="ei-link-btn">← Back to Needs a decision</button></form>
    ${item.sourceKind === 'local' ? `<form method="POST" action="/event-intake/local/delete" class="ei-holdform" onsubmit="return confirm('Delete this event? This cannot be undone.')">
      <input type="hidden" name="key" value="${intakeEsc(item.key)}"><button type="submit" class="ei-link-btn ei-link-danger">Delete this event</button></form>` : ''}
    <p class="ei-footnote">Google stays the office’s day-to-day tool — imported events land here with their room and time, but nothing here is required. The room, the type and the checklist are all optional; a plain note needs none of them, and Publish works with the page exactly as it is.</p>
  </div>`;
}

// ⚠ THE ONE PLACE THIS SCREEN CARRIES A REAL <script>, alongside the existing
// inline "Select all shown" handler it replaces — filtering a list by name
// and having "shown" mean what it says has no selector-only expression.
// Delegated function names rather than a bigger inline expression, so the
// two call sites (the filter input, the select-all checkbox) stay readable.
const EI_SCRIPT = `<script>
function tlcEiFilter(input) {
  var q = input.value.trim().toLowerCase();
  var lines = document.querySelectorAll('.ei-row-line');
  var shown = 0;
  lines.forEach(function (line) {
    var t = line.querySelector('.ei-row-title');
    var match = !q || (t && t.textContent.toLowerCase().indexOf(q) !== -1);
    line.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  var count = document.getElementById('ei-filter-count');
  if (count) count.textContent = q ? (shown + ' of ' + lines.length + ' shown') : '';
}
function tlcEiSelectAllShown(box) {
  document.querySelectorAll('.ei-row-line').forEach(function (line) {
    if (line.style.display === 'none') return;
    var c = line.querySelector('.ei-row-check');
    if (c) c.checked = box.checked;
  });
}
</script>`;

async function renderIntakePage(ctx, currentUser, badges) {
  const { list, queue, selected, counts, openTotal, gymExtra, googleOk } = ctx;
  const warn = googleOk === false ? `<div class="ei-warn">Google Calendar could not be read just now — this list is News &amp; Events and gym rentals only, until the next visit.</div>` : '';
  return `${sidebarShell('intake', currentUser, '', badges)}
<div class="ei-wrap">
  <div class="ei-topbar">
    <div class="ei-brand"><span class="ei-brand-name">Timothy’s Calendar</span><span class="ei-brand-sub">Office intake</span></div>
    <div class="ei-topbar-r">
      <span class="ei-open-count">${openTotal} item${openTotal === 1 ? '' : 's'} still need${openTotal === 1 ? 's' : ''} something</span>
      <a class="ei-btn ei-btn-gold" href="/event-intake/new-form">+ New event</a>
    </div>
  </div>
  ${warn}
  <div class="ei-cols">
    ${intakeLeftRail(queue, counts)}
    ${intakeMiddle(list, queue, selected && selected.key)}
    ${intakeDetail(selected, gymExtra, queue)}
  </div>
</div>
${EI_SCRIPT}`;
}

async function intakeNewEventForm(currentUser, badges) {
  const rooms = ROOMS.map((r) => `<option value="${intakeEsc(r)}">${intakeEsc(r)}</option>`).join('');
  const types = TYPE_KEYS.map((k) => `<option value="${intakeEsc(k)}">${intakeEsc(TYPES[k].label)}</option>`).join('');
  return `${sidebarShell('intake', currentUser, `<a href="/event-intake">← Event Intake</a>`, badges)}
<div class="tlc-wrap">
  <div class="card" style="max-width:560px;">
    <div class="card-title">New event</div>
    <p style="font-size:13px;color:var(--gray);margin-top:-6px;">For a booking with no Google event and no News &amp; Events post behind it — a private wedding, a one-off outside group. It reaches the calendar directly.</p>
    <form method="POST" action="/event-intake/new">
      <div class="form-group"><label>Title *</label><input type="text" name="local_title" required></div>
      <div class="form-group"><label>Date *</label><input type="date" name="local_event_date" required></div>
      <div class="form-group"><label>Through (optional, for a run of days)</label><input type="date" name="local_end_date"></div>
      <div class="form-group"><label>Starts at</label><input type="time" name="local_event_time"></div>
      <div class="form-group"><label>Ends at</label><input type="time" name="local_end_time"></div>
      <div class="form-group"><label>Room</label><select name="room"><option value="">—</option>${rooms}</select></div>
      <div class="form-group"><label>Type</label><select name="type"><option value="">Decide later</option>${types}</select></div>
      <button type="submit" class="btn btn-primary">Add event</button>
      <a href="/event-intake" class="btn">Cancel</a>
    </form>
  </div>
</div>`;
}
