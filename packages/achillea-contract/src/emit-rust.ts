/**
 * IR → Rust (serde).
 *
 * Cible : un client de jeu ou un service Rust qui parle à l'API Achilléa sans
 * réécrire le domaine. Le fichier produit ne dépend que de `serde`,
 * `serde_json` et `serde_repr` (enums numériques).
 */

import { resolveFields } from "./emit-json-schema";
import { indexDeclarations, type IrContract, type IrDeclaration, type IrField, type IrType } from "./ir";
import { docComment, rustFieldName, toPascalCase } from "./naming";

/** Type des champs `Date` : ISO 8601 en `String` par défaut. */
const TIMESTAMP_ALIAS = "Timestamp";

function rustType(type: IrType, byName: ReadonlyMap<string, IrDeclaration>): string {
	switch (type.kind) {
		case "string":
			return "String";
		case "number":
			return "f64";
		case "integer":
			return "i64";
		case "boolean":
			return "bool";
		case "null":
			return "Option<serde_json::Value>";
		case "unknown":
			return "serde_json::Value";
		case "date":
			return TIMESTAMP_ALIAS;
		case "literal":
			return typeof type.value === "string" ? "String" : typeof type.value === "number" ? "f64" : "bool";
		case "param":
			return type.name;
		case "ref": {
			const name = toPascalCase(type.name);
			if (type.args.length === 0) return name;
			return `${name}<${type.args.map((arg) => rustType(arg, byName)).join(", ")}>`;
		}
		case "array":
			return `Vec<${rustType(type.of, byName)}>`;
		case "tuple":
			return `(${type.of.map((t) => rustType(t, byName)).join(", ")})`;
		case "map":
			return `std::collections::HashMap<String, ${rustType(type.value, byName)}>`;
		case "union":
			return unionType(type.of, byName);
		// Un objet anonyme n'a pas de nom stable : on le laisse en JSON libre
		// plutôt que d'inventer un nom qui changerait à chaque réordonnancement.
		case "object":
			return "serde_json::Value";
		default:
			return "serde_json::Value";
	}
}

function unionType(members: readonly IrType[], byName: ReadonlyMap<string, IrDeclaration>): string {
	const nullable = members.some((member) => member.kind === "null");
	const rest = members.filter((member) => member.kind !== "null");

	if (rest.length === 0) return "Option<serde_json::Value>";

	// Union de littéraux de chaîne : `String` — la validation reste côté API.
	const inner =
		rest.length === 1
			? rustType(rest[0] as IrType, byName)
			: rest.every((member) => member.kind === "literal" && typeof member.value === "string")
				? "String"
				: "serde_json::Value";

	return nullable ? `Option<${inner}>` : inner;
}

function emitEnum(decl: Extract<IrDeclaration, { kind: "enum" }>): string[] {
	const lines: string[] = [];
	lines.push(...docComment(decl.doc, "/// "));

	if (decl.valueType === "string") {
		lines.push("#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]");
	} else {
		lines.push("#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]");
		lines.push("#[repr(i64)]");
	}

	lines.push(`pub enum ${toPascalCase(decl.name)} {`);
	for (const member of decl.members) {
		lines.push(...docComment(member.doc, "/// ", "\t"));
		const variant = toPascalCase(member.name);
		if (decl.valueType === "string") {
			lines.push(`\t#[serde(rename = ${JSON.stringify(member.value)})]`);
			lines.push(`\t${variant},`);
		} else {
			lines.push(`\t${variant} = ${member.value},`);
		}
	}
	lines.push("}");
	return lines;
}

