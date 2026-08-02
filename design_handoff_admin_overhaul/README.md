# Timothy Lutheran Admin — Full Overhaul Spec

Handoff for the redesign of `admin.timothystl.org`. Two prototypes, twenty sections, one interaction pattern.

Everything here is designed against the **real schema** in `tlc-admin-worker.js` and `admin/db.js` — table and column names in this document are the ones already in the D1 database unless marked **NEW**.

---

## 1. What problem this solves

The current admin grew one screen at a time, so every section behaves differently. Andrew's own summary was blunt: **"nothing matches."** A volunteer who learns the news screen learns nothing about the gym screen.

The fix is not new features. It is **one pattern, applied twenty times**, so that learning one section teaches all of them — plus real editors for the two places that genuinely need more than a list (site pages and the newsletter).

Two design goals govern every decision below:

1. **A volunteer cannot break the site.** No free-form pixel values, no font pickers, no unconstrained colour input, no HTML editing. Every control snaps to the theme.
2. **Nothing is retyped.** If a fact lives in a table (a staff photo, a sermon title, a news post), every screen reads it from there. Edit once, everything follows.

---

## 2. Files in this package

| File | What it is |
| --- | --- |
| `Admin Sections Prototype.dc.html` | The whole admin: sidebar + all 20 sections, clickable |
| `Site Editor Prototype.dc.html` | The page/block editor (from the earlier phase of this work) |
| `support.js` | Runtime for the two prototype files — **not** production code |
| `screenshots/*.png` | 26 captured states, referenced throughout this document |
| `IMPLEMENTATION-PHASES.md` | Phased build plan with completion criteria |

Open either `.dc.html` directly in a browser. Nothing to install.

**The prototypes are design specs, not a codebase.** Do not port `support.js`. Read the prototypes for structure, copy the exact values (hex codes, spacing, copy text, field lists), and build them in the existing Cloudflare Worker + D1 stack.

---

### Building from `screens/`

`screens/index.html` is the build index. **One HTML file per screen**, twenty-one in all. Each file shows the built screen at the top — real sidebar, real list, real drawer, real data — with that screen's specification underneath it, plus the shared pattern, the sidebar rules, and the exact visual values on every page.

Build against the screen. Where the prose and the screen disagree, the screen wins.

---

## 3. The shared pattern

Every list section is the same five things in the same order. `screenshots/staff.png` is the reference implementation.

```
┌─ Title                                            [+ New thing] ─┐
│  One-sentence purpose, in plain language                          │
├───────────────────────────────────────────────────────────────────┤
│  [⌕ Search]  [All] [Filter] [Filter]            "13 of 13 shown"  │
├───────────────────────────────────────────────────────────────────┤
│  PRIMARY            META        META      STATUS      Edit  ⋯     │
│  Name               value       value     ●PILL       Edit  ⋯     │
│  sub-line                                                          │
│  ▲ warning row, when this row needs attention        Fix link     │
├───────────────────────────────────────────────────────────────────┤
│  ◆ One note explaining the rule this section enforces             │
└───────────────────────────────────────────────────────────────────┘
```

Clicking a row opens a **right-side drawer** with that record's fields, ending in `Delete · Cancel · Save changes`.

### Rules that make it consistent

- **Max 3–4 columns.** Every column earns its width. If a status is the same on every row, it is not a column (this is why Partners has no Status column).
- **Primary column carries a sub-line** — the second-most-useful fact, so the drawer isn't needed to identify a row.
- **Status is always a pill**, always the same five tones: green = good/live, amber = needs attention, red = broken, grey = deliberately off, blue-grey = automatic.
- **A row that needs attention grows a warning row beneath it** with its own action label ("Fix short link", "Re-upload") — never a modal, never a silent failure.
- **Count label** reads "N of M shown" and M is scoped to what the filters actually allow.
- **One `◆` note per section** stating the rule the section enforces. This is the teaching surface: it is where the design explains itself to a volunteer.

### Where bespoke UI is justified

Four sections earn a custom layout because their data is not a flat list:

