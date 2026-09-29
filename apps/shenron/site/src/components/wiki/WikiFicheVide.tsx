/**
 * Appel à contribution rendu **à la place** de l'article, sur une fiche qui
 * n'en a pas.
 *
 * 531 fiches visibles n'ont ni article ni description (mesuré le 2026-08-26) :
 * elles affichaient un titre, une image, et rien. Un lecteur qui arrive là par
 * une recherche repart aussitôt, et personne ne sait que quelque chose manque.
 *
 * Le vide devient donc une invitation, à l'endroit exact où le texte devrait
 * être — c'est ce qui distingue un appel qui convertit d'un bouton générique
 * en haut de page. Le composant ne s'affiche que s'il y a réellement un trou :
 * dès qu'un article existe, il disparaît.
 */
import { Crayon } from "@/components/icones";
import Link from "next/link";
import { WikiContribute } from "@/components/wiki/WikiContribute";

export function WikiFicheVide({
	table,
	rowId,
	label,
	/** Ce que le lecteur est censé écrire, en une phrase adaptée à la rubrique. */
	quoi = "son histoire, son rôle et ce que les sources en disent",
}: {
	table: string;
	rowId: string | number;
	label?: string | null;
	quoi?: string;
}) {
	return (
		<div className="dbz-panel relative overflow-hidden border border-dashed border-dbz-orange/25 bg-dbz-orange/[0.03] p-8 text-center">
			<div className="absolute inset-0 halftone pointer-events-none opacity-[0.04]" />
			<div className="relative z-10">
				<Crayon className="mx-auto h-6 w-6 text-dbz-orange/70" />
				<h2 className="mt-3 font-saiyan text-xl uppercase tracking-wide text-white">
					Cette fiche attend son article
				</h2>
				<p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/55">
					{label ? <strong className="text-white/75">{label}</strong> : "Cette entrée"} n&apos;a pas
					encore de texte&nbsp;: {quoi}. Si tu as le tome ou le databook sous la main, tu peux
					l&apos;écrire — un relecteur publie, la page gardera ton nom.
				</p>
				<div className="mt-5 flex flex-wrap items-center justify-center gap-3">
					<WikiContribute
						table={table}
						rowId={rowId}
						columns={["article", "description"]}
						entityLabel={label}
						labelBouton="Écrire le premier article"
					/>
					<Link
						href="/wiki/contribuer"
						className="text-[11px] text-white/35 underline-offset-2 transition-colors hover:text-white/60 hover:underline"
					>
						Comment ça marche&nbsp;?
					</Link>
				</div>
			</div>
		</div>
	);
}
