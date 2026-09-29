/**
 * Squelette de FICHE (et non de catalogue) : sans lui, `[id]` héritait du
 * `loading.tsx` de la rubrique, qui dessine un billboard et des rails — une
 * structure qui n'a rien à voir avec la page qui va s'afficher, donc un saut
 * visuel à chaque ouverture non prérendue.
 */
export default function Loading() {
	return (
		<div className="mx-auto w-full max-w-[1180px] px-6 py-10 lg:px-10 lg:py-14">
			<div className="h-3 w-64 animate-pulse rounded bg-white/10" />
			<div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
				<div className="order-2 space-y-5 lg:order-1">
					<div className="h-3 w-40 animate-pulse rounded bg-dbz-orange/20" />
					<div className="h-12 w-full max-w-3xl animate-pulse rounded bg-white/15" />
					<div className="h-4 w-56 animate-pulse rounded bg-white/10" />
					<div className="flex gap-2"><div className="h-7 w-24 animate-pulse rounded bg-white/10" /><div className="h-7 w-24 animate-pulse rounded bg-white/10" /></div>
					<div className="aspect-video w-full animate-pulse rounded-xl bg-dbz-card ring-1 ring-white/[0.06]" />
				</div>
				<div className="order-1 aspect-[2/3] w-full animate-pulse rounded-xl bg-dbz-card ring-1 ring-white/[0.06] lg:order-2" />
			</div>
			<div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-white/[0.07]" />)}</div>
			<div className="mt-10 space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-6">{Array.from({ length: 5 }).map((_, i) => <div key={i} className={`h-3 animate-pulse rounded bg-white/[0.07] ${i === 4 ? "w-2/3" : "w-full"}`} />)}</div>
		</div>
	);
}
