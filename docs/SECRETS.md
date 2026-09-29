# Website Secrets and Settings Reference

Names and purposes only. **No secret value belongs in this file, in Git, in a test fixture, or in a
log.** Secrets are set with `wrangler secret put <NAME> --config <file>` or in the Cloudflare dashboard
(Workers, then the Worker, then Settings, then Variables and Secrets). GitHub Actions secrets live in
GitHub (repository Settings, then Secrets and variables, then Actions).

This file was derived from the code (`env.NAME` reads in `website-admin-worker.js`, `site-worker.js`,
`links-worker.js`, `admin/*.js`), the `wrangler*.toml` files, and `.github/workflows/*.yml`. It cannot see
what is actually stored in Cloudflare or GitHub; confirm each name in the dashboard. The cross-product
view, with the pairs that must hold identical values, is
[architecture/17-credentials-and-secrets-inventory.md](https://github.com/timothystl/digital-architecture/blob/main/architecture/17-credentials-and-secrets-inventory.md).
Release and rollback procedure: [OPERATIONS.md](OPERATIONS.md). Security model: [SECURITY.md](SECURITY.md).

**Naming rule.** New credentials are named `<PRODUCT>_<SERVICE>_<PURPOSE>` (for example
`WEBSITE_BREVO_API_KEY`). Existing names are not renamed: a pair that must match across products can only
change on both sides in one coordinated change.

Kinds: **secret** (never in Git), **plain var** (non-sensitive setting), **binding** (link to a Cloudflare
resource or Worker), **GH secret** (GitHub Actions secret).

## Which Worker reads what

| Worker | Config | Reads |
|---|---|---|
| `timothy-website` (`site-worker.js`) | `wrangler-site.toml` | Only the `ASSETS` binding. No secrets or vars. |
| `timothy-links` (`links-worker.js`) | `wrangler-links.toml` | Nothing from `env`. No bindings, secrets, or vars. |
| `timothy-website-admin` (`website-admin-worker.js`) | `wrangler.toml` | Everything below except GitHub Actions. |

The Worker names matter: Connect and Finance reach Website Admin by service binding, which resolves by
name. Renaming `timothy-website-admin` or `timothy-connect` silently breaks those calls.

## Bindings (Website Admin, in `wrangler.toml`)

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `DB` | binding, D1 `timothy-website-db` | Admin | Pages, users, sessions, forms, newsletters, gym, Market, outbox | Admin cannot run | `wrangler.toml` `[[d1_databases]]` |
| `IMAGES` | binding, R2 `timothy-website-images` | Admin | Uploaded images and media | Uploads and image serving fail | `wrangler.toml` `[[r2_buckets]]` |
| `ASSETS` | binding (static assets) | Site | Serves `public/` | Public site down | `wrangler-site.toml` `[assets]` |
| Cron `*/15 * * * *` | trigger | Admin | Promotes scheduled ministry pages | Scheduled pages publish late or never | `wrangler.toml` `[triggers]` |

## Connect service binding

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `CONNECT_WORKER` | binding to Worker `timothy-connect` | Admin (`admin/forms.js`, `admin/market.js`) | Forwards contact and prayer forms to Connect; Christmas Market volunteer roster and toggle | Forwards fail and retry from the outbox; the visitor sees no error. Volunteer toggle fails | `wrangler.toml` `[[services]]`; the target name must match Connect's Worker name |
| `CHMS_INTAKE_API_KEY` | secret | Admin (`website-admin-worker.js`, `admin/forms.js`, `admin/market.js`) | Sent as `X-Intake-Key` on calls to Connect's intake and Market endpoints. "CHMS" is a holdover name and is live | Empty key is sent; Connect rejects; forwarding retries | Generate a new random value, set it on both Website Admin and Connect (`CHMS_INTAKE_API_KEY`), same value |
| `ADMIN_PUSH_API_KEY` | secret | Admin (`POST /api/push/notify`) | Connect calls this push relay with `X-Push-Key` so sign-ups ring staff phones | Missing returns 503; wrong returns 401. Connect treats it as best effort; sign-ups still work | Set the same value on Connect (`ADMIN_PUSH_API_KEY`) and Website Admin |

## Brevo (newsletter and transactional email)

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `BREVO_API_KEY` | secret | Admin (`admin/email.js`, `admin/newsletter-schedule.js`, subscribe and subscriber-list code) | Newsletter send and scheduling, subscriber sync, transactional mail | Subscribe skips the Brevo add; scheduling reports "not configured"; the Subscribers view shows an error. Wrong key: Brevo calls return errors | Brevo, SMTP & API, API Keys; then `wrangler secret put BREVO_API_KEY --config wrangler.toml` |
| `BREVO_LIST_ID` | plain var (list number, not sensitive; set in the dashboard, not in `wrangler.toml`). Value is **4**, the full weekly newsletter list | Admin | List that subscribers are added to and that real newsletter sends and audience counts use | **No fallback, by design.** Signup fails with a logged error (visitor sees a generic failure); a live newsletter send shows a "not configured" error; audience count is skipped | Brevo, Contacts, Lists (ID column); set in Cloudflare Variables and Secrets |
| `BREVO_TEST_LIST_ID` | plain var. Value is **2**, the test list | Admin (`admin/newsletter.js`) | List used for "send test" | **No fallback, by design.** Test send shows a "not configured" error. Set it before sending a test issue | Same as above |
| `BREVO_SENDER_EMAIL` | plain var | Admin (`admin/email.js`, `admin/newsletter-schedule.js`) | From address for newsletters and transactional mail | Falls back to the office address hard-coded in the code. The sender must be verified in Brevo or sends are rejected | Brevo senders; Cloudflare Variables and Secrets |
| `BREVO_REPLY_TO` | plain var | Admin (same files) | Reply-To address | Falls back to `BREVO_SENDER_EMAIL`, then the hard-coded office address | Cloudflare Variables and Secrets |

Guard: `admin/brevo-list-config.test.mjs` fails if a hard-coded list fallback returns.

## Google Calendar

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `GCAL_SERVICE_ACCOUNT_EMAIL` | secret | Admin (`admin/gym.js`) | Service account identity used to write gym rental holds and read the private calendar | Gym holds and authenticated calendar reads report unconfigured | Google Cloud Console, IAM, Service Accounts; calendar must be shared with this account |
| `GCAL_PRIVATE_KEY` | secret | Admin (`admin/gym.js`) | Service account signing key (PEM; escaped newlines accepted) | Same as above. A key missing its BEGIN header is flagged by the gym diagnostics step | Create a new key for the service account, set it, then delete the old key in Google Cloud |
| `GCAL_API_KEY` | secret | Admin (`admin/calendar.js`) | API key fallback for reading public calendars when no service-account token is available | With neither token nor key the calendar returns no Google events and says it is unconfigured | Google Cloud Console, APIs and Services, Credentials (restrict to Calendar API) |

See [CALENDAR_GOOGLE_WORKFLOW.md](CALENDAR_GOOGLE_WORKFLOW.md) for the calendar workflow.

## Turnstile (spam check on public forms)

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `TURNSTILE_SECRET_KEY` | secret | Admin (`admin/forms.js`) | Server-side verification of the Turnstile token on contact and prayer forms | Check is turned off with no penalty. Wrong key: verification fails, which can score real submissions as suspect | Cloudflare dashboard, Turnstile widget for `timothystl.org`; then set the secret |

The matching Turnstile **site key** is public, is not a Worker variable, and is pasted into the Admin
"Extra protection" card (stored with site settings). Both halves must exist before anything changes.

## Cloudflare Access (shared staff sign-in)

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `WEBSITE_ACCESS_TEAM_DOMAIN` | plain var (not in `wrangler.toml`) | Admin (`admin/shared-staff-login.js`) | Access team domain used to verify the sign-in token | Shared sign-in returns 503; normal username/password login still works | Cloudflare Zero Trust, Settings, team domain |
| `WEBSITE_ACCESS_AUD` | plain var (not in `wrangler.toml`) | Admin (same) | Audience tag of the Access application | Same as above. Wrong value: token rejected (401) | Zero Trust, Access, Applications, Application Audience (AUD) tag |

Access only proves identity; an active Website Admin user row with a matching email is still required.
The Finance-related Access values are in the next section.

## Payroll and Finance relay

Finance calls Website Admin's payroll backend through its `PAYROLL_SERVICE` binding. Ownership stays with
Website.

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `FINANCE_PAYROLL_CONTRACT_KEY` | secret | Admin (`admin/payroll-contract-auth.js`) | Expected `X-Contract-Key` on Finance-relayed payroll and gym-income calls | Fails closed; Finance shows payroll and gym income as `not_configured`. Must equal Finance's `FINANCE_PAYROLL_CONTRACT_KEY` | Generate a random value; set on both Finance and Website Admin |
| `FINANCE_ACCESS_TEAM_DOMAIN` | plain var, in `wrangler.toml` | Admin (same file) | Team domain for verifying the `Cf-Access-Jwt-Assertion` header Finance forwards | Relay rejected | Edit `wrangler.toml` and deploy |
| `FINANCE_ACCESS_AUD` | plain var, in `wrangler.toml` | Admin (same file) | Comma-separated audiences: production Finance and staging Finance | Relay rejected for the missing environment | Edit `wrangler.toml` and deploy; values come from the Finance Access applications |
| `PAYROLL_PROXY_SECRET` | secret | Admin (`website-admin-worker.js`) | Sent as `p_secret` when payroll calls are proxied to myMDO's Supabase payroll functions, including the period-lock check | Empty secret is sent; Supabase answers "invalid secret" (the Worker detects and reports this). Must equal the secret myMDO's database functions expect | Set in Website Admin and in myMDO's database function configuration together |

## Web push (Admin)

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `VAPID_PUBLIC_KEY` | public value; set as a Worker variable or secret (confirm which) | Admin (`website-admin-worker.js`, `admin/webpush.js`) | Served to browsers to subscribe; used to sign push | Public-key endpoint returns 501; push disabled | Must be the public half of the keypair below |
| `VAPID_PRIVATE_KEY` | secret | Admin (`admin/webpush.js`) | Signs web push requests | Push silently sends nothing. Rotating it invalidates existing subscriptions | Generate a new VAPID keypair; set both halves together |

The push contact (`mailto:` office address) is hard-coded in `admin/webpush.js`, not a setting.

## Square (Christmas Market vendor payments)

Square is the only payment integration the Website Admin Worker reads. There are no Stripe settings, and
`give-stax-mockup.js` reads no `env` values (it loads Stax's public script; the giving backend and Stax
credentials belong to Connect, see Connect's `SECRETS.md`).

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `SQUARE_ACCESS_TOKEN` | secret | Admin (`admin/square.js`) | Creates per-vendor payment links | Falls back to static payment links | Square Developer dashboard, application credentials |
| `SQUARE_LOCATION_ID` | plain var or secret (not in `wrangler.toml`; confirm) | Admin (same) | Square location for payment links | Same fallback | Square Dashboard, Locations |
| `SQUARE_ENVIRONMENT` | plain var | Admin (same) | `sandbox` selects the sandbox host; anything else is production | Production is assumed. Sandbox credentials against production fail | Cloudflare Variables and Secrets |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | secret | Admin (same) | Verifies Square webhook signatures | Webhooks are rejected, so payments do not mark as paid | Square Developer dashboard, webhook subscription |

## GitHub Actions deploy and recovery

| Name | Type | Read by | What it does | If missing or wrong | Where to change |
|---|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GH secret | `deploy.yml` | Deploys Site, Admin, and Links Workers | Every push-to-main release fails; nothing deploys | Cloudflare, My Profile, API Tokens (Workers edit scope); update in GitHub |
| `CLOUDFLARE_ACCOUNT_ID` | GH secret | `migrate-d1-database.yml`, `migrate-images-r2.yml`, `verify-d1-recovery.yml`, `verify-r2-recovery.yml` | Cloudflare account identifier (an ID, not a credential by itself) | Migration and recovery workflows fail | Cloudflare dashboard, account home |
| `CLOUDFLARE_D1_API_TOKEN` | GH secret | `migrate-d1-database.yml`, `verify-d1-recovery.yml` | D1 export and import for data copy and recovery drills | Those workflows fail; releases unaffected | Cloudflare API Tokens (D1 scope) |
| `CLOUDFLARE_R2_API_TOKEN` | GH secret | `migrate-images-r2.yml`, `verify-r2-recovery.yml` | R2 bucket access for image copy and recovery drills | Those workflows fail; releases unaffected | Cloudflare API Tokens (R2 scope) |
| `R2_RECOVERY_ACCESS_KEY_ID`, `R2_RECOVERY_SECRET_ACCESS_KEY` | GH secret (pair) | `migrate-images-r2.yml`, `verify-r2-recovery.yml` | S3-compatible R2 credentials for image recovery | Image copy and recovery verification fail | Cloudflare, R2, Manage API Tokens; replace both together |

`RELEASE_SHA`, `EXPECTED_SHA`, and the `*_REASON` values in the workflows are run inputs, not secrets.

## Discrepancies

Compared against [document 17](https://github.com/timothystl/digital-architecture/blob/main/architecture/17-credentials-and-secrets-inventory.md)
(compiled September 29, 2026).

**In code but not in doc 17's Website section**
- GitHub Actions names: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_API_TOKEN`,
  `CLOUDFLARE_R2_API_TOKEN`, `R2_RECOVERY_ACCESS_KEY_ID`, `R2_RECOVERY_SECRET_ACCESS_KEY`. Doc 17 defers
  these to the resource registry. Every `env.` name read by the three Workers is in doc 17.
- The hard-coded push contact and default sender address are code constants, not settings.

**In doc 17 but not confirmed by code**
- None missing. Doc 17 lists no Website name the code does not read. Doc 17's statement that
  `timothy-website` and `timothy-links` read nothing (except `ASSETS`) matches the code.

**Stale statements in doc 17 to correct**
- "Findings to act on" item 1 (subscribe falls back to list 2, sends to 0) is out of date. Current code has
  no fallback for `BREVO_LIST_ID` or `BREVO_TEST_LIST_ID`; a missing value errors. Its Website table row
  "Fallbacks differ" is also stale. List numbers: full list 4, test list 2.
- Its `BREVO_API_KEY` row says a missing key makes subscribe skip Brevo. True for the form-release path;
  the direct newsletter signup path fails with an error when `BREVO_LIST_ID` is missing.
- `BREVO_LIST_ID` and `BREVO_TEST_LIST_ID` are described as "not in Wrangler; confirm which" (var or
  secret). Still true, and unresolved here: the code error messages call them "secret", but they are list
  numbers and may be plain variables. A deploy that replaces dashboard variables could wipe them; confirm.

**Still unverified (dashboard check needed)**
- Whether `BREVO_LIST_ID`, `BREVO_TEST_LIST_ID`, `BREVO_SENDER_EMAIL`, `BREVO_REPLY_TO`,
  `SQUARE_LOCATION_ID`, `WEBSITE_ACCESS_*`, and `VAPID_PUBLIC_KEY` are set as variables or secrets, and
  that the `wrangler deploy` in `deploy.yml` preserves them (it does not pass `--keep-vars`).
