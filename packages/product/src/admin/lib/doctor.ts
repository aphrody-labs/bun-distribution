// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps, polling and one host after the other */
/** « Est-ce que tout est prêt ? » : every check says what it saw, in plain French, who must act and what to do. */
import { existsSync } from "node:fs";

import { formatBytes } from "../../shared/format.ts";
import type { Context } from "./context.ts";
import { fetchManifest, pickArtifact } from "./downloads.ts";
import { claudeCodeState, desktopState, mcpSpec } from "./mcp.ts";
import { loadProfile, trainHostId, type AccessPack } from "./profile.ts";
import { SCRIPTS } from "./remote.ts";
import { runRemote, SSH_PROBLEM_TEXT } from "./ssh.ts";
import { findTool, toolVersion } from "./tools.ts";
import { MARK } from "./ui.ts";

export type Status = "ok" | "attention" | "echec" | "attente" | "ignore";
export type Responsible = "omar" | "equipe";

export interface Check {
  id: string;
  titre: string;
  status: Status;
  detail: string;
  /** What to do, in one sentence (absent when everything is fine). */
  action?: string;
  responsable?: Responsible;
}

export interface Report {
  generatedAt: string;
  checks: Check[];
  verdict: "pret" | "presque" | "pas-pret";
  /** Ready to launch a training on the training host. */
  entrainementPret: boolean;
}

export const GIB = 1024 ** 3;

const check = (
  id: string,
  titre: string,
  status: Status,
  detail: string,
  action?: string,
  responsable: Responsible = "omar",
): Check => ({
  id,
  titre,
  status,
  detail,
  ...(action ? { action, responsable } : {}),
});

export interface HostProbe {
  user?: string;
  cpu?: number;
  load?: string;
  memTotalKb?: number;
  memAvailKb?: number;
  diskAvailKb?: number;
  diskTotalKb?: number;
  gpus: { name: string; totalMiB: number; usedMiB: number; util: number }[];
  noGpu: boolean;
  aphrody?: string;
  aphrodyAbsent: boolean;
  repo?: boolean;
  train?: string;
  jobs?: number;
}

export function parseProbe(stdout: string): HostProbe {
  const probe: HostProbe = { gpus: [], noGpu: false, aphrodyAbsent: false };
  for (const line of stdout.split(/\r?\n/)) {
    const [key, ...rest] = line.split("|");
    const value = rest.join("|").trim();
    switch (key) {
      case "user":
        probe.user = value;
        break;
      case "cpu":
        probe.cpu = Number(value) || undefined;
        break;
      case "load":
        probe.load = value;
        break;
      case "mem": {
        const [total, avail] = value.split("|");
        probe.memTotalKb = Number(total) || undefined;
        probe.memAvailKb = Number(avail) || undefined;
        break;
      }
      case "disk": {
        const [avail, total] = value.split("|");
        probe.diskAvailKb = Number(avail) || undefined;
        probe.diskTotalKb = Number(total) || undefined;
        break;
      }
      case "gpu": {
        if (value === "aucun") {
          probe.noGpu = true;
          break;
        }
        const [name = "", total = "0", used = "0", util = "0"] = value.split(",").map(part => part.trim());
        probe.gpus.push({
          name,
          totalMiB: Number(total),
          usedMiB: Number(used),
          util: Number(util),
        });
        break;
      }
      case "aphrody":
        if (value === "absent") probe.aphrodyAbsent = true;
        else probe.aphrody = value;
        break;
      case "repo":
        probe.repo = value === "oui";
        break;
      case "train":
        probe.train = value;
        break;
      case "jobs":
        probe.jobs = Number(value) || 0;
        break;
      default:
        break;
    }
  }
  return probe;
}

/** `aphrody train status` prints a JSON object; anything else means the command is missing from that build. */
export function readTrainStatus(text: string): {
  json?: { gpu_lock_active?: boolean; python_train_project?: boolean };
  missing: boolean;
} {
  try {
    return {
      json: JSON.parse(text) as {
        gpu_lock_active?: boolean;
        python_train_project?: boolean;
      },
      missing: false,
    };
  } catch {
    return {
      missing: /requires --features train|unrecognized subcommand|not found/i.test(text),
    };
  }
}

