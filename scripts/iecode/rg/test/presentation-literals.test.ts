/**
 * Garde-fou incrémental contre les littéraux de présentation dans le website.
 *
 * Ce test est volontairement un « ratchet » et non une règle absolue : le
 * dépôt contient encore une dette importante, figée dans
 * `presentation-literals-baseline.json`. Une réduction passe immédiatement ;
 * seule une AUGMENTATION d'une catégorie fait échouer la CI.
 *
 * Périmètre : tous les fichiers TSX et CSS sous `apps/website/src`. Le code TypeScript est analysé
 * avec le parseur déjà fourni par la dépendance de développement `typescript`,
 * ce qui évite les faux positifs dans les commentaires et n'ajoute aucune
 * dépendance.
 *
 * Exceptions explicites :
 * - `app/globals.css` est le point d'entrée canonique des fontes et variables
 *   CSS propres à l'app. Les tokens partagés restent dans
 *   `packages/rg-ui/src/styles.css` et `packages/rg-ui/src/tokens.ts`, hors périmètre ;
 * - les images Open Graph/Twitter sont des rendus bitmap autonomes : elles ne
 *   peuvent pas hériter des variables CSS du document qui les référence ;
 * - les gabarits e-mail et le rendu Canvas vivent dans des fichiers `.ts`, hors
 *   de ce scan UI. Leurs palettes doivent rester centralisées dans leurs
 *   adaptateurs respectifs ;
 * - les couleurs intrinsèques de marques tierces sont canoniques uniquement
 *   dans `MARQUES_TIERCES` (`packages/rg-ui/src/tokens.ts`). Les pages ne sont pas
 *   exemptées et doivent consommer un token sémantique.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
const ts = await import(
  Bun.resolveSync(
    "@typescript/typescript6",
    process.env.RG_TYPESCRIPT_ROOT ?? resolve(import.meta.dir, "../../../../apps/rg-website"),
  )
);

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const WEBSITE_SRC = join(REPO_ROOT, "apps/rg-website/src");
const BASELINE_PATH = join(import.meta.dir, "presentation-literals-baseline.json");

const CATEGORIES = [
  "rawColorLiteral",
  "paletteColorUtility",
  "arbitraryColorUtility",
  "arbitraryTextPx",
  "inlineFontFamily",
  "jsxUiText",
] as const;

type Category = (typeof CATEGORIES)[number];
type Counts = Record<Category, number>;

interface Baseline {
  schemaVersion: 1;
  scope: string;
  counts: Counts;
}

interface AllowRule {
  categories: readonly Category[];
  matches: (repoRelativePath: string) => boolean;
  reason: string;
}

const ALL_CATEGORIES: readonly Category[] = CATEGORIES;

/**
 * Allowlist courte et fondée sur un RÔLE, jamais sur une dette particulière.
 * Une page ou un composant métier ne doit pas être ajouté ici pour faire passer
 * le test : sa dette appartient à la baseline, qui ne peut qu'être réduite.
 */
const ALLOWLIST: readonly AllowRule[] = [
  {
    categories: [
      "rawColorLiteral",
      "paletteColorUtility",
      "arbitraryColorUtility",
      "arbitraryTextPx",
      "inlineFontFamily",
    ],
    matches: path => path === "apps/rg-website/src/app/globals.css" || path === "apps/website/src/app/globals.css",
    reason: "point d'entrée canonique des variables CSS et déclarations de fontes de l'app",
  },
  {
    categories: ALL_CATEGORIES,
    matches: path =>
      /(?:^|\/)(?:opengraph-image|twitter-image)\.tsx$/u.test(path) ||
      path.startsWith("apps/rg-website/src/app/api/og/") ||
      path.startsWith("apps/website/src/app/api/og/"),
    reason: "rendus bitmap sociaux autonomes, sans cascade CSS du document",
  },
];

const RAW_COLOR =
  /(?:#[\da-f]{3,4}(?![\da-f])|#[\da-f]{6}(?![\da-f])|#[\da-f]{8}(?![\da-f])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\()/giu;

const PALETTE_UTILITY =
  /(?:^|\s)(?:[\w-]+:)*(?:bg|text|border|from|via|to|fill|stroke|ring|outline|divide|caret|accent|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?(?:\/(?:\d{1,3}|\[[^\]]+\]))?(?=$|\s)/giu;

const ARBITRARY_COLOR_UTILITY =
  /(?:^|\s)(?:[\w-]+:)*(?:bg|text|border|from|via|to|fill|stroke|ring|outline|divide|caret|accent|decoration)-\[(?:#[\da-f]|(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(|color:)/giu;

const ARBITRARY_TEXT_PX = /(?:^|\s)(?:[\w-]+:)*text-\[(?:\d*\.)?\d+px\](?=$|\s)/giu;
const CSS_FONT_FAMILY = /\bfont-family\s*:/giu;
const UI_TEXT_ATTRIBUTES = new Set(["alt", "aria-label", "placeholder", "title"]);

function emptyCounts(): Counts {
  return {
    arbitraryColorUtility: 0,
    arbitraryTextPx: 0,
    inlineFontFamily: 0,
    jsxUiText: 0,
    paletteColorUtility: 0,
    rawColorLiteral: 0,
  };
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function isAllowed(path: string, category: Category): boolean {
  return ALLOWLIST.some(rule => rule.categories.includes(category) && rule.matches(path));
}

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...listSourceFiles(absolute));
    } else if (entry.endsWith(".tsx") || entry.endsWith(".css")) {
      files.push(absolute);
    }
  }
  return files;
}

