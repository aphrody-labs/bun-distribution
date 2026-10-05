import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { dbUniverse } from "@/lib/db-universe";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiImg } from "@/components/wiki/WikiImg";
import { DatabookReader } from "@/components/databooks/DatabookReader";
import { FavoriteButton } from "@/components/FavoriteButton";
import { TrackHistory } from "@/components/history/TrackHistory";
import { ShareButton } from "@/components/ShareButton";
import { ogMeta } from "@/lib/og";
import { toMillis } from "@/lib/epoch";
import { DomainBar, ContributeRail } from "@/components/kit";
import { JsonLd } from "@/components/JsonLd";
import { assetUrl } from "@/lib/assets";
import { SITE_URL } from "@/lib/config";

export const revalidate = 3600;

/**
 * URL absolue de la couverture pour les balises meta (OG, JSON-LD) : un chemin
 * brut de la base (`./assets/…`) est servi par l'hôte d'assets, pas par le site.
 */
function absoluteCover(cover: string | null | undefined): string | undefined {
	const url = assetUrl(cover);
	if (!url) return undefined;
	return url.startsWith("http") ? url : `${SITE_URL}${url}`;
}

export async function generateStaticParams() {
	const novels = await dbUniverse.mediaPublications("light_novel");
	return (novels ?? []).map((n) => ({ id: String(n.id) }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const numId = Number(id);
	if (isNaN(numId)) return {};

	const novel = await dbUniverse.mediaPublicationById(numId);
	if (!novel) return {};

	const title = `${novel.title} — Roman Dragon Ball`;
	const description = novel.description
		? novel.description.slice(0, 160)
		: "Novélisation officielle de l'univers Dragon Ball.";

	return {
		title,
		description,
		...ogMeta({
			title,
			description,
			canonical: `/wiki/romans/${novel.id}`,
			type: "article",
			image: absoluteCover(novel.cover),
		}),
	};
}

function formatDate(timestamp: number | null): string {
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

export default async function RomanDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const numId = Number(id);
	if (isNaN(numId)) notFound();

	const novel = await dbUniverse.mediaPublicationById(numId);
	if (!novel || novel.publication_type !== "light_novel") notFound();

	const pages = novel.pages ?? [];

	return (
		<main className="min-h-screen pb-20 text-white">
			<TrackHistory
				kind="databook"
				id={novel.id}
				title={novel.title}
				href={`/wiki/romans/${novel.id}`}
				image={novel.cover}
				caption="Roman Officiel"
			/>

			<JsonLd
				data={{
					"@context": "https://schema.org",
					"@type": "Book",
					name: novel.title,
					alternateName: novel.title_ja ?? undefined,
					author: novel.author ? { "@type": "Person", name: novel.author } : undefined,
					datePublished: novel.published_at ? new Date(toMillis(novel.published_at)).toISOString() : undefined,
					description: novel.description ?? undefined,
					image: absoluteCover(novel.cover),
				} as never}
			/>

			<div className="relative border-b border-white/10 bg-gradient-to-b from-indigo-950/40 via-black/60 to-black/90 pt-8 backdrop-blur-xl">
				<WikiPageShell>
					<DomainBar domain="wiki" />
					<div className="flex flex-wrap items-center justify-between gap-4">
						<Breadcrumbs
							items={[
								{ label: "Romans & Light Novels", href: "/wiki/romans" },
								{ label: novel.title },
							]}
						/>
						<WikiDrawer />
					</div>

					<div className="my-8 flex flex-col gap-8 md:flex-row md:items-start">
						{/* Couverture */}
						<div className="relative mx-auto h-80 w-56 flex-shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/50 shadow-2xl md:mx-0 md:h-96 md:w-64">
							{novel.cover ? (
								<WikiImg
									src={novel.cover}
									alt={novel.title}
									className="h-full w-full object-cover"
								/>
							) : (
								<div className="flex h-full w-full items-center justify-center text-5xl text-white/20">
									📖
								</div>
							)}
							<div className="absolute left-3 top-3 rounded-full border border-indigo-400/30 bg-indigo-950/90 px-3 py-1 text-xs font-bold text-indigo-300 backdrop-blur-md">
								Roman Officiel
							</div>
						</div>

						{/* Métadonnées & Actions */}
						<div className="flex flex-1 flex-col justify-between space-y-6">
							<div>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<span className="text-xs font-semibold tracking-wider text-orange-400 uppercase">
										Publication Dérivée Supervisée
									</span>
									<div className="flex items-center gap-2">
										<FavoriteButton
											kind="databook"
											id={novel.id}
											title={novel.title}
											href={`/wiki/romans/${novel.id}`}
											image={novel.cover}
											caption="Roman"
										/>
										<ShareButton title={novel.title} />
									</div>
								</div>

								<h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white md:text-3xl">
									{novel.title}
								</h1>
								{novel.title_ja && (
									<p className="mt-1 text-sm text-white/50">{novel.title_ja}</p>
								)}
							</div>

							{/* Cartouches d'infos */}
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
								<div className="rounded-xl border border-white/10 bg-white/5 p-3">
									<div className="text-[10px] uppercase text-white/40">Auteur / Novélisation</div>
									<div className="mt-0.5 text-sm font-semibold text-white">
										{novel.author || "Akira Toriyama / Shueisha"}
									</div>
								</div>

								<div className="rounded-xl border border-white/10 bg-white/5 p-3">
									<div className="text-[10px] uppercase text-white/40">Date de Parution</div>
									<div className="mt-0.5 text-sm font-semibold text-white">
										{formatDate(novel.published_at)}
									</div>
								</div>

								<div className="rounded-xl border border-white/10 bg-white/5 p-3 col-span-2 sm:col-span-1">
									<div className="text-[10px] uppercase text-white/40">Pages Numérisées</div>
									<div className="mt-0.5 text-sm font-semibold text-white">
										{pages.length > 0 ? `${pages.length} pages` : "Texte seul"}
									</div>
								</div>
							</div>

							{/* Synopsis complet */}
							{novel.description && (
								<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
									<h2 className="text-xs font-bold uppercase tracking-wider text-white/50">
										Synopsis & Trame Narrative
									</h2>
									<p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/80">
										{novel.description}
									</p>
								</div>
							)}

							<div className="flex flex-wrap items-center gap-3 text-xs text-white/50">
								<span className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5">
									Collection : Jump j-Books / Mirai Bunko
								</span>
								<span className="rounded-md border border-white/10 bg-black/40 px-3 py-1.5">
									Éditeur d&apos;origine : Shueisha
								</span>
							</div>
						</div>
					</div>
				</WikiPageShell>
			</div>

			{/* Lecteur de pages s'il y a des planches numérisées */}
			{pages.length > 0 && (
				<div className="mt-12">
					<WikiPageShell>
						<div className="mb-6 flex items-center justify-between">
							<div>
								<h2 className="text-xl font-bold text-white">
									Feuilleter les pages & illustrations
								</h2>
								<p className="text-xs text-white/50">
									Extraits officiels numérisés et illustrations intérieures
								</p>
							</div>
						</div>

						<DatabookReader
							pages={pages.map((p) => ({
								number: p.number,
								image: p.image,
								text: p.text,
								aDuTexte: Boolean(p.text && p.text.trim()),
								verifiee: p.verifiee === true,
							}))}
							title={novel.title}
							bookId={novel.id}
						/>
					</WikiPageShell>
				</div>
			)}

			<WikiPageShell>
				<ContributeRail quoiKey="kit.contribute.what.databook" />
			</WikiPageShell>
		</main>
	);
}
