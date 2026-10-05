"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ClientGatedWrap } from "@/components/GatedClientLink";
import { useSearchParams, usePathname } from "next/navigation";
import type { Battle } from "@/lib/db-universe";
import {
	Trophy,
	History,
	Sparkles,
	Filter,
	Search,
	X,
	ShieldAlert,
	Flame,
	GitBranch,
	LayoutGrid,
	ExternalLink,
	Film,
} from "lucide-react";

export interface TournamentItem {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	tournament_type: string | null;
	saga: string | null;
	location: string | null;
	winner_name: string | null;
	runner_up_name: string | null;
	rules_summary: string | null;
	participants_count: number | null;
	canon: boolean;
}

export interface TimelineEventItem {
	id: number;
	age_year: number;
	era: string;
	title: string;
	title_ja: string | null;
	description: string;
	characters_involved: string[] | null;
	source_ref: string | null;
	canon: boolean;
}

export type NarrativeEvent =
	| {
			kind: "battle";
			id: number;
			slug: string;
			title: string;
			title_ja: string | null;
			series: string;
			saga_id: number | null;
			arc_id: number | null;
			combatants: Array<{ name: string; role?: string }>;
			winner_name: string | null;
			location: string | null;
			techniques_used: string[] | null;
			manga_volume_start: number | null;
			manga_chapter_start: number | null;
			episode_start?: number | null;
			episode_end?: number | null;
			canon: boolean;
			timeline: "manga-canon" | "anime-toei" | "movies-dbz" | "xenoverse";
			timelineLabel: string;
			href: string;
			sagaSlug?: string;
			sagaName?: string;
			arcSlug?: string;
			arcName?: string;
	  }
	| {
			kind: "tournament";
			id: number;
			slug: string;
			title: string;
			title_ja: string | null;
			series: string;
			winner_name: string | null;
			runner_up_name: string | null;
			location: string | null;
			participants_count: number | null;
			rules_summary: string | null;
			canon: boolean;
			timeline: "manga-canon" | "anime-toei" | "movies-dbz" | "xenoverse";
			timelineLabel: string;
			href: string;
			sagaSlug?: string;
			sagaName?: string;
			arcSlug?: string;
			arcName?: string;
	  }
	| {
			kind: "timeline";
			id: number;
			slug: string;
			title: string;
			title_ja: string | null;
			series: string;
			age_year: number;
			era: string;
			description: string;
			characters_involved: string[] | null;
			source_ref: string | null;
			canon: boolean;
			timeline: "manga-canon" | "anime-toei" | "movies-dbz" | "xenoverse";
			timelineLabel: string;
			href: string;
			sagaSlug?: string;
			sagaName?: string;
			arcSlug?: string;
			arcName?: string;
	  };

