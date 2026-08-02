# Implementation Phases

Nine phases, ordered so that **every phase ships something usable** and nothing is half-migrated at the end of a week. Read `README.md` first for the spec; this file is the build order and the definition of done.

Stack assumption: existing Cloudflare Worker (`tlc-admin-worker.js`) + D1, server-rendered HTML with `sidebarShell()`. No framework migration. The prototypes are read for structure and values, never ported.

---

## Phase 0 — Groundwork (½ day)

Nothing user-visible. Makes every later phase cheap.

1. **Extract the shared list renderer.** One function that takes a config and emits the whole pattern from §3:

```js
renderListSection({
  key: 'staff',
  title: 'Staff directory',
  purpose: 'One record per person. Every page that shows staff reads from here…',
  action: { label: '+ Add person', href: '/staff/new' },
  search: 'Search staff',
  filters: ['All', 'On the website', 'Hidden'],
  columns: [
    { label: 'Person', width: '2.2fr' },
    { label: 'Email',  width: '1.8fr' },
    { label: 'Order',  width: '.7fr'  },
    { label: 'Photo',  width: '1fr'   }
  ],
  rows,                    // [{ cells:[…], warn?, warnCta?, href }]
  note: 'Photo crop is set per person and reused everywhere…'
})
```

2. **Extract the drawer renderer** — takes a field list (`text` / `textarea` / `toggle` / `choice` / `photo` / `perms`) and emits the panel with `Delete · Cancel · Save`.
3. **Add the status-pill and value-chip helpers** using the exact tones in §6.
4. **Add the CSS custom properties** for the palette to `sidebarShell()`.

**Done when:** one existing section (pick Notices — smallest) is re-rendered through the new helpers and looks identical to `screenshots/notices.png`.

---

## Phase 1 — Sidebar and Dashboard (1½ days)

The first thing anyone notices, and it sets the IA for everything after.

1. Rebuild the sidebar per §4: three groups, nesting under Pages, active marker (gold inset bar + gold dot), badge counts.
2. Badge queries: pending gym requests, pages with draft edits, newsletter awaiting approval.
3. Build the **"Needs you"** dashboard — the three task queries in §5.1, each row deep-linking with an action button.
4. Build **Our Four Values** — needs the `value` column from Phase 2, so ship the cards reading a hardcoded map first and swap to the column when Phase 2 lands.
5. **This Sunday** and **Last 24 hours** panels.

**Done when:** every section is reachable from the new sidebar, badges match reality, and every dashboard task button lands on the right screen with the right filter applied.

---

## Phase 2 — Convert the content sections (2–3 days)

Six sections, all pure applications of the Phase 0 helpers. Fastest visible progress in the project.

Order: **Notices → Christian Ed → News & Events → Sermons → Ministries → Partners**

Per section: define the config, map the query to rows, write the `◆` note, wire the drawer fields.

Schema work in this phase:

```sql
-- core value tagging, used by Ministries, News, Christian Ed, Partners
ALTER TABLE youth_pages   ADD COLUMN value TEXT;   -- 'acceptance'|'worship'|'education'|'outreach'
ALTER TABLE news_items    ADD COLUMN value TEXT;
ALTER TABLE bible_classes ADD COLUMN value TEXT;

-- sermons: media may not exist yet
ALTER TABLE sermon_notes ADD COLUMN media_url TEXT;   -- nullable on purpose

-- partners
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_name TEXT,
  value TEXT NOT NULL,
  blurb TEXT,
  site_url TEXT,
  also_note TEXT,        -- CFNA: Pastor Rall & Mary Ann, Papua New Guinea
  sort_order INTEGER DEFAULT 0
);

-- ministries: menu visibility separate from published state
ALTER TABLE youth_pages ADD COLUMN in_menu INTEGER DEFAULT 1;
```

Also in this phase:
- **Merge News and Events & Calendar** into one `/news` page; write `/events` (automatic) and `/calendar` (hand-made) redirects.
- **Latest-sermon block branches on `media_url`** (§5.6) — do this now so the site is correct before anyone starts attaching recordings.

**Done when:** all six screens match their screenshots, value chips filter correctly, `/events` and `/calendar` redirect, and a sermon with no `media_url` renders the text-only card on the public site.

---

## Phase 3 — Pages, short links, redirects (2 days)

1. **Short-link generation** — derive from the last address segment on save.
2. **Clash detection** — a unique index on the short link plus a check that surfaces the `LINK CLASH` pill and warning row rather than failing the save.
3. **Automatic 301s** on rename, written to `redirects` with `kind = 'automatic'`.
4. Redirects section through the Phase 0 helpers, with the three kinds.
5. Ministries short links: `/youth` **and** `/ministries/youth` both resolve.

