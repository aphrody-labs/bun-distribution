// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Env } from "./system.ts";

/** Every place the kit reads or writes, derived once from the environment. Nothing here is inside the repository. */
export interface KitPaths {
  home: string;
  /** Exe copy, log, update state: `%LOCALAPPDATA%\Aphrody\Omar`. */
  installDir: string;
  logFile: string;
  /** Profile, WireGuard key, known_hosts, ssh_config: `%USERPROFILE%\.aphrody\omar` (private to the user). */
  dataDir: string;
  profileFile: string;
  wgKeyFile: string;
  knownHostsFile: string;
  sshConfigFile: string;
  /** Private SSH key `%USERPROFILE%\.ssh\aphrody_omar`; the public half is `<key>.pub`. */
  sshKey: string;
  userSshConfig: string;
  /** Default clone location `%USERPROFILE%\Aphrody`. */
  repoDir: string;
  downloadsDir: string;
  desktopDir: string;
  programFiles: string;
  programData: string;
  appData: string;
  localAppData: string;
}

export function kitPaths(env: Env): KitPaths {
  const home = env.USERPROFILE ?? env.HOME ?? homedir();
  const localAppData = env.LOCALAPPDATA ?? join(home, ".local", "share");
  const appData = env.APPDATA ?? join(home, ".config");
  const installDir = join(localAppData, "Aphrody", "Omar");
  const dataDir = join(home, ".aphrody", "omar");
  const desktopCandidates = [
    join(home, "Desktop"),
    ...(env.OneDrive ? [join(env.OneDrive, "Desktop")] : []),
    ...(env.OneDriveConsumer ? [join(env.OneDriveConsumer, "Desktop")] : []),
  ];
  return {
    home,
    installDir,
    logFile: join(installDir, "omar.log"),
    dataDir,
    profileFile: join(dataDir, "profil.json"),
    wgKeyFile: join(dataDir, "wg", "cle-privee.key"),
    knownHostsFile: join(dataDir, "known_hosts"),
    sshConfigFile: join(dataDir, "ssh_config"),
    sshKey: join(home, ".ssh", "aphrody_omar"),
    userSshConfig: join(home, ".ssh", "config"),
    repoDir: join(home, "Aphrody"),
    downloadsDir: join(home, "Downloads"),
    desktopDir:
      desktopCandidates.find((dir) => existsSync(dir)) ?? desktopCandidates[0]!,
    programFiles: env.ProgramFiles ?? "C:\\Program Files",
    programData: env.ProgramData ?? "C:\\ProgramData",
    appData,
    localAppData,
  };
}

/** Forward slashes: what OpenSSH and Git accept on Windows without escaping trouble. */
export const slashes = (path: string): string => path.replaceAll("\\", "/");
