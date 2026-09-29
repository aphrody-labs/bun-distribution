<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/bun-test-dom

Shared Bun test preload for happy-dom. It registers DOM globals and restores
Bun's native fetch, request, response and abort primitives so network tests and
`Bun.serve` keep Bun-compatible behavior.

The IECODE compatibility package `@nie/plugin/happydom` re-exports this entry
while existing consumers migrate. The package is private and has no runtime
native or game-data dependency.
