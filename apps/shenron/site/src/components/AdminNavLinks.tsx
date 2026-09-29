"use client";

/**
 * Liens de navigation **réservés admin** (îlot client) : expose les sections du
 * site encore masquées au public pendant la bêta (personnages, planètes, sagas,
 * races, techniques, transformations, jeux, tierlists). Gated par `useMe().isAdmin`
 * → rendu vide côté serveur/pour le public, donc la nav (statique) reste cacheable
 * CDN/ISR. Présenté en menu déroulant compact pour ne pas déborder la barre.
 */
import Link from "next/link";
import { Rouage, ChevronBas } from "@/components/icones";
import { useEffect, useId, useRef, useState } from "react";
import { useMe } from "@/lib/use-me";
import { useLangue, useRubrique } from "@/lib/i18n/client";

export type NavLink = { href: string; label: string };

export function AdminNavLinks({ links, className = "" }: { links: NavLink[]; className?: string }) {
	const me = useMe();
	const { dico } = useLangue();
	const rubrique = useRubrique();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);
	const boutonRef = useRef<HTMLButtonElement | null>(null);
	const panneauId = useId();

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setOpen(false);
			// Sans ce retour, refermer au clavier détruit l'élément focalisé et le
			// focus retombe sur `<body>` : la tabulation repart du haut de la page.
			if (ref.current?.contains(document.activeElement)) boutonRef.current?.focus();
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	if (!me?.isAdmin || links.length === 0) return null;

	return (
		<div ref={ref} className={`relative ${className}`}>
			<button
				ref={boutonRef}
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-controls={panneauId}
				title="Administration & sections masquées (Staff)"
				className="inline-flex items-center gap-1.5 font-display font-medium text-[14px] tracking-normal text-dbz-orange/90 hover:text-dbz-orange transition-colors px-3 py-1.5 rounded-lg border border-dbz-orange/30 hover:border-dbz-orange/60 bg-dbz-orange/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60"
			>
				<Rouage className="h-3.5 w-3.5" />
				<span>{dico.nav.admin}</span>
				<ChevronBas className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
			</button>

			{open && (
				// Ni `role="menu"` ni `role="menuitem"` : ce panneau est une liste de
				// liens, et un `menu` ARIA promet une navigation aux flèches que rien
				// n'implémente ici. Le rôle interdisait en prime son propre intitulé —
				// un `<p>` n'est pas un enfant valide de `menu`, et les lecteurs
				// d'écran l'escamotaient. `aria-expanded` + `aria-controls` disent la
				// vérité sur ce qui existe (même parti pris que `NavMega`).
				<div
					id={panneauId}
					className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-lg border border-dbz-orange/20 bg-[rgba(10,10,10,0.97)] p-1.5 shadow-xl backdrop-blur-xl"
				>
					<p className="px-3 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-dbz-orange/50">
						{dico.nav.admin} · {dico.categories.modifications ? "Bêta" : "Beta"}
					</p>
					{links.map((l) => {
						const traduit = rubrique(l.href, { label: l.label });
						return (
							<Link
								key={l.href}
								href={l.href}
								onClick={() => setOpen(false)}
								className="block rounded-md px-3 py-2 font-display text-[14px] font-medium text-white/80 transition-colors hover:bg-white/[0.06] hover:text-dbz-orange"
							>
								{traduit.label}
							</Link>
						);
					})}
				</div>
			)}
		</div>
	);
}
