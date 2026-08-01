// ── THE SHARED ADMIN PATTERN ─────────────────────────────────
// Every list section in the admin is the same five things in the same order:
// a title with one action, a purpose line, a search-and-filter bar with a
// count, a table whose rows open a drawer, and one note stating the rule the
// section enforces. This module is that pattern, once.
//
// The point is not brevity. It is that a volunteer who learns the Staff screen
// has learned the Notices screen, the Sermons screen, and the eighteen others —
// which only holds if there is exactly one implementation. Adding a section
// means writing a config, not writing markup. If you find yourself hand-rolling
// a table in a route handler, that is the bug.
//
// Nothing here touches the database or the session. Every function is pure, so
// admin/ui.test.mjs can assert the awkward parts (pluralisation, count
// scoping, tone clamping) without a Worker.

import { VALUES, valueByKey } from './values.js';

// Local rather than imported from helpers.js: helpers.js pulls ADMIN_UI_CSS in
// from here, and a cycle between the two would leave one of them half-built at
// module-eval time depending on which route loaded first.
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── PALETTE ──────────────────────────────────────────────────
// The exact tokens from the design handoff §6. Everything in the admin reads
// these; no route should ever write a raw hex value.
export const PALETTE = {
  sidebarNavy: '#12243D',
  navy: '#1D3557',
  navyInk: '#1E2D4A',
  gold: '#C9973A',
  goldInk: '#1B1608',
  cream: '#F5E4C0',
  parchment: '#FAF7F1',
  sand: '#F4EFE5',
  edge: '#E7DFD1',
  divider: '#EFE7D9',
  muted: '#8A8271',
  body: '#4A4860',
  blue: '#2E7EA6',
};

// Five tones, and only five. Green = good or live, amber = needs attention,
// red = broken, grey = deliberately off, blue-grey = automatic (something the
// system did, which a volunteer should not feel responsible for).
export const TONES = {
  good:  { bg: '#EAF1E5', fg: '#3B4C2E', bd: '#C9DCBD' },
  warn:  { bg: '#FBF1DC', fg: '#7A5B18', bd: '#EBD5A6' },
  bad:   { bg: '#FAEFEF', fg: '#8A4A4A', bd: '#E4C8C8' },
  plain: { bg: '#EFEFEF', fg: '#6A6858', bd: '#DDD9D0' },
  auto:  { bg: '#EDF2F6', fg: '#3E5C76', bd: '#CFDCE6' },
};

// An unrecognised tone renders as `plain` rather than as an unstyled pill. A
// typo in a route should look deliberate-but-wrong, not broken.
export function toneOf(name) {
  return TONES[name] ? name : 'plain';
}

// ── SMALL TEXT HELPERS ───────────────────────────────────────

// "1 card", never "1 cards". This bit the prototype four times, so it is a
// function rather than a convention.
export function pluralise(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural || singular + 's'}`;
}

// "5 of 5 shown" — and `total` must be the number the *filters* can reach, not
// the number of rows in the table. A count that reads "5 of 12" when only 5 can
// ever be shown teaches a volunteer that 7 rows are hiding somewhere.
export function countLabel(shown, total, noun) {
  if (shown === total) return `${pluralise(total, noun)} shown`;
  return `${shown} of ${total} shown`;
}

// ── PILLS AND CHIPS ──────────────────────────────────────────

export function statusPill(tone, label) {
  const t = TONES[toneOf(tone)];
  return `<span class="tlc-pill" style="background:${t.bg};color:${t.fg};border-color:${t.bd};">${esc(label)}</span>`;
}

// A value chip is tinted by the value itself, so the four values stay
// recognisable at a glance across every section that carries them.
export function valueChip(key, { short = true } = {}) {
  const v = valueByKey(key);
  if (!v) return `<span class="tlc-chip tlc-chip-none">No value</span>`;
  return `<span class="tlc-chip" style="background:${v.tint};color:${v.ink};">${esc(short ? v.short : v.name)}</span>`;
}

// The <select> every section uses to tag a record. Blank is a real option —
// untagged is a normal state, not a validation failure.
export function valueSelect(name, selected, { allowNone = true } = {}) {
  const opts = [
    allowNone ? `<option value=""${!valueByKey(selected) ? ' selected' : ''}>— No value —</option>` : '',
    ...VALUES.map((v) => `<option value="${v.key}"${v.key === selected ? ' selected' : ''}>${esc(v.short)} · ${esc(v.name)}</option>`),
  ].filter(Boolean).join('');
  return `<select name="${esc(name)}">${opts}</select>`;
}

// ── THE PRIMARY CELL ─────────────────────────────────────────
// The first column always carries a sub-line: the second-most-useful fact
// about the row, so the drawer is not needed just to tell two rows apart.
export function primaryCell(title, sub, { icon = '' } = {}) {
  return `<div class="tlc-primary">${icon ? `<span class="tlc-primary-icon">${icon}</span>` : ''}<span class="tlc-primary-text"><span class="tlc-primary-title">${esc(title)}</span>${sub ? `<span class="tlc-primary-sub">${esc(sub)}</span>` : ''}</span></div>`;
}

// ── THE LIST SECTION ─────────────────────────────────────────
//
// renderListSection({
//   key:     'staff',                       // unique per page; namespaces the DOM ids
//   title:   'Staff directory',
//   purpose: 'One record per person. …',    // one sentence, plain language
//   action:  { label: '+ Add person', href: '/staff/new' },
//   search:  'Search staff',                // placeholder; omit to hide the box
//   filters: [{ label:'All', value:'all' }, { label:'Hidden', value:'hidden' }],
//   columns: [{ label:'Person', width:'2.2fr' }, …],   // 3–4 of them, no more
//   rows:    [{ cells:[…], href, filter, search, warn, warnCta, actions }],
//   note:    'Photo crop is set per person and reused everywhere…',
//   noun:    'person', nounPlural: 'people',
// })
//
// Filtering and search run in the browser over rows already rendered, so the
// count stays honest without a round trip and a section keeps working with
// JavaScript disabled — you just see every row.
export function renderListSection(cfg) {
  const {
    key, title, purpose = '', action = null, search = '', filters = [],
    columns = [], rows = [], note = '', noun = 'item', nounPlural = '',
    empty = 'Nothing here yet.', headerExtra = '',
  } = cfg;

  const plural = nounPlural || noun + 's';
  // A status, media or photo column holds a pill, and a pill that wraps reads
  // as two broken words rather than one status — so those get a floor of 126px
  // however the fractions divide up. Everything else is free to shrink. The
  // trailing track is the row's actions.
  const grid = columns.map((c) => (/status|media|photo/i.test(c.label || '') ? `minmax(126px,${c.width || '1fr'})` : (c.width || '1fr'))).join(' ') + ' 118px';

  const head = columns.map((c) => `<span class="tlc-th${c.align === 'right' ? ' tlc-right' : ''}">${esc(c.label)}</span>`).join('')
    + `<span class="tlc-th tlc-right"></span>`;

  const rowsHtml = rows.map((r) => {
    const filterVals = Array.isArray(r.filter) ? r.filter : (r.filter ? [r.filter] : []);
    const cells = columns.map((c, i) => `<span class="tlc-td${c.align === 'right' ? ' tlc-right' : ''}">${r.cells[i] == null ? '' : r.cells[i]}</span>`).join('');
    const actions = r.actions != null ? r.actions
      : (r.href ? `<a class="tlc-edit" href="${esc(r.href)}">Edit</a>` : '');
    // The warning row is part of the row, not a modal and not a toast: a row
    // that needs attention says so in place, with its own action label, and
    // goes on saying it until somebody fixes it.
    const warnHtml = r.warn ? `<div class="tlc-warn">
      <span class="tlc-warn-mark">▲</span>
      <span class="tlc-warn-text">${esc(r.warn)}</span>
      ${r.warnCta ? `<a class="tlc-warn-cta" href="${esc(r.warnCta.href)}">${esc(r.warnCta.label)}</a>` : ''}
    </div>` : '';
    // `child: true` indents a row under the one above it — used where the data
    // really is a hierarchy (sermons under their series) rather than a flat
    // list. It is a visual relationship only; filtering and search still treat
    // every row independently, so searching for a sermon finds it whether or
    // not its series matches.
    return `<div class="tlc-row-wrap${r.child ? ' tlc-row-child' : ''}" data-filter="${esc(filterVals.join(' '))}" data-search="${esc(String(r.search || '').toLowerCase())}">
      <div class="tlc-row"${r.href ? ` data-href="${esc(r.href)}"` : ''} style="grid-template-columns:${grid};">
        ${cells}<span class="tlc-td tlc-right tlc-actions">${actions}</span>
      </div>${warnHtml}
    </div>`;
  }).join('');

  const filtersHtml = filters.map((f, i) => `<button type="button" class="tlc-filter${i === 0 ? ' is-on' : ''}" data-value="${esc(f.value)}">${esc(f.label)}</button>`).join('');

  // The four core values filter from their own row of tinted chips, below the
  // plain filters — that is how the design separates "which kind of thing" from
  // "which value it carries". They are additive: picking a value narrows
  // whatever the row above already selected.
  const chipsHtml = (cfg.chipFilters || []).map((c) =>
    `<button type="button" class="tlc-chipfilter" data-value="${esc(c.value)}" style="background:${esc(c.tint)};color:${esc(c.ink)};">${esc(c.label)}</button>`
  ).join('');

  return `<section class="tlc-section" id="sec-${esc(key)}" data-noun="${esc(noun)}" data-noun-plural="${esc(plural)}">
  <header class="tlc-section-head">
    <div class="tlc-section-headings">
      <h1 class="tlc-title">${esc(title)}</h1>
      ${purpose ? `<p class="tlc-purpose">${esc(purpose)}</p>` : ''}
    </div>
    ${action
      // Some sections create the thing outright rather than opening a form
      // (a new page is made and its editor opened). That must be a POST — a
      // GET that mutates gets fired by a link prefetch or a browser refresh.
      ? (action.method === 'POST'
          ? `<form method="POST" action="${esc(action.href)}" style="margin:0;"><button type="submit" class="tlc-action">${esc(action.label)}</button></form>`
          : `<a class="tlc-action" href="${esc(action.href)}">${esc(action.label)}</a>`)
      : ''}
  </header>
  ${headerExtra}
  ${(search || filters.length) ? `<div class="tlc-bar">
    ${search ? `<label class="tlc-search"><span class="tlc-search-icon" aria-hidden="true">⌕</span><input type="search" placeholder="${esc(search)}" aria-label="${esc(search)}"></label>` : ''}
    ${filtersHtml ? `<div class="tlc-filters">${filtersHtml}</div>` : ''}
    ${chipsHtml ? '' : '<span class="tlc-count"></span>'}
  </div>` : ''}
  ${chipsHtml ? `<div class="tlc-bar tlc-bar--chips">
    <div class="tlc-filters">${chipsHtml}</div>
    <span class="tlc-count"></span>
  </div>` : ''}
  <div class="tlc-table">
    <div class="tlc-thead" style="grid-template-columns:${grid};">${head}</div>
    <div class="tlc-tbody">${rowsHtml}</div>
    <div class="tlc-empty" hidden>${esc(empty)}</div>
  </div>
  ${note ? `<p class="tlc-note"><span class="tlc-note-mark">◆</span><span>${esc(note)}</span></p>` : ''}
