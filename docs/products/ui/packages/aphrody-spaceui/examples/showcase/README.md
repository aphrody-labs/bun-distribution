<!-- SPDX-License-Identifier: MIT -->
# SpaceUI showcase migration

The runnable upstream demo was migrated to the maintained Bun example at
[`examples/m3-spaceui-showcase`](../../../../examples/m3-spaceui-showcase). Its components are
now imported from the first-party `@aphrody/m3-*` packages; this directory is kept as a migration
pointer inside the MIT reference tree.

From the repository root, run:

```sh
bun run --filter @aphrody/m3-spaceui-showcase dev
bun run --filter @aphrody/m3-spaceui-showcase build
```

The original source is available in the repository's Git history and upstream at
[`spacedriveapp/spaceui`](https://github.com/spacedriveapp/spaceui).
