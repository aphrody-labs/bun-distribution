# Migration RG vers Aphrody

## État et direction

Le dépôt RG reste la référence pendant la migration. La copie `apps/rg`, `packages/rg` et `scripts/rg` est une zone de travail inventoriée, pas encore une release autonome. L’orchestration d’infrastructure appartient à `aphrody-infra`; `@aphrody/workspace` fournit maintenant le point d’entrée RG et réutilise ce plan de contrôle. Les scripts métier restent près de leurs domaines jusqu’à leur portage ou leur remplacement explicite.

La cible est une intégration native dans le monorepo Aphrody, avec des propriétaires uniques pour UI, auth, données, Discord, Web/AI et infrastructure. Ne pas recopier un paquet quand une API Aphrody stable couvre déjà le besoin. Conserver les contrats publics et les données de Rose Griffon pendant les changements internes.

## Lots de migration

| Lot | Travail | Sortie attendue | Bloqueurs / preuves |
| --- | --- | --- | --- |
| 0. Provenance et périmètre | Rejouer l’inventaire de consolidation; rapprocher chaque fichier RG de son commit source, des copies existantes et des propriétaires Aphrody. Examiner séparément secrets, assets, données et fichiers ignorés. | Manifeste source/cible sans collision non résolue; règles `.gitignore`; aucune valeur secrète dans Git. | Hashes et modes concordants; écarts classés; licences conservées. |
| 1. Entrée opératoire | Piloter les scripts d’exploitation depuis `aphrody-ops rg`; laisser déploiements, services, VPS et releases à `aphrody-infra`; inventorier maintenance et tâches planifiées. | Commandes de statut, qualité, migration et déploiement documentées et testables. | `rg status`; commandes de contrôle exécutées par paquet; plan de déploiement sans effet avant `--apply`. |
| 2. Workspaces Bun | Faire de Bun le gestionnaire unique, rapprocher les workspaces RG des workspaces Aphrody et déplacer les versions vers les catalogues réellement possédés par Aphrody. | Un graphe de dépendances acyclique et lockfile reproductible. | `bun install --frozen-lockfile`; absence de `npm`, `pnpm`, `yarn`, `node` dans les chemins de build et release. |
| 3. Socle partagé | Remplacer les implémentations dupliquées par les propriétaires Aphrody: DB/API, auth, UI Shenron/Base UI, Discord unifié, Web/AI (`@aphrody/web` et ses modules), logs/config/cron lorsque les contrats correspondent. | RG consomme des APIs versionnées et documentées; aucune dépendance privée à un chemin de checkout. | Matrice capacité→propriétaire; tests de compatibilité et migration des données/session; aucun deuxième runtime Discord. |
| 4. TypeScript 7 | Migrer par workspace, d’abord packages purs puis API/bots puis website. Aligner compiler, `@types`, config, bundler et outils; corriger les changements de diagnostic et les hypothèses d’API. | `typescript` 7 depuis le catalogue; configurations strictes cohérentes. | `tsc --noEmit`/vérifications déclarées par paquet, tests, lint et build verts sur Bun; compatibilité CI confirmée. |
| 5. Bun natif | Établir une liste d’opportunités réelle: `Bun.serve`, `Bun.SQL` ou driver PostgreSQL retenu, `Bun.file`, `Bun.spawn`, tests et bundling natifs. Remplacer Node APIs seulement là où Bun apporte un bénéfice mesuré et sans casser Next/SDK. | Adaptateurs isolés, ports Node supprimés des chemins compatibles, APIs web standard privilégiées. | Tests d’intégration, limites de compatibilité Next et bibliothèques explicites; mesure avant/après; aucun remplacement mécanique. |
| 6. React vers Base UI | Auditer les composants RG et leurs usages Radix/shadcn. Réutiliser les composants accessibles de Shenron/Base UI ou extraire un propriétaire Aphrody commun; migrer par primitive et écran. Garder Next/React et la logique métier stables pendant les vagues. | Couche UI RG sur les primitives Base UI partagées, styles/tokens Aphrody et API stable. | Matrice primitive→écran; clavier, focus, lecteur d’écran, formulaires, mobile et captures comparatives; suppression des anciennes dépendances seulement après migration complète. |
| 7. Données et services | Valider migrations PostgreSQL, schémas Achilléa, sessions Better Auth, tâches, médias et intégrations externes; rapprocher les services des contrats Infra actuels. | Déploiement progressif et retour arrière documenté par service. | Sauvegarde/restauration testées; migration idempotente; validation sur staging; métriques et procédures opérationnelles. |
| 8. Bascule et retrait | Basculer site/API/bots un à un, observer, puis retirer les anciennes copies et scripts seulement après la période de stabilité. | Un chemin de release et un seul propriétaire par capacité. | Smoke tests production, alertes, rollback testé, inventaire de provenance clos et documentation à jour. |

