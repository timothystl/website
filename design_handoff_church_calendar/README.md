# Handoff: Custom Church Calendar (timothystl.org)

> **Two prototypes live in this folder, from two separate Claude Design
> handoffs sharing one project.** `Calendar Directions.dc.html` (this
> README) is the public `/calendar` page and the printed month sheet —
> shipped as "The calendar is ours now" in `CLAUDE.md`. `Event Intake.dc.html`
> plus `support.js` is the office's own triage screen over that same feed,
> a **separate, later handoff** — shipped as "Event Intake — the office's
> own triage queue" in `CLAUDE.md`, built in `admin/intake.js` and
> `admin/intake-page.js`. Read `CLAUDE.md` first; this file only describes
> the calendar prototype below.

## Overview
Replace the Google Calendar iframe on `/calendar` (and the embed on `/news`) with a
calendar the site renders itself from a merged event feed. Two problems drive this:

1. **Google's month view caps events per day cell** ("N more"), regardless of iframe
   height. Busy Sundays hide two of three services.
2. **Events are recorded in several places.** Google Calendar holds room-and-time
   bookings; News & Events records (`admin.timothystl.org/api/news`) hold anything with a
   description, photo, or signup. Google imports poorly from other sources, so the merge
   has to happen on our side.

Rendering the calendar ourselves solves both: no cap, and the feed is ours to assemble.

## About the Design Files
`Calendar Directions.dc.html` is a **design reference created in HTML** — a prototype of
intended look and behavior, not production code to copy. Recreate these designs in the
site's existing environment: this is a static `public/index.html` single-page site with a
hash router (`showPage()`), vanilla JS, CSS custom properties in `public/styles.css`, and
Cloudflare Workers for data (`admin.timothystl.org/api/*`). Stay in that stack — plain JS
render functions and `styles.css` classes, no framework, no build step. The prototype uses
inline styles purely because of its own authoring constraints; production should use
`styles.css` classes and the existing `var(--*)` tokens.

`reference/styles.css` is the site's current stylesheet, included so token names can be
matched exactly.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and interactions are final. Recreate
pixel-accurately using the site's existing tokens and fonts. Sample event data in the
prototype (August 2026) is placeholder — real data comes from the feed.

---

## Screens / Views

The prototype canvas holds five boards. **1b and 2a are the deliverables.** 1a is the
current state for comparison; 1c and 1d are alternates that were explored; 3a documents
the merge model.

### 1b — Month, uncapped (PRIMARY — the new `/calendar`)
**Purpose:** the default calendar view. Every event on every day is visible.

**Layout:** full-width card, `background #FBF8F3`, `border 1px solid #DDE3ED`,
`border-radius 12px`, `overflow hidden`, `box-shadow 0 6px 32px rgba(30,45,74,.14)`.
Four stacked bands:

1. **Toolbar** — `padding 18px 24px`, `background #fff`, `border-bottom 1px solid #DDE3ED`,
   flex row `justify-content: space-between`.
   - Left group (`gap 14px`): prev/next buttons (34×34px, `border 1px solid #DDE3ED`,
     `border-radius 8px`, `background #fff`, glyphs `‹` `›` at 16px `#1E2D4A`;
     hover `background #EDF2F7`); month title `Bricolage Grotesque 26px/700 #1E2D4A`;
     "Today" pill (`Bricolage Grotesque 12px/800 #2E7EA6`, `border 1px solid #C4CEDF`,
     `border-radius 999px`, `padding 6px 12px`).
   - Right group (`gap 8px`): Month/List segmented control — track `background #EDF2F7`,
     `border-radius 999px`, `padding 3px`; active segment `background #1E2D4A`, `#fff` text,
     `padding 7px 14px`, `Bricolage Grotesque 12px/800`. Then a "Subscribe" outline pill
     (`1.5px solid #1E2D4A`, `#1E2D4A` text) and a **"Print month"** solid pill
     (`background #1E2D4A`, `#fff` text, `padding 8px 15px`, printer SVG at 13px,
     hover `background #2A3F60`).
