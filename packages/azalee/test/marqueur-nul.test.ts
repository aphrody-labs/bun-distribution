import { describe, expect, test } from "bun:test";

import { SqliteQueryBuilder } from "../src/db/sqlite-client";

/**
 * Le dump Postgres → miroir SQLite laisse le marqueur de NULL de `COPY` sous
 * forme de TEXTE, et en doublant l'échappement : la cellule vaut trois
 * caractères (`\`, `\`, `N`), pas deux. La normalisation ne comparait qu'à la
 * forme courte : elle ne correspondait donc jamais, et l'API publique servait
 * `"uniformNumber":"\\N"` au lieu de `null`.
 *
 * Mesuré sur le miroir au moment du correctif : 121 587 cellules concernées
 * pour les seules tables personnages, techniques, objets et passifs.
 */
describe("marqueur de NULL du dump", () => {
  // `parseRow` est privée : on l'atteint par la même voie que le code appelant.
  const parse = (ligne: Record<string, unknown>) =>
    (
      SqliteQueryBuilder.prototype as unknown as {
        parseRow: (r: Record<string, unknown>) => Record<string, unknown>;
      }
    ).parseRow(ligne);

  test("la forme doublée du miroir devient null", () => {
    expect(parse({ uniform_number: "\\\\N" }).uniform_number).toBeNull();
  });

  test("la forme simple de `COPY` devient null aussi", () => {
    expect(parse({ teams: "\\N" }).teams).toBeNull();
  });

  test("une valeur qui ressemble au marqueur sans en être un est préservée", () => {
    expect(parse({ nom: "\\Nord" }).nom).toBe("\\Nord");
    expect(parse({ nom: "N" }).nom).toBe("N");
    expect(parse({ nom: "" }).nom).toBe("");
  });

  test("les valeurs normales traversent sans modification", () => {
    expect(parse({ nom: "Mark Evans", id: 42 })).toEqual({ nom: "Mark Evans", id: 42 });
  });
});
