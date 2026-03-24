# Site Review — Action Items
**Generated:** 2026-03-23 | **Status:** Pre-DNS-cutover

This file captures findings from the full technical audit. Cross off items as addressed.

---

## 🔴 Must-Do Before DNS Cutover

- [ ] **Update Breeze giving URL** — owner has new URL but code still points to `timothystl.breezechms.com/give/online`. Update in three places:
  - `public/index.html` — Give page button
  - `tlc-admin-worker.js` line 640 — newsletter email footer
  - `tlc-links-worker.js` — links page
  - `public/manual.html` — staff manual documents the URL

- [ ] **Verify Brevo secrets set on production Cloudflare worker** — newsletter sends will silently fail if these aren't configured:
  - `BREVO_API_KEY`
  - `BREVO_LIST_ID`
  - `BREVO_SENDER_EMAIL`

- [ ] **Add confirmation email to contact/prayer form submitters** — right now only the admin gets notified. The person submitting a prayer request should get an auto-reply. Especially important pastorally.

- [ ] **Add spam protection to contact/prayer forms** — no CAPTCHA, no rate limiting, no email validation. Fine for now but a real risk once the site is public.

- [ ] **Enter content for empty youth sub-pages** — the system is ready, youth director just needs to enter content for: `/sundayschool`, `/confirmation`, `/vbs`, `/egghunt`, `/family`

- [ ] **Enter Voters page data** — Zoom link + at least one council document in the admin Voters tab

- [ ] **Confirm sermons page is pointing to correct YouTube channel** — verify the embed or the manual content is current

- [ ] **Mobile nav audit** — confirm all 23 pages are reachable on mobile. Many routes added since last full audit.

- [ ] **Verify admin.timothystl.org connects to DB on production** — `wrangler.toml` has a `REPLACE_WITH_DATABASE_ID` placeholder. The GitHub Actions workflow injects the real ID on test deploys but the production deploy step may not. Confirm the production admin worker is actually hitting the right D1 database.

---

## 🟡 Should Fix (First 90 Days Post-Launch)

- [ ] **Service times as an editable block** — currently hardcoded in the HTML. Add a `service-times` block to the Pages tab in admin so office staff can update without a code change.

- [ ] **Update Worship page midweek section after Easter** — the Lenten midweek series info is hardcoded in the page. Update seasonally.

- [ ] **Add error messages when content fails to load** — pages like `/news`, `/sermons`, `/youth` show nothing if the API is down. Should show a fallback message.

- [ ] **SEO Phase 7:**
  - Schema.org `Church` markup on homepage (address, phone, hours, social links)
  - Open Graph tags per page (homepage is highest priority)
  - Meta description per page

- [ ] **Cloudflare Web Analytics** — free, no cookies, no GDPR concerns. Add the one-line snippet to `public/index.html`.

- [ ] **Delete `timothystl-site.html`** from repo root — stale file, not deployed anywhere, confusing.

---

## 🟢 Pre-DNS Cutover Checklist (Full)

Full go/no-go checklist before flipping DNS and cancelling Breeze/Tithely:

- [ ] Every form tested: contact, prayer, newsletter send, news item save, youth page save
- [ ] Every route tested on mobile
- [ ] Giving URL updated (see above)
- [ ] Volunteer.timothystl.org confirmed deployed to production
- [ ] Admin.timothystl.org confirmed deployed and DB connected
- [ ] Brevo secrets confirmed set
- [ ] `/voters` page has content
- [ ] Youth pages have content (or acceptable placeholder)
- [ ] DNS cutover map drawn — admin, volunteer, links, mdo all have workers deployed to prod
- [ ] `/manual` updated when give platform changes
- [ ] Breeze cancellation checklist complete — volunteer signups, giving, any other Breeze-tied features all have replacements confirmed

---

## Notes

**Hardcoded values to track:**
- Breeze URL: `timothystl.breezechms.com/give/online` (3 files, see above)
- Zoom URL: `us02web.zoom.us/j/3147818673` — in `public/index.html` around line 1999
- Council files Google Drive: hardcoded in same area

**Things that require a code change (not admin-editable):**
- Service times
- Staff bios and photos
- Footer content
- Nav structure
- Ministry page layout/photos
- Give URL (until updated)
