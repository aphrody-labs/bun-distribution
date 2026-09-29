import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { isPathPublic } from "@/lib/wiki-launch";

/**
 * Lien qui **refuse de mener à une impasse**.
 *
 * Le site ouvre ses rubriques une par une (`/admin/lancement`), et le proxy
 * redirige tout accès anonyme à une rubrique fermée vers `/wiki-bientot`. Les
 * pages publiques, elles, continuaient d'émettre les liens comme si tout était
 * ouvert : au 2026-08-21, `/wiki/sagas` publiait à lui seul **65 liens vers
 * `/wiki/arcs/*`**, tous soldés par un 307 — un mur de redirections pour le
 * visiteur comme pour le crawler.
 *
 * Ici, une cible fermée se rend en texte inerte avec une pastille « bientôt » :
 * l'information reste visible (le personnage existe, il est nommé), seule la
 * navigation est retirée. C'est la même fonction `isPathPublic` qui alimente le
 * sitemap — impossible de promettre une URL qu'on n'ouvre pas.
 *
 * Composant **serveur** : `getLaunchConfig()` a un cache module de 30 s, donc
 * aucun aller-retour PG supplémentaire dans un rendu. Depuis un composant
 * client, résoudre l'état côté serveur et le passer en props.
 */
export async function GatedLink({
	href,
	children,
	className = "",
	closedClassName,
	title,
}: {
	href: string;
	children: ReactNode;
	className?: string;
	/** Classes appliquées quand la cible est fermée (défaut : `className` atténué). */
	closedClassName?: string;
	title?: string;
}) {
	const cfg = await getLaunchConfig().catch(() => null);
	// Config illisible → on laisse le lien. Mieux vaut un lien qui redirige qu'un
	// site entier qui se fige en texte mort parce que PostgreSQL a hoqueté.
	const open = cfg ? isPathPublic(href, cfg) : true;

	if (open) {
		return (
			<Link href={href} className={className} title={title}>
				{children}
			</Link>
		);
	}

	return (
		<span
			className={closedClassName ?? `${className} cursor-default opacity-60`}
			title="Cette section n'est pas ouverte"
			aria-disabled="true"
		>
			{children}
			<span className="ml-1.5 align-middle rounded-full border border-white/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-white/50">
				fermée
			</span>
		</span>
	);
}

/**
 * Variante sans décoration : rend les enfants tels quels si la cible est fermée.
 * Pour les cas où la pastille casserait la mise en page (vignette, carte pleine).
 */
export async function GatedWrap({
	href,
	children,
	className = "",
	style,
	title,
}: {
	href: string;
	children: ReactNode;
	className?: string;
	/** Styles en ligne des cartes (délai d'animation en cascade, notamment). */
	style?: CSSProperties;
	title?: string;
}) {
	const cfg = await getLaunchConfig().catch(() => null);
	const open = cfg ? isPathPublic(href, cfg) : true;
	if (open) {
		return (
			<Link href={href} className={className} style={style} title={title}>
				{children}
			</Link>
		);
	}
	// Même raison que dans `ClientGatedWrap` : une carte inerte doit DIRE qu'elle
	// est inerte, sinon le clic sans effet passe pour un bug.
	return (
		<div
			className={`${className} relative cursor-not-allowed opacity-70`}
			style={style}
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
