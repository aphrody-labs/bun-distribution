// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LOCALES_INFO, SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/i18n";
import { useLangue } from "@/lib/i18n/client";
import { ChevronBas } from "@/components/icones";

/**
 * Le code affiché dans le bouton. `ja` se dit « JP » pour un lecteur français,
 * mais l'attribut de langue reste `ja` : c'est la norme, pas le drapeau.
 *
 * Les drapeaux ont disparu : un drapeau n'est pas une langue (le français n'est
 * pas la France), et surtout le bouton affichait « 🇫🇷 FR » — la même
 * information deux fois, ce que l'œil lit comme « FR FR ».
 */
const CODE_AFFICHE = (code: SupportedLocale) => (code === "ja" ? "JP" : code.toUpperCase());

export function LanguageSwitcher({
	variant = "default",
	drop = "down",
}: {
	variant?: "default" | "compact";
	/** `up` for the last line of the page: a panel below it would fall off. */
	drop?: "down" | "up";
}) {
	const [open, setOpen] = useState(false);
	const { locale, dico, changerLangue: appliquer } = useLangue();
	const ref = useRef<HTMLDivElement | null>(null);
	const boutonRef = useRef<HTMLButtonElement | null>(null);
	const menuId = useId();

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setOpen(false);
			// Le panneau disparaît avec l'élément qui portait le focus : sans ce
			// retour sur le déclencheur, le focus repart de `<body>`.
			if (ref.current?.contains(document.activeElement)) boutonRef.current?.focus();
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const changerLangue = (code: SupportedLocale) => {
		setOpen(false);
		if (code === locale) return;
		// Aucun rechargement de page : les libellés d'interface viennent du
		// contexte, ils basculent au rendu suivant. Repartir du serveur ne changeait
		// rien de plus — il rend toujours le même HTML — et faisait perdre sa place
		// au lecteur.
		appliquer(code);
	};

	const current = LOCALES_INFO[locale];

	return (
		<div ref={ref} className="relative select-none">
			<button
				ref={boutonRef}
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-controls={menuId}
				aria-label={`${dico.common.language} : ${current.name}`}
				className="group flex items-center gap-1.5 h-10 px-3 rounded-xl border-2 border-[var(--color-toriyama-ink,#121417)] bg-white/[0.05] hover:bg-white/[0.12] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] text-xs font-semibold text-white/80 transition-all hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
			>
				<span className="font-mono text-[11px] font-black uppercase tracking-wider text-white/90 group-hover:text-dbz-orange transition-colors">
					{CODE_AFFICHE(current.code)}
				</span>
				{variant === "default" && (
					<ChevronBas
						className={`h-3 w-3 text-white/50 transition-transform duration-200 group-hover:text-dbz-orange ${
							open ? "rotate-180 text-dbz-orange" : ""
						}`}
						aria-hidden
					/>
				)}
			</button>

			{open && (
				<div
					id={menuId}
					className={`absolute right-0 z-50 min-w-[10rem] rounded-2xl border border-white/[0.12] bg-[#0c0c10]/98 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.85)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150 ${
						drop === "up" ? "bottom-full mb-2" : "top-full mt-2"
					}`}
				>
					<div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 border-b border-white/[0.06] mb-1">
						{dico.common.language} / 言語
					</div>
					<ul className="flex flex-col gap-0.5">
						{SUPPORTED_LOCALES.map((code) => {
							const info = LOCALES_INFO[code];
							const isCurrent = code === locale;
							return (
								<li key={code}>
									<button
										type="button"
										onClick={() => changerLangue(code)}
										// La langue active n'était signalée que par la couleur : au
										// lecteur d'écran, les trois entrées se lisaient à
										// l'identique. `aria-current` la nomme sans rien changer au
										// dessin (même parti pris que le groupe d'interlocuteurs de
										// l'assistant flottant).
										aria-current={isCurrent ? "true" : undefined}
										className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-colors ${
											isCurrent
												? "bg-dbz-orange/15 text-dbz-orange font-bold"
												: "text-white/80 hover:bg-white/[0.07] hover:text-white"
										}`}
									>
										<span lang={code}>{info.nativeName}</span>
										<span className="font-mono text-[10px] font-bold uppercase tracking-wider text-white/40">
											{CODE_AFFICHE(code)}
										</span>
									</button>
								</li>
							);
						})}
					</ul>
					{/* Dire ce qui change vraiment. Le site a une doctrine : ne jamais
					    présenter comme traduit ce qui ne l'est pas. */}
					<p className="mt-1 border-t border-white/[0.06] px-3 py-2 text-[10px] leading-relaxed text-white/35">
						{dico.common.uiOnly}
					</p>
				</div>
			)}
		</div>
	);
}
