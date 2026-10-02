<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Infra pipeline qualification — 2026-10-02

The native `aphrody-infra pipeline --stage check` command now validates the
monorepo's filtered Bun steps against each package manifest. Previously it
treated `--filter` as a root script name, so the generated catalog failed its
native check even when the package scripts existed. The command now also runs
the pipeline's structural validation. A fixture test covers a valid filtered
step, a missing package script, and a missing package.

The source-built native binary checked the current `config/pipeline.json` and
reported zero errors across 245 steps. The serialized Cargo test gate passed
58 library and 19 binary tests. Scoped Cargo check, Clippy with warnings denied,
binary build, and Rustfmt check all exited 0. The [machine report](native-pipeline-2026-10-02/report.json)
records commands, exit codes, durations, and SHA256 hashes of their full logs;
all hashes were verified after capture.

This validates pipeline structure and declared script availability. It does
not execute every pipeline stage or qualify the full monorepo.
