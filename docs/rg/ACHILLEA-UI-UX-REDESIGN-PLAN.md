# Plan de redesign et de correction UI/UX Achilléa

État de référence : 25 septembre 2026, release vérifiée `bf0000a`. Ce plan couvre les pages publiques `/achillea/tournaments`, `/achillea/tournaments/circuit/ranking`, `/achillea/ranked`, `/achillea/ranked/history`, `/achillea/ranked/leaderboard`, leurs fiches et composants liés. Les constats Chrome distinguent le chargement final des états transitoires. La matrice détaillée des parcours reste dans [achillea-qa-matrix.md](achillea-qa-matrix.md) et les preuves de production dans [achillea-live-qa-2026-09-25.md](achillea-live-qa-2026-09-25.md).

## Résultat attendu

Une interface compétitive fidèle à l'identité Achilléa sombre, lisible à basse vision, utilisable au clavier et sur mobile, où les données affichées portent leur provenance et leur état. Toutes les lectures publiques utiles doivent rester accessibles sans compte ; les actions personnelles, de staff et de paiement AP gardent leurs autorisations. Les filtres, classements, brackets et historiques doivent représenter les données enregistrées sans inventer un résultat manquant.

## État observé et décisions

| Surface | Preuve actuelle | Décision de redesign |
| --- | --- | --- |
| Tournois | Chrome : 9 tournois ; descriptions complètes dans les cellules. `TournamentTable.tsx` emploie `text-sm`, `text-xs`, `text-[11px]` et une action `h-8`. | Tableau lisible à 18 px minimum, descriptions courtes avec accès au texte intégral, cibles d'action de 44 px minimum ; vue cartes adaptée aux écrans étroits. |
| Fiche et bracket | `tournaments/[id]/tournament-detail-client.tsx` a sept onglets compacts, dont un réservé au staff ; `TournamentBracket.tsx` multiplie les labels `text-xs` et des pastilles de score de 20 px. | Navigation d'onglets avec état et focus visibles, bracket en colonnes ou cartes selon la largeur, scores et noms lisibles sans zoom horizontal permanent. |
| Circuit | Chrome : 95 joueurs, 18 clans, 9 tournois. Tableau joueurs de 9 colonnes et largeur minimale de 1 000 px ; quatre tournois ont un classement non résolu. | Vue dense sur grand écran, cartes hiérarchisées sur mobile, filtres utiles et URL partageable, état « non résolu » explicite sans podium ni AP. |
| Historique classé | Chrome connecté : 7 matchs, filtres mode/période/résultat ; pagination par lots de 100 et URL partageable. | Garder le bilan lié aux matchs chargés, rendre la portée du filtre évidente, offrir recherche d'adversaire et intervalle d'AP si l'API le permet, vérifier retour navigateur et pages multiples. |
| Leaderboard | Chrome : 12 joueurs solo et 0 duo après chargement ; lien du joueur vers son historique public. | Conserver rangs ex æquo, distinguer « aucun joueur duo » du chargement, rechercher et filtrer sans masquer le total ni la saison ; vérifier la version mobile. |
| Connexion | Une navigation montre brièvement « Vérification de la session… » ; les pannes `/auth/me` ont déjà un statut distinct de `401/403`. | Stabiliser l'état initial rendu côté serveur, conserver les lectures anonymes et ne présenter la connexion que pour les actions personnelles. |
| Récompenses | Le tournoi 18, terminé mais sans champion vérifié, avait un bouton AP actif. La release `70c0545` le désactive et protège le serveur ; le tournoi 23 résolu reste éligible. | Conserver l'explication et la double garde ; afficher aussi « déjà distribué » depuis `tournament_event` pour éviter une action trompeuse. |
| Découverte | Quatre routes publiques manquaient au sitemap ; `bf0000a` les sert désormais. L'historique personnel est `noindex`. | Vérifier automatiquement la parité routes publiques indexables/sitemap/menu et les liens du parcours ; ne pas indexer les pages de session ou les URLs à identifiant privé. |

## Direction visuelle et composants

Conserver la palette sombre Achilléa (`achillea.css`, fond `#0d0814`, texte `#f3edf7`), les accents violets et les polices historiques Inter/HUMANE déjà présentes. Unifier les cartes, tableaux, onglets, statuts et boutons avec les tokens Material 3 partagés sans effacer cette identité. Le corps, les données, les libellés et les messages d'état doivent mesurer au moins 18 px ; les cibles interactives au moins 44 × 44 px. Le focus est épais, statique et contrasté. Les icônes seules ont un nom accessible ; aucune information de victoire/défaite, palier ou statut ne dépend uniquement de la couleur.

Créer une petite bibliothèque de primitives Achilléa dans `components/achillea` : `CompetitionPageHeader` (titre, retour, contexte, actions), `CompetitionStatus` (chargement, vide, erreur, non résolu, terminé), `CompetitionFilterBar` (label, compteur, remise à zéro, URL), `CompetitionDataView` (table sur grand écran, cartes sur petit écran), et `MatchResultBadge`. Réutiliser `@rosegriffon/ui` pour les primitives de base ; documenter les variantes Achilléa et éviter un second système de boutons ou de thèmes.

## Ordre de réalisation

### P0 — Vérité et lisibilité des parcours principaux

