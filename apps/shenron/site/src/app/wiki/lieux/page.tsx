import type { Metadata } from "next";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { LocationsGrid } from "@/components/wiki/LocationsGrid";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { DomainBar, ContributeRail } from "@/components/kit";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { ogMeta } from "@/lib/og";
import { pageHero } from "@/lib/banner-config";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Lieux & Sanctuaires de Dragon Ball",
	description:
		"La géographie mythique et cosmique de l'univers Dragon Ball : Kame House, Tour Karin, Sanctuaire de Dieu, Salle de l'Esprit et du Temps, Namek, Kaïô-shin et mondes divins.",
	...ogMeta({
		title: "Lieux & Sanctuaires — Encyclopédie Dragon Ball",
		description:
			"Explorez les sanctuaires sacrés, planètes, dimensions parallèles et cités légendaires de la franchise Dragon Ball.",
		type: "website",
		canonical: "/wiki/lieux",
	}),
};

export default async function LocationsIndexPage() {
	const locations = (await dbUniverse.locations()) ?? [];

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie"
				title="Lieux & Sanctuaires Mythiques"
				lead="De la modeste Kame House perdue sur l'océan aux dimensions divines du Palais de Zeno, découvrez la géographie et les sanctuaires spirituels du multivers Dragon Ball."
				image={await pageHero("lieux")}
				imageAlt="Son Goku enfant et Shenron"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Lieux & Sanctuaires" }]} />
					<WikiDrawer />
				</div>
				<div className="rounded-2xl border border-white/10 bg-gradient-to-r from-orange-950/20 via-black/40 to-transparent p-5 backdrop-blur-md">
					<div className="flex items-center gap-3">
						<span className="text-2xl">🏛️</span>
						<div>
							<h2 className="text-sm font-bold text-white">Géographie & Cosmologie Canonique</h2>
							<p className="text-xs text-white/60">
								Chaque sanctuaire respecte la cosmologie originelle d'Akira Toriyama détaillée dans le <em>Daizenshuu 4</em> (World Guide) et le <em>Chōzenshū 4</em>.
							</p>
						</div>
					</div>
				</div>

				<LocationsGrid locations={locations} />
				<ContributeRail quoiKey="kit.contribute.what.place" />
			</WikiPageShell>
		</div>
	);
}
