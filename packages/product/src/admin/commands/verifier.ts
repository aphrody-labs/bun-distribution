// SPDX-License-Identifier: Apache-2.0
import { parse } from "../../shared/args.ts";
import { renderReport, runDoctor } from "../lib/doctor.ts";
import type { Command } from "./types.ts";

const HELP = `aphrody-omar verifier [--json] [--local]

Dit en français si tout est prêt : Windows, espace disque, Git, dépôt, SSH, clés, tunnel privé, aphrody,
MCP, puis pour chaque serveur : réseau, connexion, processeur, mémoire, carte graphique, disque, entraînement,
et les services MCP et A2A du serveur quand ils sont déclarés. Ne modifie rien.

  --json    résultat structuré (pour l'équipe)
  --local   ne teste que ce PC, pas les serveurs`;

const command: Command = {
  name: "verifier",
  summary:
    "Vérifier que tout est prêt (tunnel, SSH, MCP, A2A, GPU/CPU, disque)",
  async run(argv, ctx) {
    const { values } = parse(argv, {
      json: { type: "boolean" },
      local: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      ctx.ui.say(HELP);
      return 0;
    }
    const report = await runDoctor(ctx, { remote: values.local !== true });
    if (values.json) ctx.ui.say(JSON.stringify(report, null, 2));
    else for (const line of renderReport(report)) ctx.ui.say(line);
    return report.verdict === "pas-pret" ? 1 : 0;
  },
};

export default command;
