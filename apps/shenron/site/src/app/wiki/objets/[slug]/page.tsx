import { notFound } from "next/navigation";
import Link from "next/link";
import { GatedLink, GatedWrap } from "@/components/GatedLink";
import { PageHero } from "@/components/PageHero";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DomainBar } from "@/components/kit";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { dbUniverse } from "@/lib/db-universe";
import { ogMeta } from "@/lib/og";
import { resolveCharacterSlugByName } from "@/lib/wiki-slugs";
import type { Metadata } from "next";

export const revalidate = 3600;

interface ItemDetailPageProps {
	params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
	if (process.env.SHENRON_BUILD_LOW_MEMORY === "1") return [];
	const items = await dbUniverse.items();
	return (items ?? []).map((it) => ({ slug: it.slug }));
}

export async function generateMetadata({ params }: ItemDetailPageProps): Promise<Metadata> {
	const { slug } = await params;
	const item = await dbUniverse.itemBySlug(slug);
	if (!item) return {};

	return {
		title: `${item.name} — Objet Dragon Ball`,
		description: item.description,
		...ogMeta({
			title: `${item.name} — Fiche Objet`,
			description: item.description,
			canonical: `/wiki/objets/${slug}`,
			type: "article",
		}),
	};
}

export default async function ItemDetailPage({ params }: ItemDetailPageProps) {
	const { slug } = await params;
	const [item, allItems] = await Promise.all([
		dbUniverse.itemBySlug(slug),
		dbUniverse.items(),
	]);
	if (!item) notFound();

	const sameCategory = (allItems ?? []).filter(
		(it) => it.category === item.category && it.slug !== item.slug
	).slice(0, 4);

	return (
		<div>
			<PageHero
				eyebrow={`Objet • ${item.category}`}
				title={item.name}
				lead={item.description}
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<Breadcrumbs
					items={[
						{ label: "Objets & Technologies", href: "/wiki/objets" },
						{ label: item.name },
					]}
				/>
				<WikiEditBar table="db_items" id={item.id} indexHref="/wiki/objets" label={item.name} />

				{/* Encart Dragon Balls si pertinent */}
				{(item.slug.includes("dragon") || item.slug === "four-star-dragon-ball-memento") && (
					<div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
						<div className="space-y-1">
							<span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
								🐉 Dragon Balls & Vœux Divins
							</span>
							<p className="text-sm text-white/90">
								Cet artéfact est directement lié à la quête sacrée des Dragon Balls et à l'invocation des dragons divins.
							</p>
						</div>
						<GatedWrap
							href="/wiki/dragons"
							className="rounded-lg bg-amber-500/20 px-4 py-2 text-xs font-bold text-amber-300 hover:bg-amber-500/30 transition-colors shrink-0"
						>
							Consulter les Dragons & Vœux →
						</GatedWrap>
					</div>
				)}

				<div className="grid gap-6 md:grid-cols-3">
					<div className="space-y-6 md:col-span-2">
						<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
							<h2 className="text-sm font-semibold uppercase tracking-wider text-orange-400 mb-3">
								Description & Fonctionnement
							</h2>
							<p className="text-sm leading-relaxed text-white/80 whitespace-pre-line">
								{item.description}
							</p>
						</div>

						{item.article && (
							<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
								<h2 className="text-sm font-semibold uppercase tracking-wider text-orange-400 mb-3">
									Histoire & Contexte Canonique
								</h2>
								<p className="text-sm leading-relaxed text-white/80">
									{item.article}
								</p>
							</div>
						)}

						{/* Autres objets de la même catégorie */}
						{sameCategory.length > 0 && (
							<div className="space-y-4 pt-4 border-t border-white/10">
								<h2 className="text-base font-bold uppercase tracking-wider text-orange-400">
									Dans la même catégorie ({item.category})
								</h2>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									{sameCategory.map((peer) => (
										<Link
											key={peer.slug}
											href={`/wiki/objets/${peer.slug}`}
											className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-orange-500/40 hover:bg-white/[0.06] transition-all group"
										>
											<div className="text-xs font-bold text-white group-hover:text-orange-400 transition-colors">
												{peer.name}
											</div>
											<div className="text-[11px] text-white/50 line-clamp-2 mt-1">
												{peer.description}
											</div>
										</Link>
									))}
								</div>
							</div>
						)}
					</div>

					<div className="space-y-6">
						<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
							<h3 className="text-xs font-bold uppercase tracking-wider text-white/50">
								Fiche Technique
							</h3>

							{item.name_ja && (
								<div>
									<div className="text-[11px] text-white/40">Nom Japonais</div>
									<div className="text-sm font-mono text-white/90">{item.name_ja}</div>
								</div>
							)}

							{item.name_romaji && (
								<div>
									<div className="text-[11px] text-white/40">Romaji Hepburn</div>
									<div className="text-sm text-white/80">{item.name_romaji}</div>
								</div>
							)}

							<div>
								<div className="text-[11px] text-white/40">Catégorie</div>
								<div className="text-sm font-medium text-orange-300 capitalize">{item.category}</div>
							</div>

							{item.creator && (
								<div>
									<div className="text-[11px] text-white/40">Concepteur / Origine</div>
									{(() => {
										const creatorSlug = resolveCharacterSlugByName(item.creator);
										return creatorSlug ? (
											<GatedLink
												href={`/wiki/personnages/${creatorSlug}`}
												className="text-sm font-semibold text-white hover:text-orange-400 transition-colors inline-flex items-center gap-1"
											>
												<span>{item.creator}</span>
												<span className="text-white/40 text-xs">↗</span>
											</GatedLink>
										) : (
											<div className="text-sm font-semibold text-white">{item.creator}</div>
										);
									})()}
								</div>
							)}

							{item.debut_chapter && (
								<div>
									<div className="text-[11px] text-white/40">Première Apparition Manga</div>
									<div className="text-sm text-white">{item.debut_chapter}</div>
								</div>
							)}

							{item.debut_episode && (
								<div>
									<div className="text-[11px] text-white/40">Première Apparition Animée</div>
									<div className="text-sm text-white">{item.debut_episode}</div>
								</div>
							)}
						</div>

						<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center">
							<Link
								href="/wiki/objets"
								className="inline-flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-colors w-full"
							>
								← Retour aux objets
							</Link>
						</div>
					</div>
				</div>
			</WikiPageShell>
		</div>
	);
}
