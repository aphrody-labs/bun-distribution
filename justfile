# YOLO Monorepo — Unified Justfile
# Bridges Cargo (Rust), Bun (TS7/Native), and Just orchestrator

set shell := ["bash", "-l", "-c"]

# Local/factory builds use Aphrody's shared Cargo lock, cache and resource guard.
# The factory may override this with its installed owner wrapper.
cargo_owner := env("YOLO_CARGO_WRAPPER", env("HOME") / "aphrody/scripts/build/rust/cargo-serial.sh")
# Keep in sync with the pinned vendor/next/rust-toolchain.toml; core stays stable.
compiler_toolchain := "nightly-2026-08-20"
# The Bun fork has its own toolchain and build graph.
bun_toolchain := "nightly-2026-09-15"

default: status

# Status & Diagnostics
status:
    @echo -e "\033[1;36m=== YOLO Monorepo Status ===\033[0m"
    @bun run apps/cli/src/index.ts status
    @echo -e "\n\033[1;36m=== Submodules ===\033[0m"
    @bun run scripts/vendor/packages_upstream_sync.ts
    @echo -e "\n\033[1;36m=== Cargo Workspace ===\033[0m"
    @"{{cargo_owner}}" check --locked --no-default-features -p yolo-core -p yolo-runtime --message-format=short

# Quality gates & verification
check: typecheck lint fmt-check rust-fmt-check check-core clippy
    @echo -e "\033[1;32m[OK] Quality gates passed\033[0m"

typecheck:
    tsc --noEmit

# Run the installed toolchain binaries directly, without package execution/download runners.
lint:
    oxlint scripts/ test/ packages/ apps/cli/src/ apps/web/src/

fmt:
    oxfmt --write scripts/ test/ packages/ apps/cli/src/ apps/web/src/

fmt-check:
    oxfmt --check scripts/ test/ packages/ apps/cli/src/ apps/web/src/

# Minimal owned source formatting; imported engines keep an explicit upstream gate.
rust-fmt:
    "{{cargo_owner}}" fmt -p yolo-core -p yolo-runtime

rust-fmt-check:
    "{{cargo_owner}}" fmt --check -p yolo-core -p yolo-runtime

rust-fmt-upstream-check:
    "{{cargo_owner}}" fmt --all --check

rust-fmt-desktop-check:
    "{{cargo_owner}}" fmt --check -p yolo-desktop

rust-fmt-python-check:
    "{{cargo_owner}}" fmt --check -p yolo-pyo3

# Minimal native server graph: no desktop, Python, browser or compiler provider.
check-core:
    "{{cargo_owner}}" check --locked --no-default-features -p yolo-core -p yolo-runtime --all-targets

# Clippy is strict on the core; optional owned providers have their own gates below.
clippy:
    "{{cargo_owner}}" clippy --locked --no-default-features -p yolo-core -p yolo-runtime --all-targets -- -D warnings

# Licenses, advisories, sources (cargo-deny, policy in deny.toml)
deny:
    cargo deny check

# The cargo-deny gate of CI: licenses and sources (advisories change daily, see `just deny`)
deny-ci:
    cargo deny check licenses sources

# Explicit imported desktop graph and tools, preserving the former workspace gate.
# Compiler and CEF engines retain separate opt-in selections.
check-upstream:
    "{{cargo_owner}}" check --locked --workspace --exclude aphrody-tauri-runtime-cef --exclude 'aphrody-turbo*' --exclude 'aphrody-next*' --exclude aphrody-auto-hash-map --exclude aphrody-swc-ast-explorer --all-targets

check-workspace: check-upstream

# Test the former desktop/default-member selection explicitly, including upstream helpers.
test-upstream:
    "{{cargo_owner}}" nextest run --locked --no-fail-fast --lib --bins --tests -p 'aphrody-tauri' -p 'aphrody-tauri-build' -p 'aphrody-tauri-codegen' -p 'aphrody-tauri-driver' -p 'aphrody-tauri-macros' -p 'aphrody-tauri-plugin' -p 'aphrody-tauri-plugin-*' -p 'aphrody-tauri-runtime' -p 'aphrody-tauri-runtime-wry' -p 'aphrody-tauri-utils' -p aphrody-acl-tests -p aphrody-create-tauri-app -p aphrody-tao -p aphrody-tao-macros -p aphrody-wry

# Default gates cover the minimal core; provider/upstream gates are explicit below.
ci: check deny-ci test-all

test:
    bun test test/

