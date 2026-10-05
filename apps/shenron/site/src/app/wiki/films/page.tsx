import { ContributeRail } from "@/components/kit";
import { SectionUnavailable } from "@/components/wiki/SectionUnavailable";
import { dbUniverse } from "@/lib/db-universe";
import Link from "next/link";
import { T } from "@/components/T";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { ContinueRail } from "@/components/history/ContinueRail";
import type { Metadata } from "next";
import { pageHero } from "@/lib/banner-config";
import { eraOf, ERA_ACCENT } from "@/lib/chronology";
import { Billboard } from "@/components/stream/Billboard";
import { StreamRow } from "@/components/stream/StreamRow";
import { PosterCard } from "@/components/stream/PosterCard";
import { stripSourceTags, langBadges } from "@/lib/media";

import { ogMeta } from "@/lib/og";

export const revalidate = 3600;

const title = "Films Dragon Ball — l'intégrale cinéma & TV";
const description =
	"Tous les films Dragon Ball, Dragon Ball Z et Dragon Ball Super — fiches complètes avec date de sortie, durée, synopsis. Regarde en VF et VOSTFR.";

export const metadata: Metadata = {
	title,
	description,
	...ogMeta({
		title,
		description,
		type: "website",
		canonical: "/wiki/films",
	}),
};

/**
 * L'ordre des rubriques : les films au cinéma d'abord, dans l'ordre des séries,
 * puis ce qui n'est pas sorti en salle.
 *
 * L'ordre précédent ouvrait sur Dragon Ball Super, ce qui donnait un catalogue
 * qui commence par la fin. La nouveauté est déjà mise en avant par le billboard
 * en haut de page ; la liste, elle, se lit dans l'ordre de la franchise.
 */
const SERIES_ORDER = [
	"DB_MOVIE",
	"DBZ_MOVIE",
	"DBS_MOVIE",
	"DB_DAIMA_MOVIE",
	"DBZ_SPECIAL",
	"DBGT_SPECIAL",
	"DBZ_OVA",
];
const SERIES_LABELS: Record<string, string> = {
	DB_MOVIE: "Films Dragon Ball",
	DBZ_MOVIE: "Films Dragon Ball Z",
	DBS_MOVIE: "Films Dragon Ball Super",
	DB_DAIMA_MOVIE: "Films Daima",
	DBZ_OVA: "OVA Dragon Ball Z",
	DBZ_SPECIAL: "Téléfilms Dragon Ball Z",
	DBGT_SPECIAL: "Téléfilms Dragon Ball GT",
};

/**
 * La pastille d'une carte dit ce que le titre EST.
 *
 * Toutes les cartes portaient « Film », y compris sous « OVA » et
 * « Téléfilms » : la rubrique disait une chose, la carte son contraire. Un
 * téléfilm n'est pas sorti en salle, et c'est précisément ce que le lecteur
 * vient vérifier sur une page de catalogue.
 */
const SERIES_BADGES: Record<string, string> = {
	DBZ_OVA: "OVA",
	DBZ_SPECIAL: "Téléfilm",
	DBGT_SPECIAL: "Téléfilm",
};
const badgeFor = (series: string | null) => SERIES_BADGES[series ?? ""] ?? "Film";

/** Ce qui est sorti au cinéma — le reste est un téléfilm ou une OVA. */
const estFilm = (series: string | null) => !SERIES_BADGES[series ?? ""];

const yearOf = (sec: number | null) => (sec ? new Date(sec * 1000).getFullYear() : null);

