# Functional review fixes — September 24, 2026

## F3: Gym booking overlap

Database triggers reject partial overlaps when inserting, moving, or reactivating
an active (`hold` or `confirmed`) booking. Adjacent bookings remain valid. All
entry points share this enforcement. The preflight checks still provide friendly
feedback; the database closes the gap between checking and writing.

Schema setup installs both triggers before recording the new schema marker.
Existing records are preserved, including historical conflicts that need office
review. Expired holds stop reserving space when the existing expiry task changes
their status. Multi-date creation invoices only slots successfully reserved. Grouped approvals
confirm all holds for that invoice in one statement, so a conflict leaves the
entire group unconfirmed.

## F4: One scheduled campaign per newsletter

Scheduling creates an unscheduled Brevo draft, records its ID, then schedules it.
Reschedule updates that same campaign with the saved content and requested time.
A durable per-issue lock prevents overlapping schedule, cancel, direct-send, and
delete operations. Cancellation clears the ID only after provider confirmation.
A timeout retains the ID; retries update it instead of making another campaign.
Unconfirmed changes are labelled in the editor. Sent issues remain read-only.

If a Worker is forcibly terminated during an operation, its lock intentionally
stays set. An operator must inspect that issue's saved campaign in Brevo, verify
no request is still in flight, and reconcile the campaign state before clearing
`schedule_operation`. Do not use an automatic expiry that could let two active
requests queue mail. A lost draft-creation response can leave an unscheduled
orphan draft, but cannot send it. This fix does not automatically cancel any
historical duplicate campaigns created before the repair.

Provider contract: [Brevo campaign update](https://developers.brevo.com/reference/update-email-campaign).

## F5: Ordered Website releases

The entire production workflow shares one concurrency lock. It never cancels an
in-progress release. A stale queued run skips before making production writes.
Version preparation records a version-only commit before deployment; all three
Workers deploy sequentially from that exact checkout. No job resets to a moving
main or redeploys Admin with newer application code.

The version commit records an intended release; the workflow's completed summary
is the evidence that all three deployments succeeded. If a deployment fails,
rerun it while its version-only child is still current main, or release newer
main. A failure can temporarily leave Workers on different revisions because
Cloudflare does not deploy three Workers atomically; serialization prevents a
competing older release from overwriting a completed newer release.

## Verification

- SQLite tests cover interval overlap, adjacency, reactivation, and old records.
- Mocked Brevo tests cover repeat/concurrent requests, cancellation, timeout,
  rejection, and the authenticated Worker routes.
- Disposable Git repositories exercise release preparation, stale runs, retry,
  and explicitly chosen versions.
- No real bookings, emails, or cancellations are used as test fixtures.
