import { PatreonCreatorClient } from "@rosegriffon/patreon-bun";
import type { Oauth2StoredToken } from "@rosegriffon/patreon-bun";

import type {
	JsonApiResource,
	JsonApiResponse,
	ParsedIdentity,
	ParsedMembership,
	PatreonAddressAttrs,
	PatreonMemberAttrs,
	PatreonTierAttrs,
	PatreonTokenResponse,
	PatreonUserAttrs,
} from "./types";

export class PatreonApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public body: unknown
	) {
		super(message);
		this.name = "PatreonApiError";
	}
}

function clientCreds() {
	const clientId = process.env.PATREON_CLIENT_ID;
	const clientSecret = process.env.PATREON_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new PatreonApiError("PATREON_CLIENT_ID/SECRET missing", 0, null);
	}
	return { clientId, clientSecret };
}

/**
 * Adapter retournant l'ancienne shape `PatreonTokenResponse` (snake_case Patreon).
 * `Oauth2StoredToken` upstream conserve tous les champs du payload original
 * (incluant `scope`) via spread, cf. `toStored()` dans la lib.
 */
function toLegacyTokenShape(token: Oauth2StoredToken): PatreonTokenResponse {
	const t = token as Oauth2StoredToken & { scope?: string };
	return {
		access_token: t.access_token,
		expires_in: Number(t.expires_in) || 0,
		refresh_token: t.refresh_token,
		scope: t.scope ?? "",
		token_type: "Bearer",
	};
}

/**
 * Échange un code OAuth Patreon contre un token pair.
 * Le `redirect_uri` est passé via les options du client (lu par la lib au
 * moment du POST `/api/oauth2/token`).
 */
export async function exchangeCode(params: {
	code: string;
	redirectUri: string;
}): Promise<PatreonTokenResponse> {
	const c = new PatreonCreatorClient({
		oauth: { ...clientCreds(), redirectUri: params.redirectUri },
	});
	const token = await c.oauth.getOauthTokenFromCode({ code: params.code });
	if (!token) {
		throw new PatreonApiError("getOauthTokenFromCode returned undefined", 0, null);
	}
	return toLegacyTokenShape(token);
}

/**
 * Renouvelle un access token via le refresh token stocké.
 */
export async function refreshAccessToken(refreshToken: string): Promise<PatreonTokenResponse> {
	const c = new PatreonCreatorClient({ oauth: clientCreds() });
	const refreshed = await c.oauth.refreshToken(refreshToken);
	return toLegacyTokenShape(refreshed);
}

/**
 * Build a typed PatreonCreatorClient avec retry rate-limit aware (429 / 5xx).
 * À utiliser pour les fetches typés (`fetchCampaign`, `paginateCampaignMembers`,
 * `webhooks.fetchWebhooks`, etc.).
 */
export function getCreatorClient(accessToken: string): PatreonCreatorClient {
	return new PatreonCreatorClient({
		oauth: {
			...clientCreds(),
			token: { access_token: accessToken, refresh_token: "" },
		},
		rest: {
			fetch: globalThis.fetch as never,
			retries: [
				{
					backoff: { time: 1000, jitter: 500, type: "exponential" } as never,
					retries: 5,
					status: 429,
				},
				{
					backoff: { time: 1000, jitter: 500, type: "exponential" } as never,
					retries: 3,
					status: [500, 599],
				},
			] as never,
		},
	});
}

/**
 * Effectue un fetch raw vers l'API Patreon avec retry 429 / 5xx.
 * Utilisé par le code d'export et `fetchIdentity` qui consomment encore la
 * shape JSON:API brute (transition progressive vers `client.simplified`).
 */
