# Handoff: /news redesign and the 1b site language

> **Building with Claude Code? Paste `KICKOFF_PROMPT.md` as your first message** — it points the agent at the right files in the right order and asks it to verify against the repo before writing code.
>
> **The build plan itself is `CLAUDE_CODE_BRIEF.md`** — a phased build plan with a Phase 0 verification list of the six things most likely to break the plan, plus acceptance criteria and known gaps.
>
> **Start with `Handoff.dc.html`** — the same specification as this file, with screenshots of every screen and state, annotated block stacks, colour swatches, the three editor flows, and a done-means checklist. Open it directly in a browser. This markdown is the plain-text mirror, for pasting into an issue tracker.
> Screenshots live in `screens/`.

## Overview

`timothystl.org/news` renders correctly today and reads as dead: navy page hero, two identical linen sections, white cards in a single column, a Google Calendar iframe. Andrew's brief, verbatim: *"it just feels dead, and so do all the pages on the site — the editor is helpful, it just all lacks energy."*

This bundle contains:

1. A faithful recreation of the current `/news` page (the "before").
2. Three redesign directions for `/news`. **Direction 1b was chosen.**
3. Direction 1b extended to Home, About, Worship, Sermons, Ministries, Our Values, Give and Visit — it is the new site language, not a one-off page.
4. The admin block editor rebuilt around that language, with the block types and controls it needs.

The energy comes from three decisions, in priority order: **full-bleed photography**, **display type at real scale**, and **a few live/moving elements** (a countdown to the next event, a pulsing "happening next" dot, hover zoom on photos). Andrew explicitly asked for photographs and motion, and explicitly opened the door to new type and palette.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy.

The target codebase is `timothystl/website` (branch `main`), a bundler-less Cloudflare Workers project:

- `public/index.html` — the single-file SPA. All 28 pages live here as `<div id="page-*" class="page">`.
- `public/styles.css` — the site stylesheet (CSS custom properties in `:root`).
- `admin/blocks.js` — **the one place a block becomes HTML.** Block schema (`BLOCK_DEFS`), sanitization, palettes (`BG`, `INK`, `SIZES`, `SPLITS`, `TONES`), `BLOCK_CSS`, `renderInner()`, `renderBlock()`, `renderPage()`. The public site and the editor canvas both render through it, which is why they can never drift.
- `admin/site-pages.js` — generated seeds (`SITE_PAGES`): each page's blocks as saved draft data.
- `admin/site-pages.js` / `admin/ui.js` — the editor shell that the prototype in `design_handoff_admin_overhaul/` was built into.

So implementation is: **new block types added to `admin/blocks.js`** (defs + renderers + `BLOCK_CSS`), **new tokens in `public/styles.css`**, **seeds updated in `admin/site-pages.js`**, and the editor's inspector extended for the new per-block controls. Do not port the prototypes' React/DC structure — it exists only to make the design interactive here.

Note the repo's existing rule and keep it: **the header, footer and newsletter band are not blocks** (they appear on all 28 pages and are admin-managed under Menu · Appearance / Footer columns). The editor prototype labels them as chrome on purpose.

## Fidelity

**High-fidelity.** Colors, type, spacing, radii and motion values below are final and were authored, not sampled. Recreate them exactly. Two caveats:

- **Photographs are placeholders.** Every picture in the mocks is an `<image-slot>` drop target because the church has "a handful" of usable photos and none in the repo. Real photos must be supplied before launch; the design depends on them. Each slot's placeholder text says what belongs there.
- The mocks are drawn at a 1080px canvas. Phone and tablet behavior is described under *Responsive behavior*, but only desktop is pixel-specified.

## Design tokens

### Palette (new — supersedes the current navy/gold set for these pages)

| Token | Hex | Use |
|---|---|---|
| Ink navy | `#101B2E` | Masthead, footer, dark bands, headline color on paper |
| Navy 2 | `#1B2C4A` | Secondary dark tiles, body links on paper |
| Gold | `#E4A93C` | Primary accent: eyebrows on dark, CTA fills, active nav rule |
| Gold deep | `#B37F1E` | Link color on paper |
| Gold shadow | `#3B2E12` | Eyebrow text *on* a gold field |
| Gold ink | `#3B2E12` | Body text on a gold field |
| Clay | `#B44A2E` | Second accent — eyebrows on paper ("The whole month", "Stay connected") |
| Paper | `#F5F0E6` | Section bands, cards |
| Card | `#FFFDF8` | Page surface |
| Body ink | `#453F30` | Body copy on paper |
| Muted ink | `#4A4636` | Secondary copy |
| Sand line | `#D8CFBB` | Hairlines, chip borders |
| Sand line 2 | `#E7DFCD` | Softer rules inside cards |
| Meta ink | `#8A8168` | Small caps meta on paper |
| Cream on dark | `rgba(245,240,230,.78)` | Body copy on navy |

