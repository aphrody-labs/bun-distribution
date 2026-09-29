import { z } from "zod";

// ==========================================
// 1. ANIME-SAMA SCHEMAS & TYPES
// ==========================================

export const AnimesamaSearchResultSchema = z.object({
  slug: z.string(),
  titre: z.string(),
  titresAlternatifs: z.array(z.string()).default([]),
  url: z.string(),
  image: z.string(),
});
export type AnimesamaSearchResult = z.infer<typeof AnimesamaSearchResultSchema>;

export const AnimesamaSaisonEntrySchema = z.object({
  nom: z.string(),
  chemin: z.string(),
  saison: z.string(),
  langue: z.string(),
  url: z.string(),
  categorie: z.string().optional(),
});
export type AnimesamaSaisonEntry = z.infer<typeof AnimesamaSaisonEntrySchema>;

export const AnimesamaAnimeInfoSchema = z.object({
  slug: z.string(),
  url: z.string(),
  titre: z.string(),
  titresAlternatifs: z.array(z.string()).default([]),
  synopsis: z.string().default(""),
  image: z.string().default(""),
  genres: z.array(z.string()).default([]),
  etat: z.string().optional(),
  annee: z.union([z.number(), z.string()]).optional(),
  nombreEpisodesAnnonce: z.number().optional(),
  studios: z.array(z.string()).default([]),
  saisons: z.array(AnimesamaSaisonEntrySchema).default([]),
  scans: z.array(z.unknown()).default([]),
});
export type AnimesamaAnimeInfo = z.infer<typeof AnimesamaAnimeInfoSchema>;

export const AnimesamaLecteurSchema = z.object({
  index: z.number().optional(),
  nom: z.string().default("Lecteur"),
  hebergeur: z.string().default("unknown"),
  url: z.string(),
});
export type AnimesamaLecteur = z.infer<typeof AnimesamaLecteurSchema>;

export const AnimesamaEpisodeSchema = z.object({
  position: z.number().optional(),
  nom: z.string().default(""),
  numero: z.number().optional(),
  lecteurs: z.array(AnimesamaLecteurSchema).default([]),
});
export type AnimesamaEpisode = z.infer<typeof AnimesamaEpisodeSchema>;

export const AnimesamaSeasonEpisodesSchema = z.object({
  slug: z.string(),
  saison: z.string().default("saison1"),
  langue: z.string().default("vostfr"),
  episodes: z.array(AnimesamaEpisodeSchema).default([]),
});
export type AnimesamaSeasonEpisodes = z.infer<typeof AnimesamaSeasonEpisodesSchema>;

export interface AnimesamaGetEpisodesOptions {
  season?: string;
  lang?: "vostfr" | "vf" | "va" | "var" | "vkr" | "vcn" | "vqc" | "vf1" | "vf2" | string;
  profile?: "static" | "fast" | "http" | "stealth" | "max";
}

// ==========================================
// 2. VOIRANIME SCHEMAS & TYPES
// ==========================================

export const VoiranimeSearchResultSchema = z.object({
  slug: z.string(),
  title: z.string(),
  url: z.string(),
});
export type VoiranimeSearchResult = z.infer<typeof VoiranimeSearchResultSchema>;

export const VoiranimeEpisodeItemSchema = z.object({
  number: z.number().optional(),
  label: z.string().default(""),
  slug: z.string(),
  url: z.string(),
  releaseDate: z.string().optional(),
});
export type VoiranimeEpisodeItem = z.infer<typeof VoiranimeEpisodeItemSchema>;

