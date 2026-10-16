import { describe, expect, test } from "bun:test";

import {
  analyserBlocs,
  cascaderTheme,
  chargerCssAvecImports,
  extraireTokens,
  NOMS_THEMES,
  oklchVersHex,
  rendreModule,
  resoudreVar,
  versCamel,
} from "../scripts/generer-tokens";
import { FORMES, MARQUE, MARQUES_TIERCES, THEMES } from "../src/tokens";

const CHEMIN_CSS = new URL("../src/styles.css", import.meta.url);
const CHEMIN_TOKENS = new URL("../src/tokens.ts", import.meta.url);
const css = await chargerCssAvecImports(CHEMIN_CSS);

describe("imports et cascade CSS d'auteur", () => {
  const origine = new URL("file:///tokens/styles.css");
  const lire = (sources: Record<string, string>) => async (url: URL) => {
    const css = sources[url.pathname];
    if (css === undefined) throw new Error(`Feuille absente : ${url}`);
    return css;
  };

  test("développe les imports imbriqués et répétés à leur ordre source", async () => {
    const css = await chargerCssAvecImports(
      origine,
      lire({
        "/tokens/styles.css": '@import "./brands.css"; :root { --a: #222222; } @import "./brands.css";',
        "/tokens/brands.css": '@import "./palette.css"; :root { --b: var(--a); }',
        "/tokens/palette.css": ":root { --a: #111111; }",
      }),
    );
    expect(cascaderTheme(analyserBlocs(css)).get("--a")).toBe("#111111");
    expect(analyserBlocs(css).filter(b => b.declarations.has("--a"))).toHaveLength(3);
  });

  test("ne suit ni commentaires ni import réseau, et signale les cycles et fichiers absents", async () => {
    expect(
      await chargerCssAvecImports(
        origine,
        lire({ "/tokens/styles.css": '/* @import "./absent.css"; */ :root { --a: red; }' }),
      ),
    ).not.toContain("@import");
    await expect(
      chargerCssAvecImports(origine, lire({ "/tokens/styles.css": '@import "https://example.invalid/a.css";' })),
    ).rejects.toThrow("non local");
    await expect(
      chargerCssAvecImports(origine, lire({ "/tokens/styles.css": '@import "./absent.css";' })),
    ).rejects.toThrow("absente");
    await expect(
      chargerCssAvecImports(origine, lire({ "/tokens/styles.css": '@import "./styles.css";' })),
    ).rejects.toThrow("cycle");
  });

  test("un import sans couche prime une couche ultérieure ; la spécificité précède l'ordre source", async () => {
    const css = await chargerCssAvecImports(
      origine,
      lire({
        "/tokens/styles.css":
          '@import "./brands.css"; @layer base { :root.theme-rg { --a: red; } } .theme-rg { --b: red; }',
        "/tokens/brands.css": ":root.theme-rg { --a: green; --b: green; }",
      }),
    );
    expect(Object.fromEntries(cascaderTheme(analyserBlocs(css), "theme-rg"))).toEqual({
      "--a": "green",
      "--b": "green",
    });
  });

  test("respecte les couches d'import, leur ordre déclaré et la priorité inverse de important", async () => {
    const css = await chargerCssAvecImports(
      origine,
      lire({
        "/tokens/styles.css":
          '@layer first, last; @import "./brands.css" layer(first); @layer last { .theme-rg { --a: red; --b: red !important; } } .theme-rg { --b: blue !important; }',
        "/tokens/brands.css": ".theme-rg { --a: green; --b: green !important; --b: red; }",
      }),
    );
    expect(Object.fromEntries(cascaderTheme(analyserBlocs(css), "theme-rg"))).toEqual({ "--a": "red", "--b": "green" });
  });
});

