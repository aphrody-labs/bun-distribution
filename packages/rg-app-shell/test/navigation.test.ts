import { describe, expect, test } from "bun:test";

import {
  cheminsCliquables,
  construireMobileNavUnifiee,
  construireNavigationItems,
  construireNavigationUnifiee,
  estItemActif,
  estRouteActive,
  filtrerNavigation,
  itemsDeNavigation,
  parcourirNav,
  type NavItem,
} from "../src/config/navigation";
import { esport, estSousAdministration, wiki } from "../src/config/routes";
import { DICTIONNAIRE_NAV_FR } from "../src/lib/translations";
import { DEFAULT_THEMES } from "../src/components/ThemeToggle";
import { THEMES } from "@rosegriffon/ui";

describe("composition des chemins", () => {
  test("l'accueil d'un domaine rend son préfixe, jamais la chaîne vide", () => {
    // Une chaîne vide n'est pas une URL valide pour `next/link`.
    expect(wiki("/")).toBe("/wiki");
    expect(esport("/")).toBe("/achillea");
  });

  test("préfixe les routes de leur domaine", () => {
    expect(wiki("/chara")).toBe("/wiki/chara");
    expect(wiki("/aura/totems")).toBe("/wiki/aura/totems");
    expect(esport("/clans")).toBe("/achillea/clans");
  });

  test("estSousAdministration compare par segment", () => {
    expect(estSousAdministration("/admin")).toBe(true);
    expect(estSousAdministration("/admin/users")).toBe(true);
    expect(estSousAdministration("/administration")).toBe(false);
  });
});

describe("estRouteActive", () => {
  test("compare par segment et non par préfixe de chaîne", () => {
    // `/modeles` commence par `/mode` sans être dedans.
    expect(estRouteActive("/modeles", "/mode")).toBe(false);
    expect(estRouteActive("/mode/menu", "/mode")).toBe(true);
  });

  test("allume un parent depuis une fiche enfant", () => {
    expect(estRouteActive("/chara/c05028001", "/chara")).toBe(true);
  });

  test("la racine n'est active que sur elle-même", () => {
    expect(estRouteActive("/", "/")).toBe(true);
    expect(estRouteActive("/chara", "/")).toBe(false);
  });
});

describe("estItemActif", () => {
  const item: NavItem = {
    children: [{ icon: "x", label: "enfant", path: "/aura/totems" }],
    groupOnly: true,
    icon: "x",
    label: "groupe",
    path: "/aura/faux-groupe",
  };

  test("un groupe sans route s'allume par ses enfants, jamais par son propre chemin", () => {
    expect(estItemActif("/aura/totems", item)).toBe(true);
    expect(estItemActif("/aura/faux-groupe", item)).toBe(false);
  });

  test("les activePaths allument l'item", () => {
    expect(
      estItemActif("/chroniques/2026", {
        activePaths: ["/chroniques"],
        icon: "x",
        label: "news",
        path: "/news",
      }),
    ).toBe(true);
  });
});

describe("navigation de la source unique Website", () => {
  test("aucune route de service n'est préfixée par le wiki et settings vit dans la topbar", () => {
    const chemins = cheminsCliquables(construireNavigationItems());
    expect(chemins).not.toContain("/wiki/news");
    expect(chemins).not.toContain("/wiki/settings");
    // `/settings` vit dans la topbar, pas dans la sidebar
    expect(chemins).not.toContain("/settings");

    // `/news` est servi à la racine et vit dans la catégorie « Wiki ».
    expect(cheminsCliquables(itemsDeNavigation())).toContain("/news");
  });

  test("aucune destination n'apparaît dans deux catégories de premier niveau", () => {
    // Deux accordéons qui mènent au même endroit, c'est un choix à faire là
    // où il n'y a rien à choisir — le défaut qui a fusionné « Vie de la
    // communauté » et « L'association ».
    const parCategorie = itemsDeNavigation().map(groupe => new Set(cheminsCliquables(groupe.children ?? [])));
    const doublons = [...parCategorie[0]!].filter(chemin => parCategorie.slice(1).some(autre => autre.has(chemin)));
    expect(doublons).toEqual([]);
  });
});

