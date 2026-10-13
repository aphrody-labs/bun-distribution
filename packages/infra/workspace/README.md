# @aphrody/workspace

Bun automation boundary for Aphrody Infra. It uses a verified installed Infra
binary by default; `APHRODY_INFRA_BIN` selects one explicitly, and
`APHRODY_INFRA_BUILD_FROM_SOURCE=1` opts into a source build for development. It does not
reimplement infrastructure mutations: Rust owns services,
Git, SSH, deployment, VPN, OVH and secrets.

```bash
yolo workspace doctor --strict --json
yolo ops pipeline plan
yolo ops fleet
yolo ops n2b scan /path/to/project
yolo ops binaries
yolo ops binary aphrody-kernel --version
yolo ops packages status
yolo ops packages outdated --repo aphrody
yolo ops bridge status
yolo ops bridge rust aphrody-kernel --version
yolo ops infra doctor --strict --json
yolo ops infra quality plan --json
yolo ops infra quality lint --repo aphrody-infra --run
yolo ops orchestrate health
yolo ops imports-exports --root . --json
yolo ops monorepo-audit --root . --only imports --json
yolo ops bun-workspace --root . --json
yolo ops bun-upstream-docs --check
yolo ops monorepo-gate --root . --no-build
```

The `client` export is the typed fetch boundary for `aphrody-infra serve`.

`cargo-release-audit` inventories active Cargo members, publishing policy, path
and Git dependencies without a registry version, external paths, and divergent
direct registry requirements. The integrating agent supplies fresh metadata:

```bash
scripts/build/rust/cargo-serial.sh metadata --no-deps --format-version 1 > /tmp/cargo-metadata.json
yolo ops cargo-release-audit --metadata /tmp/cargo-metadata.json --out /tmp/cargo-release-audit.json
```

The audit never invokes Cargo, installs, publishes or changes a manifest.
`--check` returns an error for detected publishing restrictions, missing or
wildcard registry versions on normal/build dependencies, or unreadable manifests. A successful
audit does not prove release readiness: full resolution, registry availability,
package validation and scoped build gates remain the integrating agent's work.
Caret intersections respect Cargo's pre-1.0 rules; complex requirements remain
marked for review. Dev dependencies are inventoried separately because crates.io
does not require their registry fallback. Every manifest read has a SHA-256 in
the report so the observation can be compared after concurrent changes.

`fleet` reads the generated ecosystem and the pipeline catalogue, so the package
shows every catalogued Aphrody repository and its delivery stages without a
second registry. `n2b` forwards full Node-to-Bun migrations to the Aphrody N2B
CLI; it does not substitute the smaller read-only native scanner.

`binaries` discovers every present `aphrody*` and `n2b` executable in the
trusted local-bin and current workspace build outputs. `binary` dispatches only
to one of those discovered paths; it never executes an arbitrary `PATH` entry.

`packages` discovers catalogued first-party roots that declare or evidence Bun usage and carry a `bun.lock`. It uses Bun’s package manager for frozen installs, outdated dependency reporting and JSON audits. The default registry is the official npm registry; a workspace’s existing `.npmrc` or `bunfig.toml` registry remains authoritative.

`bridge` is the single Bun-to-Rust registry: it combines the declared Bun workspaces, verified Rust executables and the typed Infra API endpoint. `bridge rust` dispatches only to a discovered executable; `infra` keeps the source-aware Infra invocation, including its explicit `--root` argument.

`infra quality` reads declared `format`, `lint`, typecheck, test and build scripts from first-party package manifests. The Rust control plane selects the script; Bun is invoked only to run the selected application-owned check.

Les étapes d’audit et de correction peuvent être résolues ou lancées par le contrôleur Rust :

```bash
yolo ops infra quality audit --repo aphrody-ui --run
yolo ops infra quality audit --repo shenron --run
yolo ops infra quality fix --repo aphrody-ui --run
```

`imports-exports`, `monorepo-audit`, `bun-workspace`, `bun-upstream-docs` and `monorepo-gate` are reusable Bun modules. They centralize the UI AST inventory, audit dispatcher, Bun workspace contract, the Bun docs of the aphrody-labs/bun fork (read in place, commit pinned in `docs/reference/upstream-bun/SOURCE.json`), and the shared validation gate. The UI exposes them through its existing package scripts, which call `yolo ops`.

