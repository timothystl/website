# Timothy Lutheran Church — Website Project Plan

**Last updated:** March 2026
**Goal:** Replace the Tithely/Breeze-hosted website with a fully custom site, tested safely, then launched at timothystl.org.

---

## The Big Picture

### Why We're Doing This
- The current site (hosted by Tithely/Breeze) costs ~$50/month and is difficult to customize
- Our new site is fully custom, hosted on Cloudflare (effectively free), and looks exactly how we want it
- Two staff members need to update content without any developer help:
  - **Office/pastor staff** → news posts, events, special pages
  - **Youth director** → his pages only, using the simplest possible editor

### How It Works (Plain Language)
The new site is made up of several specialized pieces ("workers") that each handle one job:

```
What visitors see:                    What staff manage:

timothystl.org ──────────────────────► admin.timothystl.org
  All main pages                         News & Events tab
  (home, about, worship,                 Youth Pages tab
  ministries, contact, etc.)             Special Pages tab
                                         Redirects tab
                                         Newsletter tab (Beehiiv)

volunteer.timothystl.org ────────────► volunteer.timothystl.org/admin
  Volunteer sign-up forms                Event & role management

links.timothystl.org                   (self-contained, no changes needed)
  Link aggregation page

test.timothystl.org ─────────────────  Safe preview environment
  Exact copy of the live site            Anything pushed to a dev branch
  for testing before going live          appears here first
```

### The Safe Testing Process
1. All changes are built on a `claude/...` development branch
2. Every push to that branch **automatically updates test.timothystl.org**
3. We review and approve changes on the test site
4. When ready, changes merge to `main` → **automatically updates timothystl.org**
5. The live site is never touched until something is approved

---

## Who Manages What

| Section | Who Updates It | How They Update It | How Often |
|---------|---------------|-------------------|-----------|
| Home, About, Worship, Sermons, Ministries, Contact, Prayer | Developer (you + Claude) | Code change → test → deploy | Rarely |
| News & Events | Pastor / office staff | Admin portal → News & Events tab | Weekly |
| Youth pages (youth, sundayschool, vbs, egghunt, confirmation, family) | Youth director | Admin portal → Youth Pages tab | As needed |
| Christmas Market page | Office staff | Admin portal → Special Pages tab | Annually |
| /voters page | Office staff | Admin portal → Special Pages tab | Before each voters meeting |
| Redirects (/zoom, /councilfiles, etc.) | Office staff | Admin portal → Redirects tab | As needed |
| Newsletter (Beehiiv) | Pastor / office | Admin portal → Newsletter tab | Weekly |
| Volunteer events | Staff | volunteer.timothystl.org/admin | As needed |

---

## Full Page Architecture

### Section 1 — Static Pages
*Only a developer changes these. Content is stable.*

| URL | Page Name | Key Content |
|-----|-----------|-------------|
| `/` | **Home** | Service times (must be visible without scrolling on mobile), "New Here?" call to action, quick links to most-visited sections |
| `/about` | **About Us** | Vision, Mission, Core Values, Mission Field, staff directory with photos |
| `/worship` | **Worship** | Service times, what to expect, livestream link |
| `/sermons` | **Sermons** | YouTube sermon archive/embeds |
| `/ministries` | **Ministries** | Hub page — cards linking to all ministries |
| `/contact` | **Contact** | Address (links to Google Maps), phone (tap-to-call), email, contact form |
| `/prayer` | **Prayer Request** | Prayer request submission form |
| `/give` | **Give** | Redirect → Breeze giving page *(update URL when Breeze is cancelled)* |
| `/news` | **News & Events** | Dynamic feed — see Section 2 below |
| `/calendar` | **Calendar** | Embedded Google Calendar |

### Section 2 — News & Events Feed (`/news`)
*Admin manages via News & Events tab in admin portal.*

Each news item contains:
- **Title**
- **Date**
- **Short summary** — 2-3 sentences, shown on the card
- **Full body** — shown when visitor clicks "Read More"
- **Optional image**
- **Expiry date** — item auto-hides after this date (default: 90 days). Expired items stay in the database and can be un-expired if needed.
- **Pinned flag** — pinned items always appear at the top regardless of date

