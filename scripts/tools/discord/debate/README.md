<!-- SPDX-License-Identifier: Apache-2.0 -->

# Rivalité Aphrody / Shenron dans Discord

Le salon privé `debat` du laboratoire Aphrody accueille deux rôles : Aphrody
(Gemma) critique les arguments et développe la fiabilité de Shenron ; Shenron
répond en spécialiste Dragon Ball. Les noms `Aphrody, <question>` et
`Shenron, <question>`, ainsi que les mentions Discord des deux comptes, ouvrent
ou poursuivent un débat. Les messages des bots et des webhooks ne déclenchent
aucune réponse en boucle.

`!debat <sujet>` ouvre une session ; `!argument <thèse>` la poursuit. Une demande
humaine remplace un sujet lancé automatiquement : l’ancien débat est clôturé et
archivé avant d’ouvrir le nouveau, sans mélanger leurs contextes. Un débat déjà
ouvert par un humain garde son sujet jusqu’à `!fin`. Un
administrateur peut utiliser `!fin`, `!pause`, `!reprendre` et
`!valider <ID de réponse>`. Les chercheurs peuvent participer. Chaque débat
compte au plus douze tours ; les modèles peuvent décider d'une intervention
toutes les quinze minutes, au plus quatre fois, ou passer leur tour. Le premier
débat autonome attend la présence réelle des deux comptes.

Le transport Discord de Shenron utilise son compte et ses identifiants protégés
sur DBFR. Sans sa présence dans la guilde, Aphrody affiche explicitement le
relais de son modèle. Le worker réévalue cette présence toutes les cinq minutes.
La politique des rôles, des modèles et des limites est dans
[discord-debate.json](../../../../tools/config/host/discord-debate.json).

## Sources et apprentissage

Le runtime d’exécution est le binaire Yolo installé, appelé directement avec
`BUN_BE_BUN=1` pour ses APIs compatibles. Le code du worker utilise les propriétaires partagés du kit : `NativeLocalAI`
pour l’inférence en processus et `searchLocalRag` pour le client MCP natif par
FFI. Le RAG appelle uniquement `aphrody_shenron_rag_search` du serveur canonique
Aphrody, avec le schéma PostgreSQL Shenron existant en lecture seule derrière
son tunnel privé. Le token reste une référence d’environnement protégée.
Aucun téléchargement de poids ni moteur parallèle n’est créé.

Les profils `aphrody` et `dbfr`, leurs SOUL et le LoRA Shenron restent distincts.
Un seul modèle natif est résident par appel ; le verrou partagé entre processus
empêche le chargement simultané par le laboratoire et le débat. Chaque réponse
est bornée à 256 tokens et 180 secondes, file d’attente comprise. Le contexte
garde trois réponses de 400 caractères et six extraits de 600 caractères.
Les références gardent leurs identifiants et URL ; Fandom est rejeté. Les règles
séparent manga, databooks, anime, films et jeux, et le format demande une majeure,
une mineure, une conclusion et une objection précise au rival. Une référence
retrouvée ne garantit pas la vérité de sa proposition.

La source native est préparée ; l’activation attend encore l’admission du
binaire de production par son manifeste et une qualification FFI complète.
Le service actuellement qualifié conserve le transport d’inférence HTTP existant
pendant cette qualification. Les contrôles CLI/MCP natifs du RAG ont retrouvé
six sources réelles ; cela ne vaut pas encore qualification du binding FFI.

La commande facultative `!valider` exporte les réponses Shenron annotées et
portant des citations valides. Son format de rollout est compatible avec le
lecteur natif `aphrody_train.dataset`. Le pipeline autorisé de génération et de
validation de candidats conserve ses contrôles de provenance, de secrets, de
domaine, de déduplication et de séparation du gold d’évaluation ; il n’ajoute
pas de préalable d’approbation humaine. Les sorties de modèle ne deviennent
pas automatiquement des vérités de référence. Aucun job qualifié n’a encore
été lancé par ce worker, et valider une citation n’évalue pas son contenu.

`!agent codex|agy|claude <texte>` est un **relais humain administrateur**, identifié
comme tel. Les endpoints A2A authentifiés de ces pairs et l'accès au WSL d'Omar
ne sont pas qualifiés ici. Aucun entraînement de poids, promotion de modèle,
autonomie de développement ou chargement exhaustif des mangas, épisodes,
films et jeux n'est revendiqué.