Existing tokens in `public/styles.css` (`--steel`, `--amber`, `--warm` …) stay for pages not yet converted. Add the above as new custom properties rather than redefining the old ones.

### Type

Two families, both Google Fonts:

- **Bricolage Grotesque** (`opsz,wght@12..96,400..800`) — display and UI. Weights used: 600, 700, 800.
- **Newsreader** (`ital,opsz,wght@0,6..72,300..600;1,…`) — body and quotes. Weights used: 300, 400 italic, 600.

The admin chrome keeps the existing **Source Sans 3** + **Lora**; only the canvas (the page being edited) uses the new pair.

| Role | Spec |
|---|---|
| Hero headline (banner, no info card) | 800 64px/0.98, `letter-spacing:-.03em`, `max-width:19em`, white |
| Hero headline (banner + info card) | 800 56px/1 |
| Home hero headline | 800 58px/1 (three authored `<br>` lines; at 74px the copy needs ~800px and breaks to four — do not raise it) |
| Page H1 (Worship / Ministries) | 800 66–72px/1 |
| Section heading | 800 36–40px/1.05, `-.02em`, `#101B2E` |
| Card heading | 700 22–25px/1.15, `-.01em` |
| Service time numeral | 800 52–56px/1, `-.03em` |
| Eyebrow | 800 11–12px/1, `letter-spacing:.16em` (`.18em` on page-level), uppercase |
| Meta / date small caps | 600 11.5–13px/1, `.06–.1em`, uppercase |
| Body | 300 15–20px/1.6, Newsreader |
| Quote | italic 400 28–30px/1.35, Newsreader |
| Countdown | 700 34px/1, `font-variant-numeric:tabular-nums` |
| Nav item | 600 14px Newsreader |
| Button label | 800 13–14px Bricolage |

### Geometry & motion

| Value | Spec |
|---|---|
| Page gutter | 44px (34px inside the editor canvas; 26px in a half-width block) |
| Card radius | 18px (feed/cards), 20px (ministry + visit cards, media), 22px (info card, service tiles, CTA band) |
| Pill radius | 999px — every button in this language is a pill |
| Grid gap | 18–22px |
| Section band padding | 40–56px vertical |
| Hero veil | `linear-gradient(180deg, rgba(16,27,46,V) 0%, rgba(16,27,46,.15–.18) 42%, rgba(16,27,46,.88–.9) 100%)` where V = **.5 light / .72 medium / .88 heavy** |
| Photo hover zoom | `transform:scale(1.04–1.05)`, `transition:transform .5s cubic-bezier(.2,.8,.2,1)`, on a wrapper with `overflow:hidden` |
| Card lift | `translateY(-4px)` + `box-shadow:0 18px 40px rgba(16,27,46,.16)`, `.3s cubic-bezier(.2,.8,.2,1)` |
| "Happening next" dot | 8px circle, gold, `@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}` 1.8s ease-in-out infinite |
| Page card shadow (mock only) | `0 24px 60px rgba(16,27,46,.18)` — an artifact of showing a page inside a desk; do not ship |

Spacing controls stay on the repo's existing guardrail: **8px steps, 0–96** (`SPACE_STEP`, `SPACE_MAX`, `snapSpace` in `admin/blocks.js`).

## Screens

### 1. `/news` — the chosen direction (1b)

Block stack, in order:

