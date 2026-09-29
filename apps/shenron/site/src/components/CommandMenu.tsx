"use client";

/**
 * Déclencheur de la recherche globale (bouton de la nav + raccourci ⌘K).
 *
 * Volontairement minuscule : ce composant est monté par `SiteNav`, donc présent
 * sur TOUTES les pages. La palette elle-même (`CommandPalette`, avec `cmdk` et
 * ses douze groupes de résultats) est chargée à la demande — au premier survol
 * ou focus du bouton, ou à la première pression de ⌘K. Un visiteur qui ne
 * cherche jamais ne télécharge jamais ce code.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useLangue } from "@/lib/i18n/client";
import { Recherche } from "@/components/icones";

// `ssr: false` : la palette n'a rien à rendre côté serveur (elle est fermée) et
// n'existe que suite à une interaction.
const CommandPalette = dynamic(() => import("@/components/CommandPalette"), { ssr: false });

export function CommandMenu({ variant = "bar" }: { variant?: "bar" | "icon" } = {}) {
	const { dico } = useLangue();
	const [open, setOpen] = useState(false);
	// Une fois armé, le module reste monté : rouvrir est instantané.
	const [arme, setArme] = useState(false);

	const armer = useCallback(() => setArme(true), []);

	const basculer = useCallback((v: boolean | ((o: boolean) => boolean)) => {
		setArme(true);
		setOpen(v);
	}, []);

	// ⌘K / Ctrl+K — bascule globale. Vit ici pour rester actif sans charger la palette.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				basculer((o) => !o);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [basculer]);

	return (
		<>
			<button
				type="button"
				onClick={() => basculer(true)}
				onPointerEnter={armer}
				onFocus={armer}
				aria-label={`${dico.common.searchPlaceholder} (Ctrl+K)`}
				className={
					variant === "icon"
						? "grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] hover:bg-white/[0.12] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] text-white/80 hover:text-[var(--color-toriyama-orange)] transition-all hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
						: "group inline-flex items-center gap-2 h-10 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border-2 border-[var(--color-toriyama-ink,#121417)] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] text-white/70 hover:text-white transition-all hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
				}
			>
				<Recherche size={18} className="shrink-0 group-hover:text-[var(--color-toriyama-orange,#f85b1a)] transition-colors" />
				{variant === "bar" && (
					<>
						<span className="hidden xl:inline font-display text-[13px] font-semibold tracking-wide">
							{dico.common.search}
						</span>
						<kbd className="hidden xl:inline-flex items-center gap-0.5 font-mono text-[10px] font-bold text-white/60 bg-black/40 border border-white/20 rounded px-1.5 py-0.5 shadow-inner">
							⌘K
						</kbd>
					</>
				)}
			</button>

			{arme && <CommandPalette open={open} onOpenChange={setOpen} />}
		</>
	);
}
