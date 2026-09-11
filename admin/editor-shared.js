// ── THE BLOCK EDITOR'S SHARED SCAFFOLDING ───────────────────────────────
// Everything Site Pages (admin/pages.js) and Ministries (admin/ministries.js)
// need in common, plus the self-filling-block data bundle every published
// page is rendered with -- moved out of tlc-admin-worker.js in the same
// code-normalization pass that extracted those two domains' own routes
// (September 2026). Both of their own PRs left a design note that this
// belonged in a real shared module "once Ministries gets the same
// treatment"; this is that module.
//
// `sharedEditorApi` and `pageLayoutContext` are the parts of the page
// editor's API that do not care which table the page lives in -- the media
// library, saved sections, a fresh block of a given type, the stateless
// renderer, and (for real site pages only) the layout/child-page context a
// redraw needs. `editorPageData`/`pageData` are the query bundle every
// self-filling block (sermon, news, staff, giving, values, market,
// registrations, ...) reads from, cached for the life of an editing session
// so a redraw costs nothing -- see the comment on EDITOR_PAGE_DATA_PREFIXES
// below for why that cache is a separate, narrower thing from the public
// /api/pages cache. `promoteScheduledPages` is what the daily cron and the
// immediate /publish route both call to bring a scheduled page live.
// `missingNativeForm`/`NATIVE_FORM_REQUIRED_TYPE` is the one guard the
// Contact and Prayer pages need to keep their real, spam-screened forms
// from silently being replaced by a generic block.
//
// Two things deliberately did NOT move here, and still live in
// tlc-admin-worker.js, threaded through the `editorShared` parameter bag
// built at each domain's delegation call site instead:
// `ctx` (the Worker's own ExecutionContext -- request-scoped, not a value
// this module could own) and `linkTargets` (a per-request-memoized closure
// over `env`, not a stateless function -- moving it would either break its
// memoization or require restructuring it, for no behavior change).
// `MINISTRY_EDITOR_HTML` also stays in the worker for an unrelated reason:
// it is a raw `.html` import, and every admin/*.js file must stay
// importable under plain Node with no loader (see the "Import every admin
// module as ESM" CI step) -- a `.html` import needs the build step the
// worker gets but this file does not.
//
// `pageData` (and the NEWS_ORDER_SQL/NEWS_WHERE_SQL/richOut it reads) is
// also called directly by public routes in the worker -- /api/pages, the
// public /api/ministry/:slug-style page render, give-landing -- which must
// always build fresh and never read the editor's 5-minute cache, since a
// visitor must never be shown a stale draft. Those callers import pageData
// (and the two SQL fragments, and richOut) straight from here.
import {
  sanitizeBlocks, parseBlocks, newBlock, renderPage, safeUrl, makeBlockId, sanitizeClassicRich,
} from './blocks.js';
import { jsonResponse } from './helpers.js';
import { churchDate, churchDatePlus } from './when.js';
import { mergedValues } from './values.js';
import { publicAppearance, parseAppearance, CHROME_LIVE_KEY } from './appearance.js';
import { parseServiceTimes } from './db.js';
import { eventFeeConfig } from './events.js';
import { NEWSLETTER_PUBLIC_WHERE_SQL } from './newsletter.js';

// The prayer and contact forms are the two on this site that MUST stay
// spam-screened — honeypot, signed token, Turnstile, straight through
// admin/forms.js's screenSubmission(). Both pages used to be permanently
// excluded from the block editor for exactly that reason: no block on the
// site could express that screened POST, so publishing either page always
// meant silently losing the real form to whatever generic block stood in
// for it — which happened, once, with the generic 'form' block's empty
// Google Form embed, and went unnoticed until compared to the live site by
// hand.
//
// `prayerform`/`contactform` (admin/blocks.js) close that gap: the real
// form, fixed, shipped as its own block type. These two pages are ordinary
// editable pages now — but the ONE property that made the exclusion
// necessary in the first place still has to hold, so it is enforced here
// instead: a page in this map may publish only while its blocks still carry
// one block of the paired type. ⚠ THE ONE PLACE THIS MAP IS DECLARED — see
// its two call sites (the immediate /publish route and the scheduled-publish
// promotion) for why both have to check it, not just one.
export const NATIVE_FORM_REQUIRED_TYPE = { prayer: 'prayerform', contact: 'contactform' };
export function missingNativeForm(pageId, blocks) {
  const need = NATIVE_FORM_REQUIRED_TYPE[pageId];
  if (!need) return false;
  return !(blocks || []).some((b) => b.type === need);
}

