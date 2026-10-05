"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
	Bibliotheque,
	Cadenas,
	Couches,
	DragonBall,
	DragonRadar,
	Kame,
	Livre,
	Palette,
	Trophee,
} from "@/components/icones";
import { assetUrl } from "@/lib/assets";
import { onTablistKeyDown } from "@/lib/tablist-keys";
import { estChapitreCouleur, libelleSerie } from "@/lib/manga-editions";
import { VignetteTome } from "@/components/manga/VignetteTome";
import { Etoile } from "@/components/MotifsCouverture";

export interface Volume {
	id: number;
	series: string;
	volumeNumber: number;
	title: string | null;
	cover: string | null;
	sourceUrl?: string | null;
}

interface Chapter {
	id: number;
	chapter_number: number;
	title: string | null;
	series: string;
	cover: string | null;
	pages?: string[] | null;
	volume_id?: number | null;
}

interface LastReadChapter {
	id: number;
	chapter_number: number;
	title: string | null;
	series: string;
}

interface Achievement {
	id: string;
	title: string;
	desc: string;
	required: number;
}

interface MangaVolumeGridProps {
	dbVolumes: Volume[];
	dbsVolumes: Volume[];
	kanzenbanVolumes?: Volume[];
	soshuhenVolumes?: Volume[];
	animeZVolumes?: Volume[];
	animeMovieVolumes?: Volume[];
	dbgtAnimeVolumes?: Volume[];
	dbsAnimeVolumes?: Volume[];
	lightNovelVolumes?: Volume[];
	dbjpVolumes?: Volume[];
	araleVolumes?: Volume[];
	otherVolumes?: Volume[];
	readableChapters: Chapter[];
	/**
	 * Les tomes dont l'édition couleur est lisible, et le nombre de chapitres
	 * couleur au total.
	 */
	colorVolumeIds?: number[];
	colorChapterCount?: number;
}

type AvailabilityFilter = "all" | "disponibles" | "a-completer";

const ACHIEVEMENTS: Achievement[] = [
	{
		id: "initiate",
		title: "Initié Z",
		desc: "Commencez votre entraînement en ouvrant et lisant au moins 1 chapitre.",
		required: 1,
	},
	{
		id: "warrior",
		title: "Guerrier de l'Espace",
		desc: "Dépassez la puissance moyenne d'un humain en lisant 10 chapitres.",
		required: 10,
	},
	{
		id: "super_saiyan",
		title: "Super Saiyan",
		desc: "Éveillez la légendaire colère dorée des Saiyans en lisant 30 chapitres.",
		required: 30,
	},
	{
		id: "divine",
		title: "Super Saiyan Divin",
		desc: "Ressentez le Ki divin et repoussez les limites mortelles en lisant 60 chapitres.",
		required: 60,
	},
	{
		id: "god",
		title: "Super Saiyan Blue",
		desc: "Combinez la puissance du Super Saiyan avec le Ki divin en lisant 80 chapitres.",
		required: 80,
	},
	{
		id: "instinct",
		title: "Ultra Instinct",
		desc: "Maîtrisez l'esprit et le corps sans y penser en lisant 100 chapitres.",
		required: 100,
	},
];

/** Entête de section « Édition Couleur », partagé par les onglets. */
function ColorSectionHeader({ count }: { count: number }) {
	return (
		<>
			<div className="flex items-center gap-3">
				<Palette className="w-5 h-5 text-fuchsia-400" aria-hidden="true" />
				<h3 className="font-saiyan text-2xl text-white tracking-widest">
					<Etoile taille={14} className="mr-2 align-baseline text-[var(--color-logo-rouge)]" />
					Édition Couleur
				</h3>
				<span className="text-[9px] px-2 py-0.5 rounded bg-gradient-to-r from-fuchsia-500 to-amber-400 text-black font-mono font-black uppercase tracking-wider">
					Full Color
				</span>
				<div className="h-px flex-1 bg-gradient-to-r from-fuchsia-500/40 to-transparent" />
			</div>
			<p className="text-xs text-white/50 max-w-2xl font-display">
				L&apos;œuvre originale d&apos;Akira Toriyama en couleur
				{count > 0 ? ` — ${count} chapitres` : ""}. Ouvre un tome pour choisir entre l&apos;édition
				noir &amp; blanc et l&apos;édition couleur.
			</p>
		</>
	);
}

/** Grille des tomes disponibles en couleur. */
function ColorVolumeGrid({ volumes }: { volumes: Volume[] }) {
	return (
		<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
			{volumes.map((vol, idx) => (
				<VignetteTome
					key={vol.id}
					volume={vol}
					href={`/wiki/manga/volume/${vol.id}?edition=couleur`}
					idx={idx}
					couleur
				/>
			))}
		</div>
	);
}

