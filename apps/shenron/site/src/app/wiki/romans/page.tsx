import Link from "next/link";
import type { Metadata } from "next";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar, ContributeRail } from "@/components/kit";
import { WikiImg } from "@/components/wiki/WikiImg";
import { ogMeta } from "@/lib/og";
import { toMillis } from "@/lib/epoch";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Romans & Light Novels Dragon Ball",
	description:
		"Les novélisations officielles des films et œuvres dérivées de Dragon Ball : Dragon Ball Super Broly, La Résurrection de 'F', publications Mirai Bunko et Jump j-Books.",
	...ogMeta({
		title: "Romans & Light Novels — Dragon Ball FR",
		description:
			"Explorez les romans et novélisations officielles Dragon Ball : récits enrichis, compléments narratifs et adaptations écrites supervisées.",
		type: "website",
		canonical: "/wiki/romans",
	}),
};

function formatReleaseDate(timestamp: number | null): string {
	if (!timestamp) return "—";
	const ms = toMillis(timestamp);
	try {
		return new Date(ms).toLocaleDateString("fr-FR", {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	} catch {
		return "—";
	}
}

export default async function RomansIndexPage() {
	const novels = (await dbUniverse.mediaPublications("light_novel")) ?? [];
	const heroImage = await pageHero("romans");

	return (
		<div>
			<PageHero
				eyebrow="Archives & Publications Écrites"
				title="Romans & Light Novels Officiels"
				lead="Les novélisations et récits littéraires de l'univers Dragon Ball. Des adaptations de films signées Jump j-Books et Mirai Bunko aux récits dérivés supervisés."
				image={heroImage}
				imageAlt="Livres et manuscrits Dragon Ball"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Romans & Light Novels" }]} />
					<WikiDrawer />
				</div>

				{/* Note doctrinale DBFR */}
				<div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-r from-indigo-950/20 via-black/40 to-transparent p-5 backdrop-blur-md">
					<div className="flex items-center gap-3">
						<span className="text-2xl">📖</span>
						<div>
							<h2 className="text-sm font-bold text-white">Statut Canonique des Écrits Dérivés</h2>
							<p className="text-xs leading-relaxed text-white/70">
								Les romans et light novels (Jump j-Books, Mirai Bunko) sont des novélisations officielles supervisées. Conformément à la doctrine éditoriale de DBFR, leurs développements textuels sont répertoriés comme <strong>extensions officielles</strong>, distinctes du canon absolu des 42 tomes du manga original d'Akira Toriyama.
							</p>
						</div>
					</div>
				</div>

				{/* Grille des Romans */}
				<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-2">
					{novels.map((novel) => {
						const pageCount = novel.pages?.length ?? 0;
						return (
							<article
								key={novel.id}
								className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-5 backdrop-blur-md transition-all duration-300 hover:border-orange-500/40 hover:shadow-xl hover:shadow-orange-950/30 sm:flex-row sm:gap-6"
							>
								{/* Couverture */}
								<div className="relative mx-auto mb-4 h-64 w-44 flex-shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/40 shadow-lg transition-transform duration-300 group-hover:scale-105 sm:mb-0 sm:h-72 sm:w-48">
									{novel.cover ? (
										<WikiImg
											src={novel.cover}
											alt={novel.title}
											className="h-full w-full object-cover"
										/>
									) : (
										<div className="flex h-full w-full items-center justify-center text-4xl text-white/20">
											📖
										</div>
									)}
									<div className="absolute left-2 top-2 rounded-full border border-indigo-400/30 bg-indigo-950/80 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-300 backdrop-blur-sm">
										Light Novel
									</div>
								</div>

								{/* Métadonnées & Synopsis */}
								<div className="flex flex-1 flex-col justify-between">
									<div className="space-y-3">
										<div>
											<h3 className="text-lg font-bold text-white transition-colors group-hover:text-orange-400">
												<Link href={`/wiki/romans/${novel.id}`}>
													{novel.title}
												</Link>
											</h3>
											{novel.title_ja && (
												<p className="mt-0.5 text-xs text-white/40">
													{novel.title_ja}
												</p>
											)}
										</div>

										<div className="flex flex-wrap gap-2 text-xs text-white/60">
											{novel.author && (
												<span className="rounded-md bg-white/5 px-2.5 py-1 text-white/80">
													✍️ {novel.author}
												</span>
											)}
											{novel.published_at && (
												<span className="rounded-md bg-white/5 px-2.5 py-1 text-white/80">
													📅 {formatReleaseDate(novel.published_at)}
												</span>
											)}
											{pageCount > 0 && (
												<span className="rounded-md bg-white/5 px-2.5 py-1 text-white/80">
													📄 {pageCount} pages numérisées
												</span>
											)}
										</div>

										{novel.description && (
											<p className="line-clamp-4 text-xs leading-relaxed text-white/70">
												{novel.description}
											</p>
										)}
									</div>

									<div className="mt-5 pt-3">
										<Link
											href={`/wiki/romans/${novel.id}`}
											className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-orange-950/40 transition-all hover:from-orange-500 hover:to-amber-500"
										>
											Consulter la fiche & extraits →
										</Link>
									</div>
								</div>
							</article>
						);
					})}
				</div>

				<ContributeRail quoiKey="kit.contribute.what.databook" />
			</WikiPageShell>
		</div>
	);
}
