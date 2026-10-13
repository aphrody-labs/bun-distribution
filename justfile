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
