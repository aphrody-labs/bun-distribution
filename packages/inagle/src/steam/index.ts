/**
 * Narrow bridge from Inagle to NIE's native Steam installer.
 *
 * Steam authentication, depot selection, resumable transfer, and file
 * verification stay owned by `nie steam`; this module only invokes that CLI
 * and mounts its resulting install through Inagle's existing native VFS.
 */
import { configureGameVfs, gameDataDirectory, gameVfs } from "../core/vfs-data.js";

// The VFS adapter is process-global, so Steam syncs through this bridge must
// complete their download-and-mount sequence one at a time.
let syncQueue: Promise<void> = Promise.resolve();

export interface SyncIEVROptions {
  /** Install root passed to `nie steam sync --out`. */
  installDir: string;
  /** Executable name or path; defaults to `nie` resolved by the host. */
  nieBin?: string;
  /** Concurrent Steam chunks, forwarded to NIE without handling credentials. */
  maxDownloads?: number;
}

export interface MountedIEVRInstall {
  installDir: string;
  source: string;
  entries: number;
}

/**
 * Mount an existing IEVR installation through Inagle's native VFS.
 * The path is forwarded to NIE's shared game-source resolver; no archive is
 * extracted or copied by this adapter.
 */
export function mountIEVR(installDir: string): MountedIEVRInstall {
  if (!installDir.trim()) throw new TypeError("installDir must not be empty");
  try {
    configureGameVfs(installDir);
    const vfs = gameVfs();
    const entries = Number(vfs.count());
    if (!Number.isSafeInteger(entries) || entries <= 0) {
      throw new Error(`NIE mounted no VFS entries from ${installDir}`);
    }
    return { installDir, source: gameDataDirectory(), entries };
  } catch (error) {
    configureGameVfs();
    throw error;
  }
}

/**
 * Run NIE's verified, resumable Steam sync, then mount the installed game in
 * Inagle. Steam credentials and refresh tokens remain in NIE's environment
 * and token store; they are never accepted as API arguments or added to argv.
 */
export async function syncAndMountIEVR(options: SyncIEVROptions): Promise<MountedIEVRInstall> {
  const installDir = options.installDir.trim();
  if (!installDir) throw new TypeError("installDir must not be empty");

  const maxDownloads = options.maxDownloads ?? 16;
  if (!Number.isSafeInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 128) {
    throw new RangeError("maxDownloads must be an integer from 1 through 128");
  }

  const executable = options.nieBin?.trim() || "nie";
  const run = syncQueue.then(async () => {
    const child = Bun.spawn(
      [executable, "steam", "sync", "--out", installDir, "--max-downloads", String(maxDownloads)],
      { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    const exitCode = await child.exited;
    if (exitCode !== 0) {
      throw new Error(`nie steam sync exited with status ${exitCode}`);
    }

    return mountIEVR(installDir);
  });
  syncQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
