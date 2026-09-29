"use client";

/**
 * Méga-menu de navigation — une famille de rubriques par panneau.
 *
 * Remplace, pour le desktop, la liste plate « 4 liens en ligne + tout le reste
 * dans Plus » : avec 13 rubriques publiques, ce menu fourre-tout ne disait plus
 * ce que le site contient. Ici chaque entrée porte son libellé, sa phrase de
 * situation et, quand elle est mesurée, son volume — c'est ce qui donne envie
 * d'ouvrir « Techniques » plutôt que de repartir sur la recherche.
 *
 * Le contenu vient du registre (`lib/wiki-launch`), déjà filtré sur l'accès
 * réel côté serveur : rien à maintenir ici quand une rubrique s'ouvre.
 */
import { ChevronBas, DragonRadar, Tv, PlancheManga, Kame, Manga } from "../icones";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { UiLinkComponent } from "./link";

export type NavMegaIcon = "wiki" | "tv" | "archives" | "manga" | "communaute";

const ICONS: Record<NavMegaIcon, React.ComponentType<{ size?: number | string; className?: string; decorative?: boolean }>> = {
	// Icons that belong to the series, not to a generic admin kit: the Dragon
	// Radar finds things (wiki), the tankōbon page reads (manga), the Kame
	// crest gathers disciples (community).
	wiki: DragonRadar,
	tv: Tv,
	archives: Manga,
	manga: PlancheManga,
	communaute: Kame,
};

export type MegaItem = {
	href: string;
	label: string;
	blurb?: string;
	/** Volume mesuré en base (fiches visibles). Jamais écrit en dur. */
	count?: number;
};

const nf = new Intl.NumberFormat("fr-FR");

