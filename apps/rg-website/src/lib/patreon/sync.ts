import { fetchIdentity, parseIdentityWithMemberships } from "@/lib/patreon/client";
import { decryptToken, encryptToken } from "@/lib/patreon/encryption";
import { isTokenFresh, refreshOAuthToken } from "@/lib/oauth/refresh";
import { SCOPES_PATRON } from "@/lib/patreon/types";
import { createPostgresClient } from "@rosegriffon/db/service";
import type { ParsedIdentity } from "@/lib/patreon/types";

type AdminClient = ReturnType<typeof createPostgresClient>;

interface TokenRow {
	id: string;
	user_id: string | null;
	patreon_user_id: string;
	access_token_enc: string;
	refresh_token_enc: string;
	expires_at: string;
	scope: string;
}

const refreshLocks = new Map<string, Promise<string>>();

/**
 * Si le token expire dans moins de `marginMs`, on le rafraîchit via OAuth
 * `grant_type=refresh_token` et on stocke la nouvelle paire chiffrée.
 * Renvoie l'access token clair (toujours valide) à utiliser pour le fetch.
 *
 * Cette fonction est protégée contre les race conditions :
 * 1. Un verrou local (in-memory lock via Map de Promises) empêche les appels concurrents dans le même processus.
 * 2. Un verrou optimiste sur la base de données (PostgREST match sur refresh_token_enc) empêche les conflits multi-processus.
 */
async function ensureFreshAccessToken(
	supabase: AdminClient,
	row: TokenRow,
	marginMs = 5 * 60 * 1000
): Promise<string> {
	// 1. Verrou local en mémoire pour fusionner les requêtes concurrentes du même process
	const activeRefresh = refreshLocks.get(row.id);
	if (activeRefresh) {
		return activeRefresh;
	}

	const refreshPromise = (async () => {
		try {
			// Lire la version la plus fraîche du token depuis la base de données dans la section critique
			const { data: latestToken } = await supabase
				.from("patreon_oauth_tokens")
				.select("id, access_token_enc, refresh_token_enc, expires_at, scope")
				.eq("id", row.id)
				.single();

			if (!latestToken) {
				throw new Error("Patreon token row not found in database");
			}

			// Si un appel concurrent a déjà rafraîchi le token avec succès entre-temps
			if (isTokenFresh(new Date(latestToken.expires_at), marginMs)) {
				return decryptToken(latestToken.access_token_enc);
			}

			// Lancer le rafraîchissement effectif auprès de l'API Patreon
			const refresh = decryptToken(latestToken.refresh_token_enc);
			const refreshed = await refreshOAuthToken(refresh);

			// Mise à jour optimiste : on ne met à jour que si le token n'a pas bougé en DB
			const { data, error } = await supabase
				.from("patreon_oauth_tokens")
				.update({
					access_token_enc: encryptToken(refreshed.accessToken),
					expires_at: refreshed.expiresAt.toISOString(),
					refresh_token_enc: encryptToken(refreshed.refreshToken),
					scope: refreshed.scope || latestToken.scope,
				})
				.eq("id", latestToken.id)
				.eq("refresh_token_enc", latestToken.refresh_token_enc)
				.select("access_token_enc");

			if (error || !data || data.length === 0) {
				// Conflit détecté (déjà mis à jour par un autre processus). On récupère la valeur fraîche.
				const { data: finalToken } = await supabase
					.from("patreon_oauth_tokens")
					.select("access_token_enc")
					.eq("id", latestToken.id)
					.single();
				if (finalToken) {
					return decryptToken(finalToken.access_token_enc);
				}
				throw new Error("Patreon token refreshed concurrently but final token could not be retrieved");
			}

			return refreshed.accessToken;
		} finally {
			// Libérer le verrou
			refreshLocks.delete(row.id);
		}
	})();

	refreshLocks.set(row.id, refreshPromise);
	return refreshPromise;
}

/**
 * Re-sync l'état Patreon d'un user RG depuis l'API officielle :
 * fetch identity étendu → upsert `patreon_memberships`.
 *
 * Utilisé par :
 *  - POST /api/auth/patreon/refresh (action user)
 *  - cron /api/cron/patreon-refresh (timer hebdo)
 *  - admin /api/admin/patreon/refresh-all
 */
