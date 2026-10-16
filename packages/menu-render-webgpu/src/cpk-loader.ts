import { cpk_parse_entries, cpk_extract_file, crilayla_decompress, detect_format } from "./wasm/nie_wasm.js";

export interface CpkEntry {
  path: string;
  offset: number;
  size: number;
  compressed_size: number;
  extracted_size: number;
  [key: string]: unknown;
}

/**
 * Chargeur d'assets virtuel lisant directement depuis les fichiers CPK bruts du jeu.
 * Utilise les fonctions WebAssembly de nie-wasm pour parser les TOC et extraire/décompresser à la volée.
 */
export class CpkLoader {
  private cpkBytes: Uint8Array;
  private cpkFilename: string;
  private entries: Map<string, string> = new Map(); // chemin logique minuscules -> CpkEntry JSON string

  constructor(cpkBytes: Uint8Array, cpkFilename: string) {
    this.cpkBytes = cpkBytes;
    this.cpkFilename = cpkFilename;
  }

  /**
   * Parse la table des matières (TOC) de l'archive CPK.
   */
  async init(): Promise<void> {
    const tocJson = cpk_parse_entries(this.cpkBytes, this.cpkFilename);
    const parsedEntries = JSON.parse(tocJson) as CpkEntry[];

    for (const entry of parsedEntries) {
      if (entry.path) {
        const key = entry.path.toLowerCase().replace(/\\/g, "/");
        this.entries.set(key, JSON.stringify(entry));
      }
    }
  }

  /**
   * Retourne vrai si le fichier spécifié est présent dans l'archive.
   */
  hasFile(logicalPath: string): boolean {
    const key = logicalPath.toLowerCase().replace(/\\/g, "/");
    return this.entries.has(key);
  }

  /**
   * Extrait et décompresse un fichier directement depuis l'archive CPK en mémoire.
   */
  extractFile(logicalPath: string): Uint8Array {
    const key = logicalPath.toLowerCase().replace(/\\/g, "/");
    const entryJson = this.entries.get(key);
    if (!entryJson) {
      throw new Error(`Fichier non trouvé dans le CPK : ${logicalPath}`);
    }

    const extracted = cpk_extract_file(this.cpkBytes, this.cpkFilename, entryJson);
    const fmt = detect_format(extracted);

    if (fmt === "CRILAYLA") {
      const decompressed = crilayla_decompress(extracted);
      return new Uint8Array(decompressed);
    }

    return new Uint8Array(extracted);
  }
}
