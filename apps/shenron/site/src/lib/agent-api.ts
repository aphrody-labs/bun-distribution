/**
 * agent-api — garde commune des routes `/api/agent/v1/*`.
 *
 * Une route d'agent a toujours la même séquence : authentifier la clé, vérifier
 * la portée, appliquer le quota, exécuter, journaliser. Écrire cette séquence
 * dans chaque route garantissait qu'un jour l'une d'elles oublierait le quota ou
 * l'audit. `withAgent()` la tient à un seul endroit.
 *
 * Forme de réponse unique, pour que n'importe quel agent puisse la traiter sans
 * cas particulier :
 *   succès → `{ ok: true, data: … }`
 *   échec  → `{ ok: false, error: "<code>", message: "<phrase>" }`
 *
 * Server-only.
 */
import "server-only";
import type { AgentScope } from "@/db/schema";
import {
	agentCallsLastHour,
	authenticateAgent,
	recordAgentCall,
	type AgentIdentity,
} from "@/lib/agent-keys";

/** Codes d'erreur de l'API agents, avec leur phrase et leur statut HTTP. */
const ERRORS = {
	auth_required: { status: 401, message: "Jeton d'agent manquant ou invalide." },
	scope_missing: { status: 403, message: "Portée insuffisante pour cette opération." },
	rate_limited: { status: 429, message: "Quota horaire atteint pour cette clé." },
	bad_request: { status: 400, message: "Requête invalide." },
	not_found: { status: 404, message: "Ressource introuvable." },
	conflict: { status: 409, message: "Conflit avec l'état actuel de la ressource." },
	server_error: { status: 500, message: "Erreur interne." },
} as const;

export type AgentErrorCode = keyof typeof ERRORS;

export function agentError(code: AgentErrorCode, detail?: string): Response {
	const e = ERRORS[code];
	return Response.json(
		{ ok: false, error: code, message: detail ? `${e.message} ${detail}` : e.message },
		{ status: e.status, headers: { "Cache-Control": "private, no-store" } }
	);
}

export function agentOk(data: unknown, status = 200): Response {
	return Response.json(
		{ ok: true, data },
		{ status, headers: { "Cache-Control": "private, no-store" } }
	);
}

/** Erreur levée par un handler pour court-circuiter avec un code normalisé. */
export class AgentApiError extends Error {
	constructor(
		readonly code: AgentErrorCode,
		readonly detail?: string
	) {
		super(code);
		this.name = "AgentApiError";
	}
}

/** Un rejet anonyme sur `ANONYMOUS_REJECTION_SAMPLE` est journalisé (le premier aussi). */
const ANONYMOUS_REJECTION_SAMPLE = 1000;

let anonymousRejections = 0;

/** Rejets 401 anonymes depuis le démarrage du processus (S8, observabilité). */
export function anonymousRejectionCount(): number {
	return anonymousRejections;
}

/** Remet le compteur à zéro (tests uniquement). */
export function resetAnonymousRejections(): void {
	anonymousRejections = 0;
}

function noteAnonymousRejection(method: string, path: string): void {
	anonymousRejections += 1;
	if (anonymousRejections === 1 || anonymousRejections % ANONYMOUS_REJECTION_SAMPLE === 0) {
		console.warn(
			`[agent-api] ${anonymousRejections} rejet(s) anonyme(s) 401 depuis le démarrage (dernier : ${method.slice(0, 10)} ${path.slice(0, 300)})`
		);
	}
}

export interface AgentContext {
	agent: AgentIdentity;
	/** Ce que le handler écrit ici part dans l'audit (slug créé, id…). */
	setSummary: (summary: string) => void;
}

/**
 * Exécute un handler d'agent sous garde complète.
 *
 * `scope` est la portée exigée. `read` est exigée implicitement par les routes de
 * lecture ; une clé sans aucune portée ne peut donc rien faire, même lire.
 */
export async function withAgent(
	req: Request,
	scope: AgentScope,
	handler: (ctx: AgentContext) => Promise<Response>
): Promise<Response> {
	const url = new URL(req.url);
	const path = url.pathname;
	let summary: string | null = null;

	const agent = await authenticateAgent(req);
	if (!agent) {
		// S8 : un 401 anonyme n'écrit plus de ligne `agent_audit` (le trafic
		// anonyme se traduisait en écritures SQL) ; compteur en mémoire échantillonné.
		noteAnonymousRejection(req.method, path);
		return agentError("auth_required");
	}

	if (!agent.scopes.includes(scope)) {
		await recordAgentCall({
			keyId: agent.keyId,
			keyName: agent.name,
			method: req.method,
			path,
			status: 403,
			summary: `portée ${scope} absente`,
		});
		return agentError("scope_missing", `Portée requise : ${scope}.`);
	}

	// Le quota ne porte que sur les écritures : compter les lectures pénaliserait
	// un agent qui pagine un catalogue, sans rien protéger (la lecture est déjà
	// publique par ailleurs).
	if (req.method !== "GET" && req.method !== "HEAD") {
		const used = await agentCallsLastHour(agent.keyId);
		if (used >= agent.rateLimitPerHour) {
			await recordAgentCall({
				keyId: agent.keyId,
				keyName: agent.name,
				method: req.method,
				path,
				status: 429,
				summary: `quota ${used}/${agent.rateLimitPerHour}`,
			});
			return agentError("rate_limited");
		}
	}

	let response: Response;
	try {
		response = await handler({
			agent,
			setSummary: (s) => {
				summary = s;
			},
		});
	} catch (err) {
		if (err instanceof AgentApiError) {
			response = agentError(err.code, err.detail);
		} else {
			console.error(`[agent-api] ${req.method} ${path}`, err);
			response = agentError("server_error");
		}
	}

	void recordAgentCall({
		keyId: agent.keyId,
		keyName: agent.name,
		method: req.method,
		path,
		status: response.status,
		summary,
	}).catch((err) => console.error("[agent-api] audit log failed", err));
	return response;
}

/** Lit un corps JSON en objet. Refuse tout ce qui n'est pas un objet. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
	let parsed: unknown;
	try {
		parsed = await req.json();
	} catch {
		throw new AgentApiError("bad_request", "Corps JSON illisible.");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new AgentApiError("bad_request", "Un objet JSON est attendu.");
	}
	return parsed as Record<string, unknown>;
}

/** Lit un entier de requête borné (pagination). */
export function readInt(
	value: string | null,
	opts: { min: number; max: number; fallback: number }
): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return opts.fallback;
	return Math.min(opts.max, Math.max(opts.min, Math.trunc(n)));
}
