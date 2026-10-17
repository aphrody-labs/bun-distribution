export interface NativeVideoMetadata {
  width: number;
  height: number;
  duration: number | null;
  codec: string;
  container: string;
  fpsNumerator: number;
  fpsDenominator: number;
  frameCount: number;
  fileBytes: number;
  audioStreams: NativeVideoAudioStream[];
}

export interface NativeVideoAudioStream {
  sampleRate: number;
  channels: number;
  codec: string;
}

export interface NativeVideoRgba {
  width: number;
  height: number;
  channels: 4;
  data: Uint8Array;
  iccProfile: Uint8Array | null;
}

export interface NativeVideoFrame {
  time: number;
  bytes: Uint8Array;
}

export interface NativeVideoFramesOptions {
  start?: number;
  end?: number;
  step?: number;
  maxFrames?: number;
}

export interface NativeVideoAudioOptions {
  start?: number;
  duration?: number;
  stream?: number;
  sampleRate?: number;
}

export interface NativeVideoGifOptions {
  start?: number;
  duration?: number;
  fps?: number;
  width?: number;
}

export interface NativeVideoOptions {
  maxPixels?: number;
  autoOrient?: boolean;
}

export interface NativeVideo {
  frame(seconds: number): this;
  resize(width: number, height?: number, options?: NativeVideoResizeOptions): this;
  extract(rectangle: NativeVideoRectangle): this;
  rotate(degrees: number): this;
  flip(): this;
  flop(): this;
  modulate(options: NativeVideoModulateOptions): this;
  png(options?: NativeVideoPngOptions): this;
  jpeg(options?: NativeVideoJpegOptions): this;
  webp(options?: NativeVideoWebpOptions): this;
  heic(options?: { quality?: number }): this;
  avif(options?: { quality?: number }): this;
  bytes(): Promise<Uint8Array>;
  rgba(): Promise<NativeVideoRgba>;
  buffer(): Promise<Buffer>;
  toBuffer(): Promise<Buffer>;
  toBase64(): Promise<string>;
  dataurl(): Promise<string>;
  toDataURL(): Promise<string>;
  placeholder(as?: "dataurl"): Promise<string>;
  blob(): Promise<Blob>;
  write(destination: string | Bun.BunFile | number): Promise<number>;
  metadata(): Promise<NativeVideoMetadata>;
  frames(options: NativeVideoFramesOptions): Promise<NativeVideoFrame[]>;
  audio(options: NativeVideoAudioOptions): Promise<Uint8Array>;
  remux(destination: string): Promise<number>;
  gif(options: NativeVideoGifOptions): Promise<Uint8Array>;
  readonly width: number;
  readonly height: number;
}

export interface NativeVideoRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface NativeVideoResizeOptions {
  filter?:
    | "nearest"
    | "box"
    | "bilinear"
    | "linear"
    | "cubic"
    | "mitchell"
    | "lanczos2"
    | "lanczos3"
    | "mks2013"
    | "mks2021";
  fit?: "fill" | "inside";
  withoutEnlargement?: boolean;
}

export interface NativeVideoModulateOptions {
  brightness?: number;
  saturation?: number;
}

export interface NativeVideoPngOptions {
  compressionLevel?: number;
  palette?: boolean;
  colors?: number;
  dither?: boolean;
}

export interface NativeVideoJpegOptions {
  quality?: number;
  progressive?: boolean;
}

export interface NativeVideoWebpOptions {
  quality?: number;
  lossless?: boolean;
}

interface NativeVideoConstructor {
  new (input: string | ArrayBuffer | ArrayBufferView | Blob, options?: NativeVideoOptions): NativeVideo;
  readonly available: boolean;
  readonly decoder: "filmcraft";
  backend: "system" | "bun";
}

function videoConstructor(): NativeVideoConstructor | undefined {
  return (Bun as unknown as { Video?: NativeVideoConstructor }).Video;
}

function validateInput(input: string | ArrayBuffer | ArrayBufferView | Blob): void {
  if (typeof input === "string") {
    if (!input.trim() || input.length > 32_768 || input.includes("\0"))
      throw new TypeError("A valid local media path is required.");
    return;
  }
  const bytes = input instanceof Blob ? input.size : input instanceof ArrayBuffer ? input.byteLength : input.byteLength;
  if (bytes > 256 * 1024 * 1024) throw new RangeError("In-memory video input exceeds the 256 MiB limit.");
}

export function nativeVideoCapabilities() {
  const video = videoConstructor();
  if (typeof video !== "function") {
    return {
      owner: "Bun.Video",
      available: false,
      reason: "This Bun binary has no native video API.",
    };
  }
  if (video.available !== true) {
    return {
      owner: "Bun.Video",
      available: false,
      reason: "The native video provider is disabled.",
    };
  }
  return {
    owner: "Bun.Video",
    available: true,
    decoder: video.decoder,
    backend: video.backend,
  };
}

/** Use the runtime owner directly; codec profiles and output behavior retain separate qualification. */
export function openNativeVideo(
  input: string | ArrayBuffer | ArrayBufferView | Blob,
  options?: NativeVideoOptions,
): NativeVideo {
  validateInput(input);
  const capability = nativeVideoCapabilities();
  if (!capability.available) throw new Error(capability.reason);
  return new (videoConstructor()!)(input, options);
}
