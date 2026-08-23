# Security & Reliability Remediation Plan

Source: Executive assessment, 2026-08-23. This plan turns each finding into a
scoped, sequenced piece of work with an owner role, acceptance criteria and a
test to prove it. Nothing in this document has been implemented yet — it is
the plan the assessment asked for. Items marked **[MOCKUP FIRST]** need a
design pass before code, per the assessment's own instruction.

Codes are stable (`RP-nn`, "remediation plan") so a PR or commit can reference
one directly, the same convention `FX-nn` uses elsewhere in this repo.

---

## How this is organized

Four tracks, run in parallel where they don't conflict, ordered within each
track by "what has to be true before the next step is worth doing":

- **Track A — Data exposure** (push, exports, audit retention)
- **Track B — Platform integrity** (migrations, deploys, backups, deletes)
- **Track C — Account & access security** (MFA, auth hardening)
- **Track D — Correctness & performance** (races, floats, unbounded reads)

Each item states: what it is, why it matters, the concrete change, and how to
verify it's actually fixed (not just "looks fixed" — this repo's own test
suites are full of examples where the obvious check was vacuous; every
acceptance test below should be written to fail against the *current* code
first, then pass after the fix, the same discipline this file already uses
throughout its CLAUDE.md history).

---

## Track A — Data exposure (highest priority)

### RP-01 — Strip prayer/contact content from push payloads; scope delivery by permission

**Finding:** `admin/webpush.js` sends the first 150 characters of prayer and
contact messages to every `staff`-audience subscriber, regardless of that
account's permissions. A Market-coordinator-only account (`market_manage`
alone) receives prayer-request text on their phone.

**Fix:**
1. Prayer/contact push bodies become generic: `"New prayer request — open the
   dashboard"` / `"New message from <name> — open the dashboard"`. No message
   content in the payload. (Consistent with how held-mail pushes already work
   — they don't quote the message either.)
2. `pushToAllSubscribers()` gains a permission filter: join
   `push_subscriptions` against `users.permissions` (or a cached snapshot) and
   only send to accounts holding the permission relevant to the trigger —
   `notices_edit`/`settings_manage`-equivalent for prayer/contact (or a new
   narrow `messages_view` permission if none fits), `market_manage` for
   vendor applications, `gym_manage` for gym holds, `payroll_manage` for
   payroll-ready.
3. `push_log` keeps recording title/body (already truncated) — the log itself
   is `settings_manage`-gated, which is fine.

**Acceptance test:** subscribe two accounts, one holding only
`market_manage`; fire a prayer-request trigger; assert the market-only
account receives zero pushes and the body of any push that *is* sent contains
no message text. Verify non-vacuously by reverting the filter and confirming
the test fails.

**Owner:** whoever holds `admin/webpush.js` + `tlc-admin-worker.js` push
trigger call sites. No design input needed — this is a straightforward filter.

---

### RP-02 — Make "sensitive" registration fields actually excluded by default

**Finding:** `admin/events.js`'s CSV export loads and emits `sensitive_json`
unconditionally despite UI copy claiming it's "kept out of the plain export
column." The coordinator email also includes it in plaintext.

**Fix:**
1. Two export modes: **Standard** (no `sensitive_json`) and **Full — includes
   medical/allergy/pickup info** (requires re-confirmation: a checkbox +
   "I understand this file contains protected information" before download).
   Standard is the default and the only one bound to the existing Export CSV
   button; Full is a second, explicitly-labeled action.
2. The coordinator notification email drops sensitive fields from the body
   entirely and instead links to the registration in the admin (which itself
   should require the export-Full permission to view sensitive fields inline
   — see RP-03 for the reveal control).
3. Gate the Full export behind a new `sensitive_data_view` permission,
   separate from whatever permission currently drives the event's own
   management (`market_manage` / `events` coordinator permission) — a
   coordinator managing logistics doesn't need medical data by default.

**Acceptance test:** export CSV as an account without `sensitive_data_view` →
assert no sensitive columns/values present, even though the registration has
them. Export as an account with the permission and the confirmation flag →
assert they are present. Assert the coordinator email never contains a
sensitive value in either case.

**Owner:** `admin/events.js`. **[MOCKUP FIRST]** for the reveal/confirmation
UI (the assessment explicitly calls for a mockup on this exact control — see
"UI improvements" below, first bullet).

---

### RP-03 — A permission-scoped "reveal sensitive fields" control **[MOCKUP FIRST]**

**Finding:** there is currently no distinction between "can see this
registration" and "can see the child's allergy/medical/pickup fields on it."

**Design, to be mocked before implementation:**
- The registration detail drawer shows sensitive fields collapsed behind a
  "Show sensitive information" toggle, visible only to accounts holding
  `sensitive_data_view`.
- Every reveal is written to the audit log (`who`, `when`, `which
  registration`) — not the *content*, just the access event. This gives the
  office a record of who looked at medical data and when, which the
  assessment's "backup/security status screen" bullet also wants surfaced.
- The drawer states explicitly, in the same `◆` note style this admin already
  uses everywhere, what "sensitive" means for this event type and who can see
  it.

**Acceptance test:** an account without the permission never receives
sensitive field values in the drawer's initial payload (not just hidden by
CSS — checked server-side, the same "don't just hide the button" discipline
this repo already applies to publish gates and payroll locks). A reveal
writes exactly one audit-log row.

