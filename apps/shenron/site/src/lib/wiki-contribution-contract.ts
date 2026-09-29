/**
 * Contrat de contribution wiki destiné aux agents.
 *
 * `WIKI_TABLE_SPECS` définit déjà la vérité unique des tables et colonnes
 * éditables. Ce petit adaptateur ne publie que son intersection avec les
 * champs réellement proposables : une IA peut donc découvrir sa surface
 * d'action sans deviner un nom SQL, ni se voir proposer une image, une relation
 * ou un drapeau de visibilité.
 *
 * Client-safe par choix : le même contrat peut être affiché dans l'admin, servi
 * par l'API agents et vérifié sans base de données.
 */
import { CONTRIBUTABLE_COLUMNS } from "@/lib/contributions-shared";
import { WIKI_TABLE_SPECS } from "@/lib/wiki-tables";

interface AgentContributableField {
	name: string;
	label: string;
	hint: string;
	format: "text" | "markdown";
}

export interface AgentWikiContributionTable {
	table: string;
	primaryKey: string | string[];
	fields: AgentContributableField[];
}

/** Tables et champs précis acceptés par POST /wiki/contributions. */
export function getAgentWikiContributionContract(): AgentWikiContributionTable[] {
	return Object.entries(WIKI_TABLE_SPECS)
		.map(([table, spec]) => {
			const fields = spec.mutableColumns.flatMap((name) => {
				const field = CONTRIBUTABLE_COLUMNS[name];
				if (!field) return [];
				return [{
					name,
					label: field.label,
					hint: field.hint,
					format: (field.long ? "markdown" : "text") as AgentContributableField["format"],
				}];
			});
			return {
				table,
				primaryKey: Array.isArray(spec.pk) ? [...spec.pk] : spec.pk,
				fields,
			};
		})
		.filter((table) => table.fields.length > 0);
}

/** Cibles textuelles à syntaxe spéciale, hors colonne SQL directe. */
export const AGENT_WIKI_DYNAMIC_TARGETS = [
	{
		table: "db_databooks",
		columnPattern: "pages#<numero>",
		label: "Transcription d'une planche",
		hint: "Remplacer uniquement le texte de la planche indiquée ; conserver la langue et les noms propres imprimés.",
		format: "markdown" as const,
	},
	{
		table: "db_characters",
		columnPattern: "stats",
		label: "Statistiques",
		hint: "Une mesure sourcée par ligne, sous la forme « Intitulé : valeur ».",
		format: "text" as const,
	},
] as const;
