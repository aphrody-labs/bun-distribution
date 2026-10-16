// Source: packages/shenron/db/src/bot-schema.ts at 8172f535ce (preserved Git history).
/**
 * Schéma Drizzle du **wiki Dragon Ball**, schéma PostgreSQL `bot`.
 *
 * Source de vérité = PostgreSQL local (`shenron_site`, schéma `bot`). Le SQLite
 * du bot (`apps/shenron/bot/data/bot.db`) n'est qu'un réplica partiel (ni `article`,
 * ni `visible`, ni sections/références canon/databooks) : toute indexation
 * lit PostgreSQL. L'ancien miroir Neon (timer `shenron-neon-sync`) est retiré.
 * Ce schéma est generate-only : `apps/shenron/site/drizzle.config.bot.ts` refuse
 * `push` et `migrate`.
 *
 * Le site lit le wiki **directement ici via Drizzle** (plus de fetch sur l'API
 * REST du bot pour les pages publiques /wiki) → découplé de la dispo du process
 * bot. Toutes les colonnes int SQLite arrivent en `bigint` Postgres, les autres
 * en `text` — on type donc à l'identique. Lecture seule : aucune écriture site.
 *
 * ── INDEX : voir `apps/shenron/site/src/db/bot-indexes.sql` ─────────────────────────
 * Les index de ce schéma ne sont volontairement PAS déclarés ici. Ce fichier
 * n'ayant jamais porté d'`index()`, les tables du wiki n'ont longtemps eu que
 * leur clé primaire (deux tables de jointure n'avaient même pas ça) : mesuré le
 * 2026-08-21, 272 000 balayages séquentiels sur `db_episodes`, 76 000 sur
 * `db_manga_chapters`. Ils vivent désormais dans `bot-indexes.sql`, appliqué par
 * `apps/shenron/site/scripts/apply-bot-indexes.ts`.
 *
 * Pourquoi pas ici : les index qui comptent sont des index PARTIELS
 * (`WHERE visible`) et des GIN `gin_trgm_ops`, que drizzle-kit ne restitue pas
 * fidèlement. Les déclarer produirait un écart permanent au diff — et donc une
 * invitation à lancer un `push` sur le schéma `bot`, qui voudrait droper les
 * colonnes propres à PostgreSQL (`players`, `frames`, `pages`, `subtitles`).
 * Toute modification d'index passe par le fichier SQL, pas par ce fichier.
 */
import { bigint, boolean, integer, jsonb, numeric, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const bot = pgSchema("bot");

/**
 * Frame de scène d'épisode (extraite par le pipeline bot, montée en preview).
 *
 * CONTRAT PARTAGÉ avec `apps/shenron/bot` — SOURCE DE VÉRITÉ = `apps/shenron/bot/src/db/episode-frames.ts`
 * (type `EpisodeFrame`). Le site ne peut pas importer depuis `apps/shenron/bot` → on
 * REDÉFINIT le type ici, IDENTIQUE au bot (le jsonb Neon `bot.db_episodes.frames`
 * remonte tel quel). Champs clés pour l'affichage :
 *  - `imagePath`  : chemin relatif `./assets/ext/db_episodes_frames/...` → passer
 *                   par `assetUrl()` pour l'URL absolue (bot.dragonballfr.com).
 *                   `null` pour un dry-run → frame à filtrer avant rendu.
 *  - `timecodeSec` : position de la frame dans l'épisode (s), ou null.
 *  - `characterNames` : personnages détectés/annotés sur la frame.
 *  - `isNotable`  : frame marquante (mise en avant, candidate hero).
 *  - `caption`/`tags` : métadonnées éditoriales optionnelles (légende, badges).
 */
export type EpisodeFrame = {
  /** Provenance : "ffmpeg" (vidéo locale). */
  source: "ffmpeg";
  /** Id stable côté source (ex. `ffmpeg:dbz:001:00042`). */
  sourceId: string;
  /** URL/chemin d'origine (page wiki, ou chemin de la vidéo source). */
  sourceUrl: string | null;
  /** Numéro d'épisode dans la série (= `db_episodes.number_in_series`). */
  episodeNumber: number;
  /**
   * Chemin d'asset bot RELATIF (`./assets/ext/db_episodes_frames/...`) — servi
   * via `bot.dragonballfr.com/assets/...`. `null` pour un dry-run (frame non écrite).
   */
  imagePath: string | null;
  /** Timecode dans l'épisode en secondes. */
  timecodeSec: number | null;
  width: number | null;
  height: number | null;
  /** Noms de personnages présents (rempli par le merge, livrable séparé). */
  characterNames: string[];
  tags: string[];
  caption: string | null;
  /** Frame marquante (ex. scene-cut fort, épisode de combat). */
  isNotable: boolean;
  /** Ordre stable pour l'affichage. */
  sortOrder: number;
};

/** bigint Neon → number JS (les ID wiki sont petits, < 2^53). */
const int = (name: string) => bigint(name, { mode: "number" });

/**
 * Source citée dans un article wiki long-format (champ `article_sources`).
 * Alimenté par `apps/shenron/bot/scripts/wiki-articles.ts` (grounding RAG). Colonnes
 * PG-only : le reverse-sync Neon→SQLite les ignore (intersection de colonnes),
 * comme `players`/`frames`/`pages`. Seul le lecteur du site les lit.
 */
export type WikiSource = {
  n: number;
  label: string;
  url: string;
  kind: string;
};

/** Trois colonnes communes aux tables éditoriales recevant un article long-format. */
const articleCols = {
  article: text("article"),
  articleSources: jsonb("article_sources").$type<WikiSource[]>(),
  articleUpdatedAt: bigint("article_updated_at", { mode: "number" }),
};

/**
 * Visibilité éditoriale (PG-only) — masque une entité du site public sans la
 * supprimer. Défaut `true`. Comme `articleCols`, colonne posée uniquement sur
 * Postgres (`scripts/add-wiki-visibility.ts`) : le forward-sync exclut ces tables
 * éditoriales et le reverse-sync l'ignore (intersection de colonnes). Les lectures
 * publiques filtrent `visible = true` ; l'admin la bascule via `/api/wiki-visibility`.
 */
const visibleCol = {
  visible: boolean("visible").notNull().default(true),
};

/** Stats custom scouter (label/value/accent) — panneau CharacterStatsPanel. */
export type CharacterStat = {
  label: string;
  value: string;
  accent?: string;
};

export const botCharacters = bot.table("db_characters", {
  id: int("id").primaryKey(),
  name: text("name").notNull(),
  image: text("image"),
  portraitXv2: text("portrait_xv2"), // portrait HQ extrait de Xenoverse 2
  ki: text("ki"),
  maxKi: text("max_ki"),
  race: text("race"),
  gender: text("gender"),
  affiliation: text("affiliation"),
  description: text("description"),
  originPlanetId: int("origin_planet_id"),
  nameJa: text("name_ja"),
  nameRomaji: text("name_romaji"),
  /** Première apparition (épisodes / chapitres / saga). */
  debutEpisodeId: int("debut_episode_id"),
  debutChapterId: int("debut_chapter_id"),
  debutSagaId: int("debut_saga_id"),
  /** Stats custom scouter (jsonb) — CharacterStatsPanel. */
  stats: jsonb("stats").$type<CharacterStat[] | null>(),
  ...articleCols,
  ...visibleCol,
});

export const botPlanets = bot.table("db_planets", {
  id: int("id").primaryKey(),
  name: text("name").notNull(),
  image: text("image"),
  isDestroyed: int("is_destroyed"),
  description: text("description"),
  nameJa: text("name_ja"),
  nameRomaji: text("name_romaji"),
  ...articleCols,
  ...visibleCol,
});

export const botTransformations = bot.table("db_transformations", {
  id: int("id").primaryKey(),
  name: text("name").notNull(),
  image: text("image"),
  ki: text("ki"),
  characterId: int("character_id"),
  ...articleCols,
  ...visibleCol,
});

export const botRaces = bot.table("db_races", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  homePlanetId: int("home_planet_id"),
  description: text("description"),
  ...articleCols,
  ...visibleCol,
});

