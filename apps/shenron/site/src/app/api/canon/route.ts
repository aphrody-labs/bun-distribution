/**
 * /api/canon — l'arbitre de canonicité de `/wiki/canon` en API publique.
 *
 *   GET /api/canon?q=<affirmation>   → { question, verdict, references, planches, fiches, suggestions, mode }
 *   GET /api/canon                    → { intro, tiers, doctrine, sourcesAdmises, sourcesInterdites,
 *                                         entries, heuristics, stats }
 *
 * Lecture seule, CORS ouvert, sans authentification : c'est la surface que
 * consomment le MCP (`canon_check`), la skill du plugin et tout outil externe.
 * Le verdict est celui de `canon-engine` (table curée, déterministe) et les
 * preuves viennent de nos propres bases — rien d'Internet, rien d'un modèle.
 *
 * Chaque question posée est comptée dans `canon_verdicts` (la mémoire de
 * l'arbitre) ; l'échec de ce compteur n'empêche jamais la réponse.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { canonPreuves } from "@/lib/canon-preuves";
import { getCanonConfig, getCanonReferences } from "@/lib/canon-config";
import { slugCanon } from "@/lib/canon-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS });
}

const QUESTION_MAX = 400;

async function compterQuestion(question: string, tier: string, score: number, origine: string) {
	try {
		const id = slugCanon(question, "question").slice(0, 80) || "question";
		await db.execute(sql`
			insert into public.canon_verdicts (id, question, tier, score, origine)
			values (${id}, ${question.slice(0, QUESTION_MAX)}, ${tier}, ${score}, ${origine})
			on conflict (id) do update set
				asked_count = public.canon_verdicts.asked_count + 1,
				tier = excluded.tier, score = excluded.score, origine = excluded.origine,
				last_asked_at = now()
		`);
	} catch (e) {
		console.error("[api/canon] compteur de questions indisponible :", e);
	}
}

export async function GET(req: NextRequest) {
	const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, QUESTION_MAX);
	const headers = { ...CORS, "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" };

	if (!q) {
		const [config, references] = await Promise.all([getCanonConfig(), getCanonReferences()]);
		const parProvenance: Record<string, number> = {};
		for (const r of references) parProvenance[r.provenance] = (parProvenance[r.provenance] ?? 0) + 1;
		return NextResponse.json(
			{
				intro: config.intro,
				tiers: config.tiers,
				doctrine: config.doctrine,
				sourcesAdmises: config.sourcesAdmises,
				sourcesInterdites: config.sourcesInterdites,
				entries: config.entries.map((e) => ({
					id: e.id,
					title: e.title,
					category: e.category,
					tier: e.tier,
					score: e.score,
					verdict: e.verdict,
				})),
				heuristics: config.heuristics.map((h) => ({ id: h.id, label: h.label, tier: h.tier })),
				stats: { references: references.length, parProvenance },
			},
			{ headers }
		);
	}

	const preuves = await canonPreuves(q);
	const { verdict } = preuves;
	void compterQuestion(q, verdict.tier, verdict.score, verdict.origine);
	return NextResponse.json(
		{
			question: q,
			verdict: {
				tier: verdict.tier,
				tierLabel: verdict.tierLabel,
				tierDefinition: verdict.tierDefinition ?? null,
				score: verdict.score,
				color: verdict.color,
				verdict: verdict.verdict,
				explanation: verdict.explanation,
				toriyamaQuote: verdict.toriyamaQuote ?? null,
				sources: verdict.sources,
				matchedKeywords: verdict.matchedKeywords,
				doctrine: verdict.doctrineRules ?? [],
				origine: verdict.origine,
				nature: verdict.nature,
				suggestions: verdict.suggestions,
			},
			references: (verdict.references ?? []).map((r) => ({
				id: r.id,
				subject: r.subject,
				text: r.text,
				textFr: r.textFr ?? null,
				source: r.source,
				year: r.year ?? null,
				lang: r.lang,
				provenance: r.provenance,
				href: r.href ?? null,
			})),
			planches: preuves.planches,
			fiches: preuves.fiches,
			suggestions: preuves.suggestions,
			mode: preuves.mode,
		},
		{ headers }
	);
}