export default async function FilmsPage() {
	const data = await dbUniverse.movies();
	if (!data || data.movies.length === 0)
		return <SectionUnavailable title={<T k="wiki.films.unavailable" />} />;
	const movies = data.movies.map((m) => (Object.assign(m, { synopsis: stripSourceTags(m.synopsis) })));

	// Film mis en avant = le plus récent daté (effet « nouveauté » en billboard).
	// Restreint aux vrais films : le bouton dit « Regarder le film », et une OVA
	// plus récente qu'un long métrage le démentirait.
	const featured =
		[...movies]
			.filter((m) => m.release_date != null && estFilm(m.series))
			.toSorted((a, b) => (b.release_date ?? 0) - (a.release_date ?? 0))[0] ?? movies[0]!;
	const fYear = yearOf(featured.release_date);

	// Ordonne les séries connues puis toute série présente non listée.
	const presentSeries = [...new Set(movies.map((m) => m.series))];
	const orderedSeries = [
		...SERIES_ORDER.filter((s) => presentSeries.includes(s)),
		...presentSeries.filter((s) => !SERIES_ORDER.includes(s)).toSorted(),
	];
	const groups = orderedSeries
		.map((s) => ({
			key: s,
			label: SERIES_LABELS[s] ?? s.replace(/_/g, " "),
			movies: movies
				.filter((m) => m.series === s)
				.toSorted((a, b) => (a.release_date ?? 0) - (b.release_date ?? 0)),
		}))
		.filter((g) => g.movies.length > 0);

	return (
		<>
			<Billboard
				backdrop={await pageHero("films")}
				poster={featured.poster}
				eyebrow={<T k="wiki.films.eyebrow" />}
				title={featured.title}
				titleJa={featured.title_ja}
				meta={[
					fYear ? String(fYear) : null,
					featured.duration_min ? `${featured.duration_min} min` : null,
					<T key="cat" k="wiki.films.metaProductions" values={{ count: movies.length }} />,
				]}
				synopsis={featured.synopsis}
				hasVf={langBadges(featured.players).hasVf}
				hasVostfr={langBadges(featured.players).hasVostfr}
				primaryHref={`/wiki/films/${featured.slug}`}
				primaryHardNav
				primaryLabel={<T k="wiki.films.watch" />}
				secondaryHref="/wiki/chronologie"
				secondaryLabel={<T k="categories.chronologie.label" />}
			/>

			<div className="wiki-container">
				<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
					<Breadcrumbs
						items={[{ label: "Films", display: <T k="categories.films.label" /> }]}
					/>
					<WikiDrawer />
				</div>
				<div
					className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4"
					aria-label="Couverture du catalogue vidéo"
				>
					{[
						["Productions", movies.length],
						["VF", movies.filter((movie) => langBadges(movie.players).hasVf).length],
						["VOSTFR", movies.filter((movie) => langBadges(movie.players).hasVostfr).length],
						["Avec affiche", movies.filter((movie) => movie.poster).length],
					].map(([label, value]) => (
						<div
							key={label}
							className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3"
						>
							<div className="text-xl font-black tabular-nums text-white sm:text-2xl">{value}</div>
							<div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div>
						</div>
					))}
				</div>
				<nav
					aria-label="Catégories du catalogue films"
					className="mb-8 flex gap-2 overflow-x-auto pb-1"
				>
					{groups.map((group) => (
						<a
							key={group.key}
							href={`#films-${group.key}`}
							className="min-h-10 shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/65 transition hover:border-dbz-orange/50 hover:text-dbz-orange"
						>
							{group.label} <span className="ml-1 text-white/40">{group.movies.length}</span>
						</a>
					))}
				</nav>
				<ContinueRail kinds={["movie"]} titleKey="history.resumeWatching" />
				{groups.map((g) => (
					<StreamRow
						key={g.key}
						id={`films-${g.key}`}
						title={g.label}
						count={g.movies.length}
						accent={ERA_ACCENT[eraOf(g.key)]}
					>
						{g.movies.map((m) => (
							<PosterCard
								key={m.id}
								href={`/wiki/films/${m.slug}`}
								title={m.title}
								titleJa={m.title_ja}
								poster={m.poster}
								year={yearOf(m.release_date)}
								meta={m.duration_min ? `${m.duration_min} min` : null}
								playerCount={m.players?.length ?? 0}
								hasVf={langBadges(m.players).hasVf}
								hasVostfr={langBadges(m.players).hasVostfr}
								badge={badgeFor(m.series)}
							/>
						))}
					</StreamRow>
				))}

				<Link
					href="/wiki/chronologie"
					className="group mt-4 flex items-center gap-4 rounded-xl border border-dbz-orange/25 bg-gradient-to-r from-dbz-orange/[0.08] to-transparent px-5 py-4 transition-colors hover:border-dbz-orange/60"
				>
					<span aria-hidden className="font-saiyan text-3xl leading-none text-dbz-orange">
						≡
					</span>
					<span className="flex-1">
						<span className="block font-display font-bold text-white transition-colors group-hover:text-dbz-orange">
							Chronologie universelle — films, épisodes &amp; manga
						</span>
						<span className="block text-[13px] text-white/50">
							Tout Dragon Ball (DB, Z, GT, Super, Daima) sur une seule frise officielle.
						</span>
					</span>
					<span
						aria-hidden
						className="text-lg text-dbz-orange transition-transform group-hover:translate-x-1"
					>
						→
					</span>
				</Link>
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.movie" />
			</div>
		</>
	);
}
