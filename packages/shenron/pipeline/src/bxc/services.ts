// SPDX-License-Identifier: Apache-2.0
/** BXC domain clients sharing a single CLI contract and service module. */
import { execBxcJson } from "./spawn";
import { AphrodyTranslateService } from "../aphrody/translate";
import { AphrodyFramesClient } from "../aphrody/frames";
import { AphrodyWikiService } from "../aphrody/wiki";
import {
	AnimesamaSearchResultSchema,
	AnimesamaAnimeInfoSchema,
	AnimesamaSeasonEpisodesSchema,
	type AnimesamaSearchResult,
	type AnimesamaAnimeInfo,
	type AnimesamaSeasonEpisodes,
	type AnimesamaGetEpisodesOptions,
	VoiranimeSearchResultSchema,
	VoiranimeAnimeInfoSchema,
	VoiranimeResolvedSourceSchema,
	type VoiranimeSearchResult,
	type VoiranimeAnimeInfo,
	type VoiranimeResolvedSource,
	type WikiSearchResult,
	type WikiPageDossier,
	type TranslationResult,
	type TranslateOptions,
	DbcnVolumeItemSchema,
	DbcnVolumeInfoSchema,
	DbcnSinglePageViewSchema,
	type DbcnCatalogCategory,
	type DbcnVolumeItem,
	type DbcnVolumeInfo,
	type DbcnSinglePageView,
	BxcSearchOutputSchema,
	BxcVectorOutputSchema,
	BxcFramesStatsSchema,
	type BxcSearchOutput,
	type BxcVectorOutput,
	type BxcFramesStats,
	type PlayerEmbed,
	type FrameMatch,
	type BxcSpawnOptions,
} from "./types";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export class AnimesamaService {
  constructor(private readonly defaultOptions: BxcSpawnOptions = {}) {}

  /**
   * Recherche instantanée dans le catalogue Anime-Sama
   * Commande CLI : `bxc animesama search <query>`
   */
  async search(query: string, options?: BxcSpawnOptions): Promise<AnimesamaSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const raw = await execBxcJson<unknown[]>(["animesama", "search", trimmed], {
      ...this.defaultOptions,
      ...options,
    });

    return raw.map((item) => AnimesamaSearchResultSchema.parse(item));
  }

  /**
   * Récupère la fiche détaillée d'un anime
   * Commande CLI : `bxc animesama info <slug>`
   */
  async info(slug: string, options?: BxcSpawnOptions): Promise<AnimesamaAnimeInfo> {
    const trimmed = slug.trim();
    if (!trimmed) throw new Error("Anime slug is required");

    const raw = await execBxcJson<unknown>(["animesama", "info", trimmed], {
      ...this.defaultOptions,
      ...options,
    });

    return AnimesamaAnimeInfoSchema.parse(raw);
  }

  /**
   * Récupère la liste des épisodes et des lecteurs pour une saison/langue donnée
   * Commande CLI : `bxc animesama episodes <slug> --season <season> --lang <lang>`
   */
  async getEpisodes(
    slug: string,
    opts: AnimesamaGetEpisodesOptions = {},
    options?: BxcSpawnOptions
  ): Promise<AnimesamaSeasonEpisodes> {
    const trimmed = slug.trim();
    if (!trimmed) throw new Error("Anime slug is required");

    const season = opts.season || "saison1";
    const lang = opts.lang || "vostfr";

    const args = [
      "animesama",
      "episodes",
      trimmed,
      "--season",
      season,
      "--lang",
      lang,
    ];

    if (opts.profile) {
      args.push("--profile", opts.profile);
    }

    const raw = await execBxcJson<unknown>(args, {
      ...this.defaultOptions,
      ...options,
    });

    return AnimesamaSeasonEpisodesSchema.parse(raw);
  }

  /**
   * Résout une URL d'embed vers son flux direct
   * Commande CLI : `bxc animesama resolve <embedUrl>`
   */
  async resolve(embedUrl: string, options?: BxcSpawnOptions): Promise<unknown> {
    const trimmed = embedUrl.trim();
    if (!trimmed) throw new Error("Embed URL is required");

    return execBxcJson<unknown>(["animesama", "resolve", trimmed], {
      ...this.defaultOptions,
      ...options,
    });
  }
}

export class VoiranimeService {
  constructor(private readonly defaultOptions: BxcSpawnOptions = {}) {}

