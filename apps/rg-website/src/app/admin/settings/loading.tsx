import { Skeleton } from "@rosegriffon/ui";

export default function SettingsLoading() {
	return (
		<div className="p-6 space-y-6">
			<Skeleton className="h-10 w-64" />

			<div className="space-y-6">
				{[...Array(3)].map((_, i) => (
					<div key={i} className="space-y-2">
						<Skeleton className="h-5 w-32" />
						<Skeleton className="h-10 w-full" />
						<Skeleton className="h-4 w-full max-w-md" />
					</div>
				))}
			</div>
		</div>
	);
}
