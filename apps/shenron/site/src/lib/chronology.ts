/**
 * Chronologie universelle Dragon Ball — modèle + helpers PURS et CLIENT-SAFE.
 *
 * Aucun import server (pas de `postgres`/drizzle) : utilisable à la fois par le
 * helper server-only `dbUniverse.timeline()` (qui construit le dataset), par le
 * composant public `ChronologyTimeline` (frise FIXE) ET par l'éditeur admin
 * (`/admin/chronologie`, curation). C'est le seul point qui unifie les TROIS
 * espaces de séries disjoints (épisodes `DB/DBZ/DBGT/DBS/DB_DAIMA`, films
 * `DB_MOVIE/DBZ_MOVIE/DBZ_OVA/DBZ_SPECIAL/DBS_MOVIE`, et tomes de manga `DB/DBS`
 * rangés dans l'ère `Manga`) sous des « ères » communes.
 *
 * La chronologie publique est **fixe** : l'ordre officiel est décidé par l'admin
 * (curation `ChronologyConfig` stockée en DB) et appliqué par `applyChronology`.
 * Sans aucune curation, l'ordre est IDENTIQUE à l'ancien tri « ère » auto.
 */

export const ERA_ORDER = ["DB", "DBZ", "GT", "Super", "Daima", "Manga", "Autre"] as const;
export type Era = (typeof ERA_ORDER)[number];

export const ERA_LABELS: Record<Era, string> = {
	DB: "Dragon Ball",
	DBZ: "Dragon Ball Z",
	GT: "Dragon Ball GT",
	Super: "Dragon Ball Super",
	Daima: "Dragon Ball Daima",
	Manga: "Manga",
	Autre: "Autres",
};

/** Couleur d'accent par ère (hex direct → rail/points, indépendant des tokens). */
export const ERA_ACCENT: Record<Era, string> = {
	DB: "#f5a623",
	DBZ: "#ff5a1f",
	GT: "#38b000",
	Super: "#3aa0ff",
	Daima: "#b47cff",
	Manga: "#ec4899",
	Autre: "#9ca3af",
};

/**
 * Normalise un code `series` (épisode OU film) vers une ère commune.
 * Ordre des tests critique : « DB » est un préfixe de tous les autres.
 */
export function eraOf(series: string | null | undefined): Era {
	const s = (series ?? "").toUpperCase();
	if (!s) return "Autre";
	if (s.includes("DAIMA")) return "Daima";
	if (s.includes("GT")) return "GT"; // DBGT
	if (s.startsWith("DBS")) return "Super"; // DBS, DBS_MOVIE, DBS_MANGA
	if (s.startsWith("DBZ")) return "DBZ"; // DBZ, DBZ_KAI, DBZ_MOVIE, DBZ_OVA, DBZ_SPECIAL
	if (s.startsWith("DB")) return "DB"; // DB, DB_MOVIE
	return "Autre";
}

function eraRank(era: Era): number {
	const i = ERA_ORDER.indexOf(era);
	return i === -1 ? ERA_ORDER.length : i;
}

/** Nature d'une entrée : épisode d'anime, film/OVA, ou tome de manga. */
export type TimelineKind = "episode" | "movie" | "manga";

/** Un élément (épisode, film ou tome de manga) de la chronologie universelle. */
export type TimelineItem = {
	kind: TimelineKind;
	id: number;
	href: string;
	title: string;
	titleJa: string | null;
	series: string;
	era: Era;
	/** Numéro dans la série (épisode) ou numéro de tome (manga) ; null pour les films. */
	number: number | null;
	/** Date de diffusion/sortie, epoch SECONDES ; null si inconnue (ex. tomes manga). */
	date: number | null;
	image: string | null;
	hasVf: boolean;
	hasVostfr: boolean;
};

/** Ordre déterministe des natures pour les départages (épisode → film → tome). */
const KIND_RANK: Record<TimelineKind, number> = { episode: 0, movie: 1, manga: 2 };

/** Libellé FR d'une nature (exports). */
const KIND_LABEL: Record<TimelineKind, string> = {
	episode: "épisode",
	movie: "film",
	manga: "tome",
};

/** Pictogramme d'une nature (export markdown). */
const KIND_EMOJI: Record<TimelineKind, string> = { episode: "📺", movie: "🎬", manga: "📖" };

export type SortMode = "era" | "date" | "title";

export const SORT_LABELS: Record<SortMode, string> = {
	era: "Chronologie officielle",
	date: "Diffusion / sortie",
	title: "Titre (A→Z)",
};

/** Clé stable d'une entrée (identique côté public, admin et config). */
export const timelineKey = (it: { kind: TimelineKind; id: number }): string =>
	`${it.kind}:${it.id}`;

const INF = Number.POSITIVE_INFINITY;

