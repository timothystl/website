// ── PRAYER AND CONTACT: HAND-AUTHORED, NOT EXTRACTED ────────────────────────
// The generic extractor (tools/extract-pages.mjs) has no model for a live,
// spam-screened form — the same reason admin/market-page-seed.js and
// admin/give-landing-seed.js exist as hand-authored files rather than
// extractor output. Left to itself the extractor turns the prayer/contact
// forms into a generic 'form' block (a Google Form embed with no URL set),
// which is exactly the failure this repo already hit once: published, that
// block renders no form at all — see NATIVE_FORM_REQUIRED_TYPE's own comment
// in tlc-admin-worker.js for the incident.
//
// This overrides ONLY the `blocks` array for the two pages the extractor
// already produced correct title/slug/parent/template/menu data for — the
// same `blocks`-only override REDESIGN_BLOCKS makes for the four redesigned
// pages. Everything else about the page rows comes from SITE_PAGES as
// generated.
//
// Every block below is intentionally minimal — id, type, and the content
// fields (eyebrow/title/body/spacing) that sanitizeBlock() does not
// backfill from a type's own `defaults`. Every other field (bg, ink, align,
// gap...) degrades through sanitizeBlock's own generic fallbacks to the
// same values an untouched new block would get.
export const NATIVE_FORM_BLOCKS = {
  prayer: [
    {
      id: 'prayer-1', type: 'hero',
      eyebrow: 'We pray for each other and the world',
      title: 'Prayer Requests',
      subtitle: "Share what's on your heart. Our pastoral staff prays for each request.",
      spaceAbove: 0, spaceBelow: 0,
    },
    {
      id: 'prayer-2', type: 'prayerform',
      title: 'Send a prayer request', align: 'center',
      body: '<p>The pastoral staff wants to know how to pray for you and walk alongside you in the joys and struggles of life. We can’t care well if we don’t know what’s happening.</p>\n<p>Submit a request below and someone from our team will pray for you — and reach out if you’d like pastoral care. You can also reach us at <a href="https://timothystl.org/prayer">timothystl.org/prayer</a>.</p>',
      spaceAbove: 64, spaceBelow: 64,
    },
  ],
  contact: [
    {
      id: 'contact-1', type: 'hero',
      eyebrow: "We'd love to hear from you",
      title: 'Contact Us',
      subtitle: "Questions, prayer requests, or just want to connect — we're here.",
      spaceAbove: 0, spaceBelow: 0,
    },
    // ⚠ WIDTH:'half' PAIRS THESE TWO, matching the original two-column
    // layout (the form on the left, how-to-reach-us on the right) — see
    // "Half blocks flow" in CLAUDE.md for how a run of consecutive halves
    // renders. A third consecutive half would start a new row; there is
    // no third block in this pair.
    {
      id: 'contact-2', type: 'contactform',
      eyebrow: 'Send us a message', title: 'Get in touch', align: 'center',
      width: 'half', spaceAbove: 24, spaceBelow: 24,
    },
    {
      id: 'contact-3', type: 'map',
      title: 'Find us',
      body: '<p>Where to park and which door to use.</p>',
      width: 'half', spaceAbove: 24, spaceBelow: 64,
    },
  ],
};
