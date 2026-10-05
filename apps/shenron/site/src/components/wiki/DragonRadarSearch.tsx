"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ClientGatedWrap } from "@/components/GatedClientLink";
import {
	DragonRadar,
	Livre,
	Etoile,
	Kame,
} from "@/components/icones";
import { assetUrl } from "@/lib/assets";

type SearchScope = "all" | "canon" | "manga" | "anime" | "lore";

interface SearchResultsState {
	characters: Array<{
		id: number;
		name: string;
		slug: string;
		image?: string | null;
		description?: string | null;
	}>;
	techniques: Array<{ id: number; name: string; slug: string; type?: string | null }>;
	transformations: Array<{ id: number; name: string; ki?: string | null }>;
	sagas: Array<{ id: number; name: string; slug: string }>;
	episodes: Array<{ id: number; episode_number: number; title: string; series?: string | null }>;
	movies: Array<{ id: number; title: string; release_year?: number | null }>;
	mangaChapters: Array<{
		id: number;
		chapter_number: number;
		title: string | null;
		series?: string | null;
	}>;
	mangaVolumes: Array<{
		id: number;
		volume_number: number;
		title: string | null;
		series?: string | null;
		cover?: string | null;
	}>;
	battles: Array<{ id: number; name: string; slug: string }>;
	tournaments: Array<{ id: number; name: string; slug: string }>;
}

interface CanonVerdictData {
	nature: "verdict" | "troll" | "inconnu";
	verdict: string;
	explanation: string;
	tier: string;
	tierLabel: string;
	score: number;
	color: string;
	sources?: string[];
}

