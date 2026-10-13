# Bun app host

`@aphrody/bun-app-host` owns the standalone application HTTP transport. It
consumes the artifact manifest, native video adapter, and bounded process/hash
operations through their package APIs. Engines and artifact verification remain
with their existing owners.

Bun OS consumes this package from the sibling Bun Libraries checkout. Release
plans must pin and verify that owner checkout before building an application.
