/**
 * IR → Swift (`Codable`).
 *
 * Cible : app iOS native. Aucune dépendance hors bibliothèque standard ;
 * `AnyCodable` est émis dans le fichier pour couvrir les charges libres.
 */

import { resolveFields } from "./emit-json-schema";
import { indexDeclarations, type IrContract, type IrDeclaration, type IrField, type IrType } from "./ir";
import { docComment, swiftFieldName } from "./naming";

/**
 * Swift accepte tel quel les noms de types du contrat (déjà en PascalCase) et
 * conserve ainsi les acronymes : `UserDTO` et non `UserDto`.
 */
const typeName = (name: string): string => name;

function swiftType(type: IrType): string {
  switch (type.kind) {
    case "string":
      return "String";
    case "number":
      return "Double";
    case "integer":
      return "Int";
    case "boolean":
      return "Bool";
    case "null":
      return "AnyCodable?";
    case "unknown":
      return "AnyCodable";
    // ISO 8601 : décodé en `String` pour ne pas imposer de stratégie de date.
    case "date":
      return "String";
    case "literal":
      return typeof type.value === "string" ? "String" : typeof type.value === "number" ? "Double" : "Bool";
    case "param":
      return type.name;
    case "ref":
      return type.args.length === 0
        ? typeName(type.name)
        : `${typeName(type.name)}<${type.args.map(swiftType).join(", ")}>`;
    case "array":
      return `[${swiftType(type.of)}]`;
    case "tuple":
      return `(${type.of.map(swiftType).join(", ")})`;
    case "map":
      return `[String: ${swiftType(type.value)}]`;
    case "union":
      return unionType(type.of);
    case "object":
      return "AnyCodable";
    default:
      return "AnyCodable";
  }
}

function unionType(members: readonly IrType[]): string {
  const nullable = members.some(member => member.kind === "null");
  const rest = members.filter(member => member.kind !== "null");
  if (rest.length === 0) return "AnyCodable?";

  const inner =
    rest.length === 1
      ? swiftType(rest[0] as IrType)
      : rest.every(member => member.kind === "literal" && typeof member.value === "string")
        ? "String"
        : "AnyCodable";

  return nullable ? `${inner}?` : inner;
}

function emitEnum(decl: Extract<IrDeclaration, { kind: "enum" }>): string[] {
  const lines = docComment(decl.doc, "/// ");
  const raw = decl.valueType === "string" ? "String" : "Int";
  lines.push(`public enum ${typeName(decl.name)}: ${raw}, Codable, Sendable, CaseIterable {`);
  for (const member of decl.members) {
    lines.push(...docComment(member.doc, "/// ", "\t"));
    const value = typeof member.value === "string" ? JSON.stringify(member.value) : member.value;
    lines.push(`\tcase ${swiftFieldName(member.name)} = ${value}`);
  }
  lines.push("}");
  return lines;
}

function emitStruct(
  name: string,
  doc: string | undefined,
  typeParams: readonly string[],
  fields: readonly IrField[],
): string[] {
  const lines = docComment(doc, "/// ");
  const generics = typeParams.length === 0 ? "" : `<${typeParams.map(p => `${p}: Codable`).join(", ")}>`;
  lines.push(`public struct ${typeName(name)}${generics}: Codable, Sendable {`);

  const remapped: Array<[string, string]> = [];
  for (const field of fields) {
    lines.push(...docComment(field.doc, "/// ", "\t"));
    const swiftName = swiftFieldName(field.name);
    let rendered = swiftType(field.type);
    if (field.optional && !rendered.endsWith("?")) rendered = `${rendered}?`;
    lines.push(`\tpublic let ${swiftName}: ${rendered}`);
    remapped.push([swiftName, field.name]);
  }

  // `CodingKeys` n'est émis que si au moins un nom Swift diffère du JSON.
  if (remapped.some(([swift, json]) => swift.replaceAll("`", "") !== json)) {
    lines.push("", "\tpublic enum CodingKeys: String, CodingKey {");
    for (const [swift, json] of remapped) {
      lines.push(`\t\tcase ${swift} = ${JSON.stringify(json)}`);
    }
    lines.push("\t}");
  }

  lines.push("}");
  return lines;
}

