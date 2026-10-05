<!-- SPDX-License-Identifier: Apache-2.0 -->
# `ir`: the Aphrody Python runtime (draft)

Date: 2026-10-05. Status: draft opened by the inventory batch; the architecture, research
journal and checklist are completed in the runtime-plan batch.

Owner request (verbatim, French): absorb py/packages/aphrody/native, fuse `py` natively into
Aphrody, deduplicate for real, and integrate uv and PyO3 at the core of Aphrody the way Bun is
handled (an external monorepo holding the Astral Rust crates, uv, ruff and PyO3) to obtain our
own runtime named `ir`.

- Inventory of `py/` against the monorepo: [INVENTORY-py-vs-aphrody.md](INVENTORY-py-vs-aphrody.md).
