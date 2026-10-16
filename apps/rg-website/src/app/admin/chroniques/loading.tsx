import { Skeleton } from "@rosegriffon/ui";

export default function ChroniquesLoading() {
	return (
		<div className="p-6 space-y-6">
			<div className="flex justify-between items-center">
				<Skeleton className="h-10 w-48" />
				<Skeleton className="h-10 w-32" />
			</div>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{[...Array(6)].map((_, i) => (
					<div key={i} className="rounded-xl border overflow-hidden">
						<Skeleton className="h-48 w-full" />
						<div className="p-6 space-y-4">
							<Skeleton className="h-6 w-3/4" />
							<div className="flex gap-2">
								<Skeleton className="h-5 w-16 rounded-full" />
								<Skeleton className="h-5 w-16 rounded-full" />
							</div>
							<Skeleton className="h-4 w-1/2" />
							<div className="flex justify-between pt-4">
								<Skeleton className="h-9 w-24" />
								<Skeleton className="h-9 w-24" />
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
