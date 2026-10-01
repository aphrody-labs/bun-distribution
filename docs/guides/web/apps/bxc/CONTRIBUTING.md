<!-- SPDX-License-Identifier: Apache-2.0 -->
# Contributing to Aphrody Web

BXC is the Web implementation inside `aphrody-os`. Changes belong in the
[Aphrody OS repository](https://github.com/aphrody-labs/aphrody); there is
no separate BXC checkout, release workflow, or production service.

```bash
git clone https://github.com/aphrody-labs/aphrody.git
cd aphrody-os
bun install --frozen-lockfile
cargo check -p aphrody-web-ffi --locked
cd apps/bxc
bun run verify
```

Use the root workspace lockfiles and crates. Add first-party Rust code under
`crates/aphrody-*`, Bun code under `apps/bxc` or `packages/`, and deployment
changes in `aphrody-infra`. Run focused tests during development; `bun run
verify` is the BXC gate before submitting a pull request to `aphrody-os`.
Never commit credentials, cookies, generated indexes, or production data.