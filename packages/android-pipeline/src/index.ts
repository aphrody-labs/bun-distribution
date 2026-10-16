export type AndroidContainer = "apk" | "aab" | "apks" | "apex";
export type PortableTarget = "pe" | "elf" | "wasm";

export interface AndroidArtifact {
  format: AndroidContainer;
  entries: readonly string[];
  hasNativeLibraries: boolean;
  hasDex: boolean;
}

export interface LoweringPlan {
  target: PortableTarget;
  strategy: "native-rebuild" | "android-runtime" | "wasi-rebuild";
  convertible: boolean;
  reason: string;
}

const decoder = new TextDecoder();

export function classifyAndroidEntries(
  entries: readonly string[],
): AndroidArtifact {
  const names = new Set(entries.map((entry) => entry.replaceAll("\\", "/")));
  let format: AndroidContainer;
  if (names.has("apex_manifest.pb") && names.has("apex_payload.img"))
    format = "apex";
  else if ([...names].some((name) => name.endsWith(".apk"))) format = "apks";
  else if (names.has("base/manifest/AndroidManifest.xml")) format = "aab";
  else if (names.has("AndroidManifest.xml")) format = "apk";
  else
    throw new TypeError(
      "ZIP is not a recognized APK, AAB, APKS or APEX container",
    );
  return {
    format,
    entries: [...names].sort(),
    hasNativeLibraries: [...names].some((name) =>
      /^lib\/[^/]+\/[^/]+\.so$/.test(name),
    ),
    hasDex: [...names].some((name) => /(^|\/)classes\d*\.dex$/.test(name)),
  };
}

export async function inspectAndroidArtifact(
  path: string,
): Promise<AndroidArtifact> {
  const file = Bun.file(path);
  const size = file.size;
  if (size < 22)
    throw new TypeError("artifact is too small to be a ZIP container");
  const tailStart = Math.max(0, size - 65_557);
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (
      tail[i] === 0x50 &&
      tail[i + 1] === 0x4b &&
      tail[i + 2] === 0x05 &&
      tail[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new TypeError("ZIP end-of-central-directory record not found");
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (
    entryCount > 100_000 ||
    directorySize > 64 * 1024 * 1024 ||
    directoryOffset + directorySize > size
  ) {
    throw new RangeError(
      "ZIP central directory exceeds bounded inspection limits",
    );
  }
  const directory = new Uint8Array(
    await file
      .slice(directoryOffset, directoryOffset + directorySize)
      .arrayBuffer(),
  );
  const entries: string[] = [];
  for (
    let offset = 0;
    offset + 46 <= directory.length && entries.length < entryCount;
  ) {
    if (
      directory[offset] !== 0x50 ||
      directory[offset + 1] !== 0x4b ||
      directory[offset + 2] !== 0x01 ||
      directory[offset + 3] !== 0x02
    ) {
      throw new TypeError("invalid ZIP central-directory entry");
    }
    const item = new DataView(
      directory.buffer,
      directory.byteOffset + offset,
      46,
    );
    const nameLength = item.getUint16(28, true);
    const extraLength = item.getUint16(30, true);
    const commentLength = item.getUint16(32, true);
    const end = offset + 46 + nameLength;
    if (end > directory.length) throw new TypeError("truncated ZIP entry name");
    entries.push(decoder.decode(directory.subarray(offset + 46, end)));
    offset = end + extraLength + commentLength;
  }
  if (entries.length !== entryCount)
    throw new TypeError("truncated ZIP central directory");
  return classifyAndroidEntries(entries);
}

export function planLowering(
  artifact: AndroidArtifact,
  target: PortableTarget,
  rebuildableSources = false,
): LoweringPlan {
  if (rebuildableSources)
    return {
      target,
      strategy: target === "wasm" ? "wasi-rebuild" : "native-rebuild",
      convertible: true,
      reason:
        "rebuild from source with the target toolchain and qualify behavior",
    };
  return {
    target,
    strategy: "android-runtime",
    convertible: false,
    reason: `${artifact.format.toUpperCase()} bytecode and Android APIs require an Android runtime; opaque packages cannot be faithfully relinked as ${target.toUpperCase()}`,
  };
}