**Done when:** renaming a page leaves the old address working, two pages cannot silently take the same short link, and every ministry answers on both addresses.

---

## Phase 4 — Menu editor (2 days)

The first genuinely bespoke screen.

```sql
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu TEXT NOT NULL DEFAULT 'header',   -- 'header' | 'footer'
  label TEXT NOT NULL,
  kind TEXT NOT NULL,                    -- 'page' | 'external' | 'short'
  target TEXT NOT NULL,
  style TEXT DEFAULT 'link',             -- 'link' | 'button'
  depth INTEGER DEFAULT 0,               -- 0 or 1; header only
  sort_order INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1
);
```

1. Seed from the current hardcoded header and footer.
2. Drag to reorder; **drop onto an item's name to nest**; drag between header and footer. Persist `sort_order` and `depth` on drop.
3. **Live header preview** rendered from visible depth-0 items.
4. **Orphan panel** — live pages with no menu item, with Header / Footer buttons and drag-out.
5. **✕ removes an item**, page stays live, item reappears as an orphan.
6. **Flag broken targets** — an item pointing at a page that is draft, hidden, or deleted gets a warning row.
7. Enforce the rules: two levels max, one button, label may differ from page name.

**Done when:** the live site header is driven entirely by `menu_items`, a page can be added to the menu without touching code, and deleting a page flags every item pointing at it.

---

## Phase 5 — Newsletter editor (3–4 days)

The biggest single piece. Everything the old `/edit/35` did, plus the additions in §5.13.

```sql
ALTER TABLE newsletters ADD COLUMN preheader TEXT;
ALTER TABLE newsletters ADD COLUMN audience TEXT DEFAULT 'everyone';
ALTER TABLE newsletters ADD COLUMN include_sermon INTEGER DEFAULT 1;
ALTER TABLE newsletters ADD COLUMN include_bulletin INTEGER DEFAULT 1;
ALTER TABLE newsletters ADD COLUMN blocks TEXT;   -- JSON: [{key,label,on}]
ALTER TABLE newsletters ADD COLUMN extras TEXT;   -- JSON: [{label,text}]
```

Build order inside the phase:

1. **Two-column shell** — form left, preview right, sticky.
2. **Basics** — subject with the 60-character warning, preheader with its count, format, publish date, audience with subscriber count.
3. **Seven TinyMCE instances** via the existing `tinymceNoteSection()` helper: pastor's note, second note, third note, Word of Life, LASM, and each extra note. Full toolbar per §5.13.
4. **Pickers** — news items over `news_items`, classes over `bible_classes`. Store id arrays. **Read through at send time** so an edited post updates an unsent issue.
5. **Events** — child rows in `events`, editable inline, add and delete, plus "pull the next three from the calendar".
6. **Third note + its own CTA**, below the partner blocks.
7. **"+ Add another note"** — extras array with editable heading and its own editor.
8. **Blocks on/off** — one switch per block, pastor's note locked. Hides from form *and* email.
9. **Live preview** — render the same builder the email uses, at reduced scale, so preview and send cannot diverge.
10. **Sent = read-only.** Enforce server-side too, not just in the UI: reject writes to a newsletter with `status = 'sent'`. Offer **Duplicate as draft**.
11. **Two-person approval** — `newsletter_edit` submits, `newsletter_approve` schedules.

**Done when:** an issue can be built end to end without touching code, the preview matches the delivered email, a sent issue cannot be modified by any path including a direct POST, and duplicating a sent issue produces an editable draft.

---

## Phase 6 — People & Ops: Staff, Users, Subscribers (1½ days)

1. **Staff** through the helpers, with **per-person photo crop** stored on the record and read by every page that shows staff.
2. **Users** — the 14 permission checkboxes with presets above them, permission keys shown in monospace. Disable rather than delete.
3. **Subscribers** — read-only mirror; the note stating that unsubscribes come from the provider.

**Done when:** changing one staff photo crop updates every page, and a user's real reachable sections match their ticked boxes exactly.

---

## Phase 7 — Gym Rentals and Giving (3 days)

**Gym** (2 days) — pick a layout from §5.16, then:
1. Group portal links; holds with a **48-hour lapse sweep**.
2. Conflict detection against existing bookings and `gym_blocked_dates`.
3. Approve / decline with notification email.
4. Invoices at the Settings hourly rate; unpaid totals; payment link.
5. Confirmed bookings push to Google Calendar.

