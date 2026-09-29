/**
 * agent-keys — jetons d'accès des agents à l'API d'écriture du site.
 *
 * Pourquoi une table plutôt qu'une variable d'environnement : le site doit
 * pouvoir être alimenté par plusieurs agents (ingest canon, traducteur
 * databooks, rédacteur assisté, MCP d'un tiers) avec des droits DIFFÉRENTS et
 * révocables un par un. `SHENRON_ADMIN_TOKEN` ouvre tout — Discord, économie,
 * synchronisation ; le donner à un agent rédactionnel serait disproportionné.
 *
 * Deux garanties :
 *
 *  1. **Le jeton en clair n'existe qu'une fois.** On ne stocke que son SHA-256.
 *     Un dump de la base ne permet pas d'écrire sur le site. L'admin qui crée
 *     la clé la voit une seule fois, à la création.
 *  2. **Les portées sont explicites.** Pas de « clé d'agent » générique :
 *     `read`, `contribute`, `comment`, `write:articles`, `publish:articles`,
 *     `moderate` sont demandées une par une. Une clé d'ingest qui fuite ne
 *     publie rien.
 *
 * Server-only.
 */
import "server-only";
import { DEFAULT_AGENT_RATE_LIMIT } from "@shenron/auth/agent-keys";
import { agentKeyStrategy, authorize } from "@shenron/auth/guards";
import {
	createAgentKeyRepository,
	type AgentAuditView,
	type AgentKeyView,
	type CreatedAgentKey,
} from "@shenron/db/repos/agent-keys";
import { db } from "@/lib/db";
import type { AgentScope } from "@/db/schema";

/** Quota d'écritures par heure quand la clé n'en fixe pas. */
;

// Le vocabulaire des portées et sa validation vivent dans `lib/agent-scopes.ts`
// (client-safe) : l'écran d'administration et la page de documentation publique
// en ont besoin hors serveur. Ré-exporté ici pour les appelants historiques.
export {  parseScopes } from "@/lib/agent-scopes";

export type { AgentKeyView, CreatedAgentKey };

/**
 * Stockage : `createAgentKeyRepository` (`@shenron/db`) — seul le SHA-256 du
 * jeton est écrit, révocation logique (`revokedAt`), aucune ligne supprimée.
 * Format et hachage des jetons : `@shenron/auth/agent-keys`.
 */
const repository = createAgentKeyRepository(db);

/** Crée une clé. Le jeton renvoyé est la seule copie en clair qui existera. */
export function createAgentKey(input: {
	name: string;
	scopes: AgentScope[];
	note?: string | null;
	createdBy?: string | null;
	rateLimitPerHour?: number | null;
}): Promise<CreatedAgentKey> {
	return repository.createAgentKey(input);
}

export function listAgentKeys(): Promise<AgentKeyView[]> {
	return repository.listAgentKeys();
}

/** Révoque une clé (la ligne reste : l'audit doit rester lisible). */
export function revokeAgentKey(id: string): Promise<boolean> {
	return repository.revokeAgentKey(id);
}

/** Modifie les portées d'une clé existante sans en changer le jeton. */
export function updateAgentKeyScopes(id: string, scopes: AgentScope[]): Promise<boolean> {
	return repository.updateAgentKeyScopes(id, scopes);
}

export interface AgentIdentity {
	keyId: string;
	name: string;
	scopes: AgentScope[];
	rateLimitPerHour: number;
}

/**
 * Vérifie un `Authorization: Bearer dbfr_agent_…` (`agentKeyStrategy`).
 *
 * Le hachage SHA-256 sert d'index : on interroge la base sur le haché, pas sur
 * une liste qu'on parcourrait en comparant. `lastUsedAt` est une trace
 * d'exploitation : une écriture ratée ne fait pas échouer l'appel.
 */
export async function authenticateAgent(req: Request): Promise<AgentIdentity | null> {
	const decision = await authorize(req, [agentKeyStrategy({ store: repository })]);
	if (!decision.ok || decision.principal.kind !== "agent") return null;
	const principal = decision.principal;
	return {
		keyId: principal.keyId,
		name: principal.name ?? "",
		scopes: [...principal.scopes] as AgentScope[],
		rateLimitPerHour: principal.rateLimit ?? DEFAULT_AGENT_RATE_LIMIT,
	};
}

/** Nombre d'appels de cette clé sur l'heure écoulée (quota). */
export function agentCallsLastHour(keyId: string): Promise<number> {
	return repository.agentCallsLastHour(keyId);
}

/** Journalise un appel d'agent. Ne lève jamais : l'audit ne casse pas l'API. */
export function recordAgentCall(entry: {
	keyId: string | null;
	keyName: string | null;
	method: string;
	path: string;
	status: number;
	summary?: string | null;
}): Promise<void> {
	return repository.recordAgentCall(entry);
}

/** Derniers appels d'agents — écran d'administration. */
export function listAgentAudit(limit = 100): Promise<AgentAuditView[]> {
	return repository.listAgentAudit(limit);
}