## Ordre conseillé

1. Fermer le manifeste de provenance et les collisions de fichiers; aucune suppression de source avant cette preuve.
2. Terminer l’entrée opératoire et le graphe des packages. Séparer scripts applicatifs, scripts d’infrastructure déjà repris par Infra, et scripts obsolètes.
3. Stabiliser contrats de données, auth et API, puis basculer les packages purs et les services non interactifs.
4. Migrer UI primitive par primitive avec Shenron comme référence Base UI; démarrer par composants isolés et écrans à faible risque, puis navigation/formulaires, enfin surfaces critiques.
5. Passer à TypeScript 7 package par package et activer le mode strict progressivement avant de durcir les gates globales.
6. Appliquer Bun natif au cas par cas après benchmark et validation des contraintes Next, PostgreSQL et plateformes de déploiement.
7. Faire les bascules en production par service avec canari, observabilité, rollback et période de stabilité avant retrait du dépôt source.

## Règles de dépendances et de versions

- Une capacité a un propriétaire. Vérifier le catalogue généré par Aphrody Infra et les exports de packages avant toute nouvelle dépendance.
- Utiliser la version stable la plus récente compatible et une mise à jour contrôlée dans le catalogue; pour les canaries, exiger un bénéfice identifié et un gate dédié.
- Éviter les imports par chemin relatif entre dépôts ou workspaces; employer des exports publics versionnés.
- Base UI provient de l’intégration Shenron existante. Réutiliser ses wrappers/tokens lorsqu’ils sont génériques; déplacer les composants RG spécifiques dans un package RG au lieu de faire dépendre Shenron de RG.
- Les packages Discord consomment le runtime Discord fusionné Aphrody; retirer discordx/Bun/discord.js redondants seulement après parité fonctionnelle et tests d’événements/commandes.
- Web/AI passe par les clients Aphrody Web existants lorsque leurs responsabilités couvrent le cas RG; secrets et sessions restent gérés par les propriétaires autorisés.

## Commandes opératoires

Depuis la racine Aphrody:

```sh
bun packages/infra/workspace/src/ops.ts rg status
bun packages/infra/workspace/src/ops.ts rg check lint
bun packages/infra/workspace/src/ops.ts rg check test --package @rosegriffon/website
bun packages/infra/workspace/src/ops.ts rg migrate inventory
bun packages/infra/workspace/src/ops.ts rg migrate scripts
bun packages/infra/workspace/src/ops.ts rg deploy --target <cible-infra>
```

Le déploiement appelle l’adaptateur `aphrody-infra` pour `rg`; il reste en plan tant que `--apply` n’est pas fourni. Les contrôles lancent uniquement les scripts déclarés dans les manifestes RG copiés. Le sous-ensemble migré doit conserver ses fichiers `.env` hors index Git.

## Critères de clôture

- Inventaire complet des fichiers et références, avec propriétaire cible et preuve de copie ou décision de retrait.
- Aucun secret, dump de base ou artefact de build dans les chemins suivis.
- Toutes les applications et tous les packages actifs passent installation gelée, format, lint, types, tests et build adaptés.
- Migrations PostgreSQL, auth, médias et releases testées avec restauration vérifiée.
- UI clavier/accessibilité et parcours critiques validés visuellement et fonctionnellement.
- Commande Infra de release utilisée; aucun script local ne contourne l’adaptateur de déploiement.
- Période d’observation terminée avant suppression des anciens chemins ou de l’ancien dépôt.
