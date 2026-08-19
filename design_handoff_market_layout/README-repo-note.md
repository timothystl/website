# What is in here, and what was left out

The designer's bundle for the Christmas Market admin redesign, committed whole
for the same reason the four handoffs beside it are: a session reading half a
handoff builds half a design and cannot tell.

- `Market Handoff.dc.html` — the written handoff. Read this first.
- `Market Admin.dc.html` — the working prototype, with its own data and logic.
- `support.js` — the runtime those two need.
- `screenshots/`, `uploads/` — the renders the handoff refers to.
- `github.md` — the designer's own note on which repo file each screen was
  built from.

**Left out on purpose: the bundle's own `admin/` folder.** It held read-only
copies of `admin/market.js`, `admin/ui.js`, `admin/helpers.js` and
`admin/sections.js` as they stood when the design was drawn. Those files live
in this repo and have moved since; a second copy of them under a handoff
directory is a second answer to what the code says, and the one that is never
updated is the one somebody happens to open.

**Where the build deliberately disagrees with the prototype** — the radii, the
table-count selector, and the printed sheet's chrome — is recorded in
`CLAUDE.md` under "The vendor row is the form, and the roster is four views".
