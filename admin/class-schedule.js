// ── A BIBLE CLASS'S MEETING TIME, AS DATA ───────────────────────────────────
// `bible_classes.schedule` used to be the only thing a class knew about when
// it met — free text like "1st & 3rd Saturdays · 8:00 AM". A person can read
// that; the church calendar cannot, so every class had to be typed into Google
// a second time or it was missing from the month.
//
// The class now carries the pattern itself: which weekdays, which weeks of the
// month, a start and optional end time, and an optional season. From that one
// record this module derives BOTH things the rest of the site needs:
//   · the display line (`composeSchedule`), stored back into `schedule` so the
//     education page, the newsletter picker and search keep working unchanged;
//   · the dated occurrences (`classOccurrences`) the calendar feed draws.
//
// ⚠ TIMES ARE CHURCH WALL CLOCKS, like every time in admin/calendar.js — plain
// `HH:MM` text, assembled by concatenation, never turned into an instant.
//
// A class with no weekday or no start time ("By arrangement") is simply not on
// the calendar; its schedule line is whatever the note says.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Which weeks of the month. '' is every week. Week N is days 7N-6 … 7N, so
// "1st Saturday" is the first Saturday of the month, however the month falls.
export const WEEK_PATTERNS = [
  { value: '',    label: 'Every week' },
  { value: '1,3', label: '1st & 3rd' },
  { value: '2,4', label: '2nd & 4th' },
  { value: '1',   label: '1st only' },
  { value: '2',   label: '2nd only' },
  { value: '3',   label: '3rd only' },
  { value: '4',   label: '4th only' },
];
const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// '0,6' / ['0','6'] → [0, 6], sorted, deduped, anything else dropped.
export function parseDays(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return [...new Set(list.map((d) => String(d).trim()).filter((d) => /^[0-6]$/.test(d)).map(Number))].sort((a, b) => a - b);
}

export function parseWeeks(raw) {
  const s = String(raw || '').trim();
  return WEEK_PATTERNS.some((p) => p.value === s) ? s : '';
}

// `HH:MM`, or null — the same rule as normalizeClock() in admin/calendar.js.
export function cleanTime(hm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)/.exec(String(hm || '').trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

// '09:30' → { h: 9, m: '30', pm: false }
const parts = (hm) => {
  const [H, M] = hm.split(':');
  const h24 = Number(H);
  return { h: h24 % 12 || 12, m: M, pm: h24 >= 12 };
};
export function formatTime(hm) {
  const p = parts(hm);
  return `${p.h}:${p.m} ${p.pm ? 'PM' : 'AM'}`;
}
// "9:30–10:15 AM" when both halves share a meridiem, "11:30 AM–12:30 PM" when not.
export function formatTimeRange(start, end) {
  if (!end || end <= start) return formatTime(start);
  const a = parts(start), b = parts(end);
  const first = a.pm === b.pm ? `${a.h}:${a.m}` : formatTime(start);
  return `${first}–${formatTime(end)}`;
}

// The line shown on /education and in the newsletter picker.
export function composeSchedule({ days, weeks, start, end, note }) {
  const d = parseDays(days);
  const t = cleanTime(start);
  const extra = String(note || '').trim();
  if (!d.length || !t) return extra;
  const w = parseWeeks(weeks);
  const plural = !w; // "Sundays" every week; "1st & 3rd Saturdays" reads plural too
  const names = d.map((i) => WEEKDAYS[i] + (plural || w.includes(',') ? 's' : ''));
  const dayText = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0];
  const weekText = w ? w.split(',').map((n) => ORD[n]).join(' & ') + ' ' : '';
  return [`${weekText}${dayText}`, formatTimeRange(t, cleanTime(end)), extra].filter(Boolean).join(' · ');
}

// ── READING AN OLD FREE-TEXT SCHEDULE ───────────────────────────────────────
// Only used to PREFILL the form for a class saved before these fields existed,
// so the office confirms a guess instead of retyping. Nothing is stored until
// they save, and the form shows the old line beside the guess.
const DAY_RE = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday|rsday)?s?\b/gi;
const DAY_KEY = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(?:[–—-]\s*(\d{1,2})(?::(\d{2}))?)?\s*(a\.?m\.?|p\.?m\.?)/i;

const to24 = (h, m, pm) => `${String((Number(h) % 12) + (pm ? 12 : 0)).padStart(2, '0')}:${m || '00'}`;

export function parseScheduleText(text) {
  const out = { days: [], weeks: '', start: '', end: '', note: '' };
  const segs = String(text || '').split(/\s+·\s+|\s+\|\s+/).map((s) => s.trim()).filter(Boolean);
  const rest = [];
  let sawDay = false, sawTime = false;
  for (const seg of segs) {
    let used = false;
    if (!sawDay) {
      const found = [...seg.matchAll(DAY_RE)].map((m) => DAY_KEY[m[1].toLowerCase()]).filter((n) => n != null);
      if (found.length) {
        out.days = parseDays(found);
        const ords = [...seg.matchAll(/\b([1-4])(?:st|nd|rd|th)\b/gi)].map((m) => m[1]).join(',');
        out.weeks = parseWeeks(ords);
        sawDay = used = true;
      }
    }
    if (!sawTime) {
      const m = TIME_RE.exec(seg);
      if (m) {
        const pm = /^p/i.test(m[5]);
        if (m[3]) {
          out.end = to24(m[3], m[4], pm);
          let s = to24(m[1], m[2], pm);
          if (s >= out.end) s = to24(m[1], m[2], false);
          out.start = s;
        } else {
          out.start = to24(m[1], m[2], pm);
        }
        sawTime = used = true;
      }
    }
    if (!used) rest.push(seg);
  }
  if (!out.days.length || !out.start) return { days: [], weeks: '', start: '', end: '', note: String(text || '').trim() };
  out.note = rest.join(' · ');
  return out;
}

// ── DATED OCCURRENCES ───────────────────────────────────────────────────────
// Every date in [from, to] (inclusive, 'YYYY-MM-DD') the class meets, clipped
// to its season. Plain UTC-date arithmetic on calendar days, never local time.
export function classDates(row, from, to) {
  const days = parseDays(row && row.meet_days);
  if (!days.length || !cleanTime(row.start_time) || !isYmd(from) || !isYmd(to)) return [];
  const weeks = parseWeeks(row.weeks);
  const wantWeeks = weeks ? weeks.split(',').map(Number) : null;
  const lo = isYmd(row.start_date) && row.start_date > from ? row.start_date : from;
  const hi = isYmd(row.end_date) && row.end_date < to ? row.end_date : to;
  const out = [];
  const [y, m, d] = lo.split('-').map(Number);
  // A month and change is all the feed ever asks for; the cap only guards
  // against a malformed window turning into an endless loop.
  for (let t = Date.UTC(y, m - 1, d), i = 0; i < 800; t += 86400000, i++) {
    const dt = new Date(t);
    const ymd = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    if (ymd > hi) break;
    if (!days.includes(dt.getUTCDay())) continue;
    if (wantWeeks && !wantWeeks.includes(Math.ceil(dt.getUTCDate() / 7))) continue;
    out.push(ymd);
  }
  return out;
}