export const botTechniques = bot.table("db_techniques", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  nameRomaji: text("name_romaji"),
  type: text("type"),
  creatorId: int("creator_id"),
  description: text("description"),
  /**
   * Illustration. Peuplée depuis le catalogue Xenoverse 2 : le portrait d'un
   * personnage qui pratique la technique DANS LE JEU (594 des 825 fiches).
   * Ce n'est pas une attribution — `creator_id` reste ce qu'une phrase de
   * databook a établi, et rien d'autre.
   */
  image: text("image"),
  debutEpisodeId: int("debut_episode_id"),
  debutChapterId: int("debut_chapter_id"),
  ...articleCols,
  ...visibleCol,
});

export const botCharacterTechniques = bot.table("db_character_techniques", {
  characterId: int("character_id").notNull(),
  techniqueId: int("technique_id").notNull(),
});

export const botSagas = bot.table("db_sagas", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  series: text("series"),
  orderIdx: int("order_idx"),
  description: text("description"),
  image: text("image"),
  /**
   * Bornes de la saga dans le manga (PG-only, `scripts/add-character-variants.ts`).
   * Ce sont elles qui rendent la présence d'un personnage MESURABLE : sans
   * plage de tomes, « Goku apparaît-il dans la saga Namek ? » n'a aucune
   * réponse dans la base, seulement dans la tête de celui qui la remplit.
   * Renseignées pour le manga 42 tomes (`bornes-sagas-manga.ts`) ; NULL pour
   * les sagas sans support manga (GT, Daima, films, épisodes spéciaux).
   */
  mangaVolumeStart: int("manga_volume_start"),
  mangaVolumeEnd: int("manga_volume_end"),
  mangaChapterStart: int("manga_chapter_start"),
  mangaChapterEnd: int("manga_chapter_end"),
  /**
   * Bornes de la saga dans la série animée — la seconde source mesurable, et
   * la SEULE pour les 18 sagas sans manga (GT, Daima, DBS anime, films).
   * `episodeSeries` est indispensable : la numérotation repart à 1 dans chaque
   * série, DBZ #1 n'a rien à voir avec DBGT #1.
   */
  episodeSeries: text("episode_series"),
  episodeStart: int("episode_start"),
  episodeEnd: int("episode_end"),
  ...articleCols,
  ...visibleCol,
});

export const botArcs = bot.table("db_arcs", {
  id: int("id").primaryKey(),
  sagaId: int("saga_id"),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  orderIdx: int("order_idx"),
  description: text("description"),
  ...articleCols,
  ...visibleCol,
});

