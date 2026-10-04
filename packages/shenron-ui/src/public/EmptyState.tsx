/**
 * EmptyState — ce qu'on affiche quand il n'y a rien, sans laisser le lecteur
 * dans un cul-de-sac.
 *
 * Règle tenue ici : un état vide propose TOUJOURS au moins une sortie. Une page
 * « aucun résultat » sans lien est la façon la plus sûre de perdre un visiteur,
 * et ça arrivait sur plusieurs index du wiki encore en cours de remplissage.
 *
 * Pas de décor : l'onomatopée décorative a été retirée le 2026-09-12. Un état
 * vide dit ce qui manque et où aller — le meubler d'un kanji en filigrane le fait
 * ressembler à un gabarit rempli à la va-vite.
 *
 * Server component.
 */
import type { ReactNode } from "react";
import type { UiLinkComponent } from "../navigation/link";

export interface EmptyAction {
	href: string;
	label: ReactNode;
	/** Lien sortant (Discord…) — ouvre dans un onglet et porte `rel`. */
	external?: boolean;
}

export function EmptyState({
	title,
	description,
	actions = [],
	className = "",
    linkComponent: Link = "a",
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: readonly EmptyAction[];
	className?: string;
    linkComponent?: UiLinkComponent;
}) {
	return (
		<div
			className={`rounded-xl border border-white/[0.08] bg-dbz-card/70 p-6 sm:p-10 ${className}`}
		>
			<h2 className="font-display text-[1.25rem] font-bold tracking-[-0.01em] text-white sm:text-[1.5rem]">
				{title}
			</h2>
			{description && (
				<p className="mt-3 max-w-[52ch] text-[0.9375rem] leading-relaxed text-white/60">
					{description}
				</p>
			)}
			{actions.length > 0 && (
				<div className="mt-6 flex flex-wrap gap-3">
					{actions.map((a) =>
						a.external ? (
							<a
								key={a.href}
								href={a.href}
								target="_blank"
								rel="noopener noreferrer"
								className="toriyama-btn-secondary !text-[0.75rem]"
							>
								{a.label}
							</a>
						) : (
							<Link key={a.href} href={a.href} className="toriyama-btn-secondary !text-[0.75rem]">
								{a.label}
							</Link>
						)
					)}
				</div>
			)}
		</div>
	);
}
