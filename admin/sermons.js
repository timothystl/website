// ── SERMONS ADMIN ─────────────────────────────────────────────
// The sermon series/notes CRUD screen (moved out of tlc-admin-worker.js's own
// if-chain — see handleSermonsRoutes below). This is a different concern from
// admin/sermons-feed.js, which parses the auto-fetched YouTube "latest worship
// service" feed for the public /sermons page and has no admin screen of its own.

import { hasPermission } from './auth.js';
import { html, sidebarShell, escapeHtml, tinymceSermonSection } from './helpers.js';
import { TINYMCE_HEAD } from './db.js';
import { renderFormSection, renderListSection, statusPill, primaryCell, pluralise } from './ui.js';
import { sanitizeClassicRich } from './blocks.js';
import { section as sectionCfg, columnsOf, filtersOf } from './sections.js';

// ── ROUTES ───────────────────────────────────────────────────
// The two forms (series, sermon) built once through the shared form renderer,
// and the list that groups notes under their series.
export async function handleSermonsRoutes(request, env, path, method, currentUser, url, badges = {}) {
  if (!path.startsWith('/sermons')) return null;
  if (!hasPermission(currentUser, 'sermons_edit')) {
    return new Response('Access denied.', { status: 403 });
  }
  if (path === '/sermons' && method === 'GET') {
    const alertHtml = url.searchParams.get('saved') ? `<div class="alert alert-success">✓ Saved.</div>` : '';
    const [series, notes] = await Promise.all([
      env.DB.prepare('SELECT * FROM sermon_series ORDER BY active DESC, sort_order ASC, id DESC').all(),
      env.DB.prepare('SELECT * FROM sermon_notes ORDER BY COALESCE(date, \'\') DESC, id DESC').all(),
    ]);
    const bySeries = {};
    const standalone = [];
    for (const n of notes.results) {
      if (n.series_id) (bySeries[n.series_id] = bySeries[n.series_id] || []).push(n);
      else standalone.push(n);
    }

    // The library has no recordings attached yet, and the site is built to
    // cope: a sermon with a link gets a play thumbnail, one without gets a
    // text-only card. Nothing here needs a setting — the row reports which
    // state each sermon is in so it is obvious what is missing.
    // The design's three words: YouTube / Audio / Text only. "Text only" is
    // deliberately not a warning — a sermon with no recording is a perfectly
    // good text card on the site, and adding a link later upgrades it with
    // no other edit. Calling it "No recording" in amber made a normal state
    // look like a fault.
    const mediaCell = (n) => {
      const kinds = [];
      if (n.youtube_url) kinds.push('YouTube');
      if (n.audio_url) kinds.push('Audio');
      return kinds.length ? statusPill('good', kinds.join(' + ')) : statusPill('plain', 'Text only');
    };

    const rows = [];
    for (const s of series.results) {
      const kids = bySeries[s.id] || [];
      const withMedia = kids.filter((n) => n.youtube_url || n.audio_url).length;
      rows.push({
        href: `/sermons/edit-series/${s.id}`,
        filter: ['series', s.active ? 'active-series' : ''].filter(Boolean),
        search: `${s.title} ${s.date_range || ''}`.toLowerCase(),
        cells: [
          primaryCell(s.title, s.date_range || pluralise(kids.length, 'sermon')),
          escapeHtml(s.date_range || '—'),
          '',
          s.active ? statusPill('good', 'Active series') : (s.playlist_url ? statusPill('plain', 'Playlist') : statusPill('plain', pluralise(kids.length, 'sermon'))),
        ],
        actions: `<a class="tlc-edit" href="/sermons/new-note?series_id=${s.id}">+ Sermon</a><a class="tlc-edit" href="/sermons/edit-series/${s.id}">Edit</a>`,
      });
      for (const n of kids) {
        rows.push({
          child: true,
          href: `/sermons/edit-note/${n.id}`,
          filter: (n.youtube_url || n.audio_url) ? [] : ['missing-media'],
          search: `${n.title || ''} ${n.scripture || ''} ${s.title}`.toLowerCase(),
          cells: [
            primaryCell(n.title || '(untitled)', s.title),
            escapeHtml(n.date || '—'),
            escapeHtml(n.scripture || '—'),
            mediaCell(n),
          ],
        });
      }
    }
    for (const n of standalone) {
      rows.push({
        href: `/sermons/edit-note/${n.id}`,
        filter: (n.youtube_url || n.audio_url) ? [] : ['missing-media'],
        search: `${n.title || ''} ${n.scripture || ''}`.toLowerCase(),
        cells: [
          primaryCell(n.title || '(untitled)', 'Not part of a series'),
          escapeHtml(n.date || '—'),
          escapeHtml(n.scripture || '—'),
          mediaCell(n),
        ],
      });
    }

    return html(`
${sidebarShell('sermons', currentUser, `<a href="https://timothystl.org/sermons" target="_blank">View page</a>`, badges)}
<div class="tlc-wrap">
${alertHtml ? `<div class="tlc-section" style="padding-bottom:0;">${alertHtml}</div>` : ''}
${renderListSection({
  key: 'sermons',
  title: sectionCfg('sermons').title,
  purpose: sectionCfg('sermons').purpose,
  action: { label: sectionCfg('sermons').action, href: '/sermons/new-series' },
  // Beside the primary button rather than up in the topbar. A sermon with no
  // series is a real thing to add, and putting it next to the sign-out link
  // made it look like part of the chrome rather than part of this screen.
  altActions: [{ label: '+ Standalone sermon', href: '/sermons/new-note' }],
  search: sectionCfg('sermons').search,
  filters: filtersOf('sermons'),
  columns: columnsOf('sermons'),
  rows,
  noun: 'entry', nounPlural: 'entries',
  empty: 'No series or sermons yet.',
  note: sectionCfg('sermons').note,
})}
</div>`, 'Sermons Admin');
  }

  // ── SERMONS: THE TWO FORMS, ONCE EACH ──
  // Series and sermons each had a New and an Edit that were the same fields
  // twice, on the old chrome. One builder apiece, through the shared renderer.
  const seriesFormHtml = (r = null) => renderFormSection({
    title: r ? (r.title || 'Edit series') : 'New series',
    purpose: r
      ? 'The series and its date range, as they read on the sermons page.'
      : 'A run of sermons under one heading. Add the sermons themselves once it exists.',
    action: r ? `/sermons/edit-series/${r.id}` : '/sermons/new-series',
    cancelHref: '/sermons',
    saveLabel: r ? 'Save changes' : 'Create series',
    deleteAction: r ? `/sermons/delete-series/${r.id}` : '',
    deleteConfirm: r ? `Delete “${r.title}” and every sermon in it? This cannot be undone.` : '',
    deleteLabel: 'Delete series',
    fields: [
      { name: 'title', label: 'Series title', value: r ? r.title : '', required: true, placeholder: 'The Shepherd’s Way' },
      { kind: 'textarea', name: 'description', label: 'Description', rows: 3, value: r ? (r.description || '') : '',
        placeholder: 'What the series is about.' },
      { name: 'date_range', label: 'Date range', value: r ? (r.date_range || '') : '', placeholder: 'Lent 2026 · March–April',
        hint: 'Free text — it is read, not sorted on.' },
      { name: 'playlist_url', type: 'url', label: 'YouTube playlist', value: r ? (r.playlist_url || '') : '',
        placeholder: 'https://www.youtube.com/playlist?list=…', hint: 'Optional.' },
      { kind: 'toggle', name: 'active', label: 'The current series', value: r ? !!r.active : false,
        on: 'Current', off: 'Past series',
        hint: 'One series at a time is the current one. Turning this on turns it off everywhere else.' },
    ],
  });

  const noteFormHtml = (n, seriesRows, presetSeries = '') => {
    const isNew = !n;
    const back = (n && n.series_id) || presetSeries ? `/sermons/notes/${(n && n.series_id) || presetSeries}` : '/sermons';
    return renderFormSection({
      title: isNew ? 'New sermon' : n.title || 'Edit sermon',
      purpose: 'A sermon with no recording is a good text card on the site. Adding a link later upgrades it with no other edit.',
      action: isNew ? '/sermons/new-note' : `/sermons/edit-note/${n.id}`,
      cancelHref: back,
      saveLabel: isNew ? 'Add sermon' : 'Save changes',
      deleteAction: isNew ? '' : `/sermons/delete-note/${n.id}`,
      deleteConfirm: `Delete “${(n && n.title) || 'this sermon'}”?`,
      deleteLabel: 'Delete sermon',
      wide: true,
      fields: [
        { kind: 'choice', name: 'series_id', label: 'Series',
          value: String((n && n.series_id) || presetSeries || ''),
          options: [{ value: '', label: '— Standalone sermon —' }]
            .concat(seriesRows.map((x) => ({ value: String(x.id), label: x.title }))),
          hint: 'A standalone sermon stands on its own on the sermons page.' },
        { kind: 'date', name: 'date', label: 'Date', value: n ? (n.date || '') : '' },
        { name: 'title', label: 'Sermon title', value: n ? n.title : '', required: true, placeholder: 'You prepare a table before me' },
        { name: 'scripture', label: 'Scripture', value: n ? (n.scripture || '') : '', placeholder: 'Psalm 23:5' },
        { kind: 'html', html: tinymceSermonSection(n ? n.outline : '') },
        { name: 'youtube_url', type: 'url', label: 'YouTube link', value: n ? (n.youtube_url || '') : '',
          placeholder: 'https://…', hint: 'Optional. With one, the card gains a play button.' },
      ],
    });
  };

  if (path === '/sermons/new-series' && method === 'GET') {
    return html(`
${sidebarShell('sermons', currentUser, `<a href="/sermons">All sermons</a>`, badges)}
<div class="tlc-wrap">${seriesFormHtml()}</div>`, 'New series — TLC Admin');
  }

  if (path === '/sermons/new-series' && method === 'POST') {
    const form = await request.formData();
    const title = (form.get('title') || '').trim();
    if (!title) return new Response('', { status: 302, headers: { Location: '/sermons' } });
    const active = form.getAll('active').includes('1') ? 1 : 0;
    if (active) await env.DB.prepare('UPDATE sermon_series SET active = 0').run();
    await env.DB.prepare('INSERT INTO sermon_series (title, description, date_range, playlist_url, active) VALUES (?, ?, ?, ?, ?)')
      .bind(title, form.get('description') || '', form.get('date_range') || '', form.get('playlist_url') || '', active).run();
    return new Response('', { status: 302, headers: { Location: '/sermons?saved=1' } });
  }

  if (path.startsWith('/sermons/edit-series/') && method === 'GET') {
    const id = path.split('/').pop();
    const s = await env.DB.prepare('SELECT * FROM sermon_series WHERE id = ?').bind(id).first();
    if (!s) return new Response('Not found', { status: 404 });
    return html(`
${sidebarShell('sermons', currentUser, `<a href="/sermons/notes/${id}">Sermons in this series</a>`, badges)}
<div class="tlc-wrap">${seriesFormHtml(s)}</div>`, 'Edit series — TLC Admin');
  }

  if (path.startsWith('/sermons/edit-series/') && method === 'POST') {
    const id = path.split('/').pop();
    const form = await request.formData();
    const title = (form.get('title') || '').trim();
    const active = form.getAll('active').includes('1') ? 1 : 0;
    if (active) await env.DB.prepare('UPDATE sermon_series SET active = 0').run();
    await env.DB.prepare('UPDATE sermon_series SET title=?, description=?, date_range=?, playlist_url=?, active=? WHERE id=?')
      .bind(title, form.get('description') || '', form.get('date_range') || '', form.get('playlist_url') || '', active, id).run();
    return new Response('', { status: 302, headers: { Location: '/sermons?saved=1' } });
  }

  if (path.startsWith('/sermons/delete-series/') && method === 'POST') {
    const id = path.split('/').pop();
    await env.DB.prepare('DELETE FROM sermon_notes WHERE series_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM sermon_series WHERE id = ?').bind(id).run();
    return new Response('', { status: 302, headers: { Location: '/sermons' } });
  }

  if (path.startsWith('/sermons/notes/') && method === 'GET') {
    const seriesId = path.split('/').pop();
    const s = await env.DB.prepare('SELECT * FROM sermon_series WHERE id = ?').bind(seriesId).first();
    if (!s) return new Response('Not found', { status: 404 });
    const notes = await env.DB.prepare('SELECT * FROM sermon_notes WHERE series_id = ? ORDER BY date DESC, id DESC').bind(seriesId).all();
    const notesHtml = notes.results.length === 0
      ? `<div style="text-align:center;padding:24px;color:var(--gray);font-size:14px;">No sermons in this series yet.</div>`
      : notes.results.map(n => `
<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
<div style="flex:1;">
  ${n.date ? `<div style="font-size:11px;font-weight:700;color:var(--gray);text-transform:uppercase;letter-spacing:.06em;">${n.date}</div>` : ''}
  <div style="font-family:var(--serif);font-size:16px;color:var(--steel);">${n.title}</div>
  ${n.scripture ? `<div style="font-size:12px;color:var(--gray);">${n.scripture}</div>` : ''}
</div>
<div style="display:flex;gap:8px;">
  <a href="/sermons/edit-note/${n.id}" class="btn btn-sm btn-secondary">Edit</a>
  <form method="POST" action="/sermons/delete-note/${n.id}" style="display:contents;" onsubmit="return confirm('Delete this sermon?')">
    <button type="submit" class="btn btn-sm btn-danger">Delete</button>
  </form>
</div>
</div>`).join('');
    return html(`
${sidebarShell('sermons', currentUser, `<a href="/sermons">← All series</a>`, badges)}
<div class="tlc-wrap">
<div class="page-title">${s.title}</div>
<div class="page-sub">${s.date_range || 'Sermons in this series'}</div>
<div class="btn-row" style="margin-bottom:20px;">
  <a href="/sermons/new-note?series_id=${seriesId}" class="btn btn-primary">+ Add sermon</a>
  <a href="/sermons/edit-series/${seriesId}" class="btn btn-secondary">Edit series</a>
</div>
<div class="card"><div class="card-title">Sermons in this series</div>${notesHtml}</div>
</div>`, 'Sermon Series');
  }

  if (path === '/sermons/new-note' && method === 'GET') {
    const seriesId = url.searchParams.get('series_id') || '';
    const allSeries = await env.DB.prepare('SELECT id, title FROM sermon_series ORDER BY active DESC, id DESC').all();
    return html(`
${sidebarShell('sermons', currentUser, `<a href="${seriesId ? '/sermons/notes/' + seriesId : '/sermons'}">All sermons</a>`, badges)}
<div class="tlc-wrap">${noteFormHtml(null, allSeries.results, seriesId)}</div>`, 'New sermon — TLC Admin', TINYMCE_HEAD);
  }

  if (path === '/sermons/new-note' && method === 'POST') {
    const form = await request.formData();
    const title = (form.get('title') || '').trim();
    if (!title) return new Response('', { status: 302, headers: { Location: '/sermons' } });
    const seriesId = form.get('series_id') || null;
    await env.DB.prepare('INSERT INTO sermon_notes (series_id, date, title, scripture, outline, youtube_url) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(seriesId || null, form.get('date') || null, title, form.get('scripture') || '',
            sanitizeClassicRich(form.get('outline') || ''), form.get('youtube_url') || '').run();   // FX-04
    const redir = seriesId ? `/sermons/notes/${seriesId}` : '/sermons';
    return new Response('', { status: 302, headers: { Location: redir + '?saved=1' } });
  }

  if (path.startsWith('/sermons/edit-note/') && method === 'GET') {
    const id = path.split('/').pop();
    const n = await env.DB.prepare('SELECT * FROM sermon_notes WHERE id = ?').bind(id).first();
    if (!n) return new Response('Not found', { status: 404 });
    const allSeries = await env.DB.prepare('SELECT id, title FROM sermon_series ORDER BY active DESC, id DESC').all();
    return html(`
${sidebarShell('sermons', currentUser, `<a href="${n.series_id ? '/sermons/notes/' + n.series_id : '/sermons'}">All sermons</a>`, badges)}
<div class="tlc-wrap">${noteFormHtml(n, allSeries.results)}</div>`, 'Edit sermon — TLC Admin', TINYMCE_HEAD);
  }

  if (path.startsWith('/sermons/edit-note/') && method === 'POST') {
    const id = path.split('/').pop();
    const form = await request.formData();
    const title = (form.get('title') || '').trim();
    const seriesId = form.get('series_id') || null;
    await env.DB.prepare('UPDATE sermon_notes SET series_id=?, date=?, title=?, scripture=?, outline=?, youtube_url=? WHERE id=?')
      .bind(seriesId || null, form.get('date') || null, title, form.get('scripture') || '',
            sanitizeClassicRich(form.get('outline') || ''), form.get('youtube_url') || '', id).run();   // FX-04
    const redir = seriesId ? `/sermons/notes/${seriesId}` : '/sermons';
    return new Response('', { status: 302, headers: { Location: redir + '?saved=1' } });
  }

  if (path.startsWith('/sermons/delete-note/') && method === 'POST') {
    const id = path.split('/').pop();
    const n = await env.DB.prepare('SELECT series_id FROM sermon_notes WHERE id = ?').bind(id).first();
    await env.DB.prepare('DELETE FROM sermon_notes WHERE id = ?').bind(id).run();
    const redir = n && n.series_id ? `/sermons/notes/${n.series_id}` : '/sermons';
    return new Response('', { status: 302, headers: { Location: redir } });
  }
}
