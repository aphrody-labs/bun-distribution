import { VideoSourceSummary as PortableVideoSourceSummary } from "@shenron/ui/server";
import type { Lecteur } from "./VideoLecteurs";

/** Shenron vocabulary adapter for the portable source-summary presentation. */
export function VideoSourceSummary({ players, subtitles = 0, frames = 0 }: { players: Lecteur[]; subtitles?: number; frames?: number }) {
	return <PortableVideoSourceSummary players={players} subtitles={subtitles} frames={frames} labels={{ aria: "Ressources disponibles", players: "Lecteurs", providers: "Fournisseurs", versions: "Versions", subtitles: "Sous-titres", frames: "Scènes indexées", none: "Aucune source", external: "Externe" }} />;
}
