import { notFound } from "next/navigation";
import Link from "next/link";
import { GatedLink } from "@/components/GatedLink";
import { PageHero } from "@/components/PageHero";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DomainBar } from "@/components/kit";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { dbUniverse } from "@/lib/db-universe";
import { ogMeta } from "@/lib/og";
import {
	resolveCharacterSlugByName,
	resolveLocationSlugByName,
	resolveTechniqueSlugByName,
} from "@/lib/wiki-slugs";
import type { Metadata } from "next";

export const revalidate = 3600;

interface BattleDetailPageProps {
	params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
	if (process.env.SHENRON_BUILD_LOW_MEMORY === "1") return [];
	const battles = await dbUniverse.battles();
	return (battles ?? []).map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: BattleDetailPageProps): Promise<Metadata> {
	const { slug } = await params;
	const battle = await dbUniverse.battleBySlug(slug);
	if (!battle) return {};

	return {
		title: `${battle.title} — Combat Dragon Ball`,
		description: battle.climax_summary ?? `Analyse détaillée de l'affrontement ${battle.title}.`,
		...ogMeta({
			title: `${battle.title} — Fiche Combat`,
			description: battle.climax_summary ?? `Analyse détaillée de l'affrontement ${battle.title}.`,
			canonical: `/wiki/combats/${slug}`,
			type: "article",
		}),
	};
}