async function localChecks(ctx: Context, pack: AccessPack | undefined): Promise<Check[]> {
  const { sys, paths } = ctx;
  const out: Check[] = [];

  out.push(
    sys.platform === "win32"
      ? check("windows", "Windows", "ok", "Windows détecté")
      : check("windows", "Système", "attention", `ce kit est prévu pour Windows (ici : ${sys.platform})`),
  );

  const free = await sys.freeBytes(paths.home);
  if (free === undefined) out.push(check("disque", "Espace disque", "attention", "impossible de lire l'espace libre"));
  else if (free < 5 * GIB)
    out.push(
      check(
        "disque",
        "Espace disque",
        "echec",
        `${formatBytes(free)} libres seulement`,
        "Libère de la place sur ce PC (au moins 5 Go, idéalement 20 Go).",
        "omar",
      ),
    );
  else if (free < 20 * GIB)
    out.push(
      check(
        "disque",
        "Espace disque",
        "attention",
        `${formatBytes(free)} libres (20 Go ou plus conseillés)`,
        "Pense à libérer de la place bientôt.",
        "omar",
      ),
    );
  else out.push(check("disque", "Espace disque", "ok", `${formatBytes(free)} libres`));

  const git = findTool(sys, paths, "git");
  if (!git)
    out.push(
      check("git", "Git", "echec", "Git n'est pas installé", "Choisis « Tout installer ou réparer » dans le menu."),
    );
  else out.push(check("git", "Git", "ok", (await toolVersion(sys, git)) ?? "installé"));

  if (!existsSync(`${paths.repoDir}/.git`) && !existsSync(`${paths.repoDir}\\.git`))
    out.push(
      check(
        "depot",
        "Dépôt Aphrody",
        "echec",
        `pas de copie du dépôt dans ${paths.repoDir}`,
        "Choisis « Tout installer ou réparer » (une fenêtre GitHub te demandera de te connecter).",
      ),
    );
  else if (git) {
    const branch = await sys.run([git, "-C", paths.repoDir, "rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: 20_000,
    });
    out.push(
      branch.code === 0
        ? check("depot", "Dépôt Aphrody", "ok", `${paths.repoDir} (branche ${branch.stdout.trim()})`)
        : check(
            "depot",
            "Dépôt Aphrody",
            "echec",
            "le dossier existe mais Git ne le lit pas",
            "Envoie le message d'aide à l'équipe.",
            "equipe",
          ),
    );
  } else out.push(check("depot", "Dépôt Aphrody", "ok", paths.repoDir));

  const ssh = findTool(sys, paths, "ssh");
  const keygen = findTool(sys, paths, "sshKeygen");
  if (!ssh || !keygen)
    out.push(
      check(
        "ssh-client",
        "Programme SSH",
        "echec",
        "le client OpenSSH de Windows manque",
        "Paramètres Windows > Applications > Fonctionnalités facultatives > ajoute « Client OpenSSH ».",
      ),
    );
  else out.push(check("ssh-client", "Programme SSH", "ok", "OpenSSH présent"));

  out.push(
    existsSync(paths.sshKey) && existsSync(`${paths.sshKey}.pub`)
      ? check("cle-ssh", "Ta clé SSH", "ok", "clé créée sur ce PC")
      : check(
          "cle-ssh",
          "Ta clé SSH",
          "echec",
          "pas encore de clé",
          "Choisis « Envoyer mes clés à l'équipe » dans le menu.",
        ),
  );

  if (!pack) {
    out.push(
      check(
        "acces",
        "Fichier d'accès de l'équipe",
        "echec",
        "pas encore reçu ou importé",
        "Demande à l'équipe le fichier « aphrody-omar-acces.json », mets-le dans Téléchargements, puis choisis « Tout installer ou réparer ».",
      ),
    );
  } else
    out.push(
      check(
        "acces",
        "Fichier d'accès de l'équipe",
        "ok",
        `importé${pack.issuedAt ? ` (émis le ${pack.issuedAt.slice(0, 10)})` : ""}`,
      ),
    );

  const wireguard = findTool(sys, paths, "wireguard");
  const tunnel = pack?.wireguard?.tunnelName ?? "aphrody";
  if (!wireguard)
    out.push(
      check(
        "wireguard",
        "WireGuard",
        "echec",
        "WireGuard n'est pas installé",
        "Choisis « Tout installer ou réparer » dans le menu.",
      ),
    );
  else {
    const query = await sys.run(["sc", "query", `WireGuardTunnel$${tunnel}`], {
      timeoutMs: 15_000,
    });
    const state = /STATE\s*:\s*\d+\s+(\w+)/.exec(query.stdout)?.[1];
    if (state === "RUNNING") out.push(check("tunnel", "Tunnel privé", "ok", `« ${tunnel} » actif`));
    else if (state)
      out.push(
        check(
          "tunnel",
          "Tunnel privé",
          "echec",
          `« ${tunnel} » est ${state === "STOPPED" ? "arrêté" : state.toLowerCase()}`,
          "Ouvre l'application WireGuard et clique sur « Activer », ou relance « Tout installer ou réparer ».",
        ),
      );
    else
      out.push(
        check(
          "tunnel",
          "Tunnel privé",
          pack ? "echec" : "attente",
          `le tunnel « ${tunnel} » n'est pas installé`,
          pack
            ? "Choisis « Tout installer ou réparer » (Windows demandera ton autorisation)."
            : "Il faut d'abord le fichier d'accès de l'équipe.",
          pack ? "omar" : "equipe",
        ),
      );
  }
  return out;
}

