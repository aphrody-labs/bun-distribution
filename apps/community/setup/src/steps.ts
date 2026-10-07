// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps */
/**
 * Steps of the one-click installer. The engine is omar-kit's (repeatable steps, simulation, downloads verified against
 * SHA256SUMS, MCP declaration with a backup); this file only adds what everyone gets beyond it: the installer itself and
 * its shortcut, the desktop app, the Claude plugins, and the two optional roles (administrator: omar-kit's access steps
 * and the kit; creator: creator-kit).
 */
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { formatBytes } from "../../creator-kit/src/lib/format.ts";
import {
  applyPack,
  compareVersions,
  downloadVerified,
  extractTarGz,
  fetchLatest,
  isCompiled,
  pickUpdate,
  UPDATE_BASE_URL,
  type ReleaseArtifact,
} from "../../creator-kit/src/lib/update.ts";
import { desktopCandidates } from "../../creator-kit/src/lib/desktop-launch.ts";
import type { Context } from "../../omar-kit/src/lib/context.ts";
import {
  checkArtifact,
  downloadsFor,
  pickArtifact,
  WINDOWS_PLATFORM,
  type ManifestArtifact,
} from "../../omar-kit/src/lib/downloads.ts";
import {
  createShortcut,
  stepAcces,
  stepAphrody,
  stepCles,
  stepDepot,
  stepMcp,
  stepPrerequis,
  stepYolo,
  type Step,
  type StepResult,
} from "../../omar-kit/src/lib/steps.ts";
import { findTool } from "../../omar-kit/src/lib/tools.ts";

export const DEFAULT_BASE = "https://downloads.aphrody.com";
export const SETUP_EXE = "Aphrody-Setup.exe";
/** Artifact names in latest.json of downloads.aphrody.com. */
export const ARTIFACTS = {
  setup: "aphrody-setup",
  desktop: "aphrody-app",
  omar: "omar-kit",
} as const;
export const PLUGINS = ["plugin-aphrody", "plugin-yolo", "plugin-shenron"] as const;
/** Local Claude Code marketplace written next to the plugins (`claude plugin marketplace add <dir>`). */
export const MARKETPLACE = "aphrody-local";

export type Role = "admin" | "createur";

/** Install folders under `%LOCALAPPDATA%\Aphrody` (Omar's stays where omar-kit and the desktop look for it). */
export function setupDirs(ctx: Context) {
  const root = join(ctx.paths.localAppData, "Aphrody");
  return {
    setup: join(root, "Setup"),
    creator: join(root, "Creator"),
    omar: ctx.paths.installDir,
    plugins: join(ctx.paths.home, ".local", "share", "aphrody", "plugins"),
    tmp: join(root, "Setup", "tmp"),
  };
}

/** The installed desktop app, if any. */
export function desktopApp(ctx: Context): string | undefined {
  return desktopCandidates(ctx.sys.env, ctx.sys.platform).find((path) => existsSync(path));
}

type Verified = { artifact: ManifestArtifact; base: string } | StepResult;

/** The artifact of `name` for Windows, cross-checked with SHA256SUMS; a StepResult says why not. */
async function verifiedArtifact(
  ctx: Context,
  name: string,
  extension: string,
  label: string,
  platform: string = WINDOWS_PLATFORM,
): Promise<Verified> {
  let manifest;
  let base;
  let sums;
  try {
    ({ manifest, base, sums } = await downloadsFor(ctx, DEFAULT_BASE));
  } catch (error) {
    return {
      state: "echec",
      detail: `le site de téléchargement est injoignable (${(error as Error).message})`,
      action: "Vérifie ta connexion Internet puis relance.",
    };
  }
  const artifact = pickArtifact(manifest, name, platform, extension);
  if (!artifact)
    return {
      state: "attente",
      detail: `${label} n'est pas encore publié pour Windows sur le site de téléchargement`,
      action: "Rien à faire de ton côté : relance ce programme quand il sera publié.",
    };
  try {
    checkArtifact(base, artifact, sums);
  } catch (error) {
    return {
      state: "echec",
      detail: `vérification refusée : ${(error as Error).message}`,
      action: "N'installe rien et préviens l'équipe.",
    };
  }
  return { artifact, base };
}

