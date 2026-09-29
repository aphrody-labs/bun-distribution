/**
 * Extraction du contrat : sources TypeScript de `@rosegriffon/achillea-types`
 * → IR.
 *
 * Lecture syntaxique volontaire (AST, pas type-checker). Le paquet de contrat
 * est délibérément contraint — `interface`, `type`, `enum`, zéro dépendance —
 * ce qui rend l'AST suffisant et rend l'échec lisible : toute construction
 * exotique introduite par mégarde lève ici, au lieu d'être silencieusement
 * aplatie en `unknown` dans le Rust généré.
 */

import { isAbsolute, join, relative, resolve, sep } from "node:path";

import ts from "@typescript/typescript6";

import type {
	IrContract,
	IrDeclaration,
	IrEnum,
	IrEnumMember,
	IrField,
	IrInterface,
	IrAlias,
	IrType,
} from "./ir";

export class ContractExtractionError extends Error {
	constructor(
		message: string,
		readonly file: string,
		readonly line: number
	) {
		super(`${message} (${file}:${line})`);
		this.name = "ContractExtractionError";
	}
}

function fail(node: ts.Node, message: string): never {
	const source = node.getSourceFile() as ts.SourceFile | undefined;
	if (!source) throw new ContractExtractionError(message, "<inconnu>", 0);
	const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
	throw new ContractExtractionError(message, source.fileName, line + 1);
}

/** Commentaire JSDoc d'une déclaration, réduit à son texte. */
function docOf(node: ts.Node): string | undefined {
	const jsDoc = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
	const comment = jsDoc?.at(-1)?.comment;
	if (!comment) return undefined;
	const text = typeof comment === "string" ? comment : comment.map((part) => part.text).join("");
	return text.replaceAll("\r\n", "\n").trim() || undefined;
}

/**
 * `true` si la déclaration porte `@integer` en JSDoc.
 *
 * TypeScript n'a qu'un `number` (un double). Pour les cibles natives, la
 * distinction entier / flottant compte : ce tag la rend explicite, sans deviner
 * à partir du nom du champ.
 */
function hasIntegerTag(node: ts.Node): boolean {
	return ts.getJSDocTags(node).some((tag) => ts.idText(tag.tagName) === "integer");
}

/** Nom d'un membre (`foo`, `"foo"`, `[Symbol]` refusé). */
function nameOf(node: ts.PropertyName | ts.BindingName): string {
	if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return ts.idText(node);
	if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
	return fail(node, "nom de membre non pris en charge");
}

/** Nom qualifié d'une référence de type (`A`, `A.B`). */
function entityNameOf(node: ts.EntityName): string {
	return ts.isIdentifier(node)
		? ts.idText(node)
		: `${entityNameOf(node.left)}.${ts.idText(node.right)}`;
}

/** `Record<K, V>` et `Readonly<T>` sont les seuls utilitaires tolérés. */
const PASSTHROUGH_UTILITIES = new Set(["Readonly", "ReadonlyArray", "Array"]);

interface Scope {
	typeParams: ReadonlySet<string>;
	/** Alias d'unions de littéraux, pour résoudre `Exclude<A, B>`. */
	literalUnions: ReadonlyMap<string, IrType[]>;
}