Display behavior:
- Newest items first
- Card layout: image + date + title + summary + "Read More" button
- Expired items are invisible to visitors but still in the admin panel
- Pinned items appear above all others

### Section 3 — Ministry Landing Pages
*Developer builds these once. Rarely change. Flyer-friendly short URLs.*

| URL | Ministry | Notes |
|-----|----------|-------|
| `/christmasmarket` | Christmas Market | Admin-managed annually: dates, description, photos, vendor registration link (Google Form) |
| `/foodpantry` | Food Pantry | Hours, how to donate, how to volunteer |
| `/music` | Music Ministry | Description, contact |
| `/stephen` | Stephen Ministry | Description, contact |
| `/bees` | Urban Beekeepers | Description, contact |
| `/wol` | Word of Life School | Brief landing page → wordoflifeschool.net |
| `/mdo` | Mother's Day Out | Redirect → mdo.timothystl.org |

### Section 4 — Youth Pages
*Youth director manages these via admin portal. Developer builds the system, youth director fills in content.*

| URL | Page | Notes |
|-----|------|-------|
| `/youth` | Youth & Family | Main landing page for the youth ministry |
| `/sundayschool` | Sunday School | Communications to parents |
| `/confirmation` | Confirmation | Confirmation program info |
| `/vbs` | VBS | Vacation Bible School |
| `/egghunt` | Egg Hunt | Annual Easter Egg Hunt |
| `/family` | Family Ministry | Family-focused programming |

### Section 5 — Utility Redirects
*Anyone can update these via admin portal → Redirects tab. When a URL changes (new Zoom link, new Drive folder), office staff update it in 10 seconds — no code changes needed.*

| Short URL | Goes To |
|-----------|---------|
| `/volunteer` | volunteer.timothystl.org |
| `/zoom` | Zoom meeting URL |
| `/councilfiles` | Google Drive folder |
| `/voters` | Special page (Zoom link + downloadable reports) |
| `/give` | Breeze giving page |
| `/mdo` | mdo.timothystl.org |

---

## The Admin Portal (`admin.timothystl.org`)

One login, multiple tabs. Two access levels:

**Staff access (pastor/office):** All tabs
**Youth director access:** Youth Pages tab only (separate password)

### Tab: News & Events
Create and manage news posts for the `/news` page.

```
[ + New Post ]

TITLE:         ___________________________________
SUMMARY:       ___________________________________  ← shown on card
               ___________________________________
FULL STORY:    [ Bold ] [ Italic ] [ List ] [ Link ] [ Image ]
               ___________________________________

IMAGE:         [ Upload Image ]
EXPIRY DATE:   [ 90 days ▼ ] or [ custom date ]
PINNED:        [ ] Pin to top

                                    [ Save & Publish ]
```

### Tab: Youth Pages
Youth director's interface. Deliberately minimal.

```
YOUTH PAGES

  ○ Youth & Family          Last updated: March 15
  ○ Sunday School           Last updated: March 10
  ○ Confirmation            Last updated: Feb 28
  ○ VBS                     Last updated: Jan 5
  ○ Egg Hunt                Last updated: Feb 20
  ○ Family Ministry         Last updated: Jan 15

  [ Click any page to edit ]
```

When he clicks a page:
```
Editing: VBS

[ Bold ] [ Italic ] [ Bullet list ] [ Link ] [ Insert Image ] [ Heading ]
+----------------------------------------------------------+
|                                                          |
|  (editor — works like Google Docs)                       |
|                                                          |
+----------------------------------------------------------+

                                         [ Save & Publish ]
```
- No drafts. No preview step. No accounts. Hits Save & Publish → live immediately.
- Image upload: click Insert Image → pick file from computer → image appears.
- The URL to this page is bookmarked in his browser. He does not need to know it's a website.

### Tab: Special Pages
For pages that change annually or before major events.

Pages managed here:
- **Christmas Market** — update dates, description, photos, vendor form link each fall
- **/voters** — update before each voters meeting: add Zoom link, upload downloadable reports

