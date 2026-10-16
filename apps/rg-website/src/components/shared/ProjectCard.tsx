import { Card, CardContent } from "@rosegriffon/ui";
import Image from "next/image";
import Link from "next/link";

import RgEmote from "@/components/shared/emotes/RgEmote";

import { ArrowRight } from "@/lib/icons-config";
import type { Projet } from "@/lib/projets";

/**
 * Carte projet — vocabulaire visuel unique, partagé par la page `/projets` et
 * par l'extrait de la page d'accueil.
 *
 * Cadrage : le visuel vit dans un conteneur au ratio explicite `4/3` (le plus
 * proche des sources, carrées ou 4:3) avec `overflow-hidden` et
 * `object-cover object-center`, donc il ne déborde ni ne s'étire quelle que
 * soit la largeur de la grille. Les projets sans visuel retombent sur un aplat
 * `bg-muted` et leur icône, à l'identique du reste de la grille.
 */
interface ProjectCardProps {
	projet: Projet;
	/**
	 * Tailles rendues, à aligner sur la grille du parent.
	 * Défaut : grille 1 / 2 / 3 colonnes dans un conteneur `max-w-7xl`.
	 */
	sizes?: string;
}

const SIZES_PAR_DEFAUT = "(min-width: 1024px) 26rem, (min-width: 640px) 50vw, 100vw";

export function ProjectCard({ projet, sizes = SIZES_PAR_DEFAUT }: ProjectCardProps) {
	const Icone = projet.icone;

	return (
		<Link
			href={projet.href}
			className="group block h-full rounded-3xl outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
		>
			<Card className="h-full overflow-hidden rounded-3xl border-border bg-card p-0 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg">
				<CardContent className="flex h-full flex-col p-0">
					<div className="relative aspect-4/3 w-full overflow-hidden bg-muted">
						{projet.image ? (
							<Image
								src={projet.image}
								alt=""
								fill
								sizes={sizes}
								className="object-cover object-center transition-transform duration-500 group-hover:scale-105"
								loading="lazy"
							/>
						) : (
							<div className="flex size-full items-center justify-center">
								<Icone className="size-20 text-muted-foreground/40 transition-transform duration-500 group-hover:scale-110" />
							</div>
						)}

						<span className="absolute right-3 top-3 rounded-full border border-border bg-card/85 px-3 py-1 text-xs font-bold tracking-wide text-card-foreground backdrop-blur-sm">
							{projet.badge}
						</span>

						<div className="absolute bottom-3 left-3 rounded-2xl border border-border bg-card/85 p-1.5 backdrop-blur-sm">
							<RgEmote name={projet.emote} size={40} animated />
						</div>
					</div>

					<div className="flex grow flex-col gap-3 p-5 sm:p-6">
						<div className="flex items-center gap-3">
							<span className="rounded-xl bg-muted p-2 text-muted-foreground transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
								<Icone className="size-5" />
							</span>
							<h3 className="text-xl font-bold text-card-foreground transition-colors duration-300 group-hover:text-primary sm:text-2xl">
								{projet.titre}
							</h3>
						</div>

						<p className="grow text-sm leading-relaxed text-muted-foreground sm:text-base">
							{projet.description}
						</p>

						<span className="mt-auto inline-flex items-center gap-2 border-t border-border pt-4 text-sm font-bold text-card-foreground transition-colors duration-300 group-hover:text-primary">
							Accéder au projet
							<ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
						</span>
					</div>
				</CardContent>
			</Card>
		</Link>
	);
}

export default ProjectCard;