</section>`;
}

// One script for every list section on the page. Included once by
// sidebarShell(); it discovers sections rather than being wired per section, so
// a new section needs no script of its own.
export const LIST_SECTION_JS = `(function(){
function wire(sec){
  var body=sec.querySelector('.tlc-tbody'); if(!body) return;
  var rows=Array.prototype.slice.call(body.querySelectorAll('.tlc-row-wrap'));
  var input=sec.querySelector('.tlc-search input');
  var pills=Array.prototype.slice.call(sec.querySelectorAll('.tlc-filter'));
  var count=sec.querySelector('.tlc-count');
  var empty=sec.querySelector('.tlc-empty');
  var noun=sec.getAttribute('data-noun')||'item';
  var plural=sec.getAttribute('data-noun-plural')||noun+'s';
  var active=pills.length?pills[0].getAttribute('data-value'):'all';
  function matchesFilter(r){
    if(active==='all') return true;
    return (' '+(r.getAttribute('data-filter')||'')+' ').indexOf(' '+active+' ')>-1;
  }
  function apply(){
    var q=(input&&input.value||'').trim().toLowerCase();
    var shown=0,reachable=0;
    rows.forEach(function(r){
      var inFilter=matchesFilter(r)&&(!chip||(' '+(r.getAttribute('data-filter')||'')+' ').indexOf(' '+chip+' ')>-1);
      if(inFilter) reachable++;
      var hit=inFilter&&(!q||(r.getAttribute('data-search')||'').indexOf(q)>-1);
      r.hidden=!hit; if(hit) shown++;
    });
    if(empty) empty.hidden=shown!==0;
    if(count) count.textContent=shown===reachable
      ? (reachable+' '+(reachable===1?noun:plural)+' shown')
      : (shown+' of '+reachable+' shown');
  }
  var chips=Array.prototype.slice.call(sec.querySelectorAll('.tlc-chipfilter'));
  var chip=null;
  if(input) input.addEventListener('input',apply);
  pills.forEach(function(p){p.addEventListener('click',function(){
    pills.forEach(function(o){o.classList.remove('is-on');});
    p.classList.add('is-on'); active=p.getAttribute('data-value'); apply();
  });});
  // A value chip narrows whatever the row above already selected, and clicking
  // the active one clears it — so "Live" and "Grow" can be asked together.
  chips.forEach(function(c){c.addEventListener('click',function(){
    var v=c.getAttribute('data-value');
    if(chip===v){chip=null;c.classList.remove('is-on');}
    else{chips.forEach(function(o){o.classList.remove('is-on');});c.classList.add('is-on');chip=v;}
    apply();
  });});
  // The whole row is the target, but a link or button inside it wins — the ⋯
  // menu and an inline form must not be swallowed by the row's own navigation.
  body.addEventListener('click',function(e){
    if(e.target.closest('a,button,input,form,label')) return;
    var row=e.target.closest('.tlc-row'); if(!row) return;
    var href=row.getAttribute('data-href'); if(href) location.href=href;
  });
  apply();
}
Array.prototype.slice.call(document.querySelectorAll('.tlc-section')).forEach(wire);
// One handler for every ⋯ menu on the page: open on click, close on anything
// else, so two menus can never be open at once.
document.addEventListener('click',function(e){
  var btn=e.target.closest('.tlc-more-btn');
  var open=document.querySelector('.tlc-more.is-open');
  if(open&&(!btn||!open.contains(btn))){open.classList.remove('is-open');open.querySelector('.tlc-more-btn').setAttribute('aria-expanded','false');}
  if(btn){var wrap=btn.closest('.tlc-more');var now=!wrap.classList.contains('is-open');wrap.classList.toggle('is-open',now);btn.setAttribute('aria-expanded',now?'true':'false');}
});
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  var open=document.querySelector('.tlc-more.is-open');
  if(open){open.classList.remove('is-open');open.querySelector('.tlc-more-btn').setAttribute('aria-expanded','false');}
});
})();`;

// ── THE DRAWER ───────────────────────────────────────────────
//
// renderDrawer({
//   key:'user', title:'admin', sub:'Users · saved changes are logged',
//   action:'/users/update/3', fields:[…],
//   deleteAction:'/users/delete/3', deleteConfirm:'Delete this user?',
// })
//
// Field kinds: text · textarea · toggle · choice · value · photo · perms ·
// static · html. Every kind is a constrained control — there is deliberately
// no free-form colour, pixel or font input anywhere in this list, because the
// governing rule of the redesign is that a volunteer cannot break the site.
export function renderDrawer(cfg) {
  const {
    key, title, sub = '', action, fields = [], method = 'POST',
    deleteAction = '', deleteConfirm = 'Delete this? This cannot be undone.',
    saveLabel = 'Save changes', cancelHref = '', open = true,
  } = cfg;

  const body = fields.map((f) => renderField(f)).join('');

  return `<div class="tlc-drawer-scrim${open ? ' is-open' : ''}" data-drawer-scrim="${esc(key)}"></div>
