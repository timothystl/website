// The generalized Events section — /events, /events/new, /events/:id, and
// the public POST /api/events/register — run with:
//   node --experimental-loader ./test/html-loader.mjs test/events-admin.test.mjs
//
// Same harness shape as test/admin-redesign.test.mjs: the real Worker against
// a real SQLite database behind a D1-shaped shim, requested the way a
// browser (or a public visitor's form POST) would.
import { DatabaseSync } from 'node:sqlite';
import worker from '../tlc-admin-worker.js';
import { ALL_PERMISSIONS } from '../admin/auth.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const has = (hay, needle, msg) => ok(String(hay).includes(needle), `${msg} — missing ${JSON.stringify(needle)}`);
const lacks = (hay, needle, msg) => ok(!String(hay).includes(needle), `${msg} — unexpectedly contains ${JSON.stringify(needle)}`);
const group = (n) => console.log('\n' + n);

function d1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { try { return db.prepare(sql).get(...args) ?? null; } catch (e) { throw e; } },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    exec: async (sql) => { db.exec(sql); },
  };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
// The Volunteers tab and the push-notification fire-and-forgets both call
// fetch(); stubbed the same honest-empty way the real Serve outage path is —
// a bare 200/{} is exactly the "answered with something this screen could
// not read" case, which is the behavior worth exercising by NOT special
// casing it.
globalThis.fetch = async () => new Response('{}', { status: 200 });

async function boot() {
  const db = new DatabaseSync(':memory:');
  const env = { DB: d1(db), IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} }, BREVO_API_KEY: 'test' };
  await call(env, '/login');
  return { db, env };
}

async function call(env, path, { cookie = '', method = 'GET', form = null } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', 'https://admin.timothystl.org');
  let body;
  if (form) { body = new URLSearchParams(form).toString(); headers.set('content-type', 'application/x-www-form-urlencoded'); }
  const req = new Request('https://admin.timothystl.org' + path, { method, headers, body });
  return worker.fetch(req, env, ctx);
}

// Every caller here is an authenticated admin-screen POST, which the CSRF
// Origin gate expects to carry the ADMIN origin — unlike the public
// registration route, tested separately below with its own headers.
async function callForm(env, path, { cookie = '', formData } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  headers.set('origin', 'https://admin.timothystl.org');
  const req = new Request('https://admin.timothystl.org' + path, { method: 'POST', headers, body: formData });
  return worker.fetch(req, env, ctx);
}

let tokenSeq = 0;
function signIn(db, permissions = ALL_PERMISSIONS, username = 'dinger') {
  tokenSeq += 1;
  const token = String(tokenSeq).padStart(2, '0').repeat(32).slice(0, 64);
  db.prepare('INSERT INTO users (username, password_hash, permissions, created_at, active) VALUES (?,?,?,?,1)')
    .run(username, 'pbkdf2:1:x:y', JSON.stringify(permissions), new Date().toISOString());
  const uid = db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  db.prepare('INSERT INTO sessions (token, user_id, username, permissions, expires_at, created_at) VALUES (?,?,?,?,?,?)')
    .run(token, uid, username, JSON.stringify(permissions), new Date(Date.now() + 864e5).toISOString(), new Date().toISOString());
  return { cookie: `tlc_session=${token}` };
}

// ⚠ Toggle fields (has_registration etc.) post a HIDDEN 0 ahead of their
// checkbox (renderField's 'toggle' kind, admin/ui.js) — a real browser
// submits BOTH values, in that order, whenever the box is checked. A test
// that instead sends one bare '1' never exercises the real pairing at all,
// which is exactly the shape of bug this repo's toggle fields have always
// needed guarding against (form.get(name) returns the first value — the
// hidden 0 — regardless of the checkbox). Build the body the way a real
// form actually would.
const TOGGLE_FIELDS = ['has_registration', 'has_payment', 'has_volunteers', 'has_photos'];