| Section | Why | Screenshot |
| --- | --- | --- |
| Dashboard | A worklist, not an inventory | `dashboard.png` |
| Menu | A tree with drag-and-drop and a live header preview | `menu.png` |
| Giving | Two page surfaces + tiers + funds + links | `giving.png` |
| Payroll | Period-scoped entry plus three report layouts | `payroll-*.png` |
| Gym Rentals | Calendar + approval queue + invoices | `gym-calendar.png` |
| Newsletter | A full composer with live email preview | `newsletter-editor.png` |

Everything else is the shared pattern.

---

## 4. Sidebar and information architecture

`screenshots/dashboard.png`

```
Timothy Lutheran / ADMIN v1.91.0
admin

OVERVIEW
  Dashboard

WEBSITE
  Pages
    └ Ministries          (2)
    └ Partners
    └ News & Events
    └ Sermons
    └ Christian Ed
  Menu
  Notices
  Taps & Links
  Redirects
  Media

COMMUNICATION
  Newsletter              (1)
  Subscribers

PEOPLE & OPS
  Staff
  Gym Rentals             (3)
  Users
  Giving
  Payroll
  Audit Log
```

**Why nested under Pages:** Ministries, Partners, News & Events, Sermons, and Christian Ed all produce *pages on the website*. They are split out only because different people own them and they carry extra data. Nesting them says so. Menu, Notices, Taps, Redirects, and Media are site-wide tools, so they sit at top level.

**Badges** are counts of things needing a human: gym requests, pages with unpublished edits, newsletter awaiting approval. They are the same numbers the Dashboard shows.

**⌘K searches every section** — one search box over all tables. Not built in the prototype; specified for Phase 8.

---

## 5. Section-by-section specification

### 5.1 Dashboard — `dashboard.png`

Two layouts, both built; **Needs you** is the default and the one to ship.

**"Needs you"** — a worklist you clear. Each row: glyph, what needs doing, the specifics, and one action button that deep-links to the right section.

Current tasks (derive these queries):
- Gym requests with `status = 'pending_review'`
- Pages with unpublished draft edits
- Payroll period closing within 3 days with unapproved timesheets

Then **Our Four Values** — four cards, one per value, each showing how many ministries carry that tag, how many posted in the last month, and the partner ministry paired to it. A card with no recent posts says so plainly ("Nothing new posted under this value in a month"). This is the only place in the admin that reports on the church's own stated priorities rather than on content mechanics.

Then **This Sunday** (service order with flags) and **Last 24 hours** (audit tail with a link to the full log).

**"Overview"** is the alternative: four stat tiles + a compact worklist + jump links. Keep the toggle if you like; the worklist view is the daily home screen.

### 5.2 Pages — `pages.png`

`youth_pages` + **NEW** `pages` table. Columns: Page / Address / Short link / Status. Clicking a row opens the **page editor** (`Site Editor Prototype.dc.html`), not a drawer.

- **Short links are automatic** — last segment of the address, so `/visit` works as well as `/plan-a-visit`.
- **Conflicts are flagged, never guessed.** Two pages wanting `/sermons` produces a `LINK CLASH` pill and a warning row with a "Fix short link" action.
- Renaming a page writes an automatic 301 into `redirects`.

### 5.3 Ministries — `ministries.png`

`youth_pages`, `ministry_posts`. Columns: Ministry / Short link / **In menu** / Status.

- **One click to the editor** — the row's primary action is "Open editor"; "Details" opens the drawer for name, address, value tag, and posts setting.
- **In menu switch** removes a ministry from the header without unpublishing it. The page stays live at its address; it just stops being listed. This is the distinction that the old admin conflated.
- **Auto short links**: `/youth` and `/ministries/youth` both resolve. Safe to say from the pulpit.
- Each ministry carries **one core-value tag** (Welcome / Receive / Grow / Go) shown as a tinted chip, filterable.

### 5.4 Partners — `partners.png`

**NEW** `partners` table. Four records, one per value:

| Partner | Value | Site |
| --- | --- | --- |
| Lindenwood Area Senior Ministry | Welcome · Acceptance | lasmstl.org |
| Concordia Seminary St. Louis | Receive · Worship | csl.edu |
| Word of Life Lutheran School | Grow · Christian Education | wordoflifestl.org |
| Christian Friends of New Americans | Go · Outreach | cfna-stl.org |