<aside class="tlc-drawer${open ? ' is-open' : ''}" id="drawer-${esc(key)}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
  <form method="${esc(method)}" action="${esc(action)}" class="tlc-drawer-form">
    <header class="tlc-drawer-head">
      <div>
        <h2 class="tlc-drawer-title">${esc(title)}</h2>
        ${sub ? `<p class="tlc-drawer-sub">${esc(sub)}</p>` : ''}
      </div>
      <a class="tlc-drawer-close" href="${esc(cancelHref || '#')}">Close</a>
    </header>
    <div class="tlc-drawer-body">${body}</div>
    <footer class="tlc-drawer-foot">
      ${deleteAction
        ? `<button type="submit" class="tlc-drawer-delete" formaction="${esc(deleteAction)}" formnovalidate onclick="return confirm('${esc(deleteConfirm).replace(/'/g, '&#39;')}')">Delete</button>`
        : '<span></span>'}
      <div class="tlc-drawer-foot-right">
        ${cancelHref ? `<a class="tlc-btn-quiet" href="${esc(cancelHref)}">Cancel</a>` : ''}
        <button type="submit" class="tlc-btn-primary">${esc(saveLabel)}</button>
      </div>
    </footer>
  </form>
</aside>`;
}

function renderField(f) {
  const id = `fld-${esc(f.name || f.key || Math.random().toString(36).slice(2))}`;
  const label = f.label ? `<label class="tlc-label" for="${id}">${esc(f.label)}</label>` : '';
  const hint = f.hint ? `<p class="tlc-hint">${esc(f.hint)}</p>` : '';

  switch (f.kind) {
    case 'static':
      return `<div class="tlc-field">${label}<div class="tlc-static">${f.html != null ? f.html : esc(f.value)}</div>${hint}</div>`;

    case 'html':
      return f.html || '';

    case 'textarea':
      return `<div class="tlc-field">${label}<textarea id="${id}" name="${esc(f.name)}" rows="${f.rows || 4}"${f.required ? ' required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>${hint}</div>`;

    case 'toggle':
      // A hidden 0 ahead of the checkbox so an unchecked box posts a value.
      // Without it "off" is indistinguishable from "field not on the form",
      // and a partial form silently clears flags it never showed.
      return `<div class="tlc-field tlc-field-toggle">
        <input type="hidden" name="${esc(f.name)}" value="0">
        <label class="tlc-toggle">
          <input type="checkbox" id="${id}" name="${esc(f.name)}" value="1"${f.value ? ' checked' : ''}>
          <span class="tlc-toggle-track"><span class="tlc-toggle-knob"></span></span>
          <span class="tlc-toggle-label">${esc(f.label || '')}</span>
        </label>${hint}
      </div>`;

    case 'choice':
      return `<div class="tlc-field">${label}<select id="${id}" name="${esc(f.name)}">${
        (f.options || []).map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(f.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')
      }</select>${hint}</div>`;

    case 'value':
      return `<div class="tlc-field">${label}${valueSelect(f.name, f.value)}${hint}</div>`;

    case 'perms':
      return `<div class="tlc-field">${label}<div class="tlc-perms">${
        (f.options || []).map((o) => `<label class="tlc-perm">
          <input type="checkbox" name="${esc(f.name)}" value="${esc(o.value)}"${o.checked ? ' checked' : ''}>
          <span class="tlc-perm-name">${esc(o.label)}</span>
          <code class="tlc-perm-key">${esc(o.value)}</code>
        </label>`).join('')
      }</div>${hint}</div>`;

    case 'photo':
      return `<div class="tlc-field">${label}<div class="tlc-photo">
        ${f.value ? `<img src="${esc(f.value)}" alt="" class="tlc-photo-preview">` : '<span class="tlc-photo-empty">No photo</span>'}
        <input type="hidden" name="${esc(f.name)}" value="${esc(f.value || '')}">
        <input type="file" accept="image/*" class="tlc-photo-input" data-target="${esc(f.name)}">
      </div>${hint}</div>`;

    case 'number':
      return `<div class="tlc-field">${label}<input type="number" id="${id}" name="${esc(f.name)}" value="${esc(f.value == null ? '' : f.value)}"${f.min != null ? ` min="${esc(f.min)}"` : ''}${f.max != null ? ` max="${esc(f.max)}"` : ''}${f.step != null ? ` step="${esc(f.step)}"` : ''}>${hint}</div>`;

    case 'date':
      return `<div class="tlc-field">${label}<input type="date" id="${id}" name="${esc(f.name)}" value="${esc(f.value || '')}">${hint}</div>`;

    default:
      return `<div class="tlc-field">${label}<input type="${esc(f.type || 'text')}" id="${id}" name="${esc(f.name)}" value="${esc(f.value == null ? '' : f.value)}"${f.required ? ' required' : ''} placeholder="${esc(f.placeholder || '')}"${f.readonly ? ' readonly' : ''}>${hint}</div>`;
  }
}


// ── ROW ACTIONS ──────────────────────────────────────────────
// The design gives every row an `Edit` link and a `⋯` overflow. Anything
// destructive or rarely-wanted lives behind the ⋯ rather than sitting in the
// row where it can be hit by accident.
//
// items: [{ label, href } | { label, action, confirm } | { label, hidden }]
export function rowActions(primary, items = []) {
  const menu = items.filter(Boolean).map((i) => {
    if (i.action) {
      return `<form method="POST" action="${esc(i.action)}" style="margin:0;"${i.confirm ? ` onsubmit="return confirm('${esc(i.confirm).replace(/'/g, '&#39;')}')"` : ''}>
        ${Object.entries(i.fields || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
        <button type="submit" class="tlc-menu-item${i.danger ? ' is-danger' : ''}">${esc(i.label)}</button>
      </form>`;
    }
    return `<a class="tlc-menu-item" href="${esc(i.href)}">${esc(i.label)}</a>`;
  }).join('');

  return `${primary ? `<a class="tlc-edit" href="${esc(primary.href)}">${esc(primary.label)}</a>` : ''}`
    + (menu ? `<span class="tlc-more">
      <button type="button" class="tlc-more-btn" aria-haspopup="true" aria-expanded="false" aria-label="More actions">⋯</button>
      <span class="tlc-menu">${menu}</span>
    </span>` : '');
}

// A row cell that is a switch rather than a pill — used where the design shows
// one (a ministry's "In menu"). It posts on change, so there is no Save step
// for something that reads as instant.
export function toggleCell(action, on, label) {
  return `<form method="POST" action="${esc(action)}" style="margin:0;">
    <input type="hidden" name="value" value="${on ? '0' : '1'}">
    <button type="submit" class="tlc-switch${on ? ' is-on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${esc(label || 'Toggle')}">
      <span class="tlc-switch-knob"></span>
    </button>
  </form>`;
}

// ── PANELS ───────────────────────────────────────────────────
// For the bespoke screens (Dashboard, Menu, Giving, Gym, Payroll) that are not
// flat lists but must still look like they belong.
export function panel(titleText, bodyHtml, { right = '', pad = true, id = '' } = {}) {
  return `<div class="tlc-panel"${id ? ` id="${esc(id)}"` : ''}>
    ${titleText || right ? `<div class="tlc-panel-head"><span class="tlc-panel-title">${esc(titleText)}</span>${right ? `<span class="tlc-panel-right">${right}</span>` : ''}</div>` : ''}
    <div class="tlc-panel-body${pad ? '' : ' tlc-panel-body-flush'}">${bodyHtml}</div>
  </div>`;
}

