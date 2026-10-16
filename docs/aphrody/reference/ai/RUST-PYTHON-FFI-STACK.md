<!-- SPDX-License-Identifier: Apache-2.0 -->
# Stack Rust/Python/uv/FFI canonique

## Décision

La chaîne de production Aphrody est séparée en trois contrats :

| Surface | Outil canonique | Contrat |
| --- | --- | --- |
| Environnement Python | `uv` `0.12.17` | résolution, lockfile, venv, exécution et publication PEP 517 |
| Extension Python native | PyO3 `0.29` + maturin `1.14.1` | module Python mixte, roue `abi3` depuis CPython 3.11 |
| ABI interopérable | `aphrody-ffi` + header C | `cdylib`, Bun `bun:ffi`, ctypes, C/C++ et autres hôtes |

`uv_build` n'est pas utilisé pour les extensions Rust : la documentation uv le
réserve actuellement aux projets Python purs. `uv` reste le frontend qui lance
`maturin` via PEP 517 (`uv build`, `uv sync`, `uv run`).

## Dépendances centralisées

La version PyO3 est déclarée une seule fois dans le `[workspace.dependencies]`
Cargo racine. `py/aphrody/Cargo.toml` (not in repo) l'hérite et n'ajoute que la feature
`extension-module`. La feature `abi3-py311` est donc commune à la workspace.

Le backend Python est borné à `maturin>=1.14.1,<2.0` dans
`py/packages/aphrody/pyproject.toml`. La borne haute empêche une rupture silencieuse du
backend lors d'une prochaine version majeure.

## Règles FFI

- PyO3 est la surface Python native de haut niveau ; aucun appel direct à
  `pyo3::ffi` sauf code explicitement marqué unsafe et justifié.
- `abi3-py311` est le défaut de distribution : une roue couvre CPython 3.11+
  sur les builds GIL classiques. Le free-threaded Python doit rester une cible
  séparée tant que la compatibilité `abi3t` n'est pas validée.
- `aphrody-ffi` est la surface C ABI stable pour Bun et les hôtes non-Python.
  Elle garde ses fonctions `*_free`, ses codes de retour et son numéro ABI.
- Les buffers traversant l'ABI sont possédés par l'appelant ou libérés par la
  fonction de libération du même côté ; jamais par un allocateur étranger.
- Les runtimes asynchrones sont process-wide et initialisés paresseusement ;
  aucune extension ne crée un runtime Tokio par appel.

## Pipeline reproductible

Depuis `py/` :

```powershell
uv sync --locked
uv run --project aphrody maturin build --release
uv run --project aphrody python -c "import aphrody; print(aphrody.__version__)"
```

Le lockfile uv gouverne les outils Python. `Cargo.lock` gouverne PyO3 et les
crates Rust. Les deux verrous ne sont pas fusionnés artificiellement : ils
résolvent des graphes différents, mais le backend maturin et la version PyO3
sont explicitement alignés.

## Sources officielles

- PyO3 features et ABI : https://pyo3.rs/main/features
- PyO3 distribution : https://pyo3.rs/main/building-and-distribution
- maturin : https://www.maturin.rs/
- uv build backend : https://docs.astral.sh/uv/concepts/build-backend/
- uv packaging : https://docs.astral.sh/uv/guides/package/
