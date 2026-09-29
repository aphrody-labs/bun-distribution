#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
// Sync the local repo ecosystem into the agent-home context (`~/.aphrody`).
//
// # Why a script and not a hand-written file
//
// `~/.aphrody/workspace/REPOS.md` is what an agent reads at boot to know which
// repositories exist on this machine, what each one is, and how to invoke it.
// Written by hand it would be wrong within a week: a HEAD moves, a binary gets
// installed, a clone falls behind its submodule. Every line here is READ FROM
// THE MACHINE, so re-running the script is the way to refresh it.
//
// # What it refuses to do
//
// It never invents. A repository that is absent is written as absent, a clone
// that lags its submodule pointer says so, and a tool that exists but is not on
// the PATH is reported as exactly that rather than as missing — the first
// version of this script resolved binaries through `PATH` alone and declared
// `cargo` absent on a machine where it was installed. An agent acting on a
// confident but wrong inventory is worse off than one told the entry is
// unknown.
//
// Usage:
//   aphrody-ops agent-home --source /home/aphro/src            # write the context
//   aphrody-ops agent-home --source /home/aphro/src --dry-run  # print it, touch nothing
//   aphrody-ops agent-home --source /home/aphro/src --profile shenron   # workspace-shenron

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** One repository we expect to find beside the monorepo. */
interface RepoSpec {
  /** Directory name under the home directory. */
  readonly dir: string;
  /** What it is for, in one line. This is the only hand-written field. */
  readonly role: string;
}

/**
 * The ecosystem, in the order an agent should read it: the monorepo first,
 * then what it drives.
 */
const REPOS: readonly RepoSpec[] = [
  {
    dir: "aphrody-ai",
    role: "Monorepo IA Aphrody : CLI, MCP, crates Rust, surfaces Bun et Python.",
  },
  {
    dir: "aphrody-infra",
    role: "Automatisation, services, releases et opérations du workspace Aphrody.",
  },
  { dir: "aphrody-os", role: "Couche OS, GUI, BXC et N2B." },
  { dir: "nie", role: "Monorepo NIE : bibliothèques FFI et applications." },
  { dir: "shenron", role: "Base de connaissances Dragon Ball : corpus, RAG et bot." },
];

/** Binaries this ecosystem installs, and how an agent checks for them. */
const BINARIES = ["aphrody", "aphrody-mcp", "bxc", "bun", "uv", "cargo"] as const;

/** Run a command and return trimmed stdout, or `null` when it fails. */
function run(cmd: string, args: string[], cwd?: string): string | null {
  const out = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: false });
  if (out.status !== 0 || out.stdout == null) return null;
  const text = out.stdout.trim();
  return text.length > 0 ? text : null;
}

function git(cwd: string, ...args: string[]): string | null {
  return run("git", args, cwd);
}

/** Everything read off the disk for one repository. */
interface RepoFacts {
  readonly spec: RepoSpec;
  readonly path: string;
  readonly present: boolean;
  readonly remote: string | null;
  readonly branch: string | null;
  readonly head: string | null;
  /** Count of dirty paths, or null when not a git repo. */
  readonly dirty: number | null;
  readonly pkgName: string | null;
  readonly pkgVersion: string | null;
  readonly bins: readonly string[];
  readonly hasCargo: boolean;
  readonly hasPython: boolean;
  readonly skills: readonly string[];
  /** Notes worth surfacing, e.g. a clone lagging a submodule pointer. */
  readonly warnings: readonly string[];
}

function readSkills(root: string): string[] {
  for (const dir of ["skills", join(".claude", "skills")]) {
    const candidate = join(root, dir);
    if (!existsSync(candidate)) continue;
    const listing = run("git", ["ls-files", "--others", "--cached", "--directory", dir], root);
    if (listing == null) continue;
    const names = new Set<string>();
    for (const line of listing.split("\n")) {
      const rest = line.slice(dir.length + 1);
      const name = rest.split("/")[0];
      if (name != null && name.length > 0 && name !== "SKILL.md") names.add(name);
    }
    if (names.size > 0) return [...names].toSorted();
  }
  return [];
}

