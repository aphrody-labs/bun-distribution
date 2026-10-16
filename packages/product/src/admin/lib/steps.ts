// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps, polling and one host after the other */
/**
 * « Tout installer ou réparer » : independent, repeatable steps. Each one first looks whether its work is already done
 * (then it does nothing), and in simulation mode only says what it would do. Nothing here deletes user data.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { compareVersions } from "../../shared/update.ts";
import { formatBytes } from "../../shared/format.ts";
import type { Context } from "./context.ts";
import {
  checkArtifact,
  downloadsFor,
  verifiedScript,
  pickArtifact,
  WINDOWS_PLATFORM,
} from "./downloads.ts";
import { redact } from "./log.ts";
import {
  claudeCodeState,
  configureClaudeCode,
  configureDesktop,
  desktopState,
  mcpSpec,
} from "./mcp.ts";
import {
  findPackFiles,
  loadProfile,
  readPackFile,
  saveProfile,
  searchDirs,
  type AccessPack,
} from "./profile.ts";
import { ensureSshKey, machineLabel, writeSshFiles } from "./ssh.ts";
import { findTool, toolVersion } from "./tools.ts";
import {
  ensureWgKey,
  importTunnel,
  lastFingerprint,
  rememberFingerprint,
  stageConf,
  tunnelState,
} from "./tunnel.ts";
import { MARK } from "./ui.ts";

export type StepState =
  "fait" | "deja" | "a-faire" | "attente" | "echec" | "ignore";

export interface StepResult {
  state: StepState;
  detail: string;
  /** What Omar must do next, when this step could not finish. */
  action?: string;
}

export type Mode = "executer" | "simuler";

export interface InstallState {
  pack?: AccessPack;
  /** Path of an access file given on the command line. */
  packFile?: string;
  repoReady: boolean;
}

export interface Step {
  id: string;
  titre: string;
  run(ctx: Context, mode: Mode, state: InstallState): Promise<StepResult>;
}

const WINGET_ARGS = [
  "install",
  "-e",
  "--source",
  "winget",
  "--silent",
  "--accept-package-agreements",
  "--accept-source-agreements",
];
const psQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export async function createShortcut(
  ctx: Context,
  lnk: string,
  target: string,
  description = "Aphrody - kit administrateur",
): Promise<boolean> {
  const script = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(lnk)}); $s.TargetPath=${psQuote(target)}; $s.WorkingDirectory=${psQuote(dirname(target))}; $s.Description=${psQuote(description)}; $s.Save()`;
  const result = await ctx.sys.run(
    ["powershell", "-NoProfile", "-Command", script],
    {
      timeoutMs: 30_000,
    },
  );
  return result.code === 0;
}

/** Administrator repair uses the same executable and installation folder as setup. */
export const stepKit: Step = {
  id: "kit",
  titre: "Aphrody",
  async run(ctx, mode, state) {
    const { stepSetup, setupDirs, SETUP_EXE } =
      await import("../../setup/steps.ts");
    const result = await stepSetup.run(ctx, mode, state);
    if (result.state !== "fait") return result;
    const dir = setupDirs(ctx).setup;
    const guide = join(ctx.exeDir, "Guide.html");
    if (existsSync(guide)) await copyFile(guide, join(dir, "Guide.html"));
    if (ctx.sys.platform === "win32") {
      const target = join(dir, SETUP_EXE);
      await createShortcut(
        ctx,
        join(ctx.paths.desktopDir, "Aphrody.lnk"),
        target,
      );
      await createShortcut(
        ctx,
        join(
          ctx.paths.appData,
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          "Aphrody.lnk",
        ),
        target,
      );
    }
    return result;
  },
};

async function wingetInstall(
  ctx: Context,
  id: string,
  tool: "git" | "wireguard",
): Promise<StepResult> {
  const { sys, paths } = ctx;
  const winget = findTool(sys, paths, "winget");
  if (!winget)
    return {
      state: "echec",
      detail:
        "le gestionnaire d'applications de Windows (winget) est introuvable",
      action:
        "Ouvre le Microsoft Store, cherche « Programme d'installation d'application », mets-le à jour, puis relance.",
    };
  ctx.ui.say(
    `  Installation de ${id} par Windows (une fenêtre peut te demander l'autorisation : clique « Oui »)...`,
  );
  const result = await sys.run(
    [winget, ...WINGET_ARGS.slice(0, 1), "--id", id, ...WINGET_ARGS.slice(1)],
    { inherit: true, timeoutMs: 1_200_000 },
  );
  ctx.log(`winget ${id} -> ${result.code}`);
  if (findTool(sys, paths, tool))
    return { state: "fait", detail: `${id} installé` };
  return {
    state: "echec",
    detail: `${id} n'a pas pu être installé (code ${result.code})`,
    action:
      "Relance « Tout installer ou réparer » ; si ça recommence, envoie le message d'aide à l'équipe.",
  };
}

