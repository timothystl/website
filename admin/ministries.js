// Ministries admin: the ministry list, the retired old block editor's compat
// shims, the metadata screen (core value + posts toggle -- everything else
// moved to the Site Editor), and the per-ministry posts feed. Moved out of
// tlc-admin-worker.js's own if-chain (September 2026 code-normalization
// survey), the same pattern used for Menu, Sermons, and Site Pages.
//
// `editorShared` carries the handful of things this domain shares with Site
// Pages (admin/pages.js) and the public /api/pages handler and daily cron --
// sharedEditorApi, editorPageData, linkTargets, and promoteScheduledPages,
// plus the Worker's ctx. Site Pages left a design note that a genuinely
// shared module for these should exist "once Ministries gets the same
// treatment" -- this pass keeps threading the same parameter bag instead,
// since the two domains still construct it identically at their worker call
// sites; hoisting it into its own module is a mechanical follow-up, not a
// behavior change, and is better done once no in-flight extraction PR is
// touching either call site.
//
// ⚠ A request to /ministries or /youth that matches none of the routes
// below (bare `return null`) falls through to whatever comes after Ministries
// in tlc-admin-worker.js's own if-chain (Notices, at the time of this
// extraction) -- same as every other extracted domain here.
import {
  sanitizeBlocks, parseBlocks, renderPage, blocksClientConfig, starterBlocks, sanitizeClassicRich,
} from './blocks.js';
import { hasPermission, logAudit } from './auth.js';
import { html, jsonResponse, sidebarShell, escapeHtml, tinymcePostSection } from './helpers.js';
import {
  renderListSection, statusPill, valueChip, valueChips, primaryCell, pluralise, rowActions, toggleCell,
} from './ui.js';
import { SECTIONS, section as sectionCfg, columnsOf, filtersOf } from './sections.js';
import { valueByKey, normalizeValue } from './values.js';
import { churchDate } from './when.js';
import { TINYMCE_HEAD } from './db.js';

