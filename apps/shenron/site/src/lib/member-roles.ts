/**
 * member-roles — rôles Discord d'un visiteur, pour le contrôle d'accès par rôle
 * (`/admin/lancement`, appliqué dans `proxy.ts`).
 *
 * Le site ne stocke PAS les rôles : ils changent côté Discord sans prévenir et un
 * miroir en base serait périmé en permanence. La source de vérité est le bot, qui
 * porte l'intent privilégié `GuildMembers` et garde tous les membres en cache —
 * `/api/discord/members?search=<snowflake>` renvoie déjà `roleIds` (fetch REST
 * par ID avec repli cache côté bot).
 *
 * Contraintes du hot-path (le proxy passe ici sur chaque requête gardée) :
 *   - cache mémoire 60 s par utilisateur, sinon un aller-retour HTTP par
 *     navigation ;
 *   - timeout court : un bot lent ne doit jamais figer le rendu du site ;
 *   - **fail-closed** — bot injoignable ⇒ aucun rôle ⇒ accès refusé. L'inverse
 *     transformerait une panne du bot en ouverture publique de pages privées.
 */
import "server-only";
import { API_URL } from "@/lib/config";

const TOKEN = process.env.SHENRON_ADMIN_TOKEN ?? "";
const TTL_MS = 60_000;
/** Au-delà, on vide : le cache sert le trafic chaud, pas un annuaire complet. */
const MAX_ENTRIES = 2_000;
const TIMEOUT_MS = 2_000;

const cache = new Map<string, { roles: string[]; ts: number }>();

interface MembersResponse {
	members?: { id: string; roleIds?: string[] }[];
}

/**
 * Rôles Discord du membre, tableau vide s'il n'est pas sur le serveur (ou si le
 * bot est injoignable — cf. fail-closed ci-dessus).
 */
export async function getMemberRoleIds(discordId: string): Promise<string[]> {
	if (!discordId || !/^\d{17,20}$/.test(discordId)) return [];

	const now = Date.now();
	const hit = cache.get(discordId);
	if (hit && now - hit.ts < TTL_MS) return hit.roles;

	let roles: string[] = [];
	try {
		const res = await fetch(
			`${API_URL}/api/discord/members?limit=1&search=${encodeURIComponent(discordId)}`,
			{
				headers: { accept: "application/json", authorization: `Bearer ${TOKEN}` },
				signal: AbortSignal.timeout(TIMEOUT_MS),
				cache: "no-store",
			}
		);
		if (res.ok) {
			const data = (await res.json()) as MembersResponse;
			const member = data.members?.find((m) => m.id === discordId);
			roles = member?.roleIds ?? [];
		}
	} catch (e) {
		// Panne/timeout du bot : on ne met PAS en cache pour retenter au prochain
		// passage, et on renvoie le dernier état connu s'il existe (moins brutal
		// qu'une déconnexion apparente pour un membre légitime pendant un restart).
		console.error("[member-roles] bot injoignable :", e);
		return hit?.roles ?? [];
	}

	if (cache.size >= MAX_ENTRIES) cache.clear();
	cache.set(discordId, { roles, ts: now });
	return roles;
}
