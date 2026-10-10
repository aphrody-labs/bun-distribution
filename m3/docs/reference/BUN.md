<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bun workspace policy

The repository root is the package-manager boundary: Bun 1.4.2, the sole text lockfile
(`bun.lock`), workspace globs, default and `drive` catalogs, and global overrides are
declared in root `package.json`. `drive/` contributes selected packages to that root
workspace; its upstream root manifest is retained for provenance and is not a second
install root. Maintained Base UI and Tailwind forks remain active workspaces.

Root `bunfig.toml` requires the isolated linker with its fallback hoist tree disabled,
preserves the text lockfile, and rejects new resolutions younger than three days.
`trustedDependencies` in the root manifest is the install-script allowlist. Bun's
explicit allowlist replaces its built-in trust list, so add a package only after
reviewing its lifecycle scripts. Workspace manifests should declare every imported
dependency; use `bun run bun:check` to enforce the version, catalog, script and install
contracts.

The workspace globs define the package boundary: first-party packages, examples, Drive's web
app and scripts, plus the maintained Base UI and Tailwind forks. Provenance-only and
incompatible Drive packages are excluded explicitly. Keep local package edges on
`workspace:*`; use the default catalog for shared versions and the named `drive` catalog
for Drive's intentionally separate React/toolchain family. Use root `overrides` only for
required transitive fixes or local compatibility packages.

## Daily commands

```sh
bun install --frozen-lockfile
bun run bun:lock-check
bun run bun:check
bun run monorepo:audit
bun run build
bun run typecheck
bun run audit:knip
bun run audit:imports -- --workspace @aphrody/app-ui
bun run bun:audit
bun run bun:licenses
```

For a single workspace, pass Bun's `--filter` to install, add, remove, update or run
commands. Add commonly shared versions to the appropriate root catalog:

```sh
bun add some-package --filter @aphrody/app-ui --catalog
bun add app-specific-package --filter @aphrody/app-ui
bun remove app-specific-package --filter @aphrody/app-ui
bun outdated --filter '@aphrody/*'
```

`bun:lock-check` is the CI install gate: it requires the committed lockfile to resolve
without changing it. Use `bun dedupe --dry-run` to inspect duplicate versions and review
the lockfile diff after deduplication. `bun:audit` reports high and critical registry
advisories; use `bun audit --json` for a machine-readable report. `bun:licenses` exports
the installed dependency license inventory as JSON. These are review inputs, not automatic
dependency updates.

`monorepo:audit` runs the workspace contract, frozen lockfile check, vulnerability scan,
Knip dependency analysis, and TypeScript AST import inventory together. Independent checks
run in parallel (three at a time by default); failures retain each tool's output and produce
a nonzero exit status. Use `--only knip,imports`, `--jobs 1`, or `--json` to scope the run or
consume its report from automation. Each child runs with an argument vector and a 15-minute
timeout. CI gates the workspace contract and high/critical security scan after its frozen
install; the full local audit also includes Knip and the import inventory.

`bun run monorepo:compile` builds a standalone audit executable at
`target/aphrody/monorepo-audit` (not in repo). The workspace contract uses Bun's filesystem, glob and TOML
APIs in-process. The compiled binary can also search its embedded Bun documentation snapshot
offline with `--docs <terms>`; refresh or verify that snapshot with `bun run bun:docs:fetch`
and `bun run bun:docs:check`. Lockfile, registry security, Knip and import analysis still
need the checkout and a separate Bun CLI; set `BUN_BINARY` or pass `--bun <path>` if Bun is
not on `PATH`. Pass `--root <path>` when launching outside the checkout. The standalone
build bundles the Bun runtime and imported code, not the repository or external audit tools.

The embedded reference includes the official [Bun native APIs](https://bun.com/docs/runtime/bun-apis),
[child processes](https://bun.com/docs/runtime/child-process),
[workspaces](https://bun.com/docs/pm/workspaces), and
[standalone executable](https://bun.com/docs/bundler/executables) documentation. Bun's
runtime APIs cover filesystem, process, build and package-manager integration; inference
belongs to Aphrody's Rust AI service/CLI rather than a Bun AI runtime API.

For a workspace and its dependents, use Bun's recursive filter syntax, for example
`bun run --filter '@aphrody/m3-primitives^...' typecheck`. Use `--filter` with `bun add`,
`bun remove`, `bun update`, and `bun outdated` to scope changes. Before publishing a package
that uses catalog protocols, inspect `bun pm pack --dry-run`; Bun replaces catalog references
with concrete versions in the packed manifest.

Use `workspace:*` for local package edges and `catalog:` for shared versions. Keep
intentional version families such as Drive's React 18 client in the named `drive`
catalog. Do not run a nested install in a vendored fork or in `drive/`; installs and
lockfile changes are managed from this repository root. CI uses the version pinned in
`package.json` and a frozen lockfile install.