// Ministry slugs are used in URLs and DB lookups; keep them to the shape the
// rest of the site already assumes.
function cleanSlug(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
}

// A page carries its images on every view, so one straight-off-the-phone photo
// is a page nobody on a phone waits for. Returns a message when an image in our
// own bucket is over the limit, or '' when it is fine — an image hosted
// somewhere else is not ours to measure.
const MEDIA_MAX_BYTES = 1048576;
async function oversizeImage(env, url, request) {
  try {
    const origin = new URL(request.url).origin;
    if (!url.startsWith(origin + '/images/')) return '';
    const obj = await env.IMAGES.head(url.slice((origin + '/images/').length));
    if (!obj || obj.size <= MEDIA_MAX_BYTES) return '';
    return `That photo is ${(obj.size / 1048576).toFixed(1)}MB. Photos have to be under 1MB so pages stay quick on a phone — try a smaller one.`;
  } catch (_) {
    return '';
  }
}

// The parts of the page editor's API that do not care which table the page
// lives in: the media library, saved sections, a fresh block of a given type,
// and the stateless renderer. The ministry editor and the site editor mount
// them under their own prefix and share one implementation, so a fix to either
// lands in both. Returns null when `path` is none of them.
// ── THE LAYOUT HAS TO COME BACK WITH EVERY REDRAW ────────────────────────────
// A page's template decides what goes AROUND its blocks — whether there is a
// sidebar at all, and whether the pages beneath this one are listed. Neither
// can come from the request: the template is a stored property of the page, and
// the child list is derived from the page tree rather than typed anywhere.
//
// ⚠ THIS IS THE BUG IT EXISTS FOR. The stateless /render below took only the
// blocks and the slug, so every redraw rendered the page as `standard` — and
// `standard` has no aside. The canvas was right on first paint (the GET passes
// both) and right the moment somebody switched layout (the settings POST passes
// both), so a page with a sidebar showed one until the first structural change
// — an added block, a delete, a reorder, an undo — and then silently lost it
// for the rest of the session. Reloading brought it back, which is exactly what
// made it read as "the sidebar doesn't display" rather than as an editor fault.
//
// Ministry pages have no layout of their own, so this reads nothing for them.
export async function pageLayoutContext(env, P, id) {
  if (P !== '/pages/api' || !id) return {};
  const row = await env.DB.prepare('SELECT id, template, aside_top FROM pages WHERE id = ?')
    .bind(id).first().catch(() => null);
  if (!row) return {};
  // Every child, not only the ones this person may open — the aside and the
  // section list are what a VISITOR will see, and the editor's own GET scopes
  // its rail separately for exactly that reason.
  const kids = await env.DB.prepare(
    'SELECT id, title, menu_label, slug, parent_id, sort, status, in_menu, seo_description ' +
    'FROM pages WHERE parent_id = ? ORDER BY sort ASC, title ASC'
  ).bind(row.id).all().catch(() => ({ results: [] }));
  return { template: row.template, asideTop: row.aside_top || 0, children: kids.results || [] };
}