// ── STYLESHEET ───────────────────────────────────────────────
// Loaded once by helpers.js html(). Scoped under tlc- so it sits alongside the
// pre-redesign styles without fighting them while sections are converted one
// at a time.
export const ADMIN_UI_CSS = `
:root{
  --tlc-sidebar:${PALETTE.sidebarNavy};--tlc-navy:${PALETTE.navy};--tlc-ink:${PALETTE.navyInk};
  --tlc-gold:${PALETTE.gold};--tlc-gold-ink:${PALETTE.goldInk};--tlc-cream:${PALETTE.cream};
  --tlc-parchment:${PALETTE.parchment};--tlc-sand:${PALETTE.sand};--tlc-edge:${PALETTE.edge};
  --tlc-divider:${PALETTE.divider};--tlc-muted:${PALETTE.muted};--tlc-body:${PALETTE.body};
  --tlc-blue:${PALETTE.blue};
  --tlc-serif:'Lora',Georgia,'Times New Roman',serif;
  --tlc-sans:'Source Sans 3',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
}
.tlc-wrap{font-family:var(--tlc-sans);}
.tlc-section{padding:20px 26px 34px;max-width:1180px;font-family:var(--tlc-sans);}
.tlc-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px;}
.tlc-section-headings{min-width:0;}
.tlc-title{font:500 25px/1.2 var(--tlc-serif);color:var(--tlc-navy);margin:0;}
.tlc-purpose{margin:6px 0 0;font-size:13.5px;line-height:1.6;color:var(--tlc-body);max-width:62em;text-wrap:pretty;}
.tlc-action{flex:none;display:inline-flex;align-items:center;background:var(--tlc-navy);color:#fff;font:600 13px var(--tlc-sans);padding:10px 18px;border-radius:8px;text-decoration:none;border:0;cursor:pointer;}
.tlc-action:hover{background:#16273F;}
.tlc-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;}
.tlc-search{flex:1;min-width:200px;max-width:340px;display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--tlc-edge);border-radius:8px;padding:0 12px;}
.tlc-search-icon{color:var(--tlc-muted);font-size:14px;}
.tlc-search input{flex:1;border:0;outline:0;background:transparent;padding:9px 0;font:400 13.5px var(--tlc-sans);color:var(--tlc-ink);width:100%;}
.tlc-filters{display:flex;gap:7px;flex-wrap:wrap;}
.tlc-filter{font:600 12.5px var(--tlc-sans);color:var(--tlc-body);background:#fff;border:1px solid var(--tlc-edge);border-radius:999px;padding:8px 15px;cursor:pointer;}
.tlc-filter:hover{border-color:var(--tlc-blue);}
.tlc-filter.is-on{background:#E7EFF5;border-color:var(--tlc-blue);color:var(--tlc-navy);}
.tlc-count{margin-left:auto;font-size:12.5px;color:var(--tlc-muted);white-space:nowrap;}
.tlc-bar--chips{margin-top:-6px;}
.tlc-chipfilter{font:600 12px var(--tlc-sans);border:1px solid transparent;border-radius:999px;padding:7px 14px;cursor:pointer;opacity:.62;}
.tlc-chipfilter:hover{opacity:.85;}
.tlc-chipfilter.is-on{opacity:1;box-shadow:inset 0 0 0 1.5px currentColor;}
/* ── Row overflow menu ── */
.tlc-more{position:relative;display:inline-flex;}
.tlc-more-btn{background:none;border:0;cursor:pointer;color:var(--tlc-muted);font-size:15px;line-height:1;padding:4px 6px;border-radius:6px;}
.tlc-more-btn:hover{background:var(--tlc-sand);color:var(--tlc-ink);}
.tlc-menu{position:absolute;top:100%;right:0;min-width:170px;background:#fff;border:1px solid var(--tlc-edge);border-radius:9px;box-shadow:0 8px 24px rgba(18,36,61,.14);padding:5px;z-index:40;display:none;flex-direction:column;}
.tlc-more.is-open .tlc-menu{display:flex;}
.tlc-menu-item{display:block;width:100%;text-align:left;background:none;border:0;cursor:pointer;font:500 13px var(--tlc-sans);color:var(--tlc-ink);padding:8px 10px;border-radius:6px;text-decoration:none;}
.tlc-menu-item:hover{background:var(--tlc-sand);}
.tlc-menu-item.is-danger{color:#8A4A4A;}
/* ── Switch cell ── */
.tlc-switch{width:38px;height:22px;border-radius:999px;border:0;background:#D9D3C6;position:relative;cursor:pointer;padding:0;}
.tlc-switch.is-on{background:#4A7C4E;}
.tlc-switch-knob{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s;}
.tlc-switch.is-on .tlc-switch-knob{transform:translateX(16px);}
.tlc-switch:focus-visible{outline:2px solid var(--tlc-blue);outline-offset:2px;}
.tlc-table{border:1px solid var(--tlc-edge);border-radius:12px;background:var(--tlc-parchment);overflow:hidden;}
.tlc-thead{display:grid;gap:14px;padding:11px 18px;background:var(--tlc-sand);border-bottom:1px solid var(--tlc-edge);}
.tlc-th{font:600 10.5px/1 var(--tlc-sans);letter-spacing:.12em;text-transform:uppercase;color:var(--tlc-muted);}
.tlc-row-wrap{border-bottom:1px solid var(--tlc-divider);}
.tlc-row-wrap:last-child{border-bottom:0;}
.tlc-row-child{background:rgba(244,239,229,.5);}
.tlc-row-child .tlc-primary{padding-left:20px;position:relative;}
.tlc-row-child .tlc-primary::before{content:'└';position:absolute;left:4px;top:2px;color:var(--tlc-muted);font-size:11px;}
.tlc-row-child .tlc-primary-title{font-weight:500;}
.tlc-row{display:grid;gap:14px;align-items:center;padding:12px 18px;min-height:56px;cursor:pointer;}
.tlc-row:hover{background:#fff;}
.tlc-row-wrap[data-href=""] .tlc-row{cursor:default;}
.tlc-td{font-size:13px;color:var(--tlc-body);min-width:0;overflow-wrap:anywhere;}
.tlc-right{text-align:right;justify-self:end;}
.tlc-actions{display:flex;align-items:center;gap:12px;white-space:nowrap;}
.tlc-edit{font-size:13px;font-weight:600;color:var(--tlc-navy);text-decoration:none;}
.tlc-edit:hover{text-decoration:underline;}
.tlc-primary{display:flex;align-items:center;gap:10px;min-width:0;}
.tlc-primary-icon{flex:none;width:30px;height:30px;border-radius:50%;background:var(--tlc-sand);display:flex;align-items:center;justify-content:center;font-size:14px;overflow:hidden;}
.tlc-primary-icon img{width:100%;height:100%;object-fit:cover;}
.tlc-primary-text{min-width:0;display:flex;flex-direction:column;gap:2px;}
.tlc-primary-title{font:600 13.5px/1.3 var(--tlc-sans);color:var(--tlc-ink);}
.tlc-primary-sub{font-size:11.5px;line-height:1.35;color:var(--tlc-muted);}
.tlc-pill{display:inline-block;font:600 10.5px/1 var(--tlc-sans);letter-spacing:.08em;text-transform:uppercase;padding:5px 10px;border-radius:999px;border:1px solid transparent;white-space:nowrap;}
.tlc-chip{display:inline-block;font:600 11px/1 var(--tlc-sans);padding:5px 10px;border-radius:999px;white-space:nowrap;}
.tlc-chip-none{background:#F0EEE9;color:var(--tlc-muted);}
.tlc-warn{display:flex;align-items:center;gap:9px;padding:9px 18px 11px 18px;background:#FBF1DC;border-top:1px solid #EBD5A6;font-size:12.5px;color:#7A5B18;}
.tlc-warn-mark{flex:none;font-size:10px;}
.tlc-warn-text{flex:1;text-wrap:pretty;}
.tlc-warn-cta{flex:none;font-weight:700;color:#7A5B18;text-decoration:underline;}
.tlc-empty{padding:34px 18px;text-align:center;font-size:13.5px;color:var(--tlc-muted);}
.tlc-note{display:flex;gap:9px;align-items:baseline;margin:14px 0 0;font-size:13px;line-height:1.65;color:var(--tlc-body);max-width:66em;text-wrap:pretty;}
.tlc-note-mark{flex:none;color:var(--tlc-gold);font-size:11px;}
/* ── Giving surfaces ── */
.tlc-give-surfaces{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
@media (max-width:820px){.tlc-give-surfaces{grid-template-columns:1fr;}}
.tlc-give-surface{border:1px solid var(--tlc-edge);border-radius:11px;background:#fff;padding:14px 16px;display:flex;flex-direction:column;gap:6px;}
.tlc-give-badge{align-self:flex-start;font:600 9.5px var(--tlc-sans);letter-spacing:.12em;text-transform:uppercase;color:var(--tlc-muted);background:var(--tlc-sand);border-radius:999px;padding:4px 9px;}
.tlc-give-addr{font:600 15px var(--tlc-sans);color:var(--tlc-navy);overflow-wrap:anywhere;}
.tlc-give-note{margin:0;font-size:12.5px;line-height:1.55;color:var(--tlc-body);text-wrap:pretty;}
.tlc-give-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center;}
.tlc-give-sync{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:12px;padding:11px 14px;border:1px solid var(--tlc-edge);border-radius:10px;background:var(--tlc-parchment);font-size:13px;color:var(--tlc-body);text-wrap:pretty;}
/* ── NFC taps ── */
.tlc-taps{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px;margin-bottom:18px;}
.tlc-tap{border:1px solid var(--tlc-edge);border-radius:12px;background:var(--tlc-parchment);padding:13px 15px;display:flex;flex-direction:column;gap:4px;}
.tlc-tap.is-on{border-color:var(--tlc-blue);box-shadow:inset 0 0 0 1px var(--tlc-blue);background:#fff;}
.tlc-tap-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.tlc-tap-n{font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--tlc-navy);}
.tlc-tap-name{font:600 13.5px var(--tlc-sans);color:var(--tlc-ink);}
.tlc-tap-where{font-size:11.5px;color:var(--tlc-muted);text-wrap:pretty;}
.tlc-tap-dest{font-size:11.5px;color:var(--tlc-blue);overflow-wrap:anywhere;}
.tlc-tap-count{font-size:11.5px;color:var(--tlc-muted);}
.tlc-tap-actions{display:flex;gap:8px;margin-top:7px;flex-wrap:wrap;}
.tlc-tap-btn{font:600 11.5px var(--tlc-sans);color:var(--tlc-navy);background:#fff;border:1px solid var(--tlc-edge);border-radius:7px;padding:6px 10px;text-decoration:none;}
.tlc-tap-btn:hover{border-color:var(--tlc-blue);}
/* ── Panels ── */
.tlc-panel{border:1px solid var(--tlc-edge);border-radius:12px;background:var(--tlc-parchment);overflow:hidden;}
.tlc-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px;background:var(--tlc-sand);border-bottom:1px solid var(--tlc-edge);}
.tlc-panel-title{font:600 10.5px/1 var(--tlc-sans);letter-spacing:.12em;text-transform:uppercase;color:var(--tlc-muted);}
.tlc-panel-right{font-size:12.5px;color:var(--tlc-muted);}
.tlc-panel-body{padding:14px 16px;}
.tlc-panel-body-flush{padding:0;}
.tlc-panels{display:grid;gap:16px;}
/* ── Dashboard ── */
.tlc-dash{padding:20px 26px 40px;max-width:1180px;font-family:var(--tlc-sans);}
.tlc-dash-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:20px;flex-wrap:wrap;}
.tlc-dash-greeting{font:500 30px/1.15 var(--tlc-serif);color:var(--tlc-navy);margin:0;}
.tlc-dash-sub{margin:6px 0 0;font-size:13.5px;color:var(--tlc-body);text-wrap:pretty;}
.tlc-seg{display:inline-flex;background:var(--tlc-sand);border:1px solid var(--tlc-edge);border-radius:9px;padding:3px;gap:3px;flex:none;}
.tlc-seg a{font:600 13px var(--tlc-sans);color:var(--tlc-body);text-decoration:none;padding:7px 16px;border-radius:7px;}
.tlc-seg a.is-on{background:#fff;color:var(--tlc-navy);box-shadow:0 1px 2px rgba(18,36,61,.10);}
.tlc-task{display:flex;align-items:center;gap:14px;padding:15px 18px;border-bottom:1px solid var(--tlc-divider);}
.tlc-task:last-child{border-bottom:0;}
.tlc-task-glyph{flex:none;width:38px;height:38px;border-radius:10px;background:var(--tlc-sand);display:flex;align-items:center;justify-content:center;font-size:17px;}
.tlc-task-text{flex:1;min-width:0;}
.tlc-task-title{display:block;font:600 14px/1.35 var(--tlc-sans);color:var(--tlc-ink);}
.tlc-task-detail{display:block;font-size:12.5px;line-height:1.45;color:var(--tlc-muted);margin-top:3px;text-wrap:pretty;}
.tlc-task-btn{flex:none;font:600 12.5px var(--tlc-sans);color:var(--tlc-navy);background:#fff;border:1px solid var(--tlc-edge);border-radius:8px;padding:8px 16px;text-decoration:none;}
.tlc-task-btn:hover{border-color:var(--tlc-blue);}
.tlc-task-clear{padding:34px 18px;text-align:center;font-size:14px;color:var(--tlc-muted);}
.tlc-values{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
@media (max-width:960px){.tlc-values{grid-template-columns:repeat(2,1fr);}}
@media (max-width:560px){.tlc-values{grid-template-columns:1fr;}}
.tlc-value-card{border:1px solid var(--tlc-edge);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;}
.tlc-value-top{padding:13px 15px;}
.tlc-value-short{display:block;font:500 19px/1.15 var(--tlc-serif);color:#fff;}
.tlc-value-name{display:block;font:700 10px/1 var(--tlc-sans);letter-spacing:.13em;text-transform:uppercase;color:rgba(255,255,255,.78);margin-top:5px;}
.tlc-value-body{flex:1;padding:13px 15px;display:flex;flex-direction:column;gap:9px;}
.tlc-value-stat{font:600 13px/1.4 var(--tlc-sans);color:var(--tlc-ink);}
.tlc-value-partner{font-size:12px;line-height:1.45;color:var(--tlc-body);}
.tlc-value-partner b{font-weight:600;}
.tlc-value-quiet{margin-top:auto;font-size:11.5px;line-height:1.4;color:#7A5B18;background:#FBF1DC;border:1px solid #EBD5A6;border-radius:7px;padding:7px 9px;text-wrap:pretty;}
.tlc-dash-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;align-items:start;}
@media (max-width:960px){.tlc-dash-grid{grid-template-columns:1fr;}}
.tlc-sunday{display:flex;align-items:baseline;gap:10px;padding:9px 0;border-bottom:1px solid var(--tlc-divider);font-size:13px;}
.tlc-sunday:last-child{border-bottom:0;}
.tlc-sunday-time{flex:none;width:74px;font:600 13px var(--tlc-sans);color:var(--tlc-navy);}
.tlc-sunday-what{flex:1;color:var(--tlc-ink);}
.tlc-sunday-note{display:block;font-size:11.5px;color:var(--tlc-muted);margin-top:2px;}
.tlc-tail{padding:9px 0;border-bottom:1px solid var(--tlc-divider);font-size:12.5px;line-height:1.5;color:var(--tlc-body);}
.tlc-tail:last-child{border-bottom:0;}
.tlc-tail b{color:var(--tlc-ink);font-weight:600;}
.tlc-tail-when{display:block;font-size:11px;color:var(--tlc-muted);margin-top:2px;}
.tlc-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px;}
@media (max-width:880px){.tlc-tiles{grid-template-columns:repeat(2,1fr);}}
.tlc-tile{border:1px solid var(--tlc-edge);border-radius:11px;background:var(--tlc-parchment);padding:15px 17px;display:flex;flex-direction:column;gap:5px;}
.tlc-tile-label{font:600 10.5px/1 var(--tlc-sans);letter-spacing:.12em;text-transform:uppercase;color:var(--tlc-muted);}
.tlc-tile-num{font:500 30px/1 var(--tlc-serif);color:var(--tlc-navy);}
.tlc-tile-note{font-size:12px;line-height:1.45;color:var(--tlc-muted);}
.tlc-jump{display:flex;flex-wrap:wrap;gap:9px;}
.tlc-jump a{font:600 12.5px var(--tlc-sans);color:var(--tlc-navy);background:#fff;border:1px solid var(--tlc-edge);border-radius:999px;padding:8px 15px;text-decoration:none;}
.tlc-jump a:hover{border-color:var(--tlc-blue);}
.tlc-stack{display:flex;flex-direction:column;gap:16px;}
.tlc-eyebrow{display:flex;align-items:baseline;gap:12px;margin:24px 0 12px;}
.tlc-eyebrow-label{font:700 10.5px/1 var(--tlc-sans);letter-spacing:.13em;text-transform:uppercase;color:var(--tlc-muted);}
.tlc-eyebrow-note{font-size:12.5px;color:var(--tlc-muted);}
/* ── Drawer ── */
.tlc-drawer-scrim{position:fixed;inset:0;background:rgba(18,36,61,.34);z-index:200;display:none;}
.tlc-drawer-scrim.is-open{display:block;}
.tlc-drawer{position:fixed;top:0;right:0;width:min(430px,100vw);height:100vh;background:#fff;border-left:1px solid var(--tlc-edge);box-shadow:-8px 0 28px rgba(18,36,61,.16);z-index:201;transform:translateX(100%);transition:transform .18s ease;font-family:var(--tlc-sans);}
.tlc-drawer.is-open{transform:translateX(0);}
.tlc-drawer-form{display:flex;flex-direction:column;height:100%;}
.tlc-drawer-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:18px 20px 14px;border-bottom:1px solid var(--tlc-edge);}
.tlc-drawer-title{margin:0;font:500 21px/1.2 var(--tlc-serif);color:var(--tlc-navy);}
.tlc-drawer-sub{margin:4px 0 0;font-size:12.5px;color:var(--tlc-muted);}
.tlc-drawer-close{flex:none;font-size:12.5px;font-weight:600;color:var(--tlc-navy);border:1px solid var(--tlc-edge);border-radius:999px;padding:6px 14px;text-decoration:none;}
.tlc-drawer-body{flex:1;overflow-y:auto;padding:16px 20px 22px;}
.tlc-drawer-foot{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-top:1px solid var(--tlc-edge);background:var(--tlc-parchment);}
.tlc-drawer-foot-right{display:flex;align-items:center;gap:10px;}
.tlc-drawer-delete{background:none;border:0;color:#8A4A4A;font:600 13px var(--tlc-sans);cursor:pointer;padding:8px 4px;}
.tlc-btn-primary{background:var(--tlc-navy);color:#fff;border:0;border-radius:8px;padding:10px 18px;font:600 13px var(--tlc-sans);cursor:pointer;}
.tlc-btn-quiet{background:#fff;color:var(--tlc-body);border:1px solid var(--tlc-edge);border-radius:8px;padding:9px 16px;font:600 13px var(--tlc-sans);text-decoration:none;cursor:pointer;}
.tlc-field{margin-bottom:16px;}
.tlc-label{display:block;font:600 10.5px/1 var(--tlc-sans);letter-spacing:.12em;text-transform:uppercase;color:var(--tlc-muted);margin-bottom:6px;}
.tlc-field input[type=text],.tlc-field input[type=email],.tlc-field input[type=url],.tlc-field input[type=number],.tlc-field input[type=date],.tlc-field textarea,.tlc-field select{width:100%;border:1px solid var(--tlc-edge);border-radius:8px;padding:10px 12px;font:400 13.5px var(--tlc-sans);color:var(--tlc-ink);background:#fff;outline:none;}
.tlc-field input:focus,.tlc-field textarea:focus,.tlc-field select:focus{border-color:var(--tlc-blue);box-shadow:0 0 0 3px rgba(46,126,166,.14);}
.tlc-hint{margin:5px 0 0;font-size:11.5px;line-height:1.5;color:var(--tlc-muted);text-wrap:pretty;}
.tlc-static{font-size:13.5px;color:var(--tlc-body);}
.tlc-field-toggle{display:flex;flex-direction:column;gap:4px;}
.tlc-toggle{display:flex;align-items:center;gap:10px;cursor:pointer;}
.tlc-toggle input{position:absolute;opacity:0;width:0;height:0;}
.tlc-toggle-track{flex:none;width:36px;height:20px;border-radius:999px;background:#D9D3C6;position:relative;transition:background .15s;}
.tlc-toggle-knob{position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s;}
.tlc-toggle input:checked + .tlc-toggle-track{background:var(--tlc-gold);}
.tlc-toggle input:checked + .tlc-toggle-track .tlc-toggle-knob{transform:translateX(16px);}
.tlc-toggle input:focus-visible + .tlc-toggle-track{box-shadow:0 0 0 3px rgba(46,126,166,.3);}
.tlc-toggle-label{font-size:13.5px;color:var(--tlc-ink);}
.tlc-perms{display:flex;flex-direction:column;gap:2px;border:1px solid var(--tlc-edge);border-radius:9px;padding:6px;background:var(--tlc-parchment);}
.tlc-perm{display:flex;align-items:center;gap:9px;padding:7px 8px;border-radius:6px;cursor:pointer;}
.tlc-perm:hover{background:#fff;}
.tlc-perm input{margin:0;}
.tlc-perm-name{flex:1;font-size:13px;color:var(--tlc-ink);}
.tlc-perm-key{font:400 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--tlc-muted);}
.tlc-photo{display:flex;align-items:center;gap:12px;}
.tlc-photo-preview{width:52px;height:52px;border-radius:50%;object-fit:cover;border:1px solid var(--tlc-edge);}
.tlc-photo-empty{width:52px;height:52px;border-radius:50%;background:var(--tlc-sand);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--tlc-muted);text-align:center;}
@media (max-width:760px){
  .tlc-section{padding:18px 16px 30px;}
  .tlc-thead{display:none;}
  .tlc-row{grid-template-columns:1fr !important;gap:6px;padding:14px 16px;}
  .tlc-right{text-align:left;justify-self:start;}
  .tlc-count{margin-left:0;width:100%;}
}
`;

