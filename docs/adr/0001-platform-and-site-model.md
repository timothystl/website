# ADR 0001: Platform and site model

Status: accepted (decided March 2026; confirmed against the code October 1, 2026)

## Decisions

- **Cloudflare Workers** host everything; no Netlify, Vercel, or WordPress. The public site, Website
  Admin, and the links page are separate Workers (see [ARCHITECTURE](../ARCHITECTURE.md)).
- **D1** holds dynamic content and **R2** holds uploaded images. Static assets (logo, fonts, design
  images) are committed under `public/`.
- **A custom admin, not an off-the-shelf CMS.** Office staff and ministry leaders must be able to
  change content without a developer. Per-user capability checkboxes, not roles, decide what each
  person can touch.
- **Site news and the email newsletter are separate things.** `news_items` (the website feed) and
  `newsletters` (the weekly email) are separate tables and screens; staff choose to reuse content.
- **Short utility URLs are data**, edited in the admin Redirects screen, not code.

## What changed since the original plan

- The newsletter provider is Brevo, not Beehiiv (see `admin/newsletter.js`).
- The site is no longer one hand-written HTML file. Pages are published blocks; see
  [ADR 0002](0002-published-blocks-are-authoritative.md).
- The `test.timothystl.org` preview Worker described in the original plan is not deployed by this
  repository's workflow (`deploy.yml` releases only Site, Admin, and Links); the repository defines
  production resources only.
- The Worker, database, and bucket names in the original plan were renamed in September 2026
  (see [NAMING-CUTOVER](../NAMING-CUTOVER.md)).