export const VoiranimeAnimeInfoSchema = z.object({
  title: z.string(),
  slug: z.string(),
  url: z.string(),
  postId: z.number().optional(),
  poster: z.string().default(""),
  synopsis: z.string().default(""),
  isVF: z.boolean().default(false),
  type: z.string().optional(),
  status: z.string().optional(),
  studios: z.array(z.string()).default([]),
  genres: z.array(z.string()).default([]),
  alternativeTitles: z.record(z.string(), z.string()).optional(),
  declaredEpisodes: z.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  rating: z.number().optional(),
  ratingCount: z.union([z.number(), z.string()]).optional(),
  episodes: z.array(VoiranimeEpisodeItemSchema).default([]),
});
export type VoiranimeAnimeInfo = z.infer<typeof VoiranimeAnimeInfoSchema>;

export const VoiranimeResolvedSourceSchema = z.object({
  host: z.string().default("unknown"),
  originalUrl: z.string().optional(),
  directUrl: z.string().optional(),
  hlsUrl: z.string().optional(),
  qualities: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  error: z.string().optional(),
});
export type VoiranimeResolvedSource = z.infer<typeof VoiranimeResolvedSourceSchema>;

// ==========================================
// 3. MEDIAWIKI SCHEMAS & TYPES
// ==========================================

export const WikiSectionSchema = z.object({
  niveau: z.number().default(1),
  titre: z.string(),
  ancre: z.string().default(""),
});
export type WikiSection = z.infer<typeof WikiSectionSchema>;

export const WikiSearchResultSchema = z.object({
  titre: z.string(),
  url: z.string(),
  taille: z.number().optional(),
});
export type WikiSearchResult = z.infer<typeof WikiSearchResultSchema>;

export const WikiPageDossierSchema = z.object({
  url: z.string(),
  titre: z.string(),
  api: z.string().default("api.php"),
  revid: z.number().nullable().optional(),
  sections: z.array(WikiSectionSchema).default([]),
  infobox: z.array(z.record(z.string(), z.unknown())).default([]),
  tableaux: z.array(z.unknown()).default([]),
  images: z.array(z.unknown()).default([]),
  categories: z.array(z.string()).default([]),
  liens_externes: z.array(z.string()).default([]),
  markdown: z.string().optional(),
  wikitext: z.string().nullable().optional(),
  mesures: z.record(z.string(), z.number()).optional(),
});
export type WikiPageDossier = z.infer<typeof WikiPageDossierSchema>;

// ==========================================
// 4. GOOGLE TRANSLATE SCHEMAS & TYPES
// ==========================================

export const TranslateOptionsSchema = z.object({
  target: z.string().default("en"),
  source: z.string().default("auto"),
  format: z.enum(["text", "html"]).default("text"),
  timeoutMs: z.number().default(10000),
});
export type TranslateOptions = z.infer<typeof TranslateOptionsSchema>;

export const TranslationResultSchema = z.object({
  translatedText: z.string(),
  detectedSource: z.string().default("auto"),
  target: z.string(),
  provider: z.enum(["bxc-cli", "lingva", "mymemory", "gemini-free", "cache"]),
  confidence: z.number().optional(),
});
export type TranslationResult = z.infer<typeof TranslationResultSchema>;

// ==========================================
// 5. DRAGONBALLCN SCHEMAS & TYPES
// ==========================================

export type DbcnCatalogCategory =
  | "full_color"
  | "jp_original"
  | "zh_cn"
  | "zh_hk"
  | "taiwan"
  | "kanzenban"
  | "anime_movie"
  | "anime_z"
  | "arale_cn"
  | "arale_jp"
  | "arale_hk"
  | "all";

export const DbcnVolumeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  categoryTitle: z.string().optional(),
  arc: z.string().optional(),
  coverUrl: z.string().optional(),
  url: z.string().optional(),
  date: z.string().optional(),
});
export type DbcnVolumeItem = z.infer<typeof DbcnVolumeItemSchema>;

export const DbcnPageItemSchema = z.object({
  pageNumber: z.number(),
  name: z.string().default(""),
  size: z.string().optional(),
  thumbUrl: z.string().default(""),
  imageUrl: z.string().default(""),
  pageUrl: z.string().default(""),
});
export type DbcnPageItem = z.infer<typeof DbcnPageItemSchema>;