async function createEventViaForm(env, cookie, over = {}) {
  const plain = {
    name: 'Vacation Bible School', date_label: 'June 9–13', hours_label: '9am–noon',
    coordinator_email: 'vbs@timothystl.org', clone_from: '',
  };
  const toggles = Object.fromEntries(TOGGLE_FIELDS.map((k) => [k, '1'])); // every capability on by default
  for (const [k, v] of Object.entries(over)) (TOGGLE_FIELDS.includes(k) ? toggles : plain)[k] = v;

  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(plain)) p.append(k, v);
  for (const [k, v] of Object.entries(toggles)) { p.append(k, '0'); if (v === '1') p.append(k, '1'); }

  const headers = new Headers({ cookie, origin: 'https://admin.timothystl.org', 'content-type': 'application/x-www-form-urlencoded' });
  const res = await worker.fetch(new Request('https://admin.timothystl.org/events/new', { method: 'POST', headers, body: p.toString() }), env, ctx);
  eq(res.status, 302, 'creating an event redirects');
  const loc = res.headers.get('Location') || '';
  const idMatch = loc.match(/\/events\/([^/?]+)/);
  return idMatch ? idMatch[1] : '';
}

// ── Phase B — the list ───────────────────────────────────────────────────────
group('the /events list');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const res = await call(env, '/events', { cookie });
  eq(res.status, 200, 'events_manage alone can open the list');
  const body = await res.text();
  has(body, 'Christmas Market', 'the migrated market shows up as a real row');
  has(body, '+ New event', 'the create action is on the page');

  // events_manage alone must not be able to see the market's own vendor list —
  // that is still market_manage's, unchanged by any of this.
  const marketRes = await call(env, '/market', { cookie });
  eq(marketRes.status, 403, 'events_manage does not also open the market’s coordinator screen');

  const denied = await call(env, '/events', { cookie: signIn(db, [], 'nobody').cookie });
  eq(denied.status, 403, 'holding nothing at all is refused');

  // Signed OUT entirely renders the sign-in page (200), same as any other
  // admin screen — not a 403, and not the list.
  const signedOut = await call(env, '/events', {});
  has(await signedOut.text(), 'Sign In', 'a signed-out visitor sees the sign-in page, not the list');
}

// ── Phase C — creating one ────────────────────────────────────────────────────
group('creating a new event');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);

  const formRes = await call(env, '/events/new', { cookie });
  eq(formRes.status, 200, 'the new-event form opens');
  const formHtml = await formRes.text();
  has(formHtml, 'Or start a new page from', 'the clone-from question is on the form');
  has(formHtml, 'Create a new page', 'the "its page" picker defaults to creating a new page');

  has(await (await call(env, '/events/new', { cookie: '' })).text(), 'Sign In',
    'signed out entirely, /events/new is the sign-in page, not the form');

  const id = await createEventViaForm(env, cookie);
  ok(!!id, 'an id came back');
  eq(id, 'vacation-bible-school', 'the id is slugified from the name');

  const row = db.prepare('SELECT * FROM site_events WHERE id = ?').get(id);
  ok(!!row, 'the event row exists');
  eq(row.coordinator_permission, `event_${id}_manage`, 'a dynamic coordinator permission was generated');
  eq(row.status, 'draft', 'a new event starts as a draft');
  eq(Number(row.has_registration), 1, 'has_registration was recorded');
  eq(Number(row.has_payment), 1, 'has_payment was recorded');
  eq(row.volunteer_slug, id, 'the volunteer slug defaults to the event id');

  ok(!!row.page_landing_id, 'a page was created for an event that registers and takes payment');
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(row.page_landing_id);
  ok(!!page, 'the page row is real');
  eq(page.status, 'draft', 'a brand-new page is never live by accident');
  const blocks = JSON.parse(page.blocks || '[]');
  ok(blocks.some((b) => b.type === 'registration' && b.eventId === id), 'the page carries a registration block pointed at the new event');

  // A second event, with no registration and no payment, gets no page.
  const noFormId = await createEventViaForm(env, cookie, { name: 'Prayer Chain', has_registration: '0', has_payment: '0', has_volunteers: '0', has_photos: '0' });
  const noFormRow = db.prepare('SELECT * FROM site_events WHERE id = ?').get(noFormId);
  eq(noFormRow.page_landing_id, null, 'an event with neither registration nor payment gets no page');

  // The audit trail exists.
  const audit = db.prepare("SELECT * FROM audit_log WHERE entity_type='event' AND entity_id=? ORDER BY id DESC LIMIT 1").get(id);
  ok(!!audit, 'creating an event is audited');
}

