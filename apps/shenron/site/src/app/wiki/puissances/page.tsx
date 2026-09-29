import { PageHero } from "@/components/PageHero";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar, ContributeRail } from "@/components/kit";
import { dbUniverse } from "@/lib/db-universe";
import { PowerLevelsTable } from "@/components/wiki/PowerLevelsTable";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { ogMeta } from "@/lib/og";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { pageHero } from "@/lib/banner-config";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Niveaux de Puissance Officiels & Scouter Dragon Ball",
	description:
		"L'encyclopédie des Battle Powers officiels de Dragon Ball Z d'après le manga et Daizenshuu 7. Mesures Scouter, multiplicateurs Kaiô-ken et Super Saiyan.",
	...ogMeta({
		title: "Niveaux de Puissance & Scouter — DBFR",
		description:
			"Tous les chiffres officiels de puissance de Dragon Ball : Raditz, Nappa, Goku, Vegeta, Freezer 530 000, Super Saiyan 150 000 000 et règles de multiplicateurs.",
		canonical: "/wiki/puissances",
		type: "website",
	}),
};

export default async function PuissancesPage() {
	const [powersData, launch] = await Promise.all([
		dbUniverse.powerLevels(),
		getLaunchConfig().catch(() => null),
	]);
	const powers = powersData ?? [];
	const access = launch ? { openKeys: launch.openKeys, access: launch.access } : null;

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie & Archives"
				title="Niveaux de Puissance (Battle Power)"
				lead={`${powers.length} mesures officielles répertoriées d'après les relevés des Scouters dans le manga et le grand dictionnaire Daizenshuu 7 — sans estimations fantaisistes ni fanon.`}
				image={await pageHero("puissances")}
				imageAlt="Goku Super Saiyan face à Freezer sur Namek"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Puissances & Scouter" }]} />
					<WikiDrawer />
				</div>

				<div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-200/80">
					<strong>Doctrine de Shenron sur le Power Scaling :</strong> Seuls les chiffres explicitement énoncés dans le manga d'Akira Toriyama ou arrêtés dans les guides officiels <em>Daizenshuu 7</em> et <em>Chōzenshū</em> sont retenus ici. Les niveaux au-delà de la saga Freezer n'étant plus chiffrés par l'auteur, aucune invention éditoriale n'est tolérée sur notre plateforme.
				</div>

				<PowerLevelsTable powers={powers} access={access} />
				<ContributeRail quoiKey="kit.contribute.what.power" />
			</WikiPageShell>
		</div>
	);
}
