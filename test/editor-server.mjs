// Local stand-in for the admin Worker, just enough to run the ministry page
// editor in a real browser without Cloudflare or D1.
//
// It calls the SAME functions the Worker calls (admin/blocks.js) for rendering
// and sanitising, so the interesting logic is genuinely under test; only the
// routing and SQL are re-implemented here. Keep the endpoint contracts in step
// with the `/ministries/api/...` routes in tlc-admin-worker.js.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderPage, sanitizeBlocks, parseBlocks, blocksClientConfig, editorPhoneCss,
  migrateLegacyPage, starterBlocks, newBlock, makeBlockId,
} from '../admin/blocks.js';
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
  const revisions = [];
  const sections = [];
  let sectionSeq = 0;

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
      blocks: JSON.stringify(sanitizeBlocks(p.blocks || starterBlocks(p.title))),
      published_blocks: JSON.stringify(sanitizeBlocks(p.blocks || [])),
      change_log: '[]', updated_at: new Date().toISOString(),
    });
  }

  const json = (res, obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) => new Promise((resolve) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (_) { resolve({}); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p.startsWith('/ministries/editor/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      // No TinyMCE in the harness (the container has no egress) — the editor
      // must degrade to plain contenteditable, which this exercises.
      return res.end(EDITOR_HTML.replace('/*TLCB_EDITOR_CSS*/', editorPhoneCss()).replace('<!--TLCB_TINYMCE-->', ''));
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
          },
          config: blocksClientConfig(),
          media,
          html: renderPage(blocks, { editing: true, slug, withCss: true }),
        });
      }

      if (action === 'draft' && req.method === 'POST') {
        const body = await readBody(req);
        const blocks = sanitizeBlocks(body.blocks);
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
        return json(res, { ok: true, blocks, html: renderPage(blocks, { editing: true, slug, withCss: true }) });
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
      return json(res, { html: renderPage(blocks, { editing: true, slug: String(body.slug || ''), withCss: true }), blocks });
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

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return { server, pages, media, revisions, uploads, sections };
}