group('cloning a page as the starting point');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const firstId = await createEventViaForm(env, cookie, { name: 'Egg Hunt' });
  const firstRow = db.prepare('SELECT * FROM site_events WHERE id = ?').get(firstId);

  const cloneId = await createEventViaForm(env, cookie, { name: 'Fall Festival', clone_from: firstRow.page_registration_id });
  const cloneRow = db.prepare('SELECT * FROM site_events WHERE id = ?').get(cloneId);
  const clonePage = db.prepare('SELECT * FROM pages WHERE id = ?').get(cloneRow.page_landing_id);
  ok(clonePage.id !== firstRow.page_landing_id, 'the clone is its own new page, not a shared one');
  const cloneBlocks = JSON.parse(clonePage.blocks || '[]');
  const regBlock = cloneBlocks.find((b) => b.type === 'registration');
  ok(!!regBlock, 'the cloned page still has a registration block');
  eq(regBlock.eventId, cloneId, 'the cloned registration block was repointed at the NEW event, not the source');
}

// A synthetic page not already claimed by the site's own seed — for the
// cases that need a page nobody has any prior stake in, distinct from the
// VBS scenario below, which deliberately uses the REAL seeded `/vbs` row
// (`admin/site-pages.js`), not a stand-in, since that row existing already
// is the exact situation being fixed.
function insertTestPage(db, { id, slug, title = 'A Page', locked = 0, externalUrl = null } = {}) {
  const blocks = JSON.stringify([{ id: 'hero-1', type: 'hero', title }]);
  db.prepare(
    "INSERT INTO pages (id, title, menu_label, slug, parent_id, sort, template, status, in_menu, locked, external_url, seo_description, blocks, published_blocks, updated_at, updated_by) " +
    "VALUES (?, ?, ?, ?, NULL, 999, 'standard', 'draft', 0, ?, ?, '', ?, NULL, ?, ?)"
  ).run(id, title, title, slug, locked, externalUrl, blocks, new Date().toISOString(), 'test');
  return id;
}

group('adopting an existing page instead of creating a second one');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);

  // `/vbs` is not a stand-in — it is the real seeded youth-family page
  // (admin/site-pages.js) already sitting in the table before the event
  // ever exists, the exact shape VBS is in on the live site.
  const before = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  const beforeVbs = db.prepare('SELECT blocks, published_blocks FROM pages WHERE id = ?').get('vbs');
  ok(!!beforeVbs, 'the real /vbs page is already seeded, before this event is created');

  const id = await createEventViaForm(env, cookie, { name: 'Vacation Bible School', existing_page_id: 'vbs' });
  const after = db.prepare('SELECT COUNT(*) AS n FROM pages').get().n;
  eq(after, before, 'no second page was created — the row count is unchanged');

  const row = db.prepare('SELECT * FROM site_events WHERE id = ?').get(id);
  eq(row.page_landing_id, 'vbs', 'the event links to the REAL existing page, not a fresh id');
  eq(row.page_registration_id, 'vbs', 'both page fields point at the same real page');

  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get('vbs');
  const blocks = JSON.parse(page.blocks || '[]');
  const beforeBlocks = JSON.parse(beforeVbs.blocks || '[]');
  for (const b of beforeBlocks) ok(blocks.some((x) => x.id === b.id), `the page's existing block "${b.type}" is untouched`);
  const reg = blocks.find((b) => b.type === 'registration');
  ok(!!reg, 'a registration block was ADDED, not the page replaced');
  eq(reg.eventId, id, 'the added registration block points at the new event');
  eq(page.published_blocks, beforeVbs.published_blocks, 'the LIVE published copy is untouched — the sign-up form is a draft edit, same as any other page change');

  // Adopting a page that takes no registration links it with no block added.
  const noRegId = await createEventViaForm(env, cookie, {
    name: 'Family Ministry Night', existing_page_id: 'family', has_registration: '0', has_payment: '0',
  });
  const familyBlocks = JSON.parse(db.prepare('SELECT blocks FROM pages WHERE id = ?').get('family').blocks || '[]');
  ok(!familyBlocks.some((b) => b.type === 'registration'), 'no registration block added when the event does not take sign-ups');
  eq(db.prepare('SELECT page_landing_id FROM site_events WHERE id = ?').get(noRegId).page_landing_id, 'family',
    'the page is still linked even though the event takes no registration');
}