const isResult = (value: Verified): value is StepResult => "state" in value;

const asRelease = (artifact: ManifestArtifact): ReleaseArtifact => ({
  id: artifact.file ?? artifact.url,
  kind: "update",
  format: "tar.gz",
  platform: WINDOWS_PLATFORM,
  file: artifact.file ?? basename(artifact.url),
  url: artifact.url,
  sha256: artifact.sha256,
  size: artifact.size,
});

const windowsOnly = (ctx: Context): StepResult | undefined =>
  ctx.sys.platform === "win32"
    ? undefined
    : { state: "ignore", detail: "installation Windows seulement" };

export const stepSetup: Step = {
  id: "setup",
  titre: "Ce programme d'installation",
  async run(ctx, mode) {
    if (!isCompiled(ctx.exePath)) return { state: "ignore", detail: "lancé depuis les sources" };
    const dir = setupDirs(ctx).setup;
    if (dirname(ctx.exePath) === dir) return { state: "deja", detail: `installé dans ${dir}` };
    if (mode === "simuler")
      return { state: "a-faire", detail: `copie dans ${dir} (pour réparer ou mettre à jour)` };
    await mkdir(dir, { recursive: true });
    await copyFile(ctx.exePath, join(dir, SETUP_EXE));
    return { state: "fait", detail: `copié dans ${dir}` };
  },
};

export const stepDesktop: Step = {
  id: "desktop",
  titre: "Application Aphrody",
  async run(ctx, mode) {
    const skip = windowsOnly(ctx);
    if (skip) return skip;
    const found = await verifiedArtifact(ctx, ARTIFACTS.desktop, ".exe", "L'application Aphrody");
    const installed = desktopApp(ctx);
    if (isResult(found))
      return installed && found.state === "attente"
        ? { state: "deja", detail: `installée (${installed})` }
        : found;
    const { artifact } = found;
    const stamp = join(setupDirs(ctx).setup, "aphrody-app.version");
    const current = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : undefined;
    if (installed && current && compareVersions(current, artifact.version) >= 0)
      return { state: "deja", detail: `version ${current}` };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: `installer l'application ${artifact.version} (${formatBytes(artifact.size)}, empreinte SHA-256 vérifiée)`,
      };
    const file = join(setupDirs(ctx).tmp, artifact.file ?? basename(artifact.url));
    await downloadVerified(asRelease(artifact), file, ctx.fetchImpl);
    ctx.ui.say(
      `  Installation de l'application ${artifact.version} (une fenêtre peut demander l'autorisation : clique « Oui »)...`,
    );
    // Tauri NSIS installer, per-user: `/S` is its silent mode; it creates the Start menu and Desktop shortcuts.
    const run = await ctx.sys.run([file, "/S"], { timeoutMs: 1_200_000 });
    await rm(file, { force: true }).catch(() => undefined);
    ctx.log(`aphrody-app installer -> ${run.code}`);
    if (run.code !== 0 || !desktopApp(ctx))
      return {
        state: "echec",
        detail: `l'installation de l'application a échoué (code ${run.code})`,
        action: "Relance ce programme ; si ça recommence, préviens l'équipe.",
      };
    await mkdir(dirname(stamp), { recursive: true });
    await writeFile(stamp, `${artifact.version}\n`);
    return { state: "fait", detail: `application ${artifact.version} installée` };
  },
};

/** marketplace.json of the local Claude Code marketplace holding the downloaded plugins. */
export function marketplaceJson(plugins: { name: string; dir: string }[]): string {
  return `${JSON.stringify(
    {
      name: MARKETPLACE,
      owner: { name: "aphrody-dev", email: "contact@aphrody.com" },
      description: "Aphrody plugins installed by Aphrody-Setup from downloads.aphrody.com",
      plugins: plugins.map((plugin) => ({ name: plugin.name, source: `./${plugin.dir}` })),
    },
    null,
    2,
  )}\n`;
}