**Giving** (1 day):
1. **Two page surfaces** — standalone `give.timothystl.org` and `/give` on the site, sharing one set of blocks with a **keep-in-step** flag.
2. **Funds** — addable, on/off, drag to reorder, Gym Rental Payments locked off the public page.
3. **Tiers** — drag to reorder, one default, "Other" always on.
4. **Gift vs Payment tagging** on giving links, so vendor payments and rental fees never appear on a year-end giving statement.
5. **One platform link** read by the Give block, newsletter footer, and gym invoices.

**Done when:** a hold left alone for 48 hours lapses on its own, an invoice reconciles against the Settings rate, and a Payment-tagged link is excluded from donation receipting.

---

## Phase 8 — Payroll (2–3 days)

```sql
CREATE TABLE IF NOT EXISTS pay_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  starts TEXT NOT NULL,
  ends TEXT NOT NULL,
  pay_date TEXT,
  state TEXT DEFAULT 'open',      -- 'open' | 'approved' | 'paid'
  approved_by TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id INTEGER NOT NULL,
  staff_id INTEGER,                -- NULL until an import is matched
  import_name TEXT,                -- raw name from the childcare app
  org TEXT NOT NULL,               -- 'church' | 'mdo'
  kind TEXT NOT NULL,              -- 'salaried' | 'hourly' | 'childcare'
  hours REAL DEFAULT 0,
  pto_used REAL DEFAULT 0,
  status TEXT DEFAULT 'submitted', -- submitted|approved|imported|unmatched
  UNIQUE(period_id, staff_id)
);

CREATE TABLE IF NOT EXISTS pay_lines (   -- salaried components
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timesheet_id INTEGER NOT NULL,
  label TEXT NOT NULL,             -- Base Salary | Housing Allowance | Mileage
  amount REAL NOT NULL
);
```

1. **Period dropdown** and Enter & approve / Report toggle; **Print report** and **Export CSV** together in the header.
2. **Entry view** — steppers for hourly, "n/a" for salaried, PTO used, per-row and bulk approve.
3. **Childcare import** — pull timesheets, match on name, leave unmatched rows visibly unmatched with a "Match person" action. Never guess a match.
4. **Three report layouts** (§5.19). Church staff and MDO grouped with subtotals, then the combined total. Gross pay only.
5. **Locking** — once a period is paid, hours are static, approvals are gone, and **Reopen period** is the only way in. Enforce server-side.
6. **Format every hours figure to 2dp.** Decimal childcare hours produce floating-point artefacts otherwise.
7. Gate the whole section behind `payroll_manage`; write every approval and reopen to the audit log.

**Done when:** a period can be entered, approved, printed in all three layouts, and then cannot be edited without an audited reopen; and an unmatched import cannot reach a printed report unflagged.

---

## Phase 9 — Media, Audit Log, ⌘K (2 days)

1. **Media** — the `media` table, alt-text field, **resize on upload with a confirmed sub-1 MB result**, over-limit warning rows, "Used nowhere" detection.
2. **Audit log** — before/after capture on every mutating route, the diff drawer, and **roll back** (which writes its own entry).
3. **⌘K** — one search across sections, returning "Section · row" results.

**Done when:** no image over 1 MB can be stored, every mutating action appears in the log with a usable before/after, and rolling back a change restores the prior value and is itself logged.

---

## Cross-cutting requirements

Apply in every phase, not at the end.

- **Server-side permission checks on every route**, not just hidden UI. The 14 permission names are the contract.
- **Audit every mutation** from Phase 2 onward, so the log is complete when Phase 9 renders it.
- **Locked states enforced server-side** — paid payroll periods, sent newsletters. A direct POST must be rejected.
- **No free-form style input anywhere.** Colours from the palette, spacing from the 8px scale, fonts fixed by the theme.
- **Every count label scoped to its filters.** "5 of 5", never "5 of 12" when only 5 can ever be shown.
- **Pluralise every count** ("1 card", not "1 cards"). This bit us four times in the prototype.
- **Two-column panels stay balanced** and rows stay in register at a fixed height.
- **`text-wrap: pretty`** on prose; never `nowrap` on a field that must be read in full.

---

## Suggested sequencing

| Week | Phases | Ships |
| --- | --- | --- |
| 1 | 0, 1 | New sidebar and dashboard — the overhaul is visible immediately |
| 2 | 2 | Six content sections consistent; value tagging live |
| 3 | 3, 4 | Short links, redirects, and a menu the office can edit |
| 4 | 5 | Full newsletter editor |
| 5 | 6, 7 | Staff/Users/Subscribers, then Gym and Giving |
| 6 | 8, 9 | Payroll, Media, Audit, ⌘K |

Phases 1–4 are the ones the office feels every day. If time runs short, Phase 9's ⌘K is the only genuinely optional item.