1. **Photo banner** — 640px tall, full-bleed `<image-slot>`, medium veil. Overlaid: pulsing gold dot + "HAPPENING NEXT" eyebrow, 64px headline ("Confirmation kicks off Sunday."), then a row of the **countdown** ("9d 20h 11m 13s", labelled "STARTS IN") beside a 18px Newsreader subtitle. Masthead sits transparent over the top of the photo.
2. **Coming-up strip** — "COMING UP" label + up to 5 pill chips ("Aug 23 · Confirmation"), 1px `#D8CFBB` border, `#F5F0E6` fill, on a hairline-bottomed row.
3. **News feed** — 36px heading, one-line intro, then a 2-up grid of cards: photo (180px, hover-zoom) · navy tag pill + small-caps date · 22px heading · 15px body. Announcements and events in one feed, soonest first (Andrew chose combined, not split).
4. **Weekly letter** — navy band, two columns: left = date eyebrow, 36px heading, intro, "Read this week" gold pill + "Get it by email" ghost pill; right = the newsletter archive as `subject / date` rows on `rgba(245,240,230,.14)` hairlines.
5. **Calendar** — clay eyebrow "THE WHOLE MONTH", 36px heading, intro, two pills ("Open in Google Calendar", "Subscribe on your phone"), then the live Google Calendar month embed inside a `#F5F0E6` 18px-radius tray with a 11px-radius white inner frame, 560px tall. Embed URL is the one already in `public/index.html` (`calendar@timothystl.org` + the `c_7f6d…` secondary calendar), with `bgcolor=%23ffffff`.

The "Subscribe on your phone" pill is new and deliberate: it gets the calendar into people's own phones instead of relying on them revisiting the page.

### 2. Home

Photo banner (tall, **info card on the right**) · quote band · **core-values strip** · **sermon card + news list as two half-width blocks side by side** · email signup band.

- The info card is the white 22px-radius card carrying "JOIN US SUNDAY", `8:00 & 10:45 am` at 32px, a hairline, the address, and a "Plan your visit" navy pill. It reads the church-details record — it is a *slot on the banner*, not a draggable block (this matches `CARD_SIDES`/`CARD_SHOWS` in `admin/blocks.js`).
- Quote band: paper, two columns, the vision quote in italic Newsreader 28px with a 3px gold left rule at 24px padding, beside the "rooted in Lindenwood Park" paragraph.
- Sermon card: navy 22px-radius, 240–280px photo with a 60px white play disc, gold series eyebrow, 30px title, body, "Watch or listen".
- News list: pulsing clay dot + eyebrow, then rows of `small-caps date / 20px title` on `#E7DFCD` hairlines, ending in an "All news & events" paper pill.

### 3. Our Values

Photo banner (short, 460px, no card, green glow layer) · **value selector** · **value panel** · one-sheet slot + "why this order" card.

Four core values in fixed order — **Welcome + Acceptance**, **Receive + Worship**, **Grow + Christian Education**, **Go + Outreach**. Each carries a tagline, six ways in, and a partner organisation (LASM, Concordia Seminary St. Louis, Word of Life Lutheran School, CFNA).

- Value selector: four cards in one row. Selected sits on its field with light ink; the rest are paper with a 3px top rule in that value's bright accent.
- Value panel: the field, 44px padding, 22px radius. Left — the word in Newsreader italic 68px, discipline label, fading rule, tagline in italic 21px, then the partner box on a `rgba(16,27,46,.18)` wash. Right — six ways in, 2-up, ring marker + uppercase title + one line.
- One-sheet slot holds the printed value card as an image; the navy card beside it carries one sentence on why the order is what it is. Both swap with the selection.
- **The order is fixed.** No reorder control on this block.

**Field colours** (authored to a contrast budget — see below):

| Value | Field | Ink | Bright accent |
|---|---|---|---|
| Welcome | `linear-gradient(150deg,#153A1E,#2F6B3A 58%,#3F7A38)` | white | `#6FA84E` |
| Receive | `linear-gradient(150deg,#0E2B5B,#1B4FA0 58%,#3266AE)` | white | `#3E7BD1` |
| Grow | `linear-gradient(150deg,#0C3F47,#17636D 58%,#1F7A86)` | white | `#45AFB8` |
| Go | `linear-gradient(140deg,#E4A93C,#F0C46B 52%,#D89428)` | dark (`#101B2E` / `#3B2E12`) | `#E8A93C` |

**Contrast budget — apply to any new gradient field, not just these four.** A field is measured at the end that hurts: the light stop for white ink, the dark stop for dark ink — never the average or the mid stop. On a white-ink field the light stop must clear 4.5:1 against `#fff`; that is why all three dark fields are darker than the brand hues they came from. White ink is near-opaque (`.94` body, `.88` labels). A translucent panel inside a coloured field uses a **dark** wash `rgba(16,27,46,.18)` — a white one lightens the surface the white text sits on. The brighter brand hues survive as accents on rules and borders, where nothing is set on top of them.

The four hues are the one departure from navy and gold, and are allowed on exactly three things: the value card field, its unselected top rule, and the accent on the "why this order" card. Never nav, buttons, links or headings.

### 4. Worship

