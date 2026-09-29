import { EntityParticipation } from "@/components/social/EntityParticipation";
import { Suspense } from "react";
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
import { WikiArticle } from "@/components/wiki/WikiArticle";
import { WikiEntitySections } from "@/components/wiki/WikiEntitySections";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import WikiRagArchives from "@/components/wiki/WikiRagArchives";
import { AggregateRatingBanner } from "@/components/ratings/EntityRating";
import { dbUniverse, assetUrl } from "@/lib/db-universe";
import { getAggregateSummary, getRatingSummaries } from "@/lib/ratings";
import { getShenronSagaCharacters } from "@/lib/shenron";
import { WikiImg } from "@/components/wiki/WikiImg";
import { ogMeta } from "@/lib/og";
import { markdownToPlainText } from "@/lib/markdown-plain";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GatedLink, GatedWrap } from "@/components/GatedLink";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import type { CreativeWork, WithContext } from "schema-dts";

export const revalidate = 3600;

export async function generateStaticParams() {
	if (process.env.SHENRON_BUILD_LOW_MEMORY === "1") return [];
	const r = await dbUniverse.sagas();
	return (r?.sagas ?? []).map((s) => ({ slug: s.slug }));
}

const SERIES_LABELS: Record<string, string> = {
	DB: "Dragon Ball",
	DBZ: "Dragon Ball Z",
	DBGT: "Dragon Ball GT",
	DBS: "Dragon Ball Super",
	DB_DAIMA: "Dragon Ball Daima",
};

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const data = await dbUniverse.saga(slug);
	if (!data) return { title: "Saga" };
	// La description est du markdown (`**tomes 20 à 24**`, `*Dragon Ball Z*`) : la page la
	// rend avec `WikiMarkdown`, la balise meta et le JSON-LD n'en veulent que le texte.
	const description =
		markdownToPlainText(data.description, { max: 160 }) ||
		`Saga ${data.name} de ${SERIES_LABELS[data.series] ?? data.series}.`;
	return {
		title: `${data.name} — Saga Dragon Ball`,
		description,
		...ogMeta({
			title: `${data.name} — DBFR`,
			description,
			image: data.image ? assetUrl(data.image) : undefined,
			canonical: `/wiki/sagas/${slug}`,
		}),
	};
}

