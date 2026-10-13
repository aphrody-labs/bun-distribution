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