describe("conversion oklch → sRGB", () => {
  // Valeurs de référence : les trois primaires sRGB exprimées en oklch par
  // la spec CSS Color 4. Si la matrice Oklab est fausse, elles dérivent.
  test.each([
    ["oklch(1 0 0)", "#ffffff"],
    ["oklch(0 0 0)", "#000000"],
    ["oklch(0.62796 0.25768 29.234)", "#ff0000"],
    ["oklch(0.86644 0.29483 142.495)", "#00ff00"],
    ["oklch(0.45201 0.31321 264.052)", "#0000ff"],
  ])("%s → %s", (entree, attendu) => {
    expect(oklchVersHex(entree)).toBe(attendu);
  });

  test("borne les couleurs hors gamut au lieu de déborder", () => {
    // Chroma volontairement inatteignable en sRGB : chaque canal doit rester
    // dans [0,255] (sans bornage, `octet()` produirait « #NaN » ou « 1a4 »).
    expect(oklchVersHex("oklch(0.7 0.9 150)")).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("ignore ce qui n'est pas de l'oklch", () => {
    expect(oklchVersHex("#0c1730")).toBeNull();
    expect(oklchVersHex("rgba(255, 196, 110, 0.2)")).toBeNull();
  });
});

describe("analyse de styles.css", () => {
  test("isole le bloc :root sans confondre avec :root.theme-roy", () => {
    const blocs = analyserBlocs(css);
    const racines = blocs.filter(b => b.selecteurs.includes(":root"));
    expect(racines.length).toBe(1);
    expect(racines[0]!.declarations.get("--rg-marine")).toBe("oklch(0.2 0.05 264)");
  });

  test("ne remonte pas les blocs @keyframes comme des jeux de tokens", () => {
    const blocs = analyserBlocs(css);
    expect(blocs.some(b => b.selecteurs.some(s => s === "from" || s === "to"))).toBe(false);
  });

  test("descend dans @layer base pour trouver les thèmes", () => {
    const blocs = analyserBlocs(css);
    for (const nom of NOMS_THEMES) {
      expect(blocs.some(b => b.selecteurs.includes(`.${nom}`))).toBe(true);
    }
  });
});

describe("résolution des var()", () => {
  const base = new Map([["--a", "#111111"]]);

  test("cascade local puis :root", () => {
    expect(resoudreVar("var(--a)", new Map(), base)).toBe("#111111");
    expect(resoudreVar("var(--a)", new Map([["--a", "#222222"]]), base)).toBe("#222222");
  });

  test("suit une chaîne d'indirections", () => {
    const local = new Map([
      ["--b", "var(--c)"],
      ["--c", "var(--a)"],
    ]);
    expect(resoudreVar("var(--b)", local, base)).toBe("#111111");
  });

  test("coupe un cycle au lieu de boucler", () => {
    const local = new Map([
      ["--x", "var(--y)"],
      ["--y", "var(--x)"],
    ]);
    expect(resoudreVar("var(--x)", local, new Map())).toBe("var(--x)");
  });

  test("utilise la valeur de repli", () => {
    expect(resoudreVar("var(--inconnu, #abcdef)", new Map(), new Map())).toBe("#abcdef");
  });
});

describe("tokens exposés", () => {
  test("les sept thèmes officiels sont projetés depuis le CSS", () => {
    expect(NOMS_THEMES).toEqual([
      "theme-roy",
      "theme-gaelle",
      "theme-rg",
      "theme-rg-dark",
      "theme-azalee-light",
      "theme-azalee-dark",
      "theme-achillea",
    ]);
    expect(Object.keys(THEMES)).toEqual([...NOMS_THEMES]);
    expect(THEMES["theme-azalee-light"].md3.primary).toBe("#8b5023");
    expect(THEMES["theme-azalee-light"].md3.background).toBe("#fff8f5");
    expect(THEMES["theme-azalee-dark"].md3.primary).toBe("#ffb786");
    expect(THEMES["theme-achillea"].md3.primary).toBe("#d7bafb");
    expect(THEMES["theme-rg"].md3.primary).toBe("#8e4957");
    expect(THEMES["theme-rg-dark"].md3.primary).toBe("#ffb2be");
    expect(THEMES["theme-rg"].md3.onPrimary).toBe("#ffffff");
    expect(THEMES["theme-rg-dark"].md3.onPrimary).toBe("#561d2a");
  });

  test("aucune couleur ne reste en oklch (Canvas 2D la rendrait noire)", () => {
    const valeurs = [
      ...Object.values(MARQUE),
      ...Object.values(MARQUES_TIERCES),
      ...NOMS_THEMES.flatMap(n => [...Object.values(THEMES[n].md3), ...Object.values(THEMES[n].shadcn)]),
    ];
    expect(valeurs.filter(v => v.includes("oklch"))).toEqual([]);
    expect(valeurs.filter(v => v.includes("var("))).toEqual([]);
  });

  test("les sept thèmes conservent les 36 rôles MD3 core et les extensions natives importées", () => {
    const reference = Object.keys(THEMES["theme-roy"].md3).sort();
    expect(reference.length).toBe(36);
    for (const nom of NOMS_THEMES) {
      const roles = Object.keys(THEMES[nom].md3).sort();
      expect(roles).toEqual(expect.arrayContaining(reference));
      expect(roles.length).toBe(nom === "theme-roy" || nom === "theme-gaelle" ? 36 : 49);
    }
  });

  test("les sept thèmes déclarent les 68 variables core et conservent les extensions de la cascade complète", () => {
    // Pas seulement après cascade : un rôle qu'un seul thème omet n'est PAS
    // surchargeable dans ce thème et reste figé sur la valeur du `:root`.
    // C'est ce qui rendait `bg-scrim` inerte en Roy/Gaëlle et privait les
    // thèmes Azalée de `--chart-*`.
    const blocs = analyserBlocs(css);
    const varsDuTheme = (nom: string) =>
      [...new Set(blocs.filter(b => b.selecteurs.includes(`.${nom}`)).flatMap(b => [...b.declarations.keys()]))].sort();

    const reference = varsDuTheme(NOMS_THEMES[0]!);
    expect(reference.length).toBe(68);
    for (const nom of NOMS_THEMES) {
      const variables = varsDuTheme(nom);
      expect(variables).toEqual(expect.arrayContaining(reference));
      expect(variables.length).toBe(nom === "theme-roy" || nom === "theme-gaelle" ? 68 : 89);
    }
  });

  test("un thème posé hors de <html> peint son propre fond", () => {
    // Une classe de thème sur un conteneur ne posait QUE des variables :
    // seul `body { @apply bg-background text-foreground }` peint. La zone de
    // contenu du wiki (`.theme-azalee-dark`, posée par `client-layout.tsx`)
    // prenait donc son texte d'Azalée sombre (#ede0db) et son fond du thème
    // de <html> — mesuré en production sur `/wiki/tools` : #ede0db sur
    // #f9f4ee (Roy), soit 1,19:1, et 21 éléments sous 4,5:1 sur `/wiki`.
    //
    // Le sélecteur EXACT compte : `:where(…)` garde la spécificité à zéro
    // (les utilitaires `bg-*` gardent la main) et `:not(:root)` laisse `body`
    // seul maître du fond quand le thème est sur <html>.
    for (const nom of NOMS_THEMES) {
      const regle = new RegExp(
        `:where\\(\\.${nom}:not\\(:root\\)\\)\\s*\\{[^}]*` +
          `background-color:\\s*var\\(--background\\);[^}]*` +
          `color:\\s*var\\(--foreground\\);`,
      );
      expect(css, nom).toMatch(regle);
    }
  });

  test("aucun thème groupé par virgule dans un sélecteur :where", () => {
    // `analyserBlocs` découpe le prélude sur les virgules : un
    // `:where(.theme-roy, .theme-gaelle)` produirait les faux sélecteurs
    // `:where(.theme-roy` et `.theme-gaelle)`, et `extraireTokens` pourrait
    // retenir ce bloc vide comme jeu de tokens du thème.
    const blocs = analyserBlocs(css);
    for (const bloc of blocs) {
      for (const selecteur of bloc.selecteurs) {
        expect(selecteur.split("(").length).toBe(selecteur.split(")").length);
      }
    }
  });

  test("le pont shadcn est résolu, pas laissé en référence", () => {
    expect(THEMES["theme-azalee-dark"].shadcn.card).toBe(THEMES["theme-azalee-dark"].md3.surfaceContainerLow);
  });

  test("l'échelle de formes reprend les 7 corners M3", () => {
    expect(FORMES).toEqual({
      none: 0,
      extraSmall: 4,
      small: 8,
      medium: 12,
      large: 16,
      extraLarge: 28,
      full: 9999,
    });
  });

  test("les couleurs de marque sont les 4 teintes de la DA", () => {
    for (const cle of ["marine", "griffon", "brique", "rose"] as const) {
      expect(MARQUE[cle]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("non-dérive", () => {
  test("src/tokens.ts est bien la projection de styles.css", async () => {
    const committe = await Bun.file(CHEMIN_TOKENS).text();
    expect(await rendreModule(extraireTokens(css))).toBe(committe);
  });

  test("le module généré reste pur (aucun import)", async () => {
    const committe = await Bun.file(CHEMIN_TOKENS).text();
    expect(committe).not.toMatch(/^\s*import\s/m);
    expect(committe).not.toMatch(/require\(/);
  });
});

describe("versCamel", () => {
  test.each([
    ["on-primary-container", "onPrimaryContainer"],
    ["surface", "surface"],
    ["extra-large", "extraLarge"],
  ])("%s → %s", (entree, attendu) => {
    expect(versCamel(entree)).toBe(attendu);
  });
});
