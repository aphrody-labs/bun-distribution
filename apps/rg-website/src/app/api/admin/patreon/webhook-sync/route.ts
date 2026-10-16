import { NextResponse } from "next/server";
import { createPostgresClient } from "@rosegriffon/db/service";

import { requirePatreonCreator } from "@/lib/auth-helpers";
import { PatreonApiError, patreonFetch } from "@/lib/patreon/client";
import { decryptToken } from "@/lib/patreon/encryption";
import { ALL_TRIGGERS } from "@/lib/patreon/webhooks";
import { absoluteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PatreonWebhookResource {
	id: string;
	type: "webhook";
	attributes: {
		uri: string;
		paused: boolean;
		num_consecutive_times_failed: number;
		last_attempted_at: string | null;
		secret: string;
		triggers: string[];
	};
	relationships?: {
		campaign?: { data?: { id: string; type: string } | null };
	};
}

/**
 * Crée ou met à jour le webhook Patreon côté upstream avec les 9 triggers
 * complets (members:* + posts:*) + unpause s'il était désactivé après échecs.
 *
 * Requiert :
 *  - User RG admin (`requirePatreonCreator`)
 *  - Un token Patreon `is_creator=true` chiffré dans `patreon_oauth_tokens`
 *  - Scope `w:campaigns.webhook` dans le token (cf. SCOPES_CREATOR)
 *
 * Le ID du webhook est cached dans `patreon_webhook_state.patreon_webhook_id`
 * pour éviter de re-créer un webhook à chaque appel (limite Patreon).
 */
export async function POST(req: Request) {
	await requirePatreonCreator();
	const supabase = createPostgresClient();

	const url = new URL(req.url);
	const targetUri =
		url.searchParams.get("uri") ?? absoluteUrl("/api/auth/patreon/webhook");

	// 1. Récupère le creator token (déchiffré)
	const { data: tokenRow } = await supabase
		.from("patreon_oauth_tokens")
		.select("access_token_enc, expires_at, scope")
		.eq("is_creator", true)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (!tokenRow) {
		return NextResponse.json({ ok: false, reason: "no_creator_token" }, { status: 400 });
	}
	const creatorToken = decryptToken((tokenRow as { access_token_enc: string }).access_token_enc);

	// 2. Récupère le campaign_id du créateur (via /campaigns)
	let campaignId: string | null;
	try {
		const campaigns = await patreonFetch(creatorToken, "/campaigns");
		const data = Array.isArray(campaigns.data) ? campaigns.data[0] : campaigns.data;
		campaignId = data?.id ?? null;
	} catch (error) {
		console.error("[admin/webhook-sync] fetch campaigns failed", error);
		return NextResponse.json(
			{
				ok: false,
				reason: "fetch_campaign_failed",
				detail: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 }
		);
	}
	if (!campaignId) {
		return NextResponse.json({ ok: false, reason: "no_campaign" }, { status: 400 });
	}

	// 3. Liste les webhooks existants pour cette campaign
	let existingId: string | null = null;
	try {
		const list = await patreonFetch(creatorToken, "/webhooks");
		const arr = (Array.isArray(list.data) ? list.data : [list.data]).filter(
			Boolean
		) as unknown as PatreonWebhookResource[];
		const ours = arr.find((w) => w.attributes?.uri === targetUri);
		existingId = ours?.id ?? null;
	} catch (error) {
		console.warn("[admin/webhook-sync] list webhooks failed (proceed)", error);
	}

	// 4. Création ou mise à jour
	const body = {
		data: {
			type: "webhook",
			...(existingId ? { id: existingId } : {}),
			attributes: {
				triggers: ALL_TRIGGERS,
				uri: targetUri,
				...(existingId ? { paused: false } : {}),
			},
			...(existingId
				? {}
				: {
						relationships: {
							campaign: { data: { id: campaignId, type: "campaign" } },
						},
					}),
		},
	};

	const path = existingId ? `/webhooks/${existingId}` : "/webhooks";
	const method = existingId ? "PATCH" : "POST";

	let result: PatreonWebhookResource | null;
	try {
		const res = await fetch(`https://www.patreon.com/api/oauth2/v2${path}`, {
			body: JSON.stringify(body),
			headers: {
				accept: "application/json",
				authorization: `Bearer ${creatorToken}`,
				"content-type": "application/json",
			},
			method,
		});
		if (!res.ok) {
			const text = await res.text();
			throw new PatreonApiError(`webhook ${method} ${res.status}`, res.status, text);
		}
		const json = (await res.json()) as { data: PatreonWebhookResource };
		result = json.data;
	} catch (error) {
		console.error("[admin/webhook-sync] upstream failed", error);
		return NextResponse.json(
			{
				ok: false,
				reason: "patreon_api_failed",
				detail:
					error instanceof PatreonApiError
						? { status: error.status, body: error.body }
						: error instanceof Error
							? error.message
							: String(error),
			},
			{ status: 500 }
		);
	}

	// 5. Sauvegarde l'état local (id, secret, triggers, paused)
	if (result) {
		await supabase
			.from("patreon_webhook_state")
			.update({
				last_attempted_at: result.attributes.last_attempted_at,
				num_consecutive_times_failed: result.attributes.num_consecutive_times_failed,
				patreon_webhook_id: result.id,
				paused: result.attributes.paused,
				triggers: result.attributes.triggers,
				updated_at: new Date().toISOString(),
				uri: result.attributes.uri,
			})
			.eq("id", 1);
	}

	return NextResponse.json({
		mode: existingId ? "patched" : "created",
		ok: true,
		secret_changed: !existingId,
		webhook: result
			? {
					id: result.id,
					uri: result.attributes.uri,
					triggers: result.attributes.triggers,
					paused: result.attributes.paused,
					num_consecutive_times_failed: result.attributes.num_consecutive_times_failed,
				}
			: null,
	});
}

/**
 * GET : liste les webhooks Patreon configurés pour la campaign du créateur.
 */
export async function GET() {
	await requirePatreonCreator();
	const supabase = createPostgresClient();

	const { data: tokenRow } = await supabase
		.from("patreon_oauth_tokens")
		.select("access_token_enc")
		.eq("is_creator", true)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (!tokenRow) {
		return NextResponse.json({ ok: false, reason: "no_creator_token" }, { status: 400 });
	}
	const creatorToken = decryptToken((tokenRow as { access_token_enc: string }).access_token_enc);

	try {
		const list = await patreonFetch(creatorToken, "/webhooks");
		const arr = (Array.isArray(list.data) ? list.data : [list.data]).filter(
			Boolean
		) as unknown as PatreonWebhookResource[];
		return NextResponse.json({
			ok: true,
			webhooks: arr.map((w) => ({
				id: w.id,
				last_attempted_at: w.attributes.last_attempted_at,
				num_consecutive_times_failed: w.attributes.num_consecutive_times_failed,
				paused: w.attributes.paused,
				triggers: w.attributes.triggers,
				uri: w.attributes.uri,
			})),
		});
	} catch (error) {
		console.error("[admin/webhook-sync] list failed", error);
		return NextResponse.json(
			{
				ok: false,
				reason: "patreon_api_failed",
				detail: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 }
		);
	}
}
