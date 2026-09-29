"use client";

import { useCallback, useRef, useState, type ImgHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/use-focus-trap";

/**
 * Image de contenu wiki cliquable → ouvre une lightbox plein écran (zoom).
 * Rendue à la place du <img> par WikiMarkdown, donc le src arrive déjà résolu
 * (CDN bot) — on ne re-passe PAS par assetUrl ici.
 *
 * Portail sur <body> : les panneaux `.reveal-up`/`.dbz-panel` posent un
 * `transform`/`animation` qui établirait un bloc conteneur et casserait un
 * `position: fixed`. Le portail garantit un overlay vraiment plein écran.
 */
export function ZoomableImage({
	src,
	alt,
	className,
	...rest
}: ImgHTMLAttributes<HTMLImageElement>) {
	const [open, setOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);

	// Échap, verrou du scroll, piège de focus et restitution du focus au
	// déclencheur : le même hook que la modale de filtres, plutôt qu'une seconde
	// implémentation partielle. Elle l'était : Tab sortait de la lightbox pour
	// parcourir la page cachée dessous, et refermer laissait le focus nulle part.
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap(panelRef, open, close);

	const label = typeof alt === "string" && alt ? alt : "Image agrandie";

	return (
		<>
			{/* biome-ignore lint/a11y/useAltText: alt forwardé depuis le markdown */}
			{/* L'image EST un bouton : sans `role`/`tabIndex`/clavier, l'agrandissement
			    n'existait qu'à la souris — la tabulation sautait l'image et Entrée ne
			    faisait rien. */}
			<img
				{...rest}
				src={src}
				alt={alt ?? ""}
				loading="lazy"
				role="button"
				tabIndex={0}
				aria-haspopup="dialog"
				onClick={() => setOpen(true)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setOpen(true);
					}
				}}
				className={`wiki-zoomable${className ? ` ${className}` : ""}`}
			/>
			{open &&
				typeof document !== "undefined" &&
				createPortal(
					// biome-ignore lint/a11y/noStaticElementInteractions: overlay fermable au clic
					// biome-ignore lint/a11y/useKeyWithClickEvents: Échap géré globalement (useEffect)
					<div
						ref={panelRef}
						tabIndex={-1}
						className="wiki-lightbox"
						role="dialog"
						aria-modal="true"
						aria-label={label}
						onClick={close}
					>
						<button
							type="button"
							className="wiki-lightbox__close"
							aria-label="Fermer"
							onClick={close}
						>
							×
						</button>
						{/* biome-ignore lint/a11y/useAltText: décoratif, déjà annoncé par le dialog */}
						<img src={src} alt={alt ?? ""} className="wiki-lightbox__img" />
						{typeof alt === "string" && alt ? (
							<span className="wiki-lightbox__cap">{alt}</span>
						) : null}
					</div>,
					document.body
				)}
		</>
	);
}
