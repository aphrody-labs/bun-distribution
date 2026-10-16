import { describe, expect, test } from "bun:test";

import {
  cn,
  debounce,
  formatCurrency,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatPrice,
  generateId,
  isEmpty,
  safeParseJSON,
  sleep,
  throttle,
  truncate,
} from "../src/lib/utils";

describe("cn", () => {
  test("concatène et déduplique", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
    // tailwind-merge : la dernière classe du même groupe gagne.
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  test("ignore les valeurs fausses", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  test("accepte les formes objet et tableau de clsx", () => {
    expect(cn(["a", { b: true, c: false }])).toBe("a b");
  });
});

describe("formatage de dates", () => {
  // Date fixe en UTC : une date « nue » serait interprétée dans le fuseau local
  // et basculerait d'un jour selon la machine qui lance les tests.
  const date = new Date("2026-03-09T12:00:00Z");

  test("formatDate rend le mois en toutes lettres", () => {
    expect(formatDate(date)).toBe("9 mars 2026");
  });

  test("formatDateShort abrège le mois", () => {
    expect(formatDateShort(date)).toMatch(/^9 mars 2026$/);
  });

  test("formatDateTime ajoute l'heure sur deux chiffres", () => {
    expect(formatDateTime(date)).toMatch(/9 mars 2026.+\d{2}:\d{2}/);
  });

  test("accepte une chaîne ISO comme une Date", () => {
    expect(formatDate("2026-03-09T12:00:00Z")).toBe(formatDate(date));
  });

  test("respecte la locale demandée", () => {
    expect(formatDate(date, "en-US")).toBe("March 9, 2026");
  });
});

describe("formatCurrency / formatPrice", () => {
  /** `Intl` insère une espace insécable étroite avant le symbole monétaire. */
  const normaliser = (s: string) => s.replace(/\s+/g, " ");

  test("formate en euros pour la France", () => {
    expect(normaliser(formatCurrency(12.5))).toBe("12,50 €");
  });

  test("arrondit à deux décimales", () => {
    expect(normaliser(formatCurrency(0.005))).toBe("0,01 €");
  });

  test("gère zéro et les montants négatifs", () => {
    expect(normaliser(formatCurrency(0))).toBe("0,00 €");
    expect(normaliser(formatCurrency(-3))).toBe("-3,00 €");
  });

  test("formatPrice est l'alias euro/France de formatCurrency", () => {
    expect(formatPrice(42)).toBe(formatCurrency(42, "EUR", "fr-FR"));
  });

  test("accepte une autre devise", () => {
    expect(normaliser(formatCurrency(10, "USD", "en-US"))).toBe("$10.00");
  });
});

describe("truncate", () => {
  test("laisse intacte une chaîne assez courte", () => {
    expect(truncate("court", 10)).toBe("court");
  });

  test("n'ajoute pas d'ellipse à la longueur exacte", () => {
    expect(truncate("12345", 5)).toBe("12345");
  });

  test("coupe et suffixe au-delà", () => {
    expect(truncate("123456", 5)).toBe("12345...");
  });
});

describe("isEmpty", () => {
  test.each([
    [null, true],
    [undefined, true],
    ["", true],
    ["   ", true],
    [[], true],
    [{}, true],
    ["a", false],
    [[0], false],
    [{ a: 1 }, false],
    [0, false],
    [false, false],
  ])("isEmpty(%p) === %p", (valeur, attendu) => {
    expect(isEmpty(valeur)).toBe(attendu);
  });

  test("0 et false ne sont PAS vides", () => {
    // Un `!value` naïf les classerait comme vides et ferait disparaître un
    // compteur à zéro ou un interrupteur éteint de l'interface.
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(false)).toBe(false);
  });
});

describe("safeParseJSON", () => {
  test("rend la valeur analysée", () => {
    expect(safeParseJSON('{"a":1}', {})).toEqual({ a: 1 });
  });

  test("rend le repli sur du JSON invalide au lieu de lever", () => {
    expect(safeParseJSON("{pas du json", { a: 0 })).toEqual({ a: 0 });
    expect(safeParseJSON("", null)).toBe(null);
  });
});

describe("generateId", () => {
  test("respecte la longueur demandée", () => {
    expect(generateId()).toHaveLength(16);
    expect(generateId(8)).toHaveLength(8);
    expect(generateId(0)).toBe("");
  });

  test("n'utilise que des caractères alphanumériques", () => {
    expect(generateId(200)).toMatch(/^[A-Za-z0-9]+$/);
  });

  test("ne rend pas deux fois la même valeur", () => {
    const tirages = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(tirages.size).toBe(100);
  });
});

describe("debounce", () => {
  test("n'exécute qu'une fois, avec les derniers arguments", async () => {
    const vus: unknown[][] = [];
    const d = debounce((...args: unknown[]) => vus.push(args), 20);
    d(1);
    d(2);
    d(3);
    expect(vus).toEqual([]);
    await sleep(60);
    expect(vus).toEqual([[3]]);
  });

  test("laisse passer deux appels séparés par plus que le délai", async () => {
    let n = 0;
    const d = debounce(() => n++, 15);
    d();
    await sleep(50);
    d();
    await sleep(50);
    expect(n).toBe(2);
  });
});

describe("throttle", () => {
  test("exécute immédiatement puis ignore pendant la fenêtre", async () => {
    let n = 0;
    const t = throttle(() => n++, 40);
    t();
    t();
    t();
    expect(n).toBe(1);
    await sleep(80);
    t();
    expect(n).toBe(2);
  });
});

describe("sleep", () => {
  test("attend au moins la durée demandée", async () => {
    const debut = Date.now();
    await sleep(30);
    expect(Date.now() - debut).toBeGreaterThanOrEqual(25);
  });
});
