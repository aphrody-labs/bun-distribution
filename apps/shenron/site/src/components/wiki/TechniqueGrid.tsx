"use client";

/**
 * Grille des techniques, paginée.
 *
 * La page rendait les 825 fiches d'un coup : **2,4 Mo de HTML** mesurés en
 * production (1,53 Mo de DOM + 892 Ko de charge RSC), pour 60 cartes visibles à
 * l'écran. C'est ce qui rendait la page lente à ouvrir et saccadée au
 * défilement, surtout sur mobile. Ici le DOM ne contient qu'une page de cartes,
 * et la pagination reprend le composant partagé (position dans l'URL, mesure
 * affichée).
 *
 * Le filtre par type est client : la liste est déjà là, un aller-retour serveur
 * pour masquer des lignes serait plus lent que de les masquer sur place.
 */
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { ClientGatedWrap } from "@/components/GatedClientLink";
import { assetUrl } from "@/lib/assets";
import type { AccessSnapshot } from "@/lib/wiki-launch";

export type TechniqueCard = {
	id: number;
	slug: string;
	name: string;
	description: string | null;
	type: string | null;
	image: string | null;
	creatorName: string | null;
};

const PAR_PAGE = 60;

import { TechniqueFamiliesView } from "@/components/wiki/TechniqueFamiliesView";
import { Layers, LayoutGrid } from "lucide-react";

export function TechniqueGrid({
	techniques,
	libelles,
	access,
}: {
	techniques: TechniqueCard[];
	/** type brut → libellé français (le registre vit côté serveur). */
	libelles: Record<string, string>;
	/**
	 * Instantané de la configuration de lancement, résolu côté serveur. Sans lui
	 * la grille émettrait des liens vers des fiches qu'un anonyme ne peut pas
	 * ouvrir — le mur de 307 que `GatedLink` existe pour éviter.
	 */
	access: AccessSnapshot;
}) {
	const [viewMode, setViewMode] = useState<"families" | "linear">("families");
	const [type, setType] = useState<string>("tous");
	const [page, setPage] = useState(1);

	const types = useMemo(() => {
		const compte = new Map<string, number>();
		for (const t of techniques) {
			const k = t.type ?? "Autre";
			compte.set(k, (compte.get(k) ?? 0) + 1);
		}
		return [...compte.entries()].toSorted((a, b) => b[1] - a[1]);
	}, [techniques]);

	const filtrees = useMemo(
		() => (type === "tous" ? techniques : techniques.filter((t) => (t.type ?? "Autre") === type)),
		[techniques, type]
	);

	useEffect(() => setPage(1), [type]);

	const pages = Math.max(1, Math.ceil(filtrees.length / PAR_PAGE));
	const pageSure = Math.min(page, pages);
	const visibles = useMemo(
		() => filtrees.slice((pageSure - 1) * PAR_PAGE, pageSure * PAR_PAGE),
		[filtrees, pageSure]
	);

	const pill =
		// `min-h-11` = 44 px : ces puces filtrent tout le catalogue, et `py-2`
		// seul les laissait à 38 px.
		"inline-flex min-h-11 items-center rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60";

	return (
		<div className="space-y-8">
			{/* Sélecteur de mode : Familles & Lignées VS Grille Linéaire */}
			<div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/50 p-4 backdrop-blur-xl">
				<div>
					<div className="text-xs font-bold text-white uppercase tracking-wider">
						Organisation des Capacités
					</div>
					<div className="text-[11px] text-white/50">
						Basculez entre le regroupement généalogique par écoles martiales et la liste alphabétique exhaustive.
					</div>
				</div>
				<div className="flex rounded-xl bg-white/5 p-1 border border-white/10 shrink-0">
					<button
						type="button"
						onClick={() => setViewMode("families")}
						className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
							viewMode === "families"
								? "bg-orange-600 text-white shadow-lg shadow-orange-950/50"
								: "text-white/60 hover:text-white"
						}`}
					>
						<Layers className="h-4 w-4" />
						<span>Familles d&apos;Évolution</span>
					</button>
					<button
						type="button"
						onClick={() => setViewMode("linear")}
						className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition-all ${
							viewMode === "linear"
								? "bg-orange-600 text-white shadow-lg shadow-orange-950/50"
								: "text-white/60 hover:text-white"
						}`}
					>
						<LayoutGrid className="h-4 w-4" />
						<span>Catalogue Exhaustif ({techniques.length})</span>
					</button>
				</div>
			</div>

			{viewMode === "families" ? (
				<TechniqueFamiliesView techniques={techniques} />
			) : (
				<>
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => setType("tous")}
							aria-pressed={type === "tous"}
							className={`${pill} ${
								type === "tous"
									? "border-dbz-orange bg-dbz-orange text-black"
									: "border-white/12 text-white/65 hover:border-white/30 hover:text-white"
							}`}
						>
							Toutes
							<span className="ml-1.5 tabular-nums opacity-70">{techniques.length}</span>
						</button>
				{types.map(([k, n]) => (
					<button
						key={k}
						type="button"
						onClick={() => setType(k)}
						aria-pressed={type === k}
						className={`${pill} ${
							type === k
								? "border-dbz-orange bg-dbz-orange text-black"
								: "border-white/12 text-white/65 hover:border-white/30 hover:text-white"
						}`}
					>
						{libelles[k] ?? k}
						<span className="ml-1.5 tabular-nums opacity-70">{n}</span>
					</button>
				))}
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{visibles.map((tech) => (
					<ClientGatedWrap
						access={access}
						key={tech.id}
						href={`/wiki/techniques/${tech.slug}`}
						className="group flex gap-4 rounded-xl border border-white/[0.08] p-4 transition-colors hover:border-dbz-orange/50 hover:bg-white/[0.02]"
					>
						<div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black">
							<Image
								src={assetUrl(tech.image ?? "/dbz/kinto-un-icone.svg")}
								alt=""
								fill
								sizes="56px"
								className="object-cover object-top transition-transform duration-500 group-hover:scale-110"
							/>
						</div>
						<div className="min-w-0 flex-1">
							<h3 className="font-display text-[15px] font-semibold leading-snug text-white transition-colors group-hover:text-dbz-orange">
								{tech.name}
							</h3>
							{tech.creatorName && (
								<p className="mt-0.5 font-scouter text-[10px] uppercase tracking-[0.12em] text-dbz-orange/70">
									{tech.creatorName}
								</p>
							)}
							{tech.description && (
								<p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-white/50">
									{tech.description}
								</p>
							)}
						</div>
					</ClientGatedWrap>
				))}
			</div>

			{filtrees.length === 0 && (
				<p className="py-16 text-center text-sm text-white/45">
					Aucune technique dans cette catégorie.
				</p>
			)}

			<Pagination
				page={pageSure}
				parPage={PAR_PAGE}
				total={filtrees.length}
				onPageChange={setPage}
				unite="techniques"
			/>
				</>
			)}
		</div>
	);
}