function toIrType(node: ts.TypeNode, scope: Scope): IrType {
	if (ts.isParenthesizedTypeNode(node)) return toIrType(node.type, scope);

	switch (node.kind) {
		case ts.SyntaxKind.StringKeyword:
			return { kind: "string" };
		case ts.SyntaxKind.NumberKeyword:
			return { kind: "number" };
		case ts.SyntaxKind.BooleanKeyword:
			return { kind: "boolean" };
		case ts.SyntaxKind.NullKeyword:
			return { kind: "null" };
		case ts.SyntaxKind.UndefinedKeyword:
			return { kind: "null" };
		case ts.SyntaxKind.UnknownKeyword:
		case ts.SyntaxKind.AnyKeyword:
		case ts.SyntaxKind.ObjectKeyword:
			return { kind: "unknown" };
		default:
			break;
	}

	if (ts.isArrayTypeNode(node)) return { kind: "array", of: toIrType(node.elementType, scope) };
	if (ts.isTupleTypeNode(node))
		return { kind: "tuple", of: node.elements.map((element) => toIrType(element, scope)) };

	if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
		return toIrType(node.type, scope);
	}

	if (ts.isLiteralTypeNode(node)) {
		const literal = node.literal;
		if (ts.isStringLiteral(literal)) return { kind: "literal", value: literal.text };
		if (ts.isNumericLiteral(literal)) return { kind: "literal", value: Number(literal.text) };
		if (literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true };
		if (literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false };
		if (literal.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
		fail(node, "littéral de type non pris en charge");
	}

	if (ts.isUnionTypeNode(node)) {
		return { kind: "union", of: node.types.map((member) => toIrType(member, scope)) };
	}

	if (ts.isIntersectionTypeNode(node)) {
		// `A & { … }` : on conserve les membres, l'émetteur les aplatit.
		const parts = node.types.map((member) => toIrType(member, scope));
		const fields: IrField[] = [];
		const refs: IrType[] = [];
		for (const part of parts) {
			if (part.kind === "object") fields.push(...part.fields);
			else refs.push(part);
		}
		if (refs.length === 0) return { kind: "object", fields };
		if (fields.length === 0 && refs.length === 1) return refs[0] as IrType;
		return { kind: "union", of: [...refs, { kind: "object", fields }] };
	}

	if (ts.isTypeLiteralNode(node)) {
		return { kind: "object", fields: membersToFields(node.members, scope) };
	}

	if (ts.isTypeReferenceNode(node)) {
		const name = entityNameOf(node.typeName);
		const args = node.typeArguments?.map((arg) => toIrType(arg, scope)) ?? [];

		if (scope.typeParams.has(name)) return { kind: "param", name };
		if (name === "Date") return { kind: "date" };
		if (name === "Record") {
			const [key, value] = args;
			return { kind: "map", key: key ?? { kind: "string" }, value: value ?? { kind: "unknown" } };
		}
		if (name === "Array" || name === "ReadonlyArray") {
			return { kind: "array", of: args[0] ?? { kind: "unknown" } };
		}
		if (name === "Exclude") return excludeType(node, args, scope);
		// `Omit`/`Pick` ne sont résolus qu'en position d'héritage, où l'on sait
		// sur quelle déclaration les appliquer. Ailleurs, on échoue bruyamment
		// plutôt que d'émettre un type Rust qui ne compilerait pas.
		if (name === "Omit" || name === "Pick") {
			fail(node, `${name} n'est pris en charge qu'en clause d'héritage (extends)`);
		}
		if (PASSTHROUGH_UTILITIES.has(name)) return args[0] ?? { kind: "unknown" };

		return { kind: "ref", name, args };
	}

	return fail(node, `construction de type non prise en charge (${ts.SyntaxKind[node.kind]})`);
}

/** `Exclude<Union, Retirés>` sur des unions de littéraux. */
function excludeType(node: ts.TypeNode, args: IrType[], scope: Scope): IrType {
	const [source, removed] = args;
	if (!source || !removed) fail(node, "Exclude attend deux arguments");

	const members =
		source.kind === "union"
			? source.of
			: source.kind === "ref"
				? (scope.literalUnions.get(source.name) ?? null)
				: null;
	if (!members) fail(node, "Exclude n'est pris en charge que sur une union de littéraux");

	const excluded = new Set(
		(removed.kind === "union" ? removed.of : [removed])
			.filter((member) => member.kind === "literal")
			.map((member) => String((member as { value: unknown }).value))
	);

	const kept = members.filter(
		(member) => member.kind !== "literal" || !excluded.has(String(member.value))
	);
	return kept.length === 1 ? (kept[0] as IrType) : { kind: "union", of: kept };
}

function membersToFields(members: ts.NodeArray<ts.TypeElement>, scope: Scope): IrField[] {
	const fields: IrField[] = [];
	for (const member of members) {
		if (ts.isIndexSignatureDeclaration(member)) continue;
		if (!ts.isPropertySignature(member)) fail(member, "seules les propriétés sont acceptées");
		if (!member.type) fail(member, "propriété sans annotation de type");

		const type = toIrType(member.type, scope);
		fields.push({
			name: nameOf(member.name),
			type: type.kind === "number" && hasIntegerTag(member) ? { kind: "integer" } : type,
			optional: Boolean(member.questionToken),
			doc: docOf(member),
		});
	}
	return fields;
}