export async function sharedEditorApi(path, method, request, env, ctx, currentUser, P) {
  if (!path.startsWith(P + '/')) return null;
  const rest = path.slice(P.length);            // '/media', '/sections/12/delete', …
  const sectionId = (suffix) => {
    const m = rest.match(new RegExp('^/sections/(\\d+)' + suffix + '$'));
    return m ? Number(m[1]) : null;
  };
    // ── MEDIA LIBRARY ───────────────────────────────────────────────────
    // Photos land in the same R2 bucket as every other admin upload (via
    // /api/upload-image); a "video" row is just a YouTube URL. Both are
    // catalogd here so staff pick from a library instead of pasting URLs.
    if (path === P + '/media' && method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT id, filename, kind, url, thumb_url, alt, meta FROM ministry_media ORDER BY id DESC LIMIT 200'
      ).all();
      return jsonResponse({ media: rows.results || [] });
    }

    if (path === P + '/media' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const kind = body.kind === 'video' ? 'video' : 'photo';
      const url = safeUrl(body.url);
      if (!url) return jsonResponse({ error: 'That link does not look like a URL.' }, 400);
      const alt = String(body.alt || '').trim().slice(0, 200);
      // A church site should not ship inaccessible images. Videos carry their
      // own title on YouTube, so the requirement is photos only.
      if (kind === 'photo' && !alt) return jsonResponse({ error: 'Please describe the photo before adding it.' }, 400);
      // Every stored image stays under a megabyte. The browser resizes before
      // uploading, but that is a courtesy — this is the control, and it is the
      // only place that sees what actually landed in the bucket.
      if (kind === 'photo') {
        const tooBig = await oversizeImage(env, url, request);
        if (tooBig) return jsonResponse({ error: tooBig }, 400);
      }
      const thumbUrl = safeUrl(body.thumb_url).slice(0, 600);
      const filename = String(body.filename || url.split('/').pop() || 'upload').slice(0, 160);
      const meta = String(body.meta || '').slice(0, 80);
      const bytes = Math.max(0, parseInt(body.bytes, 10) || 0);
      const res = await env.DB.prepare(
        'INSERT INTO ministry_media (filename, kind, url, thumb_url, alt, meta, bytes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(filename, kind, url, thumbUrl, alt, meta, bytes, currentUser?.username || '', new Date().toISOString()).run();
      return jsonResponse({ ok: true, item: { id: res.meta?.last_row_id || 0, filename, kind, url, thumb_url: thumbUrl, alt, meta, bytes } });
    }

    // ── SAVED SECTIONS ──────────────────────────────────────────────────
    if (path === P + '/sections' && method === 'GET') {
      const rows = await env.DB.prepare(
        'SELECT id, name, blocks, created_by FROM ministry_saved_sections ORDER BY name COLLATE NOCASE'
      ).all();
      return jsonResponse({
        sections: (rows.results || []).map((r) => ({
          id: r.id, name: r.name, created_by: r.created_by, count: parseBlocks(r.blocks).length,
        })),
      });
    }

    if (path === P + '/sections' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const name = String(body.name || '').trim().slice(0, 60);
      const blocks = sanitizeBlocks(body.blocks);
      if (!name) return jsonResponse({ error: 'Give the section a name.' }, 400);
      if (!blocks.length) return jsonResponse({ error: 'There is nothing to save.' }, 400);
      const res = await env.DB.prepare(
        'INSERT INTO ministry_saved_sections (name, blocks, created_by, created_at) VALUES (?, ?, ?, ?)'
      ).bind(name, JSON.stringify(blocks), currentUser?.username || 'staff', new Date().toISOString()).run();
      return jsonResponse({ ok: true, section: { id: res.meta?.last_row_id || 0, name, count: blocks.length } });
    }

    // The blocks of one section, with fresh ids so dropping the same section
    // onto a page twice cannot collide with itself.
    if (sectionId('') !== null && method === 'GET') {
      const id = sectionId('');
      const row = await env.DB.prepare('SELECT blocks FROM ministry_saved_sections WHERE id = ?').bind(id).first();
      if (!row) return jsonResponse({ error: 'Not found' }, 404);
      const blocks = sanitizeBlocks(parseBlocks(row.blocks)).map((b) => Object.assign({}, b, { id: makeBlockId() }));
      return jsonResponse({ blocks });
    }

    if (sectionId('/delete') !== null && method === 'POST') {
      const id = sectionId('/delete');
      await env.DB.prepare('DELETE FROM ministry_saved_sections WHERE id = ?').bind(id).run();
      return jsonResponse({ ok: true });
    }

    // A fresh block of a given type, straight from the server's own defaults,
    // so the editor never has to keep its own copy of them.
    if (path === P + '/new-block' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const block = newBlock(String(body.type || ''));
      if (!block) return jsonResponse({ error: 'Unknown block type' }, 400);
      return jsonResponse({ block });
    }

    // Stateless render — the editor's single source of block markup. It writes
    // nothing; the only reads are the self-filling blocks' data bundle and the
    // page's own layout, so what staff arrange on the canvas is what visitors
    // get.
    if (path === P + '/render' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const blocks = sanitizeBlocks(body.blocks);
      const slug = cleanSlug(body.slug);
      return jsonResponse({
        html: renderPage(blocks, Object.assign({
          editing: true, slug, withCss: true, data: await editorPageData(env, ctx),
        }, await pageLayoutContext(env, P, slug))),
        blocks,
      });
    }


  return null;
}

