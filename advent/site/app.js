/* Advent devotional viewer. No cookies, no storage, no third-party requests. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MIN_PAGE = 240;          // narrower than this per page → single-page mode
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);

  let m;                // manifest
  let book;             // PageFlip instance
  let idx = 0;          // current page index (0 = cover)
  let textMode = false;
  let textTarget = null; // { day } or { index }
  let today = null;     // day object for today, if in season
  const pageEls = [];

  // ── Dates ────────────────────────────────────────────────────────────────
  function chicagoDate(tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function effectiveDate() {
    const q = params.get('date');
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q) && !Number.isNaN(Date.parse(q + 'T12:00:00Z'))) return { date: q, overridden: true };
    return { date: chicagoDate(m.timeZone || 'America/Chicago'), overridden: false };
  }
  const shortLabel = (d) => d.label.replace(/^(\w{3})\w*, (\w{3})\w* /, '$1, $2 ');

  // ── Page / spread helpers ────────────────────────────────────────────────
  const count = () => m.pageCount;
  const portrait = () => book && book.getOrientation() === 'portrait';
  function spreadOf(i) {
    if (portrait() || i === 0) return [i];
    if (i === count() - 1 && count() % 2 === 0) return [i];
    const left = i % 2 === 1 ? i : i - 1;
    return [left, left + 1].filter((n) => n < count());
  }
  const dayForIndex = (i) => m.days.find((d) => d.page - 1 === i || d.page === i);
  const daySlugFromPath = () => {
    const s = (body.dataset.day || location.pathname.replace(/^\/|\.html$|\/$/g, '')).toLowerCase();
    return m.days.find((d) => d.slug === s);
  };
  const body = document.body;

  // ── Sizing ───────────────────────────────────────────────────────────────
  function sizeBook() {
    const stage = $('stage');
    const el = $('book-wrap');
    const W = stage.clientWidth;
    const aspect = m.pageSize.width / m.pageSize.height;
    const controls = 64 + ($('hint').offsetHeight || 0) + 12;
    const availH = Math.max(320, document.documentElement.clientHeight - (stage.getBoundingClientRect().top + window.scrollY) - controls);
    const landscapeW = Math.min(W, availH * 2 * aspect, 2200);
    let w;
    if (W >= 560 && landscapeW >= 2 * MIN_PAGE) w = landscapeW;
    else w = Math.min(W, 2 * MIN_PAGE - 1); // phones: one page, full width (scrolls if needed)
    el.style.width = Math.floor(w) + 'px';
  }

  // ── Images: load only the pages near the reader ─────────────────────────
  function wantLarge() {
    const r = book ? book.getBoundsRect() : null;
    const pw = r ? r.pageWidth : 400;
    return pw * (window.devicePixelRatio || 1) > 860;
  }
  function loadAround(i) {
    const large = wantLarge();
    for (let k = i - 2; k <= i + 5; k++) {
      const el = pageEls[k];
      if (!el) continue;
      const img = el.firstChild;
      const src = large ? m.pages[k].img.lg : m.pages[k].img.sm;
      if (img.dataset.loaded === 'lg' || img.dataset.loaded === (large ? 'lg' : 'sm')) continue;
      img.src = src;
      img.dataset.loaded = large ? 'lg' : 'sm';
    }
  }

  // ── Status line, URL, buttons ────────────────────────────────────────────
  function update(i) {
    idx = i;
    const sp = spreadOf(i);
    const n = sp.map((k) => k + 1);
    let where;
    if (sp[0] === 0) where = 'Cover';
    else if (sp[0] === count() - 1) where = 'Back cover';
    else if (n.length === 2) where = `Pages ${n[0]}–${n[1]} of ${count()}`;
    else where = `Page ${n[0]} of ${count()}`;
    const day = sp.map(dayForIndex).find(Boolean);
    const extra = !day && m.extras.find((e) => sp.includes(e.page - 1));
    const heading = day ? `${day.label}: ${day.title}` : extra ? extra.label : '';
    $('counter').innerHTML = (heading ? `<strong>${esc(heading)}</strong>` : '') + esc(where);
    $('btn-prev').disabled = i <= 0;
    $('btn-next').disabled = sp[sp.length - 1] >= count() - 1;
    const path = day ? `/${day.slug}` : '/';
    const search = params.toString() ? `?${params}` : '';
    if (location.pathname !== path) history.replaceState(null, '', path + search + location.hash);
    document.title = day ? `${day.label}: ${day.title} · ${m.title}` : `${m.title}: ${m.subtitle}`;
    loadAround(i);
  }

  function goTo(i, animate = true) {
    i = Math.max(0, Math.min(count() - 1, i));
    if (spreadOf(i).includes(idx)) return update(idx);
    const far = Math.abs(i - idx) > 2;
    if (animate && !far && !reduceMotion) book.flip(i);
    else { book.turnToPage(i); update(book.getCurrentPageIndex()); }
  }
  function step(dir) {
    if (reduceMotion) {
      const sp = spreadOf(idx);
      goTo(dir > 0 ? sp[sp.length - 1] + 1 : sp[0] - 1, false);
    } else if (dir > 0) book.flipNext(); else book.flipPrev();
  }

  // ── Text view ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Artwork cut from a page by the build; shown in the text view where the page has it.
  const artHtml = (k, alt) => ((m.pages[k] && m.pages[k].art) || []).map((a) =>
    `<figure class="tv-art"><img src="${a.src}" width="${a.width}" height="${a.height}" alt="${esc(alt)}" loading="lazy" decoding="async"></figure>`).join('');
  const paras = (text) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const isHeading = (p) => !p.includes('\n') && p.length <= 32 && !/[.,;:!?”"]$/.test(p);
  const pHtml = (p, cls) => (!cls && isHeading(p) ? `<h3>${esc(p)}</h3>`
    : `<p${cls ? ` class="${cls}"` : ''}>${esc(p).replace(/\n/g, '<br>')}</p>`);

  function renderText(target) {
    textTarget = target;
    const art = $('tv-article');
    let html = '';
    const day = target.day;
    if (day) {
      const left = paras(m.pages[day.page - 1].text);
      const at = left.findIndex((p) => p.split('\n')[0].trim() === day.label);
      const before = at > 0 ? left.slice(0, at) : [];
      const rest = at >= 0 ? left.slice(at) : left.slice();
      const strip = (p, line) => (p && p.split('\n')[0].trim() === line ? p.split('\n').slice(1).join('\n').trim() : p);
      rest[0] = strip(rest[0], day.label);
      if (!rest[0]) rest.shift();
      if (day.title) rest[0] = strip(rest[0], day.title);
      if (!rest[0]) rest.shift();
      html += before.map((p) => pHtml(p, 'tv-eyebrow')).join('');
      html += `<p class="tv-date">${esc(day.label)}</p><h2 tabindex="-1">${esc(day.title)}</h2>`;
      html += rest.map((p) => pHtml(p)).join('');
      html += artHtml(day.page - 1, `Artwork for ${day.label}`);
      const right = m.pages[day.page] ? paras(m.pages[day.page].text) : [];
      const rightArt = artHtml(day.page, `Artwork for ${day.label}`);
      if (right.length || rightArt) html += '<hr>' + rightArt + right.map((p) => pHtml(p)).join('');
      const k = m.days.indexOf(day);
      const prev = m.days[k - 1];
      const next = m.days[k + 1];
      $('tv-prev').hidden = !prev;
      $('tv-next').hidden = !next;
      if (prev) { $('tv-prev').textContent = `‹ ${prev.label}`; $('tv-prev').onclick = () => openText({ day: prev }); }
      if (next) { $('tv-next').textContent = `${next.label} ›`; $('tv-next').onclick = () => openText({ day: next }); }
      $('tv-nav').hidden = false;
      const search = params.toString() ? `?${params}` : '';
      history.replaceState(null, '', `/${day.slug}${search}#text`);
      document.title = `${day.label}: ${day.title} · ${m.title}`;
    } else {
      const sp = spreadOf(target.index);
      const extra = m.extras.find((e) => sp.includes(e.page - 1));
      const name = sp[0] === 0 ? m.title : extra ? extra.label : `Page ${sp[0] + 1}`;
      html += `<h2 tabindex="-1">${esc(name)}</h2>`;
      html += sp.map((k) => artHtml(k, `Image from page ${k + 1}`)
        + paras(m.pages[k].text).filter((p) => p !== name).map((p) => pHtml(p)).join('')).join('<hr>');
      $('tv-nav').hidden = true;
    }
    art.innerHTML = html;
  }

  function openText(target) {
    textMode = true;
    renderText(target);
    $('reader').classList.add('closed');
    $('textview').classList.add('open');
    $('tv-back-wrap').hidden = false;
    $('btn-text').setAttribute('aria-pressed', 'true');
    const h = $('tv-article').querySelector('h2');
    if (h) h.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function closeText() {
    textMode = false;
    $('reader').classList.remove('closed');
    $('textview').classList.remove('open');
    $('btn-text').setAttribute('aria-pressed', 'false');
    history.replaceState(null, '', location.pathname + location.search);
    const target = textTarget && textTarget.day ? textTarget.day.page - 1 : idx;
    requestAnimationFrame(() => {
      sizeBook();
      book.update();
      goTo(target, false);
      update(book.getCurrentPageIndex());
      $('btn-text').focus();
    });
  }
  function textTargetForCurrent() {
    const day = spreadOf(idx).map(dayForIndex).find(Boolean);
    return day ? { day } : { index: idx };
  }

  // ── Contents ─────────────────────────────────────────────────────────────
  function buildContents() {
    const link = (href, inner, attrs = '') => `<li><a href="${href}"${attrs}>${inner}</a></li>`;
    const extraLink = (e) => link(`/?page=${e.page}`, `<span class="t">${esc(e.label)}</span>`, ` data-page="${e.page}"`);
    let html = '<h3>Front of the booklet</h3><ul>' + link('/?page=1', '<span class="t">Cover</span>', ' data-page="1"');
    html += m.extras.filter((e) => e.position !== 'end').map(extraLink).join('') + '</ul>';
    for (const w of m.weeks) {
      if (!w.days.length) continue;
      html += `<h3>${esc(w.label)}</h3><ul>`;
      for (const slug of w.days) {
        const d = m.days.find((x) => x.slug === slug);
        const tag = today === d ? '<span class="today-tag">Today</span>' : '';
        html += link(`/${d.slug}`, `<span class="d">${esc(shortLabel(d))}</span><span class="t">${esc(d.title)}</span>${tag}`,
          ` data-slug="${d.slug}" aria-label="${esc(d.label)}: ${esc(d.title)}${tag ? ' (today)' : ''}"`);
      }
      html += '</ul>';
    }
    html += '<h3>Back of the booklet</h3><ul>' + m.extras.filter((e) => e.position === 'end').map(extraLink).join('');
    html += link(`/?page=${count()}`, '<span class="t">Back cover</span>', ` data-page="${count()}"`) + '</ul>';
    $('contents-list').innerHTML = html;
    $('contents-list').addEventListener('click', (ev) => {
      const a = ev.target.closest('a');
      if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
      ev.preventDefault();
      $('contents').close();
      const d = a.dataset.slug && m.days.find((x) => x.slug === a.dataset.slug);
      const i = d ? d.page - 1 : Number(a.dataset.page) - 1;
      if (textMode) openText(d ? { day: d } : { index: i });
      else goTo(i, false);
    });
  }
  function openContents() {
    const sp = spreadOf(idx);
    const cur = textMode && textTarget && textTarget.day ? textTarget.day : sp.map(dayForIndex).find(Boolean);
    $('contents-list').querySelectorAll('a').forEach((a) => {
      const on = cur ? a.dataset.slug === cur.slug : sp.includes(Number(a.dataset.page) - 1);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('contents').showModal();
    const curEl = $('contents-list').querySelector('[aria-current]');
    if (curEl) curEl.scrollIntoView({ block: 'center' });
  }

  // ── Start ────────────────────────────────────────────────────────────────
  async function start() {
    try {
      const res = await fetch(`/manifest.json?v=${body.dataset.version || ''}`);
      if (!res.ok) throw new Error(res.status);
      m = await res.json();
    } catch (e) {
      document.documentElement.classList.replace('js', 'no-js');
      const n = $('notice');
      n.textContent = 'The page-turning booklet could not load. You can still read the text below or download the PDF.';
      n.hidden = false;
      return;
    }

    const now = effectiveDate();
    const first = m.days[0];
    const last = m.days[m.days.length - 1];
    let notice = '';
    if (now.date < first.date) notice = `Daily devotions begin ${first.label}. Until then, feel free to look ahead.`;
    else if (now.date > last.date) notice = `Advent ${m.year} has ended. Every devotion is still here: choose any day from Days.`;
    else today = m.days.find((d) => d.date === now.date) || null;
    if (now.overridden) notice = `${notice} (Test date: ${now.date}.)`.trim();
    if (notice) { $('notice').textContent = notice; $('notice').hidden = false; }
    $('btn-today').hidden = !today;

    // Starting page: a day link, ?page=N, today, or the cover.
    const pathDay = daySlugFromPath();
    const pageParam = Number(params.get('page'));
    let startIndex = 0;
    if (pathDay) startIndex = pathDay.page - 1;
    else if (pageParam >= 1 && pageParam <= m.pageCount) startIndex = pageParam - 1;
    else if (today) startIndex = today.page - 1;

    // Pages
    const el = $('book');
    m.pages.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'page';
      if (i === 0 || i === m.pages.length - 1) div.dataset.density = 'hard';
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      div.appendChild(img);
      el.appendChild(div);
      pageEls.push(div);
    });

    window.addEventListener('resize', sizeBook);
    sizeBook();
    book = new St.PageFlip(el, {
      width: m.pageSize.width,
      height: m.pageSize.height,
      size: 'stretch',
      minWidth: MIN_PAGE,
      maxWidth: 1100,
      minHeight: 300,
      maxHeight: 1700,
      autoSize: true,
      showCover: true,
      usePortrait: true,
      mobileScrollSupport: true,
      maxShadowOpacity: 0.25,
      flippingTime: reduceMotion ? 1 : 700,
      startPage: startIndex,
      swipeDistance: 30,
    });
    // The library reports page 0 while it sets up; listen only once it's ready.
    let ready = false;
    book.on('flip', (e) => { if (ready) update(e.data); });
    book.on('changeOrientation', () => { if (ready) update(idx); });
    book.on('init', (e) => { ready = true; update(e.data.page); });
    idx = startIndex;
    book.loadFromHTML(pageEls);
    update(startIndex);
    addEventListener('resize', () => loadAround(idx));

    // Controls
    $('btn-prev').addEventListener('click', () => step(-1));
    $('btn-next').addEventListener('click', () => step(1));
    $('btn-today').addEventListener('click', () => (textMode ? openText({ day: today }) : goTo(today.page - 1)));
    $('btn-contents').addEventListener('click', openContents);
    $('contents-close').addEventListener('click', () => $('contents').close());
    $('contents').addEventListener('click', (ev) => { if (ev.target === $('contents')) $('contents').close(); });
    $('btn-text').addEventListener('click', () => (textMode ? closeText() : openText(textTargetForCurrent())));
    $('tv-back').addEventListener('click', closeText);
    document.addEventListener('keydown', (ev) => {
      if (textMode || $('contents').open || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
      if (ev.key === 'ArrowRight' || ev.key === 'PageDown') { ev.preventDefault(); step(1); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); step(-1); }
      else if (ev.key === 'Home') { ev.preventDefault(); goTo(0, false); }
      else if (ev.key === 'End') { ev.preventDefault(); goTo(count() - 1, false); }
    });
    buildContents();
    if (location.hash === '#text') openText(pathDay ? { day: pathDay } : textTargetForCurrent());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
