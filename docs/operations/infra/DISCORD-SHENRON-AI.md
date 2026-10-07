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
minutes est signalé comme périmé. Le suivi réutilise le reçu WireGuard de la télémétrie du lab :
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

Preuve du 2026-10-07 : le tunnel `wg1` relie VPS, WSL, DBFR et le Windows
`aphro-pc`, dont le service WireGuard et le handshake sont maintenant vérifiés.
Le peer `omar` reste sans handshake. Le serveur Discord expose le
suivi ; les transferts réseau restent sur WireGuard/SSH. Le client Yolo installé
sur VPS ne possède pas encore la commande `google` et aucun transfert de jeton
Drive depuis le poste local n'a été effectué. `chat` reste disponible pour la
liaison des agents après qualification de leurs endpoints et de l'installation
du bot Shenron ; il n'est pas une conversation autonome déjà opérationnelle.
L'activation Windows a été constatée pendant la session ; aucune élévation
interactive ni export de clé privée n'a été déclenché par ce chantier.

## Synchronisation automatique des magasins privés

La [déclaration de synchronisation](../../../config/host/agent-sync.json) et les
unités utilisateur [service](../../../config/host/user/aphrody-agent-sync.service)
et [timer](../../../config/host/user/aphrody-agent-sync.timer) sont installées et
actives sur le poste WSL. Le timer vérifie les échéances chaque minute : Drive et
les collecteurs natifs Codex/AGY/Claude toutes les cinq minutes, indexation locale
des versions Drive staged chaque heure, vérification et sauvegarde des homes
`dbfr` et `aphrody` chaque jour. Un échec conserve le dernier succès et réessaie
avec un délai de une minute à une heure ; les autres tâches continuent. Chaque
tâche écrit son checkpoint avant la suivante, et le verrou PID empêche deux
passes concurrentes. Aucun entraînement ni ancien exécutable mémoire n'est lancé.

Les rapports transmis au suivi Discord ne contiennent que compteurs, échéances
et états. Les sorties natives complètes, conversations et authentifications
restent privées. Le MCP local utilise désormais le serveur canonique
`/home/aphro/.local/bin/aphrody-mcp`, en conservant les autres entrées et leurs
authentifications. Le premier index local des versions Drive a ajouté six
documents et 38 chunks au home DBFR. La dernière passe publiée vérifiée à
12:35:19 UTC avait cinq capacités réussies. À 12:41 UTC, le CLI natif existant du
VPS a été transféré vers DBFR, vérifié par SHA-256 et par `home status`, puis
installé sans écraser de binaire existant. La réplication a indexé 26 documents
au total dans les deux homes distants. L'ajout explicite du `MEMORY.md` DBFR a
ensuite ajouté un document par home, soit 28 documents cumulés. Une passe répétée vérifie le snapshot
sans recopier les fichiers inchangés. Le timer reprend cette tâche toutes les
cinq minutes.

La réplication distante utilise les sept documents du contrat du connecteur
Drive, ses versions staged et le `MEMORY.md` du home DBFR explicitement déclaré,
dans des snapshots privés nommés par
empreinte. Elle vérifie chaque fichier avant d'indexer les deux homes DBFR et
Shenron, recontrôle les snapshots existants et recopie ceux qui sont altérés.
Elle exclut les fichiers d'authentification, sessions fournisseur, bases et poids,
et n'écrase aucun document actif ou conflit. Le transfert passe par le SFTP
natif avec `APHRODY_DBFR_HOST=10.200.77.3`. Le home Shenron reste distinct du home
DBFR ; une copie de documents ne synchronise pas les mémoires des fournisseurs.
L'artefact CLI déployé a l'empreinte
`4e51190ca80efab50df4b3f351c2be60b41815c2566a6a9e456d4077a761c296`.

Les collecteurs de sessions locaux dépendent encore du poste WSL. Le connecteur
Drive a été migré séparément vers le VPS le 2026-10-07 ; son fonctionnement
persistant et son authentification sont décrits ci-dessous.

## Connecteur Drive Bun sur le VPS — 2026-10-07

La [politique cloud](../../../config/host/agent-sync-vps.json) sélectionne
uniquement `drive` et `drive-retrieval`, à partir du même propriétaire Google
et du même worker Workspace Bun. Un unique credential service-account existant,
déjà qualifié en lecture sur le dossier DBFR, a été transféré par SSH avec clé
d'hôte vérifiée dans le store privé du VPS : répertoire `0700`, fichier `0600`.
Sa valeur ne figure ni dans le dépôt ni dans les rapports Discord.

