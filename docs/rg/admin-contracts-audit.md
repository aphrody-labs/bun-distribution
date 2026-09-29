# Contrats du tableau de bord admin (audit du 25 septembre 2026)

## Constat vérifié dans le code

Les matrices [API admin](admin-api-matrix.csv) et [tables RG](admin-db-matrix.csv) sont régénérées par `bun docs/generate-admin-contract-matrix.ts`. Elles indexent les fichiers source, les méthodes et gardes visibles, les pages qui mentionnent une route ou une table, ainsi que les contrats importés. `unmapped` signifie seulement qu'aucune référence directe n'a été trouvée dans une page `/admin`; ce n'est pas une preuve d'inutilité. Les correspondances sont statiques et doivent être relues avant toute suppression. L'inventaire des tables couvre les 144 tables `public` du type généré et les tables typées `AchilleaTables`; il n'atteste pas de l'état de la base de production. Aucun contenu de table ni secret n'est lu.

| Domaine | Source de vérité | Couverture du dashboard constatée | Écart |
| --- | --- | --- | --- |
| Auth | `@rosegriffon/auth`, `resolveProfile`, Better Auth | `app/admin/layout.tsx` protège les pages; `lib/api-auth.ts` protège les routes API admin | L'action `settings/actions.ts` utilisait une lecture directe du rôle et acceptait n'importe quelle clé; elle utilise désormais la résolution commune et une liste de clés publiques. |
| Paramètres RG | table PostgreSQL `public.settings` (`packages/db/src/types.gen.ts`) | `/admin/settings` affiche un éditeur visuel; `app/page.tsx` consomme trois clés d'introduction | Plusieurs champs visuels RG TV, Azalée et communauté sont enregistrés mais aucun consommateur serveur de ces clés n'a été trouvé. Les présenter comme opérationnels est prématuré. |
| Paramètres Achilléa | `GET /api/public/achillea/info` lit quatre clés `home_achillea_*` | L'onglet Achilléa propose les quatre champs réellement consommés | Les autres réglages métier exigent des contrats spécifiques avant exposition. |
| Bot RG | `@rosegriffon/types/bot`, `lib/bot/reglages`, `/api/admin/bot/reglages` | API GET/PATCH/DELETE avec schéma strict et garde admin | Configuré par guilde, distinct de la table `settings` du site. |
| API, DB et packages | `apps/api`, `packages/db`, `packages/types` et autres packages | Menus admin spécialisés, sans contrat unifié de découverte | Aucune preuve que chaque endpoint, table, type ou paramètre d'infrastructure soit configurable depuis le dashboard. Un accès générique serait dangereux pour l'auth, les secrets et l'intégrité des données. |

Les matrices montrent aussi deux routes historiques (`/api/admin/news/draft` et `/api/admin/discord/role/[roleId]/members`) qui utilisent `CLAUDE_API_KEY` au lieu de la garde Better Auth; elles exigent une migration coordonnée avec leurs clients avant retrait du mécanisme. Les routes Patreon utilisent une garde créateur spécifique. Les imports statiques et la présence d'une garde ne prouvent pas à eux seuls l'autorisation de chaque méthode : tester les sessions et les refus.

La vue `/achillea/admins/dashboard` affiche « API Opérationnel » lorsque `/admin/ops/overview` répond, mais « Gateway Discord », uptime et serveurs restent « Non mesuré »/« — ». C'est cohérent avec le code actuel : `apps/api/src/modules/achillea/admin.ts` renvoie les compteurs DB et `generatedAt` sans objet `bot`; `packages/achillea-client/src/v1/admin.ts` le déclare facultatif. Le même client déclare `/admin/ops/health` et `/admin/ops/guilds`, mais aucun handler correspondant n'a été trouvé dans `apps/api/src`. Le miroir SQLite Discord ne prouve pas l'état présent du Gateway ni son uptime. La correction exige une télémétrie bot horodatée, exposée par API staff avec source et fraîcheur vérifiables. Tant que ce contrat manque, l'affichage « Non mesuré » est exact; ne pas le transformer en vert à partir du seul statut API ou d'un vieux snapshot.

## Tranche livrée

`lib/admin-settings-contract.ts` définit sept paramètres publics avec libellé, type et consommateur prouvé. `GET /api/admin/config/public` retourne uniquement ces clés et leur valeur courante après contrôle Better Auth + rôle admin. L'action d'écriture refuse les clés non répertoriées et les URL non HTTPS; son journal ne contient plus la valeur ni la description libre envoyée par le client. La description persistée provient du contrat serveur. Aucun secret ni OAuth token n'entre dans ce contrat.

## À poursuivre

La page `/admin/achillea` comptait `achillea.tournament_event` (0 ligne) pour
« Tournois disputés » alors que la liste publique est issue d'`achillea.event`.
Le compteur lit maintenant les événements historiques `internal_state = 'Finished'`
(9 lignes observées en production), sans mélanger les deux tables.

Raccorder les champs visuels à de vrais consommateurs ou retirer leur promesse de sauvegarde, puis bâtir les formulaires métier par domaine sur les schémas existants. Tester chaque écriture avec une session admin et une session non admin, sur une base de test, avant toute déclaration de couverture complète.
