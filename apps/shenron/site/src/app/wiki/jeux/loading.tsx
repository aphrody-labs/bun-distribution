import { BillboardSkeleton, RailSkeleton } from "@/components/stream/StreamSkeleton";

/**
 * Squelette de rubrique — affiché pendant le rendu asynchrone de la page.
 *
 * Sans lui, la route héritait du `loading.tsx` racine, qui remplace TOUTE la
 * page par un compteur de Dragon Balls : à chaque navigation, le visiteur
 * perdait le repère visuel de la section où il entrait. Ici la structure
 * apparaît d'emblée et se remplit.
 */
export default function Loading() {
	return (
		<>
			<BillboardSkeleton />
			<div className="wiki-container">
				{Array.from({ length: 4 }).map((_, i) => (
					<RailSkeleton key={i} variant="poster" />
				))}
			</div>
		</>
	);
}
