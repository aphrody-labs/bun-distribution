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

/** One row of a plain CPK file table (canonical `aphrody-nie-formats` entry: filename, directory, offset, size). */
export interface CpkEntry {
  [field: string]: unknown;
}

/** `summarize`: header-level JSON of a container or gameplay file. */
export interface Summary {
  format: string;
  category: Dbxv2Category;
  data: unknown;
}

/** Index row of one CPK entry, read from the table of contents by range reads. */
export interface IndexEntry {
  cpk: string;
  path: string;
  offset: number;
  size: number;
  extract_size: number;
  compressed: boolean;
}

/** Assembled character model: flat primitives plus decoded-texture metadata and the skeleton. */
export interface ModelJson {
  name: string;
  vertices: number;
  triangles: number;
  primitives: {
    name: string;
    materialName: string;
    positions: [number, number, number][];
    normals: [number, number, number][];
    uv: [number, number][];
    indices: number[];
    textureIndex: number | null;
  }[];
  textures: { width: number; height: number; format: string }[];
  skeleton: unknown;
}

/** Skinning influences per vertex, up to eight (`[u16; 8]` / `[f32; 8]` in the Rust type). */
export interface AssembledSkin {
  joints: number[][];
  weights: number[][];
}

/** Bone of the assembled skeleton; `inverse_bind` is the 4x4 matrix as stored by the ESK. */
export interface AssembledBone {
  name: string;
  /** CRC32 (IEEE) of the bone name. */
  hash: number;
  parent: number | null;
  local: { scale: [number, number, number]; quat: [number, number, number, number]; translation: [number, number, number] };
  inverse_bind: number[][];
}

/**
 * Field layout of `aphrody_nie_formats::assemble::AssembledModel` (what `aphrody-nie-model-serve`
 * exports to GLB), snake_case as in the Rust struct. `component` is always `Generic`,
 * `embedded_textures` is empty (pixels come from `embToPng`; raster metadata is in `report.textures`).
 */
export interface AssembledModelJson {
  internal_code: string;
  body_glb: string;
  face_glb: string;
  uniform_crc: number;
  primitives: {
    component: "Body" | "Face" | "Uniform" | "Keshin" | "Armed" | "Generic";
    source_index: number;
    material_index: number;
    material_name: string;
    texture_uri: string;
    positions: [number, number, number][];
    normals: [number, number, number][];
    uv0: [number, number][];
    colors: [number, number, number, number][];
    indices: number[];
    skin: AssembledSkin | null;
    piece: string;
  }[];
  embedded_textures: { component: string; name: string; png_bytes: number[] }[];
  skeleton: { source: string; bones: AssembledBone[] } | null;
  aux_textures: unknown[];
  report: { origin: string; textures: { width: number; height: number; format: string }[] };
  strict_materials: boolean;
  animation_clips: unknown[];
  animation_excluded: unknown[];
}

/** Byte-in, byte-out operations common to both loaders. Outputs are copies. */
export interface Dbxv2 {
  identify(bytes: Uint8Array, fileName?: string): FormatInfo;
  cpkList(bytes: Uint8Array): CpkEntry[];
  cpkExtract(bytes: Uint8Array, name: string): Uint8Array;
  summarize(bytes: Uint8Array, fileName?: string): Summary;
  /** One WAV image per subsong; empty for a streamed ACB (waveforms live in the sibling AWB). */
  audioToWav(bytes: Uint8Array): Uint8Array[];
  /** PNG of entry `index` of an EMB container. */
  embToPng(bytes: Uint8Array, index: number): Uint8Array;
  /** EMD (+ optional EMB textures, ESK skeleton) as assembled-model JSON. */
  modelJson(name: string, emd: Uint8Array, emb?: Uint8Array, esk?: Uint8Array): ModelJson;
  /** The same model in the field layout of the Rust `AssembledModel` served by `aphrody-nie-model-serve`. */
  modelAssembledJson(name: string, emd: Uint8Array, emb?: Uint8Array, esk?: Uint8Array): AssembledModelJson;
  /** The same model as binary glTF. */
  modelGlb(name: string, emd: Uint8Array, emb?: Uint8Array, esk?: Uint8Array): Uint8Array;
  /** MP4 (H.264), WebM (VP9) or raw .m2v MPEG-2 stream (DBXV2 movies) of a CRI USM; sniff the magic. */
  usmToVideo(bytes: Uint8Array): Uint8Array;
  /** Validated TTF/OTF/WOFF bytes; Iggy bundles are refused. */
  fontToSfnt(bytes: Uint8Array): Uint8Array;
  /** Decode one xz stream: a `.xz` asset of the DBXV2 origin (pure Rust, no npm xz library). */
  xzDecode(bytes: Uint8Array): Uint8Array;
}

/** Asset kinds of the assets tree; `audio` and `video` are stored raw, the others as `.xz`. */
export type AssetKind = "models" | "textures" | "audio" | "video" | "text" | "data";

/** Reader of the assets tree, from a local directory or the HTTP origin; `.xz`/`.gz` are decoded. */
export interface Dbxv2Assets {
  /** Bytes of `<kind>/<cpk>/<path>` as the game file, whichever way it is stored. */
  readAsset(kind: AssetKind, cpk: string, path: string): Promise<Uint8Array>;
}

/** Window of the extracted bytes of an entry. */
export interface ByteRange {
  start: number;
  length: number;
}

/** On-demand CPK access straight from disk: only the TOC and the requested ranges are read. */
export interface Dbxv2CpkFiles {
  /** `query`: `ext:emb`, a `*`/`?` glob, an exact path, or empty for every entry. */
  cpkFind(cpkPath: string, query?: string): IndexEntry[];
  /** One entry, CRILAYLA decompressed; `range` selects a window of the extracted bytes. */
  cpkRead(cpkPath: string, entry: string, range?: ByteRange): Uint8Array;
}

/** Synchronous ranged reader of a CPK (e.g. over a worker-side file or sync XHR). */
export type RangeReader = (offset: number, length: number) => Uint8Array;

/** The same on-demand access over a ranged reader instead of a path (WebAssembly). */
export interface Dbxv2CpkRanged {
  cpkFind(read: RangeReader, label: string, query?: string): IndexEntry[];
  cpkRead(read: RangeReader, label: string, entry: string, range?: ByteRange): Uint8Array;
}