// ── PAGE DATA CONTEXT ────────────────────────────────────────────────────────
// Self-filling blocks (sermon, news, staff, service times, map) read from here
// and never from the block itself, so a page cannot show stale copies of data
// that lives elsewhere in the admin.
//
// One query bundle per page render, memoised for the life of the request: a
// page with a Sermon block and a Staff block costs the same queries as a page
// with ten of each. Keyed on the request's own ExecutionContext, not on `env` —
// `env` is shared by every request in an isolate, so caching against it would
// serve yesterday's sermon until Cloudflare happened to recycle the isolate.
const PAGE_DATA_CACHE = new WeakMap();

// ── THE EDITOR'S OWN COPY, HELD ACROSS AN EDITING SESSION ────────────────────
// The block editor's stateless render (`POST …/api/render`) runs on EVERY
// structural change — add a block, delete one, drag one, undo, redo, reset —
// and each one rebuilt this whole bundle from scratch. Measured: about 25
// queries and ~500 rows read per render. Nudging a block on a page was costing
// the same database work as a cold public page load, dozens of times a minute,
// while the office rearranged a page. That is a real share of the D1 row budget
// this repo has already exhausted once (see CLAUDE.md, 2026-09-04).
//
// So the editor holds one bundle per isolate for a few minutes. It is a
// SEPARATE cache from the per-request memo above, and only the editor routes
// read it: `/api/pages` and `/api/ministry/:slug` are public and keep building
// fresh, because a visitor must never be shown last week's sermon.
//
// ⚠ THE INVALIDATION LIST IS NOT `PAGE_DATA_PREFIXES`, AND MUST NOT BE MADE
// ONE. That list busts a cache of the whole /api/pages payload, which is also
// fed by the `pages` and `menu_items` tables — and pageData() reads neither
// (checked against its queries, not assumed). The editor posts to /pages on
// every render and every autosave, so including that prefix would bust this
// cache on the one action it exists to make cheap, and the whole thing would
// quietly do nothing.
//
// ⚠ The TTL is the backstop, not the mechanism. Every prefix below is one this
// bundle genuinely reads, but a route added later that writes one of these
// tables from somewhere else would be missed — and a canvas that disagrees
// with the site indefinitely is the failure worth designing against. Five
// minutes bounds it by construction, with nothing to keep in step.
const EDITOR_PAGE_DATA = new WeakMap();
const EDITOR_PAGE_DATA_TTL_MS = 5 * 60 * 1000;
export const EDITOR_PAGE_DATA_PREFIXES = [
  '/pages/details',            // church_* settings → Contact details, Map, Service times
  '/menu/appearance/publish',  // the LIVE chrome record → every block's fonts and colors
  '/partners',                 // → Partner logos
  '/values',                   // → Core values
  '/staff',                    // → Staff grid
  '/giving',                   // → Giving widget, Amount ladder
  '/christian-education',      // → Bible classes
  '/sermons',                  // → Sermon library, the homepage card
  '/newsitems',                // → News feed, News highlights
  '/market',                   // → Market facts, Market application
  '/events',                   // → Registration
  '/newsletter',               // → Newsletter archive
];

