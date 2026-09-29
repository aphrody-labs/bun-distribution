/**
 * /api/agent/v1/wiki/contributions — un agent **propose** une correction du wiki.
 *
 *   GET  ?status=pending     → file de modération (portée `moderate`)
 *   POST { table, rowId, column, valueAfter, sources? }
 *                            → dépose une proposition (portée `contribute`)
 *
 * Pourquoi c'est la bonne porte pour une IA : une proposition n'écrit RIEN dans
 * le wiki. Elle entre dans la même file que celles des membres, avec le diff et
 * les sources, et un modérateur humain tranche. Un agent peut donc travailler en
 * continu sur la documentation sans qu'une hallucination atteigne une fiche
 * publique — et son crédit est visible comme celui d'un contributeur humain.
 *
 * L'acceptation reste volontairement hors API : elle passe par `/admin/wiki`,
 * parce qu'accepter, c'est écrire.
 */
import {
	ContributionError,
	createContribution,
	listContributions,
} from "@/lib/wiki-contributions";
import { CONTRIBUTION_MAX } from "@/lib/contributions-shared";
import { agentError, agentOk, readInt, readJsonBody, withAgent } from "@/lib/agent-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	// Lire la file, c'est lire du contenu non relu : portée de modération exigée,
	// pas `read`.
	return withAgent(req, "moderate", async () => {
		const url = new URL(req.url);
		const status = url.searchParams.get("status") ?? "pending";
		if (!["pending", "accepted", "rejected", "superseded", "withdrawn"].includes(status)) {
			return agentError("bad_request", "`status` invalide.");
		}
		const limit = readInt(url.searchParams.get("limit"), { min: 1, max: 100, fallback: 50 });
		const data = await listContributions({
			status: status as "pending",
			limit,
		});
		return agentOk(data);
	});
}

export async function POST(req: Request) {
	return withAgent(req, "contribute", async ({ agent, setSummary }) => {
		const body = await readJsonBody(req);

		const table = typeof body.table === "string" ? body.table.trim() : "";
		const rowId =
			typeof body.rowId === "string" || typeof body.rowId === "number"
				? String(body.rowId).trim()
				: "";
		const column = typeof body.column === "string" ? body.column.trim() : "";
		const valueAfter = typeof body.valueAfter === "string" ? body.valueAfter : "";

		if (!table || !rowId || !column) {
			return agentError("bad_request", "`table`, `rowId` et `column` sont requis.");
		}
		if (!valueAfter.trim()) {
			return agentError("bad_request", "`valueAfter` est requis — la valeur proposée.");
		}
		if (valueAfter.length > CONTRIBUTION_MAX) {
			return agentError("bad_request", `\`valueAfter\` dépasse ${CONTRIBUTION_MAX} caractères.`);
		}

		// Une proposition d'agent SANS source est acceptée mais signalée comme telle :
		// la doctrine du projet interdit d'inventer une donnée éditoriale, et un
		// modérateur doit voir d'un coup d'œil ce qui n'est pas sourcé.
		const sources = typeof body.sources === "string" ? body.sources : null;
		const comment = typeof body.comment === "string" ? body.comment : null;

		try {
			const created = await createContribution({
				table,
				rowId,
				column,
				valueAfter,
				comment,
				sources,
				entityPath: typeof body.path === "string" ? body.path : null,
				// `wiki_contributions.authorId` n'est pas une clé étrangère : on y écrit
				// une identité d'agent préfixée, non confondable avec un `User.id`.
				author: { id: `agent:${agent.keyId}`, name: agent.name, discordId: null },
			});
			setSummary(`contribution ${created.id} sur ${table}#${rowId}.${column}`);
			return agentOk({ id: created.id, status: created.status, sourced: Boolean(sources) }, 201);
		} catch (err) {
			if (err instanceof ContributionError) {
				return agentError(err.code === "not_found" ? "not_found" : "bad_request", err.message);
			}
			throw err;
		}
	});
}