### Tab: Redirects
A simple table. Update any short URL without touching code.

```
/zoom           https://zoom.us/j/...           [ Edit ]
/councilfiles   https://drive.google.com/...    [ Edit ]
/voters         (managed in Special Pages)
/give           https://timothystl.breeze...    [ Edit ]
```

### Tab: Newsletter
Existing Beehiiv integration — unchanged. Draft and publish email newsletters.

### Tab: Volunteer Admin
Link out to volunteer.timothystl.org/admin — no rebuild needed, just a quick access link.

---

## Technical Architecture

```
CLOUDFLARE NETWORK
│
├── timothystl.org
│     Worker: timothystl-site
│     Serves: static HTML/CSS/JS (timothystl-site.html)
│     Fetches dynamically:
│       - /news data from admin worker API
│       - /youth/* data from admin worker API
│
├── admin.timothystl.org
│     Worker: tlc-newsletter-admin (EXTENDED)
│     Serves: admin portal (all tabs)
│     Owns: D1 database "tlc-newsletter-db"
│       Tables: newsletters, events, news_items, youth_pages
│     Handles: image uploads to Cloudflare R2
│
├── volunteer.timothystl.org
│     Worker: breeze-proxy-worker (UNCHANGED)
│     Owns: D1 database "tlc-volunteer-db"
│
├── links.timothystl.org
│     Worker: tlc-links (UNCHANGED)
│
└── test.timothystl.org
      Worker: timothystl-test-site
      Mirrors: same HTML as production
      Auto-deploys from: any claude/* branch
```

### Image Storage
- Ministry/news/youth images → Cloudflare R2 bucket (cheap, fast, integrates directly)
- Static images committed to repo (logos, design images) → served as static assets

### Database Tables
```
tlc-newsletter-db
  newsletters     — existing (Beehiiv newsletter drafts)
  events          — existing (newsletter events)
  news_items      — NEW (news & events feed)
  youth_pages     — NEW (youth director content)
  special_pages   — NEW (Christmas Market, voters)
  redirects       — NEW (short URL table)
```

---

## SEO Plan

### What Search Engines Will See
Every page will have:
- A unique `<title>` tag (e.g., "Christmas Market | Timothy Lutheran Church — St. Louis, MO")
- A `<meta description>` (2-sentence summary shown under the link in Google results)
- Open Graph tags (controls how the link looks when shared on Facebook, text, email)

The homepage will also have **Schema.org Church markup** — structured data that tells Google:
- This is a church
- Here is the address
- Here are the hours
- Here are the social profiles

This is what produces the "knowledge panel" in Google search results showing your address, phone, and hours directly.

### Target Keywords (by audience)
| Audience | Keywords |
|----------|----------|
| New visitors looking for a church | "Lutheran church St. Louis MO", "LCMS church St. Louis", "church Lindenwood Park", "church near me South City St. Louis" |
| Parents | "Mother's Day Out St. Louis", "Lutheran preschool St. Louis", "Sunday school St. Louis", "VBS St. Louis 2026" |
| Community seekers | "food pantry St. Louis", "Christmas market St. Louis", "community events Lindenwood Park" |

### Social Media Footer (Every Page)
Every page will have the same footer with:
- Facebook / Instagram / YouTube icons → timothystl handles
- Service times
- Address (links to Google Maps)
- Phone (tap-to-call link)
- Copyright

---

## Design Principles

1. **Service times and address visible on mobile without scrolling** — this is the #1 searched piece of info
2. **Real photos over stock photos** — one real photo of your congregation is worth 10 stock images
3. **5-7 navigation items max** — people scan menus, they don't read them
4. **Every phone number is a tap-to-call link** — 60-70% of church traffic is mobile
5. **Every address links to Google Maps** — same reason
6. **No content older than it should be** — auto-expiry on news items keeps the site feeling alive
7. **"New Here?" path is clear** — first-time visitors need an obvious on-ramp
8. **3 clicks or fewer to anything important**

