// Community tooling around the Azahar user directory: patches and cheats, add-ons, homebrew.
//
// Everything is placed in the isolated Azahar user directory (see ciaUserDir) using the layout
// the emulator itself reads: load/mods/<TID>/{exefs/code.ips|bps, romfs/...}, load/textures/<TID>/,
// cheats/<TID>.txt, sdmc/3ds/<name>/<name>.3dsx and scripts/. Nothing is downloaded: add-ons are
// pinned by SHA-256 against sources already vendored in this repository.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { repoRoot } from "../usr";
import { ciaUserDir } from "./cia";

const catalogFile = join(import.meta.dir, "..", "..", "plugins", "3ds", "community.json");

interface Addon {
  id: string;
  kind: "script";
  source: string;
  dest: string;
  /** SHA-256 of the source with CR characters removed (line-ending neutral). */
  sha256: string;
  license: string;
  description: string;
}
interface HomebrewSource {
  id: string;
  path: string;
  kind: string;
  license: string;
  description: string;
}
interface Catalog {
  addons: Addon[];
  homebrew: HomebrewSource[];
  pointers: { id: string; url: string; note: string }[];
}

export function loadCatalog(): Catalog {
  return JSON.parse(readFileSync(catalogFile, "utf8")) as Catalog;
}

export function pinHash(file: string): string {
  const bytes = readFileSync(file).filter(byte => byte !== 13);
  return createHash("sha256").update(bytes).digest("hex");
}

const fileHash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function titleId(value: string | undefined): string {
  if (!value || !/^[0-9a-fA-F]{16}$/.test(value)) throw new Error("title id must be 16 hex digits");
  return value.toUpperCase();
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

type PatchKind = "ips" | "bps" | "cheat";

/** Classifies a patch file by content, not only by name. */
export function classifyPatch(file: string): PatchKind {
  const bytes = readFileSync(file);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 5));
  if (head === "PATCH") return "ips";
  if (head.startsWith("BPS1")) return "bps";
  const text = new TextDecoder().decode(bytes);
  const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.startsWith("*"));
  const hexLine = /^[0-9A-Fa-f]{8} [0-9A-Fa-f]{8}$/;
  if (
    lines.some(line => line.startsWith("[")) &&
    lines.every(line => line.startsWith("[") || hexLine.test(line.trim()))
  )
    return "cheat";
  throw new Error(`${file}: not an IPS, BPS or Gateway cheat file`);
}

