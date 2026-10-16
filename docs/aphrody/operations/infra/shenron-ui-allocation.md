<!-- SPDX-License-Identifier: Apache-2.0 -->

# Allocation UI de Shenron dans la fabrique canonique

L'allocation `ui` de `tools/config/build-factory.json` déclare une exception étroite
au verrou global des compilations natives : le lot Shenron réutilise exclusivement
des bibliothèques FFI/RE, MCP et WASM qualifiées, vérifie l'absence de modification
de leurs sources et ne lance aucune compilation Cargo ni moteur. Un changement
natif refuse cette route et rejoint le propriétaire natif sous `heavy.lock`.

Ce job appartient à la même fabrique, utilise son `artifactRoot`, son transport
Infra et un worktree Git du clone canonique. Son verrou `ui.lock` limite la classe
à un job. Le worktree reste sous `artifactRoot/ui/jobs`, hors de `transient`, dont
le nettoyage peut avancer indépendamment. Le verrou natif reste inchangé.

Avant chaque lancement, requalifier au moins 20 Gio de mémoire disponible
(12 Gio UI et 8 Gio de réserve), 32 Gio de disque disponibles (12 Gio de travail
et 20 Gio de réserve), et 10 CPU logiques (6 natifs et 4 UI). Le processus UI
est borné par le cgroup systemd : `MemoryMax=12G`, `MemorySwapMax=0`,
`CPUQuota=400%`, timeout global 5400 s. `build-factory-ui.ts qualify` refuse
une lease inexistante, une capacité inconnue ou des limites kernel différentes.
Aucun marqueur du verrou natif n'est transmis à cette classe.

Les recettes doivent qualifier la fraîcheur du WASM avant le build Next, refuser
toute reconstruction native et conserver les gates de source, de payload public,
de paquet, d'image et de relecture. La mise en image réutilise le Dockerfile et
ses couches déjà qualifiées ; tout changement de ses étapes natives rejoint la
file globale. Les stores, volumes, caches partagés et autres jobs restent préservés.
La livraison et l'activation DBFR continuent par les adaptateurs Infra scellés.

Qualification du 14 octobre 2026 : VPS 12 CPU, 32,2 Gio disponibles, disque build
56 Gio libres. Un scope réel a retourné `memory.max=12884901888`,
`memory.swap.max=0` et `cpu.max=400000 100000`. Cette preuve datée ne remplace
pas la qualification au démarrage du prochain job.
