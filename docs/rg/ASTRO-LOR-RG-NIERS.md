# Convergence Astro Lor — Azalée et Niers

Mise à jour : 2026-09-05 UTC.

Ce registre fixe la frontière entre les deux dépôts après lecture des commits Niers
`51cd26a`, `dee4a0e`, `47beadf` et `6ff04c6`. Il évite de maintenir deux copies qui
finiraient par diverger.

## Une responsabilité par dépôt

| Sujet                                                | Source de vérité                                        | Portage dans l'autre dépôt                                    |
| ---------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Pages et composants web Azalée                       | `rg/apps/website`                                       | aucun copier-coller de l'ancienne app Niers                   |
| Types de la fiche et mapping wiki                    | `rg/packages/{inagle,azalee}`                           | contrat partagé par les données Niers                         |
| Migrations de la base utilisée par RG                | `rg/apps/website/supabase/migrations`                   | la migration homonyme de Niers reste son point d'entrée local |
| Crawl, peuplement OC, manifeste d'assets             | `niers/scripts/donnees`, `niers/astro`, `niers/docs`    | consommé par RG via le miroir, jamais dupliqué                |
| Formats `cfg.bin`, G4MD/G4MG/G4TX et modding NIE.exe | `niers/crates`, `niers/csharp`, `niers/scripts`         | aucune implémentation web parallèle                           |
| Références artistiques Astro                         | `rg/apps/website/public/oc/astro-lor` pour le web publié | sources et manifeste conservés dans `niers/astro`             |

La migration `20260905000000_chara_wiki_sections.sql` existe dans les deux arbres parce que
leurs commandes de migration ne partagent pas leur répertoire de travail. Les deux fichiers
sont idempotents et portent le même contrat : `wiki_sections` et `uniform_number`, nullables,
avec rechargement PostgREST. Ce n'est pas une seconde table ni une seconde source de données.

## Ce qui a été retenu côté Azalée

Les correctifs ciblés de `51cd26a` sont intégrés aux versions modernes de RG :

- les métadonnées de base (`uniformNumber`, `wikiSections`) suivent toutes les variantes ;
- le numéro de maillot n'est plus forcé à 10 ;
- `gender = 'X'` est conservé et n'impose pas l'icône fille/garçon du jeu ;
- les deux portraits, les neuf planches et les trois pages BD Astro suivies sont servies sous `/oc/astro-lor/` ;
- l'atelier conserve ses fonctions RG (imports, historique, compte, partage et validation).

Les ajouts auteur de `dee4a0e` sont réappliqués sans écraser cet atelier : fiche libre (surnom,
pronoms, âge, taille, univers, notes), couleur hexadécimale libre prioritaire sur la palette et
capture PNG de la vue courante. Les clés restent dans `EtatAvatar.champs`, bornées par le même
parseur JSON que les projets existants.

## État réel du personnage original

La fiche `/wiki/chara/astro-lor` est une donnée du wiki et peut être complète sans être un personnage
installable dans `nie.exe`. Le manifeste Niers (`astro/manifeste-assets.json`) mesure actuellement
12 assets propres, dont 2 sources d'icône prêtes et 10 à produire. Le plan `docs/ASTRO-LOR.md`
relève aussi deux verrous indépendants :

1. le réencodage `cfg.bin` n'est pas encore byte-exact sur les tables de personnages ;
2. l'écriture G4MD/G4MG n'est pas implémentée.

Les scripts `astro-lor-oc.py`, `astro-lor-auras.py` et le générateur de manifeste restent la voie
rejouable de peuplement. Aucun SQL d'injection du personnage n'est copié dans l'application web,
et aucune prétention de personnage jouable n'est faite avant les preuves V1/V2 décrites par Niers.

## Règle de convergence

Pour une prochaine évolution : modifier le composant ou le service dans RG, modifier le parseur ou
le manifeste dans Niers, puis vérifier le contrat au point de jonction (miroir, migration ou URL
CDN). Ne pas cherry-pick une app Azalée entière d'un dépôt dans l'autre : les deux historiques
contiennent des versions de l'atelier avec des surfaces différentes.
