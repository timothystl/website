# Security

Website Admin uses per-user capabilities; role presets are conveniences, not authorization.
Server-side checks protect publishing, newsletter, settings, Giving, payroll, permissions, rental,
Market, media, and audit operations. Public endpoints must expose only deliberately public data.

TinyMCE is self-hosted under `admin/vendor/tinymce/`. Do not add a cloud key, paid cloud load, or
CDN dependency. Credentials belong in GitHub/Cloudflare managed secrets, never source or docs.

Protect subscriber, contact/prayer, renter, vendor, gift, payroll, authentication, and audit data.
Do not include those values in issues or logs. The `VOLUNTEER_WORKER` binding is an intentional
narrow backend dependency; durable replay and bounded retries prevent silent loss without making
the Website authoritative for Connect data.

Authentication, capability, credential, payment, migration, binding, and public-route changes need
focused negative-path tests, rollback planning, and explicit production approval.
