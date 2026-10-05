<!-- SPDX-License-Identifier: Apache-2.0 -->
# Yolo — critical issues, 2026-10-04

Revue des contrats et de la livraison sur `51173c0`, avec `aphrody docs search`
et recoupement des sources locales. P1 désigne un blocage de livraison ou un
risque sur un contrat obligatoire ; P2 une dérive de configuration. Ce relevé
n'est pas un audit exhaustif de sécurité ou une qualification des moteurs.
[Reçu de recherche](docs-search-2026-10-04.json).

## Problèmes prioritaires

| ID | Priorité | Constat et conséquence | Preuve locale | Critère de fermeture |
| --- | --- | --- | --- | --- |
| C1 | P1 | Fabrique routée vers un hôte réservé à l'exécution ; les builds lourds ne sont pas disponibles dans le workflow autorisé | Config Aphrody `build-factory.json`, MCP `workspace_build_factory_status`, décision dans PLAN | Désigner/provisionner un hôte compatible via Infra, vérifier route et gates de fabrique |
| C2 | P1 | Deux workflows utilisent le runner retiré `macos-13` ; leurs jobs Intel ne peuvent plus compter sur ce runner hébergé | `.github/workflows/runtime.yml:30`, `.github/workflows/release.yml:25` | Choisir un runner Intel actuellement supporté et prouver architecture, build et exécution de l'artefact |
| C3 | P1 | Les assets locaux ne correspondent pas au contrat SDK courant ; hashes valides mais release ABI 1.3 face au SDK exigeant 1.4 | `dist/release/0.1.0/release.json`, `packages/runtime/src/index.ts:16` | Produire une release cohérente épinglée, puis install/upgrade/rollback et D0/D2 sur les assets exacts |
| C4 | P2 | Le scaffold annonce ABI 1.3 alors que producteur et SDK exigent 1.4 ; metadata obsolète | `templates/stack.toml:13`, `crates/yolo-runtime/src/lib.rs:29` | Aligner metadata et ABI réellement livrée, vérifier scaffold ; aucune panne de lecture de cette clé n'est démontrée |
| C5 | P1 | Les sondes privilèges sont synchrones sans délai maximal : absence de prompt ne borne pas la durée et peut bloquer l'appelant | `crates/yolo-core/src/privilege.rs`, `packages/runtime/src/privilege.ts` | Borne de temps/annulation qualifiée avec sonde lente ; Windows token/UAC et politique d'élévation explicitement qualifiés |
| C6 | P1 | L'arrêt Windows ne possède que l'enfant direct ; descendants non qualifiés | `crates/yolo-runtime/src/process.rs:305`, contrat ABI | Ownership par Job Objects ou contrat équivalent ; tests descendants, leader terminé, annulation et destruction |

GitHub a annoncé le retrait de [macos-13](https://github.com/actions/runner-images/issues/13046)
en 2025. Remplacer aveuglément par un label ARM ne prouverait pas la cible Intel.
Le catalogue [runner-images](https://github.com/actions/runner-images) est la référence
pour sélectionner le remplaçant. Aucun workflow n'a été modifié par cette revue.

Les [Job Objects Windows](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
gèrent des groupes et permettent la terminaison à la fermeture du dernier handle
avec KILL_ON_JOB_CLOSE ; breakaway et création des descendants doivent rester
explicitement contrôlés. Cette documentation établit le mécanisme, pas sa présence dans Yolo.

## Contrats à qualifier avant promotion

- **FFI et panic** : [catch_unwind Rust 1.99](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html)
  ne récupère que les panics déroulantes. Le profil `runtime` utilise unwind,
  `release` utilise abort : conserver cette séparation et vérifier l'artefact
  réellement livré. Aucune faute mémoire n'est rendue récupérable par catch_unwind.
- **Bun FFI** : [documentation officielle](https://bun.sh/docs/runtime/ffi) sur
  handles, fermeture et callbacks ; vérifier lifetime/unload et threads contre
  le Bun 1.4.2 installé. Documentation live sans garantie de correspondance exacte
  au fork ; les guards existants ne prouvent pas R3/R4.
- **Permissions desktop/browser** : [capabilities Tauri v2](https://v2.tauri.app/security/capabilities/)
  fournit la référence conceptuelle d'accès par fenêtre et origine. Yolo utilise
  un fork Tauri 3 alpha : vérifier le contrat local, pas déduire la compatibilité.
  Providers réservés et tests de refus d'origine/droits restent des prérequis.
- **Python** : PyO3 épinglé 0.29.3 ; [guide de la famille 0.29](https://pyo3.rs/v0.29.0/free-threading.html).
  `py.detach` ne transforme pas CPython 3.12 en interpréteur sans GIL. Versions
  et extension compilable ne suffisent pas à qualifier la trinité distribuée.
- **uv** : [locking/sync](https://docs.astral.sh/uv/concepts/projects/sync/) :
  `uv run` peut résoudre/synchroniser. Une sonde de version ne doit pas être
  présentée comme totalement sans effet sur l'environnement sans contrôler ses options.

Ces points sont des obligations de qualification ; aucune vulnérabilité exploitable
ni régression nouvelle FFI/Python n'est démontrée par ce relevé.

## Résultat de aphrody docs

Les cinq requêtes conceptuelles n'ont retourné aucun dépôt. Les requêtes simples
`bun`, `tauri`, `pyo3` ont retourné des résultats : Bun et PyO3 incluent leurs
propriétaires, Tauri renvoie deux applications tierces. Les résultats tiers
n'ont pas été utilisés comme preuves techniques. La sortie observée fournit
une recherche GitHub ; elle ne prouve pas que Context7 et Microsoft Learn ont
été interrogés. Sources officielles consultées en complément.

### Correction des métadonnées de livraison, 2026-10-04

Les deux workflows utilisent désormais `macos-15-intel` pour x64 et `macos-15`
pour ARM64, selon le [catalogue officiel épinglé](https://github.com/actions/runner-images/blob/6d942e630479cd99a93dadfc766af11242bfa402/README.md).
Avant compilation, ils exigent que le host Rust et la cible native Bun correspondent
à la matrice. La configuration C2 est corrigée ; build et exécution sur macOS
restent à qualifier. Le relevé initial ci-dessus décrit les workflows avant correction.

`templates/stack.toml` annonce maintenant ABI 1.4, identique au producteur et
au SDK. C4 est fermé pour cette métadonnée : comparaison avec les constantes SDK
et suite scaffold passent. Cela ne qualifie pas les assets de release C3.

Les sondes SSH du même lot trouvent Bun 1.4.2, Rust/Cargo 1.98.1 et sccache 0.18.0
sur `vps` et `dbfr`. `/srv/aphrody-build` est absent sur les deux hôtes ; DBFR
dispose de 7 227 445 248 octets libres (93 % utilisés). La fabrique C1 reste à
qualifier sur sa source épinglée et ses artefacts, selon le workflow Infra.
Le [reçu de correction](delivery-metadata-2026-10-04.json) distingue ces preuves.

Aucune donnée privée ni source du dépôt n'a été envoyée dans les requêtes.
Les gates runtime/MSVC/multicibles et l'état courant GitHub Actions/releases
restent non requalifiés. Voir [fact-check](FACT-CHECK-2026-10-04.md) et [plan](../PLAN.md).