// Jonction N-N personnage ↔ arc (« ce perso apparaît/est pertinent dans cet
// arc »). Colonnes contextuelles optionnelles : `note` (ex. état/rôle du perso
// dans l'arc) et `appearanceImage` (apparence spécifique à l'arc). PK composite
// (character_id, arc_id) posée côté PG. Sert au filtrage /wiki/personnages et à
// l'assignation admin (RelationsPanel, via db_character_arcs).
export const botCharacterArcs = bot.table("db_character_arcs", {
  characterId: int("character_id").notNull(),
  arcId: int("arc_id").notNull(),
  note: text("note"),
  appearanceImage: text("appearance_image"),
});

/**
 * Preuve de présence d'un personnage dans une saga, telle que mesurée sur l'OCR
 * du manga (`scripts/variantes-par-saga.ts`). On stocke le comptage ET son
 * mode d'obtention : une variante amorcée automatiquement ne doit jamais être
 * confondue avec une variante écrite par un rédacteur.
 */
export type VariantEvidence = {
  /**
   * Sources ayant fourni la preuve : "ocr-manga" (texte des planches),
   * "synopsis-episodes" (résumés de la série animée), ou les deux jointes par
   * "+". Ce n'est pas cosmétique : une présence attestée par l'anime seul peut
   * être du remplissage absent du manga, et le lecteur doit pouvoir le savoir.
   */
  methode: string;
  /** Tomes du manga où le nom apparaît, dans la plage de la saga. */
  tomes: number[];
  /** Nombre de planches où le nom apparaît (pas d'occurrences de mots). */
  planches: number;
  /** Épisodes dont le synopsis nomme le personnage. */
  episodes?: number[];
  /** Nombre de synopsis d'épisode où le nom apparaît. */
  synopsis?: number;
  /** Graphies recherchées (nom de la fiche + alias retenus). */
  graphies: string[];
  /** Date de la mesure (epoch ms). */
  mesureAt: number;
};

/** Épisode dont le TITRE nomme le personnage, dans la plage de la saga. */
export type VariantKeyEpisode = { id: number; num: number; title: string };

/**
 * **Une version d'un personnage à une saga donnée** — « Goku, saga Namek ».
 *
 * Table PG-only. Une ligne par couple (personnage, saga), unique. Elle ne redit
 * PAS la fiche : elle ne porte que ce qui change d'une saga à l'autre. Tout
 * champ NULL retombe sur `db_characters` à l'affichage — c'est volontaire :
 * dupliquer la race ou la planète d'origine dans 15 variantes garantirait
 * qu'elles divergent un jour.
 */
export const botCharacterVariants = bot.table("db_character_variants", {
  id: int("id").primaryKey(),
  characterId: int("character_id").notNull(),
  sagaId: int("saga_id").notNull(),
  /** Ancre stable dans l'URL de la fiche (ex. `goku-namek`). */
  slug: text("slug").notNull(),
  /** Libellé de la pilule dans la frise (ex. « Saga Namek »). */
  label: text("label").notNull(),
  /** Nom affiché en tête de la variante (ex. « Son Goku — Saga Namek »). */
  displayName: text("display_name"),
  nameJa: text("name_ja"),
  /** Forme atteinte à cette période (« Super Saiyan », « Ôzaru »…). */
  form: text("form"),
  /** Apparence propre à la saga ; NULL → image de la fiche. */
  image: text("image"),
  /** Âge du personnage à cette période, quand une source le donne. */
  age: int("age"),
  /** Puissance telle qu'une source la chiffre (databook, scouter) — texte. */
  powerLevel: text("power_level"),
  ki: text("ki"),
  maxKi: text("max_ki"),
  /** Rôle tenu dans la saga (« Protagoniste », « Antagoniste », « Soutien »). */
  role: text("role"),
  affiliation: text("affiliation"),
  /** Ce que devient le personnage pendant la saga (markdown). */
  summary: text("summary"),
  /** Faits marquants, un par puce. */
  highlights: jsonb("highlights").$type<string[]>(),
  /** Transformations disponibles à cette période (ids `db_transformations`). */
  transformationIds: jsonb("transformation_ids").$type<number[]>(),
  /** Techniques employées à cette période (ids `db_techniques`). */
  techniqueIds: jsonb("technique_ids").$type<number[]>(),
  /** Premier et dernier tome du manga où le personnage est repéré. */
  firstVolume: int("first_volume"),
  lastVolume: int("last_volume"),
  /** Premier et dernier épisode dont le synopsis nomme le personnage. */
  firstEpisode: int("first_episode"),
  lastEpisode: int("last_episode"),
  /**
   * Épisodes dont le TITRE nomme le personnage — le seul contenu éditorial de
   * la variante qui se mesure. Les transformations et les techniques, elles,
   * ne se mesurent pas : leurs libellés en base viennent des jeux vidéo
   * (« Goku SSJ2 », « Pose de combat G ») et la VF du manga traduit tout —
   * « kamehameha » n'apparaît que sur UNE planche des 7 830 de l'OCR.
   */
  keyEpisodes: jsonb("key_episodes").$type<VariantKeyEpisode[]>(),
  /** Méthode de mesure, ou "editorial" quand la variante est écrite à la main. */
  origin: text("origin"),
  evidence: jsonb("evidence").$type<VariantEvidence | null>(),
  sortOrder: int("sort_order").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
});

