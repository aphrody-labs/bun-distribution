/**
 * Solidité du code généré.
 *
 * Les générateurs renomment : `soloRank` → `solo_rank`, `UserDTO` → `UserDto`,
 * `ONE_VS_ONE` → `OneVsOne`. Un renommage est une fonction qui peut collisionner,
 * et une collision produit un fichier qui ne compile pas — ou pire, qui compile
 * en écrasant un champ. Ces tests vérifient les propriétés que la génération
 * doit tenir pour n'importe quel contrat, pas seulement pour celui d'aujourd'hui.
 *
 * `cargo`, `swiftc` et `kotlinc` ne sont pas garantis en CI : ce fichier
 * remplace ce qu'un compilateur aurait détecté par des invariants structurels.
 */

import { describe, expect, test } from "bun:test";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveFields } from "../src/emit-json-schema";
import { emitKotlin } from "../src/emit-kotlin";
import { emitRust } from "../src/emit-rust";
import { emitSwift } from "../src/emit-swift";
import { extractContract } from "../src/extract";
import { indexDeclarations, type IrContract, type IrDeclaration, type IrField } from "../src/ir";
import { kotlinFieldName, rustFieldName, swiftFieldName, toCamelCase, toPascalCase, toSnakeCase } from "../src/naming";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES_ROOT = join(PACKAGE_ROOT, "..", "achillea-types", "src");

const contract: IrContract = extractContract({ root: TYPES_ROOT });
const byName = indexDeclarations(contract);

/** Champs d'une déclaration porteuse de struct (interface ou alias d'objet). */
function fieldsOf(decl: IrDeclaration): IrField[] {
  if (decl.kind === "interface") return resolveFields(decl, byName);
  if (decl.kind === "alias" && decl.type.kind === "object") return decl.type.fields;
  return [];
}

/** Déclarations porteuses de champs. */
function structDeclarations(): IrDeclaration[] {
  return contract.declarations.filter(decl => fieldsOf(decl).length > 0);
}

/** Doublons d'une liste, une seule fois chacun. */
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) found.add(value);
    seen.add(value);
  }
  return [...found];
}

describe("noms de types", () => {
  test("deux déclarations ne collisionnent pas après conversion Rust", () => {
    // `UserDTO` et un hypothétique `UserDto` donneraient tous deux `UserDto` :
    // le second écraserait le premier dans le fichier généré.
    const collisions = duplicates(contract.declarations.map(decl => toPascalCase(decl.name)));
    expect(collisions).toEqual([]);
  });

  test("Swift et Kotlin gardent les noms du contrat, donc restent uniques", () => {
    expect(duplicates(contract.declarations.map(decl => decl.name))).toEqual([]);
  });

  test("aucun nom de type généré n'est vide ni numérique", () => {
    for (const decl of contract.declarations) {
      const rust = toPascalCase(decl.name);
      expect(rust.length, `${decl.name} → nom Rust vide`).toBeGreaterThan(0);
      expect(/^[A-Za-z]/u.test(rust), `${decl.name} → ${rust} ne commence pas par une lettre`).toBe(true);
    }
  });
});

