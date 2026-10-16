/**
 * TabNav — la barre d'onglets **en liens**, pas en état client.
 *
 * Un onglet qui ne change que du `useState` ne se partage pas, ne s'indexe pas,
 * et repart à zéro au retour arrière. Ici chaque onglet est une URL réelle
 * (`/news/fil/articles`), donc : partageable, crawlable, cacheable par le CDN, et le
 * bouton « retour » du navigateur fait ce que le lecteur attend.
 *
 * Sur mobile la barre défile horizontalement sans couper le dernier onglet
 * (`snap` + gouttière négative pour que le premier onglet reste aligné au bord
 * du shell).
 *
 * Server component.
 */
import type { ComponentType, ReactNode } from "react";

export type TabLinkProps = { href: string; children: ReactNode; className?: string; "aria-current"?: "page" };

export interface TabItem {
	href: string;
	label: string;
	/** Compteur affiché en exposant (facultatif). */
	count?: number | null;
}

const nf = new Intl.NumberFormat("fr-FR");

export function TabNav({
	items,
	active,
	ariaLabel = "Onglets",
	className = "",
    linkComponent: LinkComponent = "a",
}: {
	items: readonly TabItem[];
	/** `href` de l'onglet courant. */
	active: string;
	ariaLabel?: string;
	className?: string;
    linkComponent?: ComponentType<TabLinkProps> | "a";
}) {
	return (
		<nav
			aria-label={ariaLabel}
			className={`-mx-[var(--shell-pad,1.5rem)] overflow-x-auto px-[var(--shell-pad,1.5rem)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
		>
			<ul className="flex min-w-max snap-x items-center gap-2">
				{items.map((item) => {
					const current = item.href === active;
					return (
						<li key={item.href} className="snap-start">
							<LinkComponent
								href={item.href}
								aria-current={current ? "page" : undefined}
								className={[
									"inline-flex min-h-11 items-center gap-2 border-2 px-4 font-display text-[0.75rem] font-bold uppercase tracking-[0.1em] transition-colors",
									"shadow-[3px_3px_0px_#000]",
									current
										? "border-black bg-dbz-orange text-black"
										: "border-white/20 bg-white/[0.06] text-white/75 hover:border-white/40 hover:text-white",
								].join(" ")}
							>
								{item.label}
								{typeof item.count === "number" && (
									<span className={current ? "text-black/60" : "text-white/40"}>
										{nf.format(item.count)}
									</span>
								)}
							</LinkComponent>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