/**
 * « Où regarder légalement, et dans quelle langue » — une entrée par offre.
 *
 * À NE PAS confondre avec `players` : `players` porte des lecteurs tiers
 * incrustés en iframe, `availability` porte un lien SORTANT vers l'offre d'un
 * ayant droit. Les deux ne se substituent pas et ne se fusionnent pas.
 *
 * Alimentée par `sync-availability-adn.ts`. `langs` est MESURÉ à chaque
 * relevé (l'API ADN rend les pistes réellement proposées) — une VF retirée du
 * catalogue disparaît donc d'elle-même au run suivant.
 */
export type Availability = {
  /** Fournisseur licencié (`adn`, …). */
  provider: string;
  /** Libellé affiché (« ADN »). */
  label: string;
  /** Page officielle de l'épisode / du film. */
  url: string;
  /** Lecteur officiel incrustable, quand le fournisseur en expose un. */
  embedUrl: string | null;
  /** Pistes proposées. `vostfr` = audio japonais d'origine sous-titré FR. */
  langs: ("vf" | "vostfr")[];
  available: boolean;
  /** Date du relevé (epoch secondes) — dit au lecteur si l'info est fraîche. */
  checkedAt: number;
};

export const botEpisodes = bot.table("db_episodes", {
  id: int("id").primaryKey(),
  series: text("series").notNull(),
  numberInSeries: int("number_in_series"),
  title: text("title"),
  titleJa: text("title_ja"),
  titleRomaji: text("title_romaji"),
  arcId: int("arc_id"),
  airDate: int("air_date"),
  durationSec: int("duration_sec"),
  synopsis: text("synopsis"),
  // Traduction FR générée (script translate-synopsis-fr.ts). Null = pas encore traduit.
  synopsisFr: text("synopsis_fr"),
  /** Page primaire Toei ayant servi aux métadonnées japonaises. */
  officialSourceUrl: text("official_source_url"),
  image: text("image"),
  malId: int("mal_id"),
  videoUrl: text("video_url"),
  // Pistes de sous-titres : [{ lang, label, src }] où `src` est un chemin
  // d'asset bot (assets/subtitles/...) en .vtt ou .srt, ou une URL .vtt.
  // Colonne Neon-only (le reverse-sync l'ignore par intersection de colonnes ;
  // seul le lecteur du site la lit).
  subtitles: jsonb("subtitles").$type<{ lang: string; label: string; src: string }[]>(),
  // Lecteurs externes (voir-anime) : [{ name, provider, embedUrl }] affichés en
  // iframe. Colonne Neon-only, rafraîchie par import-voiranime-players.ts.
  players: jsonb("players").$type<
    {
      name: string;
      provider: string;
      embedUrl: string;
      lang?: "vf" | "vostfr";
    }[]
  >(),
  /** Offres légales relevées (cf. type `Availability`). */
  availability: jsonb("availability").$type<Availability[]>(),
  // Flux résolu (HLS/mp4) + headers requis (Referer), pour le proxy HLS du
  // site qui le relaie à notre player hls.js. Rafraîchi par resolve-streams.ts
  // (tokens ~12 h). Colonnes Neon-only.
  streamUrl: text("stream_url"),
  streamHeaders: jsonb("stream_headers").$type<Record<string, string>>(),
  streamProvider: text("stream_provider"),
  streamAt: bigint("stream_at", { mode: "number" }),
  streams: jsonb("streams").$type<
    Partial<
      Record<
        "vf" | "vostfr",
        {
          url: string;
          headers: Record<string, string>;
          type: string;
          provider?: string;
          at: number;
        }
      >
    >
  >(),
  // Scènes d'épisode : frames extraites (jsonb) + montage MP4 preview animé.
  // Colonnes posées sur Neon ; alimentées par le pipeline bot (extraction +
  // montage). Le reverse-sync Neon→SQLite les ignore (intersection de colonnes).
  frames: jsonb("frames").$type<EpisodeFrame[]>(),
  scenePreview: text("scene_preview"),
  ...visibleCol,
});

export const botMovies = bot.table("db_movies", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  titleRomaji: text("title_romaji"),
  series: text("series"),
  releaseDate: int("release_date"),
  durationMin: int("duration_min"),
  synopsis: text("synopsis"),
  // Traduction FR générée (script translate-synopsis-fr.ts). Null = pas encore traduit.
  synopsisFr: text("synopsis_fr"),
  poster: text("poster"),
  malId: int("mal_id"),
  anilistId: int("anilist_id"),
  trailerUrl: text("trailer_url"),
  videoUrl: text("video_url"),
  subtitles: jsonb("subtitles").$type<{ lang: string; label: string; src: string }[]>(),
  players: jsonb("players").$type<
    {
      name: string;
      provider: string;
      embedUrl: string;
      lang?: "vf" | "vostfr";
    }[]
  >(),
  /** Offres légales relevées (cf. type `Availability`). */
  availability: jsonb("availability").$type<Availability[]>(),
  streamUrl: text("stream_url"),
  streamHeaders: jsonb("stream_headers").$type<Record<string, string>>(),
  streamProvider: text("stream_provider"),
  streamAt: bigint("stream_at", { mode: "number" }),
  streams: jsonb("streams").$type<
    Partial<
      Record<
        "vf" | "vostfr",
        {
          url: string;
          headers: Record<string, string>;
          type: string;
          provider?: string;
          at: number;
        }
      >
    >
  >(),
  ...visibleCol,
});