group('connecting an already-created event to an existing page, and disconnecting');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);

  // Created before anyone thought to pick /vbs off the list — got its own,
  // wrong, throwaway page, exactly the "two pages" report this fix answers.
  const id = await createEventViaForm(env, cookie, { name: 'VBS (duplicate)' });
  const strayPageId = db.prepare('SELECT page_landing_id FROM site_events WHERE id = ?').get(id).page_landing_id;
  ok(!!strayPageId, 'the event got its own page when it was first created');

  const denied = await callForm(env, `/events/${id}/connect-page`, { cookie: signIn(db, [], 'nobody').cookie, formData: new URLSearchParams({ page_id: 'vbs' }) });
  eq(denied.status, 403, 'connecting is refused to someone with neither the coordinator key nor pages_edit');

  const connectRes = await callForm(env, `/events/${id}/connect-page`, { cookie, formData: new URLSearchParams({ page_id: 'vbs' }) });
  eq(connectRes.status, 302, 'connecting redirects back to the tab');
  const linked = db.prepare('SELECT page_landing_id, page_registration_id FROM site_events WHERE id = ?').get(id);
  eq(linked.page_landing_id, 'vbs', 'the event now links to the real page');
  eq(linked.page_registration_id, 'vbs', 'both fields moved together');
  ok(!!db.prepare('SELECT id FROM pages WHERE id = ?').get(strayPageId), 'the stray page from the original mistake still exists — connecting never deletes anything');

  const pageTab = await call(env, `/events/${id}?tab=page`, { cookie });
  const pageTabBody = await pageTab.text();
  has(pageTabBody, '/vbs', 'the connected page shows on the Page & copy tab');
  lacks(pageTabBody, 'value="vbs"', 'the now-connected page is not offered again as a "connect a different page" candidate');

  const disconnectRes = await callForm(env, `/events/${id}/disconnect-page`, { cookie, formData: new URLSearchParams() });
  eq(disconnectRes.status, 302, 'disconnecting redirects back to the tab');
  const unlinked = db.prepare('SELECT page_landing_id, page_registration_id FROM site_events WHERE id = ?').get(id);
  eq(unlinked.page_landing_id, null, 'disconnected — the event no longer claims a page');
  ok(!!db.prepare('SELECT id FROM pages WHERE id = ?').get('vbs'), 'disconnecting never deletes the page itself');
}

group('a page already claimed by another live event is not offered twice');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  insertTestPage(db, { id: 'test-locked', slug: '/test-locked', title: 'Locked Page', locked: 1 });
  insertTestPage(db, { id: 'test-outbound', slug: '/test-outbound', title: 'Outbound Page', externalUrl: 'https://example.org' });
  insertTestPage(db, { id: 'test-unclaimed', slug: '/test-unclaimed', title: 'Not Yet an Event' });

  const newForm = await (await call(env, '/events/new', { cookie })).text();
  has(newForm, 'Not Yet an Event', 'an unclaimed, unlocked, non-outbound page is offered');
  lacks(newForm, 'Locked Page', 'a locked page is never offered');
  lacks(newForm, 'Outbound Page', 'an outbound-redirect page is never offered');

  await createEventViaForm(env, cookie, { name: 'Claims It First', existing_page_id: 'test-unclaimed' });
  const secondForm = await (await call(env, '/events/new', { cookie })).text();
  // Scoped to the "Its page" select specifically — the SAME page is still
  // correctly offered as a clone SOURCE ("Or start a new page from"), a
  // different field with a different job, so a bare page-wide check would
  // false-fail on that legitimate second appearance.
  const existingPagePicker = secondForm.slice(secondForm.indexOf('name="existing_page_id"'), secondForm.indexOf('</select>', secondForm.indexOf('name="existing_page_id"')));
  lacks(existingPagePicker, 'value="test-unclaimed"', 'once claimed by a live event, the page drops off the "Its page" list for a second one');
}

// ── Phase D — one event's own screen ─────────────────────────────────────────
group('an event’s own tabbed screen');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const id = await createEventViaForm(env, cookie);

  const screen = await call(env, `/events/${id}`, { cookie });
  eq(screen.status, 200, 'the event screen opens');
  const body = await screen.text();
  has(body, 'Registrations', 'the Registrations tab is offered');
  has(body, 'Page &amp; copy', 'the Page & copy tab is offered');
  has(body, 'Money &amp; dates', 'the Money & dates tab is offered');
  has(body, 'Volunteers', 'the Volunteers tab is offered — has_volunteers was on');
  has(body, 'Photos', 'the Photos tab is offered — has_photos was on');

  // A coordinator holding ONLY this one event's dynamic key gets in too.
  const coordCookie = signIn(db, [`event_${id}_manage`], 'vbs-coordinator').cookie;
  eq((await call(env, `/events/${id}`, { cookie: coordCookie })).status, 200,
    'the event’s own dynamic coordinator key opens its screen');

  // A DIFFERENT event's coordinator does not get in.
  const otherId = await createEventViaForm(env, cookie, { name: 'Fish Fry', has_volunteers: '0', has_photos: '0' });
  const otherCoordCookie = signIn(db, [`event_${otherId}_manage`], 'fishfry-coordinator').cookie;
  eq((await call(env, `/events/${id}`, { cookie: otherCoordCookie })).status, 403,
    'another event’s coordinator key does not open THIS event’s screen');

  // A tab this event has no capability for is simply absent.
  const otherScreen = await call(env, `/events/${otherId}`, { cookie });
  const otherBody = await otherScreen.text();
  lacks(otherBody, '>Volunteers<', 'no Volunteers tab on an event with has_volunteers off');
  lacks(otherBody, '>Photos<', 'no Photos tab on an event with has_photos off');
}