# Explicit packages keep this contract stable when other workspace members are added.
test-crates:
    "{{cargo_owner}}" nextest run --locked --no-default-features --no-fail-fast --lib --bins --tests -p yolo-core -p yolo-runtime

test-all: test test-crates

# Applications
cli *args:
    bun run apps/cli/src/index.ts {{args}}

web-build:
    cd apps/web && bun run build

web-dev:
    cd apps/web && bun run dev

desktop-build: web-build
    "{{cargo_owner}}" build --locked -p yolo-desktop

desktop-dev: web-dev

desktop-tauri-check:
    "{{cargo_owner}}" check --locked -p yolo-desktop --all-targets

clippy-desktop:
    "{{cargo_owner}}" clippy --locked -p yolo-desktop --all-targets -- -D warnings

test-desktop:
    "{{cargo_owner}}" nextest run --locked -p yolo-desktop --lib --bins --tests --no-fail-fast

qualify-desktop: rust-fmt-desktop-check desktop-tauri-check clippy-desktop test-desktop

# Requires a producer revision containing the optional browser feature. This selection
# does not assert that the feature or its installed artifact is already qualified.
check-browser:
    "{{cargo_owner}}" check --locked -p yolo-runtime --no-default-features --features browser --all-targets

clippy-browser:
    "{{cargo_owner}}" clippy --locked -p yolo-runtime --no-default-features --features browser --all-targets -- -D warnings

test-browser:
    "{{cargo_owner}}" test --locked -p yolo-runtime --no-default-features --features browser --lib

qualify-browser: rust-fmt-check check-browser clippy-browser test-browser

check-python:
    "{{cargo_owner}}" check --locked -p yolo-pyo3 --all-targets

clippy-python:
    "{{cargo_owner}}" clippy --locked -p yolo-pyo3 --all-targets -- -D warnings

test-python-crate:
    "{{cargo_owner}}" test --locked -p yolo-pyo3 --lib --bins --tests

# uv invokes Maturin/Cargo; run it inside the factory's shared heavy lock.
test-python:
    @test "${APHRODY_BUILD_HOST:-}" = vps || { echo 'Python native build requires the declared factory; use just factory python <sha>.' >&2; exit 64; }
    just test-python-crate
    uv sync --locked --package yolo --extra dev
    uv run --package yolo --extra dev --no-sync -- python -m pytest packages/python/tests

qualify-python: rust-fmt-python-check check-python clippy-python test-python

# `rustup run` without --install refuses an absent toolchain instead of acquiring it.
_compiler-ready:
    rustup run "{{compiler_toolchain}}" rustc --version

# Upstream compiler lints keep their upstream levels; check all native entry points.
check-compiler: _compiler-ready
    "{{cargo_owner}}" +{{compiler_toolchain}} check --locked -p 'aphrody-turbo*' -p 'aphrody-next*' -p aphrody-auto-hash-map -p aphrody-swc-ast-explorer --all-targets

test-compiler: _compiler-ready
    "{{cargo_owner}}" +{{compiler_toolchain}} nextest run --locked -p 'aphrody-turbo*' -p 'aphrody-next*' -p aphrody-auto-hash-map -p aphrody-swc-ast-explorer --lib --bins --tests --no-fail-fast

qualify-compiler: _compiler-ready rust-fmt-upstream-check check-compiler test-compiler

qualify-upstream: rust-fmt-upstream-check check-upstream test-upstream

# Source preparation and its gitlink verification belong to the native factory owner.
# Guard before running Bun: configure can acquire compiler components and dependencies.
qualify-bun:
    #!/usr/bin/env bash
    set -euo pipefail
    test "${APHRODY_BUILD_HOST:-}" = vps || { echo 'Bun engine builds require the declared factory; use just factory bun <sha>.' >&2; exit 64; }
    test -f vendor/bun/scripts/build.ts -a -f vendor/bun/rust-toolchain.toml || { echo 'Prepare the pinned vendor/bun source through build-factory prepare --submodules vendor/bun first.' >&2; exit 64; }
    cd vendor/bun
    bun -e 'const pin = Bun.TOML.parse(await Bun.file("rust-toolchain.toml").text()).toolchain?.channel; if (pin !== process.argv[1]) { console.error("Bun source toolchain differs from the qualified recipe pin"); process.exit(64); }' "{{bun_toolchain}}"
    rustup run "{{bun_toolchain}}" rustc --version
    export RUSTUP_TOOLCHAIN="{{bun_toolchain}}"
    exec bun scripts/build.ts --profile=release -j2

