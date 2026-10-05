/**
 * API Databooks — dépôt d'une transcription.
 *
 *   POST /api/databooks/:id/transcription   (jeton porteur requis)
 *
 * Conçue pour la transcription de masse image → texte : le corpus compte
 * **11 513 planches, dont 11 277 sans texte**. Un modèle local rend un lot,
 * cette route le réinjecte page par page.
 *
 * Corps :
 *   {
 *     "mode": "merge" | "replace",          // défaut : merge
 *     "pages": [{ "number": 1, "text": "…" }],
 *     "description": "…"                    // facultatif : chapô de la fiche (markdown)
 *   }
 *
 * `merge` (défaut) ne touche QUE le champ `text` des pages citées : l'image et
 * les pages absentes du corps restent intactes. C'est le mode sûr pour un
 * traitement par lots qu'on peut relancer — il est idempotent.
 * `replace` remplace tout le tableau de pages : à réserver à une reprise complète.
 *
 * Chaque dépôt enregistre une révision (`public.wiki_revisions`), donc reste
 * consultable et réversible depuis /admin/wiki/history — une transcription
 * automatique est une proposition, pas une vérité.
 */
import { NextResponse } from "next/server";
import { hasValidApiToken } from "@/lib/admin-guard";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getDatabook, updateDatabook } from "@/lib/databooks";
import { parseDatabookId, type DatabookPageInput } from "@/lib/databooks-rules";
import { recordRevision } from "@/lib/wiki-revisions";
import { revalidateWikiEntity } from "@/lib/wiki-revalidate";
import { indexDatabook } from "@/lib/databooks-redis";
import { databooksFreeze } from "@/lib/databooks-freeze";

export const dynamic = "force-dynamic";

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
};

/** Un texte de planche plus long que ça relève de l'erreur, pas de l'OCR. */
const TEXTE_MAX = 40_000;
/** Garde-fou de charge : au-delà, découper en plusieurs appels. */
const PAGES_MAX = 2_000;

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

interface Corps {
	mode?: "merge" | "replace";
	pages?: { number?: unknown; text?: unknown; image?: unknown }[];
	description?: string | null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
	const freeze = databooksFreeze();
	if (freeze) return NextResponse.json({ error: "Écritures databooks gelées.", reason: freeze.reason }, { status: 423, headers: CORS });
	if (!hasValidApiToken(req)) {
		return NextResponse.json(
			{ error: "Jeton porteur requis." },
			{ status: 401, headers: { ...CORS, "WWW-Authenticate": "Bearer" } }
		);
	}
	const id = parseDatabookId((await ctx.params).id);
	if (id === null) {
		return NextResponse.json({ error: "Fiche introuvable." }, { status: 404, headers: CORS });
	}

