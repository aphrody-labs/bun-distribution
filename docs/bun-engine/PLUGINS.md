# Bun plugins and binary loaders

`packages/bun-engine/src/plugins/consoles.ts` exposes one integrated `BunPlugin` per console family. Each plugin owns a virtual `bun-engine:<console>` module and publishes immutable capability metadata; implementations load through their declared owner.

`packages/bun-engine/src/plugins/formats.ts` exposes one `onLoad` plugin per binary format family. Matching ROM, disc, firmware, Android and WebAssembly files use Bun's native `file` loader, so a referenced artifact becomes an asset path and can be embedded by `bun build --compile` without decoding or copying it into JavaScript strings.

The canonical standalone build registers both catalogs. New formats must receive a distinct loader id, bounded extension list and test coverage.
