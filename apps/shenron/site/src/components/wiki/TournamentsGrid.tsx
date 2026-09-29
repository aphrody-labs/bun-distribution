"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Tournament } from "@/lib/db-universe";
import { assetUrl } from "@/lib/assets";

export function TournamentsGrid({ tournaments, fallbackImage }: { tournaments: Tournament[]; fallbackImage?: string }) {
	const [query, setQuery] = useState("");

	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		if (!q) return tournaments;
		return tournaments.filter((t) => {
			const inName = t.name.toLowerCase().includes(q);
			const inJa = t.name_ja?.toLowerCase().includes(q) ?? false;
			const inWinner = t.winner_name?.toLowerCase().includes(q) ?? false;
			const inSaga = t.saga.toLowerCase().includes(q);
			const inLoc = t.location?.toLowerCase().includes(q) ?? false;
			return inName || inJa || inWinner || inSaga || inLoc;
		});
	}, [tournaments, query]);

	return (
		<div className="space-y-6">
			{/* Recherche */}
			<div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
				<div className="relative flex-1">
					<input
						type="search"
						aria-label="Rechercher un tournoi ou un championnat"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher un tournoi, un vainqueur, une saga (ex: Tenkaichi, Cell Game, Gokū, Satan)..."
						className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="absolute right-3 top-2.5 text-xs text-white/50 hover:text-white"
						>
							Effacer
						</button>
					)}
				</div>
			</div>

			<div className="text-xs text-white/50">
				{filtered.length} tournoi{filtered.length > 1 ? "s" : ""} officiel{filtered.length > 1 ? "s" : ""}
			</div>

			{/* Grille de tournois */}
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
				{filtered.map((t) => (
					<Link
						key={t.slug}
						href={`/wiki/tournois/${t.slug}`}
						className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-6 transition-all hover:-translate-y-1 hover:border-orange-500/50 hover:shadow-xl hover:shadow-orange-950/20"
					>
						<div className="space-y-4">
							{fallbackImage && (
								<div className="h-28 overflow-hidden rounded-xl border border-white/10 bg-black/20">
									<img src={assetUrl(fallbackImage)} alt="Visuel de la catégorie tournois" loading="lazy" className="h-full w-full object-cover opacity-70" />
								</div>
							)}
							<div className="flex items-center justify-between gap-2">
								<span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
									🏆 {t.tournament_type}
								</span>
								<span className="text-xs text-white/50 font-medium">
									{t.saga}
								</span>
							</div>

							<div>
								<h3 className="text-xl font-bold text-white transition-colors group-hover:text-orange-400">
									{t.name}
								</h3>
								{t.name_ja && (
									<div className="text-xs text-white/40 mt-0.5">
										{t.name_ja}
									</div>
								)}
							</div>

							{/* Podium */}
							<div className="grid grid-cols-2 gap-3 rounded-xl bg-black/40 p-3 border border-white/5">
								<div>
									<div className="text-[10px] uppercase font-bold tracking-wider text-amber-400/80">
										🥇 Vainqueur
									</div>
									<div className="text-sm font-bold text-white truncate">
										{t.winner_name ?? "Inconnu"}
									</div>
								</div>
								<div>
									<div className="text-[10px] uppercase font-bold tracking-wider text-white/40">
										🥈 Finaliste
									</div>
									<div className="text-sm font-semibold text-white/70 truncate">
										{t.runner_up_name ?? "Non spécifié"}
									</div>
								</div>
							</div>

							<p className="line-clamp-2 text-xs leading-relaxed text-white/70">
								{t.rules_summary}
							</p>
						</div>

						<div className="mt-5 space-y-3 pt-3 border-t border-white/5">
							{t.notable_matches && t.notable_matches.length > 0 && (
								<div className="space-y-1">
									<div className="text-[10px] uppercase font-bold tracking-wider text-white/40">
										Climax des matchs :
									</div>
									<div className="flex flex-wrap gap-1">
										{t.notable_matches.slice(0, 2).map((m: { round: string; fighterA: string; fighterB: string }) => (
											<span
												key={m.round}
												className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/80"
											>
												🥊 {m.fighterA} vs {m.fighterB}
											</span>
										))}
									</div>
								</div>
							)}

							<div className="flex items-center justify-between text-[11px] text-white/40">
								<span>{t.participants_count ? `${t.participants_count} combattants` : "Championnat"}</span>
								<span className="font-semibold text-orange-400 group-hover:translate-x-0.5 transition-transform">
									Résultats & Tableau →
								</span>
							</div>
						</div>
					</Link>
				))}
			</div>
		</div>
	);
}
