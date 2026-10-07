<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web sur les VPS

État vérifié le 2026-10-07 : `vps` et `dbfr` exécutent le moteur natif
Obscura de la CLI multicall Aphrody. Les unités
[`aphrody-web-browser-vps.service`](../../../config/host/systemd/aphrody/aphrody-web-browser-vps.service)
et [`aphrody-web-browser-dbfr.service`](../../../config/host/systemd/aphrody/aphrody-web-browser-dbfr.service)
ont été composées, vérifiées et activées par le propriétaire Infra :

```sh
bun packages/engine/core/src/host/cli.ts host-plan aphrody-web-browser-vps --target vps --observe
bun packages/engine/core/src/host/cli.ts host-apply aphrody-web-browser-vps --target vps --apply
bun packages/engine/core/src/host/cli.ts host-plan aphrody-web-browser-dbfr --target dbfr --observe
bun packages/engine/core/src/host/cli.ts host-apply aphrody-web-browser-dbfr --target dbfr --apply
```

Les deux services sont `enabled`, `active/running`, sans redémarrage observé.
CDP écoute sur `127.0.0.1:9222`; `/json/version` répond et le WebSocket
`ws://127.0.0.1:9222/devtools/browser` accepte les commandes. Aucun accès
`file://` n'est activé. Le HOME du service est le store Web privé, isolé des
identifiants personnels. Les cookies et autres authentifications existants
conservent leurs stores.

Le binaire qualifié porte le SHA-256
`4e51190ca80efab50df4b3f351c2be60b41815c2566a6a9e456d4077a761c296`.
VPS utilise `/home/ubuntu/.local/bin/aphrody`; DBFR utilise la copie immuable
`/home/ubuntu/.local/lib/aphrody/shenron-4e51190ca80efab5/aphrody`.
L'entrée CLI `/home/ubuntu/.local/bin/aphrody` de DBFR est également installée
et porte ce même SHA-256.
Les candidats `.sync-*` d'une autre session sont préservés. Aucune nouvelle
compilation du moteur n'a été nécessaire.

## Crawl et indexation

Le script [`crawl-index.ts`](../../../scripts/tools/web/crawl-index.ts)
orchestre les propriétaires natifs `aphrody web crawl` et `aphrody home index`
sur l'hôte choisi, en passant par `aphrody infra ssh exec` :

```sh
bun scripts/tools/web/crawl-index.ts --host vps --label native-smoke --seed https://aphrody.com --max-requests 1 --max-depth 0
bun scripts/tools/web/crawl-index.ts --host dbfr --label native-smoke --seed https://aphrody.com --max-requests 1 --max-depth 0
```

Les nouvelles tâches choisissent un label et leurs URL de départ explicites.
Le worker Codex sur VPS peut appeler la copie portable installée :

```sh
bun /home/ubuntu/.aphrody/private/web/tools/crawl-index.ts --local --host vps --label omar-example --seed https://aphrody.com --max-requests 25 --max-depth 2
```

`--local` exécute directement les propriétaires natifs sur l'hôte sélectionné,
sans connexion SSH vers lui-même. La même copie est installée sur DBFR. Depuis
le poste ou un hôte ayant les alias SSH Infra, omettre `--local` pour cibler
l'autre hôte. L'orchestrateur résout `aphrody` sur le PATH et n'impose aucun
chemin propre au poste WSL.

Le script limite les requêtes et la profondeur, restreint les domaines aux URL
de départ, respecte `robots.txt`, limite chaque hôte à une requête simultanée
avec une seconde de délai et deux retries. Chaque commande native possède une
limite de trente minutes, puis un arrêt forcé dix secondes après si nécessaire.
Il n'active aucun daemon de collecte.

Chaque label conserve son frontier SQLite et les documents Markdown sous
`/home/ubuntu/.aphrody/private/web/jobs/<label>/` : répertoires `0700`, fichiers
`0600`. Le SHA-256 de l'URL détermine le nom du document. Le rapport brut reste
sur la cible; la console n'expose que les compteurs. Le verrou `running/`
contient le PID du processus et sa date : avant toute récupération d'un verrou
orphelin, vérifier ce PID sur la cible, jamais déduire la fin d'une tâche du
seul âge du verrou.

L'index utilise le profil Aphrody natif et sa base unique :
`/home/ubuntu/.aphrody/workspace-aphrody/db/aphrody.sqlite`. Le label de source
est `web:<label>`. Les profils DBFR/Shenron et IE restent séparés. Exemple de
recherche depuis la cible :

```sh
aphrody home query Aphrody --profile aphrody --kind chunk --limit 5
```

## Preuves et limites

Sur chacun des deux hôtes, le crawl de `https://aphrody.com` a obtenu HTTP 200,
une page et zéro erreur : frontier `pending=0`, `locked=0`, `done=1`, `failed=0`.
L'indexation a créé un document et un chunk; la recherche a retrouvé la source
`web:native-smoke`. Une nouvelle exécution sur VPS a tenté zéro requête, en
conservant le document déjà recherchable.

Le test CDP a créé un onglet, exécuté du JavaScript manipulant le DOM
(`sum=3`, titre `Aphrody Native Render`) puis capturé un PNG de 1280 × 720,
11 348 octets. Le décodage du PNG a trouvé 17 849 pixels verts correspondant au
rectangle de test, sur les deux hôtes. L'onglet a ensuite été fermé. Les
preuves restent dans le store privé `web/smoke/` de chaque cible.

Le probe stdio de `/home/ubuntu/.local/bin/aphrody-mcp` a annoncé 127 outils sur
chacun des hôtes, dont crawl, navigation, évaluation, capture et extraction Web.
Ce binaire installé n'annonce pas `aphrody_home_query`; la CLI native `home
query` fonctionne. Les bases qualifiées ont zéro vecteur : la preuve porte
sur la recherche lexicale, pas sur une indexation vectorielle. Les URL de
collecte métier viennent des tâches autorisées; ce smoke ne prouve pas une
couverture exhaustive du Web ni l'authentification à des sites privés.

Les cinq tests ciblés du script, TypeScript strict, oxlint et oxfmt passent.
`systemd-analyze verify` a accepté les deux unités composées. Le contrôle global
du catalogue signalait quatre unités Shenron concurrentes non listées; aucune
correction n'a été apportée aux chemins de cet autre chantier.
