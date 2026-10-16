import { wiki } from "@rosegriffon/app-shell";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/**
 * Préfixe de montage du wiki dans cette app (`/wiki`), lu dans le registre de
 * routes partagé plutôt qu'écrit en dur : la même page existe à la racine
 * de Website, sous le préfixe `/wiki`.
 *
 * LE BUG QUE ÇA CORRIGE
 * Les quatre cartes pointaient sur `/tools/<outil>`. Mesuré en production sur
 * `rosegriffon.fr/wiki/tools` : 4 des 204 liens internes du wiki qui passaient
 * par une redirection 308 vers `/wiki/tools/<outil>`. Le lien canonique visait
 * lui aussi `/tools`, c'est-à-dire une URL qui redirige.
 */
const outil = (chemin: string) => wiki(chemin);

export const metadata: Metadata = {
	alternates: { canonical: wiki("/tools") },
	description:
		"Comparateur de personnages, générateur d'équipe aléatoire, traducteur de noms et plus pour Inazuma Eleven: Victory Road.",
	title: "Outils | Inazuma Eleven Victory Road - Azalée",
};

export const revalidate = 86_400;

const TOOLS: Array<{
	href: string;
	icon: string;
	title: string;
	description: string;
	container: string;
}> = [
	{
		container: "bg-primary-container text-on-primary-container",
		description: "Stats, techniques et auras de deux joueurs côte à côte.",
		href: outil("/tools/compare"),
		icon: "compare_arrows",
		title: "Comparateur",
	},
	{
		container: "bg-secondary-container text-on-secondary-container",
		description: "11 joueurs, 1 coach, 3 manageuses. Filtrez par élément ou style de jeu.",
		href: outil("/tools/random-team"),
		icon: "casino",
		title: "Équipe aléatoire",
	},
	{
		container: "bg-tertiary-container text-on-tertiary-container",
		description: "Trouvez les noms français, anglais et japonais de toutes les entités du jeu.",
		href: outil("/tools/translator"),
		icon: "translate",
		title: "Traducteur",
	},
	{
		container: "bg-primary-container text-on-primary-container",
		description: "Composez votre équipe idéale en glissant-déposant vos joueurs sur le terrain.",
		href: outil("/tools/my-team"),
		icon: "stadium",
		title: "Mon Équipe",
	},
];

export default function ToolsPage() {
	return (
		<div className="w-full">
			<h1 className="
     font-[BradBunR] text-2xl
     sm:text-3xl
     md:text-4xl
     text-on-surface tracking-wide mb-6
     sm:mb-10
   ">
				Outils
			</h1>

			<div className="
     grid grid-cols-1
     sm:grid-cols-2
     lg:grid-cols-3
     gap-4
     sm:gap-5
   ">
				{TOOLS.map((tool) => (
					<Link
						key={tool.href}
						href={tool.href}
						className="
        group relative flex flex-col rounded-xl overflow-hidden bg-surface-container elevation-1 state-layer
        hover:elevation-2
        active:scale-[0.98]
        transition-all duration-200
      "
					>
						{/* Tonal header with icon */}
						<div
							className={cn(
								`
          relative h-28
          sm:h-32
          flex items-center justify-center
        `,
								tool.container
							)}
						>
							<div className="
         transition-transform duration-300
         group-hover:scale-110
       ">
								<Icon name={tool.icon} size={48} className="opacity-90" />
							</div>
						</div>

						{/* Content */}
						<div className="
        flex-1 p-4
        sm:p-5
        flex flex-col gap-1.5
      ">
							<h2 className="
         type-title-medium text-on-surface
         group-hover:text-primary
         transition-colors
       ">
								{tool.title}
							</h2>
							<p className="type-body-small text-on-surface-variant leading-relaxed">
								{tool.description}
							</p>
							<div className="mt-auto pt-3 flex items-center justify-end">
								<Icon
									name="arrow_forward"
									size={18}
									className="
           text-primary transition-transform
           group-hover:translate-x-1
         "
								/>
							</div>
						</div>
					</Link>
				))}
			</div>
		</div>
	);
}