export const stepPlugins: Step = {
  id: "plugins",
  titre: "Plugins Claude (aphrody, yolo, shenron)",
  async run(ctx, mode) {
    const skip = windowsOnly(ctx);
    if (skip) return skip;
    const root = setupDirs(ctx).plugins;
    const found: { id: string; artifact: ManifestArtifact }[] = [];
    for (const id of PLUGINS) {
      // Plugins are published once for every platform (`any`).
      const verified = await verifiedArtifact(ctx, id, ".tar.gz", id, "any");
      if (isResult(verified)) {
        if (verified.state === "echec") return verified;
        continue;
      }
      found.push({ id, artifact: verified.artifact });
    }
    if (found.length === 0)
      return { state: "attente", detail: "aucun plugin publié sur le site de téléchargement" };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: `installer ${found.map((entry) => entry.id).join(", ")} et les déclarer dans Claude Code`,
      };
    for (const { id, artifact } of found) {
      const archive = join(setupDirs(ctx).tmp, artifact.file ?? `${id}.tar.gz`);
      await downloadVerified(asRelease(artifact), archive, ctx.fetchImpl);
      await mkdir(root, { recursive: true });
      const dest = join(root, id);
      const staging = await mkdtemp(join(root, `.${id}-new-`));
      const backup = `${staging}.old`;
      let moved = false;
      let preserveBackup = false;
      try {
        await extractTarGz(archive, staging);
        try {
          await rename(dest, backup);
          moved = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        try {
          await rename(staging, dest);
        } catch (error) {
          if (moved) {
            try {
              await rename(backup, dest);
            } catch (rollbackError) {
              preserveBackup = true;
              throw new AggregateError(
                [error, rollbackError],
                `restauration incomplète : sauvegarde conservée dans ${backup}`,
                { cause: rollbackError },
              );
            }
          }
          throw error;
        }
      } finally {
        await rm(staging, { recursive: true, force: true });
        if (!preserveBackup) await rm(backup, { recursive: true, force: true });
      }
      await rm(archive, { force: true });
    }
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    const plugins = found.map(({ id }) => ({ name: id.replace(/^plugin-/, ""), dir: id }));
    await writeFile(join(root, ".claude-plugin", "marketplace.json"), marketplaceJson(plugins));
    const claude = findTool(ctx.sys, ctx.paths, "claude");
    if (!claude)
      return {
        state: "attente",
        detail: `plugins copiés dans ${root} ; Claude Code n'est pas installé`,
        action: "Installe Claude Code puis relance ce programme pour les activer.",
      };
    await ctx.sys.run([claude, "plugin", "marketplace", "add", root, "--scope", "user"], {
      timeoutMs: 120_000,
    });
    const failed: string[] = [];
    for (const plugin of plugins) {
      const result = await ctx.sys.run(
        [claude, "plugin", "install", `${plugin.name}@${MARKETPLACE}`, "--scope", "user"],
        { timeoutMs: 300_000 },
      );
      if (result.code !== 0) failed.push(plugin.name);
    }
    return failed.length === 0
      ? {
          state: "fait",
          detail: `${plugins.map((p) => p.name).join(", ")} installés dans Claude Code`,
        }
      : {
          state: "echec",
          detail: `Claude Code a refusé : ${failed.join(", ")}`,
          action: "Relance ce programme ; si ça recommence, préviens l'équipe.",
        };
  },
};