  /**
   * Recherche un anime dans le catalogue VoirAnime
   * Commande CLI : `bxc voiranime search <query>`
   */
  async search(query: string, options?: BxcSpawnOptions): Promise<VoiranimeSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const raw = await execBxcJson<unknown[]>(["voiranime", "search", trimmed], {
      ...this.defaultOptions,
      ...options,
    });

    return raw.map((item) => VoiranimeSearchResultSchema.parse(item));
  }

  /**
   * Récupère les métadonnées et la liste des épisodes d'un anime sur VoirAnime
   * Commande CLI : `bxc voiranime info <slug>`
   */
  async getAnime(slug: string, options?: BxcSpawnOptions): Promise<VoiranimeAnimeInfo> {
    const trimmed = slug.trim();
    if (!trimmed) throw new Error("Anime slug or URL is required");

    const raw = await execBxcJson<unknown>(["voiranime", "info", trimmed], {
      ...this.defaultOptions,
      ...options,
    });

    return VoiranimeAnimeInfoSchema.parse(raw);
  }

  /**
   * Alias de getAnime pour compatibilité d'interface
   */
  async info(slug: string, options?: BxcSpawnOptions): Promise<VoiranimeAnimeInfo> {
    return this.getAnime(slug, options);
  }

  /**
   * Résout une URL d'embed lecteur en flux média direct (vidmoly, jwplayer, etc.)
   * Commande CLI : `bxc voiranime resolve <embedUrl>`
   */
  async resolve(embedUrl: string, options?: BxcSpawnOptions): Promise<VoiranimeResolvedSource> {
    const trimmed = embedUrl.trim();
    if (!trimmed) throw new Error("Embed URL is required");

    const raw = await execBxcJson<unknown>(["voiranime", "resolve", trimmed], {
      ...this.defaultOptions,
      ...options,
    });

    return VoiranimeResolvedSourceSchema.parse(raw);
  }
}

export class WikiService {
  constructor(private readonly defaultOptions: BxcSpawnOptions = {}) {}

  /**
   * Extrait le contenu d'une page MediaWiki au format Markdown propre
   * Commande CLI : `aphrody web wiki-page <url> --markdown`
   */
  async markdown(url: string, options?: BxcSpawnOptions): Promise<string> {
    const trimmed = url.trim();
    if (!trimmed) throw new Error("Wiki URL is required");

    const timeoutMs = options?.timeoutMs ?? this.defaultOptions.timeoutMs;
    return new AphrodyWikiService({ ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(options?.aphrodyBin ?? this.defaultOptions.aphrodyBin ? { bin: options?.aphrodyBin ?? this.defaultOptions.aphrodyBin } : {}) }).markdown(trimmed);
  }

  /**
   * Alias court `md`
   */
  async md(url: string, options?: BxcSpawnOptions): Promise<string> {
    return this.markdown(url, options);
  }

  /**
   * Recherche plein texte directement SUR le wiki distant via son API MediaWiki
   * Commande CLI : `aphrody web wiki-search <api-url> <query>`
   */
  async search(
    wikiUrl: string,
    query: string,
    limit = 20,
    options?: BxcSpawnOptions
  ): Promise<WikiSearchResult[]> {
    const trimmedUrl = wikiUrl.trim();
    const trimmedQuery = query.trim();
    if (!trimmedUrl) throw new Error("Wiki base URL is required");
    if (!trimmedQuery) return [];

    const timeoutMs = options?.timeoutMs ?? this.defaultOptions.timeoutMs;
    return new AphrodyWikiService({ ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(options?.aphrodyBin ?? this.defaultOptions.aphrodyBin ? { bin: options?.aphrodyBin ?? this.defaultOptions.aphrodyBin } : {}) }).search(trimmedUrl, trimmedQuery, limit);
  }

  /**
   * Récupère le dossier complet d'une page (sections, tableaux, infobox, images, révision)
   * Commande CLI : `aphrody web wiki-page <url>`
   */
  async page(url: string, options?: BxcSpawnOptions): Promise<WikiPageDossier> {
    const trimmed = url.trim();
    if (!trimmed) throw new Error("Wiki URL is required");

    const timeoutMs = options?.timeoutMs ?? this.defaultOptions.timeoutMs;
    return new AphrodyWikiService({ ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(options?.aphrodyBin ?? this.defaultOptions.aphrodyBin ? { bin: options?.aphrodyBin ?? this.defaultOptions.aphrodyBin } : {}) }).page(trimmed);
  }
}