Le [service](../../../config/host/systemd/aphrody/aphrody-drive-sync.service)
est un oneshot ; son [minuteur](../../../config/host/systemd/aphrody/aphrody-drive-sync.timer)
est activé au démarrage et déclenche une passe chaque minute. Les intervalles
de chaque capacité et les reprises après erreur restent contrôlés par les
checkpoints privés. Un service `inactive/dead` après `Result=success` est normal
entre deux passes. La fermeture de la session WSL ne suspend plus ce connecteur.

Le passage réussi de 14:01 UTC a récupéré sept documents natifs, sans upload.
Les projections candidates sont désormais séparées des preuves locales dans
`retrieval-markdown`. Après sauvegarde native et réindexation du même label
`drive-dbfr-staged`, le home DBFR du VPS contient sept documents et 89 chunks,
avec zéro vecteur ; les sept copies locales de comparaison ont été retirées
de cette source. Les preuves complètes restent privées dans `incoming-markdown`.
Le reçu cloud `agent-sync-vps-status.json` publie uniquement les compteurs ; le
salon Drive le distingue explicitement du reçu WSL. Les écritures Google Docs
et la fusion bidirectionnelle restent à implémenter.

Le home cloud a ensuite reçu les sept documents DBFR et leurs références
Markdown/natives validées du magasin privé WSL : 22 fichiers avec le checkpoint,
tous vérifiés par SHA-256 et écrits en 0600 sur les seuls chemins déclarés.
Le checkpoint cloud initial reste sauvegardé. Aucun fichier d'authentification
n'est copié par ce bootstrap ; les versions actives déjà présentes et divergentes
sont refusées. Le passage Google natif confirme alors trois éléments inchangés,
deux locaux en avance et deux distants staged, sans upload. La revue autonome
du rapprochement conserve ses propositions, snapshots et explications dans le
magasin privé ; un plan de revue ne constitue pas une écriture Google appliquée.

Validation : 48 tests ciblés Workspace, Google, Discord et plan d'hôte réussis ;
TypeScript, lint strict et format des chemins modifiés passent.

## Compute et RAG DBFR

Le [catalogue de tunnels privés](../../../config/host/agent-sync-tunnels.json),
son [service natif](../../../config/host/user/aphrody-dbfr-sync-tunnel.service)
et l'[alias SSH](../../../config/host/user/aphrody-dbfr-wg.ssh.conf) relient
le compute et les embeddings DBFR aux ports loopback 18789 et 18085 via
WireGuard. Le [drop-in RAG](../../../config/host/user/shenron-rag-sync-native.conf)
réutilise ces transports et les environnements protégés. Les deux forwards et
la santé authentifiée du compute ont été vérifiés, sans exposer de nouvelle
API publique.

La bibliothèque FFI Shenron existante du payload DBFR a été vérifiée par SHA-256
et ABI 4 avant consommation locale ; aucun moteur n'a été recompilé. Une valeur
PostgreSQL `options` encodée avec `+` provoquait une erreur `+search_path` côté
pilote natif. L'environnement protégé a été normalisé en `%20`, sauvegardé et
remplacé atomiquement ; le générateur source emploie déjà `quote_via=quote`.
Après redémarrage déclaré du compute : santé HTTP 200, RAG et LLM disponibles,
statistiques HTTP 200, 59 995 chunks et zéro vecteur. Cela ne prouve pas une
couverture complète des embeddings. La synchronisation RAG est relancée par
son unité utilisateur en arrière-plan ; son succès exige un nouveau rapport
final sans échec, et non un simple état `activating` ou un checkpoint partiel.

Le suivi RAG lit désormais le PID et le début effectifs de
`shenron-rag-sync.service`, ainsi que son journal privé et le rapport final.
Un rapport d'une passe précédente ne prouve jamais la fin du travail actif.
Les compteurs publiés dans Discord distinguent progression, échec et résultat
final confirmé. À 12:58:49 UTC le 2026-10-07, sept tâches de synchronisation
étaient réussies et le RAG avançait à 9 800 sur 181 636 unités ; la passe
restait active et son rapport final était attendu. Aucun corps de document ou
de conversation ne figure dans ce reçu.

Validation du lot automatique et de ce suivi : 24 tests ciblés réussis, TypeScript Workspace
et kit Discord sans erreur, lint des chemins modifiés propre. La suite kit
élargie expose un échec hors chemins modifiés : `sendFile` conserve `blob` au
lieu du nom `note.txt` avec le Bun installé. Aucun résultat global vert n'est
revendiqué. À ce stade historique, A2A restait à qualifier : la présence de `APHRODY_A2A_DRY_RUN`, même
avec la valeur `0`, active le dry-run ; le jeton de coordination ne protège pas
tous les endpoints du listener actuel. Ne pas exposer l'exécution de code avant
qualification de cette authentification et des endpoints PC. L'activation
authentifiée ultérieure du hub et sa vérification Codex après fermeture du
client sont consignées dans [MCP-A2A](MCP-A2A.md).