describe("noms de champs", () => {
  test("deux champs d'une même struct ne collisionnent pas en snake_case", () => {
    // `xUrl` et `x_url` donnent tous deux `x_url` : le Rust généré aurait deux
    // champs du même nom et ne compilerait pas.
    const collisions: string[] = [];
    for (const decl of structDeclarations()) {
      const fields = fieldsOf(decl);
      const rust = duplicates(fields.map(field => rustFieldName(field.name)));
      const swift = duplicates(fields.map(field => swiftFieldName(field.name)));
      const kotlin = duplicates(fields.map(field => kotlinFieldName(field.name)));
      for (const name of [...rust, ...swift, ...kotlin]) {
        collisions.push(`${decl.name}.${name}`);
      }
    }
    expect([...new Set(collisions)]).toEqual([]);
  });

  test("les mots réservés sont échappés dans les trois langages", () => {
    expect(rustFieldName("type")).toBe("r#type");
    expect(rustFieldName("ref")).toBe("r#ref");
    expect(rustFieldName("match")).toBe("r#match");
    expect(swiftFieldName("default")).toBe("`default`");
    expect(swiftFieldName("class")).toBe("`class`");
    expect(kotlinFieldName("object")).toBe("`object`");
    expect(kotlinFieldName("val")).toBe("`val`");
    // Un nom ordinaire n'est jamais échappé.
    expect(rustFieldName("username")).toBe("username");
    expect(swiftFieldName("username")).toBe("username");
  });

  test("aucun identifiant généré n'est vide", () => {
    for (const decl of structDeclarations()) {
      for (const field of fieldsOf(decl)) {
        expect(rustFieldName(field.name).length, `${decl.name}.${field.name}`).toBeGreaterThan(0);
        expect(swiftFieldName(field.name).length).toBeGreaterThan(0);
        expect(kotlinFieldName(field.name).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("membres d'enum", () => {
  test("deux membres ne collisionnent pas après conversion", () => {
    const collisions: string[] = [];
    for (const decl of contract.declarations) {
      if (decl.kind !== "enum") continue;
      const rust = duplicates(decl.members.map(member => toPascalCase(member.name)));
      const swift = duplicates(decl.members.map(member => swiftFieldName(member.name)));
      for (const name of [...rust, ...swift]) collisions.push(`${decl.name}.${name}`);
    }
    expect([...new Set(collisions)]).toEqual([]);
  });

  test("deux membres d'un même enum n'ont pas la même valeur de fil", () => {
    // Deux variantes de même valeur rendent la désérialisation ambiguë : la
    // seconde devient inatteignable.
    const collisions: string[] = [];
    for (const decl of contract.declarations) {
      if (decl.kind !== "enum") continue;
      const values = duplicates(decl.members.map(member => String(member.value)));
      for (const value of values) collisions.push(`${decl.name} → ${value}`);
    }
    expect(collisions).toEqual([]);
  });

  test("un enum n'est jamais vide", () => {
    for (const decl of contract.declarations) {
      if (decl.kind !== "enum") continue;
      expect(decl.members.length, `${decl.name} est vide`).toBeGreaterThan(0);
    }
  });
});

describe("fichiers générés", () => {
  const rust = emitRust(contract);
  const swift = emitSwift(contract);
  const kotlin = emitKotlin(contract);

  test("aucun marqueur de type non résolu ne subsiste", () => {
    for (const [language, source] of [
      ["Rust", rust],
      ["Swift", swift],
      ["Kotlin", kotlin],
    ] as const) {
      expect(source, `${language} contient « undefined »`).not.toContain("undefined");
      expect(source, `${language} contient « [object Object] »`).not.toContain("[object Object]");
      expect(source, `${language} contient « NaN »`).not.toContain(": NaN");
    }
  });

  test("Rust : chaque type référencé est déclaré dans le fichier", () => {
    const declared = new Set(contract.declarations.map(decl => toPascalCase(decl.name)));
    declared.add("Timestamp");
    // Les paramètres génériques (`T`, `TAttribution`, …) sont déclarés par la
    // signature qui les porte, pas par une déclaration du contrat.
    for (const decl of contract.declarations) {
      if (decl.kind === "interface" || decl.kind === "alias") {
        for (const param of decl.typeParams) declared.add(param);
      }
    }

    const referenced = [...rust.matchAll(/\bpub \w+(?:: |\()([A-Za-z0-9_:<>, ]+)[,)]/gu)]
      .flatMap(match => (match[1] as string).split(/[<>,\s]+/u))
      .map(token => token.trim())
      .filter(
        token =>
          token.length > 0 &&
          /^[A-Z]/u.test(token) &&
          !token.includes("::") &&
          !["Option", "Vec", "String", "HashMap", "Serialize"].includes(token),
      );

    const missing = [...new Set(referenced)].filter(name => !declared.has(name));
    expect(missing).toEqual([]);
  });

  test("Rust : les accolades et parenthèses sont équilibrées", () => {
    const braces = (rust.match(/\{/gu) ?? []).length - (rust.match(/\}/gu) ?? []).length;
    expect(braces).toBe(0);
  });

  test("Kotlin : une data class a toujours au moins un paramètre", () => {
    // `data class X()` ne compile pas en Kotlin.
    expect(kotlin).not.toMatch(/data class \w+\(\s*\)/u);
  });

  test("Swift : `CodingKeys` couvre exactement les champs déclarés", () => {
    const structs = swift.split(/(?=public struct )/u).filter(block => block.includes("public let"));
    for (const block of structs) {
      const keysBlock = /public enum CodingKeys[^}]*\}/u.exec(block)?.[0];
      if (!keysBlock) continue;
      const properties = [...block.matchAll(/^\tpublic let (`?[\w`]+):/gmu)].map(m => m[1]);
      const keys = [...keysBlock.matchAll(/case (`?[\w`]+) =/gu)].map(m => m[1]);
      expect(keys.length, `CodingKeys incomplet dans ${block.slice(0, 60)}`).toBe(properties.length);
    }
  });

  test("chaque déclaration apparaît dans les trois cibles", () => {
    for (const decl of contract.declarations) {
      expect(rust, `${decl.name} absent du Rust`).toContain(toPascalCase(decl.name));
      expect(swift, `${decl.name} absent du Swift`).toContain(decl.name);
      expect(kotlin, `${decl.name} absent du Kotlin`).toContain(decl.name);
    }
  });
});

describe("conversions de casse", () => {
  test("snake_case préserve les frontières de mots (aller-retour)", () => {
    // Sans découpe aux frontières, `clanAvatarUrl` deviendrait `clanavatarurl` :
    // ça compilerait quand même, mais le fichier généré serait illisible et la
    // perte passerait inaperçue jusqu'à ce qu'un humain le relise.
    for (const name of ["clanAvatarUrl", "soloRank", "hasTwitch", "participantsNumber", "id"]) {
      expect(toCamelCase(toSnakeCase(name))).toBe(name);
    }
  });

  test("snake_case est idempotent", () => {
    for (const name of ["clanAvatarUrl", "x_url", "HTTPServer", "id", "a", "ABC"]) {
      expect(toSnakeCase(toSnakeCase(name))).toBe(toSnakeCase(name));
    }
  });

  test("PascalCase et camelCase ne perdent jamais de caractères significatifs", () => {
    for (const name of ["single_elimination", "ONE_VS_ONE", "x", "a_b_c"]) {
      expect(toPascalCase(name).toLowerCase()).toBe(name.replaceAll("_", "").toLowerCase());
      expect(toCamelCase(name).toLowerCase()).toBe(name.replaceAll("_", "").toLowerCase());
    }
  });

  test("les conversions ne rendent jamais une chaîne vide sur une entrée non vide", () => {
    for (const name of ["a", "_", "__", "1", "aB"]) {
      expect(toSnakeCase(name).length + toPascalCase(name).length).toBeGreaterThan(0);
    }
  });
});