/** Compatibility name; translation execution and fallback policy belong to Rust Aphrody. */
export class GoogleTranslateService {
  private readonly translator: AphrodyTranslateService;
  constructor(defaultOptions: BxcSpawnOptions = {}) {
    this.translator = new AphrodyTranslateService({ timeoutMs: defaultOptions.timeoutMs, bin: defaultOptions.aphrodyBin });
  }
  translate(text: string, target = "en", source = "auto", options: Partial<TranslateOptions> & BxcSpawnOptions = {}): Promise<TranslationResult> {
    return this.translator.translate(text, target, source, {
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.format === undefined ? {} : { format: options.format }),
    });
  }
}

type SnapshotPage = {
	n: number;
	fichier: string;
	poids: string | null;
	image_url?: string | null;
	thumb_url?: string | null;
};
type SnapshotVolume = {
	did: string;
	titre: string | null;
	url_fiche: string;
	premiere_edition: string | null;
	couverture: { source_url: string } | null;
};
type SnapshotCollection = { slug: string; titre: string; ouvrages: SnapshotVolume[] };
type CatalogueSnapshot = { collections: SnapshotCollection[] };

const CATEGORY_TO_COLLECTION: Record<Exclude<DbcnCatalogCategory, "all">, string> = {
	full_color: "dragonball_full_color",
	jp_original: "dragonball_jp_original",
	zh_cn: "dragonball_zh_cn",
	zh_hk: "dragonball_zh_hk_ultimate",
	taiwan: "dragonball_zh_tw",
	kanzenban: "dragonball_jp_kanzenban",
	anime_movie: "dragonball_anime_movie",
	anime_z: "dragonball_anime_z",
	arale_cn: "arale_cn",
	arale_jp: "arale_jp_lib",
	arale_hk: "arale_zh_hk",
};

function snapshotPath(fileName: string): string {
	const configured = process.env.DRAGONBALLCN_SNAPSHOT_DIR?.trim();
	if (configured) return resolve(configured, fileName);

	const candidates = [
		resolve(process.cwd(), "apps/shenron/bot", fileName),
		resolve(process.cwd(), "../apps/bot", fileName),
		// apps/shenron/site runs with cwd = apps/shenron/site (systemd WorkingDirectory): the bot is a sibling.
		resolve(process.cwd(), "../bot", fileName),
	];
	const existing = candidates.find((candidate) => existsSync(candidate));
	if (existing) return existing;
	throw new Error(
		"DragonBallCN snapshot not found. Set DRAGONBALLCN_SNAPSHOT_DIR to the directory containing assets/dragonballcn and data/catalogues."
	);
}

async function readSnapshot(): Promise<{
	catalogue: CatalogueSnapshot;
	pages: Record<string, SnapshotPage[]>;
}> {
	const [catalogue, pages] = await Promise.all([
		Bun.file(snapshotPath("assets/dragonballcn/index.json")).json() as Promise<CatalogueSnapshot>,
		Bun.file(snapshotPath("data/catalogues/dragonballcn-inventaire.json")).json() as Promise<
			Record<string, SnapshotPage[]>
		>,
	]);
	return { catalogue, pages };
}

function collectionFor(
	category: DbcnCatalogCategory,
	collections: SnapshotCollection[]
): SnapshotCollection[] {
	if (category === "all") return collections;
	const slug = CATEGORY_TO_COLLECTION[category];
	return collections.filter((collection) => collection.slug === slug);
}

function categoryFor(collection: SnapshotCollection): string {
	return (
		Object.entries(CATEGORY_TO_COLLECTION).find(([, slug]) => slug === collection.slug)?.[0] ??
		collection.slug
	);
}

/**
 * Compatibility reader for the retired `bxc dragonballcn` CLI.
 *
 * BXC 0.9.13 provides `bxc dragonball`, a different official-source crawl; it
 * has no DragonBallCN catalog/info/view API. The versioned DragonBallCN snapshot
 * is therefore authoritative for this legacy surface. It contains bibliographic
 * metadata and enumerated filenames only. Direct image URLs are exposed when
 * the snapshot provides them; otherwise the public fiche URL remains available.
 */
export class DragonballCnService {
	

	async catalog(
		category: DbcnCatalogCategory = "full_color",
		_options?: BxcSpawnOptions
	): Promise<DbcnVolumeItem[]> {
		const { catalogue } = await readSnapshot();
		return collectionFor(category, catalogue.collections).flatMap((collection) =>
			collection.ouvrages.map((volume) =>
				DbcnVolumeItemSchema.parse({
					id: volume.did,
					title: volume.titre ?? volume.did,
					category: categoryFor(collection),
					categoryTitle: collection.titre,
					coverUrl: volume.couverture?.source_url,
					url: volume.url_fiche,
					date: volume.premiere_edition ?? undefined,
				})
			)
		);
	}

