// SPDX-License-Identifier: Apache-2.0
import { parse } from "../../shared/args.ts";
import { loadProfile } from "../lib/profile.ts";
import { stepAcces, makeKeys, type InstallState } from "../lib/steps.ts";
import { tunnelState } from "../lib/tunnel.ts";
import type { Command } from "./types.ts";

const HELP = `aphrody-omar acces <cles|importer|etat> [options]

  cles               crée tes clés sur ce PC (si elles n'existent pas) et prépare « a-envoyer-a-l-equipe.txt »
                     (clés publiques seulement) sur le Bureau, copié aussi dans le presse-papiers
  importer [fichier] importe le fichier d'accès de l'équipe (« aphrody-omar-acces.json », cherché dans
                     Téléchargements, le Bureau et à côté du programme) : serveurs, SSH, tunnel privé
  etat               montre ce qui est importé

Tes clés privées restent sur ce PC : elles ne sont jamais envoyées ni écrites dans le dépôt.`;

const command: Command = {
  name: "acces",
  summary: "Clés, fichier d'accès de l'équipe, tunnel privé",
  async run(argv, ctx) {
    const { positionals, values } = parse(argv, {
      help: { type: "boolean", short: "h" },
    });
    const [action = "etat", file] = positionals;
    if (values.help) {
      ctx.ui.say(HELP);
      return 0;
    }
    if (action === "cles") {
      const made = await makeKeys(ctx);
      ctx.ui.say(made.created ? "Clés créées sur ce PC." : "Tes clés existent déjà (rien n'a été changé).");
      ctx.ui.say(
        `Fichier à envoyer à l'équipe : ${made.file}${made.copied ? " (aussi dans le presse-papiers : colle-le dans un message)" : ""}`,
      );
      ctx.ui.say();
      ctx.ui.say(made.text);
      return 0;
    }
    if (action === "importer") {
      const state: InstallState = {
        repoReady: false,
        ...(file ? { packFile: file } : {}),
      };
      await makeKeys(ctx);
      const result = await stepAcces.run(ctx, "executer", state);
      ctx.ui.say(
        `${result.state === "echec" ? "Échec" : result.state === "attente" ? "En attente" : "OK"} : ${result.detail}`,
      );
      if (result.action) ctx.ui.say(`-> ${result.action}`);
      return result.state === "echec" ? 1 : 0;
    }
    if (action === "etat") {
      const pack = await loadProfile(ctx.paths);
      if (!pack) {
        ctx.ui.say("Aucun fichier d'accès importé pour l'instant.");
        return 0;
      }
      ctx.ui.say(`Serveurs : ${Object.keys(pack.hosts).join(", ")}`);
      if (pack.wireguard)
        ctx.ui.say(
          `Tunnel « ${pack.wireguard.tunnelName} » : ${(await tunnelState(ctx.sys, pack.wireguard.tunnelName)) ?? "non installé"}`,
        );
      return 0;
    }
    ctx.ui.say(HELP);
    return 2;
  },
};

export default command;
