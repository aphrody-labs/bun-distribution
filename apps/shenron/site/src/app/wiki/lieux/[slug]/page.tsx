import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { GatedWrap } from "@/components/GatedLink";
import { dbUniverse } from "@/lib/db-universe";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar } from "@/components/kit";
import { ogMeta } from "@/lib/og";

export const revalidate = 3600;

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const loc = await dbUniverse.locationBySlug(slug);
	if (!loc) return { title: "Lieu introuvable" };

	return {
		title: `${loc.name} — Lieux & Sanctuaires`,
		description: loc.description,
		...ogMeta({
			title: `${loc.name} — Dragon Ball FR`,
			description: loc.description,
			type: "article",
			canonical: `/wiki/lieux/${slug}`,
		}),
	};
}

export default async function LocationDetailPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const loc = await dbUniverse.locationBySlug(slug);
	if (!loc) notFound();

	const allBattles = (await dbUniverse.battles()) ?? [];
	const locBattles = allBattles.filter((b) => {
		if (!b.location) return false;
		const lNorm = b.location.toLowerCase();
		const nameNorm = loc.name.toLowerCase();
		return lNorm.includes(nameNorm) || nameNorm.includes(lNorm);
	});

	return (
		<WikiPageShell>
			<DomainBar domain="wiki" />
			<div className="flex flex-wrap items-center justify-between gap-4">
				<Breadcrumbs
					items={[
						{ label: "Encyclopédie", href: "/wiki" },
						{ label: "Lieux & Sanctuaires", href: "/wiki/lieux" },
						{ label: loc.name, href: `/wiki/lieux/${loc.slug}` },
					]}
				/>
				<WikiDrawer />
			</div>
			<WikiEditBar table="db_locations" id={loc.id} indexHref="/wiki/lieux" label={loc.name} />

			{/* Fiche d'en-tête */}
			<div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-6 sm:p-8 backdrop-blur-md space-y-6">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<span className="rounded-md bg-orange-500/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-orange-400">
								{loc.realm_type}
							</span>
							{loc.planet && (
								<span className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-white/60">
									🪐 {loc.planet}
								</span>
							)}
						</div>
						<h1 className="text-3xl font-black text-white sm:text-4xl">
							{loc.name}
						</h1>
						{loc.name_ja && (
							<div className="text-sm font-medium text-white/50">
								{loc.name_ja} {loc.name_romaji ? `— ${loc.name_romaji}` : ""}
							</div>
						)}
					</div>
				</div>

				<div className="rounded-2xl border border-white/10 bg-black/30 p-5 leading-relaxed text-sm text-white/80">
					{loc.description}
				</div>

				{/* Métadonnées canoniques */}
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-white/10 pt-6">
					<div className="rounded-xl bg-white/5 p-4">
						<div className="text-[11px] uppercase font-bold text-white/40">Domaine</div>
						<div className="mt-1 text-sm font-semibold text-white">{loc.realm_type}</div>
					</div>
					<div className="rounded-xl bg-white/5 p-4">
						<div className="text-[11px] uppercase font-bold text-white/40">Première apparition Manga</div>
						<div className="mt-1 text-sm font-semibold text-white">{loc.debut_chapter ?? "Non renseigné"}</div>
					</div>
					<div className="rounded-xl bg-white/5 p-4">
						<div className="text-[11px] uppercase font-bold text-white/40">Première apparition Anime</div>
						<div className="mt-1 text-sm font-semibold text-white">{loc.debut_episode ?? "Non renseigné"}</div>
					</div>
				</div>
			</div>

			{/* Événements marquants */}
			{loc.key_events && loc.key_events.length > 0 && (
				<div className="space-y-4">
					<h2 className="text-xl font-bold text-white flex items-center gap-2">
						<span>⚡</span> Événements & Chroniques
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{loc.key_events.map((ev) => (
							<div
								key={ev.title}
								className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2"
							>
								<h3 className="font-bold text-white text-base text-orange-400">
									{ev.title}
								</h3>
								<p className="text-xs leading-relaxed text-white/70">
									{ev.description}
								</p>
								{ev.mangaRef && (
									<div className="text-[11px] font-mono text-white/40 pt-1">
										📖 {ev.mangaRef}
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{/* Combats Légendaires sur ce Lieu */}
			{locBattles.length > 0 && (
				<div className="space-y-4">
					<h2 className="text-xl font-bold text-white flex items-center gap-2">
						<span>⚔️</span> Combats Légendaires sur ce Lieu ({locBattles.length})
					</h2>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{locBattles.map((b) => (
							<GatedWrap
								key={b.slug}
								href={`/wiki/combats/${b.slug}`}
								className="block rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2 hover:border-orange-500/40 hover:bg-orange-500/[0.04] transition-all"
							>
								<div className="flex items-center justify-between text-xs">
									<span className="font-bold text-orange-400">{b.series}</span>
									{b.winner_name && (
										<span className="text-emerald-400 font-medium">
											🏆 Vainqueur : {b.winner_name}
										</span>
									)}
								</div>
								<h3 className="font-bold text-white text-base">
									{b.title}
								</h3>
								{b.climax_summary && (
									<p className="text-xs leading-relaxed text-white/70">
										{b.climax_summary}
									</p>
								)}
							</GatedWrap>
						))}
					</div>
				</div>
			)}

			{/* Retour navigation */}
			<div className="pt-4 border-t border-white/10 flex justify-between">
				<Link
					href="/wiki/lieux"
					className="text-xs font-semibold text-orange-400 hover:text-orange-300 transition-colors"
				>
					← Retour à la liste des lieux
				</Link>
			</div>
		</WikiPageShell>
	);
}
