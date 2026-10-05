"use client";

/**
 * ChronologyTimeline — frise **publique et FIXE** de la chronologie universelle.
 *
 * L'ordre officiel est décidé par l'admin (`/admin/chronologie` → `applyChronology`
 * côté serveur) : ce composant reçoit la liste DÉJÀ résolue et ordonnée. Il ne
 * propose que des aides de lecture (filtre par ère, recherche, bascule épisodes/
 * films, tri alternatif diffusion/titre, export de la liste officielle). Aucune
 * composition personnelle — l'édition vit exclusivement côté admin.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
	Coche,
	Copie,
	Film,
	Lecture,
	Livre,
	Recherche,
	Telecharger,
	Tv,
} from "@/components/icones";
import { assetUrl } from "@/lib/assets";
import Image from "next/image";
import { isEditableAsset } from "@/lib/images";
import {
	ERA_ORDER,
	ERA_LABELS,
	ERA_ACCENT,
	SORT_LABELS,
	compareTimeline,
	toJSONExport,
	toCSVExport,
	toMarkdownExport,
	timelineKey,
	type Era,
	type SortMode,
	type ResolvedTimelineItem,
} from "@/lib/chronology";

const yearOf = (sec: number | null) => (sec ? new Date(sec * 1000).getFullYear() : null);

const SORTS: SortMode[] = ["era", "date", "title"];

/** Taille d'un lot de rendu de la frise (cf. rendu incrémental plus bas). */
const CHUNK = 150;

