/**
 * Barre d'édition d'une fiche wiki — le point d'entrée UNIQUE vers la
 * modification, quel que soit le droit du lecteur.
 *
 * Jusqu'ici la fiche n'exposait qu'une barre réservée aux admins : un membre
 * qui repérait une erreur n'avait d'autre recours qu'un ticket en texte libre,
 * charge au modérateur de retrouver la fiche, le champ et la formulation. La
 * barre porte désormais les deux chemins côte à côte :
 *
 *   - **tout le monde** → « Proposer une correction » sur chaque champ
 *     éditorial de la fiche (relu avant publication, crédité au contributeur) ;
 *   - **les admins**    → studio d'édition + masquage, comme avant.
 *
 * Composant **serveur** : il ne fait que choisir les champs à exposer. Les deux
 * îlots clients (`WikiContribute`, `WikiAdminActions`) ne reçoivent que des
 * chaînes courtes — le texte de départ est chargé à l'ouverture de la modale,
 * jamais embarqué dans la charge de la page.
 */
import Link from "next/link";
import { WikiAdminActions } from "@/components/wiki/WikiAdminBar";
import { WikiContribute } from "@/components/wiki/WikiContribute";
import { CONTRIBUTABLE_COLUMNS } from "@/lib/contributions-shared";
import { WIKI_TABLE_SPECS } from "@/lib/wiki-tables";

export interface WikiEditBarProps {
	table: string;
	id: string | number;
	/** Où rediriger après masquage (la fiche masquée devient 404). */
	indexHref: string;
	label?: string;
	/**
	 * Champs proposables à afficher. Par défaut : toutes les colonnes de la
	 * table qui sont à la fois mutables et ouvertes à la contribution — inutile
	 * de les répéter sur chaque page, la table les connaît déjà.
	 */
	champs?: string[];
	/**
	 * Retire l'article des champs proposés. À poser sur toute page qui rend ses
	 * rubriques en panneaux : chacune y porte déjà son propre bouton, visant le
	 * texte réellement affiché. Sans ça, la barre proposerait de corriger un
	 * article qui, sur les fiches pilotées par `db_wiki_sections`, n'est même
	 * pas rendu — la correction serait acceptée sans rien changer à l'écran.
	 */
	sansArticle?: boolean;
}

export function WikiEditBar({
	table,
	id,
	indexHref,
	label,
	champs,
	sansArticle = false,
}: WikiEditBarProps) {
	const spec = WIKI_TABLE_SPECS[table];
	const colonnes = (champs ?? spec?.mutableColumns ?? []).filter(
		(c) => c in CONTRIBUTABLE_COLUMNS && !(sansArticle && c === "article")
	);

	return (
		<div className="mb-5 flex flex-wrap items-center gap-2">
			{colonnes.length > 0 ? (
				<WikiContribute table={table} rowId={id} columns={colonnes} entityLabel={label} />
			) : null}
			<Link
				href="/wiki/contribuer"
				className="text-[11px] text-white/35 underline-offset-2 transition-colors hover:text-white/60 hover:underline"
			>
				Comment contribuer&nbsp;?
			</Link>
			<WikiAdminActions table={table} id={id} indexHref={indexHref} label={label} />
		</div>
	);
}
