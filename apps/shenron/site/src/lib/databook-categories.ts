/**
 * Catégories unifiées des databooks / interviews / art books / guides.
 * Source unique pour la grille publique, le studio (ENUM_OPTIONS) et le schéma.
 *
 * Un seul champ éditorial (`category`) — plus de dualité kind/category en UI.
 * La colonne `kind` reste en base (NOT NULL, index legacy) et est dérivée
 * automatiquement de la catégorie à l'écriture.
 */
export const DATABOOK_CATEGORIES = [
	"Databook",
	"Interview",
	"Art Book",
	"Saikyō Jump",
	"V-Jump",
	"Weekly Shonen Jump",
	"Pamphlet & Fair",
	"Autre",
] as const;

export type DatabookCategory = (typeof DATABOOK_CATEGORIES)[number];

/** Catégories « type d'ouvrage » (vs source éditoriale V-Jump, etc.). */
const DATABOOK_TYPE_CATEGORIES = [
	"Databook",
	"Interview",
	"Art Book",
	"Saikyō Jump",
] as const satisfies readonly DatabookCategory[];

export type DatabookKind = "databook" | "interview" | "artbook" | "guidebook";

export function resolveDatabookCategory(c: string | null | undefined): DatabookCategory {
	const t = (c ?? "").trim();
	// Alias historique : la catégorie s'appelait « Guidebook » avant d'être
	// renommée en « Saikyō Jump » (elle ne contient que ce magazine).
	if (t === "Guidebook") return "Saikyō Jump";
	if ((DATABOOK_CATEGORIES as readonly string[]).includes(t)) {
		return t as DatabookCategory;
	}
	return "Autre";
}

/**
 * Dérive la colonne technique `kind` depuis la catégorie unifiée.
 * Les catégories éditoriales (V-Jump, …) restent rattachées à `databook`.
 */
export function kindFromCategory(c: string | null | undefined): DatabookKind {
	switch (resolveDatabookCategory(c)) {
		case "Interview":
			return "interview";
		case "Art Book":
			return "artbook";
		case "Saikyō Jump":
			return "guidebook";
		default:
			return "databook";
	}
}

/** Libellé d'affichage à partir de kind (legacy) ou category. */
function databookTypeLabel(
	kind: string | null | undefined,
	category?: string | null
): string {
	const cat = resolveDatabookCategory(category);
	if ((DATABOOK_TYPE_CATEGORIES as readonly string[]).includes(cat) && cat !== "Databook") {
		return cat;
	}
	const k = (kind ?? "").toLowerCase();
	if (k === "interview") return "Interview";
	if (k === "artbook" || k === "art_book" || k === "art-book") return "Art Book";
	if (k === "guidebook" || k === "guide_book" || k === "guide-book") return "Saikyō Jump";
	if (cat === "Databook") return "Databook";
	// Catégorie éditoriale → l'ouvrage est un databook par défaut
	return cat === "Autre" ? "Databook" : cat;
}
