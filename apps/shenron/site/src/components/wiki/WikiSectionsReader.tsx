"use client";

/**
 * Sélecteur de catégories d'une fiche wiki — **2 niveaux** :
 *
 *   1. Barre du haut : « Tout » + catégories de 1er niveau (Histoire, PWS…).
 *      Les sections regroupées n'apparaissent **pas** ici — seul le nom du groupe
 *      parent est affiché (ex. « PWS »).
 *   2. Barre du bas (visible **uniquement** après clic sur un groupe parent) :
 *      sous-catégories de ce groupe (ex. Vitesse, Durabilité, Puissance d'attaque).
 *
 * Chaque `node` est rendu côté serveur (RSC) ; le filtre masque/affiche via `hidden`.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
	normalizeSectionAccent,
	type SectionAccent,
} from "@/lib/wiki-section-accents";
import { normalizeWikiSectionGroups } from "@/lib/wiki-section-groups";

;

export interface ReaderPanel {
	key: string;
	label: string;
	accent?: SectionAccent | null;
	/** Groupe parent (onglet de 1er niveau). Les enfants s'affichent en barre 2. */
	group?: string | null;
	node: ReactNode;
}

function Pill({
	active,
	accent = "orange",
	onClick,
	children,
}: {
	active: boolean;
	accent?: SectionAccent | null;
	onClick: () => void;
	children: ReactNode;
}) {
	const currentAccent = normalizeSectionAccent(accent);
	const base =
		"inline-flex min-h-11 items-center px-4 py-2 text-xs font-sans font-extrabold uppercase tracking-wider border-2 border-black rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer select-none shadow-[2.5px_2.5px_0px_#000] active:translate-x-px active:translate-y-px";

	const activeBg = currentAccent === "blue" ? "bg-blue-500 text-white" :
		currentAccent === "red" ? "bg-red-600 text-white" :
		currentAccent === "green" ? "bg-emerald-600 text-white" :
		currentAccent === "purple" ? "bg-purple-600 text-white" :
		currentAccent === "gold" ? "bg-amber-400 text-black" :
		currentAccent === "cyan" ? "bg-cyan-500 text-black" :
		currentAccent === "pink" ? "bg-pink-500 text-white" :
		"bg-dbz-orange text-black hover:bg-dbz-yellow";

	const cls = active
		? `${activeBg} border-black shadow-[3px_3px_0px_#000]`
		: "bg-[#141418] text-white/80 border-black hover:border-dbz-orange/80 hover:text-white hover:translate-x-[-0.5px] hover:translate-y-[-0.5px]";

	return (
		<button type="button" onClick={onClick} aria-pressed={active} className={`${base} ${cls}`}>
			{children}
		</button>
	);
}

