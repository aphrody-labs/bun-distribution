// SPDX-License-Identifier: Apache-2.0
import { parse } from "../../shared/args.ts";
import { updateKit } from "../lib/update.ts";
import type { Command } from "./types.ts";

const HELP = `aphrody-omar mise-a-jour [--verifier] [--discret]

Met ce programme à jour depuis le site de téléchargement (empreinte SHA-256 vérifiée).
Il le fait aussi tout seul en arrière-plan, au plus une fois toutes les 12 h ;
désactive avec la variable APHRODY_OMAR_NO_UPDATE=1.

  --verifier  dit seulement s'il existe une version plus récente
  --discret   aucun message sauf erreur`;

const command: Command = {
  name: "mise-a-jour",
  summary: "Mettre ce programme à jour",
  async run(argv, ctx) {
    const { values } = parse(argv, {
      verifier: { type: "boolean" },
      discret: { type: "boolean" },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      ctx.ui.say(HELP);
      return 0;
    }
    const say = (line: string) => values.discret || values.quiet || ctx.ui.say(line);
    try {
      const result = await updateKit(ctx, { checkOnly: values.verifier === true });
      switch (result.status) {
        case "up-to-date":
          say(`À jour (version ${ctx.version}).`);
          break;
        case "available":
          say(
            `Nouvelle version ${result.latest} disponible (installée : ${ctx.version}). Choisis « Mettre à jour ce programme ».`,
          );
          break;
        case "updated":
          say(`Mis à jour : ${ctx.version} -> ${result.latest}. Actif au prochain lancement.`);
          break;
        case "skipped":
          say(`Pas de mise à jour : ${result.detail ?? "rien à installer"}`);
          break;
      }
      return 0;
    } catch (error) {
      console.error(`Mise à jour impossible : ${(error as Error).message}`);
      return 1;
    }
  },
};

export default command;
