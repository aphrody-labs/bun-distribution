// SPDX-License-Identifier: Apache-2.0
/** Not listed in the menu: the elevated half of the tunnel install (started by Windows after the consent window). */
import { installTunnelElevated } from "../lib/tunnel.ts";
import type { Command } from "./types.ts";

const command: Command = {
  name: "interne",
  summary: "usage interne",
  async run(argv, ctx) {
    const [action, confPath, tunnel] = argv;
    if (
      action !== "wg-installer" ||
      !confPath ||
      !tunnel ||
      !/^[A-Za-z0-9_=+.-]{1,32}$/.test(tunnel)
    ) {
      ctx.ui.say("usage interne : ne pas lancer à la main.");
      return 2;
    }
    const result = await installTunnelElevated(
      ctx.sys,
      ctx.paths,
      confPath,
      tunnel,
    );
    ctx.log(
      `tunnel (élevé) : ${result.ok ? "ok" : "échec"} - ${result.detail}`,
    );
    ctx.ui.say(
      result.ok
        ? `Tunnel installé : ${result.detail}`
        : `Le tunnel n'a pas pu être installé : ${result.detail}`,
    );
    if (!result.ok)
      ctx.ui.pause("Appuie sur Entrée pour fermer cette fenêtre...");
    return result.ok ? 0 : 1;
  },
};

export default command;
