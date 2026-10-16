// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { redact } from "./log.ts";
import { slashes, type KitPaths } from "./paths.ts";
import type { AccessPack } from "./profile.ts";
import type { RunResult, System } from "./system.ts";

/** POSIX single-quote quoting: safe for any value, including quotes and `$`. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export const hostAlias = (id: string): string => `aphrody-${id}`;

/** ssh_config of the kit: one alias per host, strict host-key checking when the pack carries the host keys. */
export function renderSshConfig(pack: AccessPack, paths: KitPaths): string {
  const strict = pack.hostKeys.length > 0 ? "yes" : "accept-new";
  const blocks = Object.entries(pack.hosts).map(([id, host]) =>
    [
      `Host ${hostAlias(id)}${id === "vps" || id === "dbfr" ? ` ${id}` : ""}`,
      `  HostName ${host.address}`,
      `  Port ${host.port}`,
      `  User ${host.user}`,
      `  IdentityFile "${slashes(paths.sshKey)}"`,
      "  IdentitiesOnly yes",
      `  UserKnownHostsFile "${slashes(paths.knownHostsFile)}"`,
      `  StrictHostKeyChecking ${strict}`,
      "  ServerAliveInterval 15",
      "  ServerAliveCountMax 4",
      "  ConnectTimeout 8",
    ].join("\n"),
  );
  return `# Généré par Aphrody Omar : ne pas modifier (réécrit à chaque « acces »).\n${blocks.join("\n\n")}\n`;
}

const BEGIN = "# >>> aphrody-omar >>>";
const END = "# <<< aphrody-omar <<<";

/** Pure: put (or refresh) our marked Include block at the top of a user ssh config. Everything else is kept as is. */
export function withIncludeBlock(
  existing: string,
  includePath: string,
): string {
  const block = `${BEGIN}\nInclude "${slashes(includePath)}"\n${END}\n`;
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const stripped = removeIncludeBlock(existing);
  const blockText = block.replaceAll("\n", eol);
  return stripped === "" ? blockText : `${blockText}${eol}${stripped}`;
}

export function removeIncludeBlock(existing: string): string {
  const pattern = new RegExp(`${BEGIN}[\\s\\S]*?${END}\\r?\\n?(\\r?\\n)?`, "g");
  return existing.replace(pattern, "");
}

export interface SshFiles {
  changedUserConfig: boolean;
  backup?: string;
}

