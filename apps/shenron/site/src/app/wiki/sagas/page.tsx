import { ContributeRail } from "@/components/kit";
import { SectionUnavailable } from "@/components/wiki/SectionUnavailable";
import { dbUniverse, assetUrl, type Saga } from "@/lib/db-universe";
import Link from "next/link";
import { T } from "@/components/T";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { GatedWrap } from "@/components/GatedLink";
import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { markdownToPlainText } from "@/lib/markdown-plain";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Sagas & arcs Dragon Ball",
	description:
		"Toutes les sagas et arcs narratifs Dragon Ball, Dragon Ball Z, Super, GT et Daima — résumés en français.",
	alternates: { canonical: "/wiki/sagas" },
};

const SERIES_LABELS: Record<string, string> = {
	DB: "Dragon Ball",
	DBZ: "Dragon Ball Z",
	DBGT: "Dragon Ball GT",
	DBS: "Dragon Ball Super (anime)",
	DBS_MANGA: "Dragon Ball Super (manga)",
	DBS_MOVIE: "Films Dragon Ball Super",
	DB_DAIMA: "Dragon Ball Daima",
};

const SERIES_ORDER = ["DB", "DBZ", "DBGT", "DBS", "DBS_MANGA", "DBS_MOVIE", "DB_DAIMA"];

type ArcLite = {
	id: number;
	slug: string;
	name: string;
	name_ja: string | null;
	order_idx: number;
	saga_slug: string | null;
};

export default async function SagasPage() {
	const [data, arcsData] = await Promise.all([dbUniverse.sagas(), dbUniverse.arcs()]);
	if (!data || data.sagas.length === 0) return <SectionUnavailable title={<T k="wiki.sagas.title" />} />;
	const sagas = data.sagas;
	const arcs = (arcsData?.arcs ?? []) as ArcLite[];

	const arcsBySaga = new Map<string, ArcLite[]>();
	for (const a of arcs) {
		if (!a.saga_slug) continue;
		const list = arcsBySaga.get(a.saga_slug) ?? [];
		list.push(a);
		arcsBySaga.set(a.saga_slug, list);
	}

	const bySeries = SERIES_ORDER.map((s) => ({
		key: s,
		label: SERIES_LABELS[s] ?? s,
		sagas: sagas.filter((sg) => sg.series === s).toSorted((a, b) => a.order_idx - b.order_idx),
	})).filter((g) => g.sagas.length > 0);

	const totalArcs = arcs.length;

	return (
		<>
			<PageHero
				eyebrow={<T k="wiki.sagas.eyebrow" />}
				title={<T k="wiki.sagas.title" />}
				lead={<T k="wiki.sagas.lead" values={{ sagas: sagas.length, arcs: totalArcs }} />}
				image={await pageHero("sagas")}
				imageAlt="Bannière officielle Dragon Ball"
			/>
			<div className="wiki-container">
				<div className="flex flex-wrap items-center justify-between gap-4 mb-10">
					<Breadcrumbs items={[{ label: "Sagas & arcs", display: <T k="wiki.sagas.title" /> }]} />
					<WikiDrawer />
				</div>
				{bySeries.map((g) => (
					<section key={g.key} className="mb-16">
						<h2 className="font-display font-bold text-[24px] text-white border-b border-white/10 pb-3 mb-6">
							{g.label}{" "}
							<span className="text-white/50">
								—{" "}
								<T
									k={g.sagas.length > 1 ? "wiki.sagas.countMany" : "wiki.sagas.countOne"}
									values={{ count: g.sagas.length }}
								/>
							</span>
						</h2>
						<div className="space-y-8">
							{g.sagas.map((s: Saga) => {
								const sagaArcs = (arcsBySaga.get(s.slug) ?? []).toSorted(
									(a, b) => a.order_idx - b.order_idx
								);
								return (
									<article
										key={s.id}
										id={`saga-${s.slug}`}
										className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden"
									>
										{/* En-tête saga */}
										<Link
											href={`/wiki/sagas/${s.slug}`}
											className="group flex flex-col sm:flex-row sm:items-stretch gap-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
										>
											{s.image && (
												<div className="relative sm:w-56 md:w-72 shrink-0 aspect-[16/7] sm:aspect-auto overflow-hidden">
													<img
														src={assetUrl(s.image)}
														alt={s.name}
														className="h-full w-full object-cover opacity-75 group-hover:opacity-95 group-hover:scale-105 transition-all duration-700"
														loading="lazy"
													/>
													<div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/40 hidden sm:block" />
												</div>
											)}
											<div className="flex-1 p-5 sm:p-6 min-w-0">
												<p className="font-display font-semibold text-[10px] tracking-[0.16em] uppercase text-dbz-orange mb-1">
													Saga {s.order_idx}
													{sagaArcs.length > 0
														? ` · ${sagaArcs.length} arc${sagaArcs.length > 1 ? "s" : ""}`
														: ""}
												</p>
												<h3 className="font-saiyan text-2xl sm:text-3xl text-white tracking-widest group-hover:text-dbz-orange transition-colors">
													{s.name}
												</h3>
												{s.name_ja && (
													<p className="font-jp text-sm text-dbz-orange/80 mt-1">{s.name_ja}</p>
												)}
												{s.description && (
													<p className="mt-3 text-sm leading-relaxed text-white/60 line-clamp-2">
														{markdownToPlainText(s.description)}
													</p>
												)}
											</div>
										</Link>

										{/* Arcs de la saga (fusion arcs narratifs) */}
										{sagaArcs.length > 0 && (
											<ul className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
												{sagaArcs.map((a) => (
													<li key={a.id}>
														<GatedWrap
															href={`/wiki/arcs/${a.slug}`}
															className="flex items-center gap-4 px-5 sm:px-6 py-3 hover:bg-white/[0.04] transition-colors group"
														>
															<span className="scouter-text text-[10px] text-dbz-orange/80 w-10 shrink-0">
																#{String(a.order_idx).padStart(2, "0")}
															</span>
															<span className="min-w-0 flex-1">
																<span className="font-display font-semibold text-sm text-white group-hover:text-dbz-orange transition-colors">
																	{a.name}
																</span>
																{a.name_ja && (
																	<span className="ml-2 font-jp text-[11px] text-white/50">
																		{a.name_ja}
																	</span>
																)}
															</span>
															<span className="text-dbz-orange/0 group-hover:text-dbz-orange transition-colors text-sm">
																→
															</span>
														</GatedWrap>
													</li>
												))}
											</ul>
										)}
									</article>
								);
							})}
						</div>
					</section>
				))}
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.saga" />
			</div>
		</>
	);
}
