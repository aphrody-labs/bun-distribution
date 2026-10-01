<!-- SPDX-License-Identifier: Apache-2.0 -->
# Correction Cargo : regex et versions de registre — 2026-10-01

Le conflit de résolution `regex` est corrigé et les 291 arêtes normal/build
sans version de registre portent désormais une exigence explicite compatible
avec leur source. Le contrôle des déclarations passe sur les 184 membres.
Cette correction ne publie aucune crate et ne constitue pas une qualification
de release : 92 des 102 versions ajoutées ne sont pas disponibles sur crates.io.

## Changements

- 100 déclarations workspace existantes reçoivent la version réelle de leur
  source path/Git ; deux entrées workspace sont ajoutées pour `aphrody-ai`
  et `koharu-canvas`. Les révisions Git restent identiques.
- Quatre dépendances directes par chemin héritent maintenant du workspace.
  Les quatre arêtes dev sans version sont également corrigées : 295 exigences
  directes changent au total. Features, default-features, optionalité, kinds,
  targets et sources des 184 membres sont conservés.
- La version de l'entrée `aphrody-engine-mistralrs` correspond à celle de son
  manifeste : `1.0.0`, plutôt que `1.0.0-canary`.
- `serde-saphyr 0.0.16` reste l'API YAML de Mistral.rs. Le patch étend seulement
  sa borne de `regex >=1.0,<1.13` à `>=1.0,<2.0`, dans les deux manifestes amont.
  Les 799 tests et doctests amont passent avec `regex 1.13.1`.
- Le patch et le pin sont enregistrés dans `config/upstream-sources.json`.
  L'archive reste sous `../source/serde-saphyr`, hors du monorepo. Le mécanisme
  existant `upstream-sources sync --only serde-saphyr --apply` la restaure et
  applique le patch. Le patch passe aussi sur une extraction fraîche.
- Cargo régénère le lockfile en conservant toutes les versions déjà présentes.
  Les nouvelles dépendances permettent de résoudre le moteur Mistral.rs jusque-là
  bloqué ; aucune version existante n'est supprimée ou mise à jour en masse.

Cargo utilise la version comme exigence de compatibilité avec la source locale
ou Git, et comme origine de repli lors du packaging.
[Contrat Cargo](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#multiple-locations).
Une version déclarée ne prouve pas sa publication : l'inventaire d'API ci-dessous
conserve les 404, notamment pour `oxc_formatter 0.71.0`, `oxc_linter 1.86.0`,
`mistralrs 0.9.4`, `hf-hub 1.1.0` et de nombreuses crates internes.
Leur publication et l'ordre des releases restent un travail distinct.

## Preuves et contrôles

- [Avant](registry-regex-fix-2026-10-01/declarations-before.json) :
  291 arêtes normal/build sans version, 275 arêtes path à exigence `*`.
- [Après](registry-regex-fix-2026-10-01/declarations-after.json) :
  zéro arête sans version, zéro wildcard path, aucun problème de manifeste.
  La comparaison des métadonnées avant/après confirme la préservation des
  options de dépendances sur tout le workspace actif.
- [Disponibilité des 102 versions ajoutées](registry-regex-fix-2026-10-01/registry-availability.json) :
  dix versions présentes et non retirées ; 92 réponses HTTP 404.
- [Résolution complète](registry-regex-fix-2026-10-01/resolution.json)
  **avec toutes les features** et `--locked` : réussie.
  Mistral.rs utilise le `serde-saphyr 0.0.16` patché ; celui-ci et
  `lazy-regex 3.6.1` utilisent la même version `regex 1.13.1`.
- [Tests YAML](registry-regex-fix-2026-10-01/serde-saphyr-tests.log) :
  799 réussis, zéro échec, zéro ignoré.
- OXC : [check all-targets](registry-regex-fix-2026-10-01/oxc-check.log),
  [Clippy avec refus des avertissements](registry-regex-fix-2026-10-01/oxc-clippy.log)
  et [deux tests](registry-regex-fix-2026-10-01/oxc-tests.log) réussis.
- Deux tests du vérificateur `cargo-release-audit` réussis ; format JSON et
  `git diff --check` réussis.
- [Contrôle incluant le shell Mistral.rs](registry-regex-fix-2026-10-01/cargo-check.log) :
  échec dans `aphrody-model-client`, avec six erreurs d'API dans le module vLLM
  (`stream`, `OpenAiCompatClient::new`, `OpenAiWire::ChatCompletions`,
  `ProviderRuntime::Default`). Ces sources n'ont pas été modifiées par ce lot.
  Aucun build complet du moteur, packaging ou publication n'est établi.

## Rejouer

```bash
bun packages/infra/workspace/src/upstream-sources.ts sync --only serde-saphyr --apply
scripts/build/rust/cargo-serial.sh metadata --locked --no-deps --format-version 1 > /tmp/cargo-metadata.json
bun packages/infra/workspace/src/cargo-release-audit.ts --metadata /tmp/cargo-metadata.json --check --out /tmp/cargo-declarations.json
scripts/build/rust/cargo-serial.sh metadata --locked --all-features --format-version 1 > /tmp/cargo-resolved.json
scripts/build/rust/cargo-serial.sh update --manifest-path ../source/serde-saphyr/Cargo.toml --package regex --precise 1.13.1
scripts/build/rust/cargo-serial.sh test --manifest-path ../source/serde-saphyr/Cargo.toml --locked
scripts/build/rust/cargo-serial.sh check --locked --all-targets -p aphrody-oxc-bridge
scripts/build/rust/cargo-serial.sh clippy --locked --all-targets -p aphrody-oxc-bridge -- -D warnings
scripts/build/rust/cargo-serial.sh test --locked -p aphrody-oxc-bridge
```

Le contrôle d'audit porte sur les déclarations, pas sur la disponibilité registry.
Les tests YAML s'exécutent séparément : Cargo refuse de tester les
dev-dependencies d'une dépendance qui n'est pas membre du workspace.
