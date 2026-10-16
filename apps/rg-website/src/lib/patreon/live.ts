import { patreonFetch } from "@/lib/patreon/client";
import { decryptToken, encryptToken } from "@/lib/patreon/encryption";
import { isTokenFresh, refreshOAuthToken } from "@/lib/oauth/refresh";
import { createPostgresClient } from "@rosegriffon/db/service";
import type {
	JsonApiResource,
	PatreonAddressAttrs,
	PatreonCampaignAttrs,
	PatreonMemberAttrs,
	PatreonTierAttrs,
	PatreonUserAttrs,
} from "@/lib/patreon/types";

type AdminClient = ReturnType<typeof createPostgresClient>;

interface CreatorTokenRow {
	id: string;
	access_token_enc: string;
	refresh_token_enc: string;
	expires_at: string;
	scope: string;
	updated_at: string;
}

async function ensureFreshCreatorToken(
	supabase: AdminClient,
	row: CreatorTokenRow,
	marginMs = 5 * 60 * 1000
): Promise<string> {
	if (isTokenFresh(new Date(row.expires_at), marginMs)) {
		return decryptToken(row.access_token_enc);
	}
	const refresh = decryptToken(row.refresh_token_enc);
	const refreshed = await refreshOAuthToken(refresh);
	await supabase
		.from("patreon_oauth_tokens")
		.update({
			access_token_enc: encryptToken(refreshed.accessToken),
			expires_at: refreshed.expiresAt.toISOString(),
			refresh_token_enc: encryptToken(refreshed.refreshToken),
			scope: refreshed.scope || row.scope,
		})
		.eq("id", row.id);
	return refreshed.accessToken;
}

export interface LiveTier {
	id: string;
	title: string;
	amount_cents: number;
	patron_count: number | null;
	published: boolean | null;
	description: string | null;
	image_url: string | null;
	discord_role_ids: string[];
	url: string | null;
}

export interface LiveMember {
	id: string;
	full_name: string | null;
	email: string | null;
	patreon_user_id: string | null;
	patreon_thumb_url: string | null;
	patreon_url: string | null;
	discord_user_id: string | null;
	patron_status: PatreonMemberAttrs["patron_status"] | null;
	last_charge_date: string | null;
	last_charge_status: PatreonMemberAttrs["last_charge_status"] | null;
	currently_entitled_cents: number;
	lifetime_support_cents: number;
	will_pay_amount_cents: number;
	next_charge_date: string | null;
	pledge_start: string | null;
	pledge_cadence: number | null;
	is_free_trial: boolean;
	is_gifted: boolean;
	tier_ids: string[];
	tier_titles: string[];
	discord_role_ids: string[];
	address: PatreonAddressAttrs | null;
	note: string | null;
}

export interface LiveCampaign {
	id: string;
	creation_name: string | null;
	vanity: string | null;
	one_liner: string | null;
	summary: string | null;
	image_url: string | null;
	patron_count: number;
	pledge_url: string | null;
	is_monthly: boolean | null;
	is_charged_immediately: boolean | null;
	published_at: string | null;
}

export interface LiveCampaignSnapshot {
	campaign: LiveCampaign;
	tiers: LiveTier[];
	members: LiveMember[];
	fetchedAt: string;
	fetchDurationMs: number;
	tokenExpiresAt: string;
	tokenScope: string;
}

export type LiveSnapshotResult =
	| { ok: true; snapshot: LiveCampaignSnapshot }
	| {
			ok: false;
			reason: "no_admin_client" | "no_creator_token" | "no_campaign" | "fetch_failed";
			error?: string;
	  };

const CAMPAIGN_FIELDS = [
	"creation_name",
	"vanity",
	"one_liner",
	"summary",
	"image_url",
	"image_small_url",
	"patron_count",
	"is_monthly",
	"is_charged_immediately",
	"pledge_url",
	"published_at",
].join(",");

const MEMBER_FIELDS = [
	"full_name",
	"email",
	"patron_status",
	"last_charge_date",
	"last_charge_status",
	"currently_entitled_amount_cents",
	"campaign_lifetime_support_cents",
	"lifetime_support_cents",
	"pledge_relationship_start",
	"pledge_cadence",
	"will_pay_amount_cents",
	"next_charge_date",
	"is_free_trial",
	"is_gifted",
	"note",
].join(",");