group('money & dates');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const id = await createEventViaForm(env, cookie);

  const detailsRes = await callForm(env, `/events/${id}/settings`, {
    cookie,
    formData: new URLSearchParams({
      name: 'VBS 2027', status: 'live', date_label: 'June 14–18', hours_label: '9–12',
      coordinator_email: 'vbs2@timothystl.org', registration_open: '1', registration_cap: '40', waitlist_enabled: '1',
      volunteer_slug: 'vbs2027', photo_folder: 'images/events/vbs2027/',
    }),
  });
  eq(detailsRes.status, 302, 'saving details redirects');
  let row = db.prepare('SELECT * FROM site_events WHERE id = ?').get(id);
  eq(row.name, 'VBS 2027', 'name saved');
  eq(row.status, 'live', 'status saved');
  eq(Number(row.registration_cap), 40, 'capacity saved');
  eq(Number(row.waitlist_enabled), 1, 'waitlist toggle saved');
  eq(row.volunteer_slug, 'vbs2027', 'a changed volunteer slug saved');

  const moneyRes = await callForm(env, `/events/${id}/money`, {
    cookie,
    formData: new URLSearchParams({ fee_amount: '15', max_qty: '3', fee_percent: '2.9', fee_fixed: '0.30', fund_id: 'FUND9', payment_provider: 'square' }),
  });
  eq(moneyRes.status, 302, 'saving the money panel redirects');
  row = db.prepare('SELECT * FROM site_events WHERE id = ?').get(id);
  eq(Number(row.fee_amount), 15, 'base fee saved');
  eq(row.fund_id, 'FUND9', 'fund id saved');
  eq(row.payment_provider, 'square', 'payment provider saved');

  // Somebody holding another event's key entirely cannot touch this one.
  const otherId = await createEventViaForm(env, cookie, { name: 'Choir Retreat' });
  const outsider = signIn(db, [`event_${otherId}_manage`], 'outsider').cookie;
  const blocked = await callForm(env, `/events/${id}/settings`, { cookie: outsider, formData: new URLSearchParams({ name: 'HACKED' }) });
  eq(blocked.status, 403, 'a different event’s coordinator cannot POST to this one’s settings');
  eq(db.prepare('SELECT name FROM site_events WHERE id = ?').get(id).name, 'VBS 2027', 'and the name really did not change');
}

group('archive and unarchive');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const id = await createEventViaForm(env, cookie);
  await callForm(env, `/events/${id}/archive`, { cookie, formData: new URLSearchParams({}) });
  let row = db.prepare('SELECT * FROM site_events WHERE id = ?').get(id);
  eq(row.status, 'archived', 'archiving sets status');
  ok(!!row.archived_at, 'and stamps when');
  const listAfter = await call(env, '/events', { cookie });
  has(await listAfter.text(), 'Archived', 'the archived pill shows on the list');

  await callForm(env, `/events/${id}/unarchive`, { cookie, formData: new URLSearchParams({}) });
  row = db.prepare('SELECT * FROM site_events WHERE id = ?').get(id);
  eq(row.status, 'draft', 'unarchiving returns it to draft');
  eq(row.archived_at, null, 'and clears the archived stamp');
}