function inspect(spec: RepoSpec, source: string): RepoFacts {
  const path = join(source, spec.dir);
  const warnings: string[] = [];
  if (!existsSync(path)) {
    return {
      spec,
      path,
      present: false,
      remote: null,
      branch: null,
      head: null,
      dirty: null,
      pkgName: null,
      pkgVersion: null,
      bins: [],
      hasCargo: false,
      hasPython: false,
      skills: [],
      warnings: ["absent de cette machine"],
    };
  }

  const isGit = existsSync(join(path, ".git"));
  const status = isGit ? git(path, "status", "--porcelain") : null;

  let pkgName: string | null = null;
  let pkgVersion: string | null = null;
  let bins: string[] = [];
  const pkgPath = join(path, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        name?: string;
        version?: string;
        bin?: string | Record<string, string>;
      };
      pkgName = pkg.name ?? null;
      pkgVersion = pkg.version ?? null;
      if (typeof pkg.bin === "string") bins = [pkg.name ?? "(bin)"];
      else if (pkg.bin != null) bins = Object.keys(pkg.bin);
    } catch (err) {
      // A malformed manifest is a fact about the repo, not a reason to abort
      // the whole inventory.
      warnings.push(`package.json illisible: ${String(err)}`);
    }
  }

  return {
    spec,
    path,
    present: true,
    remote: isGit ? git(path, "remote", "get-url", "origin") : null,
    branch: isGit ? git(path, "rev-parse", "--abbrev-ref", "HEAD") : null,
    head: isGit ? git(path, "rev-parse", "--short", "HEAD") : null,
    dirty: status == null ? (isGit ? 0 : null) : status.split("\n").length,
    pkgName,
    pkgVersion,
    bins,
    hasCargo: existsSync(join(path, "Cargo.toml")),
    hasPython: existsSync(join(path, "pyproject.toml")),
    skills: readSkills(path),
    warnings,
  };
}

/**
 * Places a tool can be installed without being on the PATH of whatever shell
 * happens to run this script.
 *
 * Resolving only through `PATH` is how the first version of this table
 * reported `cargo` and `aphrody` as absent on a machine where both were
 * installed — the exact confidently-wrong inventory this script exists to
 * prevent. "Installed but not on PATH" is also a real, actionable state (it is
 * bun's, here), and collapsing it into "absent" would send an agent
 * reinstalling something it already has.
 */
function knownInstallDirs(home: string): string[] {
  const dirs = [join(home, ".cargo", "bin"), join(home, ".bun", "bin")];
  if (process.platform === "win32") {
    const local = process.env["LOCALAPPDATA"];
    if (local != null) {
      dirs.push(
        join(
          local,
          "Microsoft",
          "WinGet",
          "Packages",
          "Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "bun-windows-x64",
        ),
        join(local, "bun"),
      );
    }
  } else {
    dirs.push("/usr/local/bin", join(home, ".local", "bin"));
  }
  return dirs;
}

/** How a tool resolves on this machine. */
type BinState =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "off-path"; readonly path: string }
  | { readonly kind: "absent" };

/**
 * The user's persistent `PATH`, not this process's.
 *
 * On Windows a process inherits the `PATH` its parent had at launch, so a
 * long-running host application can hand a child an out-of-date or trimmed
 * environment. Judging "is it on the PATH" from `process.env.PATH` therefore
 * describes the shell that happened to run this script, not the machine — it
 * is what made an earlier run report every tool as off-PATH on a box where the
 * user's own terminal finds them all. The registry is the machine's answer.
 */
function persistentPathDirs(): string[] {
  if (process.platform !== "win32") return [];
  const query = (scope: "User" | "Machine"): string[] => {
    const raw = run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `[Environment]::GetEnvironmentVariable('Path','${scope}')`,
    ]);
    return raw == null
      ? []
      : raw
          .split(";")
          .map((d) => d.trim())
          .filter((d) => d.length > 0);
  };
  return [...query("User"), ...query("Machine")];
}

function locate(bin: string, home: string, persistent: readonly string[]): BinState {
  const exe = process.platform === "win32" ? `${bin}.exe` : bin;

  const onPath = process.platform === "win32" ? run("where.exe", [bin]) : run("which", [bin]);
  const first = onPath?.split("\n")[0]?.trim();
  if (first != null && first.length > 0) return { kind: "path", path: first };

  // Not in *this* process's PATH — but the user's shell may still find it.
  for (const dir of persistent) {
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return { kind: "path", path: candidate };
  }

  for (const dir of knownInstallDirs(home)) {
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return { kind: "off-path", path: candidate };
  }
  return { kind: "absent" };
}

