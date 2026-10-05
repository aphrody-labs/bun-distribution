"use client";

// Best of des sagas & Catalogue fusionné — L'anthologie complète de Dragon Ball.
// Écran de sélection façon jeu DBZ :
// 1. Un switcher animé par série et par saga (cartes arcades, tags DB/DBZ/GT/Super/Daima)
// 2. Une scène centrale cinématique (artwork 3D, pitch, stats réelles, CTA)
// 3. Quatre sections majeures en H1 pour chaque grand type de média :
//    - 01 : Épisodes à découvrir
//    - 02 : Films & Téléfilms cultes
//    - 03 : Manga original & Tomes reliés
//    - 04 : Guides, Databooks & Archives secrètes
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import type { BestOfSagaView } from "@/lib/home-bestof";
import { onTablistKeyDown } from "@/lib/tablist-keys";
import type { MediaCatalog } from "@/components/stream/MediaCatalogRails";
import { EpisodeCard } from "@/components/stream/EpisodeCard";
import { PosterCard } from "@/components/stream/PosterCard";
import { languageBadges, seriesLabel } from "@/components/stream/MediaCatalogRails";
import { yearOf } from "@/lib/epoch";
import { isPathPublic, type AccessSnapshot } from "@/lib/wiki-launch";
import { T, useT } from "@/components/T";

const pad = (n: number): string => String(n).padStart(2, "0");

const PANNEAU_ID = "bestof-panneau";

// Les noms de séries sont des titres d'œuvre, pas de l'interface : ils ne se
// traduisent pas. Seul « toutes » est une étiquette de filtre.
const SERIES_FILTERS: { id: string; label?: string; labelKey?: string }[] = [
	{ id: "ALL", labelKey: "home.bestof.filterAll" },
	{ id: "DB", label: "Dragon Ball" },
	{ id: "DBZ", label: "Dragon Ball Z" },
	{ id: "DBGT", label: "Dragon Ball GT" },
	{ id: "DBS", label: "Dragon Ball Super" },
	{ id: "DB_DAIMA", label: "Daima" },
];

function useHorizontalWheel(ref: RefObject<HTMLDivElement | null>, remonteCle?: string) {
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
			if (!d || el.scrollWidth <= el.clientWidth + 4) return;
			const fin = el.scrollWidth - el.clientWidth;
			if ((d > 0 && el.scrollLeft >= fin - 1) || (d < 0 && el.scrollLeft <= 1)) return;
			e.preventDefault();
			el.scrollLeft += d;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [ref, remonteCle]);
}

