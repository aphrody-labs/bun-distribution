import { EntityParticipation } from "@/components/social/EntityParticipation";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { WikiFicheVide } from "@/components/wiki/WikiFicheVide";
import { WikiSectionsReader } from "@/components/wiki/WikiSectionsReader";
import { WikiSources } from "@/components/wiki/WikiArticle";
import { buildWikiContentPanels } from "@/lib/wiki-panels";
import { getShenronTechnique, getShenronTechniques } from "@/lib/shenron";
import { assetUrl } from "@/lib/db-universe";
import { notFound } from "next/navigation";
import Link from "next/link";
import { GatedWrap } from "@/components/GatedLink";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar } from "@/components/kit";
import type { Metadata } from "next";
import { NOTE_PROVENANCE, estTypeDeJeu, libelleType } from "@/lib/techniques-types";
import { JsonLd } from "@/components/JsonLd";
import type { DefinedTerm, WithContext } from "schema-dts";
import { SITE_URL } from "@/lib/config";
import { ogMeta } from "@/lib/og";
import { capParams } from "@/lib/prerender";
import { WikiImg } from "@/components/wiki/WikiImg";
import { pickBestImage } from "@/lib/image-variants";

export const revalidate = 3600;
export async function generateStaticParams() {
	if (process.env.SHENRON_BUILD_LOW_MEMORY === "1") return [];
	const list = await getShenronTechniques();
	// 825 fiches pour une rubrique tout juste ouverte : on prérend les plus
	// susceptibles d'être visitées, l'ISR fait le reste.
	return capParams(
		list.map((t) => ({ slug: t.slug })),
		300
	);
}
export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const tech = await getShenronTechnique(slug);
	if (!tech) return { title: "Technique Dragon Ball" };
	const description = tech.description ?? `Fiche détaillée de la technique ${tech.name}.`;
	const bestImage = pickBestImage([tech.image, tech.creatorImage]) ?? tech.image ?? tech.creatorImage;
	return {
		title: `${tech.name} — Technique Dragon Ball`,
		description,
		...ogMeta({
			title: `${tech.name} — DBFR`,
			description,
			image: bestImage ? assetUrl(bestImage) : undefined,
			canonical: `/wiki/techniques/${slug}`,
		}),
	};
}
export default async function TechniqueDetailPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const tech = await getShenronTechnique(slug);
	if (!tech) notFound();
	// Toutes les fiches gardent un repère visuel, même lorsque l'archive ne
	// contient pas encore de planche dédiée. Le Kinto-Un local est explicitement
	// décoratif : il ne prétend pas représenter la technique.
	const heroTechImage =
		pickBestImage([tech.image, tech.creatorImage]) ??
		tech.image ??
		tech.creatorImage ??
		"/dbz/kinto-un.svg";
	const contentPanels = await buildWikiContentPanels({
		entityType: "technique",
		entityId: tech.id,
		article: tech.article,
		description: tech.description,
		fallbackHeading: "Description",
	});

	// Ces repères ne sont pas déduits d'un moveset : ils ne sont renseignés que
	// lorsqu'une source éditoriale a pu les établir. Les rendre ici évite que la
	// fiche canonique reste vide lorsque l'entrée n'a pas encore de long article.
	const reperesCanoniques = techniqueCanonicalFacts(tech);
	if (reperesCanoniques) {
		contentPanels.push({
			key: "reperes-canoniques",
			label: "Repères canoniques",
			accent: "blue",
			origine: "db",
			node: reperesCanoniques,
		});
	}

	if (tech.battles && tech.battles.length > 0) {
		contentPanels.push({
			key: "combats-decisifs",
			label: `Combats Décisifs (${tech.battles.length})`,
			accent: "orange",
			origine: "db",
			node: (
				<div className="space-y-4">
					<p className="text-sm text-white/70">
						Affrontements majeurs où <strong className="text-orange-400">{tech.name}</strong> a été employé comme technique décisive :
					</p>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{tech.battles.map((b) => (
							<GatedWrap
								key={b.slug}
								href={`/wiki/combats/${b.slug}`}
								className="block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:border-orange-500/40 hover:bg-orange-500/[0.04] space-y-2"
							>
								<div className="flex items-center justify-between text-xs">
									<span className="font-bold text-orange-400">{b.series}</span>
									{b.winnerName && (
										<span className="text-emerald-400 font-medium">
											🏆 {b.winnerName}
										</span>
									)}
								</div>
								<h4 className="font-bold text-white text-sm">{b.title}</h4>
								{b.climaxSummary && (
									<p className="text-xs text-white/60 line-clamp-2">
										{b.climaxSummary}
									</p>
								)}
							</GatedWrap>
						))}
					</div>
				</div>
			),
		});
	}
	const jsonLdData: WithContext<DefinedTerm> = {
		"@context": "https://schema.org",
		"@type": "DefinedTerm",
		name: tech.name,
		description: tech.description ?? undefined,
		termCode: String(tech.id),
		inDefinedTermSet: `${SITE_URL}/wiki/techniques`,
	};
	return (
		<article
			data-entity={tech.name}
			data-source-id="db_techniques"
			data-lang="fr"
			className="wiki-container"
		>
			<JsonLd data={jsonLdData} />
			<DomainBar domain="wiki" />
			<div className="flex flex-wrap items-center justify-between gap-4 mb-6">
				<Breadcrumbs
					items={[{ label: "Techniques", href: "/wiki/techniques" }, { label: tech.name }]}
				/>
				<WikiDrawer />
			</div>
			<div className="mb-4">
				<WikiEditBar
					sansArticle
					table="db_techniques"
					id={tech.id}
					indexHref="/wiki/techniques"
					label={tech.name}
				/>
			</div>

			{/* Centered Hero Header - Toriyama Style */}
			<header className="flex flex-col items-center justify-center text-center space-y-4 py-6">
				<div className="flex flex-wrap items-center justify-center gap-3">
					<span className="font-scouter text-xs uppercase tracking-widest px-3 py-1 rounded bg-black/60 border border-dbz-blue/40 text-dbz-blue-light shadow-[2px_2px_0px_#000]">
						TECH #{tech.id}
					</span>
					<span className="font-saiyan text-xs uppercase tracking-widest px-3 py-1 rounded bg-dbz-orange/20 border border-dbz-orange/50 text-dbz-orange shadow-[2px_2px_0px_#000]">
						{libelleType(tech.type)}
					</span>
				</div>

				<h1 className="font-saiyan text-4xl sm:text-6xl md:text-7xl font-bold tracking-widest text-white drop-shadow-[0_4px_18px_rgba(255,107,0,0.35)]">
					{tech.name}
				</h1>

				{tech.creatorName && (
					<p className="text-base sm:text-lg text-white/80 font-medium">
						Créateur / utilisateur :{" "}
						<Link
							href={tech.creatorSlug ? `/wiki/personnages/${tech.creatorSlug}` : tech.creatorId ? `/wiki/personnages/${tech.creatorId}` : "#"}
							className="text-dbz-orange font-semibold underline-offset-4 hover:underline hover:text-dbz-yellow transition-colors"
						>
							{tech.creatorName}
						</Link>
					</p>
				)}
			</header>

			{/* 2-Column Fandom-Style Layout */}
			<div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
				{/* Fandom Toriyama Infobox */}
				<aside className="lg:col-span-4 lg:sticky lg:top-24 space-y-6">
					<div className="wiki-infobox">
						<div className="wiki-infobox-header">
							FICHE TECHNIQUE
						</div>
						{heroTechImage && (
							<div className="relative aspect-[3/4] w-full overflow-hidden border-b-2 border-black bg-black">
								<WikiImg
									src={heroTechImage}
									fallback={heroTechImage === tech.image ? tech.creatorImage : tech.image}
									alt={heroTechImage === "/dbz/kinto-un.svg" ? "" : tech.name}
									sizes="(max-width: 1024px) 100vw, 380px"
									className="object-cover object-top"
									placeholderClassName="w-full h-full flex items-center justify-center bg-black"
								/>
							</div>
						)}
						<table className="w-full text-left text-xs sm:text-sm">
							<tbody>
								<tr className="wiki-infobox-row">
									<th className="wiki-infobox-label">Nom</th>
									<td className="wiki-infobox-value font-semibold text-white">{tech.name}</td>
								</tr>
								<tr className="wiki-infobox-row">
									<th className="wiki-infobox-label">Type</th>
									<td className="wiki-infobox-value text-dbz-orange font-medium">{libelleType(tech.type)}</td>
								</tr>
								{tech.creatorName && (
									<tr className="wiki-infobox-row">
										<th className="wiki-infobox-label">Pratiquant</th>
										<td className="wiki-infobox-value">
											<Link
												href={tech.creatorSlug ? `/wiki/personnages/${tech.creatorSlug}` : tech.creatorId ? `/wiki/personnages/${tech.creatorId}` : "#"}
												className="text-dbz-orange hover:underline font-medium"
											>
												{tech.creatorName}
											</Link>
										</td>
									</tr>
								)}
								<tr className="wiki-infobox-row">
									<th className="wiki-infobox-label">Identifiant</th>
									<td className="wiki-infobox-value font-scouter text-white/70">#{tech.id}</td>
								</tr>
							</tbody>
						</table>
					</div>

					{estTypeDeJeu(tech.type) && (
						<div className="wiki-content-card text-xs text-white/60 leading-relaxed space-y-2">
							<p className="font-saiyan text-dbz-yellow tracking-wider uppercase text-[11px]">Note canon / jeu vidéo</p>
							<p>{NOTE_PROVENANCE}</p>
						</div>
					)}
				</aside>

				{/* Main Article Content Card */}
				<main className="lg:col-span-8 space-y-8 min-w-0">
					{contentPanels.length > 1 ? (
						<div className="space-y-8">
							<WikiSectionsReader panels={contentPanels} />
							<WikiSources sources={tech.articleSources} />
						</div>
					) : contentPanels.length === 1 ? (
						<div className="space-y-8">
							<div className="wiki-content-card">
								{contentPanels[0]!.node}
							</div>
							<WikiSources sources={tech.articleSources} />
						</div>
					) : (
						<div className="wiki-content-card">
							<WikiFicheVide
								table="db_techniques"
								rowId={tech.id}
								label={tech.name}
								quoi="qui l'emploie, comment elle fonctionne et dans quelle planche elle apparaît"
							/>
						</div>
					)}
				</main>
			</div>
			<EntityParticipation
				kind="wiki"
				table="db_techniques"
				id={tech.id}
				path={`/wiki/techniques/${slug}`}
				label={tech.name}
			/>
		</article>
	);
}

