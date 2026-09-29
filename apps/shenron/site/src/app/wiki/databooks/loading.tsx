import { GridSkeleton, IndexSkeleton } from "@/components/wiki/WikiSkeleton";

export default function Loading() {
	return (
		<IndexSkeleton>
			{/* Les databooks s'affichent en couvertures : proportion d'affiche. */}
			<GridSkeleton count={18} ratio="aspect-[2/3]" />
		</IndexSkeleton>
	);
}
