export interface NativeVideoMetadata {
  width: number;
  height: number;
  duration: number | null;
  codec: string;
}

export interface NativeVideo {
  frame(seconds: number): NativeVideo;
  resize(width: number, height?: number): NativeVideo;
  png(): NativeVideo;
  bytes(): Promise<Uint8Array>;
  metadata(): Promise<NativeVideoMetadata>;
}

interface NativeVideoConstructor {
  new (input: string | ArrayBuffer | ArrayBufferView | Blob, options?: { maxPixels?: number }): NativeVideo;
  readonly available: boolean;
}

function videoConstructor(): NativeVideoConstructor | undefined {
  return (Bun as unknown as { Video?: NativeVideoConstructor }).Video;
}

export function nativeVideoCapabilities() {
  const video = videoConstructor();
  if (typeof video !== "function") {
    return { owner: "Bun.Video", available: false, reason: "This Bun binary has no native video API." };
  }
  if (video.available !== true) {
    return { owner: "Bun.Video", available: false, reason: "The native video provider is disabled." };
  }
  return { owner: "Bun.Video", available: true };
}

/** Use the runtime owner directly; availability does not qualify codecs or encoding. */
export function openNativeVideo(
  input: string | ArrayBuffer | ArrayBufferView | Blob,
  options?: { maxPixels?: number },
): NativeVideo {
  const capability = nativeVideoCapabilities();
  if (!capability.available) throw new Error(capability.reason);
  return new (videoConstructor()!)(input, options);
}
