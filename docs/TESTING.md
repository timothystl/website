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
