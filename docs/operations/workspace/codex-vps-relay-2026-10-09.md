<!-- SPDX-License-Identifier: Apache-2.0 -->
# Relais Codex VPS du 2026-10-09

Le propriétaire a demandé un relais Codex natif sur le VPS pendant la limite de
session Claude. Le relais utilise les binaires déjà installés, le MCP canonique
`aphrody-mcp` et A2A. Les sessions `yolo` et `vps-cargo` existantes sont préservées.

## État vérifié

Le checkout privé a été obtenu depuis le dépôt existant du VPS, puis son origine
autorisée GitHub a été récupérée. Base :
`cc96c4651a973852d1df132e254550de504af06c`, branche `codex/relay-2026-10-09`.
Le répertoire opérationnel est
`/home/ubuntu/.aphrody/workspace/codex-relay-2026-10-09`.
`codex login status` confirme une authentification ChatGPT existante ; aucune
authentification fournisseur ni session brute n'a été transférée.

La session tmux `codex-relay-20261009` contient les fenêtres `a2a`, `mcp`,
`system`, `deps` et `coordinator`. Trois processus Codex ont réellement commencé
l'inférence et écrit des événements `thread.started`, `turn.started` et des
messages et exécutions. Identifiants initiaux :

| Lot | Thread Codex | Périmètre |
| --- | --- | --- |
| system | `01a11efd-a000-7ea0-b9a4-cc464338a858` | Audit des consommateurs `crates/os` et `crates/shell` face aux exports Bun ; lecture seule |
| deps | `01a11efd-9f32-7062-89b6-60dd33800936` | Dépendances moteurs et doublons hors propriétaires actifs ; lecture seule |
| coordinator | `01a11efd-9f2f-7b33-96a3-1d5721858627` | Vérification MCP/A2A et synthèse des deux lots |

Les deux lots disposent de worktrees isolés `system` et `deps`. Le coordinateur
travaille dans `repo`. Ils ne lancent aucun autre agent, aucun build moteur,
aucune publication et aucun changement de déploiement. Ils terminent après leur
lot borné ; le coordinateur attend uniquement les handles de processus vivants.
Le parent garde la responsabilité de la migration complète et de ses gates.

## MCP, A2A et tunnel

Le serveur A2A écoute exclusivement `127.0.0.1:23888` et le MCP HTTP
`127.0.0.1:23889`. Le ping A2A et la carte agent sont vérifiés. Un POST `/msg`
depuis Windows a répondu `ok: true` pour
`env-codex-relay-local-20261009` ; l'enveloppe se trouve dans le dossier partagé
`coord/inbox-from-codex-local.jsonl` du relais.

Le MCP HTTP a d'abord répondu 503, car son jeton n'était pas configuré. Un jeton
exclusif au relais a été généré dans `mcp.env.json`, mode 0600, dans le magasin
opérationnel protégé du VPS. Une initialisation authentifiée répond HTTP 200,
protocole `2025-03-26`, serveur `aphrody-mcp` version `1.0.0`. Ce fichier et son
contenu ne sont jamais copiés dans le dépôt. Chaque Codex utilise aussi le MCP
stdio canonique avec `required=true`. Les événements du coordinateur prouvent
des appels MCP achevés `aphrody_a2a_call` et `aphrody_mcp_call` ; un appel achevé
ne prouve pas à lui seul une migration produit qualifiée.

Windows conserve un superviseur PowerShell caché, PID initial 33000, sous le
home configuré `.aphrody/workspace/codex-relay-2026-10-09`. Son `tunnel.ps1`
relance le propriétaire `aphrody infra ssh tunnel` après une sortie, délai
5 secondes, avec un catalogue opérationnel séparé. Aucun service système ni
Nginx n'est modifié. Ce superviseur survit à la session agent, pas à un redémarrage
Windows ; les services tmux survivent à la déconnexion SSH, pas au reboot VPS.

| Service | Windows, loopback | VPS, loopback | Preuve |
| --- | --- | --- | --- |
| A2A | 24888 | 23888 | `tunnel status` up ; ping et POST `/msg` |
| MCP | 24889 | 23889 | `tunnel status` up ; initialisation authentifiée sur le VPS |

La commande de statut place les options après le sous-commandement `status` :

```powershell
aphrody infra ssh tunnel status --catalog "$env:USERPROFILE/.aphrody/workspace/codex-relay-2026-10-09/service-catalog.json" --services codex-relay-a2a,codex-relay-mcp --offset 1000 --json
```

## Reprise et limites

Inspecter les handles actuels avant toute reprise :

```sh
tmux list-panes -a -F '#{session_name}:#{window_name} pid=#{pane_pid} dead=#{pane_dead} cmd=#{pane_current_command}'
```

Les fichiers `<lot>.events.jsonl`, `<lot>.stderr.log`, `<lot>.last.md`,
`<lot>.exit` et les rapports `<lot>.md` restent dans le home opérationnel.
L'existence d'un fichier ou d'une fenêtre ne prouve pas qu'un agent travaille :
vérifier le PID et les événements. Ne pas redémarrer un lot après un simple délai
d'observation. Une reprise Codex utilise son thread explicite, jamais `--last`
partagé entre lots. Les enveloppes Claude sont durables via `aphrody a2a tick` ;
leur écriture n'établit pas une lecture ou réponse de Claude pendant sa limite.

Les audits `system` et `deps` ont terminé avec code 0 et leurs rapports Markdown
et JSON sont présents. La synthèse est en cours lors de cette qualification.
Le rapport système inventorie la politique Rust existante ; sa proposition de
conserver WinClean en Rust ne remplace pas la directive propriétaire de migrer
vers `bun:windows`. La parité de la nouvelle frontière doit être démontrée.
Une seconde enveloppe Windows, `env-codex-relay-next-20261009`, est acceptée par
A2A : elle annonce la révision parent `286137f551`, rappelle l'objectif
d'implémentations prêtes et demande les prochains lots bornés sans désactiver
les fonctionnalités browser/GPU. L'enveloppe locale Claude `env-2cde77c3`
annonce le relais et cette transmission.

Les gates `bun run docs:check` et `bun run docs:check-links` ont été exécutées.
La première échoue sur des documents générés périmés et le contexte Cargo
IECODE absent ; la seconde relève 5 liens cassés et 22 chemins morts provenant
des retraits moteurs et des références existantes, sans référence dans cette
fiche. Ces erreurs restent aux propriétaires de l'intégration. Le contrôle
de whitespace de cette fiche ne relève aucune erreur.

La réduction effective des moteurs, la parité Windows, les gates produit,
les mesures taille/démarrage/mémoire et l'activation complète restent à vérifier.
La Fleet SSH est un contexte distant distinct ; le MCP local canonique n'a pas
été remplacé ni reconfiguré.
