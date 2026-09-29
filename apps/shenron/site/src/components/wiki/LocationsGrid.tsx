"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Location } from "@/lib/db-universe";

import { assetUrl } from "@/lib/assets";

const LOCATION_IMAGES: Record<string, string> = {
	"mont-paozu": "/wiki/planets/Planete_Terre.webp",
	"mont-frypan": "/wiki/planets/Planete_Terre.webp",
	"village-pingouin": "/wiki/planets/Planete_Terre.webp",
	"qg-armee-red-ribbon": "/wiki/planets/Planete_Terre.webp",
	"muscle-tower": "/wiki/planets/Planete_Terre.webp",
	"palais-uranai-baba": "/wiki/planets/Planete_Terre.webp",
	"capitale-de-l-ouest": "/wiki/planets/Planete_Terre.webp",
	"king-castle": "/wiki/planets/Planete_Terre.webp",
	"terre-sacree-karin": "/wiki/planets/Planete_Terre.webp",
	"laboratoire-dr-gero": "/wiki/planets/Planete_Terre.webp",
	"ginger-town": "/wiki/planets/Planete_Terre.webp",
	"arene-cell-game": "/wiki/planets/Planete_Terre.webp",
	"nouvelle-planete-namek": "/wiki/planets/Nouvelle_Planete_Namek.webp",
	"planete-sadala": "/wiki/planets/Planete_Sadala.webp",
	"planete-vampa": "/wiki/planets/Planete_Vampa.webp",
	"village-jingle": "/wiki/planets/Planete_Terre.webp",
	"ile-entrainement-kame": "/wiki/planets/Planete_Terre.webp",
	"chemin-du-serpent": "/wiki/planets/Planete_de_Maitre_Kaio.webp",
	"arene-monde-du-vide": "/wiki/planets/Planete_Terre_Univers_6.webp",
	"royaume-des-demons": "/wiki/planets/Royaume_des_Demons.webp",
	"kame-house": "/wiki/planets/Planete_Terre.webp",
	"tour-karin": "/wiki/characters/Dieu_de_la_planete_Konats.webp",
	"sanctuaire-de-dieu": "/wiki/planets/Planete_Terre.webp",
	"salle-esprit-temps": "/wiki/planets/Planetes_Emprisonnees.webp",
	"capsule-corporation": "/wiki/planets/Planete_Terre.webp",
	"arene-tenkaichi-budokai": "/wiki/planets/Planete_Terre.webp",
	"planete-namek": "/wiki/planets/Planete_Namek.webp",
	"planete-vegeta": "/wiki/planets/Planete_Vegeta.webp",
	"planete-kaio": "/wiki/planets/Planete_de_Maitre_Kaio.webp",
	"palais-enma": "/wiki/planets/Royaume_des_Demons.webp",
	"domaine-kaioshin": "/wiki/planets/Planete_Kaishin_Univers_7.webp",
	"planete-beerus": "/wiki/planets/Planete_Beerus.webp",
	"monde-du-vide": "/wiki/planets/Planetes_Emprisonnees.webp",
	"palais-zeno": "/wiki/planets/Planetes_Emprisonnees.webp",
	"planete-yardrat": "/wiki/planets/Planete_Yardrat.webp",
};

const REALM_TYPES = [
	"Tous",
	"Terre",
	"Divin",
	"Univers 7",
	"Royaume des Morts",
	"Monde du Vide",
] as const;

export function LocationsGrid({ locations }: { locations: Location[] }) {
	const [query, setQuery] = useState("");
	const [selectedRealm, setSelectedRealm] = useState<string>("Tous");

	const filtered = useMemo(() => {
		const q = query.toLowerCase().trim();
		return locations.filter((loc) => {
			if (selectedRealm !== "Tous" && loc.realm_type !== selectedRealm) {
				return false;
			}
			if (!q) return true;
			const inName = loc.name.toLowerCase().includes(q);
			const inJa = loc.name_ja?.toLowerCase().includes(q) ?? false;
			const inDesc = loc.description.toLowerCase().includes(q);
			const inPlanet = loc.planet?.toLowerCase().includes(q) ?? false;
			return inName || inJa || inDesc || inPlanet;
		});
	}, [locations, query, selectedRealm]);

	return (
		<div className="space-y-6">
			{/* Filtres & Recherche */}
			<div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-black/40 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
				<div className="relative flex-1">
					<input
						type="search"
						aria-label="Rechercher un lieu ou un sanctuaire"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher un sanctuaire, une planète, une cité (ex: Kame House, Karin, Namek, Zeno)..."
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
					{REALM_TYPES.map((realm) => (
						<button
							key={realm}
							type="button"
							onClick={() => setSelectedRealm(realm)}
							className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
								selectedRealm === realm
									? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
									: "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
							}`}
						>
							{realm}
						</button>
					))}
				</div>
			</div>

			<div className="text-xs text-white/50">
				{filtered.length} lieu{filtered.length > 1 ? "x" : ""} répertorié{filtered.length > 1 ? "s" : ""}
			</div>

			{/* Grille de lieux */}
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				{filtered.map((loc) => (
					<Link
						key={loc.slug}
						href={`/wiki/lieux/${loc.slug}`}
						className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-5 transition-all hover:-translate-y-1 hover:border-orange-500/50 hover:shadow-xl hover:shadow-orange-950/20"
					>
						{/* Aperçu visuel du sanctuaire / lieu */}
						<div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/50 mb-3 border border-white/5">
							<img
								src={loc.image ? assetUrl(loc.image) : (LOCATION_IMAGES[loc.slug] ?? "/wiki/planets/Planete_Terre.webp")}
								alt={loc.name}
								loading="lazy"
								className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
							/>
							<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
							<div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between">
								<span className="rounded-md bg-orange-500/30 backdrop-blur-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-300 border border-orange-500/30">
									{loc.realm_type}
								</span>
								{loc.planet && (
									<span className="text-[10px] font-medium text-white/80 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded border border-white/10">
										🪐 {loc.planet}
									</span>
								)}
							</div>
						</div>

						<div className="space-y-3">

							<div>
								<h3 className="text-lg font-bold text-white transition-colors group-hover:text-orange-400">
									{loc.name}
								</h3>
								{loc.name_ja && (
									<div className="text-xs text-white/40">
										{loc.name_ja} {loc.name_romaji ? `(${loc.name_romaji})` : ""}
									</div>
								)}
							</div>

							<p className="line-clamp-3 text-xs leading-relaxed text-white/70">
								{loc.description}
							</p>
						</div>

						<div className="mt-4 space-y-3 pt-3 border-t border-white/5">
							{loc.key_events && loc.key_events.length > 0 && (
								<div className="space-y-1">
									<div className="text-[10px] uppercase font-bold tracking-wider text-white/40">
										Événements clés :
									</div>
									<div className="flex flex-wrap gap-1">
										{loc.key_events.slice(0, 2).map((ev: { title: string }) => (
											<span
												key={ev.title}
												className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-white/80"
											>
												⚡ {ev.title}
											</span>
										))}
									</div>
								</div>
							)}

							<div className="flex items-center justify-between text-[11px] text-white/40">
								<span>Début : {loc.debut_chapter ?? "Manga canon"}</span>
								<span className="font-semibold text-orange-400 group-hover:translate-x-0.5 transition-transform">
									Découvrir →
								</span>
							</div>
						</div>
					</Link>
				))}
			</div>
		</div>
	);
}