export async function handleMinistriesRoutes(request, env, path, method, currentUser, url, badges, editorShared) {
  if (!(path.startsWith('/ministries') || path === '/youth' || path.startsWith('/youth/'))) return null;
  if (!hasPermission(currentUser, 'ministries_edit')) {
    return new Response('Access denied.', { status: 403 });
  }

  // Compat: redirect old /youth/* admin URLs to /ministries/*
  if (path === '/youth' && method === 'GET') {
    return new Response('', { status: 302, headers: { Location: '/ministries' } });
  }
  if (path.startsWith('/youth/') && method === 'GET') {
    return new Response('', { status: 302, headers: { Location: '/ministries' + path.slice('/youth'.length) } });
  }

  // Everything past this point is /ministries/*; a non-GET /youth request
  // (nothing sends one today) falls through with the same `return null` as
  // any other unmatched path, exactly as it did before this extraction.
  if (!path.startsWith('/ministries')) return null;

  const CORE_SLUGS = ['youth','sundayschool','confirmation','vbs','egghunt','family','music','stephen','foodpantry','bees','christmasmarket'];
  const canonicalPageFor = (slug) => env.DB.prepare(
    'SELECT id, title, slug, status, in_menu, owner_username, blocks, published_blocks, publish_at, updated_at FROM pages WHERE slug = ?'
  ).bind('/' + slug).first();
  const canEditCanonical = (page) => !!(page && (page.id || page.site_page_id)) && (
    hasPermission(currentUser, 'pages_edit') ||
    (hasPermission(currentUser, 'pages_edit_own') && page.owner_username === currentUser?.username)
  );

  // ── BLOCK PAGE EDITOR ────────────────────────────────────────────────
  // Full-viewport editor screen. Served as a static shell (same pattern as
  // the payroll page); everything it needs arrives over the JSON API below.
  if (path.startsWith('/ministries/editor/') && method === 'GET') {
    const slug = decodeURIComponent(path.slice('/ministries/editor/'.length));
    const exists = await env.DB.prepare('SELECT slug FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!exists) return new Response('', { status: 302, headers: { Location: '/ministries' } });
    const canonical = await canonicalPageFor(slug);
    if (canEditCanonical(canonical)) {
      return new Response('', { status: 302, headers: { Location: `/pages/${encodeURIComponent(canonical.id)}/edit` } });
    }
    const reason = canonical
      ? 'This page exists in the Site Editor, but it is not assigned to your account.'
      : 'This ministry has no matching Site Editor page.';
    return html(`${sidebarShell('ministries', currentUser, '<a href="/ministries">← All ministries</a>', badges)}
<div class="tlc-wrap"><div class="alert alert-warn"><strong>The old ministry editor has been retired.</strong>
${escapeHtml(reason)} Nothing entered in the old editor appeared on the public website after the page migration, so it no longer accepts edits or publishing. Ask a website administrator to create or assign the canonical page.</div></div>`, 'Editor retired');
  }

  // An already-open tab must not be able to keep autosaving or publishing
  // into the retired youth_pages body columns after the UI is gone.
  if (path.startsWith('/ministries/api/page/') && method === 'POST') {
    const rest = path.slice('/ministries/api/page/'.length);
    const slug = decodeURIComponent(rest.split('/')[0]);
    const canonical = await canonicalPageFor(slug);
    return jsonResponse({
      error: 'The old ministry editor is retired. Use the Site Editor.',
      editor: canEditCanonical(canonical) ? `/pages/${encodeURIComponent(canonical.id)}/edit` : null,
    }, 409);
  }

  // Everything the editor needs in one round trip.
  if (path.startsWith('/ministries/api/page/') && method === 'GET') {
    const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length));
    const row = await env.DB.prepare(
      'SELECT slug, title, blocks, published_blocks, page_status, publish_at, change_log, updated_at FROM youth_pages WHERE slug = ?'
    ).bind(slug).first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    const blocks = sanitizeBlocks(parseBlocks(row.blocks));
    const media = await env.DB.prepare(
      'SELECT id, filename, kind, url, thumb_url, alt, meta FROM ministry_media ORDER BY id DESC LIMIT 200'
    ).all().catch(() => ({ results: [] }));
    return jsonResponse({
      page: {
        slug: row.slug, title: row.title, status: row.page_status || 'live',
        publish_at: row.publish_at || null, updated_at: row.updated_at || '',
        blocks, changes: parseBlocks(row.change_log),
        published_count: sanitizeBlocks(parseBlocks(row.published_blocks)).length,
      },
      config: blocksClientConfig(await editorShared.editorPageData(env, editorShared.ctx)),
      linkTargets: await editorShared.linkTargets(),
      media: media.results || [],
      html: renderPage(blocks, { editing: true, slug, withCss: true, data: await editorShared.editorPageData(env, editorShared.ctx) }),
    });
  }

  // Autosaved working draft. Sanitized on the way in — client-side clamping
  // is a courtesy, this is the control.
  if (path.startsWith('/ministries/api/page/') && path.endsWith('/draft') && method === 'POST') {
    const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/draft'.length)));
    const row = await env.DB.prepare('SELECT slug, page_status, published_blocks FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    const body = await request.json().catch(() => ({}));
    const blocks = sanitizeBlocks(body.blocks);
    const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0, 24).map((c) => String(c).slice(0, 160));
    const published = JSON.stringify(sanitizeBlocks(parseBlocks(row.published_blocks)));
    const draft = JSON.stringify(blocks);
    // A page only leaves "live" once the draft actually differs from what
    // is published — otherwise an idle autosave would flag a false draft.
    let status = row.page_status || 'live';
    if (status !== 'scheduled') status = draft === published ? 'live' : 'draft';
    const nowIso = new Date().toISOString();
    await env.DB.prepare('UPDATE youth_pages SET blocks = ?, change_log = ?, page_status = ?, updated_at = ? WHERE slug = ?')
      .bind(draft, JSON.stringify(changes), status, nowIso, slug).run();
    return jsonResponse({ ok: true, saved_at: nowIso, status, blocks });
  }

  // Publish: the draft becomes what the public site renders, and a snapshot
  // goes into the revision log so it can be rolled back.
  if (path.startsWith('/ministries/api/page/') && path.endsWith('/publish') && method === 'POST') {
    const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/publish'.length)));
    const row = await env.DB.prepare('SELECT slug, title, blocks FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    const body = await request.json().catch(() => ({}));
    const blocks = sanitizeBlocks(body.blocks && body.blocks.length ? body.blocks : parseBlocks(row.blocks));
    const json = JSON.stringify(blocks);
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE youth_pages SET blocks = ?, published_blocks = ?, page_status = 'live', publish_at = NULL, change_log = '[]', updated_at = ? WHERE slug = ?"
    ).bind(json, json, nowIso, slug).run();
    await env.DB.prepare('INSERT INTO ministry_page_revisions (slug, blocks, published_at, published_by) VALUES (?, ?, ?, ?)')
      .bind(slug, json, nowIso, currentUser?.username || 'staff').run();
    await logAudit(env.DB, currentUser, 'publish', 'ministry_page', slug, row.title || slug, null, { blocks: blocks.length });
    return jsonResponse({ ok: true, status: 'live', saved_at: nowIso, url: 'https://timothystl.org/' + slug });
  }

  // Unpublish: the reverse of Publish. See the identical route on the
  // `pages` table above for the full reasoning — same shape here, just
  // page_status rather than status, and no menu/route removal to warn
  // about: a ministry page's public content beyond published_blocks
  // (its legacy `content` field, if any) is untouched, so this only ever
  // takes back what Publish added.
  if (path.startsWith('/ministries/api/page/') && path.endsWith('/unpublish') && method === 'POST') {
    const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/unpublish'.length)));
    const row = await env.DB.prepare('SELECT slug, title, published_blocks FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    if (row.published_blocks == null) return jsonResponse({ error: 'This page is not published.' }, 400);
    const nowIso = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE youth_pages SET published_blocks = NULL, page_status = 'draft', publish_at = NULL, updated_at = ? WHERE slug = ?"
    ).bind(nowIso, slug).run();
    await logAudit(env.DB, currentUser, 'unpublish', 'ministry_page', slug, row.title || slug,
      { blocks: sanitizeBlocks(parseBlocks(row.published_blocks)).length }, null);
    return jsonResponse({ ok: true, status: 'draft', saved_at: nowIso });
  }

  // Schedule: the draft is promoted by the cron handler when it comes due.
  if (path.startsWith('/ministries/api/page/') && path.endsWith('/schedule') && method === 'POST') {
    const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/schedule'.length)));
    const row = await env.DB.prepare('SELECT slug, blocks, published_blocks FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!row) return jsonResponse({ error: 'Not found' }, 404);
    const body = await request.json().catch(() => ({}));
    if (!body.publish_at) {
      const back = JSON.stringify(sanitizeBlocks(parseBlocks(row.blocks))) === JSON.stringify(sanitizeBlocks(parseBlocks(row.published_blocks))) ? 'live' : 'draft';
      await env.DB.prepare('UPDATE youth_pages SET publish_at = NULL, page_status = ? WHERE slug = ?').bind(back, slug).run();
      return jsonResponse({ ok: true, status: back, publish_at: null });
    }
    const when = new Date(body.publish_at);
    if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) {
      return jsonResponse({ error: 'Pick a date and time in the future.' }, 400);
    }
    await env.DB.prepare("UPDATE youth_pages SET publish_at = ?, page_status = 'scheduled' WHERE slug = ?").bind(when.toISOString(), slug).run();
    return jsonResponse({ ok: true, status: 'scheduled', publish_at: when.toISOString() });
  }

  if (path.startsWith('/ministries/api/page/') && path.endsWith('/revisions') && method === 'GET') {
    const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/revisions'.length)));
    const rows = await env.DB.prepare(
      'SELECT id, published_at, published_by, blocks FROM ministry_page_revisions WHERE slug = ? ORDER BY id DESC LIMIT 20'
    ).bind(slug).all();
    return jsonResponse({
      revisions: (rows.results || []).map((r) => ({
        id: r.id, published_at: r.published_at, published_by: r.published_by, count: parseBlocks(r.blocks).length,
      })),
    });
  }

  // Restore loads a snapshot into the DRAFT, never straight to live, so
  // staff look at what they are about to bring back before publishing it.
  if (path.startsWith('/ministries/api/page/') && path.endsWith('/restore') && method === 'POST') {
    const slug = decodeURIComponent(path.slice('/ministries/api/page/'.length, -('/restore'.length)));
    const body = await request.json().catch(() => ({}));
    const rev = await env.DB.prepare('SELECT blocks FROM ministry_page_revisions WHERE id = ? AND slug = ?')
      .bind(Number(body.id) || 0, slug).first();
    if (!rev) return jsonResponse({ error: 'Not found' }, 404);
    const blocks = sanitizeBlocks(parseBlocks(rev.blocks));
    await env.DB.prepare("UPDATE youth_pages SET blocks = ?, page_status = 'draft', updated_at = ? WHERE slug = ?")
      .bind(JSON.stringify(blocks), new Date().toISOString(), slug).run();
    return jsonResponse({ ok: true, blocks, html: renderPage(blocks, { editing: true, slug, withCss: true, data: await editorShared.editorPageData(env, editorShared.ctx) }) });
  }

  const sharedMinistry = await editorShared.sharedEditorApi(path, method, request, env, editorShared.ctx, currentUser, '/ministries/api');
  if (sharedMinistry) return sharedMinistry;

  // ── Ministry list ──
  if (path === '/ministries' && method === 'GET') {
    // Anything whose scheduled time has passed goes live before the list is
    // drawn, so staff never see a page still labeled "scheduled" after the
    // moment it was meant to publish.
    await editorShared.promoteScheduledPages(env);
    const pages = await env.DB.prepare(
      `SELECT y.slug, COALESCE(p.title, y.title) AS title, y.has_posts, y.value,
              p.id AS site_page_id, p.slug AS site_slug, p.status AS page_status,
              p.in_menu, p.owner_username, p.blocks, p.published_blocks,
              p.publish_at, p.updated_at
         FROM youth_pages y
         LEFT JOIN pages p ON p.slug = '/' || y.slug
        ORDER BY y.rowid`
    ).all();
    const msg = url.searchParams.get('msg');
    let alertHtml = '';
    if (msg === 'saved')       alertHtml = `<div class="alert alert-success">✓ Page saved and published.</div>`;
    if (msg === 'metasaved')   alertHtml = `<div class="alert alert-success">✓ Ministry metadata saved.</div>`;
    if (msg === 'created')     alertHtml = `<div class="alert alert-success">✓ Ministry page created — open the editor to lay it out.</div>`;
    if (msg === 'deleted')     alertHtml = `<div class="alert alert-info">Ministry page deleted.</div>`;
    if (msg === 'postsaved')   alertHtml = `<div class="alert alert-success">✓ Post saved.</div>`;
    if (msg === 'postdeleted') alertHtml = `<div class="alert alert-info">Post deleted.</div>`;

    let countMap = {};
    try {
      const countRows = await env.DB.prepare(
        'SELECT ministry_slug, COUNT(*) as cnt FROM ministry_posts GROUP BY ministry_slug'
      ).all();
      for (const r of countRows.results) countMap[r.ministry_slug] = r.cnt;
    } catch (_) {}

    const TONE = { draft: 'warn', published: 'good', scheduled: 'auto', hidden: 'plain', missing: 'bad' };
    const LABEL = { draft: 'Draft', published: 'Published', scheduled: 'Scheduled', hidden: 'Hidden', missing: 'No site page' };

    const listRows = pages.results.map((p) => {
      const status = p.site_page_id && LABEL[p.page_status] ? p.page_status : (p.site_page_id ? 'published' : 'missing');
      const postCount = countMap[p.slug] || 0;
      const inMenu = !!p.in_menu;
      const v = valueByKey(p.value);
      const canOpen = canEditCanonical(p);
      const canManageMenu = !!p.site_page_id && hasPermission(currentUser, 'pages_edit');
      const editorHref = canOpen ? `/pages/${encodeURIComponent(p.site_page_id)}/edit` : `/ministries/meta/${encodeURIComponent(p.slug)}`;
      const warnings = [];
      if (!p.site_page_id) warnings.push('No canonical Site Editor page matches this ministry.');
      else if (!canOpen) warnings.push('The canonical page is not assigned to your account.');
      if (!p.value) warnings.push('No core value is assigned, so this ministry is missing from the values report.');

      return {
        href: editorHref,
        filter: [
          status === 'draft' ? 'draft-edits' : '',
          postCount ? 'with-posts' : '',
          inMenu ? '' : 'not-in-menu',
          p.value || '',
        ].filter(Boolean),
        search: `${p.title} ${p.slug} ${v?.short || ''} ${v?.name || ''}`.toLowerCase(),
        cells: [
          // The value chip sits beside the name, as in the design — it is a
          // property of the ministry, not a column of its own.
          `<div class="tlc-primary"><span class="tlc-primary-text">
            <span class="tlc-primary-title">${escapeHtml(p.title)}${v ? ` ${valueChip(p.value)}` : ''}</span>
            <span class="tlc-primary-sub">/ministries/${escapeHtml(p.slug)}${postCount ? ` · ${pluralise(postCount, 'post')}` : ''}</span>
          </span></div>`,
          `<a href="${escapeHtml(p.site_slug || '/' + p.slug)}" target="_blank" rel="noopener" style="color:var(--tlc-blue);text-decoration:none;">${escapeHtml(p.site_slug || '/' + p.slug)}</a>`,
          canManageMenu
            ? toggleCell(`/ministries/toggle-menu/${encodeURIComponent(p.slug)}`, inMenu, `${p.title} in the menu`)
            : `<span style="color:var(--tlc-muted);">${inMenu ? 'Yes' : 'No'}</span>`,
          statusPill(TONE[status], LABEL[status]),
        ],
        actions: rowActions(
          { label: canOpen ? 'Open Site Editor' : 'Ministry metadata', href: editorHref },
          [
            { label: 'Metadata', href: `/ministries/meta/${encodeURIComponent(p.slug)}` },
            p.has_posts ? { label: 'Posts', href: `/ministries/${encodeURIComponent(p.slug)}/posts` } : null,
            { label: 'View live', href: `https://timothystl.org/${encodeURIComponent(p.slug)}` },
          ]
        ),
        warn: warnings.join(' '),
        warnCta: warnings.length ? { label: 'Review metadata', href: `/ministries/meta/${encodeURIComponent(p.slug)}` } : null,
      };
    });

    const cfg = sectionCfg('ministries');
    return html(`
${sidebarShell('ministries', currentUser, `<a href="/pages">Open Site Editor</a>`, badges)}
<div class="tlc-wrap">
${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
${renderListSection({
  key: 'ministries',
  title: cfg.title,
  purpose: cfg.purpose,
  action: hasPermission(currentUser, 'pages_edit') ? { label: cfg.action, href: '/ministries/add' } : null,
  search: cfg.search,
  filters: filtersOf('ministries'),
  valueChips: sectionCfg('ministries').valueChips,
  columns: columnsOf('ministries'),
  rows: listRows,
  noun: 'ministry', nounPlural: 'ministries',
  empty: 'No ministry pages yet.',
  note: cfg.note,
})}
</div>`, 'Ministries Admin');
  }

  // ── Add ministry form (GET) ──
  if (path === '/ministries/add' && method === 'GET') {
    if (!hasPermission(currentUser, 'pages_edit')) return new Response('Access denied.', { status: 403 });
    return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries">← All ministries</a>`, badges)}
<div class="tlc-wrap">
<div class="page-title">New ministry page</div>
<div class="page-sub">Create a new ministry landing page.</div>
<form method="POST" action="/ministries/create">
<div class="card">
  <div class="form-group">
    <label>Slug <span style="color:#B85C3A;">*</span></label>
    <input type="text" name="slug" required placeholder="e.g. outreach (becomes the URL: /outreach)">
    <div style="font-size:12px;color:var(--gray);margin-top:4px;">Lowercase letters, numbers, and hyphens only. Cannot be changed after creation.</div>
  </div>
  <div class="form-group">
    <label>Page title <span style="color:#B85C3A;">*</span></label>
    <input type="text" name="title" required placeholder="e.g. Outreach Ministry">
  </div>
  <div class="form-group">
    <label>Enable posts <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— allows adding time-stamped posts (events, recaps, announcements)</span></label>
    <div class="checkbox-row">
      <input type="checkbox" name="has_posts" id="has_posts" value="1">
      <span onclick="document.getElementById('has_posts').click()">This ministry needs a posts feed</span>
    </div>
  </div>
</div>
<div class="btn-row">
  <button type="submit" class="btn btn-primary">Create ministry</button>
  <a href="/ministries" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
</div>
</form>
</div>`, 'New Ministry');
  }

  // ── Create ministry (POST) ──
  if (path === '/ministries/create' && method === 'POST') {
    if (!hasPermission(currentUser, 'pages_edit')) return new Response('Access denied.', { status: 403 });
    const form = await request.formData();
    const slug = (form.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const title = form.get('title') || '';
    const has_posts = form.get('has_posts') === '1' ? 1 : 0;
    if (!slug || !title) return new Response('', { status: 302, headers: { Location: '/ministries/add' } });
    const pathSlug = '/' + slug;
    const existingMinistry = await env.DB.prepare('SELECT slug FROM youth_pages WHERE slug = ?').bind(slug).first();
    const existingPage = await env.DB.prepare('SELECT id FROM pages WHERE id = ? OR slug = ?').bind(slug, pathSlug).first();
    if (existingMinistry || existingPage) {
      return new Response('', { status: 302, headers: { Location: '/ministries/add?msg=exists' } });
    }
    // Create the canonical page and its ministry metadata together. The
    // page starts as a draft outside the menu; the youth_pages row carries
    // only reporting/posts data and no longer owns a public body.
    const starter = JSON.stringify(starterBlocks(title));
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO pages (id, title, menu_label, slug, parent_id, sort, template, status, in_menu, seo_description, blocks, updated_at, updated_by) VALUES (?, ?, '', ?, 'ministries', 999, 'standard', 'draft', 0, '', ?, ?, ?)"
      ).bind(slug, title, pathSlug, starter, now, currentUser?.username || ''),
      env.DB.prepare(
        "INSERT INTO youth_pages (slug, title, content, has_posts, updated_at, blocks, published_blocks, page_status, change_log) VALUES (?, ?, '', ?, ?, '[]', '[]', 'retired', '[]')"
      ).bind(slug, title, has_posts, now),
    ]);
    await logAudit(env.DB, currentUser, 'create', 'page', slug, title, null, { slug: pathSlug, ministry_metadata: true });
    return new Response('', { status: 302, headers: { Location: `/pages/${encodeURIComponent(slug)}/edit?tab=page` } });
  }

  // Metadata that is still genuinely read outside the canonical page
  // body: the core-value report and whether this ministry owns a posts
  // feed. All visual copy, images, buttons, menu placement and publishing
  // now belong to pages, so they are intentionally absent here.
  if (path.startsWith('/ministries/meta/') && method === 'GET') {
    const slug = decodeURIComponent(path.slice('/ministries/meta/'.length));
    const ministry = await env.DB.prepare('SELECT slug, title, value, has_posts FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!ministry) return new Response('Not found', { status: 404 });
    const canonical = await canonicalPageFor(slug);
    const title = canonical?.title || ministry.title || slug;
    const editorLink = canEditCanonical(canonical)
      ? `<a class="btn btn-sm btn-secondary" href="/pages/${encodeURIComponent(canonical.id)}/edit">Open Site Editor</a>`
      : '';
    return html(`
${sidebarShell('ministries', currentUser, '<a href="/ministries">← All ministries</a>', badges)}
<div class="tlc-wrap">
<div class="page-title">${escapeHtml(title)}</div>
<div class="page-sub">Ministry reporting and posts metadata.</div>
<div class="alert alert-info"><strong>Page content is managed in the Site Editor.</strong> This screen changes only the two ministry-specific settings below. Retired body, image, video and button fields remain preserved in the database but cannot be edited here.</div>
<div class="card">
<form method="POST" action="/ministries/update/${encodeURIComponent(slug)}">
  <div class="form-group">
    <label>Core value <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px;">— used by the values report and public values page</span></label>
    ${valueChips('value', ministry.value)}
  </div>
  <div class="form-group">
    <input type="hidden" name="has_posts" value="0">
    <div class="checkbox-row">
      <input type="checkbox" name="has_posts" value="1" id="has_posts" ${ministry.has_posts ? 'checked' : ''}>
      <span><label for="has_posts" style="display:inline;text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;">This ministry has a posts feed</label></span>
    </div>
  </div>
  <div class="btn-row">
    <button type="submit" class="btn btn-primary">Save metadata</button>
    ${editorLink}
    <a href="/ministries" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
  </div>
</form>
</div>
</div>`, `Ministry metadata — ${title}`);
  }

  // Keep old bookmarks working, but never serve the orphaned TinyMCE form.
  if (path.startsWith('/ministries/edit/') && method === 'GET') {
    const slug = decodeURIComponent(path.slice('/ministries/edit/'.length));
    return new Response('', { status: 302, headers: { Location: `/ministries/meta/${encodeURIComponent(slug)}` } });
  }

  // ── Save ministry page (POST) ──
  if (path.startsWith('/ministries/update/') && method === 'POST') {
    const slug = decodeURIComponent(path.slice('/ministries/update/'.length));
    const form = await request.formData();
    // normalizeValue() is the guard on the write path: a stale tab or a
    // hand-rolled POST cannot put 'Grow' in the column where every reader
    // expects 'education'.
    const value = normalizeValue(form.get('value'));
    const hasPosts = form.get('has_posts') === '1' ? 1 : 0;
    const now = new Date().toISOString();
    const beforePage = await env.DB.prepare('SELECT title, value, has_posts FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!beforePage) return new Response('Not found', { status: 404 });
    await env.DB.prepare(
      'UPDATE youth_pages SET value = ?, has_posts = ?, updated_at = ? WHERE slug = ?'
    ).bind(value, hasPosts, now, slug).run();
    await logAudit(env.DB, currentUser, 'update', 'ministry_metadata', slug, beforePage.title || slug,
      { value: beforePage.value, has_posts: beforePage.has_posts }, { value, has_posts: hasPosts });
    return new Response('', { status: 302, headers: { Location: '/ministries?msg=metasaved' } });
  }

  // Menu placement belongs to the canonical page and therefore requires
  // the full website-pages permission, same as the Menu screen itself.
  if (path.startsWith('/ministries/toggle-menu/') && method === 'POST') {
    if (!hasPermission(currentUser, 'pages_edit')) return new Response('Access denied.', { status: 403 });
    const slug = decodeURIComponent(path.slice('/ministries/toggle-menu/'.length));
    const form = await request.formData();
    const next = form.get('value') === '1' ? 1 : 0;
    const before = await canonicalPageFor(slug);
    if (!before) return new Response('No canonical site page.', { status: 404 });
    await env.DB.prepare('UPDATE pages SET in_menu = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .bind(next, new Date().toISOString(), currentUser?.username || '', before.id).run();
    await logAudit(env.DB, currentUser, 'update', 'page', before.id, before.title || slug,
      { in_menu: before?.in_menu }, { in_menu: next });
    return new Response('', { status: 302, headers: { Location: '/ministries' } });
  }

  // ── Delete ministry page (POST) — non-core only ──
  if (path.startsWith('/ministries/delete/') && method === 'POST') {
    const slug = path.slice('/ministries/delete/'.length);
    if (CORE_SLUGS.includes(slug)) {
      return new Response('Cannot delete a built-in ministry page.', { status: 403 });
    }
    return new Response('Delete the canonical page from the Site Editor. Ministry metadata is preserved until its page lifecycle is consolidated.', { status: 409 });
  }

  // ── Posts list ──
  if (path.match(/^\/ministries\/[^/]+\/posts$/) && method === 'GET') {
    const slug = path.split('/')[2];
    const page = await env.DB.prepare('SELECT title FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!page) return new Response('Not found', { status: 404 });
    const posts = await env.DB.prepare(
      'SELECT id, title, post_date, event_date, expire_date, pinned, created_at FROM ministry_posts WHERE ministry_slug = ? ORDER BY pinned DESC, COALESCE(event_date, post_date) ASC, id ASC'
    ).bind(slug).all();
    const msg = url.searchParams.get('msg');
    const today = churchDate();
    const base = `/ministries/${encodeURIComponent(slug)}/posts`;

    // Task 15 #1. This was the last hand-rolled table in the admin — its own
    // .ni-row markup, its own badges, its own empty state. It is a config
    // now, so it inherits search, the filter pills, the scoped count label,
    // the two empty states and the warning rows from the shared pattern.
    const rows = posts.results.map((p) => {
      const when = p.event_date || p.post_date;
      const upcoming = when && when >= today;
      const expired = p.expire_date && p.expire_date < today;
      // Expired outranks everything: a post the site is no longer showing
      // should not read "Upcoming" because its event date has not passed.
      const status = expired ? statusPill('plain', 'Expired')
        : upcoming ? statusPill('good', 'Upcoming')
        : statusPill('auto', 'Past');
      return {
        href: `${base}/edit/${p.id}`,
        filter: [
          expired ? 'expired' : (upcoming ? 'upcoming' : 'past'),
          p.pinned ? 'pinned' : '',
        ].filter(Boolean),
        search: `${p.title} ${when || ''}`.toLowerCase(),
        cells: [
          // The pin marker leads the title, as on News: its job is to
          // explain why a row is at the top, not to help you find it.
          primaryCell((p.pinned ? '⌖ ' : '') + p.title, p.event_date ? 'Event' : 'Posted'),
          escapeHtml(when || '—'),
          escapeHtml(p.expire_date || 'Never'),
          status,
        ],
        // A post with no expiry never comes down on its own, which is the
        // one way a ministry page goes stale without anybody noticing.
        warn: p.expire_date ? '' : 'This post has no expiry date, so it stays on the page until somebody deletes it by hand.',
        warnCta: p.expire_date ? null : { label: 'Set one', href: `${base}/edit/${p.id}` },
      };
    });

    const section = renderListSection({
      key: 'ministryPosts',
      ...SECTIONS.ministryPosts,
      title: `${page.title} — posts`,
      action: { label: SECTIONS.ministryPosts.action, href: `${base}/new` },
      filters: filtersOf('ministryPosts'),
      columns: columnsOf('ministryPosts'),
      rows,
      noun: 'post', nounPlural: 'posts',
      empty: 'No posts on this page yet.',
    });

    return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries">← All ministries</a> <a href="/ministries/meta/${encodeURIComponent(slug)}">${escapeHtml(page.title)} metadata</a>`, badges)}
