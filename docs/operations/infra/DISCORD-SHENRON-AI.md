<!-- SPDX-License-Identifier: Apache-2.0 -->
# Discord Aphrody et Shenron : raccordement IA

Le serveur privé cible est `1554189180030947338`. Le salon général textuel
est `1554189195201740803`. Yoyo `281114294152724491` et Omar
`1527405876695142620` sont membres avec le rôle administrateur, vérifié via
l'API Discord le 2026-10-07. Le second compte Omar `1323725494184841256`+n'est pas membre à cette date.

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
