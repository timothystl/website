# Calendar scheduling and publishing

## Office workflow

Staff work in **Calendar & events** in Website Admin. Their Admin `intake_manage`
permission controls Google scheduling changes; they do not need individual Google
calendar accounts. `news_edit` is additionally required for linking or preparing
newsletter/website posts.

- Click a date or **Add event**. Choose a configured calendar, enter the details,
  optionally repeat daily/weekly/monthly, then **Save to Google Calendar**.
- Open a Google event to edit it. A repeating occurrence offers **Edit entire
  series instead**; the series form shows its original start date and preserves
  its recurrence rule. Cancellation uses the same occurrence/series distinction.
- **Website / newsletter post** opens or creates the event's linked publishing
  record. It starts as calendar-only; choose Website/Email channels and add photos
  and promotional copy there. It becomes available in the newsletter event picker.
- Existing dated posts/local events stay intact. Open one and choose **Publish /
  link to Google**. Review its details and either create a Google record or choose
  an existing entry in the displayed calendar range. No bulk migration is automatic.
- Linked post scheduling fields are locked. Edit those fields in Calendar; photos,
  publishing channels, promotional titles/copy and office checklists remain local.
- Use **Room / location**, Month/Week/List, and **Print this view** for the building
  schedule. Locations are the existing room/location text; this is not a new room
  conflict checker or a setup/cleanup reservation system.

## Connection

The existing Worker secrets `GCAL_SERVICE_ACCOUNT_EMAIL` and `GCAL_PRIVATE_KEY`
are reused. Only calendars listed in `calendar_google_ids` can be edited. The
calendar owner must share each intended calendar with the service account using
**Make changes to events**. Admin checks Google's reported access role and explains
read-only/missing access before offering a save. No ACLs or sharing permissions are
changed by this feature. Existing private gym credentials/calendars are not added
to the public feed.

## Ownership and failure behavior

Google owns linked scheduling. `calendar_event_links` records the exact source key,
calendar ID, Google event ID, last confirmed sync and error. Existing records are
not deleted or bulk-published. Exact links suppress duplicate legacy calendar
entries; existing heuristic deduplication remains for unlinked records.

Creation uses a stable client request ID; publishing a legacy record uses a stable
source-derived Google event ID. Retrying an uncertain response does not create a
second event. Updates use Google's ETag/If-Match check and stop on a conflict.
Only scheduling fields are patched; guests, conference links and recurrence rules
are preserved. No invitation/guest controls are introduced (`sendUpdates=none`).

Calendar views read scheduling directly from Google. Linked publishing caches
refresh on the existing quarter-hour cron, when opening a linked post, and before
newsletter preparation. Calendar rendering does not wait for every publishing
record to refresh.
Newsletter send/schedule preparation refreshes selected linked events strictly and
stops if Google cannot confirm them or a selected event has been cancelled.
Draft writing and promotional-content editing remain available using the last
confirmed dates during an outage; those edits cannot overwrite linked scheduling.
Already sent or scheduled Brevo emails are snapshots, not live calendar views;
cancel an existing schedule before scheduling an updated issue.

Failure leaves the editor open with its input and an explicit error. Sync errors
also appear in the calendar. An unavailable Google event is not interpreted as a
confirmed cancellation; cached records are preserved for review. Confirmed Google
cancellation clears the cached date but retains all promotional/office content.

Legacy creation endpoints remain compatible with existing tabs/integrations; new
Calendar and Office follow-up navigation uses the Google-backed form. Converting
all historical records is a separate reconciliation task, not part of deployment.

## Verification

`admin/calendar-google.test.mjs` covers configured-calendar and role boundaries,
ETag conflicts, duplicate retries, linkage, promotional-content preservation,
refresh failures and cancellation using SQLite and mocked Google responses.
`test/workspace-browser.test.mjs` exercises production-bundled scripts, Google
creation/retry, occurrence/series selection, legacy linking, room filters and print
visibility. No real Google events or newsletter messages are created by tests.

Google API references: [conditional updates](https://developers.google.com/workspace/calendar/api/guides/version-resources),
[recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents).
