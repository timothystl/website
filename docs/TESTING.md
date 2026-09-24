# Testing

Use Node 22. Run the command set in `AGENTS.md`, including syntax checks for every `admin/*.js`,
every `admin/*.test.mjs`, and the documented Admin, Site, Links, and Give suites. Run focused
Playwright coverage for the changed surface; `test/public-page.test.mjs` is the required browser
gate for edge/client page ownership, and TinyMCE changes require its self-hosted browser gate.

Tests must exercise the intended route and fail on the regression. Expected negative-path log
messages are not failures when their assertions pass. A local green suite does not establish a
successful production deploy, live capability correctness, datastore recovery, or business-data
reconciliation.

Before merge, verify relative documentation links and inspect the workflow consequence: merging to
`main` is a production release of all three Workers.

The calendar and Worship Times workspace browser test runs in CI with the public-page gate:
`node test/workspace-browser.test.mjs` (Playwright 1.55.0 and esbuild 0.25.10).
It bundles the client with `keepNames`, as Wrangler does, before opening it in Chromium.
Do not serialize Worker functions with `Function.toString()` for browser execution: bundling
can insert Worker-only helpers, producing a blank calendar despite passing source-level tests.
The suite uses mock events and saves; it never creates a production event or sends a message.
