/**
 * Attente de la page de canonicité, sur navigation interne.
 *
 * Le `loading.tsx` de la rubrique wiki affiche une bannière et deux grilles de
 * cartes : rien de ce que cette page rend. On dessine donc sa vraie coquille —
 * la barre de recherche, la consigne, un premier bloc — pour que l'arrivée du
 * contenu ne redessine pas l'écran de fond en comble.
 */
export default function Loading() {
	return (
		<div className="mx-auto w-full max-w-[820px] px-6 py-20 lg:px-10" aria-hidden="true">
			<div className="h-[58px] animate-pulse rounded-full bg-white/[0.05]" />
			<div className="mt-5 h-3 w-4/5 animate-pulse rounded bg-white/[0.04]" />
			<div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-white/[0.04]" />
			<div className="mt-14 space-y-5">
				<div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
				<div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
				<div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
			</div>
		</div>
	);
}
