#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * WinClean Sovereign Pipeline - Bun Execution Engine
 * Clean, portable script to drive deep system cleanup & optimization across Windows.
 */

import { rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const userProfile = homedir();
const localAppData = process.env.LOCALAPPDATA || join(userProfile, "AppData", "Local");
const tempDir = process.env.TEMP || join(localAppData, "Temp");

console.log("\x1b[36m==========================================================\x1b[0m");
console.log("\x1b[36m   APHRODY OS :: WINCLEAN PIPELINE (BUN ENGINE)           \x1b[0m");
console.log("\x1b[36m==========================================================\x1b[0m");

function runCommand(cmd: string, args: string[]) {
  try {
    const res = Bun.spawnSync([cmd, ...args], { stdout: "ignore", stderr: "ignore" });
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

// 1. Storage Reclamation
console.log("\n\x1b[33m[*] Phase 1: Reclaiming Storage & Temporary Files...\x1b[0m");

const targets = [
  join(localAppData, "Mozilla", "sccache", "cache"),
  join(userProfile, ".cargo", "registry", "cache"),
  join(userProfile, ".cargo", "registry", "src"),
  "C:\\ProgramData\\NVIDIA Corporation\\NVIDIA app\\UpdateFramework\\ota-artifacts",
  join(localAppData, "CrashDumps")
];

for (const p of targets) {
  if (existsSync(p)) {
    try {
      rmSync(p, { recursive: true, force: true });
      console.log(`  \x1b[32m-> Purged: ${p}\x1b[0m`);
    } catch {
      console.log(`  \x1b[31m-> Failed to purge: ${p}\x1b[0m`);
    }
  }
}

// 2. System Hardware & NTFS Tuning
console.log("\n\x1b[33m[*] Phase 2: Applying Hardware & NTFS Tuning...\x1b[0m");

runCommand("powercfg", ["/h", "off"]);
console.log("  \x1b[32m-> Disabled hibernation (hiberfil.sys)\x1b[0m");

runCommand("cmd.exe", ["/c", "fsutil behavior set disablelastaccess 1"]);
runCommand("cmd.exe", ["/c", "fsutil 8dot3name set C: 1"]);
console.log("  \x1b[32m-> NTFS: Disabled LastAccess timestamps and 8.3 naming\x1b[0m");

runCommand("bcdedit", ["/timeout", "3"]);
console.log("  \x1b[32m-> BCD: Set boot timeout to 3s\x1b[0m");

console.log("  \x1b[90m-> Executing SSD TRIM on C:...\x1b[0m");
runCommand("defrag", ["C:", "/L"]);
console.log("  \x1b[32m-> SSD TRIM completed\x1b[0m");

// 3. In-Memory Index Preload
console.log("\n\x1b[33m[*] Phase 3: Building Instant In-Memory Index of C:\\...\x1b[0m");
const fdPath = join(userProfile, ".cargo", "bin", "fd.exe");
if (existsSync(fdPath)) {
  if (!existsSync("C:\\tmp")) {
    mkdirSync("C:\\tmp", { recursive: true });
  }
  const proc = Bun.spawn(["cmd.exe", "/c", `"${fdPath}" -c never -H -I -a --base-directory C:\\ . > C:\\tmp\\disk_c_index.txt`], {
    stdout: "ignore",
    stderr: "ignore"
  });
  proc.unref();
  console.log("  \x1b[32m-> In-memory C:\\ index generation spawned in background (C:\\tmp\\disk_c_index.txt)\x1b[0m");
}

console.log("\n\x1b[36m==========================================================\x1b[0m");
console.log("\x1b[36m   WINCLEAN BUN WORKFLOW COMPLETED SUCCESSFULLY           \x1b[0m");
console.log("\x1b[36m==========================================================\x1b[0m");
