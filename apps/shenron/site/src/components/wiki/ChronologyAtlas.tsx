import Link from "next/link";
import { GatedLink } from "@/components/GatedLink";
import { Film, Horloge, Livre, Tv } from "@/components/icones";
import { assetUrl } from "@/lib/assets";
import { markdownToPlainText } from "@/lib/markdown-plain";
import type { Arc, Databook, Saga } from "@/lib/db-universe";
import { T } from "@/components/T";

type ChronologyArc = Arc & {
	saga_name: string | null;
	saga_slug: string | null;
	saga_series: string | null;
};

export function ChronologyAtlas({
	episodes,
	movies,
	sagas,
	arcs,
	databooks,
}: {
	episodes: number;
	movies: number;
	sagas: Saga[];
	arcs: ChronologyArc[];
	databooks: Databook[];
}) {
	const arcsBySaga = new Map<number, ChronologyArc[]>();
	for (const arc of arcs) {
		const group = arcsBySaga.get(arc.saga_id) ?? [];
		group.push(arc);
		arcsBySaga.set(arc.saga_id, group);
	}
	const featuredBooks = databooks.filter((book) => Boolean(book.cover)).slice(0, 4);

	return (
		<section className="wiki-container py-8 sm:py-10" aria-labelledby="chronology-atlas-title">
			<div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#101116] p-5 shadow-[8px_8px_0_rgba(0,0,0,0.32)] sm:p-8">
				<div aria-hidden className="pointer-events-none absolute inset-0 speed-lines opacity-[0.035]" />
				<div className="relative">
					<p className="font-display text-xs font-bold uppercase tracking-[0.2em] text-dbz-orange">
						<T k="wikiChronology.kicker" />
					</p>
					<div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
						<div className="max-w-2xl">
							<h2 id="chronology-atlas-title" className="font-saiyan text-3xl uppercase tracking-wide text-white sm:text-4xl">
								<T k="wikiChronology.title" />
							</h2>
							<p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-white/65">
								<T k="wikiChronology.lead" />
							</p>
						</div>
						<Link href="#frise" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-dbz-orange px-5 text-sm font-display font-bold text-black transition-colors hover:bg-dbz-orange-dark">
							<T k="wikiChronology.explore" />
						</Link>
					</div>

					<div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
						<Metric icon={<Tv className="h-5 w-5" />} label={<T k="wikiChronology.episodes" />} value={episodes} target="/wiki/episodes" tone="blue" />
						<Metric icon={<Film className="h-5 w-5" />} label={<T k="wikiChronology.films" />} value={movies} target="/wiki/films" tone="orange" />
						<Metric icon={<Horloge className="h-5 w-5" />} label={<T k="wikiChronology.sagasArcs" />} value={arcs.length} suffix={<T k="wikiChronology.sagasCount" values={{ count: sagas.length }} />} target="/wiki/arcs" tone="violet" />
						<Metric icon={<Livre className="h-5 w-5" />} label={<T k="wikiChronology.databooks" />} value={databooks.length} target="/wiki/databooks" tone="gold" />
					</div>
				</div>
			</div>

			<div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
				<section aria-labelledby="chronology-sagas-title">
					<div className="mb-4 flex items-end justify-between gap-4">
						<div>
						<p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45"><T k="wikiChronology.narrativePath" /></p>
							<h2 id="chronology-sagas-title" className="mt-1 font-display text-2xl font-bold text-white"><T k="wikiChronology.sagasTitle" /></h2>
						</div>
						<GatedLink href="/wiki/sagas" className="text-sm font-bold text-dbz-orange hover:text-white"><T k="wikiChronology.allSagas" /></GatedLink>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						{sagas.map((saga) => {
							const sagaArcs = arcsBySaga.get(saga.id) ?? [];
							return (
								<article key={saga.id} className="group relative min-h-48 overflow-hidden rounded-2xl border border-white/10 bg-dbz-card p-5 transition-colors hover:border-dbz-orange/60">
									{saga.image && <div aria-hidden className="absolute inset-0 bg-cover bg-center opacity-20 transition-opacity duration-300 group-hover:opacity-30" style={{ backgroundImage: `url(${assetUrl(saga.image)})` }} />}
									<div className="absolute inset-0 bg-gradient-to-t from-[#101116] via-[#101116]/85 to-[#101116]/35" />
									<div className="relative flex h-full flex-col">
										<div className="flex items-start justify-between gap-3">
											<p className="text-xs font-bold uppercase tracking-[0.14em] text-dbz-orange">{saga.series || "Dragon Ball"}</p>
											<span className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-xs text-white/60">{sagaArcs.length} arc{sagaArcs.length > 1 ? "s" : ""}</span>
										</div>
										<h3 className="mt-3 font-display text-xl font-bold text-white">{saga.name}</h3>
										{saga.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/65">{markdownToPlainText(saga.description)}</p>}
										<div className="mt-auto flex flex-wrap gap-1.5 pt-5">
											{sagaArcs.map((arc) => <GatedLink href={`/wiki/arcs/${arc.slug}`} key={arc.id} className="rounded-md bg-white/[0.08] px-2 py-1 text-xs text-white/75 transition-colors hover:bg-dbz-orange hover:text-black">{arc.name}</GatedLink>)}
										</div>
					<GatedLink href={`/wiki/sagas/${saga.slug}`} className="mt-4 text-sm font-bold text-dbz-orange hover:text-white"><T k="wikiChronology.openSaga" /></GatedLink>
									</div>
								</article>
							);
						})}
					</div>
				</section>

				<aside className="rounded-2xl border border-white/10 bg-dbz-card p-5 sm:p-6" aria-labelledby="chronology-sources-title">
					<p className="text-xs font-bold uppercase tracking-[0.18em] text-dbz-yellow"><T k="wikiChronology.documentation" /></p>
					<h2 id="chronology-sources-title" className="mt-1 font-display text-2xl font-bold text-white"><T k="wikiChronology.referenceBooks" /></h2>
					<p className="mt-2 text-sm leading-relaxed text-white/60">Databooks et guides qui accompagnent les dates, les personnages et la continuité.</p>
					<div className="mt-5 space-y-3">
						{featuredBooks.map((book) => (
							<GatedLink href={`/wiki/databooks/${book.id}`} key={book.id} className="group flex min-h-16 items-center gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-2 transition-colors hover:border-dbz-yellow/50 hover:bg-white/[0.04]">
								{book.cover ? <img src={assetUrl(book.cover)} alt="" className="h-14 w-10 rounded-md object-cover" /> : <span className="grid h-14 w-10 place-items-center rounded-md bg-dbz-yellow/10 text-dbz-yellow"><Livre className="h-4 w-4" /></span>}
								<span className="min-w-0"><span className="line-clamp-2 block text-sm font-semibold text-white group-hover:text-dbz-yellow">{book.title}</span><span className="mt-1 block text-xs text-white/45">{book.category ?? book.kind}</span></span>
							</GatedLink>
						))}
					</div>
					<GatedLink href="/wiki/databooks" className="mt-5 inline-flex min-h-11 items-center text-sm font-bold text-dbz-yellow hover:text-white">Consulter les {databooks.length} ouvrages →</GatedLink>
				</aside>
			</div>
		</section>
	);
}

function Metric({ icon, label, value, suffix, target, tone }: { icon: React.ReactNode; label: React.ReactNode; value: number; suffix?: React.ReactNode; target: string; tone: "blue" | "orange" | "violet" | "gold" }) {
	const tones = { blue: "border-dbz-blue-light/25 text-dbz-blue-light", orange: "border-dbz-orange/25 text-dbz-orange", violet: "border-violet-400/25 text-violet-300", gold: "border-dbz-yellow/25 text-dbz-yellow" };
	return <GatedLink href={target} className={`group rounded-xl border bg-black/20 p-4 transition-transform hover:-translate-y-0.5 ${tones[tone]}`}><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]">{icon}{label}</span><span className="mt-3 block font-saiyan text-3xl text-white">{value.toLocaleString("fr-FR")}</span>{suffix && <span className="mt-1 block text-xs text-white/50">{suffix}</span>}</GatedLink>;
}
