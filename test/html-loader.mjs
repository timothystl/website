// Lets Node import the Worker, which uses Wrangler's text-module syntax
// (`import PAYROLL_HTML from './admin/payroll.html'`). Node has no such format,
// so without this the whole worker is untestable outside Cloudflare.
//
// Used as: node --experimental-loader ./test/html-loader.mjs <test file>
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function load(url, context, next) {
  if (url.endsWith('.html')) {
    const src = await readFile(fileURLToPath(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(src)};` };
  }
  return next(url, context);
}
