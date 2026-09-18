# Visual page editor — Food Pantry rollout

The production editor is enabled at **https://admin.timothystl.org/pages/foodpantry/edit**. Other pages retain their existing editor in this first rollout. No page records are seeded, migrated, replaced, or published by this release. The local sample stays local.

## Try it

1. Open Food Pantry from Pages, or use the address above. Sign in normally.
2. Select a block. Use Insert or an insertion target to add content; drag beside a block for columns.
3. For an overlapping card, select the background block and choose **Card over background**. Add or drag blocks into **Add card content**. Adjust position, width and overlap; drag **Move card** for offsets and alignment guides.
4. Wait for Autosaved. Use **Preview draft** to open the saved draft privately. Desktop, Tablet and Phone controls are available in the editor; resize the standalone preview for responsive checks.
5. Publish when ready. View live opens the existing public page. The publishing options and revision restore remain available.

Columns and cards stack at 760px or narrower. Card offsets are ignored in that stacked layout. Existing original block settings are under More block settings. Media uploads and shared data use the existing Admin APIs.

## Preservation and save behavior

Optional `pilot` metadata is retained as the design envelope for compatibility with the trial. It adds layout/stamp/countdown settings without converting block bodies or replacing IDs. Server-side validation bounds styles and sanitizes links. Legacy blocks and half-width rows retain their original render path outside new groups; the page template, shared records, native forms, cache invalidation, and published/draft separation remain in use.

The visual editor serializes autosaves and retains edits made while a save is in flight. Draft and publish requests carry the loaded `updated_at` value; the server compares it atomically on write. A stale tab receives a conflict instead of overwriting newer work. After a conflict, preserve any unsaved text before reloading. Older clients cannot silently strip saved design metadata.

Draft preview is authenticated, ownership checked, no-store and noindex. It shows the page body rather than the full public site header/footer. It does not publish. Existing revision restores load a draft for review.

## Verification

- Existing seed content/rendering unchanged across 88 template/editor/public comparisons.
- Focused tests cover mixed legacy half rows, overlays, metadata round-trip, unsafe links/styles, and public runtime escaping.
- Real Worker/SQLite integration tests cover saving, reload, private preview, ownership, duplicate rejection, publishing, revisions, and stale save/publish refusal.
- Browser smoke test against the real Worker with memory-only SQLite: card insertion, autosave/reload, tablet stacking, self-hosted TinyMCE boot, draft preview and publishing. No live page was edited for these checks.