### Design Language (for reference in conversation)
| Term | What It Means |
|------|---------------|
| **Header** | Top bar with logo and navigation links |
| **Hero** | Large top section of a page with big text and usually an image or color background |
| **Nav / Navigation** | The row of links at the top (Home, About, Worship, etc.) |
| **Card** | A box containing info about one thing (a ministry, a news item, a staff person) |
| **Card grid** | Multiple cards arranged in rows |
| **CTA (Call to Action)** | A prominent button prompting a specific action ("New Here?", "Contact Us", "Learn More") |
| **Footer** | Bottom section of every page — address, phone, social icons, copyright |
| **Section** | A distinct content block within a page, usually separated by background color |
| **Eyebrow text** | Small uppercase text above a headline, sets context (e.g., "OUR STORY") |
| **Badge / Pill** | Small rounded label (e.g., "New", "Pinned") |
| **Sticky nav** | Navigation bar that stays at the top of the screen as you scroll |
| **Hamburger menu** | The ☰ icon on mobile that opens/closes the navigation |
| **Sidebar** | A column on the side of content (we don't currently use this) |

---

## Build Phases & Status

| # | Phase | What Gets Built | Status | Blocker |
|---|-------|----------------|--------|---------|
| 1 | Test environment | test.timothystl.org auto-deploys from dev branches | ✅ DONE | — |
| 2 | News & Events admin tab | Staff can create/edit/expire news posts | TO DO | — |
| 3 | Youth Pages admin tab | Youth director can edit his pages via WYSIWYG | TO DO | — |
| 4 | Wire /news + /youth/* | Public-facing pages pull from admin database | TO DO | Phases 2-3 first |
| 5 | Ministry landing pages | /christmasmarket, /foodpantry, /music, /stephen, /bees | TO DO | Need photos |
| 6 | Special Pages tab | Christmas Market, /voters in admin portal | TO DO | — |
| 7 | Redirects tab | /zoom, /councilfiles, etc. managed from admin portal | TO DO | — |
| 8 | Static page audit | Review every current Tithely/Breeze page, migrate content | TO DO | Need access |
| 9 | SEO pass | Schema.org, OG tags, meta descriptions, keywords | TO DO | — |
| 10 | Design reference page | Visual HTML guide to UI element names | TO DO | — |
| 11 | Logo integration | Replace SVG placeholder with real TLC logo in nav/header | TO DO | Need logo files |
| 12 | DNS cutover | Point timothystl.org to new site. Cancel Tithely/Breeze. | LAST STEP | All phases done |

---

## Outstanding Items Needed From You

| Item | Why It's Needed | Priority |
|------|----------------|----------|
| **Logo files** (blue/gold version) | Replace placeholder logo in nav and header | High |
| **Ministry photos** | Build real ministry landing pages | Medium — build layouts first, swap photos in |
| **Google Calendar public RSS URL** | Wire up /calendar page | Medium |
| **Zoom meeting URL** | Populate /zoom redirect | Low |
| **Council Files Google Drive URL** | Populate /councilfiles redirect | Low |
| **New giving platform decision** | When Breeze is cancelled, /give needs a new destination | Before DNS cutover |
| **Youth director's admin password** | Set up his separate access | Before Phase 3 |
| **Confirmation that test.timothystl.org looks right** | Verify Phase 1 is working | Now |

---

## Decisions Already Made

These are settled. No need to revisit them.

- **Single-file SPA** — the main site is one HTML file. No React, no Next.js, no frameworks.
- **Cloudflare Workers** — not Netlify, Vercel, or any other host.
- **No WordPress** — too complex for the owner and the youth director.
- **Custom admin portal** — matches the pattern already built for newsletter/volunteer.
- **D1 (SQLite)** for all dynamic content — already in use, keep consistent.
- **Cloudflare R2** for uploaded images.
- **LCMS mentioned once** — quietly on the About page. Not a focal point throughout the site.
- **WOL gets its own landing page** — not a plain redirect. Better for SEO and branding.
- **Christmas Market = Option B** — admin-managed, not static HTML.
- **News and newsletter are separate** — site news ≠ Beehiiv email newsletter. Kept decoupled intentionally. Staff can choose to copy/paste to Beehiiv separately.
- **/newsevents removed** — `/news` is the canonical URL.
