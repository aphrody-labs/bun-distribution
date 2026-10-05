import { NextResponse } from "next/server";
import {
	formatTimecode,
	isDragonBallMatch,
	MAX_FRAME_IMAGE_BYTES,
	resolveSiteEpisodes,
	siteRefFor,
	sortFrameMatches,
	validateFrameImage,
} from "@/lib/frames-map";
import { bxc, type FrameMatch, type BxcSearchOutput, type BxcVectorOutput } from "@/lib/bxc";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CORS_FRAMES = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
	return new NextResponse(null, { status: 204, headers: CORS_FRAMES });
}

export type { FrameMatch, BxcSearchOutput, BxcVectorOutput };

export async function POST(req: Request) {
	let tempPath: string | null = null;
	try {
		const contentType = req.headers.get("content-type") ?? "";
		let imageBuffer: Uint8Array | ArrayBuffer | null = null;

		if (contentType.includes("multipart/form-data")) {
			let formData: FormData;
			try {
				formData = await req.formData();
			} catch {
				return NextResponse.json(
					{ error: "Payload multipart invalide." },
					{ status: 400, headers: CORS_FRAMES }
				);
			}
			const file = formData.get("file");
			const url = formData.get("url");

			if (file && typeof file === "object" && "arrayBuffer" in file) {
				const blob = file as Blob;
				if (blob.size > MAX_FRAME_IMAGE_BYTES) {
					return NextResponse.json(
						{ error: "L'image dépasse la taille maximale autorisée (8 Mo)." },
						{ status: 400, headers: CORS_FRAMES }
					);
				}
				imageBuffer = await blob.arrayBuffer();
			} else if (typeof url === "string" && url.trim()) {
				const targetUrl = url.trim();
				try {
					const res = await fetch(targetUrl, { signal: AbortSignal.timeout(10000) });
					if (!res.ok) {
						return NextResponse.json(
							{ error: `Impossible de télécharger l'image depuis l'URL fournie (${res.status}).` },
							{ status: 400, headers: CORS_FRAMES }
						);
					}
					const declared = Number(res.headers.get("content-length") ?? 0);
					if (declared > MAX_FRAME_IMAGE_BYTES) {
						return NextResponse.json(
							{ error: "L'image dépasse la taille maximale autorisée (8 Mo)." },
							{ status: 400, headers: CORS_FRAMES }
						);
					}
					imageBuffer = await res.arrayBuffer();
				} catch {
					return NextResponse.json(
						{ error: "Impossible de télécharger l'image depuis l'URL fournie." },
						{ status: 400, headers: CORS_FRAMES }
					);
				}
			}
		} else if (contentType.includes("application/json")) {
			let body: { url?: string; imageBase64?: string };
			try {
				body = (await req.json()) as { url?: string; imageBase64?: string };
			} catch {
				return NextResponse.json(
					{ error: "Payload JSON invalide." },
					{ status: 400, headers: CORS_FRAMES }
				);
			}
			if (body.url) {
				try {
					const res = await fetch(body.url, { signal: AbortSignal.timeout(10000) });
					if (!res.ok) {
						return NextResponse.json(
							{ error: `Impossible de télécharger l'image depuis l'URL (${res.status}).` },
							{ status: 400, headers: CORS_FRAMES }
						);
					}
					const declared = Number(res.headers.get("content-length") ?? 0);
					if (declared > MAX_FRAME_IMAGE_BYTES) {
						return NextResponse.json(
							{ error: "L'image dépasse la taille maximale autorisée (8 Mo)." },
							{ status: 400, headers: CORS_FRAMES }
						);
					}
					imageBuffer = await res.arrayBuffer();
				} catch {
					return NextResponse.json(
						{ error: "Impossible de télécharger l'image depuis l'URL." },
						{ status: 400, headers: CORS_FRAMES }
					);
				}
			} else if (body.imageBase64 && typeof body.imageBase64 === "string") {
				const base64Data = body.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "");
				if (base64Data.trim()) {
					imageBuffer = Buffer.from(base64Data, "base64");
				}
			}
		}

		// Validation unifiée (non vide, taille <= 8 Mo, sniffing magic-bytes JPEG/PNG/WebP/GIF/AVIF)
		const validation = validateFrameImage(imageBuffer);
		if (!validation.ok) {
			return NextResponse.json(
				{ error: validation.error },
				{ status: validation.status, headers: CORS_FRAMES }
			);
		}

		// Écriture temporaire pour le CLI bxc avec l'extension réelle
		const uniqueName = `bxc-frame-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${validation.ext}`;
		tempPath = join(tmpdir(), uniqueName);
		await Bun.write(tempPath, validation.buffer);

		// Exécution de bxc frames vector (MPEG-7 ColorLayout DCT) via le bridge natif
		let vectorData: BxcVectorOutput | null = null;
		try {
			vectorData = await bxc.frames.vector(tempPath);
		} catch (err) {
			console.warn("[bxc-frames-api] Impossible d'extraire le vecteur ColorLayout:", err);
		}

		// Recherche : index LOCAL d'abord, trace.moe seulement en repli.
		//
		// L'ordre compte. Mesuré le 2026-09-12 sur une vignette d'épisode DB,
		// trace.moe renvoyait « Hayate no Gotoku! », « ONE PIECE », « Yu☆Gi☆Oh! »
		// à 54 % — dix correspondances, zéro Dragon Ball. L'index local, lui, ne
		// contient que nos épisodes : quand il répond, il a toujours raison sur
		// le distant. Il est vide tant que `scripts/ops/index-frames.ts` n'a pas
		// tourné, d'où le repli automatique plutôt qu'une page sans résultat.
		const runSearch = async (mode: "--local" | "--remote"): Promise<BxcSearchOutput | null> => {
			try {
				return await bxc.frames.search(tempPath!, mode);
			} catch (err) {
				console.warn(`[bxc-frames-api] recherche ${mode} indisponible:`, err);
				return null;
			}
		};

		let searchData = await runSearch("--local");
		let origin: "local" | "trace.moe" | "none" =
			searchData && searchData.matches.length > 0 ? "local" : "none";
		if (origin === "none") {
			searchData = await runSearch("--remote");
			if (searchData && searchData.matches.length > 0) origin = "trace.moe";
		}

		const raw = (searchData?.matches ?? []).map((match) =>
			origin === "local" ? Object.assign(match, { anilist: undefined }) : match
		);
		// Rattachement aux fiches du site : un résultat qui ne pointe pas vers
		// /wiki/episodes/<id> ou /wiki/films/<slug> ne sert à rien au lecteur.
		const siteEpisodes = await resolveSiteEpisodes(raw);
		const mappedMatches = raw.map((m) => {
			const siteEpisode = siteRefFor(m, siteEpisodes);
			return {
				title: m.title,
				episode: m.episode,
				season: m.season,
				atMs: m.atMs,
				timecode: formatTimecode(m.atMs),
				similarity: Math.round(m.similarity * 1000) / 10, // ex: 94.5%
				isFirm: m.similarity >= 0.85,
				isPlausible: m.similarity >= 0.5 && m.similarity < 0.85,
				/** Faux = correspondance hors univers Dragon Ball (bruit trace.moe). */
				isDragonBall: siteEpisode !== null || isDragonBallMatch(m),
				siteEpisode,
				preview: {
					image: m.preview?.image || siteEpisode?.image || "",
					video: m.preview?.video || "",
				},
				source: m.source,
				anilist: m.anilist,
			};
		});

		// Une frame de Dragon Ball reconnue comme Dragon Ball passe devant le
		// bruit, à similarité égale ou non : c'est la seule information qui
		// intéresse le lecteur d'une fiche d'épisode.
		const matches = sortFrameMatches(mappedMatches);

		return NextResponse.json(
			{
				success: true,
				hash: vectorData?.hash ?? null,
				vector: vectorData?.vector ?? [],
				origin,
				/** Aucune correspondance ne concerne Dragon Ball → à dire au lecteur. */
				offUniverseOnly: matches.length > 0 && matches.every((m) => !m.isDragonBall),
				matches,
				quota: searchData?.quota ?? { used: 0, total: 100 },
			},
			{ headers: CORS_FRAMES }
		);
	} catch (e) {
		console.error("[bxc-frames-api] Erreur interne:", e);
		return NextResponse.json(
			{ error: e instanceof Error ? e.message : "Erreur lors du traitement de la frame." },
			{ status: 500, headers: CORS_FRAMES }
		);
	} finally {
		if (tempPath) {
			try {
				await unlink(tempPath);
			} catch {}
		}
	}
}
