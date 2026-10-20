# Rose Griffon ownership

Rose Griffon product source, deployment scripts and product documentation are
maintained in the [canonical Rose Griffon repository](https://github.com/aphrody-labs/rosegriffon).
Bun OS no longer carries copies of its website, bots, Azalee, Achillea, shared
Rose Griffon packages or server crate.

Bun OS retains the Inagle libraries it owns. Its remaining direct integrations
use the public `@rosegriffon/assets`, `@rosegriffon/config`, `@rosegriffon/db`
and `@rosegriffon/i18n` packages at the versions declared in the root Bun
catalog.

Rose Griffon provides a tagged-release workflow for self-hosted Linux x64 and
Windows x64 binaries. The [binary workflow](https://github.com/aphrody-labs/rosegriffon/blob/main/.github/workflows/binaries.yml)
embeds the site's standalone build and publishes SHA-256 checksums. As of
2026-10-20, GitHub reports no latest release yet; use the [releases page](https://github.com/aphrody-labs/rosegriffon/releases)
when an artifact is published. Bun OS does not bundle a second copy of that
application or its source.
