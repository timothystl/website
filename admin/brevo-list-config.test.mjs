// Brevo list settings must never fall back to a hardcoded list number.
// List 2 is the TEST list, so a silent fallback would file real subscribers there
// (they would never get the weekly newsletter) and nothing would say so.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const files = ['website-admin-worker.js', 'admin/forms.js', 'admin/newsletter.js'];
for (const f of files) {
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const fallbacks = src.match(/env\.BREVO_(?:TEST_)?LIST_ID\s*\|\|\s*'[1-9]\d*'/g) || [];
  assert.deepEqual(fallbacks, [], `${f} falls back to a hardcoded Brevo list: ${fallbacks.join(', ')}`);
}
console.log('brevo-list-config: no hardcoded list fallbacks');
