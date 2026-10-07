<!-- SPDX-License-Identifier: Apache-2.0 -->

# Rivalité Aphrody / Shenron dans Discord

Le salon privé `debat` du laboratoire Aphrody accueille deux rôles : Aphrody
(Gemma) critique les arguments et développe la fiabilité de Shenron ; Shenron
répond en spécialiste Dragon Ball. Les noms `Aphrody, <question>` et
`Shenron, <question>`, ainsi que les mentions Discord des deux comptes, ouvrent
ou poursuivent un débat. Les messages des bots et des webhooks ne déclenchent
aucune réponse en boucle.

`!debat <sujet>` ouvre une session ; `!argument <thèse>` la poursuit. Un
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

Le pont appelle les outils natifs `aphrody_shenron_rag_search` et
`aphrody_shenron_llm_chat` du MCP Shenron existant sur DBFR. Si la recherche
native est indisponible, il utilise le VFS déjà servi par Shenron. Les références
conservent leurs identifiants et URL. Fandom est rejeté ; le manga, les databooks,
l'anime, les films et les jeux restent distincts. Une référence retrouvée ne
garantit pas que sa proposition est vraie. Aucun OCR, index, source éditoriale
ou dataset existant n'est modifié par ce worker.

Seules les réponses de Shenron évaluées par un administrateur et portant des
citations valides produisent une entrée d'entraînement. Le format de rollout
est compatible avec le lecteur natif `aphrody_train.dataset` ; ses gardes gold,
secrets et déduplication restent nécessaires avant tout entraînement. La
validation d'une citation ne remplace pas l'évaluation de son contenu.

`!agent codex|agy|claude <texte>` est un **relais humain administrateur**, identifié
comme tel. Les endpoints A2A authentifiés de ces pairs et l'accès au WSL d'Omar
ne sont pas qualifiés ici. Aucun entraînement de poids, promotion de modèle,
autonomie de développement ou chargement exhaustif des mangas, épisodes,
films et jeux n'est revendiqué.

## Installation et exploitation

Exécuter depuis la racine Aphrody :

```sh
bun scripts/tools/discord/debate/install.ts
bun scripts/tools/discord/debate/install.ts --apply
```

Le plan et l'application passent par Infra, installent les ponts root sur DBFR,
le bundle sur VPS et la seule unité
[aphrody-discord-debate.service](../../../../tools/config/host/systemd/aphrody/aphrody-discord-debate.service).
Les identifiants existants restent sur leurs hôtes. Les sessions, états et
rollouts restent dans `/srv/aphrody-lab/state/debate`, en répertoires privés et
fichiers 0600 ; ils ne doivent pas entrer dans Git ou les artefacts publics.
L'installation stoppe son worker avant de modifier son état ; `--probe`
vérifie les backends sans publier de message de test.

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
La guilde doit encore réinviter un bot qui l'avait déjà quittée.

Référence de packaging vérifiée :
[documentation officielle Bun sur les exécutables](https://bun.com/docs/bundler/executables).
