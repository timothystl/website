# Kickoff prompt — Christmas Market event section

Paste this into Claude Code at the root of `timothystl/website`.

---

Read `design_handoff_market_event/README.md` in full before writing anything. It is the build spec for reorganizing the Christmas Market into an event section. The visual reference is `design_handoff_market_event/Christmas Market - Event Section.dc.html` — options **1b** (public pages) and **1c** (admin screen) are approved; 1a and 1d are context. Open it in a browser if you want to see it; its markup is the source of truth for layout and copy, not its runtime.

Before you start, read these files and tell me what you found:

- `admin/market.js` — the current screen, the settings shape, the three permissions
- `admin/market-page-seed.js` — the block draft that was never published
- `market-price.js` — the price rule, and its comment about the $92.99 error
- `public/index.html` — `#page-christmasmarket`, `#page-marketvendors`, `NESTED_PATHS`, `tlcMarketInit()`
- `public/styles.css` — the `.mkt-*` block and the tokens
- `admin/blocks.js` — `BLOCK_DEFS`, the `marketapp` entry and its renderer
- `admin/ui.js` / `admin/helpers.js` — `renderListSection`, `panel`, `panelList`, `sidebarShell`, `GROUPS`

Then work the four phases **in order, as separate commits**, and stop after each for me to look:

1. **Phase 1** — publish the vendor page's blocks and delete the hardcoded markup. Nothing else. The live page must look identical afterwards.
2. **Phase 2** — the split: page A keeps `/christmasmarket/vendors`, page B is the new `/christmasmarket/vendors/apply`.
3. **Phase 3** — the `jumplinks` block, built as a general capability available to every page, added to the two market pages only.
4. **Phase 4** — the five-tab admin event screen, and the sidebar's `Events` group.

Hard rules, from §0 of the README:

- Public addresses do not change. The only new one is `/christmasmarket/vendors/apply`.
- Do not touch or re-derive `market-price.js`. 1/2/3 tables are $31.20 / $62.10 / $93.00.
- No payment address in the browser; the amount and URL stay resolved server-side at submit.
- Permissions stay exactly as they are: `market_manage`, `settings_manage`, `giving_manage`, each panel checking its own.
- No public-facing prose in code. Every sentence lives in a block record.
- Do not build single sign-on. The Volunteers tab reads volunteer data from ChMS and is read-only.

Add tests as §6 describes, and run the existing suite before each commit. If anything in the handoff conflicts with what the code actually does, say so and ask — do not guess.
