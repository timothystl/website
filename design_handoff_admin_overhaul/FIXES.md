# Admin redesign — fix list

**For:** Claude Code, working in `timothystl/website`
**Source of truth:** `design_handoff_admin_overhaul/screens/` — `00-foundations.html` (shell values), `00b-header-nav.html` (the new navigation), `AUDIT.html` (why each of these is here), and one file per screen.
**Audited against:** `main` @ `5f90460`, 1 Aug 2026.

---

## Rulings — 1 Aug 2026

Four open questions, answered. These are final; where they contradict anything below or in `README.md`, they win.

**1. Warning rows sit ABOVE the row they describe.** `screenshots/pages.png` is correct and `README.md` §3 is wrong — fix the README. The warning is a full-width band immediately *preceding* its row, so the eye hits the problem before the thing with the problem. It shares the offending row's left edge, carries the ▲ glyph at `#8C3A28`, and its action link ("Fix short link") right-aligns to the same column as the row's own actions. The row it belongs to keeps its own `problem` badge — the band explains, the badge marks.

**2. Permissions hide individual items; a group disappears only when it empties.** Both, in that order. Each section is hidden per its own permission. A group label renders only if at least one section under it survives — no orphan headings, no group hidden while a section inside it is still permitted. A user with only `newsletter_edit` sees Dashboard, then "EMAIL" with one row under it, and nothing else.

**3. Drawer button order is what `drawer-user-permissions.png` shows.** Delete far left as red text, then a gap, then Cancel (outlined) and Save changes (navy fill) grouped right. Destructive is separated by distance, not by colour alone. Prose in the handoff that says otherwise is stale.

**4. The sidebar stays visible.** 228px, fixed, always on screen at ≥900px. This was reversed once and is not reversing again. Task 2 stands as written.

### Two flags, answered