2. **Source band** — `padding 12px 24px`, `background #FBF8F3`,
   `border-bottom 1px solid #DDE3ED`. Label "SOURCE"
   (`Bricolage Grotesque 10px/800`, `letter-spacing .14em`, uppercase, `#8A8898`), then
   three pills: **Both sources / Google Calendar / News & Events**. Selected pill
   `background #1E2D4A`, `#fff`, `border 1px solid #1E2D4A`; unselected `background #fff`,
   `#4A4860`, `border 1px solid #DDE3ED`. `border-radius 999px`, `padding 6px 13px`,
   `Bricolage Grotesque 12px/700`. Right-aligned (`margin-left: auto`) source key: 7×7px
   `border-radius 2px` swatches — `#2E7EA6` "Google", `#C9973A` "News & Events" —
   labels `Newsreader 14px #8A8898`.
3. **Category band** — `padding 14px 24px`, `background #fff`,
   `border-bottom 1px solid #DDE3ED`, wrapping flex `gap 8px`. One pill per category plus
   a leading "All events" pill. Each carries an 8×8px round dot in its category color.
   Same selected/unselected treatment as the source pills.
4. **Grid** — `display: grid`, `grid-template-columns: repeat(7, minmax(0, 1fr))`.
   **The `minmax(0, 1fr)` matters** — plain `1fr` lets a long event title widen the
   Saturday column and break uniform day widths. Every cell needs `min-width: 0`, and so
   does every text span inside it.
   - Weekday header row: `padding 10px`, `background #fff`,
     `Bricolage Grotesque 11px/800`, `letter-spacing .1em`, uppercase, `#8A8898`,
     full day names (SUNDAY … SATURDAY).
   - Day cells: `min-height 150px` (grows to the busiest day — no cap, no "N more"),
     `padding 9px 9px 12px`, `border-right`/`border-bottom 1px solid #DDE3ED`, flex column
     `gap 5px`. In-month `background #fff`; out-of-month `#F4F1EA` with `#B8B4AC` numbers;
     today `#FDF6E7` with `#C9973A` number plus a "TODAY" tag
     (`Bricolage Grotesque 9px/800`, `letter-spacing .1em`, uppercase, `#C9973A`).
     Date number `Bricolage Grotesque 13px/700 #1E2D4A`.
   - **Event chip** — flex column, `gap 1px`, `padding 5px 7px`, `border-radius 7px`,
     `background` = category tint, `min-width: 0`, hover `filter: brightness(.97)`.
     Top line is a flex row (`gap 5px`): full time
     (`Bricolage Grotesque 10px/800`, `letter-spacing .06em`, category color,
     `white-space: nowrap`, `font-variant-numeric: tabular-nums`) followed by a 6×6px
     `border-radius 2px` source swatch (`title` attribute = source name). Second line is
     the title, `Newsreader 13px/1.3 #1A1A2A`, wrapping freely.
     **Time above title, not beside it** — gives the title the full cell width.
     No left border rule on the chip; the tint and the colored time carry the category.

### 2a — Print sheet (one-page month grid)
**Purpose:** the printed monthly calendar for the narthex and the office.

Landscape US Letter, `@page { size: letter landscape; margin: 0.35in; }`. Sheet is 1056px
wide on screen, `background #fff`, `padding 34px 38px`.
- **Header** — `border-bottom 2px solid #1E2D4A`, `padding-bottom 10px`, flex row
  `align-items: flex-end`, `justify-content: space-between`. Left: "TIMOTHY LUTHERAN
  CHURCH · 6704 FYLER AVE" (`Bricolage Grotesque 11px/800`, `letter-spacing .14em`,
  uppercase, `#4A4860`) above the month (`Bricolage Grotesque 28px/700 #1E2D4A`).
  Right: full category legend, wrapping, `max-width 560px`, right-justified — 8×8px
  `border-radius 2px` swatch + `Bricolage Grotesque 9px/700 #4A4860` name.
- **Grid** — same 7 × `minmax(0,1fr)` structure, borders `1px solid #C9C5BD`. Weekday
  header `background #F1EFEA`, `Bricolage Grotesque 9px/800`, `letter-spacing .1em`,
  three-letter names. Cells are a **fixed `height: 112px` with `overflow: hidden`** — the
  one place a cap is correct, because the sheet must stay one page.
  Event row: `display: grid; grid-template-columns: 3px 1fr; gap: 4px` — a 3px
  `border-radius 2px` bar in the category color, then `Newsreader 9.5px/1.25 #1A1A2A`
  text whose time is a bold `Bricolage Grotesque 8.5px/800` prefix.
  **The print sheet ignores the active filters** — it always prints everything.
- **Footer** — flex row `justify-content: space-between`,
  `Bricolage Grotesque 9px #8A8898`: "timothystl.org/calendar · (314) 781-8673" and
  "Sunday worship 8:00 & 10:45 am".