Photo banner (medium, no card) · **service times** (two 22px-radius tiles: navy `8:00 am`, gold `10:45 am`, each with eyebrow, 52px numeral, note) · **card grid** "First time visiting?" 2-up (Parking / Kids & families / What to wear / Questions first?) · **text + photo** navy band, "A soundscape as wide as grace", photo right, gold "Watch the live stream" pill + ghost "Music ministry".

### 5. Ministries

Photo banner (short) · **card grid** 3-up, nine ministries, logos on, first card featured navy · **call-to-action band** gold, "Ready to put your hands to work?" with a navy pill.

### 5. The editor (`admin` page editor)

Chrome is unchanged from the shipped design — reuse it exactly: 58px navy top bar (`#1E2D4A`) with brand block, `Pages / <page>` breadcrumb, status pill, autosave label, Desktop/Tablet/Phone segmented control, Undo, "View live ↗", gold Publish; the sand coach strip; the 216px `#F7F3EC` site rail; the navy bottom palette with group tabs; the 322px inspector with Block/Page tabs and the unpublished-changes footer.

What is new:

- **Canvas** renders the 1b language and is fitted with `zoom: min(1, available / designWidth)` measured by a `ResizeObserver` on the scroll container. Without this the 1080px canvas squeezes and 64px type reflows — the editor then lies about the page. (`max-width:100%` on the canvas is the bug; do not reintroduce it.)
- **Selection**: 2px `#2E7EA6` inset outline, plus a navy floating toolbar 13px above the block's top-left: block name in gold small caps, then ↑ ↓ ⧉ (duplicate) ◎ (hide) ✕.
- **Hidden blocks** render as a dashed placeholder saying so, rather than vanishing.
- **Half-width pairing**: `Block width · Full / Half`. Two consecutive halves make one row, left then right; a third starts a new row; halves collapse to full below 640px. This mirrors the existing `.tlcb-pair` grid rule.
- **Header/footer chrome markers** in the canvas: `rgba(30,45,74,.86)` chip reading "Header · Menu · Appearance" / "Footer · Menu · Footer columns".

## New block types

Add to `BLOCK_DEFS` in `admin/blocks.js`. Each is listed with the fields the inspector edits.

| Type | Label | Group | Fields |
|---|---|---|---|
| `photobanner` | Photo banner | Structure | `photo`, `eyebrow`, `title`, `sub`, `height` (short 420 / mid 520 / tall 640), `veil` (0–2), `card` (off / services), `countdown` (bool), `pulse` (bool) |
| `newsfeed` (extend existing) | News feed | Content | `title`, `count` 1–6, `cols` 1–2, `photos` (bool) |
| `quote` | Quote band | Content | `title` (the quote), `body`, `tone` (navy / paper) |
| `chips` | Coming-up strip | Dates & details | `count` 1–6 — self-filling from the calendar |
| `cards` (extend `cardgrid`) | Card grid | Content | `title`, `body`, `count`, `cols` 2–3, `logos` (bool), `feature` (bool · first card navy) |
| `servicetimes` (extend) | Service times | Dates & details | self-filling; renders as the two big tiles |
| `textphoto` (extend) | Text + photo | Content | `eyebrow`, `title`, `body`, `photo`, `side` (left / right), `tone` |
| `letter` | Weekly letter | Sign up & give | `title`, `count` 1–6, `tone`, `signup` (bool) — self-filling archive |
| `cta` | Call-to-action band | Structure | `eyebrow`, `title`, `body`, `btn`, `tone` (gold / navy) |
| `signup` | Email signup | Sign up & give | `title`, `body`, `tone` |
| `calendar` (extend) | Calendar | Dates & details | `title`, `height` (s 420 / m 560 / l 700), `subscribe` (bool) |
| `values` | Core values | Content | `title`, `cols` 2–4. Self-filling. The four cards in fixed order — Welcome, Receive, Grow, Go. No reorder control. |
| `highlight` | Standout card | Structure | `eyebrow`, `big` (56px display line), `title`, `body`, `btn`, `tone` (navy / gold / paper), `width`. The service-times tile made general; two at half width reproduce that layout. |

Self-filling blocks (`newsfeed`, `chips`, `letter`, `sermon`, `servicetimes`, `values`, `cards` from the ministry record) must keep reading `ctx.data` rather than storing copies — the repo's existing argument, and the reason a published page cannot go stale.

Every new type needs `align: true` and the standard `spaceAbove`/`spaceBelow` defaults, and `sanitizeBlock` must gate the new fields the same way it gates `url`.