- **The payroll period lock is a real requirement, not a confirmation.** If it does not exist, build it. After a period is marked Paid it is frozen server-side: no hours, rates or exceptions can change, and the API rejects the write rather than the UI hiding the button. Corrections go on the next period as adjustment line items.
- **The gym portal's own `:root` is correct to leave alone.** Task 1 item 2 applies only to the admin-facing gym screens in `admin/gym.js`. The renter-facing portal is not an admin screen and keeps its own tokens. Note the exemption in `REDESIGN-STATUS.md` as `n/a` with that reason, so the next audit does not re-flag it — and adjust the definition-of-done `rg ':root\{' admin/` check to expect exactly two hits, the shell and the portal. **Refined by Task 17b:** the portal keeps its own `:root` and gets no admin chrome, but it is not exempt from the brand — it takes the public site's shell and the Foundations drawing values.

### The one check still outstanding

The side-by-side pass over all 24 screen files at matching widths is mine, not the coder's, and it has not happened yet. Nothing is done until it does. Priority order for that pass: Ministries, Pages, Users, Media, Newsletter, Gym, Payroll.

---

Work the tasks in order. Each one is independent and shippable — do not batch them into one commit. After each task, run `npm test` (there are tests asserting the palette and the section config; keep them green and add to them where noted).

The single rule that governs everything below: **do not invent values.** Every colour, size, radius and string in this list is already written down in `00-foundations.html` or `admin/sections.js`. If something you need is not specified, stop and ask rather than choosing.

---

## Where each task stands — 2 Aug 2026, evening

Audited against `main` @ `a05ed0f`. Tasks 0–10 landed in six commits. Since the
morning audit: 17a shipped (v4.6.0), and a later pass took 2 item 2, 15's
questions and part of 1.

**Two things found by this pass are worth reading before picking anything up.**

1. **The shell had no working navigation on a phone, for the third release
   running.** `.sidebar-toggle{display:none}` was declared *below* the
   `max-width:900px` block at equal specificity, so source order decided and it
   won at every width — the button was in the DOM, the handler was wired to it,
   and a 390px screen still could not reach the nav. The two previous versions
   of this bug were off-canvas-with-no-handler and handler-with-no-markup. All
   three passed a CSS grep, which is why `test/shell-layout.test.mjs` now
   measures rectangles and clicks the button instead of matching strings.
2. **Two of Task 15's five questions have false premises** — see that task
   below. Both describe a record editable two ways, which is the defect the
   task exists to find, and neither is real.

| # | Task | State |
| --- | --- | --- |
| 0 | Inventory every screen | **Done** — `admin/REDESIGN-STATUS.md`, 74 routes, no `legacy` rows |
| 1 | One palette | **Done**, plus two later fixes: the four value tints no longer collide with the status tones (below), and the blocked-date calendar came off `#fce8e8`/`#7a1f1f` |
| 2 | Un-hide the sidebar, context bar | **Done.** Item 2 (the flex shell) was *not* done and is now: `--tlc-rail` once, `.tlc-main{flex:1;min-width:0}`. Item 3's slide-over works — see the note above |
| 3 | Login and account screens | **Done** |
| 4 | Gym Rentals | **Done** — toggle works, blocked dates still a calendar. `admin/REDESIGN-STATUS.md` had mislabelled that row `pattern` for three releases; corrected |
| 5 | Payroll navy bars | **Done** |
| 6 | The rest of the legacy screens | **Done** by its own rule; see Task 15 for the five that slipped through |
| 7 | Filtered Mail | **Done** |
| 8 | Value chips | **Done** |
| 9 | Two copy fixes | **Done** |
| 10 | Banner info card | **Done** — `renderInfoCard()` in `blocks.js` |
| 11 | Warning rows above their row | **Open** — the last ruling not in the code |
| 12 | Editor rail, Connect, arrow glyphs | **Open** |
| 13 | Homepage editor: info card, free text, half-width blocks | **Open** |
| 14 | Card grid block | **Open** — new block |
| 15 | Five borderline hand-written routes | **Answered; 2 of 5 need no code.** #3 and #4 rest on premises that are false. #1 and #2 are real and open. See below |
| 16 | Congregation-facing files onto the palette | **Open** — reverses an earlier `n/a` |
| 17 | Renter booking: domain and shell | **a. Done** (v4.6.0) — the portal is on `timothystl.org/gym/*`, the admin path 301s, the CSRF gate learned about it, verified in production. **b. open** — it still has no public-site shell |
| 18 | Renter booking: the pattern | **Open** — spec screen built, `screens/24-gym-booking.html` |
| 19 | Group edit + form-width rule | **Open** — the width rule touches every form |

**Suggested order now:** 19 (one shared wrapper fixes every form, and Task 2 dropping `.wrap{max-width:860px}` left every form full-width on a wide monitor) → 11, 12 (small, decided) → 15 #1 and #2 (the two that survived) → 16 → 17b → 13, 14, 18 (new work).

---

## Task 0 — Find every screen still on the old design

Before fixing anything, produce the list. The redesign converted the main list screens; the deeper sub-pages were missed, and nobody has an inventory of which.

```
rg -n 'class="wrap"|class="page-title"|page-sub|class="card"|btn-primary|btn-secondary|format-card|filter-pill|\.ni-row|\.user-row|\.audit-row' \
   admin/ tlc-admin-worker.js
```

Every hit is a screen or fragment rendering in the pre-redesign style. Also worth running:

```
rg -n 'var\(--steel\)|var\(--amber\)|var\(--charcoal\)|var\(--gray\)|var\(--serif\)' admin/ tlc-admin-worker.js
rg -n '#0A3C5C|#D4922A|#3D3530|#7A6E60|Georgia' admin/ tlc-admin-worker.js
rg -n ':root\{' admin/            # expect to find more than one — that is the bug
```

**Deliverable:** a markdown table at `admin/REDESIGN-STATUS.md` — one row per route, columns: route, file, line, `converted` / `legacy` / `n/a`, and which screen file in the handoff specifies it. Commit that first. It is how we know when this is finished, and Task 6 works straight off it.

Known legacy already (not exhaustive — Task 0 is what makes it exhaustive):

| Area | File | Notes |
| --- | --- | --- |
| Gym: settings, groups, add group, group detail, calendar test, consolidate, recurring detection, blocked dates, new booking, review booking, all bookings, price & confirm, invoices, invoice detail, recurring requests | `admin/gym.js` | ~20 sub-screens; only the request queue uses `renderListSection()` |
| Filtered Mail | `admin/forms.js` | postdates the handoff, no spec — see Task 7 |
| Login, forgot password, reset password, first-run setup | `admin/helpers.js` | see Task 3 |
| Payroll header bars | `admin/payroll.html` | see Task 5 |

---

## Task 1 — One palette

**Why:** `admin/helpers.js` still opens with the pre-redesign `:root`, and the new tokens are appended *after* it. Anything not explicitly restyled therefore renders in the old scheme and the wrong typefaces. `admin/gym.js` declares a third `:root` that shadows the shell's tokens inside every gym screen.

1. In `admin/helpers.js`, replace the legacy `:root` values in place — keep the variable names so nothing breaks, point them at the real values:

```css
:root{
  --steel:#1E2D4A;        /* was #0A3C5C */
  --amber:#C9973A;        /* was #D4922A */
  --sage:#4A5E3A;
  --warm:#FAF7F1;         /* was #FAF7F0 */
  --linen:#F4EFE5;        /* was #F2EDE2 */
  --mist:#E7EEF7;         /* was #EDF5F8 */
  --border:#E8E0D0;       /* keep for legacy call sites, but see below */
  --charcoal:#1A1A2A;     /* was #3D3530 */
  --gray:#6A6858;         /* was #7A6E60 */
  --white:#fff;
  --sans:'Source Sans 3',Arial,sans-serif;   /* was -apple-system */
  --serif:'Lora',Georgia,serif;              /* was Georgia */
}
```

Then sweep `--border` → `#E7DFD1` and delete the alias, so there is one border colour.

2. Delete the `:root` block in `admin/gym.js` (line ~310) entirely. It inherits from the shell.

3. Restyle the six legacy primitives to the Foundations numbers:

| Selector | Change to |
| --- | --- |
| `.card` | `background:#FFFDF9; border:1px solid #E7DFD1; border-radius:12px; padding:18px 20px` |
| `.btn-primary` | `background:#1E2D4A; color:#F5E4C0; border-radius:8px; font:600 13.5px/1 var(--sans); padding:10px 17px`; hover `#2A3E62` |
| `.btn-secondary` | outlined: `background:#FAF7F1; color:#1E2D4A; border:1px solid #E7DFD1; border-radius:8px` |
| `.btn-danger` | text button, `color:#9A3B2E`, no fill |
| `input, textarea, select` | `border:1px solid #E7DFD1; border-radius:8px; padding:9px 11px; font-size:13.5px`; focus ring `0 0 0 3px rgba(46,126,166,.15)` with `border-color:#2E7EA6` — blue, not amber |
| `.page-title` | `font:500 25px/1.15 var(--serif); color:#1E2D4A` |
| `.page-sub` | `font:400 13.5px/1.5 var(--sans); color:#6A6858; max-width:56em` |
| `.filter-pill` | `padding:7px 12px; border-radius:8px; font:600 11.5px/1 var(--sans); border:1px solid #E7DFD1; background:#FAF7F1; color:#4A4860`. Active: `border:2px solid #1E2D4A; background:#E7EEF7`. **Not** a 999px pill with a navy fill. |
| `.badge-*` | `border-radius:999px; font:600 11px/1.6; padding:3px 10px`. Good `#EDF0E4`/`#3F5424`. Waiting `#FAF0DC`/`#7A5B18`. Problem `#F7E4DE`/`#8C3A28`. Neutral `#EFE7D9`/`#6A6858`. |
| `.alert-*` | card geometry (radius 12, 1px border) using the same four tones; drop the 3px left-border accent stripe |

4. Radii audit — the only legal values are 8 (inputs, chips, buttons), 9 (nav rows, search), 11–12 (cards), 999 (pills, toggles). Sweep out 6, 10, 14, 20.

**Test:** extend `admin/ui.test.mjs` to assert the shell CSS contains no `#0A3C5C`, no `#D4922A`, and no `Georgia` outside the `--serif` fallback.

This one task moves most of the legacy sub-pages most of the way, because they are all built on these primitives.

---

## Task 2 — Un-hide the sidebar, add the context bar

**Spec:** `screens/00b-header-nav.html`. Read it before writing anything.

**Correction to an earlier draft:** a version of this task asked for a horizontal top nav replacing the sidebar. **That is withdrawn.** The sidebar is the navigation and stays. Twenty-one sections in five groups is more than a horizontal bar can hold honestly. `sidebarShell()` and all its styling, permission logic and badge rules were right — keep them.

**Why:** `.sidebar` is currently `position:fixed; transform:translateX(-100%)` with an `.is-open` class, a `.sidebar-backdrop` scrim and a hamburger in a white `.util-bar`. It is off-canvas on every screen, so all the correct styling underneath is invisible until the user finds the toggle.

1. **Un-hide it.** Delete `transform:translateX(-100%)`, `.is-open`, `.sidebar-backdrop`, `.sidebar-toggle` and the toggle `<script>`. Keep everything else about `.sidebar`.
2. Make the shell a two-column flex — 228px sidebar, content column `flex:1; min-width:0` — rather than a fixed sidebar with a margin. Drop `.wrap{max-width:860px}`; that narrow column was a symptom of the sidebar being absent.
3. Below **900px only**, the sidebar may become a slide-over with a hamburger. On every laptop and desktop it is fixed and visible.
4. **Replace the white `.util-bar` with the context bar:** 46px, `#1E2D4A`, padding `0 26px`, above the content column only (it starts where the sidebar ends).
   - Left: group name `500 12.5px #8598B0`, `/` separator `#4E6180`, section `600 13.5px #FFFFFF`. Dashboard's group reads "Admin". If the section has a waiting count, an amber pill follows — "3 waiting".
   - In an editor, a third crumb is appended (`Website / Pages / Plan a Visit`) with the address beneath at `11.5px #6B7F99`.
   - Right: the ⌘K chip and "View site ↗", both `white-space:nowrap`. "Connect ↗" joins them here.
   - **It does not navigate.** No tabs, no chips, no menus, no links on the crumbs. The sidebar navigates; the bar reports.
5. Sign out returns to the **sidebar foot**, in gold `#C9973A`, as Foundations specifies. Do not duplicate it in the bar.
6. The `extraLinks` third argument (the "← Dashboard" back-links on ~15 gym call sites) keeps its signature but renders **in the content area**, above the `<h1>`, at `600 13px #2E7EA6`.
7. Both editors keep their own 58px navy bar (undo/redo, device switcher, draft state, Preview, Publish). In an editor that bar **replaces** the context bar.

## Task 3 — Login and the three account screens

`loginPage()`, `forgotPasswordPage()`, `resetPasswordPage()`, `setupPage()` in `admin/helpers.js` were never redesigned. This is the first screen anybody sees.

- Backdrop `#1E2D4A` (not `--steel`'s old value).
- Card `#FFFDF9`, `border-radius:12px`, `padding:36px 34px`, `max-width:380px`, shadow `0 18px 44px rgba(11,22,44,.28)`.
- Eyebrow "TIMOTHY LUTHERAN CHURCH" `700 11px/.16em uppercase #C9973A`.
- Title `500 25px Lora #1E2D4A`; sub `13.5px #6A6858`.
- Fields and the primary button pick up Task 1's styles automatically — check they did.

---

## Task 4 — Gym Rentals

Read `screens/16-gym.html` first.

1. After Task 1, every gym sub-screen inherits the new primitives. Walk each one and fix what remains: Title Case headings become sentence case ("Gym Rental Settings" → "Gym rental settings", "New Booking" → "New booking", "All Bookings" → "All bookings").
2. Convert the list-shaped sub-screens to `renderListSection()` + `renderDrawer()`: **Rental groups**, **All bookings**, **Invoices**, **Recurring requests**, **Blocked dates**. Each needs an entry in `admin/sections.js` (title, purpose, action, search placeholder, filters, columns) — do not write those strings in the route. Add them to `admin/sections.test.mjs`.
3. The genuinely form-shaped ones (new booking, review booking, price & confirm, consolidate, calendar test) stay as forms, on the new card and button styles.
4. Confirm **both** top-level layouts exist and are reachable from the segmented toggle: **Calendar first** (default) and **Queue first**. `sections.js` declares them as variants; verify they render. — **Verified 1 Aug: the toggle works and blocked dates render on the calendar. Task 4 is closed.**

---

## Task 5 — Payroll navy bars

`admin/payroll.html`: `.tlc-pay-card-bar` and `.tlc-pay-tbl-bar` are filled `#1D3557`. The palette comment in `admin/ui.js` says it outright — sidebar navy is "sidebar only, never a page". With Task 2 putting a navy bar across the top of every screen, a second navy band inside the page reads as a second nav.

Change both to `background:#F4EFE5; color:#8A8271; font:600 10.5px/1 var(--sans); letter-spacing:.12em; text-transform:uppercase` — the same treatment every other table header uses.

While you are in there, confirm the three report layouts (**detail cards** / **one line each** / **totals only**) all exist and all print cleanly, and that the period lock is enforced server-side, not by hiding the button. Spec: `screens/19-payroll.html`.

---

## Task 6 — The rest of the legacy screens

Work `admin/REDESIGN-STATUS.md` from Task 0 top to bottom. For each `legacy` row:

- If the handoff has a screen file for it, build to that file.
- If it is list-shaped and has no spec, use `renderListSection()` + `renderDrawer()` with a new `sections.js` entry — the shared pattern is the default, and a screen needs a reason not to use it.
- If it is form-shaped, it just needs Task 1's primitives plus sentence-case headings and a `.page-sub` purpose line saying what the screen is for in plain English.

Flip each row to `converted` as you go. The file is done when no row says `legacy`.

---

## Task 7 — Filtered Mail

`admin/forms.js` renders it as `.wrap` + `.page-title` + hand-built cards. It postdates the handoff so there is no screen file, but it sits between Newsletter and Subscribers in the Email group looking unlike either.

`renderListSection()` with columns **From** `1.8fr` · **Subject** `2.4fr` · **Held** `1fr` · **Why** `1.4fr`; filters **All · Held · Released**; `renderDrawer({readOnly:true})` showing the full message, with a **Release to inbox** action in the drawer foot. Add the config to `sections.js` and a case to `sections.test.mjs`.

---

## Task 8 — Value chips on three screens

`admin/sections.js` gives Ministries, News & Events and Christian Ed their plain filters only. The design puts the four tinted value chips **after** the plain chips on each. `admin/values.js` already holds the exact `tint` / `ink` / `solid` for all four.

Add `valueChips: true` to those three configs and render them from `VALUES` after the plain set. A value chip keeps its value colours in **both** states — off is `tint` background with `ink` text and a 1px `tint` border; on is the same fill with a 2px `solid` border. Changing the fill on selection would read as a different value rather than the same one, chosen.

---

## Task 9 — Two copy fixes

1. `admin/sections.js` → `links.label` is `'NFC Taps\n'`. Drop the trailing newline.
2. `admin/sections.js` → the Sermons note reads "No recordings are attached yet, so the site shows text-only cards." That was written when the library was assumed to exist; it is being built. Replace with: **"A sermon with no recording shows a text-only card. Add a YouTube link and it upgrades itself."** — the rule, not a snapshot of today's data.

---

## Task 10 — Banner info card

`screens/22-page-editor.html` §"The info card" specifies the white box on the worship banner. Confirm it exists in `admin/blocks.js`; if not, build it.

It is a **slot on the banner block**, not a draggable block. Inspector settings: **Info card** (Off · Right · Left) and **Card shows** (Service times · Address & directions · Contact · Short list of links · Free text). The first two read from Settings, so changing service times once updates every card on the site. Drawing values are in the spec table — white, radius 18, padding `34px 32px`, shadow `0 18px 44px rgba(11,22,44,.28)`, gold eyebrow, `400 30px Lora #1E2D4A` primary line, hairline dividers, `600 15px #2E7EA6` action links. Full width below the tablet breakpoint, stacking under the banner text. One card per banner; no card-colour setting.

---

## Task 11 — Warning rows move above their row

**Verified against `main` @ `69b5ba6`, 2 Aug 2026** — this is the only ruling not yet in the code.

`admin/ui.js:184` builds `warnHtml` and appends it after the row; `.tlc-warn` (line 688) carries `border-top`, which attaches it to the bottom edge of the row above. Ruling 1 says the band goes **above** the row it describes.

1. Emit `warnHtml` **before** the row markup, not after.
2. `.tlc-warn`: `border-top` → `border-bottom:1px solid #EBD5A6`, so the seam is between the band and the row it belongs to.
3. `.tlc-warn-mark` is currently the same amber as the text. Per the ruling the ▲ is `#8C3A28` — problem red — against the amber band. The text stays `#7A5B18`.
4. `ui.test.mjs:126` only asserts the class exists. Tighten it to assert the warning's index in the output is **less** than its row's.

Everything else from the rulings is already in: the drawer foot is `space-between` with a right-hand group (Delete left, Cancel + Save right — ruling 3), the sidebar is visible with a sub-900px slide-over (ruling 4), `contextBar()` is at `helpers.js:420`, and the gym portal keeps its own `:root` at `gym.js:315` on the new values.

---

## Task 12 — Three corrections from the 1 Aug walkthrough

Screenshots in `uploads/`. All three are decided — no design work needed.

**a. Both editors open with their left rail collapsed.** In the Ministries editor (and Pages, same shell) the block rail is shut behind a `›` chevron at the far left, so the editor opens as canvas + inspector with no structure list. The rail is where you reorder and select blocks — the inspector's own empty state reads "or a row in the left rail," pointing at something that isn't on screen. **Open by default**, at the width the spec gives it. Keep the chevron so it can be collapsed deliberately, and persist that choice per user, defaulting to open.

**b. Remove "Connect" from the context bar.** It links to an unrelated app and does not belong in the admin's chrome. Delete it — it is not moving to the sidebar. The right side of the bar is the ⌘K chip and "View site", nothing else. This supersedes the earlier "if they look crowded, Connect moves to the sidebar foot" note.

**c. No `↗` glyphs anywhere.** Strip the arrow from "View site", "View live", and every other outbound link across the admin. The link text says where it goes; the glyph is noise. All 24 spec files in `screens/` have been swept — match them.

---

## Task 13 — Homepage editor: info card, free text, and half-width blocks

From the 1 Aug walkthrough of `/pages/home/edit` against the live homepage. Spec: `screens/22-page-editor.html`.

### a. The info card renders the wrong shape

Live homepage card, top to bottom: eyebrow **JOIN US SUNDAY** · **8:00 & 10:45 am** / English worship · **9:30 am** / Vietnamese worship · Hội Thánh Việt · hairline rule · 6704 Fyler Ave / St. Louis, MO 63139 / Corner of Fyler & Ivanhoe · **Get directions →** · **(314) 781-8673**.

The editor renders three separate time rows (8:00, 9:30, 10:45 each on its own line) and then drops the address and phone entirely.

Two bugs, one cause:

1. **Services that share a label collapse onto one line.** 8:00 and 10:45 are both English worship, so they read `8:00 & 10:45 am` with a single `English worship` beneath. Group by label, join with `&`, and print the meridiem once. Do not emit one row per service record.
2. **"Service times" is not only service times.** The card is one composed unit — times, then a rule, then address, then directions and phone. `CARD_KINDS.times.rows` in the spec has always specified it that way and has now been extended with the phone row. Build the whole array, not the first two entries.

Both read from Settings, so changing service times or the address once updates every card on the site. That is the point of the block.

### b. Free text is too narrow

It currently gives you a bold line and a small line and nothing else, which is why it doesn't feel free. Widen it to:

- **Eyebrow** — editable text, defaults to "Take note", can be emptied.
- **Body** — a rich field with **bold**, *italic*, links and line breaks. No headings, no images, no lists; the card is small and those break it.
- Nothing else. The value of the other four modes is that they never go stale — free text is the deliberate exception, not a second page builder.

### c. Half-width blocks — new

Andrew's homepage has Latest sermon and News & announcements stacked full width when they'd sit better side by side. There is no way to ask for that today. Note that `split` in the spec is a *within-block* control (photo against text inside one block) — this is a different thing and needs its own control.

Add **Block width** to the inspector, on every block, above Spacing:

- Two options: **Full** (default) and **Half**.
- **Two consecutive Half blocks pair into one row**, first on the left, second on the right, with the same 32px gap the column blocks use. A third consecutive Half starts a new row.
- A Half with no Half neighbour renders at half width, left-aligned, with the right half empty. It is not an error state and gets no warning — it is a legitimate layout.
- Below the tablet breakpoint, halves stack full width in source order.
- Space above and below apply to **the row**, not to each block; take the larger of the pair.
- In the Page Blocks rail, a paired row shows its two blocks with a bracket down the left edge so the pairing is visible without going to the canvas. Dragging one out of the pair breaks it and the other reverts to half-width-alone.

Do **not** build this as a container or "row" block that things get dragged into. The rail is a flat list and should stay one — pairing is a property of adjacent blocks, not a new level of nesting.

---

## Task 14 — Card grid block

The live site uses one layout on four pages that the editor cannot make: a row of bordered cards. `/worship` (Parking · Kids & Families · What to Wear · Questions, 4-up, icon on top), `/education` (three class cards, eyebrow on top, no image), `/ministries` (8 cards, logo image, coloured top rule, "Learn more →"), and the Community partners section on the same page (4-up, logo, link). None of these are buildable from the block library today — **Columns** is 2–3 plain text columns with no card, no image and no link, and **Link tiles** is a fixed 4-up of short labels.

Add a **Card grid** block. `group: 'Structure'`, glyph `▩`, added to `DEFS` in `screens/22-page-editor.html`.

**Block-level settings**

| Setting | Options | Note |
| --- | --- | --- |
| Section eyebrow | text, optional | "WHAT WE OFFER", `700 11px/.14em uppercase #2E7EA6` |
| Section heading | text, optional | Lora, follows the block's Text size |
| Section intro | text, optional | one short paragraph, `max-width:56em` |
| Cards per row | 2 · 3 · 4 | default 3 |
| Alignment | Left · Centre | centre is what `/education` uses; left is the default |
| Card top rule | Off · On | the coloured hairline across the card top on `/ministries` — takes the ministry's own value colour from `values.js`, not a free picker |

**Per-card fields** — all optional except the heading, so one grid can carry image cards and text-only cards without looking broken:

- **Image** — from Media. Renders contained at its own aspect, max 120px tall, never cropped: these are logos, not photos. `/ministries` mixes a wordmark, a roundel and a photograph and they must all sit right.
- **Eyebrow** — `700 11px/.14em uppercase`.
- **Heading** — Lora, `#1E2D4A`.
- **Body** — one paragraph, bold and links allowed.
- **Link** — label plus a page or an address. Renders `600 15px #2E7EA6`. The arrow is part of the label the user types, so "Learn more →", "Visit MDO site →" and "Watch video →" all work without a setting for it.

**Drawing:** card `#FFFDF9`, `1px solid #E7DFD1`, radius 12, padding `26px 24px`, gap 24 between cards, shadow `0 2px 6px rgba(11,22,44,.05), 0 10px 24px rgba(11,22,44,.06)` — a soft lift, not a drop. On hover the card raises: shadow to `0 4px 10px rgba(11,22,44,.07), 0 16px 34px rgba(11,22,44,.09)` and `translateY(-2px)`, both over 140ms. Cards in a row are equal height; content sits top-aligned and the link pins to the card foot so links line up across the row. Below the tablet breakpoint, 4-up becomes 2-up and 3-up becomes 1-up.

**One note on `/worship`:** those four cards use emoji as their icons (🅿️ 👶 👕 ❓). The card grid supports an image, so if you want them to hold up next to the rest of the site, swap them for real marks in Media. Not blocking — say the word and I will spec a small icon set.

---

## Task 15 — The five borderline hand-written routes

Of the 31 `converted` rows, 26 are correctly hand-written — the dashboard, both newsletter composers, payroll, the ministry and staff editors, the gym forms. They carry three video slots, a banner picker, an event repeater, a live preview pane. A field config would lose those.

Five are not. Answer each before the count is trustworthy.

1. **`/ministries/[^/]+/posts`** (`tlc-admin-worker.js:6301`) — a list of posts belonging to a ministry. That is list-shaped by any reading, and it is the one clear miss. Convert to `renderListSection()` with its own `sections.js` entry. Its `/new` and `/edit/` siblings are forms and correctly stay as they are.

2. **`/notices/add`** (`:6591`) is hand-written while **`/notices/edit/`** (`:6634`) is `pattern`. Add and edit are the same form in two states, built two ways. One of them is wrong — almost certainly `add`. Make them one code path.

3. **`/users/new`** (`:8195`) and **`/users/edit/`** (`:8235`) are hand-written while `/users` is `pattern` with a drawer — and `screenshots/drawer-user-permissions.png` shows the drawer already editing a user, presets and permission checkboxes and all. So a user can be edited two ways, in two layouts. Either the routes are dead and should be deleted, or the drawer is read-only and the screenshot is wrong. Find out which; do not leave both.

4. **`/pages/details`** (`:5474`) has the same shape of problem against `/pages` + drawer. Same question.

5. **`/voters`** (`:3281`) and the duplicate **`/youth`** / **`/youth/`** (`:5811`, `:5814`) are unclassified — no spec file, no note. Say what they are. If either is list-shaped it converts; if `/youth` and `/youth/` are one screen registered twice, drop one row.

The rule that decides these: **a screen is hand-written only when a field config would produce a worse screen.** "It already works" is not a reason, and neither is "it is only a form" — half the `pattern` rows are forms. Two ways to edit the same record is the real defect here, not the markup style.

### Answered — 2 Aug 2026

Andrew's ruling was to make the count future-proof rather than to decide route
by route, so each was checked against the code.

1. **Real, and still open.** A list by any reading; wants a `sections.js` entry.
2. **Real, and still open.** `edit` is already `pattern`, so `add` folds into it.
3. **Premise false — there is no user drawer.** `renderDrawer` is never called
   on `/users`; its call sites are pages/new, pages details, subscribers import,
   redirects, giving and audit. `drawer-user-permissions.png` draws a screen
   that was never built, so a user is editable exactly one way and nothing is
   duplicated. Build the drawer or keep the routes — either is fine, and the
   count is trustworthy as it stands. It is a gap, not a defect.
4. **Premise false — these are two different screens.** `/pages/details` is the
   *church details* record: one row, two path segments, the thing the map block
   and the footer read. The page drawer is `/pages/:id/details`, and it exists.
   They do not touch the same row, so there is nothing to reconcile.
5. **Youth answered: neither is a screen.** `/youth` and `/youth/` are both 302s
   to `/ministries` — one for the bare path, one preserving the subtree — so
   both are needed and neither converts. Reclassified `n/a`, which moves the
   count to 38 / 29 / 7. `/voters` is still unclassified.

⚠ The two false premises are the useful part. Both describe a record editable
two ways, which this task calls "the real defect", and a reader who trusted the
list would have gone looking for a duplication that was never there — or worse,
deleted a working route to resolve it.

---

## Task 16 — Bring the congregation-facing files onto the palette

**Reverses an earlier call.** `admin/email.js` and the newsletter archive page were marked `n/a` in `REDESIGN-STATUS.md` on the reading that they go to the congregation rather than to staff, so Foundations does not apply. That reading was never in the spec, and it is wrong.

The old hexes in those files are not a different palette — they are the **pre-redesign** palette. `#0A3C5C` is the steel we replaced, `#D4922A` the amber, `#3D3530` the charcoal, `#7A6E60` the grey. Nobody decided the congregation should get the old brand; it just never got swept. The people most likely to notice a colour drift are the ones who see the email on Thursday and the website on Sunday.

Sweep `admin/email.js`, the newsletter archive page, and the renter-facing blocks at the top of `admin/gym.js` (~lines 240–245) to the Task 1 values: `#0A3C5C`→`#1E2D4A`, `#D4922A`→`#C9973A`, `#3D3530`→`#1A1A2A`, `#7A6E60`→`#6A6858`, `#E8E0D0`→`#E7DFD1`.

**Three constraints that make this unlike Task 1** — email is not a browser:

1. **No variables, no stylesheet.** Every value stays an inline literal hex on the element. Do not introduce `var(--steel)` here; half the clients would drop it and render black on white.
2. **Fonts need real fallbacks.** `'Lora',Georgia,serif` and `'Source Sans 3',Arial,sans-serif` are right as written — most clients will land on Georgia and Arial, which is fine and intended. Do not remove the fallbacks.
3. **Geometry stays as it is.** The 6px radii, the `border-left:3px` accent on the note block, the 14px header radius — those are email conventions that survive client rendering. Task 1's radius audit and its "drop the left-border stripe" rule are browser rules and do not travel. Colour only.

Gold on navy: the email uses `#D4922A` text on `#0A3C5C` and gold-filled buttons with dark text. `#C9973A` on `#1E2D4A` holds the same contrast, so no layout or type changes follow.

After this, the only file legitimately off the palette is `admin/scheduler.html`, which is dead code behind the session gate. Update the *Not routes* table in `REDESIGN-STATUS.md`: `email.js` moves from `n/a` to a task row, and the note explaining the exemption comes out.

---

## Task 17 — The renter booking view: wrong domain, wrong shell

`https://admin.timothystl.org/gym/book/<token>` — the page a gym renter opens from a link in their confirmation email.

### a. It should not be on `admin.timothystl.org`

This is a public URL. It is pasted into emails to people outside the church, it is opened on their phones, and it will end up forwarded and bookmarked. Serving it from the admin hostname means:

- the admin origin is advertised to every renter, and to anyone they forward the email to;
- `admin.timothystl.org` cannot be locked down at the edge — you can't require an authenticated session for every path on that host while one path has to be anonymous;
- a renter who trims the URL back to the root lands on the admin login.

Move it to **`timothystl.org/gym/book/<token>`**, same worker, public route. Then require a session at the edge for every path on `admin.*` with no exceptions. Keep a permanent redirect from the old address so links already sitting in inboxes keep working — renters have confirmation emails going back months.

Check the rest of the renter flow for the same problem while you are in there: the invoice view, any payment or confirmation return URL, and whatever the booking form posts to. Anything a renter can reach moves.

### b. It should follow the brand, just not the admin chrome

**Refines the earlier ruling.** The gym portal keeping its own `:root` was right, and it is still right — a renter must not get the admin sidebar, the context bar or the ⌘K chip. But "not an admin screen" was taken to mean "not styled," and those are different things. A renter sees the same navy, the same gold, the same Lora and Source Sans 3 as every other public page.

Give it the **public site** shell, not the admin one: the green masthead with the logo and "from our Neighborhood to the Nations", the page beneath on sand, the site footer. No admin navigation of any kind. Forms, buttons and cards take the Foundations drawing values — 8px radius on inputs and buttons, 12px on cards, `#1E2D4A` primary with `#F5E4C0` text, blue focus ring — so the page matches `timothystl.org/worship` rather than matching nothing.

The `:root` in `gym.js` stays. Point it at the same values Task 1 set, and drop the pre-redesign greys at lines ~240–245 (Task 16 covers the email side of the same block).

---

## Task 18 — Rethink the renter booking page

Screenshots in `uploads/`. The page is not un-designed — navy masthead, gold rule, sand ground, Lora — it is on a *different* shell from the public site and the flow underneath it is inside out. Task 17 covers the domain and the shell. This is the pattern.

### What is wrong

1. **The insurance notice is the first thing on the page.** "Before your rental date, email a certificate of insurance" is an obligation that comes *after* booking. Putting it above the calendar makes the renter read a compliance requirement before they know whether the date they want is even free. Move it to the confirmation step and into the confirmation email, where it is actionable.
2. **The mode toggle is fine — the framing is wrong.** "Repeat weekly pattern" is not a competing flow, it is a bulk way to fill the same request: pick a range and the weekdays, get every matching open slot added at once. Keep it as a second tab, retitle it **Recurring dates**, and make clear both tabs feed one request. What is missing is the request itself — see below.
3. **The calendar encodes availability twice, in colour only.** Unavailable days get a red numeral *and* a red dot; available days a navy numeral *and* a green dot. Red numerals read as errors, the dot is redundant, and colour is the sole signal — which fails for anyone who cannot separate the two hues. Replace with: available days are a normal navy numeral in an outlined cell, `#FFFDF9` with `1px solid #E7DFD1`, hover raises them. Unavailable days are the numeral alone at `#A9A396`, no cell, no dot, not clickable. Absence of affordance is the signal. No legend needed, so no legend.
4. **There is nowhere to see what you have picked.** This is the real gap. A renter books Tuesday 6–7, Wednesday 5–6 *and* 7–8 — several slots, several dates, not necessarily adjacent. The calendar tracks it with a gold dot and nothing lists it. Add a persistent **Your request** panel: every slot grouped by date, each removable, with a running total. Without it the renter cannot check their own work before submitting.
5. **This is a phone page.** A renter opens it from an email on their phone. A 7-column month grid with tappable cells is the tightest thing on the page and needs to be designed at 390px first.

### The pattern

**Corrects an earlier draft of this task,** which described one date plus a contiguous block of hours. That is not the job. A request is a **basket of slots across many dates** — Tue 6–7 PM, Wed 5–6 PM and 7–8 PM — and hours on a day need not touch. There is no contiguity rule; adjacent hours on the same date merely print as one range in the summary (`5–7 PM`), while a gap prints as two (`5–6 PM, 7–8 PM`).

**Header** — public-site green masthead with the logo (Task 17b), then a navy band: "Gym Rental" in Lora, the group name beneath, and the rate strip inline — `$50.00/hr · Mon–Fri 5–9 PM · Sat 8 AM–8 PM · Sun 1–8 PM` at `13.5px #AFC0D2`. One block, not three stacked boxes. "My bookings" stays top right; "Book" as a button disappears — you are on it.

**Step 1 · Choose your slots.** The month grid, drawn as above, is a **multi-date** picker — it does not reset when you move to another date. Tapping a day opens its hours beneath the grid; tapping hours adds and removes them. Move to another day and the previous day's slots stay. Four day states, none carried by colour alone: **open** — navy numeral, outlined cell; **in your request** — filled navy cell with the count beneath (`·2`); **fully booked** and **not rentable** — grey numeral, no cell, not clickable, told apart by their tooltip rather than by hue.

**Step 1b · Recurring dates.** The second tab, for a season or a term. Date range, weekday toggles, then the rentable hours for each chosen weekday. **Add these to my request** adds every matching open slot to the same request — it does not replace what is there, and it reports how many it added. A renter with a season of Tuesday practices fills the whole thing in four taps.

**Step 2 · Your request.** The basket, and the part that does not exist today. One row per date, in date order: `Wed 5 Aug · 5–6 PM, 7–8 PM · 2 hrs · $100.00`, with a ✕ on each row and on each individual time. Totals at the foot. It stays visible while you keep picking — sticky at the foot of the viewport on a phone — because a request built across five dates cannot be checked from memory.

**Step 3 · Confirm.** Contact name, email, phone, and what the space is for. *Here* is the insurance notice, as a callout directly above the submit button, with the address as a `mailto:` link. Then the total, then **Request this booking** — request, not confirm, because the office prices and approves it. Say so in one line beneath: "The office will review and send an invoice. Nothing is charged now."

**After submit** — the same page, replaced by a plain confirmation: what was requested, what happens next, and the insurance reminder again. Not a redirect to a bare "thanks" page.

### The one thing to keep

The month grid with per-day availability is right, and it is the reason this cannot become the list-and-drawer pattern. Same reasoning as Blocked dates: you book a gym by looking at a month.

---

## Task 19 — Group edit, and a form-width rule for every screen

`/gym-rentals/groups/edit/<id>`. The palette and type are right; the hierarchy is upside down.

1. **The booking link outranks the record.** You come to this page to edit a group. The link card is a utility, and it is currently the loudest thing on the screen — above the group's own name, in the mist tint `#E7EEF7` with a heavy navy border. That treatment means *selected* everywhere else in the admin; here it is decoration. Put **Group details first** — name, contact person, contact email, phone, rate — and the booking link in a plain card beneath, `#FFFDF9` / `1px #E7DFD1` like every other card. It is not less important, it is just not the subject.

2. **Copy is the whole point of the card and it is clipped off the right edge.** Field and **Copy** sit in one flex row, `gap:10px`, the field `flex:1` and the button `flex:none` — never a grid that can push the action out of view. Copy is the card's primary action: navy fill. On click it becomes "Copied" for two seconds.

3. **Regenerate is a destructive action dressed as a normal one.** "Regenerate token (old link stops working)" is a bordered button at the same weight as Copy, with its own warning folded into the label. It invalidates a link that is sitting in other people's inboxes. Make it a text button at the card foot, `#9A3B2E`, no fill, label just **Regenerate link** — and put the consequence in a confirm step that names what breaks: "The link you have already shared will stop working. The group will need the new one." Same treatment as Delete in the drawer foot.

4. **The context bar stops one crumb short.** It reads `Money & Building / Gym rentals` while you are on a specific group. Per `00b-header-nav.html`, an editor appends a third crumb: `Money & Building / Gym rentals / Test`. The `← Groups` back-link above the `h1` is correct and stays.

5. **Drop the 📋 glyph** on the card label. No emoji anywhere in the admin.

### The general rule this exposes

Task 2 dropped `.wrap{max-width:860px}` because it was a symptom of the missing sidebar. That was right for list screens, which want the width. It was wrong for **forms**: "Group name" is now a text input the full width of a 1900px monitor, and the eye has to travel the whole screen to get from the label to the value.

Add to Foundations and apply everywhere a form renders:

- A single-column form column caps at **640px**, left-aligned under the heading — not centred.
- A two-column form caps at **920px**.
- The page heading, purpose line and any full-width table or list are **not** capped. Only the field column.
- Buttons at the foot of a form align to the left edge of the field column, not the right edge of the page.

This affects every `converted` row in `REDESIGN-STATUS.md`, so fix it in the shared form wrapper rather than per route.

---

## Definition of done

- `admin/REDESIGN-STATUS.md` has no `legacy` rows.
- `rg '#0A3C5C|#D4922A|#3D3530|#7A6E60' admin/ tlc-admin-worker.js` returns nothing.
- `rg ':root\{' admin/` returns exactly two hits — the shell, and the renter-facing gym portal (exempt, see Rulings).
- `rg 'util-bar' admin/ tlc-admin-worker.js` returns nothing. `sidebar-toggle`, `sidebar-backdrop` and `translateX(-100%)` are **expected** hits now — they are the sub-900px slide-over from Task 2 item 3, correctly `display:none` above that width. An earlier draft of this line said they should return nothing; that was written before item 3 existed. `ui.test.mjs` asserts the right thing and is the check that counts.
- `npm test` green, with new cases for the palette sweep, the new `sections.js` entries, and the sidebar's group/permission logic.
- Every screen file in `design_handoff_admin_overhaul/screens/` has been opened and compared against the running admin at the same width.
