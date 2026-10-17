// libretro cores for bep: the catalog comes from the pinned libretro-core-info fork, binaries from
// the libretro buildbot (dll/so) into usr/lib/libretro, and BIOS requirements (names, MD5) are
// checked against the firmware store the way Recalbox and RetroArch report missing BIOS.
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { defaultFirmwareStore } from "./firmware/import";
import { repoRoot, usrRoot } from "./usr";

const infoDir = join(repoRoot, "vendor", "libretro-core-info");

export interface CoreFirmware {
  path: string;
  desc: string;
  optional: boolean;
  md5?: string;
}

export interface LibretroCore {
  id: string;
  name: string;
  system: string;
  systemId: string;
  database: string;
  extensions: string[];
  license: string;
  firmware: CoreFirmware[];
}

function parseInfo(id: string, text: string): LibretroCore {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (match) fields.set(match[1]!, match[2]!);
  }
  const md5 = new Map<string, string>();
  for (const note of (fields.get("notes") ?? "").split("|")) {
    const hit = /\(!\)\s*(.+?)\s*\(md5\):\s*([0-9a-f]{32})/i.exec(note);
    if (hit) md5.set(hit[1]!.trim(), hit[2]!.toLowerCase());
  }
  const firmware: CoreFirmware[] = [];
  for (let i = 0; i < Number(fields.get("firmware_count") ?? 0); i++) {
    const path = fields.get(`firmware${i}_path`) ?? "";
    firmware.push({
      path,
      desc: fields.get(`firmware${i}_desc`) ?? path,
      optional: fields.get(`firmware${i}_opt`) === "true",
      md5: md5.get(path) ?? md5.get(basename(path)),
    });
  }
  return {
    id,
    name: fields.get("display_name") ?? id,
    system: fields.get("systemname") ?? "",
    systemId: fields.get("systemid") ?? "",
    database: fields.get("database") ?? "",
    extensions: (fields.get("supported_extensions") ?? "").split("|").filter(Boolean),
    license: fields.get("license") ?? "",
    firmware,
  };
}

export async function libretroCatalog(): Promise<LibretroCore[]> {
  if (!existsSync(join(infoDir, ".git")))
    Bun.spawnSync([
      "git",
      "-C",
      repoRoot,
      "submodule",
      "update",
      "--init",
      "--depth",
      "1",
      "--",
      "vendor/libretro-core-info",
    ]);
  const cores: LibretroCore[] = [];
  for await (const file of new Bun.Glob("*_libretro.info").scan({ cwd: infoDir })) {
    cores.push(parseInfo(file.replace(/_libretro\.info$/, ""), await Bun.file(join(infoDir, file)).text()));
  }
  return cores.sort((a, b) => a.id.localeCompare(b.id));
}

function coreUrl(id: string): string {
  const [os, ext] =
    process.platform === "win32"
      ? ["windows", "dll"]
      : process.platform === "darwin"
        ? ["apple/osx", "dylib"]
        : ["linux", "so"];
  const arch = process.arch === "arm64" ? "arm64" : "x86_64";
  return `https://buildbot.libretro.com/nightly/${os}/${arch}/latest/${id}_libretro.${ext}.zip`;
}

export function libretroDir(): string {
  return join(usrRoot(), "lib", "libretro");
}

/** Downloads one buildbot core into usr/lib/libretro and returns its digest. */
export async function installCore(
  id: string,
  expectedSha256?: string,
): Promise<{ url: string; sha256: string; file: string }> {
  const url = coreUrl(id);
  const response = await fetch(url, { headers: { "user-agent": "bep" } });
  if (!response.ok) throw new Error(`libretro core ${id}: ${url} returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (expectedSha256 && expectedSha256 !== sha256)
    throw new Error(
      `libretro core ${id}: sha256 ${sha256} differs from bep.lock (nightly moved; run bep update ${id})`,
    );
  await mkdir(libretroDir(), { recursive: true });
  await new Bun.Archive(bytes).extract(libretroDir());
  const file = (await new Bun.Archive(bytes).files()).keys().next().value ?? "";
  return { url, sha256, file: join("lib", "libretro", file) };
}

export async function removeCore(id: string): Promise<void> {
  for (const ext of ["dll", "so", "dylib"]) await rm(join(libretroDir(), `${id}_libretro.${ext}`), { force: true });
}

/** BIOS report for cores: each firmware file with its MD5 and whether the store holds a match. */
export async function biosReport(ids: string[]): Promise<
  Array<{
    core: string;
    file: string;
    desc: string;
    optional: boolean;
    md5?: string;
    status: "present" | "missing" | "unverifiable";
  }>
> {
  const catalog = new Map((await libretroCatalog()).map(core => [core.id, core]));
  const storeMd5 = new Set<string>();
  const store = defaultFirmwareStore();
  if (existsSync(store)) {
    for await (const path of new Bun.Glob("*/*").scan({ cwd: store, onlyFiles: true, absolute: true })) {
      if (path.endsWith(".json")) continue;
      storeMd5.add(new Bun.CryptoHasher("md5").update(await Bun.file(path).bytes()).digest("hex"));
    }
  }
  const rows = [];
  for (const id of ids.length ? ids : [...catalog.keys()]) {
    const core = catalog.get(id);
    if (!core) throw new Error(`unknown libretro core ${id}; see bep search`);
    for (const fw of core.firmware) {
      const status = !fw.md5 ? "unverifiable" : storeMd5.has(fw.md5) ? "present" : "missing";
      rows.push({ core: id, file: fw.path, desc: fw.desc, optional: fw.optional, md5: fw.md5, status } as const);
    }
  }
  return rows;
}
