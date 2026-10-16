// Navigation & Route Configurations
export {
  cheminsCliquables,
  construireActualiteItems,
  construireAssociationItems,
  construireEsportItems,
  construireMobileNavUnifiee,
  construireNavigationItems,
  construireNavigationUnifiee,
  filtrerNavigation,
  DOMAINES,
  domaineDeLaRoute,
  estItemActif,
  estRouteActive,
  GROUPES_NAV,
  itemsDeNavigation,
  parcourirNav,
  type Domaine,
  type GroupeNav,
  type NavItem,
  type SousCategorieNav,
} from "./config/navigation";
export {
  BASE_ADMIN,
  BASE_ESPORT,
  BASE_WIKI,
  CHEMINS_ASSOCIATION,
  CHEMINS_ESPORT,
  CHEMINS_RACINE,
  CHEMINS_WIKI,
  esport,
  estSousAdministration,
  wiki,
  type CheminAssociation,
  type CheminEsport,
  type CheminRacine,
  type CheminWiki,
} from "./config/routes";

export { BUDGET_CHROME_MOBILE, coutChromeMobile, decalageHaut, HAUTEURS, PLANS, rem } from "./config/metriques";

// Icons & Translations
export { iconMap, type IconName, type LucideIcon } from "./lib/icons";
export { DICTIONNAIRE_NAV_FR, traduireNav } from "./lib/translations";

// Shared Chrome Components
export { Footer, AzaleeFooter, type FooterProps } from "./components/Footer";
export { NavigationRail, AzaleeNavigationRail, type NavigationRailProps } from "./components/NavigationRail";
export {
  MobileBottomNav,
  MaterialBottomNav,
  MobileBottomNavigation,
  type MobileBottomNavProps,
} from "./components/MobileBottomNav";
export { AppSidebar, WikiSidebar, SidebarUniverseHeader, type AppSidebarProps } from "./components/AppSidebar";
export {
  TopAppBar,
  DesktopTopBar,
  MobileHeader,
  Header,
  resolvePageTitle,
  type TopAppBarProps,
  type UserProfile,
} from "./components/TopAppBar";
export { ThemeToggle, DEFAULT_THEMES, type ThemeOption } from "./components/ThemeToggle";
export { UnifiedSearchBar, type UnifiedSearchBarProps } from "./components/UnifiedSearchBar";
export { UniverseSwitch, type UniverseSwitchProps } from "./components/UniverseSwitch";
