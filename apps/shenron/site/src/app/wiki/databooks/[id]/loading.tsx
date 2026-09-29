import { HeroSkeleton } from "@/components/wiki/WikiSkeleton";

/**
 * Fiche d'un databook : couverture + description, puis le lecteur de planches.
 * C'est la page la plus lourde du wiki (jusqu'à 362 planches transcrites), donc
 * celle où l'attente sans repère était la plus longue.
 */
export default function Loading() {
	return (
		<div className="wiki-container">
			<HeroSkeleton />
			<div className="mt-10 flex flex-col gap-8 lg:flex-row lg:gap-20">
				<div className="w-full shrink-0 lg:w-1/3 xl:w-1/4">
					<div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-white/[0.06]" />
				</div>
				<div className="min-w-0 flex-1 space-y-3">
					<div className="h-8 w-2/3 animate-pulse rounded bg-white/10" />
					<div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" />
					<div className="h-3 w-11/12 animate-pulse rounded bg-white/[0.06]" />
					<div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.06]" />
				</div>
			</div>
			<div className="mt-16 h-[82svh] min-h-[460px] w-full animate-pulse rounded-lg bg-white/[0.04]" />
		</div>
	);
}
