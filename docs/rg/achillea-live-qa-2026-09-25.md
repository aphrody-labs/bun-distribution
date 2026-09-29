# Achilléa — journal de vérification réelle du 25 septembre 2026

Release observée sur `/srv/rg/current` : `b032406b2a92a8adb5e6d43cb952bd897831dc3e`.
Les cinq services `rg-website`, `rg-api`, `rg-bot`, `rg-achillea-bot` et `rg-cron`
étaient actifs ; les probes HTTPS du site et de l'API des tournois ont répondu 200.
Navigateur Chrome connecté : le menu affichait le profil public `aphrody_code`.
Aucun cookie, jeton ni identifiant privé n'est conservé ici.

| Page ou API | Action en session réelle | Observation | État |
| --- | --- | --- | --- |
| `/achillea/tournaments` | Ouvrir la page | 9 tournois visibles ; Summer Kama Club marqué « Terminé », conforme à `internal_state` | Réussi |
| `/achillea/tournaments` | Filtrer « Terminés », chercher `Ilion`, puis « Inscriptions ouvertes » | 9 terminés ; recherche ramenée aux 6 coupes d'Ilion ; aucun tournoi ouvert, état vide explicite | Réussi |
| `/achillea/tournaments/23` | Ouvrir « Arbre du tournoi » | 5 tours et finale avec scores visibles ; l'API détail expose désormais les stages réels | Réussi en lecture |
| `/achillea/tournaments/circuit/ranking` | Ouvrir Joueurs, Clans, Tournois | 95 joueurs, 18 clans, 5 tournois ; podiums et liens visibles | Réussi en lecture |
| `/achillea/ranked/leaderboard` | Ouvrir la liste, filtrer le palier Bronze | 12 joueurs en solo, puis 1 joueur Bronze ; total et ligne cohérents | Réussi |
| `/achillea/ranked/history?player=980132803272376370` | Suivre le lien d'historique depuis le classement | 3 matchs publics et bilan affichés | Réussi en lecture |
| `/achillea/ranked/history` | Ouvrir avec la session et choisir « 7 jours » | 7 matchs personnels sur toute la période ; 0 sur 7 jours, état vide explicite | Réussi |
| `/achillea/ranked` | Ouvrir le hub connecté | Profil classé indisponible ; `GET /api/ranked/me?mode=2` répond 500 | **Échec** : insertion `user_elo` refusée par RLS |
| `GET /api/tournaments` | Appel public de production | 9 éléments, `meta.total=9`, Summer Kama Club `Finished` | Réussi |
| `GET /api/tournaments/circuit/ranking` | Appel public de production | 95 joueurs, 18 clans, 5 tournois | Réussi |

La cause du 500 du profil est le `GET /ranked/me` qui écrit une ligne
`user_elo` à la première lecture sous un rôle soumis à RLS. Ce défaut est en
cours de correction ; aucune validation de la correction n'est revendiquée.

Ce journal couvre seulement les actions listées. La matrice
[`achillea-qa-matrix.md`](achillea-qa-matrix.md) et l'inventaire
[`achillea-api-route-inventory.csv`](achillea-api-route-inventory.csv) gardent
les autres pages, contrôles, rôles et routes au statut « à tester ».
Les écritures de scores, distributions d'AP et actions d'administration sur
les tournois historiques n'ont pas été utilisées comme tests.

## Nouvelle release `da1e899` (25 septembre 2026)

Le pointeur `/srv/rg/current` cible `da1e8991484bee7f45302c0f76824dba605b0966`.
Les cinq services RG sont actifs. Dans la même session Chrome connectée,
`/achillea/ranked` affiche désormais le profil public `aphrody_code`, le palier
Fer, les statistiques et les commandes de défi et recherche. L'échec RLS
observé ci-dessus est donc corrigé sur cette lecture authentifiée.