const ANY_CODABLE = `
/// Valeur JSON arbitraire — utilisée pour les charges utiles libres du contrat.
public struct AnyCodable: Codable, Sendable {
	public let value: Data?

	public init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		self.value = try? JSONSerialization.data(
			withJSONObject: container.decode(AnyDecodableBox.self).unwrapped,
			options: [.fragmentsAllowed]
		)
	}

	public func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		guard let value,
			let object = try? JSONSerialization.jsonObject(with: value, options: [.fragmentsAllowed])
		else {
			try container.encodeNil()
			return
		}
		try container.encode(AnyDecodableBox(unwrapped: object))
	}
}

private struct AnyDecodableBox: Codable, @unchecked Sendable {
	let unwrapped: Any

	init(unwrapped: Any) { self.unwrapped = unwrapped }

	init(from decoder: Decoder) throws {
		let container = try decoder.singleValueContainer()
		if container.decodeNil() { unwrapped = NSNull() }
		else if let bool = try? container.decode(Bool.self) { unwrapped = bool }
		else if let int = try? container.decode(Int.self) { unwrapped = int }
		else if let double = try? container.decode(Double.self) { unwrapped = double }
		else if let string = try? container.decode(String.self) { unwrapped = string }
		else if let array = try? container.decode([AnyDecodableBox].self) {
			unwrapped = array.map(\\.unwrapped)
		} else if let object = try? container.decode([String: AnyDecodableBox].self) {
			unwrapped = object.mapValues(\\.unwrapped)
		} else {
			unwrapped = NSNull()
		}
	}

	func encode(to encoder: Encoder) throws {
		var container = encoder.singleValueContainer()
		switch unwrapped {
		case let bool as Bool: try container.encode(bool)
		case let int as Int: try container.encode(int)
		case let double as Double: try container.encode(double)
		case let string as String: try container.encode(string)
		case let array as [Any]: try container.encode(array.map { AnyDecodableBox(unwrapped: $0) })
		case let object as [String: Any]:
			try container.encode(object.mapValues { AnyDecodableBox(unwrapped: $0) })
		default: try container.encodeNil()
		}
	}
}
`.trim();

export function emitSwift(contract: IrContract): string {
  const byName = indexDeclarations(contract);
  const out: string[] = [
    "// Contrat Achilléa — FICHIER GÉNÉRÉ, ne pas éditer à la main.",
    `// Source : ${contract.source}@${contract.version}`,
    "// Régénérer : bun --filter @rosegriffon/achillea-contract generate",
    "",
    "import Foundation",
    "",
    ANY_CODABLE,
    "",
  ];

  for (const decl of contract.declarations) {
    if (decl.kind === "enum") out.push(...emitEnum(decl), "");
    else if (decl.kind === "alias") {
      if (decl.type.kind === "object") {
        out.push(...emitStruct(decl.name, decl.doc, decl.typeParams, decl.type.fields), "");
      } else if (decl.type.kind === "union") {
        const refs = decl.type.of.filter(member => member.kind === "ref");
        const objects = decl.type.of.filter(member => member.kind === "object");
        if (refs.length > 0 && objects.length > 0) {
          // Swift n'a pas d'équivalent de `serde(flatten)` : on aplatit
          // les champs du parent dans la struct enfant.
          const inherited = refs.flatMap(ref => {
            const target = byName.get((ref as { name: string }).name);
            return target ? resolveFields(target, byName) : [];
          });
          const own = objects.flatMap(object => (object as { fields: IrField[] }).fields);
          out.push(...emitStruct(decl.name, decl.doc, decl.typeParams, [...inherited, ...own]), "");
        } else {
          out.push(
            ...docComment(decl.doc, "/// "),
            `public typealias ${typeName(decl.name)} = ${swiftType(decl.type)}`,
            "",
          );
        }
      } else {
        out.push(
          ...docComment(decl.doc, "/// "),
          `public typealias ${typeName(decl.name)} = ${swiftType(decl.type)}`,
          "",
        );
      }
    } else {
      out.push(...emitStruct(decl.name, decl.doc, decl.typeParams, resolveFields(decl, byName)), "");
    }
  }

  return `${out.join("\n").trimEnd()}\n`;
}