/** Carte d'un chapitre lisible (onglet Scans). Met en avant les éditions couleur. */
function MangaChapterCard({ chapter, idx }: { chapter: Chapter; idx: number }) {
	const color = estChapitreCouleur(chapter);
	const prefetch = () => {
		chapter.pages?.slice(0, 3).forEach((page) => {
			const img = new window.Image();
			img.src = assetUrl(page);
		});
	};
	return (
		<Link
			href={`/wiki/manga/${chapter.id}`}
			onMouseEnter={prefetch}
			onTouchStart={prefetch}
			className={`group dbz-panel overflow-hidden transition-all duration-300 hover:scale-105 ${color ? "border-fuchsia-500/30 hover:border-fuchsia-400" : "hover:border-dbz-orange"}`}
			style={{ animationDelay: `${idx * 0.03}s` }}
		>
			<div className="relative aspect-[3/4] bg-dbz-bg overflow-hidden">
				<div className="absolute inset-0 halftone opacity-10 z-10 pointer-events-none" />
				{chapter.cover ? (
					<Image
						src={assetUrl(chapter.cover)}
						alt={chapter.title ?? `Chapitre ${chapter.chapter_number}`}
						fill
						sizes="(max-width: 768px) 50vw, 16vw"
						className="object-cover opacity-90 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700"
						priority={idx < 6}
					/>
				) : (
					<div className="grid h-full w-full place-items-center">
						<Livre className="w-10 h-10 text-dbz-orange/20" aria-hidden="true" />
					</div>
				)}
				{color && (
					<span className="absolute top-2 right-2 z-30 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-fuchsia-500 to-amber-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-black shadow-[0_0_10px_rgba(217,70,239,0.5)]">
						<Palette className="w-2.5 h-2.5" /> Couleur
					</span>
				)}
				<div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent z-20" />
				<div className="absolute inset-x-0 bottom-0 p-4 z-30">
					<span
						className={`scouter-text text-xs block mb-1 font-mono ${color ? "text-fuchsia-300" : "text-dbz-orange"}`}
					>
						{color ? "Dragon Ball · Couleur" : `${chapter.series} #${chapter.chapter_number}`}
					</span>
					<p className="font-display font-bold text-sm text-white group-hover:text-dbz-orange transition-colors line-clamp-2">
						{chapter.title ?? `Chapitre ${chapter.chapter_number}`}
					</p>
				</div>
			</div>
		</Link>
	);
}

export type MangaTab =
	| "all"
	| "db"
	| "full_color"
	| "kanzenban"
	| "soshuhen"
	| "anime_z"
	| "anime_gt"
	| "anime_films"
	| "dbs"
	// Kept only to decode legacy client URLs; no control can select this view.
	| "light_novels"
	| "jp"
	| "arale"
	| "scans"
	| "achievements";

