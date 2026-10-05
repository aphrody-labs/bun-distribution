"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
	Search,
	X,
	Users,
	BookOpen,
	Clapperboard,
	Mic,
	Globe,
	Quote,
	Building2,
	Film,
} from "lucide-react";

export type StaffTier =
	| "all"
	| "editorial" // 1. Éditorial & Droits
	| "production" // 2. Animation, Réalisation, Scénario & Musique
	| "voice_ja" // 3. Seiyū (VO)
	| "voice_fr" // 4. Voix Françaises (VF)
	| "voice_en" // 5. Voix Anglaises (VA)
	| "voice_intl"; // 6. Doublages Internationaux (LatAm, ES, IT)

export type StaffEra = "all" | "db" | "dbz" | "gt" | "dbs" | "daima";
export type StaffStudio = "all" | "bird_studio" | "shueisha" | "toei" | "cct" | "audio_dub";

export interface UnifiedStaffMember {
	id: string;
	slug: string;
	nameFr: string;
	nameJa?: string;
	nameRomaji?: string;
	tier: StaffTier;
	tierLabel: string;
	subRole: string;
	period: string;
	eras: StaffEra[];
	studio: StaffStudio;
	studioLabel: string;
	keyWorks: string[];
	bioSummary: string;
	anecdote?: string;
	/** Portrait éditorial sourcé quand la fiche en possède un. */
	image?: string | null;
	wikiLink?: string;
	roles?: { characterName: string; series?: string; notes?: string }[];
}

export interface UnifiedStaffExplorerProps {
	items: UnifiedStaffMember[];
	initialTier?: StaffTier;
}

const TIER_TABS: Array<{ id: StaffTier; label: string; badge: string; icon: any }> = [
	{ id: "all", label: "Tout le Staff & Casting", badge: "Global", icon: Users },
	{ id: "editorial", label: "1. Éditorial & Droits", badge: "Jump / Shueisha", icon: BookOpen },
	{
		id: "production",
		label: "2. Animation, Réalisation & OST",
		badge: "Toei Animation",
		icon: Clapperboard,
	},
	{ id: "voice_ja", label: "3. Seiyū Japonais (VO)", badge: "Japon 🇯🇵", icon: Mic },
	{ id: "voice_fr", label: "4. Voix Françaises (VF)", badge: "France 🇫🇷", icon: Mic },
	{ id: "voice_en", label: "5. Voix Anglaises (VA)", badge: "USA 🇺🇸", icon: Mic },
	{ id: "voice_intl", label: "6. Doublages Internationaux", badge: "Monde 🌎", icon: Globe },
];

const ERA_FILTERS: Array<{ id: StaffEra; label: string }> = [
	{ id: "all", label: "Toutes les ères" },
	{ id: "db", label: "Dragon Ball (1986-1989)" },
	{ id: "dbz", label: "Dragon Ball Z (1989-1996)" },
	{ id: "gt", label: "Dragon Ball GT (1996-1997)" },
	{ id: "dbs", label: "Dragon Ball Super (2015-2018)" },
	{ id: "daima", label: "Dragon Ball Daima (2024+)" },
];

const STUDIO_FILTERS: Array<{ id: StaffStudio; label: string }> = [
	{ id: "all", label: "Tous les studios & entités" },
	{ id: "bird_studio", label: "Bird Studio" },
	{ id: "shueisha", label: "Shueisha (Jump)" },
	{ id: "toei", label: "Toei Animation" },
	{ id: "cct", label: "Capsule Corp Tokyo" },
	{ id: "audio_dub", label: "Plateaux de Doublage" },
];