Le miroir Discord partagé est déployé avec la même valeur absolue de
`RG_DISCORD_SYNC_SQLITE_PATH` dans `rg-bot`, `rg-achillea-bot` et `rg-cron`.
Sa présence dans la configuration ne prouve pas encore que les guildes ont été
collectées ; vérifier les lignes de `rg_discord_sync_runs` par profil après
une exécution réelle de synchronisation. Le bot Achilléa courant a signalé
58 guildes rejointes, mais ses intents privilégiés `GuildMembers`,
`GuildPresences` et `MessageContent` sont refusés par Discord : l'inventaire
des membres de ce profil ne peut pas être complet dans cet état.

## Vérification Discord et administration

La release `b29edd8` a activé le miroir et un lancement ponctuel du jeton
Achilléa legacy a terminé avec `guilds=4 succeeded=4 failed=0`. La base SQLite
partagée contenait ensuite 58 guildes pour `current`, 4 pour `legacy` et 2 pour
`rg`; le cache Redis portait 64 résumés. Les inventaires de membres Achilléa
sont incomplets car ces sessions ne disposent pas de l'intent membres.

Depuis `/admin/cron` en session administrateur réelle, le bouton de collecte
Discord a d'abord révélé `CRON_SECRET` absent du démon. Son provisionnement a
été corrigé, puis le même bouton a bien déclenché la tâche. La projection de
la guilde Achilléa a réussi avec 3 261 membres et 105 rôles sur la release
`381b639`. La guilde RG a été limitée par Discord (`opcode 8`) lors de cet
essai ; son miroir reste présent, mais la projection métier n'est pas déclarée
réussie. Les échecs ont été consignés sans réconciliation destructive.

`/admin/stats` a été ouvert en session admin : l'audience affichait zéro
requête malgré des accès au site. Le journal `/var/log/nginx/rg-stats.log`
était vide et la configuration Nginx active ne définissait pas `rg_stats`.
Une correction infra est préparée, mais elle n'est pas validée dans cette
release ; l'audience ne doit pas être présentée comme complète.

## Validation de la release `72632af`

La dernière collecte RG a terminé sans erreur : Rose Griffon 1 854/1 854
membres et 92 rôles ; Achilléa 3 261/3 261 membres et 105 rôles. Dans le
miroir partagé, le profil `rg` porte 2 guildes et 5 115 membres avec les deux
inventaires complets. `current` porte 58 guildes et `legacy` 4, leurs membres
restant incomplets faute d'intents privilégiés. Redis portait 64 résumés.

La release `72632af` est active avec ses cinq services. `nginx -t` réussit,
`rg_stats` est chargé et le journal a commencé à recevoir des lignes. En
session admin, `/admin/stats` affichait 62 requêtes analysées et 6 domaines
actifs après redémarrage ; l'onglet Achilléa montrait son trafic local, sans
additionner le cache planifié. `/admin/settings` affichait trois champs RG et
quatre champs Achilléa, tous issus du contrat public, et `/admin/achillea`
affichait le rapprochement des comptes. `GET /api/admin/config/public` répond
401 sans session ; son accès authentifié direct n'a pas été vérifié car le
navigateur connecté bloque la navigation brute vers cette API.

## Validation de la release `cc06f11`

Le compteur « Tournois disputés » de `/admin/achillea` affiche 9, concordant
avec les 9 lignes `achillea.event` terminées, au lieu des 0 lignes de
`achillea.tournament_event`. Une nouvelle collecte Discord a alimenté
`rg_oauth_account_links` avec 10 liens Discord, 2 Patreon et 2 Twitch ; leurs
jetons ne sont pas copiés. La tâche de statistiques lancée en session de
service a écrit 7 agrégats horaires couvrant 7 hôtes et 1 112 requêtes,
`complete=1`, avec les deux résumés OAuth et télémétrie présents dans Redis.
Le clic admin sur la tâche `stats:achillea` répondait encore 400 car son nom
encodé (`%3A`) n'était pas décodé par le routeur cron. Ce défaut a été corrigé
en source mais doit être retesté après déploiement de la prochaine release.

### Parcours complémentaire en session connectée

