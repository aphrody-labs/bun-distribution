/**
 * Représentation intermédiaire du contrat Achilléa.
 *
 * L'extraction TypeScript produit cette IR ; chaque générateur (JSON Schema,
 * Rust, Swift, Kotlin) ne connaît que l'IR. Ajouter un langage cible = ajouter
 * un émetteur, sans retoucher l'extraction.
 */

export type IrType =
	| { kind: "string" }
	| { kind: "number" }
	| { kind: "integer" }
	| { kind: "boolean" }
	| { kind: "null" }
	| { kind: "unknown" }
	/** `Date` côté TypeScript — sérialisé en ISO 8601 sur le réseau. */
	| { kind: "date" }
	| { kind: "literal"; value: string | number | boolean }
	/** Référence nommée vers une autre déclaration du contrat. */
	| { kind: "ref"; name: string; args: IrType[] }
	/** Paramètre générique de la déclaration englobante. */
	| { kind: "param"; name: string }
	| { kind: "array"; of: IrType }
	| { kind: "tuple"; of: IrType[] }
	| { kind: "union"; of: IrType[] }
	| { kind: "map"; key: IrType; value: IrType }
	| { kind: "object"; fields: IrField[] };

export interface IrField {
	name: string;
	type: IrType;
	optional: boolean;
	doc?: string;
}

export interface IrInterface {
	kind: "interface";
	name: string;
	typeParams: string[];
	/** Interfaces dont celle-ci hérite (aplaties par les émetteurs). */
	extends: Array<{ name: string; args: IrType[] }>;
	fields: IrField[];
	doc?: string;
}

export interface IrEnumMember {
	name: string;
	value: string | number;
	doc?: string;
}

export interface IrEnum {
	kind: "enum";
	name: string;
	/** `string` si toutes les valeurs sont des chaînes, sinon `number`. */
	valueType: "string" | "number";
	members: IrEnumMember[];
	doc?: string;
}

export interface IrAlias {
	kind: "alias";
	name: string;
	typeParams: string[];
	type: IrType;
	doc?: string;
}

export type IrDeclaration = IrInterface | IrEnum | IrAlias;

export interface IrContract {
	/** Nom du paquet source, pour l'en-tête des fichiers générés. */
	source: string;
	version: string;
	declarations: IrDeclaration[];
}

/** Index nom → déclaration, pour la résolution pendant l'émission. */
export function indexDeclarations(contract: IrContract): Map<string, IrDeclaration> {
	return new Map(contract.declarations.map((decl) => [decl.name, decl]));
}

export function isEnum(decl: IrDeclaration | undefined): decl is IrEnum {
	return decl?.kind === "enum";
}

export function isInterface(decl: IrDeclaration | undefined): decl is IrInterface {
	return decl?.kind === "interface";
}

export function isAlias(decl: IrDeclaration | undefined): decl is IrAlias {
	return decl?.kind === "alias";
}
