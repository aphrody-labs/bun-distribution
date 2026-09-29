/**
 * StatTiles — la rangée de compteurs, mesurés et jamais inventés.
 *
 * Chaque valeur vient d'un `COUNT` réel : un compteur décoratif (« 10 000+
 * fiches ! ») sur un wiki encyclopédique détruit la confiance qu'on met des mois
 * à construire. Un compteur inconnu affiche « — », pas un zéro trompeur.
 *
 * Responsive : deux colonnes sur mobile — à quatre, les nombres à quatre
 * chiffres se coupaient en deux lignes sur un écran de 360 px.
 *
 * Server component.
 */
import type { ReactNode } from "react";
import type { UiLinkComponent } from "../navigation/link";

const nf = new Intl.NumberFormat("fr-FR");

export interface StatTile {
	label: ReactNode;
	value: number | null;
	/** Rend la tuile cliquable vers la rubrique correspondante. */
	href?: string;
	/** Précision sous la valeur (« cette semaine », « visibles »). */
	hint?: ReactNode;
}

export function StatTiles({
	items,
	className = "",
    linkComponent: Link = "a",
}: {
	items: readonly StatTile[];
	className?: string;
    linkComponent?: UiLinkComponent;
}) {
	if (items.length === 0) return null;
	return (
		<dl className={`grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 ${className}`}>
			{items.map((item, index) => {
				const body = (
					<>
						<dt className="font-display text-[0.625rem] font-bold uppercase tracking-[0.14em] text-white/45">
							{item.label}
						</dt>
						<dd className="mt-1.5 font-display text-[clamp(1.375rem,1.1rem+1.2vw,1.875rem)] font-bold leading-none tabular-nums text-white">
							{item.value === null ? "—" : nf.format(item.value)}
						</dd>
						{item.hint && <p className="mt-1 text-[0.6875rem] text-white/35">{item.hint}</p>}
					</>
				);
				// La clé était le libellé ; traduit, ce n'est plus une chaîne. Le
				// rang dans une liste écrite à la main l'est, lui, et il est stable.
				return item.href ? (
					<Link
						key={item.href ?? index}
						href={item.href}
						className="rounded-xl border border-white/[0.08] bg-dbz-card/80 p-3.5 transition-colors hover:border-dbz-orange/60 sm:p-4"
					>
						{body}
					</Link>
				) : (
					<div
						key={index}
						className="rounded-xl border border-white/[0.08] bg-dbz-card/80 p-3.5 sm:p-4"
					>
						{body}
					</div>
				);
			})}
		</dl>
	);
}
