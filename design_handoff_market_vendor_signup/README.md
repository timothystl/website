# Handoff: Christmas Market Vendor Sign-up

## Overview

A vendor application page for the **Timothy Christmas Market** (Timothy Lutheran Church, 6704 Fyler Ave, St. Louis, MO 63139 — LCMS). It replaces the Google Form + spreadsheet workflow used in 2024 (`Weihnachtsmarkt Registration`) with a page on timothystl.org.

Market day for this edition: **Saturday, December 5, 11:00 am – 6:00 pm.** Tables are **$30 each** (8-foot table), maximum 3 per vendor. Vendors pay by card at the end of the application and **cover the card processing fee**, so the church nets the full table fee.

Where it fits in the existing site: the live `/christmasmarket` page currently has an "Apply to be a vendor" block whose copy reads *"Vendor registration is handled via Google Form — link posted here when open"* with two `mailto:` buttons. This design is the page that block should link to (suggested slug `/christmasmarket/vendors`), with the mailto button replaced by an "Apply for a table" link. The bottom "Not a vendor?" bar on this page links back to `/christmasmarket`.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. They are Design Component files (`.dc.html`, streaming prototypes that need the bundled `support.js` to run in a browser); their markup and inline styles are the source of truth for layout and values, not their runtime.

The task is to **recreate these designs inside the timothystl.org codebase** using its established patterns:

- Public pages are rendered from `public/index.html` plus block records seeded in `admin/site-pages.js`; global styles and design tokens live in **`public/styles.css`** (CSS custom properties on `:root`).
- **Every color, font, radius, and shadow in these mocks is taken from `public/styles.css`.** Implement with the existing `var(--*)` tokens and existing classes (`.wrap`, `.section`, `.eyebrow`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-outline`, `.form-group`, `.form-label`, `.form-input`, `.min-card`, `.value-card`, `.page-hero`, `.img-placeholder`, `.page-cta-bar`) rather than the literal hex values written inline in the mocks. The mocks inline them only because a prototype has no stylesheet.
- The nav and footer in the mocks are a **recreation of the live site chrome for context** — do not reimplement them; the real page inherits them.

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, and interaction states are final and match `public/styles.css`. Recreate pixel-accurately using the site's tokens and classes. Copy is written and can ship as-is (Andrew should review the vendor agreement text — it was drafted, not supplied).

## Files

Both files are complete pages; they differ only in the shape of the application.

| File | What it is |
| --- | --- |
| `Christmas Market Vendor Signup.dc.html` | **Primary.** Full vendor page: hero + market-day card, vendor-details cards, rules, past-market photo slots, three-step application card, FAQ, shopper bar. |
| `Christmas Market Vendor Signup v2.dc.html` | Alternate: the same three-step application card as a standalone compact page (green banner + facts band + card, no long marketing sections). Useful if the application should live on its own minimal page. |
| `support.js` | Runtime needed to open the `.dc.html` files in a browser. Not part of the implementation. |
| `public/logo.png` | The site logo, as used in the recreated nav. Already in the repo at `public/logo.png`. |

## Screens / Views

### 1. Vendor page (primary file, top to bottom)

**Purpose:** convince a maker to apply, answer the questions that generate coordinator email, and take the application + payment in one pass.

Page container: site chrome (sticky nav, footer). All content rows are `max-width:1080px; margin:0 auto; padding:0 28px` — i.e. the existing `.wrap`.

**1a. Hero** — `background: var(--steel) #1E2D4A`, padding `64px 28px 72px`, `position:relative; overflow:hidden`. Decorative radial glow, top-right, non-interactive: `position:absolute; top:-100px; right:-100px; width:500px; height:500px; background:radial-gradient(circle, rgba(201,151,58,.10) 0%, transparent 65%)` (same device as `.hero::before`).

Grid: `grid-template-columns: minmax(0,1fr) 300px; gap:40px; align-items:center`. Collapses to one column at **620px only** (deliberately later than `.hero-inner`'s 900px, so the market-day card stays beside the copy on tablets).

- Eyebrow: "VENDOR APPLICATIONS · TIMOTHY CHRISTMAS MARKET" — `.eyebrow` (11px, 700, `.12em` tracking, uppercase, `var(--amber)`).
- H1: "Bring your table to the *Christmas Market*" — `clamp(30px,4.5vw,52px)`, 700, line-height 1.15, white; the italic phrase is `<em>` in `var(--honey) #E8C070` (matches `h1 em`).
- Sub: 17px, weight 300, `rgba(255,255,255,.88)`, line-height 1.8, `max-width:520px`.
- Buttons (`.btn-row`): **"Apply for a table"** = `.btn` filled `var(--amber)` with `var(--steel)` ink, anchors to `#apply`; **"Vendor details"** = `.btn-ghost` (transparent, `1.5px solid rgba(255,255,255,.35)`, white), anchors to `#details`.
- Market-day card (right column) = `.hero-card`: white, `border-radius: var(--r-lg) 20px`, padding 28px, `box-shadow: 0 8px 40px rgba(0,0,0,.35)`. Contents: label "MARKET DAY" (10px/700/`.1em`/uppercase/amber) · "Saturday, Dec 5" (serif 26px, `var(--steel)`) · "11:00 am – 6:00 pm" (UI 12px) · `1px solid var(--border)` rule · address block (12px, `var(--gray)`, line-height 1.9) · link "Tables are $30 each →" (`var(--mid)`, 700).

**1b. Vendor details** — `id="details"`, `background: var(--linen) #EDE9E0`, padding `72px 0`. Eyebrow "BEFORE YOU APPLY", H2 "Vendor details". Four `.min-card`s in `repeat(auto-fit,minmax(220px,1fr))`, gap 20 — white `var(--white)`, `1px solid var(--border)`, `border-radius: var(--r-md)`, padding 24, `box-shadow: var(--shadow)`, each with a 3px top border in a different accent: amber, teal `#2E7EA6`, moss `#4A5E3A`, slate `#3A4E5C`.

Card copy: **$30 per table** (8-ft table and two chairs; three tables max) · **Setup & teardown** (doors 8:30 am, set up by 10:30, stay until 6:00) · **Handmade & local first** (duplicate categories limited) · **Pay when you apply** (card payment prefilled; vendors cover the fee — $31.20 for one table).

**1c. Rules at a glance** — `background: var(--white) #FBF8F3`, padding `72px 0`, two columns `1fr 1fr` gap 64 (collapses at 900px). Left: eyebrow "THE SHORT VERSION" in `var(--sage)`, H2, one paragraph. Right: four `.value-card`s (white, `1px solid var(--border)`, `border-radius: var(--r-md)`, padding 20, **left** border 3px) accented amber / moss / teal / slate: *You bring the booth* · *Food vendors* (City of St. Louis health dept. is the vendor's responsibility) · *Electricity is limited* (declare appliances/wattage/amperage; bring your own cord) · *Table fee is non-refundable*.

**1d. Past markets** — `background: var(--mist) #EDF2F7`, padding `72px 0`. Eyebrow "PAST MARKETS", H2 "What the day looks like", one paragraph. Three `.img-placeholder`s in `repeat(auto-fill,minmax(260px,1fr))`, `aspect-ratio:4/3`, `2px dashed var(--ice)`, `border-radius: var(--r-md)`. **These are placeholders — replace with real market photos** (repo convention: `public/images/ministries/…`, `.webp`; an existing one is `christmas-mkt.webp`).

**1e. Application card** — see "2. The three-step application" below. `id="apply"`, `background: var(--white)`, padding `64px 28px 72px`, intro block (eyebrow "THE APPLICATION", H2 "Vendor application", one paragraph) at `max-width:760px`.

**1f. FAQ** — `background: var(--linen)`, padding `72px 0`, eyebrow "GOOD TO KNOW", H2 "Questions vendors ask", six Q&As in `1fr 1fr` (gap `32px 48px`, collapses at 900px). H3 17px/700 `var(--steel)`; body 14px `var(--gray)` line-height 1.75. Questions: next to a friend · no photos yet · commission (none) · church groups (fee waived) · indoors · sharing a table.

**1g. Shopper bar** — the `.mdo-strip` pattern: `background: var(--warm) #F7F3EC`, `border-top: 3px solid var(--amber)`, padding `36px 28px`, flex row with wrap. Eyebrow "NOT A VENDOR?", serif 20px line, 13px description, and a `.btn-outline` "Market details" → `/christmasmarket`.

### 2. The three-step application

One card, `max-width:760px`, `background: var(--white)`, `1px solid var(--border)`, `border-radius: var(--r-lg) 20px`, `box-shadow: var(--shadow-lift) 0 6px 32px rgba(30,45,74,.14)`, `overflow:hidden`.

**Step tabs** — a flex row across the top, `background: var(--mist)`, `border-bottom: 1px solid var(--border)`. Each tab is a button, `flex:1`, padding `18px 16px`, left-aligned, two lines: "STEP n" (10px/700/`.1em`/uppercase/`var(--text-muted)`) over the label (UI 14px/800). Active tab: `background: var(--white)`, `border-bottom: 3px solid var(--amber)`, label ink `var(--steel)`. Inactive: `background: var(--mist)`, transparent bottom bar, label ink `var(--text-muted)`. **Tabs are clickable** — a vendor can jump back to any step.

Labels: **1 You & your booth** · **2 What you sell** · **3 Tables & payment**.

Body padding `34px`. Only the active step renders (`display:grid` vs `none`), `gap:22px`.

**Step 1 — You & your booth**
- Participant name(s) * — text, placeholder "Everyone who will be at the table"
- Business name / Website or Instagram — two columns
- Email * / Telephone * — two columns
- Mailing address — street on its own row, then City / State / ZIP at `2fr 1fr 1fr`
- "Sold with us before?" — two pill buttons, **Returning vendor** / **First year**; selected pill = `var(--steel)` fill, white ink, `1px solid var(--steel)`; unselected = `var(--white)` fill, `1px solid var(--border)`, charcoal ink
- Footer: right-aligned primary "Next: what you sell →"

**Step 2 — What you sell**
- Description of product * — textarea, min-height 112, placeholder "e.g. handmade purses, tote bags, wallets, crochet shawls"
- Food acknowledgment — checkbox in a `var(--mist)` / `1px solid var(--ice)` / `var(--r-md)` box, 18px padding, `accent-color: var(--sage)`: "**I'll be selling food or drink.** You're responsible for City of St. Louis health department requirements for what you sell — Marla will follow up with what that means for your table."
- Appliances, wattage, amperage — text, placeholder "None — or: popcorn popper, 1200W / 15A"
- Sample photos (optional, up to 5) — dashed drop zone, `var(--mist)` bg, `2px dashed var(--ice)`. **Optional but encouraged** — never block submission on it.
- Special requests — textarea, min-height 84 (booth placement / neighbors)
- Footer: `.btn-outline` "← Back" left, primary "Next: tables & payment →" right

**Step 3 — Tables & payment**
- "How many tables?" * — three big buttons in `repeat(3,1fr)`, gap 12, padding `18px 12px`, `border-radius: var(--r-md)`, UI 15px/800. Same selected treatment as the pills (navy fill / white ink).
- **Total panel** — `background: var(--steel)`, `border-radius:16px`, padding 24. Label "YOUR TOTAL" in `var(--honey)`. Three rows at 15px `rgba(255,255,255,.85)`, each `display:flex; justify-content:space-between`: `{n} table(s) × $30` → subtotal; `Card processing fee (2.9% + 30¢)` → fee; then a `1px solid rgba(255,255,255,.18)` rule and **Due today** → total in UI 20px/800 white. Note beneath, 13px `rgba(255,255,255,.7)`: vendors cover the fee so the full $30 per table goes to the market; payment opens with the amount filled in.
- **Vendor agreement** — scroll box, `background: var(--linen)`, `1px solid var(--border)`, `var(--r-md)`, padding 20, `max-height:200px; overflow:auto`, 14px `var(--gray)`, line-height 1.75. Eight clauses (fee non-refundable and due at application; vendor supplies covering/signage/display/bags/change and stays within their space; set up by 10:30, staffed until 6:00; food vendors meet City of St. Louis health requirements; vendor handles sales tax and their own cash/merchandise security; church not liable for loss, theft, damage or injury and space left clean; church may photograph the market for promotion). **Andrew should review this text before launch.**
- Type your name to agree * — text, `max-width:400px`
- Footer: `.btn-outline` "← Back" and the primary action **"Submit and pay $31.20 →"** — `.btn-secondary` (amber fill, `var(--steel)` ink) in the primary file's merged card, navy in v2; pick one and keep it consistent.
- Fallback line, 13px `var(--text-muted)`: pay by check or cash instead → email `tlc.christmasmarket@gmail.com`.

Two note cards sit below the card at `max-width:760px`, `1fr 1fr`: **Questions first?** (Marla, coordinator) and **Just want to shop?** (free and open, links `/christmasmarket`).

## Interactions & Behavior

- **Step navigation.** Next / Back buttons and the three tabs all set the active step. No forced validation gate between steps in the mock — the real implementation should validate required fields on submit at minimum, and ideally on leaving a step.
- **Table count → price, live.** Selecting 1/2/3 tables recomputes subtotal, fee, total, the submit button label, and the payment URL immediately.
- **The pricing rule (important).** The vendor pays a grossed-up amount so the church receives the full table fee:

  `total = round2( (tables × 30 + 0.30) / (1 − 0.029) )`

  → 1 table **$31.20**, 2 tables **$62.10**, 3 tables **$92.99**. `$31.20` is exactly what a one-table vendor paid in 2024, which is how the rate was confirmed. Percent (2.9) and fixed (0.30) must be configurable — if the church switches processors, only those two numbers change.
- **Payment hand-off.** The submit action links to the giving base URL with the amount appended in **cents**, following `give-link.js`'s `withAmountAndFund()`: `https://give.timothystl.org/?amount=3120`. Reuse that exported helper — do not re-implement the arithmetic (that file's header comment explains why: three copies of a money rule is three chances to be wrong). The base URL must be read from the `give_url` setting at request time, never hardcoded in a block record, and should carry the market's `fundId`.
- **Submission must persist before redirect.** The mock's submit is a link. In production: save the application, then redirect to payment — a vendor who abandons the payment page must still exist in the coordinator's list as unpaid.
- **Hover states.** Buttons lift (`transform: translateY(-1px)`) per `.btn:hover`; nav links get `rgba(255,255,255,.12)`; inputs on focus take `border-color: var(--amber)` + `box-shadow: 0 0 0 3px rgba(201,151,58,.12)` (`.form-input:focus`). Keyboard focus keeps the site's `3px solid var(--amber)` outline with `2px` offset.
- **Responsive** — mirrors `public/styles.css` breakpoints: at **900px** the hero-adjacent splits (rules, FAQ, apply row) go single column and the footer to `1fr 1fr`; at **620px** paired fields (business/website, email/phone, city/state/ZIP) stack, the footer goes single column, and the nav wraps. The hero is the one exception — its card stays beside the copy until 620px. All tap targets are `min-height:44px`.

## State Management

Three values only:

| State | Type | Default | Drives |
| --- | --- | --- | --- |
| `step` | 1 \| 2 \| 3 | 1 | which panel shows, tab styling |
| `tables` | 1–3 | 1 | subtotal, fee, total, button label, payment URL |
| `returning` | `'yes'` \| `'no'` \| null | null | pill selection |

Plus the form fields themselves. Configurable values (exposed as tweaks in the mock, and they should be settings — not hardcoded — in production): `tableFee` (30), `feePercent` (2.9), `feeFixed` (0.30), `payBaseUrl`.

Backend needs, none of which exist yet in `admin/forms.js` (it only handles contact / prayer / subscribe): a vendor-application table, up-to-5 photo uploads, a confirmation email to the vendor, a notification to `tlc.christmasmarket@gmail.com`, and a coordinator list view (paid / unpaid, table number assignment, placement requests) — the spreadsheet's real job. Existing intake plumbing worth reusing: `screenSubmission()` (spam scoring, Turnstile) and `sendTransactionalEmail()`.

## Data model (from the 2024 sheet, which the form replaces)

`participant_names` · `business_name` · `website_or_social` *(new)* · `returning_vendor` *(new)* · `tables` · `street` · `city` · `state` · `zip` · `phone` · `email` · `product_description` · `sells_food` *(new)* · `appliances_power` · `special_requests` · `payment_method` · `photos[]` (≤5) · `signature_name` · plus staff-side: `table_number`, `payment_status`, `amount_paid`, `created_at`.

The coordinator also needs the columns she kept by hand: a table number that can be a range ("19/20"), and a payment state that includes *fee waived* (Timothy MDO, Word of Life 8th grade, youth group) and *dropped out*.

## Design Tokens

All from `public/styles.css` — use the variables, not the hex.

**Color** — `--steel #1E2D4A` (headings, dark sections, primary button), `--steel-dk #2A3F60` (primary hover), `--steel-dk2 #111E32` (footer), `--mid`/`--teal #2E7EA6` (links, accent), `--sky #5BA3C4`, `--ice #C4CEDF` (borders on mist), `--mist #EDF2F7`, `--amber #C9973A` (eyebrows, rules, focus, secondary button), `--amber-dk #B0821E`, `--honey #E8C070` (italic emphasis on dark), `--sage #4A5E3A` (nav bar, accents, checkbox accent), `--slate #3A4E5C`, `--warm #F7F3EC` (body), `--linen #EDE9E0`, `--white #FBF8F3` (cards), `--border #DDE3ED`, `--charcoal #1A1A2A`, `--gray #4A4860`, `--text-muted #8A8898`.

**Type** — `--font-heading` / `--font-ui`: `'Bricolage Grotesque'` (headings, eyebrows, labels, buttons, UI numbers); `--font-body`: `'Newsreader'` serif (body copy, inputs, serif display numbers). These are re-pointed at runtime by `applyAppearance()` from the Appearance record — never hardcode the family names. Scale as used: H1 `clamp(30px,4.5vw,52px)`/700, H2 `clamp(24px,3.5vw,36px)`/700, H3 17–20px/700, body 14–17px, labels 11px/700/`.06em`/uppercase, eyebrows 11px/700/`.12em`/uppercase, micro-labels 10px/700/`.1em`.

**Radius** — `--r-sm 8px` (inputs), `--r-md 12px` (cards), `--r-lg 20px` (hero card, application card), `999px` (all buttons and pills).

**Shadow** — `--shadow 0 2px 12px rgba(30,45,74,.08)` (cards), `--shadow-lift 0 6px 32px rgba(30,45,74,.14)` (application card, hover), `0 8px 40px rgba(0,0,0,.35)` (hero card on navy).

**Spacing** — section padding `72–88px` vertical (48px under 620px), `.wrap` padding 28px (16px on phones), card padding 20–34px, form field gap 20–22px, grid gaps 12/20/32/48/64.

## Assets

- `public/logo.png` — existing repo asset, used in the recreated nav for context only.
- **Needed:** three market photos for section 1d, and optionally a hero photo (the `.page-hero--photo` treatment exists). Nothing else. No new icons — the design deliberately uses none.

## Source of the content

Field list and vendor copy derive from the 2024 `Weihnachtsmarkt Registration` Google Sheet (68 vendors, ~69 tables) and from Andrew's answers: Dec 5, 11–6; $30/table unchanged; photos optional but encouraged; online card payment (Square or Tithe.ly) with vendors covering fees; coordinator Marla, `tlc.christmasmarket@gmail.com`. The vendor agreement was drafted for this design and needs Andrew's sign-off.