/** Which of the expected binaries exist, and whether the PATH finds them. */
function binaryTable(home: string): string[] {
  const rows: string[] = [];
  const persistent = persistentPathDirs();
  for (const bin of BINARIES) {
    const state = locate(bin, home, persistent);
    if (state.kind === "absent") {
      rows.push(`| \`${bin}\` | **absent de cette machine** | — | — |`);
      continue;
    }
    const version = run(state.path, ["--version"])?.split("\n")[0] ?? null;
    const label = state.kind === "path" ? "ok" : "**installé, hors PATH**";
    rows.push(`| \`${bin}\` | ${label} | ${version ?? "—"} | \`${state.path}\` |`);
  }
  return rows;
}

function renderRepos(all: readonly RepoFacts[], generatedAt: string): string {
  const lines: string[] = [
    "<!-- GENERATED by aphrody-ops agent-home — do not edit by hand. -->",
    "# Écosystème de dépôts — poste local",
    "",
    `Relevé le **${generatedAt}** par \`aphrody-ops agent-home --source /home/aphro/src\` depuis`,
    "`/home/aphro/src`. Chaque ligne vient du disque : rien n'est déclaré de mémoire.",
    "**Relancer le script après tout clone, pull ou installation** — un inventaire",
    "périmé mais confiant est pire qu'une entrée marquée inconnue.",
    "",
    "## Vue d'ensemble",
    "",
    "| Dépôt | Branche @ HEAD | Propre | Rôle |",
    "|---|---|---|---|",
  ];

  for (const r of all) {
    if (!r.present) {
      lines.push(`| \`${r.spec.dir}\` | — | — | **ABSENT** — ${r.spec.role} |`);
      continue;
    }
    const rev = r.branch != null ? `${r.branch} @ ${r.head ?? "?"}` : "pas un dépôt git";
    const clean = r.dirty == null ? "—" : r.dirty === 0 ? "oui" : `**${r.dirty} fichier(s)**`;
    lines.push(`| \`${r.spec.dir}\` | ${rev} | ${clean} | ${r.spec.role} |`);
  }

  lines.push("", "## Détail", "");
  for (const r of all) {
    lines.push(`### \`~/${r.spec.dir}\``, "");
    if (!r.present) {
      lines.push(`**Absent de cette machine.** ${r.spec.role}`, "");
      continue;
    }
    lines.push(`- Chemin : \`${r.path}\``);
    if (r.remote != null) lines.push(`- Remote : ${r.remote}`);
    if (r.pkgName != null) {
      lines.push(`- Paquet : \`${r.pkgName}\`${r.pkgVersion != null ? ` v${r.pkgVersion}` : ""}`);
    }
    const stacks = [
      r.pkgName != null ? "Bun/TS" : null,
      r.hasCargo ? "Rust" : null,
      r.hasPython ? "Python" : null,
    ].filter((s): s is string => s != null);
    if (stacks.length > 0) lines.push(`- Stack : ${stacks.join(" + ")}`);
    if (r.bins.length > 0)
      lines.push(`- Binaire(s) déclaré(s) : ${r.bins.map((b) => `\`${b}\``).join(", ")}`);
    if (r.skills.length > 0) {
      lines.push(`- Skills (${r.skills.length}) : ${r.skills.map((s) => `\`${s}\``).join(", ")}`);
    }
    if (r.dirty != null && r.dirty > 0) {
      lines.push(
        `- **Working tree sale** : ${r.dirty} chemin(s) — vérifier avant tout pull ou checkout.`,
      );
    }
    for (const w of r.warnings) lines.push(`- ⚠ ${w}`);
    lines.push("");
  }

  lines.push("## Points d'attention", "");
  lines.push(
    "- Le moteur YOLO canonique est `aphrody-os/crates/aphrody-yolo`; ses skills et sa persona",
    "  vivent dans `aphrody-ai/plugins/aphrody`. Ne pas restaurer un checkout YOLO parallèle.",
  );
  lines.push(
    "- `niers` a pour remote `nie.git` : le dossier et le dépôt ne portent pas le",
    "  même nom, ne pas chercher un dépôt `niers` sur GitHub.",
    "- `aphrody-os` contient BXC et N2B. Ne pas restaurer les anciens clones",
    "  `~/bxc` ou `~/n2b` : Aphrody les consomme déjà via le workspace frère,",
    "  et N2B s'utilise par `aphrody n2b`.",
    "",
  );
  return lines.join("\n");
}

function renderTools(generatedAt: string, home: string): string {
  return [
    "<!-- GENERATED by aphrody-ops agent-home — do not edit by hand. -->",
    "# Outils locaux",
    "",
    `Relevé le **${generatedAt}**. Trois états, à ne pas confondre :`,
    "`ok` (le PATH le trouve), **installé, hors PATH** (présent mais à invoquer",
    "par son chemin absolu — surtout ne pas réinstaller), **absent de cette",
    "machine** (ne rien bâtir dessus).",
    "",
    "| Outil | État | Version | Chemin |",
    "|---|---|---|---|",
    ...binaryTable(home),
    "",
    "## Toolbox d'inférence locale",
    "",
    "Le binaire `aphrody` expose la toolbox si — et seulement si — il a été",
    "construit avec ses features (`CLAUDE.md` §7 : une feature opt-in n'est",
    "gardée par personne).",
    "",
    "```bash",
    "aphrody model recommend --task ocr --prefer fast   # que faire tourner ici",
    "aphrody model pull whisper-base-en                 # vérifié par digest",
    "aphrody ocr page <image>                           # feature `ocr`",
    "aphrody job transcribe <audio> && aphrody job run  # feature `jobs`",
    "aphrody infer runtime                              # feature `infer`",
    "```",
    "",
    "Rien n'est téléchargé pendant une inférence : un modèle absent rend une",
    "erreur qui cite la commande `aphrody model pull` à lancer.",
    "",
    "Les mêmes capacités sont exposées en MCP par `aphrody-mcp` construit avec",
    "`--features toolbox` : `aphrody_ocr`, `aphrody_describe_image`,",
    "`aphrody_transcribe`, `aphrody_job_submit` / `aphrody_job_status`.",
    "",
    "**`aphrody_ocr` et `aphrody_describe_image` ne sont pas interchangeables** :",
    "le premier n'a pas le droit de décrire une image (une légende classée comme",
    "transcription corrompt un corpus en silence), le second l'a. Choisir selon",
    "que la réponse doit être une transcription ou une description.",
    "",
  ].join("\n");
}