export default async function SagaPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const data = await dbUniverse.saga(slug);
	if (!data) notFound();
	const saga = data;
	const arcs = data.arcs ?? [];
	const seriesLabel = SERIES_LABELS[saga.series] ?? saga.series;
	const arcIds = arcs.map((a) => String(a.id));
	// `personnages` : lecture inverse de bot.db_character_variants — qui a été
	// relevé dans cette saga. Lancé avec les notes, jamais après : les trois
	// requêtes sont indépendantes de la saga déjà chargée.
	const [sagaAvg, arcRatings, personnages] = await Promise.all([
		getAggregateSummary("arc", arcIds),
		getRatingSummaries("arc", arcIds),
		getShenronSagaCharacters(saga.id),
	]);

	const jsonLdData: WithContext<CreativeWork> = {
		"@context": "https://schema.org",
		"@type": "CreativeWork",
		name: saga.name,
		image: saga.image ? assetUrl(saga.image) : undefined,
		description: markdownToPlainText(saga.description, { max: 300 }) || undefined,
		isPartOf: {
			"@type": "CreativeWorkSeries",
			name: seriesLabel,
		},
	};

	return (
		<div className="wiki-container">
			<JsonLd data={jsonLdData} />
			<Breadcrumbs
				className="mb-6"
				items={[{ label: "Sagas & arcs", href: "/wiki/sagas" }, { label: saga.name }]}
			/>

			<div className="mb-4">
				<WikiEditBar table="db_sagas" id={saga.id} indexHref="/wiki/sagas" label={saga.name} />
			</div>

			{/* Centered Hero Header - Toriyama Style */}
			<header className="flex flex-col items-center justify-center text-center space-y-4 py-8">
				<div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-dbz-orange/15 border-2 border-black shadow-[2px_2px_0px_#000]">
					<span className="w-2 h-2 rounded-full bg-dbz-orange animate-pulse" />
					<span className="font-saiyan text-xs tracking-[0.2em] uppercase text-dbz-orange">
						{seriesLabel} · SAGA {saga.order_idx}
					</span>
				</div>

				<h1 className="font-saiyan text-5xl sm:text-7xl md:text-8xl font-bold tracking-wider text-white drop-shadow-[0_4px_20px_rgba(255,107,0,0.35)]">
					{saga.name}
				</h1>

				{saga.name_ja && (
					<p className="font-jp text-2xl sm:text-3xl font-bold text-dbz-orange/90 tracking-wide drop-shadow">
						{saga.name_ja}
					</p>
				)}

				{saga.description && (
					<div className="wiki-content-card max-w-4xl text-left mt-6">
						<div className="prose prose-invert max-w-none wiki-content">
							<WikiMarkdown body={saga.description} />
						</div>
					</div>
				)}

				<div className="mt-6 w-full max-w-xl">
					<AggregateRatingBanner
						average={sagaAvg.average}
						count={sagaAvg.count}
						subtitle={
							sagaAvg.count > 0
								? `${sagaAvg.count} note${sagaAvg.count > 1 ? "s" : ""} cumulées sur les arcs`
								: "Note les arcs pour faire remonter la moyenne de la saga"
						}
					/>
				</div>
			</header>

			{saga.article && (
				<div className="wiki-content-card mb-16">
					<WikiArticle article={saga.article} sources={saga.article_sources} heading="Article" />
				</div>
			)}

			<div className="mb-20">
				<WikiEntitySections entityType="saga" entityId={saga.id} />
			</div>

			{arcs.length > 0 && (
				<section className="mb-20">
					<div className="flex items-center gap-6 mb-10">
						<h2 className="font-saiyan text-3xl text-white uppercase tracking-widest">
							Arcs Narratifs ({arcs.length})
						</h2>
						<div className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
					</div>

					<div className="grid gap-4">
						{arcs.map((a, idx) => (
							<GatedWrap
								key={a.id}
								href={`/wiki/arcs/${a.slug}`}
								className="dbz-panel p-6 hover:bg-white/5 transition-all group reveal-up"
								style={{ animationDelay: `${0.1 + idx * 0.05}s` }}
							>
								<div className="flex justify-between items-start">
									<div>
										<p className="scouter-text text-xs text-dbz-orange mb-2">
											ARC_SEQUENCE: {a.order_idx}
										</p>
										<h3 className="font-display font-bold text-xl text-white group-hover:text-dbz-orange transition-colors">
											{a.name}
										</h3>
										{a.name_ja && <p className="font-jp text-sm text-white/50 mt-1">{a.name_ja}</p>}
										{(() => {
											const r = arcRatings.get(String(a.id));
											if (!r || r.count <= 0) return null;
											return (
												<p className="mt-2 text-[12px] font-display font-semibold text-dbz-orange">
													★ {r.average.toFixed(1)}{" "}
													<span className="text-white/50 font-normal">({r.count})</span>
												</p>
											);
										})()}
									</div>
									<span className="text-dbz-orange opacity-0 group-hover:opacity-100 transition-opacity text-2xl">
										→
									</span>
								</div>
							</GatedWrap>
						))}
					</div>
				</section>
			)}

			{personnages.length > 0 && (
				<section className="mb-20">
					<div className="flex items-center gap-6 mb-6">
						<h2 className="font-saiyan text-3xl text-white uppercase tracking-widest">
							Personnages ({personnages.length})
						</h2>
						<div className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
					</div>
					{/* Ce que la liste dit exactement — le relevé porte sur le TEXTE du
					    manga : un personnage mort peut y être nommé pendant des tomes.
					    L'annoncer vaut mieux que de laisser lire « qui combat ici ». */}
					<p className="mb-8 max-w-3xl text-sm text-white/50">
						Personnages dont le nom est relevé dans les planches du manga et les résumés
						d&apos;épisode couvrant cette saga, du plus cité au moins cité. Une citation n&apos;est
						pas une apparition.
					</p>
					<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
						{personnages.map((p) => (
							<GatedWrap
								key={p.characterId}
								href={`/wiki/personnages/${p.slug || p.characterId}`}
								className="dbz-panel group flex flex-col items-center p-3 transition-transform duration-300 hover:scale-105"
							>
								<div className="relative mb-3 aspect-square w-full overflow-hidden rounded-lg border border-dbz-border bg-dbz-bg p-1">
									<div aria-hidden className="halftone absolute inset-0 opacity-10" />
									<WikiImg
										src={p.image}
										alt={p.name}
										sizes="(min-width: 1280px) 160px, (min-width: 768px) 22vw, 45vw"
										loading="lazy"
										className="relative z-10 h-full w-full object-contain transition-transform duration-500 group-hover:scale-110"
										placeholderClassName="relative z-10 flex h-full w-full items-center justify-center rounded"
									/>
								</div>
								<p className="text-center text-xs font-bold uppercase tracking-wider text-white transition-colors group-hover:text-dbz-orange">
									{p.name}
								</p>
								{(p.planches || p.synopsis) && (
									<p className="mt-1 text-[10px] tabular-nums uppercase tracking-widest text-white/40">
										{[
											p.planches ? `${p.planches} planches` : null,
											p.synopsis ? `${p.synopsis} résumés` : null,
										]
											.filter(Boolean)
											.join(" · ")}
									</p>
								)}
							</GatedWrap>
						))}
					</div>
				</section>
			)}

			{/*
			  Épisodes de la saga — MESURÉS sur ses bornes, pas lus dans une colonne.

			  `db_episodes.arc_id` est nul sur 790 des 826 épisodes, et rien ne relie
			  un épisode à une saga en base. Les bornes `episode_start`/`episode_end`,
			  elles, existent sur 25 sagas et couvrent 659 épisodes. Les 8 sagas sans
			  borne (films, OAV, arcs manga-only de Super) n'affichent donc rien —
			  c'est voulu : une liste approximative se lirait comme un relevé.
			*/}
			{saga.episodes.length > 0 && (
				<section className="mb-16">
					<div className="mb-8 flex items-center gap-6">
						<h2 className="font-saiyan text-3xl text-white uppercase tracking-widest">
							Épisodes ({saga.episodes.length})
						</h2>
						<div className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
					</div>
					<p className="mb-6 max-w-2xl text-[13px] leading-relaxed text-white/45">
						Relevé sur les bornes de la saga ({seriesLabel} #{saga.episodes[0]!.number_in_series}
						{" à "}
						{saga.episodes.at(-1)!.number_in_series}). L&apos;anime n&apos;est pas le manga :
						certains de ces épisodes sont du remplissage.
					</p>
					<div className="flex flex-wrap gap-2">
						{saga.episodes.map((ep) => (
							<Link
								key={ep.id}
								href={`/wiki/episodes/${ep.id}`}
								title={ep.title}
								className="inline-flex min-h-11 items-center rounded-full border border-white/[0.12] bg-white/[0.04] px-4 py-2.5 text-[13px] font-display font-semibold text-white/70 transition-colors hover:border-dbz-orange/60 hover:text-white"
							>
								#{ep.number_in_series}
							</Link>
						))}
					</div>
				</section>
			)}

			<section className="dbz-panel p-10 border-t-4 border-t-dbz-orange bg-dbz-card/30">
				<h2 className="font-saiyan text-3xl text-white mb-6 tracking-widest">EXPLORATION</h2>
				<div className="flex flex-wrap gap-4">
					<Link href={`/wiki/episodes/serie/${saga.series}`} className="dbz-button">
						VOIR LES ÉPISODES
					</Link>
					<GatedLink href="/wiki/personnages" className="dbz-button-ghost">
						PERSONNAGES
					</GatedLink>
				</div>
			</section>

			{/* Passages liés du RAG (sourcés). Îlot Suspense : la requête RAG stream
			    indépendamment et ne bloque jamais le rendu de la saga. */}
			<Suspense fallback={null}>
				<WikiRagArchives query={saga.name} limit={4} />
			</Suspense>
			<EntityParticipation
				kind="wiki"
				table="db_sagas"
				id={saga.id}
				path={`/wiki/sagas/${slug}`}
				label={saga.name}
			/>
		</div>
	);
}