export async function refreshPatreonMembership(
	userId: string
): Promise<{ ok: boolean; reason?: string; identity?: ParsedIdentity }> {
	const supabase = createPostgresClient();

	const { data: tokenRow } = await supabase
		.from("patreon_oauth_tokens")
		.select("id, user_id, patreon_user_id, access_token_enc, refresh_token_enc, expires_at, scope")
		.eq("user_id", userId)
		.eq("is_creator", false)
		.maybeSingle();

	const row = tokenRow as TokenRow | null;
	if (!row) {
		return { ok: false, reason: "no_token" };
	}

	const accessToken = await ensureFreshAccessToken(supabase, row);
	const resp = await fetchIdentity(accessToken, { withMemberships: true });
	const identity = parseIdentityWithMemberships(resp);

	const top =
		[...identity.memberships].toSorted((a, b) => {
			const score = (s: string | null | undefined) => (s === "active_patron" ? 0 : 1);
			return score(a.attrs.patron_status) - score(b.attrs.patron_status);
		})[0] ?? null;

	await supabase.from("patreon_memberships").upsert(
		{
			address: top?.address ?? null,
			campaign_id: top?.campaignId ?? null,
			currently_entitled_cents: top?.attrs.currently_entitled_amount_cents ?? null,
			discord_role_ids: top?.discordRoleIds ?? [],
			discord_user_id: identity.discordUserId,
			fetched_at: new Date().toISOString(),
			is_free_trial: top?.attrs.is_free_trial ?? null,
			is_gifted: top?.attrs.is_gifted ?? null,
			last_charge_date: top?.attrs.last_charge_date ?? null,
			last_charge_status: top?.attrs.last_charge_status ?? null,
			lifetime_support_cents:
				top?.attrs.campaign_lifetime_support_cents ?? top?.attrs.lifetime_support_cents ?? null,
			member_email: top?.attrs.email ?? null,
			next_charge_date: top?.attrs.next_charge_date ?? null,
			note: top?.attrs.note ?? null,
			patreon_email: identity.user.email ?? null,
			patreon_full_name: identity.user.full_name ?? null,
			patreon_member_id: top?.memberId ?? null,
			patreon_thumb_url: identity.user.thumb_url ?? null,
			patreon_url: identity.user.url ?? null,
			patreon_user_id: identity.patreonUserId,
			patron_status: top?.attrs.patron_status ?? null,
			pledge_cadence: top?.attrs.pledge_cadence ?? null,
			pledge_start: top?.attrs.pledge_relationship_start ?? null,
			raw_identity: resp as unknown as Record<string, unknown>,
			scope: row.scope || SCOPES_PATRON.join(" "),
			tier_amounts_cents: top?.tierAmountsCents ?? [],
			tier_ids: top?.tierIds ?? [],
			tier_requires_shipping: top?.tierRequiresShipping ?? [],
			tier_titles: top?.tierTitles ?? [],
			user_id: userId,
			will_pay_amount_cents: top?.attrs.will_pay_amount_cents ?? null,
		},
		{ onConflict: "user_id,patreon_user_id" }
	);

	return { identity, ok: true };
}

/**
 * Refresh tous les memberships dont le `fetched_at` est plus vieux que `olderThanMs`.
 * Utilisé par le cron hebdo. Limité à `limit` users par run pour éviter un burst
 * d'appels Patreon.
 */
export async function refreshAllMemberships(opts: {
	olderThanMs?: number;
	limit?: number;
}): Promise<{ refreshed: number; failed: number }> {
	const supabase = createPostgresClient();

	const olderThan = new Date(Date.now() - (opts.olderThanMs ?? 6 * 24 * 3600 * 1000)).toISOString();
	const limit = opts.limit ?? 200;

	const { data } = await supabase
		.from("patreon_memberships")
		.select("user_id, fetched_at")
		.lt("fetched_at", olderThan)
		.limit(limit);

	let refreshed = 0;
	let failed = 0;
	for (const row of (data ?? []) as { user_id: string }[]) {
		try {
			const r = await refreshPatreonMembership(row.user_id);
			if (r.ok) {
				refreshed += 1;
			} else {
				failed += 1;
			}
		} catch (error) {
			console.error("[patreon/sync] refresh user failed", row.user_id, error);
			failed += 1;
		}
	}
	return { failed, refreshed };
}