function lockPath() {
  return join(ciaUserDir(), "community.lock.json");
}
function readLock(): Record<string, { source: string; sha256: string; kind: string }> {
  return existsSync(lockPath()) ? JSON.parse(readFileSync(lockPath(), "utf8")) : {};
}
function record(dest: string, source: string, kind: string) {
  const lock = readLock();
  lock[dest.slice(ciaUserDir().length + 1).replaceAll("\\", "/")] = { source, sha256: fileHash(dest), kind };
  writeFileSync(lockPath(), `${JSON.stringify(lock, null, 2)}\n`);
}
function place(source: string, dest: string, kind: string, force: boolean) {
  if (existsSync(dest) && !force) throw new Error(`${dest} exists (use --force)`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
  record(dest, source, kind);
  return dest;
}

export function patchesList(tid?: string) {
  const user = ciaUserDir();
  const filter = tid ? titleId(tid) : undefined;
  const rel = (file: string) => file.slice(user.length + 1).replaceAll("\\", "/");
  const entries = [
    ...walk(join(user, "load", "mods")).map(file => ({ area: "mods", file })),
    ...walk(join(user, "load", "textures")).map(file => ({ area: "textures", file })),
    ...walk(join(user, "cheats")).map(file => ({ area: "cheats", file })),
  ]
    .map(({ area, file }) => {
      const path = rel(file);
      const id = area === "cheats" ? basename(file, ".txt").toUpperCase() : path.split("/")[2]?.toUpperCase();
      return { area, titleId: id, path, size: statSync(file).size, sha256: fileHash(file) };
    })
    .filter(entry => !filter || entry.titleId === filter);
  return { userDir: user, entries };
}

/** Places an IPS/BPS (exefs code patch, or a RomFS file patch with `romfsPath`) or a cheat file. */
export function patchApply(
  tid: string,
  file: string,
  options: { romfsPath?: string; force?: boolean; append?: boolean },
) {
  const id = titleId(tid);
  const source = resolve(file);
  if (!existsSync(source)) throw new Error(`file not found: ${source}`);
  const kind = classifyPatch(source);
  const user = ciaUserDir();
  if (kind === "cheat") {
    const dest = join(user, "cheats", `${id}.txt`);
    if (existsSync(dest) && options.append) {
      writeFileSync(dest, `${readFileSync(dest, "utf8").trimEnd()}\n\n${readFileSync(source, "utf8").trimStart()}`);
      record(dest, source, "cheat");
      return { kind, dest };
    }
    return { kind, dest: place(source, dest, kind, !!options.force) };
  }
  if (options.romfsPath?.split(/[/\\]/).includes("..")) throw new Error("romfs path must stay inside the RomFS");
  const mods = join(user, "load", "mods", id);
  const dest = options.romfsPath
    ? join(mods, "romfs", `${options.romfsPath.replace(/^[/\\]+/, "")}.${kind}`)
    : join(mods, "exefs", `code.${kind}`);
  return { kind, dest: place(source, dest, kind, !!options.force) };
}

export function addonsList() {
  const catalog = loadCatalog();
  const user = ciaUserDir();
  return {
    userDir: user,
    addons: catalog.addons.map(addon => {
      const source = join(repoRoot, addon.source);
      const dest = join(user, addon.dest);
      return {
        id: addon.id,
        kind: addon.kind,
        license: addon.license,
        description: addon.description,
        sourcePresent: existsSync(source),
        pinnedSha256: addon.sha256,
        sourceMatchesPin: existsSync(source) && pinHash(source) === addon.sha256,
        installed: existsSync(dest),
        installedMatchesPin: existsSync(dest) && pinHash(dest) === addon.sha256,
      };
    }),
    homebrew: catalog.homebrew.map(entry => ({
      ...entry,
      present: existsSync(join(repoRoot, entry.path, "Makefile")),
    })),
    pointers: catalog.pointers,
  };
}

export function addonInstall(id: string | undefined, force: boolean) {
  const addon = loadCatalog().addons.find(entry => entry.id === id);
  if (!addon) throw new Error(`unknown add-on: ${id}`);
  const source = join(repoRoot, addon.source);
  if (!existsSync(source)) throw new Error(`source missing, initialise the submodule: ${addon.source}`);
  if (pinHash(source) !== addon.sha256)
    throw new Error(`${addon.id}: source does not match its pin, review and update plugins/3ds/community.json`);
  return { id: addon.id, dest: place(source, join(ciaUserDir(), addon.dest), "addon", force) };
}

function devkitpro(): Record<string, string> {
  const root = Bun.env.DEVKITPRO ?? (existsSync("/opt/devkitpro") ? "/opt/devkitpro" : "");
  if (!root) throw new Error("devkitPro not found: set DEVKITPRO (3ds-dev with libctru and devkitARM)");
  return {
    DEVKITPRO: root,
    DEVKITARM: Bun.env.DEVKITARM ?? `${root}/devkitARM`,
    PATH: `${root}/tools/bin:${root}/devkitARM/bin:${Bun.env.PATH ?? ""}`,
  };
}

export const defaultHomebrew = join(repoRoot, "packages", "iecode-cpp", "homebrew", "3ds");

export async function homebrewBuild(dir = defaultHomebrew) {
  const env = devkitpro();
  const project = resolve(dir);
  if (!existsSync(join(project, "Makefile"))) throw new Error(`no Makefile in ${project}`);
  const child = Bun.spawn(["make", "-j2"], {
    cwd: project,
    env: { ...Bun.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const outputs = walk(project).filter(file => [".3dsx", ".cia"].includes(extname(file)));
  return { ok: code === 0, outputs, log: `${out}${err}`.trim().split("\n").slice(-20).join("\n") };
}

export function homebrewInstall(file: string | undefined) {
  if (!file || extname(file) !== ".3dsx") throw new Error("usage: homebrew install <app.3dsx>");
  const name = basename(file, ".3dsx");
  const dest = join(ciaUserDir(), "sdmc", "3ds", name, `${name}.3dsx`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(file), dest);
  return { dest };
}

function azaharFrontend(): string | undefined {
  const lib = join(repoRoot, "usr", "lib", "azahar");
  const found = walk(lib).find(file => /(^|[\\/])azahar(\.exe)?$/.test(file));
  return Bun.env.AZAHAR ?? found ?? Bun.which("azahar") ?? undefined;
}

/** Runs a .3dsx or .cia in Zakuro (headless) or, with --azahar, in the Azahar frontend. */
export async function homebrewRun(file: string | undefined, extra: string[]): Promise<number> {
  if (!file) throw new Error("usage: homebrew run <app.3dsx|.cia> [--azahar] [engine args]");
  const image = resolve(file);
  if (extra[0] === "--azahar") {
    const frontend = azaharFrontend();
    if (!frontend) throw new Error("Azahar frontend not found: set AZAHAR or install it with bep");
    return Bun.spawn([frontend, image], { stdio: ["inherit", "inherit", "inherit"] }).exited;
  }
  const { runNative } = await import("../nds/cli");
  return runNative(["run", "3ds", image, ...(extra.length ? extra : ["--headless", "--frames", "60"])]);
}

export async function communityMain(group: "patches" | "addons" | "homebrew", argv: string[]): Promise<number> {
  const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
  const flag = (name: string) => argv.includes(name);
  const option = (name: string) => argv[argv.indexOf(name) + 1];
  const positional = argv.filter((arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--romfs");
  const [action, a, b] = positional;
  try {
    if (group === "patches" && action === "list") print(patchesList(a));
    else if (group === "patches" && action === "apply")
      print(
        patchApply(a!, b!, {
          romfsPath: flag("--romfs") ? option("--romfs") : undefined,
          force: flag("--force"),
          append: flag("--append"),
        }),
      );
    else if (group === "addons" && action === "list") print(addonsList());
    else if (group === "addons" && action === "install") print(addonInstall(a, flag("--force")));
    else if (group === "homebrew" && action === "build") {
      const result = await homebrewBuild(a);
      print(result);
      return result.ok ? 0 : 1;
    } else if (group === "homebrew" && action === "install") print(homebrewInstall(a));
    else if (group === "homebrew" && action === "run") return await homebrewRun(a, argv.slice(argv.indexOf(a ?? "") + 1));
    else {
      console.error(
        "usage: 3ds patches list [tid] | patches apply <tid> <file.ips|bps|txt> [--romfs <path>] [--force|--append] | addons list | addons install <id> [--force] | homebrew build [dir] | homebrew install <app.3dsx> | homebrew run <app> [--azahar]",
      );
      return 2;
    }
  } catch (error) {
    print({ ok: false, error: (error as Error).message });
    return 1;
  }
  return 0;
}
