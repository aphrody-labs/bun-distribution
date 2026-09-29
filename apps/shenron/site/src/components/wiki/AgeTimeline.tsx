"use client";

import { useMemo, useState } from "react";
import type { TimelineEvent } from "@/lib/db-universe";
import { useT } from "@/components/T";

const ERA_LABELS: Record<string, { label: string; color: string; desc: string }> = {
	ALL: {
		label: "Toutes les ères",
		color: "text-white",
		desc: "L'histoire complète de la création de l'univers jusqu'à l'Âge 801.",
	},
	"pre-history": {
		label: "Ère Antique & Origines (Âge -4237 à 736)",
		color: "text-purple-400",
		desc: "Naissance des Kaïōshins, menace de Majin Buu, légendes saiyennes et guerre des Tsufuls.",
	},
	"jeunesse-goku": {
		label: "Jeunesse de Son Goku (Âge 737 à 756)",
		color: "text-amber-400",
		desc: "Arrivée sur Terre, quête des Dragon Balls avec Bulma, tournois et défaite de Piccolo Daimaō.",
	},
	"saiyan-namek": {
		label: "Guerriers de l'Espace & Namek (Âge 761 à 763)",
		color: "text-blue-400",
		desc: "Arrivée de Raditz, invasion de Vegeta et Nappa, éveil du Super Saiyan face à Freeza.",
	},
	"cyborgs-cell": {
		label: "Cyborgs & Cell Games (Âge 764 à 767)",
		color: "text-emerald-400",
		desc: "Avertissement de Trunks, menace du Dr Gero, sacrifice de Goku et Kaméhaméha Père-Fils de Gohan.",
	},
	"majin-buu": {
		label: "Ère Majin Buu (Âge 774)",
		color: "text-pink-400",
		desc: "Résurrection de Buu, sacrifice de Majin Vegeta, fusion Vegetto et Genkidama universel.",
	},
	"super-dieux": {
		label: "Ère des Dieux (Âge 778 à 780)",
		color: "text-cyan-400",
		desc: "Éveil du Dieu Beerus, Super Saiyan Blue, multivers et Tournoi du Pouvoir.",
	},
	"fin-manga": {
		label: "Épilogue du Manga & Post-Canon (Âge 784 à 801)",
		color: "text-yellow-400",
		desc: "28e Tenkaichi Budokai, envol avec Uub et fin des 42 tomes canoniques.",
	},
};

export function AgeTimeline({ events }: { events: TimelineEvent[] }) {
	const [query, setQuery] = useState("");
	const [selectedEra, setSelectedEra] = useState("ALL");
	const t = useT();

	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		return events.filter((e) => {
			if (selectedEra !== "ALL" && e.era !== selectedEra) return false;
			if (!q) return true;

			const inTitle = e.title.toLowerCase().includes(q) || (e.title_ja?.toLowerCase().includes(q) ?? false);
			const inDesc = e.description.toLowerCase().includes(q);
			const inYear = `âge ${e.age_year}`.includes(q) || `${e.age_year}`.includes(q);
			const inChars = e.characters_involved?.some((c) => c.toLowerCase().includes(q)) ?? false;

			return inTitle || inDesc || inYear || inChars;
		});
	}, [events, query, selectedEra]);

	return (
		<div className="space-y-8">
			{/* En-tête explicatif */}
			<div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-2">
				<h3 className="text-sm font-bold uppercase tracking-wider text-orange-400">
					{t("wikiTimeline.title")}
				</h3>
				<p className="text-xs text-white/70 leading-relaxed">
					{t("wikiTimeline.intro")}
				</p>
			</div>

			{/* Contrôles de filtrage */}
			<div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
				<div className="relative flex-1">
					<input
						type="search"
						aria-label={t("wikiTimeline.search")}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("wikiTimeline.placeholder")}
						className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="absolute right-3 top-2.5 text-xs text-white/50 hover:text-white"
						>
							{t("wikiTimeline.clear")}
						</button>
					)}
				</div>

				<div className="flex flex-wrap gap-1.5">
					{Object.keys(ERA_LABELS).map((k) => (
						<button
							key={k}
							type="button"
							onClick={() => setSelectedEra(k)}
							className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
								selectedEra === k
									? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
									: "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
							}`}
						>
							{k === "ALL" ? t("wikiTimeline.allEras") : k}
						</button>
					))}
				</div>
			</div>

			{/* Frise chronologique verticale */}
			<div className="relative pl-6 sm:pl-8 space-y-8 before:absolute before:left-2 sm:before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-gradient-to-b before:from-orange-500 before:via-amber-500 before:to-orange-500/20">
				{filtered.map((ev) => (
					<div key={ev.id} className="relative group">
						{/* Nœud lumineux */}
						<div className="absolute -left-[27px] sm:-left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-orange-500 bg-black group-hover:bg-orange-400 transition-colors shadow-[0_0_8px_rgba(249,115,22,0.8)]" />

						{/* Carte événement */}
						<div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md transition-all group-hover:border-orange-500/40 group-hover:bg-white/[0.05]">
							<div className="flex flex-wrap items-center justify-between gap-2 mb-2">
								<div className="flex items-center gap-2">
									<span className="rounded-lg bg-orange-500/20 border border-orange-500/30 px-2.5 py-0.5 font-mono text-xs font-bold text-orange-400">
										{t("wikiTimeline.age")} {ev.age_year < 0 ? `-${Math.abs(ev.age_year)}` : ev.age_year}
									</span>
									{ev.canon && (
										<span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
											{t("wikiTimeline.canon")}
										</span>
									)}
								</div>

								{ev.source_ref && (
									<span className="text-[11px] text-white/40 italic">
										📖 {ev.source_ref}
									</span>
								)}
							</div>

							<h4 className="text-base font-bold text-white group-hover:text-orange-300 transition-colors">
								{ev.title}
							</h4>
							{ev.title_ja && (
								<p className="text-xs font-mono text-white/40 mt-0.5 mb-2">{ev.title_ja}</p>
							)}

							<p className="text-sm leading-relaxed text-white/80 mt-2">
								{ev.description}
							</p>

							{ev.characters_involved && ev.characters_involved.length > 0 && (
								<div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap items-center gap-1.5">
									<span className="text-[11px] text-white/40 mr-1">{t("wikiTimeline.characters")} :</span>
									{ev.characters_involved.map((ch) => (
										<span
											key={ch}
											className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/70"
										>
											{ch}
										</span>
									))}
								</div>
							)}
						</div>
					</div>
				))}

				{filtered.length === 0 && (
					<div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50 text-xs">
						{t("wikiTimeline.empty")}
					</div>
				)}
			</div>
		</div>
	);
}
