## challonge : tournois Challonge en CLI et bot Discord

`creator-kit challonge` crée et pilote des tournois Challonge. La partie CLI est indépendante de toute plateforme ;
`challonge bot` ajoute un bot Discord (commandes slash `/tournoi`) qui s'appuie sur les mêmes fonctions.
Aucune dépendance : `fetch`, WebSocket de Bun et `node:util`.

### API ciblée et état de la vérification

| Élément              | Valeur                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API Challonge        | **v2.1** (JSON:API), base `https://api.challonge.com/v2.1`. Les versions v1 et v2.0 sont marquées « deprecated » dans la doc.                                                                                                    |
| Authentification     | Clé API v1 (« APIv1 key », `https://challonge.com/settings/developer`) envoyée avec `Authorization-Type: v1` + `Authorization: <clé>`, ou jeton OAuth (`Authorization-Type: v2` + `Bearer`). Les deux sont documentés pour v2.1. |
| API Discord          | REST et Gateway **v10** (`discord.com/api/v10`, `wss://gateway.discord.gg/?v=10&encoding=json`).                                                                                                                                 |
| Date de vérification | **2026-10-06** (doc Challonge : https://challonge.apidog.io, dernier changelog daté du 2026-09-14 ; doc Discord : dépôt officiel `discord/discord-api-docs`).                                                                    |

**Vérifié contre la documentation officielle** : URL de base, en-têtes, chemins et corps JSON des endpoints
(`tournaments` create/update/get/list, `change_state` avec `start`, `finalize`, `process_checkin`, `abort_checkin`,
`start_group_stage`, `finalize_group_stage`, `participants` create et `bulk_add` (20 max), `randomize`, `matches` list/get/update
avec `score_set` et `advancing`), valeurs de `state`, pagination `page`/`per_page`, format d'erreur
`{"errors":[{"status","detail","source":{"pointer"}}]}`. Côté Discord : opcodes 0/1/2/6/7/9/10/11, premier heartbeat après
`heartbeat_interval × jitter`, ACK, IDENTIFY puis READY, RESUME sur `resume_gateway_url`, codes de fermeture non
reconnectables (4004, 4010 à 4014), réponse initiale d'interaction sous 3 s, jeton valable 15 min, drapeau éphémère (`1 << 6`),
`PUT /applications/{app}/guilds/{guild}/commands`, limites de débit (`retry_after`).

**Non vérifié en réel : aucun appel à Challonge ni à Discord n'a été exécuté (pas d'identifiants).** Tout le comportement est
testé contre des faux serveurs locaux (`test/challonge-*.test.ts`). Hypothèses à contrôler au premier essai :

- `tournament_type` est envoyé avec des espaces (`"double elimination"`), comme dans le schéma OpenAPI de création ; les
  filtres de liste utilisent des underscores (`double_elimination`). La doc n'est pas homogène.
- Le champ `type` des corps JSON:API suit les schémas OpenAPI (`tournament`, `participant`, `match`, `Participants`,
  `TournamentState`) alors que le guide « Two-Stage » écrit `Tournaments`/`Participants`. Les chemins sont envoyés sans
  suffixe `.json` (la doc montre les deux).
- URL du bracket : `full_challonge_url` si l'API le renvoie (champ non documenté), sinon `https://challonge.com/<url>` ;
  le préfixe d'une communauté n'est pas confirmé par la doc.
- Les joueurs d'un match sont lus dans `attributes.relationships.player1/player2` (schéma OpenAPI), avec repli sur la racine et
  sur `points_by_participant`.
- La borne de `per_page` n'est pas documentée : on demande 100 et on revient au défaut (25) si l'API refuse.
- Les en-têtes de limite de débit de Challonge ne sont pas documentés ; seul `Retry-After` est lu s'il est présent.

### Quota Challonge : 500 requêtes par mois en offre gratuite

La doc indique que l'API exige une offre payante au-delà de 500 requêtes par mois et par application ; la période de grâce a
pris fin le 2026-07-06 et les applications gratuites au-dessus du quota reçoivent **429**. L'usage est visible sur
https://connect.challonge.com. L'outil limite donc les appels (`--dry-run` pour planifier, compteur « Requêtes API émises »
après chaque commande) :

| Opération                                                                                            | Requêtes                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `create` avec N participants et `--start`                                                            | 1 + ⌈N/20⌉ + 1                                                           |
| `add` de n participants                                                                              | ⌈n/20⌉                                                                   |
| `report` (lettre du match ou ID numérique)                                                           | 2 (lecture du match, puis envoi) ; +1 avec `--winner <nom>`              |
| `matches`                                                                                            | 2 ; `list`, `show` : 1 ; `start`, `finalize`, `randomize`, `checkin` : 1 |
| Bot : `creer` 1, `inscrire` 1 (0 en mode groupé), `demarrer` 1, `score` 2, `terminer` 1, `bracket` 0 |                                                                          |

