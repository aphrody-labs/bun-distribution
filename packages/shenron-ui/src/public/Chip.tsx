/**
 * Chip — étiquette cliquable (thème d'article, champ modifié, filtre actif).
 *
 * Une seule géométrie pour tous les « petits marqueurs » du site, avec une
 * cible tactile qui respecte les 44 px recommandés même quand le texte est
 * court : les thèmes du journal faisaient 22 px de haut et se ratent au pouce.
 *
 * Server component.
 */
import type { ReactNode } from "react";
import type { UiLinkComponent } from "../navigation/link";

export type ChipTone = "neutral" | "accent" | "ink" | "quiet";

const TONES: Record<ChipTone, string> = {
	neutral: "border-white/20 text-white/75 hover:border-white/45 hover:text-white",
	accent: "border-dbz-orange/60 bg-dbz-orange/10 text-dbz-orange hover:bg-dbz-orange/20",
	ink: "border-black bg-dbz-orange text-black",
	quiet: "border-transparent bg-white/[0.05] text-white/55",
};

export function Chip({
	children,
	href,
	tone = "neutral",
	title,
	className = "",
    linkComponent: Link = "a",
}: {
	children: ReactNode;
	href?: string;
	tone?: ChipTone;
	title?: string;
	className?: string;
    linkComponent?: UiLinkComponent;
}) {
	const base = `inline-flex min-h-[2rem] items-center gap-1.5 border-2 px-3 py-1 font-display text-[0.6875rem] font-bold uppercase tracking-[0.08em] transition-colors ${TONES[tone]} ${className}`;
	if (!href) {
		return (
			<span className={base} title={title}>
				{children}
			</span>
		);
	}
	return (
		<Link href={href} className={base} title={title}>
			{children}
		</Link>
	);
}

/** Liste de chips avec retour à la ligne propre. */
export function ChipRow({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>;
}
