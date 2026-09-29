import { CardListSkeleton, IndexSkeleton } from "@/components/wiki/WikiSkeleton";

export default function Loading() {
	return (
		<IndexSkeleton>
			<CardListSkeleton />
		</IndexSkeleton>
	);
}
