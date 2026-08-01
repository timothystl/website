// ── THE AUDIT LOG ────────────────────────────────────────────
// The log answers one question — who changed what, and what did it look like
// before — so the useful part of an entry is the difference, not the two blobs
// of JSON either side of it. These are the pure functions that turn a stored
// before/after pair into something a person can read.
//
// See admin/audit.test.mjs.

// Fields nobody wants to read in a diff: they change on every save without
// telling anybody anything, and listing them buries the field that did change.
const NOISE = new Set(['updated_at', 'created_at', 'updated_by', 'published_at_iso', 'change_log']);

// Long values (a whole page of blocks, a newsletter body) are summarised rather
// than printed. A diff that fills the screen with markup is a diff nobody reads.
const LONG = 60;

function readable(v) {
  if (v == null || v === '') return 'empty';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v);
      return s.length > LONG ? `${Object.keys(v).length} fields` : s;
    } catch (_) { return 'something'; }
  }
  const s = String(v);
  if (s.length > LONG) return `${s.length} characters`;
  return s;
}

export function parseState(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

// The fields that actually differ, as { field, from, to }. Order follows the
// after-state so a diff reads in the same order as the form that produced it.
export function diffStates(beforeRaw, afterRaw) {
  const before = parseState(beforeRaw);
  const after = parseState(afterRaw);
  if (!before && !after) return [];

  // A create has no before, a delete has no after. Both are real and worth
  // showing, so they are described rather than skipped.
  if (!before && after) {
    return Object.keys(after).filter((k) => !NOISE.has(k) && after[k] !== '' && after[k] != null)
      .map((k) => ({ field: k, from: null, to: readable(after[k]) }));
  }
  if (before && !after) {
    return Object.keys(before).filter((k) => !NOISE.has(k) && before[k] !== '' && before[k] != null)
      .map((k) => ({ field: k, from: readable(before[k]), to: null }));
  }

  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])];
  const out = [];
  for (const k of keys) {
    if (NOISE.has(k)) continue;
    const a = before[k];
    const b = after[k];
    // Compare by their readable form: a value that stringifies the same has not
    // changed in any way a person could see.
    const sa = typeof a === 'object' ? JSON.stringify(a) : String(a ?? '');
    const sb = typeof b === 'object' ? JSON.stringify(b) : String(b ?? '');
    if (sa === sb) continue;
    out.push({ field: k, from: readable(a), to: readable(b) });
  }
  return out;
}

// One line for the row's sub-line: "subject: empty → Advent begins". Capped,
// because the row has to stay a row.
export function diffSummary(beforeRaw, afterRaw, max = 2) {
  const d = diffStates(beforeRaw, afterRaw);
  if (!d.length) return '';
  const parts = d.slice(0, max).map((x) =>
    x.from === null ? `${x.field}: ${x.to}`
      : x.to === null ? `${x.field}: was ${x.from}`
      : `${x.field}: ${x.from} → ${x.to}`);
  const rest = d.length - parts.length;
  return parts.join(' · ') + (rest > 0 ? ` · and ${rest} more` : '');
}

// ── GROUPING ─────────────────────────────────────────────────
// The handoff's filters are All / Content / People & ops / Rolled back, which
// means every entity type has to fall into one of two buckets. Anything
// unrecognised counts as content: the log is mostly content, and a new entity
// type appearing under the wrong filter is better than it vanishing from both.
const OPS_ENTITIES = new Set([
  'user', 'users', 'staff', 'staff_member', 'gym_booking', 'gym_group', 'gym_invoice',
  'payroll', 'giving', 'partner', 'redirect', 'settings', 'session', 'media',
]);

export function auditGroup(row) {
  if (!row) return 'content';
  if (row.action === 'rollback') return 'rolled-back';
  return OPS_ENTITIES.has(row.entity_type) ? 'ops' : 'content';
}

// Which entries can be put back. An update is reversible because the before
// state was captured; a create has nothing to go back to, and a delete would
// need the whole record rebuilt rather than a field restored.
const ROLLBACKABLE = new Set(['news_item', 'ministry_page', 'ministry_post']);

export function canRollback(row) {
  return !!row && row.action === 'update' && !!row.before_state && ROLLBACKABLE.has(row.entity_type);
}

// Why a given row cannot be rolled back — shown instead of a dead button, so
// the absence of the control is explained rather than just felt.
export function rollbackNote(row) {
  if (!row) return '';
  if (row.action === 'rollback') return 'This entry is itself a rollback.';
  if (row.action === 'create') return 'Nothing to go back to — this created the item.';
  if (row.action === 'delete') return 'Deletions cannot be undone from here.';
  if (!row.before_state) return 'No previous state was recorded.';
  if (!ROLLBACKABLE.has(row.entity_type)) return `${String(row.entity_type || '').replace(/_/g, ' ')} changes cannot be rolled back yet.`;
  return '';
}

export function actionTone(action) {
  if (action === 'delete') return 'bad';
  if (action === 'create') return 'good';
  if (action === 'rollback') return 'auto';
  return 'plain';
}