export async function editorPageData(env, reqKey) {
  const hit = EDITOR_PAGE_DATA.get(env.DB);
  if (hit && (Date.now() - hit.at) < EDITOR_PAGE_DATA_TTL_MS) {
    // Seed the per-request memo too, so the second read inside one render
    // (layout context, then the render itself) still costs nothing.
    if (reqKey && !PAGE_DATA_CACHE.has(reqKey)) PAGE_DATA_CACHE.set(reqKey, hit.p);
    return hit.p;
  }
  const p = pageData(env, reqKey);
  const entry = { at: Date.now(), p };
  EDITOR_PAGE_DATA.set(env.DB, entry);
  // ⚠ A build that fails is not held for five minutes. Every query inside
  // pageData catches its own failure, so this is the assembly throwing — rare,
  // and exactly the case where repeating the work is the right answer.
  p.catch(() => { if (EDITOR_PAGE_DATA.get(env.DB) === entry) EDITOR_PAGE_DATA.delete(env.DB); });
  return p;
}

export function bustEditorPageData(env) {
  try { EDITOR_PAGE_DATA.delete(env.DB); } catch (_) {}
}

// One sort rule, shared by /api/news and pageData()'s self-filling news
// blocks: pinned first, then an event (has event_date) before a plain
// announcement, events soonest-first, announcements newest-published-first.
// CASE WHEN … ASC picks which group comes first; the two date columns each
// keep their own direction, which a single ORDER BY column cannot do.
export const NEWS_ORDER_SQL = `ORDER BY pinned DESC,
  CASE WHEN event_date IS NOT NULL THEN 0 ELSE 1 END ASC,
  event_date ASC, publish_date DESC, id DESC`;

// ⚠ AND ONE `WHERE`, WHICH THE COMMENT ABOVE HAS CLAIMED FOR A YEAR AND WHICH
// DID NOT EXIST (COR-1). Only the ORDER BY was ever extracted; the two WHERE
// clauses were written separately and had drifted three ways — pageData()
// compared against UTC `date('now')` rather than church time, never checked
// `publish_date`, and never filtered the channel at all. So a post scheduled
// for a future date was ALREADY LIVE on every block-rendered page, as was one
// the office had marked email-only.
//
// It takes the date as a bind so both callers pass churchDate() and neither
// can quietly go back to asking SQLite what day it is in UTC.
//
// ⚠ `calendar` is a channel the CALENDAR reads and this does not. A school
// break or a week of testing belongs on the month and is not something anybody
// wants a paragraph about on /news.
export const NEWS_WHERE_SQL = `WHERE publish_date <= ?
  AND (expire_date IS NULL OR expire_date >= ?)
  AND (event_date IS NULL OR event_date >= ?)
  AND (channels IS NULL OR channels LIKE '%web%')`;

// ── FX-04, THE LEGACY HALF ───────────────────────────────────────────────────
// Sanitizing on write protects everything saved from now on. It does nothing
// for the rows already in the table, which were stored exactly as posted for as
// long as these forms have existed — and those are the ones the public site is
// rendering into `innerHTML` today.
//
// So the public read paths sanitize on the way out too. That is belt and
// braces for a new row and the ONLY protection for an old one.
//
// ⚠ DELIBERATELY NOT A ONE-TIME MIGRATION OVER THE STORED BODIES. A pass like
// that cannot be undone, and the one thing worse than unsanitized markup in the
// archive is a script that rewrites six years of newsletters and gets it wrong
// on a body nobody thought to check. Cleaning on the way out is reversible by
// deleting one line; the stored bytes stay exactly as they were, so if this
// profile turns out to eat something real, the content is still there.
export const richOut = (v) => (v ? sanitizeClassicRich(v) : v);