<div class="tlc-wrap">
${msg === 'postsaved' ? `<div class="alert alert-success">Post saved — it is on the ${escapeHtml(page.title)} page now.</div>` : ''}
${msg === 'postdeleted' ? `<div class="alert alert-info">Post deleted.</div>` : ''}
${section}
</div>`, `${page.title} posts`);
  }

  // ── New post form (GET) ──
  if (path.match(/^\/ministries\/[^/]+\/posts\/new$/) && method === 'GET') {
    const slug = path.split('/')[2];
    const page = await env.DB.prepare('SELECT title FROM youth_pages WHERE slug = ?').bind(slug).first();
    if (!page) return new Response('Not found', { status: 404 });
    const today = churchDate();
    return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries/${slug}/posts">← Posts</a>`, badges)}
<div class="tlc-wrap">
<div class="page-title">New post — ${page.title}</div>
<div class="page-sub">A dated update on this ministry's own page — a recap, a photo, a change of plan. It appears above the page's standing content.</div>
<form method="POST" action="/ministries/${slug}/posts/create">
<div class="card">
  <div class="form-group">
    <label>Title <span style="color:#B85C3A;">*</span></label>
    <input type="text" name="title" required placeholder="e.g. Summer Servant Event 2026">
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
    <div class="form-group" style="margin:0;">
      <label>Publish date</label>
      <input type="date" name="post_date" value="${today}">
    </div>
    <div class="form-group" style="margin:0;">
      <label>Event date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional</span></label>
      <input type="date" name="event_date">
    </div>
    <div class="form-group" style="margin:0;">
      <label>Expire date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— auto-hides</span></label>
      <input type="date" name="expire_date">
    </div>
  </div>
  <div class="form-group" style="margin-top:14px;">
    <label>Pin to top</label>
    <div class="checkbox-row">
      <input type="checkbox" name="pinned" id="pinned_post" value="1">
      <span onclick="document.getElementById('pinned_post').click()">Show this post above all others</span>
    </div>
  </div>
  ${tinymcePostSection()}