async function componentChecks(
  ctx: Context,
  pack: AccessPack | undefined,
): Promise<{ checks: Check[]; aphrodyExe?: string }> {
  const { sys, paths } = ctx;
  const out: Check[] = [];
  const aphrody = findTool(sys, paths, "aphrody");

  let manifest: Awaited<ReturnType<typeof fetchManifest>> | undefined;
  if (!aphrody) {
    try {
      manifest = await fetchManifest(pack?.downloadsBase ?? "https://downloads.aphrody.com", ctx.fetchImpl);
    } catch {
      manifest = undefined;
    }
  }
  const missing = (name: string, exe: string | undefined, label: string): Check => {
    if (exe) return check(name, label, "ok", "installé");
    if (manifest && !pickArtifact(manifest, name))
      return check(
        name,
        label,
        "attente",
        `pas encore publié pour Windows sur le site de téléchargement`,
        "Rien à faire de ton côté : l'équipe doit le publier.",
        "equipe",
      );
    return check(name, label, "echec", "pas installé", "Choisis « Tout installer ou réparer » dans le menu.");
  };

  if (aphrody) {
    const version = await toolVersion(sys, aphrody);
    out.push(check("aphrody", "aphrody", "ok", version ? `version ${version}` : "installé"));
    const probe = await ctx.mcpProbe(mcpSpec(aphrody, findTool(sys, paths, "aphrody-mcp")));
    out.push(
      probe.ok
        ? check("mcp", "MCP Aphrody (sur ce PC)", "ok", `répond, ${probe.tools} outils`)
        : check(
            "mcp",
            "MCP Aphrody (sur ce PC)",
            "echec",
            probe.error ?? "ne répond pas",
            "Envoie le message d'aide à l'équipe.",
            "equipe",
          ),
    );
    const desktop = await desktopState(paths, mcpSpec(aphrody, findTool(sys, paths, "aphrody-mcp")));
    const code = await claudeCodeState(
      sys,
      findTool(sys, paths, "claude"),
      mcpSpec(aphrody, findTool(sys, paths, "aphrody-mcp")),
    );
    if (desktop === "configure" || code === "configure")
      out.push(check("mcp-client", "MCP dans ton assistant", "ok", "déclaré"));
    else if (desktop === "aucun" && code === "aucun")
      out.push(
        check(
          "mcp-client",
          "MCP dans ton assistant",
          "attention",
          "ni Claude Desktop ni Claude Code trouvés",
          "Installe ton assistant puis relance « Tout installer ou réparer ».",
        ),
      );
    else
      out.push(
        check(
          "mcp-client",
          "MCP dans ton assistant",
          "echec",
          "pas encore déclaré",
          "Choisis « Tout installer ou réparer » (ferme et rouvre ensuite ton assistant).",
        ),
      );
  } else {
    out.push(missing("aphrody", aphrody, "aphrody"));
    out.push(check("mcp", "MCP Aphrody (sur ce PC)", "attente", "dépend d'aphrody", undefined));
  }
  const result: { checks: Check[]; aphrodyExe?: string } = { checks: out };
  if (aphrody) result.aphrodyExe = aphrody;
  return result;
}

