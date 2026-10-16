/**
 * Primitives de contrat transverses — pagination, tri, pays, réseaux sociaux.
 *
 * Aucune dépendance : ces shapes sont reproductibles tel quel en Rust (serde),
 * Swift (Codable) ou Kotlin (kotlinx.serialization).
 */

/** Métadonnées de page renvoyées par l'API (style `Paginated<T>` historique). */
export interface PageMeta {
	/**
	 * Seul `total` est garanti.
	 *
	 * Mesuré sur `GET /clans` : l'API renvoie `{ total, pageCount: null }`. Une
	 * enveloppe de pagination ne doit jamais pouvoir invalider sa charge utile —
	 * exiger ces champs effaçait les 42 clans pour une histoire de compteur.
	 */
	page?: number;
	limit?: number;
	total: number;
	pageCount?: number | null;
}

export interface Paginated<T> {
	data: T[];
	meta: PageMeta;
}

/**
 * Variante « pageSize » utilisée par les contrôleurs récents (casts, sanctions,
 * notes joueur). Conservée distincte de `PageMeta` : les deux formes coexistent
 * réellement sur l'API, les fusionner casserait un des deux appelants.
 */
export interface PageSizeMeta {
	page: number;
	pageSize: number;
	pageCount: number;
}

export interface PagedList<T> {
	data: T[];
	total: number;
	meta: PageSizeMeta;
}

/** Requête de pagination commune à toutes les listes. */
export interface PageQuery {
	page?: number;
	pageSize?: number;
}

export type SortDirection = "asc" | "desc";

export interface SortQuery<TField extends string = string> {
	sortBy?: TField;
	sortDir?: SortDirection;
}

/** Descripteur de colonne — partagé par toutes les tables, quel que soit l'UI. */
export interface Column {
	field: string;
	header: string;
}

/**
 * Pays / langue d'origine d'un clan ou d'une organisation.
 *
 * La table de référence elle-même vit dans
 * `@rosegriffon/achillea-core/reference` : c'est une donnée, pas un contrat.
 */
export interface Country {
	/** Code ISO 639-1 en minuscules (`fr`, `en`, …). */
	code: string;
	/** Libellé de la langue en français (`Français`). */
	language: string;
	/** Chemin du drapeau, relatif aux assets du front. */
	flag: string;
	/** Nom du pays en français (`France`). */
	name: string;
}

export enum SocialMedia {
	X,
	Instagram,
	TikTok,
	Youtube,
	Twitch,
}

export interface SocialMediaDTO {
	platform: SocialMedia;
	username: string;
	canonicalUrl: string;
}

/** Mode d'un formulaire de validation (création / revue / édition). */
export enum FormMode {
	Create,
	Validate,
	Edit,
}
