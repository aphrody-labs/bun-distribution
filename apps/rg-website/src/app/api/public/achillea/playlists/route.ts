import { NextResponse } from "next/server";

/**
 * Playlists YouTube d'Achilléa.
 *
 * POURQUOI UNE ROUTE SERVEUR ET PAS UN APPEL DEPUIS LE NAVIGATEUR
 * Le front Angular appelait `googleapis.com/youtube/v3/playlists` directement
 * depuis la page, avec la clé d'API dans l'URL (`views/homepage/homepage.ts:535`).
 * Une clé posée dans une requête navigateur est une clé publique : n'importe
 * quel visiteur peut la relever et consommer le quota du projet. On appelle
 * donc depuis le serveur, et la clé ne quitte jamais la machine.
 *
 * POURQUOI LA PAGE N'INVENTAIT RIEN NON PLUS AVANT
 * Vérification faite : `achillea-config.js` livre `youtubeApiKey: ""` et
 * `youtubeChannelId: ""`. L'appel échouait donc systématiquement, y compris en
 * production Angular, et la page retombait sur deux playlists codées en dur —
 * avec des compteurs figés (« 15 vidéos », « 14 vidéos ») qui n'ont plus été
 * exacts depuis leur écriture. Le portage Next avait conservé ce repli en
 * supprimant l'appel : il ne restait que les chiffres faux.
 *
 * Ici : si la clé existe, on sert les vraies playlists avec leur vrai nombre de
 * vidéos. Sinon on rend une liste vide et la page n'affiche pas de section —
 * mieux vaut pas de vitrine qu'une vitrine qui ment.
 */

export const revalidate = 3600;

export interface PlaylistAchillea {
	id: string;
	titre: string;
	description: string;
	miniature: string;
	url: string;
	/** Nombre de vidéos, `null` si l'API ne l'a pas fourni. */
	videos: number | null;
}

interface ElementYoutube {
	id?: string;
	snippet?: {
		title?: string;
		description?: string;
		thumbnails?: Record<string, { url?: string } | undefined>;
	};
	contentDetails?: { itemCount?: number };
}

export async function GET(): Promise<NextResponse> {
	const cle = process.env["YOUTUBE_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
	const chaine = process.env["ACHILLEA_YOUTUBE_CHANNEL_ID"];

	if (!cle || !chaine) {
		// 200 et liste vide, pas une erreur : l'absence de configuration n'est pas
		// une panne, et la page doit pouvoir s'afficher sans cette section.
		return NextResponse.json(
			{ configure: false, playlists: [] satisfies PlaylistAchillea[] },
			{ headers: { "cache-control": "public, max-age=300" } }
		);
	}

	const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
	url.searchParams.set("part", "snippet,contentDetails");
	url.searchParams.set("channelId", chaine);
	url.searchParams.set("maxResults", "6");
	url.searchParams.set("key", cle);

	try {
		const reponse = await fetch(url, { next: { revalidate } });
		if (!reponse.ok) {
			return NextResponse.json({ configure: true, playlists: [] }, { status: 200 });
		}

		const corps = (await reponse.json()) as { items?: ElementYoutube[] };
		const playlists: PlaylistAchillea[] = (corps.items ?? [])
			.filter((item): item is ElementYoutube & { id: string } => typeof item.id === "string")
			.map((item) => ({
				description: item.snippet?.description || "",
				id: item.id,
				miniature:
					item.snippet?.thumbnails?.["medium"]?.url ??
					item.snippet?.thumbnails?.["default"]?.url ??
					"",
				titre: item.snippet?.title ?? "",
				url: `https://www.youtube.com/playlist?list=${item.id}`,
				videos:
					typeof item.contentDetails?.itemCount === "number"
						? item.contentDetails.itemCount
						: null,
			}));

		return NextResponse.json({ configure: true, playlists });
	} catch {
		return NextResponse.json({ configure: true, playlists: [] }, { status: 200 });
	}
}
