import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { GatedLink } from "@/components/GatedLink";
import { dbUniverse } from "@/lib/db-universe";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar } from "@/components/kit";
import { ogMeta } from "@/lib/og";
import { resolveCharacterSlugByName, resolveLocationSlugByName } from "@/lib/wiki-slugs";
import { pageHero } from "@/lib/banner-config";
import { assetUrl } from "@/lib/assets";

export const revalidate = 3600;

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const t = await dbUniverse.tournamentBySlug(slug);
	if (!t) return { title: "Tournoi introuvable" };

	return {
		title: `${t.name} — Tournois Dragon Ball`,
		description: `Vainqueur : ${t.winner_name ?? "Inconnu"}. ${t.rules_summary}`,
		...ogMeta({
			title: `${t.name} — Dragon Ball FR`,
			description: t.rules_summary,
			type: "article",
			canonical: `/wiki/tournois/${slug}`,
		}),
	};
}

export default async function TournamentDetailPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const t = await dbUniverse.tournamentBySlug(slug);
	if (!t) notFound();
	const hero = await pageHero("tournois");

	return (
		<WikiPageShell>
			<DomainBar domain="wiki" />
			<div className="flex flex-wrap items-center justify-between gap-4">
				<Breadcrumbs
					items={[
						{ label: "Encyclopédie", href: "/wiki" },
						{ label: "Tournois", href: "/wiki/tournois" },
						{ label: t.name, href: `/wiki/tournois/${t.slug}` },
					]}
				/>
				<WikiDrawer />
			</div>
			<WikiEditBar table="db_tournaments" id={t.id} indexHref="/wiki/tournois" label={t.name} />

			{/* Fiche d'en-tête */}
			<div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-6 sm:p-8 backdrop-blur-md space-y-6">
				<div className="relative h-32 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
					<img src={assetUrl(hero)} alt="" aria-hidden="true" className="h-full w-full object-cover opacity-70" />
					<div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
				</div>
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<span className="rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-amber-400">
								🏆 {t.tournament_type}
							</span>
							<span className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-white/60">
								{t.saga}
							</span>
						</div>
						<h1 className="text-3xl font-black text-white sm:text-4xl">
							{t.name}
						</h1>
						{t.name_ja && (
							<div className="text-sm font-medium text-white/50">
								{t.name_ja}
							</div>
						)}
					</div>
				</div>

				{/* Podium officiel */}
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5">
						<div className="text-xs uppercase font-bold text-amber-400 tracking-wider flex items-center gap-1.5">
							<span>🥇</span> Vainqueur Officiel
						</div>
						<div className="mt-2 text-2xl font-black text-white">
							{(() => {
								const slug = resolveCharacterSlugByName(t.winner_name);
								return slug ? (
									<GatedLink
										href={`/wiki/personnages/${slug}`}
										className="hover:text-amber-400 transition-colors inline-flex items-center gap-1.5"
									>
										<span>{t.winner_name}</span>
										<span className="text-xs text-amber-400/50">↗</span>
									</GatedLink>
								) : (
									t.winner_name ?? "Non déterminé"
								);
							})()}
						</div>
					</div>

					<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
						<div className="text-xs uppercase font-bold text-white/50 tracking-wider flex items-center gap-1.5">
							<span>🥈</span> Finaliste
						</div>
						<div className="mt-2 text-2xl font-black text-white/80">
							{(() => {
								const slug = resolveCharacterSlugByName(t.runner_up_name);
								return slug ? (
									<GatedLink
										href={`/wiki/personnages/${slug}`}
										className="hover:text-orange-400 transition-colors inline-flex items-center gap-1.5"
									>
										<span>{t.runner_up_name}</span>
										<span className="text-xs text-white/40">↗</span>
									</GatedLink>
								) : (
									t.runner_up_name ?? "Non spécifié"
								);
							})()}
						</div>
					</div>
				</div>

				{/* Détails techniques */}
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-white/10 pt-6">
					<div className="rounded-xl bg-white/5 p-4">
						<div className="text-[11px] uppercase font-bold text-white/40">Lieu</div>
						<div className="mt-1 text-sm font-semibold text-white">
							{(() => {
								const locSlug = resolveLocationSlugByName(t.location);
								return locSlug ? (
									<GatedLink
										href={`/wiki/lieux/${locSlug}`}
										className="hover:text-orange-400 transition-colors inline-flex items-center gap-1"
									>
										<span>{t.location}</span>
										<span className="text-xs text-white/40">↗</span>
									</GatedLink>
								) : (
									t.location ?? "Non renseigné"
								);
							})()}
						</div>
					</div>
					<div className="rounded-xl bg-white/5 p-4">
						<div className="text-[11px] uppercase font-bold text-white/40">Participants</div>
						<div className="mt-1 text-sm font-semibold text-white">{t.participants_count ? `${t.participants_count} guerriers` : "Non dénombré"}</div>
					</div>
					<div className="rounded-xl bg-white/5 p-4">
						<div className="text-[11px] uppercase font-bold text-white/40">Canon</div>
						<div className="mt-1 text-sm font-semibold text-white">{t.canon ? "Canon manga" : "Dérivé"}</div>
					</div>
					<div className="rounded-xl bg-white/5 p-4">
						<div className="text-[11px] uppercase font-bold text-white/40">Timeline</div>
						<div className="mt-1 text-sm font-semibold text-orange-400">
							{t.canon ? "Manga Canon (42 tomes)" : "Toei Animation"}
						</div>
					</div>
				</div>

				{/* Règles */}
				<div className="rounded-2xl border border-white/10 bg-black/30 p-5 space-y-2">
					<h3 className="text-xs uppercase font-bold text-white/50 tracking-wider">
						Règlement & Déroulement
					</h3>
					<p className="text-sm leading-relaxed text-white/80">
						{t.rules_summary}
					</p>
				</div>
			</div>

			{/* Matchs notables */}
			{t.notable_matches && t.notable_matches.length > 0 && (
				<div className="space-y-4">
					<h2 className="text-xl font-bold text-white flex items-center gap-2">
						<span>🥊</span> Matchs Clés & Affrontements Décisifs
					</h2>
					<div className="space-y-3">
						{t.notable_matches.map((m, idx) => {
							const slugA = resolveCharacterSlugByName(m.fighterA);
							const slugB = resolveCharacterSlugByName(m.fighterB);
							const slugW = resolveCharacterSlugByName(m.winner);

							return (
								<div
									key={idx}
									className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
								>
									<div className="space-y-1">
										<span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/60 uppercase">
											{m.round}
										</span>
										<div className="text-base font-bold text-white flex flex-wrap items-center gap-2 pt-1">
											{slugA ? (
												<GatedLink
													href={`/wiki/personnages/${slugA}`}
													className={`hover:underline ${m.winner === m.fighterA ? "text-orange-400 font-extrabold" : "text-white/70"}`}
												>
													{m.fighterA}
												</GatedLink>
											) : (
												<span className={m.winner === m.fighterA ? "text-orange-400 font-extrabold" : "text-white/70"}>
													{m.fighterA}
												</span>
											)}
											<span className="text-xs text-white/30">VS</span>
											{slugB ? (
												<GatedLink
													href={`/wiki/personnages/${slugB}`}
													className={`hover:underline ${m.winner === m.fighterB ? "text-orange-400 font-extrabold" : "text-white/70"}`}
												>
													{m.fighterB}
												</GatedLink>
											) : (
												<span className={m.winner === m.fighterB ? "text-orange-400 font-extrabold" : "text-white/70"}>
													{m.fighterB}
												</span>
											)}
										</div>
										{m.techniqueOrClimax && (
											<p className="text-xs text-white/60 pt-1">
												{m.techniqueOrClimax}
											</p>
										)}
									</div>

									<div className="shrink-0 text-left sm:text-right">
										<div className="text-[10px] uppercase font-bold text-white/40">Vainqueur</div>
										{slugW ? (
											<GatedLink
												href={`/wiki/personnages/${slugW}`}
												className="text-sm font-bold text-amber-400 hover:underline flex items-center gap-1"
											>
												<span>🏆 {m.winner}</span>
												<span className="text-xs text-amber-400/50">↗</span>
											</GatedLink>
										) : (
											<div className="text-sm font-bold text-amber-400">🏆 {m.winner}</div>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Retour navigation */}
			<div className="pt-4 border-t border-white/10 flex justify-between">
				<Link
					href="/wiki/tournois"
					className="text-xs font-semibold text-orange-400 hover:text-orange-300 transition-colors"
				>
					← Retour à la liste des tournois
				</Link>
			</div>
		</WikiPageShell>
	);
}
