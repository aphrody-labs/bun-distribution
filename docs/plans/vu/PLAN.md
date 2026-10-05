<!-- SPDX-License-Identifier: Apache-2.0 -->
# `vu`: the Aphrody Python runtime (draft)

Date: 2026-10-05. Status: draft opened by the inventory batch; the architecture, research
journal and checklist are completed in the runtime-plan batch.

Owner request (verbatim, French): « absorbe py/packages/aphrody/native et fusionne nativement py à
aphrody et déduplique vraiment aphrody et py via un sub agent qui intègre uv et pyo3 direct au coeur
d'aphrody comme on fait pour bun avec un monorepo externe avec les crates rust astral sœurs de uv +
uv et ruff et pyo3 pour avoir notre runtime du nom de « ir » l'inverse de uv ».

Name: `vu`, the literal inverse of `uv`, settled by the owner on 2026-10-05. The request first wrote
« ir »; that wording is abandoned and there is no open decision on the name left. The name lives in
one constant (see the scaffold in this directory once written).

- Inventory of `py/` against the monorepo: [INVENTORY-py-vs-aphrody.md](INVENTORY-py-vs-aphrody.md).