function enumToIr(node: ts.EnumDeclaration): IrEnum {
	const members: IrEnumMember[] = [];
	let implicit = 0;
	let hasString = false;

	for (const member of node.members) {
		const name = nameOf(member.name);
		const initializer = member.initializer;

		if (!initializer) {
			members.push({ name, value: implicit, doc: docOf(member) });
			implicit += 1;
			continue;
		}
		if (ts.isStringLiteral(initializer)) {
			hasString = true;
			members.push({ name, value: initializer.text, doc: docOf(member) });
			continue;
		}
		if (ts.isNumericLiteral(initializer)) {
			const value = Number(initializer.text);
			members.push({ name, value, doc: docOf(member) });
			implicit = value + 1;
			continue;
		}
		fail(member, "valeur d'enum non littérale");
	}

	return {
		kind: "enum",
		name: node.name.text,
		valueType: hasString ? "string" : "number",
		members,
		doc: docOf(node),
	};
}

function interfaceToIr(
	node: ts.InterfaceDeclaration,
	literalUnions: Map<string, IrType[]>
): IrInterface {
	const typeParams = node.typeParameters?.map((param) => param.name.text) ?? [];
	const scope: Scope = { typeParams: new Set(typeParams), literalUnions };

	const heritage: Array<{ name: string; args: IrType[] }> = [];
	for (const clause of node.heritageClauses ?? []) {
		for (const type of clause.types) {
			heritage.push({
				name: ts.isIdentifier(type.expression)
					? ts.idText(type.expression)
					: fail(type, "héritage non nommé"),
				args: type.typeArguments?.map((arg) => toIrType(arg, scope)) ?? [],
			});
		}
	}

	return {
		kind: "interface",
		name: node.name.text,
		typeParams,
		extends: heritage,
		fields: membersToFields(node.members, scope),
		doc: docOf(node),
	};
}

function aliasToIr(node: ts.TypeAliasDeclaration, literalUnions: Map<string, IrType[]>): IrAlias {
	const typeParams = node.typeParameters?.map((param) => param.name.text) ?? [];
	return {
		kind: "alias",
		name: node.name.text,
		typeParams,
		type: toIrType(node.type, { typeParams: new Set(typeParams), literalUnions }),
		doc: docOf(node),
	};
}

function isExported(node: ts.Node): boolean {
	return (
		ts.canHaveModifiers(node) &&
		Boolean(ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
	);
}

export interface ExtractOptions {
	/** Racine des sources du contrat (dossier `src` de `@…/achillea-types`). */
	root: string;
	source?: string;
	version?: string;
}

/** Lit toutes les sources `.ts` du contrat et produit l'IR. */
export function extractContract(options: ExtractOptions): IrContract {
	const root = resolve(options.root);
	const program = ts.createProgram({
		rootNames: [join(root, "index.ts")],
		options: {
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			noEmit: true,
			skipLibCheck: true,
		},
	});

	const sources = program.getSourceFiles().filter((file) => {
		if (file.isDeclarationFile) return false;
		const pathFromRoot = relative(root, resolve(file.fileName));
		return (
			pathFromRoot !== "" &&
			pathFromRoot !== ".." &&
			!pathFromRoot.startsWith(`..${sep}`) &&
			!isAbsolute(pathFromRoot)
		);
	});

	// Première passe : collecter les unions de littéraux, requises par `Exclude`.
	const literalUnions = new Map<string, IrType[]>();
	for (const file of sources) {
		for (const statement of file.statements) {
			if (!ts.isTypeAliasDeclaration(statement) || !ts.isUnionTypeNode(statement.type)) continue;
			const members = statement.type.types;
			if (!members.every((member) => ts.isLiteralTypeNode(member))) continue;
			literalUnions.set(
				statement.name.text,
				members.map((member) => toIrType(member, { typeParams: new Set(), literalUnions }))
			);
		}
	}

	const byName = new Map<string, IrDeclaration>();
	for (const file of sources) {
		for (const statement of file.statements) {
			if (!isExported(statement)) continue;
			if (ts.isEnumDeclaration(statement)) byName.set(statement.name.text, enumToIr(statement));
			else if (ts.isInterfaceDeclaration(statement)) {
				byName.set(statement.name.text, interfaceToIr(statement, literalUnions));
			} else if (ts.isTypeAliasDeclaration(statement)) {
				byName.set(statement.name.text, aliasToIr(statement, literalUnions));
			}
		}
	}

	const declarations = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
	return {
		source: options.source ?? "@rosegriffon/achillea-types",
		version: options.version ?? "0.0.0",
		declarations,
	};
}
