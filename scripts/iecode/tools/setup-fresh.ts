#!/usr/bin/env bun
/**
 * @file setup-fresh.ts
 * @description Bootstraps local directories, environment files, documentation archives,
 * and locked registry dependencies with the qualified Aphrody Bun fork.
 */

import { existsSync, mkdirSync, copyFileSync, symlinkSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { checkBunRuntime } from "../validation/bun-runtime";

const root = resolve(import.meta.dir, "../../..");

const { values: options } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "skip-install": { type: "boolean", default: false },
    "skip-cargo": { type: "boolean", default: false },
    "setup-data": { type: "boolean", default: false },
    "skip-docs": { type: "boolean", default: false },
    "skip-doctor": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (options.help) {
  console.log(`IECODE Workspace Setup Tool
Usage: bun scripts/iecode/tools/setup-fresh.ts [options]

Options:
  --skip-install   Do not run 'bun install --frozen-lockfile'
  --skip-cargo     Do not run 'cargo fetch --locked'
  --setup-data     Explicitly run the private game-data resolver
  --skip-docs      Do not unpack 'docs.7z' archive
  --skip-doctor    Do not run 'bun run doctor' verification
  --dry-run        Print actions without performing mutations
  -h, --help       Show this help message
`);
  process.exit(0);
}

await checkBunRuntime(root);
console.log("=== IECODE Fresh Clone Setup ===");
console.log(`Workspace root: ${root}`);

// 1. Shared operations are installed with the locked registry dependencies.
const configuredAphrody = process.env.APHRODY_ROOT || process.env.APHRODY_INFRA_ROOT;
if (configuredAphrody) {
  console.log(`[INFO] Explicit operations checkout: ${resolve(root, configuredAphrody)}`);
} else {
  console.log("[INFO] Shared operations use the installed @aphrody/workspace registry owner.");
}

// 2. Ensure Git-Ignored Directory Structure
const ignoredDirs = [".coord/claims", "var/log", "var/runs", "var/mirror", "assets/textures", "data"];

for (const dir of ignoredDirs) {
  const fullPath = join(root, dir);
  if (!existsSync(fullPath)) {
    if (options["dry-run"]) {
      console.log(`[DRY-RUN] Create directory: ${dir}`);
    } else {
      mkdirSync(fullPath, { recursive: true });
      console.log(`[CREATED] Directory: ${dir}`);
    }
  } else {
    console.log(`[EXISTS] Directory: ${dir}`);
  }
}

// 3. Setup Local Environment (.env and .env.local)
const envExamplePath = join(root, ".env.example");
const envLocalPath = join(root, ".env.local");
const envLinkPath = join(root, ".env");

if (!existsSync(envLocalPath)) {
  if (existsSync(envExamplePath)) {
    if (options["dry-run"]) {
      console.log("[DRY-RUN] Copy .env.example -> .env.local");
    } else {
      copyFileSync(envExamplePath, envLocalPath);
      console.log("[CREATED] .env.local created from .env.example");
    }
  } else {
    console.warn("[WARN] .env.example not found; skipping .env.local generation");
  }
} else {
  console.log("[EXISTS] .env.local already exists");
}

let hasEnv = false;
try {
  const stat = lstatSync(envLinkPath);
  hasEnv = Boolean(stat);
} catch {
  hasEnv = false;
}

if (!hasEnv) {
  if (options["dry-run"]) {
    console.log("[DRY-RUN] Create symlink .env -> .env.local");
  } else {
    try {
      symlinkSync(".env.local", envLinkPath);
      console.log("[CREATED] Symlink .env -> .env.local");
    } catch {
      copyFileSync(envLocalPath, envLinkPath);
      console.log("[COPIED] .env copied from .env.local (symlink unavailable)");
    }
  }
} else {
  console.log("[EXISTS] .env already exists");
}

// 4. Domain databases remain in their existing isolated stores.
console.log("[INFO] Private databases are not linked or copied by dependency setup.");

// 5. Game Data Verification & Setup (App 2799860)
const dataDirPath = join(root, "data");
const cpkListPath = join(dataDirPath, "cpk_list.cfg.bin");
const nieExePath = join(dataDirPath, "nie.exe");

if (options["setup-data"] && !existsSync(cpkListPath) && !existsSync(nieExePath)) {
  console.log("[DATA] Game data not yet present in data/. Running setup-data auto resolver...");
  if (!options["dry-run"]) {
    const dataSetup = Bun.spawnSync([process.execPath, "scripts/iecode/tools/data/setup-data.ts", "--method", "auto"], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    });
    if (dataSetup.exitCode !== 0) {
      console.warn(
        "[INFO] Game data not populated. Run 'bun run setup:data:nie' or 'bun run setup:data:steamcmd' with your Steam credentials.",
      );
    }
  } else {
    console.log("[DRY-RUN] bun scripts/iecode/tools/data/setup-data.ts --method auto");
  }
} else {
  console.log("[INFO] Game data is optional; use --setup-data to resolve it explicitly.");
}

// 5. Unpack Compressed Documentation (docs.7z)
const docsArchive = join(root, "docs.7z");
const historyDir = join(root, "docs/history");
const researchDir = join(root, "docs/research");

if (!options["skip-docs"] && existsSync(docsArchive) && (!existsSync(historyDir) || !existsSync(researchDir))) {
  console.log("[DOCS] Unpacking documentation archive (docs.7z)...");
  if (!options["dry-run"]) {
    const unpack = Bun.spawnSync([process.execPath, "scripts/iecode/tools/docs-archive.ts", "unpack"], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    });
    if (unpack.exitCode !== 0) {
      console.warn("[WARN] Failed to unpack docs.7z; you can run 'bun run docs:unpack' manually.");
    } else {
      console.log("[OK] Documentation archive unpacked successfully.");
    }
  }
} else {
  console.log("[EXISTS] Documentation history/research directories ready.");
}

// 6. Install Dependencies
if (!options["skip-install"]) {
  console.log("[DEPS] Installing workspace dependencies with Bun...");
  if (!options["dry-run"]) {
    const install = Bun.spawnSync([process.execPath, "install", "--frozen-lockfile"], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    });
    if (install.exitCode !== 0) {
      console.error("[ERROR] 'bun install --frozen-lockfile' failed.");
      process.exit(install.exitCode ?? 1);
    }
  }
}

// 7. Fetch the locked Rust dependencies without compiling engines.
if (!options["skip-cargo"]) {
  console.log("[DEPS] Fetching locked Cargo dependencies...");
  if (!options["dry-run"]) {
    const fetch = Bun.spawnSync(["cargo", "fetch", "--locked"], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    });
    if (fetch.exitCode !== 0) {
      console.error("[ERROR] 'cargo fetch --locked' failed.");
      process.exit(fetch.exitCode ?? 1);
    }
  }
}

// 8. Verify Workspace Health
if (!options["skip-doctor"]) {
  console.log("[DOCTOR] Checking workspace health...");
  if (!options["dry-run"]) {
    const doctor = Bun.spawnSync([process.execPath, "run", "doctor"], {
      cwd: root,
      stdio: ["inherit", "inherit", "inherit"],
    });
    if (doctor.exitCode !== 0) {
      console.warn("[WARN] 'bun run doctor' reported warnings or issues.");
    }
  }
}

console.log("\n=== Setup Complete ===");
console.log("Workspace is initialized and ready for development.");