export async function patreonFetch<T = Record<string, unknown>>(
	accessToken: string,
	path: string,
	query?: Record<string, string>
): Promise<JsonApiResponse<T>> {
	const url = new URL(`https://www.patreon.com/api/oauth2/v2${path}`);
	if (query) {
		for (const [k, v] of Object.entries(query)) {
			url.searchParams.set(k, v);
		}
	}

	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await fetch(url, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${accessToken}`,
			},
		});

		if (res.ok) {
			return (await res.json()) as JsonApiResponse<T>;
		}

		const retryable = res.status === 429 || res.status >= 500;
		if (retryable && attempt < 4) {
			const retryAfter = res.headers.get("retry-after");
			const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
			const exp = Math.min(1000 * 2 ** attempt, 30_000);
			const jitter = Math.random() * 500;
			await Bun.sleep(Math.max(retryAfterMs, exp) + jitter);
			continue;
		}

		throw new PatreonApiError(`Patreon ${path} ${res.status}`, res.status, await res.text());
	}
	throw new PatreonApiError(`Patreon ${path} exhausted retries`, 0, null);
}

/**
 * Récupère l'identité de l'utilisateur courant (avec ses memberships si demandé).
 *
 * Champs étendus quand `withMemberships=true` : on demande tous les champs
 * exploitables côté RG (full_name patron, lifetime_support, pledge_*, will_pay)
 * et le mapping tier (title, amount, discord_role_ids, image, description).
 */
export async function fetchIdentity(
	accessToken: string,
	opts: { withMemberships?: boolean } = {}
): Promise<JsonApiResponse> {
	const query: Record<string, string> = {
		"fields[user]": "email,full_name,thumb_url,url,social_connections",
	};
	if (opts.withMemberships) {
		query.include = [
			"memberships",
			"memberships.currently_entitled_tiers",
			"memberships.address",
		].join(",");
		query["fields[member]"] = [
			"full_name",
			"email",
			"patron_status",
			"last_charge_date",
			"last_charge_status",
			"currently_entitled_amount_cents",
			"campaign_lifetime_support_cents",
			"pledge_relationship_start",
			"pledge_cadence",
			"will_pay_amount_cents",
			"next_charge_date",
			"is_free_trial",
			"is_gifted",
			"note",
		].join(",");
		query["fields[tier]"] = [
			"title",
			"amount_cents",
			"description",
			"discord_role_ids",
			"image_url",
			"published",
			"published_at",
			"requires_shipping",
			"created_at",
			"edited_at",
			"patron_count",
			"url",
		].join(",");
		query["fields[address]"] = [
			"line_1",
			"line_2",
			"city",
			"state",
			"country",
			"postal_code",
			"addressee",
			"phone_number",
			"created_at",
		].join(",");
	}
	return patreonFetch(accessToken, "/identity", query);
}

/**
 * Parse la réponse `/identity?include=memberships,memberships.currently_entitled_tiers`
 * en structure typée et plate. Extrait :
 *   - identité user + discord_user_id (depuis social_connections)
 *   - une liste de memberships (1 par campaign), chacun avec ses tiers résolus
 *
 * Cette structure est ensuite consommée par le callback OAuth + le webhook
 * `members:create/update` pour upserter `patreon_memberships`.
 */
export function parseIdentityWithMemberships(response: JsonApiResponse): ParsedIdentity {
	const data = Array.isArray(response.data) ? response.data[0] : response.data;
	if (!data) {
		throw new PatreonApiError("identity returned no data", 0, null);
	}

	const userAttrs = data.attributes as PatreonUserAttrs;
	const discordUserId = userAttrs.social_connections?.discord?.user_id?.toString() ?? null;

	const included = response.included ?? [];
	const membersIncluded = included.filter(
		(r) => r.type === "member"
	) as unknown as JsonApiResource<PatreonMemberAttrs>[];
	const tiersIncluded = included.filter(
		(r) => r.type === "tier"
	) as unknown as JsonApiResource<PatreonTierAttrs>[];
	const addressesIncluded = included.filter(
		(r) => r.type === "address"
	) as unknown as JsonApiResource<PatreonAddressAttrs>[];
	const tiersById = new Map<string, JsonApiResource<PatreonTierAttrs>>(
		tiersIncluded.map((r) => [r.id, r])
	);
	const addressesById = new Map<string, JsonApiResource<PatreonAddressAttrs>>(
		addressesIncluded.map((r) => [r.id, r])
	);

	// Filtre les memberships référencés par le user (relationships.memberships)
	const userMembershipIds = new Set<string>(
		(() => {
			const rel = data.relationships?.memberships?.data;
			if (!rel) {
				return [];
			}
			const arr = Array.isArray(rel) ? rel : [rel];
			return arr.map((r) => r.id);
		})()
	);

	const memberships: ParsedMembership[] = membersIncluded
		.filter((m) => userMembershipIds.has(m.id))
		.map((m) => {
			const campaignRel = m.relationships?.campaign?.data;
			const campaignId = campaignRel && !Array.isArray(campaignRel) ? campaignRel.id : null;

			const tierRel = m.relationships?.currently_entitled_tiers?.data;
			const tierRefs = Array.isArray(tierRel) ? tierRel : tierRel ? [tierRel] : [];
			const tiers = tierRefs
				.map((ref) => tiersById.get(ref.id))
				.filter((t): t is JsonApiResource<PatreonTierAttrs> => Boolean(t));

			const addressRel = m.relationships?.address?.data;
			const addressId = addressRel && !Array.isArray(addressRel) ? addressRel.id : null;
			const address = (addressId && addressesById.get(addressId)?.attributes) || null;

			return {
				address,
				attrs: m.attributes,
				campaignId,
				discordRoleIds: tiers
					.flatMap((t) => t.attributes.discord_role_ids ?? [])
					.filter((s): s is string => Boolean(s)),
				memberId: m.id,
				tierAmountsCents: tiers.map((t) => t.attributes.amount_cents ?? 0),
				tierIds: tiers.map((t) => t.id),
				tierRequiresShipping: tiers.map((t) => t.attributes.requires_shipping ?? false),
				tierTitles: tiers.map((t) => t.attributes.title).filter((s): s is string => Boolean(s)),
			};
		});

	return {
		discordUserId,
		memberships,
		patreonUserId: data.id,
		user: userAttrs,
	};
}
