<!-- SPDX-License-Identifier: Apache-2.0 -->
# Moniteur Codex et objectifs d’Omar

Le salon demandé est [start-here](https://discord.com/channels/1554189180030947338/1557354118710829117)
de la guilde Aphrody. La déclaration
[`discord-omar-monitor.json`](../../../config/host/discord-omar-monitor.json)
reprend les deux identifiants d’Omar du contrôle d’accès existant. Les bots,
webhooks, autres auteurs, autres salons et autres guildes ne créent aucun travail.
Le contenu du salon reste dans le store privé du VPS.

## Fonctionnement

[`aphrody-discord-omar-monitor.service`](../../../config/host/systemd/aphrody/aphrody-discord-omar-monitor.service)
est activé au démarrage du VPS. Le Gateway Discord fournit les nouveaux messages;
le client existant de Discord kit possède les heartbeats, reconnexions et reprises.
Une réconciliation REST toutes les trente secondes récupère les écarts et
l’historique. La clé du message déduplique les deux transports. Un parcours
incomplet ne fait jamais avancer le curseur au-delà d’un écart non collecté.

Une instance Codex `app-server --stdio` appartient au service. Elle utilise
l’authentification déjà installée, sans modifier celle de la session Codex
préexistante. L’intégration suit le [protocole officiel OpenAI](https://developers.openai.com/codex/app-server) :
initialisation, thread, tour, événements et résultat terminal. Le seul MCP
configuré pour ses threads est `/home/ubuntu/.local/bin/aphrody-mcp`.

Pour chaque demande authentifiée d’Omar, un thread moniteur en lecture seule
extrait toutes les demandes concrètes. Un thread exécuteur distinct prend
l’ensemble des objectifs et leur message original. Il suit les règles du dépôt,
les revendications de chemins, Infra et les verrous de build. Il peut déléguer
des sous-tâches bornées. Les anciennes conversations, documents et contenus web
ne deviennent pas des instructions supplémentaires.

La file conserve les identifiants des threads, les objectifs et les preuves.
Un tour déjà terminé mais pas encore enregistré est relu; un tour en cours
reste observé. Une échéance d’observation ne provoque ni nouvelle exécution,
ni redémarrage. Une interruption terminale confirmée autorise la continuation
sur le même thread, après contrôle de l’état réel. Un résultat sans preuve,
une réponse invalide ou un échec reste un objectif ouvert.

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