export const DbcnVolumeInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  totalPages: z.number(),
  pages: z.array(DbcnPageItemSchema).default([]),
});
export type DbcnVolumeInfo = z.infer<typeof DbcnVolumeInfoSchema>;

export const DbcnSinglePageViewSchema = z.object({
  pageNumber: z.number(),
  name: z.string().default(""),
  thumbUrl: z.string().default(""),
  imageUrl: z.string().default(""),
  pageUrl: z.string().default(""),
});
export type DbcnSinglePageView = z.infer<typeof DbcnSinglePageViewSchema>;

// ==========================================
// 6. FRAMES (COLORLAYOUT & TRACE.MOE) SCHEMAS & TYPES
// ==========================================

export const FrameMatchPreviewSchema = z.object({
  image: z.string().default(""),
  video: z.string().default(""),
});

export const FrameMatchSchema = z.object({
  title: z.string(),
  episode: z.number().nullable().optional(),
  season: z.number().nullable().optional(),
  fromMs: z.number().default(0),
  atMs: z.number().default(0),
  toMs: z.number().default(0),
  similarity: z.number().default(0),
  source: z.string().default(""),
  anilist: z.number().default(0),
  preview: FrameMatchPreviewSchema.default({ image: "", video: "" }),
});
export type FrameMatch = z.infer<typeof FrameMatchSchema>;

export const BxcSearchOutputSchema = z.object({
  origin: z.string().default("local"),
  matches: z.array(FrameMatchSchema).default([]),
  quota: z
    .object({
      used: z.number(),
      total: z.number(),
    })
    .optional(),
});
export type BxcSearchOutput = z.infer<typeof BxcSearchOutputSchema>;

export const BxcVectorOutputSchema = z.object({
  hash: z.string(),
  vector: z.array(z.number()),
});
export type BxcVectorOutput = z.infer<typeof BxcVectorOutputSchema>;

export const BxcFramesStatsSchema = z.object({
  path: z.string(),
  media: z.number(),
  frames: z.number(),
  durationMs: z.number(),
});
export type BxcFramesStats = z.infer<typeof BxcFramesStatsSchema>;

// ==========================================
// 7. MEDIA STREAMS & PLAYERS SCHEMAS & TYPES
// ==========================================

export const PlayerEmbedSchema = z.object({
  name: z.string(),
  provider: z.string(),
  embedUrl: z.string(),
  lang: z.enum(["vf", "vostfr"]).optional(),
});
export type PlayerEmbed = z.infer<typeof PlayerEmbedSchema>;

export const ResolvedStreamInfoSchema = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
  type: z.string().default("application/x-mpegURL"),
  provider: z.string().optional(),
  at: z.number().default(() => Date.now()),
});
export type ResolvedStreamInfo = z.infer<typeof ResolvedStreamInfoSchema>;

export interface EpisodeResolvedStreams {
  series: string;
  numberInSeries: number;
  players: PlayerEmbed[];
  streams?: Partial<Record<"vf" | "vostfr", ResolvedStreamInfo>>;
}

// ==========================================
// 8. DB BRIDGE OPTIONS & TYPES
// ==========================================

export interface SyncChapterPagesOptions {
  series: string;
  chapterNumber?: number;
  volumeId?: number;
  did: string;
  category?: DbcnCatalogCategory;
}

export interface SyncEpisodePlayersOptions {
  series: string;
  numberInSeries: number;
  players: PlayerEmbed[];
}

export interface ChapterWithPagesResult {
  series: string;
  chapterNumber: number;
  pages: string[];
  source: "database" | "bxc_dragonballcn";
  volumeId?: number | null;
}

// ==========================================
// BXC CLIENT COMMON OPTIONS
// ==========================================

export interface BxcSpawnOptions {
  bxcPath?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

