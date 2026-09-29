// SPDX-License-Identifier: Apache-2.0

/** Construit le prédicat SQL de complétude adapté au type PostgreSQL. */
export function nonEmptySql(column: string, dataType: string): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(column)) throw new Error(`Identifiant SQL invalide: ${column}`);
	const quoted = `"${column}"`;
	if (dataType === "json" || dataType === "jsonb") {
		return `${quoted} IS NOT NULL AND ${quoted}::jsonb NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb) AND (${quoted} #>> '{}') IS DISTINCT FROM ''`;
	}
	if (dataType === "ARRAY") return `${quoted} IS NOT NULL AND cardinality(${quoted}) > 0`;
	if (["text", "character varying", "character"].includes(dataType)) {
		return `${quoted} IS NOT NULL AND btrim(${quoted}::text) <> ''`;
	}
	return `${quoted} IS NOT NULL`;
}

/** Même sémantique en mémoire, utilisée par les tests et consommateurs JSON. */
export function isNonEmptyValue(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return true;
}
