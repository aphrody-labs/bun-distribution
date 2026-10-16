import { Card, CardContent, CardHeader, Skeleton } from "@rosegriffon/ui";

export function DashboardSkeleton() {
	return (
		<div className="container mx-auto p-6 space-y-6">
			<Skeleton className="h-10 w-48" />
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{[1, 2, 3].map((i) => (
					<Card key={i} className="h-full">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="size-4 rounded-full" />
						</CardHeader>
						<CardContent className="space-y-2">
							<Skeleton className="h-8 w-32" />
							<Skeleton className="h-3 w-48" />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