/** Média galerie jeu (jsonb `media`) — image asset ou trailer YouTube. */
export type GameMediaItem = {
  type: "image" | "youtube";
  url: string;
  caption?: string | null;
};

export const botGames = bot.table("db_games", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  platforms: text("platforms"),
  releaseDate: int("release_date"),
  publisher: text("publisher"),
  developer: text("developer"),
  description: text("description"),
  cover: text("cover"),
  officialUrl: text("official_url"),
  /** Galerie style Steam (screenshots + trailers). */
  media: jsonb("media").$type<GameMediaItem[]>(),
  ...visibleCol,
});

export const botGameCharacters = bot.table("db_game_characters", {
  gameId: int("game_id").notNull(),
  characterId: int("character_id").notNull(),
});

export const botMangaVolumes = bot.table("db_manga_volumes", {
  id: int("id").primaryKey(),
  series: text("series").notNull(),
  volumeNumber: int("volume_number"),
  title: text("title"),
  titleJa: text("title_ja"),
  publishedAt: int("published_at"),
  cover: text("cover"),
  isbn: text("isbn"),
  ...visibleCol,
});

/** Page d'un databook / interview (jsonb `pages`). */
export type DatabookPage = {
  number?: number | string | null;
  image?: string | null;
  text?: string | null;
};

/** Databooks & interviews (PG-only, cf. scripts/add-databooks.ts). */
export const botDatabooks = bot.table("db_databooks", {
  id: int("id").primaryKey(),
  /**
   * Type technique dérivé de `category` à l'écriture :
   * "databook" | "interview" | "artbook" | "guidebook".
   * L'UI n'édite plus ce champ — source de vérité = `category`.
   */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  author: text("author"),
  /** Date de publication (epoch ms) — sert au tri. */
  publishedAt: int("published_at"),
  cover: text("cover"),
  description: text("description"),
  sourceUrl: text("source_url"),
  /**
   * Catégorie unifiée (Databook, Interview, Art Book, Saikyō Jump,
   * V-Jump, Weekly Shonen Jump, Light Novel, Jump Anime Comics,
   * Pamphlet & Fair, Autre). Voir `DATABOOK_CATEGORIES`.
   */
  category: text("category"),
  /** Slots lecteur : numéro + image + texte sous l'image. */
  pages: jsonb("pages").$type<DatabookPage[]>(),
  ...visibleCol,
});

/** Publications dérivées séparées du catalogue de databooks. */
export const botMediaPublications = bot.table("db_media_publications", {
  id: int("id").primaryKey(),
  legacyDatabookId: int("legacy_databook_id").notNull().unique(),
  publicationType: text("publication_type").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  author: text("author"),
  illustrator: text("illustrator"),
  publishedAt: int("published_at"),
  cover: text("cover"),
  description: text("description"),
  pages: jsonb("pages").$type<DatabookPage[]>(),
  ...visibleCol,
});

/** Œuvre média pivot (manga principal, spin-offs, séries de romans). */
export const botMediaWorks = bot.table("media_works", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  kind: text("kind").notNull(),
  series: text("series").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  titleRomaji: text("title_romaji"),
  synopsisFr: text("synopsis_fr"),
  sourceId: text("source_id"),
  ...visibleCol,
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** Édition physique ou numérique rattachée à une œuvre. */
export const botMediaEditions = bot.table("media_editions", {
  id: int("id").primaryKey(),
  workId: int("work_id").notNull(),
  edition: text("edition").notNull(),
  label: text("label").notNull(),
  language: text("language").notNull().default("ja"),
  isbn: text("isbn"),
  publisher: text("publisher"),
  publishedAt: text("published_at"),
  pageColor: text("page_color").notNull().default("nb"),
  scanPolicy: text("scan_policy").notNull().default("self_hosted"),
  ...visibleCol,
});

/** Tome ou volume rattaché à une édition spécifique. */
export const botMediaVolumes = bot.table("media_volumes", {
  id: int("id").primaryKey(),
  editionId: int("edition_id").notNull(),
  legacyVolumeId: int("legacy_volume_id").unique(),
  number: numeric("number").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  cover: text("cover"),
  pageCount: integer("page_count"),
  ...visibleCol,
});

/** Chapitre rattaché à un volume. */
export const botMediaChapters = bot.table("media_chapters", {
  id: int("id").primaryKey(),
  volumeId: int("volume_id").notNull(),
  legacyChapterId: int("legacy_chapter_id").unique(),
  number: numeric("number").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  pages: jsonb("pages").$type<string[]>().default([]),
  ocrStatus: text("ocr_status").notNull().default("unprocessed"),
  ...visibleCol,
});

/** Asset physique unique dédupliqué par son hash SHA-256. */
export const botMediaPageAssets = bot.table("media_page_assets", {
  id: int("id").primaryKey(),
  uri: text("uri").notNull(),
  width: integer("width"),
  height: integer("height"),
  sha256: text("sha256").notNull().unique(),
  sourceId: text("source_id"),
});

/** Référence ordonnée liant un chapitre à son asset physique partagé. */
export const botMediaPageRefs = bot.table("media_page_refs", {
  chapterId: int("chapter_id").notNull(),
  assetId: int("asset_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  pageLabel: text("page_label"),
});

/** Frise chronologique et embranchement narratif unifié. */
export const botNarrativeTimelines = bot.table("narrative_timelines", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  parentId: int("parent_id"),
  sourceId: text("source_id"),
  ...visibleCol,
});

/** Événement narratif unifié (combats, tournois, événements de timeline, guerres). */
export const botNarrativeEvents = bot.table("narrative_events", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  titleRomaji: text("title_romaji"),
  synopsisFr: text("synopsis_fr"),
  timelineId: int("timeline_id").notNull(),
  sagaId: int("saga_id"),
  arcId: int("arc_id"),
  canon: text("canon").notNull().default("unverified"),
  startOrder: numeric("start_order"),
  endOrder: numeric("end_order"),
  sourceId: text("source_id"),
  ...visibleCol,
});

