# Security

Website Admin uses per-user capabilities; role presets are conveniences, not authorization.
Server-side checks protect publishing, newsletter, settings, Giving, payroll, permissions, rental,
Market, media, and audit operations. Public endpoints must expose only deliberately public data.

Website Admin supports a staged shared-staff identity exchange. When
`WEBSITE_ACCESS_TEAM_DOMAIN` and `WEBSITE_ACCESS_AUD` are configured, `/access-login` (and the
normal signed-out root/login route) independently verifies Cloudflare's Access JWT and maps its
lowercased email to an existing active `users` row. It never creates a user and never takes
capabilities from Access. The resulting `tlc_session` remains Website-owned; permission changes or
deactivation are read live from `users` on the next request.

Before enabling an Access application on an Admin hostname, use the church Google Workspace IdP,
limit any non-Workspace exception to a named email allowlist (never `Everyone`), set the Access
session to one hour or less, verify each authorized Website user has the correct email, and test
deactivation plus password recovery/break-glass paths in staging. Offboarding requires disabling
the IdP account and revoking the person's Access session; local Website deactivation remains the
immediate authorization backstop.

TinyMCE is self-hosted under `admin/vendor/tinymce/`. Do not add a cloud key, paid cloud load, or
CDN dependency. Credentials belong in GitHub/Cloudflare managed secrets, never source or docs.

Protect subscriber, contact/prayer, renter, vendor, gift, payroll, authentication, and audit data.
Do not include those values in issues or logs. The `CONNECT_WORKER` binding is an intentional
narrow backend dependency; durable replay and bounded retries prevent silent loss without making
the Website authoritative for Connect data.

Authentication, capability, credential, payment, migration, binding, and public-route changes need
focused negative-path tests, rollback planning, and explicit production approval.
