# Open work

Only items that were still open when the retired plans and design handoffs were removed
(October 1, 2026; the old files remain in Git history). Each item cites its source. Items marked
"unverified" could not be confirmed from the code and need a check against production or a person's
decision. Security findings carry their `RP-nn` code from
[SECURITY-REMEDIATION-PLAN.md](../SECURITY-REMEDIATION-PLAN.md), which holds the full fix and
acceptance test for each.

## Security (re-tested against the code October 1, 2026)

| Item | Evidence it is still open |
|---|---|
| RP-01 push payloads quote prayer/contact text and go to every staff subscriber | `website-admin-worker.js` contact and prayer push sends `message.slice(0, 150)`; `pushToAllSubscribers` filters by audience only (`admin/webpush.js`) |
| RP-02 / RP-03 sensitive registration fields | `registrationsCsv` in `admin/events.js` includes `sensitive_json`; the field hint says "Kept out of the plain export column"; the coordinator email lists sensitive fields; no `sensitive_data_view` permission exists |
| RP-04 audit log history still holds old sensitive data | New deletes are redacted at write time (`redactAuditState` in `admin/auth.js`); audit rows written before October 2, 2026 may still contain `sensitive_json` and need a one-time, logged scrub |
| RP-05 deploy is not gated on tests | `deploy.yml` has no dependency on `test.yml`; branch protection could not be inspected (unverified) |
| RP-07 schema version stamped even when statements fail | `website-admin-worker.js` writes `_schema_version` unconditionally after the migration block |
| RP-18 gym invoice money stored as `REAL` | `gym_invoices` in `admin/db.js` |
| RP-19 payroll Supabase schema/functions not in this repository | no `supabase/` directory (the data lives in myMDO's Supabase project) |
| RP-08, RP-11, RP-14, RP-15, RP-16, RP-20 to RP-24, RP-26 | not re-tested, or need a production check or a policy decision; see the plan |

## Admin screens (from the retired admin redesign status list)

- Human side-by-side comparison of every screen against `design_handoff_admin_overhaul/screens/`
  was never recorded as done. Unverified.
- `/ministries/:slug/posts` as a shared list-section config, and folding `/notices/add` into the
  edit form: the old status file called both "still open" in one place and "converted" in another.
  Unverified.
- A user-permissions drawer (`drawer-user-permissions.png` in the handoff) was never built; users
  are edited on the `/users/new` and `/users/edit/` routes. A decision, not a defect.
- `/scheduler` and `admin/scheduler.html` are dead code (the endpoint they call does not exist),
  kept behind the session gate. Removal is a code change outside this documentation pass.

## Editor and giving rollout (from the retired block-editor rollout notes)

- Confirm the `give.timothystl.org` landing page blocks are published in production
  (`/pages/give-landing/edit`) and that a real gift went through afterward. Unverified; the old
  note said the draft was seeded but unpublished.
- `/music` video cards need real YouTube URLs (`admin/site-pages.js` still carries a generic
  channel link). Content work.
- Launch photography for the news redesign (about eight real photographs) was listed as a known gap.
  Content work; unverified whether it is complete.

## Other

- Facilities contract (`contracts/README.md`) is a proposal only; runtime delivery needs the
  controls listed there.
- Shared staff login and payroll ownership migration to Finance are unfinished (see
  [DATA-OWNERSHIP](DATA-OWNERSHIP.md) and the
  [overhaul plan](https://github.com/timothystl/digital-architecture/blob/main/architecture/11-overhaul-readiness-and-execution-plan.md)).
