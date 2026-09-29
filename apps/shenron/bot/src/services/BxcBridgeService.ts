import type { SQL } from "bun";
import { inject, singleton } from "tsyringe";
import {
  bxc,
  type DbcnCatalogCategory,
  type DbcnVolumeItem,
  type DbcnVolumeInfo,
  type DbcnSinglePageView,
  type BxcSearchOutput,
  type BxcVectorOutput,
  type BxcFramesStats,
} from "~/lib/bxc";
import { logger } from "~/lib/logger";
import { DatabaseService } from "~/db";
import { PgService } from "~/db/pg";

@singleton()
export class BxcBridgeService {
  private pgSignale = false;

  constructor(
    @inject(DatabaseService) private readonly dbService: DatabaseService,
    @inject(PgService) private readonly pg: PgService
  ) {}

  /** Pool PostgreSQL partagé du bot (`PgService`, B2), ou `null` sans base. */
  private getPgClient(): SQL | null {
    const handle = this.pg.get();
    if (handle) return handle.sql;
    if (!this.pgSignale) {
      this.pgSignale = true;
      logger.info("[bxc-service] Pas de DATABASE_URL PostgreSQL disponible (mode SQLite local actif)");
    }
    return null;
  }

  /**
   * Vérifie la disponibilité et la version du moteur BXC
   */
  async getStatus(): Promise<{ available: boolean; version?: string; binaryPath: string }> {
    const binaryPath = bxc.resolvePath();
    try {
      const version = await bxc.version();
      return { available: true, version, binaryPath };
    } catch (err) {
      logger.warn({ err }, "[bxc-service] BXC n'est pas joignable");
      return { available: false, binaryPath };
    }
  }

  // =========================================================================
  // DRAGONBALLCN (Manga Scans & Archives)
  // =========================================================================

  /**
   * Liste les tomes d'une catégorie du catalogue dragonballcn
   */
  async getDragonballCnCatalog(
    category: DbcnCatalogCategory = "full_color"
  ): Promise<DbcnVolumeItem[]> {
    return bxc.dragonballcn.catalog(category);
  }

  /**
   * Récupère la liste de toutes les pages haute définition d'un tome (ex: 0-10-1)
   */
  async getDragonballCnVolume(did: string): Promise<DbcnVolumeInfo> {
    return bxc.dragonballcn.info(did);
  }

  /**
   * Récupère les métadonnées et l'URL d'une page précise d'un tome
   */
  async getDragonballCnPage(did: string, pageNumber: number): Promise<DbcnVolumeInfo | DbcnSinglePageView> {
    return bxc.dragonballcn.view(did, pageNumber);
  }

  /**
   * Synchronise les pages d'un tome ou chapitre de DragonBallCN vers la colonne `pages` (jsonb)
   * de `bot.db_manga_chapters` sur PostgreSQL.
   */
  async syncChapterPagesToPg(
    did: string,
    series: string,
    chapterNumber: number
  ): Promise<{ success: boolean; totalPages: number }> {
    const pg = this.getPgClient();
    if (!pg) {
      throw new Error("Connexion PostgreSQL indisponible pour synchroniser les pages");
    }

    const payload = await bxc.db.buildChapterPagesPayload(did);
    const pagesJson = JSON.stringify(payload.pages);

    await pg`
      UPDATE bot.db_manga_chapters
      SET pages = ${pagesJson}::jsonb
      WHERE series = ${series} AND chapter_number = ${chapterNumber}
    `;

    logger.info(
      { series, chapterNumber, totalPages: payload.totalPages },
      "[bxc-service] Pages de chapitre synchronisées dans PostgreSQL"
    );

    return { success: true, totalPages: payload.totalPages };
  }

  // =========================================================================
  // FRAMES (ColorLayout DCT & Trace.moe)
  // =========================================================================

  /**
   * Recherche à quel épisode et timecode correspond une image
   */
  async searchFrame(
    imagePath: string,
    mode: "--local" | "--remote" = "--local",
    limit = 5
  ): Promise<BxcSearchOutput> {
    return bxc.frames.search(imagePath, mode, { limit });
  }

  /**
   * Calcule le vecteur MPEG-7 ColorLayout 33 coefficients d'une image
   */
  async vectorizeFrame(imagePath: string): Promise<BxcVectorOutput> {
    return bxc.frames.vector(imagePath);
  }

  /**
   * Statistiques de l'index de frames local (~1M frames)
   */
  async getFramesStats(): Promise<BxcFramesStats> {
    return bxc.frames.stats();
  }

  // =========================================================================
  // MEDIA STREAMS & PLAYERS (Anime-Sama & VoirAnime)
  // =========================================================================

  /**
   * Résout une URL d'embed lecteur (sibnet, vido, streamwish...) vers le flux direct (HLS/MP4)
   */
  async resolveMediaStream(embedUrl: string): Promise<unknown> {
    return bxc.media.resolveEmbed(embedUrl);
  }

  /**
   * Recherche un anime sur Anime-Sama et VoirAnime
   */
  async searchMedia(query: string) {
    return bxc.media.searchMedia(query);
  }

  // =========================================================================
  // TRANSLATION
  // =========================================================================

  /**
   * Traduit un texte Dragon Ball avec fallback multi-fournisseurs
   */
  async translate(text: string, target = "fr", source = "ja") {
    return bxc.google.translate(text, target, source);
  }
}
