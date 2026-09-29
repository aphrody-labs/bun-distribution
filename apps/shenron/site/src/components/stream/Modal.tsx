"use client";

/**
 * Modal — coquille de fenêtre « aperçu rapide » façon Netflix, montée par une
 * route d'INTERCEPTION Next.js (`@modal/(.)…`). Quand on clique une carte depuis
 * un catalogue (`/wiki/films`), Next intercepte la navigation vers la fiche et
 * rend son contenu ICI, en overlay, SANS quitter le catalogue. Un accès direct /
 * rechargement de l'URL rend la fiche pleine page (fallback `default.tsx` → null
 * pour le slot). Fermeture = `router.back()`.
 *
 * A11y : `role="dialog" aria-modal` sur le PANNEAU, focus déplacé dedans à
 * l'ouverture, **piège de focus** (Tab boucle dans la modale), focus restauré à
 * la fermeture. Esc / clic backdrop / bouton X ferment. Scroll de la page
 * verrouillé. Animations entrée/sortie via `motion` (l'exit joue AVANT le
 * `router.back()` via `onExitComplete`) ; respecte `prefers-reduced-motion`.
 */
import { type MouseEvent, type PointerEvent, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Croix } from "@/components/icones";
import { useFocusTrap } from "@/lib/use-focus-trap";

export function Modal({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const reduce = useReducedMotion();
	const [open, setOpen] = useState(true);
	const panelRef = useRef<HTMLDivElement>(null);
	// Le clic de fermeture ne compte que si le geste a COMMENCÉ sur le voile.
	// Sans ça, sélectionner le synopsis à la souris et relâcher en dehors du
	// panneau fermait la modale : le `click` est émis sur l'ancêtre commun — le
	// voile — donc `stopPropagation` sur le panneau ne l'attrape pas.
	const gesteNeSurLeVoile = useRef(false);
	const close = useCallback(() => setOpen(false), []);
	const fermerSiVoile = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (e.target === e.currentTarget && gesteNeSurLeVoile.current) close();
			gesteNeSurLeVoile.current = false;
		},
		[close]
	);

	// Déplacement du focus, piège Tab/Shift+Tab, verrou du scroll et restitution :
	// mutualisés dans `useFocusTrap` (extrait d'ici) pour que la modale de filtres
	// du wiki, qui n'en avait aucun, hérite du même comportement.
	useFocusTrap(panelRef, true, close);

	return (
		<AnimatePresence onExitComplete={() => router.back()}>
			{open && (
				<motion.div
					className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/80 p-4 backdrop-blur-sm sm:items-center sm:p-6"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: reduce ? 0 : 0.2 }}
					onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
						gesteNeSurLeVoile.current = e.target === e.currentTarget;
					}}
					onClick={fermerSiVoile}
				>
					<motion.div
						ref={panelRef}
						tabIndex={-1}
						role="dialog"
						aria-modal="true"
						aria-labelledby="stream-modal-title"
						className="relative my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-dbz-border bg-dbz-card shadow-2xl outline-none"
						initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 16 }}
						animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
						exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 12 }}
						transition={{ duration: reduce ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
						onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
					>
						<button
							type="button"
							onClick={close}
							aria-label="Fermer"
							className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur transition-colors hover:border-dbz-orange hover:bg-dbz-orange hover:text-black"
						>
							<Croix className="h-5 w-5" />
						</button>
						{children}
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