# Native Workspace owner pins the source revision and serializes heavy provider builds.
[positional-arguments]
factory profile revision:
    #!/usr/bin/env bash
    set -euo pipefail
    source_scope=()
    case "$1" in
      core) recipe=ci ;;
      bun) recipe=qualify-bun; source_scope=(--submodules vendor/bun) ;;
      desktop|browser|python|compiler|tooling|upstream) recipe="qualify-$1" ;;
      *) echo 'Unknown profile: expected core, bun, desktop, browser, python, compiler, tooling or upstream.' >&2; exit 64 ;;
    esac
    [[ "$2" =~ ^[0-9a-f]{40}$ ]] || { echo 'Factory revision must be a full Git SHA.' >&2; exit 64; }
    exec ./bin/yolo ops build-factory run --repo yolo --revision "$2" "${source_scope[@]}" -- just "$recipe"

# Install the forked Tauri CLI (`cargo tauri`) from crates/aphrody-tauri-cli
install-cli:
    "{{cargo_owner}}" install --path crates/aphrody-tauri-cli --locked

# Autonomous Code Generation Engine (from Bun upstream)
generate:
    bun run apps/cli/src/index.ts generate

# Native runtime (docs/RUNTIME-ABI.md): the artifact uses the `runtime` profile (unwinding panics)
runtime-build:
    "{{cargo_owner}}" build --locked --no-default-features --profile runtime -p yolo-runtime

# Unified native Oxc/n2b implementation; unwind at all owned C ABI boundaries.
tooling-build:
    "{{cargo_owner}}" build --locked --profile runtime -p yolo-tooling

qualify-tooling:
    "{{cargo_owner}}" check --locked -p yolo-tooling -p aphrody-n2b -p aphrody-toolchains -p yolo-core --features yolo-core/repository-tools
    "{{cargo_owner}}" test --locked -p yolo-tooling -p aphrody-oxc-bridge -p aphrody-n2b -p aphrody-n2b-core -p aphrody-n2b-native -p aphrody-n2b-registry -p aphrody-n2b-types -p aphrody-toolchains -p yolo-core --features yolo-core/repository-tools --lib --tests
    "{{cargo_owner}}" clippy --locked -p yolo-tooling -p aphrody-oxc-bridge -p aphrody-n2b -p aphrody-n2b-core -p aphrody-n2b-native -p aphrody-n2b-registry -p aphrody-n2b-types -p aphrody-toolchains -p yolo-core --features yolo-core/repository-tools --all-targets -- -D warnings
    just tooling-build

runtime-test: runtime-build
    "{{cargo_owner}}" test --locked --no-default-features -p yolo-runtime -p yolo-core
    bun run scripts/release/runtime_artifact.ts
    YOLO_RUNTIME_LIB="$(bun -e 'import { libraryFile } from "./packages/runtime/src/index.ts"; console.log("target/runtime/" + libraryFile())')" bun test test/runtime_sdk.test.ts test/runtime_release.test.ts

# dist/runtime/<target>/: library + C header + manifest (target, toolchain, ABI, revisions, hashes)
runtime-package: runtime-build
    bun run scripts/release/runtime_artifact.ts

# Install the packaged artifact (verified, versioned, previous kept) and roll back
runtime-install: runtime-package
    bun run scripts/release/runtime_release.ts install

runtime-rollback:
    bun run scripts/release/runtime_release.ts rollback

# Producer-owned archive of the TypeScript SDK for consumers outside this workspace
runtime-sdk-pack:
    bun run scripts/release/runtime_sdk_pack.ts

runtime-list:
    bun run scripts/release/runtime_release.ts list

# Browse oven-sh/awesome-bun (README cached in .cache/awesome): just awesome search react
awesome *args:
    bun run apps/cli/src/index.ts awesome {{args}}

# Scaffold an Aphrody stack project: just create ../my-app --with web,desktop --framework hono
create *args:
    bun run apps/cli/src/index.ts create {{args}}

# Manage a Linux server (plan by default, --apply to execute): just host audit --host vps
host *args:
    bun run apps/cli/src/index.ts host {{args}}

# Re-audit and re-curate awesome-bun for the Rust-based Bun (network): templates/AWESOME.md + JSON
awesome-curate:
    bun run apps/cli/src/index.ts awesome curate

# Vendoring of the forks into crates/aphrody-* (see docs/VENDORING.md)
import-scan:
    bun run apps/cli/src/index.ts import --scan

# Dry run of the import
import:
    bun run apps/cli/src/index.ts import

