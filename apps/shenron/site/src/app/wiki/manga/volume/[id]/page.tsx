import Link from "next/link";
import { Suspense } from "react";
import { dbUniverse } from "@/lib/db-universe";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { assetUrl } from "@/lib/db-universe";
import { ogMeta } from "@/lib/og";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Book as BookSchema, WithContext } from "schema-dts";
import { JsonLd } from "@/components/JsonLd";
import { VolumeChaptersList } from "@/components/manga/VolumeChaptersList";
import { UnifiedVolumeReader } from "@/components/manga/UnifiedVolumeReader";
import { BancNuages, CadreCase, Etoile, PastilleTome } from "@/components/MotifsCouverture";
import { idDeFiche } from "../../../_id-fiche";
import { AccesApi } from "@/components/manga/AccesApi";
import { SITE_URL } from "@/lib/config";
import { LienExterne } from "@/components/icones";

import { langueDe, LIBELLE_SERIE } from "@/lib/manga-editions";

export const revalidate = 3600;

// Pré-rend les tomes principaux au build → cache CDN (évite l'OOM de Next 16 sur 200+ tomes).
// dynamicParams=true permet aux autres éditions (Kanzenban, Anime Comics, etc.) d'être servies on-demand puis cachées par l'ISR.
export async function generateStaticParams() {
	if (process.env.SHENRON_BUILD_LOW_MEMORY === "1") return [];
	const readable = await dbUniverse.readableMangaChapters();
	const volIds = new Set(
		(readable?.chapters ?? [])
			.filter((c) => c.series === "DB" || c.series === "DBS")
			.map((c) => c.volume_id)
			.filter((v): v is number => v != null)
	);
	return [...volIds].map((id) => ({ id: String(id) }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const numero = idDeFiche(id);
	const volume = numero === null ? null : await dbUniverse.mangaVolume(numero);
	if (!volume) return { title: "Volume Manga" };
	// Description écrite sur ce que la fiche contient RÉELLEMENT (titre du tome,
	// chapitres lisibles, planches, date) plutôt que le seul titre — qui, pour 41
	// tomes sur 42, ne dit que « Dragon Ball Vol. N » et ne distingue rien.
	const chapitres = (volume.chapters ?? []).filter(
		(c) => Array.isArray(c.pages) && c.pages.length > 0
	);
	const planches = chapitres.reduce((n, c) => n + (c.pages?.length ?? 0), 0);
	const annee = volume.published_at ? new Date(volume.published_at * 1000).getFullYear() : null;
	const serieLisible = LIBELLE_SERIE[volume.series] ?? volume.series;
	const description = [
		`Tome ${volume.volume_number} de ${serieLisible}`,
		volume.title && !/^Dragon Ball( Super)? Vol\. \d+$/.test(volume.title)
			? `« ${volume.title} »`
			: null,
		annee ? `paru en ${annee}` : null,
		chapitres.length > 0 ? `${chapitres.length} chapitres et ${planches} planches à lire` : null,
	]
		.filter(Boolean)
		.join(", ")
		.concat(".");
	// Tome sans aucun chapitre lisible = contenu mince (« en cours d'ajout ») :
	// on le dé-indexe (mais reste crawlable) pour ne pas polluer l'index Google.
	return {
		title: `${serieLisible} Tome ${volume.volume_number}${
			volume.title && !/^Dragon Ball( Super)? Vol\. \d+$/.test(volume.title)
				? ` : ${volume.title}`
				: ""
		} — Manga`,
		description,
		...ogMeta({
			title: `${volume.series} — Volume ${volume.volume_number}`,
			description,
			image: volume.cover ? assetUrl(volume.cover) : undefined,
			canonical: `/wiki/manga/volume/${volume.id}`,
		}),
	};
}

export default async function MangaVolumePage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const numero = idDeFiche(id);
	const volume = numero === null ? null : await dbUniverse.mangaVolume(numero);
	if (!volume) notFound();

	const siblingVols = (await dbUniverse.mangaVolumes(volume.series))?.volumes ?? [];
	const curIdx = siblingVols.findIndex((v) => v.id === volume.id);
	const prevVolume = curIdx > 0 ? siblingVols[curIdx - 1] : null;
	const nextVolume = curIdx >= 0 && curIdx < siblingVols.length - 1 ? siblingVols[curIdx + 1] : null;

	// Balisage `Book` du tome. Les épisodes, films, jeux, personnages, lieux et
	// techniques étaient déjà décrits en JSON-LD ; le manga — la moitié du
	// catalogue — ne l'était pas du tout, donc invisible comme entité pour les
	// moteurs. `isbn` et `datePublished` viennent de la base quand ils y sont.
	const titre = volume.title?.trim() || `Tome ${volume.volume_number}`;
	const chapitresLisibles = (volume.chapters ?? []).filter(
		(c) => Array.isArray(c.pages) && c.pages.length > 0
	);
	const planchesTotal = chapitresLisibles.reduce((n, c) => n + (c.pages?.length ?? 0), 0);
	const jsonLd: WithContext<BookSchema> = {
		"@context": "https://schema.org",
		"@type": "Book",
		name: titre,
		alternateName: volume.title_ja ?? undefined,
		bookFormat: "https://schema.org/Paperback",
		inLanguage: langueDe(volume),
		image: volume.cover ? assetUrl(volume.cover) : undefined,
		isbn: volume.isbn ?? undefined,
		datePublished: volume.published_at
			? new Date(volume.published_at * 1000).toISOString().split("T")[0]
			: undefined,
		numberOfPages: undefined,
		position: volume.volume_number || undefined,
		isPartOf: {
			"@type": "BookSeries",
			name: LIBELLE_SERIE[volume.series] ?? volume.series,
		},
		author: { "@type": "Person", name: "Akira Toriyama" },
		publisher: { "@type": "Organization", name: "Shueisha" },
		url: `${SITE_URL}/wiki/manga/volume/${volume.id}`,
		// Les chapitres LISIBLES sont déclarés comme parties du tome : c'est ce qui
		// relie, pour un moteur comme pour un agent, la fiche du tome aux pages de
		// lecture — jusqu'ici deux ensembles d'URL sans lien sémantique entre eux.
		hasPart: chapitresLisibles.map((c) => ({
			"@type": "ComicStory" as const,
			name: c.title?.trim() || `Chapitre ${c.chapter_number}`,
			position: c.chapter_number,
			url: `${SITE_URL}/wiki/manga/${c.id}`,
			...(c.pages?.length ? { pageStart: 1, pageEnd: c.pages.length } : {}),
		})),
	};

	return (
		<>
			<JsonLd data={jsonLd} />
			<div className="wiki-container">
				<div className="mb-12 flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs
						items={[
							{ label: "Manga", href: "/wiki/manga" },
							{ label: `Tome ${volume.volume_number}` },
						]}
					/>
					<div className="flex items-center gap-2">
						{prevVolume && (
							<Link
								href={`/wiki/manga/volume/${prevVolume.id}`}
								className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white/80 transition-colors hover:border-orange-500/40 hover:bg-orange-950/20 hover:text-white"
								title={`Tome ${prevVolume.volume_number}`}
							>
								← Tome {prevVolume.volume_number}
							</Link>
						)}
						{nextVolume && (
							<Link
								href={`/wiki/manga/volume/${nextVolume.id}`}
								className="inline-flex items-center gap-1 rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold text-orange-300 transition-colors hover:border-orange-400 hover:bg-orange-500/20 hover:text-white"
								title={`Tome ${nextVolume.volume_number}`}
							>
								Tome {nextVolume.volume_number} →
							</Link>
						)}
						<WikiDrawer />
					</div>
				</div>

				<div className="flex flex-col md:flex-row gap-12 lg:gap-20 min-w-0 max-w-full">
					<div className="w-full md:w-1/3 lg:w-1/4 shrink-0">
						{/* Cadre de case mesuré sur le support : encre, liseré jaune, encre,
						    coins vifs — et la pastille de numéro à sa place de tankōbon. */}
						<CadreCase largeur={300} className="group bg-dbz-card">
							<div className="relative overflow-hidden">
								<div className="absolute inset-0 halftone z-20 opacity-20" />
								{volume.cover ? (
									<img
										src={assetUrl(volume.cover)}
										alt={`Volume ${volume.volume_number}`}
										className="relative z-10 h-auto w-full object-contain"
									/>
								) : (
									<div className="flex aspect-[2/3] items-center justify-center bg-zinc-900">
										<span className="font-saiyan text-6xl text-zinc-700">
											{volume.volume_number}
										</span>
									</div>
								)}
							</div>
							<PastilleTome
								numero={volume.volume_number}
								taille={56}
								className="absolute right-3 bottom-3 z-30"
							/>
						</CadreCase>

						{/* Métadonnées du Tome */}
						<div className="mt-8 space-y-4 border-t border-white/10 pt-6 font-display text-xs">
							<div className="flex items-center justify-between gap-3">
								<span className="shrink-0 text-white/50">Série&nbsp;:</span>
								<span className="text-right font-bold text-white">
									{LIBELLE_SERIE[volume.series] ?? volume.series}
								</span>
							</div>
							{volume.title_ja && (
								<div className="flex items-center justify-between gap-3">
									<span className="shrink-0 text-white/50">Titre Original&nbsp;:</span>
									{/* `font-jp` et non `font-mono` : JetBrains Mono est chargée en
									    sous-ensemble LATIN, elle n'a aucun glyphe japonais et rendait
									    « ドラゴンボール超 1 » en huit tofus sur la page de tome. */}
									<span className="text-right font-jp font-bold text-white">{volume.title_ja}</span>
								</div>
							)}
							{volume.published_at && (
								<div className="flex items-center justify-between gap-3">
									<span className="shrink-0 text-white/50">Publication&nbsp;:</span>
									<span className="text-right font-bold text-white capitalize">
										{new Date(volume.published_at * 1000).toLocaleDateString("fr-FR", {
											year: "numeric",
											month: "long",
										})}
									</span>
								</div>
							)}
							{volume.isbn && (
								<div className="flex items-center justify-between gap-3">
									<span className="shrink-0 text-white/50">ISBN&nbsp;:</span>
									<span className="text-right font-mono font-bold text-white break-all">{volume.isbn}</span>
								</div>
							)}
							{volume.source_url && (
								<div className="flex items-center justify-between gap-3">
									<span className="shrink-0 text-white/50">Source&nbsp;:</span>
									<a
										href={volume.source_url}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex min-w-0 items-center gap-1 text-right font-bold text-dbz-orange hover:text-white"
									>
										Catalogue Shueisha <LienExterne className="h-3 w-3 shrink-0" aria-hidden="true" />
									</a>
								</div>
							)}
							{volume.series === "DB" && (
								<div className="pt-3 border-t border-white/5 space-y-1.5">
									<span className="text-white/50 block text-[11px]">Éditions répertoriées :</span>
									<div className="flex flex-wrap gap-1.5">
										<span className="inline-flex items-center gap-1 rounded bg-orange-950/40 border border-orange-500/30 px-2 py-0.5 text-[10px] font-bold text-orange-300">
											Glénat FR (42)
										</span>
										<span className="inline-flex items-center gap-1 rounded bg-fuchsia-950/40 border border-fuchsia-500/30 px-2 py-0.5 text-[10px] font-bold text-fuchsia-300">
											Full Color (42)
										</span>
										<span className="inline-flex items-center gap-1 rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-white/60">
											Tankōbon JA
										</span>
										<span className="inline-flex items-center gap-1 rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-white/60">
											Kanzenban
										</span>
									</div>
								</div>
							)}
						</div>
					</div>

					<div className="flex-1 min-w-0 max-w-full space-y-10">
						<header>
							{/* L'étoile ouvre la ligne de titre secondaire, comme sur la couverture. */}
							<p className="font-display mb-4 inline-flex items-center gap-2 text-[12px] font-semibold tracking-[0.3em] text-dbz-orange uppercase">
								<Etoile taille={11} className="text-[var(--color-logo-rouge)]" />
								{LIBELLE_SERIE[volume.series] ?? volume.series} · Volume {volume.volume_number}
							</p>
							<h1 className="font-saiyan text-5xl lg:text-7xl text-white mb-6 tracking-widest leading-tight">
								{volume.title || `VOLUME ${volume.volume_number}`}
							</h1>
							<div className="h-1 w-24 bg-dbz-orange" />
						</header>

						{/* Lecteur Manga Unifié (Original N&B / Full Color) */}
						{/* `UnifiedVolumeReader` lit `useSearchParams()` (chapitre et édition
						    demandés). Sans frontière `Suspense` à lui, Next abandonnait le rendu
						    serveur de TOUTE la route (`BAILOUT_TO_CLIENT_SIDE_RENDERING`) : le HTML
						    servi ne contenait que le squelette de chargement — ni `<h1>`, ni
						    sommaire des chapitres. La frontière limite le rendu client au lecteur. */}
						{planchesTotal > 0 && (
							<section className="space-y-4">
								<Suspense
									fallback={
										<div className="aspect-[2/3] w-full max-w-md animate-pulse rounded-lg bg-white/[0.04]" />
									}
								>
									<UnifiedVolumeReader volume={volume} />
								</Suspense>
							</section>
						)}

						<section className="space-y-6">
							{/* Banc de volutes du fond de case, en frise de séparation. */}
							<BancNuages hauteur={64} opacite={0.85} className="rounded-sm" retourne />
							<div className="flex items-center gap-6">
								<h2 className="font-saiyan text-3xl text-white uppercase tracking-widest">
									Sommaire des Chapitres
								</h2>
								<div className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
							</div>

							<VolumeChaptersList chapters={volume.chapters} />
						</section>

						<AccesApi
							chemin={`/api/manga/volume/${volume.id}`}
							legende={
								planchesTotal > 0
									? `${chapitresLisibles.length} chapitres, ${planchesTotal} planches`
									: "métadonnées du tome"
							}
							variantes={
								chapitresLisibles[0]
									? [
											{
												label: "Chapitre",
												chemin: `/api/manga/chapter/${chapitresLisibles[0].id}`,
											},
											{
												label: "Planche 1",
												chemin: `/api/manga/chapter/${chapitresLisibles[0].id}/planche/1`,
											},
										]
									: []
							}
						/>

						{/* Transition fluide de fin de tome */}
						{(prevVolume || nextVolume) && (
							<nav aria-label="Navigation entre tomes" className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-t border-white/10 pt-6">
								{prevVolume ? (
									<Link
										href={`/wiki/manga/volume/${prevVolume.id}`}
										className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 transition-all hover:border-white/30 hover:bg-white/[0.04]"
									>
										<span className="text-xl transition-transform group-hover:-translate-x-1">←</span>
										<div>
											<div className="text-[10px] text-white/40 uppercase tracking-wider font-bold">Tome précédent</div>
											<div className="text-sm font-bold text-white">Tome {prevVolume.volume_number}</div>
										</div>
									</Link>
								) : <div />}

								{nextVolume && (
									<Link
										href={`/wiki/manga/volume/${nextVolume.id}`}
										className="group flex items-center justify-end gap-3 rounded-2xl border border-orange-500/30 bg-gradient-to-r from-orange-950/20 to-black/60 p-4 transition-all hover:border-orange-400 hover:bg-orange-950/30 text-right"
									>
										<div>
											<div className="text-[10px] text-orange-400/70 uppercase tracking-wider font-bold">Tome suivant</div>
											<div className="text-sm font-bold text-white">Tome {nextVolume.volume_number}</div>
										</div>
										<span className="text-xl text-orange-400 transition-transform group-hover:translate-x-1">→</span>
									</Link>
								)}
							</nav>
						)}
					</div>
				</div>
			</div>
		</>
	);
}
