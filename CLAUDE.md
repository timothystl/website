# Timothy Lutheran Church Website — Project Context

This file captures the full project context so any Claude session can be resumed immediately.

---

## Project Overview

We are rebuilding the Timothy Lutheran Church website (timothystl.org) to replace the current Tithely/Breeze-hosted site (~$50/month). The new site runs on Cloudflare Workers, is fully custom, and will be tested at `test.timothystl.org` before DNS cutover.

**Repo:** `timothystl/website`
**Primary branch for development:** `claude/*` branches (auto-deploys to test.timothystl.org)
**Production branch:** `master` (deploys to timothystl.org and all subdomain workers)

---

## Architecture

### Live Workers (Production)
| Worker | Domain | File |
|--------|--------|------|
| timothystl-site | timothystl.org | `public/index.html` (SPA) |
| tlc-newsletter-admin | admin.timothystl.org | `tlc-admin-worker.js` |
| tlc-links | links.timothystl.org | `tlc-links-worker.js` |
| breeze-proxy-worker | volunteer.timothystl.org | `tlc-volunteer-worker.js` |

### Test Worker
| Worker | Domain | Config |
|--------|--------|--------|
| timothystl-test-site | test.timothystl.org | `wrangler-test-site.toml` |

Deploys automatically from any `claude/**` branch push. Use this for all development — never touch production directly.

### Databases (Cloudflare D1)
- `tlc-newsletter-db` — tables: `newsletters`, `events`, (planned: `news_items`, `youth_pages`)
- `tlc-volunteer-db` — tables: `serve_events`, `serve_roles`, `signups`, `signup_slots`
- `RSVP_STORE` — Cloudflare KV namespace

### Auth
- Admin password: `6704fyler` (used by admin.timothystl.org and volunteer.timothystl.org/admin)

---

## Tech Stack

- **Frontend:** Vanilla JS + HTML/CSS, single-page SPA (`timothystl-site.html`)
- **Backend:** Cloudflare Workers + D1 (SQLite) + KV
- **CI/CD:** GitHub Actions (`.github/workflows/deploy.yml`)
- **Newsletter:** Beehiiv API (wired into `tlc-admin-worker.js`)
- **Calendar:** Google Calendar RSS embed at `/calendar`
- **Giving:** Redirect to `https://timothystl.breezechms.com/give/online` (temp — will change when Breeze is cancelled)
- **Volunteer signups:** Separate worker at volunteer.timothystl.org (already complete)

---

## Current Site Pages (SPA page IDs in `timothystl-site.html`)

| Page ID | URL/Nav | Status |
|---------|---------|--------|
| page-home | / | Exists |
| page-about | /about | Exists, content updated |
| page-worship | /worship | Exists |
| page-sermons | /sermons | Exists |
| page-ministries | /ministries | Exists |
| page-wol | /wol | Exists (partner landing page → wordoflifeschool.net) |
| page-events | /events | Exists |
| page-contact | /contact | Exists |
| page-prayer | /prayer | Exists |
| page-news | /news | Exists (stub — needs Beehiiv/events feed wired up) |

---

## Full Planned URL Structure

### Static Pages (developer changes only)
```
/               Home — service times above fold, "New Here?", quick links
/about          Staff with photos, values, vision, mission, beliefs
/worship        Services, livestream, what to expect
/sermons        YouTube embeds
/ministries     All ministry cards hub
/contact        Address → Maps, phone → call, email, map
/prayer         Prayer request form
/give           → redirect to Breeze giving (update when Breeze cancelled)
/news           News & events feed (brief cards, auto-expire)
/calendar       Google Calendar embed
```

### Ministry Landing Pages (flyer-friendly short URLs, static)
```
/christmasmarket  Admin-managed: dates, photos, Google Form link for vendors
/foodpantry       Food Pantry info, hours, how to donate/volunteer
/music            Music Ministry
/stephen          Stephen Ministry
/bees             Urban Beekeepers
/wol              Brief landing page → wordoflifeschool.net
/mdo              → redirect to mdo.timothystl.org
```

### Youth Director Manages (dynamic, via admin portal)
```
/youth            Youth & Family main
/sundayschool     Sunday School communications to parents
/confirmation     Confirmation program
/vbs              VBS
/egghunt          Egg Hunt
/family           Family Ministry
```

### Utility Redirects (in Cloudflare Worker routing table)
```
/volunteer      → volunteer.timothystl.org
/councilfiles   → Google Drive folder
/zoom           → Zoom meeting URL
/voters         → Special page: Zoom link + downloadable reports (admin-managed)
/give           → Breeze giving URL
/mdo            → mdo.timothystl.org
```

---

## Admin Portal Plan (`admin.timothystl.org`)

Extend current `tlc-admin-worker.js` with new tabs:

| Tab | Who Uses It | Status |
|-----|-------------|--------|
| News & Events | Pastor/office | **TO BUILD** |
| Youth Pages | Youth director | **TO BUILD** |
| Special Pages | Office staff (Christmas Market, /voters) | **TO BUILD** |
| Redirects | Office staff | **TO BUILD** |
| Newsletter | Pastor/office | Exists (Beehiiv integration) |
| Volunteer Admin | Link to volunteer.timothystl.org/admin | **TO BUILD** |

### News & Events Data Model
```sql
CREATE TABLE news_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,           -- short text shown on card
  body TEXT,              -- full content shown on "Read More"
  image_url TEXT,
  publish_date TEXT,
  expire_date TEXT,       -- auto-hide after this date (default: 90 days out)
  pinned INTEGER DEFAULT 0
);
```

### Youth Pages Data Model
```sql
CREATE TABLE youth_pages (
  slug TEXT PRIMARY KEY,  -- 'youth', 'sundayschool', 'vbs', etc.
  title TEXT NOT NULL,
  content TEXT,           -- HTML from WYSIWYG editor
  updated_at TEXT
);
```

### Access Control
- Staff admin password: full access (News, Special Pages, Redirects, Newsletter)
- Youth director password: Youth Pages tab only (separate password so it can be changed independently)

---

## Design System

### Colors (CSS Variables) — matches volunteer page color system
- Primary: Navy `#1E2D4A` (--steel)
- Accent: Gold `#C9973A` (--amber)
- Teal `#2E7EA6` (--mid/--teal) — links, Beekeepers, Christmas Market
- Moss `#4A5E3A` (--sage) — nav header, Stephen Ministry (Acceptance)
- Slate `#3A4E5C` (--slate) — Food Pantry (Outreach)
- Plum `#8A6A8A` (--plum-light) — LWML (General Interest)
- Backgrounds: Cream `#F7F3EC`, Warm White `#FBF8F3`, Linen `#EDE9E0`
- Text: `#1A1A2A` primary, `#4A4860` secondary

### Typography
- Headings/quotes: Lora (serif)
- Body/UI: Source Sans 3 (sans-serif)

### Social Media Handles
- Facebook: `facebook.com/timothystl`
- Instagram: `instagram.com/timothystl`
- YouTube: `youtube.com/timothystl`

---

## Church Content

### Identity
- **Full name:** Timothy Lutheran Church
- **Location:** Lindenwood Park, South City St. Louis
- **Denomination:** LCMS (mention once, quietly — not a focal point)

### Vision
> Planted Here. Sent Everywhere.
> Planted in culturally diverse St. Louis. Sent to the world as a congregation alive to the Gospel that breaks every wall — as we welcome every person, bear bold witness to the saving grace of God through Jesus, from our neighborhood to the nations.

### Mission
> Gathered Around Grace. Sent in Love.
> Timothy Lutheran Church is a congregation alive to the Gospel of Jesus Christ. Gathered in worship around the Word and Sacraments of the risen Lord, we accept every person as one for whom Christ died. Growing in faith through Christian education and honest community, we go — from our neighborhood to the nations — bearing the tangible love of God to all.

### Core Values
1. **Worship** — Gathering as God's people, celebrating His grace, receiving His gifts of Word and Sacrament.
2. **Acceptance** — Intentionally welcoming and loving all people as Jesus does.
3. **Christian Education** — Equipping people for a lifelong journey with Christ.
4. **Outreach** — Sharing the love of Jesus with those who don't yet know Him.

### Mission Field
- **Lindenwood Park** — the neighborhood where God has planted us, our front door to the city of St. Louis.
- **Word of Life School** — families formed together through Lutheran education, community, and care.
- **Timothy's Mother's Day Out** — young families in their most open and searching season of life.

### Staff Emails
| Name | Email |
|------|-------|
| Dinger | dinger@timothystl.org |
| Pastor Matt | pastormatt@timothystl.org |
| DCE | dce@timothystl.org |
| Jinah | jinah@timothystl.org |
| Pastor Rall | pastorrall@timothystl.org |
| Pastor Vo | (no email — contact via office) |
| Office | office@timothystl.org |
| Noah | noah@timothystl.org |

### Partner / Related Sites
- MDO: `mdo.timothystl.org`
- Word of Life School: `wordoflifeschool.net`
- Ascension (partner): `ascensionstl.com`

---

## SEO Strategy

### Target Keywords
- Lutheran church St. Louis MO
- LCMS church St. Louis
- Lutheran church Lindenwood Park
- church near me St. Louis
- Mother's Day Out St. Louis
- Lutheran preschool St. Louis
- Sunday school St. Louis / VBS St. Louis
- food pantry St. Louis
- Christmas market St. Louis

### Schema.org Markup (Church type)
Include on homepage with address, phone, hours, and `sameAs` links to all social profiles.

### Open Graph / Twitter Cards
Set per-page. Homepage is highest priority. Can be added incrementally — not required all at once.

---

## Build Phases