## Installation et exploitation

Exécuter depuis la racine Aphrody :

```sh
env BUN_BE_BUN=1 /home/aphro/.yolo/bin/yolo scripts/tools/discord/debate/install.ts
APHRODY_SSH_COMMAND_TIMEOUT_SECS=480 BUN_BE_BUN=1 /home/aphro/.yolo/bin/yolo scripts/tools/discord/debate/install.ts --apply
# Un échange demandé par l’opérateur ; le service est arrêté pendant l’écriture.
APHRODY_SSH_COMMAND_TIMEOUT_SECS=480 BUN_BE_BUN=1 /home/aphro/.yolo/bin/yolo scripts/tools/discord/debate/install.ts --apply --exchange "Goku contre Vegeta : réponds à ton rival avec les sources disponibles"
```

Le plan et l’application passent par Infra, installent le relais Discord du
compte Shenron sur DBFR, le bundle sur VPS et la seule unité
[aphrody-discord-debate.service](../../../../tools/config/host/systemd/aphrody/aphrody-discord-debate.service).
Les identifiants existants restent sur leurs hôtes. Les sessions, états et
rollouts restent dans `/srv/aphrody-lab/state/debate`, en répertoires privés et
fichiers 0600 ; ils ne doivent pas entrer dans Git ou les artefacts publics.
L'installation stoppe son worker avant de modifier son bundle ou son état,
sauvegarde les fichiers existants dans son store privé avec vérification SHA-256
et redémarre le service même si un contrôle échoue. `--probe` vérifie les
backends sans publier de message de test ; `--exchange` publie un tour demandé
par l’opérateur. Les tours autonomes restent bornés par la politique.

Shenron refusait initialement toute guilde différente de sa guilde principale,
à la connexion comme lors de l'invitation. Le correctif source ajoute une liste
explicite `ADDITIONAL_GUILD_IDS`, tout en conservant les gardes métier et les
commandes de production sur la guilde principale. Le build embarque aussi le
binding natif Canvas, dont le chargement dynamique échappait au bundler.

`deploy-guild.py` est un adaptateur borné au **seul bot** : image construite à
partir du digest existant et du binaire source vérifié, smoke sans réseau,
Compose `--no-deps`, contrôle de santé, comparaison des montages et restauration
de l'image/drop-in précédents si les contrôles échouent. Le drop-in
[guild-admission.conf](../../../../tools/config/host/systemd/shenron/shenron-bot-docker.service.d/guild-admission.conf)
rend cet override persistant. Les CLIs déployées ne proposent pas d'application
partielle de cet artefact ou des `unitDropIns` déclarés : cet adaptateur passe
par le SSH natif Infra, sans modifier le déployeur partagé.

## Qualification du 7 octobre 2026

Les 17 tests Bun du débat, quatre tests Python (dont le lecteur dataset natif),
le TypeScript ciblé, oxlint strict, oxfmt et Ruff passent. Les backends Gemma,
Shenron et RAG natif répondent ; la recherche fournit des identifiants PostgreSQL
stables. Les deux tests d'admission de guilde Shenron et le TypeScript du bot et
des scripts passent. Le binaire Linux charge 114 commandes et 45 événements
sans les `node_modules` du dépôt. Windows n'est pas qualifié dans ce lot.

Le smoke Docker garde le réseau désactivé, toutes les capacités Linux retirées
et l'utilisateur non-root de l'image existante. Il utilise le mode de système
de fichiers actuel du bot : le runtime compilé charge ses addons dans ce mode,
mais échoue sous `--read-only`, même avec un `/tmp` éphémère. Ce lot ne qualifie
donc pas un durcissement du conteneur en lecture seule.

Correctifs source Shenron : `41044476e0fe8ff1337fe4f2c19de9c0a064d5b1`
(admission) et `0be779387f285aa4793e901db098621f3432451a` (Canvas).
Le bot corrigé est actif sur DBFR : santé HTTP vérifiée, image
`sha256:5e84bc9852dc95d5655349d48da738f34cf1bdc24b3bb2d1570643c14f71dc8b`,
montages protégés inchangés et override systemd installé. Le salon privé créé
porte l'identifiant `1557364553283543161`. La réception privée du déploiement
sur DBFR conserve le checksum du binaire et l'image de retour arrière.
Le vrai compte Shenron est désormais présent dans la guilde (contrôle du 7 octobre 2026).

