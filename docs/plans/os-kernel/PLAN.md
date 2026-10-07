# Architecture cible de aphrody-kernel

Directive du propriétaire, 2026-10-07 : viser la structure d'Asterinas (`ostd/` TCB minimal, `kernel/{core,comps,libs}`,
`osdk/`, `tools/`) et la découpe par sous-systèmes de Linux (`kernel`, `mm`, `fs`, `net`, `ipc`, `security`, `drivers`, `lib`).
Sources relevées avec `aphrody git ingest https://github.com/asterinas/asterinas` et l'API GitHub (arbre de `torvalds/linux`),
sans clone. Ce plan ordonne le travail ; ses cases ouvertes ne décrivent pas une livraison.

## Correspondance

| Cible | Rôle (Asterinas / Linux) | Propriétaires source actuels |
| --- | --- | --- |
| `ostd` (TCB) | Seul code privilégié : types de base, registre de sous-systèmes, événements, garde, processus | `crates/os/ostd/{backend,subsystem,guard,proc,secrets}` ; `base` et `stdio_capture` sont des modules de `backend` ; les événements fusionnés restent dans `kernel/core` |
| `kernel/core` | Noyau : routeur MCP, transport, politique, audit (`kernel/` Linux) | `crates/os/kernel/core` (`aphrody-kernel`), `crates/os/kernel/client` (`aphrody-kernel-client`) |
| `kernel/comps` | Composants branchés sur `SystemSubsystem` (`drivers/` Linux) | `crates/os/kernel/comps/{a2a-*,cron,jobs,task-runner,telemetry,diagnostics,drive,winclean,re,sandbox}` ; `systemd`, `compat` et `coreutils` sont déjà des modules de `kernel/core` |
| `kernel/libs` | Bibliothèques sans état (`lib/`, `fs/` Linux) | `crates/os/kernel/libs/{fsindex,capture}` ; `everything-sdk` est un module de `fsindex`, `execpolicy` un module de `kernel/core` |

## Règles

- Un composant ne dépend que d'`ostd` et de `kernel/core` par `SystemSubsystem` ; jamais d'un autre composant.
- Fusion d'abord (une crate mince absorbée par son seul dépendant), déplacement de dossier ensuite, avec preuve de gates.
- Les identités publiques (noms de crate, binaires, schémas MCP) ne changent qu'avec une dépréciation datée.

## File

- [x] `everything-sdk` dans `fsindex` (fait).
- [x] `coreutils`, `compat`, `systemd` dans `kernel` (fait).
- [x] `base` et `stdio-capture` absorbés dans `aphrody-backend` (modules `base`, `stdio_capture`).
- [x] `events` et `execpolicy` repliés dans `kernel` (modules `events`, `execpolicy`).
- [x] Regrouper `ostd` (backend/base/stdio-capture, subsystem, guard, proc, secrets) sous un dossier unique ; événements déjà fusionnés conservés dans `kernel/core`.
- [x] Regrouper les composants sous `kernel/comps`, le client sous `kernel/client` et les bibliothèques sous `kernel/libs`.
- [ ] Qualifier la règle d’indépendance des composants : les liens A2A client/server/pb et winclean/re restent à fusionner ou à extraire chez leur propriétaire.

## Qualification du regroupement (2026-10-07)

Les 22 identités de crates du workspace OS restent inchangées. Les 2 117 fichiers
suivis sont conservés sous les chemins ci-dessus ; aucun fichier source manquant.
Le workspace Drive FSL reste autonome et exclu du workspace Apache-2.0.
Le déplacement de dossiers ne qualifie pas à lui seul la règle d’indépendance des
composants, la compilation de Drive ni l’activation d’un nouveau binaire.

Gates sur le VPS, via `bun scripts/build/rust/vps-cargo.ts run --`, pour les
22 packages OS (liste issue de `cargo metadata --no-deps`) :

- Snapshot `5afea21ab1b6` : `check --all-targets --locked`, passé, 44,82 s.
- Snapshot `2ba687d91318` : `test --locked`, passé ; 943 tests, 0 échec,
  3 ignorés préexistants, 59 suites unitaires/intégration/doctest ; compilation 1 min 09 s.
- Snapshot `e1a7de359097` : `clippy --all-targets --locked -- -D warnings`,
  passé, 17,23 s.

Consommateurs Bun : 13 tests Drive/A2A/inventaire imbriqué, 60 assertions ;
28 tests de consolidation documentaire ; TypeScript Workspace et A2A, format
scopé validés. Quatre avertissements oxlint préexistants restent dans l’inventaire.
Les sources de licence/provenance et les identités publiques sont préservées ;
aucune performance, publication, installation ou activation runtime n’est revendiquée.