29 routes statiques Achilléa distinctes ont été ouvertes dans Chrome connecté
après `cc06f11` : accueil ; trois pages `admins` ; `casts` ; `clans`, création
et dashboard ; création/liste des événements ; guide et brand kit ; les quatre
routes Astral/Asytral ; licence ; création/validation d'organisation ; hub,
historique, leaderboard, match et paliers ranked ; liste, création et classement
des tournois ; portefeuille et page d'accès refusé. Chaque navigation a rendu
un titre de page et aucun écran d'erreur inattendue n'a été détecté dans
l'arbre DOM. Ce balayage vérifie seulement le chargement initial : les routes
dynamiques, permissions par rôle, actions de formulaire, mutations et états
 réseau de ces pages restent dans la matrice « à tester ».

## Validation de la release `6e7401c`

Le bouton « Audience des sites RG » de `/admin/cron` a répondu « démarrée »
en session administrateur, et le journal du démon confirme la fin de
`stats:achillea` en 27 ms sans erreur. Le SQLite partagé contenait ensuite
7 agrégats horaires, 2 475 requêtes et `complete=1`; les deux résumés OAuth
et télémétrie existaient dans Redis. Le miroir Discord portait `rg` : 2 guildes,
5 115 membres complets ; `current` : 58 guildes, membres incomplets ; `legacy` :
4 guildes, membres incomplets. Les cinq services et la release `6e7401c`
étaient actifs sur le VPS.

Dans `/admin/settings` connecté, l'onglet Achilléa a activé le bouton de
sauvegarde après saisie temporaire de `javascript:alert(1)` dans « Lien du
site ». Le serveur a répondu « URL HTTPS ou chemin local absolu requis » ; la
valeur affichée a été rétablie sans écriture et le bouton est redevenu inactif.

## Validation de la release `8a79398`

La liste `/achillea/tournaments` a affiché 9 événements après chargement ; son
état initial à 0 était transitoire. Le classement du circuit a affiché 95 joueurs,
18 clans et 5 tournois. Dans Chrome connecté, `/achillea/ranked/history` affiche
désormais 7 matchs dont 3 victoires, 1 défaite, 2 nuls et 1 forfait. Les deux
entrées `draw` portent le libellé « Match nul » et les filtres exposent leur état
`aria-pressed`. Une autre entrée `1–1` est classée `win` par l'API ; sa règle
d'arbitrage reste à vérifier avant de modifier le résultat.

`GET https://ranked.rosegriffon.fr/api/tournaments/23/summary` a répondu 200
après déploiement : 31 matchs, 30 entrées du classement avec des buts non nuls,
21 buts marqués pour Ban. Avant la release, les champs de buts du classement
étaient tous à zéro malgré 206 buts dans les statistiques de matchs. Les cinq
services RG et le pointeur `/srv/rg/current` étaient actifs sur `8a79398`.
Les tests `auth-status` (2/2) et les contrôles TypeScript API et site passent.
Le scénario d'une panne réelle `/auth/me` n'a pas été reproduit en production ;
sa classification est couverte par les tests ciblés.

## Validation de la release `f856710`

En production, l'API du circuit retourne 9 tournois terminés : 5 classements
résolus et 4 non résolus, avec 95 joueurs classés. L'onglet « Tournois du circuit
(9) » du navigateur connecté montre la Masia Winter Cup V2 sans podium ni AP
inventés et explique que son classement historique n'est pas résolu. Sur le
tournoi 23, « Podium & Résultats » affiche les groupes ex æquo `5e-8e`, `9e-16e`
et `17e-32e` avec leurs points, sans faux rangs séquentiels.

`GET /api/users/281114294152724491` retourne, pour le solo, 7 matchs,
3 victoires, 2 défaites, 2 nuls, 11 buts marqués et 7 encaissés hors forfait.
La victoire au score `1–1` du match 329 provient du forfait adverse vérifié dans
PostgreSQL ; le score seul ne doit pas la reclasser en nul. Le navigateur a aussi
suivi le lien du leaderboard solo (12 joueurs) vers l'historique public de
Richo (3 matchs) ; le duo affiche 0 joueur après chargement. Les cinq services
RG et `/srv/rg/current` pointaient sur `f856710` après activation.

