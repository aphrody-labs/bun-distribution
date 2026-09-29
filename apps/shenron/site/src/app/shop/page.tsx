import type { Metadata } from "next";
import { getShenronShopCatalog } from "@/lib/shenron";
import { ogMeta } from "@/lib/og";
import { ShopGrid } from "./ShopGrid";

export const revalidate = 60;

export const metadata: Metadata = {
	title: "Boutique",
	description:
		"Cosmétiques exclusifs Shenron : cartes de profil, badges, couleurs, titres et bannières à acheter et équiper directement sur le site avec tes Zénis.",
	...ogMeta({
		title: "Boutique Shenron",
		description:
			"Cartes de profil, badges, couleurs, titres et bannières exclusifs — achat et équipement directement sur le site.",
		canonical: "/shop",
	}),
};

export default async function ShopPage() {
	// Catalogue public (SSR caché) → l'îlot client ShopGrid ajoute solde + achat.
	const { items, economy } = await getShenronShopCatalog();

	return (
		<div className="container mx-auto px-4 py-8 md:py-16">
			{items.length === 0 ? (
				<div className="rounded-xl border border-white/10 bg-[#151412] p-12 text-center">
					<h1 className="font-saiyan text-4xl text-white">Boutique Shenron</h1>
					<p className="mt-3 font-saiyan text-2xl uppercase text-dbz-orange">
						La boutique est fermée pour maintenance.
					</p>
				</div>
			) : (
				<ShopGrid items={items} economy={economy} />
			)}
		</div>
	);
}