async function hostChecks(ctx: Context, pack: AccessPack, id: string, tunnelUp: boolean): Promise<Check[]> {
  const { sys, paths } = ctx;
  const host = pack.hosts[id]!;
  const out: Check[] = [];
  const reachable = await sys.tcpOpen(host.address, host.port, 4000);
  if (!reachable) {
    out.push(
      check(
        `reseau-${id}`,
        `Serveur ${id} : réseau`,
        "echec",
        "ne répond pas",
        tunnelUp
          ? "Le tunnel est actif mais le serveur ne répond pas : envoie le message d'aide à l'équipe."
          : "Active d'abord le tunnel (voir la ligne « Tunnel privé »).",
        tunnelUp ? "equipe" : "omar",
      ),
    );
    return out;
  }
  out.push(check(`reseau-${id}`, `Serveur ${id} : réseau`, "ok", "répond par le tunnel"));
  const result = await runRemote(sys, paths, id, SCRIPTS.sonde, {
    timeoutMs: 60_000,
    args: [host.aphrodyBin, host.repoDir],
    connectTimeoutSecs: 8,
  });
  if (result.problem || result.code !== 0) {
    const problem = result.problem ?? "autre";
    out.push(
      check(
        `ssh-${id}`,
        `Serveur ${id} : connexion SSH`,
        "echec",
        SSH_PROBLEM_TEXT[problem],
        problem === "cle-refusee"
          ? "Envoie ton fichier de clés à l'équipe (menu « Envoyer mes clés »)."
          : "Envoie le message d'aide à l'équipe.",
        problem === "cle-refusee" || problem === "hote-inconnu" ? "equipe" : "omar",
      ),
    );
    return out;
  }
  const probe = parseProbe(result.stdout);
  const trainHost = host.roles.includes("train") || id === trainHostId(pack);
  out.push(
    check(`ssh-${id}`, `Serveur ${id} : connexion SSH`, "ok", `connecté en tant que ${probe.user ?? host.user}`),
  );

  const parts: string[] = [];
  if (probe.cpu) parts.push(`${probe.cpu} coeurs${probe.load ? ` (charge ${probe.load})` : ""}`);
  if (probe.memTotalKb)
    parts.push(`RAM ${formatBytes((probe.memAvailKb ?? 0) * 1024)} libres sur ${formatBytes(probe.memTotalKb * 1024)}`);
  if (probe.gpus.length > 0)
    parts.push(
      probe.gpus
        .map(gpu => `GPU ${gpu.name} ${Math.max(gpu.totalMiB - gpu.usedMiB, 0)} Mo libres sur ${gpu.totalMiB} Mo`)
        .join(", "),
    );
  else if (probe.noGpu) parts.push("pas de carte graphique");
  const diskFree = probe.diskAvailKb ? probe.diskAvailKb * 1024 : undefined;
  if (diskFree !== undefined) parts.push(`disque ${formatBytes(diskFree)} libres`);
  let status: Status = "ok";
  let action: string | undefined;
  if (diskFree !== undefined && diskFree < 5 * GIB) {
    status = "echec";
    action = "Le disque du serveur est presque plein : préviens l'équipe avant de lancer quoi que ce soit.";
  } else if (diskFree !== undefined && diskFree < 20 * GIB) {
    status = "attention";
    action = "Peu de place sur le serveur : préviens l'équipe avant un gros entraînement.";
  }
  if (trainHost && probe.noGpu && status === "ok") {
    status = "attention";
    action = "Sans carte graphique, l'entraînement est très lent : choisis un autre serveur si possible.";
  }
  out.push(
    check(
      `ressources-${id}`,
      `Serveur ${id} : ressources`,
      status,
      parts.join(" ; ") || "aucune mesure",
      action,
      action ? "equipe" : "omar",
    ),
  );

  if (trainHost) {
    if (probe.aphrodyAbsent)
      out.push(
        check(
          `entrainement-${id}`,
          `Serveur ${id} : entraînement`,
          "echec",
          "aphrody n'est pas installé pour ton compte sur ce serveur",
          "Signale-le à l'équipe.",
          "equipe",
        ),
      );
    else if (probe.repo === false)
      out.push(
        check(
          `entrainement-${id}`,
          `Serveur ${id} : entraînement`,
          "echec",
          `le dossier du dépôt (${host.repoDir}) n'existe pas sur le serveur`,
          "Signale-le à l'équipe.",
          "equipe",
        ),
      );
    else {
      const train = readTrainStatus(probe.train ?? "");
      if (train.missing || !train.json)
        out.push(
          check(
            `entrainement-${id}`,
            `Serveur ${id} : entraînement`,
            "echec",
            "la fonction d'entraînement n'est pas disponible dans l'aphrody du serveur",
            "Signale-le à l'équipe.",
            "equipe",
          ),
        );
      else if (train.json.python_train_project === false)
        out.push(
          check(
            `entrainement-${id}`,
            `Serveur ${id} : entraînement`,
            "echec",
            "le projet d'entraînement Python est introuvable sur le serveur",
            "Signale-le à l'équipe.",
            "equipe",
          ),
        );
      else if (train.json.gpu_lock_active)
        out.push(
          check(
            `entrainement-${id}`,
            `Serveur ${id} : entraînement`,
            "attention",
            "la carte graphique est déjà réservée par un autre travail",
            "Attends la fin du travail en cours (menu Entraînement > État).",
            "omar",
          ),
        );
      else
        out.push(
          check(
            `entrainement-${id}`,
            `Serveur ${id} : entraînement`,
            "ok",
            `prêt${probe.jobs ? ` (${probe.jobs} travail en cours)` : ""}`,
          ),
        );
    }
  }
  return out;
}

