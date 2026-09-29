/**
 * /api/subtitles?src=assets/subtitles/... — sert une piste de sous-titres au
 * lecteur d'épisodes en **WebVTT**, en convertissant à la volée si la source
 * est un `.srt` (les navigateurs ne lisent que le VTT dans `<track>`).
 *
 * Anti-SSRF : `src` doit être un chemin d'asset **relatif** whitelisté
 * (`assets/subtitles/....(srt|vtt)`, pas de `..`, pas de schéma) ; l'hôte est
 * figé sur l'API bot (`SHENRON_API_URL`). Aucune URL arbitraire n'est fetchée.
 * Same-origin pour le navigateur → pas de souci CORS sur `<track>`.
 */
import { ASSET_BASE } from "@/lib/config";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chemin d'asset sous-titres autorisé : seulement sous assets/subtitles/.
const SRC_RE = /^assets\/subtitles\/[A-Za-z0-9._\-/]+\.(srt|vtt)$/;

/** SRT → WebVTT : en-tête + timecodes `,ms` → `.ms`, normalise les CRLF. */
function srtToVtt(srt: string): string {
	const body = srt.replace(/\r+/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
	return `WEBVTT\n\n${body.trim()}\n`;
}

export async function GET(req: NextRequest) {
	const src = (req.nextUrl.searchParams.get("src") ?? "").trim();
	if (!SRC_RE.test(src) || src.includes("..")) {
		return new NextResponse("source invalide", { status: 400 });
	}

	let upstream: Response;
	try {
		upstream = await fetch(`${ASSET_BASE}/${src}`, {
			headers: { accept: "text/vtt, application/x-subrip, text/plain" },
			// Une piste de sous-titres pèse quelques dizaines de kilo-octets : au-delà
			// de dix secondes, l'hôte d'assets est en peine. Sans borne, chaque
			// `<track>` d'une page laisse une requête Next pendante.
			signal: AbortSignal.timeout(10_000),
		});
	} catch {
		return new NextResponse("source injoignable", { status: 502 });
	}
	if (!upstream.ok) {
		return new NextResponse("sous-titres introuvables", {
			status: upstream.status === 404 ? 404 : 502,
		});
	}

	const raw = await upstream.text();
	const vtt = src.endsWith(".srt")
		? srtToVtt(raw)
		: raw.startsWith("WEBVTT")
			? raw
			: `WEBVTT\n\n${raw.trim()}\n`;

	return new NextResponse(vtt, {
		headers: {
			"content-type": "text/vtt; charset=utf-8",
			"cache-control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
}
