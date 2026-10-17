/** Result shapes shared by the FFI and WebAssembly loaders of the DBXV2 surface. */

export type Dbxv2Category =
  | "archive"
  | "model"
  | "skeleton"
  | "animation"
  | "battle"
  | "ai"
  | "character"
  | "effect"
  | "texture"
  | "audio"
  | "video"
  | "text"
  | "data"
  | "quest"
  | "ui"
  | "stage"
  | "shader"
  | "system"
  | "unknown";

/** `identify`: magic first, then the file-name extension. */
export interface FormatInfo {
  /** Lower-case catalogue extension (`emb`, `cpk`, `acb`, ...) or `unknown`. */
  format: string;
  category: Dbxv2Category;
  /** Whether `summarize` can turn the buffer into JSON. */
  parsable: boolean;
}

/** One row of a plain CPK file table (canonical `aphrody-nie-formats` entry). */
export interface CpkEntry {
  [field: string]: unknown;
}

/** `summarize`: header-level JSON of a container or gameplay file. */
export interface Summary {
  format: string;
  category: Dbxv2Category;
  data: unknown;
}

/** Operations common to both loaders. Inputs are borrowed bytes; outputs are copies. */
export interface Dbxv2 {
  identify(bytes: Uint8Array, fileName?: string): FormatInfo;
  cpkList(bytes: Uint8Array): CpkEntry[];
  cpkExtract(bytes: Uint8Array, name: string): Uint8Array;
  summarize(bytes: Uint8Array, fileName?: string): Summary;
  /** One WAV image per subsong; empty for a streamed ACB (waveforms live in the sibling AWB). */
  audioToWav(bytes: Uint8Array): Uint8Array[];
}
