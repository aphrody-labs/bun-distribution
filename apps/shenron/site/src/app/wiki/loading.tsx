import { CardListSkeleton, HeroSkeleton } from "@/components/wiki/WikiSkeleton";

export default function Loading() {
	return (
		<div>
			<HeroSkeleton />
			<div className="wiki-container space-y-16">
				<CardListSkeleton count={8} />
				<CardListSkeleton count={4} />
			</div>
		</div>
	);
}
