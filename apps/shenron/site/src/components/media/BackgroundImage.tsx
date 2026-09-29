/**
 * BackgroundImage / HeroBackground — fonds de sections wiki (personnages, sagas).
 *
 * Stratégie : 100 % natif, zéro lib JS d'animation.
 *   - image plein cadre `next/image fill` (responsive `sizes`, lazy par défaut,
 *     `priority` pour un hero LCP) servie directe depuis bot.dragonballfr.com
 *     (optimisée AVIF/WebP, sauf téléversement admin — cf. lib/images.ts) ;
 *   - effet subtil au choix via CSS pur :
 *       • `kenburns`  → zoom/pan lent (classe `.ken-burns` du design system) ;
 *       • `parallax`  → scroll-driven `view-timeline` scopé (`.bg-parallax-*`,
 *                       cf. globals.css), progressive enhancement ;
 *       • `fixed`     → `background-attachment: fixed` simulé (image figée) ;
 *       • `none`      → statique.
 *   - overlay/gradient optionnel pour la lisibilité du contenu superposé ;
 *   - `prefers-reduced-motion` respecté (les classes CSS neutralisent l'anim).
 *
 * RSC-safe : ce composant est un Server Component (aucun hook, aucun `window`).
 * Il peut donc être rendu dans un layout/page serveur sans `"use client"`.
 *
 * Usage :
 * ```tsx
 * import { BackgroundImage } from "@/components/media/BackgroundImage";
 * import { assetUrl } from "@/lib/assets";
 *
 * <section className="relative h-[60vh]">
 *   <BackgroundImage
 *     src={assetUrl("assets/characters/goku/hero.jpg")}
 *     alt="Goku Super Saiyan"
 *     variant="kenburns"
 *     overlay="bottom"
 *     priority
 *   />
 *   <div className="relative z-10 …">…contenu…</div>
 * </section>
 * ```
 */

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { isEditableAsset } from "@/lib/images";

type BackgroundVariant = "none" | "kenburns" | "parallax" | "fixed";
type BackgroundOverlay = "none" | "bottom" | "full" | "sides" | "top";

export interface BackgroundImageProps {
	/** URL absolue (assetUrl("assets/...")) ou same-origin. */
	src: string;
	/** Alt a11y. Vide = décoratif (aria-hidden). */
	alt?: string;
	/** Effet de mouvement (défaut: "kenburns"). */
	variant?: BackgroundVariant;
	/** Dégradé d'assombrissement posé sur l'image (défaut: "bottom"). */
	overlay?: BackgroundOverlay;
	/** Ajoute grain + vignette ciné (défaut: true). */
	grain?: boolean;
	/** Floute le fond (héro net par-dessus) (défaut: false). */
	blur?: boolean;
	/** Hero LCP : passe `priority` + `loading=eager` à next/image (défaut: false). */
	priority?: boolean;
	/** `sizes` next/image (défaut: "100vw"). */
	sizes?: string;
	/** Contenu superposé (rendu au-dessus de l'overlay, z-10). */
	children?: ReactNode;
	className?: string;
	style?: CSSProperties;
}

const OVERLAY_CLASS: Record<BackgroundOverlay, string> = {
	none: "",
	bottom: "bg-gradient-to-t from-black via-black/55 to-transparent",
	full: "bg-gradient-to-t from-black via-black/70 to-black/40",
	sides: "bg-gradient-to-r from-black/85 via-black/30 to-black/70",
	top: "bg-gradient-to-b from-black/80 via-black/20 to-transparent",
};

export function BackgroundImage({
	src,
	alt = "",
	variant = "kenburns",
	overlay = "bottom",
	grain = true,
	blur = false,
	priority = false,
	sizes = "100vw",
	children,
	className = "",
	style,
}: BackgroundImageProps) {
	const isParallax = variant === "parallax";
	const isFixed = variant === "fixed";

	// Classe d'animation appliquée à la couche image.
	const motionClass = variant === "kenburns" ? "ken-burns" : isParallax ? "bg-parallax-layer" : "";

	const overlayClass = OVERLAY_CLASS[overlay];

	return (
		<div
			className={`absolute inset-0 overflow-hidden ${grain ? "film-grain vignette" : ""} ${
				isParallax ? "bg-parallax-host" : ""
			} ${className}`}
			// `aria-hidden` seulement quand la couche est VRAIMENT décorative. Posé sur
			// le seul critère de `alt`, il masquait aussi tout `children` superposé :
			// l'API en accepte (cf. `BackgroundImageProps.children`), et un appelant qui
			// aurait mis son titre là l'aurait rendu muet aux lecteurs d'écran sans le
			// voir. Aucun point d'appel actuel n'en passe — `HeroBackground` rend les
			// siens à côté du fond, pas dedans — donc c'est une garde, pas un correctif.
			aria-hidden={!alt && !children ? true : undefined}
			style={style}
		>
			<Image
				src={src}
				alt={alt}
				fill
				priority={priority}
				loading={priority ? "eager" : "lazy"}
				sizes={sizes}
				quality={70}
				// Bannière téléversée depuis l'admin : servie telle quelle pour rester
				// fraîche dès le remplacement (cf. lib/images.ts).
				unoptimized={isEditableAsset(src)}
				className={`object-cover object-center ${motionClass} ${blur ? "scale-110 blur-2xl" : ""}`}
				style={
					// `fixed` : on simule le background-attachment via une couche figée
					// (background-attachment: fixed est buggé sur mobile/Safari).
					isFixed ? { transform: "scale(1.05)" } : undefined
				}
			/>

			{overlayClass && <div className={`pointer-events-none absolute inset-0 ${overlayClass}`} />}

			{children && <div className="relative z-10 h-full">{children}</div>}
		</div>
	);
}

/**
 * HeroBackground — variante préconfigurée pour les hero de page : conteneur
 * `relative` de hauteur fixe + BackgroundImage en `priority` + zone de contenu
 * alignée en bas. Évite de réécrire le boilerplate `relative`/`z-10` partout.
 *
 * ```tsx
 * <HeroBackground src={assetUrl("assets/sagas/cell.jpg")} alt="Saga Cell" height="lg">
 *   <h1 className="font-display text-5xl text-white">Saga Cell</h1>
 * </HeroBackground>
 * ```
 */
function HeroBackground({
	src,
	alt = "",
	variant = "kenburns",
	overlay = "bottom",
	height = "md",
	children,
	className = "",
}: Pick<BackgroundImageProps, "src" | "alt" | "variant" | "overlay"> & {
	height?: "sm" | "md" | "lg" | "screen";
	children?: ReactNode;
	className?: string;
}) {
	const h =
		height === "sm"
			? "h-[300px]"
			: height === "lg"
				? "h-[520px]"
				: height === "screen"
					? "h-[80vh]"
					: "h-[420px]";

	return (
		<section
			className={`relative w-full overflow-hidden border-b border-white/[0.08] ${h} ${className}`}
		>
			<BackgroundImage src={src} alt={alt} variant={variant} overlay={overlay} priority />
			{children && (
				<div className="relative z-10 mx-auto flex h-full max-w-[1280px] items-end px-6 pb-14 lg:px-10">
					<div className="reveal-up max-w-2xl flex-1">{children}</div>
				</div>
			)}
		</section>
	);
}