	async info(did: string, _options?: BxcSpawnOptions): Promise<DbcnVolumeInfo> {
		const trimmed = did.trim();
		if (!trimmed) throw new Error("Volume DID is required (e.g. '0-10-1')");

		const { catalogue, pages } = await readSnapshot();
		const volume = catalogue.collections
			.flatMap((collection) => collection.ouvrages)
			.find((item) => item.did === trimmed);
		if (!volume)
			throw new Error(`DragonBallCN volume not found in the versioned snapshot: ${trimmed}`);

		const entries = pages[trimmed] ?? [];
		return DbcnVolumeInfoSchema.parse({
			id: volume.did,
			title: volume.titre ?? volume.did,
			totalPages: entries.length,
			pages: entries.map((page) => ({
				pageNumber: page.n,
				name: page.fichier,
				size: page.poids ?? undefined,
				thumbUrl: page.thumb_url ?? "",
				imageUrl: page.image_url ?? "",
				pageUrl: volume.url_fiche,
			})),
		});
	}

	async view(
		did: string,
		pageNumber?: number,
		_options?: BxcSpawnOptions
	): Promise<DbcnVolumeInfo | DbcnSinglePageView> {
		const volume = await this.info(did);
		if (pageNumber === undefined) return volume;
		if (!Number.isInteger(pageNumber) || pageNumber < 1)
			throw new Error("Page number must be a positive integer");
		const page = volume.pages.find((item) => item.pageNumber === pageNumber);
		if (!page) throw new Error(`Page ${pageNumber} not found in DragonBallCN volume ${volume.id}`);
		return DbcnSinglePageViewSchema.parse(page);
	}

	async download(
		_did: string,
		_opts: { page?: number; out?: string } = {},
		_options?: BxcSpawnOptions
	): Promise<string> {
		throw new Error("No direct DragonBallCN image URL is present in the loaded snapshot.");
	}

	async crawl(_opts: { out?: string } = {}, _options?: BxcSpawnOptions): Promise<DbcnVolumeItem[]> {
		return this.catalog("all");
	}
}

export interface FramesSearchOptions {
  limit?: number;
  anilistId?: number;
  at?: string;
}

/** Compatibility entry point; execution, descriptors and storage belong to Rust Aphrody. */
export class FramesService {
  constructor(private readonly defaultOptions: BxcSpawnOptions = {}) {}

  private client(options: BxcSpawnOptions = {}): AphrodyFramesClient {
    const merged = { ...this.defaultOptions, ...options };
    return new AphrodyFramesClient({
      ...(merged.aphrodyBin ? { bin: merged.aphrodyBin } : {}),
      ...(merged.timeoutMs === undefined ? {} : { timeoutMs: merged.timeoutMs }),
    });
  }

  async vector(imagePath: string, options?: BxcSpawnOptions): Promise<BxcVectorOutput> {
    return BxcVectorOutputSchema.parse(await this.client(options).vector(imagePath));
  }

  async search(imagePath: string, mode: "--local" | "--remote" = "--local", opts: FramesSearchOptions = {}, options?: BxcSpawnOptions): Promise<BxcSearchOutput> {
    return BxcSearchOutputSchema.parse(await this.client(options).search(imagePath, { ...opts, mode }));
  }

  async stats(options?: BxcSpawnOptions): Promise<BxcFramesStats> {
    return BxcFramesStatsSchema.parse(await this.client(options).stats());
  }

  list(filter?: string, options?: BxcSpawnOptions): Promise<unknown> {
    return this.client(options).list(filter);
  }

  quota(options?: BxcSpawnOptions): Promise<unknown> {
    return this.client(options).quota();
  }
}

export class MediaStreamService {
  private readonly animesama: AnimesamaService;
  private readonly voiranime: VoiranimeService;

  constructor(private readonly options: BxcSpawnOptions = {}) {
    this.animesama = new AnimesamaService(options);
    this.voiranime = new VoiranimeService(options);
  }

  /**
   * Résout une URL d'embed vidéo (vido, sibnet, sendvid, etc.) vers son flux direct (HLS ou MP4)
   */
  async resolveEmbed(
    embedUrl: string,
    options?: BxcSpawnOptions
  ): Promise<unknown> {
    const trimmed = embedUrl.trim();
    if (!trimmed) throw new Error("Embed URL is required");

    // Voiranime gère les résolveurs génériques
    try {
      const res = await this.voiranime.resolve(trimmed, options);
      if (res && typeof res === "object") return res;
    } catch {
      // repli sur animesama
    }

    return this.animesama.resolve(trimmed, options);
  }

