# Build brief — /news redesign and the 1b site language

You are implementing a design handoff into an existing repo. Read this file first, then
`README.md` for the full specification. `Handoff.dc.html` is the same specification with
screenshots — open it in a browser if you need to see what something looks like.

## Ground rules

1. **The prototypes are design references, not source.** `Site Prototype - 1b.dc.html`,
   `Site Editor - 1b.dc.html` and the rest are React-ish single-file mocks. Do not port their
   structure, their component boundaries, or their inline-style approach into the repo. Read
   them to learn behavior and lift exact values (hex codes, sizes, gradients, easing). Build
   using the repo's own patterns.
2. **One renderer.** The public site and the editor canvas must both render through
   `renderInner()` in `admin/blocks.js`. If you find yourself writing a second template for the
   editor, stop — that is the bug this design is specifically trying to avoid.
3. **Do not delete anything on the first pass.** The hardcoded `#page-news` markup in
   `public/index.html` comes out *weeks after* the block-built page is published, not the same
   day. Same for the existing `--steel` / `--amber` / `--warm` tokens: pages that haven't been
   converted still use them.
4. **Ask rather than guess.** Where this brief says *verify*, it means the design was authored
   without confirming the repo side. Check before you build, and tell Andrew what you found.

## Phase 0 — verify before writing any code

These are the six things most likely to break the plan. Do these first, report findings, then
build. Do not silently work around a missing data source by hardcoding content — that defeats
the whole point of the self-filling blocks.

1. **Data sources.** Six block types are specified as self-filling from `ctx.data` and must
   never store their own copies: `newsfeed`, `chips`, `letter`, `sermon`, `servicetimes`, and
   ministry `cards`. For each, confirm the record exists and carries the fields the block needs:
   - `newsfeed` / `chips` — a dated event or announcement list, with date, category, title, body,
     and an image reference. `chips` needs future-dated items sorted ascending.
   - `letter` — an archive of weekly letters with subject and date, plus a "current" one.
     **Most likely to be missing.** If there is no archive, say so; the block degrades to the
     signup half without the list.
   - `sermon` — title, series, date, reference, blurb, duration, media URL, still image.
     **Second most likely to be missing or partial.**
   - `servicetimes` — the church-details record. The Home info card reads the same one.
   - `values` — the four core values in fixed order, each with word, discipline label,
     tagline, six items (title + one line), a partner organisation, and two hex accents.
     **Almost certainly missing.** It exists today only as printed artwork. Worth adding as a
     real record: the same content feeds the printed cards, the visitor packet and the school
     materials. Do not hardcode it into the block.
   - ministry `cards` — nine ministries with title, category, body, link, and a logo path.
     Logos should already be at `public/images/ministries/*.webp`; confirm.
2. **`renderInner()` signature.** Confirm what `ctx` actually carries and whether it differs
   between the public render path and the editor canvas path. The whole design assumes it does not.
3. **`sanitizeBlock`.** Read it. Every new field added below must be gated the same way `url`
   already is. List the new fields it needs to know about before you add them.
4. **The editor's selection and canvas code.** The spec describes chrome markers, hidden-block
   placeholders, half-width pairing and `zoom`-based fitting. Confirm where block chrome is
   currently drawn and whether the canvas already has a scale mechanism. If it uses
   `max-width: 100%`, that is the bug — replace it with `zoom: min(1, available / 1080)` driven
   by a ResizeObserver, or the editor lies about how the page looks.
5. **Spacing + width guardrails.** Confirm `SPACE_STEP`, `SPACE_MAX`, `snapSpace` and the
   `.tlcb-pair` grid rule exist as the spec assumes. Half-width pairing should reuse `.tlcb-pair`,
   not introduce a second mechanism.
6. **Fonts.** Bricolage Grotesque and Newsreader are Google Fonts and new to the repo. Confirm
   how fonts are currently loaded and whether self-hosting is expected. The admin chrome keeps
   Source Sans 3 + Lora — only the page canvas uses the new pair.

## Phase 1 — tokens

Add the palette, type scale, geometry and motion values to `public/styles.css` as new custom
properties. All of them are in `README.md` under Tokens, and rendered as swatches in
`Handoff.dc.html` §07. Leave existing tokens in place.