</div>
<div class="btn-row">
  <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save &amp; Publish</button>
  <a href="/ministries/${slug}/posts" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
</div>
</form>
</div>`, `New Post — ${page.title}`, TINYMCE_HEAD);
  }

  // ── Create post (POST) ──
  if (path.match(/^\/ministries\/[^/]+\/posts\/create$/) && method === 'POST') {
    const slug = path.split('/')[2];
    const form = await request.formData();
    const title = form.get('title') || '';
    const post_date = form.get('post_date') || churchDate();
    const event_date = form.get('event_date') || null;
    const expire_date = form.get('expire_date') || null;
    const body = sanitizeClassicRich(form.get('body') || '');   // FX-04
    // A toggle posts a hidden 0 ahead of its checkbox, so get() always sees
  // the 0. getAll() is the only reading that is true when it is really on.
  const pinned = form.getAll('pinned').includes('1') ? 1 : 0;
    const newPostResult = await env.DB.prepare(
      'INSERT INTO ministry_posts (ministry_slug, title, post_date, event_date, expire_date, body, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(slug, title, post_date, event_date, expire_date, body, pinned).run();
    await logAudit(env.DB, currentUser, 'create', 'ministry_post', newPostResult.meta.last_row_id, title, null, { title, post_date, event_date, expire_date, ministry_slug: slug });
    return new Response('', { status: 302, headers: { Location: `/ministries/${slug}/posts?msg=postsaved` } });
  }

  // ── Edit post form (GET) ──
  if (path.match(/^\/ministries\/[^/]+\/posts\/edit\/[^/]+$/) && method === 'GET') {
    const parts = path.split('/');
    const slug = parts[2];
    const id = parts[5];
    const page = await env.DB.prepare('SELECT title FROM youth_pages WHERE slug = ?').bind(slug).first();
    const post = await env.DB.prepare('SELECT * FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).first();
    if (!post || !page) return new Response('Not found', { status: 404 });
    return html(`
