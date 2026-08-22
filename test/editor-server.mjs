// Local stand-in for the admin Worker, just enough to run the ministry page
// editor in a real browser without Cloudflare or D1.
//
// It calls the SAME functions the Worker calls (admin/blocks.js) for rendering
// and sanitizing, so the interesting logic is genuinely under test; only the
// routing and SQL are re-implemented here. Keep the endpoint contracts in step
// with the `/ministries/api/...` routes in tlc-admin-worker.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderPage, sanitizeBlocks, parseBlocks, blocksClientConfig, editorPhoneCss,
  migrateLegacyPage, starterBlocks, newBlock, makeBlockId, templateOf, cleanText,
} from '../admin/blocks.js';
import { slugify, uniqueSlug, pageRename } from '../admin/pages.js';
import { LINKS_JS } from '../admin/links.js';
import { PAGE_SEEDS } from '../admin/page-seeds.js';
export { PAGE_SEEDS };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_HTML = fs.readFileSync(path.join(HERE, '..', 'admin', 'ministry-editor.html'), 'utf8');

export function createEditorServer(seed = {}) {
  const pages = new Map();
  const media = seed.media ? seed.media.slice() : [
    { id: 1, filename: 'choir-loft.jpg', kind: 'photo', url: '/images/choir-loft.jpg', thumb_url: '', alt: 'The choir loft', meta: 'JPG · 1600×1067' },
    { id: 2, filename: 'handbells-easter.jpg', kind: 'photo', url: '/images/handbells-easter.jpg', thumb_url: '', alt: 'Handbells at Easter', meta: 'JPG · 1600×1067' },
    { id: 3, filename: 'Choir at Advent Vespers', kind: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', thumb_url: '', alt: '', meta: 'YouTube · 4:12' },
  ];
  let mediaSeq = media.length;
  const uploads = [];
  const docUploads = [];
  const revisions = [];
  const sections = [];
  let sectionSeq = 0;
  // The Worker's pageData() bundle, standing in for the D1 queries. The blocks
  // read it exactly as they do in production.
  // Which role the harness is standing in for, so the browser tests can drive
  // both the office view and a ministry leader's.
  const ROLE = seed.role || 'office';
  const EDITORS = seed.editors || ['office', 'youthdirector'];
  const DATA = seed.data || {
    settings: { address_line: '6704 Fyler Ave', address_city: 'St. Louis, MO 63139', phone: '(314) 781-8673', email: 'office@timothystl.org' },
    services: [
      { day: 'Sunday', time: '8:00 am', note: 'Traditional' },
      { day: 'Sunday', time: '9:30 am', note: 'Vietnamese worship' },
      { day: 'Sunday', time: '10:45 am', note: 'Contemporary' },
    ],
    sermon: { title: 'The Good Shepherd', series: 'Psalms of Ascent', date: '2026-07-26', scripture: 'Psalm 23' },
    news: [{ title: 'Advent Lessons and Carols', date: '2026-12-08' }],
    staff: [{ name: 'Pastor Matt', title: 'Pastor' }, { name: 'Dinger', title: 'Office Manager' }],
  };

  const seedPages = seed.pages || [{ slug: 'music', title: 'Music Ministry', blocks: migrateLegacyPage({
    slug: 'music', title: 'Music Ministry',
    content: '<p>Music at Timothy is the congregation’s own voice.</p>',
    ministry_image_url: '/images/choir-loft.jpg',
    vid_1_url: 'https://youtu.be/dQw4w9WgXcQ', vid_1_title: 'Handbells',
    cta_label: 'Join the choir', cta_url: 'https://forms.gle/abc',
  }) }];
  for (const p of seedPages) {
    pages.set(p.slug, {
      slug: p.slug, title: p.title, page_status: p.status || 'live', publish_at: null,
      path: p.path || ('/' + p.slug), template: p.template || 'standard',
      parent_id: p.parent_id || null, in_menu: p.in_menu === undefined ? 1 : p.in_menu,
      seo_description: p.seo_description || '', locked: p.locked ? 1 : 0,
      owner_username: p.owner_username || '',
      blocks: JSON.stringify(sanitizeBlocks(p.blocks || starterBlocks(p.title))),
      published_blocks: JSON.stringify(sanitizeBlocks(p.blocks || [])),
      change_log: '[]', updated_at: new Date().toISOString(),
      neverLive: !!p.neverLive,
    });
  }

  // The three shapes a page row is served in, so the harness cannot quietly
  // disagree with the Worker about what the editor receives.
  const settingsOf = (r) => ({
    title: r.title, slug: r.path || ('/' + r.slug), parent_id: r.parent_id || null,
    in_menu: r.in_menu ? 1 : 0, template: templateOf(r.template).key,
    seo_description: r.seo_description || '', locked: r.locked ? 1 : 0,
    owner_username: r.owner_username || '',
  });
  const asPageRow = (r) => ({
    id: r.slug, title: r.title, menu_label: '', slug: r.path || ('/' + r.slug),
    parent_id: r.parent_id || null,
  });
  // What goes AROUND the blocks: the page's stored layout, and the pages
  // beneath it that the section layouts list. Mirrors pageLayoutContext() in
  // tlc-admin-worker.js — the Worker reads both from the database on every
  // render path, and a harness that skipped either would let the editor's own
  // canvas drift from the live page without any test noticing.
  //
  // A ministry page has no layout of its own, which is what `{}` says here.
  const layoutFor = (slug, isSitePage) => {
    const row = isSitePage ? pages.get(slug) : null;
    if (!row) return {};
    return {
      template: row.template || 'standard',
      children: Array.from(pages.values())
        .filter((r) => r.parent_id === slug)
        .map((r) => ({ id: r.slug, title: r.title, slug: r.path || ('/' + r.slug),
                       parent_id: r.parent_id || null, seo_description: r.seo_description || '' })),
    };
  };

  const asRailPage = (r) => ({
    id: r.slug, title: r.title, slug: r.path || ('/' + r.slug), parent_id: r.parent_id || null,
    in_menu: r.in_menu === undefined ? true : !!r.in_menu,
    hasDraftEdits: JSON.stringify(sanitizeBlocks(parseBlocks(r.blocks))) !== JSON.stringify(sanitizeBlocks(parseBlocks(r.published_blocks))),
  });

  const json = (res, obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) => new Promise((resolve) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let p = url.pathname;

    // The site editor is the same screen under a different address. Rewriting
    // it onto the ministry routes here is what lets one harness exercise both
    // — the editor client is the thing under test, and it is the part that has
    // to work out which API it is talking to.
    const siteEdit = p.match(/^\/pages\/([^/]+)\/edit$/);
    const isSitePage = !!siteEdit || p.startsWith('/pages/api/');
    if (siteEdit) p = '/ministries/editor/' + siteEdit[1];
    if (p.startsWith('/pages/api/')) p = '/ministries/api' + p.slice('/pages/api'.length);

    if (p.startsWith('/ministries/editor/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      // No TinyMCE in the harness (the container has no egress) — the editor
      // must degrade to plain contenteditable, which this exercises.
      //
      // ⚠ LINKS_JS is NOT optional, and leaving it out was a real hole: the
      // inspector calls tlcPickerGroups() to draw any link field, so without it
      // renderInspector() threw ReferenceError for every block type that has
      // one — card grid, button bar, link tiles, partners — and the panel read
      // "Nothing selected" beside a plainly selected block. The Worker does
      // this replacement (tlc-admin-worker.js); a harness that does not is a
      // harness that cannot see those types at all.
      return res.end(EDITOR_HTML
        .replace('/*TLCB_EDITOR_CSS*/', editorPhoneCss())
        .replace('/*TLCB_LINKS_JS*/', LINKS_JS)
        .replace('<!--TLCB_TINYMCE-->', ''));
    }

    if (p.startsWith('/ministries/api/page/')) {
      const rest = p.slice('/ministries/api/page/'.length);
      const [slugRaw, action] = rest.split('/');
      const slug = decodeURIComponent(slugRaw);
      const row = pages.get(slug);
      if (!row) return json(res, { error: 'Not found' }, 404);

      if (!action && req.method === 'GET') {
        const blocks = sanitizeBlocks(parseBlocks(row.blocks));
        return json(res, {
          page: {
            slug, title: row.title, status: row.page_status, publish_at: row.publish_at,
            updated_at: row.updated_at, blocks, changes: parseBlocks(row.change_log),
            published_count: sanitizeBlocks(parseBlocks(row.published_blocks)).length,
            path: row.path || ('/' + slug), template: row.template || 'standard',
            settings: isSitePage ? settingsOf(row) : undefined,
          },
          pages: isSitePage ? Array.from(pages.values()).map(asRailPage) : [],
          role: ROLE,
          editors: ROLE === 'office' ? EDITORS : [],
          config: blocksClientConfig(),
          // ⚠ TOP LEVEL, A SIBLING OF `page` — NOT NESTED INSIDE IT. The real
          // Worker sends it there (beside its own `hasRedesign`), and the
          // client reads `data.neverLive`, not `data.page.neverLive`. Nesting
          // this inside `page` is the exact shape-mismatch this comment
          // exists to prevent: it looked like a faithful mirror and still
          // disagreed, which is worse than sending nothing — a test written
          // against it would have passed while proving nothing about the real
          // response shape. Sourced from the fixture so a test can seed it.
          neverLive: isSitePage ? !!row.neverLive : false,
          media,
          html: renderPage(blocks, Object.assign(
            { editing: true, slug, withCss: true, data: DATA }, layoutFor(slug, isSitePage))),
        });
      }

      if ((action === 'settings' || action === 'delete') && ROLE !== 'office') {
        return json(res, { error: 'Only the office can rename, move or delete a page.' }, 403);
      }

      if (action === 'settings' && req.method === 'POST') {
        const body = await readBody(req);
        const all = Array.from(pages.values()).map(asPageRow);
        const title = cleanText(body.title, 80) || row.title;
        let slugPath = row.path;
        let redirected = false;
        if (typeof body.slug === 'string' && body.slug.trim() && body.slug.trim() !== row.path && row.path !== '/') {
          const taken = new Set(all.filter((x) => x.id !== slug).map((x) => x.slug));
          slugPath = uniqueSlug(slugify(body.slug.replace(/^\/+/, '')), taken);
          redirected = slugPath !== row.path;
        } else if (title !== row.title) {
          const r = pageRename(asPageRow(row), title, all);
          slugPath = r.slug;
          redirected = r.redirects.length > 0;
          for (const x of r.redirects) {
            if (!x.id) continue;
            const child = pages.get(x.id);
            if (child) child.path = x.to;
          }
        }
        let parentId = body.parent_id === undefined ? row.parent_id : (body.parent_id || null);
        if (parentId === slug) parentId = row.parent_id;
        const parent = parentId ? all.find((x) => x.id === parentId) : null;
        if (parentId && (!parent || parent.parent_id)) parentId = null;
        if (parentId && all.some((x) => x.parent_id === slug)) parentId = null;

        const oldTemplate = row.template || 'standard';
        row.title = title;
        row.path = slugPath;
        row.parent_id = parentId;
        row.template = body.template === undefined ? oldTemplate : templateOf(body.template).key;
        row.in_menu = body.in_menu === undefined ? row.in_menu : (body.in_menu ? 1 : 0);
        row.seo_description = body.seo_description === undefined ? (row.seo_description || '') : cleanText(body.seo_description, 300);
        row.owner_username = body.owner_username === undefined ? (row.owner_username || '') : cleanText(body.owner_username, 60);
        const rerender = row.template !== oldTemplate;
        const blocks = sanitizeBlocks(parseBlocks(row.blocks));
        return json(res, {
          ok: true,
          page: settingsOf(row),
          pages: Array.from(pages.values()).map(asRailPage),
          redirected,
          rerender,
          html: rerender ? renderPage(blocks, Object.assign(
            { editing: true, slug, withCss: true, data: DATA }, layoutFor(slug, isSitePage))) : '',
        });
      }

      if (action === 'delete' && req.method === 'POST') {
        if (row.locked) return json(res, { error: 'locked' }, 400);
        for (const r of pages.values()) if (r.parent_id === slug) r.parent_id = null;
        pages.delete(slug);
        return json(res, { ok: true });
      }

      if (action === 'draft' && req.method === 'POST') {
        const body = await readBody(req);
        const blocks = sanitizeBlocks(body.blocks);
        if (ROLE !== 'office') {
          const kept = new Set(blocks.map((b) => b.id));
          const lost = sanitizeBlocks(parseBlocks(row.blocks)).filter((b) => b.locked && !kept.has(b.id));
          if (lost.length) return json(res, { error: 'That part of the page is set by the church office and cannot be removed.' }, 403);
        }
        row.blocks = JSON.stringify(blocks);
        row.change_log = JSON.stringify(Array.isArray(body.changes) ? body.changes.slice(0, 24) : []);
        row.updated_at = new Date().toISOString();
        if (row.page_status === 'live' && JSON.stringify(sanitizeBlocks(parseBlocks(row.published_blocks))) !== JSON.stringify(blocks)) row.page_status = 'draft';
        return json(res, { ok: true, saved_at: row.updated_at, status: row.page_status, blocks });
      }

      if (action === 'publish' && req.method === 'POST') {
        const body = await readBody(req);
        const blocks = sanitizeBlocks(body.blocks || parseBlocks(row.blocks));
        revisions.push({ slug, blocks: JSON.stringify(blocks), published_at: new Date().toISOString(), published_by: 'test' });
        row.blocks = JSON.stringify(blocks);
        row.published_blocks = JSON.stringify(blocks);
        row.page_status = 'live';
        row.publish_at = null;
        row.change_log = '[]';
        row.updated_at = new Date().toISOString();
        return json(res, { ok: true, status: 'live', url: 'https://timothystl.org/' + slug, saved_at: row.updated_at });
      }

      if (action === 'unpublish' && req.method === 'POST') {
        if (row.published_blocks == null) return json(res, { error: 'This page is not published.' }, 400);
        row.published_blocks = null;
        row.page_status = 'draft';
        row.publish_at = null;
        row.updated_at = new Date().toISOString();
        return json(res, { ok: true, status: 'draft', saved_at: row.updated_at });
      }

      if (action === 'revisions' && req.method === 'GET') {
        return json(res, { revisions: revisions.filter((r) => r.slug === slug).map((r, i) => ({ id: i + 1, published_at: r.published_at, published_by: r.published_by, count: parseBlocks(r.blocks).length })).reverse() });
      }

      if (action === 'restore' && req.method === 'POST') {
        const body = await readBody(req);
        const rev = revisions.filter((r) => r.slug === slug)[Number(body.id) - 1];
        if (!rev) return json(res, { error: 'Not found' }, 404);
        const blocks = sanitizeBlocks(parseBlocks(rev.blocks));
        row.blocks = JSON.stringify(blocks);
        row.page_status = 'draft';
        return json(res, { ok: true, blocks, html: renderPage(blocks, { editing: true, slug, withCss: true, data: DATA }) });
      }

      if (action === 'schedule' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.publish_at) {
          const back = JSON.stringify(sanitizeBlocks(parseBlocks(row.blocks))) === JSON.stringify(sanitizeBlocks(parseBlocks(row.published_blocks))) ? 'live' : 'draft';
          row.publish_at = null;
          row.page_status = back;
          return json(res, { ok: true, status: back, publish_at: null });
        }
        const when = new Date(body.publish_at);
        if (isNaN(when.getTime()) || when.getTime() < Date.now() - 60000) {
          return json(res, { error: 'Pick a date and time in the future.' }, 400);
        }
        row.publish_at = when.toISOString();
        row.page_status = 'scheduled';
        return json(res, { ok: true, status: 'scheduled', publish_at: row.publish_at });
      }
      return json(res, { error: 'Not found' }, 404);
    }

    if (p === '/ministries/api/new-block' && req.method === 'POST') {
      const body = await readBody(req);
      const block = newBlock(String(body.type || ''));
      if (!block) return json(res, { error: 'Unknown block type' }, 400);
      return json(res, { block });
    }

    if (p === '/ministries/api/render' && req.method === 'POST') {
      const body = await readBody(req);
      const blocks = sanitizeBlocks(body.blocks);
      const slug = String(body.slug || '');
      // ⚠ The layout comes from the stored page, never from the request — same
      // rule as the Worker's own /render. Leaving it out here is what let the
      // real bug through unnoticed: a redraw with no template renders as a bare
      // column, so every structural change silently took the sidebar off a page
      // that has one. A harness that shares the bug cannot catch it.
      return json(res, {
        html: renderPage(blocks, Object.assign(
          { editing: true, slug, withCss: true, data: DATA }, layoutFor(slug, isSitePage))),
        blocks,
      });
    }

    // Mirrors promoteScheduledPages() in tlc-admin-worker.js, which the cron
    // trigger calls. Exercised by the tests in place of an actual cron tick.
    if (p === '/__promote-scheduled' && req.method === 'POST') {
      const nowIso = new Date().toISOString();
      let promoted = 0;
      for (const [slug, r] of pages) {
        if (r.page_status !== 'scheduled' || !r.publish_at || r.publish_at > nowIso) continue;
        const blocks = JSON.stringify(sanitizeBlocks(parseBlocks(r.blocks)));
        r.published_blocks = blocks;
        r.page_status = 'live';
        r.publish_at = null;
        r.change_log = '[]';
        r.updated_at = nowIso;
        revisions.push({ slug, blocks, published_at: nowIso, published_by: 'scheduled' });
        promoted += 1;
      }
      return json(res, { promoted });
    }

    if (p === '/ministries/api/sections' && req.method === 'GET') {
      return json(res, { sections: sections.map((x) => ({ id: x.id, name: x.name, created_by: x.created_by, count: parseBlocks(x.blocks).length })) });
    }
    if (p === '/ministries/api/sections' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 60);
      const blocks = sanitizeBlocks(body.blocks);
      if (!name) return json(res, { error: 'Give the section a name.' }, 400);
      if (!blocks.length) return json(res, { error: 'There is nothing to save.' }, 400);
      const row = { id: ++sectionSeq, name, blocks: JSON.stringify(blocks), created_by: 'test' };
      sections.push(row);
      sections.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, { ok: true, section: { id: row.id, name, count: blocks.length } });
    }
    if (/^\/ministries\/api\/sections\/\d+$/.test(p) && req.method === 'GET') {
      const row = sections.find((x) => x.id === Number(p.split('/').pop()));
      if (!row) return json(res, { error: 'Not found' }, 404);
      // fresh ids, so the same section can be dropped twice without colliding
      const blocks = sanitizeBlocks(parseBlocks(row.blocks)).map((b) => ({ ...b, id: makeBlockId() }));
      return json(res, { blocks });
    }
    if (/^\/ministries\/api\/sections\/\d+\/delete$/.test(p) && req.method === 'POST') {
      const id = Number(p.split('/')[4]);
      const at = sections.findIndex((x) => x.id === id);
      if (at > -1) sections.splice(at, 1);
      return json(res, { ok: true });
    }

    if (p === '/ministries/api/media' && req.method === 'GET') return json(res, { media });
    if (p === '/ministries/api/media' && req.method === 'POST') {
      const body = await readBody(req);
      const kind = body.kind === 'video' ? 'video' : 'photo';
      const alt = String(body.alt || '').trim();
      if (kind === 'photo' && !alt) return json(res, { error: 'Please describe the photo before adding it.' }, 400);
      const row = { id: ++mediaSeq, filename: String(body.filename || 'upload.jpg'), kind,
        url: String(body.url || ''), thumb_url: String(body.thumb_url || ''), alt, meta: String(body.meta || '') };
      media.unshift(row);
      return json(res, { ok: true, item: row });
    }

    // Stand-in for the Worker's R2 upload endpoint. Records what it actually
    // received so the tests can prove the browser shrank the file first.
    if (p === '/api/upload-image' && req.method === 'POST') {
      const chunks = [];
      await new Promise((resolve) => { req.on('data', (c) => chunks.push(c)); req.on('end', resolve); });
      const body = Buffer.concat(chunks);
      uploads.push({ bytes: body.length, isWebp: body.includes(Buffer.from('WEBP')) });
      const url = '/images/uploaded-' + uploads.length + '.webp';
      return json(res, { url, location: url });
    }

    // Stand-in for /api/upload-doc. Unlike the image path above, the real
    // route never re-encodes a PDF, so the served name is the POSTED
    // filename (sanitized) rather than a synthesized one — this reads it
    // out of the multipart body the same way the Worker reads `file.name`,
    // so a test can assert the real filename-preserving behavior.
    if (p === '/api/upload-doc' && req.method === 'POST') {
      const chunks = [];
      await new Promise((resolve) => { req.on('data', (c) => chunks.push(c)); req.on('end', resolve); });
      const body = Buffer.concat(chunks);
      const m = body.toString('latin1').match(/filename="([^"]*)"/);
      const safeName = (m ? m[1] : 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
      docUploads.push({ bytes: body.length, name: safeName });
      const key = 'docs-' + docUploads.length + '-' + safeName;
      const url = '/docs/' + key.slice('docs-'.length);
      return json(res, { url, name: safeName, key });
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return { server, pages, media, revisions, uploads, docUploads, sections };
}