CFNA's record also names **Pastor Rall and Mary Ann, missionaries to Papua New Guinea**. Three columns only — Partner (with blurb), Value chip, Their site. One partner per value: if a value has no partner, the values page says so rather than quietly showing three.

### 5.5 News & Events — `news-events.png`

`news_items`. **News and Events & Calendar are one page now** at `/news`, with the calendar embedded below the posts. `/events` (automatic 301) and `/calendar` (hand-made) both redirect there.

Columns: Post / Published / Expires / Status. The **expire date is the important field** — a post with one disappears on its own, which is what keeps the site from going stale. Filters: All / Live / Scheduled / Expired. Value tag per post.

### 5.6 Sermons — `sermons.png`

`sermon_series`, `sermon_notes`. Series rows with their sermons indented beneath. Columns: Series / sermon · Date · Scripture · Media.

**The library has no audio or video attached yet.** Add a nullable `media_url` / `youtube_url` to `sermon_notes` now, and make the site's Latest-sermon block branch on it:

| Data | Renders |
| --- | --- |
| Has media | Play thumbnail linking to the recording |
| No media | Text-only card: series eyebrow, title, date, scripture, "All sermons" link — no play affordance |

No editor setting. The block picks its own state and upgrades itself the moment a link is pasted.

### 5.7 Christian Ed — `christian-ed.png`

`bible_classes` — already seeded with the seven offerings. Columns: Class / Schedule / Leader / Status. Paused classes stay in the list but drop off the website. Feeds the newsletter's class picker.

### 5.8 Menu — `menu.png`

**NEW** `menu_items` table: `id, menu ('header'|'footer'), label, kind ('page'|'external'|'short'), target, style ('link'|'button'), depth, sort_order, visible`.

- **Live header preview** at the top, rendered from the actual items.
- **Two lists**, header (two levels) and footer (flat).
- **Drag by the ⠿ handle** to reorder; **drop onto an item's name** to nest under it; drag between header and footer.
- **✕ removes an item** — the page stays live and reappears in the orphan panel. Nothing is ever lost.
- **"Live pages not in the menu"** panel reconciles pages against menu items, with **Header** / **Footer** buttons and drag-out.
- **Label ≠ page name**: "Visit" in the bar, "Plan a Visit" on the page.
- **One item may be a button.** Give is it.
- If a page goes draft or leaves the menu, the item pointing at it is **flagged**, not silently broken.

### 5.9 Notices — `notices.png`

`notices`. Short banners pinned to one page. Columns: Notice / On page / Position / Status. Deliberately **not** a page block: a notice can be switched off in one click without touching the page it sits on.

### 5.10 Taps & Links — `taps-links.png`

`link_cards` + **NEW** `taps` table, and a **NEW** `tap` column on `link_cards`.

Four NFC taps, each with its own set of link cards:

| Tap | Where the tag lives | Lands on |
| --- | --- | --- |
| 1 · `/tap1` | Narthex table, handout cards | links.timothystl.org |
| 2 · `/tap2` | Pew racks, visitor cards | links.timothystl.org/welcome |
| 3 · `/tap3` | Offering plates, two tags | give.tithe.ly/… |
| 4 · `/tap4` | MDO front desk | links.timothystl.org/mdo |

**The critical mechanic:** the tag itself only ever holds its short address — `/tap1` through `/tap4`. Everything a visitor sees is the cards behind it. **Re-point this tap** changes the destination without reprogramming a tag you handed out a year ago. Tap counts shown per tap. Cards can be moved between taps from the drawer.

**Confirmed:** the taps are addressed `/tap1` through `/tap4` — that is their real naming. The display names and placements in the prototype are working labels the office can rename in the drawer at any time; nothing in the build depends on them.

### 5.11 Redirects — `redirects.png`

`redirects`. Columns: Short link / Goes to / Kind / Status.

- **Hand-made** — links you say out loud: `/zoom`, `/councilfiles`, `/bulletin`
- **Automatic** — 301s written when a page address changes. **Leave them.** They keep old bulletins and Google results working.
- **Giving** — tagged giving/payment links, managed from the Giving section but stored here

### 5.12 Media — `media.png`

