// SPDX-License-Identifier: Apache-2.0
import type { Command } from "./types.ts";

export default {
  name: "flotte",
  summary: "Flotte native Windows/Python et depot GPU prive",
  async run(argv, ctx) {
    if (!argv.length || argv.includes("--help")) {
      ctx.ui.say(
        "aphrody-product admin flotte inventory|plan|cuda-probe|tunnel-key|disque [--root repository]\naphrody-product admin flotte depot <pinned depot> <protected token file> 10.200.77.1",
      );
      return 0;
    }
    if (argv[0] === "disque") return (await import("../lib/fleet/disks.ts")).diskMain(argv.slice(1));
    if (argv[0] === "depot") {
      await (await import("../lib/fleet/artifacts.ts")).serveArtifacts(argv.slice(1));
      return 0;
    }
    return (await import("../lib/fleet/native.ts")).main(argv);
  },
} satisfies Command;
