// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- commands run one after the other on purpose */
/**
 * « Mon PC » : simple actions backed by the existing owners (aphrody winclean, aphrody doctor, aphrody model, aphrody infra ssh). Each one is a fixed argv checked against the real `--help`; the kit adds no logic of its own. Nothing destructive:
 * actions that change the PC (memory trimming) ask for a typed confirmation first.
 */
import { parse } from "../../shared/args.ts";
import type { Context } from "../lib/context.ts";
import { loadProfile } from "../lib/profile.ts";
import { findTool } from "../lib/tools.ts";
import type { Command } from "./types.ts";

export interface PcAction {
  key: string;
  titre: string;
  /** Commands run in order; `tool` is the executable looked up on the PC. */
  commands: { tool: "aphrody"; args: string[] }[];
  /** Changes the PC (not data): needs OUI. */
  confirm?: string;
  windowsOnly?: boolean;
}

const winclean = (tool: string): PcAction["commands"][number] => ({
  tool: "aphrody",
  args: ["winclean", "call", tool],
});

export const PC_ACTIONS: PcAction[] = [
  {
    key: "etat",
    titre:
      "Voir l'état de mon PC (Windows, processeur, mémoire, disques, antivirus)",
    commands: [
      "get_os_info",
      "get_cpu_info",
      "get_memory_info",
      "get_disk_info",
      "get_defender_status",
    ].map(winclean),
    windowsOnly: true,
  },
  {
    key: "wsl",
    titre: "Voir WSL (Linux sous Windows) et ses distributions",
    commands: ["wsl_get_status", "wsl_list_distributions"].map(winclean),
    windowsOnly: true,
  },
  {
    key: "memoire",
    titre: "Libérer de la mémoire (ne supprime aucun fichier)",
    commands: ["perf_purge_standby_list", "perf_empty_working_sets"].map(
      winclean,
    ),
    confirm:
      "Je vais vider la mémoire en cache de Windows et réduire la mémoire des programmes ouverts. Aucun fichier n'est touché, mais le PC peut ralentir quelques secondes.",
    windowsOnly: true,
  },
  {
    key: "diagnostic",
    titre: "Diagnostic d'aphrody sur ce PC",
    commands: [
      { tool: "aphrody", args: ["doctor"] },
      { tool: "aphrody", args: ["winclean", "doctor"] },
    ],
  },
  {
    key: "modeles",
    titre: "Mes modèles : ce qui est installé et ce que mon matériel permet",
    commands: [
      { tool: "aphrody", args: ["model", "list"] },
      { tool: "aphrody", args: ["model", "accel"] },
    ],
  },
];

export async function runPcAction(ctx: Context, key: string): Promise<number> {
  const action = PC_ACTIONS.find((entry) => entry.key === key);
  if (!action) {
    ctx.ui.say(
      `Action inconnue : ${key} (${PC_ACTIONS.map((entry) => entry.key).join(", ")})`,
    );
    return 2;
  }
  if (action.windowsOnly && ctx.sys.platform !== "win32") {
    ctx.ui.say("Cette action ne fonctionne que sous Windows.");
    return 1;
  }
  for (const tool of new Set(action.commands.map((command) => command.tool))) {
    if (!findTool(ctx.sys, ctx.paths, tool)) {
      ctx.ui.say(
        `${tool} n'est pas installé sur ce PC (ou pas encore publié pour Windows) : choisis « Tout installer ou réparer » ou préviens l'équipe.`,
      );
      return 1;
    }
  }
  if (action.confirm) {
    ctx.ui.say(action.confirm);
    if (
      !ctx.ui.interactive ||
      ctx.ui
        .ask(
          "Tape OUI (en majuscules) pour continuer, autre chose pour annuler",
        )
        ?.trim() !== "OUI"
    ) {
      ctx.ui.say("Annulé : rien n'a été modifié.");
      return 0;
    }
  }
  let code = 0;
  for (const command of action.commands) {
    const exe = findTool(ctx.sys, ctx.paths, command.tool)!;
    ctx.log(`pc ${key} : ${command.tool} ${command.args.join(" ")}`);
    const result = await ctx.sys.run([exe, ...command.args], {
      inherit: true,
      timeoutMs: 300_000,
    });
    if (result.code !== 0) code = 1;
  }
  ctx.ui.say(
    code === 0
      ? "Terminé."
      : "Terminé avec un message d'erreur ci-dessus : envoie le message d'aide à l'équipe si ça se répète.",
  );
  return code;
}

/** Health of a server through aphrody's own SSH operator (`aphrody infra ssh status`), for the servers named vps or dbfr. */
export async function serverStatus(ctx: Context): Promise<number> {
  const pack = await loadProfile(ctx.paths);
  const aphrody = findTool(ctx.sys, ctx.paths, "aphrody");
  if (!pack || !aphrody) {
    ctx.ui.say(
      "Il faut le fichier d'accès de l'équipe et aphrody : choisis « Tout installer ou réparer ».",
    );
    return 1;
  }
  let code = 0;
  for (const host of Object.keys(pack.hosts).filter(
    (id) => id === "vps" || id === "dbfr",
  )) {
    ctx.ui.say(`Serveur ${host} :`);
    const result = await ctx.sys.run(
      [aphrody, "infra", "ssh", "status", "--host", host],
      {
        inherit: true,
        timeoutMs: 60_000,
      },
    );
    if (result.code !== 0) code = 1;
  }
  return code;
}

const command: Command = {
  name: "pc",
  summary: "Mon PC et mes serveurs : état, mémoire, WSL, diagnostic, modèles",
  async run(argv, ctx) {
    const { positionals } = parse(argv, {});
    const [key] = positionals;
    if (!key) {
      ctx.ui.say(
        `Actions : ${[...PC_ACTIONS.map((entry) => entry.key), "serveurs"].join(", ")}`,
      );
      return 0;
    }
    return key === "serveurs" ? serverStatus(ctx) : runPcAction(ctx, key);
  },
};

export default command;
