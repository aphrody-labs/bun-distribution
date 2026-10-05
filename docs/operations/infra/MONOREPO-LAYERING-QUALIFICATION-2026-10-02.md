<!-- SPDX-License-Identifier: Apache-2.0 -->
# Monorepo Cargo graph qualification — 2026-10-02

The former `scripts/tools/workspace/repo-layering.ts` check read retired sibling category
repositories and its test skipped in the active monorepo. It now reads the
root Cargo workspace metadata, indexes workspace crates by their repository
paths, checks path dependencies and cycles, and records external upstream paths
separately. `bun run layering:check` is the root command. The fixture and live
tests exercise the graph, including a missing target and a cycle.

The current scan found 192 workspace crates, 502 path dependency edges, one
external path source, zero cycles, and zero errors. The ecosystem catalog
check matched its committed output across the three active roots. The
[machine report](monorepo-layering-2026-10-02/report.json) records the graph
check, 12 tests, TypeScript check, Oxlint, Oxfmt, and ecosystem staleness check;
all exited 0. The report contains SHA256 hashes of the adjacent full logs,
verified after capture. Oxlint completed with warnings.

This is a Cargo crate graph check. It does not prove that all Bun packages,
runtime services, or the full monorepo pipeline are healthy. The historical
layer numbers remain documented as migration history rather than active
dependency rules.