Référence de packaging vérifiée :
[documentation officielle Bun sur les exécutables](https://bun.com/docs/bundler/executables).

## Correction des échanges locaux du 7 octobre 2026

Le service était actif et les probes courts réussissaient, mais quatre tours
autonomes ne contenaient aucune réponse Shenron. Un prompt sourcé de 9 715 octets
a échoué au délai SSH de 65 secondes. Le pont HTTP expirait après 55 secondes,
alors que le backend natif autorise 90 secondes et omet `max_tokens`.
Le worker utilise désormais les daemons locaux existants avec une génération
bornée, et le délai du pont RAG suit le contrat natif. Le message système
requiert de finir la réponse sans confirmation intermédiaire tout en conservant
les limites réelles des outils, l’authentification et les contrôles techniques.

Qualification de ce lot : 20 tests Bun, quatre tests Python, TypeScript ciblé,
oxlint strict, oxfmt et Ruff passent. Le plan Infra et la vérification systemd
passent ; le service est activé après sauvegarde privée et checksum du bundle
`8591ad81e275201131fdb129554005a33c7d9534573c1a15a411ca8b65ec2e48`.
L’échange `1557479077550489601` est réellement publié dans `debat` par le compte
Shenron (`1557479416630747198`) puis Aphrody/Gemma (`1557479594007863406`).
Les conversations et données d’entraînement restent dans leur store privé.
Aucun entraînement de poids ni accès GPU/Omar n’est qualifié par cet échange.

## Arbitrage et raccordement natif du 7 octobre 2026

Le sujet automatique empêchait une nouvelle demande humaine d’ouvrir son
propre débat ; l’argument suivant était alors rattaché au précédent sujet.
La transition archive désormais l’initiative avant de prendre la demande humaine.
Les rôles distinguent défense de la thèse et critique d’une prémisse précise,
sans fabriquer une opposition lorsque les sources conduisent à un accord.
L’arbitrage a observé les réponses des deux comptes puis signalé les inférences
insuffisantes ; la présence des quatre libellés ne valide pas leur syllogisme.

Le raccordement PostgreSQL natif réutilise le rôle et le tunnel existants. Ses
options `search_path` et `default_transaction_read_only` sont vérifiées avant
l’application ; les espaces du paramètre URI sont encodés `%20`. Les contrôles
Infra et le vrai RPC fournissent six identifiants de sources Shenron. Une
sauvegarde privée vérifiée et le retour au service précédent protègent toute
application qui échoue à cette qualification.

Le rapport GPU local est une évaluation du retrieval et un microbenchmark
d’encodage distincts. Il ne prouve pas une exécution GPU de toute la récupération
et ne constitue pas un entraînement. Les données, gold, conversations et poids
restent dans leurs stores de domaine.

Le lot préparé passe 27 tests (123 assertions), TypeScript ciblé, lint strict,
format et reconstruction des bundles avec l’admission native. Ces gates ont
été exécutées directement par le Yolo installé ; elles ne qualifient pas
l’activation FFI restante. Le worker HTTP actuellement qualifié a servi
l’échange `1557492036876107777`, avec Shenron `1557492315059257515`,
Aphrody/Gemma `1557492471590555844` et le bilan d’arbitrage
`1557493043006021652`. Les limites de logique et de source restent explicites.

La transition du runtime seul utilise `runtime-activate.ts` : plan Infra,
checksum du pin et de la sauvegarde d’unité, sonde `--help` du bundle existant,
drain du handler, vérification du processus réel et santé des deux modèles.
Elle a activé le PID `4099441` sous Yolo `c886d124e138`, avec le bundle HTTP
`33af90fa46486522db6a2ffd0449f6c3a137fc26dc5992d491b30b299e0dd2c5`
inchangé et les ports 8798/8799 en HTTP 200. Cette transition ne revendique
aucune activation FFI ; l’unité précédente reste en sauvegarde privée.
