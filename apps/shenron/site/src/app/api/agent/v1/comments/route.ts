/**
 * /api/agent/v1/comments — un agent lit et écrit dans les discussions.
 *
 *   GET  ?target=post:<id>&page=1   → le fil, tel qu'un visiteur le voit
 *   POST { target, body, parentId? } → publie un message signé du nom de l'agent
 *
 * Le message est **toujours signé** : `agentName` est renseigné côté base et
 * l'interface affiche un marqueur « agent » à côté du pseudo. Un assistant qui
 * répond à une question sur une fiche est utile ; un assistant qui se fait passer
 * pour un membre ne l'est pas.
 *
 * Portées : `read` pour lire, `comment` pour écrire, `moderate` pour masquer.
 */
import {
	createComment,
	listComments,
	moderateComment,
	SocialError,
	type SocialActor,
} from "@/lib/social";
import { parseTarget, type CommentSort, isCommentSort } from "@/lib/social-shared";
import { agentError, agentOk, readInt, readJsonBody, withAgent } from "@/lib/agent-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	return withAgent(req, "read", async () => {
		const url = new URL(req.url);
		const target = parseTarget(url.searchParams.get("target"));
		if (!target) {
			return agentError("bad_request", "`target` attendu sous la forme `post:<id>`.");
		}
		const sortParam = url.searchParams.get("sort");
		const sort: CommentSort = isCommentSort(sortParam) ? sortParam : "recent";
		const page = readInt(url.searchParams.get("page"), { min: 1, max: 500, fallback: 1 });

		// Aucun `viewerId` : un agent n'a pas d'état « j'aime » personnel, et ne doit
		// pas voir les messages masqués par la modération.
		const data = await listComments(target, { page, sort, viewerId: null });
		return agentOk(data);
	});
}

export async function POST(req: Request) {
	return withAgent(req, "comment", async ({ agent, setSummary }) => {
		const body = await readJsonBody(req);
		const target = parseTarget(typeof body.target === "string" ? body.target : null);
		if (!target) {
			return agentError("bad_request", "`target` attendu sous la forme `post:<id>`.");
		}
		const text = typeof body.body === "string" ? body.body : "";
		if (!text.trim()) return agentError("bad_request", "`body` est requis.");

		const actor: SocialActor = {
			type: "agent",
			name: agent.name,
			canModerate: agent.scopes.includes("moderate"),
		};

		try {
			const comment = await createComment({
				target,
				body: text,
				parentId: typeof body.parentId === "string" ? body.parentId : null,
				actor,
			});
			setSummary(`commentaire ${comment.id} sur ${target.kind}:${target.id}`);
			return agentOk({ id: comment.id, createdAt: comment.createdAt }, 201);
		} catch (err) {
			if (err instanceof SocialError) {
				return agentError(err.status === 404 ? "not_found" : "bad_request", err.code);
			}
			throw err;
		}
	});
}

export async function PATCH(req: Request) {
	return withAgent(req, "moderate", async ({ agent, setSummary }) => {
		const body = await readJsonBody(req);
		const id = typeof body.id === "string" ? body.id : "";
		const action = typeof body.action === "string" ? body.action : "";
		if (!id || !["hide", "restore", "pin", "unpin"].includes(action)) {
			return agentError("bad_request", "`id` et `action` (hide|restore|pin|unpin) sont requis.");
		}

		try {
			await moderateComment(id, action as "hide" | "restore" | "pin" | "unpin", {
				type: "agent",
				name: agent.name,
				canModerate: true,
			});
			setSummary(`modération ${action} sur ${id}`);
			return agentOk({ id, action });
		} catch (err) {
			if (err instanceof SocialError) {
				return agentError(err.status === 404 ? "not_found" : "bad_request", err.code);
			}
			throw err;
		}
	});
}
