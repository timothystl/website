# Cross-product contracts

These proposed Website producer contracts contain closed JSON Schemas, unmistakably synthetic
examples, and validation tests. They do not add routes, database writes, service bindings,
credentials, scheduled delivery, or production traffic.

## `website.facilities-submission.v1`

This is the proposed future intake boundary from Church Website public forms to Connect Facilities.
It carries only the contact and request information needed to review a rental, repair, or service
provider request. It is classified `restricted-personal` and excludes payment instruments,
transactions, giving, payroll, family/child records, and Connect person identifiers.

`submissionId` and `idempotencyKey` support deduplication and traceability; neither becomes the
authoritative Connect facility-record identifier. Connect remains responsible for authorization,
review state, scheduling conflicts, bookings, invoices, vendor records, and all later mutations.

The current Website gym routes remain authoritative and unchanged. Before runtime delivery, define
authenticated transport, credential rotation, origin/rate/abuse controls, retention, replay and
bounded retry, dead-letter/reconciliation behavior, monitoring, redaction, compatibility,
deprecation, rollback, and an approved migration from the existing Website-owned workflow.