Les contrôles TypeScript des packages API, site, client et types passent ;
les tests ciblés de lecture de profil passent (4/4). L'agrégation historique
reste limitée aux matchs `lobby_user` réellement enregistrés ; aucun résultat
absent n'a été reconstitué.

## Validation de la release `70c0545`

Les quatre brackets non résolus ont été inspectés en base : tournois 3 et 7
sans tableau enregistré ; tournoi 9 avec un match non validé ; tournoi 18 avec
sept matchs non clos. Le tournoi 18 contient 127 matchs de bracket, dont 93
avec deux scores (329 buts) : ces scores partiels ne prouvent pas un champion.
La garde de versement AP refuse ces cas avant mutation. Les cinq brackets
résolus (19, 21, 22, 23, 32) n'ont aucun match non clos selon la même requête.

Dans Chrome connecté, le bouton « Distribuer les AP Podium » du tournoi 18
est désactivé avec l'explication « bracket historique ne fournit pas de champion
vérifié » ; celui du tournoi 23 est activé après vérification du classement.
Aucun bouton de versement n'a été déclenché. Le filtre « Nuls » de l'historique
affiche 2 matchs et encode `?result=draw` ; le filtre « 3 ou plus » du circuit
affiche 18 joueurs sur 95. Les contrôles TypeScript API et site et 4 tests
ciblés de lecture de profil passent. Le bouton de pagination des historiques
reste à éprouver avec un joueur ayant plus de 100 matchs.

## Validation de la release `99b989b`

Le pointeur `/srv/rg/current` désigne `99b989bc5b68bfdc6404b3a0bba6c29b58bbeda4` ; les cinq services RG sont actifs, Nginx valide et sept pages publiques (les cinq parcours demandés et les fiches des tournois 18 et 23) répondent HTTP 200. `bun run --cwd apps/website type-check` et `git diff --cached --check` ont passé avant la release. La construction a nécessité le nettoyage catalogué `aphrody-infra reclaim` : le VPS est passé de 176 Mo à 5,1 Gio libres avant assemblage et conserve 4,0 Gio après activation.

Dans Chrome avec la session `aphrody_code`, la liste affiche 9 tournois après chargement ; le filtre « Terminés » puis « Effacer les filtres » fonctionnent. À la largeur mobile demandée de 390 px, le DOM expose neuf cartes et leurs liens vers les fiches. La fiche 18 expose sept onglets, dont « Notes Staff » selon le rôle, et la flèche droite déplace la sélection et le focus. Son onglet « Podium & Résultats » indique « Classement non résolu » ; le versement AP demeure désactivé. La vue mobile de son bracket expose les rencontres avec un nom accessible et les scores enregistrés.

Sur la fiche 23, le résumé affiche le rang 1, le rang 2 et deux rangs 3 ex æquo ; le bouton de versement est actif, sans avoir été déclenché. Un écart de libellé est confirmé : l'en-tête annonce « Cashprize 1er 50 AP » et le résumé affiche « Ban +100 AP ». L'API fournit ici 100 points de circuit, tandis que 50 AP proviennent de la règle du prix de première place. Le libellé du résumé est corrigé dans le lot suivant ; aucun versement ni rang n'a été modifié. Les contrôles Chrome post-release ont porté sur ces interactions ciblées, pas sur tous les rôles, tous les onglets, le zoom 200 % ni les largeurs 320/768/1440 px.

## Validation de la release `3809715`

