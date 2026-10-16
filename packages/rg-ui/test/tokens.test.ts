import { describe, expect, test } from "bun:test";

import {
  analyserBlocs,
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
const css = await Bun.file(CHEMIN_CSS).text();

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
    const racines = blocs.filter((b) => b.selecteurs.includes(":root"));
    expect(racines.length).toBe(1);
    expect(racines[0]!.declarations.get("--rg-marine")).toBe(
      "oklch(0.2 0.05 264)",
    );
  });

  test("ne remonte pas les blocs @keyframes comme des jeux de tokens", () => {
    const blocs = analyserBlocs(css);
    expect(
      blocs.some((b) => b.selecteurs.some((s) => s === "from" || s === "to")),
    ).toBe(false);
  });

  test("descend dans @layer base pour trouver les thèmes", () => {
    const blocs = analyserBlocs(css);
    for (const nom of NOMS_THEMES) {
      expect(blocs.some((b) => b.selecteurs.includes(`.${nom}`))).toBe(true);
    }
  });
});

describe("résolution des var()", () => {
  const base = new Map([["--a", "#111111"]]);

  test("cascade local puis :root", () => {
    expect(resoudreVar("var(--a)", new Map(), base)).toBe("#111111");
    expect(resoudreVar("var(--a)", new Map([["--a", "#222222"]]), base)).toBe(
      "#222222",
    );
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
    expect(resoudreVar("var(--inconnu, #abcdef)", new Map(), new Map())).toBe(
      "#abcdef",
    );
  });
});

describe("tokens exposés", () => {
  test("les cinq thèmes officiels sont projetés depuis le CSS", () => {
    expect(NOMS_THEMES).toEqual([
      "theme-roy",
      "theme-gaelle",
      "theme-azalee-light",
      "theme-azalee-dark",
      "theme-achillea",
    ]);
    expect(Object.keys(THEMES)).toEqual([...NOMS_THEMES]);
    expect(THEMES["theme-azalee-light"].md3.primary).toBe("#f2a93b");
    expect(THEMES["theme-azalee-light"].md3.secondary).toBe("#a92335");
    expect(THEMES["theme-azalee-light"].md3.background).toBe("#fff8f5");
  });

  test("aucune couleur ne reste en oklch (Canvas 2D la rendrait noire)", () => {
    const valeurs = [
      ...Object.values(MARQUE),
      ...Object.values(MARQUES_TIERCES),
      ...NOMS_THEMES.flatMap((n) => [
        ...Object.values(THEMES[n].md3),
        ...Object.values(THEMES[n].shadcn),
      ]),
    ];
    expect(valeurs.filter((v) => v.includes("oklch"))).toEqual([]);
    expect(valeurs.filter((v) => v.includes("var("))).toEqual([]);
  });

  test("les thèmes unifiés exposent les mêmes rôles MD3", () => {
    const reference = Object.keys(THEMES["theme-roy"].md3).sort();
    expect(reference.length).toBe(36);
    for (const nom of NOMS_THEMES) {
      expect(Object.keys(THEMES[nom].md3).sort()).toEqual(reference);
    }
  });

  test("les thèmes unifiés déclarent le même jeu de variables dans le CSS", () => {
    // Pas seulement après cascade : un rôle qu'un seul thème omet n'est PAS
    // surchargeable dans ce thème et reste figé sur la valeur du `:root`.
    // C'est ce qui rendait `bg-scrim` inerte en Roy/Gaëlle et privait les
    // thèmes Azalée de `--chart-*`.
    const blocs = analyserBlocs(css);
    const varsDuTheme = (nom: string) =>
      [
        ...(blocs
          .find((b) => b.selecteurs.includes(`.${nom}`))
          ?.declarations.keys() ?? []),
      ].sort();

    const reference = varsDuTheme(NOMS_THEMES[0]!);
    expect(reference.length).toBe(68);
    for (const nom of NOMS_THEMES) {
      expect(varsDuTheme(nom)).toEqual(reference);
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
    expect(THEMES["theme-azalee-dark"].shadcn.card).toBe(
      THEMES["theme-azalee-dark"].md3.surfaceContainerLow,
    );
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
    expect(rendreModule(extraireTokens(css))).toBe(committe);
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
