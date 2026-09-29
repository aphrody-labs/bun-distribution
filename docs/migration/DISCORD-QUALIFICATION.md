<!-- SPDX-License-Identifier: Apache-2.0 -->

# Discord qualification from the Aphrody root

Run `bun run discord:verify` at the repository root. The command checks all
2,232 source snapshot files against their recorded SHA-256 values, performs a
frozen install of the nested Discord workspace, then runs its format, lint,
build, typecheck, test, and external messaging package smoke checks. It also
typechecks, tests, and builds the root `@aphrody/messaging` package.

The independent source workspace lives at `upstream/discord` and remains byte-identical to `aphrody-discord` HEAD
`959abfab4d026eed23aa038c7a78d97fc2837fac`. Bun places the declared
`@typescript/typescript6` dependency under `packages/ui/node_modules`; the
verification command exposes that locked copy at the nested workspace root so
`unplugin-dts` can resolve the JavaScript compiler API. This creates only a
link in ignored `node_modules` and does not modify the source manifest or lock.

On 2026-09-29, `bun run discord:verify` passed: 39 build tasks, 61 typecheck
tasks, 39 test tasks, the nested external messaging package smoke check, and
the root messaging package's nine tests, typecheck, and build. The copied
source's `@discordjs/rest` tests reported 103 passed and one skipped.

These checks qualify the copied code and package build. Consumer cutover,
the root workspace closure, the real Discord OAuth consent callback, production
permission profile, clean-clone release packaging, and deployed SHA/rollback
proof remain separate release gates. Shenron's production bot and site continue
to run from their current source and release paths until those gates pass.
