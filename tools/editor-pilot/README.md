# Visual editor pilot

A local, isolated Food Pantry pilot built around the current Website editor and renderer. No production routes, block definitions, database records, or deployment configuration are changed.

## Run

Use Node 22:

    node tools/editor-pilot/server.mjs

Open http://127.0.0.1:4320/pages/foodpantry/edit. The server binds only to loopback. `PORT` and `PILOT_STORAGE` are optional. Drafts and local image uploads are in `.local/`, which Git ignores. Stop the server with Ctrl+C; reopening it restores the local draft.

## Try

- Open Insert or a plus between blocks. Drag a tile onto Add here or beside a block; click-to-insert is also available.
- Drop left/right to form two columns; stack several blocks in either column.
- Drag the column divider. Its arrow keys and the inspector’s width control are alternatives.
- Layout columns stack when the canvas is 760px or narrower, including Tablet preview. Image/text and other inner grids also stack inside columns at 520px or narrower. Desktop proportions remain saved; the same rules apply to standalone Preview.
- Click a block for settings. Outline and Settings are optional; neither occupies space by default.
- Try stamp shapes, size, mobile size, rotation, position, and scheduled visibility. Existing colors and pulsing remain under More block settings.
- Choose Before / Now / Finished in Countdown preview. Change the ending message, hide the timer, or supply button text and a destination. Event sources remain the original block fields. The supplied News & Events record is explicitly a sample.
- Edit with the original self-hosted TinyMCE, choose the existing pantry image, or upload a local photo.
- Undo/redo, wait for Autosaved, then reload. Preview renders the same local block/layout data.

## Preservation and scope

The original block content remains a flat array with its IDs, HTML, images, links, and source references. Optional `pilot` metadata adds layout membership and styling; layout groups reference existing blocks, rather than converting their bodies to new types. The local validator rejects unknown block types and duplicate IDs instead of dropping content silently. This envelope is local-only: it must not be submitted to production, whose sanitizer has not been changed to accept it.

The four repository Food Pantry seed blocks remain in the sample. An additional image/text block and sample countdown demonstrate columns. The sample is not a live database export. The hero is given a light presentation for this test.

This pilot has two flexible columns with stacking inside either column. Arbitrary nesting, three-plus-column containers, and image-drop-from-desktop insertion are not implemented. Original block image picker uploads work locally. Uploads and blocks persist; the media index and reusable sections are session-only. Production page settings, publishing, scheduling, revisions, document uploads and live shared records are disconnected. Existing specialized controls are retained but some need live source data to show useful results. The fallback fonts differ from the live site's hosted fonts.

Stamps without a countdown target cannot use Before countdown ends; use Always or a church-time date range instead. A countdown's event duration controls when its Finished message appears. Explicit after-event buttons need a safe URL; no URL produces a visible configuration prompt instead of a dead button. Preview state changes never change the saved event date.

## Verification

Run:

    node --test tools/editor-pilot/model.test.mjs admin/tinymce-assets.test.mjs

Passed on Node 22: seven model tests plus the existing 67-assertion TinyMCE asset suite. Coverage includes all existing block types, all repository page seeds, identical renderer output for untouched pages, layout/content preservation, unsafe URLs, and rejecting duplicate/unknown blocks.

Browser checks completed: boot; real block insertion into a column; pointer drag from picker to column; Undo of drag insertion; pointer and keyboard divider resize; saved draft reload; linked countdown ending; original TinyMCE toolbar; 390px responsive layout (no horizontal overflow). Reset restored the test fixture. No JavaScript errors observed in the completed checks.

Before production adoption, port the metadata validation/rendering to the shared production path, add concurrency/version protection, cover mixed legacy half-width rows with new containers, test actual copies of representative saved pages, and verify real media/shared-data flows. This branch is a reviewable pilot, not authorization to migrate all pages.

Responsive follow-up: verified the saved user draft at desktop (1080px), tablet (620px), and phone (390px) canvas widths. Desktop retained its saved 53/47 proportions; tablet and phone used one column with no horizontal overflow in the layout or image/text grid. No sample reset or content migration was performed.
