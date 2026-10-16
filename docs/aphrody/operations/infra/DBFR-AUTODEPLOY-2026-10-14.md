# Synchronisation et déploiement Shenron

Le 14 octobre 2026, le propriétaire a demandé la synchronisation automatique de
Shenron sur `main`, le déploiement des services et le retrait des composants legacy.
La déclaration hôte est [shenron-autodeploy.json](../../../../infra/config/host/dbfr/shenron-autodeploy.json).

## Fonctionnement installé

DBFR synchronise `/home/ubuntu/src/shenron` toutes les deux minutes avec
`shenron-main-sync.timer`. Un arbre modifié, une branche différente ou des commits
divergents font échouer la synchronisation sans écrasement ni stash.

Sur la fabrique `vps`, `shenron-main-deploy.timer` vérifie `main` toutes les cinq
minutes. Le runner utilise le verrou lourd existant et un worktree dédié au SHA,
qualifie Bun et Rust, construit les binaires et l'image, puis livre l'image scellée.
Les limites du runner sont 12 Go de mémoire et quatre CPU ; le daemon Docker reste
extérieur à son groupe de contrôle. Le destinataire utilise l'adaptateur Docker
canonique d'Infra pour vérifier et activer uniquement la release site/bot/gateway.
PostgreSQL, Redis, modèles, secrets et médias restent dans leurs stores protégés.

Les scripts versionnés vivent dans
[`scripts/release/shenron-autodeploy`](../../../../scripts/aphrody/release/shenron-autodeploy).
Les unités se trouvent dans
[`tools/config/host/systemd/shenron`](../../../../infra/config/host/systemd/shenron).
Les copies exécutées sont installées sous `/home/ubuntu/.config/shenron-autodeploy`
et les unités système sous `/etc/systemd/system`. Le récepteur utilise les scripts
canoniques installés sous `/usr/local/libexec/shenron-autodeploy` : l'adaptateur et
le sealer de `scripts/release`, puis l'assembleur versionné de Shenron
`scripts/ops/dbfr/assemble-shenron.py`.

Les archives de transfert sont supprimées après réception. Le reçu transactionnel
de l'adaptateur n'est supprimé qu'après une activation réussie et la santé publique
vérifiée. Les fichiers applicatifs historiques ne sont pas supprimés sur leur seul âge.

## Preuves et limites

Le checkout DBFR est propre à `11d73af8e43cf7d6725f28ffc5c7170331b1c502`,
identique à `origin/main`. Le timer est activé et actif, sa première exécution a
réussi. Syntaxe Bash et unités systemd vérifiées. Le récepteur a réellement reçu,
vérifié et chargé l'image déjà active `9bd60d67`, puis terminé sans redéploiement ;
son archive temporaire a été supprimée.

Le timer fabrique est activé et actif. Installation figée, typage, lint et format
réussis ; première qualification complète encore en cours au dernier contrôle.
Cela ne prouve pas que `11d73af8` est déjà déployé. La production conserve sa release
qualifiée tant qu'une nouvelle image n'a pas passé les portes.

## Audit et nettoyage appliqués

DragonBallFR, ses assets CDN, son bot et sa redirection MCP sont servis par DBFR.
Nginx relaie le site sur 5011, le bot sur 5006 et l'origine CDN native sur 9077.
La racine publique et `/wiki` répondent 200 ; les assets testés des deux origines
CDN répondent 200. `www` redirige maintenant vers l'apex HTTPS sans port interne,
en conservant le chemin et la query. Cette correction et son hash sont appliqués
à la configuration Nginx de la release active, conservée par l'assembleur.
Aphrody public pointe vers l'autre VPS. RoseGriffon est intercepté par son Worker
de maintenance et répond 503 : aucune suppression DNS n'a été effectuée.

Les neuf conteneurs retirés, les unités Discord Labs et le déclencheur de
chronologie dépendant de l'ancien backend AI sont listés dans la déclaration hôte.
L'ancien timer utilisateur de fabrique ciblant `bun-probe` a été désactivé pour ne
pas relancer le conteneur supprimé. Treize conteneurs restants ont des rôles distincts ;
aucun doublon Docker/natif confirmé. Les anciennes images inutilisées ont été retirées.

Caches de paquets et fichiers temporaires inutilisés purgés sans archive.
`/tmp` reste à 4 Ko de fichiers actifs, le disque a environ 17 Go disponibles.
APT/dpkg sont cohérents et un seul noyau est installé : `7.0.0-38-generic`, actif.
Ces chiffres sont datés et doivent être relus avant une autre intervention.
