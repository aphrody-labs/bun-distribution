"use client";

/**
 * Équivalent client de `GatedLink`/`GatedWrap`.
 *
 * `GatedLink` est un composant serveur : il lit la configuration de lancement
 * lui-même. Les grilles interactives (`CharacterGrid`, `UniverseTabs`,
 * `DatabookGrid`) sont, elles, des composants client — elles ne peuvent pas
 * faire cette lecture. Elles reçoivent donc un `AccessSnapshot` en props, résolu
 * une fois côté serveur par la page, et le passent ici.
 *
 * `isPathPublic` et `AccessSnapshot` vivent dans `lib/wiki-launch.ts`, module
 * client-safe (données pures, aucune connexion Postgres) : rien ne fuite dans le
 * bundle. Sans snapshot (`null`), on laisse le lien — mieux vaut une redirection
 * qu'une grille éteinte parce que la configuration n'a pas pu être lue.
 */
import Link from "next/link";
import type { ComponentProps } from "react";
import { isPathPublic, type AccessSnapshot } from "@/lib/wiki-launch";

/** Toutes les props de `<Link>` (dont `transitionTypes`), plus l'instantané d'accès. */
type Props = ComponentProps<typeof Link> & {
	access: AccessSnapshot | null | undefined;
	href: string;
};

export function ClientGatedWrap({ access, href, children, className = "", style, ...rest }: Props) {
	const open = access ? isPathPublic(href, access) : true;
	if (open) {
		return (
			<Link href={href} className={className} style={style} {...rest}>
				{children}
			</Link>
		);
	}
	// Les props propres à `<Link>` (préchargement, transitions de vue) n'ont plus
	// de sens sur une cible fermée : seul le libellé accessible est repris.
	//
	// La pastille n'est pas décorative. Sans elle, la carte fermée ne se
	// distinguait d'une carte ouverte que par une opacité de 0,7 et un `title`
	// — que le tactile n'affiche jamais. Le visiteur tapait, il ne se passait
	// RIEN, et rien n'expliquait pourquoi : le symptôme exact d'une interface
	// cassée. On dit donc explicitement que la rubrique n'est pas encore ouverte,
	// et le curseur le confirme au survol.
	return (
		<div
			className={`${className} relative cursor-not-allowed opacity-70`}
			style={style}
			aria-label={rest["aria-label"]}
			title="Cette section n'est pas ouverte"
			aria-disabled="true"
		>
			{children}
			<span className="pointer-events-none absolute right-1.5 top-1.5 z-40 rounded-full border border-white/20 bg-black/75 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-white/70 backdrop-blur-sm">
				fermée
			</span>
		</div>
	);
}