export async function pageData(env, reqKey) {
  if (reqKey && PAGE_DATA_CACHE.has(reqKey)) return PAGE_DATA_CACHE.get(reqKey);
  const p = (async () => {
    const q = async (sql, ...binds) => {
      try { return (await env.DB.prepare(sql).bind(...binds).all()).results || []; } catch (_) { return []; }
    };
    const [settingRows, chromeRow, sermonRow, sermonSeries, sermonNotes, bibleClasses, news, staff, newsletters,
           giveTiers, giveFunds, giveUrlRow, partners, coreValueRows, marketEventRow, allEventRows, allEventFieldRows] = await Promise.all([
      q("SELECT key, value FROM site_settings WHERE key LIKE 'church_%'"),
      // ⚠ The PUBLISHED row only. The draft exists so that somebody can try a
      // color without it being on the front of the church website, and
      // reading the wrong key here would undo that in one line.
      env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(CHROME_LIVE_KEY).first().catch(() => null),
      env.DB.prepare(
        'SELECT n.title, n.date, n.scripture, n.youtube_url, n.audio_url, s.title AS series ' +
        'FROM sermon_notes n LEFT JOIN sermon_series s ON s.id = n.series_id ' +
        'ORDER BY COALESCE(n.date, \'\') DESC, n.id DESC LIMIT 1'
      ).first().catch(() => null),
      // The library itself, for the Sermon library block on /sermons. The row
      // above is the single newest sermon and always has been — it is what the
      // homepage's "Latest sermon" card shows, and it is the reason /sermons
      // had nothing to render from: there was no block that could list what the
      // church has actually preached.
      // ⚠ Bounded. This is rendered into every /api/pages response, and a
      // church that keeps preaching would otherwise grow that payload forever.
      q('SELECT id, title, date_range, description, active, sort_order FROM sermon_series ORDER BY active DESC, sort_order ASC, id DESC LIMIT 24'),
      q('SELECT id, series_id, title, date, scripture, youtube_url, audio_url ' +
        'FROM sermon_notes ORDER BY COALESCE(date, \'\') DESC, id DESC LIMIT 120'),
      // The Bible classes, for the Bible classes block on /education (the page
      // the menu calls "Learn"). Same rows, same order and the same active
      // filter as /api/bible-classes, which is what the hardcoded page fetches
      // at runtime — so the converted page shows exactly what the old one did.
      q('SELECT id, title, label, description, leader, location, schedule, accent ' +
        'FROM bible_classes WHERE active = 1 ORDER BY sort_order, id LIMIT 40'),
      // Full fields, not just title+date — the "News feed" block (unlike the
      // older "News highlights" block, which only ever needed a title and a
      // date) shows the same expandable image/summary/body cards the /news
      // page used to hand-roll. Both blocks read this one list.
      q(`SELECT id, title, summary, body, image_url, publish_date, event_date, pinned FROM news_items
         ${NEWS_WHERE_SQL} ${NEWS_ORDER_SQL} LIMIT 30`, churchDate(), churchDate(), churchDate()),
      // ⚠ The Staff grid block shows EVERY row this returns, so this limit is
      // the only thing that can cut somebody off the About page. It was 12,
      // which a church that hires two more people would quietly cross with
      // nothing to see but a missing face. Still bounded — it is rendered into
      // every /api/pages response — just bounded well above the real number.
      // ⚠ photo_position and photo_zoom are the per-person crop somebody set by
      // eye on the Staff screen. They were not selected here, so the Staff grid
      // block had no crop to honor even once it wanted to — a face framed in the
      // admin came out framed differently on the published page.
      q('SELECT name, title, email, photo_url, photo_position, photo_zoom ' +
        'FROM staff_members ORDER BY display_order ASC, id ASC LIMIT 60'),
      // Same public filter /api/newsletters itself uses — see
      // NEWSLETTER_PUBLIC_WHERE_SQL: published, and not superseded by a
      // later, corrected issue that has since been sent in its place.
      q(`SELECT id, subject, published_at, pastor_note FROM newsletters
         WHERE ${NEWSLETTER_PUBLIC_WHERE_SQL} AND published_at >= ?
         ORDER BY published_at DESC, id DESC LIMIT 12`, churchDatePlus(-365)),
      // The giving page's three moving parts. They are read here, with
      // everything else a block might need, so the Giving widget and the
      // Amount ladder can be SELF-FILLING blocks — the one property that
      // makes putting the donation page in the block editor safe at all. A
      // block that stored the Tithe.ly link would freeze it at publish time
      // and go on charging to the old form after the office changed it.
      q('SELECT amount, url, is_default FROM give_amount_tiers WHERE active != 0 ORDER BY sort_order'),
      q('SELECT id, name, tithely_fund_id, is_default FROM give_funds WHERE active != 0 ORDER BY sort_order'),
      env.DB.prepare("SELECT value FROM site_settings WHERE key = 'give_url'").first().catch(() => null),
      // The partner ministries, so the Partner logos block can be self-filling
      // the way the staff grid and the sermon block already are. A logo changed
      // on the Partners screen lands on every page showing it at once, and
      // nobody retypes a partner's name into a page for it to go stale there.
      q('SELECT id, name, short_name, value, blurb, site_url, logo_url FROM partners ORDER BY sort_order, id'),
      // The office-editable words and photo for each of the four values — see
      // the note on core_values in admin/db.js for why only these columns and
      // not the design tokens.
      q('SELECT key, short, name, blurb, tag, why, photo_url FROM core_values'),
      // The Christmas Market's own event row, for the self-filling application
      // block — see admin/market.js and admin/events.js's eventFeeConfig().
      // Batched here with everything else rather than a second round trip per
      // page render, the same reasoning as give above.
      env.DB.prepare("SELECT * FROM site_events WHERE id = 'christmasmarket'").first().catch(() => null),
      // Every event (the market included, so the `registration` block's
      // event picker can name it even though it never actually uses it),
      // for the generic `registration` block — see admin/events.js. A
      // handful of rows at most; unbounded, unlike the news/staff/sermon
      // lists above, on purpose — there is no reasonable number of events a
      // church runs that would make this worth capping.
      q('SELECT * FROM site_events ORDER BY sort_order, id'),
      q('SELECT * FROM site_event_fields ORDER BY event_id, sort_order, id'),
    ]);
    const s = {};
    for (const r of settingRows) s[r.key.replace(/^church_/, '')] = r.value;
    return {
      settings: { address_line: s.address_line || '', address_city: s.address_city || '', phone: s.phone || '', email: s.email || '' },
      services: parseServiceTimes(s.service_times),
      // Resolved to real colors by publicAppearance, so public/index.html
      // never carries a copy of the palette and cannot drift from it.
      appearance: publicAppearance(parseAppearance(chromeRow && chromeRow.value)),
      sermon: sermonRow || null,
      // Series with their own sermons nested, assembled here rather than in the
      // renderer: admin/blocks.js is shared with the editor and the tests, and
      // it must never know how these two tables relate.
      sermonSeries: (sermonSeries || []).map((se) => ({
        id: se.id, title: se.title, dates: se.date_range || '',
        description: se.description || '', active: !!se.active,
        sermons: (sermonNotes || []).filter((n) => n.series_id === se.id),
      })),
      // ⚠ A sermon with no series is still a sermon. The admin calls these
      // "standalone" and offers a button for them, so a page that quietly
      // dropped them would be hiding content somebody deliberately added.
      sermonLoose: (sermonNotes || []).filter((n) => !n.series_id),
      classes: bibleClasses || [],
      // FX-04: the `newsfeed` block emits `n.body` as markup, server-side, into
      // every published page in /api/pages. Same legacy problem as /api/news,
      // same answer — see richOut above.
      news: (news || []).map((r) => ({ ...r, body: richOut(r.body) })),
      staff, newsletters,
      // The four core values, composed here so the block is self-filling: the
      // words come from admin/values.js, office-edited words layered on top
      // from the core_values table (mergedValues — blank column means "still
      // the hardcoded default"), the partner ministry from the `partners`
      // table. ⚠ VALUES order is the arc — Welcome, Receive, Grow, Go — and
      // is never sorted.
      values: mergedValues(coreValueRows).map((v) => {
        const p = partners.find((x) => x.value === v.key);
        return {
          key: v.key, short: v.short, name: v.name, blurb: v.blurb,
          tag: v.tag || v.blurb, why: v.why || '',
          field: v.field || '', light: v.light || v.solid, darkInk: !!v.darkInk,
          ways: v.ways || [],
          // A photo replaces the flat gradient field with a photograph under a
          // fixed dark veil — see renderBlock's 'values' branch. Never the
          // reverse: the veil exists only when there is a photo to keep
          // legible, so an untouched value renders byte-identical to before.
          photoUrl: v.photo_url || '',
          partner: p ? { name: p.name, body: p.blurb || '' } : null,
        };
      }),
      partners: partners.map((p) => ({
        id: p.id, name: p.name, shortName: p.short_name || '',
        url: p.site_url || '', logo: p.logo_url || '',
      })),
      // Same shape /api/give-amounts and /api/give-funds already publish, so
      // the blocks and the hardcoded fallback page read identical objects.
      give: {
        baseUrl: (giveUrlRow && giveUrlRow.value) || '',
        tiers: giveTiers.map((r) => ({ amount: r.amount, url: r.url || '', isDefault: !!r.is_default })),
        funds: giveFunds.map((r) => ({ id: r.id, name: r.name, tithelyFundId: r.tithely_fund_id || '', isDefault: !!r.is_default })),
      },
      // The market application block reads this — see admin/market.js and the
      // 'marketapp' branch in renderBlock(). No payment address is in it: the
      // fund and the base link are resolved from `give` above, at the moment
      // an application is actually submitted, never stored in a block.
      market: eventFeeConfig(marketEventRow, (giveUrlRow && giveUrlRow.value) || ''),
      // Every event, shaped for the generic `registration` block — see
      // admin/events.js and the 'registration' branch in renderBlock().
      // Keyed by event id so a block's own `eventId` field is a direct
      // lookup. The market is included (its `hasRegistration` reads true on
      // the row, but it never actually gets a `registration` block — it
      // keeps `marketapp` — so this only matters for the event picker
      // listing it by name).
      eventsById: Object.fromEntries((allEventRows || []).map((ev) => [ev.id, {
        id: ev.id, name: ev.name,
        hasRegistration: !!Number(ev.has_registration), hasPayment: !!Number(ev.has_payment),
        registrationOpen: !!Number(ev.registration_open ?? 1),
        dateLabel: ev.date_label || '', coordinatorEmail: ev.coordinator_email || '',
        feeConfig: Number(ev.has_payment) ? eventFeeConfig(ev, (giveUrlRow && giveUrlRow.value) || '') : null,
      }])),
      eventFieldsById: (allEventRows || []).reduce((acc, ev) => {
        acc[ev.id] = (allEventFieldRows || []).filter((f) => f.event_id === ev.id).map((f) => ({
          key: f.key, label: f.label, kind: f.kind, required: !!Number(f.required),
          placeholder: f.placeholder || '', hint: f.hint || '',
          options: (() => { try { const o = JSON.parse(f.options || '[]'); return Array.isArray(o) ? o : []; } catch (_) { return []; } })(),
        }));
        return acc;
      }, {}),
    };
  })();
  if (reqKey) PAGE_DATA_CACHE.set(reqKey, p);
  return p;
}

