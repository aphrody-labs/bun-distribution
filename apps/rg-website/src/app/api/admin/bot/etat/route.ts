import { NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { etatDuCron } from "@/lib/bot/cron";
import { etatDesBots } from "@/lib/bot/serveur";

export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/bot/etat` — état d'exécution des deux bots et de l'ordonnanceur.
 *
 * Tout est sondé en parallèle et AUCUNE panne n'est propagée : la réponse porte
 * les erreurs, elle ne les lève pas. Un tableau de bord dont la page tombe en
 * 500 parce qu'un des trois services est arrêté ne sert à rien — c'est
 * justement le moment où on le consulte.
 */
export async function GET() {
	const garde = await requireApiAdmin();
	if (!garde.ok) {
		return garde.response;
	}

	const [bots, cron] = await Promise.all([etatDesBots(), etatDuCron()]);

	return NextResponse.json(
		{ bots, cron, mesureLe: new Date().toISOString() },
		{ headers: { "cache-control": "private, no-store" } }
	);
}