async function serviceChecks(ctx: Context, pack: AccessPack): Promise<Check[]> {
  const out: Check[] = [];
  for (const [id, titre] of [
    ["mcpHttp", "MCP du serveur"],
    ["a2a", "A2A (agents entre eux)"],
  ] as const) {
    const service = pack.services[id];
    if (!service) continue;
    const answer = await ctx.sys.httpGet(service.health, 5000);
    if (answer && answer.status >= 200 && answer.status < 300) out.push(check(id, titre, "ok", "répond"));
    else
      out.push(
        check(
          id,
          titre,
          "attention",
          answer ? `répond avec le code ${answer.status}` : "ne répond pas",
          "Ce n'est pas bloquant pour entraîner. Signale-le à l'équipe si tu en as besoin.",
          "equipe",
        ),
      );
  }
  return out;
}

export function verdictOf(checks: Check[]): Report["verdict"] {
  if (checks.some(entry => entry.status === "echec")) return "pas-pret";
  if (checks.some(entry => entry.status === "attention" || entry.status === "attente")) return "presque";
  return "pret";
}

export async function runDoctor(ctx: Context, options: { remote?: boolean } = {}): Promise<Report> {
  const pack = await loadProfile(ctx.paths);
  const checks: Check[] = [];
  const local = await localChecks(ctx, pack);
  checks.push(...local);
  const components = await componentChecks(ctx, pack);
  checks.push(...components.checks);
  const tunnelUp = local.some(entry => entry.id === "tunnel" && entry.status === "ok");
  if (pack && options.remote !== false) {
    const ids = Object.keys(pack.hosts);
    const perHost = await Promise.all(ids.map(id => hostChecks(ctx, pack, id, tunnelUp)));
    checks.push(...perHost.flat());
    checks.push(...(await serviceChecks(ctx, pack)));
  }
  const trainId = pack ? trainHostId(pack) : undefined;
  const entrainementPret =
    trainId !== undefined &&
    checks.some(entry => entry.id === `entrainement-${trainId}` && entry.status === "ok") &&
    !checks.some(
      entry => entry.status === "echec" && (entry.id === `reseau-${trainId}` || entry.id === `ssh-${trainId}`),
    );
  return {
    generatedAt: ctx.sys.now().toISOString(),
    checks,
    verdict: verdictOf(checks),
    entrainementPret,
  };
}

const MARK_OF: Record<Status, string> = {
  ok: MARK.ok,
  attention: MARK.warn,
  echec: MARK.fail,
  attente: MARK.wait,
  ignore: MARK.skip,
};

export function renderReport(report: Report): string[] {
  const lines = report.checks.map(entry => `${MARK_OF[entry.status]} ${entry.titre} : ${entry.detail}`);
  lines.push("");
  const failures = report.checks.filter(entry => entry.status === "echec").length;
  const notes = report.checks.filter(entry => entry.status === "attention" || entry.status === "attente").length;
  if (report.verdict === "pret") lines.push("RÉSULTAT : TOUT EST PRÊT.");
  else if (report.verdict === "presque")
    lines.push(`RÉSULTAT : PRESQUE PRÊT (${notes} remarque${notes > 1 ? "s" : ""}, rien de bloquant).`);
  else lines.push(`RÉSULTAT : PAS PRÊT (${failures} point${failures > 1 ? "s" : ""} à régler).`);
  lines.push(report.entrainementPret ? "Entraînement : prêt à être lancé." : "Entraînement : pas encore possible.");
  const todo = (who: Responsible) =>
    report.checks.filter(entry => entry.responsable === who && entry.action && entry.status !== "ok");
  const mine = todo("omar");
  const team = todo("equipe");
  if (mine.length > 0) {
    lines.push("", "À faire de ton côté :");
    for (const entry of mine) lines.push(`  - ${entry.titre} : ${entry.action}`);
  }
  if (team.length > 0) {
    lines.push("", "À signaler à l'équipe (menu « Message d'aide pour l'équipe ») :");
    for (const entry of team) lines.push(`  - ${entry.titre} : ${entry.action}`);
  }
  return lines;
}