export const stepPrerequis: Step = {
  id: "prerequis",
  titre: "Git et WireGuard",
  async run(ctx, mode) {
    const { sys, paths } = ctx;
    if (sys.platform !== "win32")
      return { state: "ignore", detail: "installation Windows seulement" };
    const needs = [
      { id: "Git.Git", tool: "git" as const, label: "Git" },
      {
        id: "WireGuard.WireGuard",
        tool: "wireguard" as const,
        label: "WireGuard",
      },
    ].filter((item) => !findTool(sys, paths, item.tool));
    if (needs.length === 0)
      return { state: "deja", detail: "Git et WireGuard sont installés" };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: `installer ${needs.map((item) => item.label).join(" et ")}`,
      };
    for (const item of needs) {
      const result = await wingetInstall(ctx, item.id, item.tool);
      if (result.state === "echec") return result;
    }
    return {
      state: "fait",
      detail: `${needs.map((item) => item.label).join(" et ")} installé${needs.length > 1 ? "s" : ""}`,
    };
  },
};

export interface KeyFile {
  path: string;
  text: string;
}

export function keysMessage(args: {
  who: string;
  machine: string;
  windows: string;
  version: string;
  now: Date;
  wgPublic: string;
  sshPublic: string;
}): string {
  return [
    "Aphrody : clés publiques (aucun secret dans ce fichier, tu peux le coller dans un message)",
    `date: ${args.now.toISOString()}`,
    `personne: ${args.who}`,
    `pc: ${args.machine} (${args.windows})`,
    `kit: ${args.version}`,
    "",
    `wireguard-public-key: ${args.wgPublic}`,
    `ssh-public-key: ${args.sshPublic}`,
    "",
  ].join("\n");
}

/** Clipboard through clip.exe (Windows) so Omar can paste straight into a message. */
export async function copyToClipboard(
  ctx: Context,
  value: string,
): Promise<boolean> {
  if (ctx.sys.platform !== "win32") return false;
  const result = await ctx.sys.run(["clip"], {
    input: value,
    timeoutMs: 10_000,
  });
  return result.code === 0;
}

export async function makeKeys(
  ctx: Context,
): Promise<{ file: string; text: string; created: boolean; copied: boolean }> {
  const { sys, paths } = ctx;
  const label = machineLabel(sys.env);
  const ssh = await ensureSshKey(
    sys,
    paths,
    `omar@${label}`,
    findTool(sys, paths, "sshKeygen") ?? "ssh-keygen",
  );
  const wg = await ensureWgKey(sys, paths);
  const text = keysMessage({
    who: "omar",
    machine: label,
    windows: sys.platform,
    version: ctx.version,
    now: sys.now(),
    wgPublic: wg.publicKey,
    sshPublic: ssh.publicKey,
  });
  await mkdir(paths.desktopDir, { recursive: true });
  const file = join(paths.desktopDir, "a-envoyer-a-l-equipe.txt");
  await writeFile(file, text);
  const copied = await copyToClipboard(ctx, text);
  ctx.log(`clés publiques écrites dans ${file}`);
  return { file, text, created: ssh.created || wg.created, copied };
}

export const stepCles: Step = {
  id: "cles",
  titre: "Tes clés (SSH et WireGuard)",
  async run(ctx, mode) {
    const { sys, paths } = ctx;
    if (!findTool(sys, paths, "sshKeygen") && sys.platform === "win32")
      return {
        state: "echec",
        detail: "le client OpenSSH de Windows manque",
        action:
          "Paramètres Windows > Applications > Fonctionnalités facultatives > ajoute « Client OpenSSH », puis relance.",
      };
    const have = existsSync(paths.sshKey) && existsSync(paths.wgKeyFile);
    if (mode === "simuler")
      return have
        ? { state: "deja", detail: "clés présentes" }
        : { state: "a-faire", detail: "créer tes deux clés sur ce PC" };
    const made = await makeKeys(ctx);
    return made.created
      ? {
          state: "fait",
          detail: `clés créées ; clés publiques dans ${made.file}${made.copied ? " (et copiées : colle-les dans un message)" : ""}`,
        }
      : { state: "deja", detail: "clés déjà créées" };
  },
};

function packSearchDirs(ctx: Context): string[] {
  return searchDirs(ctx.paths, ctx.exeDir);
}