/**
 * Champs factuels issus des fiches sourcées (databooks/manga), distincts des
 * catégories et des illustrations de jeu. Cette carte reste absente quand il
 * n'y a aucun fait vérifié à montrer : elle ne fabrique pas de canon par défaut.
 */
function techniqueCanonicalFacts(tech: Awaited<ReturnType<typeof getShenronTechnique>>) {
	if (!tech) return null;
	const hasFacts = tech.nameJa || tech.nameRomaji || tech.debutChapter;
	if (!hasFacts) return null;
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{(tech.nameJa || tech.nameRomaji) && (
				<div className="rounded-xl border border-dbz-blue/25 bg-dbz-blue/[0.06] p-4">
					<p className="font-scouter text-[10px] uppercase tracking-[0.16em] text-dbz-blue-light">
						Nom japonais
					</p>
					<p className="mt-1 text-base font-semibold text-white" lang="ja">
						{tech.nameJa ?? "—"}
					</p>
					{tech.nameRomaji && <p className="mt-1 text-sm text-white/60">{tech.nameRomaji}</p>}
				</div>
			)}
			{tech.debutChapter && (
				<Link
					href={`/wiki/manga/${tech.debutChapter.id}`}
					className="group rounded-xl border border-dbz-blue/25 bg-dbz-blue/[0.06] p-4 transition-colors hover:border-dbz-blue/60 hover:bg-dbz-blue/[0.12]"
				>
					<p className="font-scouter text-[10px] uppercase tracking-[0.16em] text-dbz-blue-light">
						Première apparition manga
					</p>
					<p className="mt-1 text-base font-semibold text-white group-hover:text-dbz-blue-light">
						Chapitre {tech.debutChapter.chapterNumber ?? tech.debutChapter.id}
					</p>
					{tech.debutChapter.title && (
						<p className="mt-1 text-sm text-white/60">{tech.debutChapter.title}</p>
					)}
					<p className="mt-2 text-xs text-white/45">Lire le chapitre →</p>
				</Link>
			)}
		</div>
	);
}
