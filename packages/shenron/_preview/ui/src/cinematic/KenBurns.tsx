import type { CSSProperties } from "react";

/**
 * Backdrop animé « Ken Burns » — image plein cadre qui zoome/pan lentement,
 * recouverte d'un gradient + vignette + grain pour un rendu cinématographique
 * fidèle aux épisodes. Pur CSS, zéro JS, server-component friendly.
 *
 * On utilise un `<img>` brut (pas next/image) : c'est un fond décoratif issu
 * de l'API bot (assetUrl), masqué par l'overlay, donc l'optimisation next/image
 * (et sa config de domaines distants) est superflue.
 */
export function KenBurns({
	src,
	alt = "",
	variant = "default",
	overlay = "bottom",
	blur = false,
	grain = true,
	className = "",
	style,
}: {
	src: string;
	alt?: string;
	/** rythme/origine du mouvement — varie pour casser la répétition entre pages */
	variant?: "default" | "slow" | "rev";
	/** type de dégradé d'assombrissement posé sur l'image */
	overlay?: "bottom" | "full" | "sides" | "none";
	/** flou de fond (backdrop héro derrière un contenu net) */
	blur?: boolean;
	grain?: boolean;
	className?: string;
	style?: CSSProperties;
}) {
	const kb =
		variant === "slow"
			? "ken-burns ken-burns-slow"
			: variant === "rev"
				? "ken-burns ken-burns-rev"
				: "ken-burns";

	const overlayClass =
		overlay === "full"
			? "bg-gradient-to-t from-black via-black/70 to-black/40"
			: overlay === "bottom"
				? "bg-gradient-to-t from-black via-black/55 to-transparent"
				: overlay === "sides"
					? "bg-gradient-to-r from-black/85 via-black/30 to-black/70"
					: "";

	return (
		<div
			className={`absolute inset-0 overflow-hidden pointer-events-none vignette ${grain ? "film-grain" : ""} ${className}`}
			aria-hidden={alt ? undefined : true}
			style={style}
		>
			<img
				src={src}
				alt={alt}
				className={`h-full w-full object-cover ${kb} ${blur ? "blur-2xl scale-110" : ""}`}
				loading="eager"
				decoding="async"
			/>
			{overlayClass && <div className={`absolute inset-0 ${overlayClass}`} />}
		</div>
	);
}

/**
 * Nappe d'aurora ki ondulante — fond animé pur CSS, à poser en absolute derrière
 * une section. Complète le starfield global avec une couche d'énergie colorée.
 */
export function Aurora({ className = "" }: { className?: string }) {
	return (
		<div
			aria-hidden
			className={`absolute inset-0 -z-0 overflow-hidden pointer-events-none ${className}`}
		>
			<div className="aurora absolute inset-[-20%]" />
		</div>
	);
}
