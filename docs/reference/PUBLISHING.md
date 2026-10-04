<!-- SPDX-License-Identifier: Apache-2.0 -->
# Publishing the `@aphrody/*` Material 3 packages

The first-party M3 packages publish to the public npm registry (`registry.npmjs.org`) under the
`@aphrody` scope. The publish path is
`release-m3-packages.yml`, triggered by an
`m3-v*` tag or `workflow_dispatch`. GitHub Actions is disabled on the `aphrody-code`
organization (see the root [`README.md`](../products/README.md)), so the same steps are run locally.

## Steps

1. Check out `aphrody-ui` with its sibling repositories next to it (see the root README).
2. `bun install --frozen-lockfile` and `bun run bun:check` (lockstep `aphrody.m3Version`).
3. `bunx turbo run build --filter='./packages/*'` (`examples/*` excluded).
4. `bun publish --access public --registry https://registry.npmjs.org` in dependency order.
   `bun publish` inlines every `workspace:*` dependency with its resolved version.

npm rejects re-publishing an existing version: bump the manifests first (`bun run bun:fix` keeps
the M3 family on `aphrody.m3Version`), commit, then `git tag m3-v<version>` and push the tag.

## Packages

| In-tree | Published as |
| --- | --- |
| `packages/canvas` | `@aphrody/canvas` (own version `<upstream>-aphrody.<n>`, see its README) |
| `packages/material-web` | `@aphrody/material-web` |
| `packages/m3-react` | `@aphrody/m3-react` |
| `packages/m3-motion` | `@aphrody/m3-motion` |
| `packages/m3-theme` | `@aphrody/m3-theme` |
| `packages/m3-primitives` | `@aphrody/m3-primitives` |
| `packages/m3-forms` | `@aphrody/m3-forms` |
| `packages/m3-explorer` | `@aphrody/m3-explorer` |
| `packages/m3-ai` | `@aphrody/m3-ai` |
| `packages/m3-design` | `@aphrody/m3-design` |
| `packages/eslint-plugin-m3` | `@aphrody/eslint-plugin-m3` |
| `packages/m3` | `@aphrody/m3` |

Published elsewhere: `@aphrody/m3-tokens` from `aphrody-web` (`packages/m3-tokens`, consumed here
through the root `catalog`). `@aphrody/bun` (`packages/bun`, native crate `crates/ui/bun`) is
not in the workflow's publish list. `build:sass` falls back to
`sass-embedded` when the native library is absent, so a release needs no Rust toolchain.

## Secrets

- `NPM_TOKEN`: automation token of the `@aphrody` npm org.
- `APHRODY_CI_TOKEN`: read access to the private sibling repositories.

Consumers need no registry override: `bun add @aphrody/material-web @aphrody/m3-react`.
