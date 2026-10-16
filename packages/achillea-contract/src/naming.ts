/** Conversions de casse communes aux générateurs de code natifs. */

const ACRONYM_BOUNDARY = /([a-z\d])([A-Z])/gu;
const ACRONYM_RUN = /([A-Z]+)([A-Z][a-z])/gu;

/** `clanAvatarUrl` → `clan_avatar_url`, `xUrl` → `x_url`, `x_url` → `x_url`. */
export function toSnakeCase(name: string): string {
	return name
		.replace(ACRONYM_RUN, "$1_$2")
		.replace(ACRONYM_BOUNDARY, "$1_$2")
		.replaceAll("-", "_")
		.toLowerCase();
}

/** `single_elimination` → `SingleElimination`, `BO1` → `Bo1`. */
export function toPascalCase(name: string): string {
	return toSnakeCase(name)
		.split("_")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

/** `single_elimination` → `singleElimination`. */
export function toCamelCase(name: string): string {
	const pascal = toPascalCase(name);
	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Mots réservés Rust — un champ nommé `type` ou `ref` doit être échappé,
 * sinon le fichier généré ne compile pas.
 */
const RUST_KEYWORDS = new Set([
	"as", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false", "fn",
	"for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
	"self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while",
	"abstract", "become", "box", "do", "final", "macro", "override", "priv", "typeof", "unsized",
	"virtual", "yield", "async", "await", "try",
]);

export function rustFieldName(name: string): string {
	const snake = toSnakeCase(name);
	return RUST_KEYWORDS.has(snake) ? `r#${snake}` : snake;
}

/** Mots réservés Swift les plus courants sur des noms de champs. */
const SWIFT_KEYWORDS = new Set([
	"as", "associatedtype", "break", "case", "catch", "class", "continue", "default", "defer",
	"deinit", "do", "else", "enum", "extension", "fallthrough", "false", "for", "func", "guard",
	"if", "import", "in", "init", "inout", "internal", "is", "let", "nil", "operator", "private",
	"protocol", "public", "repeat", "rethrows", "return", "self", "static", "struct", "subscript",
	"super", "switch", "throw", "throws", "true", "try", "typealias", "var", "where", "while",
]);

export function swiftFieldName(name: string): string {
	const camel = toCamelCase(name);
	return SWIFT_KEYWORDS.has(camel) ? `\`${camel}\`` : camel;
}

const KOTLIN_KEYWORDS = new Set([
	"as", "break", "class", "continue", "do", "else", "false", "for", "fun", "if", "in", "interface",
	"is", "null", "object", "package", "return", "super", "this", "throw", "true", "try", "typealias",
	"typeof", "val", "var", "when", "while",
]);

export function kotlinFieldName(name: string): string {
	const camel = toCamelCase(name);
	return KOTLIN_KEYWORDS.has(camel) ? `\`${camel}\`` : camel;
}

/** Découpe un commentaire en lignes préfixées (`/// `, `// `, ...). */
export function docComment(doc: string | undefined, prefix: string, indent = ""): string[] {
	if (!doc) return [];
	return doc
		.split("\n")
		.map((line) => `${indent}${prefix}${line.trimEnd()}`.trimEnd())
		.filter((line) => line.length > 0);
}