Gradients are a required part of this design, not decoration — flat fills are most of why the
current pages read as dead. Six of them, verbatim, in `Handoff.dc.html` §04. Rules:

- The four core-value hues (green/blue/teal/gold) are the one departure from navy and gold.
  They are allowed on the value card field, its unselected top rule, and the value page's
  accent card. Nowhere else — not nav, not buttons, not links, not headings.
- A gradient marks a **field** — a band, a hero, a large card, a pill. Never body text,
  never small cards, never hairlines, never the page background.
- Hero = veil layer + glow layer over the photo, in that order.
- **Contrast budget.** A gradient field is measured at the end that hurts — the light stop for
  white ink, the dark stop for dark ink — not at the average or the mid stop. On a white-ink
  field the light stop must clear 4.5:1 against `#fff`. On the gold field all text is
  `#3B2E12` — body, headings and eyebrows alike.
- White ink on a coloured field is near-opaque: `rgba(255,255,255,.94)` body,
  `.88` labels. Transparency is contrast you are spending for nothing.
- A translucent panel inside a coloured field uses a **dark** wash `rgba(16,27,46,.18)`.
  A white wash lightens the surface the white text is sitting on. White fails.

## Phase 2 — blocks

Eleven types, in `admin/blocks.js`. Each needs: a def, a `renderInner()` branch, `BLOCK_CSS`,
inspector fields, `align: true`, and standard `spaceAbove`/`spaceBelow` defaults. The full
field list per type is in `README.md` and `Handoff.dc.html` §06.

Build order (lowest risk first):

1. `photobanner`, `cta`, `signup`, `highlight` — new, self-contained, no data dependency.
2. `quote`, `chips`, `letter`, `values` — new; all four need Phase 0 findings.
3. `cards` — extends the existing `cardgrid` with `logos` and `feature`.
4. `newsfeed`, `calendar`, `servicetimes`, `textphoto` — extend existing types.

`highlight` ("Standout card") is the service-times tile made general: eyebrow, a 56px display
line, heading, body, pill button, and navy/gold/paper tones. Two at half width pair into the
service-times layout, which means `servicetimes` and `highlight` should share their card CSS.

## Phase 3 — editor

Inspector controls for the new fields, then half-width pairing, then the canvas rules
(`Handoff.dc.html` §05). Three flows are written out end to end there — photo replacement,
half-width pairing, and edit-then-undo. Those are the acceptance tests.

Undo pops a JSON snapshot of the **whole page set**, not one page. That is deliberate: an undo
after a page switch should still do the expected thing.

## Phase 4 — pages

Reseed in `admin/site-pages.js`, in this order, publishing each before starting the next:

**News → Worship → Ministries → Our Values → Home.**

News first because it is the page the language was designed on and the one Andrew wants most.
Home last: most bespoke existing markup, most visitors, least room for a bad week.

Each page's exact block stack and per-block settings are in `Handoff.dc.html` §03 beside the
screenshot of that page.

## Definition of done

- [ ] Editor canvas and live page render from the same `renderInner()`.
- [ ] Canvas scales with `zoom`; 64px type never reflows at any window width.
- [ ] Countdown rolls to the next event on its own and hides cleanly when switched off.
- [ ] Two consecutive half blocks pair; a third starts a new row; all collapse below 640px.
- [ ] Hidden blocks render as dashed placeholders; header and footer render as chrome chips.
- [ ] Every self-filling block reads `ctx.data` at render — no stored copies anywhere.
- [ ] `prefers-reduced-motion` disables pulse, hover zoom and card lift.
- [ ] Every pill clears 44px tap height on a phone.
- [ ] Every photo slot has real alt text; the editor prompts for it on drop.
- [ ] Countdown has `aria-live="off"` and a static text alternative.

## Known gaps — flag these, don't paper over them

- **Photography.** Roughly eight real photographs are needed before launch: a wide Sunday
  morning, the sanctuary mid-service, hands at work, the next event, a sermon still, a music
  photo, and one per news card. Shipping with placeholders will look worse than what is live now.
- **The letter archive and sermon records** may not exist in usable form (Phase 0, items 1).
- **The editor canvas integration** is specified from a prototype, not from the shipped admin's
  selection code. Expect one or two surprises.
