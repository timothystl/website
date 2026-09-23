// Local-only Admin preview, with durable sample data and no external services.
// node --experimental-loader ./test/html-loader.mjs test/preview-admin.mjs <sqlite-file> [port]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../website-admin-worker.js';
import { ALL_PERMISSIONS } from '../admin/auth.js';

const dbPath = process.argv[2];
const port = Number(process.argv[3] || 4331);
if (!dbPath || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw Error('Provide a local SQLite file and optional port (1024–65535).');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const origin = `http://127.0.0.1:${port}`;
const db = new DatabaseSync(path.resolve(dbPath));
const statement = (sql, values = []) => ({
  bind: (...args) => statement(sql, args),
  first: async () => db.prepare(sql).get(...values) ?? null,
  all: async () => ({ results: db.prepare(sql).all(...values) }),
  run: async () => {
    const r = db.prepare(sql).run(...values);
    return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
  },
});
const DB = {
  prepare: sql => statement(sql),
  batch: async statements => {
    db.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); db.exec('COMMIT'); return results; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  exec: async sql => db.exec(sql),
};
// No production bindings or credentials are loaded. This also stops incidental
// network calls made by imported handlers (email, payments, Google, Connect).
globalThis.fetch = async () => new Response('{}', { status: 503 });
const env = { DB, IMAGES: { get: async () => null, put: async () => ({}), delete: async () => {} } };
const context = () => ({ waitUntil: promise => Promise.resolve(promise).catch(console.error) });
await worker.fetch(new Request('https://admin.timothystl.org/login'), env, context());
const username = 'local-preview';
const permissions = JSON.stringify(ALL_PERMISSIONS);
db.prepare('INSERT OR IGNORE INTO users (username,password_hash,permissions,created_at,active) VALUES (?,?,?,?,1)')
  .run(username, 'local-preview-only', permissions, new Date().toISOString());
const userId = db.prepare('SELECT id FROM users WHERE username=?').get(username).id;
const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
db.prepare('INSERT INTO sessions (token,user_id,username,permissions,expires_at,created_at) VALUES (?,?,?,?,?,?)')
  .run(token, userId, username, permissions, new Date(Date.now()+86400000).toISOString(), new Date().toISOString());
const server = http.createServer(async (req,res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); return res.end('Use the loopback preview address.'); }
    if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) { res.writeHead(403); return res.end('Local preview origin required.'); }
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/assets/tinymce/7.9.3/')) {
      const dir = path.join(root,'admin/vendor/tinymce');
      const file = path.resolve(dir,decodeURIComponent(url.pathname.slice('/assets/tinymce/7.9.3/'.length)));
      if (!file.startsWith(dir+path.sep)) { res.writeHead(403); return res.end(); }
      const content = await fs.readFile(file);
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
      return res.end(content);
    }
    const chunks=[]; let size=0;
    for await (const chunk of req) { size+=chunk.length; if(size>10*1024*1024){res.writeHead(413);return res.end('Preview request too large.');}chunks.push(chunk); }
    const body=Buffer.concat(chunks), headers=new Headers(req.headers);
    headers.set('cookie','tlc_session='+token);headers.set('origin','https://admin.timothystl.org');headers.delete('host');
    const result=await worker.fetch(new Request('https://admin.timothystl.org'+req.url,{method:req.method,headers,...(body.length?{body}:{})}),env,context());
    const responseHeaders=Object.fromEntries(result.headers);
    let content=Buffer.from(await result.arrayBuffer());
    if ((responseHeaders['content-type']||'').includes('text/html')) {
      content=Buffer.from(content.toString().replace('<body>', '<body><div style="position:fixed;bottom:0;right:0;z-index:9999;background:#fff3cd;color:#342b17;padding:5px 12px;font:12px sans-serif;border:1px solid #d9c48b">Local test · Sample database · External services disabled</div>'));
    }
    delete responseHeaders['content-length'];res.writeHead(result.status,responseHeaders);res.end(content);
  } catch (e) { console.error(e);res.writeHead(500);res.end('Local preview error: '+e.message); }
});
server.listen(port,'127.0.0.1',()=>console.log(`Admin preview: ${origin}/calendar-workspace\nSample data: ${path.resolve(dbPath)}\nProduction is not connected. Keep this terminal open.`));
