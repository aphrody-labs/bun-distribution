import type { ReactNode } from "react";
import { HeroTitles } from "./HeroTitles";

/**
 * En-tête de page **interne** — celui qui vit à l'intérieur d'un conteneur,
 * là où `PageHero` (bandeau pleine largeur) ne peut pas aller : jeux, boutique,
 * classements, commandes, tierlists, statistiques.
 *
 * Il rendait auparavant un titre jaune centré, ombre portée décalée de 4 px et
 * halo bleu — une identité sans rapport avec celle du wiki et de l'accueil.
 * Il partage désormais la grammaire de `PageHero` via `<HeroTitles>` : accent
 * orange, serif d'affichage, alignement à gauche, filet de séparation. Les
 * `subtitle` deviennent des *lead*, et les titres en capitales criées
 * (`"CLASSEMENTS"`) ont été repassés en casse normale côté appelant.
 */
export function PageHeader({
	eyebrow,
	title,
	subtitle,
	size = "lg",
	className = "mb-12",
}: {
	/** Surtitre orange. Omis, l'en-tête garde le filet mais pas la ligne d'accent. */
	eyebrow?: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	size?: "md" | "lg";
	className?: string;
}) {
	return (
		<header className={`border-b border-white/[0.08] pb-6 ${className}`}>
			<HeroTitles
				eyebrow={eyebrow}
				title={title}
				lead={subtitle}
				regime={size === "md" ? "compact" : "plain"}
			/>
		</header>
	);
}