// ── MENU EDITOR ──────────────────────────────────────────────
// The navigation is the one screen where a mistake shows to every visitor at
// once, so it gets a live preview of the real bar above the lists.
export const MENU_CSS = `
.tlc-menu-wrap{padding:20px 26px 40px;max-width:1180px;font-family:var(--tlc-sans);}
.tlc-preview{background:var(--tlc-sidebar);border-radius:12px;padding:16px 20px;margin-bottom:18px;}
.tlc-preview-bar{display:flex;align-items:center;gap:18px;flex-wrap:wrap;}
.tlc-preview-brand{display:flex;align-items:center;gap:9px;font:500 15px var(--tlc-serif);color:#fff;padding-right:12px;border-right:1px solid rgba(255,255,255,.18);}
.tlc-preview-mark{width:24px;height:24px;border-radius:6px;background:var(--tlc-gold);color:var(--tlc-gold-ink);display:flex;align-items:center;justify-content:center;font:700 12px var(--tlc-sans);}
.tlc-preview-item{font:500 13px var(--tlc-sans);color:rgba(255,255,255,.86);}
.tlc-preview-item--button{background:var(--tlc-gold);color:var(--tlc-gold-ink);font-weight:700;padding:7px 16px;border-radius:7px;}
.tlc-preview-note{margin-top:10px;font-size:11.5px;color:rgba(255,255,255,.45);}
.tlc-menu-cols{display:grid;grid-template-columns:1.35fr 1fr;gap:16px;align-items:start;}
@media (max-width:980px){.tlc-menu-cols{grid-template-columns:1fr;}}
.tlc-mi{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--tlc-divider);background:#fff;}
.tlc-mi:last-child{border-bottom:0;}
.tlc-mi.is-child{padding-left:38px;background:rgba(244,239,229,.55);}
.tlc-mi.is-drag{opacity:.4;}
.tlc-mi.is-over{box-shadow:inset 0 2px 0 var(--tlc-blue);}
.tlc-mi.is-nest{background:#E7EFF5;box-shadow:inset 3px 0 0 var(--tlc-blue);}
.tlc-mi-grip{flex:none;cursor:grab;color:var(--tlc-muted);font-size:14px;line-height:1;user-select:none;}
.tlc-mi-body{flex:1;min-width:0;}
.tlc-mi-label{display:block;font:600 13.5px var(--tlc-sans);color:var(--tlc-ink);}
.tlc-mi-sub{display:block;font-size:11.5px;color:var(--tlc-muted);margin-top:2px;overflow-wrap:anywhere;}
.tlc-mi-kind{flex:none;font:600 9.5px var(--tlc-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--tlc-muted);background:var(--tlc-sand);border-radius:999px;padding:4px 9px;}
.tlc-mi-x{flex:none;background:none;border:0;color:var(--tlc-muted);font-size:16px;line-height:1;cursor:pointer;padding:4px 6px;}
.tlc-mi-x:hover{color:#8A4A4A;}
.tlc-mi-broken{background:#FAEFEF;}
.tlc-mi-warn{padding:8px 14px 10px 38px;background:#FBF1DC;border-bottom:1px solid #EBD5A6;font-size:12px;color:#7A5B18;}
.tlc-orphan{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--tlc-divider);}
.tlc-orphan:last-child{border-bottom:0;}
.tlc-orphan-body{flex:1;min-width:0;}
.tlc-orphan-btn{flex:none;font:600 11.5px var(--tlc-sans);color:var(--tlc-navy);background:#fff;border:1px solid var(--tlc-edge);border-radius:7px;padding:6px 11px;cursor:pointer;}
.tlc-orphan-btn:hover{border-color:var(--tlc-blue);}
.tlc-menu-hint{padding:12px 16px;font-size:12.5px;line-height:1.6;color:var(--tlc-body);background:var(--tlc-parchment);border-top:1px solid var(--tlc-edge);text-wrap:pretty;}
.tlc-menu-empty{padding:26px 16px;text-align:center;font-size:13px;color:var(--tlc-muted);}
`;