export const stepAcces: Step = {
  id: "acces",
  titre: "Accès de l'équipe (tunnel privé et SSH)",
  async run(ctx, mode, state) {
    const { sys, paths, log } = ctx;
    const candidates = state.packFile
      ? [state.packFile]
      : findPackFiles(packSearchDirs(ctx));
    const existing = await loadProfile(paths);
    let pack = existing;
    let fromFile: string | undefined;
    if (candidates[0]) {
      try {
        pack = await readPackFile(candidates[0]);
        fromFile = candidates[0];
      } catch (error) {
        return {
          state: "echec",
          detail: (error as Error).message,
          action: "Demande un nouveau fichier d'accès à l'équipe.",
        };
      }
    }
    if (!pack)
      return {
        state: "attente",
        detail: "le fichier d'accès de l'équipe n'est pas encore là",
        action:
          "Envoie « a-envoyer-a-l-equipe.txt » à l'équipe ; ils te renvoient « aphrody-omar-acces.json » : mets-le dans Téléchargements puis relance cette étape.",
      };
    state.pack = pack;
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: fromFile
          ? `importer ${fromFile}`
          : "réappliquer l'accès déjà importé",
      };
    await saveProfile(paths, pack);
    const files = await writeSshFiles(pack, paths, sys.now());
    log(
      `accès importé (${Object.keys(pack.hosts).join(", ")})${files.changedUserConfig ? ", ~/.ssh/config mis à jour" : ""}`,
    );
    const notes = [`serveurs : ${Object.keys(pack.hosts).join(", ")}`];
    if (files.changedUserConfig)
      notes.push("ssh_config relié à ton fichier SSH");
    if (!pack.wireguard)
      return {
        state: "fait",
        detail: `${notes.join(" ; ")} (pas de tunnel dans ce fichier)`,
      };

    const tunnel = pack.wireguard.tunnelName;
    const key = await ensureWgKey(sys, paths);
    if (
      pack.wireguard.expectedPublicKey &&
      key.publicKey !== pack.wireguard.expectedPublicKey
    )
      return {
        state: "attente",
        detail:
          "la clé publique de ce PC ne correspond pas encore au pair autorisé",
        action:
          "Envoie a-envoyer-a-l-equipe.txt pour autoriser cette clé. Le tunnel existant est conservé.",
      };
    const staged = await stageConf(sys, paths, pack, key.privateKey);
    const running = (await tunnelState(sys, tunnel)) === "RUNNING";
    if (running && (await lastFingerprint(paths)) === staged.fingerprint) {
      await rm(staged.path, { force: true });
      return {
        state: "deja",
        detail: `${notes.join(" ; ")} ; tunnel « ${tunnel} » déjà actif`,
      };
    }
    ctx.ui.say(
      "  Windows va te demander l'autorisation d'installer le tunnel : clique « Oui ».",
    );
    const result = await importTunnel(ctx, staged, tunnel);
    if (!result.ok)
      return {
        state: "echec",
        detail: result.detail,
        action:
          "Relance « Tout installer ou réparer » et clique « Oui » dans la fenêtre Windows.",
      };
    await rememberFingerprint(paths, staged.fingerprint);
    return { state: "fait", detail: `${notes.join(" ; ")} ; ${result.detail}` };
  },
};

