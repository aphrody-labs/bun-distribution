import { Skeleton } from "@rosegriffon/ui";

export default function UsersLoading() {
	return (
		<div className="p-6 space-y-6">
			<div className="flex items-center justify-between">
				<Skeleton className="h-10 w-48" />
				<Skeleton className="h-4 w-24" />
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				{[...Array(4)].map((_, i) => (
					<Skeleton key={i} className="h-32 rounded-xl" />
				))}
			</div>

			<div className="space-y-4">
				<div className="flex items-center gap-2">
					<Skeleton className="h-10 w-full" />
				</div>
				<div className="rounded-md border p-4 space-y-4">
					{[...Array(5)].map((_, i) => (
						<div key={i} className="flex items-center justify-between">
							<div className="flex items-center gap-4">
								<Skeleton className="size-10 rounded-full" />
								<div className="space-y-2">
									<Skeleton className="h-4 w-32" />
									<Skeleton className="h-3 w-24" />
								</div>
							</div>
							<Skeleton className="h-8 w-20" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