**NEW** `media` table. Three columns: File (with "On …" / "Used nowhere" sub-line) / Alt text / Size.

The section exists for the two things that actually go wrong:
1. **Files over 1 MB** — flagged red with a "Re-upload" warning row. Images are resized on upload and confirmed under 1 MB.
2. **Photos with no alt text** — amber "No alt text yet" pill.

Images live in the database alongside the site, per Andrew's confirmation.

### 5.13 Newsletter — `newsletter-list.png`, `newsletter-editor.png`

`newsletters`, `events`. **This is the most complex screen in the admin.** The full editor from `/edit/35` is restored and extended.

List columns: Issue / Sends / Date / Status (Draft, Awaiting approval, Sent).

**Editor layout:** two columns — form on the left, **live email preview** on the right that updates as you type.

Fields, mapped to real columns:

| Field | Column | Notes |
| --- | --- | --- |
| Subject line | `subject` | Character count, warns past 60 (phones truncate) |
| Preview text | **NEW** `preheader` | The grey line after the subject in an inbox, 110 char guide |
| Format | `format` | Weekly / Special edition |
| Publish date | `published_at` | |
| Who gets it | **NEW** `audience` | Everyone / Church only / School & MDO families, with count |
| Pastor's note | `pastor_note` | **TinyMCE** |
| Second note | `secondary_note` | **TinyMCE** |
| Third note + button | `tertiary_note`, `tertiary_cta_label`, `tertiary_cta_url` | **TinyMCE**, sits below the partner blocks |
| Extra notes | **NEW** `extras` JSON | "+ Add another note" — editable heading, own TinyMCE, ✕ to remove |
| Word of Life block | `wol_content` | **TinyMCE** |
| LASM block | `lasm_content` | **TinyMCE** |
| News to include | `news_item_ids` | Checkbox picker over `news_items` |
| Bible classes | `bible_classes` | Checkbox picker over `bible_classes` |
| Events | `events` child rows | Editable date / name / time / description, add and delete |
| Main button | `cta_label`, `cta_url` | |
| This Sunday | **NEW** `include_sermon` | Auto-filled from the sermon library |
| Bulletin download | **NEW** `include_bulletin` | Whatever is at `/bulletin` when the email sends |
| Blocks on/off | **NEW** `blocks` JSON | See below |
| Status | `status` | draft / awaiting / sent |
| Send record | `beehiiv_id` | "Sent 24 July to 609 subscribers · 61% opened" |

**All seven rich-text fields are full TinyMCE instances** (bold, italic, underline, H2, blockquote, bulleted and numbered lists, link, image, undo/redo, clear formatting). The prototype paints the toolbar so you can see placement; the real thing is TinyMCE via the existing `tinymceNoteSection()` helper.

