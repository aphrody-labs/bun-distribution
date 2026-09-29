/**
 * /plan-du-site — la carte complète du site, parcours par parcours.
 *
 * Pourquoi cette page existe : avec treize rubriques wiki, un journal, des
 * classements, des tier lists, des mini-jeux et un espace membre, le site n'avait
 * aucun endroit qui dise « voilà tout ce qu'il y a ». Le pied de page en listait
 * une partie, le méga-menu une autre, et plusieurs sections n'avaient qu'un seul
 * lien entrant sur tout le site.
 *
 * Elle est dérivée de `lib/site-map.ts` (lui-même dérivé du registre d'accès) :
 * ouvrir une rubrique depuis `/admin/lancement` la fait apparaître ici à la
 * revalidation suivante, sans toucher à ce fichier. Et une rubrique refermée en
 * disparaît — une carte du site qui mène à des redirections serait pire que pas
 * de carte.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, SectionHeading, Stack } from "@/components/kit";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { buildSiteMap } from "@/lib/site-map";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { isPathPublic, type AccessSnapshot } from "@/lib/wiki-launch";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Plan du site — toutes les rubriques Dragon Ball",
	description:
		"La carte complète de dragonballfr.com : encyclopédie, épisodes, films, manga, databooks, canon, actualités, classements et participation.",
	alternates: { canonical: "/plan-du-site" },
};

export default async function PlanDuSitePage() {
	const cfg = await getLaunchConfig().catch(() => null);
	const snapshot: AccessSnapshot = cfg ?? { openKeys: [], access: {} };

	// `includeMember` : l'espace membre est listé pour que le parcours soit
	// complet et compréhensible, mais ses pages restent hors sitemap XML
	// (priorité 0) — elles n'ont rien à offrir à un moteur de recherche.
	const groups = buildSiteMap({
		isOpen: (href) => isPathPublic(href, snapshot),
		includeMember: true,
		includeStaff: false,
	});

	return (
		<PageShell rhythm="loose">
			<Breadcrumbs className="mb-8" items={[{ label: "Plan du site" }]} />

			<SectionHeading
				level={1}
				kicker="Dragon Ball France"
				title="Plan du site"
				standfirst="Tout ce que contient le site, regroupé par ce que tu viens y chercher. Les rubriques encore en préparation n'apparaissent pas : chaque lien ci-dessous mène à une page réelle."
			/>

			<Stack className="mt-12">
				{groups.map(({ journey, items }) => (
					<section key={journey.key} aria-labelledby={`parcours-${journey.key}`}>
						<SectionHeading
							id={`parcours-${journey.key}`}
							title={journey.label}
							standfirst={journey.blurb}
							rule
						/>
						<ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{items.map((item) => (
								<li key={item.href}>
									<Link
										href={item.href}
										className="group flex h-full flex-col border border-white/[0.08] bg-dbz-card/80 p-4 transition-transform duration-150 hover:-translate-y-0.5 hover:border-dbz-orange"
									>
										<span className="flex items-baseline justify-between gap-2">
											<span className="font-display text-[1rem] font-bold tracking-[-0.01em] text-white group-hover:text-dbz-orange">
												{item.label}
											</span>
											{item.audience === "member" && (
												<span className="font-display text-[0.625rem] uppercase tracking-[0.1em] text-white/35">
													membre
												</span>
											)}
										</span>
										{item.blurb && (
											<span className="mt-1.5 text-[0.875rem] leading-relaxed text-white/55">
												{item.blurb}
											</span>
										)}
									</Link>
								</li>
							))}
						</ul>
					</section>
				))}
			</Stack>
		</PageShell>
	);
}
