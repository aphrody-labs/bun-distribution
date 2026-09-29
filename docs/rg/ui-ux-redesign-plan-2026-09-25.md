# Plan de refonte UI/UX — Rose Griffon, Azalée, Achilléa

État observé le 25 septembre 2026 dans Chrome connecté, complété par les journaux de QA et les matrices du dépôt. Ce document est un plan de travail, pas une attestation de validation exhaustive. Chaque correction doit être éprouvée dans une session authentifiée et, pour les pages publiques, dans une session anonyme distincte.

## Constat vérifié

| Surface | Observation | Conséquence |
| --- | --- | --- |
| `/` | Accueil Rose Griffon, deux sections principales et 21 liens relevés dans le DOM | Conserver une entrée Association identifiable, rendre ses parcours prioritaires explicites |
| `/wiki` | Accueil Azalée : titres « Command Palette » et « Dernières actualités » répétés ; 41 liens | Nettoyer la hiérarchie des titres et distinguer recherche, actualités et exploration encyclopédique |
| `/achillea` | Entrée e-sport, échelle des 11 paliers et écosystème compétitif ; 41 liens | Garder l'identité Achilléa, clarifier l'accès à jouer, classement, tournois et clans |
| `/achillea/ranked/tiers` | 11 paliers et 12 compétiteurs solo ; certains libellés disent « 0 joueurs » et « 1 joueurs » ; sélecteurs Solo/Duo | Corriger pluriels et réduire la densité tout en préservant les valeurs réelles |
| `/achillea/tournaments` | 9 tournois, navigation et filtres déjà contrôlés dans la QA | Préserver les états « classement non résolu » et les filtres, rendre les cartes et onglets lisibles au clavier et sur mobile |
| `/admin` | En session connectée, erreur « Une erreur inattendue est survenue », React #441, digest 2926058691 | Le tableau de bord est bloquant ; diagnostiquer et corriger avant une refonte cosmétique |
| En-tête partagé | Mélange de libellés français et anglais pour la langue ; menu latéral, menu supérieur et retour coexistent | Unifier les libellés et donner à chaque commande un rôle clair |

Les précédentes vérifications ont confirmé des états historiques incomplets : quatre tournois sans classement résolu, scores et brackets partiels, absence de preuve pour des versements AP. Le design doit afficher ces incertitudes et ne jamais transformer un résultat absent en récompense ou vainqueur apparent. Le site utilise encore par défaut l'API classée legacy pour une partie du client Achilléa ; les contrats legacy et RG diffèrent notamment sur la pagination. La refonte des filtres doit attendre la vérification de la source effective de chaque vue.

## Direction de design

Une coque commune assure logo Rose Griffon, recherche, compte, langue, thème, retour, fil d'Ariane et navigation clavier. Les trois univers retrouvent chacun leur identité d'origine à partir de leurs archives et composants réels : Association éditoriale, Azalée encyclopédique, Achilléa compétitif. Inventorier les anciens dépôts et captures avant de figer couleurs, typographies et motifs ; ne pas inventer une identité historique.

Contrat commun : texte courant d'au moins 18 px, contraste élevé, focus fixe nettement visible, cibles tactiles d'au moins 44 px, zoom 200 % sans perte de fonction, navigation clavier, titres hiérarchiques et annonces de chargement/erreur lisibles par lecteur d'écran. Les préférences doivent rester stables lors du passage entre univers.

## Lots ordonnés

### P0 — Restaurer les parcours bloqués et la vérité des données

1. Reproduire l'erreur `/admin` avec release, rôle et trace navigateur ; isoler le composant fautif et corriger. Vérifier l'accueil admin puis chaque accès du menu avec rôles autorisés et refusés.
2. Établir la carte page → client → API effective → contrat de réponse → permissions. Corriger les incohérences avant de redessiner les états. En particulier, distinguer points de circuit, AP du portefeuille et ELO ; préserver les brackets non résolus.
3. Standardiser quatre états visibles pour chaque zone de données : chargement, vide réel, erreur avec reprise, données partielles/inconnues. Aucun compteur transitoire ne doit paraître être un zéro confirmé.

