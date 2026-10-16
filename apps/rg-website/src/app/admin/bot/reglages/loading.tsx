import { Skeleton } from "@rosegriffon/ui";

export default function ChargementBot() {
	return (
		<div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
			<div className="space-y-3 border-b border-border pb-6">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-4 w-96 max-w-full" />
			</div>
			<div className="grid gap-4 lg:grid-cols-2">
				{[...Array(4)].map((_, i) => (
					<div key={i} className="space-y-3 rounded-xl border border-border p-6">
						<Skeleton className="h-5 w-40" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-2/3" />
					</div>
				))}
			</div>
		</div>
	);
}
