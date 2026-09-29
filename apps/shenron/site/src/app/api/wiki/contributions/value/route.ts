/**
 * GET /api/wiki/contributions/value?table=&rowId=&column=
 *
 * Valeur ACTUELLE d'un champ éditorial, lue au moment où le contributeur ouvre
 * la modale. Deux raisons de ne pas la passer en prop depuis la page :
 *
 *  - un article long fait des dizaines de Ko ; l'embarquer dans la charge RSC
 *    de chaque fiche la doublerait pour un bouton que peu de gens cliquent ;
 *  - les fiches sont servies en ISR, donc la valeur rendue peut dater. Partir
 *    d'un texte périmé, c'est fabriquer un conflit à l'acceptation.
 *
 * Réservé aux membres connectés : le contenu est public, mais l'endpoint sert
 * la contribution, pas la lecture — inutile d'en faire une surface d'aspiration.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getWikiRow } from "@/lib/wiki-admin";
import { targetIsValid } from "@/lib/wiki-contributions";
import { estCiblePlanche, lireTranscription, numeroDePlanche } from "@/lib/databook-pages";
import { estCibleStats, formatStats } from "@/lib/stats-personnage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
	let session: Awaited<ReturnType<typeof getCurrentUser>> = null;
	try {
		session = await getCurrentUser();
	} catch {
		session = null;
	}
	if (!session?.user?.id) {
		return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
	}

	const sp = req.nextUrl.searchParams;
	const table = sp.get("table") ?? "";
	const rowId = sp.get("rowId") ?? "";
	const column = sp.get("column") ?? "";
	if (!targetIsValid(table, column) || !rowId) {
		return NextResponse.json({ ok: false, error: "bad_target" }, { status: 400 });
	}

	// Transcription d'une planche (`pages#42`) : elle vit dans le jsonb de
	// l'ouvrage, pas dans une colonne — `getWikiRow` ne saurait pas la trouver.
	const planche = estCiblePlanche(table, column) ? numeroDePlanche(column) : null;
	if (planche !== null) {
		const texte = await lireTranscription(rowId, planche).catch(() => null);
		if (texte === null) {
			return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
		}
		return NextResponse.json({ ok: true, value: texte });
	}

	const row = await getWikiRow(table, rowId).catch(() => null);
	if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

	// Statistiques : un jsonb rendu en texte, une mesure par ligne.
	if (estCibleStats(table, column)) {
		return NextResponse.json({
			ok: true,
			value: formatStats((row as Record<string, unknown>).stats),
		});
	}

	const v = (row as Record<string, unknown>)[column];
	return NextResponse.json({ ok: true, value: v == null ? "" : String(v) });
}
