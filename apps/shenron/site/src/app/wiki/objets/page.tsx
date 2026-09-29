import { PageHero } from "@/components/PageHero";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar, ContributeRail } from "@/components/kit";
import { dbUniverse } from "@/lib/db-universe";
import { ItemsGrid } from "@/components/wiki/ItemsGrid";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { ogMeta } from "@/lib/og";
import { pageHero } from "@/lib/banner-config";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Objets, Artefacts & Technologies Dragon Ball",
	description:
		"Le répertoire exhaustif des objets, capsules, véhicules, armes et reliques magiques de Dragon Ball. Dragon Radar, Senzu, Potalas, Kinto-Un et Capsule Corporation.",
	...ogMeta({
		title: "Objets & Technologies Dragon Ball — DBFR",
		description:
			"Capsules Hoi-Poi, Haricots Senzu, Bâton Magique, Vaisseaux spatiaux et inventions de Bulma répertoriés d'après le manga.",
		canonical: "/wiki/objets",
		type: "website",
	}),
};

export default async function ObjetsPage() {
	const items = (await dbUniverse.items()) ?? [];
	const heroImage = await pageHero("objets");

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie & Archives"
				title="Objets & Technologies"
				lead={`${items.length} créations, reliques magiques et technologies répertoriées — des capsules révolutionnaires de Capsule Corp aux artefacts divins des Kaïōshins.`}
				image={heroImage}
				imageAlt="Son Goku enfant et Shenron"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Objets & Technologies" }]} />
					<WikiDrawer />
				</div>

				<div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-200/80">
					<strong>Note d'archive Capsule Corp :</strong> Chaque invention, vaisseau spatial ou relique mystique est catalogué avec son créateur officiel (Dr Brief, Bulma, Maître Karin, Kami-sama, Kaïōshins), son fonctionnement et son premier chapitre d'apparition dans le manga original.
				</div>

				<ItemsGrid items={items} fallbackImage={heroImage} />
				<ContributeRail quoiKey="kit.contribute.what.object" />
			</WikiPageShell>
		</div>
	);
}
