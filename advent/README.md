# Advent devotional online

A page-turning online edition of the Advent devotional booklet. It lives at
**timothystl.org/advent**, which forwards to its own small site,
`timothy-advent.pages.dev`.

- It opens to **today's devotion** (St. Louis time). Before November 29 it opens to the cover;
  after Christmas it opens to the cover, and every day stays available.
- Every day has its own link for emails: `timothystl.org/advent/dec-9`,
  `timothystl.org/advent/nov-29`, and so on (month abbreviation, a dash, the day, no leading zero).
- Readers can tap **Days** to pick a day, **Read as text** for large-print reading, or download the PDF.
- No logins, no cookies, no tracking.

## Replacing the booklet each year

1. Export the final booklet as a PDF (the 5.5 × 8.5 version).
2. In GitHub, open `advent/source/` and upload it as **`booklet.pdf`**, replacing the old one.
   (Optional: also upload the 7 × 8.5 version as **`booklet-7x8.5.pdf`** to offer it as a second download.)
3. Commit. About three minutes later the new booklet is live. You don't run anything on your computer.

If anything about the booklet is wrong, nothing is published and the old booklet stays up.
The run on GitHub's **Actions** tab ("Advent devotional") says what it couldn't find, for example:

```
These days were not found in the PDF:
  Wednesday, December 9
```

### What the booklet needs

The build reads the PDF's text, so nothing is tied to page numbers. It only needs:

- **Each devotion's left page has its date on a line by itself**, like `Wednesday, December 9`.
  The line just under it is used as the title.
- All 27 days, November 29 through December 25.
- Pages titled "How to use this devotional", "Midweek", "Prayer list", and "About the art" are
  found by those words and listed under **Days**.

A page listing several dates (like the midweek services page) is ignored for this.

### When a day can't be found

Copy `source/overrides.example.json` to `source/overrides.json` and list the day with its PDF
page number (the cover is page 1). You can also correct a title:

```json
{ "days": { "dec-9": { "page": 24, "title": "Every valley" } } }
```

### Other settings (`booklet.config.json`)

- `title`, `subtitle`, `description`: wording at the top and in link previews.
- `weeks`: the week names in the Days list (Remembered, Lifted, Covered, Carried, Christmas Day)
  and the date each week starts.
- `year`: leave `null`; the year is worked out from the weekdays printed in the booklet.
- `cloudflareAnalyticsToken`: leave empty for no analytics at all. To opt in to Cloudflare Web
  Analytics (cookie-free), paste its site token here.

## Testing a date

Add `?date=` to any address to see what a reader would see that day:

- `timothy-advent.pages.dev/?date=2026-12-09`: today's view on Dec 9
- `timothy-advent.pages.dev/?date=2026-11-20`: before Advent
- `timothy-advent.pages.dev/?date=2026-12-28`: after Christmas

## The timothystl.org/advent redirect (set up once)

Cloudflare dashboard → **timothystl.org** → **Rules** → **Redirect Rules** → **Create rule**:

- **Rule name:** Advent devotional
- **If incoming requests match:** *Custom filter expression* → **Edit expression**, paste:

  ```
  (http.host in {"timothystl.org" "www.timothystl.org"} and (http.request.uri.path eq "/advent" or starts_with(http.request.uri.path, "/advent/")))
  ```

- **Then:** URL redirect, **Type:** *Dynamic*, **Expression:**

  ```
  wildcard_replace(http.request.uri.path, "/advent*", "https://timothy-advent.pages.dev${1}")
  ```

- **Status code:** 302. **Preserve query string:** on.
- **Deploy.**

Result: `timothystl.org/advent` → `timothy-advent.pages.dev`, and
`timothystl.org/advent/dec-9` → `timothy-advent.pages.dev/dec-9`. Because it's a 302, you can
later point the same printed QR codes somewhere else by editing the rule.

Print `timothystl.org/advent` (not the pages.dev address) on QR codes and in emails.

## First-time publishing setup (once)

The GitHub workflow publishes with the repository secret `CLOUDFLARE_API_TOKEN`. That token needs
the **Account → Cloudflare Pages → Edit** permission. If it can see more than one Cloudflare
account, also add the secret `CLOUDFLARE_ACCOUNT_ID`. The first run creates the
`timothy-advent` Pages project by itself.

## For developers

Node 22 and poppler (`brew install poppler` / `apt-get install poppler-utils`).

```
cd advent
npm ci
npm run build        # PDF → dist/ (page images, manifest.json, one page per day)
npm run serve        # preview at http://localhost:8788
npm test             # day detection and text cleanup
npm run test:browser # desktop, tablet, and phone checks (needs Playwright + Chromium)
npm run test-pdf     # regenerate the 60-page stand-in booklet (needs Python reportlab)
```

`source/booklet.pdf` is currently a **generated stand-in** with the real layout and placeholder
text. Replace it with the real booklet.

The page-turn library ([StPageFlip](https://github.com/Nodlik/StPageFlip), MIT) and the Source
Sans 3 font (OFL) are kept in `site/vendor/` and `site/fonts/`, so the page loads nothing from
other sites. Images load only for pages near the reader.
