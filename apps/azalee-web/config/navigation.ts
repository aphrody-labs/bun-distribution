/**
 * Navigation d'azalee — le wiki est monté à la RACINE de `azalee.rosegriffon.fr`.
 *
 * La structure du menu vit dans `@rosegriffon/app-shell` : elle est partagée mot
 * pour mot avec `apps/website`, qui monte le même wiki sous `/wiki`. Seules les
 * bases de montage diffèrent, et elles sont déclarées ici. Ne PAS réintroduire
 * de liste d'items en dur : les deux copies manuelles précédentes avaient dérivé
 * (entrées oubliées d'un côté, chemins non préfixés de l'autre = 404).
 */
import { AZALEE_BASES, construireNavigation } from "@rosegriffon/app-shell";

export { estItemActif, estRouteActive, type NavItem } from "@rosegriffon/app-shell";

const { dashboardItems, mobileNavItems, navigationItems } = construireNavigation(AZALEE_BASES);

export { dashboardItems, mobileNavItems, navigationItems };
