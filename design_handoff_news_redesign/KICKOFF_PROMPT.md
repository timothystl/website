# Kickoff prompt for Claude Code

Copy everything below the line into Claude Code as your first message, with the
`design_handoff_news_redesign/` folder present in the repo (or its path adjusted).

Do not paste the whole handoff. The point of this prompt is that Claude Code reads the
handoff itself, then comes back to you with findings *before* writing code.

---

I'm implementing a design handoff into this repo. The full package is in
`design_handoff_news_redesign/`.

Read these three files first, in this order, and don't skim them:

1. `design_handoff_news_redesign/CLAUDE_CODE_BRIEF.md` — the build plan. This is your
   instruction set. It has ground rules, a Phase 0 verification pass, four build phases,
   a definition of done, and known gaps.
2. `design_handoff_news_redesign/README.md` — the full specification in plain text:
   every block type, every field, the token values, the responsive and accessibility rules.
3. `design_handoff_news_redesign/Handoff.dc.html` — the same specification with screenshots
   of every page and editor state. Open it in a browser when you need to see what something
   looks like. The screenshots are also in `design_handoff_news_redesign/screens/`.

There are two prototypes in that folder. They are **design references, not source** — do not
port their structure into the repo. Read them to learn behavior and to lift exact values:

- `Site Prototype - 1b.dc.html` — nine working pages. This is the behavioral reference.
  Open it in a browser and click through it before you write anything.
- `Site Editor - 1b.dc.html` — the block editor with the new palette and inspector.

## What I want from you first

**Do Phase 0 and stop.** Do not write implementation code in your first pass.

Phase 0 is six verification items in the brief. Work through all of them against the actual
repo and report back with:

- What you found for each of the six, specifically — file and line where it matters.
- Which of the six data sources exist in usable shape and which don't. I expect the weekly
  letter archive, the sermon records, and the core-values record to be the problem ones.
- Anything in the handoff that is wrong about this repo, or assumes something that isn't
  there. The design was authored against a reading of the code, not against the running app,
  so I'd rather you catch my designer's mistakes now than build around them.
- Your proposed order of work, and where you disagree with the brief's order.
- Anything you'd want decided before starting.

Then wait for me.

## Standing rules for the whole job

- One renderer. The public site and the editor canvas both render through `renderInner()`.
  If you're writing a second template for the editor, stop and tell me.
- Never hardcode content that the spec says is self-filling. If the data source is missing,
  say so — don't work around it with a literal.
- Don't delete anything on the first pass. The old `#page-news` markup and the old tokens
  come out weeks after the new page is published, not the same day.
- Ask instead of guessing. If the handoff is ambiguous, that's my fault, not a thing for you
  to resolve silently.
- Small commits, one concern each.

## Context you won't find in the files

- This is a church website — Timothy Lutheran, St. Louis. The audience is mostly members
  over 50, plus visitors checking service times on a phone before their first Sunday.
- The whole point of the redesign is that the current site "feels dead." Photography,
  scale, and a few live elements are the fix. If a tradeoff comes up between a clever
  implementation and a page that feels alive, the page wins.
- The office staff maintain the site through the editor. Anything that requires editing code
  to change is a failure of the design, not a feature.
