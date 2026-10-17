import { basename, join, resolve } from "node:path";
import { usrRoot } from "../usr";

const maxFirmwareBytes = 128 * 1024 * 1024;

export interface FirmwareManifest {
  console: string;
  sha256: string;
  bytes: number;
  file: string;
  importedAt: string;
}

function safeConsoleName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("console name must contain letters or numbers");
  }
  return normalized;
}

export function defaultFirmwareStore(): string {
  if (Bun.env.BUN_ENGINE_FIRMWARE_STORE) return resolve(Bun.env.BUN_ENGINE_FIRMWARE_STORE);
  return join(usrRoot(), "share", "bun-engine", "firmware");
}

export async function hashFirmware(file: Blob): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of file.stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

export async function importFirmware(
  consoleName: string,
  sourcePath: string,
  store = defaultFirmwareStore(),
): Promise<FirmwareManifest> {
  const source = Bun.file(resolve(sourcePath));
  if (!(await source.exists())) throw new Error(`firmware dump not found: ${sourcePath}`);
  if (source.size === 0 || source.size > maxFirmwareBytes) {
    throw new Error("firmware dump must be between 1 byte and 128 MiB");
  }

  const owner = safeConsoleName(consoleName);
  const sha256 = await hashFirmware(source);
  const extension =
    basename(sourcePath)
      .match(/\.[a-z0-9]{1,8}$/i)?.[0]
      .toLowerCase() ?? ".bin";
  const directory = join(resolve(store), owner);
  const file = `${sha256}${extension}`;
  await Bun.write(join(directory, file), source);

  const manifest: FirmwareManifest = {
    console: owner,
    sha256,
    bytes: source.size,
    file,
    importedAt: new Date().toISOString(),
  };
  await Bun.write(join(directory, `${sha256}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Firmware imported into the store, optionally for one console. */
export async function listFirmware(consoleName?: string, store = defaultFirmwareStore()): Promise<FirmwareManifest[]> {
  const pattern = consoleName ? `${safeConsoleName(consoleName)}/*.json` : "*/*.json";
  const manifests: FirmwareManifest[] = [];
  for await (const path of new Bun.Glob(pattern).scan({ cwd: resolve(store), absolute: true, onlyFiles: true })) {
    manifests.push(await Bun.file(path).json());
  }
  return manifests.sort((a, b) => a.console.localeCompare(b.console) || a.importedAt.localeCompare(b.importedAt));
}
