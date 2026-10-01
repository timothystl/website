# ADR 0002: Published page blocks are authoritative

Status: accepted (implemented September 7, 2026; confirmed against the code October 1, 2026)

## Context

Every public page originally had hardcoded markup in `public/index.html` and, separately, a block
draft in the admin that nobody had published. Two rendering paths and a fallback layer made it
unclear which one a visitor saw.

## Decision

- Once a page is published, its **published blocks are the only source** for its body. The hardcoded
  fallback bodies were deleted for every page confirmed published, and the client-side takeover
  logic was reduced to one rendering path shared with the edge render.
- Chrome (header, footer, newsletter band) is **not** a page and is not a block. It is managed on its
  own admin screens (Menu, Appearance, Footer columns) and fetched separately from page bodies
  (`/api/pages?chrome=1` versus `/api/pages?id=<pageId>`).
- The bespoke second ministry editor was retired. `/ministries/editor/:slug` now redirects an
  authorized owner to the canonical `/pages/:id/edit`; `youth_pages` keeps only the metadata the
  live features still read.
- The `404` page is deliberately not editable, so the office cannot produce a site with no working
  error page.
- `give-landing.js` stays as the fallback that runs during an admin outage; it is not dead code.
- The same block renderer (`renderInner()` in `admin/blocks.js`) serves the public site and the
  editor canvas. A second template for the editor is a bug.

## Consequences

Check callers before removing old data fields. Preserve publish and cache invalidation and
partial-failure handling. Anything self-filling (news feed, sermons, service times, core values)
reads live data at render time; never store copies in a block.