export default async function BattleDetailPage({ params }: BattleDetailPageProps) {
	const { slug } = await params;
	const battle = await dbUniverse.battleBySlug(slug);
	if (!battle) notFound();

	return (
		<div>
			<PageHero
				eyebrow={`Combat • ${battle.series}`}
				title={battle.title}
				lead={battle.climax_summary}
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs
						items={[
							{ label: "Combats", href: "/wiki/combats" },
							{ label: battle.title },
						]}
					/>
					<WikiDrawer />
				</div>
				<WikiEditBar table="db_battles" id={battle.id} indexHref="/wiki/combats" label={battle.title} />

				{/* Panneau d'informations clés */}
				<div className="grid gap-6 md:grid-cols-3">
					{/* Colonne 1 & 2 : Face-à-face et Déroulement */}
					<div className="space-y-6 md:col-span-2">
						{/* Choc des combattants */}
						<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md">
							<h2 className="text-sm font-semibold uppercase tracking-wider text-orange-400 mb-4">
								Les Forces en Présence
							</h2>
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
								<div className="rounded-lg bg-blue-950/20 border border-blue-500/20 p-4">
									<div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">
										Camp A
									</div>
									<div className="space-y-1.5">
										{battle.combatants.filter((c) => c.side === "a").map((c, i) => {
											const slug = resolveCharacterSlugByName(c.name);
											return slug ? (
												<GatedLink
													key={i}
													href={`/wiki/personnages/${slug}`}
													className="inline-flex items-center gap-1.5 text-sm font-bold text-white hover:text-orange-400 transition-colors"
												>
													<span>{c.name}</span>
													<span className="text-white/30 text-xs">↗</span>
												</GatedLink>
											) : (
												<div key={i} className="text-sm font-bold text-white">
													{c.name}
												</div>
											);
										})}
									</div>
								</div>

								<div className="rounded-lg bg-red-950/20 border border-red-500/20 p-4">
									<div className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">
										Camp B (Adversaire)
									</div>
									<div className="space-y-1.5">
										{battle.combatants.filter((c) => c.side === "b").map((c, i) => {
											const slug = resolveCharacterSlugByName(c.name);
											return slug ? (
												<GatedLink
													key={i}
													href={`/wiki/personnages/${slug}`}
													className="inline-flex items-center gap-1.5 text-sm font-bold text-white hover:text-orange-400 transition-colors"
												>
													<span>{c.name}</span>
													<span className="text-white/30 text-xs">↗</span>
												</GatedLink>
											) : (
												<div key={i} className="text-sm font-bold text-white">
													{c.name}
												</div>
											);
										})}
									</div>
								</div>
							</div>

							{/* Vainqueur */}
							<div className="mt-4 rounded-lg bg-emerald-950/30 border border-emerald-500/30 p-4 flex items-center justify-between">
								<span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
									Issue du Combat
								</span>
								{(() => {
									const winnerSlug = resolveCharacterSlugByName(battle.winner_name);
									return winnerSlug ? (
										<GatedLink
											href={`/wiki/personnages/${winnerSlug}`}
											className="text-sm font-bold text-emerald-400 hover:underline flex items-center gap-1"
										>
											<span>🏆 {battle.winner_name}</span>
											<span className="text-xs text-emerald-400/50">↗</span>
										</GatedLink>
									) : (
										<span className="text-sm font-bold text-emerald-400">
											🏆 {battle.winner_name ?? "Match Nul / Interrompu"}
										</span>
									);
								})()}
							</div>
						</div>

						{/* Climax & Analyse tactique */}
						<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
							<h2 className="text-sm font-semibold uppercase tracking-wider text-orange-400 mb-3">
								Analyse Tactique & Tournant du Combat
							</h2>
							<p className="text-sm leading-relaxed text-white/80">
								{battle.climax_summary ?? "Aucun résumé narratif n'est renseigné pour cet affrontement."}
							</p>
						</div>

						{/* Techniques utilisées */}
						{battle.techniques_used && battle.techniques_used.length > 0 && (
							<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
								<h2 className="text-sm font-semibold uppercase tracking-wider text-orange-400 mb-3">
									Techniques & Capacités Déployées
								</h2>
								<div className="flex flex-wrap gap-2">
									{battle.techniques_used.map((tech) => {
										const tSlug = resolveTechniqueSlugByName(tech);
										return tSlug ? (
											<GatedLink
												key={tech}
												href={`/wiki/techniques/${tSlug}`}
												className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300 hover:bg-orange-500/20 hover:border-orange-500/40 transition-colors flex items-center gap-1"
											>
												<span>⚡ {tech}</span>
												<span className="text-[10px] text-orange-400/50">↗</span>
											</GatedLink>
										) : (
											<span
												key={tech}
												className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300"
											>
												⚡ {tech}
											</span>
										);
									})}
								</div>
							</div>
						)}
					</div>

					{/* Colonne 3 : Données canoniques et repères */}
					<div className="space-y-6">
						<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
							<h3 className="text-xs font-bold uppercase tracking-wider text-white/50">
								Repères Canoniques
							</h3>

							{battle.title_ja && (
								<div>
									<div className="text-[11px] text-white/40">Titre Original Japonais</div>
									<div className="text-sm font-mono text-white/90">{battle.title_ja}</div>
								</div>
							)}

							<div>
								<div className="text-[11px] text-white/40">Série</div>
								<div className="text-sm font-semibold text-white">{battle.series}</div>
							</div>

							{battle.location && (
								<div>
									<div className="text-[11px] text-white/40">Lieu du Combat</div>
									{(() => {
										const locSlug = resolveLocationSlugByName(battle.location);
										return locSlug ? (
											<GatedLink
												href={`/wiki/lieux/${locSlug}`}
												className="text-sm text-white hover:text-orange-400 transition-colors inline-flex items-center gap-1 font-medium"
											>
												<span>{battle.location}</span>
												<span className="text-white/30 text-xs">↗</span>
											</GatedLink>
										) : (
											<div className="text-sm text-white">{battle.location}</div>
										);
									})()}
								</div>
							)}

							{battle.manga_volume_start && (
								<div>
									<div className="text-[11px] text-white/40">Plage Manga (42 tomes)</div>
									<div className="text-sm text-white flex flex-wrap items-center gap-1.5">
										<Link
											href={`/wiki/manga/volume/${battle.manga_volume_start}`}
											className="text-orange-400 hover:underline font-semibold"
										>
											Tome {battle.manga_volume_start}
										</Link>
										{battle.manga_volume_end && battle.manga_volume_end !== battle.manga_volume_start && (
											<>
												<span className="text-white/40">à</span>
												<Link
													href={`/wiki/manga/volume/${battle.manga_volume_end}`}
													className="text-orange-400 hover:underline font-semibold"
												>
													Tome {battle.manga_volume_end}
												</Link>
											</>
										)}
										{battle.manga_chapter_start && (
											<span className="text-white/60">
												{" "}• Chap. {battle.manga_chapter_start}
												{battle.manga_chapter_end && battle.manga_chapter_end !== battle.manga_chapter_start
													? ` à ${battle.manga_chapter_end}`
													: ""}
											</span>
										)}
									</div>
								</div>
							)}

							{battle.episode_start && (
								<div>
									<div className="text-[11px] text-white/40">Épisodes Animés</div>
									<div className="text-sm text-white flex flex-wrap items-center gap-1.5">
										<Link
											href={`/wiki/episodes/${battle.episode_start}`}
											className="text-orange-400 hover:underline font-semibold"
										>
											Épisode {battle.episode_start}
										</Link>
										{battle.episode_end && battle.episode_end !== battle.episode_start && (
											<>
												<span className="text-white/40">à</span>
												<Link
													href={`/wiki/episodes/${battle.episode_end}`}
													className="text-orange-400 hover:underline font-semibold"
												>
													Épisode {battle.episode_end}
												</Link>
											</>
										)}
									</div>
								</div>
							)}

							<div>
								<div className="text-[11px] text-white/40">Statut Canon</div>
								<div className="text-sm font-semibold text-amber-300">
									{battle.canon ? "✓ Canon manga Akira Toriyama" : "Hors continuité manga"}
								</div>
							</div>

							<div>
								<div className="text-[11px] text-white/40">Continuité &amp; Timeline</div>
								<div className="text-sm font-semibold text-orange-400">
									{battle.canon ? "Timeline Manga Canon (42 tomes)" : battle.series?.includes("XV") ? "Timeline Dérivée Xenoverse" : "Timeline Toei Animation"}
								</div>
							</div>

							{battle.manga_volume_start && battle.episode_start && (
								<div className="rounded-lg bg-orange-950/30 border border-orange-500/20 p-2.5 text-xs text-orange-300/90 leading-relaxed">
									<span className="font-bold text-orange-400">Relation d&apos;adaptation :</span> l&apos;épisode {battle.episode_start} de Toei Animation constitue l&apos;adaptation animée télévisée de l&apos;affrontement original paru au tome {battle.manga_volume_start}.
								</div>
							)}

							<div>
								<div className="text-[11px] text-white/40">Niveau d'Impact</div>
								<div className="text-amber-400 text-sm">
									{"★".repeat(Math.min(5, Math.max(1, battle.impact_level)))}
								</div>
							</div>
						</div>

						<div className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center">
							<Link
								href="/wiki/combats"
								className="inline-flex items-center justify-center rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-colors w-full"
							>
								← Retour aux combats
							</Link>
						</div>
					</div>
				</div>
			</WikiPageShell>
		</div>
	);
}