// ── Phase E — the registration form's own fields ─────────────────────────────
group('the field editor');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const id = await createEventViaForm(env, cookie);

  const add1 = await callForm(env, `/events/${id}/fields`, { cookie, formData: new URLSearchParams({ label: 'Child’s name', kind: 'text', required: '1' }) });
  eq(add1.status, 302, 'adding a field redirects');
  const add2 = await callForm(env, `/events/${id}/fields`, { cookie, formData: new URLSearchParams({ label: 'Allergies', kind: 'textarea', sensitive: '1' }) });
  eq(add2.status, 302, 'adding a second field redirects');

  let fields = db.prepare('SELECT * FROM site_event_fields WHERE event_id = ? ORDER BY sort_order').all(id);
  eq(fields.length, 2, 'both fields exist');
  eq(fields[0].key, 'child_s_name', 'the first field’s key is slugified from its label');
  eq(Number(fields[0].required), 1, 'required carried through');
  eq(Number(fields[1].sensitive), 1, 'sensitive carried through');
  eq(Number(fields[1].required), 0, 'an unchecked toggle really is 0, not left over from the first field');

  // Reorder: swap them.
  const reorder = await callForm(env, `/events/${id}/fields/reorder`, {
    cookie, formData: new URLSearchParams({ order: JSON.stringify([fields[1].id, fields[0].id]) }),
  });
  eq(reorder.status, 302, 'reordering redirects');
  fields = db.prepare('SELECT * FROM site_event_fields WHERE event_id = ? ORDER BY sort_order').all(id);
  eq(fields[0].label, 'Allergies', 'the order actually flipped');

  const deleteRes = await callForm(env, `/events/${id}/fields/delete`, { cookie, formData: new URLSearchParams({ id: String(fields[0].id) }) });
  eq(deleteRes.status, 302, 'deleting a field redirects');
  eq(db.prepare('SELECT COUNT(*) AS n FROM site_event_fields WHERE event_id = ?').get(id).n, 1, 'one field remains');
}

// ── Phase E — the public path ─────────────────────────────────────────────────
group('POST /api/events/register');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const id = await createEventViaForm(env, cookie, { has_payment: '0' });
  await callForm(env, `/events/${id}/fields`, { cookie, formData: new URLSearchParams({ label: 'Child’s name', kind: 'text', required: '1' }) });
  await callForm(env, `/events/${id}/fields`, { cookie, formData: new URLSearchParams({ label: 'Parent email', kind: 'email', required: '1' }) });
  await callForm(env, `/events/${id}/fields`, { cookie, formData: new URLSearchParams({ label: 'Allergies', kind: 'textarea', sensitive: '1' }) });
  const fields = db.prepare('SELECT * FROM site_event_fields WHERE event_id = ? ORDER BY sort_order').all(id);

  const fd = new FormData();
  fd.set('event_id', id);
  fd.set(`field_${fields[0].key}`, 'Junie B.');
  fd.set(`field_${fields[1].key}`, 'parent@example.com');
  fd.set(`field_${fields[2].key}`, 'Peanuts');
  fd.set('qty', '1');
  const headers = new Headers({ origin: 'https://timothystl.org' });
  const res = await worker.fetch(new Request('https://admin.timothystl.org/api/events/register', { method: 'POST', headers, body: fd }), env, ctx);
  eq(res.status, 200, 'a well-formed sign-up is accepted');
  const json = await res.json();
  ok(json.success, 'the response says success');
  ok(!!json.id, 'an id came back');

  const reg = db.prepare('SELECT * FROM site_event_registrations WHERE id = ?').get(json.id);
  ok(!!reg, 'the row exists');
  eq(reg.contact_name, 'Junie B.', 'the first text field became the contact name');
  eq(reg.contact_email, 'parent@example.com', 'the email field became the contact email');
  const nonSensitive = JSON.parse(reg.fields_json || '{}');
  const sensitive = JSON.parse(reg.sensitive_json || '{}');
  ok(!('allergies' in nonSensitive), 'the sensitive field is NOT in fields_json');
  eq(sensitive.allergies, 'Peanuts', 'and IS in sensitive_json');

  // A required field left blank is refused with a real sentence.
  const fd2 = new FormData();
  fd2.set('event_id', id);
  fd2.set(`field_${fields[1].key}`, 'x@x.com');
  const res2 = await worker.fetch(new Request('https://admin.timothystl.org/api/events/register', { method: 'POST', headers, body: fd2 }), env, ctx);
  eq(res2.status, 400, 'a missing required field is refused');
  has((await res2.json()).error, 'Child', 'the error names which field');

  // Registering for an unknown event answers honestly, not a 500.
  const fd3 = new FormData();
  fd3.set('event_id', 'not-a-real-event');
  const res3 = await worker.fetch(new Request('https://admin.timothystl.org/api/events/register', { method: 'POST', headers, body: fd3 }), env, ctx);
  eq(res3.status, 404, 'an unknown event id is a 404, not a crash');
}