export function DragonRadarSearch({ initialQuery = "" }: { initialQuery?: string }) {
	const [query, setQuery] = useState(initialQuery);
	const [debouncedQ, setDebouncedQ] = useState(initialQuery);
	const [scope, setScope] = useState<SearchScope>("all");
	const [isLoading, setIsLoading] = useState(false);
	const [results, setResults] = useState<SearchResultsState | null>(null);
	const [canonData, setCanonData] = useState<CanonVerdictData | null>(null);

	// Debounce query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQ(query.trim());
		}, 300);
		return () => clearTimeout(timer);
	}, [query]);

	// La recherche générale reste une recherche documentaire. L'arbitre de
	// canonicité n'est interrogé que lorsqu'il est demandé explicitement : un nom
	// comme « Gogeta » ne doit jamais substituer une fiche de doctrine à une
	// question de comparaison ou de force.
	useEffect(() => {
		if (!debouncedQ) {
			setResults(null);
			setCanonData(null);
			setIsLoading(false);
			return;
		}

		let active = true;
		setIsLoading(true);

		const fetchSearch = async () => {
			try {
				const searchRes = await fetch(`/api/search?q=${encodeURIComponent(debouncedQ)}`).then(
					(r) => (r.ok ? r.json() : null)
				);
				const canonRes =
					scope === "canon"
						? await fetch(`/api/canon?q=${encodeURIComponent(debouncedQ)}`).then((r) =>
								r.ok ? r.json() : null
							)
						: null;

				if (!active) return;

				if (searchRes) {
					setResults(searchRes);
				}
				if (canonRes && canonRes.verdict) {
					setCanonData(canonRes.verdict);
				} else {
					setCanonData(null);
				}
			} catch (e) {
				console.error("Dragon Radar search error:", e);
			} finally {
				if (active) setIsLoading(false);
			}
		};

		void fetchSearch();

		return () => {
			active = false;
		};
	}, [debouncedQ, scope]);

	const totalResultsCount = useMemo(() => {
		if (!results) return 0;
		return (
			results.characters.length +
			results.techniques.length +
			results.transformations.length +
			results.sagas.length +
			results.episodes.length +
			results.movies.length +
			results.mangaChapters.length +
			results.mangaVolumes.length +
			results.battles.length +
			results.tournaments.length
		);
	}, [results]);

	const SUGGESTIONS = [
		"Broly",
		"Super Saiyan 4",
		"Dragon Ball GT",
		"Gogeta",
		"Vegetto",
		"Ultra Instinct",
		"Baddack",
		"Kamehameha",
		"Cell Game",
		"Dragon Ball Daima",
	];

	return (
		<div className="space-y-8">
			{/* Dragon Radar Terminal Visuel */}
			<div className="relative mx-auto w-full max-w-2xl rounded-3xl border-4 border-[#143d23] bg-[#07170c] p-6 shadow-[0_0_60px_rgba(16,185,129,0.2)]">
				{/* Antenne / Molette supérieure du Dragon Radar */}
				<div className="absolute -top-6 left-1/2 -translate-x-1/2 flex items-center gap-1">
					<div className="h-6 w-12 rounded-t-lg border-2 border-b-0 border-[#1b5430] bg-[#103a20] shadow-inner" />
					<div className="h-3 w-4 -mt-2 rounded-full bg-amber-400 border border-amber-600 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
				</div>

				{/* En-tête Scouter / Écran Radar */}
				<div className="relative z-10 flex items-center justify-between border-b border-emerald-500/20 pb-3 text-emerald-400 font-mono text-[11px] uppercase tracking-widest">
					<div className="flex items-center gap-2">
						<span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
						<span>DRAGON RADAR // FREQ. 777.42 MHz</span>
					</div>
					<div className="hidden sm:flex items-center gap-3 text-emerald-400/70">
						<span>GRID: ACTIVE</span>
						<span>CAPTEURS: ON</span>
					</div>
				</div>

				{/* Écran Radar Circulaire Rétro-Vert */}
				<div className="relative my-6 mx-auto aspect-[16/9] sm:aspect-[2/1] w-full overflow-hidden rounded-2xl border-2 border-emerald-500/30 bg-[#041208] p-4 flex flex-col items-center justify-center shadow-[inset_0_0_40px_rgba(16,185,129,0.2)]">
					{/* Texture grille CRT et cercles concentriques */}
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:20px_20px] opacity-15" />

					{/* Cercles concentriques radar */}
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
						<div className="h-[90%] aspect-square rounded-full border border-emerald-500/20" />
						<div className="absolute h-[65%] aspect-square rounded-full border border-emerald-500/20" />
						<div className="absolute h-[40%] aspect-square rounded-full border border-emerald-500/25" />
						<div className="absolute h-[15%] aspect-square rounded-full border border-emerald-500/30" />
						{/* Axes X et Y */}
						<div className="absolute h-full w-px bg-emerald-500/20" />
						<div className="absolute w-full h-px bg-emerald-500/20" />
					</div>

					{/* Balayage Radar (Sweep Animation) */}
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
						<div
							className="h-full w-full rounded-full opacity-30 origin-center"
							style={{
								background:
									"conic-gradient(from 0deg at 50% 50%, rgba(16, 185, 129, 0.4) 0deg, transparent 60deg, transparent 360deg)",
								animation: "spin 4s linear infinite",
							}}
						/>
					</div>

					{/* Points Lumineux Radar (Blips) */}
					{totalResultsCount > 0 && (
						<div className="pointer-events-none absolute inset-0">
							<div className="absolute top-[30%] left-[40%] h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-ping" />
							<div className="absolute top-[60%] right-[35%] h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b] animate-ping delay-300" />
							<div className="absolute top-[45%] right-[25%] h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse" />
						</div>
					)}

					{/* Zone de recherche centrale sur le Radar */}
					<div className="relative z-20 w-full max-w-lg px-4 text-center">
						<label htmlFor="dragon-radar-query" className="sr-only">
							Rechercher dans l'univers Dragon Ball
						</label>
						<div className="relative flex items-center">
							<span className="absolute left-3.5 text-emerald-400">
								<DragonRadar className="w-5 h-5 animate-pulse" />
							</span>
							<input
								id="dragon-radar-query"
								type="search"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Poser une question, chercher un épisode, chapitre ou combattant..."
								className="w-full rounded-xl border-2 border-emerald-500/50 bg-black/80 py-3 pl-11 pr-10 text-sm font-bold text-emerald-300 placeholder-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)] focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
							/>
							{query && (
								<button
									type="button"
									onClick={() => setQuery("")}
									className="absolute right-3 text-xs text-emerald-400 hover:text-white"
									aria-label="Effacer la recherche"
								>
									✕
								</button>
							)}
						</div>
					</div>
				</div>

				{/* Boutons de Filtre de Portée (Scope) */}
				<div className="flex flex-wrap items-center justify-center gap-2 border-t border-emerald-500/20 pt-4">
					{[
						{ id: "all" as SearchScope, label: "Tout Détecter" },
						{ id: "canon" as SearchScope, label: "Canonicité & Arbitre" },
						{ id: "manga" as SearchScope, label: "Manga & Scans" },
						{ id: "anime" as SearchScope, label: "Animé & Films" },
						{ id: "lore" as SearchScope, label: "Encyclopédie & Lore" },
					].map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => setScope(item.id)}
							className={`rounded-lg px-3 py-1.5 font-mono text-xs font-bold uppercase transition-all ${
								scope === item.id
									? "bg-emerald-500 text-black shadow-[0_0_10px_rgba(16,185,129,0.5)] font-black"
									: "border border-emerald-500/30 bg-emerald-950/30 text-emerald-400/80 hover:border-emerald-500/60 hover:text-emerald-300"
							}`}
						>
							{item.label}
						</button>
					))}
				</div>

				{/* Suggestions de recherche */}
				<div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-xs">
					<span className="font-mono text-[10px] uppercase tracking-wider text-emerald-400/60 mr-1">
						Cibles Rapides :
					</span>
					{SUGGESTIONS.map((sug) => (
						<button
							key={sug}
							type="button"
							onClick={() => setQuery(sug)}
							className="rounded-full border border-emerald-500/20 bg-emerald-950/40 px-2.5 py-0.5 font-mono text-[10px] text-emerald-300/80 hover:border-emerald-400 hover:text-emerald-200 transition-colors"
						>
							{sug}
						</button>
					))}
				</div>
			</div>

			{/* Zone d'affichage des résultats radar */}
			{isLoading && (
				<div className="p-8 text-center font-mono text-xs text-emerald-400 animate-pulse">
					Balayage des ondes radar en cours... Détection des fréquences Dragon Ball...
				</div>
			)}

			{!isLoading && debouncedQ && (
				<div className="space-y-8 reveal-up">
					{/* 1. Résultat Canonicité Arbitré (si scope = all ou canon) */}
					{(scope === "all" || scope === "canon") &&
						canonData &&
						canonData.nature === "verdict" && (
							<div
								className="rounded-2xl border p-5 backdrop-blur-md transition-all shadow-xl"
								style={{ borderColor: canonData.color, backgroundColor: `${canonData.color}10` }}
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="flex items-center gap-2">
										<span className="text-xl">⚖️</span>
										<span
											className="font-mono text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
											style={{ backgroundColor: `${canonData.color}30`, color: canonData.color }}
										>
											{canonData.tierLabel}
										</span>
									</div>
									<div className="font-mono text-xs text-white/60">
										Indice de Canonicité :{" "}
										<strong className="text-white">{canonData.score} / 100</strong>
									</div>
								</div>
								<p className="mt-3 font-display text-lg sm:text-xl font-bold text-white">
									{canonData.verdict}
								</p>
								<p className="mt-2 text-xs sm:text-sm leading-relaxed text-white/80">
									{canonData.explanation}
								</p>
							</div>
						)}

					{/* 2. Manga & Scans (si scope = all ou manga) */}
					{(scope === "all" || scope === "manga") &&
						results &&
						(results.mangaChapters.length > 0 || results.mangaVolumes.length > 0) && (
							<section className="space-y-4">
								<div className="flex items-center gap-2 border-b border-white/10 pb-2">
									<Livre className="w-5 h-5 text-orange-400" />
									<h3 className="font-saiyan text-xl text-white tracking-wider">
										Manga &amp; Lectures Numérisées (
										{results.mangaChapters.length + results.mangaVolumes.length})
									</h3>
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
									{results.mangaChapters.slice(0, 6).map((ch) => (
										<Link
											key={ch.id}
											href={`/wiki/manga/${ch.id}`}
											className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:border-orange-500 hover:bg-orange-950/20 transition-all group"
										>
											<div>
												<span className="text-[10px] font-mono text-orange-400 uppercase font-bold">
													{ch.series ?? "DB"} · Chapitre {ch.chapter_number}
												</span>
												<div className="text-xs font-bold text-white group-hover:text-orange-300 line-clamp-1">
													{ch.title || `Chapitre ${ch.chapter_number}`}
												</div>
											</div>
											<span className="text-xs text-orange-400 font-bold ml-2">Lire →</span>
										</Link>
									))}
									{results.mangaVolumes.slice(0, 3).map((vol) => (
										<Link
											key={vol.id}
											href={`/wiki/manga/volume/${vol.id}`}
											className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:border-orange-500 hover:bg-orange-950/20 transition-all group"
										>
											{vol.cover && (
												<img
													src={assetUrl(vol.cover)}
													alt={`Volume ${vol.volume_number}`}
													className="h-12 w-8 object-cover rounded shadow"
												/>
											)}
											<div>
												<span className="text-[10px] font-mono text-amber-400 uppercase font-bold">
													{vol.series} · Tome {vol.volume_number}
												</span>
												<div className="text-xs font-bold text-white group-hover:text-orange-300 line-clamp-1">
													{vol.title || `Tome ${vol.volume_number}`}
												</div>
											</div>
										</Link>
									))}
								</div>
							</section>
						)}

					{/* 3. Animé & Films (si scope = all ou anime) */}
					{(scope === "all" || scope === "anime") &&
						results &&
						(results.episodes.length > 0 || results.movies.length > 0) && (
							<section className="space-y-4">
								<div className="flex items-center gap-2 border-b border-white/10 pb-2">
									<span className="text-xl">📺</span>
									<h3 className="font-saiyan text-xl text-white tracking-wider">
										Animé &amp; Films ({results.episodes.length + results.movies.length})
									</h3>
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
									{results.episodes.slice(0, 6).map((ep) => (
										<Link
											key={ep.id}
											href={`/wiki/episodes/${ep.id}`}
											className="p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:border-sky-500 hover:bg-sky-950/20 transition-all group block"
										>
											<span className="text-[10px] font-mono text-sky-400 uppercase font-bold">
												{ep.series ?? "Dragon Ball"} · Épisode {ep.episode_number}
											</span>
											<div className="text-xs font-bold text-white group-hover:text-sky-300 line-clamp-1">
												{ep.title}
											</div>
										</Link>
									))}
									{results.movies.map((m) => (
										<Link
											key={m.id}
											href={`/wiki/films/${m.id}`}
											className="p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:border-sky-500 hover:bg-sky-950/20 transition-all group block"
										>
											<span className="text-[10px] font-mono text-sky-400 uppercase font-bold">
												Film {m.release_year ? `(${m.release_year})` : ""}
											</span>
											<div className="text-xs font-bold text-white group-hover:text-sky-300 line-clamp-1">
												{m.title}
											</div>
										</Link>
									))}
								</div>
							</section>
						)}

					{/* 4. Encyclopédie & Lore (si scope = all ou lore) */}
					{(scope === "all" || scope === "lore") &&
						results &&
						(results.characters.length > 0 ||
							results.techniques.length > 0 ||
							results.sagas.length > 0) && (
							<section className="space-y-4">
								<div className="flex items-center gap-2 border-b border-white/10 pb-2">
									<Kame className="w-5 h-5 text-dbz-yellow" />
									<h3 className="font-saiyan text-xl text-white tracking-wider">
										Encyclopédie &amp; Lore (
										{results.characters.length + results.techniques.length + results.sagas.length})
									</h3>
								</div>
								<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
									{results.characters.slice(0, 6).map((c) => (
										<ClientGatedWrap
											key={c.id}
											access={undefined}
											href={`/wiki/personnages/${c.id}`}
											className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:border-yellow-500 hover:bg-yellow-950/20 transition-all group"
										>
											{c.image && (
												<img
													src={assetUrl(c.image)}
													alt={c.name}
													className="h-10 w-10 object-cover rounded-full border border-white/10"
												/>
											)}
											<div className="min-w-0 flex-1">
												<div className="text-xs font-bold text-white group-hover:text-yellow-300 truncate">
													{c.name}
												</div>
												{c.description && (
													<div className="text-[10px] text-white/50 truncate">{c.description}</div>
												)}
											</div>
										</ClientGatedWrap>
									))}
									{results.techniques.slice(0, 6).map((t) => (
										<ClientGatedWrap
											key={t.id}
											access={undefined}
											href={`/wiki/techniques/${t.slug}`}
											className="p-3 rounded-xl border border-white/10 bg-white/[0.03] hover:border-yellow-500 hover:bg-yellow-950/20 transition-all group block"
										>
											<span className="text-[10px] font-mono text-yellow-400 uppercase font-bold">
												Technique · {t.type ?? "Ki"}
											</span>
											<div className="text-xs font-bold text-white group-hover:text-yellow-300 truncate">
												{t.name}
											</div>
										</ClientGatedWrap>
									))}
								</div>
							</section>
						)}

					{totalResultsCount === 0 && !canonData && (
						<div className="p-8 text-center text-xs text-white/50 italic border border-white/10 rounded-2xl bg-black/40">
							Aucun signal détecté sur le Dragon Radar pour &laquo;&nbsp;{debouncedQ}&nbsp;&raquo;.
							Essayez un autre terme ou un nom canonique.
						</div>
					)}
				</div>
			)}
		</div>
	);
}