export const stepAphrody: Step = {
  id: "aphrody",
  titre: "aphrody",
  async run(ctx, mode, state) {
    const { sys, paths, fetchImpl } = ctx;
    if (sys.platform !== "win32")
      return { state: "ignore", detail: "installation Windows seulement" };
    const base = state.pack?.downloadsBase ?? "https://downloads.aphrody.com";
    let snapshot;
    try {
      snapshot = await downloadsFor(ctx, base);
    } catch (error) {
      return {
        state: "echec",
        detail: `le site de téléchargement est injoignable (${(error as Error).message})`,
        action: "Vérifie ta connexion Internet puis relance.",
      };
    }
    const artifact = pickArtifact(
      snapshot.manifest,
      "aphrody",
      WINDOWS_PLATFORM,
      ".zip",
    );
    if (!artifact)
      return {
        state: "attente",
        detail:
          "aphrody n'est pas encore publié pour Windows sur le site de téléchargement",
        action:
          "Rien à faire de ton côté : l'équipe doit le publier ; le kit l'installera à ce moment-là (relance « Tout installer ou réparer » plus tard).",
      };
    try {
      checkArtifact(snapshot.base, artifact, snapshot.sums);
    } catch (error) {
      return {
        state: "echec",
        detail: `vérification refusée : ${(error as Error).message}`,
        action: "N'installe rien et prévenir l'équipe.",
      };
    }
    const installed = findTool(sys, paths, "aphrody");
    const version = installed ? await toolVersion(sys, installed) : undefined;
    if (version && compareVersions(version, artifact.version) >= 0)
      return { state: "deja", detail: `version ${version}` };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: `installer aphrody ${artifact.version} (${formatBytes(artifact.size)}, empreinte SHA-256 vérifiée)`,
      };
    let script;
    try {
      script = await verifiedScript(snapshot, "install.ps1", fetchImpl);
    } catch (error) {
      return {
        state: "echec",
        detail: `vérification refusée : ${(error as Error).message}`,
      };
    }
    if (!script.includes("SHA256SUMS") || !script.includes("Get-FileHash"))
      return {
        state: "echec",
        detail:
          "le script d'installation du site ne vérifie pas les empreintes : je ne le lance pas",
        action: "Prévenir l'équipe.",
      };
    const dir = join(paths.installDir, "tmp");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "install-aphrody.ps1");
    await writeFile(file, script);
    ctx.ui.say(
      `  Téléchargement et installation d'aphrody ${artifact.version} (empreinte SHA-256 vérifiée)...`,
    );
    const run = await sys.run(
      ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
      {
        inherit: true,
        timeoutMs: 1_200_000,
        env: {
          APHRODY_DOWNLOAD_URL: base,
          APHRODY_RELEASE: snapshot.manifest.release.id,
          APHRODY_COMPONENTS: "aphrody",
        },
      },
    );
    await rm(file, { force: true }).catch(() => undefined);
    ctx.log(`install.ps1 aphrody -> ${run.code}`);
    const after = findTool(sys, paths, "aphrody");
    if (run.code === 0 && after)
      return {
        state: "fait",
        detail: `aphrody ${(await toolVersion(sys, after)) ?? artifact.version} installé`,
      };
    return {
      state: "echec",
      detail: `l'installation d'aphrody a échoué (code ${run.code})`,
      action:
        "Relance ; si ça recommence, envoie le message d'aide à l'équipe.",
    };
  },
};

export const stepDepot: Step = {
  id: "depot",
  titre: "Copie du dépôt Aphrody (GitHub)",
  async run(ctx, mode, state) {
    const { sys, paths } = ctx;
    const git = findTool(sys, paths, "git");
    if (!git)
      return {
        state: "echec",
        detail: "Git n'est pas installé",
        action: "Relance « Tout installer ou réparer ».",
      };
    const repository = state.pack?.repository ?? "aphrody-labs/aphrody";
    const url = `https://github.com/${repository}.git`;
    if (existsSync(join(paths.repoDir, ".git"))) {
      state.repoReady = true;
      const origin = await sys.run(
        [git, "-C", paths.repoDir, "config", "--get", "remote.origin.url"],
        { timeoutMs: 20_000 },
      );
      if (origin.code !== 0 || !origin.stdout.includes(repository))
        return {
          state: "echec",
          detail: `${paths.repoDir} contient un autre dépôt`,
          action:
            "Déplace ce dossier ailleurs (je n'y touche pas) puis relance.",
        };
      const dirty = await sys.run(
        [git, "-C", paths.repoDir, "status", "--porcelain"],
        {
          timeoutMs: 60_000,
        },
      );
      if (dirty.stdout.trim() !== "")
        return {
          state: "deja",
          detail:
            "dépôt présent (des fichiers modifiés : pas de mise à jour automatique)",
        };
      if (mode === "simuler")
        return {
          state: "a-faire",
          detail: "mettre le dépôt à jour (sans écraser)",
        };
      const pull = await sys.run(
        [git, "-C", paths.repoDir, "pull", "--ff-only"],
        {
          inherit: true,
          timeoutMs: 600_000,
        },
      );
      return pull.code === 0
        ? { state: "deja", detail: "dépôt à jour" }
        : {
            state: "attente",
            detail: "mise à jour impossible pour l'instant",
            action: "Ce n'est pas bloquant. Réessaie plus tard.",
          };
    }
    if (existsSync(paths.repoDir))
      return {
        state: "echec",
        detail: `${paths.repoDir} existe déjà et n'est pas un dépôt`,
        action: "Renomme ce dossier (je n'y touche pas) puis relance.",
      };
    const free = await sys.freeBytes(paths.home);
    if (free !== undefined && free < 5 * 1024 ** 3)
      return {
        state: "echec",
        detail: `seulement ${formatBytes(free)} libres`,
        action: "Libère au moins 5 Go puis relance.",
      };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: `copier ${repository} dans ${paths.repoDir} (connexion GitHub dans ton navigateur)`,
      };
    ctx.ui.say(
      "  Copie du dépôt : une fenêtre ou ton navigateur va te demander de te connecter à GitHub. Ça peut prendre plusieurs minutes...",
    );
    const clone = await sys.run(
      [
        git,
        "-c",
        "core.longpaths=true",
        "clone",
        "--filter=blob:none",
        url,
        paths.repoDir,
      ],
      { inherit: true, timeoutMs: 3_600_000 },
    );
    ctx.log(`git clone ${repository} -> ${clone.code}`);
    if (clone.code !== 0)
      return {
        state: "echec",
        detail:
          "la copie du dépôt a échoué (connexion GitHub refusée ou interrompue)",
        action:
          "Vérifie que tu as accepté l'invitation à l'organisation aphrody-labs (mail de GitHub), puis relance et connecte-toi dans la fenêtre.",
      };
    state.repoReady = true;
    return { state: "fait", detail: `dépôt copié dans ${paths.repoDir}` };
  },
};

