/**
 * GET /api/agent/v1/wiki/contribution-schema — carte de la surface contributive.
 *
 * Une IA ne doit jamais inférer les noms de tables ou de colonnes depuis une URL
 * publique. Cette route expose exclusivement les cibles que le circuit de
 * modération accepte déjà, sans valeur de base ni accès direct au SQL.
 */
import { agentOk, withAgent } from "@/lib/agent-api";
import {
	AGENT_WIKI_DYNAMIC_TARGETS,
	getAgentWikiContributionContract,
} from "@/lib/wiki-contribution-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	return withAgent(req, "read", async () =>
		agentOk({
			version: 1,
			tables: getAgentWikiContributionContract(),
			dynamicTargets: AGENT_WIKI_DYNAMIC_TARGETS,
			rules: {
				writeMode: "proposal_only",
				sources: "Citer tome + planche, databook + page ou interview datée. Les wikis tiers ne sont pas des sources.",
				workflow: "Lire la fiche publique, déposer une proposition, puis attendre la relecture humaine.",
			},
		})
	);
}