// Promotes site pages whose scheduled publish time has come. The former
// youth_pages publisher was retired once the public site stopped reading that
// table's bodies; keeping it alive would let an invisible editor continue to
// claim that unused content had gone live.
export async function promoteScheduledPages(env) {
  const nowIso = new Date().toISOString();
  let promoted = 0;
  try {
    const due = await env.DB.prepare(
      'SELECT id, title, blocks FROM pages WHERE publish_at IS NOT NULL AND publish_at <= ?'
    ).bind(nowIso).all();
    for (const row of due.results || []) {
      const blocks = sanitizeBlocks(parseBlocks(row.blocks));
      // ⚠ SAME GUARD AS THE IMMEDIATE /publish ROUTE, AND FOR THE SAME
      // REASON. A page can be scheduled with its real form block present and
      // have that block removed from the draft before the scheduled moment
      // arrives — this promotion is the other place published_blocks is set,
      // so it is the other place this has to be checked. Skipped rather than
      // promoted; publish_at is left alone so it is retried on the next
      // sweep rather than silently dropped.
      if (missingNativeForm(row.id, blocks)) continue;
      const json = JSON.stringify(blocks);
      await env.DB.prepare(
        "UPDATE pages SET published_blocks = ?, status = 'published', publish_at = NULL, change_log = '[]', updated_at = ? WHERE id = ?"
      ).bind(json, nowIso, row.id).run();
      await env.DB.prepare('INSERT INTO page_revisions (page_id, blocks, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
        .bind(row.id, json, 'Published on schedule', nowIso, 'scheduled').run();
      promoted += 1;
    }
  } catch (e) {
    console.error('Scheduled site page publish failed:', e && e.message);
  }
  return promoted;
}
