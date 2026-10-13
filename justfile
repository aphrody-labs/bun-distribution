set windows-shell := ["pwsh.exe", "-NoLogo", "-NoProfile", "-Command"]

default:
    @just --list

setup:
    bun run setup

check:
    bun run check
    bun run cargo:check

test:
    bun test packages/workspace/src/cargo.test.ts
    bun run cargo:test

metadata:
    bun run cargo:metadata

apps-plan:
    bun run apps:plan

apps-build:
    bun run apps:build

# Select imported packages explicitly; all outputs belong to build/packages.
packages-plan selection:
    bun run packages:plan --package "{{selection}}"

packages-build selection:
    bun run packages:build --package "{{selection}}"

# Run the product through its canonical app-host owner.
server-serve:
    bun packages/bun-app-host/src/cli.ts serve

server-build output:
    bun packages/bun-app-host/src/build.ts build . "{{output}}"

# Check a binary with a temporary loopback process.
server-verify binary:
    bun packages/bun-app-host/src/cli.ts verify "{{binary}}"

crate-inventory:
    bun scripts/crate-inventory.ts

vendor-plan:
    bun scripts/vendor-cargo.ts plan

vendor-prepare:
    bun scripts/vendor-cargo.ts prepare

vendor-verify:
    bun scripts/vendor-cargo.ts verify

# Inspect sources without compiling, then build through the same native owner.
cargo-build-plan:
    bun scripts/cargo-build-proof.ts plan

cargo-build-status:
    bun scripts/cargo-build-proof.ts status

cargo-build:
    bun scripts/cargo-build-proof.ts build