function emitField(field: IrField, byName: ReadonlyMap<string, IrDeclaration>): string[] {
	const lines = docComment(field.doc, "/// ", "\t");
	const name = rustFieldName(field.name);
	const bare = name.replace(/^r#/u, "");

	let rendered = rustType(field.type, byName);
	const alreadyOptional = rendered.startsWith("Option<");
	if (field.optional && !alreadyOptional) rendered = `Option<${rendered}>`;

	const attributes: string[] = [];
	if (bare !== field.name) attributes.push(`rename = ${JSON.stringify(field.name)}`);
	if (field.optional || alreadyOptional) {
		attributes.push("default", 'skip_serializing_if = "Option::is_none"');
	}
	if (attributes.length > 0) lines.push(`\t#[serde(${attributes.join(", ")})]`);

	lines.push(`\tpub ${name}: ${rendered},`);
	return lines;
}

function genericSuffix(typeParams: readonly string[]): string {
	return typeParams.length === 0 ? "" : `<${typeParams.join(", ")}>`;
}

function genericBounds(typeParams: readonly string[]): string {
	if (typeParams.length === 0) return "";
	const bounds = typeParams.map((param) => `${param}: Serialize + serde::de::DeserializeOwned`);
	return ` where ${bounds.join(", ")}`;
}

function emitStruct(
	name: string,
	doc: string | undefined,
	typeParams: readonly string[],
	fields: readonly IrField[],
	byName: ReadonlyMap<string, IrDeclaration>
): string[] {
	const lines = docComment(doc, "/// ");
	lines.push("#[derive(Debug, Clone, Serialize, Deserialize)]");
	lines.push(`pub struct ${toPascalCase(name)}${genericSuffix(typeParams)}${genericBounds(typeParams)} {`);
	if (fields.length === 0) lines.push("\t// aucun champ");
	for (const field of fields) lines.push(...emitField(field, byName));
	lines.push("}");
	return lines;
}

/** Nom de variante d'une union non nommée (`EntityRef<T>` → `Id` / `Entity`). */
function variantName(type: IrType): string {
	switch (type.kind) {
		case "string":
			return "Text";
		case "number":
		case "integer":
			return "Id";
		case "boolean":
			return "Flag";
		case "date":
			return "Timestamp";
		case "param":
			return "Entity";
		case "ref":
			return toPascalCase(type.name);
		case "array":
			return `List${variantName(type.of)}`;
		case "map":
			return "Map";
		default:
			return "Other";
	}
}

/**
 * Alias d'union → `enum` `#[serde(untagged)]`.
 *
 * `EntityRef<T> = number | T` ne peut pas devenir `serde_json::Value` : Rust
 * refuse un alias dont le paramètre générique n'apparaît pas dans le corps
 * (E0091). Un enum non étiqueté dit la même chose que l'union TypeScript et
 * désérialise les deux formes.
 */
function emitUntaggedEnum(
	decl: Extract<IrDeclaration, { kind: "alias" }>,
	members: readonly IrType[],
	byName: ReadonlyMap<string, IrDeclaration>
): string[] {
	const lines = docComment(decl.doc, "/// ");
	lines.push("#[derive(Debug, Clone, Serialize, Deserialize)]", "#[serde(untagged)]");
	lines.push(
		`pub enum ${toPascalCase(decl.name)}${genericSuffix(decl.typeParams)}${genericBounds(decl.typeParams)} {`
	);

	const used = new Set<string>();
	for (const member of members) {
		if (member.kind === "null") {
			lines.push("	None,");
			continue;
		}
		let name = variantName(member);
		let suffix = 2;
		while (used.has(name)) name = `${variantName(member)}${suffix++}`;
		used.add(name);
		lines.push(`	${name}(${rustType(member, byName)}),`);
	}

	lines.push("}");
	return lines;
}

function emitAlias(
	decl: Extract<IrDeclaration, { kind: "alias" }>,
	byName: ReadonlyMap<string, IrDeclaration>
): string[] {
	// Une intersection `Base & { … }` devient une struct aplatie via `flatten`.
	if (decl.type.kind === "union") {
		const refs = decl.type.of.filter((member) => member.kind === "ref");
		const objects = decl.type.of.filter((member) => member.kind === "object");
		if (refs.length > 0 && objects.length > 0) {
			const lines = docComment(decl.doc, "/// ");
			lines.push("#[derive(Debug, Clone, Serialize, Deserialize)]");
			lines.push(`pub struct ${toPascalCase(decl.name)} {`);
			for (const [index, ref] of refs.entries()) {
				lines.push("\t#[serde(flatten)]");
				const suffix = refs.length > 1 ? `_${index}` : "";
				lines.push(`\tpub base${suffix}: ${rustType(ref, byName)},`);
			}
			for (const object of objects) {
				for (const field of (object as { fields: IrField[] }).fields) {
					lines.push(...emitField(field, byName));
				}
			}
			lines.push("}");
			return lines;
		}
	}

	if (decl.type.kind === "object") {
		return emitStruct(decl.name, decl.doc, decl.typeParams, decl.type.fields, byName);
	}

	// Union hétérogène : un alias ne peut pas l'exprimer, un enum non étiqueté si.
	if (decl.type.kind === "union") {
		const members = decl.type.of;
		const meaningful = members.filter((member) => member.kind !== "null");
		const allStringLiterals = meaningful.every(
			(member) => member.kind === "literal" && typeof member.value === "string"
		);
		if (meaningful.length > 1 && !allStringLiterals) {
			return emitUntaggedEnum(decl, members, byName);
		}
	}

	const lines = docComment(decl.doc, "/// ");
	lines.push(
		`pub type ${toPascalCase(decl.name)}${genericSuffix(decl.typeParams)} = ${rustType(decl.type, byName)};`
	);
	return lines;
}

export function emitRust(contract: IrContract): string {
	const byName = indexDeclarations(contract);
	const out: string[] = [];

	out.push(
		"// Contrat Achilléa — FICHIER GÉNÉRÉ, ne pas éditer à la main.",
		`// Source : ${contract.source}@${contract.version}`,
		"// Régénérer : bun --filter @rosegriffon/achillea-contract generate",
		"//",
		"// Dépendances attendues côté Cargo.toml :",
		'//   serde = { version = "1", features = ["derive"] }',
		'//   serde_json = "1"',
		'//   serde_repr = "0.1"',
		"",
		"#![allow(clippy::doc_markdown)]",
		"",
		"use serde::{Deserialize, Serialize};",
		"use serde_repr::{Deserialize_repr, Serialize_repr};",
		"",
		"/// Horodatage ISO 8601. Aliasé pour pouvoir basculer sur",
		"/// `chrono::DateTime<Utc>` sans retoucher le reste du fichier.",
		`pub type ${TIMESTAMP_ALIAS} = String;`,
		""
	);

	for (const decl of contract.declarations) {
		if (decl.kind === "enum") out.push(...emitEnum(decl), "");
		else if (decl.kind === "alias") out.push(...emitAlias(decl, byName), "");
		else {
			out.push(
				...emitStruct(decl.name, decl.doc, decl.typeParams, resolveFields(decl, byName), byName),
				""
			);
		}
	}

	return `${out.join("\n").trimEnd()}\n`;
}
