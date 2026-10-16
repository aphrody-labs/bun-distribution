import { parse } from "../../shared/args.ts";
import { VERSION } from "../../shared/update.ts";
import { defaultContext } from "../../admin/lib/context.ts";
import { updateKit } from "../../admin/lib/update.ts";
import type { Command } from "./types.ts";

const HELP = `creator-kit self-update [--check] [--quiet]

Met creator-kit à jour depuis https://downloads.aphrody.com (téléchargement vérifié par SHA-256).
Le .exe se met aussi à jour tout seul en arrière-plan (au plus une vérification toutes les 12 h) ;
désactive avec la variable CREATOR_KIT_NO_UPDATE=1.

  --check   dit seulement s'il existe une version plus récente
  --quiet   aucun message sauf erreur`;

const command: Command = {
  name: "self-update",
  summary: "Mettre creator-kit à jour",
  async run(argv) {
    const { values } = parse(argv, {
      check: { type: "boolean" },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    });
    if (values.help) {
      console.log(HELP);
      return 0;
    }
    const say = (line: string) => values.quiet || console.log(line);
    try {
      const result = await updateKit(defaultContext(), {
        checkOnly: values.check === true,
      });
      switch (result.status) {
        case "up-to-date":
          say(`À jour (version ${VERSION}).`);
          break;
        case "available":
          say(
            `Nouvelle version ${result.latest} disponible (installée : ${VERSION}). Lance : creator-kit self-update`,
          );
          break;
        case "updated":
          say(
            `Mis à jour : ${VERSION} -> ${result.latest}. Active au prochain lancement.`,
          );
          break;
        case "skipped":
          say(
            `Version ${result.latest} disponible, non installée : ${result.detail}`,
          );
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