	let corps: Corps;
	try {
		corps = (await req.json()) as Corps;
	} catch {
		return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400, headers: CORS });
	}

	const entrees = Array.isArray(corps.pages) ? corps.pages : [];
	if (entrees.length === 0 && corps.description === undefined) {
		return NextResponse.json(
			{ error: "Rien à déposer : fournir `pages` et/ou `description`." },
			{ status: 400, headers: CORS }
		);
	}
	if (entrees.length > PAGES_MAX) {
		return NextResponse.json(
			{ error: `Trop de pages en un appel (max ${PAGES_MAX}).` },
			{ status: 413, headers: CORS }
		);
	}

	const avant = await getDatabook(id);
	if (!avant) {
		return NextResponse.json({ error: "Fiche introuvable." }, { status: 404, headers: CORS });
	}

	// Textes déposés, indexés par numéro de page. `null` = effacer explicitement.
	//
	// Une chaîne vide ou blanche est IGNORÉE, pas traitée comme un effacement :
	// c'est presque toujours une planche que le modèle n'a pas su lire, et la
	// prendre pour un effacement détruirait une transcription correcte au
	// prochain passage. Pour retirer un texte, il faut le dire — `"text": null`.
	const textes = new Map<number, string | null>();
	let ignorees = 0;
	for (const e of entrees) {
		const n = Number(e?.number);
		if (!Number.isSafeInteger(n) || n <= 0) {
			ignorees++;
			continue;
		}
		if (e?.text === null) {
			textes.set(n, null);
			continue;
		}
		const t = typeof e?.text === "string" ? e.text.trim() : "";
		if (!t) {
			ignorees++;
			continue;
		}
		textes.set(n, t.slice(0, TEXTE_MAX));
	}

	const mode = corps.mode === "replace" ? "replace" : "merge";
	let pages: DatabookPageInput[];
	let inconnues = 0;

	let doublons = 0;

	if (mode === "replace") {
		// Reprise complète : l'appelant fournit le tableau entier. On conserve
		// l'image existante quand il ne la redonne pas — perdre le chemin d'une
		// planche serait irréversible côté fichiers.
		//
		// Une entrée SANS numéro valide est refusée, jamais renumérotée sur sa
		// position : le repli `i + 1` d'origine lui attribuait le numéro d'une
		// autre planche, donc `textes.get(numero)` lui collait la transcription de
		// cette autre planche — et deux entrées finissaient avec le même numéro,
		// sans que rien ne le signale. En reprise complète, l'appelant est censé
		// fournir des numéros ; on préfère l'en informer.
		const parNumero = new Map(avant.pages.map((p) => [p.number, p]));
		const construites = new Map<number, DatabookPageInput>();
		for (const e of entrees) {
			const n = Number(e?.number);
			if (!Number.isSafeInteger(n) || n <= 0) continue; // déjà compté dans `ignorees`
			if (construites.has(n)) doublons++;
			const ancienne = parNumero.get(n);
			const image =
				typeof e?.image === "string" && e.image.trim() ? e.image.trim() : (ancienne?.image ?? null);
			// L'acquittement de relecture (« vérifier quand même ») survit à une
			// reprise complète : il dit qu'un humain a comparé cette planche à son
			// scan, ce qu'un nouveau dépôt automatique ne remet pas en cause.
			construites.set(n, {
				number: n,
				image,
				text: textes.get(n) ?? null,
				verifiee: ancienne?.verifiee === true,
			});
		}
		if (construites.size === 0) {
			return NextResponse.json(
				{ error: "Mode `replace` : aucune page ne porte de numéro valide." },
				{ status: 400, headers: CORS }
			);
		}
		pages = [...construites.values()].toSorted((a, b) => a.number - b.number);
	} else {
		pages = [];
		const connus = new Set(avant.pages.map((p) => p.number));
		for (const n of textes.keys()) if (!connus.has(n)) inconnues++;
	}

	if (mode === "merge") {
		// Fusion **en SQL**, sur les seules planches citées.
		//
		// Le chemin précédent relisait la fiche puis réécrivait le tableau `pages`
		// entier : toute correction enregistrée par un relecteur (`PATCH /pages`,
		// ciblé et atomique) entre la lecture et l'écriture était perdue — la race
		// exacte que ce PATCH avait été écrit pour éviter. Ici l'`UPDATE` lit et
		// réécrit dans la même instruction, donc rien ne peut s'intercaler.
		//
		// `'null'::jsonb` distingue « effacer » (text: null) de « absent du lot ».
		const table = Object.fromEntries([...textes].map(([n, t]) => [String(n), t]));
		await db.execute(sql`
			UPDATE bot.db_databooks d
			SET pages = coalesce((
				SELECT jsonb_agg(
					CASE
						WHEN m.v IS NULL THEN t.p
						WHEN jsonb_typeof(m.v) = 'null' THEN t.p - 'text'
						ELSE t.p || jsonb_build_object('text', m.v)
					END ORDER BY t.ord)
				FROM jsonb_array_elements(
					CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END
				) WITH ORDINALITY AS t(p, ord)
				LEFT JOIN LATERAL (
					SELECT ${JSON.stringify(table)}::jsonb -> coalesce(t.p ->> 'number', t.ord::text) AS v
				) m ON true
			), '[]'::jsonb)
			WHERE d.id = ${id}
		`);
	}

	const apres =
		mode === "replace" || corps.description !== undefined
			? await updateDatabook(id, {
					...(mode === "replace" ? { pages } : {}),
					...(corps.description !== undefined ? { description: corps.description } : {}),
				})
			: await getDatabook(id);
	if (!apres) {
		return NextResponse.json({ error: "Fiche introuvable." }, { status: 404, headers: CORS });
	}

	// Trace réversible : une transcription automatique reste une proposition.
	//
	// On journalise les PLANCHES DÉPOSÉES, sous la clé `pages#<n>` — pas la fiche
	// entière. Passer `avant`/`apres` bruts ne marchait pas : `snapshot()` écarte
	// les valeurs objets, donc le tableau `pages` disparaissait et il ne restait
	// que des métadonnées inchangées. Mesuré le 2026-08-28 : les 2 359 révisions
	// de transcription de databook avaient `before = after`, et le revert de
	// /admin/wiki/history ne pouvait donc annuler aucun dépôt.
	//
	// La forme `pages#<n>` est celle que `estCiblePlanche` reconnaît déjà, côté
	// contribution communautaire comme côté revert : un seul vocabulaire pour
	// désigner une planche.
	const avantParNumero = new Map(avant.pages.map((p) => [p.number, p.text ?? null]));
	const apresParNumero = new Map(apres.pages.map((p) => [p.number, p.text ?? null]));
	const numerosTouches =
		mode === "replace"
			? [...new Set([...avantParNumero.keys(), ...apresParNumero.keys()])]
			: [...textes.keys()];
	const avantPlanches: Record<string, unknown> = {};
	const apresPlanches: Record<string, unknown> = {};
	for (const n of numerosTouches.toSorted((a, b) => a - b)) {
		const a = avantParNumero.get(n) ?? null;
		const b = apresParNumero.get(n) ?? null;
		if (a === b) continue; // rien n'a bougé sur cette planche : hors du journal
		avantPlanches[`pages#${n}`] = a;
		apresPlanches[`pages#${n}`] = b;
	}
	// Une requête qui n'a rien changé ne mérite pas d'entrée d'historique : c'est
	// ce qui remplissait le journal de révisions vides.
	const aChange = Object.keys(apresPlanches).length > 0 || corps.description !== undefined;
	if (aChange) {
		await recordRevision({
			table: "db_databooks",
			id: String(id),
			action: "update",
			before: { ...(avant as unknown as Record<string, unknown>), ...avantPlanches },
			after: { ...(apres as unknown as Record<string, unknown>), ...apresPlanches },
			actor: { id: "api-transcription", name: "Transcription (API)" },
		});
	}

	// Sans ça, un lot de 2 000 planches déposé par l'API restait invisible du
	// public jusqu'à une heure : la fiche est en `revalidate = 3600` avec
	// `generateStaticParams`, donc rien ne la régénère avant expiration. Le
	// chemin unitaire (`PATCH /pages`) revalidait déjà — pas celui de masse.
	revalidateWikiEntity("db_databooks", { id });
	// Même raison côté index Redis (recherche par titre/catégorie).
	await indexDatabook(apres).catch((e) =>
		console.error("[api/databooks/transcription] indexation Redis échouée:", e)
	);

	const transcrites = apres.pages.filter((p) => (p.text ?? "").length > 0).length;
	return NextResponse.json(
		{
			id,
			mode,
			deposees: textes.size,
			ignorees,
			// Numéros fournis deux fois dans le même lot (`replace`) : la dernière
			// occurrence gagne, mais le silence masquerait un export incohérent.
			doublons,
			// En `merge`, un numéro absent de la fiche est signalé plutôt qu'inventé :
			// c'est le symptôme d'un décalage entre le lot exporté et la base.
			pagesInconnues: inconnues,
			pagesTotal: apres.pages.length,
			pagesTranscrites: transcrites,
		},
		{ headers: CORS }
	);
}
