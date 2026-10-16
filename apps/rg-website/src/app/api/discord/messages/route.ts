import type { NextRequest } from "next/server";
import { z } from "zod";

import {
	LIMITE_MESSAGES,
	MESSAGES_PAR_DEFAUT,
	construireContexteMentions,
	listerMessages,
	salonEstSuivi,
} from "@/lib/discord/queries";

// Fil public en lecture seule : le contenu bouge en permanence, on ne met
// jamais cette réponse en cache côté Next.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Identifiant Discord (snowflake) : uniquement des chiffres. */
const snowflake = z.string().regex(/^\d{15,25}$/, "identifiant Discord invalide");

const schemaRequete = z.object({
	before: snowflake.nullish(),
	channel: snowflake,
	limit: z.coerce.number().int().min(1).max(LIMITE_MESSAGES).default(MESSAGES_PAR_DEFAUT),
});

export async function GET(request: NextRequest) {
	const parametres = request.nextUrl.searchParams;
	const analyse = schemaRequete.safeParse({
		before: parametres.get("before") ?? undefined,
		channel: parametres.get("channel") ?? undefined,
		limit: parametres.get("limit") ?? undefined,
	});

	if (!analyse.success) {
		return Response.json(
			{ erreur: "Paramètres invalides.", details: analyse.error.issues.map((i) => i.message) },
			{ status: 400 }
		);
	}

	const { before, channel, limit } = analyse.data;

	// Un salon non suivi n'est jamais republié, même si son identifiant est connu.
	if (!(await salonEstSuivi(channel))) {
		return Response.json({ erreur: "Salon introuvable ou non republié." }, { status: 404 });
	}

	const messages = await listerMessages({ before, channelId: channel, limit });
	const contexte = await construireContexteMentions(messages);

	return Response.json(
		{
			channel,
			contexte,
			// `messages` est trié du plus récent au plus ancien ; `encore` indique
			// qu'une page plus ancienne existe probablement.
			encore: messages.length === limit,
			messages,
		},
		{ headers: { "cache-control": "no-store" } }
	);
}
