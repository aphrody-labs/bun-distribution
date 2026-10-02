<!-- SPDX-License-Identifier: Apache-2.0 -->
# Infra Bun package qualification — 2026-10-02

The remaining Infra packages (`@aphrody/ovh`, `@aphrody/paths`, `@aphrody/sql`,
and `@aphrody/update`) now declare real build, lint, typecheck, and test
commands. SQL's typecheck uses the installed `tsc`; its previous `tsgo`
command was unavailable. The paths package has focused tests for workspace
marker discovery and portable path conversion. Update's blocking Oxlint
findings were corrected, and the touched files were formatted with Oxfmt.

All 16 package gates and the changed-file format check exited 0. The packages
passed 14, 2, 33, and 162 tests respectively, for 211 tests total. The
[machine reports](infra-packages-2026-10-02/) retain the commands, exit codes,
durations, and SHA256 hashes of full logs; all hashes were verified after
capture. Lint completed with warnings.

The manifest catalog and regenerated `config/pipeline.json` match: 17 stages,
245 steps, and `product-shenron-final` last. Every Infra package now declares
all four catalog gates. The full monorepo still has 67 packages missing at
least one gate, so this result is scoped to the four Infra packages.
