/**
 * Squelettes de chargement « façon streaming » — servis par les `loading.tsx`
 * (frontière Suspense de Next : affichés INSTANTANÉMENT pendant le rendu async de
 * la page) et par les `<Suspense fallback>` internes qui streament les rails.
 *
 * Server Component pur (aucun JS) : shimmer via `animate-pulse` Tailwind.
 */

export function BillboardSkeleton() {
	return (
		<div className="relative h-[70vh] max-h-[680px] min-h-[440px] w-full overflow-hidden border-b border-white/[0.08] bg-dbz-card">
			<div className="absolute inset-0 animate-pulse bg-gradient-to-t from-dbz-bg via-dbz-bg/50 to-dbz-card/40" />
			<div className="relative z-10 mx-auto flex h-full max-w-[1400px] items-end px-6 pb-12 lg:px-10 lg:pb-16">
				<div className="w-full max-w-2xl space-y-4">
					<div className="h-3 w-32 animate-pulse rounded bg-white/10" />
					<div className="h-12 w-3/4 animate-pulse rounded bg-white/15" />
					<div className="h-4 w-40 animate-pulse rounded bg-white/10" />
					<div className="space-y-2">
						<div className="h-3 w-full max-w-xl animate-pulse rounded bg-white/10" />
						<div className="h-3 w-2/3 max-w-md animate-pulse rounded bg-white/10" />
					</div>
					<div className="flex gap-3 pt-2">
						<div className="h-12 w-44 animate-pulse rounded-lg bg-dbz-orange/40" />
						<div className="h-12 w-36 animate-pulse rounded-lg bg-white/10" />
					</div>
				</div>
			</div>
		</div>
	);
}

export function RailSkeleton({ variant = "poster" }: { variant?: "poster" | "episode" }) {
	const card =
		variant === "poster"
			? "aspect-[2/3] w-[142px] sm:w-[160px]"
			: "aspect-video w-[260px] sm:w-[300px]";
	return (
		<div className="mb-9 lg:mb-12">
			<div className="mb-3 h-6 w-52 animate-pulse rounded bg-white/10" />
			<div className="flex gap-3 overflow-hidden">
				{Array.from({ length: 8 }).map((_, i) => (
					<div
						key={i}
						className={`shrink-0 animate-pulse rounded-lg bg-dbz-card ring-1 ring-white/[0.06] ${card}`}
					/>
				))}
			</div>
		</div>
	);
}
