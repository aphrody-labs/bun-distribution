import { BillboardSkeleton } from "@/components/stream/StreamSkeleton";

export default function Loading() {
	return (
		<>
			<BillboardSkeleton />
			<div className="wiki-container">
				<div className="mb-6 h-28 w-full animate-pulse rounded-xl bg-dbz-card ring-1 ring-white/[0.06]" />
				<div className="space-y-2">
					{Array.from({ length: 10 }).map((_, i) => (
						<div
							key={i}
							className="h-16 w-full animate-pulse rounded-lg bg-dbz-card ring-1 ring-white/[0.06]"
						/>
					))}
				</div>
			</div>
		</>
	);
}