# The `vendor` branch lives in a worktree: it only ever receives generated imports.
vendor-worktree:
    @test -d .cache/vendor/.git -o -f .cache/vendor/.git || git worktree add .cache/vendor vendor

# Fails if crates/ differs from a fresh import of the pinned submodule commits
import-check: vendor-worktree
    bun run apps/cli/src/index.ts import --check --out .cache/vendor

# Re-import the submodules on `vendor`, then merge it into the current branch
vendor-update: vendor-worktree
    bun run apps/cli/src/index.ts import --apply --out .cache/vendor
    # -f: nested upstream .gitignore files must not hide imported files
    git -C .cache/vendor add -A -f -- crates examples docs vendor.lock
    git -C .cache/vendor diff --cached --quiet || git -C .cache/vendor commit -m "vendor: update crates from the pinned submodule commits"
    git merge vendor

# Documentation (mdBook)
docs-build:
    mdbook build docs

docs-serve:
    mdbook serve docs --open

# Fetch the upstream branches of every fork (no merge); then run `just vendor-update`
upgrade-latest:
    @echo -e "\033[1;36m=== Fetching upstream commits of the forks ===\033[0m"
    @git submodule update --init --recursive
    @cd vendor/bun && git fetch upstream main --depth=100 && git checkout yolo && git merge --ff-only upstream/main || true
    @cd vendor/obscura && git fetch origin main --depth=50 && git checkout yolo && git merge --ff-only origin/main || true
    @cd vendor/tauri && git fetch upstream v3 --depth=50 || git fetch origin v3 --depth=50 || true
    @cd vendor/plugins-workspace && git fetch upstream v3 --depth=50 || git fetch origin v3 --depth=50 || true
    @cd vendor/create-tauri-app && git fetch upstream dev --depth=50 || git fetch origin dev --depth=50 || true
    @cd vendor/wry && git fetch upstream dev --depth=50 || git fetch origin dev --depth=50 || true
    @cd vendor/tao && git fetch upstream dev --depth=50 || git fetch origin dev --depth=50 || true
    @echo -e "\n\033[1;36m=== Upgrading Bun to latest ===\033[0m"
    @bun upgrade || true
    @echo -e "\n\033[1;36m=== Upgrading global JS tooling ===\033[0m"
    @bun add -g typescript@latest oxlint@latest oxfmt@latest @types/bun@latest
    @echo -e "\n\033[1;36m=== Upgrading local workspace dependencies ===\033[0m"
    @bun update
    @cd apps/web && bun update
    @echo -e "\033[1;32m[OK] Upstream fetched. Merge it in the forks, then run: just vendor-update\033[0m"

# Cleaning
clean:
    -git worktree remove --force .cache/vendor
    # var/host/*/journal.jsonl is the only undo record of applied `yolo host` tuning: never deleted by clean
    [ -d var ] && find var -mindepth 1 -maxdepth 1 ! -name host -exec rm -rf {} + || true
    rm -rf .cache *.log target dist apps/web/dist
    @echo -e "\033[1;32m[OK] Workspace cleaned (var/host journals kept)\033[0m"

# Publishing (dry-run by default; real publish needs explicit *-run recipes)
publish-crates-dry:
    cargo publish --workspace --exclude aphrody-tauri-runtime-cef --exclude 'aphrody-turbo*' --exclude 'aphrody-next*' --exclude aphrody-auto-hash-map --exclude aphrody-swc-ast-explorer --dry-run --allow-dirty

publish-crates-run:
    cargo publish --workspace --exclude aphrody-tauri-runtime-cef --exclude 'aphrody-turbo*' --exclude 'aphrody-next*' --exclude aphrody-auto-hash-map --exclude aphrody-swc-ast-explorer

publish-npm-dry:
    bun run scripts/vendor/publish_forks.ts

publish-npm-run:
    bun run scripts/vendor/publish_forks.ts --publish

publish-dry: publish-crates-dry publish-npm-dry

# Multi-Agent Ingestion, Redis Codebase Indexer & Interceptor Daemon
ingest-sessions:
    bun run scripts/ingest_all_sessions.ts

index-redis:
    bun run scripts/post_push_index.ts

interceptor-daemon:
    bun run scripts/agent_interceptor_daemon.ts

# Plugins Management & Auditing
plugin-status:
    bun run apps/cli/src/index.ts plugin status

plugin-check:
    bun run apps/cli/src/index.ts plugin check

plugin-purge:
    bun run apps/cli/src/index.ts plugin purge
