# Local development

This repository has no root `package.json` and no build step — the three Workers run the
committed `.js`/`admin/*.js` files directly, and CI installs `wrangler` and `playwright` on the
fly rather than from a lockfile (see `.github/workflows/test.yml`). "Local development" here
means two different loops depending on what you're changing.

## Loop 1: the Node test suites (fastest, no Cloudflare account needed)

This is the loop that actually exercises the real Workers day to day, and it's how CI validates
every PR. None of it needs a Cloudflare account, a deployed Worker, or network access to
D1/R2/`VOLUNTEER_WORKER` — `test/html-loader.mjs` makes the Workers importable in plain Node (they
use Wrangler's `import x from './y.html'` text-module syntax, which Node has no format for), and
the admin suites drive `tlc-admin-worker.js` against `node:sqlite` as a D1 stand-in.

```sh
for f in admin/*.js; do node --check "$f"; done          # syntax
for f in admin/*.test.mjs; do node "$f"; done             # admin module unit suites
node --experimental-loader ./test/html-loader.mjs test/admin-redesign.test.mjs
node test/site-taps.test.mjs
node test/site-edge-render.test.mjs
node test/site-404.test.mjs
node test/site-admin-timeout.test.mjs
node test/links-page.test.mjs
node test/give-page.test.mjs
```

That set is the required-before-merge list from `AGENTS.md`. The remaining Playwright suites
(`test/public-page.test.mjs`, `test/tinymce-selfhost.test.mjs`, `test/shell-layout.test.mjs`, and
the rest listed at the bottom of `.github/workflows/test.yml`) need a browser — install once with
`npx playwright install --with-deps chromium`, or use the Chromium already at
`/opt/pw-browsers/chromium` in the Claude Code environment (`export CHROME_PATH=...`). Run the
suite for whichever surface you touched; `test/public-page.test.mjs` is the one required browser
gate (edge vs. client page-body rendering) and runs in CI on every PR.

## Loop 2: running a Worker interactively with `wrangler dev`

Useful for clicking through a change in a browser rather than only reading test assertions. How
far this gets you depends on which Worker:

- **`timothystl-site`** (`npx wrangler dev --config wrangler-site.toml`) needs only the `ASSETS`
  binding (`public/`) — no D1, R2, or service binding. It runs fully standalone: the public site,
  the giving page, `run_worker_first` hostname routing, and clean-URL/404 handling all work with
  no external dependency.
- **`tlc-links`** (`npx wrangler dev --config wrangler-links.toml`) has no bindings at all.
- **`tlc-newsletter-admin`** (`npx wrangler dev`, the default `wrangler.toml`) is the least
  self-contained of the three. `wrangler dev`'s local mode gives you a fresh local D1 and R2
  automatically — schema is fine (every table is created by an idempotent
  `CREATE TABLE IF NOT EXISTS ...` the first time a route touches `env.DB`, the same
  `DB_INIT_*` constants in `admin/db.js` that production uses, so there's no separate seed step),
  but it starts **empty**: no pages, no login, no settings. You'll want to walk through initial
  setup/seed routes yourself, or work against `admin/*.test.mjs`'s fixtures instead of a fresh UI
  for anything that needs existing data.

  The `VOLUNTEER_WORKER` service binding (to `tlc-chms`) has no local target: `wrangler dev` will
  either fail to resolve it or (with `--remote`) reach the *real* production `tlc-chms` Worker,
  which you almost never want while iterating. The safe default is to leave it unresolved and
  expect `forwardToChms`/Market-operation calls to fail into the durable outbox
  (`chms_forward_outbox`) rather than deliver — that's the intended degrade path, not a bug (see
  `docs/CHMS_FORWARD_RECOVERY.md`). Do not point local `wrangler dev` at production D1/R2 by
  passing production IDs into a local config; the shared `wrangler.toml` already carries the real
  `tlc-newsletter-db`/`tlc-news-images` IDs; run it in default (local) mode.

None of the three `wrangler-*.toml` files define a separate staging environment — unlike `chms`,
this repository has only production Cloudflare resources. There is no `wrangler dev --env staging`
to reach for.

## What you don't need

No `npm ci` step exists for the Workers themselves (there's no root `package.json`); `wrangler` and
`playwright` are fetched per-run via `npx`/`npm install -g` in CI, and you can do the same locally.
`admin/vendor/tinymce/` is committed and self-hosted, so the admin editor loads with no TinyMCE
account either locally or in production — see the Editor rule in `AGENTS.md` before changing
anything under it.
