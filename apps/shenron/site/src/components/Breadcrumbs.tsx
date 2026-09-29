import type { ReactNode } from "react";
import Link from "next/link";
import type { BreadcrumbList, WithContext } from "schema-dts";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL } from "@/lib/config";
import { isPathPublic } from "@/lib/wiki-launch";
import { getLaunchConfig } from "@/lib/wiki-launch-config";

/**
 * Fil d'Ariane — UI **et** `BreadcrumbList` JSON-LD dans le même composant.
 *
 * Les deux vont ensemble par construction : Google n'affiche le fil d'Ariane
 * dans ses résultats que si le balisage décrit un chemin réellement présent sur
 * la page. Les avoir séparés (ce qui était le cas : 3 pages balisées, zéro fil
 * visible nulle part) garantissait de perdre le rich result et de laisser
 * l'utilisateur sans repère de profondeur dans une arborescence à 4 niveaux.
 *
 * « Accueil » est ajouté d'office : `items` ne décrit que le chemin SOUS la
 * racine. Le dernier élément est la page courante — il n'est jamais un lien
 * (règle schema.org ET bon sens UX : on ne se lie pas à soi-même).
 */
/**
 * `label` est la chaîne de RÉFÉRENCE : elle part dans le `BreadcrumbList`
 * JSON-LD, qui s'indexe et ne se traduit donc pas côté client. `display` est ce
 * que le lecteur voit — un `<T>` quand le maillon a une clé de dictionnaire.
 */
export type Crumb = { label: string; display?: ReactNode; href?: string };

export async function Breadcrumbs({
	items,
	className = "",
}: {
	items: Crumb[];
	/** Classes du `<nav>` (marges). */
	className?: string;
}) {
	// Un maillon qui pointe une rubrique refermée depuis /admin/lancement est une
	// impasse — et, balisé en `BreadcrumbList`, une impasse **annoncée à Google**.
	// On garde le maillon (le chemin reste lisible) mais on retire sa cible : il
	// devient un simple repère, exactement comme la page courante.
	const cfg = await getLaunchConfig().catch(() => null);
	const brut: Crumb[] = [{ label: "Accueil", href: "/" }, ...items];
	const trail: Crumb[] = brut.map((c) =>
		c.href && cfg && !isPathPublic(c.href, cfg) ? { label: c.label } : c
	);

	const schema: WithContext<BreadcrumbList> = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: trail.map((c, i) => ({
			"@type": "ListItem" as const,
			position: i + 1,
			name: c.label,
			// `item` seulement quand il y a une cible : un ListItem final sans URL
			// est la forme recommandée pour la page courante.
			...(c.href ? { item: `${SITE_URL}${c.href}` } : {}),
		})),
	};

	return (
		<>
			<JsonLd data={schema} />
			<nav aria-label="Fil d'Ariane" className={className}>
				<ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] tracking-[0.02em] text-white/50">
					{trail.map((c, i) => {
						const last = i === trail.length - 1;
						return (
							// `min-w-0` + `break-words` : un maillon long (titre de databook de
							// 55 caractères) constitue un élément flex à largeur `max-content`.
							// Sans ça il déborde la fenêtre au lieu de passer à la ligne — mesuré
							// sur mobile 390 px : `scrollWidth` 461 px, donc toute la page
							// défilait horizontalement et la couverture sortait de l'écran.
							<li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-x-2">
								{i > 0 && (
									<span aria-hidden className="text-white/20">
										/
									</span>
								)}
								{c.href && !last ? (
									<Link
										href={c.href}
										// Remonter le fil, c'est toujours une navigation « retour » :
										// on demande le slide directionnel inverse des View
										// Transitions (cf. `nav-back` dans globals.css).
										transitionTypes={["nav-back"]}
										className="min-w-0 break-words rounded-sm transition-colors hover:text-dbz-orange"
									>
										{c.display ?? c.label}
									</Link>
								) : (
									<span
										className={`min-w-0 break-words ${last ? "text-white/70" : ""}`}
										aria-current={last ? "page" : undefined}
									>
										{c.display ?? c.label}
									</span>
								)}
							</li>
						);
					})}
				</ol>
			</nav>
		</>
	);
}
