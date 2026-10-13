# Transport des sous-modules privés en CI

Le runner existant `aphrody-gitea-runner` 5.0.0 utilise le réseau
`aphrody_default` et la même instance Gitea que la forge publique. Les jobs
`aphrody-bun-linux` résolvent `bun-forge` vers `gitea:22` ; le port
`127.0.0.1:29022` appartient à l'hôte VPS, pas au conteneur du job.

## Propriétaire et fichiers

La source Infra est
`tools/config/host/apps/vps/gitea-runner/{config.yaml,ssh/config,ssh/known_hosts}`
dans le dépôt Aphrody. Le déploiement existant du runner est
`/home/ubuntu/apps/gitea-runner`. Les deux fichiers SSH publics doivent y être
installés sous `ssh/`, avec leur contenu source exact, avant toute admission
d'un job utilisant cette configuration. Leur réinstallation est idempotente.
Le compose, l'image du runner et son inscription restent ceux de l'instance
existante.

La clé reste exclusivement dans
`/home/ubuntu/.aphrody/secrets/gitea/bun-os-crate-runner`, propriétaire `ubuntu`,
mode `0600`, répertoire `0700`. Elle est montée directement en lecture seule
dans les jobs à `/run/aphrody/git-ssh/identity`. Aucun contenu de clé n'entre
dans Git, les variables du workflow, les arguments de processus ou les logs.
Les chemins sources des bind mounts sont résolus par le daemon Docker du VPS ;
la clé n'a pas à être copiée ni montée dans le conteneur du runner.

Le fichier SSH impose une seule identité, ED25519 et la vérification stricte
de l'hôte. `GIT_SSH_COMMAND` sélectionne ce fichier avant `builtin:checkout`.
Les volumes autorisés sont les seuls fichiers nécessaires, en lecture seule.
L'alias est générique : les autorisations proviennent des deploy keys des
dépôts privés, ce qui permet d'ajouter des gitlinks sans modifier le transport.

## Qualification effectuée

Le 13 octobre 2026, la clé publique présentée par le port loopback VPS 29022
et celle du conteneur Gitea sur `aphrody_default:22` ont toutes deux donné :

```text
SHA256:M48ORSUT/TU1sYsWPunaXwQliH0bUVRviGx7m4gWOAs
```

Le fichier `known_hosts` contient cette clé publique, sous l'alias
`bun-forge`. Les permissions du secret existant ont été vérifiées sans lire
son contenu. La version et le schéma de configuration proviennent du binaire
`gitea-runner` 5.0.0 réellement installé.

Cette livraison prépare les sources. Aucun redémarrage du runner, activation
Compose ou lancement de job n'a été effectué. La lecture des dépôts privés
depuis un vrai job reste à qualifier après installation de ces fichiers par
le propriétaire Infra. Il faut notamment vérifier la présence de `git` et
`ssh` dans l'image de job épinglée, les droits de lecture de la clé dans le
job et les autorisations de chaque gitlink privé, sans afficher la clé.

## Workflow produit

Les push sur `main` et `os` exécutent les contrôles source. Le checkout utilise
les sous-modules directs et conserve les révisions épinglées. L'installation
emploie `bun install --frozen-lockfile`, puis le propriétaire
`scripts/node-modules.ts` finalise l'installation partagée.
Les builds natifs restent limités au dispatch explicite avec `build=true`,
après admission de l'hôte. Cette préparation ne qualifie ni un job complet ni
un build natif.