/** Retire les commentaires CSS sans toucher aux valeurs déclarées. */
function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ");
}

function textHasLanguage(value: string): boolean {
  return /\p{L}/u.test(value.replace(/\s+/gu, " ").trim());
}

function analyseCss(source: string): Counts {
  const code = stripCssComments(source);
  return {
    arbitraryColorUtility: countMatches(code, ARBITRARY_COLOR_UTILITY),
    arbitraryTextPx: countMatches(code, ARBITRARY_TEXT_PX),
    inlineFontFamily: countMatches(code, CSS_FONT_FAMILY),
    jsxUiText: 0,
    paletteColorUtility: countMatches(code, PALETTE_UTILITY),
    rawColorLiteral: countMatches(code, RAW_COLOR),
  };
}

function analyseTsx(source: string, path: string): Counts {
  const counts = emptyCounts();
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const presentationStrings: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      presentationStrings.push(node.text);
    }

    if (ts.isPropertyAssignment(node) && node.name.getText(file) === "fontFamily") {
      counts.inlineFontFamily += 1;
    }

    if (ts.isJsxText(node) && textHasLanguage(node.text)) {
      counts.jsxUiText += 1;
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression)) &&
      textHasLanguage(node.expression.text)
    ) {
      counts.jsxUiText += 1;
    }

    if (
      ts.isJsxAttribute(node) &&
      UI_TEXT_ATTRIBUTES.has(node.name.getText(file)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      textHasLanguage(node.initializer.text)
    ) {
      counts.jsxUiText += 1;
    }

    ts.forEachChild(node, visit);
  };
  visit(file);

  for (const value of presentationStrings) {
    counts.rawColorLiteral += countMatches(value, RAW_COLOR);
    counts.paletteColorUtility += countMatches(value, PALETTE_UTILITY);
    counts.arbitraryColorUtility += countMatches(value, ARBITRARY_COLOR_UTILITY);
    counts.arbitraryTextPx += countMatches(value, ARBITRARY_TEXT_PX);
    counts.inlineFontFamily += countMatches(value, CSS_FONT_FAMILY);
  }

  return counts;
}

function currentCounts(): Counts {
  const total = emptyCounts();
  for (const absolute of listSourceFiles(WEBSITE_SRC)) {
    const path = relative(REPO_ROOT, absolute).replaceAll("\\", "/");
    const source = readFileSync(absolute, "utf8");
    const perFile = absolute.endsWith(".css") ? analyseCss(source) : analyseTsx(source, path);

    for (const category of CATEGORIES) {
      if (!isAllowed(path, category)) total[category] += perFile[category];
    }
  }
  return total;
}

describe("ratchet des littéraux de présentation", () => {
  test("l'allowlist reste explicite et justifiée", () => {
    expect(ALLOWLIST.length).toBeLessThanOrEqual(3);
    for (const rule of ALLOWLIST) {
      expect(rule.reason.length).toBeGreaterThan(30);
      expect(rule.categories.length).toBeGreaterThan(0);
    }
  });

  test("aucune catégorie n'augmente par rapport à la baseline", async () => {
    const baseline = (await Bun.file(BASELINE_PATH).json()) as Baseline;
    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.scope).toMatch(/^apps\/(?:rg\/)?website\/src\/\*\*\/\*\.\{tsx,css\}$/);
    expect(Object.keys(baseline.counts).sort()).toEqual([...CATEGORIES].sort());

    const current = currentCounts();
    const increases = CATEGORIES.flatMap(category => {
      const before = baseline.counts[category];
      const after = current[category];
      return after > before ? [{ category, baseline: before, current: after, delta: after - before }] : [];
    });

    if (increases.length > 0) {
      throw new Error(
        `Nouveaux littéraux de présentation détectés :\n${JSON.stringify(increases, null, 2)}\n` +
          `Comptage courant (à utiliser uniquement après avoir réduit ou justifié la dette) :\n` +
          `${JSON.stringify(current, null, 2)}`,
      );
    }
  });
});