export function UnifiedStaffExplorer({ items, initialTier = "all" }: UnifiedStaffExplorerProps) {
	const [activeTier, setActiveTier] = useState<StaffTier>(initialTier);
	const [selectedEra, setSelectedEra] = useState<StaffEra>("all");
	const [selectedStudio, setSelectedStudio] = useState<StaffStudio>("all");
	const [searchQuery, setSearchQuery] = useState("");

	const filtered = useMemo(() => {
		const q = searchQuery.toLowerCase().trim();
		return items.filter((item) => {
			if (activeTier !== "all" && item.tier !== activeTier) return false;
			if (selectedEra !== "all" && !item.eras.includes(selectedEra)) return false;
			if (selectedStudio !== "all" && item.studio !== selectedStudio) return false;

			if (!q) return true;
			const inName =
				item.nameFr.toLowerCase().includes(q) ||
				(item.nameJa && item.nameJa.toLowerCase().includes(q)) ||
				(item.nameRomaji && item.nameRomaji.toLowerCase().includes(q));
			const inSubRole = item.subRole.toLowerCase().includes(q);
			const inStudio = item.studioLabel.toLowerCase().includes(q);
			const inBio = item.bioSummary.toLowerCase().includes(q);
			const inWorks = item.keyWorks.some((w) => w.toLowerCase().includes(q));
			const inRoles = item.roles?.some(
				(r) =>
					r.characterName.toLowerCase().includes(q) ||
					(r.series && r.series.toLowerCase().includes(q))
			);
			return inName || inSubRole || inStudio || inBio || inWorks || inRoles;
		});
	}, [items, activeTier, selectedEra, selectedStudio, searchQuery]);

	// Counts per tier
	const counts = useMemo(() => {
		const map: Record<StaffTier, number> = {
			all: items.length,
			editorial: 0,
			production: 0,
			voice_ja: 0,
			voice_fr: 0,
			voice_en: 0,
			voice_intl: 0,
		};
		for (const item of items) {
			if (item.tier in map) {
				map[item.tier]++;
			}
		}
		return map;
	}, [items]);

	return (
		<div className="space-y-6">
			{/* Panneau de navigation hiérarchique à 6 niveaux */}
			<div className="rounded-2xl border border-white/10 bg-black/60 p-4 sm:p-6 backdrop-blur-xl shadow-2xl space-y-4">
				{/* Titre du bloc de filtres */}
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-white/10 pb-3">
					<div className="flex items-center gap-2">
						<Users className="h-5 w-5 text-orange-400" />
						<h3 className="font-saiyan text-lg sm:text-xl text-white tracking-wide">
							HIÉRARCHIE DES CRÉATEURS &amp; CASTING
						</h3>
					</div>
					<div className="text-xs text-white/50 font-mono">
						{filtered.length} / {items.length} contributeurs affichés
					</div>
				</div>

				{/* 6 Niveaux Hiérarchiques Principaux */}
				<div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 scrollbar-thin lg:grid lg:grid-cols-7 lg:gap-2 lg:overflow-visible lg:pb-0">
					{TIER_TABS.map((tab) => {
						const Icon = tab.icon;
						const isSelected = activeTier === tab.id;
						return (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveTier(tab.id)}
								className={`flex shrink-0 snap-start flex-col items-start gap-1 rounded-xl border p-2.5 sm:p-3 text-left transition-all ${
									isSelected
										? "border-orange-500 bg-orange-500/20 text-white shadow-lg shadow-orange-950/40 ring-1 ring-orange-500/50"
										: "border-white/5 bg-white/[0.03] text-white/65 hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
								}`}
							>
								<div className="flex w-full items-center justify-between gap-1">
									<Icon className={`h-4 w-4 ${isSelected ? "text-orange-400" : "text-white/40"}`} />
									<span
										className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
											isSelected ? "bg-orange-500/50 text-white" : "bg-white/10 text-white/60"
										}`}
									>
										{counts[tab.id]}
									</span>
								</div>
								<span className="text-xs font-bold leading-tight line-clamp-2 mt-1">
									{tab.label}
								</span>
								<span className="text-[10px] text-white/40 uppercase tracking-wider">
									{tab.badge}
								</span>
							</button>
						);
					})}
				</div>

				{/* Ligne des sous-filtres : Ère, Studio, et Recherche textuelle */}
				<div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
					{/* Recherche plein texte */}
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
						<input
							type="search"
							aria-label="Rechercher dans le staff ou casting"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Rechercher par nom, personnage, œuvre (ex: Nozawa, Goku, Broly)..."
							className="w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-8 py-2.5 text-xs text-white placeholder-white/40 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery("")}
								className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
							>
								<X className="h-4 w-4" />
							</button>
						)}
					</div>

					{/* Filtre par Ère */}
					<div className="relative">
						<select
							aria-label="Filtrer par ère"
							value={selectedEra}
							onChange={(e) => setSelectedEra(e.target.value as StaffEra)}
							className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/90 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 appearance-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] cursor-pointer"
						>
							{ERA_FILTERS.map((era) => (
								<option key={era.id} value={era.id} className="bg-neutral-900 text-white">
									{era.label}
								</option>
							))}
						</select>
					</div>

					{/* Filtre par Studio / Entité */}
					<div className="relative">
						<select
							aria-label="Filtrer par studio"
							value={selectedStudio}
							onChange={(e) => setSelectedStudio(e.target.value as StaffStudio)}
							className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/90 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 appearance-none cursor-pointer"
						>
							{STUDIO_FILTERS.map((st) => (
								<option key={st.id} value={st.id} className="bg-neutral-900 text-white">
									{st.label}
								</option>
							))}
						</select>
					</div>
				</div>
			</div>

			{/* Grille des fiches du Staff & Casting */}
			{filtered.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-white/15 p-12 text-center text-sm text-white/50">
					Aucun contributeur ne correspond aux filtres sélectionnés.
				</div>
			) : (
				<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{filtered.map((item) => (
						<article
							key={item.id}
							id={item.slug}
							className="group flex flex-col justify-between rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.015] p-5 backdrop-blur-md transition-all duration-300 hover:border-orange-500/50 hover:shadow-xl hover:shadow-orange-950/20"
						>
							<div>
								{/* Badges du Niveau & Studio */}
								<div className="flex items-center justify-between gap-2 text-[10px]">
									<span className="rounded-md border border-orange-500/30 bg-orange-950/60 px-2 py-0.5 font-bold uppercase tracking-wider text-orange-400">
										{item.tierLabel}
									</span>
									<span className="font-mono text-white/40">{item.period}</span>
								</div>

								{/* Portrait, nom et translittération. Une absence de portrait ne
								    fabrique pas un visage : l'initiale neutre reste le repli. */}
								<div className="mt-3 flex items-start gap-3">
									{item.image ? (
										<img
											src={item.image}
											alt={`Portrait de ${item.nameFr}`}
											loading="lazy"
											className="h-12 w-12 shrink-0 rounded-full border border-orange-400/40 object-cover bg-black/40"
										/>
									) : (
										<div
											aria-hidden="true"
											className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-lg font-bold text-orange-300"
										>
											{item.nameFr.slice(0, 1).toUpperCase()}
										</div>
									)}
									<div>
										<h4 className="text-xl font-bold text-white group-hover:text-orange-400 transition-colors">
											{item.nameFr}
										</h4>
										{(item.nameJa || item.nameRomaji) && (
											<div className="mt-0.5 flex items-center gap-2 text-xs text-white/50">
												{item.nameJa && (
													<span className="font-jp text-amber-300/80">{item.nameJa}</span>
												)}
												{item.nameJa && item.nameRomaji && <span>·</span>}
												{item.nameRomaji && <span className="italic">{item.nameRomaji}</span>}
											</div>
										)}
									</div>
								</div>

								{/* Rôle & Studio */}
								<div className="mt-3 rounded-xl border border-white/5 bg-white/[0.03] p-2.5 text-xs">
									<div className="font-semibold text-orange-300">{item.subRole}</div>
									<div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/50">
										<Building2 className="h-3 w-3 shrink-0 text-white/40" />
										<span>{item.studioLabel}</span>
									</div>
								</div>

								{/* Biographie Synthétique */}
								<p className="mt-3 text-xs leading-relaxed text-white/70">{item.bioSummary}</p>

								{/* Anecdote de production sourcée */}
								{item.anecdote && (
									<div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200/90 flex gap-2">
										<Quote className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
										<div>
											<span className="font-bold text-amber-300">Anecdote de production : </span>
											<span>{item.anecdote}</span>
										</div>
									</div>
								)}

								{/* Rôles vocaux (pour les voix) */}
								{item.roles && item.roles.length > 0 && (
									<div className="mt-3 space-y-1">
										<div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
											Personnages Clés Incarnés
										</div>
										<div className="flex flex-wrap gap-1.5">
											{item.roles.map((r, idx) => (
												<span
													key={idx}
													className="rounded-md border border-purple-500/30 bg-purple-950/40 px-2 py-0.5 text-[10px] font-semibold text-purple-200"
												>
													{r.characterName} {r.notes ? `(${r.notes.slice(0, 30)}...)` : ""}
												</span>
											))}
										</div>
									</div>
								)}

								{/* Œuvres & Réalisations Clés */}
								{item.keyWorks.length > 0 && (
									<div className="mt-3 space-y-1">
										<div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
											Œuvres &amp; Réalisations Majeures
										</div>
										<div className="flex flex-wrap gap-1.5">
											{item.keyWorks.map((work, idx) => (
												<span
													key={idx}
													className="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-white/80"
												>
													{work}
												</span>
											))}
										</div>
									</div>
								)}
							</div>

							{/* Lien vers la fiche wiki */}
							{item.wikiLink && (
								<div className="mt-4 border-t border-white/10 pt-3 flex items-center justify-end text-xs">
									<Link
										href={item.wikiLink}
										className="font-semibold text-orange-400 hover:text-white transition-colors inline-flex items-center gap-1"
									>
										Consulter la fiche détaillée →
									</Link>
								</div>
							)}
						</article>
					))}
				</div>
			)}
		</div>
	);
}