**Owner:** design pass first (mockup), then `admin/events.js` +
`admin/audit.js`.

---

### RP-04 — Deletion doesn't delete: the audit-log copy of a registration

**Finding:** before deleting a registration, its full row — including
`sensitive_json` — is copied into `audit_log`, which has no retention policy.
Deleting a record for a real reason (a parent asked for erasure, a duplicate
entry) leaves the sensitive data permanently in a second table nobody
thinks to check.

**Fix — two parts, and they need to land together:**
1. **Retention policy for audit-log entries carrying sensitive payloads.**
   Not a blanket retention cut (the audit log's whole job is being permanent
   accountability — see the "Approving a payroll period" precedent above,
   which explicitly keeps history forever). Instead: the *sensitive fields
   specifically* are redacted from the audit-log snapshot at write time —
   the log records that a registration existed and was deleted, with its
   non-sensitive fields (name, event, date), but never re-stores
   `sensitive_json`'s contents. If audit ever needs to show what changed,
   it shows "3 sensitive fields redacted" rather than the values.
2. Add a genuine hard-delete path for a documented erasure request (GDPR/CCPA-
   style), gated on the same `sensitive_data_view`-or-higher permission,
   logged as its own audit event ("erasure requested by X, performed by Y")
   with no payload copied anywhere.

**Acceptance test:** delete a registration with sensitive fields → assert the
resulting audit-log row contains no sensitive values, only a redaction
marker. Run the erasure path → assert zero rows anywhere in D1 reference that
registration's sensitive content.

**Owner:** `admin/events.js` (delete path), `admin/audit.js` (redaction at
write time).

---

## Track B — Platform integrity

### RP-05 — Make production deploy depend on tests passing

**Finding:** `.github/workflows/deploy.yml` deploys on every push to `main`
independently of `.github/workflows/test.yml`. `main` is unprotected.

**Fix:**
1. Protect `main`: require the test workflow to pass and require at least one
   review before merge (this is a GitHub repo setting, not a code change —
   flag for whoever holds admin on the `timothystl/website` org/repo).
2. Make `deploy.yml` a `workflow_run` trigger keyed on `test.yml`'s
   completion with `conclusion == 'success'`, or fold both into one workflow
   with `test` as a required job before the `deploy` job (`needs: test`).
