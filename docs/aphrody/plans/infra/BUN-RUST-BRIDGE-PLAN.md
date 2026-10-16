<!-- SPDX-License-Identifier: Apache-2.0 -->
# Plan du pont Bun ↔ Rust

## État mesuré — 2026-09-29

`yolo ops binaries` voit 10 binaires Aphrody installés. Le scanner a trouvé
plusieurs appels `Bun.spawn`/`Command::new` dans `@aphrody/workspace` (`yolo ops`) et les
crates infra. Ils ont trois natures distinctes :

1. **Processus externes nécessaires** : `git`, `ssh`, `systemctl`, `cargo`,
   `bun`, `gh`, PowerShell. Ils restent des processus jusqu’à ce que leur
   protocole externe soit remplacé par une API Rust ou HTTP.
2. **Logique Aphrody appelée via un binaire** : cible prioritaire pour une API
   Rust liée en mémoire.
3. **Gates de build/test** : conservent une exécution de processus isolée,
   car leur rôle est précisément de vérifier la chaîne de production.

Surfaces natives déjà présentes : `aphrody-ffi`, `iecode-ffi`,
`aphrody-web-ffi`, `nie-ffi`, `aphrody-bun` et `aphrody-n2b-native`. Oxc
fournit en plus un modèle Node-API `napi-rs` maintenu upstream.

## Décision d’architecture

Bun classe `bun:ffi` comme expérimental et recommande Node-API pour une
frontière native stable. Le pont adopte donc deux couches :

| Couche | Usage | Technologie |
| --- | --- | --- |
| `@aphrody/native-core` | Données compactes, calcul local synchrone, ABI déjà C | Rust `cdylib` + `bun:ffi` |
| `@aphrody/native` | API publique stable, objets, async, distribution multi-plateforme | Rust `napi-rs` / Node-API |
| `yolo ops` | Orchestration, Git/SSH/systemd et gates de build | Rust API lorsque possible; processus externes documentés sinon |

Les ABI C exposent seulement des valeurs scalaires, buffers UTF-8 et handles
opaques. Chaque buffer retourné possède une fonction `free` du même crate;
aucune allocation Rust ne traverse la frontière sans destructeur explicite.
Les appels bloquants, callbacks et objets à durée longue passent par Node-API,
pas par `bun:ffi`.

## Cible unique

Créer dans `aphrody-contracts` le contrat versionné `aphrody-native-abi` :

- `abi_version() -> u32`, `schema_json() -> IecodeBytes`;
- enveloppe de réponse `{ version, ok, value, error }` encodée UTF-8;
- propriété de buffer et `free(ptr,len,cap)` uniformes;
- table de capacités : `infra`, `ai`, `web`, `iecode`, `n2b`, `ui`;
- tests ABI Rust, tests Bun FFI et tests Node-API avec le même corpus.

Chaque crate produit soit un adaptateur de cette ABI, soit un addon Node-API.
Les packages Bun n’importent jamais directement un chemin `target/`; un
chargeur unique résout le triple, vérifie la version ABI et renvoie une erreur
structurée si l’artefact est absent.

## Lots d’exécution

1. **Inventaire et métriques**
   - Ajouter à `yolo ops` un scanner AST des imports `bun:ffi`, Node-API,
     `Bun.spawn`, `Command::new` et des symboles C exportés.
   - Émettre `bridge-inventory.json` avec appelant, cible, latence, volume,
     caractère bloquant et remplacement proposé.
   - Mesurer p50/p95, nombre de processus et octets sérialisés pour les dix
     appels les plus fréquents avant toute migration.

2. **Contrat partagé**
   - Créer `aphrody-native-abi` dans Contracts et les fixtures de compatibilité.
   - Réconcilier `IecodeBytes`, les buffers d’`aphrody-ffi` et les retours BXC.
   - Ajouter un test de compatibilité de version entre chaque package Bun et son
     artefact Rust.

3. **Chemins locaux synchrones**
   - Migrer les opérations pures de `@aphrody/workspace` qui délèguent à un
     binaire Aphrody vers `@aphrody/native-core`.
   - Commencer par N2B et IECODE, qui possèdent déjà une C ABI ou un cdylib.
   - Remplacer les JSON via stdout par des buffers de réponse bornés.

