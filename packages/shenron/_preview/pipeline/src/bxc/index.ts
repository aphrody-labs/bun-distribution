import {
	AnimesamaService,
	BxcDbBridge,
	DragonballCnService,
	FramesService,
	GoogleTranslateService,
	MediaStreamService,
	VoiranimeService,
	WikiService,
} from "./services";
import { resolveBxcPath, execBxc } from "./spawn";
import type { BxcSpawnOptions } from "./types";

export * from "./types";
export * from "./spawn";
export * from "./services";









/**
 * Client universel Bxc pour le backend Shenron (apps/site, apps/bot, worker)
 */
export class BxcBridge {
  public readonly animesama: AnimesamaService;
  public readonly voiranime: VoiranimeService;
  public readonly wiki: WikiService;
  public readonly google: GoogleTranslateService;
  public readonly dragonballcn: DragonballCnService;
  public readonly frames: FramesService;
  public readonly media: MediaStreamService;
  public readonly db: BxcDbBridge;

  constructor(private readonly options: BxcSpawnOptions = {}) {
    this.animesama = new AnimesamaService(this.options);
    this.voiranime = new VoiranimeService(this.options);
    this.wiki = new WikiService(this.options);
    this.google = new GoogleTranslateService(this.options);
    this.dragonballcn = new DragonballCnService(this.options);
    this.frames = new FramesService(this.options);
    this.media = new MediaStreamService(this.options);
    this.db = new BxcDbBridge(this.options);
  }

  /**
   * Vérifie la disponibilité et la version du binaire bxc
   */
  async version(): Promise<string> {
    return execBxc(["--version"], this.options);
  }

  /**
   * Résout le chemin effectif du binaire bxc utilisé
   */
  resolvePath(): string {
    return this.options.bxcPath || resolveBxcPath();
  }
}

/** Instance globale pré-configurée */
export const bxc = new BxcBridge();
