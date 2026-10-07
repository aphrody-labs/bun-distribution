# Architecture cible de aphrody-kernel

Directive du propriétaire, 2026-10-07 : viser la structure d'Asterinas (`ostd/` TCB minimal, `kernel/{core,comps,libs}`,
`osdk/`, `tools/`) et la découpe par sous-systèmes de Linux (`kernel`, `mm`, `fs`, `net`, `ipc`, `security`, `drivers`, `lib`).
Sources relevées avec `aphrody git ingest https://github.com/asterinas/asterinas` et l'API GitHub (arbre de `torvalds/linux`),
sans clone. Ce plan ordonne le travail ; ses cases ouvertes ne décrivent pas une livraison.

## Correspondance

| Cible | Rôle (Asterinas / Linux) | Crates `crates/os/*` actuelles |
| --- | --- | --- |
| `ostd` (TCB) | Seul code privilégié : types de base, registre de sous-systèmes, événements, garde, processus | `base`, `subsystem`, `events`, `guard`, `proc`, `stdio-capture`, `secrets` |
| `kernel/core` | Noyau : routeur MCP, transport, politique, audit (`kernel/` Linux) | `kernel`, `kernel-client` |
| `kernel/comps` | Composants branchés sur `SystemSubsystem` (`drivers/` Linux) | `a2a-*`, `cron`, `jobs`, `task-runner`, `telemetry`, `diagnostics`, `systemd`, `drive`, `winclean`, `compat`, `coreutils`, `re`, `sandbox`, `backend` |
| `kernel/libs` | Bibliothèques sans état (`lib/`, `fs/` Linux) | `fsindex`, `everything-sdk`, `execpolicy`, `capture` |

## Règles

- Un composant ne dépend que d'`ostd` et de `kernel/core` par `SystemSubsystem` ; jamais d'un autre composant.
- Fusion d'abord (une crate mince absorbée par son seul dépendant), déplacement de dossier ensuite, avec preuve de gates.
- Les identités publiques (noms de crate, binaires, schémas MCP) ne changent qu'avec une dépréciation datée.

## File

- [ ] `everything-sdk` dans `fsindex` ; `base` + `backend` ; `stdio-capture` dans `base`.
- [ ] Regrouper `ostd` (base, subsystem, events, guard, proc, secrets) sous un dossier unique.
- [ ] Regrouper les composants sous `kernel/comps`.