`/srv/rg/current` désigne `38097157e42aff7a24fcbd07864b0ba1c7496320` ; les cinq services RG sont actifs et Nginx valide. Sur l'API RG `https://api.rosegriffon.fr/v1/achillea/tournaments`, `states=Finished&pageSize=1` retourne une ligne, un total de 9 et une limite de 1 ; `pagination=1&organization=2147483647&states=Finished` retourne 0 ligne et un total de 0 ; `states=Open` retourne 0. Ces vérifications publiques prouvent le contrat RG, tandis que le test d'intégration local reste non exécuté faute de PostgreSQL local.

`https://ranked.rosegriffon.fr/api/tournaments` est une autre surface, encore interrogée par le client Achilléa dans sa configuration par défaut. Son contrat de pagination diffère (`pageSize=50` a conservé une limite de 25). Il faut inventorier les routes et la configuration effective avant de basculer le client vers l'API RG ; le succès du filtre RG ne prouve pas la parité des deux services.

Dans Chrome connecté, le circuit affiche 95 joueurs, 18 clans et 9 tournois ; la vue mobile demandée à 390 px expose 95 cartes de joueurs. Le filtre « Classement non résolu » ramène les tournois de 9 à 4. La fiche 23 affiche maintenant « +100 points de circuit » pour Ban, distinct de son prix de première place de 50 AP. Le leaderboard solo expose 12 cartes mobiles avec liens vers les historiques publics. Les scénarios duo, pagination de plus de 100 matchs, session anonyme réellement séparée, zoom 200 % et tous les rôles restent à vérifier.

## Validation de la release `c85d675`

`/srv/rg/current` désigne `c85d675a45d96301b4a11bdabe754f723334d118` ; les cinq services RG sont actifs, Nginx valide et la route `/achillea/ranked/tiers` répond HTTPS 200. Dans Chrome connecté, les sélecteurs Solo/Duo des paliers sont rendus à 18 px, avec une hauteur minimale de 44 px et leur état `aria-pressed`; les onze paliers sont présents.

Le tableau `/admin`, qui affichait auparavant le digest React `2926058691`, rend maintenant « Tableau de bord » sans écran d'erreur. La correction normalise les dates PostgreSQL utilisées par le graphe d'inscriptions. Les pages `/achillea/tournaments` et `/achillea/tournaments/circuit/ranking` ont aussi rendu leurs titres et contenu réels dans cette session.

La liste de tournois utilise la limite effective renvoyée par l'API lors de sa pagination, y compris sur le contrat legacy qui plafonne la limite demandée à 25. Les quatre tests ciblés de cette pagination et du graphe admin passent (0 échec) ainsi que le typecheck du site. La construction de release signale encore un appel Discord `401` pendant le rendu statique et trois valeurs `/admin/database` trop grandes pour le cache Next; l'artefact est assemblé et activé, mais ces avertissements restent à corriger avant de déclarer le build silencieux.

## Validation de la release `4ad79bb`

`/srv/rg/current` désigne `4ad79bbfd0a1e941590b4635b9568afc606902b9` ; les cinq services RG sont actifs, Nginx valide et le circuit répond HTTPS 200. Dans Chrome connecté, le champ du circuit « Rechercher un joueur ou un clan » est désormais exposé comme champ de recherche nommé ; la recherche `Ban` ramène 1 joueur sur 95. Le champ de recherche des clans porte aussi un nom accessible.

Les cinq pages demandées répondent 200 sans cookie : circuit, tournois, hub classé, historique et leaderboard. Les lectures API publiques de tournois, circuit, paliers, leaderboard et historique d'un joueur répondent également 200 sans session ; l'historique personnel reste 401 sans session comme prévu. Les tests ciblés de parité/authentification passent (19/19).

L'historique public sélectionne désormais un adversaire de l'équipe opposée et une ligne par lobby, pour ne plus afficher un coéquipier ou répéter une partie 2v2. Les trois tests `ranked-history` passent. La sonde live du joueur utilisé en mode duo ne retourne aucun match : elle ne constitue donc pas une preuve sur un dataset 2v2 rempli. Enfin, l'assemblage ne déclenche plus le `401` Discord observé précédemment ; les trois avertissements de cache Next `/admin/database` restent présents.