const TIER_FIELDS = [
	"title",
	"amount_cents",
	"patron_count",
	"published",
	"published_at",
	"description",
	"image_url",
	"discord_role_ids",
	"requires_shipping",
	"created_at",
	"edited_at",
	"url",
].join(",");

const USER_FIELDS = ["email", "full_name", "thumb_url", "url", "social_connections"].join(",");

function getRel(resource: JsonApiResource<unknown>, name: string): { id: string; type: string }[] {
	const rel = resource.relationships?.[name]?.data;
	if (!rel) {
		return [];
	}
	return Array.isArray(rel) ? rel : [rel];
}

/**
 * Récupère un snapshot complet et live de la campagne Patreon en interrogeant
 * directement l'API officielle (`/campaigns` + paginate `/campaigns/:id/members`).
 *
 * - Refresh automatique du token créateur s'il expire dans moins de 5 minutes.
 * - Pagination par cursor (200/page) jusqu'à exhaustion.
 * - Retries 429/5xx via `patreonFetch`.
 *
 * Coût : ~1 appel campaigns + ceil(N_members / 200) appels members.
 * Une campagne RG ~700 patrons = 4-5 appels HTTP.
 */
export async function fetchLiveCampaignSnapshot(): Promise<LiveSnapshotResult> {
	const supabase = createPostgresClient();

	const { data: tokenRow } = await supabase
		.from("patreon_oauth_tokens")
		.select("id,access_token_enc,refresh_token_enc,expires_at,scope,updated_at")
		.eq("is_creator", true)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	const row = tokenRow as CreatorTokenRow | null;
	if (!row) {
		return { ok: false, reason: "no_creator_token" };
	}

	const t0 = performance.now();
	let accessToken: string;
	try {
		accessToken = await ensureFreshCreatorToken(supabase, row);
	} catch (error) {
		return {
			ok: false,
			reason: "fetch_failed",
			error: `refresh token failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	let campaignsResp: Awaited<ReturnType<typeof patreonFetch>>;
	try {
		campaignsResp = await patreonFetch(accessToken, "/campaigns", {
			"fields[campaign]": CAMPAIGN_FIELDS,
			"fields[tier]": TIER_FIELDS,
			include: "tiers",
		});
	} catch (error) {
		return {
			ok: false,
			reason: "fetch_failed",
			error: `GET /campaigns: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const campaignsData = Array.isArray(campaignsResp.data)
		? campaignsResp.data
		: [campaignsResp.data];
	const c = campaignsData[0] as JsonApiResource<PatreonCampaignAttrs> | undefined;
	if (!c) {
		return { ok: false, reason: "no_campaign" };
	}

	const tierResources = (campaignsResp.included ?? []).filter(
		(r) => r.type === "tier"
	) as unknown as JsonApiResource<PatreonTierAttrs>[];

	const tiers: LiveTier[] = tierResources
		.map((t) => ({
			amount_cents: t.attributes.amount_cents ?? 0,
			description: t.attributes.description ?? null,
			discord_role_ids: t.attributes.discord_role_ids ?? [],
			id: t.id,
			image_url: t.attributes.image_url ?? null,
			patron_count: t.attributes.patron_count ?? null,
			published: t.attributes.published ?? null,
			title: t.attributes.title ?? "",
			url: t.attributes.url ?? null,
		}))
		.toSorted((a, b) => a.amount_cents - b.amount_cents);

	const members: LiveMember[] = [];
	let cursor: string | null = null;
	let pages = 0;
	const MAX_PAGES = 50;
	try {
		do {
			const query: Record<string, string> = {
				"fields[member]": MEMBER_FIELDS,
				"fields[tier]": TIER_FIELDS,
				"fields[user]": USER_FIELDS,
				include: "currently_entitled_tiers,user,address",
				"page[count]": "200",
			};
			if (cursor) {
				query["page[cursor]"] = cursor;
			}

			const resp = await patreonFetch<PatreonMemberAttrs>(
				accessToken,
				`/campaigns/${c.id}/members`,
				query
			);

			const memberArr = (
				Array.isArray(resp.data) ? resp.data : [resp.data]
			) as JsonApiResource<PatreonMemberAttrs>[];
			const includedTiers = (resp.included ?? []).filter(
				(r) => r.type === "tier"
			) as unknown as JsonApiResource<PatreonTierAttrs>[];
			const tiersById = new Map(includedTiers.map((t) => [t.id, t]));
			const includedUsers = (resp.included ?? []).filter(
				(r) => r.type === "user"
			) as unknown as JsonApiResource<PatreonUserAttrs>[];
			const usersById = new Map(includedUsers.map((u) => [u.id, u]));
			const includedAddresses = (resp.included ?? []).filter(
				(r) => r.type === "address"
			) as unknown as JsonApiResource<PatreonAddressAttrs>[];
			const addressesById = new Map(includedAddresses.map((a) => [a.id, a]));

			for (const m of memberArr) {
				const tierRefs = getRel(m, "currently_entitled_tiers");
				const memberTiers = tierRefs
					.map((r) => tiersById.get(r.id))
					.filter((t): t is JsonApiResource<PatreonTierAttrs> => Boolean(t));

				const userRel = m.relationships?.user?.data;
				const userId = userRel && !Array.isArray(userRel) ? userRel.id : null;
				const userResource = userId ? usersById.get(userId) : null;
				const discordUserId =
					userResource?.attributes.social_connections?.discord?.user_id?.toString() ?? null;

				const addressRel = m.relationships?.address?.data;
				const addressId = addressRel && !Array.isArray(addressRel) ? addressRel.id : null;
				const addressAttrs = (addressId && addressesById.get(addressId)?.attributes) || null;

				const discordRoleIds = [
					...new Set(memberTiers.flatMap((t) => t.attributes.discord_role_ids ?? [])),
				].filter((s): s is string => Boolean(s));

				members.push({
					address: addressAttrs as PatreonAddressAttrs | null,
					currently_entitled_cents: m.attributes.currently_entitled_amount_cents ?? 0,
					discord_role_ids: discordRoleIds,
					discord_user_id: discordUserId,
					email: m.attributes.email ?? null,
					full_name: m.attributes.full_name ?? null,
					id: m.id,
					is_free_trial: m.attributes.is_free_trial ?? false,
					is_gifted: m.attributes.is_gifted ?? false,
					last_charge_date: m.attributes.last_charge_date ?? null,
					last_charge_status: m.attributes.last_charge_status ?? null,
					lifetime_support_cents:
						m.attributes.campaign_lifetime_support_cents ??
						m.attributes.lifetime_support_cents ??
						0,
					next_charge_date: m.attributes.next_charge_date ?? null,
					note: m.attributes.note ?? null,
					patreon_thumb_url: userResource?.attributes.thumb_url ?? null,
					patreon_url: userResource?.attributes.url ?? null,
					patreon_user_id: userId,
					patron_status: m.attributes.patron_status ?? null,
					pledge_cadence: m.attributes.pledge_cadence ?? null,
					pledge_start: m.attributes.pledge_relationship_start ?? null,
					tier_ids: memberTiers.map((t) => t.id),
					tier_titles: memberTiers
						.map((t) => t.attributes.title ?? "")
						.filter((s): s is string => Boolean(s)),
					will_pay_amount_cents: m.attributes.will_pay_amount_cents ?? 0,
				});
			}

			cursor = resp.meta?.pagination?.cursors?.next ?? null;
			pages += 1;
		} while (cursor && pages < MAX_PAGES);
	} catch (error) {
		return {
			ok: false,
			reason: "fetch_failed",
			error: `GET /campaigns/${c.id}/members: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	members.sort((a, b) => b.currently_entitled_cents - a.currently_entitled_cents);

	return {
		ok: true,
		snapshot: {
			campaign: {
				creation_name: c.attributes.creation_name ?? null,
				id: c.id,
				image_url: c.attributes.image_url ?? null,
				is_charged_immediately: c.attributes.is_charged_immediately ?? null,
				is_monthly: c.attributes.is_monthly ?? null,
				one_liner: c.attributes.one_liner ?? null,
				patron_count: c.attributes.patron_count ?? 0,
				pledge_url: c.attributes.pledge_url ?? null,
				published_at: c.attributes.published_at ?? null,
				summary: c.attributes.summary ?? null,
				vanity: c.attributes.vanity ?? null,
			},
			fetchDurationMs: Math.round(performance.now() - t0),
			fetchedAt: new Date().toISOString(),
			members,
			tiers,
			tokenExpiresAt: row.expires_at,
			tokenScope: row.scope,
		},
	};
}