## Interactions & behavior

- **Countdown** — targets the next dated event; when it passes, it advances to the next one on its own. Format `Nd HHh MMm SSs`, tabular numerals, 1s tick. Renders nothing (block hides the row) when `countdown` is off.
- **Photo hover zoom** — on feed cards, banner, sermon card, ministry photo tiles.
- **Card lift** — on visit/ministry cards only.
- **Pulsing dot** — banner "happening next" and the Home news list eyebrow.
- **Editor**: click block · select; toolbar move/duplicate/hide/delete; contenteditable on eyebrow / title / subtitle / body with commit on blur; each committed edit appends to the change log (`"Edited banner heading · 2:14 PM"`); Undo pops a JSON snapshot of the whole page set; Publish clears the log and toasts `Published to timothystl.org<slug>`; viewport tabs set the canvas to 1080 / 820 / 420.
- **Prefers-reduced-motion**: gate the pulse, hover zoom and lift. Not implemented in the mocks — add it.

## Responsive behavior

Below ~640px: banner heights drop to 300/360/420, hero headline to 36px, section headings to 28px, all grids collapse to one column, half-width blocks go full, the chip strip shows 3 chips. Keep the existing 44px minimum tap target rule from `public/styles.css` — every pill in this language already clears it.

## State (editor)

`pageId`, `pages{ id · { title, slug, glyph, menu, wide, draft, blocks[] } }`, `selected` (block id or null), `tab` ('block' | 'page'), `viewport`, `paletteOpen`, `group`, `changes[]`, `history[]` (JSON snapshots), `toast`, `avail` (measured canvas width), `countdown`.

## Assets

- `public/logo.png`, `public/images/ministries/*.webp` — copied from the repo, unchanged.
- Fonts: Google Fonts, Bricolage Grotesque + Newsreader. Self-host or preconnect as the repo already does for Lora / Source Sans 3.
- **All photography is missing.** Slots and what they need: page banners (Home = a Sunday morning wide; Worship = the sanctuary mid-service; Ministries = hands at work; News = the coming event), the sermon card still, the music photo, and one per feed card. Design assumes ~8 usable photos to start.

## Files in this bundle

| File | What it is |
|---|---|
| `KICKOFF_PROMPT.md` | Paste-ready first message for Claude Code. |
| `CLAUDE_CODE_BRIEF.md` | Phased build plan written for an implementing agent. |
| `Handoff.dc.html` | The illustrated handoff — read this first. |
| `Site Prototype - 1b.dc.html` | The functional prototype — eight working pages. Behavioral reference. |
| `screens/` | Full-resolution screenshots of all four pages and the editor states. |
| `News Page - Current.dc.html` | The live `/news` today, recreated from `public/index.html` + `public/styles.css`. The "before". |
| `News Page - Directions.dc.html` | Three directions side by side — 1a Broadsheet, 1b (chosen), 1c Bulletin board. Kept for the record of what was rejected and why. |
| `Site in the 1b language.dc.html` | Home / Worship / Ministries in the new language, with a switcher at the top. |
| `Site Editor - 1b.dc.html` | The block editor rebuilt around the language: four pages, the new palette, per-block inspector, half-width pairing. |
| `support.js`, `image-slot.js` | Runtime for the prototypes. Not part of the implementation. |
| `public/` | The logo and ministry logos the mocks load. |

Open any `.dc.html` directly in a browser. `image-slot` drops are local to the prototype only.

## Suggested implementation order

1. Tokens + font loading in `public/styles.css`.
2. `photobanner`, `cta`, `signup`, `highlight` in `admin/blocks.js` — defs, `renderInner()` branches, `BLOCK_CSS`. All four are self-contained with no data dependency.
3. `quote`, `chips`, `letter`, `values` — all four need Phase 0 findings first.
4. `cards` (extends `cardgrid` with `logos` + `feature`), then extend `newsfeed`, `calendar`, `servicetimes`, `textphoto`.
5. Inspector controls for the new fields; half-width pairing; the canvas rules.
6. Reseed `/news` in `admin/site-pages.js`, publish, then delete the hardcoded `#page-news` markup from `public/index.html` — the repo's rule is that deletion lags publication by a few weeks.
7. Then **Worship, Ministries, Our Values, Home** — in that order of risk. Home last: most bespoke markup, most visitors, least room for a bad week. This matches `CLAUDE_CODE_BRIEF.md`; if the two ever disagree, the brief wins.
