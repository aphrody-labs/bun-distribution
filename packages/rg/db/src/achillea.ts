/**
 * Connecteur et configuration des données Achilléa.
 *
 * UNE SEULE BASE. Achilléa a longtemps vécu dans une base `achillea` distincte,
 * exposée à `rg` par `postgres_fdw` : des tables étrangères, lisibles mais
 * jamais écrivables, et une identité coupée en deux. Depuis la fusion
 * (`scripts/ops/achillea-merge.ts`), `achillea` est un SCHÉMA de la base `rg`,
 * avec de vraies tables — le bot Achilléa y écrit, le site y lit, dans la même
 * transaction.
 */

export const ACHILLEA_SCHEMA = "achillea" as const;

export function getAchilleaDatabaseUrl(): string {
	return (
		process.env["DATABASE_URL"] ||
		process.env["ROSE_GRIFFON_DATABASE_URL"] ||
		process.env["RG_DATABASE_URL"] ||
		process.env["ACHILLEA_DATABASE_URL"] ||
		// Une seule base : le schéma `achillea` vit dans `rg`.
		"postgresql://postgres:postgres@localhost:5432/rg"
	);
}

export function getAchilleaApiUrl(): string {
	return (
		process.env["NEXT_PUBLIC_ACHILLEA_API_URL"] ||
		process.env["ACHILLEA_API_URL"] ||
		"https://api.rosegriffon.fr"
	);
}