/** Comparateur pur pour un mode de tri donné (déterministe, stable via id). */
export function compareTimeline(mode: SortMode): (a: TimelineItem, b: TimelineItem) => number {
	if (mode === "title") {
		return (a, b) => a.title.localeCompare(b.title, "fr") || a.id - b.id;
	}
	if (mode === "date") {
		return (a, b) => {
			const d = (a.date ?? INF) - (b.date ?? INF);
			if (d) return d;
			const e = eraRank(a.era) - eraRank(b.era);
			if (e) return e;
			// Les entrées sans date (tomes manga) restent groupées par série puis numéro
			// (DB 1→42 puis DBS 1→23), pas entrelacées par numéro croisé.
			const s = a.series.localeCompare(b.series);
			if (s) return s;
			return (a.number ?? INF) - (b.number ?? INF) || a.id - b.id;
		};
	}
	// "era" : ère éditoriale → date (les dates manquantes retombent sur série+numéro)
	// → épisode avant film avant tome → id. Interleave les films par date parmi les
	// épisodes ; garde les tomes d'une même série contigus (ils n'ont pas de date).
	return (a, b) => {
		const e = eraRank(a.era) - eraRank(b.era);
		if (e) return e;
		const d = (a.date ?? INF) - (b.date ?? INF);
		if (d) return d;
		const s = a.series.localeCompare(b.series);
		if (s) return s;
		const n = (a.number ?? INF) - (b.number ?? INF);
		if (n) return n;
		if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
		return a.id - b.id;
	};
}

// --- Curation admin (config éditable, appliquée côté public) -----------------

/**
 * Override éditorial d'une entrée (clé `${kind}:${id}`). Tout champ absent =
 * comportement auto (dérivé du dataset brut). Permet à l'admin de « fixer » la
 * chronologie sans toucher aux tables épisodes/films.
 */
export type ChronoOverride = {
	/** Retirée de la frise publique. */
	hidden?: boolean;
	/** Ère forcée (corrige un mauvais bucket auto — ex. un film mal rangé). */
	era?: Era;
	/** Date de diffusion/sortie curatée (epoch SECONDES) — comble les trous (ex. DBGT). */
	date?: number | null;
	/** Titre d'affichage forcé (repli : titre du dataset). */
	title?: string;
	/** Note éditoriale affichée sous l'entrée (contexte, ordre de visionnage…). */
	note?: string;
	/**
	 * Rang manuel DANS l'ère (0-based). Dès qu'une ère porte au moins un rang,
	 * elle est ordonnée strictement par ce rang → ordre « épinglé » par l'admin.
	 */
	sort?: number;
};

/** Curation complète de la chronologie universelle (singleton stocké en DB). */
export type ChronologyConfig = {
	version: 1;
	/** Ordre d'affichage des ères (défaut = `ERA_ORDER`). */
	eraOrder: Era[];
	/** Overrides par clé d'entrée (`${kind}:${id}`). */
	overrides: Record<string, ChronoOverride>;
};

export const DEFAULT_CHRONOLOGY_CONFIG: ChronologyConfig = {
	version: 1,
	eraOrder: [...ERA_ORDER],
	overrides: {},
};

const isEra = (v: unknown): v is Era => (ERA_ORDER as readonly string[]).includes(v as string);

/**
 * Fusionne défensivement un patch (JSON DB / éditeur) → `ChronologyConfig` sûr.
 * Toute valeur invalide est ignorée ; une entrée d'override vide est éliminée
 * (config compacte). Ne throw jamais.
 */
export function resolveChronologyConfig(patch: unknown): ChronologyConfig {
	if (!patch || typeof patch !== "object") return structuredClone(DEFAULT_CHRONOLOGY_CONFIG);
	const p = patch as Record<string, unknown>;

	// eraOrder : uniquement des ères connues, sans doublon, complété par le reste.
	const eraOrder: Era[] = [];
	if (Array.isArray(p.eraOrder)) {
		for (const e of p.eraOrder) if (isEra(e) && !eraOrder.includes(e)) eraOrder.push(e);
	}
	for (const e of ERA_ORDER) if (!eraOrder.includes(e)) eraOrder.push(e);

	// overrides : normalise chaque entrée, ne garde que celles qui portent un champ.
	const overrides: Record<string, ChronoOverride> = {};
	const rawOv = p.overrides;
	if (rawOv && typeof rawOv === "object") {
		for (const [key, v] of Object.entries(rawOv as Record<string, unknown>)) {
			if (!v || typeof v !== "object") continue;
			const o = v as Record<string, unknown>;
			const out: ChronoOverride = {};
			if (o.hidden === true) out.hidden = true;
			if (isEra(o.era)) out.era = o.era;
			if (typeof o.date === "number" && Number.isFinite(o.date)) out.date = Math.round(o.date);
			else if (o.date === null) out.date = null;
			if (typeof o.title === "string" && o.title.trim()) out.title = o.title.trim().slice(0, 300);
			if (typeof o.note === "string" && o.note.trim()) out.note = o.note.trim().slice(0, 600);
			if (typeof o.sort === "number" && Number.isFinite(o.sort)) out.sort = Math.round(o.sort);
			if (Object.keys(out).length > 0) overrides[key] = out;
		}
	}

	return { version: 1, eraOrder, overrides };
}

