"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { RatingBadge } from "@/components/ratings/Stars";
import { assetUrl } from "@/lib/assets";
import type { Game } from "@/lib/db-universe";

type RatingData = {
	average: number;
	count: number;
};

type GamesExplorerProps = {
	games: Game[];
	ratings: Record<string, RatingData>;
};

type PlatformGroup = "all" | "playstation" | "nintendo" | "xbox" | "pc" | "mobile" | "arcade";
type SortOption = "rating-desc" | "date-desc" | "date-asc" | "title-asc";

const PLATFORM_GROUPS: Array<{ id: PlatformGroup; label: string; icon: string }> = [
	{ id: "all", label: "Toutes les plateformes", icon: "🎮" },
	{ id: "playstation", label: "PlayStation", icon: "🟦" },
	{ id: "nintendo", label: "Nintendo", icon: "🟥" },
	{ id: "xbox", label: "Xbox", icon: "🟩" },
	{ id: "pc", label: "PC / Steam", icon: "💻" },
	{ id: "mobile", label: "Mobile (iOS / Android)", icon: "📱" },
	{ id: "arcade", label: "Arcade", icon: "🕹️" },
];

function matchPlatform(platforms: string | null | undefined, group: PlatformGroup): boolean {
	if (group === "all") return true;
	if (!platforms) return false;
	const p = platforms.toLowerCase();
	switch (group) {
		case "playstation":
			return /ps[1-5]|playstation|psp|vita/i.test(p);
		case "nintendo":
			return /switch|wii|gamecube|n64|snes|nes|famicom|ds|3ds|gba|game boy/i.test(p);
		case "xbox":
			return /xbox/i.test(p);
		case "pc":
			return /pc|windows|steam/i.test(p);
		case "mobile":
			return /ios|android|mobile/i.test(p);
		case "arcade":
			return /arcade/i.test(p);
		default:
			return true;
	}
}

