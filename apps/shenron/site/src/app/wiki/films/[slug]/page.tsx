import { EntityParticipation } from "@/components/social/EntityParticipation";
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
import { WikiEntitySections } from "@/components/wiki/WikiEntitySections";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { EntityRating, EntityRatingSummary } from "@/components/ratings/EntityRating";
import { CommunityRankBadge } from "@/components/ratings/CommunityRankBadge";
import { dbUniverse, assetUrl, type MovieNavItem } from "@/lib/db-universe";
import { ogMeta } from "@/lib/og";
import Image from "next/image";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { TrackHistory } from "@/components/history/TrackHistory";
import { ShareButton } from "@/components/ShareButton";
import { FavoriteButton } from "@/components/FavoriteButton";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { stripSourceTags } from "@/lib/media";
import { VideoPlayer } from "@/components/episodes/VideoPlayer";
import { VideoLecteurs } from "@/components/episodes/VideoLecteurs";
import { VideoSourceSummary } from "@/components/episodes/VideoSourceSummary";
import { VideoUnavailableCard } from "@/components/episodes/VideoUnavailableCard";
import { OffreLegale } from "@/components/episodes/OffreLegale";
import { EpisodeDownload } from "@/components/episodes/EpisodeDownload";
import { JsonLd } from "@/components/JsonLd";
import { AdUnit } from "@/components/ads/AdUnit";
import type { Movie as MovieSchema, WithContext } from "schema-dts";

import { hlsMasterUrl } from "@/lib/assets";
export const revalidate = 3600;

export async function generateStaticParams() {
	if (process.env.SHENRON_BUILD_LOW_MEMORY === "1") return [];
	const r = await dbUniverse.movies();
	return (r?.movies ?? []).map((m) => ({ slug: m.slug }));
}

const SERIES_LABELS: Record<string, string> = {
	DB_MOVIE: "Film Dragon Ball",
	DBZ_MOVIE: "Film Dragon Ball Z",
	DBS_MOVIE: "Film Dragon Ball Super",
	DB_DAIMA_MOVIE: "Film Daima",
	DBZ_OVA: "OVA Dragon Ball Z",
	DBZ_SPECIAL: "Téléfilm Dragon Ball Z",
	DBGT_SPECIAL: "Téléfilm Dragon Ball GT",
};

/**
 * Le mot qui nomme l'œuvre, seul.
 *
 * La page appelait « Film » tout ce qu'elle affichait — titre d'onglet, lecteur,
 * navigation — y compris sur une OVA ou un téléfilm, alors que sa propre
 * étiquette de rubrique disait le contraire deux lignes plus haut.
 */
const NATURES: Record<string, string> = {
	DBZ_OVA: "OVA",
	DBZ_SPECIAL: "Téléfilm",
	DBGT_SPECIAL: "Téléfilm",
};
const natureDe = (series: string | null | undefined) => NATURES[series ?? ""] ?? "Film";

/** « ce film », « cette OVA », « ce téléfilm » — le genre ne se déduit pas du mot. */
const DESIGNATIONS: Record<string, string> = {
	Film: "ce film",
	OVA: "cette OVA",
	Téléfilm: "ce téléfilm",
};

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const m = await dbUniverse.movie(slug);
	if (!m) return { title: "Film" };
	const nature = natureDe(m.series);
	const description = stripSourceTags(m.synopsis) ?? `${SERIES_LABELS[m.series] ?? nature}.`;
	return {
		title: `${m.title} — ${nature}`,
		description,
		...ogMeta({
			title: `${m.title} — DBFR`,
			description,
			image: m.poster ? assetUrl(m.poster) : undefined,
			type: "video.movie",
			canonical: `/wiki/films/${slug}`,
		}),
	};
}