### P1 — Navigation et architecture de l'information

1. Dessiner trois cartes de parcours : Association (lire, participer, soutenir), Azalée (chercher, explorer, comparer), Achilléa (jouer, suivre son rang, tournoi, clan). Garder les pages réellement utilisées ; fusionner les doublons après inventaire des routes, liens entrants, permissions et données.
2. Simplifier le menu latéral et l'en-tête : intitulés cohérents, destination active, fil d'Ariane, recherche unique contextualisée, retour prévisible. Éliminer les intitulés « Command Palette » visibles comme titres de contenu et les doubles titres du Wiki.
3. Relier tous les détails aux listes et aux filtres avec retour préservant l'état (recherche, onglet, page). Fournir plan de site public et plan de navigation admin fondés sur les routes réelles.

### P2 — Composants et pages métier

| Zone | Travail prévu | Preuve attendue |
| --- | --- | --- |
| Design system | Tokens par univers, typographie, contraste, boutons, champs, tableaux/cartes, dialogues, toast, états de requête | Catalogue de composants aux largeurs 320/390/768/1440 px et zoom 200 % |
| Association | Accueil éditorial, actualités, événements, adhésion/boutique : hiérarchie et appels à l'action | Parcours complet jusqu'à chaque action réelle, y compris erreurs et session anonyme |
| Azalée | Recherche, résultats, fiches, comparateurs, filtres, médias 3D : densité maîtrisée et navigation par clavier | Recherche et ouverture de chaque type de fiche, états vides et données absentes |
| Achilléa classé | Hub, paliers, leaderboard, historique, profil, solo/duo : filtres et chiffres cohérents | Comparaison UI/API pour chaque mode ; pluriels, 0 %, liens et états vides corrects |
| Achilléa tournois | Liste, détail, sept onglets, bracket mobile, circuit, podiums et prix | Données réelles et incertitudes explicites ; aucune action de paiement déclenchée pour test |
| Clans, casts, organisations | Cartes, organigrammes, disponibilité, formulaires et permissions | Parcours par rôle avec mutations réversibles de test |
| Administration | Dashboard, utilisateurs, wiki, événements, Achilléa, Discord, stats, config, audit | Chaque menu et commande testé ; champs configurables issus des vrais contrats et erreurs utiles |

### P3 — Finition et cohérence

Uniformiser microcopies françaises, singulier/pluriel, formats des nombres/dates, aides de champs, confirmations, annulation et feedback. Remplacer les libellés techniques exposés au public par des termes métier tout en gardant des détails diagnostiques accessibles au staff. Vérifier les performances perçues : mise en page stable, squelettes fidèles et médias adaptés aux connexions lentes.

## Méthode de livraison et critères de sortie

Pour chaque lot : relever l'état Chrome avant, enregistrer la route, le rôle, la largeur, l'action et la réponse API ; implémenter ; exécuter typecheck et tests ciblés Bun ; déployer par `aphrody-infra` ; refaire le parcours sur la release active ; documenter le résultat dans `docs/achillea-live-qa-2026-09-25.md` ou le journal correspondant. Couvrir clic, clavier, focus, 200 %, 320/390/768/1440 px, chargement, erreur, vide, et retour. Utiliser des données de test pour les écritures ; conserver les opérations de versement et de modération hors des tests destructifs.

Une page est terminée lorsque tous ses contrôles visibles ont un résultat observé, ses permissions ont été vérifiées, ses chiffres concordent avec l'API effective et la base lorsque pertinente, et aucun écart d'accessibilité bloquant ne subsiste. Une couverture partielle reste « INCOMPLET » dans la matrice QA ; ne pas convertir un simple chargement HTTP 200 en validation fonctionnelle.
