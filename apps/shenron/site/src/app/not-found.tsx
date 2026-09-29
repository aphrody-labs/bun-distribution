import Link from "next/link";
import { DragonBall } from "@/components/DragonBall";

export default function NotFound() {
	return (
		<div className="container mx-auto px-4 py-24 max-w-2xl text-center">
			<div className="dbz-panel p-12 relative overflow-hidden">
				<div className="absolute inset-0 starfield opacity-30 pointer-events-none" />
				<div className="relative">
					<p className="font-scouter text-xs tracking-[0.5em] text-fuchsia-300 mb-4">
						❯ SECTEUR INCONNU ❮
					</p>
					<h1 className="title-jagged text-7xl md:text-9xl leading-none mb-6">404</h1>
					<p className="text-white/70 mb-2">Cette page s'est perdue dans le néant cosmique.</p>
					<p className="text-white/50 text-sm mb-8">
						Même les sept boules de cristal sont dispersées ici.
					</p>
					{/* Les 7 Dragon Balls dispersées — décor thématique (cf. components/DragonBall).
					    `decorative` : elles n'ajoutent rien à la page 404, et sans lui le
					    lecteur d'écran énumérait « Dragon Ball à 1 étoile… à 7 étoiles »
					    entre le message d'erreur et les deux liens de sortie. */}
					<div className="mb-9 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
						{([1, 2, 3, 4, 5, 6, 7] as const).map((s) => (
							<DragonBall
								key={s}
								stars={s}
								size={34}
								decorative
								className="drop-shadow-[0_0_10px_rgba(245,191,65,0.55)] transition-transform hover:-translate-y-1"
							/>
						))}
					</div>
					<div className="flex flex-wrap items-center justify-center gap-3">
						<Link href="/" className="dbz-button !text-xs">
							Retour à la base
						</Link>
						<Link href="/wiki/manga" className="dbz-button-ghost !text-xs">
							Lire le manga
						</Link>
					</div>
				</div>
			</div>
		</div>
	);
}