**Print CSS** (the whole mechanism):
```css
@media print {
  @page { size: letter landscape; margin: 0.35in; }
  body { background: #fff; }
  [data-noprint] { display: none !important; }
  [data-printsheet] { box-shadow: none !important; border: none !important; padding: 0 !important; }
}
```
Every Print button is just `window.print()`. Mark the print sheet `data-printsheet` and
everything else `data-noprint`, so printing from any view yields only the month sheet.

### 3a — Merged feed (reference, not a shipping screen)
Documents the two-source model and the de-dupe rule. Two panels: a scrolling list of
entries with a source/category filter, and a written "where a thing gets entered" key.
Worth reading before implementing the Worker; not a page to build.

### 1c — Week-grouped list (alternate)
No grid. Sticky week headers (`background #EDE9E0`, `padding 9px 32px`). Each day is a
`grid-template-columns: 96px 1fr`, `gap 22px`, `padding 18px 32px` row: left column has
day-of-week (`Bricolage Grotesque 11px/800`, uppercase, `#8A8898`), date
(`Bricolage Grotesque 32px/700 #1E2D4A`), month (`Newsreader 13px #8A8898`); right column
lists events as `88px 1fr` rows — time (`Bricolage Grotesque 13px/800`, category color,
tabular-nums) then title (`Newsreader 17px/1.4 #1A1A2A`) over location
(`Newsreader 14px #8A8898`). Identical on phone and desktop, so the existing
month/agenda swap in `tlcLoadCalendar` becomes unnecessary. **Use this layout for the
mobile breakpoint of 1b.**

### 1d — Navigator + agenda (alternate)
`grid-template-columns: 320px 1fr`. Left rail (`background #fff`,
`border-right 1px solid #DDE3ED`, `padding 24px`): mini month of `aspect-ratio: 1`
buttons (`border-radius 8px`; selected `background #1E2D4A`/`#fff`; a 4px dot in
`#C9973A` marks days with events), then the category legend with its Google color name
beside each, then Subscribe and Print buttons. Right pane scrolls the whole month as
`120px 1fr` agenda rows, `max-height 760px`. The legend's Google-color column is the
useful piece — it tells the office which color to pick in Google.

### 1a — Current state (comparison only)
The existing page reproduced: green nav, navy `.page-hero`, the Google iframe with its
two-chips-plus-"3 more" cap, dark footer. Do not build.

---

## Interactions & Behavior
- **Category filter** — pills are mutually exclusive; "All events" clears. Filters the
  grid in place; empty days simply render empty.
- **Source filter** — same, over Google / News & Events / both.
- Both filters compose (AND). Any combination yielding nothing needs an empty state:
  `Bricolage Grotesque 16px/800 #1E2D4A` heading over `Newsreader 15px #8A8898` body,
  `padding 44px 22px`, centered.
- **Prev/next/Today** — month navigation; refetch or re-slice the feed per month.
- **Month/List toggle** — swaps 1b's grid for 1c's list.
- **Print** — `window.print()`; CSS does the rest.
- **Subscribe** — links to an `.ics` of the merged feed (see below). This is the piece
  Google's embed buries; keep it visible.
- **Event chip hover** — `filter: brightness(.97)`. Clicking a chip should open a detail
  panel with the full description; the prototype does not model this.
- **Responsive** — below ~900px, switch to the 1c list. Never a 7-column grid on a phone.
- Preserve the current lazy behavior: the calendar only fetches when its page is opened,
  so `/news` costs no more to load than it does now.

## State Management
```js
{
  month:  Date,                 // visible month
  filter: 'all' | categoryKey,  // category pill
  src:    'all' | 'gcal' | 'news',
  sel:    number | null,        // selected day (1d only)
  events: Event[],              // merged, normalized
  status: 'loading' | 'ready' | 'error'
}
```

Normalized event shape:
```js
{ id, start, end, allDay, title, location, description, category, source }
```

### The feed (Worker)
New route, e.g. `admin.timothystl.org/api/calendar?from=&to=`:
1. Fetch both Google calendars (the two IDs already in the embed URL) via the Calendar
   API with `singleEvents=true&orderBy=startTime`, requesting `colorId`.
2. Fetch News & Events records; keep those carrying a date.
3. Normalize both into the shape above.
4. **De-dupe:** same title (normalized case/whitespace) within 30 minutes on the same day
   collapses to one entry. **The News record wins** — it has the richer copy.
