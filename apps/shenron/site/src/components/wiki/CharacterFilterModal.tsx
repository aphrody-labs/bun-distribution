"use client";

// Modale de filtrage avancé des personnages (/wiki/personnages). Ouverte par le
// bouton « Filtrer », elle regroupe trois facettes cumulables — Race, Techniques,
// Arcs — chacune en liste de cases à cocher cherchable. Le filtrage est LIVE
// (l'état remonte au parent CharacterGrid), cumulatif : un perso doit satisfaire
// TOUTES les catégories actives (ET entre catégories), avec un OU à l'intérieur
// d'une catégorie. Accessible : role=dialog, Échap + clic hors panneau ferment,
// scroll du body verrouillé. Zéro dépendance Radix (thème DBZ maison).
import { useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Croix, Scouter } from "@/components/icones";

export type FacetOption = { value: string; label: string; count?: number };

function norm(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.trim();
}

/** Une section de facette (titre + kanji + liste cochable cherchable). */
function FilterSection({
	title,
	kanji,
	options,
	selected,
	onChange,
}: {
	title: string;
	kanji: string;
	options: FacetOption[];
	selected: string[];
	onChange: (next: string[]) => void;
}) {
	const [q, setQ] = useState("");
	const selectedSet = useMemo(() => new Set(selected), [selected]);
	const shown = useMemo(() => {
		const n = norm(q);
		return n ? options.filter((o) => norm(o.label).includes(n)) : options;
	}, [q, options]);

	if (options.length === 0) return null;

	const toggle = (value: string) => {
		onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);
	};

	return (
		<section className="flex min-h-0 flex-col">
			<div className="mb-2 flex items-center gap-2">
				<span className="font-jp text-lg text-dbz-orange/80" aria-hidden>
					{kanji}
				</span>
				<h3 className="font-saiyan text-sm uppercase tracking-widest text-white">{title}</h3>
				{selected.length > 0 && (
					<span className="rounded-full bg-dbz-orange/20 px-2 py-0.5 text-[10px] font-bold text-dbz-orange">
						{selected.length}
					</span>
				)}
			</div>
			{options.length > 8 && (
				<input
					type="search"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder={`Filtrer ${title.toLowerCase()}…`}
					aria-label={`Rechercher dans ${title}`}
					className="mb-2 h-9 w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 text-sm text-white placeholder:text-white/50 focus:border-dbz-orange/60 focus:outline-none"
				/>
			)}
			<div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
				{shown.length === 0 && (
					<p className="px-1 py-2 text-xs italic text-white/50">Aucun résultat.</p>
				)}
				{shown.map((o) => {
					const on = selectedSet.has(o.value);
					return (
						<label
							key={o.value}
							className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
								on ? "bg-dbz-orange/15 text-white" : "text-white/75 hover:bg-white/[0.05]"
							}`}
						>
							<input
								type="checkbox"
								checked={on}
								onChange={() => toggle(o.value)}
								className="h-4 w-4 shrink-0 accent-dbz-orange"
							/>
							<span className="flex-1 truncate">{o.label}</span>
							{typeof o.count === "number" && (
								<span className="shrink-0 text-[11px] tabular-nums text-white/50">{o.count}</span>
							)}
						</label>
					);
				})}
			</div>
		</section>
	);
}

export function CharacterFilterModal({
	open,
	onClose,
	raceOptions,
	techniqueOptions,
	arcOptions,
	races,
	techniques,
	arcs,
	onRaces,
	onTechniques,
	onArcs,
	onReset,
	resultCount,
	totalCount,
	unite = "guerriers",
}: {
	open: boolean;
	onClose: () => void;
	raceOptions: FacetOption[];
	techniqueOptions: FacetOption[];
	arcOptions: FacetOption[];
	races: string[];
	techniques: string[];
	arcs: string[];
	onRaces: (v: string[]) => void;
	onTechniques: (v: string[]) => void;
	onArcs: (v: string[]) => void;
	onReset: () => void;
	resultCount: number;
	totalCount: number;
	/**
	 * Ce que le pied compte. La grille bascule entre fiches et versions par
	 * saga : « 12 / 451 guerriers » décrivait des versions comme des personnages.
	 */
	unite?: string;
}) {
	const titleId = useId();
	const activeCount = races.length + techniques.length + arcs.length;

	// Échap, verrou du scroll, MAIS AUSSI déplacement/piège/restitution du focus —
	// les trois derniers manquaient : le focus restait sur le bouton déclencheur
	// derrière le voile et Tab parcourait la page en dessous de la modale.
	const panelRef = useRef<HTMLDivElement>(null);
	useFocusTrap(panelRef, open, onClose);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
		>
			<button
				type="button"
				aria-label="Fermer"
				onClick={onClose}
				className="absolute inset-0 bg-black/70 backdrop-blur-sm"
			/>
			<div
				ref={panelRef}
				// `tabIndex={-1}` : cible du focus à l'ouverture, sans entrer dans
				// l'ordre de tabulation.
				tabIndex={-1}
				className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-dbz-border bg-dbz-card shadow-2xl outline-none sm:rounded-2xl"
			>
				{/* En-tête */}
				<div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
					<Scouter className="h-4 w-4 text-dbz-orange" />
					<h2 id={titleId} className="font-saiyan text-lg uppercase tracking-widest text-white">
						Filtrer les personnages
					</h2>
					{activeCount > 0 && (
						<button
							type="button"
							onClick={onReset}
							// `.cible-44` : le dessin reste une ligne de 11 px dans un en-tête
							// serré, la zone tactile monte à 44 px sans déplacer quoi que ce soit.
							className="cible-44 ml-auto text-[11px] font-bold uppercase tracking-wider text-white/50 hover:text-dbz-orange"
						>
							Tout effacer
						</button>
					)}
					<button
						type="button"
						onClick={onClose}
						aria-label="Fermer"
						// Croix de 32 px au dessin — la seule sortie de la modale sur
						// mobile, et elle était sous la cible tactile de 44 px.
						className={`cible-44 grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white ${
							activeCount > 0 ? "" : "ml-auto"
						}`}
					>
						<Croix className="h-4 w-4" />
					</button>
				</div>

				{/* Sections (grille responsive, chacune scrollable) */}
				<div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-5 sm:grid-cols-3 sm:overflow-hidden">
					<div className="flex min-h-0 flex-col sm:max-h-[52vh]">
						<FilterSection
							title="Race"
							kanji="種族"
							options={raceOptions}
							selected={races}
							onChange={onRaces}
						/>
					</div>
					<div className="flex min-h-0 flex-col sm:max-h-[52vh]">
						<FilterSection
							title="Techniques"
							kanji="技"
							options={techniqueOptions}
							selected={techniques}
							onChange={onTechniques}
						/>
					</div>
					<div className="flex min-h-0 flex-col sm:max-h-[52vh]">
						<FilterSection
							title="Arcs"
							kanji="編"
							options={arcOptions}
							selected={arcs}
							onChange={onArcs}
						/>
					</div>
				</div>

				{/* Pied : compteur + validation */}
				<div className="flex items-center gap-3 border-t border-white/10 px-5 py-4">
					<p className="scouter-text text-[11px] text-dbz-orange">
						{resultCount} / {totalCount} {unite}
					</p>
					<button
						type="button"
						onClick={onClose}
						// 44 px : c'est le bouton de validation de la modale, donc la
						// cible la plus visée au pouce — il tenait dans 40.
						className="ml-auto h-11 rounded-full bg-dbz-orange px-6 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-black transition-colors hover:bg-white"
					>
						Voir les résultats
					</button>
				</div>
			</div>
		</div>
	);
}
