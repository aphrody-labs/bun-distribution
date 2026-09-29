import { ContributeRail } from "@/components/kit";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { ContinueRail } from "@/components/history/ContinueRail";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { MangaVolumeGrid } from "@/components/manga/MangaVolumeGrid";
import { MangaInfoSection } from "@/components/manga/MangaInfoSection";
import { SERIE_COULEUR } from "@/lib/manga-editions";
import { MangaDialogueSearch } from "@/components/manga/MangaDialogueSearch";
import { ogMeta } from "@/lib/og";
import Link from "next/link";
import type { Metadata } from "next";

export const revalidate = 3600;

const title = "Manga Dragon Ball — l'œuvre originale";
const description =
	"Découvre les tomes de Dragon Ball et Dragon Ball Super, et lis les chapitres planche par planche dans le lecteur de scan DBFR.";

export const metadata: Metadata = {
	title,
	description,
	...ogMeta({
		title: "Manga Dragon Ball — tomes & chapitres",
		description,
		type: "website",
		canonical: "/wiki/manga",
	}),
};

export default async function MangaIndexPage() {
	const [
		dbVols,
		dbsVols,
		dbkzVols,
		soshuhenVols,
		animeZVols,
		animeMovieVols,
		dbgtAnimeVols,
		dbsAnimeVols,
		dbjpVols,
		araleVols,
		catalogVols,
		readableData,
		mediaWorksList,
	] = await Promise.all([
		dbUniverse.mangaVolumes("DB"),
		dbUniverse.mangaVolumes("DBS"),
		dbUniverse.mangaVolumes("DBKZ"),
		dbUniverse.mangaVolumes("SOSH"),
		dbUniverse.mangaVolumes("DBZ_ANIME_COMICS"),
		dbUniverse.mangaVolumes("DB_MOVIES"),
		dbUniverse.mangaVolumes("DBGT_ANIME_COMICS"),
		dbUniverse.mangaVolumes("DBS_ANIME_COMICS"),
		dbUniverse.mangaVolumes("DBJP"),
		dbUniverse.mangaVolumes("ARALE"),
		dbUniverse.mangaCatalogVolumes(),
		dbUniverse.readableMangaChapters(),
		dbUniverse.mediaWorks({ slug: "dragon-ball" }),
	]);

	const mediaWork = (mediaWorksList ?? [])[0] ?? null;

	const mapVolumes = (
		vols: {
			volumes?: Array<{
				id: number;
				series: string;
				volume_number: number;
				title: string | null;
				cover: string | null;
				source_url?: string | null;
				source_label?: string | null;
			}>;
		} | null
	) =>
		(vols?.volumes ?? [])
			.filter((v) => v.volume_number > 0)
			.map((v) => ({
				id: v.id,
				series: v.series,
				volumeNumber: v.volume_number,
				title: v.title,
				cover: v.cover,
				sourceUrl: v.source_url ?? null,
				sourceLabel: v.source_label ?? null,
			}));

	const dbVolumes = mapVolumes(dbVols);
	const dbsVolumes = mapVolumes(dbsVols);
	const kanzenbanVolumes = mapVolumes(dbkzVols);
	const soshuhenVolumes = mapVolumes(soshuhenVols);
	const animeZVolumes = mapVolumes(animeZVols);
	const animeMovieVolumes = mapVolumes(animeMovieVols);
	const dbjpVolumes = mapVolumes(dbjpVols);
	const dbgtAnimeVolumes = mapVolumes(dbgtAnimeVols);
	const dbsAnimeVolumes = mapVolumes(dbsAnimeVols);
	const araleVolumes = mapVolumes(araleVols);
	const catalogVolumes = mapVolumes(catalogVols);

	const allChapters = readableData?.chapters ?? [];

	// L'édition couleur compte 520 chapitres. Les sérialiser un par un dans la
	// grille ajoutait ~470 Ko à cette page (charge RSC + DOM dupliqués) pour un
	// contenu qu'on navigue de toute façon par tome. On ne transmet donc
	// que les TOMES concernés et le total ; le détail vit sur la fiche du tome.
	const colorChapters = allChapters.filter((ch) => ch.series === SERIE_COULEUR);
	const colorVolumeIds = [
		...new Set(colorChapters.map((ch) => ch.volume_id).filter((v): v is number => v != null)),
	];

	const readableChapters = allChapters.map((ch) => ({
		id: ch.id,
		chapter_number: ch.chapter_number,
		title: ch.title,
		series: ch.series,
		cover: ch.cover,
		pages: ch.pages,
		volume_id: ch.volume_id,
	}));

	// L'éditeur des bannières pilote explicitement ce hero. Les couvertures restent
	// dans la grille : elles ne doivent pas masquer une valeur administrée.
	const heroImage = await pageHero("manga");
	const allVolumes = [
		...dbVolumes,
		...dbsVolumes,
		...kanzenbanVolumes,
		...soshuhenVolumes,
		...animeZVolumes,
		...animeMovieVolumes,
		...dbgtAnimeVolumes,
		...dbsAnimeVolumes,
		...dbjpVolumes,
		...araleVolumes,
	];
	const displayedSeries = new Set(allVolumes.map((volume) => volume.series));
	const otherVolumes = catalogVolumes.filter((volume) => !displayedSeries.has(volume.series));
	const completeCatalog = [...allVolumes, ...otherVolumes];
	const readableVolumeIds = new Set(
		allChapters.map((chapter) => chapter.volume_id).filter((id): id is number => id != null)
	);
	for (const volumeId of colorVolumeIds) readableVolumeIds.add(volumeId);
	const readableVolumeCount = completeCatalog.filter((volume) =>
		readableVolumeIds.has(volume.id)
	).length;
	const coveredVolumes = completeCatalog.filter((volume) => Boolean(volume.cover?.trim())).length;

	return (
		<div>
			<PageHero
				eyebrow="Manga"
				title="Lecteur de scan"
				lead={
					readableVolumeCount > 0
						? `${readableVolumeCount.toLocaleString("fr-FR")} tomes à lire et ${allChapters.length.toLocaleString("fr-FR")} chapitres disponibles, parmi ${completeCatalog.length.toLocaleString("fr-FR")} tomes répertoriés.`
						: `${completeCatalog.length.toLocaleString("fr-FR")} tomes répertoriés — les lectures disponibles apparaîtront ici au fur et à mesure de leur publication.`
				}
				image={heroImage}
				imageAlt="Couverture du manga Dragon Ball"
				imagePosition="top"
			/>

			<div className="wiki-container">
				<div className="mb-8 flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Manga" }]} />
					<WikiDrawer />
				</div>
				<ContinueRail kinds={["chapter"]} titleKey="history.resumeReading" />
				<MangaDialogueSearch />
				<section
					className="my-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
					aria-label="Couverture du catalogue manga"
				>
					<Metric
						label="Tomes répertoriés"
						value={completeCatalog.length}
						note={`${coveredVolumes} avec couverture disponible`}
					/>
					<Metric
						label="Tomes lisibles"
						value={readableVolumeCount}
						note="lecture et assets réellement servis"
					/>
					<Metric
						label="Chapitres indexés"
						value={allChapters.length}
						note={`${colorChapters.length} en édition couleur`}
					/>
					<Link
						href="/sources/dragon-ball"
						className="dbz-panel group p-4 transition-colors hover:border-dbz-orange"
					>
						<div className="text-xs font-bold uppercase tracking-widest text-dbz-orange">
							Sources vérifiées
						</div>
						<div className="mt-1 font-display text-lg font-bold text-white group-hover:text-dbz-orange">
							Explorer la provenance →
						</div>
						<div className="mt-1 text-xs text-white/55">
							Éditeurs, archives et corpus attribués du wiki.
						</div>
					</Link>
				</section>

				{mediaWork?.editions && mediaWork.editions.length > 0 && (
					<section
						aria-label="Éditions du manga"
						className="mb-8 rounded-2xl border border-white/10 bg-black/40 p-5 backdrop-blur-md"
					>
						<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
							<div>
								<div className="flex items-center gap-2">
									<span className="text-[10px] font-black uppercase tracking-widest text-orange-400">
										Matrice Ontologique Média
									</span>
									<span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/70">
										Sprint 1 · SHA-256
									</span>
								</div>
								<h2 className="mt-1 font-saiyan text-xl text-white tracking-wide">
									Éditions Référencées · {mediaWork.title}
								</h2>
							</div>
							<Link
								href="/api/wiki/media?series=DB"
								target="_blank"
								className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-white font-mono transition-colors"
							>
								Endpoint REST /api/wiki/media →
							</Link>
						</div>
						<div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
							{mediaWork.editions.map((ed) => (
								<div
									key={ed.id}
									className="rounded-xl border border-white/5 bg-white/[0.02] p-3 hover:border-white/20 transition-colors"
								>
									<div className="flex items-center justify-between gap-2 text-[10px]">
										<span className="font-mono uppercase text-white/50">{ed.edition}</span>
										<span className="font-bold text-orange-400 uppercase">{ed.language}</span>
									</div>
									<div className="mt-1 text-xs font-bold text-white line-clamp-1">{ed.label}</div>
									<div className="mt-2 flex items-center justify-between text-[11px] text-white/60">
										<span>{ed.publisher ?? "Éditeur officiel"}</span>
										<span className="font-mono text-white/80 font-bold">
											{ed.volumes_count > 0 ? `${ed.volumes_count} tomes` : "Indexé"}
										</span>
									</div>
								</div>
							))}
						</div>
					</section>
				)}

				<MangaVolumeGrid
					dbVolumes={dbVolumes}
					dbsVolumes={dbsVolumes}
					kanzenbanVolumes={kanzenbanVolumes}
					soshuhenVolumes={soshuhenVolumes}
					animeZVolumes={animeZVolumes}
					animeMovieVolumes={animeMovieVolumes}
					dbgtAnimeVolumes={dbgtAnimeVolumes}
					dbsAnimeVolumes={dbsAnimeVolumes}
					dbjpVolumes={dbjpVolumes}
					araleVolumes={araleVolumes}
					otherVolumes={otherVolumes}
					readableChapters={readableChapters}
					colorVolumeIds={colorVolumeIds}
					colorChapterCount={colorChapters.length}
				/>

				<MangaInfoSection />
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.volume" />
			</div>
		</div>
	);
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
	return (
		<div className="dbz-panel p-4">
			<div className="text-xs font-bold uppercase tracking-widest text-white/50">{label}</div>
			<div className="mt-1 font-saiyan text-3xl text-dbz-yellow">
				{value.toLocaleString("fr-FR")}
			</div>
			<div className="mt-1 text-xs text-white/55">{note}</div>
		</div>
	);
}
