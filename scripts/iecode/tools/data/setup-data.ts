#!/usr/bin/env bun
/**
 * @file setup-data.ts
 * @description Acquisition and setup tool for Inazuma Eleven: Victory Road game data (App 2799860).
 * Supports native Rust downloader (aphrody-nie-steam), steamcmd, archive decompression, and local linking.
 */

import { existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dir, "../../../..");
const canonicalDataDir = resolve(root, "data");

const APP_ID = "2799860";
const CONTENT_DEPOT_ID = "2799861";

const { values: options } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    method: { type: "string", default: "auto" }, // auto | nie | steamcmd | archive | link
    dest: { type: "string" },
    user: { type: "string", env: "STEAM_USER" },
    password: { type: "string", env: "STEAM_PASSWORD" },
    guard: { type: "string", env: "STEAM_GUARD_CODE" },
    "token-store": { type: "string", env: "NIE_STEAM_TOKEN_STORE" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

// node:util parseArgs has no env fallback; apply the documented environment variables.
options.user ??= process.env.STEAM_USER;
options.password ??= process.env.STEAM_PASSWORD;
options.guard ??= process.env.STEAM_GUARD_CODE;
options["token-store"] ??= process.env.NIE_STEAM_TOKEN_STORE;

if (options.help) {
  console.log(`IECODE Game Data Setup Tool (App ID: ${APP_ID})
Usage: bun scripts/iecode/tools/data/setup-data.ts [options]

Methods:
  --method auto      Try local detection/link -> local archive -> native NIE Steam -> steamcmd (default)
  --method nie       Use native Rust Steam downloader (aphrody-nie-steam, App ${APP_ID}, Depot ${CONTENT_DEPOT_ID})
  --method steamcmd  Use SteamCMD (/usr/local/bin/steamcmd)
  --method archive   Decompress data.7z or data.tar.zst archive if present
  --method link      Link an existing external Steam installation

Options:
  --dest <PATH>      Target directory (default: ${canonicalDataDir})
  --user <NAME>      Steam username (env: STEAM_USER)
  --password <PASS>  Steam password (env: STEAM_PASSWORD)
  --guard <CODE>     Steam Guard 2FA code (env: STEAM_GUARD_CODE)
  --token-store <P>  Custom path to Steam tokens JSON store
  --dry-run          Print planned commands without downloading
  -h, --help         Show this help message
`);
  process.exit(0);
}

const targetDest = options.dest ? resolve(process.cwd(), options.dest) : canonicalDataDir;

console.log("=== IECODE Game Data Setup (App 2799860) ===");
console.log(`Target destination: ${targetDest}`);

function commandExists(cmd: string): boolean {
  const check = Bun.spawnSync(["which", cmd]);
  return check.exitCode === 0 && Boolean(check.stdout.toString().trim());
}

function isGameDataValid(dir: string): boolean {
  return existsSync(join(dir, "cpk_list.cfg.bin")) || existsSync(join(dir, "nie.exe"));
}

function findExternalSteamInstall(): string | null {
  const home = process.env.HOME || homedir();
  const candidates = [
    process.env.NIE_GAME_DIR,
    process.env.IEVR_GAME_DIR,
    join(home, ".local/share/Steam/iecode/inazuma"),
    join(home, ".local/share/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"),
    join(home, ".steam/steam/steamapps/common/INAZUMA ELEVEN Victory Road"),
    resolve(root, "../aphrody/data"),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (existsSync(candidate) && isGameDataValid(candidate)) {
      return candidate;
    }
  }
  return null;
}

function ensureDataLink(sourcePath: string, destPath: string) {
  if (sourcePath === destPath) return;
  if (existsSync(destPath)) {
    try {
      const stat = lstatSync(destPath);
      if (stat.isSymbolicLink()) {
        console.log(`[OK] Symlink already configured: ${destPath} -> ${sourcePath}`);
        return;
      }
    } catch {}
  } else {
    try {
      const rel = relative(dirname(destPath), sourcePath);
      symlinkSync(rel, destPath);
      console.log(`[LINKED] ${destPath} -> ${rel}`);
    } catch (e) {
      console.warn(`[WARN] Could not symlink ${destPath} -> ${sourcePath}: ${e}`);
    }
  }
}

function registerNieGameSource(sourcePath: string) {
  const home = process.env.HOME || homedir();
  const configDir = process.env.NIE_CONFIG_DIR || join(home, ".config/nie");
  try {
    mkdirSync(configDir, { recursive: true });
    const sourceFile = join(configDir, "game-source");
    writeFileSync(sourceFile, sourcePath, "utf8");
    console.log(`[CONFIG] Registered NIE game source: ${sourceFile} -> ${sourcePath}`);
  } catch (err) {
    console.warn(`[WARN] Failed to write NIE game source config: ${err}`);
  }
}

// Check if destination is already populated
if (isGameDataValid(targetDest)) {
  console.log(`[EXISTS] Game data already present in ${targetDest} (cpk_list.cfg.bin detected).`);
  registerNieGameSource(targetDest);
  ensureDataLink(targetDest, canonicalDataDir);
  process.exit(0);
}

// Method: LINK from existing install
async function runLinkMethod(): Promise<boolean> {
  const external = findExternalSteamInstall();
  if (external) {
    console.log(`[FOUND] Detected existing game installation at: ${external}`);
    if (options["dry-run"]) {
      console.log(`[DRY-RUN] Symlink ${canonicalDataDir} -> ${external}`);
      return true;
    }
    ensureDataLink(external, targetDest);
    registerNieGameSource(external);
    return true;
  }
  return false;
}

// Method: ARCHIVE decompression
async function runArchiveMethod(): Promise<boolean> {
  const archive7z = resolve(root, "data.7z");
  const archiveZst = resolve(root, "data.tar.zst");
  if (existsSync(archive7z) || existsSync(archiveZst)) {
    console.log(
      "[ARCHIVE] Found compressed data archive. Extracting with data-compression tool...",
    );
    if (options["dry-run"]) {
      console.log("[DRY-RUN] bun scripts/iecode/tools/data/data-compression.ts decompress");
      return true;
    }
    const proc = Bun.spawnSync(
      [process.execPath, "scripts/iecode/tools/data/data-compression.ts", "decompress"],
      {
        cwd: root,
        stdio: ["inherit", "inherit", "inherit"],
      },
    );
    if (proc.exitCode === 0 && isGameDataValid(targetDest)) {
      registerNieGameSource(targetDest);
      return true;
    }
  }
  return false;
}

// Method: NIE native steam downloader
async function runNieSteamMethod(): Promise<boolean> {
  console.log("[NIE STEAM] Preparing native Rust Steam downloader (aphrody-nie-steam)...");
  mkdirSync(targetDest, { recursive: true });

  const steamUser = options.user;
  if (!steamUser) {
    console.error("[ERROR] STEAM_USER is required for downloading IEVR (paid app 2799860).");
    console.error("        Set STEAM_USER=<username> or pass --user <username>.");
    return false;
  }

  const builtBinary = resolve(
    root,
    `target/release/aphrody-nie-steam${process.platform === "win32" ? ".exe" : ""}`,
  );
  const hasBinary = existsSync(builtBinary);

  const tokenStore =
    options["token-store"] || join(homedir(), ".local/share/nie/steam-tokens.json");

  const cmdArgs: string[] = [
    "-u",
    steamUser,
    "--depot",
    CONTENT_DEPOT_ID,
    "--token-store",
    tokenStore,
    "sync",
    "-o",
    targetDest,
  ];

  if (options.password) {
    cmdArgs.unshift("-p", options.password);
  }

  const env = {
    ...process.env,
    ...(options.guard ? { STEAM_GUARD_CODE: options.guard } : {}),
  };

  if (options["dry-run"]) {
    console.log(
      `[DRY-RUN] Run aphrody-nie-steam sync -o ${targetDest} (Depot ${CONTENT_DEPOT_ID})`,
    );
    return true;
  }

  let proc;
  if (hasBinary) {
    console.log(`[EXEC] ${builtBinary} ${cmdArgs.join(" ")}`);
    proc = Bun.spawnSync([builtBinary, ...cmdArgs], {
      cwd: root,
      env,
      stdio: ["inherit", "inherit", "inherit"],
    });
  } else {
    console.log(`[EXEC] cargo run --release -p aphrody-nie-steam -- ${cmdArgs.join(" ")}`);
    proc = Bun.spawnSync(
      ["cargo", "run", "--release", "-p", "aphrody-nie-steam", "--", ...cmdArgs],
      {
        cwd: root,
        env,
        stdio: ["inherit", "inherit", "inherit"],
      },
    );
  }

  if (proc.exitCode === 0 && isGameDataValid(targetDest)) {
    console.log("[OK] Native Steam download completed successfully.");
    registerNieGameSource(targetDest);
    ensureDataLink(targetDest, canonicalDataDir);
    return true;
  }
  console.error(`[ERROR] Native Steam download exited with code ${proc.exitCode}`);
  return false;
}

// Method: SteamCMD downloader
async function runSteamCmdMethod(): Promise<boolean> {
  const steamcmdBin = commandExists("steamcmd") ? "steamcmd" : "/usr/local/bin/steamcmd";
  if (!existsSync(steamcmdBin) && !commandExists("steamcmd")) {
    console.error("[ERROR] steamcmd binary not found in PATH or at /usr/local/bin/steamcmd.");
    return false;
  }

  mkdirSync(targetDest, { recursive: true });

  const steamUser = options.user;
  if (!steamUser) {
    console.error("[ERROR] STEAM_USER is required for steamcmd to acquire IEVR (app 2799860).");
    return false;
  }

  console.log(`[STEAMCMD] Launching steamcmd to download App ${APP_ID} into ${targetDest}...`);

  const steamCmdArgs = [
    "+force_install_dir",
    targetDest,
    "+login",
    steamUser,
    ...(options.password ? [options.password] : []),
    "+app_update",
    APP_ID,
    "validate",
    "+quit",
  ];

  if (options["dry-run"]) {
    console.log(`[DRY-RUN] ${steamcmdBin} ${steamCmdArgs.join(" ")}`);
    return true;
  }

  const proc = Bun.spawnSync([steamcmdBin, ...steamCmdArgs], {
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });

  if (proc.exitCode === 0 && isGameDataValid(targetDest)) {
    console.log("[OK] SteamCMD download completed successfully.");
    registerNieGameSource(targetDest);
    ensureDataLink(targetDest, canonicalDataDir);
    return true;
  }
  console.error(`[ERROR] SteamCMD exited with code ${proc.exitCode}`);
  return false;
}

// Method orchestration
let success = false;
const method = options.method.toLowerCase();

if (method === "link") {
  success = await runLinkMethod();
} else if (method === "archive") {
  success = await runArchiveMethod();
} else if (method === "nie" || method === "steam") {
  success = await runNieSteamMethod();
} else if (method === "steamcmd") {
  success = await runSteamCmdMethod();
} else if (method === "auto") {
  // Auto fallback chain: link -> archive -> nie -> steamcmd
  console.log("[AUTO] Attempting local detection and linking...");
  success = await runLinkMethod();

  if (!success) {
    console.log("[AUTO] Checking for compressed archive...");
    success = await runArchiveMethod();
  }

  if (!success && options.user) {
    console.log("[AUTO] Attempting native NIE Steam download...");
    success = await runNieSteamMethod();
    if (!success && (commandExists("steamcmd") || existsSync("/usr/local/bin/steamcmd"))) {
      console.log("[AUTO] Falling back to steamcmd...");
      success = await runSteamCmdMethod();
    }
  } else if (!success) {
    console.log("\n[INFO] No existing install or archive found.");
    console.log("       To download the game via Steam, run:");
    console.log(
      "       STEAM_USER=<username> [STEAM_PASSWORD=<pass>] [STEAM_GUARD_CODE=<code>] bun run setup:data:nie",
    );
    console.log("       or with steamcmd:");
    console.log("       STEAM_USER=<username> [STEAM_PASSWORD=<pass>] bun run setup:data:steamcmd");
  }
} else {
  console.error(
    `[ERROR] Unknown method '${options.method}'. Use auto, nie, steamcmd, archive, or link.`,
  );
  process.exit(1);
}

if (success) {
  console.log("\n=== Game Data Setup Completed Successfully ===");
  console.log(`Canonical data directory: ${canonicalDataDir}`);
  console.log("Run 'bun run data:status' to verify files and sizes.");
} else {
  process.exit(1);
}