export const stepMcp: Step = {
  id: "mcp",
  titre: "MCP Aphrody dans ton assistant",
  async run(ctx, mode) {
    const { sys, paths } = ctx;
    const aphrody = findTool(sys, paths, "aphrody");
    if (!aphrody)
      return {
        state: "attente",
        detail: "dépend d'aphrody, pas encore installé",
        action: "Relance après l'installation d'aphrody.",
      };
    const spec = mcpSpec(aphrody, findTool(sys, paths, "aphrody-mcp"));
    const claude = findTool(sys, paths, "claude");
    const desktop = await desktopState(paths, spec);
    const code = await claudeCodeState(sys, claude, spec);
    if (desktop === "aucun" && code === "aucun")
      return {
        state: "attente",
        detail: "ni Claude Desktop ni Claude Code ne sont installés",
        action:
          "Installe ton assistant, puis relance « Tout installer ou réparer ».",
      };
    if (desktop !== "pas-declare" && code !== "pas-declare")
      return { state: "deja", detail: "déjà déclaré" };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail:
          "déclarer le MCP aphrody (une sauvegarde de ta configuration est faite avant)",
      };
    const results = [
      ...(desktop === "pas-declare"
        ? await configureDesktop(paths, spec, sys.now())
        : []),
      ...(code === "pas-declare"
        ? [await configureClaudeCode(sys, claude, spec)]
        : []),
    ];
    const failed = results.filter((entry) => entry.state === "echec");
    if (failed.length > 0)
      return {
        state: "echec",
        detail: redact(failed.map((entry) => entry.detail).join(" ; ")),
        action: "Envoie le message d'aide à l'équipe.",
      };
    return {
      state: "fait",
      detail: "déclaré : ferme puis rouvre ton assistant pour le voir",
    };
  },
};

export const STEPS: Step[] = [
  stepKit,
  stepPrerequis,
  stepCles,
  stepAcces,
  stepAphrody,
  stepDepot,
  stepMcp,
];

const STEP_MARK: Record<StepState, string> = {
  fait: MARK.ok,
  deja: MARK.ok,
  "a-faire": MARK.wait,
  attente: MARK.wait,
  echec: MARK.fail,
  ignore: MARK.skip,
};

export interface InstallReport {
  results: { step: Step; result: StepResult }[];
  failed: number;
  waiting: number;
}

/** Run every step in order; a failure never stops the independent steps after it. */
export async function runInstall(
  ctx: Context,
  mode: Mode,
  state: InstallState = { repoReady: false },
  steps: Step[] = STEPS,
): Promise<InstallReport> {
  const results: InstallReport["results"] = [];
  for (const step of steps) {
    ctx.ui.say(`${STEP_MARK["a-faire"]} ${step.titre}...`);
    let result: StepResult;
    try {
      result = await step.run(ctx, mode, state);
    } catch (error) {
      result = {
        state: "echec",
        detail: redact((error as Error).message),
        action: "Envoie le message d'aide à l'équipe.",
      };
    }
    ctx.log(`étape ${step.id} : ${result.state} - ${result.detail}`);
    ctx.ui.say(`${STEP_MARK[result.state]} ${step.titre} : ${result.detail}`);
    if (result.action && result.state !== "deja" && result.state !== "fait")
      ctx.ui.say(`      -> ${result.action}`);
    results.push({ step, result });
  }
  return {
    results,
    failed: results.filter((entry) => entry.result.state === "echec").length,
    waiting: results.filter((entry) => entry.result.state === "attente").length,
  };
}