// Presets sit above the permission checkboxes in the Users drawer.
export const PRESET_CSS = `
.tlc-presets{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}
.tlc-preset{font:600 12.5px var(--tlc-sans);color:var(--tlc-navy);background:#fff;border:1px solid var(--tlc-edge);border-radius:999px;padding:8px 15px;cursor:pointer;}
.tlc-preset:hover{border-color:var(--tlc-blue);background:#E7EFF5;}
`;

// ── GYM CALENDAR ─────────────────────────────────────────────
// The month view on the Gym Rentals screen. Read-only: every action that
// changes a booking lives in the Queue view, so there is one place a hold gets
// confirmed rather than two.
export const GYM_CAL_CSS = `
.gymcal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--tlc-edge);background:var(--tlc-sand);}
.gymcal-title{font:500 17px var(--tlc-serif);color:var(--tlc-navy);}
.gymcal-nav{font:600 12.5px var(--tlc-sans);color:var(--tlc-navy);text-decoration:none;border:1px solid var(--tlc-edge);background:#fff;border-radius:7px;padding:6px 12px;}
.gymcal-nav:hover{border-color:var(--tlc-blue);}
.gymcal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--tlc-divider);}
.gymcal-dow{background:var(--tlc-parchment);padding:7px 8px;font:600 10.5px var(--tlc-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--tlc-muted);text-align:center;}
.gymcal-cell{background:#fff;min-height:92px;padding:6px 7px;display:flex;flex-direction:column;gap:3px;}
.gymcal-cell--pad{background:var(--tlc-parchment);}
.gymcal-cell--today{box-shadow:inset 0 0 0 2px var(--tlc-gold);}
.gymcal-cell--blocked{background:#F4F2EE;}
.gymcal-day{font:600 11.5px var(--tlc-sans);color:var(--tlc-muted);}
.gymcal-chip{display:block;font:600 10.5px/1.35 var(--tlc-sans);padding:3px 6px;border-radius:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
/* The design's four tones. Confirmed is blue rather than green because green
   is the pill colour for "live" everywhere else and a calendar full of it
   would read as reassurance rather than information. */
.gymcal-chip--confirmed{background:#E4EEF4;color:#1E4A60;border:1px solid #C7DCE8;}
.gymcal-chip--hold{background:#FBF1DC;color:#7A5B18;border:1px solid #EBD5A6;}
.gymcal-chip--conflict{background:#FAEFEF;color:#8A4A4A;border:1px solid #E4C8C8;}
.gymcal-legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;font-size:11.5px;color:var(--tlc-body);}
.gymcal-legend span{display:flex;align-items:center;gap:6px;}
.gymcal-navs{display:flex;gap:4px;align-items:center;}
.gymcal-arrow{font:600 13px var(--tlc-sans);color:var(--tlc-muted);text-decoration:none;padding:2px 6px;border-radius:5px;}
.gymcal-arrow:hover{color:var(--tlc-navy);background:var(--tlc-parchment);}
/* Approve is the loud one and Open the quiet one, because on this screen
   approving is the decision and opening is just looking. */
.tlc-gym-approve{display:inline-flex;align-items:center;font:600 12.5px var(--tlc-sans);background:var(--tlc-navy);color:#fff;border:1px solid var(--tlc-navy);border-radius:7px;padding:7px 14px;cursor:pointer;text-decoration:none;white-space:nowrap;}
.tlc-gym-approve:hover{background:var(--tlc-ink);}
.tlc-gym-open{display:inline-flex;align-items:center;font:600 12.5px var(--tlc-sans);color:var(--tlc-navy);background:#fff;border:1px solid var(--tlc-edge);border-radius:7px;padding:7px 14px;text-decoration:none;white-space:nowrap;margin-left:6px;}
.tlc-gym-open:hover{border-color:var(--tlc-blue);}
.gymcal-blocked{font:600 10px var(--tlc-sans);color:#6A6858;text-transform:uppercase;letter-spacing:.06em;}
.gymcal-more{font-size:10.5px;color:var(--tlc-muted);}
.gymcal-key{display:flex;gap:18px;flex-wrap:wrap;padding:11px 16px;border-top:1px solid var(--tlc-edge);font-size:12px;color:var(--tlc-body);}
.gymcal-key span{display:flex;align-items:center;gap:6px;}
.gymcal-swatch{width:11px;height:11px;border-radius:3px;display:inline-block;}
.gymcal-swatch--blocked{background:#EFEFEF;border:1px solid #DDD9D0;}
@media (max-width:720px){.gymcal-cell{min-height:64px;}.gymcal-chip{font-size:9px;}}
`;

