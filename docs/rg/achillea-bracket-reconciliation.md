# Réconciliation des brackets historiques Achilléa

Observation en lecture seule de PostgreSQL `rg`, schéma `achillea`, le 25 septembre 2026. Les comptages et identifiants ci-dessous viennent des tables `bm_stage`, `bm_match`, `lobby`, `lobby_match`, `lobby_user`, `tournament_participant` et `tournament_event`. Aucun résultat ni versement n'a été modifié.

| Tournoi | Données présentes | Preuve manquante | Suite sûre |
| --- | --- | --- | --- |
| 3 | 64 inscrits, 24 lobbies `Fresh`, aucun `lobby_match` et aucune entrée `bm_stage`/`bm_match`. Les 24 `bracket_match_id` des lobbies ne correspondent à aucun match conservé. | Tableau, scores, validations et progression vers une finale. | Rechercher un export d'époque ou une feuille de résultats signée par le staff. Sans cette source, afficher « historique non résolu » et ne pas générer de champion. |
| 7 | 32 inscrits, 8 lobbies `Fresh`, aucun `lobby_match` et aucune entrée `bm_stage`/`bm_match`. Les huit `bracket_match_id` sont orphelins. | Même absence de tableau, scores et validations. | Même recherche d'archive ; ne pas recréer le bracket depuis le seul nombre d'inscrits. |
| 9 | Un stage et 32 matchs ; 31 matchs au statut 5. Le match 2048, dernier non clos (statut 2), lie les participants bracket 16 et 9 au lobby 60 `Fresh`. Ses deux parties portent `0–0`, sans validation des équipes ni de l'admin ; les deux `lobby_user` ont score 0 et `validated_result=false`. | Résultat validé du match 2048. | Demander la preuve du résultat au staff ou retrouver une archive de match, puis utiliser le flux de validation prévu par l'application. Aucun des deux joueurs ne peut être déclaré vainqueur sur ces données. |
| 18 | Un stage, 127 matchs, 127 lobbies ; 114 matchs au statut 5, six au statut 4, cinq au statut 1, un au statut 2, un au statut 0. 99 inscrits. Les 127 lobbies comportent 254 lignes `lobby_match`, dont 196 `admin_validated=true`. | La propagation du bracket est incomplète. Les matchs 11923, 12000, 12005, 12008 et 12009 ont un adversaire absent ou inconnu dans le bracket, et leurs lobbies ont un seul `lobby_user` ou aucun résultat validé. Le match 11989 a deux joueurs et un lobby `Finished` avec score admin validé `3–1`, mais le bracket reste au statut 1 sans score/résultat. Le match 11967 porte `3–0` et `win/loss` mais reste au statut 2. Les six matchs au statut 4 (11924, 11968, 11990, 11999, 12006, 12007) ont aussi un score et un vainqueur dans `bm_match`, sans statut final 5. | Réconcilier d'abord les matchs dont le lobby et le bracket concordent, dans une transaction contrôlée par le domaine avec aperçu du diff et audit. Vérifier ensuite les branches à adversaire absent contre une archive officielle ; ne pas déduire le champion du seul score des lobbies, ni déclencher de versement AP. |

Le journal `tournament_event` est vide pour ces quatre tournois. Il ne fournit donc pas de preuve supplémentaire de validation ou de correction historique.

## Contrôle préalable à toute correction

1. Exporter un instantané daté des lignes `bm_*`, `lobby*` et des inscriptions concernées ; rapprocher chaque score avec les identifiants des deux joueurs et le statut de validation.
2. Produire un aperçu explicite des changements match par match, y compris les prochains adversaires calculés par le moteur de bracket. Faire approuver les résultats manquants par le staff à partir de sources historiques vérifiables.
3. Appliquer le flux de validation de l'application avec journal d'audit, puis recalculer le circuit en lecture seule. Ne débloquer la distribution AP qu'après vérification d'un champion unique et de tous les matchs requis terminés.

Les statuts numériques sont conservés tels qu'observés ; `5` est le statut final utilisé par la garde actuelle. Un lobby `Finished` ou un score `admin_validated=true` ne prouve pas, à lui seul, que tout le bracket est terminé.