function cleanExcerpt(text: string | null | undefined, max = 170): string {
	if (!text) return "";
	const clean = text
		.replace(/_?\(Sources?\s*:[^)]*\)_?/gi, "")
		.replace(/[*_#>`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

export function GamesExplorer({ games, ratings }: GamesExplorerProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedPlatform, setSelectedPlatform] = useState<PlatformGroup>("all");
	const [sortBy, setSortBy] = useState<SortOption>("date-desc");

	const filteredGames = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();

		return games
			.filter((g) => {
				// Filtre plateforme
				if (!matchPlatform(g.platforms, selectedPlatform)) return false;

				// Filtre recherche
				if (!q) return true;
				const titleMatch = g.title.toLowerCase().includes(q);
				const titleJaMatch = g.title_ja ? g.title_ja.toLowerCase().includes(q) : false;
				const devMatch = g.developer ? g.developer.toLowerCase().includes(q) : false;
				const pubMatch = g.publisher ? g.publisher.toLowerCase().includes(q) : false;
				const descMatch = g.description ? g.description.toLowerCase().includes(q) : false;
				const platMatch = g.platforms ? g.platforms.toLowerCase().includes(q) : false;

				return titleMatch || titleJaMatch || devMatch || pubMatch || descMatch || platMatch;
			})
			.toSorted((a, b) => {
				const rA = ratings[String(a.id)]?.average ?? 0;
				const rB = ratings[String(b.id)]?.average ?? 0;
				const countA = ratings[String(a.id)]?.count ?? 0;
				const countB = ratings[String(b.id)]?.count ?? 0;

				if (sortBy === "rating-desc") {
					if (rB !== rA) return rB - rA;
					if (countB !== countA) return countB - countA;
					return (b.release_date ?? 0) - (a.release_date ?? 0);
				}
				if (sortBy === "date-desc") {
					return (b.release_date ?? 0) - (a.release_date ?? 0);
				}
				if (sortBy === "date-asc") {
					return (a.release_date ?? 0) - (b.release_date ?? 0);
				}
				if (sortBy === "title-asc") {
					return a.title.localeCompare(b.title, "fr");
				}
				return 0;
			});
	}, [games, ratings, searchQuery, selectedPlatform, sortBy]);

	return (
		<div className="space-y-8">
			{/* Barre d'outils filtres et recherche */}
			<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6 backdrop-blur-md space-y-4">
				<div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
					{/* Recherche */}
					<div className="relative flex-1">
						<span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 text-sm">
							🔍
						</span>
						<input
							type="search"
							aria-label="Rechercher un jeu"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Rechercher un jeu, un studio, une plateforme..."
							className="w-full rounded-xl border border-white/10 bg-black/40 pl-10 pr-4 py-2.5 text-sm text-white placeholder-white/40 focus:border-dbz-orange/60 focus:outline-none focus:ring-1 focus:ring-dbz-orange/60 transition"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery("")}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 hover:text-white"
								aria-label="Effacer la recherche"
							>
								✕
							</button>
						)}
					</div>

					{/* Tri */}
					<div className="flex items-center gap-2">
						<label htmlFor="games-sort" className="text-xs font-semibold text-white/60 shrink-0">
							Trier par :
						</label>
						<select
							id="games-sort"
							value={sortBy}
							onChange={(e) => setSortBy(e.target.value as SortOption)}
							className="rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs font-medium text-white focus:border-dbz-orange/60 focus:outline-none"
						>
							<option value="date-desc">Date de sortie (récents)</option>
							<option value="date-asc">Date de sortie (anciens)</option>
							<option value="rating-desc">Meilleures notes des fans</option>
							<option value="title-asc">Ordre alphabétique (A-Z)</option>
						</select>
					</div>
				</div>

				{/* Boutons plateformes */}
				<div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
					{PLATFORM_GROUPS.map((group) => {
						const isSelected = selectedPlatform === group.id;
						return (
							<button
								key={group.id}
								type="button"
								onClick={() => setSelectedPlatform(group.id)}
								className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
									isSelected
										? "bg-dbz-orange text-black font-bold shadow-md shadow-dbz-orange/20"
										: "bg-white/[0.05] text-white/70 hover:bg-white/10 hover:text-white"
								}`}
							>
								<span>{group.icon}</span>
								<span>{group.label}</span>
							</button>
						);
					})}
				</div>

				{/* Compteur résultats */}
				<div className="flex items-center justify-between text-xs text-white/50 pt-1">
					<span>
						{filteredGames.length} titre{filteredGames.length > 1 ? "s" : ""} affiché
						{filteredGames.length > 1 ? "s" : ""} sur {games.length}
					</span>
					{(searchQuery || selectedPlatform !== "all") && (
						<button
							type="button"
							onClick={() => {
								setSearchQuery("");
								setSelectedPlatform("all");
							}}
							className="text-dbz-orange/90 hover:underline hover:text-dbz-orange"
						>
							Réinitialiser les filtres
						</button>
					)}
				</div>
			</div>

			{/* Grille des jeux */}
			{filteredGames.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-12 text-center">
					<span className="text-4xl">🕹️</span>
					<h3 className="mt-3 text-base font-bold text-white">Aucun jeu vidéo ne correspond</h3>
					<p className="mt-1 text-xs text-white/50 max-w-md mx-auto">
						Modifiez votre terme de recherche ou sélectionnez une autre catégorie de console pour explorer la ludothèque Dragon Ball.
					</p>
					<button
						type="button"
						onClick={() => {
							setSearchQuery("");
							setSelectedPlatform("all");
						}}
						className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-dbz-orange/40 bg-dbz-orange/10 px-4 py-2 text-xs font-bold text-dbz-orange hover:bg-dbz-orange/20 transition"
					>
						Voir tous les jeux
					</button>
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
					{filteredGames.map((g) => {
						const r = ratings[String(g.id)];
						const platformsList = (g.platforms ?? "")
							.split(",")
							.map((p) => p.trim())
							.filter(Boolean);

						return (
							<Link
								key={g.id}
								href={`/wiki/jeux/${g.slug}`}
								className="group flex flex-col rounded-2xl bg-white/[0.03] border border-white/[0.08] hover:border-dbz-orange/60 hover:bg-white/[0.06] transition-all duration-300 overflow-hidden hover:shadow-xl hover:shadow-dbz-orange/5"
							>
								{/* Pochette avec badge de note */}
								<div className="relative aspect-[3/4] bg-zinc-950 overflow-hidden">
									{g.cover ? (
										<Image
											src={assetUrl(g.cover)}
											alt={g.title}
											fill
											sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
											className="object-cover group-hover:scale-105 transition-transform duration-500"
										/>
									) : (
										<div className="flex h-full w-full items-center justify-center bg-zinc-900 text-white/20 text-3xl font-display">
											🎮
										</div>
									)}
									<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

									{/* Badge canonique / statut narratif */}
									<div className="absolute top-2.5 left-2.5 z-10">
										<span className="inline-flex items-center gap-1 rounded-md bg-black/80 backdrop-blur-md border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/80">
											Univers Dérivé
										</span>
									</div>

									{/* Badge note top right */}
									{r && r.count > 0 && (
										<div className="absolute top-2.5 right-2.5 z-10">
											<span className="inline-flex items-center gap-1 rounded-full bg-black/85 backdrop-blur-md border border-dbz-orange/40 px-2.5 py-0.5 text-[11px] font-display font-bold text-dbz-orange shadow-lg">
												★ {r.average.toFixed(1)}
											</span>
										</div>
									)}

									{/* Année en bas de l'image */}
									{g.release_date && (
										<div className="absolute bottom-2.5 left-2.5 z-10">
											<span className="inline-flex items-center rounded bg-black/70 px-2 py-0.5 text-[11px] font-mono font-medium text-white/90 backdrop-blur-sm">
												{new Date(g.release_date * 1000).getFullYear()}
											</span>
										</div>
									)}
								</div>

								{/* Détails du jeu */}
								<div className="flex flex-col flex-1 p-5">
									<h3 className="font-display font-bold text-lg text-white group-hover:text-dbz-orange transition-colors line-clamp-1 mb-1">
										{g.title}
									</h3>

									{g.title_ja && (
										<p className="font-jp text-xs text-dbz-orange/80 mb-3 truncate">
											{g.title_ja}
										</p>
									)}

									<div className="mb-3">
										<RatingBadge average={r?.average ?? 0} count={r?.count ?? 0} />
									</div>

									{g.description && (
										<p className="text-xs leading-relaxed text-white/60 mb-4 line-clamp-3">
											{cleanExcerpt(g.description)}
										</p>
									)}

									{/* Plateformes */}
									{platformsList.length > 0 && (
										<div className="flex flex-wrap gap-1.5 mb-4 mt-auto">
											{platformsList.slice(0, 4).map((p) => (
												<span
													key={p}
													className="text-[10px] font-display font-semibold tracking-wider uppercase px-2 py-0.5 rounded-md bg-white/[0.06] text-white/75"
												>
													{p}
												</span>
											))}
											{platformsList.length > 4 && (
												<span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/[0.04] text-white/50">
													+{platformsList.length - 4}
												</span>
											)}
										</div>
									)}

									{/* Métadonnées développeur / éditeur */}
									<dl className="text-[11px] text-white/60 border-t border-white/5 pt-3 space-y-0.5">
										{g.developer && (
											<div className="truncate">
												<dt className="inline text-white/40">Studio : </dt>
												<dd className="inline text-white/80">{g.developer}</dd>
											</div>
										)}
										{g.publisher && (
											<div className="truncate">
												<dt className="inline text-white/40">Éditeur : </dt>
												<dd className="inline text-white/80">{g.publisher}</dd>
											</div>
										)}
									</dl>
								</div>
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}
