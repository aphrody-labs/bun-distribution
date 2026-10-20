# Rose Griffon ownership

The committed ownership record assigns Rose Griffon product source, deployment
scripts and product documentation to the [canonical Rose Griffon repository](https://github.com/aphrody-labs/rosegriffon).
It states that Bun OS no longer carries tracked copies of the website, bots,
Azalee, Achillea, shared Rose Griffon packages or server crate. Check the
current working tree and source inventory before treating that statement as a
description of uncommitted local files.

Bun OS retains the Inagle libraries it owns. Its remaining direct integrations
use the public `@rosegriffon/assets`, `@rosegriffon/config`, `@rosegriffon/db`
and `@rosegriffon/i18n` packages at the versions declared in the root Bun
catalog.

The canonical repository defines a tagged-release workflow for self-hosted
Linux x64 and Windows x64 binaries. It builds and smoke-checks each executable,
then publishes SHA-256 checksums. See the [binary workflow](https://github.com/aphrody-labs/rosegriffon/blob/main/.github/workflows/binaries.yml)
and [releases page](https://github.com/aphrody-labs/rosegriffon/releases) for
the current artifact state. Bun OS does not bundle a second copy of that
application or its source.
