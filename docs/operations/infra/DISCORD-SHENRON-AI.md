<!-- SPDX-License-Identifier: Apache-2.0 -->
# Discord Aphrody et Shenron : raccordement IA

Le serveur privé cible est `1554189180030947338`. Le salon général textuel
est `1554189195201740803`. Yoyo `281114294152724491` et Omar
`1527405876695142620` sont membres avec le rôle administrateur, vérifié via
l'API Discord le 2026-10-07. Le second compte Omar `1323725494184841256`
n'est pas membre à cette date.

## Aphrody actif

La politique [discord-ai-lab.json](../../../config/host/discord-ai-lab.json)
sélectionne général par `assistant.channelId`. Le kit Discord conserve le salon
assistant comme défaut pour les anciennes politiques sans cette propriété.
Une mention d'Aphrody ou `Aphrody, <question>` déclenche le modèle local pour
le propriétaire, un administrateur ou un chercheur. Les bots et webhooks sont
ignorés. Le bot vérifie le serveur du salon avant de commencer ; les réponses
sont bornées, sans mentions et référencent le message utilisateur.

Le [service déclaré](../../../config/host/systemd/aphrody/aphrody-discord-ai-lab.service)
utilise `/srv/aphrody-lab/assistant.mjs`, la politique et les états privés sous
`/srv/aphrody-lab/state`. L'authentification reste dans `/etc/aphrody-discord.env`.
Le déploiement passe par le plan propriétaire :

```sh
bun packages/engine/core/src/host/cli.ts host-plan aphrody-discord-ai-lab.service --target vps
bun packages/engine/core/src/host/cli.ts host-apply aphrody-discord-ai-lab.service --target vps --apply
aphrody infra ssh service --host vps --action restart aphrody-discord-ai-lab.service
```

Avant activation, bundler `packages/discord/kit/src/lab/assistant.ts` avec Bun,
transférer le bundle et la politique par le transport authentifié Infra, vérifier
leurs empreintes et construire l'état depuis les IDs réellement lus sur Discord.
Ne pas relancer la configuration des salons pour déplacer une conversation.
Ne pas envoyer de message de smoke sans instruction du propriétaire.

Preuve live du 2026-10-07 : processus `3198065`, état `active/running`, journal
`ready` avec la guilde cible, général et `gemma4-e2b` à 11:41:41 UTC. Une requête
d'inférence réelle a répondu `LAB_OK`, sans message publié. Bundle SHA-256 :
`4d7800887603c44aec18b5629dc9d8c0f32ad0614cd411bff8b1e51386aa3d5b`.
Kit : 43 tests réussis, TypeScript et build passent. Cela ne prouve pas encore
une conversation humaine complète ni l'exécution d'outils A2A ou de training.

## Shenron et backends restants

Shenron `1497194276025663680` tourne dans le conteneur DBFR existant ; l'environnement
protégé cible encore la guilde `934894610545770506`. Les sondes avec son propre
jeton renvoient HTTP 404 pour la guilde Aphrody et 403 pour général. Un administrateur
doit l'installer par OAuth avant la bascule de `GUILD_ID`, `SHENRON_AI_CHANNEL_ID`
et `ADMIN_LAB_CHANNEL_ID`. Ne pas arrêter la production pour une guilde inaccessible.
Le dépôt privé Shenron porte le relais général et les contrôles des commandes admin.

L'inférence chat, les embeddings et le compute Shenron sont actifs sur DBFR ;
Aphrody garde son modèle sur VPS. L'[architecture de production](../../../config/production-topology.json)
place les entraînements sur `omar-wsl`. L'inventaire SSH local n'offre actuellement
aucun accès à ce poste ; `aphrody train --help` sur le binaire local annonce une
feature train absente. Une liste de salons training ne prouve aucun job exécuté.

La fédération A2A ne fournit aucun URL de peer dans `aphrody a2a peers` à cette
vérification. Le service déclaré conserve un mode dry-run et ne constitue pas
une exécution de tâche. Qualifier l'authentification, les endpoints et un résultat
réel avant d'annoncer la couche IA/train/A2A complètement installée.

## Drive, agent homes et WireGuard

Les salons privés `drive` (`1557358565155676210`) et `chat`
(`1557358568523571225`) existent dans la catégorie de synchronisation du serveur.
La [déclaration](../../../config/host/discord-control-plane.json) conserve leurs
IDs vérifiés et le dossier Drive DBFR `1RTkDa77DQBH-zpQLmjPSngksrcJznkxa`.
Le connecteur natif Markdown en téléchargement a constaté trois documents
inchangés, deux versions locales en avance et deux versions distantes staged.
Ces versions restent dans les magasins privés de rapprochement : aucune écriture
Drive ni résolution automatique des conflits n'a été exécutée.

Le MCP natif `sync_external_agents` a collecté 64 779 entrées sur 274 sources
locales (165 mises à jour), avec la mémoire désactivée. Ces miroirs protégés
Codex/AGY/Claude ne constituent ni une fédération des PC ni une synchronisation
des mémoires des fournisseurs. Les deux agent homes SSH DBFR et Shenron existent.

Le [service de suivi](../../../config/host/systemd/aphrody/aphrody-discord-control-plane.service)
et son [timer](../../../config/host/systemd/aphrody/aphrody-discord-control-plane.timer)
vérifient toutes les deux minutes les destinations Discord, les agent homes et
les reçus locaux. Ils publient uniquement des compteurs dans `drive` et l'état
du tunnel dans `ops-alerts`, sans mentions. Un reçu Drive/agents de plus de dix
minutes est signalé comme périmé ; aucune réplication périodique de contenu
n'est revendiquée. Le suivi réutilise le reçu WireGuard de la télémétrie du lab :
au-delà de cinq minutes il indique un état inconnu plutôt qu'une connexion.
La tâche s'exécute comme `ubuntu`, sans droit réseau privilégié ni écriture dans
les dossiers d'authentification. Son répertoire de travail est le dossier d'état
protégé, où le client Infra conserve ses propres reçus d'exécution.
Activation vérifiée à 11:55:35 UTC le 2026-10-07 : timer actif,
`Result=success`, `ExecMainStatus=0`, deux homes présents et rapports envoyés.

Le plan Infra sait composer les deux unités mais `host-plan` refuse les timers.
Pour ce cas, les unités composées passent par `infra ssh exec`, vérification
`systemd-analyze verify`, installation root en 0644 et activation du timer.
Le bundle et la déclaration transférés sont vérifiés par SHA-256 ; les états
restent en 0600 sous `/srv/aphrody-lab/state`.

Preuve du 2026-10-07 : le tunnel `wg1` relie VPS, WSL et DBFR. Les peers Windows
`aphro-pc` et `omar` n'ont encore aucun handshake. Le serveur Discord expose le
suivi ; les transferts réseau restent sur WireGuard/SSH. Le client Yolo installé
sur VPS ne possède pas encore la commande `google` et aucun transfert de jeton
Drive depuis le poste local n'a été effectué. `chat` reste disponible pour la
liaison des agents après qualification de leurs endpoints et de l'installation
du bot Shenron ; il n'est pas une conversation autonome déjà opérationnelle.
Windows est accessible depuis WSL, mais cette session PowerShell n'a pas le rôle
administrateur et aucune unité de tunnel WireGuard n'est installée. L'activation
du tunnel privé du PC nécessite donc son administration locale ; aucune clé de
remplacement ni élévation interactive n'a été déclenchée.
