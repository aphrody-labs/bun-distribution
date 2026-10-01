<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Bun fork operations

The Aphrody Bun fork is the top platform development priority. The [Bun fork guide](../../reference/upstream-bun/APHRODY-FORK.md) owns source contribution, module wiring and upstream sync; the [platform map](../../reference/infra/APHRODY-BUN-PLATFORM.md) owns capability boundaries. [`config/bun-fork.json`](../../../config/bun-fork.json) is Infra's exact source pin for integration work. The pin records a source revision, not a distributable release or the runtime selected by applications.

The planned transfer from the agent account to an Aphrody organization is tracked in [GitHub ownership](../../reference/infra/GITHUB-OWNERSHIP.md). Keep the current repository owner and pin until the organization exists and the transferred fork is verified.

## Current delivery state

As checked on 2026-09-28, `aphrody-code/bun` is a GitHub fork of `oven-sh/bun`; Aphrody `main` contains `bun:aphrody`. The local Linux debug build passed all eight tests in `test/js/bun/resolve/aphrody.test.ts`. The module loads Aphrody, N2B and Oxc Rust libraries dynamically with ABI checks. No cross-platform Aphrody Bun release, npm package, or automatic OS selection was established by that test. Upstream `bun upgrade --canary`, `oven/bun` Docker images and npm's `bun` package install upstream Bun.

GitHub `main` has an active rule against deletion and non-fast-forward pushes. The fork has Aphrody-specific description, topics, issue intake, CODEOWNERS and PR prompts. Upstream release, VS Code publication and upstream issue/PR maintenance workflows are disabled on this fork. Bun's existing lint workflow is configured for relevant Aphrody pushes and PRs; its source checks do not build the fork runtime. Its first [manual run](https://github.com/aphrody-code/bun/actions/runs/36481251183) failed before a runner started: GitHub reported that the account is locked due to a billing issue. The local lint and debug tests passed, but no GitHub CI result is established. There is no required build status or release artifact gate yet.

The GitHub forks API sorted by stars listed `gimnathperera/bun` first (24 stars, last pushed 2023-09-11) on 2026-09-28. For an active development comparison, `robobun/soup` was 42 commits ahead of `oven-sh/main` and last pushed 2026-09-27. These are dated GitHub observations, not permanent rankings or evidence that either fork's architecture fits Aphrody.

## Integration order

1. Keep the fork rebased in capability terms against current upstream `main`: fetch, record both heads, merge upstream through a `claude/` branch, resolve conflicts, build and run focused tests, then update this pin. Preserve Git history and avoid force pushes.
2. Build a release artifact matrix for Linux, macOS and Windows that includes a verified `bun:aphrody` module and ABI-compatible Aphrody, N2B and Oxc libraries. Name Aphrody artifacts distinctly from upstream Bun. Record checksums, source revisions, target triples and load tests before publishing.
3. Make `aphrody-toolchains` and OS select a pinned Aphrody artifact when the needed capability is requested. Validate at least one owner consumer and document fallback semantics.
4. Use N2B findings to add Bun runtime parity cases and improve builder/test/minifier workflows with measurable changes. The current plugin only participates in `Bun.build`; Oxc format/minify/lint are separate `bun:aphrody` calls. Do not call them integrated into Bun internals until source and tests prove it.
5. Keep BXC optional while Web is unstable. Revisit it when the Rust `aphrody-web` port has a stable owner API.

For each pin update, compare `git rev-parse main`, `git rev-parse upstream/main`, and the GitHub `main` head; run `bun bd test test/js/bun/resolve/aphrody.test.ts` in the fork, check the three native ABI revisions, update `config/bun-fork.json`, and validate its JSON and links. CI and release evidence must be recorded separately from local debug results.
