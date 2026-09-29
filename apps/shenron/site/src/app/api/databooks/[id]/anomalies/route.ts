/**
 * API Databooks — fautes de lecture probables d'un ouvrage.
 *
 *   GET /api/databooks/:id/anomalies   (admin connecté ou jeton)
 *
 * Sert la relecture : le relecteur affiche, planche par planche, les graphies
 * que l'analyse japonaise juge fautives, avec la forme attendue. Le scan est à
 * côté — c'est le seul endroit où l'on peut trancher pour de bon.
 *
 * L'analyse porte sur **l'ouvrage entier**, pas sur la planche courante : la
 * décision « cette graphie est-elle une faute ? » se prend en comparant les
 * fréquences, et une planche isolée n'en donne aucune. C'est aussi pour cela
 * que le résultat est calculé en une fois puis découpé par planche, plutôt que
 * recalculé à chaque changement de page.
 *
 * Réservé aux administrateurs : la lecture charge un dictionnaire
 * morphologique et un index de 464 819 graphies.
 */
import { NextResponse } from "next/server";
import { isAdminUserOrToken } from "@/lib/admin-guard";
import { getDatabook } from "@/lib/databooks";
import { parseDatabookId } from "@/lib/databooks-rules";
import { anomaliesOuvrage } from "@/lib/ja";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
	if (!(await isAdminUserOrToken(req))) {
		return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
	}

	const id = parseDatabookId((await ctx.params).id);
	if (id === null) return NextResponse.json({ error: "Fiche introuvable." }, { status: 404 });

	const fiche = await getDatabook(id);
	if (!fiche) return NextResponse.json({ error: "Fiche introuvable." }, { status: 404 });

	// Une seule passe sur l'ouvrage : la référence de fréquence, c'est tout son
	// texte — une faute y est rare, une graphie juste s'y répète de planche en
	// planche. Analyser page par page referait le même travail à chaque fois.
	const { total, planches: parPlanche } = await anomaliesOuvrage(fiche.pages);

	return NextResponse.json({
		id,
		total,
		planches: parPlanche,
		// L'absence de dictionnaire n'est pas une absence de faute : sans ce
		// drapeau, le relecteur afficherait « aucune anomalie » sur un ouvrage
		// qui n'a simplement pas pu être analysé.
		analysePossible: total > 0 || (await estAnalysable()),
	});
}

/** Les ressources japonaises sont-elles installées ? */
async function estAnalysable(): Promise<boolean> {
	const { analyseur } = await import("@/lib/ja/dictionnaire");
	return (await analyseur()) !== null;
}
