import { DomainBar, PageShell } from "@/components/kit";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { TierlistView } from "@/components/tierlist/TierlistView";
import { getLikeCountsFor, listTierlists } from "@/lib/tierlists";
import { ogMeta } from "@/lib/og";

export const revalidate = 30;

export const metadata: Metadata = {
	title: "Tierlists",
	description:
		"Classe l'univers Dragon Ball : tierlists de personnages créées et partagées par la communauté.",
	...ogMeta({
		title: "Tierlists Dragon Ball",
		description: "Classe les personnages de Dragon Ball. Tierlists créées par la communauté.",
		canonical: "/tierlists",
	}),
};

export default async function TierlistsPage() {
	const lists = await listTierlists(60).catch(() => []);
	const likeCounts = await getLikeCountsFor(lists.map((l) => l.id)).catch(
		() => ({}) as Record<string, number>
	);

	return (
		<PageShell width="narrow">
			{/* Pont staff → curation des tier lists, invisible pour les visiteurs. */}
			<DomainBar domain="tierlists" className="mb-6" />

			<PageHeader
				eyebrow="Communauté"
				title="Tierlists"
				subtitle="Classe l'univers Dragon Ball — créées et partagées par la communauté"
			/>

			<div className="mb-10 flex flex-wrap justify-center gap-4">
				<Link
					href="/tierlists/creer"
					className="rounded-lg bg-dbz-orange px-6 py-3 text-sm font-bold uppercase tracking-wide text-black transition-opacity hover:opacity-90"
				>
					Créer ma tierlist
				</Link>
				<Link
					href="/tierlists/mes"
					className="rounded-lg border border-white/15 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white/80 transition-colors hover:border-white/40"
				>
					Mes tierlists
				</Link>
			</div>

			{lists.length === 0 ? (
				<div className="dbz-panel p-8 text-center">
					<p className="text-2xl font-saiyan uppercase text-dbz-orange">
						Aucune tierlist pour l'instant.
					</p>
					<p className="mt-2 text-white/60">Sois le premier à classer l'univers Dragon Ball !</p>
				</div>
			) : (
				<div className="grid gap-6 sm:grid-cols-2">
					{lists.map((tl) => (
						<Link
							key={tl.id}
							href={`/tierlists/${tl.slug}`}
							className="dbz-panel block p-4 transition-colors hover:border-dbz-orange/60"
						>
							<div className="mb-3 flex items-start justify-between gap-2">
								<div className="min-w-0">
									<div className="mb-1 flex flex-wrap items-center gap-1.5">
										{tl.official && (
											<span className="rounded bg-dbz-yellow/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-dbz-yellow border border-dbz-yellow/40">
												Officiel
											</span>
										)}
										{tl.featured && (
											<span className="rounded bg-dbz-orange/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-dbz-orange border border-dbz-orange/40">
												★ En avant
											</span>
										)}
									</div>
									<h2 className="truncate text-lg font-bold text-white">{tl.title}</h2>
									<p className="text-[12px] text-white/50">
										par {tl.author?.username ?? "un Saiyan"}
									</p>
								</div>
								{(likeCounts[tl.id] ?? 0) > 0 && (
									<span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[12px] font-bold text-rose-300">
										♥ {likeCounts[tl.id]}
									</span>
								)}
							</div>
							<TierlistView tiers={tl.tiers} compact />
						</Link>
					))}
				</div>
			)}
		</PageShell>
	);
}
