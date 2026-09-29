# Validation des brackets Achilléa

État du code au 25 septembre 2026. Ce document décrit les vérifications à faire
avec une session réelle ; il ne prouve pas à lui seul leur réussite en production.

## Chaîne des données

`GET /tournaments/:id` renvoie le tournoi, ses participants et les données du
bracket. La troisième valeur provient de `brackets-manager` et des tables
`achillea.bm_*`. Le client de la page `/achillea/tournaments/:id` consomme cette
valeur pour son onglet « Bracket ». `GET /tournaments/lobbies/:id` expose les
lobbies liés au tournoi et `GET /tournaments/lobby/:id` ceux d'un match.
`GET /tournaments/:id/summary` calcule un résumé public ; le circuit utilise les
classements finaux des brackets terminés. La présence d'inscrits ne démontre ni
un match joué ni un vainqueur.

La génération (`POST /tournaments/generate-bracket/:id`) exige une session
organisateur. Le code n'accepte que les phases `Preregistering` ou `Preparing`,
au moins deux participants actifs, une capacité suffisante et aucun score ou
résultat déjà présent dans l'arbre existant. Les scores sont soumis par
`POST /tournaments/report-score`, puis validés par
`POST /tournaments/validate-score`, selon les droits et la politique du tournoi.

## Probes réelles à relever

| Contexte | Vérification | Preuve attendue |
| --- | --- | --- |
| Sans session | Ouvrir la liste, puis chaque tournoi et son onglet Bracket ; consulter circuit, classement et résumé | Réponses HTTP, arbre affiché, nombre de participants et de matchs concordants, état vide explicite si aucun bracket |
| Session membre | Refaire les lectures, ouvrir les lobbies accessibles | Même contenu public ; identité membre visible ; aucune action organisateur offerte |
| Session organisateur d'un tournoi de test en préparation | Comparer participants actifs, capacité, seeds et arbre ; générer seulement si aucun résultat n'existe | Identifiants de participants et de matchs persistés ; deuxième lecture identique ; aucune perte de score |
| Session organisateur d'un tournoi commencé ou terminé | Lire l'arbre, l'historique des matchs et le résumé ; vérifier que la régénération est refusée | Scores et classements conservés ; réponse de refus sans mutation |
| Match réel autorisé | Suivre rapport puis validation du score, relire lobby, bracket et classement | Même gagnant et mêmes scores dans les trois surfaces ; événement d'audit présent |

Pour une comparaison DB/API, rapprocher `event.id`, `event.internal_state`,
`event.participants_number`, `tournament_participant.status`,
`tournament_participant.bracket_participant_id`, les lignes `bm_stage`,
`bm_match`, `lobby.bracket_match_id` et `lobby_match`. Ne jamais créer de score
ou de vainqueur pour un tournoi historique sans source de résultat vérifiable.
Les probes de mutation doivent utiliser un tournoi de test appartenant à la
session et des participants consentants ; les tournois historiques se vérifient
en lecture seule.

## État des preuves

- Relevé DB en production transmis pendant cette investigation :
  `achillea.bm_stage` contient 9 lignes. Les tournois 9, 18, 19, 21, 22, 23 et
  32 ont au moins une stage ; la plupart de leurs matchs ont un statut supérieur
  ou égal à 4. Les tournois 3 et 7 n'ont aucune stage. Ces nombres attestent la
  présence de structures et d'états de match, pas le calcul correct des podiums.
  L'API publique renvoyait encore zéro stage dans le détail avant la correction
  locale de `TournamentService.findDetail`. Une nouvelle lecture HTTP après
  déploiement doit vérifier que les stages DB deviennent visibles dans l'UI.
- Vérifié dans le code : les routes publiques ci-dessus existent ; la page de
  détail consomme le troisième élément du tuple ; l'API charge maintenant les
  données réelles via `tournamentBracketData`.
- Vérifié localement : typecheck de `apps/api` après cette correction.
  La suite `apps/api/test/api.test.ts` a donné 61 réussites et 17 échecs
  (plusieurs réponses SQL à 500 et des délais dépassés, y compris la liste des
  tournois). Le test du triplet passe par saut lorsque la liste ne fournit aucun
  identifiant ; il ne valide donc pas le contenu d'un bracket réel.
- À vérifier en production : session membre et organisateur réelle, cohérence
  DB/API/UI de chaque tournoi, génération et résultats des brackets historiques,
  persistance des scores, attribution des points et rendu navigateur. Aucune
  génération ni écriture de résultats de production n'est attestée ici.

Le 25 septembre 2026, la lecture SQL de `event` a aussi montré le tournoi 32
avec `status = Open` mais `internal_state = Finished`. La liste publique
projetait l'ancien `status` alors que le circuit et les transitions utilisent
`internal_state`. La projection API déduit maintenant le statut public de l'état
interne ; son résultat après déploiement reste à vérifier.
