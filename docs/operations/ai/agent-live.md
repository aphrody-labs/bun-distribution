<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agents et monorepo en direct

Le propriétaire est `@aphrody/workspace`. Le collecteur réutilise le Kernel
(`github_status`, `nu_eval`) et `aphrody-session::external` via
`aphrody ai sync-sessions --json --no-memory`. Il n'ajoute aucun magasin de
conversations ou de mémoire. Le service `aphrody-agent-session-sync` continue
d'alimenter la mémoire canonique et les conversations communes.

```sh
yolo ops agent-live --watch
yolo ops agent-live --json
systemctl --user status aphrody-agent-live.service
```

Chaque passe publie atomiquement `.coord/shared/LIVE.json` (not in repo) et `LIVE.md`, privés
et ignorés par Git. Le service de référence est
l’unité `aphrody-agent-live.service` du catalogue yolo, avec une période de 30 s.
Le runner A2A fournit aussi `LIVE.md` aux nouveaux agents.

La projection contient PID, parent, date de démarrage, executable, cwd,
sessions natives candidates, derniers outils, arguments explicites de chemin,
propriétaire Cargo/Bun, métadonnées des enveloppes A2A, mémoire canonique,
branche, HEAD et cinq commits récents. Les propriétaires sont lus depuis les
déclarations actuelles Cargo/Bun, avec les exclusions Cargo ; aucune ancienne
carte de migration n'est utilisée. Les lectures JSONL sont limitées à 256 Kio
par fichier et excluent les lignes partielles. Les prompts, raisonnements,
arguments shell et corps des messages ne sont pas publiés dans la vue live.

Les modèles locaux sont observés via les processus Kernel et les fichiers
`$APHRODY_HOME/run/llama-server-<role>.json` du superviseur existant. Un état
enregistré ou un PID correspondant ne prouve pas une disponibilité HTTP ;
le champ `health` reste explicitement `unchecked`.

## Attribution et runs

Le lien habituel session/processus est une **candidature par agent et cwd**,
avec toutes les sessions candidates, et peut être ambigu. La vue exclut les
threads Linux grâce au relevé des processus principaux du Kernel. Le probe
natif exclut désormais aussi les threads. Une session historique n'est pas
présentée comme un agent actuellement actif.

Chaque nouveau lancement via `PeerInvoker` crée
`.coord/shared/runs/<run_id>.json` et transmet `APHRODY_RUN_ID` au processus.
Le journal relie exactement le lanceur, son enfant, le peer et le checkout.
Il contient les horaires, le code de sortie et les HEAD observés au début et
à la fin. Pour Codex, l'événement natif `thread.started` fournit le session ID
à la fin du run. Les sorties natives restent inchangées et ne sont pas
stockées dans ce journal. Les anciens processus lancés en dehors du runner
restent des observations ; ils ne reçoivent pas rétroactivement une identité
de run. Un run sans fin et sans processus correspondant est signalé comme
`unobserved_or_stale`.

Les chemins d'actions reflètent uniquement des arguments explicites d'outil.
Le propriétaire d'un fichier est une crate/package, pas son auteur. Un
changement de HEAD durant un run ne prouve pas que ce run a créé le commit.
Les modifications Git et commits gardent donc `agent: null`.
Les IDs `external:<agent>:<session>:<offset>:<part>` identifient les records
canoniques ; leur présence effective en base mémoire n'est pas vérifiée par
ce collecteur. Le probe local et les lectures Git/session ne constituent pas
une transaction unique ; `sampled_at` date la fin du relevé.

La console limite la liste aux douze sessions les plus récentes. Le JSON
conserve les sessions du checkout et cent journaux de runs récents. Les erreurs
des providers apparaissent dans `issues` ; un provider absent n'est jamais
présenté comme une observation réussie.