group('registration closed, and capacity');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const id = await createEventViaForm(env, cookie, { has_payment: '0' });

  await callForm(env, `/events/${id}/settings`, { cookie, formData: new URLSearchParams({ name: 'x', status: 'live', registration_open: '0' }) });
  const closedRes = await worker.fetch(new Request('https://admin.timothystl.org/api/events/register', {
    method: 'POST', headers: new Headers({ origin: 'https://timothystl.org' }), body: (() => { const f = new FormData(); f.set('event_id', id); return f; })(),
  }), env, ctx);
  eq(closedRes.status, 403, 'a closed event refuses a sign-up');

  // Reopen with a cap of 1, no waitlist.
  await callForm(env, `/events/${id}/settings`, { cookie, formData: new URLSearchParams({ name: 'x', status: 'live', registration_open: '1', registration_cap: '1', waitlist_enabled: '0' }) });
  const submit = async () => worker.fetch(new Request('https://admin.timothystl.org/api/events/register', {
    method: 'POST', headers: new Headers({ origin: 'https://timothystl.org' }), body: (() => { const f = new FormData(); f.set('event_id', id); f.set('qty', '1'); return f; })(),
  }), env, ctx);
  const first = await submit();
  eq(first.status, 200, 'the first registration fills the one spot');
  const second = await submit();
  eq(second.status, 409, 'a second registration against a cap of 1 with no waitlist is refused');

  // Turn the waitlist on and it succeeds, waitlisted.
  await callForm(env, `/events/${id}/settings`, { cookie, formData: new URLSearchParams({ name: 'x', status: 'live', registration_open: '1', registration_cap: '1', waitlist_enabled: '1' }) });
  const third = await submit();
  eq(third.status, 200, 'with a waitlist on, a second registration is accepted');
  const thirdJson = await third.json();
  eq(thirdJson.waitlisted, true, 'and marked waitlisted');
}

// ── The admin side of registrations: payment status, delete, CSV ─────────────
group('reviewing what came in');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const id = await createEventViaForm(env, cookie, { has_payment: '0' });
  const fd = new FormData();
  fd.set('event_id', id); fd.set('qty', '1');
  const regRes = await worker.fetch(new Request('https://admin.timothystl.org/api/events/register', {
    method: 'POST', headers: new Headers({ origin: 'https://timothystl.org' }), body: fd,
  }), env, ctx);
  const { id: regId } = await regRes.json();

  const upd = await callForm(env, `/events/${id}/registrations/update`, { cookie, formData: new URLSearchParams({ id: String(regId), payment_status: 'paid' }) });
  eq(upd.status, 302, 'updating payment status redirects');
  eq(db.prepare('SELECT payment_status FROM site_event_registrations WHERE id = ?').get(regId).payment_status, 'paid', 'and really changed it');

  const csvRes = await call(env, `/events/${id}/export.csv`, { cookie });
  eq(csvRes.status, 200, 'the CSV export works');
  const csv = await csvRes.text();
  has(csv, 'Payment', 'the CSV has a header row');
  has(csv, 'Paid', 'the updated status appears in the export');

  const del = await callForm(env, `/events/${id}/registrations/delete`, { cookie, formData: new URLSearchParams({ id: String(regId) }) });
  eq(del.status, 302, 'deleting a registration redirects');
  eq(db.prepare('SELECT COUNT(*) AS n FROM site_event_registrations WHERE id = ?').get(regId).n, 0, 'and it is really gone');
}