export default async function FilmPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const m = await dbUniverse.movie(slug);
	if (!m) notFound();

	// Synopsis nettoyé des balises de source du dataset (cf. stripSourceTags).
	const synopsis = stripSourceTags(m.synopsis);

	// Film précédent / suivant dans la même série (ordre = date de sortie).
	const nav = await dbUniverse.movieNav(m.series, m.id);
	const nature = natureDe(m.series);

	const getYoutubeId = (url: string | null) => {
		if (!url) return null;
		const match = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]{11})/);
		return match ? match[1] : null;
	};
	const youtubeId = getYoutubeId(m.trailer_url);

	const player =
		m.players && m.players.length > 0 ? (
			<VideoLecteurs
				players={m.players}
				entityType="movie"
				entityId={m.id}
				vo={
					m.stream_url && m.subtitles?.length
						? {
								src: hlsMasterUrl(`movie-${m.id}`, "vostfr"),
								title: `${nature} : ${m.title ?? ""}`,
								poster: m.poster ? assetUrl(m.poster) : undefined,
								subtitles: m.subtitles,
							}
						: undefined
				}
			/>
		) : m.video_url ? (
			<VideoPlayer
				src={m.video_url}
				title={`${nature} : ${m.title ?? ""}`}
				poster={m.poster ? assetUrl(m.poster) : undefined}
				subtitles={m.subtitles ?? undefined}
			/>
		) : m.stream_url ? (
			<VideoPlayer
				src={hlsMasterUrl(`movie-${m.id}`)}
				title={`${nature} : ${m.title ?? ""}`}
				poster={m.poster ? assetUrl(m.poster) : undefined}
				subtitles={m.subtitles ?? undefined}
			/>
		) : null;

	// Téléchargement réellement résoluble ? Les iframes tierces (vidmoly/voe/mailru)
	// sont lisibles mais PAS téléchargeables. Seul un MP4/HLS direct est un fichier :
	// `video_url`/`stream_url` stockés, un lecteur Archive.org (MP4 dérivé de l'API
	// metadata) ou un `embedUrl` déjà direct (`.mp4`/`.m3u8`). On masque le bouton
	// sinon → jamais de lien qui renverrait un 404.
	const canDownload =
		Boolean(m.video_url) ||
		Boolean(m.stream_url) ||
		(m.players ?? []).some(
			(p) =>
				p.provider === "archive" ||
				/archive\.org\/(embed|download)\//i.test(p.embedUrl) ||
				/\.(mp4|m3u8)(\?|$)/i.test(p.embedUrl)
		);

	const jsonLdData: WithContext<MovieSchema> = {
		"@context": "https://schema.org",
		"@type": "Movie",
		name: m.title,
		image: m.poster ? assetUrl(m.poster) : undefined,
		description: synopsis ?? undefined,
		dateCreated: m.release_date
			? new Date(m.release_date * 1000).toISOString().split("T")[0]
			: undefined,
		// `datePublished` = propriété schema.org correcte pour une date de sortie.
		datePublished: m.release_date
			? new Date(m.release_date * 1000).toISOString().split("T")[0]
			: undefined,
		duration: m.duration_min ? `PT${m.duration_min}M` : undefined,
	};

	return (
		<div className="wiki-container">
			<JsonLd data={jsonLdData} />
			<TrackHistory
				kind="movie"
				id={m.slug}
				title={m.title}
				href={`/wiki/films/${m.slug}`}
				image={m.poster}
				caption={SERIES_LABELS[m.series] ?? "Film"}
			/>
			<Breadcrumbs
				className="mb-8"
				items={[
					{ label: "Films", href: "/wiki/films" },
					{ label: SERIES_LABELS[m.series] ?? "Film", href: "/wiki/films" },
					{ label: m.title },
				]}
			/>
			<div className="mb-8 flex flex-wrap items-center gap-3">
				<FavoriteButton
					kind="movie"
					id={m.slug}
					title={m.title}
					href={`/wiki/films/${m.slug}`}
					image={m.poster}
					caption={SERIES_LABELS[m.series] ?? "Film"}
				/>
				<ShareButton
					title={m.title}
					text={SERIES_LABELS[m.series] ?? "Film Dragon Ball"}
					path={`/wiki/films/${m.slug}`}
				/>
			</div>

			<div className="mb-6">
				<WikiEditBar table="db_movies" id={m.id} indexHref="/wiki/films" label={m.title} />
			</div>

			<div className="grid md:grid-cols-[280px_1fr] gap-10">
				<div>
					{m.poster ? (
						<div className="dbz-panel p-4 border-2 border-dbz-orange/30 bg-dbz-card relative overflow-hidden group">
							<div className="absolute inset-0 halftone opacity-20" />
							<Image
								src={assetUrl(m.poster)}
								alt={m.title}
								width={280}
								height={420}
								sizes="280px"
								className="w-full h-auto object-cover relative z-10 drop-shadow-[0_0_15px_rgba(255,178,0,0.3)]"
								priority
							/>
						</div>
					) : (
						<div className="dbz-panel aspect-[2/3] flex items-center justify-center bg-zinc-900">
							<span className="text-zinc-700 font-saiyan text-6xl">?</span>
						</div>
					)}
				</div>

				<div className="space-y-8">
					<header>
						<p className="font-display font-semibold text-[12px] tracking-[0.3em] uppercase text-dbz-orange mb-4">
							{SERIES_LABELS[m.series] ?? m.series.replace(/_/g, " ")}
						</p>
						<h1 className="font-saiyan text-5xl lg:text-7xl text-white mb-4 tracking-widest leading-tight">
							{m.title}
						</h1>
						{(m.title_ja || m.title_romaji) && (
							<div className="flex items-center flex-wrap gap-4 mb-6">
								{m.title_ja && (
									<span
										lang="ja"
										className="font-jp text-2xl font-bold tracking-widest text-dbz-orange"
									>
										{m.title_ja}
									</span>
								)}
								{m.title_romaji && (
									<span className="text-sm italic uppercase tracking-[0.2em] text-white/50">
										{m.title_romaji}
									</span>
								)}
							</div>
						)}

						<div className="mb-4 flex flex-wrap items-center gap-2">
							<EntityRatingSummary targetType="movie" targetId={m.id} />
							<CommunityRankBadge kind="movie" targetId={m.id} />
						</div>

						<dl className="grid grid-cols-2 gap-4 max-w-md">
							{m.release_date && (
								<div>
									<dt className="font-display font-semibold text-[11px] tracking-[0.16em] uppercase text-white/50 mb-1">
										Sortie
									</dt>
									<dd className="font-display text-white">
										{new Date(m.release_date * 1000).toLocaleDateString("fr-FR", {
											day: "numeric",
											month: "long",
											year: "numeric",
										})}
									</dd>
								</div>
							)}
							{m.duration_min && (
								<div>
									<dt className="font-display font-semibold text-[11px] tracking-[0.16em] uppercase text-white/50 mb-1">
										Durée
									</dt>
									<dd className="font-display text-white">{m.duration_min} min</dd>
								</div>
							)}
						</dl>
					</header>

					{player ? (
						<div className="shadow-2xl shadow-black/50 rounded-lg overflow-hidden relative group/player">
							{player}
							{canDownload && (
								<div className="absolute top-3 right-3 z-20">
									<EpisodeDownload
										href={`/api/movies/${m.id}/download`}
										signinCallback={`/wiki/films/${m.slug}`}
										title={m.title}
									/>
								</div>
							)}
						</div>
					) : (
						// Aucun lecteur ni source (ex. Bardock, History of Trunks…) : état
						// vide propre plutôt qu'un embed cassé ou un bouton de téléchargement
						// mort. Le reste de la fiche (poster, infos, synopsis) reste affiché.
						<VideoUnavailableCard title={m.title} kind="film" />
					)}
					<VideoSourceSummary players={m.players ?? []} subtitles={m.subtitles?.length ?? 0} />

					{/* Offre légale (ADN…) — sous le player, comme sur la fiche épisode. */}
					<OffreLegale offres={m.availability} />

					{synopsis && (
						<section className="dbz-panel p-8 relative overflow-hidden">
							<div className="absolute top-0 left-0 w-1 h-full bg-dbz-orange" />
							<h2 className="font-saiyan text-2xl text-dbz-orange mb-4 uppercase tracking-widest">
								Synopsis
							</h2>
							<div className="prose prose-invert max-w-none wiki-content">
								<WikiMarkdown body={synopsis} />
							</div>
						</section>
					)}

					<WikiEntitySections entityType="movie" entityId={m.id} />

					{youtubeId && (
						<section className="space-y-4">
							<div className="flex items-center gap-6">
								<h2 className="font-saiyan text-2xl text-white uppercase tracking-widest">
									Trailer Officiel
								</h2>
								<div className="h-px flex-1 bg-gradient-to-r from-dbz-red/50 to-transparent" />
							</div>
							<div className="dbz-panel p-2 aspect-video bg-black overflow-hidden">
								<iframe
									width="100%"
									height="100%"
									src={`https://www.youtube.com/embed/${youtubeId}`}
									title={`${m.title} Trailer`}
									frameBorder="0"
									allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
									allowFullScreen
									className="rounded-lg"
								></iframe>
							</div>
						</section>
					)}

					{m.mal_id && (
						<p className="text-[12px] text-white/50">
							Source métadonnées :{" "}
							<a
								href={`https://myanimelist.net/anime/${m.mal_id}`}
								target="_blank"
								rel="noopener noreferrer"
								className="underline hover:text-dbz-orange"
							>
								MyAnimeList #{m.mal_id}
							</a>{" "}
							(via Jikan API)
						</p>
					)}
				</div>
			</div>

			{nav && (nav.prev || nav.next) && (
				<nav aria-label="Navigation entre films" className="mt-16 grid gap-4 sm:grid-cols-2">
					{nav.prev ? (
						<MovieNavCard dir="prev" m={nav.prev} nature={nature} />
					) : (
						<span className="hidden sm:block" />
					)}
					{nav.next ? (
						<MovieNavCard dir="next" m={nav.next} nature={nature} />
					) : (
						<span className="hidden sm:block" />
					)}
				</nav>
			)}

			<div className="mt-8 text-center">
				<Link
					href="/wiki/chronologie"
					className="inline-flex items-center gap-2 text-[13px] font-display font-semibold tracking-[0.08em] uppercase text-white/60 hover:text-dbz-orange transition-colors"
				>
					⤳ Voir la chronologie universelle (épisodes + films)
				</Link>
			</div>

			{/* Bannière display en fin de fiche — à distance des contrôles du lecteur. */}
			<AdUnit placement="display" className="mt-16" />

			{/* Notes & avis — dernier bloc */}
			<div className="mt-16">
				<EntityRating
					targetType="movie"
					targetId={m.id}
					signinCallback={`/wiki/films/${slug}`}
					label={DESIGNATIONS[nature] ?? "ce film"}
				/>
			</div>

			{/* Participation : j'aime, discussion et chemin de correction — le même
			    bloc que sur toutes les autres fiches du wiki. */}
			<EntityParticipation
				kind="wiki"
				table="db_movies"
				id={m.id}
				path={`/wiki/films/${slug}`}
				label={m.title}
			/>
		</div>
	);
}