// ── ⌘K ───────────────────────────────────────────────────────
// One search over every section. Results are permission-scoped server-side —
// searching is not a way around a gate — so this is only the presentation.
export const CMDK_CSS = `
.tlc-k-scrim{position:fixed;inset:0;background:rgba(18,36,61,.38);z-index:300;display:none;}
.tlc-k-scrim.is-open{display:block;}
.tlc-k{position:fixed;top:12vh;left:50%;transform:translateX(-50%);width:min(560px,92vw);background:#fff;border:1px solid var(--tlc-edge);border-radius:13px;box-shadow:0 18px 50px rgba(18,36,61,.28);z-index:301;display:none;overflow:hidden;font-family:var(--tlc-sans);}
.tlc-k.is-open{display:block;}
.tlc-k-input{width:100%;border:0;border-bottom:1px solid var(--tlc-edge);padding:16px 18px;font:400 16px var(--tlc-sans);color:var(--tlc-ink);outline:none;}
.tlc-k-list{max-height:52vh;overflow-y:auto;}
.tlc-k-item{display:flex;align-items:center;gap:12px;padding:11px 18px;text-decoration:none;border-bottom:1px solid var(--tlc-divider);}
.tlc-k-item:last-child{border-bottom:0;}
.tlc-k-item.is-sel,.tlc-k-item:hover{background:#E7EFF5;}
.tlc-k-sec{flex:none;font:600 9.5px var(--tlc-sans);letter-spacing:.1em;text-transform:uppercase;color:var(--tlc-muted);background:var(--tlc-sand);border-radius:999px;padding:4px 9px;}
.tlc-k-label{flex:1;min-width:0;font:600 13.5px var(--tlc-sans);color:var(--tlc-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tlc-k-meta{flex:none;font-size:11.5px;color:var(--tlc-muted);max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tlc-k-empty{padding:22px 18px;font-size:13.5px;color:var(--tlc-muted);}
.tlc-k-hint{padding:9px 18px;border-top:1px solid var(--tlc-edge);background:var(--tlc-parchment);font-size:11.5px;color:var(--tlc-muted);}
`;

export const CMDK_JS = `(function(){
  var scrim = document.getElementById('tlc-k-scrim');
  var box = document.getElementById('tlc-k');
  if (!scrim || !box) return;
  var input = box.querySelector('.tlc-k-input');
  var list = box.querySelector('.tlc-k-list');
  var sel = 0, items = [], timer = null;

  function open(){ scrim.classList.add('is-open'); box.classList.add('is-open'); input.value=''; render([]); input.focus(); }
  function close(){ scrim.classList.remove('is-open'); box.classList.remove('is-open'); }
  function render(rs){
    items = rs;
    if (!rs.length) {
      list.innerHTML = '<div class="tlc-k-empty">' +
        (input.value.trim().length < 2 ? 'Type at least two letters.' : 'Nothing matching that.') + '</div>';
      return;
    }
    sel = 0;
    list.innerHTML = rs.map(function(r,i){
      return '<a class="tlc-k-item' + (i===0?' is-sel':'') + '" href="' + r.href + '">' +
        '<span class="tlc-k-sec">' + r.section + '</span>' +
        '<span class="tlc-k-label">' + r.label + '</span>' +
        '<span class="tlc-k-meta">' + (r.meta || '') + '</span></a>';
    }).join('');
  }
  function move(d){
    if (!items.length) return;
    var nodes = list.querySelectorAll('.tlc-k-item');
    nodes[sel] && nodes[sel].classList.remove('is-sel');
    sel = (sel + d + nodes.length) % nodes.length;
    nodes[sel].classList.add('is-sel');
    nodes[sel].scrollIntoView({ block: 'nearest' });
  }
  function search(){
    var q = input.value.trim();
    if (q.length < 2) { render([]); return; }
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(function(r){ return r.json(); })
      .then(function(d){ render(d.results || []); })
      .catch(function(){ render([]); });
  }

  document.addEventListener('keydown', function(e){
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); return; }
    if (!box.classList.contains('is-open')) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    if (e.key === 'Enter') {
      var node = list.querySelectorAll('.tlc-k-item')[sel];
      if (node) { e.preventDefault(); location.href = node.getAttribute('href'); }
    }
  });
  scrim.addEventListener('click', close);
  input.addEventListener('input', function(){ clearTimeout(timer); timer = setTimeout(search, 160); });
  var trigger = document.getElementById('tlc-k-open');
  if (trigger) trigger.addEventListener('click', function(e){ e.preventDefault(); open(); });
})();`;