/** Alias et titres alternatifs pour un événement narratif. */
export const botNarrativeEventAliases = bot.table("narrative_event_aliases", {
  eventId: int("event_id").notNull(),
  alias: text("alias").notNull(),
  locale: text("locale").notNull().default("fr"),
});

/** Participants d'un événement narratif et statut d'issue (vainqueur, défait, etc.). */
export const botNarrativeEventParticipants = bot.table("narrative_event_participants", {
  eventId: int("event_id").notNull(),
  characterId: int("character_id").notNull(),
  role: text("role").notNull().default("participant"),
  outcome: text("outcome"),
});

/** Relations typées au sein du graphe narratif (adaptation_of, variant_of, contains, precedes). */
export const botNarrativeEventRelations = bot.table("narrative_event_relations", {
  fromEventId: int("from_event_id").notNull(),
  toEventId: int("to_event_id").notNull(),
  relation: text("relation").notNull(),
});

/** Créateurs, auteurs, réalisateurs, comédiens et staff encyclopédique. */
export const botContributors = bot.table("contributors", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  nameRomaji: text("name_romaji"),
  category: text("category").notNull(),
  birthDate: text("birth_date"),
  deathDate: text("death_date"),
  biographyFr: text("biography_fr"),
  spotlightRank: integer("spotlight_rank"),
  sourceId: text("source_id"),
  ...visibleCol,
});

/** Crédits précis associant un contributeur à une œuvre, épisode, film, jeu, morceau. */
export const botContributorCredits = bot.table("contributor_credits", {
  id: int("id").primaryKey(),
  contributorId: int("contributor_id").notNull(),
  role: text("role").notNull(),
  creditScope: text("credit_scope").notNull(),
  workId: int("work_id"),
  episodeId: int("episode_id"),
  movieId: int("movie_id"),
  gameId: int("game_id"),
  soundtrackId: int("soundtrack_id"),
  characterId: int("character_id"),
  sourceId: text("source_id"),
  ...visibleCol,
});

export const botMangaChapters = bot.table("db_manga_chapters", {
  id: int("id").primaryKey(),
  series: text("series").notNull(),
  chapterNumber: int("chapter_number"),
  title: text("title"),
  titleJa: text("title_ja"),
  volumeId: int("volume_id"),
  publishedAt: int("published_at"),
  cover: text("cover"),
  // Pages du chapitre = liste ordonnée de chemins d'images (assetUrl côté site).
  // Colonne Neon-only : le reverse-sync Neon→SQLite l'ignore (intersection de
  // colonnes), le bot n'en a pas besoin (seul le reader du site lit les pages).
  pages: jsonb("pages").$type<string[]>(),
  ...visibleCol,
});

/**
 * OCR planches manga (PG miroir de bot SQLite `db_manga_pages`).
 * Une ligne = une planche : texte OCR + métadonnées (série/tome/n°).
 * 12k+ lignes en prod — éditable depuis wiki-admin /admin/database.
 */
export const botMangaPages = bot.table("db_manga_pages", {
  id: int("id").primaryKey(),
  series: text("series"),
  tome: text("tome"),
  planche: int("planche"),
  /** Bulles OCR (json array de strings) — stocké text/jsonb selon sync. */
  lines: text("lines"),
  text: text("text"),
  lang: text("lang"),
  hasJa: int("has_ja"),
  lineCount: int("line_count"),
  charCount: int("char_count"),
});

export const botNews = bot.table("db_news", {
  id: int("id").primaryKey(),
  sourceId: text("source_id"),
  sourceUrl: text("source_url"),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  excerpt: text("excerpt"),
  category: text("category"),
  publishedAt: int("published_at"),
  fetchedAt: int("fetched_at"),
  image: text("image"),
});

export const botTools = bot.table("db_tools", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  url: text("url"),
  author: text("author"),
  language: text("language"),
  category: text("category"),
  targetGameId: int("target_game_id"),
  stars: int("stars"),
  /** Dépôt archivé en amont sur GitHub. */
  archived: boolean("archived").notNull().default(false),
  /** Dernier push amont (epoch ms) — repère de dépôt mort. */
  pushedAt: int("pushed_at"),
  /** Dernier rafraîchissement GitHub (epoch ms). */
  checkedAt: int("checked_at"),
  ...visibleCol,
});

export const botSources = bot.table("db_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url"),
  licenseKey: text("license_key"),
  attributionTemplate: text("attribution_template"),
});