**"What goes in this issue"** — one switch per block (pastor's note locked on). A light week is a few clicks, not deleting content you'll want back. Switching a block off hides it from both the form and the preview.

**Sent issues are read-only.** Fields are not editable, pickers and event controls are inert, Save/Submit are replaced by **Duplicate as draft**. The lock is enforced in state, not just visually.

**Two-person approval:** a draft is submitted for approval; a second person with `newsletter_approve` schedules the send.

### 5.14 Subscribers — `subscribers.png`

`newsletter_subscribers`. Read-only mirror of the mail provider plus local signups. Columns: Person / Source / Joined / Status. **Never delete a person to unsubscribe them** — unsubscribes come back from the provider. Stated in the section note.

### 5.15 Staff — `staff.png`

`staff_members`. One record per person; every page showing staff reads from here. Columns: Person / Email / Order / Photo. **Photo crop is set once per person and reused everywhere** — no more heads cut off on the About page. Noah the comfort dog has a record, and should.

### 5.16 Gym Rentals — `gym-calendar.png`, `gym-queue.png`

`gym_groups`, `gym_bookings`, `gym_blocked_dates`, `gym_invoices`. Two layouts, both built — pick one or ship both:

**Calendar first** — month grid with colour-coded bookings (confirmed / hold / conflict / blocked), a "Requests to review" panel with Approve / Decline, and an Invoices panel.

**Queue first** — the approval queue as a table with an explicit **Conflicts** column, plus three stat tiles.

Mechanics either way: groups book through their own portal link; **holds lapse after 48 hours** unless confirmed; recurring requests wait for a human; invoices bill at the hourly rate from Settings; confirmed bookings push to a Google Calendar.

### 5.17 Users — `users.png`, `drawer-user-permissions.png`

`users`. Columns: User / Access / Last login / Status.

The drawer holds the **14 real permission names** as checkboxes, with presets (Office staff / Ministry leader / Bookkeeper / Full access) as shortcuts above them:

```
newsletter_edit      newsletter_approve   news_edit
ministries_edit      sermons_edit         pages_edit
staff_edit           links_edit           settings_manage
gym_manage           giving_manage        payroll_manage
users_manage         audit_view
```

**The checkboxes are the truth; presets just tick a set of them.** Each row shows its permission key in monospace so the screen and the code use the same words. Disabling an account keeps the history; deleting does not.

### 5.18 Giving — `giving.png`

`give_amount_tiers`, `give_funds`, `redirects`.

**The giving page, in two places:**

| Surface | What it is |
| --- | --- |
| `give.timothystl.org` | Standalone. No header, no menu, one job. The address on plate cards, the NFC tap, and print. |
| `timothystl.org/give` | The same blocks with the normal header, menu, and footer. |

Each has **Edit this page** (opens the page editor) and **View live**. A **keep in step** switch ties them: edit either and the other follows, only header and footer differ. Switch it off and they become independent pages.

**Funds** (left) — addable, each with an on/off switch and Edit. A fund must exist on the giving platform too: add it here, switch it on once it does. Gym Rental Payments is locked off the public page because invoices drive it. Drag to reorder.

**Giving & payment links** — one list, two tags. **Gift** is receipted as a donation at year end. **Payment** — gym rent, a registration fee, a **vendor invoice** — is not. This distinction keeps the treasurer's year-end statements clean.

**Amount tiers** (right) — drag to reorder, one marked Default, "Other" always on.

**Giving platform link** — one field. The Give block, the newsletter footer, and gym invoices all read it.

### 5.19 Payroll — `payroll-entry.png`, `payroll-report-cards.png`, `payroll-report-table.png`, `payroll-report-summary.png`

**NEW** `pay_periods`, `timesheets` tables.

**Pay period dropdown** at the top showing the selected period and its pay date. **Enter & approve / Report** toggle. **Print report** and **Export CSV** side by side in the header.

**Enter & approve:**
- Columns: Person / Paid as / Hours / PTO used / Status
- **Salaried staff** need only exceptions — hours read "n/a"
- **Hourly staff** get ± steppers
- **Childcare hours import from the childcare app** — an import strip shows what came in and flags any name that did not match a person here
- **Unmatched imports** must be reconciled: they carry a red name bar and an "Unmatched import" badge, and are excluded from a closed period's report
- **A paid period is locked**: hours become static text, per-row Approve disappears, and **Reopen period** (audit-logged) is the only way back in

**Report — three layouts:**

| Layout | For |
| --- | --- |
| **Detail cards** | Matches the report printed today. Navy name bar, line items, Gross Pay. Salaried show Base Salary / Housing Allowance / Mileage; hourly show Pay Rate / Hours Worked. PTO used per person. |
| **One line each** | Compact table — Person / Paid as / Hours @ rate / PTO used / Gross. For scanning and reconciling against the service. |
| **Totals only** | **No names, no rates.** Each side's subtotal split salaried vs hourly, people paid, hours recorded, PTO used. Safe for council minutes and the treasurer's packet. |

All three group **Church staff** and **Timothy MDO** separately with a subtotal bar each, then a gold **Combined total**.

**Gross pay only.** No bank details, no tax figures — the report reconciles against what the payroll service files. Gated behind `payroll_manage`; every approval writes to the audit log.

*(Rates, PTO figures, and MDO names other than Skylor Murray and Sonya Jackson are invented — replace with real data.)*

### 5.20 Audit Log — `audit-log.png`

`audit_log`. Columns: Change / Who / When / Roll back. Each row shows `field: before → after` in its sub-line, and the drawer shows a before/after diff with **Roll back this change** — which itself writes a new audit entry. Filters: All / Content / People & ops / Rolled back.

---

## 6. Visual system

Lifted from the prototypes — use these exact values.

### Colour

| Token | Hex | Use |
| --- | --- | --- |
| Sidebar navy | `#12243D` | Sidebar background |
| Navy | `#1D3557` | Headers, name bars, primary buttons |
| Navy ink | `#1E2D4A` | Body headings, primary text |
| Gold | `#C9973A` | The one accent: primary action, active marker, combined total |
| Gold ink | `#1B1608` | Text on gold |
| Cream | `#F5E4C0` | Text on navy |
| Parchment | `#FAF7F1` | Card background |
| Sand | `#F4EFE5` | Panel headers, secondary surfaces |
| Border | `#E7DFD1` | Card borders |
| Row divider | `#EFE7D9` | Between rows |
| Muted text | `#8A8271` | Sub-lines, hints |
| Body text | `#4A4860` | Meta values |
| Blue | `#2E7EA6` | Links, selection outline, "fills itself" panels |

**Status tones** — always these pairs:

| Tone | Background | Text | Border |
| --- | --- | --- | --- |
| Good | `#EAF1E5` | `#3B4C2E` | `#C9DCBD` |
| Warn | `#FBF1DC` | `#7A5B18` | `#EBD5A6` |
| Bad | `#FAEFEF` | `#8A4A4A` | `#E4C8C8` |
| Plain | `#EFEFEF` | `#6A6858` | `#DDD9D0` |

**Core value tints** — Welcome `#1D3557`, Receive `#3E5C76`, Grow `#4A5E3A`, Go `#C9973A`, each with a matching pale tint for chips.

### Type

- **Lora** (serif) — page titles, large numbers, person names in reports, email preview headings
- **Source Sans 3** — everything else
- Section title 25px/500 Lora · purpose line 13.5px · table header 10.5px uppercase 0.12em · row primary 13.5px/600 · sub-line 11.5px · pill 10.5px/600 uppercase

### Spacing and shape

- Card radius 11–12px, pill radius 999px, control radius 7–8px
- Section padding 26px horizontal, 20px top
- Table row padding 12px 18px; **fixed row heights where two panels sit side by side** (56px) so columns stay in register
- Panel gap 16px
- Toggle 36×20 with a 14px knob; small toggle 32×18 with 12px knob
- **Two-column layouts must balance.** Compose so the columns are within ~50px of each other in height, rather than leaving one running on alone.

---

## 7. Confirmed data decisions

From Andrew directly:

- **Images live in the database** with the website. Resize on upload and **confirm under 1 MB**.
- **A staff directory table already exists** — the staff grid reads from it.
- **The sermon library does NOT exist yet — build it.** Series with individual sermons, audio and video optional per sermon. Handle both attached and unattached states automatically (§5.6).
- **Keep the redirects table.** Automatic 301s from page renames stay.
- **Timothy owns MDO.** Timothy MDO (Mother's Day Out) content is church content, edited in this admin, and its staff sit in Timothy's payroll. Its own site at `mdo.timothystl.org` stays, and the main site links out to it.
- **The school is a separate organisation.** No school content or school staff in this admin — link out only.
- **No Breeze integration.** Timothy is building its own ChMS, so **staff, users, and people data live in this system as the system of record** — do not design around syncing from Breeze.
- **Four partner ministries, one per core value** (§5.4), including Pastor Rall and Mary Ann in Papua New Guinea under CFNA.
- **There is a concert series**, tagged Welcome.
- **Payroll has salaried workers** and imports childcare hours from the childcare app.
- **Newsletter is `/edit/35`-style** — the full composer, not a four-field form.

---

## 8. Open questions

1. Real **pay rates, PTO figures, and MDO staff names** (only Skylor Murray and Sonya Jackson came from the screenshot).
2. Should **CFNA and Concordia Seminary** get their own newsletter blocks alongside Word of Life and LASM?
3. **Gym Rentals**: ship both layouts with a toggle, or pick one?
4. **Dashboard**: keep the Overview alternative, or ship only "Needs you"?
5. Who holds **`newsletter_approve`** besides Andrew? The two-person send depends on there being a second person.
