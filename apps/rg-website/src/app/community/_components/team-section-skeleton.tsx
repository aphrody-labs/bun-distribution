import { Skeleton } from "@rosegriffon/ui";

export default function TeamSectionSkeleton() {
	return (
		<section className="flex flex-col gap-10 lg:gap-12">
			{/* Header Skeleton */}
			<div className="text-center lg:text-left space-y-4 max-w-4xl mx-auto lg:mx-0 animate-fade-in">
				<Skeleton className="h-12 lg:h-14 w-64 lg:w-80 mx-auto lg:mx-0 bg-linear-to-r from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 rounded-lg" />
				<Skeleton className="h-20 lg:h-24 w-full max-w-3xl mx-auto lg:mx-0 bg-gray-200 dark:bg-gray-800 rounded-lg" />
				<Skeleton className="h-1 w-24 mx-auto lg:mx-0 bg-gaelle-blue/30 dark:bg-gaelle-blue/50 rounded-full" />
			</div>

			{/* Teams Grid Skeleton */}
			<div className="flex flex-col gap-12 lg:gap-16">
				{[...Array(4)].map((_, teamIdx) => (
					<div
						key={teamIdx}
						className="flex flex-col gap-6 animate-fade-in"
						style={{ animationDelay: `${teamIdx * 100}ms` }}
					>
						<Skeleton className="h-8 w-48 bg-linear-to-r from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 rounded-lg" />
						<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 lg:gap-6">
							{[...Array(5)].map((_, memberIdx) => (
								<div
									key={memberIdx}
									className="flex flex-col items-center gap-3 animate-fade-in"
									style={{ animationDelay: `${teamIdx * 100 + memberIdx * 50}ms` }}
								>
									<Skeleton className="size-32 sm:w-40 sm:h-40 rounded-full bg-linear-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800" />
									<div className="w-full space-y-2">
										<Skeleton className="h-5 w-24 mx-auto bg-gray-300 dark:bg-gray-700 rounded-md" />
										<Skeleton className="h-4 w-20 mx-auto bg-gray-200 dark:bg-gray-800 rounded-md" />
									</div>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