export const botLicenses = bot.table("db_licenses", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  url: text("url"),
  requiresAttribution: int("requires_attribution"),
  shareAlike: int("share_alike"),
});

export const botAssets = bot.table("db_assets", {
  id: int("id").primaryKey(),
  path: text("path").notNull(),
  sourceId: text("source_id"),
  sourceUrl: text("source_url"),
  licenseKey: text("license_key"),
  attribution: text("attribution"),
  sha256: text("sha256"),
  mimeType: text("mime_type"),
  bytes: int("bytes"),
  width: int("width"),
  height: int("height"),
  entityType: text("entity_type"),
  entityId: int("entity_id"),
  role: text("role"),
  createdAt: int("created_at"),
});

/**
 * Sections de contenu éditorial par entité wiki (PG-only, `scripts/add-wiki-sections.ts`).
 * Chaque ligne = un bloc markdown riche nommé (« Histoire », « Personnalité »,
 * « Anecdotes », « PWS »…) attaché à une entité (`entity_type` + `entity_id`),
 * réordonnable (`sort_order`) et masquable (`visible`). Rendu sur la page détail
 * en sélecteur de catégories ; édité depuis le studio admin. Table PG-only : ni
 * poussée ni écrasée par les syncs (absente de toute liste de tables).
 */
/** Carte « page wiki affiliée » attachée à une section : lien interne + photo. */
export type WikiSectionLink = {
  /** Chemin interne (ex. "/wiki/personnages/12"). */
  href: string;
  /** Libellé affiché (nom de l'entité liée). */
  label: string;
  /** URL absolue de la photo (assetUrl), optionnelle. */
  image?: string;
  /** Sous-titre optionnel (ex. race, ère…). */
  sub?: string;
};

export const botWikiSections = bot.table("db_wiki_sections", {
  id: int("id").primaryKey(),
  /** Type d'entité parente ("character", "planet", "saga", "race", "technique", "arc", "game", "movie"). */
  entityType: text("entity_type").notNull(),
  entityId: int("entity_id").notNull(),
  /** Slug de section ("histoire", "personnalite", "anecdotes", "pws"…) — libre. */
  key: text("key").notNull(),
  /** Libellé affiché (pilule + titre du bloc). */
  label: text("label").notNull(),
  /** Couleur d'accent du bandeau (orange|blue|red|green|purple|gold|cyan|pink), défaut orange. */
  accent: text("accent"),
  /** Corps markdown riche (rendu via WikiMarkdown). */
  body: text("body"),
  /** Sous-catégorie : nom d'un GROUPE parent qui regroupe plusieurs sections
   *  (ex. « Powerscaling »). NULL = section de 1er niveau. */
  groupLabel: text("group_label"),
  /** Pages wiki affiliées : cartes avec photo (liens internes). */
  links: jsonb("links").$type<WikiSectionLink[]>(),
  sortOrder: int("sort_order").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
});

/** Page ou planche issue de l'archive DragonBallCN. */
export type DragonballcnPageItem = {
  pageNumber: number;
  name: string;
  size?: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
};

/** Volumes et archives complètes DragonBallCN (364 tomes, manga couleur, kanzenban, anime comics, databooks). */
export const botDragonballcnVolumes = bot.table("dragonballcn_volumes", {
  did: text("did").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  categoryTitle: text("category_title"),
  arc: text("arc"),
  coverUrl: text("cover_url"),
  url: text("url"),
  date: text("date"),
  totalPages: int("total_pages").notNull().default(0),
  pages: jsonb("pages").$type<DragonballcnPageItem[]>().notNull(),
  scrapedAt: int("scraped_at"),
  updatedAt: int("updated_at"),
});

/** Combattant participant à un affrontement. */
export type BattleCombatant = {
  characterId?: number;
  name: string;
  role?: string;
  side: "a" | "b" | "neutral";
};

/** Combats et affrontements majeurs de l'univers Dragon Ball. */
export const botBattles = bot.table("db_battles", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  sagaId: int("saga_id"),
  arcId: int("arc_id"),
  series: text("series").notNull(),
  combatants: jsonb("combatants").$type<BattleCombatant[]>().notNull(),
  winnerId: int("winner_id"),
  winnerName: text("winner_name"),
  location: text("location"),
  mangaVolumeStart: int("manga_volume_start"),
  mangaVolumeEnd: int("manga_volume_end"),
  mangaChapterStart: int("manga_chapter_start"),
  mangaChapterEnd: int("manga_chapter_end"),
  episodeStart: int("episode_start"),
  episodeEnd: int("episode_end"),
  techniquesUsed: jsonb("techniques_used").$type<string[]>(),
  climaxSummary: text("climax_summary"),
  canon: boolean("canon").notNull().default(true),
  impactLevel: int("impact_level").default(3),
  ...articleCols,
  ...visibleCol,
});

/** Événement de la chronologie universelle par Âge diégétique (Daizenshuu 7 / Chōzenshū). */
export const botTimelineEvents = bot.table("db_timeline_events", {
  id: int("id").primaryKey(),
  ageYear: int("age_year").notNull(),
  ageMonth: int("age_month"),
  ageDay: int("age_day"),
  era: text("era").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  description: text("description").notNull(),
  charactersInvolved: jsonb("characters_involved").$type<string[]>(),
  sourceRef: text("source_ref"),
  canon: boolean("canon").notNull().default(true),
  orderIdx: int("order_idx").notNull().default(0),
  ...visibleCol,
});

