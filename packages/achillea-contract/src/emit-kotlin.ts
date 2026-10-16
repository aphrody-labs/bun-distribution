/**
 * IR → Kotlin (`kotlinx.serialization`).
 *
 * Cible : app Android native, ou tout service JVM. Seule dépendance attendue :
 * `org.jetbrains.kotlinx:kotlinx-serialization-json`.
 */

import { resolveFields } from "./emit-json-schema";
import { indexDeclarations, type IrContract, type IrDeclaration, type IrField, type IrType } from "./ir";
import { docComment, kotlinFieldName } from "./naming";

/**
 * Kotlin accepte tel quel les noms de types du contrat (déjà en PascalCase) et
 * conserve ainsi les acronymes : `UserDTO` et non `UserDto`.
 */
const typeName = (name: string): string => name;

function kotlinType(type: IrType): string {
	switch (type.kind) {
		case "string":
			return "String";
		case "number":
			return "Double";
		case "integer":
			return "Long";
		case "boolean":
			return "Boolean";
		case "null":
			return "JsonElement?";
		case "unknown":
			return "JsonElement";
		// ISO 8601 : laissé en `String`, à convertir côté app selon la lib de dates.
		case "date":
			return "String";
		case "literal":
			return typeof type.value === "string" ? "String" : typeof type.value === "number" ? "Double" : "Boolean";
		case "param":
			return type.name;
		case "ref":
			return type.args.length === 0
				? typeName(type.name)
				: `${typeName(type.name)}<${type.args.map(kotlinType).join(", ")}>`;
		case "array":
			return `List<${kotlinType(type.of)}>`;
		case "tuple":
			if (type.of.length === 2) return `Pair<${kotlinType(type.of[0]!)}, ${kotlinType(type.of[1]!)}>`;
			if (type.of.length === 3) return `Triple<${kotlinType(type.of[0]!)}, ${kotlinType(type.of[1]!)}, ${kotlinType(type.of[2]!)}>`;
			return `List<JsonElement>`;
		case "map":
			return `Map<String, ${kotlinType(type.value)}>`;
		case "union":
			return unionType(type.of);
		case "object":
			return "JsonElement";
		default:
			return "JsonElement";
	}
}

function unionType(members: readonly IrType[]): string {
	const nullable = members.some((member) => member.kind === "null");
	const rest = members.filter((member) => member.kind !== "null");
	if (rest.length === 0) return "JsonElement?";

	const inner =
		rest.length === 1
			? kotlinType(rest[0] as IrType)
			: rest.every((member) => member.kind === "literal" && typeof member.value === "string")
				? "String"
				: "JsonElement";

	return nullable ? `${inner}?` : inner;
}

function emitEnum(decl: Extract<IrDeclaration, { kind: "enum" }>): string[] {
	const lines = docComment(decl.doc, "/// ");
	lines.push("@Serializable");
	lines.push(`enum class ${typeName(decl.name)} {`);
	for (const member of decl.members) {
		lines.push(...docComment(member.doc, "/// ", "\t"));
		// `SerialName` porte la valeur du fil ; les enums numériques passent par
		// leur représentation textuelle, kotlinx ne sérialisant pas d'ordinal.
		lines.push(`\t@SerialName(${JSON.stringify(String(member.value))})`);
		lines.push(`\t${member.name.toUpperCase()},`);
	}
	lines.push("}");
	return lines;
}

function emitDataClass(
	name: string,
	doc: string | undefined,
	typeParams: readonly string[],
	fields: readonly IrField[]
): string[] {
	const lines = docComment(doc, "/// ");
	lines.push("@Serializable");

	const generics = typeParams.length === 0 ? "" : `<${typeParams.join(", ")}>`;
	if (fields.length === 0) {
		lines.push(`class ${typeName(name)}${generics}`);
		return lines;
	}

	lines.push(`data class ${typeName(name)}${generics}(`);
	for (const field of fields) {
		lines.push(...docComment(field.doc, "/// ", "\t"));
		const kotlinName = kotlinFieldName(field.name);
		if (kotlinName.replaceAll("`", "") !== field.name) {
			lines.push(`\t@SerialName(${JSON.stringify(field.name)})`);
		}
		let rendered = kotlinType(field.type);
		const suffix = field.optional && !rendered.endsWith("?") ? "?" : "";
		rendered += suffix;
		lines.push(`\tval ${kotlinName}: ${rendered}${field.optional ? " = null" : ""},`);
	}
	lines.push(")");
	return lines;
}

export function emitKotlin(contract: IrContract, packageName = "fr.rosegriffon.achillea"): string {
	const byName = indexDeclarations(contract);
	const out: string[] = [
		"// Contrat Achilléa — FICHIER GÉNÉRÉ, ne pas éditer à la main.",
		`// Source : ${contract.source}@${contract.version}`,
		"// Régénérer : bun --filter @rosegriffon/achillea-contract generate",
		"",
		`package ${packageName}`,
		"",
		"import kotlinx.serialization.SerialName",
		"import kotlinx.serialization.Serializable",
		"import kotlinx.serialization.json.JsonElement",
		"",
	];

	for (const decl of contract.declarations) {
		if (decl.kind === "enum") out.push(...emitEnum(decl), "");
		else if (decl.kind === "alias") {
			if (decl.type.kind === "object") {
				out.push(...emitDataClass(decl.name, decl.doc, decl.typeParams, decl.type.fields), "");
			} else if (decl.type.kind === "union") {
				const refs = decl.type.of.filter((member) => member.kind === "ref");
				const objects = decl.type.of.filter((member) => member.kind === "object");
				if (refs.length > 0 && objects.length > 0) {
					// Pas d'héritage de data class en Kotlin : on aplatit.
					const inherited = refs.flatMap((ref) => {
						const target = byName.get((ref as { name: string }).name);
						return target ? resolveFields(target, byName) : [];
					});
					const own = objects.flatMap((object) => (object as { fields: IrField[] }).fields);
					out.push(
						...emitDataClass(decl.name, decl.doc, decl.typeParams, [...inherited, ...own]),
						""
					);
				} else {
					out.push(
						...docComment(decl.doc, "/// "),
						`typealias ${typeName(decl.name)} = ${kotlinType(decl.type)}`,
						""
					);
				}
			} else {
				out.push(
					...docComment(decl.doc, "/// "),
					`typealias ${typeName(decl.name)} = ${kotlinType(decl.type)}`,
					""
				);
			}
		} else {
			out.push(...emitDataClass(decl.name, decl.doc, decl.typeParams, resolveFields(decl, byName)), "");
		}
	}

	return `${out.join("\n").trimEnd()}\n`;
}
