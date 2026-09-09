# Architecture

Production has three Cloudflare Workers:

- `timothystl-site` (`site-worker.js` plus `public/`) serves the public site and giving landing.
- `tlc-newsletter-admin` (`tlc-admin-worker.js`) serves Website Admin, binds D1
  `tlc-newsletter-db`, R2 `tlc-news-images`, and service binding `VOLUNTEER_WORKER` to `tlc-chms`,
  and runs scheduled-page promotion every 15 minutes.
- `tlc-links` (`tlc-links-worker.js`) serves the utility links surface.

Published page blocks are authoritative. The Site Worker edge-renders initial page bodies; client
navigation uses the same published-block model. `/api/pages?chrome=1` returns global chrome and
`/api/pages?id=<pageId>` returns one page body when needed.

Website Admin forwards bounded contact/prayer and Market operations to Connect. Failed forward
copies use a durable outbox and the recovery procedure in `CHMS_FORWARD_RECOVERY.md`. The public
Site Worker has no direct Connect binding.