export function MangaVolumeGrid({
	dbVolumes,
	dbsVolumes,
	kanzenbanVolumes = [],
	soshuhenVolumes = [],
	animeZVolumes = [],
	animeMovieVolumes = [],
	dbgtAnimeVolumes = [],
	dbsAnimeVolumes = [],
	lightNovelVolumes = [],
	dbjpVolumes = [],
	araleVolumes = [],
	otherVolumes = [],
	readableChapters,
	colorVolumeIds = [],
	colorChapterCount = 0,
}: MangaVolumeGridProps) {
	// L'inventaire complet s'ouvre en premier ; les onglets suivants sont des raccourcis d'édition.
	const [tab, setTab] = useState<MangaTab>("all");
	const [lastRead, setLastRead] = useState<LastReadChapter | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [readChapterIds, setReadChapterIds] = useState<number[]>([]);
	const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");

	useEffect(() => {
		try {
			const value = new URLSearchParams(window.location.search).get("etat");
			if (value === "disponibles" || value === "a-completer") setAvailabilityFilter(value);
		} catch {
			// URL indisponible : l'état par défaut reste « Tous ».
		}
	}, []);

	const changeAvailabilityFilter = (value: AvailabilityFilter) => {
		setAvailabilityFilter(value);
		try {
			const url = new URL(window.location.href);
			if (value === "all") url.searchParams.delete("etat");
			else url.searchParams.set("etat", value);
			window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
		} catch {
			// L'état local reste utilisable dans un environnement sans historique.
		}
	};

	useEffect(() => {
		try {
			const savedLast = localStorage.getItem("dbfr_last_read_chapter");
			if (savedLast) {
				const parsed = JSON.parse(savedLast);
				if (parsed && typeof parsed === "object" && "id" in parsed) {
					setLastRead(parsed as LastReadChapter);
				}
			}

			const savedRead = localStorage.getItem("dbfr_read_chapters");
			if (savedRead) {
				const parsed = JSON.parse(savedRead);
				if (Array.isArray(parsed)) {
					setReadChapterIds(parsed.map(Number));
				}
			}
		} catch (e) {
			console.error("Failed to load reading states from localStorage", e);
		}
	}, []);

	// La présence est mesurée par les chapitres réellement lisibles.
	const scanVolumeIds = new Set(
		readableChapters.map((c) => c.volume_id).filter((v): v is number => v != null)
	);
	const colorIds = new Set(colorVolumeIds);
	const volumeIsAvailable = (volume: Volume) =>
		scanVolumeIds.has(volume.id) || (volume.series === "DB" && colorIds.has(volume.id));
	const includeVolume = (volume: Volume) => {
		if (availabilityFilter === "all") return true;
		const available = volumeIsAvailable(volume);
		return availabilityFilter === "disponibles" ? available : !available;
	};

	// Filtrage par état du catalogue et barre de recherche.
	const q = searchQuery.toLowerCase().trim();
	const matchesQuery = (vol: Volume) =>
		!q || vol.title?.toLowerCase().includes(q) || vol.volumeNumber.toString().includes(q);
	const filteredDbs = dbsVolumes.filter((vol) => includeVolume(vol) && matchesQuery(vol));
	const filteredDb = dbVolumes.filter((vol) => includeVolume(vol) && matchesQuery(vol));
	const filteredKanzenban = kanzenbanVolumes.filter(
		(vol) => includeVolume(vol) && matchesQuery(vol)
	);
	const filteredSoshuhen = soshuhenVolumes.filter((vol) => includeVolume(vol) && matchesQuery(vol));
	const filteredAnimeZ = animeZVolumes.filter((vol) => includeVolume(vol) && matchesQuery(vol));
	const filteredAnimeMovie = animeMovieVolumes.filter(
		(vol) => includeVolume(vol) && matchesQuery(vol)
	);
	const filteredDbgtAnime = dbgtAnimeVolumes.filter(
		(vol) => includeVolume(vol) && matchesQuery(vol)
	);
	const filteredDbsAnime = dbsAnimeVolumes.filter((vol) => includeVolume(vol) && matchesQuery(vol));
	const filteredLightNovels = lightNovelVolumes.filter(
		(vol) => includeVolume(vol) && matchesQuery(vol)
	);
	const filteredDbjp = dbjpVolumes.filter((vol) => includeVolume(vol) && matchesQuery(vol));
	const filteredArale = araleVolumes.filter((vol) => includeVolume(vol) && matchesQuery(vol));
	const catalogVolumes = [
		...dbVolumes,
		...dbsVolumes,
		...kanzenbanVolumes,
		...soshuhenVolumes,
		...animeZVolumes,
		...animeMovieVolumes,
		...dbgtAnimeVolumes,
		...dbsAnimeVolumes,
		...lightNovelVolumes,
		...dbjpVolumes,
		...araleVolumes,
		...otherVolumes,
	];
	const allSeriesVolumes = catalogVolumes.filter(
		(volume) => includeVolume(volume) && matchesQuery(volume)
	);
	const allVolumeGroups = Array.from(
		allSeriesVolumes.reduce((groups, volume) => {
			const volumes = groups.get(volume.series) ?? [];
			volumes.push(volume);
			groups.set(volume.series, volumes);
			return groups;
		}, new Map<string, Volume[]>())
	);

	const filteredChapters = readableChapters.filter((ch) => {
		if (availabilityFilter === "a-completer") return false;
		if (!q) return true;
		return ch.title?.toLowerCase().includes(q) || ch.chapter_number.toString().includes(q);
	});
	// Certaines planches (préface, bonus) n'appartiennent à aucun tome. Elles
	// doivent rester accessibles dans l'inventaire, sans les rattacher de force
	// à un volume qui ne les contient pas.
	const unattachedChapters = filteredChapters.filter((chapter) => chapter.volume_id == null);

	const colorChapters = filteredChapters.filter((ch) => estChapitreCouleur(ch));
	const bwChapters = filteredChapters.filter((ch) => !estChapitreCouleur(ch));
	const colorVolumes = dbVolumes.filter(
		(vol) => colorIds.has(vol.id) && includeVolume(vol) && matchesQuery(vol)
	);
	const dbColorChapters = colorChapters.filter((ch) => ch.series === "DB");
	const dbsChapters = filteredChapters.filter((ch) => ch.series === "DBS");

	// Métriques de succès
	const totalReadChapters = readChapterIds.length;
	const unlockedCount = ACHIEVEMENTS.filter((ach) => totalReadChapters >= ach.required).length;

	let currentRank = "Terrien";
	if (totalReadChapters >= 100) currentRank = "Ultra Instinct";
	else if (totalReadChapters >= 80) currentRank = "Super Saiyan Blue";
	else if (totalReadChapters >= 60) currentRank = "Super Saiyan Divin";
	else if (totalReadChapters >= 30) currentRank = "Super Saiyan";
	else if (totalReadChapters >= 10) currentRank = "Guerrier Saiyan";
	else if (totalReadChapters >= 1) currentRank = "Disciple de Tortue Géniale";

	const tabBtn =
		"flex items-center gap-2 px-4 py-2 border-2 border-transparent text-xs font-sans font-extrabold uppercase tracking-wider text-white/70 hover:text-white transition-all whitespace-nowrap rounded-lg";
	const tabBtnActive =
		"flex items-center gap-2 px-4 py-2 border-2 border-black bg-dbz-orange text-black text-xs font-sans font-extrabold uppercase tracking-wider shadow-[2.5px_2.5px_0px_#000] transition-all whitespace-nowrap rounded-lg";

	return (
		<div className="space-y-10">
			{/* Banner "Reprendre la lecture" */}
			{lastRead && (
				<div className="reveal-up toriyama-card p-5 bg-[#0e0e11] border-2 border-dbz-orange rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-[4px_4px_0px_#000]">
					<div className="flex items-center gap-4">
						<div className="p-3 bg-dbz-orange text-black rounded-lg border-2 border-black shadow-[2px_2px_0px_#000]">
							<Livre className="w-5 h-5" />
						</div>
						<div className="space-y-1 text-center sm:text-left">
							<span className="text-xs text-dbz-orange block tracking-wider font-mono font-bold uppercase">
								Reprendre la lecture
							</span>
							<p className="font-display font-extrabold text-white text-base">
								{lastRead.series === "DB" ? "Dragon Ball" : "Dragon Ball Super"} · Chapitre{" "}
								{lastRead.chapter_number}
								{lastRead.title && (
									<span className="text-white/60 font-normal"> — {lastRead.title}</span>
								)}
							</p>
						</div>
					</div>
					<Link
						href={`/wiki/manga/${lastRead.id}`}
						className="toriyama-btn !min-h-10 !px-5 !py-2 text-xs !shadow-[3px_3px_0px_#000]"
					>
						Continuer la lecture →
					</Link>
				</div>
			)}

			{/* Catalogue complet et filtre de lecture, partageables via `?etat=`. */}
			<div className="toriyama-panel flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="font-scouter text-[10px] uppercase tracking-[0.18em] text-dbz-yellow font-extrabold">
						Catalogue complet
					</p>
					<p className="mt-1 text-sm text-white/80 font-bold">
						{catalogVolumes.filter(volumeIsAvailable).length} / {catalogVolumes.length} tomes — tous
						affichés
					</p>
				</div>
				<div
					className="m3-reader m3-reader--dragon-ball flex flex-wrap gap-2"
					role="group"
					aria-label="Filtrer par lecture disponible"
				>
					{(
						[
							["all", "Tous les tomes"],
							["disponibles", "Lecture ici"],
							["a-completer", "Catalogue seul"],
						] as const
					).map(([value, label]) => (
						<button
							key={value}
							type="button"
							onClick={() => changeAvailabilityFilter(value)}
							aria-pressed={availabilityFilter === value}
							className={availabilityFilter === value ? "m3-reader-btn-active" : "m3-reader-btn"}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			{/* Grille de Sélection Visuelle des Collections (calquée sur Databooks & Jeux Vidéo) */}
			<div className="space-y-4">
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div className="flex items-center gap-2.5">
						<div className="p-2 bg-dbz-orange/20 text-dbz-orange border border-dbz-orange/40 rounded-lg">
							<Bibliotheque className="w-5 h-5" />
						</div>
						<div>
							<h3 className="font-saiyan text-xl text-white tracking-wider">
								Collections &amp; Éditions du Manga
							</h3>
							<p className="text-xs text-white/50">
								Sélectionnez une collection pour explorer ses volumes, formats et chapitres
								numérisés.
							</p>
						</div>
					</div>

					{tab !== "achievements" && (
						<div className="relative w-full sm:w-80 flex-shrink-0">
							<span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-dbz-orange/60">
								<DragonRadar className="w-4 h-4" />
							</span>
							<input
								type="text"
								aria-label="Rechercher un tome ou un chapitre"
								placeholder="Rechercher un tome ou chapitre..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-full bg-black/60 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs text-white placeholder-white/40 focus:border-dbz-orange focus:ring-1 focus:ring-dbz-orange outline-none transition-all font-display font-medium shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)]"
							/>
						</div>
					)}
				</div>

				<div tabIndex={0}
					role="tablist"
					aria-label="Collections du manga"
					onKeyDown={onTablistKeyDown}
					className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
				>
					{[
						{
							id: "all" as MangaTab,
							title: "Toutes les Séries",
							desc: "Catalogue exhaustif",
							badge: `${allSeriesVolumes.length} tomes`,
							icon: Bibliotheque,
						},
						{
							id: "db" as MangaTab,
							title: "Dragon Ball Original",
							desc: "42 tomes canoniques N&B",
							badge: "Canon Toriyama",
							icon: DragonBall,
						},
						{
							id: "full_color" as MangaTab,
							title: "Full Color",
							desc: "Colorisation officielle",
							badge: `${colorVolumes.length || colorChapterCount || 520} tomes`,
							icon: Palette,
						},
						{
							id: "dbs" as MangaTab,
							title: "Dragon Ball Super",
							desc: "Toyotarō / Toriyama",
							badge: `${filteredDbs.length} tomes`,
							icon: Couches,
						},
						{
							id: "kanzenban" as MangaTab,
							title: "Kanzenban",
							desc: "Perfect Edition B5",
							badge: `${filteredKanzenban.length} tomes`,
							icon: Livre,
						},
						{
							id: "soshuhen" as MangaTab,
							title: "Sōshūhen (Digest)",
							desc: "Format Jump d'origine",
							badge: `${filteredSoshuhen.length} tomes`,
							icon: Couches,
						},
						{
							id: "anime_z" as MangaTab,
							title: "Anime Comics DBZ",
							desc: "Série TV Dragon Ball Z",
							badge: `${filteredAnimeZ.length} tomes`,
							icon: Palette,
						},
						{
							id: "anime_gt" as MangaTab,
							title: "Anime Comics DBGT",
							desc: "Série TV Dragon Ball GT",
							badge: `${filteredDbgtAnime.length} tomes`,
							icon: Palette,
						},
						{
							id: "anime_films" as MangaTab,
							title: "Anime Comics Films",
							desc: "Films et téléfilms",
							badge: `${filteredAnimeMovie.length + filteredDbsAnime.length} tomes`,
							icon: Livre,
						},
						{
							id: "scans" as MangaTab,
							title: "Lecteur de Scans",
							desc: "Lecture planche par planche",
							badge: `${filteredChapters.length} chapitres`,
							icon: Bibliotheque,
						},
						{
							id: "achievements" as MangaTab,
							title: "Succès & Rangs",
							desc: `Rang : ${currentRank}`,
							badge: `${unlockedCount}/${ACHIEVEMENTS.length}`,
							icon: Trophee,
						},
					].map((col) => {
						const isSelected = tab === col.id;
						const IconComp = col.icon;
						return (
							<button
								key={col.id}
								type="button"
								role="tab"
								id={`manga-tab-${col.id}`}
								aria-controls={`manga-panel-${col.id}`}
								aria-selected={isSelected}
								tabIndex={isSelected ? 0 : -1}
								onClick={() => setTab(col.id)}
								className={`group relative flex flex-col justify-between p-3.5 rounded-xl border text-left transition-all duration-200 cursor-pointer ${
									isSelected
										? "border-dbz-orange bg-gradient-to-b from-orange-950/40 via-black/80 to-black text-white shadow-[0_0_16px_rgba(231,130,32,0.35)] ring-1 ring-dbz-orange/50"
										: "border-white/10 bg-white/[0.03] text-white/70 hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
								}`}
							>
								<div className="flex items-start justify-between gap-2">
									<div
										className={`p-2 rounded-lg border transition-colors ${
											isSelected
												? "border-dbz-orange/60 bg-dbz-orange text-black"
												: "border-white/10 bg-white/5 text-white/60 group-hover:text-dbz-orange group-hover:border-dbz-orange/30"
										}`}
									>
										<IconComp className="w-4 h-4" />
									</div>
									<span
										className={`text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
											isSelected
												? "border-orange-400/50 bg-orange-500/20 text-orange-200"
												: "border-white/10 bg-white/5 text-white/50"
										}`}
									>
										{col.badge}
									</span>
								</div>
								<div className="mt-3">
									<div
										className={`font-display text-sm font-extrabold ${isSelected ? "text-dbz-orange" : "text-white"}`}
									>
										{col.title}
									</div>
									<div className="text-[11px] text-white/50 line-clamp-1 mt-0.5">{col.desc}</div>
								</div>
							</button>
						);
					})}
				</div>
			</div>

			{tab === "all" && (
				<div
					role="tabpanel"
					id="manga-panel-all"
					aria-labelledby="manga-tab-all"
					className="space-y-12 reveal-up"
				>
					{allVolumeGroups.map(([series, volumes]) => (
						<section key={series} className="space-y-5" aria-labelledby={`manga-series-${series}`}>
							<div className="flex items-center gap-3">
								<Livre className="h-5 w-5 text-dbz-orange" aria-hidden="true" />
								<h3
									id={`manga-series-${series}`}
									className="font-saiyan text-2xl tracking-widest text-white"
								>
									{libelleSerie(series)}
								</h3>
								<span className="font-mono text-[10px] font-bold uppercase tracking-wider text-white/50">
									{volumes.length} {volumes.length === 1 ? "tome" : "tomes"}
								</span>
								<div className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
							</div>
							<div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
								{volumes.map((vol, idx) => (
									<VignetteTome
										key={vol.id}
										volume={vol}
										href={`/wiki/manga/volume/${vol.id}`}
										idx={idx}
										priority={idx < 2}
										status={volumeIsAvailable(vol) ? "available" : "to-complete"}
									/>
								))}
							</div>
						</section>
					))}
					{unattachedChapters.length > 0 && (
						<section className="space-y-5" aria-labelledby="manga-unattached-chapters">
							<div className="flex items-center gap-3">
								<Livre className="h-5 w-5 text-dbz-orange" aria-hidden="true" />
								<h3
									id="manga-unattached-chapters"
									className="font-saiyan text-2xl tracking-widest text-white"
								>
									Planches hors tome
								</h3>
								<div className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
							</div>
							<p className="text-xs text-white/50">
								Bonus et préfaces conservés à leur adresse propre.
							</p>
							<div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
								{unattachedChapters.map((chapter, idx) => (
									<MangaChapterCard key={chapter.id} chapter={chapter} idx={idx} />
								))}
							</div>
						</section>
					)}
					{allVolumeGroups.length === 0 && (
						<div className="py-16 text-center italic text-white/50">
							Aucun tome ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{/* Dragon Ball Original */}
			{tab === "db" && (
				<div
					role="tabpanel"
					id="manga-panel-db"
					aria-labelledby="manga-tab-db"
					className="space-y-12 reveal-up"
				>
					{/* Dragon Ball original — édition couleur, présentée par tome. */}
					{(colorVolumes.length > 0 || dbColorChapters.length > 0) && (
						<div className="space-y-5">
							<ColorSectionHeader count={colorChapterCount} />
							{colorVolumes.length > 0 && <ColorVolumeGrid volumes={colorVolumes} />}
							{dbColorChapters.length > 0 && (
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
									{dbColorChapters.map((chapter, idx) => (
										<MangaChapterCard key={chapter.id} chapter={chapter} idx={idx} />
									))}
								</div>
							)}
						</div>
					)}

					{filteredDb.length > 0 && (
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
							{filteredDb.map((vol, idx) => (
								<VignetteTome
									key={vol.id}
									volume={vol}
									href={`/wiki/manga/volume/${vol.id}`}
									idx={idx}
									priority={idx < 6}
									status={volumeIsAvailable(vol) ? "available" : "to-complete"}
								/>
							))}
						</div>
					)}

					{filteredDb.length === 0 && dbColorChapters.length === 0 && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun volume ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{/* Dragon Ball Full Color */}
			{tab === "full_color" && (
				<div
					role="tabpanel"
					id="manga-panel-full-color"
					aria-labelledby="manga-tab-full-color"
					className="space-y-12 reveal-up"
				>
					<div className="space-y-6">
						<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
							<div>
								<div className="flex items-center gap-3">
									<Palette className="w-5 h-5 text-fuchsia-400" aria-hidden="true" />
									<h3 className="font-saiyan text-2xl text-white tracking-widest">
										Dragon Ball Full Color (フルカラー)
									</h3>
									<span className="text-[9px] px-2 py-0.5 rounded bg-gradient-to-r from-fuchsia-500/20 to-amber-500/20 text-fuchsia-300 font-mono font-bold uppercase tracking-wider border border-fuchsia-500/30">
										{colorVolumes.length || 42} tomes · {colorChapterCount || 520} chapitres
									</span>
								</div>
								<p className="mt-1 text-xs text-white/50 max-w-2xl font-display">
									L&apos;intégrale officielle colorisée par la Shueisha : 520 chapitres en
									quadrichromie haute définition, navigables par tome ou par chapitre direct.
								</p>
							</div>
						</div>

						{colorVolumes.length > 0 && <ColorVolumeGrid volumes={colorVolumes} />}

						{colorChapters.length > 0 && (
							<div className="space-y-4 pt-6 border-t border-white/10">
								<h4 className="font-display font-bold text-sm uppercase tracking-wider text-fuchsia-300">
									Tous les chapitres Full Color ({colorChapters.length})
								</h4>
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
									{colorChapters.map((chapter, idx) => (
										<MangaChapterCard key={chapter.id} chapter={chapter} idx={idx} />
									))}
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Kanzenban */}
			{tab === "kanzenban" && (
				<div
					role="tabpanel"
					id="manga-panel-kanzenban"
					aria-labelledby="manga-tab-kanzenban"
					className="space-y-8 reveal-up"
				>
					<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
						<div>
							<div className="flex items-center gap-3">
								<Livre className="w-5 h-5 text-amber-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Dragon Ball Kanzenban (完全版)
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold uppercase tracking-wider border border-amber-500/30">
									34 tomes · Pages Couleur Originales
								</span>
							</div>
							<p className="mt-1 text-xs text-white/50 max-w-2xl font-display">
								L&apos;édition ultime reproduisant les planches quadrichromies et bicolores
								d&apos;époque du Weekly Shōnen Jump, avec illustrations de couverture inédites et
								fin modifiée par Akira Toriyama.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
						{filteredKanzenban.map((vol, idx) => (
							<VignetteTome
								key={vol.id}
								volume={vol}
								href={`/wiki/manga/volume/${vol.id}`}
								idx={idx}
								priority={idx < 6}
								status={volumeIsAvailable(vol) ? "available" : "to-complete"}
							/>
						))}
					</div>
					{filteredKanzenban.length === 0 && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun volume ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{/* Sōshūhen — Digest Edition */}
			{tab === "soshuhen" && (
				<div
					role="tabpanel"
					id="manga-panel-soshuhen"
					aria-labelledby="manga-tab-soshuhen"
					className="space-y-8 reveal-up"
				>
					<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
						<div>
							<div className="flex items-center gap-3">
								<Couches className="w-5 h-5 text-purple-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Dragon Ball Sōshūhen (総集編 超悟空伝)
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono font-bold uppercase tracking-wider border border-purple-500/30">
									18 Legends · Grand Format B5 Jump
								</span>
							</div>
							<p className="mt-1 text-xs text-white/50 max-w-2xl font-display">
								L&apos;édition Shōnen Jump Digest reproduisant à l&apos;identique la pagination et
								les couleurs du magazine d&apos;époque (1984–1995), posters géants à double face
								inclus.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
						{filteredSoshuhen.map((vol, idx) => (
							<VignetteTome
								key={vol.id}
								volume={vol}
								href={`/wiki/manga/volume/${vol.id}`}
								idx={idx}
								priority={idx < 6}
								status={volumeIsAvailable(vol) ? "available" : "to-complete"}
							/>
						))}
					</div>
					{filteredSoshuhen.length === 0 && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun volume ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{/* Anime Comics (TV + Films) */}
			{(tab === "anime_z" || tab === "anime_gt" || tab === "anime_films") && (
				<div
					role="tabpanel"
					id={`manga-panel-${tab}`}
					aria-labelledby={`manga-tab-${tab}`}
					className="space-y-12 reveal-up"
				>
					{/* TV Anime Comics Z */}
					{tab === "anime_z" && filteredAnimeZ.length > 0 && (
						<div className="space-y-5">
							<div className="flex items-center gap-3">
								<Palette className="w-5 h-5 text-emerald-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Dragon Ball Z — TV Anime Comics
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold uppercase tracking-wider border border-emerald-500/30">
									39 tomes · Tout en Couleur
								</span>
								<div className="h-px flex-1 bg-gradient-to-r from-emerald-500/30 to-transparent" />
							</div>
							<p className="text-xs text-white/50 max-w-2xl font-display">
								L&apos;adaptation manga intégrale de la série animée DBZ capture par capture :
								Saiyans, Namek, Cyborgs, Cell et Majin Buu.
							</p>
							<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
								{filteredAnimeZ.map((vol, idx) => (
									<VignetteTome
										key={vol.id}
										volume={vol}
										href={`/wiki/manga/volume/${vol.id}`}
										idx={idx}
										priority={idx < 6}
										status={volumeIsAvailable(vol) ? "available" : "to-complete"}
									/>
								))}
							</div>
						</div>
					)}

					{/* Films Anime Comics */}
					{tab === "anime_films" && filteredAnimeMovie.length > 0 && (
						<div className="space-y-5">
							<div className="flex items-center gap-3">
								<Palette className="w-5 h-5 text-sky-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Films &amp; Téléfilms — Anime Comics
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono font-bold uppercase tracking-wider border border-sky-500/30">
									20 tomes · Films &amp; TV Spéciaux
								</span>
								<div className="h-px flex-1 bg-gradient-to-r from-sky-500/30 to-transparent" />
							</div>
							<p className="text-xs text-white/50 max-w-2xl font-display">
								Tous les films classiques Dragon Ball et DBZ (Broly, Cooler, Fusion, Janemba,
								Tapion...) et TV Spéciaux (Baddack, Trunks, 100 ans après) en manga couleur.
							</p>
							<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
								{filteredAnimeMovie.map((vol, idx) => (
									<VignetteTome
										key={vol.id}
										volume={vol}
										href={`/wiki/manga/volume/${vol.id}`}
										idx={idx}
										priority={idx < 6}
										status={volumeIsAvailable(vol) ? "available" : "to-complete"}
									/>
								))}
							</div>
						</div>
					)}

					{/* Dragon Ball GT Anime Comics */}
					{tab === "anime_gt" && filteredDbgtAnime.length > 0 && (
						<div className="space-y-5">
							<div className="flex items-center gap-3">
								<Palette className="w-5 h-5 text-amber-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Dragon Ball GT — TV Anime Comics
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold uppercase tracking-wider border border-amber-500/30">
									3 tomes · Arc Voyage dans l&apos;espace &amp; Baby
								</span>
								<div className="h-px flex-1 bg-gradient-to-r from-amber-500/30 to-transparent" />
							</div>
							<p className="text-xs text-white/50 max-w-2xl font-display">
								L&apos;intégrale des tomes Dragon Ball GT Anime Comics publiés par Shueisha : de la
								quête des Dragon Balls aux étoiles noires jusqu&apos;au dénouement tragique contre
								Baby.
							</p>
							<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
								{filteredDbgtAnime.map((vol, idx) => (
									<VignetteTome
										key={vol.id}
										volume={vol}
										href={`/wiki/manga/volume/${vol.id}`}
										idx={idx}
										priority={idx < 3}
										status={volumeIsAvailable(vol) ? "available" : "to-complete"}
									/>
								))}
							</div>
						</div>
					)}

					{/* Films Récents & DB Super Anime Comics */}
					{tab === "anime_films" && filteredDbsAnime.length > 0 && (
						<div className="space-y-5">
							<div className="flex items-center gap-3">
								<Palette className="w-5 h-5 text-fuchsia-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Films Récents — DB Super Anime Comics
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 font-mono font-bold uppercase tracking-wider border border-fuchsia-500/30">
									3 tomes · Battle of Gods, Broly &amp; Super Hero
								</span>
								<div className="h-px flex-1 bg-gradient-to-r from-fuchsia-500/30 to-transparent" />
							</div>
							<p className="text-xs text-white/50 max-w-2xl font-display">
								Les films de l&apos;ère moderne scénarisés par Akira Toriyama adaptés en bande
								dessinée tout en couleur.
							</p>
							<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
								{filteredDbsAnime.map((vol, idx) => (
									<VignetteTome
										key={vol.id}
										volume={vol}
										href={`/wiki/manga/volume/${vol.id}`}
										idx={idx}
										priority={idx < 3}
										status={volumeIsAvailable(vol) ? "available" : "to-complete"}
									/>
								))}
							</div>
						</div>
					)}

					{((tab === "anime_z" && filteredAnimeZ.length === 0) ||
						(tab === "anime_gt" && filteredDbgtAnime.length === 0) ||
						(tab === "anime_films" &&
							filteredAnimeMovie.length === 0 &&
							filteredDbsAnime.length === 0)) && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun volume ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{/* Romans & Light Novels */}
			{tab === "light_novels" && (
				<div
					role="tabpanel"
					id="manga-panel-light-novels"
					aria-labelledby="manga-tab-light_novels"
					className="space-y-8 reveal-up"
				>
					<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
						<div>
							<div className="flex items-center gap-3">
								<Livre className="w-5 h-5 text-indigo-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Romans &amp; Light Novels Officiels
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono font-bold uppercase tracking-wider border border-indigo-500/30">
									3 romans recensés · Mirai Bunko &amp; Jump j-Books
								</span>
							</div>
							<p className="mt-1 text-xs text-white/50 max-w-2xl font-display">
								Les adaptations littéraires officielles des longs-métrages Dragon Ball. Ces récits
								textuels supervisés apportent des détails psychologiques et des éléments de lore
								canoniques exclusifs.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
						{filteredLightNovels.map((vol, idx) => (
							<VignetteTome
								key={vol.id}
								volume={vol}
								href={`/wiki/manga/volume/${vol.id}`}
								idx={idx}
								priority={idx < 3}
								status={volumeIsAvailable(vol) ? "available" : "to-complete"}
							/>
						))}
					</div>
					{filteredLightNovels.length === 0 && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun roman ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{/* Dragon Ball Super */}
			{tab === "dbs" && (
				<div
					role="tabpanel"
					id="manga-panel-dbs"
					aria-labelledby="manga-tab-dbs"
					className="space-y-10 reveal-up"
				>
					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
						{filteredDbs.map((vol, idx) => (
							<VignetteTome
								key={vol.id}
								volume={vol}
								href={`/wiki/manga/volume/${vol.id}`}
								idx={idx}
								priority={idx < 6}
								status={volumeIsAvailable(vol) ? "available" : "to-complete"}
							/>
						))}
					</div>
					{filteredDbs.length === 0 && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun volume ne correspond à votre recherche.
						</div>
					)}
					{dbsChapters.length > 0 && (
						<div className="space-y-4 pt-6 border-t border-white/10">
							<div className="flex items-center gap-3">
								<Couches className="w-5 h-5 text-dbz-orange" aria-hidden="true" />
								<h4 className="font-display font-bold text-sm uppercase tracking-wider text-dbz-orange">
									Chapitres Dragon Ball Super ({dbsChapters.length})
								</h4>
							</div>
							<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
								{dbsChapters.map((chapter, idx) => (
									<MangaChapterCard key={chapter.id} chapter={chapter} idx={idx} />
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Édition Japonaise Tankōbon */}
			{tab === "jp" && (
				<div
					role="tabpanel"
					id="manga-panel-jp"
					aria-labelledby="manga-tab-jp"
					className="space-y-8 reveal-up"
				>
					<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
						<div>
							<div className="flex items-center gap-3">
								<Livre className="w-5 h-5 text-red-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Dragon Ball — Édition Japonaise Originale (ドラゴンボール)
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 font-mono font-bold uppercase tracking-wider border border-red-500/30">
									42 tomes · Tankōbon Jump Comics
								</span>
							</div>
							<p className="mt-1 text-xs text-white/50 max-w-2xl font-display">
								Les 42 volumes originaux tels que parus au Japon chez Shueisha entre 1985 et 1995
								avec onomatopées et calligraphies d&apos;Akira Toriyama.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
						{filteredDbjp.map((vol, idx) => (
							<VignetteTome
								key={vol.id}
								volume={vol}
								href={`/wiki/manga/volume/${vol.id}`}
								idx={idx}
								priority={idx < 6}
								status={volumeIsAvailable(vol) ? "available" : "to-complete"}
							/>
						))}
					</div>
					{filteredDbjp.length === 0 && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun volume ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{/* Dr. Slump */}
			{tab === "arale" && (
				<div
					role="tabpanel"
					id="manga-panel-arale"
					aria-labelledby="manga-tab-arale"
					className="space-y-8 reveal-up"
				>
					<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
						<div>
							<div className="flex items-center gap-3">
								<Kame className="w-5 h-5 text-pink-400" aria-hidden="true" />
								<h3 className="font-saiyan text-2xl text-white tracking-widest">
									Dr. Slump (Dr.スランプ — アラレちゃん)
								</h3>
								<span className="text-[9px] px-2 py-0.5 rounded bg-pink-500/20 text-pink-300 font-mono font-bold uppercase tracking-wider border border-pink-500/30">
									18 tomes · L&apos;Œuvre Fondatrice
								</span>
							</div>
							<p className="mt-1 text-xs text-white/50 max-w-2xl font-display">
								L&apos;intégrale des aventures d&apos;Arale Norimaki et Senbei Norimaki au Village
								Pinguouin, le chef-d&apos;œuvre comique et visuel d&apos;Akira Toriyama.
							</p>
						</div>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
						{filteredArale.map((vol, idx) => (
							<VignetteTome
								key={vol.id}
								volume={vol}
								href={`/wiki/manga/volume/${vol.id}`}
								idx={idx}
								priority={idx < 6}
								status={volumeIsAvailable(vol) ? "available" : "to-complete"}
							/>
						))}
					</div>
					{filteredArale.length === 0 && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun volume ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{tab === "scans" && (
				<div
					role="tabpanel"
					id="manga-panel-scans"
					aria-labelledby="manga-tab-scans"
					className="space-y-12 reveal-up"
				>
					{/* Édition couleur (Full Color) mise en avant, par tome. */}
					{(colorVolumes.length > 0 || colorChapters.length > 0) && (
						<div className="space-y-5">
							<ColorSectionHeader count={colorChapterCount} />
							{colorVolumes.length > 0 && <ColorVolumeGrid volumes={colorVolumes} />}
							{colorChapters.length > 0 && (
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
									{colorChapters.map((chapter, idx) => (
										<MangaChapterCard key={chapter.id} chapter={chapter} idx={idx} />
									))}
								</div>
							)}
						</div>
					)}

					{/* Scans N&B. */}
					{bwChapters.length > 0 && (
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
							{bwChapters.map((chapter, idx) => (
								<MangaChapterCard key={chapter.id} chapter={chapter} idx={idx} />
							))}
						</div>
					)}

					{filteredChapters.length === 0 && (
						<div className="py-16 text-center text-white/50 italic">
							Aucun chapitre ne correspond à votre recherche.
						</div>
					)}
				</div>
			)}

			{/* Onglet Succès & Gamification */}
			{tab === "achievements" && (
				<div
					role="tabpanel"
					id="manga-panel-achievements"
					aria-labelledby="manga-tab-achievements"
					className="reveal-up space-y-8"
				>
					<div className="dbz-panel p-6 bg-black/40 border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6">
						<div className="space-y-1">
							<span className="text-xs text-dbz-orange block tracking-wider font-mono font-bold uppercase">
								Progression de lecture
							</span>
							<p className="font-display font-black text-2xl text-white">Statistiques de Lecture</p>
						</div>
						<div className="grid grid-cols-2 gap-8 text-center md:text-left">
							<div>
								<span className="block text-[10px] uppercase text-white/50 tracking-wider font-mono">
									Chapitres Lus
								</span>
								<span className="font-saiyan text-3xl text-dbz-orange tracking-widest leading-none">
									{totalReadChapters}
								</span>
							</div>
							<div>
								<span className="block text-[10px] uppercase text-white/50 tracking-wider font-mono">
									Rang Débloqué
								</span>
								<span className="font-saiyan text-2xl text-white tracking-widest leading-none block mt-1">
									{currentRank}
								</span>
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
						{ACHIEVEMENTS.map((ach) => {
							const isUnlocked = totalReadChapters >= ach.required;
							return (
								<div
									key={ach.id}
									className={`dbz-panel p-6 border transition-all duration-300 relative overflow-hidden group ${
										isUnlocked
											? "border-dbz-orange/30 bg-dbz-card shadow-[0_0_15px_rgba(255,178,0,0.05)] hover:border-dbz-orange"
											: "border-white/5 bg-zinc-950/20 opacity-60"
									}`}
								>
									<div className="absolute inset-0 halftone opacity-5 pointer-events-none" />
									<div className="relative z-10 flex items-start gap-4">
										<div
											className={`p-3 rounded-lg border ${isUnlocked ? "bg-dbz-orange/10 text-dbz-orange border-dbz-orange/20" : "bg-zinc-900 text-zinc-600 border-zinc-800"}`}
										>
											{isUnlocked ? (
												<Trophee className="w-6 h-6" />
											) : (
												<Cadenas className="w-6 h-6" />
											)}
										</div>
										<div className="space-y-1 flex-1">
											<div className="flex justify-between items-start gap-2">
												<h4 className="font-display font-extrabold text-sm text-white group-hover:text-dbz-orange transition-colors">
													{ach.title}
												</h4>
												<span
													className={`text-[8px] font-bold px-1.5 py-0.5 rounded font-mono uppercase ${
														isUnlocked
															? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
															: "bg-zinc-800 text-zinc-500"
													}`}
												>
													{isUnlocked ? "Obtenu" : `${totalReadChapters}/${ach.required}`}
												</span>
											</div>
											<p className="text-xs text-white/60 font-display leading-relaxed">
												{ach.desc}
											</p>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
