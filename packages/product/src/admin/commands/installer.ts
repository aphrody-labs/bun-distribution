// SPDX-License-Identifier: Apache-2.0
import { parse } from "../../shared/args.ts";
import type { Context } from "../lib/context.ts";
import { renderReport, runDoctor } from "../lib/doctor.ts";
import { runInstall, type InstallState } from "../lib/steps.ts";
import { MARK } from "../lib/ui.ts";
import type { Command } from "./types.ts";

const HELP = `aphrody-omar installer [--simuler] [--acces <fichier>]

Installe et configure tout ce qu'il faut sur ce PC, étape par étape, sans rien supprimer :
Git et WireGuard (par Windows), tes clés, le tunnel privé, aphrody, la copie du dépôt GitHub
et le MCP dans ton assistant. Chaque étape saute ce qui est déjà fait : tu peux relancer sans risque.

  --simuler          dit ce qui serait fait, sans rien modifier
  --acces <fichier>  fichier d'accès de l'équipe (sinon cherché dans Téléchargements et le Bureau)`;

export async function installFlow(ctx: Context, options: { simuler: boolean; acces?: string }): Promise<number> {
  const { ui } = ctx;
  ui.say("Installation et réglages d'Aphrody sur ce PC");
  ui.say(
    options.simuler
      ? "(simulation : rien n'est modifié)"
      : "Windows peut te demander ton autorisation : clique « Oui ».",
  );
  ui.say();
  const state: InstallState = {
    repoReady: false,
    ...(options.acces ? { packFile: options.acces } : {}),
  };
  const report = await runInstall(ctx, options.simuler ? "simuler" : "executer", state);
  ui.say();
  if (options.simuler) {
    ui.say("Simulation terminée. Rien n'a été modifié.");
    return report.failed > 0 ? 1 : 0;
  }
  ui.say("Vérification finale...");
  const doctor = await runDoctor(ctx);
  for (const line of renderReport(doctor)) ui.say(line);
  const needsPack = report.results.find(entry => entry.step.id === "acces")?.result.state === "attente";
  if (needsPack) {
    ui.say();
    ui.say(
      `${MARK.wait} Prochaine étape : envoie le fichier « a-envoyer-a-l-equipe.txt » (sur ton Bureau) à l'équipe.`,
    );
    ui.say(
      "      Quand tu reçois « aphrody-omar-acces.json », mets-le dans Téléchargements et relance « Tout installer ou réparer ».",
    );
  }
  return report.failed > 0 ? 1 : 0;
}

const command: Command = {
  name: "installer",
  summary: "Tout installer ou réparer sur ce PC",
  async run(argv, ctx) {
    const { values } = parse(argv, {
      simuler: { type: "boolean" },
      acces: { type: "string" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      ctx.ui.say(HELP);
      return 0;
    }
    if (
      !values.simuler &&
      ctx.ui.interactive &&
      !ctx.ui.confirm("Je vais installer et configurer Aphrody sur ce PC. Continuer ?", true)
    ) {
      ctx.ui.say("D'accord, rien n'a été fait.");
      return 0;
    }
    return installFlow(ctx, {
      simuler: values.simuler === true,
      ...(values.acces ? { acces: values.acces } : {}),
    });
  },
};

export default command;
