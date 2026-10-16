<!-- SPDX-License-Identifier: Apache-2.0 -->

# Intégration renderer et Taffy — 7 octobre 2026

## Manifestes et périmètre

La déclaration héritée d'`aphrody-render` empêchait le chargement du workspace :
l'adaptateur WASM demandait `default-features = false`, alors que la dépendance
racine activait implicitement les defaults. La correction préparée désactive
les defaults à la racine et les active explicitement pour les deux consommateurs
natifs, `aphrody-bun` et `aphrody-command`.

Les métadonnées Cargo du worktree se chargent après cette correction. Elles
confirment `uses_default_features = true` pour les consommateurs natifs et
`false`, avec `features = ["cpu"]`, pour `aphrody-command-wasm`. Les defaults
du [renderer](../../../../crates/aphrody-render/Cargo.toml) restent `cpu` et `parallel`.
Ces métadonnées établissent la déclaration des features ; elles ne qualifient
pas leur exécution.

L'intégration préparée déclare aussi la version Taffy déjà verrouillée, `0.12.1`,
dans les dépendances du workspace et oriente le patch et le catalogue de
provenance vers `crates/ui/taffy`. La comparaison initiale des 54 fichiers déplacés
depuis l'ancien emplacement crates/vendor/taffy était identique octet pour octet. Depuis cette
comparaison, le propriétaire a repris le renderer et ajouté des modifications
à Taffy ainsi que leur provenance ; cette preuve initiale ne couvre pas ces
ajouts.

Les modifications de manifestes, de renderer et de migration restent dans le
worktree en attente de qualification. Le présent lot livre le constat et ses
limites.

## Gate native exécutée

| Élément | Valeur |
| --- | --- |
| Snapshot | `9897153d6e6860726b18f3c868b848230934f03c` |
| Job VPS | `2026-10-07T20-11-55-883Z-9897153d6e68` |
| Hôte | `x86_64-unknown-linux-gnu` |
| Toolchain | Rust `1.98.1`, LLVM `22.1.8` |
| Commande Cargo | `test -p aphrody-render --no-default-features --features cpu --lib --tests --locked -- --test-threads=1` |
| Résultat terminal | Code `101`, compilation échouée, aucun test exécuté |

Le propriétaire `scripts/build/rust/vps-cargo.ts` a transféré le snapshot puis
exécuté la commande derrière les verrous de la fabrique, avec quatre jobs et
le sccache partagé. Le CLI a repris automatiquement après un conflit sur la
référence de snapshot partagée. Un premier transfert concurrent avait été
annulé avant tout Cargo ; la reprise utilisait la configuration Git
`pack.threads=1`, `pack.windowMemory=64m`, `pack.packSizeLimit=256m`.

Les six erreurs proviennent du nouveau module
`crates/ui/render/src/layout/components.rs` (not in repo) :

- `Dimension` n'implémente pas les traits requis par `min_content()` et
  `max_content()` ;
- le type d'erreur d'un `Result` dans la conversion des espacements reste
  ambigu ;
- la méthode `css_suffix()` n'existe pas sur le type `Role` utilisé.

La compilation rapporte aussi 16 warnings, notamment un import inutilisé et
des inférences numériques de repli. Le chemin est revendiqué par le propriétaire
actif `web_gui_wasm_finish`, état `active-component-fine-tuning`. Les diagnostics
sont consignés dans
`.coord/proofs/render-feature-integration-20261007/gate-failure.json` (not in repo) et le journal
`render-test-retry.log` du même dossier. Les ajouts arrivés après le snapshot,
dont un `Clone` sur le layout, ne sont pas couverts par cette tentative.

## Contrôles distincts et suite

Le chargement des métadonnées, la génération documentaire ciblée
(`yolo ops docs generate --skip-ecosystem`), sa vérification, les liens et
rustfmt ciblé passent. Une entrée Oxc intégrée placée dans la liste des sources
à restaurer, avec des descriptions de patch au mauvais format, a ensuite fait
échouer la génération. Sa remise dans le catalogue des implémentations intégrées,
avec la description conservée dans la note, rétablit génération et vérification.
Cette réparation de provenance attend le lot source Oxc de son propriétaire.
Le contrôle documentaire de tous les écosystèmes reste
hors de cette preuve.

Il reste à terminer les sources chez leur propriétaire, capturer leur état
stable, puis exécuter check, tests et Clippy strict avec `--locked`. Les defaults
natifs et la cible WASM demandent leurs propres contrôles. Aucun résultat de
packaging, installation, activation, GPU, bureau ou Windows n'est établi ici.
Le [plan](../../PLAN.md) reste ouvert.
