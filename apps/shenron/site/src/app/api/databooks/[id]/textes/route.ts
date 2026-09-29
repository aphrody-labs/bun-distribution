/**
 * API Databooks — transcriptions d'un lot de planches, à la demande.
 *
 *   GET /api/databooks/:id/textes?pages=12,13,14
 *
 * Pourquoi cette route existe : la fiche publique envoyait au navigateur la
 * transcription des planches de l'ouvrage ENTIER, alors qu'on en lit une à la
 * fois. Mesuré le 2026-08-31 sur `/wiki/databooks/4` (Daizenshuu 7, 313
 * planches) : 459 Ko de page, dont 412 Ko de charge RSC, dont l'essentiel est
 * 281 197 signes de japonais que le visiteur ne verra jamais. La fiche
 * n'embarque plus que les premières planches ; le lecteur demande la suite ici,
 * au fil du défilement.
 *
 * Lecture seule, publique (le corpus l'est), et sans cookie ni en-tête de
 * session : la réponse reste cacheable par le CDN. Elle est donc alignée sur
 * `/api/databooks` : seule une fiche `visible = true` rend ses transcriptions —
 * sans le filtre, cette route servait le texte des fiches masquées à tout
 * appelant, et le CDN le gardait une heure. Le contrôle vaut pour les DEUX
 * chemins de lecture : l'index Redis ignore la visibilité (cf. `fichePubliee`),
 * il ne peut donc pas servir de raccourci autour d'elle.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseDatabookId } from "@/lib/databooks-rules";
import { readIndexedTextes } from "@/lib/databooks-redis";

export const runtime = "nodejs";

/** Une fenêtre de lecture, pas un moyen d'aspirer l'ouvrage en une requête. */
const MAX_PAGES = 40;

/**
 * La fiche est-elle publiée ?
 *
 * L'index Redis ne porte PAS l'état de visibilité courant : il n'est réécrit que
 * par les écritures de l'API databooks (`lib/databooks.ts`, dépôt de
 * transcription, correction d'une planche). Masquer une fiche depuis `/admin`
 * passe par `setWikiVisibility` / `setAllWikiVisibility`, qui écrivent la colonne
 * `visible` en base sans toucher à l'index — les transcriptions y survivent donc
 * intactes. Le chemin rapide servait alors le texte d'une fiche masquée à
 * n'importe quel appelant, et le CDN le gardait une heure : exactement la fuite
 * que le filtre `d.visible` du repli SQL ferme déjà de son côté.
 *
 * Même prédicat que ce repli (`visible` est `not null default true`), pour que
 * les deux chemins répondent la même chose.
 */
async function fichePubliee(id: number): Promise<boolean> {
	const lignes = (await db.execute(sql`
		select 1 as ok from bot.db_databooks where id = ${id}::bigint and visible limit 1
	`)) as unknown as Array<{ ok: number }>;
	return lignes.length > 0;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
	const id = parseDatabookId((await ctx.params).id);
	if (id === null) return NextResponse.json({ error: "Fiche introuvable." }, { status: 404 });

	const demandees = [
		...new Set(
			(new URL(req.url).searchParams.get("pages") ?? "")
				.split(",")
				.map((v) => Number(v.trim()))
				.filter((v) => Number.isSafeInteger(v) && v > 0)
		),
	].slice(0, MAX_PAGES);
	if (demandees.length === 0) return NextResponse.json({ textes: {} });

	// L'index Redis d'abord : il porte les mêmes transcriptions, tenues à jour à
	// chaque dépôt. Il rend `null` — jamais un lot partiel — dès qu'une planche
	// demandée lui manque, auquel cas on redescend en base pour le lot entier.
	//
	// Les deux lectures partent ensemble : le contrôle de visibilité est une
	// recherche par clé primaire, il n'a pas à ajouter d'aller-retour au chemin
	// rapide.
	const [publiee, indexees] = await Promise.all([
		fichePubliee(id),
		readIndexedTextes(id, demandees),
	]);
	if (!publiee) return reponse({});
	if (indexees) return reponse(indexees);

	// Un seul aller-retour, et le filtrage se fait côté Postgres : rapatrier la
	// colonne `pages` entière pour en extraire trois planches referait, côté
	// serveur, exactement la dépense qu'on cherche à supprimer côté client.
	const lignes = (await db.execute(sql`
		select (e->>'number')::int as numero,
		       case when jsonb_typeof(e->'text') = 'object' then e->'text'->>'markdown'
		            else e->>'text' end as texte
		from bot.db_databooks d, jsonb_array_elements(d.pages) e
		where d.id = ${id}::bigint
		  and d.visible
		  and (e->>'number')::int in (${sql.join(
				demandees.map((n) => sql`${n}`),
				sql`, `
			)})
	`)) as unknown as Array<{ numero: number; texte: string | null }>;

	const textes: Record<string, string> = {};
	for (const l of lignes) {
		if (l.texte && l.texte.trim()) textes[String(l.numero)] = l.texte;
	}

	return reponse(textes);
}

function reponse(textes: Record<string, string>) {
	return NextResponse.json(
		{ textes },
		{
			headers: {
				// Le corpus ne bouge qu'au rythme des dépôts de transcription ;
				// une heure de cache, revalidée en arrière-plan, suffit largement.
				"Cache-Control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
			},
		}
	);
}