// Le voisin est de la même série : sa nature est celle de la fiche courante.
function MovieNavCard({
	dir,
	m,
	nature,
}: {
	dir: "prev" | "next";
	m: MovieNavItem;
	nature: string;
}) {
	const isPrev = dir === "prev";
	return (
		<Link
			href={`/wiki/films/${m.slug}`}
			className={`group flex items-center gap-4 dbz-panel p-4 hover:border-dbz-orange/60 transition-colors ${
				isPrev ? "" : "sm:flex-row-reverse sm:text-right"
			}`}
		>
			{m.poster ? (
				<Image
					src={assetUrl(m.poster)}
					alt=""
					width={56}
					height={84}
					className="w-14 h-auto rounded shrink-0 object-cover"
				/>
			) : (
				<div className="w-14 h-[84px] rounded bg-zinc-800 shrink-0" />
			)}
			<div className="min-w-0">
				<span className="block text-[11px] font-display font-semibold uppercase tracking-[0.14em] text-dbz-orange">
					{isPrev ? `← ${nature} précédent` : `${nature} suivant →`}
				</span>
				<span className="block font-display font-bold text-white truncate group-hover:text-dbz-orange transition-colors">
					{m.title}
				</span>
				{m.release_date && (
					<span className="block text-[12px] text-white/50">
						{new Date(m.release_date * 1000).getFullYear()}
					</span>
				)}
			</div>
		</Link>
	);
}
