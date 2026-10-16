import { cn } from "@rosegriffon/ui";
import Link from "next/link";

import { type Campagne, etatCampagne, libelleEtatCampagne } from "@/lib/x-campagnes/types";

/*
 * Sélecteur de campagne — composant SERVEUR, volontairement sans JavaScript :
 * ce sont de vrais liens `?campagne=<slug>`. Chaque campagne a donc une URL
 * partageable, le bouton « précédent » du navigateur fonctionne, et la page
 * reste utilisable sans hydratation.
 *
 * `page=1` n'est pas conservé : changer de campagne repart forcément du début.
 */
export function SelecteurCampagne({
	campagnes,
	slugActif,
}: {
	campagnes: Campagne[];
	slugActif: string;
}) {
	if (campagnes.length < 2) {
		return null;
	}

	return (
		<nav aria-label="Choisir une campagne">
			<ul className="flex list-none flex-wrap gap-2 p-0">
				{campagnes.map((campagne) => {
					const actif = campagne.slug === slugActif;
					return (
						<li key={campagne.slug}>
							<Link
								href={campagne.principale ? "/iergday" : `/iergday?campagne=${campagne.slug}`}
								aria-current={actif ? "page" : undefined}
								className={cn(
									"inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-bold transition-colors",
									actif
										? "border-rg-or/60 bg-primary text-on-primary"
										: "border-outline-variant/50 bg-surface-container-low text-on-surface-variant hover:border-primary/50 hover:bg-surface-container"
								)}
							>
								{campagne.titre}
								<span
									className={cn(
										"rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
										actif ? "bg-on-primary/20" : "bg-surface-container-high"
									)}
								>
									{libelleEtatCampagne(etatCampagne(campagne))}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