/** Write the kit's ssh_config and known_hosts, and the Include block of the user's own config (saved first). */
export async function writeSshFiles(
  pack: AccessPack,
  paths: KitPaths,
  now: Date,
): Promise<SshFiles> {
  await mkdir(dirname(paths.sshConfigFile), { recursive: true });
  await writeFile(paths.sshConfigFile, renderSshConfig(pack, paths));
  if (pack.hostKeys.length > 0)
    await writeFile(paths.knownHostsFile, `${pack.hostKeys.join("\n")}\n`);
  else if (!existsSync(paths.knownHostsFile))
    await writeFile(paths.knownHostsFile, "");
  await mkdir(dirname(paths.userSshConfig), { recursive: true });
  const before = existsSync(paths.userSshConfig)
    ? await readFile(paths.userSshConfig, "utf8")
    : "";
  const after = withIncludeBlock(before, paths.sshConfigFile);
  if (after === before) return { changedUserConfig: false };
  let backup: string | undefined;
  if (before !== "") {
    backup = `${paths.userSshConfig}.avant-aphrody-${now.toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
    await copyFile(paths.userSshConfig, backup);
  }
  await writeFile(paths.userSshConfig, after);
  return { changedUserConfig: true, ...(backup ? { backup } : {}) };
}

export interface SshOptions {
  batch?: boolean;
  connectTimeoutSecs?: number;
  /** Extra remote arguments, passed as positional parameters of `sh -s`. */
  args?: string[];
}

/** argv of `ssh` running `sh -s -- <args>` on the host, the script itself being sent on stdin (nothing is interpolated). */
export function sshArgv(
  paths: KitPaths,
  hostId: string,
  options: SshOptions = {},
): string[] {
  const argv = [
    "ssh",
    "-F",
    paths.sshConfigFile,
    "-o",
    `BatchMode=${options.batch === false ? "no" : "yes"}`,
  ];
  if (options.connectTimeoutSecs)
    argv.push("-o", `ConnectTimeout=${options.connectTimeoutSecs}`);
  argv.push(
    hostAlias(hostId),
    `sh -s -- ${(options.args ?? []).map(shellQuote).join(" ")}`.trimEnd(),
  );
  return argv;
}

export interface RemoteResult extends RunResult {
  /** Plain-language reason when ssh itself failed (not the remote script). */
  problem?:
    | "cle-refusee"
    | "hote-inconnu"
    | "injoignable"
    | "delai"
    | "ssh-absent"
    | "autre";
}

export function classifySshFailure(result: RunResult): RemoteResult["problem"] {
  const text = `${result.stderr}`.toLowerCase();
  if (result.timedOut) return "delai";
  if (
    result.code === 127 &&
    !text.includes("not found") &&
    result.stdout === ""
  )
    return "ssh-absent";
  if (text.includes("permission denied")) return "cle-refusee";
  if (
    text.includes("host key verification failed") ||
    text.includes("remote host identification has changed")
  )
    return "hote-inconnu";
  if (
    text.includes("timed out") ||
    text.includes("no route to host") ||
    text.includes("connection refused") ||
    text.includes("could not resolve") ||
    text.includes("network is unreachable") ||
    text.includes("connection closed")
  )
    return "injoignable";
  return result.code === 255 ? "autre" : undefined;
}

/** Run a script on a host through ssh. The script reaches the host on stdin; arguments are quoted. */
export async function runRemote(
  sys: System,
  paths: KitPaths,
  hostId: string,
  script: string,
  options: SshOptions & { timeoutMs?: number; inherit?: boolean } = {},
): Promise<RemoteResult> {
  const result = await sys.run(sshArgv(paths, hostId, options), {
    input: script,
    timeoutMs: options.timeoutMs ?? 60_000,
    ...(options.inherit ? { inherit: true } : {}),
  });
  const problem = result.code === 0 ? undefined : classifySshFailure(result);
  return {
    ...result,
    stderr: redact(result.stderr),
    ...(problem ? { problem } : {}),
  };
}

export const SSH_PROBLEM_TEXT: Record<
  NonNullable<RemoteResult["problem"]>,
  string
> = {
  "cle-refusee":
    "le serveur refuse ta clé : elle n'est pas encore autorisée (envoie le fichier de clés à l'équipe)",
  "hote-inconnu":
    "l'empreinte du serveur ne correspond pas à celle attendue : ne continue pas, préviens l'équipe",
  injoignable: "le serveur ne répond pas : le tunnel est-il actif ?",
  delai: "le serveur met trop de temps à répondre",
  "ssh-absent":
    "le programme SSH de Windows est introuvable (Paramètres > Applications > Fonctionnalités facultatives > Client OpenSSH)",
  autre: "la connexion SSH a échoué",
};

/** Make the SSH key pair if it does not exist yet. Returns the public key line. */
export async function ensureSshKey(
  sys: System,
  paths: KitPaths,
  comment: string,
  keygen = "ssh-keygen",
): Promise<{ created: boolean; publicKey: string }> {
  const pub = `${paths.sshKey}.pub`;
  if (existsSync(paths.sshKey) && existsSync(pub))
    return { created: false, publicKey: (await readFile(pub, "utf8")).trim() };
  if (existsSync(paths.sshKey)) {
    // private key without its public half: derive it, never overwrite the private key
    const derived = await sys.run([keygen, "-y", "-f", paths.sshKey]);
    if (derived.code !== 0)
      throw new Error(
        "clé SSH existante illisible (protégée par une phrase secrète ?)",
      );
    const line = `${derived.stdout.trim()} ${comment}`;
    await writeFile(pub, `${line}\n`);
    return { created: false, publicKey: line };
  }
  await mkdir(dirname(paths.sshKey), { recursive: true });
  const made = await sys.run([
    keygen,
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    comment,
    "-f",
    paths.sshKey,
    "-q",
  ]);
  if (made.code !== 0 || !existsSync(pub))
    throw new Error(
      `ssh-keygen a échoué : ${redact(made.stderr || made.stdout)
        .trim()
        .slice(0, 200)}`,
    );
  return { created: true, publicKey: (await readFile(pub, "utf8")).trim() };
}

/** Machine label for key comments and messages: letters, digits and dashes only. */
export function machineLabel(env: Record<string, string | undefined>): string {
  const raw = env.COMPUTERNAME ?? env.HOSTNAME ?? "pc";
  return raw.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 30) || "pc";
}