export const CMDK_HTML = `<div class="tlc-k-scrim" id="tlc-k-scrim"></div>
<div class="tlc-k" id="tlc-k" role="dialog" aria-modal="true" aria-label="Search every section">
  <input class="tlc-k-input" type="search" placeholder="Search every section…" aria-label="Search every section" autocomplete="off">
  <div class="tlc-k-list"></div>
  <div class="tlc-k-hint">↑ ↓ to move · Enter to open · Esc to close</div>
</div>`;

// ── SORTABLE PANEL LIST ──────────────────────────────────────
// The shape the design uses inside a panel where order is the point and the
// rows are small: a grip, a name with a sub-line, an optional middle note, a
// state, and one action. Giving's Funds and Amount Tiers are both this, side
// by side — which is why it is a renderer rather than markup written twice.
//
// Reordering posts the whole resulting order to `action`, never a diff, for
// the same reason the menu does: the server renumbers from scratch, so a
// dropped row cannot leave two items claiming one position.
export function panelList({ id, reorderAction = '', rows = [], empty = 'Nothing here yet.' }) {
  if (!rows.length) return `<p class="tlc-plist-empty">${esc(empty)}</p>`;
  const body = rows.map((r) => `<div class="tlc-pl"${reorderAction ? ' draggable="true"' : ''} data-id="${esc(r.id)}">
    ${reorderAction ? '<span class="tlc-pl-grip" aria-hidden="true">⠿</span>' : ''}
    <span class="tlc-pl-text">
      <span class="tlc-pl-name">${r.nameHtml != null ? r.nameHtml : esc(r.name)}</span>
      ${r.sub ? `<span class="tlc-pl-sub">${esc(r.sub)}</span>` : ''}
    </span>
    ${r.mid != null ? `<span class="tlc-pl-mid">${esc(r.mid)}</span>` : ''}
    <span class="tlc-pl-state">${r.state || ''}</span>
    <span class="tlc-pl-act">${r.action || (r.editHref ? `<a class="tlc-edit" href="${esc(r.editHref)}">Edit</a>` : '')}</span>
  </div>`).join('');
  return `<div class="tlc-plist" id="${esc(id)}"${reorderAction ? ` data-sortlist="${esc(reorderAction)}"` : ''}>${body}</div>`;
}

export const PANEL_LIST_CSS = `
.tlc-plist{display:flex;flex-direction:column;}
.tlc-plist-empty{margin:0;padding:16px;font-size:13px;color:var(--tlc-muted);text-wrap:pretty;}
.tlc-pl{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--tlc-divider);background:var(--tlc-parchment);}
.tlc-pl:last-child{border-bottom:0;}
.tlc-pl.is-drag{opacity:.45;}
.tlc-pl.is-over{box-shadow:inset 0 2px 0 var(--tlc-blue);}
.tlc-pl-grip{flex:none;cursor:grab;color:var(--tlc-muted);font-size:14px;line-height:1;user-select:none;}
.tlc-pl-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.tlc-pl-name{font:600 13.5px/1.35 var(--tlc-sans);color:var(--tlc-ink);overflow-wrap:anywhere;}
.tlc-pl-sub{font-size:12px;line-height:1.4;color:var(--tlc-muted);text-wrap:pretty;}
.tlc-pl-mid{flex:none;font-size:12.5px;color:var(--tlc-muted);}
.tlc-pl-state{flex:none;display:flex;align-items:center;}
.tlc-pl-act{flex:none;display:flex;align-items:center;}
.tlc-give-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;}
@media (max-width:900px){.tlc-give-cols{grid-template-columns:1fr;}}
`;

export const NEWSLETTER_CSS = `
/* ── The newsletter editor ──
   Two halves: what you are writing, and what it will look like. The preview
   sticks so it stays in view while the form scrolls past it — a preview you
   have to scroll back up to check is one nobody checks. */
.tlc-nl-crumb{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px;}
.tlc-nl-when{margin:10px 0 0;font-size:13px;color:var(--tlc-muted);}
.tlc-nl-cols{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:18px;align-items:start;padding:18px 26px 40px;max-width:1180px;}
.tlc-nl-form .card:first-child{margin-top:0;}
.tlc-nl-preview{position:sticky;top:18px;display:flex;flex-direction:column;gap:0;}
.tlc-nl-preview-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;}
.tlc-nl-inbox{display:flex;flex-direction:column;gap:4px;padding:13px 15px;border:1px solid var(--tlc-edge);border-radius:11px 11px 0 0;border-bottom:0;background:var(--tlc-sand);}
.tlc-nl-inbox-subj{font:600 13.5px/1.35 var(--tlc-sans);color:var(--tlc-ink);text-wrap:pretty;}
.tlc-nl-inbox-pre{font-size:12.5px;line-height:1.45;color:var(--tlc-muted);text-wrap:pretty;}
.tlc-nl-frame{width:100%;height:min(62vh,560px);border:1px solid var(--tlc-edge);border-radius:0 0 11px 11px;background:#fff;display:block;}
/* Two small pills, not two big cards: the format is a choice between two
   things, not a menu worth a third of the screen. */
.tlc-fmt{display:flex;flex-direction:column;align-items:flex-start;gap:8px;}
.tlc-fmt-pill{font:600 13px var(--tlc-sans);color:var(--tlc-body);background:var(--tlc-parchment);border:1px solid var(--tlc-edge);border-radius:8px;padding:8px 16px;cursor:pointer;}
.tlc-fmt-pill.is-on{background:#fff;border-color:var(--tlc-blue);color:var(--tlc-navy);box-shadow:0 0 0 1px var(--tlc-blue) inset;}
.tlc-fmt-pill:disabled{opacity:.55;cursor:default;}
/* Below this the two columns cannot both be read, and a preview squeezed to
   half of a phone is worse than one you scroll to. */
@media (max-width:1060px){
  .tlc-nl-cols{grid-template-columns:1fr;padding:18px 20px 40px;}
  .tlc-nl-preview{position:static;}
}
`;

export const PANEL_LIST_JS = `(function(){
  // Wires every [data-sortlist] on the page. Same contract as the menu: on
  // drop, the whole resulting order is posted to the list's action.
  var dragged = null;
  function rows(list){ return Array.prototype.slice.call(list.querySelectorAll('.tlc-pl')); }
  function save(list){
    var f = document.createElement('form');
    f.method = 'POST'; f.action = list.dataset.sortlist; f.style.display = 'none';
    var i = document.createElement('input');
    i.type = 'hidden'; i.name = 'order';
    i.value = JSON.stringify(rows(list).map(function(r){ return r.dataset.id; }));
    f.appendChild(i); document.body.appendChild(f); f.submit();
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-sortlist]'), function(list){
    list.addEventListener('dragstart', function(e){
      var row = e.target.closest('.tlc-pl'); if (!row || !list.contains(row)) return;
      dragged = row; row.classList.add('is-drag');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', row.dataset.id); } catch(_){}
    });
    list.addEventListener('dragend', function(){
      if (dragged) dragged.classList.remove('is-drag');
      rows(list).forEach(function(r){ r.classList.remove('is-over'); });
      dragged = null;
    });
    list.addEventListener('dragover', function(e){
      if (!dragged || !list.contains(dragged)) return;
      e.preventDefault();
      var row = e.target.closest('.tlc-pl');
      rows(list).forEach(function(r){ r.classList.remove('is-over'); });
      if (row && row !== dragged) row.classList.add('is-over');
    });
    list.addEventListener('drop', function(e){
      if (!dragged || !list.contains(dragged)) return;
      e.preventDefault();
      var row = e.target.closest('.tlc-pl');
      if (row && row !== dragged) list.insertBefore(dragged, row);
      rows(list).forEach(function(r){ r.classList.remove('is-over'); });
      save(list);
    });
  });
})();`;
