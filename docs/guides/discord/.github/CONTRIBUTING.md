# Contributing to Aphrody Discord

This repository maintains the shared Discord transport and framework packages
used by Aphrody applications. Contributions must preserve upstream provenance,
the Bun workspace contract and the ownership boundary: applications keep their
commands, data, authorization policy and secrets.

## Before opening an issue or pull request

1. Search existing issues and pull requests.
2. For a bug, include a minimal reproduction, package name, Bun version and the
   smallest relevant command output. Never include tokens, cookies, OAuth codes,
   production URLs with query credentials or database dumps.
3. For a feature that changes a public package or protocol, open a design issue
   first and describe the compatibility and migration path.
4. Preserve the license and copyright notices in every Discord.js or DiscordX
   snapshot package. Do not copy upstream code into `@aphrody/messaging` without
   recording its provenance in `docs/UPSTREAMS.md` (not in repo).

## Local checks

Use Bun only; Node, npm, pnpm, yarn and tsx are not supported for this workspace.
From the repository root, run:

```sh
bun install --frozen-lockfile
bun run format
bun run check
bun run typecheck
bun run build:typedoc
bun run build
bun run test
```

For a focused change, also run the owning package's `typecheck`, `test` or
`build` script. If an upstream package has an independent compiler constraint,
document that constraint instead of weakening the root gate.

## Discord runtime invariants

- One Gateway connection per Discord application.
- Gateway delivery and signed HTTP interactions are explicit mutually exclusive
  modes for one application.
- REST retry, rate-limit, timeout and error behavior belongs in the shared
  transport; consumers must not add hidden clients.
- Application commands, database access, business authorization and secrets stay
  in the consuming repository.
- OAuth scopes must correspond to an implemented, tested and safely stored
  capability. A requested scope is not evidence that the capability exists.

## Pull requests

Use a focused branch and explain the affected package, upstream provenance,
compatibility impact and checks run. Add or update tests for behavior changes and
add a Changeset when a published package changes. Do not combine an upstream
snapshot refresh with an unrelated application migration.

The PR checklist is authoritative for the required checks. Maintainers may ask
for a mocked Fetch/WebSocket test, package export check, license review or a
test-guild smoke run before merge.

## Commits and releases

Use the repository's commit convention (`feat`, `fix`, `docs`, `build`, `ci`,
`test`, `refactor`, `perf`) and a package-oriented scope. Keep commits small
enough to review. Publishing is performed by the reviewed Changesets workflow;
never publish from a dirty checkout or include `.env` files in an artifact.

`aphrody-infra` owns production releases, systemd, Nginx, external environment
files and rollback. A passing local build does not prove that a production bot
release is active.

## Support and conduct

Use GitHub issues for reproducible defects and design proposals. Follow the
[Code of Conduct](https://github.com/discordx-ts/discordx/blob/main/.github/CODE_OF_CONDUCT.md). Security reports must use the process in
the repository [security policy](../../../research/discord/SECURITY.md), not a public issue.
