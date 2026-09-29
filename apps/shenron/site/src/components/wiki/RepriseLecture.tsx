"use client";

/**
 * « Reprendre » — les dernières fiches consultées sur cet appareil.
 *
 * Îlot client monté APRÈS l'hydratation : il lit `localStorage`, qui n'existe
 * pas au rendu serveur. Tant qu'il n'a rien à proposer, il ne rend rien du tout
 * — pas de bloc « aucun historique », qui occuperait de la place pour dire
 * qu'il n'a rien à dire.
 *
 * Rien n'est envoyé au serveur : c'est un marque-page, pas une mesure. Il
 * fonctionne donc aussi pour qui a refusé la mesure d'audience.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { WikiImg } from "@/components/wiki/WikiImg";
import { reprises, viderHistorique, type EntreeHistorique } from "@/lib/historique-local";

export function RepriseLecture({ max = 8 }: { max?: number }) {
	const [entrees, setEntrees] = useState<EntreeHistorique[] | null>(null);

	useEffect(() => {
		setEntrees(reprises().slice(0, max));
	}, [max]);

	// `null` = pas encore lu ; tableau vide = rien à proposer. Les deux ne
	// rendent rien, mais pour des raisons différentes.
	if (!entrees || entrees.length === 0) return null;

	return (
		<section aria-label="Reprendre la lecture">
			<div className="mb-4 flex items-baseline justify-between gap-4">
				<h2 className="font-scouter text-[11px] uppercase tracking-[0.18em] text-white/45">
					Reprendre
				</h2>
				<button
					type="button"
					onClick={() => {
						viderHistorique();
						setEntrees([]);
					}}
					className="text-[11px] text-white/30 transition-colors hover:text-white/60"
				>
					Effacer
				</button>
			</div>
			<ul className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
				{entrees.map((e) => (
					<li key={e.href} className="shrink-0">
						<Link
							href={e.href}
							className="group block w-[104px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange"
						>
							<div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-dbz-card ring-1 ring-white/[0.06] transition-all group-hover:ring-dbz-orange/60">
								<WikiImg
									src={e.image ?? null}
									alt=""
									sizes="104px"
									className="absolute inset-0 h-full w-full object-cover object-top"
								/>
							</div>
							<p className="mt-1.5 truncate font-display text-[12px] font-semibold text-white/85 transition-colors group-hover:text-dbz-orange">
								{e.titre}
							</p>
							<p className="truncate text-[10px] text-white/40">{e.rubrique}</p>
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
}
