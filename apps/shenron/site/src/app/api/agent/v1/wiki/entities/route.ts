/**
 * GET /api/agent/v1/wiki/entities — résout une cible avant proposition.
 *
 * Le catalogue ne retourne qu'un identifiant, un libellé et l'état public d'une
 * fiche. Il ne remplace ni l'API publique de lecture ni le MCP/RAG : il évite
 * simplement à un agent de deviner la clé primaire à transmettre à la file de
 * modération.
 */
import { agentError, agentOk, readInt, withAgent } from "@/lib/agent-api";
import { listWiki } from "@/lib/wiki-admin";
import { getAgentWikiContributionContract } from "@/lib/wiki-contribution-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tables = new Map(getAgentWikiContributionContract().map((table) => [table.table, table]));

function camel(column: string): string {
	return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function label(row: Record<string, unknown>): string {
	for (const key of ["name", "title", "label", "displayName", "slug"]) {
		const value = row[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "Fiche sans libellé";
}

export async function GET(req: Request) {
	return withAgent(req, "read", async () => {
		const url = new URL(req.url);
		const tableName = url.searchParams.get("table")?.trim() ?? "";
		const table = tables.get(tableName);
		if (!table) {
			return agentError("bad_request", "`table` doit être une table du contrat de contribution.");
		}

		const limit = readInt(url.searchParams.get("limit"), { min: 1, max: 100, fallback: 25 });
		const data = await listWiki(tableName, { limit, q: url.searchParams.get("q") ?? undefined });
		const primaryKeys = (Array.isArray(table.primaryKey) ? table.primaryKey : [table.primaryKey]).map(camel);
		const rows = data.rows
			.filter((row) => row.visible !== false)
			.map((row) => ({
				rowId: primaryKeys.map((key) => String(row[key] ?? "")).join(":"),
				label: label(row),
			}));

		return agentOk({ table: tableName, rows, total: rows.length, limit });
	});
}
