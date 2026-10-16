import Image from "next/image";
import { metadonneesAchillea } from "@/app/achillea/metadonnees";
import { HeroSection } from "@/components/achillea/HeroSection";
import { createAchilleaClient } from "@/lib/achillea";
import { lireChiffresEsport } from "@/lib/achillea/classement";
import { getPgPoolOrNull } from "@/lib/db/pg";
import { ArrowRight, PlayCircle, Video } from "lucide-react";
import type { ParticipantDTO, Tournament } from "@rosegriffon/achillea-types";
import { TournamentState } from "@rosegriffon/achillea-types";

export const revalidate = 60;

export const metadata = metadonneesAchillea({
	titre: "Accueil E-Sport & Tournois",
	description: "Achilléa, le portail compétitif officiel Inazuma Eleven: Victory Road. Tournois, clans et classements classés.",
	chemin: "/achillea",
});

const ACTIVE_STATES = ["Ongoing", "Preparing", "Preregistering", "Open"];

interface PlaylistAchillea {
	id: string;
	titre: string;
	description: string;
	miniature: string;
	url: string;
	videos: number | null;
}

async function chargerPlaylists(): Promise<PlaylistAchillea[]> {
	const key = process.env["YOUTUBE_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
	const channel = process.env["ACHILLEA_YOUTUBE_CHANNEL_ID"];
	if (!key || !channel) return [];

	try {
		const url = new URL("https://www.googleapis.com/youtube/v3/playlists");
		url.searchParams.set("part", "snippet,contentDetails");
		url.searchParams.set("channelId", channel);
		url.searchParams.set("maxResults", "6");
		url.searchParams.set("key", key);
		const response = await fetch(url, { next: { revalidate: 3600 } });
		if (!response.ok) return [];
		const body = await response.json() as { items?: Array<{ id?: string; snippet?: { title?: string; description?: string; thumbnails?: Record<string, { url?: string }> }; contentDetails?: { itemCount?: number } }> };
		return (body.items ?? []).flatMap((item) => {
			if (!item.id) return [];
			const thumbnail = item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url;
			if (!thumbnail) return [];
			return [{
				description: item.snippet?.description ?? "",
				id: item.id,
				miniature: thumbnail,
				titre: item.snippet?.title ?? "Playlist Achilléa",
				url: `https://www.youtube.com/playlist?list=${item.id}`,
				videos: item.contentDetails?.itemCount ?? null,
			}];
		});
	} catch {
		return [];
	}
}

async function loadActiveTournaments(): Promise<{ featured: Tournament | null; featuredParticipants: ParticipantDTO[]; otherActive: Tournament[] }> {
	try {
		const pool = getPgPoolOrNull();
		if (pool) {
			const { rows } = await pool.query<{
				id: number; name: string; starts_at: string | null; tournament_type: string | null;
				status: string; internal_state: string; participants_number: number | null;
				logo: string | null; affiche: string | null;
			}>(`SELECT id, name, starts_at, tournament_type, status, internal_state, participants_number, logo, affiche
				FROM achillea.event WHERE status != 'Canceled' AND internal_state = ANY($1::text[])
				ORDER BY array_position($1::text[], internal_state), starts_at DESC LIMIT 4`, [ACTIVE_STATES]);
			if (rows.length) {
				const asTournament = (row: typeof rows[number]) => ({
					id: row.id, name: row.name, startsAt: row.starts_at ?? new Date().toISOString(),
					tournamentType: row.tournament_type ?? "single_elimination", status: row.status,
					internalState: row.internal_state as TournamentState, participantsNumber: row.participants_number ?? 0,
					logo: row.logo, affiche: row.affiche,
				}) as unknown as Tournament;
				const { rows: participants } = await pool.query<{ id: number; user_id: string; username: string | null; display_name: string | null; avatar: string | null }>(
					`SELECT tp.id, tp.user_id, u.username, u.display_name, u.avatar FROM achillea.tournament_participant tp
					 JOIN achillea."user" u ON u.id = tp.user_id WHERE tp.tournament_id = $1 LIMIT 12`, [rows[0].id]);
				return {
					featured: asTournament(rows[0]),
					featuredParticipants: participants.map((participant) => ({
						id: participant.id, userId: participant.user_id, tournamentId: rows[0].id, status: "registered",
						user: { id: participant.user_id, username: participant.display_name || participant.username || "Joueur", avatar: participant.avatar ?? undefined },
					}) as unknown as ParticipantDTO),
					otherActive: rows.slice(1).map(asTournament),
				};
			}
		}
	} catch (error) {
		console.warn("[achillea] lecture des tournois actifs échouée", error);
	}

	try {
		const response = await createAchilleaClient().tournaments.list({ page: 1, pagination: 12 });
		if (!response.ok) return { featured: null, featuredParticipants: [], otherActive: [] };
		const items = response.value.data.filter((item) => ACTIVE_STATES.includes(item.status ?? ""));
		const details = await Promise.all(items.slice(0, 4).map((item) => createAchilleaClient().tournaments.get(item.id)));
		const loaded = details.flatMap((detail) => detail.ok ? [detail.value] : []);
		const [primary, ...rest] = loaded;
		return primary ? {
			featured: primary[0] as unknown as Tournament,
			featuredParticipants: primary[1] as unknown as ParticipantDTO[],
			otherActive: rest.map(([tournament]) => tournament as unknown as Tournament),
		} : { featured: null, featuredParticipants: [], otherActive: [] };
	} catch {
		return { featured: null, featuredParticipants: [], otherActive: [] };
	}
}

export default async function AchilleaHomePage() {
	const [{ featured, featuredParticipants, otherActive }, stats, playlists] = await Promise.all([
		loadActiveTournaments(), lireChiffresEsport(), chargerPlaylists(),
	]);

	return <div className="achillea-home-page">
		<HeroSection featured={featured} featuredParticipants={featuredParticipants} otherActive={otherActive} stats={stats} />
		{playlists.length > 0 && <section aria-labelledby="vods-title" className="achillea-vods">
			<div className="achillea-vods__header">
				<div><span><Video aria-hidden="true" /> Vidéos</span><h2 id="vods-title">Revoir les matchs</h2></div>
				<a href="https://youtube.com/@Achillea_IE" target="_blank" rel="noopener noreferrer">Chaîne Achilléa <ArrowRight aria-hidden="true" /></a>
			</div>
			<div className="achillea-vods__grid">{playlists.map((playlist) => <a key={playlist.id} href={playlist.url} target="_blank" rel="noopener noreferrer" className="achillea-vods__card">
				<div><Image src={playlist.miniature} alt="" fill unoptimized sizes="(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" /><PlayCircle aria-hidden="true" />{playlist.videos !== null && <span>{playlist.videos} vidéos</span>}</div>
				<h3>{playlist.titre}</h3>{playlist.description && <p>{playlist.description}</p>}
			</a>)}</div>
		</section>}
	</div>;
}