3. The version auto-bump (`.github/workflows/deploy.yml`) already has logic
   to detect a manual version bump on the merge commit (see "The auto-bump
   stops overwriting a version somebody chose" in CLAUDE.md) — that logic is
   unaffected by gating deploy behind tests, just needs to still run after.

**Acceptance test:** push a commit that fails a test → assert no deploy job
runs (check via a deliberately-broken test on a throwaway branch/PR, not on
`main`).

**Owner:** whoever holds repo admin / CI config. No app code changes.

---

### RP-06 — Fix the one failing test before anything else lands

**Finding:** `test/admin-redesign.test.mjs:1732` currently fails because it
hardcodes a date (Aug 21) that has become a past date relative to "today."

**Fix:** the assertion should compute its test date relative to the current
date (e.g., `churchDatePlus(N)` for some `N` days out) rather than a literal
past-tense string, matching the `admin/when.js` discipline this repo already
uses everywhere else for exactly this class of bug.

**Acceptance test:** the suite is green today and stays green a year from
now without being touched again.

**Owner:** first PR in this whole plan — nothing else should merge onto a
red suite (see RP-05, and see CLAUDE.md's own repeated point: "a suite with
one known failure stops being read for the second one").

---

### RP-07 — Transactional, resumable migrations

**Finding:** the Christmas Market migration resumes only if the destination
table has zero rows — a crash after row 1 causes every retry to skip
everything. Migration errors are broadly swallowed (`try { } catch (_) {}`
around ~192 statements), and the version marker is written unconditionally
even when statements failed (already flagged as `AW-12`/`FX-28` in this
repo's own review history, and already reproduced once in production —
`pages.owner_username`, v4.33.0).

**Fix:**
1. Give the market migration (and any future data-migrating, not
   schema-only, migration) row-level idempotency: `INSERT OR IGNORE` keyed
   on the source row's stable id, not a table-is-empty check. This makes a
   partial run resumable by construction — re-running just fills in what's
   missing.
2. Track per-statement success in the schema-version gate: only stamp
   `_schema_version` current if every statement in the block succeeded this
   run. On partial failure, log loudly (already partially done) **and leave
   the marker unstamped**, so the next request retries the whole block. Since
   most statements are `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ...
   ADD COLUMN` guarded individually, retrying is safe — this repo's own
   `admin/db.js` already does most ALTERs as one-per-catch, which is the
   right shape; extend it to the seed/data-migration loops that currently
   share one broad try/catch.
3. D1 supports batched statements (`env.DB.batch([...])`) which run as a
   single transaction — use it for the market-vendor migration specifically,
   since it's copying related rows (registration + fields) that must land
   together or not at all.

**Acceptance test:** simulate a crash after the first vendor row is migrated
(kill the process / throw mid-loop in a test harness) → re-run the migration
→ assert every vendor row is present, not just the first. Simulate one
statement in the schema block throwing → assert the marker is NOT stamped and
the block re-runs on the next request.

**Owner:** `tlc-admin-worker.js` migration block + market migration
specifically.

---

### RP-08 — Automated backups and a documented restore drill

**Finding:** no automated D1/R2/Supabase backups, no retention schedule, no
restore script, no restore drill exist anywhere in this repo or its CI.

**Fix:**
1. **D1**: Cloudflare D1 supports point-in-time recovery on paid plans and
   `wrangler d1 export` for logical dumps. Add a scheduled GitHub Action
   (daily) that runs `wrangler d1 export --output backup-$(date).sql` for
   both `tlc-newsletter-db` and `tlc-volunteer-db`, and uploads the result to
   a separate, access-controlled R2 bucket or external object store (not the
   same bucket serving public images — a compromise of one shouldn't
   compromise the backup).
2. **R2**: enable R2 bucket versioning if available, or a periodic `rclone`/
   `aws s3 sync`-style mirror to a second bucket, since R2 holds uploaded
   images and public council documents that have no other copy.
3. **Supabase**: Supabase Pro+ plans include automated daily backups with
   point-in-time recovery; confirm the project tier and enable/verify this
   is on. This is outside this repo (it's a Supabase project setting), so
   it's a manual step to confirm — flagged the same way `TURNSTILE_SECRET_KEY`
   and other manual steps are flagged elsewhere in CLAUDE.md.
4. **Restore drill**: quarterly, someone actually restores a D1 export into
   a scratch database and confirms the app boots against it. Document the
   steps in a `docs/RESTORE.md` so this isn't tribal knowledge.
5. Add a "Backups" card to the security status screen (RP-20, mockup) showing
   last successful backup timestamp per store and last restore-drill date.

**Acceptance test:** the backup Action runs successfully in CI on a schedule
and produces a non-empty artifact; a restore drill is performed once and
`docs/RESTORE.md` is written from the actual steps taken (not written
speculatively).

**Owner:** infra/CI owner. This is the largest net-new piece of work in the
plan and has no code dependency on anything else — can start immediately.

---

### RP-09 — Atomic booking/invoice creation; archive instead of hard-delete for financial records

**Finding:** `admin/gym.js` deletes a gym group's invoices, bookings and
recurrences permanently with no audit entry or soft-delete. Booking creation
inserts sequentially before creating the invoice — a mid-loop failure leaves
orphaned bookings with no invoice.

**Fix:**
1. **Atomicity**: wrap the booking-then-invoice sequence in `env.DB.batch()`
   where the statements are independent inserts that must all land together,
   or restructure so the invoice is created first (with a pending/draft
   state) and bookings reference it, so a partial failure is visibly
   incomplete rather than silently missing its invoice.
2. **Soft-delete for financial records**: `gym_groups`, `gym_invoices` gain a
   `deleted_at` / `voided_at` column. "Delete" in the UI becomes "Archive" —
   the row is hidden from active views but retained, and reversible.
   Genuine hard-delete (e.g., a true data-entry mistake with no financial
   history) requires a second confirmation and is logged to `audit_log` with
   the row's content preserved there (mirroring how registration delete
   already logs the row — the difference from RP-04 is that gym financial
   records generally don't carry the same PII-sensitivity class, so no
   redaction is needed here, just the audit copy).

**Acceptance test:** simulate a failure between booking insert and invoice
insert → assert the transaction leaves no orphaned booking (rolled back) or
that the invoice-first ordering means the booking is provably tied to a
draft invoice. Delete a group via the UI → assert its invoices/bookings are
still queryable (marked archived), and only a second, explicit hard-delete
path removes them, which is audit-logged.

**Owner:** `admin/gym.js`. **[MOCKUP FIRST]** for the archive/void UI (the
assessment's "UI improvements" section explicitly asks for this).

---

### RP-10 — Pin the TinyMCE asset source instead of proxying mutable `main`

**Finding:** `tlc-admin-worker.js`'s `/assets/tinymce/` route proxies
`raw.githubusercontent.com/.../main` at request time. A change to that
upstream `main` branch — accidental or malicious — reaches every admin
browser without a Cloudflare deploy on this side.

**Fix:** the existing route already versions by path segment
(`/assets/tinymce/7.9.3/...`) per the CLAUDE.md history — the gap is that it
proxies `main` rather than a tag/commit pinned to that version. Change the
upstream fetch to a specific commit SHA or release tag matching `7.9.3`
(GitHub raw content supports fetching by SHA:
`raw.githubusercontent.com/<owner>/<repo>/<sha>/...`), so the version in the
URL and the version actually served are the same guarantee. Alternatively,
and more robustly: vendor the exact files into this repo under
`admin/vendor/tinymce/` (the CLAUDE.md history references this directory
already existing for the same library) so there is no runtime dependency on
GitHub's raw content service at all.

**Acceptance test:** `test/tinymce-selfhost.test.mjs` (already exists per
CLAUDE.md) is extended to assert the proxied URL contains a commit SHA/tag,
not a branch name, or — if vendored — that no outbound fetch happens at all
during a full editor boot (a variant of the existing "no request leaves the
origin" assertion).

**Owner:** `tlc-admin-worker.js` TinyMCE asset route, or a one-time vendoring
commit under `admin/vendor/tinymce/`.

---

## Track C — Account & access security

### RP-11 — MFA or SSO for administrative accounts

**Finding:** no MFA, no identity-provider login, despite access to payroll,
prayer content and (per Track A) child-related event data.

**Fix, in order of effort:**
1. **TOTP-based MFA** (lowest lift): add a `totp_secret` column to `users`,
   a setup flow (QR code, standard `otplib`-equivalent implemented by hand
   since this Worker avoids npm deps for crypto elsewhere — see
   `admin/webpush.js`'s hand-rolled RFC 8291 as precedent for "we implement
   the spec ourselves in Workers"), and a second factor prompt after
   password on login. Gate this behind a per-account or global "MFA
   required" setting so it can be rolled out to `payroll_manage`/
   `sensitive_data_view` holders first.
2. **Longer-term**: SSO via a Cloudflare Access policy in front of
   `admin.timothystl.org` is likely the lowest-maintenance option given this
   is already a Cloudflare Workers deployment — Access can require a second
   factor or a managed identity provider (Google Workspace, if the church
   uses one) with zero application code changes, at the cost of losing the
   custom login/permission UI's control over *who* can be added (Access
   would need its own allowlist synced with `users`).

**Recommendation:** start with Cloudflare Access in front of the admin
origin as the fastest, lowest-code path to real MFA, keeping the app's own
session/permission system as the authorization layer underneath it (Access
authenticates *who*, this repo's permissions decide *what*). Revisit
in-app TOTP only if Access doesn't fit the office's actual identity setup.

**Acceptance test:** an unauthenticated request to any `/admin.timothystl.org`
path is challenged for a second factor before reaching the app; a session
established without completing the second factor cannot reach any
`payroll_manage`-gated route.

**Owner:** infra decision first (Access vs. in-app TOTP — needs Andrew/Dinger
input on whether Cloudflare Access fits how staff actually authenticate
today), then implementation.

---

### RP-12 — Rate-limit and hash password reset tokens

**Finding:** `/forgot-password` has no rate limit; tokens stored plaintext;
older unused tokens remain valid after a new request.

**Fix:**
1. Hash tokens at rest the same way session tokens already are (this repo
   already has a `timingSafeEqual`/hash pattern in `admin/auth.js` — reuse
   it rather than inventing a second one).
2. On a new reset request for an address, invalidate all prior unused tokens
   for that address (`DELETE FROM password_resets WHERE email = ?` before
   inserting the new one).
3. Rate-limit `/forgot-password` the same way login already is (IP-based,
   per the existing `audit_log`-row-counting pattern), plus a per-address
   limit so hammering one account's reset doesn't just rotate IPs.

**Acceptance test:** two reset requests for the same address → assert only
the second token validates. Flood `/forgot-password` → assert it starts
refusing after the same threshold login already uses.

**Owner:** `tlc-admin-worker.js` password reset routes.

---

### RP-13 — Account-aware login throttling; remove the enumeration timing gap

**Finding:** login throttling is IP-only; a nonexistent username skips the
password hash entirely, creating a timing signal for username enumeration.

**Fix:**
1. Run a dummy PBKDF2 hash (same iteration count) when the username doesn't
   exist, so the response time is indistinguishable from a real
   wrong-password attempt.
2. Add a per-username failure counter alongside the existing per-IP one;
   lock out (or require a delay) after N failures for that username
   regardless of source IP.

**Acceptance test:** measure response time for a nonexistent username vs. a
real username with a wrong password → assert they're within a small,
consistent tolerance. Flood one username from rotating IPs → assert it's
throttled.

**Owner:** `tlc-admin-worker.js` login route, `admin/auth.js`.

---

## Track D — Correctness & performance (moderate priority, lower risk)

These don't carry the same urgency as Tracks A–C but are cheap enough that
they can be picked up opportunistically by whoever's already in that file.

| Code | Finding | Fix |
|---|---|---|
| RP-14 | Held form submissions retained indefinitely | Add a cap (e.g., 1 year) with a "review before this expires" nudge on the Filtered Mail badge, since held mail is deliberately not auto-pruned today (by design, per CLAUDE.md) — this needs a policy call on the exact cutoff, not just code. |
| RP-15 | Confirm Turnstile is actually configured in production | One `wrangler secret list` check; this repo's own CLAUDE.md already flags `TURNSTILE_SECRET_KEY` as an unfinished manual step (FX-05) — verify it's done. |
| RP-16 | Event capacity race (read-then-insert) | `SELECT ... FOR UPDATE`-equivalent isn't available in D1; use a D1 transaction (`env.DB.batch`) with a `CHECK` constraint or a post-insert re-verify-and-rollback pattern, mirroring the gym slot's partial-unique-index approach where a real constraint can express the rule. |
| RP-17 | Gym overlap race (only exact-duplicate slots are indexed) | Since overlap can't be expressed as a unique index, add an application-level re-check inside a transaction immediately before commit, accepting a small residual race window is now milliseconds instead of the full request. |
| RP-18 | `gym_invoices` money as float | Migrate `total_hours`, `rate`, `total_amount` to integer (cents / minutes) — same shape as `admin/db.js`'s newer `site_event_registrations` columns. Needs a migration + a sweep of every read/write site (this file's own DSN-5 finding). |
| RP-19 | Payroll's Supabase schema/RPCs/grants live outside version control | Export the current schema (`pg_dump --schema-only`) and RPC definitions into `supabase/` in this repo (or a linked ops repo) so they're reviewable and diffable, matching how everything else in this codebase is source-controlled. |
| RP-20 | Voters' documents rely on obscurity, not auth | Policy call, not a bug — needs a decision from Andrew whether `/voters` should require a login. If yes, gate behind the existing session system with a narrow `voters_view` permission; if no, keep `X-Robots-Tag: noindex` (already done per FX-12) and document the decision in CLAUDE.md the way FX-12 already documents the reasoning. |
| RP-21 | Batch gym slot validation instead of per-slot queries | Already scoped as FX-23 in this repo's own review — one query for blocked dates in range, one for conflicts in range, instead of two per submitted slot. |
| RP-22 | Bound unbounded admin reads (gym dashboard scans, media screen) | Already scoped as FX-22/FX-32 — add date bounds and `LIMIT`s. |
| RP-23 | `parentName()` O(n²) | Already scoped as FX-35 — swap to a `Map`. |
| RP-24 | Schema work runs in the request path on cold isolates | Already scoped as FX-40 — this is a larger structural project (moving migrations out of the hot path entirely, e.g. via a one-time deploy hook) and should stay its own effort. |
| RP-25 | Duplicate indexes, dead scheduler code, stale `PROJECT-PLAN.md` | Housekeeping — batch into one cleanup PR once the higher-priority tracks are underway, so it doesn't compete for review attention with security fixes. |
| RP-26 | Add a small Playwright smoke suite to CI | The browser suites (`test/editor.test.mjs`, `test/public-page.test.mjs`, etc.) already exist but are deliberately excluded from CI per `.github/workflows/test.yml`. Pick the 5–10 highest-value ones (login flow, publish flow, a payment path) and add them to CI as a fast smoke pass, leaving the full browser suite as a manual/pre-release check. |

---

## UI improvements requiring a mockup before implementation

Per the assessment, these four need a design pass first — listed here so
they're tracked alongside their code counterparts above rather than lost:

1. **Sensitive-information drawer** (RP-03) — permission-scoped reveal +
   download controls, with an audit trail on every reveal.
2. **Archive/void workflows** (RP-09) — replacing permanent-delete buttons
   for invoices, registrations, and rental groups with reversible archive
   states.
3. **Backup/security status screen** (RP-08, RP-11, RP-15) — last successful
   backup per store, last restore-drill date, Turnstile status, MFA status,
   and push-notification audience scope, all in one admin screen so this
   isn't tribal knowledge.
4. **Export/download warnings** — a visible banner whenever an export or
   view contains child, medical, or financial data, distinct from the
   ordinary "Exported" toast this admin already uses.

---

## Sequencing

```
Week 1        RP-06 (fix red test) → RP-05 (gate deploy on tests, protect main)
Week 1-2      RP-01 (push scoping) — small, high-value, no design needed
Week 1-2      RP-08 (backups) — starts immediately, no code dependency
Week 2-3      RP-10 (pin TinyMCE), RP-12, RP-13 (auth hardening)
Week 2-4      RP-07 (transactional migrations)
Week 3-5      [MOCKUP] RP-02/RP-03 sensitive-data UI → implement
Week 3-5      [MOCKUP] RP-09 archive/void UI → implement
Week 4-6      RP-04 (audit redaction), RP-11 (MFA/Access — needs a decision first)
Ongoing       Track D items, picked up opportunistically
```

Tracks A and B should not wait on each other — they touch almost entirely
different files. Track C's MFA item (RP-11) is the one item genuinely
blocked on a decision (Access vs. in-app TOTP) rather than on code, so it's
worth raising that question with Andrew/Dinger early even though
implementation lands later.

---

## What "done" looks like for this plan

- Every RP-nn item above has a merged PR referencing its code, with the
  acceptance test described (or a stronger one) actually in the suite and
  passing.
- `test/admin-redesign.test.mjs` and the full `admin/*.test.mjs` set are
  green, in CI, gating every deploy (RP-05, RP-06).
- The security status screen (mockup item 3) shows every item in this plan's
  Track A–C as either "done" or "not applicable," in one place, so this
  becomes a living record rather than a document that goes stale the way
  several sections of `CLAUDE.md` are noted to have gone stale in the past.
