#!/usr/bin/env bun
/**
 * Bulk sync `patreon_memberships` via le creator token.
 *
 * Couvre les cas que `refreshPatreonMembership(userId)` ne traite PAS :
 *  - User créateur (is_creator=true) qui est aussi ancien patron de sa campagne
 *  - User Patreon dont l'OAuth a expiré → creator token reste valide
 *  - User Patreon non lié RG mais matché par email/discord (legacy)
 *
 * Source : `/campaigns/{id}/members?include=user,currently_entitled_tiers,address` (creator API).
 * Match user_id RG via 3 stratégies :
 *  1. `patreon_oauth_tokens.patreon_user_id` (lié explicitement)
 *  2. `profiles.discord_id` (depuis user social_connections Patreon)
 *  3. `profiles.email` (case-insensitive)
 *
 * Usage : bun scripts/patreon-memberships-sync.ts [--dry-run] [--user-id=UUID]
 */

import { createPostgresClient } from "@rosegriffon/db/service";

const TOKEN = process.env.PATREON_CREATOR_ACCESS_TOKEN ?? process.env.PATREON_ACCESS_TOKEN;
const CAMPAIGN_ID = process.env.PATREON_CAMPAIGN_ID;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquante");
if (!TOKEN) throw new Error("PATREON_CREATOR_ACCESS_TOKEN manquant");
if (!CAMPAIGN_ID) throw new Error("PATREON_CAMPAIGN_ID manquant");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const userIdFilter = process.argv.find((a) => a.startsWith("--user-id="))?.split("=")[1] ?? null;

const db = createPostgresClient();

interface JsonApiResource<A = Record<string, unknown>> {
	id: string;
	type: string;
	attributes: A;
	relationships?: Record<
		string,
		{ data?: { id: string; type: string } | { id: string; type: string }[] }
	>;
}

interface MemberAttrs {
	full_name: string | null;
	email: string | null;
	patron_status: string | null;
	currently_entitled_amount_cents: number | null;
	campaign_lifetime_support_cents: number | null;
	lifetime_support_cents: number | null;
	pledge_relationship_start: string | null;
	last_charge_date: string | null;
	last_charge_status: string | null;
	will_pay_amount_cents: number | null;
	next_charge_date: string | null;
	pledge_cadence: number | null;
	is_free_trial: boolean | null;
	is_gifted: boolean | null;
	note: string | null;
}

interface UserAttrs {
	full_name: string | null;
	email: string | null;
	thumb_url: string | null;
	url: string | null;
	social_connections: Record<string, { user_id?: string } | null> | null;
}

interface TierAttrs {
	title: string;
	amount_cents: number;
}

const MEMBER_FIELDS = [
	"full_name",
	"email",
	"patron_status",
	"currently_entitled_amount_cents",
	"campaign_lifetime_support_cents",
	"lifetime_support_cents",
	"pledge_relationship_start",
	"last_charge_date",
	"last_charge_status",
	"will_pay_amount_cents",
	"next_charge_date",
	"pledge_cadence",
	"is_free_trial",
	"is_gifted",
	"note",
].join(",");
const USER_FIELDS = ["full_name", "email", "thumb_url", "url", "social_connections"].join(",");
const TIER_FIELDS = "title,amount_cents";

function discordIdFromConnections(
	conns: UserAttrs["social_connections"] | undefined | null
): string | null {
	if (!conns) return null;
	const d = conns.discord;
	return d?.user_id ?? null;
}

async function fetchAllMembers(): Promise<{
	members: JsonApiResource<MemberAttrs>[];
	included: JsonApiResource[];
}> {
	const all: JsonApiResource<MemberAttrs>[] = [];
	const allIncluded: JsonApiResource[] = [];
	let cursor: string | null = null;
	let pages = 0;
	while (true) {
		const params = new URLSearchParams({
			include: "user,currently_entitled_tiers,address",
			"fields[member]": MEMBER_FIELDS,
			"fields[user]": USER_FIELDS,
			"fields[tier]": TIER_FIELDS,
			"page[count]": "1000",
		});
		if (cursor) params.set("page[cursor]", cursor);
		const url = `https://www.patreon.com/api/oauth2/v2/campaigns/${CAMPAIGN_ID}/members?${params}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${TOKEN}` },
		});
		if (!res.ok) throw new Error(`Patreon API ${res.status}: ${await res.text()}`);
		const data = (await res.json()) as {
			data: JsonApiResource<MemberAttrs>[];
			included?: JsonApiResource[];
			meta?: { pagination?: { cursors?: { next?: string | null } } };
		};
		all.push(...data.data);
		allIncluded.push(...(data.included ?? []));
		pages += 1;
		cursor = data.meta?.pagination?.cursors?.next ?? null;
		if (!cursor) break;
	}
	console.log(`[fetch] ${all.length} members in ${pages} pages`);
	return { members: all, included: allIncluded };
}

