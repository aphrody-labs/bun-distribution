import DragonBall2048 from "./DragonBall2048";
import { PageHero } from "@/components/PageHero";
import { GAMES_HERO } from "@/lib/db-banners";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "DBZ 2048 : Ki Merge — Jeux",
	description:
		"Joue au jeu 2048 version Dragon Ball Z ! Fusionne tes personnages préférés (Saibaiman, Yamcha, Krillin, Vegeta...) pour augmenter ton Ki et atteindre Whis !",
	alternates: { canonical: "/jeux/2048" },
};

export default function Page2048() {
	return (
		<div>
			<PageHero
				eyebrow="Mini-jeu"
				title="DBZ 2048: Ki Merge"
				lead="Le célèbre jeu de réflexion revisité à la sauce Dragon Ball. Fusionnez les guerriers de même puissance pour débloquer les niveaux supérieurs !"
				image={GAMES_HERO}
				imageAlt="Dragon Ball Z 2048"
			/>
			<div className="container mx-auto py-12">
				<DragonBall2048 />
			</div>
		</div>
	);
}
