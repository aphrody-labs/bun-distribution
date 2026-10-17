// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Context } from "../lib/context.ts";
import type { Command } from "./types.ts";

export function guideCandidates(ctx: Context): string[] {
  return [
    join(ctx.paths.installDir, "Guide.html"),
    join(ctx.exeDir, "Guide.html"),
    join(ctx.paths.repoDir, "docs", "operations", "omar-guide.md"),
  ];
}

const command: Command = {
  name: "guide",
  summary: "Ouvrir le guide (1 page)",
  async run(_argv, ctx) {
    const file = guideCandidates(ctx).find(candidate => existsSync(candidate));
    if (!file) {
      ctx.ui.say("Le guide n'est pas à côté du programme. Demande-le à l'équipe (« omar-guide »).");
      return 1;
    }
    if (ctx.sys.platform === "win32")
      await ctx.sys.run(["cmd", "/c", "start", "", file], {
        timeoutMs: 15_000,
      });
    else ctx.ui.say(`Guide : ${file}`);
    return 0;
  },
};

export default command;