export function ChronologyTimeline({ items }: { items: ResolvedTimelineItem[] }) {
	const [eras, setEras] = useState<Set<Era>>(() => new Set(ERA_ORDER));
	const [showEpisodes, setShowEpisodes] = useState(true);
	const [showMovies, setShowMovies] = useState(true);
	const [showManga, setShowManga] = useState(true);
	const [q, setQ] = useState("");
	const [sort, setSort] = useState<SortMode>("era");
	const [copied, setCopied] = useState(false);

	// Comptes par ère (dataset complet, pour les puces de filtre).
	const eraCounts = useMemo(() => {
		const m = new Map<Era, number>();
		for (const it of items) m.set(it.era, (m.get(it.era) ?? 0) + 1);
		return m;
	}, [items]);

	const filtered = useMemo(() => {
		const needle = q.trim().toLowerCase();
		const list = items.filter((it) => {
			if (!eras.has(it.era)) return false;
			if (it.kind === "episode" && !showEpisodes) return false;
			if (it.kind === "movie" && !showMovies) return false;
			if (it.kind === "manga" && !showManga) return false;
			if (needle) {
				const hay = `${it.title} ${it.titleJa ?? ""} ${it.series}`.toLowerCase();
				if (!hay.includes(needle)) return false;
			}
			return true;
		});
		// « era » = ordre officiel fourni (déjà résolu côté serveur) → on ne re-trie
		// PAS. Les autres modes sont des vues alternatives calculées à la volée.
		return sort === "era" ? list : [...list].toSorted(compareTimeline(sort));
	}, [items, eras, showEpisodes, showMovies, showManga, q, sort]);

	const totalEpisodes = useMemo(() => items.filter((i) => i.kind === "episode").length, [items]);
	const totalMovies = useMemo(() => items.filter((i) => i.kind === "movie").length, [items]);
	const totalManga = items.length - totalEpisodes - totalMovies;

	function toggleEra(e: Era) {
		setEras((prev) => {
			const n = new Set(prev);
			if (n.has(e)) n.delete(e);
			else n.add(e);
			return n;
		});
	}
	const allEras = () => setEras(new Set(ERA_ORDER));
	const noneEras = () => setEras(new Set());

	function triggerDownload(filename: string, content: string, mime: string) {
		const blob = new Blob([content], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}
	const doExport = (fmt: "json" | "csv" | "md") => {
		if (filtered.length === 0) return;
		const map = {
			json: { fn: toJSONExport, mime: "application/json", ext: "json" },
			csv: { fn: toCSVExport, mime: "text/csv;charset=utf-8", ext: "csv" },
			md: { fn: toMarkdownExport, mime: "text/markdown;charset=utf-8", ext: "md" },
		} as const;
		const { fn, mime, ext } = map[fmt];
		triggerDownload(`chronologie-dragon-ball.${ext}`, fn(filtered), mime);
	};
	async function doCopy() {
		if (filtered.length === 0) return;
		try {
			await navigator.clipboard.writeText(toMarkdownExport(filtered));
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			/* clipboard indispo */
		}
	}

	// Répartition par ère du jeu FILTRÉ, calculée en UNE passe. L'ancienne version
	// rappelait `filtered.filter(...)` dans la boucle de rendu : sur ~750 entrées
	// ça faisait ~560 000 comparaisons à CHAQUE frappe dans le champ de recherche.
	const filteredEraStats = useMemo(() => {
		const m = new Map<Era, { total: number; episodes: number; movies: number }>();
		for (const it of filtered) {
			let e = m.get(it.era);
			if (!e) {
				e = { total: 0, episodes: 0, movies: 0 };
				m.set(it.era, e);
			}
			e.total++;
			if (it.kind === "episode") e.episodes++;
			else if (it.kind === "movie") e.movies++;
		}
		return m;
	}, [filtered]);

	// Rendu incrémental. Poser les ~750 lignes d'un coup, c'est ~7 500 nœuds DOM
	// (Lighthouse alerte au-delà de 1 400) et une page HTML de 1,6 Mo. On en pose
	// un premier lot, puis on étend à l'approche du bas de liste (ou au clic, si
	// IntersectionObserver n'est pas disponible).
	const [limit, setLimit] = useState(CHUNK);
	// Tout changement de filtre/tri repart du premier lot : sinon, filtrer après
	// avoir déroulé 600 entrées laisserait une liste courte déjà « toute chargée ».
	useEffect(() => {
		setLimit(CHUNK);
	}, [eras, showEpisodes, showMovies, showManga, q, sort]);

	const visible = limit >= filtered.length ? filtered : filtered.slice(0, limit);
	const hasMore = visible.length < filtered.length;

	const sentinelRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (!hasMore) return;
		const node = sentinelRef.current;
		if (!node || typeof IntersectionObserver === "undefined") return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + CHUNK);
			},
			// Marge généreuse : on charge le lot suivant avant que l'utilisateur
			// n'atteigne réellement le bas, donc sans à-coup visible.
			{ rootMargin: "800px 0px" }
		);
		io.observe(node);
		return () => io.disconnect();
	}, [hasMore]);

	// Rendu : groupé par ère (tri officiel) ou plat (date/titre).
	const rows: React.ReactNode[] = [];
	let lastEra: Era | null = null;
	for (const it of visible) {
		if (sort === "era" && it.era !== lastEra) {
			lastEra = it.era;
			const c = filteredEraStats.get(it.era) ?? { total: 0, episodes: 0, movies: 0 };
			rows.push(
				<EraHeader
					key={`h:${it.era}`}
					era={it.era}
					episodes={c.episodes}
					movies={c.movies}
					manga={c.total - c.episodes - c.movies}
				/>
			);
		}
		rows.push(<Row key={timelineKey(it)} it={it} grouped={sort === "era"} />);
	}

	return (
		<div className="space-y-6">
			{/* Barre de contrôle */}
			<div className="dbz-panel p-4 sm:p-5 space-y-4">
				{/* Ères */}
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-[11px] font-display font-semibold uppercase tracking-[0.14em] text-white/50 mr-1">
						Ères
					</span>
					{ERA_ORDER.filter((e) => (eraCounts.get(e) ?? 0) > 0).map((e) => {
						const on = eras.has(e);
						return (
							<button
								key={e}
								type="button"
								// Sans `aria-pressed`, ces filtres se présentent comme de simples
								// boutons : rien n'indique à un lecteur d'écran lesquels sont
								// actifs, alors que c'est toute l'information de la barre.
								aria-pressed={on}
								onClick={() => toggleEra(e)}
								className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-display font-semibold transition-all ${
									on ? "text-black" : "text-white/60 bg-white/5 hover:bg-white/10"
								}`}
								style={on ? { backgroundColor: ERA_ACCENT[e] } : undefined}
							>
								<span
									className="h-2 w-2 rounded-full"
									style={{ backgroundColor: on ? "rgba(0,0,0,0.55)" : ERA_ACCENT[e] }}
								/>
								{ERA_LABELS[e]}
								<span className={on ? "text-black/60" : "text-white/50"}>{eraCounts.get(e)}</span>
							</button>
						);
					})}
					<button
						type="button"
						onClick={eras.size === ERA_ORDER.length ? noneEras : allEras}
						className="ml-auto inline-flex min-h-11 items-center px-1 text-[11px] text-white/50 hover:text-dbz-orange transition-colors"
					>
						{eras.size === ERA_ORDER.length ? "Tout décocher" : "Tout cocher"}
					</button>
				</div>

				{/* Type + recherche + tri */}
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex rounded-lg border border-dbz-border overflow-hidden">
						<TypeToggle
							icon={<Tv className="h-3.5 w-3.5" />}
							label={`Épisodes ${totalEpisodes}`}
							on={showEpisodes}
							onClick={() => setShowEpisodes((v) => !v)}
						/>
						<TypeToggle
							icon={<Film className="h-3.5 w-3.5" />}
							label={`Films ${totalMovies}`}
							on={showMovies}
							onClick={() => setShowMovies((v) => !v)}
						/>
						{totalManga > 0 && (
							<TypeToggle
								icon={<Livre className="h-3.5 w-3.5" />}
								label={`Manga ${totalManga}`}
								on={showManga}
								onClick={() => setShowManga((v) => !v)}
							/>
						)}
					</div>

					<div className="relative flex-1 min-w-[180px]">
						<Recherche className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
						<input
							type="search"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							aria-label="Rechercher un titre dans la chronologie"
							placeholder="Rechercher un titre…"
							className="w-full h-9 pl-9 pr-3 rounded-lg bg-dbz-bg/70 border border-dbz-border focus:border-dbz-orange outline-none text-[13px] text-white placeholder:text-white/50"
						/>
					</div>

					<label className="flex items-center gap-2 text-[12px] text-white/50">
						Vue
						<select
							value={sort}
							onChange={(e) => setSort(e.target.value as SortMode)}
							className="h-9 rounded-lg bg-dbz-bg/70 border border-dbz-border px-2 text-[13px] text-white outline-none focus:border-dbz-orange"
						>
							{SORTS.map((s) => (
								<option key={s} value={s} className="bg-dbz-card">
									{SORT_LABELS[s]}
								</option>
							))}
						</select>
					</label>
				</div>

				{/* Export de la vue courante */}
				<div className="flex flex-wrap items-center gap-2 border-t border-dbz-border pt-3">
					<span className="text-[12px] text-white/50">
						<strong className="text-white">{filtered.length}</strong> entrée
						{filtered.length > 1 ? "s" : ""} affichée{filtered.length > 1 ? "s" : ""}
					</span>
					<span className="text-white/20">·</span>
					<span className="text-[11px] text-white/50">Exporter :</span>
					<ExportBtn label="JSON" onClick={() => doExport("json")} />
					<ExportBtn label="CSV" onClick={() => doExport("csv")} />
					<ExportBtn label="Markdown" onClick={() => doExport("md")} />
					<ExportBtn
						label={copied ? "Copié !" : "Copier"}
						icon={copied ? <Coche className="h-3 w-3" /> : <Copie className="h-3 w-3" />}
						onClick={doCopy}
					/>
				</div>
			</div>

			{/* Frise */}
			{filtered.length === 0 ? (
				<p className="dbz-panel py-12 text-center text-white/50">
					Aucune entrée ne correspond aux filtres.
				</p>
			) : (
				<>
					<div className="space-y-1.5">{rows}</div>
					{hasMore && (
						<div ref={sentinelRef} className="pt-6 text-center">
							<button
								type="button"
								onClick={() => setLimit((n) => n + CHUNK)}
								className="dbz-button-ghost !text-xs"
							>
								Afficher {Math.min(CHUNK, filtered.length - visible.length)} entrées de plus
								<span className="ml-2 text-white/50">
									{visible.length} / {filtered.length}
								</span>
							</button>
						</div>
					)}
				</>
			)}

			<p className="text-[11px] text-white/50 text-center pt-2">
				Chronologie officielle Dragon Ball France — {items.length} entrées, ordre validé par
				l'équipe.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------

function ExportBtn({
	label,
	icon,
	onClick,
}: {
	label: string;
	icon?: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="inline-flex min-h-11 items-center gap-1 rounded-md border border-dbz-border bg-dbz-bg/40 px-3 py-1 text-[11px] font-mono text-white/70 hover:text-white hover:border-dbz-orange/50 transition-colors"
		>
			{icon ?? <Telecharger className="h-3 w-3" />}
			{label}
		</button>
	);
}

function TypeToggle({
	icon,
	label,
	on,
	onClick,
}: {
	icon: React.ReactNode;
	label: string;
	on: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={`inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 text-[12px] font-display font-semibold transition-colors sm:min-h-0 ${
				on ? "bg-dbz-orange text-black" : "bg-dbz-bg/40 text-white/50 hover:text-white"
			}`}
		>
			{icon}
			{label}
		</button>
	);
}

function EraHeader({
	era,
	episodes,
	movies,
	manga,
}: {
	era: Era;
	episodes: number;
	movies: number;
	manga: number;
}) {
	// Résumé compact : n'affiche que les natures présentes dans cette ère.
	const parts: string[] = [];
	if (episodes) parts.push(`${episodes} ép`);
	if (movies) parts.push(`${movies} film${movies > 1 ? "s" : ""}`);
	if (manga) parts.push(`${manga} tome${manga > 1 ? "s" : ""}`);
	return (
		<div className="flex items-center gap-3 pt-6 pb-1">
			<span className="h-4 w-1.5 rounded-full" style={{ backgroundColor: ERA_ACCENT[era] }} />
			<h2
				className="font-saiyan text-2xl uppercase tracking-wide"
				style={{ color: ERA_ACCENT[era] }}
			>
				{ERA_LABELS[era]}
			</h2>
			<span className="text-[11px] text-white/50 font-mono">{parts.join(" · ")}</span>
			<span className="flex-1 h-px" style={{ backgroundColor: `${ERA_ACCENT[era]}33` }} />
		</div>
	);
}

function Row({ it, grouped }: { it: ResolvedTimelineItem; grouped: boolean }) {
	const isMovie = it.kind === "movie";
	const isManga = it.kind === "manga";
	const year = yearOf(it.date);
	const accent = ERA_ACCENT[it.era];
	return (
		// Toute la ligne est cliquable (la miniature ET le titre) : avant, seul le
		// texte du titre était un lien → cliquer la vignette (qui affiche pourtant un
		// overlay Play au survol) ne renvoyait nulle part. La chronologie n'est pas
		// sous le layout /wiki/episodes|films → pas d'interception @modal, nav douce OK.
		<Link
			href={it.href}
			className={`group flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
				isMovie
					? "border-dbz-orange/25 bg-dbz-orange/[0.06] hover:border-dbz-orange/50"
					: isManga
						? "border-pink-400/25 bg-pink-500/[0.06] hover:border-pink-400/50"
						: "border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
			}`}
			style={grouped ? { borderLeftColor: accent, borderLeftWidth: 3 } : undefined}
		>
			{/* Miniature : still 16:9 (épisode) ou couverture 2:3 (film/tome), dans un
			    emplacement de largeur fixe → titres alignés. Pastille numéro en repli. */}
			<div className="flex h-14 w-[104px] shrink-0 items-center overflow-hidden">
				{it.image ? (
					<div
						className={`relative h-14 overflow-hidden rounded ${
							isMovie || isManga ? "w-10" : "w-[104px]"
						}`}
					>
						<Image
							src={assetUrl(it.image)}
							alt=""
							fill
							// La miniature fait 104×56 px (40×56 pour un film ou un tome) et
							// chargeait pourtant le JPEG source : ~71 Kio pour une image de la
							// taille d'un timbre, × 150 sur la page. `sizes` fixe la largeur
							// réelle et l'optimiseur sert la variante correspondante.
							sizes={isMovie || isManga ? "40px" : "104px"}
							quality={70}
							unoptimized={isEditableAsset(it.image)}
							className="object-cover transition-transform duration-300 group-hover:scale-110"
						/>
						{!(isMovie || isManga) && it.number != null && (
							<span className="scouter-text absolute left-1 top-1 bg-black/70 px-1 py-0.5 text-[9px] leading-none text-dbz-orange">
								#{it.number}
							</span>
						)}
						<span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
							<Lecture className="h-4 w-4 fill-current text-dbz-orange" />
						</span>
					</div>
				) : isMovie || isManga ? (
					<span
						className={`flex h-14 w-10 items-center justify-center rounded ${
							isManga ? "bg-pink-500/15 text-pink-300" : "bg-dbz-orange/15 text-dbz-orange"
						}`}
					>
						{isManga ? <Livre className="h-4 w-4" /> : <Film className="h-4 w-4" />}
					</span>
				) : (
					<span
						className="flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-mono font-bold text-black"
						style={{ backgroundColor: accent }}
						title={`${it.series} — épisode`}
					>
						{it.number ?? "?"}
					</span>
				)}
			</div>

			{/* Titre + méta */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					{isMovie && (
						<span className="rounded bg-dbz-orange px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
							Film
						</span>
					)}
					{isManga && (
						<span className="rounded bg-pink-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">
							Tome {it.number ?? "?"}
						</span>
					)}
					<span className="truncate font-display font-semibold text-[14px] text-white group-hover:text-dbz-orange transition-colors">
						{it.title || "(sans titre)"}
					</span>
				</div>
				<div className="flex items-center gap-2 text-[11px] text-white/50">
					{!grouped && (
						<span
							className="inline-flex items-center gap-1"
							style={{ color: accent }}
							title={ERA_LABELS[it.era]}
						>
							<span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
							{ERA_LABELS[it.era]}
						</span>
					)}
					{year && <span>{year}</span>}
					{it.hasVf && <span className="text-namek">VF</span>}
					{it.hasVostfr && <span className="text-dbz-blue-light">VOSTFR</span>}
				</div>
				{it.note && (
					<p className="mt-1 text-[11px] leading-snug text-white/55 italic border-l-2 border-dbz-yellow/40 pl-2">
						{it.note}
					</p>
				)}
			</div>
		</Link>
	);
}