5. Sort by start; return JSON. Cache ~10 minutes at the edge.
6. Serve the same normalized array as `.ics` on a second route for Subscribe.

Client-side, filters and month navigation operate on the returned array — no refetch per
filter change. Show a skeleton grid, not a spinner, while loading; on error fall back to
a link out to Google Calendar rather than an empty grid.

### Categories — sourced from the Google event color
Google events have no category field, so **the event's color is the category**, set once
in Google by whoever enters the event. The Worker maps `colorId` → category; News records
carry their category explicitly. The site then draws its own palette rather than Google's
hues, so ten categories still read as one calendar.

| Category | Google color | Color | Tint |
|---|---|---|---|
| Worship | Blueberry | `#1E2D4A` | `#EDF2F7` |
| Learn / Bible study | Peacock | `#2E7EA6` | `#E8F1F6` |
| Ministry & service | Basil | `#4A5E3A` | `#EDF1E9` |
| Facility / rentals | Graphite | `#7D7972` | `#F1EFEA` |
| Youth & family | Tangerine | `#B0821E` | `#F8F0DE` |
| Word of Life School | Sage | `#3A4E5C` | `#EAEFF2` |
| Mother's Day Out | Banana | `#8A6E2F` | `#F5EFE0` |
| Music | Grape | `#7A5A7A` | `#F2ECF2` |
| Meetings | Lavender | `#6A8090` | `#EEF2F4` |
| Special events | Tomato | `#C9973A` | `#FBF1DC` |

WOL and MDO are **separate** categories, not one "School" bucket. Facility rentals and
internal meetings **are shown publicly** — no hiding.

Unmapped or default-colored events fall back to a neutral category rather than being
dropped. Document the color→category table for the office; a legend on the page (1d's
rail) doubles as that documentation.

## Design Tokens
All from `public/styles.css`; look up the live `var(--*)` names there rather than
hardcoding.

**Color** — navy `#1E2D4A` (primary, `--steel`); deeper navy `#111E32` (footer);
amber `#C9973A`; light amber `#E8C070`; teal `#2E7EA6` (links, Google source);
green `#4A5E3A` (nav); ink `#1A1A2A`; body text `#4A4860`; muted `#8A8898`;
canvas `#E4E0D6`; card `#FBF8F3`; band `#EDE9E0`; white `#fff`;
border `#DDE3ED`; strong border `#C4CEDF`; print border `#C9C5BD`;
hover fill `#EDF2F7`; today fill `#FDF6E7`; out-of-month `#F4F1EA`.

**Type** — headings/UI: Bricolage Grotesque, weights 400/600/700/800.
Body: Newsreader, weights 300/400/600/700 plus italic.
Sizes in use: 8.5, 9, 9.5, 10, 11, 12, 13, 14, 15, 16, 17, 22, 26, 28, 32, 40, 52px.
Uppercase eyebrows use `letter-spacing` .1–.16em at 9–11px/800.
Times always `font-variant-numeric: tabular-nums`.

**Spacing** — 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 34,
38, 40, 44, 56px.

**Radius** — 2px (swatches), 3px (legend squares), 7px (event chips), 8px (buttons,
mini-month cells), 12px (cards), 999px (pills).

**Shadow** — `0 6px 32px rgba(30,45,74,.14)` on cards; none in print.

**Grid** — always `repeat(7, minmax(0, 1fr))` with `min-width: 0` on cells and text.

## Assets
- `public/logo.png` — existing church logo, used in 1a's nav only.
- Printer icon — inline SVG, 24×24 viewBox, `stroke-width 2.2`, `currentColor`,
  round caps/joins. No icon library needed.
- Fonts — Bricolage Grotesque and Newsreader, already loaded by the site from Google Fonts.
- No other images. Event data comes from the feed.

## Files
- `Calendar Directions.dc.html` — all five boards. Open in a browser; boards are laid out
  on one canvas with visible `1a` / `1b` / `2a` / `3a` badges matching this README.
- `reference/styles.css` — the site's current stylesheet, for exact token names.
- In the repo (`timothystl/website`, branch `main`): `public/index.html` — nav ~line 140,
  `#page-calendar` ~912, footer ~1904, `tlcLoadCalendar()` ~3500, `loadNewsItems()` ~2113
  (the News & Events fetch to merge with).
