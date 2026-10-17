// Guards for the owner's private dumps: they never enter Git and never leave through a public
// route. Dependency-light on purpose, so the pre-commit hook starts fast:
//   bun packages/bun-engine/src/owned/guard.ts --staged   (installed by `bep owned hook`)
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..", "..", "..");
const marker = "# bep owned guard";

function usr(): string {
  return resolve(Bun.env.BEP_ROOT ?? join(repoRoot, "usr"));
}

function share(): string {
  return Bun.env.BUN_ENGINE_FIRMWARE_STORE
    ? dirname(resolve(Bun.env.BUN_ENGINE_FIRMWARE_STORE))
    : join(usr(), "share", "bun-engine");
}

/** Every directory that holds owned dumps, keys, uploads in flight or private test reports. */
export function privateRoots(): string[] {
  return [
    join(share(), "firmware"),
    join(share(), "roms"),
    join(share(), "keys"),
    join(share(), "system"),
    join(usr(), "var", "inbox"),
    join(usr(), "var", "tmp", "bep-owned"),
    join(usr(), "var", "lib", "bep", "owned-tests"),
  ];
}

function canonical(path: string): string {
  let full = resolve(path);
  try {
    full = realpathSync(full);
  } catch {
    /* not created yet */
  }
  return process.platform === "win32" ? full.toLowerCase() : full;
}

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** True when `path` is (or resolves into) a private store. */
export function isPrivatePath(path: string): boolean {
  const target = canonical(path);
  return privateRoots().some((root) => inside(target, canonical(root)));
}

/** Refuses a directory that would publish a private store: inside one, or containing one. */
export function assertPublicRoot(...paths: string[]): void {
  for (const path of paths) {
    const target = canonical(path);
    for (const root of privateRoots().map(canonical)) {
      if (inside(target, root) || inside(root, target))
        throw new Error(`refusing to serve ${path}: it overlaps the private dump store`);
    }
  }
}

/** Dump, disc image and key extensions that never belong in the repository. */
const blockedExtensions = new Set(
  (
    "nes fds unf unif sfc smc fig swc gb gbc sgb gba agb nds dsi srl 3ds cci cxi cia z64 n64 v64 ndd " +
    "gcm gcz rvz wia wbfs wad wud wux wua iso cso zso chd cue gdi cdi mds mdf ccd img nrg pbp ecm " +
    "nsp nsz xci xcz nca keys sed gen smd 32x sms gg pce sgx ngp ngc ws wsc a26 a52 a78 lnx jag vb " +
    "vpk xiso"
  ).split(" "),
);

/** BIOS, firmware and key file names (console dumps), whatever the extension says. */
const blockedNames =
  /^(prod|title|dev)\.keys$|^aes_keys\.txt$|^(seeddb|boot9|boot11|otp|keys|secret_sector|nand|nand_dsi|bios7|bios9|dsi_bios7|dsi_bios9|firmware|dsi_firmware|gba_bios|sgb_bios|gb_bios|gbc_bios|dmg_boot|cgb_boot|scph\d+[a-z]?|ps[12x]?_?bios[^/]*|psxonpsp660|mcpx_1\.0|complex_4627|sega_101|bios_cd_[uej]|bios_e|bios_j|bios_u|dc_boot|dc_flash|neogeo|pgm|syscard\d|disksys|kick\d+[^/]*|lynxboot|5200|7800 bios[^/]*)\.(bin|rom|img|nvm)$|^movable\.sed$|^neogeo\.zip$/i;

/** Path segments of the private stores relative to the repository. */
const blockedPaths = [/^usr\//i, /(^|\/)games\/private\//i, /(^|\/)var\/inbox\//i, /(^|\/)owned-tests\//i];

export interface Rejection {
  path: string;
  why: string;
}

/** Why `path` (repository-relative, forward slashes) may not be committed, if it may not. */
export function rejectPath(path: string): string | undefined {
  const name = path.split("/").pop() ?? path;
  if (blockedPaths.some((pattern) => pattern.test(path))) return "inside a private dump store";
  if (blockedNames.test(name)) return "console BIOS, firmware or key file name";
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext && blockedExtensions.has(ext)) return `.${ext} is a ROM, disc image or key extension`;
  return undefined;
}

function ownedBlobs(blobs: string[]): Set<string> {
  const path = join(usr(), "var", "lib", "bep", "library.db");
  if (!blobs.length || !existsSync(path)) return new Set();
  const db = new Database(path, { readonly: true });
  try {
    const table = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'owned'").get();
    if (!table) return new Set();
    const rows = db
      .query<{ gitBlob: string }, [string]>(
        "SELECT gitBlob FROM owned WHERE gitBlob IN (SELECT value FROM json_each(?))",
      )
      .all(JSON.stringify(blobs));
    return new Set(rows.map((row) => row.gitBlob));
  } finally {
    db.close();
  }
}

/**
 * Checks the staged changes: blocked paths, names and extensions, and any blob whose Git object id
 * equals an owned dump (renamed or extension-less copies), without reading file contents.
 */
export function checkStaged(cwd = repoRoot): Rejection[] {
  const out = Bun.spawnSync(["git", "-C", cwd, "diff", "--cached", "--raw", "--no-abbrev", "-z", "--no-renames", "--diff-filter=ACMR"], {
    stderr: "pipe",
  });
  if (!out.success) throw new Error(`git diff --cached failed: ${out.stderr.toString().trim()}`);
  const fields = out.stdout.toString().split("\0");
  const entries: Array<{ path: string; blob: string }> = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [, mode, , blob] = fields[i]!.split(" ");
    if (mode === "160000") continue; // submodule gitlink
    entries.push({ path: fields[i + 1]!, blob: blob ?? "" });
  }
  const rejections: Rejection[] = [];
  for (const entry of entries) {
    const why = rejectPath(entry.path);
    if (why) rejections.push({ path: entry.path, why });
  }
  const owned = ownedBlobs(entries.map((entry) => entry.blob));
  for (const entry of entries)
    if (owned.has(entry.blob) && !rejections.some((item) => item.path === entry.path))
      rejections.push({ path: entry.path, why: "content is an owned dump from the private store" });
  return rejections;
}

/** Installs (or keeps) the pre-commit hook of this checkout; existing hooks are chained, not replaced. */
export async function installHook(cwd = repoRoot): Promise<string> {
  const hooks = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--git-path", "hooks"]).stdout.toString().trim();
  const file = resolve(cwd, hooks, "pre-commit");
  const line = `${marker}\nbun "packages/bun-engine/src/owned/guard.ts" --staged || exit 1\n`;
  const current = (await Bun.file(file).exists()) ? await Bun.file(file).text() : "";
  if (current.includes(marker)) return file;
  const next = current
    ? current.replace(/^(#![^\n]*\n)?/, (shebang) => `${shebang || "#!/bin/sh\n"}${line}`)
    : `#!/bin/sh\n${line}`;
  await Bun.write(file, next);
  if (process.platform !== "win32") chmodSync(file, 0o755);
  return file;
}

if (import.meta.main) {
  const rejections = checkStaged(process.cwd());
  if (rejections.length) {
    console.error("bep owned guard: private dumps must not be committed:");
    for (const item of rejections) console.error(`  ${item.path}: ${item.why}`);
    console.error("Unstage them (git restore --staged <path>); owned dumps live in usr/share/bun-engine.");
    process.exit(1);
  }
}
