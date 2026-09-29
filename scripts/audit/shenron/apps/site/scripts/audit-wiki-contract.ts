#!/usr/bin/env bun
/**
 * Vérifie que le contrat TypeScript du wiki correspond encore au schéma SQL.
 *
 * Le même registre `WIKI_TABLE_SPECS` pilote le studio, les API d'admin et le
 * contrat des agents. Une table ou colonne renommée dans PostgreSQL ne doit
 * jamais être découverte à la première contribution : ce script compare chaque
 * clé primaire et chaque champ mutable à `information_schema` et échoue avec
 * toutes les divergences détectées.
 *
 * Usage: bun apps/site/scripts/audit-wiki-contract.ts [--json]
 */
import { join } from "node:path";
import postgres from "postgres";
import { WIKI_TABLE_SPECS } from "../src/lib/wiki-tables";

function snake(name: string): string {
	return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

async function databaseUrl(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const remote = await Bun.file(join(import.meta.dir, "../../../.env.remote-db"))
		.text()
		.catch(() => "");
	const remoteLine = remote
		.split("\n")
		.findLast((value) => value.startsWith("REMOTE_DATABASE_URL="));
	const remoteValue = remoteLine
		?.slice("REMOTE_DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (remoteValue) return remoteValue;
	const env = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	// Le fichier local peut conserver une ancienne URL avant celle qui est active :
	// comme les scripts de maintenance récents, la dernière déclaration gagne.
	const line = env.split("\n").findLast((value) => value.startsWith("DATABASE_URL="));
	const value = line
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable.");
	return value;
}

interface TableAudit {
	table: string;
	columns: number;
	missingPrimaryKey: string[];
	missingMutableColumns: string[];
}

const sql = postgres(await databaseUrl(), { max: 2, prepare: false });

try {
	const audits: TableAudit[] = [];
	for (const [table, spec] of Object.entries(WIKI_TABLE_SPECS)) {
		const rows = await sql<{ column_name: string }[]>`
			SELECT column_name
			FROM information_schema.columns
			WHERE table_schema = 'bot' AND table_name = ${table}
		`;
		const columns = new Set(rows.map((row) => row.column_name));
		const primaryKeys = (Array.isArray(spec.pk) ? spec.pk : [spec.pk]).map(snake);
		const mutableColumns = spec.mutableColumns.map(snake);
		audits.push({
			table,
			columns: columns.size,
			missingPrimaryKey: primaryKeys.filter((column) => !columns.has(column)),
			missingMutableColumns: mutableColumns.filter((column) => !columns.has(column)),
		});
	}

	const invalid = audits.filter(
		(audit) =>
			audit.columns === 0 ||
			audit.missingPrimaryKey.length > 0 ||
			audit.missingMutableColumns.length > 0
	);
	const report = {
		schema: "shenron-wiki-contract/v1",
		generatedAt: new Date().toISOString(),
		tables: audits,
		ok: invalid.length === 0,
	};

	if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
	else {
		for (const audit of audits) {
			const issues = [
				...(audit.columns === 0 ? ["table absente"] : []),
				...audit.missingPrimaryKey.map((column) => `PK absente: ${column}`),
				...audit.missingMutableColumns.map((column) => `champ absent: ${column}`),
			];
			console.log(
				`${issues.length ? "✗" : "✓"} ${audit.table} — ${audit.columns} colonnes${issues.length ? ` — ${issues.join(", ")}` : ""}`
			);
		}
	}

	if (invalid.length) {
		process.exitCode = 1;
		console.error(`\n${invalid.length} table(s) divergent du contrat wiki.`);
	}
} catch (error) {
	// Pas de trace qui pourrait contenir une URL de connexion ; le détail PostgreSQL
	// suffit à l'opérateur pour renouveler l'accès ou injecter DATABASE_URL en CI.
	const message = error instanceof Error ? error.message : "erreur de connexion inconnue";
	console.error(`Audit SQL du contrat wiki impossible : ${message}`);
	process.exitCode = 1;
} finally {
	await sql.end();
}
