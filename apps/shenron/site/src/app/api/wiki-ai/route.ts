/**
 * /api/wiki-ai — assistant wiki **RAG-only** (pas de génération LLM, gate admin).
 *
 * L'admin donne une requête/instruction (ex. « powerscaling de Goku ») ; on
 * interroge le pipeline RAG du bot (`dbUniverse.rag`, hybride + rerank, sourcé) et
 * on renvoie les passages + un brouillon markdown STITCHÉ (extraits réels + liens
 * de sources). Déterministe, cité, gratuit — l'admin relit et insère lui-même.
 */
import { isCurrentUserAdmin } from "@/lib/session";
import { dbUniverse } from "@/lib/db-universe";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nettoie un snippet RAG (retire les marqueurs de surbrillance FTS). */
function clean(s: string): string {
	return (s || "").replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
	if (!(await isCurrentUserAdmin())) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const body = (await req.json().catch(() => null)) as {
		query?: string;
		limit?: number;
		entity?: string;
	} | null;
	const query = body?.query?.trim();
	if (!query) return NextResponse.json({ error: "query requise" }, { status: 400 });
	const limit = Math.min(12, Math.max(1, Number(body?.limit) || 8));

	const rag = await dbUniverse.rag(
		query,
		limit,
		body?.entity ? { entity: body.entity } : undefined
	);
	const results = (rag?.results ?? []).map((r) => ({
		title: r.title,
		url: r.url,
		snippet: clean(r.snippet),
		score: r.score ?? null,
		kind: r.kind,
	}));

	// Brouillon markdown : extraits sourcés (dédupliqués), puis bloc « Sources ».
	const seen = new Set<string>();
	const paras: string[] = [];
	const sources: { title: string; url: string }[] = [];
	for (const r of results) {
		const key = r.snippet.slice(0, 60).toLowerCase();
		if (r.snippet.length > 20 && !seen.has(key)) {
			seen.add(key);
			paras.push(r.snippet);
		}
		if (r.url && !sources.some((s) => s.url === r.url)) {
			sources.push({ title: r.title || r.url, url: r.url });
		}
	}
	let markdown = paras.join("\n\n");
	if (sources.length > 0) {
		markdown += `\n\n**Sources :** ${sources.map((s) => `[${s.title}](${s.url})`).join(" · ")}`;
	}

	return NextResponse.json({
		query,
		mode: rag?.mode ?? null,
		results,
		markdown: markdown.trim(),
	});
}