export function WikiSectionsReader({
	panels,
	allLabel = "Tout",
}: {
	panels: ReaderPanel[];
	allLabel?: string;
}) {
	const [active, setActive] = useState<string>("all");
	const [subActive, setSubActive] = useState<string>("all");
	const contentRef = useRef<HTMLDivElement>(null);

	// Normalise PWS et autres regroupements (corrige les inversions label/groupe).
	const normalized = normalizeWikiSectionGroups(
		panels.map((p) => ({ ...p, label: p.label.trim(), group: p.group?.trim() || null }))
	);

	const seen = new Set<string>();
	const items = normalized.map((p) => {
		let key = p.key;
		let n = 2;
		while (seen.has(key)) key = `${p.key}-${n++}`;
		seen.add(key);
		return key === p.key ? p : Object.assign(p, { key });
	});

	useEffect(() => {
		if (items.length <= 1) return;
		const applyHash = () => {
			const hash = window.location.hash.replace(/^#/, "");
			if (!hash) return;
			// Cas spécial des sagas : si hash #saga-XX ou #sagas, s'assurer que le panneau sagas est visible
			if (hash.startsWith("saga-") || hash === "sagas") {
				const hasSagas = items.some((p) => p.key === "sagas");
				if (hasSagas && active !== "all" && active !== "sagas") {
					setActive("sagas");
				}
				return;
			}
			const matched = items.find((p) => p.key === hash);
			if (matched) {
				if (matched.group) {
					setActive(`g:${matched.group}`);
					setSubActive(matched.key);
				} else {
					setActive(matched.key);
					setSubActive("all");
				}
			}
		};

		applyHash();
		window.addEventListener("hashchange", applyHash);
		return () => window.removeEventListener("hashchange", applyHash);
	}, [items, active]);

	if (panels.length === 0) return null;
	if (items.length === 1) return <div className="space-y-12">{items[0].node}</div>;

	const groupOrder: string[] = [];
	for (const p of items) {
		const g = p.group;
		if (g && !groupOrder.includes(g)) groupOrder.push(g);
	}
	const ungrouped = items.filter((p) => !p.group);
	const groupPanels = (g: string) => items.filter((p) => p.group === g);
	const activeGroup = active.startsWith("g:") ? active.slice(2) : null;
	const activeChildren = activeGroup ? groupPanels(activeGroup) : [];

	function scrollToContent() {
		// Toujours le contenu, jamais la barre : depuis que les deux barres
		// vivent dans un même conteneur `sticky`, viser la sous-barre revenait à
		// viser un élément déjà collé en haut — le défilement ne bougeait plus.
		// `scroll-mt-52` sur le contenu réserve la hauteur de l'ensemble.
		requestAnimationFrame(() =>
			contentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
		);
	}

	function selectTop(key: string) {
		setActive(key);
		setSubActive("all");
		if (typeof window !== "undefined" && window.history?.replaceState) {
			window.history.replaceState(null, "", key === "all" ? window.location.pathname : `#${key}`);
		}
		scrollToContent();
	}

	function selectSub(key: string) {
		setSubActive(key);
		scrollToContent();
	}

	function visible(p: ReaderPanel): boolean {
		if (active === "all") return true;
		if (activeGroup) {
			if (p.group !== activeGroup) return false;
			return subActive === "all" || subActive === p.key;
		}
		return p.key === active;
	}

	return (
		<div className="space-y-6">
			{/* Les deux barres sont solidaires dans UN seul conteneur collant.
			    Auparavant chacune était `sticky` avec son propre `top` codé en dur
			    (`top-16` puis `top-[7.25rem]`), calculé pour une barre de niveau 1
			    tenant sur UNE ligne. Dès qu'elle passait à deux ou trois lignes —
			    c'est-à-dire sur presque toutes les fiches en écran étroit — la barre
			    des sous-catégories venait se poser PAR-DESSUS les catégories
			    principales, qui devenaient incliquables. */}
			<div className="sticky top-16 z-30 -mx-6 lg:-mx-10">
				{/* ── Niveau 1 : catégories principales ── */}
				<nav
					aria-label="Catégories de la fiche"
					// Fond translucide et non `bg-dbz-bg/90` : posé sur le dégradé de la
					// page, un aplat à 90 % dessinait un rectangle plus clair derrière
					// les onglets — une seconde surface qui doublait celle du contenu
					// juste dessous. Le flou seul suffit à décoller la barre.
					className="flex flex-wrap gap-2 border-b border-white/10 bg-black/40 px-6 py-3 backdrop-blur-xl lg:px-10"
				>
					<Pill active={active === "all"} onClick={() => selectTop("all")}>
						{allLabel}
					</Pill>
					{ungrouped.map((p) => (
						<Pill
							key={p.key}
							active={active === p.key}
							accent={p.accent}
							onClick={() => selectTop(p.key)}
						>
							{p.label}
						</Pill>
					))}
					{groupOrder.map((g) => (
						<Pill
							key={`g:${g}`}
							active={activeGroup === g}
							accent={groupPanels(g)[0]?.accent ?? "red"}
							onClick={() => selectTop(`g:${g}`)}
						>
							{g}
						</Pill>
					))}
				</nav>

				{/* ── Niveau 2 : sous-catégories (après clic sur un groupe parent) ── */}
				{activeGroup && activeChildren.length > 0 && (
					<nav
						aria-label={`Sous-catégories de ${activeGroup}`}
						className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-black/30 px-6 py-2.5 backdrop-blur-xl lg:px-10"
					>
						<span className="mr-1 font-scouter text-[11px] uppercase tracking-[0.14em] text-white/50">
							{activeGroup}
						</span>
						<Pill active={subActive === "all"} onClick={() => selectSub("all")}>
							Tout
						</Pill>
						{activeChildren.map((p) => (
							<Pill
								key={`sub-${p.key}`}
								active={subActive === p.key}
								accent={p.accent}
								onClick={() => selectSub(p.key)}
							>
								{p.label}
							</Pill>
						))}
					</nav>
				)}
			</div>

			<div ref={contentRef} className="space-y-12 scroll-mt-52">
				{items.map((p) => (
					<div key={p.key} hidden={!visible(p)}>
						{p.node}
					</div>
				))}
			</div>
		</div>
	);
}
