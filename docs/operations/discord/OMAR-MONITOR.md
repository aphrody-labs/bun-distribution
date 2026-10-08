<!-- SPDX-License-Identifier: Apache-2.0 -->

# Moniteur Codex et objectifs d’Omar

Le salon de réponse est [start-here](https://discord.com/channels/1554189180030947338/1557354118710829117)
de la guilde Aphrody. Le Gateway suit les salons et fils actifs présents dans
son cache de guilde. La réconciliation lit leur historique accessible via
l'API Discord. Chaque message humain avec une mention Discord structurée crée
un objectif, quel que soit son auteur ; les bots, webhooks, messages sans
mention et autres guildes sont ignorés. Le curseur initial est le message
`1557863988740493344`. La déclaration
[`discord-omar-monitor.json`](../../../tools/config/host/discord-omar-monitor.json)
définit la guilde, le salon de réponse et ce curseur.
Le contenu du salon reste dans le store privé du VPS.

Si le service est arrêté alors que la file contient des objectifs `planning`
ou `executing`, le workflow de déploiement vérifie d'abord que systemd n'a
plus de processus actif. Il réinitialise ensuite uniquement leur état à
`pending` : les objectifs, preuves et fils Codex restent dans SQLite pour
reprendre le travail.

## Fonctionnement

[`aphrody-discord-omar-monitor.service`](../../../tools/config/host/systemd/aphrody/aphrody-discord-omar-monitor.service)
est activé au démarrage du VPS. Le Gateway Discord fournit les nouveaux messages;
le client existant de Discord kit possède les heartbeats, reconnexions et reprises.
Une réconciliation REST toutes les trente secondes récupère les écarts et
l’historique. La clé du message déduplique les deux transports. Un parcours
incomplet ne fait jamais avancer le curseur au-delà d’un écart non collecté.

Une instance Codex `app-server --stdio` appartient au service. Elle utilise
l’authentification déjà installée, sans modifier celle de la session Codex
préexistante. L’intégration suit le [protocole officiel OpenAI](https://developers.openai.com/codex/app-server) :
initialisation, thread, tour, événements et résultat terminal. Le MCP Aphrody configuré pour ses threads est le binaire canonique de leur
hôte ; les éventuels services de domaine sont déclarés dans la politique.

Pour chaque message humain de cette guilde contenant une vraie mention Discord,
un thread moniteur en lecture seule extrait toutes les demandes concrètes.
Un thread exécuteur distinct prend l’ensemble des objectifs et leur message
original, avec l’identifiant Discord de son auteur. Il suit les règles du dépôt,
les revendications de chemins, Infra et les verrous de build. Il peut déléguer
des sous-tâches bornées. Les anciennes conversations, documents et contenus web
ne deviennent pas des instructions supplémentaires.

La file conserve les identifiants des threads, les objectifs et les preuves.
Un tour déjà terminé mais pas encore enregistré est relu; un tour en cours
reste observé. Une échéance d’observation ne provoque ni nouvelle exécution,
ni redémarrage. Une interruption terminale confirmée autorise la continuation
sur le même thread, après contrôle de l’état réel. Un résultat sans preuve,
une réponse invalide ou un échec reste un objectif ouvert. Trois résultats
consécutifs `continue` avec `needs` contredisent le contrat de progression :
le moniteur conserve les preuves, classe la dépendance `blocked` et libère
la demande suivante. La reformulation du besoin ne réinitialise pas ce contrôle.
Si l’app-server Codex ferme son flux pendant la reprise d’un thread, le service
marque uniquement cet objectif `blocked`, conserve ses fils et ses preuves,
poste la dépendance dans le salon, puis redémarre pour traiter les autres pings.
Les résultats intermédiaires sont transmis au plus une fois par minute, avec
compteur persistant ; chaque résultat terminal est conservé dans l’outbox.

Les commentaires achevés de l’exécuteur sont transmis dans le salon, au plus
un toutes les cinq secondes. Les commandes, fichiers, sorties d’outils et
raisonnements ne sont pas retransmis. Les mentions sont neutralisées et les
credentials connus ainsi que les motifs de secrets sont masqués. Les résultats
structurés passent par une outbox privée : une erreur Discord ne relance pas
l’objectif; un nonce borné déduplique la livraison.

## Stores et exploitation

Le binaire Bun et la politique résident sous `/srv/aphrody-lab/`. La file
`state/omar-monitor/queue.sqlite` est en `0600`, son répertoire en `0700`.
Les états `pending`, `planning` et `executing` restent exécutables;
`achieved`, `ignored` et `blocked` conservent leur résultat. Un blocage précise
la dépendance; une nouvelle demande d’Omar peut apporter les données manquantes.
Le statut et le thread/tour actuellement observé sont dans
`state/omar-monitor/status.json`. Les rollouts Codex restent dans son store protégé.
Ces fichiers ne se committent pas.

```sh
yolo ops discord deploy omar-monitor --target vps
yolo ops discord deploy omar-monitor --target vps --apply
aphrody infra ssh service --host vps --action status aphrody-discord-omar-monitor.service
```

Le service est du code produit dans
[`@aphrody/discord-kit`](../../../packages/discord/kit/src/omar-monitor/index.ts),
exporté par le kit et empaqueté depuis son point d’entrée `main.ts`. Le workflow
de compilation et de livraison appartient à l’opération Discord existante de
[`@aphrody/workspace`](../../../packages/infra/workspace/src/discord.ts).
L’ancien installateur sous `scripts/tools/` a été supprimé après qualification
du remplacement déployé.

L’installation compose le plan Infra, vérifie les SHA-256 des uploads,
contrôle l’accès au salon et initialise Codex avant d’activer le service.
Une mise à jour utilise le protocole produit de drainage : `SIGUSR1` demande
au PID réel de systemd de finir son objectif en cours sans en démarrer un autre.
Le signal attend d’abord `--ready-check --expect-pid`, qui prouve que ce
processus a installé ses gestionnaires et publié son reçu de démarrage.
Le Gateway continue à conserver les nouveaux messages. Le contrôle
`--upgrade-check --expect-pid` exige un reçu d’inactivité du même processus
et une file sans objectif actif. Une observation expirée diffère la livraison;
`SIGUSR2` reprend le processus toujours vivant, sans relancer son objectif.
Le workflow restaure les fichiers produit et l’unité précédents si l’activation
échoue. Les bases, rollouts et credentials restent à leur emplacement.
Le contrôle `--smoke` du worker déployé crée deux tours de qualification :
une réponse structurée du moniteur, puis une lecture réelle de la version
Aphrody par l’exécuteur. Il ne crée pas de message d’Omar et n’envoie aucun
message Discord. `--guide` publie uniquement le mode d’emploi du service.

L’exécuteur appelle exclusivement la capacité produit `aphrody web crawl-index`
du [propriétaire Web](../web/VPS-WEB.md), après contrôle de l’aide du binaire
installé sur l’hôte. Une capacité absente reste une dépendance ouverte; aucun
ancien script ne sert de remplacement. Les navigateurs CDP sont activés sur
les deux VPS; la qualification du nouveau binaire natif reste un lot Web distinct.
Il choisit les URL et les budgets à partir des objectifs autorisés : crawl natif,
frontier SQLite, documents privés, index Aphrody puis recherche de vérification.
Les cookies restent dans leurs stores. L’index qualifié est lexical;
aucune couverture exhaustive du Web ou indexation vectorielle n’est annoncée.

## Preuves du 2026-10-07

Le service est `enabled`, `active`, connecté au Gateway, sans redémarrage
automatique observé. Le message du guide a été inscrit par le transport
`gateway` en 169 ms après son horodatage Discord; il n’a créé aucun objectif.
L’historique du salon est entièrement réconcilié. À cette qualification,
aucune demande d’Omar n’était présente dans ce salon.

Deux tours Codex réels ont terminé : le moniteur a renvoyé son JSON de
contrôle; le sous-agent a exécuté `/home/ubuntu/.local/bin/aphrody --version`,
avec code de sortie zéro et résultat `aphrody 1.0.0-canary`. Les commandes et
leur sortie ont été vérifiées dans son rollout protégé, pas seulement dans
sa réponse finale. L’accès effectif au MCP canonique a été vérifié sur chacun
des VPS dans le lot Web.

Onze tests produit ciblés passent : filtrage d’identité, reprise de la file, outbox,
pagination de plus de cent messages, absence d’avance sur un écart incomplet,
résultats sans preuve, masquage des secrets, récupération d’un résultat,
premier tour d’un nouveau thread, conservation d’un tour actif, contrôle de
drainage du bon PID et interrogation des capacités sans authentification.
Neuf tests du workflow de livraison couvrent le refus d’un objectif actif,
la conservation d’un service vivant lors d’une échéance, l’attente de démarrage
avant tout signal, un changement de PID,
les SHA-256, l’échec d’un probe et la restauration d’une activation échouée. TypeScript
strict, oxlint, oxfmt et la validation systemd du plan Infra passent.
Cette preuve qualifie le moniteur et l’exécuteur armés; elle n’invente pas
des objectifs métier déjà exécutés pour Omar.

Le bundle produit SHA-256 `393bc0625549d261e6fd99830c43111c98cc513f7a3fb7565bb1710bc0bedc37`
a été activé par le workflow Workspace, puis mis à jour par ce même workflow
avec drainage effectivement observé du PID vivant. Le service résultant
`3277625` est actif, `ExecMainStatus=0`, `NRestarts=0` à cette observation.
`--capabilities` expose le protocole de mise à jour version 2 et le contrôle
de démarrage a confirmé ce même PID vivant.
La politique conserve le SHA-256
`e81e34b86519fd9ae6a20796010731424e0621f30d739273b3fc94a4956f0762`.

## Correction de boucle et routage du 2026-10-07

Le diagnostic du salon a confirmé une boucle de réponses `continue` avec une
information indispensable manquante. L’exécuteur répétait la même demande
tronquée, monopolisant la file ; plus de trois réponses terminales concordantes
et aucune commande dans les 500 derniers événements ont été vérifiées dans son
rollout protégé. Après arrêt contrôlé du seul service moniteur et sortie de son
processus Codex, une sauvegarde SQLite cohérente et son SHA-256 ont été vérifiés.
La transition du seul objectif concerné vers `blocked` a conservé son thread,
ses preuves et les six demandes suivantes. Aucune conversation n’est copiée ici.

Le garde-fou appartient à [outcome.ts](../../../packages/discord/kit/src/omar-monitor/outcome.ts).
Il conserve chaque résultat une seule fois, résiste à une reprise et limite les
comptes rendus intermédiaires. Le workflow Workspace permet aussi de mettre à
jour un service arrêté : PID zéro, état effectivement inactif et absence
d’objectif actif doivent être prouvés avant tout upload. Il refuse toujours
un service en démarrage, un objectif actif et un reçu provenant d’un autre PID.

Les nouveaux objectifs tentent le Codex complet du WSL du propriétaire via
SSH stdio authentifié. Si ce worker ne peut pas s’initialiser avant la création
du thread, le moniteur démarre un thread distinct sur le Codex du VPS et lui
interdit de prétendre avoir agi sur l’hôte distant ou d’y déplacer une tâche
qui doit y être exécutée. Il accomplit le travail indépendant et garde bloquée
toute dépendance d’accès réelle. Un thread déjà persisté conserve son hôte.
Au démarrage, les pings sans thread et les anciens pings ignorés sont remis en
file afin qu’ils reçoivent chacun un objectif et un worker.

Les prompts imposent NHITL pour les actions déjà autorisées et les gates du
dépôt ; une information indispensable manquante doit être décrite dans `needs`,
sans relance indéfinie. Les capacités et skills sont découverts dans leurs
propriétaires actuels, sans nombre d’outils figé ni commande retirée.

## Déploiement tous salons du 2026-10-08

La politique active utilise `allGuildChannels` et le curseur
`1557863988740493344`. À l’observation du 2026-10-08 22:05 UTC, le Gateway
avait découvert 15 salons et fils actifs, et SQLite contenait 15 marqueurs
d’historique terminés avec le même curseur initial. Les données ont été
réconciliées avant l’écriture du reçu `historyComplete`. La file conservait
3 objectifs `achieved`, 4 `blocked`, 1 `ignored` et 7 `pending`, sans objectif
`planning` ou `executing` perdu pendant le déploiement.

Le service `aphrody-discord-omar-monitor.service` était `enabled` et `active`,
PID `1954130`, `ExecMainStatus=0`, `NRestarts=0`, avec Gateway connecté. Les
SHA-256 installés étaient `cf55c813844afdd216182d840ff64a22a5e2147082f6ed9829f9f0bbb7a72d01`
pour le bundle et `d737f235fc81d0f757d1a371e24ea05921f42b1680c13a10a1c08547247eae81`
pour la politique. Le bundle a été construit localement, transféré via les
commandes SSH d’Infra (SFTP natif inaccessible depuis cette session), puis
revalidé par checksum, probe Discord/Codex, contrôle d’inactivité de la file,
validation systemd et activation du plan Infra.

L’observation est consignée dans
[`omar-monitor-2026-10-08.md`](../../../tools/config/host/inventory/omar-monitor-2026-10-08.md).

## État recontrôlé le 2026-10-08 à 22:18 UTC

Le contrôle Infra a relu le reçu du PID systemd vivant `2026120` : Gateway
connecté, drainage inactif, 15 salons, 15 marqueurs d’historique terminés et
curseur `1557863988740493344`. Le service est `active/running`,
`ExecMainStatus=0`, `NRestarts=0`. Les SHA-256 installés sont
`1edbd1b4087ff50932631004610af427d9cf47dd8016af4f6d773ba004aa1d67` pour le
bundle et `d737f235fc81d0f757d1a371e24ea05921f42b1680c13a10a1c08547247eae81`
pour la politique.

La file contient 15 objectifs : 3 `achieved`, 10 `blocked`, 2 `ignored`, aucun
`pending`, `planning` ou `executing`. Cinq objectifs ont un thread exécuteur
persisté mais restent bloqués; cinq autres sont affectés à `owner-wsl` sans
thread. La connexion SSH depuis le VPS vers `10.200.77.2:22` expire; le worker
WSL et l’exécution de ces cinq objectifs ne sont donc pas qualifiés. Les deux
messages ignorés n’ont pas de thread exécuteur. La présence du service ne prouve
pas que chaque ping a été traité avec succès; garder le moniteur actif et
qualifier toutes les dépendances avant de conclure les objectifs.

Le 2026-10-08 à 22:24 UTC, le workflow Infra a activé le bundle
`63ab825e57de336d716828f7ab78aeda7935ba6ccbe84995567bdcfb6436e05b` avec le
repli par thread VPS et la reprise des pings sans worker. À 22:35:34 UTC, le PID
`2138001` est actif sans redémarrage; Gateway connecté, 15 salons et 15 threads
moniteur. La file compte 4 `achieved`, 10 `blocked`, 1 `executing` et aucun
`pending`; les 15 pings ont un thread exécuteur. Les objectifs bloqués restent
ouverts et l’objectif en cours n’est pas déclaré terminé.

Qualification du correctif : 33 tests produit/routage/outbox/livraison réussis,
TypeScript des deux propriétaires, oxlint strict, oxfmt et liens documentaires
passent. Le routage SSH WSL a initialisé un app-server Codex 0.160.1 authentifié
et créé un thread complet (`never`, `dangerFullAccess`) avec ses chemins locaux.
Lors de la livraison, une réactivation concurrente du moniteur a déjà pris la
demande suivante sur le VPS. Le workflow a alors refusé la mise à jour faute
de drainage achevé et a repris le même PID ; aucune tâche active n’a été tuée.
Ces gates qualifient les sources ; la nouvelle politique de routage et le
nouveau bundle ne sont pas déclarés activés par cette seule qualification.

La directive suivante du propriétaire impose le fork Yolo comme interpréteur.
La déclaration du moniteur et ses probes utilisent directement le pin
`/home/ubuntu/.yolo/bin/pins/discord-c886d124e138/yolo`, avec `BUN_BE_BUN=1`.
Son SHA-256 attendu est
`c886d124e1389167b0f1424b91bfc2902cc750c481d61fef6e97cd605493bf0b` :
le workflow le vérifie avant tout signal de drainage, build ou upload.
Ce binaire contient le moteur `1.4.3-canary.1`, révision `a4d88d124` ;
il ne qualifie pas une révision plus récente des sources du fork.
Les 13 tests de livraison et les 35 tests combinés du moniteur, du routage et
de la livraison passent avec ce même interpréteur sur WSL, ainsi que TypeScript,
oxlint strict et oxfmt. La syntaxe systemd passe sur WSL et, après installation
du pin vérifié, sur le VPS avec son véritable chemin ; cette vérification
n'installe ni ne redémarre le moniteur.
L'ancienne instance active conserve son runtime jusqu'au drainage qualifié.

Le gate documentaire global reste en échec sur les index générés concurrents
STATE/ecosystem/documentation et sur le manifeste IECODE absent de l’inventaire.
Les 2444 liens locaux et 2071 chemins de code contrôlés restent valides ; aucun
index appartenant à un autre lot n’a été régénéré pour masquer cet échec.
