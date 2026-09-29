# @aphrody/workspace

Bun automation boundary for Aphrody Infra. From this checkout it executes the
current Rust source through incremental Cargo; set `APHRODY_INFRA_BIN` or
`APHRODY_INFRA_USE_INSTALLED=1` to use a verified installed binary. It does not
reimplement infrastructure mutations: Rust owns services,
Git, SSH, deployment, VPN, OVH and secrets.

```bash
bun packages/aphrody-workspace/src/cli.ts doctor --strict --json
bun packages/aphrody-workspace/src/ops.ts pipeline plan
bun packages/aphrody-workspace/src/ops.ts fleet
bun packages/aphrody-workspace/src/ops.ts n2b scan /path/to/project
bun packages/aphrody-workspace/src/ops.ts binaries
bun packages/aphrody-workspace/src/ops.ts binary aphrody-kernel --version
bun packages/aphrody-workspace/src/ops.ts packages status
bun packages/aphrody-workspace/src/ops.ts packages outdated --repo rg
bun packages/aphrody-workspace/src/ops.ts bridge status
bun packages/aphrody-workspace/src/ops.ts bridge rust aphrody-kernel --version
bun packages/aphrody-workspace/src/ops.ts infra doctor --strict --json
bun packages/aphrody-workspace/src/ops.ts infra quality plan --json
bun packages/aphrody-workspace/src/ops.ts infra quality lint --repo aphrody-infra --run
bun packages/aphrody-workspace/src/ops.ts orchestrate health
bun packages/aphrody-workspace/src/ops.ts imports-exports --root ../aphrody-ui --json
bun packages/aphrody-workspace/src/ops.ts monorepo-audit --root ../aphrody-ui --only imports --json
bun packages/aphrody-workspace/src/ops.ts bun-workspace --root ../aphrody-ui --json
bun packages/aphrody-workspace/src/ops.ts bun-docs check
bun packages/aphrody-workspace/src/ops.ts ui-verify --root ../aphrody-ui --quick
```

The `client` export is the typed fetch boundary for `aphrody-infra serve`.

`fleet` reads the generated ecosystem and the pipeline catalogue, so the package
shows every catalogued Aphrody repository and its delivery stages without a
second registry. `n2b` forwards full Node-to-Bun migrations to the Aphrody N2B
CLI; it does not substitute the smaller read-only native scanner.

`binaries` discovers every present `aphrody*` and `n2b` executable in the
trusted local-bin and sibling workspace build outputs. `binary` dispatches only
to one of those discovered paths; it never executes an arbitrary `PATH` entry.

`packages` discovers catalogued first-party roots that declare or evidence Bun usage and carry a `bun.lock`. It uses Bun’s package manager for frozen installs, outdated dependency reporting and JSON audits. The default registry is the official npm registry; a workspace’s existing `.npmrc` or `bunfig.toml` registry remains authoritative.

`bridge` is the single Bun-to-Rust registry: it combines the declared Bun workspaces, verified Rust executables and the typed Infra API endpoint. `bridge rust` dispatches only to a discovered executable; `infra` keeps the source-aware Infra invocation, including its explicit `--root` argument.

`infra quality` reads declared `format`, `lint`, typecheck, test and build scripts from first-party package manifests. The Rust control plane selects the script; Bun is invoked only to run the selected application-owned check.

Les étapes d’audit et de correction peuvent être résolues ou lancées par le contrôleur Rust :

```bash
bun packages/aphrody-workspace/src/ops.ts infra quality audit --repo aphrody-ui --run
bun packages/aphrody-workspace/src/ops.ts infra quality audit --repo shenron --run
bun packages/aphrody-workspace/src/ops.ts infra quality fix --repo aphrody-ui --run
```

`imports-exports`, `monorepo-audit`, `bun-workspace`, `bun-docs` and `ui-verify` are reusable Bun modules. They centralize the UI AST inventory, audit dispatcher, Bun workspace contract, embedded official Bun documentation, and UI gate runner. The UI exposes them through its existing package scripts, with `aphrody-ops` resolved from the Aphrody workstation command directory.

`automation-inventory --root /home/aphro/src --json` emits the current cross-repository automation catalogue and classification.

The consolidation command inventories current checkout heads, dirty paths, workspace manifests and documentation/script destinations without changing source repositories. After reviewing `docs/migration/source-map.json`, `consolidation docs-import` copies only mapped documentation whose source hash still matches; it preserves conflicting target files and records exact duplicate aliases. Relative Markdown links to imported documents and verified local files are rewritten. File targets must have matching source and target hashes, recorded import hashes, or a matching Bun package identity. `consolidation scripts-import` copies categorized first-party scripts without executing them. Remaining asset/code links, reference-style links and missing or changed sources are recorded in target import reports and remain an open gate.

`consolidation submodules-inventory` records Gitlink pins, `.gitmodules` declarations, initialized nested heads and missing candidate roots without initializing a checkout. It also writes a linked map of tracked and untracked nested files with working-file SHA-256, Git index and HEAD object IDs, file classification, parsed Cargo, Bun/Node, Python and pnpm workspace declarations, and resolved member patterns. Nested files have no import target. It leaves `aphrody-ui` to its designated agent and does not inspect that checkout.

`consolidation infra-config-import` stages clean tracked Infra catalogs, systemd units and its Rust toolchain pin at the target root. It refuses a changed source or conflicting target, records source and target hashes, and reports path remaps and endpoint classes in `docs/migration/infra-config-import.json`. The current pipeline and Google stack source paths are transitional; deployed endpoint and unit values are preserved for a coordinated cutover.

`consolidation infra-scripts-import` stages the six clean tracked Infra scripts named by the copied systemd units under categorized `scripts/` paths. It rejects source hash changes and target conflicts, then records the copies in `docs/migration/infra-scripts-import.json`. Copied script defaults and deployed unit paths still need runtime qualification.

`consolidation source-licenses-import` preserves root LICENSE, NOTICE and COPYING files from pinned non-UI source Git commits. It checks each worktree against the pinned blob, records raw and filtered hashes, and gives byte-identical files one canonical target with aliases in `docs/migration/source-licenses-import.json`. Missing root licenses and nested package licenses remain separate migration gates.

```bash
bun packages/aphrody-workspace/src/ops.ts consolidation inventory --source-root /home/aphro/src --iecode-root /home/aphro/iecode --aphrody-root /home/aphro/aphrody --python-root /home/aphro/aphrody-py
bun packages/aphrody-workspace/src/ops.ts consolidation submodules-inventory --source-root /home/aphro/src --iecode-root /home/aphro/iecode --aphrody-root /home/aphro/aphrody --python-root /home/aphro/aphrody-py
bun packages/aphrody-workspace/src/ops.ts consolidation infra-config-import --source-root /home/aphro/src --aphrody-root /home/aphro/aphrody
bun packages/aphrody-workspace/src/ops.ts consolidation infra-scripts-import --source-root /home/aphro/src --aphrody-root /home/aphro/aphrody
bun packages/aphrody-workspace/src/ops.ts consolidation source-licenses-import --source-root /home/aphro/src --aphrody-root /home/aphro/aphrody
bun packages/aphrody-workspace/src/ops.ts consolidation docs-import --source-root /home/aphro/src --iecode-root /home/aphro/iecode --aphrody-root /home/aphro/aphrody --python-root /home/aphro/aphrody-py
bun packages/aphrody-workspace/src/ops.ts consolidation scripts-import --source-root /home/aphro/src --iecode-root /home/aphro/iecode --aphrody-root /home/aphro/aphrody --python-root /home/aphro/aphrody-py
```