async function resolveRgUserId(
	patreonUserId: string,
	email: string | null,
	discordId: string | null
): Promise<{ userId: string; via: string } | null> {
	const { data: tok } = await db
		.from("patreon_oauth_tokens")
		.select("user_id")
		.eq("patreon_user_id", patreonUserId)
		.eq("is_creator", false)
		.maybeSingle();
	if (tok?.user_id) return { userId: tok.user_id, via: "oauth_token" };

	const { data: tokCreator } = await db
		.from("patreon_oauth_tokens")
		.select("user_id")
		.eq("patreon_user_id", patreonUserId)
		.maybeSingle();
	if (tokCreator?.user_id) return { userId: tokCreator.user_id, via: "oauth_token_creator" };

	if (discordId) {
		const { data: p } = await db
			.from("profiles")
			.select("id")
			.eq("discord_id", discordId)
			.maybeSingle();
		if (p?.id) return { userId: p.id, via: "discord" };
	}

	if (email) {
		const { data: p } = await db.from("profiles").select("id").ilike("email", email).maybeSingle();
		if (p?.id) return { userId: p.id, via: "email" };
	}

	return null;
}

async function main() {
	const start = Date.now();
	console.log(`[patreon-memberships-sync] dry=${dryRun} user-filter=${userIdFilter ?? "none"}`);

	const { members, included } = await fetchAllMembers();
	const tiersById = new Map<string, TierAttrs>();
	const usersById = new Map<string, UserAttrs>();
	for (const inc of included) {
		if (inc.type === "tier") tiersById.set(inc.id, inc.attributes as unknown as TierAttrs);
		else if (inc.type === "user") usersById.set(inc.id, inc.attributes as unknown as UserAttrs);
	}

	let upserted = 0;
	let skippedNoMatch = 0;
	let skippedFiltered = 0;

	for (const m of members) {
		const userRel = m.relationships?.user?.data;
		const patreonUserId = userRel && !Array.isArray(userRel) ? userRel.id : null;
		if (!patreonUserId) continue;

		const userAttrs = usersById.get(patreonUserId) ?? null;
		const email = m.attributes.email ?? userAttrs?.email ?? null;
		const discordId = discordIdFromConnections(userAttrs?.social_connections);

		const match = await resolveRgUserId(patreonUserId, email, discordId);
		if (!match) {
			skippedNoMatch += 1;
			continue;
		}

		if (userIdFilter && match.userId !== userIdFilter) {
			skippedFiltered += 1;
			continue;
		}

		const tierRels = m.relationships?.currently_entitled_tiers?.data;
		const tierIds = Array.isArray(tierRels) ? tierRels.map((r) => r.id) : [];
		const tiers = tierIds.map((id) => tiersById.get(id)).filter((t): t is TierAttrs => t != null);

		const lifetimeCents =
			m.attributes.campaign_lifetime_support_cents ?? m.attributes.lifetime_support_cents ?? null;

		const row = {
			user_id: match.userId,
			patreon_user_id: patreonUserId,
			patreon_member_id: m.id,
			campaign_id: CAMPAIGN_ID,
			patreon_email: userAttrs?.email ?? null,
			patreon_full_name: userAttrs?.full_name ?? null,
			patreon_thumb_url: userAttrs?.thumb_url ?? null,
			patreon_url: userAttrs?.url ?? null,
			discord_user_id: discordId,
			patron_status: m.attributes.patron_status,
			last_charge_date: m.attributes.last_charge_date,
			last_charge_status: m.attributes.last_charge_status,
			currently_entitled_cents: m.attributes.currently_entitled_amount_cents ?? 0,
			lifetime_support_cents: lifetimeCents ?? 0,
			pledge_start: m.attributes.pledge_relationship_start,
			pledge_cadence: m.attributes.pledge_cadence,
			will_pay_amount_cents: m.attributes.will_pay_amount_cents,
			next_charge_date: m.attributes.next_charge_date,
			is_free_trial: m.attributes.is_free_trial,
			is_gifted: m.attributes.is_gifted,
			member_email: m.attributes.email,
			note: m.attributes.note,
			tier_ids: tierIds,
			tier_titles: tiers.map((t) => t.title),
			tier_amounts_cents: tiers.map((t) => t.amount_cents),
			fetched_at: new Date().toISOString(),
		};

		console.log(
			`  ${dryRun ? "[dry]" : "  ✓"} ${match.userId.slice(0, 8)} via ${match.via} | ${m.attributes.patron_status ?? "—"} | last=${m.attributes.last_charge_date?.slice(0, 10) ?? "—"} | lifetime=${(lifetimeCents ?? 0) / 100}€`
		);

		if (dryRun) {
			upserted += 1;
			continue;
		}

		const { error } = await db
			.from("patreon_memberships")
			.upsert(row, { onConflict: "user_id,patreon_user_id" });
		if (error) console.error("  ✗ upsert failed:", error.message);
		else upserted += 1;
	}

	const ms = Date.now() - start;
	console.log(
		`[done] upserted=${upserted} no-match=${skippedNoMatch} filtered-out=${skippedFiltered} · ${ms}ms`
	);
}

await main();
