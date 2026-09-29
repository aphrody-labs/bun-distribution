#!/usr/bin/env bun
/**
 * Synchronise la configuration du Canon (singleton 'default' dans public."CanonConfig")
 * avec la doctrine exhaustive du dépôt.
 */
import postgres from "postgres";
import { join } from "node:path";
import { DEFAULT_CANON_CONFIG, resolveCanonConfig } from "../src/lib/canon-engine";

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const valeur = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DATABASE_URL introuvable");
	return valeur;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });

const resolved = resolveCanonConfig(DEFAULT_CANON_CONFIG);
// Conserver uniquement les références manuelles dans le blob
const data = {
	...resolved,
	references: resolved.references.filter((r) => r.provenance === "manuel"),
};

await sql`
	insert into public."CanonConfig" (id, data, "updatedBy", "updatedAt")
	values ('default', ${sql.json(data as unknown as Parameters<typeof sql.json>[0])}, 'canon-sync-config', now())
	on conflict (id) do update set
		data = excluded.data,
		"updatedBy" = excluded."updatedBy",
		"updatedAt" = now()
`;

console.log(
	`✓ CanonConfig synchronisé avec succès : ${resolved.entries.length} sujets tranchés, ${resolved.heuristics.length} heuristiques.`
);

await sql.end();