export function SagaBestOf({
	sagas,
	active,
	compact = false,
	catalog = null,
	access = null,
}: {
	sagas: BestOfSagaView[];
	active: boolean;
	/** ≤640px : rails resserrés, description raccourcie. */
	compact?: boolean;
	catalog?: MediaCatalog | null;
	access?: AccessSnapshot | null;
}) {
	const t = useT();
	const [selectedSeries, setSelectedSeries] = useState<string>("ALL");
	const [sel, setSel] = useState(0);
	const touchedRef = useRef(false);

	const railRef = useRef<HTMLDivElement>(null);
	const epRailRef = useRef<HTMLDivElement>(null);
	const movieRailRef = useRef<HTMLDivElement>(null);
	const mangaRailRef = useRef<HTMLDivElement>(null);
	const databookRailRef = useRef<HTMLDivElement>(null);

	// Filtre les sagas selon la série active
	const filteredSagas = useMemo(() => {
		if (selectedSeries === "ALL") return sagas;
		return sagas.filter((s) => {
			const label = s.seriesLabel.toUpperCase();
			if (selectedSeries === "DB" && label.includes("DRAGON BALL") && !label.includes("Z") && !label.includes("GT") && !label.includes("SUPER") && !label.includes("DAIMA")) return true;
			if (selectedSeries === "DBZ" && label.includes("Z")) return true;
			if (selectedSeries === "DBGT" && label.includes("GT")) return true;
			if (selectedSeries === "DBS" && label.includes("SUPER")) return true;
			if (selectedSeries === "DB_DAIMA" && label.includes("DAIMA")) return true;
			return false;
		});
	}, [sagas, selectedSeries]);

	const saga = filteredSagas[Math.min(sel, filteredSagas.length - 1)] ?? sagas[0];

	useHorizontalWheel(railRef);
	useHorizontalWheel(epRailRef, saga?.slug);
	useHorizontalWheel(movieRailRef, saga?.slug);
	useHorizontalWheel(mangaRailRef, saga?.slug);
	useHorizontalWheel(databookRailRef, saga?.slug);

	const select = useCallback((i: number, user = true) => {
		if (user) touchedRef.current = true;
		setSel(i);
	}, []);

	const changeSeries = useCallback((seriesId: string) => {
		touchedRef.current = true;
		setSelectedSeries(seriesId);
		setSel(0);
	}, []);

	// Auto-défilement si inactif
	useEffect(() => {
		if (!active || filteredSagas.length <= 1) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const id = setInterval(() => {
			if (document.hidden || touchedRef.current) return;
			setSel((i) => (i + 1) % filteredSagas.length);
		}, 9000);
		return () => clearInterval(id);
	}, [active, filteredSagas.length]);

	// Centre la carte sélectionnée dans le rail
	useEffect(() => {
		const rail = railRef.current;
		const card = rail?.children[sel] as HTMLElement | undefined;
		if (!rail || !card) return;
		rail.scrollTo({
			left: card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2,
			behavior: "smooth",
		});
		epRailRef.current?.scrollTo({ left: 0, behavior: "smooth" });
		movieRailRef.current?.scrollTo({ left: 0, behavior: "smooth" });
		mangaRailRef.current?.scrollTo({ left: 0, behavior: "smooth" });
	}, [sel]);

	if (!saga) return null;

	const stats = [
		saga.stats.episodes > 0 && `${saga.stats.episodes} épisodes`,
		saga.stats.films > 0 && `${saga.stats.films} film${saga.stats.films > 1 ? "s" : ""}`,
		saga.stats.tomes > 0 && `${saga.stats.tomes} tome${saga.stats.tomes > 1 ? "s" : ""}`,
	].filter(Boolean) as string[];

	// Épisodes : médias de la saga + catalogue général
	const sagaEpisodes = saga.media.filter((m) => m.kind === "episode");
	const catalogEpisodes = catalog?.episodes ?? [];

	// Films : médias de la saga + catalogue films
	const sagaMovies = saga.media.filter((m) => m.kind === "film");
	const catalogMovies = catalog?.movies ?? [];

	// Manga : tomes de la saga + catalogue manga
	const sagaTomes = saga.media.filter((m) => m.kind === "tome");
	const catalogManga = catalog?.manga ?? [];

	// Databooks : catalogue databooks
	const catalogDatabooks = catalog?.databooks ?? [];

	const canViewEpisodes = !access || isPathPublic("/wiki/episodes", access);
	const canViewMovies = !access || isPathPublic("/wiki/films", access);
	const canViewManga = !access || isPathPublic("/wiki/manga", access);
	const canViewDatabooks = !access || isPathPublic("/wiki/databooks", access);

	return (
		<div className="bestof reveal-up" style={{ ["--accent" as string]: saga.accent }}>
			{/* ── Switcher par série Dragon Ball ── */}
			<div className="bestof-series-bar" role="group" aria-label={t("home.bestof.filterSeries")}>
				{SERIES_FILTERS.map((f) => (
					<button
						key={f.id}
						type="button"
						className={`bestof-series-tab ${selectedSeries === f.id ? "is-on" : ""}`}
						onClick={() => changeSeries(f.id)}
					>
						{f.labelKey ? t(f.labelKey) : f.label}
					</button>
				))}
			</div>

			{/* ── Rail de sélection des sagas ── */}
			<div tabIndex={0}
				ref={railRef}
				className="bestof__rail"
				role="tablist"
				aria-label={t("home.bestof.chooseSaga")}
				onKeyDown={onTablistKeyDown}
			>
				{filteredSagas.map((s, i) => (
					<button
						key={s.slug}
						id={`bestof-onglet-${s.slug}`}
						type="button"
						role="tab"
						aria-selected={i === sel}
						aria-controls={PANNEAU_ID}
						tabIndex={i === sel ? 0 : -1}
						className={`bestof-card${i === sel ? " is-on" : ""}`}
						style={{ ["--accent" as string]: s.accent }}
						onClick={() => select(i)}
					>
						<img src={s.image} alt="" loading="lazy" decoding="async" />
						<span className="bestof-card__shade" aria-hidden />
						<span className="bestof-card__meta">
							<span className="bestof-card__series">{s.seriesLabel}</span>
							<span className="bestof-card__name">{s.name}</span>
						</span>
					</button>
				))}
			</div>

			{/* ── Scène centrale (remontée à chaque saga → animation d'entrée) ── */}
			<div
				className="bestof__stage"
				key={saga.slug}
				id={PANNEAU_ID}
				role="tabpanel"
				aria-labelledby={`bestof-onglet-${saga.slug}`}
			>
				<div className="bestof__art" aria-hidden>
					<img src={saga.image} alt="" loading="lazy" decoding="async" />
				</div>
				<div className="bestof__info">
					<p className="bestof__eyebrow">
						<span className="bestof__idx">
							{pad(sel + 1)}/{pad(filteredSagas.length)}
						</span>
						{saga.seriesLabel}
						{saga.years && <span className="bestof__years"> · {saga.years}</span>}
					</p>
					<h3 className="bestof__name">{saga.name}</h3>
					<p className="bestof__tagline">{saga.tagline}</p>
					{!compact && saga.description && <p className="bestof__desc">{saga.description}</p>}
					{stats.length > 0 && (
						<p className="bestof__stats">
							{stats.map((s, i) => (
								<span key={s}>
									{i > 0 && <i aria-hidden>·</i>}
									{s}
								</span>
							))}
						</p>
					)}
					<div className="bestof__ctas">
						<Link href={saga.watchHref} className="home-cta home-cta--primary">
							{saga.watchLabel}
						</Link>
						<Link href="/wiki/chronologie" className="home-cta home-cta--ghost">
							<T k="home.bestof.fullTimeline" />
						</Link>
					</div>
				</div>

				{/* Flèches de navigation */}
				{filteredSagas.length > 1 && (
					<div className="bestof__arrows">
						<button
							type="button"
							className="bestof__arrow"
							aria-label={t("home.bestof.prevSaga")}
							onClick={() => select((sel - 1 + filteredSagas.length) % filteredSagas.length)}
						>
							←
						</button>
						<button
							type="button"
							className="bestof__arrow"
							aria-label={t("home.bestof.nextSaga")}
							onClick={() => select((sel + 1) % filteredSagas.length)}
						>
							→
						</button>
					</div>
				)}
			</div>

			{/* ── SECTIONS MÉDIAS EN H1 — Le Catalogue Fusionné ── */}
			<div className="bestof-categories">
				{/* 01 — Épisodes */}
				{canViewEpisodes && (sagaEpisodes.length > 0 || catalogEpisodes.length > 0) && (
					<section className="bestof-category-section" aria-labelledby="cat-h1-episodes">
						<header className="bestof-category-header">
							<h2 id="cat-h1-episodes" className="bestof-category-title">
								<span className="bestof-category-num">01</span>
								<span>{t("home.bestof.episodes.title")}</span>
							</h2>
							<span className="bestof-category-badge">{saga.name}</span>
							<Link href="/wiki/episodes" className="bestof-category-all">
								{t("home.bestof.episodes.all")} →
							</Link>
						</header>

						<div ref={epRailRef} className="bestof-category-rail">
							{/* Épisodes de la saga en premier */}
							{sagaEpisodes.map((m) => (
								<Link
									key={m.href}
									href={m.href}
									className="bestof-media bestof-media--episode shrink-0"
									aria-label={t("home.bestof.episodeLabel", { label: m.label })}
								>
									<img src={m.image} alt="" loading="lazy" decoding="async" />
									<span className="bestof-media__shade" aria-hidden />
									<span className="bestof-media__badge">{m.badge}</span>
									<span className="bestof-media__label">{m.label}</span>
								</Link>
							))}
							{/* Complété par le catalogue général */}
							{catalogEpisodes.map((ep) => {
								const languages = languageBadges(ep.players);
								return (
									<EpisodeCard
										key={`cat-ep-${ep.id}`}
										href={`/wiki/episodes/${ep.id}`}
										number={ep.number}
										title={ep.title || t("home.bestof.episodeNumber", { number: ep.number ?? ep.id })}
										titleJa={ep.titleJa}
										image={ep.image}
										year={yearOf(ep.airDate)}
										hasVf={languages.hasVf}
										hasVostfr={languages.hasVostfr}
									/>
								);
							})}
						</div>
					</section>
				)}

				{/* 02 — Films & Téléfilms */}
				{canViewMovies && (sagaMovies.length > 0 || catalogMovies.length > 0) && (
					<section className="bestof-category-section" aria-labelledby="cat-h1-movies">
						<header className="bestof-category-header">
							<h2 id="cat-h1-movies" className="bestof-category-title">
								<span className="bestof-category-num">02</span>
								<span>{t("home.bestof.movies.title")}</span>
							</h2>
							<span className="bestof-category-badge">{t("home.bestof.movies.badge")}</span>
							<Link href="/wiki/films" className="bestof-category-all">
								{t("home.bestof.movies.all")} →
							</Link>
						</header>

						<div ref={movieRailRef} className="bestof-category-rail">
							{sagaMovies.map((m) => (
								<Link
									key={m.href}
									href={m.href}
									className="bestof-media bestof-media--film shrink-0"
									aria-label={t("home.bestof.movieLabel", { label: m.label })}
								>
									<img src={m.image} alt="" loading="lazy" decoding="async" />
									<span className="bestof-media__shade" aria-hidden />
									<span className="bestof-media__badge">{m.badge}</span>
									<span className="bestof-media__label">{m.label}</span>
								</Link>
							))}
							{catalogMovies.map((mov) => {
								const languages = languageBadges(mov.players);
								return (
									<PosterCard
										key={`cat-mov-${mov.id}`}
										href={`/wiki/films/${mov.slug}`}
										title={mov.title}
										titleJa={mov.titleJa}
										poster={mov.poster}
										year={yearOf(mov.releaseDate)}
										meta={mov.duration ? `${mov.duration} min` : null}
										hasVf={languages.hasVf}
										hasVostfr={languages.hasVostfr}
										badge={t("home.bestof.badgeMovie")}
									/>
								);
							})}
						</div>
					</section>
				)}

				{/* 03 — Manga original & Tomes */}
				{canViewManga && (sagaTomes.length > 0 || catalogManga.length > 0) && (
					<section className="bestof-category-section" aria-labelledby="cat-h1-manga">
						<header className="bestof-category-header">
							<h2 id="cat-h1-manga" className="bestof-category-title">
								<span className="bestof-category-num">03</span>
								<span>{t("home.bestof.manga.title")}</span>
							</h2>
							<span className="bestof-category-badge">{t("home.bestof.manga.badge")}</span>
							<Link href="/wiki/manga" className="bestof-category-all">
								{t("home.bestof.manga.all")} →
							</Link>
						</header>

						<div ref={mangaRailRef} className="bestof-category-rail">
							{sagaTomes.map((m) => (
								<Link
									key={m.href}
									href={m.href}
									className="bestof-media bestof-media--tome shrink-0"
									aria-label={t("home.bestof.volumeLabel", { label: m.label })}
								>
									<img src={m.image} alt="" loading="lazy" decoding="async" />
									<span className="bestof-media__shade" aria-hidden />
									<span className="bestof-media__badge">{m.badge}</span>
									<span className="bestof-media__label">{m.label}</span>
								</Link>
							))}
							{catalogManga.map((vol) => (
								<PosterCard
									key={`cat-vol-${vol.id}`}
									href={`/wiki/manga/volume/${vol.id}`}
									title={vol.title || t("home.bestof.volumeNumber", { number: vol.number ?? vol.id })}
									titleJa={vol.titleJa}
									poster={vol.cover}
									year={yearOf(vol.publishedAt)}
									meta={seriesLabel(vol.series ?? "DB")}
									badge={
										vol.number != null
											? t("home.bestof.volumeNumber", { number: vol.number })
											: t("home.bestof.badgeManga")
									}
									action="read"
								/>
							))}
						</div>
					</section>
				)}

				{/* 04 — Guides, Databooks & Archives */}
				{canViewDatabooks && catalogDatabooks.length > 0 && (
					<section className="bestof-category-section" aria-labelledby="cat-h1-databooks">
						<header className="bestof-category-header">
							<h2 id="cat-h1-databooks" className="bestof-category-title">
								<span className="bestof-category-num">04</span>
								<span>{t("home.bestof.databooks.title")}</span>
							</h2>
							<span className="bestof-category-badge">{t("home.bestof.databooks.badge")}</span>
							<Link href="/wiki/databooks" className="bestof-category-all">
								{t("home.bestof.databooks.all")} →
							</Link>
						</header>

						<div ref={databookRailRef} className="bestof-category-rail">
							{catalogDatabooks.map((book) => (
								<PosterCard
									key={`cat-book-${book.id}`}
									href={`/wiki/databooks/${book.id}`}
									title={book.title}
									titleJa={book.titleJa}
									poster={book.cover}
									year={yearOf(book.publishedAt)}
									meta={book.category}
									badge={
										book.kind === "interview"
											? t("home.bestof.badgeInterview")
											: t("home.bestof.badgeDatabook")
									}
									action="read"
								/>
							))}
						</div>
					</section>
				)}
			</div>
		</div>
	);
}
