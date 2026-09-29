// SPDX-License-Identifier: Apache-2.0
import { ContributeRail, DomainBar } from "@/components/kit";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { GatedLink } from "@/components/GatedLink";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { WikiCategoryNav } from "@/components/wiki/WikiCategoryNav";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Arcs narratifs Dragon Ball",
	description:
		"Tous les arcs narratifs de Dragon Ball, regroupés par saga : de la quête des Dragon Balls aux combats contre Freezer, Cell, Majin Boo et au-delà.",
	alternates: { canonical: "/wiki/arcs" },
};

export default async function ArcsPage() {
	const data = await dbUniverse.arcs();
	const arcs = data?.arcs ?? [];
	const heroImage = await pageHero("arcs");

	// Regroupe par saga en conservant l'ordre (les arcs arrivent déjà triés
	// saga.orderIdx → arc.orderIdx).
	const sagas: {
		slug: string | null;
		name: string;
		series: string | null;
		arcs: typeof arcs;
	}[] = [];
	for (const a of arcs) {
		let g = sagas[sagas.length - 1];
		if (!g || g.slug !== a.saga_slug) {
			g = {
				slug: a.saga_slug,
				name: a.saga_name ?? "Autres arcs",
				series: a.saga_series,
				arcs: [],
			};
			sagas.push(g);
		}
		g.arcs.push(a);
	}

	return (
		<div className="reveal-up min-h-screen">
			<PageHero
				eyebrow="Encyclopédie"
				title="Arcs Narratifs"
				lead={`${arcs.length} arcs à travers ${sagas.length} sagas — la trame complète de Dragon Ball, arc par arc.`}
				image={heroImage}
				imageAlt="Arcs narratifs Dragon Ball"
			/>

			<div className="wiki-container space-y-8">
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Arcs narratifs" }]} />
					<WikiDrawer />
				</div>
				<WikiCategoryNav active="arcs" className="mb-12" />

				{sagas.length === 0 ? (
					<p className="py-20 text-center text-white/50 font-sans">Aucun arc répertorié.</p>
				) : (
					<div className="space-y-14">
						{sagas.map((s) => (
							<section key={s.slug ?? s.name}>
								<div className="flex items-center gap-4 mb-6">
									{s.slug ? (
										<GatedLink
											href={`/wiki/sagas/${s.slug}`}
											className="font-saiyan text-2xl text-dbz-orange uppercase tracking-widest hover:text-white transition-colors"
										>
											{s.name}
										</GatedLink>
									) : (
										<h2 className="font-saiyan text-2xl text-dbz-orange uppercase tracking-widest">
											{s.name}
										</h2>
									)}
									{s.series && (
										<span className="scouter-text text-[10px] text-white/50 border border-white/15 rounded px-1.5 py-0.5">
											{s.series}
										</span>
									)}
									<div className="h-px flex-1 bg-gradient-to-r from-white/15 to-transparent" />
								</div>

								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
									{s.arcs.map((a, idx) => (
										<Link
											key={a.id}
											href={`/wiki/arcs/${a.slug}`}
											className="group relative overflow-hidden rounded-xl border border-white/[0.1] bg-zinc-950/40 p-5 transition-all duration-300 hover:scale-[1.02] hover:border-dbz-orange/60 hover:shadow-[0_0_24px_rgba(255,178,0,0.08)] reveal-up flex flex-col gap-2"
											style={{ animationDelay: `${0.04 + idx * 0.03}s` }}
										>
											{heroImage && <div className="pointer-events-none absolute inset-0 opacity-15"><img src={heroImage} alt="" loading="lazy" className="h-full w-full object-cover" /></div>}
											<div className="flex items-start justify-between gap-3">
												<h3 className="font-display font-bold text-white text-base leading-tight group-hover:text-dbz-orange transition-colors">
													{a.name}
												</h3>
												<span className="text-dbz-orange opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all shrink-0">
													→
												</span>
											</div>
											{a.name_ja && (
												<p className="font-jp text-[11px] text-white/50 tracking-wider">
													{a.name_ja}
												</p>
											)}
											{a.description && (
												<p className="text-gray-400 text-[13px] font-sans leading-relaxed line-clamp-3">
													{a.description}
												</p>
											)}
										</Link>
									))}
								</div>
							</section>
						))}
					</div>
				)}
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.arc" />
			</div>
		</div>
	);
}