${sidebarShell('ministries', currentUser, `<a href="/ministries/${slug}/posts">← Posts</a>`, badges)}
<div class="tlc-wrap">
<div class="page-title">Edit post — ${page.title}</div>
<div class="page-sub">Changes reach the ministry page as soon as you save.</div>
<form method="POST" action="/ministries/${slug}/posts/update/${id}">
<div class="card">
  <div class="form-group">
    <label>Title <span style="color:#B85C3A;">*</span></label>
    <input type="text" name="title" required value="${(post.title || '').replace(/"/g, '&quot;')}">
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">
    <div class="form-group" style="margin:0;">
      <label>Publish date</label>
      <input type="date" name="post_date" value="${post.post_date || ''}">
    </div>
    <div class="form-group" style="margin:0;">
      <label>Event date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— optional</span></label>
      <input type="date" name="event_date" value="${post.event_date || ''}">
    </div>
    <div class="form-group" style="margin:0;">
      <label>Expire date <span style="font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;">— auto-hides</span></label>
      <input type="date" name="expire_date" value="${post.expire_date || ''}">
    </div>
  </div>
  <div class="form-group" style="margin-top:14px;">
    <label>Pin to top</label>
    <div class="checkbox-row">
      <input type="checkbox" name="pinned" id="pinned_post" value="1"${post.pinned ? ' checked' : ''}>
      <span onclick="document.getElementById('pinned_post').click()">Show this post above all others</span>
    </div>
  </div>
  ${tinymcePostSection(post.body || '')}