// ── Marking a registration paid from the generic Registrations tab has to
// record the amount asked, the identical rule /market/update already follows
// for the Christmas Market's own screen — this is the OTHER door onto the
// same site_event_registrations row (any has_payment event gets one), and it
// used to just flip payment_status with no amount, so the pill read Paid
// while the money line and the "collected" total both stayed at zero. Real
// symptom, reported directly: a Christmas Market application marked paid from
// this tab showed "Paid" in the table while the /market screen's "Recorded as
// paid" tile silently excluded it.
group('marking a paid-event registration Paid records the amount, from either door');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ['events_manage']);
  const id = await createEventViaForm(env, cookie); // has_payment defaults on
  const fd = new FormData();
  fd.set('event_id', id); fd.set('qty', '1');
  const regRes = await worker.fetch(new Request('https://admin.timothystl.org/api/events/register', {
    method: 'POST', headers: new Headers({ origin: 'https://timothystl.org' }), body: fd,
  }), env, ctx);
  const { id: regId } = await regRes.json();
  const due = db.prepare('SELECT amount_due_cents, amount_paid_cents FROM site_event_registrations WHERE id = ?').get(regId);
  ok(due.amount_due_cents > 0, 'a has_payment event charges a real fee');
  eq(due.amount_paid_cents, null, 'nothing recorded as paid yet — a fact, not a zero');

  await callForm(env, `/events/${id}/registrations/update`, { cookie, formData: new URLSearchParams({ id: String(regId), payment_status: 'paid' }) });
  const after = db.prepare('SELECT payment_status, amount_paid_cents FROM site_event_registrations WHERE id = ?').get(regId);
  eq(after.payment_status, 'paid', 'marked paid');
  eq(after.amount_paid_cents, due.amount_due_cents, 'and the amount asked was recorded — not left null under a Paid pill');

  // An amount already on the row — a partial payment somebody typed by hand —
  // must never be quietly rounded up to the full fee by a second click of the
  // same dropdown.
  db.prepare('UPDATE site_event_registrations SET payment_status = ?, amount_paid_cents = ? WHERE id = ?').run('unpaid', 500, regId);
  await callForm(env, `/events/${id}/registrations/update`, { cookie, formData: new URLSearchParams({ id: String(regId), payment_status: 'paid' }) });
  eq(db.prepare('SELECT amount_paid_cents FROM site_event_registrations WHERE id = ?').get(regId).amount_paid_cents, 500, 'a recorded partial payment is left alone');

  // Marking waived or dropped must never invent a paid amount — no money
  // arrived either way.
  db.prepare('UPDATE site_event_registrations SET payment_status = ?, amount_paid_cents = NULL WHERE id = ?').run('unpaid', regId);
  await callForm(env, `/events/${id}/registrations/update`, { cookie, formData: new URLSearchParams({ id: String(regId), payment_status: 'waived' }) });
  eq(db.prepare('SELECT amount_paid_cents FROM site_event_registrations WHERE id = ?').get(regId).amount_paid_cents, null, 'waiving the fee records no payment');

  // A different event's coordinator cannot touch this event's registrations,
  // even by guessing a real registration id.
  const fd2 = new FormData(); fd2.set('event_id', id); fd2.set('qty', '1');
  const regRes2 = await worker.fetch(new Request('https://admin.timothystl.org/api/events/register', {
    method: 'POST', headers: new Headers({ origin: 'https://timothystl.org' }), body: fd2,
  }), env, ctx);
  const { id: regId2 } = await regRes2.json();
  const otherId = await createEventViaForm(env, cookie, { name: 'Other Thing' });
  const outsider = signIn(db, [`event_${otherId}_manage`], 'outsider2').cookie;
  const blocked = await callForm(env, `/events/${id}/registrations/delete`, { cookie: outsider, formData: new URLSearchParams({ id: String(regId2) }) });
  eq(blocked.status, 403, 'another event’s coordinator is refused');
  eq(db.prepare('SELECT COUNT(*) AS n FROM site_event_registrations WHERE id = ?').get(regId2).n, 1, 'and the registration survives');
}

// ── Users screen: the dynamic checkbox really grants the dynamic key ─────────
group('granting a per-event permission from the Users screen');
{
  const { db, env } = await boot();
  const { cookie } = signIn(db, ALL_PERMISSIONS, 'admin1');
  const id = await createEventViaForm(env, cookie);

  const newUserForm = await call(env, '/users/new', { cookie });
  has(await newUserForm.text(), `perm_event_${id}_manage`, 'the new-user form offers this event’s own checkbox');

  const createUser = await callForm(env, '/users/new', {
    cookie,
    formData: new URLSearchParams({ username: 'coordinator1', password: 'longenough1', password2: 'longenough1', [`perm_event_${id}_manage`]: '1' }),
  });
  eq(createUser.status, 302, 'creating the user redirects');
  const perms = JSON.parse(db.prepare("SELECT permissions FROM users WHERE username='coordinator1'").get().permissions);
  ok(perms.includes(`event_${id}_manage`), 'the dynamic key was actually saved, not silently dropped');

  const coordCookie = signIn(db, perms, 'coordinator1-session').cookie;
  eq((await call(env, `/events/${id}`, { cookie: coordCookie })).status, 200, 'and that account can now open the event it was granted');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
