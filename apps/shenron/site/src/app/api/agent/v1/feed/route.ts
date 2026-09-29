/**
 * GET /api/agent/v1/feed — le fil d'actualité du site, en JSON.
 *
 * Même fonction que la page publique (`lib/feed.ts`), donc mêmes règles de
 * visibilité : un agent ne voit pas un article programmé, une fiche masquée ou un
 * commentaire retiré. C'est ce qui permet d'exposer le fil sans audit
 * supplémentaire — il n'y a pas de « vue agent » à maintenir en parallèle.
 *
 * Portée requise : `read`.
 */
import { agentError, agentOk, readInt, withAgent } from "@/lib/agent-api";
import { isFeedFilter, listFeed } from "@/lib/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	return withAgent(req, "read", async () => {
		const url = new URL(req.url);
		const filterParam = url.searchParams.get("filter") ?? "tout";
		if (!isFeedFilter(filterParam)) {
			return agentError("bad_request", "Filtre inconnu (tout|articles|wiki|communaute|discussions).");
		}
		const page = readInt(url.searchParams.get("page"), { min: 1, max: 25, fallback: 1 });
		const perPage = readInt(url.searchParams.get("perPage"), { min: 5, max: 50, fallback: 20 });

		const data = await listFeed({ filter: filterParam, page, perPage });
		return agentOk(data);
	});
}
