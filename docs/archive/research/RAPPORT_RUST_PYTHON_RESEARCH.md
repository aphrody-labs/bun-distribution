# Rapport d'Ingénierie & Convergence Rust-Python (PEP 703 No-GIL)

Synthèse issue des recherches de pointe menées sur l'évolution des architectures logicielles unifiées Rust & Python dans YOLO.

---

## 1. Contexte : La « Rustification » des Fondations de Python
L'écosystème Python a franchi un point de bascule historique avec l'arrivée conjointe de :
1. **CPython Free-Threaded (PEP 703)** : Suppression définitive du verrou global de l'interpréteur (GIL).
2. **Astral uv** : Unification complète du packaging en binaire natif Rust.
3. **Astral ty** : Vérificateur de types basé sur le framework incrémental Rust Salsa.
4. **PyO3 `Bound<'py, T>`** : Sécurité de pointeur et gestion fine de la mémoire partagée.

---

## 2. Analyse Approfondie des 5 Piliers

```
                ┌──────────────────────────────────────────────┐
                │             Astral UV (Packaging)           │
                │        Solveur PubGrub & Cache CAS en Rust   │
                └──────────────────────┬───────────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         ▼                             ▼                             ▼
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│   CPython 3.14t  │          │   PyO3 & Maturin │          │    Astral TY     │
│   Free-Threading │ ◄──────► │   Bound<'py, T>  │ ◄──────► │  Type Checker    │
│   PEP 703 No-GIL │          │   C-API Native   │          │  Salsa Increm.   │
└──────────────────┘          └──────────────────┘          └──────────────────┘
         │                             │                             │
         └─────────────────────────────┼─────────────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │      yolo-core (Rayon)       │
                        │    Calcul Parallèle SIMD     │
                        └──────────────────────────────┘
```

### Pilier 1 : CPython Free-Threading & Allocateur mimalloc
- CPython 3.13 et 3.14 introduisent la compilation sans GIL (`python3.14t`).
- L'allocateur `mimalloc` remplace `pymalloc` pour offrir une allocation thread-safe sans contention de verrou sur les pools de mémoire.
- Le comptage de références utilise le **Biased Reference Counting** : chaque objet possède un thread propriétaire pouvant incrémenter/décrémenter son compteur sans instruction atomique, tandis que les threads secondaires utilisent des opérations atomiques.

### Pilier 2 : Astral UV et la gestion de cycle de vie
- `uv` remplace `pip`, `poetry`, `virtualenv`, `pip-tools` et `pyenv` par un unique binaire autonome en Rust.
- Utilisation de *hardlinks* et de *reflinks* (sur Btrfs/XFS/APFS) permettant d'installer des milliers de dépendances en quelques dizaines de millisecondes sans dupliquer l'espace disque.
- Résolution universelle par le solveur SAT `PubGrub`.

### Pilier 3 : Astral Ty et le typage incrémental
- Architecture paresseuse basée sur la bibliothèque Rust `salsa` (la même qui propulse `rust-analyzer`).
- Traitement incrémental de l'AST ne recalculant que les fonctions modifiées.
- Support natif des modèles Pydantic V2 et des types d'intersection stricts.

### Pilier 4 : PyO3 0.29 & Maturin
- Remplacement du type non-sécurisé `&'py PyAny` par `Bound<'py, T>`.
- Abandon de `allow_threads` au profit de `py.detach()`, interdisant statiquement à la compilation toute manipulation d'objets Python non thread-safe dans la closure Rust.
- Intégration transparente avec Maturin pour compiler des wheels multiplateformes.

### Pilier 5 : Apache Arrow & Polars
- Échange de données en mémoire sans copie entre Rust et Python grâce à la spécification Arrow IPC.
- `yolo` expose des batchs de données nativement convertibles en DataFrame Polars via [`to_polars()`](../packages/engine/python/python/yolo/__init__.py).

---

## 3. Mesures de performance

Aucun benchmark du dépôt n'étayait le tableau comparatif qui figurait ici (lint, `uv lock`,
calcul vectoriel, appel FFI, poids binaire) ; il a été retiré. La seule mesure Rust contre Python
enregistrée est J22 dans [`docs/plans/vu/PLAN.md`](../../plans/vu/PLAN.md) (`scripts/bench-kernels.py`,
20 000 x 384 float32, meilleur de 7) : similarités Rust 5,3 ms contre NumPy 7,9 ms, normalisation Rust
47,5 ms contre NumPy 7,1 ms.
