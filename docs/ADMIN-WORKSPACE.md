# Admin workspace functionality

Full rollout implementation, September 23, 2026. The existing Admin theme is retained; the mockup's color and typography redesign is a separate decision. Release status is recorded in the pull request and deployment workflow.

## Entry points

- `/calendar-workspace`: month, week, and list views; category filtering; click a date or time shortcut to create a local event; open source records.
- `/shared-content`: permission-filtered links to existing church details, values, staff, partners, sermons, education, and ministry tools.
- `/shared-content/services`: structured day/time/note rows using the existing `church_service_times` setting, with a verified list of referencing draft and published page blocks. Unchanged rows and unfamiliar legacy lines are preserved. Conditional saves reject stale edits.
- `/pages/:id/overview`: actual draft blocks and shared sources, with links to the editor and page settings. Uses the same ownership checks as the page editor. Does not modify any page data.
- `/settings`: remains the searchable cross-workspace settings index, now labeled Find settings. Service times points to the structured editor.

Command search includes the new workspaces and shared worship times. Saving worship times invalidates public page data and the editor’s shared-data cache.

Navigation groups are Website, Calendar & events, Communications, Operations, and Administration. All existing routes remain available. Shared-content destinations expand in their own group instead of being mixed with the Pages list. The full-width visual editor is now enabled for every canonical page, including ministry pages reached through their existing redirects. Opening a page does not rewrite its blocks, publish a draft, or change its template. Existing ownership checks remain in force.

## Event behavior

The Admin calendar reads the existing Google, News & Events, gym, and local intake sources. It shows source records separately so the editing destination is unambiguous. Public-feed deduplication remains unchanged. Multi-day website/local events that began before the requested month remain visible when they overlap it.

Local event creation and editing require `intake_manage`. Saves use the existing `event_intake` record, validate real dates/time ranges, clear times for all-day events, and conditionally reject conflicting edits. They retain the global session/CSRF gate and write the audit log. No schema migration or parallel event store is introduced.

**Local events are public when saved**, matching existing behavior. The form explicitly says Add to public calendar. There are no private drafts or simulated publishing controls. Office follow-up is separate: the former Publish button now says Complete office follow-up, while its existing storage and route stay compatible. The checklist remains optional.

News events open their existing editor for users with `news_edit`. Gym records open Gym Rentals for `gym_manage`; private renter information is not added to the calendar response. Google events include their validated original Google link in the authenticated workspace only. No Google writes or recurrence edits occur in Admin.

The week view lists events per day above time shortcuts; it is not a drag-to-reschedule timeline. Registration/payment features remain in their existing workspace. New Google write permissions, recurrence editing, private event drafts, and deeper event promotion integration are outside this first functional pass.

## Local review

Use Node 22:

```sh
node --experimental-loader ./test/html-loader.mjs test/preview-admin.mjs /absolute/path/to/sample-preview.sqlite 4331
```

Open `http://127.0.0.1:4331/calendar-workspace`. This runs the real Worker with durable local sample SQLite data, a loopback-only preview session, no production bindings, and disabled external calls. Keep the terminal open. Do not point the preview at a production database copy. The preview launcher is development tooling only and is not imported into any Worker entrypoint.

Try creating an event, reopening and editing it after reload, all-day/multi-day events, switching views, opening a News event, and returning from shared worship times to a page overview. Sample records survive a preview restart. Google is intentionally unavailable in this isolated preview.

## Verification

- Unit coverage: lossless service rows, invalid/duplicate rows, dates, times, all-day/overnight handling, safe return paths, and actual shared-source detection.
- Real Worker integration coverage: permissions, CSRF, local event persistence, conflicts, month overlap, shared setting writes, return context, and unchanged page blocks. Database failures produce an explicit calendar error rather than an empty calendar.
- Existing Node suites and browser checks of the changed UI are part of the local review. Normal release CI, including the public-page browser gate, must pass before merge/deployment.