</div>
<div class="btn-row">
  <button type="submit" class="btn btn-primary" style="font-size:15px;padding:14px 32px;">Save changes</button>
  <a href="/ministries/${slug}/posts" class="btn btn-sm" style="background:var(--linen);color:var(--charcoal);border:1px solid var(--border);">Cancel</a>
</div>
</form>
</div>`, `Edit Post — ${page.title}`, TINYMCE_HEAD);
  }

  // ── Update post (POST) ──
  if (path.match(/^\/ministries\/[^/]+\/posts\/update\/[^/]+$/) && method === 'POST') {
    const parts = path.split('/');
    const slug = parts[2];
    const id = parts[5];
    const form = await request.formData();
    const title = form.get('title') || '';
    const post_date = form.get('post_date') || '';
    const event_date = form.get('event_date') || null;
    const expire_date = form.get('expire_date') || null;
    const body = sanitizeClassicRich(form.get('body') || '');   // FX-04
    // A toggle posts a hidden 0 ahead of its checkbox, so get() always sees
  // the 0. getAll() is the only reading that is true when it is really on.
  const pinned = form.getAll('pinned').includes('1') ? 1 : 0;
    const beforePost = await env.DB.prepare('SELECT title, post_date, event_date, expire_date, body, pinned FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).first();
    await env.DB.prepare(
      'UPDATE ministry_posts SET title = ?, post_date = ?, event_date = ?, expire_date = ?, body = ?, pinned = ? WHERE id = ? AND ministry_slug = ?'
    ).bind(title, post_date, event_date, expire_date, body, pinned, id, slug).run();
    await logAudit(env.DB, currentUser, 'update', 'ministry_post', id, title, beforePost ? { ...beforePost, body: (beforePost.body || '').substring(0, 200) } : null, { title, post_date, event_date, expire_date, pinned });
    return new Response('', { status: 302, headers: { Location: `/ministries/${slug}/posts?msg=postsaved` } });
  }

  // ── Delete post (POST) ──
  if (path.match(/^\/ministries\/[^/]+\/posts\/delete\/[^/]+$/) && method === 'POST') {
    const parts = path.split('/');
    const slug = parts[2];
    const id = parts[5];
    const delPost = await env.DB.prepare('SELECT title FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).first();
    await env.DB.prepare('DELETE FROM ministry_posts WHERE id = ? AND ministry_slug = ?').bind(id, slug).run();
    await logAudit(env.DB, currentUser, 'delete', 'ministry_post', id, delPost ? delPost.title : id, delPost, null);
    return new Response('', { status: 302, headers: { Location: `/ministries/${slug}/posts?msg=postdeleted` } });
  }

  return null;
}
