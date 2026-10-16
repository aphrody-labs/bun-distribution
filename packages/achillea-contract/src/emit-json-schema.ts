/**
 * IR → JSON Schema draft 2020-12.
 *
 * C'est le pivot vers les langages qu'on n'émet pas nous-mêmes : `quicktype`,
 * `openapi-generator` et consorts consomment ce fichier pour produire du
 * Swift, du Kotlin, du Go ou du C#.
 */

import { indexDeclarations, type IrContract, type IrDeclaration, type IrField, type IrType } from "./ir";

export interface JsonSchemaDocument {
  $schema: string;
  $id: string;
  title: string;
  description: string;
  $defs: Record<string, unknown>;
}

function refTo(name: string): Record<string, unknown> {
  return { $ref: `#/$defs/${name}` };
}

function typeToSchema(type: IrType): Record<string, unknown> {
  switch (type.kind) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "integer":
      return { type: "integer" };
    case "boolean":
      return { type: "boolean" };
    case "null":
      return { type: "null" };
    case "unknown":
      return {};
    case "date":
      return { type: "string", format: "date-time" };
    case "literal":
      return { const: type.value };
    case "ref":
      return refTo(type.name);
    // Un paramètre générique non instancié n'a pas de forme connue.
    case "param":
      return {};
    case "array":
      return { type: "array", items: typeToSchema(type.of) };
    case "tuple":
      return {
        type: "array",
        prefixItems: type.of.map(typeToSchema),
        items: false,
        minItems: type.of.length,
        maxItems: type.of.length,
      };
    case "map":
      return { type: "object", additionalProperties: typeToSchema(type.value) };
    case "union":
      return unionToSchema(type.of);
    case "object":
      return objectToSchema(type.fields);
    default:
      return {};
  }
}

function unionToSchema(members: readonly IrType[]): Record<string, unknown> {
  const nullable = members.some(member => member.kind === "null");
  const rest = members.filter(member => member.kind !== "null");

  // Union de littéraux de même type → `enum`, bien plus lisible qu'un `anyOf`.
  if (rest.length > 0 && rest.every(member => member.kind === "literal")) {
    const values = rest.map(member => (member as { value: unknown }).value);
    return nullable ? { enum: [...values, null] } : { enum: values };
  }

  if (rest.length === 1) {
    const single = typeToSchema(rest[0] as IrType);
    return nullable ? { anyOf: [single, { type: "null" }] } : single;
  }

  const anyOf = rest.map(member => typeToSchema(member));
  if (nullable) anyOf.push({ type: "null" });
  return { anyOf };
}

function objectToSchema(fields: readonly IrField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const field of fields) {
    const schema = typeToSchema(field.type);
    properties[field.name] = field.doc ? { ...schema, description: field.doc } : schema;
    if (!field.optional) required.push(field.name);
  }

  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) schema["required"] = required;
  return schema;
}

/** Clés littérales d'un `Omit`/`Pick` (`"a"` ou `"a" | "b"`). */
function literalKeys(type: IrType | undefined): Set<string> {
  if (!type) return new Set();
  const members = type.kind === "union" ? type.of : [type];
  return new Set(
    members.filter(member => member.kind === "literal").map(member => String((member as { value: unknown }).value)),
  );
}

/**
 * Champs hérités d'une clause `extends`, `Omit`/`Pick` compris.
 *
 * Sans ce traitement, `interface WireTournament extends Omit<Tournament, …>`
 * produisait une struct qui ne gardait QUE ses champs propres : les trente
 * champs de `Tournament` disparaissaient du Rust généré sans le moindre
 * avertissement.
 */
function inheritedFields(
  parent: { name: string; args: IrType[] },
  byName: ReadonlyMap<string, IrDeclaration>,
  seen: Set<string>,
): IrField[] {
  if (parent.name === "Omit" || parent.name === "Pick") {
    const [base, keys] = parent.args;
    if (base?.kind !== "ref") return [];
    const target = byName.get(base.name);
    if (!target) return [];

    const fields = resolveFields(target, byName, seen);
    const selected = literalKeys(keys);
    return parent.name === "Omit"
      ? fields.filter(field => !selected.has(field.name))
      : fields.filter(field => selected.has(field.name));
  }

  const target = byName.get(parent.name);
  return target ? resolveFields(target, byName, seen) : [];
}

/** Champs d'une interface, héritage compris (résolu à plat). */
export function resolveFields(
  decl: IrDeclaration,
  byName: ReadonlyMap<string, IrDeclaration>,
  seen = new Set<string>(),
): IrField[] {
  if (decl.kind !== "interface") return [];
  if (seen.has(decl.name)) return [];
  seen.add(decl.name);

  const inherited = decl.extends.flatMap(parent => inheritedFields(parent, byName, seen));

  // Un champ redéclaré dans l'enfant écrase celui du parent.
  const merged = new Map<string, IrField>();
  for (const field of [...inherited, ...decl.fields]) merged.set(field.name, field);
  return [...merged.values()];
}

function declarationToSchema(decl: IrDeclaration, byName: ReadonlyMap<string, IrDeclaration>): Record<string, unknown> {
  const base: Record<string, unknown> = decl.doc ? { description: decl.doc } : {};

  if (decl.kind === "enum") {
    return {
      ...base,
      type: decl.valueType,
      enum: decl.members.map(member => member.value),
      "x-enum-varnames": decl.members.map(member => member.name),
    };
  }

  if (decl.kind === "alias") return { ...base, ...typeToSchema(decl.type) };

  return { ...base, ...objectToSchema(resolveFields(decl, byName)) };
}

export function emitJsonSchema(contract: IrContract): JsonSchemaDocument {
  const byName = indexDeclarations(contract);
  const $defs: Record<string, unknown> = {};

  for (const decl of contract.declarations) {
    $defs[decl.name] = declarationToSchema(decl, byName);
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://achillea.rosegriffon.fr/contract/achillea.schema.json",
    title: "Contrat Achilléa",
    description: `Généré depuis ${contract.source}@${contract.version} — ne pas éditer à la main.`,
    $defs,
  };
}
