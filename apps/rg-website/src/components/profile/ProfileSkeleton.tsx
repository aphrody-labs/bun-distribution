import { Card, CardContent, CardHeader, Skeleton } from "@rosegriffon/ui";

export function ProfileSkeleton() {
	return (
		<div className="flex flex-col items-center justify-center p-4 md:p-8">
			<Card className="w-full max-w-2xl shadow-lg">
				<CardHeader className="flex flex-col items-center text-center space-y-4">
					<Skeleton className="size-24 rounded-full" />
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-6 w-32" />
				</CardHeader>
				<CardContent className="space-y-4 flex flex-col items-center">
					<Skeleton className="h-4 w-40" />
					<div className="w-full space-y-2">
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4 mx-auto" />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
