<!-- SPDX-License-Identifier: Apache-2.0 -->

# @aphrody/bun-test-dom

Shared Bun test preload for happy-dom. It registers DOM globals and restores
Bun's native fetch, request, response and abort primitives so network tests and
`Bun.serve` keep Bun-compatible behavior.

This package is the generic happy-dom host for Aphrody Bun workspaces. The
former IECODE `@nie/plugin/happydom` compatibility re-export was removed with
the unqualified IECODE staging packages. This package has no runtime native or
game-data dependency.
