/**
 * Référentiel des équipes Rose Griffon.
 *
 * Source unique : la liste vivait auparavant en double, sous deux formes
 * divergentes (`TEAM_LABELS` dans la page cliente, `TEAM_OPTIONS` dans la boîte
 * de dialogue). Le formulaire pouvait donc proposer une équipe que la liste ne
 * savait pas nommer, et la colonne `team_name` finissait incohérente en base.
 *
 * L'ordre du tableau est l'ordre d'affichage voulu dans l'administration :
 * du bureau vers les partenaires, pas l'ordre alphabétique.
 */
export const EQUIPES = [
	{ id: "bureauteam", libelle: "Bureau de l'Association" },
	{ id: "assoteam", libelle: "Membres de l'Association" },
	{ id: "loreteam", libelle: "Équipe Lore" },
	{ id: "dessinateurteam", libelle: "Équipe Dessinateur" },
	{ id: "productionteam", libelle: "Équipe Production" },
	{ id: "socialteam", libelle: "Équipe Réseaux" },
	{ id: "achilleateam", libelle: "Équipe Achilléa" },
	{ id: "azaleeteam", libelle: "Équipe Azalée" },
	{ id: "mediationteam", libelle: "Cellule de Médiation" },
	{ id: "collabteam", libelle: "Partenaires & Collaborateurs" },
] as const;

export type IdEquipe = (typeof EQUIPES)[number]["id"];

/** Identifiants d'équipe acceptés, en tuple (exigé par `z.enum`). */
export const IDS_EQUIPES = EQUIPES.map((equipe) => equipe.id) as unknown as [IdEquipe, ...IdEquipe[]];

const INDEX_LIBELLES = new Map<string, string>(
	EQUIPES.map((equipe) => [equipe.id as string, equipe.libelle as string])
);

/** Rang d'affichage d'une équipe ; les identifiants inconnus passent en dernier. */
export function rangEquipe(id: string): number {
	const rang = EQUIPES.findIndex((equipe) => equipe.id === id);
	return rang === -1 ? EQUIPES.length : rang;
}

/** Libellé lisible d'une équipe ; on retombe sur l'identifiant brut si inconnu. */
export function libelleEquipe(id: string): string {
	return INDEX_LIBELLES.get(id) ?? id;
}

export function estIdEquipe(valeur: string): valeur is IdEquipe {
	return INDEX_LIBELLES.has(valeur);
}

/** Nombre d'équipes référencées — sert au compteur « x / y » des statistiques. */
export const NOMBRE_EQUIPES = EQUIPES.length;