/** Niveaux de puissance (Battle Power) officiels Scouter & Daizenshuu 7. */
export const botPowerLevels = bot.table("db_power_levels", {
  id: int("id").primaryKey(),
  characterId: int("character_id"),
  characterName: text("character_name").notNull(),
  form: text("form"),
  sagaId: int("saga_id"),
  sagaName: text("saga_name"),
  battlePower: bigint("battle_power", { mode: "number" }),
  battlePowerDisplay: text("battle_power_display").notNull(),
  scouterDevice: text("scouter_device"),
  sourceKind: text("source_kind").notNull(),
  sourcePage: text("source_page"),
  canon: boolean("canon").notNull().default(true),
  notes: text("notes"),
  ...visibleCol,
});

/** Objets, artefacts, technologies et reliques de l'univers Dragon Ball. */
export const botItems = bot.table("db_items", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  nameRomaji: text("name_romaji"),
  category: text("category").notNull(),
  creator: text("creator"),
  description: text("description").notNull(),
  debutChapter: text("debut_chapter"),
  debutEpisode: text("debut_episode"),
  image: text("image"),
  ...articleCols,
  ...visibleCol,
});

/** Dragons sacrés (Shenron, Polunga, Super Shenron, Toronbo, Ultimate Shenron). */
export const botDragons = bot.table("db_dragons", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  creator: text("creator"),
  planetRealm: text("planet_realm"),
  ballsCount: int("balls_count").notNull().default(7),
  ballsDiameter: text("balls_diameter"),
  summonPhrase: text("summon_phrase"),
  summonPhraseJa: text("summon_phrase_ja"),
  wishesCount: int("wishes_count").notNull().default(1),
  cooldown: text("cooldown"),
  rules: text("rules"),
  image: text("image"),
  ...articleCols,
  ...visibleCol,
});

/** Vœux exaucés par les dragons sacrés dans l'histoire canonique et les récits. */
export const botWishes = bot.table("db_wishes", {
  id: int("id").primaryKey(),
  dragonId: int("dragon_id").notNull(),
  dragonName: text("dragon_name").notNull(),
  wishNumberInSummon: int("wish_number_in_summon").default(1),
  whisperer: text("whisperer").notNull(),
  saga: text("saga").notNull(),
  mangaChapter: int("manga_chapter"),
  episodeNumber: int("episode_number"),
  wishText: text("wish_text").notNull(),
  granted: boolean("granted").notNull().default(true),
  canon: boolean("canon").notNull().default(true),
  ...visibleCol,
});

/** Événement clé ou fait marquant lié à un lieu. */
export type LocationKeyEvent = {
  title: string;
  description: string;
  mangaRef?: string;
};

/** Lieux mythiques, sanctuaires et géographie de l'univers Dragon Ball. */
export const botLocations = bot.table("db_locations", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  nameRomaji: text("name_romaji"),
  realmType: text("realm_type").notNull(),
  planet: text("planet"),
  description: text("description").notNull(),
  debutChapter: text("debut_chapter"),
  debutEpisode: text("debut_episode"),
  keyEvents: jsonb("key_events").$type<LocationKeyEvent[]>(),
  image: text("image"),
  ...articleCols,
  ...visibleCol,
});

/** Match notable d'un tournoi. */
export type TournamentMatch = {
  round: string;
  fighterA: string;
  fighterB: string;
  winner: string;
  techniqueOrClimax?: string;
};

/** Tournois et championnats d'arts martiaux de l'univers Dragon Ball. */
export const botTournaments = bot.table("db_tournaments", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  tournamentType: text("tournament_type").notNull(),
  saga: text("saga").notNull(),
  location: text("location"),
  winnerName: text("winner_name"),
  runnerUpName: text("runner_up_name"),
  rulesSummary: text("rules_summary").notNull(),
  participantsCount: int("participants_count"),
  notableMatches: jsonb("notable_matches").$type<TournamentMatch[]>(),
  canon: boolean("canon").notNull().default(true),
  ...articleCols,
  ...visibleCol,
});

/** Rôle vocal d'un comédien de doublage ou seiyū. */
export type VoiceActorRole = {
  characterName: string;
  series?: string;
  notes?: string;
};

/** Comédiens de doublage et seiyū légendaires (japonais et français). */
export const botVoiceActors = bot.table("db_voice_actors", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameJa: text("name_ja"),
  nationality: text("nationality").notNull(),
  birthDate: text("birth_date"),
  roles: jsonb("roles").$type<VoiceActorRole[]>().notNull(),
  biography: text("biography").notNull(),
  image: text("image"),
  ...articleCols,
  ...visibleCol,
});

/** Bandes originales, génériques et musiques cultes de Dragon Ball. */
export const botSoundtracks = bot.table("db_soundtracks", {
  id: int("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  titleJa: text("title_ja"),
  titleRomaji: text("title_romaji"),
  trackType: text("track_type").notNull(),
  series: text("series").notNull(),
  artist: text("artist").notNull(),
  composer: text("composer"),
  lyricist: text("lyricist"),
  episodesRange: text("episodes_range"),
  releaseYear: int("release_year"),
  description: text("description").notNull(),
  ...articleCols,
  ...visibleCol,
});
