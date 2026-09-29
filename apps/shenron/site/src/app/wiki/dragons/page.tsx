import { PageHero } from "@/components/PageHero";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar, ContributeRail } from "@/components/kit";
import { dbUniverse } from "@/lib/db-universe";
import { WishesLedger } from "@/components/wiki/WishesLedger";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { ogMeta } from "@/lib/og";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { pageHero } from "@/lib/banner-config";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Dragons Sacrés & Registre des Vœux Dragon Ball",
	description:
		"Shenron, Polunga, Super Shenron, Toronbo et Ultimate Shenron. Règles divines, formules d'invocation et historique complet de chaque vœu canonique exaucé.",
	...ogMeta({
		title: "Dragons Sacrés & Registre des Vœux — DBFR",
		description:
			"L'annuaire des dragons divins et tous les vœux exaucés dans Dragon Ball : culotte d'Oolong, résurrections, téléportations et Super Dragon Balls.",
		canonical: "/wiki/dragons",
		type: "website",
	}),
};

export default async function DragonsPage() {
	const [dragons, wishes, launch] = await Promise.all([
		dbUniverse.dragons(),
		dbUniverse.wishes(),
		getLaunchConfig().catch(() => null),
	]);
	const access = launch ? { openKeys: launch.openKeys, access: launch.access } : null;
	const heroImage = await pageHero("dragons");

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie"
				title="Dragons Sacrés & Registre des Vœux"
				lead={`Les 5 dragons divins du multivers et l'inventaire historique de ${wishes?.length ?? 0} vœux canoniques exaucés — règles, formules sacrées en dialecte divin et répercussions universelles.`}
				image={heroImage}
				imageAlt="Son Goku enfant et Shenron"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Dragons & Vœux" }]} />
					<WikiDrawer />
				</div>

				<div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-200/80">
					<strong>Loi sacrée des Dragon Balls :</strong> Créées à l'origine par les membres du Clan du Dragon namekien et par le Dieu Dragon Zalama, les perles sacrées sont régies par des règles inaltérables. Aucun dragon ne peut accomplir un prodige surpassant la puissance spirituelle de son propre créateur.
				</div>

				<WishesLedger dragons={dragons ?? []} wishes={wishes ?? []} access={access} fallbackImage={heroImage} />
				<ContributeRail quoiKey="kit.contribute.what.dragon" />
			</WikiPageShell>
		</div>
	);
}