`automation-inventory --root ~/src --json` emits the current cross-repository automation catalogue and classification.

`automation-inventory --inline` lists inline Python, Bun and Node invocations (eval flags, stdin heredocs and spawn arrays) in tracked and non-ignored new files, outside Markdown and `docs/`. JSON is the default; `--markdown` renders the same report as a table. `--check` fails when a file is absent from `tools/config/inline-interpreters.baseline.json` or exceeds its recorded count. `--write-baseline` rewrites the counts and keeps the scope and reason recorded for each file. `monorepo-gate` runs the check whenever that baseline exists, including in no-build mode, and `.github/workflows/inline-interpreters.yml` runs it on every push and pull request without installing dependencies. Shell callers read Cargo routing from `build-factory status [--route]`.

`workspace-subsystem` publishes these read-only commands to agents through the kernel as MCP tools: `workspace_inline_inventory`, `workspace_build_factory_status`, `workspace_automation_inventory`, `workspace_binaries`, `workspace_fleet`, `workspace_bridges` and `workspace_iecode_source`. A single catalog serves `--list` (JSON), `--call <tool> [--args <json>]` (no kernel needed) and `--serve` (registration). Stopping the process removes the tools. `tools/config/systemd/user/aphrody-workspace-subsystem.service` keeps it registered. Install it alone with `yolo update systemd install aphrody-workspace-subsystem.service --apply`, then enable it with `systemctl --user`.

The consolidation command inventories current checkout heads, dirty paths, workspace manifests and documentation/script destinations without changing source repositories. Git checkouts listed in `tools/config/upstream-sources.json` are inventoried under `upstream-<id>` with their source revision and license note. Pass `--upstreams-only true` to refresh those roots and merge them into the existing source map without dropping its other roots or rewriting the Python map. Pass `--upstreams-root .cache/upstream` when the configured checkouts are in the workstation source directory. After reviewing `docs/migration/source-map.json`, `consolidation docs-import` copies only mapped documentation whose source hash still matches; it preserves conflicting target files and records exact duplicate aliases. `docs-import --upstreams-only true` limits copying and link rewriting to those external reference roots. Relative Markdown links to imported documents and verified local files are rewritten. File targets must have matching source and target hashes, recorded import hashes, or a matching Bun package identity. `consolidation scripts-import` copies categorized first-party scripts without executing them. Remaining asset/code links, reference-style links and missing or changed sources are recorded in target import reports and remain an open gate.

`consolidation submodules-inventory` records Gitlink pins, `.gitmodules` declarations, initialized nested heads and missing candidate roots without initializing a checkout. It also writes a linked map of tracked and untracked nested files with working-file SHA-256, Git index and HEAD object IDs, file classification, parsed Cargo, Bun/Node, Python and pnpm workspace declarations, and resolved member patterns. Nested files have no import target. It leaves `aphrody-ui` to its designated agent and does not inspect that checkout.

`consolidation infra-config-import` stages clean tracked Infra catalogs, systemd units and its Rust toolchain pin at the target root. It refuses a changed source or conflicting target, records source and target hashes, and reports path remaps and endpoint classes in `docs/migration/infra-config-import.json`. The current pipeline and Google stack source paths are transitional; deployed endpoint and unit values are preserved for a coordinated cutover.

`consolidation infra-scripts-import` stages the six clean tracked Infra scripts named by the copied systemd units under categorized `scripts/` paths. It rejects source hash changes and target conflicts, then records the copies in `docs/migration/infra-scripts-import.json`. Copied script defaults and deployed unit paths still need runtime qualification.

`consolidation source-licenses-import` preserves root LICENSE, NOTICE and COPYING files from pinned non-UI source Git commits. It checks each worktree against the pinned blob, records raw and filtered hashes, and gives byte-identical files one canonical target with aliases in `docs/migration/source-licenses-import.json`. Missing root licenses and nested package licenses remain separate migration gates.