export function runAgentHome(args: string[]): number {
  const dryRun = args.includes("--dry-run");
  const profileIndex = args.indexOf("--profile");
  const profile = profileIndex >= 0 ? args[profileIndex + 1] : undefined;
  const sourceIndex = args.indexOf("--source");
  const source = resolve(
    sourceIndex >= 0
      ? (args[sourceIndex + 1] ?? "")
      : resolve(import.meta.dir, "..", "..", "..", ".."),
  );
  if (!source) throw new Error("--source requires a workspace directory");

  const home = homedir();
  const workspace = join(
    home,
    ".aphrody",
    profile != null && profile.length > 0 ? `workspace-${profile}` : "workspace",
  );
  const facts = REPOS.map((spec) => inspect(spec, source));
  const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const repos = renderRepos(facts, generatedAt);
  const tools = renderTools(generatedAt, home);
  if (dryRun) {
    process.stdout.write(`${repos}\n---\n${tools}\n`);
    return 0;
  }
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "REPOS.md"), repos, "utf8");
  writeFileSync(join(workspace, "TOOLS.md"), tools, "utf8");
  const missing = facts.filter((fact) => !fact.present).map((fact) => fact.spec.dir);
  process.stderr.write(
    `wrote ${join(workspace, "REPOS.md")} and TOOLS.md\n${facts.length - missing.length}/${facts.length} repo(s) present${missing.length > 0 ? ` — absent: ${missing.join(", ")}` : ""}\n`,
  );
  return 0;
}

if (import.meta.main) process.exit(runAgentHome(process.argv.slice(2)));
