"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Item } from "@/lib/db-universe";
import { assetUrl } from "@/lib/assets";

const CATEGORY_LABELS: Record<string, string> = {
	ALL: "Toutes les catégories",
	technologie: "Technologie & Science",
	relique_magique: "Reliques Magiques",
	vehicule: "Véhicules & Vaisseaux",
	armement: "Armement & Équipement",
	medical: "Médical & Soins",
};

export function ItemsGrid({ items, fallbackImage }: { items: Item[]; fallbackImage?: string }) {
	const [query, setQuery] = useState("");
	const [selectedCategory, setSelectedCategory] = useState("ALL");

	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		return items.filter((it) => {
			if (selectedCategory !== "ALL" && it.category !== selectedCategory) return false;
			if (!q) return true;

			const inName = it.name.toLowerCase().includes(q) || (it.name_ja?.toLowerCase().includes(q) ?? false);
			const inCreator = it.creator?.toLowerCase().includes(q) ?? false;
			const inDesc = it.description.toLowerCase().includes(q);

			return inName || inCreator || inDesc;
		});
	}, [items, query, selectedCategory]);

	return (
		<div className="space-y-6">
			{/* Filtres & Recherche */}
			<div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
				<div className="relative flex-1">
					<input
						type="search"
						aria-label="Rechercher un objet ou une technologie"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher un objet, un inventeur, un véhicule (ex: Radar, Senzu, Bulma, Capsule)..."
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

				<div className="flex flex-wrap gap-1.5">
					{Object.entries(CATEGORY_LABELS).map(([cat, label]) => (
						<button
							key={cat}
							type="button"
							onClick={() => setSelectedCategory(cat)}
							className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
								selectedCategory === cat
									? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
									: "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
							}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			{/* Compteur */}
			<div className="flex items-center justify-between text-xs text-white/50">
				<span>
					{filtered.length} {filtered.length > 1 ? "objets répertoriés" : "objet répertorié"}
				</span>
			</div>

			{/* Grille des objets */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{filtered.map((it) => (
					<Link
						key={it.slug}
						href={`/wiki/objets/${it.slug}`}
						className="group relative flex flex-col justify-between rounded-xl border border-white/10 bg-white/[0.03] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-500/40 hover:bg-white/[0.06] hover:shadow-xl hover:shadow-orange-950/20"
					>
						<div className="space-y-3">
							{(it.image || fallbackImage) && (
								<div className="h-28 overflow-hidden rounded-lg border border-white/10 bg-black/20">
									<img src={assetUrl(it.image ?? fallbackImage)} alt={it.image ? it.name : "Visuel de la catégorie objets"} loading="lazy" className={it.image ? "h-full w-full object-contain" : "h-full w-full object-cover opacity-70"} />
								</div>
							)}
							<div className="flex items-center justify-between gap-2">
								<span className="rounded bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-orange-300 border border-white/10">
									{CATEGORY_LABELS[it.category] ?? it.category}
								</span>
								{it.creator && (
									<span className="text-[11px] text-white/50 truncate max-w-[150px]">
										👤 {it.creator}
									</span>
								)}
							</div>

							<div>
								<h3 className="text-base font-bold text-white group-hover:text-orange-400 transition-colors">
									{it.name}
								</h3>
								{it.name_ja && (
									<p className="text-xs text-white/40 font-mono mt-0.5">{it.name_ja}</p>
								)}
							</div>

							<p className="text-xs text-white/70 leading-relaxed line-clamp-3">
								{it.description}
							</p>
						</div>

						<div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-white/40">
							<span className="truncate max-w-[180px]">
								{it.debut_chapter ? `📖 ${it.debut_chapter}` : "Apparition manga"}
							</span>
							<span className="text-orange-400 font-bold group-hover:translate-x-0.5 transition-transform">
								Explorer →
							</span>
						</div>
					</Link>
				))}
			</div>

			{filtered.length === 0 && (
				<div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center text-white/50">
					Aucun objet ne correspond à votre recherche.
				</div>
			)}
		</div>
	);
}