Ordre de grandeur : un tournoi à élimination directe de 32 joueurs ≈ 67 requêtes, soit environ 7 par mois (calcul indicatif, la
façon dont Challonge compte les requêtes n'est pas détaillée). `--shuffle` tire les têtes de série côté client : aucune requête
en plus. Le mode `CHALLONGE_BATCH_REGISTRATIONS=1` du bot regroupe les inscriptions Discord par lots de 20.

Les 429 sont rejoués (4 tentatives, backoff exponentiel avec gigue, `Retry-After` respecté) sauf si l'attente demandée dépasse
60 s (quota épuisé : inutile d'attendre). Les 5xx sont rejoués pour GET/PUT, et pour POST uniquement en 502/503/504 (un POST en
500 n'est pas rejoué, pour éviter un doublon). Une erreur réseau est rejouée sauf pour un POST.

### Configuration

Variables d'environnement (prioritaires), puis fichier optionnel `~/.config/creator-kit/challonge.json`
(dossier surchargeable avec `CREATOR_KIT_CONFIG_DIR`) :

```json
{
  "apiKey": "…",
  "communityId": "ma-communaute",
  "game": "Guilty Gear Strive",
  "announceWebhook": "https://discord.com/api/webhooks/<id>/<jeton>",
  "discord": { "appId": "…", "guildId": "…", "organiserRoleId": "…", "batchRegistrations": false }
}
```

| Variable                                                                   | Rôle                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `CHALLONGE_API_KEY`                                                        | clé API Challonge (jamais affichée ; masquée dans les erreurs et journaux)           |
| `CHALLONGE_OAUTH_TOKEN`                                                    | jeton OAuth déjà obtenu (prioritaire sur la clé ; pas de renouvellement automatique) |
| `CHALLONGE_COMMUNITY`                                                      | communauté propriétaire des tournois (`community_id`)                                |
| `CHALLONGE_ANNOUNCE_WEBHOOK`                                               | webhook Discord d'annonce par défaut                                                 |
| `DISCORD_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`, `ORGANISER_ROLE_ID` | bot Discord                                                                          |
| `CHALLONGE_BATCH_REGISTRATIONS`                                            | `1` : inscriptions du bot envoyées par lots au démarrage                             |

Ne mettez jamais clés, jetons ou URL de webhook dans le dépôt. Sous Linux/macOS, un avertissement s'affiche si
`challonge.json` est lisible par d'autres utilisateurs (`chmod 600`).

### CLI

```
creator-kit challonge create --name "Coupe d'été" --game "Guilty Gear Strive" --type double_elimination \
    --participants joueurs.txt --shuffle --url coupe_ete --start --announce <webhook-discord>
creator-kit challonge add Zoe Yan                       # ou --participants fichier|"a,b,c"
creator-kit challonge start [--shuffle] [--group-stage]
creator-kit challonge matches --state open              # lettres de bracket et noms
creator-kit challonge report A 2-1                      # joueur 1 - joueur 2 ; --winner 1|2|nom|id, --tie, --force
creator-kit challonge report A 3-1,2-4,3-0 --winner 1   # scores par manche
creator-kit challonge list --state pending | show | checkin [--abort] | randomize | finalize
creator-kit challonge create … --dry-run                # affiche le plan de requêtes, sans réseau ni clé
```

- `--participants` : fichier (un nom par ligne, `#` pour commenter) ou liste `"a,b,c"`. Les doublons (insensibles à la casse)
  sont refusés. `--seed-by fichier` : un nom par ligne (meilleur d'abord) ou `nom;note` (note la plus haute = seed 1) ; seul,
  il fournit aussi la liste des participants. `--shuffle` et `--seed-by` sont exclusifs.
- Autres options de `create` : `--type` (`single_elimination` par défaut, `double_elimination`, `round_robin`, `swiss`,
  `free_for_all`, alias `se`, `de`, `rr`…), `--description`, `--private`, `--starts-at`, `--open-signup`, `--signup-cap`,
  `--checkin <min>` (multiple de 5), `--third-place`, `--grand-finals skip|single`, `--swiss-rounds`,
  `--group-stage [--group-size --advance]` (deux phases ; `start --group-stage` puis `finalize --group-stage`, puis `start`).
- Le dernier tournoi créé est mémorisé (`challonge-state.json`) : `--tournament <id|url>` devient facultatif. `--community`
  désigne la communauté, `--json` produit une sortie JSON.
- `--announce` n'accepte que des webhooks `https://discord.com/api/webhooks/<id>/<jeton>` ; le jeton est masqué à l'affichage.
  Un échec d'annonce n'annule pas la création (avertissement, code de sortie 0).
- Codes de sortie : 0 succès, 1 erreur API/réseau, 2 erreur d'usage.
- Erreurs en français : 401 (clé refusée), 403, 404, 422 (champ fautif, détail API conservé), 429 (quota/limite), 5xx.

### Bot Discord

1. Developer Portal Discord : créer l'application, ajouter un bot, copier le token (`DISCORD_TOKEN`) et l'ID d'application
   (`DISCORD_APP_ID`). Aucun intent privilégié : le bot demande seulement `GUILDS`, qui n'a pas besoin d'être activé.
2. Inviter le bot avec les portées `bot` et `applications.commands`. Les réponses passent par le jeton d'interaction, donc aucune
   permission de salon ne devrait être nécessaire (déduit de la doc, à confirmer au premier essai).
3. Mode développeur de Discord : copier l'ID du serveur (`DISCORD_GUILD_ID`) et celui du rôle organisateur
   (`ORGANISER_ROLE_ID`). Sans rôle configuré, il faut la permission « Gérer le serveur » ; un administrateur passe toujours.
4. `CHALLONGE_API_KEY=… DISCORD_TOKEN=… DISCORD_APP_ID=… DISCORD_GUILD_ID=… ORGANISER_ROLE_ID=… bun src/cli.ts challonge bot`
   (laisser tourner sous un gestionnaire de processus ; Ctrl-C arrête proprement). `bot --dry-run` affiche les commandes sans
   réseau ; `--no-register` saute leur enregistrement.

Au démarrage, le bot **remplace toutes les commandes de l'application sur ce serveur** (`PUT …/guilds/{id}/commands`).

| Commande                                         | Qui          | Effet                                                                                                                     |
| ------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `/tournoi creer nom [jeu] [format] [url]`        | organisateur | crée le tournoi, devient le tournoi actif du serveur, poste une annonce avec un bouton « S'inscrire »                     |
| `/tournoi inscrire [pseudo]` ou le bouton        | tous         | inscrit l'utilisateur (nom = pseudo, sinon surnom/nom Discord ; doublon refusé)                                           |
| `/tournoi demarrer [melanger]`                   | organisateur | envoie les inscriptions en attente, tire au sort si demandé, lance le tournoi                                             |
| `/tournoi score match score [gagnant] [egalite]` | organisateur | `match` = lettre du bracket ou ID ; `score` = `2-1` ou `3-1,2-4,3-0` ; `gagnant` = utilisateur Discord inscrit via le bot |
| `/tournoi terminer`                              | organisateur | finalise le tournoi                                                                                                       |
| `/tournoi bracket`                               | tous         | affiche le lien du bracket (aucune requête Challonge)                                                                     |

Fonctionnement : chaque commande reçoit un accusé **différé et éphémère** avant tout appel réseau (limite de 3 s de Discord),
puis la réponse éphémère est modifiée ; les annonces publiques (création, démarrage, scores, clôture) sont envoyées en
message de suivi sans mention (`allowed_mentions: {parse: []}`). Les erreurs sont toujours éphémères et en français. Le contrôle
du rôle a lieu avant tout travail ; les interactions d'un autre serveur sont refusées.

Reconnexion Gateway : heartbeat avec ACK obligatoire (connexion « zombie » fermée puis reprise), RESUME via
`resume_gateway_url`, nouvel IDENTIFY sur codes 4003/4007/4009 ou session invalide, arrêt définitif sur 4004 (token) et
4010 à 4014, backoff exponentiel avec gigue (remis à zéro après READY/RESUMED).

Correspondance Discord → Challonge : stockée dans `challonge-state.json` (même dossier que la config), écriture atomique
(fichier temporaire puis `rename`), mises à jour sérialisées. Chaque participant créé par le bot porte `misc = "discord:<id>"`
côté Challonge, ce qui permet de reconstituer la correspondance si le fichier est perdu. Le fichier ne contient aucun secret.

### Tests et limites

`bun test test/challonge` (77 tests, sans réseau externe) couvre : en-têtes et corps de l'API v2.1, retries 429/5xx, messages
d'erreur sans fuite de clé, pagination, lots de 20, seeding/shuffle, saisie de scores, `--dry-run`, CLI de bout en bout contre un
faux Challonge, gestionnaire d'interactions Discord (rôles, différé éphémère, annonce, inscriptions, groupage), et la Gateway
contre un serveur WebSocket local (HELLO, IDENTIFY/READY, heartbeats, ACK manquant, RESUME, opcodes 7 et 9, codes fatals). Le
bot complet est aussi exercé avec une Gateway locale. **Non couvert : le comportement réel de Challonge et de Discord**,
Windows (`rename` atomique, binaire compilé), OAuth (obtention et renouvellement de jetons), tournois par catégories hors
élimination/round robin/suisse, matchs en « free for all ».