`aphrody-packages prepare` publishes content-addressed archives of `@aphrody/*` packages for consumers outside this workspace: IECODE pins them in `config/aphrody-packages.json` and installs them through its `install:workspace` script.

`shenron` is the Shenron facade over its Aphrody workspaces and the Infra control plane in this monorepo. `shenron status` and `shenron scripts` enumerate the nine active workspaces and their declared commands; `shenron check` runs those commands by workspace; `shenron audit` applies the shared script policy to app, package, and operations script roots. `shenron infra`, `shenron service`, `shenron dev-env`, and `shenron deploy` use the Rust Infra bridge; deploy selects the Shenron stack and remains plan-only unless `--apply` is supplied. `shenron migrate inventory` builds the shared source map; `shenron migrate docs|scripts` uses its importers scoped to Shenron. Run inventory first; imports validate source hashes and preserve conflicts. `shenron migrate infra` reuses Infra's service-script importer. The canonical service, topology, and route catalogs are in the repository-root `config/`; release orchestration is owned by `crates/infra/infra`. See [Infra product docs](../../../docs/products/infra/README.md), the [Infra plan](../../../docs/plans/infra/PLAN.md), and the [generated ecosystem catalog](../../../docs/ecosystem/ECOSYSTEM.md).

```bash
yolo ops shenron status
yolo ops shenron check lint
yolo ops shenron migrate inventory
yolo ops shenron service catalog
```

```bash
yolo ops consolidation inventory --source-root ~/src --iecode-root ../iecode --aphrody-root . --python-root ../aphrody-py
yolo ops consolidation submodules-inventory --source-root ~/src --iecode-root ../iecode --aphrody-root . --python-root ../aphrody-py
yolo ops consolidation infra-config-import --source-root ~/src --aphrody-root .
yolo ops consolidation infra-scripts-import --source-root ~/src --aphrody-root .
yolo ops consolidation source-licenses-import --source-root ~/src --aphrody-root .
yolo ops consolidation docs-import --source-root ~/src --iecode-root ../iecode --aphrody-root . --python-root ../aphrody-py
yolo ops consolidation inventory --source-root ~/src --upstreams-root .cache/upstream --iecode-root ~/iecode --aphrody-root ~/aphrody --python-root ~/aphrody-py --upstreams-only true
yolo ops consolidation docs-import --source-root ~/src --upstreams-root .cache/upstream --iecode-root ~/iecode --aphrody-root ~/aphrody --python-root ~/aphrody-py --upstreams-only true
yolo ops consolidation scripts-import --source-root ~/src --iecode-root ../iecode --aphrody-root . --python-root ../aphrody-py
```

## Infrastructure audit without application builds

`bun src/ops.ts infra-audit --run --live --evidence /tmp/aphrody-infra-audit --output /tmp/aphrody-infra-audit.json`

The Infra owner inventories Cargo members/features, Bun packages, Infra modules and scripts; runs reviewed type/lint/format/unit gates serially; and inspects WSL, VPS and dbfr through installed native tools. It does not compile Rust, build Next, launch browsers, crawl sites or mutate live hosts. Arbitrary adapters, application test hooks and builds are recorded as deferred. Raw output remains outside Git; the report carries timestamps and hashes. A partial audit never qualifies deployment. Installed binaries and cached tests do not prove that modified Rust source compiles.

`monorepo-gate --no-build --plan --json` exposes the selected leaf commands and exclusions without executing them. `APHRODY_NO_BUILD=1` forbids source-compilation fallback in the Bun Infra bridge.

## Unified documentation

`yolo ops docs` owns documentation generation, source references, provenance,
duplicate audits, optional assistance and private static export. Its policy is
`tools/config/docs/documentation.json`. Existing engines and compatibility operations
remain available; `docs-gen` delegates to the same controller.

```sh
bun run docs -- status
bun run docs:gen
bun run docs:check
bun run docs:audit
bun run docs:site
```

See [documentation management](../../../docs/guides/workspace/documentation.md).
AI assistance is explicit; deterministic generation does not contact a model.
The site is an allowlisted private artifact, never a public deployment.