| Phase | What | Status |
|-------|------|--------|
| 1 | test.timothystl.org setup | **DONE** — deploys from `claude/**` branches |
| 2 | Admin portal: News & Events tab | **DONE** — tab exists, DB wired, API live at /api/news |
| 3 | Admin portal: Youth Pages tab (WYSIWYG, for youth director) | TO DO |
| 4 | Wire /news and /youth/* on main site | **DONE for /news** — fetches /api/news, renders cards, section auto-shows when items exist. /youth/* loads dynamically but youth director admin UI (Phase 3) still needed |
| 5 | Ministry landing pages with photos | **DONE** (session 2026-03-21) — /music /stephen /foodpantry /bees /christmasmarket all built with hero image placeholder support and CTA button bars. Photos still needed from owner. |
| 6 | Static page audit: migrate from Tithely/Breeze | TO DO |
| 7 | SEO: Schema.org, OG tags, meta descriptions | TO DO |
| 8 | Design reference page | **REPLACED** by /manual staff reference guide (covers colors, header photos, button editing, annual tasks) |
| 9 | DNS cutover. Cancel Tithely/Breeze. | LAST STEP |

---

## Pending / Deferred Items

- **Logo files** — Owner has logo images (blue/gold version is primary brand mark). Need to be dropped into `/public/images/` before they can be used in the nav and header. Ask owner for the files.
- **Ministry photos** — Owner has photos but needs to organize them. Will be placed in `/public/images/ministries/`. Build layouts with placeholders first.
- **Google Calendar URL** — Need the public Google Calendar RSS URL to wire up the `/calendar` page.
- **Zoom / councilfiles / voters URLs** — Need exact URLs to add to the redirects table.
- **Give platform** — Currently points to Breeze. When Breeze is cancelled, update `/give` redirect. Plan for a replacement giving platform.
- **Design reference page** — A visual HTML guide mapping design element names (header, hero, nav, cards, footer, etc.) so the owner can reference them in conversation. Was being built at end of last session — not yet committed.
- **WOL page** — Was accidentally removed, then restored. Confirm it looks correct on test site.
- **Youth director** — Resistant to change, needs the simplest possible interface. Build the Youth Pages admin UI with extreme simplicity: password → list of pages → click to edit → one big "Save & Publish" button. No drafts, no accounts, no complexity. Image upload should work like Google Docs (click insert, pick file, done).
- **Christmas Market** — Vendor registration is a Google Form link. Admin-managed page (Option B). Needs annual update of dates, description, photos, and form link.
- **`/voters` page** — Admin-managed special page with downloadable reports and Zoom link. Not a plain redirect.

---

## CRITICAL: The Deployed File is `public/index.html`

**DO NOT edit `timothystl-site.html`** — it is a stale duplicate and is NOT deployed anywhere.

Both `wrangler-site.toml` (production) and `wrangler-test-site.toml` (test) deploy from `./public/`.
The actual SPA is **`public/index.html`**. All HTML edits go there.

`timothystl-site.html` in the repo root is outdated and should be ignored (or deleted eventually).

---

## Session State (as of 2026-03-21)

### What's in `public/index.html` (current deployed content):
- Nav: About → Worship → MDO (external) → Word of Life → Ministries → News & Events → Contact → Give
- **Color system:** Matches volunteer page — Navy #1E2D4A, Gold #C9973A, Moss #4A5E3A, Teal #2E7EA6, Slate #3A4E5C, Plum #8A6A8A. Background texture added.
- **Nav header:** Moss green (--sage), logo in white circle
- WOL page (`/wol`) — links out to wordoflifeschool.net
- About page: correct vision/mission text, Mission Field section, correct staff emails
- Events page: volunteer events loaded from volunteer.timothystl.org API
- **News page (`/news`):** Fetches live from admin.timothystl.org/api/news + newsletter archive
- **Ministry landing pages:** /music /stephen /foodpantry /bees /christmasmarket — all built with hero image placeholders and CTA button bars. Full-card clickable.
- URL routing (pushState — direct URLs like /about work)
- Footer: no LCMS in copyright line
- **Staff manual:** `/manual` — documents header photos, button editing, Christmas Market annual update, color reference

### What's next (Phase 3):
- Admin portal: Youth Pages tab (WYSIWYG editor for youth director)
- Then: Phase 6 static page audit, Phase 7 SEO

---

## Decisions Made (Do Not Re-litigate)

- Single-file SPA approach is intentional — don't suggest frameworks or bundlers
- Cloudflare Workers (not Netlify, Vercel, etc.) — already deployed and working
- No WordPress — too complex for this owner and the youth director
- Custom admin portal over Netlify CMS / Decap CMS — matches existing pattern in the repo
- D1 for dynamic content — already in use, keep consistent
- Cloudflare R2 for image uploads — planned for youth pages and news items
- `/newsevents` removed (use `/news`)
- LCMS mentioned once, quietly, on About page — not emphasized elsewhere
- WOL gets its own landing page (not a direct external redirect) — good for SEO and branding
- Christmas Market = Option B (admin-managed, not static)
- News and newsletter are separate systems (site news ≠ Beehiiv emails) — kept decoupled intentionally
