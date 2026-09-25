# Product versioning reset

Baseline: September 24, 2026 — `0.1.0-alpha.1` for each product. Website, Connect, Finance, and myMDO have independent release sequences. myMDO Parent, Staff, Admin, Clock-In, Room, and Calendar are one product and share its version.

The baseline describes product maturity, not a database reset or proof that every workflow is complete. `0.x.x-alpha.n` means active development; `0.x.x-beta.n` means the architecture is settling and real-use validation continues; `1.0.0` is an intentional stable declaration. Within a prerelease series, increment the final number on a routine release (for example `0.1.0-alpha.2`). Increment the minor number for a meaningful new capability. After 1.0.0 use patch for fixes, minor for compatible features, and major for breaking changes.

A lower display version after this reset is deliberate. Never compare a release with a version from before September 24 by numeric precedence. Old tags, evidence, migrations, and Git history remain intact for diagnosis, but current docs and UI use the new lineage. Do not rename applied migrations or reset database ledgers. Do not rewrite Git history. Use a commit SHA / platform deployment identifier to identify an exact deployed build. Android `versionCode` and iOS `CFBundleVersion` must keep increasing once published; a store listing's human-readable version must also comply with that store's current submission rules. Existing Android packaging manifests are prototypes and no signed store build is claimed.

Caching: any reset must change the effective cache key and should distinguish the exact deployment when assets may change without a product-version increment. A rollback to an older commit is identified by its deployment SHA, regardless of the displayed version.

Website's serialized release workflow increments the Admin alpha suffix and deploys Site, Admin, and Links together. The release commit SHA is its exact identity. The public Site and Links Workers do not expose independent product counters.
