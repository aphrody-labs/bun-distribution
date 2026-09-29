/**
 * GET /api/agent/v1/whoami — la première requête qu'un agent devrait faire.
 *
 * Elle répond « qui suis-je, que m'autorise-t-on, combien d'écritures me
 * reste-t-il ». Sans elle, un agent découvre ses portées manquantes à la
 * première écriture refusée, au milieu d'une tâche — et un opérateur humain n'a
 * aucun moyen de vérifier qu'il a collé le bon jeton.
 */
import { agentCallsLastHour } from "@/lib/agent-keys";
import { agentOk, withAgent } from "@/lib/agent-api";
import { AGENT_SCOPES } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	return withAgent(req, "read", async ({ agent }) => {
		const used = await agentCallsLastHour(agent.keyId);
		return agentOk({
			name: agent.name,
			scopes: agent.scopes,
			/** Toutes les portées existantes — pour qu'un agent sache quoi demander. */
			availableScopes: AGENT_SCOPES,
			rateLimit: {
				perHour: agent.rateLimitPerHour,
				used,
				remaining: Math.max(0, agent.rateLimitPerHour - used),
			},
			docs: "/api/agent/v1/openapi.json",
			openapi: "/api/agent/v1/openapi.json",
			wikiContributionSchema: "/api/agent/v1/wiki/contribution-schema",
			wikiContributionTargets: "/api/agent/v1/wiki/entities?table=db_characters",
		});
	});
}
