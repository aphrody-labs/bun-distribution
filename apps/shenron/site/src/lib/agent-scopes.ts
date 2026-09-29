/**
 * agent-scopes — le vocabulaire des portées d'agent, **client-safe**.
 *
 * Séparé de `lib/agent-keys.ts` (marqué `server-only`, il touche la base et le
 * hachage des jetons) parce que trois surfaces en ont besoin hors serveur :
 * l'écran d'administration qui coche les portées, la page de documentation
 * publique qui les explique, et les tests qui vérifient qu'une portée inventée
 * ne peut pas entrer en base.
 */
import { parseScopes as parseScopesIn } from "@shenron/auth/agent-keys";
import { AGENT_SCOPES, type AgentScope } from "@/db/schema";

/** Description courte de chaque portée — reprise telle quelle dans la doc. */
export const SCOPE_DESCRIPTIONS: Record<AgentScope, string> = {
	read: "Lire le fil, les articles publiés et les discussions.",
	contribute: "Déposer une proposition de correction du wiki (file de modération).",
	"write:articles": "Créer des articles — en brouillon.",
	"publish:articles": "Mettre un article en ligne (ou le programmer).",
	comment: "Publier un message signé du nom de l'agent.",
	moderate: "Lire la file de modération, masquer ou épingler un message.",
};

function isAgentScope(value: unknown): value is AgentScope {
	return typeof value === "string" && (AGENT_SCOPES as readonly string[]).includes(value);
}

/**
 * Normalise une liste de portées venue d'un formulaire ou d'un appel d'API.
 *
 * Dédoublonnée et bornée au vocabulaire connu : une portée inventée ne doit
 * jamais atteindre la base, sinon un contrôle `includes()` plus loin laisserait
 * passer ce que personne n'a relu. `parseScopes` de `@shenron/auth/agent-keys`
 * lié à `AGENT_SCOPES` ; une entrée qui n'est pas un tableau donne `[]`.
 */
export function parseScopes(input: unknown): AgentScope[] {
	return parseScopesIn(AGENT_SCOPES, input) ?? [];
}
