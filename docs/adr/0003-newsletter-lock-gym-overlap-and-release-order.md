# ADR 0003: Newsletter schedule lock, gym overlap triggers, and ordered releases

Status: accepted (implemented September 24, 2026; confirmed against the code October 1, 2026)

## Decisions

1. **Gym bookings cannot overlap, enforced by the database.** Triggers installed with schema setup
   (`DB_INIT_GYM_OVERLAP_TRIGGERS` in `admin/db.js`) reject partial overlaps when an active (`hold` or
   `confirmed`) booking is inserted, moved, or reactivated; adjacent bookings stay valid. Application
   pre-checks remain for friendly messages. Historical conflicts already in the data are preserved
   for office review. Grouped approvals confirm all holds in one statement, so one conflict leaves the
   whole group unconfirmed. Covered by `admin/gym-overlap.test.mjs`.
2. **One scheduled Brevo campaign per newsletter issue.** Scheduling creates an unscheduled draft,
   records its ID, then schedules it; rescheduling updates the same campaign. A durable per-issue lock
   (`newsletters.schedule_operation`, `admin/newsletter-schedule.js`) serializes schedule, cancel,
   direct-send, and delete. The lock is **never** released by a timeout: a timed-out provider call can
   still succeed, so automatic expiry could let two requests queue mail. Operating procedure is in
   [OPERATIONS](../OPERATIONS.md).
3. **Releases are serialized.** The deploy workflow shares one concurrency lock, never cancels a
   release in progress, skips stale queued runs before any production write, and deploys all three
   Workers from one recorded checkout. See [OPERATIONS](../OPERATIONS.md) and
   `admin/release-order.test.mjs`.

## Not covered

Duplicate campaigns created before this change were not automatically cancelled.