  /**
   * Recherche un média dans les deux catalogues partenaires (Anime-Sama & VoirAnime)
   */
  async searchMedia(query: string, options?: BxcSpawnOptions) {
    const [asResults, vaResults] = await Promise.allSettled([
      this.animesama.search(query, options),
      this.voiranime.search(query, options),
    ]);
    // Both catalogues down (e.g. bxc binary missing) is an outage, not "no match".
    if (asResults.status === "rejected" && vaResults.status === "rejected") {
      throw asResults.reason instanceof Error ? asResults.reason : new Error(String(asResults.reason));
    }

    return {
      animesama: asResults.status === "fulfilled" ? asResults.value : [],
      voiranime: vaResults.status === "fulfilled" ? vaResults.value : [],
    };
  }

  /**
   * Extrait les lecteurs tiers et les standardise au format PlayerEmbed de nos bases
   */
  normalizePlayers(
    players: Array<{ name?: string; provider?: string; url?: string; embedUrl?: string; lang?: "vf" | "vostfr" }>
  ): PlayerEmbed[] {
    return players
      .map((p) => {
        const embedUrl = p.embedUrl || p.url || "";
        const name = p.name || p.provider || "Lecteur";
        const provider = p.provider || "embed";
        return {
          name,
          provider,
          embedUrl,
          lang: p.lang,
        };
      })
      .filter((p) => p.embedUrl.length > 0);
  }
}

export interface GetMangaPagesOptions {
  /** Identifiant du tome sur DragonBallCN (ex. "0-10-1" pour le tome 1 Full Color) */
  did: string;
  /** Si vrai, ne garde que les URL haute résolution (imageUrl) */
  highResOnly?: boolean;
}

export interface SyncChapterPagesParams {
  did: string;
  series: string;
  chapterNumber?: number;
  volumeId?: number;
}

/**
 * Pont natif entre BXC et nos bases de données (Postgres / SQLite)
 */
export class BxcDbBridge {
  private readonly dragonballcn: DragonballCnService;
  private readonly frames: FramesService;
  private readonly media: MediaStreamService;

  constructor(private readonly options: BxcSpawnOptions = {}) {
    this.dragonballcn = new DragonballCnService(options);
    this.frames = new FramesService(options);
    this.media = new MediaStreamService(options);
  }

  /**
   * Résout directement la liste ordonnée des URLs d'images d'un tome ou chapitre
   * pour alimentation immédiate de la colonne `pages` (jsonb dans Postgres / Neon).
   */
  async resolveMangaPages(
    did: string,
    _options?: { highResOnly?: boolean }
  ): Promise<string[]> {
    const volumeInfo: DbcnVolumeInfo = await this.dragonballcn.info(did, this.options);
    if (!volumeInfo.pages || volumeInfo.pages.length === 0) {
      return [];
    }

    // Par défaut, imageUrl donne l'image haute définition (780x1200+) sans watermark _thumb.
    return volumeInfo.pages.map((p) => p.imageUrl || p.thumbUrl).filter(Boolean);
  }

  /**
   * Construit le payload d'insertion / mise à jour pour `bot.db_manga_chapters`
   */
  async buildChapterPagesPayload(
    did: string
  ): Promise<{ pages: string[]; totalPages: number; title: string }> {
    const volumeInfo = await this.dragonballcn.info(did, this.options);
    const pages = volumeInfo.pages.map((p) => p.imageUrl || p.thumbUrl).filter(Boolean);

    return {
      pages,
      totalPages: volumeInfo.totalPages,
      title: volumeInfo.title,
    };
  }

  /**
   * Valide et normalise le payload des lecteurs pour la colonne `players` de `bot.db_episodes`
   */
  formatEpisodePlayers(players: PlayerEmbed[]): PlayerEmbed[] {
    return this.media.normalizePlayers(players);
  }

  /**
   * Mappe les résultats BXC frames search vers le format d'annotation de frames d'épisodes
   */
  mapFramesToSceneMatches(matches: FrameMatch[]) {
    return matches.map((m) => ({
      title: m.title,
      episode: m.episode,
      season: m.season,
      atMs: m.atMs,
      similarity: Math.round(m.similarity * 1000) / 10,
      source: m.source,
      previewImage: m.preview?.image || "",
      previewVideo: m.preview?.video || "",
    }));
  }
}