export const stepShortcut: Step = {
  id: "raccourci",
  titre: "Raccourci sur le Bureau",
  async run(ctx, mode) {
    const skip = windowsOnly(ctx);
    if (skip) return skip;
    // The desktop app's installer makes its own shortcuts; without the app, the shortcut reopens this installer.
    if (desktopApp(ctx)) return { state: "deja", detail: "créé par l'application Aphrody" };
    const target = join(setupDirs(ctx).setup, SETUP_EXE);
    const lnk = join(ctx.paths.desktopDir, "Aphrody.lnk");
    if (existsSync(lnk)) return { state: "deja", detail: "« Aphrody » est sur le Bureau" };
    if (!isCompiled(ctx.exePath))
      return { state: "ignore", detail: "lancé depuis les sources : pas de raccourci" };
    if (mode === "simuler")
      return { state: "a-faire", detail: "raccourci « Aphrody » sur le Bureau" };
    if (!existsSync(target))
      return { state: "echec", detail: `${target} manque : la copie de ce programme a échoué` };
    return (await createShortcut(ctx, lnk, target, "Aphrody - installation et réparation"))
      ? { state: "fait", detail: "raccourci « Aphrody » sur le Bureau" }
      : { state: "echec", detail: "Windows a refusé de créer le raccourci" };
  },
};

/** omar-kit in Omar's install folder, where the desktop's admin route and its own shortcut find it. */
export const stepOmarKit: Step = {
  id: "omar-kit",
  titre: "Kit administrateur",
  async run(ctx, mode) {
    const skip = windowsOnly(ctx);
    if (skip) return skip;
    const exe = join(setupDirs(ctx).omar, "Aphrody-Omar.exe");
    const found = await verifiedArtifact(ctx, ARTIFACTS.omar, ".tar.gz", "Le kit administrateur");
    if (isResult(found))
      return existsSync(exe) && found.state === "attente" ? { state: "deja", detail: exe } : found;
    if (existsSync(exe)) return { state: "deja", detail: `${exe} (il se met à jour tout seul)` };
    if (mode === "simuler")
      return { state: "a-faire", detail: `installer le kit ${found.artifact.version}` };
    return installPack(ctx, asRelease(found.artifact), setupDirs(ctx).omar, "Aphrody-Omar.exe");
  },
};

/** creator-kit from its own site (creator.aphrody.com), into `%LOCALAPPDATA%\Aphrody\Creator`. */
export const stepCreatorKit: Step = {
  id: "creator-kit",
  titre: "Outils créateur",
  async run(ctx, mode) {
    const skip = windowsOnly(ctx);
    if (skip) return skip;
    const dir = setupDirs(ctx).creator;
    const exe = join(dir, "creator-kit.exe");
    if (existsSync(exe)) return { state: "deja", detail: `${exe} (il se met à jour tout seul)` };
    let release;
    try {
      release = await fetchLatest(UPDATE_BASE_URL, ctx.fetchImpl, 15_000);
    } catch (error) {
      return {
        state: "echec",
        detail: `le site des outils créateur est injoignable (${(error as Error).message})`,
        action: "Vérifie ta connexion Internet puis relance.",
      };
    }
    const artifact = pickUpdate(release, "windows-x64");
    if (!artifact)
      return { state: "attente", detail: "les outils créateur ne sont pas publiés pour Windows" };
    if (mode === "simuler")
      return { state: "a-faire", detail: `installer creator-kit ${release.version}` };
    return installPack(ctx, artifact, dir, "creator-kit.exe");
  },
};

async function installPack(
  ctx: Context,
  artifact: ReleaseArtifact,
  dir: string,
  exeName: string,
): Promise<StepResult> {
  await mkdir(dir, { recursive: true });
  const archive = join(dir, `.install-${Date.now()}.tar.gz`);
  try {
    await downloadVerified(artifact, archive, ctx.fetchImpl);
    await applyPack(archive, dir, exeName);
  } finally {
    await rm(archive, { force: true });
  }
  return { state: "fait", detail: `installé dans ${dir}` };
}

/** Everyone's steps, then each chosen role's. */
export function stepsFor(roles: ReadonlySet<Role>): Step[] {
  return [
    stepSetup,
    stepAphrody,
    stepYolo,
    stepDesktop,
    stepPlugins,
    stepMcp,
    stepShortcut,
    ...(roles.has("admin") ? [stepPrerequis, stepCles, stepAcces, stepDepot, stepOmarKit] : []),
    ...(roles.has("createur") ? [stepCreatorKit] : []),
  ];
}