1. Refondre `TournamentTable.tsx`, `EventParticipantsTable.tsx` et `TournamentBracket.tsx` : typo/cibles conformes, descriptions résumées, ligne cliquable sans perdre les liens, états de match explicites. Préserver les 9 tournois et les 99 inscrits du tournoi 18 ; ne pas confondre inscription et résultat.
2. Refaire les sept onglets de `tournaments/[id]/tournament-detail-client.tsx` (six publics, un staff) avec tablist, onglet actif, navigation clavier, focus visible, retour à l'onglet après chargement. Tester chaque onglet avec un tournoi complet (23) et un incomplet (18).
3. Afficher dans `TournamentTopSummary.tsx` des états distincts pour résumé vide, bracket non résolu, erreur réseau et chargement. Le composant avale actuellement les erreurs et peut rendre `null`, ce qui efface l'explication. Le versement AP doit rester interdit côté serveur si le bracket est incomplet.
4. Vérifier les résultats et chiffres depuis l'API typée : rangs ex æquo, buts, AP, forfaits et matchs nuls. Toute statistique « 0 » doit être une vraie valeur observée ; une donnée inconnue s'affiche « Non disponible » avec sa raison.

### P1 — Navigation, recherche et mobile

1. Donner au classement du circuit une variante carte sous 640 px ; conserver le tableau complet, les rangs absolus, les 9 colonnes et les 95 joueurs sur grand écran. Ajouter filtres saison/tournoi/clan/palier seulement après vérification de leur contrat API et de leur sémantique. Les filtres existants recherche et minimum de tournois doivent avoir un bouton d'effacement et, si partagés, un état URL.
2. Transformer la liste des tournois en cartes compactes sur mobile avec nom, date, format, places, statut et action « Détails ». Le règlement complet reste sur la fiche. Proposer statut, format, période, organisateur et places disponibles si les champs sont fiables ; afficher les filtres actifs et le nombre de résultats.
3. Étendre l'historique et le leaderboard : recherche d'adversaire, filtres AP/forfait et saison lorsqu'ils sont servis par l'API ; pagination avec compteur « chargés / total » si le total devient disponible. Ne pas présenter le bilan local comme global tant que des pages restent à charger.
4. Aligner le menu latéral, les liens de cartes, le sitemap et les URL canoniques sur les routes réellement publiques. Le parcours anonyme doit mener de `/ranked` au leaderboard, puis à l'historique public d'un joueur ; l'historique personnel propose la connexion sans bloquer cette lecture publique.

### P2 — Extension cohérente aux autres surfaces Achilléa

Appliquer les mêmes primitives et seuils à `RankedTiersGrid.tsx`, `TierDistribution.tsx`, `ClanCard.tsx`, `CastCard.tsx`, `ClanOrgchart.tsx`, puis aux panneaux staff `PlayerNotesPanel.tsx`. Séparer visuellement lecture publique et commandes autorisées ; tester chaque rôle avant d'élargir une action. Le dashboard admin et les pages RG/Azalée gardent leurs identités et contrats propres.

## Contrats de données et dépendances

- PostgreSQL `rg.achillea` reste la source métier ; le client `@rosegriffon/achillea-client` et `@rosegriffon/achillea-types` doivent valider les états `resolved/unresolved`, pagination, filtres et erreurs. La présence d'un match ou d'un score partiel ne prouve pas un champion.
- Brackets historiques : 3 et 7 sans tableau enregistré ; 9 avec un match non validé ; 18 avec sept matchs non clos. Prévoir une procédure de réconciliation staff qui présente les preuves par match et demande validation humaine des résultats manquants. Aucun script ne doit attribuer des vainqueurs à partir de scores ou de dates incomplets.
- Les API de lecture publiques ne doivent jamais exposer notes staff, tokens, demandes privées ou actions de mutation. Tester `200` anonyme sur listes/classements/fiches publiques, `401/403` sur historiques personnels et commandes protégées, puis la session admin réelle.
- Le rendu doit distinguer chargement, vide confirmé, erreur API, session expirée et données historiques incomplètes. Garder les messages utiles au lecteur d'écran (`role=status` ou `role=alert`) et éviter les faux zéros transitoires.

## Validation et livraison

Pour chaque composant changé : contrôle TypeScript du package touché, tests métier ciblés quand une règle de classement ou d'autorisation change, puis vérification Chrome en session anonyme et connectée. Parcourir clavier seul (ordre, Escape, focus après onglet/filtre), lecteur d'écran via arbre d'accessibilité, zoom 200 %, largeurs 320/390/768/1440 px, contraste et cibles tactiles. Vérifier les 5 URLs principales, tournoi 18 et 23, un utilisateur avec 0 puis plus de 100 matchs, solo et duo, erreurs réseau et données manquantes. Capturer avant/après à largeur identique, enregistrer les résultats dans le journal QA, et déployer par `aphrody-infra` avec contrôle du pointeur release, des cinq services, des réponses HTTP et du rendu navigateur.

Un lot n'est `FAIT` que si son code, son contrat API/DB, ses états visibles et ses parcours auth/anon sont vérifiés. Le redesign complet reste `INCOMPLET` tant que chaque surface P0–P2 et les scénarios ci-dessus ne sont pas passés ; la liste des 4 brackets non résolus ne peut être déclarée complète qu'après validation de leurs résultats source.