/** Entrée résolue pour l'affichage (overrides appliqués + note éventuelle). */
export type ResolvedTimelineItem = TimelineItem & { note: string | null };

/**
 * Applique la curation admin au dataset brut → **liste publique FIXE** :
 * overrides (ère/date/titre/note) appliqués, entrées masquées retirées, ordre =
 * ères (`config.eraOrder`) puis, dans chaque ère : rang manuel `sort` s'il en
 * existe au moins un (ordre épinglé), sinon date curatée → numéro → id.
 *
 * Invariant : avec `DEFAULT_CHRONOLOGY_CONFIG`, l'ordre est STRICTEMENT identique
 * à `compareTimeline("era")` sur le dataset brut (aucune régression sans curation).
 */
export function applyChronology(
	items: TimelineItem[],
	config: ChronologyConfig
): ResolvedTimelineItem[] {
	const eraRankOf = (era: Era): number => {
		const i = config.eraOrder.indexOf(era);
		return i === -1 ? config.eraOrder.length : i;
	};

	const sortOf = new Map<string, number>();
	const resolved: ResolvedTimelineItem[] = [];
	for (const it of items) {
		const key = timelineKey(it);
		const ov = config.overrides[key];
		if (ov?.hidden) continue;
		const era = ov?.era ?? it.era;
		resolved.push({
			...it,
			era,
			date: ov && "date" in ov ? (ov.date ?? null) : it.date,
			title: ov?.title ?? it.title,
			note: ov?.note ?? null,
		});
		if (typeof ov?.sort === "number") sortOf.set(key, ov.sort);
	}

	// Une ère est « épinglée » dès qu'une de ses entrées porte un rang manuel.
	const pinnedEras = new Set<Era>();
	for (const it of resolved) if (sortOf.has(timelineKey(it))) pinnedEras.add(it.era);

	resolved.sort((a, b) => {
		const e = eraRankOf(a.era) - eraRankOf(b.era);
		if (e) return e;
		if (pinnedEras.has(a.era)) {
			const sa = sortOf.get(timelineKey(a)) ?? INF;
			const sb = sortOf.get(timelineKey(b)) ?? INF;
			if (sa !== sb) return sa - sb;
		}
		const d = (a.date ?? INF) - (b.date ?? INF);
		if (d) return d;
		const s = a.series.localeCompare(b.series);
		if (s) return s;
		const n = (a.number ?? INF) - (b.number ?? INF);
		if (n) return n;
		if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
		return a.id - b.id;
	});

	return resolved;
}

// --- Formats d'export (chronologie officielle exportable) -------------------

function isoDate(sec: number | null): string {
	if (!sec) return "";
	return new Date(sec * 1000).toISOString().slice(0, 10);
}

export function toJSONExport(items: TimelineItem[]): string {
	return JSON.stringify(
		items.map((it, i) => ({
			ordre: i + 1,
			type: KIND_LABEL[it.kind],
			ere: ERA_LABELS[it.era],
			serie: it.series,
			numero: it.number,
			titre: it.title,
			titre_ja: it.titleJa,
			date: isoDate(it.date),
			url: it.href,
		})),
		null,
		2
	);
}

function csvCell(v: string | number | null): string {
	const s = v === null || v === undefined ? "" : String(v);
	return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSVExport(items: TimelineItem[]): string {
	const header = ["ordre", "type", "ere", "serie", "numero", "titre", "titre_ja", "date", "url"];
	const rows = items.map((it, i) =>
		[
			i + 1,
			KIND_LABEL[it.kind],
			ERA_LABELS[it.era],
			it.series,
			it.number ?? "",
			it.title,
			it.titleJa ?? "",
			isoDate(it.date),
			it.href,
		]
			.map(csvCell)
			.join(",")
	);
	return [header.join(","), ...rows].join("\n");
}

export function toMarkdownExport(items: TimelineItem[]): string {
	const lines = items.map((it, i) => {
		const tag = KIND_EMOJI[it.kind];
		const num = it.number != null ? `${it.kind === "manga" ? "Tome " : "#"}${it.number} ` : "";
		const date = it.date ? ` (${isoDate(it.date)})` : "";
		return `${i + 1}. ${tag} **[${ERA_LABELS[it.era]}]** ${num}${it.title}${date}`;
	});
	return `# Chronologie Dragon Ball — ${items.length} entrées\n\n${lines.join("\n")}\n`;
}