describe("cheminsCliquables", () => {
  test("exclut les entêtes de groupe, qui ne pointent nulle part", () => {
    const nav = itemsDeNavigation();
    const chemins = cheminsCliquables(nav);
    for (const groupe of parcourirNav(nav).filter(i => i.groupOnly)) {
      expect(chemins).not.toContain(groupe.path);
    }
  });

  test("ne rend aucun chemin vide ni relatif", () => {
    for (const items of [itemsDeNavigation(), construireMobileNavUnifiee()]) {
      for (const chemin of cheminsCliquables(items)) {
        expect(chemin.startsWith("/")).toBe(true);
      }
    }
  });
});

describe("visibilité des destinations Achilléa", () => {
  test("retire récursivement les espaces réservés sans cacher les lectures publiques", () => {
    const esport = construireNavigationUnifiee().find(groupe => groupe.domaine === "esport")?.item;
    expect(esport).toBeDefined();

    const publicNav = filtrerNavigation([esport!], item => !item.access);
    const paths = cheminsCliquables(publicNav);
    expect(paths).toContain("/achillea/ranked/leaderboard");
    expect(paths).toContain("/achillea/ranked/tiers");
    expect(paths).toContain("/achillea/tournaments");
    expect(paths).toContain("/achillea/tournaments/circuit/ranking");
    expect(paths).not.toContain("/achillea/ranked/history");
    expect(paths).not.toContain("/achillea/admins/dashboard");
    expect(paths).not.toContain("/achillea/clans/dashboard");
  });

  test("conserve les destinations d'un modérateur sans exposer celles d'un administrateur", () => {
    const esport = construireNavigationUnifiee().find(groupe => groupe.domaine === "esport")?.item;
    const moderatorNav = filtrerNavigation([esport!], item => {
      const access = item.access;
      return !access || (access.minimumAchilleaRole ?? 0) <= 1;
    });
    const paths = cheminsCliquables(moderatorNav);
    expect(paths).toContain("/achillea/admins/dashboard");
    expect(paths).not.toContain("/achillea/admins/sanctions");
    expect(paths).not.toContain("/achillea/organizations/validate");
  });
});

/**
 * Un libellé non traduit se voit : la barre latérale affiche `nav.esport.clans`
 * au lieu de « Clans ». Le dictionnaire français est le repli utilisé quand
 * aucun `LanguageProvider` n'est monté — il doit donc couvrir TOUTE entrée que
 * la navigation sait produire, sans exception.
 */
describe("dictionnaire de navigation", () => {
  test("chaque libellé du menu unifié a une traduction française", () => {
    const groupes = construireNavigationUnifiee();
    const libelles = groupes.flatMap(({ item }) => [
      item.label,
      ...parcourirNav(item.children ?? []).map(enfant => enfant.label),
    ]);

    const manquants = [...new Set(libelles)].filter(cle => !(cle in DICTIONNAIRE_NAV_FR));
    expect(manquants).toEqual([]);
  });
});

/**
 * Le sélecteur de thème recopiait sa liste : trois entrées contre cinq au
 * catalogue, et un identifiant `"dark"` qui ne désignait aucun thème. Azalée
 * clair et Achilléa n'étaient donc pas choisissables, alors qu'ils existent
 * dans `styles.css`. Ce test empêche la liste de redivergir.
 */
describe("sélecteur de thème", () => {
  test("propose les cinq thèmes officiels dans l'ordre du catalogue", () => {
    expect(DEFAULT_THEMES.map(t => t.id)).toEqual(["roy", "gaelle", "azalee-light", "azalee-dark", "achillea"]);
    expect(
      DEFAULT_THEMES.map(t => t.id)
        .sort()
        .join(","),
    ).toBe(Object.keys(THEMES).sort().join(","));
  });

  test("chaque option utilise le visuel officiel et un libellé distinct", () => {
    expect(new Set(DEFAULT_THEMES.map(t => t.label)).size).toBe(DEFAULT_THEMES.length);
    for (const theme of DEFAULT_THEMES) {
      expect(theme.image).toBe(THEMES[theme.id].icon);
      expect(theme.label.length).toBeGreaterThan(0);
    }
  });
});

describe("construireMobileNavUnifiee", () => {
  test("produit exactement 5 onglets pour website", () => {
    const items = construireMobileNavUnifiee();
    expect(items).toHaveLength(5);
    expect(items.map(i => i.icon)).toEqual(["home", "menu_book", "sports_esports", "search", "settings"]);
  });

  test("chaque onglet mène à un chemin valide", () => {
    const items = construireMobileNavUnifiee();
    for (const item of items) {
      expect(item.path.startsWith("/")).toBe(true);
      expect(item.activePaths?.length).toBeGreaterThan(0);
    }
  });
});