export function NarrativeEventsExplorer({
	battles,
	tournaments = [],
	timelineEvents = [],
	sagas = [],
	arcs = [],
}: {
	battles: Battle[];
	tournaments?: TournamentItem[];
	timelineEvents?: TimelineEventItem[];
	sagas?: Array<{ id: number; slug: string; name: string }>;
	arcs?: Array<{ id: number; slug: string; name: string }>;
	fallbackImage?: string;
}) {
	const pathname = usePathname();
	const searchParams = useSearchParams();

	// Initialisation depuis l'URL si présente
	const initialType = searchParams.get("type") || "all";
	const initialCanon = searchParams.get("canon") || "all";
	const initialSaga = searchParams.get("saga") || "all";
	const initialTimeline = searchParams.get("timeline") || "all";
	const initialQuery = searchParams.get("q") || "";

	const [selectedType, setSelectedType] = useState<string>(initialType);
	const [selectedCanon, setSelectedCanon] = useState<string>(initialCanon);
	const [selectedSaga, setSelectedSaga] = useState<string>(initialSaga);
	const [selectedTimeline, setSelectedTimeline] = useState<string>(initialTimeline);
	const [viewMode, setViewMode] = useState<"grid" | "continuity">("grid");
	const [query, setQuery] = useState<string>(initialQuery);

	// Synchronisation URL douce sans rechargement
	const updateUrl = useCallback(
		(typeVal: string, canonVal: string, sagaVal: string, timelineVal: string, qVal: string) => {
			const params = new URLSearchParams();
			if (typeVal !== "all") params.set("type", typeVal);
			if (canonVal !== "all") params.set("canon", canonVal);
			if (sagaVal !== "all") params.set("saga", sagaVal);
			if (timelineVal !== "all") params.set("timeline", timelineVal);
			if (qVal.trim()) params.set("q", qVal.trim());
			const qs = params.toString();
			const newUrl = qs ? `${pathname}?${qs}` : pathname;
			window.history.replaceState(null, "", newUrl);
		},
		[pathname]
	);

	useEffect(() => {
		updateUrl(selectedType, selectedCanon, selectedSaga, selectedTimeline, query);
	}, [selectedType, selectedCanon, selectedSaga, selectedTimeline, query, updateUrl]);

	const sagasMap = useMemo(() => new Map(sagas.map((s) => [s.id, s])), [sagas]);
	const arcsMap = useMemo(() => new Map(arcs.map((a) => [a.id, a])), [arcs]);

	// Unification normalisée de tous les événements
	const allEvents = useMemo<NarrativeEvent[]>(() => {
		const items: NarrativeEvent[] = [];

		for (const b of battles) {
			const isMangaCanon = b.canon && b.series !== "MOVIES" && b.series !== "DBGT" && b.series !== "XV";
			const isMovies = b.series === "MOVIES";
			const isXv = b.series?.includes("XV") || b.series?.toLowerCase().includes("xeno");
			const timeline = isMangaCanon
				? "manga-canon"
				: isMovies
				? "movies-dbz"
				: isXv
				? "xenoverse"
				: "anime-toei";

			const timelineLabel = isMangaCanon
				? "Canon Manga (Toriyama)"
				: isMovies
				? "Films DBZ (Hors-Série)"
				: isXv
				? "⚡ Xenoverse / Multivers"
				: "Toei Animation (DB/DBZ/GT)";

			const saga = b.saga_id ? sagasMap.get(b.saga_id) : undefined;
			const arc = b.arc_id ? arcsMap.get(b.arc_id) : undefined;

			items.push({
				kind: "battle",
				id: b.id,
				slug: b.slug,
				title: b.title,
				title_ja: b.title_ja,
				series: b.series,
				saga_id: b.saga_id,
				arc_id: b.arc_id,
				combatants: b.combatants,
				winner_name: b.winner_name,
				location: b.location,
				techniques_used: b.techniques_used,
				manga_volume_start: b.manga_volume_start,
				manga_chapter_start: b.manga_chapter_start,
				episode_start: b.episode_start,
				episode_end: b.episode_end,
				canon: b.canon,
				timeline,
				timelineLabel,
				href: `/wiki/combats/${b.slug}`,
				sagaSlug: saga?.slug,
				sagaName: saga?.name,
				arcSlug: arc?.slug,
				arcName: arc?.name,
			});
		}

		for (const t of tournaments) {
			const isXv = t.tournament_type?.toLowerCase().includes("xeno") || t.slug.includes("xeno");
			const timeline = isXv
				? "xenoverse"
				: t.canon
				? "manga-canon"
				: "anime-toei";
			const timelineLabel = isXv
				? "⚡ Xenoverse / Multivers"
				: t.canon
				? "Canon Manga (Toriyama)"
				: "Toei Animation";

			let sagaSlug: string | undefined;
			let sagaName: string | undefined;
			if (t.saga) {
				const found = sagas.find((s) => s.slug === t.saga || s.name.toLowerCase().includes(t.saga!.toLowerCase()));
				if (found) {
					sagaSlug = found.slug;
					sagaName = found.name;
				}
			}

			items.push({
				kind: "tournament",
				id: t.id,
				slug: t.slug,
				title: t.name,
				title_ja: t.name_ja,
				series: t.tournament_type ?? "DBZ",
				winner_name: t.winner_name,
				runner_up_name: t.runner_up_name,
				location: t.location,
				participants_count: t.participants_count,
				rules_summary: t.rules_summary,
				canon: t.canon,
				timeline,
				timelineLabel,
				href: `/wiki/tournois/${t.slug}`,
				sagaSlug,
				sagaName,
			});
		}

		// Sélection des événements historiques de conflit/guerre majeurs
		for (const tl of timelineEvents) {
			const isClash =
				/menace|massacre|fléau|bataille|anéantissement|combat|assaut|invasion|guerre/i.test(
					tl.title + " " + tl.description
				);
			if (isClash) {
				const timeline = tl.canon ? "manga-canon" : "anime-toei";
				const timelineLabel = tl.canon ? "Daizenshuu 7 / Canon" : "Anime / Dérivé";
				items.push({
					kind: "timeline",
					id: tl.id,
					slug: `age-${tl.age_year}-${tl.id}`,
					title: tl.title,
					title_ja: tl.title_ja,
					series: "CHRONO",
					age_year: tl.age_year,
					era: tl.era,
					description: tl.description,
					characters_involved: tl.characters_involved,
					source_ref: tl.source_ref,
					canon: tl.canon,
					timeline,
					timelineLabel,
					href: `/wiki/chronologie`,
				});
			}
		}

		return items;
	}, [arcsMap, battles, sagas, sagasMap, tournaments, timelineEvents]);

	// Filtrage multi-critères
	const filteredEvents = useMemo(() => {
		const q = query.toLowerCase().trim();

		return allEvents.filter((ev) => {
			// Filtre par Type d'événement
			if (selectedType === "battles" && ev.kind !== "battle") return false;
			if (selectedType === "tournaments" && ev.kind !== "tournament") return false;
			if (selectedType === "wars" && ev.kind !== "timeline") return false;

			// Filtre Continuité / Timeline
			if (selectedTimeline !== "all" && ev.timeline !== selectedTimeline) return false;

			// Filtre Canonicité
			if (selectedCanon === "canon_manga") {
				if (!ev.canon) return false;
				if (ev.series === "DBGT" || ev.series === "MOVIES") return false;
			} else if (selectedCanon === "canon_supervised") {
				if (ev.series !== "DBS") return false;
			} else if (selectedCanon === "anime_filler") {
				if (ev.canon && ev.series !== "DBGT") return false;
			}

			// Filtre Saga / Époque
			if (selectedSaga !== "all") {
				if (ev.series !== selectedSaga) return false;
			}

			// Recherche textuelle
			if (!q) return true;
			const inTitle = ev.title.toLowerCase().includes(q) || (ev.title_ja?.toLowerCase().includes(q) ?? false);

			let inDetails = false;
			if (ev.kind === "battle") {
				const inCombatants = ev.combatants.some((c) => c.name.toLowerCase().includes(q));
				const inWinner = ev.winner_name?.toLowerCase().includes(q) ?? false;
				const inTechniques = ev.techniques_used?.some((t) => t.toLowerCase().includes(q)) ?? false;
				const inLocation = ev.location?.toLowerCase().includes(q) ?? false;
				inDetails = inCombatants || inWinner || inTechniques || inLocation;
			} else if (ev.kind === "tournament") {
				inDetails =
					(ev.winner_name?.toLowerCase().includes(q) ?? false) ||
					(ev.runner_up_name?.toLowerCase().includes(q) ?? false) ||
					(ev.location?.toLowerCase().includes(q) ?? false);
			} else if (ev.kind === "timeline") {
				inDetails =
					ev.description.toLowerCase().includes(q) ||
					(ev.characters_involved?.some((c) => c.toLowerCase().includes(q)) ?? false);
			}

			return inTitle || inDetails;
		});
	}, [allEvents, selectedType, selectedCanon, selectedSaga, selectedTimeline, query]);

	return (
		<div className="space-y-6">
			{/* Cartouches statistiques de l'univers narratif */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div className="rounded-xl border border-white/10 bg-black/40 p-3.5 backdrop-blur-md">
					<div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Total Événements</div>
					<div className="mt-1 font-saiyan text-2xl text-orange-400">{allEvents.length}</div>
				</div>
				<div className="rounded-xl border border-white/10 bg-black/40 p-3.5 backdrop-blur-md">
					<div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Combats Légendaires</div>
					<div className="mt-1 font-saiyan text-2xl text-white">{battles.length}</div>
				</div>
				<div className="rounded-xl border border-white/10 bg-black/40 p-3.5 backdrop-blur-md">
					<div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Tournois Martiaux</div>
					<div className="mt-1 font-saiyan text-2xl text-amber-400">{tournaments.length}</div>
				</div>
				<div className="rounded-xl border border-white/10 bg-black/40 p-3.5 backdrop-blur-md">
					<div className="text-[10px] font-bold uppercase tracking-wider text-white/40">Événements Filtrés</div>
					<div className="mt-1 font-saiyan text-2xl text-green-400">{filteredEvents.length}</div>
				</div>
			</div>

			{/* Panneau de Contrôle & Facettes Combinables */}
			<div className="rounded-2xl border border-white/10 bg-black/60 p-5 backdrop-blur-xl shadow-2xl space-y-4">
				{/* Ligne 1 : Barre de recherche + Switcher Mode de vue */}
				<div className="flex flex-col sm:flex-row items-center gap-3">
					<div className="relative flex-1 w-full">
						<Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
						<input
							type="search"
							aria-label="Rechercher un événement narratif"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Rechercher un combat, un tournoi, un participant, une technique (ex: Goku, Genkidama, Tenkaichi, Majin Buu)..."
							className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-10 py-2.5 text-xs text-white placeholder-white/40 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
						/>
						{query && (
							<button
								type="button"
								onClick={() => setQuery("")}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
							>
								<X className="h-4 w-4" />
							</button>
						)}
					</div>

					{/* Sélecteur de mode de vue */}
					<div className="flex rounded-xl bg-white/5 p-1 border border-white/10 shrink-0 self-stretch sm:self-auto justify-center">
						<button
							type="button"
							onClick={() => setViewMode("grid")}
							className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
								viewMode === "grid"
									? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
									: "text-white/60 hover:text-white"
							}`}
						>
							<LayoutGrid className="h-3.5 w-3.5" />
							<span>Cartes</span>
						</button>
						<button
							type="button"
							onClick={() => setViewMode("continuity")}
							className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
								viewMode === "continuity"
									? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
									: "text-white/60 hover:text-white"
							}`}
						>
							<GitBranch className="h-3.5 w-3.5" />
							<span>Graphe & Filiations</span>
						</button>
					</div>
				</div>

				{/* Ligne 2 : Facette [Continuités & Timelines] */}
				<div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/10 text-xs">
					<span className="font-bold text-[10px] uppercase tracking-wider text-white/40 mr-1 flex items-center gap-1">
						<GitBranch className="h-3 w-3 text-cyan-400" /> Continuité :
					</span>
					{[
						{ id: "all", label: "Toutes continuités" },
						{ id: "manga-canon", label: "📖 Canon Manga (Toriyama)" },
						{ id: "anime-toei", label: "📺 Toei Animation" },
						{ id: "movies-dbz", label: "🎬 Films DBZ" },
						{ id: "xenoverse", label: "⚡ Time Patrol & Xenoverse (Multivers)" },
					].map((tl) => (
						<button
							key={tl.id}
							type="button"
							onClick={() => setSelectedTimeline(tl.id)}
							className={`rounded-lg px-2.5 py-1 font-semibold transition-all ${
								selectedTimeline === tl.id
									? "bg-cyan-600 text-white shadow-sm"
									: "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
							}`}
						>
							{tl.label}
						</button>
					))}
				</div>

				{/* Ligne 3 : Facettes [Type] & [Canonicité] */}
				<div className="flex flex-wrap items-center gap-3 pt-2 border-t border-white/10 text-xs">
					{/* Type d'événement */}
					<div className="flex flex-wrap items-center gap-1.5">
						<span className="font-bold text-[10px] uppercase tracking-wider text-white/40 mr-1 flex items-center gap-1">
							<Filter className="h-3 w-3 text-orange-400" /> Type :
						</span>
						{[
							{ id: "all", label: "Tous" },
							{ id: "battles", label: "⚔️ Combats" },
							{ id: "tournaments", label: "🥋 Tournois" },
							{ id: "wars", label: "💥 Guerres & Conflits" },
						].map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setSelectedType(tab.id)}
								className={`rounded-lg px-2.5 py-1 font-semibold transition-all ${
									selectedType === tab.id
										? "bg-orange-600 text-white shadow-sm"
										: "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>

					{/* Canonicité */}
					<div className="flex flex-wrap items-center gap-1.5 ml-auto">
						<span className="font-bold text-[10px] uppercase tracking-wider text-white/40 mr-1 flex items-center gap-1">
							<ShieldAlert className="h-3 w-3 text-amber-400" /> Canon :
						</span>
						{[
							{ id: "all", label: "Toutes continuités" },
							{ id: "canon_manga", label: "🌟 Manga 42 tomes" },
							{ id: "canon_supervised", label: "⚡ Super (Canon)" },
							{ id: "anime_filler", label: "📺 Anime / Fillers" },
						].map((c) => (
							<button
								key={c.id}
								type="button"
								onClick={() => setSelectedCanon(c.id)}
								className={`rounded-lg px-2.5 py-1 font-semibold transition-all ${
									selectedCanon === c.id
										? "bg-amber-600 text-white shadow-sm"
										: "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
								}`}
							>
								{c.label}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* Bannière d'isolation de la Patrouille du Temps (Xenoverse) */}
			{selectedTimeline === "xenoverse" && (
				<div className="rounded-2xl border-2 border-purple-500/40 bg-gradient-to-r from-purple-950/60 via-black/80 to-purple-950/40 p-5 text-purple-200 backdrop-blur-xl shadow-2xl">
					<div className="flex items-center gap-2 font-saiyan text-lg text-purple-300">
						<Sparkles className="h-5 w-5 text-purple-400" />
						<span>ESPACE ISOLÉ : LIGNES TEMPORELLES DÉRIVÉES &amp; PATROUILLE DU TEMPS</span>
					</div>
					<p className="mt-2 text-xs leading-relaxed text-purple-200/90">
						Les événements, tournois et altérations temporelles répertoriés ici (Xenoverse, Dragon Ball Heroes, Briseurs de Temps) sont <strong>strictement dissociés de la continuité officielle du manga d&apos;Akira Toriyama</strong>. Ils constituent des variations multiverselles supervisées pour l&apos;univers vidéoludique.
					</p>
				</div>
			)}

			{/* Vue 1 : Grille des Événements Narratifs */}
			{filteredEvents.length === 0 ? (
				<div className="rounded-2xl border border-white/10 bg-black/40 p-12 text-center backdrop-blur-md">
					<p className="text-sm font-semibold text-white/70">Aucun événement ne correspond à vos critères.</p>
					<button
						type="button"
						onClick={() => {
							setSelectedType("all");
							setSelectedCanon("all");
							setSelectedSaga("all");
							setSelectedTimeline("all");
							setQuery("");
						}}
						className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20"
					>
						Réinitialiser tous les filtres
					</button>
				</div>
			) : viewMode === "grid" ? (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{filteredEvents.map((ev) => {
						const timelineBadgeClass =
							ev.timeline === "manga-canon"
								? "border-amber-500/40 bg-amber-950/60 text-amber-300"
								: ev.timeline === "movies-dbz"
								? "border-rose-500/40 bg-rose-950/60 text-rose-300"
								: ev.timeline === "xenoverse"
								? "border-purple-500/60 bg-purple-950/80 text-purple-300 ring-1 ring-purple-500/40"
								: "border-blue-500/40 bg-blue-950/60 text-blue-300";

						const isXv = ev.timeline === "xenoverse";

						if (ev.kind === "battle") {
							return (
								<article
									key={`battle-${ev.id}`}
									className={`group flex flex-col justify-between rounded-2xl border p-5 backdrop-blur-md transition-all duration-300 hover:shadow-xl ${
										isXv
											? "border-purple-500/40 bg-gradient-to-b from-purple-950/30 to-black/60 hover:border-purple-500/70 hover:shadow-purple-950/30 ring-1 ring-purple-500/20"
											: "border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] hover:border-orange-500/40 hover:shadow-orange-950/20"
									}`}
								>
									<div>
										<div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
											<span className={`rounded-md border px-2 py-0.5 font-bold uppercase ${
												isXv ? "border-purple-500/40 bg-purple-950/60 text-purple-300" : "border-orange-500/30 bg-orange-950/60 text-orange-400"
											}`}>
												{isXv ? "Altération Temporelle" : `Combat · ${ev.series}`}
											</span>
											<span className={`rounded-md border px-2 py-0.5 font-bold ${timelineBadgeClass}`}>
												{ev.timelineLabel}
											</span>
										</div>

										<h3 className="mt-3 text-base font-bold text-white group-hover:text-orange-400 transition-colors">
											<Link href={ev.href}>{ev.title}</Link>
										</h3>
										{ev.title_ja && (
											<p className="mt-0.5 text-xs text-white/40 font-jp">{ev.title_ja}</p>
										)}

										{/* Rapprochement Saga & Arc narratif */}
										{(ev.sagaSlug || ev.arcSlug) && (
											<div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
												{ev.sagaSlug && (
													<ClientGatedWrap
														access={undefined}
														href={`/wiki/sagas/${ev.sagaSlug}`}
														className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 font-semibold text-amber-300 hover:border-amber-400 hover:text-white transition-colors"
													>
														<span>📖</span>
														<span>Saga {ev.sagaName || ev.sagaSlug}</span>
													</ClientGatedWrap>
												)}
												{ev.arcSlug && (
													<ClientGatedWrap
														access={undefined}
														href={`/wiki/arcs/${ev.arcSlug}`}
														className="inline-flex items-center gap-1 rounded-md border border-orange-500/20 bg-orange-950/30 px-2 py-0.5 text-orange-300/90 hover:border-orange-400 hover:text-white transition-colors"
													>
														<span>⚔️</span>
														<span>Arc {ev.arcName || ev.arcSlug}</span>
													</ClientGatedWrap>
												)}
											</div>
										)}

										{/* Combattants */}
										<div className="mt-4 space-y-1.5">
											<div className="text-[10px] uppercase tracking-wider text-white/40">Participants</div>
											<div className="flex flex-wrap gap-1.5">
												{ev.combatants.map((c, i) => (
													<span
														key={i}
														className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-white/80"
													>
														{c.name}
													</span>
												))}
											</div>
										</div>

										{/* Filiation d'adaptation manga ↔ anime */}
										{ev.manga_volume_start && ev.episode_start && (
											<div className="mt-3 rounded-lg border border-orange-500/20 bg-orange-950/30 px-2.5 py-1.5 text-[11px] text-orange-200/90 flex items-center justify-between">
												<span className="font-mono">Tome {ev.manga_volume_start} ↔ Épisode {ev.episode_start}</span>
												<span className="text-[10px] font-bold uppercase tracking-wider text-orange-400">Adaptation Toei</span>
											</div>
										)}

										{/* Vainqueur & Lieu */}
										<div className="mt-3 flex flex-wrap gap-3 text-xs text-white/60">
											{ev.winner_name && (
												<span>
													🏆 Vainqueur : <strong className="text-white">{ev.winner_name}</strong>
												</span>
											)}
											{ev.location && (
												<span>📍 {ev.location}</span>
											)}
										</div>

										{/* Techniques */}
										{ev.techniques_used && ev.techniques_used.length > 0 && (
											<div className="mt-3 flex flex-wrap gap-1 text-[10px] text-orange-300">
												{ev.techniques_used.slice(0, 3).map((t, idx) => (
													<span key={idx} className="rounded bg-orange-500/10 px-1.5 py-0.5">
														⚡ {t}
													</span>
												))}
											</div>
										)}
									</div>

									<div className="mt-5 border-t border-white/10 pt-3 flex items-center justify-between text-xs text-white/50">
										{ev.manga_volume_start && (
											<span>Tome {ev.manga_volume_start}</span>
										)}
										<Link
											href={ev.href}
											className="font-semibold text-orange-400 hover:text-white transition-colors ml-auto inline-flex items-center gap-1"
										>
											<span>Fiche tactique</span>
											<span>→</span>
										</Link>
									</div>
								</article>
							);
						}

						if (ev.kind === "tournament") {
							const isTournXv = ev.timeline === "xenoverse";
							return (
								<article
									key={`tourn-${ev.id}`}
									className={`group flex flex-col justify-between rounded-2xl border p-5 backdrop-blur-md transition-all duration-300 hover:shadow-xl ${
										isTournXv
											? "border-purple-500/40 bg-gradient-to-b from-purple-950/30 to-black/60 hover:border-purple-500/70 hover:shadow-purple-950/30 ring-1 ring-purple-500/20"
											: "border-amber-500/20 bg-gradient-to-b from-amber-950/20 to-black/40 hover:border-amber-500/50 hover:shadow-amber-950/30"
									}`}
								>
									<div>
										<div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
											<span className={`rounded-md border px-2 py-0.5 font-bold uppercase flex items-center gap-1 ${
												isTournXv
													? "border-purple-500/40 bg-purple-950/60 text-purple-300"
													: "border-amber-500/30 bg-amber-950/60 text-amber-300"
											}`}>
												<Trophy className="h-3 w-3" /> {isTournXv ? "Tournoi Multivers" : "Tournoi Martial"}
											</span>
											<span className={`rounded-md border px-2 py-0.5 font-bold ${timelineBadgeClass}`}>
												{ev.timelineLabel}
											</span>
										</div>

										<h3 className="mt-3 text-base font-bold text-white group-hover:text-amber-400 transition-colors">
											<Link href={ev.href}>{ev.title}</Link>
										</h3>
										{ev.title_ja && (
											<p className="mt-0.5 text-xs text-white/40 font-jp">{ev.title_ja}</p>
										)}

										{/* Rapprochement Saga */}
										{ev.sagaSlug && (
											<div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
												<ClientGatedWrap
													access={undefined}
													href={`/wiki/sagas/${ev.sagaSlug}`}
													className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 font-semibold text-amber-300 hover:border-amber-400 hover:text-white transition-colors"
												>
													<span>📖</span>
													<span>Saga {ev.sagaName || ev.sagaSlug}</span>
												</ClientGatedWrap>
											</div>
										)}

										<div className="mt-4 space-y-1.5 text-xs text-white/70">
											{ev.winner_name && (
												<div>
													🥇 Champion : <strong className="text-white">{ev.winner_name}</strong>
												</div>
											)}
											{ev.runner_up_name && (
												<div>
													🥈 Finaliste : <span className="text-white/80">{ev.runner_up_name}</span>
												</div>
											)}
											{ev.location && (
												<div>📍 Lieu : {ev.location}</div>
											)}
										</div>

										{ev.rules_summary && (
											<p className="mt-3 text-[11px] leading-relaxed text-white/60 line-clamp-2">
												{ev.rules_summary}
											</p>
										)}
									</div>

									<div className="mt-5 border-t border-white/10 pt-3 flex items-center justify-between text-xs text-white/50">
										{ev.participants_count && (
											<span>{ev.participants_count} compétiteurs</span>
										)}
										<Link
											href={ev.href}
											className="font-semibold text-amber-400 hover:text-white transition-colors ml-auto inline-flex items-center gap-1"
										>
											<span>Tableau & Matchs</span>
											<span>→</span>
										</Link>
									</div>
								</article>
							);
						}

						// Événement historique / Chronologie
						return (
							<article
								key={`timeline-${ev.id}`}
								className="group flex flex-col justify-between rounded-2xl border border-blue-500/20 bg-gradient-to-b from-blue-950/20 to-black/40 p-5 backdrop-blur-md transition-all duration-300 hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-950/30"
							>
								<div>
									<div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
										<span className="rounded-md border border-blue-500/30 bg-blue-950/60 px-2 py-0.5 font-bold uppercase text-blue-300 flex items-center gap-1">
											<History className="h-3 w-3" /> Conflit Historique
										</span>
										<span className="font-mono text-blue-300 font-bold">
											Age {ev.age_year}
										</span>
									</div>

									<h3 className="mt-3 text-base font-bold text-white group-hover:text-blue-400 transition-colors">
										<Link href={ev.href}>{ev.title}</Link>
									</h3>
									{ev.title_ja && (
										<p className="mt-0.5 text-xs text-white/40 font-jp">{ev.title_ja}</p>
									)}

									<p className="mt-3 text-xs leading-relaxed text-white/70 line-clamp-3">
										{ev.description}
									</p>

									{ev.characters_involved && ev.characters_involved.length > 0 && (
										<div className="mt-3 flex flex-wrap gap-1">
											{ev.characters_involved.map((ch, i) => (
												<span key={i} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/70">
													{ch}
												</span>
											))}
										</div>
									)}
								</div>

								<div className="mt-5 border-t border-white/10 pt-3 flex items-center justify-between text-xs text-white/50">
									{ev.source_ref && (
										<span className="truncate max-w-[150px]">{ev.source_ref}</span>
									)}
									<Link
										href={ev.href}
										className="font-semibold text-blue-400 hover:text-white transition-colors ml-auto inline-flex items-center gap-1"
									>
										<span>Frise chronologique</span>
										<span>→</span>
									</Link>
								</div>
							</article>
						);
					})}
				</div>
			) : (
				/* Vue 2 : Matrice de Filiation & Continuités Multi-Timelines */
				<div className="space-y-4">
					<div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4 text-xs text-cyan-200/90 leading-relaxed">
						<span className="font-bold text-cyan-300">Matrice de filiation & adaptations :</span> cette vue met en parallèle le tronc canonique du manga original de Toriyama et ses ramifications (adaptations télévisées Toei Animation, films hors-série et variantes de jeux vidéo).
					</div>

					<div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md">
						<table className="w-full text-left text-xs text-white/80">
							<thead className="bg-white/5 text-[10px] uppercase tracking-wider text-white/50 border-b border-white/10">
								<tr>
									<th className="p-3.5">Événement & Titre</th>
									<th className="p-3.5">Continuité / Timeline</th>
									<th className="p-3.5">Ancrage Manga (Canon)</th>
									<th className="p-3.5">Adaptation Anime / Variante</th>
									<th className="p-3.5 text-right">Lien</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-white/5">
								{filteredEvents.map((ev) => {
									return (
										<tr key={`matrix-${ev.kind}-${ev.id}`} className="hover:bg-white/[0.03] transition-colors">
											<td className="p-3.5">
												<div className="font-bold text-white">
													<Link href={ev.href} className="hover:text-orange-400 transition-colors">
														{ev.title}
													</Link>
												</div>
												{ev.title_ja && (
													<div className="text-[10px] text-white/40 font-jp">{ev.title_ja}</div>
												)}
											</td>
											<td className="p-3.5">
												<span
													className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold ${
														ev.timeline === "manga-canon"
															? "border-amber-500/40 bg-amber-950/60 text-amber-300"
															: ev.timeline === "movies-dbz"
															? "border-rose-500/40 bg-rose-950/60 text-rose-300"
															: ev.timeline === "xenoverse"
															? "border-cyan-500/40 bg-cyan-950/60 text-cyan-300"
															: "border-purple-500/40 bg-purple-950/60 text-purple-300"
													}`}
												>
													{ev.timelineLabel}
												</span>
											</td>
											<td className="p-3.5 font-mono text-[11px]">
												{ev.kind === "battle" && ev.manga_volume_start ? (
													<span className="text-amber-300">
														Tome {ev.manga_volume_start}
														{ev.manga_chapter_start ? ` (ch. ${ev.manga_chapter_start})` : ""}
													</span>
												) : ev.kind === "timeline" ? (
													<span className="text-blue-300">Age {ev.age_year}</span>
												) : (
													<span className="text-white/30">—</span>
												)}
											</td>
											<td className="p-3.5 font-mono text-[11px]">
												{ev.kind === "battle" && ev.episode_start ? (
													<span className="text-purple-300">
														Épisode {ev.episode_start}
														{ev.episode_end && ev.episode_end !== ev.episode_start ? `-${ev.episode_end}` : ""}
													</span>
												) : ev.timeline === "movies-dbz" ? (
													<span className="text-rose-300">Film d&apos;animation</span>
												) : ev.timeline === "xenoverse" ? (
													<span className="text-cyan-300">Variante Time Patrol</span>
												) : (
													<span className="text-white/30">—</span>
												)}
											</td>
											<td className="p-3.5 text-right">
												<Link
													href={ev.href}
													className="inline-flex items-center gap-1 font-semibold text-orange-400 hover:text-white transition-colors"
												>
													<span>Explorer</span>
													<span>↗</span>
												</Link>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}
