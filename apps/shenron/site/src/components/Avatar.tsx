"use client";

/**
 * Avatar — image de profil avec repli, pour tout ce qui est public.
 *
 * Les composants géraient l'avatar ABSENT (`avatar && <img>`), jamais l'avatar
 * qui répond 404 : une URL `cdn.discordapp.com/avatars/<id>/<hash>` devient
 * invalide dès que la personne change d'image, et le navigateur affichait alors
 * son icône d'image brisée au milieu d'une liste de commentaires ou du
 * classement de la home.
 *
 * Chaîne de repli, chaque étape tentée UNE fois (aucune boucle possible) :
 *   1. `src` ;
 *   2. l'avatar Discord par défaut du membre (`embed/avatars/<n>.png`), quand
 *      l'identifiant est connu — passé en `userId`, ou lu dans l'URL Discord
 *      elle-même, qui le contient ;
 *   3. `fallback`, ou à défaut une silhouette neutre.
 *
 * Le repli final est une silhouette, pas une initiale dans un rond coloré :
 * DESIGN.md l'interdit, et une lettre n'identifie personne dans une liste où
 * plusieurs pseudos commencent pareil.
 */
import { useState, type ReactNode } from "react";
import { discordDefaultAvatarUrl, discordUserIdFromAvatarUrl } from "@/lib/discord-avatar";
import { cn } from "@/lib/utils";

export function Avatar({
	src,
	alt = "",
	size = 28,
	className = "",
	userId,
	fluid = false,
	priority = false,
	fallback,
}: {
	src?: string | null;
	/** Laisser vide quand le nom est déjà écrit à côté (évite la redite au lecteur d'écran). */
	alt?: string;
	/** Côté en pixels. En mode `fluid`, ne fixe que les attributs intrinsèques `width`/`height`. */
	size?: number;
	className?: string;
	/** Identifiant Discord (snowflake) : active le repli sur l'avatar Discord par défaut. */
	userId?: string | null;
	/** La taille vient de `className` (`h-full w-full`, tailles responsives) au lieu de `size`. */
	fluid?: boolean;
	/** Image au-dessus de la ligne de flottaison (LCP) : chargement immédiat et prioritaire. */
	priority?: boolean;
	/** Remplace la silhouette quand aucune image n'est affichable. */
	fallback?: ReactNode;
}) {
	const primary = src?.trim() || null;
	const discordDefault = discordDefaultAvatarUrl(userId ?? discordUserIdFromAvatarUrl(primary));
	// URLs déjà tombées en erreur. Une URL nouvelle (autre `src`) n'y figure pas
	// et retente donc sa chance ; une URL morte n'est jamais redemandée.
	const [failed, setFailed] = useState<readonly string[]>([]);
	const current =
		[primary, discordDefault].find((url): url is string => !!url && !failed.includes(url)) ?? null;

	// Idempotent : une URL déjà notée rend l'état inchangé, donc aucun rendu.
	const markFailed = (url: string) =>
		setFailed((prev) => (prev.includes(url) ? prev : [...prev, url]));

	// Rendue côté serveur, l'image peut échouer AVANT l'hydratation : React n'a
	// alors pas encore branché `onError`, et l'événement est perdu. Une image
	// terminée sans largeur intrinsèque est une image en échec.
	const detectEarlyError = (img: HTMLImageElement | null) => {
		if (img && current && img.complete && img.naturalWidth === 0) markFailed(current);
	};

	const base = cn(
		"shrink-0 rounded-full object-cover",
		fluid ? "h-full w-full" : undefined,
		className
	);
	const style = fluid ? undefined : { width: size, height: size };

	if (!current) {
		if (fallback) return <>{fallback}</>;
		return (
			<span
				className={cn("grid place-items-center bg-white/[0.07] text-white/35", base)}
				style={style}
				// `alt` vide est le cas NORMAL ici — le pseudo est presque toujours
				// écrit juste à côté. Or `role="img"` sans intitulé est une image sans
				// alternative : le lecteur d'écran annonce « graphique » sans rien
				// pouvoir en dire, une fois par ligne de classement ou de commentaire.
				// Sans nom, la silhouette est donc purement décorative et se retire.
				{...(alt ? { role: "img" as const, "aria-label": alt } : { "aria-hidden": true as const })}
			>
				<svg
					viewBox="0 0 24 24"
					width={fluid ? "58%" : Math.round(size * 0.58)}
					height={fluid ? "58%" : Math.round(size * 0.58)}
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
					aria-hidden
				>
					<circle cx="12" cy="8.5" r="3.6" />
					<path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
				</svg>
			</span>
		);
	}

	return (
		<img
			// `key` : une nouvelle URL est un nouvel élément, dont l'état `complete`
			// ne peut pas être celui de l'image précédente.
			key={current}
			ref={detectEarlyError}
			src={current}
			alt={alt}
			width={size}
			height={size}
			loading={priority ? "eager" : "lazy"}
			fetchPriority={priority ? "high" : undefined}
			decoding="async"
			onError={() => markFailed(current)}
			className={base}
			style={style}
		/>
	);
}
