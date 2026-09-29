"use client";

/**
 * Grille d'une série — recherche par titre ou numéro + rendu progressif.
 *
 * La page posait jusqu'à 1 000 cartes d'un seul bloc (Dragon Ball Z en compte
 * 291), sans recherche, sans filtre, sans saut au numéro : trouver l'épisode 187
 * demandait de faire défiler 187 vignettes. Le motif « voir plus » existait
 * pourtant déjà à côté, dans `CharacterGrid` — il n'avait simplement jamais été
 * appliqué ici.
 *
 * La recherche est locale : le jeu complet est déjà dans la page (rendu par le
 * serveur), donc filtrer ne coûte aucun aller-retour et fonctionne hors ligne.
 */
import { useEffect, useMemo, useState } from "react";
import { Recherche } from "@/components/icones";
import { EpisodeCard } from "@/components/stream/EpisodeCard";

export interface SeriesEpisode {
	id: number;
	number: number | null;
	title: string;
	titleJa: string | null;
	image: string | null;
	synopsis: string | null;
	year: number | null;
	hasVf: boolean;
	hasVostfr: boolean;
	playerCount: number;
}

/** Palier de rendu — au-delà, « voir plus ». */
const PAGE = 60;

/** Normalise pour une recherche insensible casse/accents. */
const fold = (s: string) =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase();

export function EpisodeSeriesGrid({ episodes }: { episodes: SeriesEpisode[] }) {
	const [query, setQuery] = useState("");
	const [limit, setLimit] = useState(PAGE);
	const [language, setLanguage] = useState<"all" | "vf" | "vostfr">("all");

	const filtered = useMemo(() => {
		const q = fold(query.trim());
		// Une requête purement numérique cible le NUMÉRO d'épisode en priorité :
		// « 187 » doit trouver l'épisode 187, pas les titres contenant « 187 ».
		const asNumber = /^\d+$/.test(q) ? Number(q) : null;
		return episodes.filter((e) => {
			if (language === "vf" && !e.hasVf) return false;
			if (language === "vostfr" && !e.hasVostfr) return false;
			if (!q) return true;
			if (asNumber !== null && e.number === asNumber) return true;
			return fold(`${e.title} ${e.titleJa ?? ""}`).includes(q);
		});
	}, [episodes, query, language]);

	// Toute nouvelle recherche repart du premier palier : sinon, filtrer après
	// avoir déroulé 200 cartes laisserait une liste courte déjà « tout affichée ».
	useEffect(() => {
		setLimit(PAGE);
	}, [query, language]);

	const visible = filtered.slice(0, limit);
	const remaining = filtered.length - visible.length;
	const vfCount = episodes.filter((episode) => episode.hasVf).length;
	const vostfrCount = episodes.filter((episode) => episode.hasVostfr).length;
	const imageCount = episodes.filter((episode) => episode.image).length;

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Couverture de la série">
				{[
					["Épisodes", episodes.length],
					["VF disponible", vfCount],
					["VOSTFR", vostfrCount],
					["Vignettes", imageCount],
				].map(([label, value]) => (
					<div key={label} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
						<div className="text-xl font-black tabular-nums text-white sm:text-2xl">{value}</div>
						<div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div>
					</div>
				))}
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative min-w-[220px] flex-1 max-w-md">
					<Recherche
						className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50"
						aria-hidden
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						aria-label="Rechercher un épisode par titre ou par numéro"
						placeholder="Titre ou numéro d'épisode…"
						className="h-10 w-full rounded-lg border border-dbz-border bg-dbz-bg/70 pl-9 pr-3 text-[14px] text-white outline-none placeholder:text-white/50 focus:border-dbz-orange"
					/>
				</div>
				<a
					href="#episode-grid"
					className="inline-flex min-h-10 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-white/70 hover:border-dbz-orange/50 hover:text-dbz-orange"
				>
					Aller aux épisodes
				</a>
				<div
					className="flex gap-2 overflow-x-auto pb-1"
					role="group"
					aria-label="Filtrer par version"
				>
					{(
						[
							["all", "Toutes"],
							["vf", `VF (${vfCount})`],
							["vostfr", `VOSTFR (${vostfrCount})`],
						] as const
					).map(([key, label]) => (
						<button
							key={key}
							type="button"
							onClick={() => setLanguage(key)}
							aria-pressed={language === key}
							className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold transition ${language === key ? "bg-dbz-orange text-black" : "bg-white/[0.06] text-white/65 hover:bg-white/[0.12] hover:text-white"}`}
						>
							{label}
						</button>
					))}
				</div>
				<p className="text-[13px] text-white/50" aria-live="polite">
					{filtered.length} épisode{filtered.length > 1 ? "s" : ""}
					{query && filtered.length !== episodes.length ? ` sur ${episodes.length}` : ""}
				</p>
			</div>

			{filtered.length === 0 ? (
				<p className="dbz-panel py-12 text-center text-white/50">
					Aucun épisode ne correspond à « {query} ».
				</p>
			) : (
				<>
					<div
						id="episode-grid"
						className="grid scroll-mt-6 grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
					>
						{visible.map((ep) => (
							<EpisodeCard
								key={ep.id}
								href={`/wiki/episodes/${ep.id}`}
								number={ep.number}
								title={ep.title}
								titleJa={ep.titleJa}
								image={ep.image}
								synopsis={ep.synopsis}
								year={ep.year}
								hasVf={ep.hasVf}
								hasVostfr={ep.hasVostfr}
								playerCount={ep.playerCount}
								width="full"
							/>
						))}
					</div>
					{remaining > 0 && (
						<div className="pt-2 text-center">
							<button
								type="button"
								onClick={() => setLimit((n) => n + PAGE)}
								className="dbz-button-ghost !text-xs"
							>
								Afficher {Math.min(PAGE, remaining)} épisodes de plus
								<span className="ml-2 text-white/50">
									{visible.length} / {filtered.length}
								</span>
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