4. **API publique stable**
   - Produire des addons Node-API pour les appels async et les objets de service.
   - S’aligner sur le packaging N-API d’Oxc : artefacts par triple, chargeur,
     fallback explicite et types TypeScript générés.
   - Publier les packages sous `@aphrody/*` avec la version ABI dans leurs
     métadonnées.

5. **Réduction contrôlée des sous-processus**
   - Retirer uniquement les appels de type 2 après équivalence de corpus et
     métriques favorables.
   - Garder les appels Git/SSH/systemd/cargo/bun comme adaptateurs de protocole;
     centraliser leur exécution dans Rust et tracer leurs coûts.
   - Ne jamais remplacer une gate de compilation/test par FFI.

6. **Validation et déploiement**
   - Matrice Linux x64, Windows x64 et les triples publiés.
   - Tests de mémoire : double free, pointeur nul, buffer tronqué, version ABI
     incompatible, chargement absent et concurrence.
   - Benchmarks comparant processus, `bun:ffi` et Node-API; migration admise si
     la sémantique est identique et le coût total baisse.

## Critères d’acceptation

- 100 % des appels Bun vers un binaire Aphrody sont classés dans
  `bridge-inventory.json`.
- Chaque appel classé « logique Aphrody » possède un remplacement ABI ou
  Node-API et un test d’équivalence.
- Aucun package Bun ne charge un artefact depuis `target/` directement.
- Tous les buffers C ont une propriété et un destructeur testés.
- Les processus externes restants sont listés avec leur protocole et leur
  justification.
- Les builds Bun, TypeScript, Oxc, Rust et les tests de pont passent sur les
  plateformes supportées.

## Références primaires

- [Bun FFI](https://bun.com/docs/runtime/ffi)
- [Bun Node-API](https://bun.com/docs/runtime/node-api)
- [Bun TypeScript](https://bun.com/docs/typescript)
- [Rustonomicon FFI](https://doc.rust-lang.org/nomicon/ffi.html)

## Surfaces Aphrody explicites

| Surface Bun | Crate / artefact Rust | État actuel | Action du plan |
| --- | --- | --- | --- |
| `packages/interop/native` | `aphrody-ffi` / `libaphrody_ffi` | ABI v1, chargeur cible `target/{triple}` et capture de CLI en mémoire | Adopter le chargeur unique, publier le manifeste ABI et séparer les commandes externes de la logique Rust. |
| `aphrody-ui/packages/bun` (`@aphrody/bun`) | `aphrody-bun` / `libbun_rs` | C ABI direct: M3, icônes, Sass, SVG, rendu, validation; chemins `target/` codés dans le package | Premier pilote: manifest d’artefact, vérification de version, types générés et suppression des chemins `target/` du package. |
| `aphrody-ui/packages/svg` | `aphrody-bun` → `aphrody-svg` | Second wrapper `bun:ffi` vers le même `bun_rs` | Absorber dans le chargeur et le contrat de `@aphrody/bun`; conserver le package SVG comme façade typée. |
| `iecode/packages/iecode-ffi` | `iecode-ffi` | `IecodeBytes { ptr,len,cap }` et destructeur déjà explicite | Réutiliser cette discipline de propriété dans `aphrody-native-abi`. |
| `aphrody-web/apps/bxc` | `aphrody-web-ffi` et bridge BXC | Plusieurs chargeurs et tests de durée de vie | Migrer après le pilote UI, avec les mêmes tests de durée de vie et compatibilité de version. |
| `aphrody-compat` / N2B | `aphrody-n2b-native` | Générateurs cdylib et Bun FFI | Faire produire les nouveaux scaffolds via le contrat et le chargeur communs. |
| Oxc upstream | addons `napi-rs` Oxc | Modèle Node-API multi-plateforme maintenu upstream | Réutiliser son modèle de packaging, sans modifier les crates upstream. |

`bun_rs` et « Bun-RS » désignent le même artefact: le crate se nomme
`aphrody-bun`, sa bibliothèque C se nomme `bun_rs`, et son package public est
`@aphrody/bun`. `rs-bun` n’est pas un second crate trouvé dans les sources;
il doit rester un alias documentaire vers cette surface, sans créer un nouveau
pont dupliqué.
