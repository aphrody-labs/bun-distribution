# Inventaire du dashboard d'administration

État du code au 25 septembre 2026. Cet inventaire porte sur les routes `apps/website/src/app/admin/**/page.tsx` et leur navigation locale. Il ne prouve pas une validation en session authentifiée ni un usage métier de chaque action.

## Surfaces conservées

| Domaine | Routes | Preuve de raccordement |
| --- | --- | --- |
| Accueil RG | `/admin`, `/admin/stats`, `/admin/users`, `/admin/staff`, `/admin/audit` | Liens dans `AdminSidebar.tsx`; accueil connecté à `profiles`, `user`, `session`, `events` et `articles` |
| Contenus RG | `/admin/chroniques`, `/admin/chroniques/new`, `/admin/chroniques/[id]/edit`, `/admin/news`, `/admin/news/new`, `/admin/news/[id]`, `/admin/news/[id]/versions`, `/admin/news/stats`, `/admin/tweets`, `/admin/tweets/[id]` | Navigation Articles/Chroniques et Tweets; sous-routes d'édition liées depuis les listes ou composants |
| Données Azalée | `/admin/database`, `/admin/database/[table]`, `/admin/database/[table]/[id]`, `/admin/database/verification`, `/admin/database/images`, `/admin/zukan-review`, `/admin/import-sheet`, `/admin/import-google-doc` | Groupe Données Wiki; tables, revue et import ont des usages distincts |
| Événements RG | `/admin/events`, `/admin/events/new`, `/admin/events/[id]/edit`, `/admin/stream-schedule`, `/admin/iergday` | Liens dans le groupe Événements et la campagne hashtag |
| Achilléa | `/admin/achillea` et les pages métier `/achillea/admins/dashboard`, `/achillea/admins/ranked-disputes`, `/achillea/admins/sanctions`, `/achillea/organizations/validate` | Page de rapprochement PostgreSQL et liens vers le backoffice métier; rôles différents |
| Bots et infrastructure | `/admin/bot`, `/admin/bot/membres`, `/admin/bot/reglages`, `/admin/bot/commandes`, `/admin/cron`, `/admin/base`, `/admin/settings` | Groupe Bot, infrastructure en lecture seule, paramètres de site |
| Autres | `/admin/media`, `/admin/patreon` | Médias liés aux contenus; Patreon réservé au créateur dans la navigation |

Les routes paramétrées ont parfois zéro occurrence dans une recherche littérale de leur nom (`[id]`/`[table]`) parce que les liens sont générés avec un identifiant. Ce signal ne justifie aucune suppression. Aucun doublon fonctionnel certain n'a été établi: `/admin/achillea` rapproche les données RG/Achilléa, tandis que `/achillea/admins/dashboard` pilote l'esport.

## Convergence effectuée

- Le menu Achilléa ne présente plus un « FDW » retiré: il pointe vers le rapprochement dans le schéma PostgreSQL `achillea` de `rg`.
- La page de rapprochement évite une proportion non définie lorsque la table des profils RG est vide.
- Ses libellés et actions ont une taille de lecture minimale de 18 px, conformément au besoin de basse vision.
- `/admin/settings` n'expose que les sept clés publiques dont un consommateur est vérifié: trois sur l'accueil RG et quatre dans l'API publique Achilléa. Les anciens champs RG TV, Azalée et Communauté ont été retirés de l'éditeur, car ils ne modifiaient aucune vue publique. Les valeurs déjà enregistrées restent en base.

## Design et limites vérifiés dans le dépôt

`apps/rg/website/src/app/layout.tsx` conserve les thèmes `roy`, `gaelle`, `azalee-light`, `azalee-dark` et `achillea`; `apps/rg/website/src/app/globals.css` conserve les styles de domaines et `docs/products/rg/azalee.md` désigne `/wiki` comme surface canonique. L'ancien frontend Achilléa n'est plus présent comme application web autonome dans `apps`; `apps/rg/website/src/app/achillea/legacy-parity.test.ts` liste les routes historiquement migrées. Une restauration pixel par pixel des anciens sites demande leurs captures ou sources historiques et une comparaison authentifiée. Aucune page ambiguë n'a été purgée.

### Sources historiques retrouvées dans Git

- **Achilléa, commit `08ec2ca^`**, avant la migration du frontend Angular : `apps/achillea-web/src/app/views/admin-dashboard/admin-dashboard.html` (not in repo) affiche une barre dédiée « Admin Achillea », des groupes de navigation et les panneaux overview, litiges, saisons, sanctions, utilisateurs, portefeuilles et santé bot. `admin-dashboard.css` utilise le violet `#9039ff` en repli, fond sombre et cartes KPI. `apps/achillea-web/public/achillea_ico.png` (not in repo) et les polices de `src/styles.css` sont les actifs d'origine. La page actuelle `/achillea/admins/dashboard` garde ces familles fonctionnelles dans `admin-dashboard-client.tsx`, mais utilise les composants M3 partagés et la navigation du site unifié. Son rendu exact n'a pas été comparé à une capture historique.
- **Azalée, commit `d74cee3^`**, avant retrait de l'application autonome : `apps/azalee/components/dashboard/DashboardSidebar.tsx` (not in repo) utilisait déjà `@rosegriffon/ui` avec sous-titre « Azalée » et `/logo.webp`; `apps/azalee/app/dashboard/layout.tsx` (not in repo) gardait le contrôle des rôles. `apps/azalee/app/globals.css` (not in repo) indique la palette M3 seed `#F89C5A` et les polices Super Cartoon/BradBunR. Le code actuel conserve le thème Azalée dans `packages/rg/ui/src/styles.css`, ainsi que les routes de données wiki sous `/admin/database`, mais son menu commun perdait ce sous-titre.
- **RG** : `apps/rg/website/src/app/admin` existait avant les migrations et fournit la barre partagée. Les commits `0ccea86` et `61a18e0` retracent la fusion de l'accueil; aucun second frontend RG autonome n'est apparu dans les branches locales (`main`, `origin/main`) ni les dépôts frères de `%USERPROFILE%/src`.

Correction visuelle certaine : le menu admin affiche à nouveau le nom et le logo Azalée dans les écrans wiki, et le nom/logo Achilléa dans `/admin/achillea`, en conservant les routes et droits unifiés. Cette correction porte sur l'identité de navigation, pas sur une restauration intégrale de l'ancien shell Angular.

## Vérifications encore nécessaires

Parcours authentifié de chaque rôle, action de modification avec données de test, comparaison visuelle aux références historiques, audit de chaque API et de chaque table de données. Les éléments ci-dessus sont un inventaire de code et de navigation, pas un résultat de test de production.