export function NavMega({
	label,
	items,
	linkClass,
	icon,
	linkComponent: Link = "a",
}: {
	label: string;
	items: MegaItem[];
	linkClass: string;
	icon?: NavMegaIcon | ReactNode;
	linkComponent?: UiLinkComponent;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);
	const boutonRef = useRef<HTMLButtonElement | null>(null);
	const panelId = useId();
	// Fermeture différée : traverser les quelques pixels entre le bouton et le
	// panneau ne doit pas refermer le menu (le pointeur quitte le bouton avant
	// d'entrer dans le panneau).
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	/**
	 * Le focus est-il posé DANS LE PANNEAU (et pas sur le déclencheur) ?
	 *
	 * La nuance n'est pas cosmétique : refermer efface le panneau, donc l'élément
	 * qui y portait le focus, qui retombe sur `<body>`. Le déclencheur, lui,
	 * survit à la fermeture — le garder ouvert parce qu'il a le focus laisserait
	 * le méga-panneau posé sur la page dès qu'on a cliqué dessus (le clic focalise
	 * le bouton) puis éloigné le pointeur.
	 */
	const focusDansLePanneau = () => {
		const actif = document.activeElement;
		return !!actif && actif !== boutonRef.current && !!ref.current?.contains(actif);
	};

	const ouvrir = () => {
		if (timer.current) clearTimeout(timer.current);
		setOpen(true);
	};
	const fermerBientot = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			// Le pointeur peut sortir alors que le CLAVIER est resté dans le
			// panneau : refermer effacerait l'élément qui a le focus, et le focus
			// retomberait sur `<body>` — la tabulation repartirait du haut de la
			// page. Tant que le focus est dans le PANNEAU, le menu reste ouvert.
			if (focusDansLePanneau()) return;
			setOpen(false);
		}, 120);
	};

	/**
	 * Contrepartie de la règle ci-dessus : quand le focus quitte le panneau à la
	 * tabulation, plus aucun pointeur ne viendra le refermer. On ne referme que
	 * si le focus part vers un élément identifié hors du menu — `relatedTarget`
	 * vide signifie « clic sur une zone non focalisable », que le pointeur gère
	 * déjà, et refermer là-dessus ferait disparaître le panneau sous le curseur.
	 */
	const auFocusSortant = (e: React.FocusEvent<HTMLDivElement>) => {
		const suivant = e.relatedTarget as Node | null;
		if (!suivant) return;
		if (!ref.current?.contains(suivant)) setOpen(false);
	};

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			setOpen(false);
			// Échap referme : le focus doit revenir sur le déclencheur, jamais
			// disparaître avec le panneau qu'on vient de démonter.
			if (ref.current?.contains(document.activeElement)) boutonRef.current?.focus();
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

	if (items.length === 0) return null;

	const estLarge = items.length > 4;

	return (
		<div
			ref={ref}
			className="relative"
			onPointerEnter={ouvrir}
			onPointerLeave={fermerBientot}
			onBlur={auFocusSortant}
		>
			<button
				ref={boutonRef}
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-controls={panelId}
				// Pas d'`aria-haspopup` : le panneau est une LISTE DE LIENS, pas un
				// menu d'application. `aria-haspopup="true"` promet aux lecteurs
				// d'écran un menu piloté aux flèches, que rien ici n'implémente —
				// `aria-expanded` + `aria-controls` décrivent exactement ce qui existe.
				className={`${linkClass} inline-flex items-center gap-2 transition-all duration-200 ${
					open
						? "text-dbz-orange bg-white/[0.08] shadow-[2px_2px_0px_var(--color-toriyama-ink,#121417)] border-b-2 border-dbz-orange after:scale-x-100"
						: "hover:border-b-2 hover:border-white/30"
				}`}
			>
				{icon && (
					<span className="inline-flex items-center justify-center shrink-0 text-white/75 group-hover/lien:text-dbz-orange transition-colors">
						{typeof icon === "string" && icon in ICONS ? (
							(() => {
								const IconComp = ICONS[icon as NavMegaIcon];
								return <IconComp size={16} decorative />;
							})()
						) : (
							icon
						)}
					</span>
				)}
				<span className="font-semibold">{label}</span>
				<ChevronBas
					className={`h-3 w-3 text-white/50 transition-transform duration-250 ease-out ${
						open ? "rotate-180 text-dbz-orange" : ""
					}`}
					aria-hidden
				/>
			</button>

			{open && (
				<div
					id={panelId}
					className={`absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-xl border-2 border-[var(--color-toriyama-ink,#121417)] bg-[#0c0c10]/98 p-3.5 shadow-[4px_4px_0px_var(--color-toriyama-ink,#121417),0_12px_32px_rgba(0,0,0,0.8)] backdrop-blur-2xl transition-all animate-in fade-in zoom-in-95 duration-150 ${
						estLarge ? "w-[min(94vw,34rem)]" : "w-[min(92vw,22rem)]"
					}`}
				>
					{/* Trait d'encre supérieur stylisé Dragon Ball */}
					<div className="absolute -top-0.5 left-4 right-4 h-[2px] bg-gradient-to-r from-transparent via-dbz-orange to-transparent" />

					<ul className={`grid gap-1 ${estLarge ? "sm:grid-cols-2" : "grid-cols-1"}`}>
						{items.map((it) => {
							return (
							<li key={it.href}>
								<Link
									href={it.href}
									onClick={() => setOpen(false)}
									className="group flex flex-col rounded-xl px-3.5 py-2.5 transition-all duration-150 hover:bg-white/[0.06] border-l-2 border-transparent hover:border-dbz-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60"
								>
									<span className="flex items-center justify-between gap-2">
										<span className="font-display text-[14px] font-semibold tracking-tight text-white/90 transition-colors group-hover:text-dbz-orange">
											{it.label}
										</span>
										{typeof it.count === "number" && it.count > 0 && (
											<span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] tabular-nums text-white/50 transition-colors group-hover:bg-dbz-orange/15 group-hover:text-dbz-orange">
												{nf.format(it.count)}
											</span>
										)}
									</span>
									{it.blurb && (
										<span className="mt-0.5 block text-[12px] leading-snug text-white/45 transition-colors group-hover:text-white/70">
											{it.blurb}
										</span>
									)}
								</Link>
							</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}
