import type { users } from "@/db/schema";

export type SiteUser = typeof users.$inferSelect;

export type CurrentUser = {
	sessionUserId: string;
	discordId: string;
	user: SiteUser | null;
};

const resolvedUsers = new Map<string, { at: number; value: CurrentUser }>();
const TTL = 60_000;
/**
 * Plafond du cache. Sans lui, la Map ne perdait une entrée que si la MÊME
 * session revenait après expiration : un visiteur unique qui ne revient jamais
 * laissait sa ligne `users` en mémoire pour la durée de vie du processus. Sur un
 * serveur qui tourne des semaines, c'est une fuite lente et silencieuse — et la
 * machine qui sert le site est déjà celle qui meurt en OOM pendant les builds.
 */
const MAX_ENTRIES = 2_000;

/** Purge les entrées périmées, puis évince les plus anciennes si besoin. */
function elague(now: number): void {
	for (const [key, entry] of resolvedUsers) {
		if (now - entry.at >= TTL) resolvedUsers.delete(key);
	}
	// L'ordre d'itération d'une Map est celui de l'insertion : la première clé
	// est la plus ancienne écriture.
	while (resolvedUsers.size >= MAX_ENTRIES) {
		const plusAncienne = resolvedUsers.keys().next().value;
		if (plusAncienne === undefined) break;
		resolvedUsers.delete(plusAncienne);
	}
}

export function readCachedCurrentUser(sessionUserId: string): CurrentUser | null {
	const cached = resolvedUsers.get(sessionUserId);
	if (!cached) return null;
	if (Date.now() - cached.at >= TTL) {
		resolvedUsers.delete(sessionUserId);
		return null;
	}
	return cached.value;
}

export function cacheCurrentUser(sessionUserId: string, value: CurrentUser): void {
	const now = Date.now();
	if (resolvedUsers.size >= MAX_ENTRIES) elague(now);
	// Réinsérer après suppression remet la clé en fin d'ordre d'insertion, ce qui
	// garde l'éviction cohérente pour une session qui se rafraîchit.
	resolvedUsers.delete(sessionUserId);
	resolvedUsers.set(sessionUserId, { at: now, value });
}

export function invalidateCurrentUser(sessionUserId: string): void {
	resolvedUsers.delete(sessionUserId);
}
